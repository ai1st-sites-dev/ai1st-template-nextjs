#!/usr/bin/env node
/**
 * editor-placeholders.test.js — #1660：新块拖到画布那一刻带着的字（`lib/block-placeholders.js`）。
 *   ① 语言：跟 `locale-words.js` 同一个 15 种集合（含 zh-tw），每种语言每个类别都有；回落先基础语言、再 en；
 *      阿拉伯语站是阿拉伯语、繁体站是繁体（验收 5 的数据那一半）。
 *   ② 播种 + 占位：features 落下 = 块头 3 格 + 3 张卡，全是这种语言的占位；`ai: false` 的格不填；
 *      列表条目的占位各不相同（三条一样的话 T6 的点击层判「对上不止一条」不让就地改）；两次调用不共享对象。
 *   ③ 不漏到老块：Puck 画布渲染时把 defaultProps 浅合并在每个块的 props 底下 —— 老块的 props（§pageToPuck）
 *      必须把 defaultProps 的每个键都占着，否则老块上会画出占位（存盘不存，画布上看得见）。
 *   ④ 交给 fill 的格：名字是数据里的路径（真实下标）、带着占位文字、没有 `ai: false` 的格。
 *   ⑤ 验收 6：遍历全部页面块 —— 播种集合恰好那五个、条数在 minItems..maxItems 内、交给 fill 的格没有 `ai: false`、
 *      条目里没有 `[string]` 列表 / 子对象被填、格数 ≤ manager 的 rewriteMaxFields（**从 `manager/ai_rewrite.go` 源码现读**，
 *      不在这里抄一个 20）。
 *
 *   node scripts/editor-placeholders.test.js     （由 `npm run test:scripts` 自动发现）
 *   退出码: 0 全过 · 1 有失败 · 2 跑不起来（**不许当成通过**）
 */

'use strict';

let pass = 0; let fail = 0;
const ok = (m) => { pass += 1; console.log(`  ✅ ${m}`); };
const bad = (m) => { fail += 1; console.log(`  ❌ ${m}`); };
const check = (cond, m, detail) => (cond ? ok(m) : bad(detail === undefined ? m : `${m} —— ${JSON.stringify(detail)}`));
function die(msg) { console.log(`💥 ${msg}`); process.exit(2); }

const fs = require('fs');
const path = require('path');

let bp; let schemaLib; let convert; let localeWords; let blockShapeCatalog;
try {
  bp = require('./lib/block-placeholders.js');
  schemaLib = require('./lib/editor-schema.js');
  convert = require('./lib/editor-convert.js');
  localeWords = require('./lib/locale-words.js');
  ({ blockShapeCatalog } = require('./lib/block-catalog.js'));
} catch (e) {
  die(`加载不了被测模块: ${e.message}`);
}
const schema = schemaLib.editorSchema();
const byType = new Map(schema.components.map((c) => [c.type, c]));
if (!byType.has('features') || !byType.has('reviews')) die('editorSchema 里没有 features / reviews —— 被测对象不在');

// ══ ① 语言 ════════════════════════════════════════════════════════════════════════════════════════
console.log('① 语言集合与回落');
const want = Object.keys(localeWords.WORDS).sort();
const have = Object.keys(bp.WORDS).sort();
check(JSON.stringify(have) === JSON.stringify(want), `占位表的语言 = locale-words.js 那 ${want.length} 种`, { have, want });
check(want.includes('zh-tw'), '集合里有 zh-tw');
const cats = Object.keys(bp.WORDS.en);
for (const l of have) {
  const row = bp.WORDS[l];
  const missing = cats.filter((k) => typeof row[k] !== 'string' || !row[k].trim());
  check(missing.length === 0 && Object.keys(row).length === cats.length, `${l}：${cats.length} 个类别齐全`, missing);
  const head = ['eyebrow', 'title', 'text', 'label'];
  const badN = cats.filter((k) => head.includes(k) === row[k].includes('{n}'));
  check(badN.length === 0, `${l}：块头类别不带序号、条目类别都带 {n}`, badN);
  if (l !== 'en') {
    const same = cats.filter((k) => row[k] === bp.WORDS.en[k] && !/^(Name|Label) \{n\}$/.test(row[k]));
    check(same.length === 0, `${l}：没有原样抄英文的句子`, same);
  }
}
check(bp.placeholderWords('pt-BR') === bp.WORDS.pt, 'pt-BR → pt（先退基础语言）');
check(bp.placeholderWords('') === bp.WORDS.en, '空串（扁平老站）→ en');
check(bp.placeholderWords('xx') === bp.WORDS.en, '表里没有的语言 → en');
check(bp.placeholderWords('ZH-TW') === bp.WORDS['zh-tw'], '大小写不论（ZH-TW → zh-tw）');

