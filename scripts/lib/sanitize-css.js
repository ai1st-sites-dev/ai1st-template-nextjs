'use strict';
// #1839 (SiteAsData T4c) —— 冻结块容器上那串属性（Custom HTML 的 `attrs`）套回 `<section>` 之前的白名单（设计文档 §8.2 ③）。
//
//   sanitizeCss(style)         一段 `style="…"` 的值 → 只留安全的声明，拼回一个串（全清掉了 = 空串）
//   styleObject(style)         同上，但给 React：`{ backgroundColor: …, '--x': … }`
//   frozenContainerAttrs(a)    `attrs` 对象 → 能交给 React 的属性：只放行 `class`（→ className）、`style`（经上面两条）、`data-*`；
//                              别的一律丢（`onclick`、`href`、`id` …）。`data-block-id` 也丢：块的身份只认内容里那个 id。
//
// 🔴 为什么要有这一道：`attrs` 存在 content 里，老板能经保存 API 改（`POST /api/sites/:id/content` 收整份 content）。不过白名单
//    就套回容器 = 一个新的 XSS 入口（`onclick`，或 `style` 里 `url(javascript:…)` / `expression(…)`）。
// 🔴 声明级、按值判：只认一条声明里 `url(…)` 的目标是 http(s) 或站内路径（不带协议）；`expression(` / `-moz-binding` / `behavior`
//    / `@import` / 反斜杠转义（`j\61vascript:` 这种绕法的入口）出现在哪一条，那一条整条丢。宁可多丢一条样式，也不放一个脚本。
//    📌 不用 postcss：这份要跟着 Custom HTML 的 Section 进 dashboard 的画布包，属性值也不是一张样式表，切声明就够。

const DANGER = /expression\s*\(|-moz-binding|behavior\s*:|@import|javascript\s*:|vbscript\s*:|<|>/i;
const URL_RE = /url\s*\(\s*(['"]?)([^'")]*)\1\s*\)/gi;
const SAFE_URL = /^(https?:\/\/|\/|\.{0,2}\/|[a-z0-9_.-]+(\/|$))/i;
const PROP_RE = /^(--[a-zA-Z0-9_-]+|-?[a-zA-Z][a-zA-Z0-9-]*)$/;

const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

/** 按 `;` 切声明（引号、括号里的 `;` 不切）。 */
function splitDeclarations(text) {
  const out = [];
  let cur = '';
  let quote = '';
  let depth = 0;
  for (const ch of text) {
    if (quote) {
      cur += ch;
      if (ch === quote) quote = '';
      continue;
    }
    if (ch === '"' || ch === "'") quote = ch;
    else if (ch === '(') depth += 1;
    else if (ch === ')') depth = Math.max(0, depth - 1);
    else if (ch === ';' && depth === 0) { out.push(cur); cur = ''; continue; }
    cur += ch;
  }
  if (cur.trim()) out.push(cur);
  return out;
}

/** 一条声明 → `[属性, 值]`；不安全 / 不成形 ⟹ null。 */
function safeDeclaration(decl) {
  const text = decl.replace(/\/\*[\s\S]*?\*\//g, '').trim();
  const i = text.indexOf(':');
  if (i <= 0) return null;
  const prop = text.slice(0, i).trim();
  const value = text.slice(i + 1).trim();
  if (!PROP_RE.test(prop) || !value) return null;
  if (text.includes('\\') || DANGER.test(text)) return null;
  for (const m of value.matchAll(URL_RE)) if (!SAFE_URL.test(m[2].trim())) return null;
  // `url(` 没配上上面那条正则（没闭合、怪引号）⟹ 不认识它，丢
  if ((value.match(/url\s*\(/gi) || []).length !== [...value.matchAll(URL_RE)].length) return null;
  return [prop, value];
}

function declarationsOf(style) {
  if (typeof style !== 'string') return [];
  return splitDeclarations(style).map(safeDeclaration).filter(Boolean);
}

function sanitizeCss(style) {
  return declarationsOf(style).map(([p, v]) => `${p}:${v}`).join(';');
}

/** `background-color` → `backgroundColor`；`-webkit-x` → `WebkitX`；`-ms-x` → `msX`；`--x` 原样（React 认自定义属性）。 */
function reactName(prop) {
  if (prop.startsWith('--')) return prop;
  const p = prop.toLowerCase().startsWith('-ms-') ? prop.slice(1) : prop;
  return p.replace(/-([a-z])/gi, (_, c) => c.toUpperCase());
}

function styleObject(style) {
  const out = {};
  for (const [p, v] of declarationsOf(style)) out[reactName(p)] = v;
  return out;
}

const DATA_ATTR = /^data-[a-z0-9_.:-]+$/i;

function frozenContainerAttrs(attrs) {
  const out = {};
  if (!isObj(attrs)) return out;
  for (const [k, raw] of Object.entries(attrs)) {
    if (typeof raw !== 'string' && typeof raw !== 'number') continue;
    const v = String(raw);
    if (k === 'class') out.className = v;
    else if (k === 'style') {
      const s = styleObject(v);
      if (Object.keys(s).length) out.style = s;
    } else if (DATA_ATTR.test(k) && k.toLowerCase() !== 'data-block-id') out[k] = v;
  }
  return out;
}

module.exports = { sanitizeCss, styleObject, frozenContainerAttrs };
