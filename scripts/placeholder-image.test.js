#!/usr/bin/env node
/**
 * placeholder-image.test.js — #1734 布局要图、那一格没图 ⟹ 垫同一张占位图（编辑器、预览、上线都一样），点它能换。
 *
 * 跑法:  node scripts/placeholder-image.test.js   （或 `npm run test:scripts`，它按文件名发现）
 * 退出码: 0 全过 · 1 有失败 · 2 跑不起来（**不许当成通过**）
 *
 * 管哪几条：
 *   ① 占位地址只有一个值：渲染层那份（`blockMedia.tsx` §PLACEHOLDER_IMAGE_URL）== 脚本侧那份（`image-slots.js`），
 *      `block-catalog.js` 引的就是脚本侧那份（AC2 的一半）
 *   ② AC1：六个块九个图旋钮 × manifest 里除 `none` 外的每一个值，数据里那一格为空 ⟹
 *        - `<img>` 那几档：有一张 `src` 是占位地址、带该槽 `data-slot` 和 `data-placeholder` 的 `<img>`
 *        - hero / cta 的 `background`：背景样式里带占位地址（不验 `data-slot`）
 *        - `none`：渲染结果里没有占位地址
 *      旋钮集合从 manifest 现算（带 `none` 这一档的块级图旋钮），跟正文那张表比 —— 漏一个、多一个都红。
 *      反向对照：去掉垫占位那一步（`knobImg` 改回「没图就 null」）⟹ 同一批格子红。
 *      对照：放真图 ⟹ 画的是真图、不带 `data-placeholder`（真图一个字节不多）。
 *   ③ AC2：模板源码里（注释、`*.test.js`、`scripts/block-migration/` 不算）这个字面量只在两处常量里。
 *      尺子自检：同一个字面量写在代码里 ⟹ 抓到；只写在注释里 ⟹ 不抓。
 *   ④ 编辑器点占位图（`inline-edit.js` §resolveInlineSlot）：对到数据里那一格空着的槽；列表项按 `data-item` 认真实下标；
 *      对不上（`data-item` 前缀不是这个槽 / 那一格其实有图）⟹ 不让改。反向对照：不带 `placeholder` ⟹ 判 mismatch。
 *   ⑥ #1767：成排的小图（hero / pricing 的头像、logo）没有地址的那一项也垫占位图（`blockMedia.tsx` §rowImgs），名字照留、
 *      data-item 是数据里的下标；反向对照：改回「没有地址就筛掉」⟹ 占位 0 个。编辑器点占位头像对到数据里那一项。
 *   ⑤ AC3：页面数据里不写占位地址 —— 编辑器换成 Photo cards（写进 options）、不换图就存（§pageToPuck → §puckToPage）⟹ 三项照旧没有 `image`。
 */

'use strict';

const fs = require('fs');
const path = require('path');
const Module = require('module');
const cp = require('child_process');

const NEXT = path.resolve(__dirname, '..');
const SRC = path.join(NEXT, 'src');
const BLOCKS = path.join(NEXT, 'blocks');
const MEDIA = path.join(SRC, 'lib', 'sections', 'blockMedia.tsx');
const LITERAL = '/images/grid-pattern.svg';

let pass = 0;
let fail = 0;
const ok = (m) => { pass += 1; console.log(`  ✅ ${m}`); };
const bad = (m) => { fail += 1; console.log(`  ❌ ${m}`); };
const die = (m) => { console.error(`🔴 跑不起来: ${m}`); process.exit(2); };
const check = (cond, m, detail) => (cond ? ok(m) : bad(detail ? `${m} —— ${detail}` : m));

let ts; let React; let renderToStaticMarkup; let imageSlots; let blockCatalog; let inlineEdit; let schemaLib; let convert; let DEMO;
try {
  ts = require('typescript');
  React = require('react');
  ({ renderToStaticMarkup } = require('react-dom/server'));
  imageSlots = require('./lib/image-slots');
  blockCatalog = require('./lib/block-catalog');
  inlineEdit = require('./lib/inline-edit');
  schemaLib = require('./lib/editor-schema');
  convert = require('./lib/editor-convert');
  DEMO = require('./lib/demo-content').DEMO_CONTENT;
} catch (e) { die(`加载不起来（在 templates/nextjs 里跑 npm ci）：${e.message}`); }

