#!/usr/bin/env node
/**
 * editor-save-summary.test.js — #1454：编辑器每次 Save 在 AI chat 里留的那句人话（`editor-convert.js` §describeSave）。
 *
 *   node scripts/editor-save-summary.test.js     （由 `npm run test:scripts` 自动发现）
 *   退出码: 0 全过 · 1 有失败 · 2 跑不起来（**不许当成通过**）
 *
 * schema 用这个模板**自己的**区块库现算（`editor-schema.js` §editorSchema），不手写块名 / 字段名：记录里的字
 * 必须是老板在编辑器面板上看到的那几个，而那几个只住在 manifest 里。外壳三样（#1425 T3 起）的字段名从 `EditorApp.tsx` 的
 * §ROOT_FIELD_LABELS 读（面板用的就是那一份）。
 *
 * #1676 —— 每一类改动说成什么（AI 按钮写动作、手改文字写新值、挪块写方向、换形态写成什么、旋钮写名字和值），
 * 以及 AI 说明的三条作废规矩（§recordAiNote / §aiNotesForSave / §settleAiNotes）。形态 id、旋钮名和值同样从 schema 现取。
 */

'use strict';

const fs = require('fs');
const path = require('path');

let pass = 0; let fail = 0;
const ok = (m) => { pass += 1; console.log(`  ✅ ${m}`); };
const bad = (m) => { fail += 1; console.log(`  ❌ ${m}`); };
const eq = (got, want, m) => (got === want ? ok(`${m} → ${JSON.stringify(got)}`) : bad(`${m} —— got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`));
function die(msg) { console.log(`💥 ${msg}`); process.exit(2); }

let presetClickProps; let describeSave; let recordAiNote; let aiNotesForSave; let settleAiNotes; let schema; let rootLabels; let rewriteActions;
try {
  ({ describeSave, recordAiNote, aiNotesForSave, settleAiNotes } = require('./lib/editor-convert.js'));
  ({ presetClickProps } = require('./lib/block-knobs.js')); // 面板点预设走的就是它（EditorApp.tsx §OptionsField）
  schema = require('./lib/editor-schema.js').editorSchema({});
  const src = fs.readFileSync(path.join(__dirname, '..', 'src/components/editor/EditorApp.tsx'), 'utf8');
  const m = src.match(/const ROOT_FIELD_LABELS[^=]*=\s*\{([\s\S]*?)\};/);
  if (!m) die('EditorApp.tsx 里找不到 ROOT_FIELD_LABELS —— 外壳四样的字段名没法对上面板');
  rootLabels = Object.fromEntries([...m[1].matchAll(/(\w+):\s*'([^']*)'/g)].map((x) => [x[1], x[2]]));
  // #1676 —— AI 四个动作的键从 `InlineEdit.tsx` 的 REWRITE_ACTIONS 现取（按钮就是照它画的），不手写。
  const ie = fs.readFileSync(path.join(__dirname, '..', 'src/components/editor/InlineEdit.tsx'), 'utf8');
  const a = ie.match(/export const REWRITE_ACTIONS = \[([^\]]*)\]/);
  if (!a) die('InlineEdit.tsx 里找不到 REWRITE_ACTIONS');
  rewriteActions = [...a[1].matchAll(/'([^']+)'/g)].map((x) => x[1]);
} catch (e) { die(`起不来：${e.message}`); }
if (typeof describeSave !== 'function') die('editor-convert.js 没有导出 describeSave');
// #1425（T3）：公告条文字 topbarMessage 随公告条那个区退役，外壳只剩 layout / headerShape / footerShape。
for (const f of ['layout', 'headerShape', 'footerShape']) if (!rootLabels[f]) die(`ROOT_FIELD_LABELS 里没有 ${f}`);

const label = (type) => { const c = schema.components.find((x) => x.type === type); if (!c) die(`区块库里没有 ${type}`); return c; };
const hero = label('hero');
const bar = label('cta'); // #1425（T3）：原来是 announcement-bar（随旧库删了），换成同样只有一句短字段的 cta
const feat = label('features');
const faq = label('faq');
const field = (c, slot) => { const f = c.fields.find((x) => x.slot === slot); if (!f) die(`${c.type} 没有字段 ${slot}`); return f; };
const fieldLabel = (c, slot) => field(c, slot).label;
// 文字槽 / 非文字槽 / 旋钮：各从 schema 里挑一个，不手写 slot 名（除了 hero 的 headline / subheadline，正文点名的就是它俩）。
const barText = bar.fields.find((f) => f.kind === 'text');
if (!barText) die('cta 没有文字槽');
const heroNonText = hero.fields.find((f) => f.kind === 'list');
if (!heroNonText) die('hero 没有列表槽');
const heroOpts = hero.fields.find((f) => Array.isArray(f.knobs) && f.knobs.length);
if (!heroOpts) die('hero 没有旋钮');
const alignKnob = heroOpts.knobs.find((k) => k.name === 'textAlign');
if (!alignKnob) die('hero 的旋钮里没有 textAlign（正文的例子用它）');
const center = alignKnob.values.find((v) => v !== alignKnob.default);
const heroShapes = hero.shapes.map((x) => x.name);
for (const sh of ['split', 'cover']) if (!heroShapes.includes(sh)) die(`hero 的形态里没有 ${sh}（${heroShapes.join(', ')}）`);
for (const act of ['longer', 'shorter', 'casual', 'professional']) if (!rewriteActions.includes(act)) die(`REWRITE_ACTIONS 里没有 ${act}`);
if (rewriteActions.length !== 4) die(`REWRITE_ACTIONS 现在是 ${rewriteActions.length} 个（${rewriteActions}）—— 这份测试按四个写的，先对一下记录该怎么说`);

const H = hero.label; const F = feat.label; const Q = faq.label; const B = bar.label;
const saved = {
  blocks: [
    { id: 'home-cta-0', type: 'cta', data: { [barText.slot]: 'Spring sale' } },
    { id: 'home-hero-1', type: 'hero', data: { headline: 'Old headline', subheadline: 'Old sub' } },
    { id: 'home-features-2', type: 'features', data: {} },
    { id: 'home-faq-3', type: 'faq', data: {} },
  ],
};
const edit = (fn) => { const j = JSON.parse(JSON.stringify(saved)); fn(j); return j; };
const run = (a) => describeSave({ saved, json: null, root: null, shared: null, schema, rootLabels, shapeLabel: 'Layout', ...a });
const at = (j, id) => j.blocks.find((b) => b.id === id);
// 按生效顺序（weight）把块排成 ids 那样：页面 JSON 的数组顺序不动，跟 puckToPage 结构不变时一样只写 weight。
const reorder = (ids) => edit((j) => { ids.forEach((id, i) => { at(j, id).weight = i * 10; }); });

