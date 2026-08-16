#!/usr/bin/env node
// ══════════════════════════════════════════════════════════════════════════════════════════════════
// generate.test.js — 生成出来的【调色板】要让产品自己的按钮读得出来，而且一批候选不能撞车（#1051 r3）
// ══════════════════════════════════════════════════════════════════════════════════════════════════
//
// 为什么这两格值得有：它们守的是两件**在生成器里看不出来、要到真页面上才炸**的事。
//
// ① 按钮上的字是**产品**画的，不是主题表画的。`globals.css:56-64` 写死了 `.btn-primary` 是白字压
//    `--color-primary-500`、`.btn-accent` 是 `gray-900` 的字压 `--color-accent-400`（hover 走 -500）。
//    所以调色板只要挑得不对，按钮上的字就读不出来 —— 而那套主题表本身一行都没错，静态那道闸也全绿。
//    实测（r2 那版生成器）：`gen-07-2` 的 primary-500 是 `#59c639`，`/services.html` 上 `.btn-primary`
//    的白字对底色只有 **2.16:1**，运行时那道检查（#1050，下限 2.5:1）把整套候选拦下。
//
// ② 一批候选里不能有「客人看不出区别」的两套。这一格跑的是**闸自己那把尺**（`gates.js` 的
//    `gateSimilarity`），不是这里另写一个相似度算法 —— 另写一个就只能证明我这把尺自洽。
const path = require('path');

const { generateCandidates } = require(path.join(__dirname, 'generate.js'));
const { gateSimilarity } = require(path.join(__dirname, 'gates.js'));

let pass = 0; let fail = 0;
const ok = (m) => { pass += 1; console.log(`  ✅ ${m}`); };
const bad = (m) => { fail += 1; console.log(`  ❌ ${m}`); };

// ── WCAG 对比度，就地算一遍 ─────────────────────────────────────────────────────────────────────
const lum = (hex) => {
  const v = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
    .map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * v[0] + 0.7152 * v[1] + 0.0722 * v[2];
};
const ratio = (a, b) => {
  const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
};
const WHITE = '#ffffff';
const GRAY900 = '#111827';
const FLOOR = 4.5;

/** 产品拿这套调色板画按钮时，最差的那一处是多少 —— 连是哪一处一起返回。 */
function worstButton(colors) {
  const cases = [
    ['.btn-primary 白字压 primary-500', WHITE, colors.primary['500']],
    ['.btn-primary:hover 白字压 primary-600', WHITE, colors.primary['600']],
    ['.btn-accent gray-900 压 accent-400', GRAY900, colors.accent['400']],
    ['.btn-accent:hover gray-900 压 accent-500', GRAY900, colors.accent['500']],
  ];
  let worst = Infinity; let who = '';
  for (const [name, ink, bg] of cases) {
    const r = ratio(ink, bg);
    if (r < worst) { worst = r; who = name; }
  }
  return { worst, who };
}

console.log('① 每套候选的调色板都要让产品自己的按钮读得出来');
const N = 80;
const cands = generateCandidates(N, { seed: 7 });
if (cands.length !== N) {
  console.error(`🔴 跑不起来：要了 ${N} 套，拿到 ${cands.length} 套`);
  process.exit(2);
}
{
  let worst = Infinity; let worstId = ''; let worstWho = '';
  for (const c of cands) {
    const r = worstButton(c.tokens.colors);
    if (r.worst < worst) { worst = r.worst; worstId = c.id; worstWho = r.who; }
  }
  if (worst >= FLOOR) ok(`${N} 套里最差的一处是「${worstWho}」= ${worst.toFixed(2)}:1（≥ ${FLOOR}，${worstId}）`);
  else bad(`${worstId} 的「${worstWho}」只有 ${worst.toFixed(2)}:1，低于 ${FLOOR} —— 按钮上的字读不出来`);
}

// 🔴 反向对照：这把判据必须真的能判红。生成器里那段把亮度拉回去的remap 如果不做，同样这批色相
// 里就有过不了的 —— 拿【没有 remap 的老算法】喂同一个判据，它不报红就说明上面那一圈绿是空的。
{
  const hslToHex = (h, s, l) => {
    const a = s * Math.min(l, 1 - l);
    const f = (n) => {
      const k = (n + h / 30) % 12;
      const c = l - a * Math.max(-1, Math.min(k - 3, Math.min(9 - k, 1)));
      return Math.round(255 * c).toString(16).padStart(2, '0');
    };
    return `#${f(0)}${f(8)}${f(4)}`;
  };
  const SHADES = {
    50: 0.96, 100: 0.9, 200: 0.82, 300: 0.7, 400: 0.6, 500: 0.5, 600: 0.42, 700: 0.34, 800: 0.26, 900: 0.16,
  };
  let below = 0; let worst = Infinity;
  for (let i = 0; i < N; i += 1) {
    const hue = (7 * 47 + i * 137.5) % 360;
    const accentHue = (hue + 150 + i * 53) % 360;
    const sat = [0.42, 0.55, 0.68, 0.5][i % 4];
    const asat = [0.6, 0.72, 0.52][i % 3];
    const colors = {
      primary: Object.fromEntries(Object.keys(SHADES).map((k) => [k, hslToHex(hue, sat, SHADES[k])])),
      accent: Object.fromEntries(['50', '100', '200', '300', '400', '500', '600'].map((k) => [k, hslToHex(accentHue, asat, SHADES[k])])),
    };
    const r = worstButton(colors);
    if (r.worst < FLOOR) below += 1;
    if (r.worst < worst) worst = r.worst;
  }
  if (below > 0) ok(`反向对照：不做那段亮度重映射，同一批色相里有 ${below}/${N} 套过不了（最差 ${worst.toFixed(2)}:1）—— 判据分得开好坏`);
  else bad(`反向对照失败：老算法一套都没被判红（最差 ${worst.toFixed(2)}:1），上面那一圈绿证明不了什么`);
}

