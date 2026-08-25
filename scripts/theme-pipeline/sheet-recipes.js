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

// 卡片组（features-grid / card-group 共用一套候选 —— 它们的部件角色逐字相同
// （`item`/`title`/`desc`），画法不同才是这一族存在的理由）。
const CARD_GRIDS = ['three-up', 'two-up', 'four-up-tight', 'wide-rows'];
const cardGridFor = (i) => CARD_GRIDS[
  (i + Math.floor(i / CARD_GRIDS.length)) % CARD_GRIDS.length];
/** 卡片组这一族是哪几个块 —— 一处定义，`shapeFor` 和覆盖率那格都读它。 */
// 🔴 #1132 —— `card-group` 是通用块（`values-grid` + `benefits-list` 并成的那个），它当然属于这一族。
// 🔴 #1162 —— 名单里原来还有 `values-grid` 和 `service-highlights`，理由是「老站还在吐老类名，
//    那 83 张表得一直匹配得上它」。别名兼容层 2026-08-23 退役之后那个理由没有了：这两个 type 名
//    已经不在注册表里，`theme-css-lint.js` 的 `HOOKS` 也不再认它们的类名 ⟹ 留着它们只会让
//    `shapeFor` 为一族**不会再被生成**的钩子算画法。四个老名字（另两个是 `benefits-list` /
//    `checklist`）在本文件里的条目一律删。
//
// 🔴 `CARD_SHAPES` 的两副在**三条**条目上读出的坐标关系是一样的 —— 这是已经量到的边界，不是猜：
//    `three-up`（三条摆一行）与 `four-up-tight`（四栏里摆三条）占宽落在同一档。#1139 立票时是靠
//    「`benefits-list` 语料下限正好三条」发现的，当时的处置是给它单开一张 `BENEFITS_LOOKS`；
//    本票把那个块退役之后那张表没有成员了（裁定见 #1162），所以 `card-group` 就用这四副。
//    ⟹ 谁要拿真浏览器量「同一族两副画法读出的关系不同」，夹具的条目数必须 **≥4**；三条那一档
//    这两副按构造同形（`tests/e2e/specs/1139-real-site-block-skeletons.spec.ts` 的 `MIN_ITEMS`
//    里 `card-group` 写的是 4，旁边注着这条）。
//    📌 `four-up-tight` 与 `three-up` 的差别**不只是列数**：它还改 `gap`（`--section-block-gap`
//    × (gapStep−2)）和条目的 `padding`（`--section-block-pad` × (padStep−3)），而 `three-up`
//    两个 extra 都是空的 —— 所以在四条条目上它们不是同一副。
const CARD_BLOCKS = ['features-grid', 'card-group'];

// ── #1135 高曝光块的画法候选（第二批）─────────────────────────────────────────────────────────────
//
// Chris 2026-08-20 终审对比页上点名：hero 五副骨架、卡片组五种，而 **Ready to get started
// （cta-banner）和 Contact us（contact-form）五套长得基本一样**，只差底色和按钮。#1090 的验收口径是
// 「同一块的 CSS 规则逐字不同」，而这两块的字节差全在数值上 ⟹ 字节不同、观感相同。
//
// 🔴 **光给候选写 `cols` 改不动任何东西**（#1135 立票时 PM 量的）：`grid-column: 1 / -1` 来自 role 层
//    （`ROLES.headline` / `display` / `lede` 三个都写它），不是块自己的条目。所以今天这两块声明了两栏
//    而零件全跨满，第二栏**永远空着** —— 声明的列数一栏都没用上。要真的分栏，候选必须在 `partExtra`
//    里把那个 `grid-column` 覆写掉。
//
// 🔴 **覆写只许写 `auto` 或 `1 / -1`，不许写 `2 / 3` 这种显式落位。** 部件规则是**基础规则**，不在
//    `@media (min-width: 1024px)` 里（那个媒体查询只由 `wideRule` 产出，它只发块根那一条）；而基础
//    规则里的网格是 `grid-template-columns: 1fr` 单栏（`rootRule`）。往单栏网格里写 `grid-column: 2 / 3`
//    会**长出一条隐式列**，手机上那个零件被甩到右边去 —— 而桌面上看着是对的，所以这种错在图册上
//    看不见。`auto` 让零件按流排布（桌面两栏时自然落到第二栏），`1 / -1` 是跨满，两个在单栏下都无害。
//    hero 那一族绕开了这件事：它只用 `order`，从不动 `grid-column`。
//
// 🔴 分布式子与 hero / content-split / 卡片组同形（`(i + floor(i/L)) % L`），**但模数必须避开已被占的**：
//    今天 `SPLIT_LAYOUTS` 和 `CARD_GRIDS` 都是 4、`CARD_STYLES` 是 3，而同式同模 ⟹ 两族的档**完全
//    互相决定**（实测：split 档 == cards 档，80/80 套一个不差 —— 这是本票之前就有的，不是这里引入的）。
//    所以这两族取 5 和 6：那是 3..6 里唯一一对既不撞已占模数、彼此也不互相决定的。判据不是「所有组合
//    都出现」（80 套装不下 hero8 × form6 的 48 种全部组合），而是**没有哪一族决定另一族** ——
//    每一档下对方至少还有 2 种取值。七对逐对量过（`sheet-recipes.test.js` ⑨ 钉住它）。
const CTA_LOOKS = {
  // ① 左对齐横带 —— 今天全池那一副骨架，留作候选之一。
  'band-left': {
    cols: '1fr',
    rootExtra: () => ({ 'align-items': 'start' }),
    partExtra: {},
  },
  // ② 居中横带
  'band-center': {
    cols: '1fr',
    rootExtra: () => ({ 'align-items': 'center', 'justify-items': 'center', 'text-align': 'center' }),
    partExtra: {
      // 🔴 带 `max-width` 的每一处都要配 auto 外边距 —— `sheet-recipes.test.js` ④ 那道不变量：
      //    「哪个容器声明了居中，它同一个块里那些不受 text-align 管的东西就得被摆正」。
      //    我第一版只给 desc 配了，headline 漏了，那一格当场点名（80 套里 27 套）。
      headline: () => ({ 'max-width': '44rem', 'margin-left': 'auto', 'margin-right': 'auto' }),
      desc: () => ({ 'max-width': '38rem', 'margin-left': 'auto', 'margin-right': 'auto' }),
      action: () => ({ 'justify-content': 'center' }),
    },
  },
  // ③ 文左钮右 —— 标题占满上面一行，说明和按钮在**同一行**分左右。
  //    `desc` / `action` 都改成 `auto`：桌面两栏时它们各落一栏，手机上仍然是上下两块。
  'text-left-action-right': {
    cols: '2fr 1fr',
    rootExtra: () => ({ 'align-items': 'center' }),
    partExtra: {
      desc: () => ({ 'grid-column': 'auto', 'max-width': '40rem', 'margin-top': '0' }),
      action: () => ({ 'grid-column': 'auto', 'justify-content': 'flex-end', 'align-self': 'center' }),
    },
  },
  // ④ 标题在侧 —— 标题和说明在同一行分左右，按钮自己占满下面一行。
  'title-side': {
    cols: '1fr 2fr',
    rootExtra: () => ({ 'align-items': 'start' }),
    partExtra: {
      headline: () => ({ 'grid-column': 'auto', 'align-self': 'start' }),
      desc: () => ({ 'grid-column': 'auto', 'margin-top': '0', 'max-width': '44rem' }),
      action: () => ({ 'grid-column': '1 / -1' }),
    },
  },
  // ⑤ 按钮在前 —— 按钮排在文字**上面**（`order`，跟 hero 那一族同一个手法）。
  'action-first': {
    cols: '1fr',
    rootExtra: () => ({ 'align-items': 'start' }),
    partExtra: {
      action: () => ({ order: 1 }),
      headline: () => ({ order: 2 }),
      desc: () => ({ order: 3, 'margin-top': '0.5rem' }),
    },
  },
};

