#!/usr/bin/env node
// ══════════════════════════════════════════════════════════════════════════════════════════════════
// footer-new-catalog-check.mjs —— #1455 验收 1 / 2 / 5 / 6 里要浏览器的那几条，对着一台 `next dev` 上的图册跑
// ══════════════════════════════════════════════════════════════════════════════════════════════════
//
//   node scripts/footer-new-catalog-check.mjs http://127.0.0.1:34455 \
//        [--css out/<站>/site.css] [--shots <目录>]
//
// 🔴 **只能对 dev server 跑**：图册是 `page.dev.tsx`，`out/` 里按构造没有它。
// 🔴 `--css`：验收 6 要把两次不同的构建对起来 —— dev 渲染出的图册 DOM × `npm run build` 产出的
//    purged `site.css`（同 `header-new-catalog-check.mjs`：playwright 拦 `/site.css` 的请求换成那份文件）。
// 📌 只看 HTML 就能判的那几条（形态两两不同、选项改 HTML、空列 / 空联系信息）在
//    `scripts/footer-new-render.test.js`，那份进 `npm run test:scripts`；这里只做要几何、要样式表的。
//
// 判什么（每一条失败都点名，最后 exit 1）：
//   ① 验收 1 的几何：勾上 reverse，columns 的品牌列在其余列右边；logo / 一句话 / 社交三样的右边缘都贴着
//      品牌列的右边缘（±2px）—— 不是只把文字右对齐、限宽的段落块还贴在左边。
//   ② 验收 2 在页面上：cta 单选 none / band / bar / row，每格看得见的 CTA 条恰好 0 / 1 个且是选的那种；
//      newsletter 勾上，slim-row 没有、其余三格各看得见 1 个。
//   ③ 验收 5：1440 / 820 / 390。390 上 slim-row 的品牌 / 链接 / 社交上下叠、底栏上下叠；columns 的列
//      390 / 820 两列一行、1440 一行排开；CTA 三种 style 在 390 上按钮上下叠。每一档、每种状态：页脚里
//      每个元素（含文字实际画到哪）都不伸出页脚左右边；单格页 `documentElement.scrollWidth <= innerWidth`。
//   ④ 验收 6：图册 footer-new 那一行每个元素的每个 class，在 `/site.css` + `/shapes.css` 里都有规则
//      （`lib/class-audit.mjs`）。量的状态：默认 / 四种 cta × dark+reverse+newsletter 全勾。

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
  console.error('用法: node scripts/footer-new-catalog-check.mjs <dev server 地址> [--css <site.css>] [--shots <目录>]');
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

const ROW = '[data-catalog-row="footer-new"]';
const cellFooter = (shape, arm = 'full') =>
  `${ROW} [data-catalog-shape="${shape}"] [data-catalog-arm="${arm}"] [data-block="footer-new"]`;

async function openCatalog(width) {
  const page = await newPage(width);
  await page.goto(`${base}/__catalog`, { waitUntil: 'load', timeout: 180000 });
  await page.waitForSelector(`${ROW} [data-catalog-option]:not([disabled])`, { timeout: 60000 });
  return page;
}
const setOption = (page, k, on) => page.$eval(`${ROW} [data-catalog-option="${k}"]`, (el, want) => {
  if (el.checked !== want) el.click();
}, on);
const setCta = (page, s) => page.click(`${ROW} [data-catalog-cta="${s}"]`);
const shapesOn = (page) => page.$$eval(`${ROW} [data-catalog-cell]`, (els) => els.map((e) => e.getAttribute('data-catalog-shape')));

// 页面里跑：一个元素看不看得见。
const VISIBLE = (el) => {
  if (!el) return false;
  const r = el.getBoundingClientRect();
  return r.width > 0 && r.height > 0 && getComputedStyle(el).visibility !== 'hidden';
};

