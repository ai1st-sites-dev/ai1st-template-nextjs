#!/usr/bin/env node
/**
 * editor-nav.test.js — #1759 立；#1781 起菜单是老板自己的一份列表（`navigation.json` 的 `header.links`），构建只做合并。
 *
 *   node scripts/editor-nav.test.js     （由 `npm run test:scripts` 自动发现）
 *   退出码: 0 全过 · 1 有失败 · 2 跑不起来（**不许当成通过**）
 *
 * 管四个文件：`lib/nav-menu.js`（§syncMenu：构建对菜单做的全部事情）· `lib/nav-editor.js`（浏览器那一侧：能不能存、拖动、画布预览）·
 * `lib/editor-nav.js`（能进菜单的页 + 写别的页的 navLabel / navOrder —— 编辑器 #1781 起不再调它，写盘那一格 `nav` 还在，照旧量）·
 * `write-editor-save.js`（容器里那一步，跟页面 / 外壳一起先全判、再全写）。
 *
 * 夹具：仓里那条 skipAI 建站路造一个真站（同 editor-root.test.js），再补三页：一张普通页、一张关键词页、一张服务详情页
 * —— 后两种按构建的判据不是普通页（不进 knownPages、不会被自动加进菜单）。
 *
 *   ① 能进菜单的页（§navMenuOf）
 *   ② #1781 构建对菜单做的事（真跑 sync-config）：第一次构建不改建站时那份菜单、记下 knownPages · 新页追加到末尾（名字 navLabel → title）·
 *      老板删掉的不回来 · 页面删了菜单里那一项跟着去掉 · 老板的改动构建后还在 · 页脚第一列 = 菜单。反向：「不在菜单里的页都加回来」那种
 *      朴素规则跟构建对不上（证明这一格量得出差别）
 *   ③ §planNavWrite · ④ write-editor-save.js 的 `nav` 那一格（同 #1759）
 *   ⑤ 浏览器那一侧（`lib/nav-editor.js`）：能不能存的那一句 · 拖动 · 照面板那一份经 write-editor-save 的 root `headerLinks` 真存 →
 *      真跑 sync-config ⟹ 画布预览 == 构建派生（`shell-data.js`）的顶栏 / 页脚菜单；电话引用原样存、原样派生
 */

'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const cp = require('child_process');
const crypto = require('crypto');

const NEXT = path.resolve(__dirname, '..');

let pass = 0; let fail = 0;
const ok = (m) => { pass += 1; console.log(`  ✅ ${m}`); };
const bad = (m) => { fail += 1; console.log(`  ❌ ${m}`); };
const check = (cond, m, detail) => (cond ? ok(m) : bad(detail ? `${m} —— ${detail}` : m));
function die(msg) { console.log(`💥 ${msg}`); process.exit(2); }

const temps = [];
process.on('exit', () => { for (const t of temps) fs.rmSync(t, { recursive: true, force: true }); });

let navMenu; let editorNav; let pageFiles; let pageWrite; let siteShape; let navEditor;
try {
  navMenu = require('./lib/nav-menu.js');
  navEditor = require('./lib/nav-editor.js');
  editorNav = require('./lib/editor-nav.js');
  pageFiles = require('./lib/page-files.js');
  pageWrite = require('./lib/page-write.js');
  siteShape = require('./lib/site-shape.js');
} catch (e) {
  die(`加载不起来：${e.message}`);
}

