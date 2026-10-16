#!/usr/bin/env node
/**
 * header-render.test.js — #1462（header 定稿第 2 版）验收 1 / 2 / 3 / 4 / 10 里「只看渲染出来的 HTML
 * 就能判」的那几条；#1468 起旋钮是 logo（left | center | right）· menu（beside | …），topbar 是布尔开关。
 *
 * 跑法:  node scripts/header-render.test.js   （或 `npm run test:scripts`，它按文件名发现）
 * 退出码: 0 全过 · 1 有失败 · 2 跑不起来（**不许当成通过**）
 *
 * 做法照 `footer-render.test.js`：`ts.transpileModule` + `renderToStaticMarkup`，源码可以在内存里替换
 * （反向对照用）。抽屉自 #1514 起是 Bootstrap Collapse：服务端 HTML 里一直有它，直接量（藏 / 显是 `.collapse` 的事）。
 * 几何（820 / 390 上是汉堡、1440 上整条菜单、`document.fonts`）要浏览器，不在这里 —— 交接报告里那份
 * playwright 读数归它。
 *
 * 🔴 每一段都带一格反向对照（同一进程、单变量），证明判据真会红。
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
const BLOCK_DIR = path.join(NEXT, 'blocks', 'header');
const SECTION = path.join(BLOCK_DIR, 'Section.tsx');

let pass = 0;
let fail = 0;
const ok = (m) => { pass += 1; console.log(`  ✅ ${m}`); };
const bad = (m) => { fail += 1; console.log(`  ❌ ${m}`); };
const die = (m) => { console.error(`🔴 跑不起来: ${m}`); process.exit(2); };
const check = (cond, m, detail) => (cond ? ok(m) : bad(detail ? `${m} —— ${detail}` : m));

const sourceOverride = new Map();
function compile(filename) {
  const src = sourceOverride.get(filename) ?? fs.readFileSync(filename, 'utf-8');
  return ts.transpileModule(src, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true, resolveJsonModule: true },
    fileName: filename,
  }).outputText;
}
for (const ext of ['.tsx', '.ts']) {
  require.extensions[ext] = (mod, filename) => mod._compile(compile(filename), filename);
}
const origResolve = Module._resolveFilename;
Module._resolveFilename = function resolve(req, ...rest) {
  if (req.startsWith('@/')) return origResolve.call(this, path.join(SRC, req.slice(2)), ...rest);
  return origResolve.call(this, req, ...rest);
};

const ORIGINAL = fs.readFileSync(SECTION, 'utf-8');
function loadSection(override) {
  delete require.cache[SECTION];
  if (override) sourceOverride.set(SECTION, override); else sourceOverride.delete(SECTION);
  return require(SECTION).default;
}
/** 源码里换一处；锚点找不到就回 null（调用方记一格「反向对照没改到」）。 */
const mutate = (from, to) => (ORIGINAL.includes(from) ? ORIGINAL.replace(from, to) : null);

let C; let DEMO; let MANIFEST; let ICONS;
try {
  C = loadSection();
  // #1506 —— 夹具的页头顶条电话 / 地址、次按钮写成引用（`{source: "phone"}` …）。组件吃的是展开后的 data
  //    （单格页、以后真站都先过 `resolveItemSources`），所以这里先展开一次，站点数据用演示生意那一份。
  const demoLib = require(path.join(NEXT, 'scripts', 'lib', 'demo-content'));
  const { resolveItemSources } = require(path.join(NEXT, 'scripts', 'lib', 'item-sources.js'));
  DEMO = resolveItemSources([{ type: 'header', data: demoLib.DEMO_CONTENT['header'] }], demoLib.demoSourceContext())[0].data;
  MANIFEST = JSON.parse(fs.readFileSync(path.join(BLOCK_DIR, 'manifest.json'), 'utf-8'));
  ICONS = require(path.join(NEXT, 'scripts', 'lib', 'icons.js')).iconTableFor('header', DEMO);
} catch (e) { die(`载入失败: ${e.message}`); }
if (!DEMO) die('demo-content 里没有 header 那一份');

const clone = (v) => JSON.parse(JSON.stringify(v));
const withOpts = (o) => ({ ...clone(DEMO), options: { ...DEMO.options, ...o } });
const render = (shape, data, Comp = C) => renderToStaticMarkup(React.createElement(Comp, { shape, data, iconTable: ICONS }));
const attr = (html, name) => { const m = html.match(new RegExp(`<header[^>]*\\s${name}="([^"]*)"`)); return m ? m[1] : null; };
// #1514：抽屉改成 Bootstrap Collapse，服务端 HTML 里一直有它（藏是 `.collapse` 的事）⟹ 量抽屉不再需要改初值重载。
C = loadSection();

// 定稿表（#1462 票正文「七个预设」那张，#1788 起六个 —— 切两半的 split / gathered 换成一个 logo-center；#1468 起 menu 的 right 叫 beside、topbar 是布尔 —— 这里写成根上读到的 on / off）。
const TABLE = [
  ['logo-left', 'left', 'beside', 'off'],
  ['menu-center', 'left', 'center', 'off'],
  ['logo-center', 'center', 'left', 'off'],
  ['topbar', 'left', 'beside', 'on'],
  ['stacked', 'center', 'below', 'off'],
  ['topbar-stacked', 'center', 'below', 'on'],
];
const NAMES = TABLE.map((r) => r[0]);

