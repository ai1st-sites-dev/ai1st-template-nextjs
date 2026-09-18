#!/usr/bin/env node
/**
 * page-layout.test.js — 布局钉死的区形态（`repeatVariants`）里的候选，构建时必须落回（#1384）。
 *
 * 跑法:  node scripts/lib/page-layout.test.js   （或 `npm run test:scripts`，它按文件名发现）
 * 退出码: 0 全过 · 1 有失败 · 2 跑不起来（**不许当成通过**）
 *
 * ══ 为什么有这一格 ══════════════════════════════════════════════════════════════════════════════
 * #1384 正文原来只枚举了两条能让真站戴上候选形态的路（主题选择单 · 页面 JSON）。QA3 2026-09-17 在
 * 会落地的合并形态上真构建复现了**第三条**：布局把「这个页脚区戴哪种形态」直接写在
 * `page-layouts/*.json` 这份**数据文件**里，既不走 `shapeSheetFor`、也不走 `shapeForBlock`。
 * 把 `footer` 的 `slim-row` 标成候选、站挑 `tri-footer` ⟹ 构建退出码 0、零提示，产物里
 * `"footer-c":"slim-row"`，`SiteShell.tsx` 直传 `Footer` 渲染出来。
 *
 * ══ 守什么 ═════════════════════════════════════════════════════════════════════════════════════
 * ① 正向臂：未改动的副本立得起来，`tri-footer` 的三个值逐字等于布局里钉的那三个（不然下面的读数
 *    可能全是「副本自己坏了」）
 * ② 候选臂：把 `slim-row` 标成候选 ⟹ 那个区落回**这个站页脚区已经解析出来的形态**，另外两个区
 *    一个字节不动，notes 有一行同时点名布局 / 区 / 候选形态
 * ③ 落回值不是 manifest 第 0 项：喂一个 footer 形态不等于默认的 `regions`，落回的是它
 *    （🔴 少这一格，一个「一律落回 shapes[0]」的实现也全绿，而那会把一个把页脚设成别的形态的站
 *    悄悄改样）
 * ④ 🔴 **构建不许因此失败**：同一份布局在同一棵树上 `validateLayout` 仍然 0 problems ——
 *    堵成构建失败是 #1384 正文点名禁止的（`sync-config.js` 见到 problem 就 exit 1，而它校验库里
 *    **每一份**布局，一个候选会让所有站的构建一起红）
 * ⑤ 反向对照：把 `candidate` 去掉 ⟹ 三个值全部回到布局钉的那份、notes 空
 * ⑥ 两个消费者读的是同一张表：`footerVariantsFor` 与 `resolveRepeatVariants` 对同一个站逐字相同
 *    （产物走前者、AI 编辑器的 notes 走后者，分叉 = 告诉编辑器这个站戴着一个它并没戴的形态）
 *
 * 🔴 **臂跑在一棵复制出来的树上**，盘上的 `blocks/` 一个字节不动：这一格要的是「某个形态是候选」
 *    这个状态，而今天真树上一个候选都没有（那正是 #1384 交付时的状态）。手法与
 *    `scripts/region-layout.test.js` ⑧ 逐段相同，理由也写在那儿。
 */

'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');

const NEXT = path.resolve(__dirname, '..', '..');

let pass = 0; let fail = 0;
const ok = (m) => { pass += 1; console.log(`  ✅ ${m}`); };
const bad = (m) => { fail += 1; console.log(`  ❌ ${m}`); };
const die = (m) => { console.error(`🔴 跑不起来: ${m}`); process.exit(2); };

/** 一棵只含这条链要用到的文件的副本；`mutate(root)` 在 require 之前改它。 */
function mkTree(mutate) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'page-layout-cand-'));
  fs.mkdirSync(path.join(root, 'scripts', 'lib'), { recursive: true });
  fs.mkdirSync(path.join(root, 'blocks'));
  fs.mkdirSync(path.join(root, 'page-layouts'));
  fs.copyFileSync(path.join(NEXT, 'scripts', 'region-layout.js'), path.join(root, 'scripts', 'region-layout.js'));
  fs.copyFileSync(path.join(NEXT, 'scripts', 'lib', 'page-layout.js'), path.join(root, 'scripts', 'lib', 'page-layout.js'));
  for (const f of fs.readdirSync(path.join(NEXT, 'blocks'))) {
    fs.copyFileSync(path.join(NEXT, 'blocks', f), path.join(root, 'blocks', f));
  }
  for (const f of fs.readdirSync(path.join(NEXT, 'page-layouts'))) {
    fs.copyFileSync(path.join(NEXT, 'page-layouts', f), path.join(root, 'page-layouts', f));
  }
  if (mutate) mutate(root);
  // 🔴 只 disable `global-require` 这一条 —— `import/no-dynamic-require` 需要 eslint-plugin-import，
  //    而 `scripts/.eslintrc.json` 没装它 ⟹ 写在 disable 注释里会让 `npm run lint:scripts` 当场红。
  // eslint-disable-next-line global-require
  return require(path.join(root, 'scripts', 'lib', 'page-layout.js'));
}

