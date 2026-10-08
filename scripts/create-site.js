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
// #1471 —— 站级表单库（`site/<locale>/forms.json`）：默认表单的骨架（#1635 起只有 contact 一张）+ 只收 AI 的文案。
const { siteFormsFrom } = require('./lib/site-forms');
// #1631 —— 代码兜底写的那几句（联系页 / 默认表单）按站的语言。
const localeWords = require('./lib/locale-words');
// #1548 —— 挖出来的关键词落盘（seo.json 的 targetKeywords + 每页 seo.targetKeyword）。真 AI 与 skipAI 两条路共用这一份。
const targetKw = require('./lib/target-keywords');
// #1596 —— AI 那一步没给出能用的东西时代码拼的站级计划 / 骨架页（只用中性句式，事实只从 payload 取）。
const fallbackSite = require('./lib/fallback-site');
const { apiRetryDelayMs } = require('./lib/ai-backoff');
// #1598 —— 建站五个阶段的存档（阶段表、site_meta.json 的 buildPhase、site/.build/state.json、续跑点怎么读）。
const buildPhases = require('./lib/build-phases');
// #1549 —— 每页生成后的 SEO 检查（八条，设计文档 S2）。检查本身是纯函数，重写 / 丢页 / 失败的处置在本文件 §seoPass。
const { seoProblems, rulesFor: seoRulesFor, pageTitleBudget, MIN_PAGE_TITLE_BUDGET, promptLocation, missingPhrases, sitePlace, hasPhrase,
  contentImagesOf, brandNameOf, words: seoWords, NOT_TEXT: SEO_NOT_TEXT, H1_BLOCKS: SEO_H1_BLOCKS, H2_BLOCKS: SEO_H2_BLOCKS, CJK: SEO_CJK } = require('./lib/seo-problems');
// #1600 —— 建站报告（`site/build-report.json`）：各阶段往里记，结束时写盘；死链由 entrypoint 在 next build 之后并进来。
const buildReportLib = require('./lib/build-report');
// 这一次建站的那份报告（main 里建；seoPass 有两个**主语言**调用点，都往这一份里记；第二语言那一次不记，见 §seoPass 头注）。
let buildReport = null;
// #1386 —— 建站选图：哪些槽要图、提示词怎么拼、上限怎么截、求不到怎么说，都在那个文件里。
// 名单不再写在本文件里（此前是四个块名 + 四个 case，`hero-with-form` 因此永远拿不到图）。
// PLACEHOLDER_IMAGE_URL：skipAI 那条路给图槽填的那张图（#1386）—— 那个文件里也拿它给 gallery 垫底（#1638），所以只住那一处。
const { fillImageSlots, writeImageAlts, IMAGE_FILE_SUFFIX, PLACEHOLDER_IMAGE_URL } = require('./lib/image-slots');
// #1620 —— skipAI 示例站的页面块与图（`lib/demo-site.js` 排页，`lib/demo-content/images.js` 定图的地址前缀）。
const demoSite = require('./lib/demo-site');
const { normalizeDemoImageBase, rebaseDemoImages } = require('./lib/demo-content/images');
// #1034 — 每个站一份首页开场配方（开头四块 + 两个必须出现的块 + 候选清单的印刷顺序）。
// 治的是「6 个真实站 100% 以 announcement-bar → hero 开场」那件事，理由整段在那个文件头上。
const {
  tryHomepageRecipe,
  recipePromptLines,
  recipeProblems,
  fingerprintEnabled,
  afterRetry,
} = require('./lib/homepage-recipe');
// #1601 — 整站配方：页面清单、每页的块序与预设、顶部导航放哪几页、行动按钮指哪一页，按行业组给（AI 只填内容）。
const siteRecipe = require('./lib/site-recipe');
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
// FastBuild T2 #1596 第 4 条先行落地（2026-10-06 site-87c53d50 站级回包 3/3 没转义引号）：先严格解析、失败再修一次；
// 修不好才算一次重试，并把原始回包存到 /tmp/ai-raw（§ai-json.js 头注）。
const { validateAiJson, saveRawResponse } = require('./lib/ai-json');
// #1549 回修 —— description 超长由代码裁到 155，不叫 AI 重写、不让整站失败（§description-fit.js 头注）。
// #1549 重开 —— description 的长度区间按主语言取；r4 拆成两个区间（都只在 description-fit.js 定义）：提示词给目标区间（中 / 日 / 韩 50–80，其余 70–155），
//    检查只拦底线区间（20–200 / 40–300），超过底线上限由代码裁到目标上限；重写后仍缺地点由代码补。
const { fitPageDescriptions, appendPlace, placeFits, descriptionAccept, descriptionSpec, isCjkLocale } = require('./lib/description-fit');
// #1489 —— 建站时按地址查一次坐标写进 brand.locations[0].geo（contact 的地图要它；Nominatim，不要 key，§geocode.js 头注）。
const { geocodeBrand } = require('./lib/geocode');
// #1551 —— LocalBusiness 里「从老板给的料来」的几项：营业时间的转写核对、真实评分（§local-business-facts.js 头注）。
const { verifyTranscription, ratingFrom } = require('./lib/local-business-facts');
// #1489 r2 —— contact 的 items 里抄进来的电话 / 邮箱 / 地址 / 营业时间，写盘那一刻剔掉（值只有一处）。
const { siteFactsFrom, scrubContactCopies } = require('./lib/contact-facts');
// #1593 —— 一次调用产出全部语言（第二语言按主语言骨架拼）+ 建站的四个数（耗时 / 费用 / 修补页数 / 页数）。
const localesLib = require('./lib/all-locales');
const { createBuildStats } = require('./lib/build-stats');
// #1599 —— 三段式建站：每个阶段做完就构建一版预览（lib/staged-preview.js 文件头）。
const stagedPreviewLib = require('./lib/staged-preview');

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
// #1593 —— 本进程所有 cost 事件之和 + 耗时（§lib/build-stats.js；口径跟 operation_runs 不同，见那个文件头）。
const buildStats = createBuildStats(startTime);

function elapsed() {
  return ((Date.now() - startTime) / 1000).toFixed(1) + 's';
}

