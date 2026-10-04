// #1550 —— keyword-slug.js：转写而不是删除；表里没有的文字退 kw-<序号>；站内重复加 -2 / -3。
'use strict';

const assert = require('assert');
const { keywordSlug, assignKeywordSlugs, transliterate } = require('./keyword-slug');

let pass = 0;
let fail = 0;
function check(name, fn) {
  try { fn(); pass += 1; console.log(`  ✅ ${name}`); } catch (e) { fail += 1; console.log(`  ❌ ${name}\n     ${e.message}`); }
}

console.log('══ #1550 keyword-slug ══');

// 正文验收「slug 单测」那一条，逐个照抄。
check('剪头发 Markham → jian-tou-fa-markham', () => assert.strictEqual(keywordSlug('剪头发 Markham'), 'jian-tou-fa-markham'));
check('Москва → moskva', () => assert.strictEqual(keywordSlug('Москва'), 'moskva'));
check('Café Déjà Vu → cafe-deja-vu', () => assert.strictEqual(keywordSlug('Café Déjà Vu'), 'cafe-deja-vu'));
check('Çırağan Sarayı → ciragan-sarayi', () => assert.strictEqual(keywordSlug('Çırağan Sarayı'), 'ciragan-sarayi'));
check('同站两个词转出同一个 slug → 第二个带 -2', () => {
  const r = assignKeywordSlugs(['Café Paris', 'cafe paris', 'CAFÉ  PARIS!']);
  assert.deepStrictEqual(r.map((x) => x.slug), ['cafe-paris', 'cafe-paris-2', 'cafe-paris-3']);
});
check('日文假名词 → kw-<序号>，并标 fallback', () => {
  const r = assignKeywordSlugs(['plumber toronto', 'すいどう しゅうり', 'drain']);
  assert.deepStrictEqual(r[1], { keyword: 'すいどう しゅうり', slug: 'kw-2', fallback: true });
  assert.strictEqual(r[0].fallback, false);
  assert.strictEqual(r[2].slug, 'drain');
});

// 以前的写法（`replace(/[^a-z0-9]+/g,'-')`）会删掉的几类，逐类一格。
check('法语 déboucheur → deboucheur（以前是 d-boucheur）', () => assert.strictEqual(keywordSlug('déboucheur'), 'deboucheur'));
check('NFKD 分解不了的字母：ß ø æ ł → ss o ae l', () => assert.strictEqual(keywordSlug('Straße Øre Æble Łódź'), 'strasse-ore-aeble-lodz'));
check('土耳其语 İstanbul → istanbul（大写 İ 不被拆成两段）', () => assert.strictEqual(keywordSlug('İstanbul'), 'istanbul'));
check('希腊字母（含重音）：Αθήνα → athina', () => assert.strictEqual(keywordSlug('Αθήνα'), 'athina'));
// 📌 表不分语言：и 按俄语写 i（乌克兰语该是 y），所以这里用乌克兰语特有的 і / є / ї 来验。
check('乌克兰特有字母：Львів Європа Їжак → lviv-yevropa-yizhak', () => assert.strictEqual(keywordSlug('Львів Європа Їжак'), 'lviv-yevropa-yizhak'));
check('繁体汉字也在表里：東京 → dong-jing', () => assert.strictEqual(keywordSlug('東京'), 'dong-jing'));
check('全角字母数字：ＡＢＣ１２３ → abc123', () => assert.strictEqual(keywordSlug('ＡＢＣ１２３'), 'abc123'));
check('标点、多个空格只当一个分隔，首尾不留连字符', () => assert.strictEqual(keywordSlug('  24/7 plumber -- near me! '), '24-7-plumber-near-me'));
check('韩文 → null（表里没有，不删字）', () => assert.strictEqual(keywordSlug('서울 배관'), null));
check('阿拉伯文 → null', () => assert.strictEqual(keywordSlug('سباك دبي'), null));
check('半中半韩 → null（有一个字转不了就整个不要，不留半截）', () => assert.strictEqual(keywordSlug('首尔 배관'), null));
check('只有标点 → null（空 slug 不算一个 slug）', () => assert.strictEqual(keywordSlug('!!!'), null));
check('transliterate 转不了时回 null，不是空串', () => assert.strictEqual(transliterate('ソウル'), null));
check('kw-<序号> 跟真 slug 撞了也去重', () => {
  const r = assignKeywordSlugs(['kw 1', 'ソウル']);
  assert.deepStrictEqual(r.map((x) => x.slug), ['kw-1', 'kw-2']);
  const r2 = assignKeywordSlugs(['ソウル', 'kw 1']);
  assert.deepStrictEqual(r2.map((x) => x.slug), ['kw-1', 'kw-1-2']);
});

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
