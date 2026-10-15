'use strict';

// ══════════════════════════════════════════════════════════════════════════════════════════════════
// thumb-media.js —— Design 面板里顶栏 / 页脚的缩略图按「窗口 W 宽」求值媒体查询（#1764）
// ══════════════════════════════════════════════════════════════════════════════════════════════════
//
// 缩略图画在画布 iframe 的 document 里（EditorApp §DesignPopover 用 portal），而媒体查询按【画布的视口宽】求值，
// 跟缩略图那一层排版宽多少无关 ⟹ 画布窄于 992 时缩略图里画的是窄屏顶栏（菜单收起、各张几乎一样）。
// 这里把画布 document 的样式表在内存里改一遍（CSSOM，不碰盘上文件、不碰线上网站），让挂了 MARK 的那一层里面
// 「跟宽有关的媒体查询」一律按 W 求值，外面照旧按画布宽：
//   · 原规则：每个选择器尾巴上加 `:where(:not([MARK] *))` ⟹ 在 MARK 里面不再生效；外面匹配到的元素、特异度都不变
//   · 紧跟在原规则后面插一份副本（同一张表、同一个位置 ⟹ 层叠顺序不变）：按 W 求值为真才插，选择器前面加
//     `:where([MARK])`（特异度 +0）。`:root` / `html` / `body` 开头的换成 MARK 那一层自己（变量、继承的字号落到它身上）。
// 🔴 不用 iframe 装缩略图：e2e（1738 那份）和格子的点选都直接在画布 document 里读缩略图的 DOM，搬进 iframe 就读不到了。
// 🔴 不改成 container query：顶栏收不收起除了 block.css 那一条，还靠 Webpixels 的 `d-lg-*` 工具类，那样就改到线上网站了。
// 已知不管：vw / vh 单位仍按画布算；`[dir=rtl] …` 这种挂在根上的复合选择器在副本里配不上（缩略图里少一点 RTL 细节）。
//
// 纯函数部分（matchesAtWidth / prefixSelectors / suffixSelectors）不碰 DOM，`thumb-media.test.js` 直接测；
// applyThumbMedia 只用 CSSOM 的几个成员（cssRules / insertRule / selectorText / style.cssText / conditionText），
// 判规则种类不用 instanceof —— 编辑器代码跑在外层窗口，画布 document 的 CSSMediaRule 是 iframe 里那个窗口的构造函数。

const MARK = 'data-editor-thumb-wide';
const SCOPE = `:where([${MARK}])`;
const EXCLUDE = `:where(:not([${MARK}] *))`;

/** 在第 0 层（不在括号 / 方括号 / 引号里）上的位置逐个回调；返回 true 就停。 */
function scanTop(s, fn) {
  let depth = 0; let quote = '';
  for (let i = 0; i < s.length; i += 1) {
    const ch = s[i];
    if (ch === '\\') { i += 1; continue; }
    if (quote) { if (ch === quote) quote = ''; continue; }
    if (ch === '"' || ch === "'") { quote = ch; continue; }
    if (ch === '(' || ch === '[') { depth += 1; continue; }
    if (ch === ')' || ch === ']') { depth -= 1; continue; }
    if (depth === 0 && fn(ch, i)) return;
  }
}

function splitTop(s, sep) {
  const out = []; let from = 0;
  scanTop(s, (ch, i) => { if (ch === sep) { out.push(s.slice(from, i)); from = i + 1; } return false; });
  out.push(s.slice(from));
  return out.map((x) => x.trim()).filter(Boolean);
}

const LEGACY_PSEUDO_EL = /^:(before|after|first-line|first-letter)(?![\w-])/i;

/** 选择器里伪元素开始的位置（`::x` 或老写法 `:before`），没有就是 -1 —— 伪元素后面不能再接伪类，排除条件要插在它前面。 */
function pseudoElementAt(s) {
  let at = -1;
  scanTop(s, (ch, i) => {
    if (ch !== ':') return false;
    if (s[i + 1] === ':' || LEGACY_PSEUDO_EL.test(s.slice(i))) { at = i; return true; }
    return false;
  });
  return at;
}

function suffixOne(s) {
  const at = pseudoElementAt(s);
  return at < 0 ? s + EXCLUDE : s.slice(0, at) + EXCLUDE + s.slice(at);
}

function prefixOne(s) {
  const rest = s.replace(/^(?:(?::root|html|body)(?![\w-])\s*>?\s*)+/i, '');
  if (rest === s) return `${SCOPE} ${s}`;
  return rest ? `${SCOPE} ${rest}` : SCOPE;
}

/** 原规则的选择器：MARK 里面不再生效。 */
function suffixSelectors(list) { return splitTop(list, ',').map(suffixOne).join(','); }
/** 副本的选择器：只在 MARK 里面生效。 */
function prefixSelectors(list) { return splitTop(list, ',').map(prefixOne).join(','); }

