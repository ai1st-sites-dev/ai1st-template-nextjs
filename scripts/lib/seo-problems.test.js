#!/usr/bin/env node
/**
 * seo-problems.test.js — `seoProblems` 的八条规则（#1549，设计文档 S2）。
 *
 * 跑法:  node scripts/lib/seo-problems.test.js   （或 `npm run test:scripts`，它按文件名发现）
 * 退出码: 0 全过 · 1 有失败 · 2 跑不起来（**不许当成通过**）
 *
 * ① 有目标词：八条各一正一反（验收 1）
 * ② 没有目标词：第 4、7 条不报；第 1/2/3/6 条只报跟目标词无关的那一半；第 5、8 条照报（验收 1）
 * ③ title 预算：品牌名 10 字时 page.title 48 报 / 47 不报，首页 siteTitle 60 不报；品牌名 45 字（预算 12 < 20）
 *    长度那一半不报；brand.name = { zh: 45 字, en: 10 字 }、locale = en ⟹ 按 10 字算（验收 2）
 * ④ 事实出处：出处取整份建站表格；电话里的四位数不算年份；声明词按整词（insurance ≠ insured）
 * ⑤ 🔴 H1 / H2 两张表跟**渲染出来的标签**对账：每个页面块真渲染一遍，数 <h1> / <h2>
 * ⑥ 🔴 「内容图」跟**渲染出来的 <img>**对账：每个带图槽的块、每档图旋钮真渲染一遍，内容图 = 渲染出来的
 *    <img src> 减掉头像 / 标志 / 铺底装饰图；alt 对账渲染出来的 alt 属性
 *
 * ⑤⑥ 是判据的来源：「哪些块出 <h2>」「哪些图槽出 <img>」读源码可能读错，渲染出来的不会。
 * 每段都带反向对照（同一进程、单变量），证明判据真会红。
 */

'use strict';

const fs = require('fs');
const path = require('path');
const Module = require('module');

const NEXT = path.resolve(__dirname, '..', '..');
const SRC = path.join(NEXT, 'src');

let pass = 0;
let fail = 0;
const ok = (m) => { pass += 1; console.log(`  ✅ ${m}`); };
const bad = (m) => { fail += 1; console.log(`  ❌ ${m}`); };
const die = (m) => { console.error(`🔴 跑不起来: ${m}`); process.exit(2); };
const check = (cond, m, detail) => (cond ? ok(m) : bad(detail ? `${m} —— ${detail}` : m));

let S;
let bm;
try {
  S = require('./seo-problems');
  bm = require('./block-manifest');
} catch (e) { die(e.stack || e.message); }
const { seoProblems } = S;

const fired = (problems, n) => problems.filter((p) => p.startsWith(`[${n} `));
const firedAny = (problems, n) => fired(problems, n).length > 0;

// ── 夹具：一页「八条全过」的关键词页，单变量地改坏一处 ─────────────────────────────────────────
const KW = 'drain cleaning Markham';
const BRAND = { name: { en: 'Acme Drains' } }; // 11 字 ⟹ page.title 预算 46
const PAYLOAD = {
  companyName: 'Acme Drains', location: 'Markham, ON', phone: '905-555-0142', usp: 'Licensed plumbers, same-day service',
  brandDescription: 'Family-run drain company', reviews: [{ text: 'They fixed it in 2019 for $120. Great!' }], hours: 'Mon–Fri 8–6',
  address: '1 Main St, Markham',
};
const DESC = 'Fast drain cleaning Markham homeowners trust — Acme clears clogged sinks, tubs and main lines the same day in Markham.';

function goodPage() {
  return {
    slug: 'services/drains/drain-cleaning-markham',
    title: 'Drain Cleaning Markham — Same-Day',
    description: DESC,
    keywordPage: true,
    sections: [
      { type: 'page-header', data: { headline: 'Drain Cleaning in Markham', subheadline: `Same-day ${KW} by licensed plumbers.` } },
      { type: 'content', data: { headline: 'Why Markham homes need drain cleaning', body: '<p>Roots and grease clog old pipes.</p>',
        image: { imageUrl: '/photos/a.jpg', alt: `Plumber doing ${KW} in a basement` }, options: { image: 'left' } } },
      { type: 'faq', data: { headline: 'Drain cleaning questions', items: [{ question: 'How long?', answer: 'About an hour.' }] } },
      { type: 'cta', data: { headline: 'Book now', body: 'Call us today.', ctas: [{ label: 'Quote', href: '/quote', style: 'solid' }] } },
    ],
  };
}
const args = (page, extra = {}) => ({ page, pages: [page], targetKeyword: KW, brand: BRAND, payload: PAYLOAD, locale: 'en', seo: {}, ...extra });
const mut = (f) => { const p = goodPage(); f(p); return p; };

