#!/usr/bin/env node
/**
 * density-padding.test.js — 主题设置的 density（留白）三档必须产出不同的段落上下留白（#1541）。
 *
 *   node scripts/density-padding.test.js     （由 `npm run test:scripts` 自动发现）
 *   退出码: 0 全过 · 1 有失败 · 2 跑不起来（**不许当成通过**）
 *
 * ── 为什么要有它 ────────────────────────────────────────────────────────────────────────────────
 * density 这一维只有一个落点：`globals.css` 的 `.section-padding`。#1426（T4）重写博客两页时，用它的那两处
 * markup 没了 ⟹ 三档照样写进 theme.css、规则照样在，却没有任何元素吃它，三档产出一模一样的页面 ——
 * 不报错、不红，直到有人问「换主题怎么留白没变」。这一格把那条链从头到尾接起来判，任何一环断了都红：
 *
 *   ① 表：`theme-settings.js` 的 DENSITY 三档 → `settingsToCssVars()` 写出的 `--section-*`
 *   ② 规则：`globals.css` 的 `.section-padding`（含 @media）用这些变量排上下留白
 *   ③ markup：段落外壳 `BlockSection` 默认就挂这个类；自己传 class 的块也得挂（或者在下面的 OWN_PADDING 里写明理由）
 *
 * 「量」是按 CSS 的写法把变量代进规则里算出来的（base 与每个 min-width 断点各一个读数），不开浏览器 ——
 * 浏览器那一侧的实测在 #1541 的交付里（真页面三档读数）。这里要的是 CI 每次都跑、几秒内出结论。
 *
 * 🔴 每一格都带反向对照（同一进程、单变量）：三档值改成一样 · 规则删掉 · 外壳不挂类 —— 必须当场红。
 */

'use strict';

const fs = require('fs');
const path = require('path');
const postcss = require('postcss');
const ts = require('typescript');
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');

const NEXT = path.resolve(__dirname, '..');
const GLOBALS = path.join(NEXT, 'src', 'app', 'globals.css');
const SHELL = path.join(NEXT, 'src', 'components', 'BlockSection.tsx');
const BLOCKS = path.join(NEXT, 'blocks');
const CLASS = 'section-padding';

// 自己传 class、而且【有意】不挂 `section-padding` 的块 —— 每一个都要写理由。
const OWN_PADDING = {
  'page-header': '页头横幅的上下留白是自己那套（`blocks/page-header/block.css` 的 `.phn`：3.5 / 5 / 8rem），不是段落留白',
  logos: 'logo 条是窄段，设计稿就是 `py-12 py-lg-16`（比段落留白小一档）；要它也跟 density 走得另起一档变量，不在 #1541',
};

let pass = 0;
let fail = 0;
const ok = (m) => { pass += 1; console.log(`  ✅ ${m}`); };
const bad = (m) => { fail += 1; console.log(`  ❌ ${m}`); };
const die = (m) => { console.error(`🔴 跑不起来: ${m}`); process.exit(2); };

const { DENSITY, settingsToCssVars } = require('./theme-settings.js');

// ── ② 规则：从 globals.css 取出 `.section-padding` 的上下留白，按断点排好 ────────────────────────
/** → [{ minWidth, top, bottom }]，minWidth=0 是不在 @media 里的那条。 */
function paddingRules(cssText) {
  const out = [];
  postcss.parse(cssText).walkRules((rule) => {
    if (!rule.selectors.includes(`.${CLASS}`)) return;
    let minWidth = 0;
    if (rule.parent && rule.parent.type === 'atrule') {
      const m = /^\(\s*min-width:\s*(\d+)px\s*\)$/.exec(rule.parent.params.trim());
      if (!m) return; // 别的 @media 形状不在这道检查的模型里 —— 不收，下面「一条都没有」会红
      minWidth = Number(m[1]);
    }
    const r = { minWidth, top: null, bottom: null };
    rule.walkDecls((d) => {
      const v = d.value.replace(/\s*!important\s*$/, '').trim();
      if (d.prop === 'padding-top' || d.prop === 'padding-block-start') r.top = v;
      if (d.prop === 'padding-bottom' || d.prop === 'padding-block-end') r.bottom = v;
      if (d.prop === 'padding' || d.prop === 'padding-block') {
        const parts = v.split(/\s+/);
        r.top = parts[0];
        r.bottom = d.prop === 'padding-block' ? (parts[1] || parts[0]) : (parts[2] || parts[0]);
      }
    });
    if (r.top || r.bottom) out.push(r);
  });
  return out.sort((a, b) => a.minWidth - b.minWidth);
}

