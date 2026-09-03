'use strict';

/**
 * editable-files.js — AI 聊天编辑器（`edit-site.js` 的 `write_file`）能不能写 `site/` 底下的这个文件？
 *
 *   const { writeRejection } = require('./lib/editable-files.js');
 *   const why = writeRejection('theme.json');   // null = 可以写；字符串 = 拒，这句话直接回给模型
 *   const why = writeRejection('navigation.json', { content, readCurrent });   // 见下面「窄口子」
 *   const why = writeRejection('seo.json', { readSiteShape });                // 见下面「第二问」
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
 *
 * ── 第二问：这个文件在【这个站】上有人读吗（#1109）──────────────────────────────────────────────
 * 上面那张白名单只看**文件名**。而同一个文件名在两种站上住在不同的地方：
 *   · 多语言站（有 `site_meta.json`）—— 内容在 `site/<语言>/`，构建只读那一份
 *   · 老的单语言扁平站（没有 `site_meta.json`）—— 内容直接在 `site/`
 * 所以在多语言站上往**根目录**写 `seo.json` 会被这张表放行，然后：落盘 → `sync-config` rc=0 →
 * commit + push → 老板收到「Done」→ **站上一个像素都没变**（构建根本不读那份）。反方向一样：
 * 扁平站上写 `<语言>/seo.json` 也没人读。这是 #1087 治过的病的另一个形状 —— 那边是「说了一句
 * 指向不存在地方的话」，这里是「做了一件看起来成功、其实没有效果的事」，而且没有任何一层会红。
 *
 * 🔴 修法不是补一张路径清单（清单会在下一个文件类型出现时漏），是让这道门知道**这个站是什么形状**：
 *    形状从 `ctx.readSiteShape()` 来，判据与构建同一条（`lib/site-shape.js` 里写着为什么只看
 *    `site_meta.json` 在不在）。
 *
 * 🔴 **形状有两维，第二维是「哪几个语言」（#1138）。** 上面那段只关了「有没有带语言段」这一维；
 *    带了语言段、而那个语言**这个站没有**（站里只有 `en`，模型写 `fr/seo.json`）是同一个洞的第三道
 *    入口，实测的后果逐字相同：落盘 → `sync-config` rc=0 → commit + push → 老板收到「Done」→
 *    产物里 0 命中。构建只读 `site_meta.json` 列着的那几个语言。判断在 `wrongPlaceForShape`
 *    第三个分支，那里也写着为什么「语言清单问不出来时不判」。
 * 🔴 **形状问不到时这一维不判**（保留白名单原来的答案），方向跟 navigation.json 那道窄口子相反，
 *    理由是具体的：
 *      · 这里被判的是**站的内容文件**（本来就该写得进去），拿不到形状就拒 = 一份站目录读不出来
 *        的时候整个编辑器变砖，而 `lib/remediation.js` 会据此对老板说一句「这个改不了」的假话。
 *      · navigation.json 那边拿不到内容就拒，是因为放行的后果是**写进一个会被覆盖的字段**。
 *    ⟹ 两处的默认值都是「后果轻的那一边」，不是同一个方向。
 *    真路径（`edit-site.js` 的 `write_file`）永远递得进形状，那条接线由 `editable-files.test.js` 钉着。
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
    return `${JSON.stringify(normalized)} cannot be checked here right now, so nothing was written. `
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
 * @param {{content?: string, readCurrent?: (relPath: string) => (string|null),
 *          readSiteShape?: () => ({flat: boolean, locales?: string[]}|null)}} [ctx]
 *        · `content` + `readCurrent` —— 这次要写的内容 + 一个按路径读磁盘上那份的函数。
 *          **只有 navigation.json 用到它们**（见文件头「一道窄口子」）；没给就等于那个文件一律拒。
 *        · `readSiteShape` —— 这个站的内容住在 `<语言>/` 底下还是直接在 `site/`（#1109）。
 *          没给就等于不判这一维（见文件头「第二问」）。
 * @returns {string|null} null = 可以写；字符串 = 拒绝的理由，原样回给模型
 */
