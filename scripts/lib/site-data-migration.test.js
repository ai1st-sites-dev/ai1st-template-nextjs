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
 *   改多了 → 动了 AC1 没点名的东西。`data.variant` 被删掉 = 动了客人磁盘上的 data；正文文字被碰
 *            一个字节，就是改了客人的内容。
 *            📌 #1341 —— 这一句原来举的例子是「`theme-gallery/verify-applied.mjs` 那一格就红在一件
 *               没发生的事上」。那段逐块对账随内容结构那一维一起退役了，例子换成上面那半句。
 *
 * 所以每一格都是「这一样变了」+「其余逐字节没变」两半一起断言。
 */

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const M = require('./site-data-migration.js');
const NEXT = path.resolve(__dirname, '..', '..');

// 📌 #1425（T3）—— 这里原来是 `lastAliasTableWithLegacyRows`（从 git 历史取最后一版带老名字的 block-aliases.json，
//    供 ⑤ 逐条对照）。迁移表清空了（老站不迁移，Chris 2026-09-24，#1425 验收 6），⑤ 那道对照没有对象了，见 ⑤。

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

// ── 临时注入规则 ─────────────────────────────────────────────────────────────────────────────────
// 📌 #1425（T3）—— 两张表今天是空的（老站不迁移，Chris 2026-09-24，#1425 验收 6），原来 ①~④ 用的那几条真规则
//    （四个老名字 → `card-group`、带表单的 hero → `hero-with-form`）连同落点一起没了。机制（planSiteMigration /
//    applyPlan / roleToWrite）还在、下一次块改名还要用 ⟹ 这里往**导出的那两份表本身**临时塞规则（模块读的
//    就是这两个引用），跑完原样撤掉。落点一律用今天的块（`features` = essential · `content` = optional）。
const INJECT_TYPES = {
  'values-grid': { to: 'content', role: 'optional', rename: {} },
  'service-highlights': { to: 'features', role: 'essential', rename: { highlights: 'items' } },
};
const INJECT_SHAPE = {
  when: (b) => b.type === 'hero' && b.block_layout === 'with-form',
  to: 'hero', drop: ['block_layout'], data: { form: {} }, role: 'lead',
};
function withRules(fn, { types = INJECT_TYPES, shapes = [INJECT_SHAPE] } = {}) {
  Object.assign(M.LEGACY_BLOCK_TYPES, types);
  M.LEGACY_BLOCK_SHAPES.push(...shapes);
  try { return fn(); } finally {
    for (const k of Object.keys(types)) delete M.LEGACY_BLOCK_TYPES[k];
    M.LEGACY_BLOCK_SHAPES.splice(M.LEGACY_BLOCK_SHAPES.length - shapes.length, shapes.length);
  }
}
const EMPTY = () => Object.keys(M.LEGACY_BLOCK_TYPES).length === 0 && M.LEGACY_BLOCK_SHAPES.length === 0;

