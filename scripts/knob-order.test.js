#!/usr/bin/env node
/**
 * knob-order.test.js — #1481（T6a）：全部块的旋钮取值表按同一套规矩排序，以后不许漂回去。
 *
 * 跑法:  node scripts/knob-order.test.js   （或 `npm run test:scripts`，它按文件名发现）
 * 退出码: 0 全过 · 1 有失败 · 2 跑不起来（**不许当成通过**）
 *
 * 取值表的两种住处（17 个块的 manifest 全读，#1481 正文的口径）：
 *   · `slots.<槽>.knobs[].{name, values}`   —— 旋钮（今天都在 `slots.options` 里；🔴 顶层没有 `knobs` 键）
 *   · `slots.<槽>.choices.<子字段>`          —— 词表（`introEyebrow.style` / hero、cta 的 `eyebrow.style`）
 *
 * 守的四条规矩（规矩 5 是仲裁，它判出来的结果钉在 PINNED 里）：
 *   1  含 `none` 的表，`none` 是第 0 项
 *   2  位置类取值（left right top bottom background）在表里的先后 = 左 右 上 下 背景（别的取值夹在中间不管）
 *   3  数量类（整数取值至少两个，其余只能是 auto / none）：整数从小到大，auto / none 排在整数前面
 *   4  同名旋钮跨块，**共有取值**的相对先后一致（不要求取值集合相同）
 *   5  规矩 1/2/3 都判不了的一对 (a,b)：同名旋钮里「a 在 b 前」的块数多的赢；平手看该取值在全部表里出现的次数；
 *      某块独有的取值排在共有取值之后。§arbitrate 就是这条，失败信息里据它给出建议顺序。
 *
 * 🔴 顺序只管展示：没写值时取哪一个看 `default` / `choiceDefaults`（block-knobs.js §knobDefault / §choiceDefault），
 *    排序挪了第一项的表必须写它 —— 最后一段核「写了 default 的表，default 在取值里」，而「挪了之后默认没变」的那一半
 *    在各 `*-render.test.js` 里逐块钉。
 *
 * 🔴 每条规矩都带反向对照（同一进程、单变量：把一张表改坏，判据必须当场红）。规矩 3 今天读 0 —— 正因为是 0 才要守。
 */

'use strict';

const fs = require('fs');
const path = require('path');

const BLOCKS = path.resolve(__dirname, '..', 'blocks');

let pass = 0;
let fail = 0;
const ok = (m) => { pass += 1; console.log(`  ✅ ${m}`); };
const bad = (m) => { fail += 1; console.log(`  ❌ ${m}`); };
const die = (m) => { console.error(`🔴 跑不起来: ${m}`); process.exit(2); };
const check = (cond, m, detail) => (cond ? ok(m) : bad(detail ? `${m} —— ${detail}` : m));

// ── 读表 ─────────────────────────────────────────────────────────────────────────────────────────────
function readTables() {
  if (!fs.existsSync(BLOCKS)) die(`没有 ${BLOCKS}`);
  const out = [];
  for (const b of fs.readdirSync(BLOCKS).sort()) {
    const f = path.join(BLOCKS, b, 'manifest.json');
    if (!fs.existsSync(f)) continue;
    let m;
    try { m = JSON.parse(fs.readFileSync(f, 'utf8')); } catch (e) { die(`${b}/manifest.json 解不动：${e.message}`); }
    for (const [slot, spec] of Object.entries((m && m.slots) || {})) {
      if (!spec || typeof spec !== 'object') continue;
      for (const k of Array.isArray(spec.knobs) ? spec.knobs : []) {
        if (k && typeof k.name === 'string' && Array.isArray(k.values)) out.push({ where: `${b}.${slot}.knobs.${k.name}`, block: b, name: k.name, values: k.values.slice(), default: k.default });
      }
      for (const [sub, vals] of Object.entries(spec.choices && typeof spec.choices === 'object' ? spec.choices : {})) {
        if (Array.isArray(vals)) out.push({ where: `${b}.${slot}.choices.${sub}`, block: b, name: sub, values: vals.slice(), default: (spec.choiceDefaults || {})[sub] });
      }
    }
  }
  return out;
}

// ── 规矩 ─────────────────────────────────────────────────────────────────────────────────────────────
const POS = ['left', 'right', 'top', 'bottom', 'background'];
const isInt = (v) => /^\d+$/.test(v);
const isQuantity = (vals) => vals.filter(isInt).length >= 2 && vals.every((v) => isInt(v) || v === 'auto' || v === 'none');
const sameOrder = (a, b) => JSON.stringify(a) === JSON.stringify(b);

function rule1(tables) {
  return tables.filter((t) => t.values.includes('none') && t.values[0] !== 'none')
    .map((t) => `${t.where} = [${t.values.join(', ')}]：none 应在第 0 项`);
}

