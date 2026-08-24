#!/usr/bin/env node
/**
 * button-ink.test.js — 按钮字色那三个判断的机械检查。（#1084）
 *
 * 跑法:  node scripts/lib/button-ink.test.js      （`npm run test:scripts` 会自动发现它）
 * 退出码: 0 全过 · 1 有失败 · 2 跑不起来（**不许当成通过**）
 *
 * 🔴 判据是 blended（`theme-contrast.js` 的 `PAINT_BLEND`，见 button-ink.js 文件头）。这里**不重新
 *    实现一把尺**，直接用生产那个模块的 `ratio()` —— 两份实现必然分叉，本仓为这件事付过账。
 *
 * 🔴 为什么第 ② 格（区分力）必须在：本票的 AC 里有一道「80 套主题池逐套过一遍」，而**那道尺子对
 *    改前改后给出相同的绿** —— 裸尺下白字压 primary-500 在 80 套池上今天就是 0 套不合格。一道两种
 *    实现都全绿的检查证不出「修好了」。能区分的夹具是**已下架的那 30 套**和生产上那 6 份 brand.json。
 *    🔴 #1161 —— 那 30 套已经不在 `themes` 里了（下架），所以这里改成直接读 `retiredThemes`。
 *    它今天只剩 id / 名字 / 配色，而这一格要的正好就是**配色** —— 判据一维没变，只是取处换了。
 *    改之前这里写的是 `Object.keys(themes).filter((id) => !(id in poolThemes))`，#1161 之后那个
 *    差集恒空 ⟹ 夹具静默变成 0 套，而它自己那两条「夹具是空的」检查会当场报出来（实测过，就是
 *    本次改这个文件的起因）。
 *
 * 🔴 为什么第 ③ 格（上限）必须在：深字取纯黑不是审美选择。而且换成 blended 之后**那个构造性保证没了**
 *    —— 存在一段底色两种字色都过不了线（灰阶 114…119）。这一格把那一段的宽度和代价钉成读数，
 *    因为「保持今天的白字」这个兜底的安全性完全建立在「那一段很窄、让出的余量有界」上。
 *
 * 🔴 为什么第 ④ 格（两份算术不分叉）必须在：同一段算术有两个实现 —— 正本 `button-ink.js`（构建时）
 *    与 `src/app/layout.tsx` 里内联进站产物的那份（浏览器里跑，require 不到东西）。靠注释约束两份
 *    实现是本仓付过账的失败形态，所以这一格把浏览器那份**从源码里抠出来**在 node 里跑，逐套对答案。
 */

'use strict';

const fs = require('fs');
const path = require('path');
const ink = require('./button-ink.js');
const { themes, poolThemes, retiredThemes } = require('../themes.js');

let failed = 0;
const ok = (m) => console.log(`  ✅ ${m}`);
const bad = (m) => { failed += 1; console.log(`  ❌ ${m}`); };

const MIN = 4.5;

/**
 * 生产上那 6 个站 2026-08-18 的 primary 调色板 —— **逐字从站自己的仓里取的**，不是算出来的：
 *   for s in site-bbf7a3d6 site-77863888 fadde524 site-f52d911c site-943130a2 site-194f1f41; do
 *     gh api "repos/ai1st-sites/$s/contents/site/brand.json" --jq .content | base64 -d; done
 *
 * 🔴 六个都列着，虽然中间三个的调色板逐字相同（都是 `#ec4899`）—— 票里那张表就是六行，少一行就分不清
 *    「这个站不在夹具里」和「它跟别人同值」。📌 第六个仓叫 `fadde524`，**没有 `site-` 前缀**，
 *    按 `startswith("site-")` 过滤会漏掉它。
 * 🔴 第一版这张表里的 `400` 档是我按调色板的规律**填出来的**（bbf7a3d6 写成 `#c3b696`、194f1f41 写成
 *    `#9c8a63`），而真文件是 `#baab82` / `#9a8868`。那一档不是无关的：字色换成深字时 hover 走的就是
 *    它 ⟹ 那一版的 hover 读数是关于一个这些站上不存在的颜色的。夹具要从真文件来，别从规律来。
 */
const PROD = {
  'site-bbf7a3d6': { 50: '#faf8f5', 100: '#f2f0e8', 200: '#e6e0d1', 300: '#d4cab0', 400: '#baab82', 500: '#b2a172', 600: '#807147', 700: '#695d3a', 800: '#4f452b', 900: '#2e2919' },
  'site-77863888': { 50: '#fdf2f8', 100: '#fce7f3', 200: '#fbcfe8', 300: '#f9a8d4', 400: '#f472b6', 500: '#ec4899', 600: '#db2777', 700: '#be185d', 800: '#9d174d', 900: '#831843' },
  'fadde524': { 50: '#fdf2f8', 100: '#fce7f3', 200: '#fbcfe8', 300: '#f9a8d4', 400: '#f472b6', 500: '#ec4899', 600: '#db2777', 700: '#be185d', 800: '#9d174d', 900: '#831843' },
  'site-f52d911c': { 50: '#fdf2f8', 100: '#fce7f3', 200: '#fbcfe8', 300: '#f9a8d4', 400: '#f472b6', 500: '#ec4899', 600: '#db2777', 700: '#be185d', 800: '#9d174d', 900: '#831843' },
  'site-943130a2': { 50: '#eff6ff', 100: '#dbeafe', 200: '#bfdbfe', 300: '#93c5fd', 400: '#60a5fa', 500: '#3b82f6', 600: '#2563eb', 700: '#1d4ed8', 800: '#1e40af', 900: '#1e3a8a' },
  'site-194f1f41': { 50: '#f6f4f0', 100: '#ebe6db', 200: '#d4ccb8', 300: '#b8aa8e', 400: '#9a8868', 500: '#7c6a47', 600: '#5e4f34', 700: '#3e3422', 800: '#211c12', 900: '#0d0b07' },
};

/**
 * 一套调色板按【本票之前那三个写死的字面值】会得到的四格 —— 「改动前」的定义本身，不是替身。
 *
 * 🔴 `ground` = 轮廓按钮**真正被画在上面的那块底**。默认白只对未套主题的站成立；套了主题的站
 * 必须由调用方解出来传进来（见 §⑤）。改动前那一格也要用同一块底 —— 拿白底算「改动前」、拿真底算
 * 「改动后」，比出来的差是两块底的差，不是这次改动的差（本轮被退回的读数正是这么来的）。
 */
function before(p, ground = ink.WHITE) {
  return {
    ink: ink.WHITE, baseShade: ink.TODAY.base, hoverShade: ink.TODAY.hover,
    outlineShade: ink.TODAY.outline, ground,
    cells: {
      'btn-primary 静止': ink.ratio(ink.WHITE, p['500']),
      'btn-primary hover': ink.ratio(ink.WHITE, p[ink.TODAY.hover]),
      'btn-secondary 静止': ink.ratio(p[ink.TODAY.outline], ground),
      'btn-secondary hover': ink.ratio(ink.WHITE, p['500']),
    },
  };
}

/**
 * 一套池主题的轮廓按钮坐在哪块底上 —— 从**它自己那张已经生成好的表**里解，用的是生产同一个函数。
 * 🔴 表读不到 / 解不出来一律 `die`，不是落回白底：那正是本轮被退回的那种「拿白底替深底答」。
 */
function groundOfTheme(id) {
  const file = path.join(__dirname, '..', '..', 'public', 'themes', `${id}.css`);
  let css;
  try { css = fs.readFileSync(file, 'utf8'); } catch { return { err: `读不到 ${file}` }; }
  const g = ink.outlineGroundFromCss(css, poolThemes[id].colors);
  return g || { err: `${id}.css 里 .services-list / .services-list__item 的底色解不出来` };
}

console.log('① 生产那 6 个站的真 brand.json：两个按钮 × 两种态，四格全部 ≥ 4.5（票正文 AC1）');
{
  const under = [];
  for (const [id, p] of Object.entries(PROD)) {
    const r = ink.buttonInkReport(p);
    if (!r) { under.push(`${id} 算不出（没有 primary-500）`); continue; }
    for (const u of r.under) under.push(`${id} ${u}`);
  }
  if (Object.keys(PROD).length !== 6) bad(`夹具只有 ${Object.keys(PROD).length} 个站 —— 票里那张表是 6 行`);
  else if (under.length) bad(`${under.length} 格不过线：${under.join(' · ')}`);
  else ok(`6 个生产站 × 4 格，全部 ≥ ${MIN}（blended）`);
}

