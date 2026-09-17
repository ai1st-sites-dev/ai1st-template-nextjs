#!/usr/bin/env node
/**
 * block-shape.test.js — 形态的三级取值（`shapeForBlock`，#1318 / #1331），#1350 补的那几格。
 *
 * 跑法:  node scripts/lib/block-shape.test.js   （或 `npm run test:scripts`，它按文件名发现）
 * 退出码: 0 全过 · 1 有失败 · 2 跑不起来（**不许当成通过**）
 *
 * ══ 守什么（#1350 的 AC3 / AC7 在构建侧的那一半）════════════════════════════════════════════
 * ① **AC7**：老板手挑的形态后来被区块库删掉 ⟹ 落回 manifest 默认 + 说一行，**不抛**。
 *    这是检查器写 `shape` 之后唯一会自己坏掉的一格：写下去的那一刻它是合法的，删形态的是别人、别的时候。
 *    🔴 两向都量：清单里**没有**它 ⟹ 落回并说话；清单里**有**它 ⟹ 原样戴上、不说那句话。
 *    只量前一半的话，一个「永远落回默认」的实现也全绿。
 * ② **AC3**：页面 JSON（第 ① 级）高于主题选择单（第 ② 级）—— 换主题后手挑的块保留。
 *    判据是同一个块喂两套选择单（azure-29 的 hero 是 media-cover，ember-12 的是 text-center），
 *    手挑了就两次都是手挑的那个。反向臂：把 `shape` 删掉（=「恢复主题默认」那个按钮做的事）
 *    ⟹ 两套选择单各自说了算。**这一对才是「第一级真的在第二级之上」**：只跑正臂的话，
 *    一个「永远回 media-cover」的实现也全绿。
 * ③ 缺槽位那一格（D11 ⑥）：`media-cover` 要 `imageUrl`，没填 ⟹ 落回默认并点名缺哪个槽；填上 ⟹ 戴上。
 *    检查器的下拉按同一个判据灰显（AC1），所以构建侧这一格是那条灰显的同源读数。
 *
 * 🔴 **用真 manifest，不造合成的**：`loadBlockManifests` 读盘上那 31 份。要测「形态被删掉」
 *    就在**真 manifest 的深拷贝**上删掉那一项 —— 合成一份 manifest 会把「真 hero 到底长什么样」
 *    这一维一起抹掉，而那正是这些断言要压住的东西。
 */

'use strict';

const path = require('path');

const NEXT = path.resolve(__dirname, '..', '..');

let pass = 0; let fail = 0;
const ok = (m) => { pass += 1; console.log(`  ✅ ${m}`); };
const bad = (m) => { fail += 1; console.log(`  ❌ ${m}`); };
const die = (m) => { console.error(`🔴 跑不起来: ${m}`); process.exit(2); };
const check = (cond, m) => (cond ? ok(m) : bad(m));

let shapeForBlock; let shapeVerdict; let checkShapeInSite; let resetShapesInSite;
let loadBlockManifests; let shapesFor;
try {
  ({ shapeForBlock, shapeVerdict, checkShapeInSite, resetShapesInSite } = require(path.join(NEXT, 'scripts', 'lib', 'block-shape.js')));
  ({ loadBlockManifests } = require(path.join(NEXT, 'scripts', 'blocks.js')));
  ({ shapesFor } = require(path.join(NEXT, 'scripts', 'themes.js')));
} catch (e) {
  die(`require 失败: ${e.message}`);
}
if (typeof shapeForBlock !== 'function') die('block-shape.js 没导出 shapeForBlock');
if (typeof shapeVerdict !== 'function') die('block-shape.js 没导出 shapeVerdict');
if (typeof checkShapeInSite !== 'function') die('block-shape.js 没导出 checkShapeInSite');
if (typeof resetShapesInSite !== 'function') die('block-shape.js 没导出 resetShapesInSite');
// 🔴 `checkShapeInSite` 靠 `blocks.js` 的 `findBlockInPage`（#1351 建的，一份实现两个调用方）。
//    它不在的时候这里要**跑不起来**（exit 2），不许退化成「那几条就不测了」—— 失败方向必须是
//    「读数取不到」，不能是「少测了一维而全绿」。
if (typeof require(path.join(NEXT, 'scripts', 'blocks.js')).findBlockInPage !== 'function') {
  die('blocks.js 没导出 findBlockInPage —— 它由 #1351 落地，本文件第 ⑥ 节靠它；先把那半合进来再跑');
}

