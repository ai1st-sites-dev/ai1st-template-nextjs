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
 *   ⑤ 验收 6：遍历全部页面块 —— 播种集合恰好那十一个（#1766 加了 gallery / logos / reviews，`fill: false`；#1767 加了三列）、条数在 minItems..maxItems 内、交给 fill 的格没有 `ai: false`、
 *      只交还是占位的格、每一批 ≤ manager 的 rewriteMaxFields（**从 `manager/ai_rewrite.go` 源码现读**，不在这里抄一个 20）。
 *   📌 #1767 改过的格（「按钮不播」「数字不播」「[string] / 子对象不填」「格数 ≤ 20」）：拖下时按钮、示例数、图标、套餐的功能点
 *      现在都播（`block-seed.test.js` 按种类逐格查），这里改成断言新规矩，每一处就地写了为什么。
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
  // #1767 —— 按钮字（callUs …）、联系方式那四行的标题（phone …）不带序号；数字说明（statLabel）带 {v}（那一条的数）。
  const NO_N = ['eyebrow', 'title', 'text', 'label', 'callUs', 'emailUs', 'contactUs', 'allPosts', 'statLabel', 'phone', 'email', 'address', 'hours'];
  const badN = cats.filter((k) => NO_N.includes(k) === row[k].includes('{n}'));
  check(badN.length === 0, `${l}：块头 / 按钮 / 联系方式类别不带序号、条目类别都带 {n}`, badN);
  check(row.statLabel.includes('{v}'), `${l}：数字说明带 {v}`, row.statLabel);
  if (l !== 'en') {
    // #1766 —— `Logo {n}` 同 Name / Label：这个词在 de / fr / es / it / pt / vi / 中文里就是写 Logo，不是没翻。
    const same = cats.filter((k) => row[k] === bp.WORDS.en[k] && !/^(Name|Label|Logo) \{n\}$/.test(row[k]));
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
// #1767 改：原来断言「选填列表（introCtas）不播」—— 那是 #1660「只写文字等于一个死按钮」的规矩；本票按钮带着能去的链接一起播
//    （有电话链电话、没有链联系页 / 首页），所以块头按钮播 1 颗。不给站点资料 ⟹ 链首页。
check(Array.isArray(fz.introCtas) && fz.introCtas.length === 1 && fz.introCtas[0].href === '/' && fz.introCtas[0].label === '联系我们', '块头按钮（introCtas）播 1 颗，字是中文占位、链接能去', fz.introCtas);
const fz2 = bp.seedProps(features, 'zh');
check(fz2.items !== fz.items && fz2.items[0] !== fz.items[0], '两次调用不共享列表 / 条目对象');
check(!JSON.stringify(fz).includes('Northside'), '不含演示文案（Northside）');

console.log('② 阿拉伯语 / 繁体（验收 5）');
const fa = bp.seedProps(features, 'ar');
check(/[؀-ۿ]/.test(fa.headline) && /[؀-ۿ]/.test(fa.items[0].title), '阿拉伯语站：块头和卡片是阿拉伯文', { h: fa.headline, t: fa.items[0].title });
const ft = bp.seedProps(features, 'zh-tw');
check(ft.headline === '這裡寫標題' && ft.items[1].text === '用一兩句話介紹第 2 項。', '繁体站：是繁体字', { h: ft.headline, t: ft.items[1].text });

console.log('② 事实格不填；#1766 起要图的列表、reviews 的平台也播');
// #1766 —— 这两格原来断言「reviews.platforms / gallery.items 是空数组」（#1660：带必填事实格 / 要图的列表不播）。
//    本票正文做什么 3 / 4 推翻了这两条：gallery 播 3 张空图位（画 #1734 的占位图），reviews 播 Google / Yelp / Facebook
//    三个平台带示例分（Chris：「你就编一个就好了」）。细节在 scripts/platform-logos.test.js。
const reviews = bp.seedProps(byType.get('reviews'), 'en');
check(Array.isArray(reviews.platforms) && reviews.platforms.map((p) => p.source).join() === 'Google,Yelp,Facebook'
  && reviews.platforms.every((p) => Number.isFinite(p.rating) && Number.isInteger(p.count)), 'reviews.platforms 播 Google / Yelp / Facebook，带示例分数和条数（#1766）', reviews.platforms);
check(typeof reviews.headline === 'string' && reviews.headline.length > 0, 'reviews 块头有占位（块留在画布上）');
const gallery = bp.seedProps(byType.get('gallery'), 'en');
check(Array.isArray(gallery.items) && gallery.items.length === 3 && gallery.items.every((it) => JSON.stringify(it) === '{}'), 'gallery.items 播 3 个空图位（没有图 ⟹ 画占位图，#1766）', gallery.items);
const hero = bp.seedProps(byType.get('hero'), 'en');
check(Array.isArray(hero.stats) && hero.stats.length === 0, 'hero.stats（选填、含事实格 value）不播');
const pricing = bp.seedProps(byType.get('pricing'), 'en');
// #1767 改：原来「价格（事实格）不填」—— Chris 2026-10-13 改掉了「拖下新块不编数字」：填一个示例价，三个不一样。
check(pricing.plans.length === 3 && new Set(pricing.plans.map((p) => p.price && p.price.monthly)).size === 3, 'pricing 播 3 套餐，各有一个不一样的示例月付价', pricing.plans.map((p) => p.price));
check(pricing.plans.every((p) => p.price && p.price.yearly === undefined), 'pricing：年付价不填（填了就多出月付 / 年付切换，SEED_EXEMPT 有理由）');
check(pricing.plans[0].name === 'Title 1', '套餐名按标题类给占位（不是「Name 1」）', pricing.plans[0].name);
// #1767 改：原来「features（[string]）和 cta（子对象）不填」—— 那条防的是「把 [string] 写成一个字符串」和「只写 label 的死按钮」；
//    本票播的是 3 条真的字符串列表、带链接的按钮，类型对、按钮活。
check(pricing.plans.every((p) => Array.isArray(p.features) && p.features.length === 3 && p.features.every((f) => typeof f === 'string')), 'pricing：每个套餐的 features 是 3 条字（[string]，不是一个字符串）', pricing.plans[0].features);
check(pricing.plans.every((p) => p.cta && p.cta.label && p.cta.href), 'pricing：每个套餐的 cta 有字有链接（不是死按钮）', pricing.plans[0].cta);
check(fz.items.every((it) => it.number === undefined && it.bullets === undefined && it.link === undefined), 'features：number / bullets / link 不播（SEED_EXEMPT 各有理由）', fz.items[0]);
check(fz.items.every((it) => typeof it.icon === 'string' && it.icon) && new Set(fz.items.map((it) => it.icon)).size === 3, 'features：每张卡一个图标、三个不一样（#1767）', fz.items.map((it) => it.icon));
const testi = bp.seedProps(byType.get('testimonials'), 'en');
// #1767 改：原来「rating 不填」—— 同上，拖下时给一个示例评分（不贴下界、三条不一样）。
//    校验只收 1–5 的整数（validateSite），三条不一样 ⟹ 5 / 4 / 3。
check(testi.items.length === 3 && new Set(testi.items.map((it) => it.rating)).size === 3 && testi.items.every((it) => Number.isInteger(it.rating) && it.rating > 1 && it.rating <= 5), 'testimonials 播 3 条，各有一个不一样的示例评分（1–5 的整数，不贴下界 1）', testi.items.map((it) => it.rating));
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
// #1767 改：9 → 10，多的那一格是块头按钮的字（introCtas.0.label）。
check(ff.length === 10 && ff.some((f) => f.name === 'introCtas.0.label'), 'features：块头 3 + 3 张卡 × 2 + 块头按钮的字 = 10 格', ff.map((f) => f.name));
check(ff.some((f) => f.name === 'items.2.text' && f.text === '用一两句话介绍第 3 项。'), '名字是真实下标的路径，text 带占位', ff);
const fp = bp.fillFields(byType.get('pricing'), pricing);
check(fp.every((f) => !/price/.test(f.name)), 'pricing 不交价格格（示例价不让 AI 改：manager 的提示词禁止它编数字）', fp.map((f) => f.name));
check(fp.some((f) => f.name === 'plans.1.features.2') && fp.some((f) => f.name === 'plans.0.cta.label'), 'pricing 交功能点的每一行和套餐按钮的字（#1767）', fp.map((f) => f.name));
// #1767 —— 只交还是占位的格：演示值（summary 的 `Google`）不交，交了 AI 会把平台名改成一句话。
const fts = bp.fillFields(byType.get('testimonials'), testi);
check(!fts.some((f) => /^summary\./.test(f.name)), 'testimonials：summary 的平台名（演示值 Google）不交给 AI', fts.filter((f) => /^summary/.test(f.name)));
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
check(bp.FILL_BATCH_MAX <= rewriteMaxFields, `编辑器一批最多 ${bp.FILL_BATCH_MAX} 格 ≤ manager 的 rewriteMaxFields=${rewriteMaxFields}`);
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
  // #1660 r5 —— `[string]` 列表没被写成字符串、子对象没被写成别的。判据读 manifest 的项形状原文（§itemShapeEntries），不读 `seed.keys` ——
  // 拿被测的那份名单验它自己就是在跟自己比。
  // #1767 改：原来断言这两种键「一个都没被填」（播种不碰它们）；本票起套餐的 features（3 条字）、cta（带链接的按钮）、price（示例价）
  //    都播了 ⟹ 改成断言**写进去的类型对**：`[…]` 的是数组，`{…}` 的是对象，按钮对象有字有链接（不是死按钮）。
  for (const s of c.seed) {
    const shape = schemaLib.itemShapeEntries(slots[s.slot] && slots[s.slot].shape);
    const nonText = new Map(shape.filter((e) => /[[{]/.test(e.value)).map((e) => [e.key, e.value]));
    const wrong = (props[s.slot] || []).flatMap((it) => Object.keys(it).filter((k) => nonText.has(k)).filter((k) => {
      const v = it[k];
      const want = nonText.get(k);
      if (/^\[/.test(want)) return !Array.isArray(v);
      if (!(v && typeof v === 'object' && !Array.isArray(v))) return true;
      return 'label' in v && !v.href; // 按钮：有字就得有链接
    }).map((k) => `${k}=${JSON.stringify(it[k])}`));
    check(wrong.length === 0, `${c.type}·${s.slot}：条目里写进去的 [string] 列表 / 子对象类型对、按钮不是死的（${[...nonText.keys()].join(', ') || '无'}）`, wrong);
  }
  const sent = bp.fillFields(c, props);
  const names = sent.map((f) => f.name);
  check(names.length >= 1, `${c.type}：交给 fill 的格 ≥1（交 0 格 manager 回 400）`, names.length);
  // #1767 改：原来断言「一块交的格 ≤ rewriteMaxFields」—— pricing 现在交 38 格；编辑器按条分批发（§fillBatches），要守的是每一批。
  const batches = bp.fillBatches(sent);
  check(batches.every((b) => b.length >= 1 && b.length <= rewriteMaxFields), `${c.type}：交给 fill ${names.length} 格，分 ${batches.length} 批，每批 ≤ rewriteMaxFields=${rewriteMaxFields}（超了那一批 400）`, batches.map((b) => b.length));
  const key = (f) => `${f.name}=${f.text}`;
  check(JSON.stringify(batches.flat().map(key).sort()) === JSON.stringify(sent.map(key).sort()), `${c.type}：分批不丢格、不多格`);
  const split = new Map();
  batches.forEach((b, i) => b.forEach((f) => { const m = /^([^.]+\.\d+)\./.exec(f.name); if (m) split.set(m[1], [...new Set([...(split.get(m[1]) || []), i])]); }));
  check([...split.values()].every((v) => v.length === 1), `${c.type}：同一条（plans.0.*）不拆进两批`, [...split].filter(([, v]) => v.length > 1));
  // `items.1.title` → `items.title`（inline 清单里的路径不带序号）
  const leaked = names.filter((n) => fact.has(n.split('.').filter((seg) => !/^\d+$/.test(seg)).join('.')));
  check(leaked.length === 0, `${c.type}：交给 fill 的格里没有 ai:false（数字 / 评分 AI 不编）`, leaked);
}
seeded.sort();
// #1766 —— gallery·items、logos·items（`itemRequires` 的列表，#1734 有了可点的占位图之后播 3 个空图位）、
//    reviews·platforms（manifest 的 `seedItems`：Google / Yelp / Facebook 带示例分）。这三个都是 `fill: false`，交给 fill 的格里
//    一格都没有它们 —— 下面那一格守着。
// #1767 —— 再多三列，因为列表里有一格本票要补（图标 / 数字）：milestones·stats（一排数字，块的主体）、
//    pricing·highlights（每条一个图标）、testimonials·summary（平台评分，照 manifest 的 demo 播 1 条）。
const wantSeed = ['faq·items', 'features·items', 'gallery·items', 'logos·items', 'milestones·stats', 'pricing·highlights', 'pricing·plans', 'reviews·platforms', 'team·members', 'testimonials·items', 'testimonials·summary'];
check(JSON.stringify(seeded) === JSON.stringify(wantSeed), `播种集合恰好是 ${wantSeed.join(' / ')}`, seeded);
// #1766 —— `fill: false` 的列表播了但不交给 AI：交给 fill 的格里没有一格落在这些列表里。
for (const c of schema.components) {
  const noFill = new Set(c.seed.filter((s) => s.fill === false).map((s) => s.slot));
  if (!noFill.size) continue;
  const names = bp.fillFields(c, bp.seedProps(c, 'en')).map((f) => f.name);
  const leakedNoFill = names.filter((n) => noFill.has(n.split('.')[0]));
  check(leakedNoFill.length === 0, `${c.type}：播出来的 ${[...noFill].join(' / ')} 不交给 AI 填字（#1766）`, leakedNoFill);
}

console.log(`\n${fail === 0 ? '✅' : '❌'} ${pass} 过 · ${fail} 失败`);
process.exit(fail === 0 ? 0 : 1);
