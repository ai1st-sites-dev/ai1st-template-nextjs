// button-ink.js — 按钮上的字该是什么颜色，以及 hover 时底色该往哪边走。（#1084）
//
// 生产上 6 个站有 5 个的主按钮字读不出来（最差 2.55:1），因为 `globals.css` 当时把 `.btn-primary`
// 写死成白字压 `bg-primary-500`，而 `--color-primary-500` 是每个站自己 `site/brand.json` 里的值。修在
// 按钮那一层，一次治掉所有存量站 —— 来源堵不完：客人的品牌色**就是**那个粉的时候我们没法拒绝他。
//
// 🔴 那句「写死成」是**改动前**的样子，两半都已经不成立了：字色 #1084 起是算出来的，**底色 #1091 起
// 也是算出来的**（Chris 的做法 D，见下面 `BASE_LADDER` / `baseShadeFor`）。`globals.css` 今天写的是
// `background-color: var(--btn-primary-bg, var(--color-primary-500))` —— 兜底值才是那个老字面值。
//
// ══ 用哪把尺量（2026-08-19 票正文改过一次，这一段是那次的落地）═══════════════════════════════════
//
// 判据是 **blended**：`contrast(mixBytes(字, 底, PAINT_BLEND=0.06), 底)`，也就是 `theme-contrast.js`
// 先把字色朝底色掺 6% 再量的那把（抗锯齿会让画出来的字比声明的字更靠近底色）。**不是** token 对
// token 的裸对比度。理由是量出来的，三把尺三个答案：
//
//     ember-38（primary-500 = #bb5b36）   裸 4.504 ✅   blended 4.173 ❌   真浏览器 4.30 ❌
//
// 裸比真机乐观 0.2–0.33 ⟹ 裸上 4.57 的格子在用户屏幕上仍然读不出来，而本票要治的就是「读不出来」。
// blended 是三把里唯一**能在没有浏览器的地方跑、而且不比真机乐观**的那把。
//
// ══ 三个判断，以及每一个的读数 ═══════════════════════════════════════════════════════════════════
//
// 🔴 ① 深字用【纯黑】。「白字还是深字」这个二选一在**裸**对比度上有一个构造性保证：白和纯黑给出相同
// 对比度的那个亮度是 `√(0.05×1.05) − 0.05 = 0.1791`，那一点的对比度是 4.583 > 4.5 ⟹ 裸尺下任意底色
// 都有一个合格的选择。深字只要比纯黑亮一点这个上限就掉到 4.5 以下（实测 110 套注册表配色）：
//
//     深字取 #111827（本仓 gray-900 惯例）  裸尺下 4 套两种字色都到不了 4.5
//     深字取 #0a0a0a                        2 套
//     深字取 #000000                        **0 套**
//     深字取 #1f2937                        7 套
//
// 🔴 ①a **换成 blended 之后那个保证没了，而且这一点是承重的。** 同样的交叉点在 blended 尺下只到
// **4.3629**（全灰阶扫描 0…255 取的：gray=116 那一点白 4.363 / 黑 4.310，两个都低于 4.5）。也就是说
// **存在一段底色，白也不行、黑也不行** —— 灰阶上是 `gray=114…119`，**6 个色阶宽**。落在这一段里的
// 配色，换字色救不回来，要动的是底色本身 —— #1084 时那部分不归它，**#1091 做了**（`BASE_LADDER` /
// `baseShadeFor` 就是那次的落地；所以今天落进这一段的配色是被挪档救回来的，不再只是「被报出来」）。
//
// 🔴 ①b 所以规则是**「白字够就保持白字；不够时换纯黑，但只有纯黑真的够才换；两种都不够就保持白字」**。
// 三件事各有各的读数：
//
//   · 「白字够就不动」防的是：改成「谁的对比度大取谁」会把 **47 套**从白字翻成深字，而它们本来就合格
//     （那 80 套白字压 primary-500 裸尺全挤在 4.50–4.54，纯黑压同一批是 4.63–4.66 —— 只差 0.1）。
//     票正文那条「80 套池主题的按钮字色一个都不许变」逐字钉的就是这件事。
//   · 「换过去真的够才换」防的是：blended 尺下那 55 套两种字色都过不了线，翻过去既不解决问题、又把
//     Chris 策展的池子换了脸。
//   · 「都不够就保持白字」的代价是量过的、有界的：在那 6 个色阶宽的段里，`|黑 − 白|` 最大只有
//     **0.3183**，段内「好的那个」最低 **4.3629**。⟹ 保持白字最多让出 0.32，而且绝不会把一个 2.55
//     那样的格子留在原地 —— 因为**裸尺下白字不合格 ⟹ 纯黑裸尺一定合格**（`1.05/(L+0.05) < 4.5`
//     ⟹ `L > 0.1833 > 0.1791`），落进那一段的配色其裸白字读数全部在 **4.49–4.87** 之间（实测 110 套
//     注册表 + 6 个真站里落在段内的 59 个）。段外的那些（生产上那 5 个站全在段外）照常换成纯黑。
//
// 🔴 ② hover 的底色从**静止态那一档（`base`）的下一档**起，朝【远离字色】的方向走，取第一个让已选
// 字色仍然过线的；字色**不跟着翻**。
//
// 🔴 起点是 `base` 的下一档，**不是「今天的 600」** —— #1091 把 `base` 挪深之后，按「先问 600 行不行」
// 会在那 55 套上答出 600 = base，两态同色、鼠标移上去什么都不会发生。`base` 自己永远不在候选里
// （`hoverShadeFor` 的 `beyond` 是严格超过 base 的那些档），这是 AC3「base 与 hover 不是同一个色值」
// 在代码里的写法。
//
// 📌 所以「hover 一档都不用动」这句话（#1084 时对 80 套池主题成立）**在 #1091 之后不成立了**，
// 而它不成立是因为 base 动了、不是因为 hover 的判据松了：80 套里 **56 套的 hover 离开了 600**
// （55 套 `600→700` 跟着 base 从 500 挪到 600；`magenta-27` 一套走深字 ⟹ hover 朝浅走到 400）·
// 24 套仍然停在 `500/600`（本次实测，`buttonInkReport` 逐套跑出来的 `base/hover` 分布）。
// 生产那 6 个站的 base 一套都没挪（500 档上选中的字色就过线），所以那边仍然是「换了深字的那些要动
// hover」：深字压 600 实测（blended）**4.193**（`site-bbf7a3d6`）· **4.440**（`#ec4899` 那三个站）·
// **3.926**（`site-943130a2`），全不合格；反向走一档到 400 就都过了（8.703 / 7.512 / 7.807）。
// 🔴 那三个数本来写的是 `4.44 / 3.60 / 3.35`，**后两个在 `origin/main` 上就已经对不上今天的代码**
// （#1091 一个字都没改这条路径上的算术，本次逐套重量得到上面那三个）—— 顺手更正，不是本票造成的。
//
// 为什么不「每态各自选字色」：那会让鼠标一放上去字就变色。两态各自过线是硬要求，字色翻不翻是可选的，
// 所以选不翻的那个做法。
//
// 📌 走一档之后仍不合格时**继续朝同方向走**（400→300→200… / 600→700→800…）；那个方向上一档都不合格
// 时取**离 base 最近的那一档**（不是「保持今天的 600」—— 600 可能就是 base 本身）。那一档不合格
// 这件事由 `buttonInkReport` 的 `under` 报出来，并由 `underNote()` 印成人话。
//
// 🔴 ③ 轮廓按钮（`.btn-secondary`）的静止态**换字色是修不了的** —— 它的字就是品牌色本身，底是它
// 坐着的那块。对比度是对称的，所以它的数与「白字压 primary-500」同源。所以这里做的是**沿调色板换
// 一档**：取第一个压那块底合格的；一档都不合格时保持今天的 500。
//
// 🔴 ③a **档位按【它真正被画在上面的那块底】选，而那块底不是白的**（2026-08-19 票正文第三次改口径，
// 出处 QA2 r2 真机 + PM 全量复算；本轮我自己复算逐格相同）。上一版这里写的是「底是页面的白」，
// 那句话对**未套主题的站**成立、对 **Chris 策展的 80 套池主题全体不成立**：
//
//     `--btn-outline-ink` 真正开火的只有一处 —— `ServicesListSection.tsx:59`（hero 那个走
//     `globals.css` 的 `.hero__cta .btn-secondary { color: currentColor }`，这个变量到不了它）。
//     那一处坐在主题表自己画的那块底上：80 套逐套解出来是
//     `primary-50` 27 套 · `primary-100` 16 套 · `primary-800` 16 套 · `primary-900` 21 套，**白底 0 套**。
//
// 🔴 ③b **所以梯子不能只朝深的一头走 —— 它在深底上是朝反方向走的。** 三个算法在那 80 套上的读数
// （blended，底按选择器解析，`.services-list__item` 优先其次 `.services-list`）：
//
//     改动前（轮廓字恒为 500）                    76 套不过线
//     只朝深 500→600→700…、且按【白底】挑档       56 套不过线 · 58 套动档 · **27 套比改动前更差** · 硬回归 0
//     就近优先、两个方向都挑、按【真底】挑档       **0 套不过线** · 76 套动档 · 变差 0 · 硬回归 0，最差 `crimson-30` 4.561
//
//   点名那几套（改动前 → 只朝深 → 就近两向）：`jade-05` 3.171 → 2.421 → 5.341（400 档）·
//   `amber-20` 3.147 → 2.398 → 5.904 · `magenta-27` 2.317 → 1.774 → 5.747（200 档）·
//   `ember-38` 2.296 → 1.746 → 6.116 · `magenta-01` 2.218 → 1.719 → 6.268 ·
//   `fern-02` 3.767 → 4.862 → 4.862（浅底那一半，两种算法同档 —— 它是「只朝深」那版唯一被抽到的样本，
//   而它恰好落在变好的那一半：这正是上一版没看见另外 37 套的原因）。
//
// 🔴 ③c **梯子的次序是「就近优先」，不是「取对比度最大的那一档」。** 两者在「过不过线」上同解
// （都能给出 80/80），差别在改动面：取最大会把每一套都推到 50 或 900 两个极端，而就近优先只挪到
// 第一个够用的档，同色相、同一套配色里最靠近今天那一档的那个 —— 这是能满足这条 AC 的最小视觉改动，
// 与 ①b「白字够就保持白字」是同一条理由。次序 `500 → 600 → 400 → 700 → 300 → 800 → 200 → 900 → 100 → 50`：
// 先深后浅只是同距时的定序，不代表偏好深的一头。
//
// 📌 「Chris 策展的 80 套看起来不变」这个初衷在这一处**守不住，而且不该守**（作者 2026-08-19 拍的）：
// 那 37 套今天的轮廓按钮就是读不出来的（最差 1.7–2.4），本票要治的正是这件事。hero 里那个按钮不受
// 影响（`currentColor`）。
//
'use strict';

