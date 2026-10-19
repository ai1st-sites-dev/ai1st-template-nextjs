'use strict';
// #1833 (SiteAsData T4a-1) —— Custom HTML 入库前的那一次整理（设计文档 §8.1「入库前整理一次，之后再也不碰」）。
//
//   tidyHtml(html)                  parse5 按 body 里的片段解析再序列化：没闭合的标签补上、`<html>` / `<head>` / `<body>`
//                                   外壳去掉（片段解析本来就不收这三个标签，里面的东西留下）。不改内容、不「修复」逻辑 ——
//                                   它是老板的代码。原文或整理后的结果超过 64 KB 都抛 CustomHtmlError（save 那一侧回 400 原话）
//                                   —— 量整理后那份是 #1833 r3 补的：只量原文时 63 KB 的未闭合 `<p>` 能落成 147 KB，
//                                   之后这一页改任何一块再保存都被拒。
//                                   含 `<plaintext>` ⟹ 抛（话是「Custom HTML can't use the <plaintext> tag」），理由见下。
//   tidyCustomHtmlBlock(block)      一块 `type: custom-html` 的 data.html / data.css 过上面那一道；别的块原样回。
//   tidyCustomHtmlInPage(page)      一份页面 JSON（`{ blocks: [...] }`）里每一块 custom-html 过一遍。
//   tidyCustomHtmlInSiteBlocks(o)   `blocks/site-blocks.json`（id → 块）同上。
//   tidyCustomHtmlData(data)        一块 custom-html 的 data（或共用块改动里那份 data）：`html` 整理、`css` 限长，别的键原样。
//   tidyCustomHtmlInContent(c, ks)  content 里点名的那几个键（页面 / 站级块文件）逐块整理；改了的那几个换成对象，没改的原样。
//   customHtmlOf(content)           整份 content 里所有 custom-html 块的 html（字符串数组）—— PurgeCSS 要看见它们（§6.4）。
//
// 🔴 为什么非整理不可：静态 HTML 里没闭合的 `<b>` / `<div>` 会吞掉后面的兄弟块（`<section>` 容器挡不住 ——
//    浏览器的「活动格式元素」重建会把 `<b>` 续到下一个块里）。整理之后它是一段闭合的片段，下一个块是它的兄弟。
// 🔴 save / validate 每次保存都把页面上【每一块】再整理一遍（不管这一笔改没改它）⟹ 落库那份必须是不动点：再整理一遍逐字相同，
//    否则老板的代码每存一次被改一次、越存越大（#1833 r3 QA1）。parse5 解析再序列化【一遍】到不了不动点 ——
//    `<table><p><form>x</form></p></table>` 要两遍（第一遍的输出再解析又被挪一次）；所以这里一直跑到输出不再变，
//    存的是浏览器解析那份之后真正看到的形状。`custom-html.test.js` ① 钉着「再整理一遍逐字相同」，料里有要两遍的。
// 🔴 `<plaintext>` 没有结束标签（HTML 规范：它后面直到文档末尾全是它的文本）⟹ 它后面的块、页脚全被吞成文字，
//    整理闭合不了它；序列化又每一遍多补一个 `</plaintext>`，永远到不了不动点。所以直接拒，不存。
//    跑到 MAX_PASSES 遍还在变（今天没见过 `<plaintext>` 以外的料）同样拒，不存一份还会变的东西。
// T4a-2（全站代码面板）和 T4a-3（AI 写）也调这一份，不各写一遍。

const parse5 = require('parse5');

const TYPE = 'custom-html';
const MAX_BYTES = 64 * 1024;
const TOO_LARGE = 'Custom HTML is limited to 64 KB';
const NO_PLAINTEXT = "Custom HTML can't use the <plaintext> tag";
const UNSTABLE = "Custom HTML couldn't be saved: its markup keeps changing when tidied";
const MAX_PASSES = 5;

class CustomHtmlError extends Error {
  constructor(message, code = 'too-large') {
    super(message);
    this.name = 'CustomHtmlError';
    this.code = code;
  }
}

const isObj = (v) => !!v && typeof v === 'object' && !Array.isArray(v);

function checkSize(text) {
  if (Buffer.byteLength(text, 'utf8') > MAX_BYTES) throw new CustomHtmlError(TOO_LARGE);
}

const HTML_NS = 'http://www.w3.org/1999/xhtml';

