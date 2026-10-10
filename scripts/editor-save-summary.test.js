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

console.log('⑥ 外壳：选一项的字段带上新值');
// 📌 #1425（T3）—— 这里原来还测「公告条文字只说字段名」（topbarMessage）；公告条那个区随旧库删了，今天外壳三样全是选一项。
eq(run({ root: { layout: 'standard' } }), `${rootLabels.layout} → standard`, '改 Page layout');
eq(run({ root: { headerShape: 'topbar' } }), `${rootLabels.headerShape} → topbar`, '改 Header style');
eq(run({ root: { footerShape: '' } }), `${rootLabels.footerShape} → (default)`, '把 Footer style 改回默认');
eq(run({ json: edit((j) => { at(j, 'home-cta-0').data[barText.slot] = 'x'; }), root: { layout: 'standard' } }),
  `${B} · ${barText.label} · "x"; ${rootLabels.layout} → standard`, '页面 + 外壳同一笔');
// #1681 —— Business info 四样是文字框：跟块文字同一个规矩（写新值），清空写 (empty)。字段名照 EditorApp.tsx 的 ROOT_SAVE_LABELS 形状。
const biz = { phone: 'Business info · Phone', brandName: 'Business info · Website name', address: 'Business info · Address' };
eq(run({ root: { phone: '647-555-0199' }, rootLabels: biz }), 'Business info · Phone · "647-555-0199"', '改电话：写新号码');
eq(run({ root: { brandName: '港湾面包坊' }, rootLabels: biz }), 'Business info · Website name · "港湾面包坊"', '改名字（中文）');
eq(run({ root: { phone: '' }, rootLabels: biz }), 'Business info · Phone · (empty)', '清空电话');
eq(run({ root: { address: 'A'.repeat(50), layout: 'standard' }, rootLabels: { ...rootLabels, ...biz } }),
  `${rootLabels.layout} → standard; Business info · Address · "${'A'.repeat(40)}…"`, '长地址截 40 个字 + 同一笔改版式（按 schema.root.fields 的顺序）');

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

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
