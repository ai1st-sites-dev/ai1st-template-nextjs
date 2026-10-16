#!/usr/bin/env node
// #1798 —— 岛（发布出去的静态网页上那几个会动的部件）的测试：每个岛一页「静态整页 + 岛」，无头 Chromium 里点它。
//
//   ① props：每个岛 JSON.stringify 往返相等、不含 `site` 键、≤ 8 KB
//   ② runtime：`runtime.<hash>.js` 的 gzip 体积；内容不变哈希不变，改一个岛哈希变
//   ③ 浏览器：本机静态服务 + 假 lead API（收到 POST 回 200）—— 表单能提交、灯箱能开关、轮播能翻页、地图能打开、Bootstrap 下拉能开，
//      0 个控制台错误
//   ④ 变异臂：runtime 去掉 hydrateRoot（`noHydrate`）⟹ 表单 / 价格切换 / 地图 / 页脚表单那几格必须红 —— 手机菜单、轮播、灯箱、
//      下拉靠的是 Bootstrap 不是 hydrate，它们绿不说明岛点亮了，所以只拿要 React 的那几格当判据。
//
// 页面里的块是真块（`scripts/islands-harness.tsx` → `SectionRenderer` / `SiteShell`，跟真站同一条路），数据来自夹具站
// site-0448c807 + 演示内容。顶栏 / 页脚 / 价格表今天还 import `next/link`，打包时临时换成 `<a>`（`islands-build.js` §nextLinkUntilT1b）。
//
// 退出码：0 全过 · 1 有失败 · 2 跑不起来（没有 Chromium / esbuild 等）。
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const { execFileSync } = require('child_process');

const NEXT = path.resolve(__dirname, '..');
let pass = 0;
let fail = 0;
const check = (ok, what) => { if (ok) { pass += 1; console.log(`  ✅ ${what}`); } else { fail += 1; console.log(`  ❌ ${what}`); } };
const die = (why) => { console.log(`🔴 跑不起来: ${why}`); process.exit(2); };

let build; let chromium; let demo;
try {
  build = require('./lib/islands-build');
  require.resolve('esbuild');
  ({ chromium } = require('playwright'));
  demo = require('./lib/demo-content');
} catch (e) { die(`载入失败: ${e.message}`); }

const MAX_PROPS = 8 * 1024;
const CACHE = path.join(NEXT, 'node_modules', '.cache', 'islands');
const PUBLIC = path.join(NEXT, 'public');

// ── 站：夹具 JSON → 临时 site/ 目录 → 跟真站同一个拼法（scripts/lib/site-data.js）──────────────────
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'islands-test-'));
process.on('exit', () => { try { fs.rmSync(tmp, { recursive: true, force: true }); } catch { /* 收尾 */ } });
const siteDir = path.join(tmp, 'site');
const FIXTURE = path.join(NEXT, 'scripts', 'fixtures', 'site-fixtures', 'site-0448c807.json');
execFileSync(process.execPath, [path.join(NEXT, 'scripts', 'fixtures', 'site-fixtures', 'export-site-json.js'), 'to-dir', FIXTURE, siteDir]);
const site = require('./lib/site-data').assembleSiteData({ rootDir: NEXT, siteDir, lastModified: 'mtime' });
const fixtureHome = require(FIXTURE)['en/pages/home.json'];
const fixtureBlock = (type) => {
  const b = (fixtureHome.blocks || fixtureHome.sections || []).find((x) => x.type === type);
  if (!b) die(`夹具首页里没有 ${type} 块`);
  return JSON.parse(JSON.stringify(b));
};
const demoBlock = (type, shape) => ({ id: `demo-${type}`, type, shape, data: JSON.parse(JSON.stringify(demo.demoContentFor(type))) });

// 每个岛一页：页里放哪些块、这一页上应该有哪些岛。
const PAGES = [
  { name: 'lead-form', blocks: [fixtureBlock('hero')], islands: ['lead-form'] },
  { name: 'gallery', blocks: [demoBlock('gallery', 'grid')], islands: ['gallery-lightbox'] },
  { name: 'testimonials', blocks: [demoBlock('testimonials', 'big-quote')], islands: ['testimonials-carousel'] },
  { name: 'shell', shell: true, mobile: true, islands: ['header', 'footer'] },
  { name: 'pricing', blocks: [demoBlock('pricing', 'plan-cards')], islands: ['pricing'] },
  { name: 'contact-map', blocks: [(() => { const b = fixtureBlock('contact'); b.data.options = { ...b.data.options, map: 'beside', form: 'none' }; return b; })()], islands: ['contact-map'] },
];