const manifests = loadBlockManifests(NEXT);
if (!manifests || !manifests.hero) die('loadBlockManifests 读不到 hero 的 manifest');

// 这些断言压着的两个事实先自己量一次 —— 变了就该在这里红，而不是在下面读成一串莫名其妙的失败。
const heroShapes = (manifests.hero.shapes || []).map((s) => s.name);
if (heroShapes[0] !== 'text-center') die(`hero 的默认形态不是 text-center 而是 ${heroShapes[0]} —— 本文件的断言要跟着改`);
if (!heroShapes.includes('media-cover')) die('hero 的清单里没有 media-cover —— 本文件的断言要跟着改');

const AZURE = shapesFor('azure-29');
const EMBER = shapesFor('ember-12');
if (AZURE.hero !== 'media-cover' || EMBER.hero !== 'text-center') {
  die(`两套主题给 hero 的形态变了（azure-29=${AZURE.hero} ember-12=${EMBER.hero}）—— 本文件的断言要跟着改`);
}

/** 跑一次并把日志收起来 —— 每条断言都要能说「它有没有说话、说了什么」。 */
function run(block, selection, ms = manifests) {
  const lines = [];
  let threw = null;
  let out;
  try { out = shapeForBlock(block, selection, ms, (l) => lines.push(l)); } catch (e) { threw = e; }
  return { out, lines, threw, log: lines.join('\n') };
}

const withImage = { headline: 'H', imageUrl: 'https://example.com/a.jpg' };

// ── ① AC7：手挑的形态后来被区块库删掉 ───────────────────────────────────────────────────────────
console.log('\n① AC7 —— 手挑的形态后来被区块库删掉（两向）');
{
  // 真 manifest 的深拷贝，删掉 media-cover 这一项 = 区块库把这个形态下架了。
  const pruned = JSON.parse(JSON.stringify(manifests));
  pruned.hero.shapes = pruned.hero.shapes.filter((s) => s.name !== 'media-cover');
  check(!pruned.hero.shapes.some((s) => s.name === 'media-cover'), '夹具立得起来：拷贝里的 hero 已经没有 media-cover 了');

  const gone = run({ type: 'hero', shape: 'media-cover', data: withImage }, EMBER, pruned);
  check(gone.threw === null, `形态被删掉 ⟹ 不抛${gone.threw ? ` —— 实际抛了: ${gone.threw.message}` : ''}`);
  check(gone.out === 'text-center', `形态被删掉 ⟹ 落回 manifest 默认 text-center（实际 ${JSON.stringify(gone.out)}）`);
  check(gone.log.includes('清单里没有它'), `形态被删掉 ⟹ 构建日志说一行（实际: ${JSON.stringify(gone.log)}）`);
  check(gone.log.includes('页面 JSON'), '那一行点名了来源是页面 JSON（老板手挑的，不是主题给的）');

  // 🔴 反向臂：同一个块、同一份 data，只把「形态还在清单里」这一个变量翻回来。
  const still = run({ type: 'hero', shape: 'media-cover', data: withImage }, EMBER);
  check(still.out === 'media-cover', `形态还在清单里 ⟹ 原样戴上（实际 ${JSON.stringify(still.out)}）`);
  check(!still.log.includes('清单里没有它'), '形态还在清单里 ⟹ 不打那句「清单里没有它」');
}

// ── ② AC3：页面 JSON 高于主题选择单（换主题保留 / 恢复主题默认）─────────────────────────────────
console.log('\n② AC3 —— 换主题后手挑的形态保留；删掉 shape 就落回选择单');
{
  const picked = { type: 'hero', shape: 'media-cover', data: withImage };
  check(run(picked, AZURE).out === 'media-cover', '手挑 media-cover + azure-29（选择单也是 media-cover）⟹ media-cover');
  check(run(picked, EMBER).out === 'media-cover',
    '手挑 media-cover + 换到 ember-12（选择单是 text-center）⟹ 仍然 media-cover ← AC3 正臂');

  // 🔴 反向臂 = 「恢复主题默认」那个按钮做的事：把 `shape` 这个键删掉。
  const cleared = { type: 'hero', data: withImage };
  check(run(cleared, AZURE).out === 'media-cover', '删掉 shape + azure-29 ⟹ 跟着选择单回 media-cover');
  check(run(cleared, EMBER).out === 'text-center',
    '删掉 shape + ember-12 ⟹ 跟着选择单回 text-center ← AC3 反臂（证明第 ① 级真的压着第 ② 级）');
}

