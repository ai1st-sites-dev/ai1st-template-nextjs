#!/usr/bin/env node
'use strict';
/**
 * template-layer.test.js —— 升级时「铺哪些、删哪些」那份判据（#1166 第 1 步 / AC2）。
 *
 *   跑法:  node scripts/lib/template-layer.test.js  （或 `npm run test:scripts`）
 *   退出码: 0 全过 · 1 有失败 · 2 跑不起来（**不许当成通过**）
 *
 * ══ 这里守的是一条会删掉真客户内容的判据 ═══════════════════════════════════════════════════════
 * 删除集按「除 site/ 之外」算，会把照片和 logo 算进去 —— 真机读数：`site-51c2f83b` 那样算出来的
 * 23 个里有 18 张 `public/photos/*` 和 `public/logo.png`，只有 4 个是真模板文件。所以第一格就是
 * 那个反向对照：拿那把错尺子算一遍，看它是不是真的会碰到数据层。
 */

const path = require('path');
const T = require('./template-layer.js');

let pass = 0; let fail = 0;
const ok = (m) => { pass += 1; console.log(`  ✅ ${m}`); };
const bad = (m) => { fail += 1; console.log(`  ❌ ${m}`); };
const check = (c, m) => (c ? ok(m) : bad(m));

// 照 site-51c2f83b 的形状造：第一个 commit 是建站那天的模板（没有 site/、没有照片），HEAD 多了
// 数据层，而今天的模板把那四个 *Section.tsx 合并掉了。
const FIRST_COMMIT = [
  'package.json', 'package-lock.json', 'next.config.js', 'public/base.css',
  'src/lib/sections/registry.ts',
  'src/components/sections/ValuesGridSection.tsx',
  'src/components/sections/BenefitsListSection.tsx',
  'src/components/sections/ChecklistSection.tsx',
  'src/components/sections/ServiceHighlightsSection.tsx',
];
const PHOTOS = Array.from({ length: 18 }, (_, i) => `public/photos/p${i + 1}.jpg`);
const HEAD_NOW = [
  ...FIRST_COMMIT, ...PHOTOS, 'public/logo.png',
  'site/brand.json', 'site/pages/home.json', 'site/theme.json',
];
const TODAY = [
  'package.json', 'package-lock.json', 'next.config.js', 'public/base.css',
  'src/lib/sections/registry.ts',
  'src/components/sections/CardGroupSection.tsx',
  'src/lib/sections/block-roles.json',
  'scripts/upgrade-site-data.js',
  'site/brand.json',              // 今天的模板目录里也有一份样例 site/，它不属于模板层
];

// ══ ① 反向对照：那把错尺子真的会碰到数据层 ══════════════════════════════════════════════════════
console.log('① 反向对照：按「除 site/ 之外」算，删除集里有照片和 logo（所以那把尺子是错的）');
{
  const wrong = HEAD_NOW
    .filter((p) => !p.startsWith('site/'))
    .filter((p) => !TODAY.includes(p));
  const photos = wrong.filter((p) => p.startsWith('public/photos/')).length;
  const logo = wrong.filter((p) => p === 'public/logo.png').length;
  check(wrong.length === 23, `那把错尺子算出 23 个（读到 ${wrong.length}）—— 跟真机上 site-51c2f83b 同一个数`);
  check(photos === 18 && logo === 1, `其中 18 张照片 + 1 个 logo（读到 ${photos} / ${logo}）`);
  check(wrong.filter((p) => !p.startsWith('public/photos/') && p !== 'public/logo.png').length === 4,
    '只有 4 个是真模板文件（那四个被合并掉的 *Section.tsx）');
}

