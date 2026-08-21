#!/usr/bin/env node
// ══════════════════════════════════════════════════════════════════════════════════════════════════
// sheet-recipes.js — 把一套候选的调色板/字体/手感变成【34 个块全都画到】的一份受限 CSS（#1051）
// ══════════════════════════════════════════════════════════════════════════════════════════════════
//
// 在这个文件之前，`generate.js` 里是三段写死的 hero CSS，生成器每次挑一段、配一组随机颜色和字体，
// 别的块一行都不写。实测（`origin/main 84cbbea4`）：候选 **7/213 钩子 · 1/34 块**，而三套实证表是
// 213/213 · 34/34。#1016 要拿它跑 60-80 套主题池，准入闸②会把「页面上出现、而这套主题自己表里没有
// 规则」的钩子逐个点名 —— 照那个生成器跑，一套都进不了池。
//
// 🔴 为什么不是「一个模板循环、每个钩子吐一条声明」。那样 213/213 · 34/34 当场全绿，而每块只有
//    213/34 ≈ 6 条声明，60-80 套主题在 33 个块上仍然长得一模一样 —— 正是 #1016 要治的那件事。
//    所以这里按**部件扮演的角色**出样式：标题拿字体/字号/字重/行高/颜色，卡片拿内边距/圆角/表面色，
//    徽标拿胶囊形状和大写字距，媒体位拿宽高比和 object-fit。密度因此是自然长出来的，不是凑的。
//    密度仍然只是代理，不是「好看」的证明 —— 那一关是 #1016 的 AC5（Chris 人审）。
//
// ── 三个东西决定一套候选长什么样 ────────────────────────────────────────────────────────────────
//   ① voice     每套候选一组手感参数（圆角、留白、字重、是否大写、卡片画法、表面明暗的轮换相位）
//   ② shape     每个块自己的骨架：单栏 / 两栏 / 三栏 / 主从分栏，以及它的部件各自扮演什么角色
//   ③ role      部件的角色 → 一段真样式。角色默认从钩子后缀推（`__title` / `__desc` / `__badge`…），
//                块自己可以改写个别部件的角色（`contact-info__phone` 是可点的联系方式，不是普通描述）
//
// ── 契约（`docs/reference/theme-css-contract.md`）在这里怎么被遵守 ──────────────────────────────
//   · 选择器只用 §1 的钩子 —— 名单来自 `theme-css-lint.js` 导出的 `HOOK_CLASSES`，这个文件不另抄一份
//   · 属性只用 §2 白名单（`PROP_EXACT` + `PROP_PREFIXES`）
//   · 颜色一律 `var(--color-…)`，字体一律 `var(--font-…)` —— §3 不许字面色值/字面字体名（#1003）
//   · 不写 `!important`、不写 `position`、不写站外 URL
//   · 🔴 不藏 essential 块，也不藏它里面的部件（§3 + #1043）—— 这个文件里没有 `display: none`，
//     一处都没有。要「不画」某个部件时的做法是**不给它出规则**，而不是给它一条隐藏规则。
//   判据不是这段注释：`scripts/theme-css-lint.js` 对每一套生成出来的表跑一遍，rc=0 才算数。
const path = require('path');

const { HOOK_CLASSES } = require(path.join(__dirname, '..', 'theme-css-lint.js'));
const {
  paletteFor, contrast, ACCENT_KEYS, PRIMARY_KEYS,
} = require(path.join(__dirname, 'palette.js'));

const blockOf = (hook) => (hook.includes('__') ? hook.split('__')[0] : hook);
const partOf = (hook) => (hook.includes('__') ? hook.split('__')[1] : '');

/** 钩子按块分组，顺序照 HOOK_CLASSES —— 名单只有一份，这里不写死 34 个块的清单。 */
function hooksByBlock() {
  const out = new Map();
  for (const hook of HOOK_CLASSES) {
    const b = blockOf(hook);
    if (!out.has(b)) out.set(b, []);
    out.get(b).push(hook);
  }
  return out;
}

// ── ① voice：一套候选的手感 ───────────────────────────────────────────────────────────────────────
//
// 每一项都只取几个离散档位，且都由候选序号决定 —— 同一个 seed 出同一批（`generate.js` 的确定性是
// 四道闸能被同一个输入反复驱动的前提）。取不同的模数是有意的：三项都用 `% 3` 的话，第 4 套会跟第 1 套
// 在**每一项**上都相同，而错开之后要走到第 12 套才第一次整组重复。
const CARD_STYLES = ['filled', 'outlined', 'underlined'];

// 🔴 hero 的两张表和它们的挑法（`HERO_LOOKS` / `heroLookFor` / `heroLayoutFor`）住在下面
//    《hero 那一块》那一节，不在这里 —— 一个名字要说的两件事在那里被拆开了（#1065）。
//    #1065 之前这一行是 `const HERO_LAYOUTS = ['with-media-left', 'with-media-top', 'text-only']`，
//    三个名字每个都同时说了「内容结构」和「外观」两件事，于是外观能有几种被内容结构卡死在 3 种。

// ── #1090 hero 之外的画法候选 ───────────────────────────────────────────────────────────────────
//
// 今天（#1090 之前）hero 之外的 33 个块在 `SHAPES` 里**每块只有一条画法**，几何全出自同一个
// `voiceFor` 模数表 ⟹ 翻图册时任意两套主题的同一页，除了颜色/字体/圆角，版面几乎一样。本票给两族
// 建候选表，照 hero 那一族的先例：一张名字表（分布）+ 一张画法表（那个名字画成什么样）。
//
// 🔴 分布式子与 hero 的 `heroLookFor`（下面《hero 那一块》那一节）同形（`(i + floor(i/L)) % L`，
//    周期 L²），理由逐字相同：`% L` 会让第 i 套与第 i+L 套在相似度闸的 `layout` 那一项上永远同值，
//    而那一项占 0.2 的权重。
const SPLIT_LAYOUTS = ['media-left', 'media-right', 'media-top', 'narrow-stack'];
const splitLayoutFor = (i) => SPLIT_LAYOUTS[
  (i + Math.floor(i / SPLIT_LAYOUTS.length)) % SPLIT_LAYOUTS.length];

// 同页节奏（spec 2026-08-18 的 D5：交替**规则**写在 Theme 里，block 数据不记左右）。
//
// 🔴 为什么是兄弟组合子链，不是 `:nth-of-type` —— 这不是口味，是契约：
//    `docs/reference/theme-css-contract.md` §1 的 **Refused** 一行逐字写着「`nth-child` and
//    friends」，而 `theme-css-lint.js` 真的会拒（实测：`[data-block="content-split"]:nth-of-type(even)`
//    与 `section[data-block=…]` 两条各命中一次；同一把尺对下面这种链式兄弟选择器回 0 条）。
//    lint 把复杂选择器按组合子 `[\s>+~]` 切开再逐段查白名单，所以 `.content-split + .content-split`
//    两段都在名单上 ⟹ 收。
//
// 🔴 代价说在明处：`+` 要求两个图文段是**相邻兄弟**。中间隔了别的块，链就断了，后面那个按第一个画。
//    这正是「连排的图文段交替」这句话本来的意思（Chris 举的 ahaspeed 首页就是连排的一串），而
//    `:nth-of-type` 那种写法数的是**页面上所有块**的序号，两个图文段中间隔一个块就会同奇偶 ⟹
//    它算出来的"交替"反而是错的。两种写法里能用的那种，恰好也是语义对的那种。
const SPLIT_RHYTHMS = ['alternate', 'uniform'];
// 与版式**错开**分布：版式周期 16、节奏取 `floor(i/4) % 2`，所以「同一种版式 × 两种节奏」都出得来
// （`sheet-recipes.test.js` 那格数的就是这个覆盖）。
const splitRhythmFor = (i) => SPLIT_RHYTHMS[
  Math.floor(i / SPLIT_LAYOUTS.length) % SPLIT_RHYTHMS.length];

// 卡片组（features-grid / values-grid / service-highlights / card-group 共用一套候选 —— 它们的部件
// 角色逐字相同（`item`/`title`/`desc`），画法不同才是这一族存在的理由）。
const CARD_GRIDS = ['three-up', 'two-up', 'four-up-tight', 'wide-rows'];
const cardGridFor = (i) => CARD_GRIDS[
  (i + Math.floor(i / CARD_GRIDS.length)) % CARD_GRIDS.length];
/** 卡片组这一族是哪几个块 —— 一处定义，`shapeFor` 和覆盖率那格都读它。 */
// 🔴 #1132 —— `card-group` 是通用块（`values-grid` + `benefits-list` 并成的那个），它当然属于这一族。
//    `values-grid` 留在名单里是因为**老站还在吐老类名**，那 83 张表得一直匹配得上它；
//    `benefits-list` 今天不在这份名单里（它从来就不在），本票不动这件事 —— 加进去会改掉
//    它在 83 张表里那几条规则，而那不是本票的圈。
const CARD_BLOCKS = ['features-grid', 'values-grid', 'service-highlights', 'card-group'];

// 三个块一组的深浅节奏，而不是简单的隔一个换一个 —— 后者让每套候选的节奏都一样。
// 🔴 有 5 组而不是 3 组，是为了让**表本身**的周期够长，理由在 voiceFor 上面那段。
const RHYTHMS = [
  ['deep', 'pale', 'mid'],
  ['pale', 'deep', 'pale'],
  ['mid', 'pale', 'deep'],
  ['pale', 'mid', 'pale'],
  ['deep', 'pale', 'pale'],
];

