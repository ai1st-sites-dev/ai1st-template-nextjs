#!/usr/bin/env node
/**
 * target-keywords.test.js — #1548 关键词落盘那几个纯函数 + validateSite 新加的两条。
 *
 * 跑法:  node scripts/lib/target-keywords.test.js      （`npm run test:scripts` 会自动发现它）
 * 退出码: 0 全过 · 1 有失败 · 2 跑不起来（**不许当成通过**）
 *
 * 管四件事（对应票面验收 1、2）：
 *   ① assignTargetKeywords：按位置对 · 数量不等按名字对 · 一组对不上（unmatched 恰好是那组主词）· 没页的非主词进 unassigned ·
 *      名字逐字相等但位置不同（名字优先，记 reordered）· Lead 首页 · Gold 并列 / 空值
 *   ② unmatchedServiceKeys：「键不在 services.json 的 id 集合里」那条谓词
 *   ③ validateSite 两条新规则：命中 / 不命中各一 · 主词同在首页和服务页不报 · 没有 targetKeywords 的老站不查（含阳性对照）
 *   ④ keywordBrief：没词 = 空串；有词时三样都在
 *   ⑤ localizeKeywords（#1569 r3）：主语言非英语时有翻译种子的组主词换成它、翻译失败回退、英文站不变、汉字间空格去掉
 */
'use strict';

let failed = 0;
const ok = (m) => console.log(`  ✅ ${m}`);
const bad = (m) => { failed += 1; console.log(`  ❌ ${m}`); };
const same = (got, want, m) => {
  const g = JSON.stringify(got);
  const w = JSON.stringify(want);
  return g === w ? ok(`${m} → ${g}`) : bad(`${m}：期望 ${w}，读到 ${g}`);
};

let tk, bm;
try {
  tk = require('./target-keywords.js');
  bm = require('./block-manifest.js');
} catch (e) {
  console.log(`🔴 跑不起来：${e.message}`);
  process.exit(2);
}

// ── 夹具：3 个服务，每组一个主词 + 2 个选中的非主词（跟票面真站那条同形）────────────────────────────
const kw = (keyword, goldIndex, isPrimary = false) => ({ keyword, volume: 100, goldIndex, selected: true, isPrimary });
const SERVICES = ['Teeth Cleaning', 'Whitening', 'Implants'];
// 🔴 对象键序故意跟 services 不同：dashboard 的 keywords 是按挖词完成先后插入的，「第 i 组」必须按 services 的顺序认。
const KEYWORDS = {
  Implants: [kw('implants', 30, true), kw('implants cost', 5), kw('implant dentist', 4)],
  'Teeth Cleaning': [kw('teeth cleaning', 50, true), kw('teeth cleaning toronto', 9), kw('dental cleaning', 8)],
  Whitening: [kw('whitening', 20, true), kw('teeth whitening price', 7), kw('whitening strips', 6)],
};
const kwPagesFrom = (keywords) => Object.entries(keywords).flatMap(([svc, list]) => list
  .filter((k) => k.selected && !k.isPrimary)
  .map((k) => ({ keyword: k.keyword, nestedSlug: `${svc.toLowerCase().replace(/[^a-z0-9]+/g, '-')}/${k.keyword.toLowerCase().replace(/[^a-z0-9]+/g, '-')}` })));
const KP = kwPagesFrom(KEYWORDS);
const pagesFor = (ids, kp = KP) => [
  { slug: 'home' }, { slug: 'about' }, { slug: 'services' }, { slug: 'contact' },
  ...ids.map((id) => ({ slug: `services/${id}`, serviceDetailPage: true, parentService: id })),
  ...kp.map((k) => ({ slug: k.nestedSlug, keywordPage: true })),
];

