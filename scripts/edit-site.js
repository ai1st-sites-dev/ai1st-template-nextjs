#!/usr/bin/env node

/**
 * edit-site.js — AI chat editing via Claude tool_use
 *
 * Reads JSON input from stdin (siteId, message, conversationHistory),
 * uses Claude tool_use to read/write site config files,
 * then syncs changes via sync-config.js for HMR preview refresh.
 *
 * Usage: echo '{"siteId":"a1b2c3d4","message":"Change hero title"}' | ANTHROPIC_API_KEY=xxx node scripts/edit-site.js
 */

const fs = require('fs');
const path = require('path');
const http = require('http');
const { execSync } = require('child_process');
const Anthropic = require('@anthropic-ai/sdk');
// #1013 洞 4 —— 块校验（#999）此前在这条路上一条都不跑：write_file 只看「是合法 JSON」就落盘。
// 跑的是**同一个函数**，不是第二份实现（#999 定的规矩，本票 AC6）。
const { validateSite: validateBlocks } = require('./lib/block-manifest');
// 页面的**形状**（哪个数组、每一格是什么）由 #998 那个模块说了算 —— 这里不写第二份，见
// pageJsonBlockError 上面那段。
const { readPageBlocks, normalizeLocalePages } = require('./blocks');

// ─── Emit structured events to stdout ─────────────────────────────────────────

const startTime = Date.now();

function elapsed() {
  return ((Date.now() - startTime) / 1000).toFixed(1) + 's';
}

function emit(event, data = {}) {
  const line = JSON.stringify({ event, elapsed: elapsed(), ...data });
  process.stdout.write(line + '\n');
}

function fatal(message) {
  emit('error', { message });
  process.exit(1);
}

// Suppress console.log/warn to avoid polluting stdout JSON lines
console.log = () => {};
console.warn = () => {};
const debug = (...args) => process.stderr.write(args.join(' ') + '\n');

// TICKET-105 v2: provider-agnostic image-error classifier.
// Returns a user-friendly string when the error looks like the AI provider
// rejected an image format, or null when it's some other error (network,
// auth, etc.) that should fall through to the existing error handler.
// TICKET-148: independent copy from create-site.js (PM § decision E — no shared
// module across scripts). Classify Anthropic SDK error as retryable.
function isRetryableApiError(err) {
  const retryableStatuses = [429, 500, 502, 503, 529];
  if (err && err.status && retryableStatuses.includes(err.status)) return true;
  if (err && err.error && err.error.type && /overloaded|rate_limit_error/.test(err.error.type)) return true;
  if (err && /overloaded|rate.?limit|too many requests/i.test(err.message || '')) return true;
  return false;
}

function classifyVisionError(err, images) {
  if (!images || images.length === 0) return null;

  const errMsg = (err?.message || (err && err.toString && err.toString()) || '').toLowerCase();
  const looksLikeImageError =
    errMsg.includes('image') &&
    (errMsg.includes('format') || errMsg.includes('unsupported') || errMsg.includes('invalid'));
  if (!looksLikeImageError) return null;

  // Heuristic list of formats commonly NOT supported by AI vision providers.
  // Used only to give the user a helpful "which file?" hint — we do not
  // hardcode this list as a filter, so a provider that adds support later
  // automatically benefits with zero code change.
  const suspectExts = /\.(svg|heic|avif|tiff?|raw|psd)$/i;
  const suspectFiles = images
    .filter(img => suspectExts.test(img.url || ''))
    .map(img => img.originalFilename || (img.url || '').split('/').pop());

  if (suspectFiles.length > 0) {
    return `The AI vision model can't read one of your uploaded image formats (${suspectFiles.join(', ')}). Please convert to PNG, JPG, or WEBP and try again. The original file is still saved in your library and can be referenced in your site.`;
  }
  return `The AI vision model couldn't process one of the uploaded images. Please try a different format (PNG, JPG, or WEBP). Original error: ${err?.message || 'unknown'}`;
}

// ─── Dev server health check ─────────────────────────────────────────────────

/**
 * HTTP GET the dev server root. Resolves with the status code, or 0 on error.
 */
function checkDevServer(port) {
  return new Promise(resolve => {
    const req = http.get(`http://localhost:${port}/`, res => {
      res.resume(); // drain
      resolve(res.statusCode);
    });
    req.on('error', () => resolve(0));
    req.setTimeout(1000, () => { req.destroy(); resolve(0); });
  });
}

