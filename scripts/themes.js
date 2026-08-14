// #924 — Theme registry. THE single source of truth for what a theme is.
//
// A theme has four parts:
//   colors      配色 — primary 50-900 + accent 50-600, copied into brand.json at creation
//   fonts       字体 — heading/body families + the Google Fonts URL
//   supports    我为哪些形态写了样式 — block 类型 → 形态清单。`{}` means "no preference".
//               🔴 #1010 起这个键叫 supports,以前叫 layout(spec §4.5)。改名连着换了方向:
//               `layout` 是主题**替站做选择**(一个值),`supports` 是主题**声明能力**(一个清单),
//               站自己在页面 JSON 的 `block_layout` 里选。今天清单里恒一项,见下面 layoutFor 那段。
//               🔴 #960 起它还带两个【不是 block】的键:`header` / `footer`,顶栏和页脚的结构。
//               它们【走不了】sync-config 里那个按 `supports[block.type]` 取的循环(没有任何 block
//               的 type 叫 header/footer,加了会被 `if (!preferred) continue` 静默跳过),所以由
//               `scripts/region-layout.js` + sync-config 的 §Regions 单独消费。清单也在那个文件。
//   style       风格形容词 — one phrase, used in the AI logo prompt (was THEME_STYLE_MAP)
// plus `industries`, the keyword list the creation-time picker matches against.
//
// Who reads this file:
//   scripts/create-site.js  — picks a theme at creation, writes colors/fonts into brand.json,
//                             feeds `style` to the logo prompt, records the id in site/theme.json
//   scripts/sync-config.js  — at every build, when site/theme.json says the user applied a theme
//
// 🔴 The supports table is only consulted for sites the user actively dressed
// (site/theme.json `"applied": true`). For every other site — new sites included — the page
// JSON's own variant still decides, exactly as before. See sync-config.js §theme.
//
// #956 — 每套的 supports 表覆盖 28 种 block：registry.ts 的 34 种类型减掉 6 个一个 variant 都没有的
// （contact-form · quote-form · services-list · services-nav · values-grid · service-related-pages）。
// 加一种 block 类型、或给某个组件加一种 variant 时，这 30 张表都要跟着补，两条性质要保住：
//   ① 每套的 key 集合 == 那些有 variant 可挑的类型（键集合 #1010 改名时一个没动，仍是这 30 个）
//   ② 每个组件的每一种 variant，30 套里至少有一套用到 —— 否则 30 套在那种 block 上长得一样
// 两条都能机械核，检查脚本在 #956 的交接留言里（本仓不存这类一次性检查脚本，同 #932）。
//
// 🔴 #993 — A THEME DOES NOT DECIDE BLOCK PLACEMENT. It used to (#962/#983 gave every theme a
// `rhythm: { hide, order }` that hid blocks and re-ordered them at build time); spec D8 removed it,
// and a theme carrying that key is now a build error — see `themesWithRhythm` at the bottom of this
// file for the check and the three reasons. Which blocks a page shows, and in what order, comes only
// from the site's own page JSON: the order of the `sections` array, and each section's `hidden`.

