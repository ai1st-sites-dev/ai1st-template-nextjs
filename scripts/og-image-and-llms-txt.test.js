#!/usr/bin/env node
/**
 * og-image-and-llms-txt.test.js — #1552：`src/lib/og-image.ts`（分享图三档 + 卡型）与 `src/lib/llms-txt.ts`（站根 /llms.txt）。
 *
 * 跑法:  node scripts/og-image-and-llms-txt.test.js   （或 `npm run test:scripts`，它按文件名发现）
 * 退出码: 0 全过 · 1 有失败 · 2 跑不起来（**不许当成通过**）
 *
 *   ① 取图四臂（跟票上验收那张表同形）+ svg 的几种写法（带查询串 / 大写扩展名）都跳过；
 *   ② llms.txt：站名、服务、每页一行、联系方式都在；不含平台术语；
 *   ③ 阳性对照：把「跳过 svg」那一判拿掉（同一进程、单变量）⟹ ① 的 svg 臂红。
 * 载的是**真的** og-image.ts / llms-txt.ts / config.ts，只把 sync-config 生成的 `config-data` 换成替身。
 * 构建产物那一层（out/ 里每个 HTML 的 <head>）归 QA 按票面四臂读，这里管函数本身。
 */

'use strict';

const fs = require('fs');
const path = require('path');
const Module = require('module');
const ts = require('typescript');

const NEXT = path.resolve(__dirname, '..');
const SRC = path.join(NEXT, 'src');
const OG = path.join(SRC, 'lib', 'og-image.ts');
const LLMS = path.join(SRC, 'lib', 'llms-txt.ts');
const CONFIG = path.join(SRC, 'lib', 'config.ts');

let pass = 0;
let fail = 0;
const ok = (m) => { pass += 1; console.log(`  ✅ ${m}`); };
const bad = (m) => { fail += 1; console.log(`  ❌ ${m}`); };
const die = (m) => { console.error(`🔴 跑不起来: ${m}`); process.exit(2); };