/** 把 `var(--x)` 代成这一档的值；代不出来就返回 null（算「没量到」）。 */
function resolve(value, vars) {
  if (value == null) return null;
  const m = /^var\(\s*(--[A-Za-z0-9-]+)\s*(?:,\s*([^)]+))?\)$/.exec(value);
  if (!m) return value;
  return vars[m[1]] ?? (m[2] ? m[2].trim() : null);
}

/** 一份风格设定在每个断点上的上下留白读数 → 'top/bottom@0 · top/bottom@992' 这种串。 */
function reading(settings, rules, rootVars) {
  const vars = { ...rootVars };
  for (const decl of settingsToCssVars(settings)) {
    const m = /^(--[A-Za-z0-9-]+)\s*:\s*(.+?);$/.exec(decl);
    if (m) vars[m[1]] = m[2].trim();
  }
  // 断点之间是层叠的：上一档声明了、这一档没声明的那一边照旧。
  let top = null; let bottom = null;
  const parts = [];
  for (const r of rules) {
    if (r.top) top = resolve(r.top, vars);
    if (r.bottom) bottom = resolve(r.bottom, vars);
    parts.push(`${top}/${bottom}@${r.minWidth}`);
  }
  return parts.join(' · ');
}

function rootVarsOf(cssText) {
  const out = {};
  postcss.parse(cssText).walkRules(':root', (rule) => {
    rule.walkDecls(/^--section-/, (d) => { out[d.prop] = d.value.trim(); });
  });
  return out;
}

const rem = (s) => { const m = /^([\d.]+)rem$/.exec(s || ''); return m ? Number(m[1]) : NaN; };

/** 判 ①+②：返回问题清单（空 = 过）。`table` 是 DENSITY 那张表，`cssText` 是 globals.css。 */
function judgeChain(table, cssText, quiet = false) {
  const problems = [];
  const rules = paddingRules(cssText);
  if (!rules.length) return [`globals.css 里没有一条 \`.${CLASS}\` 管上下留白 —— density 没有落点`];
  const rootVars = rootVarsOf(cssText);
  const tiers = ['compact', 'standard', 'airy'];
  const reads = {};
  for (const t of tiers) {
    if (!table[t]) { problems.push(`DENSITY 没有 ${t} 这一档`); continue; }
    reads[t] = reading({ density: t }, rules, rootVars);
    if (/null/.test(reads[t])) problems.push(`${t}: 有一侧的上下留白代不出值（${reads[t]}）`);
  }
  if (problems.length) return problems;
  for (let i = 0; i < tiers.length; i++) {
    for (let j = i + 1; j < tiers.length; j++) {
      if (reads[tiers[i]] === reads[tiers[j]]) problems.push(`${tiers[i]} 与 ${tiers[j]} 量出来一样：${reads[tiers[i]]}`);
    }
  }
  // 顺序 compact < standard < airy：每个断点、上下两侧都要成立。
  const nums = (s) => s.split(' · ').map((p) => p.split('@')[0].split('/').map(rem));
  const [c, s, a] = tiers.map((t) => nums(reads[t]));
  for (let k = 0; k < c.length; k++) {
    for (let side = 0; side < 2; side++) {
      if (!(c[k][side] < s[k][side] && s[k][side] < a[k][side])) {
        problems.push(`第 ${k + 1} 个断点${side ? '下' : '上'}留白不是 compact < standard < airy：${c[k][side]} / ${s[k][side]} / ${a[k][side]}`);
      }
    }
  }
  // 数值形状（池里的主题今天都是这种）：两个不同的系数也必须量出两个不同的读数。
  const n1 = reading({ radius: 4, density: 0.85 }, rules, rootVars);
  const n2 = reading({ radius: 4, density: 1.2 }, rules, rootVars);
  if (n1 === n2) problems.push(`数值形状 density 0.85 与 1.2 量出来一样：${n1}`);
  if (!problems.length && !quiet) {
    console.log(`     compact  ${reads.compact}\n     standard ${reads.standard}\n     airy     ${reads.airy}`);
    console.log(`     数值 0.85 ${n1}\n     数值 1.2  ${n2}`);
  }
  return problems;
}