// ══ ⓪ 今天的表是空的 ⟹ 没有一个块被改写（#1425（T3））═════════════════════════════════════════
console.log('⓪ 两张迁移表今天是空的 ⟹ 带老名字的站：不改写、报 blocker、一个字节都不写');
{
  check(EMPTY(), `LEGACY_BLOCK_TYPES / LEGACY_BLOCK_SHAPES 都是空的（读到 ${Object.keys(M.LEGACY_BLOCK_TYPES).length} / ${M.LEGACY_BLOCK_SHAPES.length}）`);
  const { siteDir } = makeSite({
    'pages/a.json': { slug: 'a', blocks: [{ type: 'values-grid', data: { headline: 'H' } }, { type: 'features', data: {} }] },
  });
  const pa = path.join(siteDir, 'pages/a.json');
  const before = bytes(pa);
  const plan = M.planSiteMigration(siteDir, { rootDir: NEXT, knownTypes: KNOWN });
  check(plan.changes.length === 0, `没有变更（读到 ${plan.changes.length}）`);
  check(plan.blockers.length === 1 && plan.blockers[0].type === 'values-grid',
    `老名字被当成未知类型拦下（${JSON.stringify(plan.blockers.map((x) => x.type))}）`);
  let threw = false;
  try { M.applyPlan(plan); } catch { threw = true; }
  check(threw && bytes(pa).equals(before), 'applyPlan 拒绝动手，文件逐字节没变');
  // 反向对照：同一份站、同一个调用，表里有一条规则 ⟹ 当场改写 —— 证明上面的「0 变更」是空表挣来的。
  const { siteDir: s2 } = makeSite({ 'pages/a.json': { slug: 'a', blocks: [{ type: 'values-grid', data: { headline: 'H' } }] } });
  const plan2 = withRules(() => M.planSiteMigration(s2, { rootDir: NEXT, knownTypes: KNOWN }));
  check(plan2.changes.length === 1 && plan2.blockers.length === 0, `反向对照：注入一条规则 ⟹ 1 处变更 0 个 blocker（读到 ${plan2.changes.length} / ${plan2.blockers.length}）`);
  check(EMPTY(), '注入的规则跑完已撤掉（后面每一格都从空表开始）');
}

// ══ ① 一条规则真的改名，而且只改它点名的那几样 ═══════════════════════════════════════════════════
// 📌 #1425（T3）—— 这里原来是四个老名字各迁一次 → `card-group`；改成注入两条（一条带 data 改名）。
console.log('\n① 注入的规则各迁一次：type 变、data 只动 rename 点名的键、role 相等就不写');
{
  const page = (type, data, extra = {}) => ({
    slug: 'p', title: 'P', navOrder: 1,
    blocks: [{ id: `b-${type}`, type, region: 'content', weight: 10, data, ...extra }],
  });
  const cases = [
    ['values-grid', { headline: 'H', items: [{ title: 'a' }], style: 'grid' }],
    ['service-highlights', { headline: 'H', highlights: [{ title: 'a' }], variant: 'v2' }],
  ];
  for (const [type, data] of cases) {
    const { siteDir } = makeSite({ [`pages/${type}.json`]: page(type, data) });
    const plan = withRules(() => M.planSiteMigration(siteDir, { rootDir: NEXT, knownTypes: KNOWN }));
    if (plan.blockers.length) { bad(`${type}: 不该有 blocker，却有 ${plan.blockers.length} 个`); continue; }
    M.applyPlan(plan);
    const after = read(path.join(siteDir, `pages/${type}.json`)).blocks[0];
    const row = INJECT_TYPES[type];
    const problems = [];
    if (after.type !== row.to) problems.push(`type=${after.type}`);
    // 注入的 role 都等于落点在今天 block-roles.json 里的值 ⟹ 写与不写产物一样 ⟹ 不写（「不等就写」由 ①c 钉着）。
    if ('role' in after) problems.push(`role 被写进了磁盘：${after.role}`);
    // 🔴 data 的对照是【逐键比】：改多了和改少了都要抓得住。
    const want = { ...data };
    for (const [f, t] of Object.entries(row.rename)) { want[t] = want[f]; delete want[f]; }
    if (JSON.stringify(after.data) !== JSON.stringify(want)) {
      problems.push(`data=${JSON.stringify(after.data)} want=${JSON.stringify(want)}`);
    }
    if (after.id !== `b-${type}` || after.region !== 'content' || after.weight !== 10) problems.push('块的其它字段被动了');
    check(problems.length === 0, `${type} → ${row.to}${problems.length ? `：${problems.join(' · ')}` : ''}`);
  }
}

