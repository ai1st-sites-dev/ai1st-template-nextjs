// ══════════════════════════════════════════════════════════════════════════════════════════════════
// skeleton-distance.js — 两套主题的**骨架**差几块（#1173，spec 附四 / 规则 2 的第五道闸用的那把尺）
// ══════════════════════════════════════════════════════════════════════════════════════════════════
//
//   距离 = 9 块里「这两份表画得不一样」的块数。0 = 骨架一模一样，9 = 每块都不一样。
//
// ══ 为什么要有这把尺 ═══════════════════════════════════════════════════════════════════════════════
// 池子要扩（#1174 地产/保险各到 ≥20），而生成器批量产新货时，「只差颜色字体的双胞胎」会悄悄回来 ——
// 三周前「80 套只有 12 种形状」就是没人守这一维。第③道闸（`gates.js` 的 `gateSimilarity`）读的是
// tokens 和 layout，管的是「气质相近」；这把尺读的是**表里的规则**，管的是「骨架双胞胎」。两者互补，
// 不互相替代。
//
// ══ 🔴 口径：剥颜色，只看骨架 ═════════════════════════════════════════════════════════════════════
// PM 2026-08-24 裁定：**「一深一浅」算同一个形状**。要治的病是形状太少，而深浅不增加形状。代价说在
// 明处：扩容时与既有形状只差颜色的新候选会被拒 —— 那正是它该做的事。要「同一形状的深浅两版」得写
// 具名例外 + 理由，不是放松这把尺。
// 交叉对照（#1173 正文证据③，我复算过）：不剥颜色再算一遍，3160 对里 ≤3 的**一对都没有**、最小是 4
// ⟹ 今天那 5 对贴线的对子差的正是颜色。
//
// ══ 🔴 这份归一化【是】口径定义本身，不是它的一个实现 ══════════════════════════════════════════════
// 票的正文（#1173 证据②）给了一段 Python 参考实现，AC2 拿它标定。这个文件必须**等价**于它，而
// 「等价」是一个实测出来的读数、不是一句断言：`skeleton-distance.test.js` 把这里算出来的每块指纹的
// **分组**跟那段参考实现在同一份 80 套表上逐块比对。
//
// 下面每一条都是那段参考实现的一部分，逐条抄的理由写在旁边 —— 它们看起来都像「随便定的」，而其中
// 两条如果按直觉写就会得到另一把尺：
//
//   ① 只认**光秃秃的块 class**（`.hero`、`.hero:hover`、`.hero > x`），**不认元素钩子**
//      （`.hero__title`）。判据是 `\.hero\b`，而 `__` 里的下划线是 word 字符 ⟹ `\b` 在那里不成立。
//      🔴 直觉写法（把 `.hero__title` 也算给 hero）会得到**另一把尺**：那样每块收进去的规则多好几倍,
//      正文那组标定读数（5 对 ≤3）一个都对不上。要改这一条得先重定基 AC2 的标定集。
//      📌 同一条判据的另一面：`.hero-media-left` **算** hero（`-` 是非 word 字符 ⟹ `\b` 成立）。
//   ② `@media` 是**展平**的：里面的规则跟外面的规则进同一个池子，不带媒体条件。所以「同一条规则搬进
//      /搬出 @media」在这把尺下不算形状变化。
//   ③ 声明**排序后**再拼指纹 ⟹ 只调声明顺序不算形状变化。
//   ④ 颜色/字体的**值**换成占位符（属性名匹配 COLOR_PROPS 或值里出现色值字面/`var(--color-*)`）。
//      属性名保留 ⟹ 「多写了一条 background」算形状变化，「background 换了个色」不算。
const crypto = require('crypto');
const postcss = require('postcss');

/** 9 块高曝光块。今天它们在 83/83 张表里都有规则，而这一点每次跑都要重新量一遍（见 §selfCheck）。 */
const SKELETON_BLOCKS = [
  'hero', 'cta-banner', 'contact-form', 'page-header', 'faq-accordion',
  'testimonials', 'process-steps', 'card-group', 'contact-info',
];

// 🔴 上一版这张清单里的 `benefits-list` 今天已经不存在（#1162 `9b789650` 把它和 `values-grid` /
//    `checklist` / `service-highlights` 整层退役）。拿老清单在今天的表上跑，那一维 80 套读到同一个
//    指纹（空集的哈希）—— **一组对照全读到同一个值，就是那一维没在量东西** —— 距离被整体压低 1。
//    这就是 §selfCheck 存在的理由：它不是锦上添花，它是这把尺自己的体检。
const MIN_DISTANCE = 3;

const COLOR_PROPS = /^(color|background|background-[a-z-]+|border[a-z-]*-color|fill|stroke|font|font-family)$/;
const COLOR_VAL = /#[0-9a-fA-F]{3,8}|rgba?\([^)]*\)|hsla?\([^)]*\)|var\(--color-[^)]*\)/;
const collapse = (s) => String(s).trim().split(/\s+/).join(' ');
const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * 一份表在 9 块上各画了哪些规则。返回 `{ <块>: Set<规则文本> }`。
 * 抛异常 = 这份表解析不了；调用方按「量不到」处理，不许当成「没有规则」。
 */
