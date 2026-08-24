#!/usr/bin/env node
/**
 * breadcrumb-links.test.js — #1176 那个面包屑修法的体检。
 *
 * 跑法:  node scripts/lib/breadcrumb-links.test.js   （也被 `npm run test:scripts` 自动发现，CI 跑）
 * 退出码: 0 全过 · 1 有失败 · 2 跑不起来（**不许当成通过**）
 *
 * 🔴 为什么这份体检必须是**确定性**的：真跑一次 AI 建站不能当这个修法的体检 —— 同一份两服务的
 *    payload，一次 AI 照着提示词里那句「Skip service detail pages」跳过了服务详情页（#1162 那个
 *    Cedar Hill Plumbing 站，于是面包屑中间级是编出来的死链），另一次它照样生成了两页服务详情页
 *    （本票 2026-08-24 那一跑 `dev2-1176-before`，于是面包屑指的页面真的存在）。**两跑都真**，
 *    而只有前者能让那条死链出现。一个只在硬币翻对面时才红得出来的检查等于没有检查，所以下面两个
 *    形态各钉一格，夹具是**从那两次真跑里原样抄下来的面包屑**。
 *
 * 🔴 每一格都配了能把它弄红的那一臂：不只测「该删的删了」，也测「不该删的一个都没动」。
 *    只有前一半时，一个「什么都删」的实现照样全绿。
 */

'use strict';

const assert = require('assert');
const { pruneDeadBreadcrumbHrefs, slugFromHref } = require('./breadcrumb-links');

let failed = 0;
function test(name, fn) {
  try {
    fn();
    console.log(`  ✅ ${name}`);
  } catch (err) {
    failed += 1;
    console.error(`  🔴 ${name}\n     ${err.message}`);
  }
}

/** 一页关键词页，面包屑照真跑里的形状写。 */
const kwPage = (slug, crumbs) => ({
  slug,
  sections: [
    { type: 'page-header', data: { title: slug, breadcrumbs: crumbs } },
    { type: 'text-block', data: { content: 'x' } },
  ],
});

console.log('══ #1176 breadcrumb-links 体检 ══');

// ① 形态 A：AI 跳过了服务详情页（#1162 Cedar Hill Plumbing 那一跑）。中间级是编出来的 → 必须去掉 href，
//    而 label 和 Home 那一级必须原样留着。
test('① 服务详情页不存在时，编出来的中间级只去掉 href、保留文字', () => {
  const pages = [
    kwPage('drain-cleaning/emergency-drain-unclogging-victoria', [
      { label: 'Home', href: '/' },
      { label: 'Drain Cleaning', href: '/services/drain-cleaning' },
      { label: 'Emergency Drain Unclogging Victoria' },
    ]),
    kwPage('water-heater-repair/tankless-water-heater-installation-victoria', [
      { label: 'Home', href: '/' },
      { label: 'Water Heater Repair', href: '/services/water-heater-repair' },
      { label: 'Tankless Water Heater Installation Victoria' },
    ]),
  ];
  const known = new Set([
    'home', 'about', 'services', 'quote', 'testimonials', 'areas', 'contact',
    'drain-cleaning/emergency-drain-unclogging-victoria',
    'water-heater-repair/tankless-water-heater-installation-victoria',
  ]);
  const dropped = pruneDeadBreadcrumbHrefs(pages, known);
  assert.deepStrictEqual(dropped, [
    'drain-cleaning/emergency-drain-unclogging-victoria: /services/drain-cleaning',
    'water-heater-repair/tankless-water-heater-installation-victoria: /services/water-heater-repair',
  ]);
  for (const p of pages) {
    const crumbs = p.sections[0].data.breadcrumbs;
    assert.strictEqual(crumbs[0].href, '/', 'Home 那一级不许被动');
    assert.ok(!('href' in crumbs[1]), '中间级的 href 该没了');
    assert.ok(crumbs[1].label.length > 0, '中间级的文字必须留着（面包屑还要读得通）');
    assert.strictEqual(crumbs.length, 3, '不许整级删掉，只删 href');
  }
});

// ② 形态 B：AI 照样生成了服务详情页（本票 `dev2-1176-before` 那一跑，面包屑逐字如下）。
//    那些页面真的存在 → 一个 href 都不许动。这是①的反向臂。
test('② 服务详情页真的存在时，一个 href 都不动（①的反向臂）', () => {
  const pages = [
    kwPage('drain-cleaning/hydro-jetting-victoria-bc', [
      { label: 'Home', href: '/' },
      { label: 'Drain Cleaning', href: '/services/drain-cleaning' },
      { label: 'Hydro Jetting Victoria BC' },
    ]),
  ];
  const known = new Set([
    'home', 'services', 'services/drain-cleaning', 'services/water-heater-repair',
    'drain-cleaning/hydro-jetting-victoria-bc',
  ]);
  const dropped = pruneDeadBreadcrumbHrefs(pages, known);
  assert.deepStrictEqual(dropped, [], `不该删任何东西，实际删了 ${JSON.stringify(dropped)}`);
  assert.strictEqual(pages[0].sections[0].data.breadcrumbs[1].href, '/services/drain-cleaning');
});

