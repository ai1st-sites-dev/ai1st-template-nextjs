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

fs.rmSync(TMP, { recursive: true, force: true });
console.log(`\n══ dress-site-in-theme: ${pass} 过 · ${fail} 失败 ══`);
process.exit(fail ? 1 : 0);