console.log(`② 注册表 ${Object.keys(themes).length} 套 + 已下架 ${Object.keys(retiredThemes).length} 套：凡是【换得过去】的都过线；换不过去的保持今天的字色（票正文 AC4 的谓词）`);
{
  const rescuable = [];   // 白字不合格、而纯黑合格 —— 必须换过去
  const hopeless = [];    // 两种字色都不合格 —— 必须保持白字
  const wrong = [];
  for (const [id, t] of Object.entries(themes)) {
    const p = t.colors && t.colors.primary; if (!p) continue;
    const w = ink.ratio(ink.WHITE, p['500']);
    const b = ink.ratio(ink.BLACK, p['500']);
    const r = ink.buttonInkReport(p);
    if (w >= MIN) {
      if (r.ink !== ink.WHITE) wrong.push(`${id} 白字本来就够(${w.toFixed(3)})却被换成了 ${r.ink}`);
    } else if (b >= MIN) {
      rescuable.push(id);
      if (r.ink !== ink.BLACK) wrong.push(`${id} 白${w.toFixed(3)} 不够、黑${b.toFixed(3)} 够，却没换过去`);
      else if (r.cells['btn-primary 静止'] < MIN) wrong.push(`${id} 换过去了但仍不过线`);
    } else {
      // 🔴 #1091 —— 这一支的谓词整个换了主体，而不是被放宽。上一版问的是「压 `primary-500` 两种字色
      // 都不够时，保持白字并被标成 unreachable」；#1091 之后**底本身会挪**，所以这一批的正确行为不再是
      // 「保持白字并报出来」，而是**被那次挪档救回来**。断言因此从「有没有报出来」换成「救回来没有」——
      // 后者严格更强：它要的是这一格真的过线，而不只是失败被记了一笔。
      hopeless.push(id);
      if (r.cells['btn-primary 静止'] < MIN) {
        wrong.push(`${id} 压 500 两种字色都不够(白${w.toFixed(3)}/黑${b.toFixed(3)})，挪档之后仍然不过线`
          + `（挪到了 primary-${r.baseShade}，读数 ${r.cells['btn-primary 静止'].toFixed(3)}）`);
      }
      // 一档都救不回来时才该保持白字并报出来 —— 那一支今天在注册表上是空的，空过要说出来（下面那两个
      // 「夹具是空的」同族）。
      if (!r.baseMoved && !r.inkUnreachable) {
        wrong.push(`${id} 压 500 两种字色都不够、底也没挪，却没被标成 unreachable —— 报不出来就等于没这一条`);
      }
    }
  }
  if (!rescuable.length) {
    bad('注册表里没有任何一套「白字不够、纯黑够」—— 这一格的正方向夹具是空的，它在空过');
  } else if (!hopeless.length) {
    bad('注册表里没有任何一套「两种字色都不够」—— 这一格的反方向夹具是空的，它在空过');
  } else if (wrong.length) {
    bad(`${wrong.length} 处判错：${wrong.slice(0, 6).join(' · ')}`);
  } else {
    const moved = hopeless.filter((id) => ink.buttonInkReport(themes[id].colors.primary).baseMoved).length;
    ok(`${Object.keys(themes).length} 套里 ${rescuable.length} 套换字色就够（全部换了且过线）`
      + `· ${hopeless.length} 套换字色救不了（其中 ${moved} 套靠 #1091 挪底救回来了，全部 ≥ ${MIN}）`);
  }

  // 区分力：改前那份（写死白字）在已下架那 30 套上判错的，模块必须判对。
  // 🔴 #1161 起它们不在 `themes` 里，配色改从 `retiredThemes` 取（那个文件只剩 id/名字/配色，
  // 而这一格要的就是配色）。这些站今天还在线上穿着这些颜色 —— 夹具没有变旧。
  const retired = Object.keys(retiredThemes);
  const primaryOf = (id) => retiredThemes[id].colors && retiredThemes[id].colors.primary;
  const fixable = retired.filter((id) => {
    const p = primaryOf(id); if (!p) return false;
    return ink.ratio(ink.WHITE, p['500']) < MIN && ink.ratio(ink.BLACK, p['500']) >= MIN;
  });
  if (retired.length !== 30) bad(`已下架名单是 ${retired.length} 套，不是 30 —— 夹具变了，先看是不是 themes-retired.js 动了`);
  if (fixable.length < 5) {
    bad(`已下架那批里「白字不合格而纯黑能救」只剩 ${fixable.length} 套 —— 这个夹具已经不能区分对错了，别拿它当绿`);
  } else {
    const stillBad = fixable.filter((id) => ink.buttonInkReport(primaryOf(id)).cells['btn-primary 静止'] < MIN);
    if (stillBad.length) bad(`模块没修好其中 ${stillBad.length} 套：${stillBad.join(' ')}`);
    else ok(`已下架那批里 ${fixable.length} 套「白字不合格而能救」的，模块全部判到 ≥ ${MIN}`);
  }

  // 反方向：底色够暗时不许改成深字（否则「一律深字」也能过第①格）
  const r194 = ink.buttonInkReport(PROD['site-194f1f41']);
  if (r194.ink !== ink.WHITE) bad(`site-194f1f41（#7c6a47，白字 blended ${r194.whiteRatio.toFixed(2)} 本来就对）被判成了 ${r194.ink}`);
  else ok(`site-194f1f41 仍然是白字（${r194.whiteRatio.toFixed(2)}）—— 不是「一律改成深字」`);
}

console.log('③ 上限：blended 尺下【存在】两种字色都救不了的底色 —— 那一段有多宽、代价多大');
{
  const GRAY900 = '#111827';
  // 裸尺下的构造性保证（button-ink.js ① 的那两行算术）——它仍然成立，只是不再是判据。
  const cross = Math.sqrt(0.05 * 1.05) - 0.05;
  const ceiling = 1.05 / (cross + 0.05);
  if (ceiling < MIN) bad(`裸尺下白 vs 纯黑的上限算出来是 ${ceiling.toFixed(3)} < ${MIN} —— 那连裸尺那条路都不成立`);
  else ok(`裸尺：白/纯黑交叉点在亮度 ${cross.toFixed(4)}，那一点 ${ceiling.toFixed(3)} ≥ ${MIN}（这是 raw 的性质，不是判据）`);

  // blended 尺：全灰阶扫描，把「两种都不够」那一段的宽度、段内最好读数、以及「保持白字」让出的余量量出来。
  const band = [];
  let bestFloor = Infinity; let bestFloorAt = '';
  let worstGap = 0; let worstGapAt = '';
  let whiteFloor = Infinity;
  for (let g = 0; g <= 255; g += 1) {
    const hex = `#${[g, g, g].map((v) => v.toString(16).padStart(2, '0')).join('')}`;
    const w = ink.ratio(ink.WHITE, hex); const b = ink.ratio(ink.BLACK, hex);
    if (w >= MIN || b >= MIN) continue;
    band.push(g);
    if (Math.max(w, b) < bestFloor) { bestFloor = Math.max(w, b); bestFloorAt = `gray=${g} 白${w.toFixed(3)} 黑${b.toFixed(3)}`; }
    if (Math.abs(b - w) > worstGap) { worstGap = Math.abs(b - w); worstGapAt = `gray=${g} 白${w.toFixed(3)} 黑${b.toFixed(3)}`; }
    whiteFloor = Math.min(whiteFloor, w);
  }
  if (!band.length) {
    bad('blended 尺下灰阶扫描找不到「两种字色都不够」的段 —— 那 button-ink.js ①a 那整段理由已经过期，'
      + '重新量一次再决定这一格留不留');
  } else if (band.length > 24) {
    bad(`「两种字色都不够」的段有 ${band.length} 个色阶宽（gray=${band[0]}…${band[band.length - 1]}）—— `
      + '比立本条时的 6 宽了一个数量级，「保持白字」这个兜底不再是小代价，回去重新拍规则');
  } else if (worstGap > 0.6) {
    bad(`段内 |黑−白| 最大 ${worstGap.toFixed(3)}（${worstGapAt}）—— 「保持白字」会让出这么多，`
      + '大到该改成「都不够时取好的那个」了');
  } else {
    ok(`「两种都不够」的段 = gray ${band[0]}…${band[band.length - 1]}（${band.length} 个色阶）· `
      + `段内最好读数 ≥ ${bestFloor.toFixed(4)}（${bestFloorAt}）· 白字最低 ${whiteFloor.toFixed(3)} · `
      + `保持白字最多让出 ${worstGap.toFixed(4)}（${worstGapAt}）`);
  }

  // 深字为什么是纯黑而不是 gray-900：换过去会让「换得过去」的那一批变少。
  const rescuedByBlack = Object.values(themes).filter((t) => {
    const p = t.colors && t.colors.primary; if (!p) return false;
    return ink.ratio(ink.WHITE, p['500']) < MIN && ink.ratio(ink.BLACK, p['500']) >= MIN;
  }).length;
  const rescuedByGray = Object.values(themes).filter((t) => {
    const p = t.colors && t.colors.primary; if (!p) return false;
    return ink.ratio(ink.WHITE, p['500']) < MIN && ink.ratio(GRAY900, p['500']) >= MIN;
  }).length;
  if (rescuedByGray >= rescuedByBlack) {
    bad(`gray-900 当深字能救 ${rescuedByGray} 套、纯黑能救 ${rescuedByBlack} 套 —— 「必须用纯黑」这个理由`
      + '在今天的注册表上已经没有读数了，去重新量一次再决定留不留');
  } else {
    ok(`纯黑能救 ${rescuedByBlack} 套、gray-900 只能救 ${rescuedByGray} 套（差 ${rescuedByBlack - rescuedByGray} 套）⟹ 纯黑这条不是审美`);
  }
}

