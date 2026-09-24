'use strict';

// editor-root.js —— 编辑器的外壳四样（#1405）：布局 / 顶栏形态 / 页脚形态 / 公告条文字。
//
// 它们在 Puck 里是 **root 字段**（整页一份，不是块列表里的一项），存盘时各回各家 —— 不进页面 JSON。
// 这份文件管三件事，全是纯 node（在站自己的容器里跑，`scripts/write-editor-save.js` 调它）：
//   · §ROOT_FIELDS    分派表：哪个字段住在哪个文件的哪个键上、是整站一份还是按语言一份
//   · §readRootValues 从站级文件读出每个字段的现值（往返守卫与写盘前的「写完以后」都用它）
//   · §planRootWrite  判 + 算出要写的字节，**不落盘**（落盘归 `lib/page-write.js` §commitWrites，
//                     跟页面那一半一起、在所有校验都过了之后）
//
// ── 分派表（住在 `lib/editor-root-fields.js`，浏览器那一侧也读它；票正文做什么 4）──────────────────
//   layout                     → site/page-layout.json 的 layoutId（它的第一个写入者就是这里）
//   headerShape / footerShape  → site/theme.json 的 regionLayout.header / .footer（#1086 那个既有的按站覆盖，
//                                不另造覆盖层；theme.json 其他键一个字节不动）
//   topbarMessage / topbarLink → site/<locale>/navigation.json 的 topbar.message / .link（构建不重写 topbar，
//                                #1087 / #1104；写之前照样过 `navigation-owned.js` 那道门）
// 🔴 那张表是唯一的一份：读、写、往返守卫都照它走。少一行 ⟹ 那个字段改了不落盘，守卫点名它
//    （`scripts/editor-root.test.js` ②）。
//
// ── 存盘前拦下构建会拒收的组合（做什么 6）──────────────────────────────────────────────────────
// `sync-config.js` 在两种组合上 exit 1：带 topbar 区 + 顶栏透明浮层；带 topbar 区 + 某种语言没有 topbar 文字。
// 以前只能手改文件拼出来，编辑器之后靠下拉就能拼 ⟹ 这里在写之前按**写完以后**的样子判，判据用构建
// 同一个 `needsTopbar` 与同一条区形态解析（`site-regions.js` §resolveSiteRegionLayout），拒了就回一句
// 给老板看的话（英文，跟 dashboard 其余文案一种语言），一个字节不写。编辑器里**不抄**这条规则。

const fs = require('fs');
const path = require('path');

const pageLayoutLib = require('./page-layout');
const siteRegions = require('./site-regions');
const navigationOwned = require('./navigation-owned');
const { linkRejection } = require('./link-href');
const { pickableShapesOf } = require('../region-layout');

const { ROOT_FIELDS } = require('./editor-root-fields');

/** 老板在编辑器里可能收到的拒收码。worker 把它原样换成状态栏那句话（`blocks_task.go`）。 */
const REFUSED = 11;

class RootWriteError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}
const refuse = (msg) => { throw new RootWriteError(REFUSED, msg); };
const bad = (msg) => { throw new RootWriteError(5, msg); };

const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

/** 文件在站里的哪儿：整站一份的在 `site/`，按语言一份的在语言目录（扁平站就是 `site/`）。 */
function fileFor(f, siteDir, localeDir) {
  return path.join(f.scope === 'site' ? siteDir : localeDir, f.file);
}

/** 读一份 JSON；不在 ⟹ `null`；坏的 ⟹ 抛（调用方说是哪一份）。 */
function readJson(file) {
  if (!fs.existsSync(file)) return null;
  const text = fs.readFileSync(file, 'utf-8');
  return { doc: JSON.parse(text), trailingNewline: text.endsWith('\n') };
}

/** 空链接（两格都空）等于没有链接 —— 编辑器里清空那两格就是「不要这个链接」。 */
function normLink(v) {
  if (!isObj(v)) return null;
  const label = typeof v.label === 'string' ? v.label : '';
  const href = typeof v.href === 'string' ? v.href : '';
  return label || href ? { label, href } : null;
}

/**
 * 每个 root 字段的**现值** —— 站的页面按这个画。形态读的是解析之后的（主题选择单 + `regionLayout` 覆盖），
 * 不是文件里那一格：老板没覆盖过时它就是主题默认，编辑器下拉里显示的也该是它。
 * @param {{ siteDir: string, localeDir: string, layoutsDir?: string }} a
 */
