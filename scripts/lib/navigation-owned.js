'use strict';

/**
 * navigation-owned.js — `site/<locale>/navigation.json` 里，哪几处是【构建自己重写的】？（#1104）
 *
 *   const { navigationEditRejection } = require('./lib/navigation-owned.js');
 *   const why = navigationEditRejection(next, current);   // null = 可以写；字符串 = 拒，这句话回给模型
 *
 * ── 为什么要有它 ────────────────────────────────────────────────────────────────────────────────
 * 每一页顶部（和手机菜单里）那个按钮的文字和链接住在这个文件的 `header.cta`。#1087 把整个
 * `navigation.json` 从 AI 聊天编辑器手里拿掉了，理由是对的 —— 模型整份重写它，会让**菜单链接**
 * 那一半在下一次构建时被抹掉，而聊天窗口说"改好了"（静默失败）。但顺带把 `header.cta` 也关掉了，
 * 于是老板最常想改的一句文案变成了产品里**没有任何地方**能改的东西。
 *
 * 这个模块开的是一道窄口子：**构建会重写的地方一律拒，构建不碰的地方放行。**
 *
 * 🔴 拒的时候说的话必须是真话，而且要点名去哪儿改。#1087 为这一条付过两轮账：r1 那句只描述了链接
 *    那一半（对 `header.cta` 是反的），r2 改完之后 QA2 在真容器上量到模型替老板编了一个不存在的
 *    后台页面（逐字是「Go to your Dashboard → Navigation settings」）。所以这里拒绝的理由里带着
 *    「去改那一页的 navLabel / navOrder」，而不是「去某个设置页」—— 产品里没有那个页面。
 *
 * ── 判据是「构建重写了哪几处」，不是一张字段名单 ────────────────────────────────────────────────
 * 抄一张字段清单会漂：明天有人往 `sync-config.js` 里加一句
 * `existingNav.footer.description = …`，清单不会跟着变，而那一刻这道门就开始放行一个**会被覆盖**
 * 的字段 —— 也就是本票要治的那个静默失败原样回来，而且没有任何东西会红。
 *
 * 所以这里的 `OWNED` 每一项都写着它在 `sync-config.js` 里对应的那条**赋值语句原文**
 * （`syncConfigWrite`），并且由 `navigation-owned.test.js` 用真解析器把那个文件里
 * **所有**写进 navigation.json 的位置解析出来，跟这张表两向比对：
 *   · 表里有、代码里没有 ⟹ 这条已经不成立了（多拒了一个字段，老板改不了本来能改的东西）
 *   · 代码里有、表里没有 ⟹ **放行了一个会被覆盖的字段**，就是上面那句话说的那件事
 * 少了那道比对，这个模块就只是「另一张会漂的名单」。
 */

/** 深比较：JSON 里只有对象/数组/原值，所以按结构逐层比，键序不算差异。 */
function sameValue(a, b) {
  if (a === b) return true;
  if (typeof a !== typeof b) return false;
  if (a === null || b === null) return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  if (typeof a !== 'object') return false;
  if (Array.isArray(a)) {
    return a.length === b.length && a.every((v, i) => sameValue(v, b[i]));
  }
  const ka = Object.keys(a).sort();
  const kb = Object.keys(b).sort();
  if (ka.length !== kb.length || ka.some((k, i) => k !== kb[i])) return false;
  return ka.every((k) => sameValue(a[k], b[k]));
}

const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

/**
 * 构建拥有的那几处。`read` 取出这一处的值（拿它跟磁盘上那份比），`label` 是回给模型的说法，
 * `syncConfigWrite` 是 `sync-config.js` 里写它的那条语句原文（测试拿它跟真代码两向比对）。
 *
 * 🔴 第三项是**格数**、不是每一栏的内容：`sync-config.js` 的 `hasKeywordColumns`
 * （`columns.length > 1`）决定构建还要不要追加"关键词分组"那些页脚栏。模型自己加一栏 ⟹ 那个
 * 判断从此恒真 ⟹ 关键词分组永远不会被加上，而这件事是静默的。栏**里面**的标题构建不碰，放行。
 *
 * ── `rebuiltFrom` / `remediation` 为什么是**每项一份**，不是三项共用一句 ────────────────────────
 * #1104 r6（QA1 r5 那条 🟡）。三项原来共用一句拒绝理由，那句话把原因写死成「构建每次从各页自己的
 * navLabel / navOrder 重建它」，补救办法写成「去改那一页的 navLabel / navOrder」。对前两项这是真话
 * （`regularPages` 按 `navOrder` 排、按 `navLabel` 取字，`sync-config.js`）；**对第三项是假话** ——
 * 页脚有几栏来自关键词页按 service slug 分的组（`keywordPages` + `columns.push`），跟 navLabel /
 * navOrder 一点关系都没有。后果：老板想加一个页脚栏目，被正确地拒绝了，然后拿到一个照做也长不出
 * 栏目的补救办法。**这跟本票要治的病是同一个（说的话跟真实发生的事对不上），只是换了个方向。**
 *
 * 🔴 这两句话同样不许写死成散文：`rebuiltFromCode` 是 `sync-config.js` 里让它成为真话的那几句原文，
 *    由 `navigation-owned.test.js` 的 ⑭ 拿它跟真代码比 —— 哪天那段逻辑改了，这句话当场红。
 *    （同 `SIDE_EFFECTS[].coupling` 的做法，理由也一样。）
 */
