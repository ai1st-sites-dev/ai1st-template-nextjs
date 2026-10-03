// ══════════════════════════════════════════════════════════════════════════════════════════════════
// Eyebrow —— 块头那一行小字，全站一个组件（#1533 T6c-1，总纲 #1422）
// ══════════════════════════════════════════════════════════════════════════════════════════════════
//
// 🔴 **四种样式的类名表只有这一份。** 在这之前 15 个块各抄一份 `EYEBROW_CLASS`，只差类名前缀
//    （`cta-eyebrow-pill` / `fx-eyebrow-pill` …），深底规则也各写一份。现在：
//    · 样子 = 下面这张表（Webpixels 工具类），改一处全站生效；
//    · 深底 / 主色底上的反白 = `scripts/lib/site-css.js` §DEEP_COMMON，按本组件吐的 `data-eyebrow` 选，
//      不再有带块前缀的类名。块自己的 `block.css` 里不许再写（`scripts/block-deep-common.test.js` 盯着）。
// 🔴 类名要**逐字**写在这里：`site.css` 按源码 purge（`site-css.js` §PURGE_CONTENT 含 `src/**/*.tsx`），拼出来的看不见。
// 🔴 外面那层 `<div data-part="eyebrow">` 不在这里：各块的间距 / 包裹类不一样（`mb-4` · `mb-5` · `lo-eyebrow-wrap` …），
//    那是块头排版的事，不是 eyebrow 自己的样子。
//
// 「哪个样式算生效」也各块不同（hero / cta：没写或写错 ⟹ pill；其余：没写 ⟹ pill、写错 ⟹ 不画），由块自己判，
// 用 `isEyebrowStyle` 问「这是不是一种样式」。

export const EYEBROW_STYLES = ['pill', 'outline', 'dash', 'plain'] as const;
export type EyebrowStyle = typeof EYEBROW_STYLES[number];

const CLASS: Record<EyebrowStyle, string> = {
  pill: 'badge rounded-pill bg-primary-subtle text-primary fw-semibold text-xs px-3 py-2',
  outline: 'badge rounded-pill border border-primary text-primary bg-transparent fw-semibold text-xs px-3 py-2',
  dash: 'text-uppercase text-xs fw-semibold ls-wider text-muted',
  plain: 'text-uppercase text-xs fw-semibold ls-wider text-muted',
};

export const isEyebrowStyle = (s: unknown): s is EyebrowStyle =>
  typeof s === 'string' && (EYEBROW_STYLES as readonly string[]).includes(s);

/** 一行 eyebrow。`slot` 是编辑器的 `data-slot`（hero / cta 是 `eyebrow.text`，其余 `introEyebrow.text`）。 */
export default function Eyebrow({ style, text, slot }: { style: EyebrowStyle; text?: string; slot: string }) {
  return (
    <span className={CLASS[style]} data-eyebrow={style} data-slot={slot}>
      {style === 'dash' ? '— ' : null}{text}
    </span>
  );
}
