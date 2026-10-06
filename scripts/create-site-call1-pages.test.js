#!/usr/bin/env node
// #1568 —— Call 1 按页生成：真 create-site.js 进程，只把 `@anthropic-ai/sdk` 换成按提示词回放的桩（同 #1550 / #1567 的做法）。
//
// 🔴 不是 skipAI：skipAI 在 Call 1 之前就 return，一次 AI 调用都不发，下面每一格在它上面要么红、要么空着就绿。
// 🔴 不调真 AI（#1499）：桩认得三种调用 —— 站级那一通（`Generate a JSON object with this EXACT structure`）回一份写好的
//    页面清单；每页那一通（`Write the sections of ONE page`）按 slug 回那一页的 sections；SEO 重写原样退回。`fetch` 一律离线。
// 输入照 Chris 2026-10-04 撞上的那个站（site-7f87c5c3）等价构造：7 个服务、主语言中文、Toronto。
//
// 量的是正文验收里这几条（逐条标在格子名上）：
//   AC 打桩跑   建站成功、每页一行进度、没有 truncated
//   AC 按页发   prompt 事件（排除 `Keyword page: ` / `SEO rewrite ` 两族）== 1 + 页数；cost 那一族 ≥ 1 + 页数、每条 out < 32000
//   AC 重试     一张服务详情页调用失败一次 ⟹ 「重试第 i 页」、建站成功、只有它被请求两次；两次都失败 ⟹ 那一页发骨架页 + 一条 degraded
//               写明是哪一页（#1596 之前是建站失败）
//   AC haiku    模型 haiku-4.5、上限 128000 ⟹ 发给 API 的上限 64000（不是被拒）；sonnet 那一臂照发 128000（阳性对照）
//   做什么 2    每页提示词只带那一页：自己的 slug / brief / 目标词，没有别页的 brief；站级那一份不带块菜单
//   块库        一页第一次块库不合格 ⟹ 只重试这一页；整站缺「行业必需的块」⟹ 首页那一通补一次，补不上 ⟹ 原样发 + 一条 degraded
//               （#1596 之前是建站失败）
//   r2 关键词页 站级回包的页面清单混进关键词页（顶层 / `<服务>/<词>` / `services/<id>/<词>`）⟹ 丢掉、不生成、各一行日志，Call 2 照常建
'use strict';

const assert = require('assert');
const cp = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const NEXT = path.resolve(__dirname, '..');
const TEMP = [];
process.on('exit', () => {
  if (process.env.C1_KEEP === '1') { if (TEMP.length) console.log(`📌 C1_KEEP=1 ⟹ 留着 ${TEMP.join(' ')}`); return; }
  for (const d of TEMP) { try { fs.rmSync(d, { recursive: true, force: true }); } catch (e) { /* 打扫不成不改结论 */ } }
});
function die(msg) { console.log(`💥 ${msg}`); process.exit(2); }

let pass = 0;
let fail = 0;
function check(name, fn) {
  try { fn(); pass += 1; console.log(`  ✅ ${name}`); } catch (e) { fail += 1; console.log(`  ❌ ${name}\n     ${e.message}`); }
}

