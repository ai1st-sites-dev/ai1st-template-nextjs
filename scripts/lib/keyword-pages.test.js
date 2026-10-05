// #1550 —— keyword-pages.js：关键词页的规划 / 素材 / 单页提示词 / 合格判据 / 详情页兜底 / 互链 / 页脚。
'use strict';

const assert = require('assert');
const K = require('./keyword-pages');

let pass = 0;
let fail = 0;
function check(name, fn) {
  try { fn(); pass += 1; console.log(`  ✅ ${name}`); } catch (e) { fail += 1; console.log(`  ❌ ${name}\n     ${e.message}`); }
}
const kw = (keyword, extra = {}) => ({ keyword, volume: 100, goldIndex: 10, selected: true, ...extra });
const primary = (keyword) => kw(keyword, { isPrimary: true });

console.log('══ #1550 keyword-pages ══');

// ── 规划 ──────────────────────────────────────────────────────────────────────────────────────────
console.log('── 规划：URL = services/<服务 id>/<slug>');
check('Brand 两服务按名字对上：每个选中的非主词一页；主词和没勾的不建页', () => {
  const r = K.planKeywordPages({
    keywords: {
      'Drain Cleaning': [primary('drain cleaning'), kw('drain cleaning markham'), kw('clogged drain'), kw('drain snake', { selected: false })],
      'Water Heaters': [primary('water heater repair'), kw('tankless water heater')],
    },
    services: ['Drain Cleaning', 'Water Heaters'],
    contentServices: [{ id: 'drain-cleaning', name: 'Drain Cleaning' }, { id: 'water-heaters', name: 'Water Heaters' }],
  });
  assert.deepStrictEqual(r.pages.map((p) => p.path), [
    'services/drain-cleaning/drain-cleaning-markham',
    'services/drain-cleaning/clogged-drain',
    'services/water-heaters/tankless-water-heater',
  ]);
  assert.deepStrictEqual(r.addedServices, []);
  assert.strictEqual(r.pages[0].serviceName, 'Drain Cleaning');
});
check('服务 id 取匹配结果，不从服务名推（AI 起的 id 跟名字的 slug 不一样时照样对）', () => {
  const r = K.planKeywordPages({
    keywords: { 'Drain Cleaning': [primary('drain cleaning'), kw('drain unclogging')] },
    services: ['Drain Cleaning'],
    contentServices: [{ id: 'drains', name: 'Drain Cleaning' }],
  });
  assert.strictEqual(r.pages[0].path, 'services/drains/drain-unclogging');
});
check('PM ①(b)：挂 Brand 的 Lead（Brand 3 服务、组名是 Lead 主词）⟹ 补一个服务 {id: 组名 slug, name: 组名}', () => {
  const r = K.planKeywordPages({
    keywords: { plumbing: [primary('plumbing'), kw('plumbing markham'), kw('plumbing toronto')] },
    services: ['Drain Cleaning', 'Water Heaters', 'Leak Repair'],
    contentServices: [{ id: 'drain-cleaning', name: 'Drain Cleaning' }, { id: 'water-heaters', name: 'Water Heaters' }, { id: 'leak-repair', name: 'Leak Repair' }],
  });
  assert.deepStrictEqual(r.addedServices, [{ id: 'plumbing', name: 'plumbing', group: 'plumbing' }]);
  assert.deepStrictEqual(r.pages.map((p) => p.path), ['services/plumbing/plumbing-markham', 'services/plumbing/plumbing-toronto']);
});
check('PM ① 约束 1：对不上、但组里没有关键词页（只有主词 / 都没勾）⟹ 不补服务', () => {
  const r = K.planKeywordPages({
    keywords: { plumbing: [primary('plumbing'), kw('plumbing markham', { selected: false })] },
    services: ['Drain Cleaning', 'Water Heaters'],
    contentServices: [{ id: 'drain-cleaning', name: 'Drain Cleaning' }, { id: 'water-heaters', name: 'Water Heaters' }],
  });
  assert.deepStrictEqual(r.addedServices, []);
  assert.deepStrictEqual(r.pages, []);
});
check('独立 Lead（services 缺省 → AI 给一个 General Services）按位置对上，不补服务', () => {
  const r = K.planKeywordPages({
    keywords: { plumbing: [primary('plumbing'), kw('emergency plumber')] },
    services: [],
    contentServices: [{ id: 'general-services', name: 'General Services' }],
  });
  assert.deepStrictEqual(r.addedServices, []);
  assert.strictEqual(r.pages[0].path, 'services/general-services/emergency-plumber');
});
check('补的服务 id 跟已有 id 撞了 ⟹ 加 -2', () => {
  const r = K.planKeywordPages({
    keywords: { 'Drain Cleaning ': [primary('x'), kw('y')] },   // 组名多一个空格：名字对不上、组数 1 ≠ 服务数 2
    services: ['A', 'B'],
    contentServices: [{ id: 'drain-cleaning', name: 'Something else' }, { id: 'b', name: 'B' }],
  });
  assert.strictEqual(r.addedServices[0].id, 'drain-cleaning-2');
});
check('转写不了的词 ⟹ kw-<序号>，列进 fallbacks', () => {
  const r = K.planKeywordPages({
    keywords: { Plumbing: [primary('plumbing'), kw('plumber toronto'), kw('すいどう')] },
    services: ['Plumbing'],
    contentServices: [{ id: 'plumbing', name: 'Plumbing' }],
  });
  assert.deepStrictEqual(r.fallbacks, [{ keyword: 'すいどう', slug: 'services/plumbing/kw-2' }]);
  assert.strictEqual(r.pages[1].path, 'services/plumbing/kw-2');
});
check('中文服务名 + 中文关键词：slug 是拼音，服务 id 照匹配结果', () => {
  const r = K.planKeywordPages({
    keywords: { '理发': [primary('理发'), kw('万锦 剪头发')] },
    services: ['理发'],
    contentServices: [{ id: 'haircut', name: '理发' }],
  });
  assert.strictEqual(r.pages[0].path, 'services/haircut/wan-jin-jian-tou-fa');
});
check('keywordPageCandidates：Call 1 之前只回词（没有 URL）', () => {
  const c = K.keywordPageCandidates({ A: [primary('a'), kw('a b'), kw('a c', { selected: false })] }, ['A']);
  assert.deepStrictEqual(c, [{ group: 'A', keyword: 'a b', volume: 100 }]);
});
check('serviceEntryFor：补的服务进 services.json 的形状（图标借本站第一个服务的）', () => {
  const e = K.serviceEntryFor({ id: 'plumbing', name: 'plumbing' }, [{ id: 'x', icon: 'droplet' }]);
  assert.deepStrictEqual(e, { id: 'plumbing', name: 'plumbing', shortDescription: '', fullDescription: '', icon: 'droplet', features: [], products: [] });
});

