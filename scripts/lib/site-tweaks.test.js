// site-tweaks.test.js — 把 `site-tweaks.js` 那三张档位表钉在引擎的边界上（#1120）。
//
// 为什么需要它：那三张表是**字面量**（理由见被测文件：`min + step*k` 在二进制里不精确，算到边界那一档
// 可能落在区间外一点点，而 `validateTweaks` 会判它不合法 ⟹ 那个站静默地不带微扰）。字面量没有那个
// 失败方向，代价是「改 `TWEAK_BOUNDS` 时要连表一起改」。这个文件就是那个代价的收款处。

'use strict';

const { TWEAK_STEPS, AXES, tweaksForSite } = require('./site-tweaks');
const { TWEAK_BOUNDS, TWEAK_KEYS, NEUTRAL, validateTweaks, isNeutral, buildCustomCss } = require('../tweaks');

/** `buildCustomCss` 要的形状：`[name, value]` 的数组（`baseVarsFrom` 的产出）。三轴各给一个基准，
 *  否则某一轴改了也写不出字节 —— 归队规则按名字形状：`--color-*`→hueShift · `--radius-*`→radiusScale
 *  · `--section-*`→densityScale（`tweaks.js` §tweakFor）。 */
const BASE = [
  ['--color-primary-500', '#2563eb'],
  ['--radius-block', '0.25rem'],
  ['--section-block-pad', '4rem'],
];

let failed = 0;
const ok = (m) => console.log(`  ✅ ${m}`);
const bad = (m) => { console.log(`  ❌ ${m}`); failed += 1; };

// ── ① 三张表覆盖的轴 == 引擎认的那三个键 ─────────────────────────────────────────────────────────
console.log('① 轴的清单跟引擎对得上（多一个会被 validateTweaks 指名拒收，少一个 = 那一维恒中性）');
{
  const mine = [...AXES].sort();
  const engine = [...TWEAK_KEYS].sort();
  if (JSON.stringify(mine) !== JSON.stringify(engine)) {
    bad(`轴对不上：本模块 ${JSON.stringify(mine)} · 引擎 TWEAK_KEYS ${JSON.stringify(engine)}`);
  } else if (Object.keys(TWEAK_STEPS).length !== AXES.length) {
    bad(`TWEAK_STEPS 有 ${Object.keys(TWEAK_STEPS).length} 张表，而 AXES 有 ${AXES.length} 个轴`);
  } else {
    ok(`三个轴逐字对上：${engine.join(' / ')}`);
  }
}

// ── ② 每一档都落在 TWEAK_BOUNDS 里（这是本文件存在的头号理由）────────────────────────────────────
console.log('② 逐档钉在引擎的区间上 —— 收窄 TWEAK_BOUNDS 而忘了改表，这一节当场红');
{
  const outside = [];
  for (const key of AXES) {
    const b = TWEAK_BOUNDS[key];
    for (const v of TWEAK_STEPS[key]) {
      if (!(v >= b.min && v <= b.max)) outside.push(`${key}=${v} ∉ [${b.min}, ${b.max}]`);
    }
  }
  if (outside.length) bad(`有 ${outside.length} 档落在区间外：${outside.join(' · ')}`);
  else {
    const n = AXES.map((k) => `${k} ${TWEAK_STEPS[k].length} 档`).join(' · ');
    ok(`每一档都在区间内（${n}）`);
  }
  // 🔴 反向对照：把一档故意推到区间外，这一节必须能看见它。不然上面那个绿可能是「表是空的」。
  const probe = { ...TWEAK_BOUNDS.hueShift, min: TWEAK_BOUNDS.hueShift.min };
  const outOfRange = probe.min - 1;
  if (outOfRange >= TWEAK_BOUNDS.hueShift.min) bad('反向对照写坏了：造出来的值并没有越界');
  else if (validateTweaks({ ...NEUTRAL, hueShift: outOfRange }).length === 0) {
    bad(`反向对照：${outOfRange} 越界了，而 validateTweaks 说它合法 ⟹ 上面那把尺不成立`);
  } else ok(`反向对照：hueShift=${outOfRange}（越界一档）被 validateTweaks 拒收 ⟹ 这把尺认得出越界`);
}

// ── ③ 一档都不是中性 —— 否则那个站是真的一点微扰都没有，而且没人会报错 ─────────────────────────
console.log('③ 每一轴都挖掉了中性点（挖不掉 ⟹ 有 siteId 会派出空 custom.css，与老站逐字节相同）');
{
  const hits = [];
  for (const key of AXES) {
    for (const v of TWEAK_STEPS[key]) if (v === NEUTRAL[key]) hits.push(`${key}=${v}`);
  }
  if (hits.length) bad(`有 ${hits.length} 档是中性点：${hits.join(' · ')}`);
  else ok(`三张表里一档都不是中性（中性点是 ${JSON.stringify(NEUTRAL)}）`);
  // 阳性对照：中性点真的会产出空串（这是上面那条要求的**后果**，不是它的重述）
  // 🔴 `baseVars` 是 `[name, value]` 的数组（`baseVarsFrom` 的产出形状），不是对象 —— 传对象时
  //    `for (const [n,v] of baseVars)` 当场 TypeError。第一版我传了对象，而这一格**照样绿**：
  //    中性点在迭代之前就 return 了 ⟹ 那个绿跟我传对没传对无关。用 BASE 这个真形状。
  const emptyCss = buildCustomCss(BASE, NEUTRAL, undefined);
  if (emptyCss) bad(`阳性对照失败：中性点竟然产出了 ${emptyCss.length} 字节 ⟹ 挖中性点这条要求没有依据了`);
  else ok('阳性对照：中性点 ⟹ buildCustomCss 回空串（sync-config 会删掉 site/custom.css）');
}

