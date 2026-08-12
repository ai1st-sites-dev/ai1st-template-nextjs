#!/usr/bin/env node

// TICKET-219 decouple e2e: no-op comment — makes a templates/nextjs change so a
// templates+manager push verifies templates skips (no token) without blocking manager.

const fs = require('fs');
const path = require('path');
const { themes, layoutFor } = require('./themes');

const rootDir = path.resolve(__dirname, '..');
const siteDir = path.join(rootDir, 'site');

if (!fs.existsSync(siteDir) || !fs.existsSync(path.join(siteDir, 'brand.json'))) {
  console.error(`Site config not found: ${siteDir}/brand.json`);
  process.exit(1);
}

// #924 — themes. site/theme.json records which theme this site got and whether its owner
// ever actively changed themes:
//
//     { "themeId": "ocean-blue", "applied": true }
//
//   applied !== true, or no file at all (every site that existed before #924, and every
//     newly created site) → nothing below touches the build. brand.json's own colors and the
//     page JSON's own variants decide, exactly as they did before this file knew about themes.
//   applied === true → the registry takes over the look: colors, fonts, and every section
//     variant the theme states a preference for. Page JSON on disk is never rewritten — the
//     override lives only in the generated config-data.ts.
//
// 🔴 Deliberately its own file. Whether site_meta.json exists is the legacy single-locale
// switch (line ~34 below), so putting this in there would make an old flat site fail to build.
function readAppliedThemeId() {
  const themePath = path.join(siteDir, 'theme.json');
  if (!fs.existsSync(themePath)) return null;
  let meta;
  try {
    meta = JSON.parse(fs.readFileSync(themePath, 'utf-8'));
  } catch (e) {
    console.error(`theme.json is not valid JSON: ${e.message}`);
    process.exit(1);
  }
  if (!meta || meta.applied !== true) return null;
  if (!themes[meta.themeId]) {
    console.error(`theme.json names theme "${meta.themeId}", which is not in the registry (${Object.keys(themes).join(', ')})`);
    process.exit(1);
  }
  return meta.themeId;
}
const appliedThemeId = readAppliedThemeId();

// TICKET-127: backward-compat for pre-122a legacy single-locale schema. Old
// sites have a flat `site/{brand,seo,services,navigation}.json + site/pages/`
// layout with no site_meta.json and `brand.tagline` as a string (not Record).
// Detecting absence of site_meta.json triggers legacy mode: defaultLocale='en',
// locales=['en'], localeDir=siteDir (no <locale>/ subdir), and brand.tagline
// gets wrapped to { en: <string> } so templates that read getTagline(locale)
// keep working uniformly.
const siteMetaPath = path.join(siteDir, 'site_meta.json');
let defaultLocale, locales;
let isLegacySchema = false;
// TICKET-268b: the built static site needs its own siteId (tenant id for POST /api/leads) + the
// lead API base (absolute manager URL — the site is served from R2, so the form POSTs cross-origin).
let siteId = '';
let leadApi = '';

if (!fs.existsSync(siteMetaPath)) {
  console.log('[backward-compat] site_meta.json missing, inferring legacy single-locale schema (defaultLocale=en)');
  defaultLocale = 'en';
  locales = ['en'];
  isLegacySchema = true;
} else {
  const siteMeta = JSON.parse(fs.readFileSync(siteMetaPath, 'utf-8'));
  ({ defaultLocale, locales } = siteMeta);
  siteId = siteMeta.siteId || '';
  leadApi = siteMeta.leadApi || '';

  if (!defaultLocale || !Array.isArray(locales) || locales.length === 0) {
    console.error(`site_meta.json invalid: must contain defaultLocale (string) and locales (non-empty array)`);
    process.exit(1);
  }
  if (!locales.includes(defaultLocale)) {
    console.error(`site_meta.json invalid: defaultLocale "${defaultLocale}" not in locales [${locales.join(', ')}]`);
    process.exit(1);
  }
}

console.log(`Syncing site config (locales: ${locales.join(', ')}, default: ${defaultLocale})${isLegacySchema ? ' [legacy schema]' : ''}...`);

