#!/usr/bin/env node
/**
 * site-render-islands.test.js — #1826（T2b 留给本票的「整页那格」）：岛在【发布产物的整页】上是活的。
 *
 * T2b 的 islands.test.js 量的是「每个岛一页手写的静态整页」；这里量的是真发布那条路：夹具站 site-blog 经 `site.js render
 * --target live`（manager 发布时 spawn 的就是它）整站出产物 + `--platform-out` 出平台文件，本机静态服务按 R2 的样子摆
 * （站文件在根、平台文件在 /_platform/），假 lead API 收 POST，无头 Chromium 打开真页面：
 *
 *   ① 首页：手机宽度顶栏菜单能开能关、评价轮播能翻页
 *   ② /about/：图库灯箱能开
 *   ③ /contact/：联系表单提交 ⟹ 假 lead API 收到 1 条，body 里的 siteId 是 --site-id 给的那个站
 *   ④ /services/：价格表点 Yearly 能切
 *   ⑤ 每一页 0 个控制台错误；每一页引的 /_platform/* 都 200（发布出去的页面不引 404 的样式表 / 脚本）
 *   ⑥ 变异臂：把 runtime 换成不 hydrate 的那一份（同名）⟹ 表单那一格、价格那一格必须红
 *
 * 跑法:  node scripts/site-render-islands.test.js   （或 `npm run test:scripts`）
 * 退出码: 0 全过 · 1 有失败 · 2 跑不起来（没有 Chromium / esbuild 等，不许当成通过）
 */
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');

const ROOT = path.resolve(__dirname, '..');
let pass = 0;
let fail = 0;
const check = (ok, what) => { if (ok) { pass += 1; console.log(`  ✅ ${what}`); } else { fail += 1; console.log(`  ❌ ${what}`); } };
const die = (why) => { console.log(`🔴 跑不起来: ${why}`); process.exit(2); };

let site; let chromium; let islandsBuild;
try {
  site = require('./site');
  islandsBuild = require('./lib/islands-build');
  require.resolve('esbuild');
  ({ chromium } = require('playwright'));
} catch (e) { die(`载入失败: ${e.message}`); }

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'site-render-islands-'));
const BUNDLE = path.join(ROOT, 'render', 'dist', `test-islands-${process.pid}`);
process.on('exit', () => { fs.rmSync(tmp, { recursive: true, force: true }); fs.rmSync(BUNDLE, { recursive: true, force: true }); });
const FIXTURE = path.join(__dirname, 'fixtures', 'site-fixtures', 'site-blog.json');
const SITE_ID = 'site-isl1826';

function serve(state, posts) {
  const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.webp': 'image/webp', '.jpg': 'image/jpeg' };
  const srv = http.createServer((req, res) => {
    const url = decodeURIComponent((req.url || '/').split('?')[0]);
    if (url === '/api/leads') {
      if (req.method === 'OPTIONS') { res.writeHead(204, { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'Content-Type', 'Access-Control-Allow-Methods': 'POST' }); res.end(); return; }
      let b = '';
      req.on('data', (c) => { b += c; });
      req.on('end', () => { posts.push(b); res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }); res.end('{"ok":true}'); });
      return;
    }
    // 聊天小部件的加载器住在 lead API（manager 的 /widget.js），不在站上 —— 假 lead API 照样给一份空脚本，并记下谁要过它。
    if (url === '/widget.js') { state.widget.push(req.url); res.writeHead(200, { 'Content-Type': 'text/javascript' }); res.end('/* stub */'); return; }
    // R2 的摆法：/_platform/* 是平台文件（所有站共用），其余是这个站的产物（Worker 的 `{siteId}/_live/` 前缀）。
    const base = url.startsWith('/_platform/') ? state.platform : state.out;
    const rel = url.startsWith('/_platform/') ? url : url;
    const f = path.join(base, rel.endsWith('/') ? `${rel}index.html` : rel);
    if (!f.startsWith(base) || !fs.existsSync(f) || !fs.statSync(f).isFile()) { state.missing.push(url); res.writeHead(404); res.end(); return; }
    res.writeHead(200, { 'Content-Type': types[path.extname(f)] || 'application/octet-stream' });
    res.end(fs.readFileSync(f));
  });
  return new Promise((resolve) => srv.listen(0, '127.0.0.1', () => resolve(srv)));
}

