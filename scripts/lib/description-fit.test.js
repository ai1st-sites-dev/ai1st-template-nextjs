#!/usr/bin/env node
/**
 * description-fit.test.js — 超长 description 由代码裁到上限（#1549 回修）。
 *
 * 跑法:  node scripts/lib/description-fit.test.js   （或 `npm run test:scripts`）
 * 退出码: 0 全过 · 1 有失败 · 2 跑不起来
 *
 * ① 不超长原样回（只收空白）
 * ② 超长、上限内有句末标点且截完 ≥ 70 ⟹ 在句末截（不腰斩句子）
 * ③ 超长、句末截会 < 70 ⟹ 退到词边界截，结尾不留逗号
 * ④ 无空格的中文长句 ⟹ 在顿号 / 逗号处截，再不行硬裁到上限 —— #1549 重开起主语言 zh 的上限是 80（不是 155）
 * ⑤ fitPageDescriptions：首页改 seo.siteDescription、子页改 page.description、不超长的页不在回执里
 * ⑥ 反向对照：裁完的长度一定 ≤ 155，拿 site-d84be95f 当天那 6 个长度（157/159/161/162/164/166/168）的真形状各喂一遍
 * ⑦ （#1549 重开 r3）区间只按主语言取：同一段文字（中文 / 英文 / 混排）在 zh 站和 en 站上各得各的区间、跟文字本身无关；
 *    提示词的说法与检查的区间是同一个数（r2 两者分叉过：检查按文字判、提示词按主语言给）
 * ⑧ （#1549 重开）appendPlace：末尾补地点、补完超上限先裁正文、地点永远不被裁掉；补完不会换档（r3，QA1 那个 50 字例）
 * ⑨ （#1603）补地点不许裁掉句末的目标词：正文长度扫遍整个区间（zh 50–80 · en 70–155），每档都以目标词结尾、缺地点，
 *    补完每一档都仍含目标词（判定 = 第 2 条同一个 hasPhrase）、长度仍在区间里、地点在末尾。
 *    同一把尺在 b902d5ca（改前）上读红 zh 4 档（77–80）· en 10 档（146–155）—— 读 0 说明夹具没对准，不是修好了。
 * ⑩ （#1603）placeFits：「目标词 + 分隔符 + 地点」超上限（90 字无逗号地址）⟹ false；边界恰好等于上限 ⟹ true
 */

'use strict';

const DF = require('./description-fit');
const { fitDescription, fitPageDescriptions, appendPlace, descriptionRange, descriptionSpec } = DF;
const ZH = { locale: 'zh' };

let pass = 0;
let fail = 0;
const cp = (s) => [...s].length;
function check(name, cond, detail) {
  if (cond) { pass += 1; console.log(`  ✓ ${name}`); } else { fail += 1; console.log(`  ✗ ${name}${detail ? ` —— ${detail}` : ''}`); }
}

const word = (n) => Array.from({ length: n }, (_, i) => `w${i}`).join(' ');

