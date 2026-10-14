#!/usr/bin/env node
/**
 * thumb-media.test.js — Design 面板顶栏 / 页脚缩略图里的媒体查询按 W 求值（#1764）。
 * 跑法: node scripts/lib/thumb-media.test.js（或 npm run test:scripts）· 退出码 0 全过 · 1 有失败
 * 真浏览器那一半（画布 document 的真样式表、窗口 1366 下缩略图画成宽屏、画布上的真顶栏不变）在
 * tests/e2e/specs/1764-editor-region-thumb-wide.spec.ts。这里量纯函数，和 applyThumbMedia 在一份假 CSSOM 上改了什么。
 */
'use strict';
const { THUMB_WIDE_MARK, matchesAtWidth, prefixSelectors, suffixSelectors, applyThumbMedia } = require('./thumb-media');

let pass = 0; let fail = 0;
const eq = (got, want, name) => {
  const g = JSON.stringify(got); const w = JSON.stringify(want);
  if (g === w) { pass += 1; console.log(`  ✅ ${name}`); } else { fail += 1; console.log(`  ❌ ${name} —— 读到 ${g}，要 ${w}`); }
};
const M = THUMB_WIDE_MARK;
const S = `:where([${M}])`;
const X = `:where(:not([${M}] *))`;

console.log('matchesAtWidth');
eq(matchesAtWidth('(min-width: 992px)', 1024), true, '992 起 · 1024 ⟹ 成立');
eq(matchesAtWidth('(min-width: 992px)', 961), false, '992 起 · 961 ⟹ 不成立（窗口 1366 的画布宽）');
eq(matchesAtWidth('(max-width: 991.98px)', 1024), false, '991.98 以下 · 1024 ⟹ 不成立');
eq(matchesAtWidth('(min-width: 768px) and (max-width: 991.98px)', 1024), false, 'and 两条都要成立');
eq(matchesAtWidth('(min-width: 768px) and (max-width: 991.98px)', 800), true, 'and 两条都成立');
eq(matchesAtWidth('(min-width: 1200px)', 1024), false, '1200 起 · 1024 ⟹ 不成立（窗口再宽也一样）');
eq(matchesAtWidth('(min-width: 1024px)', 1024), true, '边界含等号');
eq(matchesAtWidth('(min-width: 64em)', 1024), true, 'em 按 16px');
eq(matchesAtWidth('screen and (min-width: 992px)', 1024), true, '带媒体类型 screen');
eq(matchesAtWidth('print and (min-width: 1px)', 1024), false, 'print 不成立');
eq(matchesAtWidth('(max-width: 500px), (min-width: 992px)', 1024), true, '逗号 = 或');
eq(matchesAtWidth('(width >= 992px)', 1024), true, '范围写法');
eq(matchesAtWidth('(hover: hover) and (pointer: fine)', 1024), undefined, '跟宽无关 ⟹ undefined（原样不动）');
eq(matchesAtWidth('(prefers-reduced-motion: reduce)', 1024), undefined, 'prefers-reduced-motion ⟹ undefined');
eq(matchesAtWidth('not all and (min-width: 992px)', 1024), null, 'not ⟹ 读不懂（null，原样不动）');
eq(matchesAtWidth('(min-device-width: 992px)', 1024), null, 'device-width ⟹ null');
eq(matchesAtWidth('(min-width: 50vw)', 1024), null, '别的单位 ⟹ null');

console.log('prefixSelectors（副本：只在缩略图里生效）');
eq(prefixSelectors('[data-block="header"] .navbar > .hdr-grid'), `${S} [data-block="header"] .navbar > .hdr-grid`, '普通选择器前面加一层');
eq(prefixSelectors('.a, .b::before'), `${S} .a,${S} .b::before`, '逗号逐个加');
eq(prefixSelectors(':is(.a, .b) .c'), `${S} :is(.a, .b) .c`, '括号里的逗号不拆');
eq(prefixSelectors('[title="x, y"] .c'), `${S} [title="x, y"] .c`, '引号里的逗号不拆');
eq(prefixSelectors(':root'), S, ':root 换成缩略图那一层自己');
eq(prefixSelectors('html'), S, 'html 同上');
eq(prefixSelectors('body .x'), `${S} .x`, 'body 开头去掉再加');
eq(prefixSelectors('html body > .x'), `${S} .x`, 'html body > 连着去掉');
eq(prefixSelectors('.htmlish'), `${S} .htmlish`, '类名里含 html 不当成 html');

