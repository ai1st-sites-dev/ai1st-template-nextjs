#!/usr/bin/env node
// #1550 —— 真 AI 那条建站路（不是 skipAI）上的关键词页，用桩替掉 Anthropic SDK 跑通整条 create-site.js。
//
// 🔴 不调真 AI（#1499）：`--require <桩>` 拦住 `@anthropic-ai/sdk`，按提示词认出这一通是 Call 1 还是哪一个关键词页，
//    回放写好的回答；`fetch`（地理编码 / 生图）一律当离线 —— 那几处本来就按「查不到就不写」降级。
// 🔴 Call 1 的回答不手搓：先在同一棵树上跑一次 skipAI 建站，拿示例站那几页（它们过块库校验）当 Call 1 的页面。
//
// 量的是正文验收里这几条（逐条标在格子名上）：
//   AC2  2 服务 × 3 个选中词 → 6 页全在 /services/<id>/<slug>、两个详情页由代码补出并列出各自 3 页、兄弟页互链、页脚 6 页、报 6/6 + 6 行相似度
//   AC3  同一个站跑 sync-config 之后导航不变
//   AC4  一个服务 12 个选中词 → 页脚那栏 10 条，第 10 条「All 12 pages →」链到详情页；详情页列出全部 12 页（引用）
//   AC5  其中一页拿不到合格结果 → 只有它被重试，别的页只请求一次；报 5/6、列出失败的词
//   AC7  中文服务名 + 中文关键词 → URL 是拼音，挂在它自己的 /services/<id> 下
//   AC9  Call 1 不给任何详情页（对抗式）→ 每个有关键词页的服务的详情页都在
//   AC11 素材进了这一页那次调用的提示词（字段名 = dashboard 送的 keywordMaterial）
//   PM ① 挂 Brand 的 Lead（组名对不上服务）→ 补一个服务；那组一页都没成 → 不补
//   #1569 r2 中文站不填 Address → Call 1 地址那一格是原样地点（不是给 AI 当背景的双语串）
'use strict';

const assert = require('assert');
const cp = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const NEXT = path.resolve(__dirname, '..');
const { SLUG_MAX_BYTES: SLUG_MAX_BYTES_E2E, FILENAME_MAX_BYTES } = require('./lib/keyword-slug');
const TEMP = [];
process.on('exit', () => {
  if (process.env.KW_E2E_KEEP === '1') { if (TEMP.length) console.log(`📌 KW_E2E_KEEP=1 ⟹ 留着 ${TEMP[0]} 等 ${TEMP.length} 个`); return; }
  for (const d of TEMP) { try { fs.rmSync(d, { recursive: true, force: true }); } catch (e) { /* 打扫不成不改结论 */ } }
});
function die(msg) { console.log(`💥 ${msg}`); process.exit(2); }

let pass = 0;
let fail = 0;
function check(name, fn) {
  try { fn(); pass += 1; console.log(`  ✅ ${name}`); } catch (e) { fail += 1; console.log(`  ❌ ${name}\n     ${e.message}`); }
}