console.log('② 一批候选里没有「客人看不出区别」的两套（跑闸自己那把尺）');
{
  const pool = {};
  for (const c of cands) {
    pool[c.id] = {
      colors: c.tokens.colors, fonts: c.tokens.fonts, settings: c.tokens.settings, layout: c.layout,
    };
  }
  let blocked = 0; let worst = 0; let worstLine = '';
  for (const c of cands) {
    const others = { ...pool };
    delete others[c.id];
    const r = gateSimilarity({ id: c.id, tokens: pool[c.id], layout: c.layout }, others);
    if (!r.pass) blocked += 1;
    const line = [...(r.problems || []), r.note || ''].join(' ');
    const m = /([0-9]\.[0-9]{3})/.exec(line);
    if (m && Number(m[1]) > worst) { worst = Number(m[1]); worstLine = line.slice(0, 120); }
  }
  if (blocked === 0) ok(`N=${N} 被拦 0 套，最像的一对 ${worst.toFixed(3)}（线在 0.9）—— ${worstLine}`);
  else bad(`N=${N} 被拦 ${blocked} 套，最高分 ${worst.toFixed(3)} —— ${worstLine}`);
  // 🔴 分母自检：闸真的比过东西吗。池子只有一套时它没有对手，上面那个 0 就什么都不证明。
  if (Object.keys(pool).length === N) ok(`分母：池子里 ${N} 套，每一套都跟另外 ${N - 1} 套比过`);
  else bad(`分母不对：池子里只有 ${Object.keys(pool).length} 套`);
}

console.log('③ 表跟 tokens 是同一套候选的（换个 seed 也成立）');
{
  // 🔴 这一格守的是**接线**，不是配方。r4 起表里的字色是按 `paletteFor(i, seed)` 挑的，所以
  //    `generate.js` 必须把自己那个 seed 传给 `sheetFor` —— 漏传的后果是表按 seed 7 的颜色挑、
  //    站里装的是 seed 11 的颜色，那条对比度保证当场作废，而**没有任何东西会报错**。
  //    判据用 `ink-contrast.js`：它拿的是这套候选自己吐的 tokens，接线错了就当场量到红。
  //    默认 seed 那一批由 `sheet-recipes.test.js` ③ 守，这里专门跑一个**不同的** seed。
  const { rowsFor } = require(path.join(__dirname, 'ink-contrast.js'));   // eslint-disable-line global-require
  const SEED = 11;
  const M = 30;
  const batch = generateCandidates(M, { seed: SEED });
  const offenders = batch.filter((c) => rowsFor(c.sheet, c.tokens).some((r) => r.ratio < r.floor));
  if (offenders.length) {
    const worstRow = rowsFor(offenders[0].sheet, offenders[0].tokens)
      .filter((r) => r.ratio < r.floor).sort((a, b) => a.ratio - b.ratio)[0];
    bad(`seed=${SEED} 的 ${M} 套里 ${offenders.length} 套画出了读不出来的字 —— 例：${offenders[0].id} 的 `
      + `${worstRow.hook} 只有 ${worstRow.ratio.toFixed(2)}:1（门槛 ${worstRow.floor}）。`
      + '先看 generate.js 是不是把 seed 传给了 sheetFor');
  } else {
    const lowest = Math.min(...batch.flatMap((c) => rowsFor(c.sheet, c.tokens).map((r) => r.ratio)));
    ok(`seed=${SEED} 的 ${M} 套，每一组配色都达标，最低 ${lowest.toFixed(2)}`);
  }
  // 分母自检：换了 seed 表真的换了吗 —— 没换的话上面那个绿是拿默认那批骗来的。
  // 🔴 比的是**注释头之后的那部分**：头里写着候选 id（`gen-11-1` / `gen-07-1`），拿整串比的话
  //    就算 seed 根本没传进 sheetFor 也永远"不同"，这一格会变成永远绿。
  const body = (css) => css.slice(css.indexOf('*/') + 2);
  const other = generateCandidates(1, { seed: 7 })[0];
  if (body(batch[0].sheet) !== body(other.sheet)) ok(`分母：seed=${SEED} 与 seed=7 的第一套，表的正文不是同一份`);
  else bad('分母不对：换了 seed 表的正文却逐字节相同 —— seed 没有走到 sheetFor 里');
}

console.log(`\n══ 汇总: 通过 ${pass} · 失败 ${fail} ══`);
process.exit(fail ? 1 : 0);
