// #1550 —— keyword-slug.js：转写而不是删除；表里没有的文字退 kw-<序号>；站内重复加 -2 / -3。
'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { keywordSlug, assignKeywordSlugs, transliterate, SLUG_MAX_BYTES, PAGE_FILE_SUFFIXES } = require('./keyword-slug');

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

// ── #1563 长度上限 ──────────────────────────────────────────────────────────────────────────────────
console.log('── #1563 长度上限');
const HAN63 = '剪头发'.repeat(21);
const LATIN251 = 'drain cleaning '.repeat(17).slice(0, 251);
const bytes = (x) => Buffer.byteLength(x);
check('AC1b：63 个汉字 / 251 个拉丁字符 → slug 不超过上限，而且是在词边界截的（不留半个拼音）', () => {
  const zh = keywordSlug(HAN63);
  assert.ok(bytes(zh) <= SLUG_MAX_BYTES, `${bytes(zh)}`);
  assert.ok('jian-tou-fa-'.repeat(21).startsWith(`${zh}-`), zh.slice(-20));
  const la = keywordSlug(LATIN251);
  assert.ok(bytes(la) <= SLUG_MAX_BYTES, `${bytes(la)}`);
  assert.match(la, /(^|-)(drain|cleaning)$/);
});
check('短词一个字节都不变（上限只碰超长的）', () => {
  assert.strictEqual(keywordSlug('emergency plumber near me toronto ontario'), 'emergency-plumber-near-me-toronto-ontario');
});
check('整段只有一个超长的词 ⟹ 硬截到上限', () => assert.strictEqual(keywordSlug('a'.repeat(1000)), 'a'.repeat(SLUG_MAX_BYTES)));
check('AC2：两个只在第 300 个字符之后才不同的词 ⟹ 两个 slug 不同，且都不超过上限（含 -2 那个）', () => {
  const stem = 'drain cleaning '.repeat(20);
  assert.ok(stem.length >= 300);
  const r = assignKeywordSlugs([`${stem}markham`, `${stem}toronto`]);
  assert.notStrictEqual(r[0].slug, r[1].slug);
  assert.match(r[1].slug, /-2$/);
  for (const x of r) assert.ok(bytes(x.slug) <= SLUG_MAX_BYTES, `${x.slug.length}`);
});
check('AC2：一个只有一个超长词的 stem 撞到第 12 个 ⟹ -12 也收在上限里', () => {
  const r = assignKeywordSlugs(Array.from({ length: 12 }, (_, i) => `${'b'.repeat(400)} ${i}`));
  assert.strictEqual(new Set(r.map((x) => x.slug)).size, 12);
  for (const x of r) assert.ok(bytes(x.slug) <= SLUG_MAX_BYTES, `${x.slug.length}`);
  assert.strictEqual(r[11].slug, `${'b'.repeat(SLUG_MAX_BYTES - 3)}-12`);
});
check('AC3：本票能生成的最长 slug 真写一次盘 —— <slug>.json / .html / .txt / .rsc / .meta 和 <slug>/、<slug>.segments/ 目录都不抛', () => {
  const inputs = ['x'.repeat(2000), HAN63.repeat(3), LATIN251.repeat(3), ...Array.from({ length: 12 }, () => 'y'.repeat(600))];
  const longest = assignKeywordSlugs(inputs).map((x) => x.slug).sort((a, b) => bytes(b) - bytes(a))[0];
  assert.strictEqual(bytes(longest), SLUG_MAX_BYTES, '阳性对照：最长那个确实顶到上限');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kw-slug-1563-'));
  try {
    // 一页按页名落盘的全部形态（真建过的站上现读，见 keyword-slug.js 文件头）：文件 5 种、目录 2 种。
    for (const suffix of ['.json', '.html', '.txt', '.rsc', '.meta']) fs.writeFileSync(path.join(dir, `${longest}${suffix}`), '{}');
    fs.mkdirSync(path.join(dir, longest));
    fs.mkdirSync(path.join(dir, `${longest}.segments`));
    // 对照：多 1 个字节就写不下 —— 证明这把尺子量得到上限，而不是这个文件系统允许任意长。
    //    最紧的是最长那种后缀（`.segments` 目录）：再多 1 个字节就建不出来。
    assert.throws(() => fs.mkdirSync(path.join(dir, `${longest}x.segments`)), /ENAMETOOLONG/);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
check('next build 按页名取名的那三种后缀（从 Next 自己的常量现取）都在清单里 —— 升级 Next 后它们变了就红', () => {
  const c = require('next/dist/lib/constants');
  for (const k of ['RSC_SUFFIX', 'NEXT_META_SUFFIX', 'RSC_SEGMENTS_DIR_SUFFIX']) {
    assert.strictEqual(typeof c[k], 'string', `next/dist/lib/constants 里没有 ${k} 了 —— 去 export/routes/app-page.js 重读一页落成哪些名字`);
    assert.ok(PAGE_FILE_SUFFIXES.includes(c[k]), `${k} = ${JSON.stringify(c[k])} 不在 PAGE_FILE_SUFFIXES 里`);
  }
});

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