function rule2(tables) {
  const out = [];
  for (const t of tables) {
    const seen = t.values.filter((v) => POS.includes(v));
    const want = seen.slice().sort((a, b) => POS.indexOf(a) - POS.indexOf(b));
    if (!sameOrder(seen, want)) out.push(`${t.where} = [${t.values.join(', ')}]：位置类应按 ${want.join(' → ')}`);
  }
  return out;
}

function quantityTables(tables) { return tables.filter((t) => isQuantity(t.values)); }

function rule3(tables) {
  const out = [];
  for (const t of quantityTables(tables)) {
    const nums = t.values.filter(isInt);
    const firstNum = t.values.findIndex(isInt);
    const ascending = nums.every((v, i) => i === 0 || Number(nums[i - 1]) < Number(v));
    const wordsFirst = t.values.slice(firstNum).every(isInt);
    if (!ascending || !wordsFirst) out.push(`${t.where} = [${t.values.join(', ')}]：数量应从小到大（auto / none 在前）`);
  }
  return out;
}

/** 同名旋钮每一对共有取值的票：`a|b` → 「a 在 b 前」的表。 */
function pairVotes(group) {
  const votes = new Map();
  for (const t of group) {
    for (let i = 0; i < t.values.length; i += 1) for (let j = i + 1; j < t.values.length; j += 1) {
      const key = `${t.values[i]}|${t.values[j]}`;
      if (!votes.has(key)) votes.set(key, []);
      votes.get(key).push(t);
    }
  }
  return votes;
}

function groupsByName(tables) {
  const g = new Map();
  for (const t of tables) { if (!g.has(t.name)) g.set(t.name, []); g.get(t.name).push(t); }
  return g;
}

function rule4(tables) {
  const out = [];
  for (const [name, group] of groupsByName(tables)) {
    if (group.length < 2) continue;
    const votes = pairVotes(group);
    const split = [];
    for (const [key, ts] of votes) {
      const [a, b] = key.split('|');
      if (a < b && votes.has(`${b}|${a}`)) split.push(`${a}/${b}（${ts.map((t) => t.block).join(' ')} 说 ${a} 先 · ${votes.get(`${b}|${a}`).map((t) => t.block).join(' ')} 说 ${b} 先）`);
      else if (a > b && votes.has(`${b}|${a}`)) { /* 同一对，在另一半里报 */ }
    }
    if (split.length) out.push(`${name}：共有取值的先后不一致 —— ${split.join('；')}。规矩 5 判：${arbitrate(tables, name).join(' → ')}`);
  }
  return out;
}

/** 规矩 1/2/3 能判这一对就回 -1（a 先）/ 1（b 先），判不了回 0。 */
function byRules123(a, b) {
  if (a === 'none' || b === 'none') return a === 'none' ? -1 : 1;
  if (POS.includes(a) && POS.includes(b)) return POS.indexOf(a) - POS.indexOf(b) < 0 ? -1 : 1;
  if (isInt(a) && isInt(b)) return Number(a) < Number(b) ? -1 : 1;
  return 0;
}

/**
 * 规矩 5：一个旋钮名的建议顺序。先只排「至少两张表共有」的取值（成对比较：规矩 1/2/3 → 票数 → 全局出现次数），
 * 独有取值接在后面、保持它在原表里的先后。
 */
function arbitrate(tables, name) {
  const group = tables.filter((t) => t.name === name);
  const freq = new Map();
  for (const t of tables) for (const v of t.values) freq.set(v, (freq.get(v) || 0) + 1);
  const inTables = new Map();
  for (const t of group) for (const v of t.values) inTables.set(v, (inTables.get(v) || 0) + 1);
  const shared = [...inTables.keys()].filter((v) => inTables.get(v) >= 2);
  const votes = pairVotes(group);
  const cmp = (a, b) => {
    const r = byRules123(a, b);
    if (r) return r;
    const ab = (votes.get(`${a}|${b}`) || []).length;
    const ba = (votes.get(`${b}|${a}`) || []).length;
    if (ab !== ba) return ab > ba ? -1 : 1;
    return (freq.get(b) || 0) - (freq.get(a) || 0);
  };
  const seen = [];
  for (const t of group) for (const v of t.values) if (!seen.includes(v)) seen.push(v);
  const isShared = (v) => shared.includes(v);
  // 规矩 1/2/3 管得着的一对先按它们；否则共有在前、独有在后；独有之间保持原来的先后。
  return seen.slice().sort((a, b) => {
    const r = byRules123(a, b);
    if (r) return r;
    if (isShared(a) !== isShared(b)) return isShared(a) ? -1 : 1;
    return isShared(a) ? cmp(a, b) : seen.indexOf(a) - seen.indexOf(b);
  });
}

