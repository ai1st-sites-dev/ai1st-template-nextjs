#!/usr/bin/env node

// TICKET-219 decouple e2e: no-op comment — makes a templates/nextjs change so a
// templates+manager push verifies templates skips (no token) without blocking manager.

const fs = require('fs');
const path = require('path');
const blockManifest = require('./lib/block-manifest');
const { themes, layoutFor, themesWithRhythm } = require('./themes');
const pageLayoutLib = require('./lib/page-layout');
// #1108 —— 报错里「那你去做 X」那几句话由代码算出来（判据是白名单自己），不写死。
// 理由整段写在那个文件头上:这些话会被 edit-site.js 原文推进老板的聊天窗口。
const remediation = require('./lib/remediation.js');
const themeTokens = require('./lib/theme-tokens');
// #1104 r6 —— 「这个站的 Region 解析成什么版式」搬到了这里，构建和 AI 聊天编辑器共用同一份
// 实现（理由写在那个文件头上）。`resolveRegionLayout` 本身从此只由它调。
const siteRegions = require('./lib/site-regions');
const { checkCssContracts } = require('./css-contract-check');
// #998 — 页面内容层的形状（sections → blocks）。归一化、站级块库、校验都在那个文件里，
// `create-site.js` 写盘时读的是同一份实现。
const {
  readSiteBlocks, normalizeLocalePages, loadBlockManifests, validateBlockLayouts, MANIFEST_DIR,
  BLOCK_ROLES,
} = require('./blocks');
const tweakLib = require('./tweaks');
// #1038 —— 站主挑的绝对值（一组配色 / 一档圆角 / 一对字体）。跟 tweaks 分两个文件的理由写在那边的文件头。
const presetLib = require('./theme-presets');
const { buildThemeCss } = require('./theme-css');
// #1026 — sitemap 的 <lastmod> 要写「这一页上次什么时候变的」，不是构建时刻。取值规则整段写在那个文件头上。
const { createLastModifiedResolver } = require('./lib/page-lastmod');
// #1033 — 一页读的不只是它自己那份 JSON：跨页共享的 services.json / 站级块库也是它的内容。
// 哪一页读了哪些文件由这个文件算，边界（算什么、不算什么）写在它的文件头上。
const { blockTypesReadingServices, createPageDeps, isServiceDetailPage } = require('./lib/page-deps');

const rootDir = path.resolve(__dirname, '..');
const siteDir = path.join(rootDir, 'site');

if (!fs.existsSync(siteDir) || !fs.existsSync(path.join(siteDir, 'brand.json'))) {
  console.error(`Site config not found: ${siteDir}/brand.json`);
  process.exit(1);
}

// ─── #1009 — THE CSS CONTRACTS ARE CHECKED HERE, AT EVERY BUILD ──────────────────────────────────
//
// 🔴 WHY IN THIS FILE AND NOT IN npm's `prebuild` HOOK. `prebuild` is what a person runs
// (`npm run build`); the product does not. Every build a real site gets is `npx next build`, which
// does not fire npm's lifecycle hooks. The evidence is the call sites themselves: each of them spells
// out `node scripts/sync-config.js` rather than relying on a hook to do it.
//
// 🔴 #1046 条 2 — THE CALL SITES ARE NAMED BY FUNCTION, NOT BY LINE NUMBER. The five line numbers
// that stood here (`worker/main.go:1447/1457/1511/999/1264`) were ALL pointing at unrelated lines on
// `origin/main` — `:1447` is `// asks for nothing at all.` today — and one of them carried a claim
// that has no anchor left at all: it said main.go "says so in its own comment" about npm's hooks,
// and `grep -n 'prebuild\|predev\|npm lifecycle\|lifecycle hook' worker/main.go` returns nothing.
// Function names survive an edit above them; line numbers into another file do not.
//     🔴 That grep is narrow on purpose (QA1 caught the first version of this very comment, #1046).
//     Bare `lifecycle` returns two lines today (`:191` / `:318`) and both are about CONTAINER
//     lifecycle — nothing to do with npm. A comment whose own evidence command does not return what
//     the comment says it returns is the exact defect items 22/23/24 of this batch were opened for.
//
//     worker/entrypoint.sh, the `"$MODE" = "preview"` branch — sync-config, then `npx next build`
//                                in the serve loop (see `start_preview_server()`)
//     worker/entrypoint.sh, the create path — create-site.js → sync-config → same loop
//     worker/main.go `processDeployTask`   the publish build:
//                                `node scripts/sync-config.js && … npx next build --webpack`
//     worker/main.go `processEditTask`     before an edit is applied: sync-config on its own
//     worker/main.go `processRevertTask`   after a revert: sync-config on its own
//     worker/main.go `processThemeTask`    apply a theme: sync-config with its own `|| exit 8`
//     worker/main.go `undoThemeWrite`      putting a theme change back: sync-config again
//                                (`applyThemeByRebuilding`, the older-website path, is NOT a call
//                                 site of its own — processThemeTask has already run it by then)
//
// So this file is the one place every build of every site passes through — including the dev overlay
// path, which is the exposure this ticket named first (new markup from the template landing on a site
// repo's older sheet). Hanging the gate on `prebuild` would have covered `npm run build` and nothing
// the product does, while looking exactly like a gate.
//
// 🔴 A VIOLATION REFUSES THE BUILD; A MISSING TOOL DOES NOT. The two are told apart on purpose:
//   · violations → exit 1 here, so out/ keeps the last good site instead of being rebuilt into a
//     silently degraded one. Same shape as the `rhythm` and `theme.json css` refusals below.
//   · a sheet that is there but will not parse → exit 1 as well, for the reason in the next block.
//   · no postcss → say so loudly and carry on. It is not a reading about the sheets, and `next build`
//     is two seconds behind us with the same missing node_modules, so nothing gets published on the
//     strength of a skipped check.
//   · nothing to check → one line, carry on. Sites created before #991/#1001 have neither
//     public/themes/ nor public/base.css in their repo; refusing those would brick every rebuild of
//     every site that already exists.
const cssContracts = checkCssContracts(rootDir);
if (cssContracts.problems.length > 0) {
  console.error(`🔴 CSS contract violations (${cssContracts.problems.length}) in `
    + `${cssContracts.checked.join(', ')} — this build is refused:`);
  for (const p of cssContracts.problems) console.error(`   ${p}`);
  // 🔴 #1108（AC3 那次扫查抓到的第三处）—— 这里以前写的是裸的 `docs/reference/theme-css-contract.md`,
  //    而它从**读者所在的地方一个都解析不开**:这个脚本的 cwd 是 `templates/nextjs`(平台仓)或
  //    `/app/repo`(站容器,`worker/entrypoint.sh:69`),两处底下都没有 `docs/`。那份文档只存在于
  //    平台仓的仓根。⟹ 跟本票要治的病同一族:指了一条路,而那条路走不通。
  console.error('  · the ai1st platform repo has docs/reference/theme-css-contract.md at its root '
    + '(not under templates/nextjs, and not in a site repo) — it says what is allowed; '
    + 'each line above says which file and which line broke it.');
  process.exit(1);
}
// 🔴 AN UNPARSEABLE SHEET REFUSES THE BUILD TOO (#1009 r1, QA3 measured the way past this gate).
// Until this block existed, "present but will not parse" arrived here merged into "the tool did not
// run", and the policy for that is the warning below — so the way past the check was to make the file
// WORSE, not better: append the illegal `@import`, then append one extra `}`. Measured on this tree:
// `@import` alone → refused; `@import` plus the stray `}` → rc=0, one warning line, and the `@import`
// sitting in out/<site>/themes/<sheet>.css after a green `npx next build`. Hand-editing a sheet into a
// syntax error is more likely than hand-editing it into a legal-looking violation, so the hole was
// wider than the door.
//   · It cannot brick an existing site: sites whose repo predates #991/#1001 have no such files at
//     all, which is `skipped`, not `unreadable` (measured in a real container on r1: /app/repo/scripts
//     has no css-contract-check.js, so those sites never reach this code in the first place).
//   · The only way to land here is a sheet that has been broken, which is the case that should stop.
if (cssContracts.unreadable.length > 0) {
  console.error(`🔴 CSS sheet(s) that will not parse (${cssContracts.unreadable.length}) — this build `
    + 'is refused:');
  for (const u of cssContracts.unreadable) console.error(`   ${u}`);
  console.error('  · the 🔴 line above says what postcss choked on. A sheet nobody can parse cannot be '
    + 'judged against the contract, and this build will not go out wearing an unjudged sheet.');
  process.exit(1);
}
// Say it out loud in all three cases (#991's rule for the theme sheet, same reason): a build log with
// no such line means the check did not run, and that has to be visible without reading this file.
if (cssContracts.unavailable) {
  console.log(`  ⚠️  CSS contracts NOT checked — ${cssContracts.unavailable}`);
} else {
  console.log(cssContracts.checked.length > 0
    ? `  CSS contracts: ${cssContracts.checked.length} file(s) legal — ${cssContracts.checked.join(', ')}`
    : `  CSS contracts: nothing to check in this tree — ${cssContracts.skipped.join(' · ')}`);
}