// 🔴 各档的模数是**互质**的（4 · 3 · 5，加上 hero 那个周期 9），于是整份表要走到
//    lcm(4, 3, 5, 9) = 180 套才第一次原样重复。
//
//    为什么这件事是承重的（QA1 在 #1051 r1 量出来的）：上一版 radius/pad/gap 全是 `i % 4`、
//    rhythm/字重/字号/字距/phase 全是 `i % 3`、hero 周期 9 ⟹ 表的周期只有 36，
//    **跑 200 套只出 24 份不同的 CSS**。而 #1016 要的是 60-80 套主题池 —— 那意味着池里每份表
//    都有 2-4 个双胞胎（`sheetFor(0) === sheetFor(36)` 逐字节相同）。
//    「60-80 套在 33 个块上长得一模一样」正是本票立票时要治的那件事，只是它换了个地方复发。
//    相似度那道闸看不见这件事：它只读 tokens 和 layout，**一个字节的 CSS 都不读**。
//
// ══ #1078 —— 圆角与留白改成【对 token 的引用】，不再是字面值 ═══════════════════════════════════
//
// 为什么：微调引擎（#1006）缩放的是 `--radius-*` / `--section-*` 这两组变量，而阶段 2 把 34 个块的
// 外观搬进这些表时用的是字面值 ⟹ 那两个滑块拖了页面几乎不动（Chris 2026-08-17 在 appdev 上看出来的：
// `Corner roundness` 全程只有 6.4px ↔ 10px，`Spacing` 只有 Footer 会动，因为它是唯一还吃
// `.section-padding` 的部件）。名字里带 `--radius-` / `--section-` 前缀的变量会被 `tweaks.js` 的
// `tweakFor()` 自动归队，所以只要规则改成引用它们，滑块就真的能动整张表。
//
// 🔴 为什么是「一个基准 token × 一个整数倍」，不是「四个 token 名」，也不是「所有表都写同一个 token」：
//
//   · **四档必须留住**。四档今天是主题之间彼此不同的一维（`i % 4`）。如果所有表都写
//     `var(--radius-md)`，80 套的圆角就全一样了 —— 那正是 #1016 花力气挣来的东西被 token 化吃掉
//     （本票 AC2 守的就是这一格）。倍数写在规则里，四档就还是四种不同的写法。
//   · **默认外观必须一个像素都不变**（AC3）。倍数是照今天那四个字面值反解出来的整数：
//       0.25/0.75/1.25/1.75rem = 0.25rem × {1,3,5,7}
//       2.5/3/3.5/4rem         = 0.5rem  × {5,6,7,8}
//       1/1.25/1.5/2rem        = 0.25rem × {4,5,6,8}
//     基准值写在 `globals.css` 的 `:root`（与这三行逐字对应），所以没有 custom.css 时算出来的
//     长度与改造前逐字相同。
//   · **不碰 `margin`**。`theme-css-lint.js` 的 `negativeMarginRisksIn` 明写「读不出来的
//     （一个 `var()`、一个函数）是**拒绝**，不当成非负」—— 往 margin 里放 token 会当场把闸弄红，
//     而那道闸拦的是真风险（负 margin 把块拖出视口）。margin 保持字面值。
const RADIUS_STEPS = [1, 3, 5, 7];
const PAD_STEPS = [5, 6, 7, 8];
const GAP_STEPS = [4, 5, 6, 8];

/** `var(--x)` 或 `calc(var(--x) * k)` —— k=1 时不写 calc（一个乘 1 的 calc 只是噪音）。 */
function tokenLen(name, k) {
  const n = Number(k.toFixed(6));           // 5 × 1.4 在二进制里是 7.000000000000001
  return n === 1 ? `var(${name})` : `calc(var(${name}) * ${n})`;
}

function voiceFor(i) {
  const radiusStep = RADIUS_STEPS[i % 4];
  const padStep = PAD_STEPS[i % 4];
  const gapStep = GAP_STEPS[i % 4];
  const radius = tokenLen('--radius-block', radiusStep);
  const pad = tokenLen('--section-block-pad', padStep);
  const rhythm = RHYTHMS[i % RHYTHMS.length];
  return {
    // 宽屏那条规则要在同一个基准上放大（见 `wideRule`），所以倍数本身也要带下去 ——
    // 拿 `calc(calc(…) * 1.4)` 去套一层是合法 CSS，但读的人要算两层，而且 lint 的算术检查
    // 每多一层就多一次「读不出来」的机会。
    radiusStep,
    padStep,
    gapStep,
    // 🔴 两个键，两条轴，别合并（#1065）：
    //   `heroLook` = 这套主题把 hero 画成什么样（图在左/右/上/下、全屏底图叠字、纯文字居中/靠左、
    //                带表单）。**只有这个文件读它**，它不进 `layout.json`、不进 `supports`。
    //   `hero`     = 这块 hero 装的是什么内容（`with-media` / `text-only` / `with-form`）。
    //                它是写进 `layout.json` 的那个值，也就是 `supports.hero` 里的那个字符串。
    heroLook: heroLookFor(i),
    hero: heroLayoutFor(i),
    // #1090 —— hero 之外两族的画法档。与上面 hero 那两行同一条纪律：**这里是唯一说得出「第 i 套是
    // 哪一种」的地方**，`generate.js` 写进 layout 的名字和下面表里的画法都从它取，分两处算会分叉。
    split: splitLayoutFor(i),
    splitRhythm: splitRhythmFor(i),
    cards: cardGridFor(i),
    card: CARD_STYLES[(i + 1) % CARD_STYLES.length],
    // 表面明暗的轮换相位：块按页面顺序深/浅交替，相位一换，整站的节奏就不一样了。
    // 🔴 取 `% 3` 而不是 `% 2`：相位是拿去转 rhythm 那三格的，`% 2` 永远转不到第三格。
    phase: i % 3,
    rhythm,
    radius,
    // 🔴 药丸不是一个尺寸，是一个形状 —— 它不跟着 `radiusScale` 走，也不需要：9999px 乘任何系数
    //    还是药丸。保持字面值。
    pillRadius: '9999px',
    pad,
    gap: tokenLen('--section-block-gap', gapStep),
    headingWeight: [600, 700, 800][i % 3],
    headingSize: ['1.75rem', '2rem', '2.25rem'][i % 3],
    tracking: ['0', '-0.01em', '-0.02em'][i % 3],
    caps: i % 2 === 1,
    wide: i % 2 === 0 ? '1fr 1fr 1fr' : '1fr 1fr',
  };
}

// 三种表面。每个块拿到一种，块根的背景色和它里面文字的颜色一起从这里来 —— 分开挑会做出
// 深底深字。卡片色比块底深/浅一档，边框色再深一档。
//
// 🔴 `ink` / `muted` / `fill` / `fillFg` 这四项**不写在这里**，由 `surfaceFor()` 按这套候选真实的
//    颜色挑（r4）。理由见那个函数上面那段。
const SURFACES = {
  deep: { bg: 900, fg: 50, soft: 100, card: 800, line: 700, chip: 'accent-500' },
  mid: { bg: 800, fg: 50, soft: 100, card: 900, line: 700, chip: 'accent-400' },
  pale: { bg: 50, fg: 900, soft: 800, card: 100, line: 200, chip: 'accent-500' },
};
const primary = (n) => `var(--color-primary-${n})`;
const accent = (n) => `var(--color-accent-${n})`;
const colourOf = (token) => {
  const t = String(token);
  if (t.startsWith('accent-')) return accent(t.slice(7));
  if (t.startsWith('primary-')) return primary(t.slice(8));
  return primary(t);
};

// ── 字色要压在这个块真实的底色上还读得出来 ─────────────────────────────────────────────────────────
//
// 🔴 上一版这里是**写死的档位**：`contact` / `figure` / `star` / `yes` 一律拿 `accent-500` 当字色，
//    而块底是 `primary-50`。两个档位各自都合理，合起来是不是一段读得出来的字，**没有任何东西量过**。
//    实测（#1051 r3 那批 80 套，QA2 在真机上复现过其中 3 套）：`contact-info__phone` / `__email`
//    在 **20/80 套**里落在 **1.45–2.49:1**，而运行时那道检查（#1050 ②e）对 essential 块的下限是
//    2.5:1 ⟹ 候选当场被准入闸②拦下。`contact-info` 是 essential 块，所以它红；同一个毛病还落在
//    另外 8 个钩子上（stats-counter__value · timeline__year · content-split__stat-value ·
//    social-proof__rating · testimonials__star · announcement-bar__link · pricing-table__price ·
//    feature-comparison__mark--yes），**只是那些块不是 essential，检查看不见** —— 客人一样读不出来。
//
// 🔴 为什么不能靠「把 accent 调暗一点」一次性解决：accent 那条色阶已经被**反方向**钉住了 ——
//    产品自己的 `.btn-accent` 是 `gray-900` 的字压 `--color-accent-400`（`globals.css:61-64`），
//    所以 accent 必须够**亮**（见 `palette.js` 的 rampFor）。一个档位没法同时当「浅底上的深字」和
//    「深字下的浅底」。⟹ 只能**按这个表面挑**：挑不到就退到主色那条色阶上，宁可少一点花哨。
//
// 判据取 **4.5:1**（WCAG 正文门槛），跟按钮那条同一个数，而不是 2.5:1 那个下限 ——
// 2.5 是「还看得出是字」的地板，留出余量之后运行时那道检查不会再因为配色而红。
const INK_FLOOR = 4.5;
// 🔴 大号字那一档单独给 **3:1**（WCAG 对大字的门槛：≥24px，或 ≥18.66px 且加粗）。
//    唯一用它的是 `figure` 角色，而**同一条规则**自己就写着 `font-size: 2rem` + `font-weight: 800`
//    —— 前提是产物保证的，不是假定的。
//    为什么值得多一个数：浅色表面上 accent 那条色阶被产品的 `.btn-accent` 反向钉着（必须够亮），
//    按 4.5 挑时 **80 套里只有 9 套**还能用 accent 当字色，其余全退回主色；按 3 挑是 46 套。
//    统计和年份这种大数字是候选之间最看得出差别的地方，退光了等于把 #1016 要的那点变化磨平。
const LARGE_INK_FLOOR = 3;

const hexOfToken = (token, palette) => {
  const t = String(token);
  const [ramp, shade] = t.includes('-') ? [t.split('-')[0], t.split('-')[1]] : ['primary', t];
  return palette[ramp][shade];
};

// ── 挑档位这件事要在【换掉调色板之后】仍然成立 ─────────────────────────────────────────────────────
//
// 🔴 表里存下来的是 **token 名字**（`var(--color-accent-500)`），受限 CSS 不许写字面色值。所以
//    「accent-500 压在这块底上够黑」这句话是**在这套候选自己的调色板下**量出来的，而站主可以：
//    ① 点一个配色预设 —— `theme-presets.js` 的 6 组把整组 `--color-*` 换掉（#1037 已上线 `58280213`）；
//    ② 拖色相滑块 —— `tweaks.js` 的 `shiftHue` 在上面再转 ±15°。
//    两件事都不改表里的名字，于是这句保证被静默作废。实测（#1016 r3）：只按自己的调色板挑，
//    `theme-presets.test.js` 报 **242 行破线 / 30 过 7 失败**，其中 52 行就在色相 0° 那一档 ——
//    也就是「只点一下配色、滑块都不用拖」就撞得到。
//
// 判据因此扩成：这个档位要在【这套候选自己的调色板】**和**【6 组预设 × 全部色相档】下都 ≥ floor。
// 口径跟 `theme-presets.test.js` 判红时用的是同一套：先换成预设的绝对值、再转色相，顺序与
// `buildCustomCss` 一致（反过来会得出另一批颜色）。
const PRESET_COLOURS = Object.values(require(path.join(__dirname, '..', 'theme-presets.js')).PALETTES)
  .map((p) => p.colors);
