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
 * 🔴 **零行为那一格的基线是钉死的一个 commit（下面的 `BASELINE`），不是 `origin/main`**（r2 改的）。
 *    r1 写的是 `origin/main`，而它**会移动**：2026-09-16 13:42 那次推送让这一格拿 main 的 scripts
 *    去配这棵树的 `blocks/`，基线那份 `loadManifests` 当场抛、整份测试 `die(2)` —— ⑤⑥ 两节根本没
 *    跑到（同一条命令 13:39 rc=0、13:42 之后 rc=2）。`homepage-recipe.test.js` 的文件头（#1034 r2）
 *    为同一件事写过明文规矩，理由逐字是「下一个改 templates 的人会收到跟他无关的红」。
 *    **维护约定**：这一格哪天真的对不上了，先问「OFF 那条路的字节为什么变了」；确实该变，就把
 *    `BASELINE` 往前挪一格**并在票上说明**，而不是把这一格删掉、也不是改回一个会动的 ref。
 */

'use strict';

// 「改动之前」= 本票开工时那个 commit（本票交付的 base）。为什么是钉死的、怎么维护：见文件头最后一条。
const BASELINE = '9d056fd7';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync, spawnSync } = require('child_process');

let pass = 0; let fail = 0;
const ok = (m) => { pass++; console.log(`  ✅ ${m}`); };
const bad = (m) => { fail++; console.log(`  ❌ ${m}`); };
const die = (m) => { console.error(`🔴 跑不起来: ${m}`); process.exit(2); };

