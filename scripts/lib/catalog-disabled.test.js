#!/usr/bin/env node
/**
 * catalog-disabled.test.js — #1346：后台「区块与主题」页关掉一套主题 / 一个块之后，**建站容器那一侧**
 * 真的不再选它。
 *
 *   node scripts/lib/catalog-disabled.test.js     （CI 里由 `npm run test:scripts` 自动发现）
 *   退出码: 0 全过 · 1 有失败 · 2 跑不起来（**不许当成通过**）
 *
 * 这里判的每一格都有**反向臂**，因为这一族改动的失败方向是「看起来生效了」：菜单少一个块、页面里
 * 恰好也没有那个块 —— 这两件事在只看正臂时读数相同，而后者是模型那一次恰好没选它。所以每一格
 * 都要求「撤掉这一步，同一个输入读到另一个数」。
 *
 * 🔴 最贵的那两格（④⑤）真跑 `create-site.js`，拿一把**无效的 key**：提示词在发请求之前就被
 *    `emit('prompt', …)` 打在 stdout 上（`create-site.js` §generateContent），所以拿得到读数、
 *    一分钱不花。
 *
 * 📌 #1425（T3）—— 零行为那一格原来拿钉死的一个 commit（`9d056fd7`）那棵树的提示词整份比、差异逐条登记。
 *    本票按设计把提示词里的块名整批换成新库（旧库 28 块删了，16 个 `-new` 改回正名），基线那份 scripts 配今天的
 *    `blocks/` 连提示词都吐不出来 ⟹ 换成**同一棵树里两臂互比**：「什么都没关 vs 关掉 X」两份提示词的每一处差异
 *    都必须点名 X（或是那句现算的块数），见 ④ 最后一格。
 */

'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync, spawnSync } = require('child_process');

let pass = 0; let fail = 0;
const ok = (m) => { pass++; console.log(`  ✅ ${m}`); };
const bad = (m) => { fail++; console.log(`  ❌ ${m}`); };
const die = (m) => { console.error(`🔴 跑不起来: ${m}`); process.exit(2); };

const NEXT = path.resolve(__dirname, '..', '..');

const themesMod = require('../themes');
const { pickThemeForIndustry, candidateThemesForIndustry, candidateThemesAfterDisabled, poolThemes } = themesMod;
const { validateSite, loadManifests, isRegionManifest } = require('./block-manifest');
const { poolFor, homepageRecipe, tryHomepageRecipe } = require('./homepage-recipe');

for (const [k, v] of Object.entries({ pickThemeForIndustry, candidateThemesAfterDisabled, validateSite, poolFor, homepageRecipe, tryHomepageRecipe })) {
  if (typeof v !== 'function') die(`${k} 没导出`);
}

const POOL = Object.keys(poolThemes);
if (POOL.length < 2) die(`主题池只有 ${POOL.length} 套 —— 下面每一格都要「关掉一套还剩一套」`);
const INDUSTRIES = ['dental clinic', 'roofing', 'law firm', 'bakery'];

// ── ① 挑主题 ────────────────────────────────────────────────────────────────────────────────────
console.log('\n── ① pickThemeForIndustry：关掉的那套永远抽不到 ──');
{
  // 反向臂在同一格里：清单为空 ⟹ 跟**不传第三个参数**逐字相同。这一句钉的是「没人关任何东西时，
  // #1346 之前那条路一个字节没变」。
  const same = [];
  for (const ind of INDUSTRIES) {
    for (let i = 0; i < 6; i++) {
      same.push(pickThemeForIndustry(ind, i) === pickThemeForIndustry(ind, i, []));
    }
  }
  same.every(Boolean)
    ? ok(`清单为空 ⟹ 与不传清单逐个相同（${same.length} 个行业×轮换位）`)
    : bad('清单为空时挑出来的主题跟不传清单不一样 —— 这条路本该一个字节没变');
}
{
  const off = POOL[0];
  const rest = POOL.filter((id) => id !== off);
  const got = new Set();
  const gotBefore = new Set();
  for (const ind of INDUSTRIES) {
    for (let i = 0; i < 6; i++) {
      got.add(pickThemeForIndustry(ind, i, [off]));
      gotBefore.add(pickThemeForIndustry(ind, i));
    }
  }
  !got.has(off)
    ? ok(`关掉 ${off} ⟹ ${INDUSTRIES.length}×6 次全部抽到 ${[...got].join(' / ')}`)
    : bad(`关掉 ${off}，它还是被抽到了`);
  // 🔴 反向臂：同一组入参在**不关**的时候确实抽得到它。没有这一句，上一句在「它本来就抽不到」
  //    的池子上恒绿。
  gotBefore.has(off)
    ? ok(`反向臂：不关的时候这组入参抽得到 ${off}（所以上一格不是恒真）`)
    : bad(`反向臂失败：不关也抽不到 ${off} —— 上一格没有判别力，换一组入参`);
  rest.every((id) => got.has(id) || rest.length > 1)
    ? ok('剩下的主题仍然抽得到')
    : bad('关掉一套之后，剩下的那套也抽不到了');
}
{
  const none = pickThemeForIndustry(INDUSTRIES[0], 0, POOL);
  none === null
    ? ok('池里全部关掉 ⟹ 返回 null（调用方据此干净失败；改之前这里是 undefined，会静默往下走）')
    : bad(`池里全部关掉，返回了 ${JSON.stringify(none)} —— 静默建一个没有主题的站正是要堵的方向`);
}
{
  // 覆盖边界，说出来而不是造一个假绿：第二级回退（行业候选池被关空 ⟹ 落回全池减禁用）今天
  // **不可达** —— 池里只有这几套，而 themes.js 的 NEUTRAL_TOPUP 把它们顶进每一个行业的候选集
  // （MIN_ROTATION_POOL = 3 在 2 套的池子上永远凑不满）。池子重生成之后这一格才有东西可量。
  const everyIndustryHasAll = INDUSTRIES.every((ind) => POOL.every((id) => candidateThemesForIndustry(ind).includes(id)));
  everyIndustryHasAll
    ? ok(`覆盖边界：今天每个行业的候选集都是整池（${POOL.length} 套）⟹「行业池被关空、全池还有剩」这一级回退【测不到】，池子长回去时要补这一格`)
    : bad('前提变了：有行业的候选集不是整池 ⟹ 第二级回退现在可达，这一格要改成真的测它');
}

