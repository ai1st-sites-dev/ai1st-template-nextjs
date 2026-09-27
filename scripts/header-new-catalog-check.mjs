#!/usr/bin/env node
// ══════════════════════════════════════════════════════════════════════════════════════════════════
// header-new-catalog-check.mjs —— #1424 验收 2 / 3 / 4，对着一台 `next dev` 上的图册跑
// ══════════════════════════════════════════════════════════════════════════════════════════════════
//
//   node scripts/header-new-catalog-check.mjs http://127.0.0.1:34240 \
//        [--css out/<站>/site.css] [--shots <目录>]
//
// 🔴 **只能对 dev server 跑**：图册是 `page.dev.tsx`，`out/` 里按构造没有它（next.config.js 的
//    `pageExtensions`）。
// 🔴 `--css`：验收 4 要把**两次不同的构建**对起来 —— dev 渲染出的图册 DOM × `npm run build` 产出的
//    purged `site.css`。给了这个参数，页面请求 `/site.css` 时拿到的是那一份文件的字节（playwright 拦请求），
//    不是 dev 那次 sync-config 写的那份。不给就用 dev 自己的（报告里写明是哪一份）。
//
// 判什么（每一条失败都点名，最后 exit 1）：
//   ② 同一份夹具数据下 6 个形态渲染出的 HTML 两两不同；三个勾选各勾一次，每个形态的 HTML 都变；
//      勾上 reverse 后 logo-left 的 logo 在菜单右边（量 getBoundingClientRect）。
//   ③ 1440 / 820 / 390：每一档 logo / 菜单项 / 按钮两两不相交、不伸出顶栏；820 上 6 个形态都是整条菜单、没汉堡、副 CTA 不在；390 上汉堡在、点开之后菜单里
//      有副 CTA；stacked-topbar 390 上顶条不在；三档都没有横向滚动（单格页 `/__catalog/header-new/<形态>`
//      上量 `documentElement.scrollWidth <= innerWidth`，跟 theme-css-invariants 那条同一个判法）。
//   ④ 图册 header-new 那一行里每个元素的每个 class，在 `/site.css` + `/shapes.css` 里都有规则
//      （`lib/class-audit.mjs`，theme-css-invariants ⑤ 用的同一个函数）。量的状态：默认 / 三个勾选全勾 /
//      390 下菜单点开 —— 只在某个状态里才出现的 class，不量那个状态就量不到。

import fs from 'node:fs';
import path from 'node:path';
import { PLAYWRIGHT_MODULE } from './theme-gallery/paths.mjs';
import { classAuditInBrowser } from './lib/class-audit.mjs';

