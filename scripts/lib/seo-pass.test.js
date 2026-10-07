#!/usr/bin/env node
/**
 * seo-pass.test.js — 打桩建站：create-site.js 的每页 SEO 检查真的跑了、修补一次、按页面类型处置（#1549）。
 * #1593 起修补是字段级的（只带出问题的字段、只回那几个字段），缺地点在检查之前由代码补；第二语言也按自己的 locale 查一遍。
 *
 * 跑法:  node scripts/lib/seo-pass.test.js   （或 `npm run test:scripts`，它按文件名发现）
 * 退出码: 0 全过 · 1 有失败 · 2 跑不起来（**不许当成通过**）
 *
 * 🔴 为什么是打桩、不是 skipAI：skipAI 走 `getDemoConfig` 的写死页，不经生成也不经 seoProblems ⟹ 量到的是演示夹具。
 *    这里走**真的 create-site.js 主路径**，只把 `@anthropic-ai/sdk` 换成一份按提示词回固定 JSON 的替身
 *    （`node --require <钩子>`，同 `edit-site-chain.test.js`）。agent 不跑真 AI（AI_TEAM 五条硬规则第 3 条，#1499）。
 * 🔴 证据从**日志**读，不从产物读：全过的页在 `pages/*.json` 里跟没跑过一模一样（验收 4）。
 *
 * 四跑（各在一份临时拷贝里，不碰工作区的 site/）：
 *   A  成功的双语站（主 en、次 zh）：about 页编了一个年份 → 修补一次修好；一个关键词页两次都不合格 → 丢掉。
 *      断言：主语言每页一行 `[seo] 检查`（页数 = 主语言页数）· 没有目标词的页只跑 1/2/3/5/6/8 · 「修补一次」·
 *      第 8 条「编造的事实」· 「丢掉 <slug>」+「关键词页 2/3」· 那页不在站里、页脚里也没有指向它的链接 ·
 *      次语言的页不出现在任何 `[seo]` 行里 · 提示词里的 title 预算是按品牌名算的数（不是 60）
 *   A' 反向对照：同一份夹具，about 的修补不修 ⟹ about 照发 + 一条 degraded（#1596 起不再建站失败）—— 证明 A 里 about 能过是因为那次修补
 *   B  about 页两次都出两个 H1 ⟹ about 照发 + 一条 degraded，写明 about 与「恰好一个 H1」；about 没被丢掉
 *   C  首页的目标词换成页面里不可能出现的词 ⟹ 日志里有首页的「修补一次」（提示词有 MUST 行），仍不合格 ⟹ 首页照发 + 一条 degraded、写明 home 和哪条
 *   📌 A' / B / C 三格在 #1596 之前断言的是「建站失败」。#1596 第 11 条把「SEO 修补一次仍不合格」改成降级（正文写明本票负责改掉这类断言）。
 *   D  （#1549 重开）主语言 zh：发给 AI 的 description 长度都是 50–80；服务页 description（中文）只缺地点
 *      ⟹ #1593 起检查之前代码补上地点（「｜Markham」）、零次修补调用、建站成功
 *   E  （#1549 重开 r3，QA1 / QA2 2026-10-05 的阻断）主语言 zh、服务页 description 是中英混排且拉丁字母过半、太短：
 *      第一遍报的区间、重写提示词里的区间都是 50–80；重写替身「照提示词写、取区间中点」⟹ 建站成功。
 *      r2 下这一跑 rc=1：检查按文字判成 70–155、提示词说 50–80，AI 守规矩也过不了
 *   F  （#1603）主语言 zh、服务页 description 79 字、以目标词「drain cleaning」结尾、缺地点、重写原样回来 ⟹ 代码补地点时
 *      裁的是目标词前面的正文，补完仍含目标词 ⟹ 建站成功。b902d5ca 上同一份夹具 fatal（从尾部裁，把目标词裁掉了）
 *   G  （#1603）主语言 zh、地点是 90 字无逗号的一串（QA3 在 #1549 量的那个角）⟹ 「目标词 + ｜ + 地点」本身超 80 ⟹
 *      日志一行「不补地点 … 不判」、第 2 条不报缺地点、建站成功。b902d5ca 上同一份夹具 fatal
 */

'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const cp = require('child_process');

const NEXT = path.resolve(__dirname, '..', '..');

let pass = 0; let fail = 0;
const ok = (m) => { pass += 1; console.log(`  ✅ ${m}`); };
const bad = (m) => { fail += 1; console.log(`  ❌ ${m}`); };
const check = (cond, m, detail) => (cond ? ok(m) : bad(detail ? `${m} —— ${detail}` : m));
const die = (m) => { console.error(`🔴 跑不起来: ${m}`); process.exit(2); };

// ── 一份临时拷贝（node_modules 软链回来；site/ out/ .next 不拷）──────────────────────────────────
// 手跑用的两个开关（CI 不设）：SEO_PASS_ONLY=A 只跑 A；SEO_PASS_KEEP=1 不删临时目录（拿 A 那一站去真构建、读 out/）。
const ONLY = process.env.SEO_PASS_ONLY || '';
const ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'seo-pass-1549-'));
if (process.env.SEO_PASS_KEEP === '1') console.log(`📁 临时目录留着：${ROOT}`);
else process.on('exit', () => { try { fs.rmSync(ROOT, { recursive: true, force: true }); } catch (e) { /* 收尾 */ } });
const WORK = path.join(ROOT, 'nextjs');
fs.mkdirSync(WORK);
for (const e of fs.readdirSync(NEXT)) {
  if (['node_modules', 'out', '.next', '.out-backup', '.out-temp', 'site', 'sites'].includes(e)) continue;
  cp.execFileSync('cp', ['-a', '--no-dereference', path.join(NEXT, e), path.join(WORK, e)]);
}
if (!fs.existsSync(path.join(NEXT, 'node_modules'))) die('templates/nextjs/node_modules 不在');
fs.symlinkSync(path.join(NEXT, 'node_modules'), path.join(WORK, 'node_modules'));

