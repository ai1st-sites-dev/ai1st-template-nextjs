#!/usr/bin/env node
'use strict';
// #1802 / #1801 —— 站点脚本的命令行入口（设计文档 §3：`site.js <命令> …`）。#1802 加了 `render` 和它要的 `bundle`，#1801 加了编辑器那四条（下面）。
//
//   node scripts/site.js bundle [--out-dir <dir>]
//       打 `render/dist/`：整页渲染的 bundle + 平台文件（带内容哈希的三份样式表 + runtime）+ manifest。`render` 发现没打过会先打一次。
//
//   node scripts/site.js render --site <站 JSON> --out <目录> [选项]
//       站 JSON 进、整套静态网页出：每页 `index.html`、`404.html`、`sitemap.xml`、`robots.txt`、`llms.txt`、`theme.css`、`custom.css`，
//       模板自带的 `public/images/**`，给了 IndexNow key 时还有 `<key>.txt`。
//       --site-id <id>        覆盖 `site_meta.json` 的 siteId（线索表单、聊天小部件的 `?site=` 都取它）。没给才用 site_meta 的。
//       --geo <JSON | 文件>   `{lat, lng, address}`。address 跟 `brand.locations[0].address` 一样才合并进那一格的 geo（设计文档 §4.1）。
//       --site-url <地址>     这次发布到的站点根地址（canonical / og:url / sitemap / robots 都用它；绑了自定义域名就是那个域名）。
//       --lead-api <地址>     线索表单 + 聊天小部件打的 manager 地址。
//       --gsc-token <值>      Search Console 验证 meta。🔴 `seo.json` 里那份（建站写的是占位值 YOUR_GOOGLE_VERIFICATION_CODE）一律不用。
//       --indexnow-key <key>  写 `<key>.txt`（内容就是 key；跟 worker/indexnow.go §indexNowKeyFile 同一个规矩，不合格式就不写）。
//       --version <N>         每页 `<meta name="ai1st-version" content="vN">`。
//       --build-version <v>   平台 build 版本，进 site.css 的缓存键（T2a-1 §siteCssKey）。
//       --target live|preview preview：site.css 不剪、整站 noindex、robots.txt 全禁、不出 sitemap.xml。默认 live。
//       --cache-dir <目录>    site.css 按缓存键缓存在这里（命中就不编 Sass）。不给 = 不缓存、每次都编。
//                             🔴 缓存键里有 `--build-version`：平台发版换模板之后要换一个值，否则命中的是旧模板编出来的那份。
//       --last-modified <JSON | 文件>  `{ "<站内相对路径>": ISO 时间 }`，sitemap 的 <lastmod>（T2c 从 site_versions 取）。不给 = 渲染时刻。
//       --platform-out <目录> 把这个站要的平台文件（三份样式表、runtime、它的 site.css）拷到这里，按 `_platform/…` 的路径。
//                             不给就不拷 —— 平台文件由 deploy 传（T2c），站的输出目录里没有它们。
//       --bundle-dir <目录>   用这一份 bundle（`bundle --out-dir` 打的；必须在模板树里，react 这些包按它的位置解析）。不给 = render/dist。
//     标准输出：一行 JSON（`{"event":"rendered", …}`，含页数、平台文件清单、耗时）。派生的日志走标准错误。失败 ⟹ 退出码 1。
//
// #1801（T1）—— 编辑器那几条，manager spawn（工作目录 = 平台那份模板，`template.dir`），实现在 `lib/site-editor.js`：
//   node scripts/site.js editor-data --site <站 JSON> [--geo <JSON>] [--locale <语言>] [--page <slug>] [--cache-dir <目录>] [--build-version <v>]
//       --geo 是 `sites.geo`（`{lat, lng, address}`），并进第一家门店的规矩同上面 render 的 --geo。
//       编辑器的初始 props + 画布样式（theme.css / custom.css）+ site.css 的缓存键。`--site` 的内容是 null ⟹ {"ok":true,"content":null}。
//   node scripts/site.js save --site <站 JSON> --changes <编辑器那一笔> [--keep]
//       {"ok":true,"content":{…},"summary":"…","files":[…],"hash"?,"notice"?,"shared"?,"addressChanged"?}
//   node scripts/site.js site-css --site <站 JSON> [--cache-dir <目录>] [--build-version <v>]
//       {"ok":true,"key":"…","cached":true|false,"css":"…"}（不剪，画布用）
//   node scripts/site.js geocode --address <地址>
//       {"ok":true,"address":"…","lat":…,"lng":…}（查不到 lat / lng 是 null）
//   这四条的输出约定跟上面 bundle / render **不一样**（manager 按 `ok` + `code` 定 HTTP 状态，`site_editor.go` §writeSiteScriptError）：
//     成功          标准输出一行 {"ok":true, …}                                  退出码 0
//     拒收 / 不合法  标准输出一行 {"ok":false,"code":"refused|bad|stale","message":"…","field"?}   退出码 3
//                   （`field`：这一笔里有编辑器改不了的字段时，那个字段名）
//     崩了          标准错误里的堆栈                                              退出码 1
//   `--site` / `--changes`：内联 JSON，或一个文件路径（manager 传文件：一个参数在 Linux 上最多 128 KB）。
//
// 🔴 渲染只读不写：拿到的 content 不回写（菜单同步、custom.css 的补丁只用在这一次的输出里，设计文档 §6.1「渲染任务只读库」）。
const fs = require('fs');
const os = require('os');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const { DEFAULT_OUTDIR } = require('./lib/render-bundle');

