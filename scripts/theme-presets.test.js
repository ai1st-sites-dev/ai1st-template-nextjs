#!/usr/bin/env node
/**
 * theme-presets.test.js — #1038 的绝对项：库本身合不合格，以及它跟 tweaks 叠起来产出什么字节。
 *
 *   node scripts/theme-presets.test.js       （CI 里由 `npm run test:scripts` 自动发现，
 *                                              .github/workflows/ci-cd.yml 的 template-scripts）
 *   退出码: 0 全过 · 1 有失败 · 2 跑不起来（**不许当成通过**）
 *
 * ── 这里管什么、不管什么 ────────────────────────────────────────────────────────────────────────
 * 管的是**不用起浏览器就能判死的那些**：策展的可读性判据、`@import` 在不在第一行、中性输入收敛、
 * 以及「绝对项没有渗进 `TWEAK_BOUNDS`」。
 *
 * 不管「页面上量出来的对比度」—— 那要真渲染，是 `theme-css-invariants.mjs` 的活（本票同时把它的
 * 射程从 hero 两行扩到按钮和链接）。两层的分工说在明处：**这里判的是配色表本身的算术**，
 * 那里判的是**这套算术装到真页面上之后眼睛看到的东西**。只有前者会漏掉「主题表自己把按钮改成别的
 * 颜色」，只有后者跑得慢。
 *
 * 🔴 为什么策展判据要写成测试而不是写成注释：下一个人加一组配色时，「白字压 primary-500 要够黑」
 *    这件事没有任何东西会提醒他。注册表里 30 套主题有 9 套过不了这一关（本文件最后一格把这个数
 *    也量出来当分母），所以「随手抄一套好看的」是最自然的做法，也是会出事的那个做法。
 */

'use strict';

const presets = require('./theme-presets.js');
const tweaks = require('./tweaks.js');
const { RADIUS, BUTTON_SHAPE } = require('./theme-settings.js');

let pass = 0; let fail = 0;
const ok = (m) => { pass++; console.log(`  ✅ ${m}`); };
const bad = (m) => { fail++; console.log(`  ❌ ${m}`); };
const die = (m) => { console.error(`🔴 跑不起来: ${m}`); process.exit(2); };

for (const name of ['PRESET_GROUPS', 'PRESET_KEYS', 'presetOptions', 'validatePresets', 'presetVars', 'normalisePresets']) {
  if (presets[name] === undefined) die(`theme-presets.js 没导出 ${name}`);
}
if (typeof tweaks.buildCustomCss !== 'function') die('tweaks.js 没导出 buildCustomCss');

// ── 分母自检 ──────────────────────────────────────────────────────────────────────────────────
// 空表会让下面每一格都空过。先把三组各有几项打出来，读报告的人一眼看得见判的是多少个东西。
const counts = Object.entries(presets.presetOptions()).map(([k, v]) => `${k}=${v.length}`).join(' · ');
if (presets.PRESET_KEYS.length === 3 && Object.values(presets.presetOptions()).every((v) => v.length >= 3)) {
  ok(`三组预设都非空：${counts}`);
} else {
  bad(`预设组为空或少了一组（${counts}）—— 下面每一格都会空过`);
}

