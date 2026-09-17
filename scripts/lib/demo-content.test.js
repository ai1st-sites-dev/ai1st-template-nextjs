#!/usr/bin/env node
/**
 * demo-content.test.js — 图册演示内容包的三道守卫（#1383 做什么 4）。
 *
 * 跑法:  node scripts/lib/demo-content.test.js   （或 `npm run test:scripts`，它按文件名发现）
 * 退出码: 0 全过 · 1 有失败 · 2 跑不起来（**不许当成通过**）
 *
 * ══ 三道守卫各问什么 ═══════════════════════════════════════════════════════════════════════════
 *   (a) 全填版把 manifest 现算出来的**每一个**槽位都填上了值（两向：缺的点名，多出来的也点名）。
 *   (b) shape 自己写着要几项的 list 槽，包里给的条数不少于它。
 *   (c) 每个 list 槽至少 6 项，且条目文字长度的最大值 ≥ 最小值的 2 倍。
 *
 * 🔴 **判据面全部现算，不写死名单**：块从 `blockShapeCatalog()` 来，槽位从每份 manifest 来。
 *    #1372 当天删掉 4 个块，34/101/111 三个数一起变；写死名单的守卫那天会假红或假绿。
 *    `6` 和 `2 倍` 是本票定的两个常量，只有它们写死在下面（AC 点名它们是常量）。
 *
 * 🔴 **每道守卫都自带反向对照，跑在同一进程里。** 一道在真树上恒绿的守卫有三种可能 ——
 *    它在起作用 / 它瞎了 / 它过时了 —— 正臂对这三种给出同一个读数。所以下面每道都用
 *    **单变量**把包弄坏一处，要求它当场红并且点名那一处：
 *      反臂 A  删掉 `trusted-brands` 的 `headline`
 *      反臂 B  把 `trusted-brands/brands` 砍到 5 项
 *      反臂 C  拿**今天的** `sampleDataFor()` 输出整份喂它（`trusted-brands/brands` 实发 3 项
 *              且三项等长 —— 6 项和 2 倍两个条件各踩一个）
 *
 * 🔴 **图的 HEAD 只警告、不打红**（本票 AC 最后一条）：CI 上没有外网是常态，拿一条跟本仓代码
 *    无关的事去挡 ship 就是让人学会绕过守卫。它买的是「CDN 挂了有人吭一声」，不是一道闸。
 */

'use strict';

const path = require('path');
const https = require('https');

const NEXT = path.resolve(__dirname, '..', '..');
let pass = 0; let fail = 0; let warn = 0;
const ok = (m) => { pass += 1; console.log(`  ✅ ${m}`); };
const bad = (m) => { fail += 1; console.log(`  ❌ ${m}`); };
const wrn = (m) => { warn += 1; console.log(`  ⚠️  ${m}`); };
const die = (m) => { console.error(`🔴 跑不起来: ${m}`); process.exit(2); };
const check = (cond, m) => (cond ? ok(m) : bad(m));

let cat; let demo;
try {
  cat = require(path.join(NEXT, 'scripts', 'lib', 'block-catalog.js'));
  demo = require(path.join(NEXT, 'scripts', 'lib', 'demo-content'));
} catch (e) { die(`require 失败: ${e.message}`); }

const { blockShapeCatalog, sampleDataFor, PLACEHOLDER_IMAGE } = cat;
const { DEMO_CONTENT, IMAGES, isListSlot, declaredMinItems, itemTextLength } = demo;

let catalogue;
try { catalogue = blockShapeCatalog(); } catch (e) { die(`blockShapeCatalog(): ${e.message}`); }
const { blocks, pairs, manifests } = catalogue;

// 本票定的两个常量（AC 点名它们写死在守卫里）。
const MIN_ITEMS = 6;
const LENGTH_SPREAD = 2;

/** 内容取法：默认读包本身；反向臂传一个包了一层的取法，只改一处。 */
const realContentOf = (type) => DEMO_CONTENT[type];

