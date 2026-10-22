#!/usr/bin/env node
/**
 * multi-location-reviews.test.js — #1981（Epic:MultiLocation T6）：结构化数据每个地点一份、评价标上地点名、块头 Google 总分按条数加权。
 *
 * 跑法:  node scripts/multi-location-reviews.test.js   （或 `npm run test:scripts`，它按文件名发现）
 * 退出码: 0 全过 · 1 有失败 · 2 跑不起来（不许当成通过）
 *
 * 管哪几条：
 *   AC1 —— 三地点站真渲染一次（`site.js bundle` + `render`）：每页 3 份 LocalBusiness、`@id` 各不相同、第二份的评分是第二家的、
 *          第三家没有营业时间 ⟹ 第三份没有 openingHoursSpecification；`check-jsonld.js --site` 对它 0 处问题；
 *          同一次渲染顺带 AC4 的显示一半（评价名字后有那家的名称、id 找不到不画、单地点不画）。
 *          check-jsonld 的逐份核对自己会红（少一份 / @id 重复 / 第二份评分对不上），单测在 §check-jsonld 那一段。
 *   AC3 —— 建站 AI 之后那一步（`lib/review-facts.js` §applyReviewFacts），喂一份假的 AI 页面。
 *   AC6 —— 编辑器里那格 Location，两份 EditorApp（模板的 `src/components/editor/` 与 dashboard 的 `dashboard/src/editor/`）各跑一次。
 *          🔴 dashboard 那份在 CI 上只有模板的 node_modules（template-scripts 那一格只在 templates/nextjs 里 npm ci）：
 *             它 import 的裸包一律按模板目录解析，dashboard 自己的模块（`@/…`）与 antd 换成替身 —— 本机多装了什么都不影响读数。
 *   两地点夹具里每家的 id 故意不跟位置同形（不是 loc-0 / loc-1）：「按位置拼出 id」的错写法过不了这几格。
 */
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const cp = require('child_process');
const Module = require('module');

const NEXT = path.resolve(__dirname, '..');
const REPO = path.resolve(NEXT, '..', '..');
const SRC = path.join(NEXT, 'src');
const DASH_SRC = path.join(REPO, 'dashboard', 'src');

let pass = 0;
let fail = 0;
const ok = (m) => { pass += 1; console.log(`  ✅ ${m}`); };
const bad = (m) => { fail += 1; console.log(`  ❌ ${m}`); };
const die = (m) => { console.error(`🔴 跑不起来: ${m}`); process.exit(2); };
const check = (cond, m, detail) => (cond ? ok(m) : bad(detail ? `${m} —— ${detail}` : m));
const clone = (v) => JSON.parse(JSON.stringify(v));

let ts; let React; let renderToStaticMarkup; let K; let RF;
try {
  ts = require('typescript');
  React = require('react');
  ({ renderToStaticMarkup } = require('react-dom/server'));
  K = require('./check-jsonld');
  RF = require('./lib/review-facts');
} catch (e) { die(`加载不起来（在 templates/nextjs 里跑 npm ci）：${e.message}`); }

const LD_RE = /<script[^>]*type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/g;
const lbsOf = (html) => [...html.matchAll(LD_RE)].map((m) => JSON.parse(m[1])).filter((n) => n && n['@type'] === 'LocalBusiness');

