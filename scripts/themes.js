// #924 — Theme registry. THE single source of truth for what a theme is.
//
// 🔴 #1189 —— 这个文件在 `.github/workflows/ci-cd.yml` 的 `dashboard:` 过滤器里（它被
//    `dashboard/vite.config.ts` 在**构建期** require 进产物，变成换装弹窗里那张主题卡片清单）。
//    ⟹ 只改这个文件的 push 也会打 release。别把它从那份清单里拿掉 ——
//    2026-08-24 它不在的时候，#1174 把主题池 80 → 97 推上 main 之后 release 整个 skipped，
//    之后 promote 的是更旧的那份 dashboard：全绿、公网 200，而弹窗里仍然是 80 套。
//    这份清单不用手记：`bash ai-team/dispatcher/check-dashboard-template-deps.sh` 现算并核对。
//
// A theme has four parts:
//   colors      配色 — primary 50-900 + accent 50-600, copied into brand.json at creation, and
//               again whenever the owner changes theme (#1121: brand.json 是颜色的唯一出处)
//   fonts       字体 — heading/body families + the Google Fonts URL
//   shapes      选择单 — 每个块类型一个形态名(`{ "hero": "media-left", "header": "solid-bar", … }`),
//               值进 DOM 的 `data-shape`,`public/shapes.css` 靠它点名。由 `shapesFor()` /
//               `regionShapesFor()` 读,`sync-config.js` 消费。
//               🔴 #1353 起**顶栏 / 页脚 / 公告条这三个区也在这张表里**,跟别的 31 个块一个待遇。
//               在那之前它们住在另一个键 `supports`(每个键一个清单),而那个键今天**一个都不许有**
//               (检查在下面 `themesWithSupports`,`sync-config.js` 拿它拦构建)。
//   style       风格形容词 — one phrase, used in the AI logo prompt (was THEME_STYLE_MAP)
// plus `industries`, the keyword list the creation-time picker matches against.
//
// Who reads this file:
//   scripts/create-site.js  — picks a theme at creation, writes colors/fonts into brand.json,
//                             feeds `style` to the logo prompt, records the id in site/theme.json
//   worker/main.go           — 老板按下 Apply 换主题的那一刻，把这套主题的 colors / fonts /
//                             settings 写进 site/brand.json（#1121 起，见下面那条）
//   scripts/sync-config.js  — at every build: which variant each block gets, and the two Regions
//   scripts/lib/dress-site-in-theme.js — 各种工具「给样例站上色」时扮演 worker 那一步（图册、
//                             theme-css 那批检查都走它）
//
// 🔴 #1121（2026-08-20）—— **`applied` 不再决定这个站长什么样，一维都不决定。** 这张表的每一个键
// 都只看 `themeId`：
//   · `header` / `footer` —— 两个 Region 的结构。#1086（2026-08-18）先离开那个布尔的。
//   · 其余每一个键 —— 每个 block 的 variant。#1121 跟着离开，理由同一条：同一套主题不该有两种长相。
//   · `colors` / `fonts` / `settings` —— 🔴 **构建期不再读它们**。页面上的颜色 / 字体 / 风格设定
//     永远来自这个站自己的 brand.json；这三个键进 brand.json 的时机是**建站那一刻**
//     （create-site.js）和**老板换主题那一刻**（worker 的 processThemeTask）。
// 这一段以前写的是「per-section variants 只对 applied:true 的站读」和「sync-config 在
// applied:true 时拿注册表盖 brand.json」—— 两句在 #1121 之后都是假话。
// See sync-config.js §theme (`readAppliedThemeId` vs `readStructureThemeId`)：那两个函数今天分开
// 的理由是它们对「注册表里查不到这个 id」的答法相反，不再是「一个管颜色一个管结构」。
//
// 📌 #956 —— 手写那 30 套里每套的 supports 表覆盖 28 种 block（当时 registry.ts 的 34 种类型减掉 6 个
// 一个 variant 都没有的：contact-form · quote-form · services-list · services-nav · values-grid ·
// service-related-pages），外加 header / footer 两个 Region 键。#956 当时立的两条性质（每套的键集合
// 相同 · 每种 variant 至少有一套用到）说的就是那 30 套。
// 🔴 这一段今天只是**出处**，两个原因各自成立：**#1161 把那 30 套的 supports 表整个删了**（它们已下架，
//    见下面 retiredThemes 那段）⟹ 这份注册表里没有量点了；而且 **#1162 之后注册表是 31 种类型**
//    （`values-grid` 随别名兼容层 2026-08-23 退役并入 `card-group`）⟹ 上面那个 34 也是当年的数。
//    要读当年的形状：`git show c8d5dcd7:templates/nextjs/scripts/themes-retired.js`。
//
// 🔴 #1016 —— **新池那 80 套不是这个形状，而且不该是。** 阶段 2（#1030 收尾）把 34 个块的外观全部搬
// 进了主题自己那份 CSS，组件里再没有一处按 variant 分支（`grep -c 'variant === ' src/components/
// sections/*.tsx` 今天是 0）。所以「这套主题在这个块上用哪种写法」已经不是靠一个 variant 名字表达的了
// —— 写它的那天新池每套的 supports 只有三个键：`hero` + `header` / `footer`（#960 的 Region 结构）。
// 🔴 #1353 起这句话只剩历史价值：`hero` 那个键 #1341 就删了，顶栏 / 页脚这一轮搬进了选择单，
//    `supports` **一个都不许再有**。今天「这套主题在这个块上用哪种写法」只有一个答案处：`shapes`。
// ⟹ 拿 #956 那两条去核新池会红，而那不是「新池漏填了」，是那两条说的是另一批主题。
//
// 🔴 #993 — A THEME DOES NOT DECIDE BLOCK PLACEMENT. It used to (#962/#983 gave every theme a
// `rhythm: { hide, order }` that hid blocks and re-ordered them at build time); spec D8 removed it,
// and a theme carrying that key is now a build error — see `themesWithRhythm` at the bottom of this
// file for the check and the three reasons. Which blocks a page shows, and in what order, comes only
// from the site's own page JSON: the order of the `sections` array, and each section's `hidden`.