const {
  contrast, hexToRgb, mixBytes, luminance, PAINT_BLEND, MIN_CONTRAST,
} = require('../theme-contrast.js');

const WHITE = '#ffffff';
const BLACK = '#000000';
/**
 * 一个值能不能拿去算 —— **只认 `#rgb` 和 `#rrggbb`**（与 `theme-contrast.js` 的 `resolveColour`
 * 同一条判据）。
 *
 * 🔴 带 alpha 的两种形状**故意不认**，它们各有各的错法（#1105，两种都实测过）：
 *   · `#rgba`（4 位）    —— `hexToRgb` 的第三段切出空串 ⟹ `parseInt('',16)` = `NaN`，
 *                            而 `NaN < 4.5` 恒为假 ⟹ 那一格会静默混过「仍然读不出来」那份清单。
 *   · `#rrggbbaa`（8 位）—— `hexToRgb` 取前 6 位、**静默丢掉 alpha** ⟹ 报出来的是「完全不透明」
 *                            那块底上的数，而真正画出来的是它跟背后那块混色之后的样子。
 * 两种都属于「算不出来」而不是「算出来了」：半透明底下面是什么，这里没有那份信息。
 */
const HEX_LITERAL = /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;
const isColourLiteral = (v) => typeof v === 'string' && HEX_LITERAL.test(v);
/** 本票之前那几处写死的字面行为 —— 「保持今天的」指的就是这几个值。 */
const TODAY = { ink: WHITE, base: '500', hover: '600', outline: '500', accentHover: '500' };
/**
 * 🔴 #1100 —— `.btn-accent` 的字色：`globals.css` 那一行写死的 `text-gray-900`（Tailwind 的 gray-900）。
 *
 * **本票不改它**（手法同 #1091：只挪档位、不改字色），所以它在这里是一个**输入**，不是一个决定。
 * 它写在这里而不是由调用方传进来，理由跟 `TODAY` 那一行同源：这是「今天页面上那个字面值」，
 * 而判据必须能从这个模块自己算出来 —— 让调用方传，两个调用方（sync-config / layout.tsx）就有两处可以漂。
 */
