#!/usr/bin/env node
/**
 * reviews-render.test.js — #1504 验收里「看渲染出来的 HTML / 调一次校验器就能判」的那几条。
 *
 * 跑法:  node scripts/reviews-render.test.js   （或 `npm run test:scripts`，它按文件名发现）
 * 退出码: 0 全过 · 1 有失败 · 2 跑不起来（**不许当成通过**）
 *
 * 管哪几条：AC1（3 个预设逐字、旋钮名 / 值逐字、目录集合、两两不同、旋钮独立）· AC3（总分）· AC4 的 DOM 一半（logo 三档）·
 * AC7（itemAlign 不跟 introAlign）· AC8（星数）· AC9（链接）· AC10 的 DOM 一半（data-tone）· AC11（validateSite）·
 * AC12（block-roles · 首页配方池）· AC14 的编辑器 schema 一半· 图标表 · 不生成图。
 * 几何与计算色（16 种组合三端无横向滚动、列数、row 对齐、品牌色 / 反白）要浏览器：`tests/e2e/specs/1504-reviews-new-knobs.spec.ts`。
 *
 * 🔴 每一段都带反向对照（同一进程、单变量），证明判据真会红。
 * 夹具定死：演示内容包里的 Northside Auto Care（`scripts/lib/demo-content`，正文做什么 8）。
 */

'use strict';

const fs = require('fs');
const path = require('path');
const Module = require('module');
const ts = require('typescript');
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');

const NEXT = path.resolve(__dirname, '..');
const SRC = path.join(NEXT, 'src');
const BLOCK = path.join(NEXT, 'blocks', 'reviews');
const SECTION = path.join(BLOCK, 'Section.tsx');

let pass = 0;
let fail = 0;
const ok = (m) => { pass += 1; console.log(`  ✅ ${m}`); };
const bad = (m) => { fail += 1; console.log(`  ❌ ${m}`); };
const die = (m) => { console.error(`🔴 跑不起来: ${m}`); process.exit(2); };
const check = (cond, m, detail) => (cond ? ok(m) : bad(detail ? `${m} —— ${detail}` : m));

// ── 让 node 能 require 这份 .tsx（同 testimonials-render.test.js）─────────────────────────────────
const sourceOverride = new Map();
for (const ext of ['.tsx', '.ts']) {
  require.extensions[ext] = (mod, filename) => mod._compile(ts.transpileModule(sourceOverride.get(filename) ?? fs.readFileSync(filename, 'utf-8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true, resolveJsonModule: true },
    fileName: filename,
  }).outputText, filename);
}
const origResolve = Module._resolveFilename;
Module._resolveFilename = function resolve(req, ...rest) {
  if (req.startsWith('@/')) return origResolve.call(this, path.join(SRC, req.slice(2)), ...rest);
  return origResolve.call(this, req, ...rest);
};

function loadSection(override) {
  delete require.cache[SECTION];
  if (override) sourceOverride.set(SECTION, override); else sourceOverride.delete(SECTION);
  return require(SECTION).default;
}

let C; let DEMO; let manifestLib; let M; let icons; let platforms;
try {
  C = loadSection();
  DEMO = require(path.join(NEXT, 'scripts', 'lib', 'demo-content')).DEMO_CONTENT['reviews'];
  manifestLib = require(path.join(NEXT, 'scripts', 'lib', 'block-manifest.js'));
  M = manifestLib.loadManifests().get('reviews');
  icons = require(path.join(NEXT, 'scripts', 'lib', 'icons.js'));
  platforms = require(path.join(NEXT, 'scripts', 'lib', 'review-platforms.js'));
} catch (e) { die(`载入失败: ${e.message}`); }
if (!DEMO) die('demo-content 里没有 reviews');
if (!M) die('blocks/ 里没有 reviews');

