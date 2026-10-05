// #961 的四张风格设定表 + 它们的翻译函数。#1002 把它们从 `src/lib/themeSettings.ts` 搬到这里。
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
// 🔴 为什么搬：这四张表现在有【两个】消费者，而它们跑在两个不同的世界里。
//   · `src/lib/themeSettings.ts` —— TypeScript，被 layout.tsx 塞进换装预览脚本（浏览器里跑）
//   · `scripts/theme-css.js`     —— 普通 node 脚本，构建时和换主题时生成 `theme.css`
// node 脚本 require 不了 .ts，所以表必须住在普通 JS 里，由 .ts 那份再导出。**这份是唯一的一份**
// （`themeSettings.ts` 现在只剩类型 + 转口），两个消费者读的还是同一个对象，预览和构建不可能对不上。
//
// 🔴 每一组的第一个档位必须与 globals.css `:root` 里的默认值逐字相同，那是「没写风格设定的老站
//    一个像素都不许变」的实现方式：老站不产生任何覆盖，就落在 :root 的默认值上。

// 圆角五档 / 阴影四个 —— #1586 起【只发给存量站】，表挪到下面「存量站兼容」那一段（SITE_LEGACY_RADIUS / SITE_LEGACY_SHADOW）。
//    新模板里没有一处 CSS 读 `--radius-{DEFAULT,md,lg,xl,2xl}` / `--shadow-*`（它们的读者是 #1426 随 Tailwind 退场删掉的
//    那份配置），所以新站自己不再定义它们；圆角里唯一活着的是按钮那一个（`--radius-button`，见 BUTTON_SHAPE）。

// 留白 —— 只落在 globals.css 的 `.section-padding` 一条上（#961 正文写死的收窄口径：
// 不动全局的 spacing scale）。那一条是段落外壳 `BlockSection` 的上下留白（#1541）。
// 两个键 = 它的两档：base / lg(992)。🔴 只有纵向：左右边距归 Bootstrap 的 `.container`，
// 横向那三个键（x / xSm / xLg）#1541 删掉了（PM 2026-10-04 裁定）。
const DENSITY = {
  standard: { y: '4rem', yMd: '6rem' },
  compact: { y: '3rem', yMd: '4rem' },
  airy: { y: '6rem', yMd: '9rem' },
};

// ── 存量站兼容：横向那三个只发给站，不进新模板（#1541 r2，PM 2026-10-04 裁定）──────────────────
//
// 🔴 新模板**不消费**它们（左右归 `.container`），但它们**有消费者 = 存量站**：在野的每一个站
//    都烤着 #1541 之前那份 layout.tsx，它从自己那张 5 键 DENSITY 表派生出风格设定变量名集合
//    `SETN`（15 个），再用**计数**判「平台发全了吗」：`setFull=(scN>=SETN_N)`。少发这三个
//    ⟹ 12 < 15 ⟹ 试穿时 `dropSheet()` + 'settings incomplete'，画法静默不换（#1123 要治的那句话）。
//    而那段代码住在站自己的仓里，不会自己升级 ⟹ 发往站的名字集合【只许增不许减】。
//
// 🔴 为什么不放回上面那张 DENSITY 表：新站的 `SETN` 就是从那张表派生的。放回去 ⟹ 此后新建的站
//    也是 15，下面那条摘除判据永远不会成立。放在这里 ⟹ 新站派生出 12、生成的 theme.css /
//    custom.css 不含这三个名字，只有 `settingsToSiteCssVars()`（dashboard 试穿发给站的那一跳）带上它们。
//
// 🔴 值是**真值**，逐字照搬 #1541 之前 DENSITY 表里那三列 / 数值形状那三个系数：老站真的拿它们
//    画左右留白（它自己 globals.css 里的 `.section-padding`），发占位值会把老站试穿时的左右边距画错。
//
// 📌 摘除判据（不是「过一阵子」）：**在野的站没有一个的 `SETN` 还含 `--section-x` / `--section-xSm`
//    / `--section-xLg`** —— 也就是每个站仓 `scripts/theme-settings.js` 的 DENSITY 都已不含这三个键
//    （两个模板仓 + 所有已建成的站仓逐个量，不是只看模板仓）。到那天删这张表、删下面两处 `forSite`
//    分支、`settingsToSiteCssVars` 退回成 `settingsToCssVars` 的别名，并把守卫
//    `scripts/site-settings-contract.test.js` 里那份冻结名单同步收窄。
const SITE_LEGACY_DENSITY_X = {
  standard: { x: '1rem', xSm: '1.5rem', xLg: '2rem' },
  compact: { x: '1rem', xSm: '1.25rem', xLg: '1.5rem' },
  airy: { x: '1.5rem', xSm: '2rem', xLg: '3rem' },
};
// 数值形状的同一组系数（相对 standard 那一档，跟上面 standard 那一行同比例）。
const SITE_LEGACY_DENSITY_X_MULT = { x: 1, xSm: 1.5, xLg: 2 };

