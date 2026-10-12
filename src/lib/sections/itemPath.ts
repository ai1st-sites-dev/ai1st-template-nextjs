// #1723 —— 列表项的外层元素挂 `data-item="<槽路径>.<下标>"`（`stats.2`、`logos.items.0`）：编辑器画布据它认出「这一格是第几项」，
// 悬停出条目自己的浮动条（↑ ↓ 🗑，`EditorApp.tsx` §ItemBars）。路径写法同 `data-slot`。
// 🔴 下标是这一项在**数据里**的位置，不是块过滤之后的位置：块会丢掉画不出来的项（没字的 stat、没图的 logo），
//    按过滤后的下标挂，删的就是数据里另一项。过滤不换对象（`filter` / `slice` 留着原引用）⟹ 回原数组 indexOf 就对得上。
// `scripts/block-slots.test.js` ⑥ 守着「编辑器 schema 里每一条列表在产物里都有 data-item」。

/** `'<slot>.<数据里的下标>'`。`raw` = 块拿到的原始数组；`it` 不在里面（块自己造的项）⟹ 退回 `i`。 */
export function itemPath(slot: string, raw: unknown, it: unknown, i: number): string {
  const at = Array.isArray(raw) ? raw.indexOf(it) : -1;
  return `${slot}.${at < 0 ? i : at}`;
}
