#!/usr/bin/env node
// #1598 —— 建站分五个阶段存档、「续跑」从最后一个完成的阶段接着做。真 create-site.js 进程，`@anthropic-ai/sdk` 换成按提示词
// 回放的桩（同 create-site-call1-pages.test.js 的做法，输入也是它那份 7 服务中文站 + 两个关键词页），外加一个真 git 仓和
// 本地 bare 远端（= 容器里那个站仓和 GitHub）。
//
// 🔴 不是 skipAI：skipAI 在五个阶段之前就 return（PM 裁定 ①），这里每一格在它上面都量不到东西。
// 🔴 不调真 AI（#1499）。
//
// 「spy 计数」怎么数（AC2）：plan 阶段的唯一外部动作是站级那一通（桩记成 kind=site，同时发 `Base Site` 提示词事件），
// pages 阶段是每页那几通（kind=page，`Page: <slug>` 提示词事件、`Page i/N written` 进度）。三样都数到 0 ⟹ 两个阶段的函数没被调用。
//
// 量的是：
//   AC3（打桩那一臂）  从头建 ⟹ 仓里 5 个 `phase:` 提交，顺序 = 今天流水线的顺序（PM r2 裁定 二）
//   不变量            每个阶段提交里，标记（site_meta.json buildPhase）和存档（site/.build/state.json）同在、对得上；最后一个提交删掉存档
//   AC2               buildPhase = pages 时续跑 ⟹ 站级 / 每页调用 0；最终站点文件跟从头建那次逐字节相同
//   主题              续跑时 manager 送来的轮换下标会挑出另一套主题（阳性对照），站仍是存档里那套（PM r2 点名要的断言）
//   做什么 4          续跑的第一条进度从那个阶段做完时的百分比开始
//   裁定 一           不带 resume 的 Rebuild 照旧从头建（仓里 buildPhase 已是最后一个阶段时也一样）
//   #1600 建站报告    从 pages / images / keywordPages 续跑，报告（去掉写盘时间、耗时）跟从头建那次相同
//   #1593 costUsd     阶段提交里的存档不带 costUsd（它在最后一个阶段之前才写进报告，而最后一个阶段删掉存档）
//   #1593 第二语言    zh + en 的站从 pages / keywordPages 续跑：第二语言的账跟着存档走，site/en 跟从头建那次逐字节相同
//   其余              从 images / keywordPages 续 · 已建完再续 · 没有存档 / 存档对不上 ⟹ 从头建 · 推送失败不中断、日志不带 token
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
    forms: [{ id: 'quote', name: '预约', buttonText: '提交', successMessage: '谢谢' }, { id: 'contact', name: '联系', buttonText: '提交', successMessage: '谢谢' }],
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
  forms: [{ id: 'quote', name: 'Book', buttonText: 'Send', successMessage: 'Thanks' }, { id: 'contact', name: 'Contact', buttonText: 'Send', successMessage: 'Thanks' }],
  contactPage: { title: 'Contact us', navLabel: 'Contact', description: 'Get in touch with Silky Hair Salon', headline: 'Contact us', subheadline: 'Send us a message.', formHeadline: 'Get in touch', formBody: 'Leave your details.' },
};
const TOKEN = 'tok-RS1598-dont-print-me';
const INDUSTRY = 'hair salon';
const PAYLOAD = (extra = {}) => ({
  siteId: 'rs159801', siteUrl: 'https://silky.test', companyName: 'Silky Hair Salon', industry: INDUSTRY, location: 'Toronto, ON',
  language: 'zh', services: SERVICES.map(([, n]) => n), homepageFingerprint: false,
  keywords: { '剪发': [{ keyword: '剪发店', selected: true, volume: 300 }, { keyword: '男士理发', selected: true, volume: 200 }] },
  repoUrl: 'https://github.com/test/rs159801.git', gitToken: TOKEN, themeRotationIndex: 0,
  ...extra,
});

// ── 仓 ─────────────────────────────────────────────────────────────────────────────────────────────────
const git = (cwd, args) => cp.execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
function gitIdentity(dir) {
  git(dir, ['config', 'user.name', 'AI1st']);
  git(dir, ['config', 'user.email', 'ai1st@ai1st.site']);
}

