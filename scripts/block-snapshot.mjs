#!/usr/bin/env node
/**
 * block-snapshot.mjs — 块的「改前改后一点不变」那把尺子（#1534 AC2；#1533 / #1535 / #1536 同一条 AC，直接调它）。
 *
 *   node scripts/block-snapshot.mjs capture --base http://127.0.0.1:3534 --out /tmp/snap-before [--blocks pricing,cta]
 *   node scripts/block-snapshot.mjs compare /tmp/snap-before /tmp/snap-after --noise /tmp/snap-before-2 [--also /tmp/snap-after-2]
 *   退出码: 0 相同（capture：取完）· 1 有差异 · 2 跑不起来（**不许当成通过**）
 *
 * ── 量什么 ──────────────────────────────────────────────────────────────────────────────────────
 * 每个块（`blocks/` 下有 manifest 的目录，磁盘现取）的**每个预设**（manifest 的 `presets[]`，一个预设 = 一个形态目录），
 * 打单格页 `/__catalog/<块>/<形态>?embed=1&theme=azure-29&bg=<底>`，两种底（浅 `#ffffff` · 深 `#0f172a`）：
 *   ① HTML：页面里第一个 `[data-block]` 的 outerHTML，逐字比。便宜、射程满，但看不见 CSS。
 *   ② 截图：1440 与 390 两个宽度，整页 PNG，逐字节比。治 HTML 看不见的那一半（CSS 收拢后类名没变、层级变了）。
 * 每块的格数 = 预设数 × 2 底；截图再 × 2 宽。分母打在输出里，一个块都没取到就是 2。
 *
 * 🔴 两把尺子都要先过「同一棵树取两次」的噪声对照：开工时对改前的树连取两次 compare 必须 0 差异，
 *    否则下面读到的差异分不清是改动还是噪声（动画 / 字体 / 懒加载图）。截图前关掉 transition / animation
 *    并等字体与网络静下来，就是为了让这一步读 0。
 * 🔴 阳性对照要取在**改动之前**那一侧：改前的树上临时塞一处 1px 的改动、取一份，compare 必须报出来。
 *
 * 不管的：dev server 由调用的人起（`node scripts/sync-config.js && npx next dev --webpack -p <端口>`，
 * `page.dev.tsx` 只在 `next dev` 下是一个页面）。浏览器从 `scripts/theme-gallery/paths.mjs` 的 PLAYWRIGHT_MODULE 取。
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const BLOCKS = path.resolve(HERE, '..', 'blocks');
const BGS = { light: '#ffffff', dark: '#0f172a' };
const WIDTHS = [1440, 390];
const DEFAULT_ARGS = '--font-render-hinting=none --disable-font-subpixel-positioning --disable-lcd-text --disable-gpu --force-color-profile=srgb';

const die = (m) => { console.error(`🔴 跑不起来: ${m}`); process.exit(2); };
const arg = (name) => { const i = process.argv.indexOf(`--${name}`); return i > 0 ? process.argv[i + 1] : undefined; };

/** 全部块 × 预设，磁盘现取。 */
function cells(only) {
  const out = [];
  for (const b of fs.readdirSync(BLOCKS, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name).sort()) {
    if (only && !only.includes(b)) continue;
    const mf = path.join(BLOCKS, b, 'manifest.json');
    if (!fs.existsSync(mf)) continue;
    const presets = JSON.parse(fs.readFileSync(mf, 'utf8')).presets || [];
    for (const p of presets) out.push({ block: b, shape: p.shape, preset: p.name });
  }
  return out;
}

