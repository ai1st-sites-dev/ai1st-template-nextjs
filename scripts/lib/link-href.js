'use strict';

// link-href.js —— 老板填的链接能去哪儿（#1416）。写站文件的两套机制共用这一份，判据只有这里一处：
//
//   · `lib/page-write.js` §commitWrites    编辑器那一侧**每一份**落盘（#1427 源头帽，kind `'any'`）——
//                                           页面 / 站级共用块（`lib/shared-blocks-write.js`）/ 外壳四样，
//                                           以及以后交给它的任何一种。新写入方不用记得接线。
//     另有两处更早的检查留着（报错更早、话更贴上下文）：§planPageWrite（`'page'`）、
//     `lib/editor-root.js` §planRootWrite（`'navigation'`）。
//   · `edit-site.js` 的 write_file          AI 对话改站：页面 JSON / `navigation.json` / `blocks/site-blocks.json`
// 🔴 #1416 当初把射程写成「三条路径」的清单，第四条（#1406 的共用块）同一天落地、零调用（#1427）。
//    编辑器那一侧从此不按写入方逐个设卡：写站文件就交给 §commitWrites。
//
// ── 放行什么 ────────────────────────────────────────────────────────────────────────────────────
//   `http:` `https:` `mailto:` `tel:`（大小写不论），以及站内路径（`/` 开头，第二个字不是 `/` 也不是 `\`）。
//   空串 = 没填链接，不归这里管。其余一律拒 —— `javascript:` / `vbscript:` / `data:` / `file:` / `#锚点` /
//   不带斜杠的相对路径都在「其余」里。
// 🔴 白名单，不是黑名单：今天拦住 `javascript:` 的是 React 19 渲染时的一个行为（它只认这一种），
//    列黑名单就是再抄一份那个「只认几种」。
// 🔴 带控制字符（含 tab / 换行）的一律拒：浏览器解析 URL 时会先把 tab 和换行删掉，
//    `java\tscript:` 与 `/\t/evil.example` 在它眼里就是 `javascript:` 与 `//evil.example`。
//    `/\` 同理 —— 浏览器把 `\` 当 `/`，那是一个协议相对的外链，不是站内路径。
// 🔴 前后有空格的也拒、不替老板删：删了就是改了他填的字，而这里只判、不改（值逐字落盘）。
//
// ── 哪些字段是「链接」：从块清单来，不在这里列块名 ───────────────────────────────────────────────
//   块里的：`blocks/<块>/manifest.json` 里 `kind === "link"` 的槽位，值在 `data.<槽位>.href`。
//   新加一个链接槽不用改这里。
//   `navigation.json` 里的：`topbar.link`（公告条，= announcement-bar.link）与 `header.cta`（顶栏按钮，
//   = header.cta）。这两个外壳块的字不住在页面里，住在 navigation.json —— 那两个位置写在 §NAV_LINKS，
//   `link-href.test.js` 盯着它跟两份 manifest 对得上。
//
// ── 老数据：只拦「这一次新写进去的」────────────────────────────────────────────────────────────
//   站文件里本来就有一个不合规的链接时，不碰它的存盘（改别的字段）照常成功；这一次把它改成另一个
//   不合规的值、或者在别处新写一个，才拒。判据：同一个位置（块类型 + 槽位，或 navigation 的那个键）
//   上同一串 href，写之前的文件里有几个就放过几个。不按块的下标比 —— 老 `sections` 页面的块没有 id，
//   编辑器挪一下顺序就会把没碰过的链接误判成新写的。
//
// ── 🔴 检查器那个入口今天写不到链接，哪天可能会写到 ─────────────────────────────────────────────────
//   `scripts/patch-block.js`（检查器那条路）收任意 JSON merge patch，路径正则连 `ctaPrimary.href` 都放得过。
//   今天它写不到 href，只因为 link 槽位的 `editLabel` 只标了 `label`（能改哪些字由 `editLabel` 定，
//   `lib/block-manifest.js` §editableSlotPaths）。哪天给某个 link 槽位的 `editLabel` 加上 `href`，
//   `patch-block.js` 就成了又一个入口 —— 它自己 `writeFileSync`，不走 `lib/page-write.js` §commitWrites，
//   源头帽盖不到它 ⟹ `link-href.test.js` 那一格当场红，点名那个槽位：到时候把它改成走 §commitWrites，再改那一格。
//
// 📌 不管的：目标可不可达（`check-dead-links.js`）、外链的 `rel`、图片地址（`create-site.js`
//    §isValidImageUrl 故意放行 `data:`，那是 `<img src>`，不是链接 —— 别合并成一个函数）。

const { loadManifests } = require('./block-manifest');

const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

const ALLOWED_SCHEME = /^(?:https?|mailto|tel):/i;
const SITE_PATH = /^\/(?![/\\])/;
const CONTROL = /[\u0000-\u001f\u007f]/;

/** 这个 href 能不能收。能 ⟹ `true`。空串算「没填」，也回 `true`。 */
function hrefAllowed(href) {
  if (typeof href !== 'string' || href === '') return true;
  if (CONTROL.test(href) || href !== href.trim()) return false;
  return ALLOWED_SCHEME.test(href) || SITE_PATH.test(href);
}