// ── ① 策展判据：每一组配色，三处白字/黑字都要 ≥ 4.5:1 ──────────────────────────────────────────
//
// 三处是从 globals.css 的 `@layer components` 里读出来的，不是想出来的：
//   `.btn-primary`   白字压 `--color-primary-500`（hover 走 `-600`，一起判）
//   `.btn-secondary` `--color-primary-500` 的字压白底
//   `.btn-accent`    `gray-900`(#111827) 的字压 `--color-accent-400`（hover 走 `-500`，一起判）
const MIN = 4.5;
const WHITE = '#ffffff';
const GRAY900 = '#111827';
function lin(c) { const s = c / 255; return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4; }
function lum(hex) {
  const h = hex.replace('#', '');
  return 0.2126 * lin(parseInt(h.slice(0, 2), 16))
    + 0.7152 * lin(parseInt(h.slice(2, 4), 16))
    + 0.0722 * lin(parseInt(h.slice(4, 6), 16));
}
function ratio(a, b) { const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x); return (hi + 0.05) / (lo + 0.05); }
/** 一组配色的四个承重读数。返回 [[名字, 比值], …]。 */
function buttonRatios(colors) {
  return [
    ['.btn-primary 白字压 primary-500', ratio(colors.primary['500'], WHITE)],
    ['.btn-primary:hover 白字压 primary-600', ratio(colors.primary['600'], WHITE)],
    ['.btn-secondary primary-500 的字压白底', ratio(colors.primary['500'], WHITE)],
    ['.btn-accent gray-900 的字压 accent-400', ratio(colors.accent['400'], GRAY900)],
    ['.btn-accent:hover gray-900 的字压 accent-500', ratio(colors.accent['500'], GRAY900)],
  ];
}
for (const [name, p] of Object.entries(presets.PALETTES)) {
  const rows = buttonRatios(p.colors);
  const worstRow = rows.reduce((a, b) => (b[1] < a[1] ? b : a));
  if (worstRow[1] >= MIN) {
    ok(`配色 ${name}：最差的一处是「${worstRow[0]}」= ${worstRow[1].toFixed(2)}:1（≥ ${MIN}）`);
  } else {
    bad(`配色 ${name}：「${worstRow[0]}」= ${worstRow[1].toFixed(2)}:1，低于 ${MIN}:1 —— `
      + '这一组会让按钮上的字读不出来，不该进库');
  }
}

// 🔴 反向对照：判据必须真的能判红。拿注册表里已知过不了这一关的那一套（`golden-yellow` 的
// primary-500 是 1.92:1）喂同一个函数 —— 它不报红，说明上面那一圈绿是空的。
{
  let registry = null;
  try { ({ themes: registry } = require('./themes.js')); } catch { /* 没有注册表就跳过这一格 */ }
  if (!registry) {
    bad('读不到 themes.js —— 上面那圈绿没有反向对照兜着（这不是通过）');
  } else {
    const failing = Object.entries(registry)
      .filter(([, t]) => buttonRatios(t.colors).some(([, r]) => r < MIN))
      .map(([id]) => id);
    if (failing.length) {
      ok(`同一个判据打在注册表 30 套主题上，报红 ${failing.length} 套（${failing.slice(0, 3).join(', ')}…）`
        + ' —— 它确实分得开好坏，不是恒绿');
    } else {
      bad('同一个判据打在注册表全部主题上一个都不报红 —— 那它判不出东西，上面那圈绿是空的');
    }
  }
}

// ── ② 圆角档用的是 theme-settings.js 现成那两张表，不是另抄一份数 ───────────────────────────────
{
  const wrong = Object.entries(presets.CORNERS)
    .filter(([, c]) => !Object.values(RADIUS).includes(c.radius) || !Object.values(BUTTON_SHAPE).includes(c.button));
  if (!wrong.length) {
    ok(`三档圆角的值全部是 theme-settings.js 里 RADIUS / BUTTON_SHAPE 的对象本身（同一份数，不是副本）`);
  } else {
    bad(`圆角档 ${wrong.map(([k]) => k).join(', ')} 用了自己抄的数 —— 同一张表两份拷贝正是 #961/#1002 一路在堵的东西`);
  }
}

// ── ③ 校验：认不出的名字必须报错，不能静默忽略 ─────────────────────────────────────────────────
{
  const cases = [
    [undefined, 0, '没有 presets 是合法的'],
    [{}, 0, '空对象是合法的'],
    [{ palette: 'ocean', corners: 'round', fonts: 'modern' }, 0, '三组都选'],
    [{ palette: '' }, 0, '空串 = 清掉这一组'],
    [{ palette: 'chartreuse' }, 1, '不在库里的名字'],
    [{ palettes: 'ocean' }, 1, '不是一个预设组'],
    [{ corners: 3 }, 1, '类型不对'],
    [['ocean'], 1, '整个不是 object'],
  ];
  for (const [input, want, why] of cases) {
    const got = presets.validatePresets(input).length;
    if (got === want) ok(`校验：${why} → ${got} 条问题`);
    else bad(`校验：${why} → 期望 ${want} 条问题，实际 ${got} 条（${presets.validatePresets(input).join(' / ')}）`);
  }
}

