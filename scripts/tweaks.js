// tweaks.js — 每站微扰（#1006，spec §5.6 / 决策 D2 的第二半 + D10）。
//
// 同一套主题装到 10 个站上，今天那 10 个站的 CSS 逐字节相同。这一层给每个站一组**小偏移**，
// 让它们看起来不重样，而偏移**只碰 CSS 变量、不碰布局**（布局一动就要重跑五条不变量，
// 而 tweaks 是每站一次、全程无人审）。
//
// 🔴 一律是相对偏移，不许绝对值。理由是换主题那条流程：整份换掉 theme.css 之后，同样的偏移
// 套到新皮上仍然有意义；绝对值会把新主题的配色覆盖掉 = 等于没换。
//
// 🔴 走的是【G】：生成时把偏移算成具体值写进 custom.css，换主题时拿新基准重算一遍
// （作者 2026-08-14 定）。曾经想让 CSS 自己算（`hsl(from var(--x) calc(h - 8) s l)` 写回
// **同一个变量名**）—— 那是自引用，CSS 判它循环，整个变量作废，实测画出来是掉色 + 圆角归零 +
// 留白归零，失败方向是最坏的那个。
//
// 🔴 微扰乘的是【算出来的变量值】，不是 token。`settingsToCssVars()` 已经把枚举档位翻成了
// 具体值（`DENSITY.standard.y = '4rem'` → `--section-y: 4rem`），所以这里做的是纯字符串数学：
// 取数字部分 × 系数，单位原样保留。跟 settings 是枚举还是数值无关。

/**
 * 每个 tweak 的允许区间（含两端）。
 *
 * 🔴 这三个数管的是**偏移能走多远**，不是「安全的范围」—— 别再把它当安全证明用（这一段原来就是那么
 * 写的，QA1 在 #1006 r1 证伪了：当时的实现在 ±15 之内就能把按钮的对比度从 5.17:1 压到 3.22:1）。
 * 可读性现在由**做法本身**保住：色相偏移会把相对亮度原样拉回去，所以对比度不随偏移走（见下面
 * §颜色 那段的穷举读数：15300 个组合，对比度最大变化 0.052，没有一个色阶被推到 4.5:1 以下）。
 *
 * 📌 AC4 那一格（拿实证那几套主题在每个 tweak 的两端各建一次样例站、跑一遍不变量检查）仍然要跑，
 * 但它证明的是「这几套皮在两端没坏」，**不是**「整个区间都安全」—— 后者靠的是上面那条性质。
 * 🔴 也要知道那份检查量的是什么：`theme-css-invariants.mjs` 的 `TEXT_TARGETS` 只有
 * `.hero__title` / `.hero__sub` 两个选择器，**按钮不在里面**。QA1 抓到的正是这个盲区。
 *
 * 📌 `fontScale` 不在这里：全仓没有任何字号变量可以缩放（字号今天走 Tailwind 的 text-* 工具类），
 * 所以它阻塞在「没有字号 token」上，等排版 token 立项时另开票补（作者 2026-08-14 定，走 B）。
 */
const TWEAK_BOUNDS = {
  hueShift: { min: -15, max: 15, unit: 'deg' },
  radiusScale: { min: 0.8, max: 1.25 },
  densityScale: { min: 0.9, max: 1.15 },
};

const TWEAK_KEYS = Object.keys(TWEAK_BOUNDS);

/** 不带 tweak 时每个键的取值 —— 施加它等于什么都不做。 */
const NEUTRAL = { hueShift: 0, radiusScale: 1, densityScale: 1 };

/**
 * 校验一组 tweaks → string[]（每条是给人看的理由，空数组 = 合法）。
 *
 * 🔴 `NaN` / `Infinity` 单独判，不能只靠 `< min || > max`：**任何比较运算碰上 NaN 都是 false**，
 * 所以 `NaN < 0.8` 与 `NaN > 1.25` 同时为假 —— 一个只写范围比较的校验会把 NaN 判成合法，
 * 而它一路走到 CSS 里会变成 `--radius-DEFAULT: NaNrem`（浏览器丢掉整条声明）。本仓为这个形状
 * 付过账（float 下限校验被 NaN 绕过）。`Infinity` 同理走到 `Infinityrem`。
 * 🔴 也不接受字符串数字（`"1.1"`）：JSON 里它是另一个类型，接受它等于让「配置写错了类型」
 * 这件事静默通过，而下一个写调用方的人会以为两种都行。
 */
