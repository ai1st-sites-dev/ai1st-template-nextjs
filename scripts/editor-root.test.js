#!/usr/bin/env node
/**
 * editor-root.test.js — #1405：编辑器外壳三样（root 字段；#1425 T3 起公告条那一样退役）存回站级文件。
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
  return editorRoot.readRootValues({ siteDir: site, localeDir: shape.flat ? site : path.join(site, locale), layoutsDir: LAYOUTS_DIR });
}
function tryWrite(root, locale) {
  try { return { files: writeRoot(root, locale) }; } catch (e) { return { code: e.code, message: e.message }; }
}

/** 跑容器里那个脚本（在站根）。 */
function runScript(loc, input) {
  const r = cp.spawnSync(process.execPath, [path.join(TEMPLATE, 'scripts', 'write-editor-save.js'), JSON.stringify(loc)], {
    cwd: TEMPLATE, input: JSON.stringify(input), encoding: 'utf8', timeout: 60000,
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
  };
}

/** 往返：每个字段各写一次（只写它自己），读回来必须等于写进去的；回点名的问题清单。 */
function roundTripProblems() {
  const problems = [];
  for (const f of ['layout', 'headerShape', 'footerShape']) {
    freshSite();
    const before = readRoot('en');
    const want = otherValues(before)[f];
    const r = tryWrite({ [f]: want }, 'en');
    if (r.code) { problems.push(`${f}（写不进去：${r.message.slice(0, 80)}）`); continue; }
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
  check(problems.length === 0, '3 个 root 字段各写一次都读得回来、不碰别的字段', problems.join(' · '));

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

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail > 0 ? 1 : 0);
