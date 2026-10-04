#!/usr/bin/env node
/**
 * check-jsonld.test.js — #1551：`scripts/check-jsonld.js` 自己量得到它要防的每一种形状，也不误判干净的页。
 * 夹具是手写的 HTML（不构建）；红臂里的旧形状逐字取自 #1551 之前 `src/components/JsonLd.tsx` 的输出
 * （无条件的 openingHoursSpecification 空壳、WebSite 上的 SearchAction、子页 openGraph 只有 title/description/url）。
 *
 * 跑法:  node scripts/check-jsonld.test.js   （或 `npm run test:scripts`，它按文件名发现）
 * 退出码: 0 全过 · 1 有失败 · 2 跑不起来（不许当成通过）
 */
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');

let pass = 0;
let fail = 0;
const ok = (m) => { pass += 1; console.log(`  ✅ ${m}`); };
const bad = (m) => { fail += 1; console.log(`  ❌ ${m}`); };
const check = (cond, m) => (cond ? ok(m) : bad(m));

let K;
try { K = require('./check-jsonld'); } catch (e) { console.error(`🔴 跑不起来: ${e.message}`); process.exit(2); }

const ld = (o) => `<script type="application/ld+json">${JSON.stringify(o)}</script>`;
const OG = '<meta property="og:site_name" content="Bright Pipes"/><meta property="og:type" content="website"/>';
const LB = {
  '@context': 'https://schema.org', '@type': 'LocalBusiness', name: 'Bright Pipes',
  address: [{ '@type': 'PostalAddress', streetAddress: '2150 Yonge Street', addressLocality: 'Toronto', postalCode: 'M4S 2A7', addressCountry: 'CA' }],
  geo: { '@type': 'GeoCoordinates', latitude: 43.7, longitude: -79.4 },
  sameAs: ['https://www.facebook.com/brightpipes'],
  openingHoursSpecification: [{ '@type': 'OpeningHoursSpecification', dayOfWeek: ['Monday', 'Tuesday'], opens: '09:00', closes: '18:00' }],
  aggregateRating: { '@type': 'AggregateRating', ratingValue: 4.8, reviewCount: 127 },
};
const WS = { '@context': 'https://schema.org', '@type': 'WebSite', name: 'Bright Pipes', url: 'https://x.test' };
const faqBlock = (n) => `<section data-block="faq" data-role="essential">${Array.from({ length: n }, (_, i) =>
  `<details><summary><span data-slot="items.${i}.question">Q${i}</span></summary><div data-slot="items.${i}.answer">A${i}</div></details>`).join('')}</section>`;
const faqLd = (n) => ({ '@context': 'https://schema.org', '@type': 'FAQPage',
  mainEntity: Array.from({ length: n }, (_, i) => ({ '@type': 'Question', name: `Q${i}`, acceptedAnswer: { '@type': 'Answer', text: `A${i}` } })) });
const page = ({ head = OG, lds = [LB, WS], body = '' } = {}) => `<html><head>${head}${lds.map(ld).join('')}</head><body>${body}</body></html>`;
const probs = (html, exp, slug) => K.checkHtml(html, exp, slug).problems;

console.log('══ #1551 check-jsonld ══');

console.log('\n── 干净的页（各种组合）不报');
check(probs(page()).length === 0, `完整的 LocalBusiness + WebSite + og ⟹ 0 条（${probs(page()).join(' / ')}）`);
check(probs(page({ lds: [LB, WS, faqLd(3)], body: faqBlock(3) })).length === 0, 'faq 块画 3 条 + FAQPage 3 条 ⟹ 0 条');
const bareLb = { '@context': 'https://schema.org', '@type': 'LocalBusiness', name: 'x', address: [{ '@type': 'PostalAddress', addressLocality: 'Toronto' }] };
check(probs(page({ lds: [bareLb, WS] })).length === 0, '没有营业时间 / 评分 / 坐标 / 街道的 LocalBusiness（整项不出）⟹ 0 条');
check(probs('<html><head><meta http-equiv="refresh" content="0;url=/about"/></head></html>').length === 0, '跳转页（没有站点外壳）⟹ 不查 og');
const noAnswer = `<section data-block="faq"><details><summary><span data-slot="items.0.question">Q</span></summary></details></section>`;
check(probs(page({ body: noAnswer })).length === 0, 'faq 块里只有问题、没有答案 ⟹ 不要求 FAQPage');