/** 解析树里有没有 HTML 的 `<plaintext>`（svg / math 里同名的是外来元素，不吞后文；`<template>` 的内容也查）。 */
function hasPlaintext(node) {
  if (node.tagName === 'plaintext' && node.namespaceURI === HTML_NS) return true;
  const kids = [...(node.childNodes || []), ...(node.content ? node.content.childNodes : [])];
  return kids.some(hasPlaintext);
}

function tidyHtml(html) {
  if (typeof html !== 'string') return '';
  checkSize(html); // 先挡一次：超限的原文不值得解析
  let tree = parse5.parseFragment(html);
  if (hasPlaintext(tree)) throw new CustomHtmlError(NO_PLAINTEXT, 'plaintext');
  let out = parse5.serialize(tree);
  for (let pass = 1; ; pass += 1) {
    tree = parse5.parseFragment(out);
    const again = parse5.serialize(tree);
    if (again === out) break; // 不动点：再整理一遍逐字相同
    if (pass >= MAX_PASSES) throw new CustomHtmlError(UNSTABLE, 'unstable');
    out = again;
  }
  checkSize(out); // 🔴 限的是落库那份：补闭合（`<p>` → `<p></p>`）、转义（`&` → `&amp;`）会让输出比输入大
  return out;
}

function tidyCustomHtmlData(data) {
  if (!isObj(data)) return data;
  const out = { ...data };
  if (typeof out.html === 'string') out.html = tidyHtml(out.html);
  if (typeof out.css === 'string') checkSize(out.css);
  return out;
}

function tidyCustomHtmlBlock(block) {
  if (!isObj(block) || block.type !== TYPE || !isObj(block.data)) return block;
  return { ...block, data: tidyCustomHtmlData(block.data) };
}

function tidyCustomHtmlInPage(page) {
  if (!isObj(page) || !Array.isArray(page.blocks)) return page;
  return { ...page, blocks: page.blocks.map(tidyCustomHtmlBlock) };
}

function tidyCustomHtmlInSiteBlocks(siteBlocks) {
  if (!isObj(siteBlocks)) return siteBlocks;
  return Object.fromEntries(Object.entries(siteBlocks).map(([id, b]) => [id, tidyCustomHtmlBlock(b)]));
}

const PAGE_JSON = /(^|\/)pages\/.+\.json$/;
const SITE_BLOCKS_JSON = /(^|\/)blocks\/site-blocks\.json$/;

/** content（库里一行 JSON 的形状）里一个文件的值：对象原样，JSON 原文解析一次，解析不了算没有。 */
function parsed(value) {
  if (isObj(value)) return value;
  if (typeof value !== 'string') return null;
  try {
    const v = JSON.parse(value);
    return isObj(v) ? v : null;
  } catch (e) {
    return null;
  }
}

function tidyCustomHtmlInContent(content, keys = Object.keys(isObj(content) ? content : {})) {
  if (!isObj(content)) return content;
  const out = { ...content };
  for (const rel of keys) {
    const page = PAGE_JSON.test(rel);
    if (!page && !SITE_BLOCKS_JSON.test(rel)) continue;
    const v = parsed(out[rel]);
    if (!v) continue;
    const next = page ? tidyCustomHtmlInPage(v) : tidyCustomHtmlInSiteBlocks(v);
    if (JSON.stringify(next) !== JSON.stringify(v)) out[rel] = next;
  }
  return out;
}

function customHtmlOf(content) {
  const out = [];
  const take = (b) => {
    if (isObj(b) && b.type === TYPE && isObj(b.data) && typeof b.data.html === 'string') out.push(b.data.html);
  };
  for (const [rel, value] of Object.entries(isObj(content) ? content : {})) {
    const v = PAGE_JSON.test(rel) || SITE_BLOCKS_JSON.test(rel) ? parsed(value) : null;
    if (!v) continue;
    if (PAGE_JSON.test(rel)) (Array.isArray(v.blocks) ? v.blocks : []).forEach(take);
    else Object.values(v).forEach(take);
  }
  return out;
}

module.exports = {
  TYPE, MAX_BYTES, TOO_LARGE, NO_PLAINTEXT, UNSTABLE, MAX_PASSES, CustomHtmlError,
  tidyHtml, tidyCustomHtmlData, tidyCustomHtmlBlock, tidyCustomHtmlInPage, tidyCustomHtmlInSiteBlocks, tidyCustomHtmlInContent, customHtmlOf,
};
