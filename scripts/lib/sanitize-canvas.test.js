#!/usr/bin/env node
/**
 * sanitize-canvas.test.js — #1833（SiteAsData T4a-1）：Custom HTML 进编辑器画布之前的净化（`lib/sanitize-canvas.js`）。
 *
 *   ① DOMPurify 上游向量集（`fixtures/dompurify-vectors/expect-3.4.17.mjs`，按 tag 拷的）+ 自家 ≥ 10 条：每一条过
 *      `sanitizeForCanvas` 之后，输出里没有 `<script`、`on*=`、`srcdoc`，链接 / 地址里没有 `javascript:`，iframe 一律带 `sandbox`
 *      且只有 https 的 `src`。字面量一把尺 + 把输出解析回 DOM 再逐个元素查一把尺，两把都要过。
 *   ② 真跑一次：自家那几条能跑脚本的写法，原样放进一个 `runScripts: 'dangerously'` 的 jsdom 会把哨兵写上（证明夹具是活的），
 *      净化之后放进去哨兵不动。
 *   ③ 反向对照：`sanitizeForCanvas` 换成恒等函数 ⟹ ① 和 ② 都点名（这把尺量得出「没净化」）。
 *   ④ 留下来的还是那些东西；块里自带的 `<style>` 整块删、`style="…"` 属性留着（#1833 r5：没有 `css` 字段、没有 CSS 净化了 ——
 *      `<style>` 在画布里不留，它会改到画布里编辑器自己的东西和别的块；预览 / 网站上原样）。
 *
 *   node scripts/lib/sanitize-canvas.test.js     （由 `npm run test:scripts` 自动发现）
 *   退出码: 0 全过 · 1 有失败 · 2 跑不起来（**不许当成通过**）
 */
'use strict';

const path = require('path');
const { pathToFileURL } = require('url');

let pass = 0; let fail = 0;
const ok = (m) => { pass += 1; console.log(`  ✅ ${m}`); };
const bad = (m) => { fail += 1; console.log(`  ❌ ${m}`); };
const check = (cond, m, detail) => (cond ? ok(m) : bad(detail === undefined ? m : `${m} —— ${typeof detail === 'string' ? detail : JSON.stringify(detail)}`));
function die(msg) { console.log(`💥 跑不起来: ${msg}`); process.exit(2); }

let lib; let JSDOM; let VirtualConsole;
try {
  lib = require('./sanitize-canvas');
  ({ JSDOM, VirtualConsole } = require('jsdom'));
} catch (e) {
  die(`加载不了被测模块 / jsdom: ${e.message}`);
}
const { sanitizeForCanvas } = lib;
const WIN = new JSDOM('<!doctype html><html><body></body></html>').window;
// 恒等对照里会喂进去很多坏样式表，jsdom 默认往 stderr 打「Could not parse CSS stylesheet」—— 那不是读数，关掉。
const quiet = () => new VirtualConsole();

