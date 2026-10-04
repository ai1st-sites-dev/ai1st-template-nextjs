// #1550 —— similarity.js：正文验收「相似度函数单测」那一条（英文三例 + 中文三例），外加页面正文怎么取。
'use strict';

const assert = require('assert');
const { similarity, shingles, tokens, pageText, mostSimilarPages } = require('./similarity');

let pass = 0;
let fail = 0;
function check(name, fn) {
  try { fn(); pass += 1; console.log(`  ✅ ${name}`); } catch (e) { fail += 1; console.log(`  ❌ ${name}\n     ${e.message}`); }
}

console.log('══ #1550 similarity ══');

const EN = (place) => `Looking for a reliable plumber in ${place}? Our licensed team handles burst pipes, clogged drains, `
  + 'leaking water heaters and full bathroom renovations for homes of every age. We arrive with a fully stocked van, '
  + 'explain the problem in plain words and give you a written price before any work begins. Older houses often hide '
  + `galvanized supply lines that corrode from the inside, so we inspect them on every visit in ${place} and tell you `
  + 'honestly whether a repair or a replacement makes more sense for your budget and your plans for the house.';
const EN_OTHER = 'Our bakery opens at dawn with sourdough loaves, croissants and seasonal fruit tarts baked in a stone oven. '
  + 'Order a custom birthday cake two days ahead, or stop by for an espresso and a cinnamon bun on your way to work.';

const ZH = (place) => `在${place}找靠谱的水管工吗？我们的团队处理爆管、下水道堵塞、热水器漏水和整套卫生间翻新，`
  + '老房新房都做。师傅开着备齐配件的车上门，用大白话讲清楚问题，开工前先给书面报价。很多老房子的镀锌供水管会从里面锈穿，'
  + `所以我们每次在${place}上门都会顺手检查，并且如实告诉您是修还是换更划算，按您的预算和对房子的打算来定。`;
const ZH_OTHER = '本店每天清晨开炉，出酸种面包、可颂和应季水果挞。生日蛋糕提前两天预订，路过也可以进来喝杯浓缩咖啡配一个肉桂卷。';

check('两段相同文本 → 1.0', () => assert.strictEqual(similarity(EN('Markham'), EN('Markham')), 1));
check('完全不同 → 0', () => assert.strictEqual(similarity(EN('Markham'), EN_OTHER), 0));
check('换地名的同一段 → ≥ 0.8', () => {
  const s = similarity(EN('Markham'), EN('North York'));
  assert.ok(s >= 0.8, `读到 ${s}`);
  assert.ok(s < 1, `换了地名却读 1.0 —— 尺子没看见差异（读到 ${s}）`);
});
check('中文：两段相同文本 → 1.0', () => assert.strictEqual(similarity(ZH('万锦'), ZH('万锦')), 1));
check('中文：完全不同 → 0', () => assert.strictEqual(similarity(ZH('万锦'), ZH_OTHER), 0));
check('中文：换地名的同一段 → ≥ 0.8', () => {
  const s = similarity(ZH('万锦'), ZH('多伦多'));
  assert.ok(s >= 0.8, `读到 ${s}`);
  assert.ok(s < 1, `读到 ${s}`);
});
check('阳性对照：中文若整句当一个词，相似度会恒为 0 —— 按单字切之后一段中文有几十个词', () => {
  assert.ok(tokens(ZH('万锦')).length > 50, `只切出 ${tokens(ZH('万锦')).length} 个词`);
  assert.ok(shingles(ZH('万锦')).size > 40);
});
check('混写：英文按词、中文按字', () => assert.deepStrictEqual(tokens('Toronto 水管工, 24/7!'), ['toronto', '水', '管', '工', '24', '7']));
check('任一边为空 → 0（不是 NaN）', () => {
  assert.strictEqual(similarity('', EN('x')), 0);
  assert.strictEqual(similarity('', ''), 0);
});
check('不足 5 个词的两段：一样就是 1，不一样就是 0', () => {
  assert.strictEqual(similarity('drain cleaning', 'Drain cleaning!'), 1);
  assert.strictEqual(similarity('drain cleaning', 'water heater'), 0);
});

check('pageText：收块里的字符串，跳过链接 / 图片 / 旋钮 / 引用', () => {
  const t = pageText({ slug: 'x', sections: [
    { type: 'page-header', data: { headline: 'H1 text', options: { image: 'left' }, image: { imageUrl: '/p.jpg', alt: 'a pipe' } } },
    { type: 'features', data: { headline: 'Why us', items: { source: 'pages', under: 'services/a' } } },
    { type: 'cta', data: { headline: 'Call', ctas: [{ label: 'Book', href: '/quote' }] } },
  ] });
  assert.deepStrictEqual(t.split('\n'), ['H1 text', 'a pipe', 'Why us', 'Call', 'Book']);
});
check('pageText：盘上的 blocks 形状也认', () => assert.strictEqual(pageText({ blocks: [{ type: 'content', data: { body: 'abc' } }] }), 'abc'));

check('mostSimilarPages：每个新页取最像的那一页，新页之间也互比', () => {
  const page = (slug, body) => ({ slug, sections: [{ type: 'content', data: { body } }] });
  const r = mostSimilarPages(
    [page('services/p/plumbing-markham', EN('Markham')), page('services/p/plumbing-north-york', EN('North York'))],
    [page('about', EN_OTHER), page('home', 'Welcome to the best plumbing company in town, call us today for a quote')],
  );
  assert.strictEqual(r.length, 2);
  assert.strictEqual(r[0].mostSimilar, 'services/p/plumbing-north-york');
  assert.strictEqual(r[1].mostSimilar, 'services/p/plumbing-markham');
  assert.ok(r[0].score >= 0.8 && r[0].score < 1, JSON.stringify(r[0]));
  assert.ok(Number.isInteger(r[0].score * 100), '两位小数');
});
check('mostSimilarPages：站上只有它一页 ⟹ mostSimilar 是 null、score 0', () => {
  assert.deepStrictEqual(mostSimilarPages([{ slug: 'a', sections: [] }], []), [{ slug: 'a', mostSimilar: null, score: 0 }]);
});

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
