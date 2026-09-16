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

fs.rmSync(root, { recursive: true, force: true });
console.log(`\n══ block-page-index.test.js: ${pass} 过 · ${fail} 失败 ══`);
process.exit(fail ? 1 : 0);
