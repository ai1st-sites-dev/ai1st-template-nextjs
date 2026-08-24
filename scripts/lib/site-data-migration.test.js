#!/usr/bin/env node
'use strict';
/**
 * site-data-migration.test.js —— 升级时改写站数据那一步的承重性质（#1166 第 2 步 / AC1 / AC10）。
 *
 *   跑法:  node scripts/lib/site-data-migration.test.js  （或 `npm run test:scripts`，它按文件名发现）
 *   退出码: 0 全过 · 1 有失败 · 2 跑不起来（**不许当成通过**）
 *
 * ══ 这里守的是什么 ═════════════════════════════════════════════════════════════════════════════
 * 这一步的失败方向全是静默的，而且方向相反的两种都致命：
 *
 *   改少了 → 老类型名留在磁盘上，新模板不认识它，`SectionRenderer` 一句 console.warn + return null
 *            ⟹ 块从页面上消失，构建 exit 0，UI 报完成。真实付费客户（dexin.ca）身上有 6 个这种块。
 *   改多了 → 动了 AC1 没点名的东西。`data.variant` 被删掉，`theme-gallery/verify-applied.mjs`
 *            那一格就红在一件没发生的事上；正文文字被碰一个字节，就是改了客人的内容。
 *
 * 所以每一格都是「这一样变了」+「其余逐字节没变」两半一起断言。
 */

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const M = require('./site-data-migration.js');
const NEXT = path.resolve(__dirname, '..', '..');