// ── 注册表 = 池子，就这一份（#1161，2026-08-23 Chris 拍板整体下架）─────────────────────────────
//
//   poolThemes    `scripts/theme-pool.json` —— 平台今天提供的全部主题（#1016 跑 #1004 那条流水线
//                 生成、过完四道闸的那批）。每一套的样子主要在它自己那份表里
//                 （`public/themes/<sheet>.css`，阶段 2 之后 34 个块的外观都住在那儿）。
//   retiredThemes `scripts/themes-retired.js` —— 已下架那批【只剩名字和配色】（#1161 的 30 套 +
//                 #1317 下架的 95 套 = 125 条；🔴 这个数会涨，别从这里抄），而且
//                 **不并进 `themes`**。它唯一的消费者是换主题弹窗的那张「当前卡」：一个站正穿着
//                 已下架的主题时，卡上要写得出它的名字并照实说一句「已下架，继续用没任何影响」
//                 （spec 附四规则 1，Chris 2026-08-23 冻结）。理由整段在那个文件头上。
//
// 🔴 #1161 之前这里是 `{ ...poolThemes, ...retiredThemes }` = 110 套，理由是 spec D3「冻结退役、
//    一个字都不许删」。那条被 Chris 2026-08-23 换代（他的原话：「那些我觉得可以 cleanup」「老的
//    网站不用考虑」）。**换代不会打断已经上线的站**，因为每个站的容器克隆的是站自己那个 repo，
//    里面带着建站那天的模板快照 —— 平台永不推送进存量站（#1088 / spec 附四规则 1 的物理保证）。
const poolThemes = require('./theme-pool.json');
const { retiredThemes } = require('./themes-retired.js');
// 🔴 #1115 —— 挑主题的匹配口径跟「这门生意算不算上门」是**同一份判据**，共用 #1097 那两个函数。
//    别在这里照着重写一份切词（本仓为「同一个判据两份实现」付过多次账）。
//    方向安全:`industry-sectors.js` 是零依赖叶子（一个 require 都没有）⟹ 不成环；
//    同向先例是 `scripts/lib/hero-lead-form.js` 已经在 require 它。
// 🔴 #1119 —— 后三个是组邻接那条路要的：一个行业词该看哪些组的主题。判归属、判伙伴、判词属于哪组，
//    三件事的权威都在那个文件里 —— 它是那 16 组和 partner 表的家，在这里重写一份就是让同一个判断
//    有两份实现。#1115 那两个仍然要（落回路照用它们，见下面 candidateThemesForIndustry 的 ②）。
const {
  isOnSiteIndustry, industryTokens, hasPhrase,
  sectorIndexForIndustry, partnerIndexOf, sectorThemeIds,
} = require('./theme-pipeline/industry-sectors.js');

