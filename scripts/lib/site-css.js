'use strict';

// ══════════════════════════════════════════════════════════════════════════════════════════════════
// site-css.js —— 从 brand.json 编出一份 Webpixels CSS，purge 之后写进 `public/site.css`（#1424）
// ══════════════════════════════════════════════════════════════════════════════════════════════════
//
// 设计稿 `docs/superpowers/specs/2026-09-23-bootstrap-webpixels-adoption-design.md` B2 / §1.6 / §5.1。
//
// ── 为什么在 sync-config 里跑，不挂 npm 的 prebuild ─────────────────────────────────────────────
// 容器三处是直接调 `node scripts/sync-config.js && … next build`，不经 npm scripts（`worker/main.go`，
// `grep -n 'node scripts/sync-config.js && ' worker/main.go` 现取）。挂 prebuild 容器跑不到；
// 进 sync-config 则 dev（predev）/ build（prebuild）/ 容器三条路一次覆盖。
//
// ── 链 ───────────────────────────────────────────────────────────────────────────────────────────
//   brand.json 的 colors.primary['500']  →  `$primary: <色>;`  →  `@import "@webpixels/css/all"`
//   📌 #1462 起不再编图标字体：图标是按名内联的 SVG（`scripts/lib/icons.js`），这份 CSS 里没有 `.bi-*`、
//      `public/fonts/` 下也不再拷 woff2（Chris 2026-09-27 拍板「不引字体」）。
//   🔴 `$primary` 必须在 `@import` **之前**赋值（Webpixels 的变量全带 `!default`）。这就是 sass 钉
//      1.79.4 的理由：它对 `@import` 只打弃用警告，更新的版本会把 `@import` 删掉，而换成 `@use`
//      是另一件事（`@use … with (…)` 的写法不同），不在 #1424。
//   🔴 不写 source map：默认会多一份 ~168 KB 的 `.map` 跟着 `public/` 进 `out/`，而产物尾注的
//      `sourceMappingURL=site.css.map` 会让「有没有页面引用 site.css」那条 grep 命中它自己。
//
// ── purge：用 PurgeCSS 的 JS API ──────────────────────────────────────────────────────────────────
// 选它而不是 Next 自己那条路：Next 的 CSS 管线只处理被 import 进 app 的样式表，而这一份按设计**不**
// import 进 app（B1：客户站在 T4 之前不许挂 Bootstrap 的 CSS），它是 `public/` 下的一份静态文件，
// 只有图册那条 dev 路由用 `<link>` 引它。Tailwind 的 content 扫描只管 Tailwind 自己的类。
// PurgeCSS 按「内容里出现过的词」留规则 —— 跟 Tailwind 的 content 扫描同一种判法，词法抽取、不跑代码。
//   content = blocks/**/*.tsx + src/**/*.tsx。
//
// ── RTL（#1473）────────────────────────────────────────────────────────────────────────────────────
// `dir=rtl` 的站（`text-dir.js` §dirForLocale，由 `defaultLocale` 推）：sass → **RTLCSS** → purge → 追加图标翻转。
// 这是 Bootstrap 官方 `bootstrap.rtl.css` 的生成法：`ms-*` / `me-*` / `text-start` / `float-start` 这些起末端工具类
// 整份镜像。LTR 站一步不多（字节与改前相同）。块的 CSS（`public/shapes.css`）不过 RTLCSS —— 它在这份之后单独加载，
// 靠只写逻辑属性在 RTL 下自己成立（`scripts/block-css-logical.test.js`）。

const fs = require('fs');
const path = require('path');

const { RTL_ICON_FLIP } = require('./text-dir.js');

const NEXT_DIR = path.resolve(__dirname, '..', '..');

/** 从 brand 取主色。取不到就抛 —— 编一份「默认蓝」出来是一次静默的掉色。 */
function primaryOf(brand) {
  const c = brand && brand.colors && brand.colors.primary && brand.colors.primary['500'];
  if (typeof c !== 'string' || !/^#[0-9a-fA-F]{3}([0-9a-fA-F]{3})?$/.test(c.trim())) {
    throw new Error(`site.css: brand.json 的 colors.primary['500'] 是 ${JSON.stringify(c)} —— `
      + '要一个 #rgb / #rrggbb；编一份默认色出来等于这个站静默掉色');
  }
  return c.trim();
}

