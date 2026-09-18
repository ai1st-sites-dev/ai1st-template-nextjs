#!/usr/bin/env node
/**
 * block-page-index.test.js — 「这个块住在哪一页」（#1351 面板那一半的地基）。
 *
 * 跑法:  node scripts/lib/block-page-index.test.js   （或 `npm run test:scripts`，它按文件名发现）
 * 退出码: 0 全过 · 1 有失败 · 2 跑不起来（**不许当成通过**）
 *
 * ══ 守什么 ═══════════════════════════════════════════════════════════════
 * ① **两种页面形状都找得到，而且回的下标是文件数组里的那个**。老 `sections` 形状的块 id 是构建时
 *    现算的（`blocks.js` §generatedBlockId），一移动就变 —— PATCH 拿它当目标会打到隔壁那块上，
 *    所以那一类必须按下标定位，而下标只能**现查**，不能从 id 字符串里反解（页名和类型都可能带横杠）。
 * ② **被藏起来的块也要在清单里**。它在产物里根本不存在（`SectionRenderer.tsx:17` 直接 return null）
 *    ⟹ 预览里点不到；清单里再没有的话，老板把一个块藏起来之后就再也没有入口把它放回来。
 * ③ **`pos` / `total` 是渲染顺序上的位置**，不是数组位置 —— 面板据此把到头的上移/下移按钮置灰。
 *    有 `weight` 的页面上两者不是一回事，所以这里造一个 weight 与数组顺序相反的夹具去分开它们。
 * ④ **站级块两条路都找得到**：`{ref}` 条目那条、以及 `visibility` 命中而这一页没有条目那条。
 * ⑤ 多语言站：同名页在两个语言里各有一份，不许串页。
 * ⑥ **`visPos` / `visTotal` 只数看得见的那几个**，面板的上移下移按钮按这一对置灰。藏起来的块在
 *    产物里没有 DOM ⟹ 它不占一格（`patch-block.js` 挪一格时跳过它）。夹具里专门有一页最后一块
 *    是藏起来的：按 `pos`/`total` 判它的上一块「还能往下走」，按 `visPos`/`visTotal` 判是到头了 ——
 *    两把尺必须在这一页上给出不同答案，否则这一格什么都没量到（#1351 QA1 r3 抓到的就是这个形状）。
 *
 * 🔴 判据用的是**构建时那一个函数**（`blocks.js` §normalizeLocalePages）。这里若自己写一套排序/解析，
 *    分叉的样子是「面板说它排第 2、构建出来它排第 3」，而两边各自都绿。
 */

'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');

const NEXT = path.resolve(__dirname, '..', '..');

let pass = 0; let fail = 0;
const ok = (m) => { pass += 1; console.log(`  ✅ ${m}`); };
const bad = (m) => { fail += 1; console.log(`  ❌ ${m}`); };
const die = (m) => { console.error(`🔴 跑不起来: ${m}`); process.exit(2); };
const check = (cond, m) => (cond ? ok(m) : bad(m));

let locateBlockInSite;
try {
  ({ locateBlockInSite } = require(path.join(NEXT, 'scripts', 'lib', 'block-page-index.js')));
} catch (e) {
  die(`require 失败: ${e.message}`);
}
if (typeof locateBlockInSite !== 'function') die('block-page-index.js 没导出 locateBlockInSite');