console.log('① 手改文字槽：写新值（前 40 个字）');
eq(run({ json: edit((j) => { at(j, 'home-hero-1').data.subheadline = 'Fast, friendly plumbing'; }) }),
  `${H} · ${fieldLabel(hero, 'subheadline')} · "Fast, friendly plumbing"`, '改 Hero 的 Subheading');
eq(run({ json: edit((j) => { at(j, 'home-hero-1').data.subheadline = 'We fix leaks, clogs and water heaters across the whole city today'; }) }),
  `${H} · ${fieldLabel(hero, 'subheadline')} · "We fix leaks, clogs and water heaters ac…"`, '超过 40 个字截断 + 省略号');
const zh = '我们二十四小时上门维修水管漏水堵塞热水器问题，价格透明，不满意不收费，欢迎来电咨询预约';
eq(run({ json: edit((j) => { at(j, 'home-hero-1').data.headline = zh; }) }),
  `${H} · ${fieldLabel(hero, 'headline')} · "${Array.from(zh).slice(0, 40).join('')}…"`, `多语言照原文，按字符数不按字节（${Array.from(zh).length} 个字 → 40）`);
eq(run({ json: edit((j) => { at(j, 'home-hero-1').data.headline = '  two\n\n lines  '; }) }), `${H} · ${fieldLabel(hero, 'headline')} · "two lines"`, '空白压成一个空格');
eq(run({ json: edit((j) => { at(j, 'home-hero-1').data.headline = ''; }) }), `${H} · ${fieldLabel(hero, 'headline')} · (empty)`, '删光了');
eq(run({ json: edit((j) => { at(j, 'home-hero-1').data.subheadline = 'b'; at(j, 'home-hero-1').data.headline = 'a'; }) }),
  `${H} · ${fieldLabel(hero, 'headline')} · "a"; ${H} · ${fieldLabel(hero, 'subheadline')} · "b"`, '一块两个文字槽：各一段，照 schema 字段顺序');
eq(run({ json: edit((j) => { at(j, 'home-cta-0').data[barText.slot] = 'x'; at(j, 'home-hero-1').data.headline = 'y'; }) }),
  `${B} · ${barText.label} · "x"; ${H} · ${fieldLabel(hero, 'headline')} · "y"`, '两个块');

console.log('② 非文字槽：照旧只说字段名');
eq(run({ json: edit((j) => { at(j, 'home-hero-1').data[heroNonText.slot] = [{ value: '1' }]; }) }), `${H} · ${heroNonText.label}`, `改 Hero 的 ${heroNonText.label}`);

console.log('③ AI 按钮：写动作（四个）');
const phrase = { longer: 'made longer', shorter: 'made shorter', casual: 'more casual', professional: 'more professional' };
for (const act of rewriteActions) {
  eq(run({ json: edit((j) => { at(j, 'home-hero-1').data.headline = 'AI text'; }), aiNotes: { 'id:home-hero-1': { headline: act } } }),
    `${H} · ${fieldLabel(hero, 'headline')} · ${phrase[act]}`, `AI ${act}`);
}
eq(run({ json: edit((j) => { at(j, 'home-hero-1').data.headline = 'AI text'; at(j, 'home-hero-1').data.subheadline = 'typed'; }), aiNotes: { 'id:home-hero-1': { headline: 'shorter' } } }),
  `${H} · ${fieldLabel(hero, 'headline')} · made shorter; ${H} · ${fieldLabel(hero, 'subheadline')} · "typed"`, '同一块：一格 AI、一格手改');
eq(run({ json: edit((j) => { at(j, 'home-hero-1').data.subheadline = 'typed'; }), aiNotes: { 'id:home-hero-1': { headline: 'shorter' } } }),
  `${H} · ${fieldLabel(hero, 'subheadline')} · "typed"`, '说明对应的字段这一笔没变 ⟹ 不说它');

console.log('④ 换形态 / 旋钮');
eq(run({ json: edit((j) => { at(j, 'home-hero-1').shape = 'split'; }) }), `${H} · Layout → split`, '换成 split');
eq(run({ json: edit((j) => { at(j, 'home-hero-1').shape = 'cover'; }) }), `${H} · Layout → cover`, '换成 cover：写形态 id，不写面板上的「cover (needs image)」');
eq(describeSave({ saved: edit((j) => { at(j, 'home-hero-1').shape = 'split'; }), json: saved, root: null, shared: null, schema, rootLabels, shapeLabel: 'Layout' }),
  `${H} · Layout → (default)`, '换回跟主题走');
eq(run({ json: edit((j) => { at(j, 'home-hero-1').data[heroOpts.slot] = { textAlign: center }; }) }),
  `${H} · ${heroOpts.label} → textAlign = ${center}`, `旋钮 textAlign → ${center}`);
// 带预设的块编辑器里没有形态下拉，换版式 = 点预设。「点了之后的数据」用面板同一个函数造（§presetClickProps），不手写。
const optsOf = (c) => c.fields.find((f) => f.control === 'options' && (f.presets || []).length);
const click = (c, data, name) => presetClickProps(optsOf(c), JSON.parse(JSON.stringify(data)), name);
const presetSave = (c, beforeData, afterData) => describeSave({
  saved: { blocks: [{ id: 'p', type: c.type, data: beforeData }] }, json: { blocks: [{ id: 'p', type: c.type, data: afterData }] },
  root: null, shared: null, schema, rootLabels, shapeLabel: 'Layout',
});
const presetNamed = (c, name) => { const p = optsOf(c).presets.find((x) => x.name === name); if (!p) die(`${c.type} 没有叫 ${name} 的预设`); return p; };
const fromCentered = click(hero, {}, presetNamed(hero, 'Centered').name);
eq(presetSave(hero, fromCentered, click(hero, fromCentered, 'Split')), `${H} · Layout → split`, '从 Centered 点 Split 预设 ⟹ 说成换了形态（写形态 id）');
eq(presetSave(hero, click(hero, {}, 'Split'), fromCentered), `${H} · Layout → centered`, '从 Split 点 Centered');
const tweak = Object.keys(presetNamed(hero, 'Split').knobs).find((n) => n !== 'textAlign');
const splitData = click(hero, {}, 'Split');
const tweakTo = heroOpts.knobs.find((k) => k.name === tweak).values.find((v) => v !== splitData[heroOpts.slot][tweak]
  && !heroOpts.presets.some((p) => Object.entries({ ...splitData[heroOpts.slot], [tweak]: v }).every(([n, x]) => p.knobs[n] === x)));