const FORM_LOOKS = {
  // ① 表单在下 —— 今天全池那一副骨架。
  'panel-below': {
    cols: '1fr',
    rootExtra: () => ({ 'align-items': 'start' }),
    partExtra: {},
  },
  // ② 表单在右 —— 说明和表单同一行分左右。
  'panel-right': {
    cols: '1fr 1fr',
    rootExtra: () => ({ 'align-items': 'start' }),
    partExtra: {
      intro: () => ({ 'grid-column': 'auto', 'max-width': '32rem' }),
      form: () => ({ 'grid-column': 'auto' }),
    },
  },
  // ③ 表单在左 —— 同 ② 但左右调过来（`order`，不是显式落位）。
  //
  // 🔴 `note` 这一行是**承重的**，别当成多余（#1135 r2 —— QA1/QA2/QA3 三个人抓到、PM 判成本票圈内）：
  //    `order` 的默认值是 0，而这里只给 form(1) / intro(2) 写了 order ⟹ 那行细则小字（order 0）
  //    排在**它们两个前面**，于是左栏第一格是小字、表单被挤到右栏、lede 掉到第三行，左边空一大块。
  //    后果两条：① 桌面上主读跟 `panel-right` 一样（表单都在右边）—— 而这张票的立票原话正是
  //    「为什么这几块长得很一样」；② 手机上顺序变成 heading → note → form → intro。
  //    命中 14/80 套。给它一个比那两个都大的 order，这一支才真的是 `panel-right` 的镜像。
  //    这条性质对**每一种** form 画法都要成立，`sheet-recipes.test.js` ⑪ 把它钉成了守卫。
  //    🔴 #1134 —— 这里原来跟着一句「加第 7 个候选的人不需要记得这件事」，那句话**说错了 ⑪ 守的是
  //    什么**：第 7 个候选根本走不到 ⑪，它先被 ⑨ 的 15% 地板拦住（`sheet-recipes.test.js` ⑨ 的反向
  //    对照自己打出这个读数：「同一条式子取 7 档时最小档 13.8% < 15% ⟹ 这一格真的会因为候选太多
  //    而红」）。⟹ ⑪ **独占**守的是另一件事：**有人改了现有 6 种里某一种的 order**（它的阳性对照 A
  //    摘掉 panel-left 这一行、阳性对照 B 把 note 在源码里往上搬，量的都是这个）。
  //    区别不是文字游戏：照原话读，加画法的人会以为「⑪ 兜着我」，而真正兜他的是 ⑨，且 ⑨ 是**拦住**
  //    他而不是替他补 order —— 他必须先重算那个地板。（`keepsWideBreakpoint` 那条的「不需要记得」
  //    仍然成立，它讲的是**默认值自动有**这个机制，不是守卫的射程。）
  'panel-left': {
    cols: '1fr 1fr',
    rootExtra: () => ({ 'align-items': 'start' }),
    partExtra: {
      form: () => ({ 'grid-column': 'auto', order: 1 }),
      intro: () => ({ 'grid-column': 'auto', order: 2, 'max-width': '32rem' }),
      note: () => ({ order: 3 }),
    },
  },
  // ④ 居中窄栏
  'centered-narrow': {
    cols: '1fr',
    rootExtra: () => ({ 'align-items': 'center', 'justify-items': 'center', 'text-align': 'center' }),
    partExtra: {
      // 同 `band-center`：每一处 `max-width` 都配 auto 外边距（④ 那道不变量）。
      heading: () => ({ 'max-width': '40rem', 'margin-left': 'auto', 'margin-right': 'auto' }),
      intro: () => ({ 'max-width': '34rem', 'margin-left': 'auto', 'margin-right': 'auto' }),
      form: () => ({ 'max-width': '34rem', width: '100%', 'text-align': 'left', 'margin-left': 'auto', 'margin-right': 'auto' }),
      note: () => ({ 'max-width': '34rem', 'margin-left': 'auto', 'margin-right': 'auto' }),
    },
  },
  // ⑤ 标题在侧 —— 标题和说明分左右，表单占满下面一行。
  'heading-side': {
    cols: '1fr 2fr',
    rootExtra: () => ({ 'align-items': 'start' }),
    partExtra: {
      heading: () => ({ 'grid-column': 'auto', 'align-self': 'start' }),
      intro: () => ({ 'grid-column': 'auto', 'margin-top': '0' }),
      form: () => ({ 'grid-column': '1 / -1' }),
    },
  },
  // ⑥ 表单占大半、附注在侧 —— 表单和那行小字同一行分左右。
  'note-beside': {
    cols: '2fr 1fr',
    rootExtra: () => ({ 'align-items': 'start' }),
    partExtra: {
      form: () => ({ 'grid-column': 'auto' }),
      note: () => ({ 'grid-column': 'auto', 'align-self': 'start', 'max-width': '22rem' }),
    },
  },
};

const CTA_LOOK_NAMES = Object.keys(CTA_LOOKS);
const FORM_LOOK_NAMES = Object.keys(FORM_LOOKS);
const ctaLookFor = (i) => CTA_LOOK_NAMES[
  (i + Math.floor(i / CTA_LOOK_NAMES.length)) % CTA_LOOK_NAMES.length];
const formLookFor = (i) => FORM_LOOK_NAMES[
  (i + Math.floor(i / FORM_LOOK_NAMES.length)) % FORM_LOOK_NAMES.length];

