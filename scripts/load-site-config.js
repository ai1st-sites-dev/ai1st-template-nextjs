#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

const siteConfig = process.env.SITE_CONFIG || 'security-vendor';
const rootDir = path.resolve(__dirname, '..');
const sourceDir = path.join(rootDir, 'sites', siteConfig);
const targetDir = path.join(rootDir, 'config');

if (!fs.existsSync(sourceDir)) {
  console.error(`Site config not found: ${sourceDir}`);
  console.error(`Available sites: ${fs.readdirSync(path.join(rootDir, 'sites')).join(', ')}`);
  process.exit(1);
}

// Sync source to target (overwrite in-place to preserve webpack file watchers for HMR)
function copyDir(src, dest) {
  fs.mkdirSync(dest, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);
    if (entry.isDirectory()) {
      copyDir(srcPath, destPath);
    } else {
      fs.copyFileSync(srcPath, destPath);
    }
  }
}

fs.mkdirSync(targetDir, { recursive: true });

// Clear subdirectories (pages/, blog/) to remove stale files when switching sites
// but keep top-level config/ directory alive so webpack watchers stay intact
for (const entry of fs.readdirSync(targetDir, { withFileTypes: true })) {
  if (entry.isDirectory()) {
    fs.rmSync(path.join(targetDir, entry.name), { recursive: true });
  }
}

copyDir(sourceDir, targetDir);
console.log(`Loaded site config: ${siteConfig}`);

// Aggregate blog posts into blog-index.json
const blogSourceDir = path.join(sourceDir, 'blog');
let blogPosts = [];

if (fs.existsSync(blogSourceDir)) {
  const blogFiles = fs.readdirSync(blogSourceDir).filter(f => f.endsWith('.json'));
  for (const file of blogFiles) {
    const content = JSON.parse(fs.readFileSync(path.join(blogSourceDir, file), 'utf-8'));
    blogPosts.push(content);
  }
  // Sort by publishedAt descending (newest first)
  blogPosts.sort((a, b) => new Date(b.publishedAt).getTime() - new Date(a.publishedAt).getTime());
  console.log(`  Found ${blogPosts.length} blog post(s)`);
}

fs.writeFileSync(path.join(targetDir, 'blog-index.json'), JSON.stringify(blogPosts, null, 2));
console.log(`  Wrote blog-index.json (${blogPosts.length} posts)`);

// Aggregate pages into pages-all.json (recursive — supports subdirectories)
const pagesDir = path.join(targetDir, 'pages');
let allPages = [];

function readPagesRecursive(dir, prefix) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      readPagesRecursive(path.join(dir, entry.name), prefix ? `${prefix}/${entry.name}` : entry.name);
    } else if (entry.name.endsWith('.json')) {
      const content = JSON.parse(fs.readFileSync(path.join(dir, entry.name), 'utf-8'));
      // For subdirectory files, ensure slug = parentDir/filename (without .json)
      if (prefix) {
        const baseName = entry.name.replace(/\.json$/, '');
        content.slug = `${prefix}/${baseName}`;
      }
      allPages.push(content);
    }
  }
}

if (fs.existsSync(pagesDir)) {
  readPagesRecursive(pagesDir, '');
  // Sort by navOrder ascending
  allPages.sort((a, b) => (a.navOrder ?? 99) - (b.navOrder ?? 99));
  console.log(`  Found ${allPages.length} page(s)`);
}

fs.writeFileSync(path.join(targetDir, 'pages-all.json'), JSON.stringify(allPages, null, 2));
console.log(`  Wrote pages-all.json (${allPages.length} pages)`);

// Auto-generate navigation.json from page metadata
const navPath = path.join(targetDir, 'navigation.json');
const existingNav = JSON.parse(fs.readFileSync(navPath, 'utf-8'));

const nonHomePages = allPages.filter(p => p.slug !== 'home');
const isServiceDetailPage = p => p.serviceDetailPage === true || (p.slug.startsWith('services/') && p.slug !== 'services');
const isKeywordPage = p => (p.keywordPage === true || p.slug.includes('/')) && !isServiceDetailPage(p);
const regularPages = nonHomePages.filter(p => !isKeywordPage(p) && !isServiceDetailPage(p));
const keywordPages = nonHomePages.filter(p => isKeywordPage(p));
const serviceDetailPages = nonHomePages.filter(p => isServiceDetailPage(p));

// Header links: regular pages only (keyword pages excluded — too many for header)
const ctaSlug = existingNav.header.cta.href.replace(/^\//, '');
const headerLinks = [
  { label: 'Home', href: '/' },
  ...regularPages
    .filter(p => p.navLabel && p.slug !== ctaSlug)
    .map(p => ({ label: p.navLabel, href: `/${p.slug}` }))
];

// Footer: Quick Links (regular pages) + keyword pages in existing extra columns
const footerLinks = [
  { label: 'Home', href: '/' },
  ...regularPages
    .filter(p => p.navLabel)
    .map(p => ({ label: p.navLabel, href: `/${p.slug}` }))
];

existingNav.header.links = headerLinks;
// Update footer quick links column (first column only — preserve extra columns for keyword pages)
if (existingNav.footer.columns.length > 0) {
  existingNav.footer.columns[0].links = footerLinks;
}

// Service detail page links are handled by the hardcoded Footer.tsx Services section

// Group keyword pages by service (first slug segment) — one footer column per service
// Only add if create-site.js didn't already set keyword columns
const hasKeywordColumns = existingNav.footer.columns.some(c => c.title !== 'Quick Links');
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
console.log(`  Regenerated navigation.json`);

// Generate src/lib/config-data.ts for HMR-compatible imports
// (webpack properly detects .ts file changes, unlike cached JSON module imports)
const configDataPath = path.join(rootDir, 'src', 'lib', 'config-data.ts');
const allConfigs = {
  brand: JSON.parse(fs.readFileSync(path.join(targetDir, 'brand.json'), 'utf-8')),
  navigation: JSON.parse(fs.readFileSync(path.join(targetDir, 'navigation.json'), 'utf-8')),
  seo: JSON.parse(fs.readFileSync(path.join(targetDir, 'seo.json'), 'utf-8')),
  services: JSON.parse(fs.readFileSync(path.join(targetDir, 'services.json'), 'utf-8')),
  blogPosts: JSON.parse(fs.readFileSync(path.join(targetDir, 'blog-index.json'), 'utf-8')),
  allPages: JSON.parse(fs.readFileSync(path.join(targetDir, 'pages-all.json'), 'utf-8')),
};

const tsContent = `// Auto-generated by load-site-config.js — do not edit manually
export const brand = ${JSON.stringify(allConfigs.brand)};
export const navigation = ${JSON.stringify(allConfigs.navigation)};
export const seo = ${JSON.stringify(allConfigs.seo)};
export const services = ${JSON.stringify(allConfigs.services)};
export const blogPosts = ${JSON.stringify(allConfigs.blogPosts)};
export const allPages = ${JSON.stringify(allConfigs.allPages)};
`;
fs.writeFileSync(configDataPath, tsContent);
console.log(`  Generated src/lib/config-data.ts`);
