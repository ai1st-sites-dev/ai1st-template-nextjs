#!/usr/bin/env node

// TICKET-219 decouple e2e: no-op comment — makes a templates/nextjs change so a
// templates+manager push verifies templates skips (no token) without blocking manager.

const fs = require('fs');
const path = require('path');
const blockManifest = require('./lib/block-manifest');
const { themes, layoutFor, themesWithRhythm } = require('./themes');
const pageLayoutLib = require('./lib/page-layout');
const themeTokens = require('./lib/theme-tokens');
const { resolveRegionLayout } = require('./region-layout');
const { checkCssContracts } = require('./css-contract-check');
// #998 — 页面内容层的形状（sections → blocks）。归一化、站级块库、校验都在那个文件里，
// `create-site.js` 写盘时读的是同一份实现。
const {
  readSiteBlocks, normalizeLocalePages, loadBlockManifests, validateBlockLayouts, MANIFEST_DIR,
} = require('./blocks');
const tweakLib = require('./tweaks');

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
// does not fire npm's lifecycle hooks — worker/main.go:1447 says so in its own comment, and it is why
// each of those call sites runs `node scripts/sync-config.js` itself:
//
//     worker/entrypoint.sh:204   preview mode:  sync-config, then `npx next build` in the serve loop
//     worker/entrypoint.sh:216   create mode:   create-site.js → sync-config → same loop
//     worker/main.go:1511        after an edit: `node scripts/sync-config.js && npx next build`
//     worker/main.go:1457/999/1264   apply a theme / the other rebuild flows: sync-config, explicitly
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
  console.error('  · docs/reference/theme-css-contract.md says what is allowed; each line above says '
    + 'which file and which line broke it.');
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
//   applied !== true, or no file at all (every site that existed before #924, and every
//     newly created site) → nothing below touches the build. brand.json's own colors and the
//     page JSON's own variants decide, exactly as they did before this file knew about themes.
//   applied === true → the registry takes over the look: colors, fonts, and every section
//     variant the theme states a preference for. Page JSON on disk is never rewritten — the
//     override lives only in the generated config-data.ts.
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
    console.error(`theme.json names theme "${meta.themeId}", which is not in the registry (${Object.keys(themes).join(', ')})`);
    process.exit(1);
  }
  return meta.themeId;
}
const appliedThemeId = readAppliedThemeId();

// #991 — THE THEME **CSS** SHEET, WHICH IS A DIFFERENT SWITCH FROM `applied` ABOVE.
//
//     { "themeId": "ocean-blue", "applied": true, "css": "hero-media-left" }
//
// `applied` decides whether the REGISTRY (a JS object) takes over colours, fonts and section
// variants. `css` names a stylesheet in `public/themes/` that owns LAYOUT for the blocks that have
// been made neutral — today that is hero and nothing else (phase 1 of
// docs/superpowers/specs/2026-08-12-theme-css-architecture-design.md).
//
// 🔴 THE FIELD DOES TWO THINGS AT ONCE, AND THAT IS THE POINT. It emits the <link> in layout.tsx AND
// it flips hero to its neutral markup. Neutral markup with no sheet is a hero with no layout at all,
// so the two must not be separately settable. Absent (every site that exists today) ⟹ neither
// happens and the build output is byte-for-byte what it was.
//
// 🔴 The name is checked against the FILE, not against a list kept here: a list is a second place to
// forget. A missing sheet fails the build by name — same shape as #993's `rhythm` check below, and for
// the same reason (a site that silently builds with no hero styling looks like a broken theme, and
// nothing would say which of the two it was).
function readThemeCss() {
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
  // Slug only. This value reaches an href and a filesystem path, and `../` in either is a way out
  // of the directory — refuse rather than sanitise, so a typo is loud instead of silently rewritten.
  if (!/^[a-z0-9][a-z0-9-]*$/.test(name)) {
    console.error(`theme.json css "${name}" is not a valid sheet name (lowercase letters, digits and hyphens)`);
    process.exit(1);
  }
  const sheet = path.join(rootDir, 'public', 'themes', `${name}.css`);
  if (!fs.existsSync(sheet)) {
    const available = fs.existsSync(path.join(rootDir, 'public', 'themes'))
      ? fs.readdirSync(path.join(rootDir, 'public', 'themes')).filter(f => f.endsWith('.css')).join(', ')
      : '(public/themes does not exist)';
    console.error(`theme.json css "${name}" names public/themes/${name}.css, which is not there. Available: ${available}`);
    process.exit(1);
  }
  return name;
}
const themeCss = readThemeCss();

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

// #924: an applied theme owns the palette and the typefaces. brand.json keeps whatever it
// had (name, logo, locations, form ids) — only these two fields are taken over, and only in
// memory, so switching theme id is the whole of "change theme".
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

