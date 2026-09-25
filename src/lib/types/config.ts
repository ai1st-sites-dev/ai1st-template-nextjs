import type { ThemeSettings, NumericThemeSettings } from '../themeSettings';

// ---- Site Meta ----
export interface SiteMetaConfig {
  defaultLocale: string;
  locales: string[];
}

// ---- Brand ----
export interface BrandColors {
  primary: Record<string, string>;
  accent: Record<string, string>;
}

export interface BrandFonts {
  heading: string[];
  body: string[];
  googleFontsUrl: string;
}

export interface BrandLocation {
  label: string;
  address: string;
  phone: string;
}

export interface BrandConfig {
  // TICKET-136: brand.name is per-locale (mirrors tagline). sync-config.js
  // auto-wraps legacy string into Record at load time, so all downstream code
  // can treat name as Record without typecheck branches.
  name: Record<string, string>;
  tagline: Record<string, string>;
  logoIcon: string;
  logoUrl?: string;
  // TICKET-159: true when the logoUrl is a user-uploaded image that already
  // includes the wordmark (header/footer skip rendering the company name text).
  // false (or undefined) when AI-generated icon-only — companyName text is
  // rendered alongside the image. Backfilled via sync-config.js for legacy sites.
  logoHasWordmark?: boolean;
  colors: BrandColors;
  fonts: BrandFonts;
  // #961: 风格设定（圆角/留白/阴影/按钮形状）。只有应用了 theme 的站有这一项；
  // 没有它的站落回 globals.css `:root` 的默认值，也就是 #961 之前的样子。
  // #1003: 两种形状 —— #961 的枚举词，或生成的主题用的数值。二选一，同一套主题不许混写
  // （schemas/theme-tokens.schema.json 判这件事）；`settingsToCssVars` 按 `radius` 的类型分支。
  settings?: Partial<ThemeSettings> | Partial<NumericThemeSettings>;
  email: string;
  locations: BrandLocation[];
  socialLinks?: { platform: string; url: string }[] | Record<string, string>;
  googleFormUrl: string;
  googleFormEntries: {
    source: string;
    services: string;
    propertyType: string;
    urgency: string;
  };
}

// ---- Navigation ----
export interface NavLink {
  label: string;
  href: string;
}

export interface FooterColumn {
  title: string;
  links: NavLink[];
}

export interface NavigationConfig {
  header: {
    links: NavLink[];
    cta: NavLink;
  };
  footer: {
    description: string;
    columns: FooterColumn[];
    copyright: string;
  };
  // #1000 — 顶栏那条细带的内容。可选：只有选了带 topbar 区的 page layout 的站才需要它，
  // 而那种站缺了它构建期就被拒绝（sync-config.js）。放在这个文件里是因为 Header / Footer 的导航
  // 内容今天就在这儿；它的**结构**（solid / bordered / …）不在这里，跟 header / footer 一样由主题定。
  topbar?: {
    message: string;
    link?: NavLink;
  };
}

// ---- SEO ----
export interface SeoPage {
  path: string;
  changeFrequency: string;
  priority: number;
}

export interface SeoConfig {
  domain: string;
  locale: string;
  siteTitle: string;
  siteDescription: string;
  keywords: string;
  verification?: {
    google?: string;
  };
  schema: {
    areaServed: { type: string; name: string }[];
    addresses: {
      locality: string;
      region: string;
      country: string;
    }[];
    openingHours: {
      days: string[];
      opens: string;
      closes: string;
    };
    priceRange: string;
    offerCatalogName: string;
  };
  pages?: SeoPage[];
}

// ---- Services ----
export interface ServiceProduct {
  name: string;
  description: string;
}

export interface ServiceConfig {
  id: string;
  name: string;
  shortDescription: string;
  fullDescription: string;
  icon: string;
  features: string[];
  products: ServiceProduct[];
}

// ---- Blog ----
export interface BlogPostConfig {
  slug: string;
  title: string;
  excerpt: string;
  content: string;
  category: string;
  tags: string[];
  author: string;
  publishedAt: string;
  seo: {
    metaTitle: string;
    metaDescription: string;
  };
}

// ---- Page Blocks ----
//
// #998 — 页面的内容层是 `blocks`，不再是 `sections`。这个类型描述的是 **sync-config 归一化之后**
// 的形状：老站磁盘上仍然是 `sections: [{type, data}]`，`scripts/blocks.js` 把它 1:1 映成
// 下面这个形状，所以运行时只有一种形状要读（spec §4.6）。
export type BlockRoleName = 'essential' | 'lead' | 'optional';

