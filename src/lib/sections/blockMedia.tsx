// ══════════════════════════════════════════════════════════════════════════════════════════════════
// blockMedia —— 块里两样「各块各写一份」的渲染收成一份（#1538，总纲 #1422 的 T6c-3c）
// ══════════════════════════════════════════════════════════════════════════════════════════════════
//
// ① slotImg：图槽 `{ imageUrl, alt }` → `<img>`。凡是 manifest 的 slots 里有 `imageUrl` 的块，`src` 读 `.imageUrl` 的
//    `<img>` 一律走它（`scripts/block-media.test.js` 盯着）。
// ② ratingStars：评分 → 一排星（reviews / testimonials）。hero / pricing 的 `★★★★★` 是装饰字符、不读评分，不归这里。
//
// 🔴 块与块的差异全是**参数**，函数里不按块名分支。而且产出要跟收之前**逐字相同**（#1538 AC2 比的是 outerHTML，
//    属性先后也算）——所以属性不由这里排，由调用方按原来的先后给：
//    - slotImg：`before` 排在 src 前，`between` 夹在 src 与 alt 之间（只有 gallery 灯箱那张这么写），`after` 排在 alt 后。
//      alt 不给就是 `img.alt || ''`；page-header 铺底那张写死 `alt: ''`（不读数据里的 alt，那是本票之外的事）。
//    - ratingStars：根节点的属性整组由 `root(n, label)` 给（两个块 role / aria-label 的先后不同）。
// 📌 `key` 单独传：React 不许把 key 混在展开的 props 里。

import type { Key } from 'react';
import InlineIcon, { type IconTable } from '@/components/InlineIcon';

export interface SlotImage { imageUrl?: string; alt?: string }
type Attrs = Record<string, unknown>;

export function slotImg(
  img: SlotImage,
  { key, before, between, alt, after }: { key?: Key; before?: Attrs; between?: Attrs; alt?: string; after?: Attrs } = {},
) {
  return <img key={key} {...before} src={img.imageUrl} {...between} alt={alt ?? (img.alt || '')} {...after} />;
}

/**
 * 评分四舍五入成整数颗（4.5 → 5、4.4 → 4，不画半颗），夹在 0–5。
 * - `fillEmpty`：false 只画 n 颗实心（reviews）；true 恒画 5 颗，n 颗实心 + 其余空心（testimonials）。
 * - `wrap`：每颗星外面再包一层 `<span>`，属性按这颗是 fill / empty 给；不给就不包。
 */
export function ratingStars(
  rating: number,
  icons: IconTable,
  { root, fillEmpty = false, wrap }: {
    root: (n: number, label: string) => Attrs;
    fillEmpty?: boolean;
    wrap?: (kind: 'fill' | 'empty') => Attrs;
  },
) {
  const n = Math.max(0, Math.min(5, Math.round(rating)));
  const kinds: ('fill' | 'empty')[] = [...Array(n).fill('fill'), ...(fillEmpty ? Array(5 - n).fill('empty') : [])];
  return (
    <span {...root(n, `${n} out of 5 stars`)}>
      {kinds.map((s, i) => {
        const icon = <InlineIcon key={wrap ? undefined : i} name={s === 'fill' ? 'star-fill' : 'star'} icons={icons} />;
        return wrap ? <span key={i} {...wrap(s)}>{icon}</span> : icon;
      })}
    </span>
  );
}