// #924 — themes. site/theme.json records which theme this site got and whether its owner
// ever actively changed themes:
//
//     { "themeId": "ocean-blue", "applied": true }
//
// 🔴 #1121（2026-08-20）—— `applied` 不再决定这个站长什么样，一维都不决定。它从此只是记账：
// 「老板有没有主动换过装」。两件事各自有了固定答案，都不问它：
//
//   颜色 / 字体 / 风格设定   永远来自这个站自己的 brand.json，构建期一个覆盖都没有。换主题仍然
//                            改颜色 —— 写入时机挪到了老板按下 Apply 那一刻：worker 的
//                            processThemeTask 把新主题那套写进 site/brand.json 并提交它。
//   每个 block 的 variant    永远来自 themeId 那套主题（下面 structureThemeId 那个循环），跟
//                            #1086 对顶栏 / 页脚的做法同一个理由：同一套主题不该有两种长相。
//
// 在这之前，applied:false（新建的站）拿站自己的颜色 + 页面自己的 variant，applied:true（换过装
// 的站）拿注册表的颜色 + 注册表的 variant —— 一个布尔捆着两件想要相反默认值的事，所以它怎么
// 设都有一半是错的。#1064 摘走样式表、#1086 摘走顶栏页脚、#1118 摘走预览，本票收尾。
//
// 🔴 那么下面这个函数还剩什么用 —— 它的返回值【没有任何消费者】，调用它是为了它里面那道检查：
// 「applied:true 的站，它写的那套主题必须是这份构建认识的」，查不到就 exit 1。那个行为一个字都
// 没改，不是本票的交付面；那条路今天真实存在（prod 的 site-194f1f41 写着注册表里没有的
// luxury-dark —— #1087 在问该怎么办，#1092 把它翻成 applied:false 绕开了）。
// ⇒ applied 不再影响**长相**，但它仍然决定**这道检查开不开火**。别把这里读成「摘干净了」。
//
// 🔴 也不许把下面那句 `applied !== true` 单独删掉。它排在注册表存在性那个 process.exit(1)
// 前面，而候选流水线恒写 { themeId: "gen-07-xx", applied: false } 且那个 id 还不在注册表里
// （theme-pipeline/run.js 的 installCandidate）—— 删了它，每个候选站构建当场 exit 1。
//
// 📌 顺序上，顶栏 / 页脚的结构是 2026-08-18（#1086）先离开这个布尔的，本票把剩下那两维
// 一起带走。那一维的取法在下面 `readStructureThemeId`，本票的 variant 也改成问同一个读数。
//
// 🔴 Deliberately its own file. Whether site_meta.json exists is the legacy single-locale
// switch (line ~34 below), so putting this in there would make an old flat site fail to build.
function readAppliedThemeId() {
  const themePath = path.join(siteDir, 'theme.json');
  if (!fs.existsSync(themePath)) return null;
  let meta;
  try {
    meta = JSON.parse(fs.readFileSync(themePath, 'utf-8'));
  } catch (e) {
    console.error(`theme.json is not valid JSON: ${e.message}`);
    process.exit(1);
  }
  if (!meta || meta.applied !== true) return null;
  if (!themes[meta.themeId]) {
    // 🔴 #1102 —— **不把注册表整个列出来。** 这句话不是只进 CI 日志：`edit-site.js` 把
    // sync-config 的 stderr 原文推进老板的聊天窗口（那边 `syncError` 那一支），而列全表就是
    // 110 个 id / 1269 个字符 / 按 80 列算 16 行 —— 占满整个聊天面板，而对老板毫无意义。
    // 要那份名单的人（我们）本来就有更好的入口：`node -e "console.log(Object.keys(require('./scripts/themes.js').themes).join('\n'))"`。
    console.error(`theme.json names theme "${meta.themeId}", which is not in the registry`
      + ` — scripts/themes.js has ${Object.keys(themes).length} themes and "${meta.themeId}" is not one of them`);
    process.exit(1);
  }
  return meta.themeId;
}
// 🔴 #1121 —— 只调用，不取值。它的返回值今天没有任何消费者（理由整段在上面）：跑它是为了它
// 里面那道「applied:true 的站，它说的主题必须认识」的检查。
readAppliedThemeId();

// #1079 / #1086 —— 这个站的两个 Region 解析成什么版式。**判断本身住在 `lib/site-regions.js`**
// （2026-08-20 #1104 r6 从这里搬过去的，逐字未改，连注释一起）：AI 聊天编辑器放行一次对
// `navigation.json` 的编辑之后，要问同一个问题（「这个站的页面读不读这个字段」），两处各写一遍
// 必然分叉，而分叉的方向是门说的话跟页面上发生的事对不上 —— 正是本票要治的那个病。
//
// 🔴 这一行【必须留在这里，不能挪到下面 §Regions 那一段去】。它原来就在这个位置（`const
//    structureThemeId = readStructureThemeId();`），而 #1121（2026-08-20）给 `structureThemeId`
//    加了一个**新的消费者**：下面那个「主题声明的 variant 说了算」的循环。`const` 有 TDZ，声明挪到
//    那个循环之后 ⟹ 每一次构建当场 ReferenceError。合并 #1121 时踩到过这一下。
const { regionLayout, structureThemeId, explicitRegionLayout } = siteRegions.resolveSiteRegionLayout(siteDir);

// #991 — THE THEME **CSS** SHEET, WHICH IS A DIFFERENT SWITCH FROM `applied` ABOVE.
//
//     { "themeId": "ocean-blue", "applied": true, "css": "hero-media-left" }
//
// `applied` decides whether the REGISTRY (a JS object) takes over colours, fonts and section
// variants. `css` names a stylesheet in `public/themes/` that owns LAYOUT for the blocks that have
// been made neutral — today that is hero and nothing else (phase 1 of
// docs/superpowers/specs/2026-08-12-theme-css-architecture-design.md).
//
// 🔴 THE FIELD NOW DOES ONE THING: it names the sheet whose bytes get pasted into the generated
// `public/theme.css` (see §theme.css below); the page only ever links the fixed path `/theme.css`.
// It used to do two — emit `<link href="/themes/<name>.css">` (#1002 replaced that with the fixed
// path) and flip hero to its neutral markup (#1008 deleted the nine variant branches, so the neutral
// markup renders whether or not a sheet is named). 🔴 The pairing that used to be load-bearing is
// therefore gone in one direction only: neutral markup with NO sheet is a hero laid out by base.css
// alone (#1001's floor), which is a real state now, not a broken one. Absent on every site that
// exists today ⟹ theme.css carries colours/fonts/settings and no block-layout rules.
//
// 🔴 IT IS NOT EXPORTED TO THE APP ANY MORE (it used to be `themeCss` in config-data.ts). Two tickets
// each took one of its two consumers: #1002 replaced the `<link href="/themes/<name>.css">` with the
// fixed path, and #1008 deleted hero's nine variant branches so the neutral markup renders
// unconditionally. Nothing at runtime asks the question any more — which sheet to paste is decided
// here, at build time, and stays here. An export nobody reads is a field the next person will wire
// something new onto.
//
// 🔴 The name is checked against the FILE, not against a list kept here: a list is a second place to
// forget. A missing sheet fails the build by name — same shape as #993's `rhythm` check below, and for
// the same reason (a site that silently builds with no hero styling looks like a broken theme, and
// nothing would say which of the two it was).
function readThemeSheet() {
  const themePath = path.join(siteDir, 'theme.json');
  if (!fs.existsSync(themePath)) return '';
  let meta;
  try {
    meta = JSON.parse(fs.readFileSync(themePath, 'utf-8'));
  } catch {
    return ''; // readAppliedThemeId above already reported the parse error and exited.
  }
  const name = meta && typeof meta.css === 'string' ? meta.css.trim() : '';
  if (!name) return '';
  // Slug only. This value reaches a filesystem path (#1002 removed the href — the sheet is pasted
  // into theme.css now), and `../` in it is a way out of the directory — refuse rather than
  // sanitise, so a typo is loud instead of silently rewritten.
  if (!/^[a-z0-9][a-z0-9-]*$/.test(name)) {
    console.error(`theme.json css "${name}" is not a valid sheet name (lowercase letters, digits and hyphens)`);
    process.exit(1);
  }
  const sheet = path.join(rootDir, 'public', 'themes', `${name}.css`);
  if (!fs.existsSync(sheet)) {
    // 🔴 #1102 —— 同一族的第二处（票正文只点了上面那一处，这里是同一个形状：83 个表名 / 936 个
    // 字符，也会被原样推进聊天窗口）。数量 + 目录名代替全表；「目录根本不存在」是另一个读数，
    // 不是空名单，所以那一支保持原样说出来。
    const themesDir = path.join(rootDir, 'public', 'themes');
    const sheetCount = fs.existsSync(themesDir)
      ? fs.readdirSync(themesDir).filter(f => f.endsWith('.css')).length
      : null;
    console.error(`theme.json css "${name}" names public/themes/${name}.css, which is not there`
      + (sheetCount === null
        ? ' — and public/themes does not exist at all'
        : ` — public/themes has ${sheetCount} sheet(s) and "${name}" is not one of them`));
    process.exit(1);
  }
  return name;
}
const themeSheet = readThemeSheet();

// TICKET-127: backward-compat for pre-122a legacy single-locale schema. Old
// sites have a flat `site/{brand,seo,services,navigation}.json + site/pages/`
// layout with no site_meta.json and `brand.tagline` as a string (not Record).
// Detecting absence of site_meta.json triggers legacy mode: defaultLocale='en',
// locales=['en'], localeDir=siteDir (no <locale>/ subdir), and brand.tagline
// gets wrapped to { en: <string> } so templates that read getTagline(locale)
// keep working uniformly.
const siteMetaPath = path.join(siteDir, 'site_meta.json');
let defaultLocale, locales;
let isLegacySchema = false;
// TICKET-268b: the built static site needs its own siteId (tenant id for POST /api/leads) + the
// lead API base (absolute manager URL — the site is served from R2, so the form POSTs cross-origin).
let siteId = '';
let leadApi = '';

if (!fs.existsSync(siteMetaPath)) {
  console.log('[backward-compat] site_meta.json missing, inferring legacy single-locale schema (defaultLocale=en)');
  defaultLocale = 'en';
  locales = ['en'];
  isLegacySchema = true;
} else {
  const siteMeta = JSON.parse(fs.readFileSync(siteMetaPath, 'utf-8'));
  ({ defaultLocale, locales } = siteMeta);
  siteId = siteMeta.siteId || '';
  leadApi = siteMeta.leadApi || '';

  if (!defaultLocale || !Array.isArray(locales) || locales.length === 0) {
    console.error(`site_meta.json invalid: must contain defaultLocale (string) and locales (non-empty array)`);
    process.exit(1);
  }
  if (!locales.includes(defaultLocale)) {
    console.error(`site_meta.json invalid: defaultLocale "${defaultLocale}" not in locales [${locales.join(', ')}]`);
    process.exit(1);
  }
}

console.log(`Syncing site config (locales: ${locales.join(', ')}, default: ${defaultLocale})${isLegacySchema ? ' [legacy schema]' : ''}...`);

const brand = JSON.parse(fs.readFileSync(path.join(siteDir, 'brand.json'), 'utf-8'));

// TICKET-127: legacy brand.tagline is a string; new schema is Record<locale, string>.
// Wrap legacy form so templates' getTagline(locale) returns the right value uniformly.
// Defensive: missing / null / non-object tagline becomes empty Record so getTagline()
// falls through to its '' default instead of crashing on `null[locale]` or similar.
if (typeof brand.tagline === 'string') {
  brand.tagline = { [defaultLocale]: brand.tagline };
} else if (!brand.tagline || typeof brand.tagline !== 'object' || Array.isArray(brand.tagline)) {
  brand.tagline = { [defaultLocale]: '' };
}

// TICKET-136: legacy brand.name is a string; new schema is Record<locale, string>.
// Auto-wrap so downstream code (lib/config.ts getBrandName + components reading
// brand.name) can treat the field uniformly as a Record without typecheck.
if (typeof brand.name === 'string') {
  brand.name = { [defaultLocale]: brand.name };
} else if (!brand.name || typeof brand.name !== 'object' || Array.isArray(brand.name)) {
  brand.name = { [defaultLocale]: '' };
}