// ══ ② 播种 + 占位 ════════════════════════════════════════════════════════════════════════════════
console.log('② features 落下那一刻（中文站）');
const features = byType.get('features');
const fz = bp.seedProps(features, 'zh');
check(Array.isArray(fz.items) && fz.items.length === 3, 'items 播 3 条', fz.items);
check(fz.headline === '这里写标题' && fz.introEyebrow.text === '简短标语' && fz.body === '用一两句话介绍这里的内容。', '块头三格是中文占位', { headline: fz.headline, eyebrow: fz.introEyebrow, body: fz.body });
check(fz.items.every((it, i) => it.title === `标题 ${i + 1}` && it.text === `用一两句话介绍第 ${i + 1} 项。`), '每张卡的标题 / 正文是中文占位、带各自的序号', fz.items);
check(new Set(fz.items.map((it) => it.title)).size === 3, '三张卡的标题各不相同（T6 点击层按内容找回下标，一样的会判 ambiguous）');
check(Array.isArray(fz.introCtas) && fz.introCtas.length === 0, '选填列表（introCtas）不播');
const fz2 = bp.seedProps(features, 'zh');
check(fz2.items !== fz.items && fz2.items[0] !== fz.items[0], '两次调用不共享列表 / 条目对象');
check(!JSON.stringify(fz).includes('Northside'), '不含演示文案（Northside）');

console.log('② 阿拉伯语 / 繁体（验收 5）');
const fa = bp.seedProps(features, 'ar');
check(/[؀-ۿ]/.test(fa.headline) && /[؀-ۿ]/.test(fa.items[0].title), '阿拉伯语站：块头和卡片是阿拉伯文', { h: fa.headline, t: fa.items[0].title });
const ft = bp.seedProps(features, 'zh-tw');
check(ft.headline === '這裡寫標題' && ft.items[1].text === '用一兩句話介紹第 2 項。', '繁体站：是繁体字', { h: ft.headline, t: ft.items[1].text });

console.log('② 事实格不填、要图 / 带事实格的列表不播');
const reviews = bp.seedProps(byType.get('reviews'), 'en');
check(Array.isArray(reviews.platforms) && reviews.platforms.length === 0, 'reviews.platforms 是空数组（不播，没有编出来的评分）', reviews.platforms);
check(typeof reviews.headline === 'string' && reviews.headline.length > 0, 'reviews 块头有占位（块留在画布上）');
const gallery = bp.seedProps(byType.get('gallery'), 'en');
check(Array.isArray(gallery.items) && gallery.items.length === 0, 'gallery.items 是空数组（条目要图，本票不配图）', gallery.items);
const hero = bp.seedProps(byType.get('hero'), 'en');
check(Array.isArray(hero.stats) && hero.stats.length === 0, 'hero.stats（选填、含事实格 value）不播');
const pricing = bp.seedProps(byType.get('pricing'), 'en');
check(pricing.plans.length === 3 && pricing.plans.every((p) => p.price === undefined), 'pricing 播 3 套餐，价格（事实格）不填', pricing.plans);
check(pricing.plans[0].name === 'Title 1', '套餐名按标题类给占位（不是「Name 1」）', pricing.plans[0].name);
check(pricing.plans.every((p) => p.features === undefined && p.cta === undefined), 'pricing：条目里的 features（[string]）和 cta（子对象）不填', pricing.plans[0]);
check(fz.items.every((it) => it.number === undefined && it.bullets === undefined && it.link === undefined), 'features：可选事实格 number、bullets（[string]）、link（子对象）都不填', fz.items[0]);
const testi = bp.seedProps(byType.get('testimonials'), 'en');
check(testi.items.length === 3 && testi.items.every((it) => it.rating === undefined), 'testimonials 播 3 条（可选的 rating? 不挡播种），rating 不填', testi.items);
const team = bp.seedProps(byType.get('team'), 'en');
check(team.members[2].name === 'Name 3' && team.members[2].role === 'Role 3', '人名 / 职位按各自类别', team.members[2]);