const HUE_STEPS = require(path.join(__dirname, '..', 'theme-contrast.js')).hueSteps();
const { shiftHue } = require(path.join(__dirname, '..', 'tweaks.js'));

/**
 * 这个前景 token 压在这些背景 token 上，在【每一组预设 × 每一档色相】下都 ≥ floor 吗？
 * 🔴 参数是 **token 名**而不是颜色值 —— 换调色板这件事换掉的正是名字背后的值，传值进来就问不出这件事。
 */
function okUnderPresets(token, bgTokens, floor) {
  for (const colors of PRESET_COLOURS) {
    for (const hue of HUE_STEPS) {
      const fg = shiftHue(hexOfToken(token, colors), hue);
      for (const bt of bgTokens) {
        if (contrast(fg, shiftHue(hexOfToken(bt, colors), hue)) < floor) return false;
      }
    }
  }
  return true;
}

/**
 * 按 `order` 挨个试，返回第一个【压在 backdrops 每一块底上都 ≥ floor】的档位；一个都没有就 null。
 * `avoid` 里的档位跳过 —— 用来保证「✓ 和 ✗ 不是同一个颜色」这类必须分得开的两处。
 * `bgTokens` 是那两块底的 **token 名**：传了就再过一遍上面那道预设 × 色相的检查。
 */
function pickInk(order, backdrops, palette, floor, avoid = [], bgTokens = null) {
  for (const token of order) {
    if (avoid.includes(token)) continue;
    const hex = hexOfToken(token, palette);
    if (!backdrops.every((bg) => contrast(hex, bg) >= floor)) continue;
    if (bgTokens && !okUnderPresets(token, bgTokens, floor)) continue;
    return token;
  }
  return null;
}
/** 离某一档最近的排前面 —— 挑得到就尽量还是原来那个手感，挑不到才越走越远。 */
const nearest = (keys, target, prefix) => [...keys]
  .sort((a, b) => Math.abs(Number(a) - target) - Math.abs(Number(b) - target))
  .map((k) => `${prefix}-${k}`);
/** 从 `from` 那一档朝 `to` 的方向走 —— 弱化的字要「在读得出来的前提下尽量弱」，所以只往一个方向走。 */
const towards = (keys, from, to, prefix) => [...keys]
  .map(Number)
  .filter((n) => (to > from ? n >= from : n <= from))
  .sort((a, b) => (to > from ? a - b : b - a))
  .map((n) => `${prefix}-${n}`);

/**
 * 一个表面在**这套候选的调色板**下的完整取色。`SURFACES` 里那几档是形状，这里才是值。
 *
 * 🔴 每一项都是**量出来的**，不是假定的：`backdrops` 是这个块里文字可能压到的两块底
 *    （块根自己的底 + 卡片/面板的底），四项取色逐个对这两块底算过对比度。
 * 📌 兜底一定存在：`fg` 是块根自己声明的字色，跟 `bg` 是成对挑的，所以 ink/muted/soft
 *    最差也能退到它；`fillFg` 在 900 / 50 两档里取更分得开的那个。
 */
function surfaceFor(kind, palette) {
  const s = SURFACES[kind];
  const backdrops = [palette.primary[s.bg], palette.primary[s.card]];
  // 同样两块底，但给的是 **token 名** —— 换掉调色板之后要按名字重算（见 `okUnderPresets` 上面那段）。
  const bgTokens = [`primary-${s.bg}`, `primary-${s.card}`];
  const fg = `primary-${s.fg}`;
  // 强调色当字：先在 accent 那条色阶上找（从 500 往两边），找不到退到主色（从 500 往两边），
  // 再找不到就用块根自己那个字色。
  const ink = pickInk(nearest(ACCENT_KEYS, 500, 'accent'), backdrops, palette, INK_FLOOR, [], bgTokens)
    || pickInk(nearest(PRIMARY_KEYS, 500, 'primary'), backdrops, palette, INK_FLOOR, [], bgTokens)
    || fg;
  // 大号字那一档（只有 `figure` 用）：同一条挑法，门槛换成 3。
  const inkLarge = pickInk(nearest(ACCENT_KEYS, 500, 'accent'), backdrops, palette, LARGE_INK_FLOOR, [], bgTokens)
    || pickInk(nearest(PRIMARY_KEYS, 500, 'primary'), backdrops, palette, LARGE_INK_FLOOR, [], bgTokens)
    || fg;
  // 弱化的字（对照表里的 ✗）：从边框那一档起，朝**离底色越来越远**的方向走，取第一个读得出来的
  // —— 「在读得出来的前提下尽量弱」。
  // 🔴 `avoid: [ink]`：✓ 和 ✗ 是同一个颜色的话，那张对照表就不说话了。不加这一条时浅色表面上
  //    80 套里有 71 套两者落在同一档（都退成 primary-600）。
  const muted = pickInk(towards(PRIMARY_KEYS, s.line, s.fg, 'primary'), backdrops, palette, INK_FLOOR, [ink], bgTokens)
    || pickInk(nearest(PRIMARY_KEYS, s.line, 'primary'), backdrops, palette, INK_FLOOR, [ink], bgTokens)
    || fg;
  // 次要正文：本来就该是够的，但「本来就该」不是读数 —— 一样过一遍。
  const soft = pickInk(nearest(PRIMARY_KEYS, s.soft, 'primary'), backdrops, palette, INK_FLOOR, [], bgTokens) || fg;
  // 药丸/图标/序号那种自带底的小东西：底和它上面的字是一对，一起挑。
  //
  // 🔴 这一对**不走 `pickInk`**，它自己挑（底在 accent 那条色阶上走，字在 primary-900/50 里取更分得开
  //    的那一档）。所以上面那道预设检查扩了也管不到它 —— 只扩 `pickInk` 时实测还剩 **128 行破线，
  //    全部是同一个选择器 `.services-nav__link`**（`services-nav` 的 `link` 角色正是 `chip`）。
  //    ⟹ 两条产生路径都要过同一道检查，一个症状只补一条路等于没补（#1016 r4）。
  let fill = s.chip; let fillFg = 'primary-900';
  for (const cand of nearest(ACCENT_KEYS, Number(s.chip.slice(7)), 'accent')) {
    const bg = hexOfToken(cand, palette);
    const best = contrast(palette.primary['900'], bg) >= contrast(palette.primary['50'], bg)
      ? 'primary-900' : 'primary-50';
    if (contrast(hexOfToken(best, palette), bg) >= INK_FLOOR
      && okUnderPresets(best, [cand], INK_FLOOR)) { fill = cand; fillFg = best; break; }
    if (cand === s.chip) fillFg = best;   // 一个都不够时至少用分得开的那一档
  }
  return {
    ...s, fg: s.fg, soft: soft.slice(8), ink, inkLarge, muted, fill, fillFg: fillFg.slice(8),
  };
}