// ── ② 校验器 ────────────────────────────────────────────────────────────────────────────────────
console.log('\n── ② validateSite：关掉压过「行业必需」，而用了关掉的块要报出来 ──');
const manifests = loadManifests();
// 📌 #1425（T3）—— 原来的语料是写着 `required: ["*"]` 的块（contact-info，旧库）。新库没有一个块是「每个站都要」，
//    但「关掉压过行业必需」这条仍在（`validateSite` 不分 "*" 与具体行业，走同一个 `if (off.has(m.type)) continue`）：
//    语料改成任何一个写着非空 `industries.required` 的块，行业取一个它点名的、能被认出来的写法（"*" ⟹ dental clinic）。
const REQ_BLOCKS = [...manifests.values()].filter((m) => ((m.industries || {}).required || []).length).map((m) => m.type);
if (!REQ_BLOCKS.length) die('没有一个块写着非空的 industries.required —— ② 那两格的语料没了');
const REQ_T = REQ_BLOCKS[0];
const REQ_IND = (() => {
  const req = manifests.get(REQ_T).industries.required;
  return req.includes('*') ? 'dental clinic' : `${req[0]} studio`;
})();
{
  const t = REQ_T;
  // 一个**没有**那个块的站。这正是「菜单剔掉它 ⟹ 模型不放它」之后的形状。
  const pages = [{ slug: 'home', sections: [{ type: 'hero', data: { headline: 'x', subheadline: 'y' } }] }];
  const withList = validateSite({ pages, industry: REQ_IND, disabledBlocks: [t] });
  const without = validateSite({ pages, industry: REQ_IND });
  const hits = (r) => r.problems.filter((p) => p.includes(`"${t}"`)).length;
  hits(withList) === 0
    ? ok(`关掉 ${t}（industries.required 点名了 "${REQ_IND}"）⟹ 「整个站里没有它」不再报 problem`)
    : bad(`关掉 ${t}，它还在报：${withList.problems.join(' | ')}`);
  hits(without) >= 1
    ? ok(`反向臂：不传清单，同一份页面报「整个站里没有 "${t}"」⟹ 上一格不是恒真（这就是 create-site.js 那句 fatal 的来源）`)
    : bad(`反向臂失败：不传清单也不报 "${t}" —— 上一格没有判别力`);
}
{
  const t = 'faq';   // #1425（T3）：faq-accordion → faq（槽同形）
  if (!manifests.has(t)) die(`blocks/${t}/manifest.json 不在了 —— 这一格的语料要换一个块`);
  const pages = [{ slug: 'home', sections: [{ type: t, data: { items: [{ question: 'q', answer: 'a' }] } }] }];
  const withList = validateSite({ pages, industry: 'dental clinic', disabledBlocks: [t] });
  const without = validateSite({ pages, industry: 'dental clinic' });
  withList.problems.some((p) => p.includes('已经在后台关掉了'))
    ? ok(`页面里用了关掉的 ${t} ⟹ 报一条 problem（走重试一次那条现成的路）`)
    : bad(`页面里用了关掉的 ${t}，一条都没报：${JSON.stringify(withList.problems)}`);
  without.problems.some((p) => p.includes('已经在后台关掉了'))
    ? bad('反向臂失败：不传清单也报「关掉了」')
    : ok('反向臂：不传清单 ⟹ 同一份页面不报这条');
}
{
  // 共享件的另一个消费者：构建期那条路（scope='build'）不传清单 ⟹ 行为一个字节不变。
  const t = REQ_T;
  const pages = [{ slug: 'home', sections: [{ type: 'hero', data: { headline: 'x', subheadline: 'y' } }] }];
  const build = validateSite({ pages, industry: REQ_IND, scope: 'build' });
  build.problems.length === 0 && build.warnings.some((p) => p.includes(`"${t}"`))
    ? ok("构建期（scope='build'）不传清单：照旧 0 problem，那条检查仍在 warnings 里")
    : bad(`构建期那条路变了：problems=${build.problems.length} warnings=${JSON.stringify(build.warnings)}`);
}