eq(presetSave(hero, splitData, { ...splitData, [heroOpts.slot]: { ...splitData[heroOpts.slot], [tweak]: tweakTo } }),
  `${H} · ${heroOpts.label} → ${tweak} = ${tweakTo}`, `在 Split 上单拧一个旋钮（不再是任何预设）⟹ 说旋钮`);
// #1676 QA1 r1 —— pricing 的 Plan cards 与 Rainbow 旋钮一模一样、只差颜色：判「哪个预设」要连颜色一起比（跟面板同一个判法）。
const pricing = label('pricing');
const P = pricing.label;
const sideIntro = click(pricing, {}, 'Side intro');
const planCards = click(pricing, {}, 'Plan cards');
const rainbow = click(pricing, planCards, 'Rainbow');
if (JSON.stringify(planCards.options) !== JSON.stringify(rainbow.options)) die('pricing 的 Plan cards 与 Rainbow 旋钮不再相同了 —— 这一格的前提变了，先对一下');
eq(presetSave(pricing, sideIntro, click(pricing, sideIntro, 'Rainbow')), `${P} · Layout → rainbow`, 'Pricing：Side intro → Rainbow 说 rainbow（不是同旋钮的 plan-cards），颜色字段不另列');
eq(presetSave(pricing, planCards, rainbow), `${P} · Layout → rainbow`, 'Pricing：Plan cards → Rainbow（旋钮一个没变，只变了颜色）');
eq(presetSave(pricing, rainbow, click(pricing, rainbow, 'Plan cards')), `${P} · Layout → plan-cards`, 'Pricing：Rainbow → Plan cards');
// #1487 —— 带部件的预设（team 的 Hiring）：那个部件有内容才算它；点它会用 demo 把空部件填上。
const team = label('team');
const cards = click(team, {}, 'Cards');
eq(presetSave(team, cards, click(team, cards, 'Hiring')), `${team.label} · Layout → hiring`, 'Team：Cards → Hiring（部件 Join 顺带填上，不另列）');
eq(describeSave({ saved: edit((j) => { at(j, 'home-hero-1').data[heroOpts.slot] = { textAlign: center, [tweak]: tweakTo }; }), json: edit((j) => { at(j, 'home-hero-1').data[heroOpts.slot] = { [tweak]: tweakTo }; }), root: null, shared: null, schema, rootLabels, shapeLabel: 'Layout' }),
  `${H} · ${heroOpts.label} → textAlign = (default)`, '旋钮回到默认（键没了），前后都不是任何预设');
console.log('⑤ 加 / 删 / 挪');
eq(run({ json: edit((j) => { j.blocks.push({ id: 'home-hero-9', type: 'hero', data: {} }); }) }), `Added ${H}`, '加一块');
eq(run({ json: edit((j) => { j.blocks.splice(3, 1); }) }), `Removed ${Q}`, '删一块');
eq(run({ json: reorder(['home-features-2', 'home-cta-0', 'home-hero-1', 'home-faq-3']) }), `Moved ${F} up`, 'Features 往上挪两格（只有它满足「拿掉它其余不变」）');
eq(run({ json: reorder(['home-cta-0', 'home-hero-1', 'home-faq-3', 'home-features-2']) , dragged: ['id:home-features-2'] }), `Moved ${F} down`, 'Features 往下挪一格（相邻对调，拖的是它）');
eq(run({ json: reorder(['home-cta-0', 'home-features-2', 'home-hero-1', 'home-faq-3']), dragged: ['id:home-features-2'] }), `Moved ${F} up`, 'Features 往上挪一格（相邻对调，拖的是它）');
eq(run({ json: reorder(['home-cta-0', 'home-features-2', 'home-hero-1', 'home-faq-3']), dragged: ['id:home-hero-1'] }), `Moved ${H} down`, '同一个结果，拖的是 Hero ⟹ 说 Hero');
eq(run({ json: reorder(['home-cta-0', 'home-features-2', 'home-hero-1', 'home-faq-3']) }), 'Section order', '相邻对调又不知道拖的是谁 ⟹ 不猜');
eq(run({ json: reorder(['home-cta-0', 'home-features-2', 'home-hero-1', 'home-faq-3']), dragged: ['id:home-features-2', 'id:home-hero-1'] }),
  `Moved ${H} down`, '这一笔里两块都拖过 ⟹ 说最后拖的那块');
eq(run({ json: reorder(['home-hero-1', 'home-cta-0', 'home-faq-3', 'home-features-2']), dragged: ['id:home-hero-1', 'id:home-faq-3'] }), 'Section order', '两块以上换了位置 ⟹ 不猜方向');
eq(run({ json: edit((j) => { j.blocks.forEach((b, i) => { b.weight = i * 10; }); }) }), 'Saved changes in the page editor.', '只重写了 weight、顺序没变 ⟹ 不说挪了');
// 数组顺序 ≠ 生效顺序：文件里 Features 写在最前面、weight 让它排第三。比的是生效顺序。
const weighted = { blocks: [{ ...saved.blocks[2], weight: 20 }, { ...saved.blocks[0], weight: 0 }, { ...saved.blocks[1], weight: 10 }, { ...saved.blocks[3], weight: 30 }] };
const weightedMoved = JSON.parse(JSON.stringify(weighted)); weightedMoved.blocks[0].weight = 5;
eq(describeSave({ saved: weighted, json: weightedMoved, root: null, shared: null, schema, rootLabels, dragged: ['id:home-features-2'] }),
  `Moved ${F} up`, '按 weight 排的顺序比，不按数组下标');
