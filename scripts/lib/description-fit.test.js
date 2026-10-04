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
 * ④ 无空格的中文长句 ⟹ 在顿号 / 逗号处截，再不行硬裁到上限
 * ⑤ fitPageDescriptions：首页改 seo.siteDescription、子页改 page.description、不超长的页不在回执里
 * ⑥ 反向对照：裁完的长度一定 ≤ 155，拿 site-d84be95f 当天那 6 个长度（157/159/161/162/164/166/168）的真形状各喂一遍
 */

'use strict';

const { fitDescription, fitPageDescriptions } = require('./description-fit');

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
  const out = fitDescription(s);
  check('④ 中文在顿号处截', out === '多'.repeat(100), String(cp(out)));
  const hard = '哈'.repeat(300);
  check('④ 无断点硬裁到 155', cp(fitDescription(hard)) === 155);
}
// ⑤
{
  const seo = { siteDescription: `Home. ${word(60)}` };
  const pages = [
    { slug: 'home', description: 'ignored for home' },
    { slug: 'about', description: 'Fine and short enough to keep as is for the about page of the site here.' },
    { slug: 'services/haircut', description: `Cut. ${word(60)}` },
    { slug: 'faq' }, // 没有 description
  ];
  const changed = fitPageDescriptions({ pages, seo });
  check('⑤ 首页改的是 seo.siteDescription', cp(seo.siteDescription) <= 155 && pages[0].description === 'ignored for home');
  check('⑤ 子页改 page.description', cp(pages[2].description) <= 155);
  check('⑤ 回执只有裁过的两页', changed.map((c) => c.slug).join(',') === 'home,services/haircut', JSON.stringify(changed));
  check('⑤ 回执带前后长度', changed.every((c) => c.before > 155 && c.after <= 155));
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

console.log(`\n${pass} 过 · ${fail} 败`);
process.exit(fail ? 1 : 0);