/**
 * 把 `relPath` 算成它真正指的那个文件，并拆出 locale。
 * 抽出来是因为 `writeRejection` 与 `writeNotes` 必须对「这是哪个文件」得出同一个答案 ——
 * 两份实现必然分叉，而分叉的方向是「拒的时候按 A 判、说话的时候按 B 判」。
 * 返回 `{ bad }`（一句话，路径本身就不合法）或 `{ normalized, canonical, locale, rest }`。
 * `canonical` = 这个判断认定它指的那个文件，写成 `path.join` 也认的形状（见下面 `spellingMismatch`）。
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
  // 🔴 #1140 —— `relPath` 原样带出来:拼写那一问(`spellingMismatch`)问的是「模型给的这串字节」,
  //    归一化之后的 `normalized` 已经把差抹掉了,拿它去问必然恒等。
  return { relPath, normalized, canonical: parts.join('/'), locale, rest };
}

/**
 * 放行之前最后一问：**我判的那个文件，就是落盘那一行会写的那个文件吗？**（#1109 r2）
 *
 * 🔴 这不是多一道保险，是本票那条阻断的根因。上面那段归一化（`\` 换成 `/`、丢掉空段和 `.`）说的是
 *    「这个字符串指哪个文件」，而真正决定字节落在哪的是 `edit-site.js` 的
 *    `path.join(siteDir, relPath)` —— 它拿的是**模型给的原始字符串**。两套归一化对同一个字符串给出
 *    不同的文件时，白名单按 A 放行、字节按 B 落地：QA3 在 r1 终审真驱动出来的就是这个，
 *    `en\seo.json` 被判成 `en/seo.json`（正确位置 ⟹ 放行），而 Linux 上 `\` 只是文件名里的一个字符，
 *    于是字节落在 `site/` **根目录**、文件名字面是 `en\seo.json` ⟹ `sync-config` 读不到它、
 *    构建绿、模型收到 `success:true`、老板收到「Done」、站上一个像素没变 —— 逐字是本票要治的那句病。
 *
 * 🔴 **判据是那个差本身，不是它的某一种拼法。** 我没有去拒「含 `\` 的路径」：那是对症状的枚举，
 *    而实测的差集有**两族**（`\` 8 种 · 结尾带分隔符 4 种，读数在交接留言里），照症状写就会漏第二族。
 *    这里问的就是那条不变式 —— 拿**决定落点的那个 `path.join`** 去问「你认不认我算出来的这个文件」。
 *    于是 `path.join` 自己就会收敛的写法（`en//seo.json` · `en/./seo.json` · `./en/seo.json`）照旧
 *    放行（它们落的就是同一个文件），只有它**不**收敛的那些被拒 ⟹ QA1/QA2 量过的读数一个都不变。
 *
 * 🔴 用一个哨兵根比较，而不是真的 `siteDir`：这个性质与前缀无关 —— 上面刚把 `..` 和绝对路径拒掉了，
 *    不存在往上逃的分量，所以换任何一个绝对根，两侧同增同减、判决不变（`editable-files.test.js` ⑧
 *    拿三个不同的根跑同一份语料，判决集合必须逐个相同 —— 那一格就是这句话的读数）。
 *    两侧都用 `path.join`（**不是** `path.posix.join`）：它就是落盘用的那一个，问的是「这台机器上
 *    这个字符串指什么」。
 *
 * 📌 话里不许说 `canonical` 那个路径**可以写** —— 它可能自己也是错位置的（多语言站上 `.\seo.json`
 *    的 canonical 是根级 `seo.json`）。所以这一格排在白名单/形状裁决**之后**：那边先拒掉的，返回
 *    它们那句更具体的话；只有裁决是「放行」时才走到这里。措辞只说「你这样拼指的不是那个文件，
 *    要那个文件就照这样拼」，不承诺结果 —— 同族纪律见 #1087（说一句指向不存在地方的话）。
 */
const SPELLING_SENTINEL = '/__site__';
function spellingMismatch(relPath, canonical) {
  if (path.join(SPELLING_SENTINEL, relPath) === path.join(SPELLING_SENTINEL, canonical)) return null;
  return `Invalid path: "${relPath}" does not name the file it looks like. Written literally, those bytes`
    + ` land at a different place than "${canonical}" — on this system the only path separator is "/", and`
    + ` a trailing separator names a directory, not a file. If you meant "${canonical}", send the path`
    + ` spelled exactly that way (that spelling is then checked like any other).`
    + `\n\nNothing was written. ${EDITABLE_SUMMARY}`;
}