// ── ③ 缺槽位（D11 ⑥）——检查器灰显那条的同源读数 ─────────────────────────────────────────────────
console.log('\n③ 缺槽位 —— media-cover 要 imageUrl');
{
  const noImage = run({ type: 'hero', shape: 'media-cover', data: { headline: 'H' } }, EMBER);
  check(noImage.threw === null, '缺槽位 ⟹ 不抛');
  check(noImage.out === 'text-center', `缺槽位 ⟹ 落回默认 text-center（实际 ${JSON.stringify(noImage.out)}）`);
  check(noImage.log.includes('缺槽位 imageUrl'), `缺槽位 ⟹ 点名缺哪个槽（实际: ${JSON.stringify(noImage.log)}）`);
  check(run({ type: 'hero', shape: 'media-cover', data: withImage }, EMBER).out === 'media-cover',
    '补上 imageUrl ⟹ media-cover 戴得上（反向臂）');
}

// ── ④ 两条边 ───────────────────────────────────────────────────────────────────────────────────
console.log('\n④ 边界');
{
  const none = run({ type: 'hero', data: withImage }, {});
  check(none.out === 'text-center', `三级里前两级都没有 ⟹ manifest 默认 text-center（实际 ${JSON.stringify(none.out)}）`);
  check(none.log.includes('都没给它形态'), '前两级都没有 ⟹ 也说一行（#1338）');

  // 没有 manifest 的块类型：原样返回、不打「落回默认 undefined」那种会带偏人的话（#1338 的 🔴）。
  const noManifest = run({ type: 'no-such-block', shape: 'whatever', data: {} }, {});
  check(noManifest.out === 'whatever', `没有 manifest ⟹ 原样返回（实际 ${JSON.stringify(noManifest.out)}）`);
  check(noManifest.lines.length === 0, `没有 manifest 且两级都没给 ⟹ 一行都不说（实际 ${noManifest.lines.length} 行）`);
}

// ── ⑤ AC5 / AC1 —— shapeVerdict：校验说的话与构建做的事必须是同一个判据 ─────────────────────────
console.log('\n⑤ shapeVerdict —— manager 的 400 报文 / 下拉灰显，跟构建同一个判据');
{
  const heroM = manifests.hero;
  const unknown = shapeVerdict(heroM, 'no-such-shape', withImage);
  check(unknown.ok === false && unknown.kind === 'unknown', `清单里没有这个形态 ⟹ kind=unknown（实际 ${JSON.stringify(unknown.kind)}）`);
  check(unknown.message.includes('no-such-shape') && unknown.message.includes('text-center'),
    `unknown 的报文点名了这个形态、并列出它今天有的是哪些（实际: ${JSON.stringify(unknown.message)}）`);

  const gap = shapeVerdict(heroM, 'media-cover', { headline: 'H' });
  check(gap.ok === false && gap.kind === 'gap', `缺槽位 ⟹ kind=gap（实际 ${JSON.stringify(gap.kind)}）`);
  check(Array.isArray(gap.missing) && gap.missing.join(',') === 'imageUrl',
    `gap 点名缺哪个槽（实际 ${JSON.stringify(gap.missing)}）← AC5「缺槽位的要说缺哪个槽」`);
  check(gap.message.includes('imageUrl'), 'gap 的报文里也有那个槽位名（老板看到的是这一句）');

  check(shapeVerdict(heroM, 'media-cover', withImage).ok === true, '槽位填齐了 ⟹ ok');
  check(shapeVerdict(undefined, 'whatever', {}).ok === true,
    '没有 manifest ⟹ ok —— 跟 shapeForBlock 的 `if (!m) return shape` 同一个立场');

  // 🔴 这一条是本节的要害：**逐个形态**比对「校验放不放行」与「构建落不落回」。
  //    两处要是分叉，最可能的分叉点就是 shapeNeedsGap 的三态返回值（null vs []）被读错，
  //    而那一格的失败方向是放行 —— 校验说能戴、构建时戴的却是另一个。
  const probes = [{ headline: 'H' }, withImage];
  let agree = 0; let disagree = [];
  for (const shape of heroShapes.concat(['no-such-shape'])) {
    for (const data of probes) {
      const verdict = shapeVerdict(heroM, shape, data).ok;
      const built = run({ type: 'hero', shape, data }, {}).out === shape;
      if (verdict === built) agree += 1;
      else disagree.push(`${shape} / data=${JSON.stringify(Object.keys(data))}: 校验=${verdict} 构建戴上=${built}`);
    }
  }
  check(disagree.length === 0,
    `${agree} 组（${heroShapes.length + 1} 个形态 × 2 份 data）逐组一致：校验放行 ⟺ 构建真戴上`
    + (disagree.length ? ` —— 不一致: ${disagree.join(' | ')}` : ''));
}