// ── 桩 ────────────────────────────────────────────────────────────────────────────────────────────
function stubMain() {
'use strict';
const Module = require('module');
const fs = require('fs');
const cfg = JSON.parse(fs.readFileSync(process.env.C1_STUB_CFG, 'utf8'));
const seen = {};
globalThis.fetch = async () => { throw new Error('offline (test stub)'); };
const DESC_KW = (kw) => `${kw}就在 Toronto：Silky Hair Salon 在多伦多为每一位顾客提供细致的${kw}服务，预约简单，到店即享专业建议，环境舒适安心，欢迎随时来店体验焕然一新的造型。`;
const BODY = '我们在多伦多为每一位顾客提供细致的护理与造型服务，预约简单，到店即享专业建议，环境舒适安心，欢迎随时来店体验我们团队带来的放松时光与焕然一新的造型。';
// #1601 —— 非首页的块序由整站配方定，写在提示词里（`write exactly these N, in this order: "a" → "b"`）：桩照它回，
//    每种块一份过得了块库的 data。
const BLOCK = {
  'page-header': (title) => ({ type: 'page-header', data: { headline: title } }),
  content: (title) => ({ type: 'content', data: { headline: `关于${title}`, body: BODY } }),
  features: (title, prompt) => ({ type: 'features', data: /"features": write "items": \{"source": "services"\}/.test(prompt)
    ? { headline: '我们的服务', items: { source: 'services' } }
    : { headline: `${title}的亮点`, items: [1, 2, 3].map((n) => ({ title: `亮点${n}`, text: '每一步都由资深发型师完成。' })) } }),
  faq: () => ({ type: 'faq', data: { headline: '常见问题', items: [{ question: '需要预约吗？', answer: '建议提前预约，也欢迎直接到店。' }] } }),
  cta: () => ({ type: 'cta', data: { headline: '现在预约', body: '告诉我们您想要的造型。', ctas: [{ label: '预约', href: '/contact', style: 'solid' }] } }),
  contact: () => ({ type: 'contact', data: { headline: '联系我们', body: '留下联系方式，我们尽快回复。', form: { id: 'contact' }, options: { form: 'full' } } }),
};
function sectionsFor(slug, title, prompt) {
  const fixed = (prompt.match(/write exactly these \d+, in this order: ([^\n]+?)\. Do not add/) || [])[1];
  if (fixed) return fixed.split(' → ').map((t) => BLOCK[JSON.parse(t)](title, prompt));
  const tail = [
    { type: 'faq', data: { headline: '常见问题', items: [{ question: '需要预约吗？', answer: '建议提前预约，也欢迎直接到店。' }] } },
    { type: 'cta', data: { headline: '现在预约', body: '告诉我们您想要的造型。', ctas: [{ label: '预约', href: '/quote', style: 'solid' }] } },
  ];
  if (slug === 'home') {
    return [
      { type: 'hero', data: { headline: title, subheadline: BODY, ctas: [{ label: '预约', href: '/quote', style: 'solid' }] } },
      { type: 'features', data: { headline: '我们的服务', body: '每一项都由资深发型师完成。', items: { source: 'services' } } },
      ...tail,
    ];
  }
  return [{ type: 'page-header', data: { headline: title } }, { type: 'content', data: { headline: `关于${title}`, body: BODY } }, ...tail];
}
function answer(req) {
  const first = req.messages[0].content;
  const turns = req.messages.length;
  const last = req.messages[turns - 1].content;
  const kind = first.includes('Generate a JSON object with this EXACT structure') ? 'site'
    : first.includes('Write the sections of ONE page') ? 'page'
      : first.includes('Write ONE keyword landing page') ? 'keyword'
        : first.includes('An automatic SEO check found the problems') ? 'seo-rewrite' : 'other';
  const slug = kind === 'page' || kind === 'keyword' ? (first.match(/- slug: "([^"]+)"/) || [])[1] : null;
  if (slug) seen[slug] = (seen[slug] || 0) + 1;
  fs.appendFileSync(process.env.C1_STUB_CALLS, JSON.stringify({ kind, slug, turns, max_tokens: req.max_tokens, first, last }) + '\n');
  if (kind === 'site') return { json: cfg.plan, out: cfg.siteOut || 4000 };
  if (kind === 'page') {
    // failCalls[slug] = 这一页前几次调用回 400（不可重试的 API 错 ⟹ callAIWithRetry 当场抛）
    if ((cfg.failCalls || {})[slug] >= seen[slug]) { const e = new Error(`stub: page ${slug} refused (call ${seen[slug]})`); e.status = 400; throw e; }
    const title = (first.match(/\n- title: ([^\n]+)/) || [])[1] || slug;
    let sections = sectionsFor(slug, title, first);
    // badFirst[slug]：第一次给一个块库不认的块（只重试这一页）
    if ((cfg.badFirst || []).includes(slug) && seen[slug] === 1) sections = [...sections, { type: 'not-a-block', data: {} }];
    // gallery：整站检查之后首页那一通补（cfg.siteFix）—— 只在那一通（问题里点名整站）才加
    if (slug === 'home' && cfg.siteFix && turns > 1 && /The website as a whole/.test(last)) {
      sections = [...sections, { type: 'gallery', data: { headline: '作品集', items: [1, 2].map((n) => ({ image: { imageUrl: '/images/grid-pattern.svg', alt: '店里完成的一次造型' }, title: `作品 ${'甲乙'[n - 1]}`, caption: '一次造型。' })) } }];
    }
    return { json: { sections }, out: cfg.pageOut || 3000 };
  }
  if (kind === 'keyword') {
    // Call 2（#1550）一页一通：按提示词里的 slug 回一张合格的关键词页
    const kw = (first.match(/- target keyword: "([^"]+)"/) || [])[1];
    const sections = [
      { type: 'page-header', data: { headline: `${kw}｜多伦多` } },
      { type: 'content', data: { headline: `${kw}怎么做`, body: `${kw}：${BODY}` } },
      { type: 'faq', data: { headline: `${kw}常见问题`, items: [{ question: `${kw}需要预约吗？`, answer: '建议提前预约，也欢迎直接到店。' }] } },
      { type: 'cta', data: { headline: '现在预约', body: '告诉我们您想要的造型。', ctas: [{ label: '预约', href: '/quote', style: 'solid' }] } },
    ];
    return { json: { slug, title: `${kw}｜多伦多`, description: DESC_KW(kw), navLabel: kw, navOrder: 50, changeFrequency: 'monthly', priority: 0.6, sections }, out: 2000 };
  }
  if (kind === 'seo-rewrite') {
    // #1593 之后修补是字段级：提示词里 `TEXTS TO FIX:` 是 { 名字: 字 }，回包 {"fields": { 名字: 新的字 }}。
    const fields = JSON.parse((first.match(/TEXTS TO FIX:\n(\{[\s\S]*?\n\})\n\nPROBLEMS TO FIX/) || [])[1]);
    // cfg.seoFixDesc（#1601）：站级回包漏了配方里的某一页 ⟹ 那一页的 description 是代码兜的短句，要靠这一通重写补长
    //    （真 AI 就是这么修的）。只在点名的那几跑打开；别的跑照旧原样退回。
    const pageSlug = (first.match(/^PAGE: (.+)$/m) || [])[1] || '';
    if (cfg.seoFixDesc && typeof fields.description === 'string') fields.description = `${pageSlug}：Silky Hair Salon 在多伦多为每一位顾客提供细致的护理与造型服务，预约简单，到店即享专业建议，环境舒适安心，欢迎随时来店体验。`;
    return { json: { fields }, out: 1000 };
  }
  throw new Error('桩不认识这一通调用：' + first.slice(0, 120));
}
class FakeAnthropic {
  constructor() {
    this.messages = {
      stream: (req) => ({
        finalMessage: async () => {
          const a = answer(req);
          return { content: [{ type: 'text', text: JSON.stringify(a.json) }], usage: { input_tokens: 100, output_tokens: a.out }, stop_reason: 'end_turn' };
        },
      }),
    };
  }
}
FakeAnthropic.default = FakeAnthropic;
FakeAnthropic.Anthropic = FakeAnthropic;
const orig = Module._load;
Module._load = function (request) {
  if (request === '@anthropic-ai/sdk') return FakeAnthropic;
  return orig.apply(this, arguments);
};}
const STUB = `(${stubMain.toString()})();\n`;

function makeTree(label) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), `c1-pages-${label}-`));
  TEMP.push(root);
  const work = path.join(root, 'nextjs');
  cp.execSync(`tar --exclude=./node_modules --exclude=./out --exclude=./.next --exclude=./site --exclude=./public/photos -cf - . | (mkdir -p "${work}" && tar -xf - -C "${work}")`, { cwd: NEXT, stdio: 'pipe' });
  fs.symlinkSync(path.join(NEXT, 'node_modules'), path.join(work, 'node_modules'));
  return work;
}