/**
 * Poll the dev server until it responds with < 500 (or timeout).
 * Returns true if healthy, false if timed out.
 */
async function waitForDevServer(port, timeoutMs = 30000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const status = await checkDevServer(port);
    if (status > 0 && status < 500) return true;
    await new Promise(r => setTimeout(r, 2000));
  }
  return false;
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

// ─── Tool definitions ─────────────────────────────────────────────────────────

const tools = [
  {
    name: 'read_file',
    description: 'Read a site configuration file. Path is relative to the site directory (e.g. "brand.json", "pages/about.json").',
    input_schema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Relative file path within the site directory' },
      },
      required: ['path'],
    },
  },
  {
    name: 'write_file',
    description: 'Write a complete file to the site directory. Content must be valid JSON. The entire file content is replaced.',
    input_schema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Relative file path within the site directory' },
        content: { type: 'string', description: 'Complete file content (must be valid JSON)' },
      },
      required: ['path', 'content'],
    },
  },
  {
    name: 'list_files',
    description: 'List files in the site directory. Optionally specify a subdirectory.',
    input_schema: {
      type: 'object',
      properties: {
        directory: { type: 'string', description: 'Subdirectory to list (e.g. "pages"). Omit for root.' },
      },
      required: [],
    },
  },
];

// ─── Tool execution ───────────────────────────────────────────────────────────

function validatePath(relPath) {
  if (!relPath || typeof relPath !== 'string') return false;
  if (relPath.includes('..') || path.isAbsolute(relPath)) return false;
  return true;
}

// ─── #1013 洞 4：页面 JSON 落盘之前过一遍块校验 ────────────────────────────────────────────────
//
// 之前这条路只校验「是合法 JSON」，于是模型可以把 `items` 写成 `plans`、把 `benefits-list` 的
// `items` 写成 `benefits`，页面上那一块就此空着 —— 而聊天窗口说「改好了」、构建也是绿的。
// #1012 是它的实物：两个 prod 站上 4 块空白，其中一个站是 2026-08-07 建的。
//
// 🔴 返回 `{error}` 而不是退出。它成为一条 tool_result 回到模型手里，模型在同一轮对话里重写一遍
// （主循环最多 20 轮），磁盘上一个字节都没动过，用户那边也不会看到一次失败的编辑。这就是
// 「拦得住又修得回来」在这条路上的样子 —— 详见 block-manifest.js 里 `scope: 'edit'` 那段。
//
// 只管页面 JSON：`pages/` 底下的每一个 `.json`，多语言站是 `<locale>/pages/` 底下的。brand / seo /
// services 这些不由块 manifest 描述，一个字不碰。
//
// 🔴 语言那一段不写死成 `[a-z]{2}` 之类的形状：locale 目录名来自 site_meta.json，`zh_CN` / `zh-TW`
// 都出现过，而这里认不出路径的后果是**这次写入不被校验**（也就是回到本票要治的那个状态），
// 所以匹配的是「路径里有一段 pages/，文件是 .json」这件事，不是我以为 locale 长什么样。
//
// 🔴 `pages/` 底下**还有几层也算**，判据是构建期自己怎么读的：`sync-config.js:279` 的
// `readPagesRecursive` 递归读 `pages/`，任何一层的 `.json` 都是一个真页面（子目录名会拼进 slug）。
// 服务详情页就长这样 —— `create-site.js:2027` 生成的 slug 是 `services/{service-id}`，落盘就是
// `<locale>/pages/services/<id>.json`。r3 那版写的是 `[^/]+\.json`（只认一层），后果被 QA2 在真机上
// 量出来了：同一个块、同一个键、同一句话，改首页拦得住，改 `pages/services/engagement-sessions.json`
// 就 `{"success":true}` 落盘，跟着 `sync-config` rc=0、`npm run build` rc=0，产物里那一块标题在、
// 条目 0 条 —— 正是 #1012 那个形状。12 个真站仓 136 个页面里这类页面占 49 个（36%）。
const PAGE_JSON = /(?:^|\/)pages\/(?:[^/]+\/)*[^/]+\.json$/i;