// ── 夹具 ──────────────────────────────────────────────────────────────────────────────────────
function makeTemplate() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'editor-nav-'));
  temps.push(root);
  const work = path.join(root, 'nextjs');
  cp.execSync(`cp -a --no-dereference "${NEXT}" "${work}"`, { stdio: 'pipe' });
  for (const junk of ['out', '.next', '.out-backup', '.out-temp', 'site', 'node_modules']) {
    fs.rmSync(path.join(work, junk), { recursive: true, force: true });
  }
  fs.symlinkSync(path.join(NEXT, 'node_modules'), path.join(work, 'node_modules'));
  const r = cp.spawnSync(process.execPath, [path.join(work, 'scripts', 'create-site.js')], {
    input: JSON.stringify({ siteId: 'navtest1', siteUrl: 'https://navtest1.example.com', companyName: 'Maple Plumbing', industry: 'plumbing', location: 'Toronto', skipAI: true }),
    cwd: work, encoding: 'utf8', env: { ...process.env, ANTHROPIC_API_KEY: undefined }, timeout: 180000,
  });
  const pages = path.join(work, 'site', 'en', 'pages');
  if (!fs.existsSync(path.join(pages, 'home.json'))) die(`夹具立不起来（rc=${r.status}）\n${(r.stderr || '').slice(-600)}`);
  // 补三页：一张普通页（第 3 个能进菜单的页）、一张关键词页、一张服务详情页（后两种不进菜单，判据同 derive-site.js）。
  const about = JSON.parse(fs.readFileSync(path.join(pages, 'about.json'), 'utf-8'));
  const page = (slug, extra) => ({ ...about, slug, ...extra });
  fs.writeFileSync(path.join(pages, 'pricing.json'), `${JSON.stringify(page('pricing', { title: 'Our Prices', navLabel: 'Pricing', navOrder: 3 }), null, 2)}\n`);
  fs.writeFileSync(path.join(pages, 'emergency-plumber.json'), `${JSON.stringify(page('emergency-plumber', { title: 'Emergency plumber', navLabel: 'Emergency', navOrder: 5, keywordPage: true }), null, 2)}\n`);
  fs.mkdirSync(path.join(pages, 'services'), { recursive: true });
  fs.writeFileSync(path.join(pages, 'services', 'drains.json'), `${JSON.stringify(page('services/drains', { title: 'Drain cleaning', navLabel: 'Drains', navOrder: 6 }), null, 2)}\n`);
  return work;
}
const TEMPLATE = makeTemplate();
const SITE = path.join(TEMPLATE, 'site');
const PAGES = path.join(SITE, 'en', 'pages');
const PRISTINE = path.join(path.dirname(TEMPLATE), 'site.pristine');
cp.execSync(`cp -a "${SITE}" "${PRISTINE}"`);
function freshSite() {
  fs.rmSync(SITE, { recursive: true, force: true });
  cp.execSync(`cp -a "${PRISTINE}" "${SITE}"`);
}
function snapshot(dir) {
  const out = {};
  (function walk(d) {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) walk(p); else out[path.relative(dir, p)] = fs.readFileSync(p, 'utf-8');
    }
  }(dir));
  return out;
}
const changedFiles = (a, b) => [...new Set([...Object.keys(a), ...Object.keys(b)])].filter((k) => a[k] !== b[k]).sort();
const readPage = (slug) => JSON.parse(fs.readFileSync(path.join(PAGES, `${slug}.json`), 'utf-8'));
const writePage = (slug, mutate) => { const p = readPage(slug); mutate(p); fs.writeFileSync(path.join(PAGES, `${slug}.json`), `${JSON.stringify(p, null, 2)}\n`); };
const menuFromDisk = () => editorNav.readNavMenu(pageFiles, path.join(SITE, 'en'));
const target = () => pageWrite.resolveTarget(TEMPLATE, siteShape, 'en');
function tryNav(slug, nav) {
  try {
    const writes = editorNav.planNavWrite({ pageFiles, target: target(), slug, nav });
    for (const w of writes) fs.writeFileSync(w.file, w.content);
    return { files: writes.map((w) => path.relative(SITE, w.file)) };
  } catch (e) { return { code: e.code, message: e.message }; }
}
function runScript(loc, input) {
  const r = cp.spawnSync(process.execPath, [path.join(TEMPLATE, 'scripts', 'write-editor-save.js'), JSON.stringify(loc)], {
    cwd: TEMPLATE, input: JSON.stringify(input), encoding: 'utf8', timeout: 60000,
  });
  let last = null;
  try { last = JSON.parse((r.stdout || '').trim().split('\n').pop()); } catch { last = null; }
  return { status: r.status, stdout: r.stdout, stderr: r.stderr, last };
}

// ══ ① 能进菜单的页 ═══════════════════════════════════════════════════════════════════════════════
console.log('① 能进菜单的页（navMenuOf）');
{
  freshSite();
  writePage('services', (p) => { delete p.navLabel; }); // 一张隐藏着的普通页
  const m = menuFromDisk();
  console.log(`    ${JSON.stringify(m)}`);
  check(m.home && m.home.navLabel === 'Home' && m.home.title === 'Home', '首页单独给（名字、标题分开）', JSON.stringify(m.home));
  check(JSON.stringify(m.pages.map((p) => p.slug)) === JSON.stringify(['about', 'services', 'pricing', 'contact']),
    '普通页按 navOrder（about 1 · services 2 · pricing 3 · contact 4）；关键词页、服务详情页、首页不在', JSON.stringify(m.pages.map((p) => p.slug)));
  const services = m.pages.find((p) => p.slug === 'services');
  check(services && services.navLabel === '' && services.title === 'Our Services' && services.navOrder === 2, '隐藏着的那一页在：navLabel 空串、标题和 navOrder 照给', JSON.stringify(services));
  const noOrder = editorNav.navMenuOf([{ slug: 'home' }, { slug: 'b', title: 'B', navLabel: 'B' }, { slug: 'a', title: 'A', navLabel: 'A', navOrder: 1 }, { slug: 'c', title: 'C' }]);
  check(JSON.stringify(noOrder.pages.map((p) => p.slug)) === JSON.stringify(['a', 'b', 'c']) && !('navOrder' in noOrder.pages[1]),
    '没写 navOrder 的排在后面（同构建的 ?? 99），同分保持原来的顺序；没写就不放这个键', JSON.stringify(noOrder.pages));
}