// 🔴 大括号不是多余的。`manager/theme.go` 的 `themeIDsFromRegistry` 不跑这个文件（它读的是
// 【客户 repo 里】的字节，跑它等于远程执行代码），而是扫 `const themes = {` 这个形状并跟着
// `...spread` 进兄弟文件。写成 `const themes = poolThemes;` 它当场认不出来 —— 表现是弹窗把
// 每一张卡都灰掉。`ticket1063_test.go` 有一格拿真文件对账这件事。
const themes = { ...poolThemes };

// Used when a theme id isn't in the registry (a site created before that theme was retired,
// or a hand-edited theme.json). Same string the old THEME_STYLE_MAP fell back to.
const DEFAULT_LOGO_STYLE = 'minimal modern flat 2D';

// Creation-time rotation needs at least this many candidates, otherwise every business in
// the same trade comes out looking identical. Industries whose keyword list doesn't reach
// it get topped up from NEUTRAL_TOPUP (visually generic themes that suit anything).
const MIN_ROTATION_POOL = 3;
// 🔴 #1016 —— 这四个 id 换成了新池里的（原来是 `slate-pro` / `ocean-blue` / `earth-tone` /
// `midnight`，都是退役的那 30 套之一；不换的话「一个行业没匹配上」时兜出来的恰好是新站抽不到的皮）。
// 挑法是可复算的，不是我看着顺眼：settings 三个数最保守的那些（圆角接近中档 10px、留白接近 1.0、
// 阴影最淡），再从中取分属四个不同行业组的四套，让兜底本身也不重样。
//   node -e "const p=require('./scripts/theme-pool.json');
//     const s=t=>Math.abs(t.settings.radius-10)/10+Math.abs(t.settings.density-1)+t.settings.shadowStrength*2;
//     console.log(Object.entries(p).map(([id,t])=>[id,+s(t).toFixed(3)]).sort((a,b)=>a[1]-b[1]).slice(0,8))"
// 📌 新池里每个行业词都有 ≥4 套真命中（#1016 AC2），所以这条兜底今天只在「行业文字一个词都没匹配上」
//    时才开火 —— 它不再是 175 个行业的日常路径了。
// 🔴 #1077 —— 这四个 id 是【承重】的：下面 candidateThemesForIndustry 把它们无条件 push 进池子，
// **从不核它们在不在注册表里**。所以某个 id 一旦不再是真主题（改名、下线、或者注册表被套了一层外壳），
// 池子里就会出现指向空气的 id，而池子的**长度**照样 ≥ MIN_ROTATION_POOL —— 长度那条判据在这里是同义
// 反复（实测：1 套真主题 + 1 个假 id 的注册表，某个行业词的池仍然是 3 长）。能说话的是「池里有没有指向
// 不存在主题的 id」。两道检查分工：`theme-pipeline/pool.test.js` 问「它们在不在【挑得到的那一池】」（更严，
// 它是这个问题的权威）；`manager/ticket1077_test.go` 问「`const themes` 的键是不是真主题」——后者才看得见
// 外壳那种改法，因为 pool.test.js 直接读 poolThemes，外壳动的是 `const themes`。
// 🔴 #1317（2026-09-14）—— 脚手架期这里只剩留在池子里的那两套。原来那四个 id
// （`fern-02` / `jade-26` / `azure-50` / `violet-74`）跟着 95 套一起下架了，留着就正好是上面
// #1077 那条说的「指向空气的 id」。
// 📌 #1317 当时给这一换写的理由是「它是 #1114 那条保证在脚手架期唯一的载体：兜底源里必须有一套
// `supports.hero` 含 `with-form` 的主题」。**#1333 起那个理由不成立了** —— 带表单的首屏拆成了
// 自己一个块类型 `hero-with-form`，任何主题都画得出，那道按 `supports.hero` 补人的兜底也跟着删了
// （见下面 `candidateThemesForIndustry` 里那段）。这两个 id 留在这里的理由回到最原始那一条：
// 它们是池子里仅有的两套，而这份清单要的是「视觉上通用、什么生意都配得上」。
// 📌 `MIN_ROTATION_POOL = 3` 在脚手架期**凑不满，这是有意的**：整个池子只有 2 套，两条路去重之后
//    都是 2。那个常量说的是「至少要几套才不至于同一行的生意长得一样」，而池子重生成之前这句话没有
//    满足的余地 —— 把它改成 2 会把一条今天仍然正确的下限调低，池子长回去时没人会想起来调回来。
const NEUTRAL_TOPUP = ['azure-29', 'ember-12'];

