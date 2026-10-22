#!/usr/bin/env node
/**
 * editor-root.test.js — #1405：编辑器外壳三样（root 字段；#1425 T3 起公告条那一样退役）存回站级文件；
 *   #1681：加 Page 面板「Business info」四样（网站名字 / 电话 / 邮箱 / 地址 → `site/brand.json`），见 ① 与 ⑨。
 *
 *   node scripts/editor-root.test.js     （由 `npm run test:scripts` 自动发现）
 *   退出码: 0 全过 · 1 有失败 · 2 跑不起来（**不许当成通过**）
 *
 * 管四个文件：`lib/editor-root-fields.js`（分派表）· `lib/editor-root.js`（判 + 算字节）·
 * `lib/editor-convert.js` §rootToPuck / §puckRootChanges（编辑器那一侧的比对）· `write-editor-save.js`（容器里那一步）。
 *
 * 夹具用仓里那条 skipAI 建站路造一个三语真站（同 write-page.test.js 的理由），每一格拷一份再动。
 * 「弄坏一次它会红」在本文件里自己跑（改分派表 / 换一份被改过的比对函数），不靠人手改代码再改回去。
 *
 * 📌 #1425（T3）：布局库只剩 `standard`，而「布局自己钉了页脚形态」这条规则（§layoutPinsFooter / pinsFooter）
 *    产品代码里还在。为了还能量它（和「切到另一个布局」），夹具在**拷出来的那棵模板**的 `page-layouts/` 里放一份
 *    钉了页脚的布局 `FIXTURE_LAYOUT`（原来用的是随旧库删掉的 `tri-footer`）。库函数都显式传那棵树的 layoutsDir。
 */

'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const cp = require('child_process');
const Module = require('module');

const NEXT = path.resolve(__dirname, '..');

let pass = 0; let fail = 0;
const ok = (m) => { pass += 1; console.log(`  ✅ ${m}`); };
const bad = (m) => { fail += 1; console.log(`  ❌ ${m}`); };
const check = (cond, m, detail) => (cond ? ok(m) : bad(detail ? `${m} —— ${detail}` : m));
function die(msg) { console.log(`💥 ${msg}`); process.exit(2); }

const temps = [];
process.on('exit', () => { for (const t of temps) fs.rmSync(t, { recursive: true, force: true }); });

let editorRoot; let fieldsMod; let convert; let pageLayoutLib; let siteShape;
try {
  editorRoot = require('./lib/editor-root.js');
  fieldsMod = require('./lib/editor-root-fields.js');
  convert = require('./lib/editor-convert.js');
  pageLayoutLib = require('./lib/page-layout.js');
  siteShape = require('./lib/site-shape.js');
} catch (e) {
  die(`加载不起来：${e.message}`);
}

// ── 夹具：一个三语站（en 默认 + fr + zh），整棵模板拷一份（脚本要在站根跑）─────────────────────
function makeTemplate() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'editor-root-'));
  temps.push(root);
  const work = path.join(root, 'nextjs');
  cp.execSync(`cp -a --no-dereference "${NEXT}" "${work}"`, { stdio: 'pipe' });
  for (const junk of ['out', '.next', '.out-backup', '.out-temp', 'site', 'node_modules']) {
    fs.rmSync(path.join(work, junk), { recursive: true, force: true });
  }
  fs.symlinkSync(path.join(NEXT, 'node_modules'), path.join(work, 'node_modules'));
  const r = cp.spawnSync(process.execPath, [path.join(work, 'scripts', 'create-site.js')], {
    input: JSON.stringify({ siteId: 'ertest01', siteUrl: 'https://ertest01.example.com', companyName: 'Northside Auto Care', industry: 'auto repair', location: 'Toronto', skipAI: true, language: 'en', secondaryLocales: ['fr', 'zh'] }),
    cwd: work, encoding: 'utf8', env: { ...process.env, ANTHROPIC_API_KEY: undefined }, timeout: 180000,
  });
  if (!fs.existsSync(path.join(work, 'site', 'zh', 'navigation.json'))) die(`夹具立不起来（rc=${r.status}）\n${(r.stderr || '').slice(-600)}`);
  return work;
}
const TEMPLATE = makeTemplate();
// #1425（T3）：见文件头 —— 一份钉了页脚的布局，只放在拷出来的模板里（站建完之后放，站本身跟真建出来的一样）。
const FIXTURE_LAYOUT = 'fixture-pinned-footer';
const LAYOUTS_DIR = path.join(TEMPLATE, 'page-layouts');
fs.writeFileSync(path.join(LAYOUTS_DIR, `${FIXTURE_LAYOUT}.json`), `${JSON.stringify({
  id: FIXTURE_LAYOUT,
  description: 'Test fixture (#1425 T3): the footer is two bands with pinned styles.',
  regions: ['header', 'content', 'footer-a', 'footer-b'],
  repeatVariants: { 'footer-a': 'stacked', 'footer-b': 'slim-row' },
}, null, 2)}\n`);
{
  const libs = pageLayoutLib.loadLayouts(LAYOUTS_DIR);
  if (!libs.has('standard') || !pageLayoutLib.layoutPinsFooter(libs.get(FIXTURE_LAYOUT)) || pageLayoutLib.layoutPinsFooter(libs.get('standard'))) {
    die('夹具布局立不起来：要 standard（不钉页脚）+ 夹具（钉页脚）两份');
  }
}
const PRISTINE = path.join(path.dirname(TEMPLATE), 'site.pristine');
cp.execSync(`cp -a "${path.join(TEMPLATE, 'site')}" "${PRISTINE}"`);