// 一页里模型自己写下内容的那些块。`{ "ref": "<id>" }` 那种不算 —— 它的内容在
// `<locale>/blocks/site-blocks.json` 里，不在这次写入的这个文件里。拿它的内容来拒这次写入，
// 模型在这一轮里改不动，那个页面就再也编辑不了了。
function ownBlocksOf(page, where) {
  return readPageBlocks(page, where).blocks.filter((b) => !b || typeof b.ref !== 'string');
}

function pageJsonBlockError(relPath, parsed) {
  if (!PAGE_JSON.test(relPath)) return null;

  const locale = relPath.includes('/pages/') ? relPath.split('/pages/')[0] : '(site)';
  const where = `Locale "${locale}" page "${(parsed && parsed.slug) || path.basename(relPath, '.json')}"`;

  // ── 第一关：形状（哪个数组、每一格是什么）──────────────────────────────────────────────
  //
  // 🔴 判据不是「有没有 sections」，是「构建期收不收这份形状」——所以这里**调构建期自己那个函数**
  // （`blocks.js` 的 `normalizeLocalePages`，#998 的交付物），不写第二份规则。
  //
  // r2 那版在这里手写了一份 `pageShapeProblems`，里面写死了 `Array.isArray(page.sections)`。
  // 而 #998 之后 `create-site.js:1416/:1486` 落盘走的是 `pageWithBlocks()`，它自己
  // `delete out.sections` —— 也就是**新建出来的每一个站，页面在磁盘上都是 `blocks`**。
  // 后果是那道门把这些站的每一次**正当**编辑都拒掉，而且它给模型的指示（改成 sections）跟
  // 提示词自己写的「keep whichever array the file already has」互相矛盾：照做违反提示词，
  // 不照做永远写不进去 —— 这个站从此改不动。（QA2 在 #1013 r2 上量出来的。）
  //
  // 抛错 = 构建期会 exit 1 的那一族：两个数组都写了 / 都没有 / 不是数组 / 某一格不是对象 /
  // 某一格既没 type 也没 ref / 一格同时写了 ref 和 type。这些都是**内容的问题**、模型改得动，
  // 所以退回去让它重写。构建期只「点名 + 继续」的那些（role 拼错、weight 不是数字、ref 指不到）
  // 不在这里拦 —— 它们有明确的兜底行为，拦了就是把「一个字段被忽略」升级成「站改不动」。
  //
  // 站级块库传的是**空的**：这一关只问这一页自己的形状。真去读 site-blocks.json 的话，那个文件
  // 里的毛病会让这次写入被拒，而模型在这一轮里修不了它。
  try {
    normalizeLocalePages([JSON.parse(JSON.stringify(parsed))], {}, locale, {});
  } catch (e) {
    debug(`[blocks] 这份页面构建不出来，写入被拒：${e.message}`);
    return 'This page cannot be built. Fix it and write the file again:\n'
      + `  - ${e.message}\n`
      + '\nNothing was written. A page has exactly one of "blocks" or "sections" — keep whichever '
      + 'array the file already has, and every entry in it is an object with a "type" (or a "ref").';
  }

  // ── 第二关：内容（每个块的槽填对了没有）────────────────────────────────────────────────
  //
  // 🔴 喂给它的是 `blocks`，不是 `parsed.sections`：r2 那版写的是 `sections: parsed.sections`，
  // 对 `blocks` 形状的页面等于喂了个 `undefined` ⟹ `blocksOf` 返回空数组 ⟹ 这一关**一条都不查**
  // 而且不说话。也就是 #998 之后新建的站里，本票要治的那个缺陷（#1012 那种错键名）会原样回来，
  // 三盏灯全绿。两种形状都由 `readPageBlocks` 认出来，跟构建期同一个函数。
  let problems;
  try {
    ({ problems } = validateBlocks({
      pages: [{ slug: parsed.slug || path.basename(relPath, '.json'), blocks: ownBlocksOf(parsed, where) }],
      scope: 'edit',
    }));
  } catch (e) {
    // 校验器抛错了。两种完全不同的原因，处置也相反 —— 所以这里**先分清是哪一种**：
    //
    //   · 工具坏了（blocks/ 读不出来、某份 manifest 形状不合法）—— 模型修不了，拿它当「你写错了」
    //     会让这个站改不动 ⟹ 说一句，照原样放行。
    //   · 这份内容把校验器弄崩了 —— 那是内容的问题 ⟹ 退回去重写。
    //
    // 🔴 r1 只写了前一种，于是后一种（QA3 用 `sections` 里塞一个 null 量到的）也走了放行那条路，
    // 而且**同一份内容里那些本来会被拦下的毛病跟着一起免检进去了**。分辨的办法是问一个与这份内容
    // 无关的合规样例：样例也跑不起来 ⟹ 工具坏了；样例跑得起来 ⟹ 是这份内容。
    let toolIsBroken = false;
    try {
      validateBlocks({ pages: [{ slug: '(probe)', blocks: [] }], scope: 'edit' });
    } catch (probeErr) {
      toolIsBroken = true;
      debug(`[blocks] 校验器自己跑不起来（合规样例同样报错：${probeErr.message}），这次写入照原样放行`);
    }
    if (toolIsBroken) return null;
    debug(`[blocks] 这份内容让校验器报错，写入被拒：${e.message}`);
    return 'This page broke the block checker, so it cannot be checked or built:\n'
      + `  - ${e.message}\n`
      + '\nNothing was written. Every entry in the page\'s block array must be an object like '
      + '{"type": "hero", "data": {…}} — write the whole file again.';
  }
  if (problems.length === 0) return null;
  return `This page breaks the block library (blocks/*.json). Fix these and write the file again:\n`
    + problems.map((p) => `  - ${p}`).join('\n')
    + '\n\nNothing was written. Read the block\'s manifest if you need the exact slot names.';
}

