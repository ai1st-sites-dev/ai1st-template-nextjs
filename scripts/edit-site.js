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
// #1087 —— site/ 底下哪些文件由这条路改。谓词、逐条理由、以及为什么是白名单而不是黑名单，
// 整段写在那个文件里。
const { writeRejection, writeNotes } = require('./lib/editable-files');
// #1104 r6 —— 这个站的页面真的画出哪些区（构建和这条路共用同一份实现，理由在那个文件头上）。
const siteRegions = require('./lib/site-regions');
// #1109 —— 这个站的内容住在 `site/<语言>/` 还是直接在 `site/`。白名单拿它判「这条路径在这个站上
// 有没有人读」；判据跟构建同一条（只看 site_meta.json 在不在），理由在那个文件头上。
const siteShape = require('./lib/site-shape');
// #1195 —— 写进图片字段的那个地址，是不是有人真的给过它。为什么必须是「谁给的」而不是「取不取得到」，
// 以及那张 IMAGE_FIELDS 清单为什么不是手抄的，整段写在那个文件头上。
const imageUrls = require('./lib/image-urls');

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

// ─── #1102：说了「没有保存」就真的没保存 ──────────────────────────────────────────────────────
//
// #1087 让「同步失败」不再保存，但**写出去的文件留在工作树上**。而保存那一步是 `git add -A`
// （下面 auto-save 那段）⟹ 下一次成功的编辑会把它一起提交、一起推。QA2 在真容器上量到的顺序：
// 主题是坏的 → 老板改 About 页 → 收到 "This change was not saved" → 主题被修好 → 老板改的是
// **另一个文件**（seo.json）→ 那次成功的 commit 里 `site/en/pages/about.json | 2 +-` 也进去了。
// ⟹ 跟老板说过的那句话事后变成了假的，而没有人被告知。
//
// 🔴 为什么不走「保存时只提交本次真正改的文件」（票正文给的另一个方向）：`sync-config.js` 每跑一次
// 都会重写 `site/<locale>/navigation.json`（从页面 metadata 重新生成 header/footer）——那个文件住在
// **站仓里**，也就是一次成功的编辑真正该提交的文件**多于** `write_file` 写过的那几个。把 `git add -A`
// 收窄成这几个路径，站仓里的导航就会跟它自己的页面长期不一致。所以 `git add -A` 一个字不动。
//
// 🔴 为什么不是 `git checkout -- .` 那种整树回滚：同一棵树上还有别人未提交的改动 —— QA2 那条时间线
// 里「主人把主题修好」就发生在这里。整树回滚会连带把它抹掉。所以只退**这次 write_file 真正写过的
// 那几个路径**，一个不多。
//
// 🔴🔴 为什么退回的目标是「写之前磁盘上的样子」，而**不是** HEAD 里那一份（r1 是那么写的，QA1 打回）：
// 「HEAD 里查不到这个路径」不只有一种解释。r1 的注释说它有两种（本次新建 / git 坏了）并给第二种加了
// 一道 `git rev-parse --verify HEAD`，但还有第三种 —— **文件在磁盘上、却从来没进过 HEAD**。它是可达的：
// 这个脚本里 `git add -A && git commit` 失败时只有一行 `debug()`，老板照样收到 `edit-complete`，
// 于是「上一次编辑新建的页面」就停在磁盘上、不在 HEAD 里。下一次编辑再动同一个文件而同步失败时，
// 按 HEAD 推断会把它判成「本次新建」⟹ **把老板上一次那一整页删掉，而且没有任何人被告知**
// （QA1 在 #1102 r1 用真 git 仓复现过；`site/` 被 .gitignore 忽略的仓形态里每一个回滚都会这样）。
//
// ⟹ 判据换成**事实**：`write_file` 在落盘**之前**就知道这个文件本来在不在、本来是什么字节，
// 把那份字节记下来。回滚时按记下来的那份写回（本来没有就删掉），一次 git 都不用问 ——
// 三种解释里那两种会删错文件的，从此不在这条路上。r1 那道 `rev-parse --verify HEAD` 也跟着撤掉了：
// 它存在的唯一理由就是给「拿 HEAD 推断」兜底，而现在没有推断了。
/** 32 MB。站的内容文件是 JSON，仓里最大的那类（博客文章）只有几十 KB；这个上限只是不让一个异常大的
 *  文件把编辑进程的内存吃掉。超过它就**诚实地说退不掉**（下面 failed 那一支），而不是猜。 */
const SNAPSHOT_MAX_BYTES = 32 * 1024 * 1024;