const NEXT = path.resolve(__dirname, '..', '..');
const REPO = path.resolve(NEXT, '..', '..');
const REL = 'templates/nextjs';

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
const REQ_STAR = [...manifests.values()].filter((m) => ((m.industries || {}).required || []).includes('*')).map((m) => m.type);
if (!REQ_STAR.length) die('没有一个块写着 industries.required 含 "*" —— ② 那两格的语料没了');
{
  const t = REQ_STAR[0];
  // 一个**没有**那个块的站。这正是「菜单剔掉它 ⟹ 模型不放它」之后的形状。
  const pages = [{ slug: 'home', sections: [{ type: 'hero', data: { headline: 'x', subheadline: 'y' } }] }];
  const withList = validateSite({ pages, industry: 'dental clinic', disabledBlocks: [t] });
  const without = validateSite({ pages, industry: 'dental clinic' });
  const hits = (r) => r.problems.filter((p) => p.includes(`"${t}"`)).length;
  hits(withList) === 0
    ? ok(`关掉 ${t}（required: "*"）⟹ 「整个站里没有它」不再报 problem`)
    : bad(`关掉 ${t}，它还在报：${withList.problems.join(' | ')}`);
  hits(without) >= 1
    ? ok(`反向臂：不传清单，同一份页面报「整个站里没有 "${t}"」⟹ 上一格不是恒真（这就是 create-site.js 那句 fatal 的来源）`)
    : bad(`反向臂失败：不传清单也不报 "${t}" —— 上一格没有判别力`);
}
{
  const t = 'faq-accordion';
  if (!manifests.has(t)) die(`blocks/${t}.json 不在了 —— 这一格的语料要换一个块`);
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
  const t = REQ_STAR[0];
  const pages = [{ slug: 'home', sections: [{ type: 'hero', data: { headline: 'x', subheadline: 'y' } }] }];
  const build = validateSite({ pages, industry: 'dental clinic', scope: 'build' });
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
{
  const withBarAt = [];
  for (let i = 0; i < 24; i++) withBarAt.push(homepageRecipe(i, manifests, 'dental clinic').withBar);
  const off = [];
  for (let i = 0; i < 24; i++) off.push(homepageRecipe(i, manifests, 'dental clinic', ['announcement-bar']).withBar);
  withBarAt.some(Boolean) && !off.some(Boolean)
    ? ok('关掉 announcement-bar ⟹ 24 份配方一份都不带它（不关时带 ' + withBarAt.filter(Boolean).length + ' 份）')
    : bad(`announcement-bar 那一格不对: 不关 ${withBarAt.filter(Boolean).length} 份带它 / 关掉 ${off.filter(Boolean).length} 份带它`);
}
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

/** 造一棵「某个版本的 scripts/」的树；blocks / node_modules / src 软链今天这份（两臂共用数据）。 */
function treeAt(ref) {
  const root = path.join(tmp, ref === null ? 'work' : 'base');
  fs.mkdirSync(root, { recursive: true });
  if (ref === null) {
    execFileSync('cp', ['-a', path.join(NEXT, 'scripts'), root]);
  } else {
    const files = execFileSync('git', ['ls-tree', '-r', '--name-only', ref, '--', `${REL}/scripts`],
      { cwd: REPO }).toString().trim().split('\n').filter(Boolean);
    if (!files.length) die(`${ref} 上没有 ${REL}/scripts —— ls-tree 读到 0 个文件`);
    for (const f of files) {
      const out = path.join(root, f.slice(REL.length + 1));
      fs.mkdirSync(path.dirname(out), { recursive: true });
      fs.writeFileSync(out, execFileSync('git', ['show', `${ref}:${f}`], { cwd: REPO, maxBuffer: 64 << 20 }));
    }
  }
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

const work = treeAt(null);

console.log('\n── ④ 提示词：关掉的块三处都不再提它 ──');
const pNone = promptFrom(work, basePayload());
{
  const pEmpty = promptFrom(work, basePayload({ disabledThemes: [], disabledBlocks: [] }));
  pNone === pEmpty
    ? ok('字段缺席 与 传两个空数组 ⟹ 提示词逐字节相同（老 manager 那条路不变）')
    : bad('空清单改变了提示词的字节');
}
{
  const t = 'faq-accordion';
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
  // 写死的那两行页面规则：关掉 quote-form ⟹ 它从 QUOTE 那行消失、data 那一行整条不印，
  // 而同一行里的 page-header 仍在（钉住「只拿掉被关的那个，不是整行删了」）。
  const p = promptFrom(work, basePayload({ disabledBlocks: ['quote-form'] }));
  const quoteLine = p.split('\n').find((l) => l.startsWith('- QUOTE pages must include:')) || '';
  quoteLine.includes('"page-header"') && !quoteLine.includes('"quote-form"')
    ? ok(`关掉 quote-form ⟹ QUOTE 那行只剩 page-header：${quoteLine.trim()}`)
    : bad(`QUOTE 那行不对：${JSON.stringify(quoteLine)}`);
  !/^\s+quote-form data: \{/m.test(p)
    ? ok('关掉 quote-form ⟹ 它那行 data 形状整条不印')
    : bad('关掉 quote-form，它那行 data 形状还在');
  /^\s+quote-form data: \{/m.test(pNone)
    ? ok('反向臂：不关的时候那行 data 形状在 ⟹ 上一格不是恒真')
    : bad('反向臂失败：不关也没有那行');
}
{
  // 服务详情页那一行也是写死的块名清单（第三处）。关掉 faq-accordion ⟹ 那一行里没有它，
  // 而同一行里别的块原样在（钉住「只拿掉被关的那个」）。
  const p = promptFrom(work, basePayload({ disabledBlocks: ['faq-accordion'] }));
  const ruleLine = (src) => src.split('\n').find((l) => l.startsWith('- Each page needs 5-7 sections:')) || '';
  const off = ruleLine(p); const on = ruleLine(pNone);
  off && !off.includes('faq-accordion') && off.includes('page-header') && off.includes('cta-banner')
    ? ok(`服务详情页那一行少了 faq-accordion，别的原样：${off.trim()}`)
    : bad(`服务详情页那一行不对：${JSON.stringify(off)}`);
  on.includes('faq-accordion')
    ? ok('反向臂：不关的时候那一行里有它 ⟹ 上一格不是恒真')
    : bad('反向臂失败：不关也没有它');
}
{
  // 🔴 零行为的强证明：不传字段那一臂，跟**改动之前**那棵树的 scripts 逐字节相同。
  //    上面「空数组 == 缺席」两臂跑的是同一份代码，它证明不了「跟改之前一样」。
  //
  // 🔴 基线是钉死的 `BASELINE`（模块顶部），**不是 `origin/main`** —— 一个会移动的 ref 会让这一格
  //    在别人推送之后整份 `die(2)`。完整来历与维护约定在文件头最后一条。
  //
  // 🔴 为什么钉本票的 base：它那份 scripts 跟这棵树的 `blocks/` 是同一个时代的，配得起来；而「改动
  //    之前」这件事本来就该拿本票开工那一刻去问。往后 rebase 到任何 main 上也不会动摇它 —— 基线那份
  //    校验器对**多出来的** manifest 键是宽容的（只查它认识的那几个），新加的 `displayName` 不会让它抛。
  let baseRoot = '';
  try { baseRoot = treeAt(BASELINE); } catch (e) { baseRoot = ''; console.log(`  ⚠️  取不到基线那棵树 ${BASELINE}（${e.message}）`); }
  if (baseRoot) {
    const pBase = promptFrom(baseRoot, basePayload());
    pBase === pNone
      ? ok(`不传禁用清单 ⟹ 提示词跟基线 ${BASELINE} 那棵树逐字节相同`)
      : bad(`不传禁用清单，提示词跟基线 ${BASELINE} 不一样（长度 ${pBase.length} vs ${pNone.length}）`);
  }
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
console.log('\n── ⑥ 脚本自己插的 contact-form：关掉之后它也让开 ──');
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
  const off = run(basePayload({ skipAI: true, disabledBlocks: ['contact-form'] }));
  on.status === 0 && off.status === 0
    ? ok('两臂都建得出来（关掉一个块不该让建站失败）')
    : bad(`退出码不对: 不关 ${on.status} / 关掉 ${off.status}`);
  on.types.filter((t) => t === 'contact-form').length >= 1
    ? ok(`反向臂：不关的时候示例站里有 ${on.types.filter((t) => t === 'contact-form').length} 处 contact-form`)
    : bad('反向臂失败：不关也没有 contact-form —— 这一格没有判别力');
  off.types.includes('contact-form')
    ? bad(`关掉 contact-form，站里还有 ${off.types.filter((t) => t === 'contact-form').length} 处`)
    : ok('关掉 contact-form ⟹ 写出来的页面里 0 处');
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
  const everyManifest = fs.readdirSync(blocksDir)
    .filter((n) => n.endsWith('.json')).map((n) => n.replace(/\.json$/, '')).sort();
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
  if (allTypes.length < 20) {
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
  const names = (section) => allTypes.filter((t) => new RegExp(`(^|[^a-z-])${t}([^a-z-]|$)`).test(section));

  // 反向臂先跑：什么都没关时这一段**确实**点名了一批块 —— 否则下面逐块那些格量的是一段空气。
  const namedWhenAllOn = names(rulesSection(pNone));
  namedWhenAllOn.length >= 5
    ? ok(`反向臂：什么都没关时 CRITICAL RULES 段里点名了 ${namedWhenAllOn.length} 个块（${namedWhenAllOn.join(', ')}）`)
    : bad(`反向臂失败：这一段只点名了 ${namedWhenAllOn.length} 个块 —— 下面逐块那些格没有判别力`);

  const leaked = [];
  for (const t of allTypes) {
    const section = rulesSection(promptFrom(work, basePayload({ disabledBlocks: [t] })));
    const lines = section.split('\n').filter((l) => new RegExp(`(^|[^a-z-])${t}([^a-z-]|$)`).test(l));
    if (lines.length) leaked.push(`${t}: ${lines.length} 行 · 第一行 ${JSON.stringify(lines[0].trim().slice(0, 90))}`);
  }
  leaked.length === 0
    ? ok(`分母 ${allTypes.length} 个块，逐个关掉之后 CRITICAL RULES 段里 0 点名`)
    : bad(`还有 ${leaked.length} 个块被点名:\n      ${leaked.join('\n      ')}`);

  // 被点名的那几个里，每一个单独关掉都要真的消失 —— 这是上面那一格的逐块拆解，
  // 它挡的是「整段被某个改动弄空了，于是 0 命中恒真」。
  const stillThere = namedWhenAllOn.filter((t) => {
    const section = rulesSection(promptFrom(work, basePayload({ disabledBlocks: [t] })));
    return new RegExp(`(^|[^a-z-])${t}([^a-z-]|$)`).test(section);
  });
  stillThere.length === 0
    ? ok(`那 ${namedWhenAllOn.length} 个本来被点名的块，逐个关掉之后逐个消失`)
    : bad(`这些关掉之后仍被点名: ${stillThere.join(', ')}`);

  // 「一共有几种块」那句话（QA1 r2 第 1 条）：它是说给模型听的**目录事实**，关掉一个就当场变成假话。
  // 🔴 它数的是**页面块**，跟上面那个分母同一个口径（#1353）：外壳区不在菜单里、模型点不到，
  //    把它们算进这句话就是给模型报一个它用不上的数（`create-site.js` §offeredTypeCount 同款过滤）。
  // 🔴 后半句那个 `130+` 故意没动，理由写在 `create-site.js` §offeredTypeCount 旁边（全仓 variants
  //    加起来今天是 112，也就是这句话在本票之前就多报了 —— 圈外，动它会让「什么都没关 ⟹ 逐字节
  //    不变」变红）。这一格只钉前半句的那个数。
  const typeCountIn = (prompt) => {
    const line = prompt.split('\n').find((l) => l.includes('section types with')) || '';
    const m = line.match(/There are (\d+) section types/);
    return m ? Number(m[1]) : null;
  };
  const all = typeCountIn(pNone);
  const three = ['divider', 'gallery', 'timeline'];
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