async function fillAndSubmit(p, scope) {
  const form = p.locator(`${scope} form`).first();
  for (const el of await form.locator('input:not([type=hidden]):not([tabindex="-1"]), textarea').all()) {
    if (!(await el.isVisible())) continue;
    const type = (await el.getAttribute('type')) || 'text';
    if (type === 'checkbox' || type === 'radio') { await el.check().catch(() => {}); continue; }
    await el.fill(type === 'email' ? 'page@example.com' : type === 'tel' ? '4165550100' : 'Page Tester');
  }
  for (const sel of await form.locator('select').all()) {
    const v = await sel.locator('option').evaluateAll((os) => (os.find((o) => o.value) || {}).value);
    if (v) await sel.selectOption(v);
  }
  await form.locator('button[type=submit]').first().click();
}

async function visit(browser, base, pathname, { mobile = false } = {}, act) {
  const ctx = await browser.newContext({ viewport: mobile ? { width: 390, height: 844 } : { width: 1280, height: 900 } });
  const p = await ctx.newPage();
  const errors = [];
  p.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  p.on('pageerror', (e) => errors.push(e.message));
  // 外网一律不出（演示图片、字体、地图）：回一个空的 200，别让外网的有无变成读数。
  await p.route((u) => !u.hostname.startsWith('127.0.0.1'), (r) => r.fulfill({ status: 200, body: '' }));
  await p.goto(`${base}${pathname}`);
  await p.waitForLoadState('load');
  await p.waitForTimeout(400);
  const r = { errors, ...(await act(p)) };
  await ctx.close();
  return r;
}

async function runAll(browser, base, posts) {
  const out = {};
  out.home = await visit(browser, base, '/', { mobile: true }, async (p) => {
    const toggler = p.locator('header [data-bs-toggle="collapse"]').first();
    const drawer = p.locator('header .collapse, header .collapsing').first();
    const r = { togglerVisible: await toggler.isVisible() };
    await toggler.click();
    await p.waitForTimeout(700);
    r.menuOpened = (await drawer.getAttribute('class') || '').split(/\s+/).includes('show');
    await toggler.click();
    await p.waitForTimeout(700);
    r.menuClosed = !(await drawer.getAttribute('class') || '').split(/\s+/).includes('show');
    // 轮播的岛只是一个 init 占位（blocks/testimonials/Carousel.tsx），控件在同一个块的 section 里。
    const active = () => p.locator('section[data-block="testimonials"] .carousel-item').evaluateAll((xs) => xs.findIndex((x) => x.classList.contains('active')));
    r.before = await active();
    await p.locator('section[data-block="testimonials"] [data-bs-slide="next"]').first().click();
    await p.waitForTimeout(1200);
    r.after = await active();
    return r;
  });
  out.about = await visit(browser, base, '/about/', {}, async (p) => {
    await p.locator('[data-gl-index]').first().click();
    await p.locator('.modal.show').waitFor({ timeout: 5000 }).catch(() => {});
    return { opened: await p.locator('.modal.show').count() };
  });
  out.contact = await visit(browser, base, '/contact/', {}, async (p) => {
    const before = posts.length;
    await fillAndSubmit(p, '[data-island="lead-form"]');
    await p.waitForTimeout(1500);
    return { posted: posts.length - before, body: posts[posts.length - 1] || '', thanks: await p.locator('[data-island="lead-form"] [data-part="form-success"]').count() };
  });
  out.services = await visit(browser, base, '/services/', {}, async (p) => {
    const price = () => p.locator('[data-island="pricing"] [data-part="price"]').first().innerText();
    const r = { priceBefore: await price() };
    await p.locator('[data-island="pricing"] [data-billing-option="yearly"]').click();
    await p.waitForTimeout(300);
    r.billing = await p.locator('[data-island="pricing"] [data-part="billing"]').getAttribute('data-billing');
    r.priceAfter = await price();
    return r;
  });
  return out;
}