// ── 素材 ──────────────────────────────────────────────────────────────────────────────────────────
console.log('── 素材：只给这一页的');
const PAYLOAD = {
  address: '2150 Yonge Street, Toronto', phone: '(416) 555-0199', location: 'Toronto, ON',
  services: ['Plumbing', 'Water Heaters'],
  keywords: {
    Plumbing: [primary('plumbing'), kw('plumbing Markham'), kw('plumbing Toronto')],
    'Water Heaters': [primary('water heaters'), kw('tankless water heater')],
  },
  reviews: [
    { author: 'Ann', rating: 5, text: 'They fixed our basement leak in Markham the same afternoon.' },
    { author: 'Bob', rating: 5, text: 'Great plumbing work, very tidy and on time.' },
    { author: 'Cy', rating: 2, text: 'Late to our Markham house.' },
  ],
  keywordMaterial: {
    Plumbing: { questions: ['How much does a plumber cost?', 'Do plumbers fix leaks?'], unselected: ['plumber near me', 'plumbing Toronto'] },
    'Water Heaters': { questions: ['How long do water heaters last?'], unselected: ['hot water tank'] },
  },
};
const PLAN = K.planKeywordPages({
  keywords: PAYLOAD.keywords, services: PAYLOAD.services,
  contentServices: [{ id: 'plumbing', name: 'Plumbing' }, { id: 'water-heaters', name: 'Water Heaters' }],
});
const markham = PLAN.pages.find((p) => p.keyword === 'plumbing Markham');
const toronto = PLAN.pages.find((p) => p.keyword === 'plumbing Toronto');
check('地名候选：去掉服务词（按词干）和修饰词', () => {
  assert.deepStrictEqual(K.placeTokens('emergency plumber Markham', ['Plumbing', 'plumbing']), ['markham']);
  assert.deepStrictEqual(K.placeTokens('drain cleaning north york', ['Drain Cleaning']), ['north', 'york']);
  assert.deepStrictEqual(K.placeTokens('万锦 剪头发', ['理发']), ['万锦']);
});
check('带地名的评价：只认大写开头的整词（评价里普通单词不算）', () => {
  assert.strictEqual(K.mentionsPlace('fixed it in Markham today', 'markham'), true);
  assert.strictEqual(K.mentionsPlace('the markham way', 'markham'), false);
  assert.strictEqual(K.mentionsPlace('Markhamville', 'markham'), false);
});
check('Markham 那页：带 Markham 的好评在，不带的不在，差评不在', () => {
  const m = K.keywordPageMaterial(markham, PAYLOAD);
  assert.deepStrictEqual(m.reviews.map((r) => r.author), ['Ann']);
  assert.strictEqual(m.address, PAYLOAD.address);
  assert.strictEqual(m.phone, PAYLOAD.phone);
});
check('Toronto 那页：Markham 那条评价不在', () => {
  const m = K.keywordPageMaterial(toronto, PAYLOAD);
  assert.deepStrictEqual(m.reviews, []);
});
check('问题 / 联想词只取本服务组的；已经选中建页的词不当联想词', () => {
  const m = K.keywordPageMaterial(markham, PAYLOAD);
  assert.deepStrictEqual(m.questions, ['How much does a plumber cost?', 'Do plumbers fix leaks?']);
  assert.deepStrictEqual(m.relatedSearches, ['plumber near me']);
});

