#!/usr/bin/env node
/**
 * editor-nav.test.js — #1759：编辑器顶栏 Content 页的「Navigation links」—— 菜单从页面推出来，面板改的是各页的 navLabel / navOrder。
 *
 *   node scripts/editor-nav.test.js     （由 `npm run test:scripts` 自动发现）
 *   退出码: 0 全过 · 1 有失败 · 2 跑不起来（**不许当成通过**）
 *
 * 管三个文件：`lib/nav-menu.js`（菜单规则，构建与编辑器预览共用）· `lib/editor-nav.js`（能进菜单的页 + 写别的页）·
 * `write-editor-save.js` 的 `nav` 那一格（容器里那一步，跟页面 / 外壳一起先全判、再全写）。
 *
 * 夹具：仓里那条 skipAI 建站路造一个真站（同 editor-root.test.js），再补三页：一张普通页（第 3 个能进菜单的页）、一张关键词页、
 * 一张服务详情页 —— 后两种按构建的判据不进菜单。
 *
 *   ① 能进菜单的页（§navMenuOf）：首页单独给、普通页按 navOrder、关键词页 / 服务详情页不在、隐藏着的（没有 navLabel）在、navLabel 空串
 *   ② 同一条规则：§menuLinks(§navMenuOf(盘上的页)) == 真跑一次 sync-config 之后 navigation.json 里的 header.links / footer.columns[0].links
 *      （改名 / 隐藏 / 重排 / 改按钮链接之后各跑一次）。反向：换一份「页脚也去掉按钮那一页」的规则 ⟹ 这一格红
 *   ③ §planNavWrite：改名 / 隐藏（删键）/ 显示 / 改 navOrder 只动点名的那几页、只动那两个键；拒收与形状不对的几种
 *   ④ write-editor-save.js：nav + root + 页面一起存；nav 点名正在编辑的页 ⟹ 5；一页的文件坏了 ⟹ 整笔一个字节都不写（验收 10）
 *   ⑤ 浏览器那一侧（`lib/nav-editor.js`）：拖动 / 显示隐藏 / 存盘差 / 预览 —— 面板上做一串动作 → 照它算出的那一笔真存进去 →
 *      真跑一次 sync-config ⟹ navigation.json 的顶栏 / 页脚第一列 == 画布预览当场算出来的（验收 2 / 3 / 4 / 5 在这一层的那一半）
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

// ══ ② 同一条规则：编辑器预览算出来的 == 构建写进 navigation.json 的 ═══════════════════════════════
console.log('② 预览与构建同一条规则（menuLinks vs sync-config）');
{
  const sync = () => cp.spawnSync(process.execPath, [path.join(TEMPLATE, 'scripts', 'sync-config.js')], { cwd: TEMPLATE, encoding: 'utf8', timeout: 240000 });
  const preview = (rule) => {
    const m = menuFromDisk();
    const nav = JSON.parse(fs.readFileSync(path.join(SITE, 'en', 'navigation.json'), 'utf-8'));
    return rule({ homeLabel: navMenu.homeLabelOf(m.home.navLabel, 'en'), regular: m.pages, ctaSlug: navMenu.ctaSlugOf(nav.header.cta.href) });
  };
  const built = () => {
    const nav = JSON.parse(fs.readFileSync(path.join(SITE, 'en', 'navigation.json'), 'utf-8'));
    return { header: nav.header.links, footer: nav.footer.columns[0].links };
  };
  const cases = [
    ['原样', () => {}],
    ['改名 + 隐藏一页', () => { writePage('about', (p) => { p.navLabel = 'Who we are'; }); writePage('services', (p) => { delete p.navLabel; }); }],
    ['重排（pricing 拖到第一位）+ 首页改名', () => { writePage('pricing', (p) => { p.navOrder = 1; }); writePage('about', (p) => { p.navOrder = 2; }); writePage('home', (p) => { p.navLabel = 'Start'; }); }],
    ['按钮改指 pricing（contact 回到顶栏、pricing 离开）', () => {
      const f = path.join(SITE, 'en', 'navigation.json');
      const nav = JSON.parse(fs.readFileSync(f, 'utf-8'));
      nav.header.cta.href = '/pricing';
      fs.writeFileSync(f, `${JSON.stringify(nav, null, 2)}\n`);
    }],
  ];
  let lastBuilt = null;
  for (const [name, mutate] of cases) {
    freshSite();
    mutate();
    const r = sync();
    if (r.status !== 0) { bad(`${name}：sync-config 跑不起来（rc=${r.status}）${(r.stderr || '').slice(-300)}`); continue; }
    const b = built();
    const p = preview(navMenu.menuLinks);
    check(JSON.stringify(p) === JSON.stringify(b), `${name} ⟹ 预览 == 构建`, `预览 ${JSON.stringify(p)} · 构建 ${JSON.stringify(b)}`);
    lastBuilt = b;
  }
  // 反向：把规则改成「页脚也去掉按钮那一页」⟹ 上面最后一格对不上（证明这一格比得出差别）。
  const wrong = (a) => { const r = navMenu.menuLinks(a); const cta = a.ctaSlug; return { header: r.header, footer: r.footer.filter((l) => l.href !== `/${cta}`) }; };
  const p = preview(wrong);
  check(lastBuilt && JSON.stringify(p) !== JSON.stringify(lastBuilt), '反向：页脚也去掉按钮那一页的规则 ⟹ 跟构建对不上', JSON.stringify(p));
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
    root: { headerCta: { label: 'Book now', href: '/pricing' } },
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
    root: { headerCta: { label: 'Book now', href: '/about' }, logoUrl: '/images/new-logo.png' },
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
    root: { headerCta: { label: 'Book now', href: '/about' }, logoUrl: '/images/new-logo.png' },
    nav: { about: { navLabel: 'About us' }, pricing: { navLabel: 'Prices' } },
  });
  check(s.status === 0 && JSON.stringify(changedFiles(fixed, snapshot(SITE))) === JSON.stringify(['brand.json', 'en/navigation.json', 'en/pages/about.json', 'en/pages/home.json', 'en/pages/pricing.json']),
    '（对照）那一页修好、同一笔再发 ⟹ 五份都写了', `${s.status} ${JSON.stringify(changedFiles(fixed, snapshot(SITE)))} ${s.stderr}`);
}

// ══ ⑤ 浏览器那一侧：面板动作 → 存盘差 → 真存 → 真构建 == 预览 ═══════════════════════════════════════
console.log('⑤ nav-editor（面板动作 · 存盘差 · 预览 == 构建）');
{
  freshSite();
  const panel0 = navEditor.navMenuToPanel(menuFromDisk(), 'en');
  const CTA = '/contact';
  check(JSON.stringify(navEditor.panelRows(panel0, CTA).map((r) => r.slug)) === JSON.stringify(['about', 'services', 'pricing']), '面板列表不列按钮那一页（contact）', JSON.stringify(navEditor.panelRows(panel0, CTA)));
  check(navEditor.buttonPage(panel0, CTA).slug === 'contact', '灰字点名的那一页是 contact');
  check(JSON.stringify(navEditor.panelRows(panel0, '/pricing').map((r) => r.slug)) === JSON.stringify(['about', 'services', 'contact']), '按钮改指 pricing ⟹ pricing 离开列表、contact 回来（验收 5）');

  // 拖：pricing（显示着的第 3 格）拖到第 1 格。按钮那一页（contact）在全部页里的位置不动。
  let m = navEditor.moveShown(panel0, CTA, 2, 0);
  check(JSON.stringify(m.items.map((it) => it.slug)) === JSON.stringify(['pricing', 'about', 'services', 'contact']), '拖完：pricing · about · services，contact 原地（最后）', JSON.stringify(m.items.map((it) => it.slug)));
  // 夹在中间的按钮页：contact 改到第 2 位（navOrder 1.5 那种），拖动不许把它挪走。
  const mid = { ...panel0, items: [panel0.items[0], panel0.items[3], panel0.items[1], panel0.items[2]] };
  const mid2 = navEditor.moveShown(mid, CTA, 2, 0);
  check(JSON.stringify(mid2.items.map((it) => it.slug)) === JSON.stringify(['pricing', 'contact', 'about', 'services']), '按钮页夹在中间 ⟹ 拖完它还在第 2 位', JSON.stringify(mid2.items.map((it) => it.slug)));
  // 改名 + 隐藏 + 首页改名
  m = navEditor.setLabel(m, 'about', 'Who we are');
  m = navEditor.setShown(m, CTA, 'services', false);
  m = navEditor.setLabel(m, 'home', 'Start');
  check(JSON.stringify(navEditor.panelRows(m, CTA).map((r) => `${r.slug}:${r.shown}`)) === JSON.stringify(['pricing:true', 'about:true', 'services:false']), '隐藏着的排在最后');
  check(navEditor.navMenuProblem(m) === '', '名字都在 ⟹ 没问题');
  check(/needs a name/.test(navEditor.navMenuProblem(navEditor.setLabel(m, 'about', '  '))), '显示着的名字清空 ⟹ Done 时那一句');
  check(navEditor.navMenuProblem(navEditor.setLabel(m, 'services', '')) === '', '隐藏着的名字清空不算（它不进菜单）');

  // 存盘差：正在编辑的是 about ⟹ about 的两格单独回（并进页面 JSON），别的进 nav。
  const ch = navEditor.navMenuChanges({ initial: panel0, now: m, slug: 'about' });
  console.log(`    存盘差 ${JSON.stringify(ch)}`);
  check(JSON.stringify(ch.page) === JSON.stringify({ navLabel: 'Who we are', navOrder: 2 }), 'about（正在编辑）：名字 + 新序号单独回', JSON.stringify(ch.page));
  check(JSON.stringify(ch.nav) === JSON.stringify({ services: { navLabel: null, navOrder: 3 }, pricing: { navOrder: 1 }, home: { navLabel: 'Start' } }),
    'nav：services 隐藏 + 重编号、pricing 重编号、home 改名；contact 序号没变不交', JSON.stringify(ch.nav));
  check(JSON.stringify(navEditor.navMenuChanges({ initial: panel0, now: panel0, slug: 'about' })) === JSON.stringify({ nav: {}, page: null }), '什么都没动 ⟹ 什么都不交');
  const shownBack = navEditor.setShown(navEditor.setShown(panel0, CTA, 'about', false), CTA, 'about', true);
  check(shownBack.items.find((it) => it.slug === 'about').label === 'About Us' && JSON.stringify(navEditor.panelRows(shownBack, CTA).map((r) => r.slug)) === JSON.stringify(['services', 'pricing', 'about']),
    '显示回来 ⟹ 名字是标题（About Us）、排在显示着的最后', JSON.stringify(navEditor.panelRows(shownBack, CTA)));

  // 照这一笔真存进去（about 是正在编辑的页：它那两格并进页面 JSON），再真构建一次 ⟹ 跟预览一模一样。
  const aboutFile = path.join(PAGES, 'about.json');
  const aboutBytes = fs.readFileSync(aboutFile);
  const s = runScript({ page: 'about', locale: 'en', baseHash: crypto.createHash('sha256').update(aboutBytes).digest('hex') }, {
    page: navEditor.applyPageNav(JSON.parse(aboutBytes.toString('utf-8')), ch.page),
    nav: ch.nav,
  });
  check(s.status === 0, '照存盘差真存 ⟹ 成功', `${s.status} ${s.stdout} ${s.stderr}`);
  const r = cp.spawnSync(process.execPath, [path.join(TEMPLATE, 'scripts', 'sync-config.js')], { cwd: TEMPLATE, encoding: 'utf8', timeout: 240000 });
  const nav = JSON.parse(fs.readFileSync(path.join(SITE, 'en', 'navigation.json'), 'utf-8'));
  const preview = navEditor.liveShellData({ header: {}, footer: {} }, { navMenu: m, headerCta: nav.header.cta }, 'en', 'en');
  check(r.status === 0 && JSON.stringify(preview.header.nav) === JSON.stringify(nav.header.links) && JSON.stringify(preview.footer.nav) === JSON.stringify(nav.footer.columns[0].links),
    '预览 == 构建（顶栏、页脚第一列逐项）', `预览 ${JSON.stringify(preview)} · 构建 ${JSON.stringify({ h: nav.header.links, f: nav.footer.columns[0].links })}`);
  check(JSON.stringify(nav.footer.columns[0].links.map((l) => l.label)) === JSON.stringify(['Start', 'Pricing', 'Who we are', 'Contact']),
    '页脚第一列：首页 · 拖完的顺序 · 按钮那一页还在最后（隐藏的 services 不在）', JSON.stringify(nav.footer.columns[0].links));
  check(!nav.header.links.some((l) => l.href === '/contact') && !nav.header.links.some((l) => l.href === '/services'), '顶栏里没有按钮那一页、没有隐藏的那一页');

  // 预览的按钮 / logo：同 shell-data 的判据（主按钮两格非空、次按钮过链接白名单）。
  const base = { header: { ctaPrimary: { label: 'Old', href: '/x', style: 'solid' }, logo: '/old.png', nav: [] }, footer: { logo: '/old.png', nav: [] } };
  const live = navEditor.liveShellData(base, { logoUrl: '/new.png', headerCta: { label: ' Book ', href: '/pricing' }, headerCtaSecondary: { label: 'Prices', href: '/pricing' } }, 'fr', 'en');
  check(live.header.logo === '/new.png' && live.footer.logo === '/new.png' && JSON.stringify(live.header.ctaPrimary) === JSON.stringify({ label: 'Book', href: '/fr/pricing', style: 'solid' })
    && JSON.stringify(live.header.ctaSecondary) === JSON.stringify({ label: 'Prices', href: '/fr/pricing', style: 'outline' }), 'logo / 主按钮 / 次按钮换上（站内链接按语言加前缀）', JSON.stringify(live));
  const live2 = navEditor.liveShellData(base, { logoUrl: '', headerCtaSecondary: { label: 'Bad', href: 'javascript:x' } }, 'en', 'en');
  check(!('logo' in live2.header) && !('ctaSecondary' in live2.header) && live2.header.ctaPrimary.label === 'Old', 'logo 清空 ⟹ 不画；次按钮链接不过白名单 ⟹ 不画；没带的主按钮原样', JSON.stringify(live2));
}

// ══ ⑥ 首页没写 navLabel 的老站（#1759 QA3 退回）：面板首页那一格跟构建同一条兜底 ═══════════════════════════
// `nav-menu.js` §HOME_LABELS 那段注释点名的那类站（pre-122a / 翻译半途失败）。面板那一格以前取原值 = ''，
// §navMenuProblem 就把整个顶栏面板的 Done 拦下 —— 连只换 Layout / Customize 也存不了。
console.log('⑥ 首页没有 navLabel 的老站');
{
  freshSite();
  writePage('home', (p) => { delete p.navLabel; });
  const homeBefore = fs.readFileSync(path.join(PAGES, 'home.json'));
  const disk = menuFromDisk();
  check(disk.home && disk.home.navLabel === '', '（前提）盘上首页没有 navLabel', JSON.stringify(disk.home));
  const p0 = navEditor.navMenuToPanel(disk, 'en');
  check(p0.home.label === 'Home', '面板首页那一格 = Home（同构建 derive-site 的兜底）', JSON.stringify(p0.home));
  check(navEditor.navMenuProblem(p0) === '', '没动菜单 ⟹ Done 不拦', navEditor.navMenuProblem(p0));
  check(navEditor.navMenuToPanel(disk, 'zh').home.label === '首页' && navEditor.navMenuToPanel(disk, 'xx').home.label === 'Home', '别的语言按 HOME_LABELS（zh 首页），表里没有的语言 Home');
  check(JSON.stringify(navEditor.navMenuChanges({ initial: p0, now: p0, slug: 'about' })) === JSON.stringify({ nav: {}, page: null }), '没动 ⟹ 什么都不交（兜底值不被当成改动写进 home.json）');
  // 只改别的页的名字、真存 ⟹ home.json 一个字节不变；真构建后首项仍是 Home，预览 == 构建。
  const m = navEditor.setLabel(p0, 'about', 'Who we are');
  const ch = navEditor.navMenuChanges({ initial: p0, now: m, slug: 'services' });
  check(JSON.stringify(ch) === JSON.stringify({ nav: { about: { navLabel: 'Who we are' } }, page: null }), '只改 about ⟹ nav 只点名 about，没有 home', JSON.stringify(ch));
  const s = runScript({ page: 'services', locale: 'en' }, { nav: ch.nav });
  check(s.status === 0 && Buffer.compare(homeBefore, fs.readFileSync(path.join(PAGES, 'home.json'))) === 0, '真存 ⟹ 成功，home.json 逐字节没变', `${s.status} ${s.stderr}`);
  const r = cp.spawnSync(process.execPath, [path.join(TEMPLATE, 'scripts', 'sync-config.js')], { cwd: TEMPLATE, encoding: 'utf8', timeout: 240000 });
  const nav = JSON.parse(fs.readFileSync(path.join(SITE, 'en', 'navigation.json'), 'utf-8'));
  const preview = navEditor.liveShellData({ header: {}, footer: {} }, { navMenu: m, headerCta: nav.header.cta }, 'en', 'en');
  check(r.status === 0 && nav.header.links[0].label === 'Home' && JSON.stringify(preview.header.nav) === JSON.stringify(nav.header.links) && JSON.stringify(preview.footer.nav) === JSON.stringify(nav.footer.columns[0].links),
    '构建首项 = Home，预览 == 构建', `预览 ${JSON.stringify(preview)} · 构建 ${JSON.stringify({ h: nav.header.links, f: nav.footer.columns[0].links })}`);
  // 老板自己把首页那一格清空 ⟹ 照样拦（兜底只管「打开时没写」，不替老板填）。
  check(/needs a name/.test(navEditor.navMenuProblem(navEditor.setLabel(p0, 'home', ''))), '老板清空首页名字 ⟹ Done 照样拦');
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail > 0 ? 1 : 0);
