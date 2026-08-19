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
 *    实现都全绿的检查证不出「修好了」。能区分的夹具是**冻结退役的那 30 套**（`themes` 110 −
 *    `poolThemes` 80）和生产上那 6 份 brand.json。
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
const { themes, poolThemes } = require('../themes.js');

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
    ink: ink.WHITE, hoverShade: ink.TODAY.hover, outlineShade: ink.TODAY.outline, ground,
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

console.log('② 注册表 110 套：凡是【换得过去】的都过线；换不过去的保持今天的字色（票正文 AC4 的谓词）');
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
      hopeless.push(id);
      if (r.ink !== ink.WHITE) wrong.push(`${id} 两种字色都不够(白${w.toFixed(3)}/黑${b.toFixed(3)})却换了 —— 换过去不解决问题`);
      if (!r.inkUnreachable) wrong.push(`${id} 两种字色都不够却没被标成 unreachable —— 报不出来就等于没这一条`);
    }
  }
  if (!rescuable.length) {
    bad('注册表里没有任何一套「白字不够、纯黑够」—— 这一格的正方向夹具是空的，它在空过');
  } else if (!hopeless.length) {
    bad('注册表里没有任何一套「两种字色都不够」—— 这一格的反方向夹具是空的，它在空过');
  } else if (wrong.length) {
    bad(`${wrong.length} 处判错：${wrong.slice(0, 6).join(' · ')}`);
  } else {
    ok(`110 套里 ${rescuable.length} 套换得过去（全部换了且过线）· ${hopeless.length} 套换不过去（全部保持白字且被标出来）`);
  }

  // 区分力：改前那份（写死白字）在退役 30 套上判错的，模块必须判对。
  const retired = Object.keys(themes).filter((id) => !(id in poolThemes));
  const fixable = retired.filter((id) => {
    const p = themes[id].colors && themes[id].colors.primary; if (!p) return false;
    return ink.ratio(ink.WHITE, p['500']) < MIN && ink.ratio(ink.BLACK, p['500']) >= MIN;
  });
  if (retired.length !== 30) bad(`退役池是 ${retired.length} 套，不是 30 —— 夹具变了，先看是不是 #1016 的池子动了`);
  if (fixable.length < 5) {
    bad(`退役池里「白字不合格而纯黑能救」只剩 ${fixable.length} 套 —— 这个夹具已经不能区分对错了，别拿它当绿`);
  } else {
    const stillBad = fixable.filter((id) => ink.buttonInkReport(themes[id].colors.primary).cells['btn-primary 静止'] < MIN);
    if (stillBad.length) bad(`模块没修好其中 ${stillBad.length} 套：${stillBad.join(' ')}`);
    else ok(`退役池里 ${fixable.length} 套「白字不合格而能救」的，模块全部判到 ≥ ${MIN}`);
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
    const rows = [...Object.entries(themes).map(([id, t]) => [id, t.colors && t.colors.primary]),
      ...Object.entries(PROD)];
    for (const [id, p] of rows) {
      if (!p) continue;
      const mine = ink.buttonInkVars(p).map((d) => d.replace(/\s+/g, ''));
      const theirs = run({ colors: { primary: p } }).map((d) => d.replace(/\s+/g, ''));
      if (JSON.stringify(mine) !== JSON.stringify(theirs)) {
        mismatch.push(`${id}: 正本 ${JSON.stringify(mine)} vs 浏览器侧 ${JSON.stringify(theirs)}`);
      }
    }
    if (mismatch.length) bad(`${mismatch.length} 套对不上（白底那一档）：${mismatch.slice(0, 3).join(' | ')}`);
    else ok(`${rows.length} 套配色两份实现产出的三个变量逐字相同（页面上没有 services-list ⟹ 白底）`);

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
        const mine = ink.buttonInkVars(p, g.hex).map((d) => d.replace(/\s+/g, ''));
        const theirs = runWith(dom)({ colors: { primary: p } }).map((d) => d.replace(/\s+/g, ''));
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
      for (const [, p] of rows) {
        if (!p) continue;
        if (JSON.stringify(runRaw({ colors: { primary: p } })) !== JSON.stringify(run({ colors: { primary: p } }))) { diverged = true; break; }
      }
      if (!diverged) bad('把掺色系数改成 0 之后，两份产出在所有夹具上逐字相同 —— 这一格分不出裸尺和 blended');
      else ok('把掺色系数改成 0 会当场产生分歧 ⟹ 抠出来的那段确实在用 blended 那把尺');
    }

    // 反向对照 B：抠出来的确实是活代码，不是一段永远不产出的死码。
    const probe = run({ colors: { primary: { 500: '#ffffff', 400: '#ffffff', 600: '#000000' } } });
    if (!probe.some((d) => d.includes('--btn-primary-ink'))) {
      bad('浏览器侧那段对一个纯白 primary-500 什么都没产出 —— 抠出来的可能不是那段算术');
    } else if (!probe[0].includes('#000000')) {
      bad(`浏览器侧对纯白底给出的字色是 ${probe[0]}，应当是纯黑`);
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
  const inkFlips = []; const hoverMoves = []; const outlineMoves = []; const kept = [];
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
    if (r.hoverShade !== b4.hoverShade) {
      hoverMoves.push(`${id} ${b4.hoverShade}→${r.hoverShade}`);
      // 🔴 「本来够不够」要拿**选出来的那个字色**去问今天那一档，不是拿改动前的白字去问。
      // 字色一翻，600 那一档的读数就换了主体：magenta-27 白字压 600 是 5.43（够），可它的字色换成了
      // 纯黑，而纯黑压 600 不够 —— 拿 5.43 当理由会把一次正当的挪档判成违规（第一版就是这么红的）。
      const todayWithChosenInk = ink.ratio(r.ink, p[ink.TODAY.hover]);
      if (todayWithChosenInk >= MIN) unjustified.push(`${id} hover 本来就够(${todayWithChosenInk.toFixed(3)})却被挪了档`);
      else if (r.cells['btn-primary hover'] < MIN) unjustified.push(`${id} hover 挪了档却仍不过线 ${r.cells['btn-primary hover'].toFixed(3)}`);
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
    ok(`80 套：字色变 ${inkFlips.length}（${inkFlips.join(' ') || '无'}）· hover 变 ${hoverMoves.length}`
      + ` · 轮廓变 ${outlineMoves.length} —— 每一处都是「改动前不过线、换过去过线」，且没有一格比改动前更差`);
    ok(`两种字色都换不过去、按 AC4 保持今天白字的：${kept.length} 套（名单见 --list）`);
  }
  // 🔴 轮廓那一格单独一条断言 —— 它是本轮被退回的那一格，判据是 AC4 的字面：换得过去的都要过线。
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

console.log(failed ? `\n🔴 ${failed} 格失败` : '\n✅ 全过');
process.exit(failed ? 1 : 0);
