'use client';

// #1343 —— 一格一个形态下拉。改的是 DOM 上的 `data-shape`，不是 React 的 state：
// `public/shapes.css` 是无条件加载的（`layout.tsx:747`），它按 `[data-block][data-shape]` 点名，
// 所以属性一变浏览器当场重排 —— 一行 JS 都不用管布局（设计文档 D14 第 3 条：形态只能是 CSS）。
//
// 🔴 只动**自己这一格**里的块（`closest('[data-catalog-cell]')`）。整页有 83 格，按 `[data-block]`
//    全局改会把别的格子一起换掉，而那正好会让「切这一格 → 只有这一格变」这条读数变得测不出来。

import { useEffect, useRef, useState } from 'react';

interface Props {
  block: string;
  shapes: string[];
  initialShape: string;
}

export default function ShapeSelect({ block, shapes, initialShape }: Props) {
  const ref = useRef<HTMLSelectElement>(null);
  const [shape, setShape] = useState(initialShape);
  // 🔴 同 CatalogBoard 那条：hydration 之前这个下拉会骗人（值变了、`data-shape` 没变）。
  const [ready, setReady] = useState(false);
  useEffect(() => { setReady(true); }, []);

  return (
    <label className="catalog-cell__shape">
      <span className="catalog-cell__shape-label">形态</span>
      <select
        ref={ref}
        data-catalog-shape-select={block}
        disabled={!ready}
        value={shape}
        onChange={(e) => {
          const next = e.target.value;
          setShape(next);
          const cell = ref.current ? ref.current.closest('[data-catalog-cell]') : null;
          if (!cell) return;
          // 🔴 只改块根元素上的 `data-shape`。**不动**格子自己那个 `data-catalog-shape` ——
          //    那一个是「这一格是派生清单里的哪一对」，是身份，不是当前状态；改了它，
          //    「格数 == (块,形态) 全集」这条读数就会随着谁点过哪个下拉而变。
          cell.querySelectorAll('[data-block]').forEach((el) => el.setAttribute('data-shape', next));
        }}
      >
        {shapes.map((s) => <option key={s} value={s}>{s}</option>)}
      </select>
    </label>
  );
}
