// tweaks.js — 每站微扰（#1006，spec §5.6 / 决策 D2 的第二半 + D10）。
//
// 🔴 改这份文件——**哪怕只改注释**——交付前要真跑一次 `cd dashboard && npm run build`(#1140,来源 #1141)。
//    理由:`dashboard/vite.config.ts` 的 ai1st-tweaks-engine 插件把本文件的**整份文本**(注释也算)
//    拿两条正则扫一遍(`:152` 取 CommonJS 引入语句里那个带引号的模块名、`:155` 数同一种语句出现几次),
//    取到的每个模块名都必须在插件自己那张映射表里、两个计数还必须相等,否则 dashboard 构建**当场失败**。
//    🔴 所以**这段注释自己也不许写出那个语句的字面形状**(带括号带引号的那种)—— 我第一版就写了,
//    而它按同一条正则会被当成一次真的引入 ⟹ 这段警告自己会把构建弄红。
//    ⟹ 注释里出现一句带字面量模块名的示范命令就够让 main 的 `release` 那格变红 —— #1134 的 item 18
//    就是这么红了一轮(`7e298a06` / #1141 是那次的 hotfix)。
//    🔴 「产物逐字节相同 / go-scanner token 流相同」那类尺子对这一条**按构造说不上话**:那一轮它们给的
//    是真读数(按 token 流确实零行为),红的是构建本身。想提前知道会不会红,可以拿同样两条正则
//    自己跑一遍这三份文件:`templates/nextjs/scripts/{tweaks,theme-settings,theme-presets}.js`。
//
// 同一套主题装到 10 个站上，今天那 10 个站的 CSS 逐字节相同。这一层给每个站一组**小偏移**，
// 让它们看起来不重样，而偏移**只碰 CSS 变量、不碰布局**（布局一动就要重跑五条不变量，
// 而 tweaks 是每站一次、全程无人审）。
//
// 🔴🔴 这三个偏移**三维都在起作用了**（#1078，2026-08-18；上一版这里写的是「只有一个真的在起
// 作用」，那句话在 #1078 落地那一刻起就不成立了）。下面每个数都是在本票的交付上量的：
//
//   hueShift       **活的**。83 套主题表全部用 `var(--color-primary-*)` 取颜色（83/83，本次实测），
//                  所以偏移改了颜色变量，整个站跟着变。
//   radiusScale    **活的**（#1078 之前几乎等于零）。80/83 套主题表现在把块的圆角写成
//                  `calc(var(--radius-block) * N)`，N 取自 `sheet-recipes.js:114` 的
//                  `RADIUS_STEPS = [1, 3, 5, 7]` ⟹ 基准 0.25rem 上是 4 / 12 / 20 / 28px 四族、各 20 套
//                  （实测各 20：N=1 那族写的是不带 calc 的 `var(--radius-block)`）。
//                  不用它的 3 套是 `hero-media-*` 那三份手写实证表（0/3，本次 grep）。
//                  🔴 幅度是**乘法**，所以它与这套主题自己的圆角成正比：0.8–1.25 的全程 = 0.45 ×
//                  该主题的圆角 = **1.8 / 5.4 / 9.0 / 12.6px**（真浏览器实测，#1078 AC1）。
//                  **最小那一族（4px，20 套）全程只有 1.8px，比改造前按钮那 3.6px 还小** —— 要让它
//                  也肉眼可辨得动 `TWEAK_BOUNDS`，而 #1078 正文写明不许碰它，所以那一格留给 PM 裁。
//                  `--radius-button`（`globals.css` 三个按钮类）和 `tailwind.config.ts` 映射出来的
//                  `rounded-md/lg/xl/2xl`（`src/` 下共 11 处，本次实测：Footer 5 · Header 4 ·
//                  BlogIndexPage 1 · `globals.css` 1）照旧。
//   densityScale   **活的**（同上）。同样 80/83 套用 `var(--section-block-pad)` / `var(--section-block-gap)`。
//                  真浏览器实测（amber-20，0.9↔1.15）：**11 个不同块**的 padding 拉开 16.0–22.4px、
//                  gap 拉开 8.0–12.0px（#1078 AC1，QA2 独立复现）。`.section-padding` 照旧 —— 它管的是
//                  主题表没接管的那几块（本次实测 `src/` 下 7 处：`globals.css` 里 4 行 = 定义 1 +
//                  @media 3，另有 Footer / BlogIndexPage / BlogPostPage 各用它一次）。
//
// 三个基准变量（`--radius-block` / `--section-block-pad` / `--section-block-gap`）的默认值住在
// `src/app/globals.css` 的 `:root`，本文件的 `BLOCK_SHAPE_BASE` 与它逐字相同 —— 名字不在那份基准里
// 的变量 `buildCustomCss` 一个字都不会写，滑块也就动不了它。改一处要同时改另一处。
//
// 历史（别删，它解释了为什么会有 #1078）：Chris 2026-08-17 在 appdev 上直接看到拖 `Corner roundness`
// 看不出变化（旁边那组 `Corner style` 预设是方角 ↔ 药丸，差两个数量级）、拖 `Spacing` 只有 Footer 动。
// 他的裁定是**三个偏移全部回到「系统自动、不暴露」**，Customize 面板里的三个滑块和 Shuffle 按钮
// 已经撤掉（#1066 r2 只撤界面，本文件的键、`TWEAK_BOUNDS`、校验、生成路径一行没动）。
// 🔴 **后两维现在有效了，但用户面上仍然没有滑块** —— 撤掉它们的是 #1066 那次裁定，而「把滑块摆回
// 用户面」是**另一张票**（本票落地时还没有这张票）。谁要给这两维加控件、加档位、加测试，先回来读这一段。
//
// 🔴 这三个旋钮一律是相对偏移，不许绝对值。理由是换主题那条流程：整份换掉 theme.css 之后，同样的
// 偏移套到新皮上仍然有意义；绝对值会把新主题的配色覆盖掉 = 等于没换。
//
// 📌 #1038 起 custom.css 里**也可以有绝对值**（站主选的一组配色 / 一档圆角 / 一对字体），但那一层
// 住在 `scripts/theme-presets.js`，**不在本文件的 `TWEAK_BOUNDS` 里** —— 那张表的每一项是数值
// 区间，装不下一个名字。本文件对它的全部认识只有 `buildCustomCss` 的第三个参数：一组「先把基准
// 换成这个值」的覆盖，加一条要写在第一行的字体表地址。理由（含把名字塞进 TWEAK_BOUNDS 会同时
// 发生的五件事）写在 theme-presets.js 的文件头。
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
 * 🔴 也要知道那份检查今天量的是什么：`theme-css-invariants.mjs` 量三张单子 —— `TEXT_TARGETS`
 * （`.hero__title` / `.hero__sub`，首页必须有）、#1046 条 9 补的 `MOVED_TEXT_TARGETS`（cta-banner 和
 * page-header 的标题/副标题，在哪一页出现就在那一页量）、以及 **#1038 补的 `CONTROL_TARGETS`**
 * （`.btn-primary` / `.btn-accent` / `.announcement-bar__link` / `.services-nav__link`，同样是在哪出现
 * 就在哪量，一个都没量到算 finding）。
 * 📌 这里原来写着「按钮上的字不在里面」—— **那句话在 #1038 之前是对的**，QA1 在 #1006 抓到的就是它。
 * 留着这段是因为它解释了上面那段为什么要费劲把亮度拉回去：当时那个盲区是真的。
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