eq(run({ json: edit((j) => { j.blocks.splice(0, 1); j.blocks.forEach((b, i) => { b.weight = i * 10; }); }) }), `Removed ${B}`, '删一块、后面的 weight 全重写 ⟹ 只说删了，不说挪了');

// #1703 —— 按 `visibility` 注进这一页的共用块：不在文件里、却在页面上（位置 = 它自带的 weight）。老板挪它，它才第一次以
// `{ref}` 写进文件 —— 那是挪，不是加。权重用写路径自己那一份（§assignWeights）算，不手写：记录要描述的就是它写下去的东西。
const { assignWeights } = require('./lib/editor-convert.js');
const content1703 = label('content');
const C = content1703.label;
const lib1703 = { everywhere: { type: 'content', visibility: ['*'], weight: 25, data: {} } }; // 页面上：cta hero features [它] faq
// 画布顺序 → 页面 JSON：`'X'` = 它被拖过（写成 `{ref}`）；`'x'` = 没拖过（仍是锚点，不进文件）。
const canvas1703 = (order) => {
  const slots = order.map((k) => ({ anchor: k === 'x' ? lib1703.everywhere.weight : null }));
  const w = assignWeights(slots);
  const blocks = [];
  order.forEach((k, i) => {
    if (k === 'x') return;
    blocks.push(k === 'X' ? { ref: 'everywhere', weight: w[i] } : { ...saved.blocks.find((b) => b.id === k), weight: w[i] });
  });
  return { blocks };
};
const s1703 = (a) => run({ siteBlocks: lib1703, slug: 'home', ...a });
const up1703 = s1703({ json: canvas1703(['home-cta-0', 'home-hero-1', 'X', 'home-features-2', 'home-faq-3']), dragged: ['ref:everywhere'] });
eq(up1703, `Moved ${C} up`, '#1703 挪「所有页面」的共用块往上一格（第一次写进文件）⟹ 挪，不是加');
if (/Added/.test(up1703)) bad(`#1703 记录里出现了 Added：${up1703}`); else ok('#1703 记录里没有 Added');
eq(s1703({ json: canvas1703(['home-cta-0', 'home-hero-1', 'home-features-2', 'home-faq-3', 'X']), dragged: ['ref:everywhere'] }),
  `Moved ${C} down`, '#1703 同一块往下挪到最后');
eq(s1703({ json: canvas1703(['X', 'home-cta-0', 'home-hero-1', 'home-features-2', 'home-faq-3']), dragged: ['ref:everywhere'] }),
  `Moved ${C} up`, '#1703 挪到最上面（隔了好几块）');
// 普通块越过它：文件里那四条相对顺序一点没变，只有 weight 变了 —— 比的是页面上的顺序。
const overAnchor = canvas1703(['home-cta-0', 'home-hero-1', 'home-features-2', 'home-faq-3', 'x']);
eq(s1703({ json: overAnchor, dragged: ['id:home-faq-3'] }), `Moved ${Q} up`, '#1703 把 FAQ 拖到共用块上面（文件里的相对顺序没变）');
eq(s1703({ json: overAnchor }), 'Section order', '#1703 同一个结果、不知道拖的是谁 ⟹ 照旧不猜');
// 边界：只有 visibility 真命中这一页的才算「本来就在」。
eq(run({ siteBlocks: { everywhere: { ...lib1703.everywhere, visibility: ['home'] } }, slug: 'home',
  json: canvas1703(['home-cta-0', 'home-hero-1', 'X', 'home-features-2', 'home-faq-3']), dragged: ['ref:everywhere'] }), `Moved ${C} up`, '#1703 visibility 列了这一页（不是 "*"）同样是挪');
eq(run({ siteBlocks: { everywhere: { ...lib1703.everywhere, visibility: ['about'] } }, slug: 'home',
  json: canvas1703(['home-cta-0', 'home-hero-1', 'X', 'home-features-2', 'home-faq-3']) }), `Added ${C}`, '#1703 visibility 不含这一页 ⟹ 它本来不在这一页，写进来就是加');
eq(run({ siteBlocks: { everywhere: { ...lib1703.everywhere, visibility: 'home' } }, slug: 'home',
  json: canvas1703(['home-cta-0', 'home-hero-1', 'X', 'home-features-2', 'home-faq-3']) }), `Added ${C}`, '#1703 字符串 visibility 跟构建一样当没写');

console.log('⑥ 外壳：选一项的字段带上新值');
// 📌 #1425（T3）—— 这里原来还测「公告条文字只说字段名」（topbarMessage）；公告条那个区随旧库删了，今天外壳三样全是选一项。
eq(run({ root: { layout: 'standard' } }), `${rootLabels.layout} → standard`, '改 Page layout');
eq(run({ root: { headerShape: 'topbar' } }), `${rootLabels.headerShape} → topbar`, '改 Header style');
eq(run({ root: { footerShape: '' } }), `${rootLabels.footerShape} → (default)`, '把 Footer style 改回默认');
eq(run({ json: edit((j) => { at(j, 'home-cta-0').data[barText.slot] = 'x'; }), root: { layout: 'standard' } }),
  `${B} · ${barText.label} · "x"; ${rootLabels.layout} → standard`, '页面 + 外壳同一笔');