const OWNED = [
  {
    key: 'header.links',
    label: 'the header menu links (header.links)',
    syncConfigWrite: 'header.links',
    rebuiltFrom: "each page's own navLabel / navOrder",
    remediation: "To change a menu entry, change that page's navLabel; to reorder the menu, change its navOrder.",
    rebuiltFromCode: ['p.navLabel', 'a.navOrder'],
    read: (nav) => (isObj(nav) && isObj(nav.header) ? nav.header.links : undefined),
  },
  {
    key: 'footer.columns[0].links',
    label: "the first footer column's links (footer.columns[0].links)",
    syncConfigWrite: 'footer.columns[0].links',
    rebuiltFrom: "each page's own navLabel / navOrder",
    remediation: "To change one of those links, change that page's navLabel; to reorder them, change its navOrder.",
    rebuiltFromCode: ['p.navLabel', 'a.navOrder'],
    read: (nav) => {
      if (!isObj(nav) || !isObj(nav.footer) || !Array.isArray(nav.footer.columns)) return undefined;
      const first = nav.footer.columns[0];
      return isObj(first) ? first.links : undefined;
    },
  },
  {
    key: 'footer.columns.length',
    label: 'how many footer columns there are (footer.columns)',
    syncConfigWrite: 'footer.columns.push',
    // 🔴 这一项跟上面两项**不是**同一个来源，所以补救办法也不一样。navLabel / navOrder 改不出一个
    //    页脚栏目来（那是关键词页那条路）—— 说它能，就是给老板一个照做也不会发生的办法。
    rebuiltFrom: "the site's keyword pages, grouped by service — one extra column per service",
    remediation: 'This is not something to set here: add or remove keyword pages instead. Adding a column '
      + 'by hand also permanently stops the build from ever adding those keyword groups, because it only '
      + 'adds them when there is exactly one column.',
    rebuiltFromCode: ['const keywordPages =', 'const hasKeywordColumns =', 'footer.columns.push'],
    read: (nav) => {
      if (!isObj(nav) || !isObj(nav.footer) || !Array.isArray(nav.footer.columns)) return undefined;
      return nav.footer.columns.length;
    },
  },
];

/**
 * 放行之后【别的地方】会跟着变的那些改动 —— 必须说出来。
 *
 * #1104 r2（QA1 中等②）。本票《实施要点》给这几个字段放行的理由原话是「这几个字段构建不覆盖 ——
 * 写进去就是真的生效，不存在 #1087 要防的那种静默失败」。这条前提对 `header.cta.href` **不成立**：
 * 它自己不会被覆盖，但 `sync-config.js` 拿它算出 `ctaSlug`，再用 `ctaSlug` 把那一页从顶部菜单里
 * 过滤掉。所以老板说「把顶部按钮改成链到 About 页」，实际发生的是：按钮改了 + About 从菜单里消失
 * + 原来那一页（Get a Quote）出现在菜单里 —— 而聊天窗口只会说按钮改好了。
 *
 * 🔴 「菜单里不重复出现 CTA 指向的那一页」很可能是模板有意的设计，所以这里**不拦**、也不动那个
 * 过滤：错的不是这个行为，是**没有人被告知**。要不要改成拦、或者改那个过滤，是产品判断（#1104
 * 交接留言里已经把这个问题摆给 PM）。这里做的是把它说成实话 —— 跟 #1087 r2「把拒绝理由改成实话」
 * 同一条线。
 *
 * 判据不许写死成散文：`coupling` 是 `sync-config.js` 里那两句的原文，测试拿它跟真代码比 ——
 * 哪天那个过滤被拿掉了，这段话就成了假话，那一格当场红。
 */
const SIDE_EFFECTS = [
  {
    key: 'header.cta.href',
    read: (nav) => (isObj(nav) && isObj(nav.header) && isObj(nav.header.cta) ? nav.header.cta.href : undefined),
    coupling: ['const ctaSlug =', 'p.slug !== ctaSlug'],
    note: (from, to) => 'One more thing to tell the owner: the top menu is rebuilt from the site\'s pages every '
      + 'time, and the page the header button points at is deliberately left out of that menu. Because this edit '
      + `changed the button's link from "${from}" to "${to}", the next build will also change the menu itself — `
      + `the page at "${to}" will drop out of the top menu, and the page at "${from}" will appear in it. `
      + 'Nothing else was changed. Say this out loud instead of only reporting that the button was updated.',
  },
];

/**
 * 放行了、也真的写进了文件，**而这个站的页面根本不读它** —— 必须说出来。
 *
 * #1104 r6（QA2 r5 那条中等，作者把正文的判据补成了两条）。原来的判据只有一条「构建会不会重写它」，
 * 而它对「写进去就是真的生效」只是必要条件：`footer.columns[].title` 构建确实不碰，可页面上只有
 * `multi-column` 那一支页脚渲染它 —— 换句话说 110 套主题里 72 套的站，老板改了栏目标题，聊天说
 * 「已完成」，页面上一个像素都不变。那正是本票要消灭的那个病（说成功、其实没生效），只是机制从
 * 「构建覆盖它」换成了「页面从来不读它」。
 *
 * 🔴 为什么是「照写 + 说实话」而不是「拒」：拒要动放行的边界（那 15 种正当编辑得重证一遍），还会
 *    关掉 topbar 那条已经验通的路（#1108 的路 A 靠它）；而存进去的值不是垃圾 —— 这个站换成
 *    `multi-column` 页脚那天它就显示了。
 *
 * ── 每一格钉着它在组件里的渲染点 ────────────────────────────────────────────────────────────────
 * `renderedBy` 不是一张手写的字段名单 —— `navigation-owned.test.js` 的 ⑫ 用 **TypeScript 自己的
 * 解析器**把 `Footer.tsx` / `Header.tsx` 按 `data-region-layout` 拆成各支，逐支解出「这一支读了
 * navigation.json 的哪几处」（跟着 `const copyright = …` 这类别名走，也跟着 `columns.map(c => …)`
 * 的回调参数走），再跟这张表两向比对：
 *   · 表里说这一支渲染它、解析器说没有 ⟹ 渲染点没了，而这句话现在会漏说（老板拿到「已完成」）
 *   · 解析器说渲染了、表里没写 ⟹ 我们会对一个真的会显示的字段说「你这个站不显示它」= 新的假话
 * 少了那道比对，这张表就只是「另一张会漂的名单」。
 *
 * 📌 `header.cta` 和 `footer.copyright` 也在表里，而它们的 `renderedBy` 覆盖了各自那一类区的**全部**
 *    版式 ⟹ 按下面 `alwaysRendered` 那条规则，它们**永远**不会多出这句话（AC3）。这不是靠「别把
 *    它们写进表」做到的（那样就没人盯着它们的渲染点了），是靠那道比对：哪天有人从某一支页脚里删掉
 *    版权行，⑫ 当场红，而且它们同时不再是「永远看得见」的那一类。
 */