console.log('\n── ① 有目标词：八条各一正一反');
{
  const base = seoProblems(args(goodPage()));
  check(base.length === 0, '基准页八条全过（反例都从它单变量改出来）', JSON.stringify(base));

  const cases = [
    [1, 'title 不含目标词', mut((p) => { p.title = 'Same-Day Drain Service'; })],
    [1, 'title 连后缀超 60', mut((p) => { p.title = `${KW} — fast, friendly, fair and local`; })],
    [2, 'description 不含目标词', mut((p) => { p.description = DESC.replace(/drain cleaning Markham/, 'drain work'); })],
    [2, 'description 短于 70', mut((p) => { p.description = `${KW} today.`; })],
    [3, '两个 H1', mut((p) => { p.sections.unshift({ type: 'hero', data: { headline: 'Drain Cleaning Markham' } }); })],
    [3, 'H1 不含目标词', mut((p) => { p.sections[0].data.headline = 'Same-day service'; })],
    [4, '前 100 词没有目标词', mut((p) => { p.sections[0].data.subheadline = 'Same-day help by licensed plumbers.'; p.sections.splice(1, 0, { type: 'content', data: { headline: 'More', body: 'word '.repeat(120) } }); })],
    [5, 'slug 有空段', mut((p) => { p.slug = 'services/drains/'; })],
    [6, '内容图 alt 为空', mut((p) => { p.sections[1].data.image.alt = ''; })],
    [6, '没有一张 alt 含目标词', mut((p) => { p.sections[1].data.image.alt = 'A plumber at work'; })],
    [7, '只有 1 个 H2 含目标词的词', mut((p) => { p.sections[2].data.headline = 'Questions'; })],
    [8, '编造的年份', mut((p) => { p.sections[1].data.body = '<p>Serving Markham since 2015.</p>'; })],
  ];
  for (const [n, name, page] of cases) {
    const got = seoProblems(args(page));
    check(firedAny(got, n), `第 ${n} 条开火：${name}`, JSON.stringify(got));
    const others = got.filter((x) => !x.startsWith(`[${n} `) && !(n === 3 && x.startsWith('[4 ')) && !(n === 4 && x.startsWith('[7 ')));
    check(others.length === 0, `　…且只有第 ${n} 条（单变量）`, JSON.stringify(others));
  }
  // 「description 不含地点」：目标词里本来就有 Markham，换一个不带地点的目标词来测。
  {
    const kw2 = 'drain cleaning';
    const p = goodPage();
    p.description = `Fast ${kw2} for homeowners — Acme clears clogged sinks, tubs and main lines the same day, every day.`;
    const got = seoProblems({ ...args(p), targetKeyword: kw2 });
    check(got.some((x) => x === '[2 description] description 不含地点「Markham」'), '第 2 条开火：description 不含地点（payload.location 第一个逗号前）', JSON.stringify(got));
    const noLoc = seoProblems({ ...args(p), targetKeyword: kw2, payload: { ...PAYLOAD, location: '' } });
    check(!noLoc.some((x) => x.includes('不含地点')), '　location 为空时地点那一半不判', JSON.stringify(noLoc));
  }
  // #1569 —— 主语言非英语的站：地点按向导翻好的 `locationLocalized` 判（中文描述里要的是「多伦多」，不是 Toronto）。
  {
    const kw = '剪头发';
    const zhPayload = { ...PAYLOAD, location: 'Toronto, Ontario, Canada', locationLocalized: '多伦多, 安大略省, 加拿大' };
    const loc = (desc, payload) => {
      const p = goodPage();
      p.description = desc;
      return seoProblems({ ...args(p), targetKeyword: kw, payload }).filter((x) => x.includes('不含地点'));
    };
    check(loc('我们在多伦多提供专业剪头发服务，当天预约当天剪。', zhPayload).length === 0,
      '#1569 中文站：description 含「多伦多」⟹ 地点那一半不报');
    const miss = loc('我们在 Toronto 提供专业剪头发服务，当天预约当天剪。', zhPayload);
    check(miss.length === 1 && miss[0] === '[2 description] description 不含地点「多伦多」',
      '#1569 　反向对照：只有英文 Toronto ⟹ 报「不含地点「多伦多」」', JSON.stringify(miss));
    check(loc('我们在多伦多提供专业剪头发服务。', { ...zhPayload, locationLocalized: '多伦多，安大略省，加拿大' }).length === 0,
      '#1569 　翻译回来用的是全角逗号也取得到第一段「多伦多」');
    const en = loc('We offer 剪头发 in Toronto, same day.', { ...PAYLOAD, location: 'Toronto, Ontario, Canada' });
    check(en.length === 0, '#1569 　英文站（没有 locationLocalized）照旧按 location 判 Toronto', JSON.stringify(en));
    check(S.sourceText(zhPayload).includes('多伦多'), '#1569 　事实出处（规则 8）也认 locationLocalized');
    // 给 AI 的那行 LOCATION（create-site 每一次提示词）：中文站两份都给；英文站原样
    check(S.promptLocation(zhPayload) === '多伦多, 安大略省, 加拿大 (Toronto, Ontario, Canada)',
      '#1569 　提示词里的地点：主语言那份 + 括号里原文', S.promptLocation(zhPayload));
    check(S.promptLocation({ location: 'Toronto, Ontario, Canada' }) === 'Toronto, Ontario, Canada'
      && S.promptLocation({ location: 'Toronto, Ontario, Canada', locationLocalized: '  ' }) === 'Toronto, Ontario, Canada'
      && S.promptLocation({}) === '',
      '#1569 　英文站 / 空的 locationLocalized / 没有地点：原样，不加括号');
  }
  // 5 slug 站内重复
  {
    const a = goodPage(); const b = goodPage();
    const got = seoProblems({ ...args(a), pages: [a, b] });
    check(firedAny(got, 5) && got.some((x) => x.includes('站内重复')), '第 5 条开火：slug 站内重复', JSON.stringify(got));
  }
  // 5 slug：🔴 改前的阳性读数那一形 —— 今天的 slugify 把纯中文词变成空串，nestedSlug = "<服务>/"
  {
    const p = mut((x) => { x.slug = 'services/'; });
    check(fired(seoProblems(args(p)), 5).length === 1, '第 5 条开火：纯中文词今天被 slugify 成空串（"services/"）');
  }
  // 8 金额 / 声明词
  check(firedAny(seoProblems(args(mut((p) => { p.sections[3].data.body = 'Only $99 per visit.'; }))), 8), '第 8 条开火：编造的金额（$99）');
  check(!firedAny(seoProblems(args(mut((p) => { p.sections[3].data.body = 'Most visits are about $120.'; }))), 8), '　反例：$120 在评价里 ⟹ 不报');
  check(firedAny(seoProblems(args(mut((p) => { p.sections[3].data.body = 'Fully insured.'; }))), 8), '第 8 条开火：insured 表格里没有');
  check(!firedAny(seoProblems(args(mut((p) => { p.sections[3].data.body = 'Licensed crew.'; }))), 8), '　反例：licensed 在 USP 里 ⟹ 不报');
}

