#!/usr/bin/env node
/**
 * testimonials-render.test.js — #1488 验收里「看渲染出来的 HTML / 调一次校验器就能判」的那几条。
 *
 * 跑法:  node scripts/testimonials-render.test.js   （或 `npm run test:scripts`，它按文件名发现）
 * 退出码: 0 全过 · 1 有失败 · 2 跑不起来（**不许当成通过**）
 *
 * 管哪几条：AC1（4 个预设逐字、旋钮名 / 值逐字、parts、目录集合、两两不同、旋钮独立）· AC3 的 DOM 一半（6 条引言全在
 * 服务端 HTML 里；#1494 起轮播是 Bootstrap Carousel：slide 分组、圆点、data 属性、按需 import、不自动播放）· AC4（grid 没有圆点 / 按钮）· AC6 的 DOM 顺序 ·
 * AC7（槽位空不渲染、首字母圆、星级）· AC8（bg + 不自己算亮度）· AC9（validateSite）· AC10（block-roles · 首页配方池）·
 * AC12 的编辑器 schema 一半· 图标表（星 / 箭头真画成 <svg>）。
 * #1500 起另管：summary 改成一组平台之后的 AC1（5 预设 · 8 旋钮）· AC2 logo 三档的 DOM 一半 · AC3 / AC4「只出一处」·
 * AC5 链接 · AC6 星数 · AC7 空 · AC8 旧形状 · AC9 Ratings 部件 · AC11b 改图清单 · logoUrl 不被当成内容图槽（两向）。
 * #1500 的几何与计算色在 `tests/e2e/specs/1500-testimonials-new-summary.spec.ts`。
 * 几何（16 种组合三端无横向滚动、轮播滚动 / 圆点、一列占满整列、星级对齐一线、计算色）要浏览器：
 * `tests/e2e/specs/1488-testimonials-new-knobs.spec.ts`。
 *
 * 🔴 每一段都带反向对照（同一进程、单变量），证明判据真会红。
 * 夹具定死：演示内容包里的 Northside Auto Care（`scripts/lib/demo-content`，正文做什么 8）。
 */

'use strict';

const fs = require('fs');
const path = require('path');
const Module = require('module');
const ts = require('typescript');
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');

const NEXT = path.resolve(__dirname, '..');
const SRC = path.join(NEXT, 'src');
const BLOCK = path.join(NEXT, 'blocks', 'testimonials');
const SECTION = path.join(BLOCK, 'Section.tsx');
const CAROUSEL = path.join(BLOCK, 'Carousel.tsx');

let pass = 0;
let fail = 0;
const ok = (m) => { pass += 1; console.log(`  ✅ ${m}`); };
const bad = (m) => { fail += 1; console.log(`  ❌ ${m}`); };
const die = (m) => { console.error(`🔴 跑不起来: ${m}`); process.exit(2); };
const check = (cond, m, detail) => (cond ? ok(m) : bad(detail ? `${m} —— ${detail}` : m));

// ── 让 node 能 require 这份 .tsx（同 milestones-render.test.js）──────────────────────────────────────
const sourceOverride = new Map();
for (const ext of ['.tsx', '.ts']) {
  require.extensions[ext] = (mod, filename) => mod._compile(ts.transpileModule(sourceOverride.get(filename) ?? fs.readFileSync(filename, 'utf-8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true, resolveJsonModule: true },
    fileName: filename,
  }).outputText, filename);
}
const origResolve = Module._resolveFilename;
Module._resolveFilename = function resolve(req, ...rest) {
  if (req.startsWith('@/')) return origResolve.call(this, path.join(SRC, req.slice(2)), ...rest);
  return origResolve.call(this, req, ...rest);
};

function loadSection(override) {
  delete require.cache[SECTION];
  if (override) sourceOverride.set(SECTION, override); else sourceOverride.delete(SECTION);
  return require(SECTION).default;
}

let C; let DEMO; let manifestLib; let M; let icons;
try {
  C = loadSection();
  DEMO = require(path.join(NEXT, 'scripts', 'lib', 'demo-content')).DEMO_CONTENT['testimonials'];
  manifestLib = require(path.join(NEXT, 'scripts', 'lib', 'block-manifest.js'));
  M = manifestLib.loadManifests().get('testimonials');
  icons = require(path.join(NEXT, 'scripts', 'lib', 'icons.js'));
} catch (e) { die(`载入失败: ${e.message}`); }
if (!DEMO) die('demo-content 里没有 testimonials');
if (!M) die('blocks/ 里没有 testimonials');

const clone = (v) => JSON.parse(JSON.stringify(v));
const TABLE = icons.iconTableFor('testimonials', DEMO, { warn: () => {} });
const render = (shape, data, Comp = C, iconTable = TABLE) => renderToStaticMarkup(React.createElement(Comp, {
  data, locale: 'en', iconTable, block: { id: 't', type: 'testimonials', shape, data: {} },
}));
const withOpts = (o, extra = {}, base = DEMO) => ({ ...clone(base), ...extra, options: { ...(base.options || {}), ...o } });
const count = (html, needle) => html.split(needle).length - 1;
const own = (r) => r.problems.filter((p) => p.includes('("testimonials")'));
const sectionTag = (html) => (/<section[^>]*>/.exec(html) || [''])[0];
const attr = (html, name) => { const m = new RegExp(`\\s${name}="([^"]*)"`).exec(sectionTag(html)); return m ? m[1] : null; };
const itemsOf = (html) => html.split('data-part="item"').slice(1);
// #1537 —— 条目网格的列数 / 断点由 manifest 的 itemsGrid 生成（scripts/block-build/items-grid.js），拼在 block.css 前面；
// #1535 —— 块头排版（introLayout，scripts/block-build/intro-layout.js）同样拼进来，跟 shapes.css 里的顺序一致（#1535 QA1 F1）；
//    这里读的是拼起来的那一段（= public/shapes.css 里这个块的那一段）。
const CSS = require('./block-build/items-grid').itemsGridCss(JSON.parse(fs.readFileSync(path.join(BLOCK, 'manifest.json'), 'utf-8')), 'testimonials')
  + '\n' + require('./block-build/intro-layout').introLayoutCss(JSON.parse(fs.readFileSync(path.join(BLOCK, 'manifest.json'), 'utf-8')), 'testimonials')
  + '\n' + fs.readFileSync(path.join(BLOCK, 'block.css'), 'utf-8');