function executeTool(toolName, toolInput, siteDir) {
  switch (toolName) {
    case 'read_file': {
      const relPath = toolInput.path;
      if (!validatePath(relPath)) return { error: 'Invalid path: must be relative, no ".."' };
      const fullPath = path.join(siteDir, relPath);
      if (!fs.existsSync(fullPath)) return { error: `File not found: ${relPath}` };
      return { content: fs.readFileSync(fullPath, 'utf-8') };
    }
    case 'write_file': {
      const relPath = toolInput.path;
      if (!validatePath(relPath)) return { error: 'Invalid path: must be relative, no ".."' };
      // Validate JSON
      let parsed;
      try {
        parsed = JSON.parse(toolInput.content);
      } catch (e) {
        return { error: `Invalid JSON: ${e.message}` };
      }
      const blockError = pageJsonBlockError(relPath, parsed);
      if (blockError) return { error: blockError };
      const fullPath = path.join(siteDir, relPath);
      fs.mkdirSync(path.dirname(fullPath), { recursive: true });
      fs.writeFileSync(fullPath, toolInput.content);
      return { success: true, message: `Written ${relPath}` };
    }
    case 'list_files': {
      const relDir = toolInput.directory || '';
      if (relDir && !validatePath(relDir)) return { error: 'Invalid directory path' };
      const fullDir = path.join(siteDir, relDir);
      if (!fs.existsSync(fullDir)) return { error: `Directory not found: ${relDir || '/'}` };
      const entries = [];
      function listRecursive(dir, prefix) {
        for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
          const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
          if (entry.isDirectory()) {
            listRecursive(path.join(dir, entry.name), rel);
          } else {
            entries.push(rel);
          }
        }
      }
      listRecursive(fullDir, relDir);
      return { files: entries };
    }
    default:
      return { error: `Unknown tool: ${toolName}` };
  }
}

// ─── System prompt ────────────────────────────────────────────────────────────

