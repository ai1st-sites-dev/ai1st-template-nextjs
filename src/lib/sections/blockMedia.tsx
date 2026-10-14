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
// 📌 #1693 —— `slot`：编辑器里能换的图（「一个位置一张」，manifest 标了 `editLabel`）挂上它的槽位路径 `data-slot`
//    （`image`、`items.2.image`），排在所有属性最后；不给就一个字节不多（灯箱里那份不挂）。
//    #1694 —— 成排的图也挂，路径指到那一项的地址键（`items.2.imageUrl`、`logos.items.0.imageUrl`、`proof.avatars.1.imageUrl`）。
//    `scripts/block-slots.test.js` ① 两向守着「标了 editLabel 的图都挂了、挂了的都标了」。
// ③ knobImg（#1734）：图的旋钮不是 `none`、那一格却没有图 ⟹ 垫占位图（照有图的样子画，换布局看得出效果）。
//    垫的只是渲染：页面数据里那一格照旧是空的。占位那张 `<img>` 多挂一个 `data-placeholder`，编辑器据它把「点占位图」
//    对到数据里那一格空着的槽（`scripts/lib/inline-edit.js` §resolveInlineSlot）；真图一个字节不多。

import type { Key } from 'react';
import InlineIcon, { type IconTable } from '@/components/InlineIcon';

export interface SlotImage { imageUrl?: string; alt?: string }
type Attrs = Record<string, unknown>;

// 占位图的地址。渲染层在浏览器里跑（编辑器画布），引不到脚本侧那个常量（`scripts/lib/image-slots.js` §PLACEHOLDER_IMAGE_URL
// → block-manifest → fs）⟹ 这里自己一份，`scripts/placeholder-image.test.js` 钉住两份相等。
export const PLACEHOLDER_IMAGE_URL = '/images/grid-pattern.svg';
const PLACEHOLDER: SlotImage = Object.freeze({ imageUrl: PLACEHOLDER_IMAGE_URL, alt: '' });

/** 旋钮是 `none` ⟹ null（不画）；否则有图用图，没图垫占位图。 */
export function knobImg<T extends SlotImage>(knob: string | undefined, img: T | null): T | SlotImage | null {
  if (knob === 'none') return null;
  return img || PLACEHOLDER;
}

// ④ rowImgs（#1767）：成排的小图（hero / pricing 的头像、logo 一排、hero 的 band）里**没有地址的那一项**垫占位图，名字（`alt`）照留
//    —— 拖下新块时播的就是这种项（`{}` / `{alt: 'Logo 1'}`），不垫的话整排不画、老板不知道这里能放图。跟 ③ 一样只垫渲染、数据不写。
//    🔴 判据只在这一处：#1766 的 logos 块「没有图的一项 ⟹ 占位图」用的也是它。
//    占位那一项是新对象 ⟹ 调用方的 `itemPath(…, raw, it, i)` 按 indexOf 找不到它、退回序号 `i`；所以这里**不筛掉**没图的项
//    （序号 = 数据里的下标），只丢不是对象的项（那种数据本来就不合法）。
const ROW_PLACEHOLDERS = new WeakSet<object>();
const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
export function rowImgs<T extends SlotImage>(v: unknown): T[] {
  return (Array.isArray(v) ? v : []).filter(isObj).map((x) => {
    if (typeof x.imageUrl === 'string' && x.imageUrl) return x as T;
    const ph: SlotImage = { imageUrl: PLACEHOLDER_IMAGE_URL, alt: typeof x.alt === 'string' ? x.alt : '' };
    ROW_PLACEHOLDERS.add(ph);
    return ph as T;
  });
}

export function slotImg(
  img: SlotImage,
  { key, before, between, alt, after, slot }: { key?: Key; before?: Attrs; between?: Attrs; alt?: string; after?: Attrs; slot?: string } = {},
) {
  return <img key={key} {...before} src={img.imageUrl} {...between} alt={alt ?? (img.alt || '')} {...after} {...(slot ? { 'data-slot': slot } : {})} {...(img === PLACEHOLDER || ROW_PLACEHOLDERS.has(img) ? { 'data-placeholder': '' } : {})} />;
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
