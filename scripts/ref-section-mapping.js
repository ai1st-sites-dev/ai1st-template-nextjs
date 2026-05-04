/**
 * ref-section-mapping.js — TICKET-119
 *
 * Maps Gemini-extracted reference site section names to our 32 registered
 * section types (see src/lib/sections/registry.ts). Used by create-site.js
 * when refPrefs.includes('layout') to hard-copy the reference site's
 * homepage section structure.
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
  'awards': 'awards-certifications',
  'awards-certifications': 'awards-certifications',
  'partners': 'logo-carousel',
  'partner-logos': 'logo-carousel',
  'logo-carousel': 'logo-carousel',
  'features': 'features-grid',
  'features-grid': 'features-grid',
  'benefits': 'benefits-list',
  'benefits-list': 'benefits-list',
  'contact': 'contact-info',
  'contact-info': 'contact-info',
  'social-proof': 'social-proof',
  'timeline': 'timeline',
  'service-highlights': 'service-highlights',
  'pricing-table': 'pricing-table',
  'feature-comparison': 'feature-comparison',
  'checklist': 'checklist',
  'blog-preview': 'blog-preview',
  'announcement-bar': 'announcement-bar',
  'divider': 'divider',
  'content-split': 'content-split',
  'text-block': 'text-block',
  'map-area': 'map-area',
  'values-grid': 'values-grid',
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
  'certifications': 'awards-certifications',
  'badges': 'awards-certifications',
  'trust-badges': 'awards-certifications',

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

module.exports = { REF_SECTION_MAPPING, mapRefSection, parseRefSections, normalizeRefName };