const SRC_TEXT = fs.readFileSync(SECTION, 'utf-8');
const CAROUSEL_TEXT = fs.readFileSync(CAROUSEL, 'utf-8');
const KNOB_NAMES = ['introPosition', 'introAlign', 'summaryStyle', 'itemsLayout', 'itemsColumns', 'itemStyle', 'quoteSize', 'itemAlign'];
const dataAttr = (n) => `data-${n.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`)}`;

// ══ AC1：5 个预设逐字、旋钮名 / 值逐字、parts、目录集合、两两不同、旋钮独立（#1500 起 5 个预设 · 8 个旋钮）═════
console.log('── AC1 五个预设');
{
  // 列：名字 · 形态目录 · 八列旋钮（#1500 正文预设表逐字；前 4 个只是补上 summaryStyle: inline）
  const WANT = [
    ['Cards', 'cards', 'top', 'center', 'inline', 'grid', '3', 'card', 'md', 'left'],
    ['Side intro', 'side-intro', 'left', 'left', 'inline', 'carousel', '2', 'card', 'md', 'left'],
    ['Big quote', 'big-quote', 'top', 'center', 'inline', 'carousel', '1', 'plain', 'lg', 'center'],
    ['Quote card', 'quote-card', 'top', 'center', 'inline', 'carousel', '2', 'card', 'lg', 'left'],
    ['Ratings', 'ratings', 'top', 'left', 'cards', 'grid', '3', 'card', 'md', 'left'],
  ];
  const got = (M.presets || []).map((p) => [p.name, p.shape, ...KNOB_NAMES.map((c) => p.knobs[c])]);
  check(JSON.stringify(got) === JSON.stringify(WANT), 'presets 5 条与正文表逐字相同（名字 · 形态 · 八列旋钮）', JSON.stringify(got));
  check((M.presets || []).every((p) => Object.keys(p.knobs).join() === KNOB_NAMES.join()), '每个预设的 knobs 键就是这八个、同一顺序');
  check(JSON.stringify((M.presets || []).map((p) => p.parts || null)) === JSON.stringify([null, null, null, null, ['summary']]),
    `只有 Ratings 带部件 parts: ["summary"]（${JSON.stringify((M.presets || []).map((p) => p.parts || null))}）`);
  const knobs = M.slots.options.knobs.map((k) => [k.name, k.values]);
  check(JSON.stringify(knobs) === JSON.stringify([
    ['introPosition', ['left', 'right', 'top', 'bottom']], ['introAlign', ['left', 'center', 'right']],
    ['summaryStyle', ['inline', 'cards']], ['itemsLayout', ['grid', 'carousel']], ['itemsColumns', ['1', '2', '3']],
    ['itemStyle', ['plain', 'card']], ['quoteSize', ['md', 'lg']], ['itemAlign', ['left', 'center']],
  ]), `slots.options.knobs 名字依次 ${knobs.map((k) => k[0]).join(' / ')}、values 与定稿表逐字（values[0] = 默认）`);
  check(JSON.stringify(M.parts) === '["summary"]', `parts == ["summary"]（${JSON.stringify(M.parts)}）`);
  const dirs = fs.readdirSync(BLOCK, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name).sort();
  check(JSON.stringify(dirs) === JSON.stringify(WANT.map((w) => w[1]).sort()), `目录集合 == 5 个预设形态（${dirs.join(' / ')}）`);
  check(dirs.every((d) => !fs.existsSync(path.join(BLOCK, d, 'Section.tsx'))), '一份 Section.tsx（形态目录里没有第二份 markup）');
  check(M.skin === 'site-css' && M.roleDefault === 'optional', `skin=${M.skin} · roleDefault=${M.roleDefault}`);
  const htmls = dirs.map((d) => render(d, clone(DEMO)));
  check(new Set(htmls).size === 5, `同一份夹具下 5 个预设渲染出 ${new Set(htmls).size} 份互不相同的 HTML`);
  const pinned = dirs.map((d) => render(d, withOpts(M.presets[0].knobs)).replace(/data-shape="[^"]*"/g, ''));
  check(new Set(pinned).size === 1, '反向对照：options 里写死八个旋钮 ⟹ 5 个预设（去掉 data-shape 之后）塌成同一份 —— 判据分得开');
  const r = render('cards', clone(DEMO));
  const miss = KNOB_NAMES.filter((n) => attr(r, dataAttr(n)) !== M.presets[0].knobs[n]);
  check(miss.length === 0, 'Cards：八个旋钮都写在 <section> 上', miss.join(' · '));
  // 旋钮独立：拧一个，其余七个不变（组件里没有联动纠正）。
  const base = M.presets[1].knobs;
  const moved = [];
  for (const k of M.slots.options.knobs) {
    for (const v of k.values) {
      const h = render('side-intro', withOpts({ [k.name]: v }));
      const others = KNOB_NAMES.filter((n) => n !== k.name);
      if (attr(h, dataAttr(k.name)) !== v || others.some((n) => attr(h, dataAttr(n)) !== base[n])) moved.push(`${k.name}=${v}`);
    }
  }
  check(moved.length === 0, `旋钮独立（Side intro 上逐个拧 ${M.slots.options.knobs.reduce((n, k) => n + k.values.length, 0)} 档）：拧的那个到位、其余七个不变`, moved.join(' · '));
}

// ══ AC3 / AC4（DOM 一半）：轮播全在服务端 HTML 里；grid 没有圆点 / 按钮 ═══════════════════════════════
console.log('\n── AC3 / AC4 轮播与网格');
{
  const car = render('side-intro', clone(DEMO));
  const grid = render('cards', clone(DEMO));
  check(count(car, '<blockquote') === DEMO.items.length && DEMO.items.length === 6, `carousel：服务端 HTML 里 <blockquote> ${count(car, '<blockquote')} 个 == 夹具 6 条`);
  check(count(car, '<figure') === 6 && count(car, '<figcaption') === 6, '每条是 <figure> + <blockquote> + <figcaption>');
  // 收起非当前 slide 的只能是 Bootstrap 自己的 `.carousel-item { display: none }` 规则；服务端 HTML 里不许藏任何一条。
  check(!/display:\s*none/.test(car) && !/\shidden[\s>=]/.test(car), 'carousel：服务端 HTML 里没有行内 display:none、没有 hidden 属性（6 条全在、一条都没在服务端藏起来）');
  // #1494 AC1：一张 slide 放 itemsColumns 条，服务端分好组；圆点每张 slide 一个。
  const slidesOf = (html) => html.split('data-part="slide"').slice(1).map((x) => count(x.split('data-part="pager"')[0].split('data-part="slide"')[0], 'data-part="item"'));
  const dotsOf = (html) => count(html, 'data-bs-slide-to=');
  const at = (cols) => render('side-intro', withOpts({ itemsColumns: cols }));
  check(JSON.stringify(slidesOf(car)) === '[2,2,2]' && dotsOf(car) === 3 && count(car, 'class="carousel-item') === 3,
    `itemsColumns=2 + 6 条 ⟹ 3 张 .carousel-item、每张 2 条、圆点 3 个（${JSON.stringify(slidesOf(car))} · 圆点 ${dotsOf(car)}）`);
  check(JSON.stringify(slidesOf(at('1'))) === '[1,1,1,1,1,1]' && dotsOf(at('1')) === 6, `itemsColumns=1 ⟹ 6 张（${JSON.stringify(slidesOf(at('1')))}）`);
  check(JSON.stringify(slidesOf(at('3'))) === '[3,3]' && dotsOf(at('3')) === 2, `itemsColumns=3 ⟹ 2 张（${JSON.stringify(slidesOf(at('3')))}）`);
  const five = { ...withOpts({ itemsColumns: '2' }), items: clone(DEMO.items).slice(0, 5) };
  check(JSON.stringify(slidesOf(render('side-intro', five))) === '[2,2,1]', '对照：5 条 / 2 列 ⟹ 最后一张 1 条（分组是真按列数切的）');
  check(count(car, 'class="carousel-item active"') === 1 && car.indexOf('class="carousel-item active"') < car.indexOf('class="carousel-item"'),
    '只有第一张 slide 带 active');
  check(/<div id="tn-carousel-t" class="carousel slide tn-carousel" data-part="carousel" data-bs-ride="false" data-bs-interval="false" data-bs-touch="true" data-bs-keyboard="true" tabindex="0" aria-label="Customer reviews"/.test(car),
    '.carousel 根：id 由 block.id 拼、data-bs-ride/interval="false"（不自动播放）、touch、keyboard、tabindex="0"（键盘可切）');
  const code = (t) => t.replace(/^\s*\/\/.*$/gm, '');
  check(!/data-bs-ride="carousel"/.test(car) && !/data-bs-ride="carousel"/.test(code(SRC_TEXT + '\n' + CAROUSEL_TEXT)), '没有 data-bs-ride="carousel"（那是自动初始化 + 自动播放的开关）');
  const ind = /<div class="carousel-indicators tn-dots">([\s\S]*?)<\/div>/.exec(car);
  check(!!ind && count(ind[1], 'data-bs-target="#tn-carousel-t"') === 3 && count(ind[1], 'class="active" aria-current="true" aria-label="Slide 1"') === 1 && /aria-label="Slide 3"/.test(ind[1]),
    '圆点 = .carousel-indicators 里每张 slide 一个按钮，data-bs-target 指着本轮播；第 1 个 active + aria-current');
  check(/data-bs-target="#tn-carousel-t" data-bs-slide="prev" aria-label="Previous"/.test(car) && /data-bs-target="#tn-carousel-t" data-bs-slide="next" aria-label="Next"/.test(car),
    '前 / 后按钮 = 带 data-bs-target + data-bs-slide="prev|next" 的普通按钮（不用 .carousel-control-*）');
  check(!/carousel-control-/.test(car), '没有 .carousel-control-*（压在图上的全高按钮）');
  check(car.indexOf('carousel-indicators') > car.indexOf('class="carousel slide') && car.indexOf('data-bs-slide="next"') < car.indexOf('</section>')
    && car.lastIndexOf('data-part="carousel"') < car.indexOf('carousel-indicators'), '圆点和按钮都在 .carousel 元素里面（Bootstrap 只更新它自己里面的 indicators）');
  const noId = renderToStaticMarkup(React.createElement(C, { data: clone(DEMO), locale: 'en', iconTable: TABLE, block: { type: 'testimonials', shape: 'side-intro', data: {} } }));
  check(/<div id="tn-carousel" class="carousel/.test(noId) && /data-bs-target="#tn-carousel"/.test(noId), '老站的块没有 id ⟹ 用 tn-carousel（重名时 Carousel.tsx 挂载后换一个）');
  check(count(grid, 'data-part="pager"') === 0 && count(grid, 'data-bs-') === 0 && count(grid, 'tn-arrow') === 0 && count(grid, 'carousel') === 0 && count(grid, '<blockquote') === 6,
    'grid：没有轮播、圆点、按钮节点，6 条全部摊开');
  check(!/tabindex/.test(grid), 'grid：不可聚焦（不切换，就不占 Tab 顺序）');
  // JS 按需：Section.tsx 里一个 bootstrap 都不引；Carousel.tsx 只在 effect 里动态 import 那一个模块。
  check(!/bootstrap/.test(code(SRC_TEXT)), 'Section.tsx 里没有引 bootstrap（静态 import 会进每一页的路由 chunk）');
  check(/import\('bootstrap\/js\/dist\/carousel'\)/.test(code(CAROUSEL_TEXT)) && !/^\s*import [^(]*bootstrap/m.test(code(CAROUSEL_TEXT)) && !/bootstrap\.bundle/.test(code(CAROUSEL_TEXT)),
    "Carousel.tsx：只 import('bootstrap/js/dist/carousel')（动态、只这一个模块），没有静态 import、没有整份 bundle —— 网络请求的两臂在 e2e 里量");
  check(/getOrCreateInstance\(el\)/.test(CAROUSEL_TEXT) && !/set(Timeout|Interval)|requestAnimationFrame|\.cycle\(/.test(code(CAROUSEL_TEXT)), 'Carousel.tsx：getOrCreateInstance、没有定时器 / cycle（不自动播放）');
  check(/^'use client';/.test(CAROUSEL_TEXT) && !/^'use client'/.test(SRC_TEXT), '只有 Carousel.tsx 是客户端组件，Section.tsx 不是');
  check(!fs.existsSync(path.join(BLOCK, 'Pager.tsx')), 'Pager.tsx（手写的圆点 / 前后逻辑）已删');
  // Bootstrap 滑动中途才挂的四个类：purge 按源码字面词留规则，它们必须逐字出现在 blocks/**/*.tsx 里。
  check(['carousel-item-next', 'carousel-item-prev', 'carousel-item-start', 'carousel-item-end'].every((c) => CAROUSEL_TEXT.includes(c)),
    'Carousel.tsx 里逐字写着 carousel-item-next / -prev / -start / -end（site.css purge 才会留下它们的规则）');
  check(/\.tn-slide \{\s*--items-cols: 1;\s*display: grid;/.test(CSS) && /min-width: 992px\) \{[^@]*\[data-items-columns="3"\] \.tn-slide \{\s*--items-cols: 3;/.test(CSS), 'block.css：.tn-slide 网格（<768 一列、768–991 两列、≥992 按列数）');
  check(/\.tn-dots \{\s*position: static;/.test(CSS) && /\.tn-dots \.active \{\s*width: 1\.5rem;\s*background: var\(--x-primary\);/.test(CSS), 'block.css：indicators 拉回下面、当前那个拉长成主色短条');
  // 反向对照：把 Section 的分组改成「一张 slide 放全部」⟹ 上面那格会红。
  const C2 = loadSection(SRC_TEXT.replace('const perSlide = Math.max(1, Number(k.itemsColumns) || 1);', 'const perSlide = 99;'));
  const one = renderToStaticMarkup(React.createElement(C2, { data: clone(DEMO), locale: 'en', iconTable: TABLE, block: { id: 't', type: 'testimonials', shape: 'side-intro', data: {} } }));
  loadSection();
  check(JSON.stringify(slidesOf(one)) === '[6]', `反向对照：不按列数分组 ⟹ 读到 ${JSON.stringify(slidesOf(one))}（上面那格分得开）`);
}

// ══ AC5（规则一半）：一列也占满整列、不跟 introAlign（#1516，Chris 2026-10-01；取代 #1488 那条「一列照 faq 限 48rem」）══
console.log('\n── AC5 一列占满整列（规则）');
{
  // 评价列（.tn-itemscol）上不许有任何 max-width / margin 规则 —— 块头在侧时那条 width: 66.6667% 是唯一一条。
  const itemsColRules = (css) => (css.replace(/\/\*[\s\S]*?\*\//g, '').match(/[^{}]*\.tn-itemscol\s*\{[^}]*\}/g) || []);
  const bad = (css) => itemsColRules(css).filter((r) => /max-width|margin/.test(r.slice(r.indexOf('{'))));
  check(bad(CSS).length === 0, `block.css：评价列没有 max-width / margin 规则（读到 ${bad(CSS).length} 条）`);
  check(!/data-intro-align[^{]*\.tn-itemscol/.test(CSS.replace(/\/\*[\s\S]*?\*\//g, '')), 'block.css：评价列的规则不跟 introAlign');
  const old = CSS + '\n[data-block="testimonials"][data-items-columns="1"][data-intro-position="top"][data-intro-align="center"] .tn-itemscol { max-width: 48rem; margin-left: auto; }';
  check(bad(old).length === 1, `反向对照：塞回一条旧写法 ⟹ 读到 ${bad(old).length} 条（上面那格分得开）`);
}

// ══ AC6：每条的顺序 ═════════════════════════════════════════════════════════════════════════════════
console.log('\n── AC6 每条的顺序');
{
  const its = itemsOf(render('cards', clone(DEMO)));
  const order = its.map((x) => [x.indexOf('<blockquote'), x.indexOf('<figcaption'), x.indexOf('data-part="meta"')]);
  check(order.every(([q, p, s]) => q >= 0 && q < p && (s === -1 || p < s)), `DOM 顺序 = 引言 → 人 → 星级 + 来源（${its.length} 条都是）`);
  check(/\.tn-meta \{\s*margin-top: auto;/.test(CSS), 'block.css：星级那行 margin-top:auto（等高时贴卡底）—— 对齐一线在 e2e 里量');
}

// ══ AC7：槽位空 → 不渲染；首字母圆；星级 ══════════════════════════════════════════════════════════════
console.log('\n── AC7 槽位');
{
  const full = render('cards', clone(DEMO));
  const noSum = clone(DEMO); delete noSum.summary;
  check(count(full, 'data-part="summary"') === 1 && count(render('cards', noSum), 'data-part="summary"') === 0, 'summary：有值渲染、清空不渲染');
  const badSum = clone(DEMO); badSum.summary = [{ count: 312, source: 'Google' }];
  check(count(render('cards', badSum), 'data-part="summary"') === 0, 'summary 唯一那个平台没写 rating（没有真实评分）⟹ 那一排不画');
  const its = itemsOf(full);
  const photos = its.map((x) => count(x, '<img'));
  const inits = its.map((x) => count(x, 'data-part="initials"'));
  check(photos.join('') === '111100' && inits.join('') === '000011', `4 条带头像 ⟹ <img>；2 条没有 ⟹ 首字母圆、没有 <img>（img ${photos.join('')} · 首字母 ${inits.join('')}）`);
  check(/data-part="initials" aria-hidden="true">SP</.test(full) && /aria-hidden="true">AR</.test(full), '首字母 = 名字前两个词的首字母（Sam Patel → SP、Ana Rodrigues → AR）');
  const starsOf = (x) => ({ fill: count(x, 'data-star="fill"'), half: count(x, 'data-star="half"'), empty: count(x, 'data-star="empty"') });
  const s4 = starsOf(its[5]);
  check(s4.fill === 4 && s4.empty === 1 && s4.half === 0, `rating: 4 ⟹ 4 颗实心星（+ 1 颗空心补到 5）（${JSON.stringify(s4)}）`);
  check(its.slice(0, 5).every((x) => starsOf(x).fill === 5), '其余 rating: 5 ⟹ 5 颗实心');
  const noRate = clone(DEMO); delete noRate.items[0].rating;
  const nr = itemsOf(render('cards', noRate))[0];
  check(count(nr, 'data-part="stars"') === 0 && count(nr, 'data-slot="items.0.source"') === 1, '某条没 rating ⟹ 没有星级节点、来源照常');
  const neither = clone(DEMO); delete neither.items[0].rating; delete neither.items[0].source;
  check(count(itemsOf(render('cards', neither))[0], 'data-part="meta"') === 0, '对照：rating 和 source 都没有 ⟹ 整行不画');
  const noHead = clone(DEMO); delete noHead.headline; delete noHead.body;
  const nh = render('cards', noHead);
  check(!nh.includes('data-part="intro"') && nh.includes('data-part="items"'), 'headline + body 都清空 ⟹ 块头那一列不渲染、评价照画');
}

// ══ 图标：星 / 箭头真画成 <svg>（BLOCK_ICONS 那一行）════════════════════════════════════════════════
console.log('\n── 图标');
{
  // #1500 —— 半星不再用到（平台评分四舍五入成整数颗）；平台品牌图标从 review-platforms.js 那张表现取。
  const want = ['star-fill', 'star', 'chevron-left', 'chevron-right', 'google', 'yelp', 'facebook'];
  check(JSON.stringify(icons.BLOCK_ICONS['testimonials']) === JSON.stringify(want) && want.every((n) => TABLE[n]), `BLOCK_ICONS['testimonials'] == ${want.join(' / ')}，表里七个都查得到`);
  const car = render('side-intro', clone(DEMO));
  const svgIn = (html, sel) => { const i = html.indexOf(sel); const j = html.indexOf('</button>', i); return i >= 0 && /<svg[^>]*>[\s\S]*<path/.test(html.slice(i, j)); };
  check(svgIn(car, 'aria-label="Previous"') && svgIn(car, 'aria-label="Next"'), '前 / 后按钮里各有一个非空的内联 <svg>');
  check(itemsOf(car).every((x) => (x.match(/data-star="[a-z]+"[^>]*><svg/g) || []).length === 5), '每条 5 颗星都是内联 <svg>');
  check(count(render('side-intro', clone(DEMO), C, {}), '<svg') === 0, '对照：不给图标表 ⟹ 一个 <svg> 都没有（图标全靠服务端那张表）');
  // 📌 #1425（T3）—— 反向臂原来拿旧 testimonials；改回正名后两个名字撞成一个（这格写成了恒假的 X && !X），
  //    换成今天库里真不用图标表的 gallery。
  check(icons.usesIconTable('testimonials') && !icons.usesIconTable('gallery'), 'usesIconTable：testimonials 用、gallery（不画图标的块）不用');
}

// ══ AC8：bg ══════════════════════════════════════════════════════════════════════════════════════
console.log('\n── AC8 bg');
{
  const at = (bg) => render('cards', withOpts({}, { bg }));
  check(attr(at('#0f172a'), 'data-tone') === 'dark' && /style="background:#0f172a"/.test(sectionTag(at('#0f172a'))), '#0f172a ⟹ data-tone="dark"、<section> 底色 #0f172a');
  check(attr(at('#ffffff'), 'data-tone') === 'light', '#ffffff ⟹ light');
  check(attr(at('brand'), 'data-tone') === 'brand', 'brand ⟹ data-tone="brand"');
  const g = at({ stops: ['#7d52f4', '#f7b733'], angle: 135 });
  check(/style="background:linear-gradient\(135deg,#7d52f4,#f7b733\)"/.test(sectionTag(g)) && attr(g, 'data-tone') === 'dark', '渐变 ⟹ linear-gradient(135deg,…) + data-tone="dark"');
  check(attr(at(undefined), 'data-tone') === 'light' && !/\sstyle=/.test(sectionTag(at(undefined))), '没写 bg ⟹ light、<section> 没有 style');
  check(count(SRC_TEXT, 'toneFor(') === 0 && count(SRC_TEXT, 'linear-gradient') === 0,
    `Section.tsx 里 toneFor( ${count(SRC_TEXT, 'toneFor(')} 处、linear-gradient ${count(SRC_TEXT, 'linear-gradient')} 处（都调 contrast.js 的共用函数）`);
  check(/\[data-tone="dark"\] \.tn-quote,[\s\S]*?\{\s*color: #fff !important;/.test(CSS) && /\[data-tone="dark"\] \.tn-arrow,[\s\S]*?\{\s*background: transparent;\s*border-color: rgba\(255, 255, 255, 0\.35\);/.test(CSS),
    'block.css：深底引言 / 名字反白；前后按钮透明底 + 半透明白描边');
  check(!/\.text-muted\s*\{[^}]*rgba\(255, 255, 255/.test(CSS), '身份 / 来源白 .92 走全站那条（site-css.js §ON_DEEP_MUTED），block.css 里没有自己那份');
  check(JSON.stringify(M.slots.bg) === JSON.stringify(manifestLib.loadManifests().get('footer').slots.bg), 'bg 槽对象与 footer 的 slots.bg 逐字相同');
}

// ══ AC9：validateSite ═══════════════════════════════════════════════════════════════════════════
console.log('\n── AC9 validateSite');
{
  const item = (i, extra = {}) => ({ quote: `Quote ${i}`, name: `Person ${i}`, ...extra });
  const v = (data) => own(manifestLib.validateSite({ pages: [{ slug: 'p', blocks: [{ type: 'testimonials', data: { headline: 'H', ...data } }] }], scope: 'edit' }));
  for (const n of [0, 13]) {
    const r = v({ items: Array.from({ length: n }, (_, i) => item(i)) });
    check(r.length >= 1 && r.every((p) => p.includes('items')) && r.some((p) => p.includes(n ? '最多只能有 12 项' : '至少要 1 项')), `items ${n} 条 ⟹ 被拦、报错点名 items`, JSON.stringify(r));
  }
  for (const n of [1, 12]) check(v({ items: Array.from({ length: n }, (_, i) => item(i, { rating: 5 })) }).length === 0, `items ${n} 条 ⟹ 放行`);
  const r6 = v({ items: [item(0, { rating: 6 })] });
  check(r6.length === 1 && r6[0].includes('items[0].rating') && r6[0].includes('1–5'), 'rating: 6 ⟹ 报一条（点名 items[0].rating）', JSON.stringify(r6));
  check(['4.5', 0, 2.5].every((x) => v({ items: [item(0, { rating: x })] }).length === 1), 'rating "4.5" / 0 / 2.5 ⟹ 各报一条（要 1–5 的整数）');
  check([1, 3, 5].every((x) => v({ items: [item(0, { rating: x })] }).length === 0) && v({ items: [item(0)] }).length === 0, 'rating 1 / 3 / 5 / 不写 ⟹ 放行');
  check(JSON.stringify(M.slots.items.ranges) === '{"rating":[1,5]}', `判据从 manifest 读：slots.items.ranges == {"rating":[1,5]}（不是写死在校验器里的块名单）`);
  // 声明本身被校验：写歪了 manifest 当场拒（写成字符串的失败方向是静默的）。
  const tmp = fs.mkdtempSync(path.join(require('os').tmpdir(), 'tn-ranges-'));
  try {
    const load = (ranges) => {
      const dir = path.join(tmp, String(Math.random()).slice(2));
      fs.cpSync(BLOCK, path.join(dir, 'testimonials'), { recursive: true });
      const mf = path.join(dir, 'testimonials', 'manifest.json');
      const j = JSON.parse(fs.readFileSync(mf, 'utf-8')); j.slots.items.ranges = ranges; fs.writeFileSync(mf, JSON.stringify(j));
      try { manifestLib.loadManifests(dir); return ''; } catch (e) { return e.message; }
    };
    const bogus = load({ rating: ['1', '5'] });
    check(/ranges\.rating/.test(bogus), `ranges 写成字符串 ⟹ manifest 当场被拒（${bogus.slice(0, 90)}）`);
    check(load({ rating: [1, 5] }) === '', '对照：原样 [1, 5] ⟹ 载得进');
  } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
  for (const p of M.presets) {
    check(v({ ...clone(DEMO), options: p.knobs }).length === 0, `预设 ${p.name} 那组值（八个旋钮写全）+ 演示内容 ⟹ 放行`);
  }
}

// ══ QA2 r1 打回：评价头像不是内容图 · 总评分不许照抄提示词里的示例数字 ═══════════════════════════════
// 真建站（siteId 1488a003）读到：imageSlotsOf 把 items[].photo 当成内容图槽 ⟹ 每条评价拿到一张 AI 生成的
// 店内场景照当头像；summary 两次都原样写成提示词示例里的 4.9 / 312（连「No reviews yet」的生意也是）。
const avatarChecks = (async () => {
  console.log('\n── 头像不生成（generateImages: false）· 总评分提示词不带示例数字');
  const ims = require(path.join(NEXT, 'scripts', 'lib', 'image-slots.js'));
  const all = manifestLib.loadManifests();
  const slotsOf = (m) => JSON.stringify(manifestLib.imageSlotsOf(m));
  check(slotsOf(all.get('testimonials')) === '[]', `imageSlotsOf(testimonials) == []（现取 ${slotsOf(all.get('testimonials'))}）`);
  // 对照：拿掉那条声明 ⟹ 它又被读成内容图槽（上面那格的绿是声明换来的，不是 shape 恰好读不出来）。
  const noDecl = clone(all.get('testimonials')); delete noDecl.slots.items.generateImages;
  check(slotsOf(noDecl) === '[{"name":"items","kind":"list","imageKey":"photo"}]', `对照：拿掉 generateImages ⟹ 读成 items/photo（${slotsOf(noDecl)}）`);
  // 真走一遍建站填图那一步：没带 photo 的评价不求图、不写 photo。
  const run = async (manifests) => {
    let calls = 0;
    const pages = [{ slug: 'home', sections: [{ type: 'testimonials', data: { headline: 'H', items: [{ quote: 'q', name: 'Marcus T.' }, { quote: 'q2', name: 'Priya S.' }] } }] }];
    await ims.fillImageSlots({ pages, manifests, industry: 'auto repair', primaryColor: '#3b82f6', themeWord: 'minimal',
      produce: async ({ key }) => { calls += 1; return `/photos/${key}.jpg`; } });
    return { calls, items: pages[0].sections[0].data.items };
  };
  const fillReal = await run(all);
  check(fillReal.calls === 0 && fillReal.items.every((it) => it.photo === undefined), `fillImageSlots：求图 ${fillReal.calls} 次、没有一条被写上 photo`);
  const withoutDecl = new Map(all); withoutDecl.set('testimonials', noDecl);
  const fillCtl = await run(withoutDecl);
  check(fillCtl.calls === 2 && fillCtl.items.every((it) => it.photo && it.photo.imageUrl), `对照：拿掉声明 ⟹ 求图 ${fillCtl.calls} 次、每条都被写上 photo（这正是 r1 的缺陷）`);
  // 老板上传的头像照样能写进来：写入闸认的是字段名 imageUrl，跟生不生成无关。
  const urls = require(path.join(NEXT, 'scripts', 'lib', 'image-urls.js'));
  const fields = urls.collectImagePositions({ items: [{ photo: { imageUrl: 'https://uploads.example/x.jpg' } }] });
  check(fields.length === 1 && fields[0] === 'https://uploads.example/x.jpg', `写入闸仍认得 items[].photo.imageUrl（读到 ${JSON.stringify(fields)}）`);
  // 声明本身被校验：只收字面 false、只给带图的槽。
  const tmp = fs.mkdtempSync(path.join(require('os').tmpdir(), 'tn-genimg-'));
  try {
    const load = (edit) => {
      const dir = path.join(tmp, String(Math.random()).slice(2));
      fs.cpSync(BLOCK, path.join(dir, 'testimonials'), { recursive: true });
      const mf = path.join(dir, 'testimonials', 'manifest.json');
      const j = JSON.parse(fs.readFileSync(mf, 'utf-8')); edit(j); fs.writeFileSync(mf, JSON.stringify(j));
      try { manifestLib.loadManifests(dir); return ''; } catch (e) { return e.message; }
    };
    check(/generateImages/.test(load((j) => { j.slots.items.generateImages = 'false'; })), 'generateImages 写成字符串 "false" ⟹ manifest 当场被拒');
    check(/generateImages/.test(load((j) => { j.slots.headline.generateImages = false; })), 'generateImages 写在不带图的槽（headline）⟹ 当场被拒');
    check(load(() => {}) === '', '对照：原样 ⟹ 载得进');
  } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
  const summaryLine = (M.prompt.lines || []).find((l) => /^summary\b/.test(l)) || '';
  check(summaryLine !== '' && !/\d\.\d|\b\d{2,}\b/.test(summaryLine), `summary 那行提示词里没有可被照抄的示例数字（${summaryLine.slice(0, 80)}…）`);
  check(/\d\.\d|\b\d{2,}\b/.test('summary {rating, count, source} only when … (e.g. 4.9 from 312 Google reviews)'), '对照：r1 那句（e.g. 4.9 from 312）⟹ 上面那格会红');
})();

// ══ AC10：block-roles · 首页配方 ══════════════════════════════════════════════════════════════════
console.log('\n── AC10 block-roles · 首页配方');
{
  const roles = JSON.parse(fs.readFileSync(path.join(SRC, 'lib', 'sections', 'block-roles.json'), 'utf-8'));
  check(roles['testimonials'] === M.roleDefault, `block-roles.json 的 testimonials（${roles['testimonials']}）== manifest roleDefault（${M.roleDefault}）`);
  const recipe = require(path.join(NEXT, 'scripts', 'lib', 'homepage-recipe.js'));
  const all = manifestLib.loadManifests();
  const pool = recipe.poolFor(all);
  // 📌 #1425（T3）—— 这里原来测「旧 testimonials 在 NOT_IN_POOL、拿掉它两个都进池」；旧 testimonials 随旧库删了（这个名字今天是新块）。今天的不变量：testimonials 在池里、池子 11 种、排除名单不点它。
  check(pool.includes('testimonials') && !('testimonials' in recipe.NOT_IN_POOL) && pool.length === 11, `poolFor 含 testimonials、testimonials 不在 NOT_IN_POOL、池子 11 种（读到 ${pool.length}）`);
  // 反向对照：把 testimonials 放进排除名单 ⟹ 它出池、种数 -1 —— 判据分得开。
  recipe.NOT_IN_POOL['testimonials'] = 'test';
  let outPool;
  try { outPool = recipe.poolFor(all); } finally { delete recipe.NOT_IN_POOL['testimonials']; }
  check(!outPool.includes('testimonials') && outPool.length === pool.length - 1, `反向对照：排除 testimonials ⟹ 它出池、种数 ${pool.length} → ${outPool.length}（-1）`);
  const without = recipe.poolFor(new Map([...all].filter(([k]) => k !== 'testimonials')));
  check(without.length === pool.length - 1 && !without.includes('testimonials'), `对照：块库里没有 testimonials ⟹ 池子 ${without.length} 种（少一）`);
  check(M.prompt.group === 'homepage' && Number.isInteger(M.prompt.order), `prompt.group == homepage、order ${M.prompt.order}`);
  const lines = M.prompt.lines.join('\n');
  check(/never invent/.test(lines) && /source is the platform/.test(lines) && /summary is a list of rating platforms \(at most 4\)/.test(lines)
    && /if none is stated, leave summary out entirely, never make one up/.test(lines) && /top-level in data \(not inside options\)/.test(lines),
    'prompt.lines：只放真实评价不编造、source 写平台、summary 是一组平台（最多 4 个）且只在有真实评分时写、bg 在 data 顶层');
}

// ══ AC12（编辑器 schema 一半；往返无损由 editor-roundtrip.test.js 对全部页面块量）═══════════════════════
console.log('\n── AC12 编辑器 schema');
{
  const { editorSchema } = require(path.join(NEXT, 'scripts', 'lib', 'editor-schema.js'));
  const { presetNameFor } = require(path.join(NEXT, 'scripts', 'lib', 'block-knobs.js'));
  const on = editorSchema({}).components.find((c) => c.type === 'testimonials');
  check(!!on, 'Puck 组件里有 testimonials（能从左栏拖进页面）');
  const order = on.fields.map((f) => f.slot);
  check(JSON.stringify(order) === JSON.stringify(['options', 'introEyebrow', 'headline', 'body', 'summary', 'items', 'bg']),
    `字段顺序 = 旋钮 → 眉标 → 块头 → summary → items → bg（${order.join(' → ')}）`);
  const opt = on.fields[0];
  check(opt.control === 'options' && opt.presets.map((p) => p.name).join() === M.presets.map((p) => p.name).join()
    && opt.knobs.map((k) => k.name).join() === KNOB_NAMES.join(), '第一个字段：预设 5 个 → 八个旋钮');
  const it = on.fields.find((f) => f.slot === 'items');
  check(it.control === 'list' && it.subs.map((x) => x.sub).join() === 'quote,name,role,source', `items 是列表字段、每条可改 quote / name / role / source（${it.subs.map((x) => x.sub).join(' / ')}）`);
  const man = { slots: { options: { knobs: opt.knobs } }, presets: opt.presets };
  check(presetNameFor(man, M.presets[2].knobs) === 'Big quote' && presetNameFor(man, { ...M.presets[2].knobs, itemsColumns: '2' }) === 'custom',
    '点 Big quote = 那一组旋钮；拧偏一个（itemsColumns=2）⟹ custom');
}

// ══ #1500：summary 是一组平台 —— logo 三档 · 两种摆法只出一处 · 链接 · 星数 · 空 · 旧形状 · Ratings 部件 ═══════
// 几何（inline 跟 introAlign 对齐、cards 一行三张 / 右列顶上 / 390 矮条、计算色、深底）要浏览器：
// `tests/e2e/specs/1500-testimonials-new-summary.spec.ts`。
console.log('\n── #1500 summary：一组平台');
{
  // summary 那一排的 HTML：inline 在块头里（到评价列开头为止），cards 在评价列顶上（到轨道开头为止）。
  const sumOf = (html) => {
    const i = html.indexOf('data-part="summary"');
    if (i < 0) return '';
    const ends = ['data-part="items"', 'data-part="track"'].map((m) => html.indexOf(m, i)).filter((j) => j > 0);
    return html.slice(i, Math.min(...ends));
  };
  const platformsOf = (html) => sumOf(html).split('data-part="platform"').slice(1);
  const inl = render('cards', clone(DEMO));
  const crd = render('ratings', clone(DEMO));
  // AC2 logo 三档（DOM 一半；计算色 rgb(66, 133, 244) 在 e2e 里量）
  const ps = platformsOf(inl);
  check(ps.length === 4 && DEMO.summary.length === 4, `夹具 4 个平台 ⟹ 4 个 platform 节点（${ps.length}）`);
  const [g, y, h, f] = ps;
  check(/data-logo="icon" style="--tn-brand:#4285F4"><svg[^>]*data-icon="google"/.test(g), 'Google ⟹ 内置图标 google（Bootstrap Icons 的 google.svg）、品牌色 #4285F4');
  check(/data-logo="icon" style="--tn-brand:#d32323"><svg[^>]*data-icon="yelp"/.test(y), 'Yelp ⟹ 内置图标 yelp、品牌色 #d32323');
  check(/data-logo="icon" style="--tn-brand:#1877F2"><svg[^>]*data-icon="facebook"/.test(f), 'Facebook ⟹ 内置图标 facebook、品牌色 #1877F2');
  check(/data-logo="name"[^>]*>HomeStars</.test(h) && !/<svg[^>]*data-icon="(google|yelp|facebook)"/.test(h) && !/<img/.test(h), 'HomeStars ⟹ 没有图标、没有图，写平台名');
  check(ps.every((x, i) => new RegExp(`data-slot="summary\\.${i}\\.source">${DEMO.summary[i].source}<`).test(x)), '每项的 DOM 里都有文字平台名（图标档是 visually-hidden 那段，名字档是名字本身），data-slot = summary.N.source');
  check(/class="visually-hidden" data-slot="summary.0.source">Google</.test(g), 'Google 那项的平台名是 visually-hidden（读屏 / 搜索 / AI 读得到）');
  const up = clone(DEMO); up.summary[2].logoUrl = 'https://uploads.example/homestars.png';
  const hu = platformsOf(render('cards', up))[2];
  check(/data-logo="image"><img src="https:\/\/uploads.example\/homestars.png" alt="HomeStars"/.test(hu) && !/data-logo="name"/.test(hu), '给 HomeStars 加 logoUrl ⟹ <img alt="HomeStars">、没有文字那一档');
  const sp = clone(DEMO); sp.summary[2] = { source: ' google ', rating: 4.7, count: 28 };
  check(/data-icon="google"/.test(platformsOf(render('cards', sp))[2]), 'source " google "（大小写 / 首尾空格）⟹ 照样命中 google 图标');
  const upG = clone(DEMO); upG.summary[0].logoUrl = 'https://uploads.example/g.png';
  check(/data-logo="image"/.test(platformsOf(render('cards', upG))[0]) && !/data-icon="google"/.test(platformsOf(render('cards', upG))[0]), '对照：Google 也给了 logoUrl ⟹ 上传的图优先于内置图标');
  check(/require\('\.\/review-platforms'\)\.PLATFORM_ICONS/.test(fs.readFileSync(path.join(NEXT, 'scripts', 'lib', 'icons.js'), 'utf-8'))
    && /from '\.\.\/\.\.\/scripts\/lib\/review-platforms\.js'/.test(SRC_TEXT) && !/#4285F4|#d32323|#1877F2/i.test(SRC_TEXT),
    '平台表只住 review-platforms.js 一处：Section.tsx 引它、icons.js 从它现取、Section.tsx 里没有抄一份品牌色');
  // AC3 / AC4（DOM 一半）：按 summaryStyle 只出一处
  const where = (html) => {
    const intro = html.slice(html.indexOf('data-part="intro"'), html.indexOf('data-part="items"'));
    const itemsCol = html.slice(html.indexOf('data-part="items"'));
    return { intro: count(intro, 'data-part="summary"'), items: count(itemsCol, 'data-part="summary"'), total: count(html, 'data-part="summary"') };
  };
  check(JSON.stringify(where(inl)) === '{"intro":1,"items":0,"total":1}' && attr(inl, 'data-summary-style') === 'inline', `inline（Cards）⟹ 只有块头里那一排（${JSON.stringify(where(inl))}）`);
  check(JSON.stringify(where(crd)) === '{"intro":0,"items":1,"total":1}' && attr(crd, 'data-summary-style') === 'cards', `cards（Ratings）⟹ 只有评价列顶上那一排（${JSON.stringify(where(crd))}）`);
  const itemsHtml = crd.slice(crd.indexOf('data-part="items"'));
  check(itemsHtml.indexOf('data-part="summary"') < itemsHtml.indexOf('data-part="track"'), 'cards 那一排在评价轨道之前（评价那一列的最上面）');
  check(/data-slot="summary.0.rating">4.9<\/span> out of 5<\/span>/.test(platformsOf(crd)[0]) && /from <span data-slot="summary.0.count">312<\/span> reviews/.test(platformsOf(crd)[0]),
    'cards 每张：「4.9 out of 5」·「from 312 reviews」');
  check(/data-slot="summary.0.rating">4.9<\/span>/.test(platformsOf(inl)[0]) && /<span data-slot="summary.0.count">312<\/span> reviews/.test(platformsOf(inl)[0]),
    'inline 每条：大数字 4.9 · 五星 · 「312 reviews」');
  const sideCards = render('side-intro', withOpts({ summaryStyle: 'cards' }));
  check(JSON.stringify(where(sideCards)) === '{"intro":0,"items":1,"total":1}', 'introPosition=left + cards ⟹ 卡在右列（评价那一列）里');
  // AC5 链接
  check(/<a class="tn-platform[^"]*" data-part="platform" data-source="Google" href="https:\/\/www.google.com\/maps" target="_blank" rel="noopener">/.test(inl)
    && /<div class="tn-platform[^"]*" data-part="platform" data-source="Yelp">/.test(inl) && /<div class="tn-platform[^"]*" data-part="platform" data-source="HomeStars">/.test(inl),
    '有 href 的 Google 那项是 <a target="_blank" rel="noopener">；Yelp / HomeStars 没有 href ⟹ <div>');
  check(/<a class="tn-platform tn-platform-card[^"]*"[^>]*href="https:\/\/www.google.com\/maps" target="_blank" rel="noopener">/.test(crd), 'cards 那一档同样：整张卡是链接');
  // AC6 星数：四舍五入到整数颗实心
  const starsAt = (r) => { const d = clone(DEMO); d.summary = [{ source: 'Google', rating: r, count: 10 }]; return count(platformsOf(render('cards', d))[0], 'data-star="fill"'); };
  const got6 = [4.9, 4.5, 4.4, 4.7, '4.4'].map(starsAt);
  check(JSON.stringify(got6) === '[5,5,4,5,4]', `rating 4.9 / 4.5 / 4.4 / 4.7 / "4.4"（编辑器改过的字符串）⟹ ${got6.join(' / ')} 颗实心（要 5 / 5 / 4 / 5 / 4）`);
  check(count(inl, 'data-star="half"') === 0 && !/star-half/.test(SRC_TEXT), '不画半颗（Section.tsx 里没有 star-half）');
  // AC7 summary 为空
  const empties = [undefined, [], [{ source: 'Google' }], [{ rating: 4.9, count: 3 }]];
  check(empties.every((v) => { const d = clone(DEMO); if (v === undefined) delete d.summary; else d.summary = v; return count(render('cards', d), 'data-part="summary"') === 0 && count(render('ratings', d), 'data-part="summary"') === 0; }),
    'summary 不写 / [] / 平台缺 rating / 缺 source ⟹ 两处都没有 summary 节点');
  const strip = (h) => h.replace(/ data-summary-style="[^"]*"/, '');
  const e1 = clone(DEMO); delete e1.summary;
  const a = render('cards', withOpts({ summaryStyle: 'inline' }, {}, e1));
  const b = render('cards', withOpts({ summaryStyle: 'cards' }, {}, e1));
  check(a !== b && strip(a) === strip(b), 'summary 为空：summaryStyle 两个值的 HTML 除 data-summary-style 外逐字相同（这个旋钮此时不起作用，写明不算缺陷）');
  check(strip(render('cards', withOpts({ summaryStyle: 'inline' }))) !== strip(render('cards', withOpts({ summaryStyle: 'cards' }))), '对照：summary 有值 ⟹ 两个值去掉 data-summary-style 之后仍不同（上一格的「相同」是空带来的）');
  const five = clone(DEMO); five.summary = [1, 2, 3, 4, 5].map((i) => ({ source: `P${i}`, rating: 4, count: i }));
  check(platformsOf(render('cards', five)).length === 4, '平台超过 maxItems 4 ⟹ 只画前 4 个（validateSite 另外报错）');
  // AC8 旧形状（#1488 的单个对象）
  const vv = (summary) => {
    const data = { ...clone(DEMO), summary };
    const pages = [{ slug: 'p', blocks: [{ type: 'testimonials', data }] }];
    return { problems: own(manifestLib.validateSite({ pages, scope: 'edit' })), data };
  };
  const old = vv({ rating: '4.9', count: '312', source: 'Google' });
  check(old.problems.length === 0 && JSON.stringify(old.data.summary) === '[{"rating":4.9,"count":312,"source":"Google"}]',
    `旧形状 {rating:"4.9",count:"312",source:"Google"} ⟹ validateSite 不报错、就地包成一项（${JSON.stringify(old.data.summary)}）`);
  check(platformsOf(render('cards', old.data)).length === 1, '包过之后渲染出一项');
  check(count(render('cards', { ...clone(DEMO), summary: { rating: '4.9', count: '312', source: 'Google' } }), 'data-part="summary"') === 0,
    '对照：不经 validateSite 直接喂对象 ⟹ 组件不认（只有一处迁移，不写两套渲染）');
  // 真读入路径（QA1 #1500 r2）：构建 / 编辑器 / AI 改站都先过 blocks.js §normalizeLocalePages，再 validateSite。
  //    那一跳会把「列表槽、值不是数组」换成 `[]`；上面那格直接调 validateSite，量不到它。
  {
    const blocksLib = require(path.join(NEXT, 'scripts', 'blocks.js'));
    const viaFunnel = (summary) => {
      const pages = [{ slug: 'p', blocks: [{ type: 'testimonials', data: { ...clone(DEMO), summary } }] }];
      blocksLib.normalizeLocalePages(pages, {}, 'en', {});
      const problems = own(manifestLib.validateSite({ pages, scope: 'build' }));
      return { problems, data: pages[0].blocks[0].data };
    };
    const legacy = { rating: '4.9', count: '312', source: 'Google' };
    const f = viaFunnel(clone(legacy));
    check(JSON.stringify(f.data.summary) === '[{"rating":4.9,"count":312,"source":"Google"}]' && f.problems.length === 0
      && platformsOf(render('cards', f.data)).length === 1,
      `旧形状走真读入路径（normalizeLocalePages → validateSite）⟹ 迁成一项、不报错、渲染出一项（${JSON.stringify(f.data.summary)}）`);
    const fresh = viaFunnel([{ source: 'Google', rating: 4.9, count: 312 }]);
    check(JSON.stringify(fresh.data.summary) === '[{"source":"Google","rating":4.9,"count":312}]' && fresh.problems.length === 0,
      '对照：新形状走同一条路 ⟹ 原样不动');
    const raw = { type: 'testimonials', data: { ...clone(DEMO), summary: clone(legacy) } };
    check(JSON.stringify(blocksLib.normalizeListSlots(raw).data.summary) === '[{"rating":4.9,"count":312,"source":"Google"}]'
      && JSON.stringify(raw.data.summary) === JSON.stringify(legacy),
      'normalizeListSlots 自己迁（不在它之后才迁），而且不改传进来的那个对象');
    check(JSON.stringify(blocksLib.normalizeListSlots({ type: 'cta', data: { ctas: { label: 'x' } } }).data.ctas) === '[]',
      '对照：不在迁移名单里的列表槽写成对象 ⟹ 照旧换成 []（迁移只认点名的那一个槽）');
  }
  // 真跑一次构建（role-user #1500 r4 要求：回归必须走 sync-config.js 这条路，不能只调函数）：
  //    拷一棵树 → skipAI 建站 → 页面里放一块旧形状、一块新形状 → 子进程跑 sync-config.js →
  //    从它写出的 config-data.ts 里取回这两块 → 交给真的 Section.tsx 渲染。同 item-sources.test.js §AC2 的台子。
  {
    const cp = require('child_process');
    const os = require('os');
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'tn1500-build-'));
    try {
      const work = path.join(tmp, 'nextjs');
      cp.execSync(`cp -a --no-dereference "${NEXT}" "${work}"`, { stdio: 'pipe' });
      for (const junk of ['out', '.next', '.out-backup', '.out-temp', 'site', 'node_modules']) fs.rmSync(path.join(work, junk), { recursive: true, force: true });
      fs.symlinkSync(path.join(NEXT, 'node_modules'), path.join(work, 'node_modules'));
      const payload = JSON.stringify({ siteId: 'tn1500ab', companyName: 'Northside Auto Care', industry: 'auto repair', location: 'Toronto', skipAI: true, language: 'en' });
      const made = cp.spawnSync(process.execPath, [path.join(work, 'scripts', 'create-site.js')], {
        input: payload, cwd: work, encoding: 'utf8', env: { ...process.env, ANTHROPIC_API_KEY: undefined }, timeout: 180000,
      });
      const homeFile = path.join(work, 'site', 'en', 'pages', 'home.json');
      if (!fs.existsSync(homeFile)) die(`skipAI 建站没立起来（rc=${made.status}）\n${(made.stderr || '').slice(-600)}`);
      const home = JSON.parse(fs.readFileSync(homeFile, 'utf-8'));
      const tn = (id, summary) => ({ id, type: 'testimonials', shape: 'cards', data: { ...clone(DEMO), headline: id, summary } });
      home.blocks = [...(home.blocks || []), tn('tn-legacy', { rating: '4.9', count: '312', source: 'Google' }), tn('tn-fresh', [{ source: 'Google', rating: 4.9, count: 312 }])];
      fs.writeFileSync(homeFile, JSON.stringify(home, null, 2));
      const built = cp.spawnSync(process.execPath, [path.join(work, 'scripts', 'sync-config.js')], { cwd: work, encoding: 'utf8', timeout: 180000 });
      if (built.status !== 0) die(`sync-config.js rc=${built.status}\n${(built.stderr || built.stdout || '').slice(-800)}`);
      const out = fs.readFileSync(path.join(work, 'src', 'lib', 'config-data.ts'), 'utf-8');
      const blockById = (id) => {
        // 产物里块的键序是 id 在前（`{"id":…,"type":…}`）；也认 type 在前的写法，免得键序一变这格就找不到块。
        const at = out.indexOf(`"id":"${id}"`);
        if (at < 0) return null;
        const st = out.startsWith('{', at - 1) ? at - 1 : out.lastIndexOf('{"type":"testimonials"', at);
        if (st < 0) return null;
        let depth = 0; let j = st;
        for (; j < out.length; j += 1) { if (out[j] === '{') depth += 1; else if (out[j] === '}') { depth -= 1; if (!depth) break; } }
        return JSON.parse(out.slice(st, j + 1));
      };
      const legacyB = blockById('tn-legacy');
      const freshB = blockById('tn-fresh');
      const log = `${built.stdout || ''}${built.stderr || ''}`;
      check(legacyB && JSON.stringify(legacyB.data.summary) === '[{"rating":4.9,"count":312,"source":"Google"}]' && (legacyB.has || []).includes('summary'),
        `真跑 sync-config.js：旧形状那块在 config-data.ts 里是一项数组、has 含 summary（${legacyB && JSON.stringify(legacyB.data.summary)}）`);
      check(legacyB && platformsOf(render('cards', legacyB.data)).length === 1, '用构建产物里那块渲染 ⟹ 画出一个平台');
      check(!/"summary" 至少要/.test(log), '构建日志里没有「"summary" 至少要 1 项」那条（r3 时旧块被清空就会报它）');
      check(freshB && JSON.stringify(freshB.data.summary) === '[{"source":"Google","rating":4.9,"count":312}]', '对照：新形状那块走同一次构建 ⟹ 原样不动');
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  }
  const r5 = vv([1, 2, 3, 4, 5].map((i) => ({ source: `P${i}`, rating: 4, count: i }))).problems;
  check(r5.length === 1 && r5[0].includes('"summary"') && r5[0].includes('最多只能有 4 项'), `summary 5 项 ⟹ 报一条、点名 summary（${r5[0] || ''}）`);
  const rr6 = vv([{ source: 'Google', rating: 6, count: 3 }]).problems;
  check(rr6.length === 1 && rr6[0].includes('summary[0].rating'), `rating: 6 ⟹ 报一条（${rr6[0] || ''}）`);
  check(vv([{ source: 'Google', rating: 4.95, count: 3 }]).problems.length === 1 && vv([{ source: 'Google', rating: 4.9, count: 0 }]).problems.length === 1,
    'rating 4.95（两位小数）/ count 0 ⟹ 各报一条');
  check(vv(clone(DEMO.summary)).problems.length === 0 && vv({ rating: '4.9', count: '312' }).problems.length === 0, '夹具 3 个平台 / 旧形状缺 source ⟹ 放行');
  check(JSON.stringify(M.slots.summary.ranges) === '{"rating":[0,5,1],"count":[1,null]}' && M.slots.summary.minItems === 1 && M.slots.summary.maxItems === 4 && M.slots.summary.kind === 'list',
    `判据从 manifest 读：summary 是 list、1–4 项、ranges ${JSON.stringify(M.slots.summary.ranges)}`);
  // AC9 Ratings 预设（编辑器侧：presetClickProps / presetNameFor，同 team 的 Hiring 三条）
  const { editorSchema } = require(path.join(NEXT, 'scripts', 'lib', 'editor-schema.js'));
  const { presetClickProps, presetNameFor } = require(path.join(NEXT, 'scripts', 'lib', 'block-knobs.js'));
  const comp = editorSchema({}).components.find((c) => c.type === 'testimonials');
  const opt = comp.fields.find((f) => f.control === 'options');
  const man = { slots: { options: { knobs: opt.knobs } }, presets: opt.presets };
  const nameOf = (props) => presetNameFor(man, { ...(props.options || {}), summary: props.summary });
  check(JSON.stringify(opt.partDemos) === '{"summary":[{"source":"Google","rating":4.9,"count":120}]}', `编辑器带下去的占位 = 槽上的 demo（${JSON.stringify(opt.partDemos)}）`);
  const start = { options: { ...M.presets[0].knobs }, summary: undefined };
  const clicked = presetClickProps(opt, start, 'Ratings');
  check(JSON.stringify(clicked.summary) === JSON.stringify(opt.partDemos.summary) && nameOf(clicked) === 'Ratings', `空 summary 时点 Ratings ⟹ 填上占位、Ratings 亮（${nameOf(clicked)}）`);
  const own3 = { options: { ...M.presets[0].knobs }, summary: clone(DEMO.summary) };
  check(JSON.stringify(presetClickProps(opt, own3, 'Ratings').summary) === JSON.stringify(DEMO.summary), '已经有 summary 时点 Ratings ⟹ 不覆盖（3 个平台还在）');
  const back = presetClickProps(opt, clicked, 'Cards');
  check(JSON.stringify(back.summary) === JSON.stringify(opt.partDemos.summary) && nameOf(back) === 'Cards', `再点 Cards ⟹ summary 内容还在、Cards 亮（${nameOf(back)}）`);
  check(nameOf({ ...clicked, summary: [] }) === 'custom' && nameOf({ ...clicked, summary: undefined }) === 'custom', 'summary 清空（[] / 不写）⟹ 跟 Ratings 一样的旋钮组合显示 Custom');
  const blind = presetClickProps({ ...opt, partDemos: {} }, start, 'Ratings');
  check(blind.summary === undefined && nameOf(blind) === 'custom', '阳性对照：没有 partDemos ⟹ 点 Ratings 不填、不亮（上面「填上」是槽上 demo 带来的）');
  const sf = comp.fields.find((f) => f.slot === 'summary');
  check(sf && sf.control === 'list' && sf.subs.map((x) => x.sub).join() === 'source,rating,count', `Puck 里 summary 是列表字段（能增删平台），每项改 source / rating / count（${sf && sf.subs.map((x) => x.sub).join(' / ')}）`);
  // PM 07:32 第 2 条：logoUrl 不被当成内容图槽（建站不编平台 logo）—— 靠字段名，两向守住
  const all = manifestLib.loadManifests();
  check(!manifestLib.imageSlotsOf(all.get('testimonials')).some((x) => x.name === 'summary'), 'imageSlotsOf(testimonials) 不含 summary ⟹ 建站不给平台生成 logo');
  const renamed = clone(all.get('testimonials')); renamed.slots.summary.shape = renamed.slots.summary.shape.replace('logoUrl', 'imageUrl');
  check(manifestLib.imageSlotsOf(renamed).some((x) => x.name === 'summary'), '反向对照：shape 里 logoUrl 改名成 imageUrl ⟹ 立刻被当成内容图槽（这正是要守的那件事）');
  // AC11b 改图清单 + 提示词
  const editSite = fs.readFileSync(path.join(NEXT, 'scripts', 'edit-site.js'), 'utf-8');
  const imgLine = editSite.split('\n').find((l) => /^- a \*\*testimonials\*\* block → /.test(l)) || '';
  check(imgLine.includes('data.items[].photo.imageUrl') && imgLine.includes('data.summary[].logoUrl'), `edit-site.js ## Images 段 testimonials 那一行同时有 items[].photo.imageUrl 与 summary[].logoUrl`);
  const sumLine = (M.prompt.lines || []).find((l) => /^summary\b/.test(l)) || '';
  check(/logoUrl only when the owner gave you that platform's logo image — without one leave it out/.test(sumLine) && /href/.test(sumLine), 'prompt.lines 的 summary 那句写了 logoUrl 与「没有就不写」、href');
}

// 📌 #1425（T3）—— 这里原来测 AC13「旧 testimonials 相对 merge-base 与工作区零改动」；旧 testimonials 随旧库删了（这个名字今天是新块）。

avatarChecks.then(() => {
  console.log(`\n══ 汇总: 通过 ${pass} · 失败 ${fail} ══`);
  process.exit(fail ? 1 : 0);
}, (e) => { console.error(`🔴 跑不起来: ${e.stack || e.message}`); process.exit(2); });