const ACCENT_INK = '#111827';
/** `.btn-accent` **静止态**的那一档（`@apply … bg-accent-400`）。hover 从它的下一档起算。 */
const ACCENT_BASE = '400';
/**
 * 轮廓按钮换档时走的那把梯子：**就近优先，两个方向都可以挑**（见 ③b / ③c）。
 * 🔴 `500` 必须是第一个 —— 「今天这一档就够用就一个字都不改」跟 ①b / ② 是同一条纪律。
 */
const OUTLINE_LADDER = ['500', '600', '400', '700', '300', '800', '200', '900', '100', '50'];
/**
 * 🔴 #1091 —— 主按钮**底色**的梯子：从今天那一档起，**只朝深的一头走**（Chris 2026-08-19 拍的做法 D）。
 *
 * 为什么只朝一个方向，而轮廓按钮那把（`OUTLINE_LADDER`）是两个方向都走：两者要治的病不一样。
 * 轮廓按钮的字**就是**品牌色，它坐在主题自己画的那块底上，而那块底 80 套里 37 套是深的 ⟹ 只朝深走
 * 会把它推向底色、越走越糟（③b 那张表）。主按钮的底是**它自己**，字压在上面；朝深走等于把字底拉开，
 * 方向单调。Chris 那一拍的原话就是「挪深一档」。
 *
 * 🔴 `500` 必须是第一个：跟 ①b / ② / ③c 同一条纪律 —— 今天这一档就够用，就一个字都不改。
 */
const BASE_LADDER = ['500', '600', '700', '800', '900'];

/**
 * 一对（字，底）的读数。**这是本模块唯一的判据**，blended 那把（见文件头「用哪把尺量」）。
 * 🔴 两个参数不可交换：先字后底。掺色是把**字**朝**底**掺，反过来算出来的是另一个数。
 */
const ratio = (ink, ground) => contrast(
  mixBytes(hexToRgb(ink), hexToRgb(ground), PAINT_BLEND),
  hexToRgb(ground),
);

/** 裸对比度（token 对 token）。只用来解释/对照，**不做任何判断**。 */
const rawRatio = (a, b) => contrast(hexToRgb(a), hexToRgb(b));

/**
 * 把一个读数印成字：三位小数，**朝下取整**。
 *
 * 🔴 不能用 `toFixed` —— 它会把 `4.4996` 印成 `4.500`，也就是**门槛本身**，而印出它的那句话正说着
 * 「这个数低于 4.5」。#1091 r3 的 `button-ink.test.js §⑧` 在 `gray-119`（纯黑真值 4.4980）上当场抓到
 * 这一条；同族的一次是 `ember-38`（纯黑 4.495204 被印成 `4.50`，QA2 在 `origin/main` 的日志里看到的
 * 那张「唯一的例外」其实只是显示位数）。朝下取之后印出来的数**永远不大于真值** ⟹ 「低于门槛」这类
 * 断言不会被自己印的数否掉。
 */
const showRatio = (v) => (Math.floor(v * 1000) / 1000).toFixed(3);

const passes = (ink, ground) => ratio(ink, ground) >= MIN_CONTRAST;