// ①
{
  const s = '  Family-run   salon in Toronto. ';
  check('① 不超长原样回（只收空白）', fitDescription(s) === 'Family-run salon in Toronto.');
}
// ②
{
  const a = 'Toronto haircut salon with experienced stylists trained in Korea offering affordable prices.'; // 93
  const b = ' Walk in or book online today for the best cut in the city and beyond everyone.'; // 共 ~172
  const s = a + b;
  const out = fitDescription(s);
  check('② 句末截断', out === a, `got ${JSON.stringify(out)}`);
  check('② 截完 ≤ 155 且 ≥ 70', cp(out) <= 155 && cp(out) >= 70, String(cp(out)));
}
// ③
{
  const s = `Short. ${word(60)}`; // 句末在第 6 字，截完 < 70 ⟹ 退到词边界
  const out = fitDescription(s);
  check('③ 退到词边界', cp(out) <= 155 && cp(out) >= 70 && !out.endsWith(' ') && !/,$/.test(out) && out.startsWith('Short. w0'), `${cp(out)} ${JSON.stringify(out.slice(-12))}`);
  const s2 = `${'a'.repeat(100)}, ${'b'.repeat(100)}`;
  const out2 = fitDescription(s2);
  check('③ 结尾不留逗号', out2 === 'a'.repeat(100), JSON.stringify(out2.slice(-5)));
}
// ④
{
  const s = `${'多'.repeat(100)}、${'伦'.repeat(100)}`; // 无空格，顿号在第 101 位
  const out = fitDescription(s, ZH);
  check('④ 中文：上限内没有断点 ⟹ 硬裁到 80', out === '多'.repeat(80), String(cp(out)));
  const s2 = `${'多'.repeat(60)}、${'伦'.repeat(100)}`; // 顿号在第 61 位
  check('④ 中文在顿号处截', fitDescription(s2, ZH) === '多'.repeat(60), String(cp(fitDescription(s2, ZH))));
  const hard = '哈'.repeat(300);
  check('④ 无断点硬裁到 80（主语言 zh）', cp(fitDescription(hard, ZH)) === 80, String(cp(fitDescription(hard, ZH))));
  check('④ 同一段中文、主语言 en ⟹ 裁到 155（区间跟着主语言，不跟着文字）', cp(fitDescription(hard)) === 155 && cp(fitDescription(hard, { locale: 'en' })) === 155);
  check('④ 显式传上限时照传的', cp(fitDescription(hard, { locale: 'zh', max: 120, min: 70 })) === 120);
}
// ⑤
{
  // #1549 r4：只裁超过底线上限（300）的，裁到目标上限（155）—— 夹具都要 > 300
  const seo = { siteDescription: `Home. ${word(80)}` };
  const pages = [
    { slug: 'home', description: 'ignored for home' },
    { slug: 'about', description: 'Fine and short enough to keep as is for the about page of the site here.' },
    { slug: 'services/haircut', description: `Cut. ${word(80)}` },
    { slug: 'gallery', description: `Mid. ${word(50)}` }, // 155 < 长度 ≤ 300：底线内，不裁
    { slug: 'faq' }, // 没有 description
  ];
  const changed = fitPageDescriptions({ pages, seo });
  check('⑤ 首页改的是 seo.siteDescription', cp(seo.siteDescription) <= 155 && pages[0].description === 'ignored for home');
  check('⑤ 子页改 page.description', cp(pages[2].description) <= 155);
  check('⑤ 回执只有裁过的两页', changed.map((c) => c.slug).join(',') === 'home,services/haircut', JSON.stringify(changed));
  check('⑤ 回执带前后长度', changed.every((c) => c.before > 300 && c.after <= 155));
  check(`⑤ 155–300 之间的不裁（${cp(pages[3].description)} 字）`, cp(pages[3].description) > 155 && cp(pages[3].description) <= 300 && !changed.some((c) => c.slug === 'gallery'));
}
// ⑥ 当天真形状：三到四句英文、长度 157–168，裁完必 ≤ 155 且 ≥ 70
{
  const base = 'Silky Hair Salon offers expert haircuts, coloring and perming in Toronto. Korean-trained stylists, affordable prices, next to T&T Supermarket.';
  for (const n of [157, 159, 161, 162, 164, 166, 168]) {
    const s = (base + ' Book your appointment online today and enjoy a fresh new look this season.').slice(0, n);
    const out = fitDescription(s);
    check(`⑥ ${n} 字 → ${cp(out)} 字（≤155 ≥70，句末或词边界）`, cp(out) <= 155 && cp(out) >= 70 && !/[ ,]$/.test(out), JSON.stringify(out.slice(-20)));
  }
}