// ══ ① 验收 1：目录集合 == 6 个预设名；manifest presets 与定稿表逐字相同；没有「形态名 → 布局」表 ════
console.log('① 目录集合 · manifest presets · 形态表退役');
{
  const dirs = fs.readdirSync(BLOCK_DIR, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name).sort();
  const want = [...NAMES].sort();
  check(JSON.stringify(dirs) === JSON.stringify(want), `blocks/header/ 的目录集合 == 6 个预设名`, `读到 ${dirs.join(' · ')}`);
  check(!['stacked-topbar', 'stacked-centered', 'logo-center-split', 'logo-center-gathered'].some((d) => dirs.includes(d)), '旧名 stacked-topbar / stacked-centered / logo-center-split / logo-center-gathered 不在');
  // 形状：顶层 presets = [{ name, shape, knobs, options }]，旋钮声明在 slots.options.knobs（#1468 起 topbar 在 options）。
  const got = (MANIFEST.presets || []).map((p) => [p.name, p.knobs && p.knobs.logo, p.knobs && p.knobs.menu, p.options && (p.options.topbar ? 'on' : 'off')]);
  check(JSON.stringify(got) === JSON.stringify(TABLE), 'manifest.presets 6 条与定稿表逐字相同（含顺序）', JSON.stringify(got));
  check((MANIFEST.presets || []).every((p) => Object.keys(p).sort().join() === 'knobs,name,options,shape' && p.shape === p.name
    && Object.keys(p.knobs).sort().join() === 'logo,menu' && typeof p.options.topbar === 'boolean'), '每条预设是 { name, shape, knobs:{logo,menu}, options:{topbar} }，shape = 目录名 = name');
  const knobDecl = ((MANIFEST.slots.options || {}).knobs || []).map((k) => `${k.name}:${k.values.join('|')}`);
  check(JSON.stringify(knobDecl) === JSON.stringify(['logo:left|center|right', 'menu:beside|center|left|below', 'logoType:text|image']),
    'slots.options.knobs 声明三个旋钮（#1468 / #1788 值域 + #1784 的 logoType，没有预设写到）、顺序 = 控件顺序', JSON.stringify(knobDecl));
  // #1784 r7 —— logoSize 是数字（图高 px），住 slots.options.numbers：24–80、步长 4、默认 40（Chris 2026-10-15 那条留言里的数）。
  const nums = ((MANIFEST.slots.options || {}).numbers || []).map((n) => `${n.name}:${n.min}-${n.max}/${n.step}=${n.default}`);
  check(JSON.stringify(nums) === JSON.stringify(['logoSize:24-80/4=40']), '#1784 r7：slots.options.numbers 只声明 logoSize 24–80 步长 4 默认 40', JSON.stringify(nums));
  // 行为判据（PM r2 裁定 ②）：Section 不导出、也不声明一张「形态名 → 布局」的表 —— 去掉注释之后没有 SHAPES。
  const code = ORIGINAL.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
  check(!/\bSHAPES\b/.test(code), 'Section.tsx 的代码里（去掉注释）没有 SHAPES');
  check(!NAMES.some((n) => code.includes(`'${n}'`) && n !== 'logo-left'), 'Section.tsx 的代码里除默认 logo-left 外没有写死任何预设名（布局只由旋钮派生）');
}

// ══ ② 验收 2：6 个预设 HTML 两两不同；每个预设的旋钮值 + topbar 与表一致 ══════════════════════════════
console.log('\n② 6 个预设两两不同 · 旋钮读数');
{
  const htmls = NAMES.map((n) => render(n, clone(DEMO)));
  check(new Set(htmls).size === NAMES.length, `同一份夹具下 ${NAMES.length} 个预设的 HTML 两两不同（${new Set(htmls).size} 种）`);
  TABLE.forEach(([n, logo, menu, topbar], i) => {
    const h = htmls[i];
    const read = [attr(h, 'data-logo'), attr(h, 'data-menu'), attr(h, 'data-topbar'), attr(h, 'data-preset')];
    check(JSON.stringify(read) === JSON.stringify([logo, menu, topbar, n]), `${n}：data-logo/menu/topbar/preset = ${logo}/${menu}/${topbar}/${n}`, JSON.stringify(read));
    const cls = attr(h, 'class') || '';
    check(cls.includes(`hdr-logo-${logo}`) && cls.includes(`hdr-menu-${menu}`) && cls.includes(`hdr-topbar-${topbar}`), `${n}：根上的三个派生类（logo · menu · topbar）`, cls);
  });
  // 反向对照：旋钮不进根上的类（布局类不再由旋钮派生）⟹ topbar 与 logo-left 那一对只差顶条之外的类就对不上。
  const s = mutate('`hdr-menu-${menu}`,', "'',");
  if (!s) bad('反向对照没改到源码（锚点找不到）');
  else {
    const Cb = loadSection(s);
    const h = render('logo-center', clone(DEMO), Cb);
    check(!(attr(h, 'class') || '').includes('hdr-menu-left'), '反向对照：拿掉 hdr-menu-* ⟹ 上面「根上的三个派生类」那格会红');
    C = loadSection();
  }
}

