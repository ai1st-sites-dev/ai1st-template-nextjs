/**
 * ref-section-mapping.js — TICKET-119
 *
 * Maps Gemini-extracted reference site section names to our registered
 * section types (see src/lib/sections/registry.generated.ts). Used by create-site.js
 * when refPrefs.includes('layout') to hard-copy the reference site's
 * homepage section structure.
 *
 * 🔴 每个值必须是**注册表里真有的键**（= `blocks/` 下的目录名）—— 值指向一个不在注册表里的名字时，
 *    这串名字原样进建站提示词（「必须正好是这几个」），AI 照做、校验逐条报「没有这种块」、重试仍不合规就
 *    fatal，这个站建不出来。#1425（T3）删旧库时这张表 92 条里 81 条指着被删的块，而没有任何测试看着它
 *    ⟹ `scripts/ref-section-mapping.test.js` 从此逐条对 `blocks/` 核。
 * 🔴 #1425 —— 继任关系照票面「执行清单 ③」：服务 / 卖点 / 步骤 / 服务区域 / 一般卡片都收进 `features`
 *    （同一块的几种写法），数字统计进 `milestones`，logo 墙进 `logos`，评价平台的分数条进 `reviews`。
 *    公告条（在 header 的 topbar 里）和订阅框（在 footer 的部件里）**不是页面区块**，抓到它们跳过（null），
 *    跟 header / footer 本身同一个处置。
 *    📌 头一行原来写「our 32 registered section types」—— 数字会过期，所以不再写数。
 */

const REF_SECTION_MAPPING = {
  // Direct matches
  'hero': 'hero',
  'services-list': 'features',
  'services': 'features',
  'gallery': 'gallery',
  'gallery-intro': 'gallery',
  'testimonials': 'testimonials',
  'faq': 'faq',
  'faq-accordion': 'faq',
  'team': 'team',
  'team-grid': 'team',
  'process': 'features',
  'process-steps': 'features',
  'stats': 'milestones',
  'cta': 'cta',
  'cta-banner': 'cta',
  // 订阅框是 footer 的部件（#1455），不是页面区块。
  'newsletter': null,
  'newsletter-signup': null,
  // 「奖项 / 认证 / 徽章」：有 logo 图才用 `logos`，抓站只给得出名字 ⟹ 一律 `features`（只有字的那种写法）。
  'awards': 'features',
  'partners': 'logos',
  'partner-logos': 'logos',
  'features': 'features',
  'features-grid': 'features',
  'benefits': 'features',
  'benefits-list': 'features',
  'contact': 'contact',
  'contact-info': 'contact',
  'social-proof': 'milestones',
  'timeline': 'features',
  'service-highlights': 'features',
  'pricing-table': 'pricing',
  // 「我们 vs 别人」：一串特性，不是套餐对比（`pricing` 的槽是价格 / 套餐名，对不上）。
  'comparison': 'features',
  'comparison-table': 'features',
  'checklist': 'features',
  'blog-preview': 'blog',
  // 公告条是 header 的 topbar（#1425 做什么 3），不是页面区块。
  'announcement-bar': null,
  // 分隔线没有内容；落到兜底会在页面上插一个空的文字块。
  'divider': null,
  'content-split': 'content',
  'text-block': 'content',
  'map-area': 'features',
  'values-grid': 'features',
  'trusted-brands': 'logos',

  // Industry-specific names that map to generic types
  'about-us': 'content',
  'about': 'content',
  'about-section': 'content',
  'who-we-are': 'content',
  'mission': 'content',
  'quote-banner': 'content',
  'quote': 'content',
  'banner': 'content',
  'tagline': 'content',
  'intro': 'content',
  'introduction': 'content',
  'services-pricing': 'pricing',
  'pricing': 'pricing',
  'pricing-cards': 'pricing',
  'plans': 'pricing',
  'membership-options': 'pricing',
  'membership-cards': 'pricing',
  'memberships': 'pricing',
  'packages': 'pricing',
  'products-intro': 'content',
  'products': 'features',
  'product-list': 'features',
  'product-grid': 'features',
  'locations': 'features',
  'locations-grid': 'features',
  'locations-carousel': 'features',
  'location': 'features',
  'find-us': 'contact',
  'reviews': 'testimonials',
  'client-reviews': 'testimonials',
  'customer-reviews': 'testimonials',
  // 评价平台的分数条（「Google 4.9 · 120 条」）是 `reviews`；上面那几个 *-reviews 抓到的是一条条评价原文。
  'ratings': 'reviews',
  'review-platforms': 'reviews',
  'how-it-works': 'features',
  'steps': 'features',
  'why-choose-us': 'features',
  'why-us': 'features',
  'why-choose': 'features',
  'staff': 'team',
  'our-team': 'team',
  'employees': 'team',
  'specialists': 'team',
  'gallery-grid': 'gallery',
  'portfolio': 'gallery',
  'work': 'gallery',
  'projects': 'gallery',
  'numbers': 'milestones',
  'achievements': 'milestones',
  'metrics': 'milestones',
  'subscribe': null,
  'email-signup': null,
  'certifications': 'features',
  'badges': 'features',
  'trust-badges': 'features',

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

/** 抓到一个表里没有的名字时落到哪：一段正文。必须也是注册表里真有的块（测试一起核）。 */
const FALLBACK_SECTION = 'content';

function mapRefSection(refName) {
  const normalized = normalizeRefName(refName);
  if (!normalized) return null;
  if (Object.prototype.hasOwnProperty.call(REF_SECTION_MAPPING, normalized)) {
    return REF_SECTION_MAPPING[normalized];
  }
  return FALLBACK_SECTION;
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

  // Contact variants → contact page（页面原型的 slug，不是块名）。#1642：原来全指 quote，可已经没有 quote 页了
  //   （Chris 2026-10-06「把 quote 页也删掉」+「按钮最终都导到联系我们页面」）。
  'contact': 'contact',
  'contact-us': 'contact',
  'get-in-touch': 'contact',
  'book': 'contact',
  'booking': 'contact',
  'book-appointment': 'contact',
  'book-now': 'contact',
  'quote': 'contact',
  'get-a-quote': 'contact',

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
  FALLBACK_SECTION,
  REF_NAV_MAPPING,
  mapRefSection,
  mapRefNav,
  parseRefSections,
  parseRefNavLinks,
  normalizeRefName,
};