console.log('① assignTargetKeywords');
{
  // 名字被翻译了（非英语站）⟹ 名字对不上，按位置
  const contentServices = [{ id: 'xi-ya', name: '洗牙' }, { id: 'mei-bai', name: '美白' }, { id: 'zhong-ya', name: '种牙' }];
  const pages = pagesFor(contentServices.map((s) => s.id));
  const a = tk.assignTargetKeywords({ keywords: KEYWORDS, services: SERVICES, contentServices, pages, keywordPagesList: KP });
  same([a.pageKeywords['services/xi-ya'], a.pageKeywords['services/mei-bai'], a.pageKeywords['services/zhong-ya']],
    ['teeth cleaning', 'whitening', 'implants'], '按位置：每张服务详情页拿到它那组的 isPrimary（组序按 services，不按对象键序）');
  same([a.unmatched, a.unassigned], [[], []], '按位置的正常例：unmatched / unassigned 都为空');
  same(a.pageKeywords.home, 'teeth cleaning', '首页 = 各服务主词里 goldIndex 最高的那条（50）');
  same(['about', 'services', 'contact'].map((s) => a.pageKeywords[s]), [undefined, undefined, undefined], '其余页不分配');
  same(KP.every((k) => a.pageKeywords[k.nestedSlug] === k.keyword), true, '每张关键词页 = 它自己的词');
  same(Object.keys(a.targetKeywords.byService), ['xi-ya', 'mei-bai', 'zhong-ya'], 'byService 的键是服务 id');
  same(a.targetKeywords.primary, { keyword: 'teeth cleaning', volume: 100, goldIndex: 50 }, 'targetKeywords.primary');
}
{
  // 数量不等（AI 多给了一个服务）、名字逐字对得上 ⟹ 退成按名对，结果同上
  const contentServices = [
    { id: 'whitening', name: 'Whitening' }, { id: 'extra', name: 'Extra Service' },
    { id: 'implants', name: 'Implants' }, { id: 'teeth-cleaning', name: 'Teeth Cleaning' },
  ];
  const pages = pagesFor(contentServices.map((s) => s.id));
  const a = tk.assignTargetKeywords({ keywords: KEYWORDS, services: SERVICES, contentServices, pages, keywordPagesList: KP });
  same([a.pageKeywords['services/teeth-cleaning'], a.pageKeywords['services/whitening'], a.pageKeywords['services/implants'], a.pageKeywords['services/extra']],
    ['teeth cleaning', 'whitening', 'implants', undefined], '数量不等 ⟹ 按名对：三张拿对主词，多出来那张没有');
  same([a.unmatched, a.unassigned], [[], []], '按名对上：unmatched / unassigned 都为空');
}
{
  // 有一组按位置、按名字都对不上（数量不等 + Implants 被 AI 改了名）
  const contentServices = [{ id: 'teeth-cleaning', name: 'Teeth Cleaning' }, { id: 'whitening', name: 'Whitening' },
    { id: 'dental-implants', name: 'Dental Implants' }, { id: 'extra', name: 'Extra' }];
  const pages = pagesFor(contentServices.map((s) => s.id));
  const a = tk.assignTargetKeywords({ keywords: KEYWORDS, services: SERVICES, contentServices, pages, keywordPagesList: KP });
  same(a.unmatched, ['implants'], 'unmatched 恰好是那一组的主词');
  const others = ['implants cost', 'implant dentist'];
  same(others.filter((k) => a.unmatched.includes(k) || a.unassigned.includes(k)), [],
    '那组的非主词两份清单里都不在（它们有关键词页）');
  same(others.map((k) => Object.values(a.pageKeywords).includes(k)), [true, true], '……而且确实挂在关键词页上');
  same(a.pageKeywords['services/dental-implants'], undefined, '对不上的服务详情页不挂词');
  same(Object.keys(a.targetKeywords.byService).includes('Implants'), true, '对不上的组用 payload 服务名做 byService 的键');
}
{
  // 一个非主词 selected 词的关键词页没生成出来 ⟹ unassigned
  const contentServices = SERVICES.map((n) => ({ id: n.toLowerCase().replace(/ /g, '-'), name: n }));
  const missing = 'whitening strips';
  const pages = pagesFor(contentServices.map((s) => s.id), KP.filter((k) => k.keyword !== missing));
  const a = tk.assignTargetKeywords({ keywords: KEYWORDS, services: SERVICES, contentServices, pages, keywordPagesList: KP });
  same(a.unassigned, [missing], '关键词页缺一张 ⟹ 那个词进 unassigned');
  same(a.unmatched, [], '……unmatched 不受影响');
}
{
  // 数量相等、名字逐字相等但 AI 把顺序换了 ⟹ 名字优先（PM 21:07 第 1 条），并记 reordered
  const contentServices = [{ id: 'implants', name: 'Implants' }, { id: 'teeth-cleaning', name: 'Teeth Cleaning' }, { id: 'whitening', name: 'Whitening' }];
  const pages = pagesFor(contentServices.map((s) => s.id));
  const a = tk.assignTargetKeywords({ keywords: KEYWORDS, services: SERVICES, contentServices, pages, keywordPagesList: KP });
  same([a.pageKeywords['services/implants'], a.pageKeywords['services/teeth-cleaning']], ['implants', 'teeth cleaning'], '重排后按名字对，不按位置');
  same(a.reordered.map((r) => r.group), ['Teeth Cleaning', 'Whitening', 'Implants'], '三组都记进 reordered');
  // 反事实：只按位置会错配 —— 证明上一格不是恒真
  const posOnly = tk.matchGroupsToServices(tk.keywordGroups(KEYWORDS, SERVICES), contentServices.map((s, i) => ({ ...s, name: `x${i}` })));
  same(posOnly.ids, ['implants', 'teeth-cleaning', 'whitening'], '反事实：名字拿掉后按位置对上的是错的那一个（Teeth Cleaning 组 → implants）');
}
{
  // Lead 站：首页 = payload.keyword（哪怕主词是用户另填的种子词）
  const keywords = { 'emergency plumber': [kw('plumber near me', 12, true), kw('24 hour plumber', 3)] };
  const a = tk.assignTargetKeywords({ keywords, services: [], contentServices: [{ id: 'general-services', name: 'General Services' }],
    pages: [{ slug: 'home' }, { slug: 'about' }], keywordPagesList: [], siteType: 'lead', keyword: 'emergency plumber' });
  same(a.pageKeywords.home, 'emergency plumber', 'Lead：首页 = payload.keyword');
  same(a.targetKeywords.primary.keyword, 'emergency plumber', 'Lead：targetKeywords.primary = payload.keyword');
}
{
  // Gold 并列取服务顺序靠前的；goldIndex 空的当最低
  const keywords = { B: [kw('b', 10, true)], A: [kw('a', 10, true)], C: [kw('c', null, true)] };
  same(tk.sitePrimaryOf(tk.keywordGroups(keywords, ['A', 'B', 'C'])).keyword, 'a', '并列 10/10 ⟹ 服务顺序靠前的 A');
  const allNull = { A: [kw('a', null, true)], B: [kw('b', null, true)] };
  same(tk.sitePrimaryOf(tk.keywordGroups(allNull, ['B', 'A'])).keyword, 'b', '全都没有 goldIndex ⟹ 退回服务顺序第一个');
}

