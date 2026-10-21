// ══════════════════════════════════════════════════════════════════════════════════════════════════
// 块图册的一格：(块, 形态, 地址栏) → 这一格画什么（#1828，SiteAsData T2f-1）
// ══════════════════════════════════════════════════════════════════════════════════════════════════
//
// 图册原来是展示站上的 `/__catalog/<块>/<形态>`（`src/app/%5F_catalog/[block]/[shape]/page.dev.tsx`，Next 服务端渲染）。决定 15
// 把它搬进 dashboard 自己画（`/admin/catalog/<块>/<形态>`），发版时另有一道 `site.js render-catalog` 用同一份逻辑在 Node 里把每个
// 形态渲一遍。两边**调的是这一份**：
//
//   dashboard   `dashboard/src/admin/catalog-demo.ts` → 这里 → `src/components/catalog/CatalogCell.tsx`（浏览器）
//   发版检查     `scripts/site.js render-catalog` → `render/index.tsx` §renderCatalogCell → 这里 → 同一个组件（esbuild 打的包）
//
// 🔴 这一份**不读文件**（浏览器里也跑）：manifest、图标表由调用方给 —— dashboard 由 vite 插件在 Node 里读好
//    （`dashboard/vite.config.ts` §catalogData），发版检查由 `site.js` 读（`scripts/lib/block-catalog.js` / `icons.js`）。
// 🔴 站点数据是**演示生意那一份**（`scripts/lib/demo-content` 的 DEMO_SITE），不是哪个真站的：同一格在哪台机器上都一样。
//    展示站时代用的是那台展示站自己（skipAI 建的同一家 Northside Auto Care）的站点数据，块读到的几样（服务目录 / 表单库 /
//    门店联系方式 / 营业时间 / 博客）这里逐样从 DEMO_SITE 取。
//
// 地址栏的语义跟 `/__catalog` 一字不差（24 份 e2e 只改了地址前缀）：
//   ?theme=<id>  ?fill=full|minimal  ?embed=1  ?opt=a,b  ?<旋钮>=<值>  ?<颜色槽>=<色|JSON>  ?parts=a,b|-  ?<槽>.<子字段>=<值>
//   ?<list 槽>=<N>  ?<部件槽>=<样式>  ?items=services|none（features / contact）  ?geo=none  ?hours=none（contact）
// 🔴 认不出的 (块,形态) 由调用方回「没有这一格」；认不出的 theme / fill / 旋钮值落回默认 —— 看法不该让页面消失（#1383）。

import type { BlockConfig, BlogPostConfig, DynamicPageConfig, SiteData } from '@template/lib/types/config';
import { resolveItemSources } from '@template/lib/sections/item-sources';
import { DEMO_BLOG_POSTS, DEMO_SITE, FEATURES_NEW_FROM_SERVICES, FEATURES_NEW_STEPS, SITE, demoDataFor, demoSourceContext } from '../../../scripts/lib/demo-content/index.js';
import { siteFactsFrom } from '../../../scripts/lib/contact-facts.js';
import { filledOptionalSlots } from '../../../scripts/lib/slot-filled.js';
import { couplingOf, knobsOf, normalizeKnobs, presetBooleans, presetForShape, presetsOf } from '../../../scripts/lib/header-knobs.js';
// knobsOf / presetsOf 两份（header-knobs.js #1462 · block-knobs.js #1463）读的是同一份 manifest 声明、对合法声明给出同一结果；
// 这里用 header-knobs 那份（同 page.dev.tsx），并掉哪一份归 T3。
import { booleanOptionsOf, choiceDefault, colorSlotsOf, effectiveKnobs, presetColors, presetNameFor, toolbarGroupsOf } from '../../../scripts/lib/block-knobs.js';
import { bgFromParam, normalizeBg, type BgValue } from '../../../scripts/lib/contrast.js';
import { BLOCK_ICONS, iconNamesIn } from '../../../scripts/lib/icon-names.js';
import type { CellOptionsInitial, Preset, Widget } from '@template/components/catalog/CellOptions';
import type { KnobBarProps } from '@template/components/catalog/KnobBar';