/**
 * 微扰要乘的那一组基准值 → [[变量名, 值], …]（#1037 从 `sync-config.js` 的 `baseVarsForTweaks()`
 * 里搬出来的，**逐行同样的算法**，只是现在有两个调用方）。
 *
 * 第二个调用方是 dashboard 的 Customize 弹窗：它要在浏览器里现算「这三个旋钮会把页面变成什么样」，
 * 而那份预览只有在**跟构建算的是同一件事**时才值钱。留在 sync-config 里就得在 TypeScript 里再写一遍。
 *
 * 🔴 只取本层认识的三族（`--color-*` / `--radius-*` / `--section-*`）：阴影改了会动对比度观感、
 * 字体没有可乘的量（fontScale 不在 #1006）。
 *
 * @param colors      `{ primary: {50:…,…}, accent: {…} }` —— 页面上真正生效的那套调色板
 * @param settingsDecls `settingsToCssVars()` 吐出来的整条声明（`--radius-lg: 0.5rem;`），或 []
 */
/** #1078 —— 主题表里块的圆角与留白的基准。与 `src/app/globals.css` 的 `:root` 逐字相同。 */
const BLOCK_SHAPE_BASE = [
  ['--radius-block', '0.25rem'],
  ['--section-block-pad', '0.5rem'],
  ['--section-block-gap', '0.25rem'],
];