// 🔴 「一共有哪些版式」和「哪几类区每一页必然有」从它们各自的唯一出处取，**不在这里抄一份**。
//    下面 `renderedBy` 是另一回事：它是一句关于「哪几支真的画了这个字段」的断言，今天有两格恰好
//    等于全集，但它由 ⑫ 对着组件两向核对，不是抄来的。两者混成一个值，就再没有东西能红了。
const { HEADER_VARIANTS, FOOTER_VARIANTS, TOPBAR_VARIANTS } = require('../region-layout');
const { REQUIRED_KINDS } = require('./page-layout');

/** 每一类区一共有哪些版式（唯一出处 `scripts/region-layout.js`）。 */
const VARIANTS_BY_REGION = {
  header: HEADER_VARIANTS,
  footer: FOOTER_VARIANTS,
  topbar: TOPBAR_VARIANTS,
};

const PAGE_READS = [
  {
    key: 'header.cta',
    region: 'header',
    // 顶栏四种结构全部渲染那个按钮（三种直接用 `const cta = …` 那个别名，`cta-band` 页脚里
    // 还另有一份）。所以它永远不会走到下面那句话 —— 本票的正文说它「读不到的站 = 0」。
    renderedBy: ['solid-bar', 'transparent-overlay', 'centered-logo', 'pill-floating'],
    renderPaths: ['header.cta.label', 'header.cta.href'],
    what: 'the button at the top of every page',
    read: (nav) => (isObj(nav) && isObj(nav.header) ? nav.header.cta : undefined),
  },
  {
    key: 'footer.copyright',
    region: 'footer',
    // 三支都读。前两支读的是 `const copyright = …` 那个别名（`Footer.tsx` 里 hoist 出来的一个
    // 变量），只 grep 字段名会漏掉它们 —— ⑫ 那把解析器跟着别名走，所以这一格是量出来的。
    renderedBy: ['slim-row', 'cta-band', 'multi-column'],
    renderPaths: ['footer.copyright'],
    what: 'the copyright line at the bottom of every page',
    read: (nav) => (isObj(nav) && isObj(nav.footer) ? nav.footer.copyright : undefined),
  },
  {
    key: 'footer.description',
    region: 'footer',
    renderedBy: ['cta-band', 'multi-column'],
    renderPaths: ['footer.description'],
    what: 'the short blurb in the footer',
    read: (nav) => (isObj(nav) && isObj(nav.footer) ? nav.footer.description : undefined),
  },
  {
    key: 'footer.columns[].title',
    region: 'footer',
    renderedBy: ['multi-column'],
    renderPaths: ['footer.columns[].title'],
    what: 'the footer column titles',
    read: (nav) => {
      if (!isObj(nav) || !isObj(nav.footer) || !Array.isArray(nav.footer.columns)) return undefined;
      return nav.footer.columns.map((c) => (isObj(c) ? c.title : undefined));
    },
  },
  {
    // 🔴 `read` 从**第二栏起**取，第一栏不在这里:`footer.columns[0].links` 归 `OWNED`（构建每次
    //    重写它）⟹ 改它根本走不到这一步，是被拒的。而**渲染点**是同一处（`footer.columns[].links`），
    //    所以 `renderPaths` 写的是不带下标那个 —— 两者管的是两件事：一个是「这次改了什么」，
    //    一个是「页面上谁在画它」。
    // 📌 `slim-row` 只印扁平之后的前 6 条 —— 那一维（第 7 条起看不见）**不在本票范围内**（正文
    //    《不在本票范围内》点名了它），所以这里把 `slim-row` 算作「读它」。
    key: 'footer.columns[>0].links',
    region: 'footer',
    renderedBy: ['slim-row', 'multi-column'],
    renderPaths: ['footer.columns[].links'],
    what: 'the links in the footer columns after the first one',
    read: (nav) => {
      if (!isObj(nav) || !isObj(nav.footer) || !Array.isArray(nav.footer.columns)) return undefined;
      return nav.footer.columns.slice(1).map((c) => (isObj(c) ? c.links : undefined));
    },
  },
  {
    // topbar 那一格判的不是「哪种版式」，是**这个站的页面上有没有那个区** —— 页面版式库里只有
    // `with-topbar` 带它，默认的 `standard` 没有（`scripts/lib/page-layout.js`）。所以
    // `renderedBy` 列的是全部 topbar 版式：区在，四种结构都画它；区不在，一种都画不到。
    key: 'topbar',
    region: 'topbar',
    renderedBy: ['solid', 'bordered', 'dismissible', 'floating'],
    renderPaths: ['topbar.message'],
    what: 'the thin strip above the header',
    read: (nav) => (isObj(nav) ? nav.topbar : undefined),
  },
];

/**
 * 这个站**真的渲染出来**的那些区，按类分。由 `lib/site-regions.js` 算（构建用的是同一份实现）。
 *
 * @typedef {{header: string[], footer: string[], topbar: string[]}} RenderedRegions
 */

/** 这一格在这个站的页面上画得出来吗 —— 它要的那些版式，跟这个站真的渲染的那些，有没有交集。 */
function notRenderedHere(entry, rendered) {
  const mine = (rendered && rendered[entry.region]) || [];
  return !mine.some((v) => entry.renderedBy.includes(v));
}