// 🔴 #1121 —— 颜色 / 字体 / 风格设定【永远】来自这个站自己的 brand.json，构建期一个覆盖都没有。
//
// 这里原来有一段（#924 的）：applied:true 时把注册表那套 colors / fonts / settings 无条件赋给内存
// 里的 brand。撤掉它有两个各自成立的理由：
//   · 它会抹掉老板自己选的颜色。建站时勾了「照抄参照站配色」的站（create-site.js 里 refPrefs 含
//     colors-fonts 那一支，是活控件），brand.json 里躺的是从参照站扒来的颜色 —— 而那三行是无条件
//     赋值，所以他只要换一次装，自己选的配色就没了，而且没有任何地方会报出来。
//   · 同一套主题因此有两种长相（换过装之前 / 之后），也就是本票要根除的那件事。
//
// 换主题仍然改颜色，只是写入时机不同了：worker 的 processThemeTask 在写 site/theme.json 的同时把
// 新主题那套 colors / fonts / settings 写进 site/brand.json 并提交 —— 所以 brand.json 从此是唯一
// 真相，构建期不再有任何一处现盖。存量 applied:true 的站由 scripts/backfill-brand-from-theme.py
// 一次性回填（它们的 brand.json 躺的是建站那天那套，不回填就是一次静默回退）。
//
// 📌 下面那段注册表 schema 校验【留着】，它跟 applied 无关：校验的是整张注册表，本来就无条件跑。
// #1003 —— 主题的颜色 / 字体 / settings 是 tokens，按 schema 校验（schemas/theme-tokens.schema.json）。
// 🔴 校验的是**整张注册表**，不是只校验这个站用的那一套：一套写坏的主题躺在池子里，等下一个站
// 换到它才炸，而那时没人记得是谁改的。30 套跑一遍是毫秒级的事。
// 🔴 两种 settings 形状（#961 的枚举 / #1003 的数值）二选一、不许混写，也由那份 schema 判 ——
// 判据只有一处，别在这里再写一遍。
{
  const badThemes = themeTokens.validateRegistry(themes);
  const ids = Object.keys(badThemes);
  if (ids.length) {
    console.error(`主题 tokens 不符合 schemas/theme-tokens.schema.json（${ids.length} 套）：`);
    for (const id of ids) for (const problem of badThemes[id]) console.error(`  · ${id}: ${problem}`);
    process.exit(1);
  }
  console.log(`  Theme tokens: ${Object.keys(themes).length} 套全部通过 schema`);
}

const seoByLocale = {};
const servicesByLocale = {};
const navigationByLocale = {};
const pagesByLocale = {};
const blogPostsByLocale = {};

// TICKET-133: defensive fallback for the home page navLabel. AI translation
// and translatePageWithClaude both already translate page.navLabel, so the
// happy path is `homePage.navLabel` — this map is only used when navLabel is
// missing (old sites pre-122a / partial translation failure / etc).
const HOME_LABELS = {
  en: 'Home', zh: '首页', fr: 'Accueil', es: 'Inicio',
  ja: 'ホーム', ko: '홈', de: 'Startseite', it: 'Home',
  pt: 'Início', ru: 'Главная', vi: 'Trang chủ',
  ar: 'الرئيسية', hi: 'होम', th: 'หน้าแรก',
};

// #1026 —— `sourceBySlug` 记下每个页面是从哪个文件读出来的。sitemap 的 <lastmod> 要问那个文件
// 上次什么时候变的，而这里是唯一还知道文件路径的地方（下面的流程只剩页面对象）。
function readPagesRecursive(dir, prefix, accumulator, sourceBySlug) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      readPagesRecursive(path.join(dir, entry.name), prefix ? `${prefix}/${entry.name}` : entry.name, accumulator, sourceBySlug);
    } else if (entry.name.endsWith('.json')) {
      const filePath = path.join(dir, entry.name);
      const content = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
      if (prefix) {
        const baseName = entry.name.replace(/\.json$/, '');
        content.slug = `${prefix}/${baseName}`;
      }
      accumulator.push(content);
      if (sourceBySlug) sourceBySlug.set(content.slug, filePath);
    }
  }
}

// #1026 —— 这次构建的时刻。只在「既拿不到 git 提交时间、也读不到文件修改时间」时才会被用上，
// 而且那时会在日志里点名说出来。
const buildTime = new Date().toISOString();
const lastModified = createLastModifiedResolver({
  rootDir,
  pathspec: path.relative(rootDir, siteDir) || 'site',
  buildTime,
});

// #1033 —— 哪些块类型会读 services.json，从 registry.ts + 组件源码里量出来（不是手写清单，理由在
// page-deps.js 的文件头上）。一次构建只扫一遍。
const servicesReaders = blockTypesReadingServices(rootDir);
if (servicesReaders.unavailable) {
  // 🔴 「读不出来」不是「没有块读 services」：那时 services.json 算给所有页面（多报），并且必须
  //    说出来 —— 少报是静默的，它跟「一切正常」在日志里长得一模一样。
  console.log(`  ⚠️  没量出哪些块读 services.json（${servicesReaders.unavailable}）`
    + ' —— sitemap 的 <lastmod> 把 services.json 算给每一页（宁可多报）');
} else {
  console.log(`  sitemap <lastmod>：读 services.json 的块类型 ${servicesReaders.types.size} 种`
    + `（${[...servicesReaders.types].sort().join(', ') || '一种都没有'}）`);
  for (const f of servicesReaders.unmapped) {
    console.log(`  ⚠️  src/components/sections/${f} 用了 getServices，但它不在 registry.ts 的映射里`
      + ' —— 用它的页面不会因为 services.json 改了而报新日期');
  }
  // #1033 r2 —— 块不是唯一的读法：服务详情页那份 Service 结构化数据是页面外壳自己发的。所以每一处
  // getServices 都要有归属，归不了属的在这里点名，并且 services.json 算给每一页（多报，看得见）。
  for (const f of servicesReaders.unaccounted) {
    console.log(`  ⚠️  ${f} 用了 getServices，而它既不是注册表里的块组件、也不在 page-deps.js 的`
      + ' ACCOUNTED 归属表里 —— 算不出它到达哪些页面，sitemap 的 <lastmod> 把 services.json 算给每一页'
      + '（宁可多报）。要修就在那张表里给它一条归属');
  }
}
if (lastModified.shallow) {
  // #1033 —— 浅克隆里 git 只有一个提交，每个文件「上次被哪次提交碰过」都是那一次 ⟹ 全站页面的日期
  // 并成一个。worker/entrypoint.sh 现在克隆带完整历史，所以看到这行说明这个仓库是用别的方式拉下来的。
  console.log('  ⚠️  这是一个浅克隆（git 历史被砍掉了）：所有页面的 <lastmod> 会并成同一次提交的'
    + '时间，而不是各自上次真的变化的时间');
}

