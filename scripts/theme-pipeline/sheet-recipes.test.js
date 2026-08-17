#!/usr/bin/env node
/**
 * sheet-recipes.test.js — 候选主题表的四条承重性质（#1051 r2 立了前两条，r4 加了第三条，#1016 r3 加了第四条）。
 *
 * 跑法:  node scripts/theme-pipeline/sheet-recipes.test.js
 * 退出码: 0 全过 · 1 有失败 · 2 跑不起来（**不许当成通过**）
 *
 * ══ 这份测试为什么存在 ═══════════════════════════════════════════════════════════════════════════
 * 两条性质在 #1051 r1 都是坏的，而**两条都不会让任何东西变红** —— 表照样生成、契约 lint 照样 rc=0、
 * 准入闸②照样过、AC1 那把尺照样 213/213。是 QA1 手工把两份表做 md5 才看见的。
 *
 *   ① `layout.json` 说的版式，产物里要真的看得出来。
 *      r1 的实现只分「是不是 text-only」，于是 `with-media-left` 与 `with-media-top` 吐**同一份 CSS**
 *      （两套的表去掉注释头后 md5 相同）。两个名字的区别只活在 `layout.json` 里，而第三道相似度闸
 *      把版式当一整项（0.2 的权重）⟹ AC4 那个「80 套 0 套被拦」是靠一个**产物里不存在的差别**
 *      拿到的。按产物的真实表现把这两个名字当成同一个值再跑同一道闸：80 套里被拦 20 套。
 *
 *   ② 表本身不许有双胞胎。
 *      r1 的各档模数是 4 / 3 / 3 / 3…，整份表的周期只有 36 ⟹ **跑 200 套只出 24 份不同的 CSS**。
 *      #1016 要的是 60-80 套主题池，那意味着池里每份表都有 2-4 个双胞胎。
 *      🔴 相似度那道闸看不见这件事：它只读 tokens 和 layout，**一个字节的 CSS 都不读**。
 *
 *   ③ 表画的字要读得出来（r4 加的）。
 *      r3 之前 `contact` / `figure` / `star` / `yes` 四个角色的字色是**写死的 `accent-500`**，跟它
 *      压在什么底上无关。实测那批 80 套里 20 套的 `contact-info__phone` / `__email` 落在
 *      1.45–2.49:1，而准入闸②对 essential 块的下限是 2.5:1 ⟹ 候选当场被拦（QA2 在真机上复现过
 *      其中 3 套）。同一个毛病还落在另外 8 个钩子上，只是那些块不是 essential，闸看不见。
 *      🔴 覆盖率那把尺看不见这件事：钩子有规则就算数，规则画的是什么颜色它不问。
 *
 *   ④ 表说了居中，产物就要真的居中（#1016 r3 加的）。
 *      Chris 翻 80 张图时看出来的：hero 的标题居中、按钮却贴左（`gen-07-14` 上先看出来，
 *      `gen-07-31` / `gen-07-32` 上确认）。真因是 `text-align: center` 按 CSS 规范只管行内内容 ——
 *      `.hero__cta` 是 flex 容器（位置由 `justify-content` 定）、`.hero__sub` 是带 `max-width`
 *      的块级元素（位置由外边距定），两样都不受它管。于是表自己声明了居中，画出来是左。
 *      🔴 四道准入闸没有一道在问「这些东西对齐了吗」：①静态看 schema 与契约 · ②看钩子有没有规则 ·
 *         ③看两套像不像 · ④是人翻图 —— 抓到它的是第四道，也就是说机器这边一格都没有。这一格就是
 *         补上的那一格。
 * ══ ① 那一格的夹具是怎么把变量隔离出来的 ══════════════════════════════════════════════════════
 * 版式是序号的函数，没法「同一套候选换个版式」。但各档的周期是 lcm(4,3,5) = 60，而版式的周期是 9，
 * 所以 **i、i+60、i+120 三套的 voice 除了 `hero` 那一项逐项相同，且三者的版式恰好是三个不同的值**
 * （测试自己先验这一条，不合就 exit 2 —— 夹具不成立时不许给读数）。
 * 于是这三份表之间的差别**只可能**来自版式。
 *
 * 两个方向都要过，否则这一格证不了自己不是恒绿：
 *   · 版式不同的两份 → hero 那几条必须**不一样**
 *   · 同一份表跟自己、以及周期整数倍的两套（i 与 i+180）→ 必须**一样**
 */

'use strict';

const path = require('path');
const crypto = require('crypto');

