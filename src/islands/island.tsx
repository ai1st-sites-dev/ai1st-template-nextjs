// #1798 —— 「岛」：发布出去的静态网页上，要在浏览器里活过来的那几个组件（表单、手机菜单、灯箱、轮播、地图、价格切换、页脚）。
//
// 去掉 Next 之后没人替我们处理 `'use client'` 的边界，这一层自己做：
//   · 每个岛组件文件的默认导出 = `island(名字, 组件, 投影?)` 包一层。
//   · 包装平时**什么都不做**，原样画组件 —— Next 构建、dashboard 画布、test:scripts 的渲染测试都走这一支，行为不变。
//   · 只有静态整页渲染（`render.tsx` §renderWithIslands）在外面放了 `IslandCollectorContext` 时，它才不画组件，
//     而是登记「这里有一个叫 X 的岛、props 是 P」并留一个占位；整页画完后由 render.tsx 对每个岛单独 `renderToString`
//     填回去，旁边放 props 的 JSON。浏览器里 `runtime.tsx` 按名字找组件 `hydrateRoot`。
//   · 🔴 为什么不在这里直接 `renderToString`：在另一次服务端渲染的过程中同步再起一次渲染，React 不保证可重入；
//     先占位、画完再填，两次渲染完全分开。
//   · 🔴 岛里套岛只算最外层（`footer` 里有 `BlockLeadForm`）：填岛那一次 `renderToString` 外面不放收集器
//     ⟹ 里层的岛走「原样画」那一支，成为外层岛的普通子树；浏览器里 hydrate 外层时里层也是普通子树，两边对得上。
//   · `project`（可选）：把 props 剥成真正要序列化的那一份（去掉整站 `site`、把图标表收窄）。服务端填岛和浏览器 hydrate
//     用的都是剥过的这一份，所以两边画出来的一样；平时（没有收集器）不剥，组件照旧收到原来的 props。
import { createContext, useContext, type ComponentType } from 'react';

export interface IslandCollector {
  /** 登记一个岛，返回它在这一页里的序号（占位上的 `data-island-slot`）。 */
  add(name: string, props: object): number;
  /** #1802 —— 这一次整页渲染的随机记号（占位上的 `data-island-token`）。填岛时只认带这个记号的占位：
   *  页面里的用户内容（博客正文是裸 HTML）写出一个字面的 `<div data-island=… data-island-slot=…>` 也猜不到它，
   *  就只是一个普通的空 div，不会被当成岛去填、也不会让整页渲染报错（#1798 QA3 量出来的那一条）。 */
  token: string;
}

export const IslandCollectorContext = createContext<IslandCollector | null>(null);

export function island<P extends object>(name: string, Component: ComponentType<P>, project?: (props: P) => P): ComponentType<P> {
  function Island(props: P) {
    const collector = useContext(IslandCollectorContext);
    if (!collector) return <Component {...props} />;
    const slot = collector.add(name, project ? project(props) : props);
    return <div data-island={name} data-island-slot={slot} data-island-token={collector.token} />;
  }
  Island.displayName = `Island(${name})`;
  return Island;
}
