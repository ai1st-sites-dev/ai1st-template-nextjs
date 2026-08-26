'use strict';
/**
 * floor-look.js — 「这个站会不会长成 base.css 的地板样」这一问，只在这里回答一次。（#1198）
 *
 * 背景（2026-08-25 生产实测，`site-194f1f41` / dexin.ca，唯一那个真付费客户）：一次**不带 themeId**
 * 的模板升级把站放到了新世界的模板上，而它的 `site/theme.json` 仍写着 `luxury-dark` —— 一套已经
 * 不在注册表里、也没有 `public/themes/luxury-dark.css` 的主题。于是 `sync-config.js` 那句
 * `blockLayoutCss: themeSheet ? read(sheet) : ''` 走了空串那一支，产出 982 字节的纯 token
 * theme.css：**31 种块一条画法都没有**，整站掉回 base.css 的地板 —— 桌面下四个数字柱纵排左对齐。
 * 🔴 **整条链是绿的**：构建不报错，两行日志都在，而两行都在安抚人（一行说「keeps the look it
 * already has」，另一行把 100% 的块说成脚注里的 `the 0 unmoved blocks`）。
 *
 * 🔴 量的是【产物】，不是 `themeSheet` 那个代理。theme.css 有两条来源（`sync-config.js` §theme.css），
 *    两条都造得出没有画法的产物：② 没有 sheet 时从 brand.json 生成（本站走的这条）· ① repo 里那份
 *    `site/theme.css` 若是在没有 sheet 的年代冻下来的。问代理只看得见第二条 —— 而第一条那格的
 *    对照臂已经实测过：`theme.json.css` 指着一张完整的表、`site/theme.css` 是旧的 token 字节时，
 *    `sync-config` 上面那行照样报「31 个块 styled by those rules」，产物里一条画法都没有。
 *
 * 🔴 谓词按【这个站摆了哪些块】问，不是按「theme.css 里一条画法都没有」。后者是 #1198 AC3 点名的
 *    那一格，而它被这一条包住（一条都没有 ⟹ 这个站的块当然一条都没命中）；反过来不成立。
 *
 * 🔴 **这个模块只报，不拒。** 拒的代价量过：2026-08-25 生产上处在这个形状的站正好是那一个，而它
 *    正是需要能重建才能被救的那一个 —— 让构建 exit 1 会连老板编辑都做不了，比地板样更坏。
 *    而「没穿过主题的站长成地板样」本来就是 #1008 D12 记下的合法状态。
 */

/**
 * 这份样式表真的给哪些块写了画法。
 *
 * 判据是**顶层类选择器的块名根**（`.hero__media` → `hero`），只认注册表里真有的块类型。
 * 主题表就是这么写的 —— `public/themes/*.css` 的顶层类根集合逐字等于那 31 个块名（2026-08-25
 * 在 100 份表上现测），base.css 同理，所以这把尺对两边通用。
 *
 * @param {string} css            一份样式表的原文（这里给的是最终的 theme.css）
 * @param {string[]} allBlockTypes 注册表里一共有哪些块类型
 * @returns {Set<string>} 这份表给出了画法的块类型
 */
function blockTypesStyledBy(css, allBlockTypes) {
  const known = new Set(allBlockTypes);
  const styled = new Set();
  for (const sel of String(css).match(/^\.[a-z0-9-]+/gm) || []) {
    const type = sel.slice(1).split('__')[0];
    if (known.has(type)) styled.add(type);
  }
  return styled;
}

/**
 * 这个站会不会长成地板样。
 *
 * @param {object}   o
 * @param {string}   o.themeCss          最终产物 theme.css 的原文
 * @param {string[]} o.blockTypesOnSite  这个站真的摆了哪些「版式归主题表管」的块（MOVED_BLOCKS 交集）
 * @param {string[]} o.allBlockTypes     注册表里一共有哪些块类型
 * @param {boolean}  o.hasFloor          这个模板有没有 base.css 那层地板
 * @returns {{ floor: boolean, unstyled: string[], styledCount: number }}
 */
function assessFloorLook({ themeCss, blockTypesOnSite, allBlockTypes, hasFloor }) {
  const styled = blockTypesStyledBy(themeCss, allBlockTypes);
  const onSite = [...new Set(blockTypesOnSite)];
  const unstyled = onSite.filter((type) => !styled.has(type)).sort();
  return {
    // 🔴 `hasFloor` 在今天这个模板上恒为真（base.css 就在 public/ 里跟着模板走）。留着不是当筛子用，
    //    是因为报出来那句话点名了它 —— 说「会长成 base.css 的地板样」，就得先确认那层地板真的在。
    floor: Boolean(hasFloor) && onSite.length > 0 && unstyled.length === onSite.length,
    unstyled,
    styledCount: styled.size,
  };
}

/** 构建日志里那个机器读得到的标记 —— `worker/main.go` 的升级那一跳按它报警（`floorLookMarker`）。 */
const FLOOR_LOOK_MARKER = '__THEME_CSS_HAS_NO_BLOCK_LAYOUT__';

module.exports = { blockTypesStyledBy, assessFloorLook, FLOOR_LOOK_MARKER };