if (appliedThemeId) {
  brand.colors = themes[appliedThemeId].colors;
  brand.fonts = themes[appliedThemeId].fonts;
  // #961: 风格设定跟配色、字体走同一条路 —— 记进 brand，layout.tsx 翻成 CSS 变量。
  // 没应用 theme 的站这里什么都不写 ⟹ 页面上一个覆盖都没有 ⟹ 落回 globals.css 的默认值，
  // 也就是这张票改动之前的样子。
  brand.settings = themes[appliedThemeId].settings;
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

function readPagesRecursive(dir, prefix, accumulator) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      readPagesRecursive(path.join(dir, entry.name), prefix ? `${prefix}/${entry.name}` : entry.name, accumulator);
    } else if (entry.name.endsWith('.json')) {
      const content = JSON.parse(fs.readFileSync(path.join(dir, entry.name), 'utf-8'));
      if (prefix) {
        const baseName = entry.name.replace(/\.json$/, '');
        content.slug = `${prefix}/${baseName}`;
      }
      accumulator.push(content);
    }
  }
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
  if (fs.existsSync(pagesDir)) {
    readPagesRecursive(pagesDir, '', localePages);
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
  try {
    const blocksReport = {};
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
  //    的唯一后果是这个站从此重建不出来、预览也开不出来（`worker/entrypoint.sh:198-206` 的 preview
  //    分支带 `set -e`）。实测 GitHub 上真实存在的 28 个站，硬拦会当场废掉 prod 的两个。
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
  const isServiceDetailPage = p => p.serviceDetailPage === true || (p.slug.startsWith('services/') && p.slug !== 'services');
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

// #924: an applied theme also owns the layout. For every section type the theme has an
// opinion about, its variant wins over the one the page JSON carries; section types it says
// nothing about are left alone. Runs after the locale loop on purpose — navigation.json is
// the one file written back to disk up there, and it must not pick any of this up.
if (appliedThemeId) {
  const layout = layoutFor(appliedThemeId);
  let overridden = 0;
  for (const locale of locales) {
    for (const page of pagesByLocale[locale]) {
      for (const block of page.blocks) {
        const preferred = layout[block.type];
        if (!preferred) continue;
        block.data = { ...(block.data || {}), variant: preferred };
        overridden++;
      }
    }
  }
  console.log(`  Theme "${appliedThemeId}" applied: colors + fonts + ${overridden} section variant(s)`);
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
// deliberately NOT conditional on `appliedThemeId`, exactly as the #983 check it replaces was: a
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
// 📌 没换装的站(appliedThemeId 为空)传的是 {} ⟹ 两个 Region 都回到现状,「换装才接管」的语义不变。
const regionLayout = resolveRegionLayout(
  appliedThemeId ? layoutFor(appliedThemeId) : {},
  // 🔴 全部 locale 的**全部**页面,不是只给首页:浮层在**任何**第一段是 hero 的页面上都会浮起来
  // (SiteShell 的 overHero),所以那条对比度规则的证据面必须跟它的生效面一样宽(QA3 在 r2 上量的)。
  locales.flatMap(loc => pagesByLocale[loc] || []),
  brand.colors, // 判「那一段是不是深底」要查颜色档在不在 —— 一个 class 名字写着深色不等于它画得出来
);
console.log(`  Regions: header=${regionLayout.header} footer=${regionLayout.footer}` +
  (regionLayout.headerScrim ? ' (+scrim)' : ''));

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
// `transparent-overlay`（`themes.js` 的 layout.header）。
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
  console.error('  · 换一个不带 topbar 区的 page layout，或者换一套顶栏不是透明浮层的主题'
    + '（themes.js 里 layout.header 不是 transparent-overlay 的那些）');
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
    console.error('  · 在 navigation.json 里加 { "topbar": { "message": "…", "link": { "label": "…", "href": "…" } } }，'
      + '或者换一个不带 topbar 区的 page layout');
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
console.log(themeCss
  ? `  Theme CSS: public/themes/${themeCss}.css — hero styled by that sheet (base.css underneath)`
  : '  Theme CSS: none — hero falls back to base.css alone; the 33 unmoved blocks keep their variants');

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
// 颜色：`brand.colors`（换过装的站，上面第 161 行已经把它换成了那套主题的调色板）。
// 圆角 / 留白 / 按钮形状：写了风格设定的站由那张档位表说了算，没写的站落在 `globals.css` 的
// `:root` 默认值上。**两者不是同一组数**：30 套主题里只有 3 套的设定恰好等于默认值，
// 其余 27 套不是（实测：`round/airy/pill` 5 套、`sharp/compact/square` 5 套…）。只读 globals.css
// 的话，一个 `radius: 'round'`（0.5rem）的站会被按 0.25rem 去乘 —— 圆角不是变大，是**变小一半**。
/** 再读一次 theme.json，只为拿 `tweaks`（上面那两个读它的函数各自只取自己那一个键）。 */
function readTweaks() {
  const themePath = path.join(siteDir, 'theme.json');
  if (!fs.existsSync(themePath)) return undefined;
  try {
    return JSON.parse(fs.readFileSync(themePath, 'utf-8')).tweaks;
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

/** `globals.css` 的 `:root` 默认值 → [[名, 值], …]。没写风格设定的站，页面上生效的就是这一组。 */
function globalsRootDefaults() {
  const out = [];
  const src = fs.readFileSync(path.join(rootDir, 'src', 'app', 'globals.css'), 'utf-8');
  const at = src.indexOf(':root {');
  if (at < 0) return out;
  const block = src.slice(at, src.indexOf('}', at));
  for (const m of block.matchAll(/(--(?:radius|section)-[A-Za-z0-9-]+)\s*:\s*([^;]+);/g)) {
    out.push([m[1], m[2].trim()]);
  }
  return out;
}

/**
 * 微扰要乘的那一组基准值 → [[变量名, 值], …]，外加一句「圆角/留白是从哪儿取的」给日志用。
 *
 * 🔴 这里【只取本层认识的三族】（`--color-*` / `--radius-*` / `--section-*`），阴影和字体不在
 * 微扰会碰的范围里：阴影改了会动对比度观感、字体没有可乘的量（fontScale 不在本票）。
 */
function baseVarsForTweaks() {
  const out = [];
  for (const [shade, value] of Object.entries(brand.colors.primary || {})) {
    out.push([`--color-primary-${shade}`, value]);
  }
  for (const [shade, value] of Object.entries(brand.colors.accent || {})) {
    out.push([`--color-accent-${shade}`, value]);
  }
  const table = settingsTable();
  // `settingsToCssVars` 吐的是 `--radius-lg: 0.5rem;` 这样的整条声明，拆回名/值。
  const fromSettings = table
    ? table.settingsToCssVars(brand.settings)
      .map((decl) => /^\s*(--[A-Za-z0-9-]+)\s*:\s*(.+?);?\s*$/.exec(decl))
      .filter(Boolean)
      .filter((m) => /^--(radius|section)-/.test(m[1]))   // 阴影不在微扰范围里
      .map((m) => [m[1], m[2].trim()])
    : [];
  // 没有风格设定的站（`settingsToCssVars` 返回空）落回 globals.css 的默认值 —— 那正是页面上生效的值。
  const shapes = fromSettings.length ? fromSettings : globalsRootDefaults();
  const source = fromSettings.length ? 'theme settings' : (table ? 'globals.css :root' : 'globals.css :root（#1002 的 scripts/theme-settings.js 还没落地）');
  out.push(...shapes);
  return { vars: out, source };
}

{
  const tweaks = readTweaks();
  const problems = tweakLib.validateTweaks(tweaks);
  if (problems.length) {
    console.error(`site/theme.json 的 tweaks 不合法（${problems.length} 条）：`);
    for (const p of problems) console.error(`  · ${p}`);
    console.error('  · 允许区间：'
      + Object.entries(tweakLib.TWEAK_BOUNDS).map(([k, b]) => `${k} ∈ [${b.min}, ${b.max}]`).join(' · '));
    process.exit(1);
  }
  const customCssPath = path.join(siteDir, 'custom.css');
  const base = baseVarsForTweaks();
  const css = tweakLib.buildCustomCss(base.vars, tweaks);
  // 🔴 空的时候【删掉文件】，不是写一份 0 字节的进去：AC1 要求「tweaks 全为 0 的站与不带 tweaks 的
  // 站产物逐字节相同」，而这两条路只有在「都没有这个文件」时才真的收敛 —— 一个从没有过 tweaks 的站
  // 根本没有 site/custom.css，#1002 于是给它写那份占位注释；留一个 0 字节文件会走到另一支。
  if (!css) {
    if (fs.existsSync(customCssPath)) fs.unlinkSync(customCssPath);
  } else if (css !== (fs.existsSync(customCssPath) ? fs.readFileSync(customCssPath, 'utf-8') : '')) {
    fs.writeFileSync(customCssPath, css);
  }
  console.log(css
    ? `  Tweaks: ${Object.entries(tweakLib.withDefaults(tweaks))
      .map(([k, v]) => `${k}=${v}`).join(' · ')} → site/custom.css (${css.length} bytes)`
      + `; 圆角/留白的基准取自 ${base.source}`
    : '  Tweaks: none — 不产出 site/custom.css（这个站与本票之前逐字节相同）');
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
// #991 — name of the stylesheet in public/themes/ that owns block layout, '' when this site has none.
export const themeCss = ${JSON.stringify(themeCss)};
`;
fs.writeFileSync(configDataPath, tsContent);
console.log('  Generated src/lib/config-data.ts');