// ── ② shape：每个块的骨架 ─────────────────────────────────────────────────────────────────────────
//
// `cols` 是宽屏下块根的列数（窄屏一律单栏），`role` 改写个别部件的角色。没列出来的块走默认骨架
// （单栏标题 + 卡片网格），这是**有意的兜底**：phase 2 再搬进来一个块时，它当天就有样式，而不是
// 悄悄漏掉一个 —— 漏掉的后果正是本票要治的东西。
//
// 🔴 **改写一个部件的角色之前，先看那个部件在 markup 里是不是一个【容器】。** 把容器写成叶子角色
//    是本文件唯一出过事的地方（r3 修的）：`quote-form__step` 被改写成了 `chip`，而它是一个
//    `<div>`，里面装着一个 `<h2>` 和好几个 `<button>`（`QuoteFormSection.tsx:133-186`）。`chip`
//    这个角色画的是一颗药丸 —— `border-radius: 9999px` + 自己的底色 + 一个会**继承下去**的
//    `color`。药丸的圆角在一个 178×134 的盒子上被夹成 67px，四个角被啃掉一大块，于是标题和按钮
//    的字有一部分落在药丸【外面】、压在表单自己的深底上。实测（单变量，只把这一条 9999px 换成
//    0.5rem）：`/quote.html` 上那几行的可读性读数从 **1.02–1.05:1 跳到 8.55–8.97:1**。
//    判据不是"看着像"：`role` 里写的每个改写，去 `src/components/sections/<块>.tsx` 里数一眼那个
//    部件有没有元素子节点。有 ⟹ 只能给容器类角色（`card` / `row-card` / `panel` / `column`）。
const SHAPES = {
  hero: { cols: '5fr 6fr', rootExtra: { 'align-items': 'center' }, role: { media: 'media', body: 'column', title: 'display', sub: 'lede', cta: 'actions', deco: 'deco' } },
  'cta-banner': { cols: '2fr 1fr', rootExtra: { 'align-items': 'center' }, role: { headline: 'display', desc: 'lede', action: 'actions' } },
  'page-header': { cols: '1fr', role: { crumbs: 'crumbs', title: 'display', sub: 'lede' } },
  'contact-form': { cols: '1fr 1fr', role: { heading: 'headline', intro: 'lede', form: 'panel', error: 'error', success: 'success', note: 'fineprint' } },
  // `step` 不写在这里 —— 它走 ROLE_BY_PART 的默认值 `card`。它是容器（见上面那段 🔴）。
  'quote-form': { cols: '3fr 2fr', role: { form: 'panel', intro: 'lede', main: 'column', aside: 'panel', error: 'error', success: 'success', action: 'actions' } },
  'services-list': { cols: '1fr 1fr', role: { item: 'card', icon: 'icon', title: 'title', desc: 'desc', actions: 'actions', features: 'list', products: 'list' } },
  'values-grid': { role: { item: 'card', title: 'title', desc: 'desc' } },
  // #1132 —— 通用块「卡片组」。跟上面那一行逐字相同，因为它就是那两个块并起来的那个。
  'card-group': { role: { item: 'card', title: 'title', desc: 'desc' } },
  'services-nav': { cols: '1fr', role: { link: 'chip' } },
  'service-related-pages': { role: { card: 'card' } },
  'contact-info': { cols: '1fr 1fr', role: { location: 'card', label: 'eyebrow', address: 'desc', phone: 'contact', email: 'contact' } },
  'stats-counter': { role: { stat: 'card', value: 'figure', label: 'eyebrow' } },
  'process-steps': { role: { step: 'card', num: 'numeral', title: 'title', desc: 'desc' } },
  timeline: { cols: '1fr', role: { event: 'row-card', year: 'figure', title: 'title', desc: 'desc' } },
  'benefits-list': { role: { item: 'card', title: 'title', desc: 'desc' } },
  'team-grid': { role: { member: 'card', name: 'title', role: 'eyebrow', bio: 'desc' } },
  checklist: { cols: '1fr 1fr', role: { item: 'ticked' } },
  'blog-preview': { role: { post: 'card', category: 'chip', date: 'meta', title: 'title', excerpt: 'desc' } },
  'content-split': { cols: '1fr 1fr', rootExtra: { 'align-items': 'center' }, role: { media: 'media', body: 'column', bullets: 'list', stats: 'inline-grid-3', stat: 'card', 'stat-value': 'figure', 'stat-label': 'eyebrow' } },
  'text-block': { cols: '1fr', role: { body: 'prose', attribution: 'meta', list: 'list' } },
  divider: { cols: '1fr', role: { rule: 'deco', label: 'eyebrow' } },
  'social-proof': { role: { rating: 'figure', reviews: 'meta', platform: 'chip', badge: 'chip', quote: 'quote', 'quote-author': 'meta' } },
  'features-grid': { role: { item: 'card', icon: 'icon', title: 'title', desc: 'desc' } },
  'awards-certifications': { role: { item: 'card', title: 'title', year: 'eyebrow', desc: 'desc' } },
  'newsletter-signup': { cols: '2fr 1fr', role: { desc: 'lede', form: 'panel' } },
  'faq-accordion': { cols: '1fr', role: { item: 'row-card', question: 'title', answer: 'desc' } },
  testimonials: { role: { item: 'card', rating: 'inline-row', star: 'star', quote: 'quote', name: 'title', meta: 'meta', service: 'chip' } },
  'announcement-bar': { cols: '1fr', role: { message: 'lede', link: 'contact' } },
  'service-highlights': { role: { item: 'card', title: 'title', desc: 'desc', features: 'list' } },
  'pricing-table': { role: { item: 'card', 'item--featured': 'featured', badge: 'chip', name: 'title', price: 'figure', desc: 'desc', features: 'list', action: 'actions' } },
  gallery: { role: { item: 'card', image: 'media', placeholder: 'media', caption: 'meta', category: 'chip', title: 'title', desc: 'desc' } },
  'feature-comparison': { cols: '1fr', role: { head: 'row-head', label: 'eyebrow', row: 'row-card', feature: 'title', mark: 'mark', 'mark--yes': 'yes', 'mark--no': 'no' } },
  'logo-carousel': { cols: '1fr', role: { logo: 'logo' } },
  'map-area': { role: { area: 'card', name: 'title', desc: 'desc' } },
  'trusted-brands': { cols: '1fr', role: { brand: 'logo' } },
};

// ── hero 那一块：版式的名字必须在产物里真的看得出来 ────────────────────────────────────────────────
//
// 🔴 这张表是 #1051 r2 补的，补的是 QA1 在 r1 抓到的一件事：上一版**唯一**读 `v.hero` 的地方只分
//    「是不是 text-only」，于是 `with-media-left` 与 `with-media-top` 走同一条路、吐**同一份 CSS**
//    （实测两套的表去掉注释头后 md5 相同）。两个名字的区别只活在 `layout.json` 里 —— 而相似度那道闸
//    把版式当一整项（0.2 的权重，`gates.js` 的 WEIGHTS）⟹ AC4 那个「80 套 0 套被拦」是靠一个
//    **产物里不存在的差别**拿到的。按产物的真实表现把这两个名字当成同一个值再跑同一道闸：80 套里
//    被拦 20 套、最像的一对 0.953。
//    这正是这个文件自己在 heroLayoutFor 上面写着的那句话（「`layout.json` 说 text-only、CSS 画的
//    却是两栏 —— 没有任何东西会为此报错」），三个名字里当时只守住了一个。
//
// 🔴 分左右/上下的机制照抄三套实证表：`.hero` 的直接子元素只有 `__deco` / `__media` / `__body`
//    三个（`src/components/sections/HeroSection.tsx:61-67`），实证表就是拿 `order` 排它们的
//    （`hero-media-left.css` 是 media 2 / body 3，`hero-media-right.css` 反过来，
//    `hero-media-top.css` 是 media 1 满宽 + 正文居中）。
//
// 🔴 `text-only` 里 `.hero__media` 照样有规则，不是 `display: none` —— 契约 §3 不许藏部件（#1043/#1050），
//    而且没有规则 = 那个钩子没被覆盖，正是本票要治的东西。它拿到的是「万一这个站真放了图，
//    它作为一条宽横幅落在正文下面」。
// 🔴 #1016 —— 说「居中」的那两个 shape 要把**两个不受 `text-align` 管的部件**一起摆正。
//
// Chris 人审 80 张图时看出来的：hero 的标题居中，按钮却贴左（`gen-07-14` 上先看出来，
// `gen-07-31` / `gen-07-32` 上确认）。他第一张截图上量到的是三层递进偏移：
// 标题中心 839px · 副标题 753px · 按钮 633px，而容器中心是 839.5px。
//
// 真因是 `text-align: center` 按 CSS 规范只管**行内内容**，管不到这两样：
//   · `.hero__cta` 是 flex 容器（`ROLES.actions` 给的 `display: flex`）—— 主轴上的位置由
//     `justify-content` 决定，`text-align` 对它没有作用。
//   · `.hero__sub` 是块级、还带 `max-width: 36rem`（`ROLES.lede`）—— 它比外面那个 46/48rem 的
//     `__body` 窄，而块级元素的左右位置由外边距决定，同样不看 `text-align`。
// 所以表自己声明了居中，产物画出来是左 —— 说的和画的不一致。
//
// 🔴 只给声明了居中的那两个 shape 加，**不改 `ROLES.actions` / `ROLES.lede` 本身**：那两个角色
//    被别的 33 个块共用（`.cta-banner__action`、`.page-header__sub` …），在那里居中是错的。
//    `with-media-left` 那 27 套本来就该左对齐，这里一个字不动 —— 它也是这次的反向对照：
//    改前改后那 27 份表必须逐字节相同。
//
// 🔴 展开写在 `partExtra` 的**最前面**，让 shape 自己写的那个键赢。两种顺序都有静默失败的方向，
//    但只有一个方向有东西守着：写在最后 ⟹ 以后哪个 shape 自己写了 `cta` 会被这里悄悄顶掉，
//    没有任何一格会说话；写在最前 ⟹ 被顶掉的是居中那两处，而那正是 `sheet-recipes.test.js`
//    第④格在问的事（声明了居中、产物却没居中 = 当场点名）。挑失败方向已经有尺子的那一种。
const CENTERED_INLINE_PARTS = {
  cta: () => ({ 'justify-content': 'center' }),
  sub: () => ({ 'margin-left': 'auto', 'margin-right': 'auto' }),
};

// ── #1090 图文段的四种画法 ─────────────────────────────────────────────────────────────────────
//
// 🔴 每一种都要**在产物上真的不同**，不是换个名字（承 #1051 r1「名字不同产物相同」那次）。四种各自
//    动的是不同的维度：栏数（2 栏 / 1 栏）、媒体位（order）、正文宽度、以及宽屏那条规则要不要出现。
/**
 * #1090 交替节奏发出来的那几条规则。
 *
 * 链式兄弟选择器：第 2 个图文段（`A + A`）翻，第 3 个（`A + A + A`）翻回来，如此往下。**靠特异度
 * 决胜，不靠源码顺序** —— 每多一节 `+ .content-split` 就多一个类，`A+A+A`（4 个类）压过 `A+A`
 * （3 个类），所以第 3 个不会被第 2 个那条顺带改掉。写到第 6 个为止：再往下一页里连排六个图文段
 * 已经不是这套表该操心的事，而每一节都要多发两条规则。
 *
 * 🔴 `uniform` 回空数组，不是回一条「都一样」的规则 —— 发一条恒等规则会让「这套主题不交替」和
 *    「这套主题交替但翻成了原样」在产物上长得一模一样，AC2 的 md5 对照就分不开这两件事。
 */
function splitAlternation(v, mediaOrder, bodyOrder) {
  if (v.splitRhythm !== 'alternate') return [];
  const rules = [];
  let sel = '.content-split';
  for (let nth = 2; nth <= 6; nth += 1) {
    sel += ' + .content-split';
    const flipped = nth % 2 === 0;
    const m = flipped ? bodyOrder : mediaOrder;
    const b = flipped ? mediaOrder : bodyOrder;
    rules.push([`${sel} .content-split__media`, { order: m }]);
    rules.push([`${sel} .content-split__body`, { order: b }]);
  }
  return rules;
}

