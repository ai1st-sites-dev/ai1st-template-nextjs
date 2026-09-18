#!/usr/bin/env node
/**
 * block-catalog.test.js — 「有哪些块、每个块有哪些形态」那一份派生函数（#1343）。
 *
 * 跑法:  node scripts/lib/block-catalog.test.js   （或 `npm run test:scripts`，它按文件名发现）
 * 退出码: 0 全过 · 1 有失败 · 2 跑不起来（**不许当成通过**）
 *
 * ══ 为什么这份文件存在 ══════════════════════════════════════════════════════════════════════
 * 这个函数存在的**全部理由**是「注册表和 blocks/ 对不上时要有人喊」。而那件事在今天的盘上
 * **不会发生**（32 ≡ 32），所以在真树上跑它永远是绿的 —— 正臂对「这条判据是不是真的接着线」
 * 一个字都说不出来。下面每一条判据都配一个**造出来的反臂**：在临时目录里把注册表或 blocks/
 * 弄成对不上，它必须抛，而且那句话里要点名是哪个块。
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

let cat; let bm;
try {
  cat = require(path.join(NEXT, 'scripts', 'lib', 'block-catalog.js'));
  bm = require(path.join(NEXT, 'scripts', 'lib', 'block-manifest.js'));
} catch (e) { die(`require 失败: ${e.message}`); }

const { blockShapeCatalog, sampleDataFor } = cat;

// ── ① 真树：块 ≡ 注册表、对数 ≡ 每份 manifest 的 shapes 之和、顺序 ≡ 注册表写的顺序 ────────────
console.log('① 真树上的读数（都现算，不写死任何数）');
const real = blockShapeCatalog();
const regNames = bm.registryNames(path.join(NEXT, 'src', 'lib', 'sections', 'registry.ts'));
if (regNames === null) die('读不出 registry.ts（typescript 模块不在？）—— 这不是关于注册表的读数');
// #1353 —— 这一格原来写的是 `real.blocks` **逐项等于** `registryNames()`。那条断言今天会假红：
// 外壳区（`header` / `footer`）是块、有 manifest、有形态、在选择单上各占一行，但按构造**不在
// registry.ts 里**（那张表是「页面 JSON 的 type → 组件」，而外壳区不进页面 JSON）。
// 🔴 改成两半判，两半都要：① 注册表那批**逐项、按注册表自己的顺序**排在前面（原来那句话要买的
//    性质：那一页看得见的 section 顺序不许被改成字典序）；② 追加的那一批**恰好**是声明了
//    `region: true` 的那些，不多不少 —— 少了就是图册漏行（静默），多了就是把内容块当成外壳区。
const regionTypes = [...real.manifests.values()].filter((m) => m.region === true).map((m) => m.type);
check(JSON.stringify(real.blocks.slice(0, regNames.length)) === JSON.stringify(regNames),
  `blocks 的前 ${regNames.length} 个逐项等于注册表自己声明的顺序`);
check(JSON.stringify(real.blocks.slice(regNames.length).slice().sort())
  === JSON.stringify(regionTypes.slice().sort()),
  `追加的那批恰好是 manifest 里声明 region:true 的（${regionTypes.slice().sort().join(' / ')}）`);
check(real.blocks.length === regNames.length + regionTypes.length,
  `blocks 一共 ${real.blocks.length} 个 = 注册表 ${regNames.length} + 外壳区 ${regionTypes.length}`);
const manifestPairs = real.blocks.reduce((n, t) => n + real.manifests.get(t).shapes.length, 0);
check(real.pairs.length === manifestPairs,
  `pairs 的条数 ${real.pairs.length} == 每份 manifest 的 shapes 之和 ${manifestPairs}`);
check(real.pairs.every((p) => p.intent && Object.keys(p.intent).length > 0),
  '每一对都带得出合并后的 layout_intent');
// #1384 —— 候选身份跟着每一对走。🔴 **归一成布尔**（manifest 里没写 = false），消费者判的是值、
//    不是「有没有这个键」；#1350 那个形态下拉就按这个字段过滤。
check(real.pairs.every((p) => typeof p.candidate === 'boolean'),
  `每一对都带 candidate 布尔（今天盘上是候选的有 ${real.pairs.filter((p) => p.candidate).length} 对）`);
// 跟 `shapes.css` 那一半的两向差集 —— 用 block-manifest 自己那把尺，不在这里重写一份
const d = bm.diffShapesAgainstCss(real.manifests);
check(d.onlyInCss.length === 0 && d.onlyInManifests.length === 0,
  `manifest 的形态清单与 shapes.css 双向差集 0（onlyInCss ${d.onlyInCss.length} · onlyInManifests ${d.onlyInManifests.length}）`);

// ── ② 反臂：造一棵对不上的树，它必须抛，而且点名 ───────────────────────────────────────────────
console.log('② 反臂 —— 注册表与 blocks/ 对不上（真树上造不出来，所以造一棵）');

function fixture(blocks, registryTypes) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'blockcat-'));
  fs.mkdirSync(path.join(root, 'blocks'));
  fs.mkdirSync(path.join(root, 'public'));
  const css = [];
  for (const [type, shapes] of Object.entries(blocks)) {
    fs.writeFileSync(path.join(root, 'blocks', `${type}.json`), JSON.stringify({
      type,
      // #1349 —— 第三个这样的键。夹具少了它，下面四个反臂又会全部变成「夹具自己不合法」（见下面
      //          那条 🔴 —— 这正是它记下来的那件事，第二次发生）。
      displayName: `Test ${type}`,
      category: 'test',
      roleDefault: 'optional',
      layout_intent: { items: 'none', item_wrap: 'allow', headline: 'none', media: 'none', columns: 'one' },
      // #1384 —— 一项可以写成 `'名字'`，也可以写成 `{ name, candidate: true }`（3a 那个臂要后者）。
      shapes: shapes.map((sh) => (typeof sh === 'string' ? { name: sh, needs: [] }
        : { name: sh.name, needs: [], ...(sh.candidate === undefined ? {} : { candidate: sh.candidate }) })),
      slots: { headline: { kind: 'text', required: true, promptOptional: false } },
      // 🔴 `checkManifestShape` 还要这几个键 —— 少了它当场抛，而那句话跟本文件要测的那条错**长得不一样**
      //    却同样是「抛了」。第一版夹具就少了 `variants`，四个反臂于是全都在测「夹具自己不合法」；
      //    #1349 加 `displayName` 时又撞了一次同一件事（上面那个键）。
      variants: {},
      industries: { required: [], recommended: [], discouraged: [] },
    }, null, 2));
    for (const s of shapes) {
      const n = typeof s === 'string' ? s : s.name;
      css.push(`[data-block="${type}"][data-shape="${n}"] { display: block; }`);
    }
  }
  fs.writeFileSync(path.join(root, 'public', 'shapes.css'), `${css.join('\n')}\n`);
  const body = registryTypes.map((t) => `  '${t}': Stub,`).join('\n');
  fs.writeFileSync(path.join(root, 'registry.ts'),
    `const Stub = () => null;\nexport const sectionRegistry = {\n${body}\n};\n`);
  return root;
}

const throwsWith = (fn, needle, label) => {
  let msg = null;
  try { fn(); } catch (e) { msg = e.message; }
  if (msg === null) { bad(`${label} —— 它**没有抛**（这正是本函数存在的理由，所以这一格是阻断的）`); return; }
  check(msg.includes(needle), `${label} —— 抛了，而且点了名：${msg.slice(0, 160)}`);
};

// 2a 注册表里多一个键、blocks/ 里没有它的 manifest
{
  const root = fixture({ alpha: ['solo'] }, ['alpha', 'ghost']);
  throwsWith(() => blockShapeCatalog({
    registryPath: path.join(root, 'registry.ts'), blocksDir: path.join(root, 'blocks'),
  }), 'ghost', '2a 注册表多一个假类型、不给它 manifest');
  // 正对照：同一棵树，把注册表改回对得上 ⟹ 不抛（证明上面那一条红的是**这个差异**，不是这棵树本身）
  const okRoot = fixture({ alpha: ['solo'] }, ['alpha']);
  let threw = null;
  try {
    const c = blockShapeCatalog({
      registryPath: path.join(okRoot, 'registry.ts'), blocksDir: path.join(okRoot, 'blocks'),
    });
    check(c.blocks.length === 1 && c.pairs.length === 1, '2a 正对照：同构的一棵树对得上时不抛，读到 1 块 / 1 对');
  } catch (e) { threw = e.message; }
  if (threw) bad(`2a 正对照本该不抛，却抛了：${threw}`);
}

// 2a′ #1384 —— 候选**照样进这份清单**，而且它的 `candidate` 是 true、别的对是 false。
//
// 🔴 这一格是本票的正向臂，方向跟「候选不上真站」相反、两条缺一不可：候选必须被图册画出来、被几何
//    守卫量到（`theme-css-invariants.mjs` 检查 ⑨ 的 manifests 就从这个函数来），它只是不许被**挑**上站。
//    实现成「从清单里滤掉候选」的话这一格当场红，而那种实现会让候选在图册上消失、在守卫里失明 ——
//    也就是「转正那天才发现它一直坏着」，正是本票要防的那件事。
{
  const root = fixture({ alpha: ['solo', { name: 'draft', candidate: true }] }, ['alpha']);
  const c = blockShapeCatalog({
    registryPath: path.join(root, 'registry.ts'), blocksDir: path.join(root, 'blocks'),
  });
  const draft = c.pairs.find((p) => p.shape === 'draft');
  const solo = c.pairs.find((p) => p.shape === 'solo');
  check(c.pairs.length === 2 && !!draft && draft.candidate === true && !!solo && solo.candidate === false,
    `2a′ 候选进清单：2 对里 draft.candidate=${draft && draft.candidate} · solo.candidate=${solo && solo.candidate}`);
}

// 2b blocks/ 里多一份 manifest、注册表里没有它
{
  const root = fixture({ alpha: ['solo'], orphan: ['solo'] }, ['alpha']);
  throwsWith(() => blockShapeCatalog({
    registryPath: path.join(root, 'registry.ts'), blocksDir: path.join(root, 'blocks'),
  }), 'orphan', '2b blocks/ 里多一份 manifest、注册表里没有它');
}

// 2c 读不出注册表（「什么都没查」不许被读成「全都对得上」）
//
// 🔴 顺带一个**圈外**的读数，记在这儿免得下一个人以为是本票弄坏的：这一格拿到的那句话是
//    「读不到 typescript 这个模块」，而真相是「注册表在、typescript 也在、只是里面没有
//    `sectionRegistry` 那个对象字面量」。原因在 `block-manifest.js`：`registryNames()` 的 `names`
//    初值是 `null`，找不到那个声明时它**原样回 null**，于是 `registryCoverage` 走的是
//    「typescript 读不到」那一支 —— 它下面那个 `known.length === 0`（「它改名或换写法了？」）
//    的分支按构造到不了。**方向是安全的**（两支都回 `unavailable` = 什么都没查，不会被读成
//    「全都对得上」），错的只是给人的那句提示。本票不动它（scope 圈外），判据只认「有没有抛」。
{
  const root = fixture({ alpha: ['solo'] }, ['alpha']);
  fs.writeFileSync(path.join(root, 'registry.ts'), 'export const notTheRegistry = {};\n');
  throwsWith(() => blockShapeCatalog({
    registryPath: path.join(root, 'registry.ts'), blocksDir: path.join(root, 'blocks'),
  }), '什么都没查', '2c 注册表在、但里面没有 sectionRegistry（回的是 unavailable 那一支）');
}

// ── ③ 示例数据：全填版 / 最少版，两臂都要读到不同的东西 ─────────────────────────────────────────
console.log('③ 示例数据（图册那两列）');
{
  const withOptional = real.blocks.filter((t) => Object.values(real.manifests.get(t).slots)
    .some((s) => s.required === false));
  check(withOptional.length > 0, `有可选槽的块：${withOptional.length} 个 —— 下面两臂靠它们才分得开`);
  let shrank = 0;
  for (const t of withOptional) {
    const m = real.manifests.get(t);
    const full = Object.keys(sampleDataFor(m));
    const min = Object.keys(sampleDataFor(m, { minimal: true }));
    if (min.length < full.length) shrank += 1;
  }
  check(shrank === withOptional.length,
    `这 ${withOptional.length} 个块的最少版键数都严格少于全填版（${shrank} 个）`);

  // 📌 这里原来还数一格「`kind:"variant"` 的槽一个都不填」。#1341 之后盘上一个 variant 槽都没有
  //    （现取 0），那一格于是恒绿 —— 它量不到任何东西，跟着 `sampleDataFor` 里那条分支一起去掉。
  let missing = []; let requiredMissing = [];
  for (const t of real.blocks) {
    const m = real.manifests.get(t);
    const full = sampleDataFor(m);
    const min = sampleDataFor(m, { minimal: true });
    for (const [slot, spec] of Object.entries(m.slots)) {
      if (!(slot in full)) missing.push(`${t}.${slot}`);
      if (spec.required === true && !(slot in min)) requiredMissing.push(`${t}.${slot}`);
      if (spec.required === false && slot in min) requiredMissing.push(`${t}.${slot} 不该在最少版里`);
    }
  }
  check(missing.length === 0, `全填版覆盖每一个槽位（漏 ${missing.length} 个 ${JSON.stringify(missing.slice(0, 5))}）`);
  check(requiredMissing.length === 0, `最少版恰好是必填槽（不符 ${requiredMissing.length} 处 ${JSON.stringify(requiredMissing.slice(0, 5))}）`);

  // 形状提示的三种形态各取一次读数（都是盘上真有的写法）
  const cg = sampleDataFor(real.manifests.get('card-group'));
  check(Array.isArray(cg.items) && cg.items.length === 3 && typeof cg.items[0].title === 'string',
    `"[{title, description?, …}]" 这种**规格**造出三项：${JSON.stringify(cg.items[0]).slice(0, 80)}`);
  const qf = sampleDataFor(real.manifests.get('quote-form'));
  check(Array.isArray(qf.urgencyOptions) && qf.urgencyOptions[0] === 'ASAP',
    `写死的一串**例子**原样保留：${JSON.stringify(qf.urgencyOptions)}`);
  const ph = sampleDataFor(real.manifests.get('page-header'));
  check(Array.isArray(ph.breadcrumbs) && ph.breadcrumbs.length === 2 && ph.breadcrumbs[0].href === '/',
    `多格的例子不按规格重造（${JSON.stringify(ph.breadcrumbs)}）`);
  const hero = sampleDataFor(real.manifests.get('hero'));
  check(hero.imageUrl === cat.PLACEHOLDER_IMAGE, `图走占位图：${hero.imageUrl}`);
}

console.log(`\n${fail === 0 ? '✅' : '❌'} block-catalog: ${pass} 过 / ${fail} 不过`);
process.exit(fail === 0 ? 0 : 1);