/**
 * 这一格**在任何站上都看得见** —— 于是它永远不该多出下面那句话（AC3：多说一句就是新的假话）。
 *
 * 两个条件都要满足，而它们各自管一种「看不见」的成因：
 *   ① 这一类区的**每一种**版式都画它 —— 否则换个版式就看不见了（`footer.columns[].title` 是这样）
 *   ② 这一类区**每一页必然有** —— 否则区自己就可能不存在（`topbar` 是这样：它 renderedBy 列了
 *      全部四种 topbar 版式，可默认页面版式根本没有这个区，所以它不是「永远看得见」的那一类）
 *
 * 🔴 两个条件都从各自的唯一出处算，没有第三张名单。而 ① 里那个「每一种都画它」是 ⑫ 对着
 *    `Footer.tsx` / `Header.tsx` 两向核过的读数 —— 哪天有人从某一支页脚里删掉版权行，⑫ 当场红，
 *    而且 `footer.copyright` 同时不再算「永远看得见」，于是它开始正常说那句话。
 */
function alwaysRendered(entry) {
  const all = VARIANTS_BY_REGION[entry.region] || [];
  const coversEveryVariant = all.length > 0 && all.every((v) => entry.renderedBy.includes(v));
  return coversEveryVariant && REQUIRED_KINDS.includes(entry.region);
}

/**
 * 一格「写进去了、但你这个站看不到」的话。
 *
 * 🔴 主语写成「the change to …」而不是直接把字段名当主语：`what` 有单数也有复数
 * （"the footer column titles" / "the thin strip"），直接接 `was saved` 会写出 "the footer column
 * titles was saved" —— 这句话是原文交到老板手里的，不是给程序读的。
 * 🔴 最后那半句「换个什么就能看见」两种成因说法不一样：版式那一路换的是页脚样式，topbar 那一路
 * 缺的是**整个区**，换样式不会长出来 —— 说错了等于又给一个照做没用的办法。
 */
function invisibleNote(entry, rendered) {
  const mine = (rendered && rendered[entry.region]) || [];
  const regionMissing = mine.length === 0;
  const where = regionMissing
    ? `this site's pages do not have ${entry.what.replace(/^the /, 'a ')} at all`
    : `this site's ${entry.region} is the ${mine.map((v) => `"${v}"`).join(' + ')} style, which does not show it`;
  const later = regionMissing
    ? 'The value is kept and will show up if this site ever uses a page layout that has it.'
    : 'The value is kept and will show up if this site ever uses a style that shows it.';
  return `One more thing to tell the owner: the change to ${entry.what} (${entry.key}) was saved, but `
    + `nothing on the site will look different — ${where}. ${later} `
    + 'Say this out loud instead of only reporting that it was updated.';
}

/**
 * 这次要写的那份里，`NAV_SHAPE` **没有声明**的键有哪些（#1128）。
 *
 * ── 为什么这一格存在 ────────────────────────────────────────────────────────────────────────────
 * 老板说一句「把页脚版权改成 X」，模型把它写进 `footer.copyRight`（大写的 R）—— 原来那个
 * `copyright` 一个字没动。这道门放行（下面那条 🔴 说的就是它，方向仍然是对的）、构建 rc=0、
 * 聊天说「改好了」，而页面上一个字都没变。QA2 在 #1104 r4 的真站上量到的两臂：
 *
 *     footer 多一个 copyRight（原 copyright 仍在）   门 ✅ 放行 · 构建 rc=0 · 页面命中 0 / 18 个 HTML
 *     header.cta 多一个 text（label 没动）           门 ✅ 放行 · 构建 rc=0 · 页面命中 0 / 18
 *     而真的 copyright 与 label 照常显示                                        各 9 / 18
 *
 * 系统这时候**知道**答案（那个键不在它声明的形状里），只是没说 —— 这跟 #1087 → #1104 一路在治的
 * 是同一件事（把静默失败说成实话）。
 *
 * ── 为什么是「照写 + 说实话」而不是「拒」 ────────────────────────────────────────────────────────
 * 跟 `PAGE_READS` 那一路同一个理由（#1104 r6 写在它上面那段），再加一条本票自己的读数：
 * 「拒」会翻掉 #1104 里 QA1 那 15 种**正当编辑**中的 3 种（顶层 / footer / cta 各加一个陌生键），
 * 而那 15 种是本票 AC3 明文要求「一个都不许被拦住」的 —— 两条 AC 就同时不可满足了。
 * 本票正文给了这条岔路：「如果 DEV 量出『拒』会挡住某种正当写法，选 2 也满足本票」。
 * 于是这里走「写进去 + 在回给老板的话里点名」，而下面那条 🔴「不认识的键一律放过」原样成立。
 *
 * ── 判据不是一张键名清单 ────────────────────────────────────────────────────────────────────────
 * 问的是「这个键在不在 `NAV_SHAPE` 里」，而 `NAV_SHAPE` 由 `navigation-owned.test.js` 的 ⑩ 用
 * TypeScript 自己的解析器跟 `NavigationConfig` 两向钉住 ⟹ **没有第二份名单会漂。**
 *
 * 🔴 #1134 —— 这里原来接着一句「哪天那个 interface 加一个字段，这里**自动**就不再把它当陌生键」，
 * 而那句话是**假的**，机制正好相反。实测（往 `src/lib/types/config.ts` 的 `NavigationConfig.header`
 * 加一个 `tagline: string`，其余什么都不动）：
 *     基线            node scripts/lib/navigation-owned.test.js → 通过 29 · 失败 0
 *     加了那个字段之后 同一条命令                              → 通过 28 · 失败 1（⑩ 红）
 *     而 undeclaredKeyPaths({… tagline:'x' …})                → ["header.tagline"]  ← 照旧当陌生键
 * 真机制是「**⑩ 当场红、逼人回来补 `NAV_SHAPE`**」，不是「自动跟着走」——`NAV_SHAPE` 是这个文件里
 * 手写的一份声明，没有任何东西在运行时去读那个 interface。
 * 📌 而后半句「没有第二份名单会漂」**是真的**，并且它成立**正是靠这一红**：两份名单确实存在，只是
 *    它们不许分叉，而 ⑩ 就是那道不许。把机制说成「自动」的代价是：下一个加字段的人以为不用管，
 *    看到 ⑩ 红了会当成回归去绕，而那一红正是在叫他补名单。
 *
 * 🔴 陌生子树只报最外面那一层（`footer.extra` 而不是 `footer.extra.a.b`）：里面每一层都同样没人读，
 *    逐层报出来只是把同一件事说成好几件，而这句话是原文交到老板手里的。
 */