/** 这个路径指的是 navigation.json 吗（多语言站 `<locale>/navigation.json`、老扁平站根级那份都算）。 */
const isNavigationJson = (rest) => rest.length === 1 && rest[0] === 'navigation.json';

/**
 * 这个文件是「住在 `<语言>/` 底下」的那一类吗（#1109）。
 *
 * 判据不是我另写一张清单，是**上面那张白名单自己**的 `localeScoped` 那一列 + navigation.json 那道
 * 窄口子 —— 也就是说，加一类新的内容文件时只要在 `WRITABLE` 里标对 `localeScoped`，形状这一维
 * 自动跟着走，不需要在这里再加一行（本票要治的病就是清单式修法的漏项）。
 * 🔴 `brand.json` 不在这一类里：多语言站上它**也**住在 `site/brand.json`（`sync-config.js` 无条件读
 *    `path.join(siteDir, 'brand.json')`），所以它两种形状下都在根目录，形状这一维对它不说话。
 */
function isLocaleScopedFile(rest) {
  if (isNavigationJson(rest)) return true;
  return WRITABLE.some((rule) => rule.localeScoped && rule.test(rest));
}

/** `ctx.readSiteShape()` 的读数，形状不对/抛异常一律当「问不到」（返回 null，这一维不判）。 */
function siteShapeOf(ctx) {
  if (!ctx || typeof ctx.readSiteShape !== 'function') return null;
  let shape;
  try {
    shape = ctx.readSiteShape();
  } catch (e) {
    return null;
  }
  if (!shape || typeof shape.flat !== 'boolean') return null;
  return { flat: shape.flat, locales: Array.isArray(shape.locales) ? shape.locales.filter((l) => typeof l === 'string' && l !== '') : [] };
}

/**
 * 这次写入落在「这个站的构建根本不读」的那个位置吗（#1109 · #1138）。返回拒绝的理由，或者 null（位置对）。
 *
 * 🔴 拒的理由要把三件事都说出来 —— 这个站是什么形状 · 内容真正住在哪 · **这次该写哪个路径**。
 *    只说 invalid 的后果 #1087 记着：模型会去试别的写法。而这里还多一层 —— 位置写错时这条路
 *    **不报错也不生效**，所以理由里必须写明「写在这里没人读，站不会变」，否则模型（和老板）无从
 *    分辨「我改了」和「我改了但白改」。
 *
 * ── 三个分支，三个不同的问题（#1138 补的是第三个）──────────────────────────────────────────────
 *   1. 多语言站 + 路径**没带**语言段        → 拒（#1109）
 *   2. 扁平站   + 路径**带了**语言段        → 拒（#1109）
 *   3. 多语言站 + 那个语言段**这个站没有**  → 拒（#1138）
 * 第 3 个以前落到末尾那句 `return null` ⟹ 放行。实测的后果与前两个逐字相同：站里只有 `en` 而模型
 * 写 `fr/seo.json`，文件真的落盘、`sync-config` rc=0、commit + push、老板收到「Done」，而产物里
 * 探针 0 命中 —— 构建只读 `site_meta.json` 列着的那几个语言。同一个洞的三种入口都在这里关。
 *
 * 🔴 第 3 个问的是「**这个站有没有这个语言**」，不是「这是不是一个合法的语言代码」（#1138 正文
 *    点名）。后者会把「站里真有 `fr`、模型也写 `fr`」判进来 —— 那是**对的**路径。也正因为判据是
 *    「这个站有没有」，`\t` / `\n` / `C:` 这些根本不像语言的段不需要单独枚举：它们同样不在这个站的
 *    语言清单里，同一条判断就把它们收了（照症状枚举会在下一种拼法出现时漏，#1109 r2 的账）。
 */
