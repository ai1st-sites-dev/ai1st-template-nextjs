#!/usr/bin/env node
/**
 * dress-site-in-theme.test.js — #1121 r2：把「给样例站上色」那两半钉在一起。
 *
 *   node scripts/lib/dress-site-in-theme.test.js   （`npm run test:scripts` 自动发现它）
 *   退出码: 0 全过 · 1 有失败 · 2 跑不起来（**不许当成通过**）
 *
 * ── 为什么要有它 ────────────────────────────────────────────────────────────────────────────────
 * #1121 撤掉了构建期那处「注册表盖 brand.json」之后，「给一个站换主题」这个动作有了两半（写
 * theme.json + 写 brand.json）。当天全仓有三个工具在自己动手做这件事，**三个都只做了前一半**：
 * `theme-css-invariants-all-sheets.sh`（交付时发现，83 张表全落在同一套调色板上）、
 * `theme-gallery/shoot-themes.sh` 和 `theme-gallery/check-controls.sh`（QA1 在 r1 上找到）。
 * 三处现在共用 `dress-site-in-theme.js`，而这份测试守的是那个共用件本身：
 *
 *   · 三个键写对了，**而且别的键没被动**（brand.json 里还有站名、logo、地址、表单 id）
 *   · 失败时**一个字节都不写** —— 上色做了一半的站长得跟「代码坏了」一模一样
 *   · 写的就是 colors / fonts / settings 三个键，不多不少（`worker/main.go` 的 §write 写的是
 *     这三个；哪天这里多写一个，那边就得跟着改，否则样例站上量到的不再是真站上会发生的）
 *
 * 🔴 每一格都配了区分力：夹具主题的颜色跟站原来的颜色**故意不同**，所以一个什么都不写的实现
 *    过不了；「设置要删掉」那一格的站**本来有** settings。
 */

'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');

const mod = require('./dress-site-in-theme.js');
const { dressSiteInTheme, DEFAULT_REGISTRY } = mod;

let pass = 0, fail = 0;
const ok = (m) => { pass++; console.log(`  ✅ ${m}`); };
const bad = (m) => { fail++; console.log(`  ❌ ${m}`); };
const die = (m) => { console.error(`🔴 跑不起来: ${m}`); process.exit(2); };

if (typeof dressSiteInTheme !== 'function') die('dress-site-in-theme.js 没导出 dressSiteInTheme');

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'dress-'));

// ── 夹具 ────────────────────────────────────────────────────────────────────────────────────────
// 站原来穿的颜色/字体跟夹具主题的**故意不一样**，这一点是承重的：两者相同的话，「写了新调色板」
// 和「什么都没写」两种实现产物一样，这份测试就没有区分力了（#1121 正文 AC2 那条同款纪律）。
const SITE_COLORS = { primary: { 500: '#111111' }, accent: { 500: '#222222' } };
const THEME_COLORS = { primary: { 500: '#aaaaaa' }, accent: { 500: '#bbbbbb' } };

function makeRegistry(themes) {
  const p = path.join(fs.mkdtempSync(path.join(TMP, 'reg-')), 'themes.js');
  fs.writeFileSync(p, 'module.exports = { themes: ' + JSON.stringify(themes) + ' };\n');
  return p;
}
function makeSite(brandExtra = {}) {
  const dir = fs.mkdtempSync(path.join(TMP, 'site-'));
  fs.writeFileSync(path.join(dir, 'brand.json'), JSON.stringify({
    name: { en: 'Northside Auto Care' },
    logoIcon: 'wrench',
    email: 'hi@example.com',
    colors: SITE_COLORS,
    fonts: { heading: ['Old Heading'], body: ['Old Body'], googleFontsUrl: 'https://old' },
    ...brandExtra,
  }, null, 2) + '\n');
  return dir;
}
const readJson = (p) => JSON.parse(fs.readFileSync(p, 'utf-8'));

const REG = makeRegistry({
  'fixture-full': {
    colors: THEME_COLORS,
    fonts: { heading: ['New Heading'], body: ['New Body'], googleFontsUrl: 'https://new' },
    settings: { radius: 'sharp', density: 'compact' },
  },
  'fixture-no-settings': {
    colors: THEME_COLORS,
    fonts: { heading: ['New Heading'], body: ['New Body'], googleFontsUrl: 'https://new' },
  },
});

