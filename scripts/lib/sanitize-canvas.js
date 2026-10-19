'use strict';
// #1833 (SiteAsData T4a-1) —— Custom HTML 进编辑器画布之前的净化（设计文档 §8.1「画布只显示不跑」，决定 5）。
//
//   sanitizeForCanvas(html, { scope, window })   DOMPurify 白名单：只放行展示用的标签和属性（下面两张表）。
//       `<script>` / `on*` / `javascript:` / `<object>` / `<embed>` / `<base>` / `<meta>` / `<form>` / `<link>` 不在表里 ⟹ 删；
//       `<iframe>` 只许 https 的 `src`，一律加空的 `sandbox`（里面什么脚本都不跑），`srcdoc` 不在表里；
//       svg `<use>` 指向 `data:` 的删；块里自带的 `<style>` 内容过 sanitizeCss（给了 scope 才留，不给就删）。
//   sanitizeCss(css, scope)    postcss：每条规则的选择器前面加 scope（`[data-block-id="…"]`），落不到它下面的规则删掉
//       （`@import` / `@font-face` / `@keyframes` / `@namespace` …，只留 `@media` / `@supports` / `@container` 往里递归）；
//       值里有 `expression(`、`javascript:`、`-moz-binding`、`behavior` 的那一条声明删（先解开 CSS 转义再判）。
//   scopeCss(css, scope)       发布 / 预览用：只加前缀，别的原样（老板的代码，不设闸 —— 设计文档 §8.1「发布 / 预览原样写进去」）。
//   blockScope(id)             `[data-block-id="<id>"]`，id 里的引号 / 反斜杠转义好。
//
// 🔴 为什么这道在画布里不能省：Puck 的画布是**同源 iframe、没有 sandbox**，块里的脚本会以 dashboard 的源跑、拿得到老板的
//    登录态（设计文档 §8.1 那一段，`@puckeditor/core@0.23.0` 上现取）。所以 dashboard 里 custom-html 的 `html` 只能经这里
//    才落 DOM（`blocks/custom-html/Section.tsx` 画布那一支；`sanitize-canvas.test.js` 钉着）。
// 🔴 住模板而不住 dashboard：dashboard 没有单测跑道，这份要用 jsdom + DOMPurify 上游向量集测。dashboard 经 vite 的
//    `templateCjs()`（开发）/ rolldown（构建）拿到它；`dompurify` 在 dashboard 和模板各装一份同版本，vite.config.ts 的
//    `resolve.dedupe` 让编辑器产物里只有一份。
// 🔴 不手写净化（票面硬规则）：标签 / 属性的取舍全交给 DOMPurify，这里只写配置和三个钩子（iframe / use / style）。

const createDOMPurify = require('dompurify');
const postcss = require('postcss');