function validateTweaks(tweaks) {
  const problems = [];
  if (tweaks === undefined || tweaks === null) return problems;   // 没有 tweaks 是合法的
  if (typeof tweaks !== 'object' || Array.isArray(tweaks)) {
    problems.push(`tweaks: 应该是 object，实际是 ${Array.isArray(tweaks) ? 'array' : typeof tweaks}`);
    return problems;
  }
  for (const key of Object.keys(tweaks)) {
    if (!Object.prototype.hasOwnProperty.call(TWEAK_BOUNDS, key)) {
      problems.push(`tweaks.${key}: 不是一个 tweak（本票支持的是 ${TWEAK_KEYS.join(' / ')}；`
        + 'fontScale 阻塞在「没有字号 token」上，见 #1006）');
    }
  }
  for (const key of TWEAK_KEYS) {
    if (!Object.prototype.hasOwnProperty.call(tweaks, key)) continue;   // 缺省 = 中性值
    const v = tweaks[key];
    const { min, max } = TWEAK_BOUNDS[key];
    if (typeof v !== 'number') {
      problems.push(`tweaks.${key}: 应该是 number，实际是 ${typeof v}（${JSON.stringify(v)}）`);
      continue;
    }
    if (Number.isNaN(v)) { problems.push(`tweaks.${key}: 是 NaN —— 它跟任何数比大小都是 false，`
      + '范围检查看不见它，而它会变成 CSS 里一条无效声明'); continue; }
    if (!Number.isFinite(v)) { problems.push(`tweaks.${key}: 是 ${v > 0 ? 'Infinity' : '-Infinity'}`
      + ' —— 同上，它算出来的值浏览器整条丢掉'); continue; }
    if (v < min) problems.push(`tweaks.${key} = ${v}：小于下界 ${min}`);
    if (v > max) problems.push(`tweaks.${key} = ${v}：大于上界 ${max}`);
  }
  return problems;
}

/** 把一组 tweaks 补齐成完整的一组（缺的取中性值）。 */
function withDefaults(tweaks) {
  const out = { ...NEUTRAL };
  for (const key of TWEAK_KEYS) {
    if (tweaks && typeof tweaks[key] === 'number' && Number.isFinite(tweaks[key])) out[key] = tweaks[key];
  }
  return out;
}

/** 这组 tweaks 等于什么都不做吗？ */
function isNeutral(tweaks) {
  const t = withDefaults(tweaks);
  return TWEAK_KEYS.every((k) => t[k] === NEUTRAL[k]);
}

// ── 颜色 ────────────────────────────────────────────────────────────────────────────────────────
//
// 🔴 转色相，并且【把相对亮度原样拉回去】。
//
// 这里原来写的是「只改色相，不动 HSL 的饱和度和明度；色相对亮度的影响是二阶的」。**那句话是错的，
// QA1 在 #1006 r1 用真浏览器证伪了，我自己手算复现了同一组数**：HSL 的 L 跟 WCAG 的相对亮度是两个
// 东西（后者是三个通道的加权和，绿的权重 0.7152、蓝的只有 0.0722），所以在 L 不变的前提下把蓝转向
// 青，亮度会大幅上升：
//
//   ocean-blue   --color-primary-500  #2563eb  白字对比度 5.17:1
//     hueShift -15 → #2594eb          3.22:1   ❌   ← 一个【合法】的偏移，把达标的按钮变成不达标
//     hueShift  -8 → #257deb          4.03:1   ❌   ← 这还是本票正文自己举的例子
//   royal-purple #9333ea 5.38:1  →  hueShift +15 → #c133ea  4.26:1  ❌
//
// 后果落在**按钮**上（`.btn-primary` 是白字压 `--color-primary-500`），而进池那道检查只量
// `.hero__title` / `.hero__sub` 两个选择器 ⟹ 27 个边界读数全绿，却证明不了「在允许的整个区间内
// 这套皮都安全」。
//
// 所以改成：转完色相之后，二分 HSL 的 L，把 WCAG 相对亮度拉回原来那个值。为什么这条路比「把区间
// 收窄」好 —— **它把那个性质变成结构上成立的，而不是在几套主题的两个端点上量出来的**：
// 对比度只是两个亮度的函数，亮度不变 ⟹ 这个颜色与**任何**颜色（白字、黑字、另一个色阶、
// 没被微扰的背景）的对比度全都不变，不用再逐个枚举谁跟谁配对。
// 📌 二分一定收敛：固定 H 和 S，三个通道都随 L 单调不减，所以亮度对 L 单调，目标值必在 [0,1] 内。
// 📌 代价说在明处：偏移之后的颜色不再是「同一个 HSL 明度」的那一档，视觉上是「转了色相、亮度不变」。
//    这正是要的效果 —— 站与站之间看得出不同，而可读性一格都不动。
//
// 🔴 它【不是】严格不变，而是差一个 8 位色深的舍入 —— 这个界是穷举量出来的，不是估的。
// 30 套主题 × 每个色阶 × `hueShift` 的每一度（−15…+15，跳过 0）= **15300 个组合**：
//
//   最大 |相对亮度变化|      0.0021
//   最大 |对比度变化|        0.052   （白字与黑字两个方向都是这个量级）
//   本来 ≥4.5:1、偏移之后掉到 4.5 以下的：**0 个**
//
// 📌 落回 8 位时在 27 个邻居里挑（下面那三层循环）是有必要的，代价也量过：只挑 L 上相邻的三档时，
//    误差是 4.3e-3，而且真的有一个色阶被推过线 —— assurance-forest 的 accent-600 `#97701a`
//    本来就是 4.5176:1，只高出及格线 0.018。搜 27 个邻居把误差压到 2.1e-3，那一个也回到线上。
// 📌 仍然要知道这是**量出来的**、不是证出来的：0.0021 是这 30 套皮的上界。一套自己就贴着 4.5:1
//    的新皮仍可能被一档舍入推过线 —— 那该由**进池那道检查**接住（#1004 的面）。

