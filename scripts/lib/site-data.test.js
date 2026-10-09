#!/usr/bin/env node
'use strict';
// #1665 —— 服务端加载器拼出来的站点数据（`scripts/lib/site-data.js` §assembleSiteData）跟 `sync-config.js` 写进
// `config-data.ts` 的那 15 个值逐个相同。发布模式下页面就是拿它渲染的，所以「发布出去的页面一个字不变」靠的是这一条；
// 两边是两份代码（sync-config 拆派生段是 T3 的事），分叉了不会有别的东西红。
//
// 夹具走仓里那条 skipAI 建站路（同 editor-baseline.test.js）：一个主 en、次 zh 的站，再加一篇博客、zh 一张坏掉的 forms.json；
// 外加一个老的扁平站（没有 site_meta.json）。每个站先跑一次真 sync-config，再拿它写出的 config-data.ts 跟 assembleSiteData 比。
//
// 判据不是「跑通了」：
//   · 反臂 —— sync-config 之后再改一页标题、不重跑 sync-config ⟹ 比较必须在 pagesByLocale 上红（尺子能红）。
//   · `lastModified: 'mtime'`（预览那一档）只许 pagesByLocale 里的 lastModified 不同，别的 14 个值照样逐字相同。
//   · 服务端加载器（`src/lib/site-data.server.ts`）的缓存：site/ 没变 ⟹ 同一个对象；改一个文件 ⟹ 新对象、新值。

const fs = require('fs');
const os = require('os');
const path = require('path');
const cp = require('child_process');
const Module = require('module');

const NEXT = path.resolve(__dirname, '..', '..');

let pass = 0; let fail = 0;
const ok = (m) => { pass += 1; console.log(`  ✅ ${m}`); };
const bad = (m) => { fail += 1; console.log(`  ❌ ${m}`); };
const check = (cond, m, detail) => (cond ? ok(m) : bad(detail ? `${m} —— ${detail}` : m));
function die(msg) { console.log(`💥 跑不起来: ${msg}`); process.exit(2); }

const temps = [];
process.on('exit', () => { for (const t of temps) fs.rmSync(t, { recursive: true, force: true }); });

const KEYS = ['siteId', 'leadApi', 'colorScheme', 'dir', 'defaultLocale', 'locales', 'brand', 'seoByLocale', 'servicesByLocale',
  'formsByLocale', 'navigationByLocale', 'pagesByLocale', 'blogPostsByLocale', 'regions', 'pageLayout'];

function makeSite(label, { flat = false } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), `site-data-${label}-`));
  temps.push(root);
  const work = path.join(root, 'nextjs');
  cp.execSync(`cp -a --no-dereference "${NEXT}" "${work}"`, { stdio: 'pipe' });
  for (const junk of ['out', '.next', '.out-backup', '.out-temp', 'site', 'node_modules', path.join('src', 'lib', 'config-data.ts')]) {
    fs.rmSync(path.join(work, junk), { recursive: true, force: true });
  }
  fs.symlinkSync(path.join(NEXT, 'node_modules'), path.join(work, 'node_modules'));
  const r = cp.spawnSync(process.execPath, [path.join(work, 'scripts', 'create-site.js')], {
    input: JSON.stringify({ siteId: `sd${label}01`, siteUrl: `https://sd${label}.example.com`, companyName: 'Northside Auto Care',
      industry: 'auto repair', location: 'Toronto', skipAI: true, language: 'en', ...(flat ? {} : { secondaryLocales: ['zh'] }) }),
    cwd: work, encoding: 'utf8', env: { ...process.env, ANTHROPIC_API_KEY: undefined }, timeout: 180000,
  });
  const site = path.join(work, 'site');
  if (!fs.existsSync(path.join(site, 'en', 'pages', 'home.json'))) die(`夹具 ${label} 立不起来（rc=${r.status}）\n${(r.stderr || '').slice(-600)}`);
  if (flat) {
    for (const e of fs.readdirSync(path.join(site, 'en'))) fs.renameSync(path.join(site, 'en', e), path.join(site, e));
    fs.rmSync(path.join(site, 'en'), { recursive: true });
    fs.rmSync(path.join(site, 'site_meta.json'));
  } else {
    // 再加一篇博客 + 一张坏 forms.json（sync-config 当成空表单库，不拦）—— 两条分支都要比到。
    fs.mkdirSync(path.join(site, 'en', 'blog'), { recursive: true });
    fs.writeFileSync(path.join(site, 'en', 'blog', 'first.json'), JSON.stringify({ slug: 'first', title: 'First post', excerpt: 'x',
      content: '<p>Hello</p>', author: 'A', category: 'News', tags: ['a'], publishedAt: '2026-09-01',
      seo: { metaTitle: 'First', metaDescription: 'First post' } }));
    fs.writeFileSync(path.join(site, 'zh', 'forms.json'), '{ not json');
  }
  return work;
}