const brand = JSON.parse(fs.readFileSync(path.join(siteDir, 'brand.json'), 'utf-8'));

// TICKET-127: legacy brand.tagline is a string; new schema is Record<locale, string>.
// Wrap legacy form so templates' getTagline(locale) returns the right value uniformly.
// Defensive: missing / null / non-object tagline becomes empty Record so getTagline()
// falls through to its '' default instead of crashing on `null[locale]` or similar.
if (typeof brand.tagline === 'string') {
  brand.tagline = { [defaultLocale]: brand.tagline };
} else if (!brand.tagline || typeof brand.tagline !== 'object' || Array.isArray(brand.tagline)) {
  brand.tagline = { [defaultLocale]: '' };
}

// TICKET-136: legacy brand.name is a string; new schema is Record<locale, string>.
// Auto-wrap so downstream code (lib/config.ts getBrandName + components reading
// brand.name) can treat the field uniformly as a Record without typecheck.
if (typeof brand.name === 'string') {
  brand.name = { [defaultLocale]: brand.name };
} else if (!brand.name || typeof brand.name !== 'object' || Array.isArray(brand.name)) {
  brand.name = { [defaultLocale]: '' };
}

// #924: an applied theme owns the palette and the typefaces. brand.json keeps whatever it
// had (name, logo, locations, form ids) — only these two fields are taken over, and only in
// memory, so switching theme id is the whole of "change theme".
if (appliedThemeId) {
  brand.colors = themes[appliedThemeId].colors;
  brand.fonts = themes[appliedThemeId].fonts;
  // #961: 风格设定跟配色、字体走同一条路 —— 记进 brand，layout.tsx 翻成 CSS 变量。
  // 没应用 theme 的站这里什么都不写 ⟹ 页面上一个覆盖都没有 ⟹ 落回 globals.css 的默认值，
  // 也就是这张票改动之前的样子。
  brand.settings = themes[appliedThemeId].settings;
}

const seoByLocale = {};
const servicesByLocale = {};
const navigationByLocale = {};
const pagesByLocale = {};
const blogPostsByLocale = {};

// TICKET-133: defensive fallback for the home page navLabel. AI translation
// and translatePageWithClaude both already translate page.navLabel, so the
// happy path is `homePage.navLabel` — this map is only used when navLabel is
// missing (old sites pre-122a / partial translation failure / etc).
const HOME_LABELS = {
  en: 'Home', zh: '首页', fr: 'Accueil', es: 'Inicio',
  ja: 'ホーム', ko: '홈', de: 'Startseite', it: 'Home',
  pt: 'Início', ru: 'Главная', vi: 'Trang chủ',
  ar: 'الرئيسية', hi: 'होम', th: 'หน้าแรก',
};

function readPagesRecursive(dir, prefix, accumulator) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      readPagesRecursive(path.join(dir, entry.name), prefix ? `${prefix}/${entry.name}` : entry.name, accumulator);
    } else if (entry.name.endsWith('.json')) {
      const content = JSON.parse(fs.readFileSync(path.join(dir, entry.name), 'utf-8'));
      if (prefix) {
        const baseName = entry.name.replace(/\.json$/, '');
        content.slug = `${prefix}/${baseName}`;
      }
      accumulator.push(content);
    }
  }
}