// ── 提示词 ────────────────────────────────────────────────────────────────────────────────────────
console.log('── 单页提示词');
const promptOf = (page) => K.keywordPagePrompt({
  page, material: K.keywordPageMaterial(page, PAYLOAD), companyName: 'Bright Pipes', industry: 'plumbing', location: 'Toronto, ON',
  sectionOptions: '1. "page-header"', sitePrimaryKeyword: 'plumbing',
});
check('含地址、电话原文；含带地名那条评价原文；含本组问题；含「服务只写一句 + 链到服务页」', () => {
  const p = promptOf(markham);
  for (const needle of [PAYLOAD.address, PAYLOAD.phone, PAYLOAD.reviews[0].text, 'How much does a plumber cost?',
    'describe Plumbing itself in ONE sentence only and link to its service page (/services/plumbing)', `slug: "${markham.path}"`]) {
    assert.ok(p.includes(needle), `少了：${needle}`);
  }
});
check('不含：不带地名的评价、另一服务组的问题 / 联想词', () => {
  const p = promptOf(markham);
  for (const needle of [PAYLOAD.reviews[1].text, 'How long do water heaters last?', 'hot water tank']) assert.ok(!p.includes(needle), `多了：${needle}`);
});
check('Toronto 那页的提示词不含 Markham 那条评价', () => assert.ok(!promptOf(toronto).includes(PAYLOAD.reviews[0].text)));
check('事实只许来自表格那一条在', () => assert.ok(promptOf(markham).includes('FACTS ONLY FROM')));
check('#1549：title 用调用方给的预算说法（缺省 max 60）、description 70–155、每张图写 alt', () => {
  const spec = 'max 45 chars; " | Bright Pipes" is appended automatically — do not add it yourself';
  const p = K.keywordPagePrompt({ page: markham, material: K.keywordPageMaterial(markham, PAYLOAD), companyName: 'Bright Pipes', industry: 'plumbing',
    sectionOptions: '1. "page-header"', titleSpec: spec });
  assert.ok(p.includes(`"title": "<Page Title with the keyword, ${spec}>"`), '预算');
  assert.ok(promptOf(markham).includes('"title": "<Page Title with the keyword, max 60 chars>"'), '缺省');
  assert.ok(p.includes('70–155 chars') && !p.includes('max 155'), 'description');
  assert.ok(p.includes('gets an "alt"'), 'alt');
});

