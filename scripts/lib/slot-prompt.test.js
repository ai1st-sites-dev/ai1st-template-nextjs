#!/usr/bin/env node
/**
 * slot-prompt.test.js — 图槽提示词：建站与编辑器共用一份（#1711 验收 6）。
 *
 *   node scripts/lib/slot-prompt.test.js     （由 `npm run test:scripts` 自动发现）
 *   退出码: 0 全过 · 1 有失败 · 2 跑不起来（**不许当成通过**）
 *
 *   ① 搬出来的 `buildSlotPrompt` 在 `industry` 有值时，输出跟搬之前**逐字相同** —— 期望值是下面
 *      `originalBuildSlotPrompt`：从 `origin/main 52f4f75cf` 的 `image-slots.js` **原样**抄过来的那份函数（只改了名字），
 *      不是从新文件里读的（从新文件读就成了自己跟自己比）。真 manifest 里每个块 × 单图 / 列表 / banner 三种取景都比。
 *   ② 没有行业：那一句是 `… scene of business interior …`，里面没有 `undefined` / `null`，
 *      除了少掉「<行业> 」那几个字之外跟有行业时逐字相同。
 *   ③ 编辑器的默认提示词（`editorImagePrompt`）：以 `buildSlotPrompt({…, industry, themeWord: 'minimal'})` 对同一块算出的那句开头
 *      （含行业），后面接这块的标题；没有标题就只有那一句。
 *   ④ `image-slots.js` 导出的 `buildSlotPrompt` 就是这一份（同一个函数对象）—— 建站那条路没有第二份拼法。
 */
'use strict';

const path = require('path');

let fail = 0;
let pass = 0;
const ok = (m) => { pass += 1; console.log(`  ✅ ${m}`); };
const bad = (m) => { fail += 1; console.log(`  ❌ ${m}`); };
const die = (m) => { console.error(`🔴 跑不起来: ${m}`); process.exit(2); };

// ── 搬之前那份（origin/main 52f4f75cf · templates/nextjs/scripts/lib/image-slots.js:171-189，原样）──────────
function originalBuildSlotPrompt({ manifest, slot, industry, primaryColor, themeWord }) {
  const scene = `${industry} business interior or exterior scene, warm natural lighting, photorealistic, ${themeWord} aesthetic. Use ${primaryColor} as the dominant color tone in the decor, walls, furnishings, and ambient lighting. Professional friendly diverse people (varied ages and ethnicities) may appear naturally. AVOID children unless industry is pediatric/childcare/school; AVOID medical surgery, distress, or sensitive scenes; AVOID religious symbols not relevant to the brand.

ABSOLUTELY NO TEXT IN THE IMAGE. The scene must contain ZERO visible business signage with letters, ZERO storefront signs with words, ZERO wall-mounted signs with text, ZERO printed wordmarks or brand names, ZERO menu boards with readable words, ZERO product labels with letters, ZERO English or any-language words, ZERO numbers or digits, ZERO logos with characters, ZERO typography of any kind anywhere in the scene. Buildings, products, walls, and decor must be free of any written or printed text elements.`;

  const name = (manifest && manifest.displayName) || (manifest && manifest.type) || slot.secType;
  const where = `It fills the "${slot.slotName}" image slot of the "${name}" section.`;

  if (slot.kind === 'list') {
    return `4:3 detail or moment shot of ${scene} ${where} This is photo #${(slot.itemIdx || 0) + 1} of a set — vary the subject (product close-up / service action / interior detail / candid interaction) so it differs from the others in the same set.`;
  }
  if (manifest && manifest.category === 'banner') {
    return `Wide-angle 16:9 exterior storefront or entrance view of ${scene} ${where} Daytime, inviting, welcoming atmosphere with depth.`;
  }
  return `4:3 contextual scene of ${scene} ${where} Authentic candid moment, not posed.`;
}