const TAGS = [
  'a', 'abbr', 'address', 'article', 'aside', 'audio', 'b', 'bdi', 'bdo', 'blockquote', 'br', 'caption', 'center', 'cite',
  'code', 'col', 'colgroup', 'data', 'dd', 'del', 'details', 'dfn', 'div', 'dl', 'dt', 'em', 'figcaption', 'figure', 'footer',
  'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'header', 'hgroup', 'hr', 'i', 'iframe', 'img', 'ins', 'kbd', 'li', 'main', 'mark', 'nav',
  'ol', 'p', 'picture', 'pre', 'q', 'rp', 'rt', 'ruby', 's', 'samp', 'section', 'small', 'source', 'span', 'strong', 'style',
  'sub', 'summary', 'sup', 'table', 'tbody', 'td', 'tfoot', 'th', 'thead', 'time', 'tr', 'track', 'u', 'ul', 'var', 'video', 'wbr',
  // svg：图标、简单图形（`foreignObject` / `script` / `animate*` / `set` 不在表里）
  'svg', 'g', 'path', 'circle', 'ellipse', 'line', 'polyline', 'polygon', 'rect', 'text', 'tspan', 'defs', 'symbol', 'use',
  'title', 'desc', 'lineargradient', 'radialgradient', 'stop', 'clippath', 'mask', 'pattern',
];
const ATTRS = [
  'class', 'id', 'style', 'title', 'lang', 'dir', 'role', 'hidden', 'tabindex',
  'href', 'target', 'rel', 'download', 'hreflang',
  'src', 'srcset', 'sizes', 'alt', 'width', 'height', 'loading', 'decoding', 'media', 'type', 'kind', 'srclang', 'label', 'poster',
  'controls', 'muted', 'loop', 'playsinline', 'preload',
  'colspan', 'rowspan', 'scope', 'headers', 'span', 'datetime', 'cite', 'value', 'open', 'start', 'reversed',
  'allow', 'allowfullscreen', 'frameborder', 'referrerpolicy', 'sandbox', 'scrolling', 'name',
  // svg
  'viewbox', 'xmlns', 'd', 'fill', 'fill-rule', 'fill-opacity', 'clip-rule', 'clip-path', 'stroke', 'stroke-width', 'stroke-linecap',
  'stroke-linejoin', 'stroke-dasharray', 'stroke-opacity', 'opacity', 'transform', 'cx', 'cy', 'r', 'rx', 'ry', 'x', 'y', 'x1',
  'x2', 'y1', 'y2', 'points', 'offset', 'stop-color', 'stop-opacity', 'gradientunits', 'gradienttransform', 'preserveaspectratio',
  'text-anchor', 'dominant-baseline', 'font-size', 'font-family', 'font-weight', 'mask', 'xlink:href',
];
const SCOPABLE_AT = new Set(['media', 'supports', 'container']);
const BAD_VALUE = /expression\s*\(|javascript:|vbscript:|-moz-binding|behavior\s*:/i;
const BAD_PROP = /^(behavior|-moz-binding)$/i;

const purifiers = new WeakMap();
// 这一次 sanitize 的 scope（块里 `<style>` 的前缀）。DOMPurify 递给钩子的是它自己解析过的配置，带不过去自定义字段；
// sanitize 是同步的，所以用一个只在 sanitizeForCanvas 那一次调用里有值的变量。
let currentScope = '';

function purifierFor(win) {
  const w = win || (typeof window !== 'undefined' ? window : null);
  if (!w) throw new Error('sanitizeForCanvas: no window — pass { window } (jsdom) outside a browser');
  let p = purifiers.get(w);
  if (p) return p;
  p = createDOMPurify(w);
  p.addHook('uponSanitizeElement', (node, data) => {
    if (data.tagName === 'style' && node.nodeType === 1) {
      node.textContent = currentScope ? sanitizeCss(node.textContent || '', currentScope) : '';
    }
  });
  p.addHook('afterSanitizeAttributes', (node) => {
    const tag = (node.nodeName || '').toLowerCase();
    // 属性值里长得像标签的（`alt="<img src=x onerror=…>"`）整个删掉：今天的浏览器不会把它当标签，但它是老一族 mXSS 的写法，
    // 画布上一个 alt / title 少了不要紧（发布那一侧原样）。上游向量集 #95 / #160 就是这个形状。
    for (const a of [...(node.attributes || [])]) {
      if (/<\s*[a-z!/?]/i.test(a.value)) node.removeAttribute(a.name);
    }
    if (tag === 'iframe') {
      const src = node.getAttribute('src') || '';
      if (!/^https:\/\//i.test(src.trim())) {
        node.parentNode && node.parentNode.removeChild(node);
        return;
      }
      node.setAttribute('sandbox', '');
      node.removeAttribute('srcdoc');
    }
    if (tag === 'use') {
      for (const a of ['href', 'xlink:href']) {
        const v = node.getAttribute(a);
        if (v !== null && !/^#/.test(v.trim())) node.removeAttribute(a);
      }
    }
    if (tag === 'a' && node.getAttribute('target') === '_blank') node.setAttribute('rel', 'noopener noreferrer');
  });
  purifiers.set(w, p);
  return p;
}

function sanitizeForCanvas(html, { scope = '', window: win } = {}) {
  if (typeof html !== 'string' || !html) return '';
  const p = purifierFor(win);
  const cfg = {
    ALLOWED_TAGS: TAGS,
    ALLOWED_ATTR: ATTRS,
    ALLOW_DATA_ATTR: true,
    ALLOW_ARIA_ATTR: true,
    FORCE_BODY: true,
    WHOLE_DOCUMENT: false,
    RETURN_TRUSTED_TYPE: false,
  };
  currentScope = scope;
  try {
    return p.sanitize(html, cfg);
  } finally {
    currentScope = '';
  }
}

function blockScope(id) {
  return `[data-block-id="${String(id).replace(/["\\]/g, '\\$&')}"]`;
}

/** CSS 转义（`\6a` / `\j`）解开，判「值里有没有 javascript:」时用 —— 不然 `\6a avascript:` 就漏过去。 */
function unescapeCss(s) {
  return String(s)
    .replace(/\\([0-9a-f]{1,6})\s?/gi, (_m, hex) => {
      const cp = parseInt(hex, 16);
      return cp > 0 && cp <= 0x10ffff ? String.fromCodePoint(cp) : '';
    })
    .replace(/\\(.)/g, '$1')
    .replace(/\/\*[\s\S]*?\*\//g, '');
}

function prefixSelector(t, scope) {
  // 写给整页的（`html` / `body` / `:root`）落到这一块自己身上。
  const m = /^(?::root|html|body)(?![\w-])\s*(.*)$/i.exec(t);
  if (m) return m[1] ? `${scope} ${m[1]}` : scope;
  return `${scope} ${t}`;
}

function walk(container, scope, strict) {
  container.each((node) => {
    if (node.type === 'comment') { if (strict) node.remove(); return; }
    if (node.type === 'atrule') {
      if (SCOPABLE_AT.has(node.name.toLowerCase())) {
        if (node.nodes) walk(node, scope, strict);
        if (strict && (!node.nodes || node.nodes.length === 0)) node.remove();
      } else if (strict) {
        node.remove();
      }
      return;
    }
    if (node.type === 'rule') {
      // `@keyframes` 里的 `from` / `50%` 不加前缀（宽松模式才会走到它们）。
      const inKeyframes = node.parent && node.parent.type === 'atrule' && /keyframes$/i.test(node.parent.name);
      // 按 postcss 的 `selectors` 切（认引号和括号）：自己按逗号切会把 `a[title="x,y"]` / `:is(h1, h2)` 切坏（#1833 r3）。
      if (!inKeyframes) node.selectors = node.selectors.map((t) => prefixSelector(t, scope));
      if (strict) {
        node.walkDecls((d) => {
          if (BAD_PROP.test(d.prop) || BAD_VALUE.test(unescapeCss(d.value))) d.remove();
        });
        if (!node.nodes || node.nodes.length === 0) node.remove();
      }
      return;
    }
    if (node.type === 'decl' && strict) node.remove(); // 顶层的裸声明落不到任何选择器下
  });
}

function scopeWith(css, scope, strict) {
  if (typeof css !== 'string' || !css.trim() || !scope) return '';
  let root;
  try {
    root = postcss.parse(css);
  } catch (e) {
    return '';
  }
  walk(root, scope, strict);
  return root.toString().trim();
}

function sanitizeCss(css, scope) { return scopeWith(css, scope, true); }
function scopeCss(css, scope) { return scopeWith(css, scope, false); }

module.exports = { sanitizeForCanvas, sanitizeCss, scopeCss, blockScope, TAGS, ATTRS };