// lastAliasTableWithLegacyRows —— 从 git 历史里取【最近一版还带老名字的】block-aliases.json（#1166 r4）。
//
// 为什么不读工作树那份：#1162（`9b789650`）把四个老名字从它里面删掉了，但**没有删这个文件** —— 留下
// `card-group` 自己那一行。所以工作树上它今天是一张「真别名 0 条」的表，拿它当参照物，⑤ 那两条断言会
// 报「values-grid 不在别名表里」，听起来像迁移表错了，其实是参照物被搬走了。
//
// 🔴 判据是「这一版里有没有真别名」，不是「文件在不在」，也不是某个写死的 sha。真别名 = 键跟它自己的
// `type` 不相等的那些行（`card-group: {type:'card-group'}` 是它本人，不是别名）。往回走 40 版足够：
// 删掉它的是 #1162，它的上一版就是 #1143（批 2，四行齐全）。
//
// 返回 `{ rev, table }`，取不到返回 null —— 调用方把 null 当**没量到**处理，不当通过。
function lastAliasTableWithLegacyRows(relPath) {
  const { execFileSync } = require('child_process');
  // 🔴 cwd 必须是仓根，不是 templates/nextjs：`git show <rev>:<path>` 的 path 是**相对仓根**的，
  // 而 rev-list 的 pathspec 相对 cwd —— 两个口径不一样，混着用的结果是「一版都找不到」，也就是
  // 上面那条「没量到」会在一切正常时也响。第一版就是这么错的。
  let root;
  try {
    root = execFileSync('git', ['rev-parse', '--show-toplevel'],
      { cwd: NEXT, encoding: 'utf-8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  } catch { return null; }
  const git = (args) => execFileSync('git', args, { cwd: root, encoding: 'utf-8', stdio: ['ignore', 'pipe', 'ignore'] });
  let revs;
  try {
    revs = git(['rev-list', '-n', '40', 'HEAD', '--', relPath]).split('\n').filter(Boolean);
  } catch { return null; }
  for (const rev of revs) {
    let table;
    try { table = JSON.parse(git(['show', `${rev}:${relPath}`])); } catch { continue; }
    const legacy = Object.entries(table).filter(([k, v]) => v && v.type !== k);
    if (legacy.length > 0) return { rev, table, __rev: rev };
  }
  return null;
}

let pass = 0; let fail = 0;
const ok = (m) => { pass += 1; console.log(`  ✅ ${m}`); };
const bad = (m) => { fail += 1; console.log(`  ❌ ${m}`); };
const check = (cond, m) => (cond ? ok(m) : bad(m));

// ── 造一棵只属于这一格的站树 ────────────────────────────────────────────────────────────────────
function makeSite(files) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mig-'));
  const siteDir = path.join(root, 'site');
  for (const [rel, doc] of Object.entries(files)) {
    const full = path.join(siteDir, rel);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, `${JSON.stringify(doc, null, 2)}\n`);
  }
  return { root, siteDir };
}
const read = (p) => JSON.parse(fs.readFileSync(p, 'utf-8'));
const bytes = (p) => fs.readFileSync(p);
const KNOWN = M.knownBlockTypes(NEXT);

// ══ ① 迁移表的每一行都真的改名，而且只改 AC1 点名的三样 ════════════════════════════════════════
console.log('① 四个老名字各迁一次：type 变、data 只动 highlights→items、role 相等就不写');
{
  const page = (type, data, extra = {}) => ({
    slug: 'p', title: 'P', navOrder: 1,
    blocks: [{ id: `b-${type}`, type, region: 'content', weight: 10, data, ...extra }],
  });
  const cases = [
    ['values-grid', { headline: 'H', items: [{ title: 'a' }], style: 'grid' }],
    ['benefits-list', { headline: 'H', subheadline: 'S', items: [{ title: 'a' }], variant: 'v1' }],
    ['checklist', { headline: 'H', items: ['甲', '乙'] }],
    ['service-highlights', { headline: 'H', highlights: [{ title: 'a' }], variant: 'v2' }],
  ];
  for (const [type, data] of cases) {
    const { siteDir } = makeSite({ [`pages/${type}.json`]: page(type, data) });
    const plan = M.planSiteMigration(siteDir, { rootDir: NEXT, knownTypes: KNOWN });
    if (plan.blockers.length) { bad(`${type}: 不该有 blocker，却有 ${plan.blockers.length} 个`); continue; }
    M.applyPlan(plan);
    const after = read(path.join(siteDir, `pages/${type}.json`)).blocks[0];
    const problems = [];
    if (after.type !== 'card-group') problems.push(`type=${after.type}`);
    // 🔴 今天这四行「老类型的 role」都等于 `card-group` 在今天那张表里的值 ⟹ 写与不写产物一样
    //    ⟹ 一个字节都不写（PM 在 #1166 三稿裁定里更正过；实测四个块产物 md5 补与不补相同）。
    //    「不等就要写」那一半由 ①c 钉着，两格合起来才是 roleToWrite 的完整性质。
    if ('role' in after) problems.push(`role 被写进了磁盘：${after.role}`);
    // 🔴 data 的对照是【逐键比】，不是「有没有 items」：改多了和改少了都要抓得住。
    const want = { ...data };
    if (type === 'service-highlights') { want.items = want.highlights; delete want.highlights; }
    if (JSON.stringify(after.data) !== JSON.stringify(want)) {
      problems.push(`data=${JSON.stringify(after.data)} want=${JSON.stringify(want)}`);
    }
    // 块自己的其它字段一个都不许动
    if (after.id !== `b-${type}` || after.region !== 'content' || after.weight !== 10) {
      problems.push('块的其它字段被动了');
    }
    check(problems.length === 0, `${type} → card-group${problems.length ? `：${problems.join(' · ')}` : ''}`);
  }
}

// ── ①b 块自己写了 role 时不许覆盖它 ─────────────────────────────────────────────────────────────
{
  const { siteDir } = makeSite({
    'pages/a.json': { slug: 'a', blocks: [{ type: 'checklist', role: 'essential', data: { items: ['x'] } }] },
  });
  const plan = M.planSiteMigration(siteDir, { rootDir: NEXT, knownTypes: KNOWN });
  M.applyPlan(plan);
  const b = read(path.join(siteDir, 'pages/a.json')).blocks[0];
  check(b.role === 'essential', `块自己写了 role 就不覆盖（读到 ${b.role}）`);
  check(plan.changes[0].roleAdded === null, '变更记录里 roleAdded 记成 null（没补）');
}

// ── ①c 补 role 这个能力还在：新类型今天那张表里的值跟老类型不一样时，必须写进去 ────────────────
//
// 🔴 这一格是 ① 的反向那一半。① 断言的是「今天这四行不写」，只有它的话，把 `roleToWrite` 整个
//    改成 `return null` 也全绿 —— 而迁移表后面还要加行（映射文档 §2 的批 3~6），下一批完全可能是
//    「老类型 essential → 新类型 optional」，那时不写就是静默改掉一个块的角色。
{
  const { siteDir } = makeSite({
    'pages/a.json': { slug: 'a', blocks: [{ type: 'checklist', data: { items: ['x'] } }] },
  });
  // 只动一个变量：假装今天那张表把 card-group 记成 essential（老类型仍是 optional）
  const roles = { ...M.blockRoles(NEXT), 'card-group': 'essential' };
  const plan = M.planSiteMigration(siteDir, { rootDir: NEXT, blockRoles: roles });
  M.applyPlan(plan);
  const b = read(path.join(siteDir, 'pages/a.json')).blocks[0];
  check(b.role === 'optional', `两边不等时把老类型那个角色写进磁盘（读到 role=${b.role}）`);
  check(plan.changes[0].roleAdded === 'optional', `变更记录里 roleAdded 记成 optional（读到 ${plan.changes[0].roleAdded}）`);
}

// ── ①d 新类型根本不在那张表里时，兜底是 essential ⟹ 也要写 ──────────────────────────────────────
{
  const roles = { ...M.blockRoles(NEXT) };
  delete roles['card-group'];
  check(M.roleToWrite({ to: 'card-group', role: 'optional' }, roles) === 'optional',
    '新类型不在 block-roles.json 里（兜底 essential）⟹ 要写');
  check(M.roleToWrite({ to: 'card-group', role: 'essential' }, roles) === null,
    '兜底 essential 而老类型也是 essential ⟹ 不写');
}

// ══ ② 老形状（sections 数组）和站级块库也要迁 ═══════════════════════════════════════════════════
console.log('\n② 三种载体都迁：blocks 数组 · sections 数组（#998 之前的站）· 站级块库');
{
  const { siteDir } = makeSite({
    'pages/legacy.json': { slug: 'l', sections: [{ type: 'values-grid', data: { headline: 'H' } }] },
    'en/pages/new.json': { slug: 'n', blocks: [{ type: 'benefits-list', data: { headline: 'H' } }] },
    'en/blocks/site-blocks.json': {
      'our-team': { type: 'service-highlights', visibility: '*', weight: 5, data: { highlights: [{ title: 't' }] } },
    },
  });
  const plan = M.planSiteMigration(siteDir, { rootDir: NEXT, knownTypes: KNOWN });
  check(plan.changes.length === 3, `三个载体各迁到一个块（读到 ${plan.changes.length}）`);
  M.applyPlan(plan);
  const legacy = read(path.join(siteDir, 'pages/legacy.json'));
  const fresh = read(path.join(siteDir, 'en/pages/new.json'));
  const lib = read(path.join(siteDir, 'en/blocks/site-blocks.json'));
  check(legacy.sections[0].type === 'card-group' && Array.isArray(legacy.sections) && !legacy.blocks,
    'sections 数组就地迁移，没有被改名成 blocks（老站不许被顺手升级形状）');
  check(fresh.blocks[0].type === 'card-group', 'blocks 数组迁了');
  check(lib['our-team'].type === 'card-group' && lib['our-team'].data.items && !lib['our-team'].data.highlights,
    '站级块库迁了，且 highlights 改叫 items');
  check(lib['our-team'].visibility === '*' && lib['our-team'].weight === 5, '站级块自己的 visibility / weight 没动');
}

// ══ ③ 没有老名字的站：一个字节都不许写 ═════════════════════════════════════════════════════════
console.log('\n③ 没有老名字的站 —— 文件逐字节不变（判据是根本没写，不是格式化碰巧一致）');
{
  const { siteDir } = makeSite({
    'pages/home.json': { slug: 'home', blocks: [{ type: 'hero', data: { headline: 'H' } }] },
    'pages/about.json': { slug: 'about', sections: [{ type: 'text-block', data: { body: 'x' } }] },
  });
  const before = { home: bytes(path.join(siteDir, 'pages/home.json')), about: bytes(path.join(siteDir, 'pages/about.json')) };
  const plan = M.planSiteMigration(siteDir, { rootDir: NEXT, knownTypes: KNOWN });
  const written = M.applyPlan(plan);
  check(plan.changes.length === 0 && plan.blockers.length === 0, '没有变更、没有 blocker');
  check(written.length === 0, `一个文件都没写（写了 ${written.length} 个）`);
  check(bytes(path.join(siteDir, 'pages/home.json')).equals(before.home)
    && bytes(path.join(siteDir, 'pages/about.json')).equals(before.about), '两份文件逐字节相同');
}

// ══ ④ 迁不了的一律不许升 —— 而且是在动任何文件【之前】中止 ══════════════════════════════════════
console.log('\n④ 未知类型 ⟹ 中止，且磁盘一个字节都没被动过（AC10 反向那一半）');
{
  const { siteDir } = makeSite({
    // 🔴 第一页有一个【能迁】的块，第二页才是那个未知类型。少了第一页，这一格就分不出
    //    「两阶段」和「边写边发现、只是恰好第一个就炸」——那正是它要守的性质。
    'pages/a.json': { slug: 'a', blocks: [{ type: 'values-grid', data: { headline: 'H' } }] },
    'pages/b.json': { slug: 'b', blocks: [{ type: 'no-such-block-type', data: { headline: 'H' } }] },
  });
  const pa = path.join(siteDir, 'pages/a.json');
  const pb = path.join(siteDir, 'pages/b.json');
  const before = { a: bytes(pa), b: bytes(pb) };
  const plan = M.planSiteMigration(siteDir, { rootDir: NEXT, knownTypes: KNOWN });
  check(plan.blockers.length === 1 && plan.blockers[0].type === 'no-such-block-type',
    `报出那个未知类型（${JSON.stringify(plan.blockers.map((b) => b.type))}）`);
  check(plan.blockers[0].file === pb && plan.blockers[0].index === 0,
    '报出是哪一页哪个块（file + index 都在）');
  let threw = false;
  try { M.applyPlan(plan); } catch { threw = true; }
  check(threw, 'applyPlan 拒绝动手（第二道，第一道在调用方）');
  check(bytes(pa).equals(before.a) && bytes(pb).equals(before.b),
    '🔴 两页都逐字节没变 —— 包括那一页【本来要迁】的（两阶段成立）');
}

// ══ ⑤ 迁移表自己带一份，不 require 被删的那个别名文件 ═══════════════════════════════════════════
console.log('\n⑤ 这张表不依赖 block-aliases.json（#1162 要删它；从它读 = 那天起静默失效）');
{
  const src = fs.readFileSync(path.join(__dirname, 'site-data-migration.js'), 'utf-8');
  const codeOnly = src.split('\n').filter((l) => !l.trim().startsWith('//')).join('\n');
  check(!/block-aliases/.test(codeOnly),
    '源码（去掉注释行）里不出现 block-aliases —— 表是自己带的');
  // 反向：这份自带的表必须跟它顶替的那层别名逐条一致 —— 不然它从出生就是错的。
  //
  // 🔴 权威从【工作树里的文件】改成了【git 历史里最后一版还带老名字的它】（#1166 r4）。上一版读的是
  // 工作树那份，并且用「文件还在不在」当能不能对照的判据 —— 而 #1162（`9b789650`）**没有删掉这个
  // 文件**，它只把四个老名字那几行删了，留下 `card-group` 自己那一行。于是判据答「文件在」、对照照跑，
  // 拿一张空表去比，两条断言双双变红：报的是「values-grid 不在别名表里」，听起来像我的表错了，其实是
  // 尺子的参照物被搬走了。#1162 落地当天这两格就会红，而它跟真出错长得一模一样。
  //
  // 🔴 换成历史之后这道对照【不会失效，也不会自愈成恒绿】：它现取「最近一次还带老名字的那一版」，
  // 也就是 #1143（批 2）那份，四行齐全。以后每合一批（批 3~6）都是干净改名、不再建别名，所以这个
  // 参照物就停在这里 —— 它是一份历史事实，不会腐烂。表里加新行而历史里没有对应别名时，下面
  // 「集合相等」那条会点名，那正是要它说话的时候。
  const aliasRelPath = 'templates/nextjs/src/lib/sections/block-aliases.json';
  const alias = lastAliasTableWithLegacyRows(aliasRelPath);
  if (alias) {
    const mism = [];
    for (const [from, row] of Object.entries(M.LEGACY_BLOCK_TYPES)) {
      const a = alias.table[from];
      if (!a) { mism.push(`${from} 不在别名表里`); continue; }
      if (a.type !== row.to) mism.push(`${from}: 别名说 → ${a.type}，我说 → ${row.to}`);
      if (a.role !== row.role) mism.push(`${from}: 别名 role=${a.role}，我 role=${row.role}`);
      const aliasRenames = Object.entries(a.data || {})
        .filter(([f, t]) => t && t !== f).map(([f, t]) => `${f}→${t}`).sort().join(',');
      const mine = Object.entries(row.rename).map(([f, t]) => `${f}→${t}`).sort().join(',');
      if (aliasRenames !== mine) mism.push(`${from}: 别名改名 [${aliasRenames}]，我 [${mine}]`);
    }
    check(mism.length === 0,
      `跟【最后一版带老名字的】别名表（${alias.__rev.slice(0, 8)}）逐条一致${mism.length ? `：${mism.join(' · ')}` : ''}`);
    // 🔴 别名表里除了这四行还有 `card-group` 自己那一行（键 == 它自己的 type），不是迁移对象。
    const aliasLegacy = Object.entries(alias.table).filter(([k, v]) => v.type !== k).map(([k]) => k).sort();
    check(JSON.stringify(aliasLegacy) === JSON.stringify(Object.keys(M.LEGACY_BLOCK_TYPES).sort()),
      `覆盖面：那一版里真正的别名有 ${aliasLegacy.length} 个，我的表有 ${Object.keys(M.LEGACY_BLOCK_TYPES).length} 个，集合相等`);
  } else {
    // 🔴 读不到历史 ≠ 对照通过。上一版这里是一句 `console.log` 的 📌，也就是「参照物没了就静默放行」——
    // 而这一节要挡的恰好是「表悄悄跟它顶替的那层分了叉」。仪器坏了要出声，不许算过。
    check(false,
      '🔴 这道对照【没能跑】：git 历史里找不到任何一版还带老名字的 block-aliases.json（试了最近 40 版）。'
      + '不是「一致」，是没量到 —— 在非 git 的导出树里跑就会这样，去有历史的检出里再跑一次。');
  }
}

// ══ ⑥ 「今天认得哪些类型」这个权威跟 registry 不许分叉 ═══════════════════════════════════════════
console.log('\n⑥ block-roles.json 的键集 == registry.ts 的键集（判「未知类型」用前者）');
{
  const reg = fs.readFileSync(path.join(NEXT, 'src', 'lib', 'sections', 'registry.ts'), 'utf-8');
  const body = reg.slice(reg.indexOf('sectionRegistry'));
  const regKeys = new Set([...body.matchAll(/^\s*'([a-z0-9-]+)':/gm)].map((m) => m[1]));
  const roleKeys = M.knownBlockTypes(NEXT);
  const onlyReg = [...regKeys].filter((k) => !roleKeys.has(k));
  const onlyRole = [...roleKeys].filter((k) => !regKeys.has(k));
  check(regKeys.size > 20, `registry 抠出来 ${regKeys.size} 个键（尺子没坏）`);
  check(onlyReg.length === 0 && onlyRole.length === 0,
    `两边键集相等（registry ${regKeys.size} · roles ${roleKeys.size}）`
    + `${onlyReg.length ? ` · 只在 registry: ${onlyReg}` : ''}${onlyRole.length ? ` · 只在 roles: ${onlyRole}` : ''}`);
}

console.log(`\n══ 汇总: 通过 ${pass} · 失败 ${fail} ══`);
process.exit(fail ? 1 : 0);