const SPLIT_SHAPES = {
  'media-left': {
    cols: '1fr 1fr',
    rootExtra: () => ({ 'align-items': 'center' }),
    partExtra: {
      media: (v) => ({ order: 1, 'aspect-ratio': '4 / 3', 'border-radius': v.radius }),
      body: () => ({ order: 2 }),
    },
    siblingRules: (v) => splitAlternation(v, 1, 2),
  },
  'media-right': {
    cols: '1fr 1fr',
    rootExtra: () => ({ 'align-items': 'center' }),
    partExtra: {
      media: (v) => ({ order: 2, 'aspect-ratio': '4 / 3', 'border-radius': v.radius }),
      body: () => ({ order: 1 }),
    },
    siblingRules: (v) => splitAlternation(v, 2, 1),
  },
  'media-top': {
    // 🔴 单栏 —— 这一条就是「图在上」跟「图在左」的分界。写成 `1fr 1fr` 等于名字说在上、画出来在左边
    //    （HERO_LOOKS 的 `media-top` 上面记着这个坑，同一个）。
    cols: '1fr',
    // 🔴 #1090 r2 去掉了这里原来那条 `padding: `${v.pad} 1.5rem``。它**今天是逐字重复根规则的值**
    //    （`rootRule` 已经写 `padding: ${v.pad} 1.5rem`，spread 覆盖成同一个值、键的位置也不动
    //    ⟹ 产物逐字节相同，这一点单独量过）；而在下面那条新判据下它会变成「把手机的边距钉在桌面上」，
    //    也就是 QA2 报的那个退步本身。
    rootExtra: () => ({ 'align-items': 'start' }),
    partExtra: {
      media: () => ({ order: 1, width: '100%', height: '18rem', 'aspect-ratio': 'auto', 'border-radius': '0' }),
      body: () => ({ order: 2, 'max-width': '46rem' }),
    },
    // 单栏时「翻」= 图跑到文字下面，同样是看得见的交替。
    siblingRules: (v) => splitAlternation(v, 1, 2),
  },
  'narrow-stack': {
    cols: '1fr',
    rootExtra: () => ({ 'align-items': 'start', 'justify-items': 'center' }),
    partExtra: {
      media: (v) => ({ order: 1, width: '100%', 'max-width': '30rem', 'aspect-ratio': '3 / 2', 'border-radius': v.radius }),
      body: () => ({ order: 2, 'max-width': '34rem' }),
    },
    siblingRules: (v) => splitAlternation(v, 1, 2),
  },
};

// ── #1090 卡片组的四种画法 ─────────────────────────────────────────────────────────────────────
//
// 🔴 动的是**列数**和**卡片形态**，两维一起动 —— 只动列数的话，`wide` 那一维本来就在 voiceFor 里
//    按 `i % 2` 转（`1fr 1fr 1fr` / `1fr 1fr`），加一张只换列数的表等于把已有的那一维改个名字。
const CARD_SHAPES = {
  'three-up': { cols: '1fr 1fr 1fr', rootExtra: () => ({}), partExtra: {} },
  'two-up': { cols: '1fr 1fr', rootExtra: () => ({}), partExtra: {} },
  'four-up-tight': {
    cols: '1fr 1fr 1fr 1fr',
    rootExtra: (v) => ({ gap: tokenLen('--section-block-gap', Math.max(1, v.gapStep - 2)) }),
    partExtra: { item: (v) => ({ padding: tokenLen('--section-block-pad', Math.max(1, v.padStep - 3)) }) },
  },
  'wide-rows': {
    // 一行一张、卡片横过来：标题和描述并排，而不是堆叠。
    cols: '1fr',
    rootExtra: () => ({ 'justify-items': 'stretch' }),
    partExtra: {
      item: () => ({ display: 'grid', 'grid-template-columns': '1fr 2fr', 'align-items': 'start', gap: '1.5rem' }),
    },
  },
};

// ══ 两张表，两条轴（#1065）══════════════════════════════════════════════════════════════════════
//
// 08-12 spec 的 D5（`docs/superpowers/specs/2026-08-12-theme-css-architecture-design.md:79`）：
// **`block_layout` 是内容结构，不是外观**，值表不许出现 `centered` / `split` 这类外观词；它第 208 行
// 的 hero 值表逐字是 `"hero": ["with-media", "text-only", "with-form"]`。
//
// 所以 hero 这一块有两条轴：
//   轴一 **内容结构**（这块 hero 装什么）—— 站说了算，写进页面 JSON 的 `block_layout`；主题这边是
//        `supports.hero`（我为哪些内容形态写了造型）。取值只有那三个，清单的权威是
//        `blocks/hero.json` 的 `block_layout`（#999 的 manifest，与 spec 第 208 行同源）。
//   轴二 **外观**（画成什么样）—— 主题自己的事，只活在这个文件和它生成的那份 CSS 里，
//        **不进 `layout.json`、不进 `supports`、不进任何值表**。
//
// 🔴 #1065 之前这两条轴是黏在一起的：`HERO_LAYOUTS = ['with-media-left', 'with-media-top',
//    'text-only']`，一个名字同时说了两件事。后果不是命名不好看，是**外观能有几种被内容结构的档数
//    卡死**：内容结构只有 3 种，于是画法也只能有 3 种。Chris 2026-08-18 点名要八项（图在左/右/上/下 ·
//    全屏底图叠字 · 纯文字居中/靠左 · 带表单），前七项全是轴二，第八项是轴一。
//
// 🔴 一套候选的外观**只有这一张表说了算**，内容结构由这张表里的 `content` 派生 —— 两处各写一份必然
//    分叉，而分叉的样子是「`layout.json` 说 text-only、CSS 画的却是两栏」，没有任何东西会为此报错
//    （这句话是 #1051 写在 `heroLayoutFor` 上面的，本次改造把它保住了：`heroLayoutFor` 现在读的就是
//    `heroLookFor` 挑中的那一项的 `content`）。
//
// ── 分左右/上下靠什么 ────────────────────────────────────────────────────────────────────────────
// `.hero` 的直接子元素只有 `__deco` / `__media` / `__body`（`src/components/sections/HeroSection.tsx:61-67`；
// 带表单时多一个 `__form`），三套实证表就是拿 `order` 排它们的：`hero-media-left.css` 是 media 2 /
// body 3，`hero-media-right.css:27` 反过来（`order: 3`），`hero-media-top.css` 是 media 1 满宽。
// 「图在右」这件事引擎本来就画得出来，#1065 之前只是生成器没往外吐。
//
// 🔴 全屏底图叠字用的是**同一格网格**，不是 `position` —— 契约 §2 的属性白名单里没有 `position`
//    （`theme-css-lint.js` 的 `PROP_EXACT`），而两个网格项显式落在同一个 `grid-row` / `grid-column`
//    上就会重叠，谁压在上面由**文档顺序**决定（`__body` 在 `__media` 后面 ⟹ 字压在图上）。
// 🔴 图不给到全强度（`opacity` 压到 0.35）：字的对比度是按**这个块自己的底色**量的
//    （`ink-contrast.js` + 运行时那道检查），而表不可能知道站主放的是哪张图。压暗之后图是底纹、
//    字仍然压在这套候选自己的底色上，那条保证才还成立。
//
// ── 每一种画法都要给 `.hero__form` 排一个位置（#1065 r2）────────────────────────────────────────
//
// 🔴 这条是 r1 交付的真缺陷，CI 在 main 上当场红了三格（`violet-74` / `fern-10` / `ember-46`，
//    run 32201593486 的 theme-css 分片 3/4/7），PM 撤回了那次 ship。
//
// 病在哪：`form-side` 之外的七种画法都没给 `form` 这个部件写 `order`，而 CSS 的默认值是 **0**，
// hero 里其余部件的 order 是 1 起步 ⟹ 「没排位置」不是「排在末尾」，是**排在最前面**，也就是这块
// hero 的最上沿。三套红的候选都是 `media-top`，而 `media-top` 的块根写的是 `padding: 0 0 …`
// （上内边距为 0）⟹ 表单从 y=0 开始。
//
// 为什么最上沿会红：`transparent-overlay` 那种页眉（`supports.header`，12 套候选有它）在页面最上面
// 铺一层 160px 高的黑色渐变遮罩（`linear-gradient(rgba(0,0,0,.75), rgba(0,0,0,.55), transparent)`，
// 见 `src/components/Header.tsx:136` 那个 `data-region="header-scrim"` 的 div），把压在它下面的东西
// 冲淡。violet-74 两臂真机实测（1440×900，hero 带真图，两臂都先证过「服出来的 theme.css
// 含这一版表的全部字节」）：
//
//                     .hero__form 的 computed order   form.top   四个 label 的 y      带内(y<160)
//   r1（有缺陷）       0（正文是 3）                   0          28 · 110 · 192 · 28   3 个
//   r2（本次修法）     4（正文是 3）                   536        564 · 646 · 728 · 564 0 个
//
//   而 label 的**声明值**两臂完全相同：`color: rgb(248,239,250)`（`.hero` 的 `--color-primary-50`）
//   压 `background: rgb(53,18,63)`（`.hero__form` 的 `--color-primary-900`），从这套候选的调色板算
//   出来 = **14.29:1**。运行时那道检查在 r1 上点名最上面那个 "Name"：画出来是 rgb(81,80,82) 压
//   rgb(18,6,22) = **2.46:1**，低于它的下限 2.5。
//   ⟹ 红的不是配色，是位置：同一对颜色，换个 y 就是另一个读数。
//
// 🔴 所以修法是给它排位置，不是给它配色。`ROLES.panel` 给 `.hero__form` 的底色是这个表面自己的
//    `card` 档，而 `SURFACES` 里 `card` 和 `bg`/`fg` 永远同一族（pale 是 50/100、deep 是 900/800、
//    mid 是 800/900）⟹「深底 + 继承来的深墨」按构造出不来。这不是推的：池里 80 份表逐份取
//    `.hero` 的 `color` 与 `.hero__form` 的 `background-color`，按各自调色板算出来是
//    **9.79:1（ember-46）到 15.43:1（indigo-58）**，低于 4.5 的 0 份、低于 2.5 的 0 份。
//
// 排在正文后面，是因为这七种画法的主角都不是表单（表单是 `form-side` 那一种的主角）。`grid-column:
// 1 / -1` 是给两栏的那几种写的：不写的话它会掉进第二栏，宽度由那一栏说了算。
const heroFormAfterBody = (centred) => () => ({
  order: 4,
  'grid-column': '1 / -1',
  'max-width': '32rem',
  ...(centred ? { 'margin-left': 'auto', 'margin-right': 'auto' } : {}),
});