/** 一个块的 manifest（`loadManifests` 读进来的那份，`shapes` 是子文件夹的清单）。 */
export interface CatalogManifest {
  type: string;
  region?: boolean;
  slots?: Record<string, Record<string, unknown> & { kind?: string; required?: boolean; shape?: string }>;
  shapes: Array<{ name: string }>;
  [key: string]: unknown;
}

/** 一套主题在图册眼里的样子：皮（`scripts/theme-css.js` §buildThemeCss 现算）+ 画法表（`public/themes/<sheet>.css`）。 */
export interface CatalogTheme {
  id: string;
  label: string;
  /** 这套主题的 `primary['500']` —— 编 site.css 的那个 `$primary`（manager `GET /api/admin/catalog/site.css?theme=`）。 */
  primary: string;
  skinCss: string;
  sheetCss: string;
}

/** 地址栏取一个参数：重复参数取第一个，没有 ⟹ undefined。 */
export type CatalogQuery = (name: string) => string | undefined;

export function queryOf(search: string | URLSearchParams): CatalogQuery {
  const q = typeof search === 'string' ? new URLSearchParams(search) : search;
  return (name) => (q.has(name) ? (q.get(name) as string) : undefined);
}

/** `?theme=` 认哪些：只认池里的 id，不认的落回第一套（#1383 做什么 2）。 */
export function resolveTheme<T extends { id: string }>(themes: T[], requested?: string | null): T | undefined {
  const hit = requested ? themes.find((t) => t.id === requested) : undefined;
  return hit || themes[0];
}

/** `?fill=` 认哪些：`full` / `minimal`，不认的落回 `full`。 */
export function resolveFill(requested?: string | null): 'full' | 'minimal' {
  return requested === 'minimal' ? 'minimal' : 'full';
}

// ── 夹具页 / 夹具博客（原样搬自 `src/app/%5F_catalog/catalogShared.ts`）────────────────────────────────
//
// 🔴 挂在一个属于图册自己的 locale 键下：站点数据里对这几张表的读取全是按键取，这个键按构造谁都看不见。
//    blog 只从站点博客读（`getBlogPosts(locale)`）；page-header 当自己在看夹具页 `CATALOG_PAGE_HEADER_SLUG`（#1502）。
export const CATALOG_LOCALE = '__catalog-fixture';
export const CATALOG_SERVICE_SLUG = 'sample-service';
export const CATALOG_PAGE_HEADER_SLUG = 'brake-repair/north-york';

const CATALOG_FIXTURE_PAGES: DynamicPageConfig[] = ['First', 'Second', 'Third'].map((ord, i) => ({
  slug: `${CATALOG_SERVICE_SLUG}/keyword-page-${i + 1}`,
  title: `${ord} Keyword Page`,
  description: 'A keyword page under this service — the catalogue supplies these so the block has something to point at.',
  blocks: [],
}) as unknown as DynamicPageConfig);
const CATALOG_PAGE_HEADER_PAGES = [
  { slug: 'services/brake-repair', title: 'Brake Repair', description: 'Brake service at Northside Auto Care.', blocks: [] },
  { slug: CATALOG_PAGE_HEADER_SLUG, title: 'Brake Repair in North York', description: 'Brake repair for North York drivers.', blocks: [] },
] as unknown as DynamicPageConfig[];
// 真站上按 publishedAt 倒序是 sync-config 排的，这张表不经 sync-config ⟹ 自己排。
const CATALOG_FIXTURE_BLOG_POSTS = ([...DEMO_BLOG_POSTS] as unknown as BlogPostConfig[])
  .sort((a, b) => new Date(b.publishedAt).getTime() - new Date(a.publishedAt).getTime());

