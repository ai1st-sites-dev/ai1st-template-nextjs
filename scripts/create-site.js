#!/usr/bin/env node

/**
 * create-site.js — Docker container version
 *
 * Reads JSON config from stdin, generates a website using Claude API, outputs JSON lines
 * progress events to stdout, and stops once the config is written and committed. Preview is
 * NOT this script's job: worker/entrypoint.sh runs sync-config and serves the site.
 *
 * 🔴 This used to say "then starts next dev for preview" (#1055 打磨批次 #16 条 1). Two things
 * in it were wrong. Nothing in this file starts any server — the last thing it does is emit
 * `progress('Site generated, starting preview...')`. And the preview has not been `next dev`
 * since TICKET-275a: entrypoint.sh runs `next build` (output: 'export') and serves out/ with
 * `serve`, which is what killed the HMR websocket that made TICKET-275 (worker/entrypoint.sh,
 * `start_preview_server`).
 *
 * Usage: echo '{"siteId":"a1b2c3d4",...}' | ANTHROPIC_API_KEY=xxx node scripts/create-site.js
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const Anthropic = require('@anthropic-ai/sdk');
const { parseRefSections, parseRefNavLinks } = require('./ref-section-mapping');
// #924: the theme registry (colors + fonts + layout preferences + logo style adjective)
// lives in scripts/themes.js and is the single source of truth. sync-config.js reads the
// same file at build time.
const { themes, themeStyle, pickThemeForIndustry, rotationIndexFromSiteId } = require('./themes');
// #1064: 主题的形态样式表叫什么 —— 判据只在那个文件里，见它开头那段注释。
const { sheetNameForTheme } = require('./theme-sheet');
// #1120: 每站微扰派哪三个数 —— 表和判据都在那个文件里（含为什么它不能塞进 scripts/tweaks.js）。
const { tweaksForSite } = require('./lib/site-tweaks');
// #999 — 块清单（槽 / 形态 / 外观词 / 角色兜底 / 哪些行业需要它）住在 blocks/*.json，34 份。
// 下面提示词里那两段块清单**从它们生成**，AI 吐回来之后的校验读的也是同一份 —— 在这之前，
// 「hero 有哪些槽」只存在于这个文件的散文里，填错没人管。
const {
  promptSection: blockPromptSection,
  dataLineFor: blockDataLineFor,
  loadManifests: loadBlockManifests,
  validateSite: validateBlocks,
  applyRoleDefaults: applyBlockRoleDefaults,
} = require('./lib/block-manifest');
const blockDataLine = (type) => blockDataLineFor(loadBlockManifests().get(type));
// #1034 — 每个站一份首页开场配方（开头四块 + 两个必须出现的块 + 候选清单的印刷顺序）。
// 治的是「6 个真实站 100% 以 announcement-bar → hero 开场」那件事，理由整段在那个文件头上。
const {
  tryHomepageRecipe,
  recipePromptLines,
  recipeProblems,
  fingerprintEnabled,
  afterRetry,
} = require('./lib/homepage-recipe');
// #998 — 写页面 JSON 时把 AI 产出的 `sections` 转成 `blocks`（补 id / role / region / weight）。
// 归一化和角色兜底表跟 sync-config.js 用的是同一份实现，两处各写一遍必然分叉。
const { pageWithBlocks } = require('./blocks');
// #1097 — 上门服务类的站，首屏带一个能留联系方式的表单。三道判断（行业 / 主题声明 / 这一页有没有
// hero）都住在那个文件里，这里只在写盘前叫它一次。
const { applyHeroLeadForm } = require('./lib/hero-lead-form');

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

// TICKET-160: Brand Site AI Logo Generation — switched from Imagen 4 to Nano
// Banana (Gemini 2.5 Flash Image). Same silent build-time semantics, same
// fallback (caller catches and falls back to text logo). $0.04 → $0.005/image.
// Delegates to callNanoBanana helper (added by TICKET-161). Returns Buffer.
//
// Prompt design (TICKET-160 addendum, Stage A v2 verified 6/6 zero-text):
//   - Natural-language paragraph (NOT label:value structure — 159 shipped with
//     label:value prompt that Imagen 4 mis-rendered AS text in the image,
//     leaking design brief / hex codes / wordmarks into the PNG).
//   - companyName is intentionally NOT embedded in the prompt body — model
//     can't hallucinate a wordmark for a name it never saw. The parameter is
//     kept in the signature for caller-compatibility / future use.
//   - ALL CAPS negative block enumerating every form of text (letters, words,
//     numbers, hex codes, labels, captions, writing, monograms, initials,
//     typography) to suppress all text leakage variants.
async function generateLogoViaNanoBanana({ companyName: _companyName, industry, primaryColor, accentColor, themeName, apiKey }) {
  if (!apiKey) throw new Error('GEMINI_API_KEY missing (no key in stdin payload)');
  const styleAdjective = themeStyle(themeName);
  const prompt = `Create a LARGE, dominant single-mark icon representing a ${industry} business — a professionally designed brand identity logo with a polished, commercial-grade aesthetic suitable for a modern company's website header. The icon must be ${styleAdjective}, flat 2D, designed as ONE cohesive integrated symbol with smooth curves and refined silhouettes.

UNIFIED MARK (CRITICAL): Choose ONE primary concept and refine it into a single integrated shape. Do NOT combine 2 or more separate iconic objects (e.g. a house AND a plate AND a fork; or a shield AND an arrow AND a scale). Such composite logos look amateurish. Instead, pick ONE strong visual metaphor (e.g. just a stylized bowl with steam, or just an upward arrow with refined geometry) and execute it with confident craft.

CANVAS FILL (MANDATORY): The icon must fill AT LEAST 70% of the image canvas — both its width and height should occupy ~80-90% of the frame, with minimal padding (~5-10% margin on each side maximum). Icons that occupy less than half the canvas are UNACCEPTABLE — this is a hard requirement. Imagine the icon as a postage-stamp-sized commercial logo blown up to fill the frame — large, bold, dominating the composition. Do NOT leave large empty whitespace around the icon.

COLORS: Use ${primaryColor} as the dominant color and ${accentColor} sparingly as a small accent for visual interest only. Pure white background, no shadow, no border, no frame.

ABSOLUTELY NO TEXT IN THE IMAGE. The image must contain ZERO letters, ZERO words, ZERO numbers, ZERO hex codes, ZERO labels, ZERO captions, ZERO writing, ZERO monograms, ZERO initials, ZERO typography of any kind. Pure visual icon only — a single symbolic geometric shape with no characters or text elements anywhere in the image.`;

  return await callNanoBanana({ prompt, apiKey });
}

// TICKET-197: deterministic post-processing for Nano Banana logo output.
// Gemini 2.5 Flash Image doesn't reliably honor "AT LEAST 70% canvas fill"
// prompt instructions (see 194 V2 — lawyer 99.8% extreme / restaurant 19.4%
// / IT 19.9% — split distribution). This crops to the non-white bounding
// box then resizes so the icon occupies ~targetOccupancyPct of the canvas
// with the longest dimension scaled to that target (aspect-ratio preserved).
// No-ops when the icon is already at-or-above the target (avoids re-processing
// the lawyer 99.8% extreme case).
const Jimp = require('jimp');
async function cropAndResizeLogo(logoBuf, targetOccupancyPct = 80) {
  const img = await Jimp.read(logoBuf);
  const W = img.bitmap.width;
  const H = img.bitmap.height;

  // 1. Detect non-white bounding box (tolerance 240 — pixel "non-white" if
  // any RGB channel < 240; matches 194 V2 occupancy.py PIL detection).
  let minX = W, minY = H, maxX = -1, maxY = -1;
  img.scan(0, 0, W, H, (x, y, idx) => {
    const r = img.bitmap.data[idx];
    const g = img.bitmap.data[idx + 1];
    const b = img.bitmap.data[idx + 2];
    if (r < 240 || g < 240 || b < 240) {
      if (x < minX) minX = x;
      if (y < minY) minY = y;
      if (x > maxX) maxX = x;
      if (y > maxY) maxY = y;
    }
  });

  if (maxX < 0 || maxY < 0) {
    // All-white / empty input — return original buffer untouched (safety fallback).
    return logoBuf;
  }

  const bboxW = maxX - minX + 1;
  const bboxH = maxY - minY + 1;

  // 2. No-op skip if the icon's longer dimension already exceeds the target
  // (e.g. lawyer 99.8% extreme). Avoids re-processing an already-large icon
  // and prevents accidental upscaling artifacts.
  const longerDimPct = Math.max(bboxW / W, bboxH / H) * 100;
  if (longerDimPct >= targetOccupancyPct) {
    return logoBuf;
  }

  // 3. Crop to bbox, then resize so the longer side equals the target px count.
  const cropped = img.clone().crop(minX, minY, bboxW, bboxH);
  const targetSize = Math.floor(Math.min(W, H) * (targetOccupancyPct / 100));
  const scale = targetSize / Math.max(bboxW, bboxH);
  const newW = Math.floor(bboxW * scale);
  const newH = Math.floor(bboxH * scale);
  cropped.resize(newW, newH); // jimp default: bilinear

  // 4. Paste centered onto a new white canvas of the original dimensions.
  const canvas = new Jimp(W, H, 0xFFFFFFFF); // RGBA opaque white
  const offsetX = Math.floor((W - newW) / 2);
  const offsetY = Math.floor((H - newH) / 2);
  canvas.composite(cropped, offsetX, offsetY);

  return await canvas.getBufferAsync(Jimp.MIME_PNG);
}

// TICKET-161: Nano Banana (Gemini 2.5 Flash Image) — generateContent-style
// endpoint. Returns a Buffer (PNG/JPG) on success; throws on failure. Field
// name is `inlineData` (camelCase) per v1beta generateContent API; SDK aliases
// fall back to `inline_data` historically.
const NANO_BANANA_ENDPOINT =
  'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-image:generateContent';

async function callNanoBanana({ prompt, apiKey, timeoutMs = 30_000 }) {
  if (!apiKey) throw new Error('GEMINI_API_KEY missing (no key in stdin payload)');
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(new Error('Nano Banana request timeout 30s')), timeoutMs);
  try {
    const url = `${NANO_BANANA_ENDPOINT}?key=${encodeURIComponent(apiKey)}`;
    const resp = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] }),
      signal: ac.signal,
    });
    if (!resp.ok) {
      const errBody = await resp.text();
      throw new Error(`Nano Banana ${resp.status}: ${errBody.slice(0, 200)}`);
    }
    const json = await resp.json();
    const parts = json?.candidates?.[0]?.content?.parts || [];
    const imagePart = parts.find(p => p.inlineData?.data || p.inline_data?.data);
    if (!imagePart) throw new Error('Nano Banana response missing image part');
    const b64 = imagePart.inlineData?.data || imagePart.inline_data?.data;
    return Buffer.from(b64, 'base64');
  } finally {
    clearTimeout(timer);
  }
}

// TICKET-164: v2 slot-driven photo generation. Replaces the v1 fixed-3
// (hero/interior/detail) model with a 2-pass scan-and-fill: Claude generates
// `ai.pages` first (no image info), then we walk each section, collect every
// image slot (hero/cta-banner/content-split single imageUrl + gallery
// items[].imageUrl), generate a per-slot context-aware prompt, call Nano
// Banana, write `/public/photos/<key>.jpg`, and mutate the ai.pages section
// to fill imageUrl. Hard cap 100 per memory `feedback_scope_cap_5x_normal.md`
// (typical site 5-25 photos, 5x normal peak ~125, rounded down to 100).
// TICKET-164: 5x normal usage default per memory feedback_scope_cap_5x_normal.md.
// TICKET-166: changed const → let so caller can override via stdin payload
// `input.maxImagesPerSite` (sourced from Admin Settings → ai1st.site.maxImagesPerSite).
let photoHardCap = 100;

function collectImageSlots(pages) {
  const slots = [];
  for (const page of pages || []) {
    const sections = page.sections || [];
    for (let i = 0; i < sections.length; i++) {
      const sec = sections[i];
      const t = sec.type;
      if (t === 'hero' || t === 'cta-banner' || t === 'content-split') {
        slots.push({ pageSlug: page.slug, secIdx: i, secType: t, itemIdx: null });
      } else if (t === 'gallery' && sec.data && Array.isArray(sec.data.items)) {
        for (let j = 0; j < sec.data.items.length; j++) {
          slots.push({ pageSlug: page.slug, secIdx: i, secType: 'gallery', itemIdx: j });
        }
      }
    }
  }
  return slots;
}

function buildSlotPrompt({ secType, industry, primaryColor, themeWord }) {
  // Shared scene prefix → visual cohesion across all photos in same site.
  // TICKET-164 v2 (path B): apply 160 PM addendum §1 "ABSOLUTELY NO TEXT"
  // pattern verbatim (proven 2/2 industries prod-clean Florist + Realty
  // commit 577b22e). Root-cause fix:
  // (a) drop "accents in signage" → ${primaryColor} now binds to "decor and
  //     ambient lighting" only, removing signage invitation into scene
  // (b) replace weak "AVOID logos or text overlays" with ABSOLUTELY NO TEXT
  //     block enumerating 9 visual-text variants (signage / wordmarks / labels /
  //     etc.) — model can no longer interpret AVOID as post-process overlay
  //     suppression only.
  // Faces ALLOWED (preserves v1 user decision — no walk-back).
  const scene = `${industry} business interior or exterior scene, warm natural lighting, photorealistic, ${themeWord} aesthetic. Use ${primaryColor} as the dominant color tone in the decor, walls, furnishings, and ambient lighting. Professional friendly diverse people (varied ages and ethnicities) may appear naturally. AVOID children unless industry is pediatric/childcare/school; AVOID medical surgery, distress, or sensitive scenes; AVOID religious symbols not relevant to the brand.

ABSOLUTELY NO TEXT IN THE IMAGE. The scene must contain ZERO visible business signage with letters, ZERO storefront signs with words, ZERO wall-mounted signs with text, ZERO printed wordmarks or brand names, ZERO menu boards with readable words, ZERO product labels with letters, ZERO English or any-language words, ZERO numbers or digits, ZERO logos with characters, ZERO typography of any kind anywhere in the scene. Buildings, products, walls, and decor must be free of any written or printed text elements.`;

  switch (secType) {
    case 'hero':
      return `Wide-angle 16:9 exterior storefront or entrance view of ${scene} Daytime, inviting, welcoming atmosphere with depth.`;
    case 'cta-banner':
      return `Atmospheric 16:9 mood-setting background image evoking ${scene} Soft lighting suitable for overlay text. No prominent foreground subject.`;
    case 'content-split':
      return `4:3 contextual scene of ${scene} Authentic candid moment, not posed.`;
    case 'gallery':
      return `4:3 detail or moment shot of ${scene} Variety: product close-up / service action / interior detail / candid interaction (different from other gallery photos).`;
    default:
      return null;  // shouldn't happen given collectImageSlots filter
  }
}

function setSlotImageUrl(pages, slot, url) {
  const page = pages.find(p => p.slug === slot.pageSlug);
  if (!page) return;
  const section = page.sections[slot.secIdx];
  if (!section) return;
  if (slot.secType === 'gallery') {
    if (!section.data?.items?.[slot.itemIdx]) return;
    section.data.items[slot.itemIdx].imageUrl = url;
  } else {
    if (!section.data) section.data = {};
    section.data.imageUrl = url;
  }
}

// TICKET-172 (hotfix): AI sometimes invents placeholder strings like
// "gradient-about" / "tbd" for slots that exceed photoHardCap or fail Nano
// Banana generation — instead of leaving imageUrl unset per prompt. Those
// invalid strings leak to <img src="..."> → broken image. Drop anything that
// isn't a valid URL pattern so the template falls back to its gradient placeholder.
function isValidImageUrl(s) {
  return typeof s === 'string' &&
         (s.startsWith('/') || s.startsWith('http://') || s.startsWith('https://') || s.startsWith('data:'));
}

function sanitizeImageUrls(pages) {
  let dropped = 0;
  for (const page of pages || []) {
    for (const section of page.sections || []) {
      if (section.data?.imageUrl && !isValidImageUrl(section.data.imageUrl)) {
        delete section.data.imageUrl;
        dropped++;
      }
      if (Array.isArray(section.data?.items)) {
        for (const item of section.data.items) {
          if (item.imageUrl && !isValidImageUrl(item.imageUrl)) {
            delete item.imageUrl;
            dropped++;
          }
        }
      }
    }
  }
  return dropped;
}

// Returns { attempted, success, totalSlots } so caller can log + emit. Failures
// are silent (per-slot try/catch + debug event) so a single Nano Banana 5xx
// can't take the build down.
async function generateSlotPhotos({ pages, industry, primaryColor, themeName, apiKey, outputDir, emitFn }) {
  const themeWord = themeName || 'minimal';
  fs.mkdirSync(outputDir, { recursive: true });

  let slots = collectImageSlots(pages);
  const originalCount = slots.length;
  if (slots.length > photoHardCap) {
    slots = slots.slice(0, photoHardCap);
    if (emitFn) emitFn('debug', { photoCapped: true, originalCount, capped: photoHardCap });
  }

  let successCount = 0;
  for (const slot of slots) {
    const startMs = Date.now();
    const keyParts = [slot.pageSlug, `s${slot.secIdx}`, slot.secType];
    if (slot.itemIdx !== null) keyParts.push(`i${slot.itemIdx}`);
    const uniqueKey = keyParts.join('-').replace(/[^a-zA-Z0-9-]/g, '_');
    try {
      const prompt = buildSlotPrompt({ secType: slot.secType, industry, primaryColor, themeWord });
      if (!prompt) continue;
      const imageBytes = await callNanoBanana({ prompt, apiKey });
      fs.writeFileSync(path.join(outputDir, `${uniqueKey}.jpg`), imageBytes);
      setSlotImageUrl(pages, slot, `/photos/${uniqueKey}.jpg`);
      successCount++;
      if (emitFn) emitFn('cost', {
        operation: 'nano-banana-photo',
        provider: 'Google',
        cost: 0.005,
        duration: Date.now() - startMs,
        detail: uniqueKey,
      });
    } catch (err) {
      if (emitFn) emitFn('debug', { photoFailure: uniqueKey, reason: err.message });
      // per-slot independent: skip, others continue. imageUrl 留空 → template fallback.
    }
  }
  return { attempted: slots.length, success: successCount, totalSlots: originalCount };
}

const availableIcons = [
  'shield-check', 'bell', 'camera', 'lock', 'fingerprint', 'thermometer',
  'speaker', 'tv', 'wifi', 'leaf', 'tree', 'sun', 'droplet', 'scissors',
  'shovel', 'snowflake', 'lightbulb'
];

// ─── TICKET-122b: Secondary locale pipeline helpers ──────────────────────────

// Tier thresholds — calibration tunable post-deploy without code changes.
// PM v2 §59-83 starting heuristics; revisit after 5+ bilingual sites in production.
const TIER_THRESHOLDS = {
  // Tier 1 = rich data: real keywords cover the 5 SEO touchpoints
  TIER_1_MIN_KEYWORDS: 5,
  TIER_1_MIN_HIGH_VOLUME_COUNT: 1,    // ≥1 keyword with monthly search volume above threshold
  TIER_1_HIGH_VOLUME_THRESHOLD: 100,  // monthly searches (DataForSEO Organic SERP)
  // Tier 2 = sparse: some real keywords + some translation
  TIER_2_MIN_KEYWORDS: 1,
  // (else → Tier 3: no keyword data, pure SEO-friendly translation + AI judgment)
};

function computeTier(kwArray) {
  if (!Array.isArray(kwArray) || kwArray.length < TIER_THRESHOLDS.TIER_2_MIN_KEYWORDS) return 3;
  const highVolCount = kwArray.filter(k => (k && typeof k.volume === 'number' && k.volume >= TIER_THRESHOLDS.TIER_1_HIGH_VOLUME_THRESHOLD)).length;
  if (kwArray.length >= TIER_THRESHOLDS.TIER_1_MIN_KEYWORDS && highVolCount >= TIER_THRESHOLDS.TIER_1_MIN_HIGH_VOLUME_COUNT) return 1;
  return 2;
}

// Generic per-call retry with exponential backoff (5s / 15s / 45s by default).
// Throws the final error if all attempts fail.
async function retryWithBackoff(fn, { retries = 3, backoff = [5000, 15000, 45000], label = 'op' } = {}) {
  let lastErr;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      if (attempt === retries) break;
      const delay = backoff[attempt] !== undefined ? backoff[attempt] : backoff[backoff.length - 1];
      debug(`[retry] ${label} attempt ${attempt + 1}/${retries + 1} failed: ${err.message}. Retrying in ${delay}ms...`);
      await new Promise(r => setTimeout(r, delay));
    }
  }
  throw lastErr;
}

// TICKET-148: Classify an Anthropic SDK error as retryable (overloaded/rate-limit/5xx)
// vs terminal (bad request/auth/etc). 3-way fallback to absorb SDK or server format
// drift: status code first, then err.error.type, then regex on message. Mirrored
// (independent copy) in edit-site.js per PM § decision E (no shared module).
function isRetryableApiError(err) {
  // Path 1: HTTP status code (Anthropic SDK v0.74+ exposes this on APIError)
  const retryableStatuses = [429, 500, 502, 503, 529];
  if (err && err.status && retryableStatuses.includes(err.status)) return true;
  // Path 2: server-returned error.type JSON field
  if (err && err.error && err.error.type && /overloaded|rate_limit_error/.test(err.error.type)) return true;
  // Path 3: regex on message (covers SDK parsing failure or older versions)
  if (err && /overloaded|rate.?limit|too many requests/i.test(err.message || '')) return true;
  return false;
}

// TICKET-132 + TICKET-148: AI-call-level retry layered as:
//   - API errors (429/5xx/529/overloaded) → 3 attempts with 5s/10s/20s backoff (TICKET-148)
//   - JSON.parse failures (AI hallucinating malformed JSON) → 3 attempts with 1s/2s/4s
//     backoff + augmented prompt asking for valid JSON (TICKET-132)
//   - max_tokens or other terminal errors → throw immediately
//
// Each attempt re-streams the call. On API error: retry the same prompt. On JSON
// parse failure: augment `messages` with a short assistant excerpt + explicit
// "respond AGAIN with ONLY valid JSON" user instruction.
//
// Outer `retryWithBackoff` (L322) still wraps secondary-locale translate paths
// (L919 / L1005) so they get an additional retry tier — accepted layered cost.
//
// `costContext` shape: { operation, detail, pricing, durationStart? } —
// detail gets ` [retry N]` appended on attempt 2+ for dashboard transparency.
async function callAIWithRetry({ client, baseOptions, costContext, label, maxAttempts = 3 }) {
  let messages = baseOptions.messages;
  let lastParseError;
  let lastText = '';
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    let response;
    // TICKET-148: API-error retry around stream/finalMessage. Independent retry
    // budget from the JSON-parse-retry below (an attempt can hit API error
    // multiple times and still get its JSON parse attempt).
    let apiAttempt = 0;
    const maxApiAttempts = 3;
    while (true) {
      try {
        const stream = await client.messages.stream({ ...baseOptions, messages });
        response = await stream.finalMessage();
        break; // API call succeeded — proceed to cost / JSON parse below.
      } catch (apiErr) {
        apiAttempt++;
        if (isRetryableApiError(apiErr) && apiAttempt < maxApiAttempts) {
          const waitMs = 1000 * Math.pow(2, apiAttempt - 1) * 5; // 5s, 10s, 20s
          debug(`[ai-retry] ${label} API error ${apiErr.status || 'unknown'} (${apiAttempt}/${maxApiAttempts - 1}): ${apiErr.message?.substring(0, 200) || 'no message'} — retrying in ${waitMs}ms`);
          await new Promise(r => setTimeout(r, waitMs));
          continue;
        }
        // Not retryable, or budget exhausted — propagate.
        throw apiErr;
      }
    }

    // Emit cost on EVERY attempt — user paid for each token.
    const usage = response.usage || {};
    const cost = ((usage.input_tokens || 0) * costContext.pricing.input + (usage.output_tokens || 0) * costContext.pricing.output) / 1_000_000;
    const retryTag = attempt > 1 ? ` [retry ${attempt - 1}]` : '';
    emit('cost', {
      operation: costContext.operation,
      cost,
      duration: costContext.durationStart ? (Date.now() - costContext.durationStart) : 0,
      detail: `${costContext.detail}${retryTag} (${usage.input_tokens || 0} in / ${usage.output_tokens || 0} out)`,
    });

    // max_tokens is a prompt-size problem — retrying the same prompt would
    // hit the same wall. Throw so caller (or outer retryWithBackoff) reacts.
    if (response.stop_reason === 'max_tokens') {
      throw new Error(`${label}: response was truncated (max_tokens hit) — try reducing prompt size`);
    }

    const text = response.content[0].text.trim();
    lastText = text;
    const jsonStr = text.replace(/^```[\w]*\n?/, '').replace(/\n?```$/, '');
    try {
      debug(`[ai-retry] ${label} attempt ${attempt}/${maxAttempts}: parse succeeded`);
      return { parsed: JSON.parse(jsonStr), response, text };
    } catch (parseErr) {
      lastParseError = parseErr;
      debug(`[ai-retry] ${label} attempt ${attempt}/${maxAttempts}: JSON.parse failed: ${parseErr.message}`);
      if (attempt >= maxAttempts) break;

      // Augment messages: truncated excerpt (cost-control) + retry instruction.
      const excerpt = text.substring(0, 500) + (text.length > 500 ? '... [truncated]' : '');
      messages = [
        ...messages,
        { role: 'assistant', content: `[Response was malformed. Excerpt: ${excerpt}]` },
        { role: 'user', content: `Previous response failed JSON.parse with error: "${parseErr.message}". Respond AGAIN with ONLY valid JSON — no markdown fences, no comments, no trailing commas, no explanatory text. Same content/structure as originally requested.` },
      ];

      // Short exponential backoff (1s, 2s, 4s) — JSON parse failure is not
      // a rate-limit issue so no need to wait long.
      await new Promise(r => setTimeout(r, 1000 * Math.pow(2, attempt - 1)));
    }
  }
  const err = new Error(`${label}: failed to parse AI response as JSON after ${maxAttempts} attempts. Last error: ${lastParseError.message}`);
  // Attach last raw response so callers can persist it for postmortem.
  err.lastText = lastText;
  err.lastParseError = lastParseError;
  throw err;
}

// Map natural-language names → ISO 639-1 codes (case-insensitive). Both primary
// (`language` input) and secondary (`secondaryLocales[]`) inputs flow through this.
const LANG_NAME_TO_ISO = {
  'english': 'en', 'chinese': 'zh', 'french': 'fr', 'spanish': 'es',
  'japanese': 'ja', 'korean': 'ko', 'german': 'de', 'italian': 'it',
  'portuguese': 'pt', 'russian': 'ru', 'vietnamese': 'vi', 'arabic': 'ar',
  'hindi': 'hi', 'thai': 'th',
  // TICKET-169: explicit Simplified / Traditional Chinese variants. 'zh' alone
  // stays Simplified (preserves all historic sites). 'zh-tw' is the new opt-in
  // Traditional variant. Natural-language aliases ("simplified chinese" /
  // "traditional chinese" / "taiwanese") accepted from dashboard / docs.
  'simplified chinese': 'zh',
  'traditional chinese': 'zh-tw',
  'taiwanese': 'zh-tw',
};

function normalizeLocale(input) {
  if (!input || typeof input !== 'string') return null;
  // TICKET-169: allow BCP-47 simple form `lang-REGION` (e.g. zh-TW). Pattern:
  // 2-3 letter primary + optional `-` + 2-4 letter region.
  if (!/^[a-zA-Z]{2,}(-[a-zA-Z]{2,4})?$/.test(input)) return null;
  const k = input.toLowerCase();
  return LANG_NAME_TO_ISO[k] || k;
}

// TICKET-169: returns a sentence-level prompt addendum the AI uses to pick the
// right Chinese character variant. The root cause of "user picks Chinese →
// site comes back Traditional sometimes" was that the LANGUAGE instruction
// just said "Write in Chinese" — Claude flipped a coin. This pins it.
function chineseVariantHint(languageName) {
  if (!languageName) return '';
  const n = languageName.toLowerCase();
  if (n === 'traditional chinese' || n === 'taiwanese' || n === 'cantonese') {
    return ' Use Traditional Chinese characters (Taiwan / Hong Kong convention, 繁體). Do NOT use Simplified Chinese characters anywhere.';
  }
  if (n === 'chinese' || n === 'mandarin' || n === 'simplified chinese') {
    return ' Use Simplified Chinese characters (mainland China convention, 简体). Do NOT use Traditional Chinese characters anywhere.';
  }
  return '';
}

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
    // TICKET-122b: optional secondary locales (ISO codes or natural names like "zh"/"Chinese")
    // Empty / missing → single-locale site (preserves all pre-122b behavior).
    // secondaryLocaleKeywords: optional { [locale]: { [pageSlug]: [{keyword, volume}, ...] } }
    // for Tier 1/2 prompts; missing → all secondary pages fall through to Tier 3.
    secondaryLocales = [],
    secondaryLocaleKeywords = {},
    // TICKET-136: optional per-locale brand name overrides keyed by ISO code
    // (e.g. {"zh":"耐克"} for an English-primary Nike site). Missing or empty
    // keys fall back to companyName via getBrandName's per-key fallback.
    brandNameByLocale = {},
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
    geminiApiKey = '',
  } = input;

  // Override AI model/tokens from Admin Settings (passed through by Manager)
  if (input.model) { model = input.model; pricing = getModelPricing(model); }
  if (input.maxTokens) maxTokens = parseInt(input.maxTokens, 10) || maxTokens;
  // TICKET-166: admin override for AI image hard cap (default 100).
  if (input.maxImagesPerSite) photoHardCap = parseInt(input.maxImagesPerSite, 10) || photoHardCap;

  if (!siteId) fatal('siteId is required');
  if (!companyName) fatal('companyName is required');
  if (!industry) fatal('industry is required');

  // TICKET-122a (4th round, QA3 feedback) + 122b: validate language is a single
  // ISO 639-1 code (e.g. 'en') or natural-language name (e.g. 'English'). Reject
  // any input containing non-letter characters — this rejects multi-locale
  // separators (',' ';' '|' '/' space), path-traversal characters ('.' '/'), and
  // any other unsafe input that would propagate into path.join() / site_meta.json.
  // Empty string and null fall through to the 'en' default.
  if (typeof language === 'string' && language.length > 0 && !/^[a-zA-Z]{2,}(-[a-zA-Z]{2,4})?$/.test(language)) {
    fatal(`Invalid language "${language}". Must be ISO 639-1 code (e.g. en, zh, fr) or natural-language name (e.g. English, Chinese).`);
  }
  const defaultLocale = normalizeLocale(language) || 'en';

  // TICKET-122b: validate + normalize secondary locales (same regex + dedup vs primary)
  if (!Array.isArray(secondaryLocales)) {
    fatal(`secondaryLocales must be an array, got ${typeof secondaryLocales}`);
  }
  const normalizedSecondaryLocales = [];
  const seenLocales = new Set([defaultLocale]);
  for (const sl of secondaryLocales) {
    if (typeof sl !== 'string' || sl.length === 0) continue;
    if (!/^[a-zA-Z]{2,}(-[a-zA-Z]{2,4})?$/.test(sl)) {
      fatal(`Invalid secondaryLocale "${sl}". Must be ISO 639-1 code (e.g. zh, fr) or natural-language name (e.g. Chinese, French).`);
    }
    const norm = normalizeLocale(sl);
    if (norm && !seenLocales.has(norm)) {
      normalizedSecondaryLocales.push(norm);
      seenLocales.add(norm);
    }
  }
  const allLocales = [defaultLocale, ...normalizedSecondaryLocales];

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
  // TICKET-122a + 122b: multi-locale schema — site_meta.json + site/<defaultLocale>/pages/
  // (secondary locale subdirs are created later by writeSecondaryLocaleConfig)
  fs.mkdirSync(path.join(siteDir, defaultLocale, 'pages'), { recursive: true });
  fs.writeFileSync(
    path.join(siteDir, 'site_meta.json'),
    // TICKET-268b: persist siteId (tenant id for POST /api/leads) + leadApi base (absolute manager URL;
    // the site is served from R2, so the ContactFormSection POSTs cross-origin). leadApi is resolvable
    // at build time via NEXT_PUBLIC_LEAD_API too — env wins over this baked value (sync-config.js).
    JSON.stringify({ siteId, leadApi: process.env.LEAD_API_BASE || '', defaultLocale, locales: allLocales }, null, 2) + '\n'
  );

  // Pick theme.
  // #924: when the caller doesn't name a theme we rotate through the candidate pool for the
  // industry instead of always handing out the same one. Manager sends themeRotationIndex, which
  // goes up by one per site the user creates — so six shops in the same trade walk six different
  // slots. No index (anonymous create / DB read failed) → hash the siteId, which still spreads,
  // just without the guarantee.
  // #1041: that index now also carries a per-user starting offset (manager/sites.go
  // `themeRotationOffset`). Nothing here recomputes or unpacks it — this file has always treated
  // the number as an opaque slot index, which is exactly why the fix needed no change on this side.
  // #984: this used to sit after the skipAI branch returned, so demo sites never got a theme at
  // all — no site/theme.json (the Theme dialog had nothing to mark as current) and a hardcoded
  // blue palette that belongs to no registered theme. Both paths pick here now.
  const themeRotationIndex = Number.isInteger(input.themeRotationIndex) && input.themeRotationIndex >= 0
    ? input.themeRotationIndex
    : rotationIndexFromSiteId(siteId);
  // 🔴 #1046 条 14 —— 左边那一支【整条绕过轮换】：显式传一个已注册的主题名当 `template`，
  //    `pickThemeForIndustry` 和 `themeRotationIndex` 一个都不参与。生产路径踩不到（manager 从不往
  //    payload 里塞 `template`，默认值是 `'ai'`），但**造语料 / 造夹具的脚本很容易踩到**，而失败方向
  //    是假绿：绕开之后「改之前」和「改之后」两臂都读「没变化」，反向对照那一格看上去还是绿的。
  //    要量轮换，别传 `template`（或传 `'ai'`）。
  const themeName = (template && template !== 'ai' && themes[template]) ? template : pickThemeForIndustry(industry, themeRotationIndex);
  const theme = themes[themeName];
  debug(`Theme: ${themeName} — ${theme.label} (rotation index ${themeRotationIndex})`);

  // #1034 — 骨这一半:自己的索引，自己的池子。
  //
  // 🔴 r1 用的是上面那个 `themeRotationIndex`，那是错的。**当时**的错法只有在【跨用户】才看得见:
  //    那时它就是 `SELECT COUNT(*) FROM sites WHERE user_id = $1` 的结果，也就是**这个用户已经有
  //    几个站** ⟹ 每一个客户的第一个站，这个数恒为 0，拿到同一份配方。PM 2026-08-16 在平台库上
  //    算过它落成什么样:116 个站 / 73 个用户,73 个站的 index 是 0、33 个是 1 ⟹ **91% 的站落在
  //    两份配方上**，正是 #1034 要治的那个形状。
  //    (那条 SQL 上方 #924 自己写着「nothing downstream depends on this number being unique」——
  //     #1034 一度让某个东西依赖上了，而依赖的方向是跨用户，那句话没覆盖到。)
  //
  // 🔴 **上面那段是 #1041 之前的事，别当成今天的机制。** 今天 manager 送来的是
  //    `themeRotationIndexFor(user.ID, siteCount)`（`manager/sites.go:458`，函数在 `:1049-1058`；
  //    那条 `SELECT COUNT(*)` 现在在 `:455`），= **按 user id 算的一个起点 + 这个用户已有几个站**
  //    ⟹「每个客户的第一个站恒为 0」这句话今天**不成立**，不同用户的第一个站拿到的是不同的数。
  //
  // 🔴 即便如此，骨这一半仍然由 **siteId** 算(`rotationIndexFromSiteId`,主题拿不到计数器时走的
  //    同一条路)，理由换成了一条不随 #1041 变的:**皮和骨不能共用同一个索引**。共用的话，两个站
  //    只要主题相同（同行业的候选池只有 3-6 套，撞车降不到 0 —— #1041 票面那节量过），骨架就
  //    必然也相同 —— 两种「看起来一样」会被绑在一起，而它们本该互相稀释。siteId 每个站唯一，
  //    跟主题那条路完全独立。
  //
  // 📌 配方的类数是有限的，而且枚举得出来（`homepage-recipe.test.js` ⑪ 那一节现算，别照抄这里）:
  //    整份配方按 `index % 308` 循环、308 种互不相同 ⟹ 随机两个站拿到**完全相同的一份约束**
  //    是 **0.32%**;只看开场是 **33** 种 ⟹ 开场完全相同 **3.4%**。
  //    基线那 6 个真实站的「前 4 块完全相同」是 13%、「前 2 块」是 100%（票面 AC1）。
  //
  // 🔴 三种情况不参与:
  //   · payload 写了 homepageFingerprint: false —— AC3 的反向对照走这条
  //   · skipAI —— 那条路根本不问 AI，首页是 getDemoConfig 写死的四块（`:1551-1556`）
  //   · 用户点名要照抄参照站的布局（refPrefs 里有 layout）—— 那是他明确要的东西，
  //     提示词里那段自己就写着 "This OVERRIDES the general Choose 7-10 sections rule"。
  //     两条硬要求同时在场只会让 AI 二选一，而这一次该赢的是用户点名的那个。
  const wantsRefLayout = Array.isArray(refPrefs) && refPrefs.includes('layout')
    && !!(refAnalysis && refAnalysis.sections);
  const recipeIndex = rotationIndexFromSiteId(siteId);
  const recipeAttempt = (fingerprintEnabled(input) && !input.skipAI && !wantsRefLayout)
    ? tryHomepageRecipe(recipeIndex, loadBlockManifests(), industry)
    : { recipe: null, error: null };
  const homeRecipe = recipeAttempt.recipe;
  if (homeRecipe) {
    debug(`[fingerprint] 首页开场配方 #${homeRecipe.index}（siteId ${siteId} 算出来的）:`
      + ` ${homeRecipe.opener.join(' → ')}`
      + ` | 还必须有: ${homeRecipe.mustInclude.join(', ')} | 候选池 ${homeRecipe.poolSize} 种`);
  } else if (recipeAttempt.error) {
    // 🔴 块库跟配方的排除名单对不上（有人改名 / 删块）。r1 在这里是 `throw` ⟹ `create-site` 在
    //    提示词发出去之前 0.1 秒就死，而 `origin/main` 上同样的树照样能建站 —— 那是本票**新开的**
    //    失败方式，方向反了:骨架撞车不该让一次建站失败（本文件上面那段理由就是这么写的）。
    //    这一趟不用配方 = 退回改动之前的行为，而不是把站丢掉；名字记在日志里，
    //    CI 里那格 `npm run test:scripts` 会在改名的那次 push 上直接报红。
    debug(`[fingerprint] 🔴 这一趟不用配方，因为块库跟排除名单对不上: ${recipeAttempt.error.message}`);
  } else {
    debug(`[fingerprint] 关着 —— ${!fingerprintEnabled(input) ? 'payload 里 homepageFingerprint: false'
      : input.skipAI ? 'skipAI(首页是写死的四块)' : '用户点名照抄参照站布局'}`);
  }

  // ── §每站微扰（#1120）────────────────────────────────────────────────────────────────────────
  //
  // #1006 把机制做完了（相对偏移 → `custom.css`），但**没有人在建站时用它** —— 判据是
  // `git grep -c tweaks origin/main -- templates/nextjs/scripts/create-site.js` 零命中（本票立项时
  // 实测）。于是同行业撞到同一套主题的两个站，皮逐字节相同。这一段给每个新站派一组偏移。
  //
  // 🔴 它落在**这里**，不落在 `sync-config.js`，而这不是风格问题：本文件一个站只跑一次，
  //    `sync-config.js` **每次构建都跑**。放进后者，AC3 那两句会同时破 —— 从没有微扰的老站会在
  //    下一次重建时被塞进来，而站主在 Customize 里手调过的值会被自动值每次盖掉。
  //
  // 🔴 派生用的哈希**加了盐**，不是裸的 `rotationIndexFromSiteId(siteId)`。理由是上面 §骨 那段
  //    自己写下的纪律「皮和骨不能共用同一个索引」—— 微扰是第三个「看起来一样」的维度，共用就是把
  //    第三种相同也绑到前两种上。而 `h(s) = h*31 + charCode` 对**定长**输入是仿射的 ⟹ 加盐只是把
  //    哈希整体平移一个常数（实测差值只有 1 种），既不多造也不消掉碰撞，买到的只有「与
  //    `recipeIndex % 308` 不是同一个切片」这一条。
  //
  // 🔴 **别从上面那条推出「siteId 不同 ⟹ 派出来的三个数一定不同」** —— 这一行此前就是这么许诺的，
  //    而它是假的：双射过不了 `% 10 / % 9 / % 5`，三张表一共只有 450 种组合，反例
  //    `site-0000004a` 与 `site-000000a4` 拿到的是同一组数。它的前提也错 —— 生产的 siteId 是
  //    `site-` + 8 位 hex = 13 个字符（`manager/db.go:1550`，#711 起冻结），不是 8 个 hex。
  //    这一段要的性质是**确定性**，不是唯一性；判据、读数和那个 ≈ 1/444 的因子都在
  //    `lib/site-tweaks.js` 的 `tweaksForSite` 头上（#1120 QA1 P2 / QA3 / PM 各自量过）。
  //
  // 🔴 每一轴的取值表都**挖掉了中性点**，不是「至少一轴非中性」那种弱保证。为什么必须挖：
  //    `{hueShift:0, radiusScale:1, densityScale:1}` 时 `buildCustomCss` 返回空串，
  //    `sync-config.js` 会**删掉** `site/custom.css`，产物与「从来没有过 tweaks 的站」逐字节相同
  //    —— 那个站是真的一点微扰都没有，而且没有任何东西会报错（PM 在本票裁定里量过这一格）。
  //
  // 🔴 三张档位表 + 派生本身住在 `scripts/lib/site-tweaks.js`，**不在本文件里**：那三张表要被
  //    `site-tweaks.test.js` 逐档钉住（「每一档都落在 `TWEAK_BOUNDS` 里」＋「一档都不是中性」），
  //    而一个函数作用域里的表测试够不到 —— 钉不住的表等于没钉。那个文件头也写着为什么它不能反过来
  //    塞进 `scripts/tweaks.js`（那份是要送进浏览器的，多一个 require 就让 dashboard 构建报错）。
  const tweakPick = tweaksForSite(siteId);
  const siteTweaks = tweakPick.tweaks;
  if (siteTweaks) {
    debug(`[tweaks] 这个站的微扰（siteId ${siteId} 算出来的，重建不变）：`
      + Object.entries(siteTweaks).map(([k, v]) => `${k}=${v}`).join(' · '));
  } else {
    // 今天到不了（表都在边界内、都挖了中性点）。真到了就点名，而不是静默少一个键。
    debug(`[tweaks] 🔴 派生出来的微扰不能用，这个站不带 tweaks（= #1006 之前的行为）：`
      + `${JSON.stringify(tweakPick.derived)} · ${tweakPick.why}`);
  }

  // #924: record which theme this site got. `applied: false` = the owner never actively
  // changed themes, so the registry's layout preferences stay out of the build and the page
  // JSON's own variants keep deciding — same output as before this file knew about themes.
  // The Edit page's "change theme" flow (#925) rewrites this file with applied: true.
  //
  // 🔴 #1064: 顺带记下**这套主题自己那张形态样式表**（`public/themes/<themeId>.css`）。在这之前
  // 没有任何代码往 `css` 写值，所以每个站建出来都没有形态规则 —— 池子里的皮到不了任何一个站。
  // 配对靠同名，判据在 `scripts/theme-sheet.js`（它也解释了为什么这一问不能在这里就地写成一行）。
  // 🔴 没有同名表的主题**整个字段不写**，产出的 theme.json 与这张票之前逐字节相同 —— 今天注册表
  // 那 30 套一套都没有自己的表，所以本行今天不改变任何一个站；#1016 把 80 套（表与 id 同名）放进
  // 注册表那一刻它才开始有值。
  // 🔴 #1120: `tweaks` 就写在这里 —— 全文件**只此一处**写 `theme.json`（两个分支只差 `css`），
  // 所以「一站一次」这件事是由落点保证的，不是由纪律保证的。派生不出来（`tweaksForSite` 回 null）
  // 时**整个键不写**，产出的 theme.json 与本票之前逐字节相同。
  // 📌 `applied` 保持 `false`，本票一个字都不动它：微扰**不经过**那个开关 —— `sync-config.js` 读
  // tweaks 的那段是个裸块（不在任何 `if (appliedThemeId)` 里），实测 `applied:false` 的站照样产出
  // `custom.css`（PM 在本票裁定里量的，我自己也复量了，读数在交接留言）。翻它会让注册表接管调色板，
  // 那是 #1121 在管的另一件事。
  const themeSheet = sheetNameForTheme(themeName, rootDir);
  fs.writeFileSync(
    path.join(siteDir, 'theme.json'),
    JSON.stringify(
      {
        themeId: themeName,
        applied: false,
        ...(themeSheet ? { css: themeSheet } : {}),
        ...(siteTweaks ? { tweaks: siteTweaks } : {}),
      },
      null, 2) + '\n'
  );

  // ── Skip AI mode: use demo config ──
  if (input.skipAI) {
    progress('Setting up demo site (no AI)...', 10);
    const content = getDemoConfig(siteId);
    // #984: the demo site wears the theme we just picked, same registry the AI path reads.
    // getDemoConfig's own palette is a hardcoded blue that matches no registered theme, so
    // without this the themeId in theme.json would name a theme the site isn't using — the
    // Theme dialog's Current mark would be pointing at the wrong one.
    // settings comes along for the same reason it does on the AI path (#986): a site that was
    // never re-dressed in the dashboard would otherwise miss the theme's rounding/spacing/shadows
    // until someone applied a theme once.
    content.brand.colors = theme.colors;
    content.brand.fonts = theme.fonts;
    content.brand.settings = theme.settings;
    // TICKET-136: getDemoConfig returns name as a string; convert to Record
    // keyed by defaultLocale and merge in any brandNameByLocale overrides so
    // brand.json matches the per-locale schema even in skipAI fixtures.
    const skipAiPrimaryName = companyName || (typeof content.brand.name === 'string' ? content.brand.name : 'Demo Company');
    content.brand.name = { [defaultLocale]: skipAiPrimaryName };
    for (const [loc, name] of Object.entries(brandNameByLocale)) {
      const norm = normalizeLocale(loc);
      if (norm && typeof name === 'string' && name.trim()) {
        content.brand.name[norm] = name.trim();
      }
    }
    writeSiteConfig(siteDir, content, defaultLocale);
    debug(`Demo site config written to site/`);
    // TICKET-122b: in skipAI mode, secondary locales get a verbatim copy of the
    // primary demo content (no real translation), with seo.locale rewritten so
    // the BCP-47 marker reflects the secondary locale. Lets schema/build pipeline
    // round-trip multi-locale layouts without burning tokens.
    for (const secLocale of normalizedSecondaryLocales) {
      const secContent = {
        brand: { tagline: content.brand.tagline },
        seo: { ...content.seo, locale: localeMapForBcp47(secLocale) },
        services: content.services,
        navigation: content.navigation,
        pages: content.pages,
        tierDistribution: { 1: 0, 2: 0, 3: content.pages.length },
      };
      writeSecondaryLocaleConfig(siteDir, secContent, secLocale, content.brand);
      debug(`Demo secondary locale "${secLocale}" written (verbatim copy of primary)`);
    }
    if (input.repoUrl) {
      progress('Committing to git...', 80);
      try {
        const gitOpts = { cwd: rootDir, stdio: 'pipe' };
        // TICKET-170: include public/ so AI-generated logo (159) + business photos
        // (161/164) persist into the per-site git repo. Without this, container
        // restart → fresh clone → public/ empty → preview / deploy break image.
        execSync('git add site/ public/', gitOpts);
        execSync(`git commit -m "Generate site: ${siteId} (demo)"`, gitOpts);
        // TICKET-142: emit chat-message anchor for the initial commit so the
        // dashboard's first user edit can Revert back to the AI-generated site.
        const initialCommitHash = execSync('git rev-parse --short HEAD', gitOpts).toString().trim();
        emit('chat-message', { role: 'system', content: 'Site created', commit_hash: initialCommitHash });
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

  progress('AI is designing your website...', 15);

  // Language map
  // TICKET-169: 'zh' stays Simplified Chinese (historic default, preserves
  // existing sites). 'zh-tw' is the new Traditional Chinese variant — maps to
  // languageName 'Traditional Chinese' so downstream prompt builder can detect
  // and add Simplified-vs-Traditional disambiguation hint.
  const langMap = {
    'en': 'English', 'zh': 'Chinese', 'zh-tw': 'Traditional Chinese', 'fr': 'French', 'es': 'Spanish',
    'ja': 'Japanese', 'ko': 'Korean', 'de': 'German', 'it': 'Italian',
    'pt': 'Portuguese', 'ru': 'Russian', 'vi': 'Vietnamese', 'ar': 'Arabic',
    'hi': 'Hindi', 'th': 'Thai',
  };
  // TICKET-122a (5th round, QA3 feedback): use defaultLocale (already normalized to
  // ISO code via langMapInverse + toLowerCase above) so natural-name inputs like
  // 'Chinese' / 'chinese' / 'CHINESE' all resolve to languageName='Chinese' instead
  // of falling back to 'English'. Symmetric to defaultLocale derivation.
  const languageName = langMap[defaultLocale] || 'English';

  // ── Call 1: Generate base site (brand + seo + services + regular pages) ──
  const content = await generateContent({
    companyName, industry, location, address, phone, email,
    services, usp, targetCustomers, brandDescription,
    theme, languageName, refSite, refPrefs, refAnalysis,
    reviews, onlinePresence, hours, priceRange, uploadedImages, logoUrl,
    // #1134（来源 #1139）—— 这个站会不会有服务子页。判据跟 Call 2 真去生成那些页时用的是
    // 同一个函数,不是第二份实现。
    hasKeywordPages: keywordPagesFrom(keywords).keywordPagesList.length > 0,
    // TICKET-140: pass per-locale brand-name inputs through so generateContent
    // can assemble brand.name as a Record<locale, string> (136 regression fix).
    defaultLocale, brandNameByLocale,
    // TICKET-159 / TICKET-160: container's create-site.js calls Nano Banana
    // via the same generativelanguage.googleapis.com endpoint as Manager's
    // Gemini; forward the key through opts so generateLogoViaNanoBanana can
    // pick it up.
    geminiApiKey,
    // #1034: 这个站的首页开场配方（null = 本次不参与，理由在上面 debug 那行里）
    homeRecipe,
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
  const { servicesWithKeywords, keywordPagesList } = keywordPagesFrom(keywords);

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

  // #1097 — 首屏要不要带一个能留联系方式的表单（Chris 2026-08-19「跟着行业走」）。
  //
  // 落在写盘之前、`content` 还在内存里的这一刻，是因为这三样东西正好都在这个作用域里：`industry`
  // （:754 已经 fatal 挡过空值）· `theme`（:838，兜底要读的 `supports.hero` 挂在它上面）· `content.pages`。
  // 写在 `sections[]` 那个条目上就够了 —— `pageWithBlocks` 在写盘那一刻把它搬进 `blocks[]`
  // （`blocks.js` 里那行 `if (typeof s.block_layout === 'string') b.block_layout = s.block_layout;`）。
  //
  // 🔴 `reason` 必须打出来：不给表单有四个完全不同的答案，而它们在产物里长得一模一样。
  const heroForm = applyHeroLeadForm({ content, industry, theme });
  debug(`[hero lead form] ${heroForm.applied ? '写了' : '没写'} block_layout="with-form" — ${heroForm.reason}`);

  writeSiteConfig(siteDir, content, defaultLocale);

  // ─── TICKET-122b: Secondary locale generation ────────────────────────────────
  // After primary locale ships, generate secondary locales sequentially. Each
  // locale runs independently — failure of one doesn't abort the others or the
  // primary. retryWithBackoff handles transient errors; final failure for a
  // locale emits a `secondary-locale-failed` event that Manager surfaces to
  // dashboard so the user sees a retry button (122b2 scope).
  const secondaryFailures = [];
  if (normalizedSecondaryLocales.length > 0) {
    progress('Generating secondary locales...', 72);
    for (let i = 0; i < normalizedSecondaryLocales.length; i++) {
      const secLocale = normalizedSecondaryLocales[i];
      const secLanguageName = langMap[secLocale] || secLocale;
      const pct = 72 + Math.round(((i + 1) / normalizedSecondaryLocales.length) * 8); // 72→80
      progress(`Generating secondary locale: ${secLanguageName}...`, pct);
      try {
        const secContent = await generateSecondaryLocale({
          primaryContent: content,
          primaryLanguageName: languageName,
          secondaryLocale: secLocale,
          secondaryLanguageName: secLanguageName,
          secondaryKeywordsByPage: secondaryLocaleKeywords[secLocale] || {},
          industry, location, companyName,
        });
        writeSecondaryLocaleConfig(siteDir, secContent, secLocale, content.brand);
        debug(`Secondary locale "${secLocale}" generated (${secContent.pages.length} pages, tier dist: ${JSON.stringify(secContent.tierDistribution)})`);
        emit('secondary-locale-success', {
          locale: secLocale,
          pageCount: secContent.pages.length,
          tierDistribution: secContent.tierDistribution,
        });
      } catch (err) {
        debug(`Secondary locale "${secLocale}" failed after retries: ${err.message}`);
        secondaryFailures.push({ locale: secLocale, error: err.message });
        emit('secondary-locale-failed', { locale: secLocale, error: err.message });
      }
    }
  }

  // ─── Git Commit (push is handled async by entrypoint.sh once the preview answers) ─
  const { repoUrl } = input;
  if (repoUrl) {
    progress('Committing to git...', 80);
    try {
      const gitOpts = { cwd: rootDir, stdio: 'pipe' };
      // TICKET-170: include public/ so AI-generated logo (159) + business photos
      // (161/164) persist into the per-site git repo. Without this, container
      // restart → fresh clone → public/ empty → preview / deploy break image.
      execSync('git add site/ public/', gitOpts);
      execSync(`git commit -m "Generate site: ${siteId}"`, gitOpts);
      // TICKET-142: emit chat-message anchor for the initial commit so the
      // dashboard's first user edit can Revert back to the AI-generated site.
      const initialCommitHash = execSync('git rev-parse --short HEAD', gitOpts).toString().trim();
      emit('chat-message', { role: 'system', content: 'Site created', commit_hash: initialCommitHash });
      const repoPageUrl = repoUrl.replace(/\.git$/, '');
      emit('repo', { url: repoPageUrl });
      debug('Committed site config, push deferred to entrypoint.sh');
    } catch (e) {
      debug('Git commit failed:', e.stderr?.toString() || e.message);
      fatal('Git commit failed: ' + (e.stderr?.toString()?.split('\n')[0] || e.message));
    }
  }

  // Done — entrypoint.sh handles sync-config + the static preview (`next build` → `serve out`)
  progress('Site generated, starting preview...', 85);
}

// ─── TICKET-122b: Secondary Locale Generation ────────────────────────────────

// Generates a complete secondary locale version of the primary content via Claude.
// Per-page translation is wrapped in retryWithBackoff (3 attempts, 5s/15s/45s).
// brand.tagline + seo + services + navigation are batched in a single Claude call
// to keep round-trips proportional to pages, not page+4. tierDistribution is
// returned for observability (122b2 will wire into operation_runs metadata).
//
// On total failure (any retried call still throws), this throws upward; caller
// in main() catches per-locale and emits secondary-locale-failed event.
async function generateSecondaryLocale({
  primaryContent,
  primaryLanguageName,
  secondaryLocale,
  secondaryLanguageName,
  secondaryKeywordsByPage,
  industry,
  location,
  companyName,
}) {
  const client = new Anthropic();

  // Step 1: per-page translation (each retried independently).
  const tierDistribution = { 1: 0, 2: 0, 3: 0 };
  const secondaryPages = [];
  for (const page of primaryContent.pages) {
    const pageKeywords = (secondaryKeywordsByPage && secondaryKeywordsByPage[page.slug]) || [];
    const tier = computeTier(pageKeywords);
    tierDistribution[tier]++;

    const translated = await retryWithBackoff(
      () => translatePageWithClaude({
        client, page, tier, keywords: pageKeywords,
        primaryLanguageName, secondaryLanguageName, secondaryLocale,
        industry, location, companyName,
      }),
      { retries: 3, backoff: [5000, 15000, 45000], label: `translate page ${page.slug} → ${secondaryLocale}` }
    );
    secondaryPages.push(translated);
  }

  // Step 2: brand.tagline + seo + services + navigation batch translation.
  const supportingFiles = await retryWithBackoff(
    () => translateSupportingFilesWithClaude({
      client,
      brand: primaryContent.brand,
      seo: primaryContent.seo,
      services: primaryContent.services,
      navigation: primaryContent.navigation,
      primaryLanguageName, secondaryLanguageName, secondaryLocale,
      industry, location, companyName,
    }),
    { retries: 3, backoff: [5000, 15000, 45000], label: `translate supporting files → ${secondaryLocale}` }
  );

  return {
    brand: { tagline: supportingFiles.brandTagline },
    seo: supportingFiles.seo,
    services: supportingFiles.services,
    navigation: supportingFiles.navigation,
    pages: secondaryPages,
    tierDistribution,
  };
}

// Single Claude call to translate one page. Schema preserved verbatim (slug,
// section.type, section.data shape) — only user-visible content fields translated.
// Tier 1: real keywords MUST appear in 5 SEO touchpoints. Tier 2: use available
// keywords + supplement with translation. Tier 3: pure translation, AI judgment.
async function translatePageWithClaude({
  client, page, tier, keywords, primaryLanguageName, secondaryLanguageName, secondaryLocale, industry, location, companyName,
}) {
  const tierInstruction =
    tier === 1
      ? `Tier 1 (rich keyword data): USE the provided keywords below in at least one SEO touchpoint each — meta title/description (page.title/page.description), section headlines (sections[].data.headline / .subheadline / .title), alt text where applicable, anchor text for internal links. Aim for natural integration, not stuffing.`
      : tier === 2
      ? `Tier 2 (sparse keyword data): USE the provided keywords below where natural; supplement with SEO-friendly translation when keywords don't cover all touchpoints.`
      : `Tier 3 (no keyword data): pure SEO-friendly translation using your judgment for the ${secondaryLanguageName} market. Prefer natural ${secondaryLanguageName} phrasing over literal translation; preserve brand voice.`;

  const keywordList = keywords.length > 0
    ? keywords.map(k => `- ${k.keyword}${typeof k.volume === 'number' ? ` (${k.volume}/mo)` : ''}`).join('\n')
    : '(none)';

  const prompt = `You are translating a website page from ${primaryLanguageName} to ${secondaryLanguageName}.${chineseVariantHint(secondaryLanguageName)} For SEO.

INDUSTRY: ${industry}
LOCATION: ${location}
COMPANY: ${companyName}

PRIMARY LOCALE PAGE (reference for content/brand/structure):
\`\`\`json
${JSON.stringify(page, null, 2)}
\`\`\`

SECONDARY LOCALE KEYWORDS (Tier ${tier}):
${keywordList}

INSTRUCTIONS:
- CRITICAL BRAND NAME RULE (TICKET-137): The brand name "${companyName}" MUST appear LITERALLY VERBATIM in all translated content. DO NOT translate, transliterate, or localize the brand name even when generating ${secondaryLanguageName} text. The exact characters of "${companyName}" (including apostrophes / capitalization / special chars) must be preserved. Examples:
    ✗ WRONG: "Happy Paws宠物美容" (translated brand to zh) / "McDonalds" (dropped ') / "麦当劳 has been serving"
    ✓ RIGHT: "Happy Paws Pet Grooming 是您的最佳选择" (English brand verbatim in zh sentence) / "McDonald's"
- ${tierInstruction}
- Translate ALL user-visible string fields to ${secondaryLanguageName}: title, description, navLabel, every section's headline/subheadline/title/text/items/labels/etc.
- DO NOT translate: page.slug (kept ASCII), page.changeFrequency, page.priority, page.navOrder, section.type, section.data field names (keys), URLs/hrefs (kept as-is).
- DO NOT add new sections or fields. Schema must round-trip identically.
- Output: a JSON object matching the input page schema exactly, with content translated.
- Return ONLY the JSON object, no preamble, no \`\`\`json fence.`;

  // TICKET-132: callAIWithRetry handles JSON.parse failures (≤3 attempts);
  // max_tokens and other errors throw, escaping to the outer retryWithBackoff.
  const { parsed: translated } = await callAIWithRetry({
    client,
    baseOptions: { model, max_tokens: maxTokens, messages: [{ role: 'user', content: prompt }] },
    costContext: {
      operation: 'translate-secondary-locale',
      detail: `${page.slug} → ${secondaryLocale} (Tier ${tier})`,
      pricing,
    },
    label: `translate page ${page.slug}`,
  });
  // Defensive: preserve immutable fields (slug, type, etc.) even if Claude misbehaves.
  translated.slug = page.slug;
  translated.changeFrequency = page.changeFrequency;
  translated.priority = page.priority;
  translated.navOrder = page.navOrder;
  if (Array.isArray(translated.sections) && Array.isArray(page.sections)) {
    for (let i = 0; i < translated.sections.length && i < page.sections.length; i++) {
      if (translated.sections[i] && page.sections[i]) {
        translated.sections[i].type = page.sections[i].type;
      }
    }
  }
  return translated;
}

// Batch-translate brand.tagline + seo + services + navigation in one Claude call.
// These are smaller than pages and translation-only (no Tier reasoning needed).
async function translateSupportingFilesWithClaude({
  client, brand, seo, services, navigation, primaryLanguageName, secondaryLanguageName, secondaryLocale, industry, location, companyName,
}) {
  const prompt = `You are translating website supporting config from ${primaryLanguageName} to ${secondaryLanguageName}.${chineseVariantHint(secondaryLanguageName)} For SEO.

INDUSTRY: ${industry}
LOCATION: ${location}
COMPANY: ${companyName}

PRIMARY LOCALE INPUTS:
\`\`\`json
${JSON.stringify({
  brandTagline: brand.tagline,
  seo: { siteTitle: seo.siteTitle, siteDescription: seo.siteDescription, keywords: seo.keywords, schema: { offerCatalogName: seo.schema?.offerCatalogName, priceRange: seo.schema?.priceRange } },
  services: services.map(s => ({ id: s.id, name: s.name, shortDescription: s.shortDescription, fullDescription: s.fullDescription, features: s.features, products: s.products })),
  navigation: {
    header: { cta: navigation.header.cta },
    footer: {
      description: navigation.footer.description,
      copyright: navigation.footer.copyright,
      // TICKET-135: include columns so AI can translate column.title (e.g.
      // "Quick Links" → "快速链接") and links[*].label.
      columns: (navigation.footer.columns || []).map(c => ({
        title: c.title,
        links: (c.links || []).map(l => ({ label: l.label, href: l.href })),
      })),
    },
  },
}, null, 2)}
\`\`\`

INSTRUCTIONS:
- CRITICAL BRAND NAME RULE (TICKET-137): The brand name "${companyName}" MUST appear LITERALLY VERBATIM in any translated string that references the brand (footer description, copyright, seo.siteTitle/siteDescription, navigation.header.cta.label, etc). DO NOT translate, transliterate, or localize the brand name in ${secondaryLanguageName}. Examples:
    ✗ WRONG: "Happy Paws宠物美容" / "麦当劳" / "McDonalds" (dropped apostrophe)
    ✓ RIGHT: "Happy Paws Pet Grooming" / "McDonald's" (verbatim regardless of locale)
- Translate ALL user-visible string fields to ${secondaryLanguageName}, preserving brand voice and SEO intent.
- DO NOT translate: service.id (kept ASCII slug), navigation.header.cta.href (URL), navigation.footer.columns[*].links[*].href (URL).
- TICKET-135: navigation.footer.columns[*].title and links[*].label MUST be translated too (e.g. "Quick Links" → native locale word, "Home" → "首页" etc).
- For seo.keywords: produce a SEO-friendly comma-separated keyword string in ${secondaryLanguageName} (you may add 1-2 high-volume locale-native keywords if natural).
- Output JSON shape:
\`\`\`json
{
  "brandTagline": "<translated>",
  "seo": { "siteTitle": "...", "siteDescription": "...", "keywords": "...", "schema": { "offerCatalogName": "...", "priceRange": "..." } },
  "services": [ { "id": "<unchanged>", "name": "...", "shortDescription": "...", "fullDescription": "...", "features": [...], "products": [...] }, ... ],
  "navigation": {
    "header": { "cta": { "label": "...", "href": "<unchanged>" } },
    "footer": {
      "description": "...",
      "copyright": "...",
      "columns": [ { "title": "...", "links": [ { "label": "...", "href": "<unchanged>" }, ... ] }, ... ]
    }
  }
}
\`\`\`
- Return ONLY the JSON object, no preamble, no \`\`\`json fence.`;

  // TICKET-132: callAIWithRetry handles JSON.parse failures; max_tokens and
  // other errors throw to the outer retryWithBackoff wrapping the caller.
  const { parsed } = await callAIWithRetry({
    client,
    baseOptions: { model, max_tokens: maxTokens, messages: [{ role: 'user', content: prompt }] },
    costContext: {
      operation: 'translate-secondary-locale',
      detail: `supporting files → ${secondaryLocale}`,
      pricing,
    },
    label: 'translate supporting files',
  });

  // Build output, defensively preserving immutable fields.
  const outServices = services.map((origSvc, i) => {
    const aiSvc = (parsed.services && parsed.services[i]) || {};
    return {
      ...origSvc,
      name: aiSvc.name || origSvc.name,
      shortDescription: aiSvc.shortDescription || origSvc.shortDescription,
      fullDescription: aiSvc.fullDescription || origSvc.fullDescription,
      features: Array.isArray(aiSvc.features) ? aiSvc.features : origSvc.features,
      products: Array.isArray(aiSvc.products) ? aiSvc.products : origSvc.products,
    };
  });
  const outSeo = {
    ...seo,
    siteTitle: parsed.seo?.siteTitle || seo.siteTitle,
    siteDescription: parsed.seo?.siteDescription || seo.siteDescription,
    keywords: parsed.seo?.keywords || seo.keywords,
    schema: {
      ...seo.schema,
      offerCatalogName: parsed.seo?.schema?.offerCatalogName || seo.schema?.offerCatalogName,
    },
    locale: localeMapForBcp47(secondaryLocale),
  };
  const outNavigation = {
    ...navigation,
    header: {
      ...navigation.header,
      cta: {
        ...navigation.header.cta,
        label: parsed.navigation?.header?.cta?.label || navigation.header.cta.label,
      },
    },
    footer: {
      ...navigation.footer,
      description: parsed.navigation?.footer?.description || navigation.footer.description,
      copyright: parsed.navigation?.footer?.copyright || navigation.footer.copyright,
      // TICKET-135: merge translated footer columns (title + links[].label).
      // Defensive: keep original column shape (icons, slug-keyed identity) and
      // only swap in translated text fields. href is never translated.
      columns: (navigation.footer.columns || []).map((col, i) => {
        const aiCol = parsed.navigation?.footer?.columns?.[i];
        return {
          ...col,
          title: aiCol?.title || col.title,
          links: Array.isArray(col.links)
            ? col.links.map((link, j) => ({
                ...link,
                label: aiCol?.links?.[j]?.label || link.label,
              }))
            : col.links,
        };
      }),
    },
  };

  return {
    brandTagline: parsed.brandTagline || (typeof brand.tagline === 'string' ? brand.tagline : ''),
    seo: outSeo,
    services: outServices,
    navigation: outNavigation,
  };
}

// Map ISO code → BCP-47-style locale string for seo.locale (e.g. zh → zh_CN, fr → fr_CA).
// Defaults pick the most common variant per locale; can be overridden later.
function localeMapForBcp47(iso) {
  const map = {
    // TICKET-169: 'zh' (Simplified) and 'zh-tw' (Traditional) map to canonical
    // BCP-47 region-suffixed forms used in hreflang / JsonLd inLanguage.
    en: 'en_CA', zh: 'zh_CN', 'zh-tw': 'zh_TW', fr: 'fr_CA', es: 'es_MX', ja: 'ja_JP',
    ko: 'ko_KR', de: 'de_DE', it: 'it_IT', pt: 'pt_BR', ru: 'ru_RU',
    vi: 'vi_VN', ar: 'ar_SA', hi: 'hi_IN', th: 'th_TH',
  };
  return map[iso] || `${iso}_${iso.toUpperCase()}`;
}

// Writes a fully translated secondary locale to site/<secondaryLocale>/. Mirrors
// writeSiteConfig structure but: (a) merges brand.tagline into existing site/brand.json
// (Record<locale, string>) instead of overwriting, (b) uses secondary-locale-specific
// outputs for seo/services/navigation/pages.
function writeSecondaryLocaleConfig(siteDir, secContent, secondaryLocale, primaryBrand) {
  const localeDir = path.join(siteDir, secondaryLocale);
  fs.mkdirSync(localeDir, { recursive: true });

  // Merge brand.tagline into root site/brand.json (Record<locale, string>).
  const brandPath = path.join(siteDir, 'brand.json');
  const existingBrand = JSON.parse(fs.readFileSync(brandPath, 'utf-8'));
  if (typeof existingBrand.tagline === 'string') {
    existingBrand.tagline = { [Object.keys(primaryBrand.tagline || {})[0] || 'en']: existingBrand.tagline };
  }
  if (typeof existingBrand.tagline !== 'object' || existingBrand.tagline === null || Array.isArray(existingBrand.tagline)) {
    existingBrand.tagline = {};
  }
  existingBrand.tagline[secondaryLocale] = secContent.brand?.tagline || '';
  fs.writeFileSync(brandPath, JSON.stringify(existingBrand, null, 2) + '\n');

  // Per-locale config files.
  const localeFiles = {
    'navigation.json': secContent.navigation,
    'seo.json': secContent.seo,
    'services.json': secContent.services,
  };
  for (const [filename, data] of Object.entries(localeFiles)) {
    fs.writeFileSync(path.join(localeDir, filename), JSON.stringify(data, null, 2) + '\n');
  }

  // pages → <secondaryLocale>/pages/<slug>.json（#998：同上，写盘时转成 blocks 形状）
  for (const page of secContent.pages) {
    const pagePath = path.join(localeDir, 'pages', `${page.slug}.json`);
    fs.mkdirSync(path.dirname(pagePath), { recursive: true });
    fs.writeFileSync(pagePath, JSON.stringify(pageWithBlocks(page), null, 2) + '\n');
  }

  debug(`Secondary locale config written: site/${secondaryLocale}/ (${secContent.pages.length} pages)`);
}

// ─── Write Site Config Files ─────────────────────────────────────────────────

function writeSiteConfig(siteDir, content, defaultLocale) {
  // TICKET-122a: multi-locale schema (layout B — locale top-level subtree).
  //   brand.json:           cross-locale shared (kept at site/ root); brand.tagline wrapped to { [defaultLocale]: string } here
  //   <locale>/seo.json
  //   <locale>/services.json
  //   <locale>/navigation.json (sync-config.js regenerates header.links/footer.columns but preserves cta.href — so we still write it here as init)
  //   <locale>/pages/<slug>.json
  const localeDir = path.join(siteDir, defaultLocale);
  fs.mkdirSync(localeDir, { recursive: true });

  // brand: cross-locale shared, wrap tagline to i18n object
  const brand = { ...content.brand };
  if (typeof brand.tagline === 'string') {
    brand.tagline = { [defaultLocale]: brand.tagline };
  }
  fs.writeFileSync(
    path.join(siteDir, 'brand.json'),
    JSON.stringify(brand, null, 2) + '\n'
  );

  // per-locale config files
  const localeFiles = {
    'navigation.json': content.navigation,
    'seo.json': content.seo,
    'services.json': content.services,
  };
  for (const [filename, data] of Object.entries(localeFiles)) {
    fs.writeFileSync(
      path.join(localeDir, filename),
      JSON.stringify(data, null, 2) + '\n'
    );
  }

  // TICKET-268b: every generated site must ship a REAL platform contact form (the boss wants "every
  // site"). If the AI didn't place a contact-form section anywhere, append one to the home page (else
  // the first page). Idempotent — content.pages is shared across locales, so this only injects once.
  // TICKET-268e: every generated site must have a NAV-CLICKABLE Contact page (a home-section alone is
  // easy to miss). If the AI didn't produce a `contact` page, add one with a contact-form (→ /api/leads).
  // Idempotent — content.pages is shared across locales, so this only injects once.
  if (!content.pages.some((p) => p.slug === 'contact')) {
    const maxOrder = content.pages.reduce((m, p) => Math.max(m, p.navOrder ?? 0), 0);
    content.pages.push({
      slug: 'contact', title: 'Contact Us', description: `Get in touch with ${content.brand?.name || 'us'}`,
      navLabel: 'Contact', navOrder: maxOrder + 1, changeFrequency: 'monthly', priority: 0.7,
      sections: [
        { type: 'page-header', data: { title: 'Contact Us', subtitle: "Send us a message and we'll get back to you shortly." } },
        { type: 'contact-form', data: { heading: 'Get in touch', intro: 'Leave your details and we will reach out soon.', buttonText: 'Send message' } },
      ],
    });
  }

  // #999 — 角色兜底在**写盘前**再补一次，不能只在 AI 输出那一刻补。
  // 上面这两段（268b / 268e）是脚本自己插进去的页面，它们在校验之后才出现 ⟹ 第一版实测:真 AI 建站
  // 60 个 section 里 58 个带上了 role，剩下 2 个正是 contact 页那两块。写盘前补一次覆盖全部来源。
  applyBlockRoleDefaults(content.pages);

  // pages → <locale>/pages/<slug>.json
  // #998: 磁盘上的形状是 `blocks`。转换只发生在写盘这一刻 —— 上面那些校验、参考站对照、翻译
  // 都还读 `content.pages[].sections`，形状迁移不该顺手改掉 AI 那一侧的行为。
  for (const page of content.pages) {
    const pagePath = path.join(localeDir, 'pages', `${page.slug}.json`);
    fs.mkdirSync(path.dirname(pagePath), { recursive: true });
    fs.writeFileSync(pagePath, JSON.stringify(pageWithBlocks(page), null, 2) + '\n');
  }

  debug(`Site config written to site/ (locale: ${defaultLocale})`);
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
      // PREVIEW_DOMAIN env var injected by worker/entrypoint.sh; manager populates
      // it from cfg.PreviewDomain (ai1stsite.io for prod / ai1stsite.dev for dev)
      domain: `https://${siteId}.${process.env.PREVIEW_DOMAIN || 'ai1stsite.io'}`,
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
          { type: 'contact-form', data: { heading: 'Contact us', intro: "Leave your details and we'll get back to you shortly.", buttonText: 'Send message' } }, // TICKET-268b
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
      {
        // TICKET-268e: a nav-clickable Contact page (not just a home-page section) so visitors have an
        // obvious way to reach out → the form POSTs to /api/leads → the owner's Customers list.
        slug: 'contact', title: 'Contact Us', description: 'Get in touch with Demo Company', navLabel: 'Contact', navOrder: 4, changeFrequency: 'monthly', priority: 0.7,
        sections: [
          { type: 'page-header', data: { title: 'Contact Us', subtitle: "Send us a message and we'll get back to you shortly." } },
          { type: 'contact-form', data: { heading: 'Get in touch', intro: 'Leave your details and we will reach out soon.', buttonText: 'Send message' } },
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
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; AI1stBot/1.0)' },
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
            headers: { 'User-Agent': 'Mozilla/5.0 (compatible; AI1stBot/1.0)' },
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

// ── #1139 / #1134 —— 「这个站会不会有服务子页」只有一个算法 ──────────────────────────────────────
//
// 子页面**只**由关键词矩阵产生(`nestedSlug = <服务>/<关键词>`),所以「有没有子页」== 「选中的
// 非主关键词有没有」。两个地方要问这件事:① Call 2 真去生成那些页;② Call 1 的提示词要不要让 AI 给
// 服务详情页加 `service-related-pages` 块(#1139:那个块只在真有子页时才渲染,否则 `return null`)。
// 🔴 **抽成一个函数是承重的,不是整理**:两份实现必然漂,而漂的方向是「提示词说这个站有子页、
//    生成那边说没有」——那正是 #1139 量到的形状(66 个互异站里 221 个实例只有 14 个渲染出卡片)。
function keywordPagesFrom(keywords) {
  const servicesWithKeywords = [];
  for (const [serviceName, kwList] of Object.entries(keywords || {})) {
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
  return { servicesWithKeywords, keywordPagesList };
}

async function generateContent(opts) {
  const {
    companyName, industry, location, address, phone, email,
    services, usp, targetCustomers, brandDescription,
    theme, languageName, refSite, refPrefs = [], refAnalysis = null,
    reviews = [], onlinePresence = {}, hours, priceRange, uploadedImages = [],
    logoUrl = '',
    // TICKET-140: per-locale brand inputs (136 regression). defaultLocale is
    // always set by the main-scope `normalizeLocale(language) || 'en'`, so no
    // default is needed; brandNameByLocale = {} guards against the dashboard
    // omitting the field entirely.
    defaultLocale, brandNameByLocale = {},
    // TICKET-159 / TICKET-160: Nano Banana logo gen key — forwarded from main
    // scope (stdin payload). Empty string when not configured →
    // generateLogoViaNanoBanana throws + caller falls back to text logo.
    geminiApiKey = '',
    // #1034: 这个站的首页开场配方。null = 不参与（payload 关了 / skipAI / 用户点名照抄参照站布局），
    // 那时下面每一处都逐字回到改动之前 —— 判据是 `homepage-recipe.test.js` 那一格拿
    // `git show origin/main:` 的提示词跟 recipe=null 的提示词逐字节比。
    homeRecipe = null,
    // #1134（来源 #1139）—— 这个站会不会有服务子页(关键词矩阵)。
    // 🔴 缺省 **true** 是刻意的:不传这个字段的调用方拿到的提示词跟改动之前**逐字节相同**
    //    (`homepage-recipe.test.js` ⑥ 那格比的就是这个)。只有明确说「这个站没有关键词页」时
    //    才把那两句拿掉。
    hasKeywordPages = true,
  } = opts;

  // TICKET-164: v2 replaces 161 v1's pre-Claude photo gen with a 2-pass
  // scan-and-fill post-Claude (below, after `ai = result.parsed`). With v2,
  // when there are no user-uploaded photos, `imagesInstruction` stays empty
  // and Claude doesn't assign any imageUrl in the sections it generates —
  // Pass 2 walks ai.pages and fills imageUrl deterministically per slot.
  const client = new Anthropic();

  const localeMap = {
    'English': 'en_CA', 'French': 'fr_CA', 'Chinese': 'zh_CN', 'Mandarin': 'zh_CN',
    'Cantonese': 'zh_HK', 'Spanish': 'es_MX', 'Portuguese': 'pt_BR', 'Japanese': 'ja_JP',
    'Korean': 'ko_KR', 'Hindi': 'hi_IN', 'Arabic': 'ar_SA', 'German': 'de_DE',
    'Italian': 'it_IT', 'Russian': 'ru_RU', 'Vietnamese': 'vi_VN', 'Tagalog': 'tl_PH',
    'Thai': 'th_TH', 'Punjabi': 'pa_IN', 'Urdu': 'ur_PK', 'Tamil': 'ta_IN',
  };

  const languageInstruction = languageName !== 'English'
    ? `\nLANGUAGE: Write ALL content in ${languageName}.${chineseVariantHint(languageName)} This includes: taglines, descriptions, headlines, subheadlines, testimonial quotes, FAQ answers, service names, navigation labels, page titles, meta descriptions, keywords, and all other user-facing text. Only JSON keys and technical values (slugs, hrefs, icon names, variant names, section type names) should remain in English.\n`
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
- Each page needs 5-7 sections: page-header, content-split, process-steps OR benefits-list, faq-accordion,${hasKeywordPages ? ' service-related-pages,' : ''} cta-banner
- page-header breadcrumbs: [{label:"Home",href:"/"},{label:"Services",href:"/services"},{label:"{Service Name}"}]${hasKeywordPages ? `
- service-related-pages data: { serviceSlug: "{service-id}", headline: "Related {Service} Topics" }` : ''}
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
- If there are more sections than images, **OMIT the imageUrl field entirely** (do not write the key). Do NOT invent placeholder strings like "gradient-about", "tbd", "placeholder", or any descriptive name — only valid paths starting with "/" or "http(s)://" are acceptable. The template will render a gradient automatically when imageUrl is absent.
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

CRITICAL BRAND NAME RULE (TICKET-137):
The brand name "${companyName}" is canonical and MUST appear LITERALLY VERBATIM in all
generated content — hero headlines, subtitles, page descriptions, footer description,
copyright, breadcrumbs, CTA text, and ANY user-visible string that references the brand.

DO NOT translate, transliterate, localize, or create alternative versions of the brand name.
This rule applies in ALL languages — even when the surrounding text is non-English, the brand
name MUST remain in its original "${companyName}" form, INCLUDING all apostrophes, capitalization,
and special characters.

Examples — WRONG (DO NOT generate):
  ✗ "Happy Paws宠物美容 是您的最佳选择" (translated brand name in zh)
  ✗ "麦当劳 has been serving" (translated brand name in en sentence)
  ✗ "Coca-Cola 可口可乐 of course" (mixing original + translated)
  ✗ "Bienvenido a McDonalds" (apostrophe dropped from "McDonald's")

Examples — RIGHT:
  ✓ "Happy Paws Pet Grooming 是您的最佳选择" (English brand verbatim in zh sentence)
  ✓ "McDonald's has been serving" (verbatim, exact apostrophe)
  ✓ "Welcome to Happy Paws Pet Grooming"

AVAILABLE ICONS (pick the most relevant for each service):
${availableIcons.join(', ')}

AVAILABLE SECTION TYPES AND THEIR VARIANTS:
You are a layout designer. For each page, you choose WHICH sections to include, in WHAT order, and with WHICH variant. Not every page needs every section. Mix it up based on what makes sense for this industry.

HOMEPAGE SECTIONS (pick 7-10 from these, in any order):
${blockPromptSection('homepage', undefined, { ...(homeRecipe ? { order: homeRecipe.promptOrder } : {}), ...(hasKeywordPages ? {} : { omit: ['service-related-pages'] }) })}

PAGE-SPECIFIC SECTION RULES:
${blockPromptSection('page-specific')}
- SERVICES pages must include: "page-header", "services-nav", "services-list", "cta-banner"
- QUOTE pages must include: "page-header", "quote-form"
  quote-form ${blockDataLine('quote-form')}

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
${homeRecipe ? recipePromptLines(homeRecipe)
  // #1034 — 关着的时候这一行逐字回到改动之前。它原来那份举例名单
  // (content-split / social-proof / feature-comparison / benefits-list / announcement-bar / divider)
  // 正好就是 6 个真实站实际选中的那批 —— 举例清单被当成了待办清单。开着的时候由上面那份
  // 每站不同的硬要求取代它。
  : '- Include at least TWO sections that most sites wouldn\'t have (e.g., content-split, social-proof, feature-comparison, benefits-list, announcement-bar, divider).'}
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
- Service detail pages should NOT appear in the header nav — they go in the footer only.${hasKeywordPages ? `
- Include a "service-related-pages" section on each service detail page with serviceSlug matching the service id.` : ''}`;

  emit('prompt', { name: 'Base Site', content: prompt });
  progress('AI is generating content and layout...', 25);

  progress('Waiting for AI response...', 35);

  // TICKET-132: callAIWithRetry retries up to 3 times on JSON.parse failures
  // (AI hallucinating malformed JSON). max_tokens still throws immediately
  // (prompt-size issue, retry won't help).
  const call1Start = Date.now();
  let ai, response;
  try {
    const result = await callAIWithRetry({
      client,
      baseOptions: { model, max_tokens: maxTokens, messages: [{ role: 'user', content: prompt }] },
      costContext: {
        operation: 'create-site',
        detail: 'Base site',
        pricing,
        durationStart: call1Start,
      },
      label: 'Call 1 base site',
    });
    ai = result.parsed;
    response = result.response;
  } catch (e) {
    // Preserve original debug behavior: save raw response on final failure.
    if (e.lastText) {
      const debugPath = path.join(__dirname, '..', 'site', '_ai-response.txt');
      try { fs.writeFileSync(debugPath, e.lastText); } catch {}
      debug('Raw AI response saved to:', debugPath);
    }
    // TICKET-148: classify outer fatal by error type to avoid the "Failed to
    // parse AI response as JSON" misnomer for Anthropic API overload errors.
    if (/max_tokens hit/.test(e.message || '')) {
      fatal('AI response was truncated (hit token limit). Try fewer services.');
    } else if (e.constructor?.name === 'APIError' || isRetryableApiError(e) || (e.status && e.status >= 400)) {
      fatal(`AI service error: ${e.message}`);
    } else if (e.lastText) {
      fatal(`Failed to parse AI response as JSON after retries`);
    } else {
      fatal(`AI call failed: ${e.message}`);
    }
  }
  const usage1 = response.usage || {};
  const cost1 = ((usage1.input_tokens || 0) * pricing.input + (usage1.output_tokens || 0) * pricing.output) / 1_000_000;
  const call1Duration = ((Date.now() - call1Start) / 1000).toFixed(1);
  debug(`Call 1 cost: $${cost1.toFixed(4)} (${usage1.input_tokens} in / ${usage1.output_tokens} out)`);

  // ── #999 块 manifest 校验：AI 吐回来立刻校，不合格就把问题原样退给它重来一次 ─────────────────
  //
  // 为什么在这里而不是只在构建期：这一刻还能重试，构建期只能整个站建不出来。两处跑的是同一个函数
  // （`scripts/lib/block-manifest.js`）—— 两处各写一遍必然分叉，而分叉的方向永远是「建站放过、
  // 构建期才炸」。构建期那一处是兜底，防的是有人手改 site/pages/*.json。
  //
  // 🔴 只重试一次。再失败就退出并把问题逐条打出来 —— 一直重试等于把「AI 今天不听话」变成一笔看不见
  // 的账单，而这些问题（缺必填槽、把 essential 降成 optional、行业必需的块没放）都是提示词里写着的。
  {
    const first = validateBlocks({ pages: ai.pages, industry });
    // #1013 洞 1 —— 行业是自由文本，认不出来的写法一定存在。校验器会为此产出一条 warning，
    // 而「认不出行业」跟「这个行业不需要任何特定的块」在读数上长得一模一样（两种都是零 problem）
    // ⟹ 它必须被打出来，否则日志里那句「校验通过」是关于一次没做的检查说的。
    for (const w of first.warnings) debug(`[blocks] ⚠️  ${w}`);
    debug(`[blocks] 行业 "${industry}" 认出来是: ${first.industryKeys.join(' / ') || '（一个都没认出来）'}`);
    let issues = first.problems;
    // #1034 —— 首页开场配方是**另一类**问题,跟块库的问题一起进同一次重试,但**最后不 fatal**。
    //
    // 🔴 为什么两类不能同罪:块库那些(缺必填槽 / 把 essential 降级 / 行业必需的块一个都没有)
    //    说的是「这个站建出来是坏的」;而「开场跟配方对不上」说的是「这个站跟别的站有点像」。
    //    照 #999 写在 block-manifest.js 函数头上的那条理由:硬失败把「有一块地方不理想」换成
    //    「整个站没了」。为了骨架撞车而让一次建站失败,方向反了。所以它只买一次重试。
    let skinIssues = homeRecipe ? recipeProblems(ai.pages, homeRecipe) : [];
    if (issues.length || skinIssues.length) {
      const all = [...issues, ...skinIssues];
      debug(`[blocks] 第一次输出有 ${all.length} 处不合规(块库 ${issues.length} · 首页骨架 ${skinIssues.length}),重试一次:\n  ${all.join('\n  ')}`);
      progress('Checking the layout against the block library...', 40);
      const retry = await callAIWithRetry({
        client,
        baseOptions: {
          model,
          max_tokens: maxTokens,
          messages: [
            { role: 'user', content: prompt },
            { role: 'assistant', content: JSON.stringify(ai) },
            { role: 'user', content: `Your JSON breaks the block library rules below. Fix ONLY these and `
              + `respond AGAIN with the COMPLETE JSON (same structure, no markdown fences):\n`
              + all.map((p) => `- ${p}`).join('\n') },
          ],
        },
        costContext: { operation: 'create-site', detail: 'Base site (block re-check)', pricing, durationStart: Date.now() },
        label: 'Call 1b block re-check',
      });
      const before = ai;
      ai = retry.parsed;
      issues = validateBlocks({ pages: ai.pages, industry }).problems;
      // #1034 —— 判决写在 lib/homepage-recipe.js 的 afterRetry() 里(纯函数,能测;这条分支
      // 只有 AI 参与时才走得到)。'fatal' 逐字保持改动之前的行为;'revert' 是本票新开的口子
      // 带来的风险的解药:第一次块库干净、只因骨架撞车才重试,而重试把它改坏了 —— 那就退回第一次。
      switch (afterRetry({ firstBlockProblems: first.problems.length, retryBlockProblems: issues.length })) {
        case 'fatal':
          fatal(`The generated layout still breaks the block library after a retry:\n  ${issues.join('\n  ')}`);
          break;
        case 'revert':
          debug(`[fingerprint] ⚠️  重试(只为首页骨架发起的)把块库改坏了 ${issues.length} 处,退回第一次那份输出:\n  ${issues.join('\n  ')}`);
          ai = before;
          issues = [];
          break;
        default:
          break;
      }
      skinIssues = homeRecipe ? recipeProblems(ai.pages, homeRecipe) : [];
      if (skinIssues.length) {
        // 说出来,不拦。日志里看得见,才知道配方今天有多少次没被听进去。
        debug(`[fingerprint] ⚠️  重试之后首页开场仍跟配方对不上,放行(不因为这个建不出站):\n  ${skinIssues.join('\n  ')}`);
      }
      debug('[blocks] 重试之后块库检查全部通过');
    }
    // 没写 role 的块按 manifest 的 roleDefault 补上（D4 的兜底那一半;上面那条只拦"写了但降级"）。
    const filled = applyBlockRoleDefaults(ai.pages);
    debug(`[blocks] 校验通过;按 roleDefault 补了 ${filled} 个 role`);
  }

  progress('Parsing AI response...', 42);

  progress('Assembling configuration...', 45);

  // Assemble config files
  // TICKET-136: brand.name is per-locale. Default to companyName for the
  // primary locale; merge in any explicit per-locale overrides from the
  // dashboard form (e.g. {"zh":"耐克"} for a Nike site).
  const brandName = { [defaultLocale]: companyName };
  for (const [loc, name] of Object.entries(brandNameByLocale)) {
    const norm = normalizeLocale(loc);
    if (norm && typeof name === 'string' && name.trim()) {
      brandName[norm] = name.trim();
    }
  }
  const brand = {
    name: brandName,
    tagline: ai.brand.tagline,
    logoIcon: ai.brand.logoIcon,
    logoUrl: logoUrl || '',
    colors: theme.colors,
    fonts: theme.fonts,
    // #986: 风格设定（圆角/留白/阴影/按钮形状）跟配色、字体一起烤进 brand.json，新站第一次构建就带着它。
    // 不加这行的话它们只在老板去后台换过一次装之后才出现 —— 同一套 theme，「刚建好的站」和「换过装
    // 的站」长得不一样。
    // 🔴 #1121 改了下半句：那句「换装那条路不受影响：applied 为真时 sync-config 照旧用注册表覆盖
    // 内存里这份」今天是假的。构建期已经没有任何覆盖了（sync-config.js §theme），brand.json 是唯一
    // 真相；换主题时由 worker 把新主题那套**写进这个文件**（worker/main.go 的 processThemeTask）。
    // 所以这三行（colors / fonts / settings）在建站那天写什么，就一直是这个站的样子，直到老板自己
    // 换主题 —— 包括他勾了「照抄参照站配色」拿到的那套（见下面 refPrefs 那一段），以前它会在他第一次
    // 换装时被静默盖掉。
    settings: theme.settings,
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

  // TICKET-159 + TICKET-160: Brand Site AI Logo Generation — silent build-time
  // via Nano Banana (Gemini 2.5 Flash Image). If the user uploaded a logo
  // (logoUrl non-empty), trust it has a wordmark (logoHasWordmark=true) →
  // Header/Footer skip rendering the company name text alongside the image.
  // If no upload, call Nano Banana for an icon-only logo (logoHasWordmark=false)
  // → Header/Footer DO render the company name text alongside. On any failure,
  // brand.logoUrl stays empty and template falls back to ServiceIcon + text.
  if (logoUrl) {
    brand.logoHasWordmark = true;
  } else {
    const logoStart = Date.now();
    try {
      progress('Generating AI logo via Nano Banana...', 47);
      // Reverse-lookup themeName from the theme object so we can pick the
      // right styleAdjective out of the registry (themeName itself isn't
      // passed into generateContent — only the theme object is).
      const resolvedThemeName = Object.keys(themes).find(k => themes[k] === theme) || '';
      const logoBuf = await generateLogoViaNanoBanana({
        companyName,
        industry,
        primaryColor: brand.colors.primary['500'],
        accentColor: brand.colors.accent['500'],
        themeName: resolvedThemeName,
        apiKey: geminiApiKey,
      });
      const publicDir = path.join(path.resolve(__dirname, '..'), 'public');
      fs.mkdirSync(publicDir, { recursive: true });
      // TICKET-197: deterministic canvas fill — Nano Banana doesn't reliably
      // honor "AT LEAST 70%" canvas-fill prompt instructions (see 194 V2 split
      // 19-99% occupancy). cropAndResizeLogo crops to the non-white bbox and
      // resizes so the icon occupies ~80% of the canvas. Falls back to the raw
      // Nano Banana buffer if jimp throws (PNG decode failure / OOM / etc) —
      // worst case is the pre-197 V2 behavior, not a regression.
      const postProcessStart = Date.now();
      let finalLogoBuf;
      try {
        finalLogoBuf = await cropAndResizeLogo(logoBuf, 80);
      } catch (err) {
        debug(`[nano-banana-logo] post-process failed (using raw): ${err.message}`);
        finalLogoBuf = logoBuf;
      }
      fs.writeFileSync(path.join(publicDir, 'logo.png'), finalLogoBuf);
      brand.logoUrl = '/logo.png';
      brand.logoHasWordmark = false;
      emit('cost', {
        operation: 'nano-banana-logo',
        provider: 'Google',
        cost: 0.005,
        duration: Date.now() - logoStart,
        detail: `Logo for ${companyName}`,
      });
      debug(`[nano-banana-logo] generated logo for ${companyName} (raw ${logoBuf.length} bytes, final ${finalLogoBuf.length} bytes, gen ${postProcessStart - logoStart}ms, post-process ${Date.now() - postProcessStart}ms)`);
    } catch (err) {
      debug(`[nano-banana-logo] gen failed, fallback to text: ${err.message}`);
      emit('debug', { logoFallback: 'text', reason: err.message });
      // brand.logoUrl stays '' → Header/Footer render ServiceIcon + text.
    }
  }

  // TICKET-164: v2 slot-driven photo gen — Pass 2 walks ai.pages sections,
  // collects every image slot (hero/cta-banner/content-split single +
  // gallery items[]), generates per-slot context-aware prompts, calls Nano
  // Banana, writes /public/photos/<key>.jpg, mutates ai.pages to fill imageUrl.
  // Faces allowed per TICKET-164 user decision. Hard cap photoHardCap (100).
  // Per-slot independent failure (build never blocks). Skipped when the user
  // uploaded their own photos (imagesInstruction already fed Claude → Claude
  // assigned imageUrl from uploadedImages).
  if (uploadedImages.length === 0) {
    progress('Generating AI business photos via Nano Banana (slot-driven)...', 75);
    const resolvedThemeName = Object.keys(themes).find(k => themes[k] === theme) || '';
    const photosOutputDir = path.join(path.resolve(__dirname, '..'), 'public', 'photos');
    const result = await generateSlotPhotos({
      pages: ai.pages,
      industry,
      primaryColor: brand.colors.primary['500'],
      themeName: resolvedThemeName,
      apiKey: geminiApiKey,
      outputDir: photosOutputDir,
      emitFn: emit,
    });
    debug(`[nano-banana-photo] v2 slot-driven: ${result.success}/${result.attempted} succeeded (total slots ${result.totalSlots}, cap ${photoHardCap})`);
  }

  // TICKET-172 (hotfix): scrub AI-invented placeholder strings (e.g. "gradient-about")
  // from imageUrl fields that didn't get backfilled with a real Nano Banana URL.
  // Without this, broken <img src="gradient-about"> renders for capped/failed slots.
  const droppedPlaceholders = sanitizeImageUrls(ai.pages);
  if (droppedPlaceholders > 0) {
    debug(`[sanitize-image-urls] dropped ${droppedPlaceholders} invalid imageUrl placeholder(s) — template will render gradient fallback`);
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
    ? `\nLANGUAGE: Write ALL content in ${languageName}.${chineseVariantHint(languageName)} Only JSON keys and technical values (slugs, hrefs, icon names, variant names, section type names) should remain in English.\n`
    : '';

  const prompt = `You are an expert SEO copywriter. Generate keyword-optimized landing pages for a local service business. Return ONLY a valid JSON array, no markdown fences, no explanation.

BUSINESS CONTEXT:
- Company: ${companyName}
- Industry: ${industry}
${location ? `- Location: ${location}` : ''}
- Brand tagline: ${brand.tagline}
- Site description: ${seo.siteDescription}
${languageInstruction}

CRITICAL BRAND NAME RULE (TICKET-137):
The brand name "${companyName}" is canonical and MUST appear LITERALLY VERBATIM in all
generated content — page titles, descriptions, breadcrumbs, CTA labels, hero subtitles,
and ANY user-visible string that references the brand. DO NOT translate, transliterate,
or localize the brand name in ANY language. Examples:
  ✗ WRONG: "Happy Paws宠物美容" (translated brand) / "McDonalds" (dropped apostrophe)
  ✓ RIGHT: "Happy Paws Pet Grooming" / "McDonald's" (verbatim regardless of locale)

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

  // TICKET-132: callAIWithRetry retries on JSON.parse failures (≤3 attempts);
  // max_tokens hit also throws (caught below). Keyword pages are non-critical
  // so any final failure returns [] rather than failing the build.
  const call2Start = Date.now();
  let pages, response;
  try {
    const result = await callAIWithRetry({
      client,
      baseOptions: { model, max_tokens: maxTokens, messages: [{ role: 'user', content: prompt }] },
      costContext: {
        operation: 'create-site',
        detail: 'Keyword pages',
        pricing,
        durationStart: call2Start,
      },
      label: 'Call 2 keyword pages',
    });
    pages = result.parsed;
    response = result.response;
  } catch (e) {
    debug('Failed to generate keyword pages (after retries):', e.message);
    if (e.lastText) debug('Raw response (first 500 chars):', e.lastText.substring(0, 500));
    // Return empty — don't fail the whole build for keyword pages.
    return [];
  }
  const usage2 = response.usage || {};
  const cost2 = ((usage2.input_tokens || 0) * pricing.input + (usage2.output_tokens || 0) * pricing.output) / 1_000_000;
  const call2Duration = ((Date.now() - call2Start) / 1000).toFixed(1);
  debug(`Call 2 cost: $${cost2.toFixed(4)} (${usage2.input_tokens} in / ${usage2.output_tokens} out)`);

  progress('Parsing keyword pages...', 65);

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
