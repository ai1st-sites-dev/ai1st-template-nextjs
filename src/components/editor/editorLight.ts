import type { CSSProperties } from 'react';

/**
 * #1740 —— 编辑器自己的界面固定浅色，不跟网站的深浅模式走（深色站的 `<html>` 挂 `data-bs-theme="dark"`，layout.tsx §rootLayout）。
 *
 * 挂在【外壳】上，局部生效，两处：
 *   · 编辑器页那一侧：EditorApp 的 `data-editor-root`（Puck 两栏、顶栏、AI 栏、Edit form 弹窗都在它里面）。
 *     🔴 不能挂在编辑器页的 `<html>` 上：Puck 开画布时把这一页 `<html>` / `<body>` 的属性整份抄到画布的根上
 *        （`@puckeditor/core` §CopyHostStyles → syncAttributes），画布里的网站就跟着变浅了。
 *   · 画布 iframe 里：portal 进画布 body 的五个浮层各自最外那一层（块的条、条目条、Design 面板、字的工具条、图上的操作条）。
 *     画布的根必须保持网站自己的深浅，所以不挂在画布根上。
 *
 * 三样一起才够（跟 site-css.js §SCHEME_SURFACES 里「填了 bg 的块拉回 light」同一个道理）：
 *   · `data-bs-theme="light"`：Webpixels 的 `:root,[data-bs-theme=light]` 把 `--x-*` 变量换回浅色那一套。
 *   · `color`：继承来的字色是 body 在深色下【算好的值】，变量换了它不会重算 ⟹ 外壳上自己声明一次。
 *   · `color-scheme`：Bootstrap 的 light 那张表不写它 ⟹ 浏览器照旧按深色画原生的输入框 / 下拉框（深灰底）。
 * 外壳自己写的 `color` / `background` 放在展开之后，照旧赢。
 */
export const EDITOR_LIGHT = { 'data-bs-theme': 'light' } as const;
export const EDITOR_LIGHT_STYLE: CSSProperties = { colorScheme: 'light', color: 'var(--x-body-color)' };