// ── #1139 真站上露面最多的六个块，第三批画法候选 ─────────────────────────────────────────────────
//
// #1135 收官时全池 80 套里仍然只有一副骨架的块有 27 个（35 个契约块 − 8 个已有候选表的）。按本机
// 历次真跑 create-site 留下的站数出来的露面次数（66 个互异站 / 705 页，服务子页要递归读进去），
// 前八名去掉两个另有判据的（`service-related-pages` 按设计在没有子页时不渲染 · `divider` 的部件
// 少到分不出骨架），剩下的就是这六个。那个唯一的第三方付费客户站（德馨金融 · 14 页）上前六名同向。
//
// 🔴 三条约束是本票立票时量出来的，不是设计口味：
//   ① **判据是几何观感，不是 CSS 字节。** 承 #1135 —— 只把间距倍数或颜色换一下，字节确实不同而
//      眼睛看不出来。所以每一副骨架都要在「零件之间的坐标关系」上跟同族的其他副不同（真浏览器里
//      量，见 `tests/e2e/specs/1139-real-site-block-skeletons.spec.ts`）。
//   ② **差别要在真站真有的条目数上就看得出来。** 语料里的条目数下限：`process-steps` /
//      `benefits-list` / `faq-accordion` 最少 3 条、`testimonials` 最少 2 条。所以不许靠「条目多到
//      第四列才出现」这种方式分骨架 —— 那在真站上永远塌成同一副。
//      🔴 #1162 例外一处，而且是**明写的**：`benefits-list` 退役并入 `card-group` 之后，那把尺量的
//         是 `card-group`，而它用 `CARD_SHAPES` 的四副 —— `three-up` 与 `four-up-tight` 在**三条**
//         条目上按构造同形（边界写在 `CARD_BLOCKS` 定义旁边）。所以那一格的夹具给 4 条，比语料下限
//         多一条。这是**这一族的已知边界**，不是把 ② 放宽：其余五族仍然压在下限上，而 `card-group`
//         那一格照旧要求「画法不同 ⟹ 坐标关系不同 + 画法相同 ⟹ 坐标关系相同」两向都成立。
//   ③ **`contact-info` 不许靠列数分。** 它的卡片来自 `brand.locations`，而本机 75 份互异
//      `brand.json` 全部只有 1 个地点（75/75）⟹ 真站上它永远只渲染 1 张卡，「1 栏 / 2 栏 / 3 栏」
//      在每个站上长得一模一样。它的骨架差别在**卡片内部**（`label` / `address` / `phone` 之间的
//      坐标关系），另外顺带让 `.contact-info__email` 相对那张卡片的位置也不同 —— 它是 `<section>`
//      的直接子节点、不在卡片里（`ContactInfoSection.tsx:65` vs `:57`），正文 AC1 那句把它算进
//      卡片里了。
//
// 🔴 **档的分布式子跟前两批同形，但【错开的步长不再等于候选数】。** 前两批用的是
//    `(i + floor(i/L)) % L`；六族里四族的候选数是 4、两族是 3，而 4 已经被 `split` / `cards` 占了、
//    3 已经被 `CARD_STYLES` 占了 —— 同式同模的两族会**完全互相决定**（`split` 与 `cards` 今天就是
//    这样，80/80 套一个不差）。把 floor 里的步长单独拿出来当参数就解开了：本批六族取
//    m = 2 / 10 / 12 / 16 / 3 / 4，是搜出来的一组，判据与逐对读数由 `sheet-recipes.test.js` ⑨ 钉住。

/**
 * 第 i 套候选在某一族里挑哪一副骨架。
 *
 * `m` 是**错开的步长**，跟候选数 `names.length` 无关。为什么需要它：单纯 `i % L` 会让第 i 套与
 * 第 i+L 套在相似度那道闸的 `layout` 一项上永远同值（那一项占 0.2 的权重，`gates.js` 的
 * `WEIGHTS`），所以要加一个 floor 项把它顶开；而 floor 里如果照抄 L，两个候选数相同的族就会
 * **完全互相决定**（每一档下对方只剩一种取值）。取不同的 m 就把它们解开，同时候选数还能自由选。
 */
const lookFor = (names, m) => (i) => names[(i + Math.floor(i / m)) % names.length];

// ── page-header（语料里 602 个实例 · 65/66 个站 · 真客户站 13 次 —— 露面最多的块）────────────────
//
// 🔴 它**没有条目列表**，所以骨架的差别是「哪几个部件在场、它们怎么摆」：面包屑
//    （`PageHeaderSection.tsx:63`，条件渲染）· 标题（`:79`，恒有）· 副标题（`:80`，条件渲染）。
//    602 个实例里 100 个（17%）没有面包屑 ⟹ **不许主要靠面包屑的位置区分**，那样在这 100 页上
//    四副会塌成同一副。下面四副在「把面包屑去掉」之后仍然两两不同（AC1c，spec 里有一格量它）。
const HEADER_LOOKS = {
  // ① 左对齐堆叠 —— 今天全池那一副骨架，留作候选之一（同 `CTA_LOOKS` 的 `band-left`）。
  //    `rootExtra` 空着是**故意的**：这一副的产物要跟本票之前逐字节相同，反向对照才有一个已知的锚。
  'stack-left': { cols: '1fr', rootExtra: () => ({}), partExtra: {} },
  // ② 居中 —— 标题和副标题都收窄居中。
  centered: {
    cols: '1fr',
    rootExtra: () => ({ 'justify-items': 'center', 'text-align': 'center' }),
    partExtra: {
      // 🔴 每一处 `max-width` 都要配 auto 外边距 —— `sheet-recipes.test.js` ④ 那道不变量：
      //    `text-align` 只管行内内容，带 `max-width` 的块级元素的位置由外边距定。
      title: () => ({ 'max-width': '48rem', 'margin-left': 'auto', 'margin-right': 'auto' }),
      sub: () => ({ 'max-width': '34rem', 'margin-left': 'auto', 'margin-right': 'auto' }),
    },
  },
  // ③ 标题在侧 —— 标题和副标题在**同一行**分左右，面包屑占满上面一行。
  //    🔴 面包屑必须显式写 `1 / -1`：`crumbs` 这个角色自己不写 `grid-column`（不像 `display` /
  //    `lede`），两栏下它会被自动流塞进第一格、把标题挤到第二格去。
  'title-side': {
    cols: '2fr 1fr',
    rootExtra: () => ({ 'align-items': 'end' }),
    partExtra: {
      crumbs: () => ({ 'grid-column': '1 / -1' }),
      title: () => ({ 'grid-column': 'auto' }),
      sub: () => ({ 'grid-column': 'auto', 'margin-top': '0', 'max-width': '26rem' }),
    },
  },
  // ④ 副标题在上 —— 副标题当眉题排在标题前面。
  //    🔴 三个部件**都**要写 `order`（同 `FORM_LOOKS` 的 `panel-left` 那条）：`order` 默认 0，
  //    只给两个写就会让没写的那个跑到最前面。
  'kicker-above': {
    cols: '1fr',
    rootExtra: () => ({ 'align-items': 'start' }),
    partExtra: {
      crumbs: () => ({ order: 1 }),
      sub: () => ({ order: 2, 'margin-top': '0' }),
      title: () => ({ order: 3 }),
    },
  },
};