/** 一个「刚从模板生成」的站仓：模板文件 + `Initial commit`，远端是 bare。回 { work, bare }。 */
function freshRepo(label) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), `rs1598-${label}-`));
  TEMP.push(root);
  const work = path.join(root, 'repo');
  cp.execSync(`tar --exclude=./node_modules --exclude=./out --exclude=./.next --exclude=./site --exclude=./public/photos -cf - . | (mkdir -p "${work}" && tar -xf - -C "${work}")`, { cwd: NEXT, stdio: 'pipe' });
  git(work, ['init', '-q', '-b', 'main']);
  gitIdentity(work);
  git(work, ['add', '-A']);
  git(work, ['commit', '-q', '-m', 'Initial commit']);
  const bare = path.join(root, 'origin.git');
  git(root, ['clone', '-q', '--bare', work, bare]);
  git(work, ['remote', 'add', 'origin', bare]);
  fs.symlinkSync(path.join(NEXT, 'node_modules'), path.join(work, 'node_modules'));
  return { root, work, bare };
}

/** 一个新容器：从 `bare` 克隆，仓停在 `sha`（= 那一刻推上去的最后一个提交），自己的 bare 远端。 */
function containerAt(label, bare, sha) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), `rs1598-${label}-`));
  TEMP.push(root);
  const work = path.join(root, 'repo');
  git(root, ['clone', '-q', bare, work]);
  git(work, ['reset', '-q', '--hard', sha]);
  const own = path.join(root, 'origin.git');
  git(root, ['clone', '-q', '--bare', work, own]);
  git(work, ['remote', 'set-url', 'origin', own]);
  gitIdentity(work);
  fs.symlinkSync(path.join(NEXT, 'node_modules'), path.join(work, 'node_modules'));
  return { root, work, bare: own };
}

