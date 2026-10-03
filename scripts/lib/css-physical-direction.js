'use strict';

// ══════════════════════════════════════════════════════════════════════════════════════════════════
// css-physical-direction.js —— 块的 CSS 里有没有写死左右（#1473 做什么 5）
// ══════════════════════════════════════════════════════════════════════════════════════════════════
//
// RTL 站只给 `site.css` 过 RTLCSS（`site-css.js`）。块的 CSS（`blocks/*/block.css` + `blocks/*/*/shape.css`，构建成
// `public/shapes.css`）在它之后单独加载、**不过 RTLCSS** ⟹ 块里写死的左右在 RTL 下不会被镜像。块的规矩是只写逻辑属性
// （`margin-inline-start` / `padding-inline-end` / `text-align: start` / `inset-inline-start` / `border-inline-start` …）。
// 守卫在 `scripts/block-css-logical.test.js`；判据只在这里写一份。
//
// 四维，每一维都是前面几维**按构造看不见**的那一类（#1473 正文两轮打回都是「前几维通过推不出后一维接上了」）：
//   A  带方向词缀的属性：margin-left / padding-right / text-align: left / float: right
//   B  行首裸 `left:` / `right:` —— 不带词缀，A 看不见。行首锚：不锚会把 margin-left / border-left-width 全吃进来
//      （与 A 重复、且误报）；块 CSS 里没有把 `{ … left: … }` 写成一行的规则，锚不漏（#1473 正文实读 0）。
//   C  border-left / border-right（含 -width / -color …）—— 分隔线，A、B 都看不见
//   D  四值 margin / padding 简写（第 2 位是右、第 4 位是左）—— **不解析数值，一律判红**：对称的那几行改成单边逻辑属性
//      同样零视觉变化，让守卫去比第 2、4 位等于在这里写一个 CSS 值解析器。带 `!important` 的也算。
// 🔴 **注释不算**：块的注释里会写到这些属性名（「别写 `margin-left`」这类说明）。按 `/* … */` 区间剔，不按行首 `/*`
//    剔 —— 多行注释的续行不以 `/*` 开头。剔的时候保留换行，报出来的行号仍是源文件的行号。

const DIMENSIONS = [
  { id: 'A', re: /margin-left|margin-right|padding-left|padding-right|text-align: ?left|text-align: ?right|float: ?left|float: ?right/,
    fix: 'margin-inline-start/end · padding-inline-start/end · text-align: start/end · float: inline-start/end' },
  { id: 'B', re: /^\s*(left|right)\s*:/, fix: 'inset-inline-start / inset-inline-end' },
  { id: 'C', re: /(^|[^-a-z])border-(left|right)\b/, fix: 'border-inline-start / border-inline-end' },
  { id: 'D', re: /(^|[^-a-z])(margin|padding)\s*:(\s+[^ ;{}]+){4}(\s*!important)?\s*;/,
    fix: '拆成 margin-block-start/end + margin-inline-start/end（padding 同理）' },
];

/** 把 `/* … *\/` 换成等长空白（换行留着），行号不动。没闭合的注释一直剔到文件尾（跟浏览器一样）。 */
function stripComments(css) {
  return css.replace(/\/\*[\s\S]*?(\*\/|$)/g, (m) => m.replace(/[^\n]/g, ' '));
}

/** 回 `[{ line, dim, text }]`，line 从 1 起；同一行命中两维各报一条。 */
function findPhysicalDirection(css) {
  const hits = [];
  const raw = css.split('\n');
  stripComments(css).split('\n').forEach((ln, i) => {
    for (const d of DIMENSIONS) if (d.re.test(ln)) hits.push({ line: i + 1, dim: d.id, text: raw[i].trim() });
  });
  return hits;
}

module.exports = { DIMENSIONS, stripComments, findPhysicalDirection };