// ══ #1788：logo-center 三格 —— a = 整条菜单、b = logo、c = 社交 + 按钮；只有一个菜单 ul，装着全部菜单项 ════════════
console.log('\n#1788 logo-center 的三格');
{
  const h = render('logo-center', clone(DEMO));
  const at = (cls) => h.indexOf(`class="${cls} `);
  const [a, b, c] = ['hdr-a', 'hdr-b', 'hdr-c'].map(at);
  const end = h.indexOf('</nav>', c);
  check(a > 0 && a < b && b < c && c < end, '三格都在、顺序 a · b · c');
  const cellA = h.slice(a, b); const cellB = h.slice(b, c); const cellC = h.slice(c, end);
  const grid = h.slice(a, end);
  const labels = (DEMO.nav || []).map((n) => n.label);
  check(labels.length >= 4, `夹具菜单至少 4 项才量得出「没切两半」（${labels.length}）`);
  check((grid.match(/<ul class="navbar-nav/g) || []).length === 1 && (cellA.match(/<ul class="navbar-nav/g) || []).length === 1,
    '桌面三格里只有一个菜单 ul，在 a 格');
  {
    const t = render('logo-center', withOpts({ topbar: true }));
    const main = t.slice(t.indexOf('class="hdr-a '), t.indexOf('</nav>', t.indexOf('class="hdr-c ')));
    check(!main.includes('data-hdr-part="social"') && t.includes('data-hdr-part="bar-social"'),
      'logo-center + topbar：社交只在顶条里，主行 0 个（#1785 PM r3 裁定第 2 条）');
  }
  check(labels.every((l) => cellA.includes(`>${l}<`)) && !labels.some((l) => cellC.includes(`>${l}<`)), `a 格装着全部 ${labels.length} 项菜单，c 格一项都没有`);
  check(cellB.includes('hdr-brand') && !cellA.includes('hdr-brand') && !cellC.includes('hdr-brand'), 'logo 在 b 格（正中那一栏）');
  const ctaLabels = (DEMO.buttons || []).filter((x) => x && x.label).map((x) => x.label); // #1787 起按钮是 header.buttons 一份列表
  check(ctaLabels.length > 0 && ctaLabels.every((l) => cellC.includes(`>${l}<`)) && !ctaLabels.some((l) => cellA.includes(`>${l}<`)),
    `c 格装着按钮（${ctaLabels.join(' · ')}），a 格没有`);
  const demoSocial = DEMO.social || (DEMO.topbar && DEMO.topbar.social) || []; // #1785 起顶栏社交读顶层 `social`，跟 Section.tsx 同一个来源
  check(demoSocial.length > 0, `夹具有社交链接才量得出「c 格出社交」（${demoSocial.length}）`);
  check(cellC.includes('data-hdr-part="social"'), 'c 格的社交：没开 topbar 时在按钮左边（#1785 PM r3 裁定第 2 条：走 besideCtas(false)）');
  check(attr(h, 'data-logo') === 'center' && attr(h, 'data-menu') === 'left' && (attr(h, 'class') || '').includes('hdr-menu-left'), 'data-logo=center · data-menu=left · 根上 hdr-menu-left');
}

// ══ ③ 验收 3：Section 自己纠正 logo=center + menu=beside ⟹ menu=left ══════════════════════════
console.log('\n③ 旋钮纠正 · topbar 开关（Section 那一次）');
{
  const h = render('logo-left', withOpts({ logo: 'center', menu: 'beside' }));
  check(attr(h, 'data-menu') === 'left' && attr(h, 'data-logo') === 'center', 'logo=center + menu=beside ⟹ 落地 logo=center、menu=left', `读到 ${attr(h, 'data-logo')}/${attr(h, 'data-menu')}`);
  const h2 = render('logo-left', withOpts({ logo: 'left', menu: 'left' }));
  check(attr(h2, 'data-menu') === 'beside', 'logo=left + menu=left ⟹ menu=beside（logo 为准）');
  const h2r = render('logo-left', withOpts({ logo: 'right', menu: 'left' }));
  check(attr(h2r, 'data-logo') === 'right' && attr(h2r, 'data-menu') === 'beside', 'logo=right + menu=left ⟹ logo=right、menu=beside（#1468 验收 6）');
  const h3 = render('menu-center', withOpts({ logo: 'center', menu: 'left', topbar: true }));
  check(attr(h3, 'data-preset') === 'custom' && attr(h3, 'data-topbar') === 'on', 'center/left + topbar 开 跟任何预设都对不上 ⟹ data-preset=custom');
  check(attr(render('no-such-preset', clone(DEMO)), 'data-preset') === 'logo-left', '认不出的形态名落回 logo-left');
  check(attr(render('topbar', withOpts({ logo: 'sideways' })), 'data-logo') === 'left', '值域外的旋钮值落回该预设的值');
  // #1788 —— 存着被删掉的旧值（split / gathered）⟹ 跟 logo 走：logo=center ⟹ 画成 left（跟选 left 一字不差），logo=left ⟹ beside。
  for (const old of ['gathered', 'split']) {
    for (const shape of ['logo-center', 'stacked']) {
      const got = render(shape, withOpts({ logo: 'center', menu: old }));
      const want = render(shape, withOpts({ logo: 'center', menu: 'left' }));
      check(attr(got, 'data-menu') === 'left' && got === want, `${shape} + logo=center + menu=${old} ⟹ 跟选 left 的 HTML 一字不差（data-menu=${attr(got, 'data-menu')}）`);
    }
    check(attr(render('menu-center', withOpts({ menu: old })), 'data-menu') === 'beside', `menu-center（logo=left）+ menu=${old} ⟹ beside`);
  }
  // #1468：topbar 没写 ⟹ 跟形态（= 预设）走；写了布尔就按写的；预设名连它一起判，icons 不参与。
  const t1 = render('topbar', withOpts({ topbar: false }));
  check(attr(t1, 'data-topbar') === 'off' && attr(t1, 'data-preset') === 'logo-left' && !t1.includes('hdr-topbar border-bottom'),
    'topbar 形态 + options.topbar=false ⟹ 没有顶条、预设名 logo-left');
  const t2 = render('logo-left', withOpts({ topbar: true, icons: true }));
  check(attr(t2, 'data-topbar') === 'on' && attr(t2, 'data-preset') === 'topbar' && t2.includes('hdr-topbar border-bottom'),
    'logo-left 形态 + topbar=true（+ icons）⟹ 顶条出现、预设名 topbar（icons 不影响）');
  check(attr(render('logo-left', withOpts({ topbar: 'contact' })), 'data-topbar') === 'off', 'topbar 写成旧的字符串 "contact" 不算开（只认布尔）');
}

