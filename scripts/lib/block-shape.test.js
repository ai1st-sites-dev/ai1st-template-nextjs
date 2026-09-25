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
        { id: 'home-faq-1', type: 'faq-accordion', weight: 10, role: 'optional', data: { headline: 'B' } },
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
    check(home.blocks[1].role === 'optional' && home.blocks[2].weight === 20 && home.blocks[0].data.headline === 'A',
      '🔴 只删了 shape 这一个键 —— role / weight / data 原样还在');
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

// ── ⑧ 候选形态（#1384 交接给本票的那一条，#1350 r6）─────────────────────────────────────────────
//
// 🔴 **这一节守的是「两半读同一个字段」。** 在 r5 之前只有构建那一半读 `shapes[i].candidate`：
//    `shapeVerdict` 回 `{ ok: true }` ⟹ manager 202 ⟹ worker 真写进页面 JSON ⟹ 构建再静默落回
//    主题形态。老板点了保存、看到成功，产物却是原来那副 —— 与本票 r4 被打回的那一条同款，只是触发
//    条件换成了「区块库里进了一个候选形态」。
// 🔴 **照本文件头那条纪律，用【真 manifest 的深拷贝】改一个字段，不造合成 manifest。** 这样「真 hero
//    到底长什么样」这一维还在，而且这几格**不依赖今天盘上有没有候选** —— 候选是会进也会出的（Chris
//    签了字，对表票就把那个标摘掉），而断言不该跟着那件事一红一绿。
// 🔴 **顺序也要量**：一个形态同时是候选又缺槽位时，两半必须说同一句话（都说「候选」）。先判缺槽位
//    的实现会让老板去填那个槽，填完再存还是存不进去。
console.log('\n⑧ 候选形态 —— 校验那一半也要拒（跟构建同一个字段、同一个顺序）');
{
  const clone = (o) => JSON.parse(JSON.stringify(o));
  // 「这个形态在这块数据上缺哪些槽位」—— 借被测对象自己的判据（`shapeVerdict` 的 gap 那一支），
  // 不在这里另写一份减法：本节要的只是「夹具前提成立吗」，而那个前提的口径必须跟被测的一致。
  const needsOf = (m, name) => {
    const r = shapeVerdict(m, name, { headline: 'H' });
    return r.ok === false && r.kind === 'gap' ? r.missing : [];
  };
  const CAND_FREE = 'media-top';      // 不缺槽位？不一定 —— 下面自己量，不假设
  const CAND_NEEDY = 'media-cover';   // hero 里要 imageUrl 的那个（文件顶部已 die 过它存在）

  const heroCand = clone(manifests.hero);
  const mark = (name) => {
    const sh = (heroCand.shapes || []).find((x) => x && x.name === name);
    if (!sh) die(`hero 的清单里没有 ${name} —— 本节的断言要跟着改`);
    sh.candidate = true;
  };
  mark(CAND_FREE);
  mark(CAND_NEEDY);
  const msCand = { ...manifests, hero: heroCand };
  // 这一节压着的前提先自己量一次：CAND_NEEDY 确实缺槽位（这样「候选压过缺槽位」才有对照）
  // 🔴 这个前提要在**没标候选**的那份上量：标上之后候选那一支在前面就短路了，量出来永远是 `[]`
  //    （第一版就是这么写的，它会把一个假前提读成真）。
  check(needsOf(manifests.hero, CAND_NEEDY).length > 0,
    `夹具前提：${CAND_NEEDY} 在没填图的块上确实缺槽位（这样下面那格才分得开两种 kind）`);

  // ① 校验那一半：拒，并且点名是「候选」这一种
  const v = shapeVerdict(heroCand, CAND_FREE, withImage);
  check(v.ok === false && v.kind === 'candidate',
    `候选形态 ⟹ kind=candidate（实际 ${JSON.stringify(v.kind)}）← 在 r5 上这里是 ok:true，manager 会 202`);
  check(typeof v.message === 'string' && v.message.includes(CAND_FREE) && v.message.includes('签字进库'),
    `candidate 的报文点名了这个形态、并说出它为什么不能选（实际 ${JSON.stringify(v.message)}）`);
  check(Array.isArray(v.missing) && v.missing.length === 0,
    'candidate 不报缺槽位 —— 它跟这个网站缺什么无关（老板补什么都不会让它可选）');

  // ② 构建那一半：落回默认并说一行（这一半在 r5 上就是对的，这里是为了并排看「两半一句话」）
  const built = run({ type: 'hero', shape: CAND_FREE, data: withImage }, {}, msCand);
  check(built.out === manifests.hero.shapes[0].name && !built.threw,
    `构建落回默认 ${manifests.hero.shapes[0].name}（实际 ${JSON.stringify(built.out)}），不抛`);
  check(built.log.includes('候选'), `构建说了那一行（实际 ${JSON.stringify(built.log)}）`);

  // ③ 🔴 候选压过缺槽位 —— 两半说的是同一种，而不是一边「候选」一边「先填上 imageUrl」
  const vNeedy = shapeVerdict(heroCand, CAND_NEEDY, { headline: 'H' });
  check(vNeedy.ok === false && vNeedy.kind === 'candidate',
    `同时是候选又缺槽位 ⟹ 校验说 candidate（实际 ${JSON.stringify(vNeedy.kind)}）← 顺序与 shapeForBlock 一致`);
  const builtNeedy = run({ type: 'hero', shape: CAND_NEEDY, data: { headline: 'H' } }, {}, msCand);
  check(builtNeedy.log.includes('候选') && !builtNeedy.log.includes('缺槽位'),
    `构建也说 candidate 那一句、不说缺槽位（实际 ${JSON.stringify(builtNeedy.log)}）`);

  // ④ 🔴 逐形态两半一致 —— 就是第 ⑤ 节那个不变量，跑在一份**带候选**的 manifest 上。
  //    r5 的实现在这一格上会红：候选那两个形态「校验放行、构建不戴」。
  {
    const probes = [{ headline: 'H' }, withImage];
    let agree = 0; const disagree = [];
    for (const shape of heroShapes.concat(['no-such-shape'])) {
      for (const data of probes) {
        const verdict = shapeVerdict(heroCand, shape, data).ok;
        const wears = run({ type: 'hero', shape, data }, {}, msCand).out === shape;
        if (verdict === wears) agree += 1;
        else disagree.push(`${shape} / data=${JSON.stringify(Object.keys(data))}: 校验=${verdict} 构建戴上=${wears}`);
      }
    }
    check(disagree.length === 0,
      `${agree} 组（${heroShapes.length + 1} 个形态 × 2 份 data，其中 2 个形态是候选）逐组一致：校验放行 ⟺ 构建真戴上`
      + (disagree.length ? ` —— 不一致: ${disagree.join(' | ')}` : ''));
  }

  // ⑤ 🔴 反向臂 —— 这一臂专防「按形态名写死一份候选名单」：把标摘掉，同一个形态就该回来。
  //    写死名单的实现在上面那些正臂上全绿，在这一臂上红。
  {
    const heroBack = clone(manifests.hero);
    const back = (heroBack.shapes || []).find((x) => x && x.name === CAND_FREE);
    back.candidate = true;
    delete back.candidate;                       // 摘掉标（区块库返工 / Chris 签了字就是这个动作）
    const msBack = { ...manifests, hero: heroBack };
    const gapBack = needsOf(heroBack, CAND_FREE);
    const data = gapBack.length ? withImage : { headline: 'H' };
    const vb = shapeVerdict(heroBack, CAND_FREE, data);
    check(vb.ok === true, `摘掉 candidate ⟹ 校验放行（实际 ${JSON.stringify(vb)}）`);
    check(run({ type: 'hero', shape: CAND_FREE, data }, {}, msBack).out === CAND_FREE,
      '摘掉 candidate ⟹ 构建也真戴上它（两半一起翻面）');
    // 而同一份里另一个仍标着的形态**仍然**被拒 —— 单变量：两个形态只差那个字段
    const heroMixed = clone(heroCand);
    const one = (heroMixed.shapes || []).find((x) => x && x.name === CAND_FREE);
    delete one.candidate;
    check(shapeVerdict(heroMixed, CAND_FREE, data).ok === true
      && shapeVerdict(heroMixed, CAND_NEEDY, withImage).kind === 'candidate',
      '同一份 manifest 里摘掉一个、留着另一个 ⟹ 只有摘掉的那个回来（判据是字段，不是名单）');
  }

  // ⑥ `candidate: false` 与「压根没写」都不是候选（别把「有这个键」当成判据）
  {
    const heroFalse = clone(manifests.hero);
    const sh = (heroFalse.shapes || []).find((x) => x && x.name === CAND_FREE);
    sh.candidate = false;
    check(shapeVerdict(heroFalse, CAND_FREE, withImage).ok === true, '`candidate: false` 不是候选');
    check(shapeVerdict(manifests.hero, CAND_FREE, withImage).ok === true, '压根没写 candidate 的不是候选');
  }

  // ⑥b 🔴 `checkShapeInSite` —— **manager 真正收到的就是这个函数的返回值**，所以 `kind` 必须一路
  //    传到它。manager 那一侧是 kind 无关的（`block_shape.go` 把 `verdict.Kind` 原样放进 400 的
  //    `reason`），所以这一格就是「PUT 一个候选形态回 400 并点名是这一种」在容器里的那一段。
  //    🔴 夹具的 `blocks/` 是真 manifest 的**拷贝**（不是软链），这样标一个 candidate 不碰盘上那份，
  //       而这几格也不依赖今天盘上有没有候选。
  {
    const fs = require('fs');
    const os = require('os');
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'candsite-'));
    const en = path.join(tmp, 'site', 'en');
    fs.mkdirSync(path.join(en, 'pages'), { recursive: true });
    // #1387 —— 一个块一个文件夹，形态在子文件夹里，所以整棵拷；标候选是改那个形态的 shape.md。
    fs.cpSync(path.join(NEXT, 'blocks'), path.join(tmp, 'blocks'), { recursive: true });
    const heroShapeMd = path.join(tmp, 'blocks', 'hero', CAND_FREE, 'shape.md');
    if (!fs.existsSync(heroShapeMd)) die(`夹具里 hero 没有 ${CAND_FREE}`);
    fs.writeFileSync(heroShapeMd,
      fs.readFileSync(heroShapeMd, 'utf-8').replace(/^---\n/, '---\ncandidate: true\n'));
    fs.writeFileSync(path.join(tmp, 'site', 'site_meta.json'), JSON.stringify({ defaultLocale: 'en' }));
    fs.writeFileSync(path.join(tmp, 'site', 'theme.json'), JSON.stringify({ themeId: 'azure-29', applied: true }));
    fs.writeFileSync(path.join(en, 'pages', 'home.json'), JSON.stringify({
      slug: 'home',
      title: 'Home',
      blocks: [{ id: 'home-hero-0', type: 'hero', weight: 0, data: { headline: '有图', imageUrl: 'https://e/a.jpg' } }],
    }));

    const r = checkShapeInSite({ rootDir: tmp, page: 'home', blockId: 'home-hero-0', shape: CAND_FREE });
    check(r.ok === false && r.kind === 'candidate',
      `checkShapeInSite 把 candidate 这一种传了出去（实际 ${JSON.stringify(r)}）← manager 据它回 400 + reason`);
    check(typeof r.message === 'string' && r.message.includes('签字进库'),
      'manager 原样转给老板的那句话就是它（不是一个 kind 代号）');
    // 🔴 反臂：同一个夹具、同一个形态，只把那个字段摘掉 ⟹ 放行。
    fs.writeFileSync(heroShapeMd,
      fs.readFileSync(heroShapeMd, 'utf-8').replace(/^candidate: true\n/m, ''));
    const r2 = checkShapeInSite({ rootDir: tmp, page: 'home', blockId: 'home-hero-0', shape: CAND_FREE });
    check(r2.ok === true, `摘掉那个字段 ⟹ 同一个请求放行（实际 ${JSON.stringify(r2)}）`);
    // 页面 JSON 一个字节没被写（校验不写东西，AC5 的后半句）
    const after = JSON.parse(fs.readFileSync(path.join(en, 'pages', 'home.json'), 'utf-8'));
    check(after.blocks.length === 1 && after.blocks[0].shape === undefined,
      '两次校验跑完页面 JSON 还是原样、没有被写上 shape');
    fs.rmSync(tmp, { recursive: true, force: true });
  }

  // ⑦ 盘上**今天真有的**候选，逐个过两半（这一格的分母会变 —— 它是报读数，上面那几格才是不变量）
  {
    const real = [];
    for (const [type, m] of Object.entries(manifests)) {
      for (const sh of (m.shapes || [])) {
        if (sh && sh.candidate === true && sh.name) real.push({ type, name: sh.name, m });
      }
    }
    console.log(`  📌 盘上今天有 ${real.length} 个候选形态${real.length ? `：${real.map((r) => `${r.type}/${r.name}`).join('、')}` : '（一个都没有 —— 上面那几格不依赖它）'}`);
    const bad2 = [];
    for (const r of real) {
      const vr = shapeVerdict(r.m, r.name, {});
      const wears = run({ type: r.type, shape: r.name, data: {} }, {}, manifests).out === r.name;
      if (vr.kind !== 'candidate' || wears) bad2.push(`${r.type}/${r.name}: kind=${vr.kind} 构建戴上=${wears}`);
    }
    if (real.length) {
      check(bad2.length === 0,
        `盘上那 ${real.length} 个候选逐个：校验说 candidate 且构建不戴上`
        + (bad2.length ? ` —— ${bad2.join(' | ')}` : ''));
    }
  }
}

console.log(`\n══ block-shape.test.js: ${pass} 过 · ${fail} 失败 ══`);
process.exit(fail ? 1 : 0);
