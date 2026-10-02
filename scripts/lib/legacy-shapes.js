'use strict';
/**
 * #1500 —— 槽位换了形状之后，旧数据读入时迁移一次。
 *   · `testimonials.summary`：#1488 是一个对象 `{rating, count, source}`，#1500 起是一组平台（list）⟹
 *     对象包成一项的数组，键原样搬；这个槽 `ranges` 里点名的数字子字段（rating / count）写成数字字符串的
 *     （#1488 的夹具和提示词都是 `'4.9'` / `'312'`）转成数，否则新形状的范围检查会把旧站判错。
 * 📌 现在没有客户站，这一条只为 #1488 合入到 #1500 合入之间 dev / test 上建的站不渲染坏。
 * 名单写在这里，不写进 manifest：它是一次性的迁移，不是块的长期声明。
 *
 * 🔴 调用方有两个，用的是这同一个函数：
 *   · `blocks.js` §normalizeListSlots —— 构建（sync-config）、编辑器、AI 改站读页面都先过它，而它会把
 *     「是列表槽、值不是数组」换成 `[]`。所以迁移必须在它**之前**做，不然旧对象在这一跳就被清空了
 *     （QA1 #1500 r2 在 sync-config 产物上量到的就是这个）。
 *   · `block-manifest.js` §validateSite —— 建站那一刻直接校验 AI 写的原始数据，不经过上面那一跳。
 *   迁移是幂等的（已经是数组就不动），两处都过一次不会包两层。
 * 放在单独一个文件里是因为 `block-manifest.js` 已经 require 了 `blocks.js`，反过来 require 会成环。
 */
const LEGACY_OBJECT_TO_LIST = { 'testimonials': ['summary'] };

// 这个槽要不要迁移、迁成什么：要 ⟹ 返回新数组；不用 ⟹ 返回 null（调用方原样不动）。
function legacyListValue(type, slot, spec, v) {
  if (!(LEGACY_OBJECT_TO_LIST[type] || []).includes(slot)) return null;
  if (!spec || spec.kind !== 'list' || !v || typeof v !== 'object' || Array.isArray(v)) return null;
  const item = { ...v };
  for (const sub of Object.keys(spec.ranges || {})) {
    const x = item[sub];
    if (typeof x === 'string' && x.trim() !== '' && Number.isFinite(Number(x))) item[sub] = Number(x);
  }
  return [item];
}

module.exports = { LEGACY_OBJECT_TO_LIST, legacyListValue };