console.log('④ 两份算术不许分叉：把 layout.tsx 里内联进产物的那份抠出来在 node 里跑，逐套对答案');
{
  const src = fs.readFileSync(path.join(__dirname, '..', '..', 'src', 'app', 'layout.tsx'), 'utf-8');
  const START = "var pk=(t&&t.colors&&t.colors.primary)||{},p5=pk['500'];";
  const END = "if(t&&typeof t.fontSans==='string'";
  const i = src.indexOf(START);
  const j = src.indexOf(END, i);
  if (i < 0 || j < 0) {
    bad('在 layout.tsx 里找不到那段浏览器侧算术的起止锚点 —— 它被改写过了，这一格【不是】通过');
  } else {
    const snippet = src.slice(i, j);
    // 🔴 #1084 r3 —— 那段现在会**从真 DOM 量轮廓按钮坐着的那块底**，所以在 node 里跑它要给一个
    // `document` / `getComputedStyle`。这个桩不是为了让它跑得起来，它自己就是被判的东西：喂进去的
    // 那块底就是这一轮要对答案的第二个维度。桩只回答「这个选择器在不在、它的 computed 底色是什么」，
    // 与真浏览器同形（`.services-list__item` 常常是 `rgba(0,0,0,0)` —— QA2 在真机上量到的）。
    const domStub = (bgCss) => {
      const el = {};
      return {
        document: { querySelector: (sel) => (bgCss[sel] !== undefined ? el : null) },
        getComputedStyle: () => ({ backgroundColor: bgCss.__value }),
      };
    };
    // eslint-disable-next-line no-new-func
    const mk = (dom) => new Function('t', 'document', 'getComputedStyle',
      `var out=[];${snippet}return out;`).bind(null);
    const runWith = (dom) => (t) => mk(dom)(t, dom.document, dom.getComputedStyle);
    /** 页面上没有 services-list ⟹ 白底（未套主题的站，也是构建时那一侧的默认）。 */
    const NO_LIST = { document: { querySelector: () => null }, getComputedStyle: () => ({ backgroundColor: '' }) };
    const run = runWith(NO_LIST);
    const mismatch = [];
    // 🔴 #1100 —— accent 那一组也要喂进去。喂之前这一格对 accent 那半**按构造是盲的**：两边都拿不到
    // accent ⟹ 两边都不产出 `--btn-accent-hover` ⟹ 逐字相同，而那是一次空绿（反向对照 D 在下面）。
    const rows = [...Object.entries(themes).map(([id, t]) => [id, t.colors && t.colors.primary, t.colors && t.colors.accent]),
      ...Object.entries(PROD).map(([id, p]) => [id, p, null])];
    let withAccent = 0;
    for (const [id, p, a] of rows) {
      if (!p) continue;
      if (a) withAccent += 1;
      const mine = ink.buttonInkVars(p, ink.WHITE, a).map((d) => d.replace(/\s+/g, ''));
      const theirs = run({ colors: { primary: p, accent: a || undefined } }).map((d) => d.replace(/\s+/g, ''));
      if (JSON.stringify(mine) !== JSON.stringify(theirs)) {
        mismatch.push(`${id}: 正本 ${JSON.stringify(mine)} vs 浏览器侧 ${JSON.stringify(theirs)}`);
      }
    }
    if (mismatch.length) bad(`${mismatch.length} 套对不上（白底那一档）：${mismatch.slice(0, 3).join(' | ')}`);
    else if (!withAccent) bad('没有一套夹具带 accent ⟹ 这一格对 `--btn-accent-hover` 那半是空绿');
    else ok(`${rows.length} 套配色两份实现产出的变量逐字相同（页面上没有 services-list ⟹ 白底）`
      + ` · 其中 ${withAccent} 套带 accent，所以 --btn-accent-hover 那一条也在这一格里`);

    // 🔴 #1084 r3 —— 第二个维度：**页面上真的有一块深底时两份还对不对得上**。上一版两份都写死白底，
    // 所以「白底那一档全绿」对本轮改的这件事按构造是盲的。逐套拿这套主题自己那张表解出来的底喂两边。
    {
      const off = [];
      let dark = 0;
      for (const id of Object.keys(poolThemes)) {
        const p = poolThemes[id].colors.primary;
        const g = groundOfTheme(id);
        if (g.err) { off.push(g.err); continue; }
        if (g.hex.toLowerCase() !== ink.WHITE) dark += 1;
        const dom = {
          document: { querySelector: (sel) => (sel === '.services-list__item' ? null : {}) },
          getComputedStyle: () => ({ backgroundColor: `rgb(${[1, 3, 5].map((k) => parseInt(g.hex.substr(k, 2), 16)).join(', ')})` }),
        };
        const mine = ink.buttonInkVars(p, g.hex, poolThemes[id].colors.accent).map((d) => d.replace(/\s+/g, ''));
        const theirs = runWith(dom)({ colors: { primary: p, accent: poolThemes[id].colors.accent } })
          .map((d) => d.replace(/\s+/g, ''));
        if (JSON.stringify(mine) !== JSON.stringify(theirs)) {
          off.push(`${id}: 正本 ${JSON.stringify(mine)} vs 浏览器侧 ${JSON.stringify(theirs)}`);
        }
      }
      if (off.length) bad(`底不是白的时候 ${off.length} 套对不上：${off.slice(0, 3).join(' | ')}`);
      else ok(`80 套池主题各自那块真底（其中 ${dark} 套不是白的）两份实现逐字相同`);
    }

    // 🔴 反向对照 C：这一格必须能看出「浏览器侧还在按白底挑档」。把那段里的 `gnd` 钉死成白，
    // 与正本按真底算的答案必须出现分歧 —— 否则上面那一格是空过的。
    {
      const pinnedWhite = snippet.replace(/CR\(pk\[OL\[q\]\],gnd\)/, "CR(pk[OL[q]],'#ffffff')");
      if (pinnedWhite === snippet) {
        bad('在抠出来的那段里找不到 `CR(pk[OL[q]],gnd)` —— 浏览器侧可能已经不是按真底挑档了');
      } else {
        // eslint-disable-next-line no-new-func
        const runPinned = new Function('t', 'document', 'getComputedStyle', `var out=[];${pinnedWhite}return out;`);
        let diff = 0;
        for (const id of Object.keys(poolThemes)) {
          const g = groundOfTheme(id);
          if (g.err) continue;
          const dom = {
            document: { querySelector: (sel) => (sel === '.services-list__item' ? null : {}) },
            getComputedStyle: () => ({ backgroundColor: `rgb(${[1, 3, 5].map((k) => parseInt(g.hex.substr(k, 2), 16)).join(', ')})` }),
          };
          // 🔴 两边都要去掉空白再比：正本产出 `--btn-primary-ink: #ffffff;`（冒号后有空格），内联那份
          // 没有空格。忘了这一步的话**每一套都"分歧"**，这个对照就变成恒绿 —— 我第一版正是这样，
          // 它报 80/80 分歧，而 `fern-02` 两边真的同档（600），本该是 79。
          const norm = (a) => JSON.stringify(a.map((d) => d.replace(/\s+/g, '')));
          const mine = norm(ink.buttonInkVars(poolThemes[id].colors.primary, g.hex));
          if (mine !== norm(runPinned({ colors: { primary: poolThemes[id].colors.primary } }, dom.document, dom.getComputedStyle))) diff += 1;
        }
        if (!diff) bad('把浏览器侧的底钉死成白之后两份仍然逐套相同 —— 上面那一格分不出「按真底」和「按白底」');
        else ok(`把浏览器侧的底钉死成白 ⟹ ${diff} 套当场分歧，上面那一格确实在判「按真底挑档」`);
      }
    }

    // 🔴 反向对照 D（#1100）：这一格必须能看出「浏览器侧的方向判据还是老的 `ink === '#000000'`」。
    // 把抠出来那段里的亮度判据钉回字面相等，与正本按亮度算的答案必须出现分歧 —— 否则上面那两格对
    // 本票改的这件事是空过的。**这是本票唯一改了行为的那个谓词**，所以它必须有自己的反向对照。
    {
      const pinnedEq = snippet.replace('return LU(BY(h))<Math.sqrt(0.05*1.05)-0.05;', "return h==='#000000';");
      if (pinnedEq === snippet) {
        bad('在抠出来的那段里找不到那条亮度判据 —— 浏览器侧可能已经不是按亮度判 hover 方向了');
      } else {
        // eslint-disable-next-line no-new-func
        const runEq = new Function('t', 'document', 'getComputedStyle', `var out=[];${pinnedEq}return out;`);
        let diff = 0;
        let sawAccentVar = 0;
        for (const id of Object.keys(poolThemes)) {
          const t = { colors: { primary: poolThemes[id].colors.primary, accent: poolThemes[id].colors.accent } };
          const norm = (a) => JSON.stringify(a.map((d) => d.replace(/\s+/g, '')));
          const theirs = runEq(t, NO_LIST.document, NO_LIST.getComputedStyle);
          if (theirs.some((d) => d.includes('--btn-accent-hover'))) sawAccentVar += 1;
          if (norm(ink.buttonInkVars(t.colors.primary, ink.WHITE, t.colors.accent)) !== norm(theirs)) diff += 1;
        }
        if (!sawAccentVar) bad('反向对照 D 里浏览器侧一套都没产出 --btn-accent-hover —— 这个对照立不起来');
        else if (!diff) bad('把浏览器侧的方向判据钉回 `=== "#000000"` 之后两份仍然逐套相同 —— 上面那两格'
          + '分不出「按亮度判方向」和「按跟纯黑相等判方向」，本票改的那个谓词没有被判过');
        else ok(`把浏览器侧的方向判据钉回 \`=== '#000000'\` ⟹ ${diff} 套当场分歧`
          + '（accent 的字是 gray-900，老判据把它判成浅字 ⟹ hover 朝深走）');
      }
    }

    // 🔴 反向对照 A：这一格必须能看出「尺换了而那边没跟」。喂一个**只有 blended 与 raw 会给出不同
    //    答案**的底色 —— `#bb5b36`（ember-38）裸 4.504 合格、blended 4.173 不合格。浏览器那份若还在
    //    用裸对比度，它会判白字，而正本判「两种都不够 ⟹ 保持白字」…… 两者字色相同、但 hover 档不同
    //    时才分得开。所以这里直接量那段抠出来的代码自己的读数：把 0.06 改成 0 再跑，必须出现分歧。
    const rawVersion = snippet.replace('(g[k]-v)*0.06', '(g[k]-v)*0');
    let diverged = false;
    if (rawVersion === snippet) {
      bad('在抠出来的那段里找不到 `*0.06` 那个掺色系数 —— 浏览器侧可能已经不是 blended 那把尺了');
    } else {
      // eslint-disable-next-line no-new-func
      const runRaw = new Function('t', `var out=[];${rawVersion}return out;`);
      for (const [, p, a] of rows) {
        if (!p) continue;
        const t = { colors: { primary: p, accent: a || undefined } };
        if (JSON.stringify(runRaw(t)) !== JSON.stringify(run(t))) { diverged = true; break; }
      }
      if (!diverged) bad('把掺色系数改成 0 之后，两份产出在所有夹具上逐字相同 —— 这一格分不出裸尺和 blended');
      else ok('把掺色系数改成 0 会当场产生分歧 ⟹ 抠出来的那段确实在用 blended 那把尺');
    }

    // 反向对照 B：抠出来的确实是活代码，不是一段永远不产出的死码。
    const probe = run({ colors: { primary: { 500: '#ffffff', 400: '#ffffff', 600: '#000000' } } });
    // 🔴 #1091 —— 按**名字**取，不按索引。上一版写的是 `probe[0]`，而那时 `--btn-primary-ink` 恰好排
    // 第一；#1091 在它前面插了 `--btn-primary-bg` ⟹ 同一句断言开始读另一个变量，报的话也跟着变成假的
    // （「给出的字色是 --btn-primary-bg:…」）。位置不是身份。
    const inkDecl = probe.find((d) => d.includes('--btn-primary-ink'));
    if (!inkDecl) {
      bad('浏览器侧那段对一个纯白 primary-500 什么都没产出 —— 抠出来的可能不是那段算术');
    } else if (!inkDecl.includes('#000000')) {
      bad(`浏览器侧对纯白底给出的字色是 ${inkDecl}，应当是纯黑`);
    } else ok('抠出来的那段确实在算（纯白底 ⟹ 深字），不是一段永远不产出的死码');
  }
}