// ── ① 两半都做了，而且别的键没被动 ──────────────────────────────────────────────────────────────
{
  const site = makeSite();
  const r = dressSiteInTheme({ siteDir: site, themeId: 'fixture-full', registryPath: REG });
  const meta = readJson(path.join(site, 'theme.json'));
  const brand = readJson(path.join(site, 'brand.json'));

  if (meta.themeId === 'fixture-full' && meta.applied === true) ok('theme.json 写的是 { themeId, applied: true }');
  else bad(`theme.json 不对：${JSON.stringify(meta)}`);

  if ('css' in meta) bad('没传表名却写了 `css` 键 —— 那会改变被拍到的东西（#991：css 跟 applied 是两码事）');
  else ok('没传表名 ⟹ theme.json 里没有 `css` 键');

  if (JSON.stringify(brand.colors) === JSON.stringify(THEME_COLORS)) ok('brand.json 的 colors 换成了这套主题的');
  else bad(`brand.json 的 colors 是 ${JSON.stringify(brand.colors)}，不是主题那套`);

  if (brand.fonts && brand.fonts.googleFontsUrl === 'https://new') ok('brand.json 的 fonts 换成了这套主题的');
  else bad(`brand.json 的 fonts 是 ${JSON.stringify(brand.fonts)}`);

  if (brand.settings && brand.settings.radius === 'sharp') ok('brand.json 的 settings 换成了这套主题的');
  else bad(`brand.json 的 settings 是 ${JSON.stringify(brand.settings)}`);

  // 🔴 这一格是「上色不许顺手改别的」：站名 / logo / 邮箱是这个站自己的东西，主题无权动它们。
  if (brand.name && brand.name.en === 'Northside Auto Care' && brand.logoIcon === 'wrench' && brand.email === 'hi@example.com')
    ok('brand.json 里站自己的键（name / logoIcon / email）一个都没被动');
  else bad(`brand.json 里站自己的键被动过了：${JSON.stringify({ name: brand.name, logoIcon: brand.logoIcon, email: brand.email })}`);

  // 写了哪几个键，声明在返回值里 —— 三处调用方和 worker 的 §write 是同一份契约。
  if (JSON.stringify(r.keys) === JSON.stringify(['colors', 'fonts', 'settings']))
    ok('写的就是 colors / fonts / settings 三个键，不多不少（跟 worker/main.go §write 同一份契约）');
  else bad(`写的键是 ${JSON.stringify(r.keys)} —— 跟 worker 那一步对不上，样例站上量到的就不再是真站上会发生的`);
}

// ── ② 表名传进来才写 `css` ──────────────────────────────────────────────────────────────────────
{
  const site = makeSite();
  dressSiteInTheme({ siteDir: site, themeId: 'fixture-full', css: 'sheet-77', registryPath: REG });
  const meta = readJson(path.join(site, 'theme.json'));
  if (meta.css === 'sheet-77') ok('传了表名 ⟹ theme.json 里 `css` 就是它');
  else bad(`传了表名却没写进去：${JSON.stringify(meta)}`);
}

// ── ③ 主题没有 settings ⟹ 把站上那份【删掉】，不是留着 ────────────────────────────────────────
// 留着的后果具体：页面会拿上一套主题的圆角 / 留白 / 按钮形状去配这一套的颜色，
// 一个真站不可能是这个组合。
{
  const site = makeSite({ settings: { radius: 'round', density: 'airy' } });
  const r = dressSiteInTheme({ siteDir: site, themeId: 'fixture-no-settings', registryPath: REG });
  const brand = readJson(path.join(site, 'brand.json'));
  if (!('settings' in brand)) ok('主题没有 settings ⟹ 站上那份被删掉了（不是留着上一套的档位）');
  else bad(`主题没有 settings，站上却还留着 ${JSON.stringify(brand.settings)}`);
  if (r.keys.includes('settings(删掉)')) ok('返回值里说清了 settings 是被删掉的');
  else bad(`返回值没说 settings 被删掉：${JSON.stringify(r.keys)}`);
}

