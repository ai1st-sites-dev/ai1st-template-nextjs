// ═════════════════════════════════════════════════
// catalogShared.ts — 单格页 `/__catalog/<块>/<形态>` 用到的那几样（#1383；#1458 起只有它一个调用方）
// ═════════════════════════════════════════════════
//
// #1343 建整页索引时这几样写在它的 `page.dev.tsx` 里。#1383 加了单格页，两页共用 ⟹ 搬到这里。
// 🔴 #1458（Chris 2026-09-27）把整页索引 board 退役了：块的唯一可看面是 admin › Blocks & Themes，
//    而那一页的每张卡片嵌的就是单格页（`CatalogPage.tsx` §cellUrl）。所以这里现在只剩单格页在用，
//    但它仍然不是页面：`.ts` 在 dev 下只是普通模块，production 下单格页整个不存在，它也就没有调用方。

import fs from 'fs';
import path from 'path';
import { pagesByLocale } from '@/lib/config';
import type { DynamicPageConfig } from '@/lib/types/config';
import { buildThemeCss } from '../../../scripts/theme-css.js';
import themePool from '../../../scripts/theme-pool.json';
/** 一套主题在单格页眼里的样子（#1458 起从已删的 CatalogBoard 搬到这里）。 */
export interface CatalogTheme {
  id: string;
  label: string;
  /** `public/themes/<sheet>.css` —— 这套主题的**画法表**。 */
  sheet: string;
  /**
   * 这套主题的**皮**：`scripts/theme-css.js` 的 `buildThemeCss()` 现算出来的
   * `@import` 字体表 + `:root{…}`。
   * 🔴 公式只有一份，这里绝不重算 —— `layout.tsx:453-456` 为同一件事留过原话
   *    「翻译器只有一份 …… 重写一遍就是第二份真相，而它分叉时两边都不会红」。
   */
  skinCss: string;
}

/**
 * 🔴 **路径要从 `process.cwd()` 起算，不能靠那几个脚本自己的 `__dirname`。** 它们是普通 node
 *    脚本，默认按 `__dirname` 找 `blocks/` 和 `registry.ts`；而被 webpack 打进 Next 的服务端包
 *    之后 `__dirname` 是**产物目录**（#1343 实测那一版报的是
 *    `ENOENT … .next/dev/server/app/src/lib/sections/registry.generated.ts`）。所以这里把路径显式传进去。
 *    `next dev` 的 cwd 就是 `templates/nextjs`。
 */
const NEXT_DIR = process.cwd();

export const CATALOG_PATHS = {
  registryPath: path.join(NEXT_DIR, 'src', 'lib', 'sections', 'registry.generated.ts'),
  blocksDir: path.join(NEXT_DIR, 'blocks'),
};

interface PoolTheme {
  label?: string;
  colors: { primary: Record<string, string>; accent: Record<string, string> };
  fonts: { heading: string[]; body: string[]; googleFontsUrl?: string };
  settings?: Record<string, unknown>;
  sheet?: string;
}

const pool = themePool as unknown as Record<string, PoolTheme>;

export const sheetPath = (sheet: string) => path.join(NEXT_DIR, 'public', 'themes', `${sheet}.css`);

/**
 * 池里每套主题的 `{ id, label, sheet, skinCss }`。
 * 🔴 皮走 `buildThemeCss` 那一份翻译器，一个公式都不在这里重写（`layout.tsx:453-456` 原话：
 *    「翻译器只有一份 …… 重写一遍就是第二份真相，而它分叉时两边都不会红」）。
 */
export function catalogThemes(): CatalogTheme[] {
  return Object.keys(pool).map((id) => {
    const t = pool[id];
    return {
      id,
      label: t.label || id,
      sheet: t.sheet || id,
      skinCss: buildThemeCss({ colors: t.colors, fonts: t.fonts, settings: t.settings }),
    };
  });
}

