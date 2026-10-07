#!/usr/bin/env node
// #1628 —— 语言开关的链接（§lib/locale-switch.js）。真构建后的那一读（out/ 里的切换器 href + check-dead-links 0 条）
// 在票上手跑；这里每次 CI 都测那条规则本身，包括让 site-f764403b 出死链的两种形状。
'use strict';
const assert = require('assert');
const { switchLocaleHref } = require('./locale-switch');

let pass = 0;
let fail = 0;
function check(name, fn) {
  try { fn(); pass += 1; console.log(`  ✅ ${name}`); } catch (e) { fail += 1; console.log(`  ❌ ${name}\n     ${e.message}`); }
}

// 主语言 zh、第二语言 en：about 两边都有，pricing 只有 zh；博客只在 zh 有文章（create-site 今天就这么建）
const IDX = {
  defaultLocale: 'zh',
  slugToLocales: { home: ['zh', 'en'], about: ['zh', 'en'], pricing: ['zh'], 'services/cut': ['zh', 'en'] },
  blogSlugsByLocale: { zh: ['first-post'], en: [] },
};
const go = (path, target, idx = IDX) => switchLocaleHref(path, target, idx);

check('两边都有的页 ⟹ 同一页（默认语言走根路径，其他语言带前缀）', () => {
  assert.strictEqual(go('/about', 'en'), '/en/about');
  assert.strictEqual(go('/about', 'zh'), '/about');
  assert.strictEqual(go('/services/cut', 'en'), '/en/services/cut');
});
check('首页 ⟹ 目标语言首页', () => {
  assert.strictEqual(go('/', 'en'), '/en');
  assert.strictEqual(go('/', 'zh'), '/');
  assert.strictEqual(go('', 'en'), '/en');
});
check('🔴 site-f764403b 那条：/blog 切到没有文章的 en ⟹ /en，不是 /en/blog', () => {
  assert.strictEqual(go('/blog', 'en'), '/en');
});
check('🔴 site-f764403b 那条：/_not-found ⟹ 目标语言首页，不是 /en/_not-found', () => {
  assert.strictEqual(go('/_not-found', 'en'), '/en');
});
check('博客列表：默认语言恒有（/blog 无条件生成），别的语言有文章才有', () => {
  assert.strictEqual(go('/blog', 'zh'), '/blog');
  assert.strictEqual(go('/blog', 'zh', { ...IDX, blogSlugsByLocale: { zh: [], en: [] } }), '/blog');
  assert.strictEqual(go('/blog', 'en', { ...IDX, blogSlugsByLocale: { zh: [], en: ['p'] } }), '/en/blog');
});
check('博客文章：目标语言里有同一个 slug 才去，没有 ⟹ 首页', () => {
  assert.strictEqual(go('/blog/first-post', 'en'), '/en');
  assert.strictEqual(go('/blog/first-post', 'en', { ...IDX, blogSlugsByLocale: { zh: ['first-post'], en: ['first-post'] } }), '/en/blog/first-post');
  assert.strictEqual(go('/blog/first-post', 'zh'), '/blog/first-post');
  assert.strictEqual(go('/blog/a/b', 'zh'), '/');
});
check('只在一种语言里有的页 ⟹ 另一种语言的首页', () => {
  assert.strictEqual(go('/pricing', 'en'), '/en');
  assert.strictEqual(go('/pricing', 'zh'), '/pricing');
  assert.strictEqual(go('/nope', 'en'), '/en');
});
check('三种语言、默认是 en：切到默认语言走根路径', () => {
  const idx = { defaultLocale: 'en', slugToLocales: { about: ['en', 'fr'] }, blogSlugsByLocale: {} };
  assert.strictEqual(go('/about', 'en', idx), '/about');
  assert.strictEqual(go('/about', 'fr', idx), '/fr/about');
  assert.strictEqual(go('/about', 'es', idx), '/es');
  assert.strictEqual(go('/blog', 'fr', idx), '/fr');
});

console.log(`\n══ 汇总: 通过 ${pass} · 失败 ${fail} ══`);
process.exit(fail ? 1 : 0);