// ── 存量站兼容 ②：圆角五档 + 阴影四个，同样只发给站，不进新模板（#1586，PM 2026-10-05 裁定）──────────
//
// 🔴 跟上面横向三个**同一个理由、同一条路**：#1586 之前建的站，`layout.tsx` 的 `SETN` 是从它自己那张表里的
//    RADIUS（5 键）+ SHADOW（4 键）+ DENSITY 派生的，试穿时按**个数**判发全了没有。平台少发这 9 个 ⟹ 每个存量站
//    `settings incomplete`。新站 `SETN` 不再含它们（layout.tsx 那张 S 表里没有这两组），新站的 theme.css / custom.css
//    也不再写它们 —— 只有 `settingsToSiteCssVars()` 带上。
//
// 🔴 值：圆角是**真值**（枚举那三档逐字是 #1586 之前的 RADIUS 表；数值形状按同一组比例从 `radius` 算），存量站
//    Apply 时用它自己仓里那份翻译器算的也是这几个数。阴影**只能是常量**：#1586 把主题池的 `shadowStrength` 拿掉了，
//    平台这一侧已经没有「这套主题的阴影多深」可发。取 #1586 之前 globals.css `:root` 的默认值（= 原 SHADOW.soft）——
//    那正是存量站拿到一份不带 `shadowStrength` 的设定时自己会落回的值。
//    📌 剩下的差别说在明处：存量站 Apply 时读的是**它自己仓里**的主题池（还带 `shadowStrength`），所以在 #1426 之前建、
//    页面上真有 `shadow-*` 类的站上，试穿与 Apply 的阴影深浅可以不同（今天这种元素两个：语言切换下拉、博客列表卡片）。
//
// 📌 摘除判据（同上一段的写法）：**在野的站没有一个的 `SETN` 还含 `--radius-{DEFAULT,md,lg,xl,2xl}` / `--shadow-*`**
//    —— 也就是每个站仓 `src/app/layout.tsx` 那张 S 表里都已没有 radius / shadow 两组（两个模板仓 + 所有已建成的站仓
//    逐个量）。到那天删这三张表、删下面的 `forSite` 分支，并把 `scripts/site-settings-contract.test.js` 的冻结名单同步收窄。
const SITE_LEGACY_RADIUS = {
  subtle: { DEFAULT: '0.25rem', md: '0.375rem', lg: '0.5rem', xl: '0.75rem', '2xl': '1rem' },
  sharp: { DEFAULT: '0px', md: '0px', lg: '0px', xl: '0px', '2xl': '0px' },
  round: { DEFAULT: '0.5rem', md: '0.75rem', lg: '1rem', xl: '1.5rem', '2xl': '2rem' },
};
// 数值形状：五档相对 DEFAULT 的比例，取自上面 `subtle` 那一档（1 : 1.5 : 2 : 3 : 4）⟹ `radius: 4`（px）与 `subtle` 逐字相同。
const SITE_LEGACY_RADIUS_MULT = { DEFAULT: 1, md: 1.5, lg: 2, xl: 3, '2xl': 4 };
const SITE_LEGACY_SHADOW = {
  DEFAULT: '0 1px 3px 0 rgb(0 0 0 / 0.1), 0 1px 2px -1px rgb(0 0 0 / 0.1)',
  sm: '0 1px 2px 0 rgb(0 0 0 / 0.05)',
  md: '0 4px 6px -1px rgb(0 0 0 / 0.1), 0 2px 4px -2px rgb(0 0 0 / 0.1)',
  lg: '0 10px 15px -3px rgb(0 0 0 / 0.1), 0 4px 6px -4px rgb(0 0 0 / 0.1)',
};

// 按钮形状 —— 新模板里圆角唯一活着的那一个值：`.btn`（`scripts/lib/site-css.js` §BTN_RADIUS）和旧块的
// `.btn-primary` 一族（globals.css）都读它。客户的「Corner style」（`theme-presets.js` 的 CORNERS）也只管它（#1586）。
// 🔴 必须独立于卡片 / 图片：否则「胶囊」会把每一张卡片也变成胶囊（#961 正文点名的那个后果）。
const BUTTON_SHAPE = {
  rounded: '0.5rem',
  square: '0px',
  pill: '9999px',
};

/**
 * 查档位表 —— 问的是「这张表自己有没有这个键」，不是「查出来是不是真值」。
 *
 * 🔴 #953（来源 #961，QA3 报的）：上面四张表都是普通对象字面量，所以 `constructor` /
 * `__proto__` / `toString` / `hasOwnProperty` 这四个词在原型链上查得到东西、算真值。
 * `BUTTON_SHAPE` 的表值是**字符串**，于是一条固定的垃圾会被原样写进页面样式：
 *
 *   buttonShape: 'constructor'  ⟹  `--radius-button: function Object() { [native code] };`
 */
function own(table, token) {
  if (typeof token !== 'string' || !Object.prototype.hasOwnProperty.call(table, token)) return undefined;
  return table[token];
}