// ── 三道守卫：都吃 `contentOf`，所以反向臂能跑同一份代码 ──────────────────────────────────────

/** (a) 全填版每个槽位都有值；顺带反过来查「包里有而 manifest 没有」的键。 */
function guardA(contentOf) {
  const problems = [];
  for (const type of blocks) {
    const c = contentOf(type);
    if (!c) { problems.push(`${type}: 包里根本没有这个块`); continue; }
    const slots = (manifests.get(type) || {}).slots || {};
    for (const name of Object.keys(slots)) {
      if (!(name in c)) problems.push(`${type}/${name}: 槽位没有值`);
    }
    for (const key of Object.keys(c)) {
      if (!(key in slots)) problems.push(`${type}/${key}: 包里有这个键，而 manifest 里没有这个槽位`);
    }
  }
  return problems;
}

/** (b) shape 自己声明了条数的 list 槽，实发条数 ≥ 声明。 */
function guardB(contentOf) {
  const problems = [];
  for (const type of blocks) {
    const slots = (manifests.get(type) || {}).slots || {};
    const c = contentOf(type) || {};
    for (const [name, spec] of Object.entries(slots)) {
      const want = declaredMinItems(spec);
      if (want === null) continue;
      const v = c[name];
      const got = Array.isArray(v) ? v.length : 0;
      if (got < want) problems.push(`${type}/${name}: 声明 ${want}、实发 ${got}`);
    }
  }
  return problems;
}

/**
 * (c) 每个 list 槽 ≥ MIN_ITEMS 项，且最长条目的文字 ≥ 最短的 LENGTH_SPREAD 倍。
 *
 * 🔴 第二个回参 `textless` 是**覆盖边界**，不是装饰：条目里一个字都没有（纯地址列表）的槽，
 *    长短那一半在它上面退化成 `0 >= 0` 恒真。守卫不许装作查过，所以把这种槽点名报出来。
 */
function guardC(contentOf) {
  const problems = [];
  const textless = [];
  for (const type of blocks) {
    const slots = (manifests.get(type) || {}).slots || {};
    const c = contentOf(type) || {};
    for (const [name, spec] of Object.entries(slots)) {
      if (!isListSlot(spec)) continue;
      const v = c[name];
      if (!Array.isArray(v)) { problems.push(`${type}/${name}: 不是数组`); continue; }
      if (v.length < MIN_ITEMS) problems.push(`${type}/${name}: 只有 ${v.length} 项，要 ≥ ${MIN_ITEMS}`);
      const lens = v.map(itemTextLength);
      const max = Math.max(...lens);
      const min = Math.min(...lens);
      if (max === 0) { textless.push(`${type}/${name}`); continue; }
      if (!(max >= min * LENGTH_SPREAD)) {
        problems.push(`${type}/${name}: 条目长短一个样（最长 ${max} / 最短 ${min}，要最长 ≥ 最短的 ${LENGTH_SPREAD} 倍）`);
      }
    }
  }
  problems.textless = textless;
  return problems;
}

/** 反向臂：把包复制一份，只改一处。 */
function mutated(mutate) {
  const copy = JSON.parse(JSON.stringify(DEMO_CONTENT));
  mutate(copy);
  return (type) => copy[type];
}

// ══ ① 判据面：现算出来的那些数 ═════════════════════════════════════════════════════════════
console.log('① 判据面（现算，不写死）');
const slotCount = blocks.reduce((n, t) => n + Object.keys((manifests.get(t) || {}).slots || {}).length, 0);
const listSlots = [];
const declaredSlots = [];
for (const type of blocks) {
  for (const [name, spec] of Object.entries((manifests.get(type) || {}).slots || {})) {
    if (isListSlot(spec)) listSlots.push(`${type}/${name}`);
    if (declaredMinItems(spec) !== null) declaredSlots.push(`${type}/${name}`);
  }
}
console.log(`  块 ${blocks.length} · (块,形态) 对 ${pairs.length} · 槽位 ${slotCount}`
  + ` · list 槽 ${listSlots.length} · 带条数声明的 list 槽 ${declaredSlots.length}`);