function undeclaredKeys(value, shape, at, out) {
  if (value === undefined || value === null) return out;
  if (shape.kind === 'array') {
    if (Array.isArray(value)) value.forEach((item, i) => undeclaredKeys(item, shape.of, `${at}[${i}]`, out));
    return out;
  }
  if (shape.kind !== 'object' || !isObj(value)) return out;
  for (const key of Object.keys(value)) {
    if (!Object.prototype.hasOwnProperty.call(shape.fields, key)) out.push(at ? `${at}.${key}` : key);
  }
  for (const [key, sub] of Object.entries(shape.fields)) {
    undeclaredKeys(value[key], sub, at ? `${at}.${key}` : key, out);
  }
  return out;
}

/** 这次要写的那份里，声明的形状之外多出来的那些键（顶层路径）。 */
function undeclaredKeyPaths(nav) {
  return undeclaredKeys(nav, NAV_SHAPE, '', []);
}

/**
 * 一格「这几个键谁都不读」的话。
 *
 * 🔴 措辞按真机读数校过，不许写成「构建不读它」那种笼统说法：真站 `site-e4da0161`（多栏页脚）
 *    上把 `footer.copyRight` 落盘再真构建，那个键**确实一路走到了产物里** ——
 *    `src/lib/config-data.ts` 1 处、`_next/static/chunks/248-*.js` 1 处（连值一起，也就是它还发给了
 *    每一个访客的浏览器）；而 20 个 HTML 里那个值命中 **0**，同一把 grep 量真的 `footer.copyright`
 *    命中 **10**（尺子有牙）。⟹ 真话是「谁都不读它」，不是「构建不碰它」。
 * 🔴 三件事都要说，少一件就还是那个静默失败换个样子：① 点名是**哪几个键**（不说一句笼统的
 *    「有些键不对」—— 老板要的就是那个键名）② 说清后果是**页面不会变**（不是「可能不生效」）
 *    ③ 给一条照做有用的路：这里能改的字段就那几个，用对名字再写一遍。
 *
 * ── #1136：这段话此前会让模型对老板说一句假话 ──────────────────────────────────────────────────
 * 同一句老板需求（`Add our phone number 416-555-0134 to the top bar.`，**一个字没提键名**）反复跑，
 * 模型每次都自己臆造一个陌生键（`topbar.items` 或 `topbar.phone`），而回给老板的话常常说它已经不在
 * 文件里了 —— 磁盘上那个键其实还在，#1128 那轮的 r1 连自动保存的 commit（`361ccd5`）都带着它：
 *
 *     r1  `I've removed it to keep the file clean`                 键还在  假
 *     r2  `won't actually appear that way`（没声称删过）            键还在  真
 *     r3  `only the core topbar config was saved`                  键还在  假
 *     r4  `I'll clean that up now in a follow-up write`            键还在  假（那一轮一共只写了 2 次）
 *
 * 上面那 4 臂是 #1128 的 QA2 跑的（`/root/qa2-1128/out/natural2*`）。#1136 在**同一份字节**上又跑了
 * 8 臂（`baf907d5`）：其中 1 臂模型自己第三次写盘把键清了（那一臂没有可谎报的东西），剩下 7 臂里
 * 2 次说了假话。**这句话是间歇性的，不是每次都说** —— 合起来 11 臂有得可谎报、5 次说了假话；换成
 * 下面这版措辞后 10 臂 0 次。⟹ 4 臂的读数不足以判它好了，本格的判据是十几臂的比例。
 *
 * 两处措辞在喂这三种说法，改的就是它们：
 *   ① **`not part of navigation.json`** 想说的是「不在声明的形状里」，可它同样读得成**「没进这个
 *      文件」** —— r3 的「只保存了核心配置」正是这一读法。改成先把事实钉死：这几个键**就在刚存下
 *      的那份里**。
 *   ② **`Write the file again without those keys`** 是一句祈使句，模型会把「该做的事」当成「已做完
 *      的事」报出去（r1）或者许一个不会兑现的诺（r4）。改成：清理这件事只有「这一轮再写一次」这一
 *      条路，没写就一个字都不许说它已经清了 —— 并且把**该说什么**正面给出来（模型会原样转述，这是
 *      #1104 r6 QA2 在真机上量到的：给它一句实话，三次都原样转给了老板）。
 * 🔴 不许把处方写成「现在就再写一次把它删掉」：那会把模型推去做一次纯删除的写入，然后如实说
 *    「我删掉了」—— 假话没了，可 AC1 要的是这类说法**一次都不出现**。所以处方只留真正值得做的那
 *    一件：老板要的那个字段有正名的话，用正名再写一遍。
 * 🔴 「把它们去掉」这层意思保留，但改成**条件式**（用正名重写时它自然就没了）：写进去而谁都不读
 *    的字节会留在站仓里误导下一个读它的人（#1128 正文点名的那条代价）。
 * 🔴 最后那句「不许说【构建】不读它」是量出来的，不是顺手加的：本票第一版措辞跑 5 臂，假话
 *    **0 次**（要治的那件事成了），可 5 臂里 5 臂都把「谁都不读它」压成了「the build doesn't
 *    read it」/「isn't read by the build」/「no part of the build looks at it」—— 而那句话本身是假的，
 *    出处就在这段注释开头那条 🔴（真站上那个键一路进了 `src/lib/config-data.ts` 和
 *    `_next/static/chunks/248-*.js`，也就是它连每个访客的浏览器都收到了；没有的是**页面去看它**）。
 *    加上这一句之后再跑 5 臂：3 臂改口说成「no page reads it / no part of the site reads it」并且
 *    带上了「构建把它抄进产物、连访客浏览器都收到」这半句，1 臂两种说法都给，1 臂仍说「the build
 *    reads」。⟹ 只给机制不够，模型会自己压缩，压出来的正好是这里禁掉的那句。
 *    **行动结论不变：别把这一句当成已经关掉的洞。**
 *
 * 🔴 #1134 —— 但「好了大半」这个程度词是**在只有 5 臂时**写下的，全样本上立不住。把 QA2 的 11 臂、
 *    QA3 的 4 臂、PM 的 3 臂一起算：
 *        加禁令前  5/5   说成「构建不读它」   (n=5)
 *        加禁令后  14/23 仍然这么说            (n=23)
 *    也就是仍有**六成**这么说 —— 不是「好了大半」。
 * 🔴 判据要连着一起写，否则下一个人重算会拿到另一个数而不知道谁对。可用的判据是：
 *    **「同一句里 `build` 与 读/看 之间没有插入别的主语，且带否定」，逐句打出原文由人读。**
 *    别用正则近似 —— #1136 那次做了两把尺，**两把都瞎**：第一把 `(?:is|are)\s+not` 不匹配 `isn't`；
 *    第二把连给它做校准的粗 grep 也共享同一个盲点，于是**校准通过而两把尺同时失明**，QA2/QA3 那
 *    15 臂整组读到 0。一把尺和它的校准共享盲点时，绿是同盲，不是印证。
 */
