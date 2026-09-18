#!/usr/bin/env node
/* global document */
// ══════════════════════════════════════════════════════════════════════════════════════════════════
// bbox-all.js — 一页上**每一个元素**的边界框（#1387 的终判尺子，AC6）
// ══════════════════════════════════════════════════════════════════════════════════════════════════
//
//   node scripts/block-migration/bbox-all.js <baseUrl> <页面路径,逗号分隔> [--widths 1280,375] > out.json
//
// 跟隔壁 `geo.js` 的区别：那一把只量点名的几个部件（搬一个块时够用），这一把把**整页**的元素都量一遍
// —— 本票搬的是整个区块库，「哪几个部件」这个问题本身没有答案。
//
// 每个元素记的是：在 DOM 里的路径（tag + 第几个同类兄弟）· 它的 class · 它的 data-block / data-shape ·
// 边界框**保留两位小数**。🔴 **不许在这里取整**：比的时候要先算「相对所属块左上角的位移」再取整，
//    反过来（先各自取整再相减）会凭空造出 ±1px 的假差异 —— 本票第一版就是那样读出两个假的 1px。
// 🔴 **不记文字内容**：两棵树建出来的页面文字一样，记它只会让 diff 变长。
'use strict';

const { chromium } = require(require('./paths').PLAYWRIGHT_CORE_MODULE);

const [baseUrl, pagesArg] = process.argv.slice(2);
const widthsIdx = process.argv.indexOf('--widths');
const WIDTHS = widthsIdx >= 0 ? process.argv[widthsIdx + 1].split(',').map(Number) : [1280, 375];
if (!baseUrl || !pagesArg) {
  console.error('用法: bbox-all.js <baseUrl> <页面路径,逗号分隔> [--widths 1280,375]');
  process.exit(2);
}
const PAGES = pagesArg.split(',').map((s) => s.trim()).filter(Boolean);

const collect = () => {
  const pathOf = (el) => {
    const parts = [];
    let node = el;
    while (node && node.nodeType === 1 && node.tagName !== 'HTML') {
      const parent = node.parentElement;
      let i = 1;
      if (parent) {
        for (const sib of parent.children) {
          if (sib === node) break;
          if (sib.tagName === node.tagName) i += 1;
        }
      }
      parts.unshift(`${node.tagName.toLowerCase()}[${i}]`);
      node = parent;
    }
    return parts.join('/');
  };
  const out = [];
  for (const el of document.querySelectorAll('body *')) {
    const r = el.getBoundingClientRect();
    out.push([
      pathOf(el),
      el.getAttribute('class') || '',
      el.getAttribute('data-block') || '',
      el.getAttribute('data-shape') || '',
      r.x.toFixed(2), r.y.toFixed(2), r.width.toFixed(2), r.height.toFixed(2),
    ].join('|'));
  }
  return out;
};

(async () => {
  const browser = await chromium.launch();
  const result = {};
  for (const width of WIDTHS) {
    const page = await browser.newPage({ viewport: { width, height: 900 } });
    for (const p of PAGES) {
      const url = `${baseUrl.replace(/\/$/, '')}${p}`;
      const resp = await page.goto(url, { waitUntil: 'load' });
      if (!resp || !resp.ok()) {
        console.error(`🔴 ${url} → ${resp ? resp.status() : '(no response)'}`);
        process.exit(2);
      }
      // 🔴 等字体：字体还没到位时行高会变，两棵树各等各的就会读出一堆假差异。
      await page.evaluate(() => document.fonts.ready);
      result[`${width}px ${p}`] = await page.evaluate(collect);
    }
    await page.close();
  }
  await browser.close();
  const total = Object.values(result).reduce((n, a) => n + a.length, 0);
  console.error(`量了 ${Object.keys(result).length} 组（视口 × 页面）· ${total} 个元素`);
  process.stdout.write(`${JSON.stringify(result, null, 0)}\n`);
})();