// ── ①b 块自己写了 role 时不许覆盖它 ─────────────────────────────────────────────────────────────
{
  const { siteDir } = makeSite({
    'pages/a.json': { slug: 'a', blocks: [{ type: 'values-grid', role: 'essential', data: { items: ['x'] } }] },
  });
  const plan = withRules(() => M.planSiteMigration(siteDir, { rootDir: NEXT, knownTypes: KNOWN }));
  M.applyPlan(plan);
  const b = read(path.join(siteDir, 'pages/a.json')).blocks[0];
  check(b.role === 'essential', `块自己写了 role 就不覆盖（读到 ${b.role}）`);
  check(plan.changes[0].roleAdded === null, '变更记录里 roleAdded 记成 null（没补）');
}

// ── ①c 补 role 这个能力还在：落点今天那张表里的值跟老类型不一样时，必须写进去 ─────────────────────
// 🔴 ① 的反向那一半。只有 ① 的话，把 `roleToWrite` 整个改成 `return null` 也全绿。
{
  const { siteDir } = makeSite({
    'pages/a.json': { slug: 'a', blocks: [{ type: 'values-grid', data: { items: ['x'] } }] },
  });
  // 只动一个变量：假装今天那张表把 content 记成 essential（注入规则的老类型仍是 optional）
  const roles = { ...M.blockRoles(NEXT), content: 'essential' };
  const plan = withRules(() => M.planSiteMigration(siteDir, { rootDir: NEXT, blockRoles: roles }));
  M.applyPlan(plan);
  const b = read(path.join(siteDir, 'pages/a.json')).blocks[0];
  check(b.role === 'optional', `两边不等时把老类型那个角色写进磁盘（读到 role=${b.role}）`);
  check(plan.changes[0].roleAdded === 'optional', `变更记录里 roleAdded 记成 optional（读到 ${plan.changes[0].roleAdded}）`);
}

// ── ①d 落点根本不在那张表里时，兜底是 essential ⟹ 也要写 ──────────────────────────────────────────
{
  const roles = { ...M.blockRoles(NEXT) };
  delete roles.content;
  check(M.roleToWrite({ to: 'content', role: 'optional' }, roles) === 'optional',
    '落点不在 block-roles.json 里（兜底 essential）⟹ 要写');
  check(M.roleToWrite({ to: 'content', role: 'essential' }, roles) === null,
    '兜底 essential 而老类型也是 essential ⟹ 不写');
}

// ══ ①e 带条件的规则（#1333 的机制）════════════════════════════════════════════════════════════════
// 📌 #1425（T3）—— 原来是真规则 hero + block_layout=with-form → `hero-with-form`（落点随旧库删了）。机制改用注入的
//    同形规则测：落点就是 `hero` 本身（去掉 block_layout、补 data.form），「不带条件的 hero 一个都不许碰」照旧承重。
console.log('\n①e 带条件的规则：只改符合 when 的那个块，同 type 的其它块逐字不动');
{
  const heroBlock = (extra = {}) => ({
    id: 'b-hero', type: 'hero', region: 'content', weight: 10,
    data: { headline: 'H', subheadline: 'S', ctaPrimary: { label: 'a', href: '/' }, ctaSecondary: { label: 'b', href: '/c' } },
    ...extra,
  });
  const { siteDir } = makeSite({
    'pages/home.json': { slug: 'home', title: 'Home', blocks: [heroBlock({ block_layout: 'with-form' }), heroBlock({ id: 'b-hero-plain' })] },
  });
  const beforePlain = JSON.stringify(read(path.join(siteDir, 'pages/home.json')).blocks[1]);
  const plan = withRules(() => M.planSiteMigration(siteDir, { rootDir: NEXT, knownTypes: KNOWN }));
  check(plan.blockers.length === 0 && plan.changes.length === 1, `没有 blocker、恰 1 处变更（读到 ${plan.blockers.length} / ${plan.changes.length}）`);
  M.applyPlan(plan);
  const after = read(path.join(siteDir, 'pages/home.json')).blocks;
  const problems = [];
  if (after[0].type !== 'hero') problems.push(`type=${after[0].type}`);
  if ('block_layout' in after[0]) problems.push(`block_layout 还在：${after[0].block_layout}`);
  const wantData = { ...heroBlock().data, form: {} };
  if (JSON.stringify(after[0].data) !== JSON.stringify(wantData)) problems.push(`data=${JSON.stringify(after[0].data)} want=${JSON.stringify(wantData)}`);
  if (after[0].id !== 'b-hero' || after[0].region !== 'content' || after[0].weight !== 10) problems.push('块的其它字段被动了');
  if ('role' in after[0]) problems.push(`role 被写进了磁盘：${after[0].role}`);
  check(problems.length === 0, `符合条件的那个 hero 被改写${problems.length ? `：${problems.join(' · ')}` : ''}`);
  check(JSON.stringify(after[1]) === beforePlain, '同一页里不符合条件的那个 hero 逐字相同');
  // 🔴 反向对照：判据砍成「只看 type」⟹ 两个 hero 全中 —— 证明上面那条绿是 when 那一半挣来的。
  const pair = [heroBlock({ block_layout: 'with-form' }), heroBlock()];
  const hit = pair.filter((b) => b.type === 'hero').length;
  const real = pair.filter((b) => INJECT_SHAPE.when(b)).length;
  check(hit === 2 && real === 1, `反向对照：只看 type ⟹ ${hit} 个全中；真判据 ⟹ 只中 ${real} 个`);
}