// Bootstrap 下拉：今天没有块用 `data-bs-toggle="dropdown"`（现取只有 collapse / modal）；正文要 runtime 带上下拉，
// 这一段手写的 markup 量的是「runtime 里的下拉那一套是活的」。
const DROPDOWN = '<div class="dropdown" id="dd"><button class="btn dropdown-toggle" type="button" data-bs-toggle="dropdown" aria-expanded="false">Menu</button>'
  + '<ul class="dropdown-menu"><li><a class="dropdown-item" href="#">One</a></li></ul></div>';

function page(body, runtimeName) {
  return '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">'
    + '<link rel="stylesheet" href="/bootstrap.min.css"></head><body>'
    + `${body}${DROPDOWN}<script src="/_platform/${runtimeName}"></script></body></html>`;
}

function serve(root, posts) {
  const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.webp': 'image/webp' };
  const srv = http.createServer((req, res) => {
    const url = (req.url || '/').split('?')[0];
    if (url === '/api/leads') {
      if (req.method === 'OPTIONS') { res.writeHead(204, { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'Content-Type', 'Access-Control-Allow-Methods': 'POST' }); res.end(); return; }
      let b = '';
      req.on('data', (c) => { b += c; });
      req.on('end', () => { posts.push(b); res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }); res.end('{"ok":true}'); });
      return;
    }
    // 先找这一份 www，再落回模板的 public/（站内资源：评价平台 logo 等，发布时它们也在站根下）。
    const f = [root, PUBLIC].map((r) => path.join(r, url.endsWith('/') ? `${url}index.html` : url))
      .find((x, i) => x.startsWith([root, PUBLIC][i]) && fs.existsSync(x) && fs.statSync(x).isFile());
    if (!f) { res.writeHead(404); res.end(); return; }
    res.writeHead(200, { 'Content-Type': types[path.extname(f)] || 'application/octet-stream' });
    res.end(fs.readFileSync(f));
  });
  return new Promise((resolve) => srv.listen(0, '127.0.0.1', () => resolve(srv)));
}

/** 一个岛的源码在打包时改一个字（不碰磁盘）：量「改一个岛哈希就变」。 */
const touchIsland = {
  name: 'touch-one-island',
  setup(b) {
    b.onLoad({ filter: /gallery[\\/]Lightbox\.tsx$/ }, (args) => ({
      contents: fs.readFileSync(args.path, 'utf-8').replace("const i = Number.isInteger(n) && n >= 0 ? n : 0;", "const i = Number.isInteger(n) && n >= 0 ? n : 1;"),
      loader: 'tsx',
    }));
  },
};

async function fillAndSubmit(p, scope) {
  const form = p.locator(`${scope} form`).first();
  for (const el of await form.locator('input:not([type=hidden]):not([tabindex="-1"]), textarea').all()) {
    if (!(await el.isVisible())) continue;
    const type = (await el.getAttribute('type')) || 'text';
    await el.fill(type === 'email' ? 'island@example.com' : type === 'tel' ? '4165550100' : 'Island Tester');
  }
  for (const sel of await form.locator('select').all()) {
    const v = await sel.locator('option').evaluateAll((os) => (os.find((o) => o.value) || {}).value);
    if (v) await sel.selectOption(v);
  }
  await form.locator('button[type=submit]').click();
}

