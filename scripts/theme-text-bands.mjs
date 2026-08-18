#!/usr/bin/env node
// theme-text-bands.mjs — 量一件**几何**上的事：一段字压在渐变底色的哪一段上（#1038 r3）。
//
//   node scripts/theme-text-bands.mjs <baseUrl> <表名> [--write]
//     例：node scripts/theme-text-bands.mjs http://127.0.0.1:8730 hero-media-top --write
//
//   退出 0 = 量到了（--write 时已并进 scripts/theme-text-bands.json）
//   退出 2 = 量不到（没有 playwright / 页面打不开 / 那张表在磁盘上找不到）。**不是 0。**
//
// ══ 这个读数是给谁用的 ═════════════════════════════════════════════════════════════════════════
//
// `scripts/theme-presets.test.js` 要在**不起浏览器**的前提下判「这组配色 × 色相滑块的 31 个取值，
// 页面上的字还读得出来吗」。底色是纯色时不用几何：值就是值。底色是**渐变**时才需要 —— 整条渐变
// 上离字最远的那一端根本没有字压着（violet 那条最远端只有 2.61:1），把整条都算进去会红在一个
// 不存在的地方。所以只有「整条渐变都算进去仍然过」这个上界不成立时，才回来查这份读数。
//
// ══ 🔴 为什么这件事可以量一次就存下来 ═══════════════════════════════════════════════════════════
//
// **它跟颜色无关。** 一个块的渐变轴、字的框在这条轴上占哪一段，全是布局决定的；换一组配色、拖一次
// 色相滑块，这些数一个都不动。所以它是主题表的性质，不是配色的性质 —— 而配色是天天在改的那一头。
//
// 🔴 **表变了这份读数就作废，而作废必须是响的**：JSON 里存着每张表的 md5，`theme-presets.test.js`
//    对不上就当场红并叫人重跑这个脚本。默认方向是红，不是「用旧的接着算」。
//
// ══ 🔴 量的是「这张表允许的最宽」，不是「这个演示站恰好排成的样子」═════════════════════════════
//
// 字的框有多宽，取决于站里那句话有多长 —— 那是站的事，不是表的事。所以量之前先把框撑到它自己的
// `max-width`（computed 值是个长度时）。演示站那句话短，`.cta-banner__desc` 实测 310px，而表给它的
// 上限是 36rem = 576px：按 310px 存下来的段，换个话多的站就不够用了，而失败方向是**变绿**。
//
// 📌 **还剩一个没被这条盖住的假设**：框的**高**仍然来自演示站（话长到多折两行，块会变高，段也会变宽
// 一点）。没有把它也撑到极限，是因为「最多折几行」没有上限可言。这一层的兜底是别处的余量：判的时候
// 用的是段里**真正最差的那个点**（比浏览器那道检查更严，它把这么浅的一条渐变整段归成一个颜色、报的
// 是中间那个值），字还额外往底色里混了一档抗锯齿。三处余量叠起来，比这条假设的动静大。

import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { PLAYWRIGHT_MODULE, NEXT_DIR } from './theme-gallery/paths.mjs';

const require = createRequire(import.meta.url);
const { MEASURED_TARGETS } = require('./theme-text-targets.js');

const [baseUrl, sheet] = process.argv.slice(2);
const write = process.argv.includes('--write');
if (!baseUrl || !sheet) {
  console.error('usage: node scripts/theme-text-bands.mjs <baseUrl> <sheet-name> [--write]');
  process.exit(2);
}
const sheetFile = path.join(NEXT_DIR, 'public', 'themes', `${sheet}.css`);
if (!fs.existsSync(sheetFile)) {
  console.error(`🔴 找不到主题表 ${sheetFile}`);
  process.exit(2);
}
const sheetMd5 = crypto.createHash('md5').update(fs.readFileSync(sheetFile)).digest('hex');