console.log('\n── ①b 词干：自然变体认成同一个词（第 3、7 条）');
{
  const same = (a, b) => S.keywordStems(a).every((st) => S.hasStem(b, st));
  for (const [kw, text] of [['Plant Delivery', 'Fresh Indoor Plants Delivered Across Toronto'], ['Event Decorating', 'Event decoration that wows'],
    ['plumber', 'Plumbing done right'], ['drain cleaning', 'Drain cleaners near you'], ['剪头发 Markham', 'Markham 专业剪头发']]) {
    check(same(kw, text), `「${kw}」的每个词干都在「${text}」里`, JSON.stringify(S.keywordStems(kw)));
  }
  check(!same('Plant Delivery', 'Fresh Indoor Plants Across Toronto') && !same('剪头发', '专业理发'), '　反例：真的缺一个词时读成「不含」');
}

console.log('\n── ② 没有目标词：只判跟目标词无关的那一半');
{
  const none = (page) => seoProblems({ ...args(page), targetKeyword: '' });
  const p0 = mut((p) => { p.slug = 'about'; });
  check(none(p0).length === 0, '基准页（同一页、没有目标词）全过', JSON.stringify(none(p0)));
  check(S.rulesFor('').join(',') === '1,2,3,5,6,8' && S.rulesFor(KW).join(',') === '1,2,3,4,5,6,7,8', '跑哪几条：没有目标词时是 1,2,3,5,6,8');
  const g = (f) => none(mut((p) => { p.slug = 'about'; f(p); }));
  check(firedAny(g((p) => { p.title = 'x'.repeat(50); }), 1), '第 1 条：title 连后缀超 60 报');
  check(!firedAny(g((p) => { p.title = 'About us'; }), 1), '第 1 条：title 里没有关键词不报');
  check(firedAny(g((p) => { p.description = 'Short.'; }), 2), '第 2 条：description 长度越界报');
  check(!firedAny(g((p) => { p.description = 'We are a family-run company that has served homeowners with care, honesty and fair prices.'; }), 2), '第 2 条：不含地点 / 关键词不报');
  check(firedAny(g((p) => { p.sections.unshift({ type: 'hero', data: { headline: 'Hi' } }); }), 3), '第 3 条：两个 h1 报');
  check(!firedAny(g((p) => { p.sections[0].data.headline = 'About us'; }), 3), '第 3 条：h1 不含关键词不报');
  check(firedAny(g((p) => { p.sections[1].data.image.alt = ''; }), 6), '第 6 条：一张 alt 为空报');
  check(!firedAny(g((p) => { p.sections[1].data.image.alt = 'Our team'; }), 6), '第 6 条：没有一张 alt 含关键词不报');
  check(!firedAny(g((p) => { p.sections.splice(1, 3); p.sections.push({ type: 'content', data: { body: 'word '.repeat(150) } }); }), 4), '第 4 条：不报（前 100 词没有关键词）');
  check(!firedAny(g((p) => { p.sections[2].data.headline = 'Questions'; }), 7), '第 7 条：不报');
  check(firedAny(g((p) => { p.slug = 'about/'; }), 5), '第 5 条：照报（空段）');
  check(firedAny(g((p) => { p.sections[3].data.body = 'Since 2015.'; }), 8), '第 8 条：照报（编造的年份）');
}