console.log('② unmatchedServiceKeys（键不在 services.json 的 id 集合里）');
{
  const t = { primary: null, byService: { 'teeth-cleaning': [], Implants: [], whitening: [] } };
  same(tk.unmatchedServiceKeys(t, ['teeth-cleaning', 'whitening', 'implants']), ['Implants'], '服务名做键的那组被认出来');
  same(tk.unmatchedServiceKeys(t, ['teeth-cleaning', 'whitening', 'Implants']), [], '键都在 id 集合里 ⟹ 空');
  same(tk.unmatchedServiceKeys(undefined, ['x']), [], '没有 targetKeywords ⟹ 空');
}

console.log('③ validateSite 两条新规则');
{
  const TK = {
    primary: { keyword: 'teeth cleaning', volume: 100, goldIndex: 50 },
    byService: {
      'teeth-cleaning': [kw('teeth cleaning', 50, true), kw('dental cleaning', 8)],
      whitening: [kw('whitening', 20, true), kw('whitening strips', 6)],
    },
  };
  const page = (slug, k, extra = {}) => ({ slug, blocks: [], ...(k ? { seo: { targetKeyword: k, ...extra } } : {}) });
  const good = [
    page('home', 'teeth cleaning'), page('services/teeth-cleaning', 'teeth cleaning'), page('services/whitening', 'whitening'),
    page('teeth-cleaning/dental-cleaning', 'dental cleaning'), page('whitening/whitening-strips', 'whitening strips'), page('about'),
  ];
  const run = (pages, targetKeywords) => {
    const r = bm.validateSite({ pages, industry: '', targetKeywords });
    const mine = (m) => /targetKeyword|最多一页/.test(m);
    return { problems: r.problems.filter(mine), warnings: r.warnings.filter((w) => w.startsWith('没分到页的词')) };
  };
  same(run(good, TK), { problems: [], warnings: [] }, '不命中：全部合规（含「主词同在首页和服务页」）⟹ 0 条');

  const r1 = run([...good, page('faq', 'invented phrase')], TK);
  same(r1.problems.length === 1 && r1.problems[0].startsWith('faq: seo.targetKeyword "invented phrase" 不在'), true,
    `① 命中：清单外的词 ⟹ 1 条（${r1.problems[0]}）`);

  const r2 = run([...good, page('whitening/strips-2', 'whitening strips')], TK);
  same(r2.problems.length === 1 && r2.problems[0].includes('"whitening strips" 分到了 2 页'), true,
    `② 命中：非主词分到两页 ⟹ 1 条（${r2.problems[0]}）`);
  const r2b = run([...good, page('services', 'whitening')], TK);
  same(r2b.problems, [], '② 不命中：主词分到多页（服务页 + 另一页）不报');

  same(run([...good, page('faq', 'invented phrase')], undefined), { problems: [], warnings: [] },
    '老站（没传 targetKeywords）⟹ 两条都不查');
  same(run([page('home', 'x')], { primary: null, byService: {} }).problems.length, 1,
    '阳性对照：传了空清单（新站一个词都没选时建站写的就是这个形状）⟹ 照查照报');

  same(run([...good, page('fr-home', 'nettoyage', { translated: true })], TK).problems, [], '翻译来的页（translated: true）第 ① 条不查');

  const r3 = run(good.filter((p) => p.slug !== 'whitening/whitening-strips'), TK);
  same(r3.warnings.length === 1 && r3.warnings[0].includes('"whitening strips"') && r3.problems.length === 0, true,
    `没分到页的词进 warnings、不进 problems（${r3.warnings[0]}）`);
}