// ③ 首页那一级（`/`）永远算存在 —— 没有哪个 slug 叫 ''。漏了这条会把每一页的 Home 都拆掉。
test('③ `/` 和 `home` 都算存在', () => {
  const pages = [kwPage('a/b', [{ label: 'Home', href: '/' }, { label: 'H2', href: '/home' }])];
  assert.deepStrictEqual(pruneDeadBreadcrumbHrefs(pages, new Set(['a/b'])), []);
});

// ④ 站外的东西不判。判据要跟 check-dead-links.js 的射程对齐 —— 那道检查也不看外链。
test('④ 外链 / mailto / tel / 纯锚点一个都不动', () => {
  const crumbs = [
    { label: 'x', href: 'https://example.com/whatever' },
    { label: 'y', href: 'mailto:a@b.c' },
    { label: 'z', href: 'tel:+15550000' },
    { label: 'w', href: '#top' },
    { label: 'v', href: '//cdn.example.com/x' },
  ];
  const pages = [kwPage('a/b', crumbs)];
  assert.deepStrictEqual(pruneDeadBreadcrumbHrefs(pages, new Set(['a/b'])), []);
  assert.strictEqual(crumbs.filter(c => 'href' in c).length, 5, '五条 href 都该还在');
});

// ⑤ 相对路径照判。关键词页住在 `/<服务>/<关键词>`，一个相对 href 会被解析成 `/<服务>/<那一段>`。
test('⑤ 相对路径（不以 / 开头、又不是外链）照样判', () => {
  const pages = [kwPage('drain-cleaning/kw', [{ label: 'S', href: 'services/nope' }])];
  const dropped = pruneDeadBreadcrumbHrefs(pages, new Set(['drain-cleaning/kw']));
  assert.deepStrictEqual(dropped, ['drain-cleaning/kw: services/nope']);
});

// ⑥ 锚点 / 查询串要先剥掉再比 —— 否则 `/services#svc-1` 这种活链会被当成死的（同 check-dead-links.js
//    那条实测：不剥时 #1162 那批产物上多出 4 条误报）。
test('⑥ `#fragment` / `?query` 剥掉之后再比', () => {
  const pages = [kwPage('a/b', [
    { label: 'ok', href: '/services#svc-1' },
    { label: 'ok2', href: '/services?x=1' },
    { label: 'bad', href: '/ghost#svc-2' },
  ])];
  const dropped = pruneDeadBreadcrumbHrefs(pages, new Set(['services', 'a/b']));
  assert.deepStrictEqual(dropped, ['a/b: /ghost#svc-2']);
});

// ⑦ 只碰 page-header。别的块里的 href（CTA 那种）不归它管 —— 那些由 check-dead-links.js 报出来。
test('⑦ 只碰 page-header，别的块一个都不动', () => {
  const page = {
    slug: 'a/b',
    sections: [
      { type: 'cta-banner', data: { button: { label: 'x', href: '/nope' }, breadcrumbs: [{ label: 'q', href: '/nope' }] } },
      { type: 'page-header', data: { breadcrumbs: [{ label: 'p', href: '/nope' }] } },
    ],
  };
  const dropped = pruneDeadBreadcrumbHrefs([page], new Set(['a/b']));
  assert.deepStrictEqual(dropped, ['a/b: /nope']);
  assert.strictEqual(page.sections[0].data.breadcrumbs[0].href, '/nope', 'cta-banner 那一份不该被动');
});

// ⑧ 形状缺东西时不许抛 —— 它跑在真建站的中途，抛了整个建站就没了。
test('⑧ 缺 sections / 缺 breadcrumbs / crumb 是 null 都不抛', () => {
  assert.deepStrictEqual(pruneDeadBreadcrumbHrefs(undefined, new Set()), []);
  assert.deepStrictEqual(pruneDeadBreadcrumbHrefs([{ slug: 'a' }], new Set()), []);
  assert.deepStrictEqual(pruneDeadBreadcrumbHrefs([{ slug: 'a', sections: [{ type: 'page-header', data: {} }] }], new Set()), []);
  assert.deepStrictEqual(
    pruneDeadBreadcrumbHrefs([{ slug: 'a', sections: [{ type: 'page-header', data: { breadcrumbs: [null, {}, { href: 5 }] } }] }], new Set()),
    [],
  );
});

// ⑨ slugFromHref 自己那张表（上面几格都经它，单独钉一次让读的人不用反推）。
test('⑨ slugFromHref: 站内的给出可比的 slug，站外的给 null', () => {
  assert.strictEqual(slugFromHref('/services/x/'), 'services/x');
  assert.strictEqual(slugFromHref('/'), '');
  assert.strictEqual(slugFromHref('services/x'), 'services/x');
  assert.strictEqual(slugFromHref('/a?b=c#d'), 'a');
  assert.strictEqual(slugFromHref('https://x.test/a'), null);
  assert.strictEqual(slugFromHref('#a'), null);
  assert.strictEqual(slugFromHref('//x.test/a'), null);
  assert.strictEqual(slugFromHref(''), null);
  assert.strictEqual(slugFromHref(undefined), null);
});

if (failed > 0) {
  console.error(`\n🔴 #1176 breadcrumb-links 体检: ${failed} 格失败`);
  process.exit(1);
}
console.log('\n✅ #1176 breadcrumb-links 体检: 9/9 通过');