const markCandidate = (root, block, names) => {
  const p = path.join(root, 'blocks', `${block}.json`);
  const m = JSON.parse(fs.readFileSync(p, 'utf-8'));
  for (const sh of m.shapes) if (names.includes(sh.name)) sh.candidate = true;
  fs.writeFileSync(p, JSON.stringify(m, null, 2));
};

// 盘上的真读数，夹具的前提都从这儿来（不写死，manifest / 布局改了这一格要跟着说话）。
const triFooter = JSON.parse(fs.readFileSync(path.join(NEXT, 'page-layouts', 'tri-footer.json'), 'utf-8'));
const footerManifest = JSON.parse(fs.readFileSync(path.join(NEXT, 'blocks', 'footer.json'), 'utf-8'));
const FOOTER_SHAPES = footerManifest.shapes.map((sh) => sh.name);
const DECLARED = triFooter.repeatVariants || {};
const VICTIM_REGION = 'footer-c';
const VICTIM_SHAPE = DECLARED[VICTIM_REGION];
if (!VICTIM_SHAPE) die(`page-layouts/tri-footer.json 的 repeatVariants 里没有 ${VICTIM_REGION} —— 这一格没有对象`);
if (!FOOTER_SHAPES.includes(VICTIM_SHAPE)) die(`blocks/footer.json 里没有 "${VICTIM_SHAPE}" —— 夹具前提不成立`);
// 落回值要跟布局钉的那个**不同**，否则 ②③ 两格分不出「落回了」和「没落回」。
const RESOLVED_FOOTER = FOOTER_SHAPES.find((n) => n !== VICTIM_SHAPE);
if (!RESOLVED_FOOTER) die('blocks/footer.json 只有一个形态 —— 这一格量不出落回');

const regionsWith = (footerShape) => ({
  header: { shape: 'x' }, footer: { shape: footerShape }, topbar: { shape: 'y' },
});

console.log('── ① 正向臂：未改动的副本，repeatVariants 原样通过 ──');
{
  const lib = mkTree(null);
  const { variants, notes } = lib.resolveRepeatVariants(triFooter, regionsWith(RESOLVED_FOOTER));
  const same = JSON.stringify(variants) === JSON.stringify(DECLARED);
  if (same && notes.length === 0) {
    ok(`未改动的副本：三个区逐字等于布局钉的那份（${Object.entries(DECLARED).map(([k, v]) => `${k}=${v}`).join(' · ')}），notes 空`);
  } else {
    bad(`正向臂对不上：variants=${JSON.stringify(variants)} notes=${JSON.stringify(notes)} —— 下面的读数不说明任何事`);
  }
}

console.log(`── ② 候选臂：把 footer 的 "${VICTIM_SHAPE}" 标成候选 ──`);
let candidateLib = null;
{
  candidateLib = mkTree((root) => markCandidate(root, 'footer', [VICTIM_SHAPE]));
  const { variants, notes } = candidateLib.resolveRepeatVariants(triFooter, regionsWith(RESOLVED_FOOTER));
  if (variants[VICTIM_REGION] === RESOLVED_FOOTER) {
    ok(`${VICTIM_REGION} 落回这个站页脚区解析出来的形态 ${RESOLVED_FOOTER}（布局钉的是 ${VICTIM_SHAPE}）`);
  } else {
    bad(`${VICTIM_REGION} 读到 ${variants[VICTIM_REGION]}，应当落回 ${RESOLVED_FOOTER} —— 候选上了真站`);
  }
  // 🔴 只动该动的那一个：另外两个区的值一个字节不许变（一个「一律落回」的实现在这一格上会红）。
  const untouched = Object.keys(DECLARED).filter((r) => r !== VICTIM_REGION);
  const kept = untouched.every((r) => variants[r] === DECLARED[r]);
  if (kept) ok(`另外 ${untouched.length} 个区原样不动（${untouched.map((r) => `${r}=${variants[r]}`).join(' · ')}）`);
  else bad(`别的区也被改了：${JSON.stringify(variants)}`);

  const line = notes.find((n) => n.includes(triFooter.id) && n.includes(VICTIM_REGION) && n.includes(VICTIM_SHAPE));
  if (line) ok(`notes 有一行同时点名布局 / 区 / 候选形态：${line}`);
  else bad(`notes 没有点名三样（布局 ${triFooter.id} · 区 ${VICTIM_REGION} · 形态 ${VICTIM_SHAPE}）：${JSON.stringify(notes)}`);
}