// ══ ② #1781 构建对菜单做的事（nav-menu.js §syncMenu，真跑 sync-config）═══════════════════════════════════════
console.log('② 构建对菜单做的事（syncMenu vs 真 sync-config）');
{
  const NAVF = path.join(SITE, 'en', 'navigation.json');
  const sync = () => {
    const r = cp.spawnSync(process.execPath, [path.join(TEMPLATE, 'scripts', 'sync-config.js')], { cwd: TEMPLATE, encoding: 'utf8', timeout: 240000 });
    if (r.status !== 0) bad(`sync-config 跑不起来（rc=${r.status}）${(r.stderr || '').slice(-300)}`);
    return JSON.parse(fs.readFileSync(NAVF, 'utf-8'));
  };
  const editNav = (mutate) => { const n = JSON.parse(fs.readFileSync(NAVF, 'utf-8')); mutate(n); fs.writeFileSync(NAVF, `${JSON.stringify(n, null, 2)}\n`); };
  const hrefs = (n) => n.header.links.map((l) => l.href);
  const footerIsMenu = (n) => JSON.stringify(n.footer.columns[0].links) === JSON.stringify(n.header.links);

  freshSite();
  const created = JSON.parse(fs.readFileSync(NAVF, 'utf-8'));
  check(!('knownPages' in created.header), '（前提）建站写的 navigation.json 里还没有 knownPages', JSON.stringify(Object.keys(created.header)));
  let n = sync();
  check(JSON.stringify(n.header.links) === JSON.stringify(created.header.links), '第一次构建：菜单 = 建站时那一份（不重算、不追加）', `${JSON.stringify(created.header.links)} → ${JSON.stringify(n.header.links)}`);
  check(JSON.stringify(n.header.knownPages) === JSON.stringify(['about', 'services', 'pricing', 'contact']), '第一次构建：knownPages = 这时的普通页（关键词页 / 服务详情页 / 首页不在）', JSON.stringify(n.header.knownPages));
  check(footerIsMenu(n), '页脚第一列 = 菜单', JSON.stringify(n.footer.columns[0].links));
  const n1 = n;
  n = sync();
  check(JSON.stringify(n) === JSON.stringify(n1), '再构建一次 ⟹ navigation.json 一个字都不变（合并是稳定的）');

  // 验收 4：新的普通页 ⟹ 末尾出现、knownPages 记下；从菜单删了再构建 ⟹ 不回来；删掉那一页再构建 ⟹ 菜单和 knownPages 里都没有它。
  fs.writeFileSync(path.join(PAGES, 'faq.json'), `${JSON.stringify({ ...readPage('about'), slug: 'faq', title: 'Questions', navLabel: 'FAQ', navOrder: 9 }, null, 2)}\n`);
  n = sync();
  check(JSON.stringify(n.header.links[n.header.links.length - 1]) === JSON.stringify({ label: 'FAQ', href: '/faq' }) && n.header.knownPages.includes('faq'),
    '加一页 faq（navLabel FAQ）⟹ 菜单末尾出现 FAQ、knownPages 含 faq', JSON.stringify(n.header));
  check(footerIsMenu(n), '页脚第一列跟着有 FAQ');
  editNav((x) => { x.header.links = x.header.links.filter((l) => l.href !== '/faq'); });
  n = sync();
  check(!hrefs(n).includes('/faq') && n.header.knownPages.includes('faq'), '把 FAQ 从菜单删了再构建 ⟹ 不回来（faq 还在 knownPages 里）', JSON.stringify(n.header));
  // 朴素规则（「普通页里不在菜单里的都加回来」）在这一刻会把 FAQ 加回来 ⟹ 跟构建对不上：这一格量得出 knownPages 的作用。
  const naive = [...n.header.links, ...['about', 'services', 'pricing', 'contact', 'faq'].filter((sl) => !hrefs(n).includes(`/${sl}`)).map((sl) => ({ href: `/${sl}` }))];
  check(naive.length !== n.header.links.length, '反向：朴素规则会把删掉的项加回来 ⟹ 跟构建对不上', JSON.stringify(naive.map((l) => l.href)));
  fs.rmSync(path.join(PAGES, 'faq.json'));
  n = sync();
  check(!hrefs(n).includes('/faq') && !n.header.knownPages.includes('faq'), '删掉 faq.json 再构建 ⟹ 菜单和 knownPages 里都没有它', JSON.stringify(n.header));

  // 页面删了、菜单里还有指向它的那一项 ⟹ 一起去掉；没有 navLabel 的新页 ⟹ 名字取标题。
  fs.writeFileSync(path.join(PAGES, 'faq.json'), `${JSON.stringify({ ...readPage('about'), slug: 'faq', title: 'Questions', navLabel: 'FAQ', navOrder: 9 }, null, 2)}\n`);
  n = sync();
  fs.rmSync(path.join(PAGES, 'faq.json'));
  writePage('pricing', (p) => { delete p.navLabel; });
  fs.writeFileSync(path.join(PAGES, 'team.json'), `${JSON.stringify({ ...readPage('about'), slug: 'team', title: 'Our Team', navLabel: undefined, navOrder: 10 }, null, 2)}\n`);
  n = sync();
  check(!hrefs(n).includes('/faq'), '菜单里有 FAQ、再删掉 faq.json ⟹ 那一项一起去掉', JSON.stringify(hrefs(n)));
  check(JSON.stringify(n.header.links[n.header.links.length - 1]) === JSON.stringify({ label: 'Our Team', href: '/team' }), '没写 navLabel 的新页 ⟹ 名字取标题', JSON.stringify(n.header.links));

  // 验收 3：老板的改动（About 改指 Contact、改名 Reach us；删 Services）构建后还在，Services 不回来。
  editNav((x) => {
    x.header.links = x.header.links.filter((l) => l.href !== '/services')
      .map((l) => (l.href === '/about' ? { label: 'Reach us', href: '/contact' } : l));
  });
  n = sync();
  check(n.header.links.some((l) => l.label === 'Reach us' && l.href === '/contact') && !hrefs(n).includes('/services') && !hrefs(n).includes('/about'),
    '验收 3：About 改成 Reach us → /contact、删掉 Services ⟹ 构建后照旧、Services 不回来', JSON.stringify(n.header.links));
  check(footerIsMenu(n), '页脚第一列仍 = 菜单');

  // #1781 r5（QA3 r4 T2）：菜单里已经有一项指着某页（老板先手填了 /faq），之后才建出那一页 ⟹ 只记进 knownPages，不再追加第二条。
  editNav((x) => { x.header.links.push({ label: 'Questions?', href: '/faq' }); });
  fs.writeFileSync(path.join(PAGES, 'faq.json'), `${JSON.stringify({ ...readPage('about'), slug: 'faq', title: 'Questions', navLabel: 'FAQ', navOrder: 9 }, null, 2)}\n`);
  n = sync();
  check(hrefs(n).filter((h) => h === '/faq').length === 1 && n.header.links.some((l) => l.label === 'Questions?') && n.header.knownPages.includes('faq'),
    'T2：菜单已有 /faq、再建 faq 页 ⟹ 只有一条（老板起的名字留着）、knownPages 记下 faq', JSON.stringify(n.header));
  check(footerIsMenu(n), '页脚第一列也只有一条 /faq');
}

