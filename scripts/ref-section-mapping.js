/**
 * ref-section-mapping.js — TICKET-119
 *
 * Maps Gemini-extracted reference site section names to our registered
 * section types (see src/lib/sections/registry.ts). Used by create-site.js
 * when refPrefs.includes('layout') to hard-copy the reference site's
 * homepage section structure.
 *
 * 🔴 每个值必须是**注册表里真有的键** —— 值指向一个不在注册表里的名字时，
 *    `SectionRenderer` 走未知类型那一支（`console.warn` + `return null`），那一节在页面上直接
 *    不出现，而构建是绿的。#1162 就撞到过这一族：`values-grid` / `benefits-list` / `checklist` /
 *    `service-highlights` 四个老 type 名随别名层退役被删出注册表，而这张表里五个条目还指着它们；
 *    现在它们一律指 `card-group`（那四个块合并后的通用块）。
 *    📌 头一行原来写「our 32 registered section types」—— 数字会过期（今天注册表 31 个键），
 *    所以不再写数。
 */

const REF_SECTION_MAPPING = {
  // Direct matches
  'hero': 'hero',
  'services-list': 'services-list',
  'services': 'services-list',
  'gallery': 'gallery',
  'gallery-intro': 'gallery',
  'testimonials': 'testimonials',
  'faq': 'faq-accordion',
  'faq-accordion': 'faq-accordion',
  'team': 'team-grid',
  'team-grid': 'team-grid',
  'process': 'process-steps',
  'process-steps': 'process-steps',
  'stats': 'stats-counter',
  'stats-counter': 'stats-counter',
  'cta': 'cta-banner',
  'cta-banner': 'cta-banner',
  'newsletter': 'newsletter-signup',
  'newsletter-signup': 'newsletter-signup',
  // #1372 —— 原来收「奖项 / 认证 / 徽章」的那个块删了（D19），这几条改指 `features-grid`：
  // 槽位一样（标题 + 副标题 + 若干项），是库里最近的替代。旧块名那个键一起删掉（那张票要求
  // 代码里 0 命中），抓站时抓到它会落到本文件末尾的 `text-block` 兜底。
  'awards': 'features-grid',
  // #1375 —— logo 墙那个块删了（D19，跟 `trusted-brands` 槽位相同：标题 + 一组 logo）。
  // 抓到 logo 墙这类名字改指 `trusted-brands`；旧块名那个键一起删掉（本票要求代码里 0 命中）。
  'partners': 'trusted-brands',
  'partner-logos': 'trusted-brands',
  'features': 'features-grid',
  'features-grid': 'features-grid',
  'benefits': 'card-group',
  'benefits-list': 'card-group',
  'contact': 'contact-info',
  'contact-info': 'contact-info',
  'social-proof': 'social-proof',
  // #1372 —— `timeline` 删了（D19，跟 `process-steps` 只差 events 里的日期）。
  'timeline': 'process-steps',
  'service-highlights': 'card-group',
  'pricing-table': 'pricing-table',
  // #1372 —— 「我们 vs 别人」那个对比块删了（D19）。抓到这类名字改指 `features-grid`：两者都是
  // 「一串特性」，而 `pricing-table` 是套餐对比、槽位对不上（价格 / 套餐名都没有）。
  // 旧块名那个键按那张票的要求不留，换成抓站里更常见的两种写法。
  'comparison': 'features-grid',
  'comparison-table': 'features-grid',
  'checklist': 'card-group',
  'blog-preview': 'blog-preview',
  'announcement-bar': 'announcement-bar',
  // #1372 —— `divider` 删了（D19，它只有一个 label 槽、没有内容）。抓到它时**跳过**：
  // 落到下面那条 `text-block` 兜底会在页面上插一个空的文字块。
  'divider': null,
  'content-split': 'content-split',
  'text-block': 'text-block',
  'map-area': 'map-area',
  'values-grid': 'card-group',
  'trusted-brands': 'trusted-brands',

  // Industry-specific names that map to generic types
  'about-us': 'content-split',
  'about': 'content-split',
  'about-section': 'content-split',
  'who-we-are': 'content-split',
  'mission': 'content-split',
  'quote-banner': 'text-block',
  'quote': 'text-block',
  'banner': 'text-block',
  'tagline': 'text-block',
  'intro': 'text-block',
  'introduction': 'text-block',
  'services-pricing': 'pricing-table',
  'pricing': 'pricing-table',
  'pricing-cards': 'pricing-table',
  'plans': 'pricing-table',
  'membership-options': 'pricing-table',
  'membership-cards': 'pricing-table',
  'memberships': 'pricing-table',
  'packages': 'pricing-table',
  'products-intro': 'text-block',
  'products': 'features-grid',
  'product-list': 'features-grid',
  'product-grid': 'features-grid',
  'locations': 'map-area',
  'locations-grid': 'map-area',
  'locations-carousel': 'map-area',
  'location': 'map-area',
  'find-us': 'map-area',
  'reviews': 'testimonials',
  'client-reviews': 'testimonials',
  'customer-reviews': 'testimonials',
  'how-it-works': 'process-steps',
  'steps': 'process-steps',
  'why-choose-us': 'features-grid',
  'why-us': 'features-grid',
  'why-choose': 'features-grid',
  'staff': 'team-grid',
  'our-team': 'team-grid',
  'employees': 'team-grid',
  'specialists': 'team-grid',
  'gallery-grid': 'gallery',
  'portfolio': 'gallery',
  'work': 'gallery',
  'projects': 'gallery',
  'numbers': 'stats-counter',
  'achievements': 'stats-counter',
  'metrics': 'stats-counter',
  'subscribe': 'newsletter-signup',
  'email-signup': 'newsletter-signup',
  'certifications': 'features-grid',
  'badges': 'features-grid',
  'trust-badges': 'features-grid',

  // Skipped (not rendered as sections — header/footer handled by layout components)
  'footer': null,
  'header': null,
  'navigation': null,
  'navbar': null,
  'menu': null,
  'top-bar': null,
};