// ── 判据：一份输出里有没有能跑的东西。回问题清单（空 = 干净）。 ─────────────────────────────────────────────
const JS_URL = /^\s*(javascript|vbscript)\s*:/i;
function problemsOf(out) {
  const p = [];
  if (/<script/i.test(out)) p.push('<script');
  if (/<[^>]*\son[a-z]+\s*=/i.test(out)) p.push('on*=');
  if (/srcdoc/i.test(out)) p.push('srcdoc');
  const doc = new JSDOM(`<!doctype html><body>${out}</body>`, { virtualConsole: quiet() }).window.document;
  for (const el of doc.body.querySelectorAll('*')) {
    const tag = el.tagName.toLowerCase();
    if (['script', 'object', 'embed', 'base', 'form', 'link', 'meta', 'foreignobject'].includes(tag)) p.push(`<${tag}>`);
    for (const a of [...el.attributes]) {
      if (/^on/i.test(a.name)) p.push(`${tag}[${a.name}]`);
      if (['href', 'src', 'xlink:href', 'action', 'formaction', 'data', 'poster', 'background'].includes(a.name.toLowerCase()) && JS_URL.test(a.value)) p.push(`${tag}[${a.name}=javascript:]`);
    }
    if (tag === 'iframe') {
      if (!el.hasAttribute('sandbox')) p.push('iframe 没有 sandbox');
      if (!/^https:\/\//i.test(el.getAttribute('src') || '')) p.push(`iframe src=${el.getAttribute('src')}`);
    }
    if (tag === 'use') {
      for (const n of ['href', 'xlink:href']) if (el.hasAttribute(n) && !/^#/.test(el.getAttribute(n).trim())) p.push(`use[${n}] 指向外部`);
    }
  }
  return [...new Set(p)];
}

// ── 自家的向量（≥ 10 条）：前 RUNNABLE 条在原样插进 jsdom 时真的会跑，用来做 ② 的哨兵。 ─────────────────────────────
const RUN = 'window.__ran = (window.__ran || 0) + 1';
const RUNNABLE = [
  `<script>${RUN}</script><p>hi</p>`,
  `<div><script>${RUN}</script></div>`,
  `<table><tr><td><script>${RUN}</script></td></tr></table>`,
  `<details open ontoggle="${RUN}"><summary>x</summary></details>`,
];
const OWN = [
  ...RUNNABLE,
  '<img src=x onerror="document.title=1">',
  '<svg onload="alert(1)"><circle r="2"/></svg>',
  '<iframe src="https://calendly.com/x" srcdoc="<script>alert(1)</script>"></iframe>',
  '<iframe src="http://example.com/insecure"></iframe>',
  '<iframe src="javascript:alert(1)"></iframe>',
  '<a href="javascript:alert(1)">click</a>',
  '<a href="&#106;avascript:alert(1)">entity</a>',
  '<a href="  JaVaScRiPt:alert(1)">spaces</a>',
  '<form action="https://evil.example"><button formaction="javascript:alert(1)">go</button></form>',
  '<base href="https://evil.example/">',
  '<meta http-equiv="refresh" content="0;url=javascript:alert(1)">',
  '<link rel="stylesheet" href="https://evil.example/x.css">',
  '<object data="javascript:alert(1)"></object><embed src="javascript:alert(1)">',
  '<svg><use href="data:image/svg+xml;base64,PHN2Zy8+#x"></use><use xlink:href="https://evil.example/s.svg#a"></use></svg>',
  '<noscript><p title="</noscript><img src=x onerror=alert(1)>"></noscript>',
  '<math><mtext><table><mglyph><style><img src=x onerror=alert(1)></style></mglyph></table></mtext></math>',
  '<template><img src=x onerror=alert(1)></template>',
  '<svg><foreignObject><img src=x onerror=alert(1)></foreignObject></svg>',
  '<div style="background:url(javascript:alert(1))">s</div><style>@import url(https://evil.example/x.css); p{color:red}</style>',
];

async function main() {
  let upstream;
  try {
    upstream = (await import(pathToFileURL(path.join(__dirname, '..', 'fixtures', 'dompurify-vectors', 'expect-3.4.17.mjs')).href)).default;
  } catch (e) {
    die(`读不到上游向量集: ${e.message}`);
  }
  if (!Array.isArray(upstream) || upstream.length < 100) die(`上游向量集只有 ${upstream && upstream.length} 条 —— 拷坏了？`);
  const vectors = [...upstream.map((v, i) => ({ name: `上游 #${i} ${String(v.title || '').slice(0, 60)}`, payload: String(v.payload) })),
    ...OWN.map((p, i) => ({ name: `自家 #${i}`, payload: p }))];

  console.log(`① ${upstream.length} 条上游向量 + ${OWN.length} 条自家的，过 sanitizeForCanvas 之后没有能跑的东西`);
  const runAll = (fn) => vectors.map((v) => ({ v, problems: problemsOf(fn(v.payload)) })).filter((r) => r.problems.length);
  const dirty = runAll((h) => sanitizeForCanvas(h, { window: WIN }));
  check(dirty.length === 0, `${vectors.length} 条全部干净`, dirty.slice(0, 5).map((r) => `${r.v.name}: ${r.problems.join(', ')}`).join(' · '));
  check(OWN.length >= 10, `自家向量 ${OWN.length} 条（≥ 10）`);

  console.log('② 真跑一次：原样放进 runScripts 的 jsdom 会跑，净化之后不跑');
  // `ontoggle` 是异步派发的 ⟹ 等一拍再读哨兵。
  const ran = async (html) => {
    const dom = new JSDOM(`<!doctype html><html><body>${html}</body></html>`, { runScripts: 'dangerously', virtualConsole: quiet() });
    await new Promise((r) => setTimeout(r, 50));
    const n = dom.window.__ran || 0;
    dom.window.close();
    return n;
  };
  for (const [i, p] of RUNNABLE.entries()) {
    const raw = await ran(p);
    const clean = await ran(sanitizeForCanvas(p, { window: WIN }));
    check(raw > 0 && clean === 0, `自家 #${i}：原样跑了 ${raw} 次（夹具是活的），净化之后 ${clean} 次`);
  }

  console.log('③ 反向对照：sanitizeForCanvas 换成恒等函数 ⟹ 上面两把尺都点名');
  const identity = runAll((h) => h);
  check(identity.length >= OWN.length, `恒等函数下 ${identity.length} 条被点名（自家 ${OWN.length} 条至少都在里面）`);
  const ranRaw = await Promise.all(RUNNABLE.map((p) => ran(p)));
  check(ranRaw.every((n) => n > 0), `恒等函数下 ${RUNNABLE.length} 条能跑的写法全都跑了`, ranRaw);

  console.log('④ 留下来的东西还是那些东西（白名单不是一刀切）');
  const keep = sanitizeForCanvas('<table class="table"><tr><td>x</td></tr></table><p>hi <b>there</b></p>', { window: WIN });
  check(/<table class="table">/.test(keep) && /<td>x<\/td>/.test(keep) && /<b>there<\/b>/.test(keep), '表格 / 段落 / 加粗 / class 原样留下', keep);
  const frame = sanitizeForCanvas('<iframe src="https://calendly.com/acme" width="100%" height="600"></iframe>', { window: WIN });
  check(/<iframe[^>]*src="https:\/\/calendly\.com\/acme"/.test(frame) && /sandbox=""/.test(frame), 'https 的 iframe 留下，带上空的 sandbox', frame);
  // #1833 r5 —— `<style>` 整块删（连同规则，没有前缀、没有挑规则那一说了）；`style` 属性只管它自己那个元素，留着。
  const styled = sanitizeForCanvas('<style>h1 { color: red } @import url(x.css);</style><h1 style="color:red">Hi</h1>', { window: WIN });
  check(styled === '<h1 style="color:red">Hi</h1>', '块里自带的 <style> 整块删掉，style 属性原样留下', styled);
  const nested = sanitizeForCanvas('<div><style>p{color:red}</style><p>x</p></div><svg><style>circle{fill:red}</style><circle r="2"/></svg>', { window: WIN });
  check(!/<style|color:red|fill:red/.test(nested) && /<p>x<\/p>/.test(nested) && /<circle r="2"><\/circle>/.test(nested), '嵌在别的元素 / svg 里的 <style> 也删，旁边的标记留下', nested);

  console.log(`\n${fail === 0 ? '✅' : '❌'} ${pass} 过 · ${fail} 失败`);
  process.exit(fail === 0 ? 0 : 1);
}

main().catch((e) => die(e && e.stack ? e.stack : String(e)));