// ── 让 node 能 require .tsx；Next 自己的换成替身（同 media-layout.test.js）──────────────────────────────
const STUB_DIR = path.join(__dirname, `.placeholder-image-stubs-${process.pid}`);
fs.mkdirSync(STUB_DIR, { recursive: true });
const stub = (name, body) => { const p = path.join(STUB_DIR, `${name}.js`); fs.writeFileSync(p, body); return p; };
const STUBS = {
  'next/link': stub('link', "const React=require('react');"
    + "const L=({href,children,...r})=>React.createElement('a',{href,...r},children);module.exports=L;module.exports.default=L;\n"),
  '@/lib/config': stub('config', 'module.exports={defaultLocale:"en",locales:["en"],siteId:"t",leadApi:"",getServices:()=>[],'
    + 'pagesByLocale:{en:[]},localeUrl:(s)=>s==="home"?"/":"/"+s,brand:{},getForms:()=>[]};\n'),
};
process.on('exit', () => { try { fs.rmSync(STUB_DIR, { recursive: true, force: true }); } catch (e) { /* 收尾 */ } });
const sourceOverride = new Map();
for (const ext of ['.tsx', '.ts']) {
  require.extensions[ext] = (mod, filename) => mod._compile(ts.transpileModule(sourceOverride.get(filename) ?? fs.readFileSync(filename, 'utf-8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true, resolveJsonModule: true },
    fileName: filename,
  }).outputText, filename);
}
const origResolve = Module._resolveFilename;
Module._resolveFilename = function resolve(req, ...rest) {
  if (typeof req === 'string' && req.startsWith('@template/')) req = '@/' + req.slice(10); // #1801：模板别名改名，测试里的桩和解析仍按 @/ 认
  if (STUBS[req]) return STUBS[req];
  if (req.startsWith('@/')) return origResolve.call(this, path.join(SRC, req.slice(2)), ...rest);
  return origResolve.call(this, req, ...rest);
};
/** 载一个块；`mediaOverride` = 换掉 blockMedia.tsx 的源码（反向对照）。块和 blockMedia 都重新编译，互不串。 */
function load(b, mediaOverride) {
  const f = path.join(BLOCKS, b, 'Section.tsx');
  for (const k of Object.keys(require.cache)) if (k.startsWith(SRC) || k.startsWith(BLOCKS)) delete require.cache[k];
  if (mediaOverride) sourceOverride.set(MEDIA, mediaOverride); else sourceOverride.delete(MEDIA);
  const C = require(f).default;
  sourceOverride.delete(MEDIA);
  return C;
}

// ══ ① 占位地址只有一个值 ═══════════════════════════════════════════════════════════════════════════════
console.log('\n── ① 渲染层 / 脚本侧 / 图册页 用的是同一个地址');
let media;
try { load('content'); media = require(MEDIA); } catch (e) { die(`blockMedia.tsx 载入失败: ${e.message}`); }
check(imageSlots.PLACEHOLDER_IMAGE_URL === LITERAL, `image-slots.js §PLACEHOLDER_IMAGE_URL = ${LITERAL}`, imageSlots.PLACEHOLDER_IMAGE_URL);
check(media.PLACEHOLDER_IMAGE_URL === imageSlots.PLACEHOLDER_IMAGE_URL, 'blockMedia.tsx §PLACEHOLDER_IMAGE_URL == image-slots.js 那份', media.PLACEHOLDER_IMAGE_URL);
check(blockCatalog.PLACEHOLDER_IMAGE === imageSlots.PLACEHOLDER_IMAGE_URL, 'block-catalog.js §PLACEHOLDER_IMAGE == image-slots.js 那份');
check(fs.existsSync(path.join(NEXT, 'public', LITERAL.slice(1))), `public${LITERAL} 在盘上（发布出去不是死链）`);