console.log('\n── ③ title 预算（品牌名取主语言那一个）');
{
  const brand10 = { name: { en: 'B'.repeat(10) } };
  const sub = (title, brand = brand10, locale = 'en') => seoProblems({ page: { slug: 'about', title, description: 'd'.repeat(80), sections: [{ type: 'page-header', data: { headline: 'H' } }] }, pages: [], targetKeyword: '', brand, payload: {}, locale, seo: {} });
  check(S.pageTitleBudget('B'.repeat(10)) === 47, '预算 = 60 − 3 − 10 = 47');
  check(firedAny(sub('t'.repeat(48)), 1), '品牌名 10 字：page.title 48 字报');
  check(!firedAny(sub('t'.repeat(47)), 1), '品牌名 10 字：page.title 47 字不报');
  const msg = fired(sub('t'.repeat(48)), 1)[0] || '';
  check(/61 字/.test(msg) && /最多 47 字/.test(msg), 'problem 写出总长和预算数字', msg);
  const home = seoProblems({ page: { slug: 'home', title: 'ignored', sections: [{ type: 'hero', data: { headline: 'H' } }] }, pages: [], targetKeyword: '', brand: brand10, payload: {}, locale: 'en', seo: { siteTitle: 's'.repeat(60), siteDescription: 'd'.repeat(80) } });
  check(!firedAny(home, 1), '首页 siteTitle 60 字不报（不加后缀）', JSON.stringify(home));
  const home61 = seoProblems({ page: { slug: 'home', sections: [{ type: 'hero', data: { headline: 'H' } }] }, pages: [], targetKeyword: '', brand: brand10, payload: {}, locale: 'en', seo: { siteTitle: 's'.repeat(61), siteDescription: 'd'.repeat(80) } });
  check(firedAny(home61, 1), '　反例：首页 siteTitle 61 字报');
  check(!firedAny(sub('t'.repeat(48), { name: { en: 'B'.repeat(45) } }), 1), '品牌名 45 字（预算 12 < 20）：长度那一半不报');
  check(firedAny(sub('t'.repeat(48), { name: { zh: '名'.repeat(45), en: 'B'.repeat(10) } }, 'en'), 1), 'brand.name = { zh: 45 字, en: 10 字 }、locale = en ⟹ 按 10 字算（48 字报）');
  check(!firedAny(sub('t'.repeat(48), { name: { zh: '名'.repeat(45), en: 'B'.repeat(10) } }, 'zh'), 1), '　对照：同一份 brand、locale = zh ⟹ 按 45 字算、预算 < 20、不判');
}

