'use strict';
// #1628 —— 语言开关的每个链接指向哪儿。src/lib/config.ts §switchLocaleHref 拿真索引调它；判断本身放在这里，
// 为的是 `npm run test:scripts` 能直接测（src 是 TS + 生成的 config-data，node 读不了）。
//
// 规则：目标语言里有这一页 ⟹ 同一页；没有 ⟹ 目标语言首页。指向一张从没生成过的页 = 死链，
// 而 #1553 起死链不为 0 就发布不了。「有没有」跟构建时生成页面的规则逐条对齐：
//   · 普通页     slugToLocales[slug] 里有目标语言（getAlternateLanguages 用的同一份索引）
//   · 博客列表   默认语言恒有（app/blog/page.tsx 无条件生成 /blog）；别的语言要有文章（[...slug]/page.tsx
//               `if (posts.length === 0) continue;`）
//   · 博客文章   目标语言的文章里有这个 slug
//   · 别的形状（/_not-found、访客打错的地址）一律首页

/** 默认语言走根路径（TICKET-129），其他语言 /<语言>。跟 config.ts §localeUrl 同一个口径。 */
function prefixOf(locale, defaultLocale) {
  return locale === defaultLocale ? '' : `/${locale}`;
}

/**
 * @param {string} path      当前路径，语言前缀已去掉（`/`、`/about`、`/blog`、`/blog/<文章>`）
 * @param {string} target    要切到的语言
 * @param {{ defaultLocale: string, slugToLocales: Record<string, string[]>, blogSlugsByLocale: Record<string, string[]> }} idx
 */
function switchLocaleHref(path, target, { defaultLocale, slugToLocales, blogSlugsByLocale }) {
  const prefix = prefixOf(target, defaultLocale);
  const home = prefix || '/';
  const parts = String(path || '/').split('/').filter(Boolean);
  if (parts.length === 0) return home;
  const posts = blogSlugsByLocale[target] || [];
  if (parts[0] === 'blog') {
    if (parts.length === 1) return target === defaultLocale || posts.length > 0 ? `${prefix}/blog` : home;
    if (parts.length === 2) return posts.includes(parts[1]) ? `${prefix}/blog/${parts[1]}` : home;
    return home;
  }
  const slug = parts.join('/');
  if (slug === 'home') return home;
  return (slugToLocales[slug] || []).includes(target) ? `${prefix}/${slug}` : home;
}

module.exports = { switchLocaleHref };
