#!/usr/bin/env node

/**
 * create-site.js — Docker container version
 *
 * Reads JSON config from stdin, generates a website using Claude API,
 * outputs JSON lines progress events to stdout, then starts next dev for preview.
 *
 * Usage: echo '{"siteId":"a1b2c3d4",...}' | ANTHROPIC_API_KEY=xxx node scripts/create-site.js
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const Anthropic = require('@anthropic-ai/sdk');
const { parseRefSections, parseRefNavLinks } = require('./ref-section-mapping');

// ─── AI Model Config ─────────────────────────────────────────────────────────

let model = 'claude-sonnet-4-6';
let maxTokens = 32000;

const MODEL_PRICING = {
  'claude-opus-4':   { input: 15, output: 75 },
  'claude-sonnet-4': { input: 3,  output: 15 },
  'claude-haiku-4':  { input: 0.80, output: 4 },
};

function getModelPricing(modelId) {
  for (const [prefix, pricing] of Object.entries(MODEL_PRICING)) {
    if (modelId.startsWith(prefix)) return pricing;
  }
  return { input: 3, output: 15 };
}

let pricing = getModelPricing(model);

// ─── Emit structured events to stdout ─────────────────────────────────────────

const startTime = Date.now();

function elapsed() {
  return ((Date.now() - startTime) / 1000).toFixed(1) + 's';
}

function emit(event, data = {}) {
  const line = JSON.stringify({ event, elapsed: elapsed(), ...data });
  process.stdout.write(line + '\n');
}

function progress(message, percent) {
  emit('progress', { message, percent });
}

function fatal(message) {
  emit('error', { message });
  process.exit(1);
}

// Suppress all console.log/warn/error to avoid polluting stdout JSON lines
console.log = () => {};
console.warn = () => {};
// Keep stderr for debugging inside the container
const debug = (...args) => process.stderr.write(args.join(' ') + '\n');

// ─── Color Palette Generation ─────────────────────────────────────────────────

// Generate a full shade palette (50-900) from a single hex color
// Uses HSL manipulation to create lighter (50) to darker (900) variants
function generatePalette(hex) {
  const { h, s, l } = hexToHsl(hex);
  // Target lightness for each shade (Tailwind-style distribution)
  const primary900 = { 50: 97, 100: 93, 200: 86, 300: 76, 400: 62, 500: 46, 600: 39, 700: 32, 800: 24, 900: 14 };
  const palette = {};
  for (const [shade, targetL] of Object.entries(primary900)) {
    palette[shade] = hslToHex(h, s, targetL);
  }
  // Use the original color as 500 (or closest match)
  palette['500'] = hex;
  return palette;
}

function generateAccentPalette(hex) {
  const { h, s, l } = hexToHsl(hex);
  const targets = { 50: 97, 100: 93, 200: 86, 300: 76, 400: 62, 500: 46, 600: 39 };
  const palette = {};
  for (const [shade, targetL] of Object.entries(targets)) {
    palette[shade] = hslToHex(h, s, targetL);
  }
  palette['500'] = hex;
  return palette;
}

function hexToHsl(hex) {
  hex = hex.replace('#', '');
  const r = parseInt(hex.substr(0, 2), 16) / 255;
  const g = parseInt(hex.substr(2, 2), 16) / 255;
  const b = parseInt(hex.substr(4, 2), 16) / 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  let h, s, l = (max + min) / 2;
  if (max === min) { h = s = 0; }
  else {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    switch (max) {
      case r: h = ((g - b) / d + (g < b ? 6 : 0)) / 6; break;
      case g: h = ((b - r) / d + 2) / 6; break;
      case b: h = ((r - g) / d + 4) / 6; break;
    }
  }
  return { h: Math.round(h * 360), s: Math.round(s * 100), l: Math.round(l * 100) };
}

function hslToHex(h, s, l) {
  s /= 100; l /= 100;
  const a = s * Math.min(l, 1 - l);
  const f = n => { const k = (n + h / 30) % 12; return l - a * Math.max(Math.min(k - 3, 9 - k, 1), -1); };
  const toHex = x => Math.round(x * 255).toString(16).padStart(2, '0');
  return `#${toHex(f(0))}${toHex(f(8))}${toHex(f(4))}`;
}

// ─── Font Matching ────────────────────────────────────────────────────────────

// Google Fonts whitelist — only fonts we know are available and work well for websites
const GOOGLE_FONTS = {
  'Inter': { fallback: 'sans-serif', weights: '400;500;600;700;800' },
  'Montserrat': { fallback: 'sans-serif', weights: '400;500;600;700;800' },
  'Open Sans': { fallback: 'sans-serif', weights: '400;500;600;700' },
  'Poppins': { fallback: 'sans-serif', weights: '400;500;600;700;800' },
  'Raleway': { fallback: 'sans-serif', weights: '400;500;600;700;800' },
  'Oswald': { fallback: 'sans-serif', weights: '400;500;600;700' },
  'Playfair Display': { fallback: 'serif', weights: '400;500;600;700;800' },
  'Merriweather': { fallback: 'serif', weights: '400;700;900' },
  'Lato': { fallback: 'sans-serif', weights: '400;500;600;700' },
  'Roboto': { fallback: 'sans-serif', weights: '400;500;700' },
  'DM Sans': { fallback: 'sans-serif', weights: '400;500;600;700;800' },
  'Space Grotesk': { fallback: 'sans-serif', weights: '400;500;600;700' },
  'Outfit': { fallback: 'sans-serif', weights: '400;500;600;700;800' },
  'Nunito': { fallback: 'sans-serif', weights: '400;500;600;700;800' },
  'Source Sans 3': { fallback: 'sans-serif', weights: '400;500;600;700' },
  'Work Sans': { fallback: 'sans-serif', weights: '400;500;600;700;800' },
  'Rubik': { fallback: 'sans-serif', weights: '400;500;600;700' },
  'Manrope': { fallback: 'sans-serif', weights: '400;500;600;700;800' },
  'Plus Jakarta Sans': { fallback: 'sans-serif', weights: '400;500;600;700;800' },
  'Libre Baskerville': { fallback: 'serif', weights: '400;700' },
  'Lora': { fallback: 'serif', weights: '400;500;600;700' },
  'Bitter': { fallback: 'serif', weights: '400;500;600;700' },
};

// Build brand.fonts object from Google Font names (with whitelist validation)
function buildFontsFromRef(headingFont, bodyFont) {
  const h = GOOGLE_FONTS[headingFont];
  const b = GOOGLE_FONTS[bodyFont] || GOOGLE_FONTS[headingFont];
  if (!h) return null; // not in whitelist, fall back to theme
  const hName = headingFont;
  const bName = b ? (bodyFont && GOOGLE_FONTS[bodyFont] ? bodyFont : headingFont) : headingFont;
  const hInfo = h;
  const bInfo = GOOGLE_FONTS[bName];
  // Build Google Fonts URL
  const families = [];
  const hParam = hName.replace(/ /g, '+');
  families.push(`family=${hParam}:wght@${hInfo.weights}`);
  if (bName !== hName) {
    const bParam = bName.replace(/ /g, '+');
    families.push(`family=${bParam}:wght@${bInfo.weights}`);
  }
  const url = `https://fonts.googleapis.com/css2?${families.join('&')}&display=swap`;
  return {
    heading: [hName, 'system-ui', hInfo.fallback],
    body: [bName, 'system-ui', bInfo.fallback],
    googleFontsUrl: url,
  };
}

// ─── Theme Presets ────────────────────────────────────────────────────────────

const themes = {
  'bold-red': {
    label: 'Bold Red — strong red primary, emerald accent',
    colors: {
      primary: { 50: '#fef2f2', 100: '#fee2e2', 200: '#fecaca', 300: '#fca5a5', 400: '#f87171', 500: '#dc2626', 600: '#b91c1c', 700: '#991b1b', 800: '#7f1d1d', 900: '#450a0a' },
      accent: { 50: '#ecfdf5', 100: '#d1fae5', 200: '#a7f3d0', 300: '#6ee7b7', 400: '#34d399', 500: '#059669', 600: '#047857' }
    },
    fonts: { heading: ['Oswald', 'system-ui', 'sans-serif'], body: ['Open Sans', 'system-ui', 'sans-serif'], googleFontsUrl: 'https://fonts.googleapis.com/css2?family=Oswald:wght@400;500;600;700&family=Open+Sans:wght@400;500;600;700&display=swap' }
  },
  'ocean-blue': {
    label: 'Ocean Blue — deep blue primary, amber accent',
    colors: {
      primary: { 50: '#eff6ff', 100: '#dbeafe', 200: '#bfdbfe', 300: '#93c5fd', 400: '#60a5fa', 500: '#2563eb', 600: '#1d4ed8', 700: '#1e40af', 800: '#1e3a8a', 900: '#172554' },
      accent: { 50: '#fffbeb', 100: '#fef3c7', 200: '#fde68a', 300: '#fcd34d', 400: '#fbbf24', 500: '#f59e0b', 600: '#d97706' }
    },
    fonts: { heading: ['Inter', 'system-ui', 'sans-serif'], body: ['Inter', 'system-ui', 'sans-serif'], googleFontsUrl: 'https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap' }
  },
  'forest-green': {
    label: 'Forest Green — green primary, yellow accent',
    colors: {
      primary: { 50: '#f0fdf4', 100: '#dcfce7', 200: '#bbf7d0', 300: '#86efac', 400: '#4ade80', 500: '#16a34a', 600: '#15803d', 700: '#166534', 800: '#14532d', 900: '#052e16' },
      accent: { 50: '#fefce8', 100: '#fef9c3', 200: '#fef08a', 300: '#fde047', 400: '#facc15', 500: '#eab308', 600: '#ca8a04' }
    },
    fonts: { heading: ['Montserrat', 'system-ui', 'sans-serif'], body: ['Open Sans', 'system-ui', 'sans-serif'], googleFontsUrl: 'https://fonts.googleapis.com/css2?family=Montserrat:wght@400;500;600;700;800&family=Open+Sans:wght@400;500;600;700&display=swap' }
  },
  'royal-purple': {
    label: 'Royal Purple — purple primary, teal accent',
    colors: {
      primary: { 50: '#faf5ff', 100: '#f3e8ff', 200: '#e9d5ff', 300: '#d8b4fe', 400: '#c084fc', 500: '#9333ea', 600: '#7e22ce', 700: '#6b21a8', 800: '#581c87', 900: '#3b0764' },
      accent: { 50: '#f0fdfa', 100: '#ccfbf1', 200: '#99f6e4', 300: '#5eead4', 400: '#2dd4bf', 500: '#14b8a6', 600: '#0d9488' }
    },
    fonts: { heading: ['Poppins', 'system-ui', 'sans-serif'], body: ['Poppins', 'system-ui', 'sans-serif'], googleFontsUrl: 'https://fonts.googleapis.com/css2?family=Poppins:wght@400;500;600;700;800&display=swap' }
  },
  'slate-pro': {
    label: 'Slate Pro — slate/charcoal primary, sky blue accent',
    colors: {
      primary: { 50: '#f8fafc', 100: '#f1f5f9', 200: '#e2e8f0', 300: '#cbd5e1', 400: '#94a3b8', 500: '#475569', 600: '#334155', 700: '#1e293b', 800: '#0f172a', 900: '#020617' },
      accent: { 50: '#f0f9ff', 100: '#e0f2fe', 200: '#bae6fd', 300: '#7dd3fc', 400: '#38bdf8', 500: '#0ea5e9', 600: '#0284c7' }
    },
    fonts: { heading: ['Raleway', 'system-ui', 'sans-serif'], body: ['Raleway', 'system-ui', 'sans-serif'], googleFontsUrl: 'https://fonts.googleapis.com/css2?family=Raleway:wght@400;500;600;700;800&display=swap' }
  },
  'sunset-orange': {
    label: 'Sunset Orange — warm orange primary, indigo accent',
    colors: {
      primary: { 50: '#fff7ed', 100: '#ffedd5', 200: '#fed7aa', 300: '#fdba74', 400: '#fb923c', 500: '#ea580c', 600: '#c2410c', 700: '#9a3412', 800: '#7c2d12', 900: '#431407' },
      accent: { 50: '#eef2ff', 100: '#e0e7ff', 200: '#c7d2fe', 300: '#a5b4fc', 400: '#818cf8', 500: '#6366f1', 600: '#4f46e5' }
    },
    fonts: { heading: ['DM Sans', 'system-ui', 'sans-serif'], body: ['DM Sans', 'system-ui', 'sans-serif'], googleFontsUrl: 'https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;600;700;800&display=swap' }
  },
  'rose-gold': {
    label: 'Rose Gold — rose primary, gold accent',
    colors: {
      primary: { 50: '#fff1f2', 100: '#ffe4e6', 200: '#fecdd3', 300: '#fda4af', 400: '#fb7185', 500: '#e11d48', 600: '#be123c', 700: '#9f1239', 800: '#881337', 900: '#4c0519' },
      accent: { 50: '#fffbeb', 100: '#fef3c7', 200: '#fde68a', 300: '#fcd34d', 400: '#fbbf24', 500: '#d97706', 600: '#b45309' }
    },
    fonts: { heading: ['Playfair Display', 'serif'], body: ['Lato', 'system-ui', 'sans-serif'], googleFontsUrl: 'https://fonts.googleapis.com/css2?family=Playfair+Display:wght@400;500;600;700;800&family=Lato:wght@400;500;600;700&display=swap' }
  },
  'midnight': {
    label: 'Midnight — dark navy primary, cyan accent',
    colors: {
      primary: { 50: '#f0f4ff', 100: '#dbe4ff', 200: '#bac8ff', 300: '#91a7ff', 400: '#748ffc', 500: '#4263eb', 600: '#3b5bdb', 700: '#364fc7', 800: '#2b3ea0', 900: '#1b2a6b' },
      accent: { 50: '#ecfeff', 100: '#cffafe', 200: '#a5f3fc', 300: '#67e8f9', 400: '#22d3ee', 500: '#06b6d4', 600: '#0891b2' }
    },
    fonts: { heading: ['Space Grotesk', 'system-ui', 'sans-serif'], body: ['Space Grotesk', 'system-ui', 'sans-serif'], googleFontsUrl: 'https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@400;500;600;700&display=swap' }
  },
  'earth-tone': {
    label: 'Earth Tone — warm brown primary, sage green accent',
    colors: {
      primary: { 50: '#fdf8f1', 100: '#f5e6d3', 200: '#e8cba5', 300: '#d4a574', 400: '#c08552', 500: '#92643a', 600: '#7a5230', 700: '#634126', 800: '#4d321d', 900: '#352213' },
      accent: { 50: '#f1f8f4', 100: '#dceee3', 200: '#b9dcc7', 300: '#8fc5a5', 400: '#6aad84', 500: '#4a9167', 600: '#3a7553' }
    },
    fonts: { heading: ['Merriweather', 'serif'], body: ['Source Sans 3', 'system-ui', 'sans-serif'], googleFontsUrl: 'https://fonts.googleapis.com/css2?family=Merriweather:wght@400;700;900&family=Source+Sans+3:wght@400;500;600;700&display=swap' }
  },
  'electric': {
    label: 'Electric — vibrant pink primary, lime accent',
    colors: {
      primary: { 50: '#fdf2f8', 100: '#fce7f3', 200: '#fbcfe8', 300: '#f9a8d4', 400: '#f472b6', 500: '#ec4899', 600: '#db2777', 700: '#be185d', 800: '#9d174d', 900: '#831843' },
      accent: { 50: '#f7fee7', 100: '#ecfccb', 200: '#d9f99d', 300: '#bef264', 400: '#a3e635', 500: '#84cc16', 600: '#65a30d' }
    },
    fonts: { heading: ['Outfit', 'system-ui', 'sans-serif'], body: ['Outfit', 'system-ui', 'sans-serif'], googleFontsUrl: 'https://fonts.googleapis.com/css2?family=Outfit:wght@400;500;600;700;800&display=swap' }
  },
  'golden-yellow': {
    label: 'Golden Yellow — warm yellow/gold primary, charcoal accent',
    colors: {
      primary: { 50: '#fefce8', 100: '#fef9c3', 200: '#fef08a', 300: '#fde047', 400: '#facc15', 500: '#eab308', 600: '#ca8a04', 700: '#a16207', 800: '#854d0e', 900: '#713f12' },
      accent: { 50: '#f8fafc', 100: '#f1f5f9', 200: '#e2e8f0', 300: '#cbd5e1', 400: '#94a3b8', 500: '#475569', 600: '#334155' }
    },
    fonts: { heading: ['Playfair Display', 'serif'], body: ['Source Sans 3', 'system-ui', 'sans-serif'], googleFontsUrl: 'https://fonts.googleapis.com/css2?family=Playfair+Display:wght@400;500;600;700;800&family=Source+Sans+3:wght@400;500;600;700&display=swap' }
  }
};

// ─── Auto Theme Selection ─────────────────────────────────────────────────────

const themeKeywords = {
  'bold-red':       ['security', 'fire', 'emergency', 'alarm', 'protection', 'martial arts', 'boxing'],
  'ocean-blue':     ['tech', 'software', 'consulting', 'insurance', 'finance', 'accounting', 'plumbing', 'pool', 'marine'],
  'forest-green':   ['landscaping', 'garden', 'organic', 'farm', 'eco', 'environment', 'natural', 'hemp', 'cannabis'],
  'royal-purple':   ['salon', 'spa', 'beauty', 'creative', 'agency', 'design', 'art', 'dance', 'yoga'],
  'slate-pro':      ['law', 'legal', 'corporate', 'real estate', 'realty', 'architect', 'engineering'],
  'sunset-orange':  ['restaurant', 'food', 'catering', 'pizza', 'fitness', 'gym', 'sports', 'moving'],
  'rose-gold':      ['dental', 'wedding', 'florist', 'boutique', 'fashion', 'jewelry', 'cosmetic'],
  'midnight':       ['nightlife', 'music', 'gaming', 'cyber', 'auto', 'detailing', 'barber'],
  'earth-tone':     ['bakery', 'cafe', 'coffee', 'woodwork', 'furniture', 'pottery', 'craft', 'vintage'],
  'electric':       ['photography', 'video', 'media', 'marketing', 'social', 'event', 'party', 'entertainment'],
  'golden-yellow':  ['construction', 'roofing', 'electrical', 'solar', 'handyman', 'contractor', 'renovation'],
};

function pickThemeForIndustry(industry) {
  const lower = industry.toLowerCase();
  for (const [theme, keywords] of Object.entries(themeKeywords)) {
    if (keywords.some(kw => lower.includes(kw))) return theme;
  }
  const themeNames = Object.keys(themes);
  return themeNames[Math.floor(Math.random() * themeNames.length)];
}

const availableIcons = [
  'shield-check', 'bell', 'camera', 'lock', 'fingerprint', 'thermometer',
  'speaker', 'tv', 'wifi', 'leaf', 'tree', 'sun', 'droplet', 'scissors',
  'shovel', 'snowflake', 'lightbulb'
];

// ─── Read stdin ───────────────────────────────────────────────────────────────

async function readStdin() {
  return new Promise((resolve, reject) => {
    let data = '';
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', chunk => { data += chunk; });
    process.stdin.on('end', () => {
      try {
        resolve(JSON.parse(data));
      } catch (e) {
        reject(new Error('Invalid JSON on stdin: ' + e.message));
      }
    });
    process.stdin.on('error', reject);
  });
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  let input;
  try {
    input = await readStdin();
  } catch (e) {
    fatal('Failed to read input: ' + e.message);
  }

  const {
    siteId,
    companyName,
    industry,
    location,
    address,
    phone,
    email,
    services = [],
    keywords = {},
    usp,
    targetCustomers,
    brandDescription,
    language = 'en',
    template = 'ai',
    refSite,
    refPrefs = [],
    refAnalysis = null,
    reviews = [],
    onlinePresence = {},
    hours,
    priceRange,
    uploadedImages = [],
    logoUrl = '',
  } = input;

  // Override AI model/tokens from Admin Settings (passed through by Manager)
  if (input.model) { model = input.model; pricing = getModelPricing(model); }
  if (input.maxTokens) maxTokens = parseInt(input.maxTokens, 10) || maxTokens;

  if (!siteId) fatal('siteId is required');
  if (!companyName) fatal('companyName is required');
  if (!industry) fatal('industry is required');

  // TICKET-118 regression guard: if refPrefs were sent but refAnalysis is empty
  // shape, the dashboard/manager API contract is likely broken again.
  if (refPrefs.length > 0 && refAnalysis) {
    const checks = ['primaryColor', 'sections', 'navLinks'];
    const missing = checks.filter(k => {
      const v = refAnalysis[k];
      return v === undefined || v === null || v === '' || (Array.isArray(v) && v.length === 0);
    });
    if (missing.length === checks.length) {
      debug(`⚠️ refAnalysis received but all key fields missing (${missing.join(', ')}). Likely a shape mismatch — check dashboard/manager API contract.`);
    }
  }

  const rootDir = path.resolve(__dirname, '..');
  const siteDir = path.join(rootDir, 'site');

  // Clean up existing site dir if present (container re-runs)
  if (fs.existsSync(siteDir)) {
    fs.rmSync(siteDir, { recursive: true });
  }
  fs.mkdirSync(path.join(siteDir, 'pages'), { recursive: true });

  // ── Skip AI mode: use demo config ──
  if (input.skipAI) {
    progress('Setting up demo site (no AI)...', 10);
    const content = getDemoConfig(siteId);
    writeSiteConfig(siteDir, content);
    debug(`Demo site config written to site/`);
    if (input.repoUrl) {
      progress('Committing to git...', 80);
      try {
        const gitOpts = { cwd: rootDir, stdio: 'pipe' };
        execSync('git add site/', gitOpts);
        execSync(`git commit -m "Generate site: ${siteId} (demo)"`, gitOpts);
        const repoPageUrl = input.repoUrl.replace(/\.git$/, '');
        emit('repo', { url: repoPageUrl });
      } catch (e) {
        debug('Git commit failed:', e.stderr?.toString() || e.message);
        fatal('Git commit failed: ' + (e.stderr?.toString()?.split('\n')[0] || e.message));
      }
    }
    progress('Demo site generated, starting preview...', 85);
    return;
  }

  if (!process.env.ANTHROPIC_API_KEY) {
    fatal('ANTHROPIC_API_KEY environment variable is required');
  }

  progress('Setting up project...', 5);

  // Pick theme
  const themeName = (template && template !== 'ai' && themes[template]) ? template : pickThemeForIndustry(industry);
  const theme = themes[themeName];
  debug(`Theme: ${themeName} — ${theme.label}`);

  progress('AI is designing your website...', 15);

  // Language map
  const langMap = {
    'en': 'English', 'zh': 'Chinese', 'fr': 'French', 'es': 'Spanish',
    'ja': 'Japanese', 'ko': 'Korean', 'de': 'German', 'it': 'Italian',
    'pt': 'Portuguese', 'ru': 'Russian', 'vi': 'Vietnamese', 'ar': 'Arabic',
    'hi': 'Hindi', 'th': 'Thai',
  };
  const languageName = langMap[language] || 'English';

  // ── Call 1: Generate base site (brand + seo + services + regular pages) ──
  const content = await generateContent({
    companyName, industry, location, address, phone, email,
    services, usp, targetCustomers, brandDescription,
    theme, languageName, refSite, refPrefs, refAnalysis,
    reviews, onlinePresence, hours, priceRange, uploadedImages, logoUrl,
  });

  // TICKET-119: Layout hard-copy compliance check
  if (refPrefs.includes('layout') && refAnalysis && refAnalysis.sections && Array.isArray(content?.pages)) {
    const expected = parseRefSections(refAnalysis.sections);
    const homePage = content.pages.find(p => p.slug === 'home');
    if (homePage && Array.isArray(homePage.sections) && expected.length > 0) {
      const actual = homePage.sections.map(s => s.type);
      const lenMismatch = actual.length !== expected.length;
      const typeMismatch = expected.filter((t, i) => actual[i] !== t).length;
      if (lenMismatch || typeMismatch > 0) {
        debug(`⚠️ [layout hard-copy] Claude deviated from mapped reference layout. Expected ${expected.length} sections [${expected.join(', ')}], got ${actual.length} [${actual.join(', ')}]. Mismatched: ${typeMismatch}.`);
      } else {
        debug(`[layout hard-copy] ✓ Claude followed reference layout exactly (${expected.length} sections).`);
      }
    }
  }

  // TICKET-120: Structure hard-copy compliance check
  if (refPrefs.includes('structure') && refAnalysis && Array.isArray(refAnalysis.navLinks) && refAnalysis.navLinks.length > 0 && Array.isArray(content?.pages)) {
    const expected = parseRefNavLinks(refAnalysis.navLinks);
    if (expected.length > 0) {
      // Header nav excludes home (auto-rendered) and service detail pages
      // (independent SEO landing route, slug "services/{id}", navOrder 10-19).
      const actualNavSlugs = content.pages
        .filter(p => p.slug !== 'home' && !p.serviceDetailPage && p.navLabel)
        .sort((a, b) => (a.navOrder ?? 99) - (b.navOrder ?? 99))
        .map(p => p.slug);
      const lenMismatch = actualNavSlugs.length !== expected.length;
      const slugMismatch = expected.filter((s, i) => actualNavSlugs[i] !== s).length;
      if (lenMismatch || slugMismatch > 0) {
        debug(`⚠️ [structure hard-copy] Claude deviated from mapped reference nav. Expected ${expected.length} archetypes [${expected.join(', ')}], got ${actualNavSlugs.length} [${actualNavSlugs.join(', ')}]. Mismatched: ${slugMismatch}.`);
      } else {
        debug(`[structure hard-copy] ✓ Claude followed reference nav exactly (${expected.length} archetypes).`);
      }
    }
  }

  progress('Writing base configuration files...', 50);

  // ── Call 2: Generate keyword pages (if any keywords selected) ──
  // Build keywordPages list from input
  const servicesWithKeywords = [];
  for (const [serviceName, kwList] of Object.entries(keywords)) {
    const selected = Array.isArray(kwList) ? kwList.filter(k => k.selected && !k.isPrimary) : [];
    if (selected.length > 0) {
      servicesWithKeywords.push({ service: serviceName, keywords: selected });
    }
  }
  const keywordPagesList = [];
  for (const s of servicesWithKeywords) {
    const serviceSlug = s.service.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
    for (const kw of s.keywords) {
      const keywordSlug = kw.keyword.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
      keywordPagesList.push({
        service: s.service,
        serviceSlug,
        keyword: kw.keyword,
        keywordSlug,
        nestedSlug: `${serviceSlug}/${keywordSlug}`,
        volume: kw.volume,
      });
    }
  }

  if (keywordPagesList.length > 0) {
    progress('AI is writing keyword pages...', 55);

    // Build service detail page map for keyword page breadcrumbs
    const serviceDetailMap = {};
    for (const p of content.pages.filter(p => p.serviceDetailPage)) {
      serviceDetailMap[p.parentService] = p.slug;
    }

    const kwPages = await generateKeywordPages({
      keywordPages: keywordPagesList,
      brand: content.brand,
      seo: content.seo,
      companyName,
      industry,
      location,
      languageName,
      serviceDetailMap,
    });

    // Add keyword pages to content.pages
    content.pages.push(...kwPages);

    // Add keyword pages to footer navigation — one column per service
    for (const s of servicesWithKeywords) {
      const serviceSlug = s.service.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
      const serviceKwPages = kwPages.filter(p => p.slug.startsWith(serviceSlug + '/'));
      if (serviceKwPages.length > 0) {
        content.navigation.footer.columns.push({
          title: s.service,
          links: serviceKwPages.slice(0, 6).map(p => ({ label: p.title, href: `/${p.slug}` })),
        });
      }
    }
  }

  progress('Writing configuration files...', 70);
  writeSiteConfig(siteDir, content);

  // ─── Git Commit (push is handled async by entrypoint.sh after dev server starts) ─
  const { repoUrl } = input;
  if (repoUrl) {
    progress('Committing to git...', 80);
    try {
      const gitOpts = { cwd: rootDir, stdio: 'pipe' };
      execSync('git add site/', gitOpts);
      execSync(`git commit -m "Generate site: ${siteId}"`, gitOpts);
      const repoPageUrl = repoUrl.replace(/\.git$/, '');
      emit('repo', { url: repoPageUrl });
      debug('Committed site config, push deferred to entrypoint.sh');
    } catch (e) {
      debug('Git commit failed:', e.stderr?.toString() || e.message);
      fatal('Git commit failed: ' + (e.stderr?.toString()?.split('\n')[0] || e.message));
    }
  }

  // Done — entrypoint.sh handles sync-config + dev server startup
  progress('Site generated, starting preview...', 85);
}

// ─── Write Site Config Files ─────────────────────────────────────────────────

function writeSiteConfig(siteDir, content) {
  const configFiles = {
    'brand.json': content.brand,
    'navigation.json': content.navigation,
    'seo.json': content.seo,
    'services.json': content.services,
  };

  for (const [filename, data] of Object.entries(configFiles)) {
    fs.writeFileSync(
      path.join(siteDir, filename),
      JSON.stringify(data, null, 2) + '\n'
    );
  }

  for (const page of content.pages) {
    const pagePath = path.join(siteDir, 'pages', `${page.slug}.json`);
    fs.mkdirSync(path.dirname(pagePath), { recursive: true });
    fs.writeFileSync(pagePath, JSON.stringify(page, null, 2) + '\n');
  }

  debug(`Site config written to site/`);
  debug(`Pages: ${content.pages.map(p => p.slug).join(', ')}`);
}

// ─── Demo Config (No AI) ────────────────────────────────────────────────────

function getDemoConfig(siteId) {
  return {
    brand: {
      name: 'Demo Company',
      tagline: 'Your trusted local business',
      logoIcon: 'shield-check',
      logoUrl: '',
      colors: {
        primary: { 50: '#eff6ff', 100: '#dbeafe', 200: '#bfdbfe', 300: '#93c5fd', 400: '#60a5fa', 500: '#3b82f6', 600: '#2563eb', 700: '#1d4ed8', 800: '#1e40af', 900: '#1e3a8a' },
        accent: { 50: '#fefce8', 100: '#fef9c3', 200: '#fef08a', 300: '#fde047', 400: '#facc15', 500: '#eab308', 600: '#ca8a04' },
      },
      fonts: {
        heading: ['Inter', 'sans-serif'],
        body: ['Inter', 'sans-serif'],
        googleFontsUrl: 'https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap',
      },
      email: 'hello@demo.com',
      locations: [{ label: 'Main Office', address: '123 Demo Street, Toronto, ON', phone: '416-555-0000' }],
      socialLinks: {},
      googleFormUrl: '',
      googleFormEntries: { source: '', services: '', propertyType: '', urgency: '' },
    },
    navigation: {
      header: {
        links: [
          { label: 'Home', href: '/' },
          { label: 'About', href: '/about' },
          { label: 'Services', href: '/services' },
        ],
        cta: { label: 'Get a Quote', href: '/quote' },
      },
      footer: {
        description: 'Demo Company — Your trusted local business.',
        columns: [
          { title: 'Quick Links', links: [{ label: 'Home', href: '/' }, { label: 'About', href: '/about' }, { label: 'Services', href: '/services' }] },
        ],
        copyright: `© ${new Date().getFullYear()} Demo Company. All rights reserved.`,
      },
    },
    seo: {
      domain: `https://${siteId}.xeoai.io`,
      locale: 'en_CA',
      siteTitle: 'Demo Company — Professional Services',
      siteDescription: 'Demo Company provides professional services in the Greater Toronto Area.',
      keywords: 'demo, services, toronto',
      verification: {},
      schema: { areaServed: [{ type: 'City', name: 'Toronto, ON' }], addresses: [{ locality: 'Toronto', region: 'ON', country: 'CA' }], openingHours: { days: ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'], opens: '09:00', closes: '17:00' }, priceRange: '$$', offerCatalogName: 'Demo Services' },
    },
    services: [
      { id: 'demo-service', name: 'Demo Service', shortDescription: 'Our core service offering.', fullDescription: 'We provide professional demo services to businesses of all sizes.', icon: 'lightbulb', features: ['Fast turnaround', 'Quality results', 'Affordable pricing'], products: [] },
    ],
    pages: [
      {
        slug: 'home', title: 'Home', description: 'Welcome to Demo Company', navLabel: 'Home', navOrder: 0, changeFrequency: 'weekly', priority: 1,
        sections: [
          { type: 'hero', data: { variant: 'centered', headline: 'Welcome to Demo Company', subheadline: 'Your trusted local business partner', ctaPrimary: { label: 'Get Started', href: '/quote' }, ctaSecondary: { label: 'Learn More', href: '/about' } } },
          { type: 'features-grid', data: { headline: 'Why Choose Us', subheadline: 'What sets us apart from the rest' } },
          { type: 'cta-banner', data: { headline: 'Ready to get started?', description: 'Contact us today for a free consultation.', button: { label: 'Contact Us', href: '/quote' } } },
        ],
      },
      {
        slug: 'about', title: 'About Us', description: 'Learn about Demo Company', navLabel: 'About', navOrder: 1, changeFrequency: 'monthly', priority: 0.8,
        sections: [
          { type: 'page-header', data: { title: 'About Us', subtitle: 'Learn more about our company and mission' } },
          { type: 'text-block', data: { content: '<h2>Our Story</h2><p>Demo Company was founded with a simple mission: to provide exceptional service to our community. We have been serving the Greater Toronto Area for years, building lasting relationships with our clients.</p><h2>Our Mission</h2><p>We are committed to delivering quality results with integrity and professionalism.</p>' } },
        ],
      },
      {
        slug: 'services', title: 'Our Services', description: 'Professional services by Demo Company', navLabel: 'Services', navOrder: 2, changeFrequency: 'monthly', priority: 0.8,
        sections: [
          { type: 'page-header', data: { title: 'Our Services', subtitle: 'Discover what we can do for you' } },
          { type: 'services-list', data: {} },
        ],
      },
      {
        slug: 'quote', title: 'Get a Quote', description: 'Request a free quote from Demo Company', navLabel: 'Get a Quote', navOrder: 3, changeFrequency: 'monthly', priority: 0.7,
        sections: [
          { type: 'page-header', data: { title: 'Get a Free Quote', subtitle: 'Fill out the form below and we will get back to you within 24 hours' } },
          { type: 'quote-form', data: { formIntro: 'Tell us about your project and we will get back to you within 24 hours.', propertyTypes: ['Residential', 'Commercial', 'Other'], urgencyOptions: ['Not urgent', 'Within a week', 'ASAP'], benefits: ['Free consultation', 'No obligation', 'Fast response'], redirectMessage: 'Thank you! We will be in touch soon.', buttonText: 'Submit Request' } },
        ],
      },
    ],
  };
}

// ─── Reference Site Fetching ─────────────────────────────────────────────────

async function fetchRefSite(url) {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10000);
    const res = await fetch(url, {
      signal: controller.signal,
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; XSiteBot/1.0)' },
    });
    clearTimeout(timeout);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    let html = await res.text();
    if (html.length > 1_000_000) html = html.slice(0, 1_000_000);

    // Strip <script> and <noscript>, keep <style> for color/font info
    html = html.replace(/<script[\s\S]*?<\/script>/gi, '');
    html = html.replace(/<noscript[\s\S]*?<\/noscript>/gi, '');

    // Extract external CSS URLs
    const cssUrls = [];
    const linkRe = /<link[^>]+rel=["']stylesheet["'][^>]+href=["']([^"']+)["']/gi;
    let match;
    while ((match = linkRe.exec(html)) !== null) {
      try { cssUrls.push(new URL(match[1], url).href); } catch {}
    }

    // Fetch all CSS files in parallel, keep largest 3 (most likely to contain brand styles)
    const cssResults = await Promise.all(
      cssUrls.slice(0, 8).map(async (cssUrl) => {
        try {
          const cssRes = await fetch(cssUrl, {
            signal: AbortSignal.timeout(5000),
            headers: { 'User-Agent': 'Mozilla/5.0 (compatible; XSiteBot/1.0)' },
          });
          if (cssRes.ok) return await cssRes.text();
        } catch {}
        return '';
      })
    );
    const cssContent = cssResults
      .filter(Boolean)
      .sort((a, b) => b.length - a.length)  // largest first
      .slice(0, 3)
      .map(css => css.slice(0, 5000))
      .join('\n');

    // Combine and truncate to 15K chars
    const combined = html + '\n/* === EXTERNAL CSS === */\n' + cssContent;
    return combined.slice(0, 15000);
  } catch (err) {
    console.error(`Failed to fetch reference site ${url}: ${err.message}`);
    return null;
  }
}

