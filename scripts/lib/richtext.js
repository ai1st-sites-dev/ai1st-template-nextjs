// ══════════════════════════════════════════════════════════════════════════════════════════════════
// richtext —— 槽 kind `richtext` 的写法（#1498，content 的 body）
// ══════════════════════════════════════════════════════════════════════════════════════════════════
//
// 只认一个很小的 markdown 子集，别的一律当文字：
//   · 空行分段                          → <p>
//   · 行首 `- `（连续几行）              → <ul><li>
//   · 行首 `1. ` / `2. ` …（连续几行）   → <ol><li>
//   · `**加粗**`                        → <strong>
//   · `[文字](链接)`                    → <a href>，链接只认 http(s):// · / · # · mailto: · tel: 开头；
//                                         别的协议（javascript: / data: …）只留下「文字」，不出 <a>
// 不认 HTML（原样转义成文字）、不认标题 / 图片 / 表格 / 斜体 / 代码。同一段里的换行当一个空格（markdown 的软换行）。
//
// 🔴 **只有一个解析器**：`parseRichtext` 出一棵节点树，`Section.tsx` 用 React 按树画（字由 React 转义，
//    不走 dangerouslySetInnerHTML），`richtextToHtml` 把同一棵树拼成 HTML 串（单测逐字比对用），
//    `richtextProblems` 给 validateSite 报错。三处共用一棵树 ⟹ 「页面画出来的」与「校验说的」不会各说各话。
// 🔴 不引 markdown 库：要的只是这几样，库会顺手认一大堆我们不想让 AI 写的东西（HTML 直通、图片、标题）。

'use strict';

/** 链接允许的开头。`//evil.com` 这种协议相对地址不算「/ 开头的站内链接」；`/\evil.com` 也不算 ——
 *  浏览器把 `\` 当 `/`，它解析出来就是 `//evil.com`（#1498 r1 QA1 / QA2）。 */
const SAFE_HREF = /^(https?:\/\/|\/(?![\/\\])|#|mailto:|tel:)/i;

/** 看起来像一个 HTML 标签（`<p>` / `</div>` / `<br/>` / `<script …>`）。 */
const HTML_TAG = /<\/?[a-z][a-z0-9-]*(\s[^<>]*)?\/?>/i;

// 链接地址允许带一层括号（`javascript:alert(1)` 这种要整段吃掉，不能在第一个 `)` 处截断、把 `)` 留成文字）。
const LINK = /\[([^\]\n]+)\]\(((?:[^()\s]|\([^()\s]*\))+)\)/g;
const BOLD = /\*\*([^*\n]+?)\*\*/g;

const UL_ITEM = /^\s*-\s+(.*)$/;
const OL_ITEM = /^\s*\d+\.\s+(.*)$/;

/** 行内：文字 / 加粗 / 链接。返回节点数组：{t:'text',v} · {t:'strong',c:[…]} · {t:'a',href,c:[…]}。 */
function parseInline(src) {
  const out = [];
  let last = 0;
  LINK.lastIndex = 0;
  let m;
  while ((m = LINK.exec(src))) {
    if (m.index > last) out.push(...parseBold(src.slice(last, m.index)));
    const href = m[2];
    const label = parseBold(m[1]);
    if (SAFE_HREF.test(href)) out.push({ t: 'a', href, c: label });
    else out.push(...label);
    last = m.index + m[0].length;
  }
  if (last < src.length) out.push(...parseBold(src.slice(last)));
  return mergeText(out);
}

function parseBold(src) {
  const out = [];
  let last = 0;
  BOLD.lastIndex = 0;
  let m;
  while ((m = BOLD.exec(src))) {
    if (m.index > last) out.push({ t: 'text', v: src.slice(last, m.index) });
    out.push({ t: 'strong', c: [{ t: 'text', v: m[1] }] });
    last = m.index + m[0].length;
  }
  if (last < src.length) out.push({ t: 'text', v: src.slice(last) });
  return out;
}

function mergeText(nodes) {
  const out = [];
  for (const n of nodes) {
    if (n.t === 'text' && out.length && out[out.length - 1].t === 'text') out[out.length - 1].v += n.v;
    else if (n.t !== 'text' || n.v !== '') out.push(n);
  }
  return out;
}

/**
 * 整段 → 块节点数组：{t:'p', c:[行内]} · {t:'ul'|'ol', items:[[行内], …]}。
 * 不是字符串（undefined / 数字 / 对象）⟹ 空数组：块里的这一段就不渲染。
 */
function parseRichtext(src) {
  if (typeof src !== 'string') return [];
  const lines = src.replace(/\r\n?/g, '\n').split('\n');
  const blocks = [];
  let para = null;
  let list = null;
  const endPara = () => {
    if (para) blocks.push({ t: 'p', c: parseInline(para.join(' ').trim()) });
    para = null;
  };
  const endList = () => {
    if (list) blocks.push(list);
    list = null;
  };
  for (const raw of lines) {
    const line = raw.trimEnd();
    if (!line.trim()) { endPara(); endList(); continue; }
    const ul = UL_ITEM.exec(line);
    const ol = ul ? null : OL_ITEM.exec(line);
    if (ul || ol) {
      endPara();
      const t = ul ? 'ul' : 'ol';
      if (list && list.t !== t) endList();
      if (!list) list = { t, items: [] };
      list.items.push(parseInline((ul || ol)[1].trim()));
      continue;
    }
    endList();
    (para = para || []).push(line.trim());
  }
  endPara();
  endList();
  return blocks.filter((b) => (b.t === 'p' ? b.c.length > 0 : b.items.length > 0));
}

const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ESC[c]);

function inlineHtml(nodes) {
  return nodes.map((n) => {
    if (n.t === 'text') return esc(n.v);
    if (n.t === 'strong') return `<strong>${inlineHtml(n.c)}</strong>`;
    return `<a href="${esc(n.href)}">${inlineHtml(n.c)}</a>`;
  }).join('');
}

/** 同一棵树拼成 HTML 串（块与块之间不加换行）。单测逐字比对用；页面上是 Section.tsx 按树画。 */
function richtextToHtml(src) {
  return parseRichtext(src).map((b) => (b.t === 'p'
    ? `<p>${inlineHtml(b.c)}</p>`
    : `<${b.t}>${b.items.map((it) => `<li>${inlineHtml(it)}</li>`).join('')}</${b.t}>`)).join('');
}

/**
 * validateSite 用：这一段里有哪些写法页面上不会照写的人想的那样出现。两种：
 *   · html     —— 写了 HTML 标签（会被原样当成文字显示出来）
 *   · href     —— 链接协议不认（只剩文字、没有链接）
 * 返回 [{kind, sample}]，sample 是命中的那一小段（给人看的报错里用）。
 */
function richtextProblems(src) {
  if (typeof src !== 'string') return [];
  const out = [];
  const tag = HTML_TAG.exec(src);
  if (tag) out.push({ kind: 'html', sample: tag[0].slice(0, 40) });
  LINK.lastIndex = 0;
  let m;
  while ((m = LINK.exec(src))) {
    if (!SAFE_HREF.test(m[2])) out.push({ kind: 'href', sample: m[2].slice(0, 40) });
  }
  return out;
}

module.exports = { parseRichtext, richtextToHtml, richtextProblems, SAFE_HREF };
