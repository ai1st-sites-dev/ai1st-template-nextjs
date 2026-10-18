#!/usr/bin/env node
// #1598 —— 建站分五个阶段存档、「续跑」从最后一个完成的阶段接着做。真 create-site.js 进程，`@anthropic-ai/sdk` 换成按提示词
// 回放的桩（同 create-site-call1-pages.test.js 的做法，输入也是它那份 7 服务中文站 + 两个关键词页）。
// #1829 (SiteAsData T3a) —— 改成 manager 那条路的形状：payload 带 `outDir`，每个阶段（最后一个除外）做完发一行 `phase-saved`
// 带一份快照目录（manager 把它写进 sites.content，version 0），续跑 = 新的空输出目录 + 把那份快照的 site/ 写回去 + resume:true
// （manager §runSiteCreate 的 Resume 就是这么做的）。不再有 git 仓、提交、推送 —— 那几段（推送失败、#1613 提交被拒、
// entrypoint.sh 的「存进仓了没有」、版本历史夹具）随那条路一起删了。
//
// 🔴 不是 skipAI：skipAI 在五个阶段之前就 return（PM 裁定 ①），这里每一格在它上面都量不到东西。
// 🔴 不调真 AI（#1499）。
//
// 「spy 计数」怎么数（AC2）：plan 阶段的唯一外部动作是站级那一通（桩记成 kind=site，同时发 `Base Site` 提示词事件），
// pages 阶段是每页那几通（kind=page，`Page: <slug>` 提示词事件、`Page i/N written` 进度）。三样都数到 0 ⟹ 两个阶段的函数没被调用。
//
// 量的是：
//   快照              从头建 ⟹ 4 份 `phase-saved` 快照，顺序 plan → pages → images → keywordPages；最后一个阶段不拍（脚本退出后读的就是它）
//   不变量            每份快照里，标记（site_meta.json buildPhase）和存档（.build/state.json）同在、对得上；最终 site/ 没有存档
//   输出目录          站点文件全在 outDir 下，模板根的 site/ 一个字节没动；整个进程不碰 git
//   AC2               buildPhase = pages 时续跑 ⟹ 站级 / 每页调用 0；最终站点文件跟从头建那次逐字节相同
//   主题              续跑时 manager 送来的轮换下标会挑出另一套主题（阳性对照），站仍是存档里那套（PM r2 点名要的断言）
//   做什么 4          续跑的第一条进度从那个阶段做完时的百分比开始
//   裁定 一           不带 resume 的 Rebuild 照旧从头建（buildPhase 已是最后一个阶段时也一样）
//   #1600 建站报告    从 pages / images / keywordPages 续跑，报告（去掉写盘时间、耗时）跟从头建那次相同
//   #1593 costUsd     快照里的存档不带 costUsd（它在最后一个阶段之前才写进报告，而最后一个阶段删掉存档）
//   #1593 第二语言    zh + en 的站从 pages / keywordPages 续跑：第二语言的账跟着存档走，site/en 跟从头建那次逐字节相同
//   其余              从 images / keywordPages 续 · 已建完再续 · 没有存档 / 存档对不上 ⟹ 从头建
'use strict';

const assert = require('assert');
const cp = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const NEXT = path.resolve(__dirname, '..');
const PHASES = ['plan', 'pages', 'images', 'keywordPages', 'secondaryLocales'];
const TEMP = [];
process.on('exit', () => {
  if (process.env.RS_KEEP === '1') { if (TEMP.length) console.log(`📌 RS_KEEP=1 ⟹ 留着 ${TEMP.join(' ')}`); return; }
  for (const d of TEMP) { try { fs.rmSync(d, { recursive: true, force: true }); } catch (e) { /* 打扫不成不改结论 */ } }
});
function die(msg) { console.log(`💥 ${msg}`); process.exit(2); }

let pass = 0;
let fail = 0;
function check(name, fn) {
  try { fn(); pass += 1; console.log(`  ✅ ${name}`); } catch (e) { fail += 1; console.log(`  ❌ ${name}\n     ${e.message}`); }
}