/**
 * 把这次编辑写出去的那几个文件，退回**这次编辑开始之前磁盘上的样子**。
 *
 * 🔴🔴 键是「`writeFileSync` 真正写到的那个绝对路径」，**不是模型给的那个字符串**（QA3 在 r2 打回的
 * 那条阻断）。同一个物理文件有无穷多种写法 —— `en/pages/about.json` · `./en/pages/about.json` ·
 * `en//pages/about.json` · `en/./pages/about.json`，四种我都实测过能走到落盘那一行（`validatePath`
 * 只拦 `..` 与绝对路径，`writeRejection` 自己会归一化所以它四种都判成同一个文件、一视同仁地放行）。
 * 🔴 **上面那句括号里的话有个射程边界，#1109 r2 补在这里** —— 它对**这四种**是真的，而这四种的共同点
 * 是 `path.join` 自己就会把它们收敛到同一个文件。收不敛的写法（`en\pages\about.json` 那族、结尾带
 * 分隔符那族）曾经也走到落盘那一行，而落点跟 `writeRejection` 判的**不是同一个文件** —— 那是 QA3
 * 在 #1109 r1 终审打回的那条阻断。现在 `writeRejection` 放行之前会多问一句「我判的这个文件就是
 * `path.join` 会写的那个吗」（`lib/editable-files.js` 的 `spellingMismatch`），不同就大声拒。
 * ⟹ 走到下面这一行的每个字符串，都已经被证明「判的对象 == 落盘的对象」。别照这句括号里的话推断
 *    「任何写法都会被归一化成同一个文件」：不是归一化，是不收敛的那些**进不来**。
 * 按原始字符串当键，「同一次编辑里同一个文件只记第一次」那条纪律就被写法拆开了：第二条快照记下的
 * 「写之前」是**第一笔写完之后**的样子，回滚按插入序两条都写回、后写的盖住先写的 ⟹ 磁盘上留下的是
 * 第一笔的改动，而它自报 `restored 2 · failed 0`。QA3 真跑 `edit-site.js` 本体量到的读数：
 *   两种写法各写一次 ⟹ `restored 2`，回滚后 md5 ≠ 写之前、`git status` 仍有 ` M …/about.json`，
 *                      下一次成功的编辑把它带进 commit（**正文判据 1 的字面违反**）
 *   对照：两笔同写法 ⟹ `restored 1`，回滚后与写之前逐字节相同、工作树干净
 *
 * 🔴 为什么键取 `path.join(siteDir, relPath)` 的结果、而不是另写一道 `path.posix.normalize`：
 * `path.join` **就是决定这几个字节落到哪里的那个函数**。拿它的输出当身份，「同一个键 ⟺ 同一个被写的
 * 文件」是按构造成立的，不需要维护第二个归一化实现去跟它保持一致（`lib/editable-files.js:135` 有它
 * 自己那份 `path.posix.normalize`，那是给「这个文件归谁管」用的，两处判的不是同一个问题）。
 * 📌 **射程边界，说在明处**：这样收得住的是「同一个路径的不同写法」。收不住的是**目录软链**和
 * 大小写不敏感的文件系统 —— 那两种下同一个文件仍可能有两个不同的绝对路径，于是回到上面那个失败形状。
 * 站容器是 Linux + ext4（大小写敏感），而 `site/` 底下由 `create-site.js` / 这条路自己生成、没有任何
 * 地方造软链，所以今天到不了；真要收它得 `realpath` 每一层父目录（新建文件那一支的父目录此刻还不
 * 存在，`mkdirSync` 在后面），代价与风险都比它治的东西大。
 *
 * @param {string} siteDir  `<rootDir>/site` —— **只用来把键换成给人看的相对路径**（回滚本身用键那个
 *        绝对路径，不再拼接；`failed` 里那几句会被原样推进老板的聊天窗口）。
 * @param {Map<string, Buffer|null|{why:string}>} snapshots
 *        键 = 这次 `write_file` 真正写到的**绝对**路径；值 = **写之前**那个文件的字节；
 *        `null` = 写之前它不存在（本次新建）；`{why}` = 原样没存下来，why 是原因。
 * @returns {{restored:string[], removed:string[], failed:string[]}}
 */
