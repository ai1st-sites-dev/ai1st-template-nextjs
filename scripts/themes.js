// #924 — Theme registry. THE single source of truth for what a theme is.
//
// A theme has four parts:
//   colors      配色 — primary 50-900 + accent 50-600, copied into brand.json at creation
//   fonts       字体 — heading/body families + the Google Fonts URL
//   layout      版式偏好表 — section type → variant. `{}` means "no preference".
//   style       风格形容词 — one phrase, used in the AI logo prompt (was THEME_STYLE_MAP)
// plus `industries`, the keyword list the creation-time picker matches against.
//
// Who reads this file:
//   scripts/create-site.js  — picks a theme at creation, writes colors/fonts into brand.json,
//                             feeds `style` to the logo prompt, records the id in site/theme.json
//   scripts/sync-config.js  — at every build, when site/theme.json says the user applied a theme
//
// 🔴 The layout table is only consulted for sites the user actively dressed
// (site/theme.json `"applied": true`). For every other site — new sites included — the page
// JSON's own variant still decides, exactly as before. See sync-config.js §theme.

const themes = {
  'bold-red': {
    label: 'Bold Red — strong red primary, emerald accent',
    colors: {
      primary: { 50: '#fef2f2', 100: '#fee2e2', 200: '#fecaca', 300: '#fca5a5', 400: '#f87171', 500: '#dc2626', 600: '#b91c1c', 700: '#991b1b', 800: '#7f1d1d', 900: '#450a0a' },
      accent: { 50: '#ecfdf5', 100: '#d1fae5', 200: '#a7f3d0', 300: '#6ee7b7', 400: '#34d399', 500: '#059669', 600: '#047857' }
    },
    fonts: { heading: ['Oswald', 'system-ui', 'sans-serif'], body: ['Open Sans', 'system-ui', 'sans-serif'], googleFontsUrl: 'https://fonts.googleapis.com/css2?family=Oswald:wght@400;500;600;700&family=Open+Sans:wght@400;500;600;700&display=swap' },
    layout: {
      'hero': 'gradient-overlay', 'page-header': 'centered', 'features-grid': 'bordered',
      'cta-banner': 'dark', 'testimonials': 'featured', 'process-steps': 'horizontal',
      'faq-accordion': 'numbered', 'content-split': 'text-left-stats', 'gallery': 'overlay',
      'team-grid': 'compact', 'stats-counter': 'dark', 'pricing-table': 'comparison',
    },
    style: 'bold confident strong red accent',
    industries: ['security', 'fire', 'emergency', 'alarm', 'protection', 'martial arts', 'boxing', 'gym', 'fitness', 'auto', 'towing', 'construction', 'roofing', 'plumbing', 'restaurant'],
  },
  'ocean-blue': {
    label: 'Ocean Blue — deep blue primary, amber accent',
    colors: {
      primary: { 50: '#eff6ff', 100: '#dbeafe', 200: '#bfdbfe', 300: '#93c5fd', 400: '#60a5fa', 500: '#2563eb', 600: '#1d4ed8', 700: '#1e40af', 800: '#1e3a8a', 900: '#172554' },
      accent: { 50: '#fffbeb', 100: '#fef3c7', 200: '#fde68a', 300: '#fcd34d', 400: '#fbbf24', 500: '#f59e0b', 600: '#d97706' }
    },
    fonts: { heading: ['Inter', 'system-ui', 'sans-serif'], body: ['Inter', 'system-ui', 'sans-serif'], googleFontsUrl: 'https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap' },
    layout: {
      'hero': 'split', 'page-header': 'with-description', 'features-grid': 'icon-top',
      'cta-banner': 'solid', 'testimonials': 'grid', 'process-steps': 'horizontal',
      'faq-accordion': 'two-column', 'content-split': 'text-left', 'gallery': 'grid',
      'team-grid': 'grid', 'stats-counter': 'bar', 'pricing-table': 'cards',
    },
    style: 'modern professional clean blue',
    industries: ['tech', 'software', 'consulting', 'insurance', 'finance', 'accounting', 'plumbing', 'pool', 'marine', 'law', 'legal', 'medical', 'clinic', 'dental', 'corporate', 'real estate', 'realty', 'hvac', 'cleaning'],
  },
  'forest-green': {
    label: 'Forest Green — green primary, yellow accent',
    colors: {
      primary: { 50: '#f0fdf4', 100: '#dcfce7', 200: '#bbf7d0', 300: '#86efac', 400: '#4ade80', 500: '#16a34a', 600: '#15803d', 700: '#166534', 800: '#14532d', 900: '#052e16' },
      accent: { 50: '#fefce8', 100: '#fef9c3', 200: '#fef08a', 300: '#fde047', 400: '#facc15', 500: '#eab308', 600: '#ca8a04' }
    },
    fonts: { heading: ['Montserrat', 'system-ui', 'sans-serif'], body: ['Open Sans', 'system-ui', 'sans-serif'], googleFontsUrl: 'https://fonts.googleapis.com/css2?family=Montserrat:wght@400;500;600;700;800&family=Open+Sans:wght@400;500;600;700&display=swap' },
    layout: {
      'hero': 'left', 'page-header': 'default', 'features-grid': 'card',
      'cta-banner': 'gradient', 'testimonials': 'quote-wall', 'process-steps': 'zigzag',
      'faq-accordion': 'centered', 'content-split': 'text-right', 'gallery': 'masonry',
      'team-grid': 'centered', 'stats-counter': 'icon', 'pricing-table': 'cards',
    },
    style: 'natural organic balanced green',
    industries: ['landscaping', 'garden', 'organic', 'farm', 'eco', 'environment', 'natural', 'hemp', 'cannabis', 'cleaning', 'pest', 'tree', 'solar', 'veterinary', 'wellness', 'dental'],
  },
  'royal-purple': {
    label: 'Royal Purple — purple primary, teal accent',
    colors: {
      primary: { 50: '#faf5ff', 100: '#f3e8ff', 200: '#e9d5ff', 300: '#d8b4fe', 400: '#c084fc', 500: '#9333ea', 600: '#7e22ce', 700: '#6b21a8', 800: '#581c87', 900: '#3b0764' },
      accent: { 50: '#f0fdfa', 100: '#ccfbf1', 200: '#99f6e4', 300: '#5eead4', 400: '#2dd4bf', 500: '#14b8a6', 600: '#0d9488' }
    },
    fonts: { heading: ['Poppins', 'system-ui', 'sans-serif'], body: ['Poppins', 'system-ui', 'sans-serif'], googleFontsUrl: 'https://fonts.googleapis.com/css2?family=Poppins:wght@400;500;600;700;800&display=swap' },
    layout: {
      'hero': 'centered', 'page-header': 'centered', 'features-grid': 'minimal',
      'cta-banner': 'gradient', 'testimonials': 'carousel', 'process-steps': 'cards',
      'faq-accordion': 'cards', 'content-split': 'centered-overlay', 'gallery': 'masonry',
      'team-grid': 'card-with-social', 'stats-counter': 'gradient', 'pricing-table': 'toggle',
    },
    style: 'elegant creative refined purple',
    industries: ['salon', 'spa', 'beauty', 'creative', 'agency', 'design', 'art', 'dance', 'yoga', 'photography', 'event', 'wedding', 'boutique'],
  },
  'slate-pro': {
    label: 'Slate Pro — slate/charcoal primary, sky blue accent',
    colors: {
      primary: { 50: '#f8fafc', 100: '#f1f5f9', 200: '#e2e8f0', 300: '#cbd5e1', 400: '#94a3b8', 500: '#475569', 600: '#334155', 700: '#1e293b', 800: '#0f172a', 900: '#020617' },
      accent: { 50: '#f0f9ff', 100: '#e0f2fe', 200: '#bae6fd', 300: '#7dd3fc', 400: '#38bdf8', 500: '#0ea5e9', 600: '#0284c7' }
    },
    fonts: { heading: ['Raleway', 'system-ui', 'sans-serif'], body: ['Raleway', 'system-ui', 'sans-serif'], googleFontsUrl: 'https://fonts.googleapis.com/css2?family=Raleway:wght@400;500;600;700;800&display=swap' },
    layout: {
      'hero': 'minimal', 'page-header': 'minimal', 'features-grid': 'list',
      'cta-banner': 'outlined', 'testimonials': 'minimal', 'process-steps': 'vertical',
      'faq-accordion': 'two-column', 'content-split': 'text-right-list', 'gallery': 'grid',
      'team-grid': 'grid', 'stats-counter': 'inline', 'pricing-table': 'minimal',
    },
    style: 'minimal professional neutral slate',
    industries: ['law', 'legal', 'corporate', 'real estate', 'realty', 'architect', 'engineering', 'consulting', 'accounting', 'insurance', 'it', 'security', 'moving', 'logistics'],
  },
  'sunset-orange': {
    label: 'Sunset Orange — warm orange primary, indigo accent',
    colors: {
      primary: { 50: '#fff7ed', 100: '#ffedd5', 200: '#fed7aa', 300: '#fdba74', 400: '#fb923c', 500: '#ea580c', 600: '#c2410c', 700: '#9a3412', 800: '#7c2d12', 900: '#431407' },
      accent: { 50: '#eef2ff', 100: '#e0e7ff', 200: '#c7d2fe', 300: '#a5b4fc', 400: '#818cf8', 500: '#6366f1', 600: '#4f46e5' }
    },
    fonts: { heading: ['DM Sans', 'system-ui', 'sans-serif'], body: ['DM Sans', 'system-ui', 'sans-serif'], googleFontsUrl: 'https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;600;700;800&display=swap' },
    layout: {
      'hero': 'split', 'page-header': 'default', 'features-grid': 'card',
      'cta-banner': 'gradient', 'testimonials': 'grid', 'process-steps': 'icon-strip',
      'faq-accordion': 'cards', 'content-split': 'text-left', 'gallery': 'grid',
      'team-grid': 'grid', 'stats-counter': 'cards', 'pricing-table': 'cards',
    },
    style: 'warm energetic vibrant orange',
    industries: ['restaurant', 'food', 'catering', 'pizza', 'fitness', 'gym', 'sports', 'moving', 'bakery', 'cafe', 'coffee', 'event', 'party', 'painting', 'handyman', 'cleaning'],
  },
  'rose-gold': {
    label: 'Rose Gold — rose primary, gold accent',
    colors: {
      primary: { 50: '#fff1f2', 100: '#ffe4e6', 200: '#fecdd3', 300: '#fda4af', 400: '#fb7185', 500: '#e11d48', 600: '#be123c', 700: '#9f1239', 800: '#881337', 900: '#4c0519' },
      accent: { 50: '#fffbeb', 100: '#fef3c7', 200: '#fde68a', 300: '#fcd34d', 400: '#fbbf24', 500: '#d97706', 600: '#b45309' }
    },
    fonts: { heading: ['Playfair Display', 'serif'], body: ['Lato', 'system-ui', 'sans-serif'], googleFontsUrl: 'https://fonts.googleapis.com/css2?family=Playfair+Display:wght@400;500;600;700;800&family=Lato:wght@400;500;600;700&display=swap' },
    layout: {
      'hero': 'centered', 'page-header': 'centered', 'features-grid': 'minimal',
      'cta-banner': 'outlined', 'testimonials': 'featured', 'process-steps': 'vertical',
      'faq-accordion': 'centered', 'content-split': 'text-right', 'gallery': 'carousel',
      'team-grid': 'centered', 'stats-counter': 'inline', 'pricing-table': 'minimal',
    },
    style: 'soft elegant warm rose-gold',
    industries: ['dental', 'wedding', 'florist', 'boutique', 'fashion', 'jewelry', 'cosmetic', 'salon', 'spa', 'beauty', 'photography', 'bakery', 'cafe', 'coffee'],
  },
  'midnight': {
    label: 'Midnight — dark navy primary, cyan accent',
    colors: {
      primary: { 50: '#f0f4ff', 100: '#dbe4ff', 200: '#bac8ff', 300: '#91a7ff', 400: '#748ffc', 500: '#4263eb', 600: '#3b5bdb', 700: '#364fc7', 800: '#2b3ea0', 900: '#1b2a6b' },
      accent: { 50: '#ecfeff', 100: '#cffafe', 200: '#a5f3fc', 300: '#67e8f9', 400: '#22d3ee', 500: '#06b6d4', 600: '#0891b2' }
    },
    fonts: { heading: ['Space Grotesk', 'system-ui', 'sans-serif'], body: ['Space Grotesk', 'system-ui', 'sans-serif'], googleFontsUrl: 'https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@400;500;600;700&display=swap' },
    layout: {
      'hero': 'video-style', 'page-header': 'minimal', 'features-grid': 'alternating',
      'cta-banner': 'dark', 'testimonials': 'carousel', 'process-steps': 'icon-strip',
      'faq-accordion': 'numbered', 'content-split': 'cards-row', 'gallery': 'overlay',
      'team-grid': 'card-with-social', 'stats-counter': 'dark', 'pricing-table': 'toggle',
    },
    style: 'modern luxury deep dark',
    industries: ['nightlife', 'music', 'gaming', 'cyber', 'auto', 'detailing', 'barber', 'tech', 'software', 'media', 'video', 'security', 'it', 'law', 'legal', 'fitness', 'gym', 'salon'],
  },
  'earth-tone': {
    label: 'Earth Tone — warm brown primary, sage green accent',
    colors: {
      primary: { 50: '#fdf8f1', 100: '#f5e6d3', 200: '#e8cba5', 300: '#d4a574', 400: '#c08552', 500: '#92643a', 600: '#7a5230', 700: '#634126', 800: '#4d321d', 900: '#352213' },
      accent: { 50: '#f1f8f4', 100: '#dceee3', 200: '#b9dcc7', 300: '#8fc5a5', 400: '#6aad84', 500: '#4a9167', 600: '#3a7553' }
    },
    fonts: { heading: ['Merriweather', 'serif'], body: ['Source Sans 3', 'system-ui', 'sans-serif'], googleFontsUrl: 'https://fonts.googleapis.com/css2?family=Merriweather:wght@400;700;900&family=Source+Sans+3:wght@400;500;600;700&display=swap' },
    layout: {
      'hero': 'left', 'page-header': 'with-description', 'features-grid': 'alternating',
      'cta-banner': 'solid', 'testimonials': 'quote-wall', 'process-steps': 'zigzag',
      'faq-accordion': 'centered', 'content-split': 'text-left', 'gallery': 'masonry',
      'team-grid': 'compact', 'stats-counter': 'icon', 'pricing-table': 'cards',
    },
    style: 'natural organic warm earthy',
    industries: ['bakery', 'cafe', 'coffee', 'woodwork', 'furniture', 'pottery', 'craft', 'vintage', 'restaurant', 'landscaping', 'farm', 'construction', 'renovation', 'veterinary', 'real estate', 'realty', 'roofing'],
  },
  'electric': {
    label: 'Electric — vibrant pink primary, lime accent',
    colors: {
      primary: { 50: '#fdf2f8', 100: '#fce7f3', 200: '#fbcfe8', 300: '#f9a8d4', 400: '#f472b6', 500: '#ec4899', 600: '#db2777', 700: '#be185d', 800: '#9d174d', 900: '#831843' },
      accent: { 50: '#f7fee7', 100: '#ecfccb', 200: '#d9f99d', 300: '#bef264', 400: '#a3e635', 500: '#84cc16', 600: '#65a30d' }
    },
    fonts: { heading: ['Outfit', 'system-ui', 'sans-serif'], body: ['Outfit', 'system-ui', 'sans-serif'], googleFontsUrl: 'https://fonts.googleapis.com/css2?family=Outfit:wght@400;500;600;700;800&display=swap' },
    layout: {
      'hero': 'gradient-overlay', 'page-header': 'centered', 'features-grid': 'icon-top',
      'cta-banner': 'gradient', 'testimonials': 'carousel', 'process-steps': 'cards',
      'faq-accordion': 'cards', 'content-split': 'cards-row', 'gallery': 'carousel',
      'team-grid': 'card-with-social', 'stats-counter': 'gradient', 'pricing-table': 'toggle',
    },
    style: 'bold energetic vibrant neon',
    industries: ['photography', 'video', 'media', 'marketing', 'social', 'event', 'party', 'entertainment', 'gaming', 'music', 'agency', 'design', 'wedding', 'tech', 'software'],
  },
  'golden-yellow': {
    label: 'Golden Yellow — warm yellow/gold primary, charcoal accent',
    colors: {
      primary: { 50: '#fefce8', 100: '#fef9c3', 200: '#fef08a', 300: '#fde047', 400: '#facc15', 500: '#eab308', 600: '#ca8a04', 700: '#a16207', 800: '#854d0e', 900: '#713f12' },
      accent: { 50: '#f8fafc', 100: '#f1f5f9', 200: '#e2e8f0', 300: '#cbd5e1', 400: '#94a3b8', 500: '#475569', 600: '#334155' }
    },
    fonts: { heading: ['Playfair Display', 'serif'], body: ['Source Sans 3', 'system-ui', 'sans-serif'], googleFontsUrl: 'https://fonts.googleapis.com/css2?family=Playfair+Display:wght@400;500;600;700;800&family=Source+Sans+3:wght@400;500;600;700&display=swap' },
    layout: {
      'hero': 'left', 'page-header': 'default', 'features-grid': 'bordered',
      'cta-banner': 'split', 'testimonials': 'grid', 'process-steps': 'horizontal',
      'faq-accordion': 'two-column', 'content-split': 'text-left-stats', 'gallery': 'grid',
      'team-grid': 'compact', 'stats-counter': 'bar', 'pricing-table': 'comparison',
    },
    style: 'warm trustworthy industrial yellow',
    industries: ['construction', 'roofing', 'electrical', 'solar', 'handyman', 'contractor', 'renovation', 'plumbing', 'hvac', 'moving', 'towing', 'painting', 'auto', 'insurance', 'landscaping'],
  },
};