// ── ③ 首页开场配方 ──────────────────────────────────────────────────────────────────────────────
console.log('\n── ③ homepageRecipe：关掉的块不进配方（配方点名的块在提示词里是硬要求）──');
{
  const base = poolFor(manifests, 'dental clinic');
  const same = poolFor(manifests, 'dental clinic', []);
  JSON.stringify(base) === JSON.stringify(same)
    ? ok(`清单为空 ⟹ 候选池逐字相同（${base.length} 个块）`)
    : bad('清单为空时候选池就变了 —— 这条路本该一个字节没变');
  const victim = base.find((t) => t !== 'hero');
  if (!victim) die('候选池里除了 hero 没有别的块 —— 这一格量不了');
  const after = poolFor(manifests, 'dental clinic', [victim]);
  !after.includes(victim) && after.length === base.length - 1
    ? ok(`关掉 ${victim} ⟹ 候选池少它一个（${base.length} → ${after.length}）`)
    : bad(`关掉 ${victim} 之后候选池是 ${after.length} 个，还含它? ${after.includes(victim)}`);
  let named = 0; let namedBefore = 0;
  for (let i = 0; i < 24; i++) {
    const r = homepageRecipe(i, manifests, 'dental clinic', [victim]);
    const b = homepageRecipe(i, manifests, 'dental clinic');
    if ([...r.opener, ...r.mustInclude, ...r.promptOrder].includes(victim)) named++;
    if ([...b.opener, ...b.mustInclude].includes(victim)) namedBefore++;
  }
  named === 0
    ? ok(`24 份配方（opener + mustInclude + promptOrder）里 ${victim} 出现 0 次`)
    : bad(`${victim} 仍被配方点名 ${named} 次`);
  namedBefore > 0
    ? ok(`反向臂：不关的时候这 24 份配方点了 ${victim} ${namedBefore} 次 ⟹ 上一格不是恒真`)
    : bad(`反向臂失败：不关也没点过 ${victim} —— 换一个块当语料`);
}
{
  const r = tryHomepageRecipe(0, manifests, 'dental clinic', ['hero']);
  r.recipe === null && r.error
    ? ok('关掉 hero ⟹ 这一趟不用配方（回 {recipe:null,error}，不抛）—— 不为骨架让一次建站失败')
    : bad(`关掉 hero 之后仍拿到配方: ${JSON.stringify(r.recipe)}`);
}
// 📌 #1425（T3）—— 这里原来测「关掉 announcement-bar ⟹ 24 份配方一份都不带它」（配方的 `withBar`）。公告条块随旧库删了，
//    `BAR_EVERY` / `withBar` 退役（开场恒为 hero + 三个），这一格没有对象。
{
  // 🔴 NOT_IN_POOL 那条不变量问的是「排除名单点名的块还在不在块库里」，不是「在不在今天这一池」。
  //    关掉其中一个块之后它仍然必须不抛 —— 否则一次后台关块会静默停掉整个配方。
  const { NOT_IN_POOL } = require('./homepage-recipe');
  const excludedAll = Object.keys(NOT_IN_POOL);
  const threw = [];
  for (const t of excludedAll) {
    try { poolFor(manifests, 'dental clinic', [t]); } catch (e) { threw.push(`${t}: ${e.message}`); }
  }
  !threw.length
    ? ok(`逐个关掉排除名单里那 ${excludedAll.length} 个块 ⟹ 一个都不抛（那条不变量核的是块库，不是这一池）`)
    : bad(`poolFor 抛了：\n    ${threw.join('\n    ')}`);
  // 🔴 反事实：把 `known` 换回「从过滤后的那一池推」（改之前那一行）—— 同一个输入就会被读成
  //    「有人把这个块改名/删了」。不算这一步，上一格在「本来就不会抛」的世界里恒绿。
  const counterfactual = excludedAll.filter((t) => {
    const kept = [...manifests.values()]
      .filter((m) => m.prompt && m.prompt.group === 'homepage' && m.type !== t)
      .map((m) => m.type);
    return excludedAll.some((x) => !kept.includes(x));
  });
  counterfactual.length === excludedAll.length
    ? ok(`反事实：旧写法下这 ${excludedAll.length} 个块**每一个**被关掉都会抛 ⟹ 上一格有判别力`)
    : bad(`反事实只覆盖 ${counterfactual.length}/${excludedAll.length} 个 —— 上一格对其余那些恒绿`);
}

// ── ④⑤ 真跑一次 create-site：提示词 + 全关时的失败 ──────────────────────────────────────────────
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 't1346-'));
process.on('exit', () => fs.rmSync(tmp, { recursive: true, force: true }));

/** 造一棵今天这份 scripts/ 的副本树；blocks / node_modules / src / public 软链今天这份。
 *  📌 #1425（T3）—— 原来还能按一个 commit 造基线那棵树（含给它摘掉不认识的 layout_intent 轴那段）；基线比较换成同树两臂，那一支删了。 */
function treeAt() {
  const root = path.join(tmp, 'work');
  fs.mkdirSync(root, { recursive: true });
  execFileSync('cp', ['-a', path.join(NEXT, 'scripts'), root]);
  for (const link of ['blocks', 'node_modules', 'src', 'public']) {
    const target = path.join(NEXT, link);
    if (fs.existsSync(target) && !fs.existsSync(path.join(root, link))) {
      fs.symlinkSync(target, path.join(root, link));
    }
  }
  return root;
}

