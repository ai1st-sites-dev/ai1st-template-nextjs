// ══════════════════════════════════════════════════════════════════════════════════════════════════
// /__catalog/<块>/<形态> —— 一个「块 × 形态」一页（#1383，设计文档 D10）
// ══════════════════════════════════════════════════════════════════════════════════════════════════
//
//   /__catalog/hero/media-cover?theme=ember-12&fill=full
//
// 照 FlyonUI 的做法：**一格一个地址**。页面上只有那一个块，没有顶栏、没有页脚、没有图册自己的
// 外壳条 —— 要看这个形态排得怎么样，看到的就该只是它。#1384 / #1385 的 admin 页拿这个地址当
// iframe 的 src（那两张票的 AC 里钉着这个 URL 形状）。
//
// 🔴 **整页索引 `/__catalog` 本票一个字节没删**（票里「不做」点名）：删不删由 #1385 定，
//    `CatalogScroll.tsx` 也归它。这一页是**加**出来的，不是替掉谁。
//
// 🔴 **`page.dev.tsx` 这个文件名是承重的，不是花样。** `next.config.js` 的 `pageExtensions` 在
//    production 下不认 `.dev.tsx`（`:19-21`），于是静态导出时这条路由**根本不存在** —— 客户站
//    不会带上它。它跟上一层那个 `page.dev.tsx` 走的是同一条规矩，判据也是同一条：
//    `NODE_ENV=production npm run build` 之后 `out/` 里 `__catalog` 命中 0。
//
// 🔴 **认不出的 (块,形态) 回 404，认不出的 `theme` / `fill` 落回默认。** 两者方向不同是有意的：
//    地址里点名了一个不存在的块，那是「你要的东西不在」；而主题/填充是**看法**，地址栏里打错一个
//    主题 id 不该让整页消失。落回哪一套写在根元素的 `data-catalog-theme` 上，页面自己说得出来。

import { notFound } from 'next/navigation';
import Footer from '@/components/Footer';
import Header from '@/components/Header';
import SectionRenderer from '@/components/SectionRenderer';
import { defaultLocale } from '@/lib/config';
import type { BlockConfig } from '@/lib/types/config';
import { blockShapeCatalog } from '../../../../../scripts/lib/block-catalog.js';
import { demoDataFor } from '../../../../../scripts/lib/demo-content/index.js';
import { filledOptionalSlots } from '../../../../../scripts/lib/block-manifest.js';
import {
  CATALOG_LOCALE,
  CATALOG_PATHS,
  CATALOG_SERVICE_SLUG,
  OWN_THEME_OFF,
  catalogThemes,
  readSheetCss,
  registerCatalogFixturePages,
  resolveFill,
  resolveTheme,
} from '../../catalogShared';

type Params = { block: string; shape: string };
type Search = Record<string, string | string[] | undefined>;

interface Props {
  params: Promise<Params>;
  searchParams: Promise<Search>;
}

/** `?theme=a&theme=b` 这种重复参数取第一个 —— 不抛，也不把数组塞进比较。 */
const one = (v: string | string[] | undefined): string | undefined => (Array.isArray(v) ? v[0] : v);

export async function generateMetadata({ params, searchParams }: Props) {
  const { block, shape } = await params;
  const sp = await searchParams;
  return {
    title: `${block} / ${shape} — ${one(sp.theme) || '默认主题'} · ${resolveFill(one(sp.fill))}`,
    // 它永远不进静态导出，所以这一行只在开发服务上起作用 —— 留着是因为代价为零。
    robots: { index: false, follow: false },
  };
}

export default async function CatalogCellPage({ params, searchParams }: Props) {
  const { block, shape } = await params;
  const sp = await searchParams;

  const { pairs, manifests } = blockShapeCatalog(CATALOG_PATHS);
  // 🔴 判据是 `blockShapeCatalog()` 现算的那份清单，不是一份手写名单 —— 块和形态都会变
  //    （#1372 一次删掉 4 个块），写死的名单在那天会把好地址判成 404。
  const known = pairs.some((p: { block: string; shape: string }) => p.block === block && p.shape === shape);
  if (!known) notFound();

  const m = manifests.get(block);
  if (!m) notFound();

  const themes = catalogThemes();
  const theme = resolveTheme(themes, one(sp.theme));
  const fill = resolveFill(one(sp.fill));
  const sheetCss = theme ? readSheetCss(theme.sheet) : '';

  registerCatalogFixturePages();

  const data = demoDataFor(m, { minimal: fill === 'minimal' });
  // 这个块的演示数据要指向图册自带的那几页夹具，否则它筛不到子页、整块 `return null`
  // （`ServiceRelatedPagesSection.tsx:52`）。同一处理在整页索引上也有。
  const isRelatedPages = block === 'service-related-pages';
  if (isRelatedPages) data.serviceSlug = CATALOG_SERVICE_SLUG;
  const locale = isRelatedPages ? CATALOG_LOCALE : defaultLocale;

  const cfg: BlockConfig = {
    type: block,
    shape,
    data,
    has: filledOptionalSlots(m, data),
  };

  // 🔴 **外壳区（`header` / `footer`）走的是它们自己的组件，不走 `SectionRenderer`。** 它们有
  //    manifest、有形态、在图册上各占一行（#1353），但按构造**不在 `registry.ts` 里**（那张表是
  //    「页面 JSON 的 type → 组件」，而外壳区不进页面 JSON）—— 交给 SectionRenderer 的结果是
  //    `console.warn` 加一个空页面。它们的内容来自站自己的 `navigation.json`，形态由 `variant`
  //    覆盖（`Footer` 本来就有这个参数，`Header` 的是本票照它加的，站上没有调用点传它）。
  const isRegion = m.region === true;

  return (
    <>
      <script dangerouslySetInnerHTML={{ __html: OWN_THEME_OFF }} />
      {/* 皮在前、画法在后，跟 `buildThemeCss()` 自己拼出来的顺序一样（`theme-css.js`：
          @import → :root → 画法表）。两张都在 <body> 里 ⟹ 文档顺序在 <head> 那几条 <link>
          之后，同名变量、同特异度时它们赢。 */}
      <style data-catalog-skin="" dangerouslySetInnerHTML={{ __html: theme ? theme.skinCss : '' }} />
      <style data-catalog-sheet="" dangerouslySetInnerHTML={{ __html: sheetCss }} />
      {/* 🔴 这层容器**没有任何文字**，它只带读数：AC 要在这一页上量「文字里有没有占位串」和
          「`data-has-*` 有几个」，容器自己往里加字就是往尺子上加噪音。 */}
      <main
        data-catalog-single=""
        data-catalog-block={block}
        data-catalog-shape={shape}
        data-catalog-theme={theme ? theme.id : ''}
        data-catalog-fill={fill}
      >
        {isRegion && block === 'header' ? <Header locale={locale} variant={shape} /> : null}
        {isRegion && block === 'footer' ? <Footer locale={locale} variant={shape} /> : null}
        {isRegion ? null : <SectionRenderer blocks={[cfg]} locale={locale} />}
      </main>
    </>
  );
}