function normalizeRefName(name) {
  if (!name || typeof name !== 'string') return '';
  return name
    .toLowerCase()
    .replace(/\s*\([^)]*\)\s*/g, '')
    .replace(/[_\s]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .trim();
}

function mapRefSection(refName) {
  const normalized = normalizeRefName(refName);
  if (!normalized) return null;
  if (Object.prototype.hasOwnProperty.call(REF_SECTION_MAPPING, normalized)) {
    return REF_SECTION_MAPPING[normalized];
  }
  return 'text-block';
}

function parseRefSections(sectionsStr) {
  if (!sectionsStr || typeof sectionsStr !== 'string') return [];
  // Strip paren-wrapped descriptions BEFORE splitting on comma — Gemini sometimes
  // puts ", " inside parens (e.g. "services-list (two-column with prices, image on right)")
  // which would otherwise mis-split a single section into two fragments.
  const stripped = sectionsStr.replace(/\s*\([^)]*\)\s*/g, ' ');
  return stripped
    .split(',')
    .map(s => mapRefSection(s))
    .filter(s => s !== null && s !== undefined);
}

// ─── TICKET-120: Reference nav → page archetype mapping ──────────────────────
//
// Maps reference site navigation labels (Gemini-extracted) to our page slug
// archetypes. Used by create-site.js when refPrefs.includes('structure') to
// hard-copy the reference site's header navigation.

const REF_NAV_MAPPING = {
  // Home is auto-rendered by template, never a header nav archetype
  'home': null,

  // Direct slug match
  'about': 'about',
  'about-us': 'about',
  'who-we-are': 'about',
  'services': 'services',
  'service': 'services',
  'gallery': 'gallery',
  'menu': 'menu',
  'team': 'team',
  'staff': 'team',
  'our-team': 'team',
  'faq': 'faq',
  'faqs': 'faq',
  'process': 'process',
  'how-it-works': 'process',
  'testimonials': 'testimonials',
  'reviews': 'testimonials',

  // Pricing variants
  'price': 'pricing',
  'pricing': 'pricing',
  'prices': 'pricing',
  'rates': 'pricing',
  'plans': 'pricing',

  // Contact variants → quote page (existing quote-form section archetype)
  'contact': 'quote',
  'contact-us': 'quote',
  'get-in-touch': 'quote',
  'book': 'quote',
  'booking': 'quote',
  'book-appointment': 'quote',
  'book-now': 'quote',
  'quote': 'quote',
  'get-a-quote': 'quote',

  // Portfolio / case studies
  'projects': 'case-studies',
  'work': 'case-studies',
  'portfolio': 'case-studies',
  'case-studies': 'case-studies',
  'our-work': 'case-studies',

  // Skipped — independent routes / not-an-archetype
  'blog': null,
  'news': null,
  'login': null,
  'sign-in': null,
  'sign-up': null,
};

function mapRefNav(navName) {
  const normalized = normalizeRefName(navName);
  if (!normalized) return null;
  if (Object.prototype.hasOwnProperty.call(REF_NAV_MAPPING, normalized)) {
    return REF_NAV_MAPPING[normalized];
  }
  // Unknown nav names: skip (safer than inventing a slug — keep header nav clean)
  return null;
}

function parseRefNavLinks(navLinks) {
  // Manager Go struct guarantees navLinks is string[] (or undefined)
  if (!Array.isArray(navLinks)) return [];
  return navLinks.map(n => mapRefNav(n)).filter(Boolean);
}

module.exports = {
  REF_SECTION_MAPPING,
  REF_NAV_MAPPING,
  mapRefSection,
  mapRefNav,
  parseRefSections,
  parseRefNavLinks,
  normalizeRefName,
};