// ── 单页合格判据 ──────────────────────────────────────────────────────────────────────────────────
console.log('── 单页合格判据');
const good = { slug: markham.path, title: 'T', sections: [{ type: 'page-header', data: { headline: 'h' } }] };
check('合格：slug 对、有 title、有 sections、validate 没问题 ⟹ []', () => assert.deepStrictEqual(K.keywordPageProblems(good, markham, () => []), []));
check('slug 不对 ⟹ 报出来（不调 validate）', () => {
  let called = false;
  const p = K.keywordPageProblems({ ...good, slug: 'plumbing/plumbing-markham' }, markham, () => { called = true; return []; });
  assert.ok(p[0].includes('slug 必须是'));
  assert.strictEqual(called, false);
});
check('回的是数组 / 没 sections ⟹ 不合格', () => {
  assert.ok(K.keywordPageProblems([good], markham)[0].includes('数组'));
  assert.ok(K.keywordPageProblems({ ...good, sections: [] }, markham).some((x) => x.includes('sections')));
});
check('validate 报的问题原样带出', () => assert.deepStrictEqual(K.keywordPageProblems(good, markham, () => ['x 缺必填槽']), ['x 缺必填槽']));

check('removePagesListBlocks：只拿掉指向这个服务的列表块，别的块和指向别处的列表留着', () => {
  const pg = { slug: 'services/heaters', sections: [
    { type: 'page-header', data: { headline: 'Heaters' } },
    { type: 'features', data: { headline: 'Related', items: { source: 'pages', under: 'services/heaters' } } },
    { type: 'features', data: { headline: 'Other', items: { source: 'pages', under: 'services/plumbing' } } },
    { type: 'features', data: { headline: 'Why us', items: [{ title: 'Fast' }] } },
  ] };
  assert.strictEqual(K.removePagesListBlocks(pg, 'heaters'), 1);
  assert.deepStrictEqual(pg.sections.map((b) => b.data.headline), ['Heaters', 'Other', 'Why us']);
  assert.strictEqual(K.removePagesListBlocks(undefined, 'heaters'), 0);
});