/**
 * #1477 —— 深底（`bg` 填了深色 / `brand` / 深渐变）上的小字：白 .92，不是灰（Chris 2026-09-28：紫→金渐变上 .7 的灰字
 * 看不清）。**全站只有这一条**，各块的 `block.css` 里不再各写一份。
 * 🔴 它按各块【已有的】标记去选，不另发明一个类名：换类名就等于改了深底 / brand 那几格的 HTML，而 #1477 AC3 要那几格
 *    跟改前逐字相同。三种标记：hero / cta 根上的 `data-tone`（小字是 `.text-muted`）、footer 的
 *    `ftr-muted-on-dark`、header 的 `hdr-muted-on-deep`。
 * 🔴 特异度要落在两者之间：压得过 Webpixels 的 `.text-muted`（0-1-0，带 `!important`），压不过块自己点名的
 *    反白规则（`[data-block=…][data-tone=…] .hro-eyebrow-dash` 这类，0-3-0，要纯白）—— 所以这里是 0-2-0。
 * 放在这份 CSS 里是因为它挂全站、在 shapes.css 之前加载（`src/app/layout.tsx`），而 shapes.css 只许装块自己的规则
 * （`scripts/block-build/build-blocks.js` §assertPieceOwnsItsRules）。
 */
const ON_DEEP_MUTED = [
  '[data-tone="dark"] .text-muted,',
  '[data-tone="brand"] .text-muted,',
  '[data-block] .ftr-muted-on-dark,',
  '[data-block] .hdr-muted-on-deep {',
  '  color: rgba(255, 255, 255, .92) !important;',
  '}',
  '',
].join('\n');

/**
 * #1477 —— 深底上**透明**的输入框（`src/components/BlockLeadForm.tsx` 收到 `tone` 时根上挂 `data-tone`）：字 / 占位字 /
 * 边框换成白色那一档。改前是 Webpixels 默认的 `rgba(82,82,82,.5)` 占位字压在 `#0f172a` 上，看不清（#1469 交接点名）。
 * 数值在图册那条紫→金渐变（`#7d52f4 → #f7b733`）上试的：占位字白 .72、边框白 .35。
 */
const ON_DEEP_FORM = [
  'form[data-tone] .form-control,',
  'form[data-tone] .form-select {',
  '  color: #fff;',
  '  border-color: rgba(255, 255, 255, .35);',
  '}',
  'form[data-tone] .form-control::placeholder {',
  '  color: rgba(255, 255, 255, .72);',
  '}',
  'form[data-tone] .form-select option {',
  '  color: #0f172a;',
  '}',
  '',
].join('\n');

/**
 * #1507 —— 新块的主按钮（Webpixels 的 `btn btn-primary`）跟旧块的 `.btn-primary`（`src/app/globals.css`）走**同一把梯子**：
 * 底 / 字 / hover 读 `--btn-primary-bg` / `--btn-primary-ink` / `--btn-primary-hover`（`scripts/lib/button-ink.js` 按这个站的
 * 配色算出来、写进 `theme.css` 的 `:root`）。改前 Webpixels 把底写死成 `$primary` = primary-500 —— ember-12 的 500 是
 * `#907230`，白字声明 4.54:1，14px 的 btn-sm 画出来只有 4.30:1（theme-css 实测）；同一个站的旧按钮早被梯子挪到 600 档。
 * 变量缺席（不经 sync-config 的页面）⟹ 落回 Webpixels 自己那几个值，等于改前。
 * 🔴 为什么收成全站一条：在这之前是各块在自己的 `block.css` 里接（hero / cta / features / pricing /
 *    milestones 各一份），contact / header / footer 没接 ⟹ 每个新块都得记得抄一次，漏了就是 500 档。那五份
 *    留着不删：变量在时值跟这里相同，特异度更高，只是不再是唯一的那一处。
 * 特异度跟 Webpixels 的 `.btn-primary` 相同（0-1-0），排在 `@import` 之后 ⟹ 靠源码次序压过它。
 */
