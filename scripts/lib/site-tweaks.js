// site-tweaks.js — 建站时给一个新站派一组每站微扰（#1120）。
//
// #1006 把机制做完了（相对偏移 → `custom.css`），但**没有人在建站时用它**。立项时的机械判据：
// `git grep -c tweaks origin/main -- templates/nextjs/scripts/create-site.js` 零命中。于是同行业撞到
// 同一套主题的两个站，皮逐字节相同 —— 而 epic #1007 效果① 原文写的是「60-80 套 **+ 每站微扰**」。
//
// 🔴 这个文件只回答「给这个 siteId 派哪三个数」。**区间与合法性不在这里** —— 唯一判据是
//    `scripts/tweaks.js` 的 `TWEAK_BOUNDS` / `validateTweaks`，本文件经 `validateTweaks` 用它
//    （`tweaks.js:109`/`:117` 现读那张表），不抄第二份、也不转手再导出一份。
//    抄一份区间就是下一次分叉的种子（#1120 正文写「schema 以 TWEAK_BOUNDS 为准」也是这个意思）。
//
// 🔴 为什么它是**独立一个模块**，而不是 `create-site.js` 里的一个局部函数：下面那三张表要被
//    `site-tweaks.test.js` 逐档钉住（「每一档都落在 TWEAK_BOUNDS 里」＋「一档都不是中性」），
//    而函数作用域里的表测试够不到 —— 钉不住的表等于没钉。
//
// 🔴 也不能反过来把它塞进 `scripts/tweaks.js`：那个文件是**送进浏览器**的（Customize 弹窗用它算
//    预览，`dashboard/vite.config.ts` §ai1st-tweaks-engine），而那个插件给它的是一份手写的两行
//    require 垫片 —— `requireMap` 里 `tweaks` 一项都没有 ⟹ 它多一个 `require('./themes')` 就会让
//    **dashboard 构建按名字报错**。本文件是 node-only，不在那条通路上。
//
// 📌 派生**加了盐**（`h('tweak:'+siteId)`，不是裸的 `h(siteId)`），而这一条我要说清它的分量，
//    因为它很容易被写成一句听起来很有道理的假话：
//
//    动机来自 `create-site.js` §骨 那段自己写下的纪律「皮和骨不能共用同一个索引」。**但我试着把
//    「盐买到了什么」量出来，失败了**：4096 个 siteId、按 `recipeIndex % 308` 分组，加盐版与裸哈希版
//    都是「308 组、每组内部的微扰都不止一种」—— **两个读数一模一样**，那个对照没有分辨力
//    （测试 §⑤ 现在把这个失败如实印出来，而不是假装它证明了什么）。
//    原因也清楚：`recipe` 只用 `h % 308`，而这三个数用的是 `h % 10`、`(h/10) % 9`、`(h/90) % 5`，
//    本来就不是同一个切片 —— 裸哈希今天也不会把两者绑在一起。
//
//    ⟹ 盐留着的理由降级为**结构性的**：它让「微扰」与「骨」不再是同一个数的两个切片，所以以后有人
//    改 `% 308` 那个模数（或改档位数）时，两者不可能突然对齐。它是一份不要钱的保险，**不是**一条
//    我量到过的改进。谁要拆掉它，拆的是这份保险，不会推翻任何读数。
//    （另一半是真的，但**只到哈希那一层为止**：`h(s) = h*31 + charCode` 对**定长**输入是仿射的，
//    所以 `h('tweak:'+s)` 只是把 `h(s)` 整体平移一个常数 —— 实测差值的种类数：定长 8 的 4096 个
//    id 是 **1** 种、定长 13 的 4096 个也是 **1** 种，而长度不齐的混在一起是 **7** 种（⟹「定长」
//    这个前提是承重的，不是修辞）。所以加盐既不多造也不消掉哈希之间的碰撞，它买到的只有「跟
//    `recipeIndex % 308` 不是同一个切片」这一条。
//    🔴 **别把它推到那三个数上。** 这里曾经许诺过「siteId 不同 ⟹ 派出来的三个数一定不同」，
//    那是假的（#1120 QA1 P2 抓到、QA3 加重、PM 复证）：双射过不了 `% 10 / % 9 / % 5`。判据和读数
//    在下面 `tweaksForSite` 头上那段。顺带那句话的前提也错了 —— 生产的 siteId 不是 8 个 hex 字符，
//    是 `site-` + 8 位 hex = **13 个**（`manager/db.go:1550` `siteIDPrefix`，#711 起冻结）。）
//
// 🔴 每一轴的取值表都**挖掉了中性点**，而这不是「稳妥一点」，是必须的：
//    `{hueShift:0, radiusScale:1, densityScale:1}` 时 `buildCustomCss` 返回空串 ⟹ `sync-config.js`
//    会**删掉** `site/custom.css`，产物与「从来没有过 tweaks 的站」逐字节相同。那个站是真的一点
//    微扰都没有，而且没有任何东西会报错（PM 在 #1120 裁定里量过这一格）。三轴全挖比「至少一轴
//    非中性」那种弱保证简单，也让「派出来必然有字节」成为一条按构造成立的性质。

