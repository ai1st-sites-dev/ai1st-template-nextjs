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
import type { Preset, Widget } from './CellOptions';
import KnobBar from './KnobBar';
import SectionRenderer from '@/components/SectionRenderer';
import { defaultLocale } from '@/lib/config';
import type { BlockConfig } from '@/lib/types/config';
import { blockShapeCatalog } from '../../../../../scripts/lib/block-catalog.js';
import { demoDataFor } from '../../../../../scripts/lib/demo-content/index.js';
import { filledOptionalSlots } from '../../../../../scripts/lib/block-manifest.js';
import { couplingOf, knobsOf, normalizeKnobs, presetBooleans, presetForShape, presetsOf } from '../../../../../scripts/lib/header-knobs.js';
import { iconTableFor, iconTablesFor } from '../../../../../scripts/lib/icons.js';
// knobsOf / presetsOf 两份（header-knobs.js #1462 · block-knobs.js #1463）读的是同一份 manifest 声明、
// 对合法声明给出同一结果；这一页用 header-knobs 那份，并掉哪一份归 T3。
import { booleanOptionsOf, effectiveKnobs, presetNameFor } from '../../../../../scripts/lib/block-knobs.js';
import { bgFromParam, normalizeBg, normalizeColor } from '../../../../../scripts/lib/contrast.js';
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
 *   `slots.options.shape` 形如 `{topbar: bool, icons: bool}` → 每个 `: bool` 前的键是一个开关。
 * #1462 —— 外加**旋钮**：`slots.options.knobs: [{name, values}]`（§knobsOf），以及顶层
 *   `presets: [{name, shape, knobs, options?}]`（旋钮组合起的名；#1468 起还能带布尔，header 的 topbar）和可选的
 *   `knobCoupling`（哪两个旋钮要成对成立）。
 *   位置是 PM 2026-09-27 19:01 冻结的那份（#1462 / #1463 共用）。
 * #1464 —— **部件**：哪个槽（`options` 以外）的 shape 以 `{style: "a" | "b" …` **开头**，它就是一个带样式单选的
 *   可选部件（none + 那几种样式），地址栏参数就是槽名（`?form=inline`）。按槽派生、不写死名字 —— 这里原来是
 *   两条写死的判据（`cta` 槽里的 `style:` · 有没有 `newsletter` 槽），footer 定稿第 2 版把 CTA 样式挪成旋钮、
 *   订阅框换成 `form` 之后两条一起失效（PM #1464 r1 阻断 2 / r3 点名 1）。🔴 要「开头」：`cta` 槽里还有
 *   `buttons: [{…, style: "solid" | …}]`，不锚定开头就会把按钮样式读成部件样式。
 *   Go 那侧 `manager/template_blocks.go` §manifestOptionMeta 是同一套判据（各写一份是有意的：Go / TS 共享不了）。
 * #1469 —— 开头那个键也可以叫 `mode`（footer 的 `form` 改成 `{mode: "teaser" | "full", id?: string}`：表单是站级资产，
 *   块只选画法）。只放宽键名、不放宽开头锚定；选中一档时写回的也是这个键（`Widget.key`）。
 * #1469 —— 外加**颜色槽**（第一个 `kind: color` 的槽，跟 §knobOverrides 同一条判据）：外壳块的色板也住 CellOptions。
 * 全都空 ⟹ 这个块没有开关，页面不画那条工具栏。
 */