let sp; let slots; let manifests;
try {
  sp = require('./slot-prompt.js');
  slots = require('./image-slots.js');
  manifests = require('./block-manifest.js').loadManifests();
} catch (e) { die(e.stack || String(e)); }
const { buildSlotPrompt, editorImagePrompt, EDITOR_THEME_WORD } = sp;
if (!manifests || !manifests.size) die('loadManifests() 一个块都没读到');

const COLOR = '#1d4ed8';
// 每个块 × 三种槽（单图 / 列表第 0 项 / 列表第 3 项）——取景分支在 slot.kind 和 manifest.category 上。
const cases = [];
for (const [type, m] of manifests) {
  cases.push({ m, slot: { secType: type, slotName: 'image', kind: 'object' } });
  cases.push({ m, slot: { secType: type, slotName: 'items', kind: 'list', itemIdx: 0 } });
  cases.push({ m, slot: { secType: type, slotName: 'items', kind: 'list', itemIdx: 3 } });
}
const banners = cases.filter((c) => c.m.category === 'banner' && c.slot.kind === 'object').length;
if (!banners) die('真 manifest 里一个 banner 类都没有 —— ① 量不到 banner 那一支');

console.log(`① industry 有值：搬出来那份 == 搬之前那份（${manifests.size} 个块 × 3 种槽 × 2 个行业 / 主题词）`);
{
  const diffs = [];
  for (const c of cases) {
    for (const [industry, themeWord] of [['auto repair', 'azure-29'], ['dental clinic', 'minimal']]) {
      const a = { manifest: c.m, slot: c.slot, industry, primaryColor: COLOR, themeWord };
      if (buildSlotPrompt(a) !== originalBuildSlotPrompt(a)) diffs.push(`${c.m.type}/${c.slot.kind}/${c.slot.itemIdx ?? '-'}/${industry}`);
    }
  }
  if (!diffs.length) ok(`${cases.length * 2} 组逐字相同（其中 banner 单图 ${banners * 2} 组）`);
  else diffs.forEach((d) => bad(`${d} 跟搬之前不一样`));
}

console.log('② 没有行业：省掉那个词，不出现 undefined / null，其余逐字不变');
{
  const problems = [];
  for (const c of cases) {
    for (const industry of [undefined, '', null]) {
      const got = buildSlotPrompt({ manifest: c.m, slot: c.slot, industry, primaryColor: COLOR, themeWord: 'minimal' });
      const withIt = buildSlotPrompt({ manifest: c.m, slot: c.slot, industry: 'auto repair', primaryColor: COLOR, themeWord: 'minimal' });
      if (/undefined|null/.test(got)) problems.push(`${c.m.type}/${c.slot.kind} industry=${JSON.stringify(industry)}: 有 undefined/null`);
      if (!/ of business interior or exterior scene/.test(got)) problems.push(`${c.m.type}/${c.slot.kind} industry=${JSON.stringify(industry)}: 没有「of business interior」`);
      if (got !== withIt.replace('auto repair business', 'business')) problems.push(`${c.m.type}/${c.slot.kind} industry=${JSON.stringify(industry)}: 除了行业那个词还有别的不同`);
    }
  }
  const hero = buildSlotPrompt({ manifest: manifests.get('hero'), slot: { secType: 'hero', slotName: 'image', kind: 'object' }, primaryColor: COLOR, themeWord: 'minimal' });
  if (!/scene of business interior/.test(buildSlotPrompt({ manifest: manifests.get('features'), slot: { secType: 'features', slotName: 'introImage', kind: 'object' }, primaryColor: COLOR, themeWord: 'minimal' }))) problems.push('features 单图那一句里没有「scene of business interior」');
  if (!problems.length) ok(`${cases.length * 3} 组都对；例：${hero.slice(0, 80)}…`);
  else problems.forEach((p) => bad(p));
}

