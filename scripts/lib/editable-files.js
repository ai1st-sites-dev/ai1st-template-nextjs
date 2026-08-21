'use strict';

/**
 * editable-files.js — AI 聊天编辑器（`edit-site.js` 的 `write_file`）能不能写 `site/` 底下的这个文件？
 *
 *   const { writeRejection } = require('./lib/editable-files.js');
 *   const why = writeRejection('theme.json');   // null = 可以写；字符串 = 拒，这句话直接回给模型
 *   const why = writeRejection('navigation.json', { content, readCurrent });   // 见下面「窄口子」
 *
 * ── 为什么要有它（#1087）────────────────────────────────────────────────────────────────────────
 * 一个真客户站（`site-194f1f41`）的 `site/theme.json` 里躺着 `{"themeId":"luxury-dark","applied":true}`。
 * `luxury-dark` 这个主题**从来没存在过** —— 是 2026-08-16 一次「顶奢化」编辑里，模型照着它刚读到的
 * 那个文件（旧值 `ocean-blue`）的样子自己编出来的一个 id，然后写了进去。`write_file` 当时只做三件事：
 * 路径不含 `..`、内容是合法 JSON、页面 JSON 过一遍块校验 —— **没有可写文件白名单**，其余任何相对路径
 * 原样落盘。
 *
 * 那个站今天还活着，是因为它容器里跑的是它自己仓里那份旧的 `sync-config.js`（不读 theme.json）。
 * 换成当前模板，`readAppliedThemeId`（`sync-config.js:135-151`）读到注册表里没有的 id 就 `exit 1`
 * ⟹ 这个站的每一次构建都死在第一步，连发博客都不行。
 *
 * ── 判据是谓词，不是文件名清单（PM 在 #1087 定的）────────────────────────────────────────────────
 *   · 这个相对路径是不是【站的内容】—— 文案 / 页面结构 / 文章？      是 ⟹ 可写
 *   · 它是不是【别的通道拥有的开关】或者【构建自己生成的产物】？      是 ⟹ 拒
 *
 * 🔴 实现成**白名单**（认不出来的一律拒），方向是有意的：
 *   · 白名单漏了一类新【内容】文件 ⟹ 模型写不进去，而且它拿到的是一句点名的错误 —— 吵，但安全。
 *   · 黑名单漏了一类新【开关】文件 ⟹ 模型写得进去，而且没有任何人会知道 —— 静，而且正是本票这个形状。
 *   加一类新的内容文件时，回到上面那条谓词判一次，然后往 `WRITABLE` 里加一行。
 *
 * 🔴 拒的时候必须说清「这个文件不由这条路改」，不能只回一句 Invalid path：模型看到「路径不合法」
 *    会去试别的写法（`./theme.json`、`../site/theme.json`…），看到「它由换装弹窗管」才会停手。
 *
 * ── 一道窄口子：navigation.json（#1104）────────────────────────────────────────────────────────
 * 上面那条谓词对 `navigation.json` 的答案不是一个字 —— 这**一个文件**里两种东西都有：
 *   · 菜单链接 / 第一栏页脚链接 —— 构建每次重写，写它就是静默失败（#1087 关掉这条路的真因）
 *   · 顶部那个按钮（`header.cta`）、页脚版权、页脚栏标题、topbar —— 构建一个字都不碰
 * 所以它既不能整份放行，也不该整份拒。判据落在**内容**上：这次写入改的是哪几处？
 * 判断整段住在 `lib/navigation-owned.js`（那里也写着它为什么不是一张字段名单）。
 *
 * 🔴 于是 `writeRejection` 多收一个 `ctx`。**没有 `ctx` 时 navigation.json 一律拒**（fail-closed）：
 *    调用方拿不出这次要写的内容和磁盘上那份，就没法判"改的是哪几处"，而放行的方向正是本票的反面。
 */

const path = require('path');
const { navigationEditRejection, navigationEditSideEffects, NAVIGATION_EDITABLE_SUMMARY } = require('./navigation-owned.js');

