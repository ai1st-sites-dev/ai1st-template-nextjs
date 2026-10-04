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
//   AC 重试     一张服务详情页调用失败一次 ⟹ 「重试第 i 页」、建站成功、只有它被请求两次；两次都失败 ⟹ 建站失败、信息写明是哪一页
//   AC haiku    模型 haiku-4.5、上限 128000 ⟹ 发给 API 的上限 64000（不是被拒）；sonnet 那一臂照发 128000（阳性对照）
//   做什么 2    每页提示词只带那一页：自己的 slug / brief / 目标词，没有别页的 brief；站级那一份不带块菜单
//   块库        一页第一次块库不合格 ⟹ 只重试这一页；整站缺「行业必需的块」⟹ 首页那一通补一次，补不上建站失败
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
const BODY = '我们在多伦多为每一位顾客提供细致的护理与造型服务，预约简单，到店即享专业建议，环境舒适安心，欢迎随时来店体验我们团队带来的放松时光与焕然一新的造型。';
function sectionsFor(slug, title) {
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
      : first.includes('An automatic SEO check found the problems') ? 'seo-rewrite' : 'other';
  const slug = kind === 'page' ? (first.match(/- slug: "([^"]+)"/) || [])[1] : null;
  if (slug) seen[slug] = (seen[slug] || 0) + 1;
  fs.appendFileSync(process.env.C1_STUB_CALLS, JSON.stringify({ kind, slug, turns, max_tokens: req.max_tokens, first, last }) + '\n');
  if (kind === 'site') return { json: cfg.plan, out: cfg.siteOut || 4000 };
  if (kind === 'page') {
    // failCalls[slug] = 这一页前几次调用回 400（不可重试的 API 错 ⟹ callAIWithRetry 当场抛）
    if ((cfg.failCalls || {})[slug] >= seen[slug]) { const e = new Error(`stub: page ${slug} refused (call ${seen[slug]})`); e.status = 400; throw e; }
    const page = cfg.plan.pages.find((p) => p.slug === slug);
    let sections = sectionsFor(slug, page.title);
    // badFirst[slug]：第一次给一个块库不认的块（只重试这一页）
    if ((cfg.badFirst || []).includes(slug) && seen[slug] === 1) sections = [...sections, { type: 'not-a-block', data: {} }];
    // gallery：整站检查之后首页那一通补（cfg.siteFix）—— 只在那一通（问题里点名整站）才加
    if (slug === 'home' && cfg.siteFix && turns > 1 && /The website as a whole/.test(last)) {
      sections = [...sections, { type: 'gallery', data: { headline: '作品集', items: [1, 2].map((n) => ({ image: { imageUrl: '/images/grid-pattern.svg', alt: '店里完成的一次造型' }, title: `作品 ${'甲乙'[n - 1]}`, caption: '一次造型。' })) } }];
    }
    return { json: { sections }, out: cfg.pageOut || 3000 };
  }
  if (kind === 'seo-rewrite') {
    const env = JSON.parse((first.match(/\n\n(\{[\s\S]*?\n\})\n\nPROBLEMS TO FIX/) || [])[1]);
    return { json: env, out: 1000 };
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
    ],
  };
}
const N = plan().pages.length; // 4 + 7 = 11
const PAYLOAD = (extra = {}) => ({
  siteId: 'c1zh0001', siteUrl: 'https://silky.test', companyName: 'Silky Hair Salon', industry: 'hair salon', location: 'Toronto, ON',
  language: 'zh', services: SERVICES.map(([, n]) => n), homepageFingerprint: false, ...extra,
});

function run(label, payload, cfg) {
  const work = makeTree(label);
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
  assert.deepStrictEqual(ps.map((p) => p.name), ['Base Site', ...plan().pages.map((p) => `Page: ${p.slug}`)]);
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
  for (const p of plan().pages) assert.strictEqual(A.calls.filter((c) => c.kind === 'page' && c.slug === p.slug).length, 1, p.slug);
});
check('落盘：每页的块就是那一页那一通回的 sections，页面文件里没有 brief', () => {
  const dir = path.join(A.work, 'site', 'zh', 'pages');
  for (const p of plan().pages) {
    const j = JSON.parse(fs.readFileSync(path.join(dir, `${p.slug}.json`), 'utf8'));
    assert.ok(!('brief' in j), `${p.slug} 带着 brief`);
    const types = (j.blocks || j.sections || []).map((b) => b.type);
    assert.strictEqual(types[0], p.slug === 'home' ? 'hero' : 'page-header', `${p.slug}: ${types.join(',')}`);
  }
});
check('做什么 2：每页提示词只带这一页（自己的 slug / brief 各一次，别页的 brief 0 次）；站级那一份不带块菜单', () => {
  const ps = call1Prompts(A.events);
  const site = ps[0].content;
  assert.ok(!site.includes('AVAILABLE SECTION TYPES') && !site.includes('HOMEPAGE SECTIONS'), '站级提示词里有块菜单');
  for (const p of ps.slice(1)) {
    const slug = p.name.replace(/^Page: /, '');
    assert.strictEqual(p.content.split(`- slug: "${slug}"`).length - 1, 1, `${slug}：自己的 slug 行不是恰好一次`);
    assert.ok(p.content.includes(`BRIEF<${slug}>`), `${slug}：没有自己的 brief`);
    const others = plan().pages.filter((x) => x.slug !== slug && p.content.includes(`BRIEF<${x.slug}>`)).map((x) => x.slug);
    assert.deepStrictEqual(others, [], `${slug} 的提示词里有别页的 brief`);
    assert.ok(p.content.includes('AVAILABLE SECTION TYPES'), `${slug}：没有块菜单`);
  }
});
check('做什么 2：服务详情页的提示词点名它自己的服务、带 5-7 块那一行；首页的带首页那几条', () => {
  const ps = call1Prompts(A.events);
  const perm = ps.find((p) => p.name === 'Page: services/perm').content;
  assert.ok(perm.includes('This is the detail page of the service "烫发" (id perm). It needs 5-7 sections:'), perm.slice(0, 200));
  const home = ps.find((p) => p.name === 'Page: home').content;
  assert.ok(home.includes('- This is the HOME page.') && /There are \d+ section types/.test(home));
  assert.ok(!perm.includes('- This is the HOME page.') && !/There are \d+ section types/.test(perm));
});

