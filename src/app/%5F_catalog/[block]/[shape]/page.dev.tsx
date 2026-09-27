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
// 🔴 整页索引 `/__catalog` 在 #1458（Chris 2026-09-27）退役了：块的唯一可看面是 admin › Blocks & Themes，
//    那一页每张卡片嵌的就是这个单格地址。定稿长什么样看设计图册（artifact），已落地的块长什么样看 admin。
//    这一页因此是 admin 预览的渲染引擎，**不是**可以顺手删掉的开发玩具。
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
import Footer from '@blocks/footer/Section';
import Header from '@blocks/header/Section';
import CellOptions from './CellOptions';
import type { IconTable } from '@/components/InlineIcon';
import SectionRenderer from '@/components/SectionRenderer';
import { defaultLocale } from '@/lib/config';
import type { BlockConfig } from '@/lib/types/config';
import { blockShapeCatalog } from '../../../../../scripts/lib/block-catalog.js';
import { demoDataFor } from '../../../../../scripts/lib/demo-content/index.js';
import { filledOptionalSlots } from '../../../../../scripts/lib/block-manifest.js';
import { couplingOf, knobsOf, normalizeKnobs, presetKnobs, presetsOf } from '../../../../../scripts/lib/header-knobs.js';
import { iconTableFor } from '../../../../../scripts/lib/icons.js';
import {
  CATALOG_LOCALE,
  CATALOG_PATHS,
  CATALOG_SERVICE_SLUG,
  HEIGHT_REPORTER,
  OWN_THEME_OFF,
  SITE_CSS_HREF,
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

/**
 * #1458 —— 这个块有哪些开关，从 manifest 读，不写名单：
 *   `slots.options.shape` 形如 `{dark: bool, icons: bool, reverse: bool}` → 每个 `: bool` 前的键是一个开关；
 *   `slots.cta.shape` 里的 `style: "band" | "bar" | "row"` → CTA 条的几种样式；
 *   有 `slots.newsletter` → 订阅框开关。
 * #1462 —— 外加**旋钮**：`slots.options.shape` 里的 `logo: "left" | "center"` 这种枚举（§knobsOf），以及
 *   顶层 `presets`（旋钮组合起的名）和 `knobCoupling`（哪两个旋钮要成对成立）。
 * 全都空 ⟹ 这个块没有开关，页面不画那条工具栏。
 */
function optionMetaOf(m: { slots?: Record<string, { shape?: unknown }>; presets?: unknown; knobCoupling?: unknown } | undefined) {
  const slots = (m && m.slots) || {};
  const optShape = slots.options && typeof slots.options.shape === 'string' ? slots.options.shape : '';
  const optionKeys = Array.from(optShape.matchAll(/(\w+)\s*:\s*bool/g)).map((x) => x[1]);
  const ctaShape = slots.cta && typeof slots.cta.shape === 'string' ? slots.cta.shape : '';
  const styleMatch = ctaShape.match(/style:\s*((?:"[a-z]+"\s*\|?\s*)+)/);
  const ctaStyles = styleMatch ? Array.from(styleMatch[1].matchAll(/"([a-z]+)"/g)).map((x) => x[1]) : [];
  return {
    optionKeys,
    ctaStyles,
    hasNewsletter: 'newsletter' in slots,
    knobs: knobsOf(m) as Array<{ name: string; values: string[] }>,
    presets: presetsOf(m) as Array<Record<string, string>>,
    coupling: couplingOf(m) as [string, string] | null,
  };
}

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
  const meta = optionMetaOf(m);
  const hasOptionBar = meta.optionKeys.length > 0 || meta.ctaStyles.length > 0 || meta.hasNewsletter || meta.knobs.length > 0;
  // 地址栏给的初值：认不出的键落回「关」，认不出的 cta 样式落回 none —— 跟 theme / fill 一样，看法不该让页面消失。
  const wanted = new Set((one(sp.opt) || '').split(',').map((x) => x.trim()).filter(Boolean));
  const ctaWanted = one(sp.cta) || 'none';
  // #1460 —— 被 admin 嵌着时开关在外面那条块级工具栏上，这一页自己那条不画；「新窗口」单开（不带 embed）照旧画。
  const embed = ['1', 'true'].includes(one(sp.embed) || '');
  // #1462 —— 旋钮：初值是这个形态（= 预设）的那组值，地址栏的 `?logo=&menu=&topbar=` 盖上去（每个旋钮一个
  //    独立参数 —— `?opt=` 是开关名的逗号表，塞不下 `键=值`，PM r2 裁定 ③），再纠正一次。认不出的值落回预设。
  const knobBase = (presetKnobs(meta.presets, shape) || {}) as Record<string, string>;
  const knobWanted: Record<string, string> = { ...knobBase };
  for (const k of meta.knobs) { const v = one(sp[k.name]); if (v) knobWanted[k.name] = v; }
  const knobs = meta.knobs.length
    ? normalizeKnobs(knobWanted, { knobs: meta.knobs, presets: meta.presets, coupling: meta.coupling, base: knobBase }) as Record<string, string>
    : {};
  const initial = {
    knobs,
    opts: Object.fromEntries(meta.optionKeys.map((k) => [k, wanted.has(k)])),
    cta: meta.ctaStyles.includes(ctaWanted) ? ctaWanted : 'none',
    newsletter: meta.hasNewsletter && ['1', 'true', 'on'].includes(one(sp.newsletter) || ''),
  };

  return (
    <>
      <script dangerouslySetInnerHTML={{ __html: OWN_THEME_OFF }} />
      {/* #1460 —— 把内容高度报给嵌它的 admin 页（§HEIGHT_REPORTER）。 */}
      <script dangerouslySetInnerHTML={{ __html: HEIGHT_REPORTER }} />
      {/* #1424 —— Webpixels 那一份 CSS，只有这个单格页加载（理由在 catalogShared.ts §SITE_CSS_HREF）。 */}
      <link rel="stylesheet" href={SITE_CSS_HREF} data-catalog-site-css="" />
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
        {/* #1424 / #1455 —— Webpixels 那一版顶栏 / 页脚：内容来自演示内容包（槽位契约），不来自 navigation.json。
            #1458 —— 它们的选项开关（dark / icons / reverse；footer 的 CTA 条 + 订阅框）住在这一页的工具栏里
            （§CellOptions），初值可由地址栏给：`?opt=dark,reverse&cta=band&newsletter=1`；#1462 起旋钮各一个参数：
            `?logo=center&menu=below&topbar=contact`。 */}
        {isRegion && hasOptionBar ? (
          <CellOptions
            block={block}
            shape={shape}
            data={data as Record<string, unknown>}
            has={cfg.has ?? []}
            optionKeys={meta.optionKeys}
            ctaStyles={meta.ctaStyles}
            hasNewsletter={meta.hasNewsletter}
            knobs={meta.knobs}
            presets={meta.presets}
            coupling={meta.coupling}
            iconTable={iconTableFor(block, data) as IconTable}
            initial={initial}
            showBar={!embed}
          />
        ) : null}
        {isRegion ? null : <SectionRenderer blocks={[cfg]} locale={locale} />}
      </main>
    </>
  );
}
