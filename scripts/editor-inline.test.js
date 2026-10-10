#!/usr/bin/env node
/**
 * editor-inline.test.js — #1657：画布里点字直接改。两件事：
 *   ① 「哪几段字能就地打字、哪几段出 AI 按钮」（`editor-schema.js` §inlineSlotsOf）—— 全集取自 §editableSlotPaths 跑全套
 *      `blocks/`，按字段性质判，不按块名写名单；
 *   ② 「点到的这段字对的是数据里的哪一格」（`inline-edit.js` §resolveInlineSlot）—— 画布序号不是数据下标，
 *      按内容对回，对不上 / 对上多项都不让改；引用列表、锁住的块点不动。
 *
 *   node scripts/editor-inline.test.js     （由 `npm run test:scripts` 自动发现）
 *   退出码: 0 全过 · 1 有失败 · 2 跑不起来（**不许当成通过**）
 *
 * 浏览器里那一半（点击、打字、光标、选中、撤销）在 e2e `tests/e2e/specs/1657-editor-inline.spec.ts`。
 */

'use strict';

let pass = 0; let fail = 0;
const ok = (m) => { pass += 1; console.log(`  ✅ ${m}`); };
const bad = (m) => { fail += 1; console.log(`  ❌ ${m}`); };
const check = (cond, m, detail) => (cond ? ok(m) : bad(detail === undefined ? m : `${m} —— ${JSON.stringify(detail)}`));
function die(msg) { console.log(`💥 ${msg}`); process.exit(2); }

let schemaLib; let manifestLib; let inline;
try {
  schemaLib = require('./lib/editor-schema.js');
  manifestLib = require('./lib/block-manifest.js');
  inline = require('./lib/inline-edit.js');
} catch (e) {
  die(`加载不了被测模块: ${e.message}`);
}
const { inlineSlotsOf, isFactSlot } = schemaLib;
const { resolveInlineSlot, setAt, typedValue } = inline;

// ══ ① 全集 ═══════════════════════════════════════════════════════════════════════════════════════
console.log('① 全集：editableSlotPaths 跑全套 blocks/，每条能不能打字、出不出 AI 按钮');
const manifests = manifestLib.loadManifests();
const all = [];
for (const [type, m] of manifests) for (const e of inlineSlotsOf(m)) all.push({ id: `${type}.${e.path}`, ...e });
const expected = [];
for (const [type, m] of manifests) for (const e of manifestLib.editableSlotPaths(m)) expected.push(`${type}.${e.path}`);
check(all.length > 0 && all.length === expected.length && all.every((x, i) => x.id === expected[i]),
  `inline 清单逐条等于 editableSlotPaths（${all.length} 条，同序）`);
const noTyping = all.filter((x) => !x.typing).map((x) => x.id);
const noAi = all.filter((x) => !x.ai).map((x) => x.id);
check(noTyping.length === all.filter((x) => x.kind === 'richtext').length && noTyping.every((id) => all.find((x) => x.id === id).kind === 'richtext'),
  '不能就地打字的 = 全部 richtext，别的都能', noTyping);
console.log(`     读数：全集 ${all.length} · 能就地打字 ${all.length - noTyping.length} · 有 AI 按钮 ${all.length - noAi.length}`);
console.log(`     不能打字：${noTyping.join(' ')}`);
console.log(`     没有 AI 按钮：${noAi.join(' ')}`);
// 今天（2026-10-08）的读数是这 6 个；判据是谓词，下面 ③ 单测谓词本身。这里只钉「它们确实被谓词判出来了」。
for (const id of ['hero.stats.value', 'milestones.stats.value', 'reviews.platforms.rating', 'reviews.platforms.count', 'testimonials.summary.rating', 'testimonials.summary.count']) {
  if (all.some((x) => x.id === id)) check(noAi.includes(id), `${id} 不出 AI 按钮`);
}
for (const id of ['hero.headline', 'faq.items.question', 'hero.ctas.label', 'pricing.billing.yearlyLabel', 'hero.stats.label', 'content.body']) {
  if (all.some((x) => x.id === id)) check(!noAi.includes(id), `${id} 出 AI 按钮（文案，不是数）`);
}

// ══ ② 谓词：按字段性质判 ═══════════════════════════════════════════════════════════════════════
console.log('② 「数字 / 价格 / 事实」谓词：声明了数值范围，或显示名说的是一个数');
check(isFactSlot({ ranges: { rating: [0, 5] } }, 'rating', 'Stars'), 'ranges 里有它 ⟹ 是（显示名叫什么不论）');
check(isFactSlot({}, 'monthly', 'Price'), '显示名 Price ⟹ 是（#1670 的价格格落地后自动进这一档）');
check(isFactSlot({}, 'yearly', 'Yearly price'), '显示名 Yearly price ⟹ 是');
check(isFactSlot({}, 'count', 'Number of reviews'), '显示名 Number of reviews ⟹ 是');
check(!isFactSlot({}, 'label', 'What it counts'), '「What it counts」不是（整词匹配，counts ≠ number）');
check(!isFactSlot({}, 'yearlyLabel', 'Yearly label'), '「Yearly label」不是');
check(!isFactSlot({ ranges: { rating: [1, 5] } }, 'quote', 'Quote'), 'ranges 只管它点名的子字段');
check(!isFactSlot(undefined, null, 'Headline'), '顶层 Headline 不是');