// ── 详情页兜底 ────────────────────────────────────────────────────────────────────────────────────
console.log('── 服务详情页：必须存在，并列出它下面的关键词页（under 由代码填）');
const SERVICES = [{ id: 'plumbing', name: 'Plumbing', shortDescription: 'Pipes', fullDescription: 'All pipes.' }, { id: 'heaters', name: 'Heaters' }];
check('缺席 ⟹ 按服务数据补出：page-header + content + features {source: pages, under: services/<id>}', () => {
  const pages = [{ slug: 'home', sections: [] }];
  const r = K.ensureServiceDetailPages({ pages, services: SERVICES, serviceIds: ['plumbing'], locale: 'en' });
  assert.deepStrictEqual(r, { added: ['plumbing'], patched: [], failed: [] });
  const d = pages.find((p) => p.slug === 'services/plumbing');
  assert.strictEqual(d.serviceDetailPage, true);
  assert.strictEqual(d.parentService, 'plumbing');
  assert.deepStrictEqual(d.sections.map((b) => b.type), ['page-header', 'content', 'features']);
  assert.deepStrictEqual(d.sections[2].data, { headline: 'Related pages', items: { source: 'pages', under: 'services/plumbing' } });
});
check('AI 写了详情页、under 指错 ⟹ 改成对的', () => {
  const pages = [{ slug: 'services/plumbing', serviceDetailPage: true, sections: [{ type: 'features', data: { headline: 'x', items: { source: 'pages', under: 'plumbing' } } }] }];
  const r = K.ensureServiceDetailPages({ pages, services: SERVICES, serviceIds: ['plumbing'], locale: 'en' });
  assert.deepStrictEqual(r.patched, ['plumbing']);
  assert.strictEqual(pages[0].sections[0].data.items.under, 'services/plumbing');
});
check('AI 写了详情页、没列关键词页 ⟹ 补一个 features，插在最后那个 cta 之前', () => {
  const pages = [{ slug: 'services/plumbing', sections: [{ type: 'page-header', data: {} }, { type: 'cta', data: {} }] }];
  K.ensureServiceDetailPages({ pages, services: SERVICES, serviceIds: ['plumbing'], locale: 'zh' });
  assert.deepStrictEqual(pages[0].sections.map((b) => b.type), ['page-header', 'features', 'cta']);
  assert.strictEqual(pages[0].sections[1].data.headline, '相关页面');
});
check('服务目录里没有这个 id ⟹ failed（调用方让建站失败）', () => {
  const r = K.ensureServiceDetailPages({ pages: [], services: SERVICES, serviceIds: ['nope'], locale: 'en' });
  assert.deepStrictEqual(r.failed, ['nope']);
});
check('features 被后台关掉 ⟹ 页照补，不加列表块', () => {
  const pages = [];
  K.ensureServiceDetailPages({ pages, services: SERVICES, serviceIds: ['heaters'], locale: 'en', disabledBlocks: ['features'] });
  assert.deepStrictEqual(pages[0].sections.map((b) => b.type), ['page-header']);
});