// ══ AC1 + AC4 显示一半：真渲染 ═══════════════════════════════════════════════════════════════════════
console.log('══ #1981 多地点：结构化数据 · 评价的地点 · 块头总分 ══');
console.log('\n── AC1 三地点站：每页每个地点一份 LocalBusiness（site.js render 真渲染）');
{
  const SITE_JS = path.join(__dirname, 'site.js');
  const FX = path.join(__dirname, 'fixtures', 'site-fixtures', 'site-rated.json');
  const bundleDir = path.join(NEXT, 'render', 'dist', `test-1981-${process.pid}`);
  const work = fs.mkdtempSync(path.join(os.tmpdir(), 'ml-reviews-'));
  const HOURS = (days) => [{ days, opens: '09:00', closes: '17:00' }];
  const three = clone(JSON.parse(fs.readFileSync(FX, 'utf-8')));
  three['brand.json'].locations = [
    { id: 'loc-k9n2', label: 'Downtown', address: '123 Demo Street, Toronto, ON', phone: '416-555-0000', city: 'Toronto', streetAddress: '123 Demo Street', postalCode: 'M5V 1A1',
      geo: { lat: 43.6532, lng: -79.3832 }, hours: HOURS(['Monday', 'Tuesday']), rating: { ratingValue: 4.0, reviewCount: 100 } },
    { id: 'loc-a7f2', label: 'East End', address: '9 Queen St E, Toronto, ON', phone: '416-555-0101', city: 'Toronto', postalCode: 'M4M 1J5',
      hours: HOURS(['Wednesday']), rating: { ratingValue: 3.0, reviewCount: 300 } },
    { id: 'loc-zq1x', label: 'harbour dental studio Airport', address: '1 Airport Rd, Mississauga, ON', city: 'Mississauga',
      rating: { ratingValue: 4.5, reviewCount: 47 } },
  ];
  // 老站形状（seo.json 里的营业时间 / 评分）拿掉：这一站的营业时间 / 评分都住在各自的地点上。
  delete three['en/seo.json'].schema.openingHours;
  delete three['en/seo.json'].schema.aggregateRating;
  // 第二家有地点页（页面 JSON 顶层 locationPage，#1978）⟹ 它那份的 @id 用地点页地址。
  three['en/pages/east-end.json'] = { ...clone(three['en/pages/about.json']), slug: 'east-end', title: 'East End', navLabel: 'East End', locationPage: { kind: 'location', id: 'loc-a7f2' } };
  const tn = (site) => site['en/pages/home.json'].blocks.find((b) => b.type === 'testimonials');
  tn(three).data.items[0].location = 'loc-a7f2';
  tn(three).data.items[1].location = 'loc-nope';
  const one = clone(JSON.parse(fs.readFileSync(FX, 'utf-8')));
  tn(one).data.items[0].location = 'loc-0'; // 单地点站补出来的 id 就是 loc-0：找得到也不画
  const fx3 = path.join(work, 'three.json');
  const fx1 = path.join(work, 'one.json');
  fs.writeFileSync(fx3, JSON.stringify(three));
  fs.writeFileSync(fx1, JSON.stringify(one));
  const name0 = tn(three).data.items[0].name;
  const name1 = tn(three).data.items[1].name;
  try {
    cp.execFileSync(process.execPath, [SITE_JS, 'bundle', '--out-dir', bundleDir], { stdio: 'pipe' });
    const render = (fx, out) => cp.execFileSync(process.execPath, [SITE_JS, 'render', '--site', fx, '--out', out, '--bundle-dir', bundleDir, '--site-url', 'https://example.test'], { stdio: 'pipe' });
    render(fx3, path.join(work, 'out3'));
    render(fx1, path.join(work, 'out1'));
    const home = fs.readFileSync(path.join(work, 'out3', 'index.html'), 'utf-8');
    const lbs = lbsOf(home);
    check(lbs.length === 3, `首页 LocalBusiness ${lbs.length} 份（应当 3）`);
    const ids = lbs.map((l) => l['@id']);
    check(new Set(ids).size === 3 && ids.every((id, i) => typeof id === 'string' && id.endsWith(`#business-${three['brand.json'].locations[i].id}`)),
      `@id 各不相同、按地点 id 结尾（${ids.join(' · ')}）`);
    check(lbs[1] && /\/east-end#business-loc-a7f2$/.test(lbs[1]['@id']) && lbs[1].url === lbs[1]['@id'].replace(/#.*$/, ''),
      `第二家有地点页 ⟹ @id / url 是地点页地址（${lbs[1] && lbs[1]['@id']}）`);
    check(lbs[0] && lbs[0]['@id'] === `${lbs[0].url}#business-loc-k9n2` && !/east-end/.test(lbs[0].url), `第一家没有地点页 ⟹ 网站地址（${lbs[0] && lbs[0]['@id']}）`);
    check(JSON.stringify(lbs[1] && lbs[1].aggregateRating) === JSON.stringify({ '@type': 'AggregateRating', ratingValue: 3, reviewCount: 300 }),
      `第二份的 aggregateRating = 第二家的 rating（${JSON.stringify(lbs[1] && lbs[1].aggregateRating)}）`);
    check(lbs[2] && !('openingHoursSpecification' in lbs[2]) && 'openingHoursSpecification' in lbs[0] && 'openingHoursSpecification' in lbs[1],
      '第三家没有 hours ⟹ 第三份没有 openingHoursSpecification（前两份有）');
    check(lbs[1] && lbs[1].name === 'Harbour Dental Studio – East End' && lbs[2] && lbs[2].name === 'harbour dental studio Airport',
      `name：「品牌名 – 地点名」/ 地点名已含品牌名（不分大小写）就用地点名（${lbs.map((l) => l.name).join(' · ')}）`);
    check(lbs[2] && lbs[2].telephone === '416-555-0000' && lbs[1].telephone === '416-555-0101', '电话：这一家没有用主地点的');
    check(lbs[1] && JSON.stringify(lbs[1].address) === JSON.stringify({ '@type': 'PostalAddress', addressLocality: 'Toronto', addressRegion: 'ON', postalCode: 'M4M 1J5', addressCountry: 'CA' }),
      `address：这一家的城市 / 邮编 + seo 的省 / 国家，没有街道就不出（${JSON.stringify(lbs[1] && lbs[1].address)}）`);
    check(lbs.every((l) => l.hasOfferCatalog && Array.isArray(l.sameAs) === Array.isArray(lbs[0].sameAs) && l.priceRange === '$$' && Array.isArray(l.areaServed)),
      'sameAs / priceRange / areaServed / hasOfferCatalog 每份都带');
    const about = fs.readFileSync(path.join(work, 'out3', 'about', 'index.html'), 'utf-8');
    check(lbsOf(about).length === 3, `子页（about）也是 3 份（${lbsOf(about).length}）`);
    cp.execFileSync(process.execPath, [path.join(__dirname, 'fixtures', 'site-fixtures', 'export-site-json.js'), 'to-dir', fx3, path.join(work, 'site3')], { stdio: 'pipe' });
    const r = K.checkOut(path.join(work, 'out3'), { siteDir: path.join(work, 'site3') });
    check(r.code === 0, `check-jsonld --site：${r.lines[r.lines.length - 1]}`, r.lines.slice(0, 3).join(' | '));

    console.log('\n── AC4 显示一半：评价名字后面的地点名');
    check(home.includes(`<span data-slot="items.0.name">${name0}</span><span class="fw-normal text-muted" data-part="place"> · <!-- -->East End</span>`)
      || home.includes(`<span data-slot="items.0.name">${name0}</span><span class="fw-normal text-muted" data-part="place"> · East End</span>`),
      `三地点站：「${name0}」后面是「· East End」`);
    check((home.match(/data-part="place"/g) || []).length === 1 && home.includes(`data-slot="items.1.name">${name1}</span>`),
      'id 找不到（loc-nope）的那条不画地点名，名字原样');
    const home1 = fs.readFileSync(path.join(work, 'out1', 'index.html'), 'utf-8');
    check(!home1.includes('data-part="place"') && home1.includes(`data-slot="items.0.name">${tn(one).data.items[0].name}</span>`),
      '反向对照：单地点站（location = loc-0，找得到）不画地点名');
    check(lbsOf(home1).length === 1, `反向对照：单地点站 LocalBusiness 仍是 1 份（${lbsOf(home1).length}）`);
  } catch (e) {
    check(false, `渲染跑不出来：${(e.stderr ? String(e.stderr) : e.message).split('\n').slice(0, 4).join(' | ')}`);
  } finally {
    fs.rmSync(work, { recursive: true, force: true });
    fs.rmSync(bundleDir, { recursive: true, force: true });
  }
}

