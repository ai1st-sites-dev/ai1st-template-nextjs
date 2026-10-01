#!/usr/bin/env node
/**
 * breadcrumbs.test.js — #1502 AC15：`src/lib/breadcrumbs.ts` §breadcrumbsFor（一页的面包屑，按页面路径算）。
 *
 * 跑法:  node scripts/breadcrumbs.test.js   （或 `npm run test:scripts`，它按文件名发现）
 * 退出码: 0 全过 · 1 有失败 · 2 跑不起来（**不许当成通过**）
 *
 * 管三件事：
 *   ① 四种 slug（一层 / 两层 services/x / 关键词页 x/y 中间页在与不在）逐项断言 label / href / url；
 *   ② 跟抽出来之前 `SubPage.tsx` 那段算法（原样抄在下面 §legacy）逐项对拍 `{name, url}` —— 结构化数据逐字不变；
 *   ③ 阳性对照：把「中间一级那一页在不在」那一判改掉（同一进程、单变量），上面至少一格红。
 * 载的是**真的** `breadcrumbs.ts` + **真的** `config.ts`（localeUrl / getPage / getSeo 都是真的），只把 `config-data`
 * （sync-config 生成的站点数据，这棵树里不一定有）换成替身。
 */

'use strict';

const fs = require('fs');
const path = require('path');
const Module = require('module');
const ts = require('typescript');

const NEXT = path.resolve(__dirname, '..');
const SRC = path.join(NEXT, 'src');
const LIB = path.join(SRC, 'lib', 'breadcrumbs.ts');
const CONFIG = path.join(SRC, 'lib', 'config.ts');

let pass = 0;
let fail = 0;
const ok = (m) => { pass += 1; console.log(`  ✅ ${m}`); };
const bad = (m) => { fail += 1; console.log(`  ❌ ${m}`); };
const die = (m) => { console.error(`🔴 跑不起来: ${m}`); process.exit(2); };

// ── 替身 config-data：站点页面表由测试经 setSite() 原地换（见下面 🔴）─────────────────────────────────
const STUB_DIR = fs.mkdtempSync(path.join(NEXT, 'scripts', 'tmp-breadcrumbs-stubs-'));
process.on('exit', () => { try { fs.rmSync(STUB_DIR, { recursive: true, force: true }); } catch (e) { /* 收尾 */ } });
const CONFIG_DATA = path.join(STUB_DIR, 'config-data.js');
fs.writeFileSync(CONFIG_DATA, `
// 🔴 同一个对象、原地换键：config.ts 在 import 时把 pagesByLocale 取成常量，换引用它看不见。
const pagesByLocale = globalThis.__PAGES__ = globalThis.__PAGES__ || {};
module.exports = {
  brand: {}, siteId: 'x', leadApi: '', regions: {}, pageLayout: {},
  defaultLocale: 'en', locales: ['en', 'fr'],
  seoByLocale: { en: { domain: 'https://northside.test' }, fr: { domain: 'https://northside.test' } },
  servicesByLocale: {}, navigationByLocale: {}, blogPostsByLocale: {},
  pagesByLocale,
};
`);

const sourceOverride = new Map();
for (const ext of ['.tsx', '.ts']) {
  require.extensions[ext] = (mod, filename) => mod._compile(ts.transpileModule(sourceOverride.get(filename) ?? fs.readFileSync(filename, 'utf-8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: true },
    fileName: filename,
  }).outputText, filename);
}
const origResolve = Module._resolveFilename;
Module._resolveFilename = function resolve(req, parent, ...rest) {
  if (req === './config-data' && parent && parent.filename === CONFIG) return CONFIG_DATA;
  if (req.startsWith('@/')) return origResolve.call(this, path.join(SRC, req.slice(2)), parent, ...rest);
  return origResolve.call(this, req, parent, ...rest);
};

function load(override) {
  delete require.cache[LIB];
  if (override) sourceOverride.set(LIB, override); else sourceOverride.delete(LIB);
  return require(LIB).breadcrumbsFor;
}

const page = (slug, title) => ({ slug, title, description: '', blocks: [] });
const SITE_FULL = {
  en: [
    page('home', 'Northside Auto Care'), page('about', 'About Us'), page('services', 'Our Services'),
    page('services/water-heaters', 'Water Heater Repair'), page('water-heaters/burnaby', 'Water Heaters in Burnaby'),
  ],
  fr: [page('home', 'Accueil'), page('about', 'À propos')],
};
/** 换站点数据：原地改替身 config-data 里那一个对象（见上面 🔴）。 */
function setSite(site) {
  const pages = globalThis.__PAGES__ || (globalThis.__PAGES__ = {});
  for (const k of Object.keys(pages)) delete pages[k];
  Object.assign(pages, site);
}
const withoutMiddle = () => ({ ...SITE_FULL, en: SITE_FULL.en.filter((p) => p.slug !== 'services/water-heaters') });

// ── §legacy：抽出来之前 SubPage.tsx:22-41 那段，一字不改（只把 getPage / seo / localeUrl 换成参数）──────────────
function legacy(slug, locale, { getPage, seo, localeUrl }) {
  const page = getPage(slug, locale);
  const slugParts = slug.split('/');
  let breadcrumbItems;
  if (slugParts.length > 1) {
    const serviceDetailSlug = `services/${slugParts[0]}`;
    const serviceDetailPage = getPage(serviceDetailSlug, locale);
    const middleBreadcrumb = serviceDetailPage
      ? { name: serviceDetailPage.title, url: `${seo.domain}${localeUrl(serviceDetailSlug, locale)}` }
      : { name: slugParts[0].replace(/-/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()), url: `${seo.domain}${localeUrl(slugParts[0], locale)}` };
    breadcrumbItems = [
      { name: 'Home', url: `${seo.domain}${localeUrl('home', locale)}` },
      middleBreadcrumb,
      { name: page.title, url: `${seo.domain}${localeUrl(slug, locale)}` },
    ];
  } else {
    breadcrumbItems = [
      { name: 'Home', url: `${seo.domain}${localeUrl('home', locale)}` },
      { name: page.title, url: `${seo.domain}${localeUrl(slug, locale)}` },
    ];
  }
  return breadcrumbItems;
}

