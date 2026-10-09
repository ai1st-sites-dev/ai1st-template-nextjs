#!/usr/bin/env node
// #1599 —— 三段式建站（lib/staged-preview.js）：真 create-site.js 进程 + 真 `next build`，AI 用按提示词回放的桩（同
// create-site-resume.test.js 的桩与输入：7 服务中文站 + 两个关键词页），外加一个真 git 仓。预览进程用本文件里一个
// 每次请求现读 `out` 链接的静态服务代替（跟容器里的 `serve out` 同一个读法：链接换了，下一个请求就读新的）。
//
// 🔴 不是 skipAI：skipAI 在五个阶段之前就 return，没有阶段可分。🔴 不调真 AI（#1499）。
// 🔴 慢：每一跑 4 次真 `next build`。三跑并行。
//
// 量的是（正文验收第 2–4 条）：
//   A（图片成功、带第二语言 en）
//     · 发 preview-viewable 那一刻，从 out/ 首页顺着站内链接把点得到的页全走一遍：没有一页 404，没有一页是骨架页（seo.placeholder）
//       —— #1596 判成降级、留有 degraded 记录的那页除外。阳性：走到的页数 ≥ 导航里的页数
//     · content-changed（#1666 前叫 preview-reload） 的集合 = BUILD_PHASES 里 pages 之后的每个阶段各一次（从那张表读）
//     · 最后一次之后 out/ 指着最后那次构建，那次构建的输入 = 建完时 site/ 里的站（逐字节）；result.json final = true
//       （entrypoint 据它直接发 preview-started、不再构建）
//     · 从 viewable 起每次重构建期间轮询首页，一次都不是非 200（阳性：轮询次数 > 0）
//     · ① 骨架那一版先换上了、没发任何事件；② 之前的构建只带主语言（en 还没写）；最后一版带上 en
//     · 预览的文件没进阶段提交（#1598 的不变量：images 那个提交里还没有 site/brand.json）
//     · create-site 退出后 site/ public/ 下没有 git 看得见的未提交文件（#1613：entrypoint 据此判 archived，预览构建不能弄脏它）
//   B（图阶段失败：生图全部离线）：照常建完、三次 content-changed 都发、result.json final = true（⟹ entrypoint 发 preview-started）、
//     关键词页照常补齐（最后那版 out/ 里有）、报告里图那一行 generated < requested
//   C（反向对照）：把 ② 那一版里一个导航页（非首页）换成骨架页、不发 degraded（= 「② 没做完就发了事件」），A 那把尺子必须读红
//   D（没打开）：不给 STAGED_PREVIEW_DIR ⟹ 不发任何预览事件、不建 out —— 跟改之前一样
//   E（#1668 换链接模式，图片成功）：容器替身 = 一次真的预览模式 `next build`（跟 create-site 并行起）+ 真 `next start`，
//     SYNC_SITE_DIR = 一个链接；STAGED_PREVIEW_RESTART = 本文件的 §RESTART_JS（public/ 文件清单变了就重启，同 preview-live.sh）
//     · 发 preview-viewable 那一刻经 HTTP 顺着站内链接把点得到的页全走一遍：全 200、有生意的真名字、没有骨架页，链接指着 ② 的快照
//     · 分段建站本身一次 `next build` 都不跑（没有任何 <k>/out 目录），整跑「Running next build」只有并行那 1 行
//     · images 阶段往 public/photos/ 写了图 ⟹ 服务重启过（进程号变了），之后页面引用的每张 /photos/ 图都 200；
//       重启之后才发那一阶段的 content-changed（#1666 前叫 preview-reload）
//     · 被链接指着的快照还在（今天 §build 构建完就删快照，新路不许）
//   F（#1668，并行那次构建故意失败：交付树里弄坏一个块组件）：建站照常完成（rc 0），不发 preview-viewable、不发 content-changed（#1666 前叫 preview-reload）
//   A / B 都按真 AI 时序跑（桩 §gate，r4）：② 那次构建结束之前 site/ 里一页都没有 —— 构建只许读快照（编辑器页偷读 site/ 那次，
//   appdev 上两次阶段构建全红、preview-viewable 没发，而这份测试因为桩瞬时写满了 site/ 一直是绿的）
'use strict';

const assert = require('assert');
const cp = require('child_process');
const fs = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');

