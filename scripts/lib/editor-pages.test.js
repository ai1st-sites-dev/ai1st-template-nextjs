#!/usr/bin/env node
/**
 * editor-pages.test.js — #1448：编辑器页清单（`lib/editor-pages.js` §editorPages）。
 *
 *   node scripts/lib/editor-pages.test.js     （由 `npm run test:scripts` 自动发现）
 *   退出码: 0 全过 · 1 有失败
 *
 *   ① 没进顶栏导航的页（没有 `navLabel`）在清单里 —— 反向：按 `getNavPages` 那样过滤就少了它
 *   ② slug 是保留字（`blog` / `_next`）或在它底下的页不在；只是前缀像（`blogger`）的在
 *   ③ 按 `locales` 的顺序每种语言一组，组内顺序同 `pagesByLocale`；一页都没有的语言不出组
 *   ④ label：navLabel → title → slug
 *   ⑤ 代码层：编辑器路由的 `generateStaticParams` 和传给 EditorApp 的 `pages` 都调这一个函数，路由文件里
 *     不再有第二份 `['blog', '_next']`（下拉里的每一项 = 一个真导出的编辑器页）
 */

'use strict';

const fs = require('fs');
const path = require('path');
const { editorPages, isReservedSlug } = require('./editor-pages.js');

let pass = 0; let fail = 0;
const check = (cond, m, detail) => {
  if (cond) { pass += 1; console.log(`  ✅ ${m}`); } else { fail += 1; console.log(`  ❌ ${m}${detail ? ` —— ${detail}` : ''}`); }
};

const pagesByLocale = {
  en: [
    { slug: 'home', title: 'Home', navLabel: 'Home' },
    { slug: 'services', title: 'Our services', navLabel: 'Services' },
    { slug: 'thank-you', title: 'Thank you' },               // 没进导航
    { slug: 'blog', title: 'Blog', navLabel: 'Blog' },       // 保留字
    { slug: 'blog/first', title: 'First post' },             // 保留字底下
    { slug: '_next', title: 'x' },
    { slug: 'blogger', title: 'Blogger tips' },              // 只是前缀像
    { slug: 'services/brakes', title: '', navLabel: '' },    // 子目录页，label 落到 slug
  ],
  zh: [
    { slug: 'home', title: '首页', navLabel: '首页' },
    { slug: 'about', title: '关于我们' },
  ],
  fr: [{ slug: 'blog', title: 'Blog' }],                     // 只有保留字 ⟹ 不出组
};

console.log('① ② ③ ④ 清单');
const got = editorPages(['en', 'zh', 'fr'], pagesByLocale);
const slugsOf = (loc) => (got.find((g) => g.locale === loc) || { pages: [] }).pages.map((p) => p.slug);
check(slugsOf('en').includes('thank-you'), '没进导航的 thank-you 在清单里');
const navOnly = pagesByLocale.en.filter((p) => p.navLabel).map((p) => p.slug);
check(!navOnly.includes('thank-you'), '反向：按 navLabel 过滤（getNavPages 的做法）会少掉它 —— 上一格有分辨力');
check(!slugsOf('en').some((s) => s === 'blog' || s.startsWith('blog/') || s === '_next'), 'blog / blog/first / _next 不在', slugsOf('en').join(','));
check(slugsOf('en').includes('blogger'), 'blogger（只是前缀像）在');
check(JSON.stringify(slugsOf('en')) === JSON.stringify(['home', 'services', 'thank-you', 'blogger', 'services/brakes']), 'en 组内顺序同 pagesByLocale', slugsOf('en').join(','));
check(JSON.stringify(got.map((g) => g.locale)) === JSON.stringify(['en', 'zh']), '按 locales 顺序分组，fr（只有保留字页）不出组', got.map((g) => g.locale).join(','));
const label = (loc, slug) => got.find((g) => g.locale === loc).pages.find((p) => p.slug === slug).label;
check(label('en', 'services') === 'Services' && label('en', 'thank-you') === 'Thank you' && label('en', 'services/brakes') === 'services/brakes' && label('zh', 'about') === '关于我们',
  'label = navLabel → title → slug');
check(isReservedSlug('blog') && isReservedSlug('blog/x') && !isReservedSlug('blogger') && isReservedSlug('_next'), 'isReservedSlug 边界');
check(editorPages([], pagesByLocale).length === 0 && editorPages(['de'], pagesByLocale).length === 0, '没有语言 / 语言没有页 ⟹ 空');

console.log('⑤ 路由与下拉出自同一个函数');
const route = fs.readFileSync(path.join(__dirname, '..', '..', 'src', 'app', '~editor', '[...target]', 'page.tsx'), 'utf-8');
const code = route.split('\n').filter((l) => !l.trim().startsWith('//')).join('\n');
const gsp = code.match(/export function generateStaticParams\(\)[\s\S]*?\n}/);
check(!!gsp && /editorPages\(locales, pagesByLocale\)/.test(gsp[0]), 'generateStaticParams 调 editorPages(locales, pagesByLocale)', gsp ? gsp[0] : '找不到 generateStaticParams');
check(/pages=\{editorPages\(locales, pagesByLocale\)\}/.test(code), '传给 EditorApp 的 pages 调同一个');
check(!/['"]blog['"]\s*,\s*['"]_next['"]/.test(code), '路由文件里没有第二份保留字表');

console.log(`\n${pass} 过 · ${fail} 失败`);
process.exit(fail ? 1 : 0);
