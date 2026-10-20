#!/usr/bin/env node
'use strict';
/**
 * site-data-migration.test.js —— 「更新网站」那一步对站数据做的检查（#1166 第 2 步 / AC10）。
 *
 *   跑法:  node scripts/lib/site-data-migration.test.js  （或 `npm run test:scripts`，它按文件名发现）
 *   退出码: 0 全过 · 1 有失败 · 2 跑不起来（**不许当成通过**）
 *
 * 📌 #1916 —— 块改名机器（两张迁移表 + 改写函数）从这份模块里删了，块的数据迁移只走 `lib/block-migrations.js`。
 *    原来的 ⓪ / ① / ①b~①e / ⑦ 只测改名（注入规则、补角色那个判断、表的落点）一起删；② ③ ④ 原来靠注入规则，改写成不靠它。
 *
 * ══ 这里守的是什么 ═════════════════════════════════════════════════════════════════════════════
 * 失败方向是静默的：今天的模板不认识的块类型留在磁盘上，`SectionRenderer` 一句 console.warn + return null
 * ⟹ 块从页面上消失，构建 exit 0，UI 报完成。所以认不出就整站不升，而且在动任何文件【之前】中止；
 * 认得的站不许被碰一个字节。
 */

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
const bytes = (p) => fs.readFileSync(p);
const KNOWN = M.knownBlockTypes(NEXT);

// 📌 #1916 —— 原来是「三种载体都迁」（注入改名规则）。改名没了，同一个 §blocksOf 现在管的是「三种载体都查」。
console.log('\n② 三种载体都查：blocks 数组 · sections 数组（#998 之前的站）· 站级块库 —— 认不出的类型三处都报');
{
  const { siteDir } = makeSite({
    'pages/legacy.json': { slug: 'l', sections: [{ type: 'content', data: { body: 'x' } }, { type: 'gone-1', data: {} }] },
    'en/pages/new.json': { slug: 'n', blocks: [{ id: 'b-ok', type: 'features', data: {} }, { id: 'b-gone', type: 'gone-2', data: {} }] },
    'en/blocks/site-blocks.json': {
      'our-team': { type: 'gone-3', visibility: '*', weight: 5, data: {} },
      'ok-one': { type: 'faq', visibility: '*', weight: 6, data: {} },
    },
  });
  const plan = M.planSiteMigration(siteDir, { rootDir: NEXT, knownTypes: KNOWN });
  const got = plan.blockers.map((b) => `${path.relative(siteDir, b.file)}:${b.type}`).sort();
  check(JSON.stringify(got) === JSON.stringify(['en/blocks/site-blocks.json:gone-3', 'en/pages/new.json:gone-2', 'pages/legacy.json:gone-1']),
    `三个载体各报出它那一个认不出的块，认得的三个不报（读到 ${JSON.stringify(got)}）`);
  const byFile = Object.fromEntries(plan.blockers.map((b) => [path.basename(b.file), b]));
  check(!!byFile['legacy.json'] && byFile['legacy.json'].index === 1 && !!byFile['new.json'] && byFile['new.json'].id === 'b-gone',
    '数组载体报出下标、有 id 的报出 id（老板那句话里点名的就是它们）');
}

// ══ ③ 全认得、没东西要补的站：一个字节都不许写 ═════════════════════════════════════════════════════════
console.log('\n③ 全认得、没东西要补的站 —— 文件逐字节不变（判据是根本没写，不是格式化碰巧一致）');
{
  const { siteDir } = makeSite({
    'pages/home.json': { slug: 'home', blocks: [{ type: 'hero', data: { headline: 'H' } }] },
    // 📌 #1425（T3）—— 这里原来是 `text-block`，它随旧库删了（今天会被判成未知类型 ⟹ blocker），换成新库的 `content`。
    'pages/about.json': { slug: 'about', sections: [{ type: 'content', data: { body: 'x' } }] },
  });
  const before = { home: bytes(path.join(siteDir, 'pages/home.json')), about: bytes(path.join(siteDir, 'pages/about.json')) };
  const plan = M.planSiteMigration(siteDir, { rootDir: NEXT, knownTypes: KNOWN });
  const written = M.applyPlan(plan);
  check(plan.files.every((f) => !f.changed) && plan.blockers.length === 0, '没有要改的文件、没有 blocker');
  check(written.length === 0, `一个文件都没写（写了 ${written.length} 个）`);
  check(bytes(path.join(siteDir, 'pages/home.json')).equals(before.home)
    && bytes(path.join(siteDir, 'pages/about.json')).equals(before.about), '两份文件逐字节相同');
}