export interface BlockConfig {
  /** 站内唯一的名字。跨页复用的块靠它被 `{ "ref": "<id>" }` 引用。老站归一化出来的块没有 id。 */
  id?: string;
  type: string;
  /** #1318 — 这个块排成什么样，DOM 上的 `data-shape`，`public/shapes.css` 靠它点名。
   *  取值三级（spec D18，一处实现在 `scripts/sync-config.js` 的 `shapeForBlock`）：这里写的值
   *  → 主题的选择单（`scripts/theme-pool.json` 的 `shapes`）→ 块 manifest 的 `shapes[0]`。
   *  📌 #1341 之前旁边还有 `block_layout`（内容结构：有没有配图），两个字段并存；那一维退役后只剩这个。 */
  shape?: string;
  /** #1331 — 这个块 manifest 里 `required: false` 且填了的槽位名（原样，如 `imageUrl`），
   *  `scripts/sync-config.js` 构建时算好写在这儿，`blockAttrs.ts` 逐个送成 `data-has-<名字>="true"`。
   *  没有一个填了就没有这个字段，DOM 上一个属性都不多。 */
  has?: string[];
  /** 没写就落回类型级默认表（`sections/block-roles.json`）。 */
  role?: BlockRoleName;
  /** 页面的哪个区。取值清单归 #1000，本票只把它原样带过去。 */
  region?: string;
  /** 排布顺序。没写就按它在数组里的位置算（见 `scripts/blocks.js` 的 effectiveWeight）。 */
  weight?: number;
  data?: Record<string, unknown>;
}

/** @deprecated #998 起用 `BlockConfig`。留着是因为 `blocks` 与 `sections` 的字段是超集关系，
 *  老名字还出现在注释和历史票据里，删它不属于本票的范围（机械改名归 spec §4.5 那张票）。 */
export type SectionConfig = BlockConfig;

export interface PageConfig {
  blocks: BlockConfig[];
}

// ---- Dynamic Pages ----
export interface DynamicPageConfig {
  slug: string;
  title: string;
  description: string;
  navLabel?: string;
  navOrder?: number;
  changeFrequency?: string;
  priority?: number;
  // #1026 — 这一页上次什么时候变的（ISO 8601）。sitemap 的 <lastmod> 用它。不写在
  // site/pages/*.json 里 —— 每次构建由 sync-config.js 量出来（git 提交时间 → 文件修改时间 →
  // 构建时刻，规则在 scripts/lib/page-lastmod.js 的文件头上）。
  lastModified?: string;
  serviceDetailPage?: boolean;
  parentService?: string;
  blocks: BlockConfig[];
}

// #1353 — 三个 Region（顶栏 / 页脚 / 公告条）的**形态**。
//
// 🔴 这里以前是 `HeaderVariant` / `FooterVariant` 两个写死的联合类型 + `RegionLayoutConfig`，
//    也就是「一变体一棵树」那个模型的类型面。#1353 把三个 Region 按块的规矩搬进形态层之后，
//    形态清单的唯一权威是 **块 manifest**（`blocks/header/manifest.json` / `footer.json` /
//    `announcement-bar.json` 的 `shapes`），跟别的 32 个块一模一样 —— 所以这里**不再重抄一份联合
//    类型**：抄一份就是第二份清单，而两份清单漂了没有任何东西会红（联合类型漂的方向尤其静默，
//    `tsc` 只会在「组件写死某个名字」时才说话，而搬完之后没有一处写死）。
//
// 🔴 `headerScrim` 也随之没了：遮罩今天恒在 DOM 里，显不显示由 `shapes.css` 按
//    `[data-shape="transparent-overlay"][data-over-hero="true"]` 决定（`Header.tsx` 头注）。
export interface RegionShape {
  /** 这个区选中的形态名 —— 对应 `blocks/<区>.json` 的 `shapes[].name`，也是 DOM 上的 `data-shape`。 */
  shape: string;
}

export interface RegionsConfig {
  header: RegionShape;
  footer: RegionShape;
  /** 公告条那条外壳带（page layout 库里的 `topbar` 区）；形态取自 `blocks/announcement-bar/manifest.json`。 */
  topbar: RegionShape;
  /** 构建日志里那几句人话（「主题想要的形态不在清单里，退回 X」之类）。 */
  notes: string[];
}

// #1000 — 「这个站的页面由哪些区组成」。构建期从 page-layouts/ 里选出来并校验过（缺 header /
// content / footer 的布局根本进不来，spec §4.4 / D11）。
export interface PageLayoutConfig {
  id: string;
  regions: string[];
  /** 同一种区出现多次时，每一个用哪种结构（只有这种情况才轮到布局说话）。 */
  repeatVariants?: Record<string, string>;
}