const DIR = __dirname;
let sheetFor; let voiceFor; let heroLayoutFor; let HERO_LAYOUTS; let postcss; let paletteFor;

let pass = 0; let fail = 0;
const ok = (m) => { pass += 1; console.log(`  ✅ ${m}`); };
const bad = (m) => { fail += 1; console.log(`  ❌ ${m}`); };
const die = (m) => { console.error(`🔴 跑不起来: ${m}`); process.exit(2); };

try {
  ({
    sheetFor, voiceFor, heroLayoutFor, HERO_LAYOUTS,
  } = require(path.join(DIR, 'sheet-recipes.js')));
  ({ paletteFor } = require(path.join(DIR, 'palette.js')));
  postcss = require('postcss');
} catch (e) {
  die(`require 失败: ${e.message}`);
}

const md5 = (s) => crypto.createHash('md5').update(s).digest('hex');

/** 一份表里所有碰到 `.hero` 的规则，连它外面那层 @media 一起 —— 版式的差别就落在这些规则上。 */
function heroRulesOf(css) {
  const out = [];
  postcss.parse(css).walkRules((rule) => {
    if (!/\.hero(\b|__)/.test(rule.selector)) return;
    const at = rule.parent && rule.parent.type === 'atrule' ? `@${rule.parent.name} ${rule.parent.params} ` : '';
    const decls = rule.nodes.filter((n) => n.type === 'decl')
      .map((d) => `${d.prop}: ${d.value}`).sort();
    out.push(`${at}${rule.selector} { ${decls.join('; ')} }`);
  });
  return out.sort().join('\n');
}

// ── 夹具自检：三个序号的 voice 必须只差 `hero`，且三者版式互不相同 ────────────────────────────
const BASE = 0;
const TRIO = [BASE, BASE + 60, BASE + 120];
{
  const vs = TRIO.map((i) => voiceFor(i));
  const keys = Object.keys(vs[0]);
  const differing = keys.filter((k) => new Set(vs.map((v) => JSON.stringify(v[k]))).size > 1);
  if (differing.join(',') !== 'hero') {
    die(`夹具不成立：i / i+60 / i+120 的 voice 差在 [${differing.join(', ')}]，应当只差 hero。`
      + '各档的模数改过之后，这里的 60 / 120 要跟着重算（周期 = lcm(各档模数)）。');
  }
  const layouts = TRIO.map((i) => heroLayoutFor(i));
  if (new Set(layouts).size !== HERO_LAYOUTS.length) {
    die(`夹具不成立：三个序号只覆盖了 ${new Set(layouts).size} 种版式（${layouts.join(' / ')}），`
      + `HERO_LAYOUTS 有 ${HERO_LAYOUTS.length} 种。`);
  }
}

console.log('① layout.json 说的版式，产物里看得出来吗');

// 每一种版式都画得出来（HERO_SHAPES 缺一个名字时 sheetFor 会当场抛）
for (const i of TRIO) {
  const name = heroLayoutFor(i);
  try {
    sheetFor(i);
    ok(`版式 ${name} 画得出来`);
  } catch (e) {
    bad(`版式 ${name} 画不出来：${e.message}`);
  }
}

// 正向：版式不同 ⟹ hero 那几条不一样
const heroCss = new Map(TRIO.map((i) => [heroLayoutFor(i), heroRulesOf(sheetFor(i))]));
for (const [a, b] of [['with-media-left', 'with-media-top'], ['with-media-left', 'text-only'],
  ['with-media-top', 'text-only']]) {
  if (!heroCss.has(a) || !heroCss.has(b)) { bad(`没取到 ${a} / ${b} 的读数`); continue; }
  if (md5(heroCss.get(a)) === md5(heroCss.get(b))) {
    bad(`${a} 与 ${b} 的 hero 规则逐字节相同（md5 ${md5(heroCss.get(a)).slice(0, 8)}）`
      + ' —— 名字不一样、画出来一样，正是 r1 那个形状');
  } else {
    ok(`${a} ≠ ${b}（hero 规则不同）`);
  }
}