// ── 替身：按提示词认是哪一通，回场景文件里写好的 JSON；每一次请求的提示词记进日志文件 ────────────────
const STUB = path.join(ROOT, 'stub.js');
// 替身写成一个真函数、序列化进 --require 的文件（#1593 起它里面有模板字符串和正则，写成字符串要再转义一层）。
function stubMain() {
const fs = require('fs');
const Module = require('module');
const scenario = JSON.parse(fs.readFileSync(process.env.SEO_STUB, 'utf-8'));
// #1593 —— 有第二语言时每一通的回包按语言分组：提示词里那段 LANGUAGES 点名了主语言和第二语言。替身照它分组，
//    第二语言那一份 = 主语言那一份的字原样带「（译）」标记（结构逐字相同），让第二语言能拼出来。
const langsOf = (p) => {
  const m = p.match(/LANGUAGES: this website is in \d+ languages — .*? \("([^"]+)"\) is the main one, plus (.*?)\. You write/);
  return m ? { primary: m[1], others: [...m[2].matchAll(/\("([^"]+)"\)/g)].map((x) => x[1]) } : null;
};
const mark = (v, k) => (typeof v === 'string' ? (['href', 'imageUrl', 'icon', 'id', 'style', 'source', 'under', 'type'].includes(k) ? v : `${v}（译）`)
  : Array.isArray(v) ? v.map((x) => mark(x, k)) : v && typeof v === 'object' ? Object.fromEntries(Object.entries(v).map(([kk, x]) => [kk, kk === 'options' ? x : mark(x, kk)])) : v);
const group = (p, primaryPart, pageLike) => {
  const L = langsOf(p);
  if (!L) return primaryPart;
  const out = { [L.primary]: primaryPart };
  const kw = (p.match(/- target keyword: "([^"]+)"/) || [])[1] || '';
  for (const o of L.others) {
    out[o] = { title: mark(pageLike.title || 'Page'), description: mark(pageLike.description || 'Page'), navLabel: mark(pageLike.navLabel || pageLike.title || 'Page'),
      ...(p.includes('"targetKeyword"') ? { targetKeyword: kw || 'kw' } : {}), sections: mark(primaryPart.sections || pageLike.sections) };
  }
  return out;
};
function answer(prompt) {
  if (prompt.includes('Generate a JSON object with this EXACT structure')) {
    const L = langsOf(prompt);
    if (!L) return scenario.call1;
    const c = scenario.call1;
    const t = { tagline: mark(c.brand.tagline), ctaLabel: mark(c.navigation.ctaLabel), footerDescription: mark(c.navigation.footerDescription), homeLabel: '首页', quickLinksTitle: '快速链接', copyright: mark('Acme Drains. All rights reserved.'),
      seo: { siteTitle: mark(c.seo.siteTitle), siteDescription: mark(c.seo.siteDescription), offerCatalogName: mark(c.seo.offerCatalogName) },
      services: c.services.map((x) => ({ ...x, name: mark(x.name), shortDescription: mark(x.shortDescription), fullDescription: mark(x.fullDescription) })),
      forms: c.forms.map((f) => ({ id: f.id, name: mark(f.name), buttonText: mark(f.buttonText), successMessage: mark(f.successMessage) })),
      contactPage: { title: '联系我们', navLabel: '联系', description: '联系 Acme Drains', headline: '联系我们', subheadline: '给我们留言，我们很快回复。', formHeadline: '留个联系方式', formBody: '留下您的信息，我们会尽快联系您。' } };
    return { ...c, locales: Object.fromEntries(L.others.map((o) => [o, t])) };
  }
  // #1568 —— Call 1 每页一次：按提示词里那一页的 slug 回场景 call1 里那一页的 sections（站级那一通回的 sections 会被丢掉）。
  if (prompt.includes('Write the sections of ONE page')) {
    const slug = (prompt.match(/- slug: "([^"]+)"/) || [])[1];
    const pg = (scenario.call1.pages || []).find((x) => x.slug === slug);
    if (!pg) throw new Error('场景 call1 里没有这一页：' + slug);
    return group(prompt, { sections: pg.sections }, pg);
  }
  // #1550 —— 关键词页一页一次调用：按提示词里那一页的 slug 回场景里写好的那一页。
  if (prompt.includes('Write ONE keyword landing page')) {
    const slug = (prompt.match(/- slug: "([^"]+)"/) || [])[1];
    const pg = (scenario.call2 || []).find((x) => x.slug === slug);
    if (!pg) throw new Error('场景里没有这一页：' + slug);
    return group(prompt, pg, pg);
  }
  // #1593 —— 字段级修补：提示词只带出问题的那几个字段（TEXTS TO FIX），只回这几个字段。
  if (prompt.includes('An automatic SEO check found the problems')) {
    const fields = JSON.parse(prompt.match(/TEXTS TO FIX:\n(\{[\s\S]*?\n\})\n\nPROBLEMS TO FIX/)[1]);
    const slug = (prompt.match(/^PAGE: (.+)$/m) || [])[1];
    const r = (scenario.rewrites || {})[slug];
    if (r && r.replace) return { fields: Object.fromEntries(Object.entries(fields).map(([k, v]) => [k, v.split(r.replace[0]).join(r.replace[1])])) };
    // 「照提示词写」：description 取修补提示词 RULES 里那个区间的中点长度（AI 守规矩）
    if (r && r.midDescription) {
      const m = prompt.match(/meta description, (\d+)–(\d+) chars/);
      if (!m) throw new Error('修补提示词里没有 description 区间');
      const mid = Math.round((Number(m[1]) + Number(m[2])) / 2);
      const out = { ...fields };
      for (const k of Object.keys(out)) if (k === 'description' || k === 'siteDescription') out[k] = [...r.midDescription.repeat(5)].slice(0, mid).join('');
      return { fields: out };
    }
    return { fields }; // 'echo' / 没写：原样退回 ⟹ 仍不合格
  }
  throw new Error('替身不认得这个提示词：' + prompt.slice(0, 120));
}
class FakeAnthropic {
  constructor() {
    this.messages = {
      stream: (req) => ({
        on: () => {},
        finalMessage: async () => {
          const prompt = req.messages[req.messages.length - 1].content;
          fs.appendFileSync(process.env.SEO_STUB_LOG, JSON.stringify(prompt) + '\n');
          const text = JSON.stringify(answer(prompt));
          return { id: 'm', type: 'message', role: 'assistant', model: req.model, content: [{ type: 'text', text }],
            stop_reason: 'end_turn', stop_sequence: null, usage: { input_tokens: 1, output_tokens: 1 } };
        },
      }),
    };
  }
}
const realLoad = Module._load;
Module._load = function (request) {
  if (request === '@anthropic-ai/sdk') return FakeAnthropic;
  return realLoad.apply(this, arguments);
};
}
fs.writeFileSync(STUB, `(${stubMain.toString()})();\n`);

// ── 夹具 ───────────────────────────────────────────────────────────────────────────────────────
const BRAND = 'Acme Drains'; // 11 字 ⟹ 子页 page.title 预算 46
const desc = (core) => `${core} — Acme Drains serves Markham homeowners with fast, honest plumbing help every day.`;
const sec = (type, data) => ({ type, data });
const header = (h, sub) => sec('page-header', sub ? { headline: h, subheadline: sub } : { headline: h });

function kwPage(slug, kw, { title } = {}) {
  return {
    slug, title: title || `${kw.replace(/\b\w/g, (c) => c.toUpperCase())} Pros`, description: desc(`Fast ${kw}`),
    navLabel: kw, navOrder: 50, changeFrequency: 'monthly', priority: 0.6,
    sections: [
      header(`${kw} done right`, `Book ${kw} with local plumbers today.`),
      sec('content', { headline: `Why choose our ${kw}`, body: 'Licensed crews, clear prices, tidy work.' }),
      sec('faq', { headline: `${kw} questions`, items: [{ question: 'How fast?', answer: 'Usually the same day.' }] }),
      sec('cta', { headline: 'Book a visit', body: 'Call us today.', ctas: [{ label: 'Quote', href: '/quote', style: 'solid' }] }),
    ],
  };
}

function call1({ aboutBody = 'We started small and grew by word of mouth.', aboutTwoH1 = false, drainDesc } = {}) {
  return {
    colorScheme: 'light',
    brand: { tagline: 'Clear drains, same day', logoIcon: 'wrench', email: 'hi@acme.test', locations: [{ label: 'Main', address: '1 Main St, Markham', phone: '905-555-0142' }] },
    navigation: { ctaLabel: 'Get a quote', ctaPage: 'quote', footerDescription: 'Drain cleaning in Markham.' },
    seo: {
      domain: 'https://acme.test', siteTitle: 'Drain Cleaning in Markham | Acme Drains', siteDescription: desc('Drain cleaning and water heater repair'),
      areaServed: [{ type: 'City', name: 'Markham' }], addresses: [{ locality: 'Markham', region: 'ON', country: 'CA' }],
      openingHours: { days: ['Monday'], opens: '08:00', closes: '18:00' }, priceRange: '$$', offerCatalogName: 'Plumbing',
    },
    services: [
      { id: 'drain-cleaning', name: 'Drain Cleaning', shortDescription: 'Clogs cleared', fullDescription: 'We clear clogs.', icon: 'wrench', features: ['a'], products: [] },
      { id: 'water-heaters', name: 'Water Heaters', shortDescription: 'Repairs', fullDescription: 'We fix heaters.', icon: 'flame', features: ['b'], products: [] },
    ],
    forms: [
      { id: 'contact', name: 'Contact us', buttonText: 'Send', successMessage: 'Thanks!' },
    ],
    pages: [
      { slug: 'home', title: 'Home', description: desc('Drain cleaning'), navLabel: 'Home', navOrder: 0, changeFrequency: 'weekly', priority: 1,
        sections: [
          sec('hero', { headline: 'Drain Cleaning in Markham', subheadline: 'Fast drain cleaning by local plumbers.', ctas: [{ label: 'Get a quote', href: '/quote', style: 'solid' }] }),
          sec('features', { headline: 'Drain cleaning services', body: 'What we do.', items: { source: 'services' } }),
          sec('faq', { headline: 'Drain cleaning questions', items: [{ question: 'How fast?', answer: 'Same day.' }] }),
          sec('cta', { headline: 'Book a visit', body: 'Call us today.', ctas: [{ label: 'Quote', href: '/quote', style: 'solid' }] }),
        ] },
      { slug: 'about', title: 'About Acme', description: 'We are a family-run plumbing company that serves homeowners with care, honesty and fair prices.',
        navLabel: 'About', navOrder: 1, changeFrequency: 'monthly', priority: 0.7,
        sections: [header('About us'), ...(aboutTwoH1 ? [header('Our people')] : []), sec('content', { headline: 'Our story', body: aboutBody })] },
      { slug: 'quote', title: 'Get a Quote', description: 'Tell us about your plumbing problem and we will call you back the same day with an honest price.',
        navLabel: 'Quote', navOrder: 2, changeFrequency: 'monthly', priority: 0.8,
        sections: [header('Get a quote'), sec('contact', { headline: 'Request a quote', body: 'We reply the same day.', form: {}, options: { form: 'full' } })] },
      { slug: 'services/drain-cleaning', title: 'Drain Cleaning', description: drainDesc || desc('Drain cleaning for kitchens, baths and main lines'),
        navLabel: 'Drain Cleaning', navOrder: 10, changeFrequency: 'monthly', priority: 0.8, serviceDetailPage: true, parentService: 'drain-cleaning',
        sections: [header('Drain cleaning in Markham', 'Drain cleaning, same day.'), sec('content', { headline: 'How drain cleaning works', body: 'We camera-inspect, then clear.' }),
          sec('faq', { headline: 'Drain cleaning FAQ', items: [{ question: 'Is it messy?', answer: 'No.' }] })] },
    ],
  };
}
// #1633 —— 代码补的 contact 页的修补回包：把那句 29 字的英文兜底（`Get in touch with Acme Drains`）写长到合格（同真 AI 照规矩修）。
//    用 replace 不用 midDescription：后者要从修补提示词里读区间，提示词措辞一变它就抛错，那一格量的就成了措辞。
const CONTACT_FIX = { replace: ['Get in touch with ', 'Send us a message about drain cleaning or water heater repair and get in touch with '] };
// #1550 起关键词页挂在 `services/<服务 id>/<词>` 下（URL 由代码定，AI 照抄）。
const KW_SLUGS = ['services/drain-cleaning/drain-cleaning-markham', 'services/drain-cleaning/clogged-drain-repair', 'services/water-heaters/tankless-water-heater'];
function call2() {
  return [
    kwPage(KW_SLUGS[0], 'drain cleaning Markham'),
    kwPage(KW_SLUGS[1], 'clogged drain repair'),
    kwPage(KW_SLUGS[2], 'tankless water heater', { title: 'Hot Water, Fast' }), // title 不含目标词 ⟹ 第 1 条
  ];
}
const KEYWORDS = (primary = 'drain cleaning') => ({
  'Drain Cleaning': [
    { keyword: primary, isPrimary: true, selected: true, goldIndex: 50, volume: 900 },
    { keyword: 'drain cleaning Markham', selected: true, goldIndex: 30, volume: 200 },
    { keyword: 'clogged drain repair', selected: true, goldIndex: 20, volume: 150 },
  ],
  'Water Heaters': [
    { keyword: 'water heater repair', isPrimary: true, selected: true, goldIndex: 40, volume: 500 },
    { keyword: 'tankless water heater', selected: true, goldIndex: 10, volume: 90 },
  ],
});
const PAYLOAD = (extra = {}) => ({
  siteId: 'seo1549t', companyName: BRAND, industry: 'plumbing', location: 'Markham, ON', address: '1 Main St, Markham',
  phone: '905-555-0142', email: 'hi@acme.test', services: ['Drain Cleaning', 'Water Heaters'], keywords: KEYWORDS(),
  usp: 'Licensed plumbers, same-day service', brandDescription: 'Family-run drain company', hours: 'Mon–Fri 8–6',
  reviews: [{ author: 'Sam', rating: 5, text: 'They came the same day. Great!' }], language: 'en',
  siteUrl: 'https://seo1549t.preview.test', // #1547 之后 create-site 要它；之前的版本忽略这个键
  // 首页开场配方（#1034）按 siteId 每站不同、不合就多要一次 Call 1b —— 跟本票那一维无关，关掉免得夹具去追配方
  homepageFingerprint: false,
  // #1601 —— 页面清单从此由整站配方给（plumbing 那一组没有 about / quote），而这份夹具的几个场景就长在 AI 挑出来的
  //    about / quote 上（about 编年份、about 两个 H1）。本测试量的是 seoPass，不是谁挑页：走「照抄参照站结构」那条
  //    仍由 AI 定页面清单的老路（create-site.js §pagesInstruction 的例外），场景一个字不改。配方那条路上的 seoPass
  //    由 create-site-call1-pages.test.js 的 #1601 AC2 那一跑覆盖（它的每一页都过 seo 检查）。
  refSite: 'https://reference.test', refPrefs: ['structure'], refAnalysis: { navLinks: ['Home', 'About', 'Quote'] },
  ...extra,
});

function run(label, scenario, payload) {
  fs.rmSync(path.join(WORK, 'site'), { recursive: true, force: true });
  const scen = path.join(ROOT, `${label}.json`);
  const log = path.join(ROOT, `${label}.prompts`);
  fs.writeFileSync(scen, JSON.stringify(scenario));
  fs.writeFileSync(log, '');
  const r = cp.spawnSync(process.execPath, ['--require', STUB, path.join(WORK, 'scripts', 'create-site.js')], {
    input: JSON.stringify(payload), cwd: WORK, encoding: 'utf8', timeout: 240000,
    env: { ...process.env, ANTHROPIC_API_KEY: 'test-not-real', SEO_STUB: scen, SEO_STUB_LOG: log },
  });
  const events = (r.stdout || '').split('\n').filter(Boolean).map((l) => { try { return JSON.parse(l); } catch (e) { return null; } }).filter(Boolean);
  const prompts = fs.readFileSync(log, 'utf-8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
  return { rc: r.status, stderr: r.stderr || '', events, prompts, site: path.join(WORK, 'site') };
}
const seoLines = (stderr) => stderr.split('\n').filter((l) => l.startsWith('[seo]'));
const errorOf = (res) => (res.events.find((e) => e.event === 'error') || {}).message || '';
// #1596 —— 第 11 条的降级事件（step = seo），以及「那一页照样在产物里」。
const seoDegraded = (res) => res.events.filter((e) => e.event === 'degraded' && e.step === 'seo');
const pageShipped = (res, slug) => fs.readdirSync(res.site, { withFileTypes: true }).some((d) => d.isDirectory() && fs.existsSync(path.join(res.site, d.name, 'pages', `${slug}.json`)));

console.log('\n── A 成功的双语站：每页都查了、about 修补一次修好、一个关键词页丢掉');
const A = run('A', {
  call1: call1({ aboutBody: 'Serving Markham since 2015, we grew by word of mouth.' }),
  call2: call2(),
  rewrites: {
    about: { replace: ['since 2015, ', ''] }, // 字段级修补：去掉编出来的年份（只回送来的那一个字段）
    [KW_SLUGS[2]]: 'echo', // 原样回来 ⟹ 仍不合格 ⟹ 丢掉
  },
}, PAYLOAD({ secondaryLocales: ['zh'] }));
{
  check(A.rc === 0, `建站成功（rc=${A.rc}）`, `${errorOf(A)}\n${A.stderr.slice(-1500)}`);
  const lines = seoLines(A.stderr);
  const checked = lines.filter((l) => l.startsWith('[seo] 检查 ')).map((l) => l.split(' ')[2]);
  // #1633 —— 代码补的 contact 页从此也单独过一次 SEO 检查（以前它在写盘那一步才插，没有任何检查看得到它）。
  const primaryPages = ['home', 'about', 'quote', 'services/drain-cleaning', ...KW_SLUGS, 'contact'];
  check(checked.length === primaryPages.length && primaryPages.every((s) => checked.includes(s)),
    `主语言每页各一行「[seo] 检查」：${checked.length} 行 = 主语言 ${primaryPages.length} 页`, checked.join(' '));
  const aboutLine = lines.find((l) => l.startsWith('[seo] 检查 about ')) || '';
  check(/目标词 （无） · 跑了第 1\/2\/3\/5\/6\/8 条/.test(aboutLine), '没有目标词的页（about）只跑 1/2/3/5/6/8', aboutLine);
  const homeLine = lines.find((l) => l.startsWith('[seo] 检查 home ')) || '';
  check(/目标词 「drain cleaning」 · 跑了第 1\/2\/3\/4\/5\/6\/7\/8 条 · 0 条问题/.test(homeLine), '首页按站的主词跑八条、0 条问题', homeLine);
  check(A.stderr.includes('[8 事实出处] 编造的事实：「2015」'), '第 8 条在 about 上报了「编造的事实：2015」');
  check(lines.some((l) => /^\[seo\] 修补一次后 about · .* · 0 条问题$/.test(l)), 'about 修补一次之后 0 条问题', lines.filter((l) => l.includes('about')).join(' | '));
  const aboutJson = JSON.parse(fs.readFileSync(path.join(A.site, 'en', 'pages', 'about.json'), 'utf-8'));
  check(!JSON.stringify(aboutJson).includes('2015'), '站里写的是修补之后那份 about（没有 2015）');
  check(lines.some((l) => l.startsWith(`[seo] 丢掉 ${KW_SLUGS[2]}：`) && l.includes('[1 title]')), `日志「丢掉 ${KW_SLUGS[2]}：…」带着问题`);
  check(lines.some((l) => l.startsWith('[seo] 关键词页 2/3') && l.includes('「tankless water heater」')), '日志「关键词页 2/3」且 2 < 3，列出没成的词', lines.filter((l) => l.includes('关键词页')).join(' | '));
  const pagesDir = path.join(A.site, 'en', 'pages');
  const flat = (d) => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? flat(path.join(d, e.name)).map((x) => `${e.name}/${x}`) : [e.name]));
  const files = flat(pagesDir);
  check(!files.includes(`${KW_SLUGS[2]}.json`) && files.includes(`${KW_SLUGS[0]}.json`), '丢掉的那页不在站里，另外两页在', files.join(' '));
  const nav = fs.readFileSync(path.join(A.site, 'en', 'navigation.json'), 'utf-8');
  check(!nav.includes(KW_SLUGS[2]) && nav.includes(KW_SLUGS[0]), '页脚里没有指向丢掉那页的链接，别的关键词页还在');
  const ev = A.events.find((e) => e.event === 'seo-check') || {};
  check(ev.keywordPages && ev.keywordPages.ok === 2 && ev.keywordPages.total === 3 && ev.dropped.length === 1 && ev.rewritten === 2,
    '`seo-check` 事件：关键词页 2/3 · 丢 1 · 修补过 2 页（about 修好了、那页关键词页没修好）', JSON.stringify(ev));
  // 双语（#1593）：第二语言跟主语言同一次调用写回来，按它自己的 locale 也查一遍，日志前缀 `[seo zh]`，不混进主语言那组
  check(fs.existsSync(path.join(A.site, 'zh', 'pages', 'about.json')), '次语言 zh 的页生成了');
  const zhChecked = A.stderr.split('\n').filter((l) => l.startsWith('[seo zh] 检查 ')).map((l) => l.split(' ')[3]);
  // 第二语言在写盘时才查 ⟹ 也查到代码插的 contact 页（#1633 起主语言那组也有它，primaryPages 里已经带着）
  const zhPrimary = primaryPages.filter((x) => x !== KW_SLUGS[2]);
  check(zhChecked.length === zhPrimary.length && zhPrimary.every((x) => zhChecked.includes(x)),
    `第二语言每页各一行「[seo zh] 检查」：${zhChecked.length} 行 = 主语言留下来的页 + contact（丢掉那页不在第二语言里）`, zhChecked.join(' '));
  check(!lines.some((l) => /\bzh\b|\/zh\//.test(l)) && checked.length === primaryPages.length, '主语言那组 [seo] 行里没有第二语言的页（检查行数 = 主语言页数）');
  // 提示词里的 title 预算
  const c1 = A.prompts.find((p) => p.includes('Generate a JSON object with this EXACT structure')) || '';
  const c2s = A.prompts.filter((p) => p.includes('Write ONE keyword landing page'));
  const spec = `max 46 chars; " | ${BRAND}" is appended automatically`;
  check(c1.includes(`"title": "<Page Title, ${spec}`) && c1.includes(`Page titles (pages[].title): ${spec}`), `Call 1 提示词：子页 title 预算 46（60 − 3 − ${BRAND.length}），不是 60`);
  check(!c1.includes('All meta titles under 60') && !c1.includes('| <Company>'), 'Call 1 提示词：那句「All meta titles under 60」和 `| <Company>` 都没了');
  check(c2s.length === 3 && c2s.every((c2) => c2.includes(`"title": "<Page Title with the keyword, ${spec}`)), `Call 2（一页一次，${c2s.length} 通）提示词：同一个预算`);
  // #1593 —— 字段级修补：about 只发写着「2015」的那一个字段，提示词里没有这一页别的字（标题、别的块）
  const rw = A.prompts.find((p) => p.includes('An automatic SEO check found the problems') && p.includes('\nPAGE: about\n')) || '';
  check(rw.includes('[8 事实出处]') && rw.includes('Serving Markham since 2015') && !rw.includes('Our story') && !rw.includes('About us') && !rw.includes('About Acme'),
    'about 的修补提示词只带那一个字段（有「since 2015」那句，没有「Our story」/「About us」/ 页标题）', rw.slice(0, 900));
  const rwT = A.prompts.find((p) => p.includes('An automatic SEO check found the problems') && p.includes(`\nPAGE: ${KW_SLUGS[2]}\n`)) || '';
  check(rwT.includes(`"title": ${spec}`), '标题出问题的那页，修补提示词里 title 的预算是同一个数（46）', rwT.slice(0, 900));
}

console.log('\n── A\' 反向对照：about 的修补不修 ⟹ about 照发 + 一条 degraded（#1596）');
if (!ONLY) {
  // #1633 —— 代码补的 contact 页也过 SEO 检查了：它那句英文 description 太短，修补一次照规矩写好（同真 AI），不让它的降级混进「恰好一条」。
  const R = run('A2', { call1: call1({ aboutBody: 'Serving Markham since 2015, we grew by word of mouth.' }), call2: call2(), rewrites: { about: 'echo', [KW_SLUGS[2]]: 'echo', contact: CONTACT_FIX } }, PAYLOAD());
  const d = seoDegraded(R);
  check(R.rc === 0 && !errorOf(R), `建站成功（rc=${R.rc}）`, errorOf(R).slice(0, 400));
  check(d.length === 1 && d[0].target === 'about' && d[0].reason.includes('[8 事实出处]'), '恰好一条 step=seo 的 degraded，指向 about、写明第 8 条', JSON.stringify(d).slice(0, 400));
  check(pageShipped(R, 'about'), 'about 照发（在产物里）');
}

console.log('\n── B about 两次都出两个 H1 ⟹ about 照发 + 一条 degraded，不是丢掉 about（#1596）');
if (!ONLY) {
  const B = run('B', { call1: call1({ aboutTwoH1: true }), call2: call2(), rewrites: { about: 'echo', [KW_SLUGS[2]]: 'echo', contact: CONTACT_FIX } }, PAYLOAD());
  const d = seoDegraded(B);
  check(B.rc === 0 && !errorOf(B), `建站成功（rc=${B.rc}）`, errorOf(B).slice(0, 400));
  check(d.length === 1 && d[0].target === 'about' && d[0].reason.includes('[3 H1] 要恰好一个 H1'), '恰好一条 step=seo 的 degraded，写明 about 页和「恰好一个 H1」那一条', JSON.stringify(d).slice(0, 400));
  check(!seoLines(B.stderr).some((l) => l.startsWith('[seo] 丢掉 about')) && pageShipped(B, 'about'), 'about 没被丢掉（没有目标词的页走「照发 + 降级」那一支），在产物里');
  // #1593 —— 两个 H1 没有字段可改：不发修补调用，直接按「修补后仍不合格」处置
  check(!B.prompts.some((p) => p.includes('An automatic SEO check found the problems') && p.includes('\nPAGE: about\n'))
    && seoLines(B.stderr).some((l) => l.startsWith('[seo] 不修补 about：')), 'about 没发修补调用（两个 H1 没有字段可改），日志「不修补 about」');
}

console.log('\n── C 首页的目标词换成不可能出现的词 ⟹ 修补一次、仍不合格、照发 + degraded（#1596）');
if (!ONLY) {
  const C = run('C', { call1: call1(), call2: call2(), rewrites: { home: 'echo', [KW_SLUGS[2]]: 'echo' } },
    PAYLOAD({ keywords: { ...KEYWORDS('zzqx flurbington'), 'Drain Cleaning': KEYWORDS('zzqx flurbington')['Drain Cleaning'].map((k) => (k.isPrimary ? { ...k, goldIndex: 99 } : k)) } }));
  const lines = seoLines(C.stderr);
  check(lines.some((l) => l.startsWith('[seo] 检查 home · 目标词 「zzqx flurbington」')), '首页的目标词是那个不可能的词', lines.find((l) => l.includes(' home ')));
  const rwH = C.prompts.find((p) => p.includes('An automatic SEO check found the problems') && p.includes('\nPAGE: home\n')) || '';
  check(!!rwH, '首页被带着问题修补了一次（发出去了修补提示词）');
  check(/HARD REQUIREMENTS[^\n]*\n- MUST: "siteTitle" contains "zzqx flurbington" exactly as written/.test(rwH), '修补提示词把「必须含目标词」单列成 MUST 行（首页是 siteTitle）', rwH.slice(rwH.indexOf('PROBLEMS TO FIX'), rwH.indexOf('PROBLEMS TO FIX') + 700));
  check(lines.some((l) => l.startsWith('[seo] 修补一次后 home ')), '日志里有首页「修补一次后」那一行');
  const d = seoDegraded(C);
  check(C.rc === 0 && !errorOf(C), `建站成功（rc=${C.rc}）`, errorOf(C).slice(0, 400));
  check(d.some((x) => x.target === 'home' && x.reason.includes('[1 title]')) && pageShipped(C, 'home'), '一条 step=seo 的 degraded 写明 home 和哪条，首页照发', JSON.stringify(d).slice(0, 400));
}

console.log('\n── D 主语言 zh：description 长度按 CJK 那一档发给 AI；只缺地点 ⟹ 检查之前代码补、零次修补调用（#1593 把补地点挪到检查之前）');
if (!ONLY || ONLY === 'D') {
  const NO_PLACE = '持牌技师为厨房、浴室和主管道提供 drain cleaning 疏通服务，当天上门，价格透明，不加收任何上门费，欢迎随时预约。';
  const D = run('D', {
    call1: call1({ drainDesc: NO_PLACE }), call2: call2(),
    rewrites: { 'services/drain-cleaning': 'echo', [KW_SLUGS[2]]: 'echo' },
  }, PAYLOAD({ language: 'zh' }));
  const lines = seoLines(D.stderr);
  check(D.rc === 0, `建站成功（rc=${D.rc}）`, `${errorOf(D)}\n${D.stderr.slice(-1200)}`);
  const iPlace = lines.findIndex((l) => l.startsWith('[seo] 补地点 services/drain-cleaning：「Markham」'));
  const iCheck = lines.findIndex((l) => l.startsWith('[seo] 检查 services/drain-cleaning '));
  check(iPlace >= 0 && iCheck > iPlace, '日志「补地点」（代码补）在这一页的「检查」那一行之前', lines.filter((l) => l.includes('drain-cleaning ') || l.includes('补地点')).join(' | '));
  check(/ · 0 条问题$/.test(lines[iCheck] || ''), '第一遍检查：服务页 0 条问题（地点已由代码补上）', lines[iCheck]);
  check(!D.prompts.some((p) => p.includes('An automatic SEO check found the problems') && p.includes('\nPAGE: services/drain-cleaning\n')), '服务页零次修补调用');
  const pg = JSON.parse(fs.readFileSync(path.join(D.site, 'zh', 'pages', 'services', 'drain-cleaning.json'), 'utf-8'));
  check(pg.description === `${NO_PLACE.replace(/。$/, '')}｜Markham` && [...pg.description].length <= 80, '落盘的 description 末尾补上了「｜Markham」（主语言 zh 用全角竖线），≤ 80 字', JSON.stringify(pg.description));
  const c1 = D.prompts.find((p) => p.includes('Generate a JSON object with this EXACT structure')) || '';
  const c2s = D.prompts.filter((p) => p.includes('Write ONE keyword landing page'));
  check(c1.includes('"siteDescription": "<50–80 个汉字 (Chinese characters),') && c1.includes('"description": "<Page meta description, 50–80 个汉字 (Chinese characters)>"')
    && c1.includes('Every meta description (seo.siteDescription and pages[].description): 50–80 个汉字 (Chinese characters).') && !c1.includes('70–155'),
  'Call 1 提示词三处都是 50–80（主语言 zh），没有 70–155');
  check(c2s.length === 3 && c2s.every((c2) => c2.includes('keyword + location, 50–80 个汉字 (Chinese characters)>') && !c2.includes('70–155')), `Call 2（${c2s.length} 通）提示词：50–80`);
  // 反向对照：英文站（A）的三处仍是 70–155
  const a1 = A.prompts.find((p) => p.includes('Generate a JSON object with this EXACT structure')) || '';
  check(a1.includes('"siteDescription": "<70–155 characters,') && !a1.includes('50–80'), '对照：英文站 Call 1 仍是 70–155');
}

console.log('\n── E 主语言 zh：第一稿 description 没到目标 50 字、但在底线 20 之上 ⟹ 不报、不修补、原样发布（#1549 r4，Chris 2026-10-06）');
if (!ONLY || ONLY === 'E') {
  // site-f7a34357 那种形状：第一稿 24–49 字、含目标词与地点。改前报「要 50–80」、每页修补一次；改后照发。
  // 「低于底线 20 ⟹ 报」由 seo-problems.test.js ④b 的纯函数覆盖 —— 这里造不出来：目标词 + 地点本身就 ≥ 20 字。
  const SHORT = 'Acme Drains 在 Markham 提供 drain cleaning 疏通。';
  const E = run('E', {
    call1: call1({ drainDesc: SHORT }), call2: call2(),
    rewrites: { [KW_SLUGS[2]]: 'echo' },
  }, PAYLOAD({ language: 'zh' }));
  const lines = seoLines(E.stderr);
  check(E.rc === 0, `建站成功（rc=${E.rc}）`, `${errorOf(E)}\n${E.stderr.slice(-1200)}`);
  const iCheck = lines.findIndex((l) => l.startsWith('[seo] 检查 services/drain-cleaning '));
  check(/ · 0 条问题$/.test(lines[iCheck] || ''), `第一遍检查：服务页 ${[...SHORT].length} 字的 description 0 条问题（在底线 20 之上）`, lines[iCheck]);
  check(!E.prompts.some((p) => p.includes('An automatic SEO check found the problems') && p.includes('\nPAGE: services/drain-cleaning\n')), '服务页零次修补调用');
  if (E.rc === 0) {
    const pg = JSON.parse(fs.readFileSync(path.join(E.site, 'zh', 'pages', 'services', 'drain-cleaning.json'), 'utf-8'));
    check(pg.description === SHORT, `落盘的 description 就是第一稿（${[...SHORT].length} 字），没被改`, JSON.stringify(pg.description));
  }
}

console.log('\n── F 主语言 zh：description 199 字、以目标词结尾、缺地点 ⟹ 代码补地点不裁掉目标词，建站成功（#1549 r4：补地点按底线上限 200，夹具贴着它造）');
if (!ONLY || ONLY === 'F') {
  const KW = 'drain cleaning';
  const filler = '持牌技师为厨房、浴室和主管道提供疏通服务，当天上门，价格透明，不加收任何上门费，欢迎随时预约我们专业的';
  const F_DESC = `${[...filler.repeat(5)].slice(0, 199 - KW.length - 1).join('')} ${KW}`;
  check([...F_DESC].length === 199 && F_DESC.endsWith(KW) && !F_DESC.includes('Markham'), `夹具：${[...F_DESC].length} 字、以「${KW}」结尾、不含 Markham`);
  const F = run('F', {
    call1: call1({ drainDesc: F_DESC }), call2: call2(),
    rewrites: { 'services/drain-cleaning': 'echo', [KW_SLUGS[2]]: 'echo' },
  }, PAYLOAD({ language: 'zh' }));
  const lines = seoLines(F.stderr);
  console.log(`  · rc=${F.rc}${F.rc ? ` · ${errorOf(F).split('\n').slice(0, 4).join(' / ')}` : ''}`);
  const iPlace = lines.findIndex((l) => l.startsWith('[seo] 补地点 services/drain-cleaning：「Markham」'));
  const iCheck = lines.findIndex((l) => l.startsWith('[seo] 检查 services/drain-cleaning '));
  check(iPlace >= 0 && iCheck > iPlace, '日志「补地点」（代码补）在这一页的「检查」那一行之前');
  check(F.rc === 0, `建站成功（rc=${F.rc}）`, `${errorOf(F)}`.slice(0, 600));
  check(/ · 0 条问题$/.test(lines[iCheck] || ''), '补完再查：0 条问题（补的时候没把句末的目标词裁掉）', lines.filter((l) => l.includes('drain-cleaning ')).join(' | '));
  if (F.rc === 0) {
    const pg = JSON.parse(fs.readFileSync(path.join(F.site, 'zh', 'pages', 'services', 'drain-cleaning.json'), 'utf-8'));
    const n = [...pg.description].length;
    check(pg.description.endsWith(`，${KW}｜Markham`) && n >= 20 && n <= 200, `落盘的 description（${n} 字）以「，${KW}｜Markham」结尾`, JSON.stringify(pg.description));
  }
}

console.log('\n── G 主语言 zh、地点 210 字无逗号：塞不进底线上限 200 ⟹ 第 2 条地点那一半不判、打一行日志、建站成功（#1549 r4 前是 90 字 / 80）');
if (!ONLY || ONLY === 'G') {
  const ADDR = [...'安大略省万锦市第七大道与肯尼迪路交叉口东北角商业广场二楼二零八室旁边的停车场入口处向北步行约五分钟即到我们的门店'.repeat(5)].slice(0, 210).join('');
  const NO_PLACE = '持牌技师为厨房、浴室和主管道提供 drain cleaning 疏通服务，当天上门，价格透明，不加收任何上门费，欢迎随时预约。';
  const G = run('G', {
    call1: call1({ drainDesc: NO_PLACE }), call2: call2(),
    rewrites: { 'services/drain-cleaning': 'echo', [KW_SLUGS[2]]: 'echo' },
  }, PAYLOAD({ language: 'zh', location: ADDR, address: ADDR }));
  const lines = seoLines(G.stderr);
  console.log(`  · rc=${G.rc}${G.rc ? ` · ${errorOf(G).split('\n').slice(0, 4).join(' / ')}` : ''}`);
  check([...ADDR].length === 210 && !/[,，、]/.test(ADDR), '夹具：地点 210 字、没有逗号');
  const skip = lines.filter((l) => l.startsWith('[seo] 不补地点 services/drain-cleaning：'));
  check(skip.length === 1 && skip[0].includes('底线上限 200 字') && skip[0].includes('不判'), '日志恰好一行「不补地点 services/drain-cleaning：… 底线上限 200 字 ⟹ … 不判」', skip.join(' | ') || lines.slice(0, 5).join(' | '));
  check(!G.stderr.includes('不含地点'), '没有任何一页报「不含地点」');
  check(G.rc === 0, `建站成功（rc=${G.rc}）`, `${errorOf(G)}`.slice(0, 600));
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
