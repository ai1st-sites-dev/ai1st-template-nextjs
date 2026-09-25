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
 * ⑦ 「全部恢复主题默认」（§resetShapesInSite）。⑧ 候选形态：构建不许戴上它。
 *
 * 📌 这里原来还有 ⑤ `shapeVerdict`、⑥ `checkShapeInSite` 两节，以及 ⑧ 里「校验那一半」的几格 —— 它们守的是
 *    检查器单块形态端点（`PUT …/blocks/{id}/shape`）的入队前校验跟构建说同一句话。那条端点和那两个函数
 *    #1444 删了（检查器 #1411 退役），那几格跟着删；构建那一半一格没少。
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

let shapeForBlock; let resetShapesInSite;
let loadBlockManifests; let shapesFor; let shapeNeedsGap;
try {
  ({ shapeForBlock, resetShapesInSite } = require(path.join(NEXT, 'scripts', 'lib', 'block-shape.js')));
  ({ shapeNeedsGap } = require(path.join(NEXT, 'scripts', 'lib', 'block-manifest.js')));
  ({ loadBlockManifests } = require(path.join(NEXT, 'scripts', 'blocks.js')));
  ({ shapesFor } = require(path.join(NEXT, 'scripts', 'themes.js')));
} catch (e) {
  die(`require 失败: ${e.message}`);
}
if (typeof shapeForBlock !== 'function') die('block-shape.js 没导出 shapeForBlock');
if (typeof resetShapesInSite !== 'function') die('block-shape.js 没导出 resetShapesInSite');
if (typeof shapeNeedsGap !== 'function') die('block-manifest.js 没导出 shapeNeedsGap');

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

// ── ③ 缺槽位（D11 ⑥）──────────────────────────────────────────────────────────────────────────
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

// ── ⑧ 候选形态（#1384）——构建不许戴上它 ─────────────────────────────────────────────────────────
//
// 🔴 **照本文件头那条纪律，用【真 manifest 的深拷贝】改一个字段，不造合成 manifest。** 这样「真 hero
//    到底长什么样」这一维还在，而且这几格**不依赖今天盘上有没有候选** —— 候选是会进也会出的（Chris
//    签了字，对表票就把那个标摘掉），而断言不该跟着那件事一红一绿。
// 🔴 **顺序也要量**：一个形态同时是候选又缺槽位时，构建说的是「候选」那一句，不是「先填上 X」——
//    后者会让人去填那个槽，填完还是戴不上。
console.log('\n⑧ 候选形态 —— 构建落回默认（判据是 manifest 那个字段、顺序在缺槽位之前）');
{
  const clone = (o) => JSON.parse(JSON.stringify(o));
  const needsOf = (m, name) => shapeNeedsGap(m, name, { headline: 'H' }) || [];
  const CAND_FREE = 'media-top';
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
  check(needsOf(manifests.hero, CAND_NEEDY).length > 0,
    `夹具前提：${CAND_NEEDY} 在没填图的块上确实缺槽位（这样下面那格才分得开两种原因）`);

  // ① 候选 ⟹ 落回默认并说一行
  const built = run({ type: 'hero', shape: CAND_FREE, data: withImage }, {}, msCand);
  check(built.out === manifests.hero.shapes[0].name && !built.threw,
    `构建落回默认 ${manifests.hero.shapes[0].name}（实际 ${JSON.stringify(built.out)}），不抛`);
  check(built.log.includes('候选'), `构建说了那一行（实际 ${JSON.stringify(built.log)}）`);

  // ② 🔴 候选压过缺槽位
  const builtNeedy = run({ type: 'hero', shape: CAND_NEEDY, data: { headline: 'H' } }, {}, msCand);
  check(builtNeedy.log.includes('候选') && !builtNeedy.log.includes('缺槽位'),
    `同时是候选又缺槽位 ⟹ 说候选那一句、不说缺槽位（实际 ${JSON.stringify(builtNeedy.log)}）`);

  // ③ 🔴 反向臂 —— 专防「按形态名写死一份候选名单」：把标摘掉，同一个形态就该回来；
  //    同一份里另一个仍标着的形态**仍然**落回（单变量：两个形态只差那个字段）。
  {
    const heroMixed = clone(heroCand);
    delete (heroMixed.shapes || []).find((x) => x && x.name === CAND_FREE).candidate;
    const msMixed = { ...manifests, hero: heroMixed };
    const data = needsOf(heroMixed, CAND_FREE).length ? withImage : { headline: 'H' };
    check(run({ type: 'hero', shape: CAND_FREE, data }, {}, msMixed).out === CAND_FREE,
      '摘掉 candidate ⟹ 构建真戴上它');
    check(run({ type: 'hero', shape: CAND_NEEDY, data: withImage }, {}, msMixed).out !== CAND_NEEDY,
      '同一份 manifest 里留着标的另一个 ⟹ 仍然落回（判据是字段，不是名单）');
  }

  // ④ `candidate: false` 与「压根没写」都不是候选（别把「有这个键」当成判据）
  {
    const heroFalse = clone(manifests.hero);
    (heroFalse.shapes || []).find((x) => x && x.name === CAND_FREE).candidate = false;
    const data = needsOf(heroFalse, CAND_FREE).length ? withImage : { headline: 'H' };
    check(run({ type: 'hero', shape: CAND_FREE, data }, {}, { ...manifests, hero: heroFalse }).out === CAND_FREE,
      '`candidate: false` 不是候选');
    if ('candidate' in (manifests.hero.shapes.find((x) => x.name === CAND_FREE) || {})) {
      die(`盘上的 hero/${CAND_FREE} 自己写着 candidate —— 「压根没写」那一格要换一个形态`);
    }
    check(run({ type: 'hero', shape: CAND_FREE, data }, {}, manifests).out === CAND_FREE,
      '压根没写 candidate 的不是候选');
  }

  // ⑤ 盘上**今天真有的**候选，逐个过构建（这一格的分母会变 —— 它是报读数，上面那几格才是不变量）
  {
    const real = [];
    for (const [type, m] of Object.entries(manifests)) {
      for (const sh of (m.shapes || [])) {
        if (sh && sh.candidate === true && sh.name) real.push({ type, name: sh.name });
      }
    }
    console.log(`  📌 盘上今天有 ${real.length} 个候选形态${real.length ? `：${real.map((r) => `${r.type}/${r.name}`).join('、')}` : '（一个都没有 —— 上面那几格不依赖它）'}`);
    const worn = real.filter((r) => run({ type: r.type, shape: r.name, data: {} }, {}, manifests).out === r.name);
    if (real.length) {
      check(worn.length === 0,
        `盘上那 ${real.length} 个候选逐个：构建不戴上` + (worn.length ? ` —— 戴上了: ${worn.map((r) => `${r.type}/${r.name}`).join(' | ')}` : ''));
    }
  }
}

console.log(`\n══ block-shape.test.js: ${pass} 过 · ${fail} 失败 ══`);
process.exit(fail ? 1 : 0);