// #1119 —— id → 它属于哪个行业组（`industries` 落在哪一组的词表里）。算一次就够：`poolThemes` 是一份
// require 进来的 JSON，进程活着期间不会变。
// 📌 归不进任何一组的 id **挑不到**（下面按组成员取，它们不在任何一组里），而这件事是静默的 ——
//    盯它的是 `theme-pipeline/industry-sectors.test.js` 第 ① 格（要求「组外」那份清单是空的）。
let sectorOfThemeMemo = null;
function sectorOfTheme() {
  if (!sectorOfThemeMemo) {
    sectorOfThemeMemo = new Map();
    sectorThemeIds(poolThemes).byIndex
      .forEach((ids, i) => ids.forEach((id) => sectorOfThemeMemo.set(id, i)));
  }
  return sectorOfThemeMemo;
}

function themeStyle(themeId) {
  const t = themes[themeId];
  return (t && t.style) || DEFAULT_LOGO_STYLE;
}

// 一套主题给三个【区】选的形态，或者 {}（注册表里没有这个 id / 它没写选择单）。
//
// 🔴 #1353 —— 这个函数以前叫 `layoutFor`，读的是 `supports`（「这套主题能画哪几种顶栏/页脚」，
//    一个清单，取第一项当结论）。顶栏 / 页脚按块的规矩搬进形态层之后，**它们跟别的 32 个块共用
//    同一张选择单**（`theme-pool.json` 的 `shapes`，一个块一个名字），`supports` 整个退役了 ——
//    留着它就是两张清单说同一件事，而漂了没有任何东西会红（那正是 #1341 删掉它另外四个键时写下
//    的理由，这一条把最后三个键也收掉）。
//
// 🔴 三个区的键名就是三个块类型：`header` / `footer` / `announcement-bar`（公告条那条外壳带）。
//    公告条那个键**本来就在选择单里**（两套池主题都写着 `"announcement-bar": "stack"`）——
//    #1353 之前它服务的是页面里那个内容块，今天外壳区那条路也读它，两条路同一个值。
function regionShapesFor(themeId) {
  const t = themes[themeId];
  if (!t || !t.shapes || typeof t.shapes !== 'object') return {};
  const out = {};
  for (const key of ['header', 'footer', 'announcement-bar']) {
    const v = t.shapes[key];
    if (typeof v === 'string' && v) out[key] = v;
  }
  return out;
}