function undeclaredKeysNote(paths) {
  const one = paths.length === 1;
  const key = one ? 'that key' : 'those keys';
  const it = one ? 'it' : 'them';
  return 'One more thing to tell the owner: the file was saved, and '
    + `${one ? 'this key is' : 'these keys are'} still in the copy that was just written. `
    + `${one ? 'It is' : 'They are'} not ${one ? 'a field' : 'fields'} of navigation.json, so nothing `
    + `reads ${it}: the build copies the file through as it is, and then no page ever looks at ${key}, `
    + `so ${one ? 'it changes' : 'they change'} nothing on the site:\n`
    + paths.map((k) => `  - ${k}`).join('\n')
    + `\nTell the owner what the file now holds — in your own words, but do not change what it says: `
    + `the file was saved with ${key} in it, nothing reads ${it}, and the page will not change because `
    + `of ${it}. If what the owner asked for is one of the fields that can be changed here, write the `
    + `file again using that field name — that is the fix worth doing, and ${key} ${one ? 'goes' : 'go'} `
    + `away with it. ${NAVIGATION_EDITABLE_SUMMARY}\n`
    + `${key.charAt(0).toUpperCase()}${key.slice(1)} ${one ? 'is' : 'are'} on disk right now: this write `
    + `kept ${it} and nothing else in this edit takes ${it} out. So do not tell the owner that you `
    + `removed ${it}, that only the recognised fields were saved, or that you will clean ${it} up in a `
    + `moment — the owner cannot open the file to check, and all three are false. And do not say the `
    + `build does not read ${it}: the build does copy ${it} into what it builds, ${one ? 'it is' : 'they are'} `
    + `even sent to every visitor's browser — what never happens is a page looking at ${it}. Say this `
    + 'out loud instead of only reporting that the file was updated.';
}

/** 这次放行的改动会引起哪些「别处也跟着变」。返回给模型看的那几句话（没有就是空数组）。 */
function navigationEditSideEffects(next, current, rendered) {
  const out = [];

  // #1128 —— 声明的形状之外多出来的键。放行是对的（`as` 那种 cast 不管它们，拒的方向是「这个站
  // 改不动」），但它们谁都不读 ⟹ 不说就是本票要治的那个静默失败。整段理由在 `undeclaredKeys` 上面。
  // 🔴 排在最前面：这一条说的是「你写进去的那部分根本没生效」，下面几条说的是「生效了，而且别处
  //    也跟着变 / 你这个站看不到」。先说没生效的那半，模型才可能在同一轮里把名字改对。
  // 🔴 按 `next` 里现有的全部陌生键报，不是只报「这一次新加的」：磁盘上那份原来就带一个陌生键时，
  //    「这次没动它」跟「它有人读」是两件事，而后者永远是假的。实测这台机器上 367 份真
  //    navigation.json，带形状外键的 0 份 ⟹ 今天这条路只会被模型自己新写进去的键点亮。
  const undeclared = undeclaredKeyPaths(next);
  if (undeclared.length > 0) out.push(undeclaredKeysNote(undeclared));
  for (const e of SIDE_EFFECTS) {
    const from = e.read(current);
    const to = e.read(next);
    if (from === undefined || to === undefined) continue;   // 形状不齐那一路由 shapeProblems 管
    if (!sameValue(from, to)) out.push(e.note(from, to));
  }

  // 🔴 `undefined` 在这里【不能】跳过（跟上面那半相反）：`topbar` 是可选的，「这个站原来没有
  //    topbar，模型给它加了一段」正是最该说话的那一次。上面那半跳过 undefined 是因为它算的是
  //    「从 A 变成 B」的后果，两端都得有值。
  // 🔴 `alwaysRendered` 那几格在这里就摘掉，两条路（算得出版式 / 算不出）都摘 —— 这是 AC3：
  //    它们在任何站上都真生效，对它们多说任何一句「可能没生效 / 没法确认」都是新造一句假话，
  //    而本票的全部意义就是别让老板听到假话。
  const changed = PAGE_READS
    .filter((e) => !alwaysRendered(e))
    .filter((e) => !sameValue(e.read(current), e.read(next)));
  if (changed.length === 0) return out;

  // 🔴 算不出这个站的版式时**不许沉默**：沉默正好等于本票要治的那个病（说成功、其实没生效）。
  //    说一句「我说不准」是诚实的，而且它跟真的看不见长得不一样，排查时分得开。
  //    它**点名是哪几个字段**没法确认，不说一句笼统的「这次编辑」—— 同一次编辑里可能还改了别的
  //    确定生效的字段（比如同时改了按钮和栏目标题），笼统那句会把确定生效的那半也说成没底。
  if (!rendered) {
    out.push('One more thing to tell the owner: the change was saved, but this site\'s page layout could '
      + 'not be worked out just now, so whether the change to '
      + changed.map((e) => `${e.what} (${e.key})`).join(' and ')
      + ' actually shows up on the page could not be checked. Say this out loud instead of only '
      + 'reporting that it was updated.');
    return out;
  }

  for (const e of changed) {
    if (notRenderedHere(e, rendered)) out.push(invisibleNote(e, rendered));
  }
  return out;
}