// ── ④ 确定性 + 一定产出字节 ────────────────────────────────────────────────────────────────────
console.log('④ 同一个 siteId 算多少次都一样，而且派出来的那组一定产得出字节');
{
  const ids = ['a1b2c3d4', 'deadbeef', '00000000', 'ffffffff', '5b559413', '023fe4c2'];
  let stable = true;
  for (const id of ids) {
    const a = JSON.stringify(tweaksForSite(id).tweaks);
    const b = JSON.stringify(tweaksForSite(id).tweaks);
    if (a !== b) { bad(`siteId ${id} 两次算出不同：${a} vs ${b}`); stable = false; }
  }
  if (stable) ok(`${ids.length} 个 siteId 各算两次，逐个相同`);

  const empty = ids.filter((id) => !buildCustomCss(BASE, tweaksForSite(id).tweaks, undefined));
  if (empty.length) bad(`有 ${empty.length} 个 siteId 派出来的微扰产不出字节：${empty.join(' · ')}`);
  else ok(`${ids.length} 个 siteId 派出来的都产得出 custom.css 字节`);

  const rejected = ids.filter((id) => tweaksForSite(id).tweaks === null);
  if (rejected.length) bad(`有 ${rejected.length} 个 siteId 被自己的兜底拒掉了：${rejected.join(' · ')}`);
  else ok(`${ids.length} 个 siteId 一个都没走兜底（validateTweaks 全过、都不是中性）`);
}

// ── ⑤ 铺开程度 + 与「骨」那条索引不是同一个切片 ──────────────────────────────────────────────────
console.log('⑤ 铺得开吗，以及它跟 recipeIndex % 308 是不是同一个切片');
{
  const { rotationIndexFromSiteId } = require('../themes');
  const N = 4096;
  const ids = [];
  for (let i = 0; i < N; i++) ids.push(i.toString(16).padStart(8, '0'));
  const triples = new Map();
  for (const id of ids) {
    const k = JSON.stringify(tweaksForSite(id).tweaks);
    triples.set(k, (triples.get(k) || 0) + 1);
  }
  const combos = TWEAK_STEPS.hueShift.length * TWEAK_STEPS.radiusScale.length
    * TWEAK_STEPS.densityScale.length;
  if (triples.size < combos * 0.9) {
    bad(`${N} 个 siteId 只落在 ${triples.size} 种组合上（一共 ${combos} 种）—— 铺不开`);
  } else ok(`${N} 个 siteId 落在 ${triples.size} / ${combos} 种组合上`);

  // 🔴 判据：**同一个 recipe 的那些站，微扰仍然分得开**。共用切片时这个数会掉到 1。
  const byRecipe = new Map();
  for (const id of ids) {
    const r = rotationIndexFromSiteId(id) % 308;
    if (!byRecipe.has(r)) byRecipe.set(r, new Set());
    byRecipe.get(r).add(JSON.stringify(tweaksForSite(id).tweaks));
  }
  const groups = [...byRecipe.values()].filter((s) => s.size > 1);
  const worst = Math.min(...[...byRecipe.values()].map((s) => s.size));
  if (byRecipe.size < 2) bad(`recipe 分组只有 ${byRecipe.size} 组，这一格问不出问题`);
  else if (groups.length < byRecipe.size * 0.9) {
    bad(`${byRecipe.size} 个 recipe 分组里只有 ${groups.length} 组的微扰不止一种 ⟹ 两者像是同一个切片`);
  } else {
    ok(`${byRecipe.size} 个 recipe 分组，其中 ${groups.length} 组内部的微扰不止一种（最小一组 ${worst} 种）`);
  }
  // 🔴 这一格是个**失败的对照，如实印出来**：我本来想证「加盐让微扰与骨解耦」，于是拿裸哈希做对照
  //    —— 两边读到的是**同一个数**，所以它证不出盐买到了任何东西（一组对照全部读到同一个值 = 这把尺
  //    没有分辨力，不是「结论成立」）。原因：recipe 只用 `h % 308`，而三轴用的是 `h % 10` /
  //    `(h/10) % 9` / `(h/90) % 5`，本来就不是同一个切片。盐的理由因此降级成结构性保险，写在
  //    被测文件的文件头里。**这一格保留，是为了让下一个人不必再做一次同一个失败实验。**
  const bare = new Map();
  for (const id of ids) {
    const r = rotationIndexFromSiteId(id) % 308;
    let n = rotationIndexFromSiteId(id);
    const t = {};
    for (const key of AXES) { const s = TWEAK_STEPS[key]; t[key] = s[n % s.length]; n = Math.floor(n / s.length); }
    if (!bare.has(r)) bare.set(r, new Set());
    bare.get(r).add(JSON.stringify(t));
  }
  const bareGroups = [...bare.values()].filter((s) => s.size > 1).length;
  if (bareGroups === groups.length) {
    ok(`📌 失败的对照，如实记下：裸哈希 ${bare.size} 组里 ${bareGroups} 组内部不止一种，`
      + `加盐版是 ${groups.length} 组 —— **同一个读数** ⟹ 这把尺分不出加盐与不加盐，`
      + '盐的理由是结构性保险（见被测文件文件头），不是一条量到过的改进');
  } else {
    bad(`这个对照今天能分辨了（裸 ${bareGroups} vs 加盐 ${groups.length}）—— 被测文件文件头里`
      + '写的「量不出差别」已经过期，去改那段话');
  }
}

console.log(failed ? `\n🔴 site-tweaks.test.js — ${failed} 处不合格` : '\n✅ site-tweaks.test.js — 全过');
process.exit(failed ? 1 : 0);