console.log('\n② 三种载体都迁：blocks 数组 · sections 数组（#998 之前的站）· 站级块库');
{
  const { siteDir } = makeSite({
    'pages/legacy.json': { slug: 'l', sections: [{ type: 'values-grid', data: { headline: 'H' } }] },
    'en/pages/new.json': { slug: 'n', blocks: [{ type: 'values-grid', data: { headline: 'H' } }] },
    'en/blocks/site-blocks.json': {
      'our-team': { type: 'service-highlights', visibility: '*', weight: 5, data: { highlights: [{ title: 't' }] } },
    },
  });
  const plan = withRules(() => M.planSiteMigration(siteDir, { rootDir: NEXT, knownTypes: KNOWN }));
  check(plan.changes.length === 3, `三个载体各迁到一个块（读到 ${plan.changes.length}）`);
  M.applyPlan(plan);
  const legacy = read(path.join(siteDir, 'pages/legacy.json'));
  const fresh = read(path.join(siteDir, 'en/pages/new.json'));
  const lib = read(path.join(siteDir, 'en/blocks/site-blocks.json'));
  check(legacy.sections[0].type === 'content' && Array.isArray(legacy.sections) && !legacy.blocks,
    'sections 数组就地迁移，没有被改名成 blocks（老站不许被顺手升级形状）');
  check(fresh.blocks[0].type === 'content', 'blocks 数组迁了');
  check(lib['our-team'].type === 'features' && lib['our-team'].data.items && !lib['our-team'].data.highlights,
    '站级块库迁了，且 highlights 改叫 items');
  check(lib['our-team'].visibility === '*' && lib['our-team'].weight === 5, '站级块自己的 visibility / weight 没动');
}

// ══ ③ 没有老名字的站：一个字节都不许写 ═════════════════════════════════════════════════════════
console.log('\n③ 没有老名字的站 —— 文件逐字节不变（判据是根本没写，不是格式化碰巧一致）');
{
  const { siteDir } = makeSite({
    'pages/home.json': { slug: 'home', blocks: [{ type: 'hero', data: { headline: 'H' } }] },
    // 📌 #1425（T3）—— 这里原来是 `text-block`，它随旧库删了（今天会被判成未知类型 ⟹ blocker），换成新库的 `content`。
    'pages/about.json': { slug: 'about', sections: [{ type: 'content', data: { body: 'x' } }] },
  });
  const before = { home: bytes(path.join(siteDir, 'pages/home.json')), about: bytes(path.join(siteDir, 'pages/about.json')) };
  // 🔴 带着注入的规则跑：空表下「0 变更」是白给的，要在「表里有规则、只是这站没碰上」时也不写。
  const plan = withRules(() => M.planSiteMigration(siteDir, { rootDir: NEXT, knownTypes: KNOWN }));
  const written = M.applyPlan(plan);
  check(plan.changes.length === 0 && plan.blockers.length === 0, '没有变更、没有 blocker');
  check(written.length === 0, `一个文件都没写（写了 ${written.length} 个）`);
  check(bytes(path.join(siteDir, 'pages/home.json')).equals(before.home)
    && bytes(path.join(siteDir, 'pages/about.json')).equals(before.about), '两份文件逐字节相同');
}