const themes = {
  'bold-red': {
    label: 'Bold Red — strong red primary, emerald accent',
    colors: {
      primary: { 50: '#fef2f2', 100: '#fee2e2', 200: '#fecaca', 300: '#fca5a5', 400: '#f87171', 500: '#dc2626', 600: '#b91c1c', 700: '#991b1b', 800: '#7f1d1d', 900: '#450a0a' },
      accent: { 50: '#ecfdf5', 100: '#d1fae5', 200: '#a7f3d0', 300: '#6ee7b7', 400: '#34d399', 500: '#059669', 600: '#047857' }
    },
    fonts: { heading: ['Oswald', 'system-ui', 'sans-serif'], body: ['Open Sans', 'system-ui', 'sans-serif'], googleFontsUrl: 'https://fonts.googleapis.com/css2?family=Oswald:wght@400;500;600;700&family=Open+Sans:wght@400;500;600;700&display=swap' },
    supports: {
      'hero': ['gradient-overlay'], 'page-header': ['centered'], 'features-grid': ['bordered'],
      'cta-banner': ['dark'], 'testimonials': ['featured'], 'process-steps': ['horizontal'],
      'faq-accordion': ['numbered'], 'content-split': ['text-left-stats'], 'gallery': ['overlay'],
      'team-grid': ['compact'], 'stats-counter': ['dark'], 'pricing-table': ['comparison'],
      'announcement-bar': ['solid'], 'awards-certifications': ['banner'], 'benefits-list': ['numbered-large'],
      'blog-preview': ['featured'], 'checklist': ['numbered-steps'], 'contact-info': ['banner'],
      'divider': ['gradient-bar'], 'feature-comparison': ['stacked'], 'logo-carousel': ['dark'],
      'map-area': ['grouped'], 'newsletter-signup': ['split'], 'service-highlights': ['tabs'],
      'social-proof': ['highlight'], 'text-block': ['highlight-box'], 'timeline': ['milestone'],
      'trusted-brands': ['dark'],
      // #960 Region:顶栏 / 页脚的结构(section 之外的两个键,由 sync-config 的 §Regions 单独消费)
      'header': ['transparent-overlay'], 'footer': ['cta-band'],
    },
    settings: { radius: 'sharp', density: 'standard', shadow: 'strong', buttonShape: 'square' },
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
    supports: {
      'hero': ['split'], 'page-header': ['with-description'], 'features-grid': ['icon-top'],
      'cta-banner': ['solid'], 'testimonials': ['grid'], 'process-steps': ['horizontal'],
      'faq-accordion': ['two-column'], 'content-split': ['text-left'], 'gallery': ['grid'],
      'team-grid': ['grid'], 'stats-counter': ['bar'], 'pricing-table': ['cards'],
      'announcement-bar': ['dismissible'], 'awards-certifications': ['detailed'], 'benefits-list': ['cards-horizontal'],
      'blog-preview': ['featured'], 'checklist': ['two-column'], 'contact-info': ['cards'],
      'divider': ['gradient-bar'], 'feature-comparison': ['table'], 'logo-carousel': ['grid'],
      'map-area': ['cards'], 'newsletter-signup': ['split'], 'service-highlights': ['tabs'],
      'social-proof': ['review-platforms'], 'text-block': ['with-list'], 'timeline': ['horizontal'],
      'trusted-brands': ['default'],
      // #960 Region:顶栏 / 页脚的结构(section 之外的两个键,由 sync-config 的 §Regions 单独消费)
      'header': ['solid-bar'], 'footer': ['multi-column'],
    },
    settings: { radius: 'subtle', density: 'standard', shadow: 'soft', buttonShape: 'rounded' },
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
    supports: {
      'hero': ['light-split'], 'page-header': ['default'], 'features-grid': ['card'],
      'cta-banner': ['gradient'], 'testimonials': ['quote-wall'], 'process-steps': ['zigzag'],
      'faq-accordion': ['centered'], 'content-split': ['text-right'], 'gallery': ['masonry'],
      'team-grid': ['centered'], 'stats-counter': ['icon'], 'pricing-table': ['cards'],
      'announcement-bar': ['solid'], 'awards-certifications': ['grid'], 'benefits-list': ['alternating'],
      'blog-preview': ['list'], 'checklist': ['cards'], 'contact-info': ['map-style'],
      'divider': ['wave'], 'feature-comparison': ['stacked'], 'logo-carousel': ['scroll'],
      'map-area': ['cards'], 'newsletter-signup': ['inline'], 'service-highlights': ['accordion'],
      'social-proof': ['rating-bar'], 'text-block': ['default'], 'timeline': ['vertical'],
      'trusted-brands': ['pill'],
      // #960 Region:顶栏 / 页脚的结构(section 之外的两个键,由 sync-config 的 §Regions 单独消费)
      'header': ['solid-bar'], 'footer': ['multi-column'],
    },
    settings: { radius: 'round', density: 'standard', shadow: 'soft', buttonShape: 'rounded' },
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
    supports: {
      'hero': ['centered'], 'page-header': ['centered'], 'features-grid': ['minimal'],
      'cta-banner': ['gradient'], 'testimonials': ['carousel'], 'process-steps': ['cards'],
      'faq-accordion': ['cards'], 'content-split': ['centered-overlay'], 'gallery': ['masonry'],
      'team-grid': ['card-with-social'], 'stats-counter': ['gradient'], 'pricing-table': ['toggle'],
      'announcement-bar': ['floating'], 'awards-certifications': ['detailed'], 'benefits-list': ['icon-large'],
      'blog-preview': ['featured'], 'checklist': ['icon-grid'], 'contact-info': ['cards'],
      'divider': ['gradient-bar'], 'feature-comparison': ['cards'], 'logo-carousel': ['scroll'],
      'map-area': ['cards'], 'newsletter-signup': ['split'], 'service-highlights': ['cards-large'],
      'social-proof': ['badges'], 'text-block': ['highlight-box'], 'timeline': ['milestone'],
      'trusted-brands': ['pill'],
      // #960 Region:顶栏 / 页脚的结构(section 之外的两个键,由 sync-config 的 §Regions 单独消费)
      'header': ['solid-bar'], 'footer': ['cta-band'],
    },
    settings: { radius: 'round', density: 'airy', shadow: 'soft', buttonShape: 'pill' },
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
    supports: {
      'hero': ['minimal'], 'page-header': ['minimal'], 'features-grid': ['list'],
      'cta-banner': ['outlined'], 'testimonials': ['minimal'], 'process-steps': ['vertical'],
      'faq-accordion': ['two-column'], 'content-split': ['text-right-list'], 'gallery': ['grid'],
      'team-grid': ['grid'], 'stats-counter': ['inline'], 'pricing-table': ['minimal'],
      'announcement-bar': ['bordered'], 'awards-certifications': ['grid'], 'benefits-list': ['alternating'],
      'blog-preview': ['list'], 'checklist': ['two-column'], 'contact-info': ['inline'],
      'divider': ['line'], 'feature-comparison': ['table'], 'logo-carousel': ['bordered'],
      'map-area': ['grouped'], 'newsletter-signup': ['minimal'], 'service-highlights': ['accordion'],
      'social-proof': ['review-platforms'], 'text-block': ['quote'], 'timeline': ['compact'],
      'trusted-brands': ['default'],
      // #960 Region:顶栏 / 页脚的结构(section 之外的两个键,由 sync-config 的 §Regions 单独消费)
      'header': ['pill-floating'], 'footer': ['slim-row'],
    },
    settings: { radius: 'sharp', density: 'standard', shadow: 'none', buttonShape: 'square' },
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
    supports: {
      'hero': ['split'], 'page-header': ['default'], 'features-grid': ['card'],
      'cta-banner': ['gradient'], 'testimonials': ['grid'], 'process-steps': ['icon-strip'],
      'faq-accordion': ['cards'], 'content-split': ['text-left'], 'gallery': ['grid'],
      'team-grid': ['grid'], 'stats-counter': ['cards'], 'pricing-table': ['cards'],
      'announcement-bar': ['solid'], 'awards-certifications': ['banner'], 'benefits-list': ['icon-large'],
      'blog-preview': ['cards'], 'checklist': ['cards'], 'contact-info': ['banner'],
      'divider': ['gradient-bar'], 'feature-comparison': ['cards'], 'logo-carousel': ['scroll'],
      'map-area': ['cards'], 'newsletter-signup': ['card'], 'service-highlights': ['cards-large'],
      'social-proof': ['highlight'], 'text-block': ['two-column'], 'timeline': ['horizontal'],
      'trusted-brands': ['pill'],
      // #960 Region:顶栏 / 页脚的结构(section 之外的两个键,由 sync-config 的 §Regions 单独消费)
      'header': ['pill-floating'], 'footer': ['cta-band'],
    },
    settings: { radius: 'round', density: 'standard', shadow: 'soft', buttonShape: 'pill' },
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
    supports: {
      'hero': ['light-editorial'], 'page-header': ['centered'], 'features-grid': ['minimal'],
      'cta-banner': ['outlined'], 'testimonials': ['featured'], 'process-steps': ['vertical'],
      'faq-accordion': ['centered'], 'content-split': ['text-right'], 'gallery': ['carousel'],
      'team-grid': ['centered'], 'stats-counter': ['inline'], 'pricing-table': ['minimal'],
      'announcement-bar': ['bordered'], 'awards-certifications': ['grid'], 'benefits-list': ['icon-large'],
      'blog-preview': ['featured'], 'checklist': ['two-column'], 'contact-info': ['cards'],
      'divider': ['icon'], 'feature-comparison': ['columns'], 'logo-carousel': ['bordered'],
      'map-area': ['list'], 'newsletter-signup': ['card'], 'service-highlights': ['cards-large'],
      'social-proof': ['rating-bar'], 'text-block': ['quote'], 'timeline': ['vertical'],
      'trusted-brands': ['pill'],
      // #960 Region:顶栏 / 页脚的结构(section 之外的两个键,由 sync-config 的 §Regions 单独消费)
      'header': ['centered-logo'], 'footer': ['cta-band'],
    },
    settings: { radius: 'round', density: 'airy', shadow: 'soft', buttonShape: 'pill' },
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
    supports: {
      'hero': ['video-style'], 'page-header': ['minimal'], 'features-grid': ['alternating'],
      'cta-banner': ['dark'], 'testimonials': ['carousel'], 'process-steps': ['icon-strip'],
      'faq-accordion': ['numbered'], 'content-split': ['cards-row'], 'gallery': ['overlay'],
      'team-grid': ['card-with-social'], 'stats-counter': ['dark'], 'pricing-table': ['toggle'],
      'announcement-bar': ['solid'], 'awards-certifications': ['detailed'], 'benefits-list': ['numbered-large'],
      'blog-preview': ['list'], 'checklist': ['numbered-steps'], 'contact-info': ['banner'],
      'divider': ['line'], 'feature-comparison': ['columns'], 'logo-carousel': ['dark'],
      'map-area': ['badge'], 'newsletter-signup': ['card'], 'service-highlights': ['split'],
      'social-proof': ['highlight'], 'text-block': ['highlight-box'], 'timeline': ['milestone'],
      'trusted-brands': ['dark'],
      // #960 Region:顶栏 / 页脚的结构(section 之外的两个键,由 sync-config 的 §Regions 单独消费)
      'header': ['transparent-overlay'], 'footer': ['slim-row'],
    },
    settings: { radius: 'round', density: 'airy', shadow: 'strong', buttonShape: 'pill' },
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
    supports: {
      'hero': ['light-showcase'], 'page-header': ['with-description'], 'features-grid': ['alternating'],
      'cta-banner': ['solid'], 'testimonials': ['quote-wall'], 'process-steps': ['zigzag'],
      'faq-accordion': ['centered'], 'content-split': ['text-left'], 'gallery': ['masonry'],
      'team-grid': ['compact'], 'stats-counter': ['icon'], 'pricing-table': ['cards'],
      'announcement-bar': ['solid'], 'awards-certifications': ['banner'], 'benefits-list': ['alternating'],
      'blog-preview': ['featured'], 'checklist': ['numbered-steps'], 'contact-info': ['map-style'],
      'divider': ['wave'], 'feature-comparison': ['columns'], 'logo-carousel': ['bordered'],
      'map-area': ['list'], 'newsletter-signup': ['inline'], 'service-highlights': ['accordion'],
      'social-proof': ['highlight'], 'text-block': ['with-list'], 'timeline': ['milestone'],
      'trusted-brands': ['pill'],
      // #960 Region:顶栏 / 页脚的结构(section 之外的两个键,由 sync-config 的 §Regions 单独消费)
      'header': ['solid-bar'], 'footer': ['multi-column'],
    },
    settings: { radius: 'subtle', density: 'airy', shadow: 'soft', buttonShape: 'rounded' },
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
    supports: {
      'hero': ['gradient-overlay'], 'page-header': ['centered'], 'features-grid': ['icon-top'],
      'cta-banner': ['gradient'], 'testimonials': ['carousel'], 'process-steps': ['cards'],
      'faq-accordion': ['cards'], 'content-split': ['cards-row'], 'gallery': ['carousel'],
      'team-grid': ['card-with-social'], 'stats-counter': ['gradient'], 'pricing-table': ['toggle'],
      'announcement-bar': ['solid'], 'awards-certifications': ['banner'], 'benefits-list': ['numbered-large'],
      'blog-preview': ['featured'], 'checklist': ['icon-grid'], 'contact-info': ['banner'],
      'divider': ['gradient-bar'], 'feature-comparison': ['cards'], 'logo-carousel': ['dark'],
      'map-area': ['badge'], 'newsletter-signup': ['split'], 'service-highlights': ['cards-large'],
      'social-proof': ['highlight'], 'text-block': ['highlight-box'], 'timeline': ['milestone'],
      'trusted-brands': ['dark'],
      // #960 Region:顶栏 / 页脚的结构(section 之外的两个键,由 sync-config 的 §Regions 单独消费)
      'header': ['transparent-overlay'], 'footer': ['cta-band'],
    },
    settings: { radius: 'sharp', density: 'compact', shadow: 'strong', buttonShape: 'square' },
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
    supports: {
      'hero': ['left'], 'page-header': ['default'], 'features-grid': ['bordered'],
      'cta-banner': ['split'], 'testimonials': ['grid'], 'process-steps': ['horizontal'],
      'faq-accordion': ['two-column'], 'content-split': ['text-left-stats'], 'gallery': ['grid'],
      'team-grid': ['compact'], 'stats-counter': ['bar'], 'pricing-table': ['comparison'],
      'announcement-bar': ['solid'], 'awards-certifications': ['banner'], 'benefits-list': ['cards-horizontal'],
      'blog-preview': ['cards'], 'checklist': ['numbered-steps'], 'contact-info': ['banner'],
      'divider': ['gradient-bar'], 'feature-comparison': ['table'], 'logo-carousel': ['grid'],
      'map-area': ['grouped'], 'newsletter-signup': ['card'], 'service-highlights': ['tabs'],
      'social-proof': ['review-platforms'], 'text-block': ['with-list'], 'timeline': ['milestone'],
      'trusted-brands': ['default'],
      // #960 Region:顶栏 / 页脚的结构(section 之外的两个键,由 sync-config 的 §Regions 单独消费)
      'header': ['solid-bar'], 'footer': ['cta-band'],
    },
    settings: { radius: 'sharp', density: 'compact', shadow: 'none', buttonShape: 'square' },
    style: 'warm trustworthy industrial yellow',
    industries: ['construction', 'roofing', 'electrical', 'solar', 'handyman', 'contractor', 'renovation', 'plumbing', 'hvac', 'moving', 'towing', 'painting', 'auto', 'insurance', 'landscaping'],
  },

  // ─── #932 — 19 more, taking the shelf to 30 ─────────────────────────────────
  // Same four-part shape as above. Three named for real estate, three for insurance
  // (the two trades the roadshow targets); the rest are general-purpose.

  'realty-navy': {
    label: 'Realty Navy — deep navy primary, muted gold accent',
    colors: {
      primary: { 50: '#f2f6fb', 100: '#e3ecf7', 200: '#c5d7ee', 300: '#9bb9df', 400: '#6a94cb', 500: '#2a4d84', 600: '#223f6d', 700: '#1b3157', 800: '#142440', 900: '#0d1728' },
      accent: { 50: '#fdf8ed', 100: '#f9edd0', 200: '#f2dba1', 300: '#e8c469', 400: '#dbaa3c', 500: '#b8860b', 600: '#8f6708' }
    },
    fonts: { heading: ['Libre Baskerville', 'serif'], body: ['Public Sans', 'system-ui', 'sans-serif'], googleFontsUrl: 'https://fonts.googleapis.com/css2?family=Libre+Baskerville:wght@400;700&family=Public+Sans:wght@400;500;600;700;800&display=swap' },
    supports: {
      'hero': ['left'], 'page-header': ['with-description'], 'features-grid': ['bordered'],
      'cta-banner': ['solid'], 'testimonials': ['grid'], 'process-steps': ['horizontal'],
      'faq-accordion': ['two-column'], 'content-split': ['text-left-stats'], 'gallery': ['grid'],
      'team-grid': ['grid'], 'stats-counter': ['bar'], 'pricing-table': ['comparison'],
      'announcement-bar': ['dismissible'], 'awards-certifications': ['detailed'], 'benefits-list': ['alternating'],
      'blog-preview': ['list'], 'checklist': ['two-column'], 'contact-info': ['cards'],
      'divider': ['line'], 'feature-comparison': ['table'], 'logo-carousel': ['grid'],
      'map-area': ['grouped'], 'newsletter-signup': ['card'], 'service-highlights': ['accordion'],
      'social-proof': ['review-platforms'], 'text-block': ['quote'], 'timeline': ['vertical'],
      'trusted-brands': ['default'],
      // #960 Region:顶栏 / 页脚的结构(section 之外的两个键,由 sync-config 的 §Regions 单独消费)
      'header': ['solid-bar'], 'footer': ['multi-column'],
    },
    settings: { radius: 'subtle', density: 'airy', shadow: 'soft', buttonShape: 'rounded' },
    style: 'refined trustworthy deep navy',
    industries: ['real estate', 'realty', 'realtor', 'property', 'mortgage', 'appraisal', 'escrow', 'title', 'brokerage', 'architect', 'surveying'],
  },
  'realty-noir': {
    label: 'Realty Noir — near-black primary, gold accent',
    colors: {
      primary: { 50: '#f7f7f6', 100: '#eeedeb', 200: '#d9d7d3', 300: '#b8b5ae', 400: '#8b877f', 500: '#2b2926', 600: '#232120', 700: '#1b1a19', 800: '#141312', 900: '#0b0b0a' },
      accent: { 50: '#fdfaef', 100: '#faf2d5', 200: '#f4e3a8', 300: '#ecd074', 400: '#e0b944', 500: '#c9a227', 600: '#a2811d' }
    },
    fonts: { heading: ['Cormorant Garamond', 'serif'], body: ['Jost', 'system-ui', 'sans-serif'], googleFontsUrl: 'https://fonts.googleapis.com/css2?family=Cormorant+Garamond:wght@400;500;600;700&family=Jost:wght@400;500;600;700&display=swap' },
    supports: {
      'hero': ['gradient-overlay'], 'page-header': ['centered'], 'features-grid': ['minimal'],
      'cta-banner': ['dark'], 'testimonials': ['featured'], 'process-steps': ['vertical'],
      'faq-accordion': ['centered'], 'content-split': ['centered-overlay'], 'gallery': ['overlay'],
      'team-grid': ['card-with-social'], 'stats-counter': ['dark'], 'pricing-table': ['minimal'],
      'announcement-bar': ['solid'], 'awards-certifications': ['banner'], 'benefits-list': ['alternating'],
      'blog-preview': ['featured'], 'checklist': ['numbered-steps'], 'contact-info': ['inline'],
      'divider': ['line'], 'feature-comparison': ['stacked'], 'logo-carousel': ['dark'],
      'map-area': ['list'], 'newsletter-signup': ['split'], 'service-highlights': ['split'],
      'social-proof': ['highlight'], 'text-block': ['quote'], 'timeline': ['vertical'],
      'trusted-brands': ['dark'],
      // #960 Region:顶栏 / 页脚的结构(section 之外的两个键,由 sync-config 的 §Regions 单独消费)
      'header': ['transparent-overlay'], 'footer': ['slim-row'],
    },
    settings: { radius: 'sharp', density: 'airy', shadow: 'none', buttonShape: 'square' },
    style: 'luxury black and gold editorial',
    industries: ['real estate', 'realty', 'realtor', 'property', 'luxury', 'penthouse', 'interior design', 'concierge', 'yacht', 'jewelry', 'watch'],
  },
  'realty-ivory': {
    label: 'Realty Ivory — warm taupe primary, clay accent',
    colors: {
      primary: { 50: '#faf8f5', 100: '#f3efe8', 200: '#e6ded1', 300: '#d3c6b2', 400: '#b9a68c', 500: '#8a7358', 600: '#705d47', 700: '#584a39', 800: '#40362a', 900: '#29221b' },
      accent: { 50: '#fdf4f0', 100: '#fae5db', 200: '#f4c9b6', 300: '#eaa88c', 400: '#dd845f', 500: '#c25f38', 600: '#9c4a2b' }
    },
    fonts: { heading: ['Fraunces', 'serif'], body: ['Karla', 'system-ui', 'sans-serif'], googleFontsUrl: 'https://fonts.googleapis.com/css2?family=Fraunces:wght@400;500;600;700&family=Karla:wght@400;500;600;700;800&display=swap' },
    supports: {
      'hero': ['minimal'], 'page-header': ['minimal'], 'features-grid': ['list'],
      'cta-banner': ['outlined'], 'testimonials': ['minimal'], 'process-steps': ['zigzag'],
      'faq-accordion': ['centered'], 'content-split': ['text-right'], 'gallery': ['masonry'],
      'team-grid': ['centered'], 'stats-counter': ['inline'], 'pricing-table': ['minimal'],
      'announcement-bar': ['bordered'], 'awards-certifications': ['grid'], 'benefits-list': ['alternating'],
      'blog-preview': ['list'], 'checklist': ['cards'], 'contact-info': ['inline'],
      'divider': ['wave'], 'feature-comparison': ['columns'], 'logo-carousel': ['bordered'],
      'map-area': ['list'], 'newsletter-signup': ['inline'], 'service-highlights': ['accordion'],
      'social-proof': ['rating-bar'], 'text-block': ['default'], 'timeline': ['vertical'],
      'trusted-brands': ['default'],
      // #960 Region:顶栏 / 页脚的结构(section 之外的两个键,由 sync-config 的 §Regions 单独消费)
      'header': ['centered-logo'], 'footer': ['multi-column'],
    },
    settings: { radius: 'subtle', density: 'airy', shadow: 'none', buttonShape: 'rounded' },
    style: 'airy warm ivory understated',
    industries: ['real estate', 'realty', 'realtor', 'property', 'home staging', 'interior design', 'renovation', 'furniture', 'photography', 'boutique'],
  },
  'assurance-blue': {
    label: 'Assurance Blue — steel blue primary, emerald accent',
    colors: {
      primary: { 50: '#f1f7fd', 100: '#dfeefa', 200: '#bcdcf4', 300: '#8ec3ea', 400: '#58a3db', 500: '#1d6fb8', 600: '#175a97', 700: '#134878', 800: '#10375c', 900: '#0a2440' },
      accent: { 50: '#ecfdf5', 100: '#d1fae5', 200: '#a7f3d0', 300: '#6ee7b7', 400: '#34d399', 500: '#10b981', 600: '#059669' }
    },
    fonts: { heading: ['Manrope', 'system-ui', 'sans-serif'], body: ['Manrope', 'system-ui', 'sans-serif'], googleFontsUrl: 'https://fonts.googleapis.com/css2?family=Manrope:wght@400;500;600;700;800&display=swap' },
    supports: {
      'hero': ['split'], 'page-header': ['with-description'], 'features-grid': ['icon-top'],
      'cta-banner': ['solid'], 'testimonials': ['grid'], 'process-steps': ['horizontal'],
      'faq-accordion': ['two-column'], 'content-split': ['text-left'], 'gallery': ['grid'],
      'team-grid': ['grid'], 'stats-counter': ['bar'], 'pricing-table': ['comparison'],
      'announcement-bar': ['bordered'], 'awards-certifications': ['detailed'], 'benefits-list': ['icon-large'],
      'blog-preview': ['cards'], 'checklist': ['icon-grid'], 'contact-info': ['banner'],
      'divider': ['line'], 'feature-comparison': ['table'], 'logo-carousel': ['grid'],
      'map-area': ['grouped'], 'newsletter-signup': ['card'], 'service-highlights': ['tabs'],
      'social-proof': ['badges'], 'text-block': ['with-list'], 'timeline': ['vertical'],
      'trusted-brands': ['default'],
      // #960 Region:顶栏 / 页脚的结构(section 之外的两个键,由 sync-config 的 §Regions 单独消费)
      'header': ['solid-bar'], 'footer': ['multi-column'],
    },
    settings: { radius: 'subtle', density: 'standard', shadow: 'soft', buttonShape: 'rounded' },
    style: 'calm dependable corporate blue',
    industries: ['insurance', 'broker', 'benefits', 'claims', 'underwriting', 'financial', 'finance', 'advisor', 'retirement', 'mortgage', 'bank'],
  },
  'assurance-teal': {
    label: 'Assurance Teal — teal primary, warm sand accent',
    colors: {
      primary: { 50: '#effbfa', 100: '#d6f5f2', 200: '#ade9e5', 300: '#79d6d1', 400: '#43bab5', 500: '#0f8f8a', 600: '#0c7370', 700: '#0a5c5a', 800: '#084745', 900: '#052e2d' },
      accent: { 50: '#fff8ed', 100: '#ffefd4', 200: '#fedca8', 300: '#fcc272', 400: '#f8a13c', 500: '#e2811a', 600: '#b96413' }
    },
    fonts: { heading: ['Nunito Sans', 'system-ui', 'sans-serif'], body: ['Nunito Sans', 'system-ui', 'sans-serif'], googleFontsUrl: 'https://fonts.googleapis.com/css2?family=Nunito+Sans:wght@400;500;600;700;800&display=swap' },
    supports: {
      'hero': ['light-split'], 'page-header': ['default'], 'features-grid': ['card'],
      'cta-banner': ['gradient'], 'testimonials': ['carousel'], 'process-steps': ['cards'],
      'faq-accordion': ['cards'], 'content-split': ['text-right-list'], 'gallery': ['grid'],
      'team-grid': ['compact'], 'stats-counter': ['icon'], 'pricing-table': ['cards'],
      'announcement-bar': ['dismissible'], 'awards-certifications': ['detailed'], 'benefits-list': ['icon-large'],
      'blog-preview': ['cards'], 'checklist': ['two-column'], 'contact-info': ['cards'],
      'divider': ['icon'], 'feature-comparison': ['table'], 'logo-carousel': ['grid'],
      'map-area': ['grouped'], 'newsletter-signup': ['card'], 'service-highlights': ['accordion'],
      'social-proof': ['review-platforms'], 'text-block': ['with-list'], 'timeline': ['vertical'],
      'trusted-brands': ['default'],
      // #960 Region:顶栏 / 页脚的结构(section 之外的两个键,由 sync-config 的 §Regions 单独消费)
      'header': ['solid-bar'], 'footer': ['slim-row'],
    },
    settings: { radius: 'round', density: 'standard', shadow: 'soft', buttonShape: 'pill' },
    style: 'friendly reassuring teal',
    industries: ['insurance', 'life insurance', 'health', 'benefits', 'clinic', 'medical', 'dental', 'wellness', 'pharmacy', 'senior care', 'home care'],
  },
  'assurance-forest': {
    label: 'Assurance Forest — deep green primary, sand accent',
    colors: {
      primary: { 50: '#f2f9f4', 100: '#e0f2e6', 200: '#bfe4cc', 300: '#92cea9', 400: '#5faf80', 500: '#2f7d52', 600: '#256542', 700: '#1e5035', 800: '#173e29', 900: '#0e281a' },
      accent: { 50: '#fdf9ef', 100: '#faf0d6', 200: '#f3dfab', 300: '#e9c877', 400: '#dcae46', 500: '#c08f22', 600: '#97701a' }
    },
    fonts: { heading: ['Bitter', 'serif'], body: ['Cabin', 'system-ui', 'sans-serif'], googleFontsUrl: 'https://fonts.googleapis.com/css2?family=Bitter:wght@400;500;600;700&family=Cabin:wght@400;500;600;700&display=swap' },
    supports: {
      'hero': ['left'], 'page-header': ['with-description'], 'features-grid': ['alternating'],
      'cta-banner': ['solid'], 'testimonials': ['quote-wall'], 'process-steps': ['vertical'],
      'faq-accordion': ['numbered'], 'content-split': ['text-left-stats'], 'gallery': ['grid'],
      'team-grid': ['grid'], 'stats-counter': ['bar'], 'pricing-table': ['comparison'],
      'announcement-bar': ['dismissible'], 'awards-certifications': ['detailed'], 'benefits-list': ['numbered-large'],
      'blog-preview': ['cards'], 'checklist': ['two-column'], 'contact-info': ['cards'],
      'divider': ['line'], 'feature-comparison': ['table'], 'logo-carousel': ['bordered'],
      'map-area': ['list'], 'newsletter-signup': ['inline'], 'service-highlights': ['tabs'],
      'social-proof': ['review-platforms'], 'text-block': ['with-list'], 'timeline': ['compact'],
      'trusted-brands': ['default'],
      // #960 Region:顶栏 / 页脚的结构(section 之外的两个键,由 sync-config 的 §Regions 单独消费)
      'header': ['solid-bar'], 'footer': ['multi-column'],
    },
    settings: { radius: 'subtle', density: 'standard', shadow: 'none', buttonShape: 'rounded' },
    style: 'steady conservative forest green',
    industries: ['insurance', 'financial', 'finance', 'accounting', 'tax', 'estate', 'trust', 'advisor', 'credit union', 'agriculture', 'farm'],
  },
  'wine-burgundy': {
    label: 'Wine Burgundy — burgundy primary, gold accent',
    colors: {
      primary: { 50: '#fdf4f6', 100: '#fae7ec', 200: '#f3ccd6', 300: '#e6a4b6', 400: '#d47190', 500: '#8c1d3f', 600: '#741734', 700: '#5e1229', 800: '#470e1f', 900: '#2d0813' },
      accent: { 50: '#fdfaef', 100: '#faf3d6', 200: '#f3e4a9', 300: '#e9d075', 400: '#dbb944', 500: '#c19b26', 600: '#99791d' }
    },
    fonts: { heading: ['Lora', 'serif'], body: ['Work Sans', 'system-ui', 'sans-serif'], googleFontsUrl: 'https://fonts.googleapis.com/css2?family=Lora:wght@400;500;600;700&family=Work+Sans:wght@400;500;600;700&display=swap' },
    supports: {
      'hero': ['light-editorial'], 'page-header': ['centered'], 'features-grid': ['minimal'],
      'cta-banner': ['dark'], 'testimonials': ['featured'], 'process-steps': ['vertical'],
      'faq-accordion': ['centered'], 'content-split': ['text-right'], 'gallery': ['carousel'],
      'team-grid': ['centered'], 'stats-counter': ['inline'], 'pricing-table': ['minimal'],
      'announcement-bar': ['solid'], 'awards-certifications': ['detailed'], 'benefits-list': ['numbered-large'],
      'blog-preview': ['featured'], 'checklist': ['two-column'], 'contact-info': ['inline'],
      'divider': ['line'], 'feature-comparison': ['columns'], 'logo-carousel': ['bordered'],
      'map-area': ['grouped'], 'newsletter-signup': ['card'], 'service-highlights': ['accordion'],
      'social-proof': ['highlight'], 'text-block': ['quote'], 'timeline': ['milestone'],
      'trusted-brands': ['default'],
      // #960 Region:顶栏 / 页脚的结构(section 之外的两个键,由 sync-config 的 §Regions 单独消费)
      'header': ['centered-logo'], 'footer': ['multi-column'],
    },
    settings: { radius: 'subtle', density: 'airy', shadow: 'soft', buttonShape: 'rounded' },
    style: 'classic refined burgundy',
    industries: ['restaurant', 'wine', 'winery', 'bistro', 'fine dining', 'catering', 'law', 'legal', 'tailor', 'antique', 'auction'],
  },
  'arctic-mint': {
    label: 'Arctic Mint — ice blue primary, mint accent',
    colors: {
      primary: { 50: '#f0fbff', 100: '#dbf5ff', 200: '#b6eaff', 300: '#83d9fb', 400: '#48c0f0', 500: '#0e9bd0', 600: '#0a7daa', 700: '#0a6488', 800: '#094e6b', 900: '#06344a' },
      accent: { 50: '#f0fdf7', 100: '#dcfcec', 200: '#b6f6d7', 300: '#82e9bb', 400: '#4dd49b', 500: '#21b57c', 600: '#189062' }
    },
    fonts: { heading: ['Figtree', 'system-ui', 'sans-serif'], body: ['Figtree', 'system-ui', 'sans-serif'], googleFontsUrl: 'https://fonts.googleapis.com/css2?family=Figtree:wght@400;500;600;700;800&display=swap' },
    supports: {
      'hero': ['light-showcase'], 'page-header': ['centered'], 'features-grid': ['icon-top'],
      'cta-banner': ['gradient'], 'testimonials': ['grid'], 'process-steps': ['icon-strip'],
      'faq-accordion': ['two-column'], 'content-split': ['text-left'], 'gallery': ['grid'],
      'team-grid': ['grid'], 'stats-counter': ['cards'], 'pricing-table': ['cards'],
      'announcement-bar': ['dismissible'], 'awards-certifications': ['grid'], 'benefits-list': ['cards-horizontal'],
      'blog-preview': ['cards'], 'checklist': ['icon-grid'], 'contact-info': ['cards'],
      'divider': ['line'], 'feature-comparison': ['columns'], 'logo-carousel': ['grid'],
      'map-area': ['grouped'], 'newsletter-signup': ['inline'], 'service-highlights': ['tabs'],
      'social-proof': ['rating-bar'], 'text-block': ['two-column'], 'timeline': ['horizontal'],
      'trusted-brands': ['default'],
      // #960 Region:顶栏 / 页脚的结构(section 之外的两个键,由 sync-config 的 §Regions 单独消费)
      'header': ['centered-logo'], 'footer': ['cta-band'],
    },
    settings: { radius: 'round', density: 'standard', shadow: 'soft', buttonShape: 'pill' },
    style: 'clean clinical fresh ice blue',
    industries: ['medical', 'clinic', 'dental', 'pharmacy', 'optometry', 'physio', 'chiropractic', 'lab', 'skincare', 'spa', 'pool', 'hvac'],
  },
  'charcoal-lime': {
    label: 'Charcoal Lime — charcoal primary, lime accent',
    colors: {
      primary: { 50: '#f7f7f7', 100: '#ededed', 200: '#d9d9d9', 300: '#bcbcbc', 400: '#909090', 500: '#3a3a3a', 600: '#2f2f2f', 700: '#262626', 800: '#1c1c1c', 900: '#101010' },
      accent: { 50: '#f7fee7', 100: '#ecfccb', 200: '#d9f99d', 300: '#bef264', 400: '#a3e635', 500: '#7ab317', 600: '#5e8b12' }
    },
    fonts: { heading: ['Archivo', 'system-ui', 'sans-serif'], body: ['Archivo', 'system-ui', 'sans-serif'], googleFontsUrl: 'https://fonts.googleapis.com/css2?family=Archivo:wght@400;500;600;700;800&display=swap' },
    supports: {
      'hero': ['video-style'], 'page-header': ['minimal'], 'features-grid': ['bordered'],
      'cta-banner': ['dark'], 'testimonials': ['minimal'], 'process-steps': ['icon-strip'],
      'faq-accordion': ['numbered'], 'content-split': ['cards-row'], 'gallery': ['overlay'],
      'team-grid': ['compact'], 'stats-counter': ['dark'], 'pricing-table': ['toggle'],
      'announcement-bar': ['solid'], 'awards-certifications': ['grid'], 'benefits-list': ['numbered-large'],
      'blog-preview': ['featured'], 'checklist': ['icon-grid'], 'contact-info': ['banner'],
      'divider': ['line'], 'feature-comparison': ['table'], 'logo-carousel': ['dark'],
      'map-area': ['badge'], 'newsletter-signup': ['split'], 'service-highlights': ['split'],
      'social-proof': ['rating-bar'], 'text-block': ['highlight-box'], 'timeline': ['horizontal'],
      'trusted-brands': ['dark'],
      // #960 Region:顶栏 / 页脚的结构(section 之外的两个键,由 sync-config 的 §Regions 单独消费)
      'header': ['transparent-overlay'], 'footer': ['slim-row'],
    },
    settings: { radius: 'sharp', density: 'compact', shadow: 'strong', buttonShape: 'square' },
    style: 'sharp technical high-contrast',
    industries: ['auto', 'detailing', 'mechanic', 'tire', 'fabrication', 'welding', 'industrial', 'equipment', 'tech', 'it', 'gaming', 'skate'],
  },
  'terracotta': {
    label: 'Terracotta — clay primary, teal accent',
    colors: {
      primary: { 50: '#fdf6f2', 100: '#fae9e0', 200: '#f4d2bf', 300: '#ebb190', 400: '#de8a60', 500: '#b8542a', 600: '#974423', 700: '#78371c', 800: '#5b2a15', 900: '#3a1b0d' },
      accent: { 50: '#f0fbfa', 100: '#d8f4f1', 200: '#ade7e1', 300: '#79d3cb', 400: '#45b7ad', 500: '#1f958b', 600: '#17786f' }
    },
    fonts: { heading: ['Alegreya', 'serif'], body: ['Rubik', 'system-ui', 'sans-serif'], googleFontsUrl: 'https://fonts.googleapis.com/css2?family=Alegreya:wght@400;500;600;700;800&family=Rubik:wght@400;500;600;700&display=swap' },
    supports: {
      'hero': ['light-showcase'], 'page-header': ['default'], 'features-grid': ['alternating'],
      'cta-banner': ['split'], 'testimonials': ['quote-wall'], 'process-steps': ['zigzag'],
      'faq-accordion': ['cards'], 'content-split': ['text-left'], 'gallery': ['masonry'],
      'team-grid': ['centered'], 'stats-counter': ['icon'], 'pricing-table': ['cards'],
      'announcement-bar': ['bordered'], 'awards-certifications': ['detailed'], 'benefits-list': ['numbered-large'],
      'blog-preview': ['list'], 'checklist': ['cards'], 'contact-info': ['map-style'],
      'divider': ['icon'], 'feature-comparison': ['stacked'], 'logo-carousel': ['scroll'],
      'map-area': ['grouped'], 'newsletter-signup': ['card'], 'service-highlights': ['cards-large'],
      'social-proof': ['rating-bar'], 'text-block': ['quote'], 'timeline': ['vertical'],
      'trusted-brands': ['pill'],
      // #960 Region:顶栏 / 页脚的结构(section 之外的两个键,由 sync-config 的 §Regions 单独消费)
      'header': ['solid-bar'], 'footer': ['slim-row'],
    },
    settings: { radius: 'round', density: 'standard', shadow: 'soft', buttonShape: 'rounded' },
    style: 'earthy mediterranean handmade',
    industries: ['restaurant', 'mexican', 'mediterranean', 'pottery', 'ceramics', 'craft', 'tile', 'market', 'bakery', 'cafe', 'yoga', 'studio'],
  },
  'lavender-calm': {
    label: 'Lavender Calm — soft violet primary, peach accent',
    colors: {
      primary: { 50: '#f8f6fd', 100: '#f0ecfa', 200: '#e0d7f5', 300: '#c8b8ec', 400: '#a891de', 500: '#7c5fc4', 600: '#654aa5', 700: '#513b84', 800: '#3d2d64', 900: '#281d42' },
      accent: { 50: '#fff5f2', 100: '#ffe8e1', 200: '#ffcdbe', 300: '#ffab93', 400: '#fb8465', 500: '#ef6440', 600: '#cf4c2b' }
    },
    fonts: { heading: ['Quicksand', 'system-ui', 'sans-serif'], body: ['Quicksand', 'system-ui', 'sans-serif'], googleFontsUrl: 'https://fonts.googleapis.com/css2?family=Quicksand:wght@400;500;600;700&display=swap' },
    supports: {
      'hero': ['light-editorial'], 'page-header': ['centered'], 'features-grid': ['card'],
      'cta-banner': ['gradient'], 'testimonials': ['carousel'], 'process-steps': ['cards'],
      'faq-accordion': ['centered'], 'content-split': ['centered-overlay'], 'gallery': ['carousel'],
      'team-grid': ['centered'], 'stats-counter': ['gradient'], 'pricing-table': ['cards'],
      'announcement-bar': ['floating'], 'awards-certifications': ['grid'], 'benefits-list': ['icon-large'],
      'blog-preview': ['cards'], 'checklist': ['cards'], 'contact-info': ['cards'],
      'divider': ['icon'], 'feature-comparison': ['cards'], 'logo-carousel': ['scroll'],
      'map-area': ['cards'], 'newsletter-signup': ['card'], 'service-highlights': ['cards-large'],
      'social-proof': ['badges'], 'text-block': ['quote'], 'timeline': ['vertical'],
      'trusted-brands': ['pill'],
      // #960 Region:顶栏 / 页脚的结构(section 之外的两个键,由 sync-config 的 §Regions 单独消费)
      'header': ['centered-logo'], 'footer': ['slim-row'],
    },
    settings: { radius: 'round', density: 'airy', shadow: 'soft', buttonShape: 'pill' },
    style: 'soft calming pastel lavender',
    industries: ['spa', 'wellness', 'yoga', 'massage', 'therapy', 'counseling', 'mental health', 'salon', 'nail', 'beauty', 'childcare', 'doula'],
  },
  'steel-industrial': {
    label: 'Steel Industrial — steel blue primary, safety orange accent',
    colors: {
      primary: { 50: '#f5f7f9', 100: '#e8edf1', 200: '#ccd8e1', 300: '#a6bacb', 400: '#7695ae', 500: '#456a86', 600: '#38566d', 700: '#2d4557', 800: '#223442', 900: '#15212b' },
      accent: { 50: '#fff6ed', 100: '#ffe9d5', 200: '#fed0aa', 300: '#fdb174', 400: '#fb8a3c', 500: '#f26a0f', 600: '#cc520a' }
    },
    fonts: { heading: ['Barlow Condensed', 'system-ui', 'sans-serif'], body: ['Barlow', 'system-ui', 'sans-serif'], googleFontsUrl: 'https://fonts.googleapis.com/css2?family=Barlow+Condensed:wght@400;500;600;700&family=Barlow:wght@400;500;600;700&display=swap' },
    supports: {
      'hero': ['gradient-overlay'], 'page-header': ['default'], 'features-grid': ['bordered'],
      'cta-banner': ['split'], 'testimonials': ['grid'], 'process-steps': ['horizontal'],
      'faq-accordion': ['numbered'], 'content-split': ['text-left-stats'], 'gallery': ['grid'],
      'team-grid': ['compact'], 'stats-counter': ['bar'], 'pricing-table': ['comparison'],
      'announcement-bar': ['solid'], 'awards-certifications': ['banner'], 'benefits-list': ['numbered-large'],
      'blog-preview': ['cards'], 'checklist': ['numbered-steps'], 'contact-info': ['banner'],
      'divider': ['line'], 'feature-comparison': ['stacked'], 'logo-carousel': ['dark'],
      'map-area': ['badge'], 'newsletter-signup': ['split'], 'service-highlights': ['tabs'],
      'social-proof': ['highlight'], 'text-block': ['highlight-box'], 'timeline': ['milestone'],
      'trusted-brands': ['default'],
      // #960 Region:顶栏 / 页脚的结构(section 之外的两个键,由 sync-config 的 §Regions 单独消费)
      'header': ['transparent-overlay'], 'footer': ['multi-column'],
    },
    settings: { radius: 'sharp', density: 'compact', shadow: 'strong', buttonShape: 'square' },
    style: 'rugged industrial high-visibility',
    industries: ['manufacturing', 'welding', 'machining', 'industrial', 'equipment', 'warehouse', 'trucking', 'logistics', 'contractor', 'excavation', 'concrete', 'scaffolding'],
  },
  'sage-minimal': {
    label: 'Sage Minimal — sage green primary, cream accent',
    colors: {
      primary: { 50: '#f6f8f5', 100: '#eaefe8', 200: '#d3ded0', 300: '#b2c5ae', 400: '#8ba686', 500: '#5f8159', 600: '#4c6847', 700: '#3d5339', 800: '#2f402c', 900: '#1e291c' },
      accent: { 50: '#fdfbf3', 100: '#faf4e0', 200: '#f3e6ba', 300: '#ead28a', 400: '#ddb95a', 500: '#c79f36', 600: '#9e7d2a' }
    },
    fonts: { heading: ['Marcellus', 'serif'], body: ['Mulish', 'system-ui', 'sans-serif'], googleFontsUrl: 'https://fonts.googleapis.com/css2?family=Marcellus&family=Mulish:wght@400;500;600;700;800&display=swap' },
    supports: {
      'hero': ['minimal'], 'page-header': ['minimal'], 'features-grid': ['list'],
      'cta-banner': ['outlined'], 'testimonials': ['minimal'], 'process-steps': ['vertical'],
      'faq-accordion': ['centered'], 'content-split': ['text-right-list'], 'gallery': ['masonry'],
      'team-grid': ['centered'], 'stats-counter': ['inline'], 'pricing-table': ['minimal'],
      'announcement-bar': ['bordered'], 'awards-certifications': ['grid'], 'benefits-list': ['alternating'],
      'blog-preview': ['list'], 'checklist': ['two-column'], 'contact-info': ['map-style'],
      'divider': ['wave'], 'feature-comparison': ['columns'], 'logo-carousel': ['bordered'],
      'map-area': ['list'], 'newsletter-signup': ['minimal'], 'service-highlights': ['accordion'],
      'social-proof': ['rating-bar'], 'text-block': ['default'], 'timeline': ['compact'],
      'trusted-brands': ['pill'],
      // #960 Region:顶栏 / 页脚的结构(section 之外的两个键,由 sync-config 的 §Regions 单独消费)
      'header': ['centered-logo'], 'footer': ['slim-row'],
    },
    settings: { radius: 'subtle', density: 'airy', shadow: 'none', buttonShape: 'rounded' },
    style: 'quiet natural sage minimal',
    industries: ['organic', 'wellness', 'herbal', 'tea', 'interior design', 'florist', 'floral', 'eco', 'sustainable', 'yoga', 'naturopath', 'clinic'],
  },
  'mono-noir': {
    label: 'Mono Noir — black and white, single red accent',
    colors: {
      primary: { 50: '#fafafa', 100: '#f5f5f5', 200: '#e5e5e5', 300: '#d4d4d4', 400: '#a3a3a3', 500: '#262626', 600: '#1f1f1f', 700: '#171717', 800: '#0f0f0f', 900: '#050505' },
      accent: { 50: '#fef2f2', 100: '#fee2e2', 200: '#fecaca', 300: '#fca5a5', 400: '#f87171', 500: '#ef4444', 600: '#dc2626' }
    },
    fonts: { heading: ['Syne', 'system-ui', 'sans-serif'], body: ['Inter', 'system-ui', 'sans-serif'], googleFontsUrl: 'https://fonts.googleapis.com/css2?family=Syne:wght@400;500;600;700;800&family=Inter:wght@400;500;600;700&display=swap' },
    supports: {
      'hero': ['minimal'], 'page-header': ['minimal'], 'features-grid': ['minimal'],
      'cta-banner': ['dark'], 'testimonials': ['minimal'], 'process-steps': ['vertical'],
      'faq-accordion': ['two-column'], 'content-split': ['cards-row'], 'gallery': ['masonry'],
      'team-grid': ['compact'], 'stats-counter': ['dark'], 'pricing-table': ['minimal'],
      'announcement-bar': ['bordered'], 'awards-certifications': ['grid'], 'benefits-list': ['alternating'],
      'blog-preview': ['featured'], 'checklist': ['numbered-steps'], 'contact-info': ['inline'],
      'divider': ['line'], 'feature-comparison': ['stacked'], 'logo-carousel': ['dark'],
      'map-area': ['badge'], 'newsletter-signup': ['minimal'], 'service-highlights': ['split'],
      'social-proof': ['highlight'], 'text-block': ['quote'], 'timeline': ['compact'],
      'trusted-brands': ['default'],
      // #960 Region:顶栏 / 页脚的结构(section 之外的两个键,由 sync-config 的 §Regions 单独消费)
      'header': ['pill-floating'], 'footer': ['slim-row'],
    },
    settings: { radius: 'sharp', density: 'airy', shadow: 'none', buttonShape: 'square' },
    style: 'stark monochrome editorial',
    industries: ['photography', 'design', 'agency', 'architecture', 'portfolio', 'art', 'gallery', 'fashion', 'film', 'studio', 'branding'],
  },
  'coastal-teal': {
    label: 'Coastal Teal — turquoise primary, coral accent',
    colors: {
      primary: { 50: '#f0fcfb', 100: '#d5f6f4', 200: '#a9ece9', 300: '#71dbd9', 400: '#3cc2c2', 500: '#14a0a3', 600: '#0f8085', 700: '#0d666b', 800: '#0a4f53', 900: '#063437' },
      accent: { 50: '#fff7f0', 100: '#ffecdb', 200: '#ffd5b3', 300: '#ffb884', 400: '#ff9557', 500: '#f5762f', 600: '#cf5c1e' }
    },
    fonts: { heading: ['Josefin Sans', 'system-ui', 'sans-serif'], body: ['Urbanist', 'system-ui', 'sans-serif'], googleFontsUrl: 'https://fonts.googleapis.com/css2?family=Josefin+Sans:wght@400;500;600;700&family=Urbanist:wght@400;500;600;700;800&display=swap' },
    supports: {
      'hero': ['light-split'], 'page-header': ['with-description'], 'features-grid': ['card'],
      'cta-banner': ['gradient'], 'testimonials': ['carousel'], 'process-steps': ['icon-strip'],
      'faq-accordion': ['cards'], 'content-split': ['text-right'], 'gallery': ['carousel'],
      'team-grid': ['card-with-social'], 'stats-counter': ['gradient'], 'pricing-table': ['toggle'],
      'announcement-bar': ['floating'], 'awards-certifications': ['grid'], 'benefits-list': ['alternating'],
      'blog-preview': ['list'], 'checklist': ['icon-grid'], 'contact-info': ['map-style'],
      'divider': ['wave'], 'feature-comparison': ['cards'], 'logo-carousel': ['scroll'],
      'map-area': ['cards'], 'newsletter-signup': ['inline'], 'service-highlights': ['split'],
      'social-proof': ['badges'], 'text-block': ['two-column'], 'timeline': ['horizontal'],
      'trusted-brands': ['pill'],
      // #960 Region:顶栏 / 页脚的结构(section 之外的两个键,由 sync-config 的 §Regions 单独消费)
      'header': ['pill-floating'], 'footer': ['multi-column'],
    },
    settings: { radius: 'round', density: 'airy', shadow: 'soft', buttonShape: 'pill' },
    style: 'breezy coastal turquoise',
    industries: ['travel', 'tour', 'resort', 'hotel', 'marine', 'boat', 'surf', 'diving', 'fishing', 'rental', 'cottage', 'pool'],
  },
  'plum-modern': {
    label: 'Plum Modern — plum primary, gold accent',
    colors: {
      primary: { 50: '#fbf5fb', 100: '#f6e9f6', 200: '#ecd2ed', 300: '#dcaede', 400: '#c47fc7', 500: '#8e3d92', 600: '#763179', 700: '#602762', 800: '#491d4b', 900: '#2f1230' },
      accent: { 50: '#fdfaef', 100: '#fbf3d5', 200: '#f5e5a5', 300: '#edd06f', 400: '#e0b73f', 500: '#c99b1f', 600: '#a07a18' }
    },
    fonts: { heading: ['Sora', 'system-ui', 'sans-serif'], body: ['Sora', 'system-ui', 'sans-serif'], googleFontsUrl: 'https://fonts.googleapis.com/css2?family=Sora:wght@400;500;600;700;800&display=swap' },
    supports: {
      'hero': ['gradient-overlay'], 'page-header': ['centered'], 'features-grid': ['icon-top'],
      'cta-banner': ['gradient'], 'testimonials': ['featured'], 'process-steps': ['cards'],
      'faq-accordion': ['cards'], 'content-split': ['centered-overlay'], 'gallery': ['overlay'],
      'team-grid': ['card-with-social'], 'stats-counter': ['gradient'], 'pricing-table': ['toggle'],
      'announcement-bar': ['floating'], 'awards-certifications': ['grid'], 'benefits-list': ['icon-large'],
      'blog-preview': ['featured'], 'checklist': ['cards'], 'contact-info': ['banner'],
      'divider': ['gradient-bar'], 'feature-comparison': ['columns'], 'logo-carousel': ['dark'],
      'map-area': ['cards'], 'newsletter-signup': ['split'], 'service-highlights': ['split'],
      'social-proof': ['highlight'], 'text-block': ['highlight-box'], 'timeline': ['milestone'],
      'trusted-brands': ['pill'],
      // #960 Region:顶栏 / 页脚的结构(section 之外的两个键,由 sync-config 的 §Regions 单独消费)
      'header': ['transparent-overlay'], 'footer': ['cta-band'],
    },
    settings: { radius: 'round', density: 'standard', shadow: 'strong', buttonShape: 'pill' },
    style: 'modern glamorous plum',
    industries: ['beauty', 'boutique', 'event', 'wedding', 'planner', 'florist', 'cake', 'fashion', 'makeup', 'lashes', 'marketing'],
  },
  'copper-dark': {
    label: 'Copper Dark — dark copper primary, slate blue accent',
    colors: {
      primary: { 50: '#fbf6f2', 100: '#f5eae0', 200: '#e9d2be', 300: '#d9b193', 400: '#c48b62', 500: '#96551f', 600: '#7c4519', 700: '#633714', 800: '#4a290f', 900: '#2e1909' },
      accent: { 50: '#f4f6f9', 100: '#e6ebf2', 200: '#c9d5e3', 300: '#a3b7cd', 400: '#7692b0', 500: '#4d6c8d', 600: '#3d5772' }
    },
    fonts: { heading: ['Bebas Neue', 'system-ui', 'sans-serif'], body: ['Heebo', 'system-ui', 'sans-serif'], googleFontsUrl: 'https://fonts.googleapis.com/css2?family=Bebas+Neue&family=Heebo:wght@400;500;600;700;800&display=swap' },
    supports: {
      'hero': ['video-style'], 'page-header': ['default'], 'features-grid': ['alternating'],
      'cta-banner': ['dark'], 'testimonials': ['quote-wall'], 'process-steps': ['zigzag'],
      'faq-accordion': ['numbered'], 'content-split': ['text-right-list'], 'gallery': ['overlay'],
      'team-grid': ['compact'], 'stats-counter': ['dark'], 'pricing-table': ['comparison'],
      'announcement-bar': ['solid'], 'awards-certifications': ['detailed'], 'benefits-list': ['numbered-large'],
      'blog-preview': ['featured'], 'checklist': ['cards'], 'contact-info': ['banner'],
      'divider': ['icon'], 'feature-comparison': ['stacked'], 'logo-carousel': ['dark'],
      'map-area': ['list'], 'newsletter-signup': ['inline'], 'service-highlights': ['split'],
      'social-proof': ['highlight'], 'text-block': ['highlight-box'], 'timeline': ['milestone'],
      'trusted-brands': ['dark'],
      // #960 Region:顶栏 / 页脚的结构(section 之外的两个键,由 sync-config 的 §Regions 单独消费)
      'header': ['transparent-overlay'], 'footer': ['slim-row'],
    },
    settings: { radius: 'sharp', density: 'standard', shadow: 'strong', buttonShape: 'square' },
    style: 'vintage workshop copper and iron',
    industries: ['barber', 'tattoo', 'brewery', 'whisky', 'roaster', 'leather', 'butcher', 'smokehouse', 'woodwork', 'forge', 'menswear'],
  },
  'sky-clinic': {
    label: 'Sky Clinic — light medical blue primary, soft green accent',
    colors: {
      primary: { 50: '#f0f9ff', 100: '#e0f2fe', 200: '#bae6fd', 300: '#7dd3fc', 400: '#38bdf8', 500: '#0284c7', 600: '#0369a1', 700: '#075985', 800: '#0c4a6e', 900: '#082f49' },
      accent: { 50: '#f2fbf5', 100: '#e0f6e8', 200: '#bfead0', 300: '#92d9ae', 400: '#61c288', 500: '#37a566', 600: '#2a8552' }
    },
    fonts: { heading: ['Nunito', 'system-ui', 'sans-serif'], body: ['Nunito', 'system-ui', 'sans-serif'], googleFontsUrl: 'https://fonts.googleapis.com/css2?family=Nunito:wght@400;500;600;700;800&display=swap' },
    supports: {
      'hero': ['light-split'], 'page-header': ['with-description'], 'features-grid': ['card'],
      'cta-banner': ['solid'], 'testimonials': ['grid'], 'process-steps': ['horizontal'],
      'faq-accordion': ['two-column'], 'content-split': ['text-left'], 'gallery': ['grid'],
      'team-grid': ['grid'], 'stats-counter': ['icon'], 'pricing-table': ['cards'],
      'announcement-bar': ['dismissible'], 'awards-certifications': ['grid'], 'benefits-list': ['icon-large'],
      'blog-preview': ['cards'], 'checklist': ['icon-grid'], 'contact-info': ['cards'],
      'divider': ['icon'], 'feature-comparison': ['cards'], 'logo-carousel': ['grid'],
      'map-area': ['cards'], 'newsletter-signup': ['card'], 'service-highlights': ['accordion'],
      'social-proof': ['rating-bar'], 'text-block': ['with-list'], 'timeline': ['vertical'],
      'trusted-brands': ['pill'],
      // #960 Region:顶栏 / 页脚的结构(section 之外的两个键,由 sync-config 的 §Regions 单独消费)
      'header': ['pill-floating'], 'footer': ['cta-band'],
    },
    settings: { radius: 'round', density: 'standard', shadow: 'soft', buttonShape: 'pill' },
    style: 'friendly approachable healthcare blue',
    industries: ['medical', 'clinic', 'dental', 'pediatric', 'veterinary', 'pharmacy', 'home care', 'nursing', 'optometry', 'physio', 'walk-in', 'lab'],
  },
  'graphite-amber': {
    label: 'Graphite Amber — graphite primary, amber accent',
    colors: {
      primary: { 50: '#f7f8f8', 100: '#eceef0', 200: '#d7dbdf', 300: '#b6bdc4', 400: '#8b959f', 500: '#4a545d', 600: '#3c454c', 700: '#30373d', 800: '#242a2f', 900: '#16191d' },
      accent: { 50: '#fffbeb', 100: '#fef3c7', 200: '#fde68a', 300: '#fcd34d', 400: '#fbbf24', 500: '#f59e0b', 600: '#d97706' }
    },
    fonts: { heading: ['IBM Plex Sans', 'system-ui', 'sans-serif'], body: ['IBM Plex Sans', 'system-ui', 'sans-serif'], googleFontsUrl: 'https://fonts.googleapis.com/css2?family=IBM+Plex+Sans:wght@400;500;600;700&display=swap' },
    supports: {
      'hero': ['left'], 'page-header': ['default'], 'features-grid': ['list'],
      'cta-banner': ['split'], 'testimonials': ['grid'], 'process-steps': ['horizontal'],
      'faq-accordion': ['numbered'], 'content-split': ['text-left-stats'], 'gallery': ['grid'],
      'team-grid': ['grid'], 'stats-counter': ['inline'], 'pricing-table': ['comparison'],
      'announcement-bar': ['bordered'], 'awards-certifications': ['grid'], 'benefits-list': ['cards-horizontal'],
      'blog-preview': ['cards'], 'checklist': ['two-column'], 'contact-info': ['inline'],
      'divider': ['line'], 'feature-comparison': ['table'], 'logo-carousel': ['bordered'],
      'map-area': ['grouped'], 'newsletter-signup': ['minimal'], 'service-highlights': ['tabs'],
      'social-proof': ['review-platforms'], 'text-block': ['with-list'], 'timeline': ['compact'],
      'trusted-brands': ['default'],
      // #960 Region:顶栏 / 页脚的结构(section 之外的两个键,由 sync-config 的 §Regions 单独消费)
      'header': ['pill-floating'], 'footer': ['multi-column'],
    },
    settings: { radius: 'sharp', density: 'compact', shadow: 'none', buttonShape: 'square' },
    style: 'utilitarian graphite and amber',
    industries: ['logistics', 'moving', 'storage', 'warehouse', 'courier', 'freight', 'junk removal', 'towing', 'security', 'printing', 'signage', 'it'],
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

// 一套主题对每个 block 用哪种写法的结论，或者 {}（主题不认识 / 什么都没声明）。调用方把 {}
// 当成「页面 JSON 说了算」。
//
// 🔴 #1010 —— 注册表那边的键已经从 `layout` 改成 `supports`，值也从「一个写法」变成「一个清单」，
// 而这个函数**仍然吐一个写法**：`supports` 里每个 block 取清单的第一项。为什么要有这一步转换：
//
//   · 声明能力（`supports`，主题）和做选择（`block_layout`，站）是两件事，spec §4.5 / §4.6 把它们
//     分开了。而**站那边今天还不做这个选择** —— #998 落地的 `block_layout` 与 `data.variant` 是
//     并存的两个字段、彼此不换算（`scripts/blocks.js:21-22`），建站 AI 也还不供 `block_layout`。
//   · 所以在站真的开始选之前，得有人替它选，而唯一不改变任何一个站的选法就是「主题声明的第一项」
//     —— 今天每份清单恒一项，取第一项 == 改名前那个值，逐字节相同（#1010 对 30 套 × 30 个键全量比过）。
//   · 这个函数因此是**过渡态的适配器**，不是新能力。阶段 2 逐块把外观搬进 CSS 之后，`supports` 的值
//     会从外观词（`gradient-overlay`）换成结构词（`with-media`），那时消费方改成读清单、这一层就删掉。
//     🔴 在那之前别给它加第二个用途 —— 它存在的理由只有「让改名这一步产物不变」这一条。
function layoutFor(themeId) {
  const t = themes[themeId];
  if (!t || !t.supports) return {};
  const out = {};
  for (const [type, forms] of Object.entries(t.supports)) {
    if (Array.isArray(forms)) { if (forms.length) out[type] = forms[0]; }
    else out[type] = forms;
  }
  return out;
}

// #961 — 风格设定（theme settings）：圆角 / 留白 / 阴影 / 按钮形状。
// 每套恒四个键，每个键的值必须落在下面的允许集合里 —— 不是随手写的词，一条 grep 就能判。
// 🔴 这四个集合与 `src/lib/themeSettings.ts` 里那几张表的键必须一一对应：表是把档位翻成
//    CSS 变量的地方，这里是数据这边的权威。对不上的档位在那边会被【整组跳过】，落回默认值
//    （老站今天的样子），所以失败方向是"没变"而不是"变成别的" —— 但那也意味着这套 theme 的
//    这一维静默失效，所以有一条测试盯着两边相等。
const THEME_SETTING_VALUES = {
  radius: ['subtle', 'sharp', 'round'],
  density: ['standard', 'compact', 'airy'],
  shadow: ['soft', 'none', 'strong'],
  buttonShape: ['rounded', 'square', 'pill'],
};

function settingsFor(themeId) {
  const t = themes[themeId];
  return (t && t.settings) || null;
}

// #993 — a theme may NOT carry a `rhythm` key any more, and this is the check that says so.
//
// Why the rule (spec D8, Chris 2026-08-13 "换主题不改 block placement"): which blocks a page shows
// and in what order is the site's own decision, and it lives in the site's page JSON. Three reasons
// it cannot be a theme's:
//   1. it is business-driven, not aesthetic — a bakery leads with the menu, a law firm with credentials
//   2. the blocks a theme would be hiding are the ones carrying the structured data search engines and
//      AI assistants read. A theme that hides them turns off the site's ability to be found.
//   3. with only a few dozen themes in the pool, "the theme decides the order" means every site wearing
//      the same theme has the SAME order and the same hidden blocks. Once the CSS work flattens the
//      markup, placement is the main thing left that tells two of our sites apart.
//
// 🔴 It reports the WHOLE registry, not the one theme being built — the same reason `themesMissingRhythm`
// did (#983): a check that only looks at the theme this site happens to wear leaves a `rhythm` sitting in
// any of the other 29 unmentioned, which is precisely how it would come back.
function themesWithRhythm() {
  return Object.keys(themes).filter((id) => themes[id].rhythm !== undefined);
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
  THEME_SETTING_VALUES,
  themeStyle,
  layoutFor,
  settingsFor,
  themesWithRhythm,
  candidateThemesForIndustry,
  rotationIndexFromSiteId,
  pickThemeForIndustry,
};