const clone = (v) => JSON.parse(JSON.stringify(v));
const TABLE = icons.iconTableFor('reviews', DEMO, { warn: () => {} });
const render = (shape, data, Comp = C, iconTable = TABLE) => renderToStaticMarkup(React.createElement(Comp, {
  data, locale: 'en', iconTable, block: { id: 'r', type: 'reviews', shape, data: {} },
}));
const withOpts = (o, extra = {}, base = DEMO) => ({ ...clone(base), ...extra, options: { ...(base.options || {}), ...o } });
const count = (html, needle) => html.split(needle).length - 1;
const own = (r) => r.problems.filter((p) => p.includes('("reviews")'));
const sectionTag = (html) => (/<section[^>]*>/.exec(html) || [''])[0];
const attr = (html, name) => { const m = new RegExp(`\\s${name}="([^"]*)"`).exec(sectionTag(html)); return m ? m[1] : null; };
const itemsOf = (html) => html.split('data-part="item"').slice(1);
const itemsRegion = (html) => html.slice(html.indexOf('data-part="items"'));
const totalOf = (html) => { const i = html.indexOf('data-part="total"'); return i < 0 ? '' : html.slice(i, html.indexOf('data-part="items"')); };
// #1535 —— 块头排版由 manifest 的 introLayout 生成（scripts/block-build/intro-layout.js），拼在 block.css 前面；
//    这里读的是两份拼起来的那一段，负向断言（「没有一条按 data-intro-align …」）才看得见生成物（#1535 QA1 F1）。
const CSS = require('./block-build/intro-layout').introLayoutCss(JSON.parse(fs.readFileSync(path.join(BLOCK, 'manifest.json'), 'utf-8')), 'reviews')
  + '\n' + fs.readFileSync(path.join(BLOCK, 'block.css'), 'utf-8');