for (const locale of locales) {
  // TICKET-127: legacy schema reads from site/ root (flat); new schema from
  // site/<locale>/ subdir. localeDir abstraction lets the rest of the loop
  // work uniformly for both layouts.
  const localeDir = isLegacySchema ? siteDir : path.join(siteDir, locale);
  if (!isLegacySchema && !fs.existsSync(localeDir)) {
    console.error(`Locale directory missing: ${localeDir}`);
    process.exit(1);
  }

  // Required per-locale files: seo.json, services.json, navigation.json, pages/home.json
  // pages/home.json is required because [locale]/page.tsx unconditionally renders getHomePage(locale).sections
  for (const required of ['seo.json', 'services.json', 'navigation.json', 'pages/home.json']) {
    if (!fs.existsSync(path.join(localeDir, required))) {
      console.error(`Required file missing: ${path.join(localeDir, required)}`);
      process.exit(1);
    }
  }

  seoByLocale[locale] = JSON.parse(fs.readFileSync(path.join(localeDir, 'seo.json'), 'utf-8'));
  servicesByLocale[locale] = JSON.parse(fs.readFileSync(path.join(localeDir, 'services.json'), 'utf-8'));
  if (!Array.isArray(servicesByLocale[locale])) {
    console.error(`Locale "${locale}" services.json must be an array (current type: ${typeof servicesByLocale[locale]})`);
    process.exit(1);
  }

  // Aggregate pages (recursive)
  const pagesDir = path.join(localeDir, 'pages');
  const localePages = [];
  const pageSourceBySlug = new Map();
  if (fs.existsSync(pagesDir)) {
    readPagesRecursive(pagesDir, '', localePages, pageSourceBySlug);
    localePages.sort((a, b) => (a.navOrder ?? 99) - (b.navOrder ?? 99));
  }
  pagesByLocale[locale] = localePages;
  console.log(`  [${locale}] Found ${localePages.length} page(s)`);

  // Validate home page exists with slug='home' — [locale]/page.tsx calls
  // getHomePage(locale) which uses pages.find(p => p.slug === 'home').
  // File-existence (line 65 required check) is not sufficient: home.json may
  // exist with a wrong slug. The sections invariant for the home page is
  // covered by the all-pages loop below.
  const homePage = localePages.find((p) => p.slug === 'home');
  if (!homePage) {
    console.error(`Locale "${locale}" missing required home page: pages/home.json must contain { "slug": "home", "blocks": [...] }`);
    process.exit(1);
  }

  // #998 — 把这个 locale 的全部页面归一化成 blocks 形状（老站磁盘上是 sections，1:1 映过来），
  // 顺便把站级块库的 ref 解开、按 visibility 注入、按 weight 排序。全部校验都在 blocks.js 里：
  // 页面必须有 blocks 或 sections 之一且是数组、每个块要么带 type 要么带 ref、role 取值合法、
  // ref 指向的 id 存在、visibility 里的 slug 是真实存在的页面。
  //
  // 上面那段旧注释说的不变量没变，只是搬了家：`[locale]/page.tsx` 走 getHomePage(locale).blocks、
  // `[locale]/[...slug]/page.tsx` 走 page.blocks，SectionRenderer 要求每个块是带 "type" 的对象。
  //
  // 🔴 校验分两种待遇（PM 在 #998 r4 定的，整段理由写在 blocks.js 的 normalizeLocalePages 头上，
  // 与本文件下面那条「构建期只说不拦」同源）：一个字段的值不合法但有明确默认行为的 → 打印点名 +
  // 继续（下面那个 notes 循环）；形状本身矛盾、兜底只能靠猜的 → 抛错 → exit 1（下面那个 catch）。
  // #1033 —— 归一化之后还要用它：里面记着每一页各自用上了哪些站级块（那是 <lastmod> 要问的
  // 「这一页读了哪些文件」的一半）。所以声明搬到 try 外面，try 里的用法一个字没动。
  const blocksReport = {};
  try {
    normalizeLocalePages(localePages, readSiteBlocks(localeDir), locale, blocksReport);
    // 被忽略的字段：每一条都要打印。一个被忽略的字段和一份完全正常的配置，在日志里长得一模一样
    // —— 那正是本票要治的那一族毛病，所以这里没有「太吵就不打」这一档。
    for (const n of blocksReport.notes || []) console.log(`  ⚠️  ${n}`);
    // 一页都没用上的站级块：不是错误（草稿态合法），但要点名 —— 静默跳过跟「一切正常」在日志里
    // 长得一模一样。口径同下面 block_layout 那条「跳过要打印」。
    if (blocksReport.unusedSiteBlockIds && blocksReport.unusedSiteBlockIds.length) {
      console.log(`  [${locale}] 站级块没被任何页面用到（没人 ref、visibility 也没命中，构建不报错）：${blocksReport.unusedSiteBlockIds.join(', ')}`);
    }
  } catch (e) {
    console.error(e.message);
    process.exit(1);
  }

  // #1026 —— 给每一页配上「它上次什么时候变的」。sitemap.ts 的 <lastmod> 读的就是这个字段；
  // 在这之前它写的是构建时刻，于是站每重建一次就等于告诉搜索引擎「所有页面都更新了」。
  // 🔴 位置在归一化之后：那之前页面对象还没定型。取值规则（git 提交时间 → 文件时间 → 构建时刻）
  //    整段写在 scripts/lib/page-lastmod.js 的文件头上。
  //
  // 🔴 #1033 起问的是「这一页读到的**所有**文件里最晚的那个」，不再只问页面自己那份 JSON：
  //    改 services.json 或站级块库，用到它们的那几页 HTML 真的变了 —— 之前一页都不报。
  //    算哪几份文件、以及为什么页脚那条路不算，整段写在 scripts/lib/page-deps.js 的文件头上。
  // 🔴 #1046 条 1 —— 这张表的键必须覆盖 `resolveLatest` 会返回的**全部** source 值，而它有五个不是
  //    三个：#1025 条 12 的上界（未来的日期压回构建时刻）会把 `git` / `mtime` 变成 `git-capped` /
  //    `mtime-capped`（scripts/lib/page-lastmod.js 的 `capFuture`）。缺键时 `undefined + 1` 是 NaN，
  //    写进一个没人读的新键 ⟹ **被压回的那些页从下面那行统计里整个消失**，而三个数照样打出来、看不出
  //    少了人（实测：15 页的站、一页的 mtime 拨到 2030，那行打 0+14+0=14）。sitemap 的值本身一直是对的。
  //    归并回原档而不是给表补两个键：被压回的页仍然是「从 git / 文件时间来的」，只是取值被上界改写了 ——
  //    分成四档会让这行读数变成两个问题的答案。压回了几页单独说，因为那是「有页面的日期在未来」的
  //    唯一信号，而它不会自愈（要等有人再编辑一次那个文件）。
  const lastModifiedTally = { git: 0, mtime: 0, build: 0 };
  let lastModifiedCapped = 0;
  const sharedTally = { services: 0, siteBlocks: 0 };
  const pageDeps = createPageDeps({ localeDir, services: servicesReaders });
  for (const page of localePages) {
    const source = pageSourceBySlug.get(page.slug);
    const dep = pageDeps.filesFor(page, source, (blocksReport.siteBlockIdsByPage || {})[page.slug]);
    const got = lastModified.resolveLatest(dep.files);
    page.lastModified = got.value;
    const capped = got.source.endsWith('-capped');
    if (capped) lastModifiedCapped += 1;
    lastModifiedTally[capped ? got.source.slice(0, -'-capped'.length) : got.source] += 1;
    if (dep.usesServices) sharedTally.services += 1;
    if (dep.usesSiteBlocks) sharedTally.siteBlocks += 1;
    // 退回构建时刻的必须点名 —— 静默退回构建时刻正是本票要治的那个毛病本身。
    if (got.source === 'build') {
      console.log(`  [${locale}] ⚠️  ${page.slug}（${got.from || source || '找不到源文件'}）：既拿不到`
        + ' git 提交时间也读不到文件修改时间，sitemap 的 <lastmod> 退回构建时刻');
    }
  }
  console.log(`  [${locale}] sitemap <lastmod> 还算进了共享内容：services.json ${sharedTally.services} 页 · `
    + `blocks/site-blocks.json ${sharedTally.siteBlocks} 页（共 ${localePages.length} 页）`);
  console.log(`  [${locale}] sitemap <lastmod> 取自：git 提交时间 ${lastModifiedTally.git} 页 · `
    + `文件修改时间 ${lastModifiedTally.mtime} 页 · 构建时刻 ${lastModifiedTally.build} 页`
    + (lastModifiedCapped
      ? ` · 其中 ${lastModifiedCapped} 页原本的时间在未来，已压回构建时刻`
      : ''));

  // #999 —— 「渲染器认得的块」与「有 manifest 的块」必须是同一个集合。加了块忘了补 manifest 的话，
  // 那个块从此在提示词里不出现、校验也不认它，而没有任何东西会红。
  {
    const cov = blockManifest.registryCoverage(path.join(rootDir, 'src', 'lib', 'sections', 'registry.ts'));
    // 🔴 #1013：「读不出来」不走 exit 1 那一支。这里的退出码 1 会让这个站从此重建不出来，而
    //    「拿不到解析器」根本不是关于注册表的读数 —— 但它也不能安静地过去，否则日志里那行
    //    「对得上」会变成一句没人查过的话。
    if (cov.unavailable) {
      console.log(`  ⚠️  blocks/ 与 registry.ts 没有对照：${cov.unavailable}`);
    } else if (cov.missingManifest.length || cov.unknownBlock.length) {
      console.error('blocks/ 与 src/lib/sections/registry.ts 对不上：');
      if (cov.missingManifest.length) console.error(`  registry 有、blocks/ 没有: ${cov.missingManifest.join(' ')}`);
      if (cov.unknownBlock.length) console.error(`  blocks/ 有、registry 没有: ${cov.unknownBlock.join(' ')}`);
      process.exit(1);
    }
  }

  // #999 —— 块 manifest 校验的构建期兜底。建站脚本拿到 AI 输出时已经跑过同一个函数（那时还能重试），
  // 这一处把**手改**过的 site/pages/*.json 里的毛病说出来：改坏一个必填槽、把 essential 降成
  // optional、写一个 manifest 里没有的 block_layout，今天没有任何东西会发现，页面就那么少一块地
  // 渲染出来。
  //
  // 🔴 构建期只说、不拦（`scope: 'build'` 让 validateSite 一条 problem 都不产出，理由整段写在
  //    block-manifest.js 的 validateSite 头上）。一句话版：构建期没有救，只有毁 —— 这里退出码 1
  //    的唯一后果是这个站从此重建不出来、预览也开不出来（`worker/entrypoint.sh` 里 `"$MODE" = "preview"` 那个
  //    分支带 `set -e`，就是检查 `site/brand.json` 在不在的那一段）。实测 GitHub 上真实存在的 28 个站，硬拦会当场废掉 prod 的两个。
  //    ⟹ 所以这里不接 problems：它恒为空，接了就是死代码。
  //
  // 📌 `industry` 在构建期是不知道的（seo.json 里没有这个字段），所以「行业必需的块缺了」这条
  //    在这里只可能按 `"*"` 那一档说话。
  const { warnings: blockWarnings } =
    blockManifest.validateSite({ pages: localePages, industry: '', scope: 'build' });
  for (const w of blockWarnings) console.log(`  [${locale}] ⚠️  ${w}`);

  // Aggregate blog posts (optional)
  const blogDir = path.join(localeDir, 'blog');
  const localeBlogPosts = [];
  if (fs.existsSync(blogDir)) {
    const blogFiles = fs.readdirSync(blogDir).filter(f => f.endsWith('.json'));
    for (const file of blogFiles) {
      localeBlogPosts.push(JSON.parse(fs.readFileSync(path.join(blogDir, file), 'utf-8')));
    }
    localeBlogPosts.sort((a, b) => new Date(b.publishedAt).getTime() - new Date(a.publishedAt).getTime());
  }
  blogPostsByLocale[locale] = localeBlogPosts;
  console.log(`  [${locale}] Found ${localeBlogPosts.length} blog post(s)`);

  // Auto-generate navigation per locale (preserves CTA from existing navigation.json)
  const navPath = path.join(localeDir, 'navigation.json');
  const existingNav = JSON.parse(fs.readFileSync(navPath, 'utf-8'));

  const nonHomePages = localePages.filter(p => p.slug !== 'home');
  // #1033 r2 —— 这个判断搬去了 lib/page-deps.js（那边算 <lastmod> 也要问同一件事），逐字未改。
  const isKeywordPage = p => (p.keywordPage === true || p.slug.includes('/')) && !isServiceDetailPage(p);
  const regularPages = nonHomePages.filter(p => !isKeywordPage(p) && !isServiceDetailPage(p));
  const keywordPages = nonHomePages.filter(p => isKeywordPage(p));

  // TICKET-133: bypass-translation bug — these arrays previously hardcoded
  // 'Home' here, overwriting AI-translated navigation.json on every prebuild.
  // Use the home page's own navLabel (already translated by AI / 122b
  // translatePageWithClaude); fall back to a native-language map if missing.
  const homeLabel = homePage.navLabel || HOME_LABELS[locale] || 'Home';
  const ctaSlug = existingNav.header.cta.href.replace(/^\//, '');
  const headerLinks = [
    { label: homeLabel, href: '/' },
    ...regularPages
      .filter(p => p.navLabel && p.slug !== ctaSlug)
      .map(p => ({ label: p.navLabel, href: `/${p.slug}` }))
  ];

  const footerLinks = [
    { label: homeLabel, href: '/' },
    ...regularPages
      .filter(p => p.navLabel)
      .map(p => ({ label: p.navLabel, href: `/${p.slug}` }))
  ];

  existingNav.header.links = headerLinks;
  if (existingNav.footer.columns.length > 0) {
    existingNav.footer.columns[0].links = footerLinks;
  }

  // Group keyword pages by service — one footer column per service.
  // TICKET-135: column 0 is always the "Quick Links" column (potentially
  // translated as "快速链接" / "Liens rapides" / etc), and any column at
  // index ≥1 was added by this loop on a prior run as a keyword grouping.
  // Detect by index rather than the literal English title so this still works
  // after translateSupportingFiles localizes column 0's title.
  const hasKeywordColumns = existingNav.footer.columns.length > 1;
  if (keywordPages.length > 0 && !hasKeywordColumns) {
    const groups = {};
    for (const p of keywordPages) {
      const serviceSlug = p.slug.split('/')[0];
      if (!groups[serviceSlug]) groups[serviceSlug] = [];
      groups[serviceSlug].push(p);
    }
    for (const [serviceSlug, pages] of Object.entries(groups)) {
      existingNav.footer.columns.push({
        title: serviceSlug.replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase()),
        links: pages.slice(0, 6).map(p => ({ label: p.title, href: `/${p.slug}` })),
      });
    }
  }

  fs.writeFileSync(navPath, JSON.stringify(existingNav, null, 2));
  navigationByLocale[locale] = existingNav;
  console.log(`  [${locale}] Regenerated navigation.json`);
}

// #998 — 每个块的 `block_layout` 必须落在它自己 manifest 声明的清单里（manifest 是 #999 的交付物，
// `blocks/<type>.json`）。还没有 manifest 的块类型**跳过并点名** —— 静默跳过跟「校验通过」在日志里
// 长得一模一样，而它们是两件完全不同的事。没有任何块写 `block_layout` 时这里一个字都不打印。
//
// 🔴 值不在清单里也是**点名 + 摘掉这个属性**，不是 exit 1（PM r4 的口径，同上面那一段）。这个 catch
// 留着不是装饰：`loadBlockManifests` 读到一份不是合法 JSON 的 manifest 仍然会抛 —— 那是模板自己的
// 文件坏了，不是某个站的数据写错了。
try {
  const { skipped, notes } = validateBlockLayouts(pagesByLocale, loadBlockManifests(rootDir));
  for (const n of notes) console.log(`  ⚠️  ${n}`);
  if (skipped.length) {
    console.log(`  block_layout 校验跳过（${MANIFEST_DIR}/ 里还没有这些块的 manifest）：${skipped.join(', ')}`);
  }
} catch (e) {
  console.error(e.message);
  process.exit(1);
}