// ── faq-accordion（328 个实例 · 58/66 个站 · 真客户站 8 次；essential 块）───────────────────────
//
// 🔴 条目是 `<details>`，而答案（`.faq-accordion__answer`）在**收起状态下根本不渲染**
//    （`FaqAccordionSection.tsx:97-99` —— `<summary>` 之外的子节点由浏览器自己藏起来）。所以这一族
//    的骨架差别一律落在**块这一层**和条目自己的宽度上，不靠 question / answer 的相对位置 ——
//    靠它的话，在没有 `defaultOpen` 的页面上四副全塌。
const FAQ_LOOKS = {
  // ① 单栏堆叠 —— 今天全池那一副。
  stack: { cols: '1fr', rootExtra: () => ({}), partExtra: {} },
  // ② 两栏问答 —— 标题和引言占满，条目两个一行。
  'two-column': { cols: '1fr 1fr', rootExtra: () => ({ 'align-items': 'start' }), partExtra: {} },
  // ③ 标题在侧 —— 标题和引言同一行分左右，条目占满下面各行。
  'heading-side': {
    cols: '1fr 2fr',
    rootExtra: () => ({ 'align-items': 'start' }),
    partExtra: {
      headline: () => ({ 'grid-column': 'auto', 'align-self': 'start' }),
      sub: () => ({ 'grid-column': 'auto', 'margin-top': '0' }),
      item: () => ({ 'grid-column': '1 / -1' }),
    },
  },
  // ④ 居中窄栏 —— 条目本身收窄居中，但条目里的字仍然靠左（一段问答居中读起来很累）。
  centered: {
    cols: '1fr',
    rootExtra: () => ({ 'justify-items': 'center', 'text-align': 'center' }),
    partExtra: {
      headline: () => ({ 'max-width': '44rem', 'margin-left': 'auto', 'margin-right': 'auto' }),
      sub: () => ({ 'max-width': '34rem', 'margin-left': 'auto', 'margin-right': 'auto' }),
      item: () => ({
        width: '100%', 'max-width': '48rem', 'margin-left': 'auto', 'margin-right': 'auto', 'text-align': 'left',
      }),
    },
  },
};

// ── process-steps（166 个实例 · 56/66 个站 · 真客户站 4 次）──────────────────────────────────────
//
// 📌 前两副就是今天那两种长相：这个块在 `SHAPES` 里没写 `cols`，桌面列数落到 `voiceFor` 的
//    `v.wide`（按 `i % 2` 在 3 栏 / 2 栏之间转）。本表把那一维收进自己手里 —— 于是列数由这个块
//    自己的骨架决定，而不是跟全站别的无候选块一起转。
const STEPS_LOOKS = {
  // ① 三个一行（= 今天 `v.wide` 的 `1fr 1fr 1fr` 那一档）
  'three-up': { cols: '1fr 1fr 1fr', rootExtra: () => ({}), partExtra: {} },
  // ② 两个一行（= 今天 `v.wide` 的 `1fr 1fr` 那一档）
  'two-up': { cols: '1fr 1fr', rootExtra: () => ({}), partExtra: {} },
  // ③ 编号在侧的长条 —— 一行一步；编号占左边一整格，标题和说明在它右边上下排。
  //    🔴 编号那条 `grid-row` 是**卡片内部**的落位，跟块根那条 🔴（只许 `auto` 或 `1 / -1`）不冲突：
  //    卡片自己的两栏网格就写在同一条基础规则里（下面 `step` 那行），所以窄屏上它也是两栏，
  //    不会长出隐式列。
  'numbered-rail': {
    cols: '1fr',
    rootExtra: () => ({ 'align-items': 'start' }),
    partExtra: {
      step: () => ({ 'grid-template-columns': 'auto 1fr', 'align-items': 'start', gap: '0.4rem 1.25rem' }),
      num: () => ({ 'grid-row': '1 / 3' }),
    },
  },
  // ④ 标题在侧 —— 标题和引言同一行分左右，步骤占满下面各行。
  'heading-side': {
    cols: '1fr 2fr',
    rootExtra: () => ({ 'align-items': 'start' }),
    partExtra: {
      headline: () => ({ 'grid-column': 'auto', 'align-self': 'start' }),
      sub: () => ({ 'grid-column': 'auto', 'margin-top': '0' }),
      step: () => ({ 'grid-column': '1 / -1' }),
    },
  },
};

// ── benefits-list 那张 `BENEFITS_LOOKS` 已退役（#1162，2026-08-23）─────────────────────────────
//
// #1139 给它单开一张三副的表，理由是量出来的：`CARD_SHAPES` 的 `three-up` 与 `four-up-tight` 在
// **三条**条目上读出的坐标关系一模一样（三条摆一行 vs 四栏里摆三条，占宽落在同一档），而
// `benefits-list` 在语料里的条目数下限正好是 3 ⟹ 复用 `CARD_SHAPES` 会让那一格塌成两副。
//
// 🔴 本票把 `benefits-list` 这个 type 名整个退役（并入 `card-group`），所以这一族**没有成员了**。
//    `benefitsLook` 名下只有它一个块（原 `LOOK_FAMILIES` 那一行），块没了整族就是空的。
//    两条修法里选的是「退役这张表」而不是「把 `card-group` 挪过来继承它」：后者会把候选从四副减到
//    三副，并且改掉 `card-group` 在 83 套主题里的长相 —— 而 `card-group` 的长相不是本票要动的东西。
//    上面那条量到的边界（三条时两副同形）搬到了 `CARD_BLOCKS` 的定义旁边，`card-group` 今天用的
//    就是那四副。
//

// ── contact-info（138 个实例 · 57/66 个站 · 真客户站 1 次；essential 块）─────────────────────────
//
// 🔴 见上面那条 ③：真站上永远只有 1 张卡，所以三副骨架在**卡片内部**分。
//    `.contact-info__email` 是 `<section>` 的直接子节点（`:65`），不在卡片里 —— 顺带让它相对卡片的
//    位置也跟着变，这样「`label` / `address` / `phone` / `email` 之间的坐标关系」两种读法都不缺。
// 📌 ① 的 `rootExtra` / `partExtra` 都空着：这一副的产物跟本票之前逐字节相同。
const INFO_LOOKS = {
  // ① 卡片在左、邮箱在右 —— 今天全池那一副（两栏，卡片和邮箱同一行）。
  'card-then-email': { cols: '1fr 1fr', rootExtra: () => ({}), partExtra: {} },
  // ② 地点名在侧 —— 卡片内部分两栏：地点名占左边一整格，地址和电话在右边上下排；邮箱落到卡片下面。
  'label-side': {
    cols: '1fr',
    rootExtra: () => ({}),
    partExtra: {
      location: () => ({ 'grid-template-columns': 'auto 1fr', 'align-items': 'baseline', gap: '0.35rem 1.5rem' }),
      label: () => ({ 'grid-row': '1 / 3' }),
    },
  },
  // ③ 电话在前 —— 卡片内部把电话排到最上面，邮箱排到卡片上面。
  //    🔴 卡片里三个部件**都**写 `order`、块里那两个也都写（同 `panel-left` 那条：`order` 默认 0，
  //    只写一部分会让没写的那个跑到最前面）。
  'phone-first': {
    cols: '1fr 1fr',
    rootExtra: () => ({}),
    partExtra: {
      email: () => ({ order: 1 }),
      location: () => ({ order: 2 }),
      phone: () => ({ order: 1 }),
      label: () => ({ order: 2 }),
      address: () => ({ order: 3 }),
    },
  },
};

