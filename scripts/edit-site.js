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
      try {
        JSON.parse(toolInput.content);
      } catch (e) {
        return { error: `Invalid JSON: ${e.message}` };
      }
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

## Page Sections

Each page has a \`sections\` array. Each section: \`{ "type": "...", "data": { ... } }\`

Available section types: hero, trusted-brands, features-grid, values-grid, testimonials, cta-banner, contact-info, text-block, page-header, services-nav, services-list, quote-form, stats-counter, faq-accordion, process-steps, team-grid, pricing-table, gallery, logo-carousel, content-split, feature-comparison, benefits-list, social-proof, divider, announcement-bar, timeline, service-highlights, newsletter-signup, map-area, checklist, awards-certifications, blog-preview

Hero variants: left, centered, split, minimal, video-style, gradient-overlay

## Rules

1. You MUST call read_file to check current file contents before responding — never rely on conversation history to know file state
2. Only call write_file if changes are actually needed. Only claim changes were made if you called write_file
3. Write the COMPLETE file content (not partial updates)
4. All written content must be valid JSON
5. Keep content SEO-friendly and professional
6. When adding sections, follow existing data patterns from the file
7. Preserve all existing fields you don't need to change`;

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

    const response = await client.messages.create({
      model,
      max_tokens: configMaxTokens,
      system: SYSTEM_PROMPT,
      tools,
      messages: currentMessages,
    });

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
          debug('Dev server unhealthy, killing next dev to trigger restart...');
          try {
            execSync('pkill -f "next dev"', { stdio: 'pipe' });
          } catch (e) {
            // pkill returns non-zero if no process found — that's fine
          }
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