// ══ ③ 不漏到老块 ══════════════════════════════════════════════════════════════════════════════════
console.log('③ 老块的 props 占着 defaultProps 的每个键（Puck 浅合并 {...defaultProps, ...props} 漏不出占位）');
for (const c of schema.components) {
  const defaults = { ...bp.seedProps(c, 'zh'), _shape: convert.THEME_DEFAULT };
  const { content } = convert.pageToPuck({
    raw: { blocks: [{ id: 'b0', type: c.type, data: {} }] },
    blocks: [{ id: 'b0', type: c.type, data: {} }],
    located: [{ at: 0, writable: true, reason: '' }],
    schema,
  });
  const props = content[0].props;
  const holes = Object.keys(defaults).filter((k) => !Object.prototype.hasOwnProperty.call(props, k));
  const merged = { ...defaults, ...props };
  const leaked = JSON.stringify(convert.dataFromProps(c, {}, merged)) !== JSON.stringify(convert.dataFromProps(c, {}, props));
  check(holes.length === 0 && !leaked, `${c.type}：老块（data 为空）合并之后画出来的还是它自己`, { holes, leaked });
}

// ══ ④ 交给 fill 的格 ══════════════════════════════════════════════════════════════════════════════
console.log('④ fillFields');
const ff = bp.fillFields(features, fz);
check(ff.length === 9, 'features：块头 3 + 3 张卡 × 2 = 9 格', ff.length);
check(ff.some((f) => f.name === 'items.2.text' && f.text === '用一两句话介绍第 3 项。'), '名字是真实下标的路径，text 带占位', ff);
const fp = bp.fillFields(byType.get('pricing'), pricing);
check(fp.every((f) => !/price/.test(f.name)), 'pricing 不交价格格', fp.map((f) => f.name));
check(JSON.stringify(bp.pathOfName('plans.1.description')) === JSON.stringify(['plans', 1, 'description']), 'pathOfName 把下标还成数字');
// 老板在等 AI 的时候改了一格 —— 那一格不再是占位，不再交（EditorApp §startFill 只换还是占位的格，读的是同一份名字）。
const edited = { ...fz, headline: '' };
check(!bp.fillFields(features, edited).some((f) => f.name === 'headline'), '空了的格不交（manager 那边全空会 400）');