console.log('④ keywordBrief');
{
  same(tk.keywordBrief({ sitePrimary: null, groups: [], keywordPagesList: [] }), '', '什么都没有 ⟹ 空串');
  const groups = tk.keywordGroups(KEYWORDS, SERVICES);
  const s = tk.keywordBrief({ sitePrimary: tk.sitePrimaryOf(groups), groups, keywordPagesList: KP });
  same(['"teeth cleaning" — the HOME page', 'Implants → "implants"', `/${KP[0].nestedSlug} → "${KP[0].keyword}"`].every((x) => s.includes(x)), true,
    '(a) 站主词 (b) 每服务主词 (c) 关键词页 三样都在');
  // #1550 —— Call 1 那一刻服务 id 还没有，关键词页的 URL 定不下来（`create-site.js §keywordPagesFrom` 只给词和组名）：
  //    清单写成「某服务下单独一页」，不编一个 `/<服务>/<词>` 出来（那正是本票要换掉的旧形状）。
  const c = tk.keywordBrief({ sitePrimary: null, groups, keywordPagesList: [{ group: 'Implants', keyword: 'implants cost' }] });
  same(c.includes('"implants cost" (its own page, under the Implants service)') && !/ \/[a-z]/.test(c.split('Keyword pages')[1]), true,
    '(c) 没有路径时：写它属于哪个服务，不出现任何 /路径');
  // #1568 r2 —— 这一段只给站级那一通当上下文：关键词页由 Call 2 建，提示词要明说别写进 pages。
  same(s.includes('do NOT add them to "pages"') && c.includes('do NOT add them to "pages"'), true, '(c) 关键词页那段写明「不许放进 pages」');
}