// ══ check-jsonld 逐份核对自己会红 ════════════════════════════════════════════════════════════════════
console.log('\n── check-jsonld：≥2 个地点时逐份核对（判据会红）');
{
  const ld = (o) => `<script type="application/ld+json">${JSON.stringify(o)}</script>`;
  const OG = '<meta property="og:site_name" content="x"/><meta property="og:type" content="website"/>';
  const lb = (id, rating) => ({ '@context': 'https://schema.org', '@type': 'LocalBusiness', '@id': id, name: 'x',
    ...(rating ? { aggregateRating: { '@type': 'AggregateRating', ...rating } } : {}) });
  const exp = { sameAs: [], hours: [], rating: null, streetAddress: '', postalCode: '', geo: null,
    locations: [
      { hours: [], rating: { ratingValue: 4, reviewCount: 100 }, streetAddress: '', postalCode: '', geo: null },
      { hours: [], rating: { ratingValue: 3, reviewCount: 300 }, streetAddress: '', postalCode: '', geo: null },
    ] };
  const page = (...lbs) => `<html><head>${OG}${lbs.map(ld).join('')}</head><body></body></html>`;
  const probs = (html) => K.checkHtml(html, exp, 'home').problems;
  const good = page(lb('a#1', { ratingValue: 4, reviewCount: 100 }), lb('a#2', { ratingValue: 3, reviewCount: 300 }));
  check(probs(good).length === 0, `两份、@id 不同、评分各对各 ⟹ 0 条（${probs(good).join(' / ')}）`);
  check(probs(page(lb('a#1', { ratingValue: 4, reviewCount: 100 }))).some((p) => /2 个地点.*1 份/.test(p)), '只出 1 份 ⟹ 红');
  check(probs(page(lb('a#1', { ratingValue: 4, reviewCount: 100 }), lb('a#1', { ratingValue: 3, reviewCount: 300 }))).some((p) => /@id/.test(p)), '@id 重复 ⟹ 红');
  check(probs(page(lb('a#1', { ratingValue: 4, reviewCount: 100 }), lb('a#2', { ratingValue: 4, reviewCount: 100 }))).some((p) => /第 2 份.*aggregateRating/.test(p)),
    '第二份挂的是第一家的评分 ⟹ 红');
  const single = { ...exp, rating: { ratingValue: 4, reviewCount: 100 }, locations: [exp.locations[0]] };
  check(K.checkHtml(page(lb('a#1', { ratingValue: 4, reviewCount: 100 })), single, 'home').problems.length === 0, '单地点：照旧对 expected 那一份（0 条）');
}