function rulesByBlock(css, blocks = SKELETON_BLOCKS) {
  const out = new Map(blocks.map((b) => [b, new Set()]));
  // 每块一条正则，建一次用到底。见文件头 ①：`\b` 让 `.hero__title` 落在外面。
  const hooks = blocks.map((b) => ({
    block: b, re: new RegExp(`\\.${escapeRe(b)}\\b`), attr: `[data-block="${b}"]`,
  }));
  // postcss 只 walk 规则，注释是另一种节点 ⟹ 注释天然不参与（参考实现里那句「剥注释」）。
  // walkRules 也会走进 @media 里面，而它给的 `rule.selector` 不带媒体条件 ⟹ 天然就是「展平」。
  postcss.parse(css).walkRules((rule) => {
    const sel = collapse(rule.selector);
    if (!sel || sel.startsWith('@')) return;
    const decls = [];
    for (const node of rule.nodes || []) {
      if (node.type !== 'decl') continue;
      const prop = collapse(node.prop);
      let value = collapse(node.value);
      // `!important` 在参考实现里是值的一部分（它按 `;` 切、按第一个 `:` 分），postcss 把它拆成
      // 一面旗子 ⟹ 拼回去，否则两把尺在带 `!important` 的表上会分叉。
      // 📌 今天 83 份表里 `!important` 出现 0 次，所以这一行今天不承重 —— 写它是因为它**便宜**，
      //    而它不在时的失败方向是静默的（两把尺各自都自洽，只是不再是同一把）。
      if (node.important) value += ' !important';
      if (COLOR_PROPS.test(prop) || COLOR_VAL.test(value)) value = '‹X›';
      decls.push(`${prop}:${value}`);
    }
    const text = `${sel}{${decls.sort().join(';')}}`;
    for (const h of hooks) {
      if (h.re.test(sel) || sel.includes(h.attr)) out.get(h.block).add(text);
    }
  });
  return out;
}

/** 一份表的骨架指纹：`{ <块>: <12 位十六进制> }`。空集也有指纹（见 §selfCheck 为什么这很重要）。 */
function fingerprintSheet(css, blocks = SKELETON_BLOCKS) {
  const byBlock = rulesByBlock(css, blocks);
  const fp = {};
  for (const b of blocks) {
    const sorted = [...byBlock.get(b)].sort();
    // sha256 而不是任何进程内哈希：指纹要能被任何人在任何进程里复算出同一个值。
    fp[b] = crypto.createHash('sha256').update(sorted.join('\n')).digest('hex').slice(0, 12);
    // 空集的指纹是一个确定值，而它对每份表都一样 —— 「这一维死了」的签名就是它。
  }
  fp.__empty = blocks.filter((b) => byBlock.get(b).size === 0);
  return fp;
}

/** 距离 = 指纹不同的块数。 */
function distance(a, b, blocks = SKELETON_BLOCKS) {
  return blocks.reduce((n, x) => n + (a[x] !== b[x] ? 1 : 0), 0);
}

/** 不同的是哪几块（按 `blocks` 的顺序，读数可复算）。 */
function differingBlocks(a, b, blocks = SKELETON_BLOCKS) {
  return blocks.filter((x) => a[x] !== b[x]);
}

/**
 * 🔴 这把尺自己的体检 —— 防「一维已死而闸照跑」（#1173 AC3）。
 *
 * 对一组指纹逐块报两个数：
 *   empty    这一块「一条规则都没有」的表数。>0 ⟹ 那些表在这一维上是空集，距离里这一维不说话。
 *   distinct 这一块的不同指纹个数。==1 ⟹ 全组读到同一个值。
 *
 * `bad` 是「有问题的块」清单，调用方据它决定拒跑。
 *
 * 🔴🔴 **`bad` 里 `distinct === 1` 那一条【不许】被调用方当成拒跑的判据。** 我第一版就是那么用的，
 *    真机端到端跑第一次就被自己咬了：`--pool new` 那条路上一批只有两套候选，而它们正是一对骨架
 *    双胞胎（同一份表）—— 于是 9 块**全部** distinct=1，闸把「这一批有双胞胎」这个**发现本身**
 *    报成了「尺子坏了，拒跑」（真机读数：那一套打的是「没量成」，而它该打「停在⑤」）。
 *    ⟹ 在小语料上，`distinct === 1` 说不出「这一维死了」和「这几套恰好在这一块上一样」的区别。
 *    「这个块名今天还活着吗」根本不该问语料 —— 它是**契约**的性质，判据是 `theme-css-lint.js` 的
 *    `HOOK_CLASSES`（`gates.js` 的 ⑤ 那一节就是这么问的，那里也写着为什么）。
 *    这个函数因此只出**读数**：逐块的 empty / distinct，让人读得见那一维当时有没有在量东西。
 */
function selfCheck(fingerprints, blocks = SKELETON_BLOCKS) {
  const fps = Object.values(fingerprints);
  const perBlock = blocks.map((b) => {
    const empty = fps.filter((f) => (f.__empty || []).includes(b)).length;
    const distinct = new Set(fps.map((f) => f[b])).size;
    return { block: b, empty, distinct };
  });
  // 🔴 两种「这一维可能没在量东西」分开返回，因为调用方对它们的处置**相反**：
  //    emptyBlocks   这一块在某几份表里一条规则都没有 ⟹ 那几份表的这一维是空集。可拒跑。
  //    uniformBlocks 全组同一个指纹。**只是读数，不许当判据** —— 见上面那段 🔴🔴。
  //    一份表的时候 distinct 必然是 1，那是算术不是读数，所以 `corpus` 一起返回。
  const emptyBlocks = perBlock.filter((r) => r.empty > 0).map((r) => r.block);
  const uniformBlocks = perBlock.filter((r) => r.distinct === 1).map((r) => r.block);
  return {
    corpus: fps.length, perBlock, emptyBlocks, uniformBlocks,
  };
}

const selfCheckText = (r) => r.perBlock
  .map((x) => `${x.block} empty=${x.empty} distinct=${x.distinct}`).join(' · ');

module.exports = {
  SKELETON_BLOCKS,
  MIN_DISTANCE,
  rulesByBlock,
  fingerprintSheet,
  distance,
  differingBlocks,
  selfCheck,
  selfCheckText,
};