// #961 — 风格设定（theme settings）：圆角 / 留白 / 阴影 / 按钮形状。
// 每套恒四个键，每个键的值必须落在下面的允许集合里 —— 不是随手写的词，一条 grep 就能判。
// 🔴 这四个集合与 `src/lib/themeSettings.ts` 里那几张表的键必须一一对应：表是把档位翻成
//    CSS 变量的地方，这里是数据这边的权威。对不上的档位在那边会被【整组跳过】，落回默认值
//    （老站今天的样子），所以失败方向是"没变"而不是"变成别的" —— 但那也意味着这套 theme 的
//    这一维静默失效，所以有一条测试盯着两边相等。
const THEME_SETTING_VALUES = {
  radius: ['subtle', 'sharp', 'round'],
  density: ['standard', 'compact', 'airy'],
  shadow: ['soft', 'none', 'strong'],
  buttonShape: ['rounded', 'square', 'pill'],
};

// #1318 — 这套主题的**选择单**：每个块类型各选一个画法名（`theme-pool.json` 的 `shapes`）。
//
// 🔴 #1353 —— 这里原来写着「31 个块类型」，并且旁边一整段讲它跟 `layoutFor`（读 `supports`）
//    是两件事、别合并。那两句今天都不成立：`supports` 整个退役了，`layoutFor` 改名
//    `regionShapesFor` 并且读的就是这张表（见它自己那段）。今天这张表有 **34** 个键 ——
//    31 个内容块 + 顶栏 / 页脚 / 公告条三个区。数别抄这里，现取：
//    `node -e "const{blockShapeCatalog}=require('./scripts/lib/block-catalog.js');console.log(blockShapeCatalog().blocks.length)"`
//    （`regionShapesFor` 只是同一张表的一个视图：它只挑三个区那三行。）
//
// 🔴 注册表里查不到这个 id（候选流水线装候选、或者站穿着一套已下架的主题）时回**空对象**，不是
//    报错：调用方 `sync-config.js` 拿不到选择单就不写 `data-shape`，页面落回 `base.css` 的地板，
//    跟本票之前那些没有 shape 的产物是同一个样子。失败方向是「这一维没生效」，不是构建打死。
function shapesFor(themeId) {
  const t = themes[themeId];
  return (t && t.shapes) || {};
}

function settingsFor(themeId) {
  const t = themes[themeId];
  return (t && t.settings) || null;
}

// #993 — a theme may NOT carry a `rhythm` key any more, and this is the check that says so.
//
// Why the rule (spec D8, Chris 2026-08-13 "换主题不改 block placement"): which blocks a page shows
// and in what order is the site's own decision, and it lives in the site's page JSON. Three reasons
// it cannot be a theme's:
//   1. it is business-driven, not aesthetic — a bakery leads with the menu, a law firm with credentials
//   2. the blocks a theme would be hiding are the ones carrying the structured data search engines and
//      AI assistants read. A theme that hides them turns off the site's ability to be found.
//   3. with only a few dozen themes in the pool, "the theme decides the order" means every site wearing
//      the same theme has the SAME order and the same hidden blocks. Once the CSS work flattens the
//      markup, placement is the main thing left that tells two of our sites apart.
//
// 🔴 It reports the WHOLE registry, not the one theme being built — the same reason `themesMissingRhythm`
// did (#983): a check that only looks at the theme this site happens to wear leaves a `rhythm` sitting in
// any of the other 29 unmentioned, which is precisely how it would come back.
function themesWithRhythm() {
  return Object.keys(themes).filter((id) => themes[id].rhythm !== undefined);
}

// #1353 — 注册表里**不许再有 `supports` 这个键**，这是说这句话的地方。照 `themesWithRhythm`（#993）
// 的样子写。
//
// 为什么从「只许有区那三个键」（#1341）收成「一个都不许有」：`supports` 最后剩下的用途是顶栏 /
// 页脚 / 公告条这三个区的结构，而 #1353 把这三个区按块的规矩搬进形态层之后，它们跟别的 32 个块
// 读**同一张选择单**（`shapes`）。两张清单说同一件事，漂了没有任何东西会红 —— 而漂的方向尤其难查：
// `supports` 写着 `pill-floating`、选择单写着 `solid-bar`，页面按选择单画，而所有讲「这套主题的顶栏
// 是什么」的地方（图册、`remediation` 给老板的那句话）可能读的是另一份。
//
// 🔴 报的是**整个注册表**，不是这个站穿的那一套 —— 理由跟 `themesWithRhythm` 上面那段逐字相同：
//    只看当前这一套，剩下每一套里留着的那个键就是它回来的路。
//    返回 `[[id, ['header', …]], …]`：点名是哪一套、里面还剩哪几个键，不只说「有问题」。
function themesWithSupports() {
  const out = [];
  for (const id of Object.keys(themes)) {
    const sup = themes[id].supports;
    if (!sup || typeof sup !== 'object') continue;
    out.push([id, Object.keys(sup)]);
  }
  return out;
}