async function capture() {
  const base = arg('base');
  const out = arg('out');
  if (!base || !out) die('capture 要 --base <dev server> 和 --out <目录>');
  const only = arg('blocks') ? arg('blocks').split(',') : null;
  const list = cells(only);
  if (!list.length) die('一个预设都没读到 —— 分母为 0，下面的「相同」不作数');
  const { PLAYWRIGHT_MODULE } = await import('./theme-gallery/paths.mjs');
  let chromium;
  try { ({ chromium } = await import(PLAYWRIGHT_MODULE)); } catch (e) { die(`playwright 加载不了（${PLAYWRIGHT_MODULE}）：${e.message.split('\n')[0]}`); }
  if (!chromium || typeof chromium.launch !== 'function') die(`${PLAYWRIGHT_MODULE} 不是 playwright`);
  fs.mkdirSync(out, { recursive: true });
  // 字形光栅化固定下来（hinting / 亚像素定位 / LCD 文字 / GPU / 色彩配置）。不带这几样时，同一棵没改过的树取两次，
  // 字形边缘每张都可能不同（#1537 dev2 实测：184 张全不同，最大通道差 43），「多取几份对上」也救不回来。
  // 要换一组就设 SNAP_ARGS（空格分隔；设成空串 = 一个都不带）。
  const args = (process.env.SNAP_ARGS ?? DEFAULT_ARGS).split(' ').filter(Boolean);
  const browser = await chromium.launch({ args });
  console.log(`浏览器参数：${args.join(' ') || '（无）'}`);
  const page = await browser.newPage();
  let n = 0;
  const blocks = new Set();
  try {
    for (const c of list) {
      for (const [tone, bg] of Object.entries(BGS)) {
        const url = `${base}/__catalog/${c.block}/${c.shape}?embed=1&theme=azure-29&bg=${encodeURIComponent(bg)}`;
        const stem = `${c.block}__${c.shape}__${tone}`;
        for (const w of WIDTHS) {
          await page.setViewportSize({ width: w, height: 900 });
          const res = await page.goto(url, { waitUntil: 'networkidle' });
          if (!res || res.status() !== 200) die(`${url} → HTTP ${res ? res.status() : '无响应'}`);
          await page.addStyleTag({ content: 'nextjs-portal{display:none!important}*,*::before,*::after{transition:none!important;animation:none!important;caret-color:transparent!important}' });
          // 字体静下来，再等两帧 + 300ms：hydration 之后有的块还会量一次自己（header 的 topbar 实测在第一帧后还挪 1px）。
          await page.evaluate(async () => { await document.fonts.ready; await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))); });
          await page.waitForTimeout(300);
          const html = await page.evaluate(() => { const el = document.querySelector('[data-block]'); return el ? el.outerHTML : null; });
          if (html === null) die(`${url} 里没有 [data-block]`);
          if (w === WIDTHS[0]) fs.writeFileSync(path.join(out, `${stem}.html`), html);
          fs.writeFileSync(path.join(out, `${stem}__${w}.png`), await page.screenshot({ fullPage: true }));
          n += 1;
        }
        blocks.add(c.block);
      }
    }
  } finally {
    await browser.close();
  }
  console.log(`✅ 取完：${blocks.size} 个块 · ${list.length} 个预设 × ${Object.keys(BGS).length} 底 = ${list.length * 2} 份 HTML · ${n} 张截图（${WIDTHS.join(' / ')}）→ ${out}`);
}

/** 两张 PNG 差几个像素、差在哪个框里（尺寸不同 = 无穷大）。 */
async function pixelDiff(fa, fb) {
  const { PNG } = (await import('pngjs')).default;
  const a = PNG.sync.read(fs.readFileSync(fa));
  const b = PNG.sync.read(fs.readFileSync(fb));
  if (a.width !== b.width || a.height !== b.height) return { n: Infinity, box: null, size: `${a.width}x${a.height} / ${b.width}x${b.height}` };
  let n = 0; let x0 = Infinity; let y0 = Infinity; let x1 = -1; let y1 = -1;
  for (let y = 0; y < a.height; y += 1) {
    for (let x = 0; x < a.width; x += 1) {
      const i = (y * a.width + x) * 4;
      if (a.data[i] !== b.data[i] || a.data[i + 1] !== b.data[i + 1] || a.data[i + 2] !== b.data[i + 2] || a.data[i + 3] !== b.data[i + 3]) {
        n += 1; x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y);
      }
    }
  }
  return { n, box: n ? [x0, y0, x1, y1] : null };
}
const same = (fa, fb) => fs.readFileSync(fa).equals(fs.readFileSync(fb));

