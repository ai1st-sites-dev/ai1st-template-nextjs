#!/usr/bin/env node
/**
 * region-layout.test.js — 三个 Region 的形态解析，两条承重性质的常设守卫。
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
 * 🔴 #1353 —— 上半条那个性质**换家了，没有消失**。顶栏搬进形态层之后 `headerScrim` 这个构建期的值
 *    没了：遮罩元素恒在 DOM 里，露不露面由 `public/shapes.css` 按两个条件一起判
 *    （`[data-shape="transparent-overlay"]` **且** `[data-over-hero="true"]`）。所以 ① ② 两格改成
 *    去问那份 CSS：**开遮罩的那条规则必须两个条件都带**，而且**不许有任何一条只带其中一个就开它**。
 *    少一个条件的后果跟 #1086 那次一模一样 —— 要么每一页顶上都压一条黑渐变（about 页也压），
 *    要么该有遮罩的首屏没有。
 *    📌 这一格**不读组件**：组件那一半（`overlaid` 怎么算）由 e2e 看，这里守的是纯文本可判的那一半。
 *
 * 🔴 ④ 那格的清单**从 manifest 现取**（`shapesOf()`）——`HEADER_VARIANTS` 那三张写死的表随本票退役。
 */

'use strict';

const fs = require('fs');
const path = require('path');
const RL = require('./region-layout.js');

let pass = 0; let fail = 0;
const ok = (m) => { pass++; console.log(`  ✅ ${m}`); };
const bad = (m) => { fail++; console.log(`  ❌ ${m}`); };
const die = (m) => { console.error(`🔴 跑不起来: ${m}`); process.exit(2); };

for (const k of ['resolveRegionShapes', 'shapesOf', 'REGION_BLOCK']) {
  if (RL[k] === undefined) die(`region-layout.js 没导出 ${k} —— 这一格量不到它要量的东西`);
}
const { resolveRegionShapes: resolve, shapesOf, REGION_BLOCK } = RL;

const HEADER_SHAPES = shapesOf('header');
const FOOTER_SHAPES = shapesOf('footer');
const TOPBAR_SHAPES = shapesOf(REGION_BLOCK.topbar);
const DEFAULT_HEADER = HEADER_SHAPES[0];
const DEFAULT_FOOTER = FOOTER_SHAPES[0];
const DEFAULT_TOPBAR = TOPBAR_SHAPES[0];

// 夹具自检：这一格的整个意思建立在「透明浮层是清单里的一项、而且不是默认那一项」上面。
if (!HEADER_SHAPES.length || !FOOTER_SHAPES.length || !TOPBAR_SHAPES.length) {
  die(`某个区的形态清单是空的（header ${HEADER_SHAPES.length} · footer ${FOOTER_SHAPES.length} · `
    + `topbar ${TOPBAR_SHAPES.length}）—— manifest 读不到就什么都没量成`);
}
if (!HEADER_SHAPES.includes('transparent-overlay')) die('清单里没有 transparent-overlay —— 下面那几格在说别的事');
if (DEFAULT_HEADER === 'transparent-overlay') die('默认 header 就是透明浮层 ⟹ 「两个条件」那一格分不出对错');