// ══ ② AC1：每个块、每个图旋钮、每个值 ═════════════════════════════════════════════════════════════════════
console.log('\n── ② AC1：数据里那一格为空 × 旋钮每个值');
// 正文「做什么 2」那张表：块 → 旋钮 → { 数据里那一格, data-slot（列表项是 items.<i>.image）}
const TABLE = {
  features: { introImage: { cell: 'introImage', slot: 'introImage' }, itemsImage: { cell: 'itemsImage', slot: 'itemsImage' }, itemImage: { list: 'items', cell: 'image' } },
  hero: { image: { cell: 'image', slot: 'image', bgCss: true } },
  content: { image: { cell: 'image', slot: 'image' } },
  cta: { image: { cell: 'image', slot: 'image', bgCss: true } },
  'page-header': { image: { cell: 'image', slot: 'image' } },
  milestones: { blockImage: { cell: 'blockImage', slot: 'blockImage' }, introImage: { cell: 'introImage', slot: 'introImage' } },
};
const MANIFESTS = Object.fromEntries(fs.readdirSync(BLOCKS).filter((b) => fs.existsSync(path.join(BLOCKS, b, 'manifest.json')))
  .map((b) => [b, JSON.parse(fs.readFileSync(path.join(BLOCKS, b, 'manifest.json'), 'utf8'))]));
const knobsOf = (m) => Object.values(m.slots || {}).flatMap((s) => (s && Array.isArray(s.knobs) ? s.knobs : []));
// 射程从 manifest 现算：带 `none` 这一档、而且管着一张单图的旋钮 —— 同名的槽是 `{imageUrl, alt}` 对象，
// 或者某个列表槽用 `imageKnob` 点了它（features 的 itemImage 管 items[].image）。
const isImageSlot = (m, name) => { const s = m.slots && m.slots[name]; return !!s && s.kind === 'object' && /\bimageUrl\b/.test(String(s.shape || '')); };
const listKnobs = (m) => new Set(Object.values(m.slots || {}).map((s) => s && s.imageKnob).filter(Boolean));
const derived = [];
for (const [b, m] of Object.entries(MANIFESTS)) {
  for (const k of knobsOf(m)) {
    if (!Array.isArray(k.values) || !k.values.includes('none')) continue;
    if (isImageSlot(m, k.name) || listKnobs(m).has(k.name)) derived.push(`${b}.${k.name}`);
  }
}
// 🔴 不垫占位的图旋钮：票里**明写**「旋钮开着、没有图 ⟹ 不画」的。每一条写清出处；它们不进上面那张表，而是在下面
//    单独量「真的没有占位、也没有 <img>」—— 不是从检查里划掉，是换成相反的那条判据。
// #1978 —— contact 的店面图（正文第 5 条「`image=yes` 但块数据没有图，结果：不画图，其余照旧」+ 验收 2 那一格）。
//    跟 #1734 的「没图就垫占位」方向相反，交接时已请 PM 留意（老板仍可在右栏 Image 那一格放图）。
const NO_PLACEHOLDER = { 'contact.image': '#1978 正文第 5 条 / 验收 2：image=yes 但块数据没有图 ⟹ 不画' };
const tabled = Object.entries(TABLE).flatMap(([b, ks]) => Object.keys(ks).map((k) => `${b}.${k}`));
check(JSON.stringify(derived.sort()) === JSON.stringify([...tabled, ...Object.keys(NO_PLACEHOLDER)].sort()), `射程 = 正文那张表 + 不垫占位的 ${Object.keys(NO_PLACEHOLDER).length} 个（manifest 现算 ${derived.length} 个）`, `现算 ${derived.join(',')} · 表 ${tabled.join(',')} · 不垫 ${Object.keys(NO_PLACEHOLDER).join(',')}`);

const clone = (v) => JSON.parse(JSON.stringify(v));
const imgTags = (html) => html.match(/<img\b[^>]*>/g) || [];
const attrOf = (tag, name) => { const m = new RegExp(`\\s${name}="([^"]*)"`).exec(tag); return m ? m[1] : (new RegExp(`\\s${name}(\\s|/?>)`).test(tag) ? '' : null); };
const valuesOf = (b, knob) => (knobsOf(MANIFESTS[b]).find((k) => k.name === knob) || {}).values || [];

/** 一个块的一份夹具：演示内容、旋钮那一格清空、旋钮取 value。features 的 itemImage 清的是每一项的 image。 */
function fixture(b, knob, spec, value, fill) {
  const d = clone(DEMO[b] || {});
  if (spec.list) for (const it of d[spec.list] || []) { if (fill) it[spec.cell] = fill; else delete it[spec.cell]; }
  else if (fill) d[spec.cell] = fill; else delete d[spec.cell];
  d.options = { ...(d.options || {}), [knob]: value };
  // milestones 的块头图要块头在上面才有那一栏（同 media-layout.test.js ⑤）
  if (b === 'milestones' && knob === 'introImage') d.options.introPosition = 'top';
  return d;
}
const render = (C, b, d) => renderToStaticMarkup(React.createElement(C, { data: d, locale: 'en', iconTable: {}, block: { id: `t-${b}`, type: b, data: {} } }));