// #1681 —— Business info 四样是文字框（#1776 起组名 Name & contact、记录前缀 Website settings）：跟块文字同一个规矩（写新值），清空写 (empty)。字段名照 EditorApp.tsx 的 ROOT_SAVE_LABELS 形状。
const biz = { phone: 'Website settings · Phone', brandName: 'Website settings · Website name', address: 'Website settings · Address' };
eq(run({ root: { phone: '647-555-0199' }, rootLabels: biz }), 'Website settings · Phone · "647-555-0199"', '改电话：写新号码');
eq(run({ root: { brandName: '港湾面包坊' }, rootLabels: biz }), 'Website settings · Website name · "港湾面包坊"', '改名字（中文）');
eq(run({ root: { phone: '' }, rootLabels: biz }), 'Website settings · Phone · (empty)', '清空电话');
// #1776 —— 记录前缀住在 EditorApp.tsx 的 ROOT_SAVE_LABELS：联系方式四样 + 布局带「Website settings · 」，顶栏 / 页脚那几样不带。
{
  const src = fs.readFileSync(path.join(__dirname, '..', 'src/components/editor/EditorApp.tsx'), 'utf8');
  const blk = (src.match(/const ROOT_SAVE_LABELS[^=]*=\s*\{([\s\S]*?)\n\};/) || [])[1] || '';
  eq(/\.\.\.ROOT_FIELD_LABELS,[\s\S]*`Website settings · \$\{v\}`[\s\S]*layout: `Website settings · \$\{ROOT_FIELD_LABELS\.layout\}`/.test(blk), true,
    'ROOT_SAVE_LABELS：摊开 ROOT_FIELD_LABELS 之后，联系方式四样和 layout 都改写成 Website settings · …');
  eq(/(headerShape|footerShape|headerOptions|footerOptions)\s*:/.test(blk), false, 'ROOT_SAVE_LABELS 不另写顶栏 / 页脚四样（它们照旧是 Header · … / Footer · …）');
}
eq(run({ root: { address: 'A'.repeat(50), layout: 'standard' }, rootLabels: { ...rootLabels, ...biz } }),
  `${rootLabels.layout} → standard; Website settings · Address · "${'A'.repeat(40)}…"`, '长地址截 40 个字 + 同一笔改版式（按 schema.root.fields 的顺序）');

console.log('⑦ 共用块：按块库里那一块的类型取名');
eq(run({ shared: { 'site-bar': { data: { [barText.slot]: 'x' }, was: {} } }, siteBlocks: { 'site-bar': { type: 'cta', data: {} } } }),
  `${B} · ${barText.label} · "x"`, '改共用块的字');
eq(run({ shared: { 'site-bar': { data: { [barText.slot]: 'x' }, was: {} } }, siteBlocks: { 'site-bar': { type: 'cta', data: {} } }, aiNotes: { 'shared:site-bar': { [barText.slot]: 'casual' } } }),
  `${B} · ${barText.label} · more casual`, '共用块上按 AI');
eq(run({ shared: { 'site-bar': { unlist: true } }, siteBlocks: { 'site-bar': { type: 'cta', data: {} } } }),
  `${B} (removed from this page)`, '从这一页拿掉共用块');
// #1684 —— 共用块换预设（§describeSave 的 shared 段整块比那一行）。块库里那一份停在 Centered，老板在面板上点 Split：
// 这一笔交的 `data` 是点完之后变了的那几格、`was` 是它们原来的值 —— 都用面板同一个函数（§presetClickProps）点出来再取差，
// 不手写旋钮；预设名、形态 id、块名照样从 schema 现取。
const sharedHero = { 'site-hero': { type: 'hero', data: fromCentered } };
const toSplit = click(hero, fromCentered, presetNamed(hero, 'Split').name);
const splitDiff = Object.keys(toSplit).filter((k) => JSON.stringify(toSplit[k]) !== JSON.stringify(fromCentered[k]));
if (!splitDiff.length) die('从 Centered 点 Split 什么都没变 —— 这格测不到换预设');
const sharedSwitch = {
  data: Object.fromEntries(splitDiff.map((k) => [k, toSplit[k]])),
  was: Object.fromEntries(splitDiff.filter((k) => k in fromCentered).map((k) => [k, fromCentered[k]])),
};
eq(run({ shared: { 'site-hero': sharedSwitch }, siteBlocks: sharedHero }),
  `${H} · Layout → ${presetNamed(hero, 'Split').shape}`, '共用块：从 Centered 点 Split 预设 ⟹ 说成换了形态');
const sharedText = run({ shared: { 'site-hero': { data: { headline: 'x' }, was: { headline: fromCentered.headline } } }, siteBlocks: sharedHero });
eq(sharedText.includes('Layout →') ? sharedText : 'no-switch', 'no-switch', `共用块只改文字、没换预设 ⟹ 没有 Layout →（${sharedText}）`);

console.log('⑧ 反向：比的底是「上一次存下去的那份」，不是打开时那份');
// 第一笔改了 cta 并存下（saved 变成那一份），第二笔只改 headline：第二条记录不许把 cta 再说一遍。
const afterFirst = edit((j) => { at(j, 'home-cta-0').data[barText.slot] = 'first save'; });
const second = JSON.parse(JSON.stringify(afterFirst)); at(second, 'home-hero-1').data.headline = 'second save';
eq(describeSave({ saved: afterFirst, json: second, root: null, shared: null, schema, rootLabels }),
  `${H} · ${fieldLabel(hero, 'headline')} · "second save"`, '连存两笔，第二笔只说它自己');
eq(describeSave({ saved, json: second, root: null, shared: null, schema, rootLabels }),
  `${B} · ${barText.label} · "first save"; ${H} · ${fieldLabel(hero, 'headline')} · "second save"`,
  '（对照）拿打开时那份当底，就会把第一笔又说一遍 —— 所以调用方必须传 saved');

console.log('⑨ AI 说明的三条作废规矩（编辑器那一侧的三个纯函数）');
// Puck 画布上的一块：props.id 是 Puck id，_src.entry 是页面 JSON 里那一条。
const canvas = (headline, sub) => [{ type: 'hero', props: { id: 'puck-hero', headline, subheadline: sub, _src: { entry: { id: 'home-hero-1', type: 'hero' }, shared: null } } }];
let notes = recordAiNote({}, { id: 'puck-hero', path: ['headline'], action: 'shorter', text: 'Short' });
let r = aiNotesForSave(notes, canvas('Short', 'Old sub'));
eq(JSON.stringify(r.aiNotes), JSON.stringify({ 'id:home-hero-1': { headline: 'shorter' } }), 'AI 写完、没再动：说明换成页面 JSON 的块键');
// 规矩 ①：AI 改完又手改 ⟹ 画布上那一格不是 AI 写的那段字了 ⟹ 说明不用，记录写新值。
r = aiNotesForSave(notes, canvas('Short — typed after', 'Old sub'));
eq(JSON.stringify(r.aiNotes), '{}', '① 同一字段 AI 之后又手改 ⟹ 说明作废');
eq(run({ json: edit((j) => { at(j, 'home-hero-1').data.headline = 'Short — typed after'; }), aiNotes: r.aiNotes }),
  `${H} · ${fieldLabel(hero, 'headline')} · "Short — typed after"`, '① 记录写的是新值，不是 made shorter');