/** 那套主题的**画法表**字节；表不在就回一句说明（不假装有）。 */
export function readSheetCss(sheet: string): string {
  const p = sheetPath(sheet);
  return fs.existsSync(p) ? fs.readFileSync(p, 'utf-8')
    : `/* ${path.relative(NEXT_DIR, p)} 不在 —— 这套主题没有画法表 */`;
}

/**
 * `?theme=` 认哪些：**只认池里的 id**，不认的落回第一套（#1383 做什么 2）。
 * 🔴 落回而不是 404：地址栏里打错一个主题 id 不该让整页消失，而「它到底穿的哪套」页面上写着。
 */
export function resolveTheme(themes: CatalogTheme[], requested?: string | null): CatalogTheme | undefined {
  const hit = requested ? themes.find((t) => t.id === requested) : undefined;
  return hit || themes[0];
}

/** `?fill=` 认哪些：`full` / `minimal`，不认的落回 `full`。 */
export function resolveFill(requested?: string | null): 'full' | 'minimal' {
  return requested === 'minimal' ? 'minimal' : 'full';
}

// ── `service-related-pages` 要的那几页夹具（#1343 原话搬过来）──────────────────────────────────
//
// 🔴 **图册自带 `service-related-pages` 要的那几页。** 这是唯一一个**会整块不渲染**的块：它拿
//    `serviceSlug` 去筛**这个站**的页面表，一个子页都筛不到就 `return null`
//    （`ServiceRelatedPagesSection.tsx:52`）。而 `create-site.js` 建出来的站默认一个带 `/` 的 slug
//    都没有 ⟹ 图册不问这个站有什么页面，自己带着夹具。
//
// 🔴 **为什么挂在一个属于图册自己的 locale 键下**：塞进站那个 locale 就是改展示站 —— 页脚、导航、
//    sitemap 全从 `pagesByLocale[<站的 locale>]` 取。挂在一个没有任何路由会问的键上，站那边按构造
//    看不见（app 里对这张表的每一次读取都是按键取，而唯二两处遍历读的是 `locales` 数组）。
export const CATALOG_LOCALE = '__catalog-fixture';
export const CATALOG_SERVICE_SLUG = 'sample-service';

const CATALOG_FIXTURE_PAGES: DynamicPageConfig[] = ['First', 'Second', 'Third'].map((ord, i) => ({
  slug: `${CATALOG_SERVICE_SLUG}/keyword-page-${i + 1}`,
  title: `${ord} Keyword Page`,
  description: 'A keyword page under this service — the catalogue supplies these so the block has something to point at.',
  blocks: [],
}));

/** 幂等：`next dev` 里这个模块只求值一次，但重复调用也只是原样写回同一份。 */
export function registerCatalogFixturePages(): void {
  pagesByLocale[CATALOG_LOCALE] = CATALOG_FIXTURE_PAGES;
}

/**
 * 把展示站**自己那套主题**关掉。
 * 🔴 不关的话页面上会是一份混合体：我们注进去的皮赢了（同名变量、我们排在后面），而**画法**只是
 *    叠在 `/theme.css` 上面 —— 选中的那套主题没写的每一条规则，都从展示站那套里漏上来。
 * 🔴 `/custom.css` 留着：那是站自己的微调层，按 #1006 的设计「换主题时它一个字节都不动」。
 * 🔴 它是一段**解析期就跑**的内联脚本，不是 effect：晚一帧关掉就会先闪一眼别人的画法。
 */
export const OWN_THEME_OFF = "(function(){var l=document.querySelectorAll('link[rel=\"stylesheet\"]');"
  + "for(var i=0;i<l.length;i++){if((l[i].getAttribute('href')||'')==='/theme.css'){l[i].disabled=true;}}})();";

/**
 * #1424 —— Webpixels 那一份 CSS 的地址（`scripts/lib/site-css.js` 写进 `public/site.css`）。
 * 🔴 **只有单格页 `<link>` 它**（#1458 之前还有整页索引）：客户站在 T4 之前不许挂 Bootstrap 的 CSS
 *    （设计稿 B1），验收拿 `grep -rl site.css out/ --include='*.html'` 为空守这一条。
 */
export const SITE_CSS_HREF = '/site.css';