// ─── AI Content Generation ───────────────────────────────────────────────────

async function generateContent(opts) {
  const {
    companyName, industry, location, address, phone, email,
    services, usp, targetCustomers, brandDescription,
    theme, languageName, refSite, refPrefs = [], refAnalysis = null,
    reviews = [], onlinePresence = {}, hours, priceRange, uploadedImages = [],
    logoUrl = '',
  } = opts;

  const client = new Anthropic();

  const localeMap = {
    'English': 'en_CA', 'French': 'fr_CA', 'Chinese': 'zh_CN', 'Mandarin': 'zh_CN',
    'Cantonese': 'zh_HK', 'Spanish': 'es_MX', 'Portuguese': 'pt_BR', 'Japanese': 'ja_JP',
    'Korean': 'ko_KR', 'Hindi': 'hi_IN', 'Arabic': 'ar_SA', 'German': 'de_DE',
    'Italian': 'it_IT', 'Russian': 'ru_RU', 'Vietnamese': 'vi_VN', 'Tagalog': 'tl_PH',
    'Thai': 'th_TH', 'Punjabi': 'pa_IN', 'Urdu': 'ur_PK', 'Tamil': 'ta_IN',
  };

  const languageInstruction = languageName !== 'English'
    ? `\nLANGUAGE: Write ALL content in ${languageName}. This includes: taglines, descriptions, headlines, subheadlines, testimonial quotes, FAQ answers, service names, navigation labels, page titles, meta descriptions, keywords, and all other user-facing text. Only JSON keys and technical values (slugs, hrefs, icon names, variant names, section type names) should remain in English.\n`
    : '';

  // Build services instruction from real form data
  const servicesList = services.length > 0 ? services : ['General Services'];
  const servicesInstruction = `SERVICES (use EXACTLY these — do NOT invent new ones):
${servicesList.map((s, i) => `${i + 1}. ${s}`).join('\n')}`;

  // Build contact info instruction
  const contactParts = [];
  if (phone) contactParts.push(`Phone: ${phone}`);
  if (email) contactParts.push(`Email: ${email}`);
  if (address) contactParts.push(`Address: ${address}`);
  const contactInstruction = contactParts.length > 0
    ? `\nCONTACT INFORMATION (use these EXACT details):\n${contactParts.join('\n')}`
    : '';

  // Build USP/description instruction
  let businessContext = '';
  if (usp) businessContext += `\nUNIQUE SELLING POINTS: ${usp}`;
  if (targetCustomers) businessContext += `\nTARGET CUSTOMERS: ${targetCustomers}`;
  if (brandDescription) businessContext += `\nBRAND DESCRIPTION: ${brandDescription}`;
  if (hours) businessContext += `\nHOURS OF OPERATION: ${hours}`;
  if (priceRange) businessContext += `\nPRICE RANGE: ${priceRange}`;

  // Build real reviews instruction (from online presence scraping)
  // Filter out negative reviews (below 4 stars) — only show positive ones on the website
  let reviewsInstruction = '';
  const positiveReviews = reviews.filter(r => (r.rating || 5) >= 4);
  if (positiveReviews.length > 0) {
    const reviewLines = positiveReviews.map(r =>
      `- ${r.author || 'Anonymous'} (${r.platform || 'unknown'}, ${r.rating || 5}★): "${r.text}"`
    ).join('\n');

    // Build platform ratings summary if available
    let ratingSummary = '';
    const pr = onlinePresence.platformRatings;
    if (pr) {
      const parts = Object.entries(pr)
        .filter(([, info]) => info && info.rating)
        .map(([name, info]) => `${name} ${info.rating} (${info.reviewCount || '?'} reviews)`);
      if (parts.length > 0) ratingSummary = `\nPlatform ratings: ${parts.join(', ')}`;
    }

    reviewsInstruction = `
REAL CUSTOMER REVIEWS — use these as testimonials instead of generating fake ones:
${reviewLines}

For "testimonials" sections: use these real reviews as-is. Keep author names and review meaning intact. You may lightly edit for brevity but preserve authenticity.
For "social-proof" sections: use real platform data —${ratingSummary || ' generate realistic numbers based on the reviews above.'}
Do NOT invent additional fake testimonials. Only use the real reviews provided above.`;
  }

  // Social links instruction
  let socialLinksInstruction = '';
  const sl = onlinePresence.socialLinks;
  if (sl && Object.keys(sl).length > 0) {
    const links = Object.entries(sl).filter(([, url]) => url).map(([name, url]) => `${name}: ${url}`).join(', ');
    if (links) socialLinksInstruction = `\nSOCIAL/LISTING LINKS: ${links}. Include these in footer or contact sections where appropriate.`;
  }

  // Build reference site instruction
  let refSiteInstruction = '';
  if (refSite && refPrefs.length > 0) {
    const refUrl = refSite.startsWith('http') ? refSite : `https://${refSite}`;

    const prefDescriptions = {
      'tone': 'Writing style & tone — Match the voice, formality level, and copywriting approach',
      'structure': 'Website structure — Match the main navigation menu and page structure',
      'layout': 'Layout & sections — Use similar section types, ordering, and visual arrangement',
      'colors-fonts': 'Colors & fonts — Match the color palette and typography from the reference site',
    };
    const selectedPrefs = refPrefs.map(p => prefDescriptions[p] || p).filter(Boolean);

    // Build design analysis instruction from Gemini Vision (screenshot analysis)
    let designInstruction = '';
    if (refAnalysis) {
      const parts = [];
      if (refAnalysis.primaryColor) parts.push(`Primary brand color: ${refAnalysis.primaryColor}`);
      if (refAnalysis.accentColor) parts.push(`Accent color: ${refAnalysis.accentColor}`);
      if (refAnalysis.headingFont) parts.push(`Heading font: ${refAnalysis.headingFont}`);
      if (refAnalysis.bodyFont) parts.push(`Body font: ${refAnalysis.bodyFont}`);
      if (refAnalysis.vibe) parts.push(`Design vibe: ${refAnalysis.vibe}`);
      if (refAnalysis.sections) parts.push(`Page sections (top to bottom): ${refAnalysis.sections}`);
      if (refAnalysis.navLinks && refAnalysis.navLinks.length > 0) parts.push(`Header navigation: ${refAnalysis.navLinks.join(', ')}`);
      if (refAnalysis.footerLinks && refAnalysis.footerLinks.length > 0) parts.push(`Footer navigation: ${refAnalysis.footerLinks.join(', ')}`);

      if (parts.length > 0) {
        designInstruction = `
REFERENCE SITE DESIGN (analyzed from screenshot of ${refSite}):
${parts.join('\n')}
`;
        if (refPrefs.includes('colors-fonts') && refAnalysis.primaryColor) {
          designInstruction += `
IMPORTANT — COLOR MATCHING:
Use ${refAnalysis.primaryColor} as the basis for the primary color palette (50-900).
${refAnalysis.accentColor ? `Use ${refAnalysis.accentColor} as the basis for the accent color palette (50-600).` : ''}
Do NOT ignore these colors. The generated site MUST use a color scheme matching this reference.`;
        }
        if (refPrefs.includes('layout') && refAnalysis.sections) {
          // TICKET-119: hard-copy layout via mapped reference sections
          const mappedSections = parseRefSections(refAnalysis.sections);
          if (mappedSections.length > 0) {
            designInstruction += `
REFERENCE SITE LAYOUT (HARD COPY — MUST FOLLOW EXACTLY):
The HOME page sections array MUST be EXACTLY these ${mappedSections.length} types in EXACTLY this order:
${mappedSections.map((t, i) => `${i + 1}. ${t}`).join('\n')}

Generate appropriate "data" payload for each section based on the ${companyName}'s ${industry} business. Do NOT add sections. Do NOT remove sections. Do NOT reorder.

This OVERRIDES the general "Choose 7-10 sections" rule for the home page when reference layout is provided.

Reference site original observation: ${refAnalysis.sections}
`;
            debug(`[layout hard-copy] Reference layout mapped to ${mappedSections.length} types: ${mappedSections.join(', ')}`);
          }
        }
        if (refPrefs.includes('structure') && refAnalysis.navLinks && refAnalysis.navLinks.length > 0) {
          // TICKET-120: hard-copy header navigation via mapped page archetypes
          const mappedNav = parseRefNavLinks(refAnalysis.navLinks);
          if (mappedNav.length > 0) {
            designInstruction += `
REFERENCE SITE NAVIGATION (HARD COPY — MUST FOLLOW EXACTLY):
The header navigation MUST have EXACTLY these ${mappedNav.length} page archetypes in this exact order (excluding home which auto-renders):
${mappedNav.map((slug, i) => `${i + 1}. slug "${slug}"`).join('\n')}

For each archetype, generate one entry in the "pages" array with:
- slug = exactly the archetype name (e.g., "pricing", "gallery", "quote")
- navLabel = a friendly label appropriate for the ${industry} industry (e.g., "Pricing" or "Our Prices" or "Rates" — choose one that fits)
- navOrder = position in the list (1, 2, 3, ... matching the order above)
- title / description / sections = appropriate for this page archetype

Do NOT add nav pages outside this list. Do NOT skip any. Do NOT reorder.

IMPORTANT — service detail pages (slug "services/{id}", serviceDetailPage: true, navOrder 10-19) are SEPARATE from header nav and continue to be generated normally — they don't count as nav archetypes in this list.

Reference original nav labels: ${refAnalysis.navLinks.join(', ')}
`;
            debug(`[structure hard-copy] Reference nav mapped to ${mappedNav.length} archetypes: ${mappedNav.join(', ')}`);
          }
        }
        const designSummary = [refAnalysis.primaryColor, refAnalysis.accentColor, refAnalysis.headingFont].filter(Boolean).join(', ') || 'analyzed';
        progress(`Reference design: ${designSummary}`, 9);
      }
    }

    // Fetch HTML only for tone (structure and layout use screenshot instead)
    const needsHtml = refPrefs.some(p => ['tone'].includes(p));
    let refHtml = null;
    if (needsHtml) {
      progress(`Fetching reference site: ${refSite}...`, 8);
      refHtml = await fetchRefSite(refUrl);
    }

    if (refHtml) {
      refSiteInstruction = `
REFERENCE WEBSITE ANALYSIS:
Below is the actual HTML/CSS from ${refSite}. Analyze it and draw inspiration for the following aspects ONLY:
${selectedPrefs.map(p => `- ${p}`).join('\n')}

Do NOT copy content — only use it as stylistic/structural inspiration for the aspects listed above.
For any aspects NOT listed, use your own best judgment for the ${industry} industry.
${designInstruction}

--- BEGIN REFERENCE HTML/CSS ---
${refHtml}
--- END REFERENCE HTML/CSS ---
`;
      progress(`Reference site fetched (${refHtml.length} chars)`, 9);
    } else {
      refSiteInstruction = `\nREFERENCE WEBSITE: ${refSite}
Draw inspiration from this website for the following aspects ONLY:
${selectedPrefs.map(p => `- ${p}`).join('\n')}
Do NOT copy content — only use it as stylistic/structural inspiration for the aspects listed above.
For any aspects NOT listed, use your own best judgment for the ${industry} industry.
${designInstruction}\n`;
    }
  }

  // Page selection — always include home + services. AI picks the rest.
  // TICKET-120: when structure hard-copy is active, the REFERENCE SITE NAVIGATION
  // block above is the source of truth for nav pages — suppress the generic
  // "always include services" and "choose 2-4 more archetypes" mandates that
  // would otherwise pull Claude away from the hard-copied list.
  const structureHardCopy = refPrefs.includes('structure') && refAnalysis && Array.isArray(refAnalysis.navLinks) && parseRefNavLinks(refAnalysis.navLinks).length > 0;
  const pagesInstruction = `${structureHardCopy
    ? `DYNAMIC PAGE SELECTION: Always include "home". The header nav pages are SPECIFIED by the REFERENCE SITE NAVIGATION (HARD COPY) block above — generate ONLY those archetypes as regular nav pages. Do NOT add any other regular pages. Do NOT add a "services" page unless it appears in the hard-copy archetypes list above.`
    : `DYNAMIC PAGE SELECTION: Always include "home". Because this business has ${servicesList.length} services, always include a "services" page.
Additionally, choose 2-4 more pages from these archetypes that make sense for a ${industry} business:
- "about" — Company story, team, values
- "quote" — Quote/contact request form
- "menu" — Menu or product catalog (restaurants, bakeries, cafes)
- "gallery" — Portfolio or project showcase (creative, construction)
- "pricing" — Pricing tiers/packages (SaaS, consulting, memberships)
- "faq" — Frequently asked questions (complex services, insurance, legal)
- "team" — Team members showcase (agencies, clinics, law firms)
- "areas" — Service area coverage (home services, delivery, contractors)
- "testimonials" — Customer reviews page
- "process" — How it works / our process
- "case-studies" — Project showcases with details`}

SERVICE DETAIL PAGES:
${servicesList.length >= 3 ? `Generate an individual service detail page for EACH service (${servicesList.length} pages total).
- Slug format: "services/{service-id}" — use the EXACT service id from the services array
- Set serviceDetailPage: true and parentService: "{service-id}" on each
- navOrder: 10-19, priority: 0.8, changeFrequency: "monthly"
- Each page needs 5-7 sections: page-header, content-split, process-steps OR benefits-list, faq-accordion, service-related-pages, cta-banner
- page-header breadcrumbs: [{label:"Home",href:"/"},{label:"Services",href:"/services"},{label:"{Service Name}"}]
- service-related-pages data: { serviceSlug: "{service-id}", headline: "Related {Service} Topics" }
- Vary layouts and section variants across service detail pages — don't repeat the same structure
- Write unique, detailed SEO content for each service` : `Skip service detail pages — only ${servicesList.length} service(s), not enough to warrant individual pages.`}`;

  // Build uploaded images instruction
  let imagesInstruction = '';
  if (uploadedImages.length > 0) {
    const imageList = uploadedImages.map((img, i) => `  ${i + 1}. "${img.originalFilename || img.filename}" → ${img.url}`).join('\n');
    imagesInstruction = `
UPLOADED BUSINESS IMAGES:
The business owner has uploaded the following photos. Use them in sections that support imageUrl.
${imageList}

IMAGE PLACEMENT RULES:
- "hero" (split variant): set imageUrl on the hero data to show the best/most general business photo
- "content-split" (text-left, text-right, text-right-list variants): set imageUrl to show a relevant photo next to the text
- "gallery": set imageUrl on individual items to show the photos in the gallery grid
- Match images to sections by filename context (e.g., "storefront.jpg" → hero, "team.jpg" → about page content-split, "product1.jpg" → gallery item)
- You may reuse the same image URL across multiple sections if it fits
- If there are more sections than images, leave imageUrl unset (gradient placeholder will show)
- Prefer "split" variant for hero when images are available`;
  }

  progress('AI is writing content...', 15);

  const prompt = `You are an expert SEO copywriter AND web layout designer. Generate complete website content AND page layouts for a local service business. Return ONLY valid JSON, no markdown fences, no explanation.

BUSINESS DETAILS:
- Company Name: ${companyName}
- Industry: ${industry}
${location ? `- Primary Location: ${location}` : ''}
${languageInstruction}
${servicesInstruction}
${contactInstruction}
${businessContext}
${reviewsInstruction}
${socialLinksInstruction}
${refSiteInstruction}
${imagesInstruction}
${pagesInstruction}

AVAILABLE ICONS (pick the most relevant for each service):
${availableIcons.join(', ')}

AVAILABLE SECTION TYPES AND THEIR VARIANTS:
You are a layout designer. For each page, you choose WHICH sections to include, in WHAT order, and with WHICH variant. Not every page needs every section. Mix it up based on what makes sense for this industry.

HOMEPAGE SECTIONS (pick 7-10 from these, in any order):
- "hero" — variants: "left" (headline left-aligned), "centered" (centered), "split" (two-column with image/gradient block), "minimal" (white bg, underline accent, single CTA), "video-style" (dark cinematic with play button), "gradient-overlay" (full gradient bg with decorative circles, white text)
  data: { variant, headline, subheadline, ctaPrimary: {label, href}, ctaSecondary: {label, href}, imageUrl?: string }
- "announcement-bar" — variants: "solid" (accent bg), "bordered" (white bg, accent border), "dismissible" (with close button), "floating" (centered pill with shadow)
  data: { message, link?: {label, href}, variant }
- "trusted-brands" — variants: "default" (text logos), "pill" (rounded pill badges), "dark" (dark bg)
  data: { headline, brands: [6 brand name strings], variant }
- "stats-counter" — variants: "bar" (dark full-width), "cards" (white cards), "gradient" (gradient cards), "icon" (with decorative icons), "inline" (compact horizontal strip), "dark" (dark bg with separators)
  data: { headline?, stats: [{value:"500+", label:"Projects Completed"}], variant }
- "features-grid" — variants: "card", "icon-top", "list" (single column rows), "alternating" (alternating emphasis), "bordered" (left border cards), "minimal" (ultra-clean, no cards/borders); columns: 2, 3, or 4
  data: { headline, subheadline, variant, columns }
  NOTE: This section auto-renders services from services.json. Only provide headline/subheadline.
- "values-grid" — style: "numbered", "checkmark", "icon" (decorative SVG icons), "highlight" (first item large), "minimal" (no cards, divider lines)
  data: { headline, items: [{title, description}], style }
- "content-split" — variants: "text-left" (text left, image/gradient right), "text-right" (flipped), "text-left-stats" (text left, stats box right), "text-right-list" (image/gradient left, checklist right), "centered-overlay" (full-width gradient with white card), "cards-row" (headline above, 3 cards below using bullets as titles)
  data: { headline, content, bullets?: [string], stats?: [{value, label}], variant, imageUrl?: string }
- "benefits-list" — variants: "alternating" (zigzag text+gradient), "icon-large" (oversized icons), "numbered-large" (big faded numbers), "cards-horizontal" (horizontal scroll cards)
  data: { headline, subheadline?, items: [{title, description}], variant }
- "process-steps" — variants: "horizontal" (4 cols with connector), "vertical" (timeline), "cards" (standalone cards with watermark numbers), "zigzag" (alternating left-right with center line), "icon-strip" (compact horizontal strip, titles only)
  data: { headline, subheadline?, steps: [{title, description}], variant }
- "testimonials" — variants: "grid" (3-col cards), "featured" (1 large + 3 side), "carousel" (one at a time with dots), "quote-wall" (dark bg grid), "minimal" (stacked, no cards)
  data: { headline, subheadline, variant, items: [{id, name, role, location, quote, rating:5, service}] }
- "social-proof" — variants: "rating-bar" (star bars with distribution), "badges" (trust badges grid), "review-platforms" (platform ratings row), "highlight" (dark bg, big rating + quote)
  data: { headline, overallRating: "4.9", totalReviews: "500+", platforms?: [{name, rating, reviews}], badges?: [string], featuredQuote?: {text, author}, variant }
- "feature-comparison" — variants: "table" (comparison table), "cards" (two side-by-side), "columns" (three-column), "stacked" (vertical badges)
  data: { headline, subheadline?, comparisons: [{feature, us: true, them: false}], usLabel?: string, themLabel?: string, variant }
- "faq-accordion" — variants: "centered" (single column), "two-column" (heading left, FAQ right), "cards" (each FAQ as separate card), "numbered" (zero-padded numbers prefix)
  data: { headline, subheadline?, items: [{question, answer}], variant }
- "pricing-table" — variants: "cards" (standalone cards), "comparison" (side-by-side columns), "minimal" (no cards, text-link CTAs), "toggle" (monthly/annual toggle)
  data: { headline, subheadline?, tiers: [{name, price, description, features:[], highlighted?:bool}], variant }
- "gallery" — variants: "grid" (equal cards), "masonry" (varied heights), "carousel" (horizontal scrollable), "overlay" (image/gradient bg with text overlay)
  data: { headline, subheadline?, items: [{title, description?, category?, imageUrl?: string}], variant }
- "team-grid" — variants: "grid" (large cards with bio), "compact" (small inline cards), "card-with-social" (cards with gradient header + social icons), "centered" (single column centered)
  data: { headline, subheadline?, members: [{name, role, bio?}], variant }
- "logo-carousel" — variants: "scroll" (animated marquee), "grid" (static grid), "bordered" (cards with accent bottom border), "dark" (dark bg)
  data: { headline?, logos: [string], variant }
- "cta-banner" — variants: "solid" (colored bg), "outlined" (bordered card), "gradient" (diagonal gradient), "split" (two-column), "dark" (dark bg with pattern)
  data: { headline, description, button: {label, href}, variant }
- "contact-info" — variants: "cards" (location cards), "inline" (compact list), "map-style" (two-column with map placeholder), "banner" (horizontal compact strip)
  data: { headline, variant }
  NOTE: This section auto-renders locations from brand.json. Only provide headline + variant.
- "divider" — variants: "line" (hr with optional label), "wave" (SVG wave shape), "gradient-bar" (thin gradient strip), "icon" (centered dot with lines)
  data: { label?, variant }
- "timeline" — variants: "vertical" (alternating left-right), "horizontal" (scrollable row), "compact" (stacked list), "milestone" (large cards with faded year)
  data: { headline, subheadline?, events: [{year, title, description}], variant }
- "service-highlights" — variants: "tabs" (tabbed interface), "accordion" (expandable panels), "cards-large" (large cards with gradient strip), "split" (two-column blocks)
  data: { headline, subheadline?, highlights: [{title, description, features?: [string]}], variant }
- "newsletter-signup" — variants: "inline" (accent bg with inline form), "card" (centered card), "split" (two-column), "minimal" (compact single-row strip)
  data: { headline, description?, buttonText?, variant }
- "map-area" — variants: "list" (checkmark grid), "cards" (bordered cards), "grouped" (two-column split), "badge" (inline pills)
  data: { headline, subheadline?, areas: [{name, description?}], variant }
- "checklist" — variants: "two-column" (2-col checkmarks), "cards" (bordered card grid), "numbered-steps" (numbered list), "icon-grid" (square icon tiles)
  data: { headline, subheadline?, items: [string], variant }
- "awards-certifications" — variants: "grid" (cards with star icons), "banner" (compact horizontal strip), "detailed" (large cards with gradient strip + faded year)
  data: { headline, subheadline?, awards: [{title, description?, year?}], variant }
- "blog-preview" — variants: "cards" (3-col post cards), "list" (compact horizontal rows), "featured" (hero post + grid below)
  data: { headline, subheadline?, posts: [{title, excerpt, category?, date?}], variant }
- "service-related-pages" — auto-discovers keyword pages under the given service slug. Use ONLY on service detail pages.
  data: { serviceSlug: "<service-id>", headline: "Related Topics", subheadline?: string }
  NOTE: Returns null if no keyword pages exist — safe to include on all service detail pages.

PAGE-SPECIFIC SECTION RULES:
- "page-header" — always the first section on non-home pages. variants: "default" (gradient left-aligned), "minimal" (white bg, underline), "centered" (gradient centered), "with-description" (two-column)
  data: { title, subtitle?, breadcrumbs: [{label:"Home", href:"/"}, {label:"<Page Name>"}], variant? }
- "text-block" — variants: "default", "two-column" (CSS columns), "highlight-box" (callout with left border), "with-list" (paragraph + checklist), "quote" (blockquote with large decorative marks)
  data: { headline?, content, background?: "gray", centered?: true, variant?, items?: [string], attribution?: string }
- SERVICES pages must include: "page-header", "services-nav", "services-list", "cta-banner"
- QUOTE pages must include: "page-header", "quote-form"
  quote-form data: { formIntro, propertyTypes: [3-4], urgencyOptions: ["ASAP","Within 1 week","Within 1 month","Just exploring"], benefits: [5], redirectMessage: "You will be redirected to our secure form.", buttonText }

Generate a JSON object with this EXACT structure:

{
  "brand": {
    "tagline": "<catchy tagline, max 60 chars>",
    "logoIcon": "<icon from list>",
    "email": "${email || '<realistic email>'}",
    "locations": [{ "label": "<name>", "address": "${address || location || '<City, Province, Country>'}", "phone": "${phone || '<phone>'}" }]
  },
  "navigation": {
    "ctaLabel": "<CTA button text, max 25 chars>",
    "ctaPage": "<slug of the CTA target page, e.g. quote>",
    "footerDescription": "<1 sentence with location + primary keyword>"
  },
  "seo": {
    "domain": "https://<realistic domain>",
    "siteTitle": "<max 60 chars>",
    "siteDescription": "<max 155 chars, location + services + CTA>",
    "keywords": "<12-15 comma-separated keywords>",
    "areaServed": [{"type":"City","name":"<city>"}],
    "addresses": [{"locality":"<city>","region":"<province code>","country":"<country code>"}],
    "openingHours": { "days": ["Monday","Tuesday","Wednesday","Thursday","Friday"], "opens": "09:00", "closes": "17:00" },
    "priceRange": "$$",
    "offerCatalogName": "<catalog name>"
  },
  "services": [
    {
      "id": "<kebab-case>",
      "name": "<EXACT service name from the list above>",
      "shortDescription": "<max 120 chars>",
      "fullDescription": "<2-3 sentences with location>",
      "icon": "<icon>",
      "features": ["<6 specific features>"],
      "products": [{ "name": "<name>", "description": "<1 sentence>" }]
    }
  ],
  "pages": [
    {
      "slug": "home",
      "title": "Home",
      "description": "<same as seo.siteDescription>",
      "navLabel": "Home",
      "navOrder": 0,
      "changeFrequency": "weekly",
      "priority": 1,
      "sections": [ ... ]
    },
    {
      "slug": "<page-slug>",
      "title": "<Page Title, max 60 chars>",
      "description": "<Page meta description, max 155 chars>",
      "navLabel": "<Short nav label>",
      "navOrder": 1,
      "changeFrequency": "weekly|monthly",
      "priority": 0.9,
      "sections": [ ... ]
    },
    {
      "slug": "services/<service-id>",
      "title": "<Service Name> | <Company>",
      "description": "<meta description for this service>",
      "navLabel": "<Service Name>",
      "navOrder": 10,
      "changeFrequency": "monthly",
      "priority": 0.8,
      "serviceDetailPage": true,
      "parentService": "<service-id>",
      "sections": [ ... ]
    }
  ]
}

CRITICAL RULES:
- "services" array must contain EXACTLY the services listed above: ${servicesList.join(', ')}. Do NOT add or remove any.
- "pages" is an ARRAY of page objects, each with slug, title, description, navLabel, navOrder, changeFrequency, priority, and sections.
- navOrder determines the order in the navigation. Home is always 0. Assign sequential numbers (1, 2, 3...) to other pages.
- The CTA page (navigation.ctaPage) should have a higher navOrder so it appears last (but it won't be in the header nav — it becomes the CTA button).
- The HOMEPAGE must feel unique. Choose 7-10 sections. Do NOT use all sections — pick what fits the industry.
- There are 32 section types with 130+ total variants. USE THIS VARIETY. Each site should feel different.
- Vary the section ORDER. A dental site might lead with stats + process-steps. A security site might prioritize features-grid + testimonials.
- Choose DIFFERENT variants for each section — don't use all "grid" or all "cards". Mix "minimal", "split", "gradient", "dark" etc.
- Include at least TWO sections that most sites wouldn't have (e.g., content-split, social-proof, feature-comparison, benefits-list, announcement-bar, divider).
- Use "divider" between sections occasionally (1-2 times per homepage) to break up the page visually.
- Non-home pages should use 3-8 sections. Always start with "page-header". End with "cta-banner" when appropriate.
- Use different page-header and text-block variants across pages — don't reuse the same variant on every page.
- For the SERVICES page cta-banner, choose a variant other than "solid" — try "gradient", "split", or "dark".
- Generate 6-8 services, 6 unique testimonials, 4-6 FAQ items, 3-4 process steps, 2-3 pricing tiers, 5-7 comparison features, 3-5 benefits, and 3-4 social proof badges/platforms if you use those sections.
- For stats, use realistic numbers (e.g., "500+", "15+", "98%", "24/7").
- For gallery items, use project/work descriptions. If uploaded images are available, set imageUrl on items; otherwise the component renders gradient placeholders.
- All meta titles under 60 characters, all meta descriptions under 155 characters.
- Use specific language, not generic fluff. Testimonials should mention the company name.
- Include location names naturally in content.
- CTA hrefs in hero sections and cta-banners should point to "/<ctaPage slug>".
- Service detail pages (slug "services/{id}") must set serviceDetailPage: true and parentService: "{service-id}".
- Service detail pages should NOT appear in the header nav — they go in the footer only.
- Include a "service-related-pages" section on each service detail page with serviceSlug matching the service id.`;

  emit('prompt', { name: 'Base Site', content: prompt });
  progress('AI is generating content and layout...', 25);

  const call1Start = Date.now();
  const stream = await client.messages.stream({
    model,
    max_tokens: maxTokens,
    messages: [{ role: 'user', content: prompt }]
  });

  progress('Waiting for AI response...', 35);

  const response = await stream.finalMessage();
  const call1Duration = ((Date.now() - call1Start) / 1000).toFixed(1);

  // Emit cost for Call 1 (base site)
  const usage1 = response.usage || {};
  const cost1 = ((usage1.input_tokens || 0) * pricing.input + (usage1.output_tokens || 0) * pricing.output) / 1_000_000;
  emit('cost', {
    operation: 'create-site',
    cost: cost1,
    duration: Date.now() - call1Start,
    detail: `Base site (${usage1.input_tokens || 0} in / ${usage1.output_tokens || 0} out)`,
  });
  debug(`Call 1 cost: $${cost1.toFixed(4)} (${usage1.input_tokens} in / ${usage1.output_tokens} out)`);

  if (response.stop_reason === 'max_tokens') {
    fatal('AI response was truncated (hit token limit). Try fewer services.');
  }

  progress('Parsing AI response...', 42);

  const text = response.content[0].text.trim();
  const jsonStr = text.replace(/^```[\w]*\n?/, '').replace(/\n?```$/, '');

  let ai;
  try {
    ai = JSON.parse(jsonStr);
  } catch (e) {
    // Save raw response for debugging
    const debugPath = path.join(__dirname, '..', 'site', '_ai-response.txt');
    try { fs.writeFileSync(debugPath, text); } catch {}
    debug('Raw AI response saved to:', debugPath);
    fatal('Failed to parse AI response as JSON');
  }

  progress('Assembling configuration...', 45);

  // Assemble config files
  const brand = {
    name: companyName,
    tagline: ai.brand.tagline,
    logoIcon: ai.brand.logoIcon,
    logoUrl: logoUrl || '',
    colors: theme.colors,
    fonts: theme.fonts,
    email: ai.brand.email || email || 'info@example.com',
    locations: ai.brand.locations,
    googleFormUrl: "https://docs.google.com/forms/d/e/YOUR_FORM_ID/viewform",
    googleFormEntries: { source: "entry.0000000000", services: "entry.0000000000", propertyType: "entry.0000000000", urgency: "entry.0000000000" }
  };

  // Write socialLinks to brand.json deterministically (not relying on Claude prompt)
  if (onlinePresence && onlinePresence.socialLinks) {
    const sl = onlinePresence.socialLinks;
    const filtered = {};
    for (const [platform, url] of Object.entries(sl)) {
      if (url) filtered[platform] = url;
    }
    if (Object.keys(filtered).length > 0) {
      brand.socialLinks = filtered;
      debug(`Social links written to brand.json: ${Object.keys(filtered).join(', ')}`);
    }
  }

  // Override colors/fonts with reference site analysis when available
  if (refAnalysis && refPrefs.includes('colors-fonts') && refAnalysis.primaryColor) {
    brand.colors = {
      primary: generatePalette(refAnalysis.primaryColor),
      accent: generateAccentPalette(refAnalysis.accentColor || refAnalysis.primaryColor),
    };
    debug(`Colors overridden from reference site: primary=${refAnalysis.primaryColor}, accent=${refAnalysis.accentColor || 'same as primary'}`);
  }
  if (refAnalysis && refPrefs.includes('colors-fonts') && refAnalysis.headingFont) {
    const refFonts = buildFontsFromRef(refAnalysis.headingFont, refAnalysis.bodyFont);
    if (refFonts) {
      brand.fonts = refFonts;
      debug(`Fonts overridden from reference site: heading=${refAnalysis.headingFont}, body=${refAnalysis.bodyFont || refAnalysis.headingFont}`);
    } else {
      debug(`Font "${refAnalysis.headingFont}" not in whitelist, keeping theme fonts`);
    }
  }

  const ctaPage = ai.navigation.ctaPage || 'quote';
  const ctaSlug = `/${ctaPage}`;

  const allNonHome = ai.pages.filter(p => p.slug !== 'home').sort((a, b) => (a.navOrder ?? 99) - (b.navOrder ?? 99));
  const serviceDetailPages = allNonHome.filter(p => p.serviceDetailPage === true);
  const regularPages = allNonHome.filter(p => !p.serviceDetailPage);

  // Header nav: regular pages only (service detail + keyword pages excluded)
  // Footer: Quick Links column (service links handled by hardcoded Footer.tsx section)
  const footerColumns = [{
    title: "Quick Links",
    links: [
      { label: "Home", href: "/" },
      ...regularPages
        .filter(p => p.navLabel)
        .map(p => ({ label: p.navLabel, href: `/${p.slug}` }))
    ]
  }];

  const navigation = {
    header: {
      links: [
        { label: "Home", href: "/" },
        ...regularPages
          .filter(p => p.navLabel && p.slug !== ctaPage)
          .map(p => ({ label: p.navLabel, href: `/${p.slug}` }))
      ],
      cta: { label: ai.navigation.ctaLabel, href: ctaSlug }
    },
    footer: {
      description: ai.navigation.footerDescription,
      columns: footerColumns,
      copyright: `${companyName}. All rights reserved.`
    }
  };

  const locale = localeMap[languageName] || 'en_CA';
  const seo = {
    domain: ai.seo.domain.startsWith('https://') ? ai.seo.domain : `https://${ai.seo.domain}`,
    locale,
    siteTitle: ai.seo.siteTitle,
    siteDescription: ai.seo.siteDescription,
    keywords: ai.seo.keywords,
    verification: { google: "YOUR_GOOGLE_VERIFICATION_CODE" },
    schema: {
      areaServed: ai.seo.areaServed,
      addresses: ai.seo.addresses,
      openingHours: ai.seo.openingHours,
      priceRange: ai.seo.priceRange,
      offerCatalogName: ai.seo.offerCatalogName
    }
  };

  return { brand, navigation, seo, services: ai.services, pages: ai.pages, ai };
}