const BTN_PRIMARY_INK = [
  '.btn-primary {',
  '  --x-btn-color: var(--btn-primary-ink, #{color-contrast($primary)});',
  '  --x-btn-bg: var(--btn-primary-bg, #{$primary});',
  '  --x-btn-border-color: var(--btn-primary-bg, #{$primary});',
  '  --x-btn-hover-color: var(--btn-primary-ink, #{color-contrast($primary)});',
  '  --x-btn-hover-bg: var(--btn-primary-hover, #{shade-color($primary, 20%)});',
  '  --x-btn-hover-border-color: var(--btn-primary-hover, #{shade-color($primary, 20%)});',
  '  --x-btn-active-color: var(--btn-primary-ink, #{color-contrast($primary)});',
  '  --x-btn-active-bg: var(--btn-primary-hover, #{shade-color($primary, 20%)});',
  '  --x-btn-active-border-color: var(--btn-primary-hover, #{shade-color($primary, 25%)});',
  '  --x-btn-disabled-color: var(--btn-primary-ink, #{color-contrast($primary)});',
  '  --x-btn-disabled-bg: var(--btn-primary-bg, #{$primary});',
  '  --x-btn-disabled-border-color: var(--btn-primary-bg, #{$primary});',
  '}',
  '',
].join('\n');

/**
 * #1472 —— 站级深浅（`<html data-bs-theme="light|dark">`）下，块里那几处**不是 Webpixels 变量**的浅色。
 * 块没填 `bg` 时跟站走：`block.css` 里原来写死的浅色字面量改读这几个变量，`[data-bs-theme=dark]` 下由浏览器换色，
 * `auto` 站构建时不用知道深浅。只有白（= `--x-body-bg` 的 light 值）是白送的，其余跟 Webpixels 的 neutral 系一个都
 * 不相等 ⟹ light 一侧写原来的字面量（light 站逐像素不变），dark 一侧取 Webpixels **同角色**变量（PM 裁定 2）。
 * 🔴 选择器是 `:root,[data-bs-theme=light]` 而不只是 `:root`：填了 `bg` 的块根上挂 `data-bs-theme="light"`
 *    （`contrast.js` §bsThemeForBg），嵌在深色站里也要把这几个值拉回浅色。
 * 🔴 这几个变量只被 `public/shapes.css`（块的 CSS）读，这份 CSS 里没有一条规则 `var()` 它们 ⟹ purge 的
 *    `variables: true` 会把它们当没人用删光 —— 所以它们在本文件（site-css.js §purgeSiteCss）的 `variables` safelist 里（§SCHEME_VARIABLES）。
 */