/**
 * 🔴 #1100 —— 「这个字色是深的吗」。hover 的底色要朝**远离字色**的方向走（②），方向就靠这一问。
 *
 * **判据是亮度，不是「跟纯黑相等」。** 上一版写的是 `ink === BLACK`，而那个形状只对本模块自己产出的
 * 两个字色（白 / 纯黑）成立。#1100 要拿同一个函数给 `.btn-accent` 定 hover 档，它的字是
 * `gray-900` = `#111827` —— 深字，但**不等于** `#000000` ⟹ 被判成浅字 ⟹ 底朝深走 ⟹ 逐套复现今天
 * 那批读不出来的格子。两边都实测过（80 套池主题，blended）：
 *
 *     hoverShadeFor(accent, '#111827', '400')  上一版判据  落档 {"500":80}  坏 37/80  最差 4.206 crimson-64
 *     同上，本判据                                         落档 {"300":80}  坏  0/80  最差 6.789 violet-53
 *
 * 门限取 ① 那个交叉点 `√(0.05×1.05) − 0.05`（白与纯黑给出**相同**对比度的那个亮度）：它是「白字更
 * 合适还是深字更合适」的分界，也就是「这个字色站在哪一半」。纯黑（亮度 0）与纯白（亮度 1）的答案
 * 与上一版**逐字相同** ⟹ 这不是改行为，是把同一个意思写成对任意字色都成立的形式。
 * （反向对照在 `button-ink.test.js` §⑨：把它改回 `ink === BLACK`，accent 那一格当场红。）
 */
const INK_DARK_BELOW = Math.sqrt(0.05 * 1.05) - 0.05;
const inkIsDark = (ink) => luminance(hexToRgb(ink)) < INK_DARK_BELOW;

/**
 * 压在 `bg` 上的字该是什么色，以及**为什么** —— 见 ① / ①a / ①b。
 *
 * @returns {{ink:string, white:number, black:number, switched:boolean, unreachable:boolean}}
 *   `switched`   = 从今天的白字换成了纯黑（换过去真的过线才会是 true）
 *   `unreachable`= 两种字色都过不了线 ⟹ 保持今天的白字，并且**要被报出来**（票正文 AC4：
 *                  「两种字色都过不去的那些，保持它今天的字色并逐套列出来」）
 */
function inkDecision(bg) {
  const white = ratio(WHITE, bg);
  const black = ratio(BLACK, bg);
  if (white >= MIN_CONTRAST) return { ink: WHITE, white, black, switched: false, unreachable: false };
  if (black >= MIN_CONTRAST) return { ink: BLACK, white, black, switched: true, unreachable: false };
  return { ink: TODAY.ink, white, black, switched: false, unreachable: true };
}

/** 压在 `bg` 上的字色。见 ①b。 */
function inkFor(bg) {
  return inkDecision(bg).ink;
}

/**
 * 主按钮**静止态**的底色该取哪一档：沿 `BASE_LADDER` 取**第一个（也就是最浅的）**让「压在它上面的
 * 那个字色」过线的档。见 BASE_LADDER 那段。（#1091 / Chris 的做法 D）
 *
 * 🔴 判据是「**那一档上算出来的**字色过线」，不是「白字过线」。票正文写的是白字，而 #1084 之后字色
 * 是 `inkDecision()` 按底色选的（白或纯黑）—— 两者对 80 套池主题只差一套（`magenta-27`：500 档白字
 * 不过、纯黑过 ⟹ 按白字问要挪到 600，按真字色问它一步都不用挪）。**画面上生效的是后者**，所以判据
 * 用后者。这不是放宽：`inkDecision` 只在「换过去真的够」时才换字色（①b）。
 *
 * 🔴 一档都不过线时**保持今天的 500**（同 ①b 的「换过去真的够才换」）：把底推到 900 而字仍然读不出来，
 * 只是把 Chris 策展的按钮弄黑了还没修好任何人。这种情况由 `buttonInkReport` 的 `under` 报出来。
 */
function baseShadeFor(palette) {
  const found = BASE_LADDER.filter((sh) => typeof palette[sh] === 'string')
    .find((sh) => !inkDecision(palette[sh]).unreachable);
  return found || TODAY.base;
}

/**
 * hover 的底色该取哪一档：**从 `base` 往远离 `ink` 的方向走**，取第一个让 `ink` 仍然过线的。见 ②。
 *
 * 🔴 #1091 —— 起点从「今天的 600」改成「base 的下一档」，而这一条是承重的：做法 D 把 base 挪到 600
 * 之后，旧写法会先问 600 合不合格、合格就返回 600 ⟹ **base 和 hover 变成同一个颜色，鼠标移上去什么
 * 都不会发生**（role-user 在 #1091 上算出来的那个洞）。所以这里问的不再是「今天那一档行不行」，
 * 而是「离 base 最近、且仍然过线的下一档是哪一个」。
 *
 * 🔴 `base` 自己**永远不在候选里**：`beyond` 是严格大于/小于 base 的那些档。这是 AC3「base 与 hover
 * 不是同一个色值」在代码里的写法，而不是靠调用方记得去比。
 *
 * 🔴 **候选档是从 `palette` 自己现算的，没有写死的梯子 —— 别再加一把。** #1091 之前这里走两个写死的
 * 数组（`HOVER_LIGHTER` / `HOVER_DARKER`），改成「离 base 最近」之后它们一个消费者都没有了，却还挂在
 * `module.exports` 上 ⟹ 下一个人可以 import 它当「hover 的梯子」，改它一个字都不会有效果（QA1 在
 * #1091 r2 点出来的）。已删。要限制候选就改这个函数里 `beyond` 的过滤条件，那是唯一开火的地方。
 *
 * 一档都不过线时取那个方向上**离 base 最近的那一档**（而不是保持今天的 600 —— 那可能就是 base 本身）。
 * 那一档不合格这件事由 `buttonInkReport` 的 `under` 报出来。
 */
