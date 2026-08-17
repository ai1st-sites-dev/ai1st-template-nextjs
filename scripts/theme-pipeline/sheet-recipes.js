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
const HERO_LAYOUTS = ['with-media-left', 'with-media-top', 'text-only'];

// 🔴 hero 版式**不是** `i % 3`，而是周期 9 的那个式子 —— 相似度闸把版式当一整项（0.2 的权重），
// 周期 3 时第 i 套与第 i+3 套在这一项上永远满分。字体那一档是 5，所以 3 与 5 的公倍数 15 处
// 「字体 + 版式」同时撞回来（实测：24 套里 gen-07-9 与 gen-07-24 拿到 0.901，刚过 0.9 那条线）。
// 换成周期 9 之后要走到 lcm(5, 9) = 45 才第一次同时撞。
//
// 🔴 这个函数是**唯一**说得出「第 i 套的 hero 是什么版式」的地方：`generate.js` 写进 `layout.json`
// 的那个名字和这份表里 hero 那一块的画法都从它取。分成两处算过一次就会分叉，而分叉的样子是
// 「`layout.json` 说 text-only、CSS 画的却是两栏」—— 没有任何东西会为此报错。
// 📌 式子写成 `(i + floor(i/L)) % L`，周期是 L²（L=3 时 9）。改 HERO_LAYOUTS 的长度不用改这一行。
const heroLayoutFor = (i) => HERO_LAYOUTS[
  (i + Math.floor(i / HERO_LAYOUTS.length)) % HERO_LAYOUTS.length];

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
function voiceFor(i) {
  const radius = ['0.25rem', '0.75rem', '1.25rem', '1.75rem'][i % 4];
  const pad = ['2.5rem', '3rem', '3.5rem', '4rem'][i % 4];
  const rhythm = RHYTHMS[i % RHYTHMS.length];
  return {
    hero: heroLayoutFor(i),
    card: CARD_STYLES[(i + 1) % CARD_STYLES.length],
    // 表面明暗的轮换相位：块按页面顺序深/浅交替，相位一换，整站的节奏就不一样了。
    // 🔴 取 `% 3` 而不是 `% 2`：相位是拿去转 rhythm 那三格的，`% 2` 永远转不到第三格。
    phase: i % 3,
    rhythm,
    radius,
    pillRadius: '9999px',
    pad,
    gap: ['1rem', '1.25rem', '1.5rem', '2rem'][i % 4],
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

const HERO_SHAPES = {
  'with-media-left': {
    cols: '5fr 6fr',
    rootExtra: () => ({ 'align-items': 'center', 'min-height': '34rem' }),
    partExtra: {
      deco: () => ({ order: 1 }),
      media: (v) => ({ order: 2, 'aspect-ratio': '4 / 5', 'max-width': '34rem', 'border-radius': v.radius }),
      body: () => ({ order: 3, 'max-width': '34rem' }),
      title: () => ({ 'font-size': '3.25rem', 'line-height': '1.04' }),
    },
  },
  'with-media-top': {
    // 🔴 宽屏也是**单栏** —— 这一条就是「媒体位在上」跟「媒体位在左」的分界。上一版这里跟 left
    //    拿到同一个 `5fr 6fr`，也就是名字说在上、画出来在左边。
    cols: '1fr',
    rootExtra: (v) => ({
      'align-items': 'start', 'text-align': 'center', 'min-height': '0', padding: `0 0 ${v.pad}`,
    }),
    partExtra: {
      ...CENTERED_INLINE_PARTS,
      media: () => ({ order: 1, width: '100%', height: '16rem', 'aspect-ratio': 'auto', 'border-radius': '0' }),
      deco: () => ({ order: 2, 'max-width': '4rem', 'margin-left': 'auto', 'margin-right': 'auto' }),
      body: () => ({ order: 3, 'max-width': '46rem', 'margin-left': 'auto', 'margin-right': 'auto', 'padding-top': '1.5rem' }),
      title: () => ({ 'font-size': '2.25rem', 'line-height': '1.2', 'text-transform': 'uppercase', 'letter-spacing': '0.02em' }),
    },
  },
  'text-only': {
    cols: '1fr',
    rootExtra: () => ({
      'align-items': 'center', 'justify-items': 'center', 'text-align': 'center', 'min-height': '26rem',
    }),
    partExtra: {
      ...CENTERED_INLINE_PARTS,
      deco: () => ({ order: 1, 'max-width': '5rem', 'margin-left': 'auto', 'margin-right': 'auto' }),
      body: () => ({ order: 2, 'max-width': '48rem', 'margin-left': 'auto', 'margin-right': 'auto' }),
      media: (v) => ({ order: 3, 'aspect-ratio': '21 / 9', width: '100%', 'margin-top': '2rem', 'border-radius': v.radius }),
      title: () => ({ 'font-size': '3.75rem', 'line-height': '1.02' }),
    },
  },
};

// hero 的骨架要按这一套候选的版式取；别的块直接用 SHAPES 里那条。
// 🔴 三个名字必须在 HERO_SHAPES 里都有 —— 落回默认等于又一次「名字说一套、画的是另一套」，
//    所以这里宁可当场炸，也不悄悄拿 with-media-left 顶上。
function shapeFor(block, v) {
  const base = SHAPES[block] || {};
  if (block !== 'hero') return base;
  const hero = HERO_SHAPES[v.hero];
  if (!hero) throw new Error(`hero 版式 ${v.hero} 在 HERO_SHAPES 里没有画法 —— 加版式时两张表要一起加`);
  return {
    ...base,
    cols: hero.cols,
    rootExtra: { ...(base.rootExtra || {}), ...hero.rootExtra(v) },
    partExtra: hero.partExtra,
  };
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

/** 宽屏那条 —— 列数来自这个块自己的骨架，留白同时放大。 */
function wideRule(block, v, cols) {
  return `@media (min-width: 1024px) {\n  ${
    declBlock(`.${block}`, {
      'grid-template-columns': cols,
      gap: `calc(${v.gap} * 1.5)`,
      padding: `calc(${v.pad} * 1.4) 3rem`,
    }).trim().split('\n').join('\n  ')}\n}\n`;
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
    if (cols !== '1fr') out.push(wideRule(block, v, cols));
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
  }
  return out.join('\n');
}

module.exports = {
  sheetFor, voiceFor, hooksByBlock, heroLayoutFor, HERO_LAYOUTS, surfaceFor, SURFACES, INK_FLOOR,
};