const SCHEME_SURFACES = [
  ':root,',
  '[data-bs-theme=light] {',
  '  --scheme-surface-muted: #f1f5f9;',
  '  --scheme-surface-sunken: #e2e8f0;',
  '  --scheme-surface-map: #eef2f7;',
  '  --scheme-ink-strong: #0f172a;',
  '  --scheme-ink: #1e293b;',
  '  --scheme-ink-muted: #64748b;',
  '  --scheme-ink-faint: #94a3b8;',
  '  --scheme-line: #cbd5e1;',
  '  --scheme-primary-ink: var(--x-primary);',
  '}',
  '[data-bs-theme=dark] {',
  '  --scheme-surface-muted: var(--x-secondary-bg);',
  '  --scheme-surface-sunken: var(--x-tertiary-bg);',
  '  --scheme-surface-map: var(--x-secondary-bg);',
  '  --scheme-ink-strong: var(--x-emphasis-color);',
  '  --scheme-ink: var(--x-emphasis-color);',
  '  --scheme-ink-muted: var(--x-secondary-color);',
  '  --scheme-ink-faint: var(--x-tertiary-color);',
  '  --scheme-line: var(--x-border-color);',
  // 主色写的字（不是 `.text-primary` 这类工具类、是块 CSS 自己写的 `color`）：深色站换成 `-text-emphasis`，理由同下面
  // `.text-primary` 那一段。#1472 r3：blog 没封面时的分类名，ember-12 深色站上 3.71:1（QA2 量到）。
  '  --scheme-primary-ink: var(--x-primary-text-emphasis);',
  // 标题色在 light 下是 `inherit`（`$headings-color: inherit`，#1463：旧块的标题靠继承上色），Webpixels 的 dark 那张表
  // 又把它写成 `#fff` ⟹ 深色站上旧块浅底里的标题变白（theme-css-invariants 实测 quote-form 的 h2 1.21:1）。dark 也让它
  // 失效、回到继承，跟 light 一个规矩。
  '  --x-heading-color: initial;',
  '}',
  // 填了 `bg` 的块被拉回 light 之后，块里**继承来**的字色还是 body 在深色站上算出来的浅字（`color` 继承的是算好的值，
  // 不会因为变量换了而重算）⟹ 白底浅字。块根上自己声明一次 `color`，从 light 的变量重算。
  // `:where()` 把特异度压到 0：块自己写的任何 `color`（深底那几档的反白）都赢它，它只赢「继承」。
  ':where([data-block][data-bs-theme=light]) {',
  '  color: var(--x-body-color);',
  '}',
  // 同一个原因的另一半：Webpixels 在 light 下有三个变量的值是关键字 `inherit`（`--x-heading-color` 是 `$headings-color: inherit`
  // 那一行编出来的）。自定义属性写 `inherit` = 从父元素拿这个变量 ⟹ 嵌在深色站里的浅色块，拿到的是 dark 的 `#fff` ——
  // 白底白标题（实测 hero 的 h1 1.01:1）。`initial` = 没有值，`color: var(--x-heading-color)` 失效、回到继承块里的字色，
  // 跟浅色站上它的样子一致。特异度 0-2-0：要压过 Webpixels 的 `[data-bs-theme=light]`（0-1-0）。
  '[data-block][data-bs-theme=light] {',
  '  --x-heading-color: initial;',
  '  --x-alert-color: initial;',
  '  --x-article-mark-color: initial;',
  '}',
  // 深色站上主色 / secondary 写的字：Webpixels 的 `.text-primary` / `.link-primary` / `.link-secondary` 在 dark 下仍然读原色
  // （Bootstrap 的做法是让作者改用 `-emphasis` 那组），主色深的站上就是深字压深底（ember-12 的 #907230 压 #131313 = 4.10:1，
  // secondary 是靛蓝 = 2.96:1）。深色站里换成 Webpixels 给 dark 算好的 `-text-emphasis`（主色往白调 40%）。
  // 🔴 `:not([data-bs-theme=light] *)`：填了 bg 的块被拉回 light，它里面照旧用原色（跟浅色站一样）。
  '[data-bs-theme=dark] .text-primary:not([data-bs-theme=light] *),',
  '[data-bs-theme=dark] .link-primary:not([data-bs-theme=light] *) {',
  '  color: var(--x-primary-text-emphasis) !important;',
  '}',
  // 博客正文的链接同理：Webpixels 的 `.prose a` 写死成主色（特异度 0-1-1，比 Tailwind 的 `prose-a:` 高），深色站上
  // ember-12 是 4.10:1（#1472 r2，QA2 量到）。
  '[data-bs-theme=dark] .prose a:not([data-bs-theme=light] *) {',
  '  color: var(--x-primary-text-emphasis);',
  '}',
  '[data-bs-theme=dark] .link-secondary:not([data-bs-theme=light] *) {',
  '  color: var(--x-secondary-text-emphasis) !important;',
  '}',
  // 轮廓主按钮同理（字 / 描边是主色；块自己接的 `--btn-outline-ink` 是按浅底算的那一档）。hover 照旧铺主色底、白字。
  '[data-bs-theme=dark] .btn-outline-primary:not([data-bs-theme=light] *) {',
  '  --x-btn-color: var(--x-primary-text-emphasis);',
  '  --x-btn-border-color: var(--x-primary-text-emphasis);',
  '}',
  '',
].join('\n');

/** purge 时无条件留下的 §SCHEME_SURFACES 变量（理由见那一段）。 */
const SCHEME_VARIABLES = [/^--scheme-/];

/**
 * #1540 —— `--x-box-shadow-xs`：Webpixels 的按钮读它（`$btn-box-shadow: var(--x-box-shadow-xs)`，`_variables.scss:408`），
 * 而整套 CSS 里没有一处定义它 ⟹ `.btn` 的 box-shadow 失效，`.btn:focus-visible` 那条
 * `box-shadow: var(--x-btn-box-shadow), var(--x-btn-focus-box-shadow)` 也跟着整条失效 —— 而它同时写了 `outline: 0`，
 * 键盘聚焦的按钮看不出任何变化（无障碍）。
 * 值是「透明、零尺寸」：按钮静止态今天就是没有阴影（失效 = none），这里只把焦点环救回来，不给全站按钮添一层新阴影。
 * 放在 `:root` 上、purge 会留下它：`.btn` 的 `--x-btn-box-shadow` 引用着它（`variables: true` 按引用判）。
 */