// ── 桩（同 create-site-call1-pages.test.js：认得站级 / 每页 / 关键词页 / SEO 重写四种调用）───────────────────────
function stubMain() {
'use strict';
const Module = require('module');
const fs = require('fs');
const cfg = JSON.parse(fs.readFileSync(process.env.RS_STUB_CFG, 'utf8'));
globalThis.fetch = async () => { throw new Error('offline (test stub)'); };
const BODY = '我们在多伦多为每一位顾客提供细致的护理与造型服务，预约简单，到店即享专业建议，环境舒适安心，欢迎随时来店体验我们团队带来的放松时光与焕然一新的造型。';
const DESC_KW = (kw) => `${kw}就在 Toronto：Silky Hair Salon 在多伦多为每一位顾客提供细致的${kw}服务，预约简单，到店即享专业建议，环境舒适安心，欢迎随时来店体验焕然一新的造型。`;
// #1601 —— 非首页的块序由整站配方定，写在提示词里（`write exactly these N, in this order: "a" → "b"`）：桩照它回，
//    每种块一份过得了块库的 data（同 create-site-call1-pages.test.js 的桩）。
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
// #1593 —— 有第二语言（en）时回包按语言分组：第二语言那一份 = 主语言同一组块、每段字前面加 "EN "（结构逐字相同，取主语言的格子
// 写盘时照样取主语言那份）。
const KEEP = new Set(['type', 'href', 'style', 'source', 'icon', 'id', 'imageUrl', 'kind', 'size', 'role']);
const enText = (v) => (typeof v === 'string' ? (v ? `EN ${v}` : v) : Array.isArray(v) ? v.map(enText)
  : v && typeof v === 'object' ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, KEEP.has(k) ? x : enText(x)])) : v);
const enGroup = (pg, sections) => ({ title: enText(pg.title), description: enText(pg.description), navLabel: enText(pg.navLabel || pg.title), targetKeyword: 'haircut', sections: enText(sections) });
function answer(req) {
  const first = req.messages[0].content;
  const grouped = first.includes('Respond with ONE JSON object keyed by language code');
  const kind = first.includes('Generate a JSON object with this EXACT structure') ? 'site'
    : first.includes('Write the sections of ONE page') ? 'page'
      : first.includes('Write ONE keyword landing page') ? 'keyword'
        : first.includes('An automatic SEO check found the problems') ? 'seo-rewrite' : 'other';
  const slug = kind === 'page' || kind === 'keyword' ? (first.match(/- slug: "([^"]+)"/) || [])[1] : null;
  fs.appendFileSync(process.env.RS_STUB_CALLS, JSON.stringify({ kind, slug }) + '\n');
  // #1596 —— 站级那一通被截断 ⟹ create-site 用代码拼的站级计划（降级记一笔）
  if (kind === 'site' && cfg.site === 'truncated') return { json: cfg.plan, out: 4000, stop: 'max_tokens' };
  if (kind === 'site') return { json: cfg.locales ? { ...cfg.plan, locales: cfg.locales } : cfg.plan, out: 4000 };
  if (kind === 'page') {
    // #1596 —— 走代码拼的站级计划时，页面清单不是 plan() 那份（services/<拼音 id>、contact）⟹ 认不出的页用 slug 当标题
    const page = cfg.plan.pages.find((p) => p.slug === slug) || { slug, title: slug };
    const sections = sectionsFor(slug, page.title, first);
    return { json: grouped ? { zh: { sections }, en: enGroup(page, sections) } : { sections }, out: 3000 };
  }
  if (kind === 'keyword') {
    const kw = (first.match(/- target keyword: "([^"]+)"/) || [])[1];
    const sections = [
      { type: 'page-header', data: { headline: `${kw}｜多伦多` } },
      { type: 'content', data: { headline: `${kw}怎么做`, body: `${kw}：${BODY}` } },
      { type: 'faq', data: { headline: `${kw}常见问题`, items: [{ question: `${kw}需要预约吗？`, answer: '建议提前预约，也欢迎直接到店。' }] } },
      { type: 'cta', data: { headline: '现在预约', body: '告诉我们您想要的造型。', ctas: [{ label: '预约', href: '/quote', style: 'solid' }] } },
    ];
    const pg = { slug, title: `${kw}｜多伦多`, description: DESC_KW(kw), navLabel: kw, navOrder: 50, changeFrequency: 'monthly', priority: 0.6, sections };
    return { json: grouped ? { zh: pg, en: enGroup(pg, sections) } : pg, out: 2000 };
  }
  if (kind === 'seo-rewrite' && first.includes('TEXTS TO FIX:')) {
    // #1593 起修补是字段级的：原样退回那几个字段（修不好 —— 主语言那几跑本来就不会走到这里，第二语言修不好只记日志）。
    return { json: { fields: JSON.parse((first.match(/TEXTS TO FIX:\n(\{[\s\S]*?\n\})\n\nPROBLEMS TO FIX/) || [])[1]) }, out: 1000 };
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
          return { content: [{ type: 'text', text: JSON.stringify(a.json) }], usage: { input_tokens: 100, output_tokens: a.out }, stop_reason: a.stop || 'end_turn' };
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

// ── 输入（同 create-site-call1-pages.test.js 的 KW_PAYLOAD：7 服务、中文、两个关键词页）─────────────────────────
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
    navigation: { ctaLabel: '立即预约', ctaPage: 'contact', footerDescription: '多伦多的美发沙龙。' },
    seo: { siteTitle: 'Silky Hair Salon 多伦多美发', siteDescription: DESC('多伦多美发'), areaServed: [{ type: 'City', name: 'Toronto' }], addresses: [], priceRange: '$$', offerCatalogName: '服务' },
    services: SERVICES.map(([id, name]) => ({ id, name, shortDescription: `${name}服务`, fullDescription: `${name}，在多伦多。`, icon: 'scissors', features: ['细致'], products: [] })),
    forms: [{ id: 'contact', name: '联系', buttonText: '提交', successMessage: '谢谢' }],
    // #1601 —— 页面清单由整站配方定（hair salon = beauty 组：首页 · services · 每个服务一页 · contact），回包照配方给；
    //    配方外的页（about / quote …）回了也不采用，那一面归 create-site-call1-pages.test.js 的 AC2。
    pages: [
      page('home', '首页', 0), page('services', '服务', 1),
      ...SERVICES.map(([id, name], i) => page(`services/${id}`, name, 10 + i, { serviceDetailPage: true, parentService: id })),
      page('contact', '联系我们', 9),
    ],
  };
}
const N = plan().pages.length;
// #1593 —— 站级那一份第二语言（en）的字，形状同 create-site-all-locales.test.js 的夹具。
const EN_SITE = {
  tagline: 'Silky-smooth hair', ctaLabel: 'Book now', footerDescription: 'A hair salon in Toronto.', homeLabel: 'Home', quickLinksTitle: 'Quick links',
  copyright: 'Silky Hair Salon. All rights reserved.',
  seo: { siteTitle: 'Haircut | Silky Hair Salon', siteDescription: 'Haircut in Toronto: Silky Hair Salon gives every guest careful, friendly service, easy booking and a calm place to relax.', offerCatalogName: 'Services' },
  services: SERVICES.map(([id, name]) => ({ id, name: `EN ${name}`, shortDescription: `EN ${name} service`, fullDescription: `EN ${name} in Toronto.`, features: ['Careful'], products: [] })),
  forms: [{ id: 'contact', name: 'Contact', buttonText: 'Send', successMessage: 'Thanks' }],
  contactPage: { title: 'Contact us', navLabel: 'Contact', description: 'Get in touch with Silky Hair Salon', headline: 'Contact us', subheadline: 'Send us a message.', formHeadline: 'Get in touch', formBody: 'Leave your details.' },
};
const INDUSTRY = 'hair salon';
const PAYLOAD = (extra = {}) => ({
  siteId: 'rs159801', siteUrl: 'https://silky.test', companyName: 'Silky Hair Salon', industry: INDUSTRY, location: 'Toronto, ON',
  language: 'zh', services: SERVICES.map(([, n]) => n), homepageFingerprint: false,
  keywords: { '剪发': [{ keyword: '剪发店', selected: true, volume: 300 }, { keyword: '男士理发', selected: true, volume: 200 }] },
  themeRotationIndex: 0,
  ...extra,
});