// ⑦ 区间只按主语言
{
  const zh = '多伦多专业烫发染发沙龙，韩国发型师当天预约，价格实惠，欢迎到店体验。';
  const en = 'Expert perms and coloring in Toronto with Korean-trained stylists.';
  const mixZh = 'Glamour Hair 位于多伦多市中心，韩国发型师提供烫发、染发、护理，当天可约。';
  // QA2 2026-10-05 照 Chris 那两个中文真站造的形状：中文站、英文品牌 + 英文目标词，字母里拉丁过半
  const mixEn = 'Acme Drains 在 Markham 提供 drain cleaning 疏通服务，厨房浴室主管道，持牌技师当天上门。';
  for (const [name, text] of [['中文', zh], ['英文', en], ['混排·中文为主', mixZh], ['混排·拉丁字母过半', mixEn]]) {
    check(`⑦ ${name}：descriptionRange 只收 locale —— 主语言 zh ⟹ 50–80、en ⟹ 70–155（文字本身不参与）`,
      JSON.stringify(descriptionRange('zh')) === '{"min":50,"max":80}' && JSON.stringify(descriptionRange('en')) === '{"min":70,"max":155}'
      && fitPageDescriptions({ pages: [{ slug: 'x', description: text }], seo: {}, locale: 'zh' }).length === 0, text);
  }
  check('⑦ zh / zh-TW / ja / ko ⟹ 50–80；en / fr / 空 / 没传 ⟹ 70–155',
    ['zh', 'zh-TW', 'ja', 'ko'].every((l) => descriptionRange(l).max === 80) && ['en', 'fr', '', undefined].every((l) => descriptionRange(l).max === 155));
  // #1549 r4：提示词说的是目标区间（descriptionRange），单位按语言说；检查用的是底线区间（descriptionAccept），两者不再相同
  check('⑦ 提示词说法 = 目标区间，单位按语言',
    descriptionSpec('zh') === '50–80 个汉字 (Chinese characters)' && descriptionSpec('zh-TW').startsWith('50–80 个汉字')
    && descriptionSpec('ja').startsWith('50–80 文字') && descriptionSpec('ko').startsWith('50–80자')
    && ['en', 'fr', '', undefined].every((l) => descriptionSpec(l) === '70–155 characters'));
  check('⑦ 文字判档的旧导出不在了（只留一个取区间的入口）', DF.isMostlyCjk === undefined && DF.descriptionRangeForLocale === undefined && DF.DESCRIPTION_RANGES === undefined);
  // 中文超 80 由代码裁（改前这一句 ≤155 不裁）
  const long = '多伦多专业烫发染发沙龙，韩国发型师当天预约。价格实惠，欢迎到店体验！我们提供烫发、染发、头皮护理和造型设计，所有服务都由经验丰富的发型师完成，环境舒适安静，停车方便，周末也营业。';
  check(`⑦ 夹具本身超 80（${cp(long)} 字）`, cp(long) > 80);
  const out = fitDescription(long, ZH);
  // 上限内最后一个句末（「！」在第 33 字）截完 < 50 ⟹ 退到逗号处
  check(`⑦ 中文 ${cp(long)} 字 ⟹ 裁到 ≤80 且 ≥50，结尾不留逗号`, cp(out) <= 80 && cp(out) >= 50 && !/[，、]$/.test(out), `${cp(out)} ${out}`);
  // #1549 r4：89 字在底线（≤200）内 ⟹ 不裁；超过 200 才裁到 80
  check('⑦ fitPageDescriptions 主语言 zh：89 字在底线内，不裁',
    fitPageDescriptions({ pages: [{ slug: 'services/perm', description: long }], seo: {}, locale: 'zh' }).length === 0);
  const veryLong = long + long + long;
  check(`⑦ 夹具超底线上限（${cp(veryLong)} 字 > 200）`, cp(veryLong) > 200);
  const ch = fitPageDescriptions({ pages: [{ slug: 'services/perm', description: veryLong }], seo: {}, locale: 'zh' });
  check('⑦ fitPageDescriptions 主语言 zh 超 200 ⟹ 裁到 ≤80', ch.length === 1 && ch[0].after <= 80 && ch[0].after >= 50, JSON.stringify(ch));
  check('⑦ 对照：同一段、主语言 en 不裁（≤155）', fitPageDescriptions({ pages: [{ slug: 'services/perm', description: long }], seo: {}, locale: 'en' }).length === 0);
}
// ⑧ appendPlace —— #1549 r4：补地点按底线区间（中日韩 ≤200 / 其余 ≤300，PM 2026-10-06 裁），夹具按那个上限造
{
  check('⑧ 中文：去句末标点、用「｜」接', appendPlace('专业烫发服务，韩国发型师当天可约。', '多伦多', 'zh') === '专业烫发服务，韩国发型师当天可约｜多伦多');
  check('⑧ 英文：用「 | 」接', appendPlace('Expert perms with Korean-trained stylists.', 'Toronto', 'en') === 'Expert perms with Korean-trained stylists | Toronto');
  const zhLong = '专业烫发服务，韩国发型师当天可约，价格实惠，环境安静舒适，欢迎到店体验我们的烫发染发护理和造型设计服务，停车方便，周末也营业，节假日照常开门，期待您的光临。'.repeat(3);
  check(`⑧ 夹具：正文 ${cp(zhLong)} 字 + 「｜多伦多」4 字 > 200`, cp(zhLong) - 1 + 4 > 200);
  const z = appendPlace(zhLong, '多伦多', 'zh');
  check(`⑧ 中文补完超 200 ⟹ 先裁正文，地点留在末尾（${cp(z)} 字）`, cp(z) <= 200 && z.endsWith('｜多伦多'), `${cp(zhLong)}→${cp(z)} ${z}`);
  const zhMid = '专业烫发服务，韩国发型师当天可约，价格实惠，环境安静舒适，欢迎到店体验我们的烫发染发护理和造型设计服务，停车方便。';
  check(`⑧ 中文 ${cp(zhMid)} 字（超目标 80、在底线 200 内）补完不裁正文`, appendPlace(zhMid, '多伦多', 'zh') === `${zhMid.replace(/。$/, '')}｜多伦多`);
  const zh198 = '专'.repeat(198);
  const z2 = appendPlace(zh198, '多伦多', 'zh');
  check(`⑧ 中文 198 字无断点 ⟹ 硬裁正文到 196，补完恰好 200`, cp(z2) === 200 && z2.endsWith('｜多伦多'), `${cp(z2)}`);
  const enLong = `${'Expert perms and coloring with Korean-trained stylists, '.repeat(6)}book today.`; // >300
  const e = appendPlace(enLong, 'Toronto', 'en');
  check(`⑧ 英文超 300 ⟹ ≤300、末尾是「 | Toronto」（${cp(e)} 字）`, cp(e) <= 300 && e.endsWith(' | Toronto') && !/[,\s]\s\|/.test(e.replace(' | Toronto', ' |')), e);
  check('⑧ 地点为空 ⟹ 原样', appendPlace('Hello there.', '') === 'Hello there.');
  check('⑧ 正文为空 ⟹ 只有地点', appendPlace('', '多伦多', 'zh') === '多伦多');
  check('⑧ 主语言 zh、正文是英文 ⟹ 仍用「｜」（分隔符和区间都跟着主语言）', appendPlace('Fast drain cleaning.', 'Markham', 'zh') === 'Fast drain cleaning｜Markham');
  // QA1 2026-10-05：r2 下这段 50 字（CJK 档）补完 58 字翻成 latin 档、报「要 70–155」。区间只看主语言 ⟹ 补完不会换档
  const q1 = '我们为多伦多及周边社区提供专业下水道疏通与管道维修 Fast reliable drain clea';
  const q1o = appendPlace(q1, 'Toronto', 'zh');
  check(`⑧ QA1 那例：${cp(q1)} 字补完 ${cp(q1o)} 字，仍在 50–80`, cp(q1) === 50 && cp(q1o) >= 50 && cp(q1o) <= 80, q1o);
}