/** 哪几处跟磁盘上那份不一样。返回 OWNED 里的那些项。 */
function buildOwnedChanges(next, current) {
  return OWNED.filter((o) => !sameValue(o.read(next), o.read(current)));
}

/**
 * 构建读 navigation.json 的**全部**形状 —— 少了一处、或者某一处的值不是这个类型，这个站从此建不出来。
 *
 * 🔴 #1104 r3（QA3 阻断）：上一版这里只查 `sync-config.js` 直接读的那两处（`header.cta.href` 拿去
 *    `.replace`、`footer.columns` 拿去取 `.length`），漏掉了**第三个读者：tsc**。
 *    `src/lib/config.ts:26` 把构建生成的那份数据 cast 成 `Record<string, NavigationConfig>`，
 *    任何字段跟那个类型对不上都让 `npm run build` 整个死掉。实测（本票 r3，skipAI 真站 + 真 tsc）：
 *
 *      老板说「把页脚的版权行去掉」→ 这道门放行 → sync-config.js rc=0（#1087 那道保存前检查
 *      也就看不见）→ 聊天说「改好了」→ 自动保存 push 进站仓 → 下一次构建 rc=1，从此建不出来。
 *      同一形状还有 5 种：copyright=null / copyright=对象 / description=数组 / 栏标题=对象 /
 *      topbar=字符串。六种全部「门放行 + tsc rc=2」。
 *
 * ── 判据同样不许写死成会漂的名单 ────────────────────────────────────────────────────────────────
 * `NAV_SHAPE` 是 `src/lib/types/config.ts` 里 `NavigationConfig`（连着它引用的 `NavLink` /
 * `FooterColumn`）的镜像。镜像会漂 —— 明天有人往那个 interface 里加一个必需字段，这里不会跟着变，
 * 而那一刻这道门又开始放行一份让构建死掉的文件。所以 `navigation-owned.test.js` 的 ⑩ 用
 * **TypeScript 自己的解析器**把那个 interface 读出来，跟 `NAV_SHAPE` 深比较，两向都报：
 *   · 类型里有、这里没有 ⟹ 放行了一个会炸构建的字段（就是 QA3 抓到的这件事）
 *   · 这里有、类型里没有 ⟹ 多拒了，老板改不了本来能改的东西
 * 它自带阳性对照（改那个 .ts 文件的副本，这把尺子每一种改法都必须有反应），少了对照，「对得上」
 * 也可能只是因为解析器一个字段都没读到。
 *
 * 🔴 **不认识的键一律放过**（这里说的是**拒不拒**，仍然成立）：`as` 那种 cast 只查「两个类型有没有
 *    足够重叠」，多出来的键 tsc 不管。实测：顶层加陌生键 / footer 里加陌生键 / cta 里加陌生键，
 *    三种 tsc 都 rc=0。查它们的方向是「正当的编辑被拒 ⟹ 这个站改不动」，也就是 #1013 r2 那道门
 *    踩过的坑。
 *    📌 **但「放过」不等于「不说」（#1128）**：那几个键谁都不读，写进去页面一个字不变，而聊天会说
 *    「改好了」。所以放行的同时由 `undeclaredKeys` 点名它们，走的是 `PAGE_READS` 那条「照写 +
 *    说实话」的通道。别把这一段读成「多出来的键这个模块一个字都不说」—— 那是 #1128 之前的样子。
 */
const NAV_LINK = { kind: 'object', fields: { label: { kind: 'string' }, href: { kind: 'string' } } };
const FOOTER_COLUMN = {
  kind: 'object',
  fields: { title: { kind: 'string' }, links: { kind: 'array', of: NAV_LINK } },
};
const NAV_SHAPE = {
  kind: 'object',
  fields: {
    header: {
      kind: 'object',
      fields: { links: { kind: 'array', of: NAV_LINK }, cta: NAV_LINK },
    },
    footer: {
      kind: 'object',
      fields: {
        description: { kind: 'string' },
        columns: { kind: 'array', of: FOOTER_COLUMN },
        copyright: { kind: 'string' },
      },
    },
    topbar: {
      kind: 'object',
      optional: true,
      fields: {
        message: { kind: 'string' },
        link: { kind: 'object', optional: true, fields: NAV_LINK.fields },
      },
    },
  },
};

/**
 * 这两条**不是**从类型里来的 —— 类型只说 `string`，空串对 tsc 合法。它们是 `sync-config.js` 自己的
 * 要求：`header.cta.href` 被拿去 `.replace(/^\//, '')` 算 `ctaSlug`，空串等于按钮链到哪儿说不清；
 * 空的 `label` 就是页面上一个没有字的按钮。#1104 r1 起就是这个行为，这里只是把它跟类型那部分分开写，
 * 免得下一个人以为它也是 `NavigationConfig` 说的。
 */
const NON_EMPTY = new Set(['header.cta.label', 'header.cta.href']);