function run(label, work, payload, extra = {}) {
  const dir = path.dirname(work);
  const stub = path.join(dir, 'stub.js');
  const cfgFile = path.join(dir, 'cfg.json');
  const calls = path.join(dir, `calls-${label}.jsonl`);
  fs.writeFileSync(stub, STUB);
  fs.writeFileSync(cfgFile, JSON.stringify({ plan: plan(), ...((payload.secondaryLocales || []).includes('en') ? { locales: { en: EN_SITE } } : {}), ...extra }));
  fs.writeFileSync(calls, '');
  const r = cp.spawnSync(process.execPath, ['--require', stub, path.join(work, 'scripts', 'create-site.js')], {
    input: JSON.stringify(payload), cwd: work, encoding: 'utf8', maxBuffer: 64 << 20, timeout: 300000,
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
/** 仓里 `phase:` 提交，从旧到新：[{ sha, phase }] */
function phaseCommits(repo) {
  return git(repo, ['log', '--reverse', '--format=%H %s']).split('\n').filter((l) => / \(phase: /.test(l))
    .map((l) => ({ sha: l.slice(0, 40), subject: l.slice(41), phase: (l.match(/\(phase: (\w+) \d+\/\d+\)/) || [])[1] }));
}
const showJson = (repo, sha, file) => JSON.parse(git(repo, ['show', `${sha}:${file}`]));
const hasPath = (repo, sha, file) => { try { git(repo, ['cat-file', '-e', `${sha}:${file}`]); return true; } catch (e) { return false; } };
/** site/ 下所有文件的相对路径 → 内容（逐字节比两次建站的产物）。
 *  建站报告（#1600 的 site/build-report.json，不进站仓）带写盘时间和耗时，每次都不同 ⟹ 不在这里比，另由 §reportOf 比。 */
const REPORT = path.join('site', 'build-report.json');
function siteFiles(work) {
  const out = {};
  const walk = (d) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const f = path.join(d, e.name);
      if (e.isDirectory()) walk(f); else out[path.relative(work, f)] = fs.readFileSync(f, 'utf8');
    }
  };
  walk(path.join(work, 'site'));
  delete out[REPORT];
  return out;
}
/** 建站报告去掉每次都不同的两格（写盘时间、耗时），以及 #1593 的 `costUsd`（只数本进程的调用费 ⟹ 续跑那一截天然比从头建少）。 */
function reportOf(work) {
  const r = JSON.parse(fs.readFileSync(path.join(work, REPORT), 'utf8'));
  delete r.generatedAt;
  delete r.durationSec;
  delete r.costUsd;
  return r;
}
function assertOk(R) { assert.strictEqual(R.rc, 0, `${R.error}\n${R.stderr.slice(-1200)}`); }

console.log('══ #1598 建站分阶段存档 + 续跑（打桩，7 服务中文站 + 2 个关键词页，真 git 仓）══');

// ── A：从头建 ───────────────────────────────────────────────────────────────────────────────────────────
console.log('── A：从头建一次（不带 resume）');
const A = freshRepo('full');
const RA = run('full', A.work, PAYLOAD());
const commitsA = (() => { try { return phaseCommits(A.bare); } catch (e) { return []; } })();
const byPhase = Object.fromEntries(commitsA.map((c) => [c.phase, c.sha]));
check('建站成功（rc 0、没有 error 事件）', () => { assertOk(RA); assert.strictEqual(RA.error, ''); });
check('AC3（打桩那一臂）：推到远端的仓里 `phase:` 提交 5 个，顺序 = plan → pages → images → keywordPages → secondaryLocales', () => {
  assert.strictEqual(git(A.bare, ['log', '--oneline']).split('\n').filter((l) => l.includes('phase:')).length, 5);
  assert.deepStrictEqual(commitsA.map((c) => c.phase), PHASES);
  assert.deepStrictEqual(commitsA.map((c) => c.subject), PHASES.map((p, i) => `Generate site: rs159801 (phase: ${p} ${i + 1}/${PHASES.length})`));
});
check('每个阶段都推上去了：本地仓与远端 HEAD 相同，日志 5 行「已提交并推送」', () => {
  assert.strictEqual(git(A.work, ['rev-parse', 'HEAD']), git(A.bare, ['rev-parse', 'main']));
  assert.strictEqual((RA.stderr.match(/\[resume\] 阶段 \w+ 已提交并推送/g) || []).length, 5, RA.stderr.split('\n').filter((l) => l.includes('[resume]')).join('\n'));
});
check('不变量：每个阶段提交里标记 = 这个阶段；前 4 个带存档且存档写的是同一个阶段、带主题名；最后一个没有存档', () => {
  for (const c of commitsA) {
    assert.strictEqual(showJson(A.bare, c.sha, 'site/site_meta.json').buildPhase, c.phase, c.phase);
    const has = hasPath(A.bare, c.sha, 'site/.build/state.json');
    if (c.phase === 'secondaryLocales') { assert.ok(!has, '最后一个提交还带着存档'); continue; }
    assert.ok(has, `${c.phase} 的提交里没有存档`);
    const st = showJson(A.bare, c.sha, 'site/.build/state.json');
    assert.strictEqual(st.phase, c.phase);
    assert.strictEqual(st.themeName, 'azure-29');
  }
});
check('每个阶段的产物在它自己的提交里：plan 之后还没有页面文件，pages 存档里每页都有 sections，keywordPages 之后站点文件和关键词页都在', () => {
  assert.ok(!hasPath(A.bare, byPhase.plan, 'site/zh/pages/home.json'), 'plan 提交里已经有页面文件');
  assert.ok(showJson(A.bare, byPhase.plan, 'site/.build/state.json').ai.pages.every((p) => !p.sections && p.brief), 'plan 存档里的页面不该有 sections');
  assert.ok(showJson(A.bare, byPhase.pages, 'site/.build/state.json').ai.pages.every((p) => Array.isArray(p.sections) && p.sections.length), 'pages 存档里有页没有 sections');
  assert.ok(hasPath(A.bare, byPhase.keywordPages, 'site/zh/pages/home.json'));
  assert.ok(hasPath(A.bare, byPhase.keywordPages, 'site/brand.json'));
  assert.ok(!hasPath(A.bare, byPhase.images, 'site/brand.json'), 'images 提交里已经有 brand.json（站点文件应在 keywordPages 那一段才写）');
  assert.ok(git(A.bare, ['ls-tree', '-r', '--name-only', byPhase.keywordPages, 'site/zh/pages/services/cut']).split('\n').filter(Boolean).length >= 2, '关键词页没进 keywordPages 那次提交');
});
check('「Site created」锚点指的是最后一个提交；工作区里不剩存档目录', () => {
  const anchor = RA.events.find((e) => e.event === 'chat-message');
  assert.ok(anchor, '没有 chat-message 事件');
  assert.strictEqual(anchor.commit_hash, git(A.work, ['rev-parse', '--short', 'HEAD']));
  assert.ok(!fs.existsSync(path.join(A.work, 'site', '.build')));
});
check('提交里不带 token（推送的凭据只进环境变量）', () => {
  // -S：只列「增删过这个串」的提交（整仓 `log -p` 会撑爆缓冲区）。范围是 Initial commit 之后 —— 模板树里本来就有这份测试文件，
  // 它自己写着这个字面量。阳性对照：同一条命令、同一个范围，找一个建站时确实写进仓的词。
  const built = `${commitsA[0].sha}~1..main`;
  assert.strictEqual(git(A.bare, ['log', built, '--format=%H', '-S', TOKEN]), '');
  assert.notStrictEqual(git(A.bare, ['log', built, '--format=%H', '-S', '剪发店']), '', '对照失效：-S 连写进过仓的词都找不到');
  assert.ok(!RA.stdout.includes(TOKEN) && !RA.stderr.includes(TOKEN));
});
// #1601 × #1598 —— 配方给每页的块序按对象身份记，续跑读回来的是新对象 ⟹ 它要跟着存档走（create-site.js §recipeSnapshot）。
const RECIPE_SLUGS = ['services', ...SERVICES.map(([id]) => `services/${id}`), 'contact'];
check('#1601 配方跟着存档走：plan / pages 两个存档都带 recipe（顶部导航 services；首页之外 9 页各有块序）', () => {
  for (const ph of ['plan', 'pages']) {
    const r = showJson(A.bare, byPhase[ph], 'site/.build/state.json').recipe;
    assert.ok(r, `${ph} 存档里没有 recipe`);
    assert.deepStrictEqual(r.nav, ['services'], ph);
    assert.deepStrictEqual(Object.keys(r.blocks).sort(), [...RECIPE_SLUGS].sort(), ph);
    assert.deepStrictEqual(r.blocks.contact.map((x) => x.type), ['page-header', 'contact'], ph);
  }
});
// 配方预设写进了块的 options（阳性对照：下面 P 那一跑要跟它逐字节相同，这一格证明那份比较里真有预设）。
const presetKnobsIn = (work, slug) => JSON.parse(fs.readFileSync(path.join(work, 'site', 'zh', 'pages', `${slug}.json`), 'utf8'))
  .blocks.filter((x) => x.data && x.data.options && Object.keys(x.data.options).length).length;
check('#1601 对照：从头建那次 services 页、services/cut 页的块带着配方预设写的 options', () => {
  assert.ok(presetKnobsIn(A.work, 'services') >= 2, `services ${presetKnobsIn(A.work, 'services')}`);
  assert.ok(presetKnobsIn(A.work, 'services/cut') >= 2, `services/cut ${presetKnobsIn(A.work, 'services/cut')}`);
});
const filesA = siteFiles(A.work);
if (commitsA.length !== 5) die(`A 没有 5 个阶段提交（${commitsA.length}），下面的续跑格子没有起点`);

// ── B：在 pages 之后续跑（AC2），manager 这一次送来的轮换下标会挑出另一套主题 ─────────────────────────────────
console.log('── B：buildPhase = pages 的仓，新容器 resume:true（轮换下标换成 1）');
const { pickThemeForIndustry } = require('./themes');
const OTHER_INDEX = 1;
const B = containerAt('from-pages', A.bare, byPhase.pages);
const RB = run('from-pages', B.work, PAYLOAD({ resume: true, themeRotationIndex: OTHER_INDEX }));
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
  assert.strictEqual(JSON.parse(fs.readFileSync(path.join(B.work, 'site', 'theme.json'), 'utf8')).themeId, 'azure-29');
  assert.ok(RB.stderr.includes('主题沿用存档里那套 azure-29'), RB.stderr.split('\n').filter((l) => l.includes('[resume]')).join('\n'));
});
check('最终站点文件跟从头建那次逐字节相同（续上的就是同一个站）', () => {
  const filesB = siteFiles(B.work);
  assert.deepStrictEqual(Object.keys(filesB).sort(), Object.keys(filesA).sort());
  const diff = Object.keys(filesA).filter((f) => filesA[f] !== filesB[f]);
  assert.deepStrictEqual(diff, []);
});
check('续跑只补了后三个阶段的提交（pages 之后 images / keywordPages / secondaryLocales 各一个）', () => {
  assert.deepStrictEqual(phaseCommits(B.bare).map((c) => c.phase), PHASES);
  assert.deepStrictEqual(git(B.bare, ['log', '--format=%s', `${byPhase.pages}..main`]).split('\n').reverse(),
    ['images 3/5', 'keywordPages 4/5', 'secondaryLocales 5/5'].map((p) => `Generate site: rs159801 (phase: ${p})`));
});

