#!/usr/bin/env node
/**
 * pricing-render.test.js — #1483 验收里「看渲染出来的 HTML / 调一次校验器就能判」的那几条。
 *
 * 跑法:  node scripts/pricing-render.test.js   （或 `npm run test:scripts`，它按文件名发现）
 * 退出码: 0 全过 · 1 有失败 · 2 跑不起来（**不许当成通过**）
 *
 * 管哪几条：AC1（6 个预设逐字 · Rainbow 的 colors · 旋钮名 / 值逐字 · parts · 目录集合 · 6 份 HTML 两两不同）·
 * AC3 的纯函数一半（presetNameFor 四种 · presetColors 点预设恢复颜色 · hero / cta 不受影响）·
 * AC4 / AC5 / AC6 的 DOM 与规则一半（featured × featuredColor 写到根上的变量 / data-fc-*、深底 + outline 那几条规则在）·
 * AC7（部件空不渲染、billing 的条件与位置、点 Yearly 换价的数据面）· AC8（validateSite + knobDeclarationProblems）·
 * AC10（block-roles · 首页配方池，不写死种数）· AC12 的编辑器 schema 一半。
 * 计算色、几何、真点击要浏览器：`tests/e2e/specs/1483-pricing-new-knobs.spec.ts`。
 *
 * 🔴 每一段都带反向对照（同一进程、单变量），证明判据真会红。
 * 夹具定死：演示内容包里的 Northside Auto Care（`scripts/lib/demo-content`，正文做什么 10）的前三档。
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
const BLOCK = path.join(NEXT, 'blocks', 'pricing');
const SECTION = path.join(BLOCK, 'Section.tsx');

let pass = 0;
let fail = 0;
const ok = (m) => { pass += 1; console.log(`  ✅ ${m}`); };
const bad = (m) => { fail += 1; console.log(`  ❌ ${m}`); };
const die = (m) => { console.error(`🔴 跑不起来: ${m}`); process.exit(2); };
const check = (cond, m, detail) => (cond ? ok(m) : bad(detail ? `${m} —— ${detail}` : m));

// ── 让 node 能 require 这份 .tsx；Next 自己的换成替身（同 milestones-render.test.js）──────────────────
const STUB_DIR = path.join(NEXT, 'scripts', '.pricing-stubs');
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

let C; let DEMO; let manifestLib; let M; let icons; let knobsLib;
try {
  C = require(SECTION).default;
  DEMO = require(path.join(NEXT, 'scripts', 'lib', 'demo-content')).DEMO_CONTENT['pricing'];
  manifestLib = require(path.join(NEXT, 'scripts', 'lib', 'block-manifest.js'));
  M = manifestLib.loadManifests().get('pricing');
  icons = require(path.join(NEXT, 'scripts', 'lib', 'icons.js'));
  knobsLib = require(path.join(NEXT, 'scripts', 'lib', 'block-knobs.js'));
} catch (e) { die(`载入失败: ${e.message}`); }
if (!DEMO) die('demo-content 里没有 pricing');
if (!M) die('blocks/ 里没有 pricing');

const clone = (v) => JSON.parse(JSON.stringify(v));
// 正文做什么 10 点名的三档（演示内容包为守卫 (c) 补到 6 条，组件只画前 4 条）。
const THREE = { ...clone(DEMO), plans: clone(DEMO.plans).slice(0, 3), highlights: clone(DEMO.highlights).slice(0, 4) };
const TABLE = icons.iconTableFor('pricing', DEMO, { warn: () => {} });
const render = (shape, data, iconTable = TABLE) => renderToStaticMarkup(React.createElement(C, {
  data, locale: 'en', iconTable, block: { id: 'p', type: 'pricing', shape, data: {} },
}));
const withOpts = (o, extra = {}, base = THREE) => ({ ...clone(base), ...extra, options: { ...(base.options || {}), ...o } });
const count = (html, needle) => html.split(needle).length - 1;
const own = (r) => r.problems.filter((p) => p.includes('("pricing")'));
const sectionTag = (html) => (/<section[^>]*>/.exec(html) || [''])[0];
const attr = (html, name) => { const m = new RegExp(`\\s${name}="([^"]*)"`).exec(sectionTag(html)); return m ? m[1] : null; };
const styleVar = (html, v) => { const s = attr(html, 'style') || ''; const m = new RegExp(`${v}:([^;]*)`).exec(s); return m ? m[1].trim() : null; };
const plansOf = (html) => html.split('class="pr-plan').slice(1);
// #1535 —— 块头排版由 manifest 的 introLayout 生成（scripts/block-build/intro-layout.js），拼在 block.css 前面；
//    这里读的是两份拼起来的那一段（= public/shapes.css 里这个块的那一段）。
const CSS = require('./block-build/intro-layout').introLayoutCss(JSON.parse(fs.readFileSync(path.join(BLOCK, 'manifest.json'), 'utf-8')), 'pricing')
  + '\n' + fs.readFileSync(path.join(BLOCK, 'block.css'), 'utf-8');
const KNOB_NAMES = ['introPosition', 'introAlign', 'plansColumns', 'planFeatures', 'planStyle', 'planAlign', 'planCta', 'featured'];
const RAINBOW = { stops: ['#7d52f4', '#f7b733'], angle: 135 };

// ══ AC1：6 个预设逐字 · 旋钮 · parts · 目录 · 两两不同 ═════════════════════════════════════════════
console.log('── AC1 六个预设');
{
  // 列：名字 · 形态目录 · 八列旋钮（正文预设表逐字）
  const WANT = [
    ['Plan cards', 'plan-cards', 'top', 'center', 'auto', 'inside', 'card', 'left', 'top', 'outline'],
    ['Side intro', 'side-intro', 'left', 'left', '2', 'inside', 'card', 'left', 'top', 'outline'],
    ['Open columns', 'open-columns', 'top', 'center', 'auto', 'inside', 'divided', 'left', 'top', 'background'],
    ['Features below', 'features-below', 'top', 'center', 'auto', 'below', 'card', 'left', 'top', 'background'],
    ['One plan', 'one-plan', 'left', 'left', '1', 'inside', 'card', 'left', 'bottom', 'outline'],
    ['Rainbow', 'rainbow', 'top', 'center', 'auto', 'inside', 'card', 'left', 'top', 'outline'],
  ];
  const got = (M.presets || []).map((p) => [p.name, p.shape, ...KNOB_NAMES.map((c) => p.knobs[c])]);
  check(JSON.stringify(got) === JSON.stringify(WANT), 'presets 6 条与正文表逐字相同（名字 · 形态 · 八列旋钮）', JSON.stringify(got));
  check((M.presets || []).every((p) => Object.keys(p.knobs).join() === KNOB_NAMES.join()), '每个预设的 knobs 键就是这八个、同一顺序');
  const withColors = M.presets.filter((p) => p.colors);
  check(withColors.length === 1 && withColors[0].name === 'Rainbow'
    && JSON.stringify(withColors[0].colors) === JSON.stringify({ bg: RAINBOW, featuredColor: RAINBOW }),
  `只有 Rainbow 带 colors，bg = featuredColor = {stops:['#7d52f4','#f7b733'], angle:135}（${JSON.stringify(withColors.map((p) => p.colors))}）`);
  const knobs = M.slots.options.knobs.map((k) => [k.name, k.values]);
  check(JSON.stringify(knobs) === JSON.stringify([
    ['introPosition', ['left', 'right', 'top', 'bottom']], ['introAlign', ['left', 'center', 'right']],
    ['plansColumns', ['auto', '1', '2', '3', '4']], ['planFeatures', ['inside', 'below']],
    ['planStyle', ['card', 'divided', 'plain']], ['planAlign', ['left', 'center', 'right']],
    ['planCta', ['top', 'bottom']], ['featured', ['outline', 'background']],
  ]), `slots.options.knobs 名字依次 ${knobs.map((k) => k[0]).join(' / ')}、values 与旋钮表逐字`);
  check(JSON.stringify(M.parts) === JSON.stringify(['highlights', 'proof', 'logos', 'billing']), `parts == [highlights, proof, logos, billing]（${M.parts}）`);
  const colorSlots = Object.keys(M.slots).filter((s) => M.slots[s].kind === 'color');
  check(colorSlots.join() === 'bg,featuredColor', `两个颜色槽、声明顺序 bg → featuredColor（${colorSlots.join(' → ')}）`);
  // #1534 —— 盘上的 slots.bg 现在是 { ref: 'bg' }，比的是读入口展开后的那一份（两边都经 loadManifests）。
  const footerBg = manifestLib.loadManifests().get('footer').slots.bg;
  check(JSON.stringify(M.slots.bg) === JSON.stringify(footerBg), 'slots.bg 整个对象与 footer 的 slots.bg 逐字相同');
  // 正文的六格 = 四个纯色 + 两道渐变。`swatches` 只装纯色（Go 那侧按 []string 读、BgPicker 按字符串画），两道渐变是
  // 共用色板那一排预设渐变（contrast.js §GRADIENT_SWATCHES）里的前两档 —— 色板上六格一格不少。
  const { GRADIENT_SWATCHES } = require(path.join(NEXT, 'scripts', 'lib', 'contrast.js'));
  check(JSON.stringify(M.slots.featuredColor.swatches) === JSON.stringify(['brand', '#dc2626', '#16a34a', '#0f172a'])
    && JSON.stringify(GRADIENT_SWATCHES.slice(0, 2)) === JSON.stringify([RAINBOW, { stops: ['#0ea5e9', '#6366f1'], angle: 135 }])
    && M.slots.featuredColor.shape === M.slots.bg.shape,
  'featuredColor：形状同 bg；四个纯色进 swatches、两道渐变 = 共用色板的前两档预设渐变（正文六格一格不少）');
  const dirs = fs.readdirSync(BLOCK, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name).sort();
  check(JSON.stringify(dirs) === JSON.stringify(WANT.map((w) => w[1]).sort()), `目录集合 == 6 个预设形态（${dirs.join(' / ')}）`);
  check(dirs.every((d) => fs.existsSync(path.join(BLOCK, d, 'shape.md')) && !fs.existsSync(path.join(BLOCK, d, 'Section.tsx'))),
    '每个目录一份 shape.md、没有第二份 markup');
  check(M.skin === 'site-css' && M.roleDefault === 'optional', `skin=${M.skin} · roleDefault=${M.roleDefault}`);
  // 🔴 PM 裁定技术判断 1：渲染时把预设自己声明的 colors 一并喂进 data —— 只喂旋钮的话 Plan cards 与 Rainbow 按构造相同。
  const dataFor = (p) => ({ ...clone(THREE), ...(p.colors ? clone(p.colors) : {}) });
  const htmls = M.presets.map((p) => render(p.shape, dataFor(p)));
  check(new Set(htmls).size === 6, `同一份夹具下 6 个预设（带上各自的 colors）渲染出 ${new Set(htmls).size} 份互不相同的 HTML`);
  const pc = htmls[0].replace(/data-shape="[^"]*"/g, '');
  const rb = htmls[5].replace(/data-shape="[^"]*"/g, '');
  check(pc !== rb, 'Plan cards 与 Rainbow（旋钮逐字相同、只差颜色）去掉 data-shape 之后仍不同');
  // 反向对照：不喂 colors ⟹ 这两个去掉 data-shape 之后逐字相同（证明上一格的「不同」来自颜色，不是别的）。
  const rbNoColor = render('rainbow', clone(THREE)).replace(/data-shape="[^"]*"/g, '');
  check(pc === rbNoColor, '反向对照：Rainbow 不喂 colors ⟹ 与 Plan cards 逐字相同（仪器分得开「颜色」与「排法」）');
  // 八个旋钮都挂在根上
  const h0 = htmls[0];
  const names = { introPosition: 'data-intro-position', introAlign: 'data-intro-align', plansColumns: 'data-plans-columns', planFeatures: 'data-plan-features',
    planStyle: 'data-plan-style', planAlign: 'data-plan-align', planCta: 'data-plan-cta', featured: 'data-featured' };
  check(KNOB_NAMES.every((k) => attr(h0, names[k]) === M.presets[0].knobs[k]), '八个旋钮的实际值都写在根元素的 data-* 上');
  check(Object.values(names).every((a) => new RegExp(`\\[${a}=`).test(CSS)), 'block.css 对八个 data-* 都有规则（没有哪个旋钮是摆设）');
  // 旋钮独立：拧一个，只有那一个 data-* 变
  const one = render('plan-cards', withOpts({ planStyle: 'plain' }));
  check(attr(one, 'data-plan-style') === 'plain' && KNOB_NAMES.filter((k) => k !== 'planStyle').every((k) => attr(one, names[k]) === attr(h0, names[k])),
    '只拧 planStyle=plain ⟹ 只有 data-plan-style 变，其余七个不动（没有「拧了 A 替你改 B」）');
}

// ══ AC3（纯函数一半）：presetNameFor 带颜色 · presetColors ════════════════════════════════════════════
console.log('\n── AC3 预设带颜色');
{
  const plan = M.presets[0].knobs;
  const { presetNameFor, presetColors, knobDeclarationProblems } = knobsLib;
  check(presetNameFor(M, { ...plan, bg: RAINBOW, featuredColor: RAINBOW }) === 'Rainbow', '① 排法 = Plan cards、两个颜色 = Rainbow 的 ⟹ Rainbow（Plan cards 不亮）');
  check(presetNameFor(M, { ...plan, bg: RAINBOW, featuredColor: '#dc2626' }) === 'Plan cards', '② featuredColor 改成 #dc2626 ⟹ 回落到 Plan cards');
  check(presetNameFor(M, { ...plan }) === 'Plan cards' && presetNameFor(M, { ...plan, bg: '#0f172a' }) === 'Plan cards', '③ 没有颜色 / 别的颜色 ⟹ Plan cards（它不看颜色）');
  check(presetNameFor(M, { ...plan, bg: { stops: ['#7D52F4', '#F7B733'] }, featuredColor: { stops: ['#7d52f4', '#f7b733'], angle: 135 } }) === 'Rainbow',
    '④ 颜色按 normalizeBg 之后比：#7D52F4 == #7d52f4、没写角度 == 135');
  check(presetNameFor(M, { ...plan, planStyle: 'plain', bg: RAINBOW, featuredColor: RAINBOW }) === 'custom', '⑤ 颜色对、排法拧偏一个 ⟹ custom');
  check(JSON.stringify(presetColors(M, 'Rainbow')) === JSON.stringify({ bg: RAINBOW, featuredColor: RAINBOW }), '点 Rainbow ⟹ bg / featuredColor 都设成那道渐变');
  check(JSON.stringify(presetColors(M, 'Plan cards')) === JSON.stringify({ bg: null, featuredColor: null }), '点 Plan cards（规则 2）⟹ 两个颜色槽都恢复成空');
  const all = manifestLib.loadManifests();
  const others = ['hero', 'cta', 'features', 'milestones', 'header', 'footer'].filter((t) => all.get(t));
  check(others.length === 6 && others.every((t) => (all.get(t).presets || []).every((p) => JSON.stringify(presetColors(all.get(t), p.name)) === '{}')),
    `没有带颜色预设的块（${others.join(' / ')}）：点任一预设 presetColors 回 {} ⟹ ?bg= 不被清掉`);
  check(others.every((t) => (all.get(t).presets || []).every((p) => presetNameFor(all.get(t), { ...p.knobs, ...(p.options || {}), bg: '#0f172a' }) === p.name)),
    '那几个块：带着 bg 判预设照旧（颜色不参与）');
  check(knobDeclarationProblems(M).length === 0, `pricing 自己的声明干净（${knobDeclarationProblems(M).join(' | ')}）`);
  // 反向对照：Rainbow 的 colors 拿掉 ⟹ 它跟 Plan cards 组合一模一样，声明检查当场报。
  const noColor = clone(M); delete noColor.presets[5].colors;
  check(knobDeclarationProblems(noColor).some((p) => p.includes('Rainbow') && p.includes('Plan cards')), '反向对照：Rainbow 不带 colors ⟹ 报「跟 Plan cards 一模一样」');
}

// ══ AC4 / AC5（DOM + 规则一半）：featured × featuredColor ═════════════════════════════════════════════
console.log('\n── AC4 / AC5 featured × featuredColor');
{
  const h = (o, extra) => render('plan-cards', withOpts(o, extra));
  const red = h({ featured: 'outline' }, { featuredColor: '#dc2626' });
  check(attr(red, 'data-featured') === 'outline' && attr(red, 'data-fc-kind') === 'solid' && styleVar(red, '--pr-fc') === '#dc2626' && styleVar(red, '--pr-fc-line') === '#dc2626',
    `outline + #dc2626 ⟹ 根上 data-fc-kind=solid、--pr-fc / --pr-fc-line = #dc2626`);
  const feat = plansOf(red).map((p) => p.includes('pr-featured'));
  check(feat.join() === 'false,true,false', `夹具中间那档高亮（${feat.join(' / ')}）`);
  const bgRed = h({ featured: 'background' }, { featuredColor: '#dc2626' });
  check(attr(bgRed, 'data-fc-tone') === 'dark' && styleVar(bgRed, '--pr-fc-on') === '#fff' && styleVar(bgRed, '--pr-fc-ink') === '#dc2626',
    'background + #dc2626 ⟹ 深色：卡里字白（--pr-fc-on #fff）、主按钮白底红字（--pr-fc-ink #dc2626）');
  const yel = h({ featured: 'background' }, { featuredColor: '#fde047' });
  check(attr(yel, 'data-fc-tone') === 'light' && styleVar(yel, '--pr-fc-on') === '#0f172a', 'background + #fde047（浅）⟹ 卡里字深色（--pr-fc-on #0f172a）');
  const grad = h({ featured: 'outline' }, { featuredColor: RAINBOW });
  check(attr(grad, 'data-fc-kind') === 'gradient' && /linear-gradient\(135deg,#7d52f4,#f7b733\)/.test(styleVar(grad, '--pr-fc') || '')
    && styleVar(grad, '--pr-fc-line') === 'transparent', 'outline + 渐变 ⟹ data-fc-kind=gradient、--pr-fc 是那条 linear-gradient、--pr-fc-line 透明');
  const brand = h({}, {});
  check(attr(brand, 'data-fc-tone') === 'brand' && styleVar(brand, '--pr-fc') === 'var(--x-primary)', 'featuredColor 空 ⟹ brand（站点主色）那一档');
  check(/\[data-fc-kind="gradient"\]\[data-featured="outline"\][^{]*\.pr-featured \.pr-inner[^{]*\{[^}]*padding-box, var\(--pr-fc\) border-box/.test(CSS),
    'block.css：渐变描边走 padding-box / border-box 两层背景（内层不透明白）');
  check(/\[data-featured="outline"\]\[data-plan-features="inside"\] \.pr-featured \.pr-inner,[^{]*\{[^}]*padding: 2rem/.test(CSS),
    'block.css：高亮卡自己补一个 2rem 内边距的盒子（divided / plain 时也不贴字）');
  // AC5：深底 + outline ⟹ 普通卡半透明、高亮卡白卡深字
  check(/\[data-tone="dark"\]\[data-plan-style="card"\] \.pr-inner,[^{]*\{[^}]*rgba\(255, 255, 255, 0\.06\)/.test(CSS), 'block.css：深底上普通卡 rgba(255,255,255,.06)');
  check(/\[data-featured="outline"\]\[data-tone\] \.pr-featured \.pr-name,[^{]*\{[^}]*var\(--scheme-ink-strong\) !important/.test(CSS), 'block.css：outline 高亮卡的名字 / 价格在任何底色上都是深色（#1472 起读 --scheme-ink-strong：light 值仍是 #0f172a，深色站没填 bg 时跟着变浅）');
  // 🔴 高亮色不叫 data-tone：全站那条「深底小字白 .92」挂在 [data-tone="dark"] 上（site-css.js §ON_DEEP_MUTED）。
  check(!/data-tone="[^"]*"[^>]*data-part="plan"/.test(render('plan-cards', withOpts({ featured: 'background' }, { featuredColor: '#0f172a' })).split('<section')[1].split('>').slice(1).join('>')),
    '高亮卡自己不挂 data-tone（否则全站那条深底小字规则会跟着套进卡里）');
}

// ══ AC6（DOM 一半）：badge 与对齐 ══════════════════════════════════════════════════════════════════
console.log('\n── AC6 对齐');
{
  check(/\[data-plan-align="right"\] \.pr-head \{[^}]*row-reverse/.test(CSS), 'planAlign=right ⟹ .pr-head 行反向（badge 换到名字左边）');
  check(/\.pr-features \{[^}]*text-align: start/.test(CSS) && /\[data-plan-align="center"\] \.pr-features \{[^}]*fit-content/.test(CSS),
    '清单每行起端对齐（text-align: start —— LTR 左、RTL 右，#1473），整块跟着 planAlign 走（fit-content + auto 边距）');
  check(/\[data-plans-columns="1"\]\[data-plan-cta="top"\]\[data-plan-align="center"\] \.pr-cta \{[^}]*align-self: center/.test(CSS)
    && /\[data-plans-columns="1"\]\[data-plan-cta="top"\]\[data-plan-align="right"\] \.pr-cta \{[^}]*align-self: flex-end/.test(CSS),
  'plansColumns=1 + planCta=top：按钮不通栏、跟 planAlign（center 居中 / right 靠右）');
  check(/\[data-intro-align="center"\] \.pr-highlights \{[^}]*display: flex/.test(CSS) && /\[data-intro-align="right"\] \.pr-hl \{[^}]*row-reverse/.test(CSS),
    'introAlign=center ⟹ highlights 排成一排；right ⟹ 图标在右（行反向）');
}

// ══ AC7：部件 ═════════════════════════════════════════════════════════════════════════════════════
console.log('\n── AC7 部件');
{
  const full = render('plan-cards', clone(THREE));
  for (const p of ['highlights', 'proof', 'logos', 'billing']) {
    check(full.includes(`data-part="${p}"`), `演示内容 ⟹ ${p} 节点在`);
    const d = clone(THREE); delete d[p];
    check(!render('plan-cards', d).includes(`data-part="${p}"`), `清空 ${p} ⟹ 那个节点不在 DOM 里`);
  }
  const noYearly = clone(THREE); for (const p of noYearly.plans) delete p.price.yearly;
  check(!render('plan-cards', noYearly).includes('data-part="billing"'), 'billing 有值但没有任何 price.yearly ⟹ 不渲染');
  const iBilling = full.indexOf('data-part="billing"');
  const iPlan = full.indexOf('data-part="plan"');
  const iIntro = full.indexOf('data-part="intro"');
  check(iIntro >= 0 && iIntro < iBilling && iBilling < iPlan, `billing 在块头之后、第一个套餐之前（DOM 位置 intro ${iIntro} < billing ${iBilling} < plan ${iPlan}）`);
  check(full.includes('data-billing="monthly"') && plansOf(full).every((p, i) => p.includes(`>${THREE.plans[i].price.monthly}<`)),
    '初始是月付：每个套餐显示 price.monthly（静态导出的 HTML 就是月付那一版）');
  const center = render('plan-cards', withOpts({ introAlign: 'center' }, { highlights: [] }));
  check(!center.includes('data-part="highlights"'), 'introAlign=center 且 highlights 为空 ⟹ DOM 里没有 highlights 节点（图册那次的回归）');
  // 只认第一个 featured：两个都写 true 时页面上只亮一张（validateSite 另外拦）。
  const two = clone(THREE); two.plans[0].featured = true;
  check(count(render('plan-cards', two), 'pr-plan pr-featured') === 1, '两个 featured:true ⟹ 页面只亮第一个（校验另外报错）');
  check(count(render('plan-cards', { ...clone(DEMO) }), 'data-part="plan"') === 4, `演示内容 6 条 ⟹ 只画前 4 条（maxItems ${M.slots.plans.maxItems}）`);
  const per = plansOf(full).map((p) => count(p, '<svg'));
  check(per.every((n, i) => n === THREE.plans[i].features.length), `勾号是内联 SVG、每行一个（${per.join(' / ')}）`);
  check(count(render('plan-cards', clone(THREE), {}), '<svg') === 0, '对照：不给图标表 ⟹ 一个 <svg> 都没有');
  check(JSON.stringify(icons.BLOCK_ICONS['pricing']) === '["check"]' && icons.usesIconTable('pricing'), "BLOCK_ICONS['pricing'] == ['check']");
  check(THREE.highlights.every((x) => TABLE[x.icon]), 'highlights 的图标名由 iconNamesIn 收进了图标表');
}

// ══ AC7（点 Yearly 换价）：组件真在切 ══════════════════════════════════════════════════════════════
console.log('\n── AC7 点 Yearly');
{
  // 用一个会记下 setState 的 React 替身不划算；这里判数据面：组件读 price.yearly、按 yearly 状态选价（源码里的那一行）。
  const src = fs.readFileSync(SECTION, 'utf-8');
  check(/const shown = yearly && str\(price\.yearly\) \? str\(price\.yearly\) : str\(price\.monthly\)/.test(src) && /onClick=\{\(\) => setYearly\(true\)\}/.test(src),
    '点 Yearly ⟹ setYearly(true) ⟹ 每个套餐显示 price.yearly（没填 yearly 的那档照旧显示月付）；真点击在 e2e');
}

// ══ AC8：validateSite + 声明检查 ══════════════════════════════════════════════════════════════════
console.log('\n── AC8 validateSite');
{
  const plan = (i, extra = {}) => ({ name: `Plan ${i}`, price: { monthly: `$${i}` }, period: '/ month', features: ['a'], ...extra });
  const v = (data, shape = 'plan-cards') => own(manifestLib.validateSite({
    pages: [{ slug: 'p', blocks: [{ type: 'pricing', shape, data: { headline: 'H', ...data } }] }], scope: 'edit',
  }));
  for (const n of [0, 5]) {
    const r = v({ plans: Array.from({ length: n }, (_, i) => plan(i)) });
    check(r.length >= 1 && r.some((p) => p.includes('plans') && p.includes(n ? '最多只能有 4 项' : '至少要 1 项')), `plans ${n} 个 ⟹ 报一条、点名 plans`, JSON.stringify(r));
  }
  for (const n of [1, 4]) {
    const r = v({ plans: Array.from({ length: n }, (_, i) => plan(i)) });
    check(r.length === 0, `plans ${n} 个 ⟹ 放行`, JSON.stringify(r));
  }
  const r2 = v({ plans: [plan(1, { featured: true }), plan(2, { featured: true })] });
  check(r2.length === 1 && r2[0].includes('plans') && r2[0].includes('featured'), '两个 featured: true ⟹ 报一条、点名 plans', JSON.stringify(r2));
  check(v({ plans: [plan(1, { featured: true }), plan(2)] }).length === 0, '对照：一个 featured ⟹ 放行');
  const hl = (n) => Array.from({ length: n }, (_, i) => ({ icon: 'clock', title: `T${i}`, text: 'x' }));
  const r3 = v({ plans: [plan(1)], highlights: hl(5) });
  check(r3.length === 1 && r3[0].includes('highlights') && r3[0].includes('最多只能有 4 项'), 'highlights 5 条 ⟹ 报一条', JSON.stringify(r3));
  check(v({ plans: [plan(1)], highlights: hl(4) }).length === 0, '对照：highlights 4 条 ⟹ 放行');
  for (const p of M.presets) {
    const r = v({ ...clone(THREE), options: p.knobs, ...(p.colors ? clone(p.colors) : {}) }, p.shape);
    check(r.length === 0, `预设 ${p.name} 那组值 + 演示内容前三档 ⟹ 放行`, JSON.stringify(r));
  }
  const r4 = v({ plans: [plan(1)], featuredColor: 'red' });
  check(r4.length === 1 && r4[0].includes('featuredColor'), 'featuredColor 写成 "red" ⟹ 报一条（颜色槽同 bg 的校验）', JSON.stringify(r4));
  const { knobDeclarationProblems } = knobsLib;
  const bad1 = clone(M); bad1.presets[5].colors = { accent: '#ffffff', bg: RAINBOW, featuredColor: RAINBOW };
  check(knobDeclarationProblems(bad1).some((p) => p.includes('accent')), '预设 colors 写了不存在的槽 ⟹ knobDeclarationProblems 报一条');
  const bad2 = clone(M); bad2.presets[5].colors = { bg: 'purple', featuredColor: RAINBOW };
  check(knobDeclarationProblems(bad2).some((p) => p.includes('colors.bg')), '预设 colors 的值不合法（"purple"）⟹ 报一条');
}

// ══ AC10：block-roles · 首页配方池（不写死种数：姊妹票谁先落地都不红）══════════════════════════════════
console.log('\n── AC10 block-roles · 首页配方');
{
  const roles = JSON.parse(fs.readFileSync(path.join(SRC, 'lib', 'sections', 'block-roles.json'), 'utf-8'));
  check(roles['pricing'] === M.roleDefault, `block-roles.json 的 pricing（${roles['pricing']}）== manifest roleDefault（${M.roleDefault}）`);
  const recipe = require(path.join(NEXT, 'scripts', 'lib', 'homepage-recipe.js'));
  const all = manifestLib.loadManifests();
  const pool = recipe.poolFor(all);
  // 📌 #1425（T3）—— 这里原来测「pricing-table 在 NOT_IN_POOL、种数 == 合入前且 pricing 原位顶掉它、拿掉它两个都进池、order == 它的、200 个配方不同时硬要两个、它在 block-roles 里仍 optional」；pricing-table 随旧库删了。
  // 🔴 #1670 —— 不变量反过来了：pricing **不在**配方池里（建站时没有价格，抽中它的站首页被钉一块写着「Contact Us」的价格块）。
  //    它仍在首页组里（prompt.group 见下一格）—— AI 自己在首页其余位置放不放，按 manifest 那行提示词判断。种数现算，不写死。
  const wantLen = [...all.values()].filter((m) => m.prompt && m.prompt.group === 'homepage' && !(m.type in recipe.NOT_IN_POOL)).length;
  check(!pool.includes('pricing') && ('pricing' in recipe.NOT_IN_POOL) && pool.length === wantLen, `poolFor 不含 pricing、pricing 在 NOT_IN_POOL、池子 ${wantLen} 种（现算；读到 ${pool.length}）`);
  // 反向对照：把 pricing 从排除名单拿掉 ⟹ 它进池、种数 +1 —— 判据分得开。
  const saved = recipe.NOT_IN_POOL['pricing'];
  delete recipe.NOT_IN_POOL['pricing'];
  let inPool;
  try { inPool = recipe.poolFor(all); } finally { recipe.NOT_IN_POOL['pricing'] = saved; }
  check(inPool.includes('pricing') && inPool.length === pool.length + 1, `反向对照：拿掉排除项 ⟹ pricing 进池、种数 ${pool.length} → ${inPool.length}（+1）`);
  check(M.prompt && M.prompt.group === 'homepage', 'prompt.group == homepage');
  const lines = M.prompt.lines.join('\n');
  check(/1–4/.test(lines) && /ONE plan has featured/.test(lines) && /price\.yearly/.test(lines) && /billing/.test(lines)
    && /top-level in data \(not inside options\)/.test(lines) && /(invent|real prices)/.test(lines),
  'prompt.lines：plans 1–4、编不出真价格就别放、最多一个 featured、有年付才填 price.yearly / billing、bg / featuredColor 在 data 顶层');
  const edit = fs.readFileSync(path.join(NEXT, 'scripts', 'edit-site.js'), 'utf-8');
  check(/Available section types:[^\n]*\bpricing\b/.test(edit) && /\*\*pricing\*\* block → \\?`data\.proof\.avatars\[\]\.imageUrl\\?` \/ \\?`data\.logos\.items\[\]\.imageUrl/.test(edit),
    'edit-site.js：Available section types 有 pricing；## Images 段写着它的两个图片字段');
  const pool2 = JSON.parse(fs.readFileSync(path.join(NEXT, 'scripts', 'theme-pool.json'), 'utf-8'));
  const shapes = Object.fromEntries(Object.entries(pool2).map(([id, t]) => [id, t && t.shapes ? t.shapes['pricing'] : undefined]));
  check(shapes['ember-12'] === 'side-intro' && shapes['azure-29'] === 'plan-cards', `theme-pool：ember-12 → side-intro、azure-29 → plan-cards（${JSON.stringify(shapes)}）`);
}

// ══ AC12（编辑器 schema 一半；往返无损由 editor-roundtrip.test.js 对全部页面块量）═══════════════════════
console.log('\n── AC12 编辑器 schema');
{
  const { editorSchema } = require(path.join(NEXT, 'scripts', 'lib', 'editor-schema.js'));
  const on = editorSchema({}).components.find((c) => c.type === 'pricing');
  check(!!on, 'Puck 组件里有 pricing（能从左栏拖进页面）');
  const order = on.fields.map((f) => f.slot);
  check(JSON.stringify(order) === JSON.stringify(['options', 'introEyebrow', 'headline', 'body', 'highlights', 'proof', 'logos', 'billing', 'plans', 'bg', 'featuredColor']),
    `字段顺序 = 旋钮 → 眉标 → 块头 → 部件 → plans → 两个颜色（${order.join(' → ')}）`);
  const pl = on.fields.find((f) => f.slot === 'plans');
  check(pl.control === 'list' && ['name', 'description', 'period', 'badge'].every((s) => pl.subs.some((x) => x.sub === s)), `plans 是列表字段、每条可改 name / description / period / badge（${pl.subs.map((x) => x.sub).join(' / ')}）`);
  const opt = on.fields[0];
  check(opt.control === 'options' && opt.presets.find((p) => p.name === 'Rainbow').colors
    && JSON.stringify(opt.colorSlots) === JSON.stringify(['bg', 'featuredColor']), 'options 字段带着 Rainbow 的 colors 和归预设管的颜色槽（点 Rainbow 颜色跟着变）');
  check(on.fields.filter((f) => f.control === 'color').map((f) => f.slot).join() === 'bg,featuredColor', '两个颜色字段 bg / featuredColor，都是色板控件');
}

// 📌 #1425（T3）—— 这里原来测 AC13「pricing-table 目录、hero / cta / footer / header manifest 相对 merge-base 零改动」；pricing-table 与旧 hero / footer / header 随旧库删了，cta 改回正名后换了一份（本票按设计改）。

console.log(`\n${fail ? '❌' : '✅'} pricing-render: ${pass} 过 / ${fail} 不过`);
process.exit(fail ? 1 : 0);