// ── ⑥ checkShapeInSite —— manager 入队前那一次容器调用（AC5 / AC6 的判据本体）───────────────────
//
// 🔴 这一节要一个**真的站目录**（三种块各一个：页面自己的 / `{ref}` 条目 / visibility 命中而这一页
//    没条目的），因为它要压的正是「按 id 找到的是不是同一个块」。喂合成对象是量不到这一维的。
console.log('\n⑥ checkShapeInSite —— 入队前那一次容器调用');
{
  const fs = require('fs');
  const os = require('os');
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'blockshape-'));
  const siteDir = path.join(tmp, 'site');
  const en = path.join(siteDir, 'en');
  fs.mkdirSync(path.join(en, 'pages'), { recursive: true });
  fs.mkdirSync(path.join(en, 'blocks'), { recursive: true });
  // 🔴 rootDir 在容器里是 `/app/repo` —— 它同时有 `site/` 和 `blocks/`（区块库）。夹具要长一样，
  //    否则 `loadBlockManifests` 读到空表，而空表是**逐个形态都放行**的（第一版夹具就这么绿过
  //    三条，实际是尺子没接上）。用**真的那 31 份 manifest**，不造合成的。
  fs.symlinkSync(path.join(NEXT, 'blocks'), path.join(tmp, 'blocks'));
  fs.writeFileSync(path.join(siteDir, 'site_meta.json'), JSON.stringify({ defaultLocale: 'en' }));
  fs.writeFileSync(path.join(siteDir, 'theme.json'), JSON.stringify({ themeId: 'azure-29', applied: true }));
  fs.writeFileSync(path.join(en, 'blocks', 'site-blocks.json'), JSON.stringify({
    // ref 进来的：有图
    'shared-hero': { type: 'hero', visibility: ['about'], data: { headline: '共用', imageUrl: 'https://e/x.jpg' } },
    // visibility 命中 home 而 home 的 blocks 里没有它的条目
    'floating-hero': { type: 'hero', visibility: ['home'], weight: 99, data: { headline: '飘进来的' } },
  }));
  fs.writeFileSync(path.join(en, 'pages', 'home.json'), JSON.stringify({
    slug: 'home', title: 'Home',
    blocks: [
      { id: 'home-hero-0', type: 'hero', role: 'hero', region: 'content', weight: 0, data: { headline: '有图', imageUrl: 'https://e/a.jpg' } },
      { id: 'home-hero-1', type: 'hero', role: 'hero', region: 'content', weight: 10, data: { headline: '没图' } },
    ],
  }));
  fs.writeFileSync(path.join(en, 'pages', 'about.json'), JSON.stringify({
    slug: 'about', title: 'About',
    blocks: [{ ref: 'shared-hero', weight: 10 }],
  }));
  // 老扁平站（没有 site_meta.json，页面写 sections）
  const legacyRoot = path.join(tmp, 'legacy');
  fs.mkdirSync(path.join(legacyRoot, 'site', 'pages'), { recursive: true });
  fs.symlinkSync(path.join(NEXT, 'blocks'), path.join(legacyRoot, 'blocks'));
  fs.writeFileSync(path.join(legacyRoot, 'site', 'theme.json'), JSON.stringify({ themeId: 'ember-12' }));
  fs.writeFileSync(path.join(legacyRoot, 'site', 'pages', 'home.json'), JSON.stringify({
    slug: 'home', title: 'Home',
    sections: [{ type: 'hero', data: { headline: '老站', imageUrl: 'https://e/b.jpg' } }],
  }));

  const at = (o) => checkShapeInSite({ rootDir: tmp, ...o });

  // ① 页面自己的块，槽位齐 ⟹ 放行，并回带主题选择单给这个块的形态（做什么 #5 要用它）
  const r1 = at({ page: 'home', blockId: 'home-hero-0', shape: 'media-cover' });
  check(r1.ok === true, `页面自己的块 + 有图 ⟹ 放行（实际 ${JSON.stringify(r1)}）`);
  check(r1.type === 'hero' && r1.index === 0, `回带 type/index（实际 type=${r1.type} index=${r1.index}）`);
  check(r1.themeShape === 'media-cover', `回带主题选择单给 hero 的形态（azure-29 ⟹ media-cover，实际 ${JSON.stringify(r1.themeShape)}）`);

  // ② 同一页另一个块没图 ⟹ 拒，并说缺哪个槽 ← AC5「缺槽位的要说缺哪个槽」
  const r2 = at({ page: 'home', blockId: 'home-hero-1', shape: 'media-cover' });
  check(r2.ok === false && r2.kind === 'gap' && r2.missing.join(',') === 'imageUrl',
    `同一页另一个块没图 ⟹ gap + 点名 imageUrl（实际 ${JSON.stringify(r2)}）`);
  check(r1.ok !== r2.ok, '🔴 同一页两个同类型的块给出相反的裁定 —— 它真的按 id 找到了不同的那一块');

  // ③ 清单里没有的形态 ⟹ unknown
  const r3 = at({ page: 'home', blockId: 'home-hero-0', shape: 'no-such-shape' });
  check(r3.ok === false && r3.kind === 'unknown', `清单里没有的形态 ⟹ unknown（实际 ${JSON.stringify(r3.kind)}）`);

  // ④ `{ref}` 条目：type / data 在站级块库里，不在条目上
  const r4 = at({ page: 'about', blockId: 'shared-hero', shape: 'media-cover' });
  check(r4.ok === true && r4.type === 'hero', `{ref} 条目 ⟹ 回站级块库取 type/data 并放行（实际 ${JSON.stringify(r4)}）`);

  // ⑤ visibility 命中而这一页没有条目：只读路径要能解出来，而且 at = -1（文件里没有它）
  const r5 = at({ page: 'home', blockId: 'floating-hero', shape: 'media-cover' });
  check(r5.ok === false && r5.kind === 'gap',
    `visibility 命中、这一页没条目的站级块 ⟹ 也按它自己的 data 裁（没图 ⟹ gap，实际 ${JSON.stringify(r5)}）`);
  check(r5.index === -1, `它在文件里没有条目 ⟹ index = -1（实际 ${r5.index}）`);

  // 🔴 ⑤ 之后立刻复查：校验这一步【一个字节都没写】——补 {ref} 条目是写动作，归 worker（materialize:false）
  const homeAfter = JSON.parse(fs.readFileSync(path.join(en, 'pages', 'home.json'), 'utf-8'));
  check(homeAfter.blocks.length === 2 && !homeAfter.blocks.some((b) => b.ref),
    `校验跑完 home.json 还是 2 个块、没被补进 {ref} 条目（实际 ${homeAfter.blocks.length} 个）← AC5「页面 JSON 不动」`);

  // ⑥ 老 sections 形状：按 index 定位；给 blockId 要被拒
  const r6 = at({ rootDir: legacyRoot, page: 'home', index: 0, shape: 'media-cover' });
  check(r6.ok === true && r6.type === 'hero', `老 sections 形状 + index ⟹ 放行（实际 ${JSON.stringify(r6)}）`);
  const r6b = at({ rootDir: legacyRoot, page: 'home', blockId: 'home-hero-0', shape: 'media-cover' });
  check(r6b.ok === false && r6b.kind === 'bad-locator',
    `老 sections 形状给 blockId ⟹ 拒（那种站的 id 是现算的，挪一次就变；实际 ${JSON.stringify(r6b.kind)}）`);
  check(r6.themeShape === 'text-center', `老站穿 ember-12 ⟹ themeShape = text-center（实际 ${JSON.stringify(r6.themeShape)}）`);

  // ⑦ 定位不合法的几种：页不在 / 块不在 / 形态名不对 —— 每一种都要说得出是哪一种
  check(at({ page: 'nope', blockId: 'x', shape: 'media-cover' }).kind === 'no-page', '页不在 ⟹ no-page');
  check(at({ page: 'home', blockId: 'nope', shape: 'media-cover' }).kind === 'no-block', '块不在 ⟹ no-block');
  check(at({ page: 'home', blockId: 'home-hero-0', shape: 'Media Cover!' }).kind === 'bad-shape', '形态名形状不对 ⟹ bad-shape');
  check(at({ page: '../etc', blockId: 'x', shape: 'media-cover' }).kind === 'bad-locator', '页面名带 .. ⟹ bad-locator（这个值从网络上来）');

  // ⑧ 区块库整个不在（建站日期早于区块库的老站）⟹ 拒，不静默放行
  //    🔴 这是第一版夹具漏掉的那一维反过来做成的断言：那时 rootDir 下没有 `blocks/`，
  //    于是三条「该拒」的全绿了。现在它必须自己说一句话。
  const noCatalog = path.join(tmp, 'nocat');
  fs.mkdirSync(path.join(noCatalog, 'site', 'pages'), { recursive: true });
  fs.writeFileSync(path.join(noCatalog, 'site', 'pages', 'home.json'), JSON.stringify({
    slug: 'home', blocks: [{ id: 'home-hero-0', type: 'hero', data: { headline: 'x' } }],
  }));
  const r8 = at({ rootDir: noCatalog, page: 'home', blockId: 'home-hero-0', shape: 'no-such-shape' });
  check(r8.ok === false && r8.kind === 'no-catalog',
    `区块库整个不在 ⟹ 拒并说人话（实际 ${JSON.stringify(r8)}）`);

  fs.rmSync(tmp, { recursive: true, force: true });
}