// ── ④ 绝对项没有渗进 tweaks 那三个旋钮里（AC4b 的静态那半） ─────────────────────────────────────
{
  const want = ['hueShift', 'radiusScale', 'densityScale'];
  const same = tweaks.TWEAK_KEYS.length === want.length && want.every((k) => tweaks.TWEAK_KEYS.includes(k));
  if (same) ok(`TWEAK_KEYS 仍然正好是 {${want.join(', ')}}（写的是集合，不是条数）`);
  else bad(`TWEAK_KEYS 变成了 [${tweaks.TWEAK_KEYS.join(', ')}] —— 绝对项属于 theme-presets.js，`
    + '塞进这里会让 withDefaults 静默丢掉它、让弹窗的 Apply 永远亮着');
  const overlap = presets.PRESET_KEYS.filter((k) => tweaks.TWEAK_KEYS.includes(k));
  if (!overlap.length) ok('两组键没有重名');
  else bad(`${overlap.join(', ')} 同时是 tweak 和预设组 —— 一个值两个主人`);
}

// ── ⑤ 生成器：中性输入收敛成空串（AC5） ────────────────────────────────────────────────────────
const BASE = [
  ['--color-primary-500', '#2563eb'],
  ['--color-accent-400', '#fbbf24'],
  ['--radius-lg', '0.5rem'],
  ['--section-y', '4rem'],
];
{
  const a = tweaks.buildCustomCss(BASE, undefined);
  const b = tweaks.buildCustomCss(BASE, { hueShift: 0, radiusScale: 1, densityScale: 1 }, presets.presetVars(undefined));
  const c = tweaks.buildCustomCss(BASE, null, presets.presetVars({}));
  if (a === '' && b === '' && c === '') ok('中性 tweaks + 没选任何预设 ⟹ 空串（跟从没设过的站逐字节相同）');
  else bad(`中性输入没有收敛成空串：${JSON.stringify([a, b, c])}`);
}