// 规矩 ②：同一笔里同一字段按了两次 ⟹ 只说最后一次。
notes = recordAiNote(recordAiNote({}, { id: 'puck-hero', path: ['headline'], action: 'longer', text: 'Long' }), { id: 'puck-hero', path: ['headline'], action: 'shorter', text: 'Short' });
r = aiNotesForSave(notes, canvas('Short', 'Old sub'));
eq(run({ json: edit((j) => { at(j, 'home-hero-1').data.headline = 'Short'; }), aiNotes: r.aiNotes }),
  `${H} · ${fieldLabel(hero, 'headline')} · made shorter`, '② Longer 再 Shorter ⟹ 只说 made shorter');
// 规矩 ③：这一笔被拒（stale）⟹ 不清，下一笔照样带；存上了才清。存的途中又按了一次的那条不清。
const used = r.used;
eq(JSON.stringify(Object.keys(notes['puck-hero'])), '["headline"]', '③ 被拒：notes 原样留着（调用方不调 settle）');
r = aiNotesForSave(notes, canvas('Short', 'Old sub'));
eq(JSON.stringify(r.aiNotes), JSON.stringify({ 'id:home-hero-1': { headline: 'shorter' } }), '③ 被拒之后的下一笔仍带着它');
eq(JSON.stringify(settleAiNotes(notes, used)), '{}', '③ 存上了 ⟹ 用掉的那条清掉');
const again = recordAiNote(notes, { id: 'puck-hero', path: ['headline'], action: 'casual', text: 'Hey' });
eq(JSON.stringify(settleAiNotes(again, used)['puck-hero'].headline.action), '"casual"', '③ 存的途中又按了一次 ⟹ 新那条不清');
// 列表里的一格（path 多层）：说明按顶层字段记，值按整条 path 核。
const listCanvas = (q) => [{ type: 'faq', props: { id: 'puck-faq', items: [{ question: q }], _src: { entry: { id: 'home-faq-3', type: 'faq' }, shared: null } } }];
notes = recordAiNote({}, { id: 'puck-faq', path: ['items', 0, 'question'], action: 'professional', text: 'Q?' });
eq(JSON.stringify(aiNotesForSave(notes, listCanvas('Q?')).aiNotes), JSON.stringify({ 'id:home-faq-3': { items: 'professional' } }), '列表里的一格：记在顶层字段上');
eq(JSON.stringify(aiNotesForSave(notes, listCanvas('Q? edited')).aiNotes), '{}', '列表里那一格后来手改过 ⟹ 作废');
// 共用块按块库 id；不认识的动作不记。
const sharedCanvas = [{ type: 'cta', props: { id: 'puck-bar', [barText.slot]: 'S', _src: { entry: { ref: 'site-bar' }, shared: 'site-bar' } } }];
eq(JSON.stringify(aiNotesForSave(recordAiNote({}, { id: 'puck-bar', path: [barText.slot], action: 'casual', text: 'S' }), sharedCanvas).aiNotes),
  JSON.stringify({ 'shared:site-bar': { [barText.slot]: 'casual' } }), '共用块：键是 shared:<块库 id>');
eq(JSON.stringify(recordAiNote({}, { id: 'puck-bar', path: [barText.slot], action: 'rhyme', text: 'S' })), '{}', '不认识的动作不记');

// #1713 —— 画布图上的 ✨ Regenerate：说明的 path 指到地址那一格（`image.imageUrl`），text 是新图地址。整条从编辑器那一侧的
//    纯函数走到 §describeSave，不手写 aiNotes。
// #1733 —— 块里那一格图换了就说动作：带「生成」说明 ⟹ `Hero · Generate and replace image`；不带 ⟹ `Hero · Change image`。
console.log('⑩ #1713 / #1733 换图：Generate and replace image / Change image');
const heroImg = fieldLabel(hero, 'image');
if (heroImg !== 'Image') die(`hero 那一格图的 editLabel 现在是 ${heroImg}（正文的例子按 Image 写）`);
const imgCanvas = (url) => [{ type: 'hero', props: { id: 'puck-hero', image: { imageUrl: url, alt: 'A van' }, _src: { entry: { id: 'home-hero-1', type: 'hero' }, shared: null } } }];
const imgSaved = edit((j) => { at(j, 'home-hero-1').data.image = { imageUrl: '/photos/old.jpg', alt: 'A van' }; });
const imgJson = (url) => { const j = JSON.parse(JSON.stringify(imgSaved)); at(j, 'home-hero-1').data.image = { imageUrl: url, alt: 'A van' }; return j; };
const sayImg = (a) => describeSave({ root: null, shared: null, schema, rootLabels, shapeLabel: 'Layout', ...a });
notes = recordAiNote({}, { id: 'puck-hero', path: ['image', 'imageUrl'], action: 'generated', text: '/uploads/new.png' });
r = aiNotesForSave(notes, imgCanvas('/uploads/new.png'));
eq(sayImg({ saved: imgSaved, json: imgJson('/uploads/new.png'), aiNotes: r.aiNotes }),
  'Hero · Generate and replace image', '带「生成」说明的 hero 换图（Regenerate / 弹窗 Generate）');
eq(sayImg({ saved: imgSaved, json: imgJson('/uploads/new.png'), aiNotes: {} }),
  'Hero · Change image', '同一笔去掉「生成」说明 ⟹ Change image（上传 / 图库已有的 / 面板 Change）');
// 第二笔：老板在弹窗里点回上一张。第一笔已经存上（说明清掉了），这一笔的底是第一笔存下去的那份。
const settled = settleAiNotes(notes, r.used);
eq(sayImg({ saved: imgJson('/uploads/new.png'), json: imgJson('/photos/old.jpg'), aiNotes: aiNotesForSave(settled, imgCanvas('/photos/old.jpg')).aiNotes }),
  'Hero · Change image', 'Regenerate 之后点回上一张：第二笔 Change image');