// ══ ② 对的那把尺子：基线 = 第一个 commit ⟹ 删除集里没有数据层 ════════════════════════════════════
console.log('\n② 基线取第一个 commit：删除集只有那 4 个模板文件，照片和 logo 一张不少');
{
  const plan = T.planTemplateLayer({ baselinePaths: FIRST_COMMIT, todayPaths: TODAY, currentPaths: HEAD_NOW });
  check(plan.remove.length === 4, `删除集 4 个（读到 ${plan.remove.length}：${plan.remove.map((p) => path.basename(p)).join(', ')}）`);
  check(plan.remove.every((p) => p.startsWith('src/components/sections/')), '四个都是那批 *Section.tsx');
  check(!plan.remove.some(T.isDataLayer), '删除集里没有任何数据层文件');
  check(plan.keptData.length === 18 + 1 + 3, `数据层原样留着 ${plan.keptData.length} 个（18 照片 + logo + 3 个 site/ 文件）`);
  // 铺的是今天模板的模板层 —— 今天目录里那份样例 site/ 不许被铺进去（会盖掉客人的数据）
  check(!plan.lay.some((p) => p.startsWith('site/')), '🔴 要铺的清单里没有 site/ —— 不会盖掉客人的数据');
  check(plan.lay.includes('src/components/sections/CardGroupSection.tsx')
    && plan.lay.includes('scripts/upgrade-site-data.js'), '今天模板的新文件都在要铺的清单里');
}

// ══ ③ 基线不是恒定的第一个 commit：升过一次的站再升一次 ══════════════════════════════════════════
console.log('\n③ 已升级过的站，基线取上次的记录 —— 第一次铺进来、今天没有的文件必须消失');
{
  // 第一次升级铺的是「上一版模板」，它有一个今天已经没有的文件。
  const LAST_UPGRADE = [...TODAY.filter((p) => !p.startsWith('site/')), 'src/lib/sections/legacy-shim.ts'];
  const AFTER_FIRST = [...LAST_UPGRADE, ...PHOTOS, 'public/logo.png', 'site/brand.json', 'site/.upgrade.json'];
  const record = {
    upgradedAt: '2026-08-20T00:00:00Z',
    source: { kind: 'path', ref: '/root/ai1st-template-main/nextjs', sha: 'aaaaaaa' },
    templatePaths: LAST_UPGRADE,
  };
  const base = T.baselineFrom(record);
  check(base.source === 'upgrade-record' && base.paths.length === LAST_UPGRADE.length,
    '基线从升级记录里读到了（不是落回第一个 commit）');
  const plan = T.planTemplateLayer({ baselinePaths: base.paths, todayPaths: TODAY, currentPaths: AFTER_FIRST });
  check(plan.remove.length === 1 && plan.remove[0] === 'src/lib/sections/legacy-shim.ts',
    `第一次铺进来、今天没有的那个文件进了删除集（读到 ${JSON.stringify(plan.remove)}）`);
  // 🔴 反向：同一棵树，基线错取第一个 commit ⟹ 那个文件永远删不掉（AC2③ 要抓的就是这个）
  const wrongBase = T.planTemplateLayer({ baselinePaths: FIRST_COMMIT, todayPaths: TODAY, currentPaths: AFTER_FIRST });
  check(!wrongBase.remove.includes('src/lib/sections/legacy-shim.ts'),
    '🔴 反向对照：基线错取第一个 commit 时它删不掉 ⟹ 这一格分得开两种基线');
  check(T.baselineFrom(null).source === 'first-commit' && T.baselineFrom({}).source === 'first-commit',
    '没有记录（或记录是空的）时明说落回第一个 commit');
}

// ══ ④ 删除集为空的那种站：要能说清为什么空 ══════════════════════════════════════════════════════
console.log('\n④ 第一个 commit 已经是今天这份模板的站（site-5d975f17 / site-60b30668）—— 删除集本来就空');
{
  const base = TODAY.filter((p) => !p.startsWith('site/'));
  const cur = [...base, 'site/brand.json', 'public/logo.png'];
  const plan = T.planTemplateLayer({ baselinePaths: base, todayPaths: TODAY, currentPaths: cur });
  check(plan.remove.length === 0, '删除集为空');
  check(plan.lay.length === base.length,
    `而「要铺的」不为空（${plan.lay.length} 个）—— 所以「空」是「没什么可删」，不是「什么都没算」`);
}