function rollbackWrittenFiles(siteDir, snapshots) {
  const out = { restored: [], removed: [], failed: [] };
  for (const [full, before] of snapshots) {
    // 给人看的那个名字用归一化之后的相对路径 —— 老板看到的是「哪个文件」，不该是模型手滑打出来的
    // `./en/pages/about.json` 那种写法。
    const rel = path.relative(siteDir, full) || full;
    try {
      if (before && !Buffer.isBuffer(before)) {
        out.failed.push(`${rel}: ${before.why}`);
      } else if (before === null) {
        // 写之前它不存在 ⟹ 删掉就精确地回到了写之前的样子。
        if (fs.existsSync(full)) fs.unlinkSync(full);
        out.removed.push(rel);
      } else {
        fs.writeFileSync(full, before);
        out.restored.push(rel);
      }
    } catch (e) {
      out.failed.push(`${rel}: ${String(e.message).slice(0, 120)}`);
    }
  }
  return out;
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
// 之前这条路只校验「是合法 JSON」，于是模型可以把 `items` 写成 `plans`、把当年 `benefits-list` 的
// `items` 写成 `benefits`，页面上那一块就此空着 —— 而聊天窗口说「改好了」、构建也是绿的。
// （那个块名 2026-08-23 #1162 起并进了 `card-group`；这里留着是因为它是 #1012 那两个 prod 站的出处。）
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

// 站级块库(`blocks/site-blocks.json`,多语言站是 `<locale>/blocks/site-blocks.json`)。
//
// 🔴 路径这一段不写死 locale 长什么样,理由跟上面 PAGE_JSON 那段逐字同源(locale 目录名来自
// site_meta.json,`zh_CN` / `zh-TW` 都出现过,而认不出路径的后果是**这次写入不被校验**)。
// 权威的那份判断在白名单里(`lib/editable-files.js` 的 WRITABLE 最后一条:路径正好两段、
// 第一段是 `blocks`、文件名是 `site-blocks.json`),而 `writeRejection` 跑在这之前 ——
// 走到这一行的路径已经过了白名单,所以这条正则只负责认出「是它」。
const SITE_BLOCKS_JSON = /(?:^|\/)blocks\/site-blocks\.json$/i;

/**
 * 站级块库的内容闸(#1160)。
 *
 * 页面块从 #1152/#1154 起在**写入这一刻**就被拦(见上面 pageJsonBlockError);站级块走的是同一条
 * `write_file`,却一条内容检查都没有 —— 同一份畸形内容放在页面里报 1~2 条问题,放在这个文件里报 0 条。
 * 后果分两档:
 *   · 段落消失 / 空列表(items 里有 null、items 不是数组、type 不存在、缺必填槽)—— 拖到构建期才显形,
 *     而那时没人要求模型重写,老板已经收到 Done。
 *   · **站从此建不出来**(值缺 `type`、值整格是 null)—— `blocks.js` 那两句 throw 让 sync-config
 *     exit 1,预览也开不出来(`worker/entrypoint.sh` 的 preview 分支带 `set -e`)。
 * 而这两种最坏的形状恰恰是模型最可能写出来的:提示词里这个文件原来只有一句话带过,从来没说过它长什么样。
 *
 * 两关,顺序是承重的:
 */
function siteBlocksJsonError(relPath, parsed) {
  if (!SITE_BLOCKS_JSON.test(relPath)) return null;

  const locale = relPath.includes('/blocks/') ? relPath.split('/blocks/')[0] : '(site)';
  const shapeHelp = '\nblocks/site-blocks.json is an object that maps an id to one block: '
    + '{"<id>": {"type": "card-group", "data": {…}}, …}. Every value must be a block that carries its '
    + 'own "type" — a {"ref": "<id>"} entry is only allowed inside a page\'s blocks array, never as a '
    + 'value in this file.';

  // ── 第 0 关:这个文件本身的形状 ────────────────────────────────────────────────────────────
  // `Object.entries` 对一个字符串会按字符拆开、对一个数字给空数组 —— 下面两关都会因此读到一份
  // 假的库。数组这一格也在这里拦:它建得出来(id 变成 "0" / "1"),但没有一个页面 ref 得到它,
  // 也就是「写进去了、站上什么都没变」那一族。
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    const what = parsed === null ? 'null' : (Array.isArray(parsed) ? 'an array' : `a ${typeof parsed}`);
    return `This file must be a JSON object, but it is ${what}. Nothing was written.\n${shapeHelp}`;
  }

  // ── 第一关:形状(每个值是不是一个带自己 `type` 的块)────────────────────────────────────────
  //
  // 🔴 判据不是我以为的形状,是「构建期收不收」—— 所以这里调构建期自己那个函数
  // (`blocks.js` 的 `normalizeLocalePages`),不写第二份规则。它的报文自己就点名是哪个 id
  // (`Locale "en" 站级块 "shared" 缺 "type"`),AC2 要的那件事由它免费给到。
  //
  // 🔴 `pages` 传空数组:这一关只问**这个文件**自己的形状。真去读磁盘上那些页面的话,页面里的毛病
  //    会让这次写入被拒,而模型在这一轮里改不动它们 —— 那个站从此编辑不了。这跟上面
  //    pageJsonBlockError 第一关把站级块库传成空的是同一个理由,只是方向相反。
  //    📌 代价说在明处:`visibility` 里那些 slug 因此比不到真页面。而那一维在构建期只是
  //    「点名 + 忽略这一条」(note,不抛),所以空 pages 不会造出误报 —— 它只是不查那一维。
  //
  // 🔴 传的是深拷贝:这个函数会 `delete b.role` / 改写 `b.visibility`,而 `parsed` 下面还要落盘。
  try {
    normalizeLocalePages([], JSON.parse(JSON.stringify(parsed)), locale, {});
  } catch (e) {
    debug(`[site-blocks] 这份站级块库构建不出来，写入被拒：${e.message}`);
    return 'This file cannot be built. Fix it and write the file again:\n'
      + `  - ${e.message}\n`
      + `\nNothing was written.${shapeHelp}`;
  }

  // ── 第二关:内容(每个块的槽填对了没有)────────────────────────────────────────────────────
  //
  // 🔴 一个 id 一「页」:`validateSite` 的报文前缀是 `page.slug`,所以把 id 放进 slug 就是让
  //    报文点名是哪一条(AC2)。库里两个 id 只有一个畸形时,另一个的 id 不会出现在报文里。
  // 🔴 用 scope 'edit':跟页面块那条路同一档 —— 逐块的毛病算 problem(拒这次写入、模型重写),
  //    而「整个站里没有某个块」那条不查(手上只有这个文件,答不了整站的问题)。
  // 🔴 `isRefEntry` 那个洞(#1155 为**页面里**的 ref 条目加的跳过)在这一关是反的:站级块的值
  //    写成 `{ "ref": … }` 时它会整格跳过、报 0 条。走不到这里 —— 第一关的 `缺 "type"` 已经拦了,
  //    这正是两关顺序承重的地方。
  let problems;
  try {
    ({ problems } = validateBlocks({
      pages: Object.entries(parsed).map(([id, b]) => ({ slug: `站级块 "${id}"`, blocks: [b] })),
      scope: 'edit',
    }));
  } catch (e) {
    // 跟 pageJsonBlockError 同一套分辨法:问一个与这份内容无关的合规样例。样例也跑不起来 ⟹
    // 工具坏了(模型修不了,照原样放行);样例跑得起来 ⟹ 是这份内容(退回去重写)。
    let toolIsBroken = false;
    try {
      validateBlocks({ pages: [{ slug: '(probe)', blocks: [] }], scope: 'edit' });
    } catch (probeErr) {
      toolIsBroken = true;
      debug(`[site-blocks] 校验器自己跑不起来（合规样例同样报错：${probeErr.message}），这次写入照原样放行`);
    }
    if (toolIsBroken) return null;
    debug(`[site-blocks] 这份内容让校验器报错，写入被拒：${e.message}`);
    return 'This file broke the block checker, so it cannot be checked or built:\n'
      + `  - ${e.message}\n`
      + `\nNothing was written.${shapeHelp}`;
  }
  if (problems.length === 0) return null;
  return 'These site-wide blocks break the block library (blocks/*.json). Fix these and write the '
    + 'file again:\n'
    + problems.map((p) => `  - ${p}`).join('\n')
    + '\n\nNothing was written. Read the block\'s manifest if you need the exact slot names.';
}