// ── ④ 三种失败都在动笔之前，theme.json 一个字节都不写 ───────────────────────────────────────────
// 🔴 这一组的区分力在「theme.json 还在不在」：先写 theme.json 再检查的实现会留下一个
//    「theme.json 说新主题、brand.json 说旧主题」的站 —— 那正是 #1121 要根除的那种分歧。
{
  // ④a 注册表里没这套主题
  const site = makeSite();
  let threw = null;
  try { dressSiteInTheme({ siteDir: site, themeId: 'no-such-theme', registryPath: REG }); }
  catch (e) { threw = e; }
  const wroteTheme = fs.existsSync(path.join(site, 'theme.json'));
  const brandStill = JSON.stringify(readJson(path.join(site, 'brand.json')).colors) === JSON.stringify(SITE_COLORS);
  if (threw && !wroteTheme && brandStill) ok('主题查不到 ⟹ 抛错，theme.json 没建、brand.json 没动');
  else bad(`主题查不到时的行为不对：threw=${!!threw} theme.json=${wroteTheme} brand 原样=${brandStill}`);

  // ④b brand.json 不在（这个站还不是一个能构建的站）
  const bare = fs.mkdtempSync(path.join(TMP, 'bare-'));
  threw = null;
  try { dressSiteInTheme({ siteDir: bare, themeId: 'fixture-full', registryPath: REG }); }
  catch (e) { threw = e; }
  if (threw && !fs.existsSync(path.join(bare, 'theme.json'))) ok('brand.json 不在 ⟹ 抛错，theme.json 也没建');
  else bad(`brand.json 不在时的行为不对：threw=${!!threw} theme.json=${fs.existsSync(path.join(bare, 'theme.json'))}`);

  // ④c brand.json 不是 JSON
  const broken = fs.mkdtempSync(path.join(TMP, 'broken-'));
  fs.writeFileSync(path.join(broken, 'brand.json'), '{ this is not json');
  threw = null;
  try { dressSiteInTheme({ siteDir: broken, themeId: 'fixture-full', registryPath: REG }); }
  catch (e) { threw = e; }
  if (threw && !fs.existsSync(path.join(broken, 'theme.json'))) ok('brand.json 读不成 JSON ⟹ 抛错，theme.json 也没建');
  else bad(`brand.json 坏了时的行为不对：threw=${!!threw} theme.json=${fs.existsSync(path.join(broken, 'theme.json'))}`);
}

// ── ⑤ 接线：不传 registryPath 时，它读的是真的那份 `scripts/themes.js` ─────────────────────────
// 🔴 上面四组全用夹具注册表 —— 那些格子对「默认路径指错地方」按构造是盲的，而三个调用方用的
//    正是默认路径。所以这一格拿真注册表里的第一套主题真跑一次。
{
  if (!fs.existsSync(DEFAULT_REGISTRY)) {
    bad(`默认注册表路径不存在：${DEFAULT_REGISTRY}`);
  } else {
    const { themes } = require(DEFAULT_REGISTRY);
    const ids = Object.keys(themes);
    if (!ids.length) {
      die(`真注册表里一套主题都没有（${DEFAULT_REGISTRY}）—— 这一格问不出东西`);
    }
    const id = ids[0];
    const site = makeSite();
    dressSiteInTheme({ siteDir: site, themeId: id });          // 不传 registryPath
    const brand = readJson(path.join(site, 'brand.json'));
    if (JSON.stringify(brand.colors) === JSON.stringify(themes[id].colors))
      ok(`不传注册表路径 ⟹ 读的是真的 scripts/themes.js（拿 "${id}" 真跑过）`);
    else bad(`默认注册表那一格不对：brand.colors 不等于 themes["${id}"].colors`);
  }
}