const write = (file, obj) => {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(obj, null, 2)}\n`);
};

// ── 夹具：一个多语言站（en / fr）+ 一个老扁平站 ────────────────────────────────────────────────
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bpi-'));
const site = path.join(root, 'site');
write(path.join(site, 'site_meta.json'), { defaultLocale: 'en', locales: ['en', 'fr'] });
write(path.join(site, 'en', 'blocks', 'site-blocks.json'), {
  // ① 靠 `{ref}` 条目进 about 页
  'shared-cta': { type: 'cta-banner', role: 'optional', region: 'content', data: { headline: '共用' } },
  // ② 靠 visibility 命中 home 页，而 home 的 blocks 里**没有**它的条目
  'floating-team': { type: 'team-grid', role: 'optional', region: 'content', visibility: ['home'], weight: 99, data: { headline: '飘进来的' } },
});
// 🔴 weight 与数组顺序**相反** —— 这样「渲染顺序里的位置」跟「数组下标」分得开（第 ③ 条）。
write(path.join(site, 'en', 'pages', 'home.json'), {
  slug: 'home',
  blocks: [
    { id: 'home-hero-0', type: 'hero', weight: 30, data: { headline: 'A' } },
    { id: 'home-faq-1', type: 'faq-accordion', weight: 20, hidden: true, data: { headline: 'B' } },
    { id: 'home-cta-2', type: 'cta-banner', weight: 10, data: { headline: 'C' } },
  ],
});
write(path.join(site, 'en', 'pages', 'about.json'), {
  slug: 'about',
  blocks: [
    { id: 'about-hero-0', type: 'hero', weight: 0, data: { headline: 'D' } },
    { ref: 'shared-cta', weight: 10 },
  ],
});
// 🔴 最后一个块被藏起来的一页 —— 「按钮什么时候置灰」两把尺在这一页上给出不同答案（第 ⑥ 条读数）。
write(path.join(site, 'en', 'pages', 'tail.json'), {
  slug: 'tail',
  blocks: [
    { id: 'tail-hero-0', type: 'hero', weight: 0, data: { headline: 'E' } },
    { id: 'tail-cta-1', type: 'cta-banner', weight: 10, data: { headline: 'F' } },
    { id: 'tail-faq-2', type: 'faq-accordion', weight: 20, hidden: true, data: { headline: 'G' } },
  ],
});
write(path.join(site, 'fr', 'pages', 'home.json'), {
  slug: 'home',
  blocks: [{ id: 'home-hero-0', type: 'hero', weight: 0, data: { headline: 'FR' } }],
});
// 老扁平站：没有 site_meta.json，页面写 sections、条目上没有 id
const legacy = path.join(root, 'legacy');
write(path.join(legacy, 'site', 'pages', 'services.json'), {
  slug: 'services',
  sections: [
    { type: 'page-header', data: { title: 'T' } },
    { type: 'services-list', data: {} },
    { type: 'contact-form', data: {} },
  ],
});

console.log('\n① 新 blocks 形状 + ② 隐藏的块也在清单里 + ③ pos/total 是渲染顺序');
{
  const r = locateBlockInSite({ rootDir: root, blockId: 'home-faq-1' });
  check(r.ok === true && r.page === 'home' && r.locale === 'en',
    `找到了，并说出是哪一页哪个语言（实际 ${r.page} / ${r.locale}）`);
  check(r.index === 1, `index 是**文件数组**里的下标（实际 ${r.index}）`);
  check(r.shape === 'blocks', `新形状的页面回 shape='blocks'（实际 ${JSON.stringify(r.shape)}）`);
  check(r.hidden === true, '被藏起来的块照样找得到，并带着 hidden:true ← 老板要靠它把块放回来');
  check(r.total === 4, `total 数的是渲染出来的块（3 个页面块 + 1 个 visibility 命中的，实际 ${r.total}）`);
  // weight: cta 10 → faq 20 → hero 30；floating-team 99 排最后
  check(r.pos === 1, `pos 是**渲染顺序**里的位置：weight 10/20/30/99 ⟹ faq 排第 1（实际 ${r.pos}）`);
  const ids = (r.blocks || []).map((b) => b.id).join(' · ');
  check(ids === 'home-cta-2 · home-faq-1 · home-hero-0 · floating-team',
    `清单按渲染顺序给（实际 ${ids}）`);
  // 🔴 分开 pos 与 index 的那一格：hero 的数组下标是 0，而它排在最后。
  const hero = locateBlockInSite({ rootDir: root, blockId: 'home-hero-0' });
  check(hero.index === 0 && hero.pos === 2,
    `同一个块：数组下标 0、渲染顺序第 2 —— 两者不是一回事（实际 index=${hero.index} pos=${hero.pos}）`);
}

console.log('\n④ 站级块两条路');
{
  const viaRef = locateBlockInSite({ rootDir: root, blockId: 'shared-cta' });
  check(viaRef.ok === true && viaRef.page === 'about' && viaRef.index === 1,
    `{ref} 条目那条：找到 about 页、下标 1（实际 ${JSON.stringify({ page: viaRef.page, index: viaRef.index })}）`);
  const viaVis = locateBlockInSite({ rootDir: root, blockId: 'floating-team' });
  check(viaVis.ok === true && viaVis.page === 'home',
    `visibility 那条：它出现在 home 页（实际 ${viaVis.page}）`);
  check(viaVis.index === -1,
    `而它在 home 的 blocks 里**没有条目** ⟹ index = -1（实际 ${viaVis.index}）—— 面板据此知道要先补条目`);
}

console.log('\n⑤ 老 sections 形状：id 是现算的，下标要现查');
{
  const r = locateBlockInSite({ rootDir: legacy, blockId: 'services-services-list-1' });
  check(r.ok === true && r.page === 'services' && r.index === 1,
    `按构建时算出来的 id 找得到，并回带数组下标（实际 ${JSON.stringify({ ok: r.ok, page: r.page, index: r.index })}）`);
  check(r.locale === '', `老扁平站没有语言目录 ⟹ locale 是空串（实际 ${JSON.stringify(r.locale)}）`);
  // 🔴 这一格是承重的，不是凑数：面板靠 `shape` 决定 PATCH 怎么定位（新形状按 blockId、老形状按
  //    index）。我第一版让面板拿「回来的 id 跟我手上那个一不一样」去判 —— 它**恒为假**（老形状的
  //    块 id 也是同一个现算出来的串，两边逐字相同），于是老站上每一次保存都会撞 bad-locator，
  //    而新站一切正常。这一格就是那次的守卫。
  check(r.shape === 'sections', `老 sections 的页面回 shape='sections'（实际 ${JSON.stringify(r.shape)}）`);
  check(r.id === 'services-services-list-1',
    `而它回的 id 跟面板手上那个**逐字相同** ⟹ 「id 一不一样」当不了判据（实际 ${JSON.stringify(r.id)}）`);
  // 🔴 反向对照：**这个 id 是位置的函数**。把那一块挪到别处，同一个 id 指向的就是另一个类型的块 ——
  //    这正是「老形状不许拿 id 当 PATCH 目标」的原因，也是本函数必须现查而不是反解字符串的原因。
  const moved = path.join(root, 'legacy2');
  write(path.join(moved, 'site', 'pages', 'services.json'), {
    slug: 'services',
    sections: [
      { type: 'services-list', data: {} },
      { type: 'page-header', data: { title: 'T' } },
      { type: 'contact-form', data: {} },
    ],
  });
  const after = locateBlockInSite({ rootDir: moved, blockId: 'services-services-list-1' });
  check(after.ok === false,
    `反向对照：把它挪到下标 0 之后，原来那个 id 在这个站上**找不到了**（实际 ok=${after.ok}）—— id 随位置变，成立`);
  const nowAt = locateBlockInSite({ rootDir: moved, blockId: 'services-services-list-0' });
  check(nowAt.ok === true && nowAt.index === 0, `它现在的 id 是 …-0（实际 ${JSON.stringify({ ok: nowAt.ok, index: nowAt.index })}）`);
}

console.log('\n⑥ 多语言：同名页不许串');
{
  const en = locateBlockInSite({ rootDir: root, blockId: 'home-hero-0', locale: 'en' });
  const fr = locateBlockInSite({ rootDir: root, blockId: 'home-hero-0', locale: 'fr' });
  check(en.ok && fr.ok && en.locale === 'en' && fr.locale === 'fr',
    `点名语言时各自答各自的（en total=${en.total} · fr total=${fr.total}）`);
  check(en.total !== fr.total,
    `两个语言的 home 不是同一页（en ${en.total} 块 vs fr ${fr.total} 块）—— 若相等这一格就说明不了问题`);
}

console.log('\n⑦ 找不到 / 没说找谁');
{
  check(locateBlockInSite({ rootDir: root, blockId: 'nope' }).reason === 'not-found', '找不到 ⟹ not-found');
  check(locateBlockInSite({ rootDir: root }).reason === 'bad-locator', '没给 blockId ⟹ bad-locator');
}

console.log('\n⑧ visPos / visTotal 只数看得见的那几个（按钮什么时候置灰）');
{
  // home 页：cta(10) · faq(20，藏) · hero(30) · floating-team(99)
  const hero = locateBlockInSite({ rootDir: root, blockId: 'home-hero-0' });
  check(hero.pos === 2 && hero.total === 4 && hero.visPos === 1 && hero.visTotal === 3,
    `同一个块两把尺读数不同：完整顺序 ${hero.pos}/${hero.total} · 看得见的 ${hero.visPos}/${hero.visTotal}`);
  const faq = locateBlockInSite({ rootDir: root, blockId: 'home-faq-1' });
  check(faq.hidden === true && faq.visPos === 1 && faq.visTotal === 3,
    `被藏的块自己也有 visPos，意思是「它前面有几个看得见的」（实际 ${faq.visPos}/${faq.visTotal}）`);

  // 🔴 这一格是 QA1 在 r3 抓到的那个形状：tail 页的最后一块被藏起来了。
  //    按 pos/total 判，cta 是「第 1 个，共 3 个」⟹ 下移按钮亮着，而按下去的结果是权重换了、
  //    看得见的顺序一个字没变。按 visPos/visTotal 判，它是「最后一个看得见的」⟹ 灰。
  const cta = locateBlockInSite({ rootDir: root, blockId: 'tail-cta-1' });
  const greyByPos = cta.pos >= cta.total - 1;
  const greyByVis = cta.visPos >= cta.visTotal - 1;
  check(greyByVis === true && greyByPos === false,
    `最后一个看得见的块后面挂着一个藏起来的块：按 visPos 判是到头了（灰），按 pos 判不是（亮）`
    + `—— 两把尺在这一页上必须给出不同答案（pos ${cta.pos}/${cta.total} · vis ${cta.visPos}/${cta.visTotal}）`);
  check(cta.visTotal === 2 && cta.total === 3, `visTotal 不数藏起来的那一个（${cta.visTotal} vs total ${cta.total}）`);
}

console.log('\n⑨ #1351 r6 —— 按 {page, index} 问（老 sections 形状存完一笔之后唯一能用的问法）');
{
  // 🔴 为什么要有它：老形状的块 id 是按数组下标现算的，挪一格就变。面板存完之后要重新问一次
  //    「它现在住在哪」，而那时它手上那个 id 已经不存在了（QA2 2026-09-16 真机：
  //    问 legacy-features-grid-1 回 404，块已经变成 -3，面板把控件全收起来）。
  const byIndex = locateBlockInSite({ rootDir: legacy, page: 'services', index: 1 });
  const byId = locateBlockInSite({ rootDir: legacy, blockId: 'services-services-list-1' });
  check(byIndex.ok === true && byIndex.index === 1 && byIndex.id === byId.id,
    `按下标问到的是同一个块，而且带回它【现在】的 id（实际 ${JSON.stringify({ index: byIndex.index, id: byIndex.id })}）`);
  check(JSON.stringify(byIndex) === JSON.stringify(byId),
    '两种问法回的是逐字相同的一份答案 —— 面板后面那些数（pos/visPos/blocks）不因问法而不同');

  // 挪一格之后：同一个下标上住着的是另一个块，而按【新下标】问回的是原来那个 —— 这正是面板要的。
  const moved = locateBlockInSite({ rootDir: legacy, page: 'services', index: 2 });
  check(moved.ok === true && moved.type === 'contact-form' && moved.id !== byIndex.id,
    `换一个下标问到的是另一个块（实际 ${moved.type} / ${moved.id}）`);

  // 新 blocks 形状也认这条路（面板对两种形状走同一段代码，只是老形状没有 id 可给）。
  const newShape = locateBlockInSite({ rootDir: root, page: 'home', locale: 'en', index: 1 });
  check(newShape.ok === true && newShape.id === 'home-faq-1',
    `新 blocks 形状按下标问也对（实际 ${newShape.id}）`);

  check(locateBlockInSite({ rootDir: legacy, index: 1 }).reason === 'bad-locator',
    '不说哪一页就按下标问 ⟹ bad-locator（下标只在一页之内有意义，不然会答到另一页的第 N 个块）');
  check(locateBlockInSite({ rootDir: legacy, page: 'services' }).reason === 'bad-locator',
    '两个定位都不给 ⟹ bad-locator');
  check(locateBlockInSite({ rootDir: legacy, page: 'services', index: -1 }).reason === 'bad-locator',
    // -1 是「靠 visibility 进来、这一页没有条目」那一类的下标，同一页上可以有好几个。
    '下标 -1 不是一个定位 ⟹ bad-locator，不许拿它去撞 visibility 那一类');
  check(locateBlockInSite({ rootDir: legacy, page: 'services', index: 9 }).reason === 'not-found',
    '这一页没有第 9 个块 ⟹ not-found（面板据此清掉选中，而不是显示一个错的块）');
  check(locateBlockInSite({ rootDir: legacy, page: 'nope', index: 0 }).reason === 'not-found',
    '这一页根本不存在 ⟹ not-found');
}

console.log('\n⑦ #1352 checkEditableSlot：这条文字路径，老板真的可以直接改吗');
{
  const { checkEditableSlot } = require(path.join(NEXT, 'scripts', 'lib', 'block-page-index.js'));
  // 🔴 这一节要一棵**带 blocks/ 的**树 —— 判据是那个站自己的 manifest，而上面那个夹具没有它。
  //    软链回本仓，跟 `patch-block.test.js` 的 makeSite 同一个做法：在容器里，「站自己那份」就是这一份。
  const r2 = fs.mkdtempSync(path.join(os.tmpdir(), 'bpi-slot-'));
  fs.symlinkSync(path.join(NEXT, 'blocks'), path.join(r2, 'blocks'));
  fs.symlinkSync(path.join(NEXT, 'public'), path.join(r2, 'public'));
  write(path.join(r2, 'site', 'pages', 'home.json'), {
    slug: 'home',
    blocks: [
      { id: 'home-hero-0', type: 'hero', weight: 0, data: { headline: 'A' } },
      { id: 'home-cards-1', type: 'card-group', weight: 10, data: { items: [{ title: 'x' }] } },
    ],
  });

  const a = checkEditableSlot({ rootDir: r2, blockId: 'home-hero-0', slot: 'headline' });
  check(a.ok === true && a.type === 'hero' && a.page === 'home',
    `顶层文字槽放行（ok=${a.ok} type=${a.type}）`);
  const b = checkEditableSlot({ rootDir: r2, blockId: 'home-hero-0', slot: 'ctaPrimary.label' });
  check(b.ok === true, `子字段那条路径也放行（ok=${b.ok} ${b.message || ''}）`);
  const c = checkEditableSlot({ rootDir: r2, blockId: 'home-cards-1', slot: 'items.2.title' });
  check(c.ok === true, `列表项带序号也放行（序号在比之前被去掉）（ok=${c.ok} ${c.message || ''}）`);

  // 🔴 反向对照四条 —— 没有它们，上面三格全绿也可能只是「这个函数什么都不拒」。
  const d = checkEditableSlot({ rootDir: r2, blockId: 'home-hero-0', slot: 'imageUrl' });
  check(d.ok === false && d.reason === 'not-editable',
    `没标 editLabel 的槽位被拒（kind: image）：${d.reason} · ${d.message || ''}`);
  const e = checkEditableSlot({ rootDir: r2, blockId: 'home-hero-0', slot: 'ctaPrimary.href' });
  check(e.ok === false && e.reason === 'not-editable',
    `标了的是 label、href 被拒：${e.reason}`);
  const f = checkEditableSlot({ rootDir: r2, blockId: 'home-hero-0', slot: '' });
  check(f.ok === false && f.reason === 'bad-locator', `没说改哪一处 ⟹ bad-locator（实际 ${f.reason}）`);
  const g = checkEditableSlot({ rootDir: r2, blockId: 'no-such-block', slot: 'headline' });
  check(g.ok === false && g.reason === 'not-found', `块不在这个站上 ⟹ not-found（实际 ${g.reason}）`);

  // 一次问好几条：全好才放行；有一条不好就整笔拒，而且**点名是哪一条**。
  // 🔴 逐条问是错的：第 2 条被拒时第 1 条已经放行了，而面板的一次保存只发一笔。
  const m1 = checkEditableSlot({ rootDir: r2, blockId: 'home-hero-0', slots: ['headline', 'subheadline'] });
  check(m1.ok === true, `一次问两条都可改 ⟹ 放行（ok=${m1.ok} ${m1.message || ''}）`);
  const m2 = checkEditableSlot({ rootDir: r2, blockId: 'home-hero-0', slots: ['headline', 'imageUrl'] });
  check(m2.ok === false && m2.reason === 'not-editable' && /imageUrl/.test(m2.message)
    && !/headline/.test(m2.message),
  `一好一坏 ⟹ 整笔拒，并且只点名坏的那条：${m2.message}`);

  // 🔴 「这个站的模板还没有这一维」跟「这条路径不能改」必须分开回：前者的处置是「先更新一次网站」，
  //    后者是拒绝。夹具做法是把 blocks/ 指到一个空目录 —— 那时 loadManifests 读不出任何块。
  const r3 = fs.mkdtempSync(path.join(os.tmpdir(), 'bpi-old-'));
  fs.mkdirSync(path.join(r3, 'blocks'));
  fs.symlinkSync(path.join(NEXT, 'public'), path.join(r3, 'public'));
  write(path.join(r3, 'site', 'pages', 'home.json'), {
    slug: 'home',
    blocks: [{ id: 'home-hero-0', type: 'hero', weight: 0, data: { headline: 'A' } }],
  });
  const h = checkEditableSlot({ rootDir: r3, blockId: 'home-hero-0', slot: 'headline' });
  check(h.ok === false && (h.reason === 'no-editor' || h.reason === 'unknown-block'),
    `站里读不出块清单 ⟹ 不是 not-editable，而是 ${h.reason}（处置不同：先更新网站）`);

  fs.rmSync(r2, { recursive: true, force: true });
  fs.rmSync(r3, { recursive: true, force: true });
}

fs.rmSync(root, { recursive: true, force: true });
console.log(`\n══ block-page-index.test.js: ${pass} 过 · ${fail} 失败 ══`);
process.exit(fail ? 1 : 0);