/**
 * @param {Map<string, Buffer|null|{why:string}>} [snapshots]
 *   #1102 —— `write_file` 往这里记「这个文件在被写之前是什么样」。同步失败时按它回滚。
 */
function executeTool(toolName, toolInput, siteDir, snapshots, allowedImageUrls) {
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
      // #1087 —— 这条路只写【站的内容】。别的通道拥有的开关（theme.json 归换装弹窗）和构建自己
      // 生成的产物（custom.css）一律拒，判据与理由整段写在 lib/editable-files.js。
      // 🔴 排在 JSON.parse 【前面】：拒绝的理由要说的是「这个文件不由这条路改」，不是「你的 JSON 写错了」
      // —— `theme.css` / `custom.css` 根本不是 JSON，先解析的话它们拿到的是一句指错方向的错误。
      //
      // #1104 —— `navigation.json` 是有条件可写的（顶部那个按钮 / 页脚版权 / 页脚栏标题 / topbar 放行，
      // 菜单链接那一半拒），所以那一格要拿**这次的内容**跟**磁盘上那份**比。两样都从这里递进去：
      // 这个模块是纯函数，不自己碰文件系统（它也被测试直接调）。
      const writeCtx = {
        content: toolInput.content,
        readCurrent: (p) => {
          const f = path.join(siteDir, p);
          return fs.existsSync(f) ? fs.readFileSync(f, 'utf-8') : null;
        },
        // #1104 r6 —— 「这个站的页面真的画出哪些区」。第二问（改的这个字段，这个站的页面读不读它）
        // 要它；判断在 lib/site-regions.js，构建用的是同一份实现。
        // 🔴 算不出来一律回 null，**不是回一个猜的值**：下游拿到 null 会对老板说「我说不准」，
        //    而拿到一个猜错的值会说一句确定的假话。两个方向的错法不对称。
        // #1109 —— 这个站是什么形状（多语言站内容在 `site/<语言>/`、老扁平站直接在 `site/`）。
        // 白名单用它拒掉「写得进去、但这个站的构建根本不读」的那些位置 —— 那种写入会落盘、
        // 同步通过、commit + push、老板收到「Done」，而站上一个像素都没变。
        // 🔴 判据只看 `site_meta.json` 在不在，跟 `sync-config.js` 分多语言/扁平用的是同一条
        //    （整段理由在 lib/site-shape.js 的文件头）。问不出来时它返回 null，白名单那一维就不判。
        readSiteShape: () => siteShape.readSiteShape(siteDir),
        readRenderedRegions: () => {
          try {
            const r = siteRegions.resolveSiteRegions(siteDir);
            return {
              header: [r.regionLayout.header],
              footer: r.footerVariants,
              topbar: r.hasTopbarRegion ? [r.regionLayout.topbar] : [],
            };
          } catch (e) {
            return null;
          }
        },
      };
      const notWritable = writeRejection(relPath, writeCtx);
      if (notWritable) return { error: notWritable };
      // #1104 r2 —— 放行了，但**别处会跟着变**的那些改动要说出来（今天只有 header.cta.href：
      // 构建拿它算出 ctaSlug，再用它把那一页从顶部菜单里过滤掉）。判据在 lib/navigation-owned.js
      // 的 SIDE_EFFECTS，理由整段写在那里。它不是拒绝 —— 文件照常落盘，只是回话里带上实话。
      const sideEffects = writeNotes(relPath, writeCtx);
      // Validate JSON
      let parsed;
      try {
        parsed = JSON.parse(toolInput.content);
      } catch (e) {
        return { error: `Invalid JSON: ${e.message}` };
      }
      const blockError = pageJsonBlockError(relPath, parsed);
      if (blockError) return { error: blockError };
      // #1160 —— 站级块库走的是同一条 write_file,而上面那道闸的正则钉在 `pages/**.json` 上,
      // 所以它在这里补一道。位置跟上面那条一样在 `JSON.parse` 之后、落盘之前:这两关问的都是
      // 「这份内容建得出来吗」,而拒绝时磁盘一个字节没动、模型拿着原因在同一轮里重写。
      const siteBlocksErr = siteBlocksJsonError(relPath, parsed);
      if (siteBlocksErr) return { error: siteBlocksErr };
      // #1195 —— 图片字段上写着的 http(s) 地址必须是**有人给过**的（附件 / 老板打的字 / 站里已有的）。
      // 位置跟上面两关同一个道理：拒的时候磁盘一个字节没动，模型拿着原因在同一轮里改口。
      // 🔴 排在这里而不是更早：前两关问的是「这份内容建得出来吗」，这一关问的是「这个地址存在吗」——
      //    一份 JSON 写错了的内容不该先收到一句关于图片的错误。
      const badImageUrl = imageUrls.imageUrlRejection(parsed, allowedImageUrls);
      if (badImageUrl) return { error: badImageUrl };
      const fullPath = path.join(siteDir, relPath);
      // #1102 —— 落盘**之前**把这个文件本来的样子记下来（同步失败时按它回滚）。
      // 🔴 只在第一次写它的时候记：同一次编辑里模型可能把同一个文件写两遍，而"这次编辑之前"
      //    是它第一次被写之前那一刻，不是第二次。
      // 🔴🔴 键用 `fullPath`、**不是** `relPath`（QA3 在 r2 打回的那条阻断）：`relPath` 是模型给的
      //    字符串，同一个物理文件有多种写法（`./en/…` / `en//…` / `en/./…` 都能走到这一行），
      //    按字符串当键上面那条「只记第一次」就被写法拆成两条快照，而第二条记的「写之前」是第一笔
      //    写完之后的样子。整段理由与两侧读数在 rollbackWrittenFiles 上面。
      //    📌 `fullPath` 正是下面 `writeFileSync` 的第一个参数 ⟹ 「同一个键 ⟺ 同一个被写的文件」
      //    按构造成立，不需要第二个归一化实现。
      // 🔴 记在这里、不是事后去问 HEAD：理由整段在 rollbackWrittenFiles 上面（QA1 在 r1 打回的那条）。
      // 🔴 走到这一行的才记：上面每一条 return 都是拒绝，而回滚名单里多一个没写过的路径 = 拿旧字节
      //    盖一个不该动的文件。
      if (snapshots && !snapshots.has(fullPath)) {
        let before = null;
        try {
          const st = fs.statSync(fullPath);
          before = st.size > SNAPSHOT_MAX_BYTES
            ? { why: `it was ${st.size} bytes before this edit — too large to hold in memory for an undo` }
            : fs.readFileSync(fullPath);
        } catch (e) {
          // ENOENT = 它本来就不存在（本次新建）。别的错（读不动、是个目录、权限）**不能**当成
          // "本次新建"，否则回滚会把一个本来就在的文件删掉 —— 这正是 r1 被打回的那个错法。
          if (e.code !== 'ENOENT') before = { why: `could not be read before this edit (${e.code})` };
        }
        snapshots.set(fullPath, before);
      }
      fs.mkdirSync(path.dirname(fullPath), { recursive: true });
      fs.writeFileSync(fullPath, toolInput.content);
      // 🔴 #1104 r5 —— 这一行上有两张票的交付，两侧都要留。rebase 时它们冲突在同一行上而已，
      // 取一侧就是静默删掉另一张票的东西。
      //   · `path`         #1102 加的（`5ccfb541`）。**它在本文件里没有消费者** —— 整个返回值被
      //                    `JSON.stringify` 塞进发回模型的 `tool_result`，所以它是给模型看的那一份
      //                    回执里的一个字段。📌 `5ccfb541` 在这一行上的注释说它是「回滚名单」的来源，
      //                    而回滚名单实际来自上面那个 `snapshots`（键是 `fullPath`）；我 grep 过本文件
      //                    里 `result.` 的全部消费点，只有 `result.success` 一处。那句注释归 #1102，
      //                    本票不改它，但别照它推断这一行的用途。
      //   · `sideEffects`  本票加的：放行之后要把「菜单也会跟着变」这类后果说给老板听。
      const written = `Written ${relPath}`;
      return {
        success: true,
        path: relPath,
        message: sideEffects.length ? `${written}\n\n${sideEffects.join('\n\n')}` : written,
      };
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

// 🔴 下面那份提示词里的 `Available section types:` 一行，必须逐项等于
//    `src/lib/sections/registry.ts` 的键集合。行里出现注册表没有的名字时，模型照着写出来的块会走
//    `SectionRenderer.tsx:19-21` 的未知类型那一支（`console.warn` + `return null`）——
//    **那一块在页面上直接不出现，而构建是绿的**。
//    #1162 现取时它漂了两个方向：清单里有 `values-grid` / `benefits-list` / `checklist` /
//    `service-highlights` 四个已并入 `card-group` 的老名字，而注册表里的 `card-group` /
//    `contact-form` / `service-related-pages` 三个**从来没进过这份清单**（也就是说在此之前模型
//    从没被告知通用块存在）。两个方向都在本票里改齐了。改注册表的人要回来改这一行。
//    📌 「把它改成从注册表派生」已按 AC3 记进第 24 批台账 —— 那是换机制，不在本票射程里。
//    🔴 这段话曾经被写在**提示词里面**（本票上一轮）。两个后果，第二个是硬的：
//       ① 它是给人看的开发注释，写在那里就等于发给模型；
//       ② 它带反引号，而提示词是一个模板字符串 ⟹ `edit-site.js` 整个文件**语法错误**，
//          `node --check` 当场红，而症状是 `edit-site-chain.test.js` 那 36 格全部读到「事件是空的」。
//       所以：给提示词写说明，注释放在模板字符串外面。
const SYSTEM_PROMPT = `You are an AI website editor. You modify static website configuration files to fulfill user requests.

## Site Structure

The site is defined by JSON configuration files:

- **brand.json** — Company name, tagline, logoIcon, logoUrl (the logo image — see "Images" below), color palette (primary 50-900 shades, accent 50-600 shades), fonts (googleFontsUrl, families), email, phone, locations, socialLinks
- **seo.json** — Domain, locale, meta title/description, keywords, Schema.org config
- **services.json** — Array of services with id, name, shortDescription, fullDescription, icon, features, products
- **pages/home.json** — Homepage sections
- **pages/{slug}.json** — Other pages (about, services, quote, menu, gallery, faq, etc.)
- **navigation.json** — **partly yours to edit.** You MAY change the header button (header.cta — its
  label and href; it is the button at the top of every page and in the mobile menu), the footer
  copyright, the footer description, the footer column titles, and the topbar. This is the only place in
  the product where the header button can be changed, so when the owner asks for it, change it here.
  You MAY NOT change the header menu links or the first footer column's links, and you may not add or
  remove footer columns: those are rebuilt on every build and anything you write there is overwritten.
  The menu links and the first footer column's links come from each page's navLabel / navOrder — to
  change one of those entries, change that page's navLabel; to reorder them, change its navOrder. How
  many footer columns there are is a different thing and navLabel / navOrder will not change it: the
  build adds one extra column per service that has keyword pages, so the number of columns cannot be
  set from here at all. When the owner asks for one of those three, tell them which page (or which
  keyword pages) to change and change it for them; do not point them at a settings screen, there is
  none. write_file refuses the whole write if you touch any of them, so write the
  complete file with those parts exactly as you read them.
  Keep every field that is already in the file, with the same kind of value. The build reads all of
  them, so deleting one (or turning a piece of text into something that is not text) stops the site
  from building at all. When the owner wants the copyright line or the footer blurb to disappear, set
  it to an empty string "" — do not remove the field.

You can also write **blog/{slug}.json** (articles) and **blocks/site-blocks.json** (content blocks reused
across pages — its shape is described under "Site-Wide Blocks" below). In a multi-language site every file
above except brand.json lives under **{locale}/**.

Everything else you may see under the site directory is owned elsewhere and **write_file will refuse it**:
theme.json and theme.css (the theme picker in the dashboard), custom.css (generated from theme.json),
site_meta.json (the site's id and languages, fixed when the site was created), page-layout.json (which page
layout the site uses — nothing in the product changes it today). Do not try to change the site's look by
writing those — change colors and fonts in brand.json.

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

Available section types: hero, trusted-brands, features-grid, card-group, testimonials, cta-banner, contact-info, text-block, page-header, services-nav, services-list, quote-form, contact-form, stats-counter, faq-accordion, process-steps, team-grid, pricing-table, gallery, logo-carousel, content-split, feature-comparison, social-proof, divider, announcement-bar, timeline, newsletter-signup, map-area, awards-certifications, blog-preview, service-related-pages

Hero variants: left, centered, split, minimal, video-style, gradient-overlay, light-split, light-editorial, light-showcase
(dark full-bleed: left, centered, split, video-style, gradient-overlay · light background: minimal, light-split, light-editorial, light-showcase)

## Images

Every picture on the site is a URL sitting in one of these fields. There are no others — a block of any
other type does not show a picture, and putting an image field on one has no effect:

- **brand.json** → \`logoUrl\` — the logo in the header and the footer. Also set \`logoHasWordmark\`: true
  when the image already contains the company name (the name is then not drawn as text next to it), false when
  it is an icon only.
- a **hero** block → \`data.imageUrl\`
- a **content-split** block → \`data.imageUrl\`
- a **gallery** block → \`data.items[].imageUrl\` (one per item)

🔴 **Only ever write an image URL that was given to you** — one listed under "Attached images" at the end of
the owner's message, one the owner typed out, or one already in this site's files. **Never invent, guess,
complete or reconstruct an image address, and never link to a stock-photo site or any other outside source.**
An address nobody gave you does not exist: it renders as a broken image on the owner's live site, and
write_file refuses the whole write when it sees one.

When the owner attaches photos you are shown the pictures **and**, at the end of their message under "Attached
images", the URL of each one as text, in the same order. Those URLs are public and do not expire. Copy the one
they mean, verbatim, into the field above that matches what they asked for — that is all "use this photo"
takes. Never tell the owner to upload the picture again or to send you a link: they already did, the link is
in front of you, and asking again is asking them to redo work they have already finished.

Which one, when several are attached: they are listed in the order they were sent. If the request is about one
spot, use the one that best matches what they asked for, and **always name the file you used in your reply** so
the owner can correct you in one line. If the request is about several spots (a gallery, "add these photos"),
use them all in the order listed.

If the owner asks you to change a picture and there is no attachment and no URL in the files, say so plainly
and ask them to attach the photo to their next message. Do not put any other address in the field.

Example — swapping the picture of a content-split block in pages/about.json:
\`\`\`json
{ "id": "about-advisor", "type": "content-split", "role": "optional", "region": "content", "weight": 20,
  "data": { "headline": "Your private wealth advisor",
            "imageUrl": "https://uploads.example.com/8f3c1d2ab_advisor-photo.jpg" } }
\`\`\`

## Site-Wide Blocks (blocks/site-blocks.json)

A block that appears on more than one page lives in **blocks/site-blocks.json** instead of being copied into
each page. The file is a JSON **object** that maps an id to one block — not an array:

\`\`\`json
{
  "shared-cta": {
    "type": "cta-banner",
    "visibility": ["*"],
    "weight": 90,
    "data": {
      "headline": "Ready to get started?",
      "description": "Tell us what you need and we will get back to you the same day.",
      "button": { "label": "Get a quote", "href": "/quote" }
    }
  }
}
\`\`\`

Each value is a block with the same fields as a page block, plus \`visibility\`:

- \`type\` — **required, and every value must carry its own.** A \`{ "ref": "<id>" }\` entry belongs in a
  page's \`blocks\` array, never as a value in this file: a value without a \`type\` stops the site from
  building at all.
- \`visibility\` — array of page slugs the block appears on; \`["*"]\` means every page. Leave it out and the
  block only shows on pages that point at it with \`{ "ref": "<id>" }\`.
- \`weight\` — where it sits on the page (smaller first). A page that puts \`{ "ref": "<id>" }\` at a specific
  spot in its own \`blocks\` array wins over this.
- \`role\`, \`block_layout\`, \`data\` — same meaning as in a page block.

To put a site-wide block at an exact position on one page, add \`{ "ref": "<id>" }\` to that page's \`blocks\`
array. \`data\` is checked against the block's manifest exactly as it is inside a page, so a missing required
slot or a list slot that is not a list is refused here too.

## Rules

1. You MUST call read_file to check current file contents before responding — never rely on conversation history to know file state
2. Only call write_file if changes are actually needed. Only claim changes were made if you called write_file
3. Write the COMPLETE file content (not partial updates)
4. All written content must be valid JSON
5. Keep content SEO-friendly and professional
6. When adding sections, follow existing data patterns from the file
7. Preserve all existing fields you don't need to change
8. Images: only ever write an image URL that was attached to this message, typed by the owner, or already in the site's files — never invent one and never use a stock-photo site. The complete list of fields that show a picture is under "Images" above
9. Chinese language sites: Check the site's locale field in seo.json. Locale matching is case-insensitive. If locale matches Simplified ("zh", "zh_CN", "zh-CN") → use ONLY Simplified Chinese characters (mainland China convention, 简体) in all content. If locale matches Traditional ("zh-TW", "zh-tw", "zh_TW", "zh_tw", "zh-HK", "zh-hk", "zh_HK", "zh_hk") → use ONLY Traditional Chinese characters (Taiwan / Hong Kong convention, 繁體). Never mix Simplified and Traditional characters.`;

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
  // #1195 —— 附件的**地址**要当文本一起发。管道早就把图片送到模型眼前了（TICKET-093），
  // 但那是 `{ type:'image', source:{ type:'url', url } }` —— 模型看得见画面，**看不见那个 url
  // 字符串**：实测同一个模型（claude-sonnet-4-6）只发图片块再问「你刚收到的图片地址是什么」，
  // 答的是 `NO_URL_AVAILABLE`。所以「你可以把附件的 URL 写进配置」这句话在提示词里写多少遍都没用，
  // 那个 URL 从来没到过它手里 —— 这是本票那个症状（看得见却用不上）真正缺的那一半。
  // 🔴 没有附件时这一支一个字节都不变（`attachedImagesNote([])` 返回空串，这里连碰都不碰它）。
  const userContent = images.length > 0
    ? [
        { type: 'text', text: message + imageUrls.attachedImagesNote(images) },
        ...images.map(img => ({ type: 'image', source: { type: 'url', url: img.url } })),
      ]
    : message;
  // #1195 —— 这次写入放行哪些图片地址。四类来源见 lib/image-urls.js 的文件头；整轮算一次。
  const allowedImageUrls = imageUrls.collectAllowedImageUrls({
    siteDir, images, message, conversationHistory,
  });
  const messages = [
    ...conversationHistory,
    { role: 'user', content: userContent },
  ];

  let totalInputTokens = 0;
  let totalOutputTokens = 0;
  let filesModified = false;
  // #1102 —— 这次编辑真正写出去的那几个路径（相对 `siteDir`）。同步失败时按这份名单回滚，
  // 好让「This change was not saved」这句话在磁盘上也成立。Set：同一个文件被改两次只算一个。
  // #1102 —— 键 = 这次 write_file 真正写出去的路径，值 = 它**被写之前**的字节
  // （`null` = 本次新建）。同步失败时按它回滚，见 rollbackWrittenFiles。
  const writeSnapshots = new Map();
  let commitHash = '';
  // #1164 —— 归档推送（`git push`）失败时那句话。它跟 commitHash 是两个独立的事实：改动已经在容器里
  // commit 了（预览照常），但没进 GitHub。以前这两件事都被下面那个 catch 咽掉，`edit-complete` 照样
  // 带着 commitHash 发出去，任务侧和用户侧都看起来成功 —— 2026-08-23 四次编辑就是这样丢掉的。
  let archiveError = '';

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

        const result = executeTool(block.name, block.input, siteDir, writeSnapshots, allowedImageUrls);

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
      // #1087 —— `syncError` 非空 = 这次编辑写出来的东西构建不出来。以前这里只有一行 debug（进容器
      // stderr，谁都看不到），而下面那段 git add -A && commit && push 在**另一个 try 里、无条件地**跑
      // ⟹ 「同步失败」与「保存成功」可以同时成立，坏值进了站仓，界面上显示的是 Changes applied.
      // 站仓就是这个站的真相来源，一旦坏值落进去，它以后的每一次构建都是死的。
      // 所以这个变量把两件事串起来：① 失败要说出来（下面变成一条 error 事件）② 失败就不许再保存。
      let syncError = null;
      if (filesModified) {
        emit('progress', { message: 'Syncing changes to preview...' });
        try {
          execSync('node scripts/sync-config.js', {
            cwd: rootDir,
            stdio: ['pipe', 'pipe', 'pipe'],
          });
          debug('sync-config.js sync complete');
        } catch (e) {
          // sync-config 把「哪里不对」写在 stderr（`console.error` + `process.exit(1)`），优先取 stderr。
          // 🔴 #1134 —— 这里原来给的理由是「而 `e.message` **只有一句 "Command failed"**」，
          //    **那是假的**。`execSync` 抛的 `e.message` 逐字是
          //        Command failed: <整条命令>\n\n<stderr 原文>
          //    stderr 就在里面（实测：拿一个只往 stderr 写字再 exit(1) 的子进程量，
          //    `String(e.message).includes(<那句话>)` === true）。
          //    代码本身没问题（优先取 stderr 更干净：没有那行命令回显、没有 node 自己的栈），
          //    错的只是给它的那个理由 —— 而这句理由恰好是 #1103 新增那一格判据的来源，
          //    所以它值得被更正，不然下一个人会据「message 里没有」去推别的结论。
          syncError = String((e.stderr && e.stderr.toString().trim()) || e.message || '').slice(0, 2000);
          debug(`sync-config.js sync error: ${e.message}`);
        }
      }

      // 🔴 下面这一整段（预览健康检查 + 自动保存）只在同步成功时跑。同步失败时 `out/` 没被重建、
      // 预览还是上一版，没有什么要等它热更新的；而**保存必须跳过**——那是本票要治的那一半。
      if (filesModified && !syncError) {
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
          // #1164 —— 推送自己一个 try。它失败的意思是「本地存下了、GitHub 上没有」，跟 commit 失败
          // （什么都没存下）是两回事，处置也不同：这里不回滚、不报错误，只把这句话带到用户面前。
          // 令牌会出现在 git 的报错里（remote URL 就带着它），所以打印前先抹掉。
          try {
            execSync('git push origin main', { cwd: rootDir, stdio: ['pipe', 'pipe', 'pipe'] });
            debug(`git commit + push complete (${commitHash})`);
          } catch (pushErr) {
            const raw = (pushErr.stderr ? pushErr.stderr.toString() : '') || pushErr.message || 'unknown error';
            archiveError = raw.replace(/x-access-token:[^@]*@/g, 'x-access-token:***@').trim().slice(0, 500);
            debug(`git push FAILED — saved locally as ${commitHash} but NOT archived to GitHub: ${archiveError}`);
          }
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

      // #1087 —— 同步失败 ⟹ 这次编辑的终态是失败，不是 `edit-complete`。`error` 在 manager 那边是
      // 终态事件（`manager/edit.go` 里 `if eventType == "error"` 那一支），它会被推到老板的聊天窗口。
      //
      // 🔴 这里【不】走 `fatal()`（那个 helper 会 `process.exit(1)`）。理由是量出来的：worker 在
      // `cmd.Wait()` 报错时会再发一条自己的 error 并**覆盖** `last-event:<editID>`
      // （`worker/main.go` 里 `errMsg = fmt.Sprintf("Edit failed: %v", err)` 那三行），内容是一句
      // 没有信息的 "Edit failed: exit status 1"。实时那条 SSE 连接读到的是下面这条没错，但浏览器
      // 断线重连走的是 catch-up 那条路（manager 那边 `rdb.Get(ctx, "last-event:"+editID)`）——
      // 于是「哪里不对」在重连之后就没了。本票要治的正是「失败说不清楚」，所以这里正常返回，
      // 让这条带原因的事件留在 `last-event` 里。
      // （行号有意不写：这两处在别的仓/别的文件里，会漂；上面那几个字符串是当场 grep 得到的锚点。）
      if (syncError) {
        // #1102 —— 先把这次写出去的文件退回上一次提交的样子，**再**说那句话。顺序是承重的：
        // 「没有保存」这句话的真假取决于磁盘上还剩什么（下一次成功编辑的 `git add -A` 读的是磁盘），
        // 所以要么先让它成立、要么就别那么说。理由整段在 rollbackWrittenFiles 上面。
        const rb = rollbackWrittenFiles(siteDir, writeSnapshots);
        debug(`#1102 rollback: restored ${rb.restored.length} · removed ${rb.removed.length}`
          + ` · failed ${rb.failed.length}${rb.failed.length ? ' — ' + rb.failed.join(' | ') : ''}`);
        // 🔴 退不掉的时候**改口**，不硬说那句话（这是本票要治的那个毛病本身：跟老板说的话后来变成
        // 假的而没人被告知）。退不掉 = 那几个文件还带着这次的改动躺在工作树上，下一次成功的编辑
        // 会把它们一起提交。
        emit('error', {
          message: rb.failed.length
            ? 'Rebuilding the site\'s configuration failed, so nothing was committed and the site still '
              + 'shows the previous version. ⚠️ This change could not be undone on disk either '
              + `(${rb.failed.join('; ')}), so it may be included the next time an edit is saved:\n\n`
              + syncError
            : 'This change was not saved. Rebuilding the site\'s configuration failed, so nothing '
              + 'was committed, the change was rolled back and the site still shows the previous '
              + 'version:\n\n' + syncError,
        });
        debug(`Edit aborted (sync failed): ${totalInputTokens} in / ${totalOutputTokens} out, cost $${cost.toFixed(4)}`);
        return;
      }

      // #1164 —— 归档失败要让站主看见。`message` 是 manager 存成聊天里那条 assistant 回复的字段
      // （manager/main.go dispatch 那段 `evt["message"]`），所以把这句话接在它后面，用户在聊天里
      // 就读得到；`archiveFailed` / `archiveError` 给机器读。预览行为不变：改动已经在本地存下了。
      const archiveNotice = archiveError
        ? '\n\nNote: this change is saved in your preview but could NOT be archived to GitHub yet, '
          + 'so it is not backed up. Your next successful save will push it along with this one.'
        : '';
      emit('edit-complete', {
        message: finalMessage + archiveNotice,
        ...(commitHash ? { commitHash } : {}),
        ...(archiveError ? { archiveFailed: true, archiveError } : {}),
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