function readRootValues({ siteDir, localeDir, layoutsDir }) {
  const { regions } = siteRegions.resolveSiteRegionLayout(siteDir);
  const nav = readJson(path.join(localeDir, 'navigation.json'));
  const topbar = nav && isObj(nav.doc.topbar) ? nav.doc.topbar : {};
  return {
    layout: pageLayoutLib.resolveSiteLayout(siteDir, layoutsDir).layoutId,
    headerShape: regions.header.shape,
    footerShape: regions.footer.shape,
    topbarMessage: typeof topbar.message === 'string' ? topbar.message : '',
    topbarLink: normLink(topbar.link),
  };
}

/** 形状检查：这一份 root 里只许有分派表里的字段，每个的类型对。 */
function checkShape(root, layouts) {
  if (!isObj(root)) bad('root 必须是一个对象');
  const known = new Set(ROOT_FIELDS.map((f) => f.field));
  for (const k of Object.keys(root)) if (!known.has(k)) bad(`root 里有不认识的字段：${JSON.stringify(k)}`);
  if ('layout' in root && !(typeof root.layout === 'string' && layouts.has(root.layout))) {
    bad(`layout 不在布局库里：${JSON.stringify(root.layout)}（有的是 ${[...layouts.keys()].join(' / ')}）`);
  }
  for (const [field, block] of [['headerShape', 'header'], ['footerShape', 'footer']]) {
    if (!(field in root)) continue;
    const ok = pickableShapesOf(block);
    if (!(typeof root[field] === 'string' && ok.includes(root[field]))) {
      bad(`${field} 不是 blocks/${block}/ 里能挑的形态：${JSON.stringify(root[field])}（有的是 ${ok.join(' / ')}）`);
    }
  }
  if ('topbarMessage' in root && !(typeof root.topbarMessage === 'string' && root.topbarMessage.length <= 500)) {
    bad('topbarMessage 必须是不超过 500 字的字符串');
  }
  if ('topbarLink' in root) {
    const v = root.topbarLink;
    if (v !== null && !(isObj(v) && ['label', 'href'].every((k) => v[k] === undefined || (typeof v[k] === 'string' && v[k].length <= 500)))) {
      bad('topbarLink 必须是 null 或 { label, href } 两个字符串');
    }
  }
}

function setAt(doc, key, value) {
  let o = doc;
  for (const k of key.slice(0, -1)) {
    if (!isObj(o[k])) o[k] = {};
    o = o[k];
  }
  const last = key[key.length - 1];
  if (value === null || value === undefined) delete o[last]; else o[last] = value;
}

/**
 * 判这一份 root 能不能写，能写就回要写的那几份字节（绝对路径 + 内容），**不落盘**。
 *
 * @param {object} a
 * @param {string} a.siteDir     `site/`
 * @param {string} a.localeDir   这次存盘那种语言的目录（扁平站 = `site/`）
 * @param {string} a.locale      那种语言（扁平站传 ''）
 * @param {{ flat: boolean, locales: string[] }} a.shape  `site-shape.js` §readSiteShape
 * @param {object} a.root        只含**改过的**字段（编辑器逐字段比过初值，做什么 7）
 * @param {string} [a.layoutsDir]
 * @returns {{ file: string, content: string }[]}
 * @throws {RootWriteError} code 5 = 形状不对（不是编辑器发得出来的东西）· 11 = 拒收（给老板看的话）· 9 = navigation 过不了门
 */