// 第一笔还没存上就换回去了（说明还在）：那一格已经不是生成的那张 ⟹ 说明作废。
eq(JSON.stringify(aiNotesForSave(notes, imgCanvas('/photos/old.jpg')).aiNotes), '{}', '换回去了还没存 ⟹ 说明作废');
// 槽名不是 Image 的：照槽名小写。
const intro = field(feat, 'introImage');
if (intro.control !== 'image' || intro.label !== 'Intro image') die(`features.introImage 现在是 ${intro.control} / ${intro.label}`);
const featSaved = edit((j) => { at(j, 'home-features-2').data.introImage = { imageUrl: '/a.jpg', alt: '' }; });
const featJson = edit((j) => { at(j, 'home-features-2').data.introImage = { imageUrl: '/b.jpg', alt: '' }; });
eq(sayImg({ saved: featSaved, json: featJson }), `${F} · Change intro image`, 'features Intro image 换图');
eq(sayImg({ saved: featSaved, json: featJson, aiNotes: { 'id:home-features-2': { introImage: 'generated' } } }),
  `${F} · Generate and replace intro image`, 'features Intro image 生成换上');
// 同一块里图和别的字段一起改：图那一段单独说（Band 是 hero 的图片条，只说字段名）。
const band = field(hero, 'band');
eq(sayImg({ saved: imgSaved, json: (() => { const j = imgJson('/uploads/new.png'); at(j, 'home-hero-1').data.band = [{ imageUrl: '/x.jpg' }]; return j; })() }),
  `Hero · ${band.label}; Hero · Change image`, 'hero 图和 Band 一起改 ⟹ 拆成两段');
eq(sayImg({ saved: imgSaved, json: (() => { const j = imgJson('/uploads/new.png'); at(j, 'home-hero-1').data.headline = 'New'; return j; })() }),
  'Hero · Headline · "New"; Hero · Change image', '图 + 标题一起改');
// 不算换图的：只改了图片说明 / 把图删了 ⟹ 照旧只说字段名。
eq(sayImg({ saved: imgSaved, json: edit((j) => { at(j, 'home-hero-1').data.image = { imageUrl: '/photos/old.jpg', alt: 'A red van' }; }) }),
  'Hero · Image', '只改图片说明（alt）⟹ 不是换图');
eq(sayImg({ saved: imgSaved, json: edit((j) => { delete at(j, 'home-hero-1').data.image; }) }), 'Hero · Image', '把图删了 ⟹ 不是换图');
// 不做：成排的图换一张（logos 一排）仍是 `Logos · Items` —— 带不带说明都一样。
const logos = label('logos');
const logoItems = field(logos, 'items');
const logoSaved = { blocks: [{ id: 'home-logos-1', type: 'logos', data: { items: [{ imageUrl: '/l1.png', alt: 'Acme' }, { imageUrl: '/l2.png', alt: 'Beta' }] } }] };
const logoJson = JSON.parse(JSON.stringify(logoSaved)); logoJson.blocks[0].data.items[1].imageUrl = '/l3.png';
eq(sayImg({ saved: logoSaved, json: logoJson }), `${logos.label} · ${logoItems.label}`, 'logos 一排换一张：仍是 Logos · Items');
eq(`${logos.label} · ${logoItems.label}`, 'Logos · Items', '块名 / 字段名就是正文写的那两个');
console.log('⑪ #1723 画布条目条：删 / 上移 / 下移 各记一条，记录写 块 · 字段 · item N …');
{
  const { itemListsOf, itemOp, recordItemNote } = require('./lib/editor-convert.js');
  const statsList = itemListsOf(hero).find((l) => l.path.join('.') === 'stats');
  if (!statsList) die('itemListsOf(hero) 里没有 stats');
  const S = statsList.label;
  const six = ['A', 'B', 'C', 'D', 'E', 'F'].map((v) => ({ value: v, label: `${v} label` }));
  const savedStats = { blocks: [{ id: 'home-hero-1', type: 'hero', data: { headline: 'H', stats: six } }] };
  const heroCanvas = (stats) => [{ type: 'hero', props: { id: 'puck-hero', headline: 'H', stats, _src: { entry: { id: 'home-hero-1', type: 'hero' }, shared: null } } }];
  const say = (stats, notes) => describeSave({
    saved: savedStats, json: { blocks: [{ id: 'home-hero-1', type: 'hero', data: { headline: 'H', stats } }] },
    root: null, shared: null, schema, rootLabels, aiNotes: aiNotesForSave(notes, heroCanvas(stats)).aiNotes,
  });
  const values = (l) => l.map((x) => x.value).join('');
  const step = (notes, list, index, op) => {
    const after = itemOp(list, index, op, statsList.min);
    return { after, notes: recordItemNote(notes, { id: 'puck-hero', slot: statsList.slot, path: statsList.path, op, index, before: list, after }) };
  };
  // 删第 3 格
  let r = step({}, six, 2, 'remove');
  eq(values(r.after), 'ABDEF', '删第 3 格：剩下的是原来的 1 2 4 5 6（按值比，不只比长度）');
  eq(say(r.after, r.notes), `${H} · ${S} · item 3 removed`, '删第 3 格 ⟹ 记录');
  // 第 2 格上移
  r = step({}, six, 1, 'up');
  eq(values(r.after), 'BACDEF', '第 2 格上移：它成了第 1 格');
  eq(say(r.after, r.notes), `${H} · ${S} · item 2 moved up`, '第 2 格上移 ⟹ 记录');
  // 第 2 格下移
  r = step({}, six, 1, 'down');
  eq(values(r.after), 'ACBDEF', '第 2 格下移：它成了第 3 格');
  eq(say(r.after, r.notes), `${H} · ${S} · item 2 moved down`, '第 2 格下移 ⟹ 记录');
  // 同一列连按两下（一笔里）⟹ 接着说
  const r1 = step({}, six, 2, 'remove');
  const r2 = step(r1.notes, r1.after, 0, 'down');
  eq(say(r2.after, r2.notes), `${H} · ${S} · item 3 removed, item 1 moved down`, '同一笔里连按两下 ⟹ 两下都说');
  // 按完又在面板上动过（列表不是最后一下之后的样子）⟹ 侧记作废，照常只说字段名
  eq(say(r1.after.slice(0, 3), r1.notes), `${H} · ${S}`, '按完之后列表又变了 ⟹ 侧记作废，只说字段名');
  // 到头 / 到下限按不了
  eq(itemOp(six, 0, 'up'), null, '第 1 格不能再上移');
  eq(itemOp(six, 5, 'down'), null, '最后一格不能再下移');
  eq(itemOp([{}], 0, 'remove', 1), null, '到下限（min 1、剩 1 项）不能删');
  eq(JSON.stringify(itemOp([{ a: 1 }], 0, 'remove')), '[]', '没写下限 ⟹ 能删到 0');
  // 存上了 ⟹ 用掉的侧记清掉
  const used = aiNotesForSave(r.notes, heroCanvas(r.after)).used;
  eq(JSON.stringify(settleAiNotes(r.notes, used)), '{}', '存上了 ⟹ 用掉的那条清掉');
  // AI 说明和条目条在同一字段上并排说（AI 改了第 1 格的字，又删了第 3 格）
  const both = recordAiNote(r1.notes, { id: 'puck-hero', path: ['stats', 0, 'value'], action: 'shorter', text: 'A' });
  eq(say(r1.after, both), `${H} · ${S} · made shorter, item 3 removed`, 'AI 说明 + 条目条在同一字段 ⟹ 并排说');
}

