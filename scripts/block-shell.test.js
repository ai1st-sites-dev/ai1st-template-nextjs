#!/usr/bin/env node
/**
 * block-shell.test.js — 色槽定义与段落外壳各只剩一份（#1534 T6c-2 验收 3）。
 *
 *   node scripts/block-shell.test.js     （由 `npm run test:scripts` 自动发现）
 *   退出码: 0 全过 · 1 有失败 · 2 跑不起来（**不许当成通过**）
 *
 * ── 为什么 ──────────────────────────────────────────────────────────────────────────────────────
 * 17 个块的 `slots.bg` 曾经逐字相同、各抄一份；15 个块的 `<section>` + 深浅标记 + 底色 + 留白 + 容器也各写一份。
 * 新块照着旧块写 —— 不拦的话下一个块会把它们抄回来。这里管两件事：
 *   ① 色槽：每个块 manifest 的 `slots.bg` 必须恰好是 `{ "ref": "bg" }`（共用定义在 scripts/lib/shared-slots.json），
 *      而且任何块里都不许出现跟共用 `bg` 逐字相同的**内联**颜色槽（换个名字抄一份也算）。
 *      pricing 的 `featuredColor` 有自己的一套色板，不是抄的，不拦。
 *   ② 外壳：每个页面块（manifest 没写 `region: true` 的；header / footer 是外壳块，不写 `<section>`）的组件里，
 *      **剥掉注释后**不许出现 `<section` / `data-tone=` / `data-bs-theme=` / `bsThemeForBg(` —— 这四样只住在
 *      `src/components/BlockSection.tsx`；而且必须用 `<BlockSection`。
 *   ③ 读的人拿到的还是完整定义：`loadManifests()` 里每个块的 `slots.bg` 跟共用那一份逐字相同（展开是在读入口做的）。
 * 块目录从磁盘现取，不写清单，新块进来自动在射程里。
 *
 * 🔴 每一段都带反向对照（同一进程、单变量）：拿内存里的一份「坏」manifest / 组件喂同一个判定函数，必须判红。
 */

'use strict';

const fs = require('fs');
const path = require('path');

const NEXT = path.resolve(__dirname, '..');
const BLOCKS = path.join(NEXT, 'blocks');

let pass = 0;
let fail = 0;
const ok = (m) => { pass += 1; console.log(`  ✅ ${m}`); };
const bad = (m) => { fail += 1; console.log(`  ❌ ${m}`); };
const die = (m) => { console.error(`🔴 跑不起来: ${m}`); process.exit(2); };
const check = (cond, m, detail) => (cond ? ok(m) : bad(detail ? `${m} —— ${detail}` : m));

let shared;
let loadManifests;
try {
  shared = require('./lib/shared-slots.json');
  ({ loadManifests } = require('./lib/block-manifest'));
} catch (e) {
  die(`读不到共用槽定义 / block-manifest：${e.message.split('\n')[0]}`);
}
if (!shared || !shared.bg || shared.bg.kind !== 'color' || !Array.isArray(shared.bg.swatches) || !shared.bg.swatches.length) {
  die('scripts/lib/shared-slots.json 里没有一份像样的 bg（kind: color + swatches）');
}

const blocks = fs.readdirSync(BLOCKS, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name).sort();
if (!blocks.length) die('blocks/ 下一个块都没有 —— 下面整节会空过');
const rawManifest = (b) => JSON.parse(fs.readFileSync(path.join(BLOCKS, b, 'manifest.json'), 'utf8'));
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

/** ① 一份 manifest（原样读进来的）在色槽上有什么毛病。 */
function colorSlotProblems(m) {
  const out = [];
  const slots = (m && m.slots) || {};
  if (!same(slots.bg, { ref: 'bg' })) out.push(`slots.bg 不是 { "ref": "bg" }（是 ${JSON.stringify(slots.bg).slice(0, 60)}…）`);
  for (const [name, spec] of Object.entries(slots)) {
    if (name !== 'bg' && same(spec, shared.bg)) out.push(`slots.${name} 是共用 bg 的内联抄本`);
  }
  return out;
}

