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
//   块里的：块 `data` 任意深度上带 `href` 键的对象（#1526 —— 原来只认 `kind === "link"` 的槽位，按钮列表等
//   整层看不见，理由在 §blockLinks）。块类型要在块清单里（`blocks/<块>/manifest.json`）。
//   新加一个链接槽、一个按钮列表都不用改这里。
//   `navigation.json` 里的：`topbar.link`（一句话公告的链接，= header 的 topbar.message）与 `header.cta`（顶栏按钮，
//   = header 的 ctaPrimary）。这两处的字不住在页面里，住在 navigation.json —— 那两个位置写在 §NAV_LINKS，
//   `link-href.test.js` 盯着它跟 header 的 manifest 对得上。
//
// ── 老数据：只拦「这一次新写进去的」────────────────────────────────────────────────────────────
//   站文件里本来就有一个不合规的链接时，不碰它的存盘（改别的字段）照常成功；这一次把它改成另一个
//   不合规的值、或者在别处新写一个，才拒。判据：同一个位置（块类型 + 槽位，或 navigation 的那个键）
//   上同一串 href，写之前的文件里有几个就放过几个。不按块的下标比 —— 老 `sections` 页面的块没有 id，
//   编辑器挪一下顺序就会把没碰过的链接误判成新写的。
//
// 📌 不管的：目标可不可达（`check-dead-links.js`）、外链的 `rel`、图片地址（`create-site.js`
//    §isValidImageUrl 故意放行 `data:`，那是 `<img src>`，不是链接 —— 别合并成一个函数）。

const { loadManifests } = require('./block-manifest');
// #1511 —— 判据本身（上面「放行什么」那三条）住在 `href-allowed.js`：站级表单库的 `redirect`（`site-forms.js`）
//    也用它，而 `site-forms.js` 被两个 'use client' 组件 import —— 从这份 require 会把 block-manifest（fs / path）
//    拖进客户端包，还会跟 block-manifest 绕成一圈。白名单仍然只有一份。
const { hrefAllowed } = require('./href-allowed');
const { isSourceRef, BUTTON_SOURCES } = require('./item-sources');

const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

/** `navigation.json` 里老板的链接住在哪几个键上（对应哪个块的哪个槽位）。 */
// 📌 #1425（T3）删过 `topbar.link`（公告条那个区随旧库退役，链接不再画）；#1528 它又画到页面上了（派生成 header 的
//    `topbar.message.href`，shell-data.js §topbarMessage）⟹ 加回来。`slot` 是个对象槽，`field` 是它 shape 里那一格。
// #1529：`key` 是任意深度的路径；`list: true` ⟹ 那个位置是一串链接（每一项都查）。下面三行是老板 #1529 起能写、构建派生进外壳的。
const NAV_LINKS = [
  { key: ['topbar', 'link'], block: 'header', slot: 'topbar', field: 'message', where: 'the announcement at the top of the header' },
  { key: ['header', 'cta'], block: 'header', slot: 'ctaPrimary', where: 'the header' },  // #1425：派生成 header 的 ctaPrimary（shell-data.js）
  { key: ['header', 'ctaSecondary'], block: 'header', slot: 'ctaSecondary', where: 'the second header button' },
  { key: ['footer', 'legal'], list: true, block: 'footer', slot: 'legal', where: 'the footer legal links' },
  { key: ['footer', 'cta', 'buttons'], list: true, block: 'footer', slot: 'cta', where: 'the footer call-to-action band' },
];

