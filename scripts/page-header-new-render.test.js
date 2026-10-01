#!/usr/bin/env node
/**
 * page-header-new-render.test.js — #1502 验收里「看渲染出来的 HTML / 调一次校验器就能判」的那几条。
 *
 * 跑法:  node scripts/page-header-new-render.test.js   （或 `npm run test:scripts`，它按文件名发现）
 * 退出码: 0 全过 · 1 有失败 · 2 跑不起来（**不许当成通过**）
 *
 * 管哪几条：AC1（5 个预设逐字、旋钮名 / 值逐字、目录集合、两两不同）· AC3（恰好一个 h1）· AC4（面包屑按页面路径算：
 * 三级 / 中间页不在 / 改页面 title 块数据不动 / 一层两级）· AC5 的块那一半（块单独渲染里 BreadcrumbList 0 段）·
 * AC9 的 DOM 那一半（bg 纯色 / 渐变给 tone）· AC10（validateSite）· AC11（block-roles · 首页池 · 提示词）·
 * AC13 的 schema 那一半（面包屑不是字段）· AC14（旧块 / create-site / keyword-page-options 零改动，SubPage 只两处）。
 * 几何（16 种组合三端无横向滚动、副标题宽、两列比例、图 40%、计算色）要浏览器：
 * `tests/e2e/specs/1502-page-header-new-knobs.spec.ts`。面包屑函数本身在 `scripts/breadcrumbs.test.js`。
 *
 * 🔴 每一段都带反向对照（同一进程、单变量），证明判据真会红。
 * 载的是**真的** `breadcrumbs.ts` + `config.ts` + `component-labels.ts`，只把 `config-data`（站点数据）换成替身。
 */

'use strict';

const fs = require('fs');
const path = require('path');
const Module = require('module');
const { execFileSync } = require('child_process');
const ts = require('typescript');
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');

const NEXT = path.resolve(__dirname, '..');
const REPO = path.resolve(NEXT, '..', '..');
const SRC = path.join(NEXT, 'src');
const BLOCK = path.join(NEXT, 'blocks', 'page-header-new');
const SECTION = path.join(BLOCK, 'Section.tsx');
const CONFIG = path.join(SRC, 'lib', 'config.ts');

let pass = 0;
let fail = 0;
const ok = (m) => { pass += 1; console.log(`  ✅ ${m}`); };
const bad = (m) => { fail += 1; console.log(`  ❌ ${m}`); };
const die = (m) => { console.error(`🔴 跑不起来: ${m}`); process.exit(2); };
const check = (cond, m, detail) => (cond ? ok(m) : bad(detail ? `${m} —— ${detail}` : m));

// ── 替身：next/link；站点数据（config-data）。页面表原地换键（config.ts 在 import 时把它取成常量）──────────
const STUB_DIR = fs.mkdtempSync(path.join(NEXT, 'scripts', 'tmp-page-header-new-stubs-'));
process.on('exit', () => { try { fs.rmSync(STUB_DIR, { recursive: true, force: true }); } catch (e) { /* 收尾 */ } });
const stub = (name, body) => { const p = path.join(STUB_DIR, `${name}.js`); fs.writeFileSync(p, body); return p; };
const STUBS = {
  'next/link': stub('link', "const React=require('react');"
    + "const L=({href,children,...r})=>React.createElement('a',{href,...r},children);module.exports=L;module.exports.default=L;\n"),
};
const CONFIG_DATA = stub('config-data', `
const pagesByLocale = globalThis.__PAGES__ = globalThis.__PAGES__ || {};
module.exports = {
  brand: {}, siteId: 'x', leadApi: '', regions: {}, pageLayout: {},
  defaultLocale: 'en', locales: ['en', 'fr'],
  seoByLocale: { en: { domain: 'https://maple.test' }, fr: { domain: 'https://maple.test' } },
  servicesByLocale: {}, navigationByLocale: {}, blogPostsByLocale: {}, pagesByLocale,
};
`);
const sourceOverride = new Map();
for (const ext of ['.tsx', '.ts']) {
  require.extensions[ext] = (mod, filename) => mod._compile(ts.transpileModule(sourceOverride.get(filename) ?? fs.readFileSync(filename, 'utf-8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true, resolveJsonModule: true },
    fileName: filename,
  }).outputText, filename);
}
const origResolve = Module._resolveFilename;
Module._resolveFilename = function resolve(req, parent, ...rest) {
  if (STUBS[req]) return STUBS[req];
  if (req === './config-data' && parent && parent.filename === CONFIG) return CONFIG_DATA;
  if (req.startsWith('@/')) return origResolve.call(this, path.join(SRC, req.slice(2)), parent, ...rest);
  return origResolve.call(this, req, parent, ...rest);
};