const SYSTEM_PROMPT = `You are an AI website editor. You modify static website configuration files to fulfill user requests.

## Site Structure

The site is defined by JSON configuration files:

- **brand.json** — Company name, tagline, logoIcon, color palette (primary 50-900 shades, accent 50-600 shades), fonts (googleFontsUrl, families), email, phone, locations, socialLinks
- **seo.json** — Domain, locale, meta title/description, keywords, Schema.org config
- **services.json** — Array of services with id, name, shortDescription, fullDescription, icon, features, products
- **pages/home.json** — Homepage sections
- **pages/{slug}.json** — Other pages (about, services, quote, menu, gallery, faq, etc.)
- **navigation.json** — **DO NOT edit directly.** It is auto-regenerated from page metadata.

## Color Palette

brand.json colors use shade notation:
- primary: { "50": "#...", "100": "#...", ..., "900": "#..." } — 10 shades from lightest to darkest
- accent: { "50": "#...", "100": "#...", ..., "600": "#..." } — 7 shades

When changing colors, update ALL shades consistently (lighter for low numbers, darker for high).

## Page Blocks

Each page has a \`blocks\` array. Each block:
\`{ "id": "...", "type": "...", "role": "essential|lead|optional", "region": "content", "weight": 0, "data": { ... } }\`
A block may also carry \`"block_layout": "..."\` (its content structure) and \`"hidden": true\`.

🔴 Older sites still use a \`sections\` array of \`{ "type": "...", "data": { ... } }\` instead. **Keep whichever
array the file already has** — never convert one into the other, and never drop \`id\` / \`role\` / \`weight\` /
\`block_layout\` from a block you are editing. A page must have exactly one of the two arrays; a file with both
fails the build. When you add a block to a \`blocks\` page, give it an \`id\` unique within that page and a
\`weight\` that puts it where you want it (blocks are ordered by \`weight\`, smaller first).

Available section types: hero, trusted-brands, features-grid, values-grid, testimonials, cta-banner, contact-info, text-block, page-header, services-nav, services-list, quote-form, stats-counter, faq-accordion, process-steps, team-grid, pricing-table, gallery, logo-carousel, content-split, feature-comparison, benefits-list, social-proof, divider, announcement-bar, timeline, service-highlights, newsletter-signup, map-area, checklist, awards-certifications, blog-preview

Hero variants: left, centered, split, minimal, video-style, gradient-overlay, light-split, light-editorial, light-showcase
(dark full-bleed: left, centered, split, video-style, gradient-overlay · light background: minimal, light-split, light-editorial, light-showcase)

## Rules

1. You MUST call read_file to check current file contents before responding — never rely on conversation history to know file state
2. Only call write_file if changes are actually needed. Only claim changes were made if you called write_file
3. Write the COMPLETE file content (not partial updates)
4. All written content must be valid JSON
5. Keep content SEO-friendly and professional
6. When adding sections, follow existing data patterns from the file
7. Preserve all existing fields you don't need to change
8. Chinese language sites: Check the site's locale field in seo.json. Locale matching is case-insensitive. If locale matches Simplified ("zh", "zh_CN", "zh-CN") → use ONLY Simplified Chinese characters (mainland China convention, 简体) in all content. If locale matches Traditional ("zh-TW", "zh-tw", "zh_TW", "zh_tw", "zh-HK", "zh-hk", "zh_HK", "zh_hk") → use ONLY Traditional Chinese characters (Taiwan / Hong Kong convention, 繁體). Never mix Simplified and Traditional characters.`;

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  let input;
  try {
    input = await readStdin();
  } catch (e) {
    fatal('Failed to read input: ' + e.message);
  }

  // TICKET-093: optional images attached by the user as multimodal content blocks.
  const { siteId, message, conversationHistory = [], images = [] } = input;
  const configModel = input.model || 'claude-sonnet-4-6';
  const configMaxTokens = parseInt(input.maxTokens, 10) || 8192;

  if (!siteId) fatal('siteId is required');
  if (!message) fatal('message is required');
  if (!process.env.ANTHROPIC_API_KEY) fatal('ANTHROPIC_API_KEY is required');

  const rootDir = path.resolve(__dirname, '..');
  const siteDir = path.join(rootDir, 'site');

  if (!fs.existsSync(siteDir)) {
    fatal('Site directory not found: site/');
  }

  emit('progress', { message: 'Reading your request...' });

  const client = new Anthropic();

  // Build messages: conversation history + current user message.
  // TICKET-093: when the user attaches images, send multimodal content blocks
  // (text + url-source images) so Claude Sonnet can see them.
  // TICKET-105 v2: do NOT filter formats here. Pass everything to the AI; if
  // the provider can't handle a format we'll catch the error around the API
  // call and surface a friendly message. Provider-agnostic — when we swap AI
  // providers, this code Just Works without listing which formats they accept.
  const userContent = images.length > 0
    ? [
        { type: 'text', text: message },
        ...images.map(img => ({ type: 'image', source: { type: 'url', url: img.url } })),
      ]
    : message;
  const messages = [
    ...conversationHistory,
    { role: 'user', content: userContent },
  ];

  let totalInputTokens = 0;
  let totalOutputTokens = 0;
  let filesModified = false;
  let commitHash = '';

  const model = configModel;

  // $/M tokens by model family
  const MODEL_PRICING = {
    'claude-opus-4':   { input: 15, output: 75 },
    'claude-sonnet-4': { input: 3,  output: 15 },
    'claude-haiku-4':  { input: 0.80, output: 4 },
  };
  function getModelPricing(modelId) {
    for (const [prefix, pricing] of Object.entries(MODEL_PRICING)) {
      if (modelId.startsWith(prefix)) return pricing;
    }
    return { input: 3, output: 15 }; // default to sonnet
  }

  // Tool use loop
  let currentMessages = messages;
  const maxIterations = 20;

  for (let i = 0; i < maxIterations; i++) {
    debug(`Iteration ${i + 1}: sending ${currentMessages.length} messages`);

    let response;
    // TICKET-148: API-error retry inside this iteration. Per-iteration retry budget
    // (3 attempts with 5s/10s/20s backoff). On retryable error → wait + retry.
    // Image errors (classifyVisionError matches) and other terminal errors fall
    // through to existing handler. iteration state (totalInputTokens, currentMessages)
    // is untouched on retry → success continues this iteration normally.
    {
      let apiAttempt = 0;
      const maxApiAttempts = 3;
      while (true) {
        try {
          response = await client.messages.create({
            model,
            max_tokens: configMaxTokens,
            system: SYSTEM_PROMPT,
            messages: currentMessages,
            tools,
          });
          break; // success → continue with normal flow below
        } catch (err) {
          apiAttempt++;
          if (isRetryableApiError(err) && apiAttempt < maxApiAttempts) {
            const waitMs = 1000 * Math.pow(2, apiAttempt - 1) * 5; // 5s, 10s, 20s
            debug(`[ai-retry] iteration ${i + 1} API error ${err.status || 'unknown'} (${apiAttempt}/${maxApiAttempts - 1}): ${err.message?.substring(0, 200) || 'no message'} — retrying in ${waitMs}ms`);
            await new Promise(r => setTimeout(r, waitMs));
            continue;
          }
          // Not retryable, or budget exhausted — fall through to friendly/throw path.
          // TICKET-105 v2: catch image-format errors and surface a friendly message
          // instead of leaking the raw provider stack trace. Provider-agnostic —
          // we match on standard error vocabulary, not on hardcoded format names.
          const friendly = classifyVisionError(err, images);
          if (friendly) {
            emit('edit-complete', {
              message: friendly,
              inputTokens: totalInputTokens,
              outputTokens: totalOutputTokens,
              cost: 0,
            });
            return;
          }
          throw err; // non-image error → existing error path (caught by main()'s outer handler)
        }
      }
    }

    totalInputTokens += response.usage?.input_tokens || 0;
    totalOutputTokens += response.usage?.output_tokens || 0;

    debug(`Response: stop_reason=${response.stop_reason}, content blocks=${response.content.length}`);

    // Process content blocks
    const toolResults = [];

    for (const block of response.content) {
      if (block.type === 'text' && block.text) {
        debug(`Claude text: ${block.text.substring(0, 200)}`);
      } else if (block.type === 'tool_use') {
        debug(`Tool call: ${block.name}(${JSON.stringify(block.input).substring(0, 100)})`);

        emit('tool_use', { tool: block.name, ...(block.input.path ? { path: block.input.path } : {}) });

        const result = executeTool(block.name, block.input, siteDir);

        if (block.name === 'write_file' && result.success) {
          filesModified = true;
        }

        // Truncate large file contents in tool results for debug
        const resultStr = JSON.stringify(result);
        debug(`Tool result: ${resultStr.substring(0, 200)}${resultStr.length > 200 ? '...' : ''}`);

        toolResults.push({
          type: 'tool_result',
          tool_use_id: block.id,
          content: resultStr,
        });
      }
    }

    // If stop_reason is end_turn, we're done
    if (response.stop_reason === 'end_turn') {
      // Extract final text message
      const textBlock = response.content.find(b => b.type === 'text');
      const finalMessage = textBlock?.text || 'Changes applied.';

      // Sync changes if any files were modified
      if (filesModified) {
        emit('progress', { message: 'Syncing changes to preview...' });
        try {
          execSync('node scripts/sync-config.js', {
            cwd: rootDir,
            stdio: ['pipe', 'pipe', 'pipe'],
          });
          debug('sync-config.js sync complete');
        } catch (e) {
          debug(`sync-config.js sync error: ${e.message}`);
        }

        // Health check: poll dev server until ready (replaces fixed 3s wait)
        const port = process.env.PREVIEW_PORT || '4000';
        debug('Polling dev server up to 5s for hot reload...');
        const startWait = Date.now();
        let status = 0;
        while (Date.now() - startWait < 5000) {
          status = await checkDevServer(port);
          if (status === 200) break;
          await new Promise(r => setTimeout(r, 200));
        }
        debug(`Dev server check after ${Date.now() - startWait}ms: ${status}`);

        if (status >= 500 || status === 0) {
          emit('progress', { message: 'Dev server error detected, restarting...' });
          // 🔴 WE DO NOT KILL ANYTHING HERE — WE WAIT FOR THE ENTRYPOINT'S LOOP. Since TICKET-275a the
          // preview is a production static build served by `serve out` (see the comment above
          // start_preview_server() in worker/entrypoint.sh), and that loop is what brings it back when
          // it dies. #1059 deleted a `pkill -f "next dev"` that used to stand here: there is no
          // `next dev` on such a container for it to match, so it restarted nothing.
          //
          // 🔴 And it was not free. `execSync` runs on WHICHEVER MACHINE this script is on. In
          // production that is the site's own container, but we run this script by hand on the shared
          // dev box to verify things — and there `pkill -f "next dev"` matches by command line without
          // caring whose process it is, so it killed other people's dev servers. Two separate
          // avoidance rules had been written down for that (point PREVIEW_PORT at a stand-in that
          // always answers 200, so this branch is never reached); deleting the line retires both.
          debug('Dev server unhealthy — waiting for the preview server to come back on its own');
          const recovered = await waitForDevServer(port, 30000);
          if (recovered) {
            debug('Dev server recovered after restart');
          } else {
            debug('Dev server did not recover within 30s');
          }
        }

        // Auto-save: git commit + push
        emit('progress', { message: 'Saving changes...' });
        try {
          const commitMsg = 'Edit: ' + finalMessage.substring(0, 72).replace(/["`$\\]/g, '');
          execSync(`git add -A && git commit -m "${commitMsg}"`, {
            cwd: rootDir,
            stdio: ['pipe', 'pipe', 'pipe'],
          });
          commitHash = execSync('git rev-parse --short HEAD', { cwd: rootDir }).toString().trim();
          execSync('git push origin main', { cwd: rootDir, stdio: ['pipe', 'pipe', 'pipe'] });
          debug(`git commit + push complete (${commitHash})`);
        } catch (e) {
          debug(`git auto-save error: ${e.message}`);
        }
      }

      // Emit cost
      const pricing = getModelPricing(model);
      const cost = ((totalInputTokens * pricing.input) + (totalOutputTokens * pricing.output)) / 1_000_000;
      const duration = Date.now() - startTime;
      emit('cost', {
        operation: 'edit-site',
        provider: 'Claude',
        cost,
        detail: `Edit (${totalInputTokens} in / ${totalOutputTokens} out)`,
        duration,
      });

      emit('edit-complete', {
        message: finalMessage,
        ...(commitHash ? { commitHash } : {}),
        inputTokens: totalInputTokens,
        outputTokens: totalOutputTokens,
        cost,
      });
      debug(`Edit complete: ${totalInputTokens} in / ${totalOutputTokens} out, cost $${cost.toFixed(4)}`);
      return;
    }

    // If there are tool results (from tool_use or max_tokens with partial tool calls), continue the loop
    if (toolResults.length > 0) {
      currentMessages = [
        ...currentMessages,
        { role: 'assistant', content: response.content },
        { role: 'user', content: toolResults },
      ];
      // If max_tokens, tell Claude it was truncated so it can continue
      if (response.stop_reason === 'max_tokens') {
        debug('Response truncated (max_tokens), continuing with tool results');
      }
      continue;
    }

    // max_tokens with no tool calls — ask Claude to continue
    if (response.stop_reason === 'max_tokens') {
      debug('Response truncated (max_tokens) with no tool calls, asking to continue');
      currentMessages = [
        ...currentMessages,
        { role: 'assistant', content: response.content },
        { role: 'user', content: 'Your response was truncated. Please continue where you left off.' },
      ];
      continue;
    }

    // Unexpected stop reason
    debug(`Unexpected stop_reason: ${response.stop_reason}`);
    break;
  }

  fatal('Edit loop exceeded maximum iterations');
}

// ─── Run ──────────────────────────────────────────────────────────────────────

main().catch(err => {
  fatal(err.stack || err.message || String(err));
});