/**
 * 把一份风格设定翻成 CSS 变量声明（`--section-y: 4rem;` 这种）。新模板自己的 CSS 用这一份：
 * 产出的只有 `--section-y` / `--section-yMd` / `--radius-button`（#1586 之后圆角五档和阴影不在这里，见 SITE_LEGACY_RADIUS）。
 *
 * 认不出来的档位【整组跳过】，不是塞个瞎猜的值：跳过意味着那一组落回 globals.css `:root` 的
 * 默认值，也就是老站今天的样子 —— 失败方向是「没变」，不是「变成别的」。
 *
 * 🔴 两种形状（#1003）：手写的 30 套用**档位词**（`radius: 'round'`），生成的主题用**数值**
 * （`radius: 4`，px），因为每站微扰（#1006）是整套缩放，缩放一个枚举词没有意义。同一套主题不许
 * 混写，schema 拦着（`schemas/theme-tokens.schema.json`）。判据只有一个：`radius` 是不是数字。
 */
function settingsToCssVars(s) {
  return translate(s, false);
}

/**
 * 同一份翻译，外加「存量站兼容」那条尾巴 —— **只给 dashboard 试穿发往站的那一跳用**
 * （`ThemeModal` 的 `settingsCss`）。
 *
 * 跟 `settingsToCssVars()` 是同一个函数、同一条形状分支、同一个 `rem()`，多出来的只有存量站还在数的那 12 个名字：
 * `SITE_LEGACY_DENSITY_X` 横向三个 + `SITE_LEGACY_RADIUS` 五个 + `SITE_LEGACY_SHADOW` 四个（为什么、什么时候删，写在那几张表上面）。
 * 🔴 生成 theme.css / custom.css 的那几个调用方**不许**改用它：那是新模板自己的 CSS，那 12 个名字在那里没有消费者。
 */
function settingsToSiteCssVars(s) {
  return translate(s, true);
}

function translate(s, forSite) {
  if (!s) return [];
  if (typeof s.radius === 'number') return numericSettingsToCssVars(s, forSite);
  return enumSettingsToCssVars(s, forSite);
}

/**
 * 数值形状 → 同一批 CSS 变量。
 *
 * 🔴 变量名与档位数量跟枚举形状**逐个相同**，下游不该知道这套主题用的是哪种形状。
 * 📌 `radius` 这个数今天只喂存量站那条尾巴（`forSite`）：新模板里没有任何 CSS 读 `--radius-{DEFAULT,md,lg,xl,2xl}`
 *    （读它们的那份 Tailwind 配置 #1426 删了），#1586 起新站不再定义它们。
 */
function numericSettingsToCssVars(s, forSite) {
  const out = [];
  const px = (n) => `${Math.round(n * 1000) / 1000}px`;
  if (forSite && typeof s.radius === 'number' && Number.isFinite(s.radius)) {
    for (const [k, mult] of Object.entries(SITE_LEGACY_RADIUS_MULT)) out.push(`--radius-${k}: ${px(s.radius * mult)};`);
  }
  if (forSite) for (const [k, v] of Object.entries(SITE_LEGACY_SHADOW)) out.push(`--shadow-${k}: ${v};`);
  if (typeof s.density === 'number' && Number.isFinite(s.density)) {
    const d = s.density;
    const rem = (n) => `${Math.round(n * d * 1000) / 1000}rem`;
    // 基准是 DENSITY.standard 那一档（也就是 globals.css :root 的默认值）。
    out.push(`--section-y: ${rem(4)};`, `--section-yMd: ${rem(6)};`);
    if (forSite) {
      for (const [k, mult] of Object.entries(SITE_LEGACY_DENSITY_X_MULT)) out.push(`--section-${k}: ${rem(mult)};`);
    }
  }
  const button = own(BUTTON_SHAPE, s.buttonShape);
  if (button) out.push(`--radius-button: ${button};`);
  return out;
}

function enumSettingsToCssVars(s, forSite) {
  const out = [];
  const radius = forSite ? own(SITE_LEGACY_RADIUS, s.radius) : undefined;
  if (radius) for (const [k, v] of Object.entries(radius)) out.push(`--radius-${k}: ${v};`);
  if (forSite) for (const [k, v] of Object.entries(SITE_LEGACY_SHADOW)) out.push(`--shadow-${k}: ${v};`);
  const density = own(DENSITY, s.density);
  if (density) for (const [k, v] of Object.entries(density)) out.push(`--section-${k}: ${v};`);
  const legacyX = forSite ? own(SITE_LEGACY_DENSITY_X, s.density) : undefined;
  if (legacyX) for (const [k, v] of Object.entries(legacyX)) out.push(`--section-${k}: ${v};`);
  const button = own(BUTTON_SHAPE, s.buttonShape);
  if (button) out.push(`--radius-button: ${button};`);
  return out;
}

module.exports = {
  DENSITY, BUTTON_SHAPE, SITE_LEGACY_DENSITY_X, SITE_LEGACY_RADIUS, SITE_LEGACY_SHADOW, settingsToCssVars, settingsToSiteCssVars,
};