const HERO_LOOKS = {
  // ① 图在左
  'media-left': {
    content: 'with-media',
    cols: '5fr 6fr',
    rootExtra: () => ({ 'align-items': 'center', 'min-height': '34rem' }),
    partExtra: {
      deco: () => ({ order: 1 }),
      media: (v) => ({ order: 2, 'aspect-ratio': '4 / 5', 'max-width': '34rem', 'border-radius': v.radius }),
      body: () => ({ order: 3, 'max-width': '34rem' }),
      form: heroFormAfterBody(false),
      title: () => ({ 'font-size': '3.25rem', 'line-height': '1.04' }),
    },
  },
  // ② 图在右 —— 跟①同一副骨架，只有 order 反过来 + 两栏的宽度比反过来。
  'media-right': {
    content: 'with-media',
    cols: '6fr 5fr',
    rootExtra: () => ({ 'align-items': 'center', 'min-height': '32rem' }),
    partExtra: {
      deco: () => ({ order: 1 }),
      body: () => ({ order: 2, 'max-width': '33rem' }),
      media: (v) => ({ order: 3, 'aspect-ratio': '5 / 4', 'max-width': '36rem', 'border-radius': v.radius }),
      form: heroFormAfterBody(false),
      title: () => ({ 'font-size': '3rem', 'line-height': '1.06' }),
    },
  },
  // ③ 图在上
  // 🔴 宽屏也是**单栏** —— 这一条就是「媒体位在上」跟「媒体位在左」的分界。#1051 r1 那一版这里跟
  //    left 拿到同一个 `5fr 6fr`，也就是名字说在上、画出来在左边。
  'media-top': {
    content: 'with-media',
    cols: '1fr',
    rootExtra: (v) => ({
      'align-items': 'start', 'text-align': 'center', 'min-height': '0', padding: `0 0 ${v.pad}`,
    }),
    partExtra: {
      ...CENTERED_INLINE_PARTS,
      media: () => ({ order: 1, width: '100%', height: '16rem', 'aspect-ratio': 'auto', 'border-radius': '0' }),
      deco: () => ({ order: 2, 'max-width': '4rem', 'margin-left': 'auto', 'margin-right': 'auto' }),
      body: () => ({ order: 3, 'max-width': '46rem', 'margin-left': 'auto', 'margin-right': 'auto', 'padding-top': '1.5rem' }),
      form: heroFormAfterBody(true),
      title: () => ({ 'font-size': '2.25rem', 'line-height': '1.2', 'text-transform': 'uppercase', 'letter-spacing': '0.02em' }),
    },
  },
  // ④ 图在下 —— 字先落地，图作为一条宽横幅收在正文下面。
  'media-bottom': {
    content: 'with-media',
    cols: '1fr',
    rootExtra: (v) => ({ 'align-items': 'start', 'min-height': '30rem', padding: `${v.pad} 1.5rem 0` }),
    partExtra: {
      deco: () => ({ order: 1, 'max-width': '6rem' }),
      body: () => ({ order: 2, 'max-width': '42rem' }),
      media: () => ({ order: 3, width: '100%', height: '18rem', 'aspect-ratio': 'auto', 'border-radius': '0' }),
      form: heroFormAfterBody(false),
      title: () => ({ 'font-size': '3rem', 'line-height': '1.08' }),
    },
  },
  // ⑤ 全屏底图叠字 —— 图铺满整个 hero，正文压在它上面（同一格网格，理由见这一节开头那条 🔴）。
  //
  // 🔴 字**落在正文块自己那块底色上**，不是直接压在图上。两条都是实测逼出来的：
  //   · 图不许半透明。第一版给 `.hero__media` 写了 `opacity: 0.35`（想让图当底纹），而 `opacity < 1`
  //     会给它开一个**层叠上下文** ⟹ 按 CSS 的绘制顺序它跑到了普通流内容**上面**，也就是图盖住了字。
  //     实测（jade-05，真机）：`.hero__sub` 声明的是 rgb(28,69,55)，量到的是 rgb(92,127,116)，
  //     压在 rgb(227,243,238) 上只有 3.86:1 —— 运行时那道检查当场判红。DOM 顺序（body 在 media
  //     后面）在这种情况下**不作数**。
  //   · 字压在照片上没法给保证。对比度是按这个块自己的底色量的（`ink-contrast.js` + 运行时那道
  //     检查），而表不可能知道站主放的是哪张图。给正文块一块不透明的底色之后，那对颜色跟别的画法
  //     是同一对，保证照旧成立；图从那块底的四周露出来，整屏仍然是它。
  'media-cover': {
    content: 'with-media',
    cols: '1fr',
    rootExtra: () => ({ 'align-items': 'center', 'text-align': 'center', 'min-height': '36rem' }),
    partExtra: {
      ...CENTERED_INLINE_PARTS,
      media: () => ({
        'grid-row': '1', 'grid-column': '1 / -1', 'align-self': 'stretch',
        width: '100%', 'min-height': '30rem', 'aspect-ratio': 'auto',
        'border-radius': '0', overflow: 'hidden',
      }),
      body: (v, s) => ({
        'grid-row': '1', 'grid-column': '1 / -1', 'align-self': 'center',
        'max-width': '44rem', 'margin-left': 'auto', 'margin-right': 'auto',
        padding: '2.5rem', 'border-radius': v.radius, 'background-color': primary(s.bg),
      }),
      deco: () => ({ 'grid-row': '2', 'max-width': '7rem', 'margin-left': 'auto', 'margin-right': 'auto' }),
      // 🔴 这一种的位置由 `grid-row` 说了算，不是 `order` —— 图和正文都显式落在第 1 行上
      //    （那正是「叠字」这件事本身），`order` 只在自动排位时说话。
      form: () => ({
        'grid-row': '3', 'grid-column': '1 / -1',
        'max-width': '32rem', 'margin-left': 'auto', 'margin-right': 'auto',
      }),
      title: () => ({ 'font-size': '3.5rem', 'line-height': '1.05' }),
    },
  },
  // ⑥ 纯文字居中
  'text-center': {
    content: 'text-only',
    cols: '1fr',
    rootExtra: () => ({
      'align-items': 'center', 'justify-items': 'center', 'text-align': 'center', 'min-height': '26rem',
    }),
    partExtra: {
      ...CENTERED_INLINE_PARTS,
      deco: () => ({ order: 1, 'max-width': '5rem', 'margin-left': 'auto', 'margin-right': 'auto' }),
      body: () => ({ order: 2, 'max-width': '48rem', 'margin-left': 'auto', 'margin-right': 'auto' }),
      media: (v) => ({ order: 3, 'aspect-ratio': '21 / 9', width: '100%', 'margin-top': '2rem', 'border-radius': v.radius }),
      form: heroFormAfterBody(true),
      title: () => ({ 'font-size': '3.75rem', 'line-height': '1.02' }),
    },
  },
  // ⑦ 纯文字靠左 —— 跟⑥的区别在产物上是可量的：正文块不给 auto 外边距，所以它贴着左边界。
  // 🔴 这里一个 `text-align: center` 都没有 ⟹ 也就不欠 `CENTERED_INLINE_PARTS` 那两条
  //    （`sheet-recipes.test.js` 第④格问的就是「声明了居中的块，有没有把不受 text-align 管的
  //    东西一起摆正」；没声明居中的块不在它射程里）。
  'text-left': {
    content: 'text-only',
    cols: '1fr',
    rootExtra: () => ({ 'align-items': 'start', 'justify-items': 'start', 'min-height': '24rem' }),
    partExtra: {
      deco: () => ({ order: 1, 'max-width': '5rem' }),
      body: () => ({ order: 2, 'max-width': '44rem' }),
      media: (v) => ({ order: 3, 'aspect-ratio': '24 / 7', width: '100%', 'margin-top': '2.5rem', 'border-radius': v.radius }),
      form: heroFormAfterBody(false),
      title: () => ({ 'font-size': '3.25rem', 'line-height': '1.06', 'letter-spacing': '-0.02em' }),
    },
  },
  // ⑧ 带表单 —— 这一项是**轴一**：它要的是 hero 里真有一个表单部件（`.hero__form`，
  //    `HeroSection.tsx` 在页面 JSON 写了 `block_layout: "with-form"` 时渲染它）。这张表这里负责的
  //    是它的画法：正文在左、表单在右，图收成一条压在两栏下面的窄横幅。
  'form-side': {
    content: 'with-form',
    cols: '6fr 5fr',
    rootExtra: () => ({ 'align-items': 'center', 'min-height': '32rem' }),
    partExtra: {
      deco: () => ({ order: 1 }),
      body: () => ({ order: 2, 'max-width': '32rem' }),
      form: (v) => ({ order: 3, 'max-width': '30rem', 'border-radius': v.radius, padding: '2rem' }),
      media: () => ({ order: 4, 'grid-column': '1 / -1', width: '100%', 'aspect-ratio': '24 / 5', 'border-radius': '0' }),
      title: () => ({ 'font-size': '2.75rem', 'line-height': '1.1' }),
    },
  },
};

const HERO_LOOK_NAMES = Object.keys(HERO_LOOKS);

// 🔴 挑外观**不是** `i % 8`：相似度那道闸把版式当一整项（0.2 的权重），周期等于档数时第 i 套与第
// i+8 套在这一项上永远满分。式子 `(i + floor(i/L)) % L` 的周期是 L²（L=8 时 64），而字体那一档是 7
// （`generate.js` 的 FONT_PAIRS）⟹ 「字体 + 外观」要走到 lcm(7, 64) = 448 套才第一次同时撞回来。
// 📌 改 HERO_LOOKS 的项数不用改这一行。
const heroLookFor = (i) => HERO_LOOK_NAMES[
  (i + Math.floor(i / HERO_LOOK_NAMES.length)) % HERO_LOOK_NAMES.length];

// 第 i 套候选的**内容结构** —— `generate.js` 写进 `layout.json` 的就是它，`promote.js` 再把它翻成
// `supports.hero`。它是上面那张表的派生值，不是第二份清单。
const heroLayoutFor = (i) => HERO_LOOKS[heroLookFor(i)].content;

/** 轴一的取值表（去重、按外观表的出场顺序）。判据是 `blocks/hero.json` 的 `block_layout`。 */
const HERO_LAYOUTS = [...new Set(HERO_LOOK_NAMES.map((n) => HERO_LOOKS[n].content))];