// ══ ③ planNavWrite ═══════════════════════════════════════════════════════════════════════════════
console.log('③ planNavWrite');
{
  freshSite();
  let before = snapshot(SITE);
  const aboutBytes = fs.readFileSync(path.join(PAGES, 'about.json'), 'utf-8');
  let r = tryNav('home', { about: { navLabel: '  Who we are ' }, services: { navLabel: null }, pricing: { navOrder: 2 } });
  check(!r.code && JSON.stringify(r.files.sort()) === JSON.stringify(['en/pages/about.json', 'en/pages/pricing.json', 'en/pages/services.json']), '只写点名的三页', JSON.stringify(r));
  check(readPage('about').navLabel === 'Who we are' && !('navLabel' in readPage('services')) && readPage('pricing').navOrder === 2, '改名（去首尾空格）· 隐藏 = 删掉 navLabel · 改 navOrder');
  const rest = (p) => { const c = { ...p }; delete c.navLabel; delete c.navOrder; return JSON.stringify(c); };
  check(rest(readPage('about')) === rest(JSON.parse(aboutBytes)), '那一页别的键一个字节不动');
  check(JSON.stringify(changedFiles(before, snapshot(SITE))) === JSON.stringify(['en/pages/about.json', 'en/pages/pricing.json', 'en/pages/services.json']), '整个站只变了那三份');
  r = tryNav('home', { services: { navLabel: 'Our Services' } });
  check(!r.code && readPage('services').navLabel === 'Our Services', '显示回来 = navLabel 写回（编辑器传的是那一页的标题）');

  before = snapshot(SITE);
  const refused = [
    ['正在编辑的这一页', 'about', { about: { navLabel: 'X' } }, 5],
    ['不能进菜单的页（关键词页）', 'home', { 'emergency-plumber': { navLabel: 'X' } }, 5],
    ['不能进菜单的页（服务详情页）', 'home', { 'services/drains': { navLabel: 'X' } }, 5],
    ['没有这一页', 'home', { nope: { navLabel: 'X' } }, 5],
    ['隐藏首页', 'about', { home: { navLabel: null } }, 11],
    ['名字清空', 'home', { about: { navLabel: '   ' } }, 11],
    ['名字太长', 'home', { about: { navLabel: 'x'.repeat(editorNav.NAV_LABEL_MAX + 1) } }, 11],
    ['不认识的键', 'home', { about: { title: 'X' } }, 5],
    ['navOrder 不是整数', 'home', { about: { navOrder: 1.5 } }, 5],
    ['nav 不是对象', 'home', ['about'], 5],
  ];
  for (const [name, slug, nav, code] of refused) {
    const x = tryNav(slug, nav);
    check(x.code === code, `${name} ⟹ ${code}`, JSON.stringify(x));
  }
  check(changedFiles(before, snapshot(SITE)).length === 0, '上面几种一个字节都没写');
  const ok11 = tryNav('home', { about: { navLabel: 'x'.repeat(editorNav.NAV_LABEL_MAX) } });
  check(!ok11.code, `（对照）名字正好 ${editorNav.NAV_LABEL_MAX} 个字 ⟹ 收`, JSON.stringify(ok11));
}