/** 页脚里有没有东西伸出页脚左右边（元素盒 ∪ 文字实际画到哪 —— header 那份 820 踩过的坑）。 */
const overflowOf = (page, shape) => page.$eval(cellFooter(shape), (el) => {
  const edge = el.getBoundingClientRect();
  const out = [];
  for (const n of el.querySelectorAll('*')) {
    const e = n.getBoundingClientRect();
    if (!e.width || !e.height) continue;
    let right = e.right; let left = e.left;
    if (n.childNodes.length && [...n.childNodes].some((c) => c.nodeType === 3 && c.textContent.trim())) {
      const rg = document.createRange(); rg.selectNodeContents(n);
      const t = rg.getBoundingClientRect();
      if (t.width) { right = Math.max(right, t.right); left = Math.min(left, t.left); }
    }
    if (right > edge.right + 1 || left < edge.left - 1) {
      out.push(`${n.tagName.toLowerCase()}「${(n.textContent || '').trim().slice(0, 24)}」${Math.round(left)}→${Math.round(right)}（页脚 ${Math.round(edge.left)}→${Math.round(edge.right)}）`);
    }
  }
  // 零件两两不许相交（同样量「元素盒 ∪ 文字画到哪」：盒子被挤小、nowrap 的字照样画出去压住邻居，
  // 只比盒子读出 0 处重叠 —— header 820 那次就是这样）。祖先 / 后代之间不比。
  const parts = [...el.querySelectorAll('a, button, input, h2, p, li > span, [data-footer-col] > div')]
    .filter((n) => { const r = n.getBoundingClientRect(); return r.width > 0 && r.height > 0; })
    .map((n) => {
      const e = n.getBoundingClientRect();
      const rg = document.createRange(); rg.selectNodeContents(n);
      const t = rg.getBoundingClientRect();
      const has = t.width > 0 && t.height > 0;
      return { n, r: has ? { left: Math.min(e.left, t.left), right: Math.max(e.right, t.right), top: Math.min(e.top, t.top), bottom: Math.max(e.bottom, t.bottom) } : e };
    });
  const name = (n) => (n.textContent || '').trim().slice(0, 20) || n.tagName.toLowerCase();
  for (let i = 0; i < parts.length; i += 1) {
    for (let j = i + 1; j < parts.length; j += 1) {
      const a = parts[i]; const b = parts[j];
      if (a.n.contains(b.n) || b.n.contains(a.n)) continue;
      const x = Math.min(a.r.right, b.r.right) - Math.max(a.r.left, b.r.left);
      const y = Math.min(a.r.bottom, b.r.bottom) - Math.max(a.r.top, b.r.top);
      if (x > 1 && y > 1) out.push(`「${name(a.n)}」×「${name(b.n)}」相交`);
    }
  }
  if (parts.length < 3) out.push(`只量到 ${parts.length} 个零件 —— 相交那一条没量到东西`);
  return out;
});

console.log(`#1455 footer-new 图册检查 · ${base} · site.css = ${cssFile ? `${cssFile}（--css）` : 'dev 自己那份'}`);