// Every theme that suits this industry, in registry order (so rotation is predictable).
// Never shorter than MIN_ROTATION_POOL; never empty.
//
// 🔴 #1016 挑的范围是 `poolThemes`，**不是** `themes`。#1161 之后这两个恒是同一批（退役的已经从
// `themes` 里拿掉了），所以这里写哪一个今天都一样 —— 仍然写 `poolThemes`，因为它回答的正是
// 「新站挑得到吗」这个问题。判据没变：拿全部行业词逐个跑这个函数，退役的 id 一个都不该出现
// （`theme-pipeline/pool.test.js` 的 ④）。
// 📌 别在这句话里写套数：#1161 时是 80，#1174 之后 97，#1317（2026-09-14）整池下架重建之后是 2。
//
// 🔴 #1119 —— 池子怎么取，分两条路，而**大多数生意走第一条**：
//
//   ① 这段行业文字认得出行业组（`sectorIndexForIndustry`，按词边界匹配那 16 组的词表）⟹ 候选 =
//      **本组那 5 套 + 它 `partner` 那组的 5 套**，按【组成员】取，**不看这几套主题自己声明了哪些词**。
//      为什么不看：16 组 × 5 套的结构让词级匹配恒只给 4-6 套，而 epic #1007 要 ≥10；靠往每套的
//      `industries` 里塞词去补，在 80 套的池子上算术无解（要 212×10=2120 个命中对，而
//      `pool.test.js` 第 ③ 格允许的上限是 80×14.73=1179）。Chris 2026-08-19 拍的是「标签接宽」，
//      落地形态是组与组之间的一句相容声明 —— 理由和四条约束写在 `industry-sectors.js` 的组表上方。
//   ② 认不出组（老板自己填的自由文本，如 `汽车维修` / `quantum widgets` / 空串）⟹ 落回下面那行的
//      `industries` 匹配，再照走 `NEUTRAL_TOPUP` 兜底。**这是今天兜底唯一真开火的地方**：走 ① 的
//      池子恒 10 套，进不了 `MIN_ROTATION_POOL` 那个分支。
//
// 🔴 #1115 —— ② 那条路上的匹配按**词边界**，不许裸 `includes`（`hasPhrase`，与 `isOnSiteIndustry`
//    和 `coverage.js` 的「真命中」同一份判据）。理由是量出来的：拿 212 个行业词逐个跑，裸 `includes`
//    有 **14 个词 / 55 处**主题是靠「子串碰巧命中」进候选池的，成因集中在四个很短的声明词 ——
//    `it`（科技那四套）· `tire`（汽修那四套）· `art`（艺术那五套）· `market`（市集那五套）。
//    📌 #1119 之后这 14 个词**都走 ① 了**（它们全在那 212 个词表里），所以裸 `includes` 与
//    `hasPhrase` 在**词表的词上**已经分不出高下 —— 这一族误命中现在只可能从 ② 那条路进来
//    （老板填的自由文本，如 `smart home automation` 含着 `art`）。因此 `pool.test.js ⑩` 在 #1119
//    里跟着换了量的对象：它现在两臂都问 —— **一臂问匹配器本身**（`industries` 匹配到哪几套，
//    ① 与 ② 共用的那份判据，14 个词一个不少地照旧钉着），**一臂问 ② 那条路的真后果**
//    （自由文本进去，声明短词的那几套不许被拉出来）。改那道守卫前先读它自己那段注释。
//
// 📌 走 ① 时那 10 套里有 5 套并没有为这个行业「做过皮」，它们是被**提供**的、不是被**声明**的。
//    这是 Chris 拍板时答过的那个产品判断（一句「气质相容」就够格被端上桌），不是这里偷来的绿：
//    `industries` 一个字都没动，所以第 ③ 格那两行读数按构造不变。
function candidateThemesForIndustry(industry) {
  const tokens = industryTokens(industry);
  const sector = sectorIndexForIndustry(industry);
  const partner = sector >= 0 ? partnerIndexOf(sector) : -1;
  const groupOf = sectorOfTheme();
  // 两条路都按 `poolThemes` 自己的键顺序产出（上面那句「in registry order」说的就是它）——
  // 组邻接这条也走一次 filter，而不是把两组的清单接起来，就是为了让顺序仍然只有这一个来源。
  const pool = sector >= 0
    ? Object.keys(poolThemes).filter((id) => {
      const g = groupOf.get(id);
      return g === sector || (partner >= 0 && g === partner);
    })
    : Object.keys(poolThemes).filter(id =>
      poolThemes[id].industries.some(kw => hasPhrase(tokens, kw))
    );
  for (const id of NEUTRAL_TOPUP) {
    if (pool.length >= MIN_ROTATION_POOL) break;
    if (!pool.includes(id)) pool.push(id);
  }
  // ── 🔴 #1114 第二道兜底：#1333 删掉了 ────────────────────────────────────────────────────────
  //
  // 它原来做的事：上门行业的候选池里一套「声明了 `supports.hero` 含 `with-form`」的主题都没有时，
  // 从 `NEUTRAL_TOPUP` 里补一套进来。理由是当时**只有声明过的主题画得出**带表单的首屏，所以抽不到
  // 那种主题的生意按构造拿不到第一屏表单（当天 53 个上门行业词里 28 个是 0）。
  //
  // #1333 把带表单的首屏拆成了自己一个块类型 `hero-with-form`：排版归 `public/shapes.css` 这一份
  // 平台文件、皮按类名写（`.hero__form`），两者都跟主题选了哪种画法无关 ⟹ **任何主题都画得出**，
  // `lib/hero-lead-form.js` 里那道「这个站抽到的主题声明过没有」一起退役了。于是这道兜底问的那句话
  // 不再问得出东西：没有任何主题能再声明 `with-form`（#1341 之后 `supports` 里连 `hero` 这个键
  // 都不许有了，见 `themesWithBadSupportsKeys`）⟹ 条件恒真、
  // `find` 恒 undefined、这段代码**恒不开火**，而它不开火的样子跟它开火完全一样：静默。
  //
  // 它给的那份保证没有丢，只是换了地方量：`lib/hero-lead-form.test.js` ⑥ 现在逐个上门行业词问
  // 「这个词建出来的站，首页第一个块是不是 `hero-with-form`」—— 那是这条保证真正要说的话。
  //
  // 📌 删它对候选池本身零影响：两臂逐词比过，212 个行业词的候选池逐字相同（#1333 交付留言）。
  return pool;
}