// #924 / 🔴 #1121: 主题声明的 variant【永远】说了算，不看 `applied` —— 跟 #1086 对顶栏 / 页脚
// 那一维的做法同一个理由：同一套主题不该有两种长相（新建的站拿页面自己的 variant、换过装的站拿
// 主题的，一个布尔分出两种画法，而签字的图册只画了其中一种）。
//
// 🔴 问的是 `structureThemeId`（「这个站穿的是哪套主题」），不是 `appliedThemeId`（「老板换过装
// 吗」）。用它而不是自己再读一次 theme.json，是因为它对**注册表里查不到的 id 返回 null 而不打死
// 构建** —— 候选流水线装候选时写的正是一个还没进注册表的 id（theme-pipeline/run.js 的
// installCandidate），那条路必须活着。这个不对称是承重的，理由整段在 `readStructureThemeId` 上面。
//
// For every section type the theme has an opinion about, its variant wins over the one the page
// JSON carries; section types it says nothing about are left alone. Runs after the locale loop on
// purpose — navigation.json is the one file written back to disk up there, and it must not pick any
// of this up.
if (structureThemeId) {
  const layout = layoutFor(structureThemeId);
  let overridden = 0;
  for (const locale of locales) {
    for (const page of pagesByLocale[locale]) {
      for (const block of page.blocks) {
        // #1132 —— 这张偏好表的键是**老** type 名（主题注册表按老名字写的）。别名把 `block.type`
        // 换成通用块的名字之后，按它取恒是 undefined ⟹ 走 `continue`，静默地什么都不覆盖。
        // 读 `__legacyType` 是把老站这条路上的行为原样保住（新站那条路上主题今天还没有卡片组的偏好，
        // 那是主题注册表的事，不在本票范围）。
        const preferred = layout[block.__legacyType || block.type];
        if (!preferred) continue;
        block.data = { ...(block.data || {}), variant: preferred };
        overridden++;
      }
    }
  }
  // 🔴 #1121 —— 这行以前写的是「colors + fonts + N section variant(s)」，而颜色和字体已经不
  // 从这里来了。日志说的话必须跟代码做的事一样，否则下一个读构建日志的人会以为覆盖还在。
  console.log(`  Theme "${structureThemeId}": ${overridden} section variant(s)`
    + ' —— 颜色 / 字体 / 风格设定来自这个站自己的 brand.json，不从注册表来');
}

// 🔴 #993 — A THEME MAY NOT DECIDE BLOCK PLACEMENT, and this is where that is enforced.
//
// #962/#983 let a theme carry `rhythm: { hide, order }`, and this file applied it: it flagged blocks
// as hidden and re-ordered them at build time, so changing theme changed which blocks a page showed
// and in what order. Spec D8 (Chris 2026-08-13) removed that. Placement now comes only from the
// site's own page JSON — the order of the `sections` array and each section's own `hidden` — and a
// theme changes colors, fonts, block variants and Region structure, nothing else.
//
// The check below runs on the WHOLE registry on every build (this file is predev/prebuild) and is
// deliberately NOT conditional on which theme this site wears, exactly as the #983 check it
// replaces was (it read `appliedThemeId`, a variable #1121 retired): a
// `rhythm` left on any one of the 30 themes is a rule that came back, and which site happens to be
// building has nothing to do with it. It is also why the 30 keys were deleted rather than left in
// place unread — an unread field is how this returns.
const withRhythm = themesWithRhythm();
if (withRhythm.length) {
  console.error(`🔴 ${withRhythm.length} theme(s) in scripts/themes.js still carry a \`rhythm\` key. A theme ` +
    'does not decide which blocks a page shows or in what order — that is the site\'s own page JSON ' +
    '(#993, spec D8). Delete the key from:\n  ' + withRhythm.join('\n  '));
  process.exit(1);
}

// #960 — Header 和 Footer 是两个 Region,不是 section,所以它们【走不了】上面那个循环:那个循环按
// `layout[section.type]` 取,而没有任何 section 的 type 是 header/footer ⟹ 往偏好表里加这两个键会被
// `if (!preferred) continue` 静默跳过。这里是它们自己的写出口,理由与那条对比度规则写在 region-layout.js。
// 📌 #1024:以前还往这里传「全部 locale 的全部页面」和这个站的调色板,用来判首屏是不是深底。
// 那条判断已经没有依据了(hero 的底色住在主题样式表里,不在 variant 的名字里),现在透明浮层
// 一律配遮罩,所以这个函数只要 theme 的那份结论。
//
// 🔴 #1086 —— 这一行以前问的是「这个站换过装了吗」(`appliedThemeId ? layoutFor(…) : readPreview…()`),
// 现在问的是「这个站穿的是哪套主题」。`applied` 在结构这条路上一处都不再出现,而它以前在这里出现两次
// (这个三元表达式,以及 `readPreviewRegionLayout` 开头那句 `if (appliedThemeId) return {}`)。
// 优先级从低到高:
//   ① 注册表里那套主题声明的 `supports.header` / `supports.footer` —— `structureThemeId`,不看 applied。
//      这是本票的交付:新建的站(`applied:false`)从此拿到它那套主题的骨,不再落回 solid-bar + multi-column。
//   ② theme.json 自己写的 `regionLayout`,**逐键**压过 ①。写了 header 就用它写的 header,没写 footer
//      就还是注册表那套的 footer(#1079 候选图册那条路要的正是这个:候选的 id 还不在注册表里,① 是空的)。
// 📌 `applied: true` 的站产物不变,理由不是"我没动那条路",是这两条各自的取值:① 它的 themeId 必然在
//    注册表里(否则 `readAppliedThemeId` 已经 exit 1 了)⟹ 与以前的 `layoutFor(appliedThemeId)` 逐字
//    相同;② `applied:true` + `regionLayout` 这个组合没有任何代码路径造得出来(理由在
//    `readPreviewRegionLayout` 上面那段)⟹ 空的。
// 🔴 #1086 —— 日志里要说得出**结构是从哪来的**,不只说结果是什么。以前这一行只有结果,而
// 「顶栏为什么是 solid-bar」有三个完全不同的答案(注册表就这么声明的 · theme.json 显式写的 ·
// 谁都没说话所以是默认值),它们在日志里长得一模一样 —— 这张票要治的那个 bug 当初就是这么藏了
// 一个多月的:图册印 centered-logo、真站是 solid-bar,而两边的构建日志都只写 `header=solid-bar`。
const regionSource = [
  structureThemeId ? `registry theme "${structureThemeId}"` : null,
  Object.keys(explicitRegionLayout).length
    ? `theme.json regionLayout (${Object.keys(explicitRegionLayout).join(', ')} — wins per key)` : null,
].filter(Boolean).join(' + ') || 'defaults (no theme.json, or its themeId is not in the registry)';
console.log(`  Regions: header=${regionLayout.header} footer=${regionLayout.footer}` +
  (regionLayout.headerScrim ? ' (+scrim)' : '') + ` — from ${regionSource}`);

// #1000 —— 这个站的页面由哪些区组成。库在 page-layouts/，站在 site/page-layout.json 里挑一个
// （缺文件 ⟹ standard，也就是今天所有站的那一条路）。
//
// 🔴 这里的校验是 D11 的替身。以前「页面写不出没有 Header 的站」是 SiteShell 写死保证的；按库拼区
// 之后那条保证降级成「库里定义的」，所以 schema 强制每个布局都得有 header / content / footer，
// 缺一个就在这里拒绝并点名。**库里每一份都校验**，不只校验被选中的那份：一份坏的布局躺在库里，
// 下一个选它的站才炸，那时没人记得是谁放进去的。
const allLayouts = pageLayoutLib.loadLayouts();
const layoutProblems = [];
for (const l of allLayouts.values()) layoutProblems.push(...pageLayoutLib.validateLayout(l));
const picked = pageLayoutLib.resolveSiteLayout(siteDir);
layoutProblems.push(...picked.problems);
if (layoutProblems.length) {
  console.error('page layout 库不合法（page-layouts/ 与 site/page-layout.json）：');
  for (const problem of [...new Set(layoutProblems)]) console.error(`  · ${problem}`);
  // #1108 —— 上面那些 problem 点名了 site/page-layout.json,但没说「那我怎么改它」。
  console.error(`  · ${remediation.howToChangePageLayout({ rootDir, siteDir }).sentence}`);
  process.exit(1);
}
const pageLayout = { id: picked.layout.id, regions: picked.layout.regions,
  ...(picked.layout.repeatVariants ? { repeatVariants: picked.layout.repeatVariants } : {}) };
console.log(`  Page layout: ${pageLayout.id} → ${pageLayout.regions.join(' · ')}`
  + (picked.explicit ? '' : '（站没挑，按默认）'));

// 🔴 #1000 r2（QA1 抓的那条，作者裁定在本票修）—— 有 topbar 区 + 顶栏是透明浮层 = 那条横带
// 渲染出来但一个像素看不见，而且没有任何东西会报错。
//
// 量到的形状（QA1 与我各在浏览器里读过一次，读数一致）：浮层是 `absolute inset-x-0 top-0`、
// `z-index:50`、高 92px（`Header.tsx:125`），topbar 占 0–44px ⟹ **重叠 44px = topbar 整条**，
// `elementFromPoint(topbar 中点)` 拿到的是 header 里的 nav。而 `bold-red` 这类主题就会解析成
// `transparent-overlay`（`themes.js` 的 supports.header）。
//
// 🔴 为什么在这里拒绝，而不是「渲染时躲一下」：躲要么给 header 加 top 偏移（那会打断浮层压在
// 首屏 hero 上这件事本身，#960 那条对比度规则就是围着它写的），要么把 topbar 塞进 header 里面
// （那它就不是一个区了）。两条都是把一个**组合不成立**的事实改写成一个看起来能跑的样子。
// 拒绝是诚实的那条：站要么换一个不带 topbar 的布局，要么换一套顶栏不是浮层的主题。
//
// 🔴 用 `needsTopbar` 而不是自己再数一遍 regions：上面那道「有 topbar 区就必须有 topbar 内容」
// 用的就是它，两道判的必须是同一件事，否则总有一天一个说有、一个说没有。
if (pageLayoutLib.needsTopbar(picked.layout) && regionLayout.header === 'transparent-overlay') {
  console.error(`page layout "${pageLayout.id}" 有 topbar 区，而这个站的顶栏解析成 `
    + '"transparent-overlay"（透明浮层）—— 浮层是 absolute top-0、高 92px、z-index 50，会把 '
    + 'topbar 那 44px 整条压在底下：横条会渲染出来，但用户一个像素都看不见。');
  // 🔴 #1108 —— 这条以前给的两条路里,「换一个不带 topbar 区的 page layout」**走不通**
  //    (产品里 0 个写入者)。本票点名的是下面那条 topbar 缺内容的报错,而这一条是同一个病的
  //    另一格 —— 扫查时抓到的。换主题那一半是真的(dashboard 里有换装弹窗)。
  console.error(`  · ${remediation.howToChangePageLayout({ rootDir, siteDir }).sentence}`);
  // 🔴 #1108 —— 这一句以前把判据写成 `themes.js 的 supports.header !== 'transparent-overlay'`。
  //    `supports` 装的是**清单**（数组），拿它 `!==` 一个字符串恒为真 ⟹ 那个判据一个主题都排除不掉：
  //    照它挑出 110 个候选，其中 20 个解析出来仍然是透明浮层。现在这份名单**算出来** ——
  //    问的是构建自己用的 `layoutFor` + `resolveRegionLayout`（也就是上面那个 if 的判据本身）。
  console.error(`  · 或者${remediation.themesWithoutOverlayHeader().sentence}`);
  process.exit(1);
}