// ══ AC3 建站 AI 之后那一步 ══════════════════════════════════════════════════════════════════════════
console.log('\n── AC3 建站 AI 之后：评价写上地点 id、块头 Google 总分按条数加权');
{
  const brand = { locations: [
    { id: 'loc-k9n2', label: 'A', rating: { ratingValue: 4.0, reviewCount: 100, source: 'google' } },
    { id: 'loc-a7f2', label: 'B', rating: { ratingValue: 3.0, reviewCount: 300 } },
    { id: 'loc-zq1x', label: 'C', rating: { ratingValue: 4.5, reviewCount: 47 } },
  ] };
  const reviews = [
    { author: 'Ann Lee', text: 'a', location: 0 }, { author: 'Bo Chen', text: 'b', location: 1 }, { author: 'Cy Diaz', text: 'c', location: 2 },
    { author: 'Dee Twin', text: 'd1', location: 0 }, { author: 'Dee Twin', text: 'd2', location: 2 }, { author: 'Eve NoLoc', text: 'e' },
  ];
  const pages = () => [{ slug: 'home', sections: [
    { type: 'testimonials', data: {
      summary: [{ source: 'Google', rating: 4.9, count: 312 }, { source: 'Yelp', rating: 4.8, count: 46 }],
      items: [{ quote: 'q', name: 'Ann Lee' }, { quote: 'q', name: 'Bo Chen' }, { quote: 'q', name: 'Cy Diaz' },
        { quote: 'q', name: 'Dee Twin' }, { quote: 'q', name: 'Eve NoLoc', location: 'loc-k9n2' }, { quote: 'q', name: 'Zed Stranger', location: 0 }],
    } },
    { type: 'reviews', data: { platforms: [{ source: 'google', rating: 5, count: 9 }] } },
  ] }];
  const p = pages();
  const r = RF.applyReviewFacts({ pages: p, brand, reviews });
  const [tn, rv] = p[0].sections;
  const g = tn.data.summary[0];
  check(g.rating === 3.4 && g.count === 447, `testimonials summary 的 Google 项 = 3.4 · 447（${g.rating} · ${g.count}）`);
  check(tn.data.summary[1].rating === 4.8 && tn.data.summary[1].count === 46, 'Yelp 那一项不动');
  check(rv.data.platforms[0].rating === 3.4 && rv.data.platforms[0].count === 447, `reviews platforms 的 Google 项同样改（${rv.data.platforms[0].rating} · ${rv.data.platforms[0].count}）`);
  const loc = tn.data.items.map((it) => it.location);
  check(loc[0] === 'loc-k9n2' && loc[1] === 'loc-a7f2' && loc[2] === 'loc-zq1x', `三条各得那一家的 id（${loc.slice(0, 3).join(' / ')}）`);
  check(typeof loc[0] === 'string' && loc[0] === brand.locations[0].id, '第一条也有，值是 brand.locations[0].id，不是数字');
  check(!('location' in tn.data.items[3]), '两条 payload 评价同名（Dee Twin）⟹ 不写 location');
  check(!('location' in tn.data.items[4]) && !('location' in tn.data.items[5]), 'payload 那条没有 location / 对不上任何 payload 评价 ⟹ AI 自己写的 location 被删掉');
  check(r.located === 3 && r.rated === 2, `回值：写了 ${r.located} 条地点 · 改了 ${r.rated} 处总分`);

  const only1 = { locations: [brand.locations[0]] };
  const p1 = pages();
  RF.applyReviewFacts({ pages: p1, brand: only1, reviews: [] });
  check(p1[0].sections[0].data.summary[0].rating === 4 && p1[0].sections[0].data.summary[0].count === 100, `只留第一家 ⟹ 4.0 · 100（${p1[0].sections[0].data.summary[0].rating} · ${p1[0].sections[0].data.summary[0].count}）`);
  const p0 = pages();
  RF.applyReviewFacts({ pages: p0, brand: { locations: [{ id: 'x', label: 'A' }] }, reviews: [] });
  check(p0[0].sections[0].data.summary[0].rating === 4.9 && p0[0].sections[0].data.summary[0].count === 312, '没有任何地点有评分 ⟹ 总分不动');
  const yelpOnly = { locations: [{ id: 'x', rating: { ratingValue: 4.2, reviewCount: 30, source: 'yelp' } }] };
  const py = pages();
  RF.applyReviewFacts({ pages: py, brand: yelpOnly, reviews: [] });
  check(py[0].sections[0].data.summary[0].rating === 4.9, '地点评分是 Yelp 的（ratingFrom 退回 Yelp）⟹ 不写进 Google 那一项');

  // r2 · PM 裁定 1：参与加权的评分有一家不是 Google ⟹ 整条不动（不是剔掉它、拿剩下几家的条数冒充整站的 Google 条数）。
  const mixed = { locations: [
    { id: 'a', rating: { ratingValue: 4.0, reviewCount: 100, source: 'google' } },
    { id: 'b', rating: { ratingValue: 4.6, reviewCount: 58, source: 'Yelp' } },
    { id: 'c', rating: { ratingValue: 3.0, reviewCount: 300 } },
  ] };
  const pm = pages();
  const rm = RF.applyReviewFacts({ pages: pm, brand: mixed, reviews: [] });
  const gm = pm[0].sections[0].data.summary[0];
  check(gm.rating === 4.9 && gm.count === 312 && pm[0].sections[1].data.platforms[0].rating === 5,
    `一家是 Google、一家是 Yelp ⟹ 两块的 Google 项都不动（${gm.rating} · ${gm.count}）`);
  check(rm.rated === 0 && /yelp/.test(rm.why), `回值说为什么没动（rated=${rm.rated} · why=${rm.why}）`);
  const unusable = { locations: [mixed.locations[0], { id: 'b', rating: { ratingValue: 4.6, reviewCount: 0, source: 'yelp' } }] };
  const pu = pages();
  RF.applyReviewFacts({ pages: pu, brand: unusable, reviews: [] });
  check(pu[0].sections[0].data.summary[0].rating === 4 && pu[0].sections[0].data.summary[0].count === 100,
    '不参与加权的 Yelp 评分（条数 0）不挡：只按 Google 那家写 4 · 100');
  check(RF.applyReviewFacts({ pages: pages(), brand, reviews: [] }).why === '', '正常改写时 why 是空串');

  // r2 · PM 裁定 2：块里压根没有 Google 那一项 ⟹ 不新造。
  const noG = [{ slug: 'home', sections: [
    { type: 'testimonials', data: { summary: [{ source: 'Yelp', rating: 4.8, count: 46 }], items: [] } },
    { type: 'reviews', data: { platforms: [{ source: 'Facebook', rating: 4.1, count: 12 }] } },
    { type: 'testimonials', data: { items: [] } },
  ] }];
  const rn = RF.applyReviewFacts({ pages: noG, brand, reviews: [] });
  const [s0, s1, s2] = noG[0].sections;
  check(rn.rated === 0 && s0.data.summary.length === 1 && s0.data.summary[0].source === 'Yelp' && s0.data.summary[0].count === 46
    && s1.data.platforms.length === 1 && s1.data.platforms[0].count === 12 && !('summary' in s2.data),
    '没有 Google 那一项 ⟹ 不新造一项、别的平台不动、没有 summary 的块不补 summary');
}