// ── testimonials（108 个实例 · 58/66 个站 · 真客户站 2 次）───────────────────────────────────────
//
// 📌 前两副同 `process-steps`：今天这个块的桌面列数也来自 `v.wide`。
const TESTIMONIAL_LOOKS = {
  // ① 三个一行（= 今天 `v.wide` 的 `1fr 1fr 1fr` 那一档）
  'three-up': { cols: '1fr 1fr 1fr', rootExtra: () => ({}), partExtra: {} },
  // ② 两个一行（= 今天 `v.wide` 的 `1fr 1fr` 那一档）
  'two-up': { cols: '1fr 1fr', rootExtra: () => ({}), partExtra: {} },
  // ③ 引语在左、评分和署名在右 —— 一行一条，卡片横过来。
  //    卡片里五个部件（rating / quote / name / meta / service，`TestimonialsSection.tsx:73-85`），
  //    引语占左栏竖着跨满，其余四个顺着排在右栏 —— 所以 `grid-row` 是 `1 / 5`。
  'quote-rail': {
    cols: '1fr',
    rootExtra: () => ({}),
    partExtra: {
      item: () => ({ 'grid-template-columns': '2fr 1fr', 'align-items': 'start', gap: '0.5rem 2rem' }),
      quote: () => ({ 'grid-column': '1', 'grid-row': '1 / 5' }),
    },
  },
  // ④ 署名在前 —— 卡片内部把名字和身份排到引语上面（五个部件都写 `order`）。
  'attribution-first': {
    cols: '1fr 1fr',
    rootExtra: () => ({}),
    partExtra: {
      name: () => ({ order: 1 }),
      meta: () => ({ order: 2 }),
      rating: () => ({ order: 3 }),
      quote: () => ({ order: 4 }),
      service: () => ({ order: 5 }),
    },
  },
};

// ── #1190 —— 实验钉：一套候选，把 testimonials 画成一条能滑而且停得住的横条 ─────────────────────
//
// 🔴 **它住在 `TESTIMONIAL_LOOKS` 外面，这是 PM 2026-08-25 的裁定，理由是量出来的**：
//   · 往那张表里加第 5 副画法 ⟹ 97 套里画法档变掉 **75** 套（分布 20/19/20/19/19，最小档 19.6%，
//     所以拦住它的**不是**那条 15% 地板）。那 97 张是**在售**的表，客户站重建就跟着变 —— 75 个站的
//     客户评价段换个排法，是产品决定，不该当成一张实证票的副作用。
//   · 而且 `sheet-recipes.test.js` 第 ⑨ 格会当场红：它的判据是 `d.archs !== r.L`（`L` =
//     `Object.keys(f.table).length`），加了第 5 个键而挑法仍走 4 个名字 ⟹ 报「5 种候选里只轮到 4 种」。
//
// 🔴 **这跟本流水线「用分布不用 flag」那条纪律不冲突，因为它们回答的不是同一个问题**：分布回答
//    「97 套怎么各不相同」，而这张票问的是「拿一套试穿」。一个实验要的就是**一个**受试者，而分布这种
//    机制按构造说不出「恰好一个」。所以照实写成一条**明写的实验钉**：一个候选号、一句 CSS 注释，
//    外加 `sheet-recipes.test.js` 一格断言「命中的候选恰好 1 个」。
//    📌 将来它要转正成一副真画法，是另一张票的事 —— 那时才付「重新分布 75 套」那笔账。
//
// 🔴 **候选号是 27（`gen-07-28` = `lime-28`），挑它的判据写在这里，别随手换**：① 它的
//    `testimonialLook` 是 `three-up`（最朴素那一副，覆盖起来最干净）；② 全仓 grep 它 **0 命中**
//    —— `tests/e2e/specs/1139-real-site-block-skeletons.spec.ts` 把 i=0…4 那五套的骨架逐块钉死了，
//    钉在它们身上会把那一格弄红，而 `lime-28` 不在任何一格的射程里。
//
// 🔴 **`overflow-x` 而不是 `overflow`**：只开横轴。竖轴留给块自己（`globals.css` 的
//    `.testimonials { overflow: hidden }`）。
// 🔴 **`display: flex` 这一行不是可选的**：这一层的默认是 `globals.css` 里的 `display: contents`，
//    而 `overflow-x` 写在一个没有盒子的元素上什么都不会发生。改 `display` 的活只能由表来做。
const SCROLL_STRIP_EXPERIMENT = {
  candidate: 27,
  block: 'testimonials',
  note: '#1190 experiment pin — the one sheet in the pool that draws testimonials as a slide-able strip',
  // `v` 是这套候选的 voice：gap 跟着这套主题自己的节奏走，不另起一个数。
  rules: (v) => [
    ['[data-block-part="testimonials-list"]', {
      display: 'flex',
      // 桌面上块根是多栏网格（`wideRule`），不跨满的话这一层只占第一栏。
      'grid-column': '1 / -1',
      gap: v.gap,
      'overflow-x': 'auto',
      'scroll-snap-type': 'x mandatory',
    }],
    ['.testimonials__item', {
      'flex-shrink': 0,
      // 窄屏：一张卡占满一屏还露出下一张的一角。
      // 🔴 这里是**百分比**而不是 `20rem`，而这一条是被 QA2 在真机上逼出来的（#1190 r2）：定长卡
      //    的宽度不跟着容器走，于是屏一窄它就比容器还宽 —— r1 交付的 `min-width: 20rem` 在 320 /
      //    344 / 360px 三档手机上**开页时第一张卡就是被裁的**（实测各裁 48 / 24 / 8px；375 才刚好
      //    完整，只剩 7px 余量）。r1 那句注释「手机上块的内容宽 ≈ 327px 实测」量的是 375 那一档，
      //    而它下面还有三档。写成 `%` 之后卡宽是容器可视宽的一个真分数 ⟹ **任何宽度**上首项都完整，
      //    这是按构造成立的，不是在几个抽样宽度上碰巧成立。
      'min-width': '80%',
      'scroll-snap-align': 'start',
    }],
  ],
  // 🔴 桌面那一段不是装饰，它是「这条横条在任何屏上都真的是一条横条」的那一半，而且这一条是被
  //    读数逼出来的：只写 `min-width: 20rem` 时，1440px 上块的内容宽是 1344，三张 320 的卡加两个
  //    间隙才 1024 ⟹ `scrollWidth === clientWidth`，**根本没得滑**，而「设成 100 静止后读到 0」在
  //    那种页面上是恒真的 —— 一个读起来像交付了的假绿。
  // 📌 用**百分比**而不是又一个 rem：卡宽跟着容器走，于是 3 张卡按构造就是 126%+，在 1440、1920、
  //    任何桌面宽度上都溢出。部件不受 §2 那条「块上的长度只许一个方向」管（那条只管块和区域的钩
  //    子），所以这里写 `%` 是合法的 —— 交付时逐条 lint 过。
  wide: () => [
    ['.testimonials__item', { 'min-width': '42%' }],
  ],
};

