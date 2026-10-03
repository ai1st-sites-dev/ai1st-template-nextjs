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
  /** #1489 —— 这个地址的坐标：建站 / 改地址时由 `scripts/lib/geocode.js`（Nominatim）查一次写进来，页面打开时不查。
   *  contact 的地图点开时拿它算 bbox / marker；没有就不画地图。 */
  geo?: { lat: number; lng: number };
  /** #1530 —— 这个地址所在的城市：跟 `geo` 同一次 Nominatim 请求带回来（`addressdetails`），查不到就没有这一格。
   *  页脚 `row` 底栏露「电话 + 城市」读它；没有就那一格不画（不再从地址串猜）。 */
  city?: string;
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

// #1529 —— 页脚 CTA 条的按钮。`style` 写成 string 而不是 'solid' | 'outline' | 'link'：值是老板 / AI 写的，
// 不合法的由构建期派生丢掉那一格并打一行读数（`scripts/lib/shell-data.js` §footerCta），不该让 tsc 整站建不出来。
export interface NavButton {
  label: string;
  href: string;
  style?: string;
}

export interface FooterCtaConfig {
  title: string;
  subtitle?: string;
  buttons?: NavButton[];
}

export interface NavigationConfig {
  header: {
    links: NavLink[];
    cta: NavLink;
    // #1529 —— 下面三格都是可选的：写了才派生进外壳 data（`scripts/lib/shell-data.js`），没写的站一个字节不变。
    ctaSecondary?: NavLink;
  };
  footer: {
    description: string;
    columns: FooterColumn[];
    copyright: string;
    legal?: NavLink[];
    cta?: FooterCtaConfig;
  };
  // #1000 — 顶栏那条细带（公告条）的内容。#1425（T3）公告条那个区随旧库退役时数据留着（PM 2026-10-02 裁定 ②）；
  // #1528 起构建把它派生进 header 的 `topbar.message`（`scripts/lib/shell-data.js` §topbarMessage），
  // 带 topbar 的两个顶栏预设画它。
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

export interface TargetKeyword {
  keyword: string;
  volume: number | null;
  goldIndex: number | null;
}

export interface SeoConfig {
  domain: string;
  locale: string;
  siteTitle: string;
  siteDescription: string;
  /** #1548 —— 挖出来的关键词（`sites.payload.keywords` 的拷贝，建站时写、重新生成时重写）。只有主语言的 seo.json 有；
   *  老站没有。取代了 AI 编的那串 `keywords`（已删）。 */
  targetKeywords?: {
    primary: TargetKeyword | null;
    /** 键是服务 id；对不上服务的组用 payload 的服务名做键（判据：键不在 services.json 的 id 集合里）。 */
    byService: Record<string, (TargetKeyword & { selected: boolean; isPrimary: boolean })[]>;
  };
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

/** #1471 —— 站级表单库里的一张（`site/<locale>/forms.json`；字段词表与校验在 `scripts/lib/site-forms.js`）。 */
export interface SiteFormConfig {
  id: string;
  name: string;
  fields: Array<'name' | 'phone' | 'email' | 'message' | 'service'>;
  /** teaser 只露这一个字段 + 按钮。 */
  primary: 'name' | 'phone' | 'email' | 'message' | 'service';
  buttonText?: string;
  successMessage?: string;
  redirect?: string;
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
  /** #1497 —— 封面（blog 画它；没有 ⟹ 主色 10% 底 + 分类名的占位）。字段名必须是 `imageUrl`（写入闸 `image-urls.js` 认它）。 */
  coverImage?: { imageUrl: string; alt?: string };
  /** #1497 —— 作者头像。🔴 名字必须以 `Url` 结尾：写入闸只认 `IMAGE_FIELDS` 里的键。 */
  authorAvatarUrl?: string;
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
  /** #1548 —— 这一页为哪个搜索词而生。只有首页 / 服务详情页 / 关键词页有；第二语言的是翻译来的（translated: true）。 */
  seo?: { targetKeyword: string; translated?: boolean };
  blocks: BlockConfig[];
}

// #1353 — 两个 Region（顶栏 / 页脚）的**形态**；#1425（T3）起再带一份按语言的 **data**。
//
// 🔴 形态清单的唯一权威是 **块 manifest**（`blocks/header/` / `blocks/footer/` 的形态目录），跟别的块一模一样 ——
//    所以这里**不重抄一份联合类型**：抄一份就是第二份清单，而两份清单漂了没有任何东西会红。
// 📌 #1425（T3）：公告条那个区（`topbar`）随旧库退役；`dataByLocale` 是构建期从 navigation.json + brand.json
//    派生的那一份（`scripts/lib/shell-data.js`），里面的联系方式 / 社交链接还是引用，由 `SiteShell` 渲染前展开。
export interface RegionShape {
  /** 这个区选中的形态名 —— 对应 `blocks/<区>/` 下的形态目录名，也是 DOM 上的 `data-shape`。 */
  shape: string;
  /** 语言 → 这个区那个块的 data（构建期派生，不落盘到 site/）。 */
  dataByLocale?: Record<string, Record<string, unknown>>;
  /** 语言 → 这个区那个块的内联图标表（构建期按展开后的 data 查好，`scripts/lib/icons.js` §iconTableFor）。 */
  iconTableByLocale?: Record<string, Record<string, { viewBox: string; body: string }>>;
}

export interface RegionsConfig {
  header: RegionShape;
  footer: RegionShape;
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