// ══ AC6 编辑器：两份 EditorApp ══════════════════════════════════════════════════════════════════════
console.log('\n── AC6 编辑器：testimonials 一条评价的 Location 下拉（两份 EditorApp 各一次）');
{
  // 替身放在 scripts/ 下（同 contact-refs.test.js）：它们 require('react')，得从模板的 node_modules 解析到。
  const STUB_DIR = path.join(__dirname, `.ml-reviews-stubs-${process.pid}`);
  fs.mkdirSync(STUB_DIR, { recursive: true });
  process.on('exit', () => { try { fs.rmSync(STUB_DIR, { recursive: true, force: true }); } catch (e) { /* 收尾 */ } });
  const stub = (name, body) => { const p = path.join(STUB_DIR, `${name}.js`); fs.writeFileSync(p, body); return p; };
  // 什么都接得住的替身：任何属性、任何调用都回一个替身 / null（dashboard 自己的模块和 antd —— 这几格一个都不调它们）。
  const ANY = stub('any', "const make=()=>new Proxy(function(){return null;},{get:(t,k)=>(k==='__esModule'?false:k===Symbol.toPrimitive?(()=>''):make()),apply:()=>null,construct:()=>({})});module.exports=make();\n");
  const PUCK = stub('puck', "const React=require('react');const base={Puck:()=>null,"
    + "FieldLabel:({label,children})=>React.createElement('div',{'data-label':label},children),"
    + 'createUsePuck:()=>(sel)=>sel({selectedItem:null,dispatch(){},getSelectorForId(){}}),useGetPuck:()=>()=>({})};'
    + "module.exports=new Proxy(base,{get:(t,k)=>(k in t?t[k]:k==='__esModule'?false:()=>null)});\n");
  const CSS = stub('css', 'module.exports="";\n');
  const SHELL = stub('shell', 'const C=()=>null;module.exports=C;module.exports.default=C;\n');
  const STUBS = { '@puckeditor/core': PUCK, '@/components/SiteShell': SHELL, '@template/components/SiteShell': SHELL, './EditorChat': SHELL, 'antd': ANY, '@ant-design/icons': ANY };
  for (const ext of ['.tsx', '.ts']) {
    require.extensions[ext] = (mod, filename) => mod._compile(ts.transpileModule(fs.readFileSync(filename, 'utf-8'), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true, resolveJsonModule: true },
      fileName: filename,
    }).outputText, filename);
  }
  const inDash = (f) => typeof f === 'string' && f.startsWith(DASH_SRC + path.sep);
  const origResolve = Module._resolveFilename;
  Module._resolveFilename = function resolve(req, parent, ...rest) {
    const from = parent && parent.filename;
    if (typeof req === 'string' && /\.css(\?.*)?$/.test(req)) return CSS; // canvasHead.tsx 的 `puck.css?inline` 带查询串
    if (STUBS[req]) return STUBS[req];
    if (req.startsWith('@template-scripts/')) return origResolve.call(this, path.join(NEXT, 'scripts', req.slice(18)), parent, ...rest);
    if (req.startsWith('@template/')) return origResolve.call(this, path.join(SRC, req.slice(10)), parent, ...rest);
    if (req.startsWith('@blocks/')) return origResolve.call(this, path.join(NEXT, 'blocks', req.slice(8)), parent, ...rest);
    if (req.startsWith('@/')) return inDash(from) ? ANY : origResolve.call(this, path.join(SRC, req.slice(2)), parent, ...rest);
    // dashboard 那份的裸包按模板目录解析（CI 上只有模板的 node_modules；也免得 react 出两份）。
    if (inDash(from) && !req.startsWith('.') && !path.isAbsolute(req)) return require.resolve(req, { paths: [NEXT] });
    return origResolve.call(this, req, parent, ...rest);
  };

  const convert = require('./lib/editor-convert.js');
  const schema = require('./lib/editor-schema.js').editorSchema();
  const comp = schema.components.find((c) => c.type === 'testimonials');
  const TWO = [{ id: 'loc-k9n2', label: 'Downtown', address: '1 A St' }, { id: 'loc-a7f2', label: 'East End', address: '9 B St' }];
  let brand = { name: { en: 'x' }, locations: TWO };
  const SITE = {
    defaultLocale: 'en', locales: ['en'], siteId: 't', leadApi: '',
    servicesByLocale: { en: [] }, formsByLocale: { en: [] }, seoByLocale: { en: {} }, pagesByLocale: { en: [] }, blogPostsByLocale: { en: [] },
    get brand() { return brand; },
  };
  const find = (node, pred) => {
    if (!node || typeof node !== 'object') return null;
    if (Array.isArray(node)) { for (const n of node) { const x = find(n, pred); if (x) return x; } return null; }
    if (pred(node)) return node;
    return find(node.props && node.props.children, pred);
  };
  const base = { items: [{ quote: 'Great work', name: 'Ann Lee' }] };
  const editors = [
    ['模板 EditorApp', path.join(SRC, 'components', 'editor', 'EditorApp.tsx')],
    ['dashboard EditorApp', path.join(DASH_SRC, 'editor', 'EditorApp.tsx')],
  ];
  for (const [label, file] of editors) {
    let App;
    try { App = require(file); } catch (e) { check(false, `${label} 载入失败：${e.message.split('\n')[0]}`); continue; }
    brand = { name: { en: 'x' }, locations: TWO };
    const field = () => {
      const cfg = App.buildConfig(SITE, schema, 'en');
      const items = cfg.components.testimonials && cfg.components.testimonials.fields.items;
      return items && items.arrayFields && items.arrayFields.location;
    };
    const f = field();
    if (!f || f.type !== 'custom') { check(false, `${label}：items 每项没有 location 那一格（${f && f.type}）`); continue; }
    // 自定义字段的 render 回的是 <LocationControl/>：展开一层拿它画出来的树（它不用 hook）。
    const tree = (value, onChange) => { const el = f.render({ value, onChange, readOnly: false }); return el.type(el.props); };
    const html = (value) => renderToStaticMarkup(f.render({ value, onChange: () => {}, readOnly: false }));
    // 照人点的方式选：按选项上看得见的字找到那一项，把**它的** value 交给 onChange（存什么由控件的选项决定）。
    const pickAndSave = (from, text) => {
      let picked = 'untouched';
      const props = convert.fieldProps(comp, from);
      const sel = find(tree(props.items[0].location, (v) => { picked = v; }), (n) => n.type === 'select');
      const opt = find(sel.props.children, (n) => n.type === 'option' && [].concat(n.props.children).join('') === text);
      sel.props.onChange({ target: { value: opt.props.value } });
      const items = props.items.map((it, i) => (i === 0 ? { ...it, location: picked } : it));
      return { picked, saved: convert.dataFromProps(comp, from, { ...props, items }) };
    };
    const a = pickAndSave(base, 'Downtown');
    check(a.saved.items[0].location === TWO[0].id, `${label}：选第一家 ⟹ 存下 location = locations[0].id（${JSON.stringify(a.saved.items[0].location)}）`);
    const b = pickAndSave(base, 'East End');
    check(b.saved.items[0].location === TWO[1].id, `${label}：选第二家 ⟹ 存下 location = locations[1].id（${JSON.stringify(b.saved.items[0].location)}）`);
    const reopened = convert.fieldProps(comp, b.saved);
    check(/<option value="loc-a7f2" selected="">East End<\/option>/.test(html(reopened.items[0].location)), `${label}：存下后再打开 ⟹ 选中的还是 East End`);
    const ghost = convert.fieldProps(comp, { items: [{ ...base.items[0], location: 'loc-gone' }] });
    check(/<option value="" selected="">No location<\/option>/.test(html(ghost.items[0].location)), `${label}：location 是不存在的 id ⟹ 选中 No location`);
    const c = pickAndSave(b.saved, 'No location');
    check(c.picked === undefined && !('location' in c.saved.items[0]) && c.saved.items[0].name === 'Ann Lee', `${label}：选 No location 存盘 ⟹ 这条评价没有 location 键（${JSON.stringify(c.saved.items[0])}）`);
    brand = { name: { en: 'x' }, locations: [TWO[0]] };
    check(html('loc-k9n2') === '' && field().type === 'custom', `${label}：反向对照 —— 单地点站没有这个下拉（画出来是空的）`);
  }
}

console.log(`\n══ 汇总: 通过 ${pass} · 失败 ${fail} ══`);
process.exit(fail ? 1 : 0);
