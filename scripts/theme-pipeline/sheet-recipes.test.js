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
let heroLookFor; let HERO_LOOK_NAMES; let HERO_LOOKS;

let pass = 0; let fail = 0;
const ok = (m) => { pass += 1; console.log(`  ✅ ${m}`); };
const bad = (m) => { fail += 1; console.log(`  ❌ ${m}`); };
const die = (m) => { console.error(`🔴 跑不起来: ${m}`); process.exit(2); };

try {
  ({
    sheetFor, voiceFor, heroLayoutFor, HERO_LAYOUTS,
    heroLookFor, HERO_LOOK_NAMES, HERO_LOOKS,
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

// ── 夹具自检：一组序号的 voice 只差 hero 那两个键，且它们覆盖了全部画法 ──────────────────────────
//
// 画法是序号的函数，没法「同一套候选换个画法」。但 voice 各档的周期是 lcm(4,3,5) = 60，所以
// **i、i+60、i+120 … 这一列的 voice 除了 `hero` / `heroLook` 两项逐项相同**；沿着这一列往下走，
// 画法会轮过去。测试自己先验这两条，不合就 exit 2 —— 夹具不成立时不许给读数。
const BASE = 0;
const VOICE_PERIOD = 60;
const TRIO = [];                                   // 每种画法一个序号，voice 除 hero 两项外全同
{
  const byLook = new Map();
  for (let k = 0; k < 64 && byLook.size < HERO_LOOK_NAMES.length; k += 1) {
    const i = BASE + k * VOICE_PERIOD;
    const look = heroLookFor(i);
    if (!byLook.has(look)) byLook.set(look, i);
  }
  if (byLook.size !== HERO_LOOK_NAMES.length) {
    die(`夹具不成立：沿 i+${VOICE_PERIOD} 走 64 步只覆盖了 ${byLook.size} 种画法，`
      + `HERO_LOOKS 有 ${HERO_LOOK_NAMES.length} 种。`);
  }
  TRIO.push(...HERO_LOOK_NAMES.map((n) => byLook.get(n)));
  const vs = TRIO.map((i) => voiceFor(i));
  const keys = Object.keys(vs[0]);
  const differing = keys.filter((k) => new Set(vs.map((v) => JSON.stringify(v[k]))).size > 1);
  if (differing.sort().join(',') !== 'hero,heroLook') {
    die(`夹具不成立：这一列的 voice 差在 [${differing.join(', ')}]，应当只差 hero / heroLook。`
      + `各档的模数改过之后，这里的 ${VOICE_PERIOD} 要跟着重算（周期 = lcm(各档模数)）。`);
  }
}

console.log('① 主题挑的那个画法，产物里看得出来吗');

// 每一种画法都画得出来（HERO_LOOKS 缺一个名字时 sheetFor 会当场抛）
for (const i of TRIO) {
  const name = heroLookFor(i);
  try {
    sheetFor(i);
    ok(`画法 ${name} 画得出来`);
  } catch (e) {
    bad(`画法 ${name} 画不出来：${e.message}`);
  }
}

// 🔴 比的是**去掉颜色之后**的 hero 规则（#1065）。理由：这一列上的调色板并不相同（调色板的周期是
//    720，voice 是 60），所以整段 hero 规则的 md5 不同**证不了**差别来自画法 —— 那正是 #1051 r1
//    栽的那种「差别活在别处」。画法能决定的是位置、列数、尺寸、对齐；颜色不归它。
//    反向对照就在下面：同一个画法、不同调色板的两套，这个投影必须逐字节相同。
const dropColours = (rules) => rules.split('\n').map((line) => {
  const m = /^(.*\{ )(.*)( \})$/.exec(line);
  if (!m) return line;
  const decls = m[2].split('; ').filter((d) => d && !/var\(--color-/.test(d));
  return `${m[1]}${decls.join('; ')}${m[3]}`;
}).join('\n');

const heroLook = new Map(TRIO.map((i) => [heroLookFor(i), dropColours(heroRulesOf(sheetFor(i)))]));

// 正向：两两之间必须不同 —— 八种画法，28 对，一对都不许相同
{
  const names = [...heroLook.keys()];
  const same = [];
  for (let a = 0; a < names.length; a += 1) {
    for (let b = a + 1; b < names.length; b += 1) {
      if (md5(heroLook.get(names[a])) === md5(heroLook.get(names[b]))) same.push(`${names[a]}=${names[b]}`);
    }
  }
  const pairs = (names.length * (names.length - 1)) / 2;
  if (same.length) {
    bad(`${pairs} 对画法里有 ${same.length} 对的 hero 规则逐字节相同（${same.join(', ')}）`
      + ' —— 名字不一样、画出来一样，正是 #1051 r1 那个形状');
  } else {
    ok(`${names.length} 种画法两两不同（${pairs} 对，去掉颜色之后仍然全部不同）`);
  }
}

// 反向 ①：同一个画法、同一套 voice、**不同**调色板 ⟹ 去掉颜色之后必须逐字节相同。
// 少了这一格，上面那 28 对的「不同」可能全是调色板造出来的。
// 🔴 960 = lcm(voice 60, 画法 64)：voice 相同 + 画法相同，而 960 不是调色板周期 720 的倍数 ⟹ 颜色不同。
{
  const PERIOD = 960;
  const a = BASE;
  const b = BASE + PERIOD;
  if (heroLookFor(a) !== heroLookFor(b)) die(`夹具不成立：i 与 i+${PERIOD} 的画法不同`);
  if (JSON.stringify(voiceFor(a)) !== JSON.stringify(voiceFor(b))) die(`夹具不成立：i 与 i+${PERIOD} 的 voice 不同`);
  if (JSON.stringify(paletteFor(a)) === JSON.stringify(paletteFor(b))) {
    die(`夹具不成立：i 与 i+${PERIOD} 的调色板相同 —— 这一格要的正是「颜色不同」`);
  }
  const pa = dropColours(heroRulesOf(sheetFor(a)));
  const pb = dropColours(heroRulesOf(sheetFor(b)));
  if (md5(pa) === md5(pb)) {
    ok(`反向对照：同画法同 voice、调色板不同的两套（i 与 i+${PERIOD}），去掉颜色之后 hero 规则相同`
      + ' —— 上面那些「不同」不是颜色造出来的');
  } else {
    bad('反向对照失败：同一个画法的两套，去掉颜色之后 hero 规则却不同 —— 这把尺读到的差别不全是画法的');
  }
}

// 反向 ②：连颜色一起相同的两套（voice、画法、调色板三样都相同）⟹ 整段 hero 规则逐字节相同。
// 🔴 这个周期是 **2880** = lcm(voice 60, 画法 64, 调色板 720)。#1065 之前是 720（那时画法周期是 9）。
{
  const PERIOD = 2880;
  if (JSON.stringify(voiceFor(BASE)) !== JSON.stringify(voiceFor(BASE + PERIOD))) {
    die(`夹具不成立：i 与 i+${PERIOD} 的 voice 不同 —— ${PERIOD} 不再是 voice 的周期整数倍`);
  }
  if (JSON.stringify(paletteFor(BASE)) !== JSON.stringify(paletteFor(BASE + PERIOD))) {
    die(`夹具不成立：i 与 i+${PERIOD} 的调色板不同 —— 色相/饱和度那几档改过之后，`
      + '这个周期要跟着重算（= lcm(voice, 画法, 调色板)）');
  }
  const sameA = heroRulesOf(sheetFor(BASE));
  const sameB = heroRulesOf(sheetFor(BASE + PERIOD));
  if (md5(sameA) === md5(sameB)) ok(`反向对照：三样都相同的两套（i 与 i+${PERIOD}），hero 规则逐字节相同 —— 这把尺不是恒判不同`);
  else bad('反向对照失败：同画法同 voice 同调色板的两套 hero 规则却不同，说明这把尺在乱判');
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

console.log('⑤ 两条轴有没有串（#1065）');
{
  // 轴一（内容结构）的取值表**权威在 `blocks/hero.json`** —— 那份 manifest 是 #999 的交付物，
  // 也是 2026-08-12 spec 第 208 行那张值表在磁盘上的样子。这里不另抄一份清单：抄了就会分叉，
  // 而分叉的方向正是这一格要拦的（生成器往 `supports.hero` 里吐一个 manifest 不认的值）。
  const manifest = JSON.parse(
    require('fs').readFileSync(path.join(DIR, '..', '..', 'blocks', 'hero.json'), 'utf-8'),
  );
  const allowed = manifest.block_layout;

  // 判据写成一个函数，因为下面的反向对照要拿一张**动过手脚**的表再问一次同样的话。
  const axisProblems = (looks) => {
    const out = [];
    for (const [name, look] of Object.entries(looks)) {
      if (!allowed.includes(look.content)) {
        out.push(`画法 ${name} 的 content 是 ${JSON.stringify(look.content)}，`
          + `不在 blocks/hero.json 的 block_layout 里（${allowed.join(' / ')}）`);
      }
      // 外观词长什么样，判据不是「我认识这个词」，而是「它是不是这张表自己的画法名」——
      // 画法名进了轴一，就是两条轴又黏回去了。
      if (Object.keys(looks).includes(look.content)) {
        out.push(`画法 ${name} 的 content 就是一个画法名（${look.content}）—— 两条轴黏在一起了`);
      }
    }
    return out;
  };

  const problems = axisProblems(HERO_LOOKS);
  if (problems.length) {
    bad(`轴串了：${problems.join(' · ')}`);
  } else {
    ok(`${Object.keys(HERO_LOOKS).length} 种画法的 content 全部落在 blocks/hero.json 声明的 `
      + `${allowed.length} 个内容结构里（${allowed.join(' / ')}），没有一个外观词`);
  }

  // 派生出来的轴一取值表必须**逐字等于** manifest 那三个（顺序不算）—— 少一个也是问题：
  // `with-form` 掉出去就意味着池里没有一套主题声明支持带表单的 hero。
  const derived = [...HERO_LAYOUTS].sort();
  if (JSON.stringify(derived) === JSON.stringify([...allowed].sort())) {
    ok(`轴一的取值集合逐字等于 manifest：${derived.join(' / ')}`);
  } else {
    bad(`轴一的取值集合是 ${derived.join(' / ')}，manifest 是 ${[...allowed].sort().join(' / ')}`);
  }

  // 🔴 反向对照 —— 往内容结构那一栏塞一个外观词，这把尺必须当场点名它（AC-A 点名要的那一格）。
  const rigged = {
    ...HERO_LOOKS,
    'media-left': { ...HERO_LOOKS['media-left'], content: 'with-media-left' },
  };
  const caught = axisProblems(rigged);
  if (caught.length === 1 && /with-media-left/.test(caught[0])) {
    ok(`反向对照：把 media-left 的 content 改成外观词 with-media-left，这把尺当场点名（${caught[0]}）`);
  } else if (caught.length) {
    bad(`反向对照对不上：点名了 ${caught.length} 条，应当只有那一条 —— ${caught.join(' · ')}`);
  } else {
    bad('反向对照失败：把外观词塞进内容结构表之后，这把尺一句话都没说');
  }

  // 每一种内容结构都要有人画 —— 「值表里有 with-form」和「有画法产得出 with-form」是两件事，
  // 而 #1065 立票时坏的正是后者（值表里写着，池里 0 套）。
  const byContent = new Map();
  for (const [name, look] of Object.entries(HERO_LOOKS)) {
    if (!byContent.has(look.content)) byContent.set(look.content, []);
    byContent.get(look.content).push(name);
  }
  const empty = allowed.filter((c) => !byContent.has(c));
  if (empty.length) bad(`${empty.join(' / ')} 没有任何画法产得出来 —— 声明支持一个渲染不出来的形态`);
  else {
    ok(`每种内容结构都有画法：${[...byContent].map(([c, ns]) => `${c} ${ns.length} 种`).join(' · ')}`);
  }

  // 80 套池子里每种画法各有几套（AC-C 的下限是每种 ≥ 8）。挑法是序号的函数，所以这个数不用建站就问得出来。
  {
    const N = 80;
    const counts = new Map(HERO_LOOK_NAMES.map((n) => [n, 0]));
    for (let i = 0; i < N; i += 1) counts.set(heroLookFor(i), counts.get(heroLookFor(i)) + 1);
    const thin = [...counts].filter(([, n]) => n < 8);
    const line = [...counts].map(([n, c]) => `${n} ${c}`).join(' · ');
    if (thin.length) bad(`${N} 套里有画法不到 8 套：${thin.map(([n, c]) => `${n} ${c}`).join(', ')}（全表：${line}）`);
    else ok(`${N} 套逐套归类，每种画法都 ≥ 8 套：${line}`);
  }
}

console.log(`\n══ 汇总: 通过 ${pass} · 失败 ${fail} ══`);
process.exit(fail ? 1 : 0);