function emit(event, data = {}) {
  if (event === 'cost') buildStats.addCost(data.cost);
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

// #1596 —— 付钱之后「某一步没做好」不再让整站失败：那一步降级（站级计划 / 骨架页 / 丢页 / 照发），并在这里记一笔。
//    每一笔同时发一条 `degraded` 事件（worker 原样转发未知事件类型），并进建站报告（T8 #1600）的 `degraded` 那一格：
//    真 AI 路收尾时 `recordDegraded(buildReport, degradedSteps)`（形状 { step, target, reason }）。导出它只为单测在进程退出时读得到。
const degradedSteps = [];
module.exports.degradedSteps = degradedSteps;
function degrade(step, target, reason) {
  const d = { step, target: String(target), reason: String(reason) };
  degradedSteps.push(d);
  // #1598 —— 建站报告跟着阶段存档走：当场记进去，续跑时读回来的那份报告里就带着之前阶段的降级（见 main 读续跑点那段）。
  if (buildReport) buildReportLib.recordDegraded(buildReport, degradedSteps);
  emit('degraded', d);
  debug(`[degraded] ${step} · ${d.target} —— ${d.reason}`);
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
// #1594 —— 100 → 30：每页新生成 ≤ 3 之后，正常站远不到 30；真建站读数 99 张那两个站按新规则都在 30 以内。
//    manager 每次都把 Admin Settings 的值放进 payload，这个数只在没传时兜底，跟 `manager/admin.go` 的种子值同一个。
let photoHardCap = 30;

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

// TICKET-132 + TICKET-148 + #1618: AI-call-level retry layered as:
//   - API errors (429/5xx/529/overloaded) → 3 attempts; the wait is ~5s then ~10s with jitter, or the server's
//     retry-after when it sent one (#1597, §lib/ai-backoff.js). Exhausted → throws; every caller degrades (#1596)
//   - JSON 坏了 → 本地先修（`validateAiJson`：严格 → jsonrepair）；本地修不好时（#1618）：
//       ① 修复 1 次：整份坏 JSON + 出错位置交给 AI，只修语法、内容不动（单轮新请求，不带原来的长提示词）
//       ② 还不行 → 整份重新生成 1 次（TICKET-132 那条老路：原对话 + 500 字摘要 + "respond AGAIN"）
//       ③ 再坏 → 抛错，调用方走各自的降级（#1596）
//     一次失败的请求序列固定是 原始 → 修复 → 重写，跟今天一样 3 条。
//   - max_tokens or other terminal errors → throw immediately
//
// `costContext` shape: { operation, detail, pricing, durationStart? } —
// detail 尾巴：重写那次加 ` [retry N]`，修复那次加 ` [json-repair N]`（dashboard 上分得清钱花在哪一种上）。
async function callAIWithRetry({ client, baseOptions, costContext, label, maxAttempts = 2, maxRepairs = 1 }) {
  let messages = baseOptions.messages;
  let lastParseError;
  let lastText = '';
  let repairs = 0;

  // 发一次请求（带 TICKET-148 的 API 错误重试），并记一笔 cost。`tag` 是 detail 的尾巴。
  const send = async (options, tag) => {
    let response;
    // TICKET-148: API-error retry around stream/finalMessage. Independent retry
    // budget from the JSON-parse handling below.
    let apiAttempt = 0;
    const maxApiAttempts = 3;
    while (true) {
      try {
        const stream = await client.messages.stream(options);
        response = await stream.finalMessage();
        break;
      } catch (apiErr) {
        apiAttempt++;
        if (isRetryableApiError(apiErr) && apiAttempt < maxApiAttempts) {
          // #1597 —— 退避加抖动；服务器给了 retry-after 就照它等（§lib/ai-backoff.js）
          const { waitMs, why } = apiRetryDelayMs(apiErr, apiAttempt);
          debug(`[ai-retry] ${label} API error ${apiErr.status || 'unknown'} (${apiAttempt}/${maxApiAttempts - 1}): ${apiErr.message?.substring(0, 200) || 'no message'} — retrying in ${waitMs}ms (${why})`);
          await new Promise(r => setTimeout(r, waitMs));
          continue;
        }
        // Not retryable, or budget exhausted — propagate.
        throw apiErr;
      }
    }
    // Emit cost on EVERY request — user paid for each token.
    const usage = response.usage || {};
    const cost = ((usage.input_tokens || 0) * costContext.pricing.input + (usage.output_tokens || 0) * costContext.pricing.output) / 1_000_000;
    // #1251: 读 `options.model`（就是交给 SDK 的那一份）而不是模块那个 `model` 变量 —— 记下来的和发出去的按构造是同一个字串。
    // （不取 `response.model`：它是服务器把别名解开之后的带日期 id，而 manager 那几条路记的是请求里的 id ——
    // 同一列里两种口径会让 `GROUP BY model` 把一个模型数成两个。）
    emit('cost', {
      operation: costContext.operation,
      model: options.model,
      cost,
      duration: costContext.durationStart ? (Date.now() - costContext.durationStart) : 0,
      detail: `${costContext.detail}${tag} (${usage.input_tokens || 0} in / ${usage.output_tokens || 0} out)`,
    });
    return response;
  };

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const response = await send({ ...baseOptions, messages }, attempt > 1 ? ` [retry ${attempt - 1}]` : '');

    // max_tokens is a prompt-size problem — retrying the same prompt would
    // hit the same wall. Throw so the caller reacts.
    if (response.stop_reason === 'max_tokens') {
      throw new Error(`${label}: response was truncated (max_tokens hit) — try reducing prompt size`);
    }

    const text = response.content[0].text.trim();
    lastText = text;
    const how = attempt > 1 ? '重写' : '原始';
    const v = validateAiJson(text);
    if (v.ok) {
      debug(`[ai-retry] ${label} ${how}那次${v.repaired ? '：JSON 严格解析失败 ⟹ 本地修好（jsonrepair）' : ' parse succeeded'}`);
      return { parsed: v.parsed, response, text, repaired: v.repaired, aiRepaired: false };
    }
    lastParseError = jsonError(v);
    const rawFile = saveRawResponse(label, attempt, text);
    debug(`[ai-retry] ${label} ${how}那次 JSON.parse failed（本地也修不好）: ${v.error}`
      + (rawFile ? ` —— 原始回包存在 ${rawFile}` : '')
      + (v.context ? `\n    出错位置前后：${JSON.stringify(v.context.slice(0, 400))}` : ''));

    // #1618 —— 先交给 AI 只修语法。修复只跟在原始那次后面（重写那次坏了不再修，直接失败）。
    if (attempt === 1 && repairs < maxRepairs) {
      repairs += 1;
      const fixed = await repairJsonWithAI({ send, baseOptions, label, text, v, n: repairs });
      if (fixed) {
        debug(`[ai-retry] ${label} AI 修好（json-repair ${repairs}）`);
        return { parsed: fixed.parsed, response: fixed.response, text: fixed.text, repaired: fixed.repaired, aiRepaired: true };
      }
    }
    if (attempt >= maxAttempts) break;

    debug(`[ai-retry] ${label} 修不好 ⟹ 重写（retry ${attempt}）`);
    // Augment messages: truncated excerpt (cost-control) + retry instruction.
    const excerpt = text.substring(0, 500) + (text.length > 500 ? '... [truncated]' : '');
    messages = [
      ...messages,
      { role: 'assistant', content: `[Response was malformed. Excerpt: ${excerpt}]` },
      { role: 'user', content: `Previous response failed JSON.parse with error: "${v.error}". Respond AGAIN with ONLY valid JSON — no markdown fences, no comments, no trailing commas, no explanatory text. Same content/structure as originally requested.` },
    ];

    // Short backoff — JSON parse failure is not a rate-limit issue so no need to wait long.
    await new Promise(r => setTimeout(r, 1000 * Math.pow(2, attempt - 1)));
  }
  debug(`[ai-retry] ${label} 失败：原始 → 修复 → 重写 都没拿到合法 JSON`);
  const err = new Error(`${label}: failed to parse AI response as JSON after ${maxAttempts} attempts and ${repairs} repair(s). Last error: ${lastParseError.message}`);
  // Attach last raw response so callers can persist it for postmortem.
  err.lastText = lastText;
  err.lastParseError = lastParseError;
  throw err;
}

/** `validateAiJson` 的失败结果 → 一个 SyntaxError（带 `context`），给 `err.lastParseError` 用。 */
function jsonError(v) {
  const e = new SyntaxError(v.error);
  e.context = v.context;
  return e;
}

/**
 * #1618 —— 把整份坏 JSON + 出错位置交给 AI，只修语法。修好回 `{ parsed, repaired, response, text }`，没修好回 null。
 * 单轮新请求，不带原来的提示词；同一个模型。`max_tokens` 沿用原请求那个上限：原始那次没撞上限
 * （撞了在上面就抛了），所以它一定装得下一份同样长的 JSON —— 按原文长度掐着给，模型多吐几个转义符就会截断。
 * 🔴 修复那次自己撞了 `max_tokens` 算没修好，不进 `validateAiJson`：jsonrepair 会把截断的 JSON 补上括号判成合法，
 *    等于静默丢掉后半截内容。
 */
async function repairJsonWithAI({ send, baseOptions, label, text, v, n }) {
  const where = v.position == null ? 'unknown position' : `character position ${v.position}`;
  const prompt = 'The text below was supposed to be one valid JSON document, but JSON.parse rejects it.\n\n'
    + `ERROR: ${v.error}\n`
    + `WHERE: ${where}. The text around that spot:\n<<<\n${v.context}\n>>>\n\n`
    + 'Fix ONLY the JSON syntax so that JSON.parse accepts it (escape stray quotes, add missing commas/brackets, '
    + 'remove any text that is not part of the JSON, and so on). Do NOT add, remove, rename or rewrite any field, '
    + 'value or wording — the content must stay exactly the same. If the text contains more than one copy of the JSON, '
    + 'keep the last complete one. Respond with ONLY the fixed JSON — no markdown fences, no explanation.\n\n'
    + `THE FULL TEXT:\n${text}`;
  let response;
  try {
    response = await send({ model: baseOptions.model, max_tokens: baseOptions.max_tokens, messages: [{ role: 'user', content: prompt }] }, ` [json-repair ${n}]`);
  } catch (e) {
    debug(`[ai-retry] ${label} 修复请求失败（${e.message}）⟹ 当作没修好`);
    return null;
  }
  if (response.stop_reason === 'max_tokens') {
    debug(`[ai-retry] ${label} 修复那次也被截断（max_tokens）⟹ 当作没修好`);
    return null;
  }
  const fixedText = ((response.content && response.content[0] && response.content[0].text) || '').trim();
  const r = validateAiJson(fixedText);
  if (!r.ok) {
    saveRawResponse(`${label} json-repair`, n, fixedText);
    debug(`[ai-retry] ${label} 修复回来的仍不是合法 JSON：${r.error}`);
    return null;
  }
  return { parsed: r.parsed, repaired: r.repaired, response, text: fixedText };
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

// #1593 —— 第二语言 SEO 检查用的品牌名：表单里按语言填过的就用它，否则退回主语言那个（渲染时 getBrandName 也是这么退的）。
function brandNameOfLocale(brand, locale, defaultLocale) {
  const n = brand && brand.name;
  if (typeof n === 'string') return n;
  return (n && (n[locale] || n[defaultLocale])) || '';
}

// #1593 —— 第二语言 SEO 检查看的地点（第 2 条「含地点」）。建站表格里 `location` 是 Google Ads 的英文地名，`locationLocalized`
// 是主语言的译名（#1569）：英文第二语言 ⟹ 用 `location`；别的第二语言手上没有它那种语言的地名 ⟹ 「含地点」那一半不判
// （不让代码把英文地名补进一句中文 description 的末尾）。
function secondarySeoPayload(payload, locale) {
  if (/^en\b/i.test(locale)) return { ...payload, locationLocalized: '' };
  return { ...payload, location: '', locationLocalized: '' };
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
    keywords: rawKeywords = {},
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
    keyword: rawLeadKeyword = '',
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

  // #1569 r3 —— 有翻译种子的服务组，主词换成翻译种子（服务详情页 / 首页的目标词跟着换；#1661 起英语站也换）；
  //    每条词去掉汉字之间的空格（§lib/target-keywords.js localizeKeywords）。下游一律读换过的这份，
  //    payload.keywords 也换掉（关键词页素材 §keywordPageMaterial 读的是它）。去空格不分站的语言，
  //    只碰两侧都是汉字 / 假名的那几个空格（英文站里没有这种词就一个字节不变）。
  const { keywords, leadKeyword, swapped: kwSwapped } = targetKw.localizeKeywords(rawKeywords, rawLeadKeyword);
  input.keywords = keywords;
  for (const x of kwSwapped) debug(`[keywords] ${x.group}：主词「${x.from}」→ 翻译种子「${x.to}」（主语言 ${defaultLocale}）`);

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
  buildReport = buildReportLib.createReport({ path: input.skipAI ? 'skipAI' : 'ai' });

  // #1598 —— 续跑：只有任务带 `resume: true`（admin 的 Resume，manager §handleResumeSite）才读存档；不带就照旧先删 site/
  //    再从头建（PM r2 裁定 一：Rebuild 复用同一个仓，建成过的站仓里 buildPhase 已是最后一个阶段，不加这个条件 Rebuild 就什么都不建）。
  //    skipAI 那条路没有阶段（一次写完），带了也不续。续不了（没有存档 / 存档跟标记对不上 / 主题已不在注册表）⟹ 说一句、从头建。
  let resume = null;
  if (input.resume === true && !input.skipAI) {
    const point = buildPhases.readResumePoint(siteDir);
    const why = point.why || (point.state && !themes[point.state.themeName] ? `存档里的主题 ${point.state.themeName} 已经不在注册表里` : '');
    if (why) {
      debug(`[resume] 续不了，从头建：${why}`);
      progress('Nothing saved to resume from — building from the start...', 3);
    } else {
      resume = point;
      debug(`[resume] 存档里最后做完的阶段是 ${point.phase}（${point.index + 1}/${buildPhases.BUILD_PHASES.length}），从下一个阶段接着做`);
      // #1600 的建站报告也从存档里接着记：SEO 检查和关键词页 N/M 记在 keywordPages 阶段里，从它之后续跑时那几格没人再记，
      // 新建的一份会是 null（= 「没有生产者」），而这次建站其实跑过。
      if (point.state && point.state.buildReport) buildReport = buildReportLib.normalize(point.state.buildReport);
      // #1596 —— 之前阶段记下的降级接着算（不然这次收尾的 recordDegraded 只剩续跑之后那几笔）。
      if (Array.isArray(buildReport.degraded)) degradedSteps.push(...buildReport.degraded);
    }
  }
  if (resume && resume.index === buildPhases.BUILD_PHASES.length - 1) {
    debug(`[resume] 五个阶段都已做完并存档，没有要续的 —— 直接交给预览`);
    progress('Site generated, starting preview...', 85);
    return;
  }

  // Clean up existing site dir if present (container re-runs) —— 续跑时不删：存档和前几个阶段的产物都在里面（#1598）。
  if (!resume) {
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
  }

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
  // 🔴 #1598 —— 续跑沿用存档里第一次挑的那套，不重新挑：manager 每次派活都重算 themeRotationIndex（这个用户每多一个站
  //    就 +1，#924），重新挑会让前几个阶段按 A 主题写、后几个按 B 主题写，而站照样建得出来 —— 失败是静默的。
  const themeName = resume ? resume.state.themeName : (named || pickThemeForIndustry(industry, themeRotationIndex, disabledThemes));
  if (resume) debug(`[resume] 主题沿用存档里那套 ${themeName}（这一次派活的轮换下标 ${themeRotationIndex} 不参与）`);
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
  //   · skipAI —— 那条路根本不问 AI，首页的块由 `lib/demo-site.js` 从演示内容包排（#1620）
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
      : input.skipAI ? 'skipAI(首页是演示内容包排好的那几块)' : '用户点名照抄参照站布局'}`);
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
  // #1598 —— 续跑不重写 theme.json：它在 plan 之前写，已经跟 plan 那次提交一起进了仓。
  if (!resume) fs.writeFileSync(
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
    // #1620 —— 每一页的块换成演示内容包那一份（`lib/demo-site.js`）：块库里每个页面块都出现，站的骨架仍是 getDemoConfig 的。
    {
      const placed = demoSite.demoSitePages(content.pages, loadBlockManifests());
      debug(`[demo] 页面块来自 lib/demo-content：按计划放 ${placed.placed.length} 种${placed.appended.length ? `，追加到首页 ${placed.appended.join(' / ')}` : ''}`);
    }
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
    // #1620 —— 演示内容里那家演示生意的名字换成这个站的名字；指向示例站没有的页的站内链接改指到有的页上。
    const demoPosts = demoSite.demoBlogPosts();
    debug(`[demo] 演示文案里的生意名换成「${skipAiPrimaryName}」${demoSite.renameDemoBusiness([content.pages, demoPosts], skipAiPrimaryName)} 处；`
      + `站内死链改指 ${demoSite.retargetDeadLinks(content.pages, content.pages.map((p) => p.slug), demoPosts.length && !disabledBlocks.includes('blog') ? ['/blog'] : [])} 处`);
    // #1620 —— 图：演示内容里的地址都是 `lib/demo-content/images.js` 的默认前缀。manager 在载荷里给了本环境的
    // `demoImageBase`（`https://<domain.uploads>/demo/`）⟹ 换到那个前缀上，图是浏览器打开页面时才去存储上取，
    // 建站本身不发任何网络请求（#1386 的规矩）。载荷没带（本地 rig、离线 e2e）⟹ 每一处都换成占位图，
    // 然后照 #1386 那样逐槽填占位图、打读数 —— 跟改之前的示例站一样。
    const demoImageBase = normalizeDemoImageBase(input.demoImageBase);
    const rebased = rebaseDemoImages({ pages: content.pages, posts: demoPosts },
      demoImageBase ? (file) => `${demoImageBase}${file}` : () => PLACEHOLDER_IMAGE_URL);
    content.pages = rebased.value.pages;
    demoPosts.splice(0, demoPosts.length, ...rebased.value.posts);
    debug(`[demo] 图片地址 ${rebased.replaced} 处 → ${demoImageBase || `占位图 ${PLACEHOLDER_IMAGE_URL}（载荷里没有 demoImageBase）`}`);
    if (demoImageBase) {
      // 每个图槽都已经是演示图 —— 不再逐槽求图（fillImageSlots 会把每个槽都重写一遍），只补 alt。
      writeImageAlts({ pages: content.pages, manifests: loadBlockManifests(), industry });
      // #1594 的建站报告 `images` 一格：这一支一张都没向生图要（图早就在存储上），如实记 0。
      recordImageCounts({ images: { requested: 0, generated: 0, reused: 0 } });
    } else {
      // #1386 —— skipAI 这条路也填图，但**不调任何外部图库**：每个内容图槽填同一张本地占位图，
      // 逐槽打一行读数。占位图用仓库自带的 `public/images/grid-pattern.svg`（模板自己的资源，不是外部链接）。
      const demoImages = await fillImageSlots({
        pages: content.pages,
        manifests: loadBlockManifests(),
        industry,
        primaryColor: content.brand.colors.primary['500'],
        themeWord: themeName,
        produce: async () => PLACEHOLDER_IMAGE_URL,
        log: (line) => debug(line),
      });
      recordImageCounts(demoImages);
    }
    // #1548 —— 同一个纯函数（`lib/target-keywords.js`）。demo 只有 5 页、一个服务、没有关键词页 ⟹ 这里能挂上词的只有首页，
    //    payload 的组全部对不上 demo-service（正常态，不失败）。
    applyTargetKeywords(content, targetKw.assignTargetKeywords({
      keywords, services, contentServices: content.services, pages: content.pages,
      keywordPagesList: [], siteType, keyword: leadKeyword,
    }));
    writeSiteConfig(siteDir, content, defaultLocale, disabledBlocks);
    // #1620 —— 博客文章（blog 块只从站点博客读，站里没文章它整块不画）。关掉 blog 块时不写：没有块指向它们。
    if (!disabledBlocks.includes('blog')) {
      const blogDir = path.join(siteDir, defaultLocale, 'blog');
      fs.mkdirSync(blogDir, { recursive: true });
      for (const post of demoPosts) fs.writeFileSync(path.join(blogDir, `${post.slug}.json`), JSON.stringify(post, null, 2) + '\n');
      debug(`[demo] 博客文章 ${demoPosts.length} 篇 → site/${defaultLocale}/blog/`);
    }
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
        // #1631 —— 第二语言没有任何人写过表单文字（skipAI 不调 AI），所以传空：文字按 siteFormsFrom 取这个语言那一行字表。
        //    别传 `content.forms` —— 它此刻已被 writeSiteConfig 原地改成主语言那一行（中文主语言就是中文），当「AI 给的」传进去会赢过字表，
        //    英文第二语言的表单就成了中文。`formsBase` 只供结构。
        forms: [],
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
    // #1600 —— skipAI 走不到关键词页和 SEO 检查 ⟹ seo / repair / keywordPages 三格是 null（那条路的正常态）。
    finishBuildReport(siteDir);
    progress('Demo site generated, starting preview...', 85);
    return;
  }

  if (!process.env.ANTHROPIC_API_KEY) {
    fatal('ANTHROPIC_API_KEY environment variable is required');
  }

  if (resume) {
    // #1598 做什么 4 —— 进度条从续上的那个阶段做完时的位置开始。
    progress(`Resuming after the saved "${resume.phase}" stage...`, buildPhases.PHASE_DONE_PERCENT[resume.phase]);
  } else {
    progress('Setting up project...', 5);

    progress('AI is designing your website...', 15);
  }

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
  // #1593 —— 第二语言一次写完：每页回包里第二语言那一份记在这本账上，写盘前按主语言最终那一版拼（§lib/all-locales.js）。
  const localeBook = new localesLib.LocaleBook(normalizedSecondaryLocales);
  const localesInfo = {
    primary: { code: defaultLocale, name: languageName },
    others: normalizedSecondaryLocales.map((code) => ({ code, name: langMap[code] || code, hint: chineseVariantHint(langMap[code] || code) })),
  };
  // #1598 × #1593 —— 这本账按对象身份挂在页面上（WeakMap），而续跑时的页是从存档 JSON 读回来的新对象 ⟹ 账要跟着存档走：
  //    存档点把它按「第几页、第几块」写进 state.json（§LocaleBook.snapshot），续跑时挂回读回来的那些页上（§restore）。
  //    不带上它，续跑的站第二语言一页都拼不出来（buildSecondaryContent 报 pages missing、放弃整个第二语言）。
  if (resume && resume.state) localeBook.restore(buildPhases.pagesOfState(resume.state), resume.state.locales);

  // ── #1598 存档点 ──────────────────────────────────────────────────────────────────────────────────────
  // 每个阶段做完：标记 + 存档 + 这个阶段的产物进**同一个提交**（lib/build-phases.js 文件头写着为什么必须同一个），再推送一次。
  // 🔴 推送失败不终止建站、也不回滚标记：没推上去的那个提交在别的克隆里连标记一起不存在，续跑按构造读不到「有标记没产物」。
  //    这里只打一行日志、不发 warn 事件 —— 「存进仓了没有」的权威读数仍是 entrypoint.sh 最后那一次前台推送（#1592）：
  //    它会把这里没推上去的阶段一起带上去，推不上去时由它发 warn kind=unarchived。
  // 🔴 #1613 —— 提交失败也不终止建站（付了钱）：发一条 degraded（step=git-commit），往下建。`git add site/ public/` 是累积的 ⟹
  //    前四个阶段漏下的由下一次提交带上；最后一个阶段之后没有下一次 ⟹ 那一次失败时它的产物只在工作区。所以 entrypoint.sh 判
  //    「存进仓了没有」不再只看 push 的 rc，还看 site/ public/ 下有没有没提交的东西（§unsaved_build_files）。
  //    返回这一次提交成没成 —— 最后一个阶段那次失败时不发「Site created」锚点（见下面那处）。
  // 🔴 token 只进这一条 git 命令的环境变量（克隆里 .git/config 的 credential helper 读 GIT_TOKEN，#1558），不进参数。
  const { repoUrl } = input;
  const checkpoint = (phase, state) => {
    const saved = state
      ? { themeName, buildReport, ...state, locales: localeBook.snapshot(buildPhases.pagesOfState(state)) }
      : null;
    buildPhases.writePhaseFiles(siteDir, phase, saved);
    if (!repoUrl) {
      debug(`[resume] 阶段 ${phase} 已存档（没有 repoUrl，不提交）`);
      return false;
    }
    const gitOpts = { cwd: rootDir, stdio: 'pipe' };
    let committed = true;
    try {
      // TICKET-170: include public/ so AI-generated logo (159) + business photos
      // (161/164) persist into the per-site git repo. Without this, container
      // restart → fresh clone → public/ empty → preview / deploy break image.
      execSync('git add site/ public/', gitOpts);
      execSync(`git commit -m "Generate site: ${siteId} (phase: ${buildPhases.phaseCommitLabel(phase)})"`, gitOpts);
    } catch (e) {
      committed = false;
      debug('Git commit failed:', e.stderr?.toString() || e.message);
      // 原因取 git 说的第一行（「nothing to commit」那类在 stdout 上），都没有就取退出码。
      const said = [e.stderr, e.stdout].map((b) => (b ? b.toString() : '')).join('\n').split('\n').map((l) => l.trim()).find(Boolean);
      degrade('git-commit', phase, said || e.message || `exit ${e.status}`);
    }
    try {
      execSync('git push origin main', { ...gitOpts, timeout: 120000, env: { ...process.env, GIT_TOKEN: input.gitToken || '', GIT_TERMINAL_PROMPT: '0' } });
      debug(`[resume] 阶段 ${phase} 已提交并推送`);
    } catch (e) {
      // 原因取 git 的 `fatal:` / `error:` 那一行（它最后一行常是「and the repository exists.」这类套话），没有就取最后一行。
      const lines = (e.stderr?.toString() || e.message || '').split('\n').map((l) => l.trim()).filter(Boolean);
      let why = lines.find((l) => /^(fatal|error):/.test(l)) || lines.pop() || `exit ${e.status}`;
      if (input.gitToken) why = why.split(input.gitToken).join('***');
      debug(`[resume] ⚠️ 阶段 ${phase} 已提交、推送失败（建站照常往下走，entrypoint.sh 最后那一次推送会一起带上去）：${why}`);
    }
    return committed;
  };

  // #1598 —— plan / pages / images 三个阶段都在 generateContent 里；images 已存档 ⟹ 整个 Call 1 跳过，content 就是存档里那份。
  // ── #1599 分段预览 ───────────────────────────────────────────────────────────────────────────────────────
  // 只在 entrypoint.sh 打开时才有（STAGED_PREVIEW_DIR）。每个阶段做完调一次：给了 content ⟹ 预览按它写一版站点文件（写进快照，
  // 不碰 site/）；null ⟹ site/ 里此刻的文件就是要看的站。三段怎么分、哪一次发什么事件，都在 lib 里按 BUILD_PHASES 派生。
  const stagedPreview = stagedPreviewLib.fromEnv({ rootDir, siteDir, emit, log: debug });
  const previewPhaseDone = (phase, content) => {
    if (!stagedPreview) return;
    stagedPreview.phaseDone(phase, content ? (dir) => writePreviewSite(dir, content, { defaultLocale, disabledBlocks, industry }) : null);
  };

  const content = (resume && resume.index >= 2) ? resume.state.content : await generateContent({
    locales: localesInfo, book: localeBook, secondaryKeywords: secondaryLocaleKeywords,
    companyName, industry, location, address, phone, email,
    // #1569 r2 —— 地址那一格要的是原样的地点（Google Ads 那份），不是上面给 AI 当背景的双语串（§generateContent 地址那行）。
    rawLocation: input.location,
    services, usp, targetCustomers, brandDescription,
    // #1661 —— 服务名按主语言写：有翻译种子的服务用翻译种子（跟它那组换上去的主词是同一个词）。
    serviceNames: targetKw.promptServiceNames(services, keywords),
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
    // #1598 —— 续跑从哪个阶段之后接着做 + 每个阶段做完调的存档点。
    resumeFrom: resume ? resume.index : -1,
    resumeState: resume ? resume.state : null,
    checkpoint,
    onPhaseDone: previewPhaseDone,
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

  // #1598 —— images 阶段做完（logo、各页配图、导航、seo 都已拼进 content；图在 public/ 里，跟存档同一个提交）。
  if (!(resume && resume.index >= 2)) checkpoint('images', { content });
  // #1599 —— 图配上了（从 images 续跑时就是存档里那份 content —— 那一次是续跑的第一版预览，发 preview-viewable）。
  if (!(resume && resume.index >= 3)) previewPhaseDone('images', content);

  progress('Writing base configuration files...', 50);

  // ── #1598 keywordPages 阶段：Call 2 + 目标词 + SEO 检查 + 关键词页收尾 + 写站点文件。keywordPages 已存档 ⟹ 整段跳过：
  //    这一段写出来的站点文件都在那次提交里，第二语言那一段要的 content 在存档里。SEO 检查和收尾算在这一段（PM r2 裁定 三）。
  if (resume && resume.index >= 3) {
    debug('[resume] 跳过 keywordPages 阶段：站点文件已经在仓里');
  } else {
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
        locales: localesInfo, book: localeBook,
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
        descriptionSpec: descriptionSpec(defaultLocale),
        forms: siteFormsFrom(content.ai && content.ai.forms, undefined, defaultLocale),
        additionalContext,
        sitePrimaryKeyword: (targetKw.sitePrimaryOf(kwGroups, { siteType, keyword: leadKeyword }) || {}).keyword || '',
        ctaHref: (content.navigation && content.navigation.header && content.navigation.header.cta && content.navigation.header.cta.href) || '',
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

  // #1549 —— 主语言每一页跑 seoProblems；有问题修补一次；仍有问题：关键词页丢掉，其余页照发 + 一笔降级（§seoPass，#1596 起不再建站失败）。
    progress('Checking every page for SEO...', 68);
    const seoResult = await seoPass({
      content, payload: input, locale: defaultLocale, industry, location, companyName, disabledBlocks,
      // #1550 —— 计划建的 = 全部选中词（含 Call 2 就没建成的），seoPass 据它打「关键词页 N/M」那行日志和 seo-check 事件。
      keywordPagesPlanned: kwPlan.pages.map((e) => ({ nestedSlug: e.path, keyword: e.keyword })),
    });
    buildReportLib.recordSeo(buildReport, seoResult);

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
    } else {
      // #1600 —— 没选任何词的真 AI 站：关键词页这一格是真的 0/0（有来源），不是 null。
      buildReportLib.recordKeywordPages(buildReport, kwReport);
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

    // #1633 —— AI 没给 contact 页 ⟹ 代码补一页（主语言不是英文时用站级那一通给的主语言字），并且这一页也过 SEO 检查。
    //    以前它是写盘那一步（§writeSiteConfig）里才插的，落在上面主 seoPass 之后 ⟹ 没有任何检查看得到它。
    //    只把这一页单独交给 seoPass（同 §finishKeywordPages 里代码补的服务详情页）：主 seoPass 第 5 条「站内唯一」吃整站页表，
    //    提前塞进去会改别的页的判定输入。
    const contactPage = ensureContactPage(content, defaultLocale, disabledBlocks,
      defaultLocale !== 'en' && content.ai ? content.ai.contactPage : null);
    if (contactPage) {
      const sub = { ...content, pages: [contactPage] };
      buildReportLib.recordSeo(buildReport, await seoPass({ content: sub, payload: input, locale: defaultLocale, industry, location, companyName, disabledBlocks }));
      const i = content.pages.findIndex((p) => p.slug === 'contact');
      if (i >= 0 && sub.pages[0] && sub.pages[0].slug === 'contact') content.pages[i] = sub.pages[0];
    }

    writeSiteConfig(siteDir, content, defaultLocale, disabledBlocks);

    // #1472 —— 站级深浅：AI 按行业给的默认（酒吧 / 健身房 dark，牙科 / 律所 light），老板之后可改成 auto。
    // 认不得的值落回 light（判据在 lib/color-scheme.js，构建那一侧读的是同一份）。skipAI 那条路不走这里 ⟹ 不写这个键 = light。
    const colorScheme = normalizeColorScheme(content.ai && content.ai.colorScheme);
    writeThemeColorScheme(siteDir, colorScheme);
    debug(`[color scheme] ${colorScheme}（AI 给的是 ${JSON.stringify(content.ai && content.ai.colorScheme)}）`);
    checkpoint('keywordPages', { content });
  }
  // #1599 —— 关键词页、SEO 修补都写进 site/ 了（从 keywordPages 续跑时那些文件就在仓里）：照 site/ 构建。
  previewPhaseDone('keywordPages', null);

  // ─── TICKET-122b / #1593: Secondary locales ──────────────────────────────────
  // 第二语言的字已经跟主语言在同一次调用里写回来了（每页 / 关键词页 / 站级），这里按主语言最终那一版拼出来、过一遍 SEO、写盘。
  // 一个第二语言坏了（某一页它那一份重试后仍对不上、站级缺它那一份、拼的时候出错）只放弃那一个语言：发
  // `secondary-locale-failed`，不写 site/<locale>/，主语言照常发布（TICKET-122b 起就是这个处置）。
  const secondaryFailures = [];
  if (normalizedSecondaryLocales.length > 0) {
    progress('Writing secondary locales...', 72);
    for (const secLocale of normalizedSecondaryLocales) {
      try {
        if (localeBook.failed.has(secLocale)) throw new Error(localeBook.failed.get(secLocale));
        const secContent = buildSecondaryContent({
          content, locale: secLocale, book: localeBook, industry, disabledBlocks,
          secondaryKeywordsByPage: secondaryLocaleKeywords[secLocale] || {},
        });
        // #1593 —— 第二语言也过 SEO 检查（按它自己的 locale：区间、品牌名、地点），修补一次仍不合格只记日志、照常发布。
        const brandView = { ...content.brand, name: { ...content.brand.name, [secLocale]: brandNameOfLocale(content.brand, secLocale, defaultLocale) } };
        await seoPass({
          content: { ...secContent, brand: brandView, ai: content.ai },
          payload: secondarySeoPayload(input, secLocale), locale: secLocale, industry, location, companyName, disabledBlocks, secondary: true,
        });
        writeSecondaryLocaleConfig(siteDir, secContent, secLocale, content.brand);
        debug(`Secondary locale "${secLocale}" written (${secContent.pages.length} pages, tier dist: ${JSON.stringify(secContent.tierDistribution)})`);
        emit('secondary-locale-success', {
          locale: secLocale,
          pageCount: secContent.pages.length,
          tierDistribution: secContent.tierDistribution,
        });
      } catch (err) {
        debug(`Secondary locale "${secLocale}" failed: ${err.message}`);
        secondaryFailures.push({ locale: secLocale, error: err.message });
        emit('secondary-locale-failed', { locale: secLocale, error: err.message });
      }
    }
  }

  // #1593 —— 建站的四个数（只算 create-site.js 这个进程，口径见 lib/build-stats.js 文件头），交给 T8 #1600 的建站报告：
  //   seoFixed / pages → 报告的 repair 格（seoPass 回值经 recordSeo 累加，三个主语言调用点 —— #1633 加了代码补的 contact 页那一处）；durationSec → finishBuildReport；
  //   costUsd → 报告顶层 `costUsd`（九格里没有费用那一格；manager 按 `cost` 前缀把它从给客户的那份剥掉）。
  //   skipAI 那条路不经这里 ⟹ 它的 costUsd 留空（null），不是 0。
  const stats = buildStats.summary({ pages: content.pages.length });
  debug(`[build-stats] ${JSON.stringify(stats)}`);
  if (buildReport) buildReport.costUsd = stats.costUsd;

  // ─── Git Commit —— #1598 起它是最后一个阶段（secondaryLocales）的存档点：删掉存档、标记写成 secondaryLocales，提交、推送。
  //     entrypoint.sh 之后那一次前台推送仍是「存进仓了没有」的权威读数（#1592）。
  progress('Committing to git...', 80);
  const lastCommitted = checkpoint('secondaryLocales', null);
  previewPhaseDone('secondaryLocales', null);
  if (repoUrl) {
    try {
      const gitOpts = { cwd: rootDir, stdio: 'pipe' };
      // TICKET-142: emit chat-message anchor for the initial commit so the
      // dashboard's first user edit can Revert back to the AI-generated site.
      // 🔴 #1613 —— 最后一个阶段那次提交失败时不发：HEAD 那时不是 AI 建好的那个站（全失败 = 站仓的 Initial commit，只这一次失败 =
      //    少了第二语言），老板第一次编辑后点 Revert 会回到那里。宁可没有锚点：后端对「没有更早的提交」回 nil
      //    （manager/db.go §storeGetPrevAssistantMessage），前端 rowCanRevert 要它非空 ⟹ Revert 入口不出现。
      //    前四个阶段里失败、最后一次成功时照发 —— `git add site/ public/` 累积，那时 HEAD 就是完整的站。
      if (lastCommitted) {
        const initialCommitHash = execSync('git rev-parse --short HEAD', gitOpts).toString().trim();
        emit('chat-message', { role: 'system', content: 'Site created', commit_hash: initialCommitHash });
      } else {
        debug('[#1613] 最后一个阶段没提交上 ⟹ 不发「Site created」锚点');
      }
      const repoPageUrl = repoUrl.replace(/\.git$/, '');
      emit('repo', { url: repoPageUrl });
    } catch (e) {
      debug('Reading the site commit failed:', e.stderr?.toString() || e.message);
      fatal('Reading the site commit failed: ' + (e.stderr?.toString()?.split('\n')[0] || e.message));
    }
  }

  // #1596 —— 降级清单进报告的 `degraded` 那一格（一处没降级是 []）。skipAI 那条路不走这里，那一格留 null。
  buildReportLib.recordDegraded(buildReport, degradedSteps);
  finishBuildReport(siteDir);
  // #1599 —— 等排着的预览构建跑完再退出：最后那一次换上去了（result.json `final`）⟹ entrypoint 直接起预览、不再构建一次。
  if (stagedPreview) {
    const r = await stagedPreview.finish();
    debug(`[staged-preview] 结束：preview-viewable ${r.viewable ? '发了' : '没发'} · preview-reload ${r.reloads.join(' / ') || '（无）'} · 最后一个阶段的预览${r.final ? '已换上' : '没换上，entrypoint 自己构建'}`);
  }
  // Done — entrypoint.sh handles sync-config + the static preview (`next build` → `serve out`)
  progress('Site generated, starting preview...', 85);
}

// #1594 —— 选图那一步的三个数：发一条 `images` 事件，同时写进建站报告的 `images` 格。真 AI / skipAI 两个调用点都调。
function recordImageCounts(result) {
  const images = result && result.images;
  if (!images) return;
  emit('images', images);
  if (buildReport) buildReportLib.recordImages(buildReport, images);
}

// #1600 —— 写 `site/build-report.json`。耗时先记 create-site 自己这一段；entrypoint 跑完 next build + 死链检查之后
// 用整次建站的墙钟时间覆盖它（scripts/finish-build-report.js）。写不成只记一行，不让建站失败 —— 报告是旁观者。
function finishBuildReport(siteDir) {
  if (!buildReport) return;
  buildReport.durationSec = Math.round((Date.now() - startTime) / 1000);
  try {
    buildReportLib.writeReport(siteDir, buildReport);
  } catch (e) {
    debug(`[build-report] 写 ${buildReportLib.REPORT_FILE} 没成：${e.message}`);
  }
}

// ─── TICKET-122b / #1593: Secondary Locale ───────────────────────────────────

// #1593 —— 第二语言不再翻译：站级那一通、每页那一通、关键词页那一通已经把它的字一起写回来了（§lib/all-locales.js）。
// 这里只**拼**：主语言最终那一版是骨架（页面集合、块、图、链接、表单都取主语言的），文字取第二语言那一份。
//   · 主语言里由代码补的东西（服务详情页、「相关页面」列表、页脚的关键词栏）没有第二语言的字 ⟹ 对第二语言用它的服务目录
//     和文案表再拼一次同一个代码步骤，不调 AI；
//   · 站级的字缺哪一格，那一格退回主语言（跟改之前翻译丢字段时一样）。
// tierDistribution 只做观测（secondary-locale-success 事件带着它）：每页按 payload 的 secondaryLocaleKeywords 算 Tier。
// 写盘那一步（§writeSiteConfig，TICKET-268e）由代码插的 Contact 页不经 AI ⟹ 它的第二语言用站级那一通给的那几个词拼；
// 站级没给 ⟹ 照主语言那一页原样（跟改之前翻译失败时一样，宁可一页英文也不缺页）。
function contactPageIn(page, words) {
  const w = words && typeof words === 'object' ? words : {};
  const byType = {
    'page-header': { data: { headline: w.headline, subheadline: w.subheadline } },
    contact: { data: { headline: w.formHeadline, body: w.formBody } },
  };
  const out = JSON.parse(JSON.stringify(page));
  for (const f of ['title', 'description', 'navLabel']) if (typeof w[f] === 'string' && w[f].trim()) out[f] = w[f];
  out.sections = (page.sections || []).map((s) => localesLib.mergeLocale(s, byType[s && s.type]));
  return out;
}

// #1596 —— 骨架页（§pageSkeleton，`seo.placeholder: true`）是代码拼的、不经 AI 回包 ⟹ book 里没有它的第二语言。跟 contact 一样由代码给：
// 照主语言那一页原样（占位文案本来就是英文通用句，正文接受）。不给的话下面「pages missing」把整个第二语言放弃掉（PM 2026-10-06 A）。
function placeholderPageIn(page) {
  if (!(page.seo && page.seo.placeholder === true)) return null;
  const out = JSON.parse(JSON.stringify(page));
  // 目标词不是这个语言挖的（同 LocaleBook.build）⟹ translated: true，validateSite 第 ① 条跳过它。
  if (typeof out.seo.targetKeyword === 'string') out.seo.translated = true;
  return out;
}

function buildSecondaryContent({ content, locale, book, industry, disabledBlocks = [], secondaryKeywordsByPage = {} }) {
  const filled = (v) => typeof v === 'string' && v.trim() !== '';
  const t = (content.ai && content.ai.locales && typeof content.ai.locales[locale] === 'object' && content.ai.locales[locale]) || {};
  const tSvc = Array.isArray(t.services) ? t.services : [];

  // 服务目录：按 id 认，认不出按位置（服务 id 太长被收短过的，§capServiceIds）；代码补的服务（排在 AI 那几个之后）没有译名，留主语言。
  const services = content.services.map((svc, i) => {
    const x = tSvc.find((s) => s && s.id === svc.id) || (i < tSvc.length && tSvc[i] && !content.services.some((o) => o.id === tSvc[i].id) ? tSvc[i] : {});
    return {
      ...svc,
      name: filled(x.name) ? x.name : svc.name,
      shortDescription: filled(x.shortDescription) ? x.shortDescription : svc.shortDescription,
      fullDescription: filled(x.fullDescription) ? x.fullDescription : svc.fullDescription,
      features: Array.isArray(x.features) && x.features.length ? x.features : svc.features,
      products: Array.isArray(x.products) ? x.products : svc.products,
    };
  });

  // 页：AI 写的页按主语言骨架拼；代码补的页 / 块对第二语言再补一次。
  const pages = [];
  for (const p of content.pages) {
    const b = book.build(p, locale) || (p.slug === 'contact' ? contactPageIn(p, t.contactPage) : null) || placeholderPageIn(p);
    if (b) pages.push(b);
  }
  const keptServiceIds = [...new Set(content.pages.filter((p) => p.keywordPage === true).map((p) => kwPages.serviceIdOfKeywordPath(p.slug)).filter(Boolean))];
  const detail = kwPages.ensureServiceDetailPages({ pages, services, serviceIds: keptServiceIds, locale, disabledBlocks });
  for (const id of detail.added) {
    const pg = pages.find((x) => x.slug === `services/${id}`);
    const prim = content.pages.find((x) => x.slug === `services/${id}`);
    if (pg && prim) {
      pg.navOrder = prim.navOrder;
      if (prim.seo) pg.seo = { ...prim.seo, ...(typeof prim.seo.targetKeyword === 'string' ? { translated: true } : {}) };
      ensureH2Slots(pg, services.find((x) => x.id === id), disabledBlocks);
    }
  }
  if (detail.failed.length) throw new Error(`service detail pages for ${detail.failed.join(', ')} cannot be built in ${locale}`);
  const secKwPages = pages.filter((p) => p.keywordPage === true);
  kwPages.addRelatedBlocks(secKwPages, locale, disabledBlocks);
  // #1593 r3 —— alt 是回包之后代码写的（主语言那一侧 §writeImageAlts）；第二语言缺的那几张 §mergeLocale 留了空串，这里按第二语言
  // 这一页自己的标题、翻译过的目标词再写一遍 —— 跟主语言同一份代码。不写的话英文页上是中文 alt（QA2 r2 打回）。
  const alts = writeImageAlts({ pages, manifests: loadBlockManifests(), industry, targetKeywordOf: seoTargetOf });
  debug(`[${locale}] alt：补了 ${alts.written} 张 · ${alts.keyworded} 页的第一张内容图带上了目标词`);
  // 主语言的页集合 = 第二语言的页集合（按构造）；对不上就是逻辑出错，别静默写出一个缺页的站。
  const missing = content.pages.filter((p) => !pages.some((x) => x.slug === p.slug)).map((p) => p.slug);
  if (missing.length) throw new Error(`pages missing in ${locale}: ${missing.join(', ')}`);

  // 导航：链接跟主语言一模一样，文字换成第二语言的页名。
  const nav = content.navigation;
  const labelOf = new Map(pages.map((p) => [p.slug === 'home' ? '/' : `/${p.slug}`, p.navLabel]));
  const relabel = (l) => ({ ...l, label: l.href === '/' ? (filled(t.homeLabel) ? t.homeLabel : l.label) : (labelOf.get(l.href) || l.label) });
  const col0 = (nav.footer.columns || [])[0];
  const navigation = {
    ...nav,
    header: {
      ...nav.header,
      links: (nav.header.links || []).map(relabel),
      cta: { ...nav.header.cta, label: filled(t.ctaLabel) ? t.ctaLabel : nav.header.cta.label },
    },
    footer: {
      ...nav.footer,
      description: filled(t.footerDescription) ? t.footerDescription : nav.footer.description,
      copyright: filled(t.copyright) ? t.copyright : nav.footer.copyright,
      columns: [
        ...(col0 ? [{ ...col0, title: filled(t.quickLinksTitle) ? t.quickLinksTitle : col0.title, links: (col0.links || []).map(relabel) }] : []),
        ...(secKwPages.length ? kwPages.keywordFooterColumns(secKwPages, services, locale) : []),
      ],
    },
  };

  // #1548 —— 关键词清单是主语言挖的词，不带进第二语言的 seo.json。
  const { targetKeywords: _primaryOnly, ...seoBase } = content.seo;
  const ts = t.seo && typeof t.seo === 'object' ? t.seo : {};
  const seo = {
    ...seoBase,
    siteTitle: filled(ts.siteTitle) ? ts.siteTitle : content.seo.siteTitle,
    siteDescription: filled(ts.siteDescription) ? ts.siteDescription : content.seo.siteDescription,
    schema: { ...content.seo.schema, offerCatalogName: filled(ts.offerCatalogName) ? ts.offerCatalogName : (content.seo.schema || {}).offerCatalogName },
    locale: localeMapForBcp47(locale),
  };

  const tierDistribution = { 1: 0, 2: 0, 3: 0 };
  for (const p of pages) tierDistribution[computeTier((secondaryKeywordsByPage || {})[p.slug] || [])]++;

  return {
    brand: { tagline: filled(t.tagline) ? t.tagline : (typeof content.brand.tagline === 'string' ? content.brand.tagline : '') },
    seo,
    services,
    navigation,
    // #1471 —— 只取第二语言的字；结构（id / fields / primary）由写盘那一步按主语言骨架补（§writeSecondaryLocaleConfig）。
    forms: Array.isArray(t.forms) ? t.forms : [],
    formsBase: content.forms,
    pages,
    tierDistribution,
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
  // #1631 —— `formsBase` 只供结构；AI 没给这个语言的表单文案时取字表里这个语言那一行，不再继承主语言那份的字。
  const localeFiles = {
    'navigation.json': secContent.navigation,
    'seo.json': secContent.seo,
    'services.json': secContent.services,
    'forms.json': siteFormsFrom(secContent.forms, secContent.formsBase || undefined, secondaryLocale),
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

// TICKET-268e —— 每个站都要有一页导航点得进去的 Contact（表单 → /api/leads）；AI 没给就由代码补一页。返回补上的那一页（没补 ⟹ null）。
// #1633 —— `words` 是站级那一通给的主语言字（形状同第二语言的 contactPage：title · navLabel · description · headline ·
//    subheadline · formHeadline · formBody），只在主语言不是英文时传；缺哪个字段那个字段退回字表主语言那一行（#1631）。
//    description 里的品牌名取 `brand.name[主语言]`（同 seo-problems.js §brandNameOf）—— brand.name 是按语言的对象，
//    直接拼进模板串就是 `Get in touch with [object Object]`。
function ensureContactPage(content, defaultLocale, disabledBlocks = [], words = null) {
  const w = words && typeof words === 'object' ? words : {};
  // #1631 —— AI 没给的那几句不再退回英文，退回字表里主语言那一行（`lib/locale-words.js`）；字表里没有的语言才是英文。
  //    优先级 AI > 字表 > 英文。`en` 那一行逐字等于改之前的英文常量，英文站这一页一个字节不变。
  const brandName = brandNameOf(content.brand, defaultLocale);
  const fb = localeWords.contactPageWords(defaultLocale, brandName);
  const pick = (k) => (typeof w[k] === 'string' && w[k].trim() ? w[k].trim() : fb[k]);
  const contactOff = new Set(disabledBlocks);
  const contactSections = [
    { type: 'page-header', data: { headline: pick('headline'), subheadline: pick('subheadline') } },
    { type: 'contact', data: { headline: pick('formHeadline'), body: pick('formBody'), form: { id: 'contact' }, options: { form: 'full' } } },
  ].filter((sec) => !contactOff.has(sec.type));
  // 🔴 `contact` 被关掉时**整页不插**，不是插一个只剩标题的 Contact 页。268e 要的是
  //    「有一条看得见的联系路径」（那个表单 POST 到 /api/leads，进老板的 Customers），而一个
  //    导航里点得进去、进去什么都没有的页面比没有这一页更坏。`page-header` 被单独关掉时那一页
  //    照插，只是没有标题块 —— 表单还在，路径还在。
  const contactPageWanted = !contactOff.has('contact') && contactSections.length > 0;
  if (content.pages.some((p) => p.slug === 'contact') || !contactPageWanted) return null;
  const maxOrder = content.pages.reduce((m, p) => Math.max(m, p.navOrder ?? 0), 0);
  const page = {
    slug: 'contact', title: pick('title'), description: pick('description'),
    navLabel: pick('navLabel'), navOrder: maxOrder + 1, changeFrequency: 'monthly', priority: 0.7,
    sections: contactSections,
  };
  content.pages.push(page);
  return page;
}

// #1599 —— 给分段预览写一版站点文件，写进快照目录 `dir`（不碰 site/ —— site/ 跟阶段提交是一回事）。真写盘之前那几步这里也补上：
//    没有 contact 页就补一页（导航按钮多半指 /contact，不补的话 ② 时它 404）、首屏表单、站级深浅。content 先整份拷一份：
//    writeSiteConfig / ensureContactPage 都原地改它（#1631），而传进来的是建站正在用的那份。
function writePreviewSite(dir, content, { defaultLocale, disabledBlocks = [], industry }) {
  const c = structuredClone(content);
  ensureContactPage(c, defaultLocale, disabledBlocks, defaultLocale !== 'en' && c.ai ? c.ai.contactPage : null);
  applyHeroLeadForm({ content: c, industry, disabledBlocks });
  writeSiteConfig(dir, c, defaultLocale, disabledBlocks);
  writeThemeColorScheme(dir, normalizeColorScheme(c.ai && c.ai.colorScheme));
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
  // #1471 —— 站级表单库：默认表单的骨架（#1635 起只有 contact 一张；id / fields / primary 钉死）+ AI 写的文案（`scripts/lib/site-forms.js` §siteFormsFrom）。
  // #1631 —— AI 没给的那几句取主语言那一行（`locale-words.js`），不再是英文底稿。
  content.forms = siteFormsFrom(content.forms, undefined, defaultLocale);
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
  // #1633 —— 真 AI 那条路在写盘前、带着 AI 给的主语言字已经插过了（§ensureContactPage）；这里是 skipAI 示例站等其余路径的兜底，
  //    见到已有 contact 就什么都不做。
  ensureContactPage(content, defaultLocale, disabledBlocks);

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
        cta: { label: 'Get a Quote', href: '/contact' }, // #1636：只改 href（没有 quote 页了），label 留着
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
          { type: 'hero', data: { headline: 'Welcome to Demo Company', subheadline: 'Your trusted local business partner', ctas: [{ label: 'Get Started', href: '/contact', style: 'solid' }, { label: 'Learn More', href: '/about', style: 'outline' }] } },
          // #1425（T3）—— 服务那一格用引用写法（#1505）：条目来自 services.json，不抄进来。
          { type: 'features', data: { headline: 'Why Choose Us', body: 'What sets us apart from the rest', items: { source: 'services' } } },
          { type: 'cta', data: { headline: 'Ready to get started?', body: 'Contact us today for a free consultation.', ctas: [{ label: 'Contact Us', href: '/contact', style: 'solid' }] } },
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
    // #1661 —— 写进提示词的服务名（主语言那一份）。缺省 = services（不传的调用方跟改之前一样）。
    serviceNames = services,
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
    // #1593 —— 第二语言一次写完：`locales` = { primary: {code,name}, others: [{code,name}] }（没有第二语言时 others 为空，
    //    提示词和回包形状跟改之前逐字相同）；`book` 收每页回包里第二语言那一份（§lib/all-locales.js LocaleBook）；
    //    `secondaryKeywords` = payload 的 secondaryLocaleKeywords（{ [locale]: { [slug]: [{keyword, volume}] } }）。
    locales = { primary: { code: defaultLocale, name: languageName }, others: [] },
    book = null,
    secondaryKeywords = {},
    // #1598 —— 续跑：`resumeFrom` = 存档里最后一个做完的阶段在 BUILD_PHASES 里的下标（-1 = 从头），`resumeState` = 那份存档；
    //    `checkpoint(阶段, 存档)` 由 main 给（写标记 + 存档 + 提交 + 推送）。缺省 = 从头建、不存档（不传这三个的调用方行为不变）。
    resumeFrom = -1,
    resumeState = null,
    checkpoint = () => {},
    // #1599 —— 一个阶段做完：`onPhaseDone(阶段, content)` 把这一刻该给老板看的站交给分段预览（main §stagedPreview）。缺省 = 不预览。
    onPhaseDone = () => {},
  } = opts;
  const others = (locales.others || []).filter((o) => book && !book.failed.has(o.code));
  const otherCodes = others.map((o) => o.code);

  // #1346 —— 一个块被关掉之后，提示词里**三个地方**都不能再提它：菜单（下面那两处
  // `blockPromptSection`）、写死的页面规则那两行、以及 Call 2 的服务子页提示词（它不点名块）。
  // 漏掉任何一处的形态都一样：菜单里没有、正文却要求，模型两条要求对不上。
  const blockOff = new Set(disabledBlocks);
  const keepBlocks = (types) => types.filter((t) => !blockOff.has(t));
  // #1549 做什么 4 —— 子页 title 的预算按主语言的品牌名算（跟 seoProblems 第 1 条同一个数）。
  const titleSpec = pageTitleSpec(brandNameRecord(companyName, brandNameByLocale, defaultLocale)[defaultLocale]);
  // #1549 重开 —— meta description 的长度按主语言（§description-fit.js descriptionSpec），跟 seoProblems 第 2 条同一个数。
  const descSpec = descriptionSpec(defaultLocale);
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

  // #1661 —— 英语站同样要这一句（原来是空串）：老板填中文服务名时，AI 把中文原样抄进了英文站。
  const languageInstruction = `\nLANGUAGE: Write ALL content in ${languageName}.${chineseVariantHint(languageName)} This includes: taglines, descriptions, headlines, subheadlines, testimonial quotes, FAQ answers, service names, navigation labels, page titles, meta descriptions, keywords, and all other user-facing text. Only JSON keys and technical values (slugs, hrefs, icon names, section type names) should remain in English.\n`;

  // Build services instruction from real form data
  // #1661 —— 列的是主语言那一份服务名（有翻译种子的用翻译种子，§lib/target-keywords.js promptServiceNames），跟那组的主词是同一个词。
  const servicesList = serviceNames.length > 0 ? serviceNames : ['General Services'];
  const servicesInstruction = `SERVICES (use EXACTLY these — do NOT invent new ones):
${servicesList.map((s, i) => `${i + 1}. ${s}`).join('\n')}
Service names are written in ${languageName}: if a name above is not in ${languageName}, translate it into ${languageName}. Keep the same number of services, in the same order.`;

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
- slug = exactly the archetype name (e.g., "pricing", "gallery")
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

  // Page selection.
  // TICKET-120: when structure hard-copy is active, the REFERENCE SITE NAVIGATION
  // block above is the source of truth for nav pages — suppress the generic
  // "always include services" mandate that would otherwise pull Claude away from the hard-copied list.
  // #1601 —— 其余情况页面清单由整站配方给（lib/site-recipe.js），AI 不再挑页；勾了「照抄参照站结构」时用户点名要的那个赢
  //    （同首页配方的先例，见上面 `wantsRefLayout` 那段），走下面这条老路。
  const structureHardCopy = refPrefs.includes('structure') && refAnalysis && Array.isArray(refAnalysis.navLinks) && parseRefNavLinks(refAnalysis.navLinks).length > 0;
  // 这里只为写提示词：服务 id 要等站级那一通回来才有（下面 §采用配方 再按真 id 取一次），先拿一个占位 id 问「服务页有没有」。
  const recipePlan = structureHardCopy ? null : siteRecipe.sitePagesFor(industry, { services: ['{service-id}'], disabledBlocks });
  const RECIPE_PAGE_LINES = {
    home: () => '- "home" — the home page (navOrder 0)',
    services: () => '- "services" — the list of all the services, each linking to its own page',
    about: () => '- "about" — who the business is: its story, its people, why customers trust it',
    faq: () => '- "faq" — the questions customers really ask this kind of business',
    contact: (p) => `- "contact" — how to reach the business, with the contact form${recipePlan.ctaPage === p.slug ? ' (the call-to-action page)' : ''}`,
  };
  const pagesInstruction = recipePlan
    ? `PAGES OF THIS WEBSITE (fixed — write one entry in "pages" for EACH of these, and do NOT add, remove or rename any page):
${recipePlan.pages.filter((p) => p.kind !== 'service').map((p) => RECIPE_PAGE_LINES[p.kind](p)).join('\n')}
${recipePlan.pages.some((p) => p.kind === 'service') ? `- "services/{service-id}" — one page for EACH service (${servicesList.length} page${servicesList.length === 1 ? '' : 's'}): use the EXACT service id from the "services" array; set serviceDetailPage: true and parentService: "{service-id}"; navOrder 10-19, priority 0.8, changeFrequency "monthly"
` : ''}- navigation.ctaPage must be "${recipePlan.ctaPage}".`
    : `DYNAMIC PAGE SELECTION: Always include "home". The header nav pages are SPECIFIED by the REFERENCE SITE NAVIGATION (HARD COPY) block above — generate ONLY those archetypes as regular nav pages. Do NOT add any other regular pages. Do NOT add a "services" page unless it appears in the hard-copy archetypes list above.

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
  // 一页不合格 / 调不通只重试这一页一次；仍不行 ⟹ 那一页发骨架页 + 一笔降级，写明是哪一页（#1596 第 6 条；以前是建站失败）。
  // #1633 —— 主语言不是英文的站：代码自己写的那几处字（导航的首页、页脚第一栏标题、代码补的联系页）也向站级这一通要主语言的。
  //    字段形状与说法照第二语言那份（lib/all-locales.js §languagesPrompt 的 homeLabel / quickLinksTitle / contactPage），
  //    但放在回包【顶层】—— 单语言站根本没有 locales。主语言是英文 ⟹ 这一段是空串，提示词逐字不变（写盘照用英文常量）。
  const primaryWordsShape = locales.primary.code === 'en' ? '' : `  "homeLabel": "<nav label for the home page, in ${locales.primary.name}>",
  "quickLinksTitle": "<footer column title, like Quick Links, in ${locales.primary.name}>",
  "contactPage": { "title": "<like Contact Us>", "navLabel": "<like Contact>", "description": "<like Get in touch with ${companyName}>", "headline": "<like Contact Us>", "subheadline": "<like Send us a message and we'll get back to you shortly.>", "formHeadline": "<like Get in touch>", "formBody": "<like Leave your details and we will reach out soon.>" },
`;
  const brandNameRule = `CRITICAL BRAND NAME RULE (TICKET-137):
The brand name "${companyName}" is canonical and MUST appear LITERALLY VERBATIM in all
generated content — hero headlines, subtitles, page descriptions, footer description,
copyright, CTA text, and ANY user-visible string that references the brand.

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
    "ctaPage": "${recipePlan ? recipePlan.ctaPage : '<slug of the CTA target page, e.g. contact>'}",
    "footerDescription": "<1 sentence with location + primary keyword>"
  },
${primaryWordsShape}  "seo": {
    "siteTitle": "<max 60 chars>",
    "siteDescription": "<${descSpec}, location + services + CTA>",
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
      "description": "<Page meta description, ${descSpec}>",
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
- "forms" is the site's one lead form (#1635): "contact" (name, phone, email, message). Its fields are FIXED — write only the visitor-facing words (name, buttonText, successMessage) to fit this business.
- "pages" is an ARRAY of page objects, each with slug, title, description, navLabel, navOrder, changeFrequency, priority, and brief.
- Every page's "brief": 2-3 sentences, in the site's language, saying what that page must cover — its main points, specific to this business. The page's sections are written later from it: do NOT write "sections".
- navOrder determines the order in the navigation. Home is always 0. Assign sequential numbers (1, 2, 3...) to other pages.
- The CTA page (navigation.ctaPage) should have a higher navOrder so it appears last (but it won't be in the header nav — it becomes the CTA button).
${FACTS_ONLY_FROM_FORM_RULE}
- Page titles (pages[].title): ${titleSpec}. The home page's <title> is seo.siteTitle, used as-is: max 60 chars. Every meta description (seo.siteDescription and pages[].description): ${descSpec}.
- Use specific language, not generic fluff.
- Include location names naturally in content.
- Service detail pages (slug "services/{id}") must set serviceDetailPage: true and parentService: "{service-id}".
- Service detail pages should NOT appear in the header nav — they go in the footer only.${others.length ? `\n\n${localesLib.languagesPrompt({ primary: locales.primary, others, kind: 'site' })}` : ''}`;

  // ── #1598 plan 阶段：站级那一通 + 收服务 id。plan 已存档 ⟹ 整段跳过、拿存档里那份（一通调用都不发）。
  let ai;
  let idRenames;
  // #1596 —— brand 是代码拼的站级计划给的（不是 AI 回包）⟹ payload 没给邮箱就不写 brand.email（不落进 'info@example.com' 那个兜底）。
  //    brand 在 pages 阶段之后才写 ⟹ 这一位跟着 plan / pages 两份存档走，续跑的站照样认得它。
  let brandByCode = false;
  // #1601 —— 配方给每页的块序（按页面对象记：§采用配方 之后 capServiceIds 还会改服务页的 slug）和顶部导航放哪几页。
  // #1601 × #1598 —— 续跑时的页是从存档 JSON 读回来的新对象，按对象身份记的块序会跟丢（同 LocaleBook）⟹ 跟着存档走：
  //    存档点按【那一刻的 slug】写进 state（§recipeSnapshot，slug 那时已收完），续跑时按 slug 挂回读回来的页。
  //    不带上它，从 plan 续跑的站每页那一通不锁块序、不写预设，从 pages 续跑的站顶部导航退回全部普通页。
  const recipeBlocksOf = new WeakMap();
  let recipeNav = null;
  const recipeSnapshot = () => (recipeNav
    ? { nav: [...recipeNav], blocks: Object.fromEntries(ai.pages.filter((p) => recipeBlocksOf.has(p)).map((p) => [p.slug, recipeBlocksOf.get(p)])) }
    : null);
  // #1599 —— 站级那几份（brand / navigation / seo）怎么从 ai 拼出来，抽成两个函数：分段建站的预览（① 骨架、② 能看了）在出 logo、
  //    出图之前就要它们；images 阶段照旧调它们，再往 brand 里添坐标 / logo、往页里填图（那几步不碰导航和 seo）。
  //    `say` = 日志：images 阶段那一次打 debug，预览那几次不打（同一段日志不重复三遍）。
  const assembleBrand = (say = () => {}) => {
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
    // #1596 —— 代码拼的站级计划那条路：payload 没给邮箱 ⟹ 没有这个键（上面那个 'info@example.com' 兜底是 AI 那条路的既有行为，不动）。
    if (brandByCode && !ai.brand.email) delete brand.email;

    // Write socialLinks to brand.json deterministically (not relying on Claude prompt)
    if (onlinePresence && onlinePresence.socialLinks) {
      const sl = onlinePresence.socialLinks;
      const filtered = {};
      for (const [platform, url] of Object.entries(sl)) {
        if (url) filtered[platform] = url;
      }
      if (Object.keys(filtered).length > 0) {
        brand.socialLinks = filtered;
        say(`Social links written to brand.json: ${Object.keys(filtered).join(', ')}`);
      }
    }

    // Override colors/fonts with reference site analysis when available
    if (refAnalysis && refPrefs.includes('colors-fonts') && refAnalysis.primaryColor) {
      brand.colors = {
        primary: generatePalette(refAnalysis.primaryColor),
        accent: generateAccentPalette(refAnalysis.accentColor || refAnalysis.primaryColor),
      };
      say(`Colors overridden from reference site: primary=${refAnalysis.primaryColor}, accent=${refAnalysis.accentColor || 'same as primary'}`);
    }
    if (refAnalysis && refPrefs.includes('colors-fonts') && refAnalysis.headingFont) {
      const refFonts = buildFontsFromRef(refAnalysis.headingFont, refAnalysis.bodyFont);
      if (refFonts) {
        brand.fonts = refFonts;
        say(`Fonts overridden from reference site: heading=${refAnalysis.headingFont}, body=${refAnalysis.bodyFont || refAnalysis.headingFont}`);
      } else {
        say(`Font "${refAnalysis.headingFont}" not in whitelist, keeping theme fonts`);
      }
    }
    return brand;
  };
  const assembleNavSeo = (pages, say = () => {}) => {
    // #1635 —— 只有「照抄参照站结构」那条路走得到这个兜底（配方那条路在上面整个覆盖成配方的 ctaPage）。
    const ctaPage = ai.navigation.ctaPage || 'contact';
    // #1601 —— 配方在 contact 被后台关掉时让按钮指首页（lib/site-recipe.js §sitePagesFor）。
    const ctaSlug = ctaPage === 'home' ? '/' : `/${ctaPage}`;

    const allNonHome = pages.filter(p => p.slug !== 'home').sort((a, b) => (a.navOrder ?? 99) - (b.navOrder ?? 99));
    const serviceDetailPages = allNonHome.filter(p => p.serviceDetailPage === true);
    const regularPages = allNonHome.filter(p => !p.serviceDetailPage);

    // Header nav: regular pages only (service detail + keyword pages excluded)
    // Footer: Quick Links column (service links handled by hardcoded Footer.tsx section)
    // #1633 —— 主语言不是英文时用站级那一通给的主语言字；没给 / 英文站 ⟹ 今天的英文常量。
    const primaryWord = (v, en) => (defaultLocale !== 'en' && typeof v === 'string' && v.trim() ? v.trim() : en);
    const homeLabel = primaryWord(ai.homeLabel, "Home");
    const footerColumns = [{
      title: primaryWord(ai.quickLinksTitle, "Quick Links"),
      links: [
        { label: homeLabel, href: "/" },
        ...regularPages
          .filter(p => p.navLabel)
          .map(p => ({ label: p.navLabel, href: `/${p.slug}` }))
      ]
    }];

    const navigation = {
      header: {
        links: [
          { label: homeLabel, href: "/" },
          // #1601 —— 配方定顶部导航放哪几页（判据：到得了每一张服务页）；照抄参照站结构那条老路仍是全部普通页。
          ...(recipeNav ? allNonHome.filter((p) => recipeNav.has(p.slug)) : regularPages)
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
    if (hoursCheck.reason) say(`[hours] 营业时间不出：${hoursCheck.reason}`);
    else if (hoursCheck.segments.length) say(`[hours] 营业时间 ${hoursCheck.segments.length} 段，逐个小时数都在原文里`);
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
    return { navigation, seo };
  };
  // #1599 ① —— 某一页还没写（plan 做完时每一页都还没写）就用骨架页（#1596 §skeletonSections，同 §pageSkeleton 那一支）顶上，标 placeholder。
  const skeletonPage = (p) => ({
    ...p,
    seo: { ...(p.seo && typeof p.seo === 'object' ? p.seo : {}), placeholder: true },
    sections: fallbackSite.skeletonSections(p, { companyName, sitePages: ai.pages, ctaPage: ai.navigation && ai.navigation.ctaPage, disabledBlocks }),
  });
  // 给预览用的一整份 content（同本函数的回值形状），pages 由调用方给。
  const previewContent = (pages) => ({ brand: assembleBrand(), ...assembleNavSeo(pages), services: ai.services, pages, ai });

  if (resumeFrom >= 0) {
    let recipe;
    ({ ai, idRenames = [], brandByCode = false, recipe = null } = resumeState);
    if (recipe) {
      for (const p of ai.pages) if (recipe.blocks[p.slug]) recipeBlocksOf.set(p, recipe.blocks[p.slug]);
      recipeNav = new Set(recipe.nav);
      debug(`[resume] 整站配方跟着存档回来：${Object.keys(recipe.blocks).length} 页的块序；顶部导航 ${recipe.nav.join(' · ') || '（只有首页）'}`);
    }
    debug(`[resume] 跳过 plan 阶段（站级那一通）：存档里 ${ai.pages.length} 页`);
  } else {
    emit('prompt', { name: 'Base Site', content: sitePrompt });
    progress('AI is planning the site...', 20);

    // TICKET-132 / #1618: JSON 坏了 callAIWithRetry 先本地修、再交给 AI 修一次、再重写一次
    // (AI hallucinating malformed JSON). max_tokens still throws immediately
    // (prompt-size issue, retry won't help).
    const call1Start = Date.now();
    let response;
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
      // #1596 —— 存在 site/ 外面：这次失败不再结束建站，site/ 之后会整个提交进客户的站仓。
      if (e.lastText) {
        const debugPath = path.join(__dirname, '..', '_ai-response.txt');
        try { fs.writeFileSync(debugPath, e.lastText); } catch {}
        debug('Raw AI response saved to:', debugPath);
      }
      // TICKET-148: classify by error type to avoid the "Failed to
      // parse AI response as JSON" misnomer for Anthropic API overload errors.
      // #1596 第 1–4 条 —— 这四种以前各是一句 fatal，现在都降级成代码拼的站级计划；之后每页那一通照常调 AI。
      const why = /max_tokens hit/.test(e.message || '') ? 'AI response was truncated (hit token limit) while planning the site.'
        : (e.constructor?.name === 'APIError' || isRetryableApiError(e) || (e.status && e.status >= 400)) ? `AI service error: ${e.message}`
          : e.lastText ? 'Failed to parse AI response as JSON after retries'
            : `AI call failed: ${e.message}`;
      degrade('site-plan', 'site plan', `${why} —— 用代码拼的站级计划（home + services + 每个服务一页 + contact）`);
      ai = fallbackSite.fallbackSitePlan({ companyName, services, location: rawLocation, address, phone, email, locale: locales.primary.code });
      brandByCode = true;
      // 第二语言的站级字也由代码给（同 §contactPageIn 对 contact 那一页）：给一份空的 ⟹ 写盘时每一格退回主语言那句通用话
      // （§buildSecondaryContent「站级的字缺哪一格，那一格退回主语言」）。不给的话下面那段把整个第二语言放弃掉（PM 2026-10-06 A）。
      ai.locales = Object.fromEntries(others.map((o) => [o.code, {}]));
      response = null;
    }
    // 站级那一通没成时没有回包 ⟹ 这一通按 0 记（#1596）。
    const usage1 = (response && response.usage) || {};
    const cost1 = ((usage1.input_tokens || 0) * pricing.input + (usage1.output_tokens || 0) * pricing.output) / 1_000_000;
    const call1Duration = ((Date.now() - call1Start) / 1000).toFixed(1);
    debug(`Call 1 site plan cost: $${cost1.toFixed(4)} (${usage1.input_tokens} in / ${usage1.output_tokens} out, ${call1Duration}s)`);

    // #1593 —— 站级那一份第二语言的字（品牌标语 / 导航 / SEO / 服务 / 表单）。整份缺 ⟹ 这个第二语言放弃（主语言照常）；
    //    缺个别字段 ⟹ 写盘时那一格退回主语言（§buildSecondaryContent）。
    for (const o of others) {
      const g = ai && ai.locales && typeof ai.locales === 'object' ? ai.locales[o.code] : null;
      if (!g || typeof g !== 'object' || Array.isArray(g)) {
        book.fail(o.code, `the site-level answer has no "${o.code}" texts`);
        debug(`[locales] 站级回包里没有 ${o.code} 那一份 ⟹ 放弃第二语言 ${o.code}，主语言照常`);
      }
    }

    // 站级回包里的页面清单：每页要有 slug（文件名就是它）。sections 不归这一通管 —— 写回来了也丢掉，由下面每页那一通写。
    if (!ai || typeof ai !== 'object' || Array.isArray(ai)) ai = {}; // 回包不是对象 ⟹ 当成什么都没给（第 5 条接住）
    ai.pages = (Array.isArray(ai.pages) ? ai.pages : []).filter((p) => p && typeof p === 'object' && typeof p.slug === 'string' && p.slug.trim());
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
    // #1596 第 5 条 —— 回包里别的字段照用，只有页面清单换成代码拼的那份（缺的站级字段也从那份里补，免得下面读到 undefined）。
    if (!ai.pages.length) {
      degrade('site-plan-pages', 'pages', 'The site plan from the AI has no pages (#1568: Call 1 site-level answer without a usable "pages" list) —— 页面清单换成代码拼的那份');
      const plan = fallbackSite.fallbackSitePlan({ companyName, services, location: rawLocation, address, phone, email, locale: locales.primary.code });
      if (!ai.brand || typeof ai.brand !== 'object') brandByCode = true;
      for (const k of ['brand', 'seo', 'navigation']) if (!ai[k] || typeof ai[k] !== 'object') ai[k] = plan[k];
      if (!Array.isArray(ai.services) || !ai.services.some((s) => s && typeof s.id === 'string' && s.id)) ai.services = plan.services;
      ai.pages = fallbackSite.fallbackPages({ companyName, services: ai.services, location: rawLocation, locale: locales.primary.code });
      ai.navigation.ctaPage = 'contact'; // 这份清单里唯一的联系页
    }
    // #1601 —— 采用配方：页面清单从配方来（按回包里的服务 id 展开每个服务一页），站级回包只取每页的文字
    //    （title / description / navLabel / navOrder / brief …）。回包里配方外的页一张都不采用，各记一行日志。
    //    每页的块序记在 `recipeBlocksOf`（见上面它的声明）。
    if (recipePlan) {
      const plan = siteRecipe.sitePagesFor(industry, { services: ai.services, disabledBlocks });
      const inPlan = new Set(plan.pages.map((p) => p.slug));
      for (const p of ai.pages) if (!inPlan.has(p.slug)) debug(`[recipe] 站级回包里的「${p.slug}」不在配方里 ⟹ 不采用`);
      const fromAi = new Map(ai.pages.map((p) => [p.slug, p]));
      const svcName = new Map((Array.isArray(ai.services) ? ai.services : []).filter((x) => x && x.id).map((x) => [x.id, x.name || x.id]));
      const TEXT = ['title', 'description', 'navLabel', 'navOrder', 'changeFrequency', 'priority', 'brief'];
      let svcOrder = 10;
      // #1601 × #1596 —— 站级回包（或代码拼的站级计划）没给这一页的 description ⟹ 代码写一句，长度落在区间内
      //    （同 lib/fallback-site.js §fittedDescription 的理由：短了每页多一次 SEO 修补、多一条 seo 降级）。
      //    站级计划里有的页用它那句；配方多出来的页（about / faq）用一句通用话。
      const planDesc = new Map(fallbackSite.fallbackPages({ companyName, services: ai.services, location: rawLocation, locale: locales.primary.code }).map((p) => [p.slug, p.description]));
      const inLoc = typeof rawLocation === 'string' && rawLocation.trim() ? ` in ${rawLocation.trim()}` : '';
      const codeDesc = (slug, title) => planDesc.get(slug)
        || fallbackSite.fittedDescription(`${title} — ${companyName}${inLoc}. Find out more about how we work and what to expect, then get in touch with our team today.`, locales.primary.code);
      ai.pages = plan.pages.map((rp) => {
        const got = fromAi.get(rp.slug) || {};
        const name = rp.kind === 'service' ? svcName.get(rp.parentService) : null;
        const base = rp.kind === 'home' ? { title: 'Home', navLabel: 'Home', navOrder: 0, changeFrequency: 'weekly', priority: 1 }
          : rp.kind === 'service' ? { title: name, navLabel: name, navOrder: svcOrder++, changeFrequency: 'monthly', priority: 0.8 }
            : { ...siteRecipe.PAGE_DEFAULTS[rp.kind] };
        // #1631 —— 联系页的标题 / 导航名：站级回包没给时用主语言那一行（`locale-words.js`），不再是英文的 Contact Us / Contact。
        //    AI 给了照样用 AI 的（下面那行 `for (const k of TEXT)` 盖在它上面）。
        if (rp.kind === 'contact') {
          const cw = localeWords.contactPageWords(locales.primary.code);
          base.title = cw.title;
          base.navLabel = cw.navLabel;
        }
        const page = { slug: rp.slug, ...base };
        for (const k of TEXT) if (got[k] !== undefined && got[k] !== null && got[k] !== '') page[k] = got[k];
        if (!page.description) page.description = rp.kind === 'home' ? ((ai.seo && ai.seo.siteDescription) || companyName) : codeDesc(rp.slug, page.title);
        if (rp.serviceDetailPage) { page.serviceDetailPage = true; page.parentService = rp.parentService; }
        if (rp.blocks.length) recipeBlocksOf.set(page, rp.blocks);
        return page;
      });
      ai.navigation = { ...(ai.navigation || {}), ctaPage: plan.ctaPage };
      recipeNav = new Set(plan.nav);
      debug(`[recipe] 整站配方（${plan.sector || '认不出行业组 ⟹ 默认配方'}）：${ai.pages.length} 页 ${ai.pages.map((p) => p.slug).join(' · ')}；顶部导航 ${plan.nav.join(' · ') || '（只有首页）'}；按钮指 ${plan.ctaPage}`);
    }

    // #1565 —— 服务 id 是 AI 写的，会原样变成文件名（pages/services/<id>.json）：收进跟关键词页 slug 同一个上限。
    //    #1568 —— 放在站级那一通之后、每页那几通之前：每页的提示词里给的就是收过的 id（链接按它写）。
    idRenames = kwPages.capServiceIds({ services: ai.services, pages: ai.pages, navigation: ai.navigation });
    for (const r of idRenames) {
      debug(`[services] AI 写的服务 id 有 ${Buffer.byteLength(r.from)} 字节，超过文件名能放的上限，网址改用 ${r.to}（${Buffer.byteLength(r.to)} 字节）`);
    }
    checkpoint('plan', { ai, idRenames, brandByCode, recipe: recipeSnapshot() });
  }
  // #1599 ① —— 站级结构定了，每页先用骨架页拼一版给预览构建（不通知平台）。pages 已存档（从 pages 或更后续跑）⟹ 没有 ①。
  if (resumeFrom < 1) onPhaseDone('plan', previewContent(ai.pages.map(skeletonPage)));

  // ── #1598 pages 阶段：每页一通 + 整站那一条块库检查。pages 已存档 ⟹ 整段跳过（存档里那份 ai 每页都已带着 sections）。
  if (resumeFrom >= 1) {
    debug(`[resume] 跳过 pages 阶段（每页那几通）：存档里 ${ai.pages.length} 页都带着 sections`);
  } else {
    // ── ② 每页一次 ──────────────────────────────────────────────────────────────────────────────────
    const forms = siteFormsFrom(ai.forms, undefined, defaultLocale);
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
      ai.navigation && ai.navigation.ctaPage ? `- Call-to-action page: "${hrefOf(ai.navigation.ctaPage)}"${ai.navigation.ctaLabel ? ` (button text "${ai.navigation.ctaLabel}")` : ''}` : null,
      `- Forms: ${forms.map((f) => `"${f.id}"${f.name ? ` (${f.name})` : ''}`).join(', ')}`,
    ].filter((l) => l !== null).join('\n');

    // 第二语言这一页的搜索词（payload 的 secondaryLocaleKeywords；manager 今天不送 ⟹ 恒空，提示词里那一行不出现）。
    const secondaryKeywordsOf = (code, slug) => ((secondaryKeywords[code] || {})[slug] || [])
      .map((k) => (k && typeof k.keyword === 'string' ? k.keyword : '')).filter(Boolean);
    const pagePromptFor = (page) => {
      const isHome = page.slug === 'home';
      // #1601 —— 配方定了这一页的块序（首页除外：首页归 #1034 的配方）⟹ AI 只填内容，不挑块。
      const fixed = recipeBlocksOf.get(page) || null;
      const fixedLines = fixed ? [
        `- This page's sections are FIXED: write exactly these ${fixed.length}, in this order: ${siteRecipe.blockOrderLine(fixed)}. Do not add, drop or reorder any section.`,
        ...fixed.filter((x) => x.note).map((x) => `  - "${x.type}": ${x.note}`),
      ] : [];
      const svc = page.serviceDetailPage === true ? svcById.get(page.parentService) || svcById.get(page.slug.replace(/^services\//, '')) : null;
      const kw = typeof pageKeywords[page.slug] === 'string' ? pageKeywords[page.slug] : '';
      const thisPage = [
        `- slug: "${page.slug}"`,
        page.title ? `- title: ${page.title}` : null,
        page.description ? `- meta description: ${page.description}` : null,
        page.brief ? `- what it must cover: ${page.brief}` : null,
        kw ? `- target keyword: "${kw}" — use that exact phrase in the page's single H1 (the "headline" of its one "hero" or "page-header" section), within its first 100 words, and in at least two H2s (the "headline" of other sections).` : null,
        isHome ? '- This is the HOME page. Choose 7-10 sections — the homepage must feel unique: do NOT use all sections, pick what fits the industry.'
          : svc && fixed ? `- This is the detail page of the service "${svc.name}" (id ${svc.id}). Write unique, detailed SEO content for this service.`
            : svc ? `- This is the detail page of the service "${svc.name}" (id ${svc.id}). It needs 5-7 sections: ${serviceDetailSectionRule}. Write unique, detailed SEO content for this service.`
              : null,
        ...fixedLines,
      ].filter((l) => l !== null).join('\n');
      const rules = [
        '- Return {"sections": [ ... ]}: this page\'s sections in order, each { "type": "<section type>", "data": { ... } } as described under AVAILABLE SECTION TYPES.',
        '- Any block with a "form" slot uses the site\'s one form: leave "form": {} (= that form, "contact").',
        ...(isHome ? [
          `- There are ${offeredTypeCount} section types. USE THIS VARIETY. Each site should feel different.`,
          varySectionOrderRule,
          homeRecipe ? recipePromptLines(homeRecipe, disabledBlocks) : rareSectionExamplesRule,
        ] : fixed ? [] : [criticalBlockRules]),
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
${fixed ? 'The sections of this page are fixed (see THIS PAGE above). Below is the data each section type takes — write the data of the fixed sections only.' : 'You are a layout designer. For this page, you choose WHICH sections to include and in WHAT order. Not every page needs every section. Mix it up based on what makes sense for this industry.'}

HOMEPAGE SECTIONS (pick 7-10 from these, in any order):
${blockPromptSection('homepage', undefined, { ...(isHome && homeRecipe ? { order: homeRecipe.promptOrder } : {}), omit: disabledBlocks })}

PAGE-SPECIFIC SECTION RULES:
${blockPromptSection('page-specific', undefined, { omit: disabledBlocks })}${contentNewPageLine}
${pageRuleLines}

BUTTONS:
${BUTTON_REF_PROMPT}

RULES:
${rules}${others.length ? `\n\n${localesLib.languagesPrompt({
      primary: locales.primary, others, kind: 'page', hasKeyword: !!kw,
      keywordsByLocale: Object.fromEntries(others.map((o) => [o.code, secondaryKeywordsOf(o.code, page.slug)])),
    })}` : ''}`;
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
    // 而且进程中途退出（真正的程序错误走到兜底 catch）时，后面那几页的提示词也不会从日志里消失。
    const prompts = ai.pages.map((p) => pagePromptFor(p));
    ai.pages.forEach((p, i) => emit('prompt', { name: `Page: ${p.slug}`, content: prompts[i] }));
    debug(`[pages] 站级那一通给了 ${N} 页：${ai.pages.map((p) => p.slug).join(' · ')}；每页一次调用，≤${PAGE_CONCURRENCY} 页同时在飞`);

    // #1596 第 6 条 —— 这一页两次都没生成好 ⟹ 发骨架页（lib/fallback-site.js §skeletonSections：中性句式，事实只从 payload / 站级计划取），
    //    标 `seo.placeholder: true`（seoPass 跳过它，不花一次 AI 重写占位文案），记一笔降级。以前这里是整站失败。
    const pageSkeleton = (i, why) => {
      const page = ai.pages[i];
      degrade('page', page.slug, `Page ${i + 1}/${N} "${page.slug}" could not be generated after one retry (#1568): ${why} —— 发骨架页`);
      page.seo = { ...(page.seo && typeof page.seo === 'object' ? page.seo : {}), placeholder: true };
      pagesDone += 1;
      progress(`Page ${pagesDone}/${N} written: ${page.slug}`, 25 + Math.round((15 * pagesDone) / N));
      return fallbackSite.skeletonSections(page, { companyName, sitePages: ai.pages, ctaPage: ai.navigation && ai.navigation.ctaPage, disabledBlocks });
    };
    let pagesDone = 0;
    const onePage = async (i) => {
      const page = ai.pages[i];
      const isHome = page.slug === 'home';
      const where = `第 ${i + 1}/${N} 页（${page.slug}）`;
      const kw = typeof pageKeywords[page.slug] === 'string' ? pageKeywords[page.slug] : '';
      // #1593 —— 回包按语言拆开：主语言那一份照旧取 sections；第二语言那几份留着，等主语言这一页定下来再挂进 book。
      //    没有第二语言 ⟹ `others` 为空，回包就是 {"sections": [...]}（跟改之前一样）。
      const call = async (messages, detail) => {
        const raw = (await callAIWithRetry({
          client,
          baseOptions: { model, max_tokens: maxTokens, messages },
          costContext: { operation: 'create-site', detail, pricing, durationStart: Date.now() },
          label: `Call 1 page ${page.slug}`,
        })).parsed;
        const split = localesLib.splitLocaleReply(raw, locales.primary.code, otherCodes);
        return { raw, sections: sectionsOf(split.primary), others: split.others };
      };
      // 一页的判据：块库逐块那几条（scope 'edit' = 只查这一页自己；「整个站里没有 X」那一条等全部页回来再查）+ 首页骨架配方。
      const problemsOf = (sections) => {
        if (!sections) return { block: ['回包里没有 sections 数组'], skin: [] };
        const trial = { ...page, sections };
        const fixed = recipeBlocksOf.get(page);
        return {
          // #1601 —— 块序跟配方对不上算块库问题：同一次重试、同一条失败路。
          block: [...(fixed ? siteRecipe.blockOrderProblems(sections, fixed) : []),
            ...validateBlocks({ pages: [trial], industry, disabledBlocks, forms, scope: 'edit' }).problems],
          skin: isHome && homeRecipe ? recipeProblems([trial], homeRecipe) : [],
        };
      };
      // #1593 —— 第二语言那几份对不对得上主语言这一组块（还没被放弃的语言才查）。{ [locale]: problems[] }，空对象 = 都能用。
      const secondaryOf = (sections, got) => {
        const out = {};
        for (const loc of otherCodes) {
          if (book.failed.has(loc) || !sections) continue;
          const p = localesLib.secondaryPageProblems({ page, sections, group: got.others[loc], needKeyword: !!kw });
          if (p.length) out[loc] = p;
        }
        return out;
      };
      const secondaryLines = (bad) => Object.entries(bad).map(([loc, p]) => `the "${loc}" part does not match the "${locales.primary.code}" part: ${p.join('; ')}`);
      // 主语言这一页定下来了（`sections`）：第二语言从候选回包里按顺序取第一份对得上的挂进 book；一份都对不上 ⟹ 放弃这个语言。
      const finish = (sections, candidates = []) => {
        for (const loc of otherCodes) {
          if (book.failed.has(loc)) continue;
          let why = 'missing';
          const hit = candidates.find((c) => {
            const p = localesLib.secondaryPageProblems({ page, sections, group: c.others[loc], needKeyword: !!kw });
            if (p.length) why = p.join('; ');
            return !p.length;
          });
          if (hit) book.link(page, sections, loc, hit.others[loc]);
          else {
            book.fail(loc, `page "${page.slug}": ${why}`);
            debug(`[locales] ${where} 的 ${loc} 那一份重试后仍对不上主语言（${why}）⟹ 放弃整个第二语言 ${loc}，主语言照常`);
          }
        }
        pagesDone += 1;
        progress(`Page ${pagesDone}/${N} written: ${page.slug}`, 25 + Math.round((15 * pagesDone) / N));
        return sections;
      };
      const again = (problems) => `Your sections for the page "${page.slug}" break the block library rules below. Fix ONLY these and `
        + (otherCodes.length
          ? `respond AGAIN with the COMPLETE JSON for this page (the same object keyed by language code, no markdown fences):\n`
          : `respond AGAIN with the COMPLETE JSON for this page ({"sections": [ ... ]}, no markdown fences):\n`)
        + problems.map((x) => `- ${x}`).join('\n');

      let first;
      try {
        first = await call([{ role: 'user', content: prompts[i] }], `Page ${page.slug}`);
      } catch (e) {
        // 调不通（截断 / API 错 / 解析不了）⟹ 重来一次这一页，别的页不动。
        debug(`[pages] ${where} 调用失败：${e.message} —— 重试第 ${i + 1} 页`);
        let retried;
        try { retried = await call([{ role: 'user', content: prompts[i] }], `Page ${page.slug} (retry)`); } catch (e2) { return pageSkeleton(i, `AI call failed twice: ${e2.message}`); }
        const p = problemsOf(retried.sections);
        if (p.block.length) return pageSkeleton(i, `the retry still breaks the block library:\n  ${p.block.join('\n  ')}`);
        if (p.skin.length) debug(`[fingerprint] ⚠️  ${where} 首页开场仍跟配方对不上,放行:\n  ${p.skin.join('\n  ')}`);
        return finish(retried.sections, [retried]);
      }
      const p1 = problemsOf(first.sections);
      const s1 = secondaryOf(first.sections, first);
      if (!p1.block.length && !p1.skin.length && !Object.keys(s1).length) return finish(first.sections, [first]);

      // 不合格 ⟹ 把问题原样退给它、只重试这一页一次（#999 的「只重试一次」，#1034 的骨架问题、#1593 第二语言对不上都进同一次重试）。
      const all = [...p1.block, ...p1.skin, ...secondaryLines(s1)];
      debug(`[pages] ${where} 第一次有 ${all.length} 处不合规(块库 ${p1.block.length} · 首页骨架 ${p1.skin.length} · 第二语言 ${Object.keys(s1).length}) —— 重试第 ${i + 1} 页:\n  ${all.join('\n  ')}`);
      let second;
      try {
        second = await call([
          { role: 'user', content: prompts[i] },
          { role: 'assistant', content: JSON.stringify(otherCodes.length ? first.raw : { sections: first.sections }) },
          { role: 'user', content: again(all) },
        ], `Page ${page.slug} (re-check)`);
      } catch (e) {
        // 块库干净时第一次那份本来就能用（骨架问题不让建站失败，见下面 afterRetry 那一段；第二语言对不上只放弃那个语言）。
        if (!p1.block.length) { debug(`[pages] ⚠️  ${where} 为骨架 / 第二语言发起的重试调不通（${e.message}），用第一次那份`); return finish(first.sections, [first]); }
        return pageSkeleton(i, `AI call failed on the retry: ${e.message}`);
      }
      const p2 = problemsOf(second.sections);
      // #1034 —— 判决写在 lib/homepage-recipe.js 的 afterRetry() 里:'skeleton' = 块库两次都不合格（#1596 起发骨架页，以前是 fatal）;
      // 'revert' = 第一次块库干净、只因骨架撞车（或第二语言对不上）才重试，而重试把块库改坏了 ⟹ 退回第一次。
      switch (afterRetry({ firstBlockProblems: p1.block.length, retryBlockProblems: p2.block.length })) {
        case 'skeleton':
          return pageSkeleton(i, `this page's layout still breaks the block library after a retry:\n  ${p2.block.join('\n  ')}`);
        case 'revert':
          debug(`[fingerprint] ⚠️  ${where} 重试(块库本来干净)把块库改坏了 ${p2.block.length} 处,退回第一次那份:\n  ${p2.block.join('\n  ')}`);
          return finish(first.sections, [second, first]);
        default:
          if (p2.skin.length) debug(`[fingerprint] ⚠️  ${where} 重试之后首页开场仍跟配方对不上,放行(不因为这个建不出站):\n  ${p2.skin.join('\n  ')}`);
          debug(`[pages] ${where} 重试之后块库检查通过`);
          return finish(second.sections, [second, first]);
      }
    };
    const pageSections = await runPool(N, PAGE_CONCURRENCY, onePage);
    ai.pages.forEach((p, i) => { p.sections = pageSections[i]; delete p.brief; });
    // #1601 —— 每块的预设由配方定：写进 options 的旋钮（覆盖 AI 写的同名旋钮）。在 pages 存档点之前写 ⟹ 存档里的块已带着预设。
    if (recipeNav) {
      const manifests = loadBlockManifests();
      const n = ai.pages.reduce((sum, p) => sum + (recipeBlocksOf.has(p) ? siteRecipe.applyPresets(p.sections, recipeBlocksOf.get(p), manifests) : 0), 0);
      debug(`[recipe] 按配方写了 ${n} 个块的预设`);
    }
    // 每页那几通若仍写了收之前的长 id（链接 / under），套同一份 renames（#1565 的「页面里指着旧 id 的地方一起改」）。
    kwPages.renameServiceIds(idRenames, { pages: ai.pages });

    // ── 全站那一条（#999 第 ④ 条「整个站里没有 X」）：只有全部页都回来才问得了 ──────────────────────────────
    //    每页自己的毛病上面已经一页一页清掉了，这里剩下的只会是全站那一条。它交给首页那一通补一次（行业必需的块放首页最自然）；
    //    补完仍缺 ⟹ 原样发 + 每个缺的块一笔降级（#1596 第 7 条；以前是建站失败）。不再重试（同 #999：再重试等于把「AI 今天不听话」变成看不见的账单）。
    {
      const whole = validateBlocks({ pages: ai.pages, industry, disabledBlocks, forms });
      // #1013 洞 1 —— 行业是自由文本，认不出来的写法一定存在；认不出来时这条检查的射程要说出来。
      for (const w of whole.warnings) debug(`[blocks] ⚠️  ${w}`);
      debug(`[blocks] 行业 "${industry}" 认出来是: ${whole.industryKeys.join(' / ') || '（一个都没认出来）'}`);
      if (whole.problems.length) {
        // #1596 r5 —— 骨架页（§pageSkeleton，`seo.placeholder: true`）不交给 AI 补：补过的块会顶掉骨架、placeholder 却留着 ⟹
        //    seoPass 跳过一页真 AI 内容，降级记录还说它是骨架页。首页是骨架 ⟹ 换第一张不是骨架的页补；全是骨架 ⟹ 不调 AI，按「补不上」记降级。
        const isSkeleton = (p) => !!(p.seo && p.seo.placeholder === true);
        const hi = ai.pages.findIndex((p) => p.slug === 'home' && !isSkeleton(p));
        const fixAt = hi >= 0 ? hi : ai.pages.findIndex((p) => !isSkeleton(p));
        const target = fixAt >= 0 ? ai.pages[fixAt] : null;
        debug(target
          ? `[blocks] 全部页回来之后整站还有 ${whole.problems.length} 处不合规，让第 ${fixAt + 1} 页（${target.slug}）补一次:\n  ${whole.problems.join('\n  ')}`
          : `[blocks] 全部页回来之后整站还有 ${whole.problems.length} 处不合规，而每一页都是骨架页 ⟹ 不补:\n  ${whole.problems.join('\n  ')}`);
        progress('Checking the layout against the block library...', 40);
        let fixed = null;
        let fixedOthers = {};
        if (target) try {
          // #1593 —— 有第二语言时这一页的回包是按语言分组的（提示词 prompts[fixAt] 里写着），重查这一通照样要全部语言回来。
          const echo = otherCodes.length
            ? { [locales.primary.code]: { sections: target.sections }, ...Object.fromEntries(otherCodes.map((loc) => {
              const b = book.build(target, loc) || {};
              return [loc, { title: b.title, description: b.description, navLabel: b.navLabel, ...(b.seo && b.seo.targetKeyword ? { targetKeyword: b.seo.targetKeyword } : {}), sections: b.sections }];
            })) }
            : { sections: target.sections };
          const retry = await callAIWithRetry({
            client,
            baseOptions: {
              model,
              max_tokens: maxTokens,
              messages: [
                { role: 'user', content: prompts[fixAt] },
                { role: 'assistant', content: JSON.stringify(echo) },
                { role: 'user', content: `The website as a whole breaks the block library rules below. Add what is missing to THIS page and `
                  + (otherCodes.length
                    ? `respond AGAIN with the COMPLETE JSON for this page (the same object keyed by language code, no markdown fences):\n`
                    : `respond AGAIN with the COMPLETE JSON for this page ({"sections": [ ... ]}, no markdown fences):\n`)
                  + whole.problems.map((x) => `- ${x}`).join('\n') },
              ],
            },
            costContext: { operation: 'create-site', detail: `Page ${target.slug} (site re-check)`, pricing, durationStart: Date.now() },
            label: `Call 1 page ${target.slug} site re-check`,
          });
          const split = localesLib.splitLocaleReply(retry.parsed, locales.primary.code, otherCodes);
          fixed = sectionsOf(split.primary);
          fixedOthers = split.others;
        } catch (e) {
          debug(`[blocks] 补的那一通调不通：${e.message}`);
        }
        // 用补过的那组块：#1593 —— 这一页换了一组新块，第二语言那几份按新块重新挂；对不上 ⟹ 放弃那个第二语言（这一页没有可用的第二语言版本）。
        const useFixed = () => {
          target.sections = fixed;
          for (const loc of otherCodes) {
            if (book.failed.has(loc)) continue;
            const kw = typeof pageKeywords[target.slug] === 'string' ? pageKeywords[target.slug] : '';
            const p = localesLib.secondaryPageProblems({ page: target, sections: fixed, group: fixedOthers[loc], needKeyword: !!kw });
            if (p.length) {
              book.fail(loc, `page "${target.slug}" (site re-check): ${p.join('; ')}`);
              debug(`[locales] 整站补块那一通的 ${loc} 那一份对不上主语言（${p.join('; ')}）⟹ 放弃整个第二语言 ${loc}，主语言照常`);
            } else {
              book.link(target, fixed, loc, fixedOthers[loc]);
            }
          }
        };
        const trial = ai.pages.map((p, i) => (i === fixAt && fixed ? { ...p, sections: fixed } : p));
        const after = validateBlocks({ pages: trial, industry, disabledBlocks, forms }).problems;
        if (!fixed || after.length) {
          // #1596 第 7 条 —— 补不上：不补块（代码不往站里塞一块占位），原样发，每个仍缺的块记一笔降级（target = 块名）。
          //    补的那一通若把这一页改出了新的逐块问题，丢掉补的那份、用补之前的这一页；没改坏就用补过的那份。
          if (fixed) {
            const editProblems = (pg) => validateBlocks({ pages: [pg], industry, disabledBlocks, forms, scope: 'edit' }).problems;
            const before = new Set(editProblems(target));
            const added = editProblems({ ...target, sections: fixed }).filter((x) => !before.has(x));
            if (added.length) debug(`[blocks] 补的那一通把 ${target.slug} 改出 ${added.length} 处逐块问题，丢掉、用补之前那一页:\n  ${added.join('\n  ')}`);
            else useFixed();
          }
          const left = validateBlocks({ pages: ai.pages, industry, disabledBlocks, forms }).problems;
          const missing = fallbackSite.missingBlockTypes(left.length ? left : whole.problems);
          for (const t of missing.length ? missing : ['site']) { // 取不出块名也至少记一笔，不静默放过
            degrade('site-blocks', t, `The generated layout still breaks the block library after a retry: ${(left.length ? left : whole.problems).join(' · ')} —— 原样发，不补块`);
          }
        } else {
          useFixed();
          if (target.slug === 'home' && homeRecipe) {
            const skin = recipeProblems(ai.pages, homeRecipe);
            if (skin.length) debug(`[fingerprint] ⚠️  补过之后首页开场跟配方对不上,放行:\n  ${skin.join('\n  ')}`);
          }
          debug('[blocks] 补过之后块库检查全部通过');
        }
      }
      // 没写 role 的块按 manifest 的 roleDefault 补上（D4 的兜底那一半;上面那条只拦"写了但降级"）。
      const filled = applyBlockRoleDefaults(ai.pages);
      debug(`[blocks] 校验通过;按 roleDefault 补了 ${filled} 个 role`);
    }
    checkpoint('pages', { ai, brandByCode, recipe: recipeSnapshot() });
  }
  // #1599 ② —— 每页都写好了（两次都没写成的那页是骨架页，留有 `degraded` 记录）：这一版构建好就发 preview-viewable。
  //    images 已存档 ⟹ 本函数根本不会被调（main 直接用存档里的 content），所以这里不用判 resumeFrom >= 2。
  onPhaseDone('pages', previewContent(ai.pages));

  progress('Parsing AI response...', 42);

  progress('Assembling configuration...', 45);

  const brand = assembleBrand(debug);

  // #1489 —— 地址 → 坐标，查一次存进站点数据（contact 的地图点开时要 bbox / marker）。页面打开时不查；
  //    查不到 / 网络错 ⟹ 不写 geo、地图不渲染，建站照常（geocodeBrand 不抛）。只查坐标，瓦片一张都不取（OSM 瓦片条款禁预取）。
  const geoResult = await geocodeBrand(brand, { log: debug });
  debug(`Geocode brand.locations[0]: ${geoResult}`);

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
  // Faces allowed per TICKET-164 user decision. Hard cap photoHardCap (#1594: 30; ≤ 3 new per page, gallery reuses service-page images).
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
    recordImageCounts(result);
  }

  // TICKET-172 (hotfix): scrub AI-invented placeholder strings (e.g. "gradient-about")
  // from imageUrl fields that didn't get backfilled with a real Nano Banana URL.
  // Without this, broken <img src="gradient-about"> renders for capped/failed slots.
  const droppedPlaceholders = sanitizeImageUrls(ai.pages);
  if (droppedPlaceholders > 0) {
    debug(`[sanitize-image-urls] dropped ${droppedPlaceholders} invalid imageUrl placeholder(s) — template will render gradient fallback`);
  }

  const { navigation, seo } = assembleNavSeo(ai.pages, debug);

  return { brand, navigation, seo, services: ai.services, pages: ai.pages, ai };
}

// ─── AI Keyword Page Generation (Call 2) ─────────────────────────────────────

// #1550 —— 同时在飞的关键词页调用数。一页一次调用，提示词只带这一页的素材；并发只为省时间，不影响结果。
// #1568 —— Call 1 的每一页用同一个数、同一个调度（§runPool）。
// #1593 —— 3 → 5（19 页排队 6.5 分钟）。撞上 Anthropic 速率限制时由 callAIWithRetry 按 429 退避，不另做节流。
const PAGE_CONCURRENCY = 5;
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
    // #1549 重开 —— meta description 的长度说法（§description-fit.js descriptionSpec，按主语言）。默认值也从那里取，不另写数字。
    descriptionSpec: descSpec = descriptionSpec('en'),
    // #1601 —— 站的行动按钮落点（navigation.header.cta.href），关键词页的 CTA 指它（§keywordPagePrompt）。
    ctaHref = '',
    // #1346 —— 后台关掉的块。关键词页有它**自己**那份写死的块清单（`keyword-page-options.js`），关掉的块要从那里剔掉。
    disabledBlocks = [],
    // #1593 —— 第二语言一次写完（同 generateContent 那两个参数）。没传 / 没有第二语言 ⟹ 提示词与回包跟改之前一样。
    locales = { primary: { code: 'en', name: languageName }, others: [] },
    book = null,
  } = opts;
  const others = (locales.others || []).filter((o) => book && !book.failed.has(o.code));
  const otherCodes = others.map((o) => o.code);
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
      additionalContext, sectionOptions, sitePrimaryKeyword, titleSpec, descriptionSpec: descSpec, ctaHref,
    }) + (others.length ? `\n\n${localesLib.languagesPrompt({ primary: locales.primary, others, kind: 'keyword', hasKeyword: true })}` : '');
    emit('prompt', { name: `Keyword page: ${entry.keyword}`, content: prompt });
    // #1593 —— 有第二语言时回包按语言分组：主语言那一份是整页对象（跟改之前一样判），第二语言那几份等主语言定下来再挂进 book。
    const call = async (messages, detail) => {
      const raw = (await callAIWithRetry({
        client,
        baseOptions: { model, max_tokens: maxTokens, messages },
        costContext: { operation: 'create-site', detail, pricing, durationStart: Date.now() },
        label: `Call 2 ${entry.path}`,
      })).parsed;
      const split = localesLib.splitLocaleReply(raw, locales.primary.code, otherCodes);
      return { raw, page: split.primary, others: split.others };
    };
    const secondaryOf = (got) => {
      const out = {};
      if (!got.page || typeof got.page !== 'object') return out;
      for (const loc of otherCodes) {
        if (book.failed.has(loc)) continue;
        const p = localesLib.secondaryPageProblems({ page: got.page, sections: got.page.sections, group: got.others[loc], needKeyword: true });
        if (p.length) out[loc] = p;
      }
      return out;
    };
    const secondaryLines = (bad) => Object.entries(bad).map(([loc, p]) => `the "${loc}" part does not match the "${locales.primary.code}" part: ${p.join('; ')}`);

    let got;
    try {
      got = await call([{ role: 'user', content: prompt }], `Keyword page ${entry.path}`);
    } catch (e) {
      return { entry, ok: false, problems: [`AI 调用失败：${e.message}`] };
    }
    const problems = kwPages.keywordPageProblems(got.page, entry, validate);
    const bad = problems.length ? {} : secondaryOf(got);
    const candidates = [got];
    if (problems.length || Object.keys(bad).length) {
      const all = [...problems, ...secondaryLines(bad)];
      debug(`[keyword-pages] ${entry.path} 第一次不合格（${all.length} 处），只重试这一页：\n  ${all.join('\n  ')}`);
      let retried;
      try {
        retried = await call([
          { role: 'user', content: prompt },
          { role: 'assistant', content: JSON.stringify(got.raw) },
          { role: 'user', content: kwPages.keywordPageRetryMessage(all) },
        ], `Keyword page ${entry.path} (re-check)`);
      } catch (e) {
        if (problems.length) return { entry, ok: false, problems: [`重试时 AI 调用失败：${e.message}`] };
        retried = null; // 主语言第一次就合格、只为第二语言重试 ⟹ 用第一次那份主语言
      }
      if (retried) {
        const again = kwPages.keywordPageProblems(retried.page, entry, validate);
        if (!again.length) { got = retried; candidates.unshift(retried); } else if (problems.length) return { entry, ok: false, problems: again };
      }
    }
    const page = got.page;
    page.keywordPage = true;
    applyBlockRoleDefaults([page]);
    for (const loc of otherCodes) {
      if (book.failed.has(loc)) continue;
      let why = 'missing';
      const hit = candidates.find((c) => {
        const p = localesLib.secondaryPageProblems({ page, sections: page.sections, group: c.others[loc], needKeyword: true });
        if (p.length) why = p.join('; ');
        return !p.length;
      });
      if (hit) book.link(page, page.sections, loc, hit.others[loc]);
      else {
        book.fail(loc, `keyword page "${entry.path}": ${why}`);
        debug(`[locales] 关键词页 ${entry.path} 的 ${loc} 那一份重试后仍对不上主语言（${why}）⟹ 放弃整个第二语言 ${loc}，主语言照常`);
      }
    }
    return { entry, ok: true, page };
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
 *      代码补出来的详情页**单独再过一次 seoPass**（同样的八条、修补一次、仍不合格照发 + 一笔降级 —— 跟 AI 写的服务页同一个待遇）。
 *      放在主 seoPass 之后补，是为了不让「下面一页都没留下」的服务因为一张本该撤掉的页多出一页、多记降级。
 *      #1596 第 8–9 条：补不出来 / 补出来的块不合格 ⟹ 丢掉那个服务下的关键词页 + 一笔降级（以前是建站失败）。
 *   ④ 再跑一次 §ensureServiceDetailPages 只为把列表那一组指回 `under = services/<id>`：seoPass 重写过的详情页，回来的那一份里
 *      这一组不一定还对。这一次不该再补出页来（详情页是非关键词页，seoPass 不丢它），补出来了就是逻辑出错 ⟹ #1596 第 10 条：拿掉它、丢掉那个服务下的关键词页 + 一笔降级（以前是建站失败）。
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
  let kept = kwOk.filter((r) => !goneSlugs.has(r.entry.path) && current.has(r.entry.path));
  kwReport.ok = kept.length;
  const keptServiceIds = [...new Set(kept.map((r) => r.entry.serviceId))];

  // #1596 第 8–10 条 —— 关键词页的父页（服务详情页）出了问题：丢掉那几个服务下的关键词页，每个服务记一笔降级
  //    （reason 里写「关键词页 N/M」）。以前这三处各是一句 fatal。代码补的服务下面一页都没留下就撤掉，父页上那组空列表拿掉（同 ②）。
  const dropKeywordPagesUnder = (ids, step, why) => {
    const gone = new Set(ids);
    const lost = kept.filter((r) => gone.has(r.entry.serviceId));
    const lostSlugs = new Set(lost.map((r) => r.entry.path));
    content.pages = content.pages.filter((p) => !lostSlugs.has(p.slug));
    for (const r of lost) kwReport.failed.push({ keyword: r.entry.keyword, slug: r.entry.path, problems: [why] });
    kept = kept.filter((r) => !gone.has(r.entry.serviceId));
    kwReport.ok = kept.length;
    for (const id of ids) {
      if (kwReport.addedServices.some((a) => a.id === id)) {
        content.services = content.services.filter((x) => x.id !== id);
        kwReport.addedServices = kwReport.addedServices.filter((a) => a.id !== id);
      }
      kwPages.removePagesListBlocks(content.pages.find((p) => p.slug === `services/${id}`), id);
      degrade(step, `services/${id}`, `${why} —— 丢掉这个服务下的关键词页（关键词页 ${kwReport.ok}/${kwReport.total}）`);
    }
  };

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
    dropKeywordPagesUnder(detail.failed, 'keyword-parent', `关键词页的父页面补不出来：服务 ${detail.failed.join(', ')} 在服务目录里没有（或没有名字），/services/<id> 会是 404`);
  }
  if (detail.patched.length) debug(`[keyword-pages] 详情页上「下面的关键词页」那组由代码填（under = services/<id>）：${detail.patched.join(', ')}`);
  const assignment = assign();
  content.seo.targetKeywords = assignment.targetKeywords;
  if (detail.added.length) {
    debug(`[keyword-pages] AI 没给这些服务生成详情页，代码补上了：${detail.added.map((id) => `/services/${id}`).join(', ')}`);
    const addedSlugs = new Set(detail.added.map((id) => `services/${id}`));
    let fresh = content.pages.filter((p) => addedSlugs.has(p.slug));
    const issues = validateBlocks({ pages: fresh, industry, disabledBlocks, forms: siteFormsFrom(content.ai && content.ai.forms, undefined, locale), scope: 'edit' }).problems;
    if (issues.length) {
      // 过不了的那几张详情页拿掉，它们服务下的关键词页一起丢（父页不在就是 404）。问题归不到哪一页时当作全部不合格。
      let bad = fresh.filter((p) => issues.some((x) => x.startsWith(`${p.slug} `)));
      if (!bad.length) bad = fresh;
      const badSlugs = new Set(bad.map((p) => p.slug));
      content.pages = content.pages.filter((p) => !badSlugs.has(p.slug));
      fresh = fresh.filter((p) => !badSlugs.has(p.slug));
      dropKeywordPagesUnder(bad.map((p) => p.slug.replace(/^services\//, '')), 'keyword-parent-blocks', `代码补出来的服务详情页过不了块库检查：${issues.join(' · ')}`);
    }
    targetKw.applyPageKeywords(fresh, assignment.pageKeywords);
    for (const pg of fresh) {
      if (ensureH2Slots(pg, content.services.find((x) => x.id === pg.parentService), disabledBlocks)) debug(`[keyword-pages] ${pg.slug} 只有 1 个 H2 槽 ⟹ 补一个 content 块给 SEO 修补写标题（#1593）`);
    }
    writeImageAlts({ pages: fresh, manifests: loadBlockManifests(), industry, targetKeywordOf: seoTargetOf });
    // 只把这几页交给 seoPass（第 5 条「站内唯一」用的整站页表在这里就是这几页：代码只在 slug 空着时才补，不会撞）。
    const sub = { ...content, pages: fresh };
    buildReportLib.recordSeo(buildReport, await seoPass({ content: sub, payload, locale, industry, location, companyName, disabledBlocks }));
    for (const pg of sub.pages) {
      const i = content.pages.findIndex((p) => p.slug === pg.slug);
      if (i >= 0) content.pages[i] = pg;
    }
  }

  // ④
  const again = kwPages.ensureServiceDetailPages({ pages: content.pages, services: content.services, serviceIds: [...new Set(kept.map((r) => r.entry.serviceId))], locale, disabledBlocks });
  if (again.added.length || again.failed.length) {
    // 这一次补回来的详情页没过 SEO 检查 ⟹ 也拿掉，回到 seoPass 之后的样子；它们服务下的关键词页丢掉。
    const reAdded = new Set(again.added.map((id) => `services/${id}`));
    content.pages = content.pages.filter((p) => !reAdded.has(p.slug));
    const ids = [...again.added, ...again.failed];
    dropKeywordPagesUnder(ids, 'keyword-parent-after-seo', `seoPass 之后服务详情页不见了：${ids.map((id) => `/services/${id}`).join(', ')}`);
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
  buildReportLib.recordKeywordPages(buildReport, kwReport);
  return kwReport;
}

// ─── #1549 / #1593: 每页生成后的 SEO 检查 + 字段级修补 ─────────────────────────────────────────────────────
//
// 设计文档 S2 / #1549 正文做什么 3，#1593 做什么 2 改了「有问题怎么办」：
//   · 主语言的**每一页**跑一次 `seoProblems`（lib/seo-problems.js），日志每页一行 —— 全过的页在产物里跟没跑过一模一样，
//     所以「跑过」的证据只能是日志。第二语言（#1593）在写盘前按它自己的 locale 也跑一次（§main 第二语言那一段）。
//   · 代码能补的先由代码补，再查：长度（§fitPageDescriptions 裁）、缺地点（§appendPlace 补，#1549 做的，#1593 把它挪到检查之前）。
//   · 仍有问题 ⟹ **字段级修补**一次：一次小调用只带出问题的那几个字段和它们的约束（不带整页），只回那几个字段，代码写回页面。
//     以前是整页重写（一条「description 缺目标词」要把 3–4k token 的整页重生成一次，$0.08；现在 ~300 token，$0.01）。
//     没有字段可改的问题（第 3 条 H1 个数、第 5 条 slug）不发修补调用，直接按「修补后仍不合格」处置。
//     修补回来的字若让这一页新增块库问题（比如超了某个块的字数上限），这次修补作废、用原来的字。
//   · 主语言修补一次仍不合格 ⟹ 关键词页丢掉（日志「丢掉 <slug>：…」+「关键词页 N/M」，页脚里指向它的链接一起删）；
//     首页 / 服务页 / 没有目标词的页 ⟹ 页面照发、每页记一笔降级（#1596 第 11 条；以前是建站失败），信息写明哪页哪条。
//     没有目标词的页不丢：它们在导航里，丢了就是站内死链。
//   · 第二语言修补一次仍不合格 ⟹ 记日志、照常发布，不丢页、不让建站失败（第二语言从不拦主语言）。
//   · #1596 —— 骨架页（`seo.placeholder: true`，§pageSkeleton）不进检查：修补占位文案只是多花一次 AI，它已经有自己那一笔降级。
//   · 「关键词页 N/M」只进日志和 `seo-check` 事件（只有主语言发）。建站页显示的是 #1550 的 `keyword-pages` 事件。

/** 一页的目标词（T4 #1548 挂在 `page.seo.targetKeyword`）。 */
function seoTargetOf(page) {
  return page && page.seo && typeof page.seo.targetKeyword === 'string' ? page.seo.targetKeyword : '';
}

/**
 * #1593 —— 代码补出来的服务详情页（§kwPages.ensureServiceDetailPages）有目标词时，第 7 条要 2 个 H2；服务没写全文（代码补的服务
 * 就是这样）的话它只有「相关页面」那一个 H2 槽，字段级修补无字可改（以前整页重写会顺手加块）。补一个 content 块（标题 = 服务名、
 * 正文 = 服务简介，没有就是服务名）给修补留出槽，由修补把目标词写进去。第二语言拼同一页时也跑它 ⟹ 两种语言的块一样。
 */
function ensureH2Slots(page, svc, disabledBlocks = []) {
  if (!page || !svc || !seoTargetOf(page) || new Set(disabledBlocks).has('content')) return false;
  const sections = Array.isArray(page.sections) ? page.sections : (page.sections = []);
  if (sections.filter((x) => x && SEO_H2_BLOCKS.has(x.type)).length >= 2) return false;
  const name = typeof svc.name === 'string' ? svc.name.trim() : '';
  const body = [svc.fullDescription, svc.shortDescription, name].find((x) => typeof x === 'string' && x.trim());
  if (!name || !body) return false;
  const h1 = sections.findIndex((x) => x && SEO_H1_BLOCKS.has(x.type));
  sections.splice(h1 + 1, 0, { type: 'content', data: { headline: name, body: body.trim() } });
  return true;
}

/** 一页的 seoProblems + 日志一行（`[seo] 检查 <slug> · …`）。 */
function seoCheckPage({ page, content, payload, locale, tag = '检查', who = '[seo]' }) {
  const kw = seoTargetOf(page);
  const problems = seoProblems({ page, pages: content.pages, targetKeyword: kw, brand: content.brand, payload, locale, seo: content.seo });
  debug(`${who} ${tag} ${page.slug} · 目标词 ${kw ? `「${kw}」` : '（无）'} · 跑了第 ${seoRulesFor(kw).join('/')} 条 · `
    + (problems.length ? `${problems.length} 条问题：\n    ${problems.join('\n    ')}` : '0 条问题'));
  // #1603 —— 地点那一半不判时要响：每页只在第一遍检查时说一次（seoProblems 是纯函数，不打日志）。
  const place = sitePlace(payload);
  if (tag === '检查' && kw && place && !placeFits(place, kw, locale)) {
    debug(`${who} 不补地点 ${page.slug}：目标词「${kw}」${[...kw].length} 字 + 分隔符 + 地点「${place}」${[...place].length} 字 `
      + `已超过 description 底线上限 ${descriptionAccept(locale).max} 字 ⟹ 第 2 条「含地点」那一半不判、建站不拦`);
  }
  return problems;
}

/** 缺地点由代码补在 description 末尾（#1549 重开；#1603 补的时候不裁掉目标词）。补了回 true。 */
function seoAppendPlace({ page, content, payload, locale, when = '', who = '[seo]' }) {
  const kw = seoTargetOf(page);
  if (!missingPhrases({ page, targetKeyword: kw, payload, seo: content.seo, locale }).some((m) => m.what === 'place')) return false;
  const place = sitePlace(payload);
  const isHome = page.slug === 'home';
  const next = appendPlace(isHome ? content.seo.siteDescription : page.description, place, locale, { keep: (s) => hasPhrase(s, kw) });
  if (isHome) content.seo.siteDescription = next; else page.description = next;
  debug(`${who} ${when}补地点 ${page.slug}：「${place}」→ ${[...next].length} 字（代码补，不叫 AI）`);
  return true;
}

/**
 * 一页里给访客读的字段，按 seoProblems 的 pageText 同一个顺序（每块先 headline 再其余）：{ id, sec, get(), set(v) }。
 * 非文字字段（旋钮、链接、图址、图标 …）跳过，同 seo-problems.js 的 NOT_TEXT。
 */
function seoTextFields(page) {
  const out = [];
  const walk = (holder, key, id, sec) => {
    const v = holder[key];
    if (typeof v === 'string') { if (v.trim()) out.push({ id, sec, get: () => holder[key], set: (x) => { holder[key] = x; } }); return; }
    if (Array.isArray(v)) { v.forEach((_, i) => walk(v, i, `${id}[${i}]`, sec)); return; }
    if (v && typeof v === 'object') for (const k of Object.keys(v)) if (!SEO_NOT_TEXT.has(k)) walk(v, k, `${id}.${k}`, sec);
  };
  (Array.isArray(page.sections) ? page.sections : []).forEach((s, i) => {
    if (!s || !s.data || typeof s.data !== 'object') return;
    if (typeof s.data.headline === 'string') walk(s.data, 'headline', `sections[${i}].${s.type}.headline`, i);
    for (const k of Object.keys(s.data)) if (k !== 'headline' && !SEO_NOT_TEXT.has(k)) walk(s.data, k, `sections[${i}].${s.type}.${k}`, i);
  });
  return out;
}

/**
 * 这一页要修补的字段（#1593）。按问题的规则号认（问题文案恒以 `[N 名字]` 开头）：
 *   1 → title（首页是 seo.siteTitle）· 2 → description（首页是 seo.siteDescription）· 3 H1 缺目标词 → H1 那一句 ·
 *   4 → 页面前 100 词落在的那几个字段 · 6 → 内容图的 alt · 7 → 各块的 H2 · 8 → 写着那个编造事实的字段。
 *   第 3 条 H1 个数、第 5 条 slug：没有字段可改 ⟹ 不进来。
 * @returns {{ name: string, get: Function, set: Function, rules: string[] }[]}
 */
function seoFixFields({ page, problems, content }) {
  const isHome = page.slug === 'home';
  const byId = new Map();
  const add = (id, name, get, set, rule) => {
    if (!byId.has(id)) byId.set(id, { name, get, set, rules: [] });
    const f = byId.get(id);
    if (!f.rules.includes(rule)) f.rules.push(rule);
  };
  const titleField = (rule = 'title') => (isHome
    ? add('seo.siteTitle', 'siteTitle', () => content.seo.siteTitle, (v) => { content.seo.siteTitle = v; }, rule)
    : add('title', 'title', () => page.title, (v) => { page.title = v; }, rule));
  const descField = (rule = 'description') => (isHome
    ? add('seo.siteDescription', 'siteDescription', () => content.seo.siteDescription, (v) => { content.seo.siteDescription = v; }, rule)
    : add('description', 'description', () => page.description, (v) => { page.description = v; }, rule));
  const text = seoTextFields(page);
  const sections = Array.isArray(page.sections) ? page.sections : [];
  // 一块的标题那一格：有字的取 seoTextFields 那一项；**空着的也算一格**（content 块没写 headline 时不出 H2，填上就出）——
  // 往空格里写字不改页面结构，所以「H2 只有 1 个」（代码补出来的服务详情页就是这样：content 块只有正文）也能字段级修。
  const sectionHeadline = (i, sec) => text.find((f) => f.sec === i && f.id === `sections[${i}].${sec.type}.headline`)
    || (sec && sec.data && typeof sec.data === 'object'
      ? { id: `sections[${i}].${sec.type}.headline`, sec: i, get: () => sec.data.headline || '', set: (v) => { sec.data.headline = v; } }
      : null);
  for (const p of problems) {
    const rule = Number((/^\[(\d)/.exec(p) || [])[1]);
    if (rule === 1) titleField();
    else if (rule === 2) descField();
    else if (rule === 3) {
      // 缺目标词 ⟹ 改那一句；一个 H1 都没有、而恰好有一个 hero / page-header 的标题空着 ⟹ 填它。两个以上 H1 没有字段可改。
      const h1Blocks = sections.map((s, i) => [s, i]).filter(([s]) => s && SEO_H1_BLOCKS.has(s.type));
      const withText = h1Blocks.filter(([s]) => s.data && typeof s.data.headline === 'string' && s.data.headline.trim());
      const target = /恰好一个 H1/.test(p) ? (withText.length === 0 && h1Blocks.length === 1 ? h1Blocks[0] : null) : withText[0];
      const f = target && sectionHeadline(target[1], target[0]);
      if (f) add(f.id, 'h1', f.get, f.set, 'h1');
    } else if (rule === 4) {
      let n = 0;
      for (const f of text) {
        if (n >= 100) break;
        add(f.id, f.id, f.get, f.set, 'intro');
        n += seoWords(f.get()).length;
      }
    } else if (rule === 6) {
      for (const x of contentImagesOf(page)) add(`alt:${x.secIdx}:${x.slot}:${x.itemIdx}`, `${x.type} image alt (block ${x.secIdx + 1}${x.itemIdx === null ? '' : `, item ${x.itemIdx + 1}`})`,
        () => x.img.alt || '', (v) => { x.img.alt = v; }, /alt 为空/.test(p) && !x.alt ? 'alt-empty' : 'alt');
    } else if (rule === 7) {
      sections.forEach((s, i) => {
        if (!s || !SEO_H2_BLOCKS.has(s.type)) return;
        const f = sectionHeadline(i, s);
        if (f) add(f.id, f.id, f.get, f.set, 'h2');
      });
    } else if (rule === 8) {
      const what = (/编造的事实：「([^」]+)」/.exec(p) || [])[1];
      if (!what) continue;
      if (String((isHome ? content.seo.siteTitle : page.title) || '').includes(what)) titleField('fact');
      if (String((isHome ? content.seo.siteDescription : page.description) || '').includes(what)) descField('fact');
      for (const f of text) if (f.get().includes(what)) add(f.id, f.id, f.get, f.set, 'fact');
    }
  }
  // 名字要唯一（回包按名字写回）：撞名时补序号。
  const seen = new Map();
  return [...byId.values()].map((f) => {
    const k = seen.get(f.name) || 0;
    seen.set(f.name, k + 1);
    return k ? { ...f, name: `${f.name} #${k + 1}` } : f;
  });
}

/** 修补那一次的提示词（单测读它：只带出问题的字段、它们的约束、问题清单；不带这一页别的字）。 */
function seoFixPrompt({ page, problems, fields, content, payload, locale, industry, location, companyName }) {
  const kw = seoTargetOf(page);
  const isHome = page.slug === 'home';
  const musts = missingPhrases({ page, targetKeyword: kw, payload, seo: content.seo, locale })
    .map((m) => ({ ...m, name: m.field === 'title' ? (isHome ? 'siteTitle' : 'title') : (isHome ? 'siteDescription' : 'description') }))
    .filter((m) => fields.some((f) => f.name === m.name))
    .map((m) => `- MUST: "${m.name}" contains "${m.phrase}" exactly as written${m.what === 'place' ? ' (the place name, in this spelling)' : ''}.`);
  const rules = [];
  const has = (r) => fields.filter((f) => f.rules.includes(r)).map((f) => `"${f.name}"`);
  if (has('title').length) rules.push(`- ${has('title').join(', ')}: ${isHome ? 'the home page\'s <title>, used as-is: max 60 chars' : pageTitleSpec(content.brand.name[locale])}${kw ? `, containing "${kw}"` : ''}.`);
  if (has('description').length) rules.push(`- ${has('description').join(', ')}: meta description, ${descriptionSpec(locale)}${kw ? `, containing "${kw}"` : ''}.`);
  if (has('h1').length) rules.push(`- ${has('h1').join(', ')}: the page's single H1 — it contains "${kw}".`);
  if (has('intro').length) rules.push(`- The page's first 100 words are these texts, in this order: ${has('intro').join(', ')} — "${kw}" must appear in them.`);
  if (has('h2').length) rules.push(`- ${has('h2').join(', ')}: the headings of the page's sections (H2s; an empty one is a heading not written yet — write it) — at least 2 of them contain "${kw}" (or its words).`);
  if (has('alt').length || has('alt-empty').length) rules.push(`- ${[...has('alt'), ...has('alt-empty')].join(', ')}: image alt texts — one plain sentence each saying what the photo shows (no "image of")${kw ? `; at least one contains "${kw}"` : ''}.`);
  if (has('fact').length) rules.push(`- ${has('fact').join(', ')}: remove the invented fact — keep only what the business details below say.`);
  // #1593 做什么 4 —— 拉丁字母的目标词放在中日韩页上：「keep each text in its current language」跟「必须含目标词」打架时 AI 会整句换语言。
  if (kw && isCjkLocale(locale) && !SEO_CJK.test(kw)) {
    const lang = { zh: 'Chinese', ja: 'Japanese', ko: 'Korean' }[String(locale).slice(0, 2).toLowerCase()];
    rules.push(`- "${kw}" is not written in ${lang}, but this page is: embed "${kw}" verbatim inside a sentence that is still written in ${lang} (e.g. "Delivery 外卖配送"). Never rewrite a text into the keyword's language to fit it in.`);
  }
  const p = payload && typeof payload === 'object' ? payload : {};
  const facts = has('fact').length ? [
    ['USP', p.usp], ['Description', p.brandDescription], ['Address', p.address], ['Phone', p.phone], ['Hours', p.hours],
    ['Price range', p.priceRange],
    ['Customer reviews', Array.isArray(p.reviews) && p.reviews.length ? JSON.stringify(p.reviews) : ''],
  ].filter(([, v]) => typeof v === 'string' && v.trim()).map(([k, v]) => `- ${k}: ${v}`) : [];
  const current = Object.fromEntries(fields.map((f) => [f.name, f.get()]));
  return `You wrote texts on one page of the website for "${companyName}" (${industry}${location ? `, ${location}` : ''}). An automatic SEO check found the problems below. Rewrite ONLY the texts given here so the problems go away; keep each text in its current language and keep the brand name "${companyName}" verbatim. Respond with ONE JSON object {"fields": {"<name>": "<new text>", ...}} using exactly the names below — no markdown fences, no explanation.

PAGE: ${page.slug}${kw ? `\nThis page's target keyword is "${kw}".` : ''}

TEXTS TO FIX:
${JSON.stringify(current, null, 2)}

PROBLEMS TO FIX:
${problems.map((x) => `- ${x}`).join('\n')}
${musts.length ? `
HARD REQUIREMENTS (the check runs again on exactly these; a text that misses one fails):
${musts.join('\n')}
` : ''}
RULES:
${rules.join('\n')}
${facts.length ? `
BUSINESS DETAILS (the only source of facts):
${facts.join('\n')}
` : ''}`;
}

/** 调 AI 修补一页一次。回 `{ name: 新的字 }`（只含送出去的名字、且是非空字符串的）；调不通 / 吐不回对象就抛。 */
async function fixPageFieldsForSeo(args) {
  const prompt = seoFixPrompt(args);
  const tag = args.locale && args.secondary ? ` (${args.locale})` : '';
  emit('prompt', { name: `SEO fix ${args.page.slug}${tag}`, content: prompt });
  const client = new Anthropic();
  const result = await callAIWithRetry({
    client,
    baseOptions: { model, max_tokens: maxTokens, messages: [{ role: 'user', content: prompt }] },
    costContext: { operation: 'create-site', detail: `SEO fix ${args.page.slug}${tag}`, pricing, durationStart: Date.now() },
    label: `SEO fix ${args.page.slug}${tag}`,
  });
  const parsed = result.parsed;
  const got = parsed && typeof parsed === 'object' && parsed.fields && typeof parsed.fields === 'object' ? parsed.fields : parsed;
  if (!got || typeof got !== 'object' || Array.isArray(got)) throw new Error('修补回来的不是一个对象');
  const out = {};
  for (const f of args.fields) if (typeof got[f.name] === 'string' && got[f.name].trim()) out[f.name] = got[f.name].trim();
  return out;
}

/**
 * 每一页：代码补（长度 / 地点）→ 检查 → 有问题字段级修补一次 → 再补、再查 → 处置。就地改 `content`（页、seo、页脚）。
 * 从不让建站失败（#1596）：主语言修补一次仍不合格的关键词页丢掉，其余页照发并各记一笔降级；
 * `secondary: true`（第二语言）只记日志、不丢页、不发 seo-check 事件。骨架页（`seo.placeholder`）不查。
 * 回 `{ checked, rewritten, dropped, degradedPages, pages }`（单测读它）；`pages` 是逐页的首查 / 复查结果（#1600 建站报告读它）。
 * 🔴 `rewritten` 这个键名是 T8 #1600 的建站报告「修补页数 / 总页数」取数的地方（§lib/build-report.js recordSeo），#1593 起含义是
 *    「做了字段级修补的页数」，不再是「整页重写过的页数」；`pages[].rewritten` 同一个意思（这一页的字段被修补写回了）。
 *    第二语言那一次（`secondary: true`）的结果**不**记进报告：它的页跟主语言同 slug，recordSeo 按 slug 合并会盖掉主语言那几行。
 */
async function seoPass({ content, payload, locale, industry, location, companyName, disabledBlocks = [], keywordPagesPlanned = [], secondary = false }) {
  const who = secondary ? `[seo ${locale}]` : '[seo]';
  const ctx = { content, payload, locale, industry, location, companyName, who };
  // 代码一刀能裁 / 能补的先做掉，再查；留给 AI 的只剩代码改不了的（关键词不在 / 编造事实 / H1 H2 …）。
  for (const c of fitPageDescriptions({ pages: content.pages, seo: content.seo, locale })) {
    debug(`${who} 裁 description ${c.slug}：${c.before} → ${c.after} 字（代码裁，不叫 AI）`);
  }
  for (const page of content.pages) seoAppendPlace({ page, ...ctx });
  const failing = [];
  // #1600 —— 逐页结果（首查 / 复查）给建站报告：只记录，不参与下面任何判断。
  const perPage = new Map();
  for (const page of content.pages) {
    if (page.seo && page.seo.placeholder === true) {
      debug(`${who} 跳过 ${page.slug}：骨架页（占位文案，已记一笔降级）`);
      continue;
    }
    const problems = seoCheckPage({ page, ...ctx });
    const kw = seoTargetOf(page);
    perPage.set(page.slug, {
      slug: page.slug, targetKeyword: kw || null, rules: seoRulesFor(kw),
      first: problems, final: [], rewritten: false, outcome: problems.length ? 'fixed' : 'pass',
    });
    if (problems.length) failing.push({ page, problems });
  }

  // 表单跟 Call 1 那道块校验用同一份（AI 写的文案 + 默认骨架，`siteFormsFrom`）；只比这一页修补前后的差集。
  const forms = siteFormsFrom((content.ai && content.ai.forms) || content.forms, undefined, locale);
  const blockProblemsOf = (pages, slug) => validateBlocks({ pages, industry, disabledBlocks, forms })
    .problems.filter((x) => x.startsWith(`${slug} `));

  const fixes = await Promise.all(failing.map(async ({ page, problems }) => {
    const fields = seoFixFields({ page, problems, content });
    if (!fields.length) {
      debug(`${who} 不修补 ${page.slug}：这几条问题没有字段可改（${problems.map((x) => (/^\[[^\]]+\]/.exec(x) || [x])[0]).join(' ')}）`);
      return { page, fields, out: null };
    }
    try {
      return { page, fields, out: await fixPageFieldsForSeo({ page, problems, fields, ...ctx, secondary }) };
    } catch (e) {
      debug(`${who} 修补 ${page.slug} 没成：${e.message} —— 按原来那页处置`);
      return { page, fields, out: null };
    }
  }));

  const dropped = [];
  const degradedPages = [];
  const unresolved = [];
  let rewritten = 0;
  for (const { page, fields, out } of fixes) {
    let fixedThis = false;
    // #1593 做什么 4 —— 中日韩站：原值有 CJK 字、新值一个都没有 ⟹ 换了语言，这个字段不采用（保留原值，这一页照 #1596 降级）。
    const written = fields.filter((f) => out && Object.prototype.hasOwnProperty.call(out, f.name)).filter((f) => {
      if (!isCjkLocale(locale) || !SEO_CJK.test(String(f.get() || '')) || SEO_CJK.test(out[f.name])) return true;
      debug(`${who} 修补 ${page.slug}.${f.name} 换了语言，不采用`);
      return false;
    });
    if (written.length) {
      const before = new Set(blockProblemsOf(content.pages, page.slug));
      const old = written.map((f) => f.get());
      written.forEach((f) => f.set(out[f.name]));
      const added = blockProblemsOf(content.pages, page.slug).filter((x) => !before.has(x));
      if (added.length) {
        written.forEach((f, i) => f.set(old[i]));
        debug(`${who} 修补 ${page.slug}：回来的字把块库改坏了 ${added.length} 处，作废、用原来的字：\n    ${added.join('\n    ')}`);
      } else {
        rewritten += 1;
        fixedThis = true;
        debug(`${who} 修补 ${page.slug}：改了 ${written.map((f) => f.name).join(' · ')}（字段级，${written.length}/${fields.length}）`);
      }
    }
    for (const c of fitPageDescriptions({ pages: [page], seo: content.seo, locale })) {
      debug(`${who} 修补后裁 description ${c.slug}：${c.before} → ${c.after} 字`);
    }
    seoAppendPlace({ page, ...ctx, when: '修补后' });
    const after = seoCheckPage({ page, ...ctx, tag: '修补一次后' });
    const entry = perPage.get(page.slug);
    if (entry) { entry.final = after; entry.rewritten = fixedThis; }
    if (!after.length) continue;
    if (entry) entry.outcome = secondary ? 'unresolved' : page.keywordPage === true ? 'dropped' : 'fatal';
    if (secondary) {
      unresolved.push({ slug: page.slug, problems: after });
      debug(`${who} 修补一次后仍不合格，照常发布（第二语言不拦建站）${page.slug}：${after.join(' · ')}`);
    } else if (page.keywordPage === true) {
      dropped.push({ slug: page.slug, keyword: seoTargetOf(page), problems: after });
      debug(`[seo] 丢掉 ${page.slug}：${after.join(' · ')}`);
    } else {
      degradedPages.push({ slug: page.slug, problems: after });
    }
  }
  if (secondary) {
    debug(`${who} ${content.pages.length} 页 · 字段级修补 ${rewritten} 页 · 修补后仍不合格 ${unresolved.length} 页（照常发布）`);
    return { checked: content.pages.length, rewritten, dropped, degradedPages, unresolved, pages: [...perPage.values()] };
  }
  buildStats.addSeoFixed(rewritten);

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

  // #1596 第 11 条 —— 以前这里是整站失败；现在页面照发，每页记一笔（问题原样写进 reason）。
  for (const f of degradedPages) {
    degrade('seo', f.slug, `SEO check failed after one rewrite (#1549): ${f.problems.join(' · ')} —— 页面照发`);
  }
  return { checked: content.pages.length + dropped.length, rewritten, dropped, degradedPages, pages: [...perPage.values()] };
}

// ─── Run ──────────────────────────────────────────────────────────────────────

main().catch(err => {
  // #1596 —— 前面的路都降级之后，走到这里的只剩真正的程序错误（读输入 / 输入、主题、凭据校验 / git commit 与读回那次提交（#1598）那几处是有意留着的 fatal）。
  fatal(err.stack || err.message || String(err));
});
