#!/usr/bin/env node
/**
 * block-shapes.test.js — 形态清单归区块库（#1331，设计文档 D1 / D4 / D11 ⑥）。
 *
 * 跑法:  node scripts/lib/block-shapes.test.js   （或 `npm run test:scripts`，它按文件名发现）
 * 退出码: 0 全过 · 1 有失败 · 2 跑不起来（**不许当成通过**）
 *
 * ══ 守什么 ═══════════════════════════════════════════════════════════════
 * 🔴 **原来的第 ① 段（`public/shapes.css` 的 (块,形态) 集合 == manifest 的 `shapes` 名字集合，两向
 *    差集为 0）随 #1387 删掉了，因为它按构造成立了。** 形态清单现在就是 `blocks/<块>/` 下的子文件夹
 *    清单，而 `public/shapes.css` 由 `scripts/block-build/build-blocks.js` 从同一批子文件夹拼出来
 *    —— 两边不再是「各写一份、要有人守它们相等」，是同一份的两种形态。接它班的是两道别的：
 *      · `scripts/block-build/generated-fresh.test.js`：盘上那份生成物 == 现在拼出来的那份；
 *      · 本文件 ③ 那一格新加的「shape.css 空了 / 不在 ⟹ 当场拒」：清单里多出一个没有几何的名字，
 *        是这条路上唯一还剩的失败方向。
 * ② `validateSite` 第 ⑥ 条：页面 JSON 点名的形态缺它 `needs` 的槽位 ⟹ 报一条；填上 ⟹ 不报。两臂都量。
 * ③ `checkManifestShape` 对 `shapes` 的白名单校验：逐种写错各自被拒（拼错键静默失效是 #1013 那次的失败方向）。
 *    🔴 **别在这句话里写个数** —— 这一格的清单是 `cases` 那个数组，加一条就改一次数，而那个数在这儿
 *    没有任何消费者。#1384 往里加了两条（candidate 的两种写错）+ 两个正向臂。
 *    🔴 负向臂跑在一个临时目录上，**先拿未改动的副本证明这套夹具本身立得起来**，否则五次「被拒」可能全是
 *    夹具坏了（一组对照全读到同一个值 = 尺子坏了）。
 * ④ 三个谓词（slotFilled / shapeNeedsGap / filledOptionalSlots）的读数表 + AC2 钉的两个事实
 *    （hero 默认 text-center；media-cover 需要 imageUrl）。
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

let bm;
try {
  bm = require(path.join(NEXT, 'scripts', 'lib', 'block-manifest.js'));
} catch (e) {
  die(`require 失败: ${e.message}`);
}
const {
  loadManifests, validateSite, slotFilled, defaultShapeOf, shapeNeedsGap,
  filledOptionalSlots, BLOCKS_DIR,
} = bm;
for (const [k, v] of Object.entries({ loadManifests, validateSite, slotFilled, defaultShapeOf, shapeNeedsGap, filledOptionalSlots })) {
  if (typeof v !== 'function') die(`block-manifest.js 没导出 ${k}`);
}

let manifests;
try { manifests = loadManifests(); } catch (e) { die(`loadManifests 抛了: ${e.message}`); }
if (manifests.size === 0) die('loadManifests 读到 0 份 manifest');

// ── ④ 谓词读数表 + AC2 的两个事实 ───────────────────────────────────────────
console.log('── ④ 三个谓词');
{
  const table = [[undefined, false], [null, false], ['', false], [[], false], ['x', true], [0, true], [false, true], [[1], true], [{}, true]];
  const wrong = table.filter(([v, want]) => slotFilled(v) !== want).map(([v]) => JSON.stringify(v));
  check(wrong.length === 0, `slotFilled 读数表 ${table.length} 格一致${wrong.length ? `（错在 ${wrong.join(' ')}）` : ''}`);
  const hero = manifests.get('hero');
  // #1333 —— hero 的默认从 `form-side` 换成了 `text-center`：带表单的首屏搬去了 `hero-with-form`，
  // 而剩下的 `media-cover` 要求有图，当不了默认（`checkManifestShape` 那条「默认形态 needs 必须为空」）。
  check(defaultShapeOf(hero) === 'text-center', `hero 的默认形态是 text-center（AC2 的前提，读到 ${defaultShapeOf(hero)}）`);
  const mc = hero.shapes.find((s) => s.name === 'media-cover');
  check(mc && mc.needs.length === 1 && mc.needs[0] === 'imageUrl', `hero/media-cover needs 恰好 ["imageUrl"]（读到 ${JSON.stringify(mc && mc.needs)}）`);
  check(JSON.stringify(shapeNeedsGap(hero, 'media-cover', {})) === '["imageUrl"]', 'shapeNeedsGap(hero, media-cover, 空) = ["imageUrl"]');
  check(JSON.stringify(shapeNeedsGap(hero, 'media-cover', { imageUrl: '/a.jpg' })) === '[]', 'shapeNeedsGap(hero, media-cover, 有图) = []');
  check(shapeNeedsGap(hero, 'not-a-shape', {}) === null, 'shapeNeedsGap 对清单外的名字回 null（跟「缺槽位」分得开）');
  const has = filledOptionalSlots(hero, { headline: 'h', subheadline: 's', imageUrl: '/a.jpg', variant: '' });
  check(JSON.stringify(has) === '["imageUrl"]', `filledOptionalSlots(hero) 只数 required:false 且填了的（读到 ${JSON.stringify(has)}；variant 是空串不算，headline 是必填不算）`);
  for (const [t, m] of manifests) {
    if (m.shapes[0].needs.length) bad(`${t} 的默认形态 ${m.shapes[0].name} 带 needs —— 落回它就无处可落`);
  }
  ok(`${manifests.size} 个块的默认形态 needs 全空（缺槽位落回的落点是实的）`);
}

// ── ② validateSite 第 ⑥ 条两臂 ─────────────────────────────────────────────
console.log('── ② validateSite 第 ⑥ 条');
{
  const heroPage = (extra) => ({
    slug: 'probe',
    blocks: [{
      type: 'hero',
      shape: 'media-cover',
      data: {
        headline: 'H', subheadline: 'S',
        ctaPrimary: { label: 'Call', href: '/contact' }, ctaSecondary: { label: 'More', href: '/about' },
        ...extra,
      },
    }],
  });
  const sixth = (pages) => validateSite({ pages, scope: 'edit' }).problems.filter((p) => p.includes('shape "'));
  const empty = sixth([heroPage({ imageUrl: '' })]);
  const filled = sixth([heroPage({ imageUrl: '/hero.jpg' })]);
  check(empty.length === 1 && empty[0].includes('"imageUrl"') && empty[0].includes('text-center'),
    `imageUrl 为空 ⟹ 恰好一条，点名 imageUrl 与落点 text-center：${empty[0] || '(没有)'}`);
  check(filled.length === 0, `imageUrl 填上 ⟹ 0 条（读到 ${filled.length}）`);
  check(empty.length !== filled.length, '两臂读数不同（尺子没坏）');
  const unknown = sixth([{ slug: 'p', blocks: [{ ...heroPage({}).blocks[0], shape: 'not-a-shape' }] }]);
  check(unknown.length === 1 && unknown[0].includes('不在'), `shape 不在清单里 ⟹ 一条「不在 … 清单里」：${unknown[0] || '(没有)'}`);
}

// ── ③ checkManifestShape 对形态清单的逐种拒绝（清单 = 下面那个 cases 数组）─────────────────────
console.log('── ③ checkManifestShape 白名单');
{
  const { formatFrontmatter, parseFrontmatter } = require(path.join(NEXT, 'scripts', 'block-build', 'frontmatter.js'));
  const rig = () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'block-shapes-'));
    fs.cpSync(BLOCKS_DIR, path.join(root, 'blocks'), { recursive: true });
    return root;
  };
  // mutate 拿到的是这份副本的 blocks/ 目录，想怎么改就怎么改（改 manifest.json、动子文件夹都行）。
  const withHero = (mutate) => {
    const root = rig();
    const blocks = path.join(root, 'blocks');
    const hero = path.join(blocks, 'hero');
    const readMd = (shape) => parseFrontmatter(fs.readFileSync(path.join(hero, shape, 'shape.md'), 'utf-8'));
    const writeMd = (shape, fm) => {
      fs.mkdirSync(path.join(hero, shape), { recursive: true });
      fs.writeFileSync(path.join(hero, shape, 'shape.md'), `${formatFrontmatter(fm)}\n# ${shape}\n`);
    };
    mutate({ root, blocks, hero, readMd, writeMd });
    try { loadManifests(blocks); return null; } catch (e) { return e.message; } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  };
  // 正向臂先行：未改动的副本在临时目录里装得起来，否则下面那些「被拒」不说明任何事。
  const clean = withHero(() => {});
  check(clean === null, `未改动的副本在临时目录装得起来（${clean === null ? '是' : `抛了: ${clean}`}）`);

  // hero 的形态顺序（order）：0 text-center（默认）· 1 media-cover · …
  const cases = [
    ['一个形态子文件夹都没有',
      ({ hero }) => { for (const e of fs.readdirSync(hero, { withFileTypes: true })) if (e.isDirectory()) fs.rmSync(path.join(hero, e.name), { recursive: true }); },
      'shapes 是 []'],
    ['manifest.json 里还写着 shapes',
      ({ hero }) => {
        const f = path.join(hero, 'manifest.json');
        const m = JSON.parse(fs.readFileSync(f, 'utf-8'));
        m.shapes = [{ name: 'text-center', needs: [] }];
        fs.writeFileSync(f, JSON.stringify(m, null, 2));
      },
      '还写着 shapes'],
    // 🔴 #1387 —— 接 #1331 班的那一条：形态清单 = 子文件夹清单之后，「清单里有个名字而它没有几何」
    //    是这条路上唯一还剩的失败方向（以前靠两向差集抓）。
    ['形态子文件夹里 shape.css 是空的',
      ({ hero }) => fs.writeFileSync(path.join(hero, 'media-cover', 'shape.css'), '\n'),
      'shape.css 不在或者是空的'],
    ['形态子文件夹里没有 shape.md',
      ({ hero }) => fs.rmSync(path.join(hero, 'media-cover', 'shape.md')),
      '少了 shape.md'],
    ['needs 指向不存在的槽位',
      ({ readMd, writeMd }) => { const fm = readMd('media-cover'); fm.needs = ['nope']; writeMd('media-cover', fm); },
      '"nope" 不是这个块的槽位'],
    ['needs 指向必填槽',
      ({ readMd, writeMd }) => { const fm = readMd('media-cover'); fm.needs = ['headline']; writeMd('media-cover', fm); },
      '"headline" 是必填槽'],
    ['默认形态带 needs',
      ({ readMd, writeMd }) => { const fm = readMd('text-center'); fm.needs = ['imageUrl']; writeMd('text-center', fm); },
      'shapes[0] ("text-center") 是默认形态，needs 必须为空'],
    // #1384 —— candidate 那两条。
    // 🔴 第二条是本票整条堵法的地基：候选不上真站是靠「落回 manifest 默认」实现的，默认自己是候选
    //    的话那个落点就是个候选 ⟹ 两条堵法（选择单、页面 JSON）从落回那一端一起漏掉。
    ['candidate 不是布尔',
      ({ readMd, writeMd }) => { const fm = readMd('media-cover'); fm.candidate = 'yes'; writeMd('media-cover', fm); },
      '.candidate 有的话必须是 true/false'],
    ['默认形态标了 candidate',
      ({ readMd, writeMd }) => { const fm = readMd('text-center'); fm.candidate = true; writeMd('text-center', fm); },
      'shapes[0] ("text-center") 是默认形态，不许标 candidate'],
    ['排版意图少一根轴',
      ({ readMd, writeMd }) => { const fm = readMd('media-cover'); delete fm.layout_intent.columns; writeMd('media-cover', fm); },
      '排版意图不完整'],
    ['排版意图里有一根不存在的轴',
      ({ readMd, writeMd }) => { const fm = readMd('media-cover'); fm.layout_intent.nope = 'x'; writeMd('media-cover', fm); },
      '不存在的轴 "nope"'],
  ];
  for (const [label, mutate, marker] of cases) {
    const msg = withHero(mutate);
    check(msg !== null && msg.includes(marker), `${label} ⟹ 被拒且报文含「${marker}」${msg === null ? '（没拒）' : (msg.includes(marker) ? '' : ` —— 实际: ${msg}`)}`);
  }
  // 🔴 #1384 —— candidate 那两条各自的**正向臂**。少了它，「`candidate` 这个键一律被拒」会把上面
  //    两格打绿，而那是本票的反面（候选必须装得进清单、进 shapes.css、过每一道检查）。
  const okNonDefault = withHero(({ readMd, writeMd }) => { const fm = readMd('media-cover'); fm.candidate = true; writeMd('media-cover', fm); });
  check(okNonDefault === null, `非默认形态标 candidate: true ⟹ 照常装得起来（${okNonDefault === null ? '是' : `抛了: ${okNonDefault}`}）`);
  const okFalse = withHero(({ readMd, writeMd }) => { const fm = readMd('text-center'); fm.candidate = false; writeMd('text-center', fm); });
  check(okFalse === null, `默认形态写 candidate: false ⟹ 照常装得起来（${okFalse === null ? '是' : `抛了: ${okFalse}`}）`);
  // 🔴 #1387 —— 新形态「丢进来就在」的那一半，在这一层的读数：新建一个子文件夹（两个文件），
  //    不改任何清单，`loadManifests` 就多认一个形态。
  let dropped = null;
  const dropIn = withHero(({ hero, readMd, writeMd, blocks }) => {
    const fm = readMd('media-cover');
    delete fm.needs;
    fm.order = 99;
    writeMd('fake-drop-in', fm);
    fs.writeFileSync(path.join(hero, 'fake-drop-in', 'shape.css'),
      '[data-block="hero"][data-shape="fake-drop-in"] { display: grid; }\n');
    dropped = blocks;
  });
  check(dropIn === null, `丢进一个新形态子文件夹（两个文件、不改任何清单）⟹ 装得起来（${dropIn === null ? '是' : `抛了: ${dropIn}`}）`);
}

console.log(`\n══ block-shapes.test.js: ${pass} 过 · ${fail} 失败 ══`);
process.exit(fail ? 1 : 0);