// siteId is 8 random hex chars, so this spreads uniformly. It is the fallback for when the
// caller has no rotation counter (anonymous create, DB read failed) — consecutive sites
// then land on unrelated slots instead of stepping through the pool, which still spreads,
// just without the guarantee.
function rotationIndexFromSiteId(siteId) {
  const s = String(siteId || '');
  let h = 0;
  for (let i = 0; i < s.length; i++) {
    h = (h * 31 + s.charCodeAt(i)) >>> 0;
  }
  return h;
}

// rotationIndex says which slot of the industry's pool to take. Manager passes it as
// themeRotationIndex, and it goes up by exactly one per site the same user creates — so N
// consecutive creates in one industry still walk N different slots of the candidate pool.
// #1041: it is no longer that counter on its own. Manager now adds a per-user starting offset
// (`themeRotationOffset` in manager/sites.go), because the bare counter made EVERY user's first
// site index 0, i.e. one fixed theme per industry for every first site on the platform. Only the
// starting point moved; the +1-per-site part is what keeps the guarantee in the line above.
function pickThemeForIndustry(industry, rotationIndex, disabledThemes = []) {
  const pool = candidateThemesAfterDisabled(industry, disabledThemes);
  // 🔴 #1346 —— 一套都不剩时返回 null，让调用方干净失败。原来这里是 `pool[n % pool.length]`，
  //    空池上 `n % 0` 是 `NaN` ⟹ 下标 `NaN` ⟹ `undefined` ⟹ 下一行 `themes[undefined]` 也是
  //    undefined，然后建站一路往下走，产出一个没有主题的站。那是静默的错法。
  if (!pool.length) return null;
  const n = Number.isInteger(rotationIndex) && rotationIndex >= 0
    ? rotationIndex
    : Math.floor(Math.random() * pool.length);
  return pool[n % pool.length];
}