// ══ ④ 验收 4 的 HTML 那一半：电话图标 · 抽屉顺序 · 按钮（#1787 起 0–3 颗，抽屉里全出）· 联系信息段 ═══════════════════════════
console.log('\n④ 紧凑条与抽屉');
{
  const phoneHref = DEMO.topbar.contact.find((c) => (c.href || '').startsWith('tel:')).href;
  const labels = DEMO.buttons.map((b) => b.label);
  check(labels.length === 3, `夹具有 3 颗按钮（${labels.join(' · ')}）`);
  const order = (html) => labels.map((l) => html.indexOf(`>${l}<`));
  for (const [n, , , topbar] of TABLE) {
    const closed = render(n, clone(DEMO));
    const compact = closed.slice(closed.indexOf('hdr-compact'), closed.indexOf('hdr-grid'));
    const hasPhone = compact.includes(`href="${phoneHref}"`) && compact.includes('data-icon="telephone"');
    check(hasPhone === (topbar === 'on'), `${n}：紧凑条上${topbar === 'on' ? '有' : '没有'} a[href^=tel:] 电话图标`);
    const open = closed; // 抽屉一直在 HTML 里（#1514）
    const drawer = open.slice(open.indexOf('hdr-drawer'));
    const parts = [...drawer.matchAll(/data-hdr-part="(drawer-[a-z]+)"/g)].map((m) => m[1]);
    const ctaBox = drawer.slice(drawer.indexOf('drawer-cta'), drawer.indexOf('drawer-contact') > 0 ? drawer.indexOf('drawer-contact') : undefined);
    if (topbar === 'on') {
      check(JSON.stringify(parts) === JSON.stringify(['drawer-nav', 'drawer-cta', 'drawer-contact', 'drawer-message', 'drawer-info', 'drawer-links', 'drawer-social']),
        `${n}：抽屉顺序 = 菜单 → 按钮 → 联系信息（公告 → 电话等）→ 链接 → 社交`, parts.join(' → '));
      check(drawer.includes(`href="${phoneHref}"`), `${n}：抽屉里的电话可拨`);
    } else {
      // #1785 —— 没开 topbar 时社交图标也在抽屉最下面一排（演示站有社交链接）；联系信息段照旧没有。
      check(JSON.stringify(parts) === JSON.stringify(['drawer-nav', 'drawer-cta', 'drawer-social']), `${n}：抽屉里没有联系信息段（菜单 + 按钮，最下面一排社交图标）`, parts.join(' → '));
    }
    // #1787 —— 抽屉：3 颗全出（topbar 开时也全出），按老板的顺序竖排、主按钮在最上；每颗的 data-hdr-cta 是它的下标。
    const o = order(ctaBox);
    check(o.every((x) => x >= 0) && o[0] < o[1] && o[1] < o[2], `${n}：抽屉里 3 颗全在、主按钮在最上（位置 ${o.join(' < ')}）`);
    check(JSON.stringify([...ctaBox.matchAll(/data-hdr-cta="(\d+)"/g)].map((m) => m[1])) === '["0","1","2"]', `${n}：抽屉里 data-hdr-cta = 0 · 1 · 2`);
    // 桌面一行：主按钮在最右 ⟹ DOM 里倒着排（第 3 颗最先）；第 3 颗 992–1199 不出（d-none d-xl-inline-block）。
    const grid = closed.slice(closed.indexOf('hdr-grid'), closed.indexOf('data-hdr-part="drawer"'));
    const g = order(grid);
    check(g.every((x) => x >= 0) && g[2] < g[1] && g[1] < g[0], `${n}：桌面那一行从右往左 = 第 1 · 2 · 3 颗（DOM 位置 ${g.join(' / ')}）`);
    const tag = (label) => { const at = grid.indexOf(`>${label}<`); return grid.slice(grid.lastIndexOf('<a', at), at); };
    check(/d-none d-xl-inline-block/.test(tag(labels[2])) && !/d-none/.test(tag(labels[0])) && !/d-none/.test(tag(labels[1])),
      `${n}：只有第 3 颗带 d-none d-xl-inline-block（1200 起才出）`);
    check(/btn-primary/.test(tag(labels[0])) && /btn-outline/.test(tag(labels[1])) && /btn-link/.test(tag(labels[2])), `${n}：样子 = 实心 · 描边 · 文字链接样`);
  }
  // 0 颗：桌面和抽屉里一个按钮都没有，抽屉里也不留那个空格子。
  const none = render('topbar', { ...clone(DEMO), buttons: [] });
  check(!/data-hdr-cta=/.test(none) && !none.includes('drawer-cta'), '0 颗 ⟹ 页面上没有 data-hdr-cta、抽屉里没有 drawer-cta 那一格');
  // 反向对照：抽屉在 topbar 开时只放主按钮（#1787 之前的规则）⟹ 上面「3 颗全在」那一格必须红。
  const s = mutate('            <div className="d-grid gap-2" data-hdr-part="drawer-cta">\n              {ctas.map(',
    '            <div className="d-grid gap-2" data-hdr-part="drawer-cta">\n              {(hasTopbar ? ctas.slice(0, 1) : ctas).map(');
  if (!s) bad('反向对照没改到源码（锚点找不到）');
  else {
    const h = render('topbar', clone(DEMO), loadSection(s));
    const d = h.slice(h.indexOf('drawer-cta'), h.indexOf('drawer-contact'));
    check(!d.includes(`>${labels[1]}<`), '反向对照：topbar 时抽屉只放主按钮 ⟹ 第 2 颗不在（上面那格红得起来）');
    C = loadSection();
  }
}