function runCreate(root, payload) {
  return spawnSync('node', [path.join(root, 'scripts', 'create-site.js')], {
    input: JSON.stringify(payload),
    env: { ...process.env, ANTHROPIC_API_KEY: 'sk-ant-invalid-for-test' },
    encoding: 'utf8',
    maxBuffer: 64 << 20,
    timeout: 180000,
  });
}

function eventsOf(r) {
  const out = [];
  for (const line of (r.stdout || '').split('\n')) {
    if (!line.trim()) continue;
    try { out.push(JSON.parse(line)); } catch { /* 非 JSON 行不是事件 */ }
  }
  return out;
}

function promptFrom(root, payload) {
  const ev = eventsOf(runCreate(root, payload)).find((e) => e.event === 'prompt' && e.name === 'Base Site');
  if (!ev) die(`没拿到提示词（这棵树: ${root}）`);
  return ev.content;
}

const basePayload = (over = {}) => ({
  siteId: 'tsite134',
  companyName: 'Bright Smile Dental',
  industry: 'dental clinic',
  location: 'Toronto, ON',
  services: ['Teeth Cleaning', 'Whitening', 'Invisalign', 'Implants', 'Root Canal', 'Emergency Dental'],
  language: 'en',
  themeRotationIndex: 0,
  keywords: { 'Teeth Cleaning': [{ keyword: 'teeth cleaning toronto', selected: true, volume: 320 }] },
  ...over,
});

const work = treeAt();

