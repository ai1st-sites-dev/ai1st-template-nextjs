#!/usr/bin/env node
/**
 * region-layout.test.js — #1096 B7:给 `resolveRegionLayout` 的两条承重性质装一个常设守卫。
 *
 *   node scripts/region-layout.test.js     （由 `npm run test:scripts` 自动发现）
 *   退出码: 0 全过 · 1 有失败 · 2 跑不起来（**不许当成通过**）
 *
 * ── 为什么要有它 ────────────────────────────────────────────────────────────────────────────────
 * #1086 的 QA3 真改坏跑过：把「先合并版式、再据合并结果算遮罩」的顺序写反，
 * `1086-structure-follows-theme-id.spec.ts` 的 5 格全绿。后果是显式声明透明浮层的站**没有那层遮罩**
 * —— 白字压浅底，就是 #1024 那类事故（`region-layout.js` 文件头 ② 记着实测：公司名 + 4 条导航链接
 * 全是 1.00:1，一个字都看不见）；同族的另一半是清单外的版式名**原样落进 DOM 属性**。
 *
 * 🔴 为什么这一格放在这里而不是补进那个 spec：`resolveRegionLayout` 是纯函数，而那个 spec 要真 build
 *    + 真浏览器。放进 scripts 下的 .test.js 意味着 **CI 每次 push 都会跑它**（`run-script-tests.js` 自动发现），而 e2e 那格只在有人本地跑时才存在。同一条性质，射程差一个数量级。
 *
 * 🔴 这里判的是**顺序**，不是「遮罩这个值对不对」：判据必须是「拿【合并之后】那个 header 算的」。
 *    把那一行挪到合并之前，`header` 那一刻还是默认值 ⟹ 遮罩恒 false，而这一格会红。
 */

'use strict';

const RL = require('./region-layout.js');

let pass = 0; let fail = 0;
const ok = (m) => { pass++; console.log(`  ✅ ${m}`); };
const bad = (m) => { fail++; console.log(`  ❌ ${m}`); };
const die = (m) => { console.error(`🔴 跑不起来: ${m}`); process.exit(2); };

for (const k of ['resolveRegionLayout', 'HEADER_VARIANTS', 'FOOTER_VARIANTS', 'TOPBAR_VARIANTS',
  'DEFAULT_HEADER', 'DEFAULT_FOOTER', 'DEFAULT_TOPBAR']) {
  if (RL[k] === undefined) die(`region-layout.js 没导出 ${k} —— 这一格量不到它要量的东西`);
}
const {
  resolveRegionLayout: resolve, HEADER_VARIANTS, FOOTER_VARIANTS, TOPBAR_VARIANTS,
  DEFAULT_HEADER, DEFAULT_FOOTER, DEFAULT_TOPBAR,
} = RL;

// 夹具自检:这一格的整个意思建立在「透明浮层是清单里的一项、而且不是默认那一项」上面。
if (!HEADER_VARIANTS.includes('transparent-overlay')) die('清单里没有 transparent-overlay —— 下面那几格在说别的事');
if (DEFAULT_HEADER === 'transparent-overlay') die('默认 header 就是透明浮层 ⟹ 「顺序」那一格分不出对错');

// ── ① 顺序:遮罩按【合并之后】那个 header 算 ────────────────────────────────────────────────────
{
  const r = resolve({ header: 'transparent-overlay', footer: DEFAULT_FOOTER });
  if (r.header !== 'transparent-overlay') {
    bad(`声明 transparent-overlay 而合并出来是 ${JSON.stringify(r.header)} —— 显式写的那个键没赢`);
  } else if (r.headerScrim !== true) {
    bad('显式声明透明浮层的站【没有】遮罩(headerScrim=' + JSON.stringify(r.headerScrim) + ')。'
      + '这正是把「先算遮罩、再合并版式」写反的样子:算遮罩那一刻 header 还是默认值 ⟹ 恒 false。'
      + '后果是白字压浅底 —— region-layout.js 文件头 ② 实测过 1.00:1');
  } else {
    ok('透明浮层 ⟹ headerScrim=true(遮罩是按【合并之后】那个 header 算的)');
  }
}