// ── ⑦ resetShapesInSite —— 「全部恢复主题默认」（AC3 第三句）────────────────────────────────────
console.log('\n⑦ resetShapesInSite —— 页面级 / 站级一次清空');
{
  const fs = require('fs');
  const os = require('os');
  const mk = () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'resetshape-'));
    const site = path.join(root, 'site');
    fs.mkdirSync(path.join(site, 'en', 'pages'), { recursive: true });
    fs.mkdirSync(path.join(site, 'fr', 'pages'), { recursive: true });
    fs.writeFileSync(path.join(site, 'site_meta.json'), JSON.stringify({ defaultLocale: 'en', locales: ['en', 'fr'] }));
    // home：两个手挑的块 + 一个没挑的（AC3 原话是「对两个手挑块一次清空」）
    fs.writeFileSync(path.join(site, 'en', 'pages', 'home.json'), `${JSON.stringify({
      slug: 'home',
      blocks: [
        { id: 'home-hero-0', type: 'hero', weight: 0, shape: 'media-cover', data: { headline: 'A' } },
        { id: 'home-faq-1', type: 'faq-accordion', weight: 10, hidden: true, data: { headline: 'B' } },
        { ref: 'shared-hero', weight: 20, shape: 'text-left' },
      ],
    }, null, 2)}\n`);
    // about：一个都没挑 —— 这一页**不许被写**
    fs.writeFileSync(path.join(site, 'en', 'pages', 'about.json'), `${JSON.stringify({
      slug: 'about', blocks: [{ id: 'about-hero-0', type: 'hero', weight: 0, data: { headline: 'C' } }],
    }, null, 2)}\n`);
    // 另一个语言也有一个手挑的（站级清空要扫到它）
    fs.writeFileSync(path.join(site, 'fr', 'pages', 'home.json'), `${JSON.stringify({
      slug: 'home', blocks: [{ id: 'home-hero-0', type: 'hero', weight: 0, shape: 'media-left', data: {} }],
    }, null, 2)}\n`);
    return root;
  };
  const read = (root, rel) => fs.readFileSync(path.join(root, 'site', rel), 'utf-8');

  // 页面级：只动被点名的那一页
  {
    const root = mk();
    const beforeAbout = read(root, 'en/pages/about.json');
    const beforeFr = read(root, 'fr/pages/home.json');
    const r = resetShapesInSite({ rootDir: root, locale: 'en', page: 'home' });
    check(r.ok === true && r.cleared.length === 2,
      `页面级 ⟹ 一次清掉这一页那 2 个手挑的块（实际 ${r.cleared.length}：${JSON.stringify(r.cleared.map((c) => c.blockId))}）← AC3 第三句`);
    const home = JSON.parse(read(root, 'en/pages/home.json'));
    check(!home.blocks.some((b) => 'shape' in b), 'home.json 里已经一个 shape 键都没有了');
    check(home.blocks[1].hidden === true && home.blocks[2].weight === 20 && home.blocks[0].data.headline === 'A',
      '🔴 只删了 shape 这一个键 —— hidden / weight / data 原样还在');
    check(read(root, 'en/pages/about.json') === beforeAbout,
      '一个都没挑的那一页**逐字节没被动过**（写回会换掉 mtime，而 sitemap 的 lastmod 有 mtime 兜底）');
    check(read(root, 'fr/pages/home.json') === beforeFr, '另一个语言的同名页也没被动（点名的是 en/home）');
    check(r.files.length === 1 && r.files[0].includes('home.json'), `只报了它真写过的那一份（实际 ${JSON.stringify(r.files)}）`);
    fs.rmSync(root, { recursive: true, force: true });
  }

  // 站级：全部语言、全部页面
  {
    const root = mk();
    const beforeAbout = read(root, 'en/pages/about.json');
    const r = resetShapesInSite({ rootDir: root });
    check(r.ok === true && r.cleared.length === 3,
      `站级 ⟹ 两个语言加起来 3 个手挑的块全清（实际 ${r.cleared.length}）`);
    check(r.cleared.some((c) => c.locale === 'fr'), '另一个语言那个也被扫到了（站级不是只扫默认语言）');
    check(read(root, 'en/pages/about.json') === beforeAbout, '没挑过的那一页照样一个字节没动');
    fs.rmSync(root, { recursive: true, force: true });
  }

  // 🔴 反向对照：一个手挑的都没有的站 ⟹ cleared 空、**一个文件都不写**（没有改动就不该有 commit）
  {
    const root = mk();
    resetShapesInSite({ rootDir: root });          // 先清干净
    const names = ['en/pages/home.json', 'en/pages/about.json', 'fr/pages/home.json'];
    const snap = names.map((f) => read(root, f)).join('|##|');
    const again = resetShapesInSite({ rootDir: root });
    check(again.ok === true && again.cleared.length === 0 && again.files.length === 0,
      `已经清干净的站再点一次 ⟹ 0 个块 / 0 份文件（实际 ${again.cleared.length} / ${again.files.length}）`);
    check(names.map((f) => read(root, f)).join('|##|') === snap, '第二次调用之后三份文件逐字节不变');
    fs.rmSync(root, { recursive: true, force: true });
  }

  // 老扁平站（没有 site_meta.json、页面写 sections）
  {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'resetlegacy-'));
    fs.mkdirSync(path.join(root, 'site', 'pages'), { recursive: true });
    fs.writeFileSync(path.join(root, 'site', 'pages', 'home.json'), `${JSON.stringify({
      slug: 'home', sections: [{ type: 'hero', shape: 'media-top', data: {} }, { type: 'faq-accordion', data: {} }],
    }, null, 2)}\n`);
    const r = resetShapesInSite({ rootDir: root });
    check(r.ok === true && r.cleared.length === 1 && r.cleared[0].index === 0,
      `老 sections 形状也清得掉，并按下标点名（实际 ${JSON.stringify(r.cleared)}）`);
    fs.rmSync(root, { recursive: true, force: true });
  }
}

console.log(`\n══ block-shape.test.js: ${pass} 过 · ${fail} 失败 ══`);
process.exit(fail ? 1 : 0);
