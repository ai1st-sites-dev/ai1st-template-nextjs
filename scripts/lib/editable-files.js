'use strict';

/**
 * editable-files.js — AI 聊天编辑器（`edit-site.js` 的 `write_file`）能不能写 `site/` 底下的这个文件？
 *
 *   const { writeRejection } = require('./lib/editable-files.js');
 *   const why = writeRejection('theme.json');   // null = 可以写；字符串 = 拒，这句话直接回给模型
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
 */

const path = require('path');

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
  // 🔴 #1087 r2 —— 这句话上一版对**链接**是真的、对这个文件里最要紧的那部分是**反的**，而模型读了它
  // 之后会替老板编一个不存在的后台页面（QA2 在真容器上量到：「Go to your Dashboard → Navigation
  // settings」，那个东西不存在）。构建重建导航时只赋值两处 —— `header.links`（`sync-config.js:611`）
  // 和 `footer.columns[0].links`（`:613`）；`header.cta` 全文件只在 `:596` 被**读**一次，从头到尾没被
  // 赋值过，而它就是每一页顶部和手机菜单里那个按钮（`Header.tsx:84` / `:113`）。
  // 📌 页脚 `columns[≥1]`（关键词分组）是**追加一次**（`:622-635`，已经有了就不再动），也不是覆盖。
  // 🔴 第三句「今天没有别的地方能改」必须直说，别只说「这里改不了」：`grep -rn navigation.json
  // manager/*.go` = 0，dashboard 里也没有导航/CTA 设置页 ⟹ 模型一旦以为存在，就会指一个假地方。
  // 老板问到这件事时的正确回答是「现在还改不了」。
  'navigation.json':
    'navigation.json is not edited here. Two parts of it are rebuilt on every build and anything '
    + 'written to them is overwritten: the header menu links and the first footer column\'s links. '
    + 'They come from each page\'s own navLabel / navOrder, so to change a menu entry, change that '
    + 'page\'s navLabel or navOrder.\n'
    + 'The rest of this file is NOT overwritten by the build — the header button (header.cta), the '
    + 'footer copyright, and the footer column titles are left exactly as they are.\n'
    + 'But there is no way to change those yet: no other screen or tool in the product edits them '
    + 'today. If the owner asks to change the header button, the honest answer is that it cannot be '
    + 'changed yet — do not point them at a settings page, there is none.',
};

const EDITABLE_SUMMARY =
  'Files that can be written here: brand.json, seo.json, services.json, pages/**.json, '
  + 'blog/*.json, blocks/site-blocks.json (in a multi-language site the last five live under <locale>/).';

/**
 * @param {string} relPath 相对 `site/` 的路径（`edit-site.js` 已经用 validatePath 挡掉 `..` 和绝对路径）
 * @returns {string|null} null = 可以写；字符串 = 拒绝的理由，原样回给模型
 */
function writeRejection(relPath) {
  if (typeof relPath !== 'string' || relPath === '') return 'Invalid path: empty.';
  // 🔴 先把路径**算**成它真正指的那个文件，再判它是什么。反面教材是我自己写的第一版：它只按
  // 分隔符切片，于是 `pages/../theme.json` 被切成 ['pages','..','theme.json'] ⟹ 命中「pages/ 底下
  // 任何一层的 .json」这条 ⟹ 判成可写，而 `path.join(siteDir, …)` 落盘的位置正是 `site/theme.json`。
  // `edit-site.js` 的 `validatePath` 今天会先拒掉带 `..` 的路径，所以那条路走不通 —— 但一个
  // 「这个文件是什么」的判断不该把正确性寄在调用方的另一道检查上。
  const normalized = path.posix.normalize(relPath.replace(/\\/g, '/'));
  if (normalized.startsWith('../') || normalized === '..' || path.posix.isAbsolute(normalized)) {
    return 'Invalid path: it must stay inside the site directory.';
  }
  const parts = normalized.split('/').filter((s) => s !== '' && s !== '.');
  if (parts.length === 0) return 'Invalid path: empty.';
  const { locale, rest } = splitLocale(parts);

  for (const rule of WRITABLE) {
    if (locale && !rule.localeScoped) continue;
    if (rule.test(rest)) return null;
  }

  const reason = REJECT_REASON[rest.join('/')];
  if (reason) return `${reason}\n\nNothing was written. ${EDITABLE_SUMMARY}`;
  return `${normalized} is not one of this site's content files, so it cannot be written from here.`
    + `\n\nNothing was written. ${EDITABLE_SUMMARY}`;
}

module.exports = { writeRejection, EDITABLE_SUMMARY };