(async () => {
  console.log('══ #1826 发布产物整页上的岛 ══');
  const posts = [];
  const state = { out: path.join(tmp, 'out'), platform: path.join(tmp, 'platform'), missing: [], widget: [] };
  const srv = await serve(state, posts);
  const base = `http://127.0.0.1:${srv.address().port}`;
  let browser;
  try {
    try { browser = await chromium.launch(); } catch (e) { die(`Chromium 起不来: ${e.message}`); }
    const r = await site.render({
      content: JSON.parse(fs.readFileSync(FIXTURE, 'utf-8')), out: state.out, platformOut: state.platform, bundleDir: BUNDLE,
      siteId: SITE_ID, leadApi: base, siteUrl: base, target: 'live', version: 5,
    });
    check(r.pages > 10 && fs.existsSync(path.join(state.out, 'contact', 'index.html')), `site.js render 出了 ${r.pages} 页（发布那条路）`);
    const contactHtml = fs.readFileSync(path.join(state.out, 'contact', 'index.html'), 'utf-8');
    for (const [page, isl] of [['index.html', 'testimonials-carousel'], ['about/index.html', 'gallery-lightbox'], ['contact/index.html', 'lead-form'], ['services/index.html', 'pricing'], ['index.html', 'header']]) {
      check(fs.readFileSync(path.join(state.out, page), 'utf-8').includes(`data-island="${isl}"`), `${page} 上有岛 ${isl}（夹具没换掉这几样，下面的格子才有对象）`);
    }

    console.log('\n── ①–⑤ 整页');
    const ok = await runAll(browser, base, posts);
    check(ok.home.togglerVisible && ok.home.menuOpened && ok.home.menuClosed, `首页手机宽度：菜单按钮看得见（${ok.home.togglerVisible}）、能开（${ok.home.menuOpened}）、能关（${ok.home.menuClosed}）`);
    check(ok.home.before === 0 && ok.home.after === 1, `首页评价轮播「下一条」：第 ${ok.home.before + 1} 张 → 第 ${ok.home.after + 1} 张`);
    check(ok.about.opened === 1, `/about/ 图库灯箱能开（${ok.about.opened}）`);
    check(ok.contact.posted === 1 && ok.contact.thanks === 1, `/contact/ 表单提交 ⟹ 假 lead API 收到 ${ok.contact.posted} 条、页面出成功提示（${ok.contact.thanks}）`);
    let body = {};
    try { body = JSON.parse(ok.contact.body); } catch { /* 下一格红 */ }
    check(body.siteId === SITE_ID.replace(/^site-/, '') || body.siteId === SITE_ID, `那条 POST 的 siteId 是 --site-id 给的站（读到 ${JSON.stringify(body.siteId)}；夹具自带的 siteId 不该出现）`);
    check(!/"siteId":"(site-)?bbc4ff97"/.test(contactHtml), '页面里没有夹具 site_meta 自带的 siteId');
    check(ok.services.billing === 'yearly' && ok.services.priceBefore !== ok.services.priceAfter, `/services/ 价格表点 Yearly ⟹ data-billing=${ok.services.billing}，价格 ${ok.services.priceBefore} → ${ok.services.priceAfter}`);
    for (const [name, v] of Object.entries(ok)) check(v.errors.length === 0, `${name}：0 个控制台错误${v.errors.length ? `（${v.errors.slice(0, 2).join(' | ')}）` : ''}`);
    check(state.widget.some((u) => /[?&]site=/.test(u)), `每页的聊天小部件加载器打到 --lead-api 那个地址、带 ?site=（要过 ${state.widget.length} 次）`);
    check(state.missing.length === 0, `本机服务上没有 404（${[...new Set(state.missing)].join(' ') || '无'}）`);
    const platformMisses = state.missing.filter((u) => u.startsWith('/_platform/'));
    check(platformMisses.length === 0, `每一页引的 /_platform/* 都在平台目录里（404：${platformMisses.join(' ') || '无'}）`);

    console.log('\n── ⑥ 变异臂：runtime 不 hydrate');
    const rtName = r.platform.find((p) => /^_platform\/runtime\.[0-9a-f]+\.js$/.test(p));
    const mutDir = path.join(tmp, 'mutant');
    const mut = await islandsBuild.buildRuntime({ outdir: mutDir, noHydrate: true });
    fs.copyFileSync(path.join(mutDir, mut.name), path.join(state.platform, rtName));
    const bad = await runAll(browser, base, posts);
    check(bad.contact.posted === 0, `不 hydrate ⟹ /contact/ 表单没打到 lead API（${bad.contact.posted} 条）—— ③ 那一格靠的确实是岛`);
    check(bad.services.billing !== 'yearly', `不 hydrate ⟹ 价格表不切（data-billing=${bad.services.billing}）—— ④ 那一格靠的确实是岛`);
  } finally {
    if (browser) await browser.close();
    srv.close();
  }
  console.log(`\n══ 汇总: 通过 ${pass} · 失败 ${fail} ══`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(`🔴 跑不起来: ${e.stack}`); process.exit(2); });