// ── 输入：site-7f87c5c3 的等价构造（7 个服务、中文、Toronto）──────────────────────────────────────────
const SERVICES = [
  ['cut', '剪发'], ['color', '染发'], ['perm', '烫发'], ['treatment', '护发'],
  ['styling', '造型'], ['scalp', '头皮护理'], ['bridal', '新娘造型'],
];
const DESC = (t) => `${t}：Silky Hair Salon 在多伦多为每一位顾客提供细致的护理与造型服务，预约简单，到店即享专业建议，环境舒适安心，欢迎随时来店体验。`;
function plan() {
  const page = (slug, title, navOrder, extra = {}) => ({ slug, title, description: DESC(title), navLabel: title, navOrder,
    changeFrequency: 'monthly', priority: 0.8, brief: `BRIEF<${slug}>：这一页讲${title}。`, ...extra });
  return {
    colorScheme: 'light',
    brand: { tagline: '让头发如丝般顺滑', logoIcon: 'scissors', email: 'hi@silky.test', locations: [{ label: '店面', address: 'Toronto, ON', phone: '(416) 555-0199' }] },
    navigation: { ctaLabel: '立即预约', ctaPage: 'quote', footerDescription: '多伦多的美发沙龙。' },
    seo: { siteTitle: 'Silky Hair Salon 多伦多美发', siteDescription: DESC('多伦多美发'), areaServed: [{ type: 'City', name: 'Toronto' }], addresses: [], priceRange: '$$', offerCatalogName: '服务' },
    services: SERVICES.map(([id, name]) => ({ id, name, shortDescription: `${name}服务`, fullDescription: `${name}，在多伦多。`, icon: 'scissors', features: ['细致'], products: [] })),
    forms: [{ id: 'quote', name: '预约', buttonText: '提交', successMessage: '谢谢' }, { id: 'contact', name: '联系', buttonText: '提交', successMessage: '谢谢' }],
    pages: [
      page('home', '首页', 0), page('services', '服务', 1), page('about', '关于我们', 2), page('quote', '预约', 3),
      ...SERVICES.map(([id, name], i) => page(`services/${id}`, name, 10 + i, { serviceDetailPage: true, parentService: id })),
      // #1601 —— 站级提示词点名要 contact（配方的按钮落点）、events 组还要 faq（photography 那两跑）；
      //    about / quote 是「AI 照旧多列的页」，salon 的配方不采用（faq 对 salon 也一样）。
      page('contact', '联系我们', 4), page('faq', '常见问题', 5),
    ],
  };
}
// #1601 —— 建出来的页不再是站级回包那份（它仍是 home / services / about / quote + 7 张服务页，模拟 AI 照旧列页），
//    而是 beauty 组配方给的：首页 + 服务列表页 + 每个服务一页 + contact。
const BUILT = ['home', 'services', ...SERVICES.map(([id]) => `services/${id}`), 'contact'];
const N = BUILT.length; // 2 + 7 + 1 = 10
const PAYLOAD = (extra = {}) => ({
  siteId: 'c1zh0001', siteUrl: 'https://silky.test', companyName: 'Silky Hair Salon', industry: 'hair salon', location: 'Toronto, ON',
  language: 'zh', services: SERVICES.map(([, n]) => n), homepageFingerprint: false, ...extra,
});

function run(label, payload, cfg, prep) {
  const work = makeTree(label);
  if (prep) prep(work);
  const dir = path.dirname(work);
  const stub = path.join(dir, 'stub.js');
  const cfgFile = path.join(dir, 'cfg.json');
  const calls = path.join(dir, 'calls.jsonl');
  fs.writeFileSync(stub, STUB);
  fs.writeFileSync(cfgFile, JSON.stringify({ plan: plan(), ...cfg }));
  fs.writeFileSync(calls, '');
  const r = cp.spawnSync(process.execPath, ['--require', stub, path.join(work, 'scripts', 'create-site.js')], {
    input: JSON.stringify(payload), cwd: work, encoding: 'utf8', maxBuffer: 64 << 20, timeout: 300000,
    env: { ...process.env, ANTHROPIC_API_KEY: 'stub-not-used', C1_STUB_CFG: cfgFile, C1_STUB_CALLS: calls },
  });
  if (r.error) die(`${label}：进程没跑起来 ${r.error.message}`);
  const events = (r.stdout || '').split('\n').filter(Boolean).map((l) => { try { return JSON.parse(l); } catch (e) { return { event: '(非 JSON)', raw: l }; } });
  const callList = fs.readFileSync(calls, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
  return { work, rc: r.status, stdout: r.stdout || '', stderr: r.stderr || '', events, calls: callList, error: (events.find((e) => e.event === 'error') || {}).message || '' };
}
// 验收里那两条 jq 的同义实现（谓词逐字照抄正文：两族前缀、`create-site` 操作、detail 末尾的 `/ N out)`）
const call1Prompts = (events) => events.filter((e) => e.event === 'prompt' && !/^(Keyword page: |SEO rewrite )/.test(e.name));
const call1Costs = (events) => events.filter((e) => e.event === 'cost' && e.operation === 'create-site' && !/^(Keyword page |SEO rewrite )/.test(e.detail));
const outOf = (e) => Number((e.detail.match(/\/ ([0-9]+) out\)$/) || [])[1]);

console.log('══ #1568 Call 1 按页生成（打桩，7 服务中文站）══');

