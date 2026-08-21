// #924 — Theme registry. THE single source of truth for what a theme is.
//
// A theme has four parts:
//   colors      配色 — primary 50-900 + accent 50-600, copied into brand.json at creation, and
//               again whenever the owner changes theme (#1121: brand.json 是颜色的唯一出处)
//   fonts       字体 — heading/body families + the Google Fonts URL
//   supports    我为哪些形态写了样式 — block 类型 → 形态清单。`{}` means "no preference".
//               🔴 #1010 起这个键叫 supports,以前叫 layout(spec §4.5)。改名连着换了方向:
//               `layout` 是主题**替站做选择**(一个值),`supports` 是主题**声明能力**(一个清单),
//               站自己在页面 JSON 的 `block_layout` 里选。今天清单里恒一项,见下面 layoutFor 那段。
//               🔴 #960 起它还带两个【不是 block】的键:`header` / `footer`,顶栏和页脚的结构。
//               它们【走不了】sync-config 里那个按 `supports[block.type]` 取的循环(没有任何 block
//               的 type 叫 header/footer,加了会被 `if (!preferred) continue` 静默跳过),所以由
//               `scripts/region-layout.js` + sync-config 的 §Regions 单独消费。清单也在那个文件。
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
// #956 — **退役的那 30 套**里，每套的 supports 表覆盖 28 种 block：registry.ts 的 34 种类型减掉 6 个
// 一个 variant 都没有的（contact-form · quote-form · services-list · services-nav · values-grid ·
// service-related-pages），外加 header / footer 两个 Region 键。#956 当时立的两条性质（每套的键集合
// 相同 · 每种 variant 至少有一套用到）说的就是那 30 套。
//
// 🔴 #1016 —— **新池那 80 套不是这个形状，而且不该是。** 阶段 2（#1030 收尾）把 34 个块的外观全部搬
// 进了主题自己那份 CSS，组件里再没有一处按 variant 分支（`grep -c 'variant === ' src/components/
// sections/*.tsx` 今天是 0）。所以「这套主题在这个块上用哪种写法」已经不是靠一个 variant 名字表达的了
// —— 新池每套的 supports 只有三个键：`hero`（生成器唯一还在选的那个版式）+ `header` / `footer`
// （#960 的 Region 结构，它们仍然是**结构**而不是 CSS）。其余 31 个块的差异全在那份表的字节里。
// ⟹ 拿 #956 那两条去核新池会红，而那不是「新池漏填了」，是那两条说的是另一批主题。
//
// 🔴 #993 — A THEME DOES NOT DECIDE BLOCK PLACEMENT. It used to (#962/#983 gave every theme a
// `rhythm: { hide, order }` that hid blocks and re-ordered them at build time); spec D8 removed it,
// and a theme carrying that key is now a build error — see `themesWithRhythm` at the bottom of this
// file for the check and the three reasons. Which blocks a page shows, and in what order, comes only
// from the site's own page JSON: the order of the `sections` array, and each section's `hidden`.

// ── 新池（#1016，spec §8 阶段 3）与冻结退役的旧 30 套 ─────────────────────────────────────────────
//
// 🔴 **「查得到」和「挑得到」是两件事，这里把它们分开。**
//
//   poolThemes   `scripts/theme-pool.json` —— 新建网站**挑得到**的那一池（#1016 跑 #1004 那条流水线
//                生成、过完四道闸的那批）。每一套的样子主要在它自己那份表里
//                （`public/themes/<sheet>.css`，阶段 2 之后 34 个块的外观都住在那儿）。
//   retiredThemes `scripts/themes-retired.js` —— #924~#961 手写的那 30 套。spec D3「冻结退役」：
//                新站不再抽到它们，但**一个字都不许删** —— 今天线上每个站的 theme.json 写的都是
//                这 30 个里的某个 id，删掉就是让那些站建不出来（理由写在那个文件头上）。
//
// `themes` 是两者的并集，因为**按 id 查**的那几条路（sync-config 的 applied 分支、themeStyle、
// layoutFor、settingsFor、换主题对话框）必须查得到已经上线的那 30 套。而**挑**那条路
// （candidateThemesForIndustry，本文件底部）只走 `poolThemes`。
const poolThemes = require('./theme-pool.json');
const { retiredThemes } = require('./themes-retired.js');
// 🔴 #1114 —— 判「这套主题给带表单的 hero 写过造型吗」只有一个权威（它读 `supports.hero`，而
// `supports` 是派生值、`theme-pipeline/pool.test.js` 在对账它与外观表一致）。在这里**不重写一遍**
// 那三行：同一个谓词两份实现，分叉的方向是静默的（挑的时候按一份、真正给不给按另一份）。
// 判过没有环：`lib/hero-lead-form.js` 只 require `theme-pipeline/industry-sectors`（无 require）与
// `blocks.js`（只 require 一个 JSON），两条都不回头 require 本文件。
const { themeSupportsHeroForm } = require('./lib/hero-lead-form.js');
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