// ══ ① ═══════════════════════════════════════════════════════════════════════════════════════════
console.log('① reverse：columns 的品牌列在右、整列贴右');
let shapes = [];
{
  const page = await openCatalog(1440);
  shapes = await shapesOn(page);
  if (shapes.length !== 4) bad(`图册 footer-new 那一行有 ${shapes.length} 格，要 4`);
  else ok(`4 格：${shapes.join(' · ')}`);
  for (const on of [false, true]) {
    await setOption(page, 'reverse', on);
    const g = await page.$eval(cellFooter('columns'), (el) => {
      const r = (q) => { const n = el.querySelector(q); return n ? n.getBoundingClientRect() : null; };
      const brand = r('[data-footer-col="brand"]');
      const svc = r('[data-footer-col="services"]');
      const contact = r('[data-footer-col="contact"]');
      const col = el.querySelector('[data-footer-col="brand"]');
      const kids = [...col.children].map((k) => ({ tag: k.tagName.toLowerCase(), cls: k.className, r: k.getBoundingClientRect() }));
      // 品牌列的内容盒（去掉 Bootstrap 列的左右 padding）
      const cs = getComputedStyle(col);
      const innerL = brand.left + parseFloat(cs.paddingLeft);
      const innerR = brand.right - parseFloat(cs.paddingRight);
      return { brandL: brand.left, brandR: brand.right, svcL: svc.left, contactR: contact.right, innerL, innerR,
        kids: kids.map((k) => ({ tag: k.tag, l: Math.round(k.r.left), r: Math.round(k.r.right) })) };
    });
    const named = ['logo', '一句话', '社交'];
    const edges = g.kids.slice(0, 3);
    if (!on) {
      if (g.brandR <= g.svcL + 1) ok(`默认：品牌列在左（品牌列右边 ${Math.round(g.brandR)} ≤ 服务列左边 ${Math.round(g.svcL)}）`);
      else bad(`默认：品牌列不在左（${Math.round(g.brandL)}→${Math.round(g.brandR)}，服务列从 ${Math.round(g.svcL)} 起）`);
      const off = edges.map((k, i) => [named[i], k.l - g.innerL]).filter(([, d]) => Math.abs(d) > 2);
      if (off.length) bad(`默认：品牌列里这些没贴左边：${off.map(([n, d]) => `${n} 差 ${Math.round(d)}px`).join(' · ')}`);
      else ok(`默认：logo / 一句话 / 社交的左边缘都贴品牌列左边（±2px）`);
    } else {
      if (g.brandL >= g.contactR - 1) ok(`reverse：品牌列在右（品牌列左边 ${Math.round(g.brandL)} ≥ 联系列右边 ${Math.round(g.contactR)}）`);
      else bad(`reverse：品牌列不在右（${Math.round(g.brandL)}→${Math.round(g.brandR)}，联系列到 ${Math.round(g.contactR)}）`);
      const off = edges.map((k, i) => [named[i], g.innerR - k.r]).filter(([, d]) => Math.abs(d) > 2);
      if (off.length) bad(`reverse：品牌列里这些没贴右边：${off.map(([n, d]) => `${n} 差 ${Math.round(d)}px`).join(' · ')}`);
      else ok(`reverse：logo / 一句话 / 社交的右边缘都贴品牌列右边（±2px；${edges.map((k) => k.r).join(' / ')} vs ${Math.round(g.innerR)}）`);
    }
  }
  await setOption(page, 'reverse', false);

  // ══ ② ═════════════════════════════════════════════════════════════════════════════════════════
  console.log('② cta 单选 · newsletter 勾选（看得见的）');
  for (const style of ['none', 'band', 'bar', 'row']) {
    await setCta(page, style);
    for (const s of shapes) {
      const seen = await page.$eval(cellFooter(s), (el, vis) => {
        const v = new Function(`return (${vis})`)();
        return [...el.querySelectorAll('[data-footer-cta]')].filter(v).map((n) => n.getAttribute('data-footer-cta'));
      }, VISIBLE.toString());
      const want = style === 'none' ? [] : [style];
      if (seen.join(',') !== want.join(',')) bad(`cta=${style} · ${s}：看得见的 CTA 条是 [${seen.join(', ')}]，要 [${want.join(', ')}]`);
    }
  }
  ok('cta 四个选项 × 4 格：看得见的 CTA 条都恰好是选的那一种（none 时 0 个）');
  await setCta(page, 'none');
  for (const on of [false, true]) {
    await setOption(page, 'newsletter', on);
    const got = {};
    for (const s of shapes) {
      got[s] = await page.$eval(cellFooter(s), (el, vis) => {
        const v = new Function(`return (${vis})`)();
        return [...el.querySelectorAll('[data-footer-newsletter]')].filter(v).length;
      }, VISIBLE.toString());
    }
    const want = (s) => (on && s !== 'slim-row' ? 1 : 0);
    const wrong = shapes.filter((s) => got[s] !== want(s));
    if (wrong.length) bad(`newsletter ${on ? '勾上' : '不勾'}：${wrong.map((s) => `${s} 看得见 ${got[s]} 个`).join(' · ')}`);
    else ok(`newsletter ${on ? '勾上：slim-row 0 个，其余三格各 1 个' : '不勾：4 格都没有'}`);
  }
  await setOption(page, 'newsletter', false);
  await page.context().close();
}