const HEX = /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;

function hexToRgb(hex) {
  let h = hex.slice(1);
  if (h.length === 3) h = h.split('').map((c) => c + c).join('');
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
}

function rgbToHex(r, g, b) {
  const one = (n) => Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, '0');
  return `#${one(r)}${one(g)}${one(b)}`;
}

function rgbToHsl(r, g, b) {
  const rr = r / 255, gg = g / 255, bb = b / 255;
  const max = Math.max(rr, gg, bb), min = Math.min(rr, gg, bb);
  const l = (max + min) / 2;
  if (max === min) return [0, 0, l];
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h;
  if (max === rr) h = ((gg - bb) / d + (gg < bb ? 6 : 0));
  else if (max === gg) h = (bb - rr) / d + 2;
  else h = (rr - gg) / d + 4;
  return [h * 60, s, l];
}

function hslToRgb(h, s, l) {
  const hh = ((h % 360) + 360) % 360 / 360;
  if (s === 0) return [l * 255, l * 255, l * 255];
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  const one = (t) => {
    let tt = t;
    if (tt < 0) tt += 1;
    if (tt > 1) tt -= 1;
    if (tt < 1 / 6) return p + (q - p) * 6 * tt;
    if (tt < 1 / 2) return q;
    if (tt < 2 / 3) return p + (q - p) * (2 / 3 - tt) * 6;
    return p;
  };
  return [one(hh + 1 / 3) * 255, one(hh) * 255, one(hh - 1 / 3) * 255];
}

/** WCAG 的相对亮度（0..1）。对比度就是两个这个数算出来的，所以它不变，对比度就不变。 */
function relLuminance([r, g, b]) {
  const one = (c) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * one(r) + 0.7152 * one(g) + 0.0722 * one(b);
}

/**
 * 把一个 #rrggbb 的色相转 `deg` 度，**相对亮度保持不变**；认不出的写法原样返回（失败方向是「没变」）。
 *
 * 两类颜色会原样返回，上面 `buildCustomCss` 因此不会为它们写出任何一行：
 *   · 灰色（S=0）、纯黑、纯白 —— 没有色相可转。主题池里 `charcoal-lime`（`#3a3a3a`）就是这一类
 *     （30 套皮 × 每一度里有 600 个组合属于它）。
 *   · 偏移小于一档 8 位色深的 —— 几乎全在很浅的 `*-50` 那几阶，且集中在 1°、2° 这种小角度上
 *     （±15 度那两端只剩 38 个组合是这样）。这不是失效，是「这个角度对这个颜色小于一个色阶」。
 */
function shiftHue(colour, deg) {
  if (!deg || !HEX.test(colour)) return colour;
  const rgb = hexToRgb(colour);
  const target = relLuminance(rgb);
  const [h, s, l] = rgbToHsl(...rgb);
  if (s === 0) return colour;             // 灰的没有色相可转，也就不需要还原亮度
  // 二分 L：固定 H/S 时亮度对 L 单调不减，40 次已经远超 8 位色深能分辨的精度。
  let lo = 0;
  let hi = 1;
  for (let i = 0; i < 40; i += 1) {
    const mid = (lo + hi) / 2;
    if (relLuminance(hslToRgb(h + deg, s, mid)) < target) lo = mid; else hi = mid;
  }
  // 连续解取到之后要落回 8 位，而四舍五入本身就能让亮度差出千分之几。所以在落点周围的 27 个
  // 颜色（每个通道 −1/0/+1）里挑亮度最接近原值的那一个 —— 每个通道最多差 1，色相上看不出来。
  const [br, bg, bb] = hslToRgb(h + deg, s, (lo + hi) / 2);
  let best = null;
  for (const dr of [-1, 0, 1]) {
    for (const dg of [-1, 0, 1]) {
      for (const db of [-1, 0, 1]) {
        const hex = rgbToHex(br + dr, bg + dg, bb + db);
        const off = Math.abs(relLuminance(hexToRgb(hex)) - target);
        if (!best || off < best[0]) best = [off, hex];
      }
    }
  }
  return best[1];
}