// ⑨ 补地点不裁目标词
{
  const { hasPhrase } = require('./seo-problems');
  // 正文 n 字、以目标词结尾、不含地点。英文在目标词前留一个空格（不然目标词跟前一个词粘成一个词，夹具自己就不含它）。
  const body = (n, kw, filler) => {
    const sp = /^[\x00-\x7f]/.test(kw) ? ' ' : '';
    const f = [];
    while (f.length < n - cp(kw) - sp.length) f.push(...filler);
    f.length = n - cp(kw) - sp.length;
    if (f[f.length - 1] === ' ') f[f.length - 1] = 'a';
    return f.join('') + sp + kw;
  };
  for (const [name, locale, kw, place, filler] of [
    ['zh', 'zh', '烫发设计', '多伦多', '我们的发型师团队经验丰富，用心为每位顾客打造适合自己的'],
    ['en', 'en', 'hair salon', 'Toronto', 'Our experienced stylists craft looks that fit you, with care and attention at every visit to our '],
  ]) {
    const { min, max } = DF.descriptionAccept(locale);
    const lost = []; const off = []; let fixtureBad = 0;
    for (let n = min; n <= max; n++) {
      const t = body(n, kw, filler);
      if (cp(t) !== n || !hasPhrase(t, kw) || hasPhrase(t, place)) fixtureBad += 1;
      const out = appendPlace(t, place, locale, { keep: (x) => hasPhrase(x, kw) });
      if (!hasPhrase(out, kw)) lost.push(n);
      if (cp(out) < min || cp(out) > max || !out.endsWith(place)) off.push(`${n}→${cp(out)}`);
    }
    check(`⑨ ${name} 夹具：${min}–${max} 每档长度对、以「${kw}」结尾、不含地点`, fixtureBad === 0, String(fixtureBad));
    check(`⑨ ${name}：补完每一档都仍含目标词（丢掉的档：${lost.length ? lost.join('/') : '无'}）`, lost.length === 0);
    check(`⑨ ${name}：补完每一档都在 ${min}–${max}、地点在末尾`, off.length === 0, off.join(' '));
  }
  // 补出来长什么样：裁的是目标词前面那段，用逗号接回去
  const z = appendPlace(body(199, '烫发设计', '我们的发型师团队经验丰富，用心为每位顾客打造适合自己的'), '多伦多', 'zh', { keep: (x) => hasPhrase(x, '烫发设计') });
  check(`⑨ zh 199 字那档：${cp(z)} 字，结尾「，烫发设计｜多伦多」`, z.endsWith('，烫发设计｜多伦多') && cp(z) <= 200, z);
  // 目标词在句中、尾部裁不碰它 ⟹ 跟没传 keep 时一模一样（只在会丢词时才换裁法）
  const mid = '烫发设计' + '我们的发型师团队经验丰富，用心为每位顾客打造适合自己的造型'.repeat(8);
  check('⑨ 目标词在句首 ⟹ 跟不传 keep 时逐字相同', appendPlace(mid.slice(0, 199), '多伦多', 'zh', { keep: (x) => hasPhrase(x, '烫发设计') }) === appendPlace(mid.slice(0, 199), '多伦多', 'zh'));
}
// ⑩ placeFits —— #1549 r4：上限是底线上限（中日韩 200 / 其余 300），跟检查同一把尺
{
  const { placeFits } = DF;
  const addr = '多'.repeat(210); // QA3 在 #1549 量的那个角（当时 90 字、上限 80），按新上限放大
  check('⑩ 210 字无逗号地址 ⟹ 塞不进 200', placeFits(addr, '烫发', 'zh') === false);
  check('⑩ 90 字无逗号地址 ⟹ 现在塞得进（≤200）', placeFits('多'.repeat(90), '烫发', 'zh') === true);
  check('⑩ 「烫发」+「｜多伦多」⟹ 塞得进', placeFits('多伦多', '烫发', 'zh') === true);
  check('⑩ 边界：目标词 + 「｜」+ 地点恰好 200 ⟹ true，201 ⟹ false',
    placeFits('多'.repeat(100), '发'.repeat(99), 'zh') === true && placeFits('多'.repeat(100), '发'.repeat(100), 'zh') === false);
  check('⑩ 英文按 300、分隔符「 | 」3 字', placeFits('T'.repeat(200), 'k'.repeat(97), 'en') === true && placeFits('T'.repeat(200), 'k'.repeat(98), 'en') === false);
  check('⑩ 没有地点 ⟹ true', placeFits('', '烫发', 'zh') === true);
}

console.log(`\n${pass} 过 · ${fail} 败`);
process.exit(fail ? 1 : 0);