// ══ ④b #1514：抽屉是 Bootstrap Collapse —— 按钮 data-bs-toggle / data-bs-target 与抽屉 id 对上，不再是 React 状态 ════
console.log('\n④b 抽屉 = Bootstrap Collapse（#1514）');
{
  const h = render('logo-left', clone(DEMO));
  const at = h.indexOf('aria-label="Toggle navigation menu"');
  const btnStart = h.lastIndexOf('<button', at);
  const btn = h.slice(btnStart, h.indexOf('>', at) + 1);
  const inner = h.slice(btnStart, h.indexOf('</button>', btnStart));
  const target = (btn.match(/data-bs-target="#([^"]+)"/) || [])[1];
  const drawerId = (h.match(/<div id="([^"]+)" class="hdr-drawer collapse /) || [])[1];
  check(/data-bs-toggle="collapse"/.test(btn) && !!target, '汉堡按钮：data-bs-toggle="collapse" + data-bs-target');
  check(!!drawerId && target === drawerId && btn.includes(`aria-controls="${drawerId}"`), `data-bs-target / aria-controls 指向抽屉自己的 id（${target} / ${drawerId}）`);
  check(/aria-expanded="false"/.test(btn), '服务端 HTML 里 aria-expanded="false"（之后由 Bootstrap 翻）');
  check(inner.includes('data-icon="list"') && inner.includes('data-icon="x-lg"'), '汉堡里两枚图标都在（露哪枚由 block.css 按 aria-expanded 定）');
  check(!/useState|onClick/.test(ORIGINAL), 'Section.tsx 里没有 useState / onClick（展开 / 收起不再是 React 状态）');
  // 注释里会提到那两个类名（文件头讲为什么不用它们）⟹ 只看 markup：className 里不许出现。
  check(/loadBootstrap\('collapse'\)/.test(ORIGINAL) && !/className=[^\n]*navbar-(collapse|expand)/.test(ORIGINAL), '按模块加载 collapse；markup 不挂 .navbar-collapse / .navbar-expand-*（§文件头复现过的那条 !important）');
  const css = fs.readFileSync(path.join(BLOCK_DIR, 'block.css'), 'utf-8');
  check(/\.hdr-burger\[aria-expanded="true"\] \.hdr-ic-open,\s*[^{]*\.hdr-burger:not\(\[aria-expanded="true"\]\) \.hdr-ic-close\s*\{\s*display: none !important;/.test(css),
    'block.css：开着藏 list、收着藏 x-lg（按 aria-expanded）');
  // 反向对照：把 data-bs-target 的 id 改掉 ⟹ 上面那格「对得上」必须红。
  const s = mutate('data-bs-target={`#${drawerId}`}', 'data-bs-target="#nope"');
  if (!s) bad('反向对照没改到源码（锚点找不到）');
  else {
    const h2 = render('logo-left', clone(DEMO), loadSection(s));
    const t2 = (h2.match(/data-bs-target="#([^"]+)"/) || [])[1];
    check(t2 === 'nope' && t2 !== drawerId, '反向对照：改掉 data-bs-target ⟹ 对不上（上面那格红得起来）');
    C = loadSection();
  }
}

// ══ ⑤ 验收 4 / 10：勾 icons ⟹ 菜单项旁是 <svg>，不是字体图标 ═══════════════════════════════════
console.log('\n⑤ 图标是内联 SVG');
{
  const withIcons = render('logo-left', withOpts({ icons: true }));
  const navIcons = DEMO.nav.map((it) => it.icon).filter((n) => withIcons.includes(`data-icon="${n}"`));
  check(navIcons.length === DEMO.nav.length, `勾 icons：${DEMO.nav.length} 个菜单项各有一个 <svg data-icon>（${navIcons.length}）`);
  check(/<svg[^>]*data-icon="house-door"/.test(withIcons), '图标是 <svg> 元素');
  const off = render('logo-left', clone(DEMO));
  check(!DEMO.nav.some((it) => off.includes(`data-icon="${it.icon}"`)), '不勾 icons：菜单项旁没有图标');
  const all = NAMES.map((n) => render(n, withOpts({ icons: true }))).join('');
  check(!/class="[^"]*\bbi\b/.test(all) && !/\bbi-[a-z]/.test(all), '6 个预设（勾 icons）的 HTML 里没有一个 `bi` / `bi-*` 类');
  // 名字查不到 ⟹ 不画，而且 `show: icon` 那一项退回有字（不能变成看不见的链接）。
  const ghost = withOpts({ icons: true }); ghost.nav = [{ label: 'Ghost', href: '/g', icon: 'no-such-icon-xyz', show: 'icon' }];
  const g = render('logo-left', ghost);
  check(!g.includes('data-icon="no-such-icon-xyz"') && !/visually-hidden">Ghost/.test(g), '查不到的图标名不画，且那一项的字不被藏起来');
}

// ══ ⑥ #1468：logo=right（原 reverse）只改根上的类和顶条那两个钩子，markup 别处不动 ══════════════════
console.log('\n⑥ logo=right');
{
  const l = render('topbar', clone(DEMO));
  const r = render('topbar', withOpts({ logo: 'right' }));
  check(attr(r, 'data-logo') === 'right' && attr(r, 'data-menu') === 'beside' && (attr(r, 'class') || '').includes('hdr-logo-right'), 'logo=right ⟹ 根上 hdr-logo-right、menu 仍是 beside');
  check((r.match(/\bhdr-flip\b/g) || []).length === 2 && !/\bhdr-flip\b/.test(l), '顶条那两行挂 hdr-flip（logo=left 时没有）');
  const body = (h) => h.replace(/<header[^>]*>/, '').replace(/hdr-flip/g, '');
  check(body(l) === body(r), '除根元素和 hdr-flip 之外，logo=right 与 logo=left 的 markup 逐字相同（换位全在 block.css）');
  check(!/\breverse\b/.test(ORIGINAL), 'Section.tsx 里没有 reverse 这个词');
  // 反向对照：换位钩子不挂 ⟹ 上面「顶条那两行挂 hdr-flip」那格会红。
  const s2 = mutate("gap-5 ${right ? 'hdr-flip' : ''}", 'gap-5 ');
  if (!s2) bad('反向对照没改到源码（锚点找不到）');
  else {
    const rr = render('topbar', withOpts({ logo: 'right' }), loadSection(s2));
    check((rr.match(/\bhdr-flip\b/g) || []).length === 1, '反向对照：拿掉一处 hdr-flip ⟹ 只剩 1 个（上面那格红得起来）');
    C = loadSection();
  }
}

// ══ ⑦ #1528：topbar 的一句话公告 —— 带 topbar 的两个预设画（顶条 + 抽屉），别的预设不画也不留壳；不写它 = 改前 ══════
console.log('\n⑦ 一句话公告（topbar.message）');
{
  const MSG = 'Spring tire swap special';
  const noMsg = () => { const d = clone(DEMO); delete d.topbar.message; return d; };
  const withMsg = (m) => { const d = noMsg(); d.topbar.message = m; return d; };
  // 公告自己的那两段（顶条 / 抽屉）从 HTML 里抠掉之后，剩下的必须跟「没写公告」那一份逐字相同 —— 它只加自己，不动别处。
  const strip = (h) => h.replace(/<span data-hdr-part="(?:bar|drawer)-message">[\s\S]*?<\/span>/g, '');
  for (const [n, , , topbar] of TABLE) {
    const without = render(n, noMsg());
    const plain = render(n, withMsg({ text: MSG }));
    if (topbar === 'on') {
      check((plain.match(/data-hdr-part="bar-message"/g) || []).length === 1 && (plain.match(/data-hdr-part="drawer-message"/g) || []).length === 1,
        `${n}：顶条里一句、抽屉里一句`);
      check(strip(plain) === without, `${n}：抠掉公告那两段 == 没写公告的那一份（别处一个字节不动）`);
    } else {
      check(plain === without, `${n}（不带 topbar）：写了公告也逐字等于没写 —— 不画、不留空壳`);
    }
  }
  const bar = (h) => { const m = h.match(/<span data-hdr-part="bar-message">([\s\S]*?)<\/span>/); return m ? m[1] : null; };
  const txt = bar(render('topbar', withMsg({ text: MSG })));
  check(txt === MSG, `只有 text ⟹ 纯文字（读到 ${txt}）`);
  const whole = bar(render('topbar', withMsg({ text: MSG, href: '/tires' })));
  check(whole === `<a class="link-secondary" href="/tires">${MSG}</a>`, `text + href ⟹ 整句是链接（读到 ${whole}）`);
  const labeled = bar(render('topbar', withMsg({ text: MSG, href: '/tires', label: 'Book now' })));
  check(labeled === `${MSG} <a class="link-secondary fw-semibold text-nowrap" href="/tires">Book now</a>`, `text + href + label ⟹ 句子后面跟链接（读到 ${labeled}）`);
  const orphan = bar(render('topbar', withMsg({ text: MSG, label: 'Book now' })));
  check(orphan === MSG, `有 label 没 href ⟹ 纯文字，label 不画（读到 ${orphan}）`);
  for (const [name, m] of [['空串', { text: '' }], ['只有空白', { text: '   ' }], ['text 不是字符串', { text: 42 }], ['整格是字符串', 'hi'], ['null', null]]) {
    check(render('topbar', withMsg(m)) === render('topbar', noMsg()), `${name} ⟹ 当没写（逐字等于没写那一份）`);
  }
  // 深底：链接跟顶条其他链接一样翻 link-light。
  const deepBar = bar(render('topbar', { ...withMsg({ text: MSG, href: '/tires' }), bg: '#0f172a' }));
  check(deepBar && deepBar.includes('link-light'), `深底上公告链接是 link-light（读到 ${deepBar}）`);
  // 反向对照 ①：没写公告时也留一个空壳 span ⟹「不带 topbar 也逐字等于」「当没写」那几格读得出差别。
  const s1 = mutate("  ) : null);\n\n  // 抽屉里的联系信息段", "  ) : <span data-hdr-part={key} />);\n\n  // 抽屉里的联系信息段");
  if (!s1) bad('反向对照没改到源码（锚点找不到）');
  else {
    const M = loadSection(s1);
    check(render('topbar', noMsg(), M) !== render('topbar', noMsg()), '反向对照①：没写公告也留空壳 ⟹ 跟「没写」那一份不再相等（上面那几格红得起来）');
  }
  // 反向对照 ②：drawer 那段的门不看 message ⟹ 只有公告、没有别的联系项时抽屉里就没有它。
  const s2 = mutate('hasTopbar && (message || contact.length', 'hasTopbar && (contact.length');
  if (!s2) bad('反向对照没改到源码（锚点找不到）');
  else {
    // #1785 —— 社交图标住在顶层 `social`（演示数据从那儿来）⟹ 构造「只有公告」要连它一起清空。
    const only = withMsg({ text: MSG }); only.topbar.contact = []; only.topbar.links = []; only.topbar.social = []; only.social = [];
    check(render('topbar', only).includes('data-hdr-part="drawer-message"'), '只有公告时抽屉里照样有它');
    check(!render('topbar', only, loadSection(s2)).includes('data-hdr-part="drawer-message"'), '反向对照②：抽屉的门不看 message ⟹ 那一格读得出差别');
  }
  C = loadSection();
}

// ══ ⑧ #1786：Sticky —— 开 ⟹ 根上 hdr-sticky + data-sticky=on；关 / 没写 ⟹ 都没有；编辑器画布（editorCanvas）勾上也不吸 ══════
console.log('\n⑧ sticky');
{
  const renderE = (shape, data, editorCanvas, Comp = C) => renderToStaticMarkup(React.createElement(Comp, { shape, data, iconTable: ICONS, editorCanvas }));
  const cls = (h) => (attr(h, 'class') || '').split(/\s+/);
  for (const n of ['logo-left', 'topbar']) {
    const on = render(n, withOpts({ sticky: true }));
    const off = render(n, withOpts({ sticky: false }));
    const none = render(n, clone(DEMO));
    check(attr(on, 'data-sticky') === 'on' && cls(on).includes('hdr-sticky'), `${n} 勾 sticky ⟹ data-sticky=on、根上 hdr-sticky`);
    // 服务端 HTML 是「还没滚」那一刻：细线在、阴影类不在（阴影要滚过 40px，浏览器里翻）。
    check(cls(on).includes('border-bottom') && !cls(on).includes('hdr-scrolled'), `${n} 勾 sticky、没滚 ⟹ 细线在、没有 hdr-scrolled`);
    check(attr(off, 'data-sticky') === 'off' && !cls(off).includes('hdr-sticky'), `${n} sticky=false ⟹ data-sticky=off、没有 hdr-sticky`);
    check(off === none, `${n}：sticky=false 与没写 sticky 逐字相同（默认关）`);
    const strip = (h) => h.replace(/<header[^>]*>/, '');
    check(strip(on) === strip(off), `${n}：开 / 关只差根元素那一行，里面的 markup 逐字相同`);
    const ed = renderE(n, withOpts({ sticky: true }), true);
    check(attr(ed, 'data-sticky') === 'off' && !cls(ed).includes('hdr-sticky'), `${n} 编辑器画布里勾 sticky ⟹ 不吸（data-sticky=off、没有 hdr-sticky）`);
    check(ed === off, `${n} 编辑器画布里勾 sticky 逐字等于不勾`);
  }
  // CSS：吸住那条规则挂在 hdr-sticky 上（类名在 Section 源码里是字面量 ⟹ site.css 的 purge 留得住）。
  const css = fs.readFileSync(path.join(BLOCK_DIR, 'block.css'), 'utf-8');
  check(/\[data-block="header"\]\.hdr-sticky\s*\{[^}]*position:\s*sticky/.test(css), 'block.css：[data-block="header"].hdr-sticky { position: sticky }');
  check(/\[data-block="header"\]\.hdr-sticky\.hdr-scrolled\s*\{[^}]*box-shadow:\s*0 4px 18px rgba\(15, 23, 42, \.10\)/.test(css), 'block.css：hdr-scrolled 的阴影是正文那一道');
  check(ORIGINAL.includes("'hdr-sticky'") && ORIGINAL.includes("'hdr-scrolled'"), 'Section.tsx 里 hdr-sticky / hdr-scrolled 是字面量（purge 认得出）');
  // 反向对照 ①：判据不看 editorCanvas ⟹ 「编辑器画布里不吸」那格会红。
  const s1 = mutate('opts.sticky === true && !editorCanvas', 'opts.sticky === true');
  if (!s1) bad('反向对照没改到源码（锚点找不到）');
  else check(attr(renderE('logo-left', withOpts({ sticky: true }), true, loadSection(s1)), 'data-sticky') === 'on', '反向对照①：判据不看 editorCanvas ⟹ 画布里也吸（上面那格红得起来）');
  // 反向对照 ②：sticky 不读 options ⟹ 「勾上 ⟹ 吸」那格会红。
  const s2 = mutate('opts.sticky === true && !editorCanvas', 'false');
  if (!s2) bad('反向对照没改到源码（锚点找不到）');
  else check(attr(render('logo-left', withOpts({ sticky: true }), loadSection(s2)), 'data-sticky') === 'off', '反向对照②：不读 options.sticky ⟹ 勾上也不吸（上面那格红得起来）');
  C = loadSection();
}

// ══ ⑨ #1784：logoType（text | image）× logoSize（r7：图高 px，24–80）—— 图和店名二选一、图高连续可调 ══════════════════
console.log('\n⑨ #1784 logoType × logoSize');
{
  const BRAND = DEMO.brandName;
  // 顶栏上每一个 logo 位置（紧凑条一个 + 桌面那格一个）：`<a class="hdr-brand …" … data-logo-type data-logo-size>…</a>`。
  const brands = (h) => [...h.matchAll(/<a class="hdr-brand[^"]*"[^>]*>([\s\S]*?)<\/a>/g)].map((m) => {
    const open = m[0].slice(0, m[0].indexOf('>') + 1);
    const a = (n) => { const x = open.match(new RegExp(`\\s${n}="([^"]*)"`)); return x ? x[1] : null; };
    const st = a('style') || '';
    const h = st.match(/--hdr-logo-h:\s*(\d+)px/);
    return { type: a('data-logo-type'), size: a('data-logo-size'), h: h ? Number(h[1]) : null, inner: m[1] };
  });
  const imgs = (inner) => (inner.match(/<img\b[^>]*>/g) || []);
  const shown = (inner) => inner.replace(/<img\b[^>]*>/g, '').replace(/<[^>]+>/g, '');   // 页面上看得见的字
  // r7：滑杆两端 + 默认（验收 6「四档的用例换成滑杆两端 + 默认值」）。
  const SIZES = [24, 40, 80];
  check(!!DEMO.logo, `夹具有 logo 图（${DEMO.logo}）`);
  for (const preset of ['logo-left', 'logo-center', 'stacked']) {
    for (const type of ['image', 'text']) {
      for (const size of SIZES) {
        const b = brands(render(preset, withOpts({ logoType: type, logoSize: size })));
        const good = b.length === 2 && b.every((x) => x.type === type && x.size === String(size) && x.h === size && (type === 'image'
          ? imgs(x.inner).length === 1 && imgs(x.inner)[0].includes(`alt="${BRAND}"`) && shown(x.inner) === ''
          : imgs(x.inner).length === 0 && shown(x.inner) === BRAND));
        check(good, `${preset} · ${type} · ${size}px：--hdr-logo-h = ${size}px、两个 logo 位置都只有${type === 'image' ? `一张图（alt=店名）、看得见的字 0` : '店名、<img> 0 个'}`, JSON.stringify(b));
      }
    }
  }
  // 默认：没存 logoType ⟹ 看 data.logoHasWordmark（构建从 brand.logoHasWordmark 派生）：真 image、假或没有 text —— 不看有没有图。
  //   没存 logoSize ⟹ 40。存了 image 却没有图 ⟹ 照 text 画。
  const noLogo = (o) => { const d = withOpts(o); delete d.logo; return d; };
  const wm = (o, v) => ({ ...withOpts(o), logoHasWordmark: v });
  const def = brands(render('logo-left', wm({}, true)));
  check(def.every((x) => x.type === 'image' && x.h === 40 && imgs(x.inner).length === 1 && shown(x.inner) === ''),
    '验收 1：没存旋钮 + 图里自带店名（logoHasWordmark）⟹ image · 40px，看得见的字 0', JSON.stringify(def));
  const icon = brands(render('logo-left', wm({}, false)));
  check(icon.every((x) => x.type === 'text' && imgs(x.inner).length === 0 && shown(x.inner) === BRAND),
    '验收 0：有图但 logoHasWordmark=false（AI 图标 logo）⟹ text，店名在、<img> 0 个', JSON.stringify(icon));
  const unset = brands(render('logo-left', withOpts({})));
  check(unset.every((x) => x.type === 'text' && imgs(x.inner).length === 0), '有图、没有 logoHasWordmark 这一格 ⟹ text（不看有没有图）', JSON.stringify(unset));
  const flipped = brands(render('logo-left', wm({ logoType: 'text' }, true)));
  check(flipped.every((x) => x.type === 'text' && imgs(x.inner).length === 0), '验收 1：自带店名的站切 text ⟹ 只有店名、<img> 0 个', JSON.stringify(flipped));
  const defText = brands(render('logo-left', noLogo({})));
  check(defText.every((x) => x.type === 'text' && imgs(x.inner).length === 0), '没存旋钮 + 没图 ⟹ text', JSON.stringify(defText));
  const cleared = brands(render('logo-left', noLogo({ logoType: 'image', logoSize: 80 })));
  check(cleared.every((x) => x.type === 'text' && shown(x.inner) === BRAND), 'r7 验收 5：存着 image 但没有图 ⟹ 出店名', JSON.stringify(cleared));
  // 写坏的值当没写：r6 存下的四档字符串、范围外、不在步上、字符串数字 —— 一律回默认 40。
  for (const bad of ['huge', 'xl', 'm', 20, 84, 42, '52']) {
    const junk = brands(render('logo-left', wm({ logoType: 'both', logoSize: bad }, true)));
    check(junk.every((x) => x.type === 'image' && x.h === 40), `写坏的值当没写（logoSize=${JSON.stringify(bad)} ⟹ 40px；logoType=both + 自带店名 ⟹ image）`, JSON.stringify(junk));
  }
  // 反向对照：默认改回「有图就 image」（r1 的判据）⟹ 上面「验收 0」那一格会红。
  const s0 = mutate('hasWordmark: data.logoHasWordmark === true', 'hasWordmark: !!data.logo');
  if (!s0) bad('反向对照没改到源码（锚点找不到）');
  else {
    const b = brands(render('logo-left', wm({}, false), loadSection(s0)));
    check(b.some((x) => x.type === 'image'), '反向对照：默认改看「有没有图」⟹ AI 图标 logo 的站变成 image（验收 0 那格红得起来）', JSON.stringify(b));
  }
  // 旋钮不碰布局：拧 logoType / logoSize 前后，根上的预设 / 三个派生类一个字不变（它们不进预设）。
  const plainRoot = attr(render('topbar', clone(DEMO)), 'class');
  const knobRoot = attr(render('topbar', withOpts({ logoType: 'text', logoSize: 80 })), 'class');
  check(plainRoot === knobRoot && attr(render('topbar', withOpts({ logoType: 'text', logoSize: 80 })), 'data-preset') === 'topbar',
    '拧了 logoType / logoSize 仍认得出是 topbar 预设、根上的类不变');
  // 几何在 block.css：图高读 Section 写的 `--hdr-logo-h`；店名一律 1.25rem（r7：text 没有大小控件）；992 以下图高封顶 44px。
  const css = fs.readFileSync(path.join(BLOCK_DIR, 'block.css'), 'utf-8');
  check(/\.hdr-brand \.hdr-logo-img \{ height: var\(--hdr-logo-h, 40px\);/.test(css), 'block.css：图高 = var(--hdr-logo-h, 40px)');
  check(/\.hdr-brand \.hdr-logo-text \{ font-size: 1\.25rem; \}/.test(css), 'block.css：店名 1.25rem（r7 起只有这一档）');
  check(!/data-logo-size="/.test(css), 'block.css：s / m / l / xl 四档的规则已删（r7）');
  const mq = css.slice(css.lastIndexOf('@media (max-width: 991.98px)'));
  check(/height:\s*min\(var\(--hdr-logo-h, 40px\), 44px\)/.test(mq), 'block.css：992 以下图高封顶 44px');
  // 反向对照：Section 不把图高写进 --hdr-logo-h ⟹ 上面「--hdr-logo-h = Npx」那几格会红。
  const s3 = mutate("style={{ ['--hdr-logo-h' as string]: `${brandLogo.size}px` }}", '');
  if (!s3) bad('反向对照没改到源码（锚点找不到）');
  else {
    const b = brands(render('logo-left', withOpts({ logoType: 'image', logoSize: 80 }), loadSection(s3)));
    check(b.every((x) => x.h !== 80), '反向对照：不写 --hdr-logo-h ⟹ 80px 那几格会红', JSON.stringify(b));
  }
  // 反向对照：只出图时 alt 退回空串（改前的写法）⟹ 上面 image 那几格读得出差别。
  const s1 = mutate('alt={brand} className="hdr-logo-img', 'alt="" className="hdr-logo-img');
  if (!s1) bad('反向对照没改到源码（锚点找不到）');
  else {
    const b = brands(render('logo-left', withOpts({ logoType: 'image' }), loadSection(s1)));
    check(!b.every((x) => imgs(x.inner)[0] && imgs(x.inner)[0].includes(`alt="${BRAND}"`)), '反向对照：alt 写空 ⟹「alt=店名」那几格会红');
  }
  // 反向对照：图和店名一起出（改前的画法）⟹「看得见的字 0」那几格读得出差别。
  const s2 = mutate("        : <span className={`hdr-logo-text", "        : null}{brandLogo.type === 'image' && <span className={`hdr-logo-text");
  if (!s2) bad('反向对照没改到源码（锚点找不到）');
  else {
    const b = brands(render('logo-left', withOpts({ logoType: 'image' }), loadSection(s2)));
    check(b.some((x) => shown(x.inner) === BRAND), '反向对照：图和店名一起出 ⟹ image 那几格会红', JSON.stringify(b));
  }
  C = loadSection();
}

console.log(`\n${fail ? '🔴' : '✅'} header-render: ${pass} 过 / ${fail} 不过`);
process.exit(fail ? 1 : 0);