// ── 重试：一张服务详情页失败一次 / 两次 ─────────────────────────────────────────────────────────────
const FAIL_SLUG = 'services/perm';
const FAIL_I = plan().pages.findIndex((p) => p.slug === FAIL_SLUG) + 1;
console.log(`── 重试：${FAIL_SLUG}（第 ${FAIL_I} 页）调用失败一次 / 两次`);
const B = run('retry1', PAYLOAD(), { failCalls: { [FAIL_SLUG]: 1 } });
check(`AC 重试：失败一次 ⟹ 日志「重试第 ${FAIL_I} 页」、建站成功`, () => {
  assert.strictEqual(B.rc, 0, `${B.error}\n${B.stderr.slice(-600)}`);
  assert.ok(B.stderr.includes(`重试第 ${FAIL_I} 页`), B.stderr.split('\n').filter((l) => l.startsWith('[pages]')).join('\n'));
});
check('AC 重试：只有它被请求两次，别的页各一次', () => {
  for (const p of plan().pages) {
    assert.strictEqual(B.calls.filter((c) => c.kind === 'page' && c.slug === p.slug).length, p.slug === FAIL_SLUG ? 2 : 1, p.slug);
  }
});
const C = run('retry2', PAYLOAD(), { failCalls: { [FAIL_SLUG]: 2 } });
check(`AC 重试：两次都失败 ⟹ 建站失败，信息写明是哪一页（${FAIL_SLUG}、第 ${FAIL_I}/${N} 页）`, () => {
  assert.notStrictEqual(C.rc, 0);
  assert.ok(C.error.includes(`"${FAIL_SLUG}"`) && C.error.includes(`Page ${FAIL_I}/${N}`), C.error);
});
check('反向对照：失败的那一页之外没有页被重试（每页各一次、它两次）', () => {
  assert.strictEqual(C.calls.filter((c) => c.kind === 'page' && c.slug === FAIL_SLUG).length, 2);
  assert.ok(C.calls.filter((c) => c.kind === 'page' && c.slug !== FAIL_SLUG).every((c) => c.turns === 1));
});

// ── 块库：一页不合格只重试这一页；整站缺块首页补 ────────────────────────────────────────────────────
console.log('── 块库：一页第一次不合格 / 整站缺「行业必需的块」');
const D = run('badblock', PAYLOAD(), { badFirst: ['about'] });
check('about 第一次块库不合格 ⟹ 只重试 about（问题原样退回，三轮对话），建站成功', () => {
  assert.strictEqual(D.rc, 0, `${D.error}\n${D.stderr.slice(-600)}`);
  const about = D.calls.filter((c) => c.kind === 'page' && c.slug === 'about');
  assert.deepStrictEqual(about.map((c) => c.turns), [1, 3]);
  assert.ok(/not-a-block/.test(about[1].last), about[1].last.slice(0, 300));
  assert.ok(D.calls.filter((c) => c.kind === 'page' && c.slug !== 'about').every((c) => c.turns === 1));
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
check('反向对照：首页那一通补不上 ⟹ 建站失败（同 #999「只重试一次」）', () => {
  assert.notStrictEqual(F.rc, 0);
  assert.ok(F.error.includes('still breaks the block library') && F.error.includes('gallery'), F.error);
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
check('首页带站主词、服务详情页带它服务的主词、about 不带目标词', () => {
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
  assert.ok(!pg('about').includes('- target keyword:') && pg('about').length > 0);
  assert.ok(!pg('services/sump-pumps').includes('- target keyword:'), '没有关键词的服务');
});

console.log(`\n══ 汇总: 通过 ${pass} · 失败 ${fail} ══`);
process.exit(fail ? 1 : 0);