// ══ ④ 迁不了的一律不许升 —— 而且是在动任何文件【之前】中止 ══════════════════════════════════════
console.log('\n④ 未知类型 ⟹ 中止，且磁盘一个字节都没被动过（AC10 反向那一半）');
{
  // 🔴 第一页【本来要写】（关键词页，#1639 那一组回链要补），第二页才是那个未知类型 —— 分得出「两阶段」和「边写边发现」。
  //    📌 #1916 前「本来要写」靠注入一条改名规则；改名没了，今天会让一份文件被写的只剩回链回填。
  const { siteDir } = makeSite({
    'pages/a.json': { slug: 'services/brakes/brake-pads', title: 'Brake pads', keywordPage: true,
      blocks: [{ id: 'a-h', type: 'page-header', data: { headline: 'H' } }, { id: 'a-c', type: 'content', data: { body: 'x' } }] },
    'pages/b.json': { slug: 'b', blocks: [{ type: 'no-such-block-type', data: { headline: 'H' } }] },
  });
  const pa = path.join(siteDir, 'pages/a.json');
  const pb = path.join(siteDir, 'pages/b.json');
  const before = { a: bytes(pa), b: bytes(pb) };
  const plan = M.planSiteMigration(siteDir, { rootDir: NEXT, knownTypes: KNOWN });
  const fa = plan.files.find((f) => f.file === pa);
  check(!!fa && fa.changed && plan.related.length === 1, `第一页确实在计划里要写（related ${plan.related.length}）—— 下面「没被写」才有意义`);
  check(plan.blockers.length === 1 && plan.blockers[0].type === 'no-such-block-type',
    `报出那个未知类型（${JSON.stringify(plan.blockers.map((b) => b.type))}）`);
  check(plan.blockers.length > 0 && plan.blockers[0].file === pb && plan.blockers[0].index === 0, '报出是哪一页哪个块（file + index 都在）');
  let threw = false;
  try { M.applyPlan(plan); } catch { threw = true; }
  check(threw, 'applyPlan 拒绝动手（第二道，第一道在调用方）');
  check(bytes(pa).equals(before.a) && bytes(pb).equals(before.b),
    '🔴 两页都逐字节没变 —— 包括那一页【本来要写】的（两阶段成立）');
}

// ══ ⑤ 不 require 被删的那个别名文件 ═══════════════════════════════════════════
console.log('\n⑤ 这份模块不依赖 block-aliases.json（#1425 已删它；从它读 = require 当场炸）');
{
  const src = fs.readFileSync(path.join(__dirname, 'site-data-migration.js'), 'utf-8');
  const codeOnly = src.split('\n').filter((l) => !l.trim().startsWith('//')).join('\n');
  check(!/block-aliases/.test(codeOnly), '源码（去掉注释行）里不出现 block-aliases');
  // 📌 #1425（T3）—— 这里原来还有一道「自带的表 == git 历史里最后一版带老名字的 block-aliases.json，逐条一致 +
  //    集合相等」。它守的是「自带表跟它顶替的那层别名分了叉」；今天两边都没了（表按裁定清空、别名层整层删），
  //    再比就是拿空表去对一份历史文件、恒红，删掉。
}

// ══ ⑥ 「今天认得哪些类型」这个权威跟 registry 不许分叉 ═══════════════════════════════════════════
console.log('\n⑥ block-roles.json 的键集 == registry.generated.ts 的键集（判「未知类型」用前者）');
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

console.log(`\n══ 汇总: 通过 ${pass} · 失败 ${fail} ══`);
process.exit(fail ? 1 : 0);