const NEXT = path.resolve(__dirname, '..');
const { BUILD_PHASES } = require('./lib/build-phases');
const { fillPhases, VIEWABLE_PHASE } = require('./lib/staged-preview');
const TEMP = [];
process.on('exit', () => {
  if (process.env.SP_KEEP === '1') { if (TEMP.length) console.log(`📌 SP_KEEP=1 ⟹ 留着 ${TEMP.join(' ')}`); return; }
  for (const d of TEMP) { try { fs.rmSync(d, { recursive: true, force: true }); } catch (e) { /* 打扫不成不改结论 */ } }
});
function die(msg) { console.log(`💥 ${msg}`); process.exit(2); }
if (!fs.existsSync(path.join(NEXT, 'node_modules', '.bin', 'next'))) die('templates/nextjs/node_modules 里没有 next —— 先 npm ci（这份测试要真构建）');

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
const cfg = JSON.parse(fs.readFileSync(process.env.SP_STUB_CFG, 'utf8'));
// #1599 —— 生图那一家（Nano Banana）在 cfg.images === 'ok' 的那几跑回一张假图（同 create-site-all-locales.test.js），其余一律离线：
//    「图阶段失败」那一跑就是离线那一支（logo 和每一张照片都失败）。
// #1599 r4 —— 真 AI 时序：cfg.holdAfterPages 的那几跑，pages 阶段之后的第一次联网（geocode / 生图）等 ② 那次构建（#2）跑完才放行。
//    真建站里 pages 之后还要几分钟 AI，② 构建期间 site/ 里一页都还没写（页面只在快照里）；桩是瞬时的，不拦的话 site/ 在构建
//    预渲染之前就被写满了 ⟹ 「构建偷读 site/」这一类缺陷在这里永远是绿的（appdev site-fd7e9c78：`#1409 editor: en/home → no-page`，
//    两次阶段构建全红、preview-viewable 没发，而这份测试 19/19 绿）。何时拦看 #2 的快照目录，何时放行读 create-site 自己打的
//    「#2（pages 之后）…」那一行（成功失败都打）。
let gate = async () => {};
if (cfg.holdAfterPages) {
  let seen = '';
  const w = process.stderr.write.bind(process.stderr);
  process.stderr.write = (chunk, ...a) => { seen += String(chunk); return w(chunk, ...a); };
  let held = false;
  gate = async () => {
    // #2 的快照目录在了 = pages 阶段做完了（phaseDone 当场同步拍快照；这几跑 STAGED_PREVIEW_KEEP=1，快照不删）
    if (held || !fs.existsSync(require('path').join(process.env.STAGED_PREVIEW_DIR, '2', 'site'))) return;
    held = true;
    const t0 = Date.now();
    // #1668 换链接模式：② 那一阶段不构建，「#2（pages 之后…」那一行在派生完就打了 —— 真建站里那之后还有几分钟 AI，
    //    而并行那次预览构建（约 35 秒）早就编完、服务早就起来了。所以这几跑等的是「preview-viewable 已发」：图阶段写图必然晚于开服，
    //    第 8 条那次重启才真的被驱动到（不等的话，图在服务起来之前就写好了，这一格按构造是绿的）。
    const doneRe = process.env.STAGED_PREVIEW_LIVE ? /\[staged-preview\] #2（pages 之后）预览服务答了 200/ : /\[staged-preview\] #2（pages 之后/;
    while (!doneRe.test(seen) && Date.now() - t0 < 10 * 60 * 1000) await new Promise((r) => setTimeout(r, 200));
    const done = doneRe.test(seen);
    fs.appendFileSync(process.env.SP_STUB_CALLS, JSON.stringify({ kind: 'hold', done, ms: Date.now() - t0, siteHome: fs.existsSync('site/zh/pages/home.json') }) + '\n');
  };
}
globalThis.fetch = async (url) => {
  await gate();
  if (cfg.images === 'ok' && String(url).includes('generativelanguage')) {
    return { ok: true, json: async () => ({ candidates: [{ content: { parts: [{ inlineData: { data: Buffer.from('fakejpg').toString('base64') } }] } }] }), text: async () => '' };
  }
  throw new Error('offline (test stub)');
};
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
// #1599 —— 这份桩的按钮指 /contact（create-site-resume.test.js 那份指 /quote —— 配方站里没有那一页，是夹具自带的死链；
//    「发 viewable 那一刻没有一页 404」量的是预览缺页，夹具自带的死链会让这一格对任何实现都红）。
function sectionsFor(slug, title, prompt) {
  const fixed = (prompt.match(/write exactly these \d+, in this order: ([^\n]+?)\. Do not add/) || [])[1];
  if (fixed) return fixed.split(' → ').map((t) => BLOCK[JSON.parse(t)](title, prompt));
  const tail = [
    { type: 'faq', data: { headline: '常见问题', items: [{ question: '需要预约吗？', answer: '建议提前预约，也欢迎直接到店。' }] } },
    { type: 'cta', data: { headline: '现在预约', body: '告诉我们您想要的造型。', ctas: [{ label: '预约', href: '/contact', style: 'solid' }] } },
  ];
  if (slug === 'home') {
    return [
      { type: 'hero', data: { headline: title, subheadline: BODY, ctas: [{ label: '预约', href: '/contact', style: 'solid' }] } },
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
  fs.appendFileSync(process.env.SP_STUB_CALLS, JSON.stringify({ kind, slug }) + '\n');
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
      { type: 'cta', data: { headline: '现在预约', body: '告诉我们您想要的造型。', ctas: [{ label: '预约', href: '/contact', style: 'solid' }] } },
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
const STUB = `(${stubMain.toString()})();\n`;
const TOKEN = 'tok-SP1599';
const PAYLOAD = (extra = {}) => ({
  siteId: 'sp159901', siteUrl: 'https://silky.test', companyName: 'Silky Hair Salon', industry: 'hair salon', location: 'Toronto, ON',
  language: 'zh', services: SERVICES.map(([, n]) => n), homepageFingerprint: false,
  keywords: { '剪发': [{ keyword: '剪发店', selected: true, volume: 300 }, { keyword: '男士理发', selected: true, volume: 200 }] },
  repoUrl: 'https://github.com/test/sp159901.git', gitToken: TOKEN, themeRotationIndex: 0,
  ...extra,
});

const git = (cwd, args) => cp.execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
/** 一个「刚从模板生成」的站仓（同 create-site-resume.test.js §freshRepo）。`mutate(work)` 在提交之前改仓里的文件（反向对照用）。 */
function freshRepo(label, mutate) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), `sp1599-${label}-`));
  TEMP.push(root);
  const work = path.join(root, 'repo');
  cp.execSync(`tar --exclude=./node_modules --exclude=./out --exclude=./.next --exclude=./site --exclude=./public/photos -cf - . | (mkdir -p "${work}" && tar -xf - -C "${work}")`, { cwd: NEXT, stdio: 'pipe' });
  if (mutate) mutate(work);
  git(work, ['init', '-q', '-b', 'main']);
  git(work, ['config', 'user.name', 'AI1st']);
  git(work, ['config', 'user.email', 'ai1st@ai1st.site']);
  git(work, ['add', '-A']);
  git(work, ['commit', '-q', '-m', 'Initial commit']);
  const bare = path.join(root, 'origin.git');
  git(root, ['clone', '-q', '--bare', work, bare]);
  git(work, ['remote', 'add', 'origin', bare]);
  fs.symlinkSync(path.join(NEXT, 'node_modules'), path.join(work, 'node_modules'));
  return { root, work, bare, builds: path.join(root, 'preview-builds') };
}

/** 跟容器里 `serve out` 同一个读法：每个请求现解析 `out`（是个链接），/x → x.html 或 x/index.html。 */
function serveOut(work) {
  const server = http.createServer((req, res) => {
    let p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    const base = path.join(work, 'out');
    const cands = p.endsWith('/') ? [`${p}index.html`] : [p, `${p}.html`, `${p}/index.html`];
    for (const c of cands) {
      const f = path.join(base, c);
      try { if (fs.statSync(f).isFile()) { res.writeHead(200); res.end(fs.readFileSync(f)); return; } } catch (e) { /* 下一个 */ }
    }
    res.writeHead(404); res.end('not found');
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(server)));
}

const get = (port, p) => new Promise((resolve) => {
  const req = http.get({ host: '127.0.0.1', port, path: p }, (r) => { r.resume(); r.on('end', () => resolve(r.statusCode)); });
  req.on('error', () => resolve(0));
});

