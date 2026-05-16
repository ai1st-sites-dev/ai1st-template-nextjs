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

// ---- Page Sections ----
export interface SectionConfig {
  type: string;
  data?: Record<string, unknown>;
}

export interface PageConfig {
  sections: SectionConfig[];
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
  sections: SectionConfig[];
}
