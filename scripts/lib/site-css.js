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
//                                         →  `@import "bootstrap-icons/font/bootstrap-icons"`
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
//   content = blocks/**/*.tsx + src/**/*.tsx；外加一份 safelist：数据里写着的图标名（§iconClassesIn）。

const fs = require('fs');
const path = require('path');

const NEXT_DIR = path.resolve(__dirname, '..', '..');

/** 图标字体：`public/` 下的落点（`site.css` 里的 `@font-face` 指着它）。 */
const ICON_FONT_PUBLIC = '/fonts/bootstrap-icons.woff2';

/** 从 brand 取主色。取不到就抛 —— 编一份「默认蓝」出来是一次静默的掉色。 */
function primaryOf(brand) {
  const c = brand && brand.colors && brand.colors.primary && brand.colors.primary['500'];
  if (typeof c !== 'string' || !/^#[0-9a-fA-F]{3}([0-9a-fA-F]{3})?$/.test(c.trim())) {
    throw new Error(`site.css: brand.json 的 colors.primary['500'] 是 ${JSON.stringify(c)} —— `
      + '要一个 #rgb / #rrggbb；编一份默认色出来等于这个站静默掉色');
  }
  return c.trim();
}

/** 那份 scss 的原文。只有这一处拼它。 */
function siteScss(primary) {
  return [
    '// 生成的 —— scripts/lib/site-css.js（#1424）。$primary 必须在 @import 之前。',
    `$primary: ${primary};`,
    '@import "@webpixels/css/all";',
    `$bootstrap-icons-font-src: url("${ICON_FONT_PUBLIC}") format("woff2");`,
    '@import "bootstrap-icons/font/bootstrap-icons";',
    '',
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
 * 数据里写着的图标名 → 要留下的 `bi-<名>` 类。
 * 🔴 为什么不把数据文件直接当 content：组件里是 `bi-${icon}` 拼出来的，数据里只有 `house-door`，
 *    PurgeCSS 按词比对，`bi-house-door` 这个词在哪儿都没出现过 ⟹ 规则被删、图标不显示，而构建是绿的
 *    （实测：把演示内容包加进 content，purge 后 `.bi-house-door` 0 条）。所以按字段取：数据里每一个
 *    叫 `icon` 的字符串值，都是一个 Bootstrap Icons 的名字（槽位契约这么定的）。
 */
function iconClassesIn(value, out = new Set()) {
  if (Array.isArray(value)) { for (const v of value) iconClassesIn(v, out); return out; }
  if (value && typeof value === 'object') {
    for (const [k, v] of Object.entries(value)) {
      if (k === 'icon' && typeof v === 'string' && /^[a-z0-9-]+$/.test(v)) out.add(`bi-${v}`);
      else iconClassesIn(v, out);
    }
  }
  return out;
}

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

/** 今天的数据来源只有图册那一份（演示内容包）。T3 接真站时把站自己的页面数据也喂进来。 */
function demoIconClasses() {
  const { DEMO_CONTENT } = require('./demo-content');
  return [...iconClassesIn(DEMO_CONTENT)].sort();
}

/**
 * purge。`content` 是 glob 数组（相对 rootDir）。回 purge 之后的 CSS 字符串。
 * 🔴 `variables: true`：Webpixels 的 `:root` 里有八百多个 `--x-*` 变量，绝大多数没有规则用它；
 *    PurgeCSS 删的只是**没有任何留下来的声明 `var()` 到它**的那些，而这个块的组件里没有 inline
 *    style 读 `--x-*`（inline 读到的变量 PurgeCSS 看不见，写之前先 grep 组件）。
 */
async function purgeSiteCss(css, { rootDir = NEXT_DIR, content = PURGE_CONTENT, safelist = demoIconClasses() } = {}) {
  const { PurgeCSS } = require('purgecss');
  const [res] = await new PurgeCSS().purge({
    content: content.map((g) => path.join(rootDir, g)),
    css: [{ raw: css }],
    safelist: { standard: safelist, variables: THEME_COLOR_VARIABLES },
    fontFace: true,
    keyframes: true,
    variables: true,
  });
  return res.css;
}

/**
 * sync-config 调的那一个：编 + purge + 写 `public/site.css`，外加把图标字体拷进 `public/fonts/`。
 * 回 `{ bytes, rawBytes, ms }` 给日志用。
 */
async function writeSiteCss({ brand, rootDir = NEXT_DIR }) {
  const t0 = Date.now();
  const primary = primaryOf(brand);
  const raw = compileSiteCss(primary, { rootDir });
  const purged = await purgeSiteCss(raw, { rootDir });
  const publicDir = path.join(rootDir, 'public');
  fs.writeFileSync(path.join(publicDir, 'site.css'), purged);
  const font = path.join(rootDir, 'node_modules', 'bootstrap-icons', 'font', 'fonts', 'bootstrap-icons.woff2');
  fs.mkdirSync(path.join(publicDir, 'fonts'), { recursive: true });
  fs.copyFileSync(font, path.join(publicDir, ICON_FONT_PUBLIC));
  return { primary, bytes: Buffer.byteLength(purged), rawBytes: Buffer.byteLength(raw), ms: Date.now() - t0 };
}

module.exports = {
  primaryOf, siteScss, compileSiteCss, purgeSiteCss, writeSiteCss, iconClassesIn, demoIconClasses,
  PURGE_CONTENT, ICON_FONT_PUBLIC, THEME_COLOR_VARIABLES,
};