// ── P：在 plan 之后续跑（#1601 × #1598）：每页那几通要重发，而它们的块序 / 预设来自配方 —— 配方按对象身份记，得从存档挂回来 ─────
console.log('── P：buildPhase = plan 的仓 resume:true（每页那几通重发，块序和预设从存档里的配方来）');
const P = containerAt('from-plan', A.bare, byPhase.plan);
const RP = run('from-plan', P.work, PAYLOAD({ resume: true }));
check('建站成功；站级 0 通、每页 N 通（plan 跳过、pages 重跑）；日志说配方跟着存档回来了', () => {
  assertOk(RP);
  assert.strictEqual(count(RP, 'site'), 0);
  assert.strictEqual(count(RP, 'page'), N);
  assert.ok(RP.stderr.includes('[resume] 整站配方跟着存档回来：9 页的块序；顶部导航 services'), RP.stderr.split('\n').filter((l) => l.includes('[resume]')).join('\n'));
});
check('#1601：续跑那几通每页提示词照样锁着配方的块序（首页之外 9 页都有 FIXED 那一行）', () => {
  const fixedPrompts = RP.events.filter((e) => e.event === 'prompt' && /^Page: /.test(e.name) && /This page's sections are FIXED/.test(e.content));
  assert.deepStrictEqual(fixedPrompts.map((e) => e.name.replace(/^Page: /, '')).sort(), [...RECIPE_SLUGS].sort());
});
check('#1601：最终站点文件跟从头建那次逐字节相同（块序、配方预设、导航、按钮全在）', () => {
  const f = siteFiles(P.work);
  assert.deepStrictEqual(Object.keys(f).sort(), Object.keys(filesA).sort());
  assert.deepStrictEqual(Object.keys(filesA).filter((k) => f[k] !== filesA[k]), []);
  assert.ok(presetKnobsIn(P.work, 'services/cut') >= 2);
});

// ── C / D：在 images 之后、keywordPages 之后续跑 ───────────────────────────────────────────────────────────
console.log('── C：buildPhase = images 的仓 resume:true');
const C = containerAt('from-images', A.bare, byPhase.images);
const RC = run('from-images', C.work, PAYLOAD({ resume: true }));
check('建站成功；站级 / 每页 0 通，关键词页照发；进度从 50 开始；产物与从头建相同', () => {
  assertOk(RC);
  assert.strictEqual(count(RC, 'site') + count(RC, 'page'), 0);
  assert.ok(count(RC, 'keyword') >= 2);
  assert.strictEqual(progressOf(RC)[0].percent, 50);
  const f = siteFiles(C.work);
  assert.deepStrictEqual(Object.keys(f).filter((k) => f[k] !== filesA[k]), []);
});
console.log('── D：buildPhase = keywordPages 的仓 resume:true');
const D = containerAt('from-kw', A.bare, byPhase.keywordPages);
const RD = run('from-kw', D.work, PAYLOAD({ resume: true }));
check('建站成功；一通 AI 调用都没有；进度从 70 开始；只补了 secondaryLocales 那一个提交，锚点指向它', () => {
  assertOk(RD);
  assert.deepStrictEqual(RD.calls, []);
  assert.strictEqual(progressOf(RD)[0].percent, 70);
  assert.strictEqual(git(D.bare, ['log', '--format=%s', `${byPhase.keywordPages}..main`]), 'Generate site: rs159801 (phase: secondaryLocales 5/5)');
  assert.strictEqual(RD.events.find((e) => e.event === 'chat-message').commit_hash, git(D.work, ['rev-parse', '--short', 'HEAD']));
  assert.ok(!fs.existsSync(path.join(D.work, 'site', '.build')));
});

// ── 建站报告（#1600）跟着存档走：SEO 检查和关键词页 N/M 记在 keywordPages 阶段里，从它之后续跑也不能变成 null ─────────
check('建站报告：从 pages / images / keywordPages 续跑，报告跟从头建那次相同（seo / repair / keywordPages 三格都有值）', () => {
  const a = reportOf(A.work);
  assert.ok(a.seo && a.repair && a.keywordPages, `对照失效：从头建那次三格里有 null ${JSON.stringify({ seo: !!a.seo, repair: !!a.repair, keywordPages: !!a.keywordPages })}`);
  for (const [name, X] of [['pages', B], ['images', C], ['keywordPages', D]]) {
    assert.deepStrictEqual(reportOf(X.work), a, `从 ${name} 续跑的报告跟从头建不同`);
  }
});

check('#1593 的 costUsd 不进站仓：四个阶段提交里的存档都没有 costUsd（阳性对照：最终报告里有，且大于 0）', () => {
  const withState = commitsA.filter((c) => hasPath(A.bare, c.sha, 'site/.build/state.json'));
  assert.strictEqual(withState.length, 4);
  for (const c of withState) assert.ok(!git(A.bare, ['show', `${c.sha}:site/.build/state.json`]).includes('costUsd'), `${c.phase} 那次提交的存档里有 costUsd`);
  const cost = JSON.parse(fs.readFileSync(path.join(A.work, REPORT), 'utf8')).costUsd;
  assert.ok(typeof cost === 'number' && cost > 0, `对照失效：从头建那次报告的 costUsd = ${cost}`);
});

// ── L：有第二语言（zh + en）的站，从 pages / keywordPages 之后续跑（#1593 的第二语言账跟着存档走）──────────────────
console.log('── L：zh + en 的站，从头建一次，再从 pages / keywordPages 之后续跑');
const L = freshRepo('locales');
const RL = run('locales', L.work, PAYLOAD({ secondaryLocales: ['en'] }));
const enFiles = (work) => Object.keys(siteFiles(work)).filter((f) => f.startsWith(path.join('site', 'en') + path.sep));
check('对照：从头建 rc 0，site/en 写出来了，没有 secondary-locale-failed', () => {
  assertOk(RL);
  const why = () => [...RL.events.filter((e) => e.event === 'secondary-locale-failed').map((e) => JSON.stringify(e)),
    ...RL.stderr.split('\n').filter((l) => /\[locales\]|Secondary locale/.test(l))].join('\n');
  assert.ok(enFiles(L.work).length > N, `site/en 只有 ${enFiles(L.work).length} 个文件\n${why()}`);
  assert.deepStrictEqual(RL.events.filter((e) => e.event === 'secondary-locale-failed'), []);
});
const byPhaseL = Object.fromEntries(phaseCommits(L.bare).map((c) => [c.phase, c.sha]));
const filesL = siteFiles(L.work);
for (const from of ['pages', 'keywordPages']) {
  const X = containerAt(`locales-from-${from}`, L.bare, byPhaseL[from]);
  const RX = run(`locales-from-${from}`, X.work, PAYLOAD({ secondaryLocales: ['en'], resume: true }));
  check(`从 ${from} 续跑：没有 secondary-locale-failed，site/en 跟从头建那次逐字节相同（整个 site/ 也相同）`, () => {
    assertOk(RX);
    assert.deepStrictEqual(RX.events.filter((e) => e.event === 'secondary-locale-failed').map((e) => e.error), []);
    const f = siteFiles(X.work);
    assert.deepStrictEqual(enFiles(X.work), enFiles(L.work));
    assert.deepStrictEqual(Object.keys(f).sort(), Object.keys(filesL).sort());
    assert.deepStrictEqual(Object.keys(filesL).filter((k) => f[k] !== filesL[k]), []);
  });
}

// ── M：#1596 的降级跟着存档走 —— 站级那一通被截断（降级成代码拼的站级计划），从 pages / keywordPages 之后续跑 ─────────
//    ① 建站报告的 degraded 那一格仍有那一笔 site-plan（它记在 plan 阶段，续跑那一截不会再记）
//    ② brand.json 仍没有 email 键（「brand 是代码拼的」那一位记在 plan / pages 存档里；丢了它续跑就落进 'info@example.com' 兜底）
console.log('── M：站级那一通被截断（#1596 降级），从头建一次，再从 pages / keywordPages 之后续跑');
const M = freshRepo('degraded');
const RM = run('degraded', M.work, PAYLOAD(), { site: 'truncated' });
const degradedOfReport = (work) => JSON.parse(fs.readFileSync(path.join(work, REPORT), 'utf8')).degraded;
const brandOf = (work) => JSON.parse(fs.readFileSync(path.join(work, 'site', 'brand.json'), 'utf8'));
check('对照：从头建 rc 0，恰好一笔 site-plan 降级（事件 = 报告），brand.json 没有 email 键', () => {
  assertOk(RM);
  const ev = RM.events.filter((e) => e.event === 'degraded').map(({ step, target, reason }) => ({ step, target, reason }));
  assert.deepStrictEqual(ev.map((d) => d.step), ['site-plan'], JSON.stringify(ev));
  assert.deepStrictEqual(degradedOfReport(M.work), ev);
  assert.ok(!('email' in brandOf(M.work)), JSON.stringify(brandOf(M.work).email));
});
const byPhaseM = Object.fromEntries(phaseCommits(M.bare).map((c) => [c.phase, c.sha]));
const filesM = siteFiles(M.work);
for (const from of ['pages', 'keywordPages']) {
  const X = containerAt(`degraded-from-${from}`, M.bare, byPhaseM[from]);
  const RX = run(`degraded-from-${from}`, X.work, PAYLOAD({ resume: true }), { site: 'truncated' });
  check(`从 ${from} 续跑：站级调用 0、这一截没有新的降级事件；报告的 degraded 跟从头建那次相同（仍是那一笔 site-plan）`, () => {
    assertOk(RX);
    assert.strictEqual(count(RX, 'site'), 0);
    assert.deepStrictEqual(RX.events.filter((e) => e.event === 'degraded'), []);
    assert.deepStrictEqual(degradedOfReport(X.work), degradedOfReport(M.work));
  });
  check(`从 ${from} 续跑：brand.json 仍没有 email 键，整个 site/ 跟从头建那次逐字节相同`, () => {
    assert.ok(!('email' in brandOf(X.work)), JSON.stringify(brandOf(X.work).email));
    const f = siteFiles(X.work);
    assert.deepStrictEqual(Object.keys(f).sort(), Object.keys(filesM).sort());
    assert.deepStrictEqual(Object.keys(filesM).filter((k) => f[k] !== filesM[k]), []);
  });
}

// ── 版本历史的夹具（正文做什么 5）：三份站仓提交标题清单，新的在前（= GitHub `GET /commits` 的顺序），manager 那一侧
// `ticket1598_test.go` §TestTicket1598_VersionsListOnlyTheFinishedBuild 把它们喂给真的 §githubSiteVersions。
// 🔴 这一格比的是「这一次建站真留下的标题」与仓里那份夹具逐字相同 —— 阶段改了（#1593 删 secondaryLocales）、标题格式改了，
//    这里先红，重出夹具（RS_WRITE_FIXTURE=1）之后 manager 那一侧量的就是新的形状，不会拿一份过期的清单一直绿下去。
const FIXTURE = path.join(__dirname, 'lib', 'testdata', '1598-build-commits.json');
const subjects = (repo, ref) => git(repo, ['log', '--format=%s', ref]).split('\n');
const fixtureNow = {
  about: '#1598 —— 打桩建站（scripts/create-site-resume.test.js）留下的站仓提交标题，新的在前。complete = 从头建完；stoppedAtImages = 建到 images 被截断、还没续跑；resumedFromImages = 从那里续跑完。重出：cd templates/nextjs && RS_WRITE_FIXTURE=1 node scripts/create-site-resume.test.js',
  complete: subjects(A.bare, 'main'),
  stoppedAtImages: subjects(A.bare, byPhase.images),
  resumedFromImages: subjects(C.bare, 'main'),
};
if (process.env.RS_WRITE_FIXTURE === '1') fs.writeFileSync(FIXTURE, JSON.stringify(fixtureNow, null, 2) + '\n');
check('版本历史夹具 lib/testdata/1598-build-commits.json 与这一次建站真留下的提交标题逐字相同', () => {
  assert.ok(fs.existsSync(FIXTURE), `${FIXTURE} 不存在 —— RS_WRITE_FIXTURE=1 重出`);
  assert.deepStrictEqual(JSON.parse(fs.readFileSync(FIXTURE, 'utf8')), fixtureNow, '不一致 —— 阶段或标题格式变了：RS_WRITE_FIXTURE=1 重出，并重跑 manager 的 TestTicket1598_VersionsListOnlyTheFinishedBuild');
  assert.strictEqual(fixtureNow.complete.length, PHASES.length + 1, '对照：从头建那份应是 Initial commit + 每个阶段一个');
});

// ── E：已经建完的站再点续跑；F：同一个仓不带 resume（= Rebuild）───────────────────────────────────────────
console.log('── E：五个阶段都已完成的仓 resume:true');
const E = containerAt('done', A.bare, byPhase.secondaryLocales);
const RE = run('done', E.work, PAYLOAD({ resume: true }));
check('rc 0、一通调用都没有、没有新提交，进度直接 85', () => {
  assertOk(RE);
  assert.deepStrictEqual(RE.calls, []);
  assert.strictEqual(git(E.work, ['rev-parse', 'HEAD']), byPhase.secondaryLocales);
  assert.deepStrictEqual(progressOf(RE).map((e) => e.percent), [85]);
});
console.log('── F：同一个建完的仓，不带 resume（admin Rebuild 的形状）');
const F = containerAt('rebuild', A.bare, byPhase.secondaryLocales);
const RF = run('rebuild', F.work, PAYLOAD());
check('PM r2 裁定 一：照旧从头建 —— 站级 1 通、每页 N 通，新补 5 个阶段提交', () => {
  assertOk(RF);
  assert.strictEqual(count(RF, 'site'), 1);
  assert.strictEqual(count(RF, 'page'), N);
  assert.strictEqual(git(F.bare, ['log', '--format=%s', `${byPhase.secondaryLocales}..main`]).split('\n').filter((l) => l.includes('phase:')).length, 5);
});

// ── G / H：续不了 ⟹ 从头建 ────────────────────────────────────────────────────────────────────────────────
console.log('── G：从没建过的仓 resume:true');
const G = freshRepo('nothing');
const RG = run('nothing', G.work, PAYLOAD({ resume: true }));
check('从头建（站级 1 通），日志说清为什么续不了，进度先报一句「Nothing saved to resume from」', () => {
  assertOk(RG);
  assert.strictEqual(count(RG, 'site'), 1);
  assert.ok(RG.stderr.includes('[resume] 续不了，从头建：site/site_meta.json 读不到'), RG.stderr.split('\n').filter((l) => l.includes('[resume]')).join('\n'));
  assert.strictEqual(progressOf(RG)[0].message, 'Nothing saved to resume from — building from the start...');
});
console.log('── H：存档跟标记对不上（手改过的仓）');
const H = containerAt('mismatch', A.bare, byPhase.pages);
{
  const st = path.join(H.work, 'site', '.build', 'state.json');
  const j = JSON.parse(fs.readFileSync(st, 'utf8'));
  j.phase = 'plan';
  fs.writeFileSync(st, JSON.stringify(j));
}
const RH = run('mismatch', H.work, PAYLOAD({ resume: true }));
check('不拿它跳阶段：从头建（站级 1 通、每页 N 通），日志点名「存档跟标记对不上」', () => {
  assertOk(RH);
  assert.strictEqual(count(RH, 'site'), 1);
  assert.strictEqual(count(RH, 'page'), N);
  assert.ok(RH.stderr.includes('存档跟标记对不上：buildPhase pages，存档写的是 "plan"'), RH.stderr.split('\n').filter((l) => l.includes('[resume]')).join('\n'));
});

// ── I：推送失败 ──────────────────────────────────────────────────────────────────────────────────────────
console.log('── I：远端推不上去（地址里带着 token 字样，量日志脱敏）');
const I = freshRepo('push-fails');
git(I.work, ['remote', 'set-url', 'origin', path.join(I.root, `gone-${TOKEN}`, 'origin.git')]);
const RI = run('push-fails', I.work, PAYLOAD());
check('建站照常成功，本地仓 5 个阶段提交都在（标记跟产物同一个提交，不回滚）', () => {
  assertOk(RI);
  assert.deepStrictEqual(phaseCommits(I.work).map((c) => c.phase), PHASES);
});
check('每个阶段一行「推送失败」日志，不发 warn 事件（权威读数留给 entrypoint.sh 最后那一次推送）', () => {
  assert.strictEqual((RI.stderr.match(/\[resume\] ⚠️ 阶段 \w+ 已提交、推送失败/g) || []).length, 5);
  assert.strictEqual(RI.events.filter((e) => e.event === 'warn').length, 0);
});
check('git 报错里的 token 被换成 ***（阳性：那几行确实带着被换掉的地址）', () => {
  assert.ok(!RI.stderr.includes(TOKEN) && !RI.stdout.includes(TOKEN), '日志里出现了 token');
  assert.ok(RI.stderr.includes('gone-***'), RI.stderr.split('\n').filter((l) => l.includes('推送失败')).slice(0, 1).join('\n'));
});

console.log(`\n══ 汇总: 通过 ${pass} · 失败 ${fail} ══`);
process.exit(fail ? 1 : 0);