/** 剥掉 // 与 /* *\/ 注释（字符串里的 `//`（例 `url(https://…)`）不算注释）。 */
function stripComments(src) {
  let out = '';
  let i = 0;
  let q = null;
  while (i < src.length) {
    const c = src[i];
    const n = src[i + 1];
    if (q) {
      out += c;
      if (c === '\\') { out += n || ''; i += 2; continue; }
      if (c === q) q = null;
      i += 1;
      continue;
    }
    if (c === '"' || c === "'" || c === '`') { q = c; out += c; i += 1; continue; }
    if (c === '/' && n === '/') { while (i < src.length && src[i] !== '\n') i += 1; continue; }
    if (c === '/' && n === '*') { const j = src.indexOf('*/', i + 2); i = j < 0 ? src.length : j + 2; continue; }
    out += c;
    i += 1;
  }
  return out;
}

const SHELL_TOKENS = ['<section', 'data-tone=', 'data-bs-theme=', 'bsThemeForBg('];
/** ② 一个页面块组件的源码（含注释）在外壳上有什么毛病。 */
function shellProblems(src) {
  const code = stripComments(src);
  const out = SHELL_TOKENS.filter((t) => code.includes(t)).map((t) => `自己写了 ${t}`);
  if (!code.includes('<BlockSection')) out.push('没用 <BlockSection>');
  return out;
}

console.log('── ① 色槽：slots.bg 是引用，没有内联抄本');
{
  const good = colorSlotProblems({ slots: { a: { kind: 'text' }, bg: { ref: 'bg' } } });
  const inline = colorSlotProblems({ slots: { bg: JSON.parse(JSON.stringify(shared.bg)) } });
  const renamed = colorSlotProblems({ slots: { bg: { ref: 'bg' }, tint: JSON.parse(JSON.stringify(shared.bg)) } });
  check(!good.length && inline.length === 1 && renamed.length === 1,
    '反向对照：引用读 0 条；内联一份完整 bg 读 1 条；换名抄一份读 1 条',
    `good=${good.length} inline=${inline.length} renamed=${renamed.length}`);
  const offenders = blocks.map((b) => [b, colorSlotProblems(rawManifest(b))]).filter(([, p]) => p.length);
  check(!offenders.length, `${blocks.length} 个块的 manifest：slots.bg 都是 { ref }、没有内联抄本`,
    offenders.map(([b, p]) => `blocks/${b}/manifest.json：${p.join('；')}`).join(' · '));
}

console.log('\n── ② 外壳：页面块不自己写 <section> / 深浅标记');
{
  const fakeOld = '// <section> 在注释里不算\nreturn (<section {...blockAttrs("x", b)} data-tone={t} data-bs-theme={bsThemeForBg(d.bg)}><div className="container" /></section>);';
  const fakeNew = '// 注释里写 <section data-tone= 不算\nreturn (<BlockSection type="x" block={b} bg={d.bg}>{kids}</BlockSection>);';
  const pOld = shellProblems(fakeOld);
  const pNew = shellProblems(fakeNew);
  check(pOld.length === 5 && !pNew.length, '反向对照：手写外壳读 5 条（四样 + 没用 BlockSection）；用 BlockSection、注释里提到 <section 读 0 条',
    `old=${JSON.stringify(pOld)} new=${JSON.stringify(pNew)}`);
  const pages = blocks.filter((b) => rawManifest(b).region !== true);
  const shells = blocks.filter((b) => !pages.includes(b));
  if (!pages.length) die('一个页面块都没有 —— 这一节会空过');
  const offenders = [];
  for (const b of pages) {
    const f = path.join(BLOCKS, b, 'Section.tsx');
    if (!fs.existsSync(f)) { offenders.push(`blocks/${b}/Section.tsx 不存在`); continue; }
    const p = shellProblems(fs.readFileSync(f, 'utf8'));
    if (p.length) offenders.push(`blocks/${b}/Section.tsx：${p.join('；')}`);
  }
  check(!offenders.length, `${pages.length} 个页面块都走 <BlockSection>（外壳块 ${shells.join(' / ') || '无'} 不在射程）`, offenders.join(' · '));
}

console.log('\n── ③ 读入口展开后还是完整定义');
{
  let ms;
  try { ms = loadManifests(); } catch (e) { die(`loadManifests 失败：${e.message.split('\n')[0]}`); }
  const off = blocks.filter((b) => !ms.get(b) || !same(ms.get(b).slots.bg, shared.bg));
  check(!off.length && ms.size === blocks.length, `loadManifests() 的 ${ms.size} 个块，slots.bg 都跟共用那一份逐字相同`, off.join(' / '));
}

console.log(`\n${fail ? '❌' : '✅'} block-shell: ${pass} 过 / ${fail} 不过`);
process.exit(fail ? 1 : 0);