for (const locale of locales) {
  // TICKET-127: legacy schema reads from site/ root (flat); new schema from
  // site/<locale>/ subdir. localeDir abstraction lets the rest of the loop
  // work uniformly for both layouts.
  const localeDir = isLegacySchema ? siteDir : path.join(siteDir, locale);
  if (!isLegacySchema && !fs.existsSync(localeDir)) {
    console.error(`Locale directory missing: ${localeDir}`);
    process.exit(1);
  }

  // Required per-locale files: seo.json, services.json, navigation.json, pages/home.json
  // pages/home.json is required because [locale]/page.tsx unconditionally renders getHomePage(locale).sections
  for (const required of ['seo.json', 'services.json', 'navigation.json', 'pages/home.json']) {
    if (!fs.existsSync(path.join(localeDir, required))) {
      console.error(`Required file missing: ${path.join(localeDir, required)}`);
      process.exit(1);
    }
  }

  seoByLocale[locale] = JSON.parse(fs.readFileSync(path.join(localeDir, 'seo.json'), 'utf-8'));
  servicesByLocale[locale] = JSON.parse(fs.readFileSync(path.join(localeDir, 'services.json'), 'utf-8'));
  if (!Array.isArray(servicesByLocale[locale])) {
    console.error(`Locale "${locale}" services.json must be an array (current type: ${typeof servicesByLocale[locale]})`);
    process.exit(1);
  }

  // Aggregate pages (recursive)
  const pagesDir = path.join(localeDir, 'pages');
  const localePages = [];
  if (fs.existsSync(pagesDir)) {
    readPagesRecursive(pagesDir, '', localePages);
    localePages.sort((a, b) => (a.navOrder ?? 99) - (b.navOrder ?? 99));
  }
  pagesByLocale[locale] = localePages;
  console.log(`  [${locale}] Found ${localePages.length} page(s)`);

  // Validate home page exists with slug='home' — [locale]/page.tsx calls
  // getHomePage(locale) which uses pages.find(p => p.slug === 'home').
  // File-existence (line 65 required check) is not sufficient: home.json may
  // exist with a wrong slug. The sections invariant for the home page is
  // covered by the all-pages loop below.
  const homePage = localePages.find((p) => p.slug === 'home');
  if (!homePage) {
    console.error(`Locale "${locale}" missing required home page: pages/home.json must contain { "slug": "home", "sections": [...] }`);
    process.exit(1);
  }

  // Validate every page's sections invariant. Both [locale]/page.tsx (home,
  // via getHomePage(locale).sections) and [locale]/[...slug]/page.tsx
  // (non-home, via page.sections.some(s => s.type === ...)) unconditionally
  // access page.sections and individual section.type. SectionRenderer expects
  // each section to be an object with a "type" string field.
  for (const p of localePages) {
    if (!Array.isArray(p.sections)) {
      const t = p.sections === undefined ? 'undefined' : p.sections === null ? 'null' : typeof p.sections;
      console.error(`Locale "${locale}" page "${p.slug}" missing "sections" array (current type: ${t})`);
      process.exit(1);
    }
    for (let i = 0; i < p.sections.length; i++) {
      const s = p.sections[i];
      if (!s || typeof s !== 'object' || typeof s.type !== 'string') {
        console.error(`Locale "${locale}" page "${p.slug}" sections[${i}] invalid (must be object with "type" string field)`);
        process.exit(1);
      }
    }
  }

  // Aggregate blog posts (optional)
  const blogDir = path.join(localeDir, 'blog');
  const localeBlogPosts = [];
  if (fs.existsSync(blogDir)) {
    const blogFiles = fs.readdirSync(blogDir).filter(f => f.endsWith('.json'));
    for (const file of blogFiles) {
      localeBlogPosts.push(JSON.parse(fs.readFileSync(path.join(blogDir, file), 'utf-8')));
    }
    localeBlogPosts.sort((a, b) => new Date(b.publishedAt).getTime() - new Date(a.publishedAt).getTime());
  }
  blogPostsByLocale[locale] = localeBlogPosts;
  console.log(`  [${locale}] Found ${localeBlogPosts.length} blog post(s)`);

  // Auto-generate navigation per locale (preserves CTA from existing navigation.json)
  const navPath = path.join(localeDir, 'navigation.json');
  const existingNav = JSON.parse(fs.readFileSync(navPath, 'utf-8'));

  const nonHomePages = localePages.filter(p => p.slug !== 'home');
  const isServiceDetailPage = p => p.serviceDetailPage === true || (p.slug.startsWith('services/') && p.slug !== 'services');
  const isKeywordPage = p => (p.keywordPage === true || p.slug.includes('/')) && !isServiceDetailPage(p);
  const regularPages = nonHomePages.filter(p => !isKeywordPage(p) && !isServiceDetailPage(p));
  const keywordPages = nonHomePages.filter(p => isKeywordPage(p));

  // TICKET-133: bypass-translation bug — these arrays previously hardcoded
  // 'Home' here, overwriting AI-translated navigation.json on every prebuild.
  // Use the home page's own navLabel (already translated by AI / 122b
  // translatePageWithClaude); fall back to a native-language map if missing.
  const homeLabel = homePage.navLabel || HOME_LABELS[locale] || 'Home';
  const ctaSlug = existingNav.header.cta.href.replace(/^\//, '');
  const headerLinks = [
    { label: homeLabel, href: '/' },
    ...regularPages
      .filter(p => p.navLabel && p.slug !== ctaSlug)
      .map(p => ({ label: p.navLabel, href: `/${p.slug}` }))
  ];

  const footerLinks = [
    { label: homeLabel, href: '/' },
    ...regularPages
      .filter(p => p.navLabel)
      .map(p => ({ label: p.navLabel, href: `/${p.slug}` }))
  ];

  existingNav.header.links = headerLinks;
  if (existingNav.footer.columns.length > 0) {
    existingNav.footer.columns[0].links = footerLinks;
  }

  // Group keyword pages by service — one footer column per service.
  // TICKET-135: column 0 is always the "Quick Links" column (potentially
  // translated as "快速链接" / "Liens rapides" / etc), and any column at
  // index ≥1 was added by this loop on a prior run as a keyword grouping.
  // Detect by index rather than the literal English title so this still works
  // after translateSupportingFiles localizes column 0's title.
  const hasKeywordColumns = existingNav.footer.columns.length > 1;
  if (keywordPages.length > 0 && !hasKeywordColumns) {
    const groups = {};
    for (const p of keywordPages) {
      const serviceSlug = p.slug.split('/')[0];
      if (!groups[serviceSlug]) groups[serviceSlug] = [];
      groups[serviceSlug].push(p);
    }
    for (const [serviceSlug, pages] of Object.entries(groups)) {
      existingNav.footer.columns.push({
        title: serviceSlug.replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase()),
        links: pages.slice(0, 6).map(p => ({ label: p.title, href: `/${p.slug}` })),
      });
    }
  }

  fs.writeFileSync(navPath, JSON.stringify(existingNav, null, 2));
  navigationByLocale[locale] = existingNav;
  console.log(`  [${locale}] Regenerated navigation.json`);
}

