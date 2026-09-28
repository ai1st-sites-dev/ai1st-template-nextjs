#!/usr/bin/env node
/**
 * header-new-render.test.js — #1462（header 定稿第 2 版）验收 1 / 2 / 3 / 4 / 10 里「只看渲染出来的 HTML
 * 就能判」的那几条；#1468 起旋钮是 logo（left | center | right）· menu（beside | …），topbar 是布尔开关。
 *
 * 跑法:  node scripts/header-new-render.test.js   （或 `npm run test:scripts`，它按文件名发现）
 * 退出码: 0 全过 · 1 有失败 · 2 跑不起来（**不许当成通过**）
 *
 * 做法照 `footer-new-render.test.js`：`ts.transpileModule` + `renderToStaticMarkup`，源码可以在内存里替换
 * （反向对照用）。抽屉是 `useState(false)` 关着的 ⟹ 量抽屉那几条时把初值换成 true 再渲染。
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
const BLOCK_DIR = path.join(NEXT, 'blocks', 'header-new');
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
  DEMO = require(path.join(NEXT, 'scripts', 'lib', 'demo-content')).DEMO_CONTENT['header-new'];
  MANIFEST = JSON.parse(fs.readFileSync(path.join(BLOCK_DIR, 'manifest.json'), 'utf-8'));
  ICONS = require(path.join(NEXT, 'scripts', 'lib', 'icons.js')).iconTableFor('header-new', DEMO);
} catch (e) { die(`载入失败: ${e.message}`); }
if (!DEMO) die('demo-content 里没有 header-new 那一份');

const clone = (v) => JSON.parse(JSON.stringify(v));
const withOpts = (o) => ({ ...clone(DEMO), options: { ...DEMO.options, ...o } });
const render = (shape, data, Comp = C) => renderToStaticMarkup(React.createElement(Comp, { shape, data, iconTable: ICONS }));
const attr = (html, name) => { const m = html.match(new RegExp(`<header[^>]*\\s${name}="([^"]*)"`)); return m ? m[1] : null; };
const OpenC = (() => { const s = mutate('useState(false)', 'useState(true)'); return s ? loadSection(s) : null; })();
C = loadSection();
if (!OpenC) die('抽屉初值的锚点 `useState(false)` 找不到 —— 抽屉那几格量不了');

// 定稿表（#1462 票正文「七个预设」那张；#1468 起 menu 的 right 叫 beside、topbar 是布尔 —— 这里写成根上读到的 on / off）。
const TABLE = [
  ['logo-left', 'left', 'beside', 'off'],
  ['menu-center', 'left', 'center', 'off'],
  ['logo-center-split', 'center', 'split', 'off'],
  ['logo-center-gathered', 'center', 'gathered', 'off'],
  ['topbar', 'left', 'beside', 'on'],
  ['stacked', 'center', 'below', 'off'],
  ['topbar-stacked', 'center', 'below', 'on'],
];
const NAMES = TABLE.map((r) => r[0]);

// ══ ① 验收 1：目录集合 == 7 个预设名；manifest presets 与定稿表逐字相同；没有「形态名 → 布局」表 ════
console.log('① 目录集合 · manifest presets · 形态表退役');
{
  const dirs = fs.readdirSync(BLOCK_DIR, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name).sort();
  const want = [...NAMES].sort();
  check(JSON.stringify(dirs) === JSON.stringify(want), `blocks/header-new/ 的目录集合 == 7 个预设名`, `读到 ${dirs.join(' · ')}`);
  check(!dirs.includes('stacked-topbar') && !dirs.includes('stacked-centered'), '旧名 stacked-topbar / stacked-centered 不在');
  // 形状：顶层 presets = [{ name, shape, knobs, options }]，旋钮声明在 slots.options.knobs（#1468 起 topbar 在 options）。
  const got = (MANIFEST.presets || []).map((p) => [p.name, p.knobs && p.knobs.logo, p.knobs && p.knobs.menu, p.options && (p.options.topbar ? 'on' : 'off')]);
  check(JSON.stringify(got) === JSON.stringify(TABLE), 'manifest.presets 7 条与定稿表逐字相同（含顺序）', JSON.stringify(got));
  check((MANIFEST.presets || []).every((p) => Object.keys(p).sort().join() === 'knobs,name,options,shape' && p.shape === p.name
    && Object.keys(p.knobs).sort().join() === 'logo,menu' && typeof p.options.topbar === 'boolean'), '每条预设是 { name, shape, knobs:{logo,menu}, options:{topbar} }，shape = 目录名 = name');
  const knobDecl = ((MANIFEST.slots.options || {}).knobs || []).map((k) => `${k.name}:${k.values.join('|')}`);
  check(JSON.stringify(knobDecl) === JSON.stringify(['logo:left|center|right', 'menu:beside|center|split|gathered|below']),
    'slots.options.knobs 声明两个旋钮（#1468 值域）、顺序 = 控件顺序', JSON.stringify(knobDecl));
  // 行为判据（PM r2 裁定 ②）：Section 不导出、也不声明一张「形态名 → 布局」的表 —— 去掉注释之后没有 SHAPES。
  const code = ORIGINAL.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
  check(!/\bSHAPES\b/.test(code), 'Section.tsx 的代码里（去掉注释）没有 SHAPES');
  check(!NAMES.some((n) => code.includes(`'${n}'`) && n !== 'logo-left'), 'Section.tsx 的代码里除默认 logo-left 外没有写死任何预设名（布局只由旋钮派生）');
}

// ══ ② 验收 2：7 个预设 HTML 两两不同；每个预设的旋钮值 + topbar 与表一致 ══════════════════════════════
console.log('\n② 7 个预设两两不同 · 旋钮读数');
{
  const htmls = NAMES.map((n) => render(n, clone(DEMO)));
  check(new Set(htmls).size === 7, `同一份夹具下 7 个预设的 HTML 两两不同（${new Set(htmls).size} 种）`);
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
    const h = render('logo-center-split', clone(DEMO), Cb);
    check(!(attr(h, 'class') || '').includes('hdr-menu-split'), '反向对照：拿掉 hdr-menu-* ⟹ 上面「根上的三个派生类」那格会红');
    C = loadSection();
  }
}

// ══ ③ 验收 3：Section 自己纠正 logo=center + menu=beside ⟹ menu=split ══════════════════════════
console.log('\n③ 旋钮纠正 · topbar 开关（Section 那一次）');
{
  const h = render('logo-left', withOpts({ logo: 'center', menu: 'beside' }));
  check(attr(h, 'data-menu') === 'split' && attr(h, 'data-logo') === 'center', 'logo=center + menu=beside ⟹ 落地 logo=center、menu=split', `读到 ${attr(h, 'data-logo')}/${attr(h, 'data-menu')}`);
  const h2 = render('logo-left', withOpts({ logo: 'left', menu: 'gathered' }));
  check(attr(h2, 'data-menu') === 'beside', 'logo=left + menu=gathered ⟹ menu=beside（logo 为准）');
  const h2r = render('logo-left', withOpts({ logo: 'right', menu: 'split' }));
  check(attr(h2r, 'data-logo') === 'right' && attr(h2r, 'data-menu') === 'beside', 'logo=right + menu=split ⟹ logo=right、menu=beside（#1468 验收 6）');
  const h3 = render('menu-center', withOpts({ logo: 'center', menu: 'split', topbar: true }));
  check(attr(h3, 'data-preset') === 'custom' && attr(h3, 'data-topbar') === 'on', 'center/split + topbar 开 跟任何预设都对不上 ⟹ data-preset=custom');
  check(attr(render('no-such-preset', clone(DEMO)), 'data-preset') === 'logo-left', '认不出的形态名落回 logo-left');
  check(attr(render('topbar', withOpts({ logo: 'sideways' })), 'data-logo') === 'left', '值域外的旋钮值落回该预设的值');
  // #1468：topbar 没写 ⟹ 跟形态（= 预设）走；写了布尔就按写的；预设名连它一起判，dark / icons 不参与。
  const t1 = render('topbar', withOpts({ topbar: false }));
  check(attr(t1, 'data-topbar') === 'off' && attr(t1, 'data-preset') === 'logo-left' && !t1.includes('hdr-topbar border-bottom'),
    'topbar 形态 + options.topbar=false ⟹ 没有顶条、预设名 logo-left');
  const t2 = render('logo-left', withOpts({ topbar: true, dark: true }));
  check(attr(t2, 'data-topbar') === 'on' && attr(t2, 'data-preset') === 'topbar' && t2.includes('hdr-topbar border-bottom'),
    'logo-left 形态 + topbar=true（+ dark）⟹ 顶条出现、预设名 topbar（dark 不影响）');
  check(attr(render('logo-left', withOpts({ topbar: 'contact' })), 'data-topbar') === 'off', 'topbar 写成旧的字符串 "contact" 不算开（只认布尔）');
}

// ══ ④ 验收 4 的 HTML 那一半：电话图标 · 抽屉顺序 · 副 CTA · 联系信息段 ═══════════════════════════
console.log('\n④ 紧凑条与抽屉');
{
  const phoneHref = DEMO.topbar.contact.find((c) => (c.href || '').startsWith('tel:')).href;
  const second = DEMO.ctaSecondary.label;
  const first = DEMO.ctaPrimary.label;
  for (const [n, , , topbar] of TABLE) {
    const closed = render(n, clone(DEMO));
    const compact = closed.slice(closed.indexOf('hdr-compact'), closed.indexOf('hdr-grid'));
    const hasPhone = compact.includes(`href="${phoneHref}"`) && compact.includes('data-icon="telephone"');
    check(hasPhone === (topbar === 'on'), `${n}：紧凑条上${topbar === 'on' ? '有' : '没有'} a[href^=tel:] 电话图标`);
    const open = render(n, clone(DEMO), OpenC);
    const drawer = open.slice(open.indexOf('hdr-drawer'));
    const parts = [...drawer.matchAll(/data-hdr-part="(drawer-[a-z]+)"/g)].map((m) => m[1]);
    const ctaBox = drawer.slice(drawer.indexOf('drawer-cta'), drawer.indexOf('drawer-contact') > 0 ? drawer.indexOf('drawer-contact') : undefined);
    if (topbar === 'on') {
      check(JSON.stringify(parts) === JSON.stringify(['drawer-nav', 'drawer-cta', 'drawer-contact', 'drawer-info', 'drawer-links', 'drawer-social']),
        `${n}：抽屉顺序 = 菜单 → 主 CTA → 联系信息 → 链接 → 社交`, parts.join(' → '));
      check(ctaBox.includes(first) && !ctaBox.includes(second), `${n}：抽屉里只有主 CTA，没有副 CTA`);
      check(drawer.includes(`href="${phoneHref}"`), `${n}：抽屉里的电话可拨`);
    } else {
      check(JSON.stringify(parts) === JSON.stringify(['drawer-nav', 'drawer-cta']), `${n}：抽屉里没有联系信息段（只有菜单 + CTA）`, parts.join(' → '));
      check(ctaBox.includes(first) && ctaBox.includes(second), `${n}：抽屉里两个 CTA 都在`);
    }
  }
  // 反向对照：副 CTA 不看 topbar ⟹ topbar 那一格「只有主 CTA」必须红。
  const s = mutate('(hasTopbar ? ctas.filter((c) => c === data.ctaPrimary) : ctas)', 'ctas');
  const so = s && s.replace('useState(false)', 'useState(true)');
  if (!so) bad('反向对照没改到源码（锚点找不到）');
  else {
    const h = render('topbar', clone(DEMO), loadSection(so));
    const d = h.slice(h.indexOf('drawer-cta'), h.indexOf('drawer-contact'));
    check(d.includes(second), '反向对照：副 CTA 不看 topbar ⟹ topbar 的抽屉里冒出副 CTA（上面那格红得起来）');
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
  check(!/class="[^"]*\bbi\b/.test(all) && !/\bbi-[a-z]/.test(all), '7 个预设（勾 icons）的 HTML 里没有一个 `bi` / `bi-*` 类');
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

console.log(`\n${fail ? '🔴' : '✅'} header-new-render: ${pass} 过 / ${fail} 不过`);
process.exit(fail ? 1 : 0);
