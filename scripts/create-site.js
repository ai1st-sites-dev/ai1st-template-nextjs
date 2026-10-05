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
const { themes, poolThemes, themeStyle, pickThemeForIndustry, rotationIndexFromSiteId } = require('./themes');
// #1064: 主题的形态样式表叫什么 —— 判据只在那个文件里，见它开头那段注释。
const { sheetNameForTheme } = require('./theme-sheet');
// #1346 —— 关键词页那一通的块清单（住在 lib 里是为了它能被测到，理由写在那个文件头上）。
const { keywordPageSectionOptions } = require('./lib/keyword-page-options');
// #1472 / #1523 —— 站级深浅（theme.json 的 colorScheme）。AI 吐回来的值在这里归一，构建那一侧（sync-config）读同一份判据。
const { normalizeColorScheme } = require('./lib/color-scheme');
// #1120: 每站微扰派哪三个数 —— 表和判据都在那个文件里（含为什么它不能塞进 scripts/tweaks.js）。
const { tweaksForSite } = require('./lib/site-tweaks');
// #1506 —— 提示词里讲电话 / 邮箱按钮的那一句（改站提示词印的是同一句，住在 item-sources.js）。
const { BUTTON_REF_PROMPT } = require('./lib/item-sources');
// #999 — 块清单（槽 / 外观词 / 角色兜底 / 哪些行业需要它）住在 blocks/<块>/manifest.json；形态清单是
//        blocks/<块>/ 下的子文件夹（#1387）。🔴 份数会变，别从这里抄：`ls -d templates/nextjs/blocks/*/ | wc -l`。
// 下面提示词里那两段块清单**从它们生成**，AI 吐回来之后的校验读的也是同一份 —— 在这之前，
// 「hero 有哪些槽」只存在于这个文件的散文里，填错没人管。
const {
  promptSection: blockPromptSection,
  dataLineFor: blockDataLineFor,
  loadManifests: loadBlockManifests,
  validateSite: validateBlocks,
  applyRoleDefaults: applyBlockRoleDefaults,
  // #1353 —— 「这个块是外壳区（顶栏 / 页脚），不是页面里的内容块」。判据是 manifest 自己声明的
  // `region: true`，不在这里第二次实现（`block-manifest.js` §isRegionManifest）。
  isRegionManifest,
  BLOCKS_DIR: BLOCK_MANIFEST_DIR,
} = require('./lib/block-manifest');
const blockDataLine = (type) => blockDataLineFor(loadBlockManifests().get(type));
// #1471 —— 站级表单库（`site/<locale>/forms.json`）：默认两张的骨架 + 只收 AI 的文案。
const { siteFormsFrom } = require('./lib/site-forms');
// #1548 —— 挖出来的关键词落盘（seo.json 的 targetKeywords + 每页 seo.targetKeyword）。真 AI 与 skipAI 两条路共用这一份。
const targetKw = require('./lib/target-keywords');
// #1549 —— 每页生成后的 SEO 检查（八条，设计文档 S2）。检查本身是纯函数，重写 / 丢页 / 失败的处置在本文件 §seoPass。
const { seoProblems, rulesFor: seoRulesFor, pageTitleBudget, MIN_PAGE_TITLE_BUDGET, promptLocation } = require('./lib/seo-problems');
// #1386 —— 建站选图：哪些槽要图、提示词怎么拼、上限怎么截、求不到怎么说，都在那个文件里。
// 名单不再写在本文件里（此前是四个块名 + 四个 case，`hero-with-form` 因此永远拿不到图）。
const { fillImageSlots, writeImageAlts, IMAGE_FILE_SUFFIX } = require('./lib/image-slots');
// skipAI 那条路给图槽填的那张图 —— 模板自己带的资源，不调外部图库（#1386）。
const PLACEHOLDER_IMAGE_URL = '/images/grid-pattern.svg';
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
// #1176 —— 关键词页面包屑那个中间级的死链修法（提示词 + 生成后核对两侧，理由整段在那个文件头上）。
// #1550 —— 关键词页：规划 / 素材 / 单页提示词 / 合格判据 / 详情页兜底 / 互链 / 页脚（纯函数都在 lib 里，能单测）。
//    📌 原来这里引的 `breadcrumb-links.js`（#1176 / #1184 剥死链、对齐服务级）改的是页面数据里的 `data.breadcrumbs`，
//    而 #1502 之后新 page-header 不读它（面包屑按页面路径算，`src/lib/breadcrumbs.ts`）—— 那两步已经是空操作，本票不再调。
//    文件本身留着：`package.json` 的 `lint:scripts` 清单点了它的名，而本票要求 package.json 一字不动。
const kwPages = require('./lib/keyword-pages');
const { mostSimilarPages } = require('./lib/similarity');
// #1549 回修 —— description 超长由代码裁到 155，不叫 AI 重写、不让整站失败（§description-fit.js 头注）。
const { fitPageDescriptions } = require('./lib/description-fit');
// #1489 —— 建站时按地址查一次坐标写进 brand.locations[0].geo（contact 的地图要它；Nominatim，不要 key，§geocode.js 头注）。
const { geocodeBrand } = require('./lib/geocode');
// #1551 —— LocalBusiness 里「从老板给的料来」的几项：营业时间的转写核对、真实评分（§local-business-facts.js 头注）。
const { verifyTranscription, ratingFrom } = require('./lib/local-business-facts');
// #1489 r2 —— contact 的 items 里抄进来的电话 / 邮箱 / 地址 / 营业时间，写盘那一刻剔掉（值只有一处）。
const { siteFactsFrom, scrubContactCopies } = require('./lib/contact-facts');

// ─── AI Model Config ─────────────────────────────────────────────────────────
// 🔴 下面 MODEL_PRICING 不是文档,是【记账输入】:getModelPricing(model) 的结果乘 token 数写进 operation_runs.cost(manager/db.go 的 insertOperationRun),写错一行不报错、只静默虚记。改它之前去 https://platform.claude.com/docs/en/about-claude/pricing 现取一次,别凭记忆 —— #1249 修的两行原来逐字是【已退役】型号的真价钱,不是打错。
let model = 'claude-sonnet-4-6';
let maxTokens = 128000;
// #1568 —— 各模型一次回包的输出上限（Models API `GET /v1/models/{id}` 的 max_tokens；manager/admin.go 白名单那段注释记着同一组读数）。
// 后台存的上限是一个数（默认 128000），而白名单里 haiku-4.5 只到 64000 —— 原样发出去，每一次调用都会被 API 拒。按前缀查；
// 查不到的模型不截（让 API 自己说）。
const MODEL_OUTPUT_CAPS = [['claude-haiku-4-5', 64000], ['claude-sonnet-4-6', 128000], ['claude-opus-4-6', 128000]];
function modelOutputCap(modelId) {
  const hit = MODEL_OUTPUT_CAPS.find(([prefix]) => String(modelId || '').startsWith(prefix));
  return hit ? hit[1] : null;
}
// 🔴 查表是 startsWith 前缀匹配,两处盲区:① 'claude-opus-4' 同时罩 opus 4/4.1($15/$75,已在一方 API 退役 ⟹ 调不通、不会产生 cost 行)与 4.5~4.8($5/$25),按【可达的那一种】取值;② 不以这三个前缀开头的 id(claude-opus-5 / claude-sonnet-5 / claude-fable-5 …)静默落到下面的 return {input:3,output:15},也就是按 sonnet 4.6 记账 —— 而 sonnet-5 官方 $2/$10 ⟹ 那个方向是【多记 50%】,多扣客人钱。
const MODEL_PRICING = {
  'claude-opus-4':   { input: 5,  output: 25 },   // #1249: 原 {15,75} 是已退役的 Opus 4 / 4.1 的价钱;这个前缀今天够得着的是 4.5~4.8,都是 $5/$25
  'claude-sonnet-4': { input: 3,  output: 15 },
  'claude-haiku-4':  { input: 1,    output: 5  },  // #1249: 原 {0.80,4} 是已退役的 Haiku 3.5 的价钱;4.5 是 $1/$5
};

function getModelPricing(modelId) {
  for (const [prefix, pricing] of Object.entries(MODEL_PRICING)) {
    if (modelId.startsWith(prefix)) return pricing;
  }
  return { input: 3, output: 15 };
}

let pricing = getModelPricing(model);

// ─── Emit structured events to stdout ─────────────────────────────────────────

// #1568 r2 —— stdout 是管道（worker / 测试读它）时 Node 的写是异步的：`fatal()` 里的 `process.exit(1)` 会把还没冲出去的
//    事件丢掉 —— 包括最后那条 `error`。按页拆之后建站前段一口气发 10 来份 ~26 KB 的提示词事件，第一页失败就 exit ⟹
//    实测 6 次里 2 次尾巴上 2-3 份提示词没到读者手里。改成阻塞写：每次 write 返回时数据已进管道。
if (process.stdout._handle && typeof process.stdout._handle.setBlocking === 'function') process.stdout._handle.setBlocking(true);

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

// #1548 —— 关键词分配的结果：词进 seo.json、页挂上 seo.targetKeyword，再把「对不上 / 没分到页」按词报出来。
// 🔴 只报不拦：skipAI 站只有一个 demo 服务，payload 给几组都对不上 ⟹ 全组 unmatched 是那条路的正常态（PM 21:07 第 2 条）。
// 持久的那一份就是站文件本身：差集任何时候都能用 validateSite 从 seo.json + pages/*.json 重算。
function applyTargetKeywords(content, assignment) {
  content.seo.targetKeywords = assignment.targetKeywords;
  const n = targetKw.applyPageKeywords(content.pages, assignment.pageKeywords);
  emit('keyword-assignment', {
    primary: assignment.targetKeywords.primary ? assignment.targetKeywords.primary.keyword : null,
    pages: n,
    unmatched: assignment.unmatched,
    unassigned: assignment.unassigned,
    reordered: assignment.reordered,
  });
  debug(`[keywords] ${n} 页挂上了 targetKeyword；对不上服务的组的主词 ${assignment.unmatched.length} 个`
    + `、没分到页的词 ${assignment.unassigned.length} 个、按名字纠正了位置的组 ${assignment.reordered.length} 个`);
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
// #1251 —— 图片那两条 cost 事件要说出自己用的是哪个模型，而它本来只存在于下面这条 URL 里。
// 把它单拎出来并用它拼 URL，两边就不会分岔 —— 拄一份“记录用”的副本，下一个升级 URL 的人会把它留在原地。
const NANO_BANANA_MODEL = 'gemini-2.5-flash-image';
const NANO_BANANA_ENDPOINT =
  `https://generativelanguage.googleapis.com/v1beta/models/${NANO_BANANA_MODEL}:generateContent`;

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
          // #1475 —— features 的项把图嵌在 `image: {imageUrl, alt}` 里。
          if (item.image?.imageUrl && !isValidImageUrl(item.image.imageUrl)) {
            delete item.image.imageUrl;
            dropped++;
          }
        }
      }
    }
  }
  return dropped;
}