// ══ ④ write-editor-save.js：nav 跟页面 / 外壳一起，要么全写要么全不写 ═══════════════════════════════
console.log('④ write-editor-save.js（容器里那一步）');
{
  freshSite();
  const homeFile = path.join(PAGES, 'home.json');
  const homeBytes = fs.readFileSync(homeFile);
  const hash = crypto.createHash('sha256').update(homeBytes).digest('hex');
  const home = JSON.parse(homeBytes.toString('utf-8'));
  const nextHome = { ...home, navLabel: 'Start' };
  let before = snapshot(SITE);
  let s = runScript({ page: 'home', locale: 'en', baseHash: hash }, {
    page: nextHome,
    root: { headerButtons: [{ label: 'Book now', href: '/pricing' }] },
    nav: { about: { navOrder: 4 }, contact: { navOrder: 1 }, pricing: { navLabel: 'Prices' } },
  });
  check(s.status === 0 && s.last && s.last.ok, '页面 + 外壳 + 菜单一起存 ⟹ 成功', `${s.status} ${s.stdout} ${s.stderr}`);
  check(s.last && JSON.stringify([...s.last.files].sort()) === JSON.stringify(['site/en/navigation.json', 'site/en/pages/about.json', 'site/en/pages/contact.json', 'site/en/pages/home.json', 'site/en/pages/pricing.json']),
    'files 列的就是这五份（worker 拿它 git add）', JSON.stringify(s.last && s.last.files));
  check(s.last && /^[0-9a-f]{64}$/.test(s.last.hash || ''), '写了页面 ⟹ 回新的 hash（编辑器拿它当下一次的 baseHash）');
  check(JSON.stringify(changedFiles(before, snapshot(SITE))) === JSON.stringify(['en/navigation.json', 'en/pages/about.json', 'en/pages/contact.json', 'en/pages/home.json', 'en/pages/pricing.json']), '盘上变的也就是这五份');

  // 只改菜单（别的页）：不带页面、不带 baseHash 也能存；不回 hash（这一页没动）。
  before = snapshot(SITE);
  s = runScript({ page: 'home', locale: 'en' }, { nav: { about: { navLabel: 'About us' } } });
  check(s.status === 0 && s.last && s.last.ok && !('hash' in s.last) && JSON.stringify(s.last.files) === JSON.stringify(['site/en/pages/about.json']), '只改别的页的菜单 ⟹ 只写那一页、不回 hash', `${s.status} ${s.stdout}`);

  // nav 点名正在编辑的这一页 ⟹ 5，一个字节都不写。
  before = snapshot(SITE);
  s = runScript({ page: 'about', locale: 'en' }, { nav: { about: { navLabel: 'X' } } });
  check(s.status === 5 && changedFiles(before, snapshot(SITE)).length === 0, 'nav 点名正在编辑的这一页 ⟹ exit 5、什么都没写', `${s.status} ${s.stderr}`);

  // 隐藏首页 ⟹ 11 + 一句给老板的话。
  s = runScript({ page: 'about', locale: 'en' }, { nav: { home: { navLabel: null } } });
  check(s.status === 11 && s.last && s.last.ok === false && /home page/.test(s.last.message) && changedFiles(before, snapshot(SITE)).length === 0, '隐藏首页 ⟹ exit 11、stdout 那一行带原话', `${s.status} ${s.stdout}`);

  // 验收 10：一笔写多个文件，其中一页的文件坏了 ⟹ 一个文件都不变（页面、外壳、别的页都不写）。
  freshSite();
  fs.writeFileSync(path.join(PAGES, 'pricing.json'), '{ "slug": "pricing", broken');
  const homeBytes2 = fs.readFileSync(homeFile);
  before = snapshot(SITE);
  s = runScript({ page: 'home', locale: 'en', baseHash: crypto.createHash('sha256').update(homeBytes2).digest('hex') }, {
    page: { ...JSON.parse(homeBytes2.toString('utf-8')), navLabel: 'Start' },
    root: { headerButtons: [{ label: 'Book now', href: '/about' }], logoUrl: '/images/new-logo.png' },
    nav: { about: { navLabel: 'About us' }, pricing: { navLabel: 'Prices' } },
  });
  check(s.status !== 0 && changedFiles(before, snapshot(SITE)).length === 0, '验收 10：一页的文件坏了 ⟹ 失败、整个站一个字节都没变（首页 / navigation.json / brand.json / about 都没写）',
    `${s.status} ${JSON.stringify(changedFiles(before, snapshot(SITE)))} ${s.stderr}`);
  // 对照：把那一页修好、同一笔原样再发 ⟹ 五份都写了（证明上面那格红在「那一页坏了」，不是这一笔本来就存不进）。
  //   🔴 不是「同一笔去掉坏的那一页」：一份坏掉的页面文件让这种语言整份读不出来（page-files.js §readPagesRecursive），
  //      不点名它也一样存不进 —— 那也是「一个字节都不写」，方向对，但当不了对照。
  fs.copyFileSync(path.join(PRISTINE, 'en', 'pages', 'pricing.json'), path.join(PAGES, 'pricing.json'));
  const fixed = snapshot(SITE);
  s = runScript({ page: 'home', locale: 'en', baseHash: crypto.createHash('sha256').update(homeBytes2).digest('hex') }, {
    page: { ...JSON.parse(homeBytes2.toString('utf-8')), navLabel: 'Start' },
    root: { headerButtons: [{ label: 'Book now', href: '/about' }], logoUrl: '/images/new-logo.png' },
    nav: { about: { navLabel: 'About us' }, pricing: { navLabel: 'Prices' } },
  });
  check(s.status === 0 && JSON.stringify(changedFiles(fixed, snapshot(SITE))) === JSON.stringify(['brand.json', 'en/navigation.json', 'en/pages/about.json', 'en/pages/home.json', 'en/pages/pricing.json']),
    '（对照）那一页修好、同一笔再发 ⟹ 五份都写了', `${s.status} ${JSON.stringify(changedFiles(fixed, snapshot(SITE)))} ${s.stderr}`);
}

