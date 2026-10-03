#!/usr/bin/env node
/**
 * gallery-render.test.js — #1495 验收里「看渲染出来的 HTML / 调一次校验器就能判」的那几条。
 *
 * 跑法:  node scripts/gallery-render.test.js   （或 `npm run test:scripts`，它按文件名发现）
 * 退出码: 0 全过 · 1 有失败 · 2 跑不起来（**不许当成通过**）
 *
 * 管哪几条：AC1（4 个预设逐字、旋钮名 / 值逐字、目录集合、两两不同、旋钮独立）· AC3 的规则一半（形状 / 瀑布流 / 拼图）·
 * AC4（图注有无、alt 落回 title）· AC5 的 markup 一半（Modal / Carousel 的 Bootstrap data 属性、大图 lazy、块 id）·
 * AC6 的源码一半（单模块 import()、运行时类不被 purge —— 带阳性对照）· AC7（bg + 不自己算亮度）· AC8（validateSite）·
 * AC9（block-roles · 首页配方池 + 反向对照 · 提示词 · theme-pool）· AC11 的编辑器 schema。
 * 几何、点开大图、网络请求要浏览器：`tests/e2e/specs/1495-gallery-new-knobs.spec.ts`。
 *
 * 🔴 每一段尽量带反向对照（同一进程、单变量），证明判据真会红。
 * 夹具定死：演示内容包里的 Northside Auto Care（`scripts/lib/demo-content`，正文做什么 8）。
 */
'use strict';

const fs = require('fs');
const path = require('path');
const Module = require('module');
const { execFileSync } = require('child_process');
const ts = require('typescript');
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');

const NEXT = path.resolve(__dirname, '..');
const SRC = path.join(NEXT, 'src');
const BLOCK = path.join(NEXT, 'blocks', 'gallery');
const SECTION = path.join(BLOCK, 'Section.tsx');

let pass = 0;
let fail = 0;
const ok = (m) => { pass += 1; console.log(`  ✅ ${m}`); };
const bad = (m) => { fail += 1; console.log(`  ❌ ${m}`); };
const die = (m) => { console.error(`🔴 跑不起来: ${m}`); process.exit(2); };
const check = (cond, m, detail) => (cond ? ok(m) : bad(detail ? `${m} —— ${detail}` : m));

// ── 让 node 能 require 这份 .tsx；Next 自己的换成替身（同 milestones-render.test.js）──────────────────────
const STUB_DIR = path.join(NEXT, 'scripts', '.gallery-stubs');
fs.mkdirSync(STUB_DIR, { recursive: true });
const stub = (name, body) => { const p = path.join(STUB_DIR, `${name}.js`); fs.writeFileSync(p, body); return p; };
const STUBS = {
  'next/link': stub('link', "const React=require('react');"
    + "const L=({href,children,...r})=>React.createElement('a',{href,...r},children);module.exports=L;module.exports.default=L;\n"),
};
process.on('exit', () => { try { fs.rmSync(STUB_DIR, { recursive: true, force: true }); } catch (e) { /* 收尾 */ } });
for (const ext of ['.tsx', '.ts']) {
  require.extensions[ext] = (mod, filename) => mod._compile(ts.transpileModule(fs.readFileSync(filename, 'utf-8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true, resolveJsonModule: true },
    fileName: filename,
  }).outputText, filename);
}
const origResolve = Module._resolveFilename;
Module._resolveFilename = function resolve(req, ...rest) {
  if (STUBS[req]) return STUBS[req];
  if (req.startsWith('@/')) return origResolve.call(this, path.join(SRC, req.slice(2)), ...rest);
  return origResolve.call(this, req, ...rest);
};


const PENDING = [];
let C; let DEMO; let manifestLib; let M;
try {
  C = require(SECTION).default;
  DEMO = require(path.join(NEXT, 'scripts', 'lib', 'demo-content')).DEMO_CONTENT['gallery'];
  manifestLib = require(path.join(NEXT, 'scripts', 'lib', 'block-manifest.js'));
  M = manifestLib.loadManifests().get('gallery');
} catch (e) { die(`载入失败: ${e.message}`); }
if (!DEMO) die('demo-content 里没有 gallery');
if (!M) die('blocks/ 里没有 gallery');

const clone = (v) => JSON.parse(JSON.stringify(v));
const render = (shape, data, id = 'home-gallery') => renderToStaticMarkup(React.createElement(C, {
  data, locale: 'en', block: { id, type: 'gallery', shape, data: {} },
}));
const withOpts = (o, extra = {}, base = DEMO) => ({ ...clone(base), ...extra, options: { ...(base.options || {}), ...o } });
const count = (html, needle) => html.split(needle).length - 1;
const own = (r) => r.problems.filter((p) => p.includes('("gallery")'));
const sectionTag = (html) => (/<section[^>]*>/.exec(html) || [''])[0];
const attr = (html, name) => { const m = new RegExp(`\\s${name}="([^"]*)"`).exec(sectionTag(html)); return m ? m[1] : null; };
const itemsOf = (html) => html.split('data-part="item"').slice(1).map((x) => x.split('</figure>')[0]);
const gridOf = (html) => html.split('data-part="lightbox"')[0];
const lightboxOf = (html) => html.split('data-part="lightbox"')[1] || '';
// #1537 —— 条目网格的列数 / 断点由 manifest 的 itemsGrid 生成（scripts/block-build/items-grid.js），拼在 block.css 前面；
//    这里读的是两份拼起来的那一段（= public/shapes.css 里这个块的那一段）。
const CSS = require('./block-build/items-grid').itemsGridCss(JSON.parse(fs.readFileSync(path.join(BLOCK, 'manifest.json'), 'utf-8')), 'gallery')
  + '\n' + fs.readFileSync(path.join(BLOCK, 'block.css'), 'utf-8');