/** 跑一次 create-site。onEvent(e, R) 在每条事件到达时调（可返回 'kill' 让进程停下）。 */
function run(label, repo, payload, { env = {}, cfg = {}, staged = true, onEvent } = {}) {
  const stub = path.join(repo.root, 'stub.js');
  const cfgFile = path.join(repo.root, 'cfg.json');
  const calls = path.join(repo.root, 'calls.jsonl');
  fs.writeFileSync(stub, STUB);
  fs.writeFileSync(cfgFile, JSON.stringify({ plan: plan(), ...((payload.secondaryLocales || []).includes('en') ? { locales: { en: EN_SITE } } : {}), ...cfg }));
  fs.writeFileSync(calls, '');
  return new Promise((resolve) => {
    const R = { label, events: [], stdout: '', stderr: '', rc: null };
    const p = cp.spawn(process.execPath, ['--require', stub, path.join(repo.work, 'scripts', 'create-site.js')], {
      cwd: repo.work,
      env: {
        ...process.env, ANTHROPIC_API_KEY: 'stub-not-used', SP_STUB_CFG: cfgFile, SP_STUB_CALLS: calls,
        ...(staged ? { STAGED_PREVIEW_DIR: repo.builds, STAGED_PREVIEW_KEEP: '1' } : {}), ...env,
      },
    });
    const timer = setTimeout(() => { R.timedOut = true; p.kill('SIGKILL'); }, 20 * 60 * 1000);
    let buf = '';
    p.stdout.on('data', (d) => {
      R.stdout += d;
      buf += d;
      let i;
      while ((i = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, i);
        buf = buf.slice(i + 1);
        if (!line) continue;
        let e;
        try { e = JSON.parse(line); } catch (x) { e = { event: '(非 JSON)', raw: line }; }
        R.events.push(e);
        if (onEvent && onEvent(e, R) === 'kill') { R.killed = true; p.kill('SIGKILL'); }
      }
    });
    p.stderr.on('data', (d) => { R.stderr += d; });
    p.stdin.end(JSON.stringify(payload));
    p.on('exit', (code) => { clearTimeout(timer); R.rc = code; R.error = (R.events.find((e) => e.event === 'error') || {}).message || ''; resolve(R); });
  });
}

const PAGE_EXT = /\.(css|js|mjs|map|png|jpe?g|webp|gif|svg|ico|xml|txt|json|woff2?|ttf|pdf)$/i;
/**
 * 「发 preview-viewable 那一刻老板点得到的页」：从构建目录 `outDir` 的首页出发，顺着站内链接（href="/…"）把能走到的页全走一遍。
 * 每页的 slug 去那次构建的输入（快照 `siteDir`）里读页面 JSON，看它是不是骨架页。回 { visited, missing, placeholders }。
 */
function crawl(outDir, siteDir, locale) {
  const fileOf = (p) => [p === '/' ? 'index.html' : null, `${p.slice(1)}.html`, `${p.slice(1)}/index.html`]
    .filter(Boolean).map((f) => path.join(outDir, f)).find((f) => fs.existsSync(f) && fs.statSync(f).isFile());
  const seen = new Set(['/']);
  const queue = ['/'];
  const visited = [];
  const missing = [];
  const placeholders = [];
  while (queue.length) {
    const p = queue.shift();
    const f = fileOf(p);
    if (!f) { missing.push(p); continue; }
    visited.push(p);
    const slug = p === '/' ? 'home' : p.slice(1);
    const pageJson = path.join(siteDir, locale, 'pages', `${slug}.json`);
    if (fs.existsSync(pageJson)) {
      const pg = JSON.parse(fs.readFileSync(pageJson, 'utf8'));
      if (pg.seo && pg.seo.placeholder === true) placeholders.push(slug);
    }
    for (const m of fs.readFileSync(f, 'utf8').matchAll(/href="(\/[^"]*)"/g)) {
      let h = m[1].split('#')[0].split('?')[0];
      if (!h || h.startsWith('//') || h.startsWith('/_next/') || PAGE_EXT.test(h)) continue;
      if (h.length > 1 && h.endsWith('/')) h = h.slice(0, -1);
      if (!seen.has(h)) { seen.add(h); queue.push(h); }
    }
  }
  return { visited, missing, placeholders };
}

/** 一跑：带着轮询器和「viewable 那一刻」的读数。 */
async function stagedRun(label, repo, payload, { cfg, killAfterViewable = false } = {}) {
  const server = await serveOut(repo.work);
  const port = server.address().port;
  const st = { polls: 0, bad: [], polling: false, atViewable: null, outBeforeViewable: null };
  let stop = false;
  const poll = async () => {
    st.polling = true;
    while (!stop) {
      const code = await get(port, '/');
      st.polls += 1;
      if (code !== 200) st.bad.push(code);
      await new Promise((r) => setTimeout(r, 25));
    }
  };
  let poller = null;
  const R = await run(label, repo, payload, {
    cfg,
    env: { STAGED_PREVIEW_PORT: String(port) },
    onEvent: (e, r) => {
      if (e.event !== 'preview-viewable') return undefined;
      const outDir = fs.readlinkSync(path.join(repo.work, 'out'));
      const degradedPages = r.events.filter((x) => x.event === 'degraded' && x.step === 'page').map((x) => x.target);
      st.atViewable = { outDir, siteDir: path.join(path.dirname(outDir), 'site'), degradedPages, index: r.events.length - 1 };
      st.atViewable.crawl = crawl(outDir, st.atViewable.siteDir, 'zh');
      if (killAfterViewable) return 'kill';
      poller = poll();
      return undefined;
    },
  });
  stop = true;
  if (poller) await poller;
  server.close();
  R.st = st;
  R.result = (() => { try { return JSON.parse(fs.readFileSync(path.join(repo.builds, 'result.json'), 'utf8')); } catch (e) { return null; } })();
  return R;
}