/**
 * compare A B [--noise A2 ...] [--also B2 ...] [--subset]
 *   A = 改前、B = 改后。HTML 一律逐字比。截图默认逐字节比。
 *   --noise A2（可给多次）：改前那棵树再取的几份。--also B2（可给多次）：改后那棵树再取的几份（--subset 下可以只取几个块）。
 *   判法（HTML 与截图同一条）：**任何一份改后**跟**任何一份改前**逐字 / 逐字节相同 ⟹ 相同。改动若真的稳定地改了输出，
 *     没有一份改后能对上任何一份改前；而抖动是随机的，多取一份就会碰上相同的那一次。都对不上的照样打出来（截图带像素数和框），判不同。
 *   抖动从哪来（实测，别当成定数 —— 跟机器当时的负载有关）：
 *     · 截图：亚像素抗锯齿。#1534 在这台机器上同树两次取 348 张里 4–6 张不同、每张 5–56 像素；#1537（dev2）不带启动参数时 184 张全不同，
 *       带上 DEFAULT_ARGS 后同树两次 1–3 张。
 *     · HTML：testimonials 的轮播在脚本初始化后才挂 `data-ready="1"`，取得早晚不同 HTML 就不同（#1537 实测 2–3 份；#1534 那几轮是 0）。
 *   --subset：只比 B 里有的文件（阳性对照只取一个块时用）。
 */
async function compare() {
  const multi = (name) => process.argv.flatMap((x, i, all) => (all[i - 1] === `--${name}` ? [x] : []));
  const [a, b] = process.argv.slice(3).filter((x, i, all) => !x.startsWith('--') && !['--noise', '--also'].includes(all[i - 1]));
  const noise = multi('noise');
  const also = multi('also');
  const subset = process.argv.includes('--subset');
  if (!a || !b) die('compare 要两个目录');
  for (const d of [a, b, ...noise, ...also]) if (!fs.existsSync(d)) die(`没有 ${d}`);
  const fb = fs.readdirSync(b).sort();
  const fa = subset ? fs.readdirSync(a).filter((f) => fb.includes(f)).sort() : fs.readdirSync(a).sort();
  if (!fa.length || !fb.length) die(`${fa.length ? b : a} 是空的 —— 分母为 0`);
  const onlyA = fa.filter((f) => !fb.includes(f));
  const onlyB = fb.filter((f) => !fa.includes(f));
  const diff = { html: [], png: [] };
  const rescued = [];
  for (const f of fa.filter((x) => fb.includes(x))) {
    const A = path.join(a, f); const B = path.join(b, f);
    if (same(A, B)) continue;
    const befores = [A, ...noise.map((d) => path.join(d, f))].filter((x) => fs.existsSync(x));
    const afters = [B, ...also.map((d) => path.join(d, f))].filter((x) => fs.existsSync(x));
    const hit = afters.flatMap((x, i) => befores.map((y, j) => [i, j, x, y])).find(([, , x, y]) => same(x, y));
    if (hit) { rescued.push(`${f}（改后第 ${hit[0] + 1} 份 = 改前第 ${hit[1] + 1} 份）`); continue; }
    if (f.endsWith('.html')) { diff.html.push(`${f}（改前 ${befores.length} 份 × 改后 ${afters.length} 份没有一对逐字相同）`); continue; }
    const got = await pixelDiff(A, B);
    diff.png.push(`${f}（${got.size ? '尺寸 ' + got.size : got.n + ' 像素 ' + JSON.stringify(got.box)}；改前 ${befores.length} 份 × 改后 ${afters.length} 份没有一对逐字节相同）`);
  }
  const nh = fa.filter((f) => f.endsWith('.html')).length;
  const np = fa.filter((f) => f.endsWith('.png')).length;
  console.log(`HTML ${nh} 份 · 不同 ${diff.html.length}${diff.html.length ? '：' + diff.html.join(' · ') : ''}`);
  console.log(`截图 ${np} 张 · 不同 ${diff.png.length}${diff.png.length ? '：' + diff.png.join(' · ') : ''}`);
  if (noise.length || also.length) console.log(`抖动格（第一对不同、别的取法里对上了）${rescued.length} 张${rescued.length ? '：' + rescued.join(' · ') : ''}`);
  if (onlyA.length || onlyB.length) console.log(`只在一边：${[...onlyA.map((f) => `${a}/${f}`), ...onlyB.map((f) => `${b}/${f}`)].join(' · ')}`);
  const bad = diff.html.length + diff.png.length + onlyA.length + onlyB.length;
  console.log(bad ? `❌ ${bad} 处不同` : '✅ 逐字 / 逐字节相同（抖动格另列）');
  process.exit(bad ? 1 : 0);
}

const cmd = process.argv[2];
if (cmd === 'capture') await capture();
else if (cmd === 'compare') await compare();
else die('用法：capture --base <url> --out <目录> [--blocks a,b] | compare <改前> <改后> [--noise <改前另一份> …] [--also <改后另一份> …] [--subset]');