function wrongPlaceForShape(normalized, locale, rest, shape) {
  if (!shape || !isLocaleScopedFile(rest)) return null;
  const bare = rest.join('/');

  // #1138 —— 多语言站，而这个语言段不是这个站的语言之一。
  // 🔴 `shape.locales.length` 这个前提是承重的，不是防御性代码：`site_meta.json` 在、但读不出来
  //    （不是合法 JSON / 没有 locales 数组）时 `readSiteShape` 返回 `{flat:false, locales:[]}`
  //    —— 形状是确定的（多语言），但「这个站有哪几个语言」**没有答案**（理由整段在
  //    `lib/site-shape.js` 文件头第三条）。那时开火 = 在一个真多语言站上把它唯一正确的路径拒掉，
  //    而理由还是一句「这个站没有 en」的假话。语言清单问不出来 ⟹ 这一问不判，落回下面的白名单。
  if (!shape.flat && locale && shape.locales.length && !shape.locales.includes(locale)) {
    // 🔴 语言名用 JSON.stringify 印：这一格真会收到 `\t` / `\n` 当语言段（#1138 AC3），
    //    直接插进句子里会把那个字符原样打进老板/模型看到的文本，读起来像句子断了。
    // 🔴 最后那句「不许把老板指到某个地方去加语言」是**实测逼出来的**，不是防御性废话。第一版
    //    只写到「这条聊天改不了 site_meta.json」，真模型（活体跑，读数在 #1138 交接留言里）当场
    //    自己补出了下一句：「去 dashboard 的设置里先加法语」——而那个界面**不存在**（语言只在建站
    //    向导里选，`dashboard/src/pages/sites/create/lead/LeadFormStep.tsx`；建完之后全仓 0 个
    //    site_meta.json 的写入者）。「这条路改不了」会被读成「所以别的路改得了」⟹ 必须把那半句
    //    也说出来。同族先例是上面 `page-layout.json` 那条（#1087 r3），措辞是有意抄它的。
    // 🔴 #1134 —— 同一句里的三处插值要用**同一种**印法。这里原来只有语言名走 `JSON.stringify`
    //    (上面那条注释解释了为什么:这一格真会收到 `\t` / `\n` 当语言段),而句首的 `${normalized}`
    //    和句中的 `site/${locale}/` 是**裸插值** ⟹ 路径里带换行时回执真的断行。
    //    实测判据:`PM_PATHS='["\n/seo.json"]'` 直调 `writeRejection`,回执**第一行是空行**。
    //    拒绝与建议路径都不受影响(值一样),只是读起来像句子断了 —— 所以是措辞,不是缺陷。
    return `${JSON.stringify(normalized)} is not where this site keeps its content. This site is a `
      + `multi-language site, and ${JSON.stringify(locale)} is not one of the languages it has `
      + `(it has: ${shape.locales.join(', ')}). `
      + `The build only reads the languages the site is set up with, so a file under `
      + `${JSON.stringify(`site/${locale}/`)} is read `
      + `by nothing — it would be saved and the site would not change. To change this content, write `
      + `${shape.locales[0]}/${bare} instead${shape.locales.length > 1 ? ' (or the same file under one of the other languages above)' : ''}.\n`
      + `If the owner wanted a new language rather than a change to an existing one: a site's languages are `
      + `chosen when the site is created, and nothing in the product today adds one to a site that already `
      + `exists. So the honest answer is that it cannot be done yet — do not tell the owner to go and add `
      + `the language somewhere, there is no screen or setting for it.`
      + `\n\nNothing was written. ${EDITABLE_SUMMARY}`;
  }

  if (!shape.flat && !locale) {
    const has = shape.locales.length ? ` (this site has: ${shape.locales.join(', ')})` : '';
    const suggest = shape.locales.length ? ` Write ${shape.locales[0]}/${bare} instead — one file per language.` : '';
    return `${JSON.stringify(normalized)} is not where this site keeps its content. This site is a multi-language site: `
      + `its content files live under site/<language>/${has}, and the build only reads those. A file `
      + `written at the top of site/ is read by nothing, so it would be saved and the site would not `
      + `change.${suggest}`
      + `\n\nNothing was written. ${EDITABLE_SUMMARY}`;
  }

  if (shape.flat && locale) {
    return `${JSON.stringify(normalized)} is not where this site keeps its content. This site is a single-language site `
      + `with a flat layout: its content files live directly under site/ (there is no site/${locale}/), `
      + `and the build only reads those. A file written under site/${locale}/ is read by nothing, so it `
      + `would be saved and the site would not change. Write ${bare} instead.`
      + `\n\nNothing was written. ${EDITABLE_SUMMARY}`;
  }

  return null;
}

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
  // 🔴 #1140 —— 「我判的那个文件,就是落盘那一行会写的那个吗」这道门原来只装在 `writeRejection` 上。
  //    今天这条路没被绕过,靠的是 `edit-site.js §executeTool` 那个 `if (notWritable) return` 的**调用顺序**
  //    (先问拒绝、拒了就不往下走),不是按构造 —— 将来有第二个调用方只调 `writeNotes` 时,这一维对他
  //    一个字都不说,而它说出来的每一句都是关于**另一个文件**的(下面整段都建立在 `readCurrent(normalized)`
  //    读到的那份上)。这里的正确方向是闭嘴而不是拒:`writeNotes` 的产出是提示,拒绝始终是
  //    `writeRejection` 的职责,两个函数各说各的话会让调用方拿到互相矛盾的两句。
  if (spellingMismatch(r.relPath, r.canonical)) return [];
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
  const verdict = contentVerdict(r, ctx);
  // 拒的时候原样返回它 —— 形状 / 白名单 / navigation 那几句话都比拼写提示具体（理由见
  // `spellingMismatch` 末段的 📌）。只有裁决是「放行」时才问最后那一问。
  if (verdict !== null) return verdict;
  return spellingMismatch(relPath, r.canonical);
}