// ── 工作区 ─────────────────────────────────────────────────────────────────────────────────────────────────
/** 一份模板（= manager 机上那一份）+ 一个空的输出目录（= manager 每次建站 mkdtemp 的那个）。回 { root, work, out }。 */
function freshWork(label) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), `rs1598-${label}-`));
  TEMP.push(root);
  const work = path.join(root, 'template');
  cp.execSync(`tar --exclude=./node_modules --exclude=./out --exclude=./.next --exclude=./site --exclude=./public/photos -cf - . | (mkdir -p "${work}" && tar -xf - -C "${work}")`, { cwd: NEXT, stdio: 'pipe' });
  fs.symlinkSync(path.join(NEXT, 'node_modules'), path.join(work, 'node_modules'));
  const out = path.join(root, 'out');
  fs.mkdirSync(out);
  return { root, work, out };
}

/** 续跑的起点：新的模板 + 新的输出目录，`<out>/site` = 那份 site/（manager 从 sites.content 写回来的那一份）。 */
function resumeFrom(label, siteDir) {
  const X = freshWork(label);
  fs.cpSync(siteDir, path.join(X.out, 'site'), { recursive: true });
  return X;
}

function run(label, X, payload, extra = {}) {
  const stub = path.join(X.root, 'stub.js');
  const cfgFile = path.join(X.root, 'cfg.json');
  const calls = path.join(X.root, `calls-${label}.jsonl`);
  fs.writeFileSync(stub, STUB);
  fs.writeFileSync(cfgFile, JSON.stringify({ plan: plan(), ...((payload.secondaryLocales || []).includes('en') ? { locales: { en: EN_SITE } } : {}), ...extra }));
  fs.writeFileSync(calls, '');
  const r = cp.spawnSync(process.execPath, ['--require', stub, path.join(X.work, 'scripts', 'create-site.js')], {
    input: JSON.stringify({ ...payload, outDir: X.out }), cwd: X.work, encoding: 'utf8', maxBuffer: 64 << 20, timeout: 300000,
    env: { ...process.env, ANTHROPIC_API_KEY: 'stub-not-used', RS_STUB_CFG: cfgFile, RS_STUB_CALLS: calls },
  });
  if (r.error) die(`${label}：进程没跑起来 ${r.error.message}`);
  const events = (r.stdout || '').split('\n').filter(Boolean).map((l) => { try { return JSON.parse(l); } catch (e) { return { event: '(非 JSON)', raw: l }; } });
  const callList = fs.readFileSync(calls, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
  return { rc: r.status, stdout: r.stdout || '', stderr: r.stderr || '', events, calls: callList, error: (events.find((e) => e.event === 'error') || {}).message || '' };
}

const count = (R, kind) => R.calls.filter((c) => c.kind === kind).length;
const prompts = (R, re) => R.events.filter((e) => e.event === 'prompt' && re.test(e.name)).length;
const progressOf = (R) => R.events.filter((e) => e.event === 'progress');
/** 这一跑发的 `phase-saved`，从旧到新：[{ phase, snapshot }] */
const snapshotsOf = (R) => R.events.filter((e) => e.event === 'phase-saved').map(({ phase, snapshot }) => ({ phase, snapshot }));
const snapJson = (snap, file) => JSON.parse(fs.readFileSync(path.join(snap, 'site', file), 'utf8'));
const snapHas = (snap, file) => fs.existsSync(path.join(snap, 'site', file));
/** site/ 下所有文件的相对路径 → 内容（逐字节比两次建站的产物）。
 *  建站报告（#1600 的 build-report.json，不进 content）带写盘时间和耗时，每次都不同 ⟹ 不在这里比，另由 §reportOf 比。 */
const REPORT = 'build-report.json';
function siteFiles(X) {
  const out = {};
  const base = path.join(X.out, 'site');
  const walk = (d) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const f = path.join(d, e.name);
      if (e.isDirectory()) walk(f); else out[path.join('site', path.relative(base, f))] = fs.readFileSync(f, 'utf8');
    }
  };
  walk(base);
  delete out[path.join('site', REPORT)];
  return out;
}
/** 建站报告去掉每次都不同的两格（写盘时间、耗时），以及 #1593 的 `costUsd`（只数本进程的调用费 ⟹ 续跑那一截天然比从头建少）。 */
function reportOf(X) {
  const r = JSON.parse(fs.readFileSync(path.join(X.out, 'site', REPORT), 'utf8'));
  delete r.generatedAt;
  delete r.durationSec;
  delete r.costUsd;
  return r;
}
function assertOk(R) { assert.strictEqual(R.rc, 0, `${R.error}\n${R.stderr.slice(-1200)}`); }

