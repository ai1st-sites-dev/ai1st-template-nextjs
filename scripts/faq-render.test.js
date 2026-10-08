#!/usr/bin/env node
/**
 * faq-render.test.js — #1484 验收里「看渲染出来的 HTML / 调一次校验器就能判」的那几条。
 *
 * 跑法:  node scripts/faq-render.test.js   （或 `npm run test:scripts`，它按文件名发现）
 * 退出码: 0 全过 · 1 有失败 · 2 跑不起来（**不许当成通过**）
 *
 * 管哪几条：AC1（4 个预设逐字、旋钮名 / 值逐字、parts、目录集合、两两不同、旋钮独立）· AC3（答案在静态 HTML 里、
 * 没有默认展开、open 模式没有 details、组件不是 client 组件）· AC4 的 DOM 与规则一半（开合图标画哪几个、转 180° / 换 minus 的规则）·
 * AC5 / AC6 的规则一半（1 列限 48rem、三种 itemStyle）· AC7 的 DOM 一半（help 有无、在块头那一列里）·
 * AC8（bg 四档 + 不自己算亮度 / 拼渐变）· AC9（validateSite）· AC10（block-roles · 首页配方池）·
 * AC12 的编辑器 schema 一半。
 * 几何（16 种组合三端无横向滚动、真点开合、限宽与居中、help 卡位置、计算色）要浏览器：
 * `tests/e2e/specs/1484-faq-new-knobs.spec.ts`。
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
// #1533 —— 各块共有的深底反白（标题 · eyebrow · 主按钮 / 描边 / link）收进了全站一份（site-css.js §DEEP_COMMON，按块点名），
//    块的 block.css 里不再有；这里断言本块在那张登记表里、值没变。
const DEEP = require(path.join(NEXT, 'scripts', 'lib', 'site-css.js')).DEEP_COMMON_CSS;
const SRC = path.join(NEXT, 'src');
const BLOCK = path.join(NEXT, 'blocks', 'faq');
const SECTION = path.join(BLOCK, 'Section.tsx');

let pass = 0;
let fail = 0;
const ok = (m) => { pass += 1; console.log(`  ✅ ${m}`); };
const bad = (m) => { fail += 1; console.log(`  ❌ ${m}`); };
const die = (m) => { console.error(`🔴 跑不起来: ${m}`); process.exit(2); };
const check = (cond, m, detail) => (cond ? ok(m) : bad(detail ? `${m} —— ${detail}` : m));

// ── 让 node 能 require 这份 .tsx；Next 自己的换成替身（同 milestones-render.test.js）──────────────────
const STUB_DIR = path.join(NEXT, 'scripts', '.faq-stubs');
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

let C; let DEMO; let manifestLib; let M; let icons;
try {
  C = require(SECTION).default;
  const demo = require(path.join(NEXT, 'scripts', 'lib', 'demo-content'));
  DEMO = demo.DEMO_CONTENT['faq'];
  manifestLib = require(path.join(NEXT, 'scripts', 'lib', 'block-manifest.js'));
  M = manifestLib.loadManifests().get('faq');
  icons = require(path.join(NEXT, 'scripts', 'lib', 'icons.js'));
} catch (e) { die(`载入失败: ${e.message}`); }
if (!DEMO) die('demo-content 里没有 faq');
if (!M) die('blocks/ 里没有 faq');

const clone = (v) => JSON.parse(JSON.stringify(v));
const TABLE = icons.iconTableFor('faq', DEMO, { warn: () => {} });
const render = (shape, data, iconTable = TABLE) => renderToStaticMarkup(React.createElement(C, {
  data, locale: 'en', iconTable, block: { id: 'f', type: 'faq', shape, data: {} },
}));
const withOpts = (o, extra = {}, base = DEMO) => ({ ...clone(base), ...extra, options: { ...(base.options || {}), ...o } });
const count = (html, needle) => html.split(needle).length - 1;
const own = (r) => r.problems.filter((p) => p.includes('("faq")'));
const sectionTag = (html) => (/<section[^>]*>/.exec(html) || [''])[0];
const attr = (html, name) => { const m = new RegExp(`\\s${name}="([^"]*)"`).exec(sectionTag(html)); return m ? m[1] : null; };
const itemsOf = (html) => html.split('data-part="item"').slice(1);
const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#x27;');
const CSS = fs.readFileSync(path.join(BLOCK, 'block.css'), 'utf-8');
const SRC_TEXT = fs.readFileSync(SECTION, 'utf-8');
const KNOB_NAMES = ['introPosition', 'introAlign', 'itemsMode', 'itemsColumns', 'itemStyle', 'itemToggle'];
const dataAttr = (n) => `data-${n.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`)}`;

// ══ AC1：4 个预设逐字、旋钮名 / 值逐字、parts、目录集合、两两不同、旋钮独立 ═══════════════════════════
console.log('── AC1 四个预设');
{
  // 列：名字 · 形态目录 · introPosition · introAlign · itemsMode · itemsColumns · itemStyle · itemToggle（正文预设表逐字）
  const WANT = [
    ['Accordion', 'accordion', 'top', 'center', 'accordion', '1', 'divided', 'chevron'],
    ['Side intro', 'side-intro', 'left', 'left', 'accordion', '1', 'divided', 'plus'],
    ['Cards', 'cards', 'top', 'center', 'accordion', '2', 'card', 'chevron'],
    ['Open grid', 'open-grid', 'top', 'left', 'open', '3', 'plain', 'chevron'],
  ];
  const got = (M.presets || []).map((p) => [p.name, p.shape, ...KNOB_NAMES.map((c) => p.knobs[c])]);
  check(JSON.stringify(got) === JSON.stringify(WANT), 'presets 4 条与正文表逐字相同（名字 · 形态 · 六列旋钮）', JSON.stringify(got));
  check((M.presets || []).every((p) => Object.keys(p.knobs).join() === KNOB_NAMES.join()), '每个预设的 knobs 键就是这六个、同一顺序');
  const knobs = M.slots.options.knobs.map((k) => [k.name, k.values]);
  check(JSON.stringify(knobs) === JSON.stringify([
    ['introPosition', ['left', 'right', 'top', 'bottom']], ['introAlign', ['left', 'center', 'right']],
    ['itemsMode', ['accordion', 'open']], ['itemsColumns', ['1', '2', '3']],
    ['itemStyle', ['plain', 'card', 'divided']], ['itemToggle', ['chevron', 'plus']],
  ]), `slots.options.knobs 名字依次 ${knobs.map((k) => k[0]).join(' / ')}、values 与旋钮表逐字（#1481 起顺序只管展示，默认看 default ?? values[0]）`);
  check(require('./lib/block-knobs').knobDefault(M.slots.options.knobs.find((k) => k.name === 'itemStyle')) === 'divided', '#1481：itemStyle 排成 plain · card · divided 之后，没写值时仍是 divided（显式 default 钉住，顺序只管展示）');
  check(JSON.stringify(M.parts) === '["help"]', `parts == ["help"]（${JSON.stringify(M.parts)}）`);
  const dirs = fs.readdirSync(BLOCK, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name).sort();
  check(JSON.stringify(dirs) === JSON.stringify(WANT.map((w) => w[1]).sort()), `目录集合 == 4 个预设形态（${dirs.join(' / ')}）`);
  check(dirs.every((d) => !fs.existsSync(path.join(BLOCK, d, 'Section.tsx'))), '一份 Section.tsx（形态目录里没有第二份 markup）');
  check(M.skin === 'site-css' && M.roleDefault === 'essential', `skin=${M.skin} · roleDefault=${M.roleDefault}`);
  const htmls = dirs.map((d) => render(d, clone(DEMO)));
  check(new Set(htmls).size === 4, `同一份夹具下 4 个预设渲染出 ${new Set(htmls).size} 份互不相同的 HTML`);
  // 反向对照：夹具里写死六个旋钮 ⟹ 形态不再起作用，4 份（去掉 data-shape）应当塌成 1 份。
  const pinned = dirs.map((d) => render(d, withOpts(M.presets[0].knobs)).replace(/data-shape="[^"]*"/g, ''));
  check(new Set(pinned).size === 1, '反向对照：options 里写死六个旋钮 ⟹ 4 个预设（去掉 data-shape 之后）塌成同一份 —— 判据分得开');
  const r = render('accordion', clone(DEMO));
  const miss = KNOB_NAMES.filter((n) => attr(r, dataAttr(n)) !== M.presets[0].knobs[n]);
  check(miss.length === 0, 'Accordion：六个旋钮都写在 <section> 上', miss.join(' · '));
  // 旋钮独立：拧一个，其余五个不变（组件里没有联动纠正）。
  const base = M.presets[2].knobs;
  const moved = [];
  for (const k of M.slots.options.knobs) {
    for (const v of k.values) {
      const h = render('cards', withOpts({ [k.name]: v }));
      const others = KNOB_NAMES.filter((n) => n !== k.name);
      if (attr(h, dataAttr(k.name)) !== v || others.some((n) => attr(h, dataAttr(n)) !== base[n])) moved.push(`${k.name}=${v}`);
    }
  }
  check(moved.length === 0, `旋钮独立（Cards 上逐个拧 ${M.slots.options.knobs.reduce((n, k) => n + k.values.length, 0)} 档）：拧的那个到位、其余五个不变`, moved.join(' · '));
}

// ══ AC3：答案在静态 HTML 里 ═══════════════════════════════════════════════════════════════════════
console.log('\n── AC3 答案在静态 HTML 里');
{
  const acc = render('accordion', clone(DEMO));
  const details = acc.match(/<details\b[^>]*>[\s\S]*?<\/details>/g) || [];
  check(details.length === DEMO.items.length, `accordion：${DEMO.items.length} 条问答各一个 <details>（${details.length}）`);
  const inside = DEMO.items.filter((it, i) => details[i] && details[i].includes(esc(it.answer)) && details[i].includes('<summary'));
  check(inside.length === DEMO.items.length, `每条答案的文字都在它那个 <details> 里（${inside.length}/${DEMO.items.length}），问句在 <summary> 里`);
  const opened = (acc.match(/<details\b[^>]*>/g) || []).filter((t) => /\sopen[\s>=]/.test(t));
  check(opened.length === 0, `没有一个 <details> 带 open（一条都不默认展开，Chris 2026-09-29）—— 带的 ${opened.length} 个`);
  // 反向对照：同一把尺对着一个故意带 open 的串读到 1。
  check(['<details class="x" open="">'].filter((t) => /\sopen[\s>=]/.test(t)).length === 1, '反向对照：尺子认得出 <details open="">');
  const open = render('open-grid', clone(DEMO));
  check(count(open, '<details') === 0, `open 模式（Open grid）：没有 <details>（${count(open, '<details')}）`);
  const perItem = itemsOf(open).map((x) => [count(x, '<h3'), count(x, '<p')].join('+'));
  check(perItem.length === DEMO.items.length && perItem.every((x) => x === '1+1'), `open 模式每条是 <h3> + <p>（${perItem.join(' · ')}）`);
  check(DEMO.items.every((it) => open.includes(esc(it.answer))), 'open 模式每条答案的文字都在');
  check(count(open, 'data-part="toggle"') === 0 && count(acc, 'data-part="toggle"') === DEMO.items.length,
    `开合图标只在 accordion 画（accordion ${count(acc, 'data-part="toggle"')} 个 · open ${count(open, 'data-part="toggle"')} 个）`);
  const client = (SRC_TEXT.match(/use client|useState/g) || []).length;
  check(client === 0, `Section.tsx 里 grep -c "use client\\|useState" = ${client}（纯服务端组件）`);
}

// ══ AC4（DOM 与规则一半）：开合图标 ═══════════════════════════════════════════════════════════════════
console.log('\n── AC4 开合图标');
{
  const iconsIn = (h) => itemsOf(h).map((x) => (x.match(/data-icon="([^"]+)"/g) || []).map((m) => m.slice(11, -1)).join('+'));
  const chev = iconsIn(render('accordion', clone(DEMO)));
  check(chev.every((x) => x === 'chevron-down'), `itemToggle=chevron ⟹ 每条一个 chevron-down（${[...new Set(chev)].join(' | ')}）`);
  const plus = iconsIn(render('side-intro', clone(DEMO)));
  check(plus.every((x) => x === 'plus+dash'), `itemToggle=plus ⟹ 每条 plus + dash 两个（${[...new Set(plus)].join(' | ')}）`);
  check(/details\[open\] \.fq-chev \{\s*transform: rotate\(180deg\);/.test(CSS), 'block.css：展开时 chevron 转 180°');
  check(/\.fq-minus,\s*\n\[data-block="faq"\] details\[open\] \.fq-plus \{\s*display: none;/.test(CSS)
    && /details\[open\] \.fq-minus \{\s*display: inline;/.test(CSS), 'block.css：plus 收起时显 plus 藏 minus、展开时反过来');
  check(count(render('accordion', clone(DEMO), {}), '<svg') === 0, '对照：不给图标表 ⟹ 一个 <svg> 都没有（图标全靠服务端那张表）');
  check(JSON.stringify(icons.BLOCK_ICONS['faq']) === JSON.stringify(['chevron-down', 'plus', 'dash', 'arrow-right'])
    && ['chevron-down', 'plus', 'dash', 'arrow-right'].every((n) => TABLE[n]), `BLOCK_ICONS['faq'] 四个名字都查得到（${Object.keys(TABLE).join(' · ')}）`);
}

// ══ AC5 / AC6（规则一半）════════════════════════════════════════════════════════════════════════════
console.log('\n── AC5 / AC6 限宽与 itemStyle 规则');
{
  // #1515（Chris 2026-10-01）：问答永远占满整列、不跟 introAlign。原来这两条钉的是相反的契约
  // （1 列 + 块头在上 / 下时限 48rem，再按 introAlign 居中 / 贴右）——那是 2026-09-29 的老写法，
  // 跟后来定的两条规矩冲突（条目从不跟 introAlign、内容占满整列）。现在改成钉「这几条规则不许回来」。
  // 🔴 判据写成【集合】不写命中数：`.fq-grid` 身上一条限宽都不许有、一条读 introAlign 的都不许有。
  const gridRules = CSS.split(/\n(?=\[|@|\/\*)/).filter((b) => /\.fq-grid\b/.test(b) && !b.trimStart().startsWith('/*'));
  check(!gridRules.some((b) => /max-width:/.test(b)), '问答占满整列：.fq-grid 身上没有任何 max-width');
  check(!gridRules.some((b) => /data-intro-align/.test(b)), '不跟 introAlign：.fq-grid 的规则里没有一条读 data-intro-align');
  check(/\[data-item-style="divided"\] \.fq-inner \{\s*border-bottom: 1px solid/.test(CSS)
    && /\[data-item-style="divided"\]\[data-items-columns="1"\] \.fq-item:first-child \.fq-inner \{\s*border-top: 1px solid/.test(CSS),
    'divided：每条 1px 下边线、1 列时第一条上边线');
  check(/\[data-item-style="card"\] \.fq-inner,\s*\n[^{]*\.fq-open \{\s*background: var\(--x-body-bg\);\s*border: 1px solid[^;]*;\s*border-radius: 1rem;/.test(CSS), 'card：白底 + 1px 描边 + 1rem 圆角');
  check(!/\[data-item-style="plain"\][^{]*\{[^}]*border/.test(CSS), 'plain：没有任何规则给它加线或框');
  const cls = (h) => (/<details class="([^"]+)"/.exec(h) || [])[1];
  check(cls(render('accordion', clone(DEMO))) === cls(render('cards', clone(DEMO))), '三种 itemStyle 同一份 markup（区别全在根上的 data-item-style）');
}

// ══ AC7（DOM 一半）：help 部件 ═════════════════════════════════════════════════════════════════════
console.log('\n── AC7 help 部件');
{
  const full = render('side-intro', clone(DEMO));
  const introCol = (/<div class="col-12 fq-introcol"[\s\S]*?<div class="col-12 fq-itemscol"/.exec(full) || [''])[0];
  check(count(full, 'data-part="help"') === 1 && introCol.includes('data-part="help"'), 'help 有值 ⟹ 一张联系卡，在块头那一列里');
  check(introCol.indexOf('data-part="help"') > introCol.indexOf('data-slot="body"'), 'help 卡在块头文字之后（块头那一列最下面）');
  const noHelp = withOpts({}); delete noHelp.help;
  check(count(render('side-intro', noHelp), 'data-part="help"') === 0, 'help 清空 ⟹ 联系卡节点不存在');
  const emptyHelp = render('side-intro', withOpts({}, { help: { cta: { href: '/contact' } } }));
  check(count(emptyHelp, 'data-part="help"') === 0, 'help 里只有一个没字的按钮 ⟹ 也不渲染');
  check(/href="tel:\+14165550142"/.test(full) && count(full, 'data-cta="solid"') === 1, 'help 卡按钮指向电话（tel:）、solid');
  const noHead = withOpts({}); delete noHead.headline; delete noHead.body; delete noHead.help;
  const nh = render('accordion', noHead);
  check(!nh.includes('data-part="intro"') && nh.includes('data-part="items"'), 'headline + body + help 都清空 ⟹ 块头那一列不渲染、问答照画');
  const styles = M.slots.introEyebrow.choices.style.filter((s) => s !== 'none')
    .map((s) => (/data-eyebrow="([^"]*)"/.exec(render('accordion', { ...clone(DEMO), introEyebrow: { text: 'x', style: s } })) || [])[1]);
  check(styles.join() === 'pill,outline,dash,plain', `introEyebrow 四式都画得出来（${styles.join(' / ')}）`);
  check(!render('accordion', withOpts({}, { introEyebrow: { text: 'x', style: 'none' } })).includes('data-part="eyebrow"'), 'introEyebrow.style=none ⟹ 不渲染');
  check(JSON.stringify(M.slots.introEyebrow.choices.style) === '["none","pill","outline","dash","plain"]', 'introEyebrow.style 词表 none 在最前（#1481 规矩 1）');
}

// ══ AC8：bg ══════════════════════════════════════════════════════════════════════════════════════
console.log('\n── AC8 bg');
{
  const at = (bg) => render('accordion', withOpts({}, { bg }));
  check(attr(at('#0f172a'), 'data-tone') === 'dark' && /style="background:#0f172a"/.test(sectionTag(at('#0f172a'))), '#0f172a ⟹ data-tone="dark"、<section> 底色 #0f172a');
  check(attr(at('#ffffff'), 'data-tone') === 'light', '#ffffff ⟹ light（深字）');
  check(attr(at('brand'), 'data-tone') === 'brand' && /style="background:var\(--x-primary\)"/.test(sectionTag(at('brand'))), 'brand ⟹ data-tone="brand"、底色 var(--x-primary)');
  const g = at({ stops: ['#7d52f4', '#f7b733'], angle: 135 });
  check(/style="background:linear-gradient\(135deg,#7d52f4,#f7b733\)"/.test(sectionTag(g)) && attr(g, 'data-tone') === 'dark',
    `渐变 {stops:[#7d52f4,#f7b733],angle:135} ⟹ linear-gradient(135deg,…) + data-tone="dark"`);
  check(attr(at(undefined), 'data-tone') === 'light' && !/\sstyle=/.test(sectionTag(at(undefined))), '没写 bg ⟹ light、<section> 没有 style');
  // 第 5 版 AC8 的两道渐变（contrast.js 色板里那道深色 + 一道浅色）：判据落在 data-tone 上 —— 浅色那道是反过来的对照，
  // 「不管什么底都判 dark」的实现会在这里红（上一版的 `toneFor(` 计数在接对 / 没接两种实现上都读 0，测不到东西）。
  check(attr(at({ stops: ['#0f172a', '#334155'] }), 'data-tone') === 'dark', "深色渐变 {stops:['#0f172a','#334155']} ⟹ data-tone=\"dark\"");
  check(attr(at({ stops: ['#ffffff', '#f1f5f9'] }), 'data-tone') === 'light', "反向对照：浅色渐变 {stops:['#ffffff','#f1f5f9']} ⟹ data-tone=\"light\"（不是永远 dark）");
  check(count(SRC_TEXT, 'toneFor(') === 0 && count(SRC_TEXT, 'linear-gradient') === 0 && /<BlockSection[\s\S]*?\bbg=\{d\.bg\}/.test(SRC_TEXT),
    `Section.tsx 把 bg 交给 <BlockSection>（深浅 / 底色由它调 contrast.js 的 toneForBg / bgCss，#1534）；自己 toneFor( ${count(SRC_TEXT, 'toneFor(')} 处、linear-gradient ${count(SRC_TEXT, 'linear-gradient')} 处`);
  const { ON_DEEP_MUTED } = require(path.join(NEXT, 'scripts', 'lib', 'site-css.js'));
  check(/\[data-tone="dark"\] \.text-muted,/.test(ON_DEEP_MUTED) && !/\.text-muted\s*\{[^}]*rgba\(255, 255, 255/.test(CSS),
    'dark / brand 时答案白 .92：全站那条（site-css.js §ON_DEEP_MUTED），block.css 里没有自己那份');
  check(/\[data-tone="dark"\] \.fq-q,[\s\S]*?\{\s*color: #fff !important;/.test(CSS), 'block.css：dark / brand 时标题 / 问句反白');
  check(/\[data-block="faq"\]\[data-tone="dark"\] \.btn-primary,[\s\S]*?\{\s*background: #fff !important;\s*border-color: #fff !important;\s*color: #0f172a !important;/.test(DEEP), 'site-css §DEEP_COMMON：深底时 help 卡主按钮白底（深底那一档是深字）');
  check(JSON.stringify(M.slots.bg) === JSON.stringify(manifestLib.loadManifests().get('footer').slots.bg), 'bg 槽对象与 footer 的 slots.bg 逐字相同');
}

// ══ AC9：validateSite ═══════════════════════════════════════════════════════════════════════════
console.log('\n── AC9 validateSite');
{
  const item = (i) => ({ question: `Question ${i}?`, answer: `Answer ${i}.` });
  const v = (data, shape) => own(manifestLib.validateSite({
    pages: [{ slug: 'p', blocks: [{ type: 'faq', ...(shape ? { shape } : {}), data: { headline: 'H', ...data } }] }], scope: 'edit',
  }));
  for (const n of [0, 13]) {
    const r = v({ items: Array.from({ length: n }, (_, i) => item(i)) });
    // 0 条时校验器另报一条「缺必填槽」（空数组按缺槽算，同 milestones 的 stats）—— 两条都点名 items。
    check(r.length >= 1 && r.every((p) => p.includes('"items"')) && r.some((p) => p.includes(n ? '最多只能有 12 项' : '至少要 1 项')),
      `items ${n} 条 ⟹ 被拦、每条报错都点名 items（${r.length} 条）`, JSON.stringify(r));
  }
  for (const n of [1, 12]) {
    const r = v({ items: Array.from({ length: n }, (_, i) => item(i)) });
    check(r.length === 0, `items ${n} 条 ⟹ 放行`, JSON.stringify(r));
  }
  check(M.slots.items.minItems === 1 && M.slots.items.maxItems === 12 && M.slots.items.max === undefined,
    'items 用 minItems 1 / maxItems 12 声明，没有 max（max 是工具栏「数量」那一维，PM 三审 1）');
  const r2 = v({ items: [item(1)], options: { itemsColumns: 2 } });
  check(r2.length === 1 && r2[0].includes('options.itemsColumns'), 'options.itemsColumns 写成数字 2 ⟹ 报一条（取值是字符串）', JSON.stringify(r2));
  const r3 = v({ items: [item(1)], options: { columns: '2' } });
  check(r3.length === 1 && r3[0].includes('"columns"'), '不认的旋钮键 options.columns ⟹ 报一条', JSON.stringify(r3));
  for (const p of M.presets) {
    const r = v({ ...clone(DEMO), options: p.knobs }, p.shape);
    check(r.length === 0, `预设 ${p.name} 那组值 + 演示内容 ⟹ 放行`, JSON.stringify(r));
  }
}

// ══ AC10：block-roles · 首页配方池 ════════════════════════════════════════════════════════════════
console.log('\n── AC10 block-roles · 首页配方');
{
  const roles = JSON.parse(fs.readFileSync(path.join(SRC, 'lib', 'sections', 'block-roles.json'), 'utf-8'));
  check(roles['faq'] === M.roleDefault, `block-roles.json 的 faq（${roles['faq']}）== manifest roleDefault（${M.roleDefault}）`);
  const recipe = require(path.join(NEXT, 'scripts', 'lib', 'homepage-recipe.js'));
  const all = manifestLib.loadManifests();
  const pool = recipe.poolFor(all);
  // 📌 #1425（T3）—— 这里原来测「faq-accordion 在 NOT_IN_POOL、拿掉它两个都进池、order 与 faq-accordion 同档」；faq-accordion 随旧库删了。今天的不变量：faq 在池里、池子种数 = 首页组减排除名单（#1670 起现算，原来写死 11）、排除名单不点它。
  const wantLen = [...all.values()].filter((m) => m.prompt && m.prompt.group === 'homepage' && !(m.type in recipe.NOT_IN_POOL)).length; // #1670：种数现算（首页组减排除名单），不再写死 11
  check(pool.includes('faq') && !('faq' in recipe.NOT_IN_POOL) && pool.length === wantLen, `poolFor 含 faq、faq 不在 NOT_IN_POOL、池子 ${wantLen} 种（现算；读到 ${pool.length}）`);
  // 反向对照：把 faq 放进排除名单 ⟹ 它出池、种数 -1 —— 判据分得开。
  recipe.NOT_IN_POOL['faq'] = 'test';
  let outPool;
  try { outPool = recipe.poolFor(all); } finally { delete recipe.NOT_IN_POOL['faq']; }
  check(!outPool.includes('faq') && outPool.length === pool.length - 1, `反向对照：排除 faq ⟹ 它出池、种数 ${pool.length} → ${outPool.length}（-1）`);
  check(M.prompt.group === 'homepage', 'prompt.group == homepage');
  const lines = M.prompt.lines.join('\n');
  check(/4–8/.test(lines) && /never invent/.test(lines) && /tel:/.test(lines) && /top-level in data \(not inside options\)/.test(lines),
    'prompt.lines：items 4–8 条、从站内真实信息写、不编政策、help 按钮指电话或联系页、bg 在 data 顶层');
}

// ══ AC12（编辑器 schema 一半；往返无损由 editor-roundtrip.test.js 对全部页面块量）═══════════════════════
console.log('\n── AC12 编辑器 schema');
{
  const { editorSchema } = require(path.join(NEXT, 'scripts', 'lib', 'editor-schema.js'));
  const { presetNameFor } = require(path.join(NEXT, 'scripts', 'lib', 'block-knobs.js'));
  const on = editorSchema({}).components.find((c) => c.type === 'faq');
  check(!!on, 'Puck 组件里有 faq（能从左栏拖进页面）');
  const order = on.fields.map((f) => f.slot);
  check(JSON.stringify(order) === JSON.stringify(['options', 'introEyebrow', 'headline', 'body', 'help', 'items', 'bg']),
    `字段顺序 = 旋钮 → 眉标 → 块头 → help → items → bg（${order.join(' → ')}）`);
  const opt = on.fields[0];
  check(opt.control === 'options' && opt.presets.map((p) => p.name).join() === M.presets.map((p) => p.name).join()
    && opt.knobs.map((k) => k.name).join() === KNOB_NAMES.join(), '第一个字段：预设 4 个 → 六个旋钮（控件顺序 intro → items → item）');
  const items = on.fields.find((f) => f.slot === 'items');
  check(items.control === 'list' && items.subs.map((x) => x.sub).join() === 'question,answer', `items 是列表字段、每条可改 question / answer（${items.control} · ${items.subs.map((x) => x.sub).join(' / ')}）`);
  const man = { slots: { options: { knobs: opt.knobs } }, presets: opt.presets };
  check(presetNameFor(man, M.presets[2].knobs) === 'Cards' && presetNameFor(man, { ...M.presets[2].knobs, itemToggle: 'plus' }) === 'custom',
    '点 Cards = 那一组旋钮；拧偏一个（itemToggle=plus）⟹ custom');
}

// 📌 #1425（T3）—— 这里原来测 AC13「faq-accordion 相对 merge-base 零改动、block-roles 里仍 essential」；faq-accordion 随旧库删了。

console.log(`\n══ 汇总: 通过 ${pass} · 失败 ${fail} ══`);
process.exit(fail ? 1 : 0);