// ── 打桩跑：全部成功 ───────────────────────────────────────────────────────────────────────────────
console.log('── 打桩跑：7 服务、中文，全部一次成功');
const A = run('ok', PAYLOAD(), {});
check('AC 打桩跑：建站成功（rc 0、没有 error 事件）', () => {
  assert.strictEqual(A.error, '', A.error);
  assert.strictEqual(A.rc, 0, A.stderr.slice(-800));
});
check('AC 打桩跑：没有 truncated 错误', () => {
  assert.ok(!/truncated/i.test(A.stdout + A.stderr), 'stdout/stderr 里有 truncated');
});
check(`AC 打桩跑：每页一行进度（${N} 行「Page i/${N} written」，i 从 1 到 ${N}）`, () => {
  const lines = A.events.filter((e) => e.event === 'progress' && /^Page \d+\/\d+ written: /.test(e.message)).map((e) => e.message);
  assert.strictEqual(lines.length, N, lines.join(' | '));
  assert.deepStrictEqual(lines.map((l) => Number(l.match(/^Page (\d+)\//)[1])), Array.from({ length: N }, (_, i) => i + 1));
  assert.ok(lines.every((l) => l.includes(`/${N} written`)));
});
check(`AC 按页发：prompt 事件（排除两族）== 1 + ${N}，名字是 Base Site + 每页一个 Page: <slug>`, () => {
  const ps = call1Prompts(A.events);
  assert.strictEqual(ps.length, 1 + N, ps.map((p) => p.name).join(' · '));
  assert.deepStrictEqual(ps.map((p) => p.name), ['Base Site', ...BUILT.map((slug) => `Page: ${slug}`)]);
});
check(`AC 按页发（前置）：cost 那一族条数 ≥ 1 + ${N}`, () => {
  const cs = call1Costs(A.events);
  assert.ok(cs.length >= 1 + N, `${cs.length} 条：${cs.map((c) => c.detail).join(' · ')}`);
});
check('AC 按页发（判空）：那一族每条回包 out < 32000（打桩：只证明过滤器接得上 —— 数是桩给的）', () => {
  const cs = call1Costs(A.events);
  assert.ok(cs.every((c) => Number.isFinite(outOf(c))), '有一条 detail 解析不出 out 数');
  assert.deepStrictEqual(cs.filter((c) => outOf(c) >= 32000).map((c) => c.detail), []);
});
check('页面一页一次调用：每页恰好一通、站级一通', () => {
  assert.strictEqual(A.calls.filter((c) => c.kind === 'site').length, 1);
  for (const slug of BUILT) assert.strictEqual(A.calls.filter((c) => c.kind === 'page' && c.slug === slug).length, 1, slug);
});
check('落盘：每页的块就是那一页那一通回的 sections，页面文件里没有 brief', () => {
  const dir = path.join(A.work, 'site', 'zh', 'pages');
  for (const slug of BUILT) {
    const j = JSON.parse(fs.readFileSync(path.join(dir, `${slug}.json`), 'utf8'));
    assert.ok(!('brief' in j), `${slug} 带着 brief`);
    const types = (j.blocks || j.sections || []).map((b) => b.type);
    assert.strictEqual(types[0], slug === 'home' ? 'hero' : 'page-header', `${slug}: ${types.join(',')}`);
  }
});
check('做什么 2：每页提示词只带这一页（自己的 slug / brief 各一次，别页的 brief 0 次）；站级那一份不带块菜单', () => {
  const ps = call1Prompts(A.events);
  const site = ps[0].content;
  assert.ok(!site.includes('AVAILABLE SECTION TYPES') && !site.includes('HOMEPAGE SECTIONS'), '站级提示词里有块菜单');
  for (const p of ps.slice(1)) {
    const slug = p.name.replace(/^Page: /, '');
    assert.strictEqual(p.content.split(`- slug: "${slug}"`).length - 1, 1, `${slug}：自己的 slug 行不是恰好一次`);
    // contact 是配方加的页，站级回包（桩）没给它 brief ⟹ 它那一份没有 brief 行。
    if (plan().pages.some((x) => x.slug === slug)) assert.ok(p.content.includes(`BRIEF<${slug}>`), `${slug}：没有自己的 brief`);
    else assert.ok(!p.content.includes('- what it must cover:'), `${slug}：回包没给 brief 却有 brief 行`);
    const others = plan().pages.filter((x) => x.slug !== slug && p.content.includes(`BRIEF<${x.slug}>`)).map((x) => x.slug);
    assert.deepStrictEqual(others, [], `${slug} 的提示词里有别页的 brief`);
    assert.ok(p.content.includes('AVAILABLE SECTION TYPES'), `${slug}：没有块菜单`);
  }
});
check('做什么 2：服务详情页的提示词点名它自己的服务、带配方给它的块序（#1601：不再是「5-7 块」那一行）；首页的带首页那几条', () => {
  const ps = call1Prompts(A.events);
  const perm = ps.find((p) => p.name === 'Page: services/perm').content;
  assert.ok(perm.includes('This is the detail page of the service "烫发" (id perm). Write unique'), perm.slice(0, 200));
  assert.ok(!perm.includes('It needs 5-7 sections'), '服务页还带着让 AI 自己挑块的那一行');
  assert.ok(/- This page's sections are FIXED: write exactly these 5, in this order: "page-header" → "content" → "features" → "faq" → "cta"\./.test(perm), perm.slice(0, 1500));
  const home = ps.find((p) => p.name === 'Page: home').content;
  assert.ok(home.includes('- This is the HOME page.') && /There are \d+ section types/.test(home));
  assert.ok(!perm.includes('- This is the HOME page.') && !/There are \d+ section types/.test(perm));
});

// ── 重试：一张服务详情页失败一次 / 两次 ─────────────────────────────────────────────────────────────
const FAIL_SLUG = 'services/perm';
const FAIL_I = BUILT.indexOf(FAIL_SLUG) + 1;
console.log(`── 重试：${FAIL_SLUG}（第 ${FAIL_I} 页）调用失败一次 / 两次`);
// #1594 —— 真 AI 那条路（create-site.js 里 generateSlotPhotos 之后那个调用点）也发 `images` 事件、也写进建站报告。
//    打桩跑没有 Gemini key ⟹ 每张都求不到（generated 0），这一格量的是「接上了」，不是数本身（数由 image-slots.test.js ⑫ 量）。
check('#1594：真 AI 路发一条 images 事件（requested / generated / reused 三个数），建站报告的 images 那一格跟它相同', () => {
  const ev = A.events.filter((e) => e.event === 'images');
  assert.strictEqual(ev.length, 1, JSON.stringify(ev));
  const { event, elapsed, ...images } = ev[0];
  assert.deepStrictEqual(Object.keys(images).sort(), ['generated', 'requested', 'reused']);
  assert.ok(Object.values(images).every((v) => Number.isInteger(v)), JSON.stringify(images));
  const report = JSON.parse(fs.readFileSync(path.join(A.work, 'site', 'build-report.json'), 'utf8'));
  assert.strictEqual(report.path, 'ai');
  assert.deepStrictEqual(report.images, images);
});

const B = run('retry1', PAYLOAD(), { failCalls: { [FAIL_SLUG]: 1 } });
check(`AC 重试：失败一次 ⟹ 日志「重试第 ${FAIL_I} 页」、建站成功`, () => {
  assert.strictEqual(B.rc, 0, `${B.error}\n${B.stderr.slice(-600)}`);
  assert.ok(B.stderr.includes(`重试第 ${FAIL_I} 页`), B.stderr.split('\n').filter((l) => l.startsWith('[pages]')).join('\n'));
});
check('AC 重试：只有它被请求两次，别的页各一次', () => {
  for (const slug of BUILT) {
    assert.strictEqual(B.calls.filter((c) => c.kind === 'page' && c.slug === slug).length, slug === FAIL_SLUG ? 2 : 1, slug);
  }
});
const C = run('retry2', PAYLOAD(), { failCalls: { [FAIL_SLUG]: 2 } });
check(`AC 重试：两次都失败 ⟹ 建站成功，那一页发骨架页 + 恰好一条 degraded，写明是哪一页（${FAIL_SLUG}、第 ${FAIL_I}/${N} 页）（#1596）`, () => {
  assert.strictEqual(C.rc, 0, `${C.error}\n${C.stderr.slice(-600)}`);
  const d = C.events.filter((e) => e.event === 'degraded' && e.step === 'page');
  assert.strictEqual(d.length, 1, JSON.stringify(d));
  assert.strictEqual(d[0].target, FAIL_SLUG);
  assert.ok(d[0].reason.includes(`"${FAIL_SLUG}"`) && d[0].reason.includes(`Page ${FAIL_I}/${N}`), d[0].reason);
  const pg = JSON.parse(fs.readFileSync(path.join(C.work, 'site', 'zh', 'pages', `${FAIL_SLUG}.json`), 'utf8'));
  assert.deepStrictEqual((pg.blocks || pg.sections).map((b) => b.type), ['page-header', 'features', 'cta']);
  assert.strictEqual(pg.seo && pg.seo.placeholder, true);
});
// r2 那一格守的是 fatal() 退出前把 stdout 冲干净。#1596 之后「一页两次都失败」不再 fatal，换一个仍然会 fatal、而且
// 在全部提示词发完之后才 fatal 的地方：`Git commit failed`。#1598 起每个阶段各提交一次，第一次（plan）在每页那几通之前
// ⟹ 工作树做成真 git 仓，commit-msg 钩子只放行 plan 那一次，pages 阶段那次提交（全部 1 + N 份提示词都发完之后）被拒。
const rejectAfterPlan = (work) => {
  const git = (...a) => cp.execFileSync('git', a, { cwd: work, stdio: 'pipe' });
  git('init', '-q', '-b', 'main');
  git('config', 'user.email', 'stub@example.com');
  git('config', 'user.name', 'stub');
  git('config', 'core.hooksPath', '.git/hooks');
  fs.mkdirSync(path.join(work, '.git', 'hooks'), { recursive: true });
  fs.writeFileSync(path.join(work, '.git', 'hooks', 'commit-msg'), '#!/bin/sh\ngrep -q "(phase: plan " "$1" || { echo "rejected by test hook" >&2; exit 1; }\n', { mode: 0o755 });
};
const Cx = run('flush', PAYLOAD({ repoUrl: 'https://github.com/test/not-a-repo.git' }), {}, rejectAfterPlan);
check('r2：建站失败退出时 stdout 没丢尾巴 —— 全部 1 + N 份 Call 1 提示词都到了，最后一条事件就是 error', () => {
  // 失败前一口气发了 1 + N 份大提示词事件；stdout 不是阻塞写时 process.exit 会丢掉还没冲出去的尾巴（含 error 那条）。
  assert.notStrictEqual(Cx.rc, 0);
  assert.ok(Cx.error.startsWith('Git commit failed'), Cx.error);
  assert.strictEqual(call1Prompts(Cx.events).length, 1 + N, call1Prompts(Cx.events).map((p) => p.name).join(' · '));
  assert.strictEqual(Cx.events[Cx.events.length - 1].event, 'error');
});
check('反向对照：失败的那一页之外没有页被重试（每页各一次、它两次）', () => {
  assert.strictEqual(C.calls.filter((c) => c.kind === 'page' && c.slug === FAIL_SLUG).length, 2);
  assert.ok(C.calls.filter((c) => c.kind === 'page' && c.slug !== FAIL_SLUG).every((c) => c.turns === 1));
});

// ── 块库：一页不合格只重试这一页；整站缺块首页补 ────────────────────────────────────────────────────
console.log('── 块库：一页第一次不合格 / 整站缺「行业必需的块」');
const D = run('badblock', PAYLOAD(), { badFirst: ['services'] });
check('services 第一次块库不合格 ⟹ 只重试 services（问题原样退回，三轮对话），建站成功', () => {
  assert.strictEqual(D.rc, 0, `${D.error}\n${D.stderr.slice(-600)}`);
  const svc = D.calls.filter((c) => c.kind === 'page' && c.slug === 'services');
  assert.deepStrictEqual(svc.map((c) => c.turns), [1, 3]);
  assert.ok(/not-a-block/.test(svc[1].last), svc[1].last.slice(0, 300));
  assert.ok(D.calls.filter((c) => c.kind === 'page' && c.slug !== 'services').every((c) => c.turns === 1));
});
const E = run('sitefix', PAYLOAD({ industry: 'photography' }), { siteFix: true });
check('整站缺 gallery（photography 必需）⟹ 首页那一通补一次、建站成功', () => {
  assert.strictEqual(E.rc, 0, `${E.error}\n${E.stderr.slice(-600)}`);
  const fix = E.calls.filter((c) => c.kind === 'page' && c.slug === 'home' && c.turns === 3);
  assert.strictEqual(fix.length, 1);
  assert.ok(fix[0].last.includes('"gallery"'), fix[0].last.slice(0, 300));
  const home = JSON.parse(fs.readFileSync(path.join(E.work, 'site', 'zh', 'pages', 'home.json'), 'utf8'));
  assert.ok((home.blocks || home.sections).some((b) => b.type === 'gallery'));
});
const F = run('sitefix-no', PAYLOAD({ industry: 'photography' }), {});
check('反向对照：首页那一通补不上 ⟹ 原样发（不补块）+ 恰好一条 degraded，target 是 gallery（#1596，以前建站失败）', () => {
  assert.strictEqual(F.rc, 0, `${F.error}\n${F.stderr.slice(-600)}`);
  const d = F.events.filter((e) => e.event === 'degraded' && e.step === 'site-blocks');
  assert.strictEqual(d.length, 1, JSON.stringify(d));
  assert.strictEqual(d[0].target, 'gallery');
  assert.ok(d[0].reason.includes('still breaks the block library'), d[0].reason);
  const pagesDir = path.join(F.work, 'site', 'zh', 'pages');
  const all = [];
  const walk = (dir) => { for (const e of fs.readdirSync(dir, { withFileTypes: true })) { const f = path.join(dir, e.name); if (e.isDirectory()) walk(f); else all.push(JSON.parse(fs.readFileSync(f, 'utf8'))); } };
  walk(pagesDir);
  assert.ok(all.length > 0);
  assert.ok(!all.some((pg) => (pg.blocks || pg.sections || []).some((b) => b.type === 'gallery')), '站里多出了一块 gallery');
});

// ── r2：站级回包混进关键词页 ─────────────────────────────────────────────────────────────────────────
// Chris 2026-10-05 两次真 AI 建站：站级那一通把关键词当成页面写进 pages（`jian-fa-dian` 顶层页、`haircut/nan-shi-li-fa` 旧形状），
// 每页那几通照样生成了它们，Call 2 又按 T6 建了 `services/<id>/<词>` ⟹ 同一个词两张页、两份调用费。
console.log('── r2：站级回包的页面清单里混进关键词页（三种形状）');
// 不给主词：首页 / 服务详情页就没有目标词，桩写的文案过得了 T5 的检查（这一格量的是页面清单，不是 SEO）。
const KW_PAYLOAD = PAYLOAD({
  keywords: { '剪发': [
    { keyword: '剪发店', selected: true, volume: 300 },
    { keyword: '男士理发', selected: true, volume: 200 },
  ] },
});
const STRAY = ['jian-fa-dian', 'cut/nan-shi-li-fa', 'services/cut/jian-fa-dian'];
const strayPlan = (() => {
  const p = plan();
  for (const slug of STRAY) p.pages.push({ slug, title: slug, description: DESC(slug), navLabel: slug, navOrder: 20, changeFrequency: 'monthly', priority: 0.6, brief: `BRIEF<${slug}>` });
  return p;
})();
const K = run('stray-kw', KW_PAYLOAD, { plan: strayPlan });
check('建站成功', () => {
  assert.strictEqual(K.rc, 0, `${K.error}\n${K.stderr.slice(-800)}`);
});
check(`混进来的 ${STRAY.length} 页一页都没生成：Call 1 的 prompt 只有 Base Site + 原来的 ${N} 页，桩也没收到它们的每页调用`, () => {
  assert.deepStrictEqual(call1Prompts(K.events).map((p) => p.name), ['Base Site', ...BUILT.map((slug) => `Page: ${slug}`)]);
  assert.deepStrictEqual(K.calls.filter((c) => c.kind === 'page' && STRAY.includes(c.slug)).map((c) => c.slug), []);
  const lines = K.events.filter((e) => e.event === 'progress' && /^Page \d+\/\d+ written: /.test(e.message));
  assert.strictEqual(lines.length, N, lines.map((e) => e.message).join(' | '));
});
check('每丢一页日志一行，点名它', () => {
  const log = K.stderr.split('\n').filter((l) => l.startsWith('[pages] 站级回包里的'));
  assert.deepStrictEqual(log.map((l) => (l.match(/「([^」]+)」/) || [])[1]), STRAY, log.join('\n'));
});
check('Call 2 照常建关键词页（services/cut/<词>），站级那份没落盘', () => {
  const kwNames = K.events.filter((e) => e.event === 'prompt' && /^Keyword page: /.test(e.name)).map((e) => e.name).sort();
  assert.deepStrictEqual(kwNames, ['Keyword page: 剪发店', 'Keyword page: 男士理发']);
  const dir = path.join(K.work, 'site', 'zh', 'pages');
  assert.ok(fs.existsSync(path.join(dir, 'services', 'cut', 'jian-fa-dian.json')), 'Call 2 的关键词页没落盘');
  assert.ok(fs.existsSync(path.join(dir, 'services', 'cut', 'nan-shi-li-fa.json')), 'Call 2 的关键词页没落盘');
  assert.ok(!fs.existsSync(path.join(dir, 'jian-fa-dian.json')), '顶层 jian-fa-dian.json 还在');
  assert.ok(!fs.existsSync(path.join(dir, 'cut')), '旧形状目录 cut/ 还在');
});
check('站级提示词的关键词那一段写明关键词页不进 pages（有候选词时）；没有候选词的 A 跑不带这一句', () => {
  const site = call1Prompts(K.events)[0].content;
  assert.ok(site.includes('Keyword pages — built separately by the system') && site.includes('do NOT add them to "pages"'), site.slice(0, 1500));
  assert.ok(!call1Prompts(A.events)[0].content.includes('do NOT add them to "pages"'), 'A 跑（无关键词）也带了');
});

// ── 上限按模型截 ───────────────────────────────────────────────────────────────────────────────────
console.log('── AC haiku：上限存 128000、模型 haiku-4.5');
const G = run('haiku', PAYLOAD({ model: 'claude-haiku-4-5-20251001', maxTokens: '128000' }), {});
check('haiku-4.5 + 128000 ⟹ 建站成功，每一通发给 API 的 max_tokens 都是 64000', () => {
  assert.strictEqual(G.rc, 0, `${G.error}\n${G.stderr.slice(-600)}`);
  assert.ok(G.calls.length > N);
  assert.deepStrictEqual([...new Set(G.calls.map((c) => c.max_tokens))], [64000]);
  assert.ok(G.stderr.includes('[ai] max_tokens 128000 超过 claude-haiku-4-5-20251001 的输出上限 ⟹ 截到 64000'));
});
check('阳性对照：sonnet-4.6 + 128000 ⟹ 照发 128000（上面那格不是恒截）', () => {
  const H = run('sonnet', PAYLOAD({ model: 'claude-sonnet-4-6', maxTokens: '128000' }), {});
  assert.strictEqual(H.rc, 0, H.error);
  assert.deepStrictEqual([...new Set(H.calls.map((c) => c.max_tokens))], [128000]);
});
check('payload 不带上限 ⟹ 本地兜底 128000（create-site.js 的模块默认值）', () => {
  assert.deepStrictEqual([...new Set(A.calls.map((c) => c.max_tokens))], [128000]);
});

// ── 目标词进了那一页的提示词（只看提示词：用 call1-prompts.testkit 的桩，不建站）────────────────────────
console.log('── 做什么 2：这一页的目标词');
check('首页带站主词、服务详情页带它服务的主词、faq 不带目标词（#1601：plumbing 的配方没有 about，有 faq）', () => {
  const work = makeTree('kw');
  const { call1Prompts: promptsOf } = require('./lib/call1-prompts.testkit');
  const r = promptsOf(work, {
    siteId: 'c1kw0001', siteUrl: 'https://brightpipes.test', companyName: 'Bright Pipes', industry: 'plumbing', location: 'Toronto, ON', language: 'en',
    services: ['Drain Cleaning', 'Water Heaters', 'Sump Pumps'], homepageFingerprint: false,
    keywords: {
      'Drain Cleaning': [{ keyword: 'drain cleaning toronto', isPrimary: true, selected: true, volume: 900 }],
      'Water Heaters': [{ keyword: 'water heater repair', isPrimary: true, selected: true, volume: 500 }],
    },
  });
  const pg = (slug) => (r.pages.find((p) => p.name === `Page: ${slug}`) || {}).content || '';
  assert.ok(pg('home').includes('- target keyword: "drain cleaning toronto"'), pg('home').slice(0, 400));
  assert.ok(pg('services/drain-cleaning').includes('- target keyword: "drain cleaning toronto"'));
  assert.ok(pg('services/water-heaters').includes('- target keyword: "water heater repair"'));
  assert.ok(!pg('faq').includes('- target keyword:') && pg('faq').length > 0);
  assert.ok(!pg('services/sump-pumps').includes('- target keyword:'), '没有关键词的服务');
});

// ══ #1601 整站配方（AC2–AC5）：同一套桩，站级回包照旧列一大堆页 ════════════════════════════════════════
// 期望值在这里写死（不从 lib/site-recipe.js 读）：beauty 组 = 首页 + 服务列表页 + 每个服务一页 + contact；
// 每页的块序按 #1601 交付里那张表抄（services 列表页 / 服务页 / contact 三种）。
console.log('── #1601 AC2：站级回包塞 15 页（含 gallery / faq / quote），建出来的是配方那一份');
const FIFTEEN = (() => {
  const p = plan();
  const page = (slug, title, navOrder) => ({ slug, title, description: DESC(title), navLabel: title, navOrder, changeFrequency: 'monthly', priority: 0.7, brief: `BRIEF<${slug}>` });
  p.pages = [
    page('home', '首页', 0), page('services', '服务', 1), page('about', '关于我们', 2), page('gallery', '作品', 3),
    page('faq', '常见问题', 4), page('quote', '预约', 5), page('contact', '联系我们', 6),
    ...SERVICES.map(([id, name], i) => ({ ...page(`services/${id}`, name, 10 + i), serviceDetailPage: true, parentService: id })),
    page('jian-fa-dian', '剪发店', 30),
  ];
  return p;
})();
const R1 = run('recipe-15', KW_PAYLOAD, { plan: FIFTEEN });
const pagesOn = (work) => {
  const dir = path.join(work, 'site', 'zh', 'pages');
  const out = [];
  const walk = (d, pre) => { for (const f of fs.readdirSync(d)) { const full = path.join(d, f); if (fs.statSync(full).isDirectory()) walk(full, `${pre}${f}/`); else if (f.endsWith('.json')) out.push(`${pre}${f.slice(0, -5)}`); } };
  walk(dir, '');
  return out.sort();
};
check('AC2：回包有 15 页，站的页面集合 == 配方（首页 · services · 7 张服务页 · contact）+ 2 张关键词页；about / gallery / faq / quote 一张都不在', () => {
  assert.strictEqual(FIFTEEN.pages.length, 15);
  assert.strictEqual(R1.rc, 0, `${R1.error}\n${R1.stderr.slice(-800)}`);
  assert.deepStrictEqual(pagesOn(R1.work), [...BUILT, 'services/cut/jian-fa-dian', 'services/cut/nan-shi-li-fa'].sort());
});
check('AC2：配方外那几页各一行日志说不采用', () => {
  const log = R1.stderr.split('\n').filter((l) => l.startsWith('[recipe] 站级回包里的'));
  assert.deepStrictEqual(log.map((l) => (l.match(/「([^」]+)」/) || [])[1]).sort(), ['about', 'faq', 'gallery', 'quote']);
});
check('AC2：站级提示词不再让 AI 挑页（没有 DYNAMIC PAGE SELECTION / 「choose 2-4 more pages」/ 原型清单），而是点名这几页、按钮指 contact', () => {
  const site = call1Prompts(R1.events)[0].content;
  for (const gone of ['DYNAMIC PAGE SELECTION', 'choose 2-4 more pages', '"gallery" — Portfolio', 'Skip service detail pages']) assert.ok(!site.includes(gone), `还有「${gone}」`);
  assert.ok(site.includes('PAGES OF THIS WEBSITE (fixed'), site.slice(0, 600));
  assert.ok(site.includes('- navigation.ctaPage must be "contact".'));
  assert.ok(site.includes('"ctaPage": "contact"'));
});
check('AC2：每页那一通的提示词写着配方给这一页的块序（三种页各对一次）', () => {
  const ps = call1Prompts(R1.events);
  const order = (slug) => ((ps.find((p) => p.name === `Page: ${slug}`) || {}).content || '').match(/write exactly these \d+, in this order: ([^\n]+?)\. Do not/);
  assert.strictEqual((order('services') || [])[1], '"page-header" → "features" → "cta"');
  assert.strictEqual((order('services/perm') || [])[1], '"page-header" → "content" → "features" → "faq" → "cta"');
  assert.strictEqual((order('contact') || [])[1], '"page-header" → "contact"');
  assert.strictEqual(order('home'), null, '首页归 #1034 的配方，不该有固定块序');
});
check('AC2：落盘的块序就是配方那一份；预设写进了 options（服务列表页的 features = Cards 那组旋钮）', () => {
  const read = (slug) => JSON.parse(fs.readFileSync(path.join(R1.work, 'site', 'zh', 'pages', `${slug}.json`), 'utf8'));
  const types = (slug) => (read(slug).blocks || read(slug).sections).map((b) => b.type);
  assert.deepStrictEqual(types('services'), ['page-header', 'features', 'cta']);
  assert.deepStrictEqual(types('contact'), ['page-header', 'contact']);
  const feat = (read('services').blocks || read('services').sections).find((b) => b.type === 'features');
  const cards = JSON.parse(fs.readFileSync(path.join(NEXT, 'blocks', 'features', 'manifest.json'), 'utf8')).presets.find((p) => p.name === 'Cards').knobs;
  for (const [k, v] of Object.entries(cards)) assert.strictEqual(feat.data.options[k], v, `features.options.${k}`);
});
check('AC2 反向对照：块序不照配方写 ⟹ 当作块库不合格重试这一页（桩第一次多塞一块，第二次照写）', () => {
  // badFirst 那一跑（上面 D）：services 第一次多了一块 not-a-block ⟹ 退回的问题里点名块序。
  const svc = D.calls.filter((c) => c.kind === 'page' && c.slug === 'services');
  assert.ok(/this page's sections must be exactly "page-header" → "features" → "cta"/.test(svc[1].last), svc[1].last.slice(0, 400));
});

check('AC2：关键词页那一通的 CTA 指站的按钮落点 /contact，不再写死 "/quote"（配方的站没有 quote 页）', () => {
  const kw = R1.events.filter((e) => e.event === 'prompt' && /^Keyword page: /.test(e.name || ''));
  assert.strictEqual(kw.length, 2, kw.map((e) => e.name).join(' · '));
  for (const e of kw) {
    assert.ok(/- CTA href points to "\/contact"/.test(e.content), `${e.name}: ${(e.content.match(/- CTA href[^\n]*/) || ['（没有 CTA 那一行）'])[0]}`);
    assert.ok(!e.content.includes('"/quote"'), `${e.name} 还写着 "/quote"`);
  }
});

console.log('── #1601 AC3：导航与按钮（同 AC2 那个站，读 navigation.json）');
const NAV = () => JSON.parse(fs.readFileSync(path.join(R1.work, 'site', 'zh', 'navigation.json'), 'utf8'));
check('AC3：行动按钮的 href 指向的页在建成的页面集合里', () => {
  const href = NAV().header.cta.href;
  const slug = href === '/' ? 'home' : href.replace(/^\//, '');
  assert.ok(pagesOn(R1.work).includes(slug), `${href} 不在 ${pagesOn(R1.work).join(' ')}`);
});
/** 顶部导航到得了哪些服务页：直接在链接里的，加上链接里某一页上 `items: {source: "services"}` 那一块列出的（有那张服务页才带链接）。 */
const reachableServices = (work, links) => {
  const out = new Set();
  for (const l of links) {
    const slug = l.href === '/' ? 'home' : l.href.replace(/^\//, '');
    if (/^services\/[^/]+$/.test(slug)) out.add(slug);
    const f = path.join(work, 'site', 'zh', 'pages', `${slug}.json`);
    if (!fs.existsSync(f)) continue;
    const j = JSON.parse(fs.readFileSync(f, 'utf8'));
    if ((j.blocks || j.sections || []).some((b) => b.type === 'features' && b.data && b.data.items && b.data.items.source === 'services')) {
      for (const s of pagesOn(work)) if (/^services\/[^/]+$/.test(s)) out.add(s);
    }
  }
  return [...out].sort();
};
check('AC3：7 张服务页，每一张要么在顶部导航的链接里、要么是导航里某一页上 {source: "services"} 那一块列出的', () => {
  const svcPages = pagesOn(R1.work).filter((s) => /^services\/[^/]+$/.test(s));
  assert.strictEqual(svcPages.length, 7);
  assert.deepStrictEqual(reachableServices(R1.work, NAV().header.links), svcPages);
});

// AC3 对抗臂：回包里没有服务列表页、没有 quote 页，按钮却写着 ctaPage: 'quote'（今天 AI 回包的常见形状）。
//    在 origin/main 上这一跑两格都红：顶部导航只剩 Home、按钮指一张不存在的 /quote。
const R3x = run('recipe-nav-adversarial', PAYLOAD(), { plan: (() => {
  const p = plan();
  p.pages = p.pages.filter((x) => x.slug === 'home' || x.serviceDetailPage);
  p.navigation = { ...p.navigation, ctaPage: 'quote' };
  return p;
})(), seoFixDesc: true });
check('AC3 对抗臂：回包不给服务列表页、按钮写 quote ⟹ 按钮仍指建成的页，7 张服务页仍都到得了', () => {
  assert.strictEqual(R3x.rc, 0, `${R3x.error}\n${R3x.stderr.slice(-800)}`);
  const nav = JSON.parse(fs.readFileSync(path.join(R3x.work, 'site', 'zh', 'navigation.json'), 'utf8'));
  const href = nav.header.cta.href;
  assert.ok(pagesOn(R3x.work).includes(href === '/' ? 'home' : href.replace(/^\//, '')), `${href} 不在 ${pagesOn(R3x.work).join(' ')}`);
  const svcPages = pagesOn(R3x.work).filter((s) => /^services\/[^/]+$/.test(s));
  assert.strictEqual(svcPages.length, 7);
  assert.deepStrictEqual(reachableServices(R3x.work, nav.header.links), svcPages);
});

console.log('── #1601 AC4：勾了「照抄参照站结构」⟹ 不走配方');
const REF = { refSite: 'https://ref.test', refPrefs: ['structure'], refAnalysis: { navLinks: ['Home', 'Services', 'Gallery', 'Contact'] } };
const R4 = run('recipe-structure', PAYLOAD(REF), { plan: FIFTEEN });
const R4n = run('recipe-structure-off', PAYLOAD({ ...REF, refPrefs: [] }), { plan: FIFTEEN });
check('AC4：勾 structure ⟹ 页面清单仍来自参照站那条老路（gallery 在），站级提示词是老的那段', () => {
  assert.strictEqual(R4.rc, 0, `${R4.error}\n${R4.stderr.slice(-800)}`);
  assert.ok(pagesOn(R4.work).includes('gallery'), pagesOn(R4.work).join(' '));
  assert.ok(call1Prompts(R4.events)[0].content.includes('REFERENCE SITE NAVIGATION (HARD COPY'));
  assert.ok(!call1Prompts(R4.events)[0].content.includes('PAGES OF THIS WEBSITE (fixed'));
});
check('AC4 反向读数：同一份 payload 不勾 structure ⟹ gallery 不出现（上一格不是恒绿）', () => {
  assert.strictEqual(R4n.rc, 0, `${R4n.error}\n${R4n.stderr.slice(-800)}`);
  assert.ok(!pagesOn(R4n.work).includes('gallery'), pagesOn(R4n.work).join(' '));
});

console.log('── #1601 AC5：只填 1 个服务');
const ONE = (() => {
  const p = plan();
  p.services = p.services.slice(0, 1);
  // 回包里一张服务页都不给 —— 照老提示词（少于 3 个服务就「Skip service detail pages」）办事的 AI 就是这么回的。
  //    服务页要从配方来，不是从回包来（这一格在 origin/main 上读红：那里 1 个服务的站没有服务页）。
  p.pages = p.pages.filter((x) => !x.serviceDetailPage);
  return p;
})();
const R5 = run('recipe-one', PAYLOAD({ services: ['剪发'] }), { plan: ONE, seoFixDesc: true });
check('AC5：1 个服务 ⟹ 有 1 张 services/<id>，顶部导航（按 AC3 的判法）到得了它', () => {
  assert.strictEqual(R5.rc, 0, `${R5.error}\n${R5.stderr.slice(-800)}`);
  const svc = pagesOn(R5.work).filter((s) => /^services\/[^/]+$/.test(s));
  assert.deepStrictEqual(svc, ['services/cut']);
  const nav = JSON.parse(fs.readFileSync(path.join(R5.work, 'site', 'zh', 'navigation.json'), 'utf8'));
  assert.deepStrictEqual(reachableServices(R5.work, nav.header.links), ['services/cut']);
});
check('AC5：站级提示词里没有「Skip service detail pages」，服务页那一行写的是 1 page', () => {
  const site = call1Prompts(R5.events)[0].content;
  assert.ok(!site.includes('Skip service detail pages'));
  assert.ok(site.includes('one page for EACH service (1 page)'), site.slice(0, 1500));
});

console.log(`\n══ 汇总: 通过 ${pass} · 失败 ${fail} ══`);
process.exit(fail ? 1 : 0);