async function runPages(browser, base, posts, { mutant }) {
  const out = {};
  for (const pg of PAGES) {
    const ctx = await browser.newContext({ viewport: pg.mobile ? { width: 390, height: 844 } : { width: 1280, height: 900 } });
    const p = await ctx.newPage();
    const errors = [];
    p.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
    p.on('pageerror', (e) => errors.push(e.message));
    // 外网一律不出（演示图片、地图瓦片）：回一个空的 200，别让外网的有无变成读数。
    await p.route((u) => !u.hostname.startsWith('127.0.0.1'), (r) => r.fulfill({ status: 200, body: '' }));
    await p.goto(`${base}/${pg.name}/`);
    await p.waitForLoadState('load');
    await p.waitForTimeout(300);
    const r = { errors };
    const before = posts.length;
    if (pg.name === 'lead-form') {
      await fillAndSubmit(p, '[data-island="lead-form"]');
      await p.waitForTimeout(1500);
      r.posted = posts.length - before;
      r.thanks = await p.locator('[data-island="lead-form"] [data-part="form-success"]').count();
    }
    if (pg.name === 'gallery') {
      await p.locator('[data-gl-index]').first().click();
      await p.locator('.modal.show').waitFor({ timeout: 5000 }).catch(() => {});
      r.opened = await p.locator('.modal.show').count();
      await p.locator('.modal.show [data-bs-dismiss="modal"]').first().click().catch(() => {});
      await p.waitForTimeout(800);
      r.closed = (await p.locator('.modal.show').count()) === 0;
    }
    if (pg.name === 'testimonials') {
      const active = () => p.locator('.carousel-item').evaluateAll((xs) => xs.findIndex((x) => x.classList.contains('active')));
      r.before = await active();
      await p.locator('[data-bs-slide="next"]').first().click();
      await p.waitForTimeout(1200);
      r.after = await active();
    }
    if (pg.name === 'shell') {
      // 手机宽度下顶栏菜单：汉堡按钮开、再点关（抽屉是 Bootstrap Collapse，动画 ~350ms）。
      const toggler = p.locator('header [data-bs-toggle="collapse"]').first();
      const drawer = p.locator('header .collapse, header .collapsing').first();
      r.togglerVisible = await toggler.isVisible();
      await toggler.click();
      await p.waitForTimeout(700);
      r.menuOpened = (await drawer.getAttribute('class') || '').split(/\s+/).includes('show');
      await toggler.click();
      await p.waitForTimeout(700);
      r.menuClosed = !(await drawer.getAttribute('class') || '').split(/\s+/).includes('show');
      // 页脚里的表单（BlockLeadForm 是页脚这个岛的普通子树）。
      await fillAndSubmit(p, '[data-island="footer"]');
      await p.waitForTimeout(1500);
      r.posted = posts.length - before;
      r.thanks = await p.locator('[data-island="footer"] [data-part="form-success"]').count();
    }
    if (pg.name === 'pricing') {
      const price = () => p.locator('[data-part="price"]').first().innerText();
      r.priceBefore = await price();
      await p.locator('[data-billing-option="yearly"]').click();
      await p.waitForTimeout(300);
      r.billing = await p.locator('[data-part="billing"]').getAttribute('data-billing');
      r.priceAfter = await price();
    }
    if (pg.name === 'contact-map') {
      await p.locator('[data-part="map-open"]').click();
      await p.waitForTimeout(500);
      r.state = await p.locator('[data-part="map"]').getAttribute('data-map-state');
      r.iframes = await p.locator('[data-part="map"] iframe').count();
    }
    await p.locator('#dd [data-bs-toggle="dropdown"]').click();
    await p.waitForTimeout(300);
    r.dropdown = await p.locator('#dd .dropdown-menu.show').count();
    out[pg.name] = r;
    await ctx.close();
  }
  return out;
}