// 规矩 5 判出来的结果（#1481 正文「按这条判出来的结果」，在 8bb85bce 上跑过）：同名旋钮里只要两项都在，就得是这个先后。
const PINNED = {
  itemStyle: [['plain', 'card'], ['card', 'divided'], ['plain', 'divided']],
  itemsLayout: [['grid', 'list'], ['grid', 'row']],
  textAlign: [['left', 'center'], ['center', 'right'], ['left', 'right']],
};

function rule5Pinned(tables) {
  const out = [];
  for (const t of tables) {
    for (const [a, b] of PINNED[t.name] || []) {
      const i = t.values.indexOf(a);
      const j = t.values.indexOf(b);
      if (i >= 0 && j >= 0 && i > j) out.push(`${t.where} = [${t.values.join(', ')}]：规矩 5 判的是 ${a} 在 ${b} 前`);
    }
  }
  return out;
}

function defaultsValid(tables) {
  return tables.filter((t) => t.default !== undefined && !t.values.includes(t.default))
    .map((t) => `${t.where} 的默认值 ${JSON.stringify(t.default)} 不在 [${t.values.join(', ')}] 里`);
}

// ── 跑 ───────────────────────────────────────────────────────────────────────────────────────────────
const TABLES = readTables();
const BLOCK_COUNT = new Set(TABLES.map((t) => t.block)).size;
console.log(`读到 ${BLOCK_COUNT} 个块、${TABLES.length} 张取值表（旋钮 ${TABLES.filter((t) => t.where.includes('.knobs.')).length} · 词表 ${TABLES.filter((t) => t.where.includes('.choices.')).length}）`);
if (TABLES.length < 50) die(`只读到 ${TABLES.length} 张表 —— 口径坏了（#1481 正文：17 个块 120 张）`);

const RULES = [
  ['规矩 1 none 在第 0 项', rule1, () => TABLES.filter((t) => t.values.includes('none')).length],
  ['规矩 2 位置类按 左 右 上 下 背景', rule2, () => TABLES.filter((t) => t.values.filter((v) => POS.includes(v)).length >= 2).length],
  ['规矩 3 数量从小到大', rule3, () => quantityTables(TABLES).length],
  ['规矩 4 同名旋钮共有取值先后一致', rule4, () => [...groupsByName(TABLES).values()].filter((g) => g.length >= 2).length],
  ['规矩 5 仲裁结果（PINNED）', rule5Pinned, () => TABLES.filter((t) => PINNED[t.name]).length],
  ['显式默认值在取值里', defaultsValid, () => TABLES.filter((t) => t.default !== undefined).length],
];

console.log('① 今天的 manifest');
for (const [label, fn, scope] of RULES) {
  const v = fn(TABLES);
  check(v.length === 0, `${label}（射程 ${scope()} ${label.startsWith('规矩 4') ? '组' : '张'}）`, v.join(' | '));
}
const qty = quantityTables(TABLES);
console.log(`  📌 规矩 3 的射程：${qty.map((t) => `${t.block}.${t.name}`).join(' · ')}`);

// ② 反向对照：每条规矩各改坏一处，判据必须当场红（单变量：其余表原样）。
console.log('② 反向对照（各改坏一张表）');
const mutate = (pick, change) => TABLES.map((t) => (pick(t) ? { ...t, values: change(t.values.slice()) } : t));
const firstOf = (pred) => { const t = TABLES.find(pred); if (!t) die('找不到做反向对照的表'); return t; };
const swap01 = (v) => [v[1], v[0], ...v.slice(2)];
{
  const t = firstOf((x) => x.values[0] === 'none');
  const r = rule1(mutate((x) => x === t, swap01));
  check(r.length === 1, `规矩 1：把 ${t.where} 的 none 挪到第二位 ⟹ 红 ${r.length} 条`, r.join(' | '));
}
{
  const t = firstOf((x) => x.values[0] === 'left' && x.values[1] === 'right');
  const r = rule2(mutate((x) => x === t, swap01));
  check(r.length === 1, `规矩 2：把 ${t.where} 改成 right 在 left 前 ⟹ 红 ${r.length} 条`, r.join(' | '));
}
{
  const t = firstOf((x) => isQuantity(x.values) && isInt(x.values[0]));
  const r = rule3(mutate((x) => x === t, swap01));
  check(r.length === 1, `规矩 3：把 ${t.where} 的列数写反（${swap01(t.values).join(',')}）⟹ 红 ${r.length} 条`, r.join(' | '));
  const u = firstOf((x) => isQuantity(x.values) && x.values[0] === 'auto');
  const r2 = rule3(mutate((x) => x === u, (v) => [...v.slice(1), v[0]]));
  check(r2.length === 1, `规矩 3：把 ${u.where} 的 auto 挪到最后 ⟹ 红 ${r2.length} 条`, r2.join(' | '));
}
{
  // 挑一张跟别的块同名、而且前两项不受规矩 1/2/3 管的表（introAlign 的 left/center 不在 POS 对里，换序只有规矩 4 管）
  const t = firstOf((x) => x.name === 'introAlign');
  const mutated = mutate((x) => x === t, swap01);
  const r = rule4(mutated);
  check(r.length === 1 && r[0].startsWith('introAlign'), `规矩 4：只把 ${t.where} 改成 [${swap01(t.values).join(', ')}] ⟹ 红 ${r.length} 组`, r.join(' | '));
  check(rule1(mutated).length + rule2(mutated).length + rule3(mutated).length === 0, '  （同一处改动规矩 1/2/3 都不响 —— 红的确实是规矩 4）');
}
{
  // 规矩 5：全部 itemStyle 一起翻成 [card, plain]（规矩 4 不响，因为一致）—— PINNED 必须红
  const mutated = mutate((x) => x.name === 'itemStyle', (v) => { const i = v.indexOf('plain'); const j = v.indexOf('card'); [v[i], v[j]] = [v[j], v[i]]; return v; });
  check(rule4(mutated).length === 0 && rule5Pinned(mutated).length > 0, `规矩 5：全部 itemStyle 一起翻成 card 在 plain 前（规矩 4 读 0）⟹ PINNED 红 ${rule5Pinned(mutated).length} 条`);
}
{
  const t = TABLES[0];
  const r = defaultsValid(TABLES.map((x) => (x === t ? { ...x, default: 'nope' } : x)));
  check(r.length === 1, `默认值：把 ${t.where} 的 default 写成 "nope" ⟹ 红 ${r.length} 条`);
}