// ── ② 反向:不是浮层就不加遮罩(否则上面那格被「永远 true」也能满足)────────────────────────────
{
  const solid = HEADER_VARIANTS.filter((v) => v !== 'transparent-overlay');
  const wrong = solid.filter((v) => resolve({ header: v }).headerScrim !== false);
  if (wrong.length === 0) ok(`清单里另外 ${solid.length} 个 header 版式一个都不加遮罩(反向对照)`);
  else bad(`这些非浮层版式也被加了遮罩:${wrong.join(' · ')} —— 那样上面那一格用「恒 true」也能通过`);
}

// ── ③ 清单外的值必须落回默认,而且**返回值恒在清单里**(它会原样落进 DOM 属性)──────────────────
{
  const junk = ['transparent-overlay ', 'TRANSPARENT-OVERLAY', 'pill-floating; drop table', '../../etc/passwd', '{}'];
  const problems = [];
  for (const v of junk) {
    const r = resolve({ header: v, footer: v, topbar: v });
    if (r.header !== DEFAULT_HEADER) problems.push(`header=${JSON.stringify(v)} ⟹ ${JSON.stringify(r.header)}(该退回 ${DEFAULT_HEADER})`);
    if (r.footer !== DEFAULT_FOOTER) problems.push(`footer=${JSON.stringify(v)} ⟹ ${JSON.stringify(r.footer)}(该退回 ${DEFAULT_FOOTER})`);
    if (r.topbar !== DEFAULT_TOPBAR) problems.push(`topbar=${JSON.stringify(v)} ⟹ ${JSON.stringify(r.topbar)}(该退回 ${DEFAULT_TOPBAR})`);
    if (!r.notes.some((n) => n.includes(String(v)))) problems.push(`退回了但 notes 里没说是因为 ${JSON.stringify(v)} —— 静默降级`);
  }
  if (problems.length === 0) {
    ok(`${junk.length} 个清单外的版式名全部落回默认，并且每一个都在 notes 里说了理由`);
  } else problems.forEach(bad);
}

// ── ④ 清单里的每一项都必须原样通过(否则 ③ 用「永远退回默认」也能满足)────────────────────────
{
  const problems = [];
  for (const v of HEADER_VARIANTS) if (resolve({ header: v }).header !== v) problems.push(`header ${v}`);
  for (const v of FOOTER_VARIANTS) if (resolve({ footer: v }).footer !== v) problems.push(`footer ${v}`);
  for (const v of TOPBAR_VARIANTS) if (resolve({ topbar: v }).topbar !== v) problems.push(`topbar ${v}`);
  if (problems.length === 0) {
    ok(`清单里 ${HEADER_VARIANTS.length}+${FOOTER_VARIANTS.length}+${TOPBAR_VARIANTS.length} 个版式全部原样通过(反向对照)`);
  } else bad(`这些清单内的版式没被原样通过:${problems.join(' · ')}`);
}

// ── ⑤ 没换装(传 {})⟹ 三个键都是默认,且不加遮罩 ────────────────────────────────────────────
{
  const r = resolve({});
  const r2 = resolve(undefined);
  const want = { header: DEFAULT_HEADER, footer: DEFAULT_FOOTER, topbar: DEFAULT_TOPBAR, headerScrim: false };
  const shape = (x) => JSON.stringify({ header: x.header, footer: x.footer, topbar: x.topbar, headerScrim: x.headerScrim });
  if (shape(r) === JSON.stringify(want) && shape(r2) === JSON.stringify(want)) {
    ok(`没换装(传 {} 或 undefined)⟹ ${DEFAULT_HEADER} / ${DEFAULT_FOOTER} / ${DEFAULT_TOPBAR}、不加遮罩`);
  } else {
    bad(`没换装时的结论变了:{} ⟹ ${shape(r)} · undefined ⟹ ${shape(r2)},期望 ${JSON.stringify(want)}`);
  }
}

console.log(`\n══ 汇总: 通过 ${pass} · 失败 ${fail} ══`);
process.exit(fail ? 1 : 0);