// #1139 那批各自的档位。**这里是唯一说得出「第 i 套是哪一副」的地方**（同 hero / split / cards /
// cta / form 那几行的纪律）：名字表就是那张画法表自己的键，不另抄一份清单。
// 🔴 m（错开的步长）是搜出来的，不是随手取的 —— 判据是「跟已有的每一族、以及本批彼此，都不互相
//    决定（每一档下对方至少还有 2 种取值）」，而且每一档的池内占比 ≥15%（AC2）。实测那一组：
//    候选数 4 的三族分布都是 20/20/20/20（最小档 25.0%），候选数 3 的两族是 27/26/27（32.5%）。
// 📌 #1139 当时是**六族**；`benefitsLook` 随 `benefits-list` 这个 type 名一起退役（#1162），
//    所以现在是五族。上面那句「候选数 3 的两族」说的是 #1139 当天的读数，留作出处 ——
//    候选数 3 的族今天只剩 `infoLook` 一个（另一个就是退役掉的 `benefitsLook`）—— 现读：
//    `node -e "require('./scripts/theme-pipeline/sheet-recipes.js').LOOK_FAMILIES.forEach(f=>console.log(f.key,Object.keys(f.table).length))"`
const HEADER_LOOK_NAMES = Object.keys(HEADER_LOOKS);
const FAQ_LOOK_NAMES = Object.keys(FAQ_LOOKS);
const STEPS_LOOK_NAMES = Object.keys(STEPS_LOOKS);
const INFO_LOOK_NAMES = Object.keys(INFO_LOOKS);
const TESTIMONIAL_LOOK_NAMES = Object.keys(TESTIMONIAL_LOOKS);
const headerLookFor = lookFor(HEADER_LOOK_NAMES, 2);
const faqLookFor = lookFor(FAQ_LOOK_NAMES, 10);
const stepsLookFor = lookFor(STEPS_LOOK_NAMES, 12);
const testimonialLookFor = lookFor(TESTIMONIAL_LOOK_NAMES, 16);
const infoLookFor = lookFor(INFO_LOOK_NAMES, 4);

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
    // #1135 —— 高曝光那两块的画法档。同上：**这里是唯一说得出「第 i 套是哪一种」的地方**。
    //    模数 5 / 6 是量出来的，不是随手取的（理由整段在 CTA_LOOKS 上面那条 🔴）。
    ctaLook: ctaLookFor(i),
    formLook: formLookFor(i),
    // #1139 —— 真站上露面最多那六块的画法档。同上一条纪律：这里是唯一的出口。
    //    这六族的「错开步长」m 各不相同，而且都不等于自己的候选数 —— 理由整段在 HEADER_LOOKS
    //    上面那条 🔴（同式同模的两族会完全互相决定）。
    headerLook: headerLookFor(i),
    faqLook: faqLookFor(i),
    stepsLook: stepsLookFor(i),
    infoLook: infoLookFor(i),
    testimonialLook: testimonialLookFor(i),
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
  // #1150 —— `form-error` 走 `error`，跟 `contact-form` / `quote-form` 那两条同一个角色：三处的
  // 错误框因此是**同一段代码**画出来的（`ROLES.error`），不是照抄三遍。`form` 本身不写在这里，
  // 它走 `ROLE_BY_PART` 的 `panel`（#1065 立的）。
  // 🔴 #1158 —— `form-success` 同理走 `success`（跟 `contact-form` / `quote-form` 的 `success` 一条）。
  //    **必须显式写在这里**：`ROLE_BY_PART` 里有 `success` 这个键，但没有 `form-success` 这个键，
  //    落回去拿到的是保底的 `desc` —— 那是一段普通段落，没有底色也没有内距，而这一句是回执。
  //    （同一个坑 `form-error` 已经踩过一次：那一条也是显式写的，理由逐字相同。）
  hero: {
    cols: '5fr 6fr', rootExtra: { 'align-items': 'center' },
    role: { media: 'media', body: 'column', title: 'display', sub: 'lede', cta: 'actions', deco: 'deco', 'form-error': 'error', 'form-success': 'success' },
  },
  'cta-banner': { cols: '2fr 1fr', rootExtra: { 'align-items': 'center' }, role: { headline: 'display', desc: 'lede', action: 'actions' } },
  'page-header': { cols: '1fr', role: { crumbs: 'crumbs', title: 'display', sub: 'lede' } },
  'contact-form': {
    cols: '1fr 1fr',
    role: { heading: 'headline', intro: 'lede', form: 'panel', error: 'error', success: 'success', note: 'fineprint' },
    // 🔴 #1135 —— **成功那条**状态消息一律跨满整宽，写在**块这一层**而不是每个候选里。
    //    `pick()` 先摊 `base.partExtra`、再摊候选自己的，所以候选想覆写还是覆写得了，而**不写就
    //    自动有** —— 加第 7 个候选的人不需要记得任何事（同 `keepsWideBreakpoint` 那条的理由）。
    //    为什么必须有：它是**条件渲染**的（`ContactFormSection.tsx` 的成功分支），静态产物里没有
    //    它 ⟹ 本票那几个多栏候选按构造从来没在它在场时被量过。真量了一次（hydration 之后插进
    //    DOM 再读几何）：`panel-right` 那一支上它只占 45% 宽，被自动流塞进了侧栏 —— 一条
    //    「已经收到了」的话不该长成侧边栏。修完 93%（QA2 在真机上复量的读数）。
    //
    // 🔴 **`error` 那一条今天是恒等式，留着是保险，不许把它当成一个已经守住的几何性质**
    //    （#1135 r2 —— QA2 发现、QA3 从源码裁定、PM 独立坐实）：`contact-form__error` 是
    //    `<form className="contact-form__form">` 的**子节点**，而那个 form 自己是**单栏** grid
    //    （`ROLES.panel` 只写 `display: grid`，池里 80 份表 `.contact-form__form` 里出现
    //    `grid-template-columns` 的是 **0** 份）⟹ 给它写 `grid-column: 1 / -1` 跟不写一样，
    //    它本来就是表单那么宽。我上一轮那句「报错消息 30/46/30% → 93%」是**仪器造出来的**：
    //    往 DOM 里插了一个 React 不会产出的节点（直接挂在块下面），量到的是那个假节点。
    //    这一行**不删**：哪天有人把它挪出 form（或者给 form 分栏），这条规则就开始真的作数。
    //    而「今天它是恒等式」这个前提由 `sheet-recipes.test.js` ⑩ 钉着 —— 挪出去那一格会红，
    //    逼那个人回来重新量一次，而不是继承一句没人验过的话。
    partExtra: {
      error: () => ({ 'grid-column': '1 / -1' }),
      success: () => ({ 'grid-column': '1 / -1' }),
    },
  },
  // `step` 不写在这里 —— 它走 ROLE_BY_PART 的默认值 `card`。它是容器（见上面那段 🔴）。
  'quote-form': { cols: '3fr 2fr', role: { form: 'panel', intro: 'lede', main: 'column', aside: 'panel', error: 'error', success: 'success', action: 'actions' } },
  'services-list': { cols: '1fr 1fr', role: { item: 'card', icon: 'icon', title: 'title', desc: 'desc', actions: 'actions', features: 'list', products: 'list' } },
  // #1132 —— 通用块「卡片组」。
  // 📌 #1162：这一行上面原来还有一行 `values-grid`，跟它逐字相同（它就是那两个块并起来的那个）。
  //    别名兼容层退役之后 `values-grid` 不在注册表也不在 `HOOKS` 里了 ⟹ 那一行是死的，删掉。
  //    同一批删掉的还有 `benefits-list` / `checklist` / `service-highlights` 三行。
  'card-group': { role: { item: 'card', title: 'title', desc: 'desc' } },
  'services-nav': { cols: '1fr', role: { link: 'chip' } },
  'service-related-pages': { role: { card: 'card' } },
  'contact-info': { cols: '1fr 1fr', role: { location: 'card', label: 'eyebrow', address: 'desc', phone: 'contact', email: 'contact' } },
  'stats-counter': { role: { stat: 'card', value: 'figure', label: 'eyebrow' } },
  'process-steps': { role: { step: 'card', num: 'numeral', title: 'title', desc: 'desc' } },
  timeline: { cols: '1fr', role: { event: 'row-card', year: 'figure', title: 'title', desc: 'desc' } },
  'team-grid': { role: { member: 'card', name: 'title', role: 'eyebrow', bio: 'desc' } },
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
// 🔴 **图给到全强度，不许半透明** —— 这三行原来写的是反过来的（「`opacity` 压到 0.35，压暗之后图是
//    底纹」），而那个做法**在同一个文件里已经被实测推翻**：`opacity < 1` 会给 `.hero__media` 开一个
//    层叠上下文，按 CSS 的绘制顺序它跑到普通流内容**上面**，也就是图盖住了字（jade-05 真机：
//    `.hero__sub` 声明 rgb(28,69,55)、量到 rgb(92,127,116)，3.86:1，运行时那道检查当场判红）。
//    读数与完整推理在下面 `'media-cover'` 那一节的头注 —— 那里已经把这件事说全了，所以这里不重复，
//    只把这个被驳掉的说法从「现状」里拿掉（#1134；两处并存时读到前一处的人会照它去写）。
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
// ── #1158 —— 每一种 hero 画法的 `form-success` 从它【自己那一份 form】派生 ─────────────────────────
//
// 🔴 为什么必须派生、不能写死:成功那句话**站在表单原来那个格子里**(`HeroLeadForm` 成功那一支返回的
//    `<p>` 是 `.hero` 这个 grid 的直接子节点,替掉了 `<form>`),而「那个格子在哪」是**每种画法各自决定**
//    的 —— `heroFormAfterBody` 给 order 4 并跨满,而 `form-side` 给 order 3、不跨满(表单在侧栏才是它的
//    主意)。我第一版在块这一层写死了 `order: 4`,实测 `.hero__form` 的 order 分布是
//    **4 → 62 张 · 3 → 11 张 · 没写 → 10 张**,也就是**不等于 4 的共 21 张 / 83**(只看生成的那 80 张
//    是 20/80 —— 两个数都真,别混:分子要配分母。#1158 r1 把它写成「83 张里 20 张」,是拿 80 的分子
//    配了 83 的分母,QA1 r1 的 N3 点的就是这处)。那 21 张上「已收到」会跳到跟表单不同的位置去
//    (比如掉到 CTA 底下)。
// 🔴 只抄**放置类**的键,不抄「它是一张表单」那几个(`display` / `gap` / `padding` / `border-*`):
//    那些由 `ROLES.success` 给,一行字不该拿到 `form-side` 的 `padding: 2rem`。
// 🔴 一处定义、自动覆盖:加第九种画法的人**不需要记得**写它(同 `contact-form` 那条 `success` 选块层
//    的理由 —— 见 SHAPES['contact-form'] 上面 #1135 那段)。而「有没有漏」由 sheet-recipes.test.js
//    的那一格盯着:每种声明了 form 的画法都必须派生出 form-success。
const HERO_SUCCESS_PLACEMENT = [
  'order', 'grid-column', 'max-width', 'width', 'margin-left', 'margin-right', 'justify-self', 'align-self',
];
const heroSuccessFrom = (formExtra) => (v, s) => {
  const f = formExtra(v, s) || {};
  const out = {};
  for (const key of HERO_SUCCESS_PLACEMENT) if (key in f) out[key] = f[key];
  return out;
};
for (const look of Object.values(HERO_LOOKS)) {
  if (look.partExtra && typeof look.partExtra.form === 'function') {
    look.partExtra['form-success'] = heroSuccessFrom(look.partExtra.form);
  }
}


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

