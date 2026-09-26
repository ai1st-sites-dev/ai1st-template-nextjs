'use strict';

// editor-pages.js —— 这个站有哪些编辑器页（#1448）。**纯函数、零 require**。
//
// 两处用它，必须是同一份：
//   · `src/app/~editor/[...target]/page.tsx` §generateStaticParams —— 导出哪些 `/~editor/<语言>/<slug>`
//   · 同一个文件传给 `EditorApp` 的 `pages` —— 编辑器面板条上那个换页下拉的清单（随 `ai1st:editor-ready` 交给 dashboard）
// 下拉里每一项点开都得是一个真的编辑器页（`dynamicParams = false`：不在这份里的路径是 404），所以不许另写一份。
//
// 规则：`pagesByLocale` 里的每一页，除了 slug 是保留字（或在它底下）的 —— 那两个 slug 的页面 JSON 不会被渲染成页面，
// 与 `[...slug]/page.tsx` 同一份保留字（那一份本票不动）。**没进顶栏导航的页照样在**（不看 `navLabel`）。

const RESERVED_SLUGS = ['blog', '_next'];

function isReservedSlug(slug) {
  return RESERVED_SLUGS.some((r) => slug === r || slug.startsWith(`${r}/`));
}

/**
 * 按 `locales` 的顺序，每种语言一组：`[{ locale, pages: [{ slug, label }] }]`。组里是那种语言的页，顺序同 `pagesByLocale`。
 * `label` 给下拉用：导航上的叫法 → 页面标题 → slug。一页都没有的语言不出组。
 */
function editorPages(locales, pagesByLocale) {
  const groups = [];
  for (const locale of locales || []) {
    const pages = [];
    for (const p of (pagesByLocale && pagesByLocale[locale]) || []) {
      if (!p || typeof p.slug !== 'string' || !p.slug || isReservedSlug(p.slug)) continue;
      const label = [p.navLabel, p.title, p.slug].find((v) => typeof v === 'string' && v.trim());
      pages.push({ slug: p.slug, label: label.trim() });
    }
    if (pages.length) groups.push({ locale, pages });
  }
  return groups;
}

module.exports = { RESERVED_SLUGS, isReservedSlug, editorPages };