// ── ③ markup：外壳渲染出来的 <section> 挂没挂这个类 ───────────────────────────────────────────
const sourceOverride = new Map();
for (const ext of ['.tsx', '.ts']) {
  require.extensions[ext] = (mod, filename) => mod._compile(ts.transpileModule(sourceOverride.get(filename) ?? fs.readFileSync(filename, 'utf-8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true },
  }).outputText, filename);
}
const origResolve = require('module')._resolveFilename;
require('module')._resolveFilename = function (request, ...rest) {
  if (request.startsWith('@/')) {
    const base = path.join(NEXT, 'src', request.slice(2));
    for (const ext of ['', '.ts', '.tsx', '.js']) if (fs.existsSync(base + ext) && fs.statSync(base + ext).isFile()) return base + ext;
  }
  return origResolve.call(this, request, ...rest);
};

function shellClass(src) {
  if (src != null) sourceOverride.set(SHELL, src); else sourceOverride.delete(SHELL);
  delete require.cache[SHELL];
  const Shell = require(SHELL).default;
  const html = renderToStaticMarkup(React.createElement(Shell, { type: 'probe' }, 'x'));
  const m = /^<section\b[^>]*\bclass="([^"]*)"/.exec(html);
  return m ? m[1].split(/\s+/) : null;
}

/**
 * 每个块的 Section.tsx 里传给 <BlockSection 的 className —— 不挂 CLASS 又不在 OWN_PADDING 里的，报出来。
 * 用 TypeScript 的语法树找 <BlockSection> 自己那条 className 属性（不是它子元素的）。
 */