console.log('suffixSelectors（原规则：缩略图里不再生效）');
eq(suffixSelectors('.a .b'), `.a .b${X}`, '尾巴上加');
eq(suffixSelectors('.a, .b'), `.a${X},.b${X}`, '逗号逐个加');
eq(suffixSelectors('.a::before'), `.a${X}::before`, '伪元素前面插');
eq(suffixSelectors('.a:after'), `.a${X}:after`, '老写法伪元素前面插');
eq(suffixSelectors('.a:hover'), `.a:hover${X}`, '伪类后面照常加');
eq(suffixSelectors('.a:not(.b::x)'), `.a:not(.b::x)${X}`, '括号里的 :: 不算');
eq(suffixSelectors('.row > *'), `.row > *${X}`, '以 * 结尾');

console.log('applyThumbMedia（假 CSSOM）');
const style = (sel, css) => ({ selectorText: sel, style: { cssText: css } });
const group = (props, rules) => {
  const g = { ...props, cssRules: rules, inserted: [] };
  g.insertRule = (text, i) => { g.inserted.push({ text, i }); rules.splice(i, 0, { inserted: text }); return i; };
  return g;
};
const media = (cond, rules) => group({ media: { mediaText: cond }, conditionText: cond }, rules);
const base = style('.a', 'color: red;');
const wide = media('(min-width: 992px)', [style('[data-block="header"] .navbar > .hdr-grid', 'display: grid !important;'), style(':root', '--x: 1;')]);
const narrow = media('(max-width: 991.98px)', [style('.hdr-compact', 'display: flex;')]);
const hover = media('(hover: hover)', [style('.b:hover', 'color: blue;')]);
const xl = media('(min-width: 1200px)', [style('.c', 'width: 1140px;')]);
const sheet = group({}, [base, wide, narrow, hover, xl]);
const crossOrigin = { get cssRules() { throw new Error('SecurityError'); } };
applyThumbMedia({ styleSheets: [crossOrigin, sheet] }, 1024);
eq(base.selectorText, '.a', '媒体查询外面的规则不动');
eq(hover.cssRules[0].selectorText, '.b:hover', '跟宽无关的媒体查询不动');
eq(wide.cssRules.map((r) => r.selectorText), [`[data-block="header"] .navbar > .hdr-grid${X}`, `:root${X}`], '992 起那一组：原规则在缩略图里不再生效');
eq(narrow.cssRules[0].selectorText, `.hdr-compact${X}`, '991.98 以下那一组：原规则在缩略图里不再生效');
eq(xl.cssRules[0].selectorText, `.c${X}`, '1200 起那一组：原规则在缩略图里不再生效');
eq(sheet.inserted, [{ text: `@media all{${S} [data-block="header"] .navbar > .hdr-grid{display: grid !important;}${S}{--x: 1;}}`, i: 2 }],
  '只给 1024 下成立的那一组插副本，紧跟在原规则后面（!important 带过去）');
const before = JSON.stringify(sheet.cssRules.map((r) => r.selectorText || r.inserted || r.conditionText));
applyThumbMedia({ styleSheets: [sheet] }, 1024);
eq(JSON.stringify(sheet.cssRules.map((r) => r.selectorText || r.inserted || r.conditionText)), before, '同一张表第二次调用不再改（幂等）');
eq(sheet.inserted.length, 1, '第二次调用不再插副本');

const nested = media('(min-width: 768px)', [media('(prefers-reduced-motion: reduce)', [style('.d', 'transition: none;')])]);
const sheet2 = group({}, [nested]);
applyThumbMedia({ styleSheets: [sheet2] }, 1024);
eq(nested.cssRules[0].cssRules[0].selectorText, `.d${X}`, '套在里面的规则也排除');
eq(sheet2.inserted[0] && sheet2.inserted[0].text, `@media all{@media (prefers-reduced-motion: reduce){${S} .d{transition: none;}}}`, '副本里保留跟宽无关的那层条件');

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