console.log('\n── ④ 事实出处的边界');
{
  const one = (body, payload = PAYLOAD) => fired(seoProblems({ ...args(mut((p) => { p.sections[3].data.body = body; })), payload }), 8);
  check(one('Call 905-555-2015 now.').length === 0, '电话号码里的 2015 不算年份（前后连着 - 和数字）');
  check(one('Since 2019.').length === 0, '年份在评价里 ⟹ 有出处');
  check(one('Since 2019.', { ...PAYLOAD, reviews: [] }).length === 1, '　反例：拿掉评价 ⟹ 报');
  check(one('Fully licensed.', { ...PAYLOAD, usp: 'fast' }).length === 1, 'licensed：表格里没有 ⟹ 报');
  check(one('We handle insurance claims.').length === 0, 'insurance 不是 insured（整词）');
  check(one('Over 20 years of experience.').length === 1, '「20 years」表格里没有 ⟹ 报');
  check(one('Over 20 years of experience.', { ...PAYLOAD, brandDescription: 'In business for 20 years' }).length === 0, '　反例：描述里写着 20 years ⟹ 不报');
  check(one('Plumbing 2000 crew.', { ...PAYLOAD, companyName: 'Plumbing 2000' }).length === 0, '公司名里的数字有出处（出处取整份表格）');
  check(one('获奖团队，从2015年开始服务。').length === 2, '中文：获奖 + 2015 年都报', JSON.stringify(one('获奖团队，从2015年开始服务。')));
}

// ── ⑤⑥ 渲染对账：让 node 能 require 块组件 ─────────────────────────────────────────────────────
let React;
let renderToStaticMarkup;
let ts;
try {
  ts = require('typescript');
  React = require('react');
  ({ renderToStaticMarkup } = require('react-dom/server'));
} catch (e) { die(`渲染要的依赖装不上：${e.message}`); }

for (const ext of ['.tsx', '.ts']) {
  require.extensions[ext] = (mod, filename) => mod._compile(ts.transpileModule(fs.readFileSync(filename, 'utf-8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true, resolveJsonModule: true },
    fileName: filename,
  }).outputText, filename);
}
const STUB_DIR = path.join(NEXT, 'scripts', '.seo-problems-stubs');
fs.mkdirSync(STUB_DIR, { recursive: true });
process.on('exit', () => { try { fs.rmSync(STUB_DIR, { recursive: true, force: true }); } catch (e) { /* 收尾 */ } });
const stub = (name, body) => { const p = path.join(STUB_DIR, `${name}.js`); fs.writeFileSync(p, body); return p; };
const STUBS = {
  'next/link': stub('link', "const React=require('react');"
    + "const L=({href,children,...r})=>React.createElement('a',{href,...r},children);module.exports=L;module.exports.default=L;\n"),
  '@/lib/config': stub('config', 'module.exports={siteId:"t",leadApi:"",localeUrl:(s)=>"/"+s,'
    + 'getServices:()=>[{id:"a",name:"A"}],pagesByLocale:{en:[]},'
    + 'getBlogPosts:()=>[{slug:"p",title:"P",excerpt:"E",content:"<p>x</p>",category:"C",tags:[],author:"A",publishedAt:"2026-09-01",coverImage:{imageUrl:"/blog-cover.png",alt:"c"},seo:{metaTitle:"",metaDescription:""}}],'
    + 'brand:{locations:[{phone:"1",email:"a@b.c",address:"x"}],email:"a@b.c",phone:"1"},getBrand:()=>({locations:[]})};\n'),
};
const origResolve = Module._resolveFilename;
Module._resolveFilename = function resolve(req, ...rest) {
  if (STUBS[req]) return STUBS[req];
  if (req.startsWith('@/')) return origResolve.call(this, path.join(SRC, req.slice(2)), ...rest);
  if (req.startsWith('@blocks/')) return origResolve.call(this, path.join(NEXT, 'blocks', req.slice(8)), ...rest);
  return origResolve.call(this, req, ...rest);
};

