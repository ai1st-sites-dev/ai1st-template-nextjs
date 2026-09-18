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
const fs = require('fs');            // #1135 ⑨ 的分母自检要数池子里有几份表
const crypto = require('crypto');

const DIR = __dirname;
let sheetFor; let scanGeometry; let voiceFor; let postcss; let paletteFor;
let CARD_BLOCKS;
let heroLookFor; let HERO_LOOK_NAMES; let HERO_LOOKS;
let ctaLookFor; let CTA_LOOK_NAMES; let formLookFor; let FORM_LOOK_NAMES;   // #1135
let LOOK_FAMILIES;                                                          // #1139
let recipeShapeFor; let recipeShapesFor;                                        // #1339

let pass = 0; let fail = 0; let skipCount = 0;
const ok = (m) => { pass += 1; console.log(`  ✅ ${m}`); };
const bad = (m) => { fail += 1; console.log(`  ❌ ${m}`); };
const die = (m) => { console.error(`🔴 跑不起来: ${m}`); process.exit(2); };
// #1317 —— 脚手架期（池子 < 10 套）按构造没有对象可问的那两格，见 scripts/lib/scaffolding-pool.js。
const { skipOnScaffoldingPool } = require(path.join(__dirname, '..', 'lib', 'scaffolding-pool.js'));
const skip = (what, why) => { if (!skipOnScaffoldingPool(what, why)) return false; skipCount += 1; return true; };

try {
  ({
    sheetFor, scanGeometry, voiceFor, CARD_BLOCKS,
    heroLookFor, HERO_LOOK_NAMES, HERO_LOOKS,
    ctaLookFor, CTA_LOOK_NAMES, formLookFor, FORM_LOOK_NAMES,
    LOOK_FAMILIES, recipeShapeFor, recipeShapesFor,
  } = require(path.join(DIR, 'sheet-recipes.js')));
  ({ paletteFor } = require(path.join(DIR, 'palette.js')));
  postcss = require('postcss');
} catch (e) {
  die(`require 失败: ${e.message}`);
}

const md5 = (s) => crypto.createHash('md5').update(s).digest('hex');

// ══ #1318 —— 几何搬走之后，「几何」这几格的语料换成【一个站真正拿到的那份 CSS】 ════════════════
//
// 契约 v3 起排版不在主题表里了：它住在平台那一份 `public/shapes.css`，按
// `[data-block="<类型>"][data-shape="<画法名>"]` 点名，而一个站在每个块上戴哪个画法由它穿的那套
// 主题的**选择单**（`theme-pool.json` 的 `shapes`）决定。
//
// 🔴 **所以「第 i 套候选的几何」这个问法没有对象了。** `sheetFor(i)` 里一行几何都没有（这是本票
//    的交付），而形态层里**只有池子真的用到的那 50 个 (block, shape) 对** —— 不为「将来可能有」
//    预留（#1318 PM 裁定 ③）。⟹ 下面 ④ / ⑥ / ⑩ 三格的分母从「N 套候选」变成「池子里的每一套主题」。
//    这不是判据放松，是问题换了对象：**一个站能拿到的排版，今天就是这些**。池子重新生成那天
//    （#1317 的脚手架期结束），选择单会带来新的画法名，这几格自己就跟着长。
//
// 🔴 「选择单里点名的画法在 `shapes.css` 里真的有规则吗」由 `pool.test.js` 那一格守（本票加的）。
//    少了它，一个站可以戴上一个查不到的画法名 —— 而那是静默的：页面照样打开，只是塌回 base.css。
const SHAPES_PATH = path.resolve(DIR, '..', '..', 'public', 'shapes.css');
const THEMES_DIR = path.resolve(DIR, '..', '..', 'public', 'themes');
const POOL = require(path.join(DIR, '..', 'theme-pool.json'));
const POOL_IDS = Object.keys(POOL).sort();

/**
 * 这个站真正拿到的那份 CSS = 形态层里它选中的那些规则（还原成类名形态）+ 它自己那份主题表。
 * 同一个选择器的两半合并成一条规则 —— 也就是 #1318 之前 `sheetFor(i)` 产出的那个形状，所以下面
 * 那些尺子一个字都不用改。
 *
 * 🔴 `[data-block="X"]` 与 `.X` 是**同一个元素**（`src/lib/sections/blockAttrs.ts` 把两个都写在块
 *    根上），所以这个还原不是近似。
 */
/**
 * 「第 i 套候选今天画出来是什么样」的那份完整 CSS = **它选中的那几副形态**（从 `public/shapes.css`
 * 还原成类名）+ **它自己那份皮**（`sheetFor(i)`）。
 *
 * 🔴 #1339 —— 这一行以前是 `mergeCss([sheetFor(i), geometryFor(i)])`，也就是「配方的皮 + 配方的
 *    几何」。本票把几何从配方里删干净之后 `geometryFor` 不存在了，所以另一半改从形态层取。
 *    **换的是几何从哪儿来，不是遍历什么**：仍然按候选号 0…N 走，域一套不少。
 *
 * 🔴 走到这一步之前排除过两条更省事的路，两条都会让下面几格**恒绿或者失明**：
 *    · ❌ 只读皮（这一行只取 `sheetFor(i)`）。④ ⑥ ⑩ ⑪ ⑭ 问的位置键 `order` / `grid-column` /
 *      `display` 全是几何，只读皮时两边都读到空串 ⟹「两边一不一样」恒为假 ⟹ 恒绿。
 *      ⑭ 自己那段注释记着 #1318 r1 就是这个状态，而它的阳性对照照样开火 —— 对照证的是「这把尺
 *      读得懂 order」，不是「语料里有 order」。
 *    · ❌ 直接改读 `effectiveSheetFor(themeId)`。它按**主题 id** 取盘上的表，而盘上今天只有 2 套
 *      ⟹ ⑥ 的域从「7 种 hero 画法 + 2 站」塌成 2 站，⑫ 从 97 套候选塌成 2 套。而 #1065 / #1135 /
 *      #1139 / #1150 / #1158 那批红当初的域就是前者。
 *
 * 🔴 候选 → (块, 形态) 的映射是**机械取**的：`recipeShapesFor(i)`（`sheet-recipes.js` 导出），
 *    它有候选表的 11 个块走族自己的 `pick(i)`、`content-split` 拼节律全名，其余 20 个块走那份
 *    明写的 `PLAIN_SHAPE_NAMES`。它自己的分母自检在下面那一格：97 套候选用到的 (块, 形态) 对与
 *    `public/shapes.css` 里的集合**双向差集都空**。
 *
 * 🔴 两个语料回答的仍然是两个问题，下面几格**两个都问**：
 *    · `recipeSheetFor(i)`     —— 「这套候选画出来对吗」。域是全部候选（7 种 hero 画法、
 *                                 6 种 form 画法、80/97 套候选），这是那批红当初的域。
 *    · `effectiveSheetFor(id)` —— 「一个站今天真的拿到了吗」。域是池子里的每一套主题，语料是
 *                                 主题表 + 平台那份手维护的 `shapes.css`。
 *    只问后者：域塌到 2，而 7 种 hero 画法里只有 2 种被判到。
 */
/**
 * 🔴 两半要**合成一条规则**，不是首尾相接。`.hero__form` 在皮那一份和几何那一份里各有一条，拼起来
 * 就是两条同名规则 —— 而下面那些尺子一律取**第一条**（`lines.find` / 单次 `match`），于是它们会读到
 * 只有皮的那一条，判成「这个画法没给表单排位置」。这一条是实测过的：第一版就这么拼，8 种画法全红。
 */
// #1339 —— 语料换了一半,理由整段在下面。
const recipeSheetFor = (i, shapesText, opts = {}) => mergeCss([
  restoreShapes(
    // 🔴 `hero-with-form` 只在点名问它的时候才进这份映射。它借用 `.hero__*` 那套类名
    //    （manifest 的 `hooksFrom`），无条件放进来的话它那几条规则会以 `.hero-with-form …` 的
    //    形状混进整份表，而下面 ⑫ 那格的分母自检按块名认领规则 ⟹ 当场报「有 10 条读不到」。
    //    它不是 `hooksByBlock()` 的成员（那 31 个块里没有它），所以 `recipeShapesFor` 本来也不给它。
    opts.only === 'hero-with-form'
      ? { 'hero-with-form': recipeShapeFor('hero-with-form', i) }
      : recipeShapesFor(i),
    shapesText, opts,
  ),
  sheetFor(i),
]);

/**
 * 把几份 CSS 合成一份：同一个 (at-rule, 选择器) 的声明并进同一条规则，后面那份盖前面那份。
 * `pick` 可选 —— 回 null 表示这条规则整条不要，回一个字符串表示把选择器换成它。
 */
function mergeCss(cssList, pick) {
  const merged = new Map();   // `${media}\u0000${selector}` → { media, sel, decls: Map }
  for (const css of cssList) {
    postcss.parse(css).walkRules((rule) => {
      const media = rule.parent.type === 'atrule' ? `@${rule.parent.name} ${rule.parent.params}` : '';
      const sel = pick ? pick(rule.selector) : rule.selector;
      if (sel === null) return;
      const key = `${media}\u0000${sel}`;
      if (!merged.has(key)) merged.set(key, { media, sel, decls: new Map() });
      rule.walkDecls((d) => merged.get(key).decls.set(d.prop, d.value));
    });
  }
  const byMedia = new Map();
  for (const r of merged.values()) {
    if (!byMedia.has(r.media)) byMedia.set(r.media, []);
    byMedia.get(r.media).push(`${r.sel} {\n${
      [...r.decls].map(([k, v]) => `  ${k}: ${v};`).join('\n')}\n}\n`);
  }
  const out = [];
  for (const [media, rules] of byMedia) {
    if (!media) out.push(rules.join('\n'));
    else out.push(`${media} {\n${rules.join('\n')}\n}\n`);
  }
  return out.join('\n');
}

/**
 * @param {object} [opts]
 * @param {string} [opts.only] 只保留这一个块的形态规则（别的块整条丢掉）
 * @param {string} [opts.as]   把那个块的前缀换成这个类名
 *
 * 🔴 #1333 —— 这两个参数是为「借用别人那套部件类名的块」加的（manifest 的 `hooksFrom`）。
 *    `hero-with-form` 渲染的是 `.hero__*` 那一家，所以形态层里它的规则长这样：
 *        [data-block="hero-with-form"][data-shape="form-side"] .hero__form { … }
 *    不带参数地还原，会得到 `.hero-with-form .hero__form` —— 而下面那些尺子找的是行首的
 *    `.hero__form`，于是它们读不到它，判成「这个站没给表单排位置」（实测：⑥ 两套站都红）。
 *    直接把 `.hero-with-form` 也换成 `.hero` 又不行：那样 hero 自己那份形态规则会跟它**并进同一条**，
 *    两个块的几何糊在一起。所以做法是「一次只还原一个块，并说明它借的是谁的类名」。
 */
/**
 * 形态层里属于这份**选择单**的那些规则，还原成类名形态（`.hero` / `.hero__form`）。
 *
 * 🔴 `shapesText` 是个参数，不是常量 —— 下面好几格的反向对照要拿一份**动过手脚**的形态层再问一次
 *    同样的话。#1339 之前那些对照改的是配方（几何住在配方里），今天几何住在这儿，所以扰动也得下在
 *    这儿。改配方的那种写法今天会「立不起来」：被摘的那行根本不在配方里了。
 */