// ── #1668 容器替身（换链接模式）────────────────────────────────────────────────────────────────────────────
// 同 worker/preview-live.sh §restart-if-public-changed：public/ 的文件清单跟开服时那份不一样就杀掉服务、起新的、等它答 200。
// 本文件不引 worker/ 那份脚本（模板会被同步到单独的模板仓，那边没有 worker/）——判据一句话，在这里照写。
const RESTART_JS = `
const fs = require('fs'), path = require('path'), cp = require('child_process'), http = require('http');
const st = process.env.SP_LIVE_STATE;
const list = () => { const out = []; const walk = (d) => { let es = []; try { es = fs.readdirSync(d, { withFileTypes: true }); } catch (e) { return; }
  for (const e of es) { const f = path.join(d, e.name); if (e.isDirectory()) walk(f); else out.push(f); } }; walk('public'); return out.sort().join('\\n'); };
const now = list();
if (now === fs.readFileSync(path.join(st, 'public-list'), 'utf8')) process.exit(0);
const old = Number(fs.readFileSync(path.join(st, 'server.pid'), 'utf8'));
try { process.kill(old); } catch (e) {}
const port = fs.readFileSync(path.join(st, 'port'), 'utf8').trim();
const wait = () => new Promise((r) => { const once = () => http.get('http://127.0.0.1:' + port + '/', (x) => { x.resume(); x.statusCode === 200 ? r() : setTimeout(once, 200); }).on('error', () => setTimeout(once, 200)); once(); });
(async () => {
  for (let i = 0; i < 50; i++) { try { process.kill(old, 0); await new Promise((r) => setTimeout(r, 100)); } catch (e) { break; } }
  require(process.env.SP_LIVE_START)(st, port, now, process.cwd());
  await wait();
  fs.appendFileSync(path.join(st, 'restarts'), 'restart\\n');
})();
`;
// 起一个 `next start`（同 entrypoint §run_one_server 的预览那一支：AI1ST_RENDER=preview、SYNC_SITE_DIR=链接），记进程号和开服时的清单。
const START_JS = `
const fs = require('fs'), path = require('path'), cp = require('child_process');
module.exports = (st, port, list, cwd) => {
  fs.writeFileSync(path.join(st, 'public-list'), list);
  const p = cp.spawn(path.join(cwd, 'node_modules', '.bin', 'next'), ['start', '-p', String(port)], { cwd,
    env: { ...process.env, AI1ST_RENDER: 'preview', SYNC_SITE_DIR: fs.readFileSync(path.join(st, 'site-link'), 'utf8').trim() },
    stdio: 'ignore', detached: true });
  p.unref();
  fs.writeFileSync(path.join(st, 'server.pid'), String(p.pid));
};
`;
const freePort = () => new Promise((resolve) => { const s = http.createServer(); s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => resolve(p)); }); });
const fetchText = (port, p) => new Promise((resolve) => {
  const req = http.get({ host: '127.0.0.1', port, path: p }, (r) => { let b = ''; r.setEncoding('utf8'); r.on('data', (d) => { b += d; }); r.on('end', () => resolve({ code: r.statusCode, body: b })); });
  req.on('error', () => resolve({ code: 0, body: '' }));
});
/** 同 §crawl，只是经 HTTP 问服务（新路没有 out/）。每页的 slug 去 siteDir 里读页面 JSON 判骨架页。 */
async function httpCrawl(port, siteDir, locale) {
  const seen = new Set(['/']); const queue = ['/']; const visited = []; const bad = []; const placeholders = []; let names = 0;
  while (queue.length) {
    const p = queue.shift();
    const r = await fetchText(port, p);
    if (r.code !== 200) { bad.push(`${p}=${r.code}`); continue; }
    visited.push(p);
    if (r.body.includes('Silky Hair Salon')) names += 1;
    const slug = p === '/' ? 'home' : p.slice(1);
    const pageJson = path.join(siteDir, locale, 'pages', `${slug}.json`);
    if (fs.existsSync(pageJson)) { const pg = JSON.parse(fs.readFileSync(pageJson, 'utf8')); if (pg.seo && pg.seo.placeholder === true) placeholders.push(slug); }
    for (const m of r.body.matchAll(/href="(\/[^"]*)"/g)) {
      let h = m[1].split('#')[0].split('?')[0];
      if (!h || h.startsWith('//') || h.startsWith('/_next/') || h.startsWith('/~editor') || PAGE_EXT.test(h)) continue;
      if (h.length > 1 && h.endsWith('/')) h = h.slice(0, -1);
      if (!seen.has(h)) { seen.add(h); queue.push(h); }
    }
  }
  return { visited, bad, placeholders, names };
}

/** 一跑新路：并行起真预览构建 → 成功就起 next start、写 ok；失败写 failed（同 entrypoint 的建站那一支）。 */
async function liveRun(label, repo, payload, { cfg } = {}) {
  const st = path.join(repo.root, 'live-state');
  fs.mkdirSync(st, { recursive: true });
  fs.mkdirSync(repo.builds, { recursive: true });
  const link = path.join(repo.builds, 'current');
  fs.mkdirSync(path.join(repo.builds, '0-empty', 'site'), { recursive: true });
  fs.symlinkSync(path.join(repo.builds, '0-empty', 'site'), link);
  const status = path.join(repo.builds, 'build-status');
  const port = await freePort();
  fs.writeFileSync(path.join(st, 'port'), String(port));
  fs.writeFileSync(path.join(st, 'site-link'), link);
  fs.writeFileSync(path.join(repo.root, 'restart.js'), RESTART_JS);
  fs.writeFileSync(path.join(repo.root, 'start.js'), START_JS);
  const L = { buildLines: 0, buildLog: '', pidAtViewable: null, atViewable: null, pidsAtReload: {} };
  const listNow = () => { const out = []; const walk = (d) => { let es = []; try { es = fs.readdirSync(d, { withFileTypes: true }); } catch (e) { return; } for (const e of es) { const f = path.join(d, e.name); if (e.isDirectory()) walk(f); else out.push(f); } }; walk(path.join(repo.work, 'public')); return out.map((f) => path.relative(repo.work, f)).sort().join('\n'); };
  // 「Running next build」那一行：同 preview-live.sh §prepare，在起构建的那一刻打（这一跑只有这一处会打）。
  L.buildLines += 1;
  L.buildLog += `Running next build (preview, create) on ${label}...\n`;
  const build = new Promise((resolve) => {
    const b = cp.spawn(path.join(repo.work, 'node_modules', '.bin', 'next'), ['build', '--webpack'], { cwd: repo.work, env: { ...process.env, AI1ST_RENDER: 'preview' } });
    b.stdout.on('data', (d) => { L.buildLog += d; });
    b.stderr.on('data', (d) => { L.buildLog += d; });
    b.on('exit', (code) => {
      if (code === 0) {
        require(path.join(repo.root, 'start.js'))(st, port, listNow(), repo.work);
      }
      fs.writeFileSync(status, code === 0 ? 'ok' : 'failed');
      resolve(code);
    });
  });
  const pid = () => { try { return fs.readFileSync(path.join(st, 'server.pid'), 'utf8'); } catch (e) { return null; } };
  const R = await run(label, repo, payload, {
    cfg,
    env: { STAGED_PREVIEW_PORT: String(port), STAGED_PREVIEW_LIVE: link, STAGED_PREVIEW_BUILD_STATUS: status,
      STAGED_PREVIEW_RESTART: `SP_LIVE_STATE=${st} SP_LIVE_START=${path.join(repo.root, 'start.js')} node ${path.join(repo.root, 'restart.js')}` },
    onEvent: (e, r) => {
      if (e.event === 'preview-viewable') {
        L.pidAtViewable = pid();
        L.atViewable = { target: fs.readlinkSync(link), index: r.events.length - 1, degradedPages: r.events.filter((x) => x.event === 'degraded' && x.step === 'page').map((x) => x.target) };
        // 当场经 HTTP 量（同步的 onEvent 里起一个异步读数，跑完之前 create-site 照常往下走 —— 跟老板点开的那一刻一样）
        L.crawlAtViewable = httpCrawl(port, L.atViewable.target, 'zh');
      }
      if (e.event === 'content-changed') L.pidsAtReload[e.phase] = pid();
      return undefined;
    },
  });
  L.code = await build;
  if (L.crawlAtViewable) L.crawlAtViewable = await L.crawlAtViewable;
  L.port = port;
  L.st = st;
  L.link = link;
  L.pid = pid;
  R.L = L;
  R.result = (() => { try { return JSON.parse(fs.readFileSync(path.join(repo.builds, 'result.json'), 'utf8')); } catch (e) { return null; } })();
  return R;
}
const killServer = (R) => { try { const p = Number(fs.readFileSync(path.join(R.L.st, 'server.pid'), 'utf8')); if (p) process.kill(p); } catch (e) { /* 没起或已退出 */ } };