const themes = { ...poolThemes, ...retiredThemes };

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
const NEUTRAL_TOPUP = ['fern-02', 'jade-26', 'azure-50', 'violet-74'];

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

// 一套主题对每个 block 用哪种写法的结论，或者 {}（主题不认识 / 什么都没声明）。调用方把 {}
// 当成「页面 JSON 说了算」。
//
// 🔴 #1010 —— 注册表那边的键已经从 `layout` 改成 `supports`，值也从「一个写法」变成「一个清单」，
// 而这个函数**仍然吐一个写法**：`supports` 里每个 block 取清单的第一项。为什么要有这一步转换：
//
//   · 声明能力（`supports`，主题）和做选择（`block_layout`，站）是两件事，spec §4.5 / §4.6 把它们
//     分开了。而**站那边今天还不做这个选择** —— #998 落地的 `block_layout` 与 `data.variant` 是
//     并存的两个字段、彼此不换算（`scripts/blocks.js:21-22`），建站 AI 也还不供 `block_layout`。
//   · 所以在站真的开始选之前，得有人替它选，而唯一不改变任何一个站的选法就是「主题声明的第一项」
//     —— 今天每份清单恒一项，取第一项 == 改名前那个值，逐字节相同（#1010 对 30 套 × 30 个键全量比过）。
//   · 这个函数因此是**过渡态的适配器**，不是新能力。阶段 2 逐块把外观搬进 CSS 之后，`supports` 的值
//     会从外观词（`gradient-overlay`）换成结构词（`with-media`），那时消费方改成读清单、这一层就删掉。
//     🔴 在那之前别给它加第二个用途 —— 它存在的理由只有「让改名这一步产物不变」这一条。
function layoutFor(themeId) {
  const t = themes[themeId];
  if (!t || !t.supports) return {};
  const out = {};
  for (const [type, forms] of Object.entries(t.supports)) {
    if (Array.isArray(forms)) { if (forms.length) out[type] = forms[0]; }
    else out[type] = forms;
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

// Every theme that suits this industry, in registry order (so rotation is predictable).
// Never shorter than MIN_ROTATION_POOL; never empty.
//
// 🔴 #1016 —— 挑的范围是 `poolThemes`，**不是** `themes`。两者差 30 套：那 30 套是 spec D3 冻结退役的
// 旧池，它们留在 `themes` 里只为了「按 id 查得到」（已经穿着它们的站要建得出来），新站不许再抽到。
// 判据在 AC4：拿全部行业词逐个跑这个函数，旧 30 个 id 一个都不该出现。
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
  // ── 🔴 #1114 第二道兜底：上门行业不许整组【永远碰不上】第一屏那个表单 ──────────────────────────
  //
  // Chris 2026-08-19 拍的是「不保证」——「我觉得是有需要就有，碰上就有，不是一定要有的」——**加一条**
  // 「但没有一组可以是永远碰不上」。今天 53 个上门行业词里 **28 个**的候选池里一套带表单的都没有
  // （园艺 13 词 + 工业安防 13 词整组，加上 `hvac` 和 `mechanic`），也就是那些生意的站**按构造**
  // 拿不到那个表单，跟运气无关。
  //
  // 🔴 真因是两个小机制的干涉，不是哪张表写漏了（PM 与 role-user 各量一遍、我自己复算过）：
  //   ① 池子按「16 组 × 5 套」排（`industry-sectors.js` THEMES_PER_SECTOR），而 hero 外观是 8 档轮转、
  //      其中只有 `form-side` 一档带表单（`sheet-recipes.js` heroLookFor：落在第 8·15·22·29·36·43·
  //      50·57·72·79 个位子）⟹ 每 7 个位子出现一次，而一组只占 5 个位子。**7 与 5 错开 ⟹ 必然有整组
  //      被跳过**：今天被跳过的 6 组里就有园艺（位子 51-55）与工业安防（61-65）。
  //   ② 每套主题「让出」组里一个词（`wordsForSlot`，让的是第 `slot % k` 个）—— 家装 slot4 = `azure-50`
  //      带表单，它让掉的正好是 `hvac`；汽车 slot1 = `fern-57` 带表单，让掉的正好是 `mechanic`。
  //   26 + 2 = 28，账对得上。
  //
  // 🔴 为什么修在这里，而不是动 ① 或 ②（三个杠杆 PM 都量过、明说不是硬约束，这是我的取舍）：
  //   · 动外观轮转（①）能给那两组一套真正属于它们的带表单主题，但一张 sheet 是位子序号的**纯函数**
  //     ⟹ 要重生成一批 CSS，而且**已经穿着这些主题的站下次 rebuild 第一屏就会变样**。为「让它有一档
  //     机会」付这个代价不成比例。而且 `pool.test.js` 还有一条下限「七种画法每种 ≥ 8 套」压着，
  //     挪档位要连那条一起重算。
  //   · 改 `wordsForSlot` 的让位（②）只治 `hvac` / `mechanic` 两个词（28 个里的 2 个），而且
  //     `industries` 是**生成到 `theme-pool.json` 里的**，改它要重生成那份池子 ⟹ 会顺带改掉一大批
  //     别的词的候选池，波及面比它治的东西大得多。
  //   · 这里加一道兜底：**只在「这是上门行业」且「池里一套带表单的都没有」时**，把兜底那四套里带表单
  //     的那一套接上来。不动任何生成产物、不动一行 CSS、已建站的样子一个像素不变，而 28 个词各拿到
  //     一档机会（命中率 = 1/池长，与别的上门词 20%-33% 同一个量级）。
  //
  // 🔴 `isOnSiteIndustry` 那一半是承重的，不是保险：表单只在「上门行业 **且** 主题带表单」时才画
  //   （`lib/hero-lead-form.js` applyHeroLeadForm 的两支）。不加这个条件，非上门行业的候选池也会多
  //   一套 —— 那些站的表单一个都不会多，只是它们的主题轮换被改了，纯粹的副作用。
  // 🔴 兜底源用 `NEUTRAL_TOPUP` 而不是「随便找一套带表单的」：这里是在给一个**没有声明过这个行业**的
  //   主题开后门，而那四套的性质正是「视觉上通用、什么生意都配得上」（见上面它们的挑法）。
  // 📌 这道兜底自己也可能哑掉：`NEUTRAL_TOPUP` 哪天一套带表单的都没有，`find` 回 undefined、这里什么
  //   都不做，而失败方向是**静默**回到今天的 28 个 0。盯它的是 `lib/hero-lead-form.test.js` 那一格：
  //   它既逐词问 AC1，也单独问一句「兜底源里到底有没有带表单的那一套」，好让红的那一行说出真因。
  // 📌 传的是 `industry` 原文,不是上面那个 `lower`:`isOnSiteIndustry` 自己会 lowercase + 切词
  //    (`industry-sectors.js` industryTokens),两种传法今天对 224 个输入逐个比过、结果全同。写原文是
  //    因为 `lower` 是本函数上面那行的局部变量 —— 靠它就等于让这道兜底依赖别人怎么写匹配那一段。
  if (isOnSiteIndustry(industry) && !pool.some(id => themeSupportsHeroForm(poolThemes[id]))) {
    const withForm = NEUTRAL_TOPUP.find(id => themeSupportsHeroForm(poolThemes[id]));
    if (withForm && !pool.includes(withForm)) pool.push(withForm);
  }
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
function pickThemeForIndustry(industry, rotationIndex) {
  const pool = candidateThemesForIndustry(industry);
  const n = Number.isInteger(rotationIndex) && rotationIndex >= 0
    ? rotationIndex
    : Math.floor(Math.random() * pool.length);
  return pool[n % pool.length];
}

module.exports = {
  themes,
  // #1016 —— 挑得到的那一池（新池）。`themes` 是它加上冻结退役的旧 30 套的并集，见文件上方那段。
  poolThemes,
  retiredThemes,
  DEFAULT_LOGO_STYLE,
  MIN_ROTATION_POOL,
  // #1016 —— 兜底那四套导出来，好让 `pool.test.js` 能问一句「它们是不是都还在挑得到的那一池里」。
  // 指到池外（比如退役的 id）时新站会兜出一套自己抽不到的皮，而那是静默的。
  NEUTRAL_TOPUP,
  THEME_SETTING_VALUES,
  themeStyle,
  layoutFor,
  settingsFor,
  themesWithRhythm,
  candidateThemesForIndustry,
  rotationIndexFromSiteId,
  pickThemeForIndustry,
};