/** 回给模型的话里，给这几处加一句「它是页面上的哪个东西」。 */
const HINTS = {
  'header.cta': 'the button at the top of every page',
  'header.cta.label': "the button's text",
  'header.cta.href': 'where the button links to, like "/contact"',
  'footer.copyright': 'the copyright line at the bottom of every page',
  'footer.description': 'the short blurb in the footer',
};

const withHint = (at) => (HINTS[at] ? `"${at}" (${HINTS[at]})` : `"${at}"`);

/** 一处的值跟它那一段形状对不上时，往 `out` 里写人话。 */
function checkShape(value, shape, at, out) {
  if (value === undefined) {
    if (!shape.optional) out.push(`${withHint(at)} is missing — ${describeShape(shape, at)}.`);
    return;
  }
  if (shape.kind === 'string') {
    const needsText = NON_EMPTY.has(at);
    // 🔴 `.trim()`，不是 `=== ''`：`"   "` 也是一个没有字的按钮（QA3 在 #1104 r2 报的非阻断第 2 条）。
    if (typeof value !== 'string' || (needsText && value.trim() === '')) {
      out.push(`${withHint(at)} must be ${needsText ? 'a non-empty string' : 'a string'}.`);
    }
    return;
  }
  if (shape.kind === 'array') {
    if (!Array.isArray(value)) { out.push(`${withHint(at)} must be an array.`); return; }
    value.forEach((item, i) => checkShape(item, shape.of, `${at}[${i}]`, out));
    return;
  }
  if (!isObj(value)) { out.push(`${withHint(at)} must be an object.`); return; }
  for (const [key, sub] of Object.entries(shape.fields)) {
    checkShape(value[key], sub, at ? `${at}.${key}` : key, out);
  }
}

/** 「它该是什么」的一句话，只用在缺字段那条消息里。 */
function describeShape(shape, at) {
  if (shape.kind === 'string') return NON_EMPTY.has(at) ? 'it must be a non-empty string' : 'it must be a string';
  if (shape.kind === 'array') return 'it must be an array';
  return 'it must be an object';
}

/**
 * 构建每次都读、读不到（或者类型对不上）就整个站建不出来的那些地方。
 *
 * 🔴 只按 `NAV_SHAPE` 查形状，不做业务校验（链接指向的页面存不存在、文案多长…）：
 *    多查一条的方向是「正当的编辑被拒 ⟹ 这个站改不动」，那正是 #1013 r2 那道门踩过的坑。
 */
function shapeProblems(nav) {
  if (!isObj(nav)) return ['navigation.json must be a JSON object.'];
  const out = [];
  checkShape(nav, NAV_SHAPE, '', out);
  // 模型写了一份完全不成形的文件时，几十条 problem 对它没有用处 —— 前几条已经说清是哪一类错。
  if (out.length > 8) {
    const extra = out.length - 8;
    return out.slice(0, 8).concat([`… and ${extra} more field${extra === 1 ? '' : 's'} with the same kind of problem.`]);
  }
  return out;
}

/** 这里能改的是哪些 —— 拒绝理由里要带上，否则模型只知道不许改什么、不知道许改什么。 */
const NAVIGATION_EDITABLE_SUMMARY =
  'In navigation.json you may change: the header button (header.cta — its label and href), the footer '
  + 'copyright, the footer description, the footer column titles, and the topbar. Write the complete '
  + 'file with everything else exactly as you read it.';

/**
 * 这次对 navigation.json 的写入放不放行？
 *
 * @param {*} next    模型要写的那份（已经 JSON.parse 过）
 * @param {*} current 磁盘上现在那份（已经 JSON.parse 过）；`null` = 读不到
 * @returns {string|null} null = 放行；字符串 = 拒绝理由，原样回给模型
 */
function navigationEditRejection(next, current) {
  // 🔴 读不到磁盘上那份 ⟹ 没法判"改的是哪几处"，方向必须是拒。放行的方向是"整份原样落盘"，
  //    也就是 #1087 关掉这条路要防的那件事。
  if (current === null || current === undefined) {
    return 'navigation.json could not be compared with the copy on disk, so nothing was written. '
      + 'Only the parts of it that the build does not rebuild can be changed from here, and that '
      + 'cannot be decided without reading the current file — call read_file on it first.';
  }

  const problems = shapeProblems(next);
  if (problems.length > 0) {
    return 'navigation.json does not have the shape the build needs on every build, so the site would '
      + 'stop building. Fix these and write the file again:\n'
      + problems.map((p) => `  - ${p}`).join('\n')
      + `\n\nNothing was written. ${NAVIGATION_EDITABLE_SUMMARY}`;
  }

  const changed = buildOwnedChanges(next, current);
  if (changed.length > 0) {
    // 🔴 每一处配它自己那句「从哪来的 / 该去改什么」，不共用一句 —— 三处的来源真的不一样，
    //    共用那句对页脚栏目数是假话（理由整段写在 `OWNED` 上面）。
    return 'navigation.json: you changed '
      + changed.map((c) => c.label).join(' and ')
      + ' — the build rebuilds that on every build, so what you wrote would be overwritten and the '
      + 'change would not stick:\n'
      + changed.map((c) => `  - ${c.label}: rebuilt from ${c.rebuiltFrom}. ${c.remediation}`).join('\n')
      + `\n\nNothing was written. ${NAVIGATION_EDITABLE_SUMMARY}`;
  }

  return null;
}

module.exports = {
  OWNED,
  SIDE_EFFECTS,
  PAGE_READS,
  VARIANTS_BY_REGION,
  alwaysRendered,
  notRenderedHere,
  NAV_SHAPE,
  NON_EMPTY,
  buildOwnedChanges,
  navigationEditRejection,
  navigationEditSideEffects,
  shapeProblems,
  undeclaredKeyPaths,
  sameValue,
  NAVIGATION_EDITABLE_SUMMARY,
};