/**
 * 演示生意的站点数据（`SiteData` 形状）。块从 `site` prop 读的那几样逐样取 DEMO_SITE：服务目录（hero / cta / contact 的服务
 * 下拉）· 表单库（`leadFormSite`）· 博客（夹具 locale 下）· 夹具页。`leadApi` 是空串：图册里的表单提交不该打到任何真后端。
 */
export function catalogSite(): SiteData {
  const name = String(SITE);
  const services = DEMO_SITE.services.map((s) => ({ ...s, fullDescription: s.shortDescription, features: [], products: [] }));
  const forms = JSON.parse(JSON.stringify((DEMO_SITE as unknown as { forms: unknown[] }).forms || []));
  return {
    siteId: 'catalog',
    leadApi: '',
    colorScheme: 'light',
    dir: 'ltr',
    defaultLocale: 'en',
    locales: ['en'],
    brand: {
      name: { en: name },
      tagline: { en: '' },
      logoIcon: '',
      colors: { primary: {}, accent: {} },
      fonts: { body: [], googleFontsUrl: '' },
      email: DEMO_SITE.brand.email,
      locations: JSON.parse(JSON.stringify(DEMO_SITE.brand.locations)),
      socialLinks: JSON.parse(JSON.stringify(DEMO_SITE.brand.socialLinks)),
      googleFormUrl: '',
      googleFormEntries: { source: '', services: '', propertyType: '', urgency: '' },
    } as unknown as SiteData['brand'],
    seoByLocale: {
      en: {
        domain: 'https://example.com', locale: 'en_CA', siteTitle: name, siteDescription: '',
        schema: { areaServed: [], addresses: [], offerCatalogName: '' },
      },
    },
    servicesByLocale: { en: services },
    formsByLocale: { en: forms },
    navigationByLocale: {},
    pagesByLocale: {
      en: DEMO_SITE.pages.map((p) => ({ ...p, blocks: [] })) as unknown as DynamicPageConfig[],
      [CATALOG_LOCALE]: [...CATALOG_FIXTURE_PAGES, ...CATALOG_PAGE_HEADER_PAGES],
    },
    blogPostsByLocale: { [CATALOG_LOCALE]: CATALOG_FIXTURE_BLOG_POSTS },
    regions: { header: { shape: '' }, footer: { shape: '' }, notes: [] } as unknown as SiteData['regions'],
    pageLayout: { id: 'catalog', regions: ['header', 'content', 'footer'] },
  };
}

// ── manifest → 这一格的开关（原样搬自 page.dev.tsx §optionMetaOf / §knobOverrides）───────────────────────────

type SlotSpec = { shape?: unknown; knobs?: unknown; kind?: unknown; swatches?: unknown; gradients?: unknown; required?: boolean; choices?: Record<string, string[]>; max?: unknown };

/**
 * 外壳块（header / footer）的开关，从 manifest 读，不写名单（#1458 / #1462 / #1464 / #1469 / #1483 / #1532，各条的来历在
 * page.dev.tsx §optionMetaOf 原文）。Go 那侧 `manager/template_blocks.go` §manifestOptionMeta 是同一套判据。
 */