function loadSection(override) {
  delete require.cache[SECTION];
  if (override) sourceOverride.set(SECTION, override); else sourceOverride.delete(SECTION);
  return require(SECTION).default;
}

const page = (slug, title) => ({ slug, title, description: '', blocks: [] });
/** AC4 的夹具站：有 services/water-heaters 与 water-heaters/burnaby 两页。 */
const SITE = () => ({
  en: [page('home', 'Maple Ridge Plumbing'), page('about', 'About Us'), page('services', 'Services'),
    page('services/water-heaters', 'Water Heater Repair'), page('water-heaters/burnaby', 'Water Heaters in Burnaby')],
  fr: [page('home', 'Accueil'), page('about', 'À propos')],
});
function setSite(site) {
  const pages = globalThis.__PAGES__ || (globalThis.__PAGES__ = {});
  for (const k of Object.keys(pages)) delete pages[k];
  Object.assign(pages, site);
}

let C; let DEMO; let manifestLib; let M;
try {
  setSite(SITE());
  C = loadSection();
  DEMO = require(path.join(NEXT, 'scripts', 'lib', 'demo-content')).DEMO_CONTENT['page-header-new'];
  manifestLib = require(path.join(NEXT, 'scripts', 'lib', 'block-manifest.js'));
  M = manifestLib.loadManifests().get('page-header-new');
} catch (e) { die(`载入失败: ${e.message}`); }
if (!DEMO) die('demo-content 里没有 page-header-new 那一份');
if (!M) die('blocks/ 里没有 page-header-new');

const clone = (v) => JSON.parse(JSON.stringify(v));
const render = (shape, data, { slug = 'water-heaters/burnaby', locale = 'en', Comp = C } = {}) => renderToStaticMarkup(React.createElement(Comp, {
  data, locale, block: { id: 'p', type: 'page-header-new', shape, data: {} }, ...(slug ? { pageSlug: slug } : {}),
}));
const withOpts = (o, extra = {}) => ({ ...clone(DEMO), ...extra, options: { ...(DEMO.options || {}), ...o } });
const count = (html, needle) => html.split(needle).length - 1;
const own = (r) => r.problems.filter((p) => p.includes('("page-header-new")'));
const sectionTag = (html) => (/<section[^>]*>/.exec(html) || [''])[0];
const attr = (html, name) => { const m = new RegExp(`\\s${name}="([^"]*)"`).exec(sectionTag(html)); return m ? m[1] : null; };
/** 面包屑那一行：每个 <li> 的 [文字, href|null, 是不是当前页]。 */
const crumbs = (html) => {
  const nav = (/<nav[^>]*aria-label="Breadcrumb"[^>]*>([\s\S]*?)<\/nav>/.exec(html) || [])[1];
  if (nav === undefined) return null;
  return [...nav.matchAll(/<li([^>]*)>([\s\S]*?)<\/li>/g)].map(([, a, inner]) => {
    const link = /<a href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/.exec(inner);
    return [link ? link[2] : inner, link ? link[1] : null, /aria-current="page"/.test(a)];
  });
};

