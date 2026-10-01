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

const fs = require('fs');
const path = require('path');

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
 *    跟改前逐字相同。三种标记：hero-new / cta-new 根上的 `data-tone`（小字是 `.text-muted`）、footer-new 的
 *    `ftr-muted-on-dark`、header-new 的 `hdr-muted-on-deep`。
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
 * 🔴 为什么收成全站一条：在这之前是各块在自己的 `block.css` 里接（hero-new / cta-new / features-new / pricing-new /
 *    milestones 各一份），contact-new / header-new / footer-new 没接 ⟹ 每个新块都得记得抄一次，漏了就是 500 档。那五份
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

/** 那份 scss 的原文。只有这一处拼它。 */
function siteScss(primary) {
  return [
    '// 生成的 —— scripts/lib/site-css.js（#1424）。$primary 必须在 @import 之前。',
    `$primary: ${primary};`,
    // #1463 —— 标题色回到 Bootstrap 自己的默认 `inherit`（Webpixels 把它改成了 `$gray-900`）。site.css 从本票起挂
    // 全站，而旧块的主题靠**继承**给标题上色：`h1–h4 { color: var(--x-heading-color) }` 一条就把深底上的浅色
    // 标题盖成 #171717（theme-css-invariants 实测 ember-12 的 services-list 标题 1.66:1）。
    '$headings-color: inherit;',
    '@import "@webpixels/css/all";',
    '',
    ON_DEEP_MUTED,
    ON_DEEP_FORM,
    BTN_PRIMARY_INK,
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
    safelist: { variables: THEME_COLOR_VARIABLES },
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
async function writeSiteCss({ brand, rootDir = NEXT_DIR }) {
  const t0 = Date.now();
  const primary = primaryOf(brand);
  const raw = compileSiteCss(primary, { rootDir });
  const purged = await purgeSiteCss(raw, { rootDir });
  const publicDir = path.join(rootDir, 'public');
  fs.writeFileSync(path.join(publicDir, 'site.css'), purged);
  return { primary, bytes: Buffer.byteLength(purged), rawBytes: Buffer.byteLength(raw), ms: Date.now() - t0 };
}

module.exports = {
  primaryOf, siteScss, compileSiteCss, purgeSiteCss, writeSiteCss, PURGE_CONTENT, THEME_COLOR_VARIABLES, ON_DEEP_MUTED, ON_DEEP_FORM, BTN_PRIMARY_INK,
};