const manifests = bm.loadManifests();
const render = (type, data) => {
  const file = path.join(NEXT, 'blocks', type, 'Section.tsx');
  const C = require(file).default;
  return renderToStaticMarkup(React.createElement(C, { data, locale: 'en', block: { id: `${type}-0`, type, role: 'essential', region: 'content', data: {} } }));
};

// 每个槽按 shape 造一份「画得出来」的数据：文字槽给字、列表给 3 项、对象图槽给 {imageUrl, alt}。
// 图址按槽位唯一（`/u/<块>/<槽>[-<项>].png`），渲染出来的 <img src> 才认得出是哪一个槽画的。
function fixture(type) {
  const m = manifests.get(type);
  const d = {};
  for (const [slot, s] of Object.entries(m.slots || {})) {
    if (slot === 'options' || slot === 'bg') continue;
    const shape = typeof s.shape === 'string' ? s.shape : '';
    const url = (suffix = '') => `/u/${type}/${slot}${suffix}.png`;
    if (s.kind === 'text' || s.kind === 'richtext') d[slot] = `${slot}-text`;
    else if (s.kind === 'list') {
      d[slot] = [0, 1, 2].map((i) => {
        const it = {};
        for (const k of [...shape.matchAll(/[{,]\s*(\w+)\??/g)].map((x) => x[1])) it[k] = `${slot}-${i}-${k}`;
        const nested = shape.match(/(\w+)\??\s*:\s*\{[^{}]*\bimageUrl\b/);
        if (nested) it[nested[1]] = { imageUrl: url(`-${i}`), alt: `${slot}-${i}-alt` };
        else if (shape.includes('imageUrl')) { it.imageUrl = url(`-${i}`); it.alt = `${slot}-${i}-alt`; }
        if ('href' in it) it.href = '/x';
        if ('rating' in it) it.rating = 5;
        if ('count' in it) it.count = 12; // reviews.platforms：platformOf 要有限正数，字符串会让三条全被丢、整块不画（#1536 做什么 2 ③）
        if ('price' in it) it.price = { monthly: '$1' };
        if ('kind' in it) it.kind = 'link';
        if ('style' in it) it.style = 'solid';
        if ('bullets' in it) it.bullets = ['b'];
        if ('link' in it) it.link = { label: 'l', href: '/x' };
        if ('number' in it) delete it.number;
        if ('icon' in it) delete it.icon;
        return it;
      });
    } else if (s.kind === 'object') {
      if (/^\{\s*imageUrl\b/.test(shape) || /^\{[^{}]*\bimageUrl\b[^{}]*\}$/.test(shape)) d[slot] = { imageUrl: url(), alt: `${slot}-alt` };
      else if (slot === 'eyebrow' || slot === 'introEyebrow') d[slot] = { text: `${slot}-text`, style: 'pill' };
      else if (slot === 'logos') d[slot] = { caption: 'c', items: [{ imageUrl: url('-0'), alt: 'l' }] };
      else if (slot === 'proof') d[slot] = { avatars: [{ imageUrl: url('-0') }], rating: 5, text: 'p' };
      else if (slot === 'form') d[slot] = {};
    }
  }
  return d;
}

// ⑤ 对账：每个页面块把 headline 画成什么标签，跟 H1 / H2 两张表比。回不一致的块名。
const pageTypes = [...manifests.keys()].filter((t) => manifests.get(t).region !== true);
function headingMismatches(h1Set, h2Set) {
  const out = [];
  const h2Rendered = [];
  for (const type of pageTypes) {
    const html = render(type, fixture(type));
    const h1 = (html.match(/<h1[\s>][^]*?<\/h1>/g) || []).filter((h) => h.includes('headline-text')).length;
    const h2 = (html.match(/<h2[\s>][^]*?<\/h2>/g) || []).filter((h) => h.includes('headline-text')).length;
    if (h2) h2Rendered.push(type);
    if (h1 !== (h1Set.has(type) ? 1 : 0) || h2 !== (h2Set.has(type) ? 1 : 0)) out.push(`${type}(h1=${h1} h2=${h2})`);
  }
  return { out, h2Rendered };
}

console.log('\n── ⑤ H1 / H2 两张表 vs 渲染出来的标签');
try {
  check(pageTypes.length >= 15, `页面块 ${pageTypes.length} 个（外壳区 header / footer 不算）`);
  const { out, h2Rendered } = headingMismatches(S.H1_BLOCKS, S.H2_BLOCKS);
  check(out.length === 0, `${pageTypes.length} 个页面块的 headline 标签跟两张表一致`, out.join(' '));
  check(h2Rendered.length === 13, `把 headline 画成 <h2> 的页面块 = ${h2Rendered.length}（正文记的 13）`, h2Rendered.join(' '));
  check(S.H1_BLOCKS.size === 2 && S.H1_BLOCKS.has('hero') && S.H1_BLOCKS.has('page-header'), 'H1 只来自 hero / page-header');
  // 反向对照：H2 表里少一个块 / H1 表里多一个块 ⟹ 对账必须点名它
  const lessH2 = headingMismatches(S.H1_BLOCKS, new Set([...S.H2_BLOCKS].filter((t) => t !== 'faq'))).out;
  check(lessH2.some((x) => x.startsWith('faq(')), '　反向对照：H2 表里拿掉 faq ⟹ 对账点名 faq', lessH2.join(' '));
  const moreH1 = headingMismatches(new Set([...S.H1_BLOCKS, 'cta']), S.H2_BLOCKS).out;
  check(moreH1.some((x) => x.startsWith('cta(')), '　反向对照：H1 表里多放 cta ⟹ 对账点名 cta', moreH1.join(' '));
} catch (e) { bad(`⑤ 渲染抛了：${e.stack || e.message}`); }

// ⑥ 对账：每个带图槽的块、每档图旋钮真渲染一遍，内容图 = 渲染出来的 <img src> 减掉头像 / 标志 / 铺底装饰图。
// 头像 / 标志：渲染出 <img> 但按判据不算（理由在 seo-problems.js §IMG_SLOTS 头注）
const IDENTITY = /\/u\/(hero|pricing)\/(proof|logos)|\/u\/logos\/|\/u\/team\/|\/u\/testimonials\//;
const IMG_TYPES = Object.keys(S.IMG_SLOTS).concat(['logos', 'team', 'testimonials', 'pricing']);
const knobValues = (type, name) => {
  const k = ((manifests.get(type).slots.options || {}).knobs || []).find((x) => x.name === name);
  return k ? k.values : [undefined];
};
function imageCells(table) {
  const cells = [];
  for (const type of IMG_TYPES) {
    const knobs = (table[type] || []).map((r) => r.knob).filter(Boolean);
    const combos = knobs.length ? knobs.flatMap((kn) => knobValues(type, kn).map((v) => ({ [kn]: v }))) : [{}];
    for (const opts of combos) {
      const data = { ...fixture(type), options: opts };
      const html = render(type, data);
      const imgs = [...html.matchAll(/<img\b[^>]*>/g)].map((m) => m[0]);
      const srcOf = (t) => (t.match(/\bsrc="([^"]*)"/) || [])[1];
      const altOf = (t) => (t.match(/\balt="([^"]*)"/) || [null, ''])[1];
      const decor = type === 'page-header' && opts.image === 'background'; // 铺底：组件写死 alt=""、aria-hidden
      const rendered = new Map();
      let identity = 0;
      for (const t of imgs) {
        const src = srcOf(t);
        if (!src || !src.startsWith('/u/')) continue;
        if (IDENTITY.test(src) || decor) { identity += 1; continue; }
        if (!rendered.has(src)) rendered.set(src, altOf(t));
      }
      // 被测的那份表临时换进模块里（反向对照用），量完原样放回 —— 原来没有这个键就删掉，不留一个 undefined
      const had = Object.prototype.hasOwnProperty.call(S.IMG_SLOTS, type);
      const saved = S.IMG_SLOTS[type];
      const swap = table !== S.IMG_SLOTS && Object.prototype.hasOwnProperty.call(table, type);
      if (swap) S.IMG_SLOTS[type] = table[type];
      let mine;
      try { mine = new Map(S.contentImagesOf({ slug: 'x', sections: [{ type, data }] }, manifests).map((x) => [x.img.imageUrl, x.alt])); }
      finally { if (swap) { if (had) S.IMG_SLOTS[type] = saved; else delete S.IMG_SLOTS[type]; } }
      cells.push({ type, opts, rendered, mine, identity });
    }
  }
  return cells;
}
const cellOk = (c) => [...c.rendered.keys()].sort().join(' ') === [...c.mine.keys()].sort().join(' ')
  && [...c.mine].every(([src, alt]) => c.rendered.get(src) === alt);

console.log('\n── ⑥ 内容图 vs 渲染出来的 <img>');
try {
  const cells = imageCells(S.IMG_SLOTS);
  for (const c of cells) {
    check(cellOk(c), `${c.type} ${JSON.stringify(c.opts)}: 内容图 ${c.mine.size} 张 = 渲染出来的 ${c.rendered.size} 张（alt 逐张相同）`,
      `渲染 ${JSON.stringify([...c.rendered])} · 函数 ${JSON.stringify([...c.mine])}`);
  }
  check(cells.length >= 40, `对账了 ${cells.length} 格（块 × 图旋钮档位）`);
  // 头像 / 标志确实画出了 <img>（「被排除」不是「本来就没有」）
  for (const t of ['logos', 'team', 'testimonials', 'pricing']) {
    const c = cells.find((x) => x.type === t);
    check(c && c.identity > 0 && c.mine.size === 0, `${t}: 渲染出 ${c ? c.identity : 0} 张头像 / 标志 <img>，不算内容图`);
  }
  const hero = cells.find((x) => x.type === 'hero' && x.opts.image === 'left');
  check(hero && hero.identity > 0, `hero: proof 头像与 logos 渲染出 ${hero ? hero.identity : 0} 张 <img>，不算内容图`);
  // 反向对照：把 cta 的 image 在 background 档也算进来 ⟹ background 那一格必须红（cta background 不出 <img>）
  const bent = { ...S.IMG_SLOTS, cta: [{ slot: 'image', knob: 'image', on: ['left', 'right', 'background'] }] };
  const bentCells = imageCells(bent).filter((c) => c.type === 'cta' && c.opts.image === 'background');
  check(bentCells.length === 1 && !cellOk(bentCells[0]), '　反向对照：cta 的 image=background 也算内容图 ⟹ 对账红（它只是 CSS 背景）');
  // 反向对照：gallery 不跟组件的 alt 回退（条目标题）⟹ alt 对不上
  const bentG = { ...S.IMG_SLOTS, gallery: [{ slot: 'items', list: true, nested: 'image', maxFrom: 'items' }] };
  const g = fixture('gallery');
  g.items = g.items.map((it) => ({ ...it, image: { imageUrl: it.image.imageUrl }, title: 'T' }));
  const gReal = S.contentImagesOf({ slug: 'x', sections: [{ type: 'gallery', data: g }] }, manifests).map((x) => x.alt);
  const savedG = S.IMG_SLOTS.gallery; S.IMG_SLOTS.gallery = bentG.gallery;
  let gBent;
  try { gBent = S.contentImagesOf({ slug: 'x', sections: [{ type: 'gallery', data: g }] }, manifests).map((x) => x.alt); }
  finally { S.IMG_SLOTS.gallery = savedG; }
  check(gReal.every((x) => x === 'T') && gBent.every((x) => x === ''), 'gallery 没写 alt 时渲染出来的 alt 是条目标题，函数也认它；去掉回退那一格 alt 读成空（第 6 条按渲染出来的 alt 判）');
  console.log(`  📋 内容图槽：${Object.entries(S.IMG_SLOTS).map(([t, rs]) => rs.map((r) => `${t}.${r.slot}${r.list ? '[]' : ''}${r.on ? `(${r.knob}∈${r.on.join('/')})` : r.knob ? `(${r.knob}≠none)` : ''}`).join(' · ')).join(' · ')}`);
} catch (e) { bad(`⑥ 渲染抛了：${e.stack || e.message}`); }

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