function toPx(n, unit) {
  const v = Number(n);
  if (!Number.isFinite(v)) return null;
  if (unit === 'px') return v;
  if (unit === 'em' || unit === 'rem') return v * 16;
  return null;
}

/**
 * 一个媒体条件在视口宽 = w 时成不成立。
 *   undefined —— 跟宽无关（hover、prefers-reduced-motion…），原样不动
 *   null      —— 跟宽有关但读不懂（`not …`、device-width、别的单位），原样不动
 *   true / false
 */
function matchesAtWidth(cond, w) {
  const text = String(cond || '').trim().toLowerCase();
  if (!text.includes('width')) return undefined;
  if (text.includes('device-width')) return null;
  let any = false;
  for (const q of splitTop(text, ',')) {
    let all = true;
    for (const raw of q.split(/\s+and\s+/)) {
      const part = raw.trim();
      if (part === 'all' || part === 'screen' || part === 'only screen') continue;
      if (part === 'print') { all = false; continue; }
      let m = /^\((min|max)-width\s*:\s*([\d.]+)(px|em|rem)\)$/.exec(part);
      if (m) {
        const px = toPx(m[2], m[3]);
        if (px === null) return null;
        if (m[1] === 'min' ? w < px : w > px) all = false;
        continue;
      }
      m = /^\(width\s*(>=|<=|>|<)\s*([\d.]+)(px|em|rem)\)$/.exec(part);
      if (m) {
        const px = toPx(m[2], m[3]);
        if (px === null) return null;
        const ok = m[1] === '>=' ? w >= px : m[1] === '<=' ? w <= px : m[1] === '>' ? w > px : w < px;
        if (!ok) all = false;
        continue;
      }
      return null;
    }
    if (all) any = true;
  }
  return any;
}

const isStyle = (r) => typeof r.selectorText === 'string' && !!r.style;
const isMedia = (r) => !!r.media && typeof r.conditionText === 'string';
// 跨窗口也成立：toString 读的是 Symbol.toStringTag（「CSSSupportsRule」），不是构造函数。
const isSupports = (r) => Object.prototype.toString.call(r) === '[object CSSSupportsRule]';
const isGroup = (r) => !!r.cssRules && typeof r.insertRule === 'function';

/** 一组规则在 W 下、只给 MARK 里面用的副本（文本）。 */
function scopedText(rules, w) {
  let out = '';
  for (const r of Array.from(rules)) {
    if (isStyle(r)) {
      if (!r.selectorText.includes(MARK)) out += `${prefixSelectors(r.selectorText)}{${r.style.cssText}}`;
    } else if (isMedia(r)) {
      const v = matchesAtWidth(r.conditionText, w);
      if (v === undefined) { const inner = scopedText(r.cssRules, w); if (inner) out += `@media ${r.conditionText}{${inner}}`; }
      else if (v) out += scopedText(r.cssRules, w);
    } else if (isSupports(r)) {
      const inner = scopedText(r.cssRules, w);
      if (inner) out += `@supports ${r.conditionText}{${inner}}`;
    }
  }
  return out;
}

function exclude(rules) {
  for (const r of Array.from(rules)) {
    if (isStyle(r)) {
      if (!r.selectorText.includes(MARK)) r.selectorText = suffixSelectors(r.selectorText);
    } else if (isGroup(r)) exclude(r.cssRules);
  }
}

function processGroup(group, w) {
  for (let i = group.cssRules.length - 1; i >= 0; i -= 1) {
    const r = group.cssRules[i];
    if (isMedia(r)) {
      const v = matchesAtWidth(r.conditionText, w);
      if (v === undefined) { processGroup(r, w); continue; }
      if (v === null) continue;
      const copy = v ? scopedText(r.cssRules, w) : '';
      exclude(r.cssRules);
      if (copy) {
        try { group.insertRule(`@media all{${copy}}`, i + 1); } catch { /* 副本里有浏览器不收的写法：这一条缩略图少一点样式，画布不受影响 */ }
      }
    } else if (isGroup(r) && !isStyle(r)) processGroup(r, w);
  }
}

const done = new WeakMap();

/**
 * 把 doc 里还没处理过的样式表改一遍（见文件头）。幂等：每张表只处理一次（记在 WeakMap 里，热更新换掉的表是新对象，会再处理）。
 * 跨域的表读不了 cssRules，跳过（Google Fonts 那种，里面没有按宽的规则）。
 * 🔴 每张表按第一次调用时的 w 处理，之后换 w 不重算 —— 调用方只用一个常数（EditorApp 的 REGION_THUMB_LAYOUT_W）。
 */
function applyThumbMedia(doc, w) {
  for (const sheet of Array.from(doc.styleSheets || [])) {
    if (done.has(sheet)) continue;
    let rules;
    try { rules = sheet.cssRules; } catch { done.set(sheet, w); continue; }
    if (!rules) continue;
    done.set(sheet, w);
    processGroup(sheet, w);
  }
}

module.exports = { THUMB_WIDE_MARK: MARK, matchesAtWidth, prefixSelectors, suffixSelectors, applyThumbMedia };
