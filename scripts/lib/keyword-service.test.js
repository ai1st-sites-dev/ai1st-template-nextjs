#!/usr/bin/env node
/**
 * keyword-service.test.js — #1551 做什么 2：关键词页的 Service 算什么（`scripts/lib/keyword-service.js`）。
 *
 * 🔴 页面夹具的形状照 T4 #1548 正文做什么 3 那一行手写：`pages/<slug>.json` 加 `seo.targetKeyword`
 *    （不是 `page.targetKeyword`）。照合同写，字段名两边不一致时这里当场红。
 *
 * 跑法:  node scripts/lib/keyword-service.test.js   （或 `npm run test:scripts`，它按文件名发现）
 * 退出码: 0 全过 · 1 有失败 · 2 跑不起来（不许当成通过）
 */
'use strict';

let pass = 0;
let fail = 0;
const check = (cond, m) => { if (cond) { pass += 1; console.log(`  ✅ ${m}`); } else { fail += 1; console.log(`  ❌ ${m}`); } };

let K;
try { K = require('./keyword-service'); } catch (e) { console.error(`🔴 跑不起来: ${e.message}`); process.exit(2); }

const seo = { schema: {
  areaServed: [{ type: 'City', name: 'Toronto, ON' }, { type: 'City', name: 'North York' }, { type: 'City', name: 'York' }],
  addresses: [{ locality: 'Toronto', region: 'ON', country: 'CA' }],
} };
const brand = { locations: [{ city: 'Toronto' }] };
const site = { seo, brand };
// T4 #1548 的形状：关键词页 = 它的词，写在 seo.targetKeyword。
const kwPage = (slug, targetKeyword, extra = {}) => ({ slug, keywordPage: true, seo: { targetKeyword }, ...extra });
const names = (svc) => JSON.stringify(svc.areaServed.map((a) => a.name));

console.log('══ #1551 keyword-service ══');

console.log('\n── name = 目标词原文，只把第一个字母大写');
const s1 = K.keywordServiceFor(kwPage('drain-cleaning/emergency-drain-cleaning-north-york', 'emergency drain cleaning north york'), site);
check(s1 && s1.name === 'Emergency drain cleaning north york', `「emergency drain cleaning north york」⟹ ${s1 && s1.name}（不做 Title Case）`);
check(K.capitalizeFirst('24/7 plumber toronto') === '24/7 Plumber toronto', `前面是数字 ⟹ 第一个字母大写：${K.capitalizeFirst('24/7 plumber toronto')}`);
check(K.capitalizeFirst('多伦多水管工') === '多伦多水管工', '没有大小写的文字 ⟹ 原样');
check(K.capitalizeFirst('émergence plombier') === 'Émergence plombier', '带重音的首字母也大写');
check(K.capitalizeFirst('Plumber in TORONTO') === 'Plumber in TORONTO', '已经大写的 / 其余字母一个字不动');

console.log('\n── areaServed = 词里的地名；没有就是站的地区');
check(s1 && names(s1) === '["North York"]' && s1.placeFromKeyword, `词里有 North York ⟹ ${s1 && names(s1)}（North York 胜过 York：取最长）`);
const s2 = K.keywordServiceFor(kwPage('x/plumber-toronto', 'plumber toronto'), site);
check(s2 && names(s2) === '["Toronto, ON"]', `「plumber toronto」⟹ 站点数据里那一项原样 ${s2 && names(s2)}（按逗号前那一截认）`);
const s3 = K.keywordServiceFor(kwPage('x/tankless', 'tankless water heater repair'), site);
check(s3 && names(s3) === '["Toronto, ON","North York","York"]' && !s3.placeFromKeyword, `词里没有地名 ⟹ 站的地区 ${s3 && names(s3)}`);
const s4 = K.keywordServiceFor(kwPage('x/yorkville', 'yorkville plumber'), site);
check(s4 && !s4.placeFromKeyword, '「yorkville」不按子串认成 York（拉丁字母按整词）');
const s5 = K.keywordServiceFor(kwPage('x/markham', 'plumber markham'), site);
check(s5 && !s5.placeFromKeyword && names(s5) === names(s3), '站点数据里没写的城市（Markham）⟹ 当作没有地名，退回站的地区');
const zh = { seo: { schema: { areaServed: [{ type: 'City', name: '多伦多' }], addresses: [] } }, brand: {} };
const s6 = K.keywordServiceFor(kwPage('x/zh', '多伦多水管工'), zh);
check(s6 && names(s6) === '["多伦多"]' && s6.placeFromKeyword, `中文词「多伦多水管工」⟹ ${s6 && names(s6)}（中日韩按子串认）`);
const s7 = K.keywordServiceFor(kwPage('x/city', 'toronto plumber'), { seo: { schema: { areaServed: [], addresses: [] } }, brand });
check(s7 && names(s7) === '["Toronto"]', `地名只写在 brand.locations 的 city 里也认：${s7 && names(s7)}`);
const s8 = K.keywordServiceFor(kwPage('x/none', 'plumber'), { seo: { schema: { areaServed: [], addresses: [] } }, brand: {} });
check(s8 && s8.areaServed.length === 0, '站点数据一个地名都没有 ⟹ areaServed 是空的（组件那一侧整项不出）');

console.log('\n── 只有带目标词的关键词页才出');
check(K.keywordServiceFor({ slug: 'drain-cleaning/old', keywordPage: true }, site) === null, '关键词页没有 seo.targetKeyword（T4 落地前的样子）⟹ null');
check(K.keywordServiceFor({ slug: 'drain-cleaning/old', keywordPage: true, seo: { targetKeyword: '  ' } }, site) === null, '目标词是空白 ⟹ null');
check(K.keywordServiceFor({ slug: 'drain-cleaning/x', keywordPage: true, targetKeyword: 'plumber toronto' }, site) === null,
  '目标词写在 page.targetKeyword（不是合同里的 seo.targetKeyword）⟹ 不认');
check(K.keywordServiceFor({ slug: 'home', seo: { targetKeyword: 'plumber toronto' } }, site) === null, '首页有目标词 ⟹ 不出（首页不是关键词页）');
check(K.keywordServiceFor({ slug: 'services/drain-cleaning', serviceDetailPage: true, seo: { targetKeyword: 'drain cleaning' } }, site) === null,
  '服务详情页有目标词 ⟹ 不出（它有自己那份 Service）');
check(K.keywordServiceFor({ slug: 'about', seo: { targetKeyword: 'x' } }, site) === null, '普通页（不在子目录、没打 keywordPage）⟹ 不出');
check(K.keywordServiceFor({ slug: 'drain-cleaning/plumber-toronto', seo: { targetKeyword: 'plumber toronto' } }, site) !== null,
  '嵌在子目录里、没打 keywordPage 的页 ⟹ 也算关键词页（跟导航 / sitemap 同一个判断）');

console.log('\n── isKeywordPage 就是 sync-config 原来那一行（逐字搬过来的）');
const legacy = (p) => (p.keywordPage === true || p.slug.includes('/')) && !require('./service-detail-page').isServiceDetailPage(p);
const samples = [{ slug: 'about' }, { slug: 'a/b' }, { slug: 'services/x' }, { slug: 'services' }, { slug: 'q', keywordPage: true },
  { slug: 'services/x/y', keywordPage: true }, { slug: 'a/b', serviceDetailPage: true }];
check(samples.every((p) => K.isKeywordPage(p) === legacy(p)), `${samples.length} 种 slug 形状两边答案相同`);

console.log(`\n══ ${pass} 过 · ${fail} 失败 ══`);
process.exit(fail ? 1 : 0);
