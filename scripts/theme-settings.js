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

// 圆角 —— 对应 tailwind 的 borderRadius 档位（DEFAULT/md/lg/xl/2xl；full 不在内）
const RADIUS = {
  subtle: { DEFAULT: '0.25rem', md: '0.375rem', lg: '0.5rem', xl: '0.75rem', '2xl': '1rem' },
  sharp: { DEFAULT: '0px', md: '0px', lg: '0px', xl: '0px', '2xl': '0px' },
  round: { DEFAULT: '0.5rem', md: '0.75rem', lg: '1rem', xl: '1.5rem', '2xl': '2rem' },
};

// 阴影 —— 对应 boxShadow 档位（DEFAULT/sm/md/lg）
const SHADOW = {
  soft: {
    DEFAULT: '0 1px 3px 0 rgb(0 0 0 / 0.1), 0 1px 2px -1px rgb(0 0 0 / 0.1)',
    sm: '0 1px 2px 0 rgb(0 0 0 / 0.05)',
    md: '0 4px 6px -1px rgb(0 0 0 / 0.1), 0 2px 4px -2px rgb(0 0 0 / 0.1)',
    lg: '0 10px 15px -3px rgb(0 0 0 / 0.1), 0 4px 6px -4px rgb(0 0 0 / 0.1)',
  },
  none: { DEFAULT: 'none', sm: 'none', md: 'none', lg: 'none' },
  strong: {
    DEFAULT: '0 4px 8px -1px rgb(0 0 0 / 0.18), 0 2px 4px -2px rgb(0 0 0 / 0.12)',
    sm: '0 2px 4px 0 rgb(0 0 0 / 0.1)',
    md: '0 10px 18px -3px rgb(0 0 0 / 0.2), 0 4px 8px -4px rgb(0 0 0 / 0.14)',
    lg: '0 20px 32px -6px rgb(0 0 0 / 0.26), 0 8px 14px -8px rgb(0 0 0 / 0.18)',
  },
};

// 留白 —— 只落在 globals.css 的 `.section-padding` 一条上（#961 正文写死的收窄口径：
// 不动 tailwind 全局的 spacing scale，那会牵动 972 次使用 / 102 个类名）。
// 四个键对应它今天那四档：base / sm(640) / md(768) / lg(1024)。
const DENSITY = {
  standard: { y: '4rem', x: '1rem', xSm: '1.5rem', yMd: '6rem', xLg: '2rem' },
  compact: { y: '3rem', x: '1rem', xSm: '1.25rem', yMd: '4rem', xLg: '1.5rem' },
  airy: { y: '6rem', x: '1.5rem', xSm: '2rem', yMd: '9rem', xLg: '3rem' },
};

// 按钮形状 —— 独立于全局圆角的一个值。
// 🔴 必须独立：否则「胶囊」会把每一张卡片也变成胶囊（#961 正文点名的那个后果）。
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
 * 把一份风格设定翻成 CSS 变量声明（`--radius-lg:0.5rem;` 这种）。
 *
 * 认不出来的档位【整组跳过】，不是塞个瞎猜的值：跳过意味着那一组落回 globals.css `:root` 的
 * 默认值，也就是老站今天的样子 —— 失败方向是「没变」，不是「变成别的」。
 *
 * 🔴 两种形状（#1003）：手写的 30 套用**档位词**（`radius: 'round'`），生成的主题用**数值**
 * （`radius: 4`，px），因为每站微扰（#1006）是整套缩放，缩放一个枚举词没有意义。同一套主题不许
 * 混写，schema 拦着（`schemas/theme-tokens.schema.json`）。判据只有一个：`radius` 是不是数字。
 */
function settingsToCssVars(s) {
  if (!s) return [];
  if (typeof s.radius === 'number') return numericSettingsToCssVars(s);
  return enumSettingsToCssVars(s);
}

/**
 * 数值形状 → 同一批 CSS 变量。
 *
 * 🔴 变量名与档位数量跟枚举形状**逐个相同** —— 消费它们的是 tailwind.config.ts 里那些
 * `var(--radius-*)` / `var(--shadow-*)`（#961/#986 接的），下游不该知道这套主题用的是哪种形状。
 *
 * 🔴 每一档的算法都写成「相对 DEFAULT 的比例」，比例取自枚举表里 `subtle` 那一档（0.25/0.375/
 * 0.5/0.75/1 rem = 1 : 1.5 : 2 : 3 : 4）。这样 `radius: 4`（px）算出来的五档与 `subtle` 逐字相同，
 * 也就是说数值形状能表达枚举形状的每一个档位,而不是另起一套手感。
 */
function numericSettingsToCssVars(s) {
  const out = [];
  const px = (n) => `${Math.round(n * 1000) / 1000}px`;
  if (typeof s.radius === 'number' && Number.isFinite(s.radius)) {
    const r = s.radius;
    for (const [k, mult] of Object.entries({ DEFAULT: 1, md: 1.5, lg: 2, xl: 3, '2xl': 4 })) {
      out.push(`--radius-${k}: ${px(r * mult)};`);
    }
  }
  if (typeof s.shadowStrength === 'number' && Number.isFinite(s.shadowStrength)) {
    const a = s.shadowStrength;
    const a2 = Math.round(a * 100) / 100;
    const soft = Math.round(a * 50) / 100;   // 第二段阴影一向比第一段淡一半（照 SHADOW.soft 的比例）
    out.push(`--shadow-DEFAULT: 0 1px 3px 0 rgb(0 0 0 / ${a2}), 0 1px 2px -1px rgb(0 0 0 / ${a2});`);
    out.push(`--shadow-sm: 0 1px 2px 0 rgb(0 0 0 / ${soft});`);
    out.push(`--shadow-md: 0 4px 6px -1px rgb(0 0 0 / ${a2}), 0 2px 4px -2px rgb(0 0 0 / ${a2});`);
    out.push(`--shadow-lg: 0 10px 15px -3px rgb(0 0 0 / ${a2}), 0 4px 6px -4px rgb(0 0 0 / ${a2});`);
  }
  if (typeof s.density === 'number' && Number.isFinite(s.density)) {
    const d = s.density;
    const rem = (n) => `${Math.round(n * d * 1000) / 1000}rem`;
    // 基准是 DENSITY.standard 那一档（也就是 globals.css :root 的默认值）。
    out.push(`--section-y: ${rem(4)};`, `--section-x: ${rem(1)};`, `--section-xSm: ${rem(1.5)};`,
      `--section-yMd: ${rem(6)};`, `--section-xLg: ${rem(2)};`);
  }
  const button = own(BUTTON_SHAPE, s.buttonShape);
  if (button) out.push(`--radius-button: ${button};`);
  return out;
}

function enumSettingsToCssVars(s) {
  const out = [];
  const radius = own(RADIUS, s.radius);
  if (radius) for (const [k, v] of Object.entries(radius)) out.push(`--radius-${k}: ${v};`);
  const shadow = own(SHADOW, s.shadow);
  if (shadow) for (const [k, v] of Object.entries(shadow)) out.push(`--shadow-${k}: ${v};`);
  const density = own(DENSITY, s.density);
  if (density) for (const [k, v] of Object.entries(density)) out.push(`--section-${k}: ${v};`);
  const button = own(BUTTON_SHAPE, s.buttonShape);
  if (button) out.push(`--radius-button: ${button};`);
  return out;
}

module.exports = { RADIUS, SHADOW, DENSITY, BUTTON_SHAPE, settingsToCssVars };