const SHADOW_TOKENS = [
  ':root {',
  '  --x-box-shadow-xs: 0 0 0 0 transparent;',
  '}',
  '',
].join('\n');

/** 那份 scss 的原文。只有这一处拼它。 */
function siteScss(primary) {
  return [
    '// 生成的 —— scripts/lib/site-css.js（#1424）。$primary 必须在 @import 之前。',
    `$primary: ${primary};`,
    // #1463 —— 标题色回到 Bootstrap 自己的默认 `inherit`（Webpixels 把它改成了 `$gray-900`）。site.css 从本票起挂
    // 全站，而旧块的主题靠**继承**给标题上色：`h1–h4 { color: var(--x-heading-color) }` 一条就把深底上的浅色
    // 标题盖成 #171717（theme-css-invariants 实测 ember-12 的 services-list 标题 1.66:1）。
    '$headings-color: inherit;',
    // #1425 —— 灰字（`.text-muted` / `--x-secondary-color`）从正文色的 .75 提到 .9。Webpixels 的正文色本身是中灰
    // `$gray-600` #525252，.75 压白底只有 4.12:1（声明值），Karla 这类细字体在截图像素上更淡（ember-12 实测 3.39:1），
    // 都不到 4.5。新库 68 处灰字（hero 副标题 / page-header 副标题 / cta 正文 …）共用这一个色，所以改在这里。
    // 深色那张表（`_variables-dark.scss:7`）同一个写法，一起改。两边都写字面色：`$gray-*` 在 @import 之前还没定义。
    '$body-secondary-color: rgba(#525252, .9);',
    '$body-secondary-color-dark: rgba(#d4d4d4, .9);',
    // #1540 —— 阴影：Webpixels 3.0.5 自己的 `_variables.scss:182-184` 把这三个写成 `box-shadow-1` / `-2` / `-3`（少了 `$`），
    // 编出来是 `--x-box-shadow: box-shadow-2` 这种字面串 ⟹ `.shadow` / `.shadow-sm` / 博客卡片悬停全都画不出阴影。
    // 上游 dist 里也是这样，不是我们编译链丢的。值逐字取它本意指的 `$box-shadow-1/2/3`（同一份文件 :162-164）；
    // 写字面量的理由同上面两行：那几个变量在 @import 之前还没定义。
    '$box-shadow-sm: 0 1px 2px 0 rgb(0 0 0 / 0.05);',
    '$box-shadow: 0 1px 3px 0 rgb(0 0 0 / 0.1), 0 1px 2px -1px rgb(0 0 0 / 0.1);',
    '$box-shadow-lg: 0 4px 6px -1px rgb(0 0 0 / 0.1), 0 2px 4px -2px rgb(0 0 0 / 0.1);',
    // 下拉选择框（`BlockLeadForm` 的 `.form-select`）读一个没人定义的 `var(--x-shadow-sm)`（`_variables.scss:479`）⟹ 静止态
    // 和聚焦态的 box-shadow 整条失效 —— 聚焦时 `outline: 0`，只剩边框换色。跟旁边的输入框（`$input-box-shadow`，:447）取同一个值。
    '$form-select-box-shadow: 0px 1px 2px rgba(50, 50, 71, 0.08);',
    '@import "@webpixels/css/all";',
    '',
    SHADOW_TOKENS,
    ON_DEEP_MUTED,
    ON_DEEP_FORM,
    BTN_PRIMARY_INK,
    SCHEME_SURFACES,
  ].join('\n');
}

/** 编译（不 purge）。回 CSS 字符串。 */
function compileSiteCss(primary, { rootDir = NEXT_DIR } = {}) {
  const sass = require('sass');
  const out = sass.compileString(siteScss(primary), {
    loadPaths: [path.join(rootDir, 'node_modules')],
    sourceMap: false,
    // Webpixels / Bootstrap 自己那一大堆弃用警告（@import / 全局函数 / 颜色函数）不是这个站的事，
    // 每次构建打几十行只会把真正要看的日志冲掉。
    quietDeps: true,
    silenceDeprecations: ['import'],
    logger: sass.Logger.silent,
  });
  return out.css;
}