// ── 替身 config-data：同一个对象原地换键（config.ts 在 import 时把它们取成常量，换引用它看不见）──
const STUB_DIR = fs.mkdtempSync(path.join(NEXT, 'scripts', 'tmp-og-llms-stubs-'));
process.on('exit', () => { try { fs.rmSync(STUB_DIR, { recursive: true, force: true }); } catch (e) { /* 收尾 */ } });
const CONFIG_DATA = path.join(STUB_DIR, 'config-data.js');
fs.writeFileSync(CONFIG_DATA, `
const S = globalThis.__SITE__ = globalThis.__SITE__ || { brand: {}, pagesByLocale: {}, servicesByLocale: {} };
module.exports = {
  brand: S.brand, siteId: 'x', leadApi: '', regions: {}, pageLayout: {},
  defaultLocale: 'en', locales: ['en'],
  seoByLocale: { en: { domain: 'https://northside.test', siteDescription: 'Plumbing done right in Burnaby.' } },
  servicesByLocale: S.servicesByLocale, navigationByLocale: {}, blogPostsByLocale: {},
  pagesByLocale: S.pagesByLocale,
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

const S = globalThis.__SITE__ = { brand: {}, pagesByLocale: {}, servicesByLocale: {} };
function setSite({ heroImage, logoUrl }) {
  for (const k of Object.keys(S.brand)) delete S.brand[k];
  Object.assign(S.brand, {
    name: { en: 'Northside Plumbing' }, tagline: { en: 'Fast, honest plumbing' }, logoIcon: 'wrench', logoUrl,
    email: 'hi@northside.test', locations: [{ label: 'Main', address: '1 Main St, Burnaby', phone: '604-555-0100' }],
  });
  const hero = { type: 'hero', data: heroImage === undefined ? { headline: 'Hi' } : { headline: 'Hi', image: { imageUrl: heroImage, alt: '' } } };
  for (const k of Object.keys(S.pagesByLocale)) delete S.pagesByLocale[k];
  S.pagesByLocale.en = [
    { slug: 'home', title: 'Northside Plumbing', description: 'Plumbers in Burnaby', blocks: [hero, { type: 'cta', data: {} }] },
    { slug: 'about', title: 'About Us', description: 'Family-run since 1998', blocks: [] },
    { slug: 'water-heaters/burnaby', title: 'Water Heaters in Burnaby', description: 'Same-day water heater repair', blocks: [] },
  ];
  for (const k of Object.keys(S.servicesByLocale)) delete S.servicesByLocale[k];
  S.servicesByLocale.en = [{ id: 'wh', name: 'Water Heater Repair', shortDescription: 'Same-day fixes', fullDescription: '', icon: 'flame', features: [] }];
}
function loadOg(override) {
  delete require.cache[OG];
  if (override) sourceOverride.set(OG, override); else sourceOverride.delete(OG);
  return require(OG);
}

let og;
try { setSite({ heroImage: undefined, logoUrl: '' }); og = loadOg(); } catch (e) { die(`载入失败: ${e.message}`); }

const ARMS = [
  { what: '① hero 图 + logo ⟹ hero 图', heroImage: '/images/hero.jpg', logoUrl: '/logo.png', img: '/images/hero.jpg' },
  { what: '② 只有 logo ⟹ logo', heroImage: undefined, logoUrl: '/logo.png', img: '/logo.png' },
  { what: '③ svg hero + logo ⟹ logo（svg 跳过）', heroImage: '/images/grid-pattern.svg', logoUrl: '/logo.png', img: '/logo.png' },
  { what: '④ 两样都没有 ⟹ 不出图、卡降 summary', heroImage: undefined, logoUrl: '', img: null },
  { what: '③b svg 带查询串 / 大写扩展名也跳过', heroImage: '/x/HERO.SVG?v=2', logoUrl: 'https://cdn.test/logo.svg#a', img: null },
  { what: '③c 远程 png 照用（R2 上传的图是绝对地址）', heroImage: 'https://uploads.test/a/b.png', logoUrl: '', img: 'https://uploads.test/a/b.png' },
];
function runArms(mod) {
  const failed = [];
  for (const a of ARMS) {
    setSite(a);
    const img = mod.siteOgImage();
    const fields = mod.ogImageFields();
    const card = mod.twitterCard();
    const wantFields = a.img ? { images: [a.img] } : {};
    const wantCard = a.img ? 'summary_large_image' : 'summary';
    const good = img === a.img && JSON.stringify(fields) === JSON.stringify(wantFields) && card === wantCard;
    if (!good) failed.push(`${a.what}：图 ${JSON.stringify(img)} · openGraph ${JSON.stringify(fields)} · 卡 ${card}`);
  }
  return failed;
}

console.log('── ① 取图四臂 + svg 写法');
{
  const failed = runArms(og);
  ARMS.forEach((a) => { if (!failed.some((f) => f.startsWith(a.what))) ok(a.what); });
  failed.forEach((f) => bad(f));
}

console.log('── ② llms.txt');
{
  setSite({ heroImage: undefined, logoUrl: '' });
  delete require.cache[LLMS];
  const txt = require(LLMS).buildLlmsTxt('en');
  const must = [
    ['站名是 H1', /^# Northside Plumbing\n/],
    ['一句话简介', /\n> Plumbing done right in Burnaby\.\n/],
    ['服务清单', /\n## Services\n\n- Water Heater Repair: Same-day fixes\n/],
    ['每页一行（含关键词页、带绝对地址和 description）', /\n- \[Northside Plumbing\]\(https:\/\/northside\.test\/\): Plumbers in Burnaby\n- \[About Us\]\(https:\/\/northside\.test\/about\): Family-run since 1998\n- \[Water Heaters in Burnaby\]\(https:\/\/northside\.test\/water-heaters\/burnaby\): Same-day water heater repair\n/],
    ['联系方式', /\n## Contact\n\n- Address \(Main\): 1 Main St, Burnaby\n- Phone \(Main\): 604-555-0100\n- Email: hi@northside\.test\n/],
  ];
  for (const [what, re] of must) { if (re.test(txt)) ok(what); else bad(`${what}：没找到 ${re}\n${txt}`); }
  const banned = ['Terminology', '黄金关键词', '蓝海关键词', 'GEO', 'golden keyword'];
  const hit = banned.filter((w) => txt.includes(w));
  if (!hit.length) ok(`不含平台术语（${banned.join(' / ')}）`); else bad(`含平台术语：${hit.join(', ')}`);
}

console.log('── ③ 阳性对照：拿掉「跳过 svg」⟹ ① 的 svg 臂红');
{
  const src = fs.readFileSync(OG, 'utf-8');
  const needle = "return u && !isSvg(u) ? u : null;";
  if (!src.includes(needle)) bad(`og-image.ts 里找不到「${needle}」—— 对照改不下去`);
  else {
    const failed = runArms(loadOg(src.replace(needle, 'return u ? u : null;')));
    if (failed.length) ok(`拿掉之后 ${failed.length} 格红（${failed.map((f) => f.split('：')[0]).join(' / ')}）—— 判据分得开`);
    else bad('拿掉「跳过 svg」之后 ① 仍全绿 —— 这把尺分不出');
    loadOg();
  }
}

console.log(`\n══ 汇总: 通过 ${pass} · 失败 ${fail} ══`);
process.exit(fail ? 1 : 0);