function optionMetaOf(m: { slots?: Record<string, { shape?: unknown; knobs?: unknown; kind?: unknown; swatches?: unknown }>; presets?: unknown; knobCoupling?: unknown } | undefined) {
  const slots = (m && m.slots) || {};
  const optShape = slots.options && typeof slots.options.shape === 'string' ? slots.options.shape : '';
  const optionKeys = Array.from(optShape.matchAll(/(\w+)\s*:\s*bool/g)).map((x) => x[1]);
  const widgets = Object.keys(slots).filter((k) => k !== 'options').sort().flatMap((slot) => {
    const shape = typeof slots[slot]?.shape === 'string' ? (slots[slot].shape as string) : '';
    const hit = shape.match(/^\{\s*(style|mode):\s*((?:"[a-z]+"\s*\|?\s*)+)/);
    return hit ? [{ slot, key: hit[1], styles: Array.from(hit[2].matchAll(/"([a-z]+)"/g)).map((x) => x[1]) }] : [];
  });
  const colorSlot = Object.keys(slots).find((s) => slots[s] && slots[s].kind === 'color') || null;
  const swatches = colorSlot && Array.isArray(slots[colorSlot].swatches) ? (slots[colorSlot].swatches as string[]) : [];
  return {
    optionKeys,
    widgets: widgets as Widget[],
    colorSlot,
    swatches,
    knobs: knobsOf(m) as Array<{ name: string; values: string[] }>,
    presets: presetsOf(m) as Preset[],
    coupling: couplingOf(m) as [string, string] | null,
  };
}

type ManifestForKnobs = { slots?: Record<string, { kind?: string; required?: boolean; swatches?: string[]; choices?: Record<string, string[]>; shape?: string }>; parts?: string[]; presets?: unknown };

/**
 * #1463 —— 「预设 + 旋钮」那一类**页面块**（今天是 hero-new）：地址栏 → 这一格的 data。
 *   `?textAlign=center&image=top&form=full`  旋钮（名字取 manifest 的 `slots.options.knobs`）
 *   `?opt=reverse`                           布尔修饰（`options.shape` 那串里的 `: bool`，跟外壳区块同一个参数）
 *   `?bg=%230f172a` / `?bg=brand`            颜色槽
 *   `?parts=proof,stats`                     只留这几个部件（`-` = 一个都不留；不写 = 全留）
 *   `?eyebrow.style=dash`                    词表子字段（manifest 的 `choices`）
 * 认不出的值落回演示内容里那一份（跟 theme / fill 一样：看法不该让页面消失）。
 * 🔴 这一段只管非外壳块。外壳区块（header-new / footer-new）走 CellOptions，那是 #1458 / #1462 的面。
 */
function knobOverrides(m: ManifestForKnobs, shape: string, data: Record<string, unknown>, sp: Search) {
  const knobs = knobsOf(m) as Array<{ name: string; values: string[] }>;
  const booleans = booleanOptionsOf(m);
  const slots = m.slots || {};
  const colorSlot = Object.keys(slots).find((s) => slots[s] && slots[s].kind === 'color') || null;
  const parts = Array.isArray(m.parts) ? m.parts : [];
  const choices: { key: string; values: string[] }[] = [];
  for (const [slot, spec] of Object.entries(slots)) {
    for (const [sub, values] of Object.entries((spec && spec.choices) || {})) {
      // 数组取值的子字段（`form.fields`）不做成单选。
      if (new RegExp(`${sub}\\s*:\\s*\\[`).test(spec.shape || '')) continue;
      choices.push({ key: `${slot}.${sub}`, values });
    }
  }
  const opts = { ...((data.options as Record<string, unknown>) || {}) };
  for (const k of knobs) {
    const v = one(sp[k.name]);
    if (v && k.values.includes(v)) opts[k.name] = v;
  }
  if (one(sp.opt) !== undefined) {
    const on = new Set((one(sp.opt) || '').split(',').map((x) => x.trim()));
    for (const b of booleans) opts[b] = on.has(b);
  }
  data.options = opts;
  if (colorSlot) {
    const c = normalizeColor(one(sp.bg));
    if (c) data[colorSlot] = c;
  }
  const partsParam = one(sp.parts);
  const keep = partsParam === undefined ? parts : partsParam.split(',').map((x) => x.trim()).filter((x) => parts.includes(x));
  for (const p of parts) if (!keep.includes(p)) delete data[p];
  const chosen: Record<string, string> = {};
  for (const c of choices) {
    const [slot, sub] = c.key.split('.');
    const v = one(sp[c.key]);
    const obj = (data[slot] && typeof data[slot] === 'object' ? { ...(data[slot] as Record<string, unknown>) } : null);
    if (obj && v && c.values.includes(v)) { obj[sub] = v; data[slot] = obj; }
    chosen[c.key] = obj && typeof obj[sub] === 'string' ? String(obj[sub]) : c.values[0];
  }
  const eff = effectiveKnobs(m, shape, opts);
  return {
    knobs: knobs.map((k) => ({ name: k.name, values: k.values })),
    presets: (presetsOf(m) as Preset[]).map((p) => ({ name: p.name, shape: p.shape, knobs: p.knobs })),
    booleans,
    swatches: colorSlot ? (slots[colorSlot].swatches || []) : null,
    parts,
    choices,
    current: {
      knobs: eff,
      preset: presetNameFor(m, eff),
      booleans: Object.fromEntries(booleans.map((b) => [b, opts[b] === true])),
      bg: colorSlot && typeof data[colorSlot] === 'string' ? String(data[colorSlot]) : '',
      parts: keep,
      choices: chosen,
    },
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

  // #1463 —— 旋钮类页面块：地址栏先改 data，再算 `data-has-*`（关掉的部件不许还挂着「有它」）。
  const knobBar = m.region !== true && knobsOf(m).length ? knobOverrides(m, shape, data as Record<string, unknown>, sp) : null;

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
  const hasOptionBar = meta.optionKeys.length > 0 || meta.widgets.length > 0 || meta.knobs.length > 0 || meta.colorSlot !== null;
  // 地址栏给的初值：认不出的键落回「关」，认不出的部件样式落回 none —— 跟 theme / fill 一样，看法不该让页面消失。
  const wanted = new Set((one(sp.opt) || '').split(',').map((x) => x.trim()).filter(Boolean));
  // #1460 —— 被 admin 嵌着时开关在外面那条块级工具栏上，这一页自己那条不画；「新窗口」单开（不带 embed）照旧画。
  const embed = ['1', 'true'].includes(one(sp.embed) || '');
  // #1462 —— 旋钮：初值是这个形态（= 预设）的那组值，地址栏的 `?logo=&menu=&topbar=` 盖上去（每个旋钮一个
  //    独立参数 —— `?opt=` 是开关名的逗号表，塞不下 `键=值`，PM r2 裁定 ③），再纠正一次。认不出的值落回预设。
  const own = presetForShape(meta.presets, shape);
  const knobBase: Record<string, string> = own ? { ...own.knobs } : {};
  const knobWanted: Record<string, string> = { ...knobBase };
  for (const k of meta.knobs) { const v = one(sp[k.name]); if (v) knobWanted[k.name] = v; }
  const knobs = meta.knobs.length
    ? normalizeKnobs(knobWanted, { knobs: meta.knobs, presets: meta.presets, coupling: meta.coupling, base: knobBase }) as Record<string, string>
    : {};
  // #1468 —— 归预设管的开关（topbar）：地址栏没写 `?opt=` ⟹ 跟这个形态（= 预设）走；写了（哪怕是空的）就按它。
  //    admin 与单格页工具栏只在「开着别的开关」或「topbar 跟这个形态的预设不一样」时才写 `opt`（CatalogPage §cellUrl ·
  //    CellOptions），所以预设卡的地址不带它、落回预设；Custom 停在别的形态上时写出来。
  const ownBooleans = own ? (presetBooleans(meta.presets, own.name) as Record<string, boolean>) : {};
  const optGiven = one(sp.opt) !== undefined;
  const initial = {
    knobs,
    opts: Object.fromEntries(meta.optionKeys.map((k) => [k, !optGiven && k in ownBooleans ? ownBooleans[k] : wanted.has(k)])),
    widgets: Object.fromEntries(meta.widgets.map((w) => {
      const v = one(sp[w.slot]);
      return [w.slot, v && w.styles.includes(v) ? v : 'none'];
    })),
    // #1469 —— `?bg=` 盖在演示内容那一份上；认不出的值落回演示内容（看法不该让页面消失）。解析跟旋钮页面块同一个函数族。
    bg: meta.colorSlot ? (bgFromParam(one(sp.bg)) ?? normalizeBg((data as Record<string, unknown>)[meta.colorSlot])) : null,
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
            #1458 —— 它们的选项开关（header 的 topbar / icons；footer 的 CTA 条 + 订阅框）住在这一页的工具栏里
            （§CellOptions），初值可由地址栏给：`?opt=topbar,icons`；#1462 起旋钮各一个参数：
            `?logo=center&menu=below`；#1464 起部件也是槽名一个参数：`?form=inline`。 */}
        {isRegion && hasOptionBar ? (
          <CellOptions
            block={block}
            shape={shape}
            data={data as Record<string, unknown>}
            has={cfg.has ?? []}
            optionKeys={meta.optionKeys}
            widgets={meta.widgets}
            colorSlot={meta.colorSlot}
            swatches={meta.swatches}
            knobs={meta.knobs}
            presets={meta.presets}
            coupling={meta.coupling}
            iconTable={iconTableFor(block, data) as IconTable}
            initial={initial}
            showBar={!embed}
          />
        ) : null}
        {knobBar && !embed ? <KnobBar {...knobBar} /> : null}
        {/* #1475 —— 旋钮类页面块里画内联 SVG 图标的（features-new）也要图标表，跟真站 HomePage / SubPage 同一个函数算。 */}
        {isRegion ? null : <SectionRenderer blocks={[cfg]} locale={locale} iconTables={iconTablesFor([cfg])} />}
      </main>
    </>
  );
}