// ── ⑥ 生成器：`@import` 必须是第一行（AC4 的静态那半） ──────────────────────────────────────────
{
  const abs = presets.presetVars({ fonts: 'editorial' });
  const css = tweaks.buildCustomCss(BASE, undefined, abs);
  const first = css.split('\n')[0];
  if (/^@import url\("https:\/\/fonts\.googleapis\.com\//.test(first)) {
    ok(`字体预设 ⟹ 第一行就是 @import：${first.slice(0, 60)}…`);
  } else {
    bad(`第一行不是 @import，而是 ${JSON.stringify(first)} —— CSS 规定 @import 只能在最前面，`
      + '排到后面浏览器整条丢掉，症状是「字体没换」而不是报错');
  }
  if (/--font-heading: Playfair Display, serif;/.test(css) && /--font-sans: "Source Sans 3", /.test(css)) {
    ok('字体预设同时写了 --font-heading 和 --font-sans');
  } else {
    bad(`字体预设没写全两个字体变量：\n${css}`);
  }
  // 🔴 名字里带数字的必须加引号，否则整条 font-family 声明无效、浏览器退回默认字体（真浏览器上
  // 量到的是 `"Times New Roman"`，而文件里那一行看着完全正常）。逐对检查，不只检查这一对。
  {
    const badly = [];
    for (const name of Object.keys(presets.FONT_PAIRS)) {
      const { vars } = presets.presetVars({ fonts: name });
      for (const [varName, value] of vars.filter(([n]) => n.startsWith('--font-'))) {
        for (const part of value.split(',').map((s) => s.trim())) {
          // 不加引号的字体名 = 若干个 CSS 标识符；带数字段的那种必须加引号
          const bare = !/^["']/.test(part);
          const legal = part.split(' ').every((p) => /^[A-Za-z_-][A-Za-z0-9_-]*$/.test(p));
          if (bare && !legal) badly.push(`${name} 的 ${varName}: ${part}`);
        }
      }
    }
    if (!badly.length) ok(`${Object.keys(presets.FONT_PAIRS).length} 对字体的每个名字在 CSS 里都是合法写法（该加引号的加了）`);
    else bad(`这些字体名不加引号会让整条 font-family 失效：${badly.join(' · ')}`);
  }
  // 没选字体时不许平白冒出一条 @import（多一条字体表请求 = 多一次首屏阻塞）
  const noFont = tweaks.buildCustomCss(BASE, { hueShift: 5 }, presets.presetVars({ palette: 'ocean' }));
  if (!/@import/.test(noFont)) ok('没选字体对 ⟹ 一条 @import 都不写');
  else bad(`没选字体对却写了 @import：\n${noFont}`);
}

// ── ⑦ 生成器：绝对值真的盖过基准，而且偏移叠在【盖完之后】的值上 ────────────────────────────────
{
  const abs = presets.presetVars({ palette: 'navy' });
  const flat = tweaks.buildCustomCss(BASE, undefined, abs);
  if (/--color-primary-500: #2a4d84;/.test(flat)) ok('配色预设 navy ⟹ --color-primary-500 写成 #2a4d84（盖过主题的 #2563eb）');
  else bad(`配色预设没有盖过基准：\n${flat}`);

  // 先换基准、再施加偏移。判据是「跟只有偏移、和只有预设，两个都不一样」——
  // 只跟其中一个比，分不出实现是不是把某一层当成了空操作。
  const both = tweaks.buildCustomCss(BASE, { hueShift: 12 }, abs);
  const onlyTweak = tweaks.buildCustomCss(BASE, { hueShift: 12 });
  const line = (css) => (css.match(/--color-primary-500: (#[0-9a-f]{6});/) || [])[1];
  if (line(both) && line(both) !== line(flat) && line(both) !== line(onlyTweak)) {
    ok(`配色 + 色相 ⟹ ${line(both)}，既不等于只有配色（${line(flat)}）也不等于只有色相（${line(onlyTweak)}）`);
  } else {
    bad(`两层没有真的叠起来：配色+色相=${line(both)} · 只有配色=${line(flat)} · 只有色相=${line(onlyTweak)}`);
  }

  // 圆角档给的是绝对值，radiusScale 乘在它上面。
  const corners = tweaks.buildCustomCss(BASE, { radiusScale: 1.25 }, presets.presetVars({ corners: 'round' }));
  if (/--radius-lg: 1\.25rem;/.test(corners)) ok('圆角档 round（--radius-lg: 1rem）× radiusScale 1.25 ⟹ 1.25rem');
  else bad(`圆角档和 radiusScale 没有叠对：\n${corners}`);

  // `--radius-button` 在基准里根本不存在（没写风格设定的站），预设仍然要把它写出来 ——
  // 少了它，「胶囊按钮」这一档表达不出来。
  if (/--radius-button: 9999px;/.test(tweaks.buildCustomCss(BASE, undefined, presets.presetVars({ corners: 'round' })))) {
    ok('基准里没有的变量（--radius-button）预设照样写得出来');
  } else {
    bad('预设没写出 --radius-button —— 没写风格设定的站，胶囊按钮这一档就表达不出来');
  }
}

// ── ⑧ 生成器：跟主题说的一模一样的那一行不写进去 ────────────────────────────────────────────────
{
  // ocean 的 primary-500 恰好就是 BASE 里那个值 ⟹ 这一行是噪音，不该出现。
  const css = tweaks.buildCustomCss([['--color-primary-500', '#2563eb']], undefined, presets.presetVars({ palette: 'ocean' }));
  if (!/--color-primary-500:/.test(css)) ok('预设算出来的值跟主题一样时，那一行不写进 custom.css');
  else bad(`写了一行跟 theme.css 一字不差的声明（噪音）：\n${css}`);
}

/**
 * 🔴 第 ⑨ 节那个阳性对照要用的一组配色：**滑块归零时它是达标的，拖到某个角度才破线。**
 *
 * 它是 violet 只把 `primary-600` 往亮里挪三档（`#7620c2 → #7923c5`）。`primary-600` 是
 * `.cta-banner` 那条渐变的近端，挪亮一点整条渐变就亮一点，压在上面的浅色字就更难读。
 *
 * ── 🔴 为什么不是随便挑一组坏配色（QA1 在 r3 上把这件事驱动出来了）──────────────────────────────
 * 上一版这里冻的是 r2 那组 violet accent（QA3 在真浏览器上量到 −15° 掉到 4.45 的那组）。
 * 但**在这一层它每一档都是红的**（−15…15 全部落在 3.79–3.89），因为这一层比真机严。
 * 于是那个对照证明的只是「一组坏配色会被判红」，**跟色相那一维没有关系** —— QA1 把
 * `hueSteps()` 改成只回 `[0]`，六组配色照样全过、对照照样报红、整套 37 过 0 失败。
 * 而第 ⑨ 节存在的全部理由就是色相那一维（配色本身那一层 r2 就有了，逃掉的正是叠加）。
 *
 * ⟹ 合格的对照必须**两半都成立**，下面那一格因此写了两条断言：归零那一档全绿、整个区间里有一格
 * 破线且**破线的那一档不是 0°**。这两条也是这组值的维护说明：判据的常数一动，它可能滑向任何一边，
 * 而两条断言会当场说清楚滑向了哪一边、该重挑。挑的时候只动 `primary-600`，`+1…+4` 四档都合格
 * （实测：+3 归零 4.541 / 全区间最差 4.459@−13°，两边余量都是 0.04 上下）。
 */
const HUE_ONLY_BREACH_PRIMARY_600 = '#7923c5';

// ── ⑨ 配色 × 主题表 × 色相滑块的每一个取值（#1038 r3） ──────────────────────────────────────────
//
// 🔴 上面第 ① 节判的是**按钮**（那两处颜色住在 globals.css）。而页面上还有一大批字的颜色是**主题表
// 自己写的** —— hero 的标题、cta-banner 的两行、page-header、导航链接。这一节把那些配对从三张表里
// **解出来**判，并且跟**色相滑块**叠起来：滑块是 #1006 已经上线的旋钮，站主选了配色之后照样能拖它
// （本票 AC4c 就要求配色在拖过之后还在），所以「配色 + 某个角度」是本票明确保证会出现的状态。
//
// 立这一节的直接原因：QA3 在 r2 上量到 violet + 滑块 −15° ⟹ `.cta-banner__desc` 掉到 4.45:1，而 r2
// 的 18 格读数**全部是滑块归零时量的**，枚举里没有那一格。机理、以及三处「往严的方向兜」写在
// `scripts/theme-contrast.js` 的文件头。
//
// 🔴 判的不是「把声明出来的 token 两两配对」：破线那一对根本不是两个 token —— `.cta-banner` 的底是
// `linear-gradient(135deg, primary-600, accent-500)`，字压着的是渐变上一个混色。
{
  const fs = require('fs');
  const path = require('path');
  const contrast = require('./theme-contrast.js');
  const { MEASURED_TARGETS } = require('./theme-text-targets.js');

  const themeDir = path.join(__dirname, '..', 'public', 'themes');
  const bandsFile = path.join(__dirname, 'theme-text-bands.json');
  if (!fs.existsSync(themeDir)) die(`找不到 ${themeDir} —— 这一节会整节空过`);
  const sheets = fs.readdirSync(themeDir).filter((f) => f.endsWith('.css')).sort();
  if (!sheets.length) die('public/themes 下一张表都没有 —— 这一节会整节空过');

  let bands = { sheets: {} };
  try { bands = JSON.parse(fs.readFileSync(bandsFile, 'utf8')); } catch { /* 下面按「没有这一格」处理 */ }
  const md5 = (file) => require('crypto').createHash('md5').update(fs.readFileSync(file)).digest('hex');

  /**
   * 一组配色在色相偏 `hue` 度之后的 `--color-*` 表。
   * 顺序跟 `buildCustomCss` 一样：**先换成绝对值，再在它上面转色相**（反过来会让滑块变成空操作）。
   */
  const varsFor = (colors) => (hue) => {
    const out = {};
    for (const [group, shades] of Object.entries(colors)) {
      for (const [shade, hex] of Object.entries(shades)) out[`--color-${group}-${shade}`] = tweaks.shiftHue(hex, hue);
    }
    return out;
  };

  /**
   * 一组配色对一张表的全部判决。
   *
   * `colors` 是传进来的而不是直接读库 —— 下面的阳性对照要拿**一组已知会破线的值**跑同一个判据，
   * 两条路必须是同一个函数，否则对照证明的是另一段代码。
   *
   * @returns {{problems: string[], worst: object|null}}
   */
  const judgeSheet = (sheetFile, colors, hues) => {
    const name = sheetFile.replace(/\.css$/, '');
    const css = fs.readFileSync(path.join(themeDir, sheetFile), 'utf8');
    const pairs = contrast.textPairs(css, MEASURED_TARGETS);
    const varsAt = varsFor(colors);
    const problems = [];
    let worst = null;
    const hits = [];
    const note = (r, selector) => { if (r && (!worst || r.ratio < worst.ratio)) worst = { ...r, selector, sheet: name }; };
    const hit = (r, selector) => hits.push({ ...r, selector, sheet: name });

    for (const pair of pairs) {
      // 整条渐变（或纯色）上最差的那个点。过了就不需要几何 —— 见 theme-contrast.js 文件头 ②。
      const wide = contrast.worstOverHue(pair, varsAt, undefined, hues);
      if (!wide) {
        problems.push(`${name} ${pair.selector}：颜色解不出来（${pair.fg} on ${pair.bg.image || pair.bg.color}）`
          + ' —— 这一格什么都没判到，不许当成过');
        continue;
      }
      if (wide.ratio >= contrast.MIN_CONTRAST) { note(wide, pair.selector); continue; }

      if (!pair.bg.image || wide.t === null) {
        note(wide, pair.selector);
        hit(wide, pair.selector);
        problems.push(`${name} ${pair.selector}：${wide.ratio.toFixed(2)}:1 @色相 ${wide.hue}°`
          + `（底色 rgb(${wide.bgRgb})，纯色 —— 收窄不了，只能改配色）`);
        continue;
      }
      // 渐变：收窄到字真正压着的那一段。那一段是**几何**，由真浏览器量过存在 JSON 里。
      const entry = bands.sheets[name];
      const band = entry && entry.targets && entry.targets[pair.selector];
      const cmd = `node scripts/theme-text-bands.mjs <baseUrl> ${name} --write`;
      if (!entry || !band) {
        problems.push(`${name} ${pair.selector}：整条渐变上最差 ${wide.ratio.toFixed(2)}:1，要收窄到字真正压着的`
          + `那一段才判得了，而 scripts/theme-text-bands.json 里没有这一格 —— 跑 \`${cmd}\``);
        continue;
      }
      if (entry.md5 !== md5(path.join(themeDir, sheetFile))) {
        problems.push(`${name} 这张表改过了（md5 对不上），存着的那段几何读数作废 —— 重跑 \`${cmd}\``);
        continue;
      }
      const narrow = contrast.worstOverHue(pair, varsAt, band, hues);
      note(narrow, pair.selector);
      if (narrow.ratio < contrast.MIN_CONTRAST) {
        hit(narrow, pair.selector);
        problems.push(`${name} ${pair.selector}：${narrow.ratio.toFixed(2)}:1 @色相 ${narrow.hue}°`
          + `（渐变上 t=${narrow.t.toFixed(3)}，底色 rgb(${narrow.bgRgb})）`);
      }
    }
    return { problems, hits, worst, pairs: pairs.length };
  };

  // 分母自检：解出来的配对不能是 0，否则下面每一格都空过。
  {
    const counts = sheets.map((f) => {
      const n = contrast.textPairs(fs.readFileSync(path.join(themeDir, f), 'utf8'), MEASURED_TARGETS).length;
      return `${f.replace(/\.css$/, '')}=${n}`;
    });
    if (counts.every((c) => Number(c.split('=')[1]) >= 4)) {
      ok(`从 ${sheets.length} 张主题表里解出被量的配对：${counts.join(' · ')}（被量的选择器共 `
        + `${MEASURED_TARGETS.length} 个，单子在 scripts/theme-text-targets.js）`);
    } else {
      bad(`有主题表解出的配对太少（${counts.join(' · ')}）—— 这一节会空过`);
    }
  }

  /**
   * 按钮那两处也要过一遍色相滑块。
   *
   * 🔴 为什么单独一段：`.btn-primary` / `.btn-accent` 的颜色写在 `globals.css`，**主题表里没有**，
   * 所以上面从表里解配对时解不到它们，而第 ① 节只在滑块归零那一档判过。色相偏移**保住每个颜色
   * 自己的相对亮度**，纯色底上因此几乎不动对比度 —— 但那是个应该被量出来的性质，不是可以直接
   * 拿来当结论的断言。这一段就是把它量了。
   */
  const judgeButtons = (colors, hues = contrast.hueSteps()) => {
    const problems = [];
    let worst = null;
    for (const hue of hues) {
      const at = (group, shade) => tweaks.shiftHue(colors[group][shade], hue);
      const rows = [
        ['.btn-primary 白字压 primary-500', WHITE, at('primary', '500')],
        ['.btn-primary:hover 白字压 primary-600', WHITE, at('primary', '600')],
        ['.btn-accent gray-900 的字压 accent-400', GRAY900, at('accent', '400')],
        ['.btn-accent:hover gray-900 的字压 accent-500', GRAY900, at('accent', '500')],
      ];
      for (const [what, fg, bg] of rows) {
        const bgRgb = contrast.hexToRgb(bg);
        const r = contrast.contrast(contrast.mixBytes(contrast.hexToRgb(fg), bgRgb, contrast.PAINT_BLEND), bgRgb);
        if (!worst || r < worst.ratio) worst = { ratio: r, hue, what };
        if (r < contrast.MIN_CONTRAST) problems.push(`globals.css 「${what}」：${r.toFixed(2)}:1 @色相 ${hue}°`);
      }
    }
    return { problems, worst };
  };

  const hues = contrast.hueSteps();
  for (const [name, p] of Object.entries(presets.PALETTES)) {
    const problems = [];
    let worst = null;
    for (const f of sheets) {
      const r = judgeSheet(f, p.colors);
      problems.push(...r.problems);
      if (r.worst && (!worst || r.worst.ratio < worst.ratio)) worst = r.worst;
    }
    {
      const b = judgeButtons(p.colors);
      problems.push(...b.problems);
      if (b.worst && (!worst || b.worst.ratio < worst.ratio)) worst = { ...b.worst, sheet: 'globals.css', selector: b.worst.what };
    }
    if (!problems.length) {
      ok(`配色 ${name} × ${sheets.length} 张主题表 × 色相 ${hues[0]}…${hues[hues.length - 1]}° 共 ${hues.length} 档：`
        + `最差的一处是 ${worst.sheet} 的「${worst.selector}」= ${worst.ratio.toFixed(2)}:1 @${worst.hue}°`);
    } else {
      bad(`配色 ${name} 在色相滑块的某些取值上读不出来：\n     ${problems.join('\n     ')}`);
    }
  }

  // 🔴 阳性对照：一组「归零达标、某个色相取值才破线」的配色，跑**同一个** judgeSheet。
  //
  // 两条断言缺一不可，理由写在上面那个夹具的注释里：只断言「会报红」的对照，把色相那一维整个删掉
  // 之后照样是绿的 —— 那它就没在证明这一节存在的那件事。
  {
    const fixture = JSON.parse(JSON.stringify(presets.PALETTES.violet.colors));
    fixture.primary['600'] = HUE_ONLY_BREACH_PRIMARY_600;

    // ① 滑块归零那一档：这组配色是达标的（否则它只是一组坏配色，跟色相无关）
    const atZero = [
      ...sheets.flatMap((f) => judgeSheet(f, fixture, [0]).problems),
      ...judgeButtons(fixture, [0]).problems,
    ];
    // ② 整个区间：有一格破线，而且破线的那一档不是 0°
    const full = sheets.flatMap((f) => judgeSheet(f, fixture).hits);
    const offZero = full.filter((h) => h.hue !== 0);

    if (atZero.length) {
      bad('阳性对照的夹具退化了：它在**滑块归零**那一档就已经破线，所以它证明不了色相那一维'
        + `有用（把 hueSteps() 改成只回 [0]，它照样报红）—— 重挑一组，只动 primary-600，见夹具注释。\n     ${atZero.join('\n     ')}`);
    } else if (!offZero.length) {
      bad('阳性对照的夹具退化了：整个色相区间里一格都没破线 —— 判据对它是恒绿的，'
        + `重挑一组，只动 primary-600，见夹具注释。（归零那一档：全绿，共 ${full.length} 条命中）`);
    } else {
      const shown = offZero.reduce((a, b) => (b.ratio < a.ratio ? b : a));
      ok(`阳性对照：violet 把 primary-600 挪到 ${HUE_ONLY_BREACH_PRIMARY_600} ⟹ **滑块归零那一档全绿**，`
        + `而拖到 ${shown.hue}° 时 ${shown.sheet} 的「${shown.selector}」掉到 ${shown.ratio.toFixed(2)}:1 —— `
        + '这一格证明的是色相那一维真的在判事，不只是「坏配色会被判红」');
    }
  }
}

console.log(`\n${fail ? '❌' : '✅'} theme-presets.test.js — ${pass} 过 / ${fail} 失败`);
process.exit(fail ? 1 : 0);