/**
 * `site/` 底下的子目录名。多语言站的第一段是 locale（`zh` / `zh_CN` / `zh-TW` 都出现过，所以这里
 * **不写死 locale 长什么样**），老的单语言扁平站没有那一段 —— 于是「第一段是不是 locale」只能靠
 * 排除法：它不是下面这几个已知的子目录名，就当它是 locale。
 */
const SUBDIRS = new Set(['pages', 'blog', 'blocks']);

/** 拆成 { locale, rest }。`zh/pages/a.json` → { locale:'zh', rest:['pages','a.json'] }。 */
function splitLocale(parts) {
  if (parts.length > 1 && !SUBDIRS.has(parts[0])) {
    return { locale: parts[0], rest: parts.slice(1) };
  }
  return { locale: null, rest: parts };
}

/**
 * 可写的那些 —— 站的内容。`localeScoped` 说的是「多语言站里它住在 `<locale>/` 下面」；
 * 老扁平站里同一个文件直接住在 `site/` 下，所以两种形状都收。
 */
const WRITABLE = [
  { localeScoped: false, test: (r) => r.length === 1 && r[0] === 'brand.json' },
  { localeScoped: true, test: (r) => r.length === 1 && (r[0] === 'seo.json' || r[0] === 'services.json') },
  // 页面：`pages/` 底下任何一层的 `.json` 都是一个真页面（`sync-config.js` 的 readPagesRecursive
  // 递归读，子目录名会拼进 slug —— 服务详情页就长成 `pages/services/<id>.json`）。
  { localeScoped: true, test: (r) => r.length >= 2 && r[0] === 'pages' && r[r.length - 1].toLowerCase().endsWith('.json') },
  { localeScoped: true, test: (r) => r.length === 2 && r[0] === 'blog' && r[1].toLowerCase().endsWith('.json') },
  // 跨页复用的内容块（#998）。`readSiteBlocks` 只读这一个文件名。
  { localeScoped: true, test: (r) => r.length === 2 && r[0] === 'blocks' && r[1] === 'site-blocks.json' },
];

/**
 * 明确拒掉的那些 —— 每一条配一句说清它归谁管。认不出来的文件走最后那句兜底，
 * 所以这张表不是安全性的承重件（白名单才是），它只负责让拒绝的理由是**具体**的。
 */
const REJECT_REASON = {
  'theme.json':
    'theme.json is not edited here. It is the site\'s theme switch (which theme, and the owner\'s '
    + 'fine-tuning of it) and it belongs to the theme picker in the dashboard — writing a theme id '
    + 'from here can name a theme that does not exist, which makes every future build of this site fail.',
  'theme.css':
    'theme.css is not edited here. It is the stylesheet a theme change commits; the build copies it '
    + 'byte for byte. Change the look through brand.json (colors, fonts) or the theme picker.',
  'custom.css':
    'custom.css is not edited here. The build generates it from the tweak values in theme.json, so '
    + 'anything written here is overwritten on the next build.',
  'site_meta.json':
    'site_meta.json is not edited here. It is the site\'s identity and language layout (site id, '
    + 'locales), fixed when the site was created — changing it moves every other file to a different place.',
  // 🔴 #1087 r3 —— 上一版结尾那句「it belongs to the layout picker」指的地方**不存在**，跟 r1 被退回的
  //    `navigation.json` 是同一个病（一个字符串把模型支使到一个没有的后台去）。逐条量过：
  //      grep -rin "layout.\?picker" dashboard/src/ manager/ worker/   → 0
  //        尺子校准：grep -rln "ThemeModal" dashboard/src/ → 3（真存在的那个 picker 这把尺量得到）
  //      grep -rn "page-layout\.json|layoutId" manager/ dashboard/src/ worker/ → 0
  //      templates/nextjs/scripts 里 page-layout.json 的引用全是**读**（sync-config.js:788/801、
  //        lib/page-layout.js），写它的 0 个；create-site.js 也不写（grep page-layout → 0）
  //    ⟹ 产品里既没有 picker，也没有任何东西会生成这个文件。存量站根本没有它，
  //       `lib/page-layout.js:164` 缺文件按 `standard` 走。
  'page-layout.json':
    'page-layout.json is not edited here. It picks which page layout (which regions every page is '
    + 'made of) this site uses; the build reads it, and a site without the file gets the "standard" '
    + 'layout.\n'
    + 'But nothing writes it today: no screen or tool in the product creates or changes it. If the '
    + 'owner asks to change the page layout, the honest answer is that it cannot be changed yet — '
    + 'do not point them at a picker, there is none.',
  // 📌 `navigation.json` **不在这张表里** —— #1104 起它是有条件可写的（改构建不碰的那几处放行，
  // 改构建重写的那几处拒），判断在 `lib/navigation-owned.js`，理由回给模型的也是那边那句。
  // 这里若再留一条，它会在 `writeRejection` 走到这张表之前就永远命中不到，是死代码。
};

