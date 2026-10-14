'use strict';

// row-image-urls.js —— #1766 成排的小图（logo、头像、评价平台的 logo）里只收我们自己的地址，别的删掉。
//
// 为什么：建站时这类图故意不生成（`block-manifest.js` §imageSlotsOf：生成出来就是假的平台 logo、假的真人头像），可写字那一步
// 照样能往这些格子里写地址。Chris 的 `site-6e008f90` 上 logos 块三项全是 AI 编的维基缩略图地址，三个都回 400，画布、预览、
// 上线全是破图；又因为格子里有地址，#1734 的占位图也不出。
//
// 范围（「哪些格」）：`editor-schema.js` §inlineSlotsOf 标 `url: true` 的那一类（值本身就是地址字符串的成排小图）。按这个谓词
//    现算，不写块名单 —— 今天是 hero 的 logos / 头像 / band、logos.items、pricing 的 logos / 头像、reviews 平台的 logoUrl、
//    testimonials 评价总结的 logoUrl，那是读数。
// 判据（「哪些地址留」）只有两种：
//   ① 站内路径：以一个 `/` 开头（`/images/platforms/google.svg`、skipAI 站的 `/photos/…`）。`//host/…` 不算 —— 浏览器按 https 取。
//   ② 我们自己的图片库：解析出来的 **host 等于** manager 配置的 `cfg.Domain.Uploads`（随载荷来，`uploadsDomain`）。三个环境三个值
//      （.dev / .net / .app），这里一个都不写死。🔴 比的是 host 本身，不是子串：维基的 `upload.wikimedia.org` 跟
//      `uploads.ai1stsite.dev` 只差一个字母，`includes('upload')` 两个都放行。
// 别的地址 ⟹ 删掉这一格（`delete`），**这一项照留**：名字还在，logos 块垫 #1734 的占位图、点它能换图。
// 🔴 载荷里没有 uploads 域名 ⟹ 一个都不删、喊一行：宁可放过一个编的地址，也不能删掉老板上传的图（删图不可逆）。
//
// 调用点：建站写页面那一刻（`create-site.js` §writeSiteConfig / §writeSecondaryLocaleConfig）、改站同步之前
// （`edit-site.js` §scrubPagesAfterEdit，这一轮写过的页面和站级块）。

const { loadManifests } = require('./block-manifest');
const { inlineSlotsOf } = require('./editor-schema');

/** 一份 manifest 里成排小图的那几格：`['logos.items.imageUrl', 'proof.avatars.imageUrl', …]`。 */
function rowImageCellsOf(manifest) {
  return inlineSlotsOf(manifest).filter((c) => c.url).map((c) => c.path);
}

/** uploads 域名 → 规范化的 host（小写、去掉首尾空格）；空 / 解析不出 ⟹ ''。 */
function hostOf(domain) {
  const d = typeof domain === 'string' ? domain.trim() : '';
  if (!d) return '';
  try { return new URL(`https://${d}`).hostname.toLowerCase(); } catch (e) { return ''; }
}

/** 这个地址留不留：站内路径（一个 `/` 开头）或 host 等于 uploads 域名的 http(s) 地址。`uploadsHost` 已经规范化。 */
function isOwnImageAddress(value, uploadsHost) {
  const v = typeof value === 'string' ? value.trim() : '';
  if (!v) return true;
  if (/^\/(?![/\\])/.test(v)) return true;
  if (!uploadsHost) return false;
  let u;
  try { u = new URL(v); } catch (e) { return false; }
  return (u.protocol === 'https:' || u.protocol === 'http:') && u.hostname.toLowerCase() === uploadsHost;
}

/** 沿路径删：途中遇到数组就逐项往下走（`items.imageUrl`、`logos.items.imageUrl`）。回删了几格。 */
function scrubAt(node, segs, uploadsHost) {
  if (Array.isArray(node)) return node.reduce((n, x) => n + scrubAt(x, segs, uploadsHost), 0);
  if (!node || typeof node !== 'object') return 0;
  const [head, ...rest] = segs;
  if (!Object.prototype.hasOwnProperty.call(node, head)) return 0;
  if (rest.length) return scrubAt(node[head], rest, uploadsHost);
  if (typeof node[head] !== 'string' || isOwnImageAddress(node[head], uploadsHost)) return 0;
  delete node[head];
  return 1;
}

let cellsByType = null;
function cellsFor(type, manifests) {
  if (manifests) {
    const m = manifests instanceof Map ? manifests.get(type) : manifests[type];
    return m ? rowImageCellsOf(m) : [];
  }
  if (!cellsByType) {
    cellsByType = new Map();
    for (const [t, m] of loadManifests()) cellsByType.set(t, rowImageCellsOf(m));
  }
  return cellsByType.get(type) || [];
}

/**
 * 一组块（页面的 `blocks` / `sections`，或站级块的值）就地删一遍。`{ref}` 条目不碰（它的内容在站级块里，那边另过）。
 * @returns {number} 删了几格
 */
function scrubBlocks(blocks, uploadsHost, manifests) {
  let n = 0;
  for (const b of Array.isArray(blocks) ? blocks : []) {
    if (!b || typeof b !== 'object' || typeof b.type !== 'string' || !b.data || typeof b.data !== 'object') continue;
    for (const cell of cellsFor(b.type, manifests)) n += scrubAt(b.data, cell.split('.'), uploadsHost);
  }
  return n;
}

/**
 * 一份页面 JSON（`blocks` 新形状或 `sections` 老形状）就地删一遍。
 * @param {object} page
 * @param {{ uploadsDomain?: string, manifests?: Map|object, log?: (line: string) => void }} opts
 * @returns {{ removed: number, skipped: boolean }}  `skipped` = 没有 uploads 域名，一格都没动
 */
function scrubRowImageUrls(page, { uploadsDomain, manifests, log } = {}) {
  const uploadsHost = hostOf(uploadsDomain);
  if (!uploadsHost) {
    if (typeof log === 'function') log('[row-images] 载荷里没有 uploadsDomain —— 成排小图的地址一个都不删（分不出哪些是我们图片库的）');
    return { removed: 0, skipped: true };
  }
  let removed = 0;
  if (page && typeof page === 'object') {
    for (const list of [page.blocks, page.sections]) removed += scrubBlocks(list, uploadsHost, manifests);
  }
  return { removed, skipped: false };
}

/** 站级块库（`blocks/site-blocks.json`：`{ id: block }`）就地删一遍。参数与回值同 §scrubRowImageUrls。 */
function scrubSiteBlocks(siteBlocks, { uploadsDomain, manifests, log } = {}) {
  const uploadsHost = hostOf(uploadsDomain);
  if (!uploadsHost) {
    if (typeof log === 'function') log('[row-images] 载荷里没有 uploadsDomain —— 成排小图的地址一个都不删（分不出哪些是我们图片库的）');
    return { removed: 0, skipped: true };
  }
  const blocks = siteBlocks && typeof siteBlocks === 'object' && !Array.isArray(siteBlocks) ? Object.values(siteBlocks) : [];
  return { removed: scrubBlocks(blocks, uploadsHost, manifests), skipped: false };
}

module.exports = { rowImageCellsOf, isOwnImageAddress, hostOf, scrubRowImageUrls, scrubSiteBlocks };