console.log('③ 编辑器默认提示词 = 建站那一句（主题词 minimal）+ 这块的标题');
{
  const problems = [];
  const hero = manifests.get('hero');
  const base = buildSlotPrompt({ manifest: hero, slot: { secType: 'hero', slotName: 'image', kind: 'object' }, industry: 'auto repair', primaryColor: COLOR, themeWord: 'minimal' });
  const got = editorImagePrompt({ manifest: hero, slotName: 'image', kind: 'object', industry: 'auto repair', primaryColor: COLOR, headline: '  Honest auto\nrepair, done the same day ' });
  if (EDITOR_THEME_WORD !== 'minimal') problems.push(`EDITOR_THEME_WORD = ${EDITOR_THEME_WORD}`);
  if (!got.startsWith(base)) problems.push('不是以 buildSlotPrompt({…, industry, themeWord: minimal}) 开头');
  if (!got.includes('auto repair business')) problems.push('里面没有行业');
  if (got.slice(base.length) !== ' The section\'s headline is: "Honest auto repair, done the same day".') problems.push(`标题那一段不对：${JSON.stringify(got.slice(base.length))}`);
  const noHead = editorImagePrompt({ manifest: hero, slotName: 'image', kind: 'object', industry: 'auto repair', primaryColor: COLOR });
  if (noHead !== base) problems.push('没有标题时不等于那一句');
  const list = editorImagePrompt({ manifest: manifests.get('gallery'), slotName: 'items', kind: 'list', itemIdx: 2, primaryColor: COLOR, headline: 'Our work' });
  if (!/photo #3 of a set/.test(list) || /undefined/.test(list)) problems.push(`列表第 3 项那一句不对：${list.slice(0, 120)}`);
  if (!problems.length) ok(`hero：${got.length} 字符，开头 == 建站那一句（${base.length}）、后面是标题；列表项按 #3 取景；没有标题 == 那一句`);
  else problems.forEach((p) => bad(p));
}

console.log('④ image-slots.js 导出的就是这一份');
if (slots.buildSlotPrompt === buildSlotPrompt) ok('同一个函数对象');
else bad('image-slots.js 导出的 buildSlotPrompt 不是 slot-prompt.js 那一份 —— 建站和编辑器各拼各的');

console.log('⑤ editorImageTarget：画布的 data-slot / 面板的 current → 槽名 + 单图或列表第几项');
{
  const { editorImageTarget: t } = sp;
  const props = { id: 'x', headline: 'H', image: { imageUrl: '/a.jpg' },
    items: [{ title: 'a', image: { imageUrl: '/b.jpg' } }, { title: 'c', image: { imageUrl: '/c.jpg' } }], band: [{ imageUrl: '/d.jpg' }] };
  const cases = [
    [{ slot: 'image' }, { slotName: 'image', kind: 'object' }],
    [{ slot: 'items.2.image' }, { slotName: 'items', kind: 'list', itemIdx: 2 }],
    [{ slot: 'proof.avatars.1.imageUrl' }, { slotName: 'proof', kind: 'list', itemIdx: 1 }],
    [{ props, current: '/c.jpg' }, { slotName: 'items', kind: 'list', itemIdx: 1 }],
    [{ props, current: '/d.jpg' }, { slotName: 'band', kind: 'list', itemIdx: 0 }],
    [{ props, current: '/not-here.jpg' }, { slotName: 'image', kind: 'object' }],
    [{ props, current: '' }, { slotName: 'image', kind: 'object' }],
    [{ props: { headline: 'no images' }, current: '/a.jpg' }, null],
    [{ slot: '0.image' }, null],
  ];
  const off = cases.filter(([a, want]) => JSON.stringify(t(a)) !== JSON.stringify(want))
    .map(([a, want]) => `${JSON.stringify(a).slice(0, 60)} → ${JSON.stringify(t(a))}，应为 ${JSON.stringify(want)}`);
  if (!off.length) ok(`${cases.length} 种入参都对（含找不到 ⟹ 第一个单图槽、一个图槽都没有 ⟹ null）`);
  else off.forEach((x) => bad(x));
}

console.log(`\n${pass} 过 / ${fail} 不过`);
process.exit(fail ? 1 : 0);