// ══ ⑤ 两层分工：滤在前、断言在后，而断言那一道【真的开得了火】═══════════════════════════════════
console.log('\n⑤ 数据层的两道：templateFilesOf 先滤掉，assertNoDataLayer 在真要删的那一刻再问一次');
{
  // 第一层：照片就算写进了基线，也进不了删除集
  const plan = T.planTemplateLayer({
    baselinePaths: [...FIRST_COMMIT, 'public/photos/p1.jpg', 'public/logo.png'],
    todayPaths: TODAY,
    currentPaths: HEAD_NOW,
  });
  check(!plan.remove.some(T.isDataLayer) && plan.remove.length === 4,
    `照片/logo 写进基线也进不了删除集（删除集仍是 4 个）`);
  check(T.templateFilesOf(['public/photos/p1.jpg', 'public/logo.png', 'site/brand.json', 'src/a.ts']).join(',') === 'src/a.ts',
    '🔴 templateFilesOf 的判据本身：三类数据层全滤掉，只留模板层');
  check(T.isDataLayer('public/photos/x.jpg') && T.isDataLayer('public/logo.png')
    && T.isDataLayer('site/brand.json') && T.isDataLayer('site') && !T.isDataLayer('public/base.css')
    && !T.isDataLayer('public/images/x.svg'),
    '数据层判据逐条：photos / logo.png / site 下的都是；base.css 和 public/images 不是');

  // 🔴 第二层：它开得了火 —— 喂它一份「调用方拼错了」的清单（这是那道检查真正要拦的形状）
  let threw = false; let msg = '';
  try { T.assertNoDataLayer([...plan.remove, 'public/photos/p7.jpg'], 'delete set'); } catch (e) { threw = true; msg = e.message; }
  check(threw && /public\/photos\/p7\.jpg/.test(msg) && /1 data-layer/.test(msg),
    `assertNoDataLayer 当场抛，并点名是哪个文件（${msg.slice(0, 80)}）`);
  check(T.assertNoDataLayer(plan.remove) === plan.remove,
    '干净的清单原样放行（返回同一个数组，调用方可以直接串起来用）');
}