/**
 * 有画法候选的块族 —— **一处定义**（#1139）。
 *
 * 🔴 这张表在的理由：`shapeFor` 的派发、`sheet-recipes.test.js` ⑨ 那格的占比/解耦检查、以及 ⑫ 那格
 *    「本批六块的骨架种数」都要知道「哪些块有候选表、它的档从哪个 voice 键取」。#1135 之前这份清单
 *    被抄了两遍（`shapeFor` 里一串 if，加上 ⑨ 那格里手写的 `rows`），而**漏抄一族的样子跟通过一模
 *    一样**：那一族就不在检查射程内，格子照样绿。同族的账本仓记过一笔（`templates/nextjs/package.json`
 *    的 `lint:scripts` 也是一张手抄清单，一天内撞车四次：#1096 / #1121 / #1125 / #1126）。
 *
 * · `key`        这一族的档存在 `voiceFor` 的哪个键上
 * · `blocks`     哪几个块用这张表（卡片组那一族是 4 个块共用一张）
 * · `table`      画法表本身
 * · `pick`       第 i 套挑哪一副（`voiceFor` 用它，测试用它算分布）
 * · `keepsWide`  换画法时不许把 `@media (min-width: 1024px)` 那一段丢掉（#1090 r2 的那个退步）。
 *   🔴 取值不是口味，是量出来的：**这个块在本票之前就有那一段吗**。有（`cols` 不是单栏，或者
 *   压根没写 `cols` 而落到 `v.wide`）⟹ true，否则单栏画法会把桌面留白一起弄丢。本票之前就
 *   没有那一段的（`page-header` / `faq-accordion`，`SHAPES` 里 `cols` 就是 `'1fr'`）⟹ false：
 *   传 true 会给这两个块**凭空加上**一段它今天没有的桌面留白，而那不是本票要做的事。
 *   hero 是唯一的例外，它归 #1065：它那些纯文字画法今天本来就没有桌面那一段。
 */