console.log('\n── ④ 提示词：关掉的块三处都不再提它 ──');
const pNone = promptFrom(work, basePayload());
{
  const pEmpty = promptFrom(work, basePayload({ disabledThemes: [], disabledBlocks: [] }));
  pNone === pEmpty
    ? ok('字段缺席 与 传两个空数组 ⟹ 提示词逐字节相同（老 manager 那条路不变）')
    : bad('空清单改变了提示词的字节');
}
{
  // #1425（T3）—— 原来是 faq-accordion。新库的块名有五个跟「页面原型」清单撞名（gallery / pricing / faq / team /
  //    testimonials：`- "faq" — Frequently asked questions` 说的是**页面**，⑧ 的射程说明里写着为什么不该随块消失）⟹
  //    这一格数的是整份提示词里带引号的命中，换一个不撞名的块。
  const t = 'logos';
  const p = promptFrom(work, basePayload({ disabledBlocks: [t] }));
  const hits = (s) => (s.match(new RegExp(`"${t}"`, 'g')) || []).length;
  hits(p) === 0
    ? ok(`关掉 ${t} ⟹ 提示词里 0 命中`)
    : bad(`关掉 ${t}，提示词里还有 ${hits(p)} 处`);
  hits(pNone) >= 1
    ? ok(`反向臂：不关的时候提示词里有 ${hits(pNone)} 处 ⟹ 上一格不是恒真`)
    : bad(`反向臂失败：不关也 0 命中 —— ${t} 本来就不在提示词里，换一个块`);
}
{
  // 写死的那两行页面规则。#1425（T3）：QUOTE 页 = page-header + contact（原来是 quote-form）；原来「quote-form 那行 data
  // 形状」的位置，今天是 SERVICES 那行底下那句「features 写引用」—— 关掉 features 它整条不印。
  const p = promptFrom(work, basePayload({ disabledBlocks: ['contact'] }));
  const quoteLine = p.split('\n').find((l) => l.startsWith('- QUOTE pages must include:')) || '';
  const quoteOn = pNone.split('\n').find((l) => l.startsWith('- QUOTE pages must include:')) || '';
  quoteLine.includes('"page-header"') && !quoteLine.includes('"contact"')
    ? ok(`关掉 contact ⟹ QUOTE 那行只剩 page-header：${quoteLine.trim()}`)
    : bad(`QUOTE 那行不对：${JSON.stringify(quoteLine)}`);
  quoteOn.includes('"contact"')
    ? ok(`反向臂：不关的时候 QUOTE 那行有 contact：${quoteOn.trim()}`)
    : bad(`反向臂失败：不关也没有 contact：${JSON.stringify(quoteOn)}`);
  const pf = promptFrom(work, basePayload({ disabledBlocks: ['features'] }));
  const svc = (src) => src.split('\n').find((l) => l.startsWith('- SERVICES pages must include:')) || '';
  const refLine = /^\s+features on a SERVICES page: /m;
  svc(pf).includes('"page-header"') && svc(pf).includes('"cta"') && !svc(pf).includes('"features"') && !refLine.test(pf)
    ? ok(`关掉 features ⟹ SERVICES 那行只剩 ${svc(pf).replace('- SERVICES pages must include: ', '')}，它那行「写引用」整条不印`)
    : bad(`关掉 features 之后 SERVICES 那两行不对：${JSON.stringify(svc(pf))} · 引用那行还在? ${refLine.test(pf)}`);
  svc(pNone).includes('"features"') && refLine.test(pNone)
    ? ok('反向臂：不关的时候 SERVICES 那行有 features、「写引用」那行在 ⟹ 上一格不是恒真')
    : bad('反向臂失败：不关也没有 features / 引用那行');
}
{
  // 服务详情页那一行也是写死的块名清单（第三处）。关掉 faq ⟹ 那一行里没有它，
  // 而同一行里别的块原样在（钉住「只拿掉被关的那个」）。#1425（T3）：faq-accordion → faq，cta-banner → cta；按词边界数。
  const p = promptFrom(work, basePayload({ disabledBlocks: ['faq'] }));
  const ruleLine = (src) => src.split('\n').find((l) => l.startsWith('- Each page needs 5-7 sections:')) || '';
  const off = ruleLine(p); const on = ruleLine(pNone);
  const has = (line, t) => new RegExp(`(^|[^a-z-])${t}([^a-z-]|$)`).test(line);
  off && !has(off, 'faq') && has(off, 'page-header') && has(off, 'cta')
    ? ok(`服务详情页那一行少了 faq，别的原样：${off.trim()}`)
    : bad(`服务详情页那一行不对：${JSON.stringify(off)}`);
  has(on, 'faq')
    ? ok('反向臂：不关的时候那一行里有它 ⟹ 上一格不是恒真')
    : bad('反向臂失败：不关也没有它');
}
{
  // 🔴 零行为的强证明 —— #1425（T3）换了基线：原来拿钉死的 `9d056fd7` 那棵树的提示词整份比（差异逐条登记）；
  //    本票按设计把提示词里的块名整批换掉，那份基线配今天的 blocks/ 已经吐不出提示词。换成**同一棵树两臂互比**：
  //    「什么都没关」vs「关掉 X」，两份提示词的每一处差异（按行 diff 切成段）都必须点名 X —— 只有那句现算的
  //    「There are N section types」可以不点名。它守的正是原来那一格要守的「关掉一个块只动它自己那几行」。
  //    两臂都关掉配方（`homepageFingerprint: false`）：配方的候选池随禁用清单变，轮换位会整体挪 ——
  //    那是配方自己的性质，由 `homepage-recipe.test.js` 盯着，不是这一格的读数。
  /** 按行 LCS diff，回连续变动段的数组（每段 = 删掉的行 + 加上的行）。 */
  const hunks = (a, b) => {
    const A = a.split('\n'); const B = b.split('\n');
    const n = A.length; const m = B.length;
    const L = Array.from({ length: n + 1 }, () => new Int32Array(m + 1));
    for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) {
      L[i][j] = A[i] === B[j] ? L[i + 1][j + 1] + 1 : Math.max(L[i + 1][j], L[i][j + 1]);
    }
    const out = []; let cur = null; let i = 0; let j = 0;
    const flush = () => { if (cur) { out.push(cur); cur = null; } };
    while (i < n || j < m) {
      if (i < n && j < m && A[i] === B[j]) { flush(); i++; j++; continue; }
      cur = cur || { del: [], add: [] };
      if (j < m && (i >= n || L[i][j + 1] >= L[i + 1][j])) cur.add.push(B[j++]);
      else cur.del.push(A[i++]);
    }
    flush();
    return out;
  };
  const COUNT_LINE = /There are \d+ section types/;
  const stray = (t, hs) => hs.filter((h) => {
    const text = [...h.del, ...h.add].join('\n');
    // 不分大小写：「4-6 FAQ items」那一格是产品有意绑在 faq 块上的（`contentAmountsRule`），说的就是它。
    if (new RegExp(`(^|[^a-z-])${t}([^a-z-]|$)`, 'i').test(text)) return false;
    return ![...h.del, ...h.add].every((l) => COUNT_LINE.test(l));
  });
  const pOffAll = promptFrom(work, basePayload({ homepageFingerprint: false }));
  const VICTIMS = ['faq', 'pricing', 'gallery'];
  const hs = {};
  for (const t of VICTIMS) {
    hs[t] = hunks(pOffAll, promptFrom(work, basePayload({ homepageFingerprint: false, disabledBlocks: [t] })));
    const bad1 = stray(t, hs[t]);
    hs[t].length && !bad1.length
      ? ok(`关掉 ${t}（配方关掉）⟹ 跟什么都没关比，${hs[t].length} 段差异每一段都点名 ${t}（或是那句块数）`)
      : bad(`关掉 ${t} 的差异不全是它自己的（${hs[t].length} 段，${bad1.length} 段没点名它）：`
        + `${bad1.slice(0, 2).map((h) => JSON.stringify(h).slice(0, 240)).join(' · ') || '一段差异都没有'}`);
  }
  // 判别力：拿「关掉 pricing」的差异去问「是不是都点名 faq」，必须有段答不上 ⟹ 上面那几格不是恒真。
  stray('faq', hs.pricing).length > 0
    ? ok(`判别力：把关掉 pricing 的差异记到 faq 头上，${stray('faq', hs.pricing).length} 段对不上 ⟹ 这把尺分得清是谁的差异`)
    : bad('判别力失败：关掉 pricing 的差异也全点名 faq ⟹ 这把尺什么都放过');
}

