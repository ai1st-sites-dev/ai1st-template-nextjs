'use strict';
// #1833 (SiteAsData T4a-1) —— Custom HTML 进编辑器画布之前的净化（设计文档 §8.1「画布只显示不跑」，决定 5）。
//
//   sanitizeForCanvas(html, { window })   DOMPurify 白名单：只放行展示用的标签和属性（下面两张表）。
//       `<script>` / `on*` / `javascript:` / `<object>` / `<embed>` / `<base>` / `<meta>` / `<form>` / `<link>` 不在表里 ⟹ 删；
//       `<iframe>` 只许 https 的 `src`，一律加空的 `sandbox`（里面什么脚本都不跑），`srcdoc` 不在表里；
//       svg `<use>` 指向 `data:` 的删；块里自带的 `<style>` 整块删（连同里面的规则，DOMPurify 不留它的内容）——
//       画布那份 document 里还画着编辑器自己的东西（浮动条、Design 弹层都 portal 在里面）和别的块，`h1 { … }` 一条就改到它们
//       （#1833 r5，Chris 退回那一轮）。`style="…"` 属性只管它自己那个元素，照常留着。
//   📌 没有 CSS 净化了：块的 `css` 字段删了（Chris 2026-10-19「这个 HTML 就是 inline 的 CSS」），`<style>` 在画布里不留，
//      发布 / 预览原样写（老板的代码，不设闸）⟹ 没有哪一处还要给 CSS 加前缀或挑规则。
//
// 🔴 为什么这道在画布里不能省：Puck 的画布是**同源 iframe、没有 sandbox**，块里的脚本会以 dashboard 的源跑、拿得到老板的
//    登录态（设计文档 §8.1 那一段，`@puckeditor/core@0.23.0` 上现取）。所以 dashboard 里 custom-html 的 `html` 只能经这里
//    才落 DOM（`blocks/custom-html/Section.tsx` 画布那一支；`sanitize-canvas.test.js` 钉着）。
// 🔴 住模板而不住 dashboard：dashboard 没有单测跑道，这份要用 jsdom + DOMPurify 上游向量集测。dashboard 经 vite 的
//    `templateCjs()`（开发）/ rolldown（构建）拿到它；`dompurify` 在 dashboard 和模板各装一份同版本，vite.config.ts 的
//    `resolve.dedupe` 让编辑器产物里只有一份。
// 🔴 不手写净化（票面硬规则）：标签 / 属性的取舍全交给 DOMPurify，这里只写配置和一个钩子（属性收尾：iframe / use / 链接）。

const createDOMPurify = require('dompurify');

const TAGS = [
  'a', 'abbr', 'address', 'article', 'aside', 'audio', 'b', 'bdi', 'bdo', 'blockquote', 'br', 'caption', 'center', 'cite',
  'code', 'col', 'colgroup', 'data', 'dd', 'del', 'details', 'dfn', 'div', 'dl', 'dt', 'em', 'figcaption', 'figure', 'footer',
  'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'header', 'hgroup', 'hr', 'i', 'iframe', 'img', 'ins', 'kbd', 'li', 'main', 'mark', 'nav',
  'ol', 'p', 'picture', 'pre', 'q', 'rp', 'rt', 'ruby', 's', 'samp', 'section', 'small', 'source', 'span', 'strong',
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
const purifiers = new WeakMap();
function purifierFor(win) {
  const w = win || (typeof window !== 'undefined' ? window : null);
  if (!w) throw new Error('sanitizeForCanvas: no window — pass { window } (jsdom) outside a browser');
  let p = purifiers.get(w);
  if (p) return p;
  p = createDOMPurify(w);
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

function sanitizeForCanvas(html, { window: win } = {}) {
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
  return p.sanitize(html, cfg);
}

module.exports = { sanitizeForCanvas, TAGS, ATTRS };