console.log('══ #1598 建站分阶段存档 + 续跑（打桩，7 服务中文站 + 2 个关键词页，manager 那条路：outDir + phase-saved 快照）══');

// ── A：从头建 ───────────────────────────────────────────────────────────────────────────────────────────
console.log('── A：从头建一次（不带 resume）');
const A = freshWork('full');
const RA = run('full', A, PAYLOAD());
const snapsA = snapshotsOf(RA);
const byPhase = Object.fromEntries(snapsA.map((c) => [c.phase, c.snapshot]));
check('建站成功（rc 0、没有 error 事件）', () => { assertOk(RA); assert.strictEqual(RA.error, ''); });
check('#1829：4 份 phase-saved 快照，顺序 = plan → pages → images → keywordPages，都在输出目录下；最后一个阶段不拍', () => {
  assert.deepStrictEqual(snapsA.map((c) => c.phase), PHASES.slice(0, 4));
  for (const c of snapsA) assert.ok(c.snapshot.startsWith(A.out + path.sep) && fs.existsSync(path.join(c.snapshot, 'site')), c.snapshot);
});
check('不变量：每份快照里标记 = 这个阶段，存档写的是同一个阶段、带主题名；最终 site/ 的标记是最后一个阶段、没有存档', () => {
  for (const c of snapsA) {
    assert.strictEqual(snapJson(c.snapshot, 'site_meta.json').buildPhase, c.phase, c.phase);
    assert.ok(snapHas(c.snapshot, '.build/state.json'), `${c.phase} 的快照里没有存档`);
    const st = snapJson(c.snapshot, '.build/state.json');
    assert.strictEqual(st.phase, c.phase);
    assert.strictEqual(st.themeName, 'azure-29');
  }
  assert.strictEqual(JSON.parse(fs.readFileSync(path.join(A.out, 'site', 'site_meta.json'), 'utf8')).buildPhase, 'secondaryLocales');
  assert.ok(!fs.existsSync(path.join(A.out, 'site', '.build')));
});
check('每个阶段的产物在它自己的快照里：plan 之后还没有页面文件，pages 存档里每页都有 sections，keywordPages 之后站点文件和关键词页都在', () => {
  assert.ok(!snapHas(byPhase.plan, 'zh/pages/home.json'), 'plan 快照里已经有页面文件');
  assert.ok(snapJson(byPhase.plan, '.build/state.json').ai.pages.every((p) => !p.sections && p.brief), 'plan 存档里的页面不该有 sections');
  assert.ok(snapJson(byPhase.pages, '.build/state.json').ai.pages.every((p) => Array.isArray(p.sections) && p.sections.length), 'pages 存档里有页没有 sections');
  assert.ok(snapHas(byPhase.keywordPages, 'zh/pages/home.json'));
  assert.ok(snapHas(byPhase.keywordPages, 'brand.json'));
  assert.ok(!snapHas(byPhase.images, 'brand.json'), 'images 快照里已经有 brand.json（站点文件应在 keywordPages 那一段才写）');
  assert.ok(fs.readdirSync(path.join(byPhase.keywordPages, 'site', 'zh', 'pages', 'services', 'cut')).length >= 2, '关键词页没进 keywordPages 那份快照');
});
check('#1829：站点文件写在输出目录里，模板根的 site/ 不存在（两个站同时建不会互相踩）；不碰 git、不发 repo / chat-message', () => {
  assert.ok(fs.existsSync(path.join(A.out, 'site', 'brand.json')));
  assert.ok(!fs.existsSync(path.join(A.work, 'site')), '模板根下出现了 site/');
  assert.ok(!fs.existsSync(path.join(A.work, '.git')));
  assert.deepStrictEqual(RA.events.filter((e) => e.event === 'repo' || e.event === 'chat-message'), []);
  assert.ok(!/git (add|commit|push)/.test(RA.stderr), RA.stderr.split('\n').filter((l) => /git /.test(l)).slice(0, 3).join('\n'));
});
// #1601 × #1598 —— 配方给每页的块序按对象身份记，续跑读回来的是新对象 ⟹ 它要跟着存档走（create-site.js §recipeSnapshot）。
const RECIPE_SLUGS = ['services', ...SERVICES.map(([id]) => `services/${id}`), 'contact'];
check('#1601 配方跟着存档走：plan / pages 两个存档都带 recipe（顶部导航 services · contact；首页之外 9 页各有块序）', () => {
  for (const ph of ['plan', 'pages']) {
    const r = snapJson(byPhase[ph], '.build/state.json').recipe;
    assert.ok(r, `${ph} 存档里没有 recipe`);
    assert.deepStrictEqual(r.nav, ['services', 'contact'], ph); // #1781：按钮那一页也进菜单
    assert.deepStrictEqual(Object.keys(r.blocks).sort(), [...RECIPE_SLUGS].sort(), ph);
    assert.deepStrictEqual(r.blocks.contact.map((x) => x.type), ['page-header', 'contact'], ph);
  }
});
// 配方预设写进了块的 options（阳性对照：下面 P 那一跑要跟它逐字节相同，这一格证明那份比较里真有预设）。
const presetKnobsIn = (X, slug) => JSON.parse(fs.readFileSync(path.join(X.out, 'site', 'zh', 'pages', `${slug}.json`), 'utf8'))
  .blocks.filter((x) => x.data && x.data.options && Object.keys(x.data.options).length).length;