/** 原来 `writeRejection` 的整个函数体（#1109 r2 只是把它抽出来，一行没改）。 */
function contentVerdict(r, ctx) {
  const { normalized, locale, rest } = r;

  // #1109 —— 先问「这个文件在这个站上有人读吗」。排在白名单**前面**是有意的：白名单的答案是
  // 「这个文件名是站的内容」，而这里问的是「这一份内容住的地方对不对」，位置不对时那张表给出的
  // 放行正是本票要治的静默失败。形状问不到（老调用方、单测直接调）时这里恒返回 null ⟹ 白名单
  // 原来的答案不变，理由写在文件头「第二问」那一段。
  // 🔴 AC5 撤的就是这一处：把下面那两行（算读数 + 那句 return）去掉，本票钉的那几个路径会回到放行；
  //    `site-shape.test.js` ④ 就是这么做的，它还断言那两行各只出现一次。
  const wrongPlace = wrongPlaceForShape(normalized, locale, rest, siteShapeOf(ctx));
  if (wrongPlace) return wrongPlace;

  for (const rule of WRITABLE) {
    if (locale && !rule.localeScoped) continue;
    if (rule.test(rest)) return null;
  }

  // navigation.json —— 有条件可写（#1104）。多语言站是 `<locale>/navigation.json`、老扁平站是
  // 根级那份，`splitLocale` 已经把两种都化成 rest === ['navigation.json']。
  if (isNavigationJson(rest)) {
    // 🔴 #1140 —— 这一支【必须】先问拼写,而下面那几支不用。差别不是偏好,是这句话说得出口的前提:
    //    navigation 的裁决是**读了磁盘上那份、比出改了哪几处**之后才有的,而拼写不对时读的就是别的
    //    文件 ⟹ `readCurrent` 读不到 ⟹ 它回「没法跟磁盘那份比对,先 read_file 一次」。那句话方向指错
    //    (真正的毛病是路径拼法),而且它建议的动作**做不成** —— 对同一个带尾斜杠的路径 read_file 一样读不到。
    //    实测三种拼法同样:`en/navigation.json/` · `en/navigation.json//` · `en/./navigation.json/`(#1109 r2 报的)。
    //    其余几支(形状 / REJECT_REASON / 白名单落空)的理由都不依赖读磁盘,拼写对不对它们照样成立,
    //    而且它们更具体 ⟹ 保持原来的次序(理由在 `spellingMismatch` 末段那个 📌)。
    const spelling = spellingMismatch(r.relPath, r.canonical);
    if (spelling) return spelling;
    return navigationRejection(normalized, ctx);
  }

  const reason = REJECT_REASON[rest.join('/')];
  if (reason) return `${reason}\n\nNothing was written. ${EDITABLE_SUMMARY}`;
  return `${JSON.stringify(normalized)} is not one of this site's content files, so it cannot be written from here.`
    + `\n\nNothing was written. ${EDITABLE_SUMMARY}`;
}

module.exports = { writeRejection, writeNotes, EDITABLE_SUMMARY };