function syncConfig(work, env) {
  const r = cp.spawnSync(process.execPath, [path.join(work, 'scripts', 'sync-config.js')], { cwd: work, encoding: 'utf8', timeout: 180000, env });
  if (r.status !== 0) die(`sync-config 失败（rc=${r.status}）\n${(r.stdout + r.stderr).slice(-800)}`);
  const txt = fs.readFileSync(path.join(work, 'src', 'lib', 'config-data.ts'), 'utf-8');
  const out = {};
  for (const m of txt.matchAll(/^export const (\w+) = (.*);$/gm)) out[m[1]] = JSON.parse(m[2]);
  return out;
}

function assemble(work, opts = {}) {
  // 每个夹具一份新的 require（模块级的「哪些块读 services.json」按 rootDir 记，不同夹具互不影响也没关系，但别复用上一个夹具的模块）。
  const file = path.join(work, 'scripts', 'lib', 'site-data.js');
  for (const k of Object.keys(require.cache)) if (k.startsWith(path.join(work, 'scripts'))) delete require.cache[k];
  return require(file).assembleSiteData({ rootDir: work, ...opts });
}

const differing = (a, b) => KEYS.filter((k) => JSON.stringify(a[k]) !== JSON.stringify(b[k]));

const ENV_OFF = { ...process.env, SITE_URL: '', SITE_INDEXABLE: '', NEXT_PUBLIC_LEAD_API: '' };
const ENV_ON = { ...process.env, SITE_URL: 'https://live.example.org', SITE_INDEXABLE: 'false', NEXT_PUBLIC_LEAD_API: 'https://api.example.org' };

console.log('── 两语言站（主 en、次 zh、en 多一篇博客、zh 的 forms.json 是坏的）');
const two = makeSite('two');
{
  const want = syncConfig(two, ENV_OFF);
  check(KEYS.every((k) => k in want) && Object.keys(want).length === KEYS.length,
    `config-data.ts 恰好导出这 ${KEYS.length} 个值`, Object.keys(want).join(','));
  check(want.locales.join() === 'en,zh' && want.blogPostsByLocale.en.some((p) => p.slug === 'first') && want.formsByLocale.zh.length === 0
    && want.formsByLocale.en.length > 0,
  '夹具真的覆盖到了：两种语言、en 的博客里有加的那一篇、zh 的坏 forms.json 当成空表单库（en 的照常有）');
  const got = assemble(two, { env: ENV_OFF });
  const d = differing(want, got);
  check(d.length === 0, `assembleSiteData 跟 config-data.ts 的 ${KEYS.length} 个值逐个相同`, `不同的：${d.join(', ')}`);

  const wantOn = syncConfig(two, ENV_ON);
  const gotOn = assemble(two, { env: ENV_ON });
  const dOn = differing(wantOn, gotOn);
  check(wantOn.seoByLocale.en.domain === 'https://live.example.org' && wantOn.leadApi === 'https://api.example.org',
    '带上 SITE_URL / SITE_INDEXABLE / NEXT_PUBLIC_LEAD_API 时 config-data.ts 真的变了（前提）');
  check(dOn.length === 0, '带上那三个环境变量：两边仍然逐个相同（发布那次构建的读法）', `不同的：${dOn.join(', ')}`);

  // 预览那一档：只许 lastModified 不一样。
  const gotMtime = assemble(two, { env: ENV_ON, lastModified: 'mtime' });
  const strip = (v) => JSON.stringify(v.pagesByLocale, (k, x) => (k === 'lastModified' ? undefined : x));
  const dM = differing(wantOn, gotMtime).filter((k) => k !== 'pagesByLocale');
  check(dM.length === 0 && strip(wantOn) === strip(gotMtime), "lastModified: 'mtime'：除了每页的 lastModified，别的都逐字相同",
    `不同的：${dM.join(', ')}`);
  check(Object.values(gotMtime.pagesByLocale).flat().every((p) => /^\d{4}-\d\d-\d\dT/.test(p.lastModified)), "'mtime' 那一档每页都有一个 ISO 时间");

  // 反臂：sync-config 之后改一页，不重跑 —— 比较必须红在 pagesByLocale。
  const about = path.join(two, 'site', 'en', 'pages', 'about.json');
  const page = JSON.parse(fs.readFileSync(about, 'utf-8'));
  page.title = 'Changed After Sync';
  fs.writeFileSync(about, JSON.stringify(page, null, 2));
  const dMut = differing(wantOn, assemble(two, { env: ENV_ON }));
  check(dMut.includes('pagesByLocale'), '反臂：改了一页没重跑 sync-config ⟹ 这把尺在 pagesByLocale 上红（它能红）', `不同的：${dMut.join(', ')}`);
}