// ══ ③ ═══════════════════════════════════════════════════════════════════════════════════════════
console.log('③ 三端（1440 / 820 / 390）');
const STATES = [
  { name: '默认', cta: 'none', on: [] },
  { name: 'band + newsletter', cta: 'band', on: ['newsletter'] },
  { name: 'bar + dark + reverse + newsletter', cta: 'bar', on: ['dark', 'reverse', 'newsletter'] },
  { name: 'row + reverse + newsletter', cta: 'row', on: ['reverse', 'newsletter'] },
];
for (const w of [1440, 820, 390]) {
  const before = problems.length;
  const p = await openCatalog(w);
  for (const st of STATES) {
    await setCta(p, st.cta);
    for (const k of ['dark', 'reverse', 'newsletter']) await setOption(p, k, st.on.includes(k));
    for (const s of shapes) {
      const o = await overflowOf(p, s);
      if (o.length) bad(`${w} · ${st.name} · ${s}：伸出页脚 —— ${o.slice(0, 3).join(' · ')}${o.length > 3 ? ' …' : ''}`);
    }
    // 形态自己的断点规矩
    const geo = await p.evaluate(({ row }) => {
      const cell = (s) => document.querySelector(`${row} [data-catalog-shape="${s}"] [data-catalog-arm="full"] [data-block="footer-new"]`);
      const top = (el) => (el ? Math.round(el.getBoundingClientRect().top) : null);
      const slim = cell('slim-row');
      const mainRow = slim.querySelector('.container-lg.py-12 > div');
      // 「在不在一行」按竖向重叠判（竖向居中、高矮不一的盒子 top 本来就不同）：数有几行。
      const rowsOf = (els) => {
        const boxes = els.map((e) => e.getBoundingClientRect()).filter((b) => b.height > 0).sort((x, y) => x.top - y.top);
        let n = 0; let bottom = -Infinity;
        for (const b of boxes) { if (b.top >= bottom - 1) { n += 1; bottom = b.bottom; } else bottom = Math.max(bottom, b.bottom); }
        return n;
      };
      const parts = [...mainRow.children];
      const bar = slim.querySelector('.container-lg.py-12 > div.border-top');
      const barParts = [...bar.children];
      const col = cell('columns');
      const colTops = ['services', 'areas', 'pages', 'contact'].map((k) => top(col.querySelector(`[data-footer-col="${k}"]`)));
      const cta = document.querySelector(`${row} [data-catalog-arm="full"] [data-footer-cta]`);
      const btns = cta ? [...cta.querySelectorAll('a.btn')].map((a) => a.getBoundingClientRect()) : [];
      return { rows: rowsOf(parts), n: parts.length, barRows: rowsOf(barParts), barN: barParts.length, colTops, btnTops: btns.map((b) => Math.round(b.top)) };
    }, { row: ROW });
    const distinct = (a) => new Set(a).size;
    if (w === 390) {
      if (geo.rows !== geo.n) bad(`390 · ${st.name} · slim-row：品牌 / 链接 / 社交没上下叠（${geo.n} 个部件排成 ${geo.rows} 行）`);
      if (geo.barRows !== geo.barN) bad(`390 · ${st.name} · slim-row 底栏没上下叠（${geo.barN} 个部件排成 ${geo.barRows} 行）`);
      if (geo.btnTops.length >= 2 && distinct(geo.btnTops) !== geo.btnTops.length) bad(`390 · ${st.name}：CTA 条的按钮没上下叠（top ${geo.btnTops.join(' / ')}）`);
    } else if (geo.rows !== 1 || geo.barRows !== 1) {
      bad(`${w} · ${st.name} · slim-row：主体 ${geo.rows} 行 / 底栏 ${geo.barRows} 行（768 起都要一行）`);
    }
    const [a, b, c, d] = geo.colTops;
    if (w === 1440 && distinct(geo.colTops) !== 1) bad(`1440 · ${st.name} · columns：四列没一行排开（top ${geo.colTops.join(' / ')}）`);
    if (w !== 1440 && !(a === b && c === d && c > a)) bad(`${w} · ${st.name} · columns：不是两列一行（top ${geo.colTops.join(' / ')}）`);
    if (shotsDir) {
      const tag = st.name.replace(/[^a-z0-9]+/gi, '-');
      await (await p.$(ROW)).screenshot({ path: path.join(shotsDir, `footer-new-row-${w}-${tag}.png`) });
    }
  }
  if (problems.length === before) ok(`${w}：4 种状态 × 4 格逐个量过（不伸出页脚 · 断点排法）`);
  await p.context().close();
  // 横向滚动：单格页（页面上只有这一个块，全填版，带 cta 条 + 订阅框）
  const scroll = [];
  for (const s of shapes) {
    const q = await newPage(w);
    await q.goto(`${base}/__catalog/footer-new/${s}`, { waitUntil: 'load', timeout: 120000 });
    const m = await q.evaluate(() => ({ sw: document.documentElement.scrollWidth, iw: window.innerWidth }));
    if (m.sw > m.iw) bad(`${w} · ${s}：单格页横向滚动（scrollWidth ${m.sw} > ${m.iw}）`);
    else scroll.push(s);
    await q.context().close();
  }
  ok(`${w}：单格页没有横向滚动 ${scroll.length}/4`);
}