// 选了带 topbar 的布局，就必须有 topbar 的内容 —— 否则那个区渲染出来是空的，而"少了一条横带"
// 没有任何东西会红。逐 locale 查：内容是按语言存的。
if (pageLayoutLib.needsTopbar(picked.layout)) {
  const missing = locales.filter((loc) => {
    const t = (navigationByLocale[loc] || {}).topbar;
    return !t || !String(t.message || '').trim();
  });
  if (missing.length) {
    console.error(`page layout "${pageLayout.id}" 有 topbar 区，但这些语言的 navigation.json 里没有 `
      + `topbar 内容：${missing.join(', ')}`);
    // 🔴 #1108 —— 以前这两句给的路一条都走不通:`navigation.json` 被 #1087 的白名单整份拒掉,
    //    `site/page-layout.json` 产品里 0 个写入者。现在两句都**算出来**(见 lib/remediation.js):
    //    第一句问白名单「这个站的 topbar 写得进去吗」,所以 #1104 一落地它自己就从「还加不了」
    //    变成「让 AI 编辑器加」,不需要谁回来改这行字。
    // 🔴 `flat` 必须传：扁平站的 locales 也是 ['en']，但文件在 site/navigation.json ——
    //    不传就会指着一个不存在的 site/en/navigation.json（见 remediation.js 里 navRelPath 那段）。
    // 🔴 条数有上限：这段 stderr 会被 edit-site.js 截到 2000 字符再给老板看（理由整段在那个函数上）。
    for (const line of remediation.topbarBullets({ siteDir, locales: missing, flat: isLegacySchema })) {
      console.error(`  · ${line}`);
    }
    console.error(`  · 或者不要 topbar —— ${remediation.howToChangePageLayout({ rootDir, siteDir }).sentence}`);
    process.exit(1);
  }
}
for (const note of regionLayout.notes) console.log(`    · ${note}`);
// #991 — say it out loud either way. "No sheet" and "a sheet that did nothing" look identical on the
// page, and the theme-gallery loop greps this kind of line to tell a real application from a no-op.
// 🔴 #1008 rewrote the second line. It used to read "every block keeps its own variant markup", which
// stopped being true the moment hero's nine variant branches were deleted: hero renders the neutral
// markup with or without a sheet now, and with no sheet it has only base.css to lay it out. The blocks
// that have NOT moved yet are the ones still keyed off `variant`, so name that instead of "every".
// 🔴 #1018 — the count in the second line is the thing that goes stale, so it is spelled out from the
// list of blocks that have moved rather than typed as a number: three moved (hero #1008, cta-banner
// #1018, page-header #1019), 31 to go — 🔴 that pair of numbers is #1019's state, not today's; it is
// kept as the worked example of what the line USED to print. Today's numbers come from MOVED_BLOCKS
// below and are printed on every build; do not type them anywhere. The next migration ticket edits
// MOVED_BLOCKS and both the sentence and the count stay true — #1019 only had to correct this
// comment's own prose. (#1025 条 16: the same count hand-written into theme-css-contract.md went
// 31 → 25 → 21 → 17 in one week, which is what this design avoids.)
//
// 📌 #1018 r3 (rebased onto #1002's ship) keeps both halves of the collision here: the variable is
//    #1002's `themeSheet` and the wording is its "pasted into theme.css" (the sheet's bytes go INTO
//    the fixed-path theme.css now — there is no `<link>` per theme any more), while the block list
//    and the count come from MOVED_BLOCKS.
// 🔴 The text up to `.css` is READ BY A MACHINE — theme-css-invariants-all-sheets.sh:193 greps
//    `Theme CSS: public/themes/<sheet>.css` to tell "this build wore the sheet under test" from "it
//    did not", and scripts/theme-pipeline/gallery.js documents the same prefix. Reword what follows
//    the em dash freely; do not touch what precedes it.
const MOVED_BLOCKS = ['hero', 'cta-banner', 'page-header',
  // #1027 batch B — six at once. `values-grid` belongs on this list even though its five looks were
  // keyed off `data.style` rather than `data.variant`: what this list means is "this block's markup
  // no longer decides how it looks", and that is now true of all six.
  'contact-form', 'quote-form', 'services-list', 'values-grid', 'services-nav',
  'service-related-pages',
  // #1028 batch C — four more. Same meaning as above: these blocks' markup no longer decides how
  // they look.
  'contact-info', 'stats-counter', 'process-steps', 'timeline',
  // #1029 batch D — four more. Same meaning as above: these blocks' markup no longer decides how
  // they look. `blog-preview` keeps reading `data.fromBlog` / `data.maxPosts`, and that is not a
  // contradiction: those two say WHICH articles the block draws, not what it looks like.
  'benefits-list', 'team-grid', 'checklist', 'blog-preview',
  // #1031 batch F — seven at once. All seven had a `data.variant` branch and nothing else: none of
  // them is a `'use client'` component, so there was no behaviour to keep on the way out.
  'content-split', 'text-block', 'divider', 'social-proof', 'features-grid',
  'awards-certifications', 'newsletter-signup',
  // #1036 batch G — the six blocks that had behaviour in at least one variant. `announcement-bar`
  // belongs on this list even though it still reads `data.variant`: that read is the REGION path
  // (`TopbarRegion.tsx` passes `regionLayout.topbar` through the same prop and it lands on
  // `data-region-layout`), and regions are `scripts/region-layout.js`'s business, not phase 2's.
  // As a BLOCK its markup no longer decides how it looks, which is what this list means.
  'faq-accordion', 'testimonials', 'announcement-bar', 'service-highlights', 'pricing-table',
  'gallery',
  // #1030 batch E — four more. Same meaning as above. `feature-comparison` still renders a ✓ or a ✗
  // per cell, and that is not a contradiction: those two characters say WHAT the site claims about
  // itself and a competitor, not what the block looks like — how they LOOK (colour, size, whether
  // there is a shape behind them) is the sheet's, through `.feature-comparison__mark--yes` / `--no`.
  'feature-comparison', 'logo-carousel', 'map-area', 'trusted-brands',
  // #1132 —— 通用块「卡片组」。老名字 `values-grid` / `benefits-list` 一个都没删（老站还在吐
  // 老类名，见 blocks.js 的 applyAlias），通用块另外加自己的名字。这张名单的含义没变：
  // 「这个块的 markup 不再决定它长什么样」。
  'card-group'];
// 🔴 #1132 —— 分母是**算出来的**，不是写死的 34。写死的那个数在 #1132 当天就成了假话：卡片组进了
// MOVED_BLOCKS（35 项），`34 - 35` 会印出 `-1`。名单的权威是角色表 —— 它的键集合按
// `tests/e2e/specs/978-theme-preview-layout.spec.ts` 恒等于注册表的键集合，也就是「一共有几种块」。
const ALL_BLOCK_TYPES = Object.keys(BLOCK_ROLES);
const movedList = MOVED_BLOCKS.join(' + ');
console.log(themeSheet
  ? `  Theme CSS: public/themes/${themeSheet}.css — pasted into theme.css, ${movedList} styled by those rules (base.css underneath)`
  : `  Theme CSS: none — ${movedList} fall back to base.css alone; `
    + `the ${ALL_BLOCK_TYPES.length - MOVED_BLOCKS.length} unmoved blocks keep their variants`);

// ─── #1002 §theme.css —— 皮和微调，两个固定路径 ───────────────────────────────────────────────
//
// 页面引的是 `/theme.css` 和 `/custom.css`，文件名不随主题变。换主题 = 换掉 theme.css 的内容，
// 所以产物 HTML 一个字节都不用重写，也就不用重建。custom.css 换主题时不动，「换了主题微调还在」
// 因此是结构上自动成立的，不需要任何「把微调套回去」的逻辑。
//
// 🔴 两种来源，缺一种就有一批站掉色（#1121 之前是三种，第 ② 种随注册表覆盖一起撤掉了）：
//
//   ① repo 里有 site/theme.css   →  逐字节拷过去，不重新生成也不覆盖
//      这是换主题那一刻烤进 repo 的字节（worker 的 processThemeTask）。为什么存字节而不是只记
//      themeId：重建时站读的是**它自己 repo 里那份 scripts/themes.js**（建站那天的快照 ——
//      prod/test 的 local.templatePath 是空串，重建不拉新模板），而老板 Apply 时看到的是平台侧
//      当前的主题池。只记 themeId 的话，这两份字节可以不一样，而且没有任何人会发现。
//
//   ② 没有 site/theme.css  →  从 brand.json 生成
//      🔴 #1121：这里原来分两支 —— applied:true 的站「按注册表生成」、其余「从 brand.json 生成」。
//      而那两支本来就走同一段代码（上面 §theme 先把注册表那套写进了内存里的 brand），撤掉那处
//      覆盖之后，brand.json 就是唯一的来源，两支说的是同一件事。
//      内容逐字就是这张票之前 layout.tsx 里那段 inline <style>（`buildCssVariables()`）的产出，
//      所以搬家不改变任何一个 computed style。🔴 这一支不能省：tailwind.config.ts 把
//      primary-50…900 映射成 var(--color-primary-*) 且**没写兜底值**，globals.css 的 :root 里
//      一个颜色变量都没有 —— 不给这些站生成 theme.css，它们不是落回默认配色，是整站掉色。
const publicDir = path.join(rootDir, 'public');
const siteThemeCssPath = path.join(siteDir, 'theme.css');
let themeCssBytes;
let themeCssOrigin;
if (fs.existsSync(siteThemeCssPath)) {
  themeCssBytes = fs.readFileSync(siteThemeCssPath); // Buffer —— 逐字节，不经过任何字符串处理
  themeCssOrigin = 'site/theme.css (committed by a theme change)';
} else {
  themeCssBytes = Buffer.from(buildThemeCss({
    colors: brand.colors,
    fonts: brand.fonts,
    settings: brand.settings,
    blockLayoutCss: themeSheet
      ? fs.readFileSync(path.join(publicDir, 'themes', `${themeSheet}.css`), 'utf-8')
      : '',
  }), 'utf-8');
  // 🔴 #1121 —— 只剩一种说法。以前这里按 applied 分两支印不同的话，而两支生成的字节来自同
  // 一段代码；撤掉注册表覆盖之后，「从注册表生成」这句话在任何一个站上都不再是真的。
  themeCssOrigin = 'generated from brand.json';
}
fs.writeFileSync(path.join(publicDir, 'theme.css'), themeCssBytes);
console.log(`  Generated public/theme.css — ${themeCssOrigin} (${themeCssBytes.length} bytes)`);