const SRC_TEXT = fs.readFileSync(SECTION, 'utf-8');
const KNOB_NAMES = ['introPosition', 'introAlign', 'total', 'itemsLayout', 'itemStyle', 'itemAlign'];
const dataAttr = (n) => `data-${n.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`)}`;

// ══ AC1：3 个预设逐字、旋钮名 / 值逐字、目录集合、两两不同、旋钮独立 ═══════════════════════════════
console.log('── AC1 三个预设');
{
  // 列：名字 · 形态目录 · 六列旋钮（正文预设表逐字）
  const WANT = [
    ['Cards', 'cards', 'top', 'center', 'none', 'grid', 'card', 'center'],
    ['Side score', 'side-score', 'left', 'left', 'show', 'grid', 'card', 'center'],
    ['Strip', 'strip', 'top', 'center', 'none', 'row', 'card', 'center'],
  ];
  const got = (M.presets || []).map((p) => [p.name, p.shape, ...KNOB_NAMES.map((c) => p.knobs[c])]);
  check(JSON.stringify(got) === JSON.stringify(WANT), 'presets 3 条与正文表逐字相同（名字 · 形态 · 六列旋钮）', JSON.stringify(got));
  check((M.presets || []).every((p) => Object.keys(p.knobs).join() === KNOB_NAMES.join()), '每个预设的 knobs 键就是这六个、同一顺序');
  const knobs = M.slots.options.knobs.map((k) => [k.name, k.values]);
  check(JSON.stringify(knobs) === JSON.stringify([
    ['introPosition', ['left', 'right', 'top', 'bottom']], ['introAlign', ['left', 'center', 'right']], ['total', ['none', 'show']],
    ['itemsLayout', ['grid', 'row']], ['itemStyle', ['plain', 'card']], ['itemAlign', ['left', 'center', 'right']],
  ]), `slots.options.knobs 名字依次 ${knobs.map((k) => k[0]).join(' / ')}、values 与定稿表逐字（values[0] = 默认）`);
  check(M.slots.options.knobs.every((k) => k.default === undefined), '没有显式 default（默认 = values[0]）');
  const dirs = fs.readdirSync(BLOCK, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name).sort();
  check(JSON.stringify(dirs) === JSON.stringify(WANT.map((w) => w[1]).sort()), `目录集合 == 3 个预设形态（${dirs.join(' / ')}）`);
  check(dirs.every((d) => !fs.existsSync(path.join(BLOCK, d, 'Section.tsx'))), '一份 Section.tsx（形态目录里没有第二份 markup）');
  check(M.skin === 'site-css' && M.roleDefault === 'optional', `skin=${M.skin} · roleDefault=${M.roleDefault}`);
  check(M.parts === undefined, '没有 parts（工具栏不派生部件那一维）');
  const htmls = dirs.map((d) => render(d, clone(DEMO)));
  check(new Set(htmls).size === 3, `同一份夹具下 3 个预设渲染出 ${new Set(htmls).size} 份互不相同的 HTML`);
  const pinned = dirs.map((d) => render(d, withOpts(M.presets[0].knobs)).replace(/data-shape="[^"]*"/g, ''));
  check(new Set(pinned).size === 1, '反向对照：options 里写死六个旋钮 ⟹ 3 个预设（去掉 data-shape 之后）塌成同一份 —— 判据分得开');
  const r = render('cards', clone(DEMO));
  const miss = KNOB_NAMES.filter((n) => attr(r, dataAttr(n)) !== M.presets[0].knobs[n]);
  check(miss.length === 0, 'Cards：六个旋钮都写在 <section> 上', miss.join(' · '));
  const base = M.presets[1].knobs;
  const moved = [];
  for (const k of M.slots.options.knobs) {
    for (const v of k.values) {
      const h = render('side-score', withOpts({ [k.name]: v }));
      const others = KNOB_NAMES.filter((n) => n !== k.name);
      if (attr(h, dataAttr(k.name)) !== v || others.some((n) => attr(h, dataAttr(n)) !== base[n])) moved.push(`${k.name}=${v}`);
    }
  }
  check(moved.length === 0, `旋钮独立（Side score 上逐个拧 ${M.slots.options.knobs.reduce((n, k) => n + k.values.length, 0)} 档）：拧的那个到位、其余五个不变`, moved.join(' · '));
  check(/style="--rv-n:4"/.test(r) && /style="--rv-n:1"/.test(render('cards', { ...clone(DEMO), platforms: [DEMO.platforms[0]] })), 'grid 列数按平台个数：.rv-items 上写 --rv-n（4 个 ⟹ 4、1 个 ⟹ 1）');
}

// ══ AC3：总分块自己算 ═══════════════════════════════════════════════════════════════════════════════
console.log('\n── AC3 总分');
{
  const show = render('side-score', clone(DEMO));
  const t = totalOf(show);
  check(/<span class="rv-total-score[^"]*">4\.9<\/span>/.test(t) && t.includes('405 reviews on 4 platforms') && count(t, 'data-icon="star-fill"') === 5,
    `夹具 ⟹ 总分 4.9、「405 reviews on 4 platforms」、5 颗星（星 ${count(t, 'data-icon="star-fill"')}）`);
  const one = render('side-score', { ...clone(DEMO), platforms: [DEMO.platforms[0]] });
  check(/>4\.9<\/span>/.test(totalOf(one)) && totalOf(one).includes('312 reviews on Google'), '只留 Google 一项 ⟹ 4.9、「312 reviews on Google」');
  check(count(render('cards', clone(DEMO)), 'data-part="total"') === 0 && count(render('side-score', withOpts({ total: 'none' })), 'data-part="total"') === 0,
    'total=none ⟹ 没有总分节点（Cards 预设 · Side score 拧成 none 都是）');
  // 加权 vs 算术平均分得开：Google 4.0 × 300 + Yelp 5.0 × 10 ⟹ 加权 4.0、算术 4.5。
  const skew = render('side-score', { ...clone(DEMO), platforms: [{ source: 'Google', rating: 4.0, count: 300 }, { source: 'Yelp', rating: 5.0, count: 10 }] });
  check(/>4\.0<\/span>/.test(totalOf(skew)) && totalOf(skew).includes('310 reviews on 2 platforms'), '按条数加权（4.0 × 300 + 5.0 × 10 ⟹ 4.0，不是算术平均 4.5）');
  const flat = loadSection(SRC_TEXT.replace('p.rating * p.count, 0) / totalCount', 'p.rating, 0) / platforms.length'));
  const sk2 = renderToStaticMarkup(React.createElement(flat, { data: { ...clone(DEMO), platforms: [{ source: 'Google', rating: 4.0, count: 300 }, { source: 'Yelp', rating: 5.0, count: 10 }] }, iconTable: TABLE, block: { id: 'r', type: 'reviews', shape: 'side-score', data: {} } }));
  loadSection();
  check(/>4\.5<\/span>/.test(totalOf(sk2)), '反向对照：改成算术平均 ⟹ 读到 4.5（上面那格会红）');
  check(!('total' in M.slots) && !/overallRating|totalReviews/.test(JSON.stringify(M.slots)), '总分不是槽（slots 里没有 total / overallRating / totalReviews）');
}

// ══ AC4（DOM 一半）：logo 三档 ═══════════════════════════════════════════════════════════════════
console.log('\n── AC4 logo 三档');
{
  const its = itemsOf(render('cards', clone(DEMO)));
  const by = (src) => its.find((x) => x.startsWith(` data-source="${src}"`)) || '';
  check(/data-logo="icon"[^>]*style="--rv-brand:#4285F4"/.test(by('Google')) && /<svg[^>]*data-icon="google"/.test(by('Google')),
    'Google 那格：内置图标 google（data-icon）、品牌色 #4285F4（计算色在 e2e 里量）');
  check(/data-icon="yelp"/.test(by('Yelp')) && /--rv-brand:#d32323/.test(by('Yelp')), 'Yelp 那格：yelp 图标、#d32323');
  check(/data-icon="facebook"/.test(by('Facebook')) && /--rv-brand:#1877F2/.test(by('Facebook')), 'Facebook 那格：facebook 图标、#1877F2');
  check(!/<svg/.test(by('HomeStars').split('data-part="score"')[0]) && /data-logo="name" data-slot="platforms\.2\.source">HomeStars</.test(by('HomeStars')), 'HomeStars：没有图标、写粗体平台名');
  const up = clone(DEMO); up.platforms[2].logoUrl = 'https://cdn.example.com/homestars.svg';
  const hs = itemsOf(render('cards', up))[2];
  check(/data-logo="image"[\s\S]*<img src="https:\/\/cdn\.example\.com\/homestars\.svg" alt="HomeStars"/.test(hs), '给 HomeStars 加 logoUrl ⟹ <img alt="HomeStars">');
  const upG = clone(DEMO); upG.platforms[0].logoUrl = 'https://cdn.example.com/g.png';
  check(/data-logo="image"/.test(itemsOf(render('cards', upG))[0]) && !/data-icon="google"/.test(itemsOf(render('cards', upG))[0]), '上传图优先于内置图标（Google 也给了 logoUrl ⟹ 用上传的）');
  const sp = clone(DEMO); sp.platforms[0].source = ' google ';
  check(/data-icon="google"/.test(itemsOf(render('cards', sp))[0]), 'source: " google " 也命中图标（忽略大小写和首尾空格）');
  const names = its.map((x) => ['Google', 'Yelp', 'HomeStars', 'Facebook'].find((n) => x.replace(/<[^>]+>/g, ' ').includes(n)));
  check(names.join() === 'Google,Yelp,HomeStars,Facebook' && its.slice(0, 2).every((x) => /<span class="visually-hidden" data-slot="platforms\.[01]\.source">(Google|Yelp)<\/span>/.test(x)),
    '每格的 DOM 里都有文字平台名（图标那两档是 visually-hidden）');
  check(Object.values(platforms.PLATFORM_ICONS).every((p) => fs.existsSync(path.join(icons.ICON_DIR, `${p.icon}.svg`))),
    `review-platforms.js 表里的图标文件都真的在（${Object.values(platforms.PLATFORM_ICONS).map((p) => p.icon).join(' / ')}）`);
  check(platforms.platformLogo('Trustpilot', '').kind === 'name' && platforms.platformLogo('YELP', '').kind === 'icon', '对照：表外平台 ⟹ name；大小写不同 ⟹ 仍命中');
}

// ══ AC7：itemAlign 不跟 introAlign ═══════════════════════════════════════════════════════════════
console.log('\n── AC7 itemAlign 不跟 introAlign');
{
  const regions = ['left', 'center', 'right'].map((a) => itemsRegion(render('cards', withOpts({ introAlign: a }))));
  check(new Set(regions).size === 1, 'introAlign 拧遍三个值 ⟹ 平台区域渲染 HTML 逐字不变');
  const r2 = ['left', 'center', 'right'].map((a) => render('cards', withOpts({ itemAlign: a })));
  check(new Set(r2.map((h) => attr(h, 'data-item-align'))).size === 3 && new Set(r2.map((h) => attr(h, 'data-intro-align'))).size === 1, '对照：拧 itemAlign 只动 data-item-align');
  check(/\[data-items-layout="row"\]\[data-item-align="right"\] \.rv-items \{\s*justify-content: flex-end;/.test(CSS)
    && /\[data-items-layout="grid"\]\[data-item-align="center"\] \.rv-item \{\s*align-items: center;/.test(CSS)
    && !/data-intro-align[^{]*\.rv-item\b/.test(CSS), 'block.css：items 的对齐只挂在 data-item-align 上，没有一条按 data-intro-align 排平台');
}

// ══ AC8：星数 ═══════════════════════════════════════════════════════════════════════════════════
console.log('\n── AC8 星数');
{
  const starsFor = (rating) => {
    const h = render('cards', { ...clone(DEMO), platforms: [{ source: 'Google', rating, count: 10 }] });
    const it = itemsOf(h)[0];
    return count(it, 'data-icon="star-fill"');
  };
  const got = [4.9, 4.5, 4.4].map(starsFor);
  check(got.join() === '5,5,4', `rating 4.9 / 4.5 / 4.4 ⟹ ${got.join(' / ')} 颗实心星（要 5 / 5 / 4）`);
  check(starsFor(0) === 0 && starsFor(5) === 5, '0 ⟹ 0 颗、5 ⟹ 5 颗（不补空星、不画半颗）');
  check(!/star-half|"star"/.test(SRC_TEXT.replace(/^\s*\/\/.*$/gm, '')), 'Section.tsx 不用 star-half / 空心 star');
}

// ══ AC9：链接 ═════════════════════════════════════════════════════════════════════════════════════
console.log('\n── AC9 链接');
{
  const h = render('cards', clone(DEMO));
  check(/<a class="rv-item[^"]*" data-part="item" data-source="Google" href="https:\/\/www\.google\.com\/maps" target="_blank" rel="noopener">/.test(h), 'Google（有 href）那格整格是 <a target="_blank" rel="noopener">');
  check(count(h, '<a ') === 1 && itemsOf(h).slice(1).every((x) => !/href=/.test(x.split('</div>')[0])), '其余三格（没 href）不是链接');
}

// ══ AC10（DOM 一半）：bg ════════════════════════════════════════════════════════════════════════
console.log('\n── AC10 bg（计算色在 e2e 里量）');
{
  const at = (bg) => render('cards', withOpts({}, { bg }));
  check(attr(at('#0f172a'), 'data-tone') === 'dark' && /style="background:#0f172a"/.test(sectionTag(at('#0f172a'))), '#0f172a ⟹ data-tone="dark"、<section> 底色 #0f172a');
  check(attr(at({ stops: ['#0f172a', '#334155'] }), 'data-tone') === 'dark', '深色渐变 [#0f172a, #334155] ⟹ dark');
  check(attr(at({ stops: ['#ffffff', '#f1f5f9'] }), 'data-tone') === 'light', '对照：浅色渐变 [#ffffff, #f1f5f9] ⟹ light');
  check(attr(at('brand'), 'data-tone') === 'brand' && attr(at(undefined), 'data-tone') === 'light' && !/\sstyle=/.test(sectionTag(at(undefined))), 'brand ⟹ brand；没写 bg ⟹ light、没有 style');
  check(count(SRC_TEXT, 'toneFor(') === 0 && count(SRC_TEXT, 'linear-gradient') === 0 && /<BlockSection[\s\S]*?\bbg=\{d\.bg\}/.test(SRC_TEXT),
    `Section.tsx 把 bg 交给 <BlockSection>（深浅 / 底色由它调 contrast.js 的 toneForBg / bgCss，#1534）；自己 toneFor( ${count(SRC_TEXT, 'toneFor(')} 处、linear-gradient ${count(SRC_TEXT, 'linear-gradient')} 处`);
  check(/\[data-tone="dark"\] \.rv-icon,[\s\S]*?\{\s*color: #fff !important;/.test(CSS) && /\[data-tone="dark"\]\[data-item-style="card"\] \.rv-item,[\s\S]*?\{\s*background: rgba\(255, 255, 255, 0\.08\);/.test(CSS),
    'block.css：深底品牌图标 / 分数反白；card 底 rgba(255,255,255,.08)');
  check(!/\.text-muted\s*\{[^}]*rgba\(255, 255, 255/.test(CSS), '条数白 .92 走全站那条（site-css.js §ON_DEEP_MUTED），block.css 里没有自己那份');
  check(JSON.stringify(M.slots.bg) === JSON.stringify(manifestLib.loadManifests().get('footer').slots.bg), 'bg 槽对象与 footer 的 slots.bg 逐字相同');
}

// ══ AC11：validateSite ══════════════════════════════════════════════════════════════════════════
console.log('\n── AC11 validateSite');
{
  const pf = (i, extra = {}) => ({ source: `Site ${i}`, rating: 4.5, count: 10, ...extra });
  const v = (data) => own(manifestLib.validateSite({ pages: [{ slug: 'p', blocks: [{ type: 'reviews', data: { headline: 'H', ...data } }] }], scope: 'edit' }));
  for (const n of [0, 5]) {
    const r = v({ platforms: Array.from({ length: n }, (_, i) => pf(i)) });
    check(r.length >= 1 && r.every((p) => p.includes('platforms')) && r.some((p) => p.includes(n ? '最多只能有 4 项' : '至少要 1 项')), `platforms ${n} 个 ⟹ 被拦、报错点名 platforms`, JSON.stringify(r));
  }
  for (const n of [1, 4]) check(v({ platforms: Array.from({ length: n }, (_, i) => pf(i)) }).length === 0, `platforms ${n} 个 ⟹ 放行`);
  const r6 = v({ platforms: [pf(0, { rating: 6 })] });
  check(r6.length === 1 && r6[0].includes('platforms[0].rating'), 'rating: 6 ⟹ 报一条（点名 platforms[0].rating）', JSON.stringify(r6));
  const rc = v({ platforms: [pf(0, { count: -1 })] });
  check(rc.length === 1 && rc[0].includes('platforms[0].count'), 'count: -1 ⟹ 报一条（点名 platforms[0].count）', JSON.stringify(rc));
  check([4.95, '4.9', -0.1].every((x) => v({ platforms: [pf(0, { rating: x })] }).length === 1), 'rating 4.95（两位小数）/ "4.9"（字符串）/ -0.1 ⟹ 各报一条');
  check([0, 4.9, 5, 3].every((x) => v({ platforms: [pf(0, { rating: x })] }).length === 0), 'rating 0 / 4.9 / 5 / 3 ⟹ 放行（一位小数以内）');
  check([0, 2.5, '12'].every((x) => v({ platforms: [pf(0, { count: x })] }).length === 1) && v({ platforms: [pf(0, { count: 100000 })] }).length === 0, 'count 0 / 2.5 / "12" ⟹ 各报一条；100000 放行（不设上限）');
  check(JSON.stringify(M.slots.platforms.ranges) === '{"rating":[0,5,1],"count":[1,null]}', '判据从 manifest 读：slots.platforms.ranges == {"rating":[0,5,1],"count":[1,null]}');
  // #1488 的两个数写法照旧：testimonials rating 4.5 仍被拦（整数）。
  check(manifestLib.validateSite({ pages: [{ slug: 'p', blocks: [{ type: 'testimonials', data: { headline: 'H', items: [{ quote: 'q', name: 'n', rating: 4.5 }] } }] }], scope: 'edit' })
    .problems.some((p) => p.includes('items[0].rating') && p.includes('整数')), '#1488 的两个数写法意思不变：testimonials rating 4.5 仍报「整数」');
  // 声明本身被校验：写歪了 manifest 当场拒。
  const tmp = fs.mkdtempSync(path.join(require('os').tmpdir(), 'rv-ranges-'));
  try {
    const load = (ranges) => {
      const dir = path.join(tmp, String(Math.random()).slice(2));
      fs.cpSync(BLOCK, path.join(dir, 'reviews'), { recursive: true });
      const mf = path.join(dir, 'reviews', 'manifest.json');
      const j = JSON.parse(fs.readFileSync(mf, 'utf-8')); j.slots.platforms.ranges = ranges; fs.writeFileSync(mf, JSON.stringify(j));
      try { manifestLib.loadManifests(dir); return ''; } catch (e) { return e.message; }
    };
    check(/ranges\.rating/.test(load({ rating: [0, 5, 'one'] })) && /ranges\.rating/.test(load({ rating: [0, 5, 9] })) && /ranges\.count/.test(load({ count: [null, 5] })),
      '小数位写成字符串 / 超过 3、最小写 null ⟹ manifest 当场被拒');
    check(load({ rating: [0, 5, 1], count: [1, null] }) === '' && load({ rating: [1, 5] }) === '', '对照：[0, 5, 1] · [1, null] · 两个数的老写法 ⟹ 载得进');
  } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
  for (const p of M.presets) check(v({ ...clone(DEMO), options: p.knobs }).length === 0, `预设 ${p.name} 那组值（六个旋钮写全）+ 演示内容 ⟹ 放行`);
}

// ══ 图标：星 / 品牌图标真画成 <svg>（BLOCK_ICONS 那一行）· logo 不生成图 ═══════════════════════════════
console.log('\n── 图标 · 不生成图');
{
  const want = ['star-fill', 'google', 'yelp', 'facebook'];
  check(JSON.stringify(icons.BLOCK_ICONS['reviews']) === JSON.stringify(want) && want.every((n) => TABLE[n]), `BLOCK_ICONS['reviews'] == ${want.join(' / ')}，表里都查得到`);
  const h = render('cards', clone(DEMO));
  check(itemsOf(h).every((x, i) => (x.match(/data-icon="star-fill"/g) || []).length === [5, 5, 5, 5][i]), '四格各 5 颗内联星（4.9 / 4.8 / 4.7 / 5.0 四舍五入都是 5）');
  check(count(render('cards', clone(DEMO), C, {}), '<svg') === 0, '对照：不给图标表 ⟹ 一个 <svg> 都没有（图标全靠服务端那张表）');
  // 📌 #1425（T3）—— 反向臂原来拿旧 social-proof；它随旧库删了，换成今天库里真不用图标表的 gallery。
  check(icons.usesIconTable('reviews') && !icons.usesIconTable('gallery'), 'usesIconTable：reviews 用、gallery（不画图标的块）不用');
  const slots = JSON.stringify(manifestLib.imageSlotsOf(M));
  check(slots === '[]', `imageSlotsOf(reviews) == []：logoUrl 不是内容图，建站不给平台生成 logo（${slots}）`);
  const urls = require(path.join(NEXT, 'scripts', 'lib', 'image-urls.js'));
  const f = urls.collectImagePositions({ platforms: [{ source: 'HomeStars', logoUrl: 'https://uploads.example/hs.png' }] });
  check(f.length === 1 && f[0] === 'https://uploads.example/hs.png', `写入闸认得 platforms[].logoUrl（读到 ${JSON.stringify(f)}）`);
}

// ══ AC12：block-roles · 首页配方 ══════════════════════════════════════════════════════════════════
console.log('\n── AC12 block-roles · 首页配方');
{
  const roles = JSON.parse(fs.readFileSync(path.join(SRC, 'lib', 'sections', 'block-roles.json'), 'utf-8'));
  check(roles['reviews'] === M.roleDefault, `block-roles.json 的 reviews（${roles['reviews']}）== manifest roleDefault（${M.roleDefault}）`);
  const recipe = require(path.join(NEXT, 'scripts', 'lib', 'homepage-recipe.js'));
  const all = manifestLib.loadManifests();
  const pool = recipe.poolFor(all);
  // 📌 #1425（T3）—— 这里原来测「social-proof 在 NOT_IN_POOL、拿掉它两个都进池」；social-proof 随旧库删了。今天的不变量：reviews 在池里、池子 11 种、排除名单不点它。
  check(pool.includes('reviews') && !('reviews' in recipe.NOT_IN_POOL) && pool.length === 11, `poolFor 含 reviews、reviews 不在 NOT_IN_POOL、池子 11 种（读到 ${pool.length}）`);
  // 反向对照：把 reviews 放进排除名单 ⟹ 它出池、种数 -1 —— 判据分得开。
  recipe.NOT_IN_POOL['reviews'] = 'test';
  let outPool;
  try { outPool = recipe.poolFor(all); } finally { delete recipe.NOT_IN_POOL['reviews']; }
  check(!outPool.includes('reviews') && outPool.length === pool.length - 1, `反向对照：排除 reviews ⟹ 它出池、种数 ${pool.length} → ${outPool.length}（-1）`);
  const without = recipe.poolFor(new Map([...all].filter(([k]) => k !== 'reviews')));
  check(without.length === pool.length - 1 && !without.includes('reviews'), `对照：块库里没有 reviews ⟹ 池子少一种（${without.length}）`);
  check(M.prompt.group === 'homepage' && M.prompt.order === 10, `prompt.group == homepage、order ${M.prompt.order}（== 10）`);
  const lines = M.prompt.lines.join('\n');
  check(/logoUrl only when the owner uploaded/.test(lines) && /leave this block out/.test(lines) && /never write the overall score/.test(lines)
    && /testimonials/.test(lines) && /only one place on a page/.test(lines) && /top-level in data \(not inside options\)/.test(lines),
    'prompt.lines：logoUrl 只在有上传图时写、编不出数就不放、总分不写、原话归 testimonials、同一页只一处、bg 在 data 顶层');
  check(!/\b4\.\d\b|\b\d{2,}\b/.test(lines), '提示词里没有可被照抄的示例数字（#1488 QA2 踩过：AI 原样抄了示例的 4.9 / 312）');
}

// ══ AC14（编辑器 schema 一半；往返无损由 editor-roundtrip.test.js 对全部页面块量）═══════════════════════
console.log('\n── AC14 编辑器 schema');
{
  const { editorSchema } = require(path.join(NEXT, 'scripts', 'lib', 'editor-schema.js'));
  const { presetNameFor } = require(path.join(NEXT, 'scripts', 'lib', 'block-knobs.js'));
  const on = editorSchema({}).components.find((c) => c.type === 'reviews');
  check(!!on, 'Puck 组件里有 reviews（能从左栏拖进页面）');
  const order = on ? on.fields.map((f) => f.slot) : [];
  check(JSON.stringify(order) === JSON.stringify(['options', 'introEyebrow', 'headline', 'body', 'platforms', 'bg']), `字段顺序 = 旋钮 → 眉标 → 块头 → platforms → bg（${order.join(' → ')}）`);
  const opt = on && on.fields[0];
  check(!!opt && opt.control === 'options' && opt.presets.map((p) => p.name).join() === M.presets.map((p) => p.name).join() && opt.knobs.map((k) => k.name).join() === KNOB_NAMES.join(), '第一个字段：预设 3 个 → 六个旋钮');
  const pl = on && on.fields.find((f) => f.slot === 'platforms');
  check(!!pl && pl.control === 'list' && pl.subs.map((x) => x.sub).join() === 'source,rating,count', `platforms 是列表字段、每项可改 source / rating / count（${pl ? pl.subs.map((x) => x.sub).join(' / ') : '—'}）`);
  const man = { slots: { options: { knobs: opt.knobs } }, presets: opt.presets };
  check(presetNameFor(man, M.presets[2].knobs) === 'Strip' && presetNameFor(man, { ...M.presets[2].knobs, itemStyle: 'plain' }) === 'custom', '点 Strip = 那一组旋钮；拧偏一个（itemStyle=plain）⟹ custom');
}

// 📌 #1425（T3）—— 这里原来测 AC15「blocks/social-proof 相对 merge-base 与工作区零改动」；social-proof 随旧库删了。

console.log(`\n══ 汇总: 通过 ${pass} · 失败 ${fail} ══`);
process.exit(fail ? 1 : 0);