// ── 桩 ────────────────────────────────────────────────────────────────────────────────────────────
// 桩写成一个真函数、序列化进 --require 的文件：写成模板字符串的话，里面的反引号、${} 和正则的反斜杠都要再转义一层。
function stubMain() {
'use strict';
const Module = require('module');
const fs = require('fs');
const cfg = JSON.parse(fs.readFileSync(process.env.KW_STUB_CFG, 'utf8'));
const seen = {};
// cfg.images（#1566）：生图那一通回一张假图（几个字节，不调真 AI）；别的请求照旧离线。
const FAKE_IMAGE = { candidates: [{ content: { parts: [{ inlineData: { data: Buffer.from('fake-jpeg-bytes').toString('base64') } }] } }] };
globalThis.fetch = async (url) => {
  if (cfg.images && String(url).includes('generativelanguage.googleapis.com')) return { ok: true, status: 200, json: async () => FAKE_IMAGE, text: async () => '' };
  throw new Error('offline (test stub)');
};
const PARAS = ['Older homes in the area often hide corroded galvanized lines behind finished walls.',
  'We bring a fully stocked van, explain the problem in plain words and give a written price first.',
  'Most jobs are finished the same day, and we clean up before we leave.',
  'Ask about our maintenance plan if your building is more than thirty years old.'];
function kwPage(slug, keyword, n) {
  const body = [`Looking for ${keyword}? This page is only about ${keyword}.`, ...PARAS.slice(n % 2, n % 2 + 3), `Call us about ${keyword} today.`].join('\n\n');
  return { slug, title: keyword.charAt(0).toUpperCase() + keyword.slice(1), description: `${keyword} — fast, local service.`,
    navLabel: keyword, navOrder: 50, changeFrequency: 'monthly', priority: 0.6,
    sections: [
      { type: 'page-header', data: { headline: keyword } },
      { type: 'content', data: { headline: 'About ' + keyword, body } },
      { type: 'features', data: { headline: 'Why choose us', items: [{ title: 'Fast', text: 'Same day.' }, { title: 'Clear', text: 'Written price.' }, { title: 'Tidy', text: 'We clean up.' }] } },
      { type: 'faq', data: { headline: 'FAQ', items: [{ question: 'How fast?', answer: 'Same day in most cases.' }, { question: 'Price?', answer: 'Written quote first.' }, { question: 'Area?', answer: 'Across the city.' }] } },
      { type: 'cta', data: { headline: 'Book now', body: 'Call today.', ctas: [{ label: 'Get a quote', href: '/quote' }] } },
    ] };
}
// #1549 之后每页生成完还要过 seoProblems 八条（create-site §seoPass），不合格的页带着问题重写一次。桩替 AI 做那一次重写：
//    把页改成八条都过（标题 / 描述 / H1 / 两个 H2 含目标词、描述含地点、去掉表格里没有的年份 / 金额 / 声明词）。
//    cfg.seoBad 里的 slug：关键词页第一次就交一份 SEO 不合格的、重写时原样退回 ⟹ seoPass 丢掉它（过得了块库、过不了 SEO）。
//    cfg.seoLate 里的 slug：第一次同样不合格，重写时修好 ⟹ seoPass 换成**另一个对象**留下它。
const cap = (x) => String(x).charAt(0).toUpperCase() + String(x).slice(1);
const H1_TYPES = new Set(['hero', 'page-header']);
function scrub(v, key) {
  if (typeof v === 'string') {
    if (/^(href|imageUrl|url|phone|email|icon|link)$/.test(key || '')) return v;
    return v.replace(/(?<!\d)(?:19|20)\d{2}(?!\d)/g, 'recent').replace(/[$€£¥]\s?\d[\d,]*(?:\.\d+)?/g, 'a fair price')
      .replace(/\d+\+?\s*(?:years?|yrs?)\b/gi, 'many years').replace(/\b(?:licensed|insured|certified|award-winning|awarded|awards?)\b/gi, 'trusted')
      .replace(/持牌|有执照|持证|已投保|全额投保|认证|获奖|荣获/g, '可靠');
  }
  if (Array.isArray(v)) return v.map((x) => scrub(x, key));
  if (v && typeof v === 'object') { const o = {}; for (const [k, x] of Object.entries(v)) o[k] = scrub(x, k); return o; }
  return v;
}
function seoFix(page, { kw, place, budget, brand }) {
  const pg = scrub(page);
  const secs = Array.isArray(pg.sections) ? pg.sections : (pg.sections = []);
  const head = kw ? cap(kw) : String(pg.title || 'Page');
  pg.title = budget ? head.slice(0, budget) : head;
  const lead = kw ? `${cap(kw)} in ${place || 'town'} by ${brand || 'our team'}` : `${head} — ${brand || 'our team'}${place ? ` in ${place}` : ''}`;
  pg.description = `${lead}. Fast local help, a clear written price before we start, and tidy work every single time.`.slice(0, 150);
  let h1 = 0;
  for (let i = 0; i < secs.length; i += 1) {
    const b = secs[i];
    if (!b || !H1_TYPES.has(b.type)) continue;
    h1 += 1;
    if (h1 === 1) { b.data = { ...(b.data || {}), headline: kw ? cap(kw) : (b.data && b.data.headline) || head }; }
    else { secs.splice(i, 1); i -= 1; }
  }
  if (!h1) secs.unshift({ type: 'page-header', data: { headline: head } });
  if (kw) {
    let h2 = 0;
    for (const b of secs) {
      if (h2 >= 2 || !b || H1_TYPES.has(b.type) || !b.data || typeof b.data.headline !== 'string') continue;
      b.data.headline = `${cap(kw)}: ${b.data.headline}`; h2 += 1;
    }
    while (h2 < 2) { secs.splice(1, 0, { type: 'content', data: { headline: `${cap(kw)} explained`, body: `What ${kw} involves and how we handle it.` } }); h2 += 1; }
  }
  return pg;
}
// #1593 —— 字段级修补那一次的替身：跟 seoFix 同一套改法，只是按字段名改、只回送来的那几个字段（不碰页面结构）。
function fixFields(fields, { kw, place, budget, brand }) {
  const out = {};
  const head = kw ? cap(kw) : 'Page';
  for (const [name, v] of Object.entries(fields)) {
    if (name === 'title') out[name] = budget ? head.slice(0, budget) : head;
    else if (name === 'siteTitle') out[name] = `${cap(kw || brand)} | ${brand}`.slice(0, 60);
    else if (name === 'description' || name === 'siteDescription') {
      const lead = kw ? `${cap(kw)} in ${place || 'town'} by ${brand || 'our team'}` : `${brand || 'our team'}${place ? ` in ${place}` : ''}`;
      out[name] = `${lead}. Fast local help, a clear written price before we start, and tidy work every single time.`.slice(0, 150);
    } else if (name === 'h1') out[name] = kw ? cap(kw) : scrub(v);
    else if (/image alt/.test(name)) out[name] = kw ? `${cap(kw)} work in ${place || 'town'}` : 'Our team at work';
    else if (/\.headline$/.test(name)) out[name] = kw && !String(v).toLowerCase().includes(kw.toLowerCase()) ? `${cap(kw)}: ${scrub(v)}` : scrub(v);
    else out[name] = kw && !String(v).toLowerCase().includes(kw.toLowerCase()) ? `${cap(kw)} — ${scrub(v)}` : scrub(v);
  }
  return out;
}
function answer(req) {
  const first = req.messages[0].content;
  const kind = first.includes('Generate a JSON object with this EXACT structure') ? 'call1'
    : first.includes('Write the sections of ONE page') ? 'call1-page'
    : first.includes('Write ONE keyword landing page') ? 'keyword-page'
      : first.includes('An automatic SEO check found the problems') ? 'seo-fix' : 'other';
  fs.appendFileSync(process.env.KW_STUB_CALLS, JSON.stringify({ kind, first, turns: req.messages.length }) + '\n');
  if (kind === 'call1') return cfg.call1;
  // #1568 —— Call 1 每页一次：回 cfg.call1 里那一页的 sections（站级那一通回的 sections 会被丢掉）。
  if (kind === 'call1-page') {
    const slug = (first.match(/- slug: "([^"]+)"/) || [])[1];
    // 服务 id 被 #1565 收短之后 slug 变了（站级那一通回来就收）⟹ 按 title 那一行认（夹具里每页 title 各不相同）。
    const title = (first.match(/^- title: (.*)$/m) || [])[1];
    const pg = (cfg.call1.pages || []).find((x) => x.slug === slug) || (cfg.call1.pages || []).find((x) => x.title === title);
    if (!pg) throw new Error('cfg.call1 里没有这一页：' + slug);
    return { sections: pg.sections };
  }
  if (kind === 'keyword-page') {
    const slug = (first.match(/- slug: "([^"]+)"/) || [])[1];
    const keyword = (first.match(/- target keyword: "([^"]+)"/) || [])[1];
    seen[slug] = (seen[slug] || 0) + 1;
    let page = kwPage(slug, keyword, Object.keys(seen).length);
    // cfg.seoLate 里的页：第一次也交 SEO 不合格的，但重写时修好（真 AI 下最常走的那条路，QA2 r2）。
    if (![...(cfg.seoBad || []), ...(cfg.seoLate || [])].includes(slug)) {
      page = seoFix(page, {
        kw: keyword, place: ((first.match(/- Location: ([^\n]+)/) || [])[1] || '').split(',')[0].trim(),
        budget: Number((first.match(/with the keyword, max (\d+) chars/) || [])[1]) || 0, brand: (first.match(/- Company: ([^\n]+)/) || [])[1],
      });
    }
    if ((cfg.badAlways || []).includes(slug) || ((cfg.badFirst || []).includes(slug) && seen[slug] === 1)) page.slug = 'wrong/' + slug;
    return page;
  }
  if (kind === 'seo-fix') {
    // #1593 —— 字段级修补：提示词只带出问题的那几个字段（TEXTS TO FIX），桩按字段名替 AI 改字、只回这几个字段。
    const fields = JSON.parse((first.match(/TEXTS TO FIX:\n(\{[\s\S]*?\n\})\n\nPROBLEMS TO FIX/) || [])[1]);
    const slug = (first.match(/^PAGE: (.+)$/m) || [])[1];
    if ((cfg.seoBad || []).includes(slug)) return { fields };
    const ctx = {
      kw: (first.match(/This page's target keyword is "([^"]+)"/) || [])[1] || '',
      place: ((first.match(/^You wrote texts on one page of the website for "[^"]*" \([^,]*, ([^)]*)\)/) || [])[1] || '').split(',')[0].trim(),
      budget: Number((first.match(/"title": max (\d+) chars/) || [])[1]) || 0,
      brand: (first.match(/^You wrote texts on one page of the website for "([^"]*)"/) || [])[1],
    };
    return { fields: fixFields(fields, ctx) };
  }
  throw new Error('桩不认识这一通调用：' + first.slice(0, 120));
}
class FakeAnthropic {
  constructor() {
    this.messages = {
      stream: (req) => ({ finalMessage: async () => ({ content: [{ type: 'text', text: JSON.stringify(answer(req)) }], usage: { input_tokens: 1, output_tokens: 1 }, stop_reason: 'end_turn' }) }),
      create: async (req) => ({ content: [{ type: 'text', text: JSON.stringify(answer(req)) }], usage: { input_tokens: 1, output_tokens: 1 }, stop_reason: 'end_turn' }),
    };
  }
}
FakeAnthropic.default = FakeAnthropic;
FakeAnthropic.Anthropic = FakeAnthropic;
const orig = Module._load;
Module._load = function (request, parent, isMain) {
  if (request === '@anthropic-ai/sdk') return FakeAnthropic;
  return orig.apply(this, arguments);
};}
const STUB = `(${stubMain.toString()})();\n`;

// ── 一棵只属于这一跑的树（拷模板，node_modules 借软链）────────────────────────────────────────────
function makeTree(label) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), `kw-e2e-${label}-`));
  TEMP.push(root);
  const work = path.join(root, 'nextjs');
  cp.execSync(`tar --exclude=./node_modules --exclude=./out --exclude=./.next --exclude=./site --exclude=./public/photos -cf - . | (mkdir -p "${work}" && tar -xf - -C "${work}")`, { cwd: NEXT, stdio: 'pipe' });
  fs.symlinkSync(path.join(NEXT, 'node_modules'), path.join(work, 'node_modules'));
  return work;
}

/** skipAI 示例站的页面（过块库校验）→ Call 1 回答里那几页。只取一次。 */
let demoPagesCache = null;
function demoPages() {
  if (demoPagesCache) return demoPagesCache;
  const work = makeTree('demo');
  const r = cp.spawnSync(process.execPath, [path.join(work, 'scripts', 'create-site.js')], {
    input: JSON.stringify({ siteId: 'kwdemo01', siteUrl: 'https://brightpipes.test', skipAI: true, companyName: 'Bright Pipes', industry: 'plumbing', location: 'Toronto, ON', language: 'en' }),
    cwd: work, encoding: 'utf8', env: { ...process.env, ANTHROPIC_API_KEY: undefined }, timeout: 180000,
  });
  const dir = path.join(work, 'site', 'en', 'pages');
  if (!fs.existsSync(dir)) die(`示例站没建出来：\n${(r.stderr || '').slice(-600)}`);
  demoPagesCache = fs.readdirSync(dir).filter((f) => f.endsWith('.json')).map((f) => {
    const { blocks, ...rest } = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));
    return { ...rest, sections: blocks };
  });
  return demoPagesCache;
}