console.log('\n── 红臂：#1551 之前的真实形状');
const shell = { ...LB, openingHoursSpecification: { '@type': 'OpeningHoursSpecification', dayOfWeek: [], opens: '', closes: '' } };
check(probs(page({ lds: [shell, WS] })).some((p) => /空壳/.test(p)), '无条件输出的 openingHoursSpecification 空壳（dayOfWeek [] / opens ""）⟹ 红');
const ws = { ...WS, potentialAction: { '@type': 'SearchAction', target: 'https://x.test/services', 'query-input': 'required name=search_term_string' } };
check(probs(page({ lds: [LB, ws] })).some((p) => /SearchAction/.test(p)), 'WebSite 挂着 SearchAction ⟹ 红');
check(probs(page({ head: '<meta property="og:title" content="About | x"/>' })).some((p) => /og:site_name/.test(p)), '子页 openGraph 只有 title ⟹ 缺 og:site_name 红');
check(probs(page({ head: '<meta property="og:site_name" content="x"/>' })).some((p) => /og:type/.test(p)), '缺 og:type ⟹ 红');
check(probs(page({ body: faqBlock(3) })).some((p) => /FAQPage 却有 0 份/.test(p)), 'faq 块画了 3 条、没有 FAQPage ⟹ 红');

console.log('\n── 红臂：FAQPage 出了但不对');
check(probs(page({ lds: [LB, WS, faqLd(2)], body: faqBlock(3) })).some((p) => /mainEntity 有 2 条/.test(p)), '条数对不上（2 vs 3）⟹ 红');
check(probs(page({ lds: [LB, WS, faqLd(3), faqLd(3)], body: faqBlock(3) })).some((p) => /2 份/.test(p)), '同一页两份 FAQPage ⟹ 红');
check(probs(page({ lds: [LB, WS, faqLd(1)] })).some((p) => /没有画出任何问答/.test(p)), '没有 faq 块却出了 FAQPage ⟹ 红');
const broken = faqLd(1); broken.mainEntity[0].acceptedAnswer = { '@type': 'Answer', text: '' };
check(probs(page({ lds: [LB, WS, broken], body: faqBlock(1) })).some((p) => /不是一条完整的问答/.test(p)), '答案是空的 ⟹ 红');

console.log('\n── 红臂：LocalBusiness 出了但不合法');
check(probs(page({ lds: [{ ...LB, aggregateRating: { '@type': 'AggregateRating', ratingValue: 4.8 } }, WS] })).some((p) => /aggregateRating/.test(p)), '评分没有条数 ⟹ 红');
check(probs(page({ lds: [{ ...LB, openingHoursSpecification: [{ dayOfWeek: ['周一'], opens: '09:00', closes: '18:00' }] }, WS] })).some((p) => /认不出/.test(p)), '星期名不是英文 ⟹ 红');
check(probs(page({ lds: [{ ...LB, geo: { latitude: 'x' } }, WS] })).some((p) => /geo/.test(p)), 'geo 不是两个数 ⟹ 红');
check(probs(page({ lds: [{ ...LB, address: [{ '@type': 'PostalAddress', streetAddress: '' }] }, WS] })).some((p) => /streetAddress/.test(p)), '街道出了但是空的 ⟹ 红');
check(probs(page({ lds: [] }).replace('</head>', '<script type="application/ld+json">{not json</script></head>')).some((p) => /解析不了/.test(p)), 'JSON-LD 解析不了 ⟹ 红');