console.log('⑤ Chris 策展的那 80 套池主题：改动面 = 恰好那些【换过去真能过线】的（票正文 AC4/AC5）');
{
  // 🔴 这一格与第②格不是同一件事：②问的是「该换的换了、不该换的没换」，只管字色。这一格问的是
  // **那 80 套的改动面有多大**，包括 hover 走哪一档、轮廓按钮的字走哪一档 —— 本票之前它们分别是
  // 字面的 `text-white` / `hover:bg-primary-600` / `text-primary-500`（`before()` 就是这三个字面值，
  // 所以这不是「拿旧实现跑一遍」的替身，而是旧实现的定义本身）。
  //
  // 🔴 它守的是「不许为了 0.1 的差把整个池子换脸」：改成「白/黑取对比度大的那个」，裸尺下 80 套里
  // 47 套会翻，而「80 套逐套 ≥4.5」那道 AC 对它全绿 —— 那条 AC 看不见这个变化，这一格看得见。
  //
  // 🔴 **轮廓按钮那一格量的是「字压它真正坐着的那块底」，不是压白底**（票正文 2026-08-19 第三次改的
  // 口径，出处 QA2 r2 真机 + PM 全量复算）。上一版这里拿白底判，于是这一格对「档位在深底上朝反方向
  // 走」完全看不见：80 套里 37 套的读数被改差（最大 Δ −0.75），而这一格全绿。
  // 底从**每套主题自己那张表**里解（`.services-list__item` 优先，其次 `.services-list`）——
  // 逐套解出来是 primary-50 27 套 · primary-100 16 套 · primary-800 16 套 · primary-900 21 套，**白底 0 套**。
  const ids = Object.keys(poolThemes);
  const unjustified = [];
  const inkFlips = []; const baseMoves = []; const hoverMoves = []; const outlineMoves = []; const kept = [];
  const baseUnder = [];
  const grounds = {};
  let outlineUnder = [];
  for (const id of ids) {
    const p = (poolThemes[id].colors || {}).primary;
    if (!p) { unjustified.push(`${id} 没有 primary 调色板 —— 夹具坏了`); continue; }
    const g = groundOfTheme(id);
    if (g.err) { unjustified.push(g.err); continue; }
    grounds[g.from.split('→')[1] ? g.from.split('→')[1].trim() : g.from] = (grounds[g.from.split('→')[1] ? g.from.split('→')[1].trim() : g.from] || 0) + 1;
    const b4 = before(p, g.hex); const r = ink.buttonInkReport(p, g.hex);
    if (!r) { unjustified.push(`${id} 算不出`); continue; }
    // 🔴 AC4 的正文字面：「凡是【换得过去】的都必须过线」。轮廓这一格**每一套都换得过去**
    // （梯子两个方向都能挑，实测 80/80），所以这里的判据不是「不许退步」而是「必须过线」。
    if (r.cells['btn-secondary 静止'] < MIN) {
      outlineUnder.push(`${id} ${r.cells['btn-secondary 静止'].toFixed(3)}（底 ${g.from}，选了 ${r.outlineShade} 档）`);
    }
    // 🔴 反向的那一半也要判：不许把一格改得比改动前更差。上一版正是这么坏的（37 套）。
    if (r.cells['btn-secondary 静止'] < b4.cells['btn-secondary 静止'] - 1e-9) {
      unjustified.push(`${id} 轮廓比改动前更差 ${b4.cells['btn-secondary 静止'].toFixed(3)}→${r.cells['btn-secondary 静止'].toFixed(3)}`);
    }
    if (r.ink !== b4.ink) {
      inkFlips.push(`${id} ${b4.cells['btn-primary 静止'].toFixed(3)}→${r.cells['btn-primary 静止'].toFixed(3)}`);
      if (r.cells['btn-primary 静止'] < MIN) unjustified.push(`${id} 字色换了却仍不过线 ${r.cells['btn-primary 静止'].toFixed(3)}`);
    }
    // 🔴 #1091 —— **本票改的那一维在这一节里原来没有判决分支**（QA1 r2 点出来的）。⑤ 的自述是
    // 「改动面 = 恰好那些换过去真能过线的」，而它当时只对字色 / hover / 轮廓三维发言；主按钮的**底**
    // 挪了 55 套，一条断言都没有，连 `ok()` 那行报的改动面都不含它 ⟹ 这一节对本票的主交付静默。
    // 两个方向各一条，跟轮廓那一支同构：
    if (r.baseShade !== b4.baseShade) {
      baseMoves.push(`${id} ${b4.baseShade}→${r.baseShade}`);
      // 该不该动，问的是**每一个被跳过的档**，不只是今天那一档：从 500 到选中的那一档之间，凡是
      // 存在的档都必须是「两种字色都过不去」才轮得到再往深走。只问 500 的话，「500 不行所以跳到 800」
      // 这种跳过 600/700 的挪法照样全绿 —— 而 D 拍的是**挪一档**，不是挪到够黑为止。
      // 🔴 候选是从 `p` 自己的键上按数字算的，**没有 require `BASE_LADDER`** —— 拿实现自己那把梯子
      //    来问「梯子对不对」是同义反复。这里只用 `inkDecision`（它自己那一格在 ②，有独立夹具）。
      // 📌 射程：这一支只判「选得对不对」。梯子只朝深走这件事由下面那条 `n(r.baseShade) < 500` 判。
      const skipped = Object.keys(p)
        .filter((sh) => /^\d{2,3}$/.test(sh) && typeof p[sh] === 'string')
        .filter((sh) => Number(sh) >= Number(ink.TODAY.base) && Number(sh) < Number(r.baseShade))
        .filter((sh) => !ink.inkDecision(p[sh]).unreachable);
      if (skipped.length) {
        unjustified.push(`${id} 跳过了本来就够的档 ${skipped.map((sh) => `${sh}(${ink.inkDecision(p[sh]).ink} `
          + `${ink.ratio(ink.inkDecision(p[sh]).ink, p[sh]).toFixed(3)})`).join(' ')} 却挪到了 ${r.baseShade}`);
      }
      // 方向：D 的原话是「挪深一档」。朝浅走会把字底拉近，是另一回事，不许静默发生。
      if (Number(r.baseShade) < Number(ink.TODAY.base)) {
        unjustified.push(`${id} base 朝【浅】走了 ${b4.baseShade}→${r.baseShade} —— 做法 D 只朝深`);
      }
      // 动完对不对：挪过去仍不过线就是白挪（把 Chris 策展的按钮弄深了还没修好任何人）。
      if (r.cells['btn-primary 静止'] < MIN) {
        unjustified.push(`${id} base 挪到 primary-${r.baseShade} 之后仍不过线 ${r.cells['btn-primary 静止'].toFixed(3)}`);
      }
    }
    // 🔴 AC3 的正面性质单独收一条，**不挂在「挪过档」那个分支下面** —— 挂上去就只覆盖挪过的那些，
    // 而「该挪没挪」恰好落在没挪的那一边（`baseShadeFor` 整个不挪 = 55 套停在 500 读不出来）。
    //
    // 🔴 而「读不出来」不许一律记进 AC4 的免死名单：`inkUnreachable` 只说**选中那一档**两种字色都不行，
    // 它对「更深的档本来能救」是沉默的。不挪档这个坏法正好落在这个沉默里 —— 55 套会全部 unreachable、
    // 全部进 `kept`、一条红都没有。所以先问一句「更深处还有没有救」，有就是 finding，没有才是免死。
    if (r.cells['btn-primary 静止'] < MIN) {
      const deeperRescue = Object.keys(p)
        .filter((sh) => /^\d{2,3}$/.test(sh) && typeof p[sh] === 'string')
        .filter((sh) => Number(sh) > Number(r.baseShade))
        .filter((sh) => !ink.inkDecision(p[sh]).unreachable);
      if (deeperRescue.length) {
        unjustified.push(`${id} base 停在 ${r.baseShade} 仍不过线 ${r.cells['btn-primary 静止'].toFixed(3)}，`
          + `而更深的 ${deeperRescue.join('/')} 本来救得回来`);
      } else {
        baseUnder.push(`${id} ${r.cells['btn-primary 静止'].toFixed(3)}（选了 ${r.baseShade} 档、字 ${r.ink}`
          + '，500…900 一档都救不回来）');
      }
    }
    if (r.hoverShade !== b4.hoverShade) {
      hoverMoves.push(`${id} ${b4.hoverShade}→${r.hoverShade}`);
      // 🔴 「本来够不够」要拿**选出来的那个字色**去问今天那一档，不是拿改动前的白字去问。
      // 字色一翻，600 那一档的读数就换了主体：magenta-27 白字压 600 是 5.43（够），可它的字色换成了
      // 纯黑，而纯黑压 600 不够 —— 拿 5.43 当理由会把一次正当的挪档判成违规（第一版就是这么红的）。
      //
      // 🔴 #1091 —— 还有**第二个**正当理由，而漏了它这一格会把 55 套正确的挪档全判成违规（实测）：
      // **base 挪走了**。做法 D 之后 hover 必须跟着走，否则两态同色、鼠标移上去什么都不发生
      // （AC3 的后半句）。所以「没有读数支持」只剩一种情况：base 没动、而今天那一档拿选出来的字色量
      // 也够 —— 那时候挪它才是无理由的。
      const todayWithChosenInk = ink.ratio(r.ink, p[ink.TODAY.hover]);
      if (!r.baseMoved && todayWithChosenInk >= MIN) {
        unjustified.push(`${id} base 没动、hover 本来也够(${todayWithChosenInk.toFixed(3)})却被挪了档`);
      }
      // 🔴 两态同色是 AC3 明写的红线，单独判一次：上面那条只问「该不该动」，这条问「动完对不对」。
      if (r.hoverShade === r.baseShade) {
        unjustified.push(`${id} hover 与 base 同为 primary-${r.baseShade} —— 鼠标移上去什么都不会发生`);
      }
      if (r.cells['btn-primary hover'] < MIN) {
        unjustified.push(`${id} hover 挪到 primary-${r.hoverShade} 之后仍不过线 ${r.cells['btn-primary hover'].toFixed(3)}`);
      }
    }
    if (r.outlineShade !== b4.outlineShade) {
      outlineMoves.push(`${id} ${b4.outlineShade}→${r.outlineShade}`);
      if (b4.cells['btn-secondary 静止'] >= MIN) unjustified.push(`${id} 轮廓本来就够(${b4.cells['btn-secondary 静止'].toFixed(3)})却被挪了档`);
      else if (r.cells['btn-secondary 静止'] < MIN) unjustified.push(`${id} 轮廓挪了档却仍不过线 ${r.cells['btn-secondary 静止'].toFixed(3)}`);
    }
    if (r.inkUnreachable) kept.push(id);
  }
  if (ids.length !== 80) bad(`池子是 ${ids.length} 套，不是 80 —— 夹具变了（#1016 的池子动过？）先看那边`);
  else if (unjustified.length) bad(`${unjustified.length} 处改动没有读数支持：${unjustified.slice(0, 8).join(' · ')}`);
  else {
    ok(`80 套：字色变 ${inkFlips.length}（${inkFlips.join(' ') || '无'}）· 主按钮底变 ${baseMoves.length}`
      + ` · hover 变 ${hoverMoves.length}`
      + ` · 轮廓变 ${outlineMoves.length} —— 每一处都是「改动前不过线、换过去过线」，且没有一格比改动前更差`);
    ok(`两种字色都换不过去、按 AC4 保持今天白字的：${kept.length} 套（名单见 --list）`);
  }
  // 🔴 轮廓那一格单独一条断言 —— 它是本轮被退回的那一格，判据是 AC4 的字面：换得过去的都要过线。
  // 🔴 #1091 —— 主按钮静止态自己一条，判据是 AC3 的字面：**每一套**都要 ≥ 4.5，一套都不许例外。
  if (baseUnder.length) {
    bad(`主按钮静止态（算出来的字压算出来的那一档底），${baseUnder.length} 套不过线：${baseUnder.slice(0, 6).join(' · ')}`);
  } else {
    ok(`主按钮静止态：80 套【算出来的字色压算出来的那一档底】全部 ≥ ${MIN}（挪过档的 ${baseMoves.length} 套）`);
  }
  const groundLine = Object.entries(grounds).sort((a, b) => b[1] - a[1]).map(([k, n]) => `${k} ${n} 套`).join(' · ');
  if (Object.keys(grounds).some((k) => /白/.test(k))) {
    bad(`有主题被解成白底（${groundLine}）—— 池里 0 套是白底，解出白底说明解析器没认出那条规则`);
  } else if (outlineUnder.length) {
    bad(`轮廓按钮静止态压它真正坐着的那块底，${outlineUnder.length} 套不过线：${outlineUnder.slice(0, 6).join(' · ')}`);
  } else {
    ok(`轮廓按钮静止态：80 套压【它真正坐着的那块底】全部 ≥ ${MIN}（底的分布：${groundLine}）`);
  }
  if (process.argv.includes('--list')) {
    console.log(`     保持白字的 ${kept.length} 套：${kept.join(' ')}`);
    console.log(`     轮廓挪档的 ${outlineMoves.length} 套：${outlineMoves.join(' ')}`);
  }
  // 🔴 反向对照：这一格必须能被「按白底挑档」这个**上一版的实现**弄红 —— 否则它只是换了个说法的空断言。
  // 把档位改成按白底挑（其余一律不动），再拿真底去量，看它是不是真的报红。
  {
    const wrong = [];
    for (const id of ids) {
      const p = poolThemes[id].colors.primary;
      const g = groundOfTheme(id);
      if (g.err) continue;
      const shade = ink.outlineShadeFor(p, ink.WHITE);   // ← 上一版：按白底挑
      if (ink.ratio(p[shade], g.hex) < MIN) wrong.push(id);
    }
    if (!wrong.length) {
      bad('反向对照：按白底挑档（上一版的实现）在真底上一套都没红 —— 这一格证明不了它在判事');
    } else {
      ok(`反向对照：把档位换回「按白底挑」（上一版），拿真底一量 ${wrong.length} 套不过线`
        + `（例：${wrong.slice(0, 4).join(' · ')}）—— 这一格红得起来`);
    }
  }
  // 阳性对照：这一格必须能红。往池里塞一套「白字不合格而纯黑能救」的配色，它应当被算进改动面。
  const probe = ink.buttonInkReport({ ...poolThemes[ids[0]].colors.primary, 500: '#b2a172' });
  if (probe.ink === ink.WHITE) {
    bad('阳性对照：把 primary-500 换成生产上那个 #b2a172（白字 blended 2.42）之后字色仍判成白 —— 这一格量不出改动面');
  } else ok(`阳性对照：primary-500=#b2a172 ⟹ 字色 ${probe.ink} ≠ ${ink.WHITE}，这一格红得起来`);
}