let breadcrumbsFor; let config;
try {
  setSite(SITE_FULL);
  breadcrumbsFor = load();
  config = require(CONFIG);
} catch (e) { die(`载入失败: ${e.message}`); }

const J = (v) => JSON.stringify(v);
const D = 'https://northside.test';

/** 四种 slug 的期望值（AC15）。每项 = [说明, slug, locale, 站点, 期望]。 */
const CASES = [
  ['一层（about）', 'about', 'en', SITE_FULL, [
    { label: 'Home', url: `${D}/`, href: '/' },
    { label: 'About Us', url: `${D}/about` },
  ]],
  ['两层 · 服务详情页（services/water-heaters）：中间一级查 services/services 不在 ⟹ slug 转名；/services 那页在 ⟹ 有链接', 'services/water-heaters', 'en', SITE_FULL, [
    { label: 'Home', url: `${D}/`, href: '/' },
    { label: 'Services', url: `${D}/services`, href: '/services' },
    { label: 'Water Heater Repair', url: `${D}/services/water-heaters` },
  ]],
  ['关键词页（water-heaters/burnaby）· 中间页在 ⟹ 用它的 title、链过去', 'water-heaters/burnaby', 'en', SITE_FULL, [
    { label: 'Home', url: `${D}/`, href: '/' },
    { label: 'Water Heater Repair', url: `${D}/services/water-heaters`, href: '/services/water-heaters' },
    { label: 'Water Heaters in Burnaby', url: `${D}/water-heaters/burnaby` },
  ]],
  ['关键词页（water-heaters/burnaby）· 中间页不在 ⟹ slug 转名、没有链接', 'water-heaters/burnaby', 'en', withoutMiddle(), [
    { label: 'Home', url: `${D}/`, href: '/' },
    { label: 'Water Heaters', url: `${D}/water-heaters` },
    { label: 'Water Heaters in Burnaby', url: `${D}/water-heaters/burnaby` },
  ]],
  ['非默认语言（fr/about）：路径带 /fr 前缀', 'about', 'fr', SITE_FULL, [
    { label: 'Home', url: `${D}/fr`, href: '/fr' },
    { label: 'À propos', url: `${D}/fr/about` },
  ]],
];

function runCases(fn) {
  const failed = [];
  for (const [what, slug, locale, site, want] of CASES) {
    setSite(site);
    const got = fn(slug, locale);
    if (J(got) !== J(want)) failed.push({ what, got, want });
  }
  return failed;
}

console.log('── ① 四种 slug 逐项断言');
{
  const failed = runCases(breadcrumbsFor);
  for (const [what] of CASES) {
    const f = failed.find((x) => x.what === what);
    if (f) bad(`${what} —— 读到 ${J(f.got)}，期望 ${J(f.want)}`); else ok(what);
  }
  setSite(SITE_FULL);
  const lastHasNoHref = CASES.every(([, slug, locale, site]) => { setSite(site); const r = breadcrumbsFor(slug, locale); return !('href' in r[r.length - 1]); });
  if (lastHasNoHref) ok('最后一级（当前页）永远没有 href'); else bad('有一条最后一级带了 href');
  setSite(SITE_FULL);
  const none = breadcrumbsFor('no-such-page', 'en');
  if (J(none) === '[]') ok('页面不在 ⟹ 空数组（块就不画那一行）'); else bad(`页面不在读到 ${J(none)}`);
}

console.log('── ② 跟抽出来之前 SubPage 那段逐项对拍 {name, url}（结构化数据逐字不变）');
{
  const deps = { getPage: config.getPage, seo: null, localeUrl: config.localeUrl };
  let n = 0; const diffs = [];
  for (const [what, slug, locale, site] of CASES) {
    setSite(site);
    const want = legacy(slug, locale, { ...deps, seo: config.getSeo(locale) });
    const got = breadcrumbsFor(slug, locale).map((c) => ({ name: c.label, url: c.url }));
    n += 1;
    if (J(got) !== J(want)) diffs.push(`${what}: ${J(got)} ≠ ${J(want)}`);
  }
  if (!diffs.length) ok(`${n} 种 slug 的 {name, url} 与旧算法逐字相同`); else diffs.forEach((x) => bad(x));
}

console.log('── ③ 阳性对照：把「中间一级那一页在不在」那一判改掉 ⟹ ① 至少一格红');
{
  const src = fs.readFileSync(LIB, 'utf-8');
  const needle = 'const middle: Crumb = serviceDetailPage';
  if (!src.includes(needle)) {
    bad(`breadcrumbs.ts 里找不到「${needle}」—— 对照改不下去`);
  } else {
    const mutated = load(src.replace(needle, 'const middle: Crumb = true'));
    const failed = runCases((s, l) => { try { return mutated(s, l); } catch (e) { return `throws: ${e.message}`; } });
    if (failed.length) ok(`改掉之后 ${failed.length} 格红（${failed.map((f) => f.what.split('·')[0].trim()).join(' / ')}）—— 判据分得开`);
    else bad('改掉「中间页在不在」之后 ① 仍全绿 —— 这把尺分不出');
    load();
  }
}

console.log(`\n══ 汇总: 通过 ${pass} · 失败 ${fail} ══`);
process.exit(fail ? 1 : 0);