// Returns { attempted, success, totalSlots, dropped, failures } so caller can log + emit.
// 单个槽失败不让建站倒（per-slot try/catch 在 fillImageSlots 里），imageUrl 留空 ⟹ 块按
// `shapes[].needs` 落回不要图的那个形态（#1331）。
// #1386 —— 哪些槽要图、提示词怎么拼、上限怎么截，都在 `lib/image-slots.js`；这里只剩
// 「真去调 Nano Banana 并把字节写盘」这一件事，以及计费事件。
async function generateSlotPhotos({ pages, manifests, industry, primaryColor, themeName, apiKey, outputDir, emitFn }) {
  const themeWord = themeName || 'minimal';
  fs.mkdirSync(outputDir, { recursive: true });

  const result = await fillImageSlots({
    pages,
    manifests,
    industry,
    primaryColor,
    themeWord,
    cap: photoHardCap,
    log: (line) => debug(line),
    produce: async ({ prompt, key }) => {
      const startMs = Date.now();
      const imageBytes = await callNanoBanana({ prompt, apiKey });
      // #1566 —— key 已收进 SLOT_KEY_MAX_BYTES（按这个后缀推的），这里换别的后缀要回 image-slots.js 改那一处。
      fs.writeFileSync(path.join(outputDir, `${key}${IMAGE_FILE_SUFFIX}`), imageBytes);
      if (emitFn) emitFn('cost', {
        operation: 'nano-banana-photo',
        provider: 'Google',
        model: NANO_BANANA_MODEL, // #1251
        cost: 0.005,
        duration: Date.now() - startMs,
        detail: key,
      });
      return `/photos/${key}${IMAGE_FILE_SUFFIX}`;
    },
  });

  if (emitFn && result.dropped.length) {
    emitFn('debug', { photoCapped: true, originalCount: result.totalSlots, capped: photoHardCap });
  }
  if (emitFn) for (const f of result.failures) emitFn('debug', { photoFailure: f.slot.secType, reason: f.reason });
  return result;
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
    // #1251: 读 `baseOptions.model` 而不是模块那个 `model` 变量 —— 这个对象就是上面交给 SDK 的那一份，
    // 记下来的和发出去的按构造是同一个字串。（不取 `response.model`：它是服务器把别名解开之后的带日期 id，
    // 而 manager 那几条路记的是请求里的 id —— 同一列里两种口径会让 `GROUP BY model` 把一个模型数成两个。）
    emit('cost', {
      operation: costContext.operation,
      model: baseOptions.model,
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

// TICKET-136: brand.name 是按语言的表 —— 主语言是 companyName，表单里按语言单独填过的覆盖它。
// #1549 —— 抽成函数：提示词里的 title 预算要在 Call 1 之前就知道主语言的品牌名（`metadata.ts` 拼在子页 <title>
//    后面的就是它），跟写进 brand.json 的那份必须是同一份。
function brandNameRecord(companyName, brandNameByLocale, defaultLocale) {
  const brandName = { [defaultLocale]: companyName };
  for (const [loc, name] of Object.entries(brandNameByLocale || {})) {
    const norm = normalizeLocale(loc);
    if (norm && typeof name === 'string' && name.trim()) {
      brandName[norm] = name.trim();
    }
  }
  return brandName;
}

// #1549 做什么 4 —— 子页 `page.title` 的长度要求，提示词和 seoProblems 第 1 条用同一个数（60 − 3 − 品牌名字数）。
// 预算 < 20（品牌名 ≥ 38 字）时检查那一侧不判长度，提示词这一侧也不给一个做不到的数。
function pageTitleSpec(brandName) {
  const budget = pageTitleBudget(brandName);
  const tail = `" | ${brandName}" is appended automatically — do not add it yourself`;
  return budget >= MIN_PAGE_TITLE_BUDGET ? `max ${budget} chars; ${tail}` : `as short as possible; ${tail}`;
}

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
    // #1548 —— Lead 站传的三个字段（CreatePage.tsx §proceedToLeadBuild）。`keyword` = 站的主词（首页的目标词），
    //    `additionalContext` = 老板在 Lead 表格里写的补充说明，进每一次 AI 调用；`siteType` 判「这是不是 Lead 站」。
    keyword: leadKeyword = '',
    siteType = '',
    additionalContext = '',
  } = input;

  // #1569 —— 主语言非英语的站，向导多存一份按主语言翻好的地点（`locationLocalized`）：提示词里两份都给（§lib/seo-problems.js promptLocation）。
  const location = promptLocation(input);

  // Override AI model/tokens from Admin Settings (passed through by Manager)
  if (input.model) { model = input.model; pricing = getModelPricing(model); }
  if (input.maxTokens) maxTokens = parseInt(input.maxTokens, 10) || maxTokens;
  // #1568 —— 截到这个模型的输出上限（后台模型选 haiku-4.5、上限存 128000 时，发给 API 的是 64000，不是被拒）。
  {
    const cap = modelOutputCap(model);
    if (cap && maxTokens > cap) {
      debug(`[ai] max_tokens ${maxTokens} 超过 ${model} 的输出上限 ⟹ 截到 ${cap}`);
      maxTokens = cap;
    }
    debug(`[ai] model ${model} · max_tokens ${maxTokens}`);
  }
  // TICKET-166: admin override for AI image hard cap (default 100).
  if (input.maxImagesPerSite) photoHardCap = parseInt(input.maxImagesPerSite, 10) || photoHardCap;

  // #1346 —— 后台「区块与主题」页关掉了哪些主题 / 哪些块（manager 从 platform_config 读出来塞进
  // payload，#1345 存的就是那两行）。
  //
  // 🔴 **字段缺席 = 派这个活的 manager 比 #1346 老**，一律读成「什么都没关」。manager 那一侧永远送
  //    数组（空的时候是 `[]`），所以「缺席」和「空清单」在这里是两件可以分开的事，而两件事的处置
  //    恰好相同 —— 相同不代表可以合并：真要分开时（比如将来想在日志里说一句「这台 manager 不带
  //    禁用清单」）判据还在。
  // 🔴 只收字符串。手改过的 platform_config 行会一路流到这里，而 `new Set([null])` 之类的东西
  //    在下游是静默的：它不匹配任何块名，于是「关掉了」变成「没关掉」。
  const idList = (v) => (Array.isArray(v) ? v.filter((x) => typeof x === 'string' && x.trim()).map((x) => x.trim()) : []);
  const disabledThemes = idList(input.disabledThemes);
  const disabledBlocks = idList(input.disabledBlocks);
  if (disabledThemes.length || disabledBlocks.length) {
    debug(`[catalog] 后台关掉的: 主题 ${disabledThemes.join(', ') || '（无）'} | 块 ${disabledBlocks.join(', ') || '（无）'}`);
  }

  if (!siteId) fatal('siteId is required');
  // #1547 —— 这个站这次构建要发布到的地址，由 manager 给（预览地址 / 上线地址），写进 seo.domain。
  // 🔴 不推断、不回落：没给就停。AI 不再编域名；skipAI 也用它。
  let siteUrl;
  if (!input.siteUrl) fatal('siteUrl is required — the manager sends the address this build publishes to (#1547)');
  try {
    siteUrl = require('./lib/build-target.js').readBuildTarget({ SITE_URL: input.siteUrl }).siteUrl;
  } catch (e) {
    fatal(`siteUrl is invalid: ${e.message}`);
  }
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
  // 🔴 #1346 —— 上面那条注释说的「整条绕过轮换」正是为什么这一支要有自己的拒绝分支：它不经
  //    `pickThemeForIndustry`，所以那边剔停用主题的那一步对它一个字都不说。
  const named = (template && template !== 'ai' && themes[template]) ? template : '';
  if (named && disabledThemes.includes(named)) {
    fatal(`Theme "${named}" is switched off in Blocks & Themes, so it cannot be put on a new website. `
      + 'Switch it back on, or leave the theme to us (template: "ai").');
  }
  const themeName = named || pickThemeForIndustry(industry, themeRotationIndex, disabledThemes);
  // 🔴 #1346 —— 池里的主题**全部**被关掉时干净失败，不静默建一个没有主题的站。
  //    (`pickThemeForIndustry` 在空池上返回 null；改之前它返回 `undefined`，下一行的 `themes[…]`
  //    也是 undefined，然后一路往下走。)
  if (!themeName) {
    const total = Object.keys(poolThemes).length;
    fatal(`No theme is available: all ${total} theme(s) in the pool are switched off in Blocks & Themes `
      + `(${disabledThemes.join(', ')}). Switch at least one back on, then create the website again.`);
  }
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
    ? tryHomepageRecipe(recipeIndex, loadBlockManifests(), industry, disabledBlocks)
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
  // 🔴 #1120: `tweaks` 就写在这里 —— 全文件**只此一处**创建 `theme.json`（两个分支只差 `css`），
  // 所以「一站一次」这件事是由落点保证的，不是由纪律保证的。派生不出来（`tweaksForSite` 回 null）
  // 时**整个键不写**，产出的 theme.json 与本票之前逐字节相同。
  // 📌 #1523 起 AI 那条路之后还有一处**补一个键**（§writeThemeColorScheme 补 `colorScheme`，AI 跑完才知道值），
  // 别的键原样 ⟹ 上面「一站一次」那条不受影响。
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
    const content = getDemoConfig(siteId, siteUrl);
    // #1473 —— 主语言写进 seo.locale（`<html lang>` 读它）。改前这里恒为 getDemoConfig 写死的 en_CA ⟹ `language:"ar"`
    //    的示例站会是 `lang="en" dir="rtl"`。`en` 仍映射到 en_CA，英文示例站逐字不变；次语言那一支（下面）本来就这么写。
    content.seo.locale = localeMapForBcp47(defaultLocale);
    // #1473 做什么 6 —— `ar` 示例站换上阿拉伯文那一份（机器翻，只为渲染一个 RTL 站，`lib/demo-content/ar.js`）。
    if (defaultLocale === 'ar') {
      debug(`[demo ar] 替换了 ${require('./lib/demo-content/ar.js').localizeStrings(content)} 处演示文案`);
    }
    // #1346 —— skipAI 这条路**不经 AI、也不经 validateBlocks**，所以关掉的块只能在这里剔。
    // 漏掉它的话「关掉一个块」对示例站（夹具、演示、QA 的 4 个站）完全不说话，而那正是最常被拿去
    // 取读数的一条路。整页被剔空就连页一起去掉：一个只剩标题的页面不是一个页面。
    if (disabledBlocks.length) {
      const off = new Set(disabledBlocks);
      const before = content.pages.length;
      for (const pg of content.pages) pg.sections = (pg.sections || []).filter((sec) => !off.has(sec.type));
      // 🔴 Contact 那一页跟 §writeSiteConfig 里那条**同一个判据**：它存在的理由是那个表单
      //    （268e：POST 到 /api/leads，进老板的 Customers）。表单关掉了就整页去掉，而不是留一个
      //    只剩标题、点进去什么都没有的页。两处写的是同一句话，因为示例站这一份是 getDemoConfig
      //    自己带的，走不到那一处。
      if (off.has('contact')) content.pages = content.pages.filter((pg) => pg.slug !== 'contact');
      content.pages = content.pages.filter((pg) => (pg.sections || []).length);
      debug(`[catalog] skipAI 示例站剔掉关掉的块：页面 ${before} → ${content.pages.length}`);
    }
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
    // #1386 —— skipAI 这条路也填图，但**不调任何外部图库**：每个内容图槽填同一张本地占位图，
    // 逐槽打一行读数。此前这条路在上面那个 `if (input.skipAI)` 就 return 了，根本走不到选图 ⟹
    // 示例站（夹具 / 演示 / QA 取读数最常用的那几个站）的 hero 永远没有图，「块有图时长什么样」
    // 在这条路上一次都量不到。占位图用仓库自带的 `public/images/grid-pattern.svg`（模板自己的
    // 资源，不是外部链接）。
    await fillImageSlots({
      pages: content.pages,
      manifests: loadBlockManifests(),
      industry,
      primaryColor: content.brand.colors.primary['500'],
      themeWord: themeName,
      produce: async () => PLACEHOLDER_IMAGE_URL,
      log: (line) => debug(line),
    });
    // #1548 —— 同一个纯函数（`lib/target-keywords.js`）。demo 只有 5 页、一个服务、没有关键词页 ⟹ 这里能挂上词的只有首页，
    //    payload 的组全部对不上 demo-service（正常态，不失败）。
    applyTargetKeywords(content, targetKw.assignTargetKeywords({
      keywords, services, contentServices: content.services, pages: content.pages,
      keywordPagesList: [], siteType, keyword: leadKeyword,
    }));
    writeSiteConfig(siteDir, content, defaultLocale, disabledBlocks);
    debug(`Demo site config written to site/`);
    // TICKET-122b: in skipAI mode, secondary locales get a verbatim copy of the
    // primary demo content (no real translation), with seo.locale rewritten so
    // the BCP-47 marker reflects the secondary locale. Lets schema/build pipeline
    // round-trip multi-locale layouts without burning tokens.
    for (const secLocale of normalizedSecondaryLocales) {
      // #1548 —— 第二语言不带关键词清单（清单是主语言挖的词）；页上的目标词标成翻译来的（这里是逐字拷贝，代替翻译）。
      const { targetKeywords: _primaryOnly, ...secSeo } = content.seo;
      const secContent = {
        brand: { tagline: content.brand.tagline },
        seo: { ...secSeo, locale: localeMapForBcp47(secLocale) },
        services: content.services,
        navigation: content.navigation,
        forms: content.forms,
        formsBase: content.forms,
        pages: content.pages.map((pg) => (pg.seo && pg.seo.targetKeyword ? { ...pg, seo: { ...pg.seo, translated: true } } : pg)),
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

  // #1548 做什么 5 —— (a) 站的主词 (b) 每服务主词 (c) 关键词页清单，从 payload 算一次，Call 1 / Call 2 用同一段。
  const kwGroups = targetKw.keywordGroups(keywords, services);
  const keywordBrief = targetKw.keywordBrief({
    sitePrimary: targetKw.sitePrimaryOf(kwGroups, { siteType, keyword: leadKeyword }),
    groups: kwGroups,
    keywordPagesList: keywordPagesFrom(keywords, services).keywordPagesList,
  });

  // ── Call 1: Generate base site (brand + seo + services + regular pages) ──
  const content = await generateContent({
    companyName, industry, location, address, phone, email,
    // #1569 r2 —— 地址那一格要的是原样的地点（Google Ads 那份），不是上面给 AI 当背景的双语串（§generateContent 地址那行）。
    rawLocation: input.location,
    services, usp, targetCustomers, brandDescription,
    theme, languageName, refSite, refPrefs, refAnalysis,
    reviews, onlinePresence, hours, priceRange, uploadedImages, logoUrl,
    // #1134（来源 #1139）—— 这个站会不会有服务子页。判据跟 Call 2 真去生成那些页时用的是
    // 同一个函数,不是第二份实现。
    hasKeywordPages: keywordPagesFrom(keywords, services).keywordPagesList.length > 0,
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
    // #1346: 后台关掉的块。提示词里那份菜单、两行写死的页面规则、以及 AI 吐回来之后那道校验，
    // 三处用的是同一份清单 —— 少一处就换一种坏法（票面做什么 #4）。
    disabledBlocks,
    siteUrl,
    // #1548 —— 关键词那一段 + Lead 站的补充说明。
    keywordBrief, additionalContext,
    // #1568 r2 —— 站级回包里撞上这些词的页丢掉（关键词页只由 Call 2 建）。
    keywordPageKeywords: keywordPagesFrom(keywords, services).keywordPagesList.map((k) => k.keyword),
    // #1568 —— 每页提示词里的目标词：跟 Call 2 之后那次分配同一个函数，只是这一刻还没有关键词页。
    pageTargetKeywords: (plan) => targetKw.assignTargetKeywords({
      keywords, services, contentServices: plan.services, pages: plan.pages, keywordPagesList: [], siteType, keyword: leadKeyword,
    }).pageKeywords,
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

  // ── Call 2（#1550）：关键词页，一页一次调用 ──────────────────────────────────────────────────────────
  //
  // 🔴 失败、重试、计数**都按单页算**（正文做什么 1）：一页没拿到合格结果只重试这一页，别的页不重新生成；最终仍失败的
  //    按词列进建站结果（`keyword-pages` 事件，建站页据它不显示「成功」），建站照常往下走 —— 以前这里一次调用生成全部页，
  //    失败就静默 `return []`，整站没有关键词页却显示成功。
  // 🔴 一页一次（不是 ≤3 页一批）：素材是**这一页**的（带本地名的评价、本服务组的问题），批在一起就会把 Markham 那条评价
  //    送进 Toronto 那页的提示词。
  const kwPlan = kwPages.planKeywordPages({ keywords, services, contentServices: content.services });
  const kwReport = { total: kwPlan.pages.length, ok: 0, failed: [], fallbackSlugs: kwPlan.fallbacks, similarity: [], addedServices: [] };
  const kwOk = [];
  if (kwPlan.pages.length > 0) {
    progress('AI is writing keyword pages...', 55);
    for (const f of kwPlan.fallbacks) debug(`[keyword-pages] 「${f.keyword}」里有转写表没有的文字 ⟹ slug 退成 ${f.slug}`);
    const results = await generateKeywordPages({
      plan: kwPlan.pages,
      payload: input,
      brand: content.brand,
      seo: content.seo,
      companyName,
      industry,
      location,
      languageName,
      disabledBlocks,
      titleSpec: pageTitleSpec(content.brand.name[defaultLocale]),
      forms: siteFormsFrom(content.ai && content.ai.forms),
      additionalContext,
      sitePrimaryKeyword: (targetKw.sitePrimaryOf(kwGroups, { siteType, keyword: leadKeyword }) || {}).keyword || '',
    });
    for (const r of results) {
      if (r.ok) kwOk.push(r);
      else kwReport.failed.push({ keyword: r.entry.keyword, slug: r.entry.path, problems: r.problems });
    }
    kwReport.ok = kwOk.length;

    // PM 02:08 裁定 ①(b) —— 对不上服务的组由代码补一个服务；🔴 只给**真有关键词页落地**的组补（一页都没成就不补）。
    const okServiceIds = new Set(kwOk.map((r) => r.entry.serviceId));
    for (const a of kwPlan.addedServices) {
      if (!okServiceIds.has(a.id)) continue;
      content.services.push(kwPages.serviceEntryFor(a, content.services));
      kwReport.addedServices.push({ id: a.id, name: a.name });
      debug(`[keyword-pages] 关键词组「${a.group}」对不上本站任何服务 ⟹ 补了服务 ${a.id}（「${a.name}」），它的关键词页挂在 /services/${a.id}/ 下`);
    }

    const newPages = kwOk.map((r) => r.page);
    // navOrder 由代码写（50 + 它在挖词清单里的位置，Gold 高的在前）：页脚按它排，sync-config 重建页脚时读的也是它。
    kwOk.forEach((r) => { r.page.navOrder = 50 + kwPlan.pages.indexOf(r.entry); });
    content.pages.push(...newPages);
    // 🔴 服务详情页、相似度、兄弟页、页脚栏、`keyword-pages` 事件都挪到 seoPass（#1549）**之后**（§finishKeywordPages）：
    //    seoPass 会重写页、再丢掉仍不合格的关键词页 —— 在它之前定下来的 N/M、相似度、页脚就会把已经不在站里的页算进去
    //    （QA2 r1：「报 6/6、站里只有 5 页」）；而在它之前补的详情页，会让一个下面一页都没留下的服务因为这张多余的页建站失败。
  }

  // #1548 —— 三类页挂上目标词、清单进 seo.json。放在 Call 2 之后：关键词页这时才在 content.pages 里。
  //    #1550 —— 关键词页 ↔ 词的对照表 = 真落地的那些页（URL 是 `services/<id>/<slug>`）。
  applyTargetKeywords(content, targetKw.assignTargetKeywords({
    keywords, services, contentServices: content.services, pages: content.pages,
    keywordPagesList: kwOk.map((r) => ({ nestedSlug: r.entry.path, keyword: r.entry.keyword })), siteType, keyword: leadKeyword,
  }));

  // #1549 —— 目标词这时才挂到页上 ⟹ 每页第一张内容图的 alt 在这里带上它（填图那一刻还不知道是哪个词）。
  //    用户自己上传照片的那条路不经填图，alt 也在这里补齐。
  {
    const alts = writeImageAlts({ pages: content.pages, manifests: loadBlockManifests(), industry, targetKeywordOf: seoTargetOf });
    debug(`[seo] alt：补了 ${alts.written} 张 · ${alts.keyworded} 页的第一张内容图带上了目标词`);
  }

  // #1549 —— 主语言每一页跑 seoProblems；有问题重写那一页一次；仍有问题：关键词页丢掉，其余页建站失败（§seoPass）。
  progress('Checking every page for SEO...', 68);
  const seoResult = await seoPass({
    content, payload: input, locale: defaultLocale, industry, location, companyName, disabledBlocks,
    // #1550 —— 计划建的 = 全部选中词（含 Call 2 就没建成的），seoPass 据它打「关键词页 N/M」那行日志和 seo-check 事件。
    keywordPagesPlanned: kwPlan.pages.map((e) => ({ nestedSlug: e.path, keyword: e.keyword })),
  });

  // ── 关键词页收尾（#1550）：seoPass 之后才定的那几样 ─────────────────────────────────────────────────────
  if (kwPlan.pages.length > 0) {
    await finishKeywordPages({
      content, kwPlan, kwReport, kwOk, dropped: seoResult.dropped, locale: defaultLocale, disabledBlocks,
      industry, location, companyName, payload: input,
      // 服务目录变了（补的服务撤掉 / 补了详情页）之后重算目标词：seo.targetKeywords 按服务 id 记词组，详情页的目标词 = 它服务的主词。
      assign: () => targetKw.assignTargetKeywords({
        keywords, services, contentServices: content.services, pages: content.pages,
        keywordPagesList: kwOk.map((r) => ({ nestedSlug: r.entry.path, keyword: r.entry.keyword })), siteType, keyword: leadKeyword,
      }),
    });
  }

  progress('Writing configuration files...', 70);

  // #1097 — 首屏要不要带一个能留联系方式的表单（Chris 2026-08-19「跟着行业走」）。
  //
  // 落在写盘之前、`content` 还在内存里的这一刻，是因为要改的东西正好都在这个作用域里：`industry`
  // （:754 已经 fatal 挡过空值）· `content.pages`。
  //
  // 🔴 #1333 起它改的是块的 `type`（`hero` → `hero-with-form`），不是给 hero 写一个
  //    `block_layout: "with-form"` 字段；主题那道判断一起删了（任何主题都画得出带表单的首屏）。
  //    `theme` 因此不再传进去。
  //
  // 🔴 `reason` 必须打出来：不给表单有三个完全不同的答案，而它们在产物里长得一模一样。
  const heroForm = applyHeroLeadForm({ content, industry, disabledBlocks });
  debug(`[hero lead form] ${heroForm.applied ? '带上了' : '没带'} 首页第一个 hero 的表单（options.form） — ${heroForm.reason}`);

  writeSiteConfig(siteDir, content, defaultLocale, disabledBlocks);

  // #1472 —— 站级深浅：AI 按行业给的默认（酒吧 / 健身房 dark，牙科 / 律所 light），老板之后可改成 auto。
  // 认不得的值落回 light（判据在 lib/color-scheme.js，构建那一侧读的是同一份）。skipAI 那条路不走这里 ⟹ 不写这个键 = light。
  const colorScheme = normalizeColorScheme(content.ai && content.ai.colorScheme);
  writeThemeColorScheme(siteDir, colorScheme);
  debug(`[color scheme] ${colorScheme}（AI 给的是 ${JSON.stringify(content.ai && content.ai.colorScheme)}）`);

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
          industry, location, companyName, additionalContext,
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
  additionalContext = '',
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
        industry, location, companyName, additionalContext,
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
      forms: primaryContent.forms,
      primaryLanguageName, secondaryLanguageName, secondaryLocale,
      industry, location, companyName, additionalContext,
    }),
    { retries: 3, backoff: [5000, 15000, 45000], label: `translate supporting files → ${secondaryLocale}` }
  );

  return {
    brand: { tagline: supportingFiles.brandTagline },
    seo: supportingFiles.seo,
    services: supportingFiles.services,
    navigation: supportingFiles.navigation,
    forms: supportingFiles.forms,
    formsBase: primaryContent.forms,
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
  additionalContext = '',
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
COMPANY: ${companyName}${additionalContext ? `\nADDITIONAL CONTEXT FROM THE OWNER: ${additionalContext}` : ''}

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
- DO NOT add new sections or fields. Schema must round-trip identically.${page.seo && page.seo.targetKeyword ? `
- page.seo.targetKeyword is the search phrase this page targets: replace it with the phrase a ${secondaryLanguageName} speaker would actually search for (a translation, not a new topic).` : ''}
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
  // #1548 —— 第二语言页的目标词是翻译来的，不是挖的 ⟹ 标 translated: true（validateSite 第 ① 条跳过它）。译文丢了就留原词。
  if (page.seo && typeof page.seo.targetKeyword === 'string') {
    const got = translated.seo && typeof translated.seo.targetKeyword === 'string' && translated.seo.targetKeyword.trim();
    translated.seo = { ...page.seo, targetKeyword: got || page.seo.targetKeyword, translated: true };
  }
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
  client, brand, seo, services, navigation, forms = [], primaryLanguageName, secondaryLanguageName, secondaryLocale, industry, location, companyName,
  additionalContext = '',
}) {
  const prompt = `You are translating website supporting config from ${primaryLanguageName} to ${secondaryLanguageName}.${chineseVariantHint(secondaryLanguageName)} For SEO.

INDUSTRY: ${industry}
LOCATION: ${location}
COMPANY: ${companyName}${additionalContext ? `\nADDITIONAL CONTEXT FROM THE OWNER: ${additionalContext}` : ''}

PRIMARY LOCALE INPUTS:
\`\`\`json
${JSON.stringify({
  brandTagline: brand.tagline,
  seo: { siteTitle: seo.siteTitle, siteDescription: seo.siteDescription, schema: { offerCatalogName: seo.schema?.offerCatalogName, priceRange: seo.schema?.priceRange } },
  services: services.map(s => ({ id: s.id, name: s.name, shortDescription: s.shortDescription, fullDescription: s.fullDescription, features: s.features, products: s.products })),
  forms: (forms || []).map(f => ({ id: f.id, name: f.name, buttonText: f.buttonText, successMessage: f.successMessage })),
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
- Output JSON shape:
\`\`\`json
{
  "brandTagline": "<translated>",
  "seo": { "siteTitle": "...", "siteDescription": "...", "schema": { "offerCatalogName": "...", "priceRange": "..." } },
  "services": [ { "id": "<unchanged>", "name": "...", "shortDescription": "...", "fullDescription": "...", "features": [...], "products": [...] }, ... ],
  "forms": [ { "id": "<unchanged>", "name": "...", "buttonText": "...", "successMessage": "..." }, ... ],
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
  // #1548 —— 关键词清单是主语言挖的词，不带进第二语言的 seo.json。
  const { targetKeywords: _primaryOnly, ...seoBase } = seo;
  const outSeo = {
    ...seoBase,
    siteTitle: parsed.seo?.siteTitle || seo.siteTitle,
    siteDescription: parsed.seo?.siteDescription || seo.siteDescription,
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
    // #1471 —— 只取译文；结构（id / fields / primary）由写盘那一步按主语言骨架补（§writeSecondaryLocaleConfig）。
    forms: Array.isArray(parsed.forms) ? parsed.forms : [],
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
  // #1471 —— 表单库：结构跟主语言同一副骨架（各语言 id / fields / primary 按构造一致），文字用这个语言的。
  const localeFiles = {
    'navigation.json': secContent.navigation,
    'seo.json': secContent.seo,
    'services.json': secContent.services,
    'forms.json': siteFormsFrom(secContent.forms, secContent.formsBase || undefined),
  };
  for (const [filename, data] of Object.entries(localeFiles)) {
    fs.writeFileSync(path.join(localeDir, filename), JSON.stringify(data, null, 2) + '\n');
  }

  // pages → <secondaryLocale>/pages/<slug>.json（#998：同上，写盘时转成 blocks 形状）
  const secFacts = siteFactsFrom(existingBrand, secContent.seo);
  for (const page of secContent.pages) {
    const scrubbed = scrubContactCopies(page, secFacts);
    if (scrubbed) debug(`[contact] ${secondaryLocale}/${page.slug}: dropped ${scrubbed} copied value(s) from items`);
    const pagePath = path.join(localeDir, 'pages', `${page.slug}.json`);
    fs.mkdirSync(path.dirname(pagePath), { recursive: true });
    fs.writeFileSync(pagePath, JSON.stringify(pageWithBlocks(page), null, 2) + '\n');
  }

  debug(`Secondary locale config written: site/${secondaryLocale}/ (${secContent.pages.length} pages)`);
}

// ─── Write Site Config Files ─────────────────────────────────────────────────

// #1346 —— `disabledBlocks` 传到这里，因为**这个函数自己会插块**（268b/268e 那个 Contact 页）。
// 那一处发生在两次 `validateBlocks` **之后**，所以剔菜单、传清单进校验器这两步都管不到它。
/**
 * #1472 / #1523 —— 把站级深浅补进 `theme.json`（那份文件在 AI 跑之前就写好了，这里只加一个键，别的原样）。
 * #1523 前写的是 site_meta.json；搬家的理由在 lib/color-scheme.js 文件头。`applied` 一个字不动：它管的是
 * 「老板换过主题没有」，跟深浅不是一回事。
 */
function writeThemeColorScheme(siteDir, colorScheme) {
  const p = path.join(siteDir, 'theme.json');
  const meta = JSON.parse(fs.readFileSync(p, 'utf-8'));
  meta.colorScheme = colorScheme;
  fs.writeFileSync(p, JSON.stringify(meta, null, 2) + '\n');
}

function writeSiteConfig(siteDir, content, defaultLocale, disabledBlocks = []) {
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
  // #1471 —— 站级表单库：两张默认表单的骨架（id / fields / primary 钉死）+ AI 写的文案（`scripts/lib/site-forms.js` §siteFormsFrom）。
  content.forms = siteFormsFrom(content.forms);
  const localeFiles = {
    'navigation.json': content.navigation,
    'seo.json': content.seo,
    'services.json': content.services,
    'forms.json': content.forms,
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
  // #1346 —— 后台关掉的块这里也要让开。这两块是脚本**自己**插的，不经菜单、不经校验器；
  // 关掉 `contact` 而这里照插，就等于后台那个开关对每一个新站都是假的。
  // 📌 #1425（T3）—— 旧库的 `contact-form` 删了；表单住在新库 `contact` 块上（槽 `form: { id? }`，选站级表单库
  //    `forms.json` 里哪一张 —— 这一页用 `contact` 那张），提交路径照旧是 /api/leads。
  const contactOff = new Set(disabledBlocks);
  const contactSections = [
    { type: 'page-header', data: { headline: 'Contact Us', subheadline: "Send us a message and we'll get back to you shortly." } },
    { type: 'contact', data: { headline: 'Get in touch', body: 'Leave your details and we will reach out soon.', form: { id: 'contact' }, options: { form: 'full' } } },
  ].filter((sec) => !contactOff.has(sec.type));
  // 🔴 `contact` 被关掉时**整页不插**，不是插一个只剩标题的 Contact 页。268e 要的是
  //    「有一条看得见的联系路径」（那个表单 POST 到 /api/leads，进老板的 Customers），而一个
  //    导航里点得进去、进去什么都没有的页面比没有这一页更坏。`page-header` 被单独关掉时那一页
  //    照插，只是没有标题块 —— 表单还在，路径还在。
  const contactPageWanted = !contactOff.has('contact') && contactSections.length > 0;
  if (!content.pages.some((p) => p.slug === 'contact') && contactPageWanted) {
    const maxOrder = content.pages.reduce((m, p) => Math.max(m, p.navOrder ?? 0), 0);
    content.pages.push({
      slug: 'contact', title: 'Contact Us', description: `Get in touch with ${content.brand?.name || 'us'}`,
      navLabel: 'Contact', navOrder: maxOrder + 1, changeFrequency: 'monthly', priority: 0.7,
      sections: contactSections,
    });
  }

  // #999 — 角色兜底在**写盘前**再补一次，不能只在 AI 输出那一刻补。
  // 上面这两段（268b / 268e）是脚本自己插进去的页面，它们在校验之后才出现 ⟹ 第一版实测:真 AI 建站
  // 60 个 section 里 58 个带上了 role，剩下 2 个正是 contact 页那两块。写盘前补一次覆盖全部来源。
  applyBlockRoleDefaults(content.pages);

  // pages → <locale>/pages/<slug>.json
  // #998: 磁盘上的形状是 `blocks`。转换只发生在写盘这一刻 —— 上面那些校验、参考站对照、翻译
  // 都还读 `content.pages[].sections`，形状迁移不该顺手改掉 AI 那一侧的行为。
  const facts = siteFactsFrom(content.brand, content.seo);
  for (const page of content.pages) {
    const scrubbed = scrubContactCopies(page, facts);
    if (scrubbed) debug(`[contact] ${page.slug}: dropped ${scrubbed} copied value(s) from items`);
    const pagePath = path.join(localeDir, 'pages', `${page.slug}.json`);
    fs.mkdirSync(path.dirname(pagePath), { recursive: true });
    fs.writeFileSync(pagePath, JSON.stringify(pageWithBlocks(page), null, 2) + '\n');
  }

  debug(`Site config written to site/ (locale: ${defaultLocale})`);
  debug(`Pages: ${content.pages.map(p => p.slug).join(', ')}`);
}

// ─── Demo Config (No AI) ────────────────────────────────────────────────────

function getDemoConfig(siteId, siteUrl) {
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
      locations: [{ label: 'Main Office', address: '123 Demo Street, Toronto, ON', phone: '416-555-0000', geo: { lat: 43.6532, lng: -79.3832 } }],
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
      domain: siteUrl, // #1547：manager 给的这次构建的地址
      locale: 'en_CA',
      siteTitle: 'Demo Company — Professional Services',
      siteDescription: 'Demo Company provides professional services in the Greater Toronto Area.',
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
          { type: 'hero', data: { headline: 'Welcome to Demo Company', subheadline: 'Your trusted local business partner', ctas: [{ label: 'Get Started', href: '/quote', style: 'solid' }, { label: 'Learn More', href: '/about', style: 'outline' }] } },
          // #1425（T3）—— 服务那一格用引用写法（#1505）：条目来自 services.json，不抄进来。
          { type: 'features', data: { headline: 'Why Choose Us', body: 'What sets us apart from the rest', items: { source: 'services' } } },
          { type: 'cta', data: { headline: 'Ready to get started?', body: 'Contact us today for a free consultation.', ctas: [{ label: 'Contact Us', href: '/quote', style: 'solid' }] } },
          { type: 'contact', data: { headline: 'Contact us', body: "Leave your details and we'll get back to you shortly.", form: { id: 'contact' }, options: { form: 'full' } } }, // TICKET-268b
        ],
      },
      {
        slug: 'about', title: 'About Us', description: 'Learn about Demo Company', navLabel: 'About', navOrder: 1, changeFrequency: 'monthly', priority: 0.8,
        sections: [
          { type: 'page-header', data: { headline: 'About Us', subheadline: 'Learn more about our company and mission' } },
          { type: 'content', data: { body: '## Our Story\n\nDemo Company was founded with a simple mission: to provide exceptional service to our community. We have been serving the Greater Toronto Area for years, building lasting relationships with our clients.\n\n## Our Mission\n\nWe are committed to delivering quality results with integrity and professionalism.', options: { textStyle: 'article' } } },
        ],
      },
      {
        slug: 'services', title: 'Our Services', description: 'Professional services by Demo Company', navLabel: 'Services', navOrder: 2, changeFrequency: 'monthly', priority: 0.8,
        sections: [
          { type: 'page-header', data: { headline: 'Our Services', subheadline: 'Discover what we can do for you' } },
          { type: 'features', data: { headline: 'What we do', items: { source: 'services' } } },
        ],
      },
      {
        slug: 'quote', title: 'Get a Quote', description: 'Request a free quote from Demo Company', navLabel: 'Get a Quote', navOrder: 3, changeFrequency: 'monthly', priority: 0.7,
        sections: [
          { type: 'page-header', data: { headline: 'Get a Free Quote', subheadline: 'Fill out the form below and we will get back to you within 24 hours' } },
          { type: 'contact', data: { headline: 'Tell us about your project', body: 'We will get back to you within 24 hours.', form: {}, options: { form: 'full' } } },
        ],
      },
      {
        // TICKET-268e: a nav-clickable Contact page (not just a home-page section) so visitors have an
        // obvious way to reach out → the form POSTs to /api/leads → the owner's Customers list.
        slug: 'contact', title: 'Contact Us', description: 'Get in touch with Demo Company', navLabel: 'Contact', navOrder: 4, changeFrequency: 'monthly', priority: 0.7,
        sections: [
          { type: 'page-header', data: { headline: 'Contact Us', subheadline: "Send us a message and we'll get back to you shortly." } },
          { type: 'contact', data: { headline: 'Get in touch', body: 'Leave your details and we will reach out soon.', form: { id: 'contact' }, options: { form: 'full' } } },
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

// ── #1139 / #1134 —— 「这个站会不会有关键词页」只有一个算法 ──────────────────────────────────────
//
// 关键词页**只**由关键词矩阵产生，所以「有没有关键词页」== 「选中的非主关键词有没有」。两个地方要问这件事：
// ① 关键词页真去生成（§main 的 Call 2）；② Call 1 的提示词（`hasKeywordPages`）。
// 🔴 **抽成一个函数是承重的，不是整理**：两份实现必然漂，而漂的方向是「提示词说这个站有子页、生成那边说没有」
//    —— 那正是 #1139 量到的形状（66 个互异站里 221 个实例只有 14 个渲染出卡片）。
// #1550 —— 这一步只回「哪些词要建页」（Call 1 之前，服务 id 还没有）；URL（`services/<id>/<slug>`）在 Call 1 之后由
//    `lib/keyword-pages.js §planKeywordPages` 定，不再在这里从服务名推 `<服务>/<词>`。
function keywordPagesFrom(keywords, services) {
  return { keywordPagesList: kwPages.keywordPageCandidates(keywords, services) };
}

// #1548 做什么 6（Chris 2026-10-03）—— 事实只许来自建站表格。产出里有没有编造由 T5 #1549 查；这里只负责「告诉它」。
// 📌 它下面原来那行「For stats, use realistic numbers (e.g. "15+")」跟它打架（「15+ 年」就是编的年份），#1548 交给 T5 —— #1549
//    已把那一行改成「只用表单给的数字」，两句不再冲突；这一句里「wins over … the stats example」留着，是给将来再加例子的人看的。
const FACTS_ONLY_FROM_FORM_RULE = '- FACTS ONLY FROM THE FORM: years in business, licenses / insurance / certifications, prices, review counts and service areas may be stated ONLY when the business details above give them — if they are not given, do not write them. This rule wins over every other line here, including the stats example below.';

async function generateContent(opts) {
  const {
    companyName, industry, location, rawLocation, address, phone, email,
    services, usp, targetCustomers, brandDescription,
    theme, languageName, refSite, refPrefs = [], refAnalysis = null,
    reviews = [], onlinePresence = {}, hours, priceRange, uploadedImages = [],
    logoUrl = '',
    // TICKET-140: per-locale brand inputs (136 regression). defaultLocale is
    // always set by the main-scope `normalizeLocale(language) || 'en'`, so no
    // default is needed; brandNameByLocale = {} guards against the dashboard
    // omitting the field entirely.
    defaultLocale, brandNameByLocale = {},
    siteUrl, // #1547
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
    // #1346 —— 后台关掉的块。缺省空数组 ⟹ 不传这个字段的调用方拿到的提示词跟改之前逐字节相同。
    disabledBlocks = [],
    // #1548 —— 关键词那一段（`lib/target-keywords.js` §keywordBrief，没有词时是空串）与 Lead 站的补充说明。
    keywordBrief = '',
    additionalContext = '',
    // #1568 —— 站级那一通回来之后算每页的目标词（slug → 词）：首页 / 服务详情页按 T4 的分配。纯函数，由 main 传（它手上有 keywords）。
    pageTargetKeywords = () => ({}),
    // #1568 r2 —— 要建关键词页的那些词（`keywordPagesFrom` 的候选）：站级回包的页面清单里撞上它们的页丢掉（关键词页由 Call 2 建）。
    keywordPageKeywords = [],
  } = opts;

  // #1346 —— 一个块被关掉之后，提示词里**三个地方**都不能再提它：菜单（下面那两处
  // `blockPromptSection`）、写死的页面规则那两行、以及 Call 2 的服务子页提示词（它不点名块）。
  // 漏掉任何一处的形态都一样：菜单里没有、正文却要求，模型两条要求对不上。
  const blockOff = new Set(disabledBlocks);
  const keepBlocks = (types) => types.filter((t) => !blockOff.has(t));
  // #1549 做什么 4 —— 子页 title 的预算按主语言的品牌名算（跟 seoProblems 第 1 条同一个数）。
  const titleSpec = pageTitleSpec(brandNameRecord(companyName, brandNameByLocale, defaultLocale)[defaultLocale]);
  const quotedList = (types) => types.map((t) => `"${t}"`).join(', ');
  // 🔴 什么都没关掉时，这三行**逐字节**等于 #1346 之前写死的那三行（判据在
  // `scripts/lib/catalog-disabled.test.js` ④：两臂比同一份提示词的这一段）。整条规则里的块全被关掉
  // 时那一行整条不印 —— 印一条空的 `must include:` 就是在告诉模型「这一页什么都不用有」。
  // #1498 —— content 在 manifest 里只能挂一个提示词组（它挂 homepage，接替 content-split），而它同时接替
  //    text-block 做内页正文（text-block 在 page-specific 组）。所以在 page-specific 那一段后面补一行指向它。
  //    🔴 content 被关掉时整行不印（连前面的换行一起），提示词逐字节等于没有这一行时。
  const contentNewPageLine = blockOff.has('content') ? ''
    : '\n- "content" (listed under HOMEPAGE SECTIONS above) is also the block for the main text of an inner page'
      + ' — About, a service page, a policy page: use textStyle article, and write body in its markdown subset';
  const pageRuleLines = (() => {
    const lines = [];
    // #1425（T3）—— 服务页原来是 services-nav + services-list（两个旧块，#1505 定不做新块）：改成 `features` +
    //    引用写法，items 指向本站服务目录，内容只存一份（Chris 2026-09-30 #1505）。
    const services = keepBlocks(['page-header', 'features', 'cta']);
    if (services.length) lines.push(`- SERVICES pages must include: ${quotedList(services)}`);
    if (!blockOff.has('features')) lines.push('  features on a SERVICES page: write "items": {"source": "services"} (the list comes from this website\'s services) — never type the services out');
    // 报价页原来是 quote-form（旧块）：新库里表单住在 contact 块上（槽 `form`，站级表单库 #1471）。
    const quote = keepBlocks(['page-header', 'contact']);
    if (quote.length) lines.push(`- QUOTE pages must include: ${quotedList(quote)}`);
    return lines.join('\n');
  })();
  // ══ #1346 r3 —— CRITICAL RULES 那一段里的块名，同样一个都不许写死 ══════════════════════════
  //
  // QA1 / QA2 在 r2 上各自独立量到同一个读数：**32 个块逐个关一遍，有 11 个在提示词里仍被点名**，
  // 其中 6 行是【祈使句】—— 菜单已经把那个块剔掉了，正文却还在命令模型去用它。模型两条要求对不上，
  // 代价实测有两种、取决于它那一次听不听话：要么第一遍 14 处不合规、重试一次才过（每个新站白烧一次
  // Call 1b，$0.67 vs $0.23，而且退出码 0、只有翻 stderr 才看得见），要么重试后仍不合规 ⟹
  // `:2392` fatal，那一天起每个新站都建不出来。两种都不是「以后别再选它」的意思。
  //
  // 🔴 下面每一行在**什么都没关**时逐字节等于 #1346 之前那一行（判据：`catalog-disabled.test.js` ⑧
  //    拿 origin/main 那棵树的提示词整份比）。整条规则里的块全被关掉时，那一行整条不印 ——
  //    印一条只剩半句的规则，比不印更容易被模型读成别的意思。
  const ruleIfAnyOn = (types, render) => {
    const on = keepBlocks(types);
    return on.length ? render(on, new Set(on)) : null;
  };
  const criticalBlockRules = (() => {
    const lines = [
      // 非首页的开头 / 结尾各点名一个块，两半各自可以掉。
      ruleIfAnyOn(['page-header', 'cta'], (_on, set) => '- Non-home pages should use 3-8 sections.'
        + (set.has('page-header') ? ' Always start with "page-header".' : '')
        + (set.has('cta') ? ' End with "cta" when appropriate.' : ''))
        || '- Non-home pages should use 3-8 sections.',
      // #1419 —— 这里原来还有两条让 AI 挑外观的话（page-header 与正文块换着用，SERVICES 页的 CTA 别用
      // "solid"）。AI 写的那个字段没人读，形态归取值链，所以两条都删了。
    ];
    return lines.filter(Boolean).join('\n');
  })();
  // 「一共有几种块」这句话是**说给模型听的目录事实**，关掉一个它就当场变成假话。类型数现算；
  // 📌 这句话后半原来还有一个 `130+`（形态总数，而且本来就数不准），#1419 随 AI 不再挑形态一起删了。
  // 🔴 **外壳区（`region: true`）不算一种 section type**（#1353）。这句话是说给模型听的「你能往
  //    页面上放几种东西」，而顶栏 / 页脚既不在下面那份菜单里（它们的 manifest 没有 `prompt` 段），
  //    模型也永远不能把它们写进 `sections`。不滤掉的话，本票把 blocks/ 从 32 份加到 34 份那一刻，
  //    这句话就从 32 变成 34 —— 多出来的两个模型一个都点不到，而「关掉一个块 ⟹ 提示词只少那一处」
  //    那道守卫会因此在一条跟它无关的差异上变红（#1353 r5 就是这么红的）。
  const offeredTypeCount = [...loadBlockManifests().keys()]
    .filter((t) => !blockOff.has(t) && !isRegionManifest(BLOCK_MANIFEST_DIR, t)).length;
  // 举例里点名的块同样要过滤；两个例子都没了就只留那句「把顺序变一变」。
  const varySectionOrderRule = (() => {
    const ex = [];
    if (!blockOff.has('milestones') && !blockOff.has('features')) ex.push('A dental site might lead with milestones + features written as steps.');
    if (!blockOff.has('features') && !blockOff.has('testimonials')) {
      ex.push('A security site might prioritize features + testimonials.');
    }
    return ['- Vary the section ORDER.', ...ex].join(' ');
  })();
  // 这一行说的是 gallery 这个**块**的 data 怎么填（不是 gallery 那个页面原型）。
  const galleryItemsRule = blockOff.has('gallery') ? null
    : '- For gallery items, use project/work descriptions. If uploaded images are available, set imageUrl on items; otherwise the component renders gradient placeholders.';
  // 「每样各生成几条」那一行把数量绑在**块**上（6 条评价 / 4-6 条 FAQ / …）。它不是祈使句
  // （末尾自己写着 if you use those sections），但块被关掉之后那一格就是在让模型白写内容 ——
  // 而且它落在 CRITICAL RULES 里，留着会让「这一段里 0 命中」那条判据必须开例外。一起滤掉（#1346 r3）。
  // `6-8 services` 与 `3-5 benefits` 不绑任何块（services 是生意的服务，benefits 是槽位），恒留。
  const contentAmountsRule = (() => {
    const bound = [
      ['testimonials', '6 unique testimonials'],
      ['faq', '4-6 FAQ items'],
      ['features', '3-4 process steps'],
      ['pricing', '2-3 pricing tiers'],
    ].filter(([t]) => !blockOff.has(t)).map(([, text]) => text);
    // #1425（T3）—— 原来这里还有一格「3-4 social proof badges/platforms」（social-proof，旧块）；它的四样东西
    //    分到了 testimonials / milestones / logos / features（#1488 / #1504），各自已在上面或菜单里。
    const social = [];
    const parts = ['6-8 services', ...bound, '3-5 benefits', ...social];
    const body = parts.length > 1
      ? `${parts.slice(0, -1).join(', ')}, and ${parts[parts.length - 1]}`
      : parts[0];
    const tail = (bound.length || social.length) ? ' if you use those sections' : '';
    return `- Generate ${body}${tail}.`;
  })();
  // 配方关着时走的那一行「挑两个别人不会有的块」—— 举例名单同样过滤（#1346 r3）。
  const rareSectionExamplesRule = (() => {
    const ex = keepBlocks(['milestones', 'logos', 'team', 'gallery']);
    return ex.length
      ? `- Include at least TWO sections that most sites wouldn't have (e.g., ${ex.join(', ')}).`
      : '- Include at least TWO sections that most sites wouldn\'t have.';
  })();
  const ctaHrefRule = ruleIfAnyOn(['hero', 'cta'], (_on, set) => '- CTA hrefs in '
    + [set.has('hero') ? 'hero sections' : null, set.has('cta') ? 'cta sections' : null].filter(Boolean).join(' and ')
    + ' should point to "/<ctaPage slug>".');

  // 服务详情页那一行同样是写死的块名清单（#1346）。
  // #1425（T3）—— 原来是 content-split · process-steps OR card-group · faq-accordion · service-related-pages · cta-banner。
  //    「A OR B」那一格塌成 `features` 的两种写法（卖点 / 步骤，同 keyword-page-options.js）；关键词子页那一格
  //    （service-related-pages，#1505 定不做新块）改成第二个 `features`，items 用引用写法指向这个服务底下的页。
  const serviceDetailSectionRule = (() => {
    const parts = [
      ...keepBlocks(['page-header', 'content']),
      ...(blockOff.has('features') ? [] : ['features (selling points, or steps numbered "01" "02"…)']),
      ...keepBlocks(['faq']),
      // #1550 —— 「第二个 features 列出这个服务下的关键词页」不再让 AI 写：under 必须是 `services/<id>`，由代码加
      //    （`lib/keyword-pages.js §ensureServiceDetailPages`），AI 写的那份 under 常常指错。
      ...keepBlocks(['cta']),
    ];
    return parts.join(', ');
  })();

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
    ? `\nLANGUAGE: Write ALL content in ${languageName}.${chineseVariantHint(languageName)} This includes: taglines, descriptions, headlines, subheadlines, testimonial quotes, FAQ answers, service names, navigation labels, page titles, meta descriptions, keywords, and all other user-facing text. Only JSON keys and technical values (slugs, hrefs, icon names, section type names) should remain in English.\n`
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
  // #1551 —— 营业时间：老板写了才问 AI，而且只让它**转写**这一句（下面 JSON 结构里 openingHours 那一行也只在这时出现）；
  //    转写回来由 §verifyTranscription 再核一遍。没写 ⟹ 提示词里一个字都不提，不给样例（写死的样例会被原样抄回来）。
  if (hours) businessContext += `\nHOURS OF OPERATION: ${hours}\n(For seo.openingHours: transcribe ONLY these hours — English day names, 24-hour HH:MM, one entry per distinct time range, leave closed days out. Never add a day or a time that is not in this text.)`;
  if (priceRange) businessContext += `\nPRICE RANGE: ${priceRange}`;
  if (additionalContext) businessContext += `\nADDITIONAL CONTEXT FROM THE OWNER: ${additionalContext}`;

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
For "reviews" sections: use real platform data —${ratingSummary || ' generate realistic numbers based on the reviews above.'}
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
- Each page needs 5-7 sections: ${serviceDetailSectionRule}
- Vary layouts across service detail pages — don't repeat the same structure
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
- "hero": set image.imageUrl on the hero data to show the best/most general business photo
- "content": set image.imageUrl to show a relevant photo next to the text
- "gallery": set image.imageUrl on individual items to show the photos in the gallery grid
- Match images to sections by filename context (e.g., "storefront.jpg" → hero, "team.jpg" → about page content, "product1.jpg" → gallery item)
- You may reuse the same image URL across multiple sections if it fits
- If there are more sections than images, **OMIT the imageUrl field entirely** (do not write the key). Do NOT invent placeholder strings like "gradient-about", "tbd", "placeholder", or any descriptive name — only valid paths starting with "/" or "http(s)://" are acceptable. The template will render a gradient automatically when imageUrl is absent.`;
  }

  progress('AI is writing content...', 15);

  // ══ #1568 —— Call 1 按页拆：站级一次 + 每页一次 ═══════════════════════════════════════════════════════
  //
  // 以前这里是**一次**调用、一个回包写全站（品牌 / SEO / 服务 / 每一页的 sections）。7 个服务的中文站那一个回包撞上输出上限
  // （Chris 2026-10-04 site-7f87c5c3：等了 424 秒、花了 $0.51，`truncated`，整站失败）。现在照 Call 2（#1550）的形状拆成两步：
  //   ① 站级一次（prompt 名 `Base Site`）：品牌 / 导航 / SEO / 服务 / 表单 + 页面清单，每页带一句 `brief`（这一页承载什么），不写 sections；
  //   ② 每页一次（prompt 名 `Page: <slug>`）：只写这一页的 sections。提示词只带站级结构 + 这一页的目标词 + 表格里的事实 + 块菜单。
  // 一页不合格 / 调不通只重试这一页一次；仍不行 ⟹ 建站失败并写明是哪一页（T5 #1549 对首页 / 服务详情页 / 其它页的处置）。
  const brandNameRule = `CRITICAL BRAND NAME RULE (TICKET-137):
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
  ✓ "Welcome to Happy Paws Pet Grooming"`;
  const iconsBlock = `AVAILABLE ICONS (pick the most relevant for each service):
${availableIcons.join(', ')}`;

  const sitePrompt = `You are an expert SEO copywriter AND website planner. Generate the site-wide content AND the page plan for a local service business. Each page's sections are written afterwards, one page at a time, from the plan you give here — so do NOT write any sections. Return ONLY valid JSON, no markdown fences, no explanation.

BUSINESS DETAILS:
- Company Name: ${companyName}
- Industry: ${industry}
${location ? `- Primary Location: ${location}` : ''}
${languageInstruction}
${servicesInstruction}${keywordBrief ? `\n\n${keywordBrief}` : ''}
${contactInstruction}
${businessContext}
${socialLinksInstruction}
${refSiteInstruction}
${pagesInstruction}

${brandNameRule}

${iconsBlock}

Generate a JSON object with this EXACT structure:

{
  "colorScheme": "<light or dark — the whole site's colour scheme, picked from the industry: dark for businesses whose look is naturally dark and moody (bar, nightclub, gym, tattoo studio, barbershop, cocktail lounge); light for everything else (dentist, law firm, clinic, home services, accounting, most shops)>",
  "brand": {
    "tagline": "<catchy tagline, max 60 chars>",
    "logoIcon": "<icon from list>",
    "email": "${email || '<realistic email>'}",
    "locations": [{ "label": "<name>", "address": "${address || rawLocation || '<City, Province, Country>'}", "phone": "${phone || '<phone>'}" }]
  },
  "navigation": {
    "ctaLabel": "<CTA button text, max 25 chars>",
    "ctaPage": "<slug of the CTA target page, e.g. quote>",
    "footerDescription": "<1 sentence with location + primary keyword>"
  },
  "seo": {
    "siteTitle": "<max 60 chars>",
    "siteDescription": "<70–155 chars, location + services + CTA>",
    "areaServed": [{"type":"City","name":"<city>"}],
    "addresses": [{"locality":"<city>","region":"<province code>","country":"<country code>"}],
${hours ? '    "openingHours": [{ "days": ["<English day name>", "..."], "opens": "<HH:MM>", "closes": "<HH:MM>" }],\n' : ''}    "priceRange": "$$",
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
  "forms": [
    { "id": "quote", "name": "<form name, max 60 chars>", "buttonText": "<submit button, max 40 chars>", "successMessage": "<thank-you line, max 200 chars>" },
    { "id": "contact", "name": "<form name, max 60 chars>", "buttonText": "<submit button, max 40 chars>", "successMessage": "<thank-you line, max 200 chars>" }
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
      "brief": "<what this page must cover>"
    },
    {
      "slug": "<page-slug>",
      "title": "<Page Title, ${titleSpec}>",
      "description": "<Page meta description, 70–155 chars>",
      "navLabel": "<Short nav label>",
      "navOrder": 1,
      "changeFrequency": "weekly|monthly",
      "priority": 0.9,
      "brief": "<what this page must cover>"
    },
    {
      "slug": "services/<service-id>",
      "title": "<Service Name>",
      "description": "<meta description for this service>",
      "navLabel": "<Service Name>",
      "navOrder": 10,
      "changeFrequency": "monthly",
      "priority": 0.8,
      "serviceDetailPage": true,
      "parentService": "<service-id>",
      "brief": "<what this page must cover>"
    }
  ]
}

CRITICAL RULES:
- "services" array must contain EXACTLY the services listed above: ${servicesList.join(', ')}. Do NOT add or remove any.
- "forms" are the site's two lead forms (#1471): "quote" (asks for name, phone and which service) and "contact" (name, email, message). Their fields are FIXED — write only the visitor-facing words (name, buttonText, successMessage) to fit this business.
- "pages" is an ARRAY of page objects, each with slug, title, description, navLabel, navOrder, changeFrequency, priority, and brief.
- Every page's "brief": 2-3 sentences, in the site's language, saying what that page must cover — its main points, specific to this business. The page's sections are written later from it: do NOT write "sections".
- navOrder determines the order in the navigation. Home is always 0. Assign sequential numbers (1, 2, 3...) to other pages.
- The CTA page (navigation.ctaPage) should have a higher navOrder so it appears last (but it won't be in the header nav — it becomes the CTA button).
${FACTS_ONLY_FROM_FORM_RULE}
- Page titles (pages[].title): ${titleSpec}. The home page's <title> is seo.siteTitle, used as-is: max 60 chars. Every meta description (seo.siteDescription and pages[].description): 70–155 chars.
- Use specific language, not generic fluff.
- Include location names naturally in content.
- Service detail pages (slug "services/{id}") must set serviceDetailPage: true and parentService: "{service-id}".
- Service detail pages should NOT appear in the header nav — they go in the footer only.`;

  emit('prompt', { name: 'Base Site', content: sitePrompt });
  progress('AI is planning the site...', 20);

  // TICKET-132: callAIWithRetry retries up to 3 times on JSON.parse failures
  // (AI hallucinating malformed JSON). max_tokens still throws immediately
  // (prompt-size issue, retry won't help).
  const call1Start = Date.now();
  let ai, response;
  try {
    const result = await callAIWithRetry({
      client,
      baseOptions: { model, max_tokens: maxTokens, messages: [{ role: 'user', content: sitePrompt }] },
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
      fatal('AI response was truncated (hit token limit) while planning the site.');
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
  debug(`Call 1 site plan cost: $${cost1.toFixed(4)} (${usage1.input_tokens} in / ${usage1.output_tokens} out, ${call1Duration}s)`);

  // 站级回包里的页面清单：每页要有 slug（文件名就是它）。sections 不归这一通管 —— 写回来了也丢掉，由下面每页那一通写。
  ai.pages = (Array.isArray(ai && ai.pages) ? ai.pages : []).filter((p) => p && typeof p === 'object' && typeof p.slug === 'string' && p.slug.trim());
  for (const p of ai.pages) delete p.sections;
  // #1568 r2 —— 关键词页不归这一通：它写进页面清单的关键词页丢掉（Call 2 按 T6 的计划建，否则同一个词两张页、两份调用费）。
  //    放在收服务 id 之前：判「是不是服务详情页」用的是这一通回来的原样 id。
  {
    const { pages: kept, dropped } = kwPages.dropKeywordPagesFromPlan({
      pages: ai.pages,
      keywords: keywordPageKeywords,
      serviceIds: (Array.isArray(ai.services) ? ai.services : []).map((s) => s && s.id),
      keep: ai.navigation && typeof ai.navigation.ctaPage === 'string' ? [ai.navigation.ctaPage] : [],
    });
    for (const d of dropped) debug(`[pages] 站级回包里的「${d.slug}」${d.why} ⟹ 丢掉，关键词页由代码按计划建（#1568）`);
    ai.pages = kept;
  }
  if (!ai.pages.length) fatal('The site plan from the AI has no pages (#1568: Call 1 site-level answer without a usable "pages" list).');

  // #1565 —— 服务 id 是 AI 写的，会原样变成文件名（pages/services/<id>.json）：收进跟关键词页 slug 同一个上限。
  //    #1568 —— 放在站级那一通之后、每页那几通之前：每页的提示词里给的就是收过的 id（链接按它写）。
  const idRenames = kwPages.capServiceIds({ services: ai.services, pages: ai.pages, navigation: ai.navigation });
  for (const r of idRenames) {
    debug(`[services] AI 写的服务 id 有 ${Buffer.byteLength(r.from)} 字节，超过文件名能放的上限，网址改用 ${r.to}（${Buffer.byteLength(r.to)} 字节）`);
  }

  // ── ② 每页一次 ──────────────────────────────────────────────────────────────────────────────────
  const forms = siteFormsFrom(ai.forms);
  const pageKeywords = (() => {
    try { return pageTargetKeywords(ai) || {}; } catch (e) { debug(`[pages] 目标词算不出来（${e.message}），每页提示词不带目标词`); return {}; }
  })();
  // 每页提示词里的「事实」：营业时间那句只对站级那一通的 seo.openingHours 有意义，页里只留原文。
  const pageBusinessContext = businessContext.replace(/\n\(For seo\.openingHours:[^\n]*\)/, '');
  const svcById = new Map((Array.isArray(ai.services) ? ai.services : []).filter((s) => s && s.id).map((s) => [s.id, s]));
  const hrefOf = (slug) => (slug === 'home' ? '/' : `/${slug}`);
  const siteLines = [
    ai.brand && ai.brand.tagline ? `- Tagline: ${ai.brand.tagline}` : null,
    '- Services (id → name: short description):',
    ...[...svcById.values()].map((s) => `  - ${s.id} → ${s.name}${s.shortDescription ? `: ${s.shortDescription}` : ''}`),
    '- Pages of this website (link to them with these hrefs):',
    ...ai.pages.map((p) => `  - "${hrefOf(p.slug)}" — ${p.navLabel || p.title || p.slug}`),
    ai.navigation && ai.navigation.ctaPage ? `- Call-to-action page: "/${ai.navigation.ctaPage}"${ai.navigation.ctaLabel ? ` (button text "${ai.navigation.ctaLabel}")` : ''}` : null,
    `- Forms: ${forms.map((f) => `"${f.id}"${f.name ? ` (${f.name})` : ''}`).join(', ')}`,
  ].filter((l) => l !== null).join('\n');

  const pagePromptFor = (page) => {
    const isHome = page.slug === 'home';
    const svc = page.serviceDetailPage === true ? svcById.get(page.parentService) || svcById.get(page.slug.replace(/^services\//, '')) : null;
    const kw = typeof pageKeywords[page.slug] === 'string' ? pageKeywords[page.slug] : '';
    const thisPage = [
      `- slug: "${page.slug}"`,
      page.title ? `- title: ${page.title}` : null,
      page.description ? `- meta description: ${page.description}` : null,
      page.brief ? `- what it must cover: ${page.brief}` : null,
      kw ? `- target keyword: "${kw}" — use that exact phrase in the page's single H1 (the "headline" of its one "hero" or "page-header" section), within its first 100 words, and in at least two H2s (the "headline" of other sections).` : null,
      isHome ? '- This is the HOME page. Choose 7-10 sections — the homepage must feel unique: do NOT use all sections, pick what fits the industry.'
        : svc ? `- This is the detail page of the service "${svc.name}" (id ${svc.id}). It needs 5-7 sections: ${serviceDetailSectionRule}. Write unique, detailed SEO content for this service.`
          : null,
    ].filter((l) => l !== null).join('\n');
    const rules = [
      '- Return {"sections": [ ... ]}: this page\'s sections in order, each { "type": "<section type>", "data": { ... } } as described under AVAILABLE SECTION TYPES.',
      '- Any block with a "form" slot uses one of the site\'s two forms: leave "form": {} (= the first form, "quote") or set "form": { "id": "contact" }.',
      ...(isHome ? [
        `- There are ${offeredTypeCount} section types. USE THIS VARIETY. Each site should feel different.`,
        varySectionOrderRule,
        homeRecipe ? recipePromptLines(homeRecipe, disabledBlocks) : rareSectionExamplesRule,
      ] : [criticalBlockRules]),
      contentAmountsRule,
      FACTS_ONLY_FROM_FORM_RULE,
      '- For stats, use ONLY numbers the business details above give (years, counts, prices, ratings). When they give none, use values without an invented number (e.g. "24/7", "Same-day", "Local") — never make one up.',
      galleryItemsRule,
      '- Every image object you write ({"imageUrl", "alt"}) gets an "alt": one plain sentence saying what the photo shows (no "image of").',
      '- Use specific language, not generic fluff. Testimonials should mention the company name.',
      '- Include location names naturally in content.',
      ctaHrefRule,
    ].filter(Boolean).join('\n');
    return `You are an expert SEO copywriter AND web layout designer. Write the sections of ONE page of a local service business website — its copy AND its layout. The site-wide content and the page plan are already decided (below): follow them, do not change them. Return ONLY valid JSON, no markdown fences, no explanation.

BUSINESS DETAILS:
- Company Name: ${companyName}
- Industry: ${industry}
${location ? `- Primary Location: ${location}` : ''}
${languageInstruction}
${contactInstruction}
${pageBusinessContext}
${reviewsInstruction}
${socialLinksInstruction}
${refSiteInstruction}
${imagesInstruction}

THE SITE (already decided):
${siteLines}

THIS PAGE:
${thisPage}

${brandNameRule}

${iconsBlock}

AVAILABLE SECTION TYPES:
You are a layout designer. For this page, you choose WHICH sections to include and in WHAT order. Not every page needs every section. Mix it up based on what makes sense for this industry.

HOMEPAGE SECTIONS (pick 7-10 from these, in any order):
${blockPromptSection('homepage', undefined, { ...(isHome && homeRecipe ? { order: homeRecipe.promptOrder } : {}), omit: disabledBlocks })}

PAGE-SPECIFIC SECTION RULES:
${blockPromptSection('page-specific', undefined, { omit: disabledBlocks })}${contentNewPageLine}
${pageRuleLines}

BUTTONS:
${BUTTON_REF_PROMPT}

RULES:
${rules}`;
  };

  // 回包取 sections：要的是 {"sections": [...]}；直接回数组、或包在 {page: {...}} 里的也认（模型偶尔这么回）。
  const sectionsOf = (got) => {
    if (Array.isArray(got)) return got;
    if (got && Array.isArray(got.sections)) return got.sections;
    if (got && got.page && Array.isArray(got.page.sections)) return got.page.sections;
    return null;
  };
  const N = ai.pages.length;
  // 提示词**先全部算好、全部发出去**，再开始调用：发射顺序 = 页面清单的顺序（日志可读、可比），
  // 而且任何一页建站失败（fatal 当场退出）都不会让后面那几页的提示词从日志里消失。
  const prompts = ai.pages.map((p) => pagePromptFor(p));
  ai.pages.forEach((p, i) => emit('prompt', { name: `Page: ${p.slug}`, content: prompts[i] }));
  debug(`[pages] 站级那一通给了 ${N} 页：${ai.pages.map((p) => p.slug).join(' · ')}；每页一次调用，≤${PAGE_CONCURRENCY} 页同时在飞`);

  const pageFatal = (i, why) => fatal(`Page ${i + 1}/${N} "${ai.pages[i].slug}" could not be generated after one retry (#1568): ${why}`);
  let pagesDone = 0;
  const onePage = async (i) => {
    const page = ai.pages[i];
    const isHome = page.slug === 'home';
    const where = `第 ${i + 1}/${N} 页（${page.slug}）`;
    const call = async (messages, detail) => sectionsOf((await callAIWithRetry({
      client,
      baseOptions: { model, max_tokens: maxTokens, messages },
      costContext: { operation: 'create-site', detail, pricing, durationStart: Date.now() },
      label: `Call 1 page ${page.slug}`,
    })).parsed);
    // 一页的判据：块库逐块那几条（scope 'edit' = 只查这一页自己；「整个站里没有 X」那一条等全部页回来再查）+ 首页骨架配方。
    const problemsOf = (sections) => {
      if (!sections) return { block: ['回包里没有 sections 数组'], skin: [] };
      const trial = { ...page, sections };
      return {
        block: validateBlocks({ pages: [trial], industry, disabledBlocks, forms, scope: 'edit' }).problems,
        skin: isHome && homeRecipe ? recipeProblems([trial], homeRecipe) : [],
      };
    };
    const finish = (sections) => {
      pagesDone += 1;
      progress(`Page ${pagesDone}/${N} written: ${page.slug}`, 25 + Math.round((15 * pagesDone) / N));
      return sections;
    };

    let first;
    try {
      first = await call([{ role: 'user', content: prompts[i] }], `Page ${page.slug}`);
    } catch (e) {
      // 调不通（截断 / API 错 / 解析不了）⟹ 重来一次这一页，别的页不动。
      debug(`[pages] ${where} 调用失败：${e.message} —— 重试第 ${i + 1} 页`);
      let again;
      try { again = await call([{ role: 'user', content: prompts[i] }], `Page ${page.slug} (retry)`); } catch (e2) { return pageFatal(i, `AI call failed twice: ${e2.message}`); }
      const p = problemsOf(again);
      if (p.block.length) return pageFatal(i, `the retry still breaks the block library:\n  ${p.block.join('\n  ')}`);
      if (p.skin.length) debug(`[fingerprint] ⚠️  ${where} 首页开场仍跟配方对不上,放行:\n  ${p.skin.join('\n  ')}`);
      return finish(again);
    }
    const p1 = problemsOf(first);
    if (!p1.block.length && !p1.skin.length) return finish(first);

    // 不合格 ⟹ 把问题原样退给它、只重试这一页一次（#999 的「只重试一次」，#1034 的骨架问题跟它进同一次重试）。
    const all = [...p1.block, ...p1.skin];
    debug(`[pages] ${where} 第一次有 ${all.length} 处不合规(块库 ${p1.block.length} · 首页骨架 ${p1.skin.length}) —— 重试第 ${i + 1} 页:\n  ${all.join('\n  ')}`);
    let second;
    try {
      second = await call([
        { role: 'user', content: prompts[i] },
        { role: 'assistant', content: JSON.stringify({ sections: first }) },
        { role: 'user', content: `Your sections for the page "${page.slug}" break the block library rules below. Fix ONLY these and `
          + `respond AGAIN with the COMPLETE JSON for this page ({"sections": [ ... ]}, no markdown fences):\n`
          + all.map((x) => `- ${x}`).join('\n') },
      ], `Page ${page.slug} (re-check)`);
    } catch (e) {
      // 只差首页骨架时第一次那份本来就能用（骨架问题不让建站失败，见下面 afterRetry 那一段）。
      if (!p1.block.length) { debug(`[fingerprint] ⚠️  ${where} 为骨架发起的重试调不通（${e.message}），用第一次那份`); return finish(first); }
      return pageFatal(i, `AI call failed on the retry: ${e.message}`);
    }
    const p2 = problemsOf(second);
    // #1034 —— 判决写在 lib/homepage-recipe.js 的 afterRetry() 里:'fatal' = 块库两次都不合格;
    // 'revert' = 第一次块库干净、只因骨架撞车才重试，而重试把块库改坏了 ⟹ 退回第一次。
    switch (afterRetry({ firstBlockProblems: p1.block.length, retryBlockProblems: p2.block.length })) {
      case 'fatal':
        return pageFatal(i, `this page's layout still breaks the block library after a retry:\n  ${p2.block.join('\n  ')}`);
      case 'revert':
        debug(`[fingerprint] ⚠️  ${where} 重试(只为首页骨架发起的)把块库改坏了 ${p2.block.length} 处,退回第一次那份:\n  ${p2.block.join('\n  ')}`);
        return finish(first);
      default:
        if (p2.skin.length) debug(`[fingerprint] ⚠️  ${where} 重试之后首页开场仍跟配方对不上,放行(不因为这个建不出站):\n  ${p2.skin.join('\n  ')}`);
        debug(`[pages] ${where} 重试之后块库检查通过`);
        return finish(second);
    }
  };
  const pageSections = await runPool(N, PAGE_CONCURRENCY, onePage);
  ai.pages.forEach((p, i) => { p.sections = pageSections[i]; delete p.brief; });
  // 每页那几通若仍写了收之前的长 id（链接 / under），套同一份 renames（#1565 的「页面里指着旧 id 的地方一起改」）。
  kwPages.renameServiceIds(idRenames, { pages: ai.pages });

  // ── 全站那一条（#999 第 ④ 条「整个站里没有 X」）：只有全部页都回来才问得了 ──────────────────────────────
  //    每页自己的毛病上面已经一页一页清掉了，这里剩下的只会是全站那一条。它交给首页那一通补一次（行业必需的块放首页最自然）；
  //    补完仍缺 ⟹ 建站失败（同 #999：再重试等于把「AI 今天不听话」变成看不见的账单）。
  {
    const whole = validateBlocks({ pages: ai.pages, industry, disabledBlocks, forms });
    // #1013 洞 1 —— 行业是自由文本，认不出来的写法一定存在；认不出来时这条检查的射程要说出来。
    for (const w of whole.warnings) debug(`[blocks] ⚠️  ${w}`);
    debug(`[blocks] 行业 "${industry}" 认出来是: ${whole.industryKeys.join(' / ') || '（一个都没认出来）'}`);
    if (whole.problems.length) {
      const hi = ai.pages.findIndex((p) => p.slug === 'home');
      const fixAt = hi >= 0 ? hi : 0;
      const target = ai.pages[fixAt];
      debug(`[blocks] 全部页回来之后整站还有 ${whole.problems.length} 处不合规，让第 ${fixAt + 1} 页（${target.slug}）补一次:\n  ${whole.problems.join('\n  ')}`);
      progress('Checking the layout against the block library...', 40);
      let fixed = null;
      try {
        const retry = await callAIWithRetry({
          client,
          baseOptions: {
            model,
            max_tokens: maxTokens,
            messages: [
              { role: 'user', content: prompts[fixAt] },
              { role: 'assistant', content: JSON.stringify({ sections: target.sections }) },
              { role: 'user', content: `The website as a whole breaks the block library rules below. Add what is missing to THIS page and `
                + `respond AGAIN with the COMPLETE JSON for this page ({"sections": [ ... ]}, no markdown fences):\n`
                + whole.problems.map((x) => `- ${x}`).join('\n') },
            ],
          },
          costContext: { operation: 'create-site', detail: `Page ${target.slug} (site re-check)`, pricing, durationStart: Date.now() },
          label: `Call 1 page ${target.slug} site re-check`,
        });
        fixed = sectionsOf(retry.parsed);
      } catch (e) {
        debug(`[blocks] 补的那一通调不通：${e.message}`);
      }
      const trial = ai.pages.map((p, i) => (i === fixAt && fixed ? { ...p, sections: fixed } : p));
      const after = validateBlocks({ pages: trial, industry, disabledBlocks, forms }).problems;
      if (!fixed || after.length) {
        fatal(`The generated layout still breaks the block library after a retry:\n  ${(after.length ? after : whole.problems).join('\n  ')}`);
      }
      target.sections = fixed;
      if (target.slug === 'home' && homeRecipe) {
        const skin = recipeProblems(ai.pages, homeRecipe);
        if (skin.length) debug(`[fingerprint] ⚠️  补过之后首页开场跟配方对不上,放行:\n  ${skin.join('\n  ')}`);
      }
      debug('[blocks] 补过之后块库检查全部通过');
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
  const brandName = brandNameRecord(companyName, brandNameByLocale, defaultLocale);
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

  // #1489 —— 地址 → 坐标，查一次存进站点数据（contact 的地图点开时要 bbox / marker）。页面打开时不查；
  //    查不到 / 网络错 ⟹ 不写 geo、地图不渲染，建站照常（geocodeBrand 不抛）。只查坐标，瓦片一张都不取（OSM 瓦片条款禁预取）。
  const geoResult = await geocodeBrand(brand, { log: debug });
  debug(`Geocode brand.locations[0]: ${geoResult}`);

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
        model: NANO_BANANA_MODEL, // #1251
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
  // collects every image slot (#1386 起按 manifest 现算，不再是写死的四个块名),
  // generates per-slot context-aware prompts, calls Nano
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
      manifests: loadBlockManifests(),
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
  const hoursCheck = verifyTranscription(hours, ai.seo && ai.seo.openingHours);
  if (hoursCheck.reason) debug(`[hours] 营业时间不出：${hoursCheck.reason}`);
  else if (hoursCheck.segments.length) debug(`[hours] 营业时间 ${hoursCheck.segments.length} 段，逐个小时数都在原文里`);
  const rating = ratingFrom(onlinePresence);
  const seo = {
    domain: siteUrl, // #1547：manager 给的地址，不再由 AI 编
    locale,
    siteTitle: ai.seo.siteTitle,
    siteDescription: ai.seo.siteDescription,
    verification: { google: "YOUR_GOOGLE_VERIFICATION_CODE" },
    schema: {
      areaServed: ai.seo.areaServed,
      addresses: ai.seo.addresses,
      // #1551 —— 营业时间只出核过的那几段；没写 / 核不过 ⟹ 没有这一项（JSON-LD 不出空壳，contact 那一行不画）。
      ...(hoursCheck.segments.length ? { openingHours: hoursCheck.segments } : {}),
      // #1551 —— 评分只在抓到真实平台评分时才有（§ratingFrom），不让 AI 编。
      ...(rating ? { aggregateRating: rating } : {}),
      priceRange: ai.seo.priceRange,
      offerCatalogName: ai.seo.offerCatalogName
    }
  };

  return { brand, navigation, seo, services: ai.services, pages: ai.pages, ai };
}

// ─── AI Keyword Page Generation (Call 2) ─────────────────────────────────────

// #1550 —— 同时在飞的关键词页调用数。一页一次调用，提示词只带这一页的素材；并发只为省时间，不影响结果。
// #1568 —— Call 1 的每一页用同一个数、同一个调度（§runPool）。
const PAGE_CONCURRENCY = 3;
const KEYWORD_PAGE_CONCURRENCY = PAGE_CONCURRENCY;

/** n 个任务（下标 0…n-1），最多 limit 个同时在飞；回结果数组，顺序同下标。Call 1 的每一页（#1568）与关键词页（#1550）共用。 */
async function runPool(n, limit, fn) {
  const results = new Array(n);
  let next = 0;
  const worker = async () => {
    while (next < n) {
      const i = next++;
      results[i] = await fn(i);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, n) }, worker));
  return results;
}

/**
 * 一页一次调用（#1550 正文做什么 1）。回每一页的结果，顺序同 `plan`：
 *   { entry, ok: true, page } | { entry, ok: false, problems: string[] }
 * 一页的判据：`lib/keyword-pages.js §keywordPageProblems`（slug 对不对、有没有 title / sections）+ `validateBlocks`
 * （参数形状同 Call 1 那两次；`scope: 'edit'` = 只查这一页自己，全站级那条「整个站里没有 X」不算到单页头上）。
 * 不合格就把问题原样退给它、**只重试这一页一次**；还不合格就是失败，别的页不受影响。
 */
async function generateKeywordPages(opts) {
  const {
    plan, payload, brand, seo, companyName, industry, location, languageName,
    additionalContext = '', sitePrimaryKeyword = '', forms,
    // #1549 —— 子页 title 的预算说法（§pageTitleSpec，主语言品牌名算出来的），跟 Call 1、seoProblems 第 1 条同一个数。
    titleSpec = 'max 60 chars',
    // #1346 —— 后台关掉的块。关键词页有它**自己**那份写死的块清单（`keyword-page-options.js`），关掉的块要从那里剔掉。
    disabledBlocks = [],
  } = opts;
  const sectionOptions = keywordPageSectionOptions({ disabledBlocks });
  const client = new Anthropic();
  const languageInstruction = languageName !== 'English'
    ? `\nLANGUAGE: Write ALL content in ${languageName}.${chineseVariantHint(languageName)} Only JSON keys and technical values (slugs, hrefs, icon names, section type names) should remain in English.\n`
    : '';
  const validate = (pg) => validateBlocks({ pages: [pg], industry, disabledBlocks, forms, scope: 'edit' }).problems;

  const one = async (entry) => {
    const prompt = kwPages.keywordPagePrompt({
      page: entry,
      material: kwPages.keywordPageMaterial(entry, payload),
      companyName, industry, location, languageInstruction,
      tagline: brand && brand.tagline, siteDescription: seo && seo.siteDescription,
      additionalContext, sectionOptions, sitePrimaryKeyword, titleSpec,
    });
    emit('prompt', { name: `Keyword page: ${entry.keyword}`, content: prompt });
    const call = async (messages, detail) => (await callAIWithRetry({
      client,
      baseOptions: { model, max_tokens: maxTokens, messages },
      costContext: { operation: 'create-site', detail, pricing, durationStart: Date.now() },
      label: `Call 2 ${entry.path}`,
    })).parsed;

    let got;
    try {
      got = await call([{ role: 'user', content: prompt }], `Keyword page ${entry.path}`);
    } catch (e) {
      return { entry, ok: false, problems: [`AI 调用失败：${e.message}`] };
    }
    let problems = kwPages.keywordPageProblems(got, entry, validate);
    if (problems.length) {
      debug(`[keyword-pages] ${entry.path} 第一次不合格（${problems.length} 处），只重试这一页：\n  ${problems.join('\n  ')}`);
      try {
        got = await call([
          { role: 'user', content: prompt },
          { role: 'assistant', content: JSON.stringify(got) },
          { role: 'user', content: kwPages.keywordPageRetryMessage(problems) },
        ], `Keyword page ${entry.path} (re-check)`);
      } catch (e) {
        return { entry, ok: false, problems: [`重试时 AI 调用失败：${e.message}`] };
      }
      problems = kwPages.keywordPageProblems(got, entry, validate);
      if (problems.length) return { entry, ok: false, problems };
    }
    got.keywordPage = true;
    applyBlockRoleDefaults([got]);
    return { entry, ok: true, page: got };
  };

  const results = await runPool(plan.length, KEYWORD_PAGE_CONCURRENCY, (i) => one(plan[i]));
  progress('Keyword pages done', 65);
  return results;
}

/**
 * #1550 —— 关键词页在 seoPass（#1549）之后的收尾。就地改 `content` 和 `kwReport`，最后发 `keyword-pages` 事件。
 *
 *   ① seoPass 丢掉的关键词页算进 `failed`（problems 是它的 SEO 问题），N/M 按**留下来的**页算。
 *   ② 一个服务下的关键词页一页都没留下：代码补的服务（PM ①(b)）撤掉、重算 seo.targetKeywords；AI 自己写的详情页留着，
 *      拿掉它上面指向这个服务的空列表。（PM 02:08 约束 1：组里没有页就没有父路径要立。）
 *   ③ 有关键词页留下来的服务，`/services/<id>` 必须存在并列出它下面的全部关键词页 —— 由代码保证，不靠提示词（正文做什么 4）。
 *      代码补出来的详情页**单独再过一次 seoPass**（同样的八条、重写一次、仍不合格建站失败 —— 跟 AI 写的服务页同一个待遇）。
 *      放在主 seoPass 之后补，是为了不让「下面一页都没留下」的服务因为一张本该撤掉的页建站失败。
 *   ④ 再跑一次 §ensureServiceDetailPages 只为把列表那一组指回 `under = services/<id>`：seoPass 重写过的详情页，回来的那一份里
 *      这一组不一定还对。这一次不该再补出页来（详情页是非关键词页，seoPass 不丢它），补出来了就是逻辑出错，建站失败。
 *   ⑤ 兄弟页那一组、相似度、页脚栏都按留下来的页算。兄弟页加在 seoPass 之后：多一个 H2 不碰八条里任何一条。
 */
async function finishKeywordPages({
  content, kwPlan, kwReport, kwOk, dropped = [], locale, disabledBlocks = [], industry, location, companyName, payload, assign,
}) {
  // ①
  const goneSlugs = new Set((dropped || []).map((d) => d.slug));
  for (const d of dropped || []) {
    const r = kwOk.find((x) => x.entry.path === d.slug);
    if (r) kwReport.failed.push({ keyword: r.entry.keyword, slug: d.slug, problems: d.problems });
  }
  // 🔴 按 slug 认、并把 `r.page` 换成站里**当前**那个对象（QA2 r2）：seoPass 重写成功的页是**另一个对象**
  //    （`content.pages[idx] = next`），按对象身份判就会把「被重写救回来」的页当成没留下 —— N/M 少算、页脚 / 兄弟页 / 相似度都没有它。
  //    后面 §addRelatedBlocks 就地改 `r.page`，所以光改判据不够，引用本身也得换。
  const current = new Map(content.pages.map((p) => [p.slug, p]));
  for (const r of kwOk) if (current.has(r.entry.path)) r.page = current.get(r.entry.path);
  const kept = kwOk.filter((r) => !goneSlugs.has(r.entry.path) && current.has(r.entry.path));
  kwReport.ok = kept.length;
  const keptServiceIds = [...new Set(kept.map((r) => r.entry.serviceId))];

  // ②
  for (const id of [...new Set(kwOk.map((r) => r.entry.serviceId))].filter((x) => !keptServiceIds.includes(x))) {
    if (kwReport.addedServices.some((a) => a.id === id)) {
      content.services = content.services.filter((x) => x.id !== id);
      kwReport.addedServices = kwReport.addedServices.filter((a) => a.id !== id);
      debug(`[keyword-pages] 服务 ${id} 是代码补的、下面一页都没留下 ⟹ 撤掉这个服务`);
    }
    const n = kwPages.removePagesListBlocks(content.pages.find((p) => p.slug === `services/${id}`), id);
    if (n) debug(`[keyword-pages] 服务 ${id} 下的关键词页一页都没留下 ⟹ 拿掉它详情页上那组空列表（${n} 块）`);
  }

  // ③
  const detail = kwPages.ensureServiceDetailPages({ pages: content.pages, services: content.services, serviceIds: keptServiceIds, locale, disabledBlocks });
  if (detail.failed.length) {
    fatal(`关键词页的父页面补不出来：服务 ${detail.failed.join(', ')} 在服务目录里没有（或没有名字），/services/<id> 会是 404`);
  }
  if (detail.patched.length) debug(`[keyword-pages] 详情页上「下面的关键词页」那组由代码填（under = services/<id>）：${detail.patched.join(', ')}`);
  const assignment = assign();
  content.seo.targetKeywords = assignment.targetKeywords;
  if (detail.added.length) {
    debug(`[keyword-pages] AI 没给这些服务生成详情页，代码补上了：${detail.added.map((id) => `/services/${id}`).join(', ')}`);
    const addedSlugs = new Set(detail.added.map((id) => `services/${id}`));
    const fresh = content.pages.filter((p) => addedSlugs.has(p.slug));
    const issues = validateBlocks({ pages: fresh, industry, disabledBlocks, forms: siteFormsFrom(content.ai && content.ai.forms), scope: 'edit' }).problems;
    if (issues.length) fatal(`代码补出来的服务详情页过不了块库检查：\n  ${issues.join('\n  ')}`);
    targetKw.applyPageKeywords(fresh, assignment.pageKeywords);
    writeImageAlts({ pages: fresh, manifests: loadBlockManifests(), industry, targetKeywordOf: seoTargetOf });
    // 只把这几页交给 seoPass（第 5 条「站内唯一」用的整站页表在这里就是这几页：代码只在 slug 空着时才补，不会撞）。
    const sub = { ...content, pages: fresh };
    await seoPass({ content: sub, payload, locale, industry, location, companyName, disabledBlocks });
    for (const pg of sub.pages) {
      const i = content.pages.findIndex((p) => p.slug === pg.slug);
      if (i >= 0) content.pages[i] = pg;
    }
  }

  // ④
  const again = kwPages.ensureServiceDetailPages({ pages: content.pages, services: content.services, serviceIds: keptServiceIds, locale, disabledBlocks });
  if (again.added.length || again.failed.length) {
    fatal(`seoPass 之后服务详情页不见了：${[...again.added, ...again.failed].map((id) => `/services/${id}`).join(', ')}`);
  }
  if (again.patched.length) debug(`[keyword-pages] seoPass 重写过的详情页，列表那一组重新指回 under = services/<id>：${again.patched.join(', ')}`);

  // ⑤
  const keptPages = kept.map((r) => r.page);
  const related = kwPages.addRelatedBlocks(keptPages, locale, disabledBlocks);
  debug(`[keyword-pages] ${related} 个关键词页页尾加了同服务兄弟页那一组`);
  // 相似度只记录（正文做什么 3）：每个留下来的新页对同站已有页（含别的关键词页；丢掉的页已不在 content.pages 里）取最像的那一页。
  kwReport.similarity = mostSimilarPages(keptPages, content.pages);
  for (const x of kwReport.similarity) debug(`[keyword-pages] 相似度 ${x.slug} 最像 ${x.mostSimilar || '（无）'}：${x.score}`);
  // 页脚每服务一栏（≤10 条 + 「全部 N 页 →」，N = 留下来的页数）。seoPass 删链接那段那时还没东西可删：栏是在这里才加的。
  content.navigation.footer.columns.push(...kwPages.keywordFooterColumns(keptPages, content.services, locale));

  debug(`[keyword-pages] 关键词页 ${kwReport.ok}/${kwReport.total} 成功`);
  for (const f of kwReport.failed) debug(`[keyword-pages] ❌ 没成功：「${f.keyword}」（${f.slug}）—— ${f.problems.join('；')}`);
  emit('keyword-pages', kwReport);
  return kwReport;
}

// ─── #1549: 每页生成后的 SEO 检查 ─────────────────────────────────────────────────────────────
//
// 设计文档 S2 / 正文做什么 3：
//   · 主语言的**每一页**跑一次 `seoProblems`（lib/seo-problems.js），日志每页一行 —— 全过的页在产物里跟没跑过一模一样，
//     所以「跑过」的证据只能是日志（验收 4）。次语言的页不在这里（它们是主语言页的翻译，在这之后才生成）。
//   · 有问题 ⟹ 带着问题**只重写那一页一次**（一页一次调用，几页并发）。重写回来的页再过一次块校验：它若新增了块库
//     问题，这次重写作废、用原来那页（宁可按原来那页的 SEO 问题处置，也不把块库改坏的页写进站）。
//   · 仍有问题 ⟹ 关键词页丢掉（日志「丢掉 <slug>：…」+「关键词页 N/M」，页脚里指向它的链接一起删）；
//     首页 / 服务页 / 没有目标词的页 ⟹ 建站失败，信息写明哪页哪条。没有目标词的页不丢：它们在导航里，丢了就是站内死链。
//   · 「关键词页 N/M」本票只进日志和 `seo-check` 事件。建站页显示的是 #1550 的 `keyword-pages` 事件（§finishKeywordPages，
//     在这里之后才算，所以这里丢掉的页也算进它的 N/M）。

/** 一页的目标词（T4 #1548 挂在 `page.seo.targetKeyword`）。 */
function seoTargetOf(page) {
  return page && page.seo && typeof page.seo.targetKeyword === 'string' ? page.seo.targetKeyword : '';
}

/** 一页的 seoProblems + 日志一行（验收 4 读的就是这一行：`[seo] 检查 <slug> · …`）。 */
function seoCheckPage({ page, content, payload, locale, tag = '检查' }) {
  const kw = seoTargetOf(page);
  const problems = seoProblems({ page, pages: content.pages, targetKeyword: kw, brand: content.brand, payload, locale, seo: content.seo });
  debug(`[seo] ${tag} ${page.slug} · 目标词 ${kw ? `「${kw}」` : '（无）'} · 跑了第 ${seoRulesFor(kw).join('/')} 条 · `
    + (problems.length ? `${problems.length} 条问题：\n    ${problems.join('\n    ')}` : '0 条问题'));
  return problems;
}

/** 重写一页的提示词（单测读它：预算数字、目标词、问题清单都要在里面）。 */
function seoRewritePrompt({ page, problems, content, payload, locale, industry, location, companyName }) {
  const kw = seoTargetOf(page);
  const isHome = page.slug === 'home';
  const envelope = isHome
    ? { siteTitle: content.seo.siteTitle, siteDescription: content.seo.siteDescription, page }
    : { page };
  const p = payload && typeof payload === 'object' ? payload : {};
  const facts = [
    ['USP', p.usp], ['Description', p.brandDescription], ['Address', p.address], ['Phone', p.phone], ['Hours', p.hours],
    ['Price range', p.priceRange],
    ['Customer reviews', Array.isArray(p.reviews) && p.reviews.length ? JSON.stringify(p.reviews) : ''],
  ].filter(([, v]) => typeof v === 'string' && v.trim()).map(([k, v]) => `- ${k}: ${v}`);
  return `You wrote one page of the website for "${companyName}" (${industry}${location ? `, ${location}` : ''}). An automatic SEO check found the problems below. Rewrite the page to fix ONLY these problems. Respond with the COMPLETE JSON object in exactly the same shape as the one you are given — no markdown fences, no explanation.

${JSON.stringify(envelope, null, 2)}

PROBLEMS TO FIX:
${problems.map((x) => `- ${x}`).join('\n')}

RULES:
- ${kw ? `This page's target keyword is "${kw}" — use that exact phrase where the problems ask for it.` : 'This page has no target keyword.'}
- Keep "slug", every section's "type" and "options", and every "imageUrl" exactly as they are. Add or remove a section only when a problem asks for it (the page's single H1 is the "headline" of its one "hero" or "page-header" section; H2s are the "headline" of the other sections).
- ${isHome ? 'siteTitle is the home page\'s <title>, used as-is: max 60 chars.' : `page.title: ${pageTitleSpec(content.brand.name[locale])}.`} Meta description (${isHome ? 'siteDescription' : 'page.description'}): 70–155 chars${kw ? `, containing "${kw}"` : ''}.
- Every image object ({"imageUrl", "alt"}) gets an "alt": one plain sentence saying what the photo shows.
${FACTS_ONLY_FROM_FORM_RULE.replace(', including the stats example below', '').replace('the business details above', 'the business details below')}
BUSINESS DETAILS (the only source of facts):
${facts.length ? facts.join('\n') : '- (none given)'}`;
}

/** 调 AI 重写一页一次。回 `{ page, siteTitle?, siteDescription? }`；调不通 / 吐不回对象就抛。 */
async function rewritePageForSeo(args) {
  const prompt = seoRewritePrompt(args);
  emit('prompt', { name: `SEO rewrite ${args.page.slug}`, content: prompt });
  const client = new Anthropic();
  const result = await callAIWithRetry({
    client,
    baseOptions: { model, max_tokens: maxTokens, messages: [{ role: 'user', content: prompt }] },
    costContext: { operation: 'create-site', detail: `SEO rewrite ${args.page.slug}`, pricing, durationStart: Date.now() },
    label: `SEO rewrite ${args.page.slug}`,
  });
  const parsed = result.parsed;
  const page = parsed && typeof parsed === 'object' && parsed.page && typeof parsed.page === 'object' ? parsed.page : parsed;
  if (!page || typeof page !== 'object' || Array.isArray(page)) throw new Error('重写回来的不是一个页面对象');
  return { page, siteTitle: parsed.siteTitle, siteDescription: parsed.siteDescription };
}

/**
 * 主语言每一页：检查 → 有问题重写一次 → 再查 → 处置。就地改 `content`（页、seo、页脚）。建站失败时 fatal()。
 * 回 `{ checked, rewritten, dropped, fatalPages }`（单测读它）。
 */
async function seoPass({ content, payload, locale, industry, location, companyName, disabledBlocks = [], keywordPagesPlanned = [] }) {
  const ctx = { content, payload, locale, industry, location, companyName };
  // 长度这种代码一刀能裁的先裁掉，再查；留给 AI 重写的只剩代码改不了的（关键词不在 / 编造事实 / H1 H2 …）。
  for (const c of fitPageDescriptions({ pages: content.pages, seo: content.seo })) {
    debug(`[seo] 裁 description ${c.slug}：${c.before} → ${c.after} 字（代码裁，不叫 AI）`);
  }
  const failing = [];
  for (const page of content.pages) {
    const problems = seoCheckPage({ page, ...ctx });
    if (problems.length) failing.push({ page, problems });
  }

  // 表单跟 Call 1 那道块校验用同一份（AI 写的文案 + 默认骨架，`siteFormsFrom`）；只比这一页重写前后的差集。
  const forms = siteFormsFrom((content.ai && content.ai.forms) || content.forms);
  const blockProblemsOf = (pages, slug) => validateBlocks({ pages, industry, disabledBlocks, forms })
    .problems.filter((x) => x.startsWith(`${slug} `));

  const rewrites = await Promise.all(failing.map(async ({ page, problems }) => {
    try {
      return { page, problems, out: await rewritePageForSeo({ page, problems, ...ctx }) };
    } catch (e) {
      debug(`[seo] 重写 ${page.slug} 没成：${e.message} —— 按原来那页处置`);
      return { page, problems, out: null };
    }
  }));

  const dropped = [];
  const fatalPages = [];
  let rewritten = 0;
  for (const { page, out } of rewrites) {
    let cur = page;
    if (out) {
      // 身份字段照原来那页：slug 由代码生成、关键词页 / 服务页的标记和目标词不归重写管
      const next = { ...out.page, slug: page.slug };
      for (const k of ['keywordPage', 'serviceDetailPage', 'parentService', 'navOrder', 'seo']) {
        if (page[k] !== undefined) next[k] = page[k]; else delete next[k];
      }
      sanitizeImageUrls([next]);
      applyBlockRoleDefaults([next]);
      writeImageAlts({ pages: [next], manifests: loadBlockManifests(), industry, targetKeywordOf: seoTargetOf });
      const idx = content.pages.indexOf(page);
      const trial = content.pages.slice(); trial[idx] = next;
      const before = new Set(blockProblemsOf(content.pages, page.slug));
      const added = blockProblemsOf(trial, page.slug).filter((x) => !before.has(x));
      if (added.length) {
        debug(`[seo] 重写一次 ${page.slug}：回来的页把块库改坏了 ${added.length} 处，作废、用原来那页：\n    ${added.join('\n    ')}`);
      } else {
        content.pages[idx] = next;
        if (page.slug === 'home') {
          if (typeof out.siteTitle === 'string' && out.siteTitle.trim()) content.seo.siteTitle = out.siteTitle.trim();
          if (typeof out.siteDescription === 'string' && out.siteDescription.trim()) content.seo.siteDescription = out.siteDescription.trim();
        }
        cur = next;
        rewritten += 1;
      }
    }
    for (const c of fitPageDescriptions({ pages: [cur], seo: content.seo })) {
      debug(`[seo] 重写后裁 description ${c.slug}：${c.before} → ${c.after} 字`);
    }
    const after = seoCheckPage({ page: cur, ...ctx, tag: '重写一次后' });
    if (!after.length) continue;
    if (cur.keywordPage === true) {
      dropped.push({ slug: cur.slug, keyword: seoTargetOf(cur), problems: after });
      debug(`[seo] 丢掉 ${cur.slug}：${after.join(' · ')}`);
    } else {
      fatalPages.push({ slug: cur.slug, problems: after });
    }
  }

  if (dropped.length) {
    const gone = new Set(dropped.map((d) => d.slug));
    content.pages = content.pages.filter((p) => !gone.has(p.slug));
    const footer = content.navigation && content.navigation.footer;
    if (footer && Array.isArray(footer.columns)) {
      for (const col of footer.columns) if (Array.isArray(col.links)) col.links = col.links.filter((l) => !gone.has(String(l.href || '').replace(/^\//, '')));
      footer.columns = footer.columns.filter((col) => !Array.isArray(col.links) || col.links.length);
    }
  }

  const planned = Array.isArray(keywordPagesPlanned) ? keywordPagesPlanned.length : 0;
  const kept = content.pages.filter((p) => p.keywordPage === true).length;
  if (planned) {
    const missing = keywordPagesPlanned.filter((kp) => !content.pages.some((p) => p.keywordPage === true && p.slug === kp.nestedSlug));
    debug(`[seo] 关键词页 ${kept}/${planned}${missing.length ? ` —— 没成的词：${missing.map((kp) => `「${kp.keyword}」`).join('、')}` : ''}`);
  }
  emit('seo-check', {
    pages: content.pages.length + dropped.length,
    rewritten,
    dropped: dropped.map((d) => ({ slug: d.slug, keyword: d.keyword, problems: d.problems })),
    keywordPages: { ok: kept, total: planned },
  });

  if (fatalPages.length) {
    fatal(`SEO check failed after one rewrite (#1549) —\n${fatalPages.map((f) => `  ${f.slug}:\n    ${f.problems.join('\n    ')}`).join('\n')}`);
  }
  return { checked: content.pages.length + dropped.length, rewritten, dropped, fatalPages };
}

// ─── Run ──────────────────────────────────────────────────────────────────────

main().catch(err => {
  fatal(err.stack || err.message || String(err));
});