/** 一格的判据：返回 null = 对；字符串 = 哪儿不对。 */
function judge(b, knob, spec, value, html, d) {
  if (value === 'none') return html.includes(LITERAL) ? '旋钮是 none 却出现了占位地址' : null;
  if (value === 'background' && spec.bgCss) {
    const bg = /data-part="bg"[^>]*style="([^"]*)"|style="([^"]*)"[^>]*data-part="bg"/.exec(html);
    const css = bg ? (bg[1] || bg[2] || '') : '';
    return css.includes(LITERAL) ? null : `背景样式里没有占位地址（${css ? css.slice(0, 80) : '没有 data-part="bg"'}）`;
  }
  const tags = imgTags(html).filter((t) => attrOf(t, 'src') === LITERAL);
  if (spec.list) {
    const n = (d[spec.list] || []).length;
    const slots = tags.map((t) => attrOf(t, 'data-slot'));
    const want = Array.from({ length: n }, (_, i) => `${spec.list}.${i}.${spec.cell}`);
    if (n === 0) return '夹具里没有列表项（判据前提不成立）';
    if (JSON.stringify(slots) !== JSON.stringify(want)) return `占位 <img> 的 data-slot = ${JSON.stringify(slots)}，要 ${JSON.stringify(want)}`;
    return tags.every((t) => attrOf(t, 'data-placeholder') === '') ? null : '有一张占位 <img> 没带 data-placeholder';
  }
  const hit = tags.filter((t) => attrOf(t, 'data-slot') === spec.slot);
  if (hit.length !== 1) return `src=占位、data-slot="${spec.slot}" 的 <img> 有 ${hit.length} 张`;
  return attrOf(hit[0], 'data-placeholder') === '' ? null : '那张 <img> 没带 data-placeholder';
}

function sweep(mediaOverride) {
  const out = [];
  for (const [b, ks] of Object.entries(TABLE)) {
    const C = load(b, mediaOverride);
    for (const [knob, spec] of Object.entries(ks)) {
      for (const value of valuesOf(b, knob)) {
        const d = fixture(b, knob, spec, value);
        out.push({ b, knob, value, why: judge(b, knob, spec, value, render(C, b, d), d) });
      }
    }
  }
  return out;
}

let cells;
try { cells = sweep(); } catch (e) { die(`渲染失败: ${e.stack || e.message}`); }
for (const c of cells) check(!c.why, `${c.b} ${c.knob}=${c.value}`, c.why);
check(cells.length >= 30, `一共量了 ${cells.length} 格（9 个旋钮 × 各自的取值）`);

// 不垫占位的那几个（NO_PLACEHOLDER）：旋钮每个值、数据里那一格为空 ⟹ 没有占位地址、也没有那一槽的 <img>；放真图 ⟹ 画真图。
for (const id of Object.keys(NO_PLACEHOLDER)) {
  const [b, knob] = id.split('.');
  const C = load(b);
  const spec = { cell: knob, slot: knob };
  for (const value of valuesOf(b, knob)) {
    const html = render(C, b, fixture(b, knob, spec, value));
    const own = imgTags(html).filter((t) => attrOf(t, 'data-slot') === knob);
    check(!html.includes(LITERAL) && own.length === 0, `${b} ${knob}=${value}（${NO_PLACEHOLDER[id]}）：没有占位地址、没有那一槽的 <img>`, `占位 ${html.includes(LITERAL)} · <img> ${own.length}`);
  }
  const REAL = { imageUrl: 'https://example.com/real.jpg', alt: 'real' };
  const on = valuesOf(b, knob).filter((v) => v !== 'none');
  const real = on.map((v) => imgTags(render(C, b, fixture(b, knob, spec, v, REAL))).filter((t) => attrOf(t, 'data-slot') === knob && attrOf(t, 'src') === REAL.imageUrl).length);
  check(on.length > 0 && real.every((n) => n === 1), `${b} ${knob}：放真图 ⟹ 每个非 none 的值都画那一张（对照：上面那条不是恒绿）`, real.join(','));
}