/** 每一格一个干净的站：把 site/ 换回刚建好时那一份。回站根。 */
function freshSite(mutate) {
  fs.rmSync(path.join(TEMPLATE, 'site'), { recursive: true, force: true });
  cp.execSync(`cp -a "${PRISTINE}" "${path.join(TEMPLATE, 'site')}"`);
  if (mutate) mutate(path.join(TEMPLATE, 'site'));
  return TEMPLATE;
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
function changedFiles(a, b) {
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  return [...keys].filter((k) => a[k] !== b[k]).sort();
}

/** 直接调库：判 + 写（跟 write-editor-save.js 同一个顺序）。 */
function writeRoot(root, locale) {
  const site = path.join(TEMPLATE, 'site');
  const shape = siteShape.readSiteShape(site);
  const localeDir = shape.flat ? site : path.join(site, locale);
  const writes = editorRoot.planRootWrite({ siteDir: site, localeDir, locale: shape.flat ? '' : locale, shape, root, layoutsDir: LAYOUTS_DIR });
  for (const w of writes) fs.writeFileSync(w.file, w.content);
  return writes.map((w) => path.relative(site, w.file));
}
function readRoot(locale) {
  const site = path.join(TEMPLATE, 'site');
  const shape = siteShape.readSiteShape(site);
  return editorRoot.readRootValues({ siteDir: site, localeDir: shape.flat ? site : path.join(site, locale), locale: shape.flat ? '' : locale, layoutsDir: LAYOUTS_DIR });
}
function tryWrite(root, locale) {
  try { return { files: writeRoot(root, locale) }; } catch (e) { return { code: e.code, message: e.message }; }
}

/** 跑容器里那个脚本（在站根）。 */
function runScript(loc, input, env) {
  const r = cp.spawnSync(process.execPath, [path.join(TEMPLATE, 'scripts', 'write-editor-save.js'), JSON.stringify(loc)], {
    cwd: TEMPLATE, input: JSON.stringify(input), encoding: 'utf8', timeout: 60000, env: { ...process.env, ...(env || {}) },
  });
  let last = null;
  try { last = JSON.parse((r.stdout || '').trim().split('\n').pop()); } catch { last = null; }
  return { status: r.status, stdout: r.stdout, stderr: r.stderr, last };
}

// 每个字段一个「跟现值不同」的值，用来走一遍往返。
function otherValues(cur) {
  const layouts = [...pageLayoutLib.loadLayouts(LAYOUTS_DIR).keys()];
  const pick = (list, not) => list.find((x) => x !== not);
  const header = require('./region-layout.js').pickableShapesOf('header');
  const footer = require('./region-layout.js').pickableShapesOf('footer');
  // 📌 #1425（T3）：原来还有 topbarMessage / topbarLink（随公告条那个区删了），layout 也不再滤「带公告条的布局」、
  //    headerShape 不再滤透明浮层（两样都退役了）。
  return {
    layout: pick(layouts, cur.layout),
    headerShape: pick(header, cur.headerShape),
    footerShape: pick(footer, cur.footerShape),
    // #1681 —— Business info 四样：跟现值不同的文字就行。
    brandName: `${cur.brandName || 'Site'} Renamed`,
    email: cur.email === 'hello@renamed.example' ? 'hi@renamed.example' : 'hello@renamed.example',
    // #1980 —— 电话 / 地址挪进了整份 `locations`：第一家换电话，再加一家带营业时间的。
    locations: [
      { ...(cur.locations || [])[0], phone: (cur.locations || [])[0] && cur.locations[0].phone === '(416) 555-0199' ? '(416) 555-0100' : '(416) 555-0199' },
      { id: 'loc-rt01', label: 'Round trip', address: '1 Yonge St, Toronto, ON', email: 'yonge@renamed.example',
        hours: [{ days: ['Monday', 'Tuesday'], opens: '09:00', closes: '18:00' }, { days: ['Saturday'], opens: '10:00', closes: '24:00' }] },
    ],
    // #1738 —— 顶栏 / 页脚的底色 + 旋钮：一个对象，跟现值不同就行（每一格都得是 manifest 认的，`region-options.js`）。
    headerOptions: cur.headerOptions && cur.headerOptions.menu === 'below' ? { bg: '#1e293b' } : { bg: '#0f172a', logo: 'center', menu: 'below', icons: true },
    footerOptions: cur.footerOptions && cur.footerOptions.brand === 'right' ? { form: 'teaser' } : { bg: 'brand', brand: 'right' },
    // #1759 —— 顶栏 Content 页：logo 地址、按钮（#1787：`[{label, href}]`，0–3 颗）。
    logoUrl: cur.logoUrl === '/images/renamed-logo.svg' ? '/images/other-logo.svg' : '/images/renamed-logo.svg',
    headerButtons: cur.headerButtons && cur.headerButtons[0] && cur.headerButtons[0].label === 'Book now'
      ? [{ label: 'Call us', href: '/about' }] : [{ label: 'Book now', href: '/services' }, { label: 'Our work', href: '/about' }],
  };
}

/** 站里有没有**语言目录下**的 brand.json（#1681：brand.json 整站一份，写到语言目录里就没有读者）。 */
const localeBrandFiles = (site) => fs.readdirSync(site, { withFileTypes: true })
  .filter((e) => e.isDirectory() && fs.existsSync(path.join(site, e.name, 'brand.json'))).map((e) => `${e.name}/brand.json`);

/** 往返：每个字段各写一次（只写它自己），读回来必须等于写进去的；回点名的问题清单。 */
function roundTripProblems() {
  const problems = [];
  // 🔴 这张名单故意手写、不照分派表遍历：守卫要量的就是「分派表少了谁」（下面那格反向把一行拿掉）。
  for (const f of ['layout', 'headerShape', 'footerShape', 'headerOptions', 'footerOptions', 'brandName', 'email', 'locations', 'logoUrl', 'headerButtons']) {
    freshSite();
    const before = readRoot('en');
    const want = otherValues(before)[f];
    const r = tryWrite({ [f]: want }, 'en');
    if (r.code) { problems.push(`${f}（写不进去：${r.message.slice(0, 80)}）`); continue; }
    // #1681 —— brand 那四样只许写站根那一份 brand.json；任何语言目录下都不许冒出一份。
    if (['brandName', 'email', 'locations', 'logoUrl'].includes(f)) {
      if (JSON.stringify(r.files) !== JSON.stringify(['brand.json'])) problems.push(`${f}（写的是 ${JSON.stringify(r.files)}，不是站根的 brand.json）`);
      const stray = localeBrandFiles(path.join(TEMPLATE, 'site'));
      if (stray.length) problems.push(`${f}（语言目录下多了 ${stray.join(', ')}）`);
    }
    // #1759 —— 按钮只许写这种语言那一份 navigation.json。
    if (f === 'headerButtons' && JSON.stringify(r.files) !== JSON.stringify([path.join('en', 'navigation.json')])) {
      problems.push(`${f}（写的是 ${JSON.stringify(r.files)}，不是 en/navigation.json）`);
    }
    const after = readRoot('en');
    if (JSON.stringify(after[f]) !== JSON.stringify(want)) problems.push(`${f}（读回 ${JSON.stringify(after[f])}，写的是 ${JSON.stringify(want)}）`);
    for (const g of Object.keys(before)) {
      if (g !== f && JSON.stringify(after[g]) !== JSON.stringify(before[g])) problems.push(`${f}（顺带改了 ${g}）`);
    }
  }
  return problems;
}

// ══ ① 往返：站级文件 → root → 站级文件，逐字段；分派表少一行 ⟹ 点名那个字段 ═══════════════════
console.log('① 往返（分派表每一行）');
{
  const problems = roundTripProblems();
  check(problems.length === 0, '10 个 root 字段各写一次都读得回来、不碰别的字段（brand 四样只写站根的 brand.json，按钮只写 en/navigation.json）', problems.join(' · '));

  // 反向：把分派表的 footerShape 那一行拿掉（editor-root.js 拿的是同一个数组）。#1425（T3）：原来拿的是 topbarLink。
  const table = fieldsMod.ROOT_FIELDS;
  const at = table.findIndex((f) => f.field === 'footerShape');
  const [removed] = table.splice(at, 1);
  const broken = roundTripProblems();
  table.splice(at, 0, removed);
  check(broken.length === 1 && broken[0].startsWith('footerShape'), '反向：分派表少了 footerShape ⟹ 守卫只点它的名', JSON.stringify(broken));
}

// ══ ② theme.json 只动 regionLayout；navigation.json 一个字节不动（#1425 T3）═══════════════════════════════
console.log('② 只动该动的那一段');
{
  freshSite();
  const site = path.join(TEMPLATE, 'site');
  const themeBefore = JSON.parse(fs.readFileSync(path.join(site, 'theme.json'), 'utf-8'));
  writeRoot({ footerShape: otherValues(readRoot('en')).footerShape }, 'en');
  const themeAfter = JSON.parse(fs.readFileSync(path.join(site, 'theme.json'), 'utf-8'));
  const rest = (o) => { const c = { ...o }; delete c.regionLayout; return JSON.stringify(c); };
  check(rest(themeBefore) === rest(themeAfter) && themeAfter.regionLayout && themeAfter.regionLayout.footer,
    'theme.json：themeId / applied / tweaks / css 原样，只多了 regionLayout', `${rest(themeBefore)} → ${rest(themeAfter)}`);

  // 📌 #1425（T3）—— 这里原来还测「navigation.json 只动 topbar、清空回原样、只填链接补空串」；
  //    公告条文字 / 链接随公告条那个区删了。改成今天成立的那一半：外壳三样一样都不碰 navigation.json。
  const navs = ['en', 'fr', 'zh'].map((l) => path.join(site, l, 'navigation.json'));
  const navBytes = navs.map((f) => fs.readFileSync(f, 'utf-8'));
  const other = otherValues(readRoot('en'));
  writeRoot({ layout: other.layout, headerShape: other.headerShape }, 'en');
  check(navs.every((f, k) => fs.readFileSync(f, 'utf-8') === navBytes[k]), '三样都写过之后三种语言的 navigation.json 逐字节不变');
}

// ══ ③ 多语言：布局 / 形态整站一份，公告条按语言一份 ═════════════════════════════════════════════
// 📌 #1425（T3）—— 这里原来还测「公告条按语言一份：在 fr 里改公告条文字 ⟹ 只变 fr/navigation.json」；公告条随旧库删了。
//    今天三样都是整站一份，补一格布局（同样在 fr 里改，只变站根那一份）。
console.log('③ 三语站');
{
  freshSite();
  const site = path.join(TEMPLATE, 'site');
  const a = snapshot(site);
  writeRoot({ layout: otherValues(readRoot('fr')).layout }, 'fr');
  check(JSON.stringify(changedFiles(a, snapshot(site))) === JSON.stringify(['page-layout.json']),
    '在 fr 里改布局 ⟹ 只变站根的 page-layout.json', JSON.stringify(changedFiles(a, snapshot(site))));
  check(readRoot('en').layout === readRoot('zh').layout && readRoot('zh').layout === readRoot('fr').layout, '三种语言读回的布局相同');
  const b = snapshot(site);
  writeRoot({ headerShape: otherValues(readRoot('fr')).headerShape }, 'fr');
  check(JSON.stringify(changedFiles(b, snapshot(site))) === JSON.stringify(['theme.json']),
    '在 fr 里改顶栏形态 ⟹ 只变站根的 theme.json（三种语言读同一份）', JSON.stringify(changedFiles(b, snapshot(site))));
  check(readRoot('en').headerShape === readRoot('zh').headerShape && readRoot('zh').headerShape === readRoot('fr').headerShape,
    '三种语言读回的顶栏形态相同');
}

// ══ ④ 拒收：构建不收的组合停在写之前，那句话点名原因 ═══════════════════════════════════════════
console.log('④ 拒收');
{
  freshSite();
  const site = path.join(TEMPLATE, 'site');
  // 📌 #1425（T3）—— 这里原来测四格「with-topbar 缺语言 / with-topbar + 透明浮层顶栏（含只切布局、以及换掉顶栏的正臂）」；
  //    公告条那个区、透明浮层顶栏都随旧库删了，那两条规则在 editor-root.js 里一起删了。
  let before = snapshot(site);
  let r;
  r = tryWrite({ layout: FIXTURE_LAYOUT, footerShape: 'slim-row' }, 'en');
  check(r.code === editorRoot.REFUSED && changedFiles(before, snapshot(site)).length === 0, '布局自带页脚时改页脚形态 ⟹ 拒、什么都没写', r.message);
  r = tryWrite({ layout: FIXTURE_LAYOUT }, 'en');
  check(!r.code && JSON.stringify(r.files) === JSON.stringify(['page-layout.json']), `正臂：只切到 ${FIXTURE_LAYOUT} ⟹ 只写 page-layout.json`, JSON.stringify(r));
  // 反向臂：布局已经是钉页脚的那份，这一笔只改页脚形态（没碰布局）⟹ 也拒（按「写完以后」算）
  before = snapshot(site);
  r = tryWrite({ footerShape: 'stacked' }, 'en');
  check(r.code === editorRoot.REFUSED && changedFiles(before, snapshot(site)).length === 0, '布局已钉页脚时只改页脚形态 ⟹ 也拒、什么都没写', r.message);
  r = tryWrite({ layout: 'standard', footerShape: 'stacked' }, 'en');
  check(!r.code && r.files.includes('theme.json'), '正臂：同一笔切回 standard ⟹ 页脚形态写得进去', JSON.stringify(r));

  r = tryWrite({ headerShape: 'nope' }, 'en');
  check(r.code === 5, '不是能挑的形态 ⟹ 5（不是编辑器发得出来的东西）');
  r = tryWrite({ bogus: 1 }, 'en');
  check(r.code === 5 && /bogus/.test(r.message), '分派表里没有的字段 ⟹ 5 并点名');
}

// ══ ⑤ 容器里那一步：先全判、再全写；拒收时 stdout 那一行带着原话 ════════════════════════════════
console.log('⑤ write-editor-save.js');
{
  freshSite();
  const site = path.join(TEMPLATE, 'site');
  const homeFile = path.join(site, 'en', 'pages', 'home.json');
  const hash = () => require('crypto').createHash('sha256').update(fs.readFileSync(homeFile)).digest('hex');
  const page = JSON.parse(fs.readFileSync(homeFile, 'utf-8'));
  page.title = `${page.title || 'Home'} (edited 1405)`;

  let before = snapshot(site);
  // #1425（T3）：会被拒的 root 原来是 with-topbar（缺公告文字）；换成「钉页脚的布局 + 改页脚形态」这条今天还在的规则。
  let r = runScript({ page: 'home', locale: 'en', baseHash: hash() }, { page, root: { layout: FIXTURE_LAYOUT, footerShape: 'stacked' } });
  check(r.status === editorRoot.REFUSED && r.last && r.last.ok === false && /comes with its own footer styles/.test(r.last.message),
    '页面 + 会被拒的 root ⟹ exit 11，stdout 那一行是给老板的原话', `${r.status} ${r.stdout}`);
  check(changedFiles(before, snapshot(site)).length === 0, '没有一半状态：页面也一个字节没写');

  r = runScript({ page: 'home', locale: 'en', baseHash: hash() }, { page, root: { footerShape: otherValues(readRoot('en')).footerShape } });
  check(r.status === 0 && r.last && JSON.stringify(r.last.files) === JSON.stringify(['site/en/pages/home.json', 'site/theme.json']),
    '页面 + 能写的 root ⟹ 两份一起写、files 列出两份', `${r.status} ${r.stdout} ${r.stderr}`);
  // #1415 —— 写了页面就回 hash（写完之后那份页面文件字节的 sha256），编辑器拿它当下一次存盘的 baseHash。
  check(r.last && r.last.hash === hash(), '#1415：页面 + root ⟹ hash = 写完之后 home.json 的 sha256', `${r.last && r.last.hash} vs ${hash()}`);
  const hashAfterPage = hash();

  before = snapshot(site);
  // #1425（T3）：原来只写 root.topbarMessage → fr/navigation.json；今天换成 headerShape → 站根 theme.json。
  r = runScript({ page: 'home', locale: 'fr' }, { root: { headerShape: otherValues(readRoot('fr')).headerShape } });
  check(r.status === 0 && JSON.stringify(r.last.files) === JSON.stringify(['site/theme.json']) && changedFiles(before, snapshot(site)).join() === 'theme.json',
    '只有 root（不带页面、不带 baseHash）⟹ 只写那一份站级文件', `${r.status} ${r.stdout} ${r.stderr}`);
  // #1415 —— 只有 root 时不回 hash：页面没写，编辑器手上的 baseHash 仍然对。回一个「当前文件的 hash」会把别处
  // 对这一页的改动悄悄认成底稿。
  check(r.last && !('hash' in r.last) && hash() === hashAfterPage, '#1415：只有 root ⟹ stdout 那一行没有 hash 键、页面文件没动', r.stdout);

  r = runScript({ page: 'home', locale: 'en' }, { root: {} });
  check(r.status === 5, '既没页面也没 root ⟹ 5');
  r = runScript({ page: 'home', locale: 'en', baseHash: 'f'.repeat(64) }, { page, root: { footerShape: otherValues(readRoot('en')).footerShape } });
  check(r.status === 10, '页面底稿过期 ⟹ 10（页面那一半的判据跟 write-page.js 是同一份）', `${r.status} ${r.stderr}`);
}

// ══ ⑤b 老 `sections` 形状的页面（票 AC「老 sections 形状的站走得通」）════════════════════════════
// 页面那一半今天恰好带 blocks 或 sections 其中一个（`lib/page-write.js`）。带 root 的这一笔要对两种形状
// 都成立：页面写回去仍是 sections、不被改成 blocks；root 那一半照分派表写。
console.log('⑤b 老 sections 形状的页面 + root 一起存');
{
  freshSite((s) => {
    const f = path.join(s, 'en', 'pages', 'home.json');
    const p = JSON.parse(fs.readFileSync(f, 'utf-8'));
    // 老站的页面没有块 id（那种页面本来就没有 id），跟 editor-roundtrip.test.js 的 sections 夹具同一个造法。
    p.sections = (p.blocks || []).map(({ id, ...b }) => b);
    delete p.blocks;
    fs.writeFileSync(f, JSON.stringify(p, null, 2));
  });
  const site = path.join(TEMPLATE, 'site');
  const homeFile = path.join(site, 'en', 'pages', 'home.json');
  const hash = () => require('crypto').createHash('sha256').update(fs.readFileSync(homeFile)).digest('hex');
  const page = JSON.parse(fs.readFileSync(homeFile, 'utf-8'));
  check(Array.isArray(page.sections) && page.sections.length > 0 && !('blocks' in page), '夹具：home.json 是 sections 形状');
  page.sections[0] = { ...page.sections[0], data: { ...(page.sections[0].data || {}), title: 'Sections-shape edit 1405' } };
  const footer = otherValues(readRoot('en')).footerShape;
  const r = runScript({ page: 'home', locale: 'en', baseHash: hash() }, { page, root: { footerShape: footer } });
  const after = JSON.parse(fs.readFileSync(homeFile, 'utf-8'));
  check(r.status === 0 && r.last && JSON.stringify(r.last.files) === JSON.stringify(['site/en/pages/home.json', 'site/theme.json']),
    'sections 页面 + root ⟹ 两份一起写', `${r.status} ${r.stdout} ${r.stderr}`);
  check(Array.isArray(after.sections) && !('blocks' in after) && after.sections[0].data.title === 'Sections-shape edit 1405',
    '写回去仍是 sections 形状、改动在');
  check(readRoot('en').footerShape === footer, 'root 那一半照分派表写进 theme.json');
}

// ══ ⑥ 编辑器那一侧：只交改过的字段；别处的改动不被冲掉 ═══════════════════════════════════════════
console.log('⑥ 只写改过的字段（puckRootChanges）');
{
  const schema = require('./lib/editor-schema.js').editorSchema({ layoutsDir: LAYOUTS_DIR });
  // #1425（T3）：「别处改的那个字段」原来是公告条文字（随旧库删了），换成顶栏形态。
  /** 打开编辑器 → 别处改顶栏形态 → 编辑器只改页脚后存盘 → 顶栏形态仍是别处那一份。回读回来的顶栏形态。 */
  let elsewhere = null;
  function scenario(changes) {
    freshSite();
    const initial = { root: { props: convert.rootToPuck(readRoot('en')) } };
    elsewhere = otherValues(readRoot('en')).headerShape;
    writeRoot({ headerShape: elsewhere }, 'en'); // 别处
    const now = { root: { props: { ...initial.root.props, footerShape: otherValues(readRoot('en')).footerShape } } };
    writeRoot(changes({ initial, now, schema }), 'en');
    return readRoot('en').headerShape;
  }
  check(scenario(convert.puckRootChanges) === elsewhere, '编辑器只改页脚 ⟹ 别处改的顶栏形态还在');

  // 反向：换一份「整份写回」的比对（把「跟初值比」那一句拿掉）⟹ 顶栏形态被冲回打开时的值。
  const src = fs.readFileSync(path.join(__dirname, 'lib', 'editor-convert.js'), 'utf-8');
  const needle = 'if (!deepEqual(next, a[field])) out[field] = next;';
  if (!src.includes(needle)) die('editor-convert.js 里找不到「跟初值比」那一句 —— 反向对照改不了，这一格什么都说明不了');
  const m = new Module(path.join(__dirname, 'lib', 'editor-convert.mut.js'), module);
  m.filename = m.id; // editor-convert.js 顶上 require('./item-sources')（#1505）：相对路径按这个文件名解析
  m._compile(src.replace(needle, 'out[field] = next;'), m.id);
  check(scenario(m.exports.puckRootChanges) !== elsewhere, '反向：整份写回 ⟹ 别处的改动被冲掉（这一格会红）');

  const initial = { root: { props: convert.rootToPuck({ layout: 'standard', headerShape: 'logo-left', footerShape: 'columns' }) } };
  const same = convert.puckRootChanges({ initial, now: JSON.parse(JSON.stringify(initial)), schema });
  check(Object.keys(same).length === 0, '一个字段都没改 ⟹ 空（不写任何站级文件）');
  const pinned = convert.puckRootChanges({ initial, now: { root: { props: { ...initial.root.props, layout: FIXTURE_LAYOUT, footerShape: 'slim-row' } } }, schema });
  check(JSON.stringify(pinned) === JSON.stringify({ layout: FIXTURE_LAYOUT }), '布局自带页脚时不交 footerShape', JSON.stringify(pinned));
  const unpinned = convert.puckRootChanges({ initial, now: { root: { props: { ...initial.root.props, footerShape: 'slim-row' } } }, schema });
  check(JSON.stringify(unpinned) === JSON.stringify({ footerShape: 'slim-row' }), '（对照）standard 下改页脚形态 ⟹ 交 footerShape', JSON.stringify(unpinned));
  // 📌 #1425（T3）—— 这里原来还测「公告条链接两格清空 = null」；topbarLink 随公告条那个区删了。
  check(JSON.stringify(schema.root.fields.map((f) => f.field)) === JSON.stringify(fieldsMod.ROOT_FIELDS.map((f) => f.field)),
    '编辑器的 root 字段清单就是分派表那一份');
  check(schema.root.layouts.filter((l) => l.pinsFooter).map((l) => l.id).join() === [...pageLayoutLib.loadLayouts(LAYOUTS_DIR).values()].filter((l) => l.repeatVariants && Object.keys(l.repeatVariants).some((k) => pageLayoutLib.kindOf(k) === 'footer')).map((l) => l.id).join(),
    `pinsFooter 从布局文件算（这里是夹具 ${FIXTURE_LAYOUT}）`);
}

// ══ ⑦ page-layout.json：本票是第一个写入者 —— 写进去构建读得到；三种坏法构建都点名 ═══════════════
console.log('⑦ page-layout.json 进构建');
{
  function sync() {
    return cp.spawnSync(process.execPath, [path.join(TEMPLATE, 'scripts', 'sync-config.js')], { cwd: TEMPLATE, encoding: 'utf8', timeout: 180000 });
  }
  freshSite();
  writeRoot({ layout: FIXTURE_LAYOUT }, 'en');
  let r = sync();
  const data = fs.existsSync(path.join(TEMPLATE, 'src', 'lib', 'config-data.ts')) ? fs.readFileSync(path.join(TEMPLATE, 'src', 'lib', 'config-data.ts'), 'utf-8') : '';
  check(r.status === 0 && data.includes(`pageLayout = {"id":"${FIXTURE_LAYOUT}"`), `编辑器写的 page-layout.json ⟹ 构建读到 ${FIXTURE_LAYOUT}`, `rc=${r.status} ${(r.stderr || '').slice(-300)}`);

  const broken = [
    ['{ not json', '不是合法 JSON'],
    ['{"layout":"standard"}', '拿不出一个能用的 layoutId'],
    ['{"layoutId":"nope"}', '不在库里'],
  ];
  for (const [body, want] of broken) {
    freshSite((s) => fs.writeFileSync(path.join(s, 'page-layout.json'), body));
    r = sync();
    check(r.status === 1 && (r.stderr || '').includes(want), `坏的 page-layout.json（${body}）⟹ 构建 exit 1 并说「${want}」`, `rc=${r.status} ${(r.stderr || '').slice(-200)}`);
  }
}

// ══ ⑧ 扁平老站（没有 site_meta.json、文件都在 site/ 下）══════════════════════════════════════════
console.log('⑧ 扁平老站');
{
  freshSite((s) => {
    for (const l of ['fr', 'zh']) fs.rmSync(path.join(s, l), { recursive: true });
    for (const e of fs.readdirSync(path.join(s, 'en'))) fs.renameSync(path.join(s, 'en', e), path.join(s, e));
    fs.rmSync(path.join(s, 'en'), { recursive: true });
    fs.rmSync(path.join(s, 'site_meta.json'));
  });
  const site = path.join(TEMPLATE, 'site');
  const before = snapshot(site);
  // 📌 #1425（T3）—— 这里原来测「扁平站：公告条写进 site/navigation.json；有了公告条文字就能切 with-topbar」；
  //    两样都随公告条那个区删了。改成扁平站上三样各写到哪。
  let r = tryWrite({ headerShape: otherValues(readRoot('en')).headerShape }, 'en');
  check(!r.code && JSON.stringify(changedFiles(before, snapshot(site))) === JSON.stringify(['theme.json']), '扁平站：顶栏形态写进 site/theme.json', JSON.stringify(r));
  const mid = snapshot(site);
  r = tryWrite({ layout: FIXTURE_LAYOUT }, 'en');
  check(!r.code && JSON.stringify(changedFiles(mid, snapshot(site))) === JSON.stringify(['page-layout.json']), '扁平站：布局写进 site/page-layout.json', JSON.stringify(r));
}

// ══ ⑨ #1681 Business info：brand.json 的形状（门店数组 / 按语言的名字 / 老站的字符串名字）═══════════════
console.log('⑨ Business info（brand.json）');
{
  const brandFile = () => path.join(TEMPLATE, 'site', 'brand.json');
  const readBrand = () => JSON.parse(fs.readFileSync(brandFile(), 'utf-8'));
  const setBrand = (mut) => { const b = readBrand(); mut(b); fs.writeFileSync(brandFile(), `${JSON.stringify(b, null, 2)}\n`); };
  const SECOND = { label: 'Second shop', address: '9 King St E, Toronto, ON', phone: '(416) 555-0002', geo: { lat: 43.65, lng: -79.37 } };
  const firstWithGeo = (b) => {
    b.locations = Array.isArray(b.locations) && b.locations.length ? b.locations : [{ label: 'Main' }];
    b.locations[0] = { ...b.locations[0], label: b.locations[0].label || 'Main', address: b.locations[0].address || '55 Bloor St W, Toronto, ON', geo: { lat: 43.67, lng: -79.39 } };
  };

  // #1980 —— 电话 / 地址住进整份 `locations`（Locations 区）。改第一家电话：两家都在；geo / slug / reviews 不归编辑器、原样留着；
  //    第二家一个字节不变；brand.json 别的键不动。
  freshSite();
  setBrand((b) => { firstWithGeo(b); b.locations[0].slug = 'main-st'; b.locations[0].reviews = [{ quote: 'Great', author: 'A' }]; b.locations[1] = SECOND; });
  const b0 = readBrand();
  const locs0 = readRoot('en').locations;
  check(Array.isArray(locs0) && locs0.length === 2 && locs0.every((l) => typeof l.id === 'string' && l.id) && !locs0.some((l) => 'geo' in l || 'slug' in l || 'reviews' in l),
    '读值：两家都在、没有 id 的按下标补上、geo / slug / reviews 不给编辑器', JSON.stringify(locs0));
  let r = tryWrite({ locations: [{ ...locs0[0], phone: '(647) 555-0123' }, locs0[1]] }, 'en');
  const b1 = readBrand();
  check(!r.code && Array.isArray(b1.locations) && b1.locations.length === 2, '改电话 ⟹ locations 仍是数组、仍是两家', JSON.stringify(r));
  check(b1.locations[0].phone === '(647) 555-0123', '第一家的电话是新号码');
  check(['label', 'address', 'geo', 'slug', 'reviews'].every((k) => JSON.stringify(b1.locations[0][k]) === JSON.stringify(b0.locations[0][k])),
    '第一家的 label / address / geo / slug / reviews 原样都在', JSON.stringify(b1.locations[0]));
  check(JSON.stringify({ ...b1.locations[1], id: undefined }) === JSON.stringify({ ...b0.locations[1], id: undefined }) && b1.locations[1].id === locs0[1].id,
    '第二家只多了一个 id（第一次写 brand.json 时落盘），别的一个字节不变', JSON.stringify(b1.locations[1]));
  const rest = (b) => { const c = { ...b }; delete c.locations; return JSON.stringify(c); };
  check(rest(b0) === rest(b1), 'brand.json 其余键（颜色 / 字体 / 名字 …）一个不动');

  // 整份写回再读出相同（AC1 第一句）
  const full = readRoot('en').locations;
  r = tryWrite({ locations: full }, 'en');
  check(!r.code && JSON.stringify(readRoot('en').locations) === JSON.stringify(full), '整份写回 ⟹ 读出来一模一样', JSON.stringify(readRoot('en').locations));
  // 编辑器交来的 geo 不进库（editor-data 把 sites.geo 并进了内存那份）
  r = tryWrite({ locations: [{ ...full[0], geo: { lat: 1, lng: 2 } }, full[1]] }, 'en');
  check(r.code === 5 && /改不了的键/.test(r.message), '编辑器交来 geo ⟹ 形状不对（5），不写进 brand.json', JSON.stringify(r));

  // 清空 = 删键；网站名字不许空；类型不对 = 5
  r = tryWrite({ locations: [{ ...full[0], phone: '  ' }, full[1]] }, 'en');
  check(!r.code && !('phone' in readBrand().locations[0]) && !('phone' in readRoot('en').locations[0]), '清空第一家电话 ⟹ 没有 phone 这个键');
  r = tryWrite({ email: '  ' }, 'en');
  check(!r.code && !('email' in readBrand()), '清空邮箱（只有空格）⟹ 没有 email 这个键');
  let before = snapshot(path.join(TEMPLATE, 'site'));
  r = tryWrite({ brandName: '   ' }, 'en');
  check(r.code === editorRoot.REFUSED && /website name can't be empty/.test(r.message) && changedFiles(before, snapshot(path.join(TEMPLATE, 'site'))).length === 0,
    '网站名字清空 ⟹ 拒收（英文那句进状态栏）、什么都没写', JSON.stringify(r));
  r = tryWrite({ locations: [{ ...full[0], phone: 5551234 }] }, 'en');
  check(r.code === 5, '电话不是字符串 ⟹ 5');
  r = tryWrite({ phone: '(416) 555-0100' }, 'en');
  check(r.code === 5 && /不认识的字段/.test(r.message), '老字段 phone 不再收（挪进了 locations）⟹ 5', JSON.stringify(r));

  // AC1：缺 id、营业时间 25:00、邮箱不像邮箱 ⟹ 拒收，原话给老板，什么都没写
  before = snapshot(path.join(TEMPLATE, 'site'));
  const refusedWith = (locations, re, label) => {
    const x = tryWrite({ locations }, 'en');
    check(x.code === editorRoot.REFUSED && re.test(x.message) && /Nothing was changed\.$/.test(x.message) && changedFiles(before, snapshot(path.join(TEMPLATE, 'site'))).length === 0,
      label, JSON.stringify(x));
  };
  refusedWith([full[0], { label: 'No id', address: '1 Main St' }], /The location "No id" is missing its id/, '缺 id ⟹ 拒收（点名那一家）');
  refusedWith([full[0], { ...full[1], hours: [{ days: ['Monday'], opens: '09:00', closes: '25:00' }] }], /opening hours of Second shop are not valid/, '营业时间 25:00 ⟹ 拒收');
  refusedWith([full[0], { ...full[1], hours: [{ days: ['Mon'], opens: '09:00', closes: '17:00' }] }], /opening hours of Second shop are not valid/, '星期不是英文全名（Mon）⟹ 拒收');
  refusedWith([full[0], { ...full[1], hours: [{ days: ['Monday'], opens: '9:00', closes: '17:00' }] }], /opening hours of Second shop are not valid/, '时间不是 HH:MM（9:00）⟹ 拒收');
  refusedWith([full[0], { ...full[1], email: 'not-an-email' }], /The email "not-an-email" of Second shop is not an email address/, '这一家的邮箱不像邮箱 ⟹ 拒收');
  refusedWith([full[0], { ...full[1], id: full[0].id }], /Two locations have the same id/, '两家同一个 id ⟹ 拒收');
  // 合格的营业时间 / 这一家的邮箱写得进去（邮箱空着 = 用网站邮箱，那条兜底在 contact-facts.js）
  r = tryWrite({ locations: [full[0], { ...full[1], email: 'king@example.com', hours: [{ days: ['Monday', 'Friday'], opens: '08:30', closes: '24:00' }] }] }, 'en');
  check(!r.code && readBrand().locations[1].email === 'king@example.com' && JSON.stringify(readBrand().locations[1].hours) === JSON.stringify([{ days: ['Monday', 'Friday'], opens: '08:30', closes: '24:00' }]),
    '合格的营业时间 / 这一家的邮箱 ⟹ 写进那一家', JSON.stringify(readBrand().locations[1]));

  // 加一家、删一家、排序：顺序照老板的；被删那家整个不见；新的那家只有交来的那几样
  freshSite();
  setBrand((b) => { firstWithGeo(b); b.locations[1] = SECOND; });
  const two = readRoot('en').locations;
  r = tryWrite({ locations: [two[1], { id: 'loc-new1', label: 'Third', address: '3 Elm St' }] }, 'en');
  const b3 = readBrand();
  check(!r.code && b3.locations.length === 2 && b3.locations[0].label === 'Second shop' && b3.locations[1].id === 'loc-new1'
    && JSON.stringify(Object.keys(b3.locations[1])) === JSON.stringify(['id', 'label', 'address']) && JSON.stringify(b3.locations[0].geo) === JSON.stringify(SECOND.geo),
    '删掉第一家、加一家：第二家变第一（带着它的 geo），新那家只有 id / label / address', JSON.stringify(b3.locations));

  // 老站：营业时间还在默认语言 seo.json ⟹ 读值里它就是第一家的（不读成空、一存就清掉）
  freshSite();
  const seoFile = path.join(TEMPLATE, 'site', 'en', 'seo.json');
  const legacyHours = [{ days: ['Monday'], opens: '09:00', closes: '17:00' }];
  { const seo = JSON.parse(fs.readFileSync(seoFile, 'utf-8')); seo.schema = { ...(seo.schema || {}), openingHours: legacyHours }; fs.writeFileSync(seoFile, `${JSON.stringify(seo, null, 2)}\n`); }
  setBrand((b) => { b.locations = [{ label: 'Main', address: '55 Bloor St W, Toronto, ON' }]; });
  check(JSON.stringify(readRoot('en').locations[0].hours) === JSON.stringify(legacyHours), '老站：seo.json 里的营业时间读成第一家的', JSON.stringify(readRoot('en').locations));

  // 没有地点的站：读出 []；交一份空的 ⟹ 不留空数组；交一家 ⟹ 新建
  freshSite();
  setBrand((b) => { delete b.locations; });
  check(JSON.stringify(readRoot('en').locations) === '[]', '没有地点 ⟹ 读出 []');
  r = tryWrite({ locations: [] }, 'en');
  check(!r.code && !('locations' in readBrand()), '交一份空的 ⟹ 没有 locations 这个键');
  r = tryWrite({ locations: [{ id: 'loc-a1b2', phone: '(905) 555-0111' }] }, 'en');
  check(!r.code && readBrand().locations[0].phone === '(905) 555-0111', '没有地点时加一家 ⟹ 新建第一家');

  // 多语言：名字只动这种语言那一格；电话三种语言读回同一个
  freshSite();
  const nameBefore = readBrand().name;
  check(nameBefore && typeof nameBefore === 'object', '夹具：新建的站 brand.name 是按语言的表', JSON.stringify(nameBefore));
  r = tryWrite({ brandName: '北区汽修' }, 'zh');
  const nameAfter = readBrand().name;
  check(!r.code && nameAfter.zh === '北区汽修' && nameAfter.en === nameBefore.en && JSON.stringify({ ...nameAfter, zh: undefined }) === JSON.stringify({ ...nameBefore, zh: undefined }),
    '在 zh 改名字 ⟹ 只有 name.zh 变', JSON.stringify(nameAfter));
  check(readRoot('zh').brandName === '北区汽修' && readRoot('en').brandName === nameBefore.en, '读回：zh 是新名字、en 还是原名字');
  check(readRoot('fr').brandName === (nameBefore.fr ?? nameBefore.en), 'fr 没有自己那一格时读回默认语言那一格（同 getBrandName）', readRoot('fr').brandName);
  { const l = readRoot('zh').locations; r = tryWrite({ locations: [{ ...l[0], phone: '(416) 555-0777' }, ...l.slice(1)] }, 'zh'); }
  check(!r.code && ['en', 'fr', 'zh'].every((l) => readRoot(l).locations[0].phone === '(416) 555-0777'), '在 zh 改电话 ⟹ 三种语言读回同一个号码');
  check(localeBrandFiles(path.join(TEMPLATE, 'site')).length === 0, '语言目录下没有冒出 brand.json');

  // 老站：name 还是字符串 ⟹ 改 zh 名字变成 {en: 原名字, zh: 新名字}
  freshSite();
  setBrand((b) => { b.name = 'Legacy Garage'; });
  check(readRoot('zh').brandName === 'Legacy Garage', '老站（字符串名字）读回那个字符串');
  r = tryWrite({ brandName: '老车行' }, 'zh');
  check(!r.code && JSON.stringify(readBrand().name) === JSON.stringify({ en: 'Legacy Garage', zh: '老车行' }), '老站改 zh 名字 ⟹ {en: 原名字, zh: 新名字}', JSON.stringify(readBrand().name));

  // 扁平老站：名字写进默认语言（en）那一格
  freshSite((s) => {
    for (const l of ['fr', 'zh']) fs.rmSync(path.join(s, l), { recursive: true });
    for (const e of fs.readdirSync(path.join(s, 'en'))) fs.renameSync(path.join(s, 'en', e), path.join(s, e));
    fs.rmSync(path.join(s, 'en'), { recursive: true });
    fs.rmSync(path.join(s, 'site_meta.json'));
  });
  r = tryWrite({ brandName: 'Flat Renamed' }, 'en');
  check(!r.code && readBrand().name.en === 'Flat Renamed' && readRoot('en').brandName === 'Flat Renamed', '扁平站：名字写进 name.en、读得回来', JSON.stringify(readBrand().name));

  // 容器里那一步：地址变了 ⟹ 写完重查坐标写回同一份 brand.json；查不到 ⟹ 删旧坐标；两种都是保存成功。
  // 网络用预加载脚本替掉（--require），不真发请求。
  const stubDir = fs.mkdtempSync(path.join(os.tmpdir(), 'editor-root-geo-'));
  temps.push(stubDir);
  const stub = (body) => { const f = path.join(stubDir, `stub-${Math.random().toString(36).slice(2)}.js`); fs.writeFileSync(f, body); return { NODE_OPTIONS: `--require ${f}` }; };
  const hitEnv = stub(`globalThis.__geoCalls = 0; globalThis.fetch = async () => { require('fs').appendFileSync(${JSON.stringify(path.join(stubDir, 'calls'))}, 'x'); return { ok: true, json: async () => [{ lat: '43.6487', lon: '-79.3817', address: { city: 'Toronto', road: 'Bay Street', house_number: '200', postcode: 'M5J 2J1' } }] }; };`);
  const missEnv = stub(`globalThis.fetch = async () => { require('fs').appendFileSync(${JSON.stringify(path.join(stubDir, 'calls'))}, 'x'); throw new Error('network down'); };`);
  const calls = () => (fs.existsSync(path.join(stubDir, 'calls')) ? fs.readFileSync(path.join(stubDir, 'calls'), 'utf-8').length : 0);

  freshSite();
  setBrand((b) => { firstWithGeo(b); b.locations[1] = SECOND; });
  // #1980 —— 地址住在 `locations` 里：交整份，第一家换地址。
  const withFirst = (patch) => { const l = readRoot('en').locations; return { root: { locations: [{ ...l[0], ...patch }, ...l.slice(1)] } }; };
  let s = runScript({ page: 'home', locale: 'en' }, withFirst({ address: '200 Bay St, Toronto, ON' }), hitEnv);
  let b = readBrand();
  check(s.status === 0 && s.last && s.last.ok && JSON.stringify(s.last.files) === JSON.stringify(['site/brand.json']), '只改地址 ⟹ 成功、files 只有 site/brand.json', `${s.status} ${s.stdout} ${s.stderr}`);
  check(b.locations[0].address === '200 Bay St, Toronto, ON' && b.locations[0].geo && b.locations[0].geo.lat === 43.6487 && b.locations[0].city === 'Toronto',
    '地址变了 ⟹ 查到的新坐标 / 城市写回同一份 brand.json', JSON.stringify(b.locations[0]));
  check(JSON.stringify({ ...b.locations[1], id: undefined }) === JSON.stringify(SECOND), '查坐标那一步不碰第二家门店（只多了 id）', JSON.stringify(b.locations[1]));
  const n = calls();
  s = runScript({ page: 'home', locale: 'en' }, withFirst({ phone: '(416) 555-0900' }), hitEnv);
  check(s.status === 0 && calls() === n && JSON.stringify(readBrand().locations[0].geo) === JSON.stringify(b.locations[0].geo), '只改电话（地址没变）⟹ 一个请求都不发、坐标不动', `calls ${n}→${calls()}`);
  s = runScript({ page: 'home', locale: 'en' }, withFirst({ address: '1 Nowhere Rd', city: '' }), missEnv);
  b = readBrand();
  check(s.status === 0 && s.last && s.last.ok && b.locations[0].address === '1 Nowhere Rd' && !('geo' in b.locations[0]) && !('city' in b.locations[0]),
    '查不到（网络错）⟹ 保存照样成功、旧坐标删掉（不留一个指着老地方的钉子）', `${s.status} ${JSON.stringify(b.locations[0])} ${s.stderr}`);
}

// ══ ⑩ #1759 / #1787 顶栏按钮 + logo：0–3 颗、每颗名字和链接都不许空、navigation.json 别的键一个字节不动 ══════
console.log('⑩ 顶栏按钮 / logo（#1759 · #1787）');
{
  freshSite();
  const site = path.join(TEMPLATE, 'site');
  const navFile = path.join(site, 'en', 'navigation.json');
  const navOf = () => JSON.parse(fs.readFileSync(navFile, 'utf-8'));
  const nav0 = navOf();
  check(Array.isArray(nav0.header.buttons) && nav0.header.buttons.length === 1 && !('cta' in nav0.header) && !('ctaSecondary' in nav0.header),
    '前提：夹具站 header.buttons 1 颗、没有 cta / ctaSecondary（同 create-site 的新站）', JSON.stringify(nav0.header));
  check(JSON.stringify(readRoot('en').headerButtons) === JSON.stringify(nav0.header.buttons), '读回来就是那 1 颗');
  let before = snapshot(site);
  let r = tryWrite({ headerButtons: [{ label: '  ', href: '/contact' }] }, 'en');
  check(r.code === editorRoot.REFUSED && /header button needs both a name and a link/.test(r.message) && changedFiles(before, snapshot(site)).length === 0,
    '唯一那颗文字清空 ⟹ 拒、什么都没写', r.message);
  r = tryWrite({ headerButtons: [{ label: 'Go', href: '/go' }, { label: 'Go', href: '' }] }, 'en');
  check(r.code === editorRoot.REFUSED && /Header button 2 needs both a name and a link/.test(r.message) && changedFiles(before, snapshot(site)).length === 0,
    '第 2 颗链接清空 ⟹ 拒、话里点第几颗、什么都没写', r.message);
  r = tryWrite({ headerButtons: [{ label: '', href: { source: 'email' } }] }, 'en');
  check(r.code === editorRoot.REFUSED, '只有引用、没有文字 ⟹ 拒（引用不算空链接，但文字是空的）', r.message);
  r = tryWrite({ headerButtons: ['a', 'b', 'c', 'd'].map((x) => ({ label: x, href: `/${x}` })) }, 'en');
  check(r.code === editorRoot.REFUSED && /up to 3 buttons/.test(r.message) && changedFiles(before, snapshot(site)).length === 0, '4 颗 ⟹ 拒「up to 3」', r.message);
  r = tryWrite({ headerButtons: [{ label: 'Go', href: '/x', style: 'solid' }] }, 'en');
  check(r.code === 5, '按钮对象带了别的键 ⟹ 形状不对（5）', JSON.stringify(r));
  r = tryWrite({ headerButtons: { label: 'Go', href: '/x' } }, 'en');
  check(r.code === 5, 'headerButtons 不是数组 ⟹ 形状不对（5）', JSON.stringify(r));
  // #1779 —— 按钮链接可以是电话 / 邮箱引用（按钮弹窗选 Phone / Email 存的那种）；源不认识、多余的键 ⟹ 形状不对。
  r = tryWrite({ headerButtons: [{ label: 'Go', href: { source: 'address' } }] }, 'en');
  check(r.code === 5, '按钮链接引用了按钮不收的源（address）⟹ 形状不对（5）', JSON.stringify(r));
  r = tryWrite({ headerButtons: [{ label: 'Go', href: { source: 'phone', extra: 1 } }] }, 'en');
  check(r.code === 5, '按钮链接引用带了多余的键 ⟹ 形状不对（5）', JSON.stringify(r));
  check(changedFiles(before, snapshot(site)).length === 0, '上面几次拒收：什么都没写');
  // 3 颗、含一个引用、顺序照交上来的：只变 header.buttons，navigation.json 别的键一个字节不动。
  const three = [{ label: ' Get a quote ', href: '/contact' }, { label: 'Call us', href: { source: 'phone' } }, { label: 'Book online', href: 'https://book.example.com' }];
  r = tryWrite({ headerButtons: three }, 'en');
  const nav1 = navOf();
  check(!r.code && JSON.stringify(nav1.header.buttons) === JSON.stringify([{ label: 'Get a quote', href: '/contact' }, three[1], three[2]]),
    '3 颗 ⟹ header.buttons 3 项、顺序同交上来的、去首尾空格、引用原样', `${JSON.stringify(r)} ${JSON.stringify(nav1.header)}`);
  const rest = (n) => { const c = JSON.parse(JSON.stringify(n)); delete c.header.buttons; return JSON.stringify(c); };
  check(rest(nav1) === rest(nav0), 'navigation.json 别的键（菜单、页脚）一个字节不动');
  check(JSON.stringify(readRoot('en').headerButtons[1]) === JSON.stringify({ label: 'Call us', href: { source: 'phone' } }), '读回来引用还是引用（编辑器打开时按钮弹窗认它）');
  // 0 颗：老板删光了 ⟹ 照写空列表（= 不要按钮），不拒。
  r = tryWrite({ headerButtons: [] }, 'en');
  check(!r.code && JSON.stringify(navOf().header.buttons) === '[]' && rest(navOf()) === rest(nav0), '0 颗 ⟹ header.buttons = []，别的键不动', JSON.stringify(navOf().header));
  r = tryWrite({ headerButtons: nav0.header.buttons }, 'en');
  check(!r.code && JSON.stringify(navOf()) === JSON.stringify(nav0), '改回原来那 1 颗 ⟹ 文件回到原样', JSON.stringify(navOf().header));
  // logo：写地址、清空 = 删键。
  r = tryWrite({ logoUrl: '/images/my-logo.png' }, 'en');
  check(!r.code && JSON.parse(fs.readFileSync(path.join(site, 'brand.json'), 'utf-8')).logoUrl === '/images/my-logo.png', '换 logo ⟹ brand.json 的 logoUrl 是那张图');
  r = tryWrite({ logoUrl: '' }, 'en');
  check(!r.code && !('logoUrl' in JSON.parse(fs.readFileSync(path.join(site, 'brand.json'), 'utf-8'))), 'logo 清空 ⟹ logoUrl 这个键删掉（顶栏画名字）');
  // #1784 r7 —— 写 logo 不碰 logoHasWordmark（r6 的「换上新图 ⟹ 置 true」已删：编辑器里换图只在 Logo 子页的 Image 下，
  //   换的那一下把 headerOptions.logoType 存成 image，用不着这一格定默认）。logo 没动 / 换图 / 清空 ⟹ 都不碰它。
  //   起点照「AI 生成图标 logo 的站」手写：logoUrl='/logo.png' + logoHasWordmark=false（skipAI 站造不出这个状态，PM r3 裁定第 1 条）。
  const brandPath = path.join(site, 'brand.json');
  const brandOf = () => JSON.parse(fs.readFileSync(brandPath, 'utf-8'));
  const brand0 = fs.readFileSync(brandPath, 'utf-8');
  fs.writeFileSync(brandPath, `${JSON.stringify({ ...brandOf(), logoUrl: '/logo.png', logoHasWordmark: false }, null, 2)}\n`);
  r = tryWrite({ brandName: `${readRoot('en').brandName} Co` }, 'en');
  check(!r.code && brandOf().logoHasWordmark === false && brandOf().logoUrl === '/logo.png',
    '#1784 验收 0：logo 没动、只改了店名存一次 ⟹ logoHasWordmark 仍是 false', JSON.stringify(brandOf()));
  r = tryWrite({ logoUrl: '/logo.png' }, 'en');
  check(!r.code && brandOf().logoHasWordmark === false, '#1784 验收 0：logoUrl 原样再写一遍（每次存盘都带着它）⟹ 仍是 false', JSON.stringify(brandOf()));
  r = tryWrite({ logoUrl: '/images/uploaded-logo.png' }, 'en');
  check(!r.code && brandOf().logoHasWordmark === false && brandOf().logoUrl === '/images/uploaded-logo.png',
    '#1784 r7：换一张新 logo ⟹ logoHasWordmark 不碰（false 仍是 false）', JSON.stringify(brandOf()));
  fs.writeFileSync(brandPath, `${JSON.stringify({ ...brandOf(), logoHasWordmark: false }, null, 2)}\n`);
  r = tryWrite({ logoUrl: '' }, 'en');
  check(!r.code && !('logoUrl' in brandOf()) && brandOf().logoHasWordmark === false, '#1784 验收 0：清空 logo ⟹ logoHasWordmark 不变（false 仍是 false）', JSON.stringify(brandOf()));
  fs.writeFileSync(brandPath, brand0);
  // 坏链接：容器里那一步（§commitWrites 的链接判据）拒，原话点名那颗按钮。
  before = snapshot(site);
  const s1 = runScript({ page: 'home', locale: 'en' }, { root: { headerButtons: [{ label: 'Book', href: '/contact' }, { label: 'Go', href: 'javascript:alert(1)' }] } });
  check(s1.status === 11 && s1.last && s1.last.ok === false && /Go/.test(s1.last.message) && changedFiles(before, snapshot(site)).length === 0,
    '第 2 颗按钮链接是 javascript: ⟹ exit 11、一句给老板的话（点名那颗按钮）、什么都没写', `${s1.status} ${s1.stdout}`);
}

// ══ ⑪ #1785 Social links：一律写成数组、网址空的那一行不存、全空 = 删键、坏网址拒收、两种老形状都读成数组 ══════
console.log('⑪ Social links（#1785）');
{
  freshSite();
  const site = path.join(TEMPLATE, 'site');
  const brandFile = path.join(site, 'brand.json');
  const brandOf = () => JSON.parse(fs.readFileSync(brandFile, 'utf-8'));
  const b0 = brandOf();
  // 老形状（对象）读成数组
  fs.writeFileSync(brandFile, JSON.stringify({ ...b0, socialLinks: { Facebook: 'https://facebook.com/a', yelp: 'https://yelp.com/b' } }, null, 2) + '\n');
  check(JSON.stringify(readRoot('en').socialLinks) === JSON.stringify([{ platform: 'facebook', url: 'https://facebook.com/a' }, { platform: 'yelp', url: 'https://yelp.com/b' }]),
    '老形状 {platform: url} ⟹ 读回数组、平台名小写', JSON.stringify(readRoot('en').socialLinks));
  // 写：数组、去掉网址空的那一行、去首尾空格、顺序照面板
  let r = tryWrite({ socialLinks: [{ platform: 'instagram', url: ' https://instagram.com/n ' }, { platform: 'facebook', url: '' }, { platform: 'x', url: 'https://x.com/n' }] }, 'en');
  check(!r.code && JSON.stringify(brandOf().socialLinks) === JSON.stringify([{ platform: 'instagram', url: 'https://instagram.com/n' }, { platform: 'x', url: 'https://x.com/n' }]),
    '写成数组：网址空的那一行不存、去首尾空格、顺序照面板', `${JSON.stringify(r)} ${JSON.stringify(brandOf().socialLinks)}`);
  const rest = (b) => { const c = { ...b }; delete c.socialLinks; return JSON.stringify(c); };
  check(rest(brandOf()) === rest(b0), 'brand.json 别的键一个字节不动');
  // 坏网址 / 坏形状
  let before = snapshot(site);
  r = tryWrite({ socialLinks: [{ platform: 'facebook', url: 'javascript:alert(1)' }] }, 'en');
  check(r.code === editorRoot.REFUSED && /not a web address/.test(r.message) && changedFiles(before, snapshot(site)).length === 0, '网址是 javascript: ⟹ 拒、一句给老板的话、什么都没写', r.message);
  r = tryWrite({ socialLinks: [{ platform: 'facebook', url: 'facebook.com/n' }] }, 'en');
  check(r.code === editorRoot.REFUSED && changedFiles(before, snapshot(site)).length === 0, '没写协议 ⟹ 拒（面板离开那一格会补 https://，这里不替它猜）', r.message);
  r = tryWrite({ socialLinks: [{ platform: 'Face Book', url: 'https://facebook.com/n' }] }, 'en');
  check(r.code === 5, '平台名不是小写图标名那种形状 ⟹ 形状不对（5）', JSON.stringify(r));
  r = tryWrite({ socialLinks: [{ platform: 'facebook', url: 'https://facebook.com/n', label: 'x' }] }, 'en');
  check(r.code === 5, '多一个键 ⟹ 形状不对（5）', JSON.stringify(r));
  r = tryWrite({ socialLinks: Array.from({ length: 13 }, (_, i) => ({ platform: 'facebook', url: `https://facebook.com/${i}` })) }, 'en');
  check(r.code === editorRoot.REFUSED && /at most 12/.test(r.message), '13 条 ⟹ 拒（最多 12）', r.message);
  // 全删 = 删键
  r = tryWrite({ socialLinks: [] }, 'en');
  check(!r.code && !('socialLinks' in brandOf()), '一条都不剩 ⟹ brand.json 里没有 socialLinks 这个键', JSON.stringify(brandOf().socialLinks));
}

// ══ #1781 验收 6：多语言站的菜单各自一份 —— 在 zh 改菜单只写 zh/navigation.json；构建后 zh 那份照旧、en / fr 没动；zh 的站内链接带 /zh ══
console.log('#1781 多语言站：菜单各自一份');
{
  freshSite();
  const site = path.join(TEMPLATE, 'site');
  const navOf = (l) => JSON.parse(fs.readFileSync(path.join(site, l, 'navigation.json'), 'utf-8'));
  const enBefore = navOf('en').header.links;
  const frBefore = navOf('fr').header.links;
  const before = snapshot(site);
  const zhMenu = [{ label: '首页', href: '/' }, { label: '联系我们', href: '/contact' }, { label: '打电话', href: { source: 'phone' } }];
  const r = tryWrite({ headerLinks: zhMenu }, 'zh');
  check(!r.code && JSON.stringify(changedFiles(before, snapshot(site))) === JSON.stringify(['zh/navigation.json']), '在 zh 改菜单 ⟹ 只写 zh/navigation.json', `${JSON.stringify(r)} ${JSON.stringify(changedFiles(before, snapshot(site)))}`);
  check(JSON.stringify(readRoot('zh').headerLinks) === JSON.stringify(zhMenu) && JSON.stringify(readRoot('en').headerLinks) === JSON.stringify(enBefore),
    '读回：zh 是新菜单（电话引用原样）、en 是原来那一份');
  const b = cp.spawnSync(process.execPath, [path.join(TEMPLATE, 'scripts', 'sync-config.js')], { cwd: TEMPLATE, encoding: 'utf8', timeout: 180000 });
  check(b.status === 0, '构建 rc=0', (b.stderr || '').slice(-300));
  check(JSON.stringify(navOf('zh').header.links) === JSON.stringify(zhMenu) && JSON.stringify(navOf('zh').footer.columns[0].links) === JSON.stringify(zhMenu),
    '构建后 zh 菜单照旧、zh 页脚第一列 = zh 菜单', JSON.stringify(navOf('zh').header.links));
  check(JSON.stringify(navOf('en').header.links) === JSON.stringify(enBefore) && JSON.stringify(navOf('fr').header.links) === JSON.stringify(frBefore), 'en / fr 的菜单没被动');
  const { shellDataFor } = require(path.join(TEMPLATE, 'scripts', 'lib', 'shell-data.js'));
  const zhShell = shellDataFor({ nav: navOf('zh'), brand: {}, brandName: 'x', services: [], pages: [], locale: 'zh', defaultLocale: 'en' });
  check(JSON.stringify(zhShell.header.nav) === JSON.stringify([{ label: '首页', href: '/zh' }, { label: '联系我们', href: '/zh/contact' }, { label: '打电话', href: { source: 'phone' } }]),
    'zh 顶栏派生：站内链接按语言加 /zh，电话引用原样（渲染前展开）', JSON.stringify(zhShell.header.nav));
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail > 0 ? 1 : 0);