function call1(services, extraPages = []) {
  return {
    colorScheme: 'light',
    brand: { tagline: 'Pipes done right', logoIcon: 'droplet', email: 'hi@brightpipes.test', locations: [{ label: 'Main', address: '2150 Yonge Street, Toronto', phone: '(416) 555-0199' }] },
    navigation: { ctaLabel: 'Get a quote', ctaPage: 'quote', footerDescription: 'Plumbing in Toronto' },
    seo: { domain: 'https://brightpipes.test', siteTitle: 'Bright Pipes', siteDescription: 'Plumbing in Toronto', areaServed: [{ type: 'City', name: 'Toronto' }], addresses: [], openingHours: { days: ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'], opens: '09:00', closes: '17:00' }, priceRange: '$$', offerCatalogName: 'Services' },
    services: services.map((s) => ({ id: s.id, name: s.name, shortDescription: `${s.name} done right`, fullDescription: `${s.name} across Toronto.`, icon: 'droplet', features: ['a'], products: [] })),
    forms: [{ id: 'quote', name: 'Get a quote', buttonText: 'Send', successMessage: 'Thanks' }, { id: 'contact', name: 'Contact', buttonText: 'Send', successMessage: 'Thanks' }],
    pages: [...demoPages(), ...extraPages],
  };
}

const kw = (keyword, extra = {}) => ({ keyword, volume: 100, goldIndex: 10, selected: true, ...extra });
const primary = (keyword) => kw(keyword, { isPrimary: true });

/** 跑一次建站（桩），回 { events, calls, rc, stderr, site }。
 *  opts.soft：建站失败时不整跑退出，回 { failed: '<原因>' } —— 给「这条路不许让建站失败」那类格子用，
 *  失败落成一个 ❌ 格，后面的格子照跑（#1563 AC6 要两条臂各自变红，硬退出的话第二条臂根本跑不到）。 */
function run(label, payload, stubCfg, opts = {}) {
  const work = makeTree(label);
  const dir = path.dirname(work);
  const stub = path.join(dir, 'stub.js');
  const cfgFile = path.join(dir, 'cfg.json');
  const calls = path.join(dir, 'calls.jsonl');
  fs.writeFileSync(stub, STUB);
  fs.writeFileSync(cfgFile, JSON.stringify(stubCfg));
  fs.writeFileSync(calls, '');
  const r = cp.spawnSync(process.execPath, ['--require', stub, path.join(work, 'scripts', 'create-site.js')], {
    input: JSON.stringify({ siteId: `kw${label}`.slice(0, 12), siteUrl: 'https://brightpipes.test', industry: 'plumbing', location: 'Toronto, ON', language: 'en', homepageFingerprint: false, ...payload }),
    cwd: work, encoding: 'utf8', maxBuffer: 64 << 20, timeout: 300000,
    env: { ...process.env, ANTHROPIC_API_KEY: 'stub-not-used', KW_STUB_CFG: cfgFile, KW_STUB_CALLS: calls },
  });
  const events = (r.stdout || '').split('\n').filter(Boolean).map((l) => { try { return JSON.parse(l); } catch (e) { return { event: '(非 JSON)', raw: l }; } });
  const err = events.find((e) => e.event === 'error');
  const bad = err ? `建站报错 ${err.message}` : r.status !== 0 ? `rc=${r.status}` : null;
  if (bad && opts.soft) return { failed: `${bad}\n${(r.stderr || '').slice(-400)}` };
  if (bad) die(`${label}：${bad}\n${(r.stderr || '').slice(-800)}`);
  const callList = fs.readFileSync(calls, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
  const site = path.join(work, 'site');
  const readJson = (p) => JSON.parse(fs.readFileSync(path.join(site, p), 'utf8'));
  const loc = payload.language || 'en';
  const pagesDir = path.join(site, loc, 'pages');
  const pageFiles = [];
  (function walk(d, pre) {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      if (e.isDirectory()) walk(path.join(d, e.name), `${pre}${e.name}/`);
      else if (e.name.endsWith('.json')) pageFiles.push(`${pre}${e.name.replace(/\.json$/, '')}`);
    }
  })(pagesDir, '');
  const page = (slug) => readJson(`${loc}/pages/${slug}.json`);
  return { work, events, calls: callList, stderr: r.stderr || '', pageFiles, page, readJson, report: events.find((e) => e.event === 'keyword-pages') };
}
const kwCalls = (calls) => calls.filter((c) => c.kind === 'keyword-page');
const slugOf = (c) => (c.first.match(/- slug: "([^"]+)"/) || [])[1];
const blocksOf = (p) => p.blocks || p.sections || [];
const pagesRefOf = (p) => blocksOf(p).filter((b) => b.type === 'features' && b.data && b.data.items && b.data.items.source === 'pages').map((b) => b.data.items);

console.log('══ #1550 关键词页：真 AI 路（打桩）══');

// ── AC2 / AC3 / AC9：2 服务 × 3 个选中词，Call 1 不给详情页 ──────────────────────────────────────────
console.log('── AC2 / AC3 / AC9：2 服务，每服务主词外 3 个选中词，Call 1 一个详情页都不给');
const SVC2 = [{ id: 'drain-cleaning', name: 'Drain Cleaning' }, { id: 'water-heaters', name: 'Water Heaters' }];
const A = run('two', {
  companyName: 'Bright Pipes', services: SVC2.map((s) => s.name),
  keywords: {
    'Drain Cleaning': [primary('drain cleaning'), kw('drain cleaning markham'), kw('clogged drain repair'), kw('sewer line cleaning')],
    'Water Heaters': [primary('water heater repair'), kw('tankless water heater'), kw('hot water tank install'), kw('water heater leaking')],
  },
}, { call1: call1(SVC2) });
const A_KW = A.pageFiles.filter((s) => /^services\/[^/]+\/[^/]+$/.test(s));
check('AC2：6 个关键词页全在 /services/<id>/<slug>', () => {
  assert.deepStrictEqual(A_KW.sort(), [
    'services/drain-cleaning/clogged-drain-repair', 'services/drain-cleaning/drain-cleaning-markham', 'services/drain-cleaning/sewer-line-cleaning',
    'services/water-heaters/hot-water-tank-install', 'services/water-heaters/tankless-water-heater', 'services/water-heaters/water-heater-leaking',
  ]);
});
check('AC2 / AC9：Call 1 没给详情页 ⟹ 两个详情页由代码补出，各自列出 under = services/<id>', () => {
  assert.ok(!demoPages().some((p) => /^services\//.test(p.slug)), '阳性对照：桩的 Call 1 真的没给详情页');
  for (const s of SVC2) {
    const d = A.page(`services/${s.id}`);
    assert.strictEqual(d.serviceDetailPage, true);
    assert.deepStrictEqual(pagesRefOf(d), [{ source: 'pages', under: `services/${s.id}` }]);
  }
});
check('AC2：每个关键词页页尾有同服务兄弟页那一组（under = 本服务）', () => {
  for (const slug of A_KW) {
    const id = slug.split('/')[1];
    assert.deepStrictEqual(pagesRefOf(A.page(slug)), [{ source: 'pages', under: `services/${id}` }], slug);
  }
});
check('AC2：页脚含全部 6 页，每服务一栏、栏名是服务名', () => {
  const nav = A.readJson('en/navigation.json');
  const cols = nav.footer.columns.slice(1);
  assert.deepStrictEqual(cols.map((c) => c.title), ['Drain Cleaning', 'Water Heaters']);
  assert.deepStrictEqual(cols.flatMap((c) => c.links.map((l) => l.href.slice(1))).sort(), [...A_KW].sort());
});
check('AC2：建站结果报 6/6、6 行相似度、没有失败', () => {
  assert.strictEqual(A.report.total, 6);
  assert.strictEqual(A.report.ok, 6);
  assert.deepStrictEqual(A.report.failed, []);
  assert.strictEqual(A.report.similarity.length, 6);
  assert.ok(A.report.similarity.every((x) => typeof x.score === 'number' && x.mostSimilar), JSON.stringify(A.report.similarity[0]));
});
check('AC2：一页一次调用（6 通），Call 1 一通', () => {
  assert.strictEqual(kwCalls(A.calls).length, 6);
  assert.strictEqual(A.calls.filter((c) => c.kind === 'call1').length, 1);
  assert.strictEqual(A.calls.filter((c) => c.kind === 'other').length, 0);
});
check('关键词页挂上了自己的目标词（T4 的 seo.targetKeyword）', () => {
  assert.strictEqual(A.page('services/drain-cleaning/drain-cleaning-markham').seo.targetKeyword, 'drain cleaning markham');
  assert.strictEqual(A.page('services/drain-cleaning/drain-cleaning-markham').keywordPage, true);
});
check('AC3：同一个站跑 sync-config 之后，页脚导航不变', () => {
  const before = JSON.stringify(A.readJson('en/navigation.json').footer);
  const r = cp.spawnSync(process.execPath, [path.join(A.work, 'scripts', 'sync-config.js')], { cwd: A.work, encoding: 'utf8', timeout: 180000 });
  assert.strictEqual(r.status, 0, (r.stderr || r.stdout || '').slice(-600));
  assert.strictEqual(JSON.stringify(A.readJson('en/navigation.json').footer), before);
});
check('AC3：页脚那几栏删掉再让 sync-config 重建 ⟹ 跟建站时一模一样（两处是同一个函数）', () => {
  const nav = A.readJson('en/navigation.json');
  const before = JSON.stringify(nav.footer.columns);
  nav.footer.columns = nav.footer.columns.slice(0, 1);
  fs.writeFileSync(path.join(A.work, 'site', 'en', 'navigation.json'), JSON.stringify(nav, null, 2));
  const r = cp.spawnSync(process.execPath, [path.join(A.work, 'scripts', 'sync-config.js')], { cwd: A.work, encoding: 'utf8', timeout: 180000 });
  assert.strictEqual(r.status, 0, (r.stderr || '').slice(-600));
  assert.strictEqual(JSON.stringify(A.readJson('en/navigation.json').footer.columns), before);
});

// ── AC11：素材进了这一页那次调用的提示词 ────────────────────────────────────────────────────────────
console.log('── AC11：素材（字段名 = dashboard 送的 keywordMaterial）');
const SVC_P = [{ id: 'plumbing', name: 'Plumbing' }, { id: 'water-heaters', name: 'Water Heaters' }];
const M = run('mat', {
  companyName: 'Bright Pipes', services: SVC_P.map((s) => s.name),
  address: '2150 Yonge Street, Toronto', phone: '(416) 555-0199',
  reviews: [
    { author: 'Ann', rating: 5, text: 'They fixed our basement leak in Markham the same afternoon.' },
    { author: 'Bob', rating: 5, text: 'Great work, very tidy and on time.' },
  ],
  keywords: {
    Plumbing: [primary('plumbing'), kw('plumbing Markham'), kw('plumbing Toronto')],
    'Water Heaters': [primary('water heater repair'), kw('tankless water heater')],
  },
  keywordMaterial: {
    Plumbing: { questions: ['How much does a plumber cost in Ontario?'], unselected: ['plumber near me'] },
    'Water Heaters': { questions: ['How long do water heaters last?'], unselected: ['hot water tank rental'] },
  },
}, { call1: call1(SVC_P) });
const promptFor = (slug) => (kwCalls(M.calls).find((c) => slugOf(c) === slug) || { first: '' }).first;
const MARK = promptFor('services/plumbing/plumbing-markham');
const TOR = promptFor('services/plumbing/plumbing-toronto');
check('Markham 页的提示词：含 address、phone 原文', () => { assert.ok(MARK.includes('2150 Yonge Street, Toronto')); assert.ok(MARK.includes('(416) 555-0199')); });
check('Markham 页：含带 Markham 那条评价原文，不含不带地名那条', () => {
  assert.ok(MARK.includes('They fixed our basement leak in Markham the same afternoon.'));
  assert.ok(!MARK.includes('Great work, very tidy and on time.'));
});
check('Markham 页：含本服务组的问题 / 没勾的词，不含另一组的任何一条', () => {
  assert.ok(MARK.includes('How much does a plumber cost in Ontario?'));
  assert.ok(MARK.includes('plumber near me'));
  assert.ok(!MARK.includes('How long do water heaters last?'));
  assert.ok(!MARK.includes('hot water tank rental'));
});
check('Markham 页：含「服务介绍只写一句 + 链到服务页」', () => assert.ok(MARK.includes('describe Plumbing itself in ONE sentence only and link to its service page (/services/plumbing)')));
check('Toronto 页的提示词不含 Markham 那条评价', () => { assert.ok(TOR.length > 0, '没找到 Toronto 那一通'); assert.ok(!TOR.includes('They fixed our basement leak in Markham')); });

// ── AC5：一页拿不到合格结果 ─────────────────────────────────────────────────────────────────────────
console.log('── AC5：一页两次都不合格');
const BAD = 'services/drain-cleaning/clogged-drain-repair';
const F = run('fail', {
  companyName: 'Bright Pipes', services: SVC2.map((s) => s.name),
  keywords: {
    'Drain Cleaning': [primary('drain cleaning'), kw('drain cleaning markham'), kw('clogged drain repair'), kw('sewer line cleaning')],
    'Water Heaters': [primary('water heater repair'), kw('tankless water heater'), kw('hot water tank install'), kw('water heater leaking')],
  },
}, { call1: call1(SVC2), badAlways: [BAD] });
check('只有这一页被重试（2 通），别的 5 页各 1 通', () => {
  const counts = {};
  for (const c of kwCalls(F.calls)) counts[slugOf(c)] = (counts[slugOf(c)] || 0) + 1;
  assert.strictEqual(counts[BAD], 2);
  assert.deepStrictEqual(Object.entries(counts).filter(([s]) => s !== BAD).map(([, n]) => n), [1, 1, 1, 1, 1]);
  assert.ok(kwCalls(F.calls).some((c) => slugOf(c) === BAD && c.turns === 3), '重试那一通把问题退回给了它（3 轮对话）');
});
check('结果报 5/6，列出失败的词；那一页不在产物里', () => {
  assert.strictEqual(F.report.ok, 5);
  assert.strictEqual(F.report.total, 6);
  assert.deepStrictEqual(F.report.failed.map((x) => x.keyword), ['clogged drain repair']);
  assert.ok(!F.pageFiles.includes(BAD));
});
check('第一次不合格、重试合格 ⟹ 6/6（重试那一通的结果被收下）', () => {
  const G = run('retry', {
    companyName: 'Bright Pipes', services: ['Drain Cleaning'],
    keywords: { 'Drain Cleaning': [primary('drain cleaning'), kw('drain cleaning markham'), kw('sewer line cleaning')] },
  }, { call1: call1([SVC2[0]]), badFirst: ['services/drain-cleaning/sewer-line-cleaning'] });
  assert.strictEqual(G.report.ok, 2);
  assert.ok(G.pageFiles.includes('services/drain-cleaning/sewer-line-cleaning'));
});

// ── QA2 r1：seoPass（#1549）丢掉的关键词页 ⟹ 事件 / 相似度 / 页脚 / 详情页都按留下来的页算 ─────────────────────────
console.log('── QA2 r1：一页过得了块库、过不了 SEO（seoPass 丢掉它）');
const SEO_BAD = 'services/drain-cleaning/sewer-line-cleaning';
const D = run('seodrop', {
  companyName: 'Bright Pipes', services: SVC2.map((s) => s.name),
  keywords: {
    'Drain Cleaning': [primary('drain cleaning'), kw('drain cleaning markham'), kw('clogged drain repair'), kw('sewer line cleaning')],
    'Water Heaters': [primary('water heater repair'), kw('tankless water heater'), kw('hot water tank install'), kw('water heater leaking')],
  },
}, { call1: call1(SVC2), seoBad: [SEO_BAD] });
check('阳性对照：那一页只调了一次生成（过了块库），seoPass 带着问题修补过它一次（#1593 字段级）', () => {
  assert.strictEqual(kwCalls(D.calls).filter((c) => slugOf(c) === SEO_BAD).length, 1);
  assert.ok(D.calls.some((c) => c.kind === 'seo-fix' && c.first.includes(`\nPAGE: ${SEO_BAD}\n`)));
  assert.ok(D.stderr.includes(`[seo] 丢掉 ${SEO_BAD}：`), D.stderr.split('\n').filter((l) => l.startsWith('[seo]')).slice(-5).join('\n'));
});
check('事件报 5/6，失败清单里有它、带着它的 SEO 问题', () => {
  assert.strictEqual(D.report.total, 6);
  assert.strictEqual(D.report.ok, 5);
  assert.deepStrictEqual(D.report.failed.map((f) => f.slug), [SEO_BAD]);
  assert.ok(D.report.failed[0].problems.some((x) => /^\[\d /.test(x)), JSON.stringify(D.report.failed[0].problems));
});
check('seo-check 事件与 keyword-pages 事件说同一个数（5/6）', () => {
  const ev = D.events.filter((e) => e.event === 'seo-check' && e.keywordPages && e.keywordPages.total);
  assert.deepStrictEqual(ev.map((e) => [e.keywordPages.ok, e.keywordPages.total]), [[5, 6]]);
});
check('那页不在站里；相似度 5 行，没有一行是它、也没有一行说「最像它」', () => {
  assert.ok(!D.pageFiles.includes(SEO_BAD));
  assert.strictEqual(D.report.similarity.length, 5);
  assert.ok(D.report.similarity.every((x) => x.slug !== SEO_BAD && x.mostSimilar !== SEO_BAD), JSON.stringify(D.report.similarity));
});
check('页脚：Drain Cleaning 那栏 2 条、不含它；合计 5 条', () => {
  const cols = D.readJson('en/navigation.json').footer.columns.slice(1);
  const dc = cols.find((c) => c.title === 'Drain Cleaning');
  assert.deepStrictEqual(dc.links.map((l) => l.href).sort(), ['/services/drain-cleaning/clogged-drain-repair', '/services/drain-cleaning/drain-cleaning-markham']);
  assert.strictEqual(cols.flatMap((c) => c.links).length, 5);
});

// ── QA2 r2：关键词页生成时不合格、seoPass 重写后合格 ⟹ 它留下来了，五处都要算它 ───────────────────────────────
console.log('── QA2 r2：两页被 SEO 重写救回来、一页被丢掉');
const LATE = ['services/drain-cleaning/drain-cleaning-markham', 'services/water-heaters/tankless-water-heater'];
const G = run('seolate', {
  companyName: 'Bright Pipes', services: SVC2.map((s) => s.name),
  keywords: {
    'Drain Cleaning': [primary('drain cleaning'), kw('drain cleaning markham'), kw('clogged drain repair'), kw('sewer line cleaning')],
    'Water Heaters': [primary('water heater repair'), kw('tankless water heater'), kw('hot water tank install'), kw('water heater leaking')],
  },
}, { call1: call1(SVC2), seoLate: LATE, seoBad: [SEO_BAD] });
const G_KEPT = ['services/drain-cleaning/clogged-drain-repair', 'services/drain-cleaning/drain-cleaning-markham',
  'services/water-heaters/hot-water-tank-install', 'services/water-heaters/tankless-water-heater', 'services/water-heaters/water-heater-leaking'];
check('阳性对照：那两页确实被修补过、修补后 0 条问题；那一页被丢掉', () => {
  const lines = G.stderr.split('\n');
  for (const slug of LATE) {
    assert.ok(G.calls.some((c) => c.kind === 'seo-fix' && c.first.includes(`\nPAGE: ${slug}\n`)), slug);
    assert.ok(lines.some((l) => l.startsWith(`[seo] 修补一次后 ${slug} `) && l.endsWith('0 条问题')), slug);
  }
  assert.ok(lines.some((l) => l.startsWith(`[seo] 丢掉 ${SEO_BAD}：`)));
});
check('① 事件 5/6，失败清单只有被丢的那一页', () => {
  assert.deepStrictEqual([G.report.ok, G.report.total], [5, 6]);
  assert.deepStrictEqual(G.report.failed.map((f) => f.slug), [SEO_BAD]);
});
check('② 相似度 5 行 = 留下来的 5 页（含被救回的两页）', () => {
  assert.deepStrictEqual(G.report.similarity.map((x) => x.slug).sort(), G_KEPT);
});
check('③ 页脚：两栏合计 = 留下来的 5 页', () => {
  const links = G.readJson('en/navigation.json').footer.columns.slice(1).flatMap((c) => c.links.map((l) => l.href.slice(1)));
  assert.deepStrictEqual(links.sort(), G_KEPT);
});
check('④ 盘上 5 页每页都有兄弟页那一组（含被救回的两页，以及「唯一兄弟被救回」的那页）', () => {
  const onDisk = G.pageFiles.filter((x) => /^services\/[^/]+\/[^/]+$/.test(x)).sort();
  assert.deepStrictEqual(onDisk, G_KEPT);
  for (const slug of G_KEPT) assert.deepStrictEqual(pagesRefOf(G.page(slug)), [{ source: 'pages', under: `services/${slug.split('/')[1]}` }], slug);
});
check('⑤ seo-check 与 keyword-pages 两个事件说同一个数', () => {
  const ev = G.events.filter((e) => e.event === 'seo-check' && e.keywordPages && e.keywordPages.total);
  assert.deepStrictEqual(ev.map((e) => [e.keywordPages.ok, e.keywordPages.total]), [[G.report.ok, G.report.total]]);
});

console.log('── 一个服务下的关键词页全被 seoPass 丢掉');
const E = run('seoempty', {
  companyName: 'Bright Pipes', services: SVC2.map((s) => s.name),
  keywords: {
    'Drain Cleaning': [primary('drain cleaning'), kw('drain cleaning markham'), kw('clogged drain repair')],
    'Water Heaters': [primary('water heater repair'), kw('tankless water heater'), kw('water heater leaking')],
  },
}, { call1: call1(SVC2), seoBad: ['services/water-heaters/tankless-water-heater', 'services/water-heaters/water-heater-leaking'] });
check('那个服务（Call 1 没给详情页）不补详情页、页脚没有它那一栏；另一个服务照常', () => {
  assert.ok(!E.pageFiles.includes('services/water-heaters'), E.pageFiles.join(' '));
  assert.ok(E.pageFiles.includes('services/drain-cleaning'));
  assert.deepStrictEqual(E.readJson('en/navigation.json').footer.columns.slice(1).map((c) => c.title), ['Drain Cleaning']);
  assert.strictEqual(E.report.ok, 2);
  assert.strictEqual(E.report.total, 4);
});
check('没被补的那张详情页不进 seoPass（日志里没有它的「检查」行）', () => {
  assert.ok(!E.stderr.split('\n').some((l) => l.startsWith('[seo] 检查 services/water-heaters ')), '它不该被检查');
  assert.ok(E.stderr.split('\n').some((l) => l.startsWith('[seo] 检查 services/drain-cleaning ')), '阳性对照：补出来的那张被检查了');
});

console.log('── 挂 Brand 的 Lead：补的那个服务下的关键词页全被 seoPass 丢掉');
const BRAND3x = [{ id: 'drain-cleaning', name: 'Drain Cleaning' }, { id: 'water-heaters', name: 'Water Heaters' }, { id: 'leak-repair', name: 'Leak Repair' }];
const LE = run('leadempty', {
  companyName: 'Bright Pipes', siteType: 'lead', keyword: 'plumbing', services: BRAND3x.map((s) => s.name),
  keywords: { plumbing: [primary('plumbing'), kw('plumbing markham'), kw('plumbing toronto')] },
}, { call1: call1(BRAND3x), seoBad: ['services/plumbing/plumbing-markham', 'services/plumbing/plumbing-toronto'] });
// 📌 seo.json 的 targetKeywords.byService 里照样有 `plumbing` 这个键：对不上服务的组按**组名**记（T4 #1548 的既有规矩），
//    跟有没有补出服务无关，所以这里不量它。
check('PM ① 约束 1：补的服务撤掉（服务目录、详情页、建站结果都没有 plumbing）', () => {
  assert.ok(!LE.readJson('en/services.json').some((x) => x.id === 'plumbing'), JSON.stringify(LE.readJson('en/services.json').map((x) => x.id)));
  assert.ok(!LE.pageFiles.some((x) => x.startsWith('services/plumbing')), LE.pageFiles.join(' '));
  assert.deepStrictEqual(LE.report.addedServices, []);
  assert.strictEqual(LE.report.ok, 0);
  assert.strictEqual(LE.report.total, 2);
});

// 📌 #1593 起 SEO 修补是字段级的：列表那一组（items 引用）不是文字，按构造不进修补提示词、修补也写不坏它。
//    这一跑留着当回归：详情页修补过之后，那一组仍指着 under = services/<id>。
console.log('── seoPass 修补过的详情页，「下面的关键词页」那组仍是引用');
const RF = run('refdrop', {
  companyName: 'Bright Pipes', services: SVC2.map((s) => s.name),
  keywords: { 'Drain Cleaning': [primary('drain cleaning'), kw('drain cleaning markham'), kw('clogged drain repair')] },
}, { call1: call1(SVC2) });
check('阳性对照：详情页确实被修补过，修补提示词里没有列表那一组的引用', () => {
  const fix = RF.calls.find((c) => c.kind === 'seo-fix' && c.first.includes('\nPAGE: services/drain-cleaning\n'));
  assert.ok(fix);
  assert.ok(!fix.first.includes('"under"') && !fix.first.includes('"source"'), fix.first.slice(0, 600));
});
check('收尾把「下面的关键词页」那组指回 under = services/drain-cleaning', () => {
  assert.deepStrictEqual(pagesRefOf(RF.page('services/drain-cleaning')), [{ source: 'pages', under: 'services/drain-cleaning' }]);
});

// ── AC4：一个服务 12 个选中词 ─────────────────────────────────────────────────────────────────────
console.log('── AC4：一个服务主词外 12 个选中词');
const TWELVE = Array.from({ length: 12 }, (_, i) => kw(`drain cleaning area ${i + 1}`));
const T = run('twelve', {
  companyName: 'Bright Pipes', services: ['Drain Cleaning'],
  keywords: { 'Drain Cleaning': [primary('drain cleaning'), ...TWELVE] },
}, { call1: call1([SVC2[0]]) });
check('页脚那一栏 10 条，第 10 条是「All 12 pages →」链到服务详情页', () => {
  const col = T.readJson('en/navigation.json').footer.columns[1];
  assert.strictEqual(col.links.length, 10);
  assert.deepStrictEqual(col.links[9], { label: 'All 12 pages →', href: '/services/drain-cleaning' });
});
check('详情页列出它下面的全部关键词页（引用写法，构建时展开；12 页都在 services/drain-cleaning/ 下）', () => {
  assert.deepStrictEqual(pagesRefOf(T.page('services/drain-cleaning')), [{ source: 'pages', under: 'services/drain-cleaning' }]);
  assert.strictEqual(T.pageFiles.filter((s) => s.startsWith('services/drain-cleaning/')).length, 12);
});

// ── AC7：中文服务名 + 中文关键词 ───────────────────────────────────────────────────────────────────
console.log('── AC7：中文服务名 + 中文关键词');
const Z = run('zh', {
  companyName: '明亮水管', services: ['疏通下水道'], language: 'zh',
  keywords: { '疏通下水道': [primary('疏通下水道'), kw('万锦 疏通下水道'), kw('厨房 堵塞')] },
}, { call1: call1([{ id: 'drain-unclog', name: '疏通下水道' }]) });
check('URL 是拼音，挂在它自己的 /services/<id> 下；详情页在', () => {
  assert.ok(Z.pageFiles.includes('services/drain-unclog/wan-jin-shu-tong-xia-shui-dao'), Z.pageFiles.join(' '));
  assert.ok(Z.pageFiles.includes('services/drain-unclog/chu-fang-du-sai'));
  assert.ok(Z.pageFiles.includes('services/drain-unclog'));
});
// 兄弟页那一组加在 seoPass 之后，标签原样；详情页上那组是 seoPass 之前补的，重写可能把关键词加进这个 H2（第 7 条），只要求还带着标签。
check('中文站的「相关页面」标签', () => {
  const kwSlug = Z.pageFiles.find((x) => x.startsWith('services/drain-unclog/'));
  assert.strictEqual(Z.page(kwSlug).blocks.find((b) => b.type === 'features' && b.data.items.source === 'pages').data.headline, '相关页面');
  assert.match(Z.page('services/drain-unclog').blocks.find((b) => b.type === 'features' && b.data.items.source === 'pages').data.headline, /相关页面/);
});

// ── PM ①：挂 Brand 的 Lead ─────────────────────────────────────────────────────────────────────────
console.log('── PM ①(b)：挂 Brand 的 Lead（Brand 3 个服务，组名是 Lead 主词）');
const BRAND3 = [{ id: 'drain-cleaning', name: 'Drain Cleaning' }, { id: 'water-heaters', name: 'Water Heaters' }, { id: 'leak-repair', name: 'Leak Repair' }];
const L = run('lead', {
  companyName: 'Bright Pipes', siteType: 'lead', keyword: 'plumbing', services: BRAND3.map((s) => s.name),
  keywords: { plumbing: [primary('plumbing'), kw('plumbing markham'), kw('plumbing toronto')] },
}, { call1: call1(BRAND3) });
check('补了一个服务 {id: plumbing, name: plumbing}；关键词页挂在 /services/plumbing/ 下；详情页在', () => {
  const svcs = L.readJson('en/services.json');
  const added = svcs.find((s) => s.id === 'plumbing');
  assert.ok(added, svcs.map((s) => s.id).join(' '));
  assert.strictEqual(added.name, 'plumbing');
  assert.ok(L.pageFiles.includes('services/plumbing/plumbing-markham'));
  assert.ok(L.pageFiles.includes('services/plumbing'));
  assert.deepStrictEqual(L.report.addedServices, [{ id: 'plumbing', name: 'plumbing' }]);
});
check('PM ① 约束 1：那组的关键词页一页都没成 ⟹ 不补服务、不补详情页', () => {
  const L2 = run('lead0', {
    companyName: 'Bright Pipes', siteType: 'lead', keyword: 'plumbing', services: BRAND3.map((s) => s.name),
    keywords: { plumbing: [primary('plumbing'), kw('plumbing markham')] },
  }, { call1: call1(BRAND3), badAlways: ['services/plumbing/plumbing-markham'] });
  assert.ok(!L2.readJson('en/services.json').some((s) => s.id === 'plumbing'));
  assert.ok(!L2.pageFiles.includes('services/plumbing'));
  assert.strictEqual(L2.report.ok, 0);
});

// ── 转写不了的词 ─────────────────────────────────────────────────────────────────────────────────
console.log('── 转写表里没有的文字');
check('日文假名词 ⟹ kw-<序号>，列在建站结果里', () => {
  const J = run('kana', {
    companyName: 'Bright Pipes', services: ['Drain Cleaning'],
    keywords: { 'Drain Cleaning': [primary('drain cleaning'), kw('drain cleaning markham'), kw('すいどう しゅうり')] },
  }, { call1: call1([SVC2[0]]) });
  // #1569 r3：假名之间的空格在建站入口被去掉（§lib/cjk-spaces.js，不分站的语言）⟹ 落盘的词是并过的那份
  assert.deepStrictEqual(J.report.fallbackSlugs, [{ keyword: 'すいどうしゅうり', slug: 'services/drain-cleaning/kw-2' }]);
  assert.ok(J.pageFiles.includes('services/drain-cleaning/kw-2'));
});

// ── #1563：关键词太长 ⟹ 换短 slug，不许整站失败 ────────────────────────────────────────────────────────
// 例子词 `装` × 36：一个字转成 `zhuang-`（7 字节，转写表里每个字的上界），36 个字 ⟹ 251 字节的 slug，`<slug>.json` 越过
// 单个文件名 255 字节的上限；而 36 个字又放得进标题（#1549 第 1 条：标题含目标词且 ≤ 60 字），这一页真的走到写盘。
// 🔴 品牌名要 ≤ 21 个字（子页标题预算 = 60 − 3 − 品牌名），否则那一页先被 #1549 丢掉，读到一个跟文件名无关的 rc=0。
// 两条路都喂得进来：① 加词框 → 关键词页的 slug   ② Lead 主词框 → 组名对不上服务 ⟹ 补出来的服务 id（`services/<id>.json`）。
// 更长的词（63 个汉字 / 251 个拉丁字符）放不进标题、到不了写盘，留在 lib/keyword-slug.test.js（AC1b）。
console.log('── #1563 AC1：超长关键词（`装` × 36 = 251 字节的 slug）');
const ZHUANG36 = '装'.repeat(36);
const nameBytesOk = (files) => files.every((f) => f.split('/').every((seg) => Buffer.byteLength(`${seg}.json`) <= 255));
const LK = run('longkw', {
  companyName: 'Bright Pipes', services: ['Drain Cleaning'],
  keywords: { 'Drain Cleaning': [primary('drain cleaning'), kw(ZHUANG36), kw('drain cleaning markham')] },
}, { call1: call1([SVC2[0]]) }, { soft: true });
check('AC1 ①：加词框那条 —— 建站 rc=0，那个长词有一张关键词页，所有页面文件名都写得下', () => {
  assert.ok(!LK.failed, LK.failed);
  const kwFiles = LK.pageFiles.filter((f) => f.startsWith('services/drain-cleaning/'));
  assert.strictEqual(kwFiles.length, 2, JSON.stringify(LK.report.failed).slice(0, 800));
  assert.ok(nameBytesOk(LK.pageFiles), kwFiles.map((f) => Buffer.byteLength(f)).join(' '));
  assert.strictEqual(LK.report.ok, 2);
  assert.ok(LK.pageFiles.includes('services/drain-cleaning'), '详情页在');
});
check('AC1 ①：被截断的只有网址 —— 那一页的标题和目标词还是用户打的全文', () => {
  assert.ok(!LK.failed, LK.failed);
  const f = LK.pageFiles.find((x) => x.startsWith('services/drain-cleaning/zhuang-'));
  assert.ok(f, LK.pageFiles.join(' '));
  assert.ok(Buffer.byteLength(f.split('/').pop()) < Buffer.byteLength('zhuang-'.repeat(36)) - 1, '阳性对照：网址真的被截了');
  assert.strictEqual(LK.page(f).seo.targetKeyword, ZHUANG36);
  assert.ok(LK.page(f).title.includes(ZHUANG36), LK.page(f).title);
});
const LL = run('longlead', {
  companyName: 'Bright Pipes', siteType: 'lead', keyword: ZHUANG36, services: BRAND3.map((s) => s.name),
  keywords: { [ZHUANG36]: [primary(ZHUANG36), kw('plumbing markham')] },
}, { call1: call1(BRAND3) }, { soft: true });
check('AC1 ②：Lead 主词那条 —— 组对不上服务 ⟹ 补出来的服务 id 收在上限里，建站 rc=0、详情页和关键词页都在', () => {
  assert.ok(!LL.failed, LL.failed);
  assert.strictEqual(LL.report.addedServices.length, 1, JSON.stringify(LL.report));
  const id = LL.report.addedServices[0].id;
  assert.ok(Buffer.byteLength(`${id}.json`) <= 255, `${Buffer.byteLength(id)}`);
  assert.ok(LL.pageFiles.includes(`services/${id}`), LL.pageFiles.join(' '));
  assert.ok(LL.pageFiles.includes(`services/${id}/plumbing-markham`));
  assert.ok(nameBytesOk(LL.pageFiles));
  assert.strictEqual(LL.report.addedServices[0].name, ZHUANG36, '服务名还是用户打的全文');
});

// ── #1565：AI 写的服务 id 太长 ⟹ 收进上限，不许整站失败 ───────────────────────────────────────────────
// 向导的服务名框（改前）只限条数不限长度；AI 按提示词把服务名转成 kebab-case 的 id，代码据此落 `pages/services/<id>.json`。
// 桩回一个 300 字节的 id（真 AI 读数拿不到：#1499 不许 agent 调真 AI），Call 1 自己给一个详情页、正文里链回它，
// 外加一个关键词页 ⟹ `services/<id>.json` 和 `services/<id>/` 两样都要写。
console.log('── #1565：AI 写的服务 id 300 字节');
const LONG_NAME = `${'Drain Cleaning '.repeat(20)}`.trim();                       // 299 个字符的服务名
const LONG_ID = `${LONG_NAME.toLowerCase().replace(/ /g, '-')}s`;                   // AI 照全文转的 kebab-case（+1 字节凑整），300 字节
const LONG_SVC = { id: LONG_ID, name: LONG_NAME };
const longDetail = {
  slug: `services/${LONG_ID}`, title: 'Drain cleaning', description: 'Drain cleaning in Toronto by Bright Pipes. Fast local help and a clear written price before we start.',
  navLabel: 'Drain cleaning', navOrder: 10, changeFrequency: 'monthly', priority: 0.8, serviceDetailPage: true, parentService: LONG_ID,
  sections: [
    { type: 'page-header', data: { headline: 'Drain cleaning' } },
    { type: 'content', data: { headline: 'Drain cleaning: what we do', body: 'Drain cleaning across Toronto.' } },
    { type: 'cta', data: { headline: 'Drain cleaning: book now', body: 'Call today.', ctas: [{ label: 'This service', href: `/services/${LONG_ID}` }] } },
  ],
};
const LS = run('longsvc', {
  companyName: 'Bright Pipes', services: [LONG_NAME],
  keywords: { [LONG_NAME]: [primary('drain cleaning'), kw('drain cleaning markham')] },
}, { call1: call1([LONG_SVC], [longDetail]) }, { soft: true });
check('AC2：AI 回 300 字节的服务 id —— 建站 rc=0，详情页和关键词页都写出来，全部页面文件名都写得下', () => {
  assert.strictEqual(Buffer.byteLength(LONG_ID), 300, '阳性对照：喂进去的 id 真是 300 字节');
  assert.ok(!LS.failed, LS.failed);
  const svc = LS.readJson('en/services.json')[0];
  assert.ok(Buffer.byteLength(svc.id) <= SLUG_MAX_BYTES_E2E, `${Buffer.byteLength(svc.id)}`);
  assert.ok(LS.pageFiles.includes(`services/${svc.id}`), LS.pageFiles.join(' '));
  assert.ok(LS.pageFiles.includes(`services/${svc.id}/drain-cleaning-markham`), LS.pageFiles.join(' '));
  assert.ok(nameBytesOk(LS.pageFiles));
});
check('AC2：被截的只有网址 —— 服务名还是全文；AI 给的详情页挂到新 id 上，parentService 和正文链接跟着改', () => {
  assert.ok(!LS.failed, LS.failed);
  const svc = LS.readJson('en/services.json')[0];
  assert.strictEqual(svc.name, LONG_NAME);
  const d = LS.page(`services/${svc.id}`);
  assert.strictEqual(d.parentService, svc.id);
  assert.ok(JSON.stringify(d).includes(`"/services/${svc.id}"`), '正文里那条链接指着新 id');
  assert.ok(!LS.pageFiles.some((f) => f.includes(LONG_ID)), '旧 id 不在任何页面路径里');
});

// 顶格：一整个没有连字符的词只能硬截 ⟹ id 正好落在上限上（AC3 拿这棵树真跑 next build：最长单段文件名 = id + `.segments` = 255）。
const TOP_ID = 'd'.repeat(300);
const LT = run('longtop', {
  companyName: 'Bright Pipes', services: [LONG_NAME],
  keywords: { [LONG_NAME]: [primary('drain cleaning'), kw('drain cleaning markham')] },
}, { call1: JSON.parse(JSON.stringify(call1([LONG_SVC], [longDetail])).split(LONG_ID).join(TOP_ID)) }, { soft: true });
check('AC2：300 字节、没有连字符的 id ⟹ 硬截到正好上限（顶格），建站 rc=0', () => {
  assert.ok(!LT.failed, LT.failed);
  const svc = LT.readJson('en/services.json')[0];
  assert.strictEqual(svc.id, 'd'.repeat(SLUG_MAX_BYTES_E2E));
  assert.ok(LT.pageFiles.includes(`services/${svc.id}`) && LT.pageFiles.includes(`services/${svc.id}/drain-cleaning-markham`), LT.pageFiles.join(' '));
});

// ── #1566：顶格 slug 拼出来的图片文件名放不下 ⟹ 收进上限，那一页的图一张不掉 ──────────────────────────
// 生图那一通打桩回假图（cfg.images）。读数取 create-site 自己打的逐槽日志（`[photo-slot] 填上 / 没拿到图 —— 页面 <slug>`）
// 和盘上的 public/photos/。改前（2cac58e30）同一份输入：这一页 success 0、每条原因 ENAMETOOLONG。
console.log('── #1566：顶格 slug 的那一页，图片文件名放得下');
const IMG_FEATURES = { type: 'features', data: { headline: 'Drain cleaning: why us', items: [{ title: 'Fast', text: 'Same day.' }, { title: 'Clear', text: 'Written price.' }, { title: 'Tidy', text: 'We clean up.' }] } };
function photoReport(R, slug) {
  const lines = R.stderr.split('\n');
  const mine = (tag) => lines.filter((l) => l.startsWith(`[photo-slot] ${tag} —— 页面 ${slug} · `));
  const filled = mine('填上');
  const missed = mine('没拿到图');
  const reasons = missed.map((l) => (l.match(/原因: (.*)$/) || [])[1] || '?');
  const dir = path.join(R.work, 'public', 'photos');
  const files = fs.existsSync(dir) ? fs.readdirSync(dir) : [];
  return { attempted: filled.length + missed.length, success: filled.length, reasons, files, longest: Math.max(0, ...files.map((f) => Buffer.byteLength(f))) };
}
const reasonsLine = (r) => `attempted ${r.attempted} · success ${r.success} · 原因 ${JSON.stringify([...new Set(r.reasons.map((x) => x.split(':')[0]))])}`;

const IMG_TOP = 'd'.repeat(SLUG_MAX_BYTES_E2E);
const imgDetail = { ...longDetail, sections: [...longDetail.sections.slice(0, 2), IMG_FEATURES, longDetail.sections[2]] };
const IT = run('imgtop', {
  companyName: 'Bright Pipes', services: [LONG_NAME], geminiApiKey: 'stub-not-used',
  keywords: { [LONG_NAME]: [primary('drain cleaning'), kw('drain cleaning markham')] },
}, { images: true, call1: JSON.parse(JSON.stringify(call1([LONG_SVC], [imgDetail])).split(LONG_ID).join(TOP_ID)) }, { soft: true });
check('#1566 AC1：服务 id 顶格 ⟹ 详情页每个图槽都填上、盘上每个文件名放得下（≤ FILENAME_MAX_BYTES）', () => {
  assert.ok(!IT.failed, IT.failed);
  const svc = IT.readJson('en/services.json')[0];
  assert.strictEqual(svc.id, IMG_TOP, '阳性对照：id 真顶到了上限');
  const r = photoReport(IT, `services/${IMG_TOP}`);
  console.log(`     详情页 services/<顶格 id>：${reasonsLine(r)} · photos/ 里最长文件名 ${r.longest} 字节`);
  assert.ok(r.attempted >= 3, `这一页至少 3 个图槽（读到 ${r.attempted}）`);
  assert.strictEqual(r.success, r.attempted, reasonsLine(r));
  assert.ok(r.longest > 0 && r.longest <= FILENAME_MAX_BYTES, `${r.longest}`);
});

// 📌 关键词页那种 pageSlug 形状（`services/<短 id>/<顶格词 slug>`）不在这里跑整站：关键词页今天不求图（`fillImageSlots`
//    只在 Call 1 的 generateSlotPhotos 与 skipAI 里调），整站跑那一页按构造读 `attempted 0`。它在
//    lib/image-slots.test.js ⑩ 直接驱动 slotKey 验（#1566 r2 AC2，PM 裁定）。

// ── #1569 r2：中文站、老板没填 Address ⟹ 地址那一格是原样的地点，不是双语串 ──────────────────────────────
// 地址不填时 Call 1 让 AI 把地点抄进 brand.locations[0].address，那一格之后要拿去查坐标（OSM 查双语串 0 条 ⟹ 地图 / 页脚城市 /
// 结构化数据的街道邮编全没了，PM r1 验收实测）。给 AI 当背景的那几行（Primary Location / 重写提示词）仍是双语。
console.log('── #1569 r2：中文站不填 Address，地址兜底用原样地点');
const ZH_LOC = { location: 'Toronto, Ontario, Canada', locationLocalized: '多伦多, 安大略省, 加拿大' };
const ZA = run('zhaddr', { companyName: 'Bright Pipes', language: 'zh', services: ['Plumbing'], ...ZH_LOC }, { call1: call1([{ id: 'plumbing', name: 'Plumbing' }]) });
const zaCall1 = (ZA.calls.find((c) => c.kind === 'call1') || { first: '' }).first;
check('#1569 r2：Call 1 地址那一格 = 原样地点（Toronto, Ontario, Canada）', () => {
  assert.ok(zaCall1, '没抓到 Call 1');
  assert.ok(zaCall1.includes('"address": "Toronto, Ontario, Canada"'), (zaCall1.match(/"address": "[^"]*"/) || ['(无 address 行)'])[0]);
});
check('#1569 r2：给 AI 的背景仍是双语（Primary Location）', () => {
  assert.ok(zaCall1.includes('- Primary Location: 多伦多, 安大略省, 加拿大 (Toronto, Ontario, Canada)'), (zaCall1.match(/- Primary Location: [^\n]*/) || ['(无)'])[0]);
});
const ZB = run('zhaddr2', { companyName: 'Bright Pipes', language: 'zh', services: ['Plumbing'], address: '2150 Yonge Street, Toronto', ...ZH_LOC }, { call1: call1([{ id: 'plumbing', name: 'Plumbing' }]) });
check('#1569 r2：填了 Address 时照旧用它', () => {
  const first = (ZB.calls.find((c) => c.kind === 'call1') || { first: '' }).first;
  assert.ok(first.includes('"address": "2150 Yonge Street, Toronto"'), (first.match(/"address": "[^"]*"/) || ['(无)'])[0]);
});

// ── #1569 r3：中文站、英文服务名 + 翻译种子 ⟹ 服务详情页的目标词是翻译种子，词里汉字之间没有空格 ─────────────
// Chris 2026-10-05 site-ea408218：向导存下的组是「英文服务名(主词) + 剪 发(translated-seed) + 剪 发 店」，服务页的目标词仍是英文
// ⟹ T5 第 2 / 7 条逼 AI 往中文描述和 H2 里塞英文词；「剪 发」原样进了标题。这一格走真建站进程，验 main 里那一处替换真的接上了。
console.log('── #1569 r3：中文站的服务主词换成翻译种子、去汉字间空格');
const ZT = run('zhseed', {
  companyName: 'Bright Pipes', language: 'zh', services: ['Drain Cleaning'], ...ZH_LOC,
  keywords: { 'Drain Cleaning': [primary('drain cleaning'), kw('疏通 下水道', { source: 'translated-seed' }), kw('疏通 下水道 公司', { source: 'autocomplete' })] },
}, { call1: call1([{ id: 'drain-cleaning', name: 'Drain Cleaning' }]) });
check('#1569 r3：服务详情页的目标词 = 翻译种子（去了空格）', () => {
  assert.strictEqual(ZT.page('services/drain-cleaning').seo.targetKeyword, '疏通下水道');
});
check('#1569 r3：被换下的英文主词不建关键词页；联想词那页的词也去了空格', () => {
  const kwPages = ZT.pageFiles.filter((f) => f.startsWith('services/drain-cleaning/'));
  assert.deepStrictEqual(kwPages.map((f) => ZT.page(f).seo.targetKeyword), ['疏通下水道公司'], kwPages.join(' '));
});
check('#1569 r3：seo.json 里这组的主词是翻译种子，英文那条降为非主词', () => {
  const g = ZT.readJson('zh/seo.json').targetKeywords.byService['Drain Cleaning'] || ZT.readJson('zh/seo.json').targetKeywords.byService['drain-cleaning'];
  assert.ok(g, JSON.stringify(ZT.readJson('zh/seo.json').targetKeywords));
  assert.deepStrictEqual(g.filter((k) => k.isPrimary).map((k) => k.keyword), ['疏通下水道'], JSON.stringify(g));
  assert.ok(g.every((k) => !/[\u4e00-\u9fff]\s+[\u4e00-\u9fff]/.test(k.keyword)), JSON.stringify(g));
});

// ── #1600 建站报告：真 AI 路（打桩）上 seo / repair / keywordPages 三格是真数，并且与同一次建站的事件逐项一致 ──────────
// 用上面 G 那一跑（两页被 SEO 重写救回、一页被丢掉）：三种结局（pass / fixed / dropped）都在同一份报告里。
console.log('── #1600 建站报告（G：两页重写救回、一页丢掉）');
const BR_KEYS = require('./lib/build-report').REPORT_KEYS;
const brOf = (R) => JSON.parse(fs.readFileSync(path.join(R.work, 'site', 'build-report.json'), 'utf8'));
const GR = brOf(G);
check('#1600：site/build-report.json 九个键都在；path=ai；死链（entrypoint 才并进来）与没有生产者的四格是 null', () => {
  assert.deepStrictEqual(BR_KEYS.filter((k) => !(k in GR)), []);
  assert.strictEqual(GR.path, 'ai');
  for (const k of ['deadLinks', 'lighthouse', 'stages', 'images', 'degraded', 'archive']) assert.strictEqual(GR[k], null, k);
  assert.ok(Number.isInteger(GR.durationSec) && GR.durationSec >= 0, String(GR.durationSec));
});
check('#1600：keywordPages 与 keyword-pages 事件逐项相同（5/6，失败的就是被丢的那一页）', () => {
  assert.deepStrictEqual([GR.keywordPages.ok, GR.keywordPages.total], [G.report.ok, G.report.total]);
  assert.deepStrictEqual(GR.keywordPages.failed.map((f) => [f.keyword, f.slug]), G.report.failed.map((f) => [f.keyword, f.slug]));
});
check('#1600：repair = 全部 seo-check 事件的 rewritten / pages 之和（seoPass 可能跑两次）', () => {
  const ev = G.events.filter((e) => e.event === 'seo-check');
  assert.ok(ev.length >= 1);
  assert.deepStrictEqual([GR.repair.rewritten, GR.repair.pages],
    [ev.reduce((a, e) => a + e.rewritten, 0), ev.reduce((a, e) => a + e.pages, 0)]);
  assert.ok(GR.repair.rewritten >= LATE.length, JSON.stringify(GR.repair));
});
check('#1600：被丢的那页 outcome=dropped、最后没过的条目是 fail；救回的两页 outcome=fixed、没有一条 fail', () => {
  const by = new Map(GR.seo.pages.map((p) => [p.slug, p]));
  const bad = by.get(SEO_BAD);
  assert.ok(bad, '报告里没有被丢的那一页');
  assert.strictEqual(bad.outcome, 'dropped');
  const failedRules = Object.keys(bad.checks).filter((n) => bad.checks[n] === 'fail');
  const fromProblems = [...new Set(bad.problems.map((x) => (x.match(/^\[(\d)/) || [])[1]))].sort();
  assert.ok(failedRules.length > 0);
  assert.deepStrictEqual(failedRules.sort(), fromProblems);
  for (const slug of LATE) {
    const p = by.get(slug);
    assert.strictEqual(p.outcome, 'fixed', slug);
    assert.strictEqual(p.rewritten, true, slug);
    assert.ok(Object.values(p.checks).includes('fixed') && !Object.values(p.checks).includes('fail'), JSON.stringify(p.checks));
  }
});
check('#1600 阳性对照：一页没出过问题的页八条里没有 fixed / fail', () => {
  const clean = GR.seo.pages.find((p) => p.outcome === 'pass');
  assert.ok(clean, '没有一页是 pass —— 夹具变了');
  assert.ok(Object.values(clean.checks).every((c) => c === 'pass' || c === 'n/a'), JSON.stringify(clean.checks));
});

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