console.log('⑥ 「换过去过线才换」这条约束本身：两种字色都过不了的底色，必须保持今天的白字并被报出来');
{
  // 这一格钉的是 2026-08-19 那次改口径加的那半句。夹具 `#c6399f` = 池主题 `magenta-14` 的 primary-500，
  // 白 4.307 / 黑 4.344，两个都低于 4.5 —— 「取对比度更高的那个」会把它换成深字，既没修好又换了脸。
  const GROUND = '#c6399f';
  const d = ink.inkDecision(GROUND);
  if (d.white >= MIN || d.black >= MIN) {
    bad(`夹具 ${GROUND} 现在有一种字色是过线的（白${d.white.toFixed(3)} 黑${d.black.toFixed(3)}）—— `
      + '它已经不能钉住这条约束了，换一个两种都不过的底色');
  } else if (d.ink !== ink.TODAY.ink) {
    bad(`${GROUND} 两种字色都不过线（白${d.white.toFixed(3)} 黑${d.black.toFixed(3)}），却换成了 ${d.ink}`);
  } else if (!d.unreachable) {
    bad(`${GROUND} 保持了白字，但没被标成 unreachable —— AC4 要的是「保持它今天的字色【并逐套列出来】」，`
      + '报不出来的那一半就没有落地');
  } else {
    ok(`${GROUND}（白${d.white.toFixed(3)} / 黑${d.black.toFixed(3)}，都不过线）⟹ 保持今天的白字，且被标成 unreachable`);
  }
  // 反向对照：黑字**能**救的时候必须真的换过去，否则这一格用「一律不换」也能过。
  const RESCUABLE = '#b2a172';   // 生产站 site-bbf7a3d6，白 2.42 / 黑 7.76
  const d2 = ink.inkDecision(RESCUABLE);
  if (d2.ink !== ink.BLACK || !d2.switched || d2.unreachable) {
    bad(`反向对照 ${RESCUABLE}（白${d2.white.toFixed(3)} / 黑${d2.black.toFixed(3)}）应当换成纯黑，实际是 ${d2.ink}`);
  } else ok(`反向对照 ${RESCUABLE}（黑${d2.black.toFixed(3)} 过线）⟹ 真的换过去了，不是「一律不换」`);
}