console.log('── ③ 落回的是【这个站解析出来的那个】，不是 manifest 第 0 项 ──');
{
  // 🔴 少这一格，一个「一律落回 shapes[0]」的实现也全绿 —— 而那会把一个把页脚设成别的形态的站
  //    在这条路上悄悄改样，正是本票在治的那类改动。
  const other = FOOTER_SHAPES.find((n) => n !== VICTIM_SHAPE && n !== FOOTER_SHAPES[0]);
  if (!other) {
    console.log('  ⚠️  footer 的形态不够三个，这一格换用 shapes[0] 以外那一个也拿不到 —— 跳过（不是通过）');
  } else {
    const { variants } = candidateLib.resolveRepeatVariants(triFooter, regionsWith(other));
    if (variants[VICTIM_REGION] === other) {
      ok(`站的页脚区解析成 ${other}（manifest 第 0 项是 ${FOOTER_SHAPES[0]}）⟹ 落回 ${other}`);
    } else {
      bad(`落回读到 ${variants[VICTIM_REGION]}，应当是 ${other} —— 它取的不是这个站的值`);
    }
  }
}

console.log('── ④ 🔴 构建不许因此失败：同一份布局 validateLayout 仍然 0 problems ──');
{
  const problems = candidateLib.validateLayout(triFooter);
  if (problems.length === 0) {
    ok('标了候选之后 validateLayout(tri-footer) 仍然 0 problems ⟹ sync-config 不会 exit 1');
  } else {
    bad(`validateLayout 报了 ${problems.length} 条：${JSON.stringify(problems)} —— #1384 正文点名禁止拿构建失败来堵`);
  }
  // 反向对照：这把尺看得见 problem（不然上面那个 0 可能是「它什么都不报」）。
  const broken = { ...triFooter, repeatVariants: { ...DECLARED, [VICTIM_REGION]: 'zz-not-a-shape' } };
  const got = candidateLib.validateLayout(broken);
  if (got.some((x) => x.includes('zz-not-a-shape'))) ok('反向对照：写一个清单里没有的名字，它照样报 —— 这把尺没坏');
  else bad(`反向对照失败：写了一个不存在的形态却 0 problems（${JSON.stringify(got)}）`);
}

console.log('── ⑤ 反向对照：去掉 candidate ⟹ 全部回到布局钉的那份 ──');
{
  const lib = mkTree(null);
  const { variants, notes } = lib.resolveRepeatVariants(triFooter, regionsWith(RESOLVED_FOOTER));
  if (variants[VICTIM_REGION] === VICTIM_SHAPE && notes.length === 0) {
    ok(`没有 candidate 时 ${VICTIM_REGION} 仍是 ${VICTIM_SHAPE}、notes 空 ⟹ ② 量的是那个键，不是夹具`);
  } else {
    bad(`去掉 candidate 之后读到 ${variants[VICTIM_REGION]} / notes=${JSON.stringify(notes)}`);
  }
}

console.log('── ⑥ 两个消费者读的是同一张表 ──');
{
  // `footerVariantsFor` 走 themes / site_meta 那一串，副本树里立不起来；这一格改为读**源码**：
  // 🔴 它问的是「site-regions.js 里那个函数有没有自己再算一遍」，而那正是两处分叉的形状。
  // 🔴 **先剥掉整行注释再量**：这个函数上面那段注释里就写着 `resolveRepeatVariants` 这个名字，
  //    不剥的话「有没有调它」这一问永远是 true —— 实测过：把那一行调用删掉、注释留着，这一格照绿
  //    （而下面那条「有没有自己再读一次」是红的）。剥的是【整行】注释，不是行尾的 `//`：后者会咬进
  //    字符串字面量。
  const stripComments = (t) => t.split('\n').filter((l) => !l.trim().startsWith('//') && !l.trim().startsWith('*')).join('\n');
  const src = stripComments(fs.readFileSync(path.join(NEXT, 'scripts', 'lib', 'site-regions.js'), 'utf-8'));
  const body = src.slice(src.indexOf('function footerVariantsFor'), src.indexOf('function hasTopbarRegion'));
  if (body.includes('resolveRepeatVariants')) {
    ok('footerVariantsFor 调的是 pageLayoutLib.resolveRepeatVariants（不是自己读 layout.repeatVariants）');
  } else {
    bad('footerVariantsFor 没走 resolveRepeatVariants —— 产物落回而 AI 编辑器的 notes 不落回，两边会分叉');
  }
  if (!/repeatVariants\s*\)\s*\|\|\s*\{\}/.test(body) && !body.includes('picked.layout.repeatVariants')) {
    ok('它也没有自己再读一次 layout.repeatVariants');
  } else {
    bad(`footerVariantsFor 里仍有直接读 layout.repeatVariants 的地方：${body.trim().slice(0, 200)}…`);
  }
  const sync = stripComments(fs.readFileSync(path.join(NEXT, 'scripts', 'sync-config.js'), 'utf-8'));
  if (/resolveRepeatVariants\(picked\.layout,\s*regions\)/.test(sync)) {
    ok('sync-config.js 写进产物的也是同一个函数的产出');
  } else {
    bad('sync-config.js 没走 resolveRepeatVariants —— 产物里会是布局原样那份');
  }
}

console.log(`\n══ page-layout.test.js: ${pass} 过 · ${fail} 失败 ══`);
process.exit(fail ? 1 : 0);