console.log('── 老的扁平站（没有 site_meta.json，内容直接在 site/ 下）');
{
  const flat = makeSite('flat', { flat: true });
  const want = syncConfig(flat, ENV_OFF);
  check(want.locales.join() === 'en' && want.siteId === '', '前提：sync-config 按老形状读（en、没有 siteId）');
  const d = differing(want, assemble(flat, { env: ENV_OFF }));
  check(d.length === 0, '扁平站：两边逐个相同', `不同的：${d.join(', ')}`);
}

console.log('── 读不了的站：抛错（不是 process.exit）');
{
  const empty = fs.mkdtempSync(path.join(os.tmpdir(), 'site-data-empty-'));
  temps.push(empty);
  let threw = null;
  try { require(path.join(NEXT, 'scripts', 'lib', 'site-data.js')).assembleSiteData({ rootDir: NEXT, siteDir: empty }); } catch (e) { threw = e; }
  check(threw && /brand\.json/.test(threw.message), '空目录 ⟹ 抛「Site config not found …/brand.json」，进程还活着', threw && threw.message);
}

console.log('── 服务端加载器 src/lib/site-data.server.ts 的缓存（按 site/ 下文件的改动时间 + 大小）');
{
  const ts = require(path.join(NEXT, 'node_modules', 'typescript'));
  const STUB = path.join(os.tmpdir(), `site-data-server-only-${process.pid}.js`);
  fs.writeFileSync(STUB, 'module.exports = {};\n');
  temps.push(STUB);
  const prevTs = require.extensions['.ts'];
  require.extensions['.ts'] = (mod, filename) => mod._compile(ts.transpileModule(fs.readFileSync(filename, 'utf-8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: true }, fileName: filename,
  }).outputText, filename);
  const origResolve = Module._resolveFilename;
  // `server-only` 是 Next 自己解析的名字（本仓不装这个包）；`next/server` 只为 render-mode 的 connection()，这里用不到它的值。
  Module._resolveFilename = function resolve(req, ...rest) {
    if (req === 'server-only' || req === 'next/server') return STUB;
    return origResolve.call(this, req, ...rest);
  };
  const cwd = process.cwd();
  process.chdir(two);
  try {
    const loader = require(path.join(NEXT, 'src', 'lib', 'site-data.server.ts'));
    const a = loader.loadSiteData();
    const b = loader.loadSiteData();
    check(a === b, 'site/ 没变：两次调用拿到同一个对象（config.ts 按对象缓存反查表，靠的就是这个）');
    check(a.pagesByLocale.en.find((p) => p.slug === 'about').title === 'Changed After Sync', '读的是这棵树的 site/（反臂改过的那个标题）');
    const about = path.join(two, 'site', 'en', 'pages', 'about.json');
    const page = JSON.parse(fs.readFileSync(about, 'utf-8'));
    page.title = 'Changed Again';
    fs.writeFileSync(about, JSON.stringify(page, null, 2));
    const future = new Date(Date.now() + 5000);
    fs.utimesSync(about, future, future);
    const c = loader.loadSiteData();
    check(c !== a && c.pagesByLocale.en.find((p) => p.slug === 'about').title === 'Changed Again',
      '改了一个文件：下一次调用是新对象、新标题（不用重启）');
    fs.writeFileSync(path.join(two, 'site', 'en', 'pages', 't1665-new.json'), JSON.stringify({ slug: 't1665-new', title: 'New', blocks: [] }));
    const e = loader.loadSiteData();
    check(e !== c && e.pagesByLocale.en.some((p) => p.slug === 't1665-new'), '新建一个页面文件：下一次调用就有这一页');
  } finally {
    process.chdir(cwd);
    Module._resolveFilename = origResolve;
    require.extensions['.ts'] = prevTs;
  }
}

console.log(`\n══ 汇总: 通过 ${pass} · 失败 ${fail} ══`);
process.exit(fail ? 1 : 0);