// ══ ⑤ 验收 6：遍历全部页面块 —— 播种集合 / 条数界 / 只交 ai:true / 格数 ≤ manager 的上限 ═════════════════
// 上限从 `manager/ai_rewrite.go` 的源码里现读（PM 三审执行要求 1：判据只留一处 —— 这里手写一个 20，上限将来调小时
// 这一格继续绿着，而线上每拖一个 pricing 都 400）。读不到就是「跑不起来」（exit 2），不是跳过。
// 📌 r3 起住在这里而不是 `manager/ticket1660_test.go`：editor-schema 经 block-catalog 用 typescript 读注册表，
//    要模板的 npm 依赖；跑 manager 测试的三个 CI 调用处（struct-guards · ci · aiteam-scripts 的一次性 worktree）
//    都没有它。这个文件由 template-scripts 跑（那里 `npm ci` 过），而 ci-cd.yml 的 `rewrite_limit` 过滤器让
//    只改 `ai_rewrite.go` 的 push 也跑到它。
console.log('⑤ 全部页面块：播种集合、条数界、只交 ai:true 的格、格数 ≤ rewriteMaxFields');
const REWRITE_GO = path.resolve(__dirname, '..', '..', '..', 'manager', 'ai_rewrite.go');
let goSrc;
try { goSrc = fs.readFileSync(REWRITE_GO, 'utf-8'); } catch (e) { die(`读不到 ${REWRITE_GO}（manager 那一半的上限）：${e.message}`); }
const declM = goSrc.match(/^\s*rewriteMaxFields\s*=\s*(.*)$/m);
if (!declM) die(`${path.basename(REWRITE_GO)} 里找不到 \`rewriteMaxFields = <数>\` —— 改名 / 改写法了，这一格没有可比的上限`);
// #1660 r4 —— 等号右边只认「一个整数 + 可选的行尾注释」。原来 `(\d+)\b` 只取开头那个数：`40 / 2` 读成 40（真上限 20）⟹
// 「格数 ≤ 上限」那格假绿；`4 * 5` 读成 4、报错报的上限也是错的。写成表达式就说读不了（exit 2），不猜它等于几。
const limitM = declM[1].match(/^(\d+)[ \t]*(?:\/\/.*)?$/);
if (!limitM) die(`${path.basename(REWRITE_GO)} 里 rewriteMaxFields 写成了 \`${declM[1].trim()}\` —— 只认一个整数（可带行尾 // 注释），表达式这里不算`);
const rewriteMaxFields = Number(limitM[1]);
console.log(`  (manager/ai_rewrite.go 现读 rewriteMaxFields = ${rewriteMaxFields})`);
const manifests = blockShapeCatalog().manifests;
const seeded = [];
for (const c of schema.components) {
  const slots = (manifests.get(c.type) || {}).slots || {};
  for (const s of c.seed) {
    seeded.push(`${c.type}·${s.slot}`);
    const min = slots[s.slot] && slots[s.slot].minItems;
    const max = slots[s.slot] && slots[s.slot].maxItems;
    check((min === undefined || s.count >= min) && (max === undefined || s.count <= max),
      `${c.type}·${s.slot} 播 ${s.count} 条，在 minItems..maxItems（${min ?? '-'}..${max ?? '-'}）之内`);
  }
  const fact = new Set(c.inline.filter((e) => !e.ai).map((e) => e.path));
  const props = bp.seedProps(c, 'en');
  // #1660 r5 —— 播出来的条目里只有项形状顶层的纯文字键：`[string]` 列表没被写成字符串、子对象（link / cta）没被写进去。
  // 判据读 manifest 的项形状原文（§itemShapeEntries），不读 `seed.keys` —— 拿被测的那份名单验它自己就是在跟自己比。
  for (const s of c.seed) {
    const shape = schemaLib.itemShapeEntries(slots[s.slot] && slots[s.slot].shape);
    const nonText = new Map(shape.filter((e) => /[[{]/.test(e.value)).map((e) => [e.key, e.value]));
    const wrote = (props[s.slot] || []).flatMap((it) => Object.keys(it).filter((k) => nonText.has(k)).map((k) => `${k}=${JSON.stringify(it[k])}`));
    check(wrote.length === 0, `${c.type}·${s.slot}：条目里没有 [string] 列表 / 子对象被填（${[...nonText.keys()].join(', ') || '无'}）`, wrote);
  }
  const names = bp.fillFields(c, props).map((f) => f.name);
  check(names.length >= 1, `${c.type}：交给 fill 的格 ≥1（交 0 格 manager 回 400）`, names.length);
  check(names.length <= rewriteMaxFields, `${c.type}：交给 fill ${names.length} 格 ≤ rewriteMaxFields=${rewriteMaxFields}（超了每拖一次都 400）`);
  // `items.1.title` → `items.title`（inline 清单里的路径不带序号）
  const leaked = names.filter((n) => fact.has(n.split('.').filter((seg) => !/^\d+$/.test(seg)).join('.')));
  check(leaked.length === 0, `${c.type}：交给 fill 的格里没有 ai:false（数字 / 评分 AI 不编）`, leaked);
}
seeded.sort();
const wantSeed = ['faq·items', 'features·items', 'pricing·plans', 'team·members', 'testimonials·items'];
check(JSON.stringify(seeded) === JSON.stringify(wantSeed), `播种集合恰好是 ${wantSeed.join(' / ')}`, seeded);

console.log(`\n${fail === 0 ? '✅' : '❌'} ${pass} 过 · ${fail} 失败`);
process.exit(fail === 0 ? 0 : 1);