function hoverShadeFor(palette, ink, base = TODAY.base) {
  const n = (sh) => Number(sh);
  // #1100 —— 按亮度判，不按「跟纯黑相等」判（理由与读数在 `inkIsDark` 上面）。
  const darker = inkIsDark(ink);
  const all = Object.keys(palette).filter((sh) => typeof palette[sh] === 'string' && /^\d{2,3}$/.test(sh));
  const beyond = all
    .filter((sh) => (darker ? n(sh) < n(base) : n(sh) > n(base)))
    .sort((a, b) => (darker ? n(b) - n(a) : n(a) - n(b)));
  const found = beyond.find((sh) => passes(ink, palette[sh]));
  if (found) return found;
  if (beyond.length) return beyond[0];
  // 那个方向上一档都没有（base 已经在梯子的尽头）⟹ 退到另一个方向最近的一档，仍然保证 ≠ base。
  const other = all
    .filter((sh) => (darker ? n(sh) > n(base) : n(sh) < n(base)))
    .sort((a, b) => (darker ? n(a) - n(b) : n(b) - n(a)));
  return other[0] || base;
}

/**
 * 🔴 #1100 —— `.btn-accent` 的 hover 底色该取哪一档。
 *
 * 它就是 `hoverShadeFor` 本身，只是换一组调色板、换一个字色、换一个起点档 —— **故意不写第二个算法**：
 * 两处各算一遍是这个仓一路在堵的形状（role-user 在本票留言里点名过同一件事）。所以本票在
 * `hoverShadeFor` 里修的那个方向判据（`inkIsDark`）同时也是这一处的判据。
 *
 * 方向是**朝浅**（accent 的字是深的），而这不是一个偏好，是 accent 色阶的性质：它只到 600，而
 * 朝深走一档（600）在 80 套池主题上比不改还差 —— 实测坏 47/80、最差 2.534（`jade-47`），今天
 * （500）是坏 37/80、最差 4.206（`crimson-64`），朝浅一档（300）是坏 0/80、最差 6.789（`violet-53`）。
 * Chris 2026-08-19 把这一格委托给 role-user 拍，它选了朝浅（票正文「做法 a」）。
 *
 * 📌 **档位不写死成 `300`**：那是「今天这 80 套的答案」，不是判据。判据是「从 400 起朝远离字色的
 * 方向，第一个让 `gray-900` 仍然过线的档」——`accent` 色阶不同的站自己算自己的（同 #1091 实施要点
 * 「判据写集合、别把档位数字写进 AC」）。
 */
function accentHoverShadeFor(accent) {
  return hoverShadeFor(accent, ACCENT_INK, ACCENT_BASE);
}

/**
 * 轮廓按钮的字/边框该取哪一档：沿 `OUTLINE_LADDER` 就近找第一个压 `ground` 合格的；
 * 一档都不合格就保持今天的 500。见 ③ / ③a / ③b / ③c。
 *
 * 🔴 `ground` 是**它真正被画在上面的那块底**，不是「页面的白」。默认值 `WHITE` 只对**未套主题的站**
 * 成立（`globals.css` 的 services-list 骨架不画底色）；套了主题的站必须由调用方把那块底解出来传进来
 * —— `outlineGroundFromCss` 就是干这个的。**默认值不是兜底，是一种站的形态**：拿白底去替深底主题
 * 答，答出来的档位在那 37 套上比不改还差（③b 那张表的中间一行）。
 */
function outlineShadeFor(palette, ground = WHITE) {
  const found = OUTLINE_LADDER.filter((sh) => typeof palette[sh] === 'string')
    .find((sh) => passes(palette[sh], ground));
  return found || TODAY.outline;
}

/**
 * 从**已经写出去的 CSS 字节**里解出「轮廓按钮坐着的那块底」。
 *
 * 🔴 判据与 `sync-config.js` 解调色板那一处同一条：**浏览器最后会用哪个值** = 这段字节里最后一条
 * 生效的声明。层叠里 `.services-list__item` 盖在 `.services-list` 上（前者是后者的子元素，按钮在
 * 它里面），所以先问 `__item`、再问 `.services-list`；同一个选择器出现多次时取**最后**一条。
 *
 * 🔴 两个都没写底色 ⟹ 白底，而这是一个**读数不是兜底**：`globals.css` 的 services-list 骨架里
 * `background` 零命中 ⟹ 未套主题的站那一处真的就是页面白。
 *
 * 🔴 解不出来的形状（渐变、`color-mix()`、别的变量套变量、`background` 简写、带 alpha 的 hex）
 * **不猜**：回 `null`，由调用方决定怎么办。猜一个会静默产出一个关于另一块底的档位，而那正是
 * #1084 被退回的那种错。
 *
 * 🔴 **「读不出来」和「这里真的没画底」必须分开（#1105）：** 只要那个块里有一条画底的声明，
 * 读不出来就回 `null`；**绝不许**掉到最后那句 `{ hex: WHITE, from: '没有任何一条画底…' }` ——
 * 那句是一个**关于这个站的断言**（"它是未套主题的站"），而不是"我不知道"。#1105 之前
 * `background:` 简写走的正是这条路：把一个深底主题报成页面白，档位按白底挑（`magenta-01`
 * 实测 6.268 → 1.719，比不改还差），而构建**一行警告都不打**。
 *
 * 🔴 `background` 简写**认得出、但不解析**：它一条里可以装图片、渐变、多层背景，解析一半等于猜。
 * 所以有它 ⟹ `null` + 调用方报警。我们自己的生成器写的一律是 `background-color`
 * （2026-08-19 实测：83 张表那两处选择器共 110 条声明，简写 0 条）。
 *
 * @param {string} cssText 主题表（或 theme.css + custom.css 的层叠）的原文
 * @param {object} palette `{primary:{50..900}, accent:{…}}` 或扁平的 `{50..900}`——用来把
 *                         `var(--color-primary-800)` 解成十六进制
 * @returns {{hex:string, from:string}|null}
 */
