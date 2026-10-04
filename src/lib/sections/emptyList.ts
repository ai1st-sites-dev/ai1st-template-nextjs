// #1536 —— 块的主条目列表空了，整块画不画。9 个块（faq features gallery logos milestones pricing reviews team
// testimonials）都调这一份，各块只告诉它三件事：原始数组 · 块自己过滤之后剩几条 · 这一槽是不是引用写法展开来的。
//
// 三种「空」，两种不画、一种照画（#1536 做什么 2）：
//   ① 手写 0 条（原始数组长度 0，不是引用）   ⟹ 照画块头 —— 编辑器里新拖进来的块就是这样，不许消失
//                                              （scripts/item-sources.test.js「手写 0 条」那一格钉着）
//   ② 引用写法展开出 0 条                      ⟹ 不画（#1505，features 的 `under` 下面没页）
//   ③ 写了 N 条、块自己的过滤丢光了            ⟹ 不画（#1504：reviews 0 个合法平台时画一条空带）
// ① 和 ③ 靠「原始数组是不是空的」分开。
//
// 🔴 ② 今天只有 features 走得到：`scripts/lib/item-sources.js` 的 BLOCK_SLOTS 在这 9 个列表块里只登记了它（另一个键是 footer，不在这 9 个里），别的块的数据上不会出现
//    `_sourced`。其余 8 个块调它是为了规矩只有一份，不是说它们已经支持引用写法。
// 🔴 contact 不调它：#1489 刻意让 items 可关，items 空了整块照画、侧列占满（contact-render.test.js 钉着）。

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);

/** 这一槽的引用来源名（`data._sourced.<slot>`）；不是引用写法 ⟹ 空串。 */
export function sourcedOf(data: unknown, slot: string): string {
  const s = isObj(data) && isObj(data._sourced) ? data._sourced[slot] : undefined;
  return typeof s === 'string' ? s : '';
}

/** 主条目列表空了、整块该不画 ⟹ true。`kept` = 块自己过滤之后剩下的条数。 */
export function emptyListHidesBlock(raw: unknown, kept: number, sourced: string): boolean {
  if (kept > 0) return false;
  if (sourced) return true;
  return Array.isArray(raw) && raw.length > 0;
}