// ══ ④ 迁不了的一律不许升 —— 而且是在动任何文件【之前】中止 ══════════════════════════════════════
console.log('\n④ 未知类型 ⟹ 中止，且磁盘一个字节都没被动过（AC10 反向那一半）');
{
  // 🔴 第一页有一个【能迁】的块（注入规则下），第二页才是那个未知类型 —— 分得出「两阶段」和「边写边发现」。
  const { siteDir } = makeSite({
    'pages/a.json': { slug: 'a', blocks: [{ type: 'values-grid', data: { headline: 'H' } }] },
    'pages/b.json': { slug: 'b', blocks: [{ type: 'no-such-block-type', data: { headline: 'H' } }] },
  });
  const pa = path.join(siteDir, 'pages/a.json');
  const pb = path.join(siteDir, 'pages/b.json');
  const before = { a: bytes(pa), b: bytes(pb) };
  const plan = withRules(() => M.planSiteMigration(siteDir, { rootDir: NEXT, knownTypes: KNOWN }));
  check(plan.changes.length === 1, `第一页那个块确实在计划里要迁（读到 ${plan.changes.length}）—— 下面「没被写」才有意义`);
  check(plan.blockers.length === 1 && plan.blockers[0].type === 'no-such-block-type',
    `报出那个未知类型（${JSON.stringify(plan.blockers.map((b) => b.type))}）`);
  check(plan.blockers[0].file === pb && plan.blockers[0].index === 0, '报出是哪一页哪个块（file + index 都在）');
  let threw = false;
  try { M.applyPlan(plan); } catch { threw = true; }
  check(threw, 'applyPlan 拒绝动手（第二道，第一道在调用方）');
  check(bytes(pa).equals(before.a) && bytes(pb).equals(before.b),
    '🔴 两页都逐字节没变 —— 包括那一页【本来要迁】的（两阶段成立）');
}

// ══ ⑤ 迁移表自己带一份，不 require 被删的那个别名文件 ═══════════════════════════════════════════
console.log('\n⑤ 迁移模块不依赖 block-aliases.json（#1425 已删它；从它读 = require 当场炸）');
{
  const src = fs.readFileSync(path.join(__dirname, 'site-data-migration.js'), 'utf-8');
  const codeOnly = src.split('\n').filter((l) => !l.trim().startsWith('//')).join('\n');
  check(!/block-aliases/.test(codeOnly), '源码（去掉注释行）里不出现 block-aliases —— 表是自己带的');
  // 📌 #1425（T3）—— 这里原来还有一道「自带的表 == git 历史里最后一版带老名字的 block-aliases.json，逐条一致 +
  //    集合相等」。它守的是「自带表跟它顶替的那层别名分了叉」；今天两边都没了（表按裁定清空、别名层整层删），
  //    再比就是拿空表去对一份历史文件、恒红，删掉。
}