let nameCache = null;
/** 块类型 → 老板看得见的块名（只收有清单的块类型）。 */
function blockNames() {
  if (nameCache) return nameCache;
  const m = new Map();
  for (const [type, man] of loadManifests()) m.set(type, man.displayName || type);
  nameCache = m;
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

/**
 * 一串块里的全部链接：`{ place, where, label, href, item? }`。
 * 纯引用条目（`{ ref: "promo" }` / `{ ref, weight }`）没有自己的 `type` 和 `data`，下面两步自然跳过它。
 * 🔴 #1430：不按「有没有 `ref` 键」跳过。块库里的一个块多带一个字符串 `ref` 键时，渲染用的就是它自己的 `data`
 *    （`blocks.js` §normalizeLocalePages）；按 `ref` 跳过的话，它的链接一条都不查，而 `visibility: ["*"]` 就是每一页都有。
 * 🔴 #1526：走块 `data` 的**每一层**，凡是带 `href` 键的对象都算一个链接 —— 不按槽位的 kind 挑。原来只走 `kind=link`
 *    的槽，于是按钮列表（`ctas` / `introCtas`）、页头页脚的导航列表、对象槽里套着的按钮（`faq.help.cta` …）
 *    整层不在遍历里：同一个 `javascript:` 写在单个按钮里被拒、写在按钮列表里放行。按名单列会在下一个新块上再漏一次。
 *    `place`（判老数据用）不带下标，理由同文件头「老数据」那段：挪一下顺序不该把没碰过的链接判成新写的；
 *    `item`（给老板看的「第几项」）带下标，从 1 数，套了几层列表就几个数。
 */
function blockLinks(blocks) {
  const out = [];
  const names = blockNames();
  for (const b of blocks) {
    if (!isObj(b) || !isObj(b.data)) continue;
    const name = names.get(b.type);
    if (!name) continue;
    const walk = (v, at, item) => {
      if (Array.isArray(v)) { v.forEach((x, i) => walk(x, `${at}[]`, [...item, i + 1])); return; }
      if (!isObj(v)) return;
      if (Object.prototype.hasOwnProperty.call(v, 'href')) {
        const h = v.href;
        if (typeof h === 'string') {
          out.push({ place: `${b.type}.${at}`, where: `the ${name} block`, label: v.label, href: h, item: item.join('.') });
        }
        // 🔴 引用写法（#1506：按钮 `href: {"source": "phone"}` / `{"source": "email"}`）**显式**放行：它展开成什么由
        //    `item-sources.js` 定（只会是 `tel:` / `mailto:`），这里不判。别靠下面那句「不是字符串就不归这里管」
        //    让它顺带过 —— 那句哪天收紧，编辑器里那两个下拉（#1506 / #1521）就整条存不进去。
        else if (isSourceRef(h) && BUTTON_SOURCES.includes(h.source)) { /* 放行 */ }
        // 其余不是字符串的 href（不认识的 source、数字、数组…）不是这里判的：形状错由 `block-manifest.js`
        // §validateSite → `item-sources.js` §contactRefProblems 报，它们渲染不出一个能点的地址。
      }
      for (const [k, x] of Object.entries(v)) if (k !== 'href') walk(x, `${at}.${k}`, item);
    };
    for (const [slot, v] of Object.entries(b.data)) walk(v, slot, []);
  }
  return out;
}

/**
 * 一份文件里老板填的全部链接。
 * @param {'page'|'site-blocks'|'navigation'|'any'} kind
 */
function linksOf(kind, doc) {
  // 🔴 #1430：顶层是数组的一份（今天没有写入方会产出，但 §commitWrites 承诺「新写入方不用记得接线」）不许整份跳过 ——
  //    按任意深度找块。不是任何一种已知的站文件形状 ⟹ 方向是多拦：`'page'` / `'site-blocks'` 收到数组也走这一步。
  if (Array.isArray(doc)) return kind === 'navigation' ? [] : deepBlockLinks(doc);
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
      let v = doc;
      for (const k of n.key) v = isObj(v) ? v[k] : undefined;
      const items = n.list ? (Array.isArray(v) ? v : []) : [v];
      for (const it of items) {
        if (isObj(it) && typeof it.href === 'string') out.push({ place: n.key.join('.'), where: n.where, label: it.label, href: it.href });
      }
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
    // 列表里的那一项说第几个（#1526）：同一个列表里按钮字可以重名、也可以没有。
    const which = l.item ? ` (item ${l.item})` : '';
    return `${what} in ${l.where}${which} goes to ${JSON.stringify(shown)}, which is not an `
      + 'address a link can use. A link can go to a web address (https://…), an email (mailto:…), a phone '
      + 'number (tel:…) or a page on this website (starting with /). Nothing was changed.';
  }
  return null;
}

module.exports = { hrefAllowed, linksOf, linkRejection, NAV_LINKS };