console.log('\n── ⑤ localizeKeywords（#1569 r3）：主语言非英语时服务主词换成翻译种子 · 汉字间空格去掉');
{
  const { localizeKeywords, assignTargetKeywords, sitePrimaryOf, keywordGroups } = tk;
  const kp = require('./keyword-pages.js');
  // site-ea408218 那一份的形状：Haircut 组有翻译种子（带空格）+ 中文联想词；Perming 组翻译失败、只有英文主词
  const ZH = {
    Haircut: [
      { keyword: 'haircut', isPrimary: true, selected: true, source: 'service', goldIndex: 10 },
      { keyword: '剪 发', source: 'translated-seed', selected: false, goldIndex: 40 },
      { keyword: '剪 发 店', source: 'autocomplete', selected: true, goldIndex: 30 },
    ],
    Perming: [{ keyword: 'perming', isPrimary: true, selected: true, source: 'service', goldIndex: 50 }],
  };
  const svcs = ['Haircut', 'Perming'];
  const contentServices = [{ id: 'haircut', name: 'Haircut' }, { id: 'perming', name: 'Perming' }];
  const pages = [{ slug: 'home' }, { slug: 'services/haircut', serviceDetailPage: true }, { slug: 'services/perming', serviceDetailPage: true }];

  const zh = localizeKeywords(ZH, 'zh');
  same(zh.swapped, [{ group: 'Haircut', from: 'haircut', to: '剪发' }], 'zh：Haircut 组主词 haircut → 翻译种子「剪发」（空格已去）');
  const a = assignTargetKeywords({ keywords: zh.keywords, services: svcs, contentServices, pages });
  same(a.pageKeywords['services/haircut'], '剪发', 'zh：Haircut 服务页的目标词 = 翻译种子');
  same(a.pageKeywords['services/perming'], 'perming', 'zh：Perming 组没有翻译种子（翻译失败）⟹ 回退原服务名');
  same(a.pageKeywords.home, 'perming', 'zh：Brand 站主词仍按各组主词的 Gold 取（perming 50 > 剪发 40）');
  const zhHome = localizeKeywords({ ...ZH, Perming: [{ ...ZH.Perming[0], goldIndex: 5 }] }, 'zh');
  same(sitePrimaryOf(keywordGroups(zhHome.keywords, svcs), {}).keyword, '剪发', 'zh：站主词同理 —— Gold 最高的那组主词是翻译种子时首页拿中文');
  same(kp.keywordPageCandidates(zh.keywords, svcs).map((c) => c.keyword), ['剪发店'],
    'zh：关键词页候选不含被换下的英文主词、也不含已当主词的翻译种子；联想词「剪发店」空格已去');
  same(a.targetKeywords.byService.haircut.map((e) => `${e.keyword}:${e.isPrimary}`), ['haircut:false', '剪发:true', '剪发店:false'], 'zh：seo.json 的 byService 里主词标记跟着换');
  same(localizeKeywords(ZH, 'zh', 'Haircut').leadKeyword, '剪发', 'zh：Lead 站主词正是被换掉的英文主词 ⟹ 跟着换');
  same(localizeKeywords(ZH, 'zh', 'hair salon toronto').leadKeyword, 'hair salon toronto', 'zh：Lead 站主词不是被换掉的那个 ⟹ 原样');

  // 英文站：主词不换；去空格只碰汉字之间（英文词原样）
  const en = localizeKeywords(ZH, 'en');
  same(en.swapped, [], 'en：不换主词');
  same(assignTargetKeywords({ keywords: en.keywords, services: svcs, contentServices, pages }).pageKeywords['services/haircut'], 'haircut', 'en：Haircut 服务页仍是 haircut');
  const plain = { Haircut: [{ keyword: 'haircut', isPrimary: true, selected: true }, { keyword: 'haircut near me', selected: true }] };
  same(localizeKeywords(plain, 'en').keywords, plain, 'en：没有汉字的 payload 逐字节不变');
  same(localizeKeywords(plain, 'zh-TW').swapped, [], 'zh-TW：没有翻译种子的组不动');

  // 反向对照：不经 localizeKeywords，同一份 payload 的服务页拿的是英文（这正是 Chris 撞上的那个）
  same(assignTargetKeywords({ keywords: ZH, services: svcs, contentServices, pages }).pageKeywords['services/haircut'], 'haircut', '反向对照：没换之前 Haircut 服务页 = haircut');
  // 去空格后撞重：同组里「剪 发」和「剪发」并成一条，标记取并集
  const dup = localizeKeywords({ X: [{ keyword: 'x', isPrimary: true }, { keyword: '剪发', selected: false, source: 'autocomplete' }, { keyword: '剪 发', source: 'translated-seed', selected: true }] }, 'zh');
  same(dup.keywords.X.map((e) => [e.keyword, e.isPrimary === true, e.source]), [['x', false, undefined], ['剪发', true, 'translated-seed']], '去空格后撞重 ⟹ 并成一条（带上 translated-seed），再当主词');
}

console.log(failed ? `\n❌ ${failed} 格没过` : '\n✅ 全过');
process.exit(failed ? 1 : 0);