// 反向对照：去掉垫占位那一步 ⟹ 除 none 之外的格子全红，none 照旧绿。
{
  const src = fs.readFileSync(MEDIA, 'utf8');
  const PAD = 'return img || PLACEHOLDER;';
  if (!src.includes(PAD)) bad(`blockMedia.tsx 里找不到「${PAD}」（反向对照的前提不成立）`);
  else {
    const off = sweep(src.replace(PAD, 'return img;'));
    const redNonNone = off.filter((c) => c.value !== 'none' && c.why).length;
    const nonNone = off.filter((c) => c.value !== 'none').length;
    const greenNone = off.filter((c) => c.value === 'none' && !c.why).length;
    check(nonNone > 0 && redNonNone === nonNone, `反向对照：不垫占位 ⟹ 非 none 的 ${nonNone} 格全红（实读 ${redNonNone}）`);
    check(greenNone === off.filter((c) => c.value === 'none').length, '反向对照：none 那几格照旧绿（判据不是恒红）');
  }
}

// 对照：放真图 ⟹ 画真图、不带 data-placeholder。
{
  const REAL = { imageUrl: 'https://example.com/real.jpg', alt: 'real' };
  const leaks = [];
  for (const [b, ks] of Object.entries(TABLE)) {
    const C = load(b);
    for (const [knob, spec] of Object.entries(ks)) {
      for (const value of valuesOf(b, knob).filter((v) => v !== 'none')) {
        const html = render(C, b, fixture(b, knob, spec, value, REAL));
        if (html.includes(LITERAL) || /data-placeholder/.test(html) || !html.includes('example.com/real.jpg')) leaks.push(`${b}.${knob}=${value}`);
      }
    }
  }
  check(!leaks.length, '对照：那一格有真图 ⟹ 画的是真图，没有占位地址、没有 data-placeholder', leaks.join(' · '));
}

// ══ ③ AC2：字面量只在两处常量里 ═══════════════════════════════════════════════════════════════════════════
console.log('\n── ③ AC2：模板源码里字面量的位置');
const SKIP_DIRS = new Set(['node_modules', '.next', 'out', 'site', 'sites', 'public', '.git', '.out-backup', '.out-temp']);
const CODE = /\.(js|mjs|cjs|ts|tsx|jsx)$/;
/** 一份源码里「不在注释里」的字面量出现了几次（TypeScript 扫描器跳过注释 trivia，只看 token）。 */
function codeHits(text, file) {
  if (!text.includes(LITERAL)) return 0;
  const sc = ts.createScanner(ts.ScriptTarget.Latest, true, file.endsWith('x') ? ts.LanguageVariant.JSX : ts.LanguageVariant.Standard, text);
  let n = 0;
  for (let k = sc.scan(); k !== ts.SyntaxKind.EndOfFileToken; k = sc.scan()) if (sc.getTokenText().includes(LITERAL)) n += 1;
  return n;
}
check(codeHits(`const a = '${LITERAL}';\n`, 'x.js') === 1, '尺子自检：写在代码里 ⟹ 抓到');
check(codeHits(`// 用的是 ${LITERAL}\n/* ${LITERAL} */\nconst a = 1;\n`, 'x.js') === 0, '尺子自检：只写在注释里 ⟹ 不抓');
/** git 说这份文件被忽略吗（读不到 git ⟹ 当不忽略，宁可多报）。 */
const ignored = (p) => cp.spawnSync('git', ['check-ignore', '-q', p], { cwd: NEXT }).status === 0;
check(ignored(path.join(SRC, 'lib', 'config-data.ts')) && !ignored(path.join(NEXT, 'scripts', 'lib', 'image-slots.js')), '尺子自检：生成物 config-data.ts 判成忽略、image-slots.js 不是');
const found = [];
(function walk(dir) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.name.startsWith('.placeholder-image-stubs') || e.name.endsWith('-stubs')) continue;
    const p = path.join(dir, e.name);
    const rel = path.relative(NEXT, p);
    if (e.isDirectory()) { if (!SKIP_DIRS.has(e.name) && rel !== path.join('scripts', 'block-migration')) walk(p); continue; }
    if (!CODE.test(e.name) || /\.test\.js$/.test(e.name)) continue;
    const n = codeHits(fs.readFileSync(p, 'utf8'), p);
    // 被 git 忽略的是站点生成物（`src/lib/config-data.ts` 是 sync-config 从 site/ 拼出来的，装的是这个站的数据），不是模板源码。
    if (n && !ignored(p)) found.push(`${rel}×${n}`);
  }
}(NEXT));
const WANT = [`${path.join('scripts', 'lib', 'image-slots.js')}×1`, `${path.join('src', 'lib', 'sections', 'blockMedia.tsx')}×1`];
check(JSON.stringify(found.sort()) === JSON.stringify(WANT.sort()), `只在 image-slots.js 与 blockMedia.tsx 各一处`, found.join(' · '));