check('#1601 对照：从头建那次 services 页、services/cut 页的块带着配方预设写的 options', () => {
  assert.ok(presetKnobsIn(A, 'services') >= 2, `services ${presetKnobsIn(A, 'services')}`);
  assert.ok(presetKnobsIn(A, 'services/cut') >= 2, `services/cut ${presetKnobsIn(A, 'services/cut')}`);
});
const filesA = siteFiles(A);
if (snapsA.length !== 4) die(`A 没有 4 份阶段快照（${snapsA.length}），下面的续跑格子没有起点`);
const snapSite = (snap) => path.join(snap, 'site');

// ── B：在 pages 之后续跑（AC2），manager 这一次送来的轮换下标会挑出另一套主题 ─────────────────────────────────
console.log('── B：buildPhase = pages 的快照写回去，resume:true（轮换下标换成 1）');
const { pickThemeForIndustry } = require('./themes');
const OTHER_INDEX = 1;
const B = resumeFrom('from-pages', snapSite(byPhase.pages));
const RB = run('from-pages', B, PAYLOAD({ resume: true, themeRotationIndex: OTHER_INDEX }));
check('建站成功', () => assertOk(RB));
check('AC2：plan 与 pages 两个阶段一次都没跑 —— 站级调用 0、每页调用 0、Base Site / Page: 提示词 0、「Page i/N written」进度 0', () => {
  assert.strictEqual(count(RB, 'site'), 0);
  assert.strictEqual(count(RB, 'page'), 0);
  assert.strictEqual(prompts(RB, /^(Base Site|Page: )/), 0);
  assert.strictEqual(progressOf(RB).filter((e) => /^Page \d+\/\d+ written/.test(e.message)).length, 0);
});
check('阳性对照（AC2 不是恒绿）：从头建那次站级 1 通、每页 N 通', () => {
  assert.strictEqual(count(RA, 'site'), 1);
  assert.strictEqual(count(RA, 'page'), N);
});
check('后面的阶段照常跑：关键词页那几通发出去了', () => {
  assert.ok(count(RB, 'keyword') >= 2, `keyword ${count(RB, 'keyword')}`);
});
check('做什么 4：续跑的第一条进度是「Resuming after the saved "pages" stage」，百分比 42（pages 做完时的位置）', () => {
  const first = progressOf(RB)[0];
  assert.strictEqual(first.message, 'Resuming after the saved "pages" stage...');
  assert.strictEqual(first.percent, 42);
});
check(`主题：这次的轮换下标 ${OTHER_INDEX} 重新挑会挑到另一套（阳性对照），站仍是存档里那套 azure-29`, () => {
  assert.notStrictEqual(pickThemeForIndustry(INDUSTRY, OTHER_INDEX, []), 'azure-29', '对照失效：下标 1 也挑 azure-29，这一格量不到东西');
  assert.strictEqual(JSON.parse(fs.readFileSync(path.join(B.out, 'site', 'theme.json'), 'utf8')).themeId, 'azure-29');
  assert.ok(RB.stderr.includes('主题沿用存档里那套 azure-29'), RB.stderr.split('\n').filter((l) => l.includes('[resume]')).join('\n'));
});
check('最终站点文件跟从头建那次逐字节相同（续上的就是同一个站）', () => {
  const filesB = siteFiles(B);
  assert.deepStrictEqual(Object.keys(filesB).sort(), Object.keys(filesA).sort());
  const diff = Object.keys(filesA).filter((f) => filesA[f] !== filesB[f]);
  assert.deepStrictEqual(diff, []);
});
check('续跑只拍了后面那两份快照（pages 之后 images / keywordPages）', () => {
  assert.deepStrictEqual(snapshotsOf(RB).map((c) => c.phase), ['images', 'keywordPages']);
});