// #924: an applied theme also owns the layout. For every section type the theme has an
// opinion about, its variant wins over the one the page JSON carries; section types it says
// nothing about are left alone. Runs after the locale loop on purpose — navigation.json is
// the one file written back to disk up there, and it must not pick any of this up.
if (appliedThemeId) {
  const layout = layoutFor(appliedThemeId);
  let overridden = 0;
  for (const locale of locales) {
    for (const page of pagesByLocale[locale]) {
      for (const section of page.sections) {
        const preferred = layout[section.type];
        if (!preferred) continue;
        section.data = { ...(section.data || {}), variant: preferred };
        overridden++;
      }
    }
  }
  console.log(`  Theme "${appliedThemeId}" applied: colors + fonts + ${overridden} section variant(s)`);
}

const configDataPath = path.join(rootDir, 'src', 'lib', 'config-data.ts');
// TICKET-268b: build-time env overrides site_meta (lets the deploy pick the env's manager URL).
const resolvedLeadApi = process.env.NEXT_PUBLIC_LEAD_API || leadApi || '';
const tsContent = `// Auto-generated by sync-config.js — do not edit manually
export const siteId = ${JSON.stringify(siteId)};
export const leadApi = ${JSON.stringify(resolvedLeadApi)};
export const defaultLocale = ${JSON.stringify(defaultLocale)};
export const locales = ${JSON.stringify(locales)};
export const brand = ${JSON.stringify(brand)};
export const seoByLocale = ${JSON.stringify(seoByLocale)};
export const servicesByLocale = ${JSON.stringify(servicesByLocale)};
export const navigationByLocale = ${JSON.stringify(navigationByLocale)};
export const pagesByLocale = ${JSON.stringify(pagesByLocale)};
export const blogPostsByLocale = ${JSON.stringify(blogPostsByLocale)};
`;
fs.writeFileSync(configDataPath, tsContent);
console.log('  Generated src/lib/config-data.ts');