/** `navigation.json` 里老板的链接住在哪两个键上（对应哪个块的哪个槽位）。 */
const NAV_LINKS = [
  { key: ['topbar', 'link'], block: 'announcement-bar', slot: 'link', where: 'the announcement bar' },
  { key: ['header', 'cta'], block: 'header', slot: 'cta', where: 'the header' },
];

let slotCache = null;
/** 块类型 → 它的 link 槽位名。 */
function linkSlotsByType() {
  if (slotCache) return slotCache;
  const m = new Map();
  for (const [type, man] of loadManifests()) {
    const slots = Object.entries(man.slots || {}).filter(([, s]) => s && s.kind === 'link').map(([k]) => k);
    if (slots.length) m.set(type, { slots, name: man.displayName || type });
  }
  slotCache = m;
  return m;
}

/**
 * 一份 JSON 里**任何深度**上的块形状对象（`{ type, data }`）的全部链接（#1427，kind `'any'`）。
 * 不问这是哪种文件：页面的 `blocks` / `sections`、块库的值、以后新的装块的文件，块长得都一样。
 */
function deepBlockLinks(doc) {
  const found = [];
  const walk = (v) => {
    if (Array.isArray(v)) { for (const x of v) walk(x); return; }
    if (!isObj(v)) return;
    if (typeof v.type === 'string' && isObj(v.data)) found.push(v);
    for (const x of Object.values(v)) walk(x);
  };
  walk(doc);
  return blockLinks(found);
}

/** 一串块里的全部链接：`{ place, where, label, href }`。`{ref}` 条目的字不在这里，跳过。 */
function blockLinks(blocks) {
  const out = [];
  const byType = linkSlotsByType();
  for (const b of blocks) {
    if (!isObj(b) || typeof b.ref === 'string' || !isObj(b.data)) continue;
    const t = byType.get(b.type);
    if (!t) continue;
    for (const slot of t.slots) {
      const v = b.data[slot];
      if (!isObj(v) || typeof v.href !== 'string') continue;
      out.push({ place: `${b.type}.${slot}`, where: `the ${t.name} block`, label: v.label, href: v.href });
    }
  }
  return out;
}

/**
 * 一份文件里老板填的全部链接。
 * @param {'page'|'site-blocks'|'navigation'|'any'} kind
 */
function linksOf(kind, doc) {
  if (!isObj(doc)) return [];
  if (kind === 'page') {
    const arr = Array.isArray(doc.blocks) ? doc.blocks : (Array.isArray(doc.sections) ? doc.sections : []);
    return blockLinks(arr);
  }
  if (kind === 'site-blocks') return blockLinks(Object.values(doc));
  // 🔴 `'any'` 不按文件名认种类（#1427）：按文件名认，一种今天不存在的新文件按定义认不得、帽子对它失明；
  //    而且 `pages/navigation.json`（slug 叫 navigation 的页面）会跟 navigation.json 撞。navigation 那两个键
  //    对别的文件也查一遍 —— 方向是多拦；老数据照样按「写之前有几个」放过。
  if (kind === 'any') return [...deepBlockLinks(doc), ...linksOf('navigation', doc)];
  if (kind === 'navigation') {
    const out = [];
    for (const n of NAV_LINKS) {
      const parent = doc[n.key[0]];
      const v = isObj(parent) ? parent[n.key[1]] : null;
      if (isObj(v) && typeof v.href === 'string') out.push({ place: n.key.join('.'), where: n.where, label: v.label, href: v.href });
    }
    return out;
  }
  throw new Error(`linksOf: 不认识的文件种类 ${JSON.stringify(kind)}`);
}

/**
 * 这一次写入里有没有新写进去的、不能收的链接。有 ⟹ 回一句给老板看的话（英文，跟编辑器其余文案一种语言）；
 * 没有 ⟹ `null`。
 * @param {'page'|'site-blocks'|'navigation'|'any'} kind
 * @param {unknown} next    要写的那份
 * @param {unknown} before  磁盘上现在那份（没有 ⟹ `null`）
 */
function linkRejection(kind, next, before) {
  const had = new Map();
  for (const l of linksOf(kind, before)) {
    if (hrefAllowed(l.href)) continue;
    const k = `${l.place}\u0000${l.href}`;
    had.set(k, (had.get(k) || 0) + 1);
  }
  for (const l of linksOf(kind, next)) {
    if (hrefAllowed(l.href)) continue;
    const k = `${l.place}\u0000${l.href}`;
    if (had.get(k)) { had.set(k, had.get(k) - 1); continue; }
    // 两样都截短：worker 把这句话截在 600 字（`blocks_task.go` §maxRefusalChars），按钮字可以长到 500 ——
    // 不截的话后半句「能填什么」会被截掉，老板只看到「不收」看不到该怎么改。
    const cut = (v, n) => (v.length > n ? `${v.slice(0, n)}…` : v);
    const shown = cut(l.href, 60);
    // 点名：老板在编辑器里看得见的是按钮上那行字和块的名字，不是 `ctaPrimary` 这种键名。
    const what = typeof l.label === 'string' && l.label.trim() ? `The link "${cut(l.label.trim(), 40)}"` : 'A link';
    return `${what} in ${l.where} goes to ${JSON.stringify(shown)}, which is not an `
      + 'address a link can use. A link can go to a web address (https://…), an email (mailto:…), a phone '
      + 'number (tel:…) or a page on this website (starting with /). Nothing was changed.';
  }
  return null;
}

module.exports = { hrefAllowed, linksOf, linkRejection, NAV_LINKS };