export function optionMetaOf(m: CatalogManifest) {
  const slots = ((m && m.slots) || {}) as Record<string, SlotSpec>;
  const optShape = slots.options && typeof slots.options.shape === 'string' ? slots.options.shape : '';
  const optionKeys = Array.from(optShape.matchAll(/(\w+)\s*:\s*bool/g)).map((x) => x[1]);
  const widgets = Object.keys(slots).filter((k) => k !== 'options').sort().flatMap((slot) => {
    const shape = typeof slots[slot]?.shape === 'string' ? (slots[slot].shape as string) : '';
    const hit = shape.match(/^\{\s*(style|mode):\s*((?:"[a-z]+"\s*\|?\s*)+)/);
    return hit ? [{ slot, key: hit[1], styles: Array.from(hit[2].matchAll(/"([a-z]+)"/g)).map((x) => x[1]) }] : [];
  });
  const colors = (colorSlotsOf(m) as string[]).map((c) => ({ slot: c, swatches: Array.isArray(slots[c].swatches) ? (slots[c].swatches as string[]) : [],
    gradients: Array.isArray(slots[c].gradients) ? (slots[c].gradients as BgValue[]) : undefined }));
  return {
    optionKeys,
    widgets: widgets as Widget[],
    colors,
    knobs: knobsOf(m) as Array<{ name: string; values: string[] }>,
    presets: presetsOf(m) as Preset[],
    coupling: couplingOf(m) as [string, string] | null,
    groups: toolbarGroupsOf(m) as string[][],
  };
}

/**
 * 「预设 + 旋钮」那一类**页面块**：地址栏 → 这一格的 data（就地改 `data`），回 KnobBar 要的那一份（#1463 / #1477 / #1479 /
 * #1480 / #1481 / #1483 / #1487 / #1532，参数表在 page.dev.tsx §knobOverrides 原文）。外壳区块不走这里（它们走 CellOptions）。
 */
export function knobOverrides(m: CatalogManifest, shape: string, data: Record<string, unknown>, q: CatalogQuery): KnobBarProps {
  const knobs = knobsOf(m) as Array<{ name: string; values: string[] }>;
  const booleans = booleanOptionsOf(m) as string[];
  const slots = (m.slots || {}) as Record<string, SlotSpec>;
  const colorSlots = colorSlotsOf(m) as string[];
  const parts = Array.isArray(m.parts) ? (m.parts as string[]) : [];
  const choices: { key: string; values: string[]; default: string }[] = [];
  for (const [slot, spec] of Object.entries(slots)) {
    for (const [sub, values] of Object.entries((spec && spec.choices) || {})) {
      // 数组取值的子字段（`form.fields`）不做成单选。
      if (new RegExp(`${sub}\\s*:\\s*\\[`).test(typeof spec.shape === 'string' ? spec.shape : '')) continue;
      choices.push({ key: `${slot}.${sub}`, values, default: choiceDefault(spec, sub) ?? values[0] });
    }
  }
  const opts = { ...((data.options as Record<string, unknown>) || {}) };
  for (const k of knobs) {
    const v = q(k.name);
    if (v && k.values.includes(v)) opts[k.name] = v;
  }
  if (q('opt') !== undefined) {
    const on = new Set((q('opt') || '').split(',').map((x) => x.trim()));
    for (const b of booleans) opts[b] = on.has(b);
  }
  data.options = opts;
  for (const slot of colorSlots) {
    const c = bgFromParam(q(slot)) ?? normalizeBg(data[slot]);
    if (c) data[slot] = c;
  }
  for (const slot of Object.keys(slots).sort()) {
    const max = slots[slot] && slots[slot].kind === 'list' ? slots[slot].max : undefined;
    if (typeof max !== 'number' || !Number.isInteger(max) || max < 1) continue;
    const v = q(slot);
    const n = v !== undefined && /^\d+$/.test(v) ? Number(v) : NaN;
    if (n <= max && Array.isArray(data[slot])) data[slot] = (data[slot] as unknown[]).slice(0, n);
  }
  const partsParam = q('parts');
  const keep = partsParam === undefined ? parts : partsParam.split(',').map((x) => x.trim()).filter((x) => parts.includes(x));
  for (const p of parts) if (!keep.includes(p)) delete data[p];
  const chosen: Record<string, string> = {};
  for (const c of choices) {
    const [slot, sub] = c.key.split('.');
    const v = q(c.key);
    const obj = (data[slot] && typeof data[slot] === 'object' ? { ...(data[slot] as Record<string, unknown>) } : null);
    if (obj && v && c.values.includes(v)) { obj[sub] = v; data[slot] = obj; }
    chosen[c.key] = obj && typeof obj[sub] === 'string' ? String(obj[sub]) : c.default;
  }
  const eff = effectiveKnobs(m, shape, opts) as Record<string, string>;
  const colorsNow = Object.fromEntries(colorSlots.map((c) => [c, normalizeBg(data[c])])) as Record<string, BgValue | null>;
  return {
    knobs: knobs.map((k) => ({ name: k.name, values: k.values })),
    presets: (presetsOf(m) as Preset[]).map((p) => ({ name: p.name, shape: p.shape, knobs: p.knobs, colors: presetColors(m, p.name) as Record<string, BgValue | null>,
      parts: ((p as { parts?: unknown }).parts instanceof Array ? ((p as { parts?: unknown }).parts as unknown[]) : [])
        .filter((x): x is string => typeof x === 'string' && parts.includes(x)) })),
    booleans,
    colors: colorSlots.map((c) => ({ slot: c, swatches: (slots[c].swatches as string[]) || [], gradients: slots[c].gradients as BgValue[] | undefined })),
    parts,
    choices,
    groups: toolbarGroupsOf(m) as string[][],
    current: {
      knobs: eff,
      preset: presetNameFor(m, { ...eff, ...colorsNow, ...Object.fromEntries(parts.map((p) => [p, data[p]])) }) as string,
      booleans: Object.fromEntries(booleans.map((b) => [b, opts[b] === true])),
      colors: colorsNow,
      parts: keep,
      choices: chosen,
    },
  };
}

/** 这一格要画的全部东西。`CatalogCell.tsx` 只按它画，不再看地址栏。 */
export interface CatalogCellModel {
  block: string;
  shape: string;
  fill: 'full' | 'minimal';
  embed: boolean;
  site: SiteData;
  locale: string;
  isRegion: boolean;
  /** 页面块：展开引用之后交给 SectionRenderer 的那一份（一项）。 */
  shown: BlockConfig[];
  /** 外壳块：交给 CellOptions 的 data（同样是展开之后的）。 */
  shownData: Record<string, unknown>;
  has: string[];
  siteFacts?: ReturnType<typeof siteFactsFrom>;
  pageSlug?: string;
  meta: ReturnType<typeof optionMetaOf>;
  hasOptionBar: boolean;
  initial: CellOptionsInitial;
  knobBar: KnobBarProps | null;
}

/** (块, 形态) 不在这份 manifest 的清单里 ⟹ null（调用方回「没有这一格」）。 */
export function catalogCellModel({ manifest: m, block, shape, query: q }: { manifest: CatalogManifest | undefined; block: string; shape: string; query: CatalogQuery }): CatalogCellModel | null {
  if (!m || m.type !== block || !(m.shapes || []).some((s) => s.name === shape)) return null;
  const fill = resolveFill(q('fill'));
  const site = catalogSite();
  const data = demoDataFor(m as never, { minimal: fill === 'minimal' }) as Record<string, unknown>;
  const isPageHeader = block === 'page-header';
  const locale = block === 'blog' || isPageHeader ? CATALOG_LOCALE : site.defaultLocale;

  // 旋钮类页面块：地址栏先改 data，再算 `data-has-*`（关掉的部件不许还挂着「有它」）。
  const knobBar = m.region !== true && knobsOf(m).length ? knobOverrides(m, shape, data, q) : null;
  // #1490 —— features 按组件真正拿来画的那份旋钮值挑演示数据：itemConnector=line 时换成带编号的那一版。
  if (block === 'features' && (effectiveKnobs(m, shape, data.options) as Record<string, string>).itemConnector === 'line') {
    data.items = JSON.parse(JSON.stringify(FEATURES_NEW_STEPS.items));
  }
  // #1505 —— `?items=services`：items 换成引用写法，下面跟真站同一个函数展开。
  if (block === 'features' && q('items') === 'services') {
    data.items = JSON.parse(JSON.stringify(FEATURES_NEW_FROM_SERVICES.items));
  }
  // #1489 —— contact 的电话 / 邮箱 / 地址 / 营业时间 / 坐标用演示生意那一份；`?geo=none` / `?hours=none` / `?items=none` 拿掉一样。
  let siteFacts: ReturnType<typeof siteFactsFrom> | undefined;
  if (block === 'contact') {
    const demo = JSON.parse(JSON.stringify(DEMO_SITE));
    if (q('geo') === 'none') delete demo.brand.locations[0].geo;
    if (q('hours') === 'none') demo.brand.locations[0].hours = [{ days: [], opens: '', closes: '' }];
    siteFacts = siteFactsFrom(demo.brand, null);
    if (q('items') === 'none') data.items = [];
  }

  const has = filledOptionalSlots(m, data) as string[];
  const cfg: BlockConfig = { type: block, shape, data, has } as BlockConfig;
  const shown = resolveItemSources([cfg], demoSourceContext() as never);
  const shownData = ((shown[0] && shown[0].data) || data) as Record<string, unknown>;

  const isRegion = m.region === true;
  const meta = optionMetaOf(m);
  const hasOptionBar = meta.optionKeys.length > 0 || meta.widgets.length > 0 || meta.knobs.length > 0 || meta.colors.length > 0;
  const wanted = new Set((q('opt') || '').split(',').map((x) => x.trim()).filter(Boolean));
  const embed = ['1', 'true'].includes(q('embed') || '');
  // #1462 / #1468 —— 外壳块：初值是这个形态（= 预设）的那组值，地址栏盖上去再纠正一次；归预设管的开关没写 `?opt=` 就跟形态走。
  const own = presetForShape(meta.presets, shape) as Preset | undefined;
  const knobBase: Record<string, string> = own ? { ...own.knobs } : {};
  const knobWanted: Record<string, string> = { ...knobBase };
  for (const k of meta.knobs) { const v = q(k.name); if (v) knobWanted[k.name] = v; }
  const knobs = meta.knobs.length
    ? normalizeKnobs(knobWanted, { knobs: meta.knobs, presets: meta.presets, coupling: meta.coupling, base: knobBase }) as Record<string, string>
    : {};
  const ownBooleans = own ? (presetBooleans(meta.presets, own.name) as Record<string, boolean>) : {};
  const optGiven = q('opt') !== undefined;
  const initial: CellOptionsInitial = {
    knobs,
    opts: Object.fromEntries(meta.optionKeys.map((k) => [k, !optGiven && k in ownBooleans ? ownBooleans[k] : wanted.has(k)])),
    widgets: Object.fromEntries(meta.widgets.map((w) => {
      const v = q(w.slot);
      return [w.slot, v && w.styles.includes(v) ? v : 'none'];
    })),
    colors: Object.fromEntries(meta.colors.map((c) => [c.slot, bgFromParam(q(c.slot)) ?? normalizeBg(data[c.slot])])),
  };

  return {
    block, shape, fill, embed, site, locale, isRegion, shown, shownData, has,
    siteFacts, pageSlug: isPageHeader ? CATALOG_PAGE_HEADER_SLUG : undefined,
    meta, hasOptionBar, initial, knobBar,
  };
}

/**
 * 这一格的图标表要哪些名字（同 `scripts/lib/icons.js` §iconTableFor：块组件自己点名的 + 数据里每一个 `icon`）。
 * 调用方拿它去查表 —— Node 里读 bootstrap-icons，dashboard 里查 vite 插件预先读好的那一张。
 */
export function cellIconNames(block: string, data: unknown): string[] {
  const table = BLOCK_ICONS as Record<string, string[]>;
  return Array.from(new Set((table[block] || []).concat(Array.from(iconNamesIn(data) as Set<string>)))).sort();
}
