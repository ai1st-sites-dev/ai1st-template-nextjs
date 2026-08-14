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
// 的形状：老站磁盘上仍然是 `sections: [{type, data, hidden}]`，`scripts/blocks.js` 把它 1:1 映成
// 下面这个形状，所以运行时只有一种形状要读（spec §4.6）。
export type BlockRoleName = 'essential' | 'lead' | 'optional';

export interface BlockConfig {
  /** 站内唯一的名字。跨页复用的块靠它被 `{ "ref": "<id>" }` 引用。老站归一化出来的块没有 id。 */
  id?: string;
  type: string;
  /** 内容结构（`with-media` / `text-only` …），**不是外观**（spec D5）。外观今天仍由
   *  `data.variant` 决定（`HeroSection.tsx:21`），两个字段并存、各管各的，不做换算。
   *  写了才会变成 DOM 上的 `data-block-layout`；没写就一个属性都不多。 */
  block_layout?: string;
  /** 没写就落回类型级默认表（`sections/block-roles.json`）。 */
  role?: BlockRoleName;
  /** 页面的哪个区。取值清单归 #1000，本票只把它原样带过去。 */
  region?: string;
  /** 排布顺序。没写就按它在数组里的位置算（见 `scripts/blocks.js` 的 effectiveWeight）。 */
  weight?: number;
  data?: Record<string, unknown>;
  /** Written in the site's own page JSON — and nowhere else. #993 (spec D8) removed the theme's
   *  ability to set it: which blocks a page shows is the site's decision, not the theme's.
   *  The block keeps its content and stays in this array; only SectionRenderer skips it. Anything
   *  that reasons about what the page is *made of* (SubPage's Service JSON-LD) still sees it. */
  hidden?: boolean;
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
  serviceDetailPage?: boolean;
  parentService?: string;
  blocks: BlockConfig[];
}

// #960 — 顶栏 / 页脚这两个 Region 的结构。唯一权威清单在 `scripts/region-layout.js`
// (组件按它渲染、theme 注册表按它填、构建期校验也按它);这里的联合类型跟那份清单逐字对应。
// `headerScrim` 是那条对比度规则的产物:透明浮层压在**不能被证明是深底**的首屏上时为 true。
export type HeaderVariant = 'solid-bar' | 'transparent-overlay' | 'centered-logo' | 'pill-floating';
export type FooterVariant = 'multi-column' | 'slim-row' | 'cta-band';

export interface RegionLayoutConfig {
  header: HeaderVariant;
  footer: FooterVariant;
  // #1000 — page layout 库里 topbar 区的结构，取值同 AnnouncementBarSection 的 variant。
  topbar: 'solid' | 'bordered' | 'dismissible' | 'floating';
  headerScrim: boolean;
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