// 反向：同一个版式、同一套 voice、同一副调色板 ⟹ 必须一样。少了这一格，上面三格可能只是「恒判不同」。
// 🔴 这个周期是 **720**，不是 voice 那个 180 —— r4 起字色是按这套候选的调色板挑的（见
//    `surfaceFor`），所以整份表的周期是 lcm(voice 180, 调色板 720) = 720。夹具自己验这一条：
//    voice 相同 + 调色板逐字相同，两条都不成立就 exit 2，不给读数。
{
  const PERIOD = 720;
  if (JSON.stringify(voiceFor(BASE)) !== JSON.stringify(voiceFor(BASE + PERIOD))) {
    die(`夹具不成立：i 与 i+${PERIOD} 的 voice 不同 —— ${PERIOD} 不再是 voice 的周期整数倍`);
  }
  if (JSON.stringify(paletteFor(BASE)) !== JSON.stringify(paletteFor(BASE + PERIOD))) {
    die(`夹具不成立：i 与 i+${PERIOD} 的调色板不同 —— 色相/饱和度那几档改过之后，`
      + '这个周期要跟着重算（= lcm(色相周期, 各饱和度档数)）');
  }
  const sameA = heroRulesOf(sheetFor(BASE));
  const sameB = heroRulesOf(sheetFor(BASE + PERIOD));
  if (md5(sameA) === md5(sameB)) ok(`反向对照：同版式同 voice 同调色板的两套（i 与 i+${PERIOD}），hero 规则相同 —— 这把尺不是恒判不同`);
  else bad('反向对照失败：同版式同 voice 同调色板的两套 hero 规则却不同，说明这把尺在乱判');
}

console.log('② 表本身有没有双胞胎');
{
  const N = 100;                       // #1016 要跑 60-80 套，量到 100 留一点余量
  const seen = new Map();
  for (let i = 0; i < N; i += 1) {
    const h = md5(sheetFor(i));
    if (!seen.has(h)) seen.set(h, []);
    seen.get(h).push(i);
  }
  const twins = [...seen.values()].filter((v) => v.length > 1);
  if (twins.length) {
    bad(`${N} 套里只有 ${seen.size} 份不同的 CSS —— 双胞胎（按序号列）：`
      + `${twins.slice(0, 5).map((v) => v.join('='))
        .join(', ')}${twins.length > 5 ? ` …共 ${twins.length} 组` : ''}`);
  } else {
    ok(`${N} 套 → ${seen.size} 份不同的 CSS，没有双胞胎`);
  }
}

console.log('③ 表自己画的字，压在它自己画的底上读不读得出来');
{
  // 判据用 `ink-contrast.js`（它只读产物 + 这套候选的 tokens，不 import 生成器的任何取色逻辑）。
  const { rowsFor } = require(path.join(DIR, 'ink-contrast.js'));   // eslint-disable-line global-require
  const N = 80;                                 // #1016 要跑 60-80 套
  const sheets = [];
  for (let i = 0; i < N; i += 1) sheets.push({ i, css: sheetFor(i), tokens: { colors: paletteFor(i) } });

  const badSets = sheets.filter((x) => rowsFor(x.css, x.tokens).some((r) => r.ratio < r.floor));
  if (badSets.length) {
    const worst = rowsFor(badSets[0].css, badSets[0].tokens)
      .filter((r) => r.ratio < r.floor).sort((a, b) => a.ratio - b.ratio)[0];
    bad(`${N} 套里 ${badSets.length} 套画出了读不出来的字 —— 例：第 ${badSets[0].i} 套的 `
      + `${worst.hook} 只有 ${worst.ratio.toFixed(2)}:1（门槛 ${worst.floor}）`);
  } else {
    const floorMin = Math.min(...sheets.flatMap((x) => rowsFor(x.css, x.tokens).map((r) => r.ratio)));
    ok(`${N} 套的每一组配色都达标（正文 ≥4.5:1、大字 ≥3:1），全场最低 ${floorMin.toFixed(2)}`);
  }

  // 🔴 反向对照 —— 少了它，上面那一格可能只是「这把尺永远绿」。
  // 做法是从**真产物**上外科式地把修好的那一处改回去：r4 之前这四个角色的字色是写死的
  // `accent-500`，与表面无关。这里就把那 10 个钩子的 color 换回 accent-500，别的一个字节不动。
  // （这不是逐字节重放 r3 的实现，是重放它那条【与表面无关的写死档位】——不达标的方向一样。）
  const OLD_INK_HOOKS = /^\.(contact-info__(phone|email)|stats-counter__value|timeline__year|content-split__stat-value|social-proof__rating|testimonials__star|announcement-bar__link|pricing-table__price|feature-comparison__mark--yes)$/;
  const forceOldInk = (css) => {
    const root = postcss.parse(css);
    root.walkRules((rule) => {
      if (!OLD_INK_HOOKS.test(rule.selector.trim())) return;
      rule.walkDecls('color', (d) => { d.value = 'var(--color-accent-500)'; });
    });
    return root.toString();
  };
  const caught = sheets.filter((x) => {
    const rows = rowsFor(forceOldInk(x.css), x.tokens);
    return rows.some((r) => r.ratio < r.floor);
  });
  if (caught.length) {
    ok(`反向对照：把那 10 个钩子的字色改回写死的 accent-500，${N} 套里 ${caught.length} 套当场被这把尺点名`
      + ' —— 它不是恒绿');
  } else {
    bad('反向对照失败：字色改回写死的 accent-500 之后这把尺一套都没点名 —— 它量不出好坏');
  }
}