const EDITABLE_SUMMARY =
  'Files that can be written here: brand.json, seo.json, services.json, pages/**.json, '
  + 'blog/*.json, blocks/site-blocks.json (in a multi-language site the last five live under <locale>/), '
  + 'and navigation.json for the parts of it the build does not rebuild (see the message it gives you).';

/**
 * navigation.json 这一格。这里只负责**把材料备齐**（这次的内容 + 磁盘上那份），放不放行由
 * `navigation-owned.js` 判 —— 那个判断跟 `sync-config.js` 真正重写的位置绑在一起。
 *
 * 🔴 `ctx` 缺任何一半都拒：判"改的是哪几处"需要两份内容，缺了就只能猜，而猜错的方向是放行
 *    一次会被覆盖的写入（#1087 要治的静默失败）。
 * 📌 这里**不管** JSON 解析不出来那种情况 —— 返回 null 交给 `edit-site.js` 自己那句
 *    `Invalid JSON: …`，一条错误只留一个出处。
 */
function navigationRejection(normalized, ctx) {
  if (!ctx || typeof ctx.content !== 'string' || typeof ctx.readCurrent !== 'function') {
    return `${normalized} cannot be checked here right now, so nothing was written. `
      + `Only the parts of it the build does not rebuild can be changed. ${NAVIGATION_EDITABLE_SUMMARY}`;
  }
  let next;
  try {
    next = JSON.parse(ctx.content);
  } catch (e) {
    return null;
  }
  let current = null;
  try {
    const raw = ctx.readCurrent(normalized);
    current = typeof raw === 'string' ? JSON.parse(raw) : null;
  } catch (e) {
    current = null;
  }
  return navigationEditRejection(next, current);
}

/**
 * @param {string} relPath 相对 `site/` 的路径（`edit-site.js` 已经用 validatePath 挡掉 `..` 和绝对路径）
 * @param {{content?: string, readCurrent?: (relPath: string) => (string|null)}} [ctx]
 *        这次要写的内容 + 一个按路径读磁盘上那份的函数。**只有 navigation.json 用到它**
 *        （见文件头「一道窄口子」）；没给就等于那个文件一律拒。
 * @returns {string|null} null = 可以写；字符串 = 拒绝的理由，原样回给模型
 */
/**
 * 把 `relPath` 算成它真正指的那个文件，并拆出 locale。
 * 抽出来是因为 `writeRejection` 与 `writeNotes` 必须对「这是哪个文件」得出同一个答案 ——
 * 两份实现必然分叉，而分叉的方向是「拒的时候按 A 判、说话的时候按 B 判」。
 * 返回 `{ bad }`（一句话，路径本身就不合法）或 `{ normalized, locale, rest }`。
 */
function resolveRel(relPath) {
  if (typeof relPath !== 'string' || relPath === '') return { bad: 'Invalid path: empty.' };
  // 🔴 先算再判。反面教材是我自己写的第一版：它只按分隔符切片，于是 `pages/../theme.json` 被切成
  // ['pages','..','theme.json'] ⟹ 命中「pages/ 底下任何一层的 .json」这条 ⟹ 判成可写，而
  // `path.join(siteDir, …)` 落盘的位置正是 `site/theme.json`。`edit-site.js` 的 `validatePath`
  // 今天会先拒掉带 `..` 的路径，所以那条路走不通 —— 但一个「这个文件是什么」的判断不该把正确性
  // 寄在调用方的另一道检查上。
  const normalized = path.posix.normalize(relPath.replace(/\\/g, '/'));
  if (normalized.startsWith('../') || normalized === '..' || path.posix.isAbsolute(normalized)) {
    return { bad: 'Invalid path: it must stay inside the site directory.' };
  }
  const parts = normalized.split('/').filter((s) => s !== '' && s !== '.');
  if (parts.length === 0) return { bad: 'Invalid path: empty.' };
  const { locale, rest } = splitLocale(parts);
  return { normalized, locale, rest };
}