// ══ ③ 对回数据 ════════════════════════════════════════════════════════════════════════════════════
console.log('③ 点到的字 → 数据里的哪一格');
const comp = (type) => ({ type, inline: inlineSlotsOf(manifests.get(type)) });
const faq = comp('faq');
const hero = comp('hero');
const features = comp('features');
const content = comp('content');

{
  const props = { id: 'h', headline: 'Calm  care in   Toronto', ctas: [{ label: 'Book', href: '/b' }, { label: 'Call us', href: 'tel:1' }], eyebrow: { text: 'New', style: 'pill' } };
  const r = resolveInlineSlot({ component: hero, props, slot: 'headline', text: '  Calm care in Toronto ' });
  check(r.ok && r.name === 'headline' && r.typing && r.ai, '顶层：headline（空白不论）', r);
  const e = resolveInlineSlot({ component: hero, props, slot: 'eyebrow.text', text: 'New' });
  check(e.ok && e.name === 'eyebrow.text', '对象里的字：eyebrow.text', e);
  const b = resolveInlineSlot({ component: hero, props, slot: 'ctas.1.label', text: 'Call us' });
  check(b.ok && b.name === 'ctas.1.label' && b.path[1] === 1, '列表第 2 项：ctas.1.label', b);
  const m = resolveInlineSlot({ component: hero, props, slot: 'headline', text: 'Calm care in Toronto — today' });
  check(!m.ok && m.why === 'mismatch', '画布上的字跟数据对不上 ⟹ 不让改（不把画布上的样子写回去）', m);
  const u = resolveInlineSlot({ component: hero, props, slot: 'band.0.alt', text: 'x' });
  check(!u.ok && u.why === 'unknown', '不在可改清单里的 data-slot ⟹ unknown', u);
}
{
  // faq 先筛掉空问题再编号：画布上第 1 条（items.0）是数据里的第 2 条。
  const props = { id: 'f', items: [{ question: '', answer: 'orphan' }, { question: 'Do you take walk-ins?', answer: 'Yes, most days.' }, { question: 'Is parking free?', answer: 'Yes.' }] };
  const r = resolveInlineSlot({ component: faq, props, slot: 'items.0.question', text: 'Do you take walk-ins?' });
  check(r.ok && r.name === 'items.1.question', '筛过的列表：画布 items.0 ⟹ 数据 items[1]（不按画布序号写）', r);
  const r2 = resolveInlineSlot({ component: faq, props, slot: 'items.1.answer', text: 'Yes.' });
  check(r2.ok && r2.name === 'items.2.answer', '画布 items.1.answer ⟹ 数据 items[2]', r2);
  // 反向对照：按画布序号直接当下标写，会写到那条空问题上。
  const naive = setAt(props, ['items', 0, 'question'], 'Edited');
  check(naive.items[0].question === 'Edited' && props.items[1].question === 'Do you take walk-ins?', '（对照）照画布序号写会改到空的那一条 —— 上面那格挡的就是它');
  const dup = { id: 'f2', items: [{ question: 'Same?', answer: 'a' }, { question: 'Same?', answer: 'b' }] };
  const d = resolveInlineSlot({ component: faq, props: dup, slot: 'items.1.question', text: 'Same?' });
  check(!d.ok && d.why === 'ambiguous', '同一列里两项一样的字 ⟹ 不猜（ambiguous）', d);
  const z = resolveInlineSlot({ component: faq, props, slot: 'items.0.question', text: 'Something else' });
  check(!z.ok && z.why === 'mismatch', '一项都对不上 ⟹ mismatch', z);
}
{
  const props = { id: 'x', headline: 'Our services', items: { source: 'services' } };
  const s = resolveInlineSlot({ component: features, props, slot: 'items.0.title', text: 'Acupuncture', sourced: ['items'] });
  check(!s.ok && s.why === 'sourced' && s.slot === 'items', '列表写成引用（_sourced 标了 items）⟹ 点不动', s);
  const h = resolveInlineSlot({ component: features, props, slot: 'headline', text: 'Our services', sourced: ['items'] });
  check(h.ok && h.name === 'headline', '同一块里别的字照样能改', h);
  const l = resolveInlineSlot({ component: features, props: { id: 'y', headline: 'Our services' }, slot: 'headline', text: 'Our services', locked: true });
  check(!l.ok && l.why === 'locked', '锁住的块 ⟹ 点不动', l);
}
{
  const props = { id: 'c', body: 'First para.\n\n- one\n- two' };
  // 画布上是排过版的样子（textContent 里没有 `- `），跟 markdown 原文对不上 —— 它不打字，所以不比。
  const r = resolveInlineSlot({ component: content, props, slot: 'body', text: 'First para.onetwo' });
  check(r.ok && r.typing === false && r.ai === true && r.value === props.body, 'content.body：不就地打字、出 AI 按钮（画布上排过版也一样）', r);
  const st = resolveInlineSlot({ component: hero, props: { id: 's', stats: [{ value: '500+', label: 'clients' }] }, slot: 'stats.0.value', text: '500+' });
  check(st.ok && st.typing && !st.ai, 'hero.stats.value：能打字、没有 AI 按钮', st);
}