// ③ 规矩 5 本身：把 #1481 开票时（8bb85bce）那几张打架的表喂给 §arbitrate，判出来必须是正文写的那个结果。
console.log('③ 规矩 5 的判法（8bb85bce 上打架的那几张表）');
{
  const at = (block, name, values) => ({ where: `${block}.options.knobs.${name}`, block, name, values });
  const others = TABLES.filter((t) => !['itemStyle', 'itemsLayout', 'textAlign'].includes(t.name));
  const old = [
    at('blog', 'itemStyle', ['plain', 'card']), at('contact', 'itemStyle', ['plain', 'card']), at('faq', 'itemStyle', ['divided', 'card', 'plain']),
    at('features', 'itemStyle', ['plain', 'card']), at('logos', 'itemStyle', ['plain', 'card']), at('reviews', 'itemStyle', ['plain', 'card']),
    at('testimonials', 'itemStyle', ['plain', 'card']),
    at('blog', 'itemsLayout', ['grid', 'list', 'featured']), at('contact', 'itemsLayout', ['list', 'grid']), at('features', 'itemsLayout', ['grid', 'list']),
    at('gallery', 'itemsLayout', ['grid', 'mosaic']), at('logos', 'itemsLayout', ['row', 'grid']), at('reviews', 'itemsLayout', ['grid', 'row']),
    at('testimonials', 'itemsLayout', ['grid', 'carousel']),
    at('content', 'textAlign', ['left', 'center']), at('cta', 'textAlign', ['center', 'left', 'right']), at('hero', 'textAlign', ['left', 'center', 'right']),
    at('page-header', 'textAlign', ['left', 'center']),
  ];
  const world = others.concat(old);
  check(rule4(world).length === 3, `那时规矩 4 读 3 组（itemStyle / itemsLayout / textAlign）—— 读到 ${rule4(world).length}`);
  const is = arbitrate(world, 'itemStyle');
  check(is.indexOf('plain') < is.indexOf('card') && is[is.length - 1] === 'divided', `itemStyle ⟹ ${is.join(' → ')}（plain 先 6 票 vs card 先 1 票；faq 独有的 divided 排最后）`);
  const il = arbitrate(world, 'itemsLayout');
  check(il.indexOf('grid') < il.indexOf('list') && il.indexOf('grid') < il.indexOf('row'), `itemsLayout ⟹ ${il.join(' → ')}（grid/list 2:1；grid/row 1:1 平手 → 全局 grid 多）`);
  const ta = arbitrate(world, 'textAlign');
  check(sameOrder(ta, ['left', 'center', 'right']), `textAlign ⟹ ${ta.join(' → ')}（left/center 3:1；center/right 2:0）`);
  for (const [name, pairs] of Object.entries(PINNED)) {
    const o = arbitrate(world, name);
    check(pairs.every(([a, b]) => o.indexOf(a) < o.indexOf(b)), `PINNED.${name} 与 §arbitrate 判的一致`);
  }
}

console.log(`\n══ 汇总: 通过 ${pass} · 失败 ${fail} ══`);
process.exit(fail ? 1 : 0);
