'use strict';

// editor-nav.js —— 编辑器顶栏 Content 页的「Navigation links」（#1759）：读哪几页能进菜单，以及存盘时写别的页的 `navLabel` / `navOrder`。
//
// 📌 #1781 —— 菜单改成了老板自己的一份列表（`navigation.json` 的 `header.links`，编辑器经 root 字段 `headerLinks` 写，`editor-root.js`）。
//    编辑器从此不再调这份文件：下面「菜单不单独存一份」那段说的是 #1759 时的样子。写盘那一格 `nav`（write-editor-save.js / manager /
//    dashboard 一路透传）还在、照旧能用 —— 它改的 navLabel 今天只影响新页第一次进菜单时的名字和页面选择器里的名字，不再动菜单本身。
//
// 菜单不单独存一份：构建时从这种语言的每一页推出来（规则在 `lib/nav-menu.js`，`derive-site.js` 与编辑器预览共用）。所以在面板里
//   改一个链接的名字 = 写那一页的 `navLabel` · 拖顺序 = 重写各页的 `navOrder` · 隐藏 = 删掉那一页的 `navLabel`（不进菜单）·
//   显示回来 = `navLabel` 写回那一页的标题。
//
// 这份文件管两件事：
//   · §navMenuOf / §readNavMenu —— 这种语言里能进菜单的页：首页 + 普通页（不含关键词页、服务详情页，判据同 `derive-site.js`），
//     普通页按构建的顺序（`navOrder`，没有算 99，同分保持读入顺序）。编辑器页构建时（`page.tsx`，喂构建那份 `pagesByLocale`）和
//     每次换页取底稿时（`editor-page.js` §editorBaseline，读盘）都走 §navMenuOf —— 存过一次之后换页，面板里是存下去的那一份。
//   · §planNavWrite —— 一笔存盘里 `nav` 那一格：`{ "<slug>": { navLabel?: string | null, navOrder?: number } }`，
//     对着**磁盘上现在**那一份改点名的那几个键（同 `shared-blocks-write.js` 文件头讲的道理：编辑器手上没有别的页的整份 JSON），
//     只算字节、不落盘 —— 判与写交给 `lib/page-write.js` §commitWrites，跟这一笔别的几半一起「要么全写、要么全不写」。
//     🔴 正在编辑的这一页不走这里：它的 `navLabel` / `navOrder` 由编辑器并进这一笔的页面 JSON（`json`），回新的 hash，
//        编辑器手里那份底稿跟着更新。两边各写一份同一个文件 = 后写的盖掉先写的，所以点名它就拒（形状不对，exit 5）。

const fs = require('fs');
const path = require('path');

const { isKeywordPage } = require('./keyword-service');
const { isLocationPage } = require('./location-pages');
const { isServiceDetailPage } = require('./service-detail-page');

/** 菜单里一个链接的名字最长多少字（顶栏一行放得下；构建那头不限，这里是给老板的输入框定一个界）。 */
const NAV_LABEL_MAX = 40;

const REFUSED = 11;

class NavWriteError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}
const bad = (msg) => { throw new NavWriteError(5, msg); };
const refuse = (msg) => { throw new NavWriteError(REFUSED, msg); };

const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const str = (v) => (typeof v === 'string' ? v : '');

/** 普通页：能进菜单的那种（同 `derive-site.js` 的 `regularPages`；#1979 起地点页也不算）。 */
function isRegularPage(p) {
  return !!p && typeof p.slug === 'string' && p.slug !== 'home' && !isKeywordPage(p) && !isServiceDetailPage(p) && !isLocationPage(p);
}

/**
 * 一种语言的页（构建那份 `pagesByLocale[语言]`，或读盘读出来的）→ 菜单那一页要的三样分开的值。
 * @returns {{ home: { navLabel: string, title: string } | null, pages: { slug: string, title: string, navLabel: string, navOrder?: number }[] }}
 *   `navLabel` 空串 = 隐藏着（不进菜单）。`navOrder` 没写 ⟹ 不放这个键。
 */
function navMenuOf(localePages) {
  const list = (Array.isArray(localePages) ? localePages : []).filter((p) => isObj(p) && typeof p.slug === 'string');
  // 同 derive-site.js：`(a.navOrder ?? 99) - (b.navOrder ?? 99)`，Array.prototype.sort 稳定 ⟹ 同分保持原来的顺序。
  const sorted = list.slice().sort((a, b) => (a.navOrder ?? 99) - (b.navOrder ?? 99));
  const home = sorted.find((p) => p.slug === 'home');
  return {
    home: home ? { navLabel: str(home.navLabel), title: str(home.title) } : null,
    pages: sorted.filter(isRegularPage).map((p) => ({
      slug: p.slug,
      title: str(p.title),
      navLabel: str(p.navLabel),
      ...(Number.isFinite(p.navOrder) ? { navOrder: p.navOrder } : {}),
    })),
  };
}