// Used when a theme id isn't in the registry (a site created before that theme was retired,
// or a hand-edited theme.json). Same string the old THEME_STYLE_MAP fell back to.
const DEFAULT_LOGO_STYLE = 'minimal modern flat 2D';

// Creation-time rotation needs at least this many candidates, otherwise every business in
// the same trade comes out looking identical. Industries whose keyword list doesn't reach
// it get topped up from NEUTRAL_TOPUP (visually generic themes that suit anything).
const MIN_ROTATION_POOL = 3;
const NEUTRAL_TOPUP = ['slate-pro', 'ocean-blue', 'earth-tone', 'midnight'];

function themeStyle(themeId) {
  const t = themes[themeId];
  return (t && t.style) || DEFAULT_LOGO_STYLE;
}

// The layout preference table for a theme, or {} when the theme is unknown / states no
// preference. Callers treat {} as "page JSON decides".
function layoutFor(themeId) {
  const t = themes[themeId];
  return (t && t.layout) || {};
}

// Every theme that suits this industry, in registry order (so rotation is predictable).
// Never shorter than MIN_ROTATION_POOL; never empty.
function candidateThemesForIndustry(industry) {
  const lower = String(industry || '').toLowerCase();
  const pool = Object.keys(themes).filter(id =>
    themes[id].industries.some(kw => lower.includes(kw))
  );
  for (const id of NEUTRAL_TOPUP) {
    if (pool.length >= MIN_ROTATION_POOL) break;
    if (!pool.includes(id)) pool.push(id);
  }
  return pool;
}

// siteId is 8 random hex chars, so this spreads uniformly. It is the fallback for when the
// caller has no rotation counter (anonymous create, DB read failed) — consecutive sites
// then land on unrelated slots instead of stepping through the pool, which still spreads,
// just without the guarantee.
function rotationIndexFromSiteId(siteId) {
  const s = String(siteId || '');
  let h = 0;
  for (let i = 0; i < s.length; i++) {
    h = (h * 31 + s.charCodeAt(i)) >>> 0;
  }
  return h;
}

// rotationIndex is a counter that goes up by one per site the same user creates (Manager
// passes it as themeRotationIndex). N consecutive creates in one industry therefore walk
// N different slots of the candidate pool.
function pickThemeForIndustry(industry, rotationIndex) {
  const pool = candidateThemesForIndustry(industry);
  const n = Number.isInteger(rotationIndex) && rotationIndex >= 0
    ? rotationIndex
    : Math.floor(Math.random() * pool.length);
  return pool[n % pool.length];
}

module.exports = {
  themes,
  DEFAULT_LOGO_STYLE,
  MIN_ROTATION_POOL,
  themeStyle,
  layoutFor,
  candidateThemesForIndustry,
  rotationIndexFromSiteId,
  pickThemeForIndustry,
};