function blocksMissingClass(readSection) {
  const out = [];
  let seen = 0;
  for (const b of fs.readdirSync(BLOCKS).sort()) {
    const f = path.join(BLOCKS, b, 'Section.tsx');
    if (!fs.existsSync(f)) continue;
    const sf = ts.createSourceFile(f, readSection(b, f), ts.ScriptTarget.ES2020, true, ts.ScriptKind.TSX);
    const visit = (node) => {
      if ((ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) && node.tagName.getText(sf) === 'BlockSection') {
        seen += 1;
        const attr = node.attributes.properties.find((a) => ts.isJsxAttribute(a) && a.name.getText(sf) === 'className');
        if (attr) {
          const text = attr.initializer ? attr.initializer.getText(sf) : '';
          if (!new RegExp(`\\b${CLASS}\\b`).test(text) && !OWN_PADDING[b]) out.push(`${b}: className=${text}`);
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(sf);
  }
  if (!seen) out.push('一个 <BlockSection> 都没找到 —— 分母为 0，这一格不作数');
  return out;
}

try {
  const cssText = fs.readFileSync(GLOBALS, 'utf8');
  const shellSrc = fs.readFileSync(SHELL, 'utf8');

  console.log('① + ② density 三档 → --section-* → .section-padding 的上下留白');
  const p = judgeChain(DENSITY, cssText);
  if (!p.length) ok('三档两两不等、compact < standard < airy；数值形状两个系数也不等');
  else p.forEach((x) => bad(x));

  // 反向对照 A：三档的值改成一样（这正是「三档没区别」在表这一侧的样子）。原地改真表 —— settingsToCssVars
  // 查的就是这一个对象，所以走的是真翻译函数，不是这里另写的一份。
  const saved = { compact: DENSITY.compact, airy: DENSITY.airy };
  DENSITY.compact = DENSITY.standard; DENSITY.airy = DENSITY.standard;
  const flatProblems = judgeChain(DENSITY, cssText, true);
  Object.assign(DENSITY, saved);
  if (flatProblems.length) ok('反向对照 A：三档改成同一组值 ⟹ 红');
  else bad('反向对照 A 没红 —— 三档一样也判过，这道检查是瞎的');

  // 反向对照 B：规则删掉（落点被搬走）
  const noRule = cssText.replace(new RegExp(`\\.${CLASS}\\b`, 'g'), '.section-padding-gone');
  if (judgeChain(DENSITY, noRule, true).length) ok('反向对照 B：globals.css 里没有 .section-padding ⟹ 红');
  else bad('反向对照 B 没红 —— 规则没了也判过');

  // 反向对照 C：规则还在，但写死了长度（不再从变量取）
  const literal = cssText.replace(/var\(--section-y(Md)?\)/g, '4rem');
  if (judgeChain(DENSITY, literal, true).length) ok('反向对照 C：规则改成写死的 4rem ⟹ 红');
  else bad('反向对照 C 没红 —— 规则不吃变量也判过');

  console.log('③ 段落外壳与各块的 markup 挂着这个类');
  const cls = shellClass(null);
  if (cls && cls.includes(CLASS)) ok(`BlockSection 渲染出来的 <section class="${cls.join(' ')}">`);
  else bad(`BlockSection 渲染出来的 <section> 没挂 ${CLASS}：${JSON.stringify(cls)}`);

  // 反向对照 D：外壳默认 class 换回写死的 py-16 py-lg-24（#1541 之前的样子）
  const before = shellSrc.replace(/className = '[^']*'/, "className = 'position-relative py-16 py-lg-24'");
  if (before === shellSrc) bad('反向对照 D 造不出来 —— BlockSection 的默认 className 写法变了，改这里');
  else {
    const c2 = shellClass(before);
    if (c2 && !c2.includes(CLASS)) ok('反向对照 D：外壳默认 class 换回 py-16 py-lg-24 ⟹ 红');
    else bad('反向对照 D 没红');
  }
  shellClass(null);

  const miss = blocksMissingClass((b, f) => fs.readFileSync(f, 'utf8'));
  if (!miss.length) ok(`自己传 className 的块都挂了 ${CLASS}（有意不挂的：${Object.keys(OWN_PADDING).join(' · ')}）`);
  else miss.forEach((x) => bad(`${x} —— 没挂 ${CLASS}，density 管不到这个块；有意的话写进 OWN_PADDING 并写理由`));

  // 反向对照 E：hero 换回写死的 py-16 py-lg-24
  const missE = blocksMissingClass((b, f) => {
    const s = fs.readFileSync(f, 'utf8');
    return b === 'hero' ? s.replace(`position-relative ${CLASS}`, 'position-relative py-16 py-lg-24') : s;
  });
  if (missE.some((x) => x.startsWith('hero:'))) ok('反向对照 E：hero 换回 py-16 py-lg-24 ⟹ 红');
  else bad('反向对照 E 没红 —— 块的 className 扫不到');
} catch (e) {
  die(e && e.stack ? e.stack : String(e));
}

console.log(`\n${pass} 过 / ${fail} 不过`);
process.exit(fail ? 1 : 0);