const args = process.argv.slice(2);
const base = (args.find((a) => /^https?:\/\//.test(a)) || '').replace(/\/$/, '');
const opt = (name) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : undefined; };
const cssFile = opt('--css');
const shotsDir = opt('--shots');
if (!base) {
  console.error('用法: node scripts/header-new-catalog-check.mjs <dev server 地址> [--css <site.css>] [--shots <目录>]');
  process.exit(2);
}
if (cssFile && !fs.existsSync(cssFile)) { console.error(`--css ${cssFile} 不存在`); process.exit(2); }
if (shotsDir) fs.mkdirSync(shotsDir, { recursive: true });

const { chromium } = await import(PLAYWRIGHT_MODULE);
const browser = await chromium.launch();
const problems = [];
const readings = [];
const bad = (m) => { problems.push(m); console.log(`  ❌ ${m}`); };
const ok = (m) => { readings.push(m); console.log(`  ✅ ${m}`); };

async function newPage(width) {
  const ctx = await browser.newContext({ viewport: { width, height: 900 } });
  const page = await ctx.newPage();
  if (cssFile) {
    const bytes = fs.readFileSync(cssFile);
    await page.route('**/site.css', (r) => r.fulfill({ status: 200, contentType: 'text/css', body: bytes }));
  }
  return page;
}

const ROW = '[data-catalog-row="header-new"]';
const cellHeader = (shape, arm = 'full') =>
  `${ROW} [data-catalog-shape="${shape}"] [data-catalog-arm="${arm}"] [data-block="header-new"]`;

async function openCatalog(width) {
  const page = await newPage(width);
  await page.goto(`${base}/__catalog`, { waitUntil: 'load', timeout: 180000 });
  await page.waitForSelector(`${ROW} [data-catalog-option]:not([disabled])`, { timeout: 60000 });
  return page;
}

const shapesOn = (page) => page.$$eval(`${ROW} [data-catalog-cell]`, (els) => els.map((e) => e.getAttribute('data-catalog-shape')));
const htmlOf = (page, shape) => page.$eval(cellHeader(shape), (el) => el.outerHTML);
const setOption = (page, k, on) => page.$eval(`${ROW} [data-catalog-option="${k}"]`, (el, want) => {
  if (el.checked !== want) el.click();
}, on);

console.log(`#1424 header-new 图册检查 · ${base} · site.css = ${cssFile ? `${cssFile}（--css）` : 'dev 自己那份'}`);

// ══ ② ═══════════════════════════════════════════════════════════════════════════════════════════
console.log('② 6 个形态互不相同 · 三个选项各自改 HTML · reverse 的方向');
const page = await openCatalog(1440);
const shapes = await shapesOn(page);
if (shapes.length !== 6) bad(`图册 header-new 那一行有 ${shapes.length} 格，要 6`);
else ok(`6 格：${shapes.join(' · ')}`);
const base0 = {};
for (const s of shapes) base0[s] = await htmlOf(page, s);
const distinct = new Set(Object.values(base0)).size;
if (distinct !== shapes.length) bad(`默认状态下 ${shapes.length} 个形态只有 ${distinct} 种不同的 HTML`);
else ok(`默认状态下 ${shapes.length} 个形态的 HTML 两两不同（${distinct} 种）`);
for (const k of ['dark', 'icons', 'reverse']) {
  await setOption(page, k, true);
  const same = [];
  for (const s of shapes) if ((await htmlOf(page, s)) === base0[s]) same.push(s);
  if (same.length) bad(`勾上 ${k} 之后这些形态的 HTML 没变：${same.join(' · ')}`);
  else ok(`勾上 ${k}：6 个形态的 HTML 全都变了`);
  if (k === 'reverse') {
    const pos = await page.$eval(cellHeader('logo-left'), (el) => {
      const logo = el.querySelector('.hdr-logo').getBoundingClientRect();
      const nav = el.querySelector('.hdr-right .navbar-nav').getBoundingClientRect();
      const dir = getComputedStyle(el.querySelector('.hdr-logo').parentElement).flexDirection;
      return { logoX: Math.round(logo.left), navX: Math.round(nav.left), dir };
    });
    if (pos.logoX > pos.navX && pos.dir === 'row-reverse') ok(`reverse：logo-left 的 logo x=${pos.logoX} 在菜单 x=${pos.navX} 右边（flex-direction: ${pos.dir}）`);
    else bad(`reverse：logo-left 的 logo x=${pos.logoX}、菜单 x=${pos.navX}、flex-direction=${pos.dir} —— 要 logo 在右`);
  }
  await setOption(page, k, false);
}
// 三个网格形态 reverse 之后仍然只有一行（坑 3：每格要钉 grid-row: 1）
await setOption(page, 'reverse', true);
let oneRow = true;
for (const s of shapes) {
  const rows = await page.$eval(cellHeader(s), (el) => {
    const row = el.querySelector('.hdr-logo').parentElement;
    const kids = [...row.querySelectorAll(':scope > .hdr-left, :scope > .hdr-logo, :scope > .hdr-right')]
      .filter((k) => getComputedStyle(k).display !== 'none');
    // 按竖向是否重叠分行：三个盒子高矮不一、竖向居中，所以不比 top，比「下一个的顶在不在上一行的底之上」。
    const boxes = kids.map((k) => k.getBoundingClientRect()).sort((x, y) => x.top - y.top);
    let n = 0; let bottom = -Infinity;
    for (const b of boxes) { if (b.top >= bottom - 1) { n += 1; bottom = b.bottom; } else bottom = Math.max(bottom, b.bottom); }
    return n;
  });
  if (rows > 1) { bad(`reverse：${s} 的三个盒子排成了 ${rows} 行（要 1 行）`); oneRow = false; }
}
if (oneRow) ok('reverse：6 个形态的三个盒子都还在同一行');
await setOption(page, 'reverse', false);
await page.context().close();

// ══ ③ ═══════════════════════════════════════════════════════════════════════════════════════════
console.log('③ 三端行为（1440 / 820 / 390）');
const visible = (el) => !!el && getComputedStyle(el).display !== 'none' && el.getBoundingClientRect().width > 0;
for (const w of [1440, 820, 390]) {
  const before = problems.length;
  const p = await openCatalog(w);
  if (shotsDir) {
    const row = await p.$(ROW);
    await row.screenshot({ path: path.join(shotsDir, `header-new-row-${w}.png`) });
  }
  for (const s of shapes) {
    const r = await p.$eval(cellHeader(s), (el, fnSrc) => {
      // eslint-disable-next-line no-new-func
      const vis = new Function(`return (${fnSrc})`)();
      const burger = el.querySelector('button[aria-label="Toggle navigation menu"]');
      const navs = [...el.querySelectorAll('.navbar .navbar-nav')].filter(vis);
      const cta2 = [...el.querySelectorAll('.navbar a.btn')].filter((a) => a.textContent.trim() === 'Call us');
      const topbar = el.querySelector(':scope > .border-bottom.py-2');
      // 🔴 #1424 820 实测过的那种坏：菜单压到店名上，而「菜单项 6 个、没汉堡」照样全绿。
      //    所以逐对量：logo、每个菜单项、每个按钮、顶条每一项，两两不许相交，也不许伸出顶栏右边。
      const parts = [...el.querySelectorAll('.hdr-logo, .navbar a, .navbar button.btn, :scope > .border-bottom.py-2 span, :scope > .border-bottom.py-2 a')]
        .filter(vis).map((n) => {
          // 🔴 量的是【元素盒 ∪ 字实际画到哪】，不是只量元素盒：网格那一栏缩得比字窄时，字溢出盒子、
          //    盒子本身不相交 —— 820 上店名压住「About the shop」那次，元素盒量出来右边 472、字画到 499，
          //    只比盒子的版本对着那张坏截图读出 0 处重叠（反向跑实测）。
          const e = n.getBoundingClientRect();
          const rg = document.createRange(); rg.selectNodeContents(n);
          const t = rg.getBoundingClientRect();
          const has = t.width > 0 && t.height > 0;
          return { n, r: has ? { left: Math.min(e.left, t.left), right: Math.max(e.right, t.right), top: Math.min(e.top, t.top), bottom: Math.max(e.bottom, t.bottom) } : e };
        });
      const edge = el.getBoundingClientRect();
      const hits = [];
      const name = (n) => (n.textContent || '').trim().slice(0, 24) || n.className.split(' ')[0];
      for (let i = 0; i < parts.length; i += 1) {
        const a = parts[i];
        if (a.r.right > edge.right + 1 || a.r.left < edge.left - 1) hits.push(`「${name(a.n)}」伸出顶栏`);
        for (let j = i + 1; j < parts.length; j += 1) {
          const b = parts[j];
          if (a.n.contains(b.n) || b.n.contains(a.n)) continue;
          const x = Math.min(a.r.right, b.r.right) - Math.max(a.r.left, b.r.left);
          const y = Math.min(a.r.bottom, b.r.bottom) - Math.max(a.r.top, b.r.top);
          if (x > 1 && y > 1) hits.push(`「${name(a.n)}」×「${name(b.n)}」`);
        }
      }
      return {
        overlaps: hits,
        parts: parts.length,
        burger: vis(burger),
        navItems: navs.reduce((n, u) => n + [...u.querySelectorAll(':scope > li')].filter(vis).length, 0),
        cta2: cta2.some(vis),
        topbar: topbar ? vis(topbar) : null,
      };
    }, visible.toString());
    // 390 上只剩 logo + 汉堡两样；少于 2 就是这把尺没量到东西。
    if (r.parts < 2) bad(`${w} · ${s}：只量到 ${r.parts} 个零件 —— 重叠那一条没量到东西`);
    if (r.overlaps.length) bad(`${w} · ${s}：零件压在一起 —— ${r.overlaps.slice(0, 4).join(' · ')}${r.overlaps.length > 4 ? ' …' : ''}`);
    if (w === 820) {
      if (r.burger) bad(`820 · ${s}：汉堡出现了（iPad 竖屏要整条菜单）`);
      if (r.navItems !== 6) bad(`820 · ${s}：看得见的菜单项 ${r.navItems} 个，要 6`);
      if (r.cta2) bad(`820 · ${s}：副 CTA 还在（768–991 要藏）`);
    }
    if (w === 1440) {
      if (r.burger) bad(`1440 · ${s}：汉堡出现了`);
      if (r.navItems !== 6) bad(`1440 · ${s}：看得见的菜单项 ${r.navItems} 个，要 6`);
      if (!r.cta2) bad(`1440 · ${s}：副 CTA 不在`);
    }
    if (w === 390) {
      if (!r.burger) bad(`390 · ${s}：没有汉堡`);
      if (r.navItems !== 0) bad(`390 · ${s}：菜单没收起来（看得见 ${r.navItems} 项）`);
      if (s === 'stacked-topbar' && r.topbar !== false) bad(`390 · stacked-topbar：顶条还在（${r.topbar}）`);
      // 点开
      await p.click(`${cellHeader(s)} button[aria-label="Toggle navigation menu"]`);
      const menu = await p.$eval(cellHeader(s), (el) => {
        const panel = el.querySelector(':scope > .d-md-none');
        if (!panel) return null;
        return { items: panel.querySelectorAll('.navbar-nav > li').length, cta2: [...panel.querySelectorAll('a.btn')].some((a) => a.textContent.trim() === 'Call us') };
      });
      if (!menu) bad(`390 · ${s}：点了汉堡，菜单没出来`);
      else if (menu.items !== 6 || !menu.cta2) bad(`390 · ${s}：点开的菜单里 ${menu.items} 项、副 CTA ${menu.cta2 ? '在' : '不在'}（要 6 项且副 CTA 在）`);
    }
  }
  if (problems.length === before) ok(`${w}：6 个形态逐个量过，全过`);
  if (shotsDir && w === 390) {
    const row = await p.$(ROW);
    await row.screenshot({ path: path.join(shotsDir, `header-new-row-${w}-open.png`) });
  }
  await p.context().close();
  // 横向滚动：单格页（页面上只有这一个块）
  const scroll = [];
  for (const s of shapes) {
    const q = await newPage(w);
    await q.goto(`${base}/__catalog/header-new/${s}`, { waitUntil: 'load', timeout: 120000 });
    const m = await q.evaluate(() => ({ sw: document.documentElement.scrollWidth, iw: window.innerWidth }));
    if (m.sw > m.iw) bad(`${w} · ${s}：横向滚动（scrollWidth ${m.sw} > ${m.iw}）`);
    else scroll.push(s);
    await q.context().close();
  }
  ok(`${w}：单格页没有横向滚动 ${scroll.length}/6`);
}

// ══ ④ ═══════════════════════════════════════════════════════════════════════════════════════════
console.log('④ 每个 class 在 /site.css + /shapes.css 里都有规则');
const SHEETS = ['/site.css', '/shapes.css'];
const auditOnce = async (p, label) => {
  const a = await p.evaluate(classAuditInBrowser, [[], '/theme.css', { scope: `${ROW} [data-block="header-new"]`, sheets: SHEETS }]);
  if (a.orphans.length) bad(`${label}：${a.orphans.length} 个 class 没有规则 —— ${a.orphans.join(' · ')}`);
  else ok(`${label}：${a.used} 个 class，全都有规则（从 ${SHEETS.join(' + ')} 收）`);
  return a;
};
{
  const p = await openCatalog(1440);
  const sheetOk = await p.evaluate((want) => want.every((w) => [...document.styleSheets]
    .some((s) => { try { return s.href && new URL(s.href).pathname === w && s.cssRules.length > 0; } catch { return false; } })), SHEETS);
  if (!sheetOk) bad(`页面上 ${SHEETS.join(' / ')} 没有全部加载进来（或是空的）—— 下面的读数不说明任何事`);
  await auditOnce(p, '1440 默认');
  for (const k of ['dark', 'icons', 'reverse']) await setOption(p, k, true);
  await auditOnce(p, '1440 三个勾选全勾');
  await p.context().close();
  const m = await openCatalog(390);
  for (const k of ['dark', 'icons']) await setOption(m, k, true);
  for (const s of shapes) await m.click(`${cellHeader(s)} button[aria-label="Toggle navigation menu"]`);
  await auditOnce(m, '390 dark+icons、6 格菜单全点开');
  await m.context().close();
}

await browser.close();
console.log(`\n${problems.length ? `🔴 ${problems.length} 条不过` : '✅ 全过'}（${readings.length} 条读数）`);
process.exit(problems.length ? 1 : 0);