/** 读盘那一份：这种语言目录里的全部页（同 `page-write.js` 的读法）。 */
function readLocalePages(pageFiles, localeDir) {
  const pagesDir = path.join(localeDir, 'pages');
  const localePages = [];
  const sourceBySlug = new Map();
  if (fs.existsSync(pagesDir)) pageFiles.readPagesRecursive(pagesDir, '', localePages, sourceBySlug);
  return { localePages, sourceBySlug };
}

/** §navMenuOf，页从盘上读（编辑器换页取底稿时用，`editor-page.js`）。 */
function readNavMenu(pageFiles, localeDir) {
  return navMenuOf(readLocalePages(pageFiles, localeDir).localePages);
}

/**
 * 判 `nav` 能不能写，能写就回要写的那几页（绝对路径 + 内容），**不落盘**。
 * @param {object} a
 * @param {object} a.pageFiles  `lib/page-files.js`
 * @param {{ localeDir: string }} a.target  `page-write.js` §resolveTarget 的结果
 * @param {string} a.slug       这一笔存盘的那一页（正在编辑的那一页）—— `nav` 不许点名它
 * @param {unknown} a.nav
 * @returns {{ file: string, content: string }[]}
 * @throws {NavWriteError} 5 = 形状不对（编辑器发不出来的东西）· 11 = 拒收（给老板看的一句话）
 */
function planNavWrite({ pageFiles, target, slug, nav }) {
  if (!isObj(nav)) bad('nav 必须是一个对象 { "<页面 slug>": { navLabel?, navOrder? } }');
  const entries = Object.entries(nav);
  if (!entries.length) return [];
  if (entries.length > 200) bad(`nav 里的页太多了（${entries.length}）`);
  let read;
  try {
    read = readLocalePages(pageFiles, target.localeDir);
  } catch (e) {
    bad(`读不出这一种语言的页面：${e.message}`);
  }
  const { localePages, sourceBySlug } = read;
  const menu = new Set(['home', ...localePages.filter(isRegularPage).map((p) => p.slug)]);
  const writes = [];
  for (const [s, change] of entries) {
    if (s === slug) bad(`nav 不许点名正在编辑的这一页（${JSON.stringify(s)}）：它的 navLabel / navOrder 跟页面 JSON 一起交`);
    if (!menu.has(s)) bad(`nav 点名的不是这种语言里能进菜单的页：${JSON.stringify(s)}`);
    if (!isObj(change)) bad(`nav.${s} 必须是一个对象`);
    for (const k of Object.keys(change)) if (k !== 'navLabel' && k !== 'navOrder') bad(`nav.${s} 里有不认识的键：${JSON.stringify(k)}`);
    if ('navLabel' in change) {
      const v = change.navLabel;
      if (v === null) {
        if (s === 'home') refuse('The home page is always the first link in the menu, so it can\'t be hidden. Nothing was changed.');
      } else if (typeof v !== 'string') {
        bad(`nav.${s}.navLabel 必须是字符串或 null`);
      } else if (!v.trim()) {
        refuse('Every link in the menu needs a name. To take a page out of the menu, hide it instead. Nothing was changed.');
      } else if (v.trim().length > NAV_LABEL_MAX) {
        refuse(`Menu link names can be up to ${NAV_LABEL_MAX} characters. Nothing was changed.`);
      }
    }
    if ('navOrder' in change && !(Number.isInteger(change.navOrder) && change.navOrder >= 0 && change.navOrder <= 999)) {
      bad(`nav.${s}.navOrder 必须是 0–999 的整数`);
    }
    const file = sourceBySlug.get(s);
    if (!file) bad(`找不到这一页的文件：${JSON.stringify(s)}`);
    let doc;
    try {
      doc = JSON.parse(fs.readFileSync(file, 'utf-8'));
    } catch (e) {
      bad(`${path.basename(file)} 不是合法 JSON：${e.message}`);
    }
    if (!isObj(doc)) bad(`${path.basename(file)} 不是一个页面对象`);
    if ('navLabel' in change) {
      if (change.navLabel === null) delete doc.navLabel; else doc.navLabel = change.navLabel.trim();
    }
    if ('navOrder' in change) doc.navOrder = change.navOrder;
    // 格式跟建站脚本 / page-write.js 写出来的逐字同形（两空格缩进 + 结尾换行）。
    writes.push({ file, content: `${JSON.stringify(doc, null, 2)}\n` });
  }
  return writes;
}

module.exports = { NAV_LABEL_MAX, REFUSED, NavWriteError, isRegularPage, navMenuOf, readNavMenu, planNavWrite };