const configDataPath = path.join(rootDir, 'src', 'lib', 'config-data.ts');
// ── #1006 每站微扰（tweaks）──────────────────────────────────────────────────────────────────────
//
// `site/theme.json` 的 `tweaks` 是唯一真相（值），`site/custom.css` 是**生成物**：拿当前这套皮的
// 基准值 + 那组偏移算出来的具体字节。走的是【G】—— 换主题时 tweaks 的值不动，custom.css 拿新基准
// 重算一遍，所以「换了主题微调还在」（spec §5.6）。
//
// 🔴 这里只【生成】，不负责把它送进页面。把 `site/custom.css` 拷成 `public/custom.css` 并在
// layout.tsx 里发 `<link rel="stylesheet" href="/custom.css">` 是 **#1002** 的交付面（那张票的
// sync-config 里那段注释直接点了本票的名）。两张票合并时，本段必须排在它那段拷贝**之前**，
// 否则拷走的是上一次的字节。
//
// 🔴 基准值从哪来 —— 必须跟【页面上真正生效的那一组】同源，否则微扰是相对一个不存在的基准算的。
// 颜色：`brand.colors` —— 🔴 #1121 之后它就是页面上生效的那一组，构建期不再有任何覆盖
// （这句以前写的是「换过装的站，上面某一行已经把它换成了那套主题的调色板」）。
// 圆角 / 留白 / 按钮形状：写了风格设定的站由那张档位表说了算，没写的站落在 `globals.css` 的
// `:root` 默认值上。**两者不是同一组数**：**退役的那 30 套**里只有 3 套的设定恰好等于默认值，
// 其余 27 套不是（本轮现读：`sharp/standard/square` 3 套、`round/airy/pill` 5 套、
// `sharp/compact/square` 5 套…）。🔴 语料写在这里（#1140，来源 #1083）：那 30 套 == 今天 `themes.js`
// 的 `retiredThemes`，而今天注册表是 **110 套**（退役 30 + 池子 80）。上面那几个数**只对那 30 套成立**
// —— 池子那 80 套的 settings 是**数值形状**（`radius: 16`），根本不走档位表。只读 globals.css
// 的话，一个 `radius: 'round'`（0.5rem）的站会被按 0.25rem 去乘 —— 圆角不是变大，是**变小一半**。
/** 再读一次 theme.json，只取一个键（上面那两个读它的函数各自也只取自己那一个）。 */
function readThemeKey(key) {
  const themePath = path.join(siteDir, 'theme.json');
  if (!fs.existsSync(themePath)) return undefined;
  try {
    return JSON.parse(fs.readFileSync(themePath, 'utf-8'))[key];
  } catch {
    return undefined;   // 不是合法 JSON 的情况上面 readAppliedThemeId 已经报过并退出了
  }
}

/**
 * 风格设定那张档位表（`radius: 'round'` → `--radius-lg: 1rem` 那一步）。
 *
 * 🔴 表只有一份，住在 `scripts/theme-settings.js` —— 那是 **#1002** 从 `src/lib/themeSettings.ts`
 * 搬出来的（普通 node 脚本 require 不了 `.ts`，而本层就是那样一个普通脚本）。**本票不再搬一次**：
 * 同一张表两份拷贝正是 #961 / #1002 一路在堵的东西。
 *
 * #1002 落地之前它不存在，这时返回 null，下面退回 `globals.css` 的默认值。**那一格不会算错任何
 * 已上线的站**：把 `custom.css` 引进页面的那个 `<link>` 也是 #1002 的东西 ⟹ 在它落地之前，
 * custom.css 没有任何消费者。判据：`git grep -c 'custom\.css' origin/main -- templates` 今天是 0。
 */
function settingsTable() {
  try {
    // eslint-disable-next-line global-require
    return require('./theme-settings');
  } catch {
    return null;
  }
}

/**
 * `globals.css` 的 `:root` 默认值 → [[名, 值], …]。没写风格设定的站，页面上生效的就是这一组。
 *
 * 🔴 #1118 —— 解析搬到了 `tweaks.js` 的 `rootShapeDefaults()`，这里只剩「读哪个文件」。
 * 搬的理由：dashboard 的 Customize 预览要拿到同一组默认值（没换过装的站，它现在也要现算基准），
 * 而浏览器里没有磁盘 —— vite 插件在 Node 里读同一个文件、调同一个函数。同一段正则写两遍，
 * 第一次分叉的时候预览就跟构建对不上。
 */
function globalsRootDefaults() {
  return tweakLib.rootShapeDefaults(
    fs.readFileSync(path.join(rootDir, 'src', 'app', 'globals.css'), 'utf-8'),
  );
}

/**
 * 微扰要乘的那一组基准值 → [[变量名, 值], …]，外加一句「圆角/留白是从哪儿取的」给日志用。
 *
 * 🔴 这里【只取本层认识的三族】（`--color-*` / `--radius-*` / `--section-*`），阴影和字体不在
 * 微扰会碰的范围里：阴影改了会动对比度观感、字体没有可乘的量（fontScale 不在本票）。
 */
function baseVarsForTweaks() {
  const table = settingsTable();
  // 🔴 算这一组的代码不住在这里，住在 `tweaks.js`，因为 dashboard 的 Customize 弹窗要在浏览器里
  // 算同一件事 —— 预览跟构建必须算得一模一样。分两次搬的：
  //   #1037  颜色的枚举 + 形状那两族的筛选  →  `baseVarsFrom()`
  //   #1118  「有风格设定就用它、没有就落回 globals.css 的默认值并按名字去重」这个二选一
  //          →  `baseVarsForSite()`（那一票让**没换过装的站**也要现算基准，而那些站走的正是
  //          落回那一支）
  // 两次都是**算法一行没改**：同样的入参进去，同样的 [[名, 值], …] 出来（#1118 的判据是三个真站
  // 夹具的 `custom.css` / `theme.css` 逐字节相同）。
  //
  // 🔴 留在这里的只剩两件这份文件独有的事：**读磁盘上的 globals.css**（浏览器里没有磁盘，那边由
  // vite 插件在 Node 里读同一个文件、调同一个解析器），以及**给日志算那句「基准取自哪儿」**。
  const base = tweakLib.baseVarsForSite(
    brand.colors,
    table ? table.settingsToCssVars(brand.settings) : [],
    globalsRootDefaults(),
  );
  if (base.fromSettings) return { vars: base.vars, source: 'theme settings' };
  const source = table ? 'globals.css :root' : 'globals.css :root（#1002 的 scripts/theme-settings.js 还没落地）';
  return { vars: base.vars, source };
}

{
  const tweaks = readThemeKey('tweaks');
  const problems = tweakLib.validateTweaks(tweaks);
  if (problems.length) {
    console.error(`site/theme.json 的 tweaks 不合法（${problems.length} 条）：`);
    for (const p of problems) console.error(`  · ${p}`);
    console.error('  · 允许区间：'
      + Object.entries(tweakLib.TWEAK_BOUNDS).map(([k, b]) => `${k} ∈ [${b.min}, ${b.max}]`).join(' · '));
    process.exit(1);
  }
  // ── #1038 站主挑的绝对值 ────────────────────────────────────────────────────────────────────
  // 跟上面那三个偏移写进同一份 custom.css，叠的次序是「先换基准、再施加偏移」（见
  // tweaks.js §buildCustomCss）。认不出的名字在这里就退出 1，理由跟 tweaks 一样：这一层的
  // 失败形态是「设了但页面没变」，静默忽略等于把它做成常态。
  const presets = readThemeKey('presets');
  const presetProblems = presetLib.validatePresets(presets);
  if (presetProblems.length) {
    console.error(`site/theme.json 的 presets 不合法（${presetProblems.length} 条）：`);
    for (const p of presetProblems) console.error(`  · ${p}`);
    console.error('  · 可选的：'
      + Object.entries(presetLib.presetOptions()).map(([k, v]) => `${k} ∈ {${v.join(', ')}}`).join(' · '));
    process.exit(1);
  }
  const absolute = presetLib.presetVars(presets);
  const customCssPath = path.join(siteDir, 'custom.css');
  const base = baseVarsForTweaks();
  const css = tweakLib.buildCustomCss(base.vars, tweaks, absolute);
  // 🔴 空的时候【删掉文件】，不是写一份 0 字节的进去：AC1 要求「tweaks 全为 0 的站与不带 tweaks 的
  // 站产物逐字节相同」，而这两条路只有在「都没有这个文件」时才真的收敛 —— 一个从没有过 tweaks 的站
  // 根本没有 site/custom.css，#1002 于是给它写那份占位注释；留一个 0 字节文件会走到另一支。
  if (!css) {
    if (fs.existsSync(customCssPath)) fs.unlinkSync(customCssPath);
  } else if (css !== (fs.existsSync(customCssPath) ? fs.readFileSync(customCssPath, 'utf-8') : '')) {
    fs.writeFileSync(customCssPath, css);
  }
  const chose = Object.entries(absolute.chose).map(([k, v]) => `${k}=${v}`).join(' · ');
  console.log(css
    ? `  Tweaks: ${Object.entries(tweakLib.withDefaults(tweaks))
      .map(([k, v]) => `${k}=${v}`).join(' · ')} · Presets: ${chose || 'none'}`
      + ` → site/custom.css (${css.length} bytes); 圆角/留白的基准取自 ${base.source}`
    : '  Tweaks: none · Presets: none — 不产出 site/custom.css（这个站与 #1006 之前逐字节相同）');
}

// custom.css —— 这个站自己的微调，送进页面的那一份。**永远写出来一份**：页面无条件引它，缺文件
// 就是每页一个 404。没有微调时它是一份只有注释的空表。
//
// 🔴 这段必须排在上面 #1006 那段【生成】之后（那段注释里点名要求过）：`site/custom.css` 是
// #1006 按当前这套皮的基准值现算出来的，排在它前面拷走的是**上一次构建**留下的字节 —— 症状是
// 换完主题微调慢一拍，不是报错。判据在下面那行日志：它打印的字节数与 `Tweaks:` 那行一致。
const siteCustomCssPath = path.join(siteDir, 'custom.css');
const customCssBytes = fs.existsSync(siteCustomCssPath)
  ? fs.readFileSync(siteCustomCssPath)
  : Buffer.from('/* 这个站自己的微调。换主题时这份文件不动。 */\n', 'utf-8');
fs.writeFileSync(path.join(publicDir, 'custom.css'), customCssBytes);
const customCssOrigin = fs.existsSync(siteCustomCssPath)
  ? 'from site/custom.css'
  : 'empty (this site has no tweaks)';
console.log(`  Generated public/custom.css — ${customCssOrigin} (${customCssBytes.length} bytes)`);