// ══ AC1 ════════════════════════════════════════════════════════════════════════════════════════════
console.log('── AC1 五个预设');
{
  const WANT = [
    ['Simple', 'simple', 'top', 'left', 'none'],
    ['Centered', 'centered', 'top', 'center', 'none'],
    ['Split', 'split', 'left', 'left', 'none'],
    ['Photo', 'photo', 'top', 'left', 'right'],
    ['Cover', 'cover', 'top', 'center', 'background'],
  ];
  const got = (M.presets || []).map((p) => [p.name, p.shape, p.knobs.headlinePosition, p.knobs.textAlign, p.knobs.image]);
  check(JSON.stringify(got) === JSON.stringify(WANT), 'presets 5 条与正文表逐字相同（名字 · 形态 · 三个旋钮）', JSON.stringify(got));
  check((M.presets || []).every((p) => Object.keys(p.knobs).join() === 'headlinePosition,textAlign,image'), '每个预设的 knobs 键就是这三个、同一顺序');
  const knobs = M.slots.options.knobs.map((k) => [k.name, k.values]);
  check(JSON.stringify(knobs) === JSON.stringify([
    ['headlinePosition', ['top', 'left']], ['textAlign', ['left', 'center']], ['image', ['none', 'left', 'right', 'background']],
  ]), `slots.options.knobs 名字依次 headlinePosition / textAlign / image、values 逐字（values[0] = 默认）`);
  const dirs = fs.readdirSync(BLOCK, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name).sort();
  check(JSON.stringify(dirs) === JSON.stringify(WANT.map((w) => w[1]).sort()), `目录集合 == 5 个预设形态（${dirs.join(' / ')}）`);
  check(dirs.every((d) => !fs.existsSync(path.join(BLOCK, d, 'Section.tsx'))), '一份 Section.tsx（形态目录里没有第二份 markup）');
  check(M.skin === 'site-css' && M.roleDefault === 'optional', `skin=${M.skin} · roleDefault=${M.roleDefault}`);
  const htmls = dirs.map((d) => render(d, clone(DEMO)));
  check(new Set(htmls).size === 5, `同一份夹具下 5 个预设渲染出 ${new Set(htmls).size} 份互不相同的 HTML`);
  const pinned = dirs.map((d) => render(d, withOpts(M.presets[0].knobs)).replace(/data-shape="[^"]*"/g, ''));
  check(new Set(pinned).size === 1, '反向对照：options 里写死三个旋钮 ⟹ 5 个预设（去掉 data-shape 之后）塌成同一份 —— 判据分得开');
  const bgA = JSON.stringify(manifestLib.loadManifests().get('footer-new').slots.bg);
  check(JSON.stringify(M.slots.bg) === bgA, 'bg 槽整份照抄 footer-new（逐字节相同）');
  check(M.slots.ctas && M.slots.ctas.max === 2 && M.slots.ctas.maxItems === undefined, 'ctas 是 max 2（只派生工具栏的数量维，不进校验，同 cta-new）');
  check(!('breadcrumbs' in M.slots), '槽表里没有 breadcrumbs');
}

// ══ AC3：恰好一个 h1，内容 == headline ══════════════════════════════════════════════════════════════
console.log('\n── AC3 h1');
{
  for (const p of M.presets) {
    const html = render(p.shape, clone(DEMO));
    const h1s = [...html.matchAll(/<h1[^>]*>([\s\S]*?)<\/h1>/g)].map((x) => x[1]);
    check(h1s.length === 1 && h1s[0] === DEMO.headline, `${p.name}：恰好 1 个 <h1>，内容 == headline`, JSON.stringify(h1s));
  }
  check(count(render('simple', clone(DEMO)), '<h2') === 0, '块里没有 h2（标题就是那一个 h1）');
}

// ══ AC4：面包屑按页面路径算 ═══════════════════════════════════════════════════════════════════════
console.log('\n── AC4 面包屑按页面路径算');
{
  setSite(SITE());
  const three = crumbs(render('simple', clone(DEMO)));
  check(JSON.stringify(three) === JSON.stringify([['Home', '/', false], ['Water Heater Repair', '/services/water-heaters', false], ['Water Heaters in Burnaby', null, true]]),
    'water-heaters/burnaby ⟹ 3 个 <li>：Home（链到首页）→ services/water-heaters 那页的 title（链过去）→ 本页 title（不是链接、aria-current）', JSON.stringify(three));
  const html3 = render('simple', clone(DEMO));
  check(/<nav[^>]*aria-label="Breadcrumb"[^>]*><ol class="breadcrumb[^"]*">/.test(html3), '结构：<nav aria-label="Breadcrumb"><ol class="breadcrumb">');

  const noMid = SITE(); noMid.en = noMid.en.filter((p) => p.slug !== 'services/water-heaters'); setSite(noMid);
  const gone = crumbs(render('simple', clone(DEMO)));
  check(JSON.stringify(gone[1]) === JSON.stringify(['Water Heaters', null, false]), '删掉 services/water-heaters ⟹ 中间一级是 slug 转出来的名字、没有链接', JSON.stringify(gone));

  const renamed = SITE(); renamed.en.find((p) => p.slug === 'water-heaters/burnaby').title = 'Burnaby Water Heaters'; setSite(renamed);
  const data = clone(DEMO); const before = JSON.stringify(data);
  const re = crumbs(render('simple', data));
  check(re[2][0] === 'Burnaby Water Heaters' && JSON.stringify(data) === before, '把本页 title 改掉、块数据一个字节不动 ⟹ 最后一级跟着变');

  setSite(SITE());
  const two = crumbs(render('simple', clone(DEMO), { slug: 'about' }));
  check(JSON.stringify(two) === JSON.stringify([['Home', '/', false], ['About Us', null, true]]), '只有一层的页（about）⟹ 2 个 <li>', JSON.stringify(two));
  const fr = crumbs(render('simple', clone(DEMO), { slug: 'about', locale: 'fr' }));
  check(fr && fr[0][0] === 'Accueil' && fr[0][1] === '/fr', `fr ⟹ 第一级是本地化的「Home」（${fr && fr[0][0]}），链到 /fr`);
  check(crumbs(render('simple', clone(DEMO), { slug: null })) === null, '没给 pageSlug（首页 / 不知道是哪一页）⟹ 不画那一行');
  check(crumbs(render('simple', clone(DEMO), { slug: 'home' })) === null, 'pageSlug=home ⟹ 不画');

  // 块不读 data.breadcrumbs：塞一份进去，画出来的一字不变。
  const planted = { ...clone(DEMO), breadcrumbs: [{ label: 'AI WROTE THIS', href: '/x' }] };
  check(render('simple', planted) === render('simple', clone(DEMO)), '块不读 data.breadcrumbs（塞一份进去，HTML 逐字不变）');
  // 反向对照：组件改成读 data.breadcrumbs ⟹ 上一条要红。
  const src = fs.readFileSync(SECTION, 'utf-8');
  const needle = "const crumbs = pageSlug && pageSlug !== 'home' ? breadcrumbsFor(pageSlug, locale) : [];";
  if (!src.includes(needle)) die('AC4 反向对照找不到面包屑那一行');
  const Bad = loadSection(src.replace(needle, 'const crumbs = ((d as any).breadcrumbs || []).map((c: any) => ({ label: c.label, href: c.href, url: "" }));'));
  check(render('simple', planted, { Comp: Bad }) !== render('simple', clone(DEMO), { Comp: Bad }), '反向对照：组件改成读 data.breadcrumbs ⟹ 两份 HTML 不再相同 —— 判据分得开');
  loadSection();
}

// ══ AC5（块那一半）：块单独渲染里没有 BreadcrumbList ═════════════════════════════════════════════════
console.log('\n── AC5 块不出结构化数据');
{
  setSite(SITE());
  const all = M.presets.map((p) => render(p.shape, clone(DEMO))).join('\n');
  check(count(all, 'BreadcrumbList') === 0 && count(all, 'application/ld+json') === 0, '5 个预设的渲染里 BreadcrumbList 0 段、ld+json 0 段');
  const srcTxt = fs.readFileSync(SECTION, 'utf-8');
  check(!/BreadcrumbJsonLd|from '@\/components\/JsonLd'/.test(srcTxt.replace(/^\s*\/\/.*$/gm, '')), 'Section.tsx 不引 BreadcrumbJsonLd');
}

// ══ AC9（DOM 那一半）：bg 纯色 / 渐变 ⟹ tone（计算色在 e2e）═════════════════════════════════════════
console.log('\n── AC9 bg');
{
  const tone = (bg, o = {}) => attr(render('simple', { ...clone(DEMO), bg, options: o }), 'data-tone');
  check(tone('#0f172a') === 'dark', 'bg #0f172a ⟹ data-tone=dark');
  check(tone({ stops: ['#0f172a', '#334155'] }) === 'dark', "bg {stops:['#0f172a','#334155']} ⟹ dark（toneForBg）");
  check(tone({ stops: ['#ffffff', '#f1f5f9'] }) === 'light', "对照：bg {stops:['#ffffff','#f1f5f9']} ⟹ light");
  check(tone(null, { image: 'background' }) === 'dark', 'image=background（有图）⟹ dark');
  const style = (/style="([^"]*)"/.exec(sectionTag(render('simple', { ...clone(DEMO), bg: { stops: ['#0f172a', '#334155'] } }))) || [])[1] || '';
  check(/linear-gradient/.test(style), `渐变写成 section 的 background（${style.slice(0, 60)}…）`);
  const srcTxt = fs.readFileSync(SECTION, 'utf-8');
  check(/toneForBg\(/.test(srcTxt) && !/\btoneFor\(/.test(srcTxt), 'Section.tsx 走 toneForBg、不自己算亮度');
}

// ══ image：藏东西是不渲染 ══════════════════════════════════════════════════════════════════════════
console.log('\n── image 部件');
{
  const imgs = (o) => count(render('simple', withOpts(o)), '<img');
  check(imgs({ image: 'none' }) === 0, 'image=none ⟹ 0 张 <img>（写了图也不画）');
  check(imgs({ image: 'right' }) === 1 && imgs({ image: 'left' }) === 1, 'image=left / right ⟹ 1 张');
  const cov = render('simple', withOpts({ image: 'background' }));
  check(/data-part="bg"/.test(cov) && count(cov, '<img') === 1, 'image=background ⟹ 铺底那一张（data-part=bg）');
  const noImg = { ...clone(DEMO), image: undefined, options: { image: 'right' } };
  check(count(render('simple', noImg), '<img') === 0 && attr(render('simple', noImg), 'data-tone') === 'light', '没写图 ⟹ 不画图（image=right 也一样）');
  const ctaCount = (render('simple', clone(DEMO)).match(/data-cta="/g) || []).length;
  check(ctaCount === 2, `夹具 6 条按钮 ⟹ 画 ${ctaCount} 条（== max 2）`);
}

// ══ AC10：validateSite ══════════════════════════════════════════════════════════════════════════
console.log('\n── AC10 validateSite');
{
  const run = (data) => own(manifestLib.validateSite({ pages: [{ slug: 'about', title: 'About', blocks: [{ type: 'page-header-new', data }] }] }));
  const withCrumbs = run({ headline: 'About', breadcrumbs: [{ label: 'Home', href: '/' }, { label: 'About' }] });
  check(withCrumbs.length === 1 && /"breadcrumbs"/.test(withCrumbs[0]) && /computed from the page path/.test(withCrumbs[0]),
    'data 里写了 breadcrumbs ⟹ 报一条（点名 breadcrumbs、说按页面路径算）', JSON.stringify(withCrumbs));
  const noHead = run({ subheadline: 'x' });
  check(noHead.length === 1 && /headline/.test(noHead[0]), 'headline 缺失 ⟹ 报一条', JSON.stringify(noHead));
  check(run({ headline: 'About', ctas: [1, 2, 3].map((i) => ({ label: `B${i}`, href: '#' })) }).length === 0, 'ctas 3 个不报（max 只管工具栏，同 cta-new）');
  // 演示夹具带图而 options 留空（图由预设那一组旋钮打开）⟹ 按它在图册里的样子（Photo 形态）校验。
  const demoRun = own(manifestLib.validateSite({ pages: [{ slug: 'about', title: 'About', blocks: [{ type: 'page-header-new', shape: 'photo', data: clone(DEMO) }] }] }));
  check(demoRun.length === 0, '演示夹具（Photo 形态）0 条', JSON.stringify(demoRun));
  // 反向对照：manifest 里拿掉 computed ⟹ 仍报一条（通用的「没有这个槽」），但不再说「按页面路径算」。
  // 🔴 loadManifests 按目录缓存、而且只缓存一份 ⟹ 每次改 manifest 用一个新目录；这一段之后下面各段重新取 manifest。
  const tmp = fs.mkdtempSync(path.join(NEXT, 'scripts', 'tmp-phn-blocks-'));
  try {
    fs.cpSync(path.join(NEXT, 'blocks'), tmp, { recursive: true });
    const mp = path.join(tmp, 'page-header-new', 'manifest.json');
    const mj = JSON.parse(fs.readFileSync(mp, 'utf-8')); delete mj.computed; fs.writeFileSync(mp, JSON.stringify(mj));
    const r = manifestLib.validateSite({ dir: tmp, pages: [{ slug: 'about', title: 'About', blocks: [{ type: 'page-header-new', data: { headline: 'A', breadcrumbs: [] } }] }] });
    const o = own(r);
    check(o.length === 1 && !/computed from the page path/.test(o[0]), `反向对照：manifest 拿掉 computed ⟹ 只剩通用那条、不说为什么（${o[0] && o[0].slice(0, 60)}…）—— 判据分得开`);
  } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
  const tmp2 = fs.mkdtempSync(path.join(NEXT, 'scripts', 'tmp-phn-blocks-'));
  try {
    fs.cpSync(path.join(NEXT, 'blocks'), tmp2, { recursive: true });
    const mp = path.join(tmp2, 'page-header-new', 'manifest.json');
    const mj = JSON.parse(fs.readFileSync(mp, 'utf-8')); mj.computed = { headline: 'x' }; fs.writeFileSync(mp, JSON.stringify(mj));
    let threw = ''; try { manifestLib.loadManifests(tmp2); } catch (e) { threw = e.message; }
    check(/同时是槽/.test(threw), 'manifest 把槽名写进 computed ⟹ 当场拒', threw || '没抛');
  } finally { fs.rmSync(tmp2, { recursive: true, force: true }); }
}

// ══ AC11：block-roles · 首页池 · 提示词 ═══════════════════════════════════════════════════════════
console.log('\n── AC11 block-roles · 首页池 · 提示词');
{
  const roles = JSON.parse(fs.readFileSync(path.join(SRC, 'lib', 'sections', 'block-roles.json'), 'utf-8'));
  check(roles['page-header-new'] === M.roleDefault, `block-roles.json 的 page-header-new（${roles['page-header-new']}）== manifest roleDefault（${M.roleDefault}）`);
  const recipe = require(path.join(NEXT, 'scripts', 'lib', 'homepage-recipe.js'));
  const all = manifestLib.loadManifests();
  const Mx = all.get('page-header-new');
  check(!recipe.poolFor(all).includes('page-header-new'), `poolFor(manifests) 不含 page-header-new（${recipe.poolFor(all).length} 种）`);
  check(!('page-header-new' in recipe.NOT_IN_POOL), '不在 NOT_IN_POOL（它是 page-specific，按构造不进池，名单不用点它）');
  // 反向对照：把它的 prompt.group 改成 homepage ⟹ 进池。
  const g = Mx.prompt.group; Mx.prompt.group = 'homepage';
  try { check(recipe.poolFor(all).includes('page-header-new'), '反向对照：group 改成 homepage ⟹ 它进池 —— 判据分得开'); } finally { Mx.prompt.group = g; }
  const inner = manifestLib.promptSection('page-specific');
  const line = inner.split('\n').find((l) => l.includes('"page-header-new"')) || '';
  check(/never both on one page/.test(line) && /always the first section on non-home pages/.test(line), `内页提示词里有 page-header-new 和「never both」（${line.slice(0, 90)}…）`);
  check(/do NOT write breadcrumbs/.test(inner), '提示词里写着「不要写 breadcrumbs」');
}

// ══ AC13（schema 那一半）：Puck 字段里没有面包屑 ════════════════════════════════════════════════════
console.log('\n── AC13 编辑器 schema');
{
  const { editorSchema } = require(path.join(NEXT, 'scripts', 'lib', 'editor-schema.js'));
  const on = editorSchema({}).components.find((c) => c.type === 'page-header-new');
  check(!!on, 'Puck 组件里有 page-header-new（能从左栏拖进页面）');
  const order = on.fields.map((f) => f.slot);
  check(JSON.stringify(order) === JSON.stringify(['options', 'introEyebrow', 'headline', 'subheadline', 'ctas', 'bg']),
    `字段顺序 = 旋钮 → eyebrow → 内容 → bg；没有 breadcrumbs（${order.join(' → ')}）`);
}

// ══ AC14：零改动 / SubPage 只两处 ═════════════════════════════════════════════════════════════════
console.log('\n── AC14 旧块 / create-site / keyword-page-options 零改动，SubPage 只两处');
{
  let base = '';
  try { base = execFileSync('git', ['merge-base', 'HEAD', 'origin/main'], { cwd: REPO, encoding: 'utf-8' }).trim(); } catch (e) { /* 下面报 */ }
  if (!base) {
    console.log('  ⚠️  取不到 merge-base（没有 git / 没有 origin/main），这一段跳过 —— 不算通过');
  } else {
    const diff = (...p) => execFileSync('git', ['diff', base, '--', ...p], { cwd: REPO, encoding: 'utf-8' });
    check(diff('templates/nextjs/blocks/page-header') === '', 'blocks/page-header/ 与 merge-base 逐字相同');
    check(diff('templates/nextjs/scripts/create-site.js', 'templates/nextjs/scripts/lib/keyword-page-options.js') === '', 'create-site.js / keyword-page-options.js 零改动');
    const d = diff('templates/nextjs/src/components/pages/SubPage.tsx');
    const plus = d.split('\n').filter((l) => l.startsWith('+') && !l.startsWith('+++')).map((l) => l.slice(1).trim());
    const WANT_PLUS = [
      "import { breadcrumbsFor } from '@/lib/breadcrumbs';",
      'const breadcrumbItems = breadcrumbsFor(slug, locale).map((c) => ({ name: c.label, url: c.url }));',
      '<SectionRenderer blocks={page.blocks} locale={locale} iconTables={iconTablesFor(page.blocks)} pageSlug={slug} />',
    ];
    check(JSON.stringify(plus) === JSON.stringify(WANT_PLUS), 'SubPage.tsx 新增的只有：import · 结构化数据改调 breadcrumbsFor · 把 slug 传给块', JSON.stringify(plus));
  }
}

console.log(`\n══ 汇总: 通过 ${pass} · 失败 ${fail} ══`);
process.exit(fail ? 1 : 0);