console.log('\n── 对站点数据（--site）');
const exp = {
  hours: [{ days: ['Monday', 'Tuesday'], opens: '09:00', closes: '18:00' }],
  rating: { ratingValue: 4.8, reviewCount: 127 },
  sameAs: ['https://www.facebook.com/brightpipes'],
  streetAddress: '2150 Yonge Street', postalCode: 'M4S 2A7', geo: { lat: 43.7, lng: -79.4 },
};
check(probs(page(), exp).length === 0, '跟站点数据一致 ⟹ 0 条');
check(probs(page(), { ...exp, hours: [] }).some((p) => /营业时间跟站点数据不一致/.test(p)), '站点没有营业时间、JSON-LD 却有 ⟹ 红');
check(probs(page({ lds: [bareLb, WS] }), exp).some((p) => /营业时间/.test(p)) && probs(page({ lds: [bareLb, WS] }), exp).some((p) => /sameAs/.test(p)),
  '站点有营业时间 / 社交链接、JSON-LD 却没出 ⟹ 红（「悄悄少一项」）');
check(probs(page(), { ...exp, rating: null }).some((p) => /aggregateRating/.test(p)), '站点没有评分、JSON-LD 却有 ⟹ 红');
check(probs(page(), { ...exp, postalCode: 'X1X 1X1' }).some((p) => /postalCode/.test(p)), '邮编对不上 ⟹ 红');

console.log('\n── Service（关键词页，做什么 2）');
const SVC = (name, areas, provider = { '@type': 'LocalBusiness', name: 'Bright Pipes' }) => ({ '@context': 'https://schema.org', '@type': 'Service', name,
  provider, areaServed: areas.map((n) => ({ '@type': 'City', name: n })) });
check(probs(page({ lds: [LB, WS, SVC('Plumber toronto', ['Toronto, ON'])] })).length === 0, '形状完整的 Service ⟹ 0 条');
check(probs(page({ lds: [LB, WS, SVC('Plumber toronto', ['Toronto, ON'], null)] })).some((p) => /provider\.name/.test(p)), '没有 provider ⟹ 红');
check(probs(page({ lds: [LB, WS, SVC('', ['Toronto, ON'])] })).some((p) => /没有 name/.test(p)), '没有 name ⟹ 红');
const kwExp = {
  ...exp,
  siteName: 'Bright Pipes',
  serviceNames: new Set(['Drain Cleaning']),
  keywordPages: new Map([
    ['drain-cleaning/plumber-toronto', { name: 'Plumber toronto', keyword: 'plumber toronto', areaServed: [{ type: 'City', name: 'Toronto, ON' }] }],
    ['drain-cleaning/old', null],
  ]),
};
const kwp = (svcs) => page({ lds: [LB, WS, ...svcs] });
check(probs(kwp([SVC('Plumber toronto', ['Toronto, ON'])]), kwExp, 'drain-cleaning/plumber-toronto').length === 0, '关键词页 Service 跟目标词 / 地名 / 站名都对得上 ⟹ 0 条');
check(probs(kwp([]), kwExp, 'drain-cleaning/plumber-toronto').some((p) => /实际 0 份/.test(p)), '带目标词的关键词页没出 Service（#1551 之前的样子）⟹ 红');
check(probs(kwp([SVC('Plumber Toronto', ['Toronto, ON'])]), kwExp, 'drain-cleaning/plumber-toronto').some((p) => /Service\.name/.test(p)), 'name 做成了 Title Case ⟹ 红');
check(probs(kwp([SVC('Plumber toronto', ['North York'])]), kwExp, 'drain-cleaning/plumber-toronto').some((p) => /areaServed/.test(p)), 'areaServed 不是词里的地名 ⟹ 红');
check(probs(kwp([SVC('Plumber toronto', ['Toronto, ON'], { '@type': 'LocalBusiness', name: 'Someone Else' })]), kwExp, 'drain-cleaning/plumber-toronto').some((p) => /provider/.test(p)),
  'provider 不是本站 ⟹ 红');
check(probs(kwp([SVC('Plumber toronto', ['Toronto, ON']), SVC('Plumber toronto', ['Toronto, ON'])]), kwExp, 'drain-cleaning/plumber-toronto').some((p) => /实际 2 份/.test(p)), '出了两份 ⟹ 红');
check(probs(kwp([SVC('Old thing', ['Toronto, ON'])]), kwExp, 'drain-cleaning/old').some((p) => /没有目标词，却出了 Service/.test(p)), '没有目标词的关键词页出了 Service ⟹ 红');
check(probs(kwp([SVC('Drain Cleaning', ['Toronto, ON'])]), kwExp, 'drain-cleaning/old').length === 0, '没有目标词的关键词页上、站的服务目录里那个服务的 Service ⟹ 不算');
check(probs(kwp([]), kwExp, 'about').length === 0, '不是关键词页 ⟹ 不要求 Service');
check(K.slugOf(path.join('drain-cleaning', 'plumber-toronto.html')) === 'drain-cleaning/plumber-toronto' && K.slugOf('index.html') === 'home', '产物路径 → slug');