function baseVarsFrom(colors, settingsDecls = []) {
  const out = [];
  for (const [shade, value] of Object.entries((colors && colors.primary) || {})) {
    out.push([`--color-primary-${shade}`, value]);
  }
  for (const [shade, value] of Object.entries((colors && colors.accent) || {})) {
    out.push([`--color-accent-${shade}`, value]);
  }
  const shapes = (settingsDecls || [])
    .map((decl) => /^\s*(--[A-Za-z0-9-]+)\s*:\s*(.+?);?\s*$/.exec(decl))
    .filter(Boolean)
    .filter((m) => /^--(radius|section)-/.test(m[1]))
    .map((m) => [m[1], m[2].trim()]);
  out.push(...shapes);
  // #1078 —— 主题表里块的圆角与留白的基准，见 `globals.css` 的同名三行（值逐字相同）。
  //
  // 🔴 它们**必须在这份基准里**，否则滑块动不了它们：`buildCustomCss` 只为它认识基准的那些变量
  // 写覆盖行，名字不在这里的变量 custom.css 一个字都不会写 —— 表里的 `var(--radius-block)` 就
  // 永远读到 globals.css 的默认值，拖到头也纹丝不动。这正是本票要治的那个病的形状。
  //
  // 🔴 它们是**常量**，不来自这套主题的风格设定，所以**不计进 `shapeCount`**。那个数回答的是
  // 另一个问题 ——「这套主题自己说了圆角/留白吗」—— 有两处按它分支（`sync-config.js` 的风格设定
  // 那段、`CustomizeModal` 用它判能不能实时预览）。把常量算进去会让「没写风格设定的主题」看起来
  // 像写了，那两处会一起改判。
  out.push(...BLOCK_SHAPE_BASE);
  return { vars: out, shapeCount: shapes.length };
}

/**
 * `globals.css` 的 `:root` 里那些圆角/留白的默认值 → [[名, 值], …]。
 *
 * #1118 从 `sync-config.js` 的 `globalsRootDefaults()` 搬过来的，**逐行同样的解析**，只是现在
 * 有两个调用方：构建那一侧读磁盘上的文件，dashboard 的 Customize 预览由 vite 插件在 Node 里
 * 读同一个文件（浏览器里没有磁盘）。两边解析出来的必须是同一组名字和同一组值，所以解析这件事
 * 只留一份 —— 传进来的是文件内容，读文件由各自的调用方负责。
 *
 * @param cssText `src/app/globals.css` 的内容
 */
function rootShapeDefaults(cssText) {
  const out = [];
  const src = typeof cssText === 'string' ? cssText : '';
  const at = src.indexOf(':root {');
  if (at < 0) return out;
  const block = src.slice(at, src.indexOf('}', at));
  for (const m of block.matchAll(/(--(?:radius|section)-[A-Za-z0-9-]+)\s*:\s*([^;]+);/g)) {
    out.push([m[1], m[2].trim()]);
  }
  return out;
}

/**
 * 这个站的微扰要乘的那一组基准值 —— 「有风格设定就用它、没有就落回 `globals.css` 的默认值」
 * 这个二选一。
 *
 * #1118 从 `sync-config.js` 的 `baseVarsForTweaks()` 搬过来的，**算法一行没改**。为什么要搬：
 * Customize 面板现在也要为**没换过装的站**（`theme.json` 的 `applied` 为 false）现算这组基准，
 * 而那些站的颜色和风格设定住在它自己的 `brand.json` 里。同一个二选一写两遍，第一次分叉的时候
 * 预览就开始对老板说假话 —— 而那正是 #1037 当初宁可不预览也要避免的那件事。
 *
 * @param colors        这个站页面上真正生效的那套调色板（`brand.colors`，换过装的站是注册表那套）
 * @param settingsDecls `settingsToCssVars()` 吐出来的整条声明，或 []
 * @param rootDefaults  `rootShapeDefaults()` 的产出 —— 没有风格设定时落回的那一组
 * @returns `{ vars, shapeCount, fromSettings }`；`fromSettings` = 形状那两族是不是这套风格设定给的
 */