// ─── AI Keyword Page Generation (Call 2) ─────────────────────────────────────

async function generateKeywordPages(opts) {
  const {
    keywordPages, brand, seo, companyName, industry, location, languageName,
    serviceDetailMap = {},
  } = opts;

  const client = new Anthropic();

  const languageInstruction = languageName !== 'English'
    ? `\nLANGUAGE: Write ALL content in ${languageName}. Only JSON keys and technical values (slugs, hrefs, icon names, variant names, section type names) should remain in English.\n`
    : '';

  const prompt = `You are an expert SEO copywriter. Generate keyword-optimized landing pages for a local service business. Return ONLY a valid JSON array, no markdown fences, no explanation.

BUSINESS CONTEXT:
- Company: ${companyName}
- Industry: ${industry}
${location ? `- Location: ${location}` : ''}
- Brand tagline: ${brand.tagline}
- Site description: ${seo.siteDescription}
${languageInstruction}
${Object.keys(serviceDetailMap).length > 0 ? `SERVICE DETAIL PAGES (link breadcrumbs to these when available):
${Object.entries(serviceDetailMap).map(([svcId, slug]) => `- ${svcId}: /${slug}`).join('\n')}
` : ''}
KEYWORD PAGES TO CREATE (one page per keyword):
${keywordPages.map((kp, i) => `${i + 1}. slug: "${kp.nestedSlug}" — keyword: "${kp.keyword}" (${kp.volume || '?'} searches/mo) — service: ${kp.service}`).join('\n')}

EACH PAGE MUST have 4-6 sections from these options:
1. "page-header" (REQUIRED first) — variants: "default", "minimal", "centered", "with-description"
   data: { title, subtitle?, breadcrumbs: [{label:"Home", href:"/"}, {label:"<Service>", href:"/${Object.values(serviceDetailMap)[0] || '<service-slug>'}"}, {label:"<Page Title>"}], variant }
2. "text-block" (REQUIRED, 2-3 paragraphs of unique SEO content) — variants: "default", "two-column", "highlight-box", "with-list", "quote"
   data: { headline?, content (2-3 paragraphs), variant, items?: [string] }
3. "benefits-list" OR "process-steps" (pick one per page, alternate between pages)
   benefits-list variants: "alternating", "icon-large", "numbered-large", "cards-horizontal"
   data: { headline, items: [{title, description}], variant }
   process-steps variants: "horizontal", "vertical", "cards", "zigzag"
   data: { headline, steps: [{title, description}], variant }
4. "faq-accordion" (REQUIRED, 3-4 questions) — variants: "centered", "two-column", "cards", "numbered"
   data: { headline, items: [{question, answer}], variant }
5. "cta-banner" (REQUIRED last) — variants: "solid", "outlined", "gradient", "split", "dark"
   data: { headline, description, button: {label, href}, variant }

Return a JSON ARRAY of page objects:
[
  {
    "slug": "${keywordPages[0]?.nestedSlug || 'service/keyword'}",
    "title": "<Page Title with keyword, max 60 chars>",
    "description": "<Meta description with keyword + location, max 155 chars>",
    "navLabel": "<Short label for footer nav>",
    "navOrder": 50,
    "changeFrequency": "monthly",
    "priority": 0.6,
    "sections": [ ... ]
  }
]

CRITICAL RULES:
- Create EXACTLY ${keywordPages.length} pages — one per keyword listed above.
- Each page slug MUST match the slug listed above EXACTLY (e.g. "${keywordPages[0]?.nestedSlug || 'service/keyword'}").
- Use the target keyword naturally in: page title, meta description, h1, headings, and body content.
- Each page MUST have 4-6 sections (NOT 3). Quality matters — write detailed, unique content.
- text-block content should be 2-3 substantial paragraphs (400-600 words) of unique SEO copy, not just 1-2 sentences.
- FAQ answers should be 2-3 sentences each, naturally incorporating the keyword and location.
- Make each page unique — don't use the same template/variant for every page.
- Vary section types and variants across pages. Alternate between benefits-list and process-steps.
- CTA href should point to "/quote" or the appropriate contact page, or alternate with a service detail page link (e.g. "/services/{slug}") when available.
- Breadcrumb middle level: use the service detail page URL (e.g. "/services/{service-id}") when one exists for that service.
- Include ${location || 'the local area'} naturally in content for local SEO.
- navOrder should be 50+ (keyword pages sort after regular pages).`;

  emit('prompt', { name: 'Keyword Pages', content: prompt });
  progress('AI is generating keyword page content...', 60);

  const call2Start = Date.now();
  const stream = await client.messages.stream({
    model,
    max_tokens: maxTokens,
    messages: [{ role: 'user', content: prompt }],
  });

  const response = await stream.finalMessage();
  const call2Duration = ((Date.now() - call2Start) / 1000).toFixed(1);

  // Emit cost for Call 2 (keyword pages)
  const usage2 = response.usage || {};
  const cost2 = ((usage2.input_tokens || 0) * pricing.input + (usage2.output_tokens || 0) * pricing.output) / 1_000_000;
  emit('cost', {
    operation: 'create-site',
    cost: cost2,
    duration: Date.now() - call2Start,
    detail: `Keyword pages (${usage2.input_tokens || 0} in / ${usage2.output_tokens || 0} out)`,
  });
  debug(`Call 2 cost: $${cost2.toFixed(4)} (${usage2.input_tokens} in / ${usage2.output_tokens} out)`);

  if (response.stop_reason === 'max_tokens') {
    debug('WARNING: Keyword pages response was truncated');
  }

  progress('Parsing keyword pages...', 65);

  const text = response.content[0].text.trim();
  const jsonStr = text.replace(/^```[\w]*\n?/, '').replace(/\n?```$/, '');

  let pages;
  try {
    pages = JSON.parse(jsonStr);
  } catch (e) {
    debug('Failed to parse keyword pages JSON:', e.message);
    debug('Raw response (first 500 chars):', text.substring(0, 500));
    // Return empty — don't fail the whole build for keyword pages
    return [];
  }

  if (!Array.isArray(pages)) {
    debug('Keyword pages response is not an array, wrapping');
    pages = pages.pages || [pages];
  }

  // Mark each page as keyword page for nav filtering
  for (const p of pages) {
    p.keywordPage = true;
  }

  debug(`Generated ${pages.length} keyword page(s)`);
  return pages;
}

// ─── Run ──────────────────────────────────────────────────────────────────────

main().catch(err => {
  fatal(err.stack || err.message || String(err));
});