console.log('\n── --site 端到端：站点数据（T4 #1548 的页面形状）→ 期望 → 逐页对');
const st = fs.mkdtempSync(path.join(os.tmpdir(), 'cjl-site-'));
try {
  const w = (rel, v) => { fs.mkdirSync(path.dirname(path.join(st, rel)), { recursive: true }); fs.writeFileSync(path.join(st, rel), typeof v === 'string' ? v : JSON.stringify(v)); };
  w('site/site_meta.json', { defaultLocale: 'en', locales: ['en'] });
  w('site/brand.json', { name: { en: 'Bright Pipes' }, locations: [{ city: 'Toronto' }] });
  w('site/en/seo.json', { schema: { areaServed: [{ type: 'City', name: 'Toronto, ON' }], addresses: [{ locality: 'Toronto' }] } });
  w('site/en/services.json', [{ id: 'drain-cleaning', name: 'Drain Cleaning' }]);
  w('site/en/pages/drain-cleaning/plumber-toronto.json', { keywordPage: true, title: 't', seo: { targetKeyword: 'plumber toronto' }, blocks: [] });
  w('site/en/pages/drain-cleaning/old.json', { keywordPage: true, title: 'o', blocks: [] });
  // 站点数据里没有营业时间 / 评分 / 街道 / 坐标 / 社交链接 ⟹ 产物里的 LocalBusiness 也是光的那份（bareLb），只看 Service 这一维。
  const bare = (svcs) => page({ lds: [bareLb, WS, ...svcs] });
  w('out/drain-cleaning/plumber-toronto.html', bare([]));
  w('out/drain-cleaning/old.html', bare([]));
  const red = K.checkOut(path.join(st, 'out'), { siteDir: path.join(st, 'site') });
  check(red.code === 1 && red.lines.filter((l) => /实际 0 份/.test(l)).length === 1 && red.lines.some((l) => l.startsWith(path.join('drain-cleaning', 'plumber-toronto.html'))),
    `带目标词那页没出 Service ⟹ 恰好那一页红（${red.lines.slice(0, -1).join(' / ')}）`);
  w('out/drain-cleaning/plumber-toronto.html', bare([SVC('Plumber toronto', ['Toronto, ON'])]));
  const green = K.checkOut(path.join(st, 'out'), { siteDir: path.join(st, 'site') });
  check(green.code === 0, `补上之后 ⟹ 0 处（${green.lines.join(' / ')}）`);
} finally { fs.rmSync(st, { recursive: true, force: true }); }

console.log('\n── 目录层：跑不起来不许当通过');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'cjl-'));
try {
  check(K.checkOut(path.join(tmp, 'nope')).code === 2, '没有 out 目录 ⟹ 退出码 2');
  check(K.checkOut(tmp).code === 2, '一页 HTML 都没有 ⟹ 退出码 2');
  fs.writeFileSync(path.join(tmp, 'index.html'), page());
  fs.mkdirSync(path.join(tmp, 'about'));
  fs.writeFileSync(path.join(tmp, 'about', 'index.html'), page({ lds: [LB, ws] }));
  const r = K.checkOut(tmp);
  check(r.code === 1 && r.lines.some((l) => l.startsWith(path.join('about', 'index.html')) && /SearchAction/.test(l)), `子目录里那页的问题带着它的路径报出来（${r.lines[0]}）`);
  check(K.checkOut(tmp, { siteDir: path.join(tmp, 'no-site') }).code === 2, '--site 指向读不了的目录 ⟹ 退出码 2');
} finally { fs.rmSync(tmp, { recursive: true, force: true }); }

console.log(`\n══ 汇总: 通过 ${pass} · 失败 ${fail} ══`);
process.exit(fail ? 1 : 0);