function restoreShapes(selection, shapesText, opts = {}) {
  return mergeCss([shapesText === undefined ? fs.readFileSync(SHAPES_PATH, 'utf-8') : shapesText], (selector) => {
    if (!/\[data-block=/.test(selector)) return selector;
    const m = /\[data-block="([^"]+)"\]\[data-shape="([^"]+)"\]/.exec(selector);
    if (!m || selection[m[1]] !== m[2]) return null;        // 这个站/这套候选没戴这个画法
    if (opts.only && m[1] !== opts.only) return null;       // #1333 —— 只还原点名的那个块
    const prefix = opts.as || m[1];
    return selector
      .split(new RegExp(`\\[data-block="${m[1]}"\\]\\[data-shape="${m[2]}"\\]`)).join(`.${prefix}`)
      .replace(/\.([a-z0-9-]+) \.\1__/g, '.$1__');            // `.hero .hero__form` → `.hero__form`
  });
}

function effectiveSheetFor(themeId, opts = {}) {
  const selection = (POOL[themeId] || {}).shapes || {};
  return mergeCss([
    restoreShapes(selection, opts.shapesText, opts),
    fs.readFileSync(path.join(THEMES_DIR, `${themeId}.css`), 'utf-8'),
  ]);
}


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
// 🔴 #1333 —— 下面两处反向对照的步长**从画法表的项数现算**，不再写死。
// 画法的周期是 L²（`heroLookFor` 那条式子 `(i + floor(i/L)) % L` 的周期），而 L 就是 `HERO_LOOKS`
// 的项数：#1333 把 `form-side` 搬去 `hero-with-form` 之后它从 8 变成了 7，于是 64 变成 49，
// 原来写死的 960 / 14400 两个步长当场都不再是「同一个画法」的步长（实测：不改的话这个文件退 2，
// 报「夹具不成立：i 与 i+960 的画法不同」）。现算的话下次再加减一项不用有人记得回来改。
const gcd = (a, b) => (b ? gcd(b, a % b) : a);
const lcm = (a, b) => (a / gcd(a, b)) * b;
const LOOK_CYCLE = HERO_LOOK_NAMES.length ** 2;
let FIXTURE_LICENCE;   // #1090 —— 放宽夹具的那个对照用的一对序号，下面 ① 那一格拿它出读数
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
  // 🔴 #1090 起这一列上还会多差三个键（`split` / `splitRhythm` / `cards`）—— 那三族的档期是 16/8/16，
  //    与 voice 原来那 60 合起来的周期是 240，而 **240 是 8 的倍数** ⟹ 沿 240 走，画法只轮得到 8 种
  //    里的 4 种（实测：走 200 步覆盖 4/8）。也就是说「让这一列连那三个键都相同」在当时的表上
  //    **造不出来**，不是没想到。
  //    📌 #1333 之后 L=7，这条算术翻面了：240 不是 7 的倍数 ⟹ 沿 240 走 200 步覆盖 **7/7 种**
  //    （现测）。也就是说今天**造得出来**那种更干净的一列。这一格仍然按放宽的判据跑（差的键都在
  //    允许清单里就行），因为收紧它是另一件事、要它自己的两向对照 —— 而放宽从来不会漏报：
  //    下面那道执照照跑，它证的正是这几个键够不着 hero 规则。
  // 🔴 放宽是有代价的，代价必须当场付：下面那格证明那三个键**够不着 hero 规则**。证不出来就 exit 2 —— 
  //    没有那个证明，上面 28 对的「不同」就可能是 split/cards 造出来的，而不是画法。
  // 🔴 #1135 起再多两个（`ctaLook` / `formLook`，模数 5 和 6）—— 同上，把它们并进 240 的周期里
  //    要 lcm(60,5,6)=60 …… 而 5 和 6 都整除不了 8，实测沿任何步长都造不出「连这两个键也相同」
  //    且覆盖 8 种画法的一列。放宽同样要付代价：下面那格的执照现在连这两个键一起证。
  // 🔴 #1139 —— 这张名单**从注册表派生**，不再手抄（`LOOK_FAMILIES` 上面那段写了理由）；
  //    并且判据从「集合恰好相等」改成「差的那些键都在名单里」。为什么要改：
  //    这一格要拦的是**本该恒定的键动了**（那说明 60 这个周期过期了，读数不作数）。而「恰好相等」
  //    还额外要求每个画法键都**真的**在这一列上变 —— 那是一条跟本格无关的算术巧合：本批六族的
  //    错开步长各不相同，`infoLook` 的 `(i + floor(i/4)) % 3` 沿 i+60 走恰好恒为同一档
  //    （i=0 / 60 / 120 都算出 0）。第一版我按「恰好相等」写，这一格当场退 2，而它抱怨的那件事
  //    （某个画法键**没**变）对隔离 hero 变量毫无影响 —— 少变一个键只会让这一列更干净。
  const LOOK_KEYS = LOOK_FAMILIES.map((f) => f.key);
  // 🔴 #1358 —— `heroFormLook` 跟这张名单上的其余几个是同一类：它是**某个块挑哪一副形态**的那一档
  //    （`hero-with-form` 的 form-side / form-band / form-inline），本来就该沿这一列变。它没有候选表
  //    （那三副之间的差别整个住在 `public/shapes.css`，皮那一层不用改），所以 `LOOK_FAMILIES` 里
  //    没有它，只能跟 `splitRhythm` 一样明写。下面那道执照连它一起证（它在 SPLIT_KEYS 里）。
  const ALLOWED = [...LOOK_KEYS, 'hero', 'splitRhythm', 'heroFormLook'].sort();
  const strayed = differing.filter((k) => !ALLOWED.includes(k));
  if (strayed.length) {
    die(`夹具不成立：这一列的 voice 差在 [${differing.join(', ')}]，其中 [${strayed.join(', ')}] `
      + `不在允许清单 [${ALLOWED.join(', ')}] 里。各档的模数改过之后，这里的 ${VOICE_PERIOD} `
      + '要跟着重算（周期 = lcm(各档模数)）。');
  }

  // #1341 —— 从 ⑤ 搬来：80 套里每种 hero 画法各有几套，下限是每种 ≥ 8（#1065 AC-C）。
  // 它问的是 `heroLookFor` 这个**挑法**（挑法是序号的函数，不用建站就问得出来），跟本票退役的
  // 「内容结构」那一维没有关系 —— ⑤ 整格删掉时它会跟着消失，所以搬到这里，判据一个字没改。
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

// 🔴 上面那道放宽的**执照**（#1090）：`split` / `splitRhythm` / `cards` 变了，hero 规则不许跟着变。
//    找一对「除了这三个键之外**全同**（含 heroLook）」的序号，两边的 hero 规则必须逐字节相同。
//    找不到这样的一对 ⟹ exit 2：没有对照就没有执照，上面那 28 对的读数不作数。
// #1135 起这张名单里多了 `ctaLook` / `formLook` —— 执照要证的事一个字没变：**这几个键变了，
// hero 规则不许跟着变**。它们由 `shapeFor` 按块派发，按构造够不着 hero，而「按构造」这三个字
// 本身就是要被量的那个东西。
// #1139 —— 同样从注册表派生：hero 之外**每一族**的档，加上同页节奏。手抄的那一版每加一族都要有人
// 记得回来补一个名字，而漏掉的样子是「执照照样发得出来」（那一族变了却没被证明够不着 hero 规则）。
// #1358 —— `heroFormLook`（`hero-with-form` 挑哪一副形态）也进这张名单：执照要证的事一个字没变
// ——**这个键变了，hero 规则不许跟着变**。它今天按构造够不着任何一条 sheet 规则（那三副形态的差别
// 整个住在 `public/shapes.css`），而「按构造」这三个字本身就是要被量的那个东西。
const SPLIT_KEYS = [...LOOK_FAMILIES.map((f) => f.key).filter((k) => k !== 'heroLook'), 'splitRhythm', 'heroFormLook'];
{
  const J = JSON.stringify;
  const keys = Object.keys(voiceFor(0));
  const others = keys.filter((k) => !SPLIT_KEYS.includes(k));
  let pair = null;
  outer:
  for (let i = 0; i < 400 && !pair; i += 1) {
    for (let j = i + 1; j < 800; j += 1) {
      if (!others.every((k) => J(voiceFor(i)[k]) === J(voiceFor(j)[k]))) continue;
      if (SPLIT_KEYS.every((k) => J(voiceFor(i)[k]) === J(voiceFor(j)[k]))) continue;
      pair = [i, j]; break outer;
    }
  }
  if (!pair) {
    die('夹具不成立：找不到「只差 split/splitRhythm/cards」的一对序号 —— 上面那道放宽没有执照，'
      + '这一整节的读数不作数。');
  }
  FIXTURE_LICENCE = pair;
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

// 正向：两两之间必须不同 —— 画法两两配对（L=8 时 28 对，#1333 之后 L=7 ⟹ 21 对），一对都不许相同
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

// 执照（#1090）：只差 split/splitRhythm/cards 的两套，hero 规则逐字节相同。
// 这一格是上面那 28 对能不能算数的前提 —— 它红了，说明本票那三族的档漏进了 hero，28 对的「不同」
// 里就掺了别的东西。
{
  const [i, j] = FIXTURE_LICENCE;
  const a = heroRulesOf(sheetFor(i));
  const b = heroRulesOf(sheetFor(j));
  const vi = voiceFor(i); const vj = voiceFor(j);
  const shown = SPLIT_KEYS.map((k) => `${k} ${vi[k]}→${vj[k]}`).filter((_, n) => vi[SPLIT_KEYS[n]] !== vj[SPLIT_KEYS[n]]);
  if (md5(a) === md5(b)) {
    ok(`执照：i=${i} 与 i=${j} 只差 [${shown.join(' · ')}]（画法同为 ${heroLookFor(i)}），`
      + 'hero 规则逐字节相同 —— 本票那三族够不着 hero，上面那 28 对的「不同」是画法造成的');
  } else {
    bad(`执照失败：只差 [${shown.join(' · ')}] 的两套，hero 规则却不同 —— `
      + '本票那三族漏进了 hero，上面 28 对的读数不作数');
  }
}

// 反向 ①：同一个画法、同一套 voice、**不同**调色板 ⟹ 去掉颜色之后必须逐字节相同。
// 少了这一格，上面那 28 对的「不同」可能全是调色板造出来的。
// 🔴 步长 = lcm(voice 60, 画法周期 L²)：voice 相同 + 画法相同，而它不是调色板周期 720 的倍数
//    ⟹ 颜色不同。L=8 时是 960，#1333 之后 L=7 ⟹ **2940**（2940 % 720 = 60 ≠ 0，下面那三条 die 现场核）。
//
// 🔴 #1135 —— 这里比的是 **voice 去掉 `SPLIT_KEYS` 那几个键之后**相同，不再是整个 voice 相同。
//    为什么必须放宽：加了 `ctaLook`(模数 5，周期 25) 和 `formLook`(模数 6，周期 36) 之后，整个 voice
//    的周期变成 lcm(60,64,16,8,25,36) = **14400 = 2⁶·3²·5²**，而调色板周期 720 = 2⁴·3²·5 **整除它**
//    ⟹ 「voice 全同而颜色不同」这件事按构造不存在了（0..20000 里穷举过：voice 全同的 5600 组，
//    没有一组的调色板不同）。#1135 之前 960 = 2⁶·3·5 不含 3²，所以那时存在。
//    📌 #1333 把画法周期从 64 换成 49（L 从 8 变 7），那两个数因此变成 2940 / 176400 —— 结论没变：
//    720 仍然整除 176400、仍然不整除 2940。上面那两个常量现在**从 L 现算**，不再写死。
//    🔴 凭什么可以放宽：上面那道**执照**刚刚量过 —— 这几个键变了，hero 规则逐字节不变。放宽掉的
//    正好是它证过够不着 hero 的那几个键，一个不多。没有那道执照，这里就不许放宽。
{
  const PERIOD = lcm(VOICE_PERIOD, LOOK_CYCLE);   // L=7 ⟹ 2940
  const a = BASE;
  const b = BASE + PERIOD;
  const heroVoiceKeys = Object.keys(voiceFor(a)).filter((k) => !SPLIT_KEYS.includes(k));
  const sameHeroVoice = heroVoiceKeys.every((k) => JSON.stringify(voiceFor(a)[k]) === JSON.stringify(voiceFor(b)[k]));
  if (heroLookFor(a) !== heroLookFor(b)) die(`夹具不成立：i 与 i+${PERIOD} 的画法不同`);
  if (!sameHeroVoice) die(`夹具不成立：i 与 i+${PERIOD} 去掉 [${SPLIT_KEYS.join(', ')}] 之后 voice 仍不同`);
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
// 🔴 这个周期是 **14400** = lcm(voice 60, 画法 64, split/cards 16, splitRhythm 8, ctaLook 25,
//    formLook 36, 调色板 720)。#1065 之前是 720（那时画法周期是 9）、#1090 之后 2880，
//    #1135 加的两族把 3² 和 5² 带进来 ⟹ 2⁶·3²·5² = 14400（调色板那 720 正好整除它，所以这一格
//    要的「颜色也相同」自动成立）。
{
  // 🔴 #1333 —— 这个 14400 **重新量过，它仍然成立**，别照上面那格的样子把它也改成现算的。
  //    上面那格的步长要「画法相同」，所以它跟画法周期 L² 绑着，L 一变它就得跟着变。这一格要的是
  //    **整个 voice 相同**（`heroLook` 也在 voice 里），而那是一次穷举读数，不是几个模数的 lcm：
  //    现测 0..400000 里 voice 逐字全同的 P 是 14400 / 28800 / 43200 / 57600，第一个仍然是 14400 ——
  //    L=7 下 14400 不是 49 的倍数，但 `heroLookFor(14400)` 恰好又回到第 0 项（算式
  //    `(14400 + 2057) % 7 = 0`）。我先按 lcm(3600, 49) = 176400 改过一版，那一版当场 die
  //    「176400 不再是 voice 的周期整数倍」—— 所以这里写的是量出来的数，不是推出来的数。
  // 🔴 #1363 —— 这个数**重新量过，从 14400 变成 28800**。`testimonialLook` 的候选从 4 副长到 8 副
  //    （对表 FlyonUI 新增 heading-side / masonry / quote-aside / single-featured），而
  //    `testimonialLook` 也在 voice 里 ⟹ 原来那个 14400 当场不成立，这个文件退 2、整份从这里往下
  //    一行都不跑（实测：不改就是 `夹具不成立：i 与 i+14400 的 voice 不同`）。
  //    跟上面 #1333 那次一样，**这是量出来的数不是推出来的**：穷举 0..800000，voice 与调色板
  //    逐字全同的 P 依次是 28800 / 57600 / 86400 / 720000，取第一个。
  const PERIOD = 28800;
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
  // `accent-500`，与表面无关。这里就把那几个钩子的 color 换回 accent-500，别的一个字节不动。
  // 📌 这张名单原来 10 个钩子。#1372 删掉两个块（D19）后剩 9 条，其中 `timeline__year` 留着不碍事
  //    （匹配不到任何规则）⟹ 盘上能命中的是 8 个；#1376 又摘掉一条（那个「一排数字」的块按同一份
  //    D19 并进了 `social-proof`，它那个钩子跟着走）⟹ 名单 8 条、盘上能命中 7 个。
  //    对照臂照旧由能命中的那些驱动，下面那一格自己会说有没有被点名。
  // （这不是逐字节重放 r3 的实现，是重放它那条【与表面无关的写死档位】——不达标的方向一样。）
  const OLD_INK_HOOKS = /^\.(contact-info__(phone|email)|timeline__year|content-split__stat-value|social-proof__rating|testimonials__star|announcement-bar__link|pricing-table__price)$/;
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
    ok(`反向对照：把那几个钩子的字色改回写死的 accent-500，${N} 套里 ${caught.length} 套当场被这把尺点名`
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

  // #1318 —— 语料换成「池子里每一套主题真正拿到的那份 CSS」（理由整段在 effectiveSheetFor 上面）：
  // 这一格问的两处修法（`.hero__cta` 的 justify-content、`.hero__sub` 的 auto 外边距）今天一半在
  // 形态层、一半在主题表里 —— `max-width` 与 `justify-content` 是几何，`margin` 不是。只读其中
  // 一份的话，两边都会读到「说了居中却没摆正」，而真站上它是摆正的。
  const sheets = [];
  for (let i = 0; i < N; i += 1) sheets.push({ i: `候选 ${i}`, css: recipeSheetFor(i) });
  for (const id of POOL_IDS) sheets.push({ i: `站 ${id}`, css: effectiveSheetFor(id) });
  if (sheets.length <= N) die('④ 的语料里一套池内主题都没有：theme-pool.json 读到空');
  // 🔴 #1135 —— 分母是「**hero 这个块**声明了居中」的套数，不是「整份表里出现过 text-align:center」。
  //    下面那个反向对照拿掉的是 `.hero__cta` / `.hero__sub` 两处**hero 的**修法，所以它只可能点名
  //    hero 居中的那些套。#1135 给 cta-banner / contact-form 各加了一个居中候选之后，整份表里
  //    「出现过居中」的套数从 30 涨到 48，而被点名的仍是 30 —— 于是那句 `caught === centredSheets`
  //    的等式当场破。破的是分母，不是修法：口径必须跟它扰动的那一层对齐。
  const heroCentred = (css) => {
    const root = postcss.parse(css);
    let yes = false;
    root.walkRules((rule) => {
      if (yes) return;
      for (const one of rule.selector.split(',')) {
        const m = one.trim().match(/^\.([A-Za-z_][\w-]*)/);
        if (!m || m[1].split('__')[0] !== 'hero') continue;
        rule.walkDecls('text-align', (d) => { if (d.value.trim() === 'center') yes = true; });
      }
    });
    return yes;
  };
  const centredSheets = sheets.filter((x) => heroCentred(x.css));
  const badSheets = sheets.map((x) => ({ ...x, bad: offendersOf(x.css) })).filter((x) => x.bad.length);
  if (badSheets.length) {
    bad(`${sheets.length} 套里 ${badSheets.length} 套「说的居中、画的是左」 —— 例：${badSheets[0].i} 的 `
      + `${badSheets[0].bad.join(' · ')}`);
  } else {
    ok(`${sheets.length} 套主题（各自的 主题表 + 形态层选中的画法）里没有一处「某个容器说了居中，它下面却有东西不受 text-align 管而没被摆正」`
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
      + `${sheets.length} 套里 ${caught.length} 套当场被点名 —— 正是声明了居中的那 ${centredSheets.length} 套，一套不多一套不少`);
  } else if (caught.length) {
    bad(`反向对照对不上：拿掉修法后被点名 ${caught.length} 套，而声明居中的是 ${centredSheets.length} 套`);
  } else {
    bad('反向对照失败：拿掉修法之后这把尺一套都没点名 —— 它量不出好坏');
  }
}

// 📌 ⑤ 删了（#1341）—— 这里原来是「两条轴有没有串」（#1065）。
//
//    它做的事：拿 `blocks/hero.json` 的 `block_layout` 当取值表，检查 `HERO_LOOKS` 每一项的
//    `content` 都落在那份表里、而且不是一个画法名；再把生成器派生出来的 `HERO_LAYOUTS` 跟那份表
//    逐字比；还带一条反向对照（往 `content` 那一栏塞一个画法词，这把尺必须当场点名）。
//
//    🔴 **没有继承者，这是有意的。** #1341 把内容结构那一整维退役了 —— `blocks/hero.json` 没有
//    `block_layout` 这份清单，`HERO_LOOKS` 每一项的 `content` 字段、派生它的 `heroLayoutFor` 和
//    `HERO_LAYOUTS` 也一起删了。比较的两边同时没了，问题本身不存在了。留这句话是因为
//    「一格无声消失」跟「一格从来没有过」长得一样。
//
//    🔴 **它里面有一条跟这一维无关的判据，我把它搬走了、没有删**：末尾那条「80 套里每种 hero 画法
//    都 ≥ 8 套」的分布下限（问的是 `heroLookFor` 这个挑法，不是内容结构）。它现在在上面那段夹具
//    自检里（搜 `#1341 —— 从 ⑤ 搬来`）。同名的另一条在 `pool.test.js` ⑨ 里，那一条随 ⑨ 一起没了
//    （它问的是池子那份数据，而这一条问的是生成器）。

// ══ ⑥ 每一种画法都要给 `.hero__form` 排一个位置（#1065 r2）══════════════════════════════════════
//
// 🔴 #1333 —— 两臂问的块**不是同一个**，这是有意的：
//   · 配方那一臂仍然逐个 hero 画法问 —— `HERO_LOOKS` 的七项各自有一条 `form:` 的 partExtra，而那正是
//     #1065 r2 那次 CI 红的域（谁加第八种画法而忘了给表单排位置，这一臂当场红）。
//   · 站那一臂问的是 `hero-with-form` —— 表单今天是**那个块**的部件。它借用 `.hero__*` 那套类名，
//     所以尺子一个字都不用改，换的只是「去形态层里取哪个块的规则」。
//
// 为什么单独一格：r1 的八种画法里只有 `form-side` 给这个部件写了 `order`，其余七种没写，而 CSS 的
// 默认 `order` 是 **0** —— hero 其余部件从 1 起 ⟹ 「没写」= 排在这块 hero 的最上沿。带
// `transparent-overlay` 页眉的候选在页面顶部铺一层 160px 的黑色渐变遮罩，压在下面的字被冲淡：
// 实测 violet-74 的第一个 label 2.46:1（下限 2.5），CI 的 theme-css 当场红了三格。
//
// 🔴 这一格问的是**产物**，不是那张表：`HERO_LOOKS` 里写了 `form:` 而生成器没把它落进 CSS，
//    是另一种失败形状，读表看不见。
// 🔴 判据是「有 order 或有 grid-row」，两个都算 —— `media-cover` 的位置由 grid-row 说了算
//    （图和正文都显式落在第 1 行，order 在那儿不说话）。
//
// 🔴🔴 判据比「有没有写」再紧一档：**表单要排在正文之后**（同一根轴、值更大）。理由是「有位置」
//    这个谓词与实测到的那条安全性质不是同一件事 —— 真正让 label 从 2.46:1 回到 13.9:1 的是
//    「它不在页顶那 160px 里」，而 `order: 0` 是写下来了的位置，一样把它送回最上沿。
//    而运行时那道全量检查**抓不住**这种未来的写法：遮罩只出现在 `transparent-overlay` 那种页眉上，
//    80 套候选里只有 12 套是它 ⟹ 一种把表单排到最前的新画法，只在恰好落到那 12 套里时才会红。
//    这一格是静态的、逐画法的，与候选摊到哪种页眉无关。
const placementOf = (rule) => {
  for (const axis of ['order', 'grid-row']) {
    const m = rule.match(new RegExp(`(?:^|; )${axis}: ([^;}]+)`));
    if (m) return { axis, value: Number(m[1].trim()), raw: m[1].trim() };
  }
  return null;
};
console.log('\n⑥ 每一种画法都把 .hero__form 排在正文之后吗（#1065 r2 的红）');
// #1318 —— 分母从 `rules` 这张表自己派生，不再从 `HERO_LOOK_NAMES` × `TRIO` 派生：形态层里只有
// 池子真的用到的那些 hero 画法（理由整段在 effectiveSheetFor 上面），而按候选清单遍历会把
// 「这个画法今天没有站戴」报成「这张表漏了 .hero__form」——两件完全不同的事。
// 🔴 分母为空时上面那个调用点 die 了，所以这里不会退化成「一条都没判 ⟹ 绿」。
const formPlacementProblems = (rules) => {
  const out = [];
  for (const [look, i] of [...rules.keys()].map((n) => [n, n])) {
    const lines = (rules.get(look) || '').split('\n');
    const rule = lines.find((l) => /^\.hero__form \{/.test(l));
    const bodyRule = lines.find((l) => /^\.hero__body \{/.test(l));
    if (!rule) { out.push(`画法 ${look}（${i}）的表里根本没有 .hero__form 这条规则`); continue; }
    if (!bodyRule) { out.push(`画法 ${look}（${i}）的表里没有 .hero__body 这条规则 —— 没有可比的位置`); continue; }
    const form = placementOf(rule);
    const body = placementOf(bodyRule);
    if (!form) {
      out.push(`画法 ${look}（${i}）没给 .hero__form 排位置 —— 默认 order 是 0，它会排到 hero 最上沿：${rule}`);
      continue;
    }
    if (!body) { out.push(`画法 ${look}（${i}）没给 .hero__body 排位置，没法判表单排在它前面还是后面：${bodyRule}`); continue; }
    if (form.axis !== body.axis) {
      out.push(`画法 ${look}（${i}）正文用 ${body.axis} 排、表单用 ${form.axis} 排 —— 两根轴比不出先后`);
      continue;
    }
    if (!(form.value > body.value)) {
      out.push(`画法 ${look}（${i}）表单没排在正文之后：正文 ${body.axis}=${body.raw} · 表单 ${form.axis}=${form.raw}`
        + '（≤ 正文 ⟹ 它可能落进页顶那 160px 的遮罩里，就是 CI 红过的那一格）');
    }
  }
  return out;
};
{
  // 🔴 #1339 —— **这一格的域从 9 项变成 3 项，而那不是这次换语料换掉的，是它本来就没有对象。**
  //    逐条说清楚，免得下一个人把它当成「判据放松了」：
  //    · 表单是 `hero-with-form` 这个**块**的部件。#1333 之后 `hero` 自己不渲染表单了
  //      （`HeroSection.tsx` 里 `hero__form` 现取 **0** 命中），下面站那一臂的注释早就写着这一条。
  //    · 形态层里 `.hero__form` 的规则只挂在 `[data-block="hero-with-form"][data-shape="form-side"]`
  //      底下（`public/shapes.css` 现取：7 副 hero 画法底下一条 `.hero__form` 都没有）。
  //    · 而 `hero-with-form` 的形态**只有一副**（`blocks/hero-with-form.json` 的 `shapes` = 1 项）。
  //    ⟹ 「每一种 hero 画法都把表单排在正文之后吗」今天没有 7 个对象，只有 1 个。
  //    #1339 之前这一格的候选那一臂读到 7 项，是因为配方里还留着 7 副 hero 画法各自的 `.hero__form`
  //    位置 —— 那是 #1333 之后**没有任何 DOM 会用到**的死字，正是本票要删的东西。
  //    TRIO 那个夹具留着 —— ⑤ 那一格还在用它问**内容结构**，那一维仍然是每个候选都答得出来的。
  const rules = new Map([[`form-side（配方侧，候选 ${TRIO[0]}）`,
    heroRulesOf(recipeSheetFor(TRIO[0], undefined, { only: 'hero-with-form', as: 'hero' }))]]);
  // 🔴 #1333 —— 站那一臂问的块从 `hero` 换成了 `hero-with-form`：表单是**那个块**的部件，hero 自己
  //    已经没有表单了（`HeroSection.tsx` 里那一支删了）。照旧问 hero 的话，这一格问的是
  //    「一个不存在的部件排在哪」，而它答得出来的唯一答案是「没排」—— 两套站当场全红，而那两套
  //    其实都好好地给表单排了位置（实测：改成这样之前 `media-cover @ 站 azure-29` /
  //    `text-center @ 站 ember-12` 两条红，改回来就是 0）。
  //    `as: 'hero'` 是因为这个块借用 `.hero__*` 那套类名（manifest 的 `hooksFrom`），理由写在
  //    `effectiveSheetFor` 上面。
  const FORM_BLOCK = 'hero-with-form';
  for (const id of POOL_IDS) {
    const shape = (POOL[id].shapes || {})[FORM_BLOCK];
    if (!shape) die(`⑥ 池里 ${id} 的选择单没有 ${FORM_BLOCK} —— 这一格问不出「它的表单排在哪」`);
    rules.set(`${shape} @ 站 ${id}`, heroRulesOf(effectiveSheetFor(id, { only: FORM_BLOCK, as: 'hero' })));
  }
  const LOOKS_HERE = [...rules.keys()];
  // 分母自检：1 项配方侧 + 池里每一套站。少一项就是有键撞掉了（不是「这一格变松了」）。
  if (LOOKS_HERE.length !== 1 + POOL_IDS.length) {
    die(`⑥ 的语料有 ${LOOKS_HERE.length} 项，而「配方侧 1 项 + ${POOL_IDS.length} 套池内主题」`
      + `应当是 ${1 + POOL_IDS.length} 项 —— 有键撞掉了`);
  }
  const problems = formPlacementProblems(rules);
  if (problems.length) problems.forEach((m) => bad(m));
  else {
    const shapes = LOOKS_HERE.map((n) => {
      const lines = (rules.get(n) || '').split('\n');
      const f = placementOf(lines.find((l) => /^\.hero__form \{/.test(l)));
      const b = placementOf(lines.find((l) => /^\.hero__body \{/.test(l)));
      return `${n} 正文 ${b.axis}=${b.raw}→表单 ${f.raw}`;
    });
    ok(`${LOOKS_HERE.length} 项逐项（1 项出自配方侧的 hero-with-form/form-side + ${POOL_IDS.length} 套`
      + `池内主题真正拿到的那份）：.hero__form 排在正文之后（${shapes.join(' · ')}）`);
  }

  // 阳性对照：把其中一种画法的 form 那条位置拿掉，这把尺必须当场只点名它。
  // 直接改产物字符串 —— 改 HERO_LOOKS 会连着改掉上面几格共用的那份表。
  const target = LOOKS_HERE[0];
  const rigged = new Map(rules);
  rigged.set(target, (rules.get(target) || '').split('\n').map((l) => (
    /^\.hero__form \{/.test(l) ? l.replace(/(^|; )order: [^;}]+(; )?/, '$1') : l
  )).join('\n'));
  const caught = formPlacementProblems(rigged);
  if (caught.length === 1 && caught[0].includes(`画法 ${target}`)) {
    ok(`反向对照 a：拿掉 ${target} 的 .hero__form 位置，这把尺只点名它（${caught[0].slice(0, 60)}…）`);
  } else if (caught.length) {
    bad(`反向对照 a 对不上：点名了 ${caught.length} 条，应当只有 ${target} 那一条 —— ${caught.join(' · ')}`);
  } else {
    bad('反向对照 a 失败：拿掉一种画法的 .hero__form 位置之后，这把尺一句话都没说');
  }

  // 🔴 阳性对照 b —— 单独打「排在正文之后」这一维：位置**写着**，但写的是 1（正文是 2 或 3）。
  //    a 那一条对这种写法是盲的（它只问有没有写），所以这一维必须自己有一次红，否则它是装饰。
  const rigged2 = new Map(rules);
  rigged2.set(target, (rules.get(target) || '').split('\n').map((l) => (
    /^\.hero__form \{/.test(l) ? l.replace(/(^|; )order: [^;}]+/, '$1order: 1') : l
  )).join('\n'));
  const caught2 = formPlacementProblems(rigged2);
  if (caught2.length === 1 && caught2[0].includes('表单没排在正文之后')) {
    ok(`反向对照 b：把 ${target} 的 .hero__form 写成 order: 1（正文之前），这把尺只点名它（${caught2[0].slice(0, 72)}…）`);
  } else if (caught2.length) {
    bad(`反向对照 b 对不上：点名了 ${caught2.length} 条 —— ${caught2.join(' · ')}`);
  } else {
    bad('反向对照 b 失败：把一种画法的表单排到正文之前，这把尺一句话都没说 ⟹ 这一维是装饰');
  }
}


// ══ ⑦ 换画法不许把桌面那一段丢掉（#1090 r2 —— QA2 在真机上抓到的那个退步）══════════════════════
//
// 形态：`wideRule` 里同时装着**列数**和**桌面留白**（#1078 把留白折进来那一次），而发不发它的判据
// 只问列数（`cols !== '1fr'`）。于是 `media-top` / `narrow-stack` / `wide-rows` 这三个选了单栏的画法
// 把它们所在块族的 `@media (min-width: 1024px)` 整段弄丢了 —— 列数变成 1 是本意，`gap` 和 `padding`
// 跟着没了不是。QA2 逐份表数出来：content-split 80→40 套、另外三个卡片块各 80→60 套；真机 1440px 上
// gap 24→16、padding 56/48→40/24，也就是桌面用回了手机的留白。
//
// 🔴 这一格问的是**产物**，不是那张表：判据放在「每一份表里这个块有没有那一段」上，所以无论以后
//    谁加画法、加在哪张表里，漏掉桌面那一段都会当场红。
// 🔴 hero **不在**这一格的分母里，而且这是有意的：它归 #1065，它那 53 套纯文字画法今天本来就没有
//    桌面那一段（27/80 有）。把它算进来等于要求本票去改另一张票的产物。
// 🔴 #1139 —— 分母**从注册表派生**：`keepsWide` 为真的每一族。原来这里写死的是
//    `['content-split', ...CARD_BLOCKS]`，每加一族都得有人记得回来补一个名字，而漏掉那一族的
//    样子跟通过一模一样。派生之后「加了一族却忘了在别处补一行」这个错法写不出来了。
//    📌 `keepsWide` 为假的那几族（hero / page-header / faq-accordion）不在这里，理由各自写在
//    `LOOK_FAMILIES` 上面那段：它们在本票之前就没有桌面那一段，这一格要求的东西对它们不成立。
const WIDE_AT = /min-width:\s*1024px/;
const hasWideRule = (css, block) => {
  let found = false;
  postcss.parse(css).walkAtRules('media', (at) => {
    if (!WIDE_AT.test(at.params)) return;
    at.walkRules((r) => { if (r.selector.trim() === `.${block}`) found = true; });
  });
  return found;
};
console.log('\n⑦ 换画法之后，桌面那一段还在吗（#1090 r2）');
{
  const N = 80;
  const KEEPERS = LOOK_FAMILIES.filter((f) => f.keepsWide);
  const FAMILIES = KEEPERS.flatMap((f) => f.blocks);
  const sheets = [];
  for (let i = 0; i < N; i += 1) sheets.push({ i, css: sheetFor(i), v: voiceFor(i) });
  /** 第 i 套在这个块所属那一族里挑的那副画法（从注册表 `LOOK_FAMILIES` 派生，不抄一份名单）。 */
  const lookOn = (x, block) => {
    const f = LOOK_FAMILIES.find((g) => g.blocks.includes(block));
    return f ? `${f.key}=${x.v[f.key]}` : '（无候选表）';
  };
  const missing = [];
  for (const fam of FAMILIES) {
    const bad2 = sheets.filter((x) => !hasWideRule(x.css, fam));
    if (bad2.length) {
      missing.push(`${fam}: ${bad2.length}/${N} 套没有 @media(min-width:1024px) 那一段`
        + `（例 i=${bad2[0].i}，${lookOn(bad2[0], fam)}）`);
    }
  }
  if (missing.length) missing.forEach((m) => bad(m));
  else {
    // 顺带把每种画法都点名，免得「全过」是因为某种画法一套都没摊到
    const byLook = {};
    for (const f of KEEPERS) {
      for (const x of sheets) {
        const k = `${f.key}:${x.v[f.key]}`;
        byLook[k] = (byLook[k] || 0) + 1;
      }
    }
    const thin = Object.entries(byLook).filter(([, n]) => n === 0);
    if (thin.length) bad(`这些画法一套都没摊到：${thin.map(([k]) => k).join(' ')} —— 「全过」是空绿`);
    ok(`${FAMILIES.length} 个块族（${KEEPERS.length} 族 · keepsWide 为真的那些）× ${N} 套：`
      + `每一份表里桌面那一段都在（画法分布 ${Object.entries(byLook).map(([k, n]) => `${k} ${n}`).join(' · ')}）`);
  }

  // 阳性对照：把判据退回「只问列数」那一版，这把尺必须当场红，而且红的正是那三个单栏画法所在的族。
  // 做法是直接改**产物**：把单栏画法那几套表里那一段删掉 —— 不为了测试在生产代码里留一条只有测试
  // 会走的路（这个文件自己的纪律）。
  const stripWide = (css, block) => {
    const root = postcss.parse(css);
    root.walkAtRules('media', (at) => {
      if (!WIDE_AT.test(at.params)) return;
      at.walkRules((r) => { if (r.selector.trim() === `.${block}`) r.remove(); });
      if (at.nodes.length === 0) at.remove();
    });
    return root.toString();
  };
  // 🔴 「这一套里哪些块选了单栏画法」也从注册表算，不再手抄画法名（原来是写死的
  //    `new Set(['media-top','narrow-stack','wide-rows'])`）。
  // 🔴 #1339 —— 判据以前是那副画法自己的 `cols === '1fr'`，而列数是几何、已经从配方里删干净。
  //    携带同一件事的今天是 `wideSpacing: false`（当年写 `cols: '1fr'` 的那 31 条一一对应，
  //    理由在 `sheet-recipes.js` 的 `buildSheet` 里那个调用点上）。
  const singlesOn = (x) => KEEPERS.flatMap((f) => (
    f.table[x.v[f.key]].wideSpacing === false ? f.blocks : []));
  let caught = 0;
  let shouldCatch = 0;
  for (const x of sheets) {
    const singles = singlesOn(x);
    if (singles.length === 0) continue;
    shouldCatch += 1;
    let rigged = x.css;
    for (const fam of singles) rigged = stripWide(rigged, fam);
    if (singles.some((fam) => !hasWideRule(rigged, fam))) caught += 1;
  }
  if (shouldCatch === 0) bad('反向对照不成立：池里一套单栏画法都没摊到 —— 这一格按构造是空绿');
  else if (caught === shouldCatch) {
    ok(`反向对照：把那 ${shouldCatch} 套单栏画法的表里桌面那一段删掉，这把尺 ${caught} 套全部点名 —— 它不是恒绿`);
  } else {
    bad(`反向对照对不上：该点名 ${shouldCatch} 套，实际只点名 ${caught} 套`);
  }
}

// ══ ⑧ 画法自己表过态的留白，桌面那一段不许盖掉（#1090 r2）══════════════════════════════════════
//
// `wideRule` 排在根规则之后、同特异度，所以它发的每一条都会盖掉根规则里同名那条。`four-up-tight`
// 的整个意思就是「更紧」：它在 rootExtra 里把 gap 收到 `gapStep - 2`，而桌面那一段发的是
// `gapStep * 1.5` ⟹ 改之前那个画法在 1024px 以下是紧的、在桌面上比标准还宽，而它的名字说它紧。
// （卡片内边距那一半没被盖掉，因为它走 `partExtra`，不是这条规则 —— 也就是同一个画法只塌了一半，
//   而「一半对」在图册上比「全错」更难看出来。）
console.log('\n⑧ 画法自己声明的留白，桌面上还作数吗（#1090 r2）');
{
  const N = 80;
  const declOf = (css, block, prop, where) => {
    let v = null;
    const root = postcss.parse(css);
    if (where === 'root') {
      // 🔴 只走顶层：postcss 的 walkRules 会下钻进 at-rule，不加这个判断读到的是媒体查询里那条
      root.walkRules((r) => {
        if (r.parent.type === 'root' && r.selector.trim() === `.${block}`) r.walkDecls(prop, (d) => { v = d.value; });
      });
    } else {
      root.walkAtRules('media', (at) => {
        if (!WIDE_AT.test(at.params)) return;
        at.walkRules((r) => { if (r.selector.trim() === `.${block}`) r.walkDecls(prop, (d) => { v = d.value; }); });
      });
    }
    return v;
  };
  const tight = [];
  // #1341 —— 这一行原来读的是 `layoutNamesFor(i).cards`。那个函数随内容结构那一维一起退役了，
  //    改读 `voiceFor(i).cards`：`cards` 这一档的唯一出口本来就是 `voiceFor`
  //    （`sheet-recipes.js` 的 `cards: cardGridFor(i)`），而 `layoutNamesFor` 逐字就是它的一层壳
  //    （`{ hero: v.hero, split: v.split, splitRhythm: v.splitRhythm, cards: v.cards }`）⟹ 等价替换，
  //    这一格守的性质不变。
  for (let i = 0; i < N; i += 1) if (voiceFor(i).cards === 'four-up-tight') tight.push(i);
  if (tight.length === 0) die('夹具不成立：80 套里没有一套用 four-up-tight —— 这一格无处可量');
  const clobbered = [];
  for (const i of tight) {
    const css = sheetFor(i);
    for (const fam of CARD_BLOCKS) {
      const root = declOf(css, fam, 'gap', 'root');
      const wide = declOf(css, fam, 'gap', 'wide');
      // 桌面上真正生效的 = 媒体查询里那条（有的话），否则根规则那条
      if ((wide || root) !== root) clobbered.push(`i=${i} ${fam}: 根 ${root} 被桌面那条 ${wide} 盖掉`);
      // 而没表过态的那一项照旧放大 —— 少了这半句，「都不发」也能让上一半绿
      const padWide = declOf(css, fam, 'padding', 'wide');
      if (!padWide || !/ 3rem$/.test(padWide)) clobbered.push(`i=${i} ${fam}: 桌面 padding 没拿到 3rem 那一档（${padWide}）`);
    }
  }
  if (clobbered.length) clobbered.slice(0, 6).forEach((m) => bad(m));
  else {
    ok(`four-up-tight ${tight.length} 套 × ${CARD_BLOCKS.length} 个块：它自己声明的紧 gap 在桌面上仍然生效，`
      + '而它没表态的 padding 照旧放大到桌面那一档');
  }

  // 阳性对照：在产物上把桌面那条 gap 补回去（= 改之前那一版的行为），这把尺必须当场红。
  const putBackWideGap = (css, block, value) => {
    const root = postcss.parse(css);
    root.walkAtRules('media', (at) => {
      if (!WIDE_AT.test(at.params)) return;
      at.walkRules((r) => { if (r.selector.trim() === `.${block}`) r.append({ prop: 'gap', value }); });
    });
    return root.toString();
  };
  const i0 = tight[0];
  const rigged = putBackWideGap(sheetFor(i0), CARD_BLOCKS[0], 'calc(var(--section-block-gap) * 9)');
  const r2 = declOf(rigged, CARD_BLOCKS[0], 'gap', 'root');
  const w2 = declOf(rigged, CARD_BLOCKS[0], 'gap', 'wide');
  if ((w2 || r2) !== r2) ok(`反向对照：把桌面那条 gap 补回 ${w2}（改之前的行为），这把尺当场点名（根 ${r2}）`);
  else bad('反向对照失败：补回桌面那条 gap 之后这把尺没说话 —— 它量不出盖没盖掉');
}


console.log('\n⑨ #1135 两族的分布：每档都够多，而且没有哪一族决定另一族');
// 🔴 #1317 —— 这一格算的是「每一档画法占池子的百分之几」，而它的分母自检拿 `public/themes` 里的
//    份数核 `POOL`。脚手架期盘上只剩 2 份池子表（另外 95 份跟着主题一起下架了），那条自检当场
//    `die` ⟹ **整份文件从这里开始一行都不跑**，后面 ⑩ ⑪ ⑫ ⑬ ⑮ 的读数全都没人看得到。
//    AC2 那条 15% 的地板在 2 套的池子上本来也没有意义（每一档要么 0% 要么 50%）。
if (!skip('⑨ 两族分布的 15% 地板', '盘上只剩 2 份池子表，百分比这一族在池子重生成之前没有意义')) {
  // 🔴 #1174 —— 池子从 80 涨到 97（保险 +6、地产 +11）。这个数不许瞎写：下面第一格拿
  //    `public/themes` 里的份数自己核它，对不上就 die（不是 bad —— 分母错了，下面每一条
  //    百分比都是假的）。
  // 🔴 #1317 —— 这个数描述的是**标定那一次**的池子，不是今天的（今天是 2 套，整格已按池子大小门控）。
  //    池子重生成那天要连同 AC2 那条 15% 的地板一起重算（每档 = 池子 / 候选数），别只改这个数。
  const POOL = 97;                       // #1016 的池子 + #1174 的扩容；下面第一格自己核它
  const rot = (i, L) => (i + Math.floor(i / L)) % L;
  const dist = (f, L) => {
    const c = new Map();
    for (let i = 0; i < POOL; i += 1) c.set(f(i), (c.get(f(i)) || 0) + 1);
    return { archs: c.size, counts: [...c.values()].sort((a, b) => a - b), L };
  };

  // ── 分母自检：池子真的是 80 套吗（AC2 的百分比全靠它）────────────────────────────────────────
  {
    const dir = path.join(__dirname, '..', '..', 'public', 'themes');
    // 📌 #1174 —— 这条正则**不用改**，池子 97 套时最大的 id 是 `word-97`，仍是两位数
    //    （`promote.js:86` 的 `String(slot.index + 1).padStart(2,'0')`）。三位数只在池子 ≥100
    //    时才出现。上一版这里按池子 102 改成了 `\d{2,3}`，本票的 97 用不上 —— 而放宽它是有代价的：
    //    真到 100 套那天，`\d{2,3}` 会让分母自检**默默接受**三位数的新表，而这一格存在的理由
    //    正是「分母错了下面每条百分比都是假的」要当场 die。
    const n = fs.readdirSync(dir).filter((f) => /^[a-z]+-\d{2}\.css$/.test(f)).length;
    if (n !== POOL) {
      die(`夹具不成立：public/themes 里有 ${n} 份池子表，而这一格按 ${POOL} 算百分比。`
        + '池子大小变了 ⟹ AC2 那条 15% 的地板要重算（每档 = 池子/候选数）。');
    }
    ok(`⑨ 分母自检：池子就是 ${POOL} 份表（百分比按它算）`);
  }

  // ── AC2：每一档的池内占比 ≥15% ───────────────────────────────────────────────────────────────
  //
  // 🔴 #1139 —— 族清单**从注册表派生**，不再手写。原来这里是两行写死的 `rows`，每加一族都得有人
  //    记得回来补一行，而漏掉那一族的样子跟通过一模一样（它就不在射程内，格子照样绿）。同族的账
  //    本仓记过一笔：`templates/nextjs/package.json` 的 `lint:scripts` 也是一张手抄清单，一天内
  //    撞车四次（#1096 / #1121 / #1125 / #1126）。
  {
    const FLOOR = 0.15;
    // 🔴 hero 不受这条地板管，而且这个例外要写在明处：它有 8 副画法（#1065 定的，早于这条地板），
    //    80 / 8 = 10 套 = 12.5%。把它算进来这一格会**恒红**，而它红的不是本票也不是 #1135 要治的
    //    东西。它的读数照样打出来，只是不判。
    const FLOOR_EXEMPT = new Map([['heroLook', '#1065 定的 8 副画法早于这条地板']]);
    const rows = LOOK_FAMILIES.map((f) => ({
      name: f.blocks.join(' / '), key: f.key, fn: f.pick, L: Object.keys(f.table).length,
    }));
    const problems = [];
    const said = [];
    const exempt = [];
    for (const r of rows) {
      const d = dist(r.fn, r.L);
      const floor = d.counts[0] / POOL;
      const line = `${r.name} ${d.archs} 档 · ${d.counts.join('/')} · 最小档 ${(floor * 100).toFixed(1)}%`;
      if (FLOOR_EXEMPT.has(r.key)) { exempt.push(`${line}（不判：${FLOOR_EXEMPT.get(r.key)}）`); continue; }
      said.push(line);
      if (d.archs !== r.L) problems.push(`${r.name}：${r.L} 种候选里只轮到 ${d.archs} 种`);
      if (floor < FLOOR) {
        problems.push(`${r.name}：最小那一档只占 ${(floor * 100).toFixed(1)}%，低于 ${FLOOR * 100}% `
          + '（AC2）—— 候选数与池子大小的关系：每档 = 池子/候选数，所以候选数最多 6');
      }
    }
    if (problems.length === 0) {
      ok(`⑨ AC2：${rows.length - exempt.length} 族逐族 —— ${said.join(' · ')} —— 都 ≥${FLOOR * 100}%`);
      ok(`⑨ AC2 例外（打读数不判）：${exempt.join(' · ')}`);
    } else problems.forEach(bad);

    // 反向对照：把候选数当成 7（超过 6）会破 —— 证明这一格不是恒绿
    const seven = dist((i) => rot(i, 7), 7);
    if (seven.counts[0] / POOL < FLOOR) {
      ok(`⑨ AC2 反向对照：同一条式子取 7 档时最小档 ${(seven.counts[0] / POOL * 100).toFixed(1)}% < 15% `
        + '⟹ 这一格真的会因为候选太多而红（今天各族的候选数都在量出来的上限内）');
    } else {
      bad('⑨ AC2 反向对照失败：7 档也过得了 15% —— 这一格量不出「候选太多」这件事');
    }
  }

  // ── 「与别的族解耦」：没有哪一族决定另一族 ────────────────────────────────────────────────────
  //
  // 🔴 判据是**互不决定**，不是「所有组合都出现」。80 套装不下 hero(8) × form(6) 的 48 种全部组合，
  //    拿「组合齐全」当判据会得出一个做不到的要求。正文说的是「别让『hero 选了 A』连带『cta 必是 B』」
  //    —— 那就是「X 的每一个取值下，Y 至少还有 2 种取值」，两向都要。
  //
  // 🔴 #1139 —— 从「只判本票那两族」改成**全部两两都判**，另加一张写在明处的已知例外表。
  //    原来那版用 `MINE = ['cta','form']` 圈定射程，于是任何**不在** MINE 里的新族都自动免检，
  //    而免检的样子跟通过一模一样。现在反过来：默认全判，要免检就得在下面这张表里留下名字和理由。
  {
    const notDet = (f, g) => {
      const m = new Map();
      for (let i = 0; i < POOL; i += 1) {
        if (!m.has(f(i))) m.set(f(i), new Set());
        m.get(f(i)).add(g(i));
      }
      return Math.min(...[...m.values()].map((s) => s.size));
    };
    const mutual = (f, g) => Math.min(notDet(f, g), notDet(g, f));
    const fams = Object.fromEntries(LOOK_FAMILIES.map((f) => [f.key, f.pick]));
    // `CARD_STYLES` 不是画法族（它是卡片形态那一档），但它同样是一条会跟别族撞模数的轴，所以一起判。
    fams.cardStyle = (i) => voiceFor(i).card;
    // 🔴 已知例外，逐条带理由。**本票之前就是这样，不是这里引入的**：`split` 与 `cards` 都用
    //    `(i + floor(i/4)) % 4`，同式同模 ⟹ 两族的档完全互相决定（实测 80/80 套一个不差）。
    //    本票不动这一对（那会改掉 content-split 与卡片组的产物，圈外），但把它记在这里 ——
    //    默认全判之后，不写在这儿它就会让这一格红。
    const KNOWN = new Map([['cards|split', '#1090 起两族同式同模（都是 4），本票不动它们的产物']]);
    const keys = Object.keys(fams);
    const problems = [];
    const readings = [];
    const excused = [];
    for (let a = 0; a < keys.length; a += 1) {
      for (let b2 = a + 1; b2 < keys.length; b2 += 1) {
        const pair = [keys[a], keys[b2]].sort().join('|');
        const min = mutual(fams[keys[a]], fams[keys[b2]]);
        if (KNOWN.has(pair)) { excused.push(`${pair} ${min}（${KNOWN.get(pair)}）`); continue; }
        readings.push(`${keys[a]}↔${keys[b2]} ${min}`);
        if (min < 2) {
          problems.push(`${keys[a]} 与 ${keys[b2]} 互相决定（某一档下对方只剩 ${min} 种取值）——`
            + '同式同模的两族会这样，错开的步长必须避开已被占的');
        }
      }
    }
    if (problems.length === 0) {
      ok(`⑨ 解耦：${keys.length} 条轴两两互不决定，共 ${readings.length} 对（每档下对方至少 2 种）`);
      ok(`⑨ 解耦逐对读数：${readings.join(' · ')}`);
      ok(`⑨ 解耦已知例外：${excused.join(' · ') || '（没有）'}`);
    } else problems.forEach(bad);

    // 反向对照：把 cta 换成跟 cards 同式同模（4），这一格必须红
    const clash = mutual((i) => rot(i, 4), (i) => voiceFor(i).cards);
    if (clash < 2) {
      ok(`⑨ 解耦反向对照：把 cta 换成跟 cards 同式同模（都是 4）⟹ 互相决定度 ${clash} < 2，`
        + '这一格当场红 —— 所以上面那些 ≥2 是错开步长挣来的，不是恒真');
    } else {
      bad('⑨ 解耦反向对照失败：同式同模也判成解耦 —— 这个判据量不出耦合');
    }
  }
}


// ══ 每一种 form 画法都能取到一套编号（⑩ ⑪ 共用的夹具）════════════════════════════════════════
const FORM_LOOK_SAMPLE = (() => {
  const seen = new Map();
  for (let i = 0; i < 400 && seen.size < FORM_LOOK_NAMES.length; i += 1) {
    const look = voiceFor(i).formLook;
    if (!seen.has(look)) seen.set(look, i);
  }
  if (seen.size !== FORM_LOOK_NAMES.length) {
    die(`夹具不成立：走 400 步只覆盖了 ${seen.size} 种 form 画法，一共 ${FORM_LOOK_NAMES.length} 种`);
  }
  return seen;
})();

/** 那个块的源码 —— ⑩ ⑪ 两格都要问「这个部件在 DOM 里排第几 / 在谁里面」。 */
const CONTACT_TSX = path.resolve(DIR, '..', '..', 'src', 'components', 'sections', 'ContactFormSection.tsx');

console.log('\n⑩ #1135 成功那条状态消息，每一种画法下都跨满整宽（报错那条为什么不在这里，见下）');
{
  // 🔴 为什么单开一格：`contact-form__success` 是**条件渲染**的（`ContactFormSection.tsx` 的成功
  //    分支），所以静态产物里没有它 —— 本票那几个多栏候选按构造从来不会在「它在场」的状态下被
  //    任何 e2e 量到。真去量了一次（hydration 之后插进 DOM 再读几何）：`panel-right` 那一支上它
  //    只占 45% 宽，被自动流塞进了侧栏。修法写在块那一层（`SHAPES['contact-form'].partExtra`），
  //    这一格钉的就是它。
  //
  // 🔴 **`error` 那一半从这一格里拿掉了（#1135 r2）。** 上一版这里写的是「报错与成功那两条消息都
  //    写着 grid-column: 1 / -1」—— 关于 CSS 字面那句话是真的，但它让人以为报错那条的**几何**
  //    也被守住了，而其实没有：`contact-form__error` 是 `<form class="contact-form__form">` 的
  //    子节点，那个 form 自己是单栏 grid ⟹ 那条规则是恒等式，它本来就是表单那么宽。
  //    （我上一轮量到的「30/46/30% → 93%」是仪器造的：往 DOM 里插了一个 React 不会产出的节点。）
  //    所以这一格改成钉**那个前提**：error 住在 form 里面、form 是单栏。哪天有人把它挪出去、
  //    或者给 form 分栏，下面 B1/B2 会红 —— 那时那条规则开始真的作数，得有人重新量一次几何，
  //    而不是继承这句话。谓词必须等于实测过的性质，这是本票自己的账。
  //    🔴 #1134 —— 「给 form 分栏 ⟹ B2 会红」这半句在 #1135 交付时**只对 grid 分栏成立**，flex 横排
  //       整套单测全绿地穿过去（QA3 真驱动过）。B2 的扫描面已经扩到两种写法，理由与标定写在它自己
  //       那一段上面。这句话现在是真的了 —— 但它当初不是，所以别把这种「哪天…会红」的话当读数：
  //       它是一个断言，要有一格量它。
  const spans = (css, part) => {
    const m = css.match(new RegExp(`\\.contact-form__${part} \\{[^}]*\\}`));
    return !!m && /grid-column:\s*1 \/ -1/.test(m[0]);
  };
  // #1318 —— 语料换成「池子里每一套主题真正拿到的那份 CSS」：`grid-column` 是几何，今天住在
  // `public/shapes.css` 里，而形态层只有池子真的用到的那些 form 画法（理由整段在 effectiveSheetFor
  // 上面）。按 FORM_LOOK_SAMPLE 那 6 个候选遍历的话，会把「这个画法今天没有站戴」报成「它没跨满」。
  const FORM_HERE = new Map([...FORM_LOOK_SAMPLE].map(([look, i]) => [look, recipeSheetFor(i)]));
  for (const id of POOL_IDS) {
    FORM_HERE.set(`${(POOL[id].shapes || {})['contact-form']} @ 站 ${id}`, effectiveSheetFor(id));
  }
  if (FORM_HERE.size !== FORM_LOOK_SAMPLE.size + POOL_IDS.length) {
    die(`⑩ 的语料 ${FORM_HERE.size} 项，应当是 ${FORM_LOOK_SAMPLE.size} + ${POOL_IDS.length} —— 有键撞掉了`);
  }
  const problems = [];
  for (const [look, css] of FORM_HERE) {
    if (!spans(css, 'success')) {
      problems.push(`画法 ${look} 的 .contact-form__success 没有跨满整宽`);
    }
  }
  if (problems.length === 0) {
    ok(`⑩ ${FORM_HERE.size} 项逐项（${FORM_LOOK_SAMPLE.size} 种画法出自配方 + ${POOL_IDS.length} 套`
      + '池内主题真正拿到的那份）：成功那条消息写着 grid-column: 1 / -1');
  } else problems.forEach(bad);

  // 反向对照：把那处修法从**真语料**上外科式地拿掉，这一格必须当场红（否则它只是在读别处写的东西）。
  //
  // 🔴 #1318 —— 靶子换了地方：`grid-column: 1 / -1` 这行今天在 `public/shapes.css` 里，不在
  //    `sheet-recipes.js` 的块那一层。上一版是把配方源码里那一行剪掉再重新 require —— 那条路今天
  //    **恒红**（配方照样算出这行，只是被几何滤网滤掉了，所以剪不剪产物里都没有它），也就是说它
  //    会变成一格「怎么改都通过」的装饰。所以改成直接扰动形态层的字节，一个变量。
  {
    const shapesCss = fs.readFileSync(SHAPES_PATH, 'utf-8');
    const before = (shapesCss.match(/\.contact-form__success \{[^}]*grid-column:\s*1 \/ -1/g) || []).length;
    if (before === 0) {
      bad('⑩ 反向对照立不起来：public/shapes.css 里找不到 .contact-form__success 的 grid-column: 1 / -1');
    } else {
      const rigged = shapesCss.replace(
        /(\.contact-form__success \{[^}]*?)grid-column:\s*1 \/ -1;\n/g, '$1',
      );
      // 用扰动过的形态层重算语料 —— 只换这一样，主题表那一半一个字节都没动。
      const spy = fs.readFileSync;
      fs.readFileSync = (f, ...rest) => (f === SHAPES_PATH ? rigged : spy(f, ...rest));
      let still;
      try {
        still = [...POOL_IDS].some((id) => spans(effectiveSheetFor(id), 'success'));
      } finally { fs.readFileSync = spy; }
      if (!still) {
        ok(`⑩ 反向对照：把形态层里那 ${before} 处 grid-column: 1 / -1 拿掉，成功那条消息立刻不再跨满`
          + ' —— 这一格量的就是它');
      } else bad('⑩ 反向对照失败：拿掉之后它照样跨满 —— 那这一格钉的不是这处修法');
    }
  }

  // B1（前提·源码）报错那条住在表单里面 —— 它跟成功那条不是同一层。
  const tsx = fs.readFileSync(CONTACT_TSX, 'utf-8');
  const insideForm = (src) => {
    const open = src.indexOf('className="contact-form__form"');
    const close = src.indexOf('</form>', open < 0 ? 0 : open);
    const err = src.indexOf('className="contact-form__error"');
    if (open < 0 || close < 0 || err < 0) return null;          // 读不到 ≠ 判它不在里面
    return err > open && err < close;
  };
  const nowInside = insideForm(tsx);
  if (nowInside === null) {
    die('⑩ B1 立不起来：ContactFormSection.tsx 里找不到 contact-form__form / </form> / contact-form__error 三个锚点');
  } else if (nowInside) {
    ok('⑩ B1 报错那条消息住在 <form class="contact-form__form"> 里面 —— 块那一层给它写的 1/-1 是恒等式（留着当保险）');
  } else {
    bad('⑩ B1 报错那条消息已经不在表单里面了 —— 块那一层那条 1/-1 从此真的作数，'
      + '请重新量一次它的几何（上一轮那个 30/46/30%→93% 的读数是仪器造的，不能拿来用）');
  }
  // B1 的阳性对照：把那一行挪到 </form> 之后（只在内存里改字符串），这把尺必须读出 false
  {
    const errLine = tsx.split('\n').find((l) => l.includes('className="contact-form__error"'));
    if (!errLine) {
      bad('⑩ B1 阳性对照立不起来：抠不出报错那一行');
    } else {
      const moved = tsx.replace(`${errLine}\n`, '').replace('</form>', `</form>\n${errLine}`);
      const after = insideForm(moved);
      if (after === false) ok('⑩ B1 阳性对照：把那一行挪到 </form> 之后，这把尺当场读出「不在里面」—— 它不是恒真');
      else bad(`⑩ B1 阳性对照失败：挪出去之后它还说在里面（读数 ${after}）—— 这把尺分不出层级`);
    }
  }
  // B2（前提·产物）那个 form 是单栏 —— 单栏网格里 `1 / -1` 与 `auto` 等价。
  //
  // 🔴 #1134（来源 #1135，QA3 在一次性副本里真驱动过）—— **「分栏」不只有 grid 一种写法，而这一格
  //    原来只认 grid。** 上面那段头注写着「哪天有人…给 form 分栏，下面 B1/B2 会红」,那句话**只对
  //    grid 分栏成立**：用 `display: flex`（`flex-direction` 缺省就是 `row`）分栏时，
  //    ① 受限 CSS 检查放行 —— `theme-css-lint.js` 的 `PROP_EXACT` 收 `display`、值白名单收 `flex`、
  //       前缀白名单收 `flex-`；
  //    ② 这一格的正则只找 `grid-template-columns` ⟹ 读到 0，判「单栏」；
  //    ③ 整套单测仍然全绿（QA3 注入 flex 分栏后：42 过 0 失败）。
  //    也就是说前提被推翻了而没有任何读数变化 —— 而这一格存在的全部理由就是守那个前提。
  //    ⟹ 判据改成「这个 form 是不是一个**横向排布**的容器」，两种写法一起认。
  {
    // #1318 —— 语料同上：横排与否是几何，今天住在形态层，而形态层只有池子真的用到的那些画法。
    const multi = [];
    const why = {};
    for (const [look, css] of FORM_HERE) {
      const m = css.match(/\.contact-form__form \{[^}]*\}/);
      if (!m) continue;
      const decl = m[0];
      const reasons = [];
      if (/grid-template-columns/.test(decl)) reasons.push('grid-template-columns');
      // flex 那一支:`display: flex | inline-flex` 且没有把方向掰成 column。
      // `flex-flow` 也要认 —— 它是 `flex-direction` + `flex-wrap` 的简写。
      if (/(?:^|[;{]\s*)display:\s*(?:inline-)?flex\b/.test(decl)) {
        const col = /(?:^|[;{]\s*)flex-direction:\s*column/.test(decl)
          || /(?:^|[;{]\s*)flex-flow:[^;]*\bcolumn\b/.test(decl);
        if (!col) reasons.push('display:flex 且方向不是 column');
      }
      if (reasons.length) { multi.push(look); why[look] = reasons.join(' + '); }
    }
    // 分母自检：这把尺子读得到 grid-template-columns 吗（块根那条一定有）
    const rootHas = /\.contact-form \{[^}]*grid-template-columns/.test([...FORM_HERE.values()][0]);
    // 🔴 flex 那一半也要有自己的分母自检 —— 否则「flex 读到 0」可能是正则瞎了，而不是真没有。
    //    拿一条合成声明校准：它必须被判成横排，且掰成 column 之后必须不被判。
    const probe = (d) => {
      const decl = `.contact-form__form { ${d} }`;
      if (/(?:^|[;{]\s*)display:\s*(?:inline-)?flex\b/.test(decl)) {
        return !(/(?:^|[;{]\s*)flex-direction:\s*column/.test(decl)
          || /(?:^|[;{]\s*)flex-flow:[^;]*\bcolumn\b/.test(decl));
      }
      return false;
    };
    const flexRulerOk = probe('display: flex; gap: 1rem;')
      && !probe('display: flex; flex-direction: column;')
      && !probe('display: flex; flex-flow: column wrap;')
      && !probe('display: grid;');
    if (!rootHas) {
      die('⑩ B2 的尺子坏了：连块根那条 grid-template-columns 都读不到 —— 那「form 里没有」这个 0 不作数');
    } else if (!flexRulerOk) {
      die('⑩ B2 的尺子坏了：flex 那一半在合成声明上标定不出来（横排的没认出来，或者 column 的被误判）'
        + ' —— 那「flex 读到 0」这个读数不作数');
    } else if (multi.length === 0) {
      ok(`⑩ B2 ${FORM_HERE.size} 种画法里 .contact-form__form 既没有 grid-template-columns、`
        + '也不是横排 flex（单栏）；两把尺各自标定过 ⟹ 上面那个「0」是真读数');
    } else {
      bad(`⑩ B2 这些画法把表单本身分栏了：${multi.map((l) => `${l}（${why[l]}）`).join(' · ')}`
        + ' —— 报错那条的 1/-1 从此作数，重新量它的几何');
    }
  }
}

// ══ ⑪ 那行细则小字不许排在表单和说明前面（#1135 r2）══════════════════════════════════════════════
//
// `panel-left` 上一版只给 form(1) / intro(2) 写了 `order`，而 `order` 缺省是 0 ⟹ 细则小字排在它们
// **前面**：左栏第一格是小字、表单被挤到右栏、lede 掉到第三行。命中 14/80 套。后果是主读跟
// `panel-right` 一样（表单都在右边），而这张票的立票原话正是「为什么这几块长得很一样」；手机上顺序
// 也变成 heading → note → form → intro。
//
// 🔴 判据不是 PM 留言里那句字面的「note 的 order 必须**大于** form 与 intro」—— 那条谓词会把
//    四个「谁都没写 order」的候选（三个 0）判红，而它们是对的：CSS 排布看的是 **(order, 源码里第几个)**
//    这个二元组，而 note 在 `ContactFormSection.tsx` 里本来就排在最后。所以这里判的是二元组：
//    note 的 (order, 源序) 必须比 form 和 intro 的都大。性质是 PM 定的那一条（小字不许排在前面），
//    这是能表达它的那个谓词。
// 🔴 源序**从那个组件的源码里现读**，不写死：写死等于把「note 在最后」这个前提藏进这份测试里，
//    而哪天有人在 TSX 里把 note 往上搬，`>=` 这一半就不再够 —— 现读之后那一格会自己红（下面
//    第二个阳性对照就是把它搬上去，四个全零候选当场被点名）。
console.log('\n⑪ #1135 那行细则小字，每一种画法下都排在表单和说明之后');
{
  const PARTS = ['heading', 'intro', 'form', 'note'];
  /** 每个部件在那个组件源码里排第几（`className="contact-form__X"` 出现的位置）。 */
  const sourceOrderOf = (src) => {
    const at = {};
    for (const p of PARTS) {
      const i = src.indexOf(`className="contact-form__${p}"`);
      if (i < 0) return null;
      at[p] = i;
    }
    return at;
  };
  /** 产物里那个部件写的 `order`（没写 = 0，跟浏览器的缺省一致）。 */
  const orderOf = (css, part) => {
    const m = css.match(new RegExp(`\\.contact-form__${part} \\{[^}]*\\}`));
    if (!m) return 0;
    const o = m[0].match(/(?:^|[;{]\s*)order:\s*(-?\d+)/);
    return o ? Number(o[1]) : 0;
  };
  /** 一次判决：返回被点名的画法清单。`css(i)` 与源序都从外面递进来，好让两个阳性对照换掉其中一个。 */
  const offenders = (cssOf, at) => {
    const out = [];
    for (const [look, i] of FORM_LOOK_SAMPLE) {
      const css = cssOf(i);
      const key = (p) => [orderOf(css, p), at[p]];
      const later = (a, b) => (a[0] !== b[0] ? a[0] > b[0] : a[1] > b[1]);
      const note = key('note');
      const bads = ['form', 'intro'].filter((p) => !later(note, key(p)));
      if (bads.length) {
        out.push(`${look}（第 ${i} 套）：note 的 (order,源序)=(${note.join(',')}) 没有排在 `
          + bads.map((p) => `${p} 的 (${key(p).join(',')})`).join(' 与 ') + ' 之后');
      }
    }
    return out;
  };

  const tsx = fs.readFileSync(CONTACT_TSX, 'utf-8');
  const at = sourceOrderOf(tsx);
  if (!at) die(`⑪ 立不起来：${CONTACT_TSX} 里找不到 ${PARTS.length} 个部件的 className`);

  // #1318 —— `order` 是几何，今天不在主题表里。语料换成配方那两半合起来的那份（= 搬迁前
  // `sheetFor(i)` 的字节，标定见 recipeSheetFor 上面）。
  const problems = offenders((i) => recipeSheetFor(i), at);
  if (problems.length === 0) {
    ok(`⑪ ${FORM_LOOK_SAMPLE.size} 种 form 画法逐种：细则小字排在表单和说明之后`
      + `（源序读自组件本身：${PARTS.map((p) => p).join(' < ')}）`);
  } else problems.forEach(bad);

  // 阳性对照 A：把 `panel-left` 那行 note 的 order 摘掉 ⟹ 必须点名 panel-left
  //
  // 🔴 #1339 —— 扰动下在**形态层**，不再是重新编译一份配方。那行 `order: 3` 以前住在
  //    `sheet-recipes.js` 的 `FORM_LOOKS['panel-left'].partExtra.note` 里；几何整族搬走之后它住在
  //    `public/shapes.css`。照旧改配方的话这一格会报「立不起来」（被摘的那行根本不在配方里了），
  //    而「立不起来」跟「这把尺瞎了」在输出里长得不一样，但都不是绿 —— 所以扰动必须跟着语料走。
  {
    const shapesSrc = fs.readFileSync(SHAPES_PATH, 'utf-8');
    const block = '[data-block="contact-form"][data-shape="panel-left"] .contact-form__note {\n  order: 3;\n}\n';
    const hits = shapesSrc.split(block).length - 1;
    if (hits !== 1) {
      bad(`⑪ 阳性对照 A 立不起来：public/shapes.css 里 panel-left 那条 note 的 order 规则出现 ${hits} 次（要求正好 1 次）`);
    } else {
      const rigged = shapesSrc.split(block).join('/* #1339 control: panel-left note order removed */\n');
      const named = offenders((i) => recipeSheetFor(i, rigged), at);
      if (named.some((x) => x.startsWith('panel-left'))) {
        ok(`⑪ 阳性对照 A：把形态层里 panel-left 那行 order 摘掉，这一格当场点名它（${named.length} 条）—— 上面那些绿是这行挣来的`);
      } else {
        bad(`⑪ 阳性对照 A 失败：摘掉之后没人被点名（${named.length} 条）—— 那这一格钉的不是这处修法`);
      }
    }
  }

  // 阳性对照 B：把 note 在**源码**里搬到 form 前面 ⟹ 那四个「谁都没写 order」的候选必须被点名
  {
    const noteLine = tsx.split('\n').find((l) => l.includes('className="contact-form__note"'));
    if (!noteLine) {
      bad('⑪ 阳性对照 B 立不起来：抠不出 note 那一行');
    } else {
      const moved = tsx.replace(`${noteLine}\n`, '').replace('      <h2 className="contact-form__heading"', `${noteLine}\n      <h2 className="contact-form__heading"`);
      const at2 = sourceOrderOf(moved);
      if (!at2) {
        bad('⑪ 阳性对照 B 立不起来：搬完之后四个部件读不齐');
      } else {
        const named = offenders((i) => recipeSheetFor(i), at2);
        // 🔴 #1134 —— 这里原来写 `>= 4`，而真值是 **5**（#1134 实测：`⑪ 阳性对照 B … 点名 5 种画法`）。
        //    松一格的代价不是抽象的：真值从 5 掉到 4 意味着**少了一种画法被点名**，也就是这把尺对那
        //    一种失明了 —— 而 `>=4` 会替它绿。改成等值判，并把「为什么是 5」写在旁边：
        //    6 种 form 画法里，`panel-left` 自己写了 order 3（所以搬源序也压不倒它），其余 5 种
        //    note 的 order 都是缺省 0 ⟹ 把 note 搬到源码最前面之后，那 5 种的二元组 (0, 最小源序)
        //    就比 form / intro 小，逐个被点名。
        // 值是现算的；括号里那个数只是今天的读数。
        const EXPECT_B = FORM_LOOK_SAMPLE.size - 1;      // 6 − 1（panel-left 自己写了 order）
        if (named.length === EXPECT_B) {
          ok(`⑪ 阳性对照 B：把 note 在源码里搬到最前面，这一格点名 ${named.length} 种画法（= ${EXPECT_B}，`
            + '除 panel-left 之外全部）—— 「源序现读」这一半也是活的（写死 note 在最后的话，这里读到 0 条）');
        } else {
          bad(`⑪ 阳性对照 B 失败：搬上去点名 ${named.length} 种，预期正好 ${EXPECT_B} 种`
            + '（只有 panel-left 自己写了 order，其余全该红）—— 多了或少了都说明这把尺的射程变了，'
            + '去看是画法数变了还是有人给别的画法也写了 order');
        }
      }
    }
  }
}


// ══ ⑫ 每个块在全池里有几副骨架（#1139 —— 族清单从 block-roles.json 全量枚举）════════════════════
//
// 形态（本票立票时量的）：#1135 收官时 35 个契约块里有 27 个在全池 80 套里**只有一副骨架** ——
// 换主题时那些段只变颜色和字体。而那件事**没有任何一格在看**：覆盖率那把尺只问「这个钩子有没有
// 规则」，相似度那道闸只读 tokens 和 layout（一个字节的 CSS 都不读），②那格只问「两份表整体是不是
// 双胞胎」（一份表里 35 个块只要有一个块不同，它就算不同）。
//
// 🔴 **族清单从 `block-roles.json` 全量枚举，不手抄。** ⑨ 那格原来手写了两行 `rows`，每加一族都得
//    有人记得回来补一行 —— 而漏掉那一族的样子跟通过一模一样（它就不在射程内，格子照样绿）。这一格
//    改成「先枚举全部 35 个块，再问每个块该有几副」，所以下一个加候选表的人不需要记得任何事。
//
// 🔴 判据不是「种数 ≥ 候选数」。那条在别的轴也能把种数顶上去的时候会漏（`content-split` 有 4 副
//    画法却读到 8 种，因为同页节奏那一维又乘了 2 ⟹ 就算它有两副画法画得一模一样，8 掉到 6 还是
//    ≥4）。这里问的是那个真正想要的性质：**两副不同的画法，不许画出同一副骨架** ——
//    按画法把 80 套分组，每组的骨架指纹集合必须两两不相交。
//
// 🔴 骨架指纹 = 只留决定几何的声明（display / 列数 / grid-column / grid-row / order / align-* /
//    justify-* / text-align / 宽高 / auto 外边距），颜色、字体、圆角、间距倍数全丢掉 —— 那正是
//    #1135 的立论（「字节不同不等于观感不同」）。**含 `@media (min-width: 1024px)` 那一段**，因为
//    AC1 那把尺是在 1440×900 的浏览器里量的，那时它生效；而列数只写在那一段里（基础规则永远是
//    `grid-template-columns: 1fr`）。📌 只读基础规则时这把尺对全池读到 27 个块只有一副 —— 与正文
//    那个 27 逐个对上，也就是说这两把尺是同一把，只差「桌面那一段算不算」。
// 🔴 #1174 —— 这三样（GEOM_PROPS / selectorOwnedBy / skeletonsOf）搬进了
//    `scripts/theme-pipeline/skeleton.js`，原样一个字没改。搬的理由写在那个文件头：#1174 要在
//    扩池之后问「有没有新增 hero 双胞胎」，那跟这一格问的是同一件事、必须用同一把尺。
//    判据是产物同一性：搬完这份测试仍然 59 过 0 失败，⑫ 那几行读数逐字不变。
const { selectorOwnedBy, skeletonsOf } = require('./skeleton.js');

// #1317 —— ⑫ 的样本量 = 位子表声明了几个位子（`industry-sectors.js` 的 poolSlots）。它**不是**
// `theme-pool.json` 今天有几套：这一格渲染的是生成器在每个位子上的产物，不读盘上的表。
const SAMPLE_N = require('./industry-sectors.js').poolSlots().length;

console.log(`\n⑫ #1139 每个块在 ${SAMPLE_N} 套候选里有几副骨架（族清单从 block-roles.json 全量枚举）`);
{
  // #1174 —— 80 → 97，理由只有一条：这一格的标题写着「全池」，而全池今天是 97 套。
  //
  // 🔴 **别把这个数当成一道判据 —— 我实测过它今天没有判别力。** 把它退回 80 之后：这份测试
  //    仍然 59 过 0 失败，连它自己打的那句读数都一字不变（N=80 与 N=97 都是「31 个块里 20 个
  //    只有一副骨架」）。原因是下面那张下限表问的是「种数 ≥ 常量」，而样本变多只会让种数持平
  //    或变大 ⟹ 缩小样本按构造红不了。
  //    ⟹ 这一处**不是** AC5 说的「改过判据的地方」，它是样本量（同 `generate.test.js:68` 那个 `N`，
  //    PM 判过不用改的那个）。上一版这里写的是「不改的话新增那 17 套的骨架按构造看不见，而看不见
  //    的样子是全过」—— 那句话把一处零判别力的改动说成了在堵一个洞，量出来是假的，所以删掉。
  // 🔴 #1317 —— 这里原来写死 97、标题写着「全池」。两样都跟着位子表走，不跟着 theme-pool.json 走：
  //    这一格**不读盘上的表**，它拿 `sheetFor(i, seed)` 现渲染 N 套候选，也就是问「生成器在 N 个
  //    位子上产出的骨架有几副」。位子表今天仍然是 97 个位子（#1317 只删了 theme-pool.json 里的
  //    主题，没动 industry-sectors.js 的位子表 —— 动它会让已建站的 id 和长相全变）。所以正确的数
  //    是位子数，而「全池」这个词在脚手架期是假的（全池 2 套），改成「候选」。
  //    📌 上面那段注释里那句「这个数今天没有判别力」仍然成立（把它退回 80 这份测试逐字不变）。
  const N = SAMPLE_N;
  const ROLES_PATH = path.join(DIR, '..', '..', 'src', 'lib', 'sections', 'block-roles.json');
  let BLOCKS; let BORROWERS; let REGIONS;
  try {
    // #1333 —— 借用别的块那套部件类名的块（manifest 的 `hooksFrom`）**不是自己一族骨架**，
    // 所以它不进这一格的分母。今天只有 `hero-with-form`（它渲染 `.hero__*` 那一家，理由写在
    // `HeroWithFormSection.tsx` 上）。🔴 名单从 manifest 现取，不写死：写死一份就等于下一个
    // 借用者出现时这一格 die 在一个其实正确的状态上，而 die 的样子跟真出问题一模一样。
    const manifests = require(path.join(DIR, '..', 'lib', 'block-manifest.js')).loadManifests();
    BORROWERS = [...manifests].filter(([, m]) => m.hooksFrom).map(([t]) => t);
    // #1353 —— **外壳区（`region: true`）不进这一格的分母。** 这一格问的是「配方给这一族画了几副
    // 骨架」，而顶栏 / 页脚今天**没有配方、也没有钩子**：契约 §1 的钩子表里一个 `header__*` /
    // `footer__*` 都没有，它们的间距和皮住在 `public/base.css` 的地板与 `public/shapes.css` 的那一节
    // （那里写了为什么不走主题表：要往契约加约 50 个钩子、每套表各写 50 条规则，而且**新开一维** ——
    // 主题从此能改顶栏长相，而 #1353 AC1 要的恰恰是逐像素不变）。
    // 🔴 这是下面那条自检消息里没列的**第三种可能**，所以在这里写成一个显式的分类，而不是把那条
    //    自检放宽：放宽的话「某个内容块真的漏了钩子」跟「外壳区按设计没有钩子」会长成同一个样子。
    //    判据用 manifest 自己声明的 `region: true`，不推断。
    REGIONS = [...manifests].filter(([, m]) => m.region === true).map(([t]) => t);
    BLOCKS = Object.keys(JSON.parse(fs.readFileSync(ROLES_PATH, 'utf8')))
      .filter((b) => !BORROWERS.includes(b) && !REGIONS.includes(b));
  } catch (e) {
    die(`⑫ 读不到 ${ROLES_PATH}：${e.message} —— 族清单的权威就是它，读不到就什么都没量成`);
  }
  // #1318 —— 骨架是几何，今天不在主题表里。这一格问的是**配方**（「这几张画法表真的画得不一样吗」），
  // 所以语料取配方那两半合起来的那份（= 搬迁前 `sheetFor(i)` 的字节，标定见 recipeSheetFor 上面）。
  // 🔴 别改成读 `public/shapes.css`：那份手维护的形态层里只有池子今天真用到的 50 个 (block, shape)
  //    对，而这一格的分母是「一族有几副画法」——照它去数，8 副 hero 画法会读成 2 副，下限判据跟着塌。
  const sheets = [];
  for (let i = 0; i < N; i += 1) {
    const css = recipeSheetFor(i);
    sheets.push({ i, css, v: voiceFor(i), fp: skeletonsOf(css, BLOCKS) });
  }

  // ── 分母自检 1：block-roles.json 的块 == SHAPES 认识的块 == 钩子清单里的块 ──────────────────
  //    少一个块这一格就对它按构造失明，而失明的样子是「全过」。
  {
    const hooked = new Set([...require(path.join(DIR, 'sheet-recipes.js')).hooksByBlock().keys()]);
    const onlyRoles = BLOCKS.filter((b) => !hooked.has(b));
    const onlyHooks = [...hooked].filter((b) => !BLOCKS.includes(b));
    if (onlyRoles.length || onlyHooks.length) {
      die(`⑫ 分母自检不成立：block-roles.json（去掉借用类名的 ${BORROWERS.length} 个）有 ${BLOCKS.length} 个块、`
        + `钩子清单有 ${hooked.size} 个，只在前者 [${onlyRoles.join(' ')}]，只在后者 [${onlyHooks.join(' ')}]`
        + '。🔴 一个块只在前者出现有三种可能：它真的没被钩子清单认领（那是本条要抓的洞）；'
        + '它借用别的块那套类名而 manifest 里忘了写 `hooksFrom`（那就去补那个键，别改这道自检）；'
        + '或者它是外壳区而 manifest 里忘了写 `region: true`（#1353 —— 主题按设计不画顶栏 / 页脚）');
    }
    ok(`⑫ 分母自检：block-roles.json 与钩子清单同为 ${BLOCKS.length} 个块，双向差集都空`
      + (BORROWERS.length ? `（另有 ${BORROWERS.length} 个借用别人类名、不自成一族：${BORROWERS.join(' ')}）` : ''));
  }

  // ── 分母自检 2：这把尺子把每一条规则都归给了某个块 ─────────────────────────────────────────
  //    归不掉的规则 = 这把尺读不到的地方，而它同样表现成「全过」。
  {
    const css = sheets[0].css;
    let total = 0;
    postcss.parse(css).walkRules(() => { total += 1; });
    let attributed = 0;
    postcss.parse(css).walkRules((rule) => {
      if (BLOCKS.some((b) => selectorOwnedBy(rule.selector, b))) attributed += 1;
    });
    if (attributed !== total) {
      die(`⑫ 分母自检不成立：第 0 套表里 ${total} 条规则，这把尺只认领了 ${attributed} 条 —— `
        + '剩下的那些它读不到');
    }
    ok(`⑫ 分母自检：第 0 套表 ${total} 条规则全部归到了某个块名下（没有读不到的规则）`);
  }

  // ── 每个块的骨架种数下限，写成常量（#1140，来源 #1139）─────────────────────────────────────────
  //
  // 🔴 这张表原来只有一条（`content-split: 8`），其余每个块的下限是**现算的** —— `Math.max(L, …)`
  //    里的 `L` 就是这一族候选表的条目数。那样写的话，**从候选表里删掉一副画法时 `L` 跟着掉、下限
  //    也跟着掉**：种数 4 → 3 是绿的。QA3 真改坏跑过：`faq-accordion` 删掉 `centered` ⟹ 54 过 0 失败
  //    全绿，那一格自己打的读数变成「3 副画法 → 3 种骨架（下限 3）」。一个「不许倒退」的下限如果由
  //    当前输入现算，它测的是自洽，不是回归。
  //
  // 🔴 所以下限改成**常量**：下面每个数都是 2026-08-22 在真产物上量到的今天的种数（那一轮 ⑫ 的读数
  //    逐字抄在这里）。真加了一副画法 ⟹ `L` 会超过它，`Math.max` 让下限跟着涨，不用改这张表；
  //    真删了一副 ⟹ 下限不动，这一格当场红。**只有蓄意降低多样性时才需要改这里的数,改的时候写下理由。**
  //
  //    `content-split` 的 8 = 4 副画法 × 同页节奏那条轴的 2 档（`splitRhythm`，#1090）—— 它是唯一一个
  //    今天就高于自己候选数的块，其余每个都恰好等于候选数。
  //
  // 🔴 #1162 删掉了三行（`values-grid` 4 · `benefits-list` 3 · `service-highlights` 4）。**这不是降低
  //    多样性**，是那三个 type 名整个退役了（并入 `card-group`，别名兼容层 2026-08-23 撤掉）：它们
  //    不在注册表、不在 `HOOKS`、也不在任何候选表族里了 ⟹ 留着这三行会让下面那道分母自检报「表里
  //    多出」并 exit 2。留下的每个块的下限**一个都没动**，`card-group` 仍然是 4。
  // 🔴 #1333 —— `hero` 从 8 改成 7，而这**不是**「蓄意降低多样性」那一类，所以按上面那句话写下理由：
  //    第 8 副骨架（`form-side`）没有消失，它**换了主人**。带表单的首屏拆成了自己一个块类型
  //    `hero-with-form`，那副几何整段搬进了 `public/shapes.css` 的
  //    `[data-block="hero-with-form"][data-shape="form-side"]`（规则正文一个字没改）。
  //    它不在这张表里，是因为这一格的分母只收「自己一族骨架」的块，而 `hero-with-form` 借用
  //    `.hero__*` 那套类名（manifest 的 `hooksFrom`）⟹ 上面那道分母自检把它排除掉了。
  //    ⟹ 两个块加起来仍然是 8 副，`hero` 自己名下是 7 副。判据可复算：
  //      grep -oE '\[data-block="hero(-with-form)?"\]\[data-shape="[a-z-]+"\]' public/shapes.css | sort -u
  //      → hero/media-cover · hero/text-center · hero-with-form/form-side
  const SHAPE_FLOOR = new Map([
    ['hero', 7], ['contact-info', 3], ['contact-form', 6], ['faq-accordion', 4],
    ['features-grid', 4], ['card-group', 4], ['testimonials', 4],
    ['cta-banner', 5], ['page-header', 4], ['process-steps', 4], ['content-split', 8],
  ]);
  // 🔴 分母自检：有候选表的块必须每个都在上面那张表里。漏一个，它的下限就悄悄退回「现算」，
  //    也就是本条要治的那个洞 —— 而漏掉的样子跟没漏一模一样。
  {
    const famBlocks = [...new Set(LOOK_FAMILIES.flatMap((f) => f.blocks))].sort();
    const missing = famBlocks.filter((b) => !SHAPE_FLOOR.has(b));
    const extra = [...SHAPE_FLOOR.keys()].filter((b) => !famBlocks.includes(b));
    if (missing.length || extra.length) {
      die(`⑫ SHAPE_FLOOR 跟候选表族对不上：表里缺 [${missing}] · 表里多出 [${extra}] —— `
        + '缺的那些下限会退回「按当前候选数现算」，那正是 #1139 要治的洞；'
        + '新加一族候选表时，把它今天在真产物上的种数写进 SHAPE_FLOOR。');
    }
    ok(`⑫ 分母自检：${famBlocks.length} 个有候选表的块每个都在 SHAPE_FLOOR 里（下限是常量，不随候选数缩水）`);
  }

  // ── 每个块该有几副：有候选表的 == 那张表的候选数；没有的 == cols 写死就 1 副、落到 v.wide 就 2 副
  const varietyOf = (b, opts = {}) => new Set(sheets.map((x) => (opts.baseOnly ? x.fp.base : x.fp.desktop).get(b))).size;
  // #1139 那批六个块。🔴 #1162：`benefits-list` 退役并入 `card-group`，所以这里换成后者 ——
  //    它今天在 `CARD_BLOCKS` 里、用 `CARD_SHAPES` 的四副，`SHAPE_FLOOR` 记的也是 4。
  const BATCH = ['page-header', 'faq-accordion', 'process-steps', 'card-group', 'contact-info', 'testimonials'];
  {
    const problems = [];
    const said = [];
    for (const b of BLOCKS) {
      const fam = LOOK_FAMILIES.find((f) => f.blocks.includes(b));
      const got = varietyOf(b);
      if (!fam) continue;                     // 没有候选表的块在下面那一格单独判
      const L = Object.keys(fam.table).length;
      // 按画法分组，每组的指纹集合
      const byLook = new Map();
      for (const x of sheets) {
        const look = x.v[fam.key];
        if (!byLook.has(look)) byLook.set(look, new Set());
        byLook.get(look).add(x.fp.desktop.get(b));
      }
      if (byLook.size !== L) {
        problems.push(`${b}：${L} 副画法里只有 ${byLook.size} 副在 80 套里真的轮到过`);
      }
      const looks = [...byLook.keys()];
      for (let a = 0; a < looks.length; a += 1) {
        for (let c = a + 1; c < looks.length; c += 1) {
          const shared = [...byLook.get(looks[a])].filter((s) => byLook.get(looks[c]).has(s));
          if (shared.length) {
            problems.push(`${b}：画法 ${looks[a]} 与 ${looks[c]} 画出了同一副骨架 —— `
              + '「字节不同」不等于「观感不同」，本票（承 #1135）要治的正是这个');
          }
        }
      }
      // ── AC3「已有块的种数不许倒退」──────────────────────────────────────────────────────────
      // 🔴 上面那条「两副画法不许画出同一副骨架」**不足以**代替这一条，这是我自己找出来的洞：
      //    一个块的骨架可以由**不止一条轴**决定 —— `content-split` 有 4 副画法却读到 8 种，因为
      //    同页节奏（`splitRhythm`）又乘了 2。假如哪天那条轴塌成一个值，种数 8 → 4，而四副画法
      //    仍然两两不同 ⟹ 上面那格照样绿。所以这里再钉一个**下限**。
      //    下限是 `SHAPE_FLOOR` 里那个**常量**（#1140 改的就是这里：原来是 `Math.max(L, extra)`，
      //    删掉一副画法时 `L` 一起掉、下限也跟着掉 ⟹ 倒退是绿的）。`Math.max` 留着，是为了让
      //    「真加了一副画法」自动把下限顶上去，不用回来改表。
      const floor = Math.max(L, SHAPE_FLOOR.get(b) || 0);
      if (got < floor) {
        problems.push(`${b}：只读到 ${got} 种骨架，下限是 ${floor}`
          + `（SHAPE_FLOOR 记的是 ${SHAPE_FLOOR.get(b)}，这一族今天有 ${L} 副画法）`);
      }
      said.push(`${b} ${L} 副画法 → ${got} 种骨架（下限 ${floor}）`);
    }
    if (problems.length) problems.forEach(bad);
    else ok(`⑫ ${LOOK_FAMILIES.length} 族逐族：两副不同的画法从不画出同一副骨架，且种数都在下限之上（${said.join(' · ')}）`);
  }

  // ── 没有候选表的块：种数由 `PLAIN_SHAPE_NAMES` 里那一项决定（写死一个名字 ⟹ 1 副；写成读
  //    `v.plainGrid` 的函数 ⟹ three-up / two-up 两副）。#1339 之前这条轴住在 `SHAPES` 的 `cols`
  //    里（列数），几何删干净之后它被抬到形态名这一层 —— 同一条轴，换了个不是几何的携带者。
  //    这一条把「27 个块只有一副骨架」那个基线钉成机器读数，而不是一句散文。
  {
    // 🔴 #1369 —— 这一格原来把「没有候选表的块」钉死成 **1 副或 2 副**（写死一个名字 / 落到
    //    `v.plainGrid` 那两副），第三种当场进 problems。blog-preview 这一批对表票给它加到 5 副之后
    //    那个写法就挡在正路上了。**改成更强的判据，不是更松的**：
    //      旧：种数 ∈ {1, 2}                                  —— 数字对不上就红，但 2 副时并不查
    //                                                            那两副是不是真画出两副不同的骨架
    //      新：种数 == 这个块的配方在整池里**能画出的形态个数**  —— 跟上面家族那一格同一条判据
    //    也就是说「配方说它有 N 副，就必须真读到 N 副不同的骨架」；两副撞成一副照样红，
    //    而块长到几副都不用回来改这里。
    const problems = [];
    const byCount = new Map();
    for (const b of BLOCKS) {
      if (LOOK_FAMILIES.some((f) => f.blocks.includes(b))) continue;
      const declared = new Set();
      for (let i = 0; i < N; i += 1) declared.add(recipeShapeFor(b, i));
      const got = varietyOf(b);
      if (got !== declared.size) {
        problems.push(`${b}：配方在整池里能画 ${declared.size} 副（${[...declared].join(' / ')}），`
          + `实际只读到 ${got} 种骨架 —— 有两副撞成同一副了`);
      }
      if (!byCount.has(got)) byCount.set(got, []);
      byCount.get(got).push(b);
    }
    if (problems.length) problems.forEach(bad);
    else {
      // 🔴 合并 #1364 时保留的那半句话：**3 副及以上要逐个报出是谁**（`trusted-brands` 的
      //    `row` / `heading-side` / `two-row` 就是第一个 3 副的块，形态名落到 `voiceFor` 的
      //    `brandWall` 按 i % 3 转）。#1364 那一版是「1 / 2 / 3 三档 + 其余进 problems」，
      //    而 blog-preview 在本票里是 **5 副** ⟹ 那个写法会把它判成「骨架是从哪儿来的？」。
      //    下面这一版把档位整个换成「配方说几副就要真读到几副」，三档是它的特例，
      //    ≥3 副照样逐个点名，所以 #1364 要的那条信息一个字没丢。
      const said = [...byCount.keys()].sort((x, y) => x - y)
        .map((k) => `${byCount.get(k).length} 个 ${k} 副${k >= 3 ? `（${byCount.get(k).join(' ')}）` : ''}`);
      ok(`⑫ 没有候选表的 ${[...byCount.values()].reduce((a2, v) => a2 + v.length, 0)} 个块，`
        + `配方说几副就真读到几副不同的骨架：${said.join(' · ')}`);
    }
  }

  // ── AC1 / AC3：本批六块各 ≥3 副 ────────────────────────────────────────────────────────────
  {
    const MIN = 3;
    const readings = BATCH.map((b) => `${b} ${varietyOf(b)}`);
    const short = BATCH.filter((b) => varietyOf(b) < MIN);
    if (short.length) short.forEach((b) => bad(`⑫ AC1/AC3：${b} 只有 ${varietyOf(b)} 副骨架，要求 ≥${MIN}`));
    else ok(`⑫ AC1/AC3：本批六块各 ≥${MIN} 副骨架（${readings.join(' · ')}）`);
    // 顺带把「只读基础规则」那把尺的读数也打出来 —— 它是正文那个 27 的口径
    const baseOnes = BLOCKS.filter((b) => varietyOf(b, { baseOnly: true }) === 1);
    ok(`⑫ 换成「只读基础规则」那把尺：全池只有一副骨架的块从立票时的 27 个降到 ${baseOnes.length} 个`
      + `（本批六块的基础规则种数 ${BATCH.map((b) => `${b} ${varietyOf(b, { baseOnly: true })}`).join(' · ')}）`);
  }

  // ── 阳性对照 A：同一副画法的那些套之间，指纹必须一致 —— 否则这把尺在读噪音 ────────────────────
  {
    const noisy = [];
    for (const fam of LOOK_FAMILIES) {
      for (const b of fam.blocks) {
        const byLook = new Map();
        for (const x of sheets) {
          const look = x.v[fam.key];
          if (!byLook.has(look)) byLook.set(look, new Set());
          byLook.get(look).add(x.fp.desktop.get(b));
        }
        for (const [look, set] of byLook) {
          // content-split 例外：同页节奏（alternate / uniform）是**另一条轴**，它真的改几何
          if (set.size > 1 && b !== 'content-split') noisy.push(`${b}/${look} 读到 ${set.size} 种`);
        }
      }
    }
    if (noisy.length) noisy.slice(0, 6).forEach((m) => bad(`⑫ 阳性对照 A 失败：${m} —— 同一副画法内部指纹不该变，这把尺在读噪音`));
    else ok('⑫ 阳性对照 A：同一副画法的那些套之间指纹逐字相同（content-split 除外，它另有同页节奏那条轴）—— 这把尺读的不是间距/颜色的噪音');
  }

  // ── 阳性对照 B：把某个块的候选砍回 1 种（在**产物**上做，不在生产代码里留测试专用的路），必须红
  //    做法：把每一套表里那个块的规则，换成「第一副画法」那套表里同一个块的规则。
  {
    const target = 'page-header';
    const fam = LOOK_FAMILIES.find((f) => f.blocks.includes(target));
    const firstLook = Object.keys(fam.table)[0];
    const donor = sheets.find((x) => x.v[fam.key] === firstLook);
    if (!donor) die(`⑫ 阳性对照 B 立不起来：80 套里没有一套用 ${target} 的 ${firstLook}`);
    const donorRules = [];
    postcss.parse(donor.css).walkRules((rule) => {
      if (selectorOwnedBy(rule.selector, target) && !(rule.parent && rule.parent.type === 'atrule')) {
        donorRules.push(rule.toString());
      }
    });
    if (!donorRules.length) die(`⑫ 阳性对照 B 立不起来：抠不出 ${target} 的规则`);
    const collapse = (css) => {
      const root = postcss.parse(css);
      root.walkRules((rule) => { if (selectorOwnedBy(rule.selector, target)) rule.remove(); });
      root.walkAtRules('media', (at) => { if (at.nodes.length === 0) at.remove(); });
      return `${root.toString()}\n${donorRules.join('\n')}\n`;
    };
    const rigged = sheets.map((x) => collapse(x.css));
    const riggedVariety = new Set(rigged.map((c) => skeletonsOf(c, BLOCKS).desktop.get(target))).size;
    if (riggedVariety === 1) {
      ok(`⑫ 阳性对照 B：把 ${target} 在 80 份产物里的规则统一换成「${firstLook}」那一副，`
        + `这把尺当场读到 1 种骨架（真产物上是 ${varietyOf(target)} 种）—— 它不是恒 ≥3`);
    } else {
      bad(`⑫ 阳性对照 B 失败：统一成一副之后还读到 ${riggedVariety} 种 —— 这把尺量的不是骨架`);
    }
  }

  // ── 阳性对照 C：那条【下限】自己有没有牙 ──────────────────────────────────────────────────────
  //
  // 🔴 B 那一格把一个块塌成一副，两条判据（画法两两不同 / 种数在下限之上）会**同时**开火，所以它
  //    证不了下限那一条单独也管事。C 专证它：`content-split` 的 8 种来自「4 副画法 × 同页节奏 2 档」
  //    —— 把**节奏那条轴**塌掉（每套的规则换成同画法组里第一套的），四副画法仍然两两不同，
  //    只有种数从 8 掉到 4。那时上面那条 disjoint 判据照样绿，而下限必须红。
  {
    const target = 'content-split';
    const fam = LOOK_FAMILIES.find((f) => f.blocks.includes(target));
    const grab = (css) => {
      const keep = [];
      postcss.parse(css).walkRules((rule) => {
        if (!selectorOwnedBy(rule.selector, target)) return;
        const inMedia = rule.parent && rule.parent.type === 'atrule';
        keep.push(inMedia
          ? `@${rule.parent.name} ${rule.parent.params} { ${rule.toString()} }`
          : rule.toString());
      });
      return keep;
    };
    const donorByLook = new Map();
    for (const x of sheets) if (!donorByLook.has(x.v[fam.key])) donorByLook.set(x.v[fam.key], grab(x.css));
    const flattenRhythm = (x) => {
      const root = postcss.parse(x.css);
      root.walkRules((rule) => { if (selectorOwnedBy(rule.selector, target)) rule.remove(); });
      root.walkAtRules('media', (at) => { if (at.nodes.length === 0) at.remove(); });
      return `${root.toString()}\n${donorByLook.get(x.v[fam.key]).join('\n')}\n`;
    };
    const riggedFps = sheets.map((x) => skeletonsOf(flattenRhythm(x), BLOCKS).desktop.get(target));
    const riggedVariety = new Set(riggedFps).size;
    // 那条 disjoint 判据在这份被改过的产物上还绿吗（它必须绿，否则 C 证的不是下限）
    const byLook = new Map();
    sheets.forEach((x, k) => {
      const look = x.v[fam.key];
      if (!byLook.has(look)) byLook.set(look, new Set());
      byLook.get(look).add(riggedFps[k]);
    });
    const looks = [...byLook.keys()];
    let stillDisjoint = true;
    for (let a = 0; a < looks.length; a += 1) {
      for (let c = a + 1; c < looks.length; c += 1) {
        if ([...byLook.get(looks[a])].some((f) => byLook.get(looks[c]).has(f))) stillDisjoint = false;
      }
    }
    const L = Object.keys(fam.table).length;
    const floor = Math.max(L, SHAPE_FLOOR.get(target) || 0);
    if (riggedVariety < floor && stillDisjoint) {
      ok(`⑫ 阳性对照 C：把 ${target} 的同页节奏那条轴塌掉 ⟹ 种数 ${varietyOf(target)} → ${riggedVariety}`
        + `，低于下限 ${floor} 会被点名，而「${L} 副画法两两不同」那一条**照样绿** —— 所以下限那一条`
        + '不是多余的，它管的是另一种倒退');
    } else if (!stillDisjoint) {
      bad(`⑫ 阳性对照 C 立不起来：塌掉节奏之后 ${target} 的画法之间也撞了 —— 这一格分不出是哪条判据在说话`);
    } else {
      bad(`⑫ 阳性对照 C 失败：塌掉节奏之后还读到 ${riggedVariety} 种（下限 ${floor}）—— 下限那一条量不出这种倒退`);
    }
  }
}


// ══ ⑬ 首屏表单那行报错，拿到的是跟它两个姊妹同一个盒子（#1150）════════════════════════════════
//
// 🔴 为什么这一格必须存在：`.hero__form-error` 拿到边框，靠的是 `SHAPES.hero.role` 里的一个字符串
//    （`'form-error': 'error'`）。**把那一行删掉不会让任何东西红** —— `sheetFor` 对认不出角色的
//    部件走 `ROLES.desc` 保底（sheet-recipes.js 里那句「不是跳过，是拿一份保底样式」），于是表里
//    照样有 `.hero__form-error` 这条规则，只是它变成一段普通段落、没有框。而本票要治的病正是
//    「提交失败时联系表单和报价表单弹一个框、首屏这里是裸文字」⟹ 静态那三道闸
//    （`css-contract-check.js` / `theme-pipeline/hook-coverage.js` / `theme-css-lint.js`）问的都是
//    「这个钩子有没有规则」，对这种退步按构造是绿的。下面的阳性对照就是拿真的 `desc` 规则喂进去。
//
// 判据是**盒子**逐项相同，不是整条规则相同，两个不比的项各有理由：
//   · `color` —— 它跟着每个块自己的表面走。实测 80 套池成员：`.hero__form-error` 与
//     `.contact-form__error` 同色 80/80，与 `.quote-form__error` 只有 27/80（quote-form 那个块
//     坐在另一个表面上）。要求同色等于要求两个块共用一个表面，那是另一件事。
//   · `grid-column` —— 那是 `contact-form` 块自己的 `partExtra`（理由写在 ⑩ 上面那段）。
console.log('\n⑬ #1150 首屏表单那行报错，跟联系/报价那两行拿到同一个盒子');
{
  const BOX = ['padding', 'border-radius', 'border-width', 'border-style', 'border-color', 'font-size', 'line-height'];
  /** 一份表里那条顶层规则的**盒子**（只取 BOX 里那几项，排序后拼成一行）。 */
  const boxOf = (css, sel) => {
    let hit = null;
    postcss.parse(css).walkRules((rule) => {
      if (rule.selector !== sel) return;
      if (rule.parent && rule.parent.type === 'atrule') return;   // @media 里那份是另一档
      hit = rule;
    });
    if (!hit) return null;
    return hit.nodes.filter((n) => n.type === 'decl' && BOX.includes(n.prop))
      .map((d) => `${d.prop}: ${d.value}`).sort().join('; ');
  };
  const PARTS = ['.hero__form-error', '.contact-form__error', '.quote-form__error'];
  const sheets = new Map(TRIO.map((i) => [heroLookFor(i), sheetFor(i)]));

  const problemsIn = (css, look) => {
    const out = [];
    const boxes = PARTS.map((p) => [p, boxOf(css, p)]);
    const missing = boxes.filter(([, b]) => b === null).map(([p]) => p);
    if (missing.length) { out.push(`画法 ${look}：表里没有 ${missing.join(' / ')} 这条顶层规则`); return out; }
    if (boxes[0][1] === '') {
      out.push(`画法 ${look}：.hero__form-error 一条盒子属性都没写 —— 那就是 ROLES.desc 保底的样子，`
        + '首屏那行报错会是裸文字（本票要治的就是它）');
      return out;
    }
    for (const [p, b] of boxes.slice(1)) {
      if (b !== boxes[0][1]) {
        out.push(`画法 ${look}：.hero__form-error 的盒子跟 ${p} 不一样\n`
          + `      hero: ${boxes[0][1]}\n      ${p.padEnd(4)}: ${b}`);
      }
    }
    return out;
  };

  const problems = [...sheets].flatMap(([look, css]) => problemsIn(css, look));
  if (problems.length) problems.forEach(bad);
  else {
    const one = boxOf(sheets.get(HERO_LOOK_NAMES[0]), '.hero__form-error');
    ok(`${sheets.size} 种画法逐种：三行报错的盒子逐项相同（${HERO_LOOK_NAMES[0]} 那一份是 ${one}）`);
  }

  // 🔴 阳性对照：把 `.hero__form-error` 的声明换成**同一份表里真的那条 `desc` 规则**
  //    （`.card-group__desc` 走的就是 `ROLES.desc`：`SHAPES['card-group'].role.desc === 'desc'`）——
  //    这正是删掉 `SHAPES.hero.role` 那一行之后生成器会写出来的东西。这把尺必须只点名被动过的那一种画法。
  //    📌 #1162：这里原来取 `.values-grid__desc`。那个 type 名随别名兼容层退役、不再被生成，
  //    于是这一格的阳性对照拿不到样本、自己报「立不起来」（它这句自保是对的：读数不作数，不是绿）。
  //    换成 `.card-group__desc` —— 同一个角色（`ROLES.desc`），而且是现役块。
  {
    const target = HERO_LOOK_NAMES[0];
    const css = sheets.get(target);
    const descBody = (() => {
      let hit = null;
      postcss.parse(css).walkRules((r) => { if (r.selector === '.card-group__desc' && !(r.parent && r.parent.type === 'atrule')) hit = r; });
      return hit ? hit.nodes.filter((n) => n.type === 'decl').map((d) => `  ${d.prop}: ${d.value};`).join('\n') : null;
    })();
    if (!descBody) {
      bad('⑬ 阳性对照立不起来：这份表里没有 .card-group__desc（拿不到真的 ROLES.desc 长什么样）');
    } else {
      const rigged = css.replace(/^\.hero__form-error \{[^}]*\}/m, `.hero__form-error {\n${descBody}\n}`);
      if (rigged === css) {
        bad('⑬ 阳性对照立不起来：没能在产物里替换掉 .hero__form-error 那条规则');
      } else {
        const caught = problemsIn(rigged, target);
        if (caught.length && caught.every((m) => m.includes(`画法 ${target}`))) {
          ok(`⑬ 阳性对照：把 ${target} 的 .hero__form-error 换成同一份表里真的那条 ROLES.desc 规则`
            + `（删掉 SHAPES.hero.role 那一行之后生成器写出来的就是它）⟹ 这把尺当场点名它`
            + `（${caught[0].split('\n')[0].slice(0, 70)}…）`);
        } else if (caught.length) {
          bad(`⑬ 阳性对照对不上：点名的不止 ${target} —— ${caught.join(' | ')}`);
        } else {
          bad('⑬ 阳性对照失败：把首屏那行报错换成一段普通段落之后，这把尺一句话都没说 ⟹ 它是装饰');
        }
      }
    }
  }
}

// ══ ⑭ #1158 首屏那句「已收到」站在表单原来那个格子里 ═══════════════════════════════════════════
//
// 🔴 为什么这一格必须存在：`.hero__form-success` 是 `.hero` 这个 grid 的**直接子节点**（`HeroLeadForm`
//    成功那一支返回的 `<p>` 替掉了 `<form>`），而「那个格子在哪」是**每种 hero 画法各自决定**的 ——
//    `heroFormAfterBody` 给 order 4 并跨满，`form-side` 给 order 3、不跨满。#1158 第一版在块这一层
//    写死了 `order: 4`，实测 `.hero__form` 的 order 分布是 **4→62 · 3→11 · 没写→10**，即不等于 4 的
//    共 **21 张 / 83**（只看生成的那 80 张是 20/80；#1158 r1 这里写的「83 张里 20 张」是拿 80 的分子
//    配了 83 的分母，QA1 r1 的 N3 点的就是这处）⟹ 那 21 张上
//    「已收到」会跳到跟表单不同的位置（比如掉到 CTA 底下）。现在它由 `heroSuccessFrom` 从同一种画法
//    自己那份 `form` 派生 —— 这一格盯的就是那条派生没断。
// 🔴 这不是「盒子长得像不像」（⑬ 在管那个），是**位置**里的这几维：order / grid-column / 宽度 / 居中
//    （🔴 不含 grid-row，理由紧跟在下面 PLACE 那里）。#1135 在
//    `contact-form` 上量过这一维的代价：一条「已经收到了」的话被自动流塞进侧栏，只占 45% 宽。
{
  // 🔴 这把尺比的是**下面这 6 个键**，`grid-row` **不在里面** —— 所以这一格说的「相同」是
  //    「这 6 个键相同」，不是「位置的每一维都相同」（#1158 r3，QA2 抓的）。把 `grid-row` 算进去
  //    是 **73 相同 / 10 不同**，那 10 张全是 `media-cover` 画法（表单 `grid-row: 3`、「已收到」没有），
  //    而 `sheet-recipes.js` 里那种画法自己的注释逐字写着「这一种的位置由 `grid-row` 说了算，不是 `order`」。
  //    真机后果小（有装饰件时两者都落第 3 行、top 一样；去掉装饰件差 15px，QA2 在 amber-33 上量的），
  //    所以**这一轮不把它加进来** —— 加它要动 `HERO_SUCCESS_PLACEMENT` 并重生 83 张表，那是行为改动，
  //    已按 AC3 登进第 24 批台账。这里只把话说准，不让这一格宣称它没量过的东西。
  const PLACE = ['order', 'grid-column', 'max-width', 'width', 'margin-left', 'margin-right'];
  const placeOf = (css, sel) => {
    let hit = null;
    postcss.parse(css).walkRules((rule) => {
      if (rule.selector !== sel) return;
      if (rule.parent && rule.parent.type === 'atrule') return;   // @media 里那份是另一档
      hit = rule;
    });
    if (!hit) return null;
    return hit.nodes.filter((n) => n.type === 'decl' && PLACE.includes(n.prop))
      .map((d) => `${d.prop}: ${d.value}`).sort().join('; ');
  };
  console.log('\n⑭ #1158 首屏那句「已收到」跟表单同一个格子');
  // #1318 —— 语料换成配方那两半合起来的那份，再加上池子里每一套主题真正拿到的那份（理由整段在
  // `effectiveSheetFor` 上面）。这一格问的六个放置键里有 `order` / `grid-column` / `max-width`
  // 三个是**几何**，契约 v3 之后它们不在主题表里了 ⟹ 照旧只读 `sheetFor(i)` 的话，
  // 「已收到」和表单会**两边都读到空字符串**，`f !== s` 恒假、这一格恒绿。
  // 🔴 那正是 QA2 在 #1318 r1 上量到的状态（8 种画法里 5 种两边都空、**没有一种还带 order**），
  //    而这一格自己的阳性对照**照样开火** —— 它证的是「这把尺读得懂 order」，不是「语料里有 order」。
  //    所以下面多了一道**分母自检**：语料里带 order 的条目为 0 就当场 die，不许再绿一次。
  // 🔴 #1339 —— 域从 9 项变成 3 项，理由跟 ⑥ 那一格逐字相同（那里写全了）：表单和「已收到」都是
  //    `hero-with-form` 这个**块**的部件，#1333 之后 `hero` 自己不渲染它们；形态层里
  //    `.hero__form` / `.hero__form-success` 的规则只挂在 `hero-with-form/form-side` 底下，
  //    而那个块只有**一副**形态。#1339 之前这一格从配方侧读到 7 项，读的是 7 副 hero 画法各自
  //    那份**没有任何 DOM 会用到**的表单位置 —— 本票删的正是它。
  //    `only` / `as` 两个参数是因为这个块借用 `.hero__*` 那套类名（manifest 的 `hooksFrom`）。
  const FORM_BLOCK = 'hero-with-form';
  const looks = new Map([[`form-side（配方侧，候选 0）`,
    { i: 0, css: recipeSheetFor(0, undefined, { only: FORM_BLOCK, as: 'hero' }) }]]);
  for (const id of POOL_IDS) {
    const shape = (POOL[id].shapes || {})[FORM_BLOCK];
    if (!shape) die(`⑭ 池里 ${id} 的选择单没有 ${FORM_BLOCK} —— 这一格问不出「它的已收到排在哪」`);
    looks.set(`${shape} @ 站 ${id}`, { i: `站 ${id}`, css: effectiveSheetFor(id, { only: FORM_BLOCK, as: 'hero' }) });
  }
  // 分母自检：这一格问的是「两个部件的放置键一不一样」，而语料里一个 `order` 都没有时，
  // 「逐字相同」说的只是「两边都没有位置」。基线（#1318 之前）这个数是 7/8。
  {
    const withOrder = [...looks.values()].filter(({ css }) => {
      const p = placeOf(css, '.hero__form');
      return typeof p === 'string' && p.includes('order');
    }).length;
    // 🔴 #1339 —— 判据从「至少有一条带 order」收紧成「**每一条**都带」。理由是量出来的，不是口味：
    //    本票把域从 9 项收成 3 项（1 项配方侧 + 2 套站），而站那两臂读的是 `public/shapes.css`，
    //    **配方那一臂怎么坏都不影响它们**。拿旧判据（≥1）跑「只读皮」那条反向臂，实测读到 2/3、
    //    整格照旧全绿 —— 也就是配方那一臂已经瞎了而这一格不说话，正是这条自检本来要拦的那件事。
    //    收紧之后同一条反向臂当场 die。
    if (withOrder !== looks.size) {
      die(`⑭ 的语料里 ${looks.size} 条只有 ${withOrder} 条的 .hero__form 带 order —— 缺的那几条上`
        + '「两边逐字相同」说的是「两边都没有位置」，那是空绿，不许当成过');
    }
    ok(`⑭ 分母自检：${looks.size} 条语料**每一条**的 .hero__form 都带着 order`
      + '（少一条就是那一臂瞎了，这一格会 die 而不是绿）');
  }
  const wrong = [];
  for (const [look, { i, css }] of looks) {
    const f = placeOf(css, '.hero__form');
    const s = placeOf(css, '.hero__form-success');
    if (s === null) { wrong.push(`画法 ${look}（i=${i}）：产物里没有 .hero__form-success 这条规则`); continue; }
    if (f !== s) wrong.push(`画法 ${look}（i=${i}）：表单在「${f}」而「已收到」在「${s}」`);
  }
  if (!wrong.length) {
    ok(`${looks.size} 项逐项：「已收到」与表单的这 ${PLACE.length} 个放置键逐字相同`
      + `（不含 grid-row —— 见上面那段注释与第 24 批台账）（${[...looks.keys()][0]} 那一份是 ${
      placeOf([...looks.values()][0].css, '.hero__form-success')}）`);
  } else {
    wrong.forEach((w) => bad(`⑭ ${w}`));
  }
  // 🔴 阳性对照：把派生那一步换成 #1158 第一版那个写死的 `order: 4`，这把尺必须当场点名那些 order≠4 的画法。
  //    没有它，一个「两边都读不出位置」的实现也能让上面那格绿。
  const rigLook = [...looks.keys()].find((k) => {
    const p = placeOf(looks.get(k).css, '.hero__form');
    return p !== null && !p.includes('order: 4');
  });
  if (!rigLook) {
    bad('⑭ 阳性对照立不起来：83 张里找不到一种 .hero__form 的 order 不是 4 的画法 —— 那这一格证明不了派生在干活');
  } else {
    const { css } = looks.get(rigLook);
    // 🔴 两种形态都要能改：那条规则里**有** order（替掉它）和**没有** order（插一条）。
    //    第一版只写了替换，而挑出来的 media-cover 的 `.hero__form` 根本没写 order ⟹ 它的
    //    `.hero__form-success` 也没有 ⟹ 替换找不到目标、什么都没改，这一步当场说自己立不起来。
    //    这正是它该做的事（没改动就不许当成"改了也没变"），修的是这一步本身。
    const rigged = /\.hero__form-success \{[^}]*?\border:\s*[^;]+;/.test(css)
      ? css.replace(/(\.hero__form-success \{[^}]*?)\border:\s*[^;]+;/, '$1order: 4;')
      : css.replace(/(\.hero__form-success \{\n)/, '$1  order: 4;\n');
    if (rigged === css) {
      bad(`⑭ 阳性对照立不起来：没能在 ${rigLook} 的产物里把 .hero__form-success 的 order 改掉`);
    } else {
      const f = placeOf(rigged, '.hero__form');
      const s = placeOf(rigged, '.hero__form-success');
      if (f !== s) {
        ok(`⑭ 阳性对照：把 ${rigLook} 的「已收到」写死成 order: 4（#1158 第一版就是这样）⟹ 这把尺当场读出`
          + `两边不同（表单「${f}」vs「已收到」「${s}」）`);
      } else {
        bad(`⑭ 阳性对照失败：${rigLook} 的 order 被改成 4 之后这把尺还说两边一样 ⟹ 它没在读 order`);
      }
    }
  }
}

// ── ⑮ #1190 实验钉那一格已随实验钉本身于 #1339 删掉 ──────────────────────────────────────────────
//
// 它守的是「恰好一套候选画出滑条，其余逐字节不动」，而 #1339 把那个实验钉整条删了（理由是机制性的：
// 形态层按 `[data-block][data-shape]` 点名、`data-shape` 来自站点内容，而实验钉要表达的是「池子里
// 这一套表这么画」，跟主题走 —— 形态层没有地方放它；而且它从 #1318 起就只剩 `overflow-x` 那一半，
// 写在 `display: contents` 的元素上什么都不会发生）。
//
// 🔴 **没有继承者，这是有意的。** 删它之前这一格本来就整格跳过（被钉的 `lime-28` 随 #1161 下架，
//    盘上只剩 2 份生成表），所以删掉不会让任何东西变红 —— 那是预期，不是「没验」。
// 📌 想把横条要回来：让它成为 testimonials 的一副**真形态**（`public/shapes.css` 写规则 +
//    `blocks/testimonials.json` 的 `shapes` 登记名字），那时这一格的继承者是形态层自己那几道
//    （`gates-shapes.test.js` 的选择单一致性 + 下面 ⑫ 的骨架种数），不用再为它单开一格。

console.log('\n⑮ #1339 配方里还有没有几何（整池扫一遍，命中集合必须为空）');
{
  // ══ 这一格是本票的主判据 ══════════════════════════════════════════════════════════════════════
  // 采集点是 `declBlock`（`sheet-recipes.js` 导出的 `scanGeometry` 打开收集模式），**不是**遍历
  // 角色表和 `rootExtra`：那两样都是**函数**，直接 `Object.keys` 读到 0；而本票删掉之前，同页节奏
  // 那条（`siblingRules`）和实验钉根本不住在「角色表 / rootExtra / partExtra」里 —— 按那三样扫是
  // 空的、几何却还在配方里。（PM 复核本票时踩过那把坏尺，写在票上。）
  //
  // 🔴 这把尺自己的盲区：它只看得见走 `declBlock` 的声明。有人把一条规则拼成字符串直接 push 进
  //    `out`，这把尺读到空而几何上了表。挡那一种的是**另一条判据** —— 生成出来的表逐份跑
  //    `theme-css-lint.js`（`generate.js --count 28` 那一步，读的是产出的字节）。两条一起才盖满。
  const N = 97;
  const hits = [];
  for (let i = 0; i < N; i += 1) {
    for (const h of scanGeometry(() => sheetFor(i))) hits.push({ ...h, i });
  }
  if (hits.length === 0) {
    ok(`⑮ 整池 ${N} 套候选，declBlock 采到的几何声明 0 条 —— 配方里没有几何了`);
  } else {
    const by = new Map();
    for (const h of hits) {
      const k = `${h.where} → ${h.selector} 的 ${h.prop}`;
      by.set(k, (by.get(k) || 0) + 1);
    }
    bad(`⑮ 配方里还有 ${hits.length} 条几何（${by.size} 种）：`
      + [...by].slice(0, 8).map(([k, n]) => `${n}× ${k}`).join(' · ')
      + (by.size > 8 ? ` …（还有 ${by.size - 8} 种）` : ''));
  }

  // 🔴 反向臂：**还活着的每一个 `declBlock` 调用点各一臂**。断言虽然只有一处，但「那一处收不收得到
  //    某个调用点的声明」是**三件独立的事** —— 只打角色那一臂时，`rootExtra` 和桌面段是不是也被盖到，
  //    这一臂说不出话。
  //    📌 本票之前有**四个**调用点，第四个是同页节奏（`siblingRules`）—— 它随几何一起删掉了，
  //       所以这里是三臂不是四臂（`sheet-recipes.js` 的 `buildSheet` 里写着它去哪儿了）。
  {
    const Module = require('module');
    const target = path.join(DIR, 'sheet-recipes.js');
    const src = fs.readFileSync(target, 'utf-8');
    const ARMS = [
      ['块根（rootRule / rootExtra）', "    gap: v.gap,\n    padding: `${v.pad} 1.5rem`,",
        "    gap: v.gap,\n    display: 'grid',\n    padding: `${v.pad} 1.5rem`,"],
      ['桌面段（wideRule）', "  const decls = {};", "  const decls = { order: 1 };"],
      ['部件（ROLES + partExtra）', "  desc: (v, s) => ({\n", "  desc: (v, s) => ({\n    order: 1,\n"],
    ];
    for (const [what, needle, replacement] of ARMS) {
      const n = src.split(needle).length - 1;
      if (n !== 1) { bad(`⑮ 反向臂「${what}」立不起来：锚点在 sheet-recipes.js 里出现 ${n} 次（要求正好 1 次）`); continue; }
      const m = new Module(target, module);
      m.filename = target;
      m.paths = Module._nodeModulePaths(path.dirname(target));
      m._compile(src.split(needle).join(replacement), target);
      let threw = null;
      try { m.exports.sheetFor(0); } catch (e) { threw = e.message; }
      const seen = m.exports.scanGeometry(() => { try { m.exports.sheetFor(0); } catch (e) { /* 收集模式不抛 */ } });
      if (threw && seen.length) {
        ok(`⑮ 反向臂「${what}」：往这个调用点写回一条几何 ⟹ 当场抛并点名（${threw.split('\n')[0].slice(0, 90)}…）`);
      } else {
        bad(`⑮ 反向臂「${what}」失败：写回一条几何之后没抛（threw=${threw ? 'yes' : 'no'} · 采到 ${seen.length} 条）`
          + ' —— 那这道断言收不到这个调用点的声明');
      }
    }
  }

  // 🔴 分母自检：配方自己画的那一副（`recipeShapesFor`）与形态层**双向差集都空**。
  //    它是上面 ④ ⑥ ⑩ ⑪ ⑫ ⑭ 六格新语料的地基：配方画的那一副在形态层里没有 ⟹ 那几格的语料
  //    里少一块几何，而少了的样子是「这个画法没排位置」；反过来形态层里有、97 套一次都没画到 ⟹
  //    那副画法**没有任何一格在看它**。
  {
    const shapesCss = fs.readFileSync(SHAPES_PATH, 'utf-8');
    const have = new Set([...shapesCss.matchAll(/\[data-block="([a-z0-9-]+)"\]\[data-shape="([a-z0-9-]+)"\]/g)]
      .map((x) => `${x[1]}/${x[2]}`));
    const used = new Set();
    for (let i = 0; i < N; i += 1) {
      const sel = { ...recipeShapesFor(i), 'hero-with-form': recipeShapeFor('hero-with-form', i) };
      for (const [b, sh] of Object.entries(sel)) used.add(`${b}/${sh}`);
    }
    // #1353 —— **外壳区的那 7 对不在这一格的射程里。** 这一格问的是「配方画的那一副」，而顶栏 /
    // 页脚**没有配方**（主题不画它们，理由在 ⑫ 分母自检那段和 `public/shapes.css` 那条明写例外里），
    // 它们的几何整份住在形态层、由 `base.css` 的地板托底。不滤掉的话这一格会永远红在
    // 「形态层有而一次都没被选中」，而那句话对它们按构造为真、永远修不好。
    // 🔴 只滤 `orphan` 那一半，`missing` 一个字没动：配方要是**画了**一个形态层里没有的 (块, 形态)，
    //    照旧红 —— 那才是这一格要抓的洞。
    const REGION_PAIRS = (() => {
      const ms = require(path.join(DIR, '..', 'lib', 'block-manifest.js')).loadManifests();
      const out = new Set();
      for (const [t, m] of ms) {
        if (m.region !== true) continue;
        for (const sh of m.shapes) out.add(`${t}/${sh.name}`);
      }
      return out;
    })();
    const missing = [...used].filter((k) => !have.has(k));
    // 🔴 **两张票在这一行相遇了，两边的意思都留着（#1360 r3 解冲突）：**
    //   · #1353 的 `REGION_PAIRS`：外壳区那几对**根本不进这一格**（主题不画顶栏页脚）——
    //     留着它，下面那句读数才不会把它们混进来。
    //   · #1360 的改判：反方向（形态层有、候选一次都没画到）**报告而不判**，理由整段在下面。
    const orphan = [...have].filter((k) => !used.has(k) && !REGION_PAIRS.has(k));
    if (missing.length === 0) {
      ok(`⑮ 配方画的那一副 vs 形态层：配方挑得出的每一副在形态层里都有规则（${N} 套候选用到 `
        + `${used.size} 个 (块, 形态) 对，0 个在 public/shapes.css 里查不到）`
        + `（另有 ${REGION_PAIRS.size} 对属于外壳区，主题不画它们、不进这一格 —— #1353）`);
    } else {
      bad(`⑮ 配方画的那一副在形态层里查不到：${missing.join(' ')} —— 配方挑得出这副画法，`
        + '而 public/shapes.css 里没人排它（上面那几格的语料里会少一块几何）');
    }
    // 🔴 **反方向（形态层有、97 套候选一次都没画到）从 #1360 起【报告而不判】。**
    //
    // 它原来是红的，理由写在上面那段注释里：「那副画法没有任何一格在看它」。这一句今天有两半，
    // 两半都不再成立：
    //   · **「没人声明它」那一半已经有专门的一道**：`blocks/<块>.json` 的 `shapes` 与
    //     `public/shapes.css` 的 (块, 形态) 集合**两向差集为 0**（#1331，
    //     `scripts/lib/block-shapes.test.js` 第 ① 格，两向各带一个反向臂）。CSS 里写了个谁都没
    //     登记的形态名（拼错那种）在那一格当场红、并被点名 —— 那正是本格原来兜住的错。
    //   · **「几何没人看」那一半已经不是真的**：#1332 的守卫 ⑨ 按 manifest 逐个 (块, 形态) 对、
    //     在真浏览器里、两个视口各量一遍，跟「今天有没有主题选它」无关
    //     （`scripts/theme-css-invariants.mjs` §⑨：「逐个把 data-shape 换成 manifest 里的每一种
    //     形态，而不是只量这套主题今天选中的那一种」）。
    //
    // 而它现在会拦住的那件事，是设计文档自己规定的走法：**区块库先长，主题池后重生**
    // （2026-09-11 那份 spec 的 D9「画法有限，由区块库声明；主题从中挑」+ D12 的「第 4 步重生池」）。
    // 第三点五步往库里加形态时，配方那张候选表按定义还没有它们；要让它们被挑到就得改
    // `CARD_GRIDS` 这类表，而那会改掉每一套候选的 `voiceFor(i)` ⟹ `public/themes/*.css` 两张
    // 生成表跟着变 —— 那是重生池那一步的活，不是加形态这一步的。
    //
    // ⟹ 保留读数（谁是孤儿、有几个都打印出来），去掉判罚。要恢复成硬判，先把重生池做掉。
    if (orphan.length) {
      console.log(`  📌 ⑮ 形态层里有、而 ${N} 套候选一次都没画到的：${orphan.length} 个`
        + `（${orphan.join(' ')}）—— **报告不判**（区块库先长、主题池后重生；它们的几何由 #1332 的`
        + ' 守卫 ⑨ 逐对逐视口量，它们的登记由 #1331 的两向差集守）');
    }
  }
}

console.log(`\n══ 汇总: 通过 ${pass} · 失败 ${fail}`
  + (skipCount ? ` · 🔴 脚手架池跳过 ${skipCount} 格（#1317，不是通过）` : '') + ' ══');
process.exit(fail ? 1 : 0);