function baseVarsForSite(colors, settingsDecls, rootDefaults = []) {
  const withSettings = baseVarsFrom(colors, settingsDecls);
  if (withSettings.shapeCount) {
    return { vars: withSettings.vars, shapeCount: withSettings.shapeCount, fromSettings: true };
  }
  const { vars } = baseVarsFrom(colors, []);
  // 🔴 #1078 —— 按名字去重，`globals.css` 里已经有的不再追加一遍。`baseVarsFrom()` 自带
  // `--radius-block` / `--section-block-pad` / `--section-block-gap` 三个常量，而
  // `rootShapeDefaults()` 是按 `--radius-*` / `--section-*` 前缀扫 `:root` 的，正好也扫到那三行
  // ⟹ 不去重的话 custom.css 里每个都写两遍（值一样，纯噪音）。
  const have = new Set(vars.map(([n]) => n));
  vars.push(...(rootDefaults || []).filter(([n]) => !have.has(n)));
  return { vars, shapeCount: 0, fromSettings: false };
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
// 后果落在**按钮**上（`.btn-primary` 是白字压 `--color-primary-500`），而当时进池那道检查只量
// `.hero__title` / `.hero__sub` 两个选择器 ⟹ 27 个边界读数全绿，却证明不了「在允许的整个区间内
// 这套皮都安全」。（那个盲区 #1038 补上了 —— 但下面这条「把亮度拉回去」的做法照旧承重：
// 它让性质在**构造上**成立，而检查只在被跑到的那些页面上成立。）
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
// 那 30 套主题 × 每个色阶 × `hueShift` 的每一度（−15…+15，跳过 0）= **15300 个组合**：
// 🔴 语料写在这里(#1140,来源 #1083):这 30 套是**当时注册表的全部**,也就是今天 `themes.js` 里的
//    `retiredThemes`。🔴 #1161(2026-08-23)之后 `themes` 就是池子那 **80 套**,退役那 30 套是并列的
//    `retiredThemes` 导出、**不在 `themes` 里**(这一句以前写的是「今天注册表是 110 套」,已经不成立;
//    现读:`Object.keys(themes).length` = 80 · `Object.keys(retiredThemes).length` = 30)。
//    而**这次穷举没有在池子那 80 套上跑过** —— 所以 15300 这个数不是「今天的组合数」,它是那一次实验的
//    规模。别把它当成现状读数;要今天的数就重跑一次那三层循环。
//
//   最大 |相对亮度变化|      0.0021
//   最大 |对比度变化|        0.052   （白字与黑字两个方向都是这个量级）
//   本来 ≥4.5:1、偏移之后掉到 4.5 以下的：**0 个**
//
// 📌 落回 8 位时在 27 个邻居里挑（下面那三层循环）是有必要的，代价也量过：只挑 L 上相邻的三档时，
//    误差是 4.3e-3，而且真的有一个色阶被推过线 —— assurance-forest 的 accent-600 `#97701a`
//    本来就是 4.5176:1，只高出及格线 0.018。搜 27 个邻居把误差压到 2.1e-3，那一个也回到线上。
// 📌 仍然要知道这是**量出来的**、不是证出来的：0.0021 是**那 30 套**皮的上界(语料见上一段)。一套自己就贴着 4.5:1
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
 *     （那 30 套皮 × 每一度里有 600 个组合属于它 —— 同一次穷举，语料见 §颜色 那段）。
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
 * 基准变量 + tweaks（+ #1038 的绝对项）→ custom.css 的字节。
 *
 * 两层怎么叠：**先把基准换成绝对值，再在它上面施加偏移**。选了一组配色又拖了色相滑块，得到的是
 * 「这组配色转了 N 度」—— 反过来（先偏移再覆盖）会让滑块变成空操作，那是老板拖了没反应。
 *
 * 🔴 写出来的判据是「跟 theme.css 说的不一样」，不是「跟基准不一样」：custom.css 的全部作用就是
 * 覆盖 theme.css，跟它一字不差的一行写进去只是噪音。所以下面比的是 `next !== value`，其中
 * `value` 恒是**主题给的那个值**，而 `from` 才是算的时候用的起点。
 *
 * @param {Array<[string,string]>} baseVars 基准值，形如 [['--color-primary-500', '#2563eb'], …]
 *        —— 它就是「当前这套皮算出来的那一组」，换主题时拿新的一组再调一次本函数（走 G）。
 * @param {object|null|undefined} tweaks
 * @param {{vars?: Array<[string,string]>, fontImport?: string|null}} [absolute]
 *        #1038 的绝对项，由 `scripts/theme-presets.js` 的 `presetVars()` 算出来。
 *        · `vars` —— 直接写死的值（配色 / 圆角 / 字体族）。名字不在 `baseVars` 里的照样写出去
 *          （比如没写风格设定的站没有 `--radius-button` 这个基准，而圆角档要给它一个值）。
 *        · `fontImport` —— 字体表地址。🔴 它必须是文件的**第一行**：CSS 规定 `@import` 只能出现
 *          在样式表最前面，排到 `:root {` 后面浏览器整条丢掉，症状是「字体没换」而不是报错。
 * @returns {string} custom.css 的完整内容；中性 tweaks 且没有绝对项时返回空串（AC1 那格要求
 *        「全为 0 时与不带 tweaks 的产物逐字节相同」，空串是唯一能保证这一点的产出）。
 */
function buildCustomCss(baseVars, tweaks, absolute) {
  const overrides = new Map((absolute && absolute.vars) || []);
  const fontImport = (absolute && absolute.fontImport) || null;
  if (isNeutral(tweaks) && !overrides.size && !fontImport) return '';
  const t = withDefaults(tweaks);
  const out = [];
  const written = new Set();
  const emit = (name, from, themeValue) => {
    const which = tweakFor(name);
    let next = from;
    if (which === 'hueShift') next = shiftHue(from, t.hueShift);
    else if (which === 'radiusScale') next = scaleLength(from, t.radiusScale);
    else if (which === 'densityScale') next = scaleLength(from, t.densityScale);
    if (next !== themeValue) { out.push(`  ${name}: ${next};`); written.add(name); }
  };
  for (const [name, value] of baseVars) {
    if (!tweakFor(name) && !overrides.has(name)) continue;
    emit(name, overrides.has(name) ? overrides.get(name) : value, value);
  }
  // 绝对项里那些【基准里根本没有】的变量。`--radius-button` 是常客：没写风格设定的站，
  // globals.css 的 `:root` 里没有它，而圆角档必须给它一个值，否则「胶囊按钮」这一档表达不出来。
  for (const [name, value] of overrides) {
    if (written.has(name)) continue;
    if (baseVars.some(([n]) => n === name)) continue;   // 上面那轮见过、只是算出来跟主题一样
    emit(name, value, null);
  }
  if (!out.length && !fontImport) return '';
  const said = TWEAK_KEYS.filter((k) => t[k] !== NEUTRAL[k]).map((k) => `${k}=${t[k]}`).join(' · ');
  const chose = (absolute && absolute.chose) || {};
  const chosen = Object.keys(chose).map((k) => `${k}=${chose[k]}`).join(' · ');
  const head = [chosen && `${chosen} (#1038)`, said && `${said} (#1006)`].filter(Boolean).join(' · ');
  const lines = [];
  if (fontImport) lines.push(`@import url("${fontImport}");`);
  lines.push(`/* site-tweaks: v1 — ${head}. 生成物：改 site/theme.json 的 tweaks / presets `
    + '再重新生成，别手改这个文件。 */');
  if (out.length) lines.push(`:root {\n${out.join('\n')}\n}`);
  return `${lines.join('\n')}\n`;
}

module.exports = {
  TWEAK_BOUNDS,
  TWEAK_KEYS,
  NEUTRAL,
  baseVarsFrom,
  rootShapeDefaults,
  baseVarsForSite,
  validateTweaks,
  withDefaults,
  isNeutral,
  shiftHue,
  scaleLength,

  buildCustomCss,
};
