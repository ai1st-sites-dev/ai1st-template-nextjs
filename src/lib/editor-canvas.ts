// #1801 —— 「这棵组件树是不是画在编辑器画布里」。画布的根（dashboard 编辑器 §RootShell，跟顶栏 `editorCanvas` 同一个判据：
// 收到了编辑器的 ShellOverride 的那一处）给 true；站上、预览、发布渲染不给 ⟹ 默认 false，那几条路的 HTML 跟以前逐字节相同。
// 读它的：`BlockLeadForm`（画布里表单不提交，设计文档 §5.4）。
import { createContext } from 'react';

export const EditorCanvasContext = createContext(false);