// ── 互链 ──────────────────────────────────────────────────────────────────────────────────────────
console.log('── 互链：页尾兄弟页 / 页脚');
check('同服务 ≥2 页：每页页尾加一组兄弟页（插在 cta 前）；只有 1 页的服务不加', () => {
  const pg = (slug) => ({ slug, sections: [{ type: 'content', data: {} }, { type: 'cta', data: {} }] });
  const pages = [pg('services/a/x'), pg('services/a/y'), pg('services/b/z')];
  assert.strictEqual(K.addRelatedBlocks(pages, 'en'), 2);
  assert.deepStrictEqual(pages[0].sections.map((b) => b.type), ['content', 'features', 'cta']);
  assert.deepStrictEqual(pages[0].sections[1].data.items, { source: 'pages', under: 'services/a' });
  assert.deepStrictEqual(pages[2].sections.map((b) => b.type), ['content', 'cta']);
});
const kwPage = (id, n) => ({ slug: `services/${id}/kw-${n}`, title: `Page ${n}` });
check('页脚：≤10 页全列，栏名取服务目录里的名字', () => {
  const cols = K.keywordFooterColumns([1, 2, 3].map((n) => kwPage('plumbing', n)), SERVICES, 'en');
  assert.strictEqual(cols.length, 1);
  assert.strictEqual(cols[0].title, 'Plumbing');
  assert.deepStrictEqual(cols[0].links[0], { label: 'Page 1', href: '/services/plumbing/kw-1' });
});
check('页脚：12 页 ⟹ 10 条，第 10 条是「All 12 pages →」链到服务详情页', () => {
  const cols = K.keywordFooterColumns(Array.from({ length: 12 }, (_, i) => kwPage('plumbing', i + 1)), SERVICES, 'en');
  assert.strictEqual(cols[0].links.length, 10);
  assert.deepStrictEqual(cols[0].links[9], { label: 'All 12 pages →', href: '/services/plumbing' });
  assert.strictEqual(cols[0].links[8].href, '/services/plumbing/kw-9');
});
check('页脚：正好 10 页 ⟹ 10 条都是页，没有「全部」那条', () => {
  const cols = K.keywordFooterColumns(Array.from({ length: 10 }, (_, i) => kwPage('plumbing', i + 1)), SERVICES, 'en');
  assert.strictEqual(cols[0].links.length, 10);
  assert.strictEqual(cols[0].links[9].href, '/services/plumbing/kw-10');
});
check('页脚：中文站「全部 N 页 →」', () => {
  const cols = K.keywordFooterColumns(Array.from({ length: 11 }, (_, i) => kwPage('plumbing', i + 1)), SERVICES, 'zh');
  assert.strictEqual(cols[0].links[9].label, '全部 11 页 →');
});
check('页脚：老形状 `<服务slug>/<词>` 照旧按第一段分组、栏名由 slug 拼', () => {
  const cols = K.keywordFooterColumns([{ slug: 'drain-cleaning/a', title: 'A' }, { slug: 'drain-cleaning/b', title: 'B' }], SERVICES, 'en');
  assert.deepStrictEqual(cols, [{ title: 'Drain Cleaning', links: [{ label: 'A', href: '/drain-cleaning/a' }, { label: 'B', href: '/drain-cleaning/b' }] }]);
});
check('serviceIdOfKeywordPath：只认 services/<id>/<词>', () => {
  assert.strictEqual(K.serviceIdOfKeywordPath('services/a/b'), 'a');
  assert.strictEqual(K.serviceIdOfKeywordPath('services/a'), null);
  assert.strictEqual(K.serviceIdOfKeywordPath('a/b'), null);
});
check('标签：认不得的语言退英语；zh-TW 这类按语言主码退', () => {
  assert.strictEqual(K.labelsFor('xx').related, 'Related pages');
  assert.strictEqual(K.labelsFor('fr-CA').related, 'Pages associées');
});