// ══ ④ 编辑器点占位图 ═════════════════════════════════════════════════════════════════════════════════════
console.log('\n── ④ 编辑器：占位图对回数据里那一格');
{
  const component = { inline: [{ path: 'image', typing: false, ai: false, image: true }, { path: 'items.image', typing: false, ai: false, image: true }] };
  const props = { image: undefined, items: [{ title: 'a' }, { title: 'b' }, { title: 'c', image: { imageUrl: '/photos/c.jpg' } }] };
  const r = (a) => inlineEdit.resolveInlineSlot({ component, props, text: LITERAL, ...a });
  const top = r({ slot: 'image', placeholder: true });
  check(top.ok && JSON.stringify(top.path) === '["image"]' && top.value === '', '顶层：对到 image，现值是空串（弹窗里不会给占位图打勾）', JSON.stringify(top));
  const it = r({ slot: 'items.0.image', placeholder: true, item: 'items.1' });
  check(it.ok && JSON.stringify(it.path) === '["items",1,"image"]', '列表项：下标取 data-item（画布 0 · 数据 1 ⟹ 写第 1 项）', JSON.stringify(it));
  check(!r({ slot: 'items.0.image', placeholder: true, item: 'items.2' }).ok, '那一项其实有图（画布过时）⟹ 不让改');
  check(!r({ slot: 'items.0.image', placeholder: true, item: 'stats.1' }).ok, 'data-item 前缀不是这个槽 ⟹ 不让改');
  check(!r({ slot: 'items.0.image', placeholder: true }).ok, '列表项没有 data-item ⟹ 不让改（不猜着写）');
  check(!r({ slot: 'items.0.image', placeholder: true, item: 'items.9' }).ok, 'data-item 越界 ⟹ 不让改');
  check(!r({ slot: 'image', placeholder: true, props: { image: { imageUrl: '/photos/x.jpg' } } }).ok, '顶层那一格其实有图 ⟹ 不让改');
  const plain = r({ slot: 'image' });
  check(!plain.ok && plain.why === 'mismatch', '反向对照：不认 data-placeholder（老路，按 src 比）⟹ mismatch，点不动', JSON.stringify(plain));
}

// ══ ⑤ AC3：存盘不写占位地址 ═══════════════════════════════════════════════════════════════════════════════
console.log('\n── ⑤ AC3：换成 Photo cards、不换图就存');
try {
  const schema = schemaLib.editorSchema();
  const data = clone(DEMO.features);
  for (const it of data.items) delete it.image;
  const raw = { blocks: [{ id: 'f1', type: 'features', shape: 'grid', data }] };
  const initial = convert.pageToPuck({ raw, blocks: raw.blocks, located: [{ at: 0, writable: true, reason: '' }], schema });
  // 编辑器里 Design → Layout 点一个预设 = 把那个预设的整组旋钮写进 `options`（形态不动；1734 e2e 在真编辑器里量过同一件事）。
  const preset = (MANIFESTS.features.presets || []).find((p) => p.name === 'Photo cards');
  if (!preset) die('features 的 manifest 里没有 Photo cards 这个预设');
  const edited = clone(initial);
  edited.content[0].props.options = { ...preset.knobs };
  const out = convert.puckToPage({ raw, data: edited, initial, schema, slug: 'home', moved: [] });
  const blk = out.blocks[0];
  check(blk.data.options && blk.data.options.itemImage === 'top', '存下去的旋钮是 Photo cards 那一组（itemImage=top，这次存盘真的换了布局）', JSON.stringify(blk.data.options));
  check(Array.isArray(blk.data.items) && blk.data.items.length === data.items.length && blk.data.items.every((x) => !('image' in x)), `${data.items.length} 项都没有 image`, JSON.stringify(blk.data.items.map((x) => Object.keys(x))));
  check(!JSON.stringify(out).includes(LITERAL), '整页 JSON 里没有占位地址');
} catch (e) { die(`存盘往返失败: ${e.stack || e.message}`); }