// ══ ④ 写回 ═══════════════════════════════════════════════════════════════════════════════════════
console.log('④ 写回：只换那一格，同列表别的项、别的键原样（原对象不动）');
{
  const props = { id: 'f', items: [{ question: 'A', answer: 'a', id: 1 }, { question: 'B', answer: 'b', id: 2 }] };
  const next = setAt(props, ['items', 1, 'question'], 'B2');
  check(next.items[1].question === 'B2' && next.items[1].answer === 'b' && next.items[1].id === 2, 'items[1].question 换了，同项别的键在');
  check(next.items[0] === props.items[0], 'items[0] 是同一个对象（没碰）');
  check(props.items[1].question === 'B', '原对象没被改');
  check(typedValue('two\nlines') === 'two lines', '粘贴进来的换行折成空格（单行字段）');
}

// ══ #1686 列表项里再套一列字 / 项里的按钮 ═══════════════════════════════════════════════════════════
console.log('#1686 两层序号（plans.0.features.2）与项里的按钮（plans.0.cta.label）');
{
  const pricing = comp('pricing');
  const props = { id: 'p', plans: [
    { name: 'A', features: ['Full acupuncture treatment', 'Free consultation'], cta: { label: 'Book Appointment', href: '/c' } },
    { name: 'B', features: ['', 'Tuina therapeutic massage', 'Free consultation'], cta: { label: 'Join', href: '/c' } },
  ] };
  const r1 = resolveInlineSlot({ component: pricing, props, slot: 'plans.0.features.0', text: 'Full acupuncture treatment' });
  check(r1.ok && JSON.stringify(r1.path) === JSON.stringify(['plans', 0, 'features', 0]) && r1.typing && r1.ai, '一行 feature ⟹ plans[0].features[0]，能打字、出 AI', r1);
  // 画布序号是筛过空行的：第二个套餐画出来的第 0 行是数据里的第 1 行 ⟹ 按内容找回
  const r2 = resolveInlineSlot({ component: pricing, props, slot: 'plans.1.features.0', text: 'Tuina therapeutic massage' });
  check(r2.ok && JSON.stringify(r2.path) === JSON.stringify(['plans', 1, 'features', 1]), '画布序号 ≠ 数据下标（空行被筛掉）⟹ 按内容对回 plans[1].features[1]', r2);
  const r3 = resolveInlineSlot({ component: pricing, props, slot: 'plans.0.features.1', text: 'Free consultation' });
  check(!r3.ok && r3.why === 'ambiguous', '两个套餐里一字不差的同一行 ⟹ 不让改（不猜）', r3);
  const r4 = resolveInlineSlot({ component: pricing, props, slot: 'plans.0.features.0', text: 'Something else' });
  check(!r4.ok && r4.why === 'mismatch', '内容对不上 ⟹ 不让改', r4);
  const r5 = resolveInlineSlot({ component: pricing, props, slot: 'plans.1.cta.label', text: 'Join' });
  check(r5.ok && JSON.stringify(r5.path) === JSON.stringify(['plans', 1, 'cta', 'label']), '按钮字 ⟹ plans[1].cta.label', r5);
  const next = setAt(props, r1.path, 'Acupuncture');
  check(JSON.stringify(next.plans[0].features) === JSON.stringify(['Acupuncture', 'Free consultation']) && next.plans[1] === props.plans[1], '写回只换那一行，还是字符串数组');
  const feats = comp('features');
  const r6 = resolveInlineSlot({ component: feats, props: { items: [{ title: 'x', bullets: ['a', 'b'] }] }, slot: 'items.0.bullets.1', text: 'b' });
  check(r6.ok && r6.name === 'items.0.bullets.1', 'features 每项的小列表 ⟹ items[0].bullets[1]', r6);
  // 星星里没有字：点到 ⟹ mismatch（工具条提示去右栏 Rating 格），不会把空串写进评分
  const tn = comp('testimonials');
  const r7 = resolveInlineSlot({ component: tn, props: { items: [{ quote: 'q', rating: 5 }] }, slot: 'items.0.rating', text: '' });
  check(!r7.ok && r7.why === 'mismatch', '每条评价的星星（没有字）⟹ 不就地打字，提示去右栏', r7);
}

console.log(`\n══ 汇总: 通过 ${pass} · 失败 ${fail} ══`);
process.exit(fail ? 1 : 0);