// ── ⑥ #1873 内存版 dressContentInTheme：逐条对 worker §themeWriteCommand 的规矩 ─────────────────────────
// 🔴 每一格都是「改了 / 没改」两臂都有读数的：承接的键在前一份里**本来就有**、要被换掉的键新旧**故意不同**。
{
  const { dressContentInTheme } = mod;
  if (typeof dressContentInTheme !== 'function') die('dress-site-in-theme.js 没导出 dressContentInTheme');
  // 主题表那一侧：fixture-full 有自己的表，fixture-no-settings 没有。
  const root = fs.mkdtempSync(path.join(TMP, 'root-'));
  fs.mkdirSync(path.join(root, 'public', 'themes'), { recursive: true });
  fs.writeFileSync(path.join(root, 'public', 'themes', 'fixture-full.css'), '/* sheet */\n');
  const opts = { registryPath: REG, rootDir: root };
  const brand = { name: { en: 'Northside' }, colors: SITE_COLORS, fonts: { heading: ['Old'] }, settings: { radius: 'round' } };
  const prev = {
    themeId: 'fixture-no-settings', applied: false, css: 'old-sheet',
    tweaks: { hueShift: 6, radiusScale: 1, densityScale: 1 }, presets: { palette: 'ocean', corners: 'sharp' },
    regionLayout: { header: 'slim' }, regionOptions: { header: { bg: 'dark' } }, colorScheme: 'dark',
  };
  const frozen = JSON.stringify({ prev, brand });

  // ⑥a 换主题
  const a = dressContentInTheme({ theme: prev, brand }, { themeId: 'fixture-full' }, opts);
  if (a.theme.themeId === 'fixture-full' && a.theme.applied === true) ok('内存版：换主题 ⟹ themeId 换、applied: true');
  else bad(`内存版换主题 theme.json：${JSON.stringify(a.theme)}`);
  if (JSON.stringify(a.theme.tweaks) === JSON.stringify(prev.tweaks) && a.theme.colorScheme === 'dark'
    && JSON.stringify(a.theme.presets) === JSON.stringify({ palette: 'ocean', corners: 'sharp' })) ok('内存版：tweaks / presets / colorScheme 原样承接');
  else bad(`内存版没承接老板调的：${JSON.stringify(a.theme)}`);
  if (a.theme.css === 'fixture-full') ok('内存版：新主题有自己的表 ⟹ css 换成它的');
  else bad(`内存版 css=${a.theme.css}，要 fixture-full`);
  if (!('regionLayout' in a.theme) && !('regionOptions' in a.theme)) ok('内存版：真换主题 ⟹ regionLayout / regionOptions 丢掉（#1405 / #1738）');
  else bad(`内存版真换主题还带着页头页脚样式：${JSON.stringify(a.theme)}`);
  if (JSON.stringify(a.brand.colors) === JSON.stringify(THEME_COLORS) && a.brand.settings.radius === 'sharp'
    && a.brand.name.en === 'Northside' && JSON.stringify(a.keys) === JSON.stringify(['colors', 'fonts', 'settings'])) ok('内存版：brand.json 三个键换成主题的，站名留着');
  else bad(`内存版 brand.json：${JSON.stringify(a.brand)} keys=${a.keys}`);
  if (JSON.stringify({ prev, brand }) === frozen) ok('内存版：传进来的对象一个字节没动');
  else bad('内存版改了调用方的对象');

  // ⑥b 换到一套没有表的主题 ⟹ 老的 css 留着（worker 同款：不丢）
  const b = dressContentInTheme({ theme: { ...prev, themeId: 'fixture-full' }, brand }, { themeId: 'fixture-no-settings' }, opts);
  if (b.theme.css === 'old-sheet' && !('settings' in b.brand)) ok('内存版：新主题没有表 ⟹ css 原样留着；主题没 settings ⟹ brand.settings 删掉');
  else bad(`内存版没表那一支：css=${b.theme.css} settings=${JSON.stringify(b.brand.settings)}`);

  // ⑥c Customize：不给 themeId
  const c = dressContentInTheme({ theme: prev, brand }, { tweaks: { hueShift: -9, radiusScale: 1, densityScale: 1 }, presets: { corners: '', fonts: 'modern' }, colorScheme: 'auto' }, opts);
  if (c.theme.themeId === prev.themeId && c.theme.applied === false && JSON.stringify(c.brand) === JSON.stringify(brand) && c.keys.length === 0)
    ok('内存版：Customize ⟹ themeId / applied 不动，brand.json 一个键不动');
  else bad(`内存版 Customize 动了不该动的：${JSON.stringify(c.theme)} keys=${c.keys}`);
  if (c.theme.tweaks.hueShift === -9 && JSON.stringify(c.theme.presets) === JSON.stringify({ palette: 'ocean', fonts: 'modern' })
    && c.theme.colorScheme === 'auto' && c.theme.regionLayout && c.theme.regionOptions)
    ok('内存版：tweaks 整组换、presets 按组合并（空串 = 清掉那组）、colorScheme 换、页头页脚样式留着');
  else bad(`内存版 Customize：${JSON.stringify(c.theme)}`);
  const n = dressContentInTheme({ theme: prev, brand }, { tweaks: { hueShift: 0, radiusScale: 1, densityScale: 1 } }, opts);
  if (!('tweaks' in n.theme)) ok('内存版：中性的 tweaks ⟹ 整个键删掉');
  else bad(`内存版中性 tweaks 还留着：${JSON.stringify(n.theme.tweaks)}`);

  // ⑥d 穿回同一套主题 ⟹ 页头页脚样式留着（#1405 Chris 2026-09-24）
  const d = dressContentInTheme({ theme: prev, brand }, { themeId: 'fixture-no-settings' }, opts);
  if (d.theme.regionLayout && d.theme.regionOptions) ok('内存版：穿回同一套 ⟹ regionLayout / regionOptions 留着');
  else bad(`内存版穿回同一套丢了页头页脚样式：${JSON.stringify(d.theme)}`);

  // ⑥e 拒收
  let threw = null;
  try { dressContentInTheme({ theme: prev, brand }, { themeId: 'nope' }, opts); } catch (e) { threw = e; }
  if (threw && /没有主题 "nope"/.test(threw.message)) ok('内存版：注册表里没有的主题 ⟹ 抛错');
  else bad(`内存版没拒未知主题：${threw && threw.message}`);
  threw = null;
  try { dressContentInTheme({ theme: prev }, { themeId: 'fixture-full' }, opts); } catch (e) { threw = e; }
  if (threw) ok('内存版：没有 brand.json ⟹ 抛错');
  else bad('内存版没有 brand.json 也算出来了');
}