// ── #1565：AI 写的服务 id 收进上限 ─────────────────────────────────────────────────────────────────
console.log('── #1565 capServiceIds：AI 写的服务 id 收进跟关键词页 slug 同一个上限');
const { SLUG_MAX_BYTES } = require('./keyword-slug');
const LONG = (tail) => `${'drain-cleaning-'.repeat(20)}${tail}`;   // 300 字节起，只在第 300 个字符之后才不同
check('没超上限的 id 一个字不动，页面也不碰', () => {
  const services = [{ id: 'drain-cleaning', name: 'Drain Cleaning' }];
  const pages = [{ slug: 'services/drain-cleaning', parentService: 'drain-cleaning' }];
  assert.deepStrictEqual(K.capServiceIds({ services, pages }), []);
  assert.strictEqual(services[0].id, 'drain-cleaning');
  assert.strictEqual(pages[0].slug, 'services/drain-cleaning');
});
check('300 字节的 id ⟹ 截在上限里（在连字符处），服务名不动', () => {
  const id = LONG('x');
  assert.strictEqual(Buffer.byteLength(id), 301, '阳性对照：喂进去的真的超了');
  const services = [{ id, name: 'N'.repeat(300) }];
  const [r] = K.capServiceIds({ services, pages: [] });
  assert.strictEqual(r.from, id);
  assert.ok(Buffer.byteLength(services[0].id) <= SLUG_MAX_BYTES, `${Buffer.byteLength(services[0].id)}`);
  assert.ok(id.startsWith(`${services[0].id}-`), services[0].id);
  assert.strictEqual(services[0].name, 'N'.repeat(300));
});
check('页面里指着旧 id 的地方一起改：详情页 slug / parentService / /services/<id> 链接 / under / 子路径；别的服务不碰', () => {
  const id = LONG('x');
  const services = [{ id, name: 'Long' }, { id: 'water-heaters', name: 'Water Heaters' }];
  const pages = [
    { slug: `services/${id}`, parentService: id, serviceDetailPage: true, sections: [
      { type: 'cta', data: { ctas: [{ label: 'Go', href: `/services/${id}` }, { label: 'Q', href: `/services/${id}?a=1#b` }] } },
      { type: 'features', data: { items: { source: 'pages', under: `services/${id}` } } }] },
    { slug: `services/${id}/sub`, sections: [{ type: 'cta', data: { ctas: [{ label: 'W', href: '/services/water-heaters' }] } }] },
    { slug: 'services/water-heaters', parentService: 'water-heaters' },
  ];
  const navigation = { ctaPage: `services/${id}` };
  K.capServiceIds({ services, pages, navigation });
  const nu = services[0].id;
  assert.strictEqual(pages[0].slug, `services/${nu}`);
  assert.strictEqual(pages[0].parentService, nu);
  assert.deepStrictEqual(pages[0].sections[0].data.ctas.map((c) => c.href), [`/services/${nu}`, `/services/${nu}?a=1#b`]);
  assert.strictEqual(pages[0].sections[1].data.items.under, `services/${nu}`);
  assert.strictEqual(pages[1].slug, `services/${nu}/sub`);
  assert.strictEqual(pages[1].sections[0].data.ctas[0].href, '/services/water-heaters');
  assert.strictEqual(pages[2].slug, 'services/water-heaters');
  assert.strictEqual(services[1].id, 'water-heaters');
  assert.strictEqual(navigation.ctaPage, `services/${nu}`);
  assert.ok(!JSON.stringify(pages).includes(id), '旧 id 一处不剩');
});
check('AC5：两个只在第 300 个字符之后才不同的 id ⟹ 两个不同，且都在上限里（含带去重后缀那一个）', () => {
  const services = [{ id: LONG('aaa'), name: 'A' }, { id: LONG('bbb'), name: 'B' }];
  const r = K.capServiceIds({ services, pages: [] });
  assert.strictEqual(r.length, 2);
  const [a, b] = services.map((s) => s.id);
  assert.notStrictEqual(a, b);
  assert.ok(b.endsWith('-2'), b);
  for (const x of [a, b]) assert.ok(Buffer.byteLength(x) <= SLUG_MAX_BYTES, `${x.length}`);
});
check('截出来的 id 跟一个本来就没超的服务撞了 ⟹ 截的那个让路（加 -2），没超的那个不动', () => {
  const short = K.capServiceIds({ services: [{ id: LONG('x'), name: 'L' }], pages: [] });
  const services = [{ id: LONG('x'), name: 'L' }, { id: short[0].to, name: 'Short' }];
  K.capServiceIds({ services, pages: [] });
  assert.strictEqual(services[1].id, short[0].to);
  assert.ok(services[0].id.endsWith('-2') && services[0].id !== services[1].id, services[0].id);
  assert.ok(Buffer.byteLength(services[0].id) <= SLUG_MAX_BYTES, `${services[0].id.length}`);
});
check('超长且转写不了（假名）⟹ 退服务名的 slug；服务名也转不了 ⟹ service-<序号>', () => {
  const s1 = [{ id: 'す'.repeat(100), name: 'Drain Cleaning' }];
  K.capServiceIds({ services: s1, pages: [] });
  assert.strictEqual(s1[0].id, 'drain-cleaning');
  const s2 = [{ id: 'ok', name: 'x' }, { id: 'す'.repeat(100), name: 'すいどう' }];
  K.capServiceIds({ services: s2, pages: [] });
  assert.strictEqual(s2[1].id, 'service-2');
});
check('超长的多字节 id（按字节判，不按字符数）⟹ 也收进上限', () => {
  const id = 'é'.repeat(200);   // 200 个字符、400 字节
  const services = [{ id, name: 'E' }];
  K.capServiceIds({ services, pages: [] });
  assert.ok(Buffer.byteLength(services[0].id) <= SLUG_MAX_BYTES, services[0].id);
  assert.ok(/^e+$/.test(services[0].id), services[0].id);
});