// 三族各有候选表（hero 归 #1065 · content-split 与卡片组归 #1090）；其余 30 个块仍然直接用
// SHAPES 里那条。
// 🔴 挑出来的名字必须在对应那张候选表里 —— 落回默认等于又一次「名字说一套、画的是另一样」，
//    所以这里宁可当场炸，也不悄悄拿第一种顶上。
function shapeFor(block, v) {
  const base = SHAPES[block] || {};
  // `keepsWideBreakpoint` = 这个块族**换画法**时不许把宽屏那一段丢掉（#1090 r2，理由在 sheetFor
  // 那个调用点上）。传参而不是给每个画法条目贴 flag：加画法的人不需要记得任何事。
  const pick = (table, name, what, keepsWideBreakpoint = false) => {
    const shape = table[name];
    if (!shape) throw new Error(`${what} 画法 ${name} 在候选表里没有 —— 加画法就在那张表里加，一处`);
    return {
      ...base,
      cols: shape.cols,
      rootExtra: { ...(base.rootExtra || {}), ...shape.rootExtra(v) },
      partExtra: { ...(base.partExtra || {}), ...(shape.partExtra || {}) },
      siblingRules: shape.siblingRules,
      keepsWideBreakpoint,
    };
  };
  // 🔴 hero 不传 true：它归 #1065，它那些纯文字画法今天本来就没有宽屏那一段，本票不改它的产物。
  //    `SHAPES.hero` 没有 `partExtra`（实测），所以上面那行 spread 对 hero 等价于 #1065 那版的
  //    `partExtra: hero.partExtra` —— 这一条单独量过，见交接留言。
  if (block === 'hero') return pick(HERO_LOOKS, v.heroLook, 'hero');
  if (block === 'content-split') return pick(SPLIT_SHAPES, v.split, 'content-split', true);
  if (CARD_BLOCKS.includes(block)) return pick(CARD_SHAPES, v.cards, block, true);
  return base;
}

// 后缀 → 默认角色。块可以在 SHAPES 里改写个别部件；改写只是为了说清那个部件真正是什么
// （`contact-info__phone` 是可点的联系方式，不是普通描述文字）。
const ROLE_BY_PART = {
  headline: 'headline',
  sub: 'lede',
  intro: 'lede',
  title: 'title',
  name: 'title',
  desc: 'desc',
  excerpt: 'desc',
  answer: 'desc',
  bio: 'desc',
  body: 'prose',
  item: 'card',
  card: 'card',
  post: 'card',
  member: 'card',
  event: 'row-card',
  step: 'card',
  stat: 'card',
  area: 'card',
  location: 'card',
  icon: 'icon',
  media: 'media',
  image: 'media',
  placeholder: 'media',
  value: 'figure',
  price: 'figure',
  year: 'eyebrow',
  label: 'eyebrow',
  role: 'eyebrow',
  category: 'chip',
  badge: 'chip',
  platform: 'chip',
  service: 'chip',
  chip: 'chip',
  link: 'contact',
  phone: 'contact',
  email: 'contact',
  address: 'desc',
  date: 'meta',
  meta: 'meta',
  caption: 'meta',
  attribution: 'meta',
  reviews: 'meta',
  quote: 'quote',
  rating: 'inline-row',
  star: 'star',
  features: 'list',
  products: 'list',
  list: 'list',
  bullets: 'list',
  actions: 'actions',
  action: 'actions',
  cta: 'actions',
  form: 'panel',
  main: 'column',
  aside: 'panel',
  heading: 'headline',
  message: 'lede',
  note: 'fineprint',
  error: 'error',
  success: 'success',
  num: 'numeral',
  crumbs: 'crumbs',
  deco: 'deco',
  rule: 'deco',
  logo: 'logo',
  brand: 'logo',
  head: 'row-head',
  row: 'row-card',
  feature: 'title',
  mark: 'mark',
  stats: 'inline-grid-3',
  'stat-value': 'figure',
  'stat-label': 'eyebrow',
  'quote-author': 'meta',
  'item--featured': 'featured',
  'mark--yes': 'yes',
  'mark--no': 'no',
};

// ── ③ role → 一段真样式 ──────────────────────────────────────────────────────────────────────────
//
// 每个角色回答的是「这个部件在版面上是什么」，所以它拿到的是那件事需要的那几条属性：标题要字体、
// 字号、字重、行高、字距、颜色；卡片要内边距、圆角、表面；徽标要胶囊形状和大写字距。
// 🔴 一条 `display: none` 都没有 —— 契约 §3 不许藏 essential 块和它的部件（#1043/#1050）。
const ROLES = {
  headline: (v, s) => ({
    'grid-column': '1 / -1',
    'font-family': 'var(--font-heading)',
    'font-size': v.headingSize,
    'line-height': '1.15',
    'font-weight': v.headingWeight,
    'letter-spacing': v.tracking,
    color: primary(s.fg),
  }),
  display: (v, s) => ({
    'grid-column': '1 / -1',
    'font-family': 'var(--font-heading)',
    'font-size': '2.5rem',
    'line-height': '1.08',
    'font-weight': v.headingWeight + 100 > 900 ? 900 : v.headingWeight + 100,
    'letter-spacing': v.tracking,
    color: primary(s.fg),
  }),
  lede: (v, s) => ({
    'grid-column': '1 / -1',
    'max-width': '36rem',
    'margin-top': '0.75rem',
    'font-size': '1.0625rem',
    'line-height': '1.7',
    color: primary(s.soft),
  }),
  prose: (v, s) => ({
    'max-width': '38rem',
    'font-size': '1rem',
    'line-height': '1.75',
    color: primary(s.soft),
  }),
  column: () => ({
    display: 'grid',
    'align-content': 'start',
    gap: '1rem',
    'max-width': '38rem',
  }),
  card: (v, s) => ({
    display: 'grid',
    'align-content': 'start',
    gap: '0.75rem',
    padding: v.card === 'underlined' ? '0 0 1.5rem' : '1.75rem',
    'border-radius': v.card === 'underlined' ? '0' : v.radius,
    ...(v.card === 'filled'
      ? { 'background-color': primary(s.card) }
      : { 'border-width': v.card === 'outlined' ? '1px' : '0 0 2px', 'border-style': 'solid', 'border-color': primary(s.line) }),
  }),
  'row-card': (v, s) => ({
    display: 'grid',
    gap: '0.5rem',
    padding: '1.25rem 0',
    'border-width': '0 0 1px',
    'border-style': 'solid',
    'border-color': primary(s.line),
  }),
  'row-head': (v, s) => ({
    display: 'grid',
    gap: '0.5rem',
    'padding-bottom': '0.75rem',
    'border-width': '0 0 2px',
    'border-style': 'solid',
    'border-color': colourOf(s.fill),
    'font-family': 'var(--font-heading)',
    'font-weight': v.headingWeight,
    color: primary(s.fg),
  }),
  featured: (v, s) => ({
    'border-width': '2px',
    'border-style': 'solid',
    'border-color': colourOf(s.fill),
    'background-color': primary(s.card),
  }),
  panel: (v, s) => ({
    display: 'grid',
    gap: '1rem',
    padding: '1.75rem',
    'border-radius': v.radius,
    'background-color': primary(s.card),
  }),
  title: (v, s) => ({
    'font-family': 'var(--font-heading)',
    'font-size': '1.1875rem',
    'line-height': '1.3',
    'font-weight': v.headingWeight,
    color: primary(s.fg),
  }),
  desc: (v, s) => ({
    'font-size': '0.9375rem',
    'line-height': '1.65',
    color: primary(s.soft),
  }),
  // 🔴 这里用 `inkLarge`（门槛 3:1）而不是 `ink`（4.5:1），凭据就在同一条规则里：
  //    `font-size: 2rem` + `font-weight: 800` = WCAG 说的大字。别的角色一律走 4.5。
  figure: (v, s) => ({
    'font-family': 'var(--font-heading)',
    'font-size': '2rem',
    'line-height': '1.1',
    'font-weight': 800,
    'letter-spacing': '-0.02em',
    color: colourOf(s.inkLarge),
  }),
  eyebrow: (v, s) => ({
    'font-size': '0.75rem',
    'font-weight': 600,
    'text-transform': v.caps ? 'uppercase' : 'none',
    'letter-spacing': v.caps ? '0.08em' : '0',
    color: primary(s.soft),
  }),
  chip: (v, s) => ({
    'justify-self': 'start',
    padding: '0.25rem 0.75rem',
    'border-radius': v.pillRadius,
    'background-color': colourOf(s.fill),
    'font-size': '0.75rem',
    'font-weight': 700,
    'text-transform': v.caps ? 'uppercase' : 'none',
    'letter-spacing': '0.05em',
    color: primary(s.fillFg),
  }),
  meta: (v, s) => ({
    'font-size': '0.8125rem',
    'line-height': '1.5',
    color: primary(s.soft),
  }),
  fineprint: (v, s) => ({
    'font-size': '0.75rem',
    'line-height': '1.6',
    color: primary(s.soft),
  }),
  // 🔴 下划线用 border 画，不用 `text-decoration-*` —— 那两个不在 §2 白名单上（`theme-css-lint.js`
  // 的 `PROP_EXACT` / `PROP_PREFIXES`，实测各报 3 处违规）。`justify-self: start` 是配套的：
  // 一条 border 会撑满整个网格格子，而下划线要跟着字走。
  contact: (v, s) => ({
    'justify-self': 'start',
    'font-size': '1rem',
    'font-weight': 600,
    'line-height': '1.5',
    'border-width': '0 0 1px',
    'border-style': 'solid',
    'border-color': colourOf(s.ink),
    color: colourOf(s.ink),
  }),
  quote: (v, s) => ({
    'font-size': '1.0625rem',
    'line-height': '1.7',
    'font-style': 'italic',
    color: primary(s.fg),
  }),
  'inline-row': () => ({
    display: 'flex',
    'align-items': 'center',
    gap: '0.25rem',
  }),
  star: (v, s) => ({
    'font-size': '0.875rem',
    'line-height': '1',
    color: colourOf(s.ink),
  }),
  'inline-grid-3': () => ({
    display: 'grid',
    'grid-template-columns': '1fr 1fr 1fr',
    gap: '1rem',
  }),
  list: (v, s) => ({
    display: 'grid',
    gap: '0.5rem',
    'padding-left': '1.1rem',
    'font-size': '0.9375rem',
    'line-height': '1.6',
    color: primary(s.soft),
  }),
  ticked: (v, s) => ({
    display: 'grid',
    gap: '0.5rem',
    padding: '0.75rem 0 0.75rem 1.75rem',
    'border-width': '0 0 1px',
    'border-style': 'solid',
    'border-color': primary(s.line),
    'font-size': '0.9375rem',
    'line-height': '1.6',
    color: primary(s.fg),
  }),
  actions: () => ({
    display: 'flex',
    'flex-wrap': 'wrap',
    'align-items': 'center',
    gap: '0.75rem',
    'margin-top': '1.25rem',
  }),
  icon: (v, s) => ({
    display: 'grid',
    'place-items': 'center',
    width: '2.75rem',
    height: '2.75rem',
    'border-radius': v.card === 'underlined' ? v.pillRadius : v.radius,
    'background-color': colourOf(s.fill),
    color: primary(s.fillFg),
  }),
  numeral: (v, s) => ({
    display: 'grid',
    'place-items': 'center',
    width: '2.5rem',
    height: '2.5rem',
    'border-radius': v.pillRadius,
    'background-color': colourOf(s.fill),
    'font-family': 'var(--font-heading)',
    'font-size': '1.0625rem',
    'font-weight': 800,
    color: primary(s.fillFg),
  }),
  media: (v, s) => ({
    width: '100%',
    'aspect-ratio': '4 / 3',
    'border-radius': v.radius,
    'object-fit': 'cover',
    'object-position': 'center',
    'background-color': primary(s.card),
  }),
  logo: (v, s) => ({
    display: 'grid',
    'place-items': 'center',
    height: '2.5rem',
    'max-width': '9rem',
    'object-fit': 'contain',
    opacity: '0.85',
    color: primary(s.soft),
  }),
  // 🔴 `grid-column: 1 / -1` 不是装饰，是**放置**：块根是网格，而装饰条不写跨列就会占掉第一格，
  // 把正文挤到第二行去。实测（截图看的）：hero 的装饰条占了左上那一格，标题被推到媒体位下面，
  // 首屏左半边空出 500px。同一条也适用于 divider 的那根线。
  deco: (v, s) => ({
    'grid-column': '1 / -1',
    height: '0.25rem',
    'border-radius': v.pillRadius,
    'background-color': colourOf(s.fill),
  }),
  crumbs: (v, s) => ({
    'font-size': '0.8125rem',
    'letter-spacing': '0.02em',
    color: primary(s.soft),
  }),
  error: (v, s) => ({
    padding: '0.75rem 1rem',
    'border-radius': v.radius,
    'border-width': '1px',
    'border-style': 'solid',
    'border-color': colourOf(s.fill),
    'font-size': '0.875rem',
    'line-height': '1.5',
    color: primary(s.fg),
  }),
  success: (v, s) => ({
    padding: '0.75rem 1rem',
    'border-radius': v.radius,
    'background-color': primary(s.card),
    'font-size': '0.875rem',
    'font-weight': 600,
    'line-height': '1.5',
    color: primary(s.fg),
  }),
  mark: (v, s) => ({
    'font-size': '1rem',
    'font-weight': 700,
    'line-height': '1',
    color: primary(s.soft),
  }),
  yes: (v, s) => ({ color: colourOf(s.ink) }),
  no: (v, s) => ({ color: colourOf(s.muted) }),
};