// ══ ⑥ 「今天认得哪些类型」这个权威跟 registry 不许分叉 ═══════════════════════════════════════════
console.log('\n⑥ block-roles.json 的键集 == registry.ts 的键集（判「未知类型」用前者）');
{
  const reg = fs.readFileSync(path.join(NEXT, 'src', 'lib', 'sections', 'registry.generated.ts'), 'utf-8');
  const body = reg.slice(reg.indexOf('sectionRegistry'));
  const regKeys = new Set([...body.matchAll(/^\s*'([a-z0-9-]+)':/gm)].map((m) => m[1]));
  const roleKeys = M.knownBlockTypes(NEXT);
  const onlyReg = [...regKeys].filter((k) => !roleKeys.has(k));
  const onlyRole = [...roleKeys].filter((k) => !regKeys.has(k));
  // 📌 #1425（T3）—— 原来是「> 20」（旧库 40+ 块时的尺子自检）；块库收成 17 个、页面块 15 个之后那个门槛
  //    恒红。改成跟一个不同源的读数比：blocks/ 下 manifest 里不是外壳区（region:true）的那几个。
  const pageManifests = [...require('./block-manifest.js').loadManifests(path.join(NEXT, 'blocks')).values()]
    .filter((m) => m.region !== true).length;
  check(regKeys.size > 0 && regKeys.size === pageManifests,
    `registry 抠出来 ${regKeys.size} 个键 == blocks/ 下非外壳区 manifest ${pageManifests} 个（尺子没坏）`);
  check(onlyReg.length === 0 && onlyRole.length === 0,
    `两边键集相等（registry ${regKeys.size} · roles ${roleKeys.size}）`
    + `${onlyReg.length ? ` · 只在 registry: ${onlyReg}` : ''}${onlyRole.length ? ` · 只在 roles: ${onlyRole}` : ''}`);
}

// ══ ⑦ 迁移表的每个落点今天都认得（#1425（T3））═══════════════════════════════════════════════════
// 🔴 迁到一个今天不存在的类型 = 文件头那句「改少了」的失败原样重演：块从页面上消失，构建 exit 0。
//    #1425 删旧库时 `card-group` / `hero-with-form` 就是这样落空的。今天表是空的 ⟹ 真表那一臂是空集（不算数），
//    尺子本身用注入的两臂证：指向已删块的规则必须被点名，指向现役块的必须放行。
console.log('\n⑦ LEGACY_BLOCK_TYPES / LEGACY_BLOCK_SHAPES 的每个 to 都是今天认得的页面块');
{
  const deadTargets = () => [
    ...Object.entries(M.LEGACY_BLOCK_TYPES).map(([from, r]) => [from, r.to]),
    ...M.LEGACY_BLOCK_SHAPES.map((r) => ['(shape rule)', r.to]),
  ].filter(([, to]) => !KNOWN.has(to)).map(([f, to]) => `${f}→${to}`);
  const realCount = Object.keys(M.LEGACY_BLOCK_TYPES).length + M.LEGACY_BLOCK_SHAPES.length;
  const realDead = deadTargets();
  check(realDead.length === 0, `真表 ${realCount} 条规则，落点全在今天的块库里${realDead.length ? `：不在的 ${realDead.join(' · ')}` : ''}`);
  const deadArm = withRules(deadTargets, {
    types: { 'values-grid': { to: 'card-group', role: 'optional', rename: {} } },
    shapes: [{ ...INJECT_SHAPE, to: 'hero-with-form' }],
  });
  check(deadArm.length === 2 && deadArm.includes('values-grid→card-group') && deadArm.includes('(shape rule)→hero-with-form'),
    `反向臂：注入两条指向已删块的规则 ⟹ 两条都被点名（读到 ${JSON.stringify(deadArm)}）`);
  const liveArm = withRules(() => ({ n: Object.keys(M.LEGACY_BLOCK_TYPES).length + M.LEGACY_BLOCK_SHAPES.length, dead: deadTargets() }));
  check(liveArm.n === 3 && liveArm.dead.length === 0, `正臂：注入 ${liveArm.n} 条指向现役块的规则 ⟹ 0 条被点名（读到 ${JSON.stringify(liveArm.dead)}）`);
  check(EMPTY(), '注入的规则跑完已撤掉');
}

console.log(`\n══ 汇总: 通过 ${pass} · 失败 ${fail} ══`);
process.exit(fail ? 1 : 0);