// #1738 —— 顶栏 / 页脚 Customize 那一笔：只说生效值真变了的那几格（QA2 r1：没动的 Layout / Brand 也被报成改了），
// 同一笔里换了预设 ⟹ 不再补一个光秃秃的区名（QA2 r1：`Footer · Layout → slim-row; Footer`）。
// 存下去的对象用面板自己那条路（§regionKnobChange / §regionPresetPick）造，不手写：手写的那份跟面板存的不是同一个形状就白测了。
{
  const ro = require('./lib/region-options.js');
  for (const f of ['headerOptions', 'footerOptions']) if (!rootLabels[f]) die(`ROOT_FIELD_LABELS 里没有 ${f}`);
  const HO = rootLabels.headerOptions; const FO = rootLabels.footerOptions;
  const say = (root, rootBefore) => describeSave({ saved: null, json: null, root, shared: null, schema, rootLabels, shapeLabel: 'Layout', rootBefore });
  // 页脚：只拧 form、再选深色底（QA2 r1 Q3 那一笔）
  const fShape = '';
  const fOpts = { ...ro.regionKnobChange('footer', fShape, {}, 'form', 'full'), bg: '#0f172a' };
  eq(Object.keys(fOpts).length > 2, true, '页脚拧一个旋钮存下的是整组生效值（所以记录必须按生效值比）');
  eq(say({ footerOptions: fOpts }, { footerShape: fShape }), `${FO} · Background; ${FO} · Form → full`, '页脚 form + 底色：没动的 Layout / Brand 不报');
  // 页脚：先存过旋钮，再在 Layout 页选预设（QA2 r1 Q4 那一笔）
  const pick = ro.regionPresetPick('footer', 'slim-row', fOpts);
  eq(say({ footerShape: pick.shape, footerOptions: pick.options }, { footerShape: fShape, footerOptions: fOpts }),
    `${rootLabels.footerShape} → ${pick.shape}`, '页脚选预设清旋钮：只说预设，底色留着不报、尾巴不补空区名');
  const pickH = ro.regionPresetPick('header', 'stacked', { menu: 'below', logo: 'center' });
  eq(say({ headerShape: pickH.shape, headerOptions: pickH.options }, { headerShape: '', headerOptions: { menu: 'below', logo: 'center' } }),
    `${rootLabels.headerShape} → ${pickH.shape}`, '顶栏选预设清旋钮：只说预设');
  // 顶栏 menu → below（耦合纠正会连 logo 一起动；动了的照实说，没动的不说）
  const hShape = '';
  const hOpts = ro.regionKnobChange('header', hShape, {}, 'menu', 'below');
  const effBefore = ro.effectiveRegionKnobs('header', hShape, {});
  const effAfter = ro.effectiveRegionKnobs('header', hShape, hOpts);
  const want = Object.keys(effAfter).filter((k) => effAfter[k] !== effBefore[k]).map((k) => `${HO} · ${ro.regionKnobLabel('header', k)} → ${effAfter[k]}`).join('; ');
  eq(want.includes(`${HO} · Menu → below`), true, '顶栏 menu → below 真改了 menu（造数自检）');
  eq(say({ headerOptions: hOpts }, { headerShape: hShape }), want, '顶栏 menu → below：只说生效值变了的那几格');
  // 不归预设管的开关（icons）：勾上 / 取消
  eq(say({ headerOptions: ro.regionKnobChange('header', hShape, {}, 'icons', true) }, { headerShape: hShape }), `${HO} · Icons → on`, '顶栏勾上 icons');
  eq(say({ headerOptions: {} }, { headerShape: hShape, headerOptions: { icons: true } }), `${HO} · Icons → off`, '顶栏取消 icons（键删掉 = 关）');
  eq(say({ headerOptions: {} }, { headerShape: hShape, headerOptions: { bg: '#0f172a' } }), `${HO} · Background → (default)`, '顶栏底色改回默认');
  // #1784 —— 名字跟面板同一份 label：logo 位置那个叫 Logo position（耦合纠正把它一起动了，上面 want 里就有它）。
  eq(want.includes(`${HO} · Logo position → center`), true, '#1784：顶栏 logo 位置那个旋钮在记录里叫 Logo position');
  // #1784 —— 不进预设的旋钮：只说拧了的那一个，名字是 label；换预设的同一笔里照样说（它不归预设管）。
  eq(say({ headerOptions: ro.regionKnobChange('header', hShape, {}, 'logoSize', 64) }, { headerShape: hShape }), `${HO} · Logo size → 64`, '#1784：拧 logoSize（r7：图高 px）');
  eq(say({ headerOptions: { logoType: 'text', logoSize: 64 } }, { headerShape: hShape, headerOptions: { logoSize: 64 } }), `${HO} · Logo → text`, '#1784：拧 logoType，没动的 logoSize 不报');
  const pickL = ro.regionPresetPick('header', 'topbar', { logoType: 'image', logoSize: 24 });
  eq(say({ headerShape: pickL.shape, headerOptions: pickL.options }, { headerShape: '', headerOptions: { logoType: 'image', logoSize: 24 } }),
    `${rootLabels.headerShape} → ${pickL.shape}`, '#1784：选预设 ⟹ logoType / logoSize 留着、不报');
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
