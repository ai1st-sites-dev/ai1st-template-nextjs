// #1534 —— 段落外壳收成一份：`<section>` + 深浅标记（`data-tone` / `data-bs-theme`）+ 底色 + 上下留白 + 容器。
// 块只填容器里面那一段（和容器前后各一个可选的口子）。
//
// 🔴 生成的 HTML 跟收拢前逐字相同（`scripts/block-snapshot.mjs` 量的，15 个块 74 个预设 × 浅 / 深两种底）——
//    所以属性的**先后**也是接口的一部分：
//      data-block / data-role …（blockAttrs）→ `attrs`（本块旋钮那一串）→ data-tone → data-bs-theme → `extraAttrs` → class → style
//    改这个顺序 = 改了 17 个站的每一个块的 HTML。
// 深浅的判据只有一条：照片铺底（`cover`）一律算深，否则看 `bg`（`scripts/lib/contrast.js` §toneForBg）。
// 块里自己还要用深浅（内框、反白）时调下面的 `blockTone`，别再自己拼一遍 `cover ? 'dark' : toneForBg(…)`。
// 外壳块（header / footer）不写 `<section>`，不走这里。

import type { CSSProperties, ReactNode } from 'react';
import { blockAttrs } from '@/lib/sections/blockAttrs';
import type { BlockConfig } from '@/lib/types/config';
import { bgCss, bsThemeForBg, toneForBg, type BgValue } from '../../scripts/lib/contrast.js';

type Attrs = Record<string, string | number | boolean | undefined>;

/** 这个块算深还是浅（`light` / `dark` / `brand`）：照片铺底一律 `dark`，否则看底色。 */
export function blockTone(bg: BgValue | null | undefined, cover = false): 'light' | 'dark' | 'brand' {
  return cover ? 'dark' : toneForBg(bg);
}

interface Props {
  /** 块名（`data-block`）。 */
  type: string;
  block?: BlockConfig;
  /** 本块的 `data-*`（旋钮那一串），排在 `data-tone` 前。 */
  attrs?: Attrs;
  /** 排在 `data-bs-theme` 后的 `data-*`（pricing 的 `data-fc-*`、features 的 `data-items-source`）。 */
  extraAttrs?: Attrs;
  /** 颜色槽 `bg` 的值。 */
  bg?: BgValue | null;
  /** 照片铺满整段（cta / hero / milestones / page-header 的 background 档）。 */
  cover?: boolean;
  /** `false` = 底色不涂在 `<section>` 上（cta 的 frame=boxed：底色涂在内框，块自己涂）。 */
  paint?: boolean;
  /** 跟底色合在一起的 style（pricing 的 `--pr-fc*` 变量）。给了它，`style` 就总是一个对象。 */
  style?: CSSProperties;
  /** `<section>` 的 class。默认 `position-relative section-padding`。
   *  `section-padding` 是上下留白，主题设置的 density 从这里进页面（`src/app/globals.css`，#1541）—— 自己传 class 的块要带上它。 */
  className?: string;
  /** 容器的 class。默认 `container`。 */
  containerClassName?: string;
  /** 容器之前（铺底的照片 / 遮罩层）。 */
  layer?: ReactNode;
  /** 容器之后、`</section>` 之前（gallery 的灯箱）。 */
  after?: ReactNode;
  children?: ReactNode;
}

export default function BlockSection({
  type, block, attrs, extraAttrs, bg, cover = false, paint = true, style, className = 'position-relative section-padding',
  containerClassName = 'container', layer, after, children,
}: Props) {
  const bgValue = paint ? bgCss(bg) : null;
  const css = style ? ({ ...(bgValue ? { background: bgValue } : {}), ...style } as CSSProperties) : (bgValue ? { background: bgValue } : undefined);
  return (
    <section
      {...blockAttrs(type, block)}
      {...attrs}
      data-tone={blockTone(bg, cover)}
      data-bs-theme={bsThemeForBg(bg, cover)}
      {...extraAttrs}
      className={className}
      style={css}
    >
      {layer}
      <div className={containerClassName}>{children}</div>
      {after}
    </section>
  );
}
