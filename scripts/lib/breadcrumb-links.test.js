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
const {
  pruneDeadBreadcrumbHrefs, slugFromHref, alignBreadcrumbsToOwnService, serviceDetailIndex,
} = require('./breadcrumb-links');

let failed = 0;
let ran = 0;
function test(name, fn) {
  ran += 1;
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

// ══ #1184 —— 「活着但指错服务」那一半 ═══════════════════════════════════════════════════════════
//
// 夹具是 2026-08-24 从 #1176 交付形态的真机产物里**原样抄下来**的（容器 `qa2a-1176-after`，
// 2 个服务 Drain Cleaning / Water Heater Repair，关键词挂在第三个服务 Sump Pump Installation 上）：
//   sump-pump-installation/backup-sump-pump-battery-victoria.json
//     [{"label":"Home","href":"/"},{"label":"Sump Pump Installation","href":"/services/water-heater-repair"},…]
//   sump-pump-installation/basement-flood-prevention-victoria.json
//     [{"label":"Home","href":"/"},{"label":"Sump Pump Installation","href":"/services/drain-cleaning"},…]
// 那两个目标页真的存在（`ls site/en/pages/services` → 两份），所以 #1176 那道读到 0 条死链。
//
// 🔴 **每一格都配了能把它弄红的那一臂。** 特别是⑫：那一页自己的详情页是 water-heater-repair，而清单里
//    第一个是 drain-cleaning ⟹ 一个「挑清单里第一个」的坏修法在⑫和⑩上当场红（本票 AC4 就是驱动这件事）。

console.log('\n══ #1184 面包屑指对没有 体检 ══');

/** Call 1 出的页面清单（真机形态：`parentService` 是 slug 形态，两个服务各一页详情页）。 */
const sitePages2 = [
  { slug: 'home' }, { slug: 'about' }, { slug: 'services' }, { slug: 'quote' },
  { slug: 'services/drain-cleaning', serviceDetailPage: true, parentService: 'drain-cleaning' },
  { slug: 'services/water-heater-repair', serviceDetailPage: true, parentService: 'water-heater-repair' },
];
/** `keywordPagesFrom()` 的产物形态。 */
const kwList = (service, serviceSlug, keywordSlugs) => keywordSlugs.map((k) => ({
  service, serviceSlug, keyword: k, keywordSlug: k, nestedSlug: `${serviceSlug}/${k}`,
}));

test('⑩ 真机那两页：服务没有自己的详情页 ⟹ 去掉 href、文字留着（本票的病）', () => {
  const pages = [
    kwPage('sump-pump-installation/backup-sump-pump-battery-victoria', [
      { label: 'Home', href: '/' },
      { label: 'Sump Pump Installation', href: '/services/water-heater-repair' },
      { label: 'Backup Sump Pump Battery Victoria' },
    ]),
    kwPage('sump-pump-installation/basement-flood-prevention-victoria', [
      { label: 'Home', href: '/' },
      { label: 'Sump Pump Installation', href: '/services/drain-cleaning' },
      { label: 'Basement Flood Prevention Victoria' },
    ]),
  ];
  const changes = alignBreadcrumbsToOwnService(pages, sitePages2, kwList(
    'Sump Pump Installation', 'sump-pump-installation',
    ['backup-sump-pump-battery-victoria', 'basement-flood-prevention-victoria'],
  ));
  assert.strictEqual(changes.length, 2, `该改两处,实际 ${JSON.stringify(changes)}`);
  for (const p of pages) {
    const crumbs = p.sections[0].data.breadcrumbs;
    assert.strictEqual(crumbs[0].href, '/', 'Home 那一级不许被动');
    assert.ok(!('href' in crumbs[1]), '指错的那一级的 href 该没了');
    assert.strictEqual(crumbs[1].label, 'Sump Pump Installation', '文字必须原样留着');
    assert.strictEqual(crumbs.length, 3, '不许整级删掉');
  }
});

test('⑪ 反向臂（AC2）：服务有自己的详情页、模型指的就是它 ⟹ 一处不改', () => {
  const pages = [kwPage('drain-cleaning/hydro-jetting-victoria-bc', [
    { label: 'Home', href: '/' },
    { label: 'Drain Cleaning', href: '/services/drain-cleaning' },
    { label: 'Hydro Jetting Victoria BC' },
  ])];
  const changes = alignBreadcrumbsToOwnService(pages, sitePages2,
    kwList('Drain Cleaning', 'drain-cleaning', ['hydro-jetting-victoria-bc']));
  assert.deepStrictEqual(changes, [], `不该改任何东西,实际 ${JSON.stringify(changes)}`);
  assert.strictEqual(pages[0].sections[0].data.breadcrumbs[1].href, '/services/drain-cleaning');
});

test('⑫ 有自己的详情页、却指了别人家 ⟹ 改成【自己那个】,不是清单里第一个', () => {
  const pages = [kwPage('water-heater-repair/tankless-install-victoria', [
    { label: 'Home', href: '/' },
    { label: 'Water Heater Repair', href: '/services/drain-cleaning' },   // ← 清单里第一个
    { label: 'Tankless Install Victoria' },
  ])];
  const changes = alignBreadcrumbsToOwnService(pages, sitePages2,
    kwList('Water Heater Repair', 'water-heater-repair', ['tankless-install-victoria']));
  assert.strictEqual(pages[0].sections[0].data.breadcrumbs[1].href, '/services/water-heater-repair');
  assert.strictEqual(changes.length, 1, `该改一处,实际 ${JSON.stringify(changes)}`);
});

test('⑬ 有自己的详情页、而那一级没有 href（模型漏了,或被 #1176 那道剥掉了）⟹ 按文字补上', () => {
  const pages = [kwPage('drain-cleaning/emergency-unclogging-victoria', [
    { label: 'Home', href: '/' },
    { label: 'Drain Cleaning' },
    { label: 'Emergency Unclogging Victoria' },
  ])];
  const changes = alignBreadcrumbsToOwnService(pages, sitePages2,
    kwList('Drain Cleaning', 'drain-cleaning', ['emergency-unclogging-victoria']));
  assert.strictEqual(pages[0].sections[0].data.breadcrumbs[1].href, '/services/drain-cleaning');
  assert.strictEqual(changes.length, 1, `该补一处,实际 ${JSON.stringify(changes)}`);
});

test('⑭ 不是服务详情页的 href 一个都不碰（`/services` 索引页 · `/quote` · 外链）', () => {
  const crumbs = [
    { label: 'Home', href: '/' },
    { label: 'Services', href: '/services' },
    { label: 'Ask', href: '/quote' },
    { label: 'X', href: 'https://example.com/services/drain-cleaning' },
    { label: 'Basement Flood Prevention Victoria' },
  ];
  const pages = [kwPage('sump-pump-installation/basement-flood-prevention-victoria', crumbs)];
  const changes = alignBreadcrumbsToOwnService(pages, sitePages2, kwList(
    'Sump Pump Installation', 'sump-pump-installation', ['basement-flood-prevention-victoria'],
  ));
  assert.deepStrictEqual(changes, [], `不该改任何东西,实际 ${JSON.stringify(changes)}`);
  assert.strictEqual(crumbs.filter((c) => 'href' in c).length, 4, '四条 href 都该还在');
});

test('⑮ `parentService` 被 AI 写成显示名时也对得上（末段那一半键）', () => {
  const sitePagesDisplayName = [
    { slug: 'services/drain-cleaning', serviceDetailPage: true, parentService: 'Drain Cleaning' },
    { slug: 'services/water-heater-repair', serviceDetailPage: true, parentService: 'Water Heater Repair' },
  ];
  const idx = serviceDetailIndex(sitePagesDisplayName);
  assert.strictEqual(idx.byServiceKey.get('drain-cleaning'), 'services/drain-cleaning');
  assert.strictEqual(idx.detailSlugs.size, 2);
  const pages = [kwPage('drain-cleaning/kw', [
    { label: 'Home', href: '/' },
    { label: 'Drain Cleaning', href: '/services/water-heater-repair' },
    { label: 'Kw' },
  ])];
  alignBreadcrumbsToOwnService(pages, sitePagesDisplayName, kwList('Drain Cleaning', 'drain-cleaning', ['kw']));
  assert.strictEqual(pages[0].sections[0].data.breadcrumbs[1].href, '/services/drain-cleaning');
});

test('⑯ 不在关键词页清单里的那一页：不知道它属于哪个服务 ⟹ 一个字节都不动', () => {
  const pages = [kwPage('services/drain-cleaning', [
    { label: 'Home', href: '/' },
    { label: 'Services', href: '/services' },
    { label: 'Drain Cleaning' },
  ])];
  const changes = alignBreadcrumbsToOwnService(pages, sitePages2, kwList('Drain Cleaning', 'drain-cleaning', ['kw']));
  assert.deepStrictEqual(changes, []);
});

test('⑰ 缺 sections / 缺 breadcrumbs / crumb 是 null / 清单是空的 都不抛', () => {
  assert.deepStrictEqual(alignBreadcrumbsToOwnService(undefined, undefined, undefined), []);
  assert.deepStrictEqual(alignBreadcrumbsToOwnService([{ slug: 'a/b' }], sitePages2, kwList('A', 'a', ['b'])), []);
  assert.deepStrictEqual(
    alignBreadcrumbsToOwnService(
      [{ slug: 'a/b', sections: [{ type: 'page-header', data: { breadcrumbs: [null, {}, { href: 5 }] } }] }],
      sitePages2, kwList('A', 'a', ['b']),
    ),
    [],
  );
  assert.deepStrictEqual(serviceDetailIndex(undefined).detailSlugs.size, 0);
});

test('⑱ 两道串起来（真跑里的顺序：先剥死链、再对齐）：死的中间级被剥掉之后,对的那条被补回来', () => {
  const pages = [kwPage('drain-cleaning/kw', [
    { label: 'Home', href: '/' },
    { label: 'Drain Cleaning', href: '/services/sump-pump-installation' },   // 这一页不存在
    { label: 'Kw' },
  ])];
  const known = new Set([
    'home', 'about', 'services', 'quote',
    'services/drain-cleaning', 'services/water-heater-repair', 'drain-cleaning/kw',
  ]);
  const dropped = pruneDeadBreadcrumbHrefs(pages, known);
  assert.deepStrictEqual(dropped, ['drain-cleaning/kw: /services/sump-pump-installation']);
  const changes = alignBreadcrumbsToOwnService(pages, sitePages2, kwList('Drain Cleaning', 'drain-cleaning', ['kw']));
  assert.strictEqual(changes.length, 1);
  assert.strictEqual(pages[0].sections[0].data.breadcrumbs[1].href, '/services/drain-cleaning');
});

test('⑲ 盘上那份产物用的是 `blocks`（#998 写盘时转的）—— 那个形状也要认，否则拿真产物跑是空操作', () => {
  // 夹具逐字来自 `dev2-1184-offsvc3-before` 的盘上产物（3 服务都出了详情页，关键词挂在第四个服务上）：
  //   site/en/pages/sump-pump-installation/backup-sump-pump-battery-victoria.json
  const page = {
    slug: 'sump-pump-installation/backup-sump-pump-battery-victoria',
    blocks: [{
      id: 'kw-page-header', type: 'page-header', role: 'essential', region: 'content', weight: 0,
      data: {
        title: 'Backup Sump Pump Battery Victoria',
        breadcrumbs: [
          { label: 'Home', href: '/' },
          { label: 'Sump Pump Installation', href: '/services/drain-cleaning' },
          { label: 'Backup Sump Pump Battery Victoria' },
        ],
      },
    }],
  };
  const sitePages = [
    { slug: 'services/drain-cleaning', serviceDetailPage: true, parentService: 'drain-cleaning' },
    { slug: 'services/water-heater-repair', serviceDetailPage: true, parentService: 'water-heater-repair' },
    { slug: 'services/faucet-repair', serviceDetailPage: true, parentService: 'faucet-repair' },
  ];
  const changes = alignBreadcrumbsToOwnService([page], sitePages, kwList(
    'Sump Pump Installation', 'sump-pump-installation', ['backup-sump-pump-battery-victoria'],
  ));
  assert.strictEqual(changes.length, 1, `该改一处,实际 ${JSON.stringify(changes)}`);
  const crumbs = page.blocks[0].data.breadcrumbs;
  assert.ok(!('href' in crumbs[1]), 'href 该没了');
  assert.strictEqual(crumbs[1].label, 'Sump Pump Installation');
});

if (failed > 0) {
  console.error(`\n🔴 breadcrumb-links 体检（#1176 + #1184）: ${failed}/${ran} 格失败`);
  process.exit(1);
}
console.log(`\n✅ breadcrumb-links 体检（#1176 + #1184）: ${ran}/${ran} 通过`);