/**
 * 候选池减掉后台关掉的那些（#1346）。两级，顺序是承重的：
 *
 *   ① 这个行业的候选池减去停用的 —— 正常情况走这一支，轮换的保证一个字没变（`drawDistinct` 那一侧
 *      同理：池子小了但仍然是按位置取）。
 *   ② ① 空了 ⟹ 落回**全池**减去停用的。这一步是有意的：行业候选池只有 5-10 套（#1119 那 16 组），
 *      关掉几套就可能整组清空，而那时平台上明明还有别的主题能穿。宁可给一套「不那么对味」的，
 *      也不要因为一次后台开关就建不出站。
 *   ③ ② 也空了 = 池里全部被关掉。返回空数组，调用方点名失败（本函数不 throw：它也被 sync-config
 *      那一侧以外的地方读，报文该由知道上下文的那一方写）。
 *
 * 🔴 清单为空时**原样**返回 candidateThemesForIndustry 的结果，一个 filter 都不跑 —— 这样
 *    「没有任何东西被关掉」那条路逐字节等于 #1346 之前。
 */
function candidateThemesAfterDisabled(industry, disabledThemes = []) {
  const off = new Set((disabledThemes || []).filter((id) => typeof id === 'string' && id));
  const candidates = candidateThemesForIndustry(industry);
  if (!off.size) return candidates;
  const narrowed = candidates.filter((id) => !off.has(id));
  if (narrowed.length) return narrowed;
  return Object.keys(poolThemes).filter((id) => !off.has(id));
}

module.exports = {
  themes,
  // #1161 —— `themes` 今天就是 `poolThemes`，两个名字留着是因为两边的问题不同：`themes` 回答
  // 「按 id 查得到吗」，`poolThemes` 回答「新站挑得到吗」。历史上它们不相等（#1016~#1161 之间
  // `themes` 多出退役那 30 套），把其中一个删掉会让那段历史里写的每一处引用悄悄改变意思。
  poolThemes,
  // #1161 —— 已下架那 30 套只剩 id / 名字 / 配色，**不在 `themes` 里**。给弹窗那张当前卡用。
  retiredThemes,
  DEFAULT_LOGO_STYLE,
  MIN_ROTATION_POOL,
  // #1016 —— 兜底那四套导出来，好让 `pool.test.js` 能问一句「它们是不是都还在挑得到的那一池里」。
  // 指到池外（比如退役的 id）时新站会兜出一套自己抽不到的皮，而那是静默的。
  NEUTRAL_TOPUP,
  THEME_SETTING_VALUES,
  themeStyle,
  regionShapesFor,
  // #1318 —— 选择单（每个块类型一个画法名），`sync-config.js` 按它写 DOM 上的 `data-shape`。
  shapesFor,
  settingsFor,
  themesWithRhythm,
  themesWithSupports,
  candidateThemesForIndustry,
  // #1346 —— 候选池减掉后台关掉的那些。导出来让 create-site.js 之外的人也能复算「为什么抽到它」。
  candidateThemesAfterDisabled,
  rotationIndexFromSiteId,
  pickThemeForIndustry,
};
