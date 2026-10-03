'use strict';

// ══════════════════════════════════════════════════════════════════════════════════════════════════
// text-dir.js —— 站级文字方向：locale 推 `dir`（#1473，设计稿 §8 第 5 条）
// ══════════════════════════════════════════════════════════════════════════════════════════════════
//
// 用户只选语言，`dir` 不单独暴露：`site_meta.json` 的 `defaultLocale` → `rtl | ltr`。三个读者：
//   · `sync-config.js` —— 写进 `config-data.ts`（`layout.tsx` 的 `<html dir>`），并把它交给 `site-css.js`
//   · `site-css.js` —— `rtl` 站在 sass 之后过一遍 RTLCSS，purge 之后再追加 §RTL_ICON_FLIP
//   · 本文件的单测
// 🔴 **站级**：多语言站（`en` 主 + `ar` 次）整站按主语言走，本票不做按页切换。块自己不做任何事 —— 前提是块的 CSS
//    只用逻辑属性（`scripts/block-css-logical.test.js` 守着）。

/** 从右往左写的语言（ISO 639-1 主标签）。 */
const RTL_LANGS = ['ar', 'he', 'fa', 'ur'];

/** `ar` / `ar-EG` / `ar_SA` / `AR` → `rtl`；其余（含空值）→ `ltr`。 */
function dirForLocale(locale) {
  if (typeof locale !== 'string') return 'ltr';
  const lang = locale.trim().toLowerCase().split(/[-_]/)[0];
  return RTL_LANGS.includes(lang) ? 'rtl' : 'ltr';
}

/**
 * 方向性图标在 RTL 下水平翻转。按 `data-icon` 选（#1462 起图标是内联 `<svg data-icon={name}>`，
 * `src/components/Icon.tsx` / `InlineIcon.tsx`），按名字挂、不按块挂 —— 数据里的 `icon` 字段可以填任何名字。
 * 🔴 只翻左右：`chevron-down` / `chevron-up` 是纵向，不在清单里（不用 `*-left` 这类通配，免得哪天多一个名字被带进来）。
 * 🔴 这一段【只】追加进 RTL 站的 `site.css`，而且在 purge **之后**（`site-css.js` §writeSiteCss）：
 *    ① LTR 站的 `site.css` 一个字节不多（#1473 验收 4）；② purge 按源码字面词判属性选择器，`rtl` 这个词不在
 *    `blocks/**` / `src/**` 的 tsx 里 ⟹ 放在 purge 之前会被整条扫掉、箭头照旧朝右而构建不报错。
 */
const FLIP_ICONS = ['arrow-right', 'arrow-left', 'chevron-right', 'chevron-left'];
const RTL_ICON_FLIP = [
  '/* #1473 —— RTL 站的方向性图标（scripts/lib/text-dir.js §RTL_ICON_FLIP） */',
  `${FLIP_ICONS.map((n) => `[dir=rtl] [data-icon="${n}"]`).join(',\n')} {`,
  '  transform: scaleX(-1);',
  '}',
  '',
].join('\n');

module.exports = { RTL_LANGS, dirForLocale, FLIP_ICONS, RTL_ICON_FLIP };
