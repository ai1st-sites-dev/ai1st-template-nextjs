#!/usr/bin/env node
'use strict';
// #1802 —— 同一份站 JSON 走两条路，出来的网页逐页比：
//   ① 今天的 Next 发布构建（`npm run build`，`next.config.js` 只在 publish 模式开 `output:'export'`）
//   ② 新的 `scripts/site.js render --target live`
// 两边的 <head> 和正文归一化之后比；归一化的每一条都是下面 §WHITELIST 里的一条，带理由。白名单外任何差异 ⟹ 退出码 1。
//
//   node scripts/render-diff.js --fixture <夹具名或 .json 路径> [--mutate drop-block|jsonb-reorder] [--next-out <目录>] [--keep]
//     --fixture    `scripts/fixtures/site-fixtures/<名>.json`（写名字就行：site-bbc4ff97 / site-multilang / site-blog / site-rtl …）
//     --mutate     只改新路那一侧的输入（变异臂）：
//                    drop-block     删掉默认语言首页的第一个块 ⟹ 必须红（尺子读得出差异）
//                    jsonb-reorder  每个 JSON 对象的键按 Postgres jsonb 的规则重排（先按长度、再按字节）⟹ 必须仍绿
//                                   （库里读回来就是这个次序；渲染不能依赖键序）
//     --next-out   直接用一份已经构建好的 Next 产物（`out/<SITE_CONFIG>/` 那一层），不再构建 —— 同一个夹具跑变异臂时省一次 next build。
//                  🔴 它必须是**同一个夹具、同一份模板代码**构建出来的，脚本不替你核。
//     --keep       不删临时目录（打印路径），方便人去翻两边的产物。
//
// 🔴 它跑 `next build`（一个站 40 秒上下），**不做成 *.test.js**：`template-scripts` 那个 CI 任务已经 1282 / 1298 秒、上限 2160。
//    手跑，输出贴票。
//
// 两边输入喂同值（不然这几处天然不同，跟渲染对不对无关）：
//   · Search Console：Next 那侧把夹具每个语言 seo.json 的 `verification.google` 改成 §GSC_TOKEN；render 侧 `--gsc-token` 给同一个
//   · 线索 / 聊天地址：Next 侧 env `NEXT_PUBLIC_LEAD_API`，render 侧 `--lead-api`，同一个 §LEAD_API
//   · 站点地址：Next 侧 env `SITE_URL`，render 侧 `--site-url`，同一个 §SITE_URL
//   · siteId：两边都用夹具 site_meta.json 自己那个（render 侧不传 `--site-id`）
//   · 年份：页脚 `© ${new Date().getFullYear()}`（`blocks/footer/Section.tsx`）两边同一时刻跑，相同；夹具自己写死了 © 2026
const fs = require('fs');
const os = require('os');
const path = require('path');
const cp = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const FIXTURES = path.join(ROOT, 'scripts', 'fixtures', 'site-fixtures');
const GSC_TOKEN = 'render-diff-gsc-token';
const LEAD_API = 'https://lead.render-diff.example';
const SITE_URL = 'https://render-diff.example';
const SITE_CONFIG = 'render-diff';