/** 这个路径指的是 navigation.json 吗（多语言站 `<locale>/navigation.json`、老扁平站根级那份都算）。 */
const isNavigationJson = (rest) => rest.length === 1 && rest[0] === 'navigation.json';

/**
 * 这次写入放行之后，有哪些【别的地方】会跟着变。
 *
 * #1104 r2（QA1 中等②）：`header.cta.href` 自己不会被构建覆盖，但构建拿它算出 `ctaSlug` 再用它
 * 把那一页从顶部菜单里过滤掉 —— 也就是「改一个按钮」实际上还改了菜单。放行是对的（那个行为可能
 * 是模板有意的），但**必须说出来**，否则这条路就成了 #1087 要治的那种静默改动的另一个方向。
 *
 * #1104 r6：第二类是「写进去了，但**这个站的页面根本不读它**」—— 页脚栏目标题只有
 * `multi-column` 那一支页脚画，topbar 只有挑了 `with-topbar` 版式的站才有。同一条通道，
 * 判断在 `navigation-owned.js` 的 `PAGE_READS`。
 *
 * @param {{content?: string, readCurrent?: Function, readRenderedRegions?: () => object|null}} [ctx]
 * @returns {string[]} 给模型看的那几句话；没有就是空数组。**它不是拒绝**，调用方照常落盘。
 */
function writeNotes(relPath, ctx) {
  const r = resolveRel(relPath);
  if (r.bad || !isNavigationJson(r.rest)) return [];
  if (!ctx || typeof ctx.content !== 'string' || typeof ctx.readCurrent !== 'function') return [];
  let next;
  try { next = JSON.parse(ctx.content); } catch (e) { return []; }
  let current = null;
  try {
    const raw = ctx.readCurrent(r.normalized);
    current = typeof raw === 'string' ? JSON.parse(raw) : null;
  } catch (e) { current = null; }
  if (current === null) return [];          // 读不到磁盘那份 ⟹ writeRejection 已经拒了，走不到这里
  // #1104 r6 —— 第二问「这个站的页面读不读它」要知道这个站真的渲染出哪些区。判断在
  // `lib/site-regions.js`（构建用的是同一份实现），读文件系统的那一步由调用方做：这个模块是
  // 纯函数（测试直接调它，不该被一个真站目录绑住）。**递不进来 ⟹ 说「我说不准」，不是沉默** ——
  // 理由写在 `navigation-owned.js` 的 `navigationEditSideEffects` 里。
  const rendered = (ctx && typeof ctx.readRenderedRegions === 'function') ? ctx.readRenderedRegions() : null;
  return navigationEditSideEffects(next, current, rendered);
}

function writeRejection(relPath, ctx) {
  const r = resolveRel(relPath);
  if (r.bad) return r.bad;
  const { normalized, locale, rest } = r;
  for (const rule of WRITABLE) {
    if (locale && !rule.localeScoped) continue;
    if (rule.test(rest)) return null;
  }

  // navigation.json —— 有条件可写（#1104）。多语言站是 `<locale>/navigation.json`、老扁平站是
  // 根级那份，`splitLocale` 已经把两种都化成 rest === ['navigation.json']。
  if (isNavigationJson(rest)) {
    return navigationRejection(normalized, ctx);
  }

  const reason = REJECT_REASON[rest.join('/')];
  if (reason) return `${reason}\n\nNothing was written. ${EDITABLE_SUMMARY}`;
  return `${normalized} is not one of this site's content files, so it cannot be written from here.`
    + `\n\nNothing was written. ${EDITABLE_SUMMARY}`;
}

module.exports = { writeRejection, writeNotes, EDITABLE_SUMMARY };