console.log('\n── ⑤ 池里全部关掉 ⟹ 干净失败，报文点名 ──');
{
  const r = runCreate(work, basePayload({ skipAI: true, disabledThemes: POOL }));
  const errs = eventsOf(r).filter((e) => e.event === 'error').map((e) => e.message);
  const named = errs.some((m) => m.includes(`all ${POOL.length} theme(s) in the pool are switched off`));
  r.status === 1 && named
    ? ok(`退出码 1，报文点名：${errs[0]}`)
    : bad(`没有干净失败：status=${r.status} errors=${JSON.stringify(errs)}`);
  const done = eventsOf(r).some((e) => e.event === 'complete' || e.event === 'done');
  !done
    ? ok('没有产出「建好了」那类事件（不静默建半个站）')
    : bad('池全关了还报了完成事件');
}
{
  // 点名一套被关掉的主题（`template` 字段那条整条绕过轮换的路）⟹ 自己那条拒绝分支。
  const r = runCreate(work, basePayload({ skipAI: true, template: POOL[0], disabledThemes: [POOL[0]] }));
  const errs = eventsOf(r).filter((e) => e.event === 'error').map((e) => e.message);
  r.status === 1 && errs.some((m) => m.includes(`Theme "${POOL[0]}" is switched off`))
    ? ok(`template 点名一套被关掉的主题 ⟹ 拒绝并点名：${errs[0]}`)
    : bad(`template 那条路没拦住：status=${r.status} errors=${JSON.stringify(errs)}`);
  const r2 = runCreate(work, basePayload({ skipAI: true, template: POOL[0], disabledThemes: [POOL[1]] }));
  r2.status === 0
    ? ok(`反向臂：template 点名一套【没被关】的主题 ⟹ 照常建出来（退出码 0）`)
    : bad(`反向臂失败：没被关的主题也被拒了，status=${r2.status}`);
}

// ── ⑥ 脚本自己硬插的那几块（不经菜单、不经校验器）─────────────────────────────────────────────
// #1425（T3）—— 旧库的 contact-form 删了，脚本硬插的那几块今天是 `contact`（`options.form: 'full'` 带表单）。
console.log('\n── ⑥ 脚本自己插的 contact：关掉之后它也让开 ──');
{
  // skipAI 真跑两趟，读磁盘上真写出来的页面 JSON —— 这一族的三处硬插（writeSiteConfig 那一处 +
  // getDemoConfig 两处）都只在写盘那一刻才存在，读提示词看不见它们。
  const run = (payload) => {
    const r = runCreate(work, payload);
    const dir = path.join(work, 'site', 'en', 'pages');
    const pages = fs.existsSync(dir) ? fs.readdirSync(dir).filter((n) => n.endsWith('.json')) : [];
    const byName = new Map(pages.map((n) => [n, JSON.parse(fs.readFileSync(path.join(dir, n), 'utf8'))]));
    const types = [...byName.values()].flatMap((pg) => (pg.blocks || pg.sections || []).map((b) => b.type));
    fs.rmSync(path.join(work, 'site'), { recursive: true, force: true });
    return { status: r.status, pages: [...byName.keys()].sort(), types };
  };
  const on = run(basePayload({ skipAI: true }));
  const off = run(basePayload({ skipAI: true, disabledBlocks: ['contact'] }));
  on.status === 0 && off.status === 0
    ? ok('两臂都建得出来（关掉一个块不该让建站失败）')
    : bad(`退出码不对: 不关 ${on.status} / 关掉 ${off.status}`);
  on.types.filter((t) => t === 'contact').length >= 1
    ? ok(`反向臂：不关的时候示例站里有 ${on.types.filter((t) => t === 'contact').length} 处 contact`)
    : bad('反向臂失败：不关也没有 contact —— 这一格没有判别力');
  off.types.includes('contact')
    ? bad(`关掉 contact，站里还有 ${off.types.filter((t) => t === 'contact').length} 处`)
    : ok('关掉 contact ⟹ 写出来的页面里 0 处');
  on.pages.includes('contact.json') && !off.pages.includes('contact.json')
    ? ok(`Contact 那一页整页不插（不关时的页面: ${on.pages.join(' ')} / 关掉后: ${off.pages.join(' ')}）`)
    : bad(`Contact 页那一格不对: 不关 ${on.pages.join(' ')} / 关掉 ${off.pages.join(' ')}`);
  // 剩下的页面一个都不能少 —— 「剔掉一个块」不许变成「少了几页」。
  const lost = on.pages.filter((n) => n !== 'contact.json' && !off.pages.includes(n));
  !lost.length
    ? ok('其余页面一页不少')
    : bad(`还少了这些页: ${lost.join(' ')}`);
}