// 不带值的开关（只有 `save --keep`）。不登记在这里的 `--x` 一律要跟一个值。
const BOOLEAN_FLAGS = new Set(['keep']);

function parseArgs(argv) {
  const out = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith('--')) { out._.push(a); continue; }
    const key = a.slice(2);
    if (BOOLEAN_FLAGS.has(key)) { out[key] = true; continue; }
    const val = argv[i + 1];
    if (val === undefined || val.startsWith('--')) throw new Error(`${a} 后面要跟一个值`);
    out[key] = val;
    i += 1;
  }
  return out;
}

/** 内联 JSON 或一个文件路径。没给 ⟹ undefined（render 的 --geo / --last-modified 是可选的）；编辑器那几条要必给的用 `requiredJsonArg`。 */
function jsonArg(v, name) {
  if (v === undefined) return undefined;
  const text = /^\s*([{[]|null\s*$)/.test(v) ? v : fs.readFileSync(v, 'utf-8');
  try { return JSON.parse(text); } catch (e) { throw new Error(`--${name} 不是合法 JSON：${e.message}`); }
}

function requiredJsonArg(v, name) {
  if (v === undefined) throw new Error(`要给 --${name}`);
  return jsonArg(v, name);
}

// #1801 —— 编辑器那四条（输出约定见文件头）。
const EDITOR_COMMANDS = {
  'editor-data': (a, ed) => ed.editorData({ content: requiredJsonArg(a.site, 'site'), geo: jsonArg(a.geo, 'geo'), locale: a.locale, page: a.page, cacheDir: a['cache-dir'], buildVersion: a['build-version'] }),
  save: (a, ed) => ed.save({ content: requiredJsonArg(a.site, 'site'), changes: requiredJsonArg(a.changes, 'changes'), keep: !!a.keep }),
  'site-css': (a, ed) => ed.siteCss({ content: requiredJsonArg(a.site, 'site'), cacheDir: a['cache-dir'], buildVersion: a['build-version'] }),
  geocode: (a, ed) => ed.geocode({ address: a.address }),
};

/** 跑一条编辑器命令，返回退出码（0 / 3 / 1）。参数解析的错也算「不合法」⟹ ok:false + 3，manager 照样拿得到一行 JSON。 */
async function runEditorCommand(cmd, rest) {
  const ed = require('./lib/site-editor');
  try {
    const out = await EDITOR_COMMANDS[cmd](parseArgs(rest), ed);
    process.stdout.write(`${JSON.stringify({ ok: true, ...out })}\n`);
    return 0;
  } catch (e) {
    if (e instanceof ed.SiteEditorError) {
      process.stdout.write(`${JSON.stringify({ ok: false, code: e.code, message: e.message, ...(e.field ? { field: e.field } : {}) })}\n`);
      return 3;
    }
    if (e instanceof Error && /^--|后面要跟一个值|不是合法 JSON|要给 --/.test(e.message)) {
      process.stdout.write(`${JSON.stringify({ ok: false, code: 'bad', message: e.message })}\n`);
      return 3;
    }
    process.stderr.write(`${e && e.stack ? e.stack : e}\n`);
    return 1;
  }
}

const parsed = (content, rel) => (typeof content[rel] === 'string' ? JSON.parse(content[rel]) : content[rel]);

async function bundle(dir = DEFAULT_OUTDIR) {
  return require('./lib/render-bundle').buildRenderBundle({ outdir: dir });
}

function loadBundle(dir) {
  const manifestFile = path.join(dir, 'manifest.json');
  return { manifest: JSON.parse(fs.readFileSync(manifestFile, 'utf-8')), render: require(path.join(dir, 'render.cjs')) };
}

function copyTree(src, dst) {
  if (!fs.existsSync(src)) return 0;
  let n = 0;
  for (const e of fs.readdirSync(src, { withFileTypes: true })) {
    const s = path.join(src, e.name);
    const d = path.join(dst, e.name);
    if (e.isDirectory()) n += copyTree(s, d);
    else { fs.mkdirSync(dst, { recursive: true }); fs.copyFileSync(s, d); n += 1; }
  }
  return n;
}

/**
 * 渲染一个站。命令行和测试都调它。返回 `{ pages, files, platform, siteCssKey, ms }`。
 * `content` 是「库里一行 JSON」的形状（键 = site/ 下的相对路径，`export-site-json.js`）。
 */
async function render({
  content: input, out, siteId, geo, siteUrl, leadApi, gscToken, indexnowKey, version = 0, buildVersion = '',
  target = 'live', cacheDir, lastModified = {}, platformOut, bundleDir = DEFAULT_OUTDIR,
}) {
  const t0 = Date.now();
  if (target !== 'live' && target !== 'preview') throw new Error(`--target 只认 live / preview：${JSON.stringify(target)}`);
  if (!out) throw new Error('要给 --out');
  const content = { ...input };

  if (siteId !== undefined && Object.prototype.hasOwnProperty.call(content, 'site_meta.json')) {
    content['site_meta.json'] = { ...parsed(content, 'site_meta.json'), siteId };
  }
  if (geo && typeof geo === 'object' && Object.prototype.hasOwnProperty.call(content, 'brand.json')) {
    const brand = parsed(content, 'brand.json');
    const loc = Array.isArray(brand.locations) ? brand.locations[0] : null;
    if (loc && typeof geo.address === 'string' && geo.address === loc.address && Number.isFinite(geo.lat) && Number.isFinite(geo.lng)) {
      content['brand.json'] = { ...brand, locations: [{ ...loc, geo: { lat: geo.lat, lng: geo.lng } }, ...brand.locations.slice(1)] };
    }
  }

  // 派生：菜单同步、theme.css / custom.css / site.css、整站校验，以及页面要的那份站点数据（T2a-1）。日志改走标准错误。
  const { deriveSite } = require('./lib/derive-core');
  const work = fs.mkdtempSync(path.join(os.tmpdir(), 'site-render-'));
  const consoleLog = console.log;
  let derived;
  try {
    console.log = (...a) => console.error(...a);
    derived = await deriveSite({
      content, outDir: work, cacheDir, purge: target === 'live', lastModified, buildVersion, siteLabel: 'site',
    });
  } finally {
    console.log = consoleLog;
  }

  const { readBuildTarget, applyBuildTarget } = require('./lib/build-target');
  const site = JSON.parse(JSON.stringify(derived.data));
  applyBuildTarget(site.seoByLocale, readBuildTarget({ SITE_URL: siteUrl, SITE_INDEXABLE: target === 'preview' ? 'false' : 'true' }));
  if (leadApi !== undefined) site.leadApi = leadApi;
  if (siteId !== undefined) site.siteId = siteId;
  for (const seo of Object.values(site.seoByLocale)) {
    const { google: _placeholder, ...rest } = (seo.verification && typeof seo.verification === 'object') ? seo.verification : {};
    seo.verification = gscToken ? { ...rest, google: gscToken } : rest;
  }

  if (!fs.existsSync(path.join(bundleDir, 'manifest.json'))) {
    console.error(`site.js: ${path.relative(ROOT, bundleDir)} 还没打过，先打一次（node scripts/site.js bundle）`);
    await bundle(bundleDir);
  }
  // react 留在包外、由 Node 现 require：它按 NODE_ENV 挑生产 / 开发版（开发版慢、还会打 key 之类的警告）。Next 发布构建是生产版。
  if (process.env.NODE_ENV === undefined) process.env.NODE_ENV = 'production';
  const { manifest, render: r } = loadBundle(bundleDir);
  const siteCssRel = `_platform/css/${derived.siteCss.key}.css`;
  const { files, pages } = r.renderSite(site, { target, version, platform: manifest.platform, siteCssHref: `/${siteCssRel}` });

  // 落盘前整批验一遍：slug 是内容里的字段（页面 / 博客 / 默认语言跳转页都由它拼路径），带 `../` 就会写到 --out 之外。
  // 今天的 Next 构建对同样输入当场失败（`Requested and resolved page mismatch`）；这里也整跑失败、一个文件都不写。
  const outAbs = path.resolve(out);
  for (const rel of Object.keys(files)) {
    const segs = rel.split('/');
    const file = path.resolve(outAbs, rel);
    if (path.isAbsolute(rel) || rel.includes('\\') || segs.some((s) => s === '' || s === '.' || s === '..')
      || !file.startsWith(outAbs + path.sep)) {
      throw new Error(`产物路径不合法（slug 带 ../ 之类？），整跑不写：${JSON.stringify(rel)}`);
    }
  }
  fs.mkdirSync(out, { recursive: true });
  for (const [rel, body] of Object.entries(files)) {
    const file = path.join(out, rel);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, body);
  }
  for (const name of ['theme.css', 'custom.css']) fs.copyFileSync(path.join(work, name), path.join(out, name));
  copyTree(path.join(ROOT, 'public', 'images'), path.join(out, 'images'));
  if (typeof indexnowKey === 'string' && /^[a-zA-Z0-9-]{8,128}$/.test(indexnowKey)) fs.writeFileSync(path.join(out, `${indexnowKey}.txt`), indexnowKey);

  const platform = [...manifest.files.map((rel) => ({ path: rel, file: path.join(bundleDir, rel) })),
    { path: siteCssRel, file: path.join(work, 'site.css') }];
  if (platformOut) for (const p of platform) { const d = path.join(platformOut, p.path); fs.mkdirSync(path.dirname(d), { recursive: true }); fs.copyFileSync(p.file, d); }
  fs.rmSync(work, { recursive: true, force: true });
  return {
    pages: pages.length, files: Object.keys(files).length,
    platform: platform.map((p) => p.path), siteCssKey: derived.siteCss.key, siteCssCached: Boolean(derived.siteCss.cached),
    externals: manifest.externals, ms: Date.now() - t0,
  };
}

async function main() {
  const [cmd, ...rest] = process.argv.slice(2);
  if (Object.prototype.hasOwnProperty.call(EDITOR_COMMANDS, cmd)) {
    process.exitCode = await runEditorCommand(cmd, rest);
    return;
  }
  const a = parseArgs(rest);
  if (cmd === 'bundle') {
    const m = await bundle(a['out-dir'] ? path.resolve(a['out-dir']) : DEFAULT_OUTDIR);
    process.stdout.write(`${JSON.stringify({ event: 'bundled', ...m })}\n`);
    return;
  }
  if (cmd === 'render') {
    if (!a.site) throw new Error('要给 --site <站 JSON>');
    // 先判再 resolve：path.resolve('') 是当前目录，下面 render() 里那句 `if (!out)` 就永远打不着了。
    if (typeof a.out !== 'string' || a.out === '') throw new Error('要给 --out <目录>');
    const result = await render({
      content: JSON.parse(fs.readFileSync(a.site, 'utf-8')),
      out: path.resolve(a.out),
      siteId: a['site-id'],
      geo: jsonArg(a.geo, 'geo'),
      siteUrl: a['site-url'],
      leadApi: a['lead-api'],
      gscToken: a['gsc-token'],
      indexnowKey: a['indexnow-key'],
      version: a.version ?? 0,
      buildVersion: a['build-version'] ?? '',
      target: a.target || 'live',
      ...(a['cache-dir'] ? { cacheDir: path.resolve(a['cache-dir']) } : {}),
      lastModified: jsonArg(a['last-modified'], 'last-modified') || {},
      ...(a['platform-out'] ? { platformOut: path.resolve(a['platform-out']) } : {}),
      ...(a['bundle-dir'] ? { bundleDir: path.resolve(a['bundle-dir']) } : {}),
    });
    process.stdout.write(`${JSON.stringify({ event: 'rendered', ...result })}\n`);
    return;
  }
  throw new Error(`用法：node scripts/site.js <${['bundle', 'render', ...Object.keys(EDITOR_COMMANDS)].join('|')}> …（拿到的是 ${JSON.stringify(cmd)}）`);
}

if (require.main === module) {
  main().catch((e) => { console.error(`site.js: ${e && e.message ? e.message : e}`); process.exit(1); });
}

module.exports = { render, bundle };