// ── 白名单：每条一个名字、一句理由。归一化代码里每用一次就记一次数，最后打出来 —— 一条从来没触发过的规则也看得见。──
const WHITELIST = {
  'next-runtime': 'Next 自己的运行时：`/_next/static/` 下的 chunk 脚本、它们的 preload、`noModule` 的 polyfill、`self.__next_f` RSC 载荷。新路没有 Next；页面上要跑的 JS 是 runtime（下一条）',
  'platform-runtime': '新路才有：`/_platform/runtime.<哈希>.js`（岛 + Bootstrap，#1798），替代上一条那些 chunk',
  'next-metadata-outlet': 'Next 在 <body> 开头放的 `<div hidden><!--$--><!--/$--></div>`（metadata 的流式出口，空的）',
  'html-comments': 'React 的流式标记 `<!--$-->` / `<!--/$-->` 和文本分隔 `<!-- -->`（岛那一段用 renderToString，它也插 `<!-- -->`）。不进 DOM 的可见内容',
  'style-preload-hints': 'React 19 在 Next 下给 <head> 里每个样式表多出一条 `<link rel="preload" as="style">`（同一批地址，各自的 stylesheet 还在）',
  'attr-order-case': '属性的先后和名字大小写（`charSet` / `charset`）：HTML 里都不影响语义',
  'whitespace': '文本里连续空白折成一个空格（HTML 渲染本来就这么折）',
  'head-order': '<head> 里 meta / title / link（样式表除外）的先后：Next 按它自己的 metadata 次序插，语义不依赖次序。🔴 样式表的先后**照样逐条比**（次序就是层叠）',
  'globals-css-path': '`globals.css`：Next 打包成 `/_next/static/css/<哈希>.css`；新路是平台文件 `/_platform/css/globals.<内容哈希>.css`（决定 13）。内容见 §compareCss',
  'base-shapes-css-path': '`/base.css`、`/shapes.css` → `/_platform/css/<名>.<内容哈希>.css`：`_platform/` 一年 immutable 缓存，固定名等于发版改了它老板一年看不到',
  'site-css-path': '`/site.css` → `/_platform/css/<缓存键>.css`（T2a-1 §siteCssKey；同一个有效主色全平台编一次）。内容见 §compareCss',
  'version-meta': '新路才有：`<meta name="ai1st-version" content="vN">`（T2c / 设计文档 §14 / e2e 在 live 上读它判版本）',
  'editor-nav-script': '删：`ai1st:nav`（TICKET-131）—— 页面在 dashboard 预览 iframe 里时报告地址。新架构的画布在 dashboard 本地画（设计文档 §5.5）',
  'editor-theme-preview-script': '删：换主题预览监听器（`ai1st:theme-preview*`，#925 / #978 / #1123 / #1318 / #1669）—— 编辑器 iframe 用，本来就只对 leadApi 的 origin 回话',
  'editor-probe-script': '删：编辑器探针（`ai1st:editor-ping`，#1409）—— 同上',
  'island-wrapper': '新路才有：岛（#1798）外面那层 `<div data-island style="display:contents">` 和紧跟的 `<script type="application/json" data-island-props>`。`display:contents` 不参与排版；里面那段 HTML 照样逐字比',
  'file-name-mapping': 'Next 导出没开 trailingSlash，出的是 `about.html`；新路是 `about/index.html`。按地址对齐再比',
  'next-only-files': 'Next 才有的文件：`_next/**`、`*.txt` RSC 载荷（llms.txt / robots.txt 除外）、`~editor/**`（编辑器路由，T1 搬进 dashboard）、`_not-found.html`（跟 404.html 逐字节相同，脚本核）、空博客时的 `blog/_.html`（动态段占位，页面是空的 <body>）、`themes/*.css`（只有被删掉的换主题预览脚本去取）、根目录的 `base.css` / `shapes.css` / `site.css`（换成了 `_platform/` 下的，内容比对见 §compareCss）',
  'sitemap-lastmod': 'sitemap.xml 的 `<lastmod>`：Next 侧来自临时树里文件的改动时间（没有 git），新路来自 `--last-modified`（T2c 从 site_versions 取，这里没给 = 渲染时刻）。两边必然不同；其余逐字比',
  'globals-css-minified': '`globals.css` 的内容：Next 用它自己的 CSS 管线压缩过（去空白 / 注释、合并写法），新路原样出源文件。规则集合的比对不在本脚本射程里',
};
const hits = Object.fromEntries(Object.keys(WHITELIST).map((k) => [k, 0]));
const hit = (rule, n = 1) => { if (!(rule in hits)) throw new Error(`未登记的白名单规则 ${rule}`); hits[rule] += n; };

