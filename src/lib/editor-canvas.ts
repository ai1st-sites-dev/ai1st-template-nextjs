// #1801 —— 「这棵组件树是不是画在编辑器画布里」。画布的根（dashboard 编辑器 §RootShell，跟顶栏 `editorCanvas` 同一个判据：
// 收到了编辑器的 ShellOverride 的那一处）给 true；站上、预览、发布渲染不给 ⟹ 默认 false，那几条路的 HTML 跟以前逐字节相同。
// 读它的：`BlockLeadForm`（画布里表单不提交，设计文档 §5.4）。
import { createContext } from 'react';

export const EditorCanvasContext = createContext(false);

// #1833 —— 画布里这一页在预览地址上的网址（`<站的预览地址><这一页的路径>`）。Custom HTML 块的卡片上那颗 Open preview 打开它：
// 块里的脚本画布里不跑，要看它真跑起来得去预览地址。dashboard 编辑器从站信息的 `previewAddress`（#1827）算好给；没有就是空串，卡片不出按钮。
export const EditorPreviewContext = createContext('');

// #1833 r2 —— 「这棵组件树就是老板的网站」（发布 / 预览 / Next 里的站页面）。只有站的渲染入口给 true（`components/SiteRender.tsx`），
// 默认 false。Custom HTML 块只在它为 true（且不在画布里）时原样写老板的代码，其余一律走净化 —— 判据反过来写，是因为「没人给
// Provider」不能等于「原样跑」：#1874 的只读画布（`dashboard/src/canvas/CanvasApp.tsx`）没给 `EditorCanvasContext`，块的脚本就以
// dashboard 的源跑了（#1833 r1 QA2 第 1 条）。新的 dashboard 渲染面不用记得声明任何东西，默认就是安全的那一边。
export const SiteRenderContext = createContext(false);