// ── 尺寸 ────────────────────────────────────────────────────────────────────────────────────────

/** `4rem` × 1.1 → `4.4rem`。数字部分乘完去掉尾随的 0，单位原样保留。 */
const LENGTH = /^(-?\d*\.?\d+)([a-z%]*)$/i;

/**
 * 🔴 两个哨兵值【照乘，不特判】（作者 2026-08-14 在票上定的）。它们是形状意图不是尺寸：
 * `--radius-button: 9999px` 是胶囊、`0px` 是直角。乘完仍然是同一个形状，所以特判没有收益：
 *
 *   9999px × 0.8  = 7999.2px    仍然是胶囊（按钮高度撑死几十 px，半径几千 px 就是全圆）
 *   9999px × 1.25 = 12498.75px  同上
 *   0px    × 任何数 = 0px        仍然是直角 —— 而且值没变，下面根本不会写出这一行
 *
 * 📌 由此带来的一个覆盖面事实（不是缺陷，但要说出来）：主题池里 10 套 `radius: 'sharp'` 的主题
 * 五个圆角全是 `0px` ⟹ 对它们 `radiusScale` 是空操作。「零乘任何数还是零」在这里是对的语义。
 */
function scaleLength(value, factor) {
  if (factor === 1) return value;
  const m = LENGTH.exec(String(value).trim());
  if (!m) return value;                 // 认不出的写法原样返回
  const n = parseFloat(m[1]) * factor;
  // 去掉浮点噪声（4rem × 1.1 在二进制里是 4.4000000000000004）再去掉尾随 0
  const s = String(Number(n.toFixed(6))).replace(/\.?0+$/, (t) => (t.includes('.') ? '' : t));
  return `${s}${m[2]}`;
}

// ── 生成 custom.css ─────────────────────────────────────────────────────────────────────────────

/** 哪个变量归哪个 tweak 管。判据写在名字的形状上，不逐个列举 —— 新变量按同一规则自动归队。 */
function tweakFor(name) {
  if (/^--color-/.test(name)) return 'hueShift';
  if (/^--radius-/.test(name)) return 'radiusScale';
  if (/^--section-/.test(name)) return 'densityScale';
  return null;
}

/**
 * 基准变量 + tweaks → custom.css 的字节。
 *
 * @param {Array<[string,string]>} baseVars 基准值，形如 [['--color-primary-500', '#2563eb'], …]
 *        —— 它就是「当前这套皮算出来的那一组」，换主题时拿新的一组再调一次本函数（走 G）。
 * @param {object|null|undefined} tweaks
 * @returns {string} custom.css 的完整内容；中性 tweaks 返回空串（AC1 那格要求「全为 0 时与不带
 *        tweaks 的产物逐字节相同」，空串是唯一能保证这一点的产出）。
 */
function buildCustomCss(baseVars, tweaks) {
  if (isNeutral(tweaks)) return '';
  const t = withDefaults(tweaks);
  const out = [];
  for (const [name, value] of baseVars) {
    const which = tweakFor(name);
    if (!which) continue;
    let next = value;
    if (which === 'hueShift') next = shiftHue(value, t.hueShift);
    else if (which === 'radiusScale') next = scaleLength(value, t.radiusScale);
    else if (which === 'densityScale') next = scaleLength(value, t.densityScale);
    if (next !== value) out.push(`  ${name}: ${next};`);
  }
  if (!out.length) return '';
  const said = TWEAK_KEYS.filter((k) => t[k] !== NEUTRAL[k]).map((k) => `${k}=${t[k]}`).join(' · ');
  return `/* site-tweaks: v1 — ${said} (#1006). 生成物：改 site/theme.json 的 tweaks 再重新生成，`
    + `别手改这个文件。 */\n:root {\n${out.join('\n')}\n}\n`;
}

module.exports = {
  TWEAK_BOUNDS,
  TWEAK_KEYS,
  validateTweaks,
  withDefaults,
  isNeutral,
  shiftHue,
  scaleLength,

  buildCustomCss,
};