// ── P：在 plan 之后续跑（#1601 × #1598）：每页那几通要重发，而它们的块序 / 预设来自配方 —— 配方按对象身份记，得从存档挂回来 ─────
console.log('── P：buildPhase = plan 的快照 resume:true（每页那几通重发，块序和预设从存档里的配方来）');
const P = resumeFrom('from-plan', snapSite(byPhase.plan));
const RP = run('from-plan', P, PAYLOAD({ resume: true }));
check('建站成功；站级 0 通、每页 N 通（plan 跳过、pages 重跑）；日志说配方跟着存档回来了', () => {
  assertOk(RP);
  assert.strictEqual(count(RP, 'site'), 0);
  assert.strictEqual(count(RP, 'page'), N);
  assert.ok(RP.stderr.includes('[resume] 整站配方跟着存档回来：9 页的块序；顶部导航 services · contact'), RP.stderr.split('\n').filter((l) => l.includes('[resume]')).join('\n'));
});
check('#1601：续跑那几通每页提示词照样锁着配方的块序（首页之外 9 页都有 FIXED 那一行）', () => {
  const fixedPrompts = RP.events.filter((e) => e.event === 'prompt' && /^Page: /.test(e.name) && /This page's sections are FIXED/.test(e.content));
  assert.deepStrictEqual(fixedPrompts.map((e) => e.name.replace(/^Page: /, '')).sort(), [...RECIPE_SLUGS].sort());
});
check('#1601：最终站点文件跟从头建那次逐字节相同（块序、配方预设、导航、按钮全在）', () => {
  const f = siteFiles(P);
  assert.deepStrictEqual(Object.keys(f).sort(), Object.keys(filesA).sort());
  assert.deepStrictEqual(Object.keys(filesA).filter((k) => f[k] !== filesA[k]), []);
  assert.ok(presetKnobsIn(P, 'services/cut') >= 2);
});

// ── C / D：在 images 之后、keywordPages 之后续跑 ───────────────────────────────────────────────────────────
console.log('── C：buildPhase = images 的快照 resume:true');
const C = resumeFrom('from-images', snapSite(byPhase.images));
const RC = run('from-images', C, PAYLOAD({ resume: true }));
check('建站成功；站级 / 每页 0 通，关键词页照发；进度从 50 开始；产物与从头建相同', () => {
  assertOk(RC);
  assert.strictEqual(count(RC, 'site') + count(RC, 'page'), 0);
  assert.ok(count(RC, 'keyword') >= 2);
  assert.strictEqual(progressOf(RC)[0].percent, 50);
  const f = siteFiles(C);
  assert.deepStrictEqual(Object.keys(f).filter((k) => f[k] !== filesA[k]), []);
});
console.log('── D：buildPhase = keywordPages 的快照 resume:true');
const D = resumeFrom('from-kw', snapSite(byPhase.keywordPages));
const RD = run('from-kw', D, PAYLOAD({ resume: true }));
check('建站成功；一通 AI 调用都没有；进度从 70 开始；一份快照都不拍；最终 site/ 没有存档', () => {
  assertOk(RD);
  assert.deepStrictEqual(RD.calls, []);
  assert.strictEqual(progressOf(RD)[0].percent, 70);
  assert.deepStrictEqual(snapshotsOf(RD), []);
  assert.ok(!fs.existsSync(path.join(D.out, 'site', '.build')));
});

// ── 建站报告（#1600）跟着存档走：SEO 检查和关键词页 N/M 记在 keywordPages 阶段里，从它之后续跑也不能变成 null ─────────
check('建站报告：从 pages / images / keywordPages 续跑，报告跟从头建那次相同（seo / repair / keywordPages 三格都有值）', () => {
  const a = reportOf(A);
  assert.ok(a.seo && a.repair && a.keywordPages, `对照失效：从头建那次三格里有 null ${JSON.stringify({ seo: !!a.seo, repair: !!a.repair, keywordPages: !!a.keywordPages })}`);
  for (const [name, X] of [['pages', B], ['images', C], ['keywordPages', D]]) {
    assert.deepStrictEqual(reportOf(X), a, `从 ${name} 续跑的报告跟从头建不同`);
  }
});

check('#1593 的 costUsd 不进存档：四份快照里的存档都没有 costUsd（阳性对照：最终报告里有，且大于 0）', () => {
  assert.strictEqual(snapsA.length, 4);
  for (const c of snapsA) assert.ok(!fs.readFileSync(path.join(c.snapshot, 'site', '.build', 'state.json'), 'utf8').includes('costUsd'), `${c.phase} 那份快照的存档里有 costUsd`);
  const cost = JSON.parse(fs.readFileSync(path.join(A.out, 'site', REPORT), 'utf8')).costUsd;
  assert.ok(typeof cost === 'number' && cost > 0, `对照失效：从头建那次报告的 costUsd = ${cost}`);
});

// ── L：有第二语言（zh + en）的站，从 pages / keywordPages 之后续跑（#1593 的第二语言账跟着存档走）──────────────────
console.log('── L：zh + en 的站，从头建一次，再从 pages / keywordPages 之后续跑');
const L = freshWork('locales');
const RL = run('locales', L, PAYLOAD({ secondaryLocales: ['en'] }));
const enFiles = (X) => Object.keys(siteFiles(X)).filter((f) => f.startsWith(path.join('site', 'en') + path.sep));
check('对照：从头建 rc 0，site/en 写出来了，没有 secondary-locale-failed', () => {
  assertOk(RL);
  const why = () => [...RL.events.filter((e) => e.event === 'secondary-locale-failed').map((e) => JSON.stringify(e)),
    ...RL.stderr.split('\n').filter((l) => /\[locales\]|Secondary locale/.test(l))].join('\n');
  assert.ok(enFiles(L).length > N, `site/en 只有 ${enFiles(L).length} 个文件\n${why()}`);
  assert.deepStrictEqual(RL.events.filter((e) => e.event === 'secondary-locale-failed'), []);
});
const byPhaseL = Object.fromEntries(snapshotsOf(RL).map((c) => [c.phase, c.snapshot]));
const filesL = siteFiles(L);
for (const from of ['pages', 'keywordPages']) {
  const X = resumeFrom(`locales-from-${from}`, snapSite(byPhaseL[from]));
  const RX = run(`locales-from-${from}`, X, PAYLOAD({ secondaryLocales: ['en'], resume: true }));
  check(`从 ${from} 续跑：没有 secondary-locale-failed，site/en 跟从头建那次逐字节相同（整个 site/ 也相同）`, () => {
    assertOk(RX);
    assert.deepStrictEqual(RX.events.filter((e) => e.event === 'secondary-locale-failed').map((e) => e.error), []);
    const f = siteFiles(X);
    assert.deepStrictEqual(enFiles(X), enFiles(L));
    assert.deepStrictEqual(Object.keys(f).sort(), Object.keys(filesL).sort());
    assert.deepStrictEqual(Object.keys(filesL).filter((k) => f[k] !== filesL[k]), []);
  });
}

// ── M：#1596 的降级跟着存档走 —— 站级那一通被截断（降级成代码拼的站级计划），从 pages / keywordPages 之后续跑 ─────────
//    ① 建站报告的 degraded 那一格仍有那一笔 site-plan（它记在 plan 阶段，续跑那一截不会再记）
//    ② brand.json 仍没有 email 键（「brand 是代码拼的」那一位记在 plan / pages 存档里；丢了它续跑就落进 'info@example.com' 兜底）
console.log('── M：站级那一通被截断（#1596 降级），从头建一次，再从 pages / keywordPages 之后续跑');
const M = freshWork('degraded');
const RM = run('degraded', M, PAYLOAD(), { site: 'truncated' });
const degradedOfReport = (X) => JSON.parse(fs.readFileSync(path.join(X.out, 'site', REPORT), 'utf8')).degraded;
const brandOf = (X) => JSON.parse(fs.readFileSync(path.join(X.out, 'site', 'brand.json'), 'utf8'));
check('对照：从头建 rc 0，恰好一笔 site-plan 降级（事件 = 报告），brand.json 没有 email 键', () => {
  assertOk(RM);
  const ev = RM.events.filter((e) => e.event === 'degraded').map(({ step, target, reason }) => ({ step, target, reason }));
  assert.deepStrictEqual(ev.map((d) => d.step), ['site-plan'], JSON.stringify(ev));
  assert.deepStrictEqual(degradedOfReport(M), ev);
  assert.ok(!('email' in brandOf(M)), JSON.stringify(brandOf(M).email));
});
const byPhaseM = Object.fromEntries(snapshotsOf(RM).map((c) => [c.phase, c.snapshot]));
const filesM = siteFiles(M);
for (const from of ['pages', 'keywordPages']) {
  const X = resumeFrom(`degraded-from-${from}`, snapSite(byPhaseM[from]));
  const RX = run(`degraded-from-${from}`, X, PAYLOAD({ resume: true }), { site: 'truncated' });
  check(`从 ${from} 续跑：站级调用 0、这一截没有新的降级事件；报告的 degraded 跟从头建那次相同（仍是那一笔 site-plan）`, () => {
    assertOk(RX);
    assert.strictEqual(count(RX, 'site'), 0);
    assert.deepStrictEqual(RX.events.filter((e) => e.event === 'degraded'), []);
    assert.deepStrictEqual(degradedOfReport(X), degradedOfReport(M));
  });
  check(`从 ${from} 续跑：brand.json 仍没有 email 键，整个 site/ 跟从头建那次逐字节相同`, () => {
    assert.ok(!('email' in brandOf(X)), JSON.stringify(brandOf(X).email));
    const f = siteFiles(X);
    assert.deepStrictEqual(Object.keys(f).sort(), Object.keys(filesM).sort());
    assert.deepStrictEqual(Object.keys(filesM).filter((k) => f[k] !== filesM[k]), []);
  });
}

// ── E：已经建完的站再点续跑；F：同一份不带 resume（= Rebuild）───────────────────────────────────────────
console.log('── E：五个阶段都已完成的 site/ resume:true');
const E = resumeFrom('done', path.join(A.out, 'site'));
const RE = run('done', E, PAYLOAD({ resume: true }));
check('rc 0、一通调用都没有、一份快照都不拍，进度直接 85', () => {
  assertOk(RE);
  assert.deepStrictEqual(RE.calls, []);
  assert.deepStrictEqual(snapshotsOf(RE), []);
  assert.deepStrictEqual(progressOf(RE).map((e) => e.percent), [85]);
});
console.log('── F：同一份建完的 site/，不带 resume（admin Rebuild 的形状）');
const F = resumeFrom('rebuild', path.join(A.out, 'site'));
const RF = run('rebuild', F, PAYLOAD());
check('PM r2 裁定 一：照旧从头建 —— 站级 1 通、每页 N 通，重新拍 4 份快照', () => {
  assertOk(RF);
  assert.strictEqual(count(RF, 'site'), 1);
  assert.strictEqual(count(RF, 'page'), N);
  assert.deepStrictEqual(snapshotsOf(RF).map((c) => c.phase), PHASES.slice(0, 4));
});

// ── G / H：续不了 ⟹ 从头建 ────────────────────────────────────────────────────────────────────────────────
console.log('── G：什么都没存过 resume:true');
const G = freshWork('nothing');
const RG = run('nothing', G, PAYLOAD({ resume: true }));
check('从头建（站级 1 通），日志说清为什么续不了，进度先报一句「Nothing saved to resume from」', () => {
  assertOk(RG);
  assert.strictEqual(count(RG, 'site'), 1);
  assert.ok(RG.stderr.includes('[resume] 续不了，从头建：site/site_meta.json 读不到'), RG.stderr.split('\n').filter((l) => l.includes('[resume]')).join('\n'));
  assert.strictEqual(progressOf(RG)[0].message, 'Nothing saved to resume from — building from the start...');
});
console.log('── H：存档跟标记对不上（手改过的内容）');
const H = resumeFrom('mismatch', snapSite(byPhase.pages));
{
  const st = path.join(H.out, 'site', '.build', 'state.json');
  const j = JSON.parse(fs.readFileSync(st, 'utf8'));
  j.phase = 'plan';
  fs.writeFileSync(st, JSON.stringify(j));
}
const RH = run('mismatch', H, PAYLOAD({ resume: true }));
check('不拿它跳阶段：从头建（站级 1 通、每页 N 通），日志点名「存档跟标记对不上」', () => {
  assertOk(RH);
  assert.strictEqual(count(RH, 'site'), 1);
  assert.strictEqual(count(RH, 'page'), N);
  assert.ok(RH.stderr.includes('存档跟标记对不上：buildPhase pages，存档写的是 "plan"'), RH.stderr.split('\n').filter((l) => l.includes('[resume]')).join('\n'));
});

console.log(`\n══ 汇总: 通过 ${pass} · 失败 ${fail} ══`);
process.exit(fail ? 1 : 0);