function planRootWrite({ siteDir, localeDir, locale, shape, root, layoutsDir }) {
  const layouts = pageLayoutLib.loadLayouts(layoutsDir);
  checkShape(root, layouts);
  if (Object.keys(root).length === 0) return [];

  // ── 写完以后是什么样 ─────────────────────────────────────────────────────────────────────────
  const current = pageLayoutLib.resolveSiteLayout(siteDir, layoutsDir);
  const layoutAfter = 'layout' in root ? layouts.get(root.layout) : current.layout;
  const layoutName = layoutAfter.id;

  // 布局自己钉了页脚形态 ⟹ `regionLayout.footer` 画不出来（做什么 8）。编辑器那边下拉是灰的、不会发它；
  // 这里再挡一次，因为「存进去了、页面没变」正是这一条要防的事。
  if ('footerShape' in root && pageLayoutLib.layoutPinsFooter(layoutAfter)) {
    refuse(`The layout "${layoutName}" comes with its own footer styles, so the footer style can't be `
      + 'changed while it is selected. Nothing was changed.');
  }

  if (pageLayoutLib.needsTopbar(layoutAfter)) {
    const pending = {};
    if ('headerShape' in root) pending.header = root.headerShape;
    const headerAfter = siteRegions.resolveSiteRegionLayout(siteDir, pending).regions.header.shape;
    if (headerAfter === 'transparent-overlay') {
      refuse(`The layout "${layoutName}" has an announcement bar at the top, and the header style `
        + '"transparent-overlay" floats over the top of the page and would cover that bar completely. '
        + 'Pick another header style, or a layout without the announcement bar. Nothing was changed.');
    }
    const locales = shape.flat ? [''] : shape.locales;
    const missing = locales.filter((loc) => {
      if (loc === locale && 'topbarMessage' in root) return !root.topbarMessage.trim();
      const dir = loc ? path.join(siteDir, loc) : siteDir;
      let nav = null;
      try { nav = readJson(path.join(dir, 'navigation.json')); } catch { nav = null; }
      const t = nav && isObj(nav.doc.topbar) ? nav.doc.topbar : null;
      return !t || !String(t.message || '').trim();
    });
    if (missing.length) {
      const named = missing.map((l) => l || 'this site').join(', ');
      refuse(`The layout "${layoutName}" has an announcement bar, so it needs announcement text in every `
        + `language. Missing: ${named}. Open the editor in each of those languages, fill in the `
        + 'announcement text there first, then switch the layout. Nothing was changed.');
    }
  }

  // ── 算出每份文件写完以后的字节（照分派表，同一份文件的几个字段合在一起写）─────────────────────
  const byFile = new Map();
  for (const f of ROOT_FIELDS) {
    if (!(f.field in root)) continue;
    const file = fileFor(f, siteDir, localeDir);
    if (!byFile.has(file)) {
      let cur = null;
      try {
        cur = readJson(file);
      } catch (e) {
        bad(`${path.relative(path.dirname(siteDir), file)} 不是合法 JSON：${e.message}`);
      }
      byFile.set(file, { f, before: cur ? cur.doc : null, doc: cur && isObj(cur.doc) ? JSON.parse(JSON.stringify(cur.doc)) : {}, nl: cur ? cur.trailingNewline : true });
    }
    const entry = byFile.get(file);
    const value = f.field === 'topbarLink' ? normLink(root.topbarLink) : root[f.field];
    setAt(entry.doc, f.key, value);
  }

  const writes = [];
  for (const [file, e] of byFile) {
    if (e.f.file === 'navigation.json' && isObj(e.doc.topbar)) {
      // 构建（tsc 的 `NavigationConfig`）要 `topbar.message` 恒是字符串：只填了链接、没填文字时补一个空串。
      // 两样都空 = 老板把公告条清掉了 ⟹ 整个 `topbar` 拿掉（跟站从没写过它一样），别留一个空壳。
      if (typeof e.doc.topbar.message !== 'string') e.doc.topbar.message = '';
      if (!e.doc.topbar.message && !e.doc.topbar.link) delete e.doc.topbar;
    }
    if (e.f.file === 'navigation.json') {
      // #1416 —— 公告条链接只收那几种地址（判据在 `lib/link-href.js`，三条写入路径共用）。拿写之前那份比：
      // 文件里本来就有的不合规链接，这一次没碰它就不拦。排在下面那道门前面：这一条是给老板看的话（11），
      // 那一道是「形状过不了构建」（9）。
      const badLink = linkRejection('navigation', e.doc, e.before);
      if (badLink) refuse(badLink);
      // 构建每次重写的那几处（菜单链接 / 第一栏页脚链接 / 栏数）一个都不许动，形状要过得了构建 ——
      // 判据是 `navigation-owned.js` 那一道门本身（AI 聊天编辑器写这个文件也过它），不在这里另列字段名。
      const why = navigationOwned.navigationEditRejection(e.doc, e.before);
      if (why) throw new RootWriteError(9, why);
    }
    // 🔴 写回的格式跟原文件一样：两空格缩进；原文件末尾有没有换行照原样（sync-config 写 navigation.json
    //    不带换行，worker 写 theme.json 带）—— 不然 diff 里会多出一行跟这次改动无关的变化。
    writes.push({ file, content: JSON.stringify(e.doc, null, 2) + (e.nl ? '\n' : '') });
  }
  return writes;
}

module.exports = { ROOT_FIELDS, REFUSED, RootWriteError, readRootValues, planRootWrite, normLink };