console.log('⑦ 算不出来的输入必须【说出来】，不许混到「合格」那一侧（#1105）');
{
  // 🔴 夹具是**真表外科改一处**，不是手写的合成 CSS：`magenta-01.css` 那一句
  // `background-color: var(--color-primary-800);` 在整份表里出现 15 次，只有 `.services-list {…}`
  // 那个块里的那一条是被判的对象。（第一版探针拿 `String.replace` 换"第一处"，换到的是别的块，
  // 于是给出"改了也没变"的假读数 —— 所以下面每一次变异都先断言它真的改到了。）
  const SHEET = path.join(__dirname, '..', '..', 'public', 'themes', 'magenta-01.css');
  const raw = fs.readFileSync(SHEET, 'utf8');
  const PRIM = poolThemes['magenta-01'].colors.primary;
  const PAL = poolThemes['magenta-01'].colors;
  const BLOCK = /(\n\.services-list \{)([^}]*)(\})/;
  const DECL = / *background-color: var\(--color-primary-800\);\n/;
  const mutate = (decl) => raw.replace(BLOCK, (_, a, body, c) => a + body.replace(DECL, decl) + c);
  const CELL = 'btn-secondary 静止';

  // 阳性对照：没动过的真表必须解得出来、四格全部有数。没有这一格，下面的"全部 null"说明不了任何事。
  {
    const g = ink.outlineGroundFromCss(raw, PAL);
    const r = g && ink.buttonInkReport(PRIM, g.hex);
    if (!g) bad('阳性对照：没动过的 magenta-01.css 都解不出那块底 —— 这一整格的夹具是坏的');
    else if (!r) bad('阳性对照：magenta-01 的调色板算不出报告');
    else if (r.unresolved.length) bad(`阳性对照：没动过的真表上却有 ${r.unresolved.length} 格算不出来：${r.unresolved.join(' · ')}`);
    else ok(`阳性对照：没动过的真表 ⟹ 底 = ${g.hex}（${g.from}）· 四格全部有数 · 算不出来的 0 格`);
  }

  // 六种「读不出来」的输入。前两种是 #1105 点名的（QA2 ① / QA3 1），第三、四种是同一个形状的另两半，
  // 最后两种是 #1126：**前一条忘写分号**。
  //
  // 🔴 #1126 那两条为什么也该是 `null`，而不是「后面那条赢」：真浏览器里两条**一起作废**。
  //    实测（chromium，一次只差一个分号）：缺分号 ⟹ computed background-color = `rgba(0, 0, 0, 0)`；
  //    分号补齐 ⟹ `rgb(255, 255, 255)`；哪一条写在前面都一样。`postcss` 直接 `Missed semicolon` 拒绝解析。
  //    ⟹ 没有一个真话可以报，所以走 `null` + 调用方那条 🔴。改之前它报的是**前面**那条（primary-800），
  //    也就是一句关于另一块底的假话，而且一条警告都不打。
  const SHAPES = [
    ['background 简写', '  background: var(--color-primary-800);\n'],
    ['4 位带 alpha 的 hex', '  background-color: #abcd;\n'],
    ['8 位带 alpha 的 hex', '  background-color: #5e264380;\n'],
    ['渐变（本票之前就会 null 的那条，作对照）', '  background-color: linear-gradient(#000,#fff);\n'],
    ['#1126 前一条缺分号（var 在前）', '  background-color: var(--color-primary-800)\n  background-color: #ffffff;\n'],
    ['#1126 前一条缺分号（字面量在前）', '  background-color: #ffffff\n  background-color: var(--color-primary-800);\n'],
  ];
  const wrong = [];
  for (const [what, decl] of SHAPES) {
    const css = mutate(decl);
    if (css === raw) { wrong.push(`${what}：变异没改到那个块 —— 这一条在空过`); continue; }
    const g = ink.outlineGroundFromCss(css, PAL);
    if (g) { wrong.push(`${what}：解出了 ${JSON.stringify(g)}，应当是 null（读不出来就别猜）`); continue; }
    // 调用方（`sync-config.js`）此时传的是 `null`，不是白 —— 「不知道」和「是白的」是两个读数。
    const r = ink.buttonInkReport(PRIM, null);
    if (!r) { wrong.push(`${what}：报告整份是 null，而只有那一格该算不出来`); continue; }
    if (Number.isFinite(r.cells[CELL])) wrong.push(`${what}：底不知道，${CELL} 却报出了 ${r.cells[CELL]}`);
    if (!r.unresolved.some((u) => u.startsWith(CELL))) wrong.push(`${what}：${CELL} 没进 unresolved —— 报不出来就等于没这一条`);
    if (r.under.some((u) => u.startsWith(CELL))) wrong.push(`${what}：${CELL} 进了 under —— 那是"量出来低于线"，不是"算不出来"`);
    if (r.outlineGround !== null) wrong.push(`${what}：report.outlineGround = ${JSON.stringify(r.outlineGround)}，应当是 null`);
  }
  if (wrong.length) bad(`${wrong.length} 处：${wrong.join(' · ')}`);
  else ok(`${SHAPES.length} 种读不出来的底（简写 / 4 位 hex / 8 位 hex / 渐变 / 缺分号 ×2）⟹ 全部 null，`
    + `且 ${CELL} 落进 unresolved、没落进 under`);

  // ── #1126 —— 缺分号那一条的三个配套读数 ────────────────────────────────────────────────────
  //
  // 上面那张表只问「是不是 null」。这里问另外三件，少了任何一件那一格都能靠「一律返回 null」蒙过去：
  //   (a) 阳性对照：改坏修法那一行 ⟹ 它当场回到报**输的那条**（primary-800），也就是本票要治的那句假话
  //   (b) 合法的「块里最后一条不带分号」**仍然解得出来** —— 修法不许把这种正常写法也判成读不出来
  //   (c) 一条好的在前、一条坏的在后 ⟹ 取好的那条（浏览器就是这么算的：坏的那条被丢掉）
  // 变异体加载器 —— 两格共用（#1126 缺分号那格 + r2 块内注释那格）。
  // 🔴 读的是**真源码**再删掉被测那一行，不是照抄一份重新实现（QA1 #1126 r1 非阻断 1）。
  const Module = require('module');
  const SRC = path.join(__dirname, 'button-ink.js');
  const srcText = fs.readFileSync(SRC, 'utf8');
  const loadMutant = (find, replacement, label) => {
    const hits = srcText.split(find).length - 1;
    if (hits !== 1) return { err: `变异目标在源码里出现 ${hits} 次（要 1 次）：${label}` };
    const mod = new Module(SRC, module);
    mod.filename = SRC;
    mod.paths = Module._nodeModulePaths(path.dirname(SRC));
    try { mod._compile(srcText.replace(find, replacement), SRC); } catch (e) {
      return { err: `变异体编译不过：${label} —— ${e.message}` };
    }
    return { mod: mod.exports };
  };

  {
    const problems = [];

    // (a) 阳性对照 —— **改真源码那一行,不是照抄一份再实现**（QA1 在 #1126 r1 点的：手抄那份
    //     不会跟着真谓词漂移，真那一行以后被重写它照样绿 ⟹ 那一格就不再控任何东西）。
    //     做法：把 `button-ink.js` 的源码读进来、删掉被测的那一行、用**它自己的文件名**编译一份
    //     （文件名对了，里面 `require('../theme-contrast.js')` 才解析得到），然后问这份变异体。
    //     每一次变异都先断言"真的改到了"，否则这一格是空的。

    // M1：删掉「前一条没终止 ⟹ 整条作废」那一句 continue ⟹ 必须回到报**输的那条**（本票要治的假话）
    const FIX_LINE = "        if (d[1] === 'background-color' && /[-a-zA-Z]+\\s*:/.test(value)) continue;  // 前一条没终止 ⟹ 整条作废\n";
    const m1 = loadMutant(FIX_LINE, '', 'M1 缺分号那句 continue');
    const fixtureA = mutate('  background-color: var(--color-primary-800)\n  background-color: #ffffff;\n');
    const realSaid = ink.outlineGroundFromCss(fixtureA, PAL);
    if (m1.err) problems.push(m1.err);
    else {
      const said = m1.mod.outlineGroundFromCss(fixtureA, PAL);
      if (!said || said.from !== '.services-list → primary-800') {
        problems.push(`M1 阳性对照立不起来：删掉那一句 continue 之后应当报「.services-list → primary-800」，`
          + `实际是 ${JSON.stringify(said)} —— 这一格分不出改前改后，上面的绿不算`);
      } else if (realSaid !== null) {
        problems.push(`修法那一版没有回 null，而是 ${JSON.stringify(realSaid)}`);
      }
    }


    // (b) 合法的「最后一条不带分号」不许被误伤。用合成块，因为真表那一条后面还有 `color:`。
    const LEGAL = '\n.services-list {\n  display: grid;\n  background-color: #ffffff\n}\n';
    const legal = ink.outlineGroundFromCss(LEGAL, PAL);
    if (!legal || legal.hex !== '#ffffff') {
      problems.push(`合法的「块里最后一条不带分号」被判成读不出来了：${JSON.stringify(legal)}`
        + ' —— 那是正常 CSS，修法不许误伤它');
    }

    // (c) 好的在前、坏的在后 ⟹ 取好的那条（浏览器丢掉坏的那条，前面那条照样生效）。
    const MIXED = '\n.services-list {\n  background-color: #ffffff;\n  background-color: var(--color-primary-800)\n  color: red;\n}\n';
    const mixed = ink.outlineGroundFromCss(MIXED, PAL);
    if (!mixed || mixed.hex !== '#ffffff') {
      problems.push(`「好的在前、坏的在后」应当取前面那条 #ffffff，实际是 ${JSON.stringify(mixed)}`);
    }

    if (problems.length) bad(`#1126 缺分号：${problems.length} 处 —— ${problems.join(' · ')}`);
    else {
      ok('#1126 缺分号：M1 阳性对照改真源码（删掉那句 continue ⟹ 报 .services-list → primary-800）· 修法回 null'
        + ' · 合法的「最后一条不带分号」仍解得出 #ffffff · 「好的在前坏的在后」取前面那条'
        + ' · 详见下一格 #1126 r2');
    }
  }

  // ── #1126 r2 —— 声明前面有一行注释（合法 CSS）不许被当成「一条画底的都没有」 ─────────────────
  // 自己一格，因为它钉的是**另一个**失败形态：r1 的修法在这个输入上不是「读不出来」，而是印出一句
  // **关于这个站的正面断言**（「没有任何一条画底 ⟹ 页面白」），0 条警告，而档位比不改还差。
  {
    const p2 = [];
    // ── #1126 r2 —— 声明**前面有一行注释**（合法 CSS）不许被当成「一条画底的都没有」 ────────────
    //   这是 r1 的修法开的口子，QA1 实测过：真表只加一行注释，真管道 rc=0、印出「页面白」那句假话，
    //   档位从 primary-200（真底上 6.679）掉到 primary-600（真底上 1.779，线 4.5）——**比不改还差**，
    //   而且 0 条警告。失败方向是那句**关于这个站的正面断言**，正是 #1105 与本票存在的理由。
    const fixtureC = mutate('  /* #1072 那种块内注释——合法 CSS */\n  background-color: var(--color-primary-800);\n');
    const withComment = ink.outlineGroundFromCss(fixtureC, PAL);
    if (!withComment || withComment.from !== '.services-list → primary-800') {
      p2.push(`声明前面一行注释（合法 CSS）⟹ 应当照样报「.services-list → primary-800」，`
        + `实际是 ${JSON.stringify(withComment)}`);
    }
    // 这一格由**两道**互相独立的防线守着，所以要两个阳性对照，各钉一条真源码行：
    //   剥注释那一句 → 决定「能不能读出【真】的那块底」
    //   宽判据那一句 → 决定「读不出来时会不会掉到那句关于这个站的假话」
    // 只删前者仍然是 null（诚实的读不出来 + 一条 🔴）；两条都删才回到 r1 那个 0 警告的假话。
    const STRIP = ".replace(/\\/\\*[\\s\\S]*?\\*\\//g, '')";
    const LOOSE = "        if (/(?:^|[\\s;{])background(?:-color)?\\s*:/.test(seg)) sawPaint = true;\n";

    const m2 = loadMutant(STRIP, '', 'M2 函数开头那句剥注释');
    if (m2.err) p2.push(m2.err);
    else {
      const said = m2.mod.outlineGroundFromCss(fixtureC, PAL);
      if (said !== null) {
        p2.push(`M2 阳性对照立不起来：只删掉剥注释那一句时应当是 null（读不出来，由调用方打 🔴），`
          + `实际是 ${JSON.stringify(said)} —— 那说明真读数不是剥注释挣来的`);
      }
    }

    // M4：两条都删 = r1 那一版 ⟹ 必须回到「没有任何一条画底」那句 0 警告的假话
    const m4 = (() => {
      const hitsA = srcText.split(STRIP).length - 1;
      const hitsB = srcText.split(LOOSE).length - 1;
      if (hitsA !== 1 || hitsB !== 1) return { err: `M4 变异目标不唯一（剥注释 ${hitsA} 次 · 宽判据 ${hitsB} 次）` };
      const mod = new Module(SRC, module);
      mod.filename = SRC;
      mod.paths = Module._nodeModulePaths(path.dirname(SRC));
      try { mod._compile(srcText.replace(STRIP, '').replace(LOOSE, ''), SRC); } catch (e) {
        return { err: `M4 变异体编译不过：${e.message}` };
      }
      return { mod: mod.exports };
    })();
    if (m4.err) p2.push(m4.err);
    else {
      const said = m4.mod.outlineGroundFromCss(fixtureC, PAL);
      if (!said || !/没有任何一条画底/.test(said.from || '')) {
        p2.push(`M4 阳性对照立不起来：两条都删（= r1 那一版）时应当掉回「没有任何一条画底」那句假话，`
          + `实际是 ${JSON.stringify(said)} —— 这一格分不出 r1 与 r2`);
      }
    }
    if (p2.length) bad(`#1126 r2 块内注释：${p2.length} 处 —— ${p2.join(' · ')}`);
    else {
      ok('#1126 r2：声明前一行注释（合法 CSS）照样解得出 .services-list → primary-800'
        + ' · 两道防线各一个阳性对照，都改真源码 —— 只删剥注释 ⟹ null（诚实的读不出来）；'
        + '剥注释与宽判据两条都删（= r1 那一版）⟹ 掉回「没有任何一条画底」那句假话');
    }
  }

  // 🔴 反向对照 A：这一格必须分得出「本票之前那版」。之前调用方把解不出来的底换成白 ——
  //    那一格于是报出一个**过线的**数（白底上 500 档往往合格），正好把这条盖住。
  {
    const r = ink.buttonInkReport(PRIM, ink.WHITE);
    if (!Number.isFinite(r.cells[CELL]) || r.cells[CELL] < MIN) {
      bad(`反向对照 A：拿白底替它答时 ${CELL} 并没有报成合格（${r.cells[CELL]}）—— 这一格分不出改前改后`);
    } else if (r.unresolved.length) {
      bad('反向对照 A：白底是一个能算的颜色，不该有算不出来的格子');
    } else {
      // 🔴 两个数必须是**同一档**在两块底上的读数，否则比的是两件事。
      const shade = ink.outlineShadeFor(PRIM, ink.WHITE);
      ok(`反向对照 A：拿白底替它答 ⟹ 选到 primary-${shade}、${CELL} = ${r.cells[CELL].toFixed(3)} ≥ ${MIN}`
        + `（合格）；同一档压它真正坐的那块底 #5e2643 是 ${ink.ratio(PRIM[shade], '#5e2643').toFixed(3)}`
        + ' ⟹ 改前那版确实会把它报成过线');
    }
  }

  // 🔴 反向对照 B：`under` 那条判据本身。旧的写法是 `v < MIN`，而 `NaN < 4.5` 恒为假 ⟹ 算不出来的
  //    格子会静默落到"合格"那一侧。这里造出一个**底色算不出来的 hover 格**，再拿旧谓词跑一遍，
  //    必须出现分歧。
  //
  // 🔴 夹具换过一次，原因写在这里（#1105 r2 → r3 rebase 到 #1091 之后）：原来用的是**缺 600 档**的
  //    调色板（QA3 在 #1084 实测的第二处：hover 落回不存在的 600）。#1091 重写了 `hoverShadeFor` ——
  //    候选档现在是从 `palette` 自己现算的，兜底是「那个方向上离 base 最近的那一档」`beyond[0]` /
  //    `other[0] || base`，**返回的档必然在这份调色板里**。所以「缺档 ⟹ hover 底是 undefined」这条路
  //    被 #1091 关掉了（实测：`{50,500}` 那份夹具现在 hoverShade = 50，不再是 600）。
  //    另一条路没关：**档在、但它的值不是能算的颜色**（本票 ② 那一类，`#abcd`）。`hoverShadeFor` 只
  //    要求 `typeof === 'string'`，`#abcd` 通过；`passes()` 对它是假 ⟹ 落到 `beyond[0]` 就是它自己。
  {
    const gap = { 50: '#ffffff', 500: '#8a2b5e', 600: '#abcd' };
    const r = ink.buttonInkReport(gap, ink.WHITE);
    const HOVER = 'btn-primary hover';
    const oldPredicate = Object.entries(r.cells).filter(([, v]) => v < MIN).map(([k]) => k);
    if (r.hoverShade !== '600') {
      bad(`反向对照 B：夹具没造出那个形状 —— hoverShade = ${r.hoverShade}，要的是落到值算不出来的 600`);
    } else if (Number.isFinite(r.cells[HOVER])) {
      bad(`反向对照 B：${HOVER} 的底（primary-600 = "#abcd"）算不出来，却报出了 ${r.cells[HOVER]}`);
    } else if (!r.unresolved.some((u) => u.startsWith(HOVER))) {
      bad(`反向对照 B：${HOVER} 算不出来却没进 unresolved`);
    } else if (oldPredicate.includes(HOVER)) {
      bad(`反向对照 B：旧谓词 \`v < ${MIN}\` 竟然抓到了 ${HOVER} —— 那这一格证不出它是个洞`);
    } else {
      ok(`反向对照 B：600 档的值是 "#abcd" ⟹ ${HOVER} 算不出来、进了 unresolved；而旧谓词 \`v < ${MIN}\``
        + ` 抓到的是 ${JSON.stringify(oldPredicate)}（不含它）⟹ 那个洞是真的`);
    }
  }

  // 🔴 顺带把上面那句「#1091 关掉了缺档那条路」也钉住 —— 它是一条关于**别人代码**的断言，写在注释里
  //    就会过期。缺档的调色板现在必须落到一个**存在的**档上。
  {
    const missing = { 50: '#ffffff', 500: '#8a2b5e' };
    const r = ink.buttonInkReport(missing, ink.WHITE);
    if (typeof missing[r.hoverShade] !== 'string') {
      bad(`hoverShadeFor 选了一个这份调色板里没有的档 primary-${r.hoverShade} —— 上面那条注释说的`
        + '「#1091 之后返回的档必然存在」已经不成立了，反向对照 B 的夹具理由要重写');
    } else {
      ok(`缺档的调色板（只有 50 / 500）⟹ hover 落到存在的 primary-${r.hoverShade}`
        + '（#1091 关掉了「缺档 ⟹ 底是 undefined」那条路，所以反向对照 B 走的是「值算不出来」那条）');
    }
  }

  // 一份配色本身算不出来时，整份报告是 null（调用方那条路会印"跳过"），不是四格 NaN。
  {
    const bogus = Object.assign({}, PRIM, { 500: '#abcd' });
    if (ink.buttonInkReport(bogus, ink.WHITE) !== null) bad('primary-500 = #abcd（4 位带 alpha）时报告不是 null');
    else if (ink.buttonInkReport(Object.assign({}, PRIM, { 500: '#5e264380' }), ink.WHITE) !== null) bad('primary-500 = 8 位带 alpha 时报告不是 null');
    else if (ink.buttonInkReport(PRIM, ink.WHITE) === null) bad('反向对照：正常的 6 位 primary-500 也被判成算不出来');
    else ok('primary-500 带 alpha（4 位 / 8 位）⟹ 整份报告 null（调用方印"跳过"）；正常 6 位不受影响');
  }

  // 🔴 #1100 r2 —— accent 那两格也必须走这条纪律，而**只有这一格在判它**。上面每一格喂的都是纯
  //    primary 的调色板（不带 accent）⟹ `accentPresent` 为假 ⟹ accent 那两格根本不存在，所以
  //    ⑦ 的其余部分对它们按构造是盲的。r1 那一版的门是 `typeof accent['400'] === 'string'`，
  //    而带 alpha 的 `#rrggbbaa` 是字符串 —— 它会算出「完全不透明那块底上的数」并当合格报出去。
  {
    const cellsOf = (accent) => ink.buttonInkReport(PRIM, ink.WHITE, accent);
    // ① 根本没有 accent 这一组 ⟹ 那两格不存在（今天绝大多数站的形状），也不该出现在 unresolved 里
    const none = cellsOf(null);
    const noneNames = Object.keys(none.cells).filter((n) => n.startsWith('btn-accent'));
    // ② 有这一档、值正常 ⟹ 两格都有数
    const good = cellsOf({ 300: '#fcd34d', 400: '#fbbf24', 500: '#f59e0b' });
    const goodNames = Object.keys(good.cells).filter((n) => n.startsWith('btn-accent'));
    const goodFinite = goodNames.filter((n) => Number.isFinite(good.cells[n]));
    // ③ 有这一档、但**读不出来**（8 位带 alpha）⟹ 两格都进 unresolved，不许静默、不许当合格
    const alpha = cellsOf({ 300: '#fcd34d', 400: '#fbbf2480', 500: '#f59e0b' });
    const alphaUnres = alpha.unresolved.filter((u) => u.startsWith('btn-accent'));
    const alphaUnder = (alpha.under || []).filter((u) => String(u).startsWith('btn-accent'));
    // 🔴 反向对照要**跑出那个假数**，不能只问「r1 那道门会不会放行」：`typeof '…' === 'string'`
    //    是个恒真式，它对本模块的两种实现给出同一个答案 ⟹ 按构造分不出对错。所以这里照 r1 那道门
    //    的语义自己算一遍：门放行 ⟹ 那一格会拿 `#fbbf2480` 去 `ratio()`，而 `hexToRgb` 只取前 6 位
    //    ⟹ 算出来的是「完全不透明那块底」上的数，并且它**过线**，于是当合格报出去。
    const OLD_GATE_VALUE = '#fbbf2480';
    const oldGateLetsThrough = typeof OLD_GATE_VALUE === 'string' && !ink.isColourLiteral(OLD_GATE_VALUE);
    const oldGateLaunderedRatio = ink.ratio(ink.ACCENT_INK, OLD_GATE_VALUE);
    const oldGateWouldPass = Number.isFinite(oldGateLaunderedRatio) && oldGateLaunderedRatio >= MIN;
    if (noneNames.length) {
      bad(`没有 accent 那一组时却产出了 ${noneNames.join(' / ')} —— 这是给一个不存在的按钮报读数`);
    } else if (goodNames.length !== 2 || goodFinite.length !== 2) {
      bad(`accent 正常时那两格没有都拿到数：${JSON.stringify(good.cells)}`);
    } else if (alphaUnres.length !== 2) {
      bad(`accent-400 = "#fbbf2480"（8 位带 alpha）时，accent 那两格进 unresolved 的只有 `
        + `${alphaUnres.length} 个（期望 2）：${JSON.stringify(alpha.unresolved)}`);
    } else if (alphaUnder.length) {
      bad(`算不出来的 accent 格子混进了 under：${JSON.stringify(alphaUnder)}`);
    } else if (!oldGateLetsThrough) {
      bad(`反向对照写坏了：${OLD_GATE_VALUE} 没有落在「r1 那道门放行、本票这道门拦住」那一段`
        + ' —— 这一格分不出两种实现');
    } else if (!oldGateWouldPass) {
      bad(`反向对照写坏了：r1 那道门放行之后算出来的是 ${oldGateLaunderedRatio}，它并没有过线`
        + ' ⟹ 这一格证不出「假数会当合格报出去」，得换一个会过线的夹具值');
    } else {
      ok('accent 两格走的是 pairs 那条纪律：没有 accent ⟹ 0 格（不给不存在的按钮报数）· 值正常 ⟹ 2 格都有数'
        + ` · 8 位带 alpha ⟹ 2 格都进 unresolved 且没混进 under。反向对照（真跑出那个假数）：r1 那道门`
        + ` 放行 ${OLD_GATE_VALUE} ⟹ 拿它算出 ${oldGateLaunderedRatio.toFixed(3)} ≥ ${MIN}`
        + '（那是「完全不透明那块底」上的数）⟹ 会当合格报出去');
    }
  }

  // `isColourLiteral` 的真值表 —— 这条判据是上面每一格的地基，单独钉一次。
  {
    const yes = ['#fff', '#FFF', '#5e2643', '#5E2643'];
    const no = ['#abcd', '#5e264380', '#ab', '#abcde', 'red', 'var(--color-primary-800)', '', undefined, null, 123];
    const badYes = yes.filter((v) => !ink.isColourLiteral(v));
    const badNo = no.filter((v) => ink.isColourLiteral(v));
    if (badYes.length || badNo.length) bad(`isColourLiteral 判错：该认的没认 ${JSON.stringify(badYes)} · 不该认的认了 ${JSON.stringify(badNo)}`);
    else ok(`isColourLiteral：${yes.length} 个该认的全认、${no.length} 个不该认的全拒（4 位/8 位带 alpha 在拒的那边）`);
  }
}