// ══ ⑥ 驱动那个命令行入口：三个清单各自从磁盘走，删除集不许塌成空 ═════════════════════════════════
//
// 🔴 这一格是为一个真出过的错加的：第一版 plan-template-layer.js 在【铺完之后】才算，并且把「铺完的
// 那棵树」同时当成 `todayPaths` 和 `currentPaths` —— 于是 `remove` 恒为空（一组对照全读到同一个值），
// 而「删除集为空」在正常站上也是真的，所以它看起来一点问题都没有。
console.log('\n⑥ 驱动 plan-template-layer.js：删除集算得出来，而且不是恒空');
{
  const fs = require('fs');
  const os = require('os');
  const cp = require('child_process');
  const NEXT = path.resolve(__dirname, '..', '..');
  const CLI = path.join(NEXT, 'scripts', 'plan-template-layer.js');

  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'tpl-'));
  const put = (dir, rel, body) => {
    const full = path.join(dir, rel);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, body);
  };
  // 今天的模板：有 CardGroupSection，没有那四个老的
  const today = path.join(root, 'today');
  put(today, 'package.json', '{}');
  put(today, 'src/components/sections/CardGroupSection.tsx', 'x');
  // 🔴 模板自带的数据层，**三条判据各放一份**（`site/` · `public/logo.png` · `public/photos/**`）。
  //    上一版这里只有 `site/` 那一份，而那正好是 worker 那条 tar 唯一排掉的东西 ⟹ 这一格当时
  //    **分不出**「按 lay 清单铺」和「按 --exclude=site 铺」两种实现，两种都绿（#1166 r4，QA1 M2）。
  //    夹具要能区分它要判的两种实现，否则那个绿是白给的。
  put(today, 'site/brand.json', '{"sample":true}');            // 模板自带的样例数据层
  put(today, 'public/logo.png', 'SAMPLE-PNG');                 // 同上，第 2 条判据
  put(today, 'public/photos/sample.jpg', 'SAMPLE-JPG');        // 同上，第 3 条判据
  put(today, 'node_modules/junk.js', 'x');                     // 排除项
  // 这个站现在这棵树：老模板 + 它自己的数据
  const repo = path.join(root, 'repo');
  put(repo, 'package.json', '{}');
  put(repo, 'src/components/sections/ValuesGridSection.tsx', 'x');
  put(repo, 'src/components/sections/ChecklistSection.tsx', 'x');
  put(repo, 'site/brand.json', '{"real":true}');
  put(repo, 'public/logo.png', 'PNG');
  put(repo, 'public/photos/p1.jpg', 'JPG');
  // 基线 = 建站那天的模板（没有数据层）
  const baseline = path.join(root, 'baseline.json');
  fs.writeFileSync(baseline, JSON.stringify({
    source: 'first-commit',
    paths: ['package.json', 'src/components/sections/ValuesGridSection.tsx',
      'src/components/sections/ChecklistSection.tsx'],
  }));

  const run = (args) => {
    const r = cp.spawnSync(process.execPath, [CLI, ...args], { encoding: 'utf-8' });
    const lines = (r.stdout || '').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l));
    return { rc: r.status, out: lines[lines.length - 1] || null, stderr: r.stderr };
  };

  const good = run(['--today', today, '--root', repo, '--baseline', baseline]);
  check(good.rc === 0 && good.out && good.out.event === 'template-plan', `rc=0 且报了 template-plan（rc=${good.rc}）`);
  check(good.out && good.out.remove.length === 2
    && good.out.remove.includes('src/components/sections/ValuesGridSection.tsx')
    && good.out.remove.includes('src/components/sections/ChecklistSection.tsx'),
    `🔴 删除集是那两个老 Section（读到 ${JSON.stringify(good.out && good.out.remove)}）—— 不是空的`);
  check(good.out && good.out.remove.every((p) => !T.isDataLayer(p)),
    '删除集里没有 logo、没有照片、没有 site/');
  check(good.out && good.out.keptData === 3,
    `数据层原样留着 3 个（logo + 1 张照片 + site/brand.json，读到 ${good.out && good.out.keptData}）`);
  // 🔴 `today` 是**走出来的全部**（含模板自带的样例 site/，只排掉 node_modules 那类）；真正会被铺
  //    下去的是 `lay`（滤过数据层的那份）。两个都断言，因为把它们当成一个数是这份代码最容易出的错。
  check(good.out && good.out.today === 5,
    `今天的模板走出 5 个文件（package.json + CardGroupSection + 样例 site/ + 样例 logo + 样例照片；node_modules 排掉了，读到 ${good.out && good.out.today}）`);
  check(good.out && good.out.lay === 2,
    `而要铺下去的是 2 个 —— 样例 site/ / logo / 照片三样都被数据层判据滤掉，不会盖掉客人的数据（读到 ${good.out && good.out.lay}）`);
  // 🔴 `layPaths` 是**清单本身**，不是个数：worker 拿它当容器里 `tar -T` 的输入，铺下去的就是这一份。
  //    个数对而清单错，两者在日志里长得一模一样，所以两个都断言。
  check(good.out && Array.isArray(good.out.layPaths) && good.out.layPaths.length === good.out.lay,
    `layPaths 是全份清单且与 lay 的个数一致（读到 ${good.out && JSON.stringify(good.out.layPaths)}）`);
  check(good.out && good.out.layPaths.every((p) => !T.isDataLayer(p)),
    `🔴 要铺下去的清单里没有 site/、没有 logo、没有照片（读到 ${good.out && JSON.stringify(good.out.layPaths)}）`);
  check(good.out && good.out.layPaths.includes('package.json')
    && good.out.layPaths.includes('src/components/sections/CardGroupSection.tsx'),
    '而今天模板的模板层文件都在要铺的清单里（不是把清单滤空了）');

  // 🔴 反向对照，钉死那个塌成空的错法：把 --today 指到这个站自己那棵树上（= 第一版那个写法的效果）
  const collapsed = run(['--today', repo, '--root', repo, '--baseline', baseline]);
  check(collapsed.rc === 0 && collapsed.out && collapsed.out.remove.length === 0,
    `把「今天的模板」指成这棵树自己 ⟹ 删除集塌成空（读到 ${collapsed.out && collapsed.out.remove.length}）`
    + ' —— 这一格分得开两种算法');

  // 基线读不到 / 今天的模板是空目录：都要红，且红得不一样
  check(run(['--today', today, '--root', repo, '--baseline', path.join(root, 'nope.json')]).rc === 1,
    '基线读不到 ⟹ rc=1');
  const emptyToday = fs.mkdtempSync(path.join(os.tmpdir(), 'empty-'));
  check(run(['--today', emptyToday, '--root', repo, '--baseline', baseline]).rc === 1,
    '今天的模板是空目录 ⟹ rc=1（不许拿空清单去算删除集，那会要求删掉整个模板层）');
}

console.log(`\n══ 汇总: 通过 ${pass} · 失败 ${fail} ══`);
process.exit(fail ? 1 : 0);