// ══ ④ ═══════════════════════════════════════════════════════════════════════════════════════════
console.log('④ 每个 class 在 /site.css + /shapes.css 里都有规则');
const SHEETS = ['/site.css', '/shapes.css'];
{
  const p = await openCatalog(1440);
  const sheetOk = await p.evaluate((want) => want.every((w) => [...document.styleSheets]
    .some((s) => { try { return s.href && new URL(s.href).pathname === w && s.cssRules.length > 0; } catch { return false; } })), SHEETS);
  if (!sheetOk) bad(`页面上 ${SHEETS.join(' / ')} 没有全部加载进来（或是空的）—— 下面的读数不说明任何事`);
  const audit = async (label) => {
    const a = await p.evaluate(classAuditInBrowser, [[], '/theme.css', { scope: `${ROW} [data-block="footer-new"]`, sheets: SHEETS }]);
    if (a.orphans.length) bad(`${label}：${a.orphans.length} 个 class 没有规则 —— ${a.orphans.join(' · ')}`);
    else ok(`${label}：${a.used} 个 class，全都有规则`);
    return a;
  };
  await audit('默认');
  for (const k of ['dark', 'reverse', 'newsletter']) await setOption(p, k, true);
  for (const s of ['band', 'bar', 'row']) { await setCta(p, s); await audit(`dark+reverse+newsletter · cta=${s}`); }
  for (const k of ['dark', 'reverse']) await setOption(p, k, false);
  for (const s of ['band', 'bar', 'row']) { await setCta(p, s); await audit(`亮底 · newsletter · cta=${s}`); }
  await p.context().close();
}

await browser.close();
console.log(`\n${problems.length ? `🔴 ${problems.length} 条不过` : '✅ 全过'}（${readings.length} 条读数）`);
process.exit(problems.length ? 1 : 0);