const LOOK_FAMILIES = [
  { key: 'heroLook', blocks: ['hero'], table: HERO_LOOKS, pick: heroLookFor, keepsWide: false },
  { key: 'split', blocks: ['content-split'], table: SPLIT_SHAPES, pick: splitLayoutFor, keepsWide: true },
  { key: 'cards', blocks: CARD_BLOCKS, table: CARD_SHAPES, pick: cardGridFor, keepsWide: true },
  { key: 'ctaLook', blocks: ['cta-banner'], table: CTA_LOOKS, pick: ctaLookFor, keepsWide: true },
  { key: 'formLook', blocks: ['contact-form'], table: FORM_LOOKS, pick: formLookFor, keepsWide: true },
  // #1139
  { key: 'headerLook', blocks: ['page-header'], table: HEADER_LOOKS, pick: headerLookFor, keepsWide: false },
  { key: 'faqLook', blocks: ['faq-accordion'], table: FAQ_LOOKS, pick: faqLookFor, keepsWide: false },
  { key: 'stepsLook', blocks: ['process-steps'], table: STEPS_LOOKS, pick: stepsLookFor, keepsWide: true },
  { key: 'infoLook', blocks: ['contact-info'], table: INFO_LOOKS, pick: infoLookFor, keepsWide: true },
  { key: 'testimonialLook', blocks: ['testimonials'], table: TESTIMONIAL_LOOKS, pick: testimonialLookFor, keepsWide: true },
];

/** 这个块属于哪一族（没有候选表就是 undefined）。 */
const familyOf = (block) => LOOK_FAMILIES.find((f) => f.blocks.includes(block));

// 有候选表的族见上面那张 `LOOK_FAMILIES`；其余的块仍然直接用 SHAPES 里那条。
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
  // 🔴 每一族传什么 `keepsWide`、为什么，整段写在 `LOOK_FAMILIES` 上面 —— 这里不再是一串 if，
  //    所以「加了一族却忘了在别处补一行」这个错法写不出来了（#1139）。
  //    hero 传 false：它归 #1065，它那些纯文字画法今天本来就没有宽屏那一段，本票不改它的产物。
  //    `SHAPES.hero` 没有 `partExtra`（实测），所以上面那行 spread 对 hero 等价于 #1065 那版的
  //    `partExtra: hero.partExtra` —— 这一条单独量过，见 #1090 的交接留言。
  //    🔴 **#1158 这句话仍然成立，别照 #1158 r1 那条注释去改它**（QA1 r1 的 F2 抓的就是那条）：
  //    本票给 hero 加的是 `SHAPES.hero.role` 里那条 `'form-success': 'success'`，**不是** `partExtra`；
  //    `form-success` 的位置挂在**每种画法自己**那份 `partExtra` 上（见上面 `HERO_LOOKS` 之后那个
  //    `for (const look of ...)` 循环）。所以要找它，去 `HERO_LOOKS`，不是这里。
  //    r1 那条注释三句话全错，实测：`SHAPES.hero` 的键只有 `cols` / `rootExtra` / `role` 三个 ·
  //    83 张表里有 **13 张**的 `.hero__form-success` 根本没有 `grid-column`（11 张 order:3 + 2 张
  //    order:4）⟹「块这一层给它跨满」不成立 · `HERO_LOOKS` 是 **8** 种不是 7 种。
  const fam = familyOf(block);
  if (!fam) return base;
  return pick(fam.table, v[fam.key], block, fam.keepsWide);
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
  // 📌 #1162：这里原来还有一个 `ticked` 角色（打勾的清单条目：左内边距 + 底边细线）。
  //    它的唯一入口是 `SHAPES.checklist.role.item`，而 `checklist` 这个 type 名随别名兼容层
  //    2026-08-23 退役 ⟹ 全仓零引用（`grep -rn ticked scripts/ src/ tests/` 只剩这条注释），
  //    所以删掉。`ROLE_BY_PART` 里也没有任何部件名映到它（默认是 `card`/`list`）。
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
    //    （#1162 注：`values-grid` / `service-highlights` 这两个 type 名今天已经退役，这句是 #1090 r2
    //    当天的读数、留作出处；同一族今天的成员见 `CARD_BLOCKS`）
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
    // #1190 —— 实验钉（整段理由在 `SCROLL_STRIP_EXPERIMENT` 上面）。发在这个块所有规则**之后**，
    // 因为它要盖掉刚写下的 `.testimonials__item`；`i` 不对就一行都不发 ⟹ 其余 96 张逐字节不变。
    if (i === SCROLL_STRIP_EXPERIMENT.candidate && block === SCROLL_STRIP_EXPERIMENT.block) {
      out.push(`/* ${SCROLL_STRIP_EXPERIMENT.note} */\n`);
      for (const [sel, decls] of SCROLL_STRIP_EXPERIMENT.rules(v, s)) out.push(declBlock(sel, decls));
      out.push(`@media (min-width: 1024px) {\n  ${SCROLL_STRIP_EXPERIMENT.wide(v, s)
        .map(([sel, decls]) => declBlock(sel, decls).trim().split('\n').join('\n  '))
        .join('\n  ')}\n}\n`);
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
  ctaLookFor, CTA_LOOKS, CTA_LOOK_NAMES,
  formLookFor, FORM_LOOKS, FORM_LOOK_NAMES,
  layoutNamesFor, SPLIT_LAYOUTS, SPLIT_RHYTHMS, CARD_GRIDS, CARD_BLOCKS,
  surfaceFor, SURFACES, INK_FLOOR,
  // #1139 —— 六族的表 / 名字 / 挑法，以及那张「哪些块有候选表」的注册表（测试从它派生族清单，
  // 不再手抄；理由整段在 LOOK_FAMILIES 上面）。
  HEADER_LOOKS, HEADER_LOOK_NAMES, headerLookFor,
  FAQ_LOOKS, FAQ_LOOK_NAMES, faqLookFor,
  STEPS_LOOKS, STEPS_LOOK_NAMES, stepsLookFor,
  INFO_LOOKS, INFO_LOOK_NAMES, infoLookFor,
  TESTIMONIAL_LOOKS, TESTIMONIAL_LOOK_NAMES, testimonialLookFor,
  LOOK_FAMILIES, familyOf,
  // #1190 —— 实验钉。导出是为了让 `sheet-recipes.test.js` 那一格从它派生候选号，而不是手抄一个 27。
  SCROLL_STRIP_EXPERIMENT,
};
