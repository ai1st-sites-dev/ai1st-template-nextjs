// button-ink.js — 按钮上的字该是什么颜色，以及 hover 时底色该往哪边走。（#1084）
//
// 生产上 6 个站有 5 个的主按钮字读不出来（最差 2.55:1），因为 `globals.css` 把 `.btn-primary` 写死成
// 白字压 `bg-primary-500`，而 `--color-primary-500` 是每个站自己 `site/brand.json` 里的值。修在按钮
// 那一层，一次治掉所有存量站 —— 来源堵不完：客人的品牌色**就是**那个粉的时候我们没法拒绝他。
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
// 配色，换字色救不回来，要动的是底色本身（那部分不归本票，读数已搬到 #1091）。
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
// 🔴 ② hover 的底色**先按今天的 `primary-600`**，只有当已选字色在那一档不合格时才朝【远离字色】的
// 方向走，而字色**不跟着翻**。同样是最小改动：blended 尺下 80 套池主题的 hover 一档都不用动。
// 需要动的是换了深字的那些生产站：深字压 600 实测（blended）4.44 / 3.60 / 3.35，全不合格；
// 反向走一档到 400 就都过了。
//
// 为什么不「每态各自选字色」：那会让鼠标一放上去字就变色。两态各自过线是硬要求，字色翻不翻是可选的，
// 所以选不翻的那个做法。
//
// 📌 走一档之后仍不合格时**继续朝同方向走**（400→300→200… / 600→700→800…）；一档都不合格时**保持
// 今天的 600**（同 ①b 的「换过去真的够才换」）。
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
  contrast, hexToRgb, mixBytes, PAINT_BLEND, MIN_CONTRAST,
} = require('../theme-contrast.js');

const WHITE = '#ffffff';
const BLACK = '#000000';
/** 本票之前那三处写死的字面行为 —— 「保持今天的」指的就是这三个值。 */
const TODAY = { ink: WHITE, hover: '600', outline: '500' };
/**
 * 轮廓按钮换档时走的那把梯子：**就近优先，两个方向都可以挑**（见 ③b / ③c）。
 * 🔴 `500` 必须是第一个 —— 「今天这一档就够用就一个字都不改」跟 ①b / ② 是同一条纪律。
 */
const OUTLINE_LADDER = ['500', '600', '400', '700', '300', '800', '200', '900', '100', '50'];
/** hover 朝两个方向各自的梯子（`[0]` 是第一档；500 不在里面 —— hover 要跟静止态看得出区别）。 */
const HOVER_LIGHTER = ['400', '300', '200', '100', '50'];
const HOVER_DARKER = ['600', '700', '800', '900'];

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

const passes = (ink, ground) => ratio(ink, ground) >= MIN_CONTRAST;

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
 * hover 的底色该取哪一档：朝远离 `ink` 的方向走，取第一个让 `ink` 仍然过线的。见 ②。
 * 一档都不过线时**保持今天的 600** —— 同 ①b 的「换过去真的够才换」：换一个同样读不出来的档位，
 * 只是把改动面铺大，救不了任何人。这种情况由 `buttonInkReport` 报出来。
 */
function hoverShadeFor(palette, ink) {
  // 今天的那一档优先：它合格就一个字都不改。
  if (typeof palette[TODAY.hover] === 'string' && passes(ink, palette[TODAY.hover])) return TODAY.hover;
  const ladder = ink === BLACK ? HOVER_LIGHTER : HOVER_DARKER;
  const found = ladder.filter((sh) => typeof palette[sh] === 'string')
    .find((sh) => passes(ink, palette[sh]));
  return found || TODAY.hover;
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
 * 🔴 解不出来的形状（渐变、`color-mix()`、别的变量套变量）**不猜**：回 `null`，由调用方决定怎么办。
 * 猜一个会静默产出一个关于另一块底的档位，而那正是本轮被退回的那种错。
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
    let value = null;
    let m;
    while ((m = re.exec(css)) !== null) {
      const d = m[1].match(/(?:^|[;{\s])background-color\s*:\s*([^;]+)\s*;/);
      if (d) value = d[1].trim();                  // 同选择器多条时取最后一条 = 层叠赢的那条
    }
    if (!value) continue;
    const tok = value.match(/^var\(\s*--color-([a-z]+)-(\d{2,3})/);
    if (tok) {
      const hex = shadeOf(tok[1], tok[2]);
      return hex ? { hex, from: sel + ' → ' + tok[1] + '-' + tok[2] } : null;
    }
    if (/^#[0-9a-fA-F]{3,8}$/.test(value)) return { hex: value, from: sel + ' → ' + value };
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
function buttonInkReport(palette, outlineGround = WHITE) {
  const p500 = palette && palette['500'];
  if (typeof p500 !== 'string') return null;
  const d = inkDecision(p500);
  const hover = hoverShadeFor(palette, d.ink);
  // 🔴 静止态的轮廓按钮是**唯一**一格的底不是 `primary-*` 而是它坐着的那块（③a）。所以它两次都要
  // 用 `outlineGround`：一次选档、一次量读数。只在其中一处用，选出来的档与报出来的数就是两块不同
  // 的底上的答案 —— 而且报的那个会是绿的（白底上 500 档往往过线），正好把这条盖住。
  const outline = outlineShadeFor(palette, outlineGround);
  const cells = {
    'btn-primary 静止': ratio(d.ink, p500),
    'btn-primary hover': ratio(d.ink, palette[hover]),
    'btn-secondary 静止': ratio(palette[outline], outlineGround),
    'btn-secondary hover': ratio(d.ink, p500),
  };
  return {
    ink: d.ink,
    hoverShade: hover,
    outlineShade: outline,
    inkSwitched: d.switched,
    inkUnreachable: d.unreachable,
    hoverMoved: hover !== TODAY.hover,
    outlineMoved: outline !== TODAY.outline,
    outlineGround,
    whiteRatio: d.white,
    blackRatio: d.black,
    cells,
    /** 仍然读不出来的那几格（换不过去的那些）—— AC4 要求逐套列出来的就是这个。 */
    under: Object.entries(cells).filter(([, v]) => v < MIN_CONTRAST).map(([k, v]) => `${k}=${v.toFixed(3)}`),
  };
}

/**
 * 三个 CSS 变量 —— `globals.css` 里那两个按钮类读的就是它们。
 *
 * 🔴 **算它们的输入必须是【最终生效】的那份调色板**，不是 `brand.json` 里的那份：`public/custom.css`
 * （#1006 的 tweaks、#1038 的 presets）排在 `/theme.css` 之后，会盖掉 `--color-primary-*`。
 * 拿盖之前的值算，产出的字色就是关于另一套配色的答案。调用方（`sync-config.js`）为此从两份**已经写出
 * 去的字节**里解析最终值，而不是用内存里的 `brand.colors`。
 */
function buttonInkVars(palette, outlineGround = WHITE) {
  const r = buttonInkReport(palette, outlineGround);
  if (!r) return [];
  return [
    `--btn-primary-ink: ${r.ink};`,
    `--btn-primary-hover: var(--color-primary-${r.hoverShade});`,
    `--btn-outline-ink: var(--color-primary-${r.outlineShade});`,
  ];
}

module.exports = {
  WHITE, BLACK, TODAY, OUTLINE_LADDER, HOVER_LIGHTER, HOVER_DARKER,
  ratio, rawRatio, inkDecision, inkFor, hoverShadeFor, outlineShadeFor,
  outlineGroundFromCss, buttonInkReport, buttonInkVars,
};
