#!/usr/bin/env node
/**
 * block-shapes.test.js — 形态清单归区块库（#1331，设计文档 D1 / D4 / D11 ⑥）。
 *
 * 跑法:  node scripts/lib/block-shapes.test.js   （或 `npm run test:scripts`，它按文件名发现）
 * 退出码: 0 全过 · 1 有失败 · 2 跑不起来（**不许当成通过**）
 *
 * ══ 守什么 ═══════════════════════════════════════════════════════════════
 * ① `public/shapes.css` 里出现的 (块, 形态) 集合 == 31 份 `blocks/*.json` 的 `shapes` 名字集合，两向差集为 0。
 *    形态以前只住在 CSS 里（manifest 里 0 份知道），提示词 / 验证器 / 检查器三个消费者一个都读不到；
 *    现在两边各有一份，就得有人守「它们是同一份」。任一 manifest 少写一个形态，这里当场红并点名。
 * ② `validateSite` 第 ⑥ 条：页面 JSON 点名的形态缺它 `needs` 的槽位 ⟹ 报一条；填上 ⟹ 不报。两臂都量。
 * ③ `checkManifestShape` 对 `shapes` 的白名单校验：五种写错各自被拒（拼错键静默失效是 #1013 那次的失败方向）。
 *    🔴 负向臂跑在一个临时目录上，**先拿未改动的副本证明这套夹具本身立得起来**，否则五次「被拒」可能全是
 *    夹具坏了（一组对照全读到同一个值 = 尺子坏了）。
 * ④ 三个谓词（slotFilled / shapeNeedsGap / filledOptionalSlots）的读数表 + AC2 钉的两个事实
 *    （hero 默认 form-side；media-cover 需要 imageUrl）。
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
  loadManifests, validateSite, shapePairsFromCss, slotFilled, defaultShapeOf, shapeNeedsGap,
  filledOptionalSlots, diffShapesAgainstCss, BLOCKS_DIR, SHAPES_CSS,
} = bm;
for (const [k, v] of Object.entries({ loadManifests, validateSite, shapePairsFromCss, slotFilled, defaultShapeOf, shapeNeedsGap, filledOptionalSlots, diffShapesAgainstCss })) {
  if (typeof v !== 'function') die(`block-manifest.js 没导出 ${k}`);
}

let manifests;
try { manifests = loadManifests(); } catch (e) { die(`loadManifests 抛了: ${e.message}`); }
if (manifests.size === 0) die('loadManifests 读到 0 份 manifest');

// ── ① 两向差集 ─────────────────────────────────────────────────────────────
console.log('── ① manifest 的 shapes 清单 vs public/shapes.css 的 (块, 形态) 集合');
{
  const withShapes = [...manifests.values()].filter((m) => Array.isArray(m.shapes) && m.shapes.length > 0).length;
  check(withShapes === manifests.size, `每份 manifest 都有非空 shapes（${withShapes}/${manifests.size}）`);
  const css = shapePairsFromCss();
  let pairs = 0; for (const s of css.values()) pairs += s.size;
  check(pairs > 0 && css.size === manifests.size, `shapes.css 里 ${pairs} 对，覆盖 ${css.size} 个块（== manifest 数 ${manifests.size}）`);
  const d = diffShapesAgainstCss(manifests, css);
  check(d.onlyInCss.length === 0, `CSS 有、manifest 没有：${d.onlyInCss.length} 个${d.onlyInCss.length ? ` —— ${d.onlyInCss.join(', ')}` : ''}`);
  check(d.onlyInManifests.length === 0, `manifest 有、CSS 没有：${d.onlyInManifests.length} 个${d.onlyInManifests.length ? ` —— ${d.onlyInManifests.join(', ')}` : ''}`);

  // 反向臂：这道守卫真的会红、而且点得出名字。在副本上做，盘上的文件一个字节不动。
  const copy = new Map([...manifests].map(([t, m]) => [t, JSON.parse(JSON.stringify(m))]));
  copy.get('hero').shapes = copy.get('hero').shapes.filter((s) => s.name !== 'media-cover');
  copy.get('card-group').shapes.push({ name: 'bogus-shape', needs: [] });
  const d2 = diffShapesAgainstCss(copy, css);
  check(d2.onlyInCss.length === 1 && d2.onlyInCss[0] === 'hero/media-cover',
    `反向臂：从 hero 删掉 media-cover ⟹ onlyInCss 点名它（读到 ${JSON.stringify(d2.onlyInCss)}）`);
  check(d2.onlyInManifests.length === 1 && d2.onlyInManifests[0] === 'card-group/bogus-shape',
    `反向臂：给 card-group 加一个 CSS 里没有的形态 ⟹ onlyInManifests 点名它（读到 ${JSON.stringify(d2.onlyInManifests)}）`);
}

// ── ④ 谓词读数表 + AC2 的两个事实 ───────────────────────────────────────────
console.log('── ④ 三个谓词');
{
  const table = [[undefined, false], [null, false], ['', false], [[], false], ['x', true], [0, true], [false, true], [[1], true], [{}, true]];
  const wrong = table.filter(([v, want]) => slotFilled(v) !== want).map(([v]) => JSON.stringify(v));
  check(wrong.length === 0, `slotFilled 读数表 ${table.length} 格一致${wrong.length ? `（错在 ${wrong.join(' ')}）` : ''}`);
  const hero = manifests.get('hero');
  check(defaultShapeOf(hero) === 'form-side', `hero 的默认形态是 form-side（AC2 的前提，读到 ${defaultShapeOf(hero)}）`);
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
  ok('31 份的默认形态 needs 全空（缺槽位落回的落点是实的）');
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
  check(empty.length === 1 && empty[0].includes('"imageUrl"') && empty[0].includes('form-side'),
    `imageUrl 为空 ⟹ 恰好一条，点名 imageUrl 与落点 form-side：${empty[0] || '(没有)'}`);
  check(filled.length === 0, `imageUrl 填上 ⟹ 0 条（读到 ${filled.length}）`);
  check(empty.length !== filled.length, '两臂读数不同（尺子没坏）');
  const unknown = sixth([{ slug: 'p', blocks: [{ ...heroPage({}).blocks[0], shape: 'not-a-shape' }] }]);
  check(unknown.length === 1 && unknown[0].includes('不在'), `shape 不在清单里 ⟹ 一条「不在 … 清单里」：${unknown[0] || '(没有)'}`);
}

// ── ③ checkManifestShape 对 shapes 的五种拒绝 ───────────────────────────────
console.log('── ③ checkManifestShape 白名单');
{
  const rig = () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'block-shapes-'));
    fs.mkdirSync(path.join(root, 'blocks'));
    fs.mkdirSync(path.join(root, 'public'));
    for (const f of fs.readdirSync(BLOCKS_DIR)) fs.copyFileSync(path.join(BLOCKS_DIR, f), path.join(root, 'blocks', f));
    fs.copyFileSync(SHAPES_CSS, path.join(root, 'public', 'shapes.css'));
    return root;
  };
  const withHero = (mutate) => {
    const root = rig();
    const p = path.join(root, 'blocks', 'hero.json');
    const m = JSON.parse(fs.readFileSync(p, 'utf-8'));
    mutate(m);
    fs.writeFileSync(p, JSON.stringify(m, null, 2));
    try { loadManifests(path.join(root, 'blocks')); return null; } catch (e) { return e.message; } finally { fs.rmSync(root, { recursive: true, force: true }); }
  };
  // 正向臂先行：未改动的副本在临时目录里装得起来，否则下面五个「被拒」不说明任何事。
  const clean = withHero(() => {});
  check(clean === null, `未改动的副本在临时目录装得起来（${clean === null ? '是' : `抛了: ${clean}`}）`);
  const cases = [
    ['没有 shapes', (m) => { delete m.shapes; }, 'shapes 是 undefined'],
    ['needs 指向不存在的槽位', (m) => { m.shapes[1].needs = ['nope']; }, '"nope" 不是这个块的槽位'],
    ['needs 指向必填槽', (m) => { m.shapes[1].needs = ['headline']; }, '"headline" 是必填槽'],
    ['默认形态带 needs', (m) => { m.shapes[0].needs = ['imageUrl']; }, 'shapes[0] ("form-side") 是默认形态，needs 必须为空'],
    ['形态名在 CSS 里没有规则', (m) => { m.shapes[1].name = 'no-such-shape'; }, '[data-block="hero"][data-shape="no-such-shape"]'],
    ['同一个形态写两次', (m) => { m.shapes.push({ name: 'form-side', needs: [] }); }, '"form-side" 写了两次'],
  ];
  for (const [label, mutate, marker] of cases) {
    const msg = withHero(mutate);
    check(msg !== null && msg.includes(marker), `${label} ⟹ 被拒且报文含「${marker}」${msg === null ? '（没拒）' : (msg.includes(marker) ? '' : ` —— 实际: ${msg}`)}`);
  }
}

console.log(`\n══ block-shapes.test.js: ${pass} 过 · ${fail} 失败 ══`);
process.exit(fail ? 1 : 0);