// ── 一个只认「React 产出的 HTML」的小解析器（两边都是 React 输出：属性一律双引号、没有省略的结束标签）──────────────
const VOID = new Set(['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'source', 'track', 'wbr']);
const RAW = new Set(['script', 'style']);
function parseHtml(html) {
  const root = { tag: '#root', attrs: {}, children: [] };
  const stack = [root];
  let i = 0;
  const top = () => stack[stack.length - 1];
  while (i < html.length) {
    if (html.startsWith('<!--', i)) {
      const end = html.indexOf('-->', i + 4);
      top().children.push({ comment: html.slice(i + 4, end) });
      i = end + 3;
    } else if (html.startsWith('<!', i)) {
      i = html.indexOf('>', i) + 1;
    } else if (html.startsWith('</', i)) {
      const end = html.indexOf('>', i);
      const name = html.slice(i + 2, end).trim().toLowerCase();
      while (stack.length > 1 && top().tag !== name) stack.pop();
      if (stack.length > 1) stack.pop();
      i = end + 1;
    } else if (html[i] === '<' && /[a-zA-Z]/.test(html[i + 1] || '')) {
      const m = /^<([a-zA-Z][a-zA-Z0-9:-]*)/.exec(html.slice(i, i + 64));
      const tag = m[1].toLowerCase();
      let j = i + m[0].length;
      const attrs = {};
      for (;;) {
        while (/\s/.test(html[j])) j++;
        if (html[j] === '>' || html.startsWith('/>', j)) break;
        const am = /^([^\s=/>]+)(?:="([^"]*)")?/.exec(html.slice(j, j + 4096));
        if (!am) throw new Error(`解析不了的属性：${html.slice(j, j + 80)}`);
        attrs[am[1].toLowerCase()] = am[2] === undefined ? '' : am[2];
        j += am[0].length;
      }
      const selfClose = html.startsWith('/>', j);
      j += selfClose ? 2 : 1;
      const el = { tag, attrs, children: [] };
      top().children.push(el);
      if (RAW.has(tag) && !selfClose) {
        const end = html.indexOf(`</${tag}>`, j);
        el.children.push({ text: html.slice(j, end) });
        i = end + tag.length + 3;
      } else {
        if (!VOID.has(tag) && !selfClose) stack.push(el);
        i = j;
      }
    } else {
      let end = html.indexOf('<', i);
      if (end === -1) end = html.length;
      top().children.push({ text: html.slice(i, end) });
      i = end;
    }
  }
  return root;
}

const find = (node, tag) => (node.tag === tag ? node : (node.children || []).map((c) => c.tag && find(c, tag)).find(Boolean));
const scriptText = (el) => (el.children[0] && el.children[0].text) || '';

/** 一侧的一个节点：返回替换后的节点数组（[] = 删掉）。 */
function normalizeNode(node, side) {
  if (node.comment !== undefined) { hit('html-comments'); return []; }
  if (node.text !== undefined) {
    const t = node.text.replace(/\s+/g, ' ');
    if (t !== node.text) hit('whitespace');
    return t === '' ? [] : [{ text: t }];
  }
  const { tag, attrs } = node;
  if (side === 'next') {
    if (tag === 'script' && /\/_next\//.test(attrs.src || '')) { hit('next-runtime'); return []; }
    if (tag === 'script' && /self\.__next_f/.test(scriptText(node))) { hit('next-runtime'); return []; }
    if (tag === 'link' && attrs.rel === 'preload' && /\/_next\//.test(attrs.href || '')) { hit('next-runtime'); return []; }
    if (tag === 'script' && /"ai1st:nav"/.test(scriptText(node))) { hit('editor-nav-script'); return []; }
    if (tag === 'script' && /ai1st:theme-preview/.test(scriptText(node))) { hit('editor-theme-preview-script'); return []; }
    if (tag === 'script' && /ai1st:editor-ping/.test(scriptText(node))) { hit('editor-probe-script'); return []; }
    if (tag === 'div' && 'hidden' in attrs && node.children.every((c) => c.comment !== undefined)) { hit('next-metadata-outlet'); return []; }
  } else {
    if (tag === 'meta' && attrs.name === 'ai1st-version') { hit('version-meta'); return []; }
    if (tag === 'script' && /^\/_platform\/runtime\.[0-9a-f]{16}\.js$/.test(attrs.src || '')) { hit('platform-runtime'); return []; }
    if (tag === 'script' && 'data-island-props' in attrs) { hit('island-wrapper'); return []; }
    if (tag === 'div' && 'data-island' in attrs && attrs.style === 'display:contents') {
      hit('island-wrapper');
      return node.children.flatMap((c) => normalizeNode(c, side));
    }
  }
  if (tag === 'link' && attrs.rel === 'preload' && attrs.as === 'style') { hit('style-preload-hints'); return []; }
  const a = { ...attrs };
  if (tag === 'link' && a.rel === 'stylesheet') {
    const h = a.href || '';
    if (side === 'next' && /^\/_next\/static\/css\/[0-9a-f]+\.css$/.test(h)) { a.href = '{globals.css}'; delete a['data-precedence']; hit('globals-css-path'); }
    if (side === 'render' && /^\/_platform\/css\/globals\.[0-9a-f]{16}\.css$/.test(h)) { a.href = '{globals.css}'; hit('globals-css-path'); }
    if ((side === 'next' && /^\/(base|shapes)\.css$/.test(h)) || (side === 'render' && /^\/_platform\/css\/(base|shapes)\.[0-9a-f]{16}\.css$/.test(h))) {
      a.href = `{${/(base|shapes)/.exec(h)[1]}.css}`; hit('base-shapes-css-path');
    }
    if ((side === 'next' && h === '/site.css') || (side === 'render' && /^\/_platform\/css\/[0-9a-f]{64}\.css$/.test(h))) { a.href = '{site.css}'; hit('site-css-path'); }
  }
  if (tag === 'script' && 'nomodule' in a) { hit('next-runtime'); return []; }
  const children = RAW.has(tag) ? node.children : node.children.flatMap((c) => normalizeNode(c, side));
  // 相邻文本并起来（删掉注释之后，`a<!-- -->b` 两边会拆成不同的文本段）
  const merged = [];
  for (const c of children) {
    const last = merged[merged.length - 1];
    if (c.text !== undefined && last && last.text !== undefined) merged[merged.length - 1] = { text: (last.text + c.text).replace(/\s+/g, ' ') };
    else merged.push(c);
  }
  return [{ tag, attrs: a, children: merged }];
}

function serialize(node) {
  if (node.text !== undefined) return node.text;
  const keys = Object.keys(node.attrs).sort();
  const attrs = keys.map((k) => ` ${k}="${node.attrs[k]}"`).join('');
  if (VOID.has(node.tag)) return `<${node.tag}${attrs}>`;
  return `<${node.tag}${attrs}>${node.children.map(serialize).join('')}</${node.tag}>`;
}

/** 一页 → 比较用的几行：<html> 的属性、head 里的样式表（按次序）、head 里其余元素（排序）、body 一行一个顶层元素。 */
function pageLines(html, side) {
  const tree = parseHtml(html);
  const htmlEl = find(tree, 'html');
  const head = find(htmlEl, 'head');
  const body = find(htmlEl, 'body');
  hit('attr-order-case');
  const headNodes = head.children.flatMap((c) => normalizeNode(c, side)).filter((c) => c.tag);
  const sheets = headNodes.filter((n) => n.tag === 'link' && n.attrs.rel === 'stylesheet').map(serialize);
  const rest = headNodes.filter((n) => !(n.tag === 'link' && n.attrs.rel === 'stylesheet')).map(serialize);
  const sorted = [...rest].sort();
  if (sorted.join('\n') !== rest.join('\n')) hit('head-order');
  const bodyNorm = normalizeNode({ ...body, children: body.children }, side)[0];
  return [
    `<html${Object.keys(htmlEl.attrs).sort().map((k) => ` ${k}="${htmlEl.attrs[k]}"`).join('')}>`,
    ...sheets.map((s) => `head/sheet ${s}`),
    ...sorted.map((s) => `head ${s}`),
    `<body${Object.keys(bodyNorm.attrs).sort().map((k) => ` ${k}="${bodyNorm.attrs[k]}"`).join('')}>`,
    ...bodyNorm.children.map((c) => `body ${serialize(c)}`),
  ];
}

/** 两组行的差：返回人读的几段（最多 limit 段），空数组 = 相同。 */
function diffLines(a, b, limit = 6) {
  const out = [];
  const n = Math.max(a.length, b.length);
  for (let i = 0; i < n && out.length < limit; i++) {
    if (a[i] === b[i]) continue;
    const x = a[i] || '(没有)';
    const y = b[i] || '(没有)';
    let k = 0;
    while (k < x.length && x[k] === y[k]) k++;
    const from = Math.max(0, k - 120);
    out.push(`  第 ${i + 1} 行，第 ${k} 个字符起不同：\n    Next  : …${x.slice(from, k + 200)}\n    render: …${y.slice(from, k + 200)}`);
  }
  if (a.length !== b.length && out.length < limit) out.push(`  行数不同：Next ${a.length} · render ${b.length}`);
  return out;
}

// ── 输入 ─────────────────────────────────────────────────────────────────────────────────────────────────────────
function fixturePath(name) {
  if (name.endsWith('.json') && fs.existsSync(name)) return path.resolve(name);
  const p = path.join(FIXTURES, `${name.replace(/\.json$/, '')}.json`);
  if (!fs.existsSync(p)) throw new Error(`没有这个夹具：${p}`);
  return p;
}

/** Postgres jsonb 的键序：先按 UTF-8 字节长度，再按字节。数组次序不动。 */
function jsonbOrder(v) {
  if (Array.isArray(v)) return v.map(jsonbOrder);
  if (!v || typeof v !== 'object') return v;
  const keys = Object.keys(v).sort((x, y) => {
    const bx = Buffer.from(x); const by = Buffer.from(y);
    return bx.length - by.length || Buffer.compare(bx, by);
  });
  return Object.fromEntries(keys.map((k) => [k, jsonbOrder(v[k])]));
}

function mutate(content, how) {
  if (!how) return content;
  if (how === 'jsonb-reorder') return jsonbOrder(content);
  if (how === 'drop-block') {
    const meta = typeof content['site_meta.json'] === 'string' ? JSON.parse(content['site_meta.json']) : content['site_meta.json'];
    const rel = meta ? `${meta.defaultLocale}/pages/home.json` : 'pages/home.json';
    const home = JSON.parse(JSON.stringify(content[rel]));
    if (!home || !Array.isArray(home.blocks) || home.blocks.length === 0) throw new Error(`drop-block：${rel} 没有块可删`);
    const dropped = home.blocks.shift();
    console.log(`   变异：删掉 ${rel} 的第 1 个块（${dropped.type}${dropped.id ? ` #${dropped.id}` : ''}）`);
    return { ...content, [rel]: home };
  }
  throw new Error(`--mutate 只认 drop-block / jsonb-reorder：${how}`);
}

// ── Next 那一侧 ───────────────────────────────────────────────────────────────────────────────────────────────────
function buildNext(fixture, tmp) {
  const work = path.join(tmp, 'nextjs');
  fs.mkdirSync(work, { recursive: true });
  // 照 `create-site-all-locales.test.js` §makeTree：tar 到临时副本（create-site / derive 都写死在模板根，别碰开发者手上的 site/）
  cp.execSync(`tar --exclude=./node_modules --exclude=./out --exclude=./.next --exclude=./site --exclude=./public/photos --exclude=./render/dist -cf - . | tar -xf - -C "${work}"`, { cwd: ROOT, stdio: 'pipe' });
  fs.symlinkSync(path.join(ROOT, 'node_modules'), path.join(work, 'node_modules'));
  cp.execFileSync(process.execPath, [path.join(work, 'scripts', 'fixtures', 'site-fixtures', 'export-site-json.js'), 'to-dir', fixture, path.join(work, 'site')], { stdio: 'pipe' });
  for (const seoFile of listFiles(path.join(work, 'site')).filter((f) => /(^|\/)seo\.json$/.test(f))) {
    const abs = path.join(work, 'site', seoFile);
    const seo = JSON.parse(fs.readFileSync(abs, 'utf-8'));
    seo.verification = { ...(seo.verification || {}), google: GSC_TOKEN };
    fs.writeFileSync(abs, `${JSON.stringify(seo, null, 2)}\n`);
  }
  const log = path.join(tmp, 'next-build.log');
  const t0 = Date.now();
  const r = cp.spawnSync('npm', ['run', 'build'], {
    cwd: work, stdio: ['ignore', fs.openSync(log, 'w'), fs.openSync(log, 'a')], timeout: 15 * 60 * 1000,
    env: { ...process.env, SITE_CONFIG, SITE_URL, NEXT_PUBLIC_LEAD_API: LEAD_API, NEXT_TELEMETRY_DISABLED: '1', AI1ST_RENDER: '' },
  });
  if (r.status !== 0) throw new Error(`next build 失败（rc=${r.status}），日志：${log}`);
  console.log(`   next build ${((Date.now() - t0) / 1000).toFixed(1)} s`);
  return path.join(work, 'out', SITE_CONFIG);
}

function listFiles(dir, rel = '') {
  if (!fs.existsSync(path.join(dir, rel))) return [];
  return fs.readdirSync(path.join(dir, rel), { withFileTypes: true }).flatMap((e) => {
    const r = rel ? `${rel}/${e.name}` : e.name;
    return e.isDirectory() ? listFiles(dir, r) : [r];
  });
}

/** Next 的文件名 → 新路的文件名（null = Next 才有、白名单里那几样）。 */
function mapNextFile(rel, { blogEmpty }) {
  if (/^_next\//.test(rel) || /^~editor\//.test(rel) || /^themes\//.test(rel)) return null;
  if (/\.txt$/.test(rel) && rel !== 'llms.txt' && rel !== 'robots.txt') return null;
  if (rel === '_not-found.html' || rel === 'base.css' || rel === 'shapes.css' || rel === 'site.css') return null;
  if (rel === 'blog/_.html' && blogEmpty) return null;
  if (rel === 'index.html' || rel === '404.html') return rel;
  if (rel.endsWith('.html')) { hit('file-name-mapping'); return `${rel.slice(0, -'.html'.length)}/index.html`; }
  return rel;
}

async function main() {
  const args = process.argv.slice(2);
  const opt = (k) => { const i = args.indexOf(`--${k}`); return i >= 0 ? args[i + 1] : undefined; };
  const fixtureName = opt('fixture');
  if (!fixtureName) throw new Error('要给 --fixture <夹具名>');
  const fixture = fixturePath(fixtureName);
  const how = opt('mutate');
  const keep = args.includes('--keep');
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'render-diff-'));
  console.log(`render-diff：${path.relative(ROOT, fixture)}${how ? ` · 变异 ${how}` : ''}`);
  let failed = false;
  let tmpBundle = null;
  try {
    const nextOut = opt('next-out') ? path.resolve(opt('next-out')) : buildNext(fixture, tmp);
    const content = mutate(JSON.parse(fs.readFileSync(fixture, 'utf-8')), how);
    const renderOut = path.join(tmp, 'render');
    const { render } = require('./site');
    // 🔴 bundle 每一跑现打一份（#1802 QA2 退回 1）：`site.js render` 只在 `render/dist/manifest.json` **不存在**时才打，而 Next 那一侧
    //    每次都从当前源码构建 ⟹ 模板树里留着一份上次打的 `render/dist/`（跑过一次就有）时，比的是「新源码的 Next」对「旧源码的 render」，
    //    改坏了渲染层照样读绿（QA2 实测删掉聊天加载器 rc=0）。放进模板树（react 按产物位置解析）、只给这一跑用、跑完删。
    const bundleDir = path.join(ROOT, 'render', 'dist', `render-diff-${process.pid}`);
    tmpBundle = bundleDir;
    await require('./lib/render-bundle').buildRenderBundle({ outdir: bundleDir });
    const res = await render({ content, out: renderOut, bundleDir, siteUrl: SITE_URL, leadApi: LEAD_API, gscToken: GSC_TOKEN, version: 1, target: 'live', cacheDir: path.join(tmp, 'css-cache'), platformOut: path.join(tmp, 'platform') });
    console.log(`   render ${res.pages} 页 · ${(res.ms / 1000).toFixed(1)} s`);

    const nextFiles = listFiles(nextOut);
    const renderFiles = new Set(listFiles(renderOut));
    const blogEmpty = !nextFiles.some((f) => /^blog\/(?!_\.)[^/]+\.html$/.test(f));
    const pairs = [];
    const onlyNext = [];
    let nextOnlyAllowed = 0;
    for (const f of nextFiles) {
      const m = mapNextFile(f, { blogEmpty });
      if (m === null) { nextOnlyAllowed += 1; continue; }
      if (renderFiles.has(m)) { pairs.push([f, m]); renderFiles.delete(m); } else onlyNext.push(f);
    }
    if (nextOnlyAllowed) hit('next-only-files', nextOnlyAllowed);
    const onlyRender = [...renderFiles];
    const problems = [];
    if (onlyNext.length) problems.push(`只有 Next 出了、新路没出的文件：${onlyNext.join(', ')}`);
    if (onlyRender.length) problems.push(`只有新路出了、Next 没出的文件：${onlyRender.join(', ')}`);
    if (fs.existsSync(path.join(nextOut, '_not-found.html'))
      && !fs.readFileSync(path.join(nextOut, '_not-found.html')).equals(fs.readFileSync(path.join(nextOut, '404.html')))) {
      problems.push('Next 的 _not-found.html 跟 404.html 不一样了 —— 白名单 next-only-files 那条的前提不成立');
    }

    let pagesSame = 0;
    for (const [nf, rf] of pairs) {
      const a = fs.readFileSync(path.join(nextOut, nf), 'utf-8');
      const b = fs.readFileSync(path.join(renderOut, rf), 'utf-8');
      let d;
      if (rf.endsWith('.html')) d = diffLines(pageLines(a, 'next'), pageLines(b, 'render'));
      else if (rf === 'sitemap.xml') {
        const strip = (s) => s.replace(/<lastmod>[^<]*<\/lastmod>\n/g, () => { hit('sitemap-lastmod'); return ''; });
        d = diffLines(strip(a).split('\n'), strip(b).split('\n'));
      } else d = a === b ? [] : diffLines(a.split('\n'), b.split('\n'));
      if (d.length) problems.push(`${rf}（Next：${nf}）\n${d.join('\n')}`);
      else pagesSame += 1;
    }
    // §compareCss —— 换了地址的那几份，内容核一下：base / shapes / site.css 逐字节相同；globals 只核「两边都有」（Next 压缩过）。
    const plat = (re) => listFiles(path.join(tmp, 'platform')).find((f) => re.test(f));
    for (const [name, re] of [['base.css', /^_platform\/css\/base\./], ['shapes.css', /^_platform\/css\/shapes\./], ['site.css', /^_platform\/css\/[0-9a-f]{64}\.css$/]]) {
      const ours = plat(re);
      if (!ours) { problems.push(`平台文件里没有 ${name}`); continue; }
      if (!fs.readFileSync(path.join(nextOut, name)).equals(fs.readFileSync(path.join(tmp, 'platform', ours)))) problems.push(`${name} 的内容跟 Next 产物里那份不一样（${ours}）`);
    }
    if (!plat(/^_platform\/css\/globals\./) || !nextFiles.some((f) => /^_next\/static\/css\/[0-9a-f]+\.css$/.test(f))) problems.push('globals.css 有一侧没有');
    else hit('globals-css-minified');

    console.log(`   对上的文件 ${pairs.length} 份，逐份归一化之后相同 ${pagesSame} 份`);
    console.log('   白名单（规则 → 这一跑触发了几次）：');
    for (const [k, why] of Object.entries(WHITELIST)) console.log(`     ${String(hits[k]).padStart(5)}  ${k} —— ${why}`);
    if (problems.length) {
      failed = true;
      console.log(`\n🔴 白名单外的差异 ${problems.length} 处：`);
      for (const p of problems) console.log(`\n${p}`);
    } else {
      console.log('\n✅ 白名单外没有差异');
    }
  } finally {
    if (tmpBundle) fs.rmSync(tmpBundle, { recursive: true, force: true });
    if (keep) console.log(`   临时目录留着：${tmp}`);
    else fs.rmSync(tmp, { recursive: true, force: true });
  }
  process.exitCode = failed ? 1 : 0;
}

if (require.main === module) main().catch((e) => { console.error(`render-diff: ${e.stack || e}`); process.exitCode = 2; });

module.exports = { parseHtml, pageLines, jsonbOrder, WHITELIST };