console.log('── #1568 r2 dropKeywordPagesFromPlan：站级回包里混进来的关键词页丢掉');
{
  const slugsOf = (r) => r.pages.map((p) => p.slug);
  const KW = ['剪发', '剪发店', '男士理发'];   // 候选词（选中的非主词）：jian-fa / jian-fa-dian / nan-shi-li-fa
  check('Chris 10-05 那两次的形状全丢：顶层 jian-fa / jian-fa-dian、旧形状 haircut/nan-shi-li-fa、T6 形状 services/haircut/jian-fa', () => {
    const r = K.dropKeywordPagesFromPlan({
      pages: ['home', 'services', 'about', 'quote', 'services/haircut', 'jian-fa', 'jian-fa-dian', 'haircut/nan-shi-li-fa', 'services/haircut/jian-fa'].map((slug) => ({ slug })),
      keywords: KW, serviceIds: ['haircut'], keep: ['quote'],
    });
    assert.deepStrictEqual(slugsOf(r), ['home', 'services', 'about', 'quote', 'services/haircut']);
    assert.deepStrictEqual(r.dropped.map((d) => d.slug), ['jian-fa', 'jian-fa-dian', 'haircut/nan-shi-li-fa', 'services/haircut/jian-fa']);
    assert.ok(r.dropped.every((d) => d.why), '每一页都写了为什么');
  });
  check('末段就是词本身（AI 没转写）⟹ 也算重合', () => {
    const r = K.dropKeywordPagesFromPlan({ pages: [{ slug: 'home' }, { slug: '剪发店' }], keywords: KW, serviceIds: [] });
    assert.deepStrictEqual(slugsOf(r), ['home']);
  });
  check('不误伤：服务 id 恰好是词的拼音（服务「剪发」id jian-fa）⟹ 它的详情页 services/jian-fa 留着', () => {
    const r = K.dropKeywordPagesFromPlan({ pages: [{ slug: 'services/jian-fa' }], keywords: KW, serviceIds: ['jian-fa'] });
    assert.deepStrictEqual(slugsOf(r), ['services/jian-fa']);
  });
  check('不误伤：home 和 CTA 页撞上词也留着；不认识的服务 id 的两段页照旧留（r1 起就照常生成）', () => {
    const r = K.dropKeywordPagesFromPlan({
      pages: [{ slug: 'home' }, { slug: 'quote' }, { slug: 'services/other' }],
      keywords: ['home', 'quote'], serviceIds: ['cut'], keep: ['quote'],
    });
    assert.deepStrictEqual(slugsOf(r), ['home', 'quote', 'services/other']);
  });
  check('阳性对照：同一个 quote 不在 keep 里 ⟹ 按重合丢（上一格的「留着」是 keep 起的作用）', () => {
    const r = K.dropKeywordPagesFromPlan({ pages: [{ slug: 'quote' }], keywords: ['quote'], serviceIds: [] });
    assert.deepStrictEqual(slugsOf(r), []);
  });
  check('没有候选词：一段的正常页一个不动；两段非 services 的照样按形状丢', () => {
    const pages = ['home', 'services', 'about', 'services/cut', 'cut/x'].map((slug) => ({ slug }));
    const r = K.dropKeywordPagesFromPlan({ pages, keywords: [], serviceIds: ['cut'] });
    assert.deepStrictEqual(slugsOf(r), ['home', 'services', 'about', 'services/cut']);
    assert.strictEqual(r.pages[0], pages[0], '留下的是原对象');
  });
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