const ofType = (R, t) => R.events.filter((e) => e.event === t);
const pageFiles = (dir) => {
  const out = {};
  const walk = (d) => { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const f = path.join(d, e.name); if (e.isDirectory()) walk(f); else out[path.relative(dir, f)] = fs.readFileSync(f, 'utf8'); } };
  walk(dir);
  return out;
};
const NAV_SLUG = 'services';   // 配方里顶部导航唯一那一页（非首页），反向对照把它换成骨架页

(async () => {
  console.log('══ #1599 三段式建站（打桩，7 服务中文站 + 2 个关键词页，真 next build）══');
  console.log(`   BUILD_PHASES = ${BUILD_PHASES.join(' → ')} ⟹ ③ = ${fillPhases().join(' → ')}`);

  const A = freshRepo('a');
  const B = freshRepo('b');
  // C：反向对照 —— ② 那一版里 NAV_SLUG 换成骨架页（不经 §pageSkeleton，所以不发 degraded）。改的是这一跑仓里那份 create-site.js。
  const HOOK = "onPhaseDone('pages', previewContent(ai.pages));";
  let mutated = 0;
  const C = freshRepo('c', (work) => {
    const f = path.join(work, 'scripts', 'create-site.js');
    const s = fs.readFileSync(f, 'utf8');
    mutated = s.split(HOOK).length - 1;
    fs.writeFileSync(f, s.replace(HOOK, `onPhaseDone('pages', previewContent(ai.pages.map((p) => (p.slug === '${NAV_SLUG}' ? skeletonPage(p) : p))));`));
  });
  const D = freshRepo('d');
  const E = freshRepo('e');
  // F：#1668 并行那次预览构建故意失败 —— 交付树里弄坏一个块组件（create-site 只跑 node 脚本，不编它）
  const BROKEN = path.join('blocks', 'hero', 'Section.tsx');
  const F = freshRepo('f', (work) => fs.appendFileSync(path.join(work, BROKEN), '\nexport const broken = (;\n'));
  const t0 = Date.now();
  const [RA, RB, RC, RD, RE, RF] = await Promise.all([
    stagedRun('a', A, PAYLOAD({ secondaryLocales: ['en'], geminiApiKey: 'stub-key' }), { cfg: { images: 'ok', holdAfterPages: true } }),
    stagedRun('b', B, PAYLOAD({ geminiApiKey: 'stub-key' }), { cfg: { holdAfterPages: true } }),
    stagedRun('c', C, PAYLOAD(), { killAfterViewable: true }),
    run('d', D, PAYLOAD(), { staged: false }),
    liveRun('e', E, PAYLOAD({ geminiApiKey: 'stub-key' }), { cfg: { images: 'ok', holdAfterPages: true } }),
    liveRun('f', F, PAYLOAD(), {}),
  ]);
  console.log(`   四跑用时 ${((Date.now() - t0) / 1000).toFixed(0)}s`);

  // #1599 r4 —— 桩 §gate 的读数：A / B 两跑真的按真 AI 时序走了（② 构建期间 site/ 里还没有页面）。没拦住 = 下面那几格量的又是瞬时桩的竞态。
  const holds = (repo) => fs.readFileSync(path.join(repo.root, 'calls.jsonl'), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)).filter((c) => c.kind === 'hold');
  const heldBeforeSiteWritten = (repo) => () => {
    const h = holds(repo);
    assert.strictEqual(h.length, 1, JSON.stringify(h));
    assert.strictEqual(h[0].done, true, `#2 构建 10 分钟没结束：${JSON.stringify(h[0])}`);
    assert.strictEqual(h[0].siteHome, false, 'pages 之后、#2 构建结束时 site/zh/pages/home.json 已经在了 —— 没量到真时序');
  };

  console.log('── A：图片成功、带第二语言 en');
  const vA = RA.st.atViewable;
  check('真 AI 时序：pages 之后第一次联网等到 ② 那次构建结束才放行，那一刻 site/ 里还没有页面（阳性对照，同 appdev site-fd7e9c78）', heldBeforeSiteWritten(A));
  check('建站成功（rc 0、没有 error 事件）', () => assert.ok(RA.rc === 0 && !RA.error, `rc=${RA.rc} ${RA.error}\n${RA.stderr.slice(-1500)}`));
  check('preview-viewable 恰好一次，在 pages 阶段做完之后（最后一条「Page i/N written」之后）', () => {
    const v = ofType(RA, 'preview-viewable');
    assert.strictEqual(v.length, 1, `${v.length} 次`);
    assert.strictEqual(v[0].phase, VIEWABLE_PHASE);
    const lastPage = RA.events.map((e, i) => (e.event === 'progress' && /^Page \d+\/\d+ written/.test(e.message) ? i : -1)).filter((i) => i >= 0).pop();
    assert.ok(lastPage !== undefined && vA && vA.index > lastPage, `viewable 在第 ${vA && vA.index} 条，最后一页写完在第 ${lastPage} 条`);
  });
  check('AC：viewable 那一刻点得到的页 —— 没有一页 404、没有一页是骨架页（阳性：走到的页 ≥ 顶部导航与页脚里的每一页）', () => {
    assert.ok(vA, '没收到 preview-viewable');
    const c = vA.crawl;
    assert.deepStrictEqual(c.missing, [], `404：${c.missing.join(' · ')}`);
    assert.deepStrictEqual(c.placeholders.filter((s) => !vA.degradedPages.includes(s)), [], `骨架页：${c.placeholders.join(' · ')}`);
    const nav = JSON.parse(fs.readFileSync(path.join(vA.siteDir, 'zh', 'navigation.json'), 'utf8'));
    const navHrefs = [...nav.header.links, ...nav.footer.columns.flatMap((col) => col.links)].map((l) => l.href);
    for (const h of navHrefs) assert.ok(c.visited.includes(h), `导航里的 ${h} 没走到（走到的：${c.visited.join(' ')}）`);
    assert.ok(c.visited.length >= 9, `只走到 ${c.visited.length} 页：${c.visited.join(' ')}`);
  });
  check('对照：同一把尺子量建完的站（最后那版）也是 0 个 404、0 个骨架页，走到的页更多（关键词页这时才在）', () => {
    const lastOut = fs.readlinkSync(path.join(A.work, 'out'));
    const c = crawl(lastOut, path.join(path.dirname(lastOut), 'site'), 'zh');
    assert.deepStrictEqual([c.missing, c.placeholders], [[], []]);
    assert.ok(c.visited.length > vA.crawl.visited.length, `${c.visited.length} vs ${vA.crawl.visited.length}`);
  });
  check('content-changed 的集合 = BUILD_PHASES 里 pages 之后的每个阶段各一次，顺序相同', () => {
    assert.deepStrictEqual(ofType(RA, 'content-changed').map((e) => e.phase), fillPhases());
  });
  check('最后一次之后 out/ 指着最后那次构建，那次构建的输入 = 建完时 site/ 里的站（页面 / brand / services / seo 逐字节）；result.json final', () => {
    assert.ok(RA.result && RA.result.final === true, JSON.stringify(RA.result));
    const lastOut = fs.readlinkSync(path.join(A.work, 'out'));
    const builds = fs.readdirSync(A.builds).filter((d) => /^\d+$/.test(d)).map(Number).sort((a, b) => a - b);
    assert.strictEqual(lastOut, path.join(A.builds, String(builds[builds.length - 1]), 'out'));
    const snap = path.join(path.dirname(lastOut), 'site');
    for (const loc of ['zh', 'en']) {
      const live = pageFiles(path.join(A.work, 'site', loc, 'pages'));
      assert.ok(Object.keys(live).length >= 10, `${loc} 只有 ${Object.keys(live).length} 页`);
      assert.deepStrictEqual(pageFiles(path.join(snap, loc, 'pages')), live, `${loc} 的页面`);
      for (const f of ['services.json', 'seo.json']) assert.strictEqual(fs.readFileSync(path.join(snap, loc, f), 'utf8'), fs.readFileSync(path.join(A.work, 'site', loc, f), 'utf8'), `${loc}/${f}`);
    }
    assert.strictEqual(fs.readFileSync(path.join(snap, 'brand.json'), 'utf8'), fs.readFileSync(path.join(A.work, 'site', 'brand.json'), 'utf8'));
    assert.ok(fs.existsSync(path.join(lastOut, 'en.html')), '最后那版没有 en');
  });
  check('从 viewable 起每次重构建期间轮询首页：一次都不是非 200（阳性：轮询次数 > 0）', () => {
    assert.ok(RA.st.polls > 20, `只轮询了 ${RA.st.polls} 次`);
    assert.deepStrictEqual(RA.st.bad, [], `${RA.st.bad.length}/${RA.st.polls} 次非 200：${[...new Set(RA.st.bad)].join(' ')}`);
  });
  check('① 骨架那一版：第 1 次构建的输入每页都是骨架页、换上去了（viewable 之前 out 已在），没发任何预览事件', () => {
    const snap1 = path.join(A.builds, '1', 'site', 'zh', 'pages');
    const pages = Object.entries(pageFiles(snap1)).map(([f, t]) => [f, JSON.parse(t)]);
    assert.ok(pages.length >= 9, `${pages.length} 页`);
    for (const [f, pg] of pages) if (f !== 'contact.json' || pg.seo) assert.strictEqual(pg.seo && pg.seo.placeholder, true, `${f} 不是骨架页`);
    assert.ok(fs.existsSync(path.join(A.builds, '1', 'out', 'index.html')), '第 1 次构建没产物');
    assert.strictEqual(vA.outDir === path.join(A.builds, '1', 'out'), false, 'viewable 时 out 还指着骨架那一版');
    const firstPreviewEvent = RA.events.findIndex((e) => /^preview-/.test(e.event));
    assert.strictEqual(RA.events[firstPreviewEvent].event, 'preview-viewable');
  });
  check('第二语言：② 那一版只带主语言（快照 locales = [zh]，out 里没有 /en），最后那版带上 en', () => {
    assert.deepStrictEqual(JSON.parse(fs.readFileSync(path.join(vA.siteDir, 'site_meta.json'), 'utf8')).locales, ['zh']);
    assert.ok(!fs.existsSync(path.join(vA.outDir, 'en.html')), '② 那版里有 /en');
    assert.deepStrictEqual(JSON.parse(fs.readFileSync(path.join(A.work, 'site', 'site_meta.json'), 'utf8')).locales, ['zh', 'en']);
  });
  check('图那一次 reload 换上了图：images 那版有页面引用 /photos/，② 那版一页都没有', () => {
    const imgEvent = RA.events.findIndex((e) => e.event === 'content-changed' && e.phase === 'images');
    assert.ok(imgEvent >= 0);
    const builds = fs.readdirSync(A.builds).filter((d) => /^\d+$/.test(d)).map(Number).sort((a, b) => a - b);
    const viewableN = Number(path.basename(path.dirname(vA.outDir)));
    const imagesN = builds.find((n) => n > viewableN);
    // 只看老板点得到的页：`~editor/` 底下那几页是编辑器的图库，列的是 public/photos/ 此刻有哪些文件 —— 图阶段在 ② 构建的同时往那里写图，
    // 所以 ② 那版的图库里可能已经有几张（实测 7 页）。那不是页面上的图，编辑器在建站完成之前也打不开。
    const withPhotos = (dir) => Object.entries(pageFiles(dir)).filter(([f, t]) => f.endsWith('.html') && !f.startsWith('~editor') && /\/photos\//.test(t)).map(([f]) => f);
    assert.deepStrictEqual(withPhotos(vA.outDir), [], '② 那版已经有图');
    assert.ok(withPhotos(path.join(A.builds, String(imagesN), 'out')).length >= 7, `images 那版引用 /photos/ 的页：${withPhotos(path.join(A.builds, String(imagesN), 'out')).join(' ')}`);
  });
  check('预览的文件没进阶段提交：images 那个提交里还没有 site/brand.json（#1598 的不变量），keywordPages 那个提交里有', () => {
    const subjects = git(A.bare, ['log', '--format=%H %s']).split('\n');
    const sha = (ph) => (subjects.find((l) => l.includes(`(phase: ${ph} `)) || '').slice(0, 40);
    assert.throws(() => git(A.bare, ['cat-file', '-e', `${sha('images')}:site/brand.json`]));
    git(A.bare, ['cat-file', '-e', `${sha('keywordPages')}:site/brand.json`]);
  });

  check('#1668 第 7 条：老路每一阶段的那次 next build 都打了一行「Running next build (legacy, stage …)」（行数 = 构建目录数，阳性 ≥ 3）', () => {
    const dirs = fs.readdirSync(A.builds).filter((d) => /^\d+$/.test(d)).length;
    const lines = (RA.stderr.match(/^Running next build \(legacy, stage [a-zA-Z]+\)/gm) || []).length;
    assert.ok(dirs >= 3, `${dirs} 个构建目录`);
    assert.strictEqual(lines, dirs, `${lines} 行 vs ${dirs} 次构建`);
  });

  // #1613 —— entrypoint.sh 在 create-site 退出后用 `git status --porcelain --untracked-files=all -- site public` 判「这次建站有没有
  // 没提交的东西」，非空就记 archived:false + warn unarchived。分段预览那几次构建是在 create-site 运行期间跑的（sync-config 往
  // public/ 写生成文件、快照在仓外），这里量它们没在 site/ public/ 留下 git 看得见的东西 —— 否则每个分段建站都会被判成没存进仓。
  check('create-site 退出后 site/ public/ 没有 git 看得见的未提交文件（#1613 entrypoint §unsaved_build_files 同一条命令）', () => {
    const unsaved = git(A.work, ['status', '--porcelain', '--untracked-files=all', '--', 'site', 'public']);
    assert.strictEqual(unsaved, '', `未提交：\n${unsaved}`);
  });

  console.log('── B：图阶段失败（生图全部离线）');
  check('真 AI 时序（单语言站）：同 A，② 构建期间 site/ 里还没有页面', heldBeforeSiteWritten(B));
  check('照常建完：rc 0、三次 content-changed 都发、result.json final（⟹ entrypoint 直接发 preview-started）', () => {
    assert.ok(RB.rc === 0 && !RB.error, `rc=${RB.rc} ${RB.error}\n${RB.stderr.slice(-1500)}`);
    assert.strictEqual(ofType(RB, 'preview-viewable').length, 1);
    assert.deepStrictEqual(ofType(RB, 'content-changed').map((e) => e.phase), fillPhases());
    assert.ok(RB.result && RB.result.final === true, JSON.stringify(RB.result));
  });
  check('关键词页照常补齐：最后那版 out/ 里两张关键词页都在', () => {
    const lastOut = fs.readlinkSync(path.join(B.work, 'out'));
    const kw = fs.readdirSync(path.join(B.work, 'site', 'zh', 'pages', 'services', 'cut')).map((f) => f.replace(/\.json$/, ''));
    assert.strictEqual(kw.length, 2, kw.join(' '));
    for (const s of kw) assert.ok(fs.existsSync(path.join(lastOut, 'services', 'cut', `${s}.html`)), `out 里没有 services/cut/${s}.html`);
  });
  check('报告里图那一行：generated 0 < requested（阳性：requested > 0）', () => {
    const rep = JSON.parse(fs.readFileSync(path.join(B.work, 'site', 'build-report.json'), 'utf8'));
    assert.ok(rep.images && rep.images.requested > 0, JSON.stringify(rep.images));
    assert.strictEqual(rep.images.generated, 0, JSON.stringify(rep.images));
  });
  check('对照：A 那一跑的图真的生成了（generated > 0）—— 两跑的差别就在图阶段', () => {
    const rep = JSON.parse(fs.readFileSync(path.join(A.work, 'site', 'build-report.json'), 'utf8'));
    assert.ok(rep.images && rep.images.generated > 0, JSON.stringify(rep.images));
  });

  console.log('── C：反向对照（② 那版里一个导航页是骨架页、没有 degraded 记录）');
  check(`改动真的落进了这一跑的 create-site.js（命中 ${mutated} 处）`, () => assert.strictEqual(mutated, 1));
  check('A 那把尺子在这一版上读红：骨架页里有这个导航页、而 degraded 记录里没有它', () => {
    const v = RC.st.atViewable;
    assert.ok(v, `没收到 preview-viewable（rc=${RC.rc} ${RC.error}）\n${RC.stderr.slice(-1500)}`);
    assert.ok(v.crawl.visited.includes(`/${NAV_SLUG}`), `走不到 /${NAV_SLUG}`);
    assert.deepStrictEqual(v.crawl.placeholders.filter((s) => !v.degradedPages.includes(s)), [NAV_SLUG]);
  });

  console.log('── D：没打开（不给 STAGED_PREVIEW_DIR）');
  check('照常建完，不发任何预览事件、不建 out、不写 result.json', () => {
    assert.ok(RD.rc === 0 && !RD.error, `rc=${RD.rc} ${RD.error}`);
    assert.deepStrictEqual(RD.events.filter((e) => /^preview-/.test(e.event)), []);
    assert.ok(!fs.existsSync(path.join(D.work, 'out')));
    assert.ok(!fs.existsSync(D.builds));
  });

  console.log('── E：#1668 换链接模式（真预览构建 + 真 next start，图片成功）');
  const LE = RE.L;
  check('建站成功（rc 0、没有 error 事件），并行那次预览构建成功', () => {
    assert.ok(RE.rc === 0 && !RE.error, `rc=${RE.rc} ${RE.error}\n${RE.stderr.slice(-1500)}`);
    assert.strictEqual(LE.code, 0, LE.buildLog.slice(-2000));
  });
  check('真 AI 时序（同 A）：pages 之后第一次联网等到 ② 那一阶段换上之后才放行，那一刻 site/ 里还没有页面', heldBeforeSiteWritten(E));
  check('preview-viewable 恰好一次，那一刻链接指着 ② 的快照（不是 site/）', () => {
    const v = ofType(RE, 'preview-viewable');
    assert.strictEqual(v.length, 1, `${v.length} 次`);
    assert.strictEqual(v[0].phase, VIEWABLE_PHASE);
    assert.ok(LE.atViewable && /\/2\/site$/.test(LE.atViewable.target), JSON.stringify(LE.atViewable));
  });
  check('AC「能看了那一刻是真内容」：经 HTTP 走遍点得到的页 —— 全 200、页面里有生意的真名字、没有骨架页（阳性：≥ 9 页）', () => {
    const c = LE.crawlAtViewable;
    assert.ok(c, '没收到 preview-viewable');
    assert.deepStrictEqual(c.bad, [], `非 200：${c.bad.join(' · ')}`);
    assert.ok(c.visited.length >= 9, `只走到 ${c.visited.length} 页：${c.visited.join(' ')}`);
    assert.strictEqual(c.names, c.visited.length, `有 ${c.visited.length - c.names} 页里没有 "Silky Hair Salon"`);
    assert.deepStrictEqual(c.placeholders.filter((x) => !LE.atViewable.degradedPages.includes(x)), [], `骨架页：${c.placeholders.join(' · ')}`);
  });
  check('分段建站自己一次 next build 都不跑：构建目录里没有任何 <k>/out；这一跑「Running next build」只有并行那 1 行', () => {
    const outs = fs.readdirSync(E.builds).filter((d) => /^\d+$/.test(d) && fs.existsSync(path.join(E.builds, d, 'out')));
    assert.deepStrictEqual(outs, []);
    assert.ok(!/\[staged-preview\][^\n]*next build/.test(RE.stderr), 'create-site 的日志里出现了 next build');
    assert.strictEqual(LE.buildLines, 1);
    assert.strictEqual((LE.buildLog.match(/Running next build/g) || []).length, 1);
  });
  check('content-changed 的集合 = pages 之后的每个阶段各一次；result.json final', () => {
    assert.deepStrictEqual(ofType(RE, 'content-changed').map((e) => e.phase), fillPhases());
    assert.ok(RE.result && RE.result.final === true, JSON.stringify(RE.result));
  });
  check('AC「建站时新出现的图」：images 阶段写了 public/photos/* ⟹ 服务重启过（images 那次 reload 时的进程号 ≠ viewable 时的），重启之后才发 reload', () => {
    const photos = fs.readdirSync(path.join(E.work, 'public', 'photos'));
    assert.ok(photos.length >= 1, '图阶段没写出图');
    assert.ok(LE.pidAtViewable && LE.pidsAtReload.images, JSON.stringify([LE.pidAtViewable, LE.pidsAtReload]));
    assert.notStrictEqual(LE.pidsAtReload.images, LE.pidAtViewable, `写了新图，服务没重启（create-site 里关于重启的日志：${RE.stderr.split('\n').filter((l) => /重启|restart/i.test(l)).join(' | ')}）`);
    const restarts = fs.readFileSync(path.join(LE.st, 'restarts'), 'utf8').split('\n').filter(Boolean).length;
    assert.ok(restarts >= 1, `${restarts} 次重启`);
  });
  LE.homeAtEnd = await fetchText(LE.port, '/').then((r) => ({ code: r.code, bytes: r.body.length }));
  const photoCodes = await (async () => {
    const pages = (await httpCrawl(LE.port, fs.readlinkSync(LE.link), 'zh')).visited;
    const srcs = new Set();
    for (const p of pages) for (const m of (await fetchText(LE.port, p)).body.matchAll(/\/photos\/[^"' )?&\\]+/g)) srcs.add(m[0]);
    const codes = [];
    for (const s2 of srcs) codes.push(`${s2}=${(await fetchText(LE.port, s2)).code}`);
    return codes;
  })();
  check(`建完之后各页引用的每张 /photos/ 图都答 200（不是 [...slug] 那一页的 500）—— 阳性：至少一张：${photoCodes.join(' ') || '（无）'}`, () => {
    assert.ok(photoCodes.length >= 1, `没有一页引用 /photos/（服务答首页：${JSON.stringify(LE.homeAtEnd)}）`);
    assert.deepStrictEqual(photoCodes.filter((c) => !c.endsWith('=200')), []);
  });
  check('被链接指着的快照还在（新路不许构建完就删快照）', () => {
    const target = fs.readlinkSync(LE.link);
    assert.ok(fs.existsSync(path.join(target, 'brand.json')), target);
  });
  check('对照：只改 public/ 里已有文件的内容，不重启（进程号不变）', () => {
    const before = LE.pid();
    const f = path.join(E.work, 'public', 'photos', fs.readdirSync(path.join(E.work, 'public', 'photos'))[0]);
    fs.appendFileSync(f, 'x');
    cp.execSync(`SP_LIVE_STATE=${LE.st} SP_LIVE_START=${path.join(E.root, 'start.js')} node ${path.join(E.root, 'restart.js')}`, { cwd: E.work });
    assert.strictEqual(LE.pid(), before);
  });
  killServer(RE);

  console.log('── F：#1668 并行那次预览构建失败（弄坏一个块组件）');
  check('构建确实失败了（阳性：替身写了 failed）', () => assert.notStrictEqual(RF.L.code, 0));
  check('建站照常完成（rc 0）—— 编译失败不打断内容生成', () => assert.ok(RF.rc === 0 && !RF.error, `rc=${RF.rc} ${RF.error}\n${RF.stderr.slice(-1500)}`));
  check('不发 preview-viewable、不发 content-changed（那一刻确实没东西可看）', () => {
    assert.deepStrictEqual(RF.events.filter((e) => /^preview-|^content-changed$/.test(e.event)).map((e) => e.event), []);
    assert.ok(/并行那次预览构建失败/.test(RF.stderr), '日志里没有那一行原因');
  });
  killServer(RF);

  console.log(`\n══ 汇总: 通过 ${pass} · 失败 ${fail} ══`);
  process.exit(fail ? 1 : 0);
})().catch((e) => die(e.stack || e.message));