// ══ ⑤ 浏览器那一侧（nav-editor.js）：能不能存 · 拖动 · 照面板那一份真存 → 真构建 == 画布预览 ═══════════════════════════
console.log('⑤ nav-editor（能不能存 · 拖动 · 预览 == 构建）');
{
  const { shellDataFor } = require('./lib/shell-data.js');
  check(navEditor.menuItemProblem({ label: 'About', href: '/about' }) === '', '有名字有链接 ⟹ 能存');
  check(/needs a name/.test(navEditor.menuItemProblem({ label: '  ', href: '/about' })), '名字空 ⟹ Done 时那一句');
  check(/up to 40/.test(navEditor.menuItemProblem({ label: 'x'.repeat(41), href: '/about' })), '名字超过 40 个字 ⟹ 那一句');
  check(/needs somewhere to go/.test(navEditor.menuItemProblem({ label: 'About', href: ' ' })), '没链接 ⟹ 那一句');
  check(navEditor.menuItemProblem({ label: 'Call', href: { source: 'phone' } }) === '' && /needs somewhere/.test(navEditor.menuItemProblem({ label: 'X', href: { source: 'address' } })),
    '电话引用算有链接；不认识的 source 不算');
  const list = [{ label: 'A', href: '/a' }, { label: 'B', href: '/b' }, { label: 'C', href: '/c' }];
  check(JSON.stringify(navEditor.moveItem(list, 2, 0).map((l) => l.label)) === JSON.stringify(['C', 'A', 'B']) && list[0].label === 'A', '拖：C 拖到第一位，入参不变');
  check(navEditor.moveItem(list, 0, 9) === list, '下标越界 ⟹ 原样');

  freshSite();
  cp.spawnSync(process.execPath, [path.join(TEMPLATE, 'scripts', 'sync-config.js')], { cwd: TEMPLATE, encoding: 'utf8', timeout: 240000 });
  // 面板那一份：加一项外部链接、一项拨本店电话，About 改名，拖一下。
  const panel = navEditor.moveItem([
    { label: 'Home', href: '/' }, { label: 'Who we are', href: '/about' }, { label: 'Services', href: '/services' },
    { label: 'Order online', href: 'https://example.com' }, { label: 'Call us', href: { source: 'phone' } },
  ], 3, 1);
  const s = runScript({ page: 'home', locale: 'en' }, { root: { headerLinks: panel } });
  check(s.status === 0 && s.last && JSON.stringify(s.last.files) === JSON.stringify(['site/en/navigation.json']), '照面板那一份经 root.headerLinks 真存 ⟹ 只写 en/navigation.json', `${s.status} ${s.stdout} ${s.stderr}`);
  const r = cp.spawnSync(process.execPath, [path.join(TEMPLATE, 'scripts', 'sync-config.js')], { cwd: TEMPLATE, encoding: 'utf8', timeout: 240000 });
  const nav = JSON.parse(fs.readFileSync(path.join(SITE, 'en', 'navigation.json'), 'utf-8'));
  check(r.status === 0 && JSON.stringify(nav.header.links) === JSON.stringify(panel), '构建后 header.links = 面板那一份（逐项、电话引用原样）', JSON.stringify(nav.header.links));
  const brand = JSON.parse(fs.readFileSync(path.join(SITE, 'brand.json'), 'utf-8'));
  const built = shellDataFor({ nav, brand, brandName: 'x', services: [], pages: [], locale: 'en', defaultLocale: 'en' });
  const preview = navEditor.liveShellData({ header: {}, footer: {} }, { headerLinks: panel }, 'en', 'en');
  const strip = (items) => items.map(({ editorIndex, ...rest }) => rest); // eslint-disable-line no-unused-vars
  check(JSON.stringify(strip(preview.header.nav)) === JSON.stringify(built.header.nav) && JSON.stringify(preview.footer.nav) === JSON.stringify(built.footer.nav),
    '预览 == 构建派生（顶栏、页脚第一列逐项；电话那一项两边都是同一个引用）', `预览 ${JSON.stringify(preview)} · 构建 ${JSON.stringify({ h: built.header.nav, f: built.footer.nav })}`);
  check(preview.header.nav.every((it, i) => it.editorIndex === i) && !built.header.nav.some((it) => 'editorIndex' in it) && !preview.footer.nav.some((it) => 'editorIndex' in it),
    '预览的顶栏每一项带它在面板里的下标（画布上点它用），构建那份和页脚都不带');

  // 写盘那一侧再判一次（编辑器绕过 Done 发过来的东西）：没名字 / 坏引用 / javascript: 都一个字节不写。
  const before = snapshot(SITE);
  for (const [name, links, code] of [
    ['没名字', [{ label: ' ', href: '/a' }], 11],
    ['不认识的 source', [{ label: 'X', href: { source: 'address' } }], 5],
    ['javascript: 链接', [{ label: 'X', href: 'javascript:alert(1)' }], 11],
  ]) {
    const x = runScript({ page: 'home', locale: 'en' }, { root: { headerLinks: links } });
    check(x.status === code && changedFiles(before, snapshot(SITE)).length === 0, `写盘那一侧：${name} ⟹ exit ${code}、一个字节不写`, `${x.status} ${x.stdout} ${x.stderr}`);
  }
  // 预览不画坏链接（同 shell-data 的白名单）。
  const bad1 = navEditor.liveShellData({ header: {}, footer: {} }, { headerLinks: [{ label: 'X', href: 'javascript:x' }, { label: '', href: '/a' }, { label: 'Ok', href: '/ok' }] }, 'fr', 'en');
  check(JSON.stringify(bad1.header.nav) === JSON.stringify([{ label: 'Ok', href: '/fr/ok', editorIndex: 2 }]), '预览：坏链接、没名字的不画；站内链接按语言加前缀', JSON.stringify(bad1.header.nav));

  // 预览的按钮 / logo：同 shell-data 一个函数（#1787 `header-buttons.js`：名字和链接都非空、过链接白名单、样子按位置）。
  const base = { header: { buttons: [{ label: 'Old', href: '/x', style: 'solid', at: 0 }], logo: '/old.png', nav: [] }, footer: { logo: '/old.png', nav: [] } };
  const live = navEditor.liveShellData(base, { logoUrl: '/new.png', headerButtons: [{ label: ' Book ', href: '/pricing' }, { label: 'Prices', href: '/pricing' }, { label: 'Call', href: { source: 'phone' } }] }, 'fr', 'en');
  check(live.header.logo === '/new.png' && live.footer.logo === '/new.png' && JSON.stringify(live.header.buttons) === JSON.stringify([
    { label: 'Book', href: '/fr/pricing', style: 'solid', at: 0 }, { label: 'Prices', href: '/fr/pricing', style: 'outline', at: 1 }, { label: 'Call', href: { source: 'phone' }, style: 'link', at: 2 },
  ]), 'logo / 3 颗按钮换上（站内链接按语言加前缀，样子按位置，引用原样）', JSON.stringify(live));
  const live2 = navEditor.liveShellData(base, { logoUrl: '', headerButtons: [{ label: 'Bad', href: 'javascript:x' }, { label: 'Ok', href: '/ok' }] }, 'en', 'en');
  check(!('logo' in live2.header) && JSON.stringify(live2.header.buttons) === JSON.stringify([{ label: 'Ok', href: '/ok', style: 'outline', at: 1 }]),
    'logo 清空 ⟹ 不画；链接不过白名单的那颗 ⟹ 不画，后面那颗样子不变', JSON.stringify(live2));
  const live3 = navEditor.liveShellData(base, { logoUrl: '/x.png' }, 'en', 'en');
  check(JSON.stringify(live3.header.buttons) === JSON.stringify(base.header.buttons), '没带 headerButtons ⟹ 构建那份按钮原样', JSON.stringify(live3.header));
  const live4 = navEditor.liveShellData(base, { headerButtons: [] }, 'en', 'en');
  check(JSON.stringify(live4.header.buttons) === '[]', '带了空列表 ⟹ 0 颗（老板删光了）', JSON.stringify(live4.header));
  // #1784 —— 画布上换了一张新 logo ⟹ 当它自带店名（同存盘那条规矩）；logo 没变 ⟹ 构建那份的 logoHasWordmark 原样；清空 ⟹ 一起去掉。
  check(live.header.logoHasWordmark === true && live.footer.logoHasWordmark === true, '#1784：换了新 logo ⟹ 两个区 logoHasWordmark=true', JSON.stringify(live));
  const same = navEditor.liveShellData(base, { logoUrl: '/old.png' }, 'en', 'en');
  check(!('logoHasWordmark' in same.header) && !('logoHasWordmark' in same.footer), '#1784：logo 没变（AI 图标那张）⟹ 不置真', JSON.stringify(same));
  const kept = navEditor.liveShellData({ header: { ...base.header, logoHasWordmark: true }, footer: { ...base.footer, logoHasWordmark: true } }, { logoUrl: '/old.png' }, 'en', 'en');
  check(kept.header.logoHasWordmark === true, '#1784：logo 没变、构建那份是 true ⟹ 仍是 true');
  // 清空那格要喂一份「构建那份是 true」的底稿 —— 喂 base（本来就没有这个键）时，删不删它都绿。
  const cleared = navEditor.liveShellData({ header: { ...base.header, logoHasWordmark: true }, footer: { ...base.footer, logoHasWordmark: true } }, { logoUrl: '' }, 'en', 'en');
  check(!('logoHasWordmark' in cleared.header) && !('logoHasWordmark' in cleared.footer), '#1784：logo 清空 ⟹ logoHasWordmark 一起去掉', JSON.stringify(cleared));
  // #1781 —— 菜单不跟着按钮变：主按钮指向哪一页，预览的菜单都一项不少（构建同一条，derive-site 不再扣掉那一页）。
  const withBtn = navEditor.liveShellData({ header: {}, footer: {} }, { headerLinks: [{ label: 'Home', href: '/' }, { label: 'Contact', href: '/contact' }], headerButtons: [{ label: 'Get a quote', href: '/contact' }] }, 'en', 'en');
  check(JSON.stringify(withBtn.header.nav.map((l) => l.href)) === JSON.stringify(['/', '/contact']), '主按钮指向 /contact ⟹ 预览菜单里 Contact 照旧在', JSON.stringify(withBtn.header.nav));
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail > 0 ? 1 : 0);