(async () => {
  console.log('══ #1798 岛：props / runtime / 浏览器 ══');
  fs.mkdirSync(CACHE, { recursive: true });
  const serverFile = path.join(CACHE, `harness-${process.pid}.cjs`);
  process.on('exit', () => { try { fs.rmSync(serverFile, { force: true }); } catch { /* 收尾 */ } });
  try { await build.buildServer({ entry: path.join(__dirname, 'islands-harness.tsx'), outfile: serverFile }); } catch (e) { die(`harness 打不出来: ${e.message}`); }
  const harness = require(serverFile);

  // ── ① 注册表 + props ──────────────────────────────────────────────────────────
  console.log('\n── ① 每个岛的 props');
  const islandSrc = (rel) => fs.readFileSync(path.join(NEXT, rel), 'utf-8');
  for (const [name, rel] of [['lead-form', 'src/components/BlockLeadForm.tsx'], ['gallery-lightbox', 'blocks/gallery/Lightbox.tsx'],
    ['testimonials-carousel', 'blocks/testimonials/Carousel.tsx'], ['contact-map', 'blocks/contact/ContactMap.tsx'],
    ['header', 'blocks/header/Section.tsx'], ['footer', 'blocks/footer/Section.tsx'], ['pricing', 'blocks/pricing/Section.tsx']]) {
    check(Object.prototype.hasOwnProperty.call(harness.ISLANDS, name) && islandSrc(rel).includes(`island('${name}'`), `${name}：注册表里有，组件文件里 island('${name}', …) 名字一致`);
  }
  const posts = [];
  const srv = await serve(path.join(tmp, 'www'), posts);
  const base = `http://127.0.0.1:${srv.address().port}`;
  site.leadApi = base;
  const rendered = {};
  for (const pg of PAGES) {
    // 外壳页：页脚的表单旋钮打开（夹具站的页脚是 slim-row、form=none）—— 页脚这个岛里套着 BlockLeadForm，正是「岛里套岛只算最外层」那一格。
    const shellSite = { ...site, regions: { ...site.regions, footer: { ...site.regions.footer, options: { ...(site.regions.footer.options || {}), layout: 'stacked', form: 'full' } } } };
    const { html, islands } = pg.shell ? harness.renderShell(shellSite, 'en') : harness.renderBlocks(site, 'en', pg.blocks);
    rendered[pg.name] = html;
    check(JSON.stringify(islands.map((i) => i.name)) === JSON.stringify(pg.islands), `${pg.name} 页：岛是 ${JSON.stringify(pg.islands)}（读到 ${JSON.stringify(islands.map((i) => i.name))}）`);
    for (const isl of islands) {
      const text = JSON.stringify(isl.props);
      check(JSON.stringify(JSON.parse(text)) === text, `${isl.name}：JSON 往返相等`);
      check(!Object.prototype.hasOwnProperty.call(isl.props, 'site'), `${isl.name}：props 里没有 site`);
      check(text.length <= MAX_PROPS, `${isl.name}：props ${text.length} 字节 ≤ ${MAX_PROPS}`);
    }
    check(!/data-island-slot/.test(html), `${pg.name} 页：占位全部填回去了`);
  }
  // 尺子能读红：把整站塞进 props（今天 pricing 收到的就是这个形状）⟹ 上面两条必红。
  const fat = JSON.stringify({ site });
  check(fat.length > MAX_PROPS && /"site"/.test(fat), `尺子能读红：带整站的 props ${fat.length} 字节、有 site 键 ⟹ 上面两条会红`);
  check(harness.islandJson({ a: '</script><b>&\u2028' }) === '{"a":"\\u003c/script\\u003e\\u003cb\\u003e\\u0026\\u2028"}', 'props JSON 转义 < > & U+2028（数据里的 </script> 截不断脚本）');

  // ── ② runtime ─────────────────────────────────────────────────────────────────
  console.log('\n── ② runtime');
  const www = path.join(tmp, 'www');
  const rt = await build.buildRuntime({ outdir: path.join(www, '_platform') });
  const rt2 = await build.buildRuntime();
  const rtTouched = await build.buildRuntime({ plugins: [touchIsland] });
  const rtMutant = await build.buildRuntime({ outdir: path.join(tmp, 'www-mutant', '_platform'), noHydrate: true });
  console.log(`   ${rt.name}  ${rt.bytes} 字节 · gzip ${rt.gzipBytes} 字节（${(rt.gzipBytes / 1024).toFixed(1)} KB）`);
  check(/^runtime\.[0-9a-f]{16}\.js$/.test(rt.name), `文件名 runtime.<16 位哈希>.js（${rt.name}）`);
  check(rt2.hash === rt.hash, '内容不变 ⟹ 哈希不变（同一份源码打两次）');
  check(rtTouched.hash !== rt.hash, `改一个岛（gallery/Lightbox.tsx 里一个字）⟹ 哈希变（${rt.hash} → ${rtTouched.hash}）`);
  check(rtMutant.hash !== rt.hash, '变异臂那一份确实不同（hydrateRoot 那一行没了）');

  // ── ③ 浏览器 ─────────────────────────────────────────────────────────────────
  for (const [dir, runtime] of [[www, rt.name], [path.join(tmp, 'www-mutant'), rtMutant.name]]) {
    fs.copyFileSync(require.resolve('bootstrap/dist/css/bootstrap.min.css'), path.join(dir, 'bootstrap.min.css'));
    for (const pg of PAGES) {
      fs.mkdirSync(path.join(dir, pg.name), { recursive: true });
      fs.writeFileSync(path.join(dir, pg.name, 'index.html'), page(rendered[pg.name], runtime));
    }
  }
  let browser;
  try { browser = await chromium.launch(); } catch (e) { srv.close(); die(`Chromium 起不来（CI 要先 npx playwright install chromium）: ${e.message.split('\n')[0]}`); }
  try {
    console.log('\n── ③ 浏览器（正常的 runtime）');
    const ok = await runPages(browser, base, posts, { mutant: false });
    check(ok['lead-form'].posted === 1 && ok['lead-form'].thanks === 1, `联系表单提交 ⟹ 假 lead API 收到 ${ok['lead-form'].posted} 条 POST、页面出成功提示（[data-part=form-success] ${ok['lead-form'].thanks} 个）`);
    check(ok.gallery.opened === 1 && ok.gallery.closed, `图库灯箱能开（${ok.gallery.opened}）能关（${ok.gallery.closed}）`);
    check(ok.testimonials.before === 0 && ok.testimonials.after === 1, `评价轮播点「下一条」从第 ${ok.testimonials.before + 1} 张到第 ${ok.testimonials.after + 1} 张`);
    check(ok.shell.togglerVisible && ok.shell.menuOpened && ok.shell.menuClosed, `手机宽度（390）顶栏菜单：按钮看得见（${ok.shell.togglerVisible}）、点开（${ok.shell.menuOpened}）、再点关（${ok.shell.menuClosed}）`);
    check(ok.shell.posted === 1 && ok.shell.thanks === 1, `页脚里的表单提交 ⟹ 假 lead API 收到 ${ok.shell.posted} 条 POST、页面出成功提示（${ok.shell.thanks} 个）`);
    check(ok.pricing.billing === 'yearly' && ok.pricing.priceBefore !== ok.pricing.priceAfter, `价格表点 Yearly ⟹ data-billing=${ok.pricing.billing}、价格 ${JSON.stringify(ok.pricing.priceBefore)} → ${JSON.stringify(ok.pricing.priceAfter)}`);
    check(ok['contact-map'].state === 'open' && ok['contact-map'].iframes === 1, `地图点 Open map ⟹ data-map-state=${ok['contact-map'].state}、iframe ${ok['contact-map'].iframes} 个`);
    for (const pg of PAGES) check(ok[pg.name].dropdown === 1, `${pg.name} 页：Bootstrap 下拉能开`);
    for (const pg of PAGES) check(ok[pg.name].errors.length === 0, `${pg.name} 页：0 个控制台错误${ok[pg.name].errors.length ? `（${ok[pg.name].errors.slice(0, 2).join(' | ')}）` : ''}`);

    // ── ④ 变异臂 ─────────────────────────────────────────────────────────────
    console.log('\n── ④ 变异臂：runtime 不 hydrate（服务端 HTML 原样、Bootstrap 照样在）');
    const srvM = await serve(path.join(tmp, 'www-mutant'), posts);
    const baseM = `http://127.0.0.1:${srvM.address().port}`;
    const bad = await runPages(browser, baseM, posts, { mutant: true });
    srvM.close();
    check(bad['lead-form'].posted === 0, `不 hydrate ⟹ 表单提交没打到 lead API（${bad['lead-form'].posted} 条）—— 表单那一格靠的确实是岛`);
    check(bad.shell.posted === 0, `不 hydrate ⟹ 页脚表单提交没打到 lead API（${bad.shell.posted} 条）—— 页脚表单那一格靠的确实是岛`);
    check(bad.pricing.billing !== 'yearly', `不 hydrate ⟹ 价格表点 Yearly 不切（data-billing=${bad.pricing.billing}）—— 价格切换那一格靠的确实是岛`);
    check(bad['contact-map'].state !== 'open', `不 hydrate ⟹ 地图点了不开（data-map-state=${bad['contact-map'].state}）—— 地图那一格靠的确实是岛`);
    check(bad.testimonials.after === 1 && bad.gallery.opened === 1 && bad.shell.menuOpened, '对照：轮播 / 灯箱 / 手机菜单在不 hydrate 时照样能用 —— 它们靠 Bootstrap，所以不拿它们当「岛点亮了」的判据');
  } finally {
    await browser.close();
    srv.close();
  }

  console.log(`\n══ 汇总: 通过 ${pass} · 失败 ${fail} ══`);
  process.exit(fail ? 1 : 0);
})().catch((e) => die(e.stack || e.message));