// 📌 ⑦ 与 ⑧ 是两张票各自往这个文件末尾插的一段：⑦ 是 #1105（算不出来的输入要说出来），⑧ 是 #1091
// （`underNote()` 印的数不许否掉它自己）。#1091 先 ship，当时 ⑦ 还空着，那段注释解释了为什么空号；
// #1105 rebase 到 #1091 之上时把 ⑦ 填了回来，冲突就是照它说的「两段都留」解的，序号现在是连的。
// 🔴 rebase 那次还改了 ⑦ 的反向对照 B：它原来的夹具（缺 600 档）被 #1091 重写的 `hoverShadeFor`
// 关掉了，换成了「档在、值算不出来」那条路，理由与实测写在那一格自己的注释里。
console.log('⑧ `underNote()` 印出来的那句话本身：它印的每个数都必须支持它自己的断言（#1091 r3，QA2 r2 的发现）');
{
  /**
   * 判一句 note 是不是在说假话。**只用这句话自己印出来的东西 + 它命名的那个主体**去判 ——
   * 这正是上一版漏掉的那一层：那句话把「白字 X / 纯黑 Y」跟「两个都低于 4.5」写在同一行，X 是 5.47。
   *
   * @returns {string[]} 每一条都是「这句话的哪个字被它自己的哪个数否掉了」
   */
  function liesIn(note, report, palette) {
    const lies = [];
    if (note === null) return lies;
    const num = (re) => { const m = note.match(re); return m ? Number(m[1]) : null; };
    const white = num(/白字 (\d+\.\d+)/);
    const black = num(/纯黑 (\d+\.\d+)/);
    const floor = num(/下限 (\d+\.\d+)/);
    const shade = (note.match(/primary-(\d{2,3}) 上白字/) || [])[1];
    if (floor !== MIN) lies.push(`它自己印的下限是 ${floor}，不是 ${MIN}`);
    // ① 「两个都低于 4.5」——这半句只能在两个数真的都低于时说。r2 那句话死在这一条上。
    if (/两个都低于/.test(note) && !(white < MIN && black < MIN)) {
      lies.push(`说「两个都低于 ${MIN}」，而它同一行印的是白字 ${white} / 纯黑 ${black}`);
    }
    // ② 「换字色救不回来」这个结论 ⟺ `inkUnreachable`（两向都判，不然「一律不说」也能过）。
    if (/换字色救不回来/.test(note) !== !!report.inkUnreachable) {
      lies.push(report.inkUnreachable
        ? '两种字色在选中那一档都不过线，却没说「换字色救不回来」'
        : `说了「换字色救不回来」，而 inkUnreachable=false（选中的${report.ink === ink.BLACK ? '深字' : '白字'}在 primary-${report.baseShade} 上是 ${report.cells['btn-primary 静止'].toFixed(3)}）`);
    }
    // ③ 它印的那两个数必须真的是**它点名那一档**上的读数 —— 主体漂走正是 r2 那次的成因。
    if (!shade) lies.push('两个读数没点名是压在哪一档上量的');
    else if (typeof palette[shade] !== 'string') lies.push(`它点名的 primary-${shade} 在这套配色里不存在`);
    else {
      // 🔴 **不重算一遍那个印数函数**（两份实现必然分叉，本仓为这件事付过账）：这里判的是两条性质 ——
      // ⓐ 印出来的数与那一档上真的量出来的差不超过一个显示单位（= 主体没漂）；
      // ⓑ 印出来的数**不大于**真值（`showRatio` 朝下取的那条性质）。有了 ⓑ，判据 ① 的「低于门槛」
      //    才不会被显示位数四舍五入到门槛上（`gray-119` 就是这么被抓住的）。
      const w = ink.ratio(ink.WHITE, palette[shade]);
      const b = ink.ratio(ink.BLACK, palette[shade]);
      for (const [label, printed, real] of [['白字', white, w], ['纯黑', black, b]]) {
        if (Math.abs(printed - real) > 0.001) {
          lies.push(`它说 primary-${shade} 上${label} ${printed}，那一档真的量出来是 ${real.toFixed(4)}`);
        } else if (printed > real + 1e-9) {
          lies.push(`${label} 印成 ${printed} 比真值 ${real.toFixed(4)} 大 —— 印数是往上取的，会把「低于门槛」印成门槛`);
        }
      }
    }
    // ④ 列进「仍然读不出来的」那几格，每一格印的数都得真的低于下限。
    for (const cell of (note.match(/[^：· ]+=\d+\.\d+/g) || [])) {
      const v = Number(cell.split('=')[1]);
      if (!(v < MIN)) lies.push(`把 ${cell} 列成读不出来，可它 ≥ ${MIN}`);
    }
    // ⑤ 「主按钮自己那两格都过线了」只能在两格真的都过线时说。
    if (/主按钮自己那两格都过线/.test(note)) {
      for (const k of ['btn-primary 静止', 'btn-primary hover']) {
        if (report.cells[k] < MIN) lies.push(`说主按钮两格都过线，而 ${k}=${report.cells[k].toFixed(3)}`);
      }
    }
    return lies;
  }

  // ── 夹具：注册表 110 套（池主题用它自己那张表解出来的真底）+ 生产 6 套 + 两套人造的
  const fixtures = [];
  for (const [id, t] of Object.entries(themes)) {
    const p = t.colors && t.colors.primary; if (!p) continue;
    const g = (id in poolThemes) ? groundOfTheme(id) : null;
    if (g && g.err) { bad(`§⑧ 夹具立不起来：${g.err}`); continue; }
    // #1100 —— accent 也喂进去：`under` 现在可以含 accent 那两格，而这一节判的是「这句话印的数支持
    // 它自己的断言吗」⟹ 不喂的话它对新加的那两格按构造是盲的。
    fixtures.push({ id, palette: p, ground: g ? g.hex : ink.WHITE, accent: t.colors && t.colors.accent });
  }
  for (const [id, p] of Object.entries(PROD)) fixtures.push({ id: `prod/${id}`, palette: p, ground: ink.WHITE });
  // 灰阶 114…119 = ①a 那 6 个色阶宽的段，`inkUnreachable` 那一支唯一能到达的形状（注册表上 0 套）。
  for (let g = 114; g <= 119; g += 1) {
    const hex = `#${[g, g, g].map((v) => v.toString(16).padStart(2, '0')).join('')}`;
    fixtures.push({ id: `gray-${g}`, palette: { 50: '#ffffff', 400: hex, 500: hex, 600: hex, 700: hex }, ground: ink.WHITE });
  }
  // 非单调调色板：base 那一档过线、而 hover 那个方向上一档都不过线 —— 第三支（`primaryUnder`）的夹具。
  // 客人的 brand.json 不保证单调，所以这一支不是死码。
  const NONMONO = { 50: '#ffffff', 400: '#cccccc', 500: '#333333', 600: '#cccccc', 700: '#cccccc', 800: '#cccccc', 900: '#cccccc' };
  fixtures.push({ id: 'non-monotonic', palette: NONMONO, ground: ink.WHITE });
  // 🔴 #1100 —— 第三支（「上面这些不在主按钮上」）的夹具。
  //
  // **它必须是人造的，而这件事本身是本票的一个读数**：改动前那一支是被 `btn-secondary hover` 走到的
  // （59 套注册表配色），而本票把那一格变成了「与 `btn-primary 静止` 按构造同值」⟹ 它再也不能单独
  // 不过线，那一支当场变成死码（实测：本票只改完 button-ink.js 时这一格就报「没有夹具走到」）。
  // 今天能走到它的只有 accent 那两格：primary 健康、而 accent 色阶上 `gray-900` 一档都救不回来。
  // 客人的 brand.json 不保证 accent 是亮色阶，所以这一支也不是死码。
  const DARK_ACCENT = { 300: '#222222', 400: '#1a1a1a', 500: '#111111' };
  fixtures.push({
    id: 'dark-accent', palette: poolThemes[Object.keys(poolThemes)[0]].colors.primary,
    ground: ink.WHITE, accent: DARK_ACCENT,
  });

  const notes = fixtures.map((f) => {
    const r = ink.buttonInkReport(f.palette, f.ground, f.accent || null);
    return { ...f, report: r, note: r ? ink.underNote(r) : null };
  });
  const spoke = notes.filter((n) => n.note !== null);
  const lying = notes.flatMap((n) => liesIn(n.note, n.report, n.palette).map((l) => `${n.id}: ${l}`));

  // 三支各自都得有夹具走到 —— 空过的支等于没这一条。
  const armUnreachable = spoke.filter((n) => /换字色救不回来/.test(n.note));
  const armPrimaryUnder = spoke.filter((n) => /主按钮自己还有/.test(n.note));
  const armOthersOnly = spoke.filter((n) => /主按钮自己那两格都过线/.test(n.note));
  if (!spoke.length) bad(`§⑧ ${fixtures.length} 套夹具里没有一套打这一行 —— 这一格在空过`);
  else if (!armUnreachable.length) bad('§⑧「换字色救不回来」那一支没有夹具走到 —— 那半句话没被判过');
  else if (!armPrimaryUnder.length) bad('§⑧「主按钮自己还有…没过线」那一支没有夹具走到');
  else if (!armOthersOnly.length) bad('§⑧「上面这些不在主按钮上」那一支没有夹具走到');
  else if (lying.length) bad(`§⑧ ${lying.length} 句话被自己的数否掉：${lying.slice(0, 4).join(' · ')}`);
  else {
    ok(`${fixtures.length} 套夹具 · ${spoke.length} 套打了这一行（三支各 ${armUnreachable.length} / `
      + `${armPrimaryUnder.length} / ${armOthersOnly.length}）· 没有一句被自己印的数否掉`);
  }
  // 没有一格不过线时**不许**打这一行（另一半，否则「见谁都打」也能过上面那一格）。
  const silentButUnder = notes.filter((n) => n.note === null && n.report && n.report.under.length);
  const spokeButClean = spoke.filter((n) => !n.report.under.length);
  if (silentButUnder.length || spokeButClean.length) {
    bad(`§⑧ 触发条件与 under 不同步：该打没打 ${silentButUnder.length} 套 · 不该打却打了 ${spokeButClean.length} 套`);
  } else ok(`触发条件 ⟺ under 非空（${notes.length - spoke.length} 套四格全过线的，一句都没打）`);

  // 🔴 阳性对照：把 **r2 那句话**原样喂进同一个判据 —— 它必须被抓住，否则上面那些绿是空的。
  // 出处 `git show a7265c17:templates/nextjs/scripts/sync-config.js` 那三行模板字符串，夹具是 ember-04。
  const r2sample = notes.find((n) => n.id === 'ember-04');
  if (!r2sample || !r2sample.report) bad('§⑧ 阳性对照的夹具 ember-04 不在注册表里了 —— 这个对照已经立不起来');
  else {
    const r = r2sample.report;
    const r2note = `这套配色换字色救不回来 —— 白字 ${r.whiteRatio.toFixed(2)} / 纯黑 ${r.blackRatio.toFixed(2)}，`
      + `两个都低于 4.5（blended）⟹ 保持今天的白字。 仍然读不出来的：${r.under.join(' · ')}（下限 ${MIN}，blended）`;
    const caught = liesIn(r2note, r, r2sample.palette);
    if (caught.length < 2) {
      bad(`§⑧ 阳性对照没被抓住（只抓到 ${caught.length} 条）—— 这个判据咬不住 r2 那句话，上面的绿不算：${r2note}`);
    } else ok(`阳性对照（r2 那句话，ember-04）被抓住 ${caught.length} 条：${caught.join(' · ')}`);
  }
  // 第二个阳性对照：只把「它点名的那一档」改错一档 —— 判据 ③ 必须单独咬得住主体漂移。
  //
  // 🔴 #1100 —— 这个对照**换了夹具，而换掉它的理由本身是本票的一个读数**：它原来跟上面那个共用
  // `ember-04`，而 `ember-04` 今天已经**不打这一行了**（`underNote` 回 `null` ⟹ 上一版在这里
  // `.replace` 一个 null 当场抛 TypeError）。为什么不打了：改动前它的 `under` 里只有
  // `btn-secondary hover`（字按 500 算、底是 500），而本票把那一格换成了主按钮静止态那一对，它过线
  // ⟹ 四格全过 ⟹ 不该打这一行，也真的没打。所以这里改成「拿任意一个**真的打了**这一行的夹具」，
  // 并把它的名字打出来 —— 钉死一个具体 id 就是把「今天谁不过线」写进测试，那个集合会随配色变。
  // 🔴 漂到哪一档也不许写死：`primary-500` 恰好是许多夹具**自己**那一档（`baseShadeFor` 一档都不过线时
  // 落回 500），那时这个 `.replace` 是空操作、对照静默立不起来（实测：第一版取 `spoke[0]` = `gray-114`，
  // 它的 base 就是 500 ⟹ 当场报「找不到 primary-<档> 上白字」）。所以要现找一档：**同一套配色里读数
  // 真的不同的**那一档 —— 那才是「主体漂了」。
  const driftPair = spoke.map((n) => {
    const base = n.report.baseShade;
    const alt = Object.keys(n.palette).find((sh) => sh !== base
      && typeof n.palette[sh] === 'string'
      && Math.abs(ink.ratio(ink.WHITE, n.palette[sh]) - ink.ratio(ink.WHITE, n.palette[base])) > 0.001);
    return alt ? { n, alt } : null;
  }).find(Boolean);
  if (!driftPair) {
    bad('§⑧ 找不到「打了这一行、且同一套配色里另有一档读数不同」的夹具 ⟹ 主体漂移那个对照立不起来');
  } else {
    const { n: drifter, alt } = driftPair;
    const dr = drifter.report;
    const drifted = drifter.note.replace(`primary-${dr.baseShade} 上白字`, `primary-${alt} 上白字`);
    if (drifted === drifter.note) {
      bad(`§⑧ 主体漂移那个对照没造出来（${drifter.id} 这句话里找不到 \`primary-${dr.baseShade} 上白字\`）—— 判据 ③ 没被验过`);
    } else if (!liesIn(drifted, dr, drifter.palette).some((l) => /真的量出来是/.test(l))) {
      bad(`§⑧ 把它点名的那一档从 ${dr.baseShade} 改成 ${alt}（${drifter.id}），判据 ③ 没红 —— 主体漂移这一层是空的`);
    } else ok(`阳性对照 2（夹具 ${drifter.id}）：把它点名的 primary-${dr.baseShade} 改成 primary-${alt}，`
      + '判据 ③ 当场红（主体漂移咬得住）');
  }
}

console.log(failed ? `\n🔴 ${failed} 格失败` : '\n✅ 全过');
process.exit(failed ? 1 : 0);