console.log(`  (b) 的射程: ${declaredSlots.join(' · ')}`);
check(blocks.length > 0 && slotCount > 0, '判据面不是空的（空的判据面会让下面每一道恒绿）');
check(declaredSlots.length > 0, `(b) 的射程不是空集（${declaredSlots.length} 处）`);
check(listSlots.length > 0, `(c) 的射程不是空集（${listSlots.length} 处）`);

// ══ ② 正臂：真包必须全绿 ═══════════════════════════════════════════════════════════════════
console.log('\n② 正臂：今天这份包');
const a0 = guardA(realContentOf);
const b0 = guardB(realContentOf);
const c0 = guardC(realContentOf);
check(a0.length === 0, `(a) 每个槽位都有值${a0.length ? ` —— ${a0.join(' | ')}` : ''}`);
check(b0.length === 0, `(b) 条数不少于 shape 声明的${b0.length ? ` —— ${b0.join(' | ')}` : ''}`);
check(c0.length === 0, `(c) 每个 list 槽 ≥ ${MIN_ITEMS} 项且长短不一${c0.length ? ` —— ${c0.join(' | ')}` : ''}`);
// 覆盖边界，印在结论旁边：这些槽的条目一个字都没有（纯地址），长短那一半在它们上面说不出话。
console.log(`  📌 (c) 长短那一半量不到的槽（条目只有地址）：${c0.textless.length ? c0.textless.join(' · ') : '（没有）'}`);

// 顺带两条：演示内容不许回到占位串/占位图（AC1 在页面上量的就是这两样）。
const placeholderWords = ['Headline', 'Subheadline', 'Label'];
const strayText = [];
const strayImage = [];
const walk = (v, where) => {
  if (typeof v === 'string') {
    if (v === PLACEHOLDER_IMAGE) strayImage.push(where);
    if (placeholderWords.some((w) => new RegExp(`^${w}( \\d+)?$`).test(v))) strayText.push(`${where}=${v}`);
    return;
  }
  if (Array.isArray(v)) { v.forEach((x, i) => walk(x, `${where}[${i}]`)); return; }
  if (v && typeof v === 'object') { for (const [k, x] of Object.entries(v)) walk(x, `${where}.${k}`); }
};
for (const type of blocks) walk(realContentOf(type), type);
check(strayText.length === 0, `没有 ${placeholderWords.join(' / ')} 这类占位串${strayText.length ? ` —— ${strayText.join(' | ')}` : ''}`);
check(strayImage.length === 0, `没有一张图是 ${PLACEHOLDER_IMAGE}${strayImage.length ? ` —— ${strayImage.join(' | ')}` : ''}`);

// 🔴 包里不许留**没人用**的图。#1383 自己踩过：`logo-carousel.logos` 那六条一开始放的是 CDN 地址
//    （那个槽其实装文字），改对之后 `brand-1..6` 六个键就成了孤儿 —— 而上面每一道守卫都照样绿，
//    因为它们问的是「槽位有没有值」，没有一道反过来问「图有没有人要」。失败方向是静默的：
//    ④ 那一段会去 HEAD 六张谁也不看的图，而读这份包的人会以为品牌墙用的是图。
const usedUrls = new Set();
const collectUrls = (v) => {
  if (typeof v === 'string') { usedUrls.add(v); return; }
  if (Array.isArray(v)) { v.forEach(collectUrls); return; }
  if (v && typeof v === 'object') Object.values(v).forEach(collectUrls);
};
for (const type of blocks) collectUrls(realContentOf(type));
const orphanImages = Object.entries(IMAGES)
  .filter(([, e]) => !usedUrls.has(e.url) && !usedUrls.has(e.fallback))
  .map(([k]) => k);
check(orphanImages.length === 0,
  `IMAGES 里每张图都有人用${orphanImages.length ? ` —— 没人用的：${orphanImages.join(' / ')}` : `（${Object.keys(IMAGES).length} 张）`}`);