/** #1473 —— RTL 站：整份过 RTLCSS（左右镜像）。放在 purge 之前，跟 Bootstrap 生成 `bootstrap.rtl.css` 同一个次序。 */
function mirrorSiteCss(css) {
  return require('rtlcss').process(css);
}

/** purge 的 content 清单（glob），相对模板根。 */
const PURGE_CONTENT = [
  'blocks/**/*.tsx',
  'src/**/*.tsx',
];

/**
 * 🔴 `:root` 上那组主题色变量无条件留下，不交给 `variables: true` 去判。
 *    它们是**品牌色的对外接口**（`--x-primary` / `--x-primary-rgb` / `-bg-subtle` / `-border-subtle` /
 *    `-text-emphasis`，八个主题色各一组）：Webpixels 从 `$primary` 派生它们，而今天这个块碰巧没有一条
 *    留下来的规则 `var()` 到 `--x-primary` 本身 ⟹ 不留的话它们被删光（实测：换色重编之后
 *    `.btn-primary{--x-btn-bg}` 跟着变，`:root` 里 `--x-primary` 根本不在 —— 验收 1 点名的正是它）。
 *    T2.n 的块、T4 的外壳按 `var(--x-primary)` 写的那一天，缺了它是静默的（`var()` 落回初始值）。
 */
const THEME_COLOR_VARIABLES = [
  /^--x-(primary|secondary|success|info|warning|danger|light|dark)(-rgb|-bg-subtle|-border-subtle|-text-emphasis)?$/,
];

/**
 * purge。`content` 是 glob 数组（相对 rootDir）。回 purge 之后的 CSS 字符串。
 * 🔴 `variables: true`：Webpixels 的 `:root` 里有八百多个 `--x-*` 变量，绝大多数没有规则用它；
 *    PurgeCSS 删的只是**没有任何留下来的声明 `var()` 到它**的那些，而这个块的组件里没有 inline
 *    style 读 `--x-*`（inline 读到的变量 PurgeCSS 看不见，写之前先 grep 组件）。
 */
async function purgeSiteCss(css, { rootDir = NEXT_DIR, content = PURGE_CONTENT } = {}) {
  const { PurgeCSS } = require('purgecss');
  const [res] = await new PurgeCSS().purge({
    content: content.map((g) => path.join(rootDir, g)),
    css: [{ raw: css }],
    // #1472 —— `greedy: [/data-bs-theme/]`：深色站那几段 `[data-bs-theme=dark]` 规则写死留下。PurgeCSS 只在内容里
    //    **同时**出现 `data-bs-theme` 和 `dark` 两个词时才留这类规则；不写死的话，留不留取决于源码里碰巧有没有这两个词
    //    （改前就是靠 `header/Section.tsx` 一条注释留下的，那条注释一清，深色站整站失色、构建照样绿）。
    safelist: { variables: [...THEME_COLOR_VARIABLES, ...SCHEME_VARIABLES], greedy: [/data-bs-theme/] },
    fontFace: true,
    keyframes: true,
    variables: true,
  });
  return res.css;
}

/**
 * sync-config 调的那一个：编 + purge + 写 `public/site.css`。
 * 回 `{ bytes, rawBytes, ms }` 给日志用。
 */
async function writeSiteCss({ brand, rootDir = NEXT_DIR, dir = 'ltr' }) {
  const t0 = Date.now();
  const primary = primaryOf(brand);
  const raw = compileSiteCss(primary, { rootDir });
  const css = await purgeSiteCss(dir === 'rtl' ? mirrorSiteCss(raw) : raw, { rootDir })
    + (dir === 'rtl' ? `\n${RTL_ICON_FLIP}` : '');
  const publicDir = path.join(rootDir, 'public');
  fs.writeFileSync(path.join(publicDir, 'site.css'), css);
  return { primary, dir, bytes: Buffer.byteLength(css), rawBytes: Buffer.byteLength(raw), ms: Date.now() - t0 };
}

module.exports = {
  primaryOf, siteScss, compileSiteCss, mirrorSiteCss, purgeSiteCss, writeSiteCss, PURGE_CONTENT, THEME_COLOR_VARIABLES, ON_DEEP_MUTED, ON_DEEP_FORM, BTN_PRIMARY_INK, SCHEME_SURFACES, SCHEME_VARIABLES, SHADOW_TOKENS,
};