console.log('④ 表说了居中，产物里那几样东西真的居中吗');
{
  const N = 80;                                 // 跟③同一批，#1016 的池子就是 80 套

  // 判据写成**跟块无关**的形状：哪个容器声明了居中，就看它同一个块里那些不受 `text-align` 管的
  // 东西有没有被摆正。写死成「查 .hero__cta」就只守得住今天这一个块，而 sheet-recipes 里
  // 34 个块共用同一批角色，下一个给某个块加 `text-align: center` 的人会重犯同一件事。
  const offendersOf = (css) => {
    const root = postcss.parse(css);
    const centred = new Set();
    const rules = [];
    root.walkRules((rule) => {
      const decls = {};
      rule.walkDecls((d) => { decls[d.prop] = d.value.trim(); });
      for (const one of rule.selector.split(',')) {
        const sel = one.trim();
        const m = sel.match(/^\.([A-Za-z_][\w-]*)/);
        if (!m) continue;
        rules.push({ sel, cls: m[1], decls });
        if (decls['text-align'] === 'center') centred.add(m[1].split('__')[0]);
      }
    });
    const out = [];
    for (const r of rules) {
      if (!centred.has(r.cls.split('__')[0])) continue;
      if (r.decls.display === 'flex' && !r.decls['justify-content']) {
        out.push(`${r.sel}（display:flex 没有 justify-content）`);
      }
      if (r.decls['max-width']
        && !(r.decls['margin-left'] === 'auto' && r.decls['margin-right'] === 'auto')
        && !/\bauto\b/.test(r.decls.margin || '')) {
        out.push(`${r.sel}（max-width 没有 auto 外边距）`);
      }
    }
    return out;
  };

  const sheets = [];
  for (let i = 0; i < N; i += 1) sheets.push({ i, css: sheetFor(i) });
  const centredSheets = sheets.filter((x) => /text-align:\s*center/.test(x.css));
  const badSheets = sheets.map((x) => ({ ...x, bad: offendersOf(x.css) })).filter((x) => x.bad.length);
  if (badSheets.length) {
    bad(`${N} 套里 ${badSheets.length} 套「说的居中、画的是左」 —— 例：第 ${badSheets[0].i} 套的 `
      + `${badSheets[0].bad.join(' · ')}`);
  } else {
    ok(`${N} 套里没有一处「某个容器说了居中，它下面却有东西不受 text-align 管而没被摆正」`
      + `（其中 ${centredSheets.length} 套的确声明了居中，剩下的本来就左对齐）`);
  }

  // 🔴 反向对照 —— 把修好的那两处从**真产物**上外科式地拿掉，这把尺必须当场点名。
  //    少了它，上面那一格在「今天一套都没声明居中」时也会绿。
  const undoFix = (css) => {
    const root = postcss.parse(css);
    root.walkRules((rule) => {
      const sel = rule.selector.trim();
      if (sel === '.hero__cta') rule.walkDecls('justify-content', (d) => d.remove());
      if (sel === '.hero__sub') rule.walkDecls(/^margin-(left|right)$/, (d) => d.remove());
    });
    return root.toString();
  };
  const caught = sheets.filter((x) => offendersOf(undoFix(x.css)).length);
  if (caught.length === centredSheets.length && caught.length > 0) {
    ok(`反向对照：把 .hero__cta 的 justify-content 与 .hero__sub 的 auto 外边距拿掉，`
      + `${N} 套里 ${caught.length} 套当场被点名 —— 正是声明了居中的那 ${centredSheets.length} 套，一套不多一套不少`);
  } else if (caught.length) {
    bad(`反向对照对不上：拿掉修法后被点名 ${caught.length} 套，而声明居中的是 ${centredSheets.length} 套`);
  } else {
    bad('反向对照失败：拿掉修法之后这把尺一套都没点名 —— 它量不出好坏');
  }
}

console.log(`\n══ 汇总: 通过 ${pass} · 失败 ${fail} ══`);
process.exit(fail ? 1 : 0);
