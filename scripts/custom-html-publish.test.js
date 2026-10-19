#!/usr/bin/env node
/**
 * custom-html-publish.test.js — #1833（SiteAsData T4a-1）：Custom HTML 块走真的发布渲染（`site.js render --target live`）。
 *
 *   ① 产物里原样在：块里的 `<script>` 一字不差进了首页；把那一页放进 `runScripts: 'dangerously'` 的 jsdom ⟹ 脚本真跑了
 *      （`document.body.dataset.ch === 'ran'`，验收第一格「网站上真跑」的模板一侧）；它后面那一块是它的兄弟。
 *   ② PurgeCSS 看见它（设计文档 §6.4）：块里用了一个站上别处没用的 Bootstrap 类（`.alert-warning`）⟹ 发布的 site.css 里有那条规则。
 *      先读红（票面要求）：同一份内容、`customHtmlOf` 换成「什么都不交」的替身 ⟹ 那条规则被剪掉。
 *      📌 票面举的是 `.btn-outline-primary`，而它今天在 10 份块源码里被用着（PurgeCSS 按构造恒保留它），读不出红 ⟹ 换成量得出两向的类。
 *
 *   node scripts/custom-html-publish.test.js     （由 `npm run test:scripts` 自动发现）
 *   退出码: 0 全过 · 1 有失败 · 2 跑不起来（**不许当成通过**）
 */
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');

let pass = 0; let fail = 0;
const ok = (m) => { pass += 1; console.log(`  ✅ ${m}`); };
const bad = (m) => { fail += 1; console.log(`  ❌ ${m}`); };
const check = (cond, m, detail) => (cond ? ok(m) : bad(detail === undefined ? m : `${m} —— ${typeof detail === 'string' ? detail : JSON.stringify(detail)}`));
const die = (m) => { console.log(`💥 跑不起来: ${m}`); process.exit(2); };

const ROOT = path.resolve(__dirname, '..');
const CH_PATH = path.join(__dirname, 'lib', 'custom-html.js');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'custom-html-publish-'));
// bundle 必须放在模板树里（react 这些包按产物的位置解析），同 site-render.test.js。
const BUNDLE = path.join(ROOT, 'render', 'dist', `test-1833-${process.pid}`);
process.on('exit', () => { fs.rmSync(tmp, { recursive: true, force: true }); fs.rmSync(BUNDLE, { recursive: true, force: true }); });

let site; let renderBundle; let JSDOM; let VirtualConsole; let ch; let FIXTURE;
try {
  site = require('./site');
  renderBundle = require('./lib/render-bundle');
  ({ JSDOM, VirtualConsole } = require('jsdom'));
  ch = require(CH_PATH);
  FIXTURE = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'site-fixtures', 'site-0448c807.json'), 'utf-8'));
} catch (e) {
  die(e.stack || e.message);
}
const HOME = 'en/pages/home.json';
const CLS = 'alert-warning';
const SCRIPT = "<script>document.body.dataset.ch='ran'</script>";

function contentWithBlock() {
  const c = JSON.parse(JSON.stringify(FIXTURE));
  const home = typeof c[HOME] === 'string' ? JSON.parse(c[HOME]) : c[HOME];
  // 首页的块按 weight 排（夹具是 hero 0 · testimonials 10 · …）：放在 hero 和第二块之间，后面还有块 ⟹ ① 量得了「它后面那一块是它的兄弟」。
  // html 先过一遍整理（save / validate 落库前就是这么做的）—— 原文里那个没收尾的 <b> 是给「后面那一块没被续上」留的。
  home.blocks.splice(1, 0, { id: 'ch-test', type: 'custom-html', role: 'optional', region: 'content', weight: 5,
    data: { html: ch.tidyHtml(`${SCRIPT}<div class="alert ${CLS}">Closed on Monday<b>!`), css: 'div { margin: 0 }', label: 'Test' } });
  c[HOME] = home;
  return c;
}

async function renderLive(content, out) {
  const cacheDir = path.join(tmp, `${out}-css`);
  const r = await site.render({ content, out: path.join(tmp, out), bundleDir: BUNDLE, cacheDir, version: 3, siteId: 't1833', siteUrl: 'https://t1833.example.com', target: 'live' });
  const css = fs.readFileSync(path.join(cacheDir, `${r.siteCssKey}.css`), 'utf-8');
  return { r, css, home: fs.readFileSync(path.join(tmp, out, 'index.html'), 'utf-8') };
}

(async () => {
  await renderBundle.buildRenderBundle({ outdir: BUNDLE });

  console.log('① 产物里原样在、脚本真跑、后面那一块是它的兄弟');
  const { css, home } = await renderLive(contentWithBlock(), 'live');
  check(home.includes(SCRIPT), '首页产物里那段 <script> 一字不差');
  check(/<section[^>]*data-block="custom-html"[^>]*data-block-id="ch-test"/.test(home), '外面是 <section data-block="custom-html" data-block-id="ch-test">');
  check(home.includes('[data-block-id="ch-test"] div { margin: 0 }'), '块的 css 加了前缀');
  const dom = new JSDOM(home, { runScripts: 'dangerously', virtualConsole: new VirtualConsole() });
  check(dom.window.document.body.dataset.ch === 'ran', '放进 runScripts 的 jsdom ⟹ document.body.dataset.ch === "ran"（脚本真跑了）');
  const el = dom.window.document.querySelector('[data-block-id="ch-test"]');
  const next = el && el.nextElementSibling;
  check(!!next && next.tagName === 'SECTION' && next.getAttribute('data-block') !== 'custom-html' && !next.querySelector('b'),
    `它后面那一块（${next && next.getAttribute('data-block')}）是它的兄弟，没被续上 <b>`);
  dom.window.close();

  console.log(`② PurgeCSS 看见块里的 .${CLS}`);
  check(new RegExp(`\\.${CLS}\\b`).test(css), `发布的 site.css 里有 .${CLS}`);
  // 先读红：customHtmlOf 换成「什么都不交」的替身（site.js render 每次调用时才 require 它 ⟹ 换 require.cache 就够）。
  const real = require.cache[CH_PATH];
  require.cache[CH_PATH] = { ...real, exports: { ...ch, customHtmlOf: () => [] } };
  let without;
  try {
    without = await renderLive(contentWithBlock(), 'live-no-wire');
  } finally {
    require.cache[CH_PATH] = real;
  }
  check(!new RegExp(`\\.${CLS}\\b`).test(without.css), `反向对照：不把 custom-html 交给 PurgeCSS ⟹ .${CLS} 被剪掉（这一格量得出接线）`);
  check(without.home.includes(SCRIPT), '反向对照那一份块照样在页面上（剪掉的只是样式，判据分得开）');

  console.log(`\n${fail === 0 ? '✅' : '❌'} ${pass} 过 · ${fail} 失败`);
  process.exit(fail === 0 ? 0 : 1);
})().catch((e) => die(e && e.stack ? e.stack : String(e)));