// ── ⑦ #1873 `site.js theme`（site-editor §theme）：夹具站真跑一次，用真注册表 ───────────────────────────
{
  const { theme } = require('./site-editor.js');
  const content = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'fixtures', 'site-fixtures', 'site-bbc4ff97.json'), 'utf-8'));
  const { themes } = require(DEFAULT_REGISTRY);
  const target = Object.keys(themes).find((id) => id !== content['theme.json'].themeId);
  (async () => {
    const out = await theme({ content, themeId: target });
    const name = String(themes[target].label).split('—')[0].trim();
    if (out.summary === `Changed the theme to ${name}`) ok(`site.js theme：summary = "${out.summary}"`);
    else bad(`site.js theme summary=${out.summary}，要 Changed the theme to ${name}`);
    if (out.content['theme.json'].themeId === target && JSON.stringify(out.content['brand.json'].colors) === JSON.stringify(themes[target].colors))
      ok('site.js theme：content 里 theme.json + brand.json 都换了');
    else bad('site.js theme：theme.json / brand.json 没换对');
    if (typeof out.content['custom.css'] === 'string' && out.files.includes('custom.css') && out.files.includes('brand.json') && out.files.includes('theme.json'))
      ok(`site.js theme：并进了 contentPatchesOf（custom.css 在这一笔里；files = ${out.files.join(', ')}）`);
    else bad(`site.js theme：files=${out.files}`);
    const cust = await theme({ content, tweaks: { hueShift: -9, radiusScale: 1, densityScale: 1 } });
    if (cust.summary === 'Adjusted the theme colors' && !cust.files.includes('brand.json') && cust.content['custom.css'] !== out.content['custom.css'])
      ok('site.js theme：只调颜色 ⟹ summary = Adjusted the theme colors、brand.json 不在 files 里、custom.css 跟着变');
    else bad(`site.js theme Customize：summary=${cust.summary} files=${cust.files}`);
    let threw = null;
    try { await theme({ content }); } catch (e) { threw = e; }
    if (threw && threw.code === 'bad') ok('site.js theme：什么都没换 ⟹ bad');
    else bad(`site.js theme 什么都没换没拒：${threw && threw.message}`);
  })().catch((e) => bad(`site.js theme 抛了：${e.stack}`)).finally(finish);
}

// ⑦ 是异步的，收尾等它跑完。
function finish() {
  fs.rmSync(TMP, { recursive: true, force: true });
  console.log(`\n══ dress-site-in-theme: ${pass} 过 · ${fail} 失败 ══`);
  process.exit(fail ? 1 : 0);
}