const { chromium } = await import(PLAYWRIGHT_MODULE);
// 🔴 跟 `theme-css-invariants.mjs` 同一个视口。几何读数换个视口就是另一个数，两边必须一致。
// 🔴 #1068 条 1 —— 这一行原来写的是 `:168`，而那个行号早就指到别的内容上去了。跨文件引用一律用
//    **锚点**，不用行号：`grep -n 'newContext({ viewport' scripts/theme-css-invariants.mjs`
const VIEWPORT = { width: 1440, height: 900 };

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: VIEWPORT, deviceScaleFactor: 1 });
const page = await ctx.newPage();

/** 站自己的 sitemap 给页面清单 —— 跟检查器 ⑤b 那一圈走的是同一批页面。 */
async function pagesOf() {
  const out = ['/'];
  try {
    const res = await page.goto(new URL('/sitemap.xml', baseUrl).href, { waitUntil: 'domcontentloaded' });
    const xml = res && res.ok() ? await res.text() : '';
    for (const m of xml.matchAll(/<loc>([^<]+)<\/loc>/g)) {
      const p = new URL(m[1]).pathname;
      if (p !== '/' && !out.includes(p)) out.push(p);
    }
  } catch { /* 没有 sitemap 就只走首页 */ }
  return out;
}

/* global document, getComputedStyle */
// 🔴 下面这个函数是交给 `page.evaluate` 的，**函数体跑在浏览器里，不在 node 里**。
// `theme-css-invariants.mjs` 为同一个理由带着同一句声明：少了它，eslint 的 no-undef 会把
// `document` / `getComputedStyle` 当成拼错的名字。锚点（#1068 条 1，别写行号）：
//    `grep -n 'global document' scripts/theme-css-invariants.mjs`
const IN_PAGE = (targets) => {
  const res = [];
  for (const sel of targets) {
    const el = document.querySelector(sel);
    if (!el) continue;
    // 撑到这张表允许的最宽（见文件头）。量完还原，别把页面留在改过的状态上。
    const before = el.style.width;
    const maxW = getComputedStyle(el).maxWidth;
    if (/^[\d.]+px$/.test(maxW)) el.style.width = maxW;
    let bgEl = null;
    let bgImg = null;
    for (let n = el; n && n !== document.documentElement; n = n.parentElement) {
      const cs = getComputedStyle(n);
      if (cs.backgroundImage && cs.backgroundImage !== 'none') { bgEl = n; bgImg = cs.backgroundImage; break; }
      if (cs.backgroundColor && cs.backgroundColor !== 'rgba(0, 0, 0, 0)') break;   // 纯色底，不需要几何
    }
    if (bgEl && /linear-gradient\(/.test(bgImg)) {
      const gb = bgEl.getBoundingClientRect();
      const tb = el.getBoundingClientRect();
      // CSS 的角度：0deg 指向上，顺时针。渐变线过盒子中心，长度 = |W·sinA| + |H·cosA|。
      const m = /linear-gradient\(\s*([-\d.]+)deg/.exec(bgImg);
      const A = m ? parseFloat(m[1]) : 180;
      const rad = (A * Math.PI) / 180;
      const dx = Math.sin(rad);
      const dy = -Math.cos(rad);
      const L = Math.abs(gb.width * Math.sin(rad)) + Math.abs(gb.height * Math.cos(rad));
      const cx = gb.left + gb.width / 2;
      const cy = gb.top + gb.height / 2;
      const tOf = (x, y) => 0.5 + ((x - cx) * dx + (y - cy) * dy) / L;
      const ts = [[tb.left, tb.top], [tb.right, tb.top], [tb.left, tb.bottom], [tb.right, tb.bottom]]
        .map(([x, y]) => tOf(x, y));
      res.push({
        selector: sel,
        tmin: Math.max(0, Math.min(...ts)),
        tmax: Math.min(1, Math.max(...ts)),
        angle: A,
        gradientBox: [Math.round(gb.width), Math.round(gb.height)],
        textBox: [Math.round(tb.width), Math.round(tb.height)],
        // 🔴 记的是**画底色的那个块是谁**，不是它当时算出来的颜色 —— 颜色随配色天天变，
        // 存一个当时的颜色字符串，下一个读这份文件的人会看到一组早就不在库里的值。
        paintedBy: bgEl.className || bgEl.tagName.toLowerCase(),
      });
    }
    el.style.width = before;
  }
  return res;
};

/**
 * 一条路径实际该访问哪个 URL。
 *
 * 🔴 `output: 'export'` 写出来的是 `out/about.html`，**同时**还写一个 `out/about/` 目录装 RSC
 * 载荷 —— 直接开 `/about` 在静态服务器上拿到的不是那张页面。所以先试 `<路径>.html`，再试干净路径
 * （真正的线上 host 没有 `.html` 可给）。这条规矩跟 `theme-css-invariants.mjs` 里的 `openPage()`
 * 是同一条（锚点，别写行号 —— #1068 条 1：`grep -n 'const openPage' scripts/theme-css-invariants.mjs`）；
 * 第一版没有它，结果 `.page-header__*` 在**每一张表上都没被量到**，而脚本一声不吭地走完了。
 */
async function open(p) {
  const clean = p.replace(/\/$/, '');
  const candidates = (p === '/' || p.endsWith('.html') || clean === '') ? [p] : [`${clean}.html`, p];
  for (const c of candidates) {
    const res = await page.goto(new URL(c, baseUrl).href, { waitUntil: 'networkidle' }).catch(() => null);
    if (res && res.ok()) return c;
  }
  return null;
}

const found = new Map();
const seenOn = new Map();
for (const p of await pagesOf()) {
  const at = await open(p);
  if (!at) { console.error(`⚠️  打不开 ${p} —— 这一页没被量到`); continue; }
  for (const r of await page.evaluate(IN_PAGE, MEASURED_TARGETS)) {
    const prev = found.get(r.selector);
    // 同一个选择器在多页出现时取**并集** —— 哪一页更宽就按哪一页算
    found.set(r.selector, prev
      ? { ...r, tmin: Math.min(prev.tmin, r.tmin), tmax: Math.max(prev.tmax, r.tmax) }
      : r);
    seenOn.set(r.selector, [...(seenOn.get(r.selector) || []), at]);
  }
}
await browser.close();

const targets = {};
for (const [sel, r] of found) {
  targets[sel] = {
    tmin: Number(r.tmin.toFixed(4)),
    tmax: Number(r.tmax.toFixed(4)),
    angle: r.angle,
    gradientBox: r.gradientBox,
    textBox: r.textBox,
    paintedBy: r.paintedBy,
    pages: seenOn.get(sel),
  };
}
const entry = { md5: sheetMd5, viewport: VIEWPORT, measuredOn: baseUrl, targets };

if (!Object.keys(targets).length) {
  console.log(`${sheet}: 没有一段字压在渐变上 —— 这张表不需要几何读数。`);
} else {
  for (const [sel, t] of Object.entries(targets)) {
    console.log(`${sheet} ${sel.padEnd(24)} t ∈ [${t.tmin}, ${t.tmax}]  框 ${t.textBox.join('×')}`
      + `  渐变盒 ${t.gradientBox.join('×')} @${t.angle}deg  页面 ${t.pages.join(', ')}`);
  }
}

const outFile = path.join(NEXT_DIR, 'scripts', 'theme-text-bands.json');
if (write) {
  const doc = fs.existsSync(outFile) ? JSON.parse(fs.readFileSync(outFile, 'utf8')) : { sheets: {} };
  doc.sheets[sheet] = entry;
  fs.writeFileSync(outFile, `${JSON.stringify(doc, null, 2)}\n`);
  console.log(`写进 ${path.relative(NEXT_DIR, outFile)}（${sheet}，表 md5 ${sheetMd5.slice(0, 8)}）`);
} else {
  console.log('（没加 --write，没有落盘）');
}