// ══ ⑥ #1767：成排的小图没有地址的那一项也垫占位图 ══════════════════════════════════════════════════════════
// 拖下 hero / pricing 时 `proof.avatars` 播 3 个 `{}`、`logos.items` 播 3 个 `{alt: 'Logo n'}`（block-placeholders.js §seedProps）。
// 判据只在 `blockMedia.tsx` §rowImgs 一处（#1766 的 logos 块也用它）。
console.log('\n── ⑥ #1767：成排的小图（头像 / logo）没有地址 ⟹ 垫占位图，名字照留，data-item 是数据里的下标');
{
  const PH = new RegExp(`src="${LITERAL.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}"`);
  for (const b of ['hero', 'pricing']) {
    const C = load(b);
    const d = clone(DEMO[b] || {});
    d.proof = { text: 'Rated by locals', rating: 4.9, avatars: [{}, { imageUrl: '/photos/a.jpg' }, {}] };
    d.logos = { caption: 'As seen in', items: [{ alt: 'Logo 1' }, { alt: 'Logo 2' }, { imageUrl: '/photos/l.png', alt: 'Real' }] };
    const tags = imgTags(render(C, b, d));
    const row = (slot) => tags.filter((t) => t.includes(`data-slot="${slot}.`));
    const av = row('proof.avatars'); const lg = row('logos.items');
    const phAv = av.filter((t) => PH.test(t) && /data-placeholder/.test(t));
    const phLg = lg.filter((t) => PH.test(t) && /data-placeholder/.test(t));
    check(av.length === 3 && phAv.length === 2, `${b}：3 个头像都画了，没有地址的 2 个是占位图（带 data-placeholder）`, av);
    check(lg.length === 3 && phLg.length === 2, `${b}：3 个 logo 都画了，没有地址的 2 个是占位图`, lg);
    check(/data-item="proof\.avatars\.2"/.test(phAv[1] || '') && /data-slot="proof\.avatars\.2\.imageUrl"/.test(phAv[1] || ''), `${b}：占位头像的 data-item / data-slot 是数据里的下标（第 3 项 = 2）`, phAv[1]);
    check(/alt="Logo 2"/.test(phLg[1] || ''), `${b}：占位 logo 的名字（alt）照留`, phLg[1]);
    const real = lg.find((t) => t.includes('/photos/l.png'));
    check(!!real && !/data-placeholder/.test(real), `${b}：有地址的那一项画真图、不带 data-placeholder`, real);
    // 反向对照：rowImgs 改回「没有地址就筛掉」（本票之前的 imgs）⟹ 占位一个都没有。
    const src = fs.readFileSync(MEDIA, 'utf8');
    const PAD = 'return (Array.isArray(v) ? v : []).filter(isObj).map(';
    if (!src.includes(PAD)) { bad(`blockMedia.tsx 里找不到「${PAD}」（反向对照的前提不成立）`); continue; }
    const Cold = load(b, src.replace(PAD, 'return (Array.isArray(v) ? v : []).filter(isObj).filter((x) => typeof x.imageUrl === \'string\' && !!x.imageUrl).map('));
    const old = imgTags(render(Cold, b, d)).filter((t) => /data-placeholder/.test(t) && /data-slot="(proof\.avatars|logos\.items)\./.test(t));
    check(old.length === 0, `${b}：反向对照（没有地址的项筛掉）⟹ 占位 0 个（这一格量得到）`, old.length);
  }
  // 编辑器点占位头像：按 data-item 对到数据里那一项（同 ④ 的规矩，成排的图那一格值是地址字符串）。
  const component = { inline: [{ path: 'proof.avatars.imageUrl', typing: false, ai: false, image: true, url: true }] };
  const props = { proof: { avatars: [{}, { imageUrl: '/photos/a.jpg' }, {}] } };
  const r = inlineEdit.resolveInlineSlot({ component, props, text: LITERAL, slot: 'proof.avatars.0.imageUrl', placeholder: true, item: 'proof.avatars.2' });
  check(r.ok && JSON.stringify(r.path) === '["proof","avatars",2,"imageUrl"]', '点第 3 个占位头像 ⟹ 写数据里第 2 项的 imageUrl', JSON.stringify(r));
}

console.log(`\n══ 汇总: 通过 ${pass} · 失败 ${fail} ══`);
process.exit(fail ? 1 : 0);