// ══ ③ 反向臂：每道守卫都要真的红得出来，而且点名那一处 ══════════════════════════════════════
console.log('\n③ 反向臂（单变量，每道一格）');

const armA = guardA(mutated((c) => { delete c['trusted-brands'].headline; }));
check(armA.some((p) => p.startsWith('trusted-brands/headline')),
  `(a) 删掉 trusted-brands 的 headline ⟹ 红并点名：${armA.join(' | ') || '（它没红）'}`);

const armB = guardB(mutated((c) => { c['trusted-brands'].brands = c['trusted-brands'].brands.slice(0, 5); }));
check(armB.some((p) => p === 'trusted-brands/brands: 声明 6、实发 5'),
  `(b) brands 砍到 5 项 ⟹ 红并点名「声明 6、实发 5」：${armB.join(' | ') || '（它没红）'}`);

// 反臂 C 用的是**今天真跑出来的** sampleDataFor() 输出，不是我手打的一个像它的东西。
const sampleContentOf = (type) => {
  const m = manifests.get(type);
  return m ? sampleDataFor(m) : undefined;
};
const sampleBrands = sampleContentOf('trusted-brands').brands;
console.log(`  sampleDataFor(trusted-brands).brands = ${JSON.stringify(sampleBrands)}`);
const armC = guardC(sampleContentOf);
const armCBrands = armC.filter((p) => p.startsWith('trusted-brands/brands'));
check(armCBrands.length === 2,
  `(c) 喂今天的 sampleDataFor() ⟹ trusted-brands/brands 两个条件各踩一个：${armCBrands.join(' | ') || '（它没红）'}`);
check(armC.length > 0, `(c) 反向臂整体红 ${armC.length} 处（正臂 0 处）`);

// 🔴 反过来也要有一格：反向臂只改了一处，**别的守卫不许跟着红** —— 三道各自守着自己那一维。
const armAOther = guardB(mutated((c) => { delete c['trusted-brands'].headline; }));
check(armAOther.length === 0, `(a) 的反向臂不会让 (b) 跟着红（${armAOther.length} 处）`);

// ══ ④ 图：HEAD 一遍，读不到只警告 ═══════════════════════════════════════════════════════════
console.log('\n④ 图（HEAD 一遍，读不到只警告、不打红）');
const urls = [...new Set(Object.values(IMAGES).map((e) => e.url))].filter((u) => /^https:/.test(u));
const missingFallback = Object.entries(IMAGES).filter(([, e]) => !e.fallback).map(([k]) => k);
check(missingFallback.length === 0, `每张图都写了 fallback${missingFallback.length ? ` —— 缺 ${missingFallback.join(' / ')}` : ''}`);

function head(url) {
  return new Promise((resolve) => {
    const req = https.request(url, { method: 'HEAD', timeout: 8000 }, (res) => {
      res.resume();
      resolve(res.statusCode);
    });
    req.on('timeout', () => { req.destroy(); resolve('timeout'); });
    req.on('error', (e) => resolve(e.code || 'error'));
    req.end();
  });
}

(async () => {
  if (process.env.DEMO_CONTENT_SKIP_NET === '1') {
    wrn(`DEMO_CONTENT_SKIP_NET=1 ⟹ ${urls.length} 张图没有量（这是一句「没量到」，不是「都好」）`);
  } else {
    const codes = await Promise.all(urls.map(head));
    const notOk = urls.map((u, i) => [u, codes[i]]).filter(([, c]) => c !== 200);
    if (notOk.length === 0) ok(`${urls.length} 张图全部 200`);
    else wrn(`${notOk.length}/${urls.length} 张图这一刻读不到（CDN 或外网）—— ${notOk.map(([u, c]) => `${c} ${u}`).join(' | ')}`);
  }

  console.log(`\n${fail === 0 ? '✅' : '❌'} demo-content: ${pass} 过 / ${fail} 不过 / ${warn} 警告`);
  process.exit(fail === 0 ? 0 : 1);
})();
