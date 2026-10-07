#!/usr/bin/env node
'use strict';
/**
 * upgrade-related-links.test.js —— #1639：「更新网站」之后，关键词页页尾照样有一条回服务详情页的链接。
 *
 *   跑法:  node scripts/lib/upgrade-related-links.test.js  （或 `npm run test:scripts`，它按文件名发现）
 *   退出码: 0 全过 · 1 有失败 · 2 跑不起来（**不许当成通过**）
 *
 * #1630 删了面包屑，回服务详情页改走页尾「相关页面」第一条，那一条靠引用参数 `withParent: true`。写它的只有建站路
 * （`keyword-pages.js` §addRelatedBlocks）。升级不重新建站 ⟹ 升级的迁移那一步（`site-data-migration.js`）调同一个函数补上。
 *
 * 走的是升级真正跑的那个入口：`node scripts/upgrade-site-data.js --root <模板> --site <站>`（worker §runDataMigration 同一条命令形状）。
 * 夹具是「#1630 之前」的磁盘形状：#998 之后的 `blocks`（id / role / region / weight / data），外加一份 #998 之前的 `sections` 站。
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const NEXT = path.resolve(__dirname, '..', '..');
const ENTRY = path.join(NEXT, 'scripts', 'upgrade-site-data.js');
const IS = require('./item-sources.js');

let pass = 0; let fail = 0;
const check = (cond, m, extra) => {
  if (cond) { pass += 1; console.log(`  ✅ ${m}`); } else { fail += 1; console.log(`  ❌ ${m}${extra !== undefined ? ` —— ${extra}` : ''}`); }
};

const SERVICES = [
  { id: 'brakes', name: 'Brake Repair', shortDescription: 'Pads and rotors.' },
  { id: 'tires', name: 'Tire Service', shortDescription: 'Swaps and storage.' },
];

// #998 之后写盘的块（同 blocks.js §pageWithBlocks 的键）。
const blk = (slug, type, i, data) => ({ id: `${slug.replace(/\//g, '-')}-${type}-${i}`, type, role: type === 'features' ? 'essential' : 'essential', region: 'content', weight: i * 10, data });
const kwPage = (slug, title, extra = []) => {
  const blocks = [
    blk(slug, 'page-header', 0, { headline: title }),
    blk(slug, 'content', 1, { body: `About ${title}.` }),
    ...extra.map((d, k) => blk(slug, 'features', 2 + k, d)),
  ];
  blocks.push(blk(slug, 'cta', blocks.length, { headline: 'Book now', ctas: [{ label: 'Contact', href: '/contact', style: 'solid' }] }));
  return { slug, title, description: `${title} in Toronto`, keywordPage: true, blocks };
};
const detailPage = (id) => {
  const slug = `services/${id}`;
  const svc = SERVICES.find((s) => s.id === id);
  return { slug, title: svc.name, description: svc.shortDescription, serviceDetailPage: true, parentService: id,
    blocks: [blk(slug, 'page-header', 0, { headline: svc.name }), blk(slug, 'features', 1, { headline: 'Related', items: { source: 'pages', under: slug } })] };
};
// 乙那一组「#1630 之前」的样子：同服务兄弟页、不带 withParent。
const siblings = (id) => ({ headline: 'Related pages', items: { source: 'pages', under: `services/${id}` } });
// 丙：AI 自己写的、指向**别的服务**的一组。
const otherService = { headline: 'You may also need', items: { source: 'pages', under: 'services/brakes' } };

function makeSite(files) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'up1639-'));
  const siteDir = path.join(root, 'site');
  for (const [rel, doc] of Object.entries(files)) {
    const full = path.join(siteDir, rel);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, `${JSON.stringify(doc, null, 2)}\n`);
  }
  return { root, siteDir };
}
const upgrade = (siteDir) => {
  const r = spawnSync(process.execPath, [ENTRY, '--root', NEXT, '--site', siteDir], { encoding: 'utf-8' });
  const lines = (r.stdout || '').trim().split('\n').filter(Boolean).map((l) => { try { return JSON.parse(l); } catch { return null; } });
  return { rc: r.status, stderr: r.stderr, plan: lines.find((x) => x && x.event === 'plan'), done: lines.find((x) => x && x.event === 'migrated') };
};
const readJSON = (p) => JSON.parse(fs.readFileSync(p, 'utf-8'));
const allPages = (dir) => {
  const out = [];
  const walk = (d) => { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const f = path.join(d, e.name); if (e.isDirectory()) walk(f); else if (e.name.endsWith('.json')) out.push(readJSON(f)); } };
  walk(dir);
  return out;
};
const listOf = (p) => (Array.isArray(p.blocks) ? p.blocks : p.sections);
// 这一页页尾那一组展开之后的条目（同构建：item-sources §pages），按 weight 排序后的最后一个 features 引用块。
function expandedRelated(page, pages, services) {
  const list = listOf(page).map((b, i) => ({ b, w: typeof b.weight === 'number' ? b.weight : i * 10, i }))
    .sort((x, y) => (x.w - y.w) || (x.i - y.i)).map((x) => x.b);
  const refs = list.filter((b) => b.type === 'features' && b.data && b.data.items && b.data.items.source === 'pages'
    && b.data.items.under === page.slug.split('/').slice(0, 2).join('/'));
  if (!refs.length) return { items: [], list };
  const items = IS.expandRef(refs[0].data.items, { pages, services, url: (s) => `/${s}`, pageSlug: page.slug });
  return { items, list, block: refs[0] };
}

// ══ 甲 + 乙 + 丙：一站三种关键词页 ═════════════════════════════════════════════════════════════════
console.log('① 甲（1 个关键词页、没有那一组）· 乙（3 个、有那一组不带 withParent）· 丙（只有指向别的服务那一组）');
const before = {
  'site_meta.json': { defaultLocale: 'en', locales: ['en'] },
  'en/services.json': SERVICES,
  'en/pages/home.json': { slug: 'home', title: 'Home', blocks: [blk('home', 'hero', 0, { headline: 'Hi' })] },
  'en/pages/services/brakes.json': detailPage('brakes'),
  'en/pages/services/tires.json': detailPage('tires'),
  'en/pages/services/brakes/brake-pads-toronto.json': kwPage('services/brakes/brake-pads-toronto', 'Brake pads Toronto'),
  'en/pages/services/tires/winter-tires.json': kwPage('services/tires/winter-tires', 'Winter tires', [siblings('tires')]),
  'en/pages/services/tires/tire-storage.json': kwPage('services/tires/tire-storage', 'Tire storage', [siblings('tires')]),
  'en/pages/services/tires/tire-rotation.json': kwPage('services/tires/tire-rotation', 'Tire rotation', [otherService]),
};
const A = makeSite(before);
const otherBytesBefore = JSON.stringify(readJSON(path.join(A.siteDir, 'en/pages/services/tires/tire-rotation.json')).blocks.find((b) => b.data.items && b.data.items.under === 'services/brakes'));
const r1 = upgrade(A.siteDir);
check(r1.rc === 0 && r1.done, `升级跑完 rc=0（rc=${r1.rc}）`, r1.stderr);
const pagesA = allPages(path.join(A.siteDir, 'en', 'pages'));
const kw = pagesA.filter((p) => p.keywordPage);
check(kw.length === 4, `四个关键词页都在（${kw.length}）`);
for (const p of kw) {
  const id = p.slug.split('/')[1];
  const svc = SERVICES.find((s) => s.id === id);
  const { items, list } = expandedRelated(p, pagesA, SERVICES);
  check(items.length > 0 && items[0].link.href === `/services/${id}` && items[0].title === svc.name,
    `${p.slug}：页尾第一条指 /services/${id}，文字是服务名「${svc.name}」`, JSON.stringify(items[0]));
  check(list[list.length - 1].type === 'cta' && list[list.length - 2].type === 'features',
    `${p.slug}：那一组排在页尾 cta 之前（按 weight）`, list.map((b) => `${b.type}@${b.weight}`).join(' '));
}
const jia = pagesA.find((p) => p.slug === 'services/brakes/brake-pads-toronto');
const added = jia.blocks.find((b) => b.type === 'features');
check(added && added.id && added.role && added.region === 'content' && typeof added.weight === 'number'
  && new Set(jia.blocks.map((b) => b.id)).size === jia.blocks.length,
  '甲：新补的块带齐 id / role / region / weight，id 不撞', JSON.stringify(added));
check(added && added.data.headline === 'Related pages', '甲：标题是这种语言的「相关页面」', added && added.data.headline);
const yi = pagesA.filter((p) => p.slug.startsWith('services/tires/') && p.slug !== 'services/tires/tire-rotation');
check(yi.every((p) => p.blocks.filter((b) => b.type === 'features').length === 1 && p.blocks.find((b) => b.type === 'features').data.items.withParent === true),
  '乙：原来那一组上补了 withParent，没有多出第二组');
const bing = pagesA.find((p) => p.slug === 'services/tires/tire-rotation');
const otherAfter = JSON.stringify(bing.blocks.find((b) => b.data.items && b.data.items.under === 'services/brakes'));
check(otherAfter === otherBytesBefore, '丙：指向别的服务的那一组逐字节不变', otherAfter);
check(bing.blocks.filter((b) => b.type === 'features').length === 2, '丙：另加了本服务那一组（同建站路的规则）');
const det = readJSON(path.join(A.siteDir, 'en/pages/services/brakes.json'));
check(JSON.stringify(det) === JSON.stringify(before['en/pages/services/brakes.json']), '服务详情页、首页这类非关键词页不动');
const rel = (r1.plan && r1.plan.related || []).map((x) => x.slug).sort();
check(rel.length === 4, `plan 事件的 related 点名了这四页（${rel.join(', ')}）`);

// ══ ② 幂等 ═══════════════════════════════════════════════════════════════════════════════════════
console.log('② 幂等：升级过的站再跑一次，所有文件逐字节不变');
const snap = (dir) => {
  const out = {};
  const walk = (d) => { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const f = path.join(d, e.name); if (e.isDirectory()) walk(f); else out[path.relative(dir, f)] = fs.readFileSync(f, 'utf-8'); } };
  walk(dir);
  return out;
};
const s1 = snap(A.siteDir);
const r2 = upgrade(A.siteDir);
const s2 = snap(A.siteDir);
check(r2.rc === 0 && JSON.stringify(s1) === JSON.stringify(s2), `第二次升级：${Object.keys(s1).length} 个文件逐字节相同`);
check(r2.plan && r2.plan.related.length === 0 && r2.done && r2.done.files.length === 0, '第二次 related 为空、一个文件都不写');
// 新站数据（建站路写出来的，已经带 withParent）：跑一次也一字不动。
const B = makeSite({
  'en/services.json': SERVICES,
  'en/pages/services/brakes.json': detailPage('brakes'),
  'en/pages/services/brakes/brake-pads-toronto.json': kwPage('services/brakes/brake-pads-toronto', 'Brake pads Toronto',
    [{ headline: 'Related pages', items: { source: 'pages', under: 'services/brakes', withParent: true } }]),
});
const b0 = snap(B.siteDir);
const rb = upgrade(B.siteDir);
check(rb.rc === 0 && JSON.stringify(b0) === JSON.stringify(snap(B.siteDir)), '已经带 withParent 的新站数据：逐字节不变');

// ══ ③ #998 之前的 sections 站 + 第二语言 ═════════════════════════════════════════════════════════
console.log('③ 老 sections 形状 · 第二语言的标题');
const C = makeSite({
  'site_meta.json': { defaultLocale: 'en', locales: ['en', 'zh'] },
  'zh/services.json': SERVICES,
  'zh/pages/services/brakes/shache.json': { slug: 'services/brakes/shache', title: '刹车', keywordPage: true,
    sections: [{ type: 'page-header', data: { headline: '刹车' } }, { type: 'cta', data: { headline: '预约' } }] },
});
const rc = upgrade(C.siteDir);
const zh = readJSON(path.join(C.siteDir, 'zh/pages/services/brakes/shache.json'));
check(rc.rc === 0 && !zh.blocks && zh.sections.map((b) => b.type).join(',') === 'page-header,features,cta',
  'sections 页：插在 cta 之前，没有凭空多出 blocks 键', JSON.stringify(zh.sections.map((b) => b.type)));
check(zh.sections[1].data.headline === '相关页面' && zh.sections[1].data.items.withParent === true, 'zh 目录下的页标题是「相关页面」、带 withParent');

console.log(`\n══ upgrade-related-links.test.js: ${pass} 过 · ${fail} 失败 ══`);
process.exit(fail ? 1 : 0);