// ── 把上面三样拼成 CSS ────────────────────────────────────────────────────────────────────────────
const declBlock = (selector, decls) => `${selector} {\n${
  Object.entries(decls).map(([k, val]) => `  ${k}: ${val};`).join('\n')}\n}\n`;

/** 块根自己那条规则 —— 深浅、留白、窄屏单栏。`extra` 是这个块骨架自己要加的几条。 */
function rootRule(block, v, s, extra) {
  return declBlock(`.${block}`, {
    display: 'grid',
    'grid-template-columns': '1fr',
    gap: v.gap,
    padding: `${v.pad} 1.5rem`,
    'background-color': primary(s.bg),
    color: primary(s.fg),
    ...(extra || {}),
  });
}

/**
 * 宽屏那条 —— 列数来自这个块自己的骨架，留白同时放大。
 *
 * 🔴 `stated` 是这个画法在 `rootExtra` 里**自己表过态**的那些声明（#1090 r2）。这条规则排在根规则
 *    之后、同特异度 ⟹ 不把它们排除掉就会当场盖掉画法的设计意图。实测的样子：`four-up-tight` 的
 *    根规则把 gap 收到 `calc(var(--section-block-gap) * 4)`（`gapStep - 2`），而这里发的是 `* 9`
 *    （`gapStep * 1.5`）⟹ 那个画法在 1024px 以下是紧的、在桌面上一点都不紧，而它的名字和它自己
 *    那条注释都说它紧。（卡片内边距那一半没被盖掉，因为它走的是 `partExtra`，不是这条规则。）
 *    hero 不受这一条影响：`HERO_LOOKS` 的 rootExtra 一条都没写过 gap / padding（本轮重量过）。
 */
function wideRule(block, v, cols, stated = {}) {
  const decls = { 'grid-template-columns': cols };
  // #1078 —— 放大的倍数乘进 token 的系数里，而不是再套一层 calc。算出来的长度与改造前
  // 逐字相同：`calc(1.25rem * 1.5)` = 1.875rem = `calc(var(--section-block-gap) * 7.5)`。
  if (!('gap' in stated)) decls.gap = tokenLen('--section-block-gap', v.gapStep * 1.5);
  if (!('padding' in stated)) decls.padding = `${tokenLen('--section-block-pad', v.padStep * 1.4)} 3rem`;
  return `@media (min-width: 1024px) {\n  ${
    declBlock(`.${block}`, decls).trim().split('\n').join('\n  ')}\n}\n`;
}

/**
 * 一套候选的完整表。`i` 是候选序号（决定 voice + 调色板），块和钩子的清单来自契约。
 *
 * 🔴 `seed` 要跟 `generate.js` 那次调用的 seed 一致 —— 从 r4 起这份表里的字色是**按这套候选真实的
 * 颜色**挑的（见 `surfaceFor`），而颜色来自 `paletteFor(i, seed)`。两边 seed 不同 = 表按 A 的颜色挑、
 * 站里装的是 B 的颜色，对比度那条保证当场作废，而**没有任何东西会为此报错**。
 *
 * 📌 这里**没有**「跳过某个块」的开关。反向对照（本票 AC2）的做法是把已经生成好的那份表里某个块的
 * 规则删掉再量 —— 那样量的是真产物，而且不用为了测试在生产代码里留一条只有测试会走的路。
 */
function sheetFor(i, seed = 7) {
  const v = voiceFor(i);
  const palette = paletteFor(i, seed);
  const surfaces = new Map(Object.keys(SURFACES).map((k) => [k, surfaceFor(k, palette)]));
  const groups = hooksByBlock();
  const out = [];
  let n = 0;
  for (const [block, hooks] of groups) {
    const shape = shapeFor(block, v);
    const s = surfaces.get(v.rhythm[(n + v.phase) % v.rhythm.length]);
    n += 1;
    out.push(rootRule(block, v, s, shape.rootExtra));
    const cols = shape.cols || v.wide;
    // 🔴 #1090 r2 —— 这个判据以前只问「列数变不变」，而 `wideRule` 里同时装着**列数**和**桌面留白**
    //    （#1078 把留白折进来的那一次）。于是一个选了单栏的画法把它所在块族的桌面留白一起弄丢了：
    //    QA2 逐份表数出来 content-split 40 套 / features-grid·values-grid·service-highlights 各 20 套
    //    在交付里没有了 `@media (min-width: 1024px)` 那一段，桌面上用回手机的 gap 与 padding
    //    （1440px 实测 gap 24→16、padding 56/48→40/24）。**列数是这个画法的选择，留白是这个断点的
    //    性质** —— 两件事不该由同一个判据决定。
    // 🔴 判据用的是「这个块族有候选表」这个结构事实（`shapeFor` 里一处设定），不是给三个条目各贴
    //    一个 flag：贴 flag 的话下一个加单栏画法的人漏掉它就又丢一次，而漏掉不会有任何一格报错。
    // 📌 只覆盖本票拥有的两族。hero 也走同一个 `pick()`，但它归 #1065 —— 它那些纯文字画法今天就
    //    没有宽屏那一段，本票不给它加（那会改掉另一张票的产物）。
    if (cols !== '1fr' || shape.keepsWideBreakpoint) out.push(wideRule(block, v, cols, shape.rootExtra));
    for (const hook of hooks) {
      const part = partOf(hook);
      if (!part) continue;
      const roleName = (shape.role || {})[part] || ROLE_BY_PART[part];
      // 🔴 认不出角色的部件**不是跳过**，是拿一份保底样式 —— 跳过等于这个钩子没规则，而那正是
      //    本票要治的东西，且它会静默：表照样生成、准入闸②当场红。保底给的是「一段可读的文字」。
      const make = ROLES[roleName] || ROLES.desc;
      // 这个块的骨架可以给个别部件再补几条（今天只有 hero 用：版式靠 order 分左右上下）。
      const extra = (shape.partExtra || {})[part];
      out.push(declBlock(`.${hook}`, { ...make(v, s), ...(extra ? extra(v, s) : {}) }));
    }
    // #1090 —— 同页节奏那几条（今天只有 content-split 的 `alternate` 会产出）。发在这个块所有部件
    // 规则**之后**，因为它改的就是上面刚写下的 `order`。
    for (const [sel, decls] of (shape.siblingRules ? shape.siblingRules(v, s) : [])) {
      out.push(declBlock(sel, decls));
    }
  }
  return out.join('\n');
}

/**
 * #1090 —— 第 i 套候选的**全部**版式名，一次给全。
 *
 * 🔴 为什么是一个函数回四个键，而不是让 `generate.js` 分别调四个 `*For(i)`：`heroLookFor` 上面写着
 * 「两处各算一遍同一件事就会分叉」，而分叉的样子是「`layout.json` 说 text-only、CSS 画的却是两栏」，
 * 没有任何东西会为此报错。四个键分四次取，就有四次漏掉一个的机会 —— 漏掉的那个不会报错，它会静默
 * 地让相似度闸对那一族失明（`gates.js` 只比两边都有的键）。所以出口只留一个。
 *
 * 📌 `hero` 这个键给的仍然是**内容结构**（`heroLayoutFor` 的值，也就是 `supports.hero` 里那个
 * 字符串），不是 #1065 的外观名 `heroLook` —— 外观不进 `layout.json`，那是 #1065 立的边界。
 */
function layoutNamesFor(i) {
  const v = voiceFor(i);
  return { hero: v.hero, split: v.split, splitRhythm: v.splitRhythm, cards: v.cards };
}

module.exports = {
  sheetFor, voiceFor, hooksByBlock, heroLayoutFor, HERO_LAYOUTS,
  heroLookFor, HERO_LOOKS, HERO_LOOK_NAMES,
  layoutNamesFor, SPLIT_LAYOUTS, SPLIT_RHYTHMS, CARD_GRIDS, CARD_BLOCKS,
  surfaceFor, SURFACES, INK_FLOOR,
};