// ── ⑧ 每个【页面块】逐个关一遍：CRITICAL RULES 那一段里一个都不许再点名（#1346 r3）────────────
//
// 🔴 **为什么要有这一节，而 ④ 那一格不够**：④ 只对 `faq-accordion` 一个块跑，而且数的是**带引号**
//    的命中。QA1 与 QA2 在 r2 上各自独立量到：32 个块逐个关一遍，**11 个**在提示词里仍被点名，
//    其中 6 行是祈使句（`- Use "divider" …` / `- Always start with "page-header". End with
//    "cta-banner"` / …）—— 而 `faq-accordion` 恰好属于残留 0 行的那 21 个。**一个块的抽样对
//    「32 个里有 11 个漏」按构造是盲的。**
//    📌 #1372 起块少了 4 个（32 → 28），上面那两个数是 #1346 当年的读数、原样留着；这一节自己
//    从 `blocks/` 现数，不吃这两个数。那行举例里的 `- Use "divider" …` 也随块一起删掉了。
//
// 🔴 **判据的射程写在这里，因为它不是「整份提示词 0 命中」**（那条更严的写法会要求删掉
//    `- "blog-preview" — variants: … "featured" (hero post + grid below)` 里的 "hero" 两个字，
//    而那是 blog-preview 自己那一格外观的说明）。这一节量的是 **CRITICAL RULES 那一段**，
//    也就是「命令模型怎么排版」的那些行。段外故意不量的两处，各有独立理由：
//      · 菜单（`AVAILABLE SECTION TYPES …` 那一段）本来就按启用集合生成，④ 已经钉着；
//        段内出现的别的块名是**另一个块**外观说明里的词。
//      · 页面原型清单（`- "gallery" — Portfolio or project showcase` / `- "testimonials" —
//        Customer reviews page`）点的是**页面**不是块 —— 同一份清单里还有 `about` / `quote` /
//        `menu` / `faq` / `contact`，这五个在 `blocks/` 里**一个 json 都没有**（现取）。
//        关掉 gallery 这个**块**不该让老板连 gallery 这个**页面**都不能有。
//      · 品牌名那条规矩（TICKET-137）里「hero headlines」是在举「内容出现在哪儿」的例子，
//        它不是 `- ` 开头的排版规则，也不在这一段里。
console.log('\n── ⑧ 每个页面块逐个关一遍：CRITICAL RULES 段里 0 点名 ──');
{
  const blocksDir = path.join(work, 'blocks');
  // #1387 —— 一个块一个文件夹：块名 = 文件夹名。
  const everyManifest = fs.readdirSync(blocksDir, { withFileTypes: true })
    .filter((e) => e.isDirectory()).map((e) => e.name).sort();
  // 🔴 **外壳区（顶栏 / 页脚）不进这一节的分母**（#1353）。这一节问的是「关掉一个块之后，命令模型
  //    排版的那几行还提不提它」，而外壳区**模型一个都点不到**：它们的 manifest 没有 `prompt` 段、
  //    不在菜单里、也不能写进 `sections`。留在分母里的后果是**误报**：CRITICAL RULES 里有两行把
  //    `header` / `footer` 当**普通英文词**用（"…they go in the footer only." / "…it won't be in the
  //    header nav…"，说的是导航位置），而这一节按块名做词边界匹配，读到的就是「关掉 footer 之后
  //    还被点名 1 行」—— 而产品侧没有任何东西要改。
  // 🔴 判据用 manifest 自己声明的 `region: true`（`block-manifest.js` §isRegionManifest），不在这里
  //    写第二份、更不写死名字：写死名字的话，下一个外壳区块进来时这一格会重新误报，而那时没人记得。
  const regionTypes = everyManifest.filter((t) => isRegionManifest(blocksDir, t));
  const allTypes = everyManifest.filter((t) => !regionTypes.includes(t));
  // 🔴 分母的下限：上面那条排除规则要是哪天把一大半块都排掉（比如有人给所有 manifest 写了
  //    `region: true`），下面每一格都会恒绿而没人看得见。这一句让那种情况当场 die(2)。
  // #1425（T3）—— 下限从 20 改成 12：新库 17 块、外壳 2 个 ⟹ 页面块 15 个（旧库是 28 − 2）。
  if (allTypes.length < 12) {
    die(`页面块只剩 ${allTypes.length} 个（外壳区排掉了 ${regionTypes.length} 个：${regionTypes.join(', ') || '无'}）`
      + ' —— 分母塌了，下面那些格什么都量不到');
  }
  console.log(`  📌 分母：${allTypes.length} 个页面块；外壳区排除 ${regionTypes.length} 个`
    + `（${regionTypes.join(', ') || '无'}，判据是 manifest 里的 region:true）`);
  const rulesSection = (prompt) => {
    const i = prompt.indexOf('\nCRITICAL RULES:');
    if (i < 0) die('提示词里找不到 CRITICAL RULES: —— 这一节什么都没量到');
    return prompt.slice(i);
  };
  // 词边界：`process-steps` 不许被 `process-steps-foo` 匹配，也不许 `hero` 命中 `hero-with-form`。
  // #1425（T3）—— 新库的块名大多是普通英文词（content / contact / cta / features …），所以两处收紧：
  //   ① 右边界也挡**大写字母**：`navigation.ctaPage` 是一个标识符，不是在点名 cta 块；
  //   ② 一张写明理由的豁免表（下面 EXEMPT）：那几行用的是同一个英文词、但说的不是这个块。每一条都要在
  //      「什么都没关」那份里真命中（死条目当场红），而且只豁免它点名的那一行，不豁免整个块。
  const nameRe = (t) => new RegExp(`(^|[^a-z-])${t}([^A-Za-z-]|$)`);
  const EXEMPT = [
    { t: 'content', line: /^- Include location names naturally in content\.$/, why: '「把地名自然地写进内容里」—— 英文词 content，不是 content 块' },
    { t: 'contact', line: /^- "forms" are the site's two lead forms/, why: '站级表单库（#1471）那一行：`"contact"` 是**表单的 id**（name / email / message 那张），不是 contact 块；关掉 contact 块不删那张表单（hero 也用它）' },
  ];
  const exempt = (t, l) => EXEMPT.some((e) => e.t === t && e.line.test(l.trim()));
  const linesNaming = (t, section) => section.split('\n').filter((l) => nameRe(t).test(l) && !exempt(t, l));
  const names = (section) => allTypes.filter((t) => linesNaming(t, section).length > 0);

  // #1425（T3）—— 豁免表不许有死条目：每一条都得在「什么都没关」那一段里真命中它说的那一行。
  {
    const sec = rulesSection(pNone).split('\n');
    const dead = EXEMPT.filter((e) => !sec.some((l) => e.line.test(l.trim()) && nameRe(e.t).test(l)));
    dead.length === 0
      ? ok(`豁免表 ${EXEMPT.length} 条每一条都真命中一行（${EXEMPT.map((e) => e.t).join(' / ')}）`)
      : bad(`豁免表里有 ${dead.length} 条死条目（那一行没了或不再含这个词）：${dead.map((e) => e.why).join(' · ')}`);
  }

  // 反向臂先跑：什么都没关时这一段**确实**点名了一批块 —— 否则下面逐块那些格量的是一段空气。
  const namedWhenAllOn = names(rulesSection(pNone));
  namedWhenAllOn.length >= 5
    ? ok(`反向臂：什么都没关时 CRITICAL RULES 段里点名了 ${namedWhenAllOn.length} 个块（${namedWhenAllOn.join(', ')}）`)
    : bad(`反向臂失败：这一段只点名了 ${namedWhenAllOn.length} 个块 —— 下面逐块那些格没有判别力`);

  const leaked = [];
  for (const t of allTypes) {
    const section = rulesSection(promptFrom(work, basePayload({ disabledBlocks: [t] })));
    const lines = linesNaming(t, section);
    if (lines.length) leaked.push(`${t}: ${lines.length} 行 · 第一行 ${JSON.stringify(lines[0].trim().slice(0, 90))}`);
  }
  leaked.length === 0
    ? ok(`分母 ${allTypes.length} 个块，逐个关掉之后 CRITICAL RULES 段里 0 点名`)
    : bad(`还有 ${leaked.length} 个块被点名:\n      ${leaked.join('\n      ')}`);

  // 被点名的那几个里，每一个单独关掉都要真的消失 —— 这是上面那一格的逐块拆解，
  // 它挡的是「整段被某个改动弄空了，于是 0 命中恒真」。
  const stillThere = namedWhenAllOn.filter((t) => {
    const section = rulesSection(promptFrom(work, basePayload({ disabledBlocks: [t] })));
    return linesNaming(t, section).length > 0;
  });
  stillThere.length === 0
    ? ok(`那 ${namedWhenAllOn.length} 个本来被点名的块，逐个关掉之后逐个消失`)
    : bad(`这些关掉之后仍被点名: ${stillThere.join(', ')}`);

  // 「一共有几种块」那句话（QA1 r2 第 1 条）：它是说给模型听的**目录事实**，关掉一个就当场变成假话。
  // 🔴 它数的是**页面块**，跟上面那个分母同一个口径（#1353）：外壳区不在菜单里、模型点不到，
  //    把它们算进这句话就是给模型报一个它用不上的数（`create-site.js` §offeredTypeCount 同款过滤）。
  // 📌 这句话后半原来还有一个 `130+ total variants`，#1419 随 AI 不再挑形态一起删了 ⟹ 这里按
  //    `There are N section types` 本身找那一行（原来按 `section types with` 找，那几个字已经不在了）。
  const typeCountIn = (prompt) => {
    const m = prompt.match(/There are (\d+) section types\b/);
    return m ? Number(m[1]) : null;
  };
  const all = typeCountIn(pNone);
  const three = ['gallery', 'testimonials', 'team'];   // #1372：原来这里是 divider / gallery / timeline；#1425（T3）：team-grid → team
  const less = typeCountIn(promptFrom(work, basePayload({ disabledBlocks: three })));
  all === allTypes.length
    ? ok(`什么都没关 ⟹ 那句话说 ${all} 种块，等于 blocks/ 里的页面块份数（外壳区 ${regionTypes.length} 个不算）`)
    : bad(`什么都没关时它说 ${all}，而 blocks/ 里的页面块是 ${allTypes.length} 份（外壳区 ${regionTypes.length} 个不算）`);
  less === allTypes.length - three.length
    ? ok(`关掉 ${three.length} 个 ⟹ 那句话跟着说 ${less}`)
    : bad(`关掉 ${three.length} 个之后它说 ${less}，应该是 ${allTypes.length - three.length}`);
}

// 📌 ⑦（`applyHeroLeadForm`，QA1 r1 第 2 条）**不在这里**，而且这是量出来的，不是省事：
//    它只跑在 **AI 那条路**上。`skipAI` 分支（`create-site.js` §`if (input.skipAI)`）有它自己的
//    `writeSiteConfig` 并在到达 `applyHeroLeadForm` 之前就 return 了 —— 本文件这套夹具全是 skipAI
//    真建站，按构造够不着它。我先按 ⑥ 的样子在这儿写了一节，正臂（「不关的时候首屏真的被换成
//    hero-with-form」）当场红，读到的是 `hero` ⟹ 夹具够不着被测代码。**那一格要是没写正臂，
//    两臂会读到同一个值而全绿**，而它证明的是零。
//    ⟹ 那三条臂搬去了 `hero-lead-form.test.js` 的 ⑦⑧（函数两向 + 接线），那里跑得到。

console.log(`\n${fail ? '❌' : '✅'} ${pass} 过 / ${fail} 失败`);
process.exit(fail ? 1 : 0);