const SRC_TEXT = fs.readFileSync(SECTION, 'utf-8');
const LB_TEXT = fs.readFileSync(path.join(BLOCK, 'Lightbox.tsx'), 'utf-8');
const BS_PATH = path.join(SRC, 'components', 'BootstrapJs.tsx');
const BS_TEXT = fs.readFileSync(BS_PATH, 'utf-8');
const KNOB_NAMES = ['introPosition', 'introAlign', 'itemsLayout', 'itemsColumns', 'itemShape', 'itemCaption'];
const dataAttr = (n) => `data-${n.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`)}`;

// ══ AC1：4 个预设逐字、旋钮名 / 值逐字、目录集合、两两不同、旋钮独立 ═════════════════════════════════
console.log('── AC1 四个预设');
{
  // 列：名字 · 形态目录 · introPosition · introAlign · itemsLayout · itemsColumns · itemShape · itemCaption（正文预设表逐字）
  const WANT = [
    ['Grid', 'grid', 'top', 'center', 'grid', '3', 'landscape', 'below'],
    ['Masonry', 'masonry', 'top', 'center', 'grid', '3', 'original', 'overlay'],
    ['Mosaic', 'mosaic', 'top', 'left', 'mosaic', '4', 'square', 'overlay'],
    ['Side intro', 'side-intro', 'left', 'left', 'grid', '3', 'square', 'below'],
  ];
  const got = (M.presets || []).map((p) => [p.name, p.shape, ...KNOB_NAMES.map((c) => p.knobs[c])]);
  check(JSON.stringify(got) === JSON.stringify(WANT), 'presets 4 条与正文表逐字相同（名字 · 形态 · 六列旋钮）', JSON.stringify(got));
  check((M.presets || []).every((p) => Object.keys(p.knobs).join() === KNOB_NAMES.join() && Object.keys(p).join() === 'name,shape,knobs'),
    '每个预设只有 name / shape / knobs，knobs 键就是这六个、同一顺序');
  const knobs = M.slots.options.knobs.map((k) => [k.name, k.values]);
  check(JSON.stringify(knobs) === JSON.stringify([
    ['introPosition', ['left', 'right', 'top', 'bottom']], ['introAlign', ['left', 'center', 'right']],
    ['itemsLayout', ['grid', 'mosaic']], ['itemsColumns', ['2', '3', '4']],
    ['itemShape', ['original', 'square', 'landscape', 'portrait']], ['itemCaption', ['below', 'overlay']],
  ]), `slots.options.knobs 名字依次 ${knobs.map((k) => k[0]).join(' / ')}、values 与旋钮表逐字（values[0] = 默认）`);
  check(M.slots.options.knobs.every((k) => !('default' in k)), '旋钮没有显式 default（归 #1481）');
  check(!('parts' in M), '没有部件（顶层没有 parts）');
  const dirs = fs.readdirSync(BLOCK, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name).sort();
  check(JSON.stringify(dirs) === JSON.stringify(WANT.map((w) => w[1]).sort()), `目录集合 == 4 个预设形态（${dirs.join(' / ')}）`);
  check(dirs.every((d) => !fs.existsSync(path.join(BLOCK, d, 'Section.tsx'))), '一份 Section.tsx（形态目录里没有第二份 markup）');
  check(M.skin === 'site-css' && M.roleDefault === 'optional', `skin=${M.skin} · roleDefault=${M.roleDefault}`);
  const htmls = dirs.map((d) => render(d, clone(DEMO)));
  check(new Set(htmls).size === 4, `同一份夹具下 4 个预设渲染出 ${new Set(htmls).size} 份互不相同的 HTML`);
  const pinned = dirs.map((d) => render(d, withOpts(M.presets[0].knobs)).replace(/data-shape="[^"]*"/g, ''));
  check(new Set(pinned).size === 1, '反向对照：options 里写死六个旋钮 ⟹ 4 个预设（去掉 data-shape 之后）塌成同一份 —— 判据分得开');
  const r = render('grid', clone(DEMO));
  const miss = KNOB_NAMES.filter((n) => attr(r, dataAttr(n)) !== M.presets[0].knobs[n]);
  check(miss.length === 0, 'Grid：六个旋钮都写在 <section> 上', miss.join(' · '));
  // 旋钮独立：拧一个，其余五个不变（组件里没有联动纠正 —— mosaic + original 按 landscape 住在 CSS，不改根属性）。
  const base = M.presets[1].knobs;
  const moved = [];
  for (const k of M.slots.options.knobs) {
    for (const v of k.values) {
      const h = render('masonry', withOpts({ [k.name]: v }));
      const others = KNOB_NAMES.filter((n) => n !== k.name);
      if (attr(h, dataAttr(k.name)) !== v || others.some((n) => attr(h, dataAttr(n)) !== base[n])) moved.push(`${k.name}=${v}`);
    }
  }
  check(moved.length === 0, `旋钮独立（Masonry 上逐个拧 ${M.slots.options.knobs.reduce((n, k) => n + k.values.length, 0)} 档）：拧的那个到位、其余五个不变`, moved.join(' · '));
  check(!/captions/.test(JSON.stringify(M.slots.options)), '图册的 +captions 勾选框没有做成旋钮（图注是内容，有就渲染）');
}

// ══ AC3（规则一半，几何在 e2e）：形状 / 瀑布流 / 拼图 ════════════════════════════════════════════
console.log('\n── AC3 形状（block.css）');
{
  const has = (re, m) => check(re.test(CSS), m);
  has(/\[data-item-shape="square"\] \.gl-img \{\s*aspect-ratio: 1 \/ 1;/, 'square = 1:1');
  has(/\[data-item-shape="landscape"\] \.gl-img \{\s*aspect-ratio: 4 \/ 3;/, 'landscape = 4:3');
  has(/\[data-item-shape="portrait"\] \.gl-img \{\s*aspect-ratio: 3 \/ 4;/, 'portrait = 3:4');
  has(/\.gl-img img \{\s*display: block;\s*width: 100%;\s*height: 100%;\s*object-fit: cover;/, '裁图用 object-fit: cover');
  has(/\[data-items-layout="grid"\]\[data-item-shape="original"\] \.gl-grid \{\s*--items-cols: 2;\s*column-count: var\(--items-cols\);/, 'grid + original = 多列（手机 / iPad 2 列）');
  has(/min-width: 992px\) \{[^@]*\[data-items-layout="grid"\]\[data-item-shape="original"\]\[data-items-columns="3"\] \.gl-grid \{\s*--items-cols: 3;/, '≥992 按 itemsColumns（3）');
  has(/min-width: 992px\) \{[^@]*\[data-items-layout="grid"\]\[data-item-shape="original"\]\[data-items-columns="4"\] \.gl-grid \{\s*--items-cols: 4;/, '≥992 按 itemsColumns（4）');
  has(/\[data-item-shape="original"\] \.gl-item \{\s*break-inside: avoid;/, '瀑布流每张 break-inside: avoid');
  has(/\[data-items-layout="grid"\]\[data-item-shape="original"\] \.gl-img img \{\s*height: auto;/, '瀑布流按原图比例（height: auto）');
  has(/\[data-items-layout="mosaic"\]\[data-item-shape="original"\] \.gl-img \{\s*aspect-ratio: 4 \/ 3;/, 'mosaic + original 按 landscape（4:3）');
  has(/\[data-items-layout="mosaic"\] \.gl-item:first-child \{\s*grid-column: span 2;\s*grid-row: span 2;/, 'mosaic 第一张 2×2');
  has(/\[data-items-layout="mosaic"\] \.gl-grid \{\s*grid-auto-flow: dense;/, 'mosaic grid-auto-flow: dense');
  check(!/@media \(min-width: 768px\)/.test(CSS), 'iPad（768–991）不单独分档：<992 一律 2 列');
}

// ══ AC4：图注 ═══════════════════════════════════════════════════════════════════════════════════
console.log('\n── AC4 图注');
{
  const h = render('grid', clone(DEMO));
  const items = itemsOf(h);
  check(items.length === DEMO.items.length && items.every((x) => x.includes('data-part="caption"')), `夹具 ${DEMO.items.length} 张都带图注 ⟹ 每张一个图注节点`);
  check(items.every((x) => x.indexOf('<img') < x.indexOf('data-part="caption"')), '图注在 <img> 后面（below 时在图下方，DOM 顺序同）');
  const d = clone(DEMO); delete d.items[2].title; delete d.items[2].caption; delete d.items[4].caption;
  const per = itemsOf(render('grid', d)).map((x) => (x.includes('data-part="caption"') ? 1 : 0));
  check(per.join('') === '1101111', `第 3 张 title / caption 都清空 ⟹ 只那一张没有图注节点（${per.join('')}）`);
  const p5 = itemsOf(render('grid', d))[4];
  check(p5.includes('data-slot="items.4.title"') && !p5.includes('gl-cap-s'), '只清 caption ⟹ 图注里只剩标题那一行');
  check(/\[data-item-caption="overlay"\] \.gl-cap \{\s*position: absolute;\s*inset: auto 0 0 0;[\s\S]*?color: #fff;/.test(CSS)
    && /\[data-item-caption="overlay"\] \.gl-cap-s \{\s*color: rgba\(255, 255, 255, 0\.92\);/.test(CSS),
    'block.css：overlay = 绝对定位在图底部、白字，小字白 .92');
  check(/\[data-item-caption="below"\] \.gl-cap \{\s*margin-top: 0\.75rem;/.test(CSS), 'block.css：below 离图 .75rem');
  const strip = (x) => x.replace(/\sdata-item-caption="[^"]*"/, '');
  const noCap = clone(DEMO); noCap.items.forEach((it) => { delete it.title; delete it.caption; });
  check(strip(render('grid', withOpts({ itemCaption: 'below' }, {}, noCap))) === strip(render('grid', withOpts({ itemCaption: 'overlay' }, {}, noCap))),
    '全部没有图注时拧 itemCaption ⟹ HTML 除根属性外逐字相同（不起作用）');
  check(/alt="Fleet service day"/.test(h), '第 1 张 alt 空 ⟹ 用 title');
  check(/alt="A technician going over the inspection sheet"/.test(h), 'alt 写了就用 alt');
  const noUrl = clone(DEMO); noUrl.items[0].image = { alt: 'x' };
  check(itemsOf(render('grid', noUrl)).length === DEMO.items.length - 1, '某项没有 image.imageUrl ⟹ 那一张不画（不留一个空 <img>）');
  const noHead = clone(DEMO); delete noHead.headline; delete noHead.body;
  const nh = render('grid', noHead);
  check(!nh.includes('data-part="intro"') && nh.includes('data-part="items"'), 'headline + body 都清空 ⟹ 块头那一列不渲染、照片照画');
  const styles = M.slots.introEyebrow.choices.style.filter((s) => s !== 'none')
    .map((s) => (/data-eyebrow="([^"]*)"/.exec(render('grid', { ...clone(DEMO), introEyebrow: { text: 'x', style: s } })) || [])[1]);
  check(styles.join() === 'pill,outline,dash,plain', `introEyebrow 四式都画得出来（${styles.join(' / ')}）`);
}

// ══ AC5（markup 一半；点开 / 翻页 / Esc / 焦点在 e2e）：Bootstrap Modal + Carousel ══════════════════════
console.log('\n── AC5 大图的 markup');
{
  const h = render('grid', clone(DEMO), 'home-gallery');
  const g = gridOf(h);
  const lb = lightboxOf(h);
  const links = g.match(/<a class="gl-img d-block"[^>]*>/g) || [];
  check(links.length === DEMO.items.length && links.every((a, i) => a.includes('href="#home-gallery-lb"') && a.includes('data-bs-toggle="modal"') && a.includes(`data-gl-index="${i}"`)),
    `每张照片一个 <a href="#<块id>-lb" data-bs-toggle="modal" data-gl-index="i">（${links.length} 个）`);
  check(/class="modal fade gl-modal" id="home-gallery-lb" tabindex="-1"/.test(h) && /class="modal-dialog modal-fullscreen"/.test(lb), 'Modal：.modal.fade#<id>-lb + .modal-dialog.modal-fullscreen');
  check(/class="btn-close btn-close-white gl-lb-close" data-bs-dismiss="modal"/.test(lb), '右上 .btn-close.btn-close-white（data-bs-dismiss="modal"）');
  // 🔴 `tabindex="-1"` 是承重的，不是装饰（Chris 2026-10-01 实测的 bug）：Bootstrap 把 keydown 挂在轮播元素
  //    自己身上（`bootstrap/js/dist/carousel.js` 的 `§_addEventListeners`），而 keydown 从聚焦元素**向上冒泡** ⟹ 只有焦点在轮播
  //    【里面】时才命中。Modal 打开时焦点给的是 Modal 自己（`bootstrap/js/dist/modal.js` 的 `§_initializeFocusTrap`（trapElement = .modal）→
  //    `bootstrap/js/dist/util/focustrap.js` 的 `§activate`（trapElement.focus()）），轮播是它的**后代** ⟹ 事件往上走，永远到不了那个 handler，
  //    表现为「不先用鼠标点一下 ▶，键盘左右键完全不工作」。没有 tabindex 则 `Lightbox.tsx` 里那句 focus() 不生效。
  //    回归测试在 `tests/e2e/specs/1495-gallery-new-knobs.spec.ts`「回归：弹窗一打开…」那条（它一次鼠标都不点）。
  check(/id="home-gallery-car" class="carousel slide" tabindex="-1" data-bs-ride="false" data-bs-interval="false" data-bs-touch="true" data-bs-keyboard="true"/.test(lb),
    'Carousel：tabindex=-1（键盘能用的前提）· data-bs-ride=false · interval=false · touch · keyboard');
  const slides = lb.match(/class="carousel-item[^"]*"/g) || [];
  check(slides.length === DEMO.items.length && slides[0] === 'class="carousel-item active"' && slides.slice(1).every((s) => s === 'class="carousel-item"'), `每张一个 .carousel-item（${slides.length}），第一张 active`);
  const big = lb.match(/<img [^>]*>/g) || [];
  check(big.length === DEMO.items.length && big.every((x) => x.includes('loading="lazy"')), `Modal 里 ${big.length} 张大图都带 loading="lazy"`);
  check(count(g, 'loading="lazy"') === 0, '（网格里的缩略图不带 lazy —— 那一条只给弹窗里的大图）');
  check(/class="carousel-control-prev" type="button" data-bs-target="#home-gallery-car" data-bs-slide="prev"/.test(lb)
    && /class="carousel-control-next" type="button" data-bs-target="#home-gallery-car" data-bs-slide="next"/.test(lb), '左右 .carousel-control-prev / -next');
  const dots = lb.match(/data-bs-slide-to="\d+"/g) || [];
  check(dots.length === DEMO.items.length && /data-bs-slide-to="0" class="active" aria-current="true"/.test(lb), `底部 ${dots.length} 个 indicator，第一个 active`);
  check(/\.gl-modal \.modal-content \{\s*background: rgba\(2, 6, 23, 0\.94\);/.test(CSS), '暗底 rgba(2,6,23,.94)');
  check(/\.gl-modal \.carousel-item img \{\s*max-width: 100%;\s*max-height: min\(80vh, 40rem\);[\s\S]*?object-fit: contain;/.test(CSS), '大图 max-height min(80vh, 40rem)、contain');
  check(/@media \(max-width: 767\.98px\) \{[\s\S]*?\.carousel-control-prev,[\s\S]*?\.carousel-control-next \{\s*display: none !important;/.test(CSS), '手机上左右箭头藏起来');
  check(/\.gl-img \{[^}]*cursor: zoom-in;/.test(CSS), '缩略图 cursor: zoom-in');
  // 同一页两块：各有各的弹窗 id；块 id 里的怪字符被换掉。
  const two = render('grid', clone(DEMO), 'b.2 x');
  check(/id="b-2-x-lb"/.test(two) && /href="#b-2-x-lb"/.test(two), '块 id 里的「.」和空格换成「-」（能放进 #… 选择器）');
  check(/id="gallery-lb"/.test(renderToStaticMarkup(React.createElement(C, { data: clone(DEMO), block: { type: 'gallery', shape: 'grid', data: {} } }))), '没有块 id ⟹ 落回 gallery-lb');
  const none = clone(DEMO); none.items = [];
  check(!render('grid', none).includes('data-part="lightbox"'), '一张照片都没有 ⟹ 不渲染弹窗');
  // 胶水：从点的那一张开始（show.bs.modal → relatedTarget.dataset.glIndex）；Carousel 实例在这里建（横滑要它）。
  check(/addEventListener\('show\.bs\.modal'/.test(LB_TEXT) && /dataset\.glIndex/.test(LB_TEXT) && /getOrCreateInstance\(car, \{ interval: false, ride: false, touch: true, keyboard: true \}\)/.test(LB_TEXT),
    'Lightbox.tsx：show.bs.modal 里按 data-gl-index 设 active、建 Carousel 实例（touch）');
}

// ══ AC6（源码一半；网络请求两臂在 e2e）：按需加载 + purge ══════════════════════════════════════════════
console.log('\n── AC6 按需加载（源码）· 运行时类不被 purge');
{
  check(/^'use client';/.test(BS_TEXT) && /^'use client';/.test(LB_TEXT) && !/^'use client'/.test(SRC_TEXT), 'BootstrapJs / Lightbox 是客户端组件，Section 是服务端组件');
  check(/import\('bootstrap\/js\/dist\/modal'\)/.test(BS_TEXT) && /import\('bootstrap\/js\/dist\/carousel'\)/.test(BS_TEXT), 'BootstrapJs：modal / carousel 各一条字面的 import()（单个模块）');
  // #1426（T4 验收 7）—— 补两支：`require('bootstrap')` 与双引号的 `from "bootstrap"`，原来那条正则两样都看不见。
  //   允许的只有深引单模块 `import('bootstrap/js/dist/<模块>')`（BootstrapJs.tsx）。
  const WHOLE_BUNDLE = `from ['"]bootstrap['"]|import\\(['"]bootstrap['"]\\)|require\\(['"]bootstrap['"]\\)|bootstrap/dist/js`;
  const grepWhole = (cwd, dirs) => {
    try {
      return execFileSync('grep', ['-rlE', WHOLE_BUNDLE, ...dirs], { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
    } catch (e) { return e.status === 1 ? '' : `grep 出错 ${e.status}`; }
  };
  const whole = grepWhole(NEXT, ['src', 'blocks']);
  check(whole === '', `全仓 src / blocks 里没有引整份 bootstrap bundle${whole ? `：${whole}` : ''}`);
  {
    // 阳性对照：同一条正则在今天的 main 上读空，不喂它会红的样本，它是不是真有牙看不出来。
    const tmp = fs.mkdtempSync(path.join(require('os').tmpdir(), 'tmp-bs-whole-'));
    const SAMPLES = {
      'a.ts': "import('bootstrap');", 'b.ts': "import 'bootstrap/dist/js/bootstrap.bundle.min.js';", 'c.ts': "import x from 'bootstrap';",
      'd.ts': "const b = require('bootstrap');", 'e.ts': 'import x from "bootstrap";', 'f.ts': "import('bootstrap/js/dist/modal');",
    };
    try {
      for (const [f, t] of Object.entries(SAMPLES)) fs.writeFileSync(path.join(tmp, f), `${t}\n`);
      const got = grepWhole(tmp, ['.']).split('\n').filter(Boolean).map((f) => path.basename(f)).sort().join(' ');
      check(got === 'a.ts b.ts c.ts d.ts e.ts', `整包守卫的阳性对照：五种整包写法都红、深引单模块放行（读到 ${got || '空'}）`);
    } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
  }
  check(/import GalleryLightbox from '\.\/Lightbox'/.test(SRC_TEXT) && /loadBootstrap\('carousel'\)/.test(LB_TEXT) && /loadBootstrap\('modal'\)/.test(LB_TEXT),
    'Section 挂 Lightbox，Lightbox 挂载时才 loadBootstrap(modal / carousel)（没有这个块的页面不挂它）');
  // AC6 的网络请求那一臂按 Bootstrap 模块自己的 DATA_KEY / EVENT_KEY 认 chunk（带引号、可带一个前导点：源码 'bs.modal'，
  // 生产压缩后 ".bs.modal"）⟹ 我们自己的源码里不许出现这个形态，否则「没有这个块的页面」那一臂会被我们的代码弄脏
  // （胶水里的 'show.bs.modal' 不算：引号后面紧跟 show）。
  let dirty = '';
  try {
    dirty = execFileSync('grep', ['-rnoE', "[\"'`]\\.?bs\\.(modal|carousel)[\"'`]", 'src', 'blocks'], { cwd: NEXT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  } catch (e) { dirty = e.status === 1 ? '' : `grep 出错 ${e.status}`; }
  check(dirty === '', `src / blocks 里带引号的 '(.)bs.modal' / '(.)bs.carousel' 0 次${dirty ? `：${dirty}` : ''}`);
  const dk = ['modal', 'carousel'].map((n) => fs.readFileSync(path.join(NEXT, 'node_modules', 'bootstrap', 'js', 'dist', `${n}.js`), 'utf-8').includes(`const DATA_KEY = 'bs.${n}';`));
  check(dk.every(Boolean), '（对照）Bootstrap 自己的 modal.js / carousel.js 里就是这两个带引号的字面（DATA_KEY）');
  const { BOOTSTRAP_RUNTIME_CLASSES } = require(BS_PATH);
  // purge 那一格：Bootstrap 的 JS 在运行时才加的类，源码里别处一次都不出现。同一份编译产物、只换 purge 的 content 清单：
  //   ① 照常（blocks/**/*.tsx + src/**/*.tsx）⟹ 这几条规则都在；② 把 BootstrapJs.tsx 从清单里拿掉 ⟹ 至少一条被删（阳性对照）。
  const siteCss = require(path.join(NEXT, 'scripts', 'lib', 'site-css.js'));
  const RULES = ['.carousel-item-next', '.carousel-item-prev', '.carousel-item-start', '.carousel-item-end', '.modal-backdrop', '.modal.show', '.modal-static', '.pointer-event'];
  let raw = null;
  try { raw = siteCss.compileSiteCss('#0d6efd'); } catch (e) { console.log(`  ⚠️  sass 编不了（${e.message.split('\n')[0]}），purge 那两格跳过 —— 不算通过`); }
  if (raw) {
    const within = (css) => RULES.filter((r) => !css.includes(r));
    const run = async () => {
      const full = await siteCss.purgeSiteCss(raw);
      check(within(full).length === 0, `照常 purge ⟹ ${RULES.length} 条运行时规则都留着`, within(full).join(' '));
      const tmp = path.join(NEXT, 'scripts', '.gallery-purge');
      fs.mkdirSync(tmp, { recursive: true });
      try {
        // 同一份 src/**/*.tsx，只少 BootstrapJs.tsx 这一份（拷到临时目录再列）。
        const files = execFileSync('find', ['src', 'blocks', '-name', '*.tsx'], { cwd: NEXT, encoding: 'utf8' }).trim().split('\n')
          .filter((f) => f !== 'src/components/BootstrapJs.tsx');
        const without = await siteCss.purgeSiteCss(raw, { content: files });
        const gone = within(without);
        check(gone.length > 0, `阳性对照：purge 清单里拿掉 BootstrapJs.tsx ⟹ ${gone.length} 条被删（${gone.join(' ')}）`);
      } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
      check(RULES.every((r) => { const cls = r.split('.').filter(Boolean).pop(); return BOOTSTRAP_RUNTIME_CLASSES.includes(cls); }),
        'BOOTSTRAP_RUNTIME_CLASSES 盖住这几条规则的类名');
    };
    PENDING.push(run());
  }
}