'use strict';

const { validateTweaks, isNeutral } = require('../tweaks');
const { rotationIndexFromSiteId } = require('../themes');

/**
 * 每一轴的档位。10 × 9 × 5 = **450** 种组合。
 *
 * 🔴 写成**字面量表**而不是 `min + step*k` 算出来：`0.9 + 0.05*k` 在二进制里不精确，算到边界那一档
 * 可能落在 `TWEAK_BOUNDS` 外面一点点，而 `validateTweaks` 会把它判成不合法 —— 于是那个站静默地
 * 不带微扰。字面量没有这个失败方向，代价是改边界时要连这里一起改，而那件事由本模块的测试钉住。
 *
 * 📌 三轴的**可辨识度差得很远**，这解释了为什么不能只动一轴（读数出处 `tweaks.js` 文件头）：
 *   hueShift      83/83 套主题表都用 `var(--color-primary-*)` 取色 ⟹ 一动整个站跟着变，最显眼。
 *   radiusScale   80/83 套在用，但幅度是**乘法**：0.8–1.25 的**全程**在最小那一族（4px，20 套）
 *                 只有 **1.8px** —— 一个季度的主题上它基本看不出来。
 *   densityScale  80/83 套在用，真浏览器实测 0.9↔1.15 时 11 个块的 padding 拉开 16–22px。
 * ⟹ 视觉上的「不重样」主要由 hueShift 承担，另两轴是叠加，不是替代。
 */
const TWEAK_STEPS = {
  hueShift: [-15, -12, -9, -6, -3, 3, 6, 9, 12, 15],
  radiusScale: [0.8, 0.85, 0.9, 0.95, 1.05, 1.1, 1.15, 1.2, 1.25],
  densityScale: [0.9, 0.95, 1.05, 1.1, 1.15],
};

/** 取值表的键序 = 切片顺序。写死一份，别用 `Object.keys`（那把顺序交给了字面量的书写顺序）。 */
const AXES = ['hueShift', 'radiusScale', 'densityScale'];

/**
 * 给这个 siteId 派一组微扰 → `{hueShift, radiusScale, densityScale}`，或 `null`。
 *
 * **确定性**：同一个 siteId 算多少次都一样（发博客触发重建不许变脸）。没有运行时随机。
 *
 * 🔴 **反过来不成立：两个不同的 siteId【不保证】拿到不同的三元组。** 三张表一共只有
 * 10 × 9 × 5 = **450** 种组合，站数一过 450，鸽笼原理就保证必有两个站拿到**同一组微扰**
 * （注意是同一组微扰，不是「同皮」—— 同皮还要它们的主题也撞上，那是另一个因子）。实测（生产形状
 * `site-` + 8hex，10 万个 id）：哈希 100000 / 100000 互不相同，而三元组只有 **450 / 450** 种，
 * Σp²（随机两个站三元组相同的概率）= **0.002252 ≈ 1/444**（完全均匀是 1/450 = 0.002222，
 * 也就是分布基本没有热点：最热一格 268 次、最冷 163）。现成的反例：`site-0000004a` 与
 * `site-000000a4` 拿到的是同一组 `{hueShift:3, radiusScale:1.05, densityScale:0.9}`。
 *
 * ⟹ 这一层交付的性质是**确定性** + 给「两个站皮完全相同」乘上一个 **≈ 1/444** 的因子
 * （另一个因子是它们撞同一套主题的概率，那一半是 #1119 在管的，别在这里写死它今天多宽 ——
 * 两个因子相乘才是用户看得见的那个数）。**不是唯一性。** 谁拿「不同 siteId ⟹ 微扰一定不同」
 * 去写守卫或 AC，写出来的是一条恒会红的断言 —— 这段注释此前就是这么许诺的。
 *
 * 🔴 最后一步拿**引擎自己那把尺**收一次（`validateTweaks`）。不合法、或者算出来是中性点 ⟹ 回
 * `null`，调用方**整个键不写** = 本票之前的行为，站照样建得出来。这一支今天到不了（三张表都在
 * 边界内、都挖了中性点，本模块的测试逐档钉住），留着它是因为**失败方向**：把一个越界的值写进
 * `theme.json` 会让 `sync-config.js` 在容器里 `process.exit(1)`，那是拿整个站换一个偏移。
 */
function tweaksForSite(siteId) {
  let n = rotationIndexFromSiteId(`tweak:${siteId}`);
  const out = {};
  for (const key of AXES) {
    const steps = TWEAK_STEPS[key];
    out[key] = steps[n % steps.length];
    n = Math.floor(n / steps.length);
  }
  const problems = validateTweaks(out);
  if (problems.length || isNeutral(out)) {
    return { tweaks: null, why: problems.join(' · ') || '它是中性点', derived: out };
  }
  return { tweaks: out, why: '', derived: out };
}

module.exports = { TWEAK_STEPS, AXES, tweaksForSite };