function outlineGroundFromCss(cssText, palette) {
  const css = String(cssText || '');
  const shadeOf = (group, shade) => {
    const g = palette && (palette[group] || (group === 'primary' ? palette : null));
    return g && typeof g[shade] === 'string' ? g[shade] : null;
  };
  for (const sel of ['.services-list__item', '.services-list']) {
    // 选择器必须**独占一条规则的开头**，同 `theme-presets.test.js` 里那把索引的理由：
    // 松了会把 `.foo .services-list { … }` 这种后代选择器也算进来。
    const re = new RegExp('(?:^|\\n)[ \\t]*\\' + sel + '[ \\t]*\\{([^}]*)\\}', 'g');
    let decl = null;
    let m;
    while ((m = re.exec(css)) !== null) {
      // 🔴 `[^;}]+` 而不是 `[^;]+`：块里最后一条声明可以不带分号，`[^;]+` 会一路吃到**下一条规则**
      //    里的那个分号（`;` 之前的 `}` 挡不住它）。同选择器多次、同块里多条时都取**最后**一条
      //    = 层叠赢的那条。`background` 与 `background-color` 一起数，因为后写的那条才是赢家。
      for (const d of m[1].matchAll(/(?:^|[;{\s])(background(?:-color)?)\s*:\s*([^;}]+)/g)) {
        decl = { prop: d[1], value: d[2].trim() };
      }
    }
    if (!decl) continue;
    if (decl.prop !== 'background-color') return null;   // 简写：认得出，不解析（见上面那条 🔴）
    const { value } = decl;
    const tok = value.match(/^var\(\s*--color-([a-z]+)-(\d{2,3})/);
    if (tok) {
      const hex = shadeOf(tok[1], tok[2]);
      return isColourLiteral(hex) ? { hex, from: sel + ' → ' + tok[1] + '-' + tok[2] } : null;
    }
    if (isColourLiteral(value)) return { hex: value, from: sel + ' → ' + value };
    return null;                                   // 认得出选择器、解不出颜色 ⟹ 不猜
  }
  return { hex: WHITE, from: '没有任何一条画底 ⟹ 页面白（未套主题的站）' };
}

/**
 * 一份调色板的完整决定 + 每一格的读数。`buttonInkVars` 只取其中三个值；报告/测试要的是全部。
 *
 * 四格 = `.btn-primary` 静止 / `.btn-primary` hover / `.btn-secondary` 静止 / `.btn-secondary` hover
 * （最后一格与第一格同值：hover 时轮廓按钮的底就是 `primary-500`、字就是算出来的那个字色）。
 */
function buttonInkReport(palette, outlineGround = WHITE, accent = null) {
  const p500 = palette && palette['500'];
  // 🔴 `typeof === 'string'` 不够（#1105）：`#abcd` / `#5e264380` 都是字符串，而 `hexToRgb` 对它们
  // 一个解出 `NaN`、一个静默丢掉 alpha ⟹ 后面每一格都是关于另一个颜色的数。这里回 `null` =
  // 「这份配色算不出来」，调用方那条路会把它说出来。
  if (!isColourLiteral(p500)) return null;
  // 🔴 #1091 —— 顺序是承重的：**先选底，再按那块底选字**。反过来（先按 500 选字、再挪底）算出来的
  // 字色是关于另一块底的答案，而画面上字压的是新底。
  const base = baseShadeFor(palette);
  const d = inkDecision(palette[base]);
  const hover = hoverShadeFor(palette, d.ink, base);
  // 🔴 `.btn-secondary:hover` 的底**仍然是 `primary-500`**（`globals.css` 那条规则本票不动），所以它的
  // 字色要按 500 算，不能跟着主按钮走；#1084 之前两者同底、共用一个变量，底一挪它们就是两个问题了。
  // 🔴 #1100 —— `outlineHoverInk` 在这里【删掉了】，不是漏了。#1091 留下它是因为那时
  // `.btn-secondary:hover` 的底仍是 `primary-500`（它注释里写着「那一格归 #1100」）；本票把那条规则
  // 的底接到了主按钮静止态那一档，于是这一格的字与底跟第一格逐字相同，再按 500 算一遍字色就是一个
  // 页面上不存在的配对。`--btn-outline-hover-ink` 随之退役（活代码里消费者 0）。
  // 🔴 静止态的轮廓按钮是**唯一**一格的底不是 `primary-*` 而是它坐着的那块（③a）。所以它两次都要
  // 用 `outlineGround`：一次选档、一次量读数。只在其中一处用，选出来的档与报出来的数就是两块不同
  // 的底上的答案 —— 而且报的那个会是绿的（白底上 500 档往往过线），正好把这条盖住。
  //
  // 🔴 `outlineGround` 传 `null` = **「那块底解不出来」**（`outlineGroundFromCss` 回了 null），
  // 跟「那块底是白的」是两个读数（#1105）。选档仍然按白底走 —— 那是今天的行为，改它不在本票射程 ——
  // 但这一格的**读数不许假装知道**：底不知道，压在它上面的对比度就没有答案，于是它落进
  // `unresolved` 而不是落进「合格」那一侧。#1105 之前它按白底算出 5.683 并显示成合格。
  const groundKnown = isColourLiteral(outlineGround);
  const outline = outlineShadeFor(palette, groundKnown ? outlineGround : WHITE);
  /**
   * 四格各自的（字，底）—— 先摆出来，再逐格判「这两个值算得出来吗」。
   * 🔴 前两格的底是 **`palette[base]` / `palette[hover]`**，不是 `p500`：#1091 之后主按钮的底会挪档，
   * 写死 500 的话报的就是另一块底上的数（本票要治的正是这种「关于另一块底的读数」）。
   */
  // #1100 —— accent 那一组是可选入参：老一点的调用方、以及解析不出 accent 的站根本不传。
  const accentBaseRaw = accent ? accent[ACCENT_BASE] : undefined;
  const accentPresent = accentBaseRaw !== undefined;
  const accentHover = accentPresent && isColourLiteral(accentBaseRaw) ? accentHoverShadeFor(accent) : null;
  const pairs = {
    'btn-primary 静止': { ink: d.ink, ground: palette[base], groundWhat: `primary-${base}` },
    'btn-primary hover': { ink: d.ink, ground: palette[hover], groundWhat: `primary-${hover}` },
    'btn-secondary 静止': {
      ink: palette[outline], inkWhat: `primary-${outline}`,
      ground: groundKnown ? outlineGround : undefined, groundWhat: '它坐着的那块底',
    },
    // 🔴 #1100 —— 与第一格【同一对】：底走 `palette[base]`、字走那一档上算出来的 `d.ink`。
    // `globals.css` 那条 hover 规则本票改成了 `var(--btn-primary-bg)` / `var(--btn-primary-ink)`，
    // 所以这里再写 500 就是报一个页面上不存在的配对 —— #1105 要治的正是这种读数。
    'btn-secondary hover': {
      ink: d.ink, inkWhat: `按 primary-${base} 算出来的字色`,
      ground: palette[base], groundWhat: `primary-${base}`,
    },
    // 🔴 #1100 r2 —— accent 那两格也走 `pairs`，**不是**在外面先 `ratio()` 算好。这是 #1105 立的纪律：
    // 「算不出来」是第三种结果，必须自己一条，不许混进合格、也不许静默。r1 那一版的门是
    // `typeof accent[ACCENT_BASE] === 'string'` —— 而带 alpha 的 `#rrggbbaa` 是字符串，它会算出
    // 「完全不透明那块底上的数」并当合格报出去，正是 #1105 要治的那件事。
    // 📌 两种「没有」要分开：这套配色**根本没有** accent 这一档（今天常见，也是本票不产出
    // `--btn-accent-hover`、页面落回兜底 accent-500 的那条路）⟹ 这两格不存在，不进任何清单；
    // 有这一档但**读不出来** ⟹ 两格都落进 `unresolved`，由下面那个循环说出是哪个值算不出来。
    ...(accentPresent ? {
      'btn-accent 静止': { ink: ACCENT_INK, ground: accentBaseRaw, groundWhat: `accent-${ACCENT_BASE}` },
      'btn-accent hover': {
        ink: ACCENT_INK,
        ground: accentHover ? accent[accentHover] : undefined,
        groundWhat: accentHover ? `accent-${accentHover}` : `accent-${ACCENT_BASE} 之后那一档（选不出来）`,
      },
    } : {}),
  };
  const cells = {};
  /**
   * 算不出来的那几格 + 为什么。**它跟 `under` 是两份清单，不许合并**（#1105）：`under` 说的是
   * 「量出来了、低于 4.5」，这份说的是「没有量出来」。合并的话调用方那句解释（"这套配色换字色
   * 救不回来"）会被贴到一个根本没量出数的格子上 —— 又是一句关于页面的假话。
   */
  const unresolved = [];
  for (const [name, q] of Object.entries(pairs)) {
    const inkBad = !isColourLiteral(q.ink);
    const groundBad = !isColourLiteral(q.ground);
    if (inkBad || groundBad) {
      const which = inkBad ? '字色' : '底色';
      const what = inkBad ? (q.inkWhat || '') : (q.groundWhat || '');
      const val = inkBad ? q.ink : q.ground;
      unresolved.push(`${name}：${which} ${what} = ${JSON.stringify(val)}`
        + ' 算不出来（认的是 #rgb / #rrggbb）');
      cells[name] = NaN;
      continue;
    }
    const v = ratio(q.ink, q.ground);
    cells[name] = v;
    // 兜底：两个输入都是合法字面值却算出个非数，那是这把尺自己坏了 —— 同样要说出来，不能沉默。
    if (!Number.isFinite(v)) unresolved.push(`${name}：两个颜色都合法，可是算出来不是一个数`);
  }
  return {
    ink: d.ink,
    baseShade: base,
    accentInk: accentHover ? ACCENT_INK : null,
    accentHoverShade: accentHover,
    accentHoverMoved: accentHover ? accentHover !== TODAY.accentHover : false,
    hoverShade: hover,
    outlineShade: outline,
    inkSwitched: d.switched,
    inkUnreachable: d.unreachable,
    baseMoved: base !== TODAY.base,
    hoverMoved: hover !== TODAY.hover,
    outlineMoved: outline !== TODAY.outline,
    /** 解不出来时是 `null`（不是白）—— 「不知道」和「是白的」不许长成同一个值。 */
    outlineGround: groundKnown ? outlineGround : null,
    whiteRatio: d.white,
    blackRatio: d.black,
    cells,
    /**
     * 仍然读不出来的那几格（换不过去的那些）—— AC4 要求逐套列出来的就是这个。
     * 🔴 `Number.isFinite` 那一半是 #1105 补的：原来写的是 `v < MIN_CONTRAST`，而 `NaN < 4.5`
     * **恒为假** ⟹ 算不出来的格子会静默混到「合格」那一侧。算不出来的现在走 `unresolved`。
     */
    under: Object.entries(cells)
      .filter(([, v]) => Number.isFinite(v) && v < MIN_CONTRAST)
      .map(([k, v]) => `${k}=${showRatio(v)}`),
    unresolved,
  };
}

/**
 * 那道「这个站还有按钮读不出来」的诊断印出来的话。#1084 立的（当时住在 `sync-config.js` 里，是三行
 * 拼起来的模板字符串），#1091 r3 重写并搬到这里。
 *
 * 🔴 **为什么搬进来**：那句话是一条**关于读数的断言**，而 #1091 把它引用的每个数换了主体 —— 上一版写死
 * 「白字 {whiteRatio} / 纯黑 {blackRatio}，两个都低于 4.5 ⟹ 换字色救不回来」，而 #1091 之后这两个数是
 * **挪过档之后那一档**上的读数，那一档上白字按构造过线（`baseShadeFor` 选的就是过线的那一档）。于是
 * 58/83 张表上它印出来的第一个数就否掉了它自己那半句（QA2 在 #1091 r2 上量的）。搬进来 = 让它成为
 * `report` 的纯函数，`button-ink.test.js §⑧` 才能对每一套夹具问「它印的数否掉它自己的断言了吗」；
 * 留在 `console.log` 里没有任何测试能咬住它（那次全仓 `grep` 到 0 个断言）。
 *
 * 🔴 **不是让它闭嘴**：`under` 非空就照旧开火 —— #1084 那行注释的理由今天仍然成立（不打这一行，
 * 「还有按钮读不出来」的站与修好了的站在日志上一模一样）。变的只是**它说什么**：每个数都带上它是
 * 压在哪一档上量的，而「换字色救不回来」这个结论只在 `inkUnreachable` 那一支说。
 *
 * @param {ReturnType<typeof buttonInkReport>} report
 * @returns {string|null} 没有一格不过线时 `null` = **不该打这一行**（触发条件也在这里，只此一处）
 */
function underNote(report) {
  if (!report || !report.under || !report.under.length) return null;
  const inkLabel = report.ink === BLACK ? '深字' : '白字';
  // 每个数都点名它的主体：这两个读数是压在 **`primary-${baseShade}`** 上量的，不是压在 500 上。
  const reading = `primary-${report.baseShade} 上白字 ${showRatio(report.whiteRatio)}`
    + ` / 纯黑 ${showRatio(report.blackRatio)}`;
  const head = `仍然读不出来的：${report.under.join(' · ')}（下限 ${MIN_CONTRAST}，blended）`;
  if (report.inkUnreachable) {
    // 这一支 ⟺ `btn-primary 静止` 在 under 里：`baseShadeFor` 在梯子上一档都找不到时才落回 500，
    // 而那时 `inkDecision(palette['500']).unreachable` 为真 ⟹ 选中字色压 500 必然低于 4.5。
    return `${head} —— 换字色救不回来：${reading}，两个都低于 ${MIN_CONTRAST}，`
      + `而 BASE_LADDER 上一档都不过线 ⟹ 保持今天的${inkLabel}，要动的是配色本身。`;
  }
  const primaryUnder = report.under.filter((u) => u.startsWith('btn-primary'));
  return `${head} —— 主按钮的底走 primary-${report.baseShade}（${reading} ⟹ 选${inkLabel}），`
    + (primaryUnder.length
      // 调色板不单调时到得了：`base` 那一档过线，而 hover 那个方向上一档都不过线（`hoverShadeFor`
      // 这时返回离 base 最近的那一档，它自己不合格）。夹具在 §⑧ 里。
      ? `而主按钮自己还有 ${primaryUnder.join(' · ')} 没过线 —— hover 那个方向上一档都没救回来。`
      : '主按钮自己那两格都过线了 ⟹ 上面这些不在主按钮上。');
}

/**
 * 三个 CSS 变量 —— `globals.css` 里那两个按钮类读的就是它们。
 *
 * 🔴 **算它们的输入必须是【最终生效】的那份调色板**，不是 `brand.json` 里的那份：`public/custom.css`
 * （#1006 的 tweaks、#1038 的 presets）排在 `/theme.css` 之后，会盖掉 `--color-primary-*`。
 * 拿盖之前的值算，产出的字色就是关于另一套配色的答案。调用方（`sync-config.js`）为此从两份**已经写出
 * 去的字节**里解析最终值，而不是用内存里的 `brand.colors`。
 */
function buttonInkVars(palette, outlineGround = WHITE, accent = null) {
  const r = buttonInkReport(palette, outlineGround, accent);
  if (!r) return [];
  return [
    // #1091 —— 主按钮静止态的底。兜底值 = 本票之前的字面行为（`bg-primary-500`）⟹ 拿不到这个变量的
    // 页面与改动前逐字相同。
    `--btn-primary-bg: var(--color-primary-${r.baseShade});`,
    `--btn-primary-ink: ${r.ink};`,
    `--btn-primary-hover: var(--color-primary-${r.hoverShade});`,
    `--btn-outline-ink: var(--color-primary-${r.outlineShade});`,
    // #1100 —— `.btn-accent` 的 hover 底色。兜底值 `var(--color-accent-500)` = 本票之前的字面行为
    // （`@apply … hover:bg-accent-500`）⟹ 拿不到这个变量的页面与改动前逐字相同。
    // 🔴 accent 那一组解不出来时**这一条根本不产出**（不是产出一个错的档）—— 页面落回兜底值。
    ...(r.accentHoverShade ? [`--btn-accent-hover: var(--color-accent-${r.accentHoverShade});`] : []),
  ];
}

module.exports = {
  WHITE, BLACK, TODAY, OUTLINE_LADDER, BASE_LADDER, ACCENT_INK, ACCENT_BASE, INK_DARK_BELOW,
  ratio, rawRatio, isColourLiteral, inkDecision, inkFor, inkIsDark, baseShadeFor, hoverShadeFor,
  accentHoverShadeFor, outlineShadeFor, outlineGroundFromCss, buttonInkReport, buttonInkVars, underNote,
};