// ══ AC7：bg ══════════════════════════════════════════════════════════════════════════════════════
console.log('\n── AC7 bg');
{
  const at = (bg) => render('grid', withOpts({}, { bg }));
  check(attr(at('#0f172a'), 'data-tone') === 'dark' && /style="background:#0f172a"/.test(sectionTag(at('#0f172a'))), '#0f172a ⟹ data-tone="dark"、<section> 底色 #0f172a');
  check(attr(at('#ffffff'), 'data-tone') === 'light', '#ffffff ⟹ light');
  check(attr(at('brand'), 'data-tone') === 'brand', 'brand ⟹ data-tone="brand"');
  const g = at({ stops: ['#7d52f4', '#f7b733'], angle: 135 });
  check(/style="background:linear-gradient\(135deg,#7d52f4,#f7b733\)"/.test(sectionTag(g)) && attr(g, 'data-tone') === 'dark', '渐变 ⟹ linear-gradient(135deg,…) + data-tone="dark"（toneForBg）');
  check(count(SRC_TEXT, 'toneFor(') === 0 && count(SRC_TEXT, 'linear-gradient') === 0 && count(SRC_TEXT, 'toneForBg(') === 1,
    `Section.tsx 里 toneFor( ${count(SRC_TEXT, 'toneFor(')} 处、linear-gradient ${count(SRC_TEXT, 'linear-gradient')} 处、toneForBg( ${count(SRC_TEXT, 'toneForBg(')} 处`);
  check(/\[data-tone="dark"\] \.gl-title,[\s\S]*?\{\s*color: #fff !important;/.test(CSS), 'block.css：dark / brand 时标题反白');
  check(/\[data-tone="dark"\] \.gl-cap-s,\s*\[data-block="gallery"\]\[data-tone="brand"\] \.gl-cap-s \{\s*color: rgba\(255, 255, 255, 0\.92\);/.test(CSS), 'block.css：dark / brand 时图注小字白 .92');
  check(JSON.stringify(M.slots.bg) === JSON.stringify(manifestLib.loadManifests().get('footer').slots.bg), 'bg 槽对象与 footer 的 slots.bg 逐字相同');
}

// ══ AC13：摄影站只放一个相册块 ══════════════════════════════════════════════════════════════════════
console.log('\n── AC13 摄影站只放一个相册块（行业必放跟着接替走）');
{
  // 只看「整个站里没有 …」那一类（行业必放的检查）；槽位缺漏那些跟本条无关，夹具不必把每个块填满。
  const missingBlocks = (blocks, dir) => (manifestLib.validateSite({
    pages: [{ slug: 'home', blocks: [{ type: 'hero', data: {} }, ...blocks.map((type) => ({ type, data: {} })), { type: 'contact', data: {} }] }],
    industry: 'photography', scope: 'create', dir,
  }).problems || []).filter((x) => x.includes('整个站里没有'));
  const mentionsOld = (xs) => xs.filter((x) => /"gallery"|blocks\/gallery\.json/.test(x));
  // 📌 #1425（T3）—— 这里原来拿「只放旧 gallery」做阳性对照（报「没有 gallery-new」）；旧 gallery 随旧库删了，
  //    改成今天成立的两臂：放了 gallery ⟹ 一条都不报；首页没有相册块（换成 content）⟹ 报一条「没有 gallery」。
  const onlyNew = missingBlocks(['gallery']);
  check(onlyNew.length === 0, `只放 gallery ⟹ 一条「整个站里没有」都不报（${JSON.stringify(onlyNew)}）`);
  const noGallery = missingBlocks(['content']);
  check(noGallery.length === 1 && mentionsOld(noGallery).length === 1, `阳性对照：首页没有 gallery ⟹ 报一条「没有 gallery」（${JSON.stringify(noGallery)}）`);
  // 提示词里写着「every photography site must have this block」的块集合 == {gallery}。
  const mustHave = [];
  let cur = null;
  for (const l of manifestLib.promptSection('homepage').split('\n')) {
    const head = l.match(/^- "([a-z0-9-]+)"/);
    if (head) cur = head[1];
    if (cur && l.includes('every photography site must have this block')) mustHave.push(cur);
  }
  check(JSON.stringify([...new Set(mustHave)].sort()) === '["gallery"]', `提示词里 photography 必放的块 == {gallery}（${JSON.stringify(mustHave)}）`);
  // 反向对照：临时 blocks/ 里把 gallery 的 required 清空 ⟹ 首页没有 gallery 也不报 —— 上面那条报错真是从 manifest 来的。
  const tmpRoot = fs.mkdtempSync(path.join(require('os').tmpdir(), 'gallery-ind-'));
  const tmp = path.join(tmpRoot, 'blocks');
  try {
    execFileSync('cp', ['-a', path.join(NEXT, 'blocks'), tmp]);
    const mf = path.join(tmp, 'gallery', 'manifest.json');
    const back = JSON.parse(fs.readFileSync(mf, 'utf-8')); back.industries.required = [];
    fs.writeFileSync(mf, JSON.stringify(back));
    const r = missingBlocks(['content'], tmp);
    check(r.length === 0, `反向对照：gallery 的 required 清空 ⟹ 首页没有 gallery 时一条都不报（${JSON.stringify(r)}）`);
  } finally { fs.rmSync(tmpRoot, { recursive: true, force: true }); }
}

// ══ AC8：validateSite ═══════════════════════════════════════════════════════════════════════════
console.log('\n── AC8 validateSite（items 条数 · 每项要有 image.imageUrl）');
{
  const item = (i) => ({ image: { imageUrl: `https://example.com/p${i}.jpg`, alt: '' }, title: `Job ${i}` });
  const v = (data) => own(manifestLib.validateSite({ pages: [{ slug: 'p', blocks: [{ type: 'gallery', data: { headline: 'H', ...data } }] }], scope: 'edit' }));
  for (const n of [1, 25]) {
    const r = v({ items: Array.from({ length: n }, (_, i) => item(i)) });
    check(r.length >= 1 && r.every((p) => p.includes('items')), `items ${n} 张 ⟹ 被拦、报错点名 items`, JSON.stringify(r));
  }
  for (const n of [2, 24]) {
    const r = v({ items: Array.from({ length: n }, (_, i) => item(i)) });
    check(r.length === 0, `items ${n} 张 ⟹ 放行`, JSON.stringify(r));
  }
  const noImg = v({ items: [item(0), { title: 'No photo' }, item(2)] });
  check(noImg.length === 1 && noImg[0].includes('items'), `某项没有 image.imageUrl ⟹ 报一条（${JSON.stringify(noImg)}）`);
  const emptyUrl = v({ items: [item(0), { image: { imageUrl: '', alt: 'x' } }] });
  check(emptyUrl.length === 1, `image.imageUrl 是空串 ⟹ 也报一条（${JSON.stringify(emptyUrl)}）`);
  // #1512 —— 「有值」只认非空白字符串：非字符串（数字 / 布尔 / 对象 / 数组）以前一律放行，渲染端 str() 再把它滤掉 ⟹ 图静默消失。
  //    逐型各一格；正常 URL 串那一格是反向对照（防「谓词改成恒报一条」也读绿）。
  for (const [label, bad] of [['123', 123], ['true', true], ['{}', {}], ['[]', []], ['null', null], ['undefined', undefined], ["'  '", '  ']]) {
    const r = v({ items: [item(0), { image: { imageUrl: bad, alt: 'x' } }] });
    check(r.length === 1 && r[0].includes('"items" 第 2 项没有 image.imageUrl'), `image.imageUrl 是 ${label} ⟹ 报一条、点名该路径`, JSON.stringify(r));
  }
  const goodUrl = v({ items: [item(0), { image: { imageUrl: 'https://example.com/ok.jpg', alt: 'x' } }] });
  check(goodUrl.length === 0, `反向对照：image.imageUrl 是正常 URL 串 ⟹ 0 条`, JSON.stringify(goodUrl));
  check(JSON.stringify(M.slots.items.itemRequires) === '["image.imageUrl"]' && M.slots.items.minItems === 2 && M.slots.items.maxItems === 24,
    'items 的三条都是槽级声明：minItems 2 · maxItems 24 · itemRequires ["image.imageUrl"]');
  // itemRequires 写坏 ⟹ 载清单时当场拒（在一份临时 blocks/ 里只放 gallery）。
  const tmpBlocks = fs.mkdtempSync(path.join(require('os').tmpdir(), 'gallery-blocks-'));
  try {
    execFileSync('cp', ['-a', BLOCK, tmpBlocks]);
    const mf = path.join(tmpBlocks, 'gallery', 'manifest.json');
    const broken = JSON.parse(fs.readFileSync(mf, 'utf-8')); broken.slots.items.itemRequires = 'image.imageUrl';
    // 反向对照：同一份数据、清单里拿掉 itemRequires ⟹ 那一条不报（证明报它的是这条声明，不是别的检查碰巧拦下）。
    const blind = JSON.parse(fs.readFileSync(mf, 'utf-8')); delete blind.slots.items.itemRequires;
    fs.writeFileSync(mf, JSON.stringify(blind));
    const noPhoto = { headline: 'H', items: [item(0), { title: 'No photo' }] };
    const withDecl = own(manifestLib.validateSite({ pages: [{ slug: 'p', blocks: [{ type: 'gallery', data: noPhoto }] }], scope: 'edit' }));
    const without = own(manifestLib.validateSite({ pages: [{ slug: 'p', blocks: [{ type: 'gallery', data: noPhoto }] }], scope: 'edit', dir: tmpBlocks }));
    check(withDecl.length === 1 && without.length === 0, `反向对照：清单里拿掉 itemRequires ⟹ 同一份数据不再报（有 ${withDecl.length} 条 / 没有 ${without.length} 条）`);
    // loadManifests 按目录缓存 ⟹ 每个变体一个新目录。
    const loadVariant = (man) => {
      const d2 = fs.mkdtempSync(path.join(require('os').tmpdir(), 'gallery-blocks-'));
      try {
        execFileSync('cp', ['-a', BLOCK, d2]);
        fs.writeFileSync(path.join(d2, 'gallery', 'manifest.json'), JSON.stringify(man));
        try { manifestLib.loadManifests(d2); return ''; } catch (e) { return e.message; }
      } finally { fs.rmSync(d2, { recursive: true, force: true }); }
    };
    let err = loadVariant(broken);
    check(/itemRequires/.test(err), `itemRequires 写成字符串 ⟹ 载清单时报错（${err.slice(0, 90)}）`);
    broken.slots.bg.itemRequires = ['x']; broken.slots.items.itemRequires = ['image.imageUrl'];
    err = loadVariant(broken);
    check(/slots\.bg\.itemRequires/.test(err), `itemRequires 写在非 list 槽上 ⟹ 报错（${err.slice(0, 90)}）`);
  } finally { fs.rmSync(tmpBlocks, { recursive: true, force: true }); manifestLib.loadManifests(); }
  for (const p of M.presets) {
    const r = own(manifestLib.validateSite({ pages: [{ slug: 'p', blocks: [{ type: 'gallery', shape: p.shape, data: { ...clone(DEMO), options: p.knobs } }] }], scope: 'edit' }));
    check(r.length === 0, `预设 ${p.name} 那组值（六个旋钮写全）+ 演示内容 ⟹ 放行`, JSON.stringify(r));
  }
}

// ══ AC9：block-roles · 首页配方 · 提示词 · theme-pool ════════════════════════════════════════════
console.log('\n── AC9 block-roles · 首页配方');
{
  const roles = JSON.parse(fs.readFileSync(path.join(SRC, 'lib', 'sections', 'block-roles.json'), 'utf-8'));
  check(roles['gallery'] === M.roleDefault, `block-roles.json 的 gallery（${roles['gallery']}）== manifest roleDefault（${M.roleDefault}）`);
  const recipe = require(path.join(NEXT, 'scripts', 'lib', 'homepage-recipe.js'));
  const all = manifestLib.loadManifests();
  const pool = recipe.poolFor(all);
  // 📌 #1425（T3）—— 这里原来测「旧 gallery 在 NOT_IN_POOL、种数 == 交付前、拿掉它两个都进池、industries 跟旧块对齐、order 紧挨旧块、旧块 role 不变」；旧 gallery 随旧库删了（这个名字今天是新块）。今天的不变量：gallery 在池里、池子 11 种、排除名单不点它。
  check(pool.includes('gallery') && !('gallery' in recipe.NOT_IN_POOL) && pool.length === 11, `poolFor 含 gallery、gallery 不在 NOT_IN_POOL、池子 11 种（读到 ${pool.length}）`);
  // 反向对照：把 gallery 放进排除名单 ⟹ 它出池、种数 -1 —— 判据分得开。
  recipe.NOT_IN_POOL['gallery'] = 'test';
  let outPool;
  try { outPool = recipe.poolFor(all); } finally { delete recipe.NOT_IN_POOL['gallery']; }
  check(!outPool.includes('gallery') && outPool.length === pool.length - 1, `反向对照：排除 gallery ⟹ 它出池、种数 ${pool.length} → ${outPool.length}（-1）`);
  check(JSON.stringify(M.industries.required) === '["photography"]', `industries.required == ["photography"]（${JSON.stringify(M.industries.required)}）`);
  check(M.prompt.group === 'homepage', 'prompt.group == homepage');
  const lines = M.prompt.lines.join('\n');
  check(/only photos the owner uploaded/.test(lines) && /leave this block out/.test(lines) && /title says which job/.test(lines) && /caption is the place/.test(lines) && /top-level in data \(not inside options\)/.test(lines),
    'prompt.lines：只用上传的照片、没有就别放、title 写哪一单活、caption 写地点、bg 在 data 顶层');
  const pool2 = JSON.parse(fs.readFileSync(path.join(NEXT, 'scripts', 'theme-pool.json'), 'utf-8'));
  const shapes = Object.fromEntries(Object.entries(pool2).map(([id, t]) => [id, t.shapes['gallery']]));
  check(Object.values(shapes).every((s) => M.presets.some((p) => p.shape === s)), `theme-pool 两套都给了 gallery 一个预设形态（${JSON.stringify(shapes)}）`);
}

// ══ AC11（编辑器 schema 一半；往返无损由 editor-roundtrip.test.js 量）══════════════════════════════════
console.log('\n── AC11 编辑器 schema');
{
  const { editorSchema } = require(path.join(NEXT, 'scripts', 'lib', 'editor-schema.js'));
  const on = editorSchema({}).components.find((c) => c.type === 'gallery');
  check(!!on, 'Puck 组件里有 gallery（能从左栏拖进页面）');
  const order = on.fields.map((f) => f.slot);
  check(JSON.stringify(order) === JSON.stringify(['options', 'introEyebrow', 'headline', 'body', 'items', 'bg']),
    `字段顺序 = 旋钮 → 眉标 → 块头 → 照片 → bg（${order.join(' → ')}）`);
  const it = on.fields.find((f) => f.slot === 'items');
  check(it.control === 'list' && it.subs.map((x) => x.sub).join() === 'title,caption', `items 是列表字段、每张可改 title / caption（${it.subs.map((x) => x.sub).join(' / ')}）`);
  const h = render('grid', clone(DEMO));
  const paths = manifestLib.editableSlotPaths(M).map((e) => (e.sub ? `${e.slot}.${e.kind === 'list' ? '0.' : ''}${e.sub}` : e.slot));
  const missing = paths.filter((p) => !h.includes(`data-slot="${p}"`));
  check(missing.length === 0, `editLabel 的 ${paths.length} 个路径都在渲染产物的 data-slot 里`, missing.join(' · '));
  check(manifestLib.imageSlotsOf(M).some((x) => x.name === 'items'), '建站填图认得 items[].image.imageUrl 是内容图槽');
}

// 📌 #1425（T3）—— 这里原来测 AC12「旧 gallery 相对 merge-base 只改了 industries.required」；旧 gallery 随旧库删了（这个名字今天是新块）。

Promise.all(PENDING).then(() => {
  console.log(`\n══ 汇总: 通过 ${pass} · 失败 ${fail} ══`);
  process.exit(fail ? 1 : 0);
}, (e) => die(e && e.stack ? e.stack : String(e)));