const SHAPES_CSS = path.join(__dirname, '..', 'public', 'shapes.css');
let css = '';
try { css = fs.readFileSync(SHAPES_CSS, 'utf-8'); } catch (e) { die(`读不到 ${SHAPES_CSS}：${e.message}`); }
// 注释里写着这两个属性名（讲它们为什么在一起），不剥掉的话下面那两格会把说明文字数成规则。
const cssNoComments = css.replace(/\/\*[\s\S]*?\*\//g, '');

/** 把 CSS 切成 { 选择器, 声明块 }，@media 里的也算（这一格不关心它在哪个断点里）。 */
function rulesOf(text) {
  const out = [];
  for (const m of text.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const sel = m[1].trim();
    if (sel.startsWith('@')) continue;
    out.push({ sel, body: m[2] });
  }
  return out;
}
const RULES = rulesOf(cssNoComments);
if (RULES.length < 50) die(`从 shapes.css 只切出 ${RULES.length} 条规则 —— 尺子坏了（这份文件有上千行）`);

// ── ① 开遮罩那条规则，两个条件必须【都】带 ───────────────────────────────────────────────────
{
  // 「开遮罩」= 选择器点名 `.header__scrim` 且声明里把它从 base.css 的 `display:none` 打开。
  const openers = RULES.filter((r) => /\.header__scrim\b/.test(r.sel)
    && /(^|[\s;{])display\s*:\s*(?!none)[a-z-]+/.test(r.body));
  if (!openers.length) {
    bad('shapes.css 里没有任何一条规则把 `.header__scrim` 打开 —— 那么透明浮层那一支【没有遮罩】，'
      + '白字压浅底，就是 region-layout.js 文件头 ② 实测过的 1.00:1');
  } else {
    const missing = openers.filter((r) => !(/\[data-shape="transparent-overlay"\]/.test(r.sel)
      && /\[data-over-hero="true"\]/.test(r.sel)));
    if (missing.length) {
      bad(`${missing.length} 条开遮罩的规则没有同时带两个条件：${missing.map((r) => r.sel).join(' · ')}`
        + ' —— 只带形态那一个，about 页（第一段是 page-header）顶上也会压一条黑渐变；'
        + '只带 data-over-hero 那一个，别的形态的首屏也会莫名其妙多一层。');
    } else {
      ok(`${openers.length} 条开遮罩的规则**都**同时带 [data-shape="transparent-overlay"] 与 [data-over-hero="true"]`);
    }
  }
}

// ── ② 反向：不许有任何一条只凭其中一个条件就开遮罩（否则 ① 用「一条都没有」也能满足）─────────
{
  const oneLegged = RULES.filter((r) => /\.header__scrim\b/.test(r.sel)
    && /(^|[\s;{])display\s*:\s*(?!none)[a-z-]+/.test(r.body)
    && (/\[data-shape="transparent-overlay"\]/.test(r.sel) !== /\[data-over-hero="true"\]/.test(r.sel)));
  // 阳性对照：把两个条件之一从每条选择器里抹掉，这把尺必须当场点名 —— 否则它可能什么都没在看。
  const rigged = rulesOf(cssNoComments.replace(/\[data-over-hero="true"\]/g, ''));
  const caught = rigged.filter((r) => /\.header__scrim\b/.test(r.sel)
    && /(^|[\s;{])display\s*:\s*(?!none)[a-z-]+/.test(r.body)
    && (/\[data-shape="transparent-overlay"\]/.test(r.sel) !== /\[data-over-hero="true"\]/.test(r.sel)));
  if (oneLegged.length) {
    bad(`有 ${oneLegged.length} 条只凭一个条件就开遮罩：${oneLegged.map((r) => r.sel).join(' · ')}`);
  } else if (!caught.length) {
    bad('阳性对照失败：把 [data-over-hero="true"] 从整份 CSS 里抹掉，这把尺仍然一条都没点名 ⟹ 它没在看');
  } else {
    ok(`没有一条规则只凭单个条件开遮罩；阳性对照：抹掉 [data-over-hero="true"] 之后当场点名 ${caught.length} 条`);
  }
}

// ── ③ 清单外的值必须落回默认，而且**返回值恒在清单里**（它会原样落进 DOM 的 data-shape）───────
{
  const junk = ['transparent-overlay ', 'TRANSPARENT-OVERLAY', 'pill-floating; drop table', '../../etc/passwd', '{}'];
  const problems = [];
  for (const v of junk) {
    const r = resolve({ header: v, footer: v, 'announcement-bar': v });
    if (r.header.shape !== DEFAULT_HEADER) problems.push(`header=${JSON.stringify(v)} ⟹ ${JSON.stringify(r.header.shape)}(该退回 ${DEFAULT_HEADER})`);
    if (r.footer.shape !== DEFAULT_FOOTER) problems.push(`footer=${JSON.stringify(v)} ⟹ ${JSON.stringify(r.footer.shape)}(该退回 ${DEFAULT_FOOTER})`);
    if (r.topbar.shape !== DEFAULT_TOPBAR) problems.push(`topbar=${JSON.stringify(v)} ⟹ ${JSON.stringify(r.topbar.shape)}(该退回 ${DEFAULT_TOPBAR})`);
    if (!r.notes.some((n) => n.includes(String(v)))) problems.push(`退回了但 notes 里没说是因为 ${JSON.stringify(v)} —— 静默降级`);
  }
  if (problems.length === 0) {
    ok(`${junk.length} 个清单外的形态名全部落回默认，并且每一个都在 notes 里说了理由`);
  } else problems.forEach(bad);
}

// ── ④ 清单里的每一项都必须原样通过（否则 ③ 用「永远退回默认」也能满足）─────────────────────────
{
  const problems = [];
  for (const v of HEADER_SHAPES) if (resolve({ header: v }).header.shape !== v) problems.push(`header ${v}`);
  for (const v of FOOTER_SHAPES) if (resolve({ footer: v }).footer.shape !== v) problems.push(`footer ${v}`);
  for (const v of TOPBAR_SHAPES) if (resolve({ [REGION_BLOCK.topbar]: v }).topbar.shape !== v) problems.push(`topbar ${v}`);
  if (problems.length === 0) {
    ok(`清单里 ${HEADER_SHAPES.length}+${FOOTER_SHAPES.length}+${TOPBAR_SHAPES.length} 个形态全部原样通过(反向对照)`);
  } else bad(`这些清单内的形态没被原样通过:${problems.join(' · ')}`);
}

// ── ⑤ 两种键名都要认：选择单用块类型（announcement-bar），theme.json 用区名（topbar）─────────────
//    #1353 —— 这两条路都活着（`site-regions.js` 把选择单和 theme.json 的 regionLayout 叠在一起传进来），
//    只认一种的失败方向是静默的：候选图册那条路写的是区名，读不到就悄悄退回默认。
{
  const byBlock = resolve({ [REGION_BLOCK.topbar]: TOPBAR_SHAPES[0] }).topbar.shape;
  const byRegion = resolve({ topbar: TOPBAR_SHAPES[0] }).topbar.shape;
  const overrides = resolve({ [REGION_BLOCK.topbar]: TOPBAR_SHAPES[0], topbar: TOPBAR_SHAPES[0] }).topbar.shape;
  if (byBlock === TOPBAR_SHAPES[0] && byRegion === TOPBAR_SHAPES[0] && overrides === TOPBAR_SHAPES[0]) {
    ok(`块类型键（${REGION_BLOCK.topbar}）和区名键（topbar）都认得，两个一起给也不打架`);
  } else {
    bad(`两种键名没都认：按块类型 ${JSON.stringify(byBlock)} · 按区名 ${JSON.stringify(byRegion)}`);
  }
}

// ── ⑥ 没换装（传 {}）⟹ 三个区都是各自 manifest 的第 0 项 ────────────────────────────────────
{
  const shape = (x) => JSON.stringify({ header: x.header.shape, footer: x.footer.shape, topbar: x.topbar.shape });
  const want = JSON.stringify({ header: DEFAULT_HEADER, footer: DEFAULT_FOOTER, topbar: DEFAULT_TOPBAR });
  const r = resolve({});
  const r2 = resolve(undefined);
  if (shape(r) === want && shape(r2) === want && r.notes.length === 0) {
    ok(`没换装(传 {} 或 undefined)⟹ ${DEFAULT_HEADER} / ${DEFAULT_FOOTER} / ${DEFAULT_TOPBAR}，notes 为空`);
  } else {
    bad(`没换装时的结论变了:{} ⟹ ${shape(r)} · undefined ⟹ ${shape(r2)},期望 ${want}`);
  }
}

// ── ⑦ 清单的唯一出处是 manifest：`shapesOf()` 逐项等于 `blocks/<块>.json` 的 shapes ────────────
//    #1353 —— 这一格盯的是本票那条改动本身（三张写死的表退役）。再写一张表出来，这里当场红。
{
  const { loadManifests } = require('./lib/block-manifest.js');
  const ms = loadManifests();
  const problems = [];
  for (const [region, block] of Object.entries(REGION_BLOCK)) {
    const fromManifest = (ms.get(block) || { shapes: [] }).shapes.map((s) => s.name);
    if (JSON.stringify(shapesOf(block)) !== JSON.stringify(fromManifest)) {
      problems.push(`${region}/${block}: shapesOf ${JSON.stringify(shapesOf(block))} ≠ manifest ${JSON.stringify(fromManifest)}`);
    }
  }
  if (problems.length === 0) {
    ok(`三个区的形态清单逐项等于它们各自 manifest 的 shapes（${Object.values(REGION_BLOCK).join(' / ')}）`);
  } else problems.forEach(bad);
}

console.log(`\n══ 汇总: 通过 ${pass} · 失败 ${fail} ══`);
process.exit(fail ? 1 : 0);