// ── #1084 按钮的字色 ────────────────────────────────────────────────────────────────────────────
//
// `globals.css` 的 `.btn-primary` / `.btn-secondary` 读三个变量，算它们的规则和每一条的读数都在
// `scripts/lib/button-ink.js`。这里只做一件事：**把最终生效的那份配色找出来**再交给它。
//
// 🔴 为什么不用内存里的 `brand.colors`，而是回头解析两份已经写出去的字节：
//
//   ① `public/theme.css` 有三条互斥来源（见上面 §theme.css 那段），其中一条是**把 repo 里的
//      `site/theme.css` 逐字节拷过去，不重新生成也不覆盖** —— 那是建站/换主题那天烤进站自己 repo
//      的字节，跟这次构建内存里的 `brand.colors` 可以不一样。只从 `buildThemeCss` 那一侧产出这三个
//      变量，就会恰好在**已经换过主题的那些存量站**上缺席，而它们正是本票要救的那批（缺席时按钮
//      落回兜底的白字 —— AC 全绿、字照样读不出来）。
//   ② `public/custom.css` 排在 `/theme.css` **之后**（layout.tsx 那两个 `<link>` 的次序），
//      而 #1006 的 tweaks 与 #1038 的 presets 都会往里写 `--color-primary-*` ⟹ 它盖过 theme.css。
//      拿被盖之前的值算出来的字色，是关于另一套配色的答案。
//
// ⟹ 判据是「浏览器最后会用哪个值」，而那等于「这两份文件里最后一条声明」。解析只认十六进制字面值：
//    认不出的形状不猜（那会静默产出一个错的字色），而是当作这一档不存在。
{
  const inkLib = require('./lib/button-ink.js');
  const themeCssOut = path.join(publicDir, 'theme.css');
  const readIf = (f) => (fs.existsSync(f) ? fs.readFileSync(f, 'utf-8') : '');
  // 次序 = 层叠次序：后面的盖前面的。
  const cascade = readIf(themeCssOut) + '\n' + readIf(path.join(publicDir, 'custom.css'));
  const finalPrimary = {};
  for (const m of cascade.matchAll(/--color-primary-(\d{2,3})\s*:\s*(#[0-9a-fA-F]{3,8})\s*(?:;|})/g)) {
    finalPrimary[m[1]] = m[2];
  }
  // 🔴 #1100 —— accent 那一组也要解，理由与上面 ①② 逐字同源（`.btn-accent` 的 hover 底色现在也是
  // 算出来的那一档）。**同一条 `cascade`、同一条判据**：浏览器最后会用哪个值 = 这两份字节里最后
  // 一条声明。解不出来时 `buttonInkVars` 不产出那个变量，页面落回兜底的 `accent-500`（= 本票之前的
  // 字面行为），而不是产出一个错的档。
  const finalAccent = {};
  for (const m of cascade.matchAll(/--color-accent-(\d{2,3})\s*:\s*(#[0-9a-fA-F]{3,8})\s*(?:;|})/g)) {
    finalAccent[m[1]] = m[2];
  }
  // 🔴 #1084 r3 —— 轮廓按钮的档位要按**它真正被画在上面的那块底**选，而那块底不是页面的白
  // （票正文 2026-08-19 第三次改的口径；上一版按白底挑，在 37 套深底主题上比不改还差）。
  // 那块底就在同一份字节里：主题表的内容是**粘进 `public/theme.css`** 的（见上面 §theme.css 那段
  // 「pasted into theme.css」），所以这里复用同一条 `cascade`，判据也同一条 —— 浏览器最后会用哪个值。
  // 解不出来时（渐变 / color-mix / 变量套变量 / `background` 简写 / 带 alpha 的 hex）
  // `outlineGroundFromCss` 回 `null`，**不猜**；那一步把这件事打出来，因为「解不出来」和「真的是
  // 白底」是两个读数。**选档**仍然按白底走（那是今天的行为），但那一格的**读数**不落回白底。
  // 🔴 #1105 —— 解不出来时往下传的是 `null`，不是白。选档仍按白底走（那是今天的行为），但那一格的
  // **读数**不许按白底报成合格：`buttonInkReport` 收到 null 就把它放进 `unresolved`。
  // 传白进去的后果实测过：`magenta-01` 的 `background:` 简写让轮廓那格报 5.683（合格），
  // 而它真正坐的那块底上是 6.268 —— 报的是另一块底上的数。
  const ground = inkLib.outlineGroundFromCss(cascade, finalPrimary);
  // 🔴 r2 —— `null`（不是 `inkLib.WHITE`）是 #1105 的修法，本票**不许**把它改回去：解不出轮廓按钮
  // 坐的那块底时传白，等于拿一块想象出来的底去算并把结果当合格报出来。本票的 diff 只是路过这一行。
  const outlineGround = ground ? ground.hex : null;
  const inkVars = inkLib.buttonInkVars(finalPrimary, outlineGround, finalAccent);
  const report = inkLib.buttonInkReport(finalPrimary, outlineGround, finalAccent);
  if (inkVars.length) {
    fs.appendFileSync(themeCssOut, `:root { ${inkVars.join(' ')} }\n`);
    const ink = report.ink === inkLib.BLACK ? '深字' : '白字';
    console.log(`  Button ink: primary-500=${finalPrimary['500']}`
      // #1091 —— 主按钮的底走哪一档也要打出来：它是本票唯一会改变画面的那个决定，而
      // 「挪了没有」在日志里看不见的话，一个站是「本来就够」还是「挪过来才够」就分不出。
      // 🔴 r3 —— 那个 `⟹ ${ink}` 原来紧跟在 `primary-500=…` 后面，读起来是「字色是按 500 那一档定的」，
      // 而 #1091 之后字色是按**挪过之后那一档**（`baseShade`）定的（`buttonInkReport` 里先选底再选字，
      // 那一段注释写着这个顺序是承重的）。所以箭头挪到底色后面，主体才是它真正的那一档。
      + ` · 主按钮底色走 primary-${report.baseShade}${report.baseMoved ? '（挪过档）' : '（没动）'}`
      + ` ⟹ 压在那一档上的字用${ink}`
      + ` · hover 底色走 primary-${report.hoverShade} · 轮廓按钮的字走 primary-${report.outlineShade}`
      // #1100 —— accent 按钮 hover 那一档也要打出来，理由跟上面那条一样：它是本票唯一会改变画面的
      // 那个决定，不打的话「挪了没有」在日志里看不见。解不出 accent 时明说是解不出来，不是「没挪」。
      + ` · accent 按钮 hover 底色走 ${report.accentHoverShade
        ? `accent-${report.accentHoverShade}${report.accentHoverMoved ? '（挪过档）' : '（没动）'}`
        : '🔴 解不出 accent 那一组 ⟹ 不产出这个变量，页面落回兜底的 accent-500'}`
      + ` (primary ${Object.keys(finalPrimary).length} 档 / accent ${Object.keys(finalAccent).length} 档`
      + ' 从 theme.css + custom.css 解析出来)');
    // 🔴 这一行不能用 `outlineGround` 拼：#1105 起解不出来时它是 `null`，印出来就是「那块底 = null」。
    console.log(`  Button ink: 轮廓按钮坐的那块底 = ${ground ? ground.hex : '解不出来'} —— `
      + (ground ? ground.from
        // #1126 —— 清单里补上「前一条声明没写分号」那个形状。不补的话人读到的是一句**不含真因**的
        // 警告：那个形状下浏览器把粘在一起的两条一起判废（实测 chromium computed = rgba(0,0,0,0)），
        // 而它不在上面任何一类里。r2 起这一类不只是 `background-color` 前面那条 —— 任何属性没终止都
        // 会把后面那条粘进去，判据是「画底那条声明没顶在 `;` 段开头」（见 button-ink.js 的宽/严两把判据）。
        : '🔴 没认出那个形状（`background` 简写 / 渐变 / color-mix() / 变量套变量 / 带 alpha 的 hex'
          + ' / 前一条声明忘写分号 ⟹ 它和粘在后面那条一起作废）'
          + ' —— 这【不是】"底是白的"⟹ 按白底选档，这一档可能是错的，而轮廓那一格没有读数'));
    // 🔴 #1105 —— 「算不出来的格子」是**第三种**结果，跟「合格」「不合格」并列，所以它自己一条话。
    // 它既不能混进 `under`（那是「量出来了、低于线」），也不能不说 —— 不说的话，一个没有读数的格子
    // 跟一个合格的格子在日志里长得一模一样，而本票要治的正是这个。
    if (report.unresolved.length) {
      console.log(`  🔴 Button ink: 有 ${report.unresolved.length} 格算不出来（不是"合格"，也不是`
        + `"不合格"）—— ${report.unresolved.join(' · ')}`);
    }
    // 🔴 「还有按钮读不出来」要说出来，不能静默（#1084 立的理由：不打这一行，这种站与修好了的站在
    // 日志上一模一样）。**这句话怎么说在 `button-ink.js` 的 `underNote()` 里，不在这里拼** ——
    // #1091 r3：上一版在这里写死「换字色救不回来 …… 两个都低于 4.5」，而 #1091 把它引用的两个数换成了
    // 【挪过档之后那一档】上的读数，于是 58/83 张表上它印出来的第一个数就否掉了自己那半句。搬进
    // `underNote()` 之后它是 `report` 的纯函数，`button-ink.test.js §⑧` 逐套问「印的数否掉自己了吗」。
    // 触发条件（`under` 非空）也在那个函数里：它返回 `null` 就是「不该打这一行」。
    const note = inkLib.underNote(report);
    if (note) console.log(`  🔴 Button ink: ${note}`);
  } else {
    // 🔴 报出来，不静默：这条路意味着两份 CSS 里没有一个**能算的** primary-500 —— 或者一条都没
    // 解析到，或者解析到的是带 alpha 的形状（#1105：`#b54a81ff` 会被 `hexToRgb` 静默丢掉 alpha，
    // 于是"白字还是深字"这个结论是关于另一个颜色的）。而 `tailwind.config.ts` 没给颜色写兜底值
    // ⟹ 第一种情况下这样的站是整站掉色，不是「按钮回落白字」。
    console.log('  Button ink: 跳过 —— theme.css + custom.css 里没有一个【能算的】'
      + ` --color-primary-500（解析到的是 ${JSON.stringify(finalPrimary['500'])}；`
      + '认的是 #rgb / #rrggbb，带 alpha 的 #rgba / #rrggbbaa 不认 —— 见 button-ink.js 的 isColourLiteral）');
  }
}

// TICKET-268b: build-time env overrides site_meta (lets the deploy pick the env's manager URL).
const resolvedLeadApi = process.env.NEXT_PUBLIC_LEAD_API || leadApi || '';
const tsContent = `// Auto-generated by sync-config.js — do not edit manually
export const siteId = ${JSON.stringify(siteId)};
export const leadApi = ${JSON.stringify(resolvedLeadApi)};
export const defaultLocale = ${JSON.stringify(defaultLocale)};
export const locales = ${JSON.stringify(locales)};
export const brand = ${JSON.stringify(brand)};
export const seoByLocale = ${JSON.stringify(seoByLocale)};
export const servicesByLocale = ${JSON.stringify(servicesByLocale)};
export const navigationByLocale = ${JSON.stringify(navigationByLocale)};
export const pagesByLocale = ${JSON.stringify(pagesByLocale)};
export const blogPostsByLocale = ${JSON.stringify(blogPostsByLocale)};
export const regionLayout = ${JSON.stringify(regionLayout)};
export const pageLayout = ${JSON.stringify(pageLayout)};
`;
fs.writeFileSync(configDataPath, tsContent);
console.log('  Generated src/lib/config-data.ts');
