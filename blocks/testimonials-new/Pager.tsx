'use client';

// testimonials-new 轮播的圆点 + 前后按钮（#1488）。块的其余部分是服务端组件；评价本身全在服务端 HTML 里，
// 这一小段只负责「点一下滚到哪」和「滚到哪亮哪个圆点」，照定稿图册 frame 脚本那段（`build.py:448` / `:450`）：
//   · 点 前 / 后 = 滚一条宽（一条的宽 + 列间距）
//   · 点第 N 个圆点 = 滚到第 N 条打头
//   · 滚动时按 round(scrollLeft / 一条宽) 亮当前圆点 —— 一屏两条、六条时轨道最远只滚到第 5 条打头，
//     第 6 个圆点按构造亮不了（#1488 判据 3，PM 2026-09-29 算过）
// 🔴 不自动播放：这里没有任何定时器。键盘左右键由浏览器对可聚焦的滚动容器（轨道 `tabindex="0"`）原生处理。
// 🔴 轨道就是同一列里的 `.tn-grid`（DOM 里紧挨在本组件前面），按 DOM 找，不另传引用 —— 服务端那一半不用变成客户端组件。

import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';

interface Props {
  count: number;
  prevIcon?: ReactNode;
  nextIcon?: ReactNode;
}

export default function Pager({ count, prevIcon, nextIcon }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const [on, setOn] = useState(0);

  const track = useCallback((): HTMLElement | null => {
    const col = ref.current?.parentElement;
    return col ? col.querySelector<HTMLElement>('.tn-grid') : null;
  }, []);
  const step = (g: HTMLElement): number => {
    const it = g.querySelector('.tn-item');
    if (!it) return g.clientWidth;
    const gap = parseFloat(getComputedStyle(g).columnGap) || 0;
    return it.getBoundingClientRect().width + gap;
  };

  useEffect(() => {
    const g = track();
    if (!g) return undefined;
    const onScroll = () => setOn(Math.round(g.scrollLeft / step(g)));
    g.addEventListener('scroll', onScroll, { passive: true });
    return () => g.removeEventListener('scroll', onScroll);
  }, [track]);

  const by = (dir: 1 | -1) => {
    const g = track();
    if (g) g.scrollBy({ left: dir * step(g) });
  };
  const to = (i: number) => {
    const g = track();
    if (g) g.scrollTo({ left: i * step(g) });
  };

  return (
    <div ref={ref} className="tn-pager d-flex align-items-center justify-content-between gap-4 mt-8" data-part="pager">
      <div className="tn-dots d-flex gap-2">
        {Array.from({ length: count }, (_, i) => (
          <button
            key={i}
            type="button"
            className={i === on ? 'tn-dot on' : 'tn-dot'}
            data-dot={i}
            aria-label={`Review ${i + 1}`}
            aria-current={i === on ? 'true' : undefined}
            onClick={() => to(i)}
          />
        ))}
      </div>
      <div className="tn-arrows d-flex gap-2">
        <button type="button" className="tn-arrow" data-dir="prev" aria-label="Previous" onClick={() => by(-1)}>{prevIcon}</button>
        <button type="button" className="tn-arrow" data-dir="next" aria-label="Next" onClick={() => by(1)}>{nextIcon}</button>
      </div>
    </div>
  );
}
