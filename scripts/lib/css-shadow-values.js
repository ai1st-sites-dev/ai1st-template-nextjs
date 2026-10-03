'use strict';

// ══════════════════════════════════════════════════════════════════════════════════════════════════
// css-shadow-values.js —— 一份（或几份合起来的）CSS 里，`box-shadow` 最终拿到的值是不是合法的（#1540）
// ══════════════════════════════════════════════════════════════════════════════════════════════════
//
// 🔴 为什么要有它：Webpixels 3.0.5 自己的 `_variables.scss` 把 `$box-shadow` 写成 `box-shadow-2`（少了 `$`），
//    编出来就是 `--x-box-shadow: box-shadow-2` —— 一个字面串。浏览器对它一个字都不说：自定义属性什么值都收，
//    到 `box-shadow: var(--x-box-shadow)` 那一步才在计算值阶段整条失效（= none）。`.btn:focus-visible` 那条更隐蔽：
//    它引用的 `--x-box-shadow-xs` 压根没人定义 ⟹ 同样整条失效，而 `outline: 0` 已经把浏览器的焦点环拿掉了。
//    `unstyled-class` 那类检查只问「这个类有没有规则」，看不见「规则的值是坏的」。
//
// ── 判法 ─────────────────────────────────────────────────────────────────────────────────────────
//   ① 收集每一份表里的自定义属性定义（同名多处定义 ⟹ 每一处都算一种可能）。
//   ② 每一条 `box-shadow:` 声明：把 `var()` 逐层代进去（每一种可能都代一遍），代完按 box-shadow 的语法判：
//        none | [ inset? && <length>{2,4} && <color>? ]#      （外加 inherit / initial / unset / revert 这几个全局词）
//      引用了一个**没人定义、也没写回落值**的变量 = 坏（浏览器里就是整条失效）。
//   ③ 名字本身就说「我是阴影」的自定义属性（`--x-box-shadow*` / `--x-*-box-shadow` / `--x-shadow-*`）：哪怕今天没人
//      引用，值也照 ② 判 —— 明天谁 `var()` 它，它就是下一个坏值。
//   `external` 是「这几份表之外、运行时由别处给值」的变量（`--color-*` 由 layout 的 `:root` / theme.css 给）：
//   代成一个占位色，不判它的值。
//
// 📌 只管 box-shadow 这一族（#1540 做什么 4 的射程）。别的属性要接进来，加一张语法表，判法不变。

const postcss = require('postcss');
const valueParser = require('postcss-value-parser');

// CSS Color 4 的具名色（含 transparent / currentcolor）。内联而不 require('color-name')：那是传递依赖，哪天上游换掉
// 它，这道检查就跑不起来；往 package.json 加依赖又会让站容器的 node_modules 缓存失效（每次建站 +2~3 分钟）。
const NAMED_COLORS = new Set((
  'aliceblue antiquewhite aqua aquamarine azure beige bisque black blanchedalmond blue blueviolet brown burlywood '
  + 'cadetblue chartreuse chocolate coral cornflowerblue cornsilk crimson cyan darkblue darkcyan darkgoldenrod darkgray '
  + 'darkgreen darkgrey darkkhaki darkmagenta darkolivegreen darkorange darkorchid darkred darksalmon darkseagreen '
  + 'darkslateblue darkslategray darkslategrey darkturquoise darkviolet deeppink deepskyblue dimgray dimgrey dodgerblue '
  + 'firebrick floralwhite forestgreen fuchsia gainsboro ghostwhite gold goldenrod gray green greenyellow grey honeydew '
  + 'hotpink indianred indigo ivory khaki lavender lavenderblush lawngreen lemonchiffon lightblue lightcoral lightcyan '
  + 'lightgoldenrodyellow lightgray lightgreen lightgrey lightpink lightsalmon lightseagreen lightskyblue lightslategray '
  + 'lightslategrey lightsteelblue lightyellow lime limegreen linen magenta maroon mediumaquamarine mediumblue '
  + 'mediumorchid mediumpurple mediumseagreen mediumslateblue mediumspringgreen mediumturquoise mediumvioletred '
  + 'midnightblue mintcream mistyrose moccasin navajowhite navy oldlace olive olivedrab orange orangered orchid '
  + 'palegoldenrod palegreen paleturquoise palevioletred papayawhip peachpuff peru pink plum powderblue purple '
  + 'rebeccapurple red rosybrown royalblue saddlebrown salmon sandybrown seagreen seashell sienna silver skyblue slateblue '
  + 'slategray slategrey snow springgreen steelblue tan teal thistle tomato turquoise violet wheat white whitesmoke yellow '
  + 'yellowgreen transparent currentcolor'
).split(' '));

const COLOR_FUNCTIONS = new Set(['rgb', 'rgba', 'hsl', 'hsla', 'hwb', 'lab', 'lch', 'oklab', 'oklch', 'color', 'color-mix', 'light-dark']);
const LENGTH_FUNCTIONS = new Set(['calc', 'min', 'max', 'clamp']);
const GLOBAL_KEYWORDS = new Set(['inherit', 'initial', 'unset', 'revert', 'revert-layer']);
const LENGTH = /^[+-]?(\d+\.?\d*|\.\d+)(e[+-]?\d+)?(px|rem|em|ex|ch|vw|vh|vmin|vmax|svw|svh|lvw|lvh|dvw|dvh|cm|mm|in|pt|pc|q|cqw|cqh|cqi|cqb|cqmin|cqmax)$/i;
const ZERO = /^[+-]?(0+\.?0*|\.0+)$/;
const HEX = /^#([0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/i;

/** 名字就说「我是阴影」的自定义属性。 */
const SHADOW_TOKEN_NAME = /^--x-(box-shadow(-[a-z0-9-]+)?|[a-z0-9-]+-box-shadow|shadow(-[a-z0-9-]+)?)$/;

/** 占位色：外部给值的变量代成它（只为让语法判得下去，不代表真值）。 */
const EXTERNAL_PLACEHOLDER = '#000';

/** 代入展开的上限：组合数爆了就停，并且报出来（不许静默当成「全过」）。 */
const MAX_EXPANSIONS = 2000;

/**
 * 一份 box-shadow 的值（已经没有 var() 了）合不合法。合法回 null，不合法回一句人话。
 */
function boxShadowProblem(value) {
  const v = value.trim();
  if (v === '') return '值是空的';
  const lower = v.toLowerCase();
  if (lower === 'none' || GLOBAL_KEYWORDS.has(lower)) return null;
  const layers = [[]];
  for (const n of valueParser(v).nodes) {
    if (n.type === 'div' && n.value === ',') { layers.push([]); continue; }
    if (n.type === 'space' || n.type === 'comment') continue;
    if (n.type === 'div') return `出现了不该有的分隔符 ${JSON.stringify(n.value)}`;
    layers[layers.length - 1].push(n);
  }
  for (const layer of layers) {
    if (layer.length === 0) return '有一层阴影是空的（多了一个逗号）';
    let inset = 0; let color = 0; let lengths = 0; let lengthRunEnded = false;
    for (const n of layer) {
      const word = n.type === 'word' ? n.value : null;
      const fn = n.type === 'function' ? n.value.toLowerCase() : null;
      const isLength = (word && (LENGTH.test(word) || ZERO.test(word))) || (fn && LENGTH_FUNCTIONS.has(fn));
      if (isLength) {
        if (lengthRunEnded) return `长度没有挨在一起：${JSON.stringify(valueParser.stringify(layer))}`;
        lengths += 1;
        continue;
      }
      if (lengths > 0) lengthRunEnded = true;
      if (word && word.toLowerCase() === 'inset') { inset += 1; continue; }
      const isColor = (word && (HEX.test(word) || NAMED_COLORS.has(word.toLowerCase()))) || (fn && COLOR_FUNCTIONS.has(fn));
      if (isColor) { color += 1; continue; }
      return `${JSON.stringify(valueParser.stringify(n))} 既不是长度、也不是颜色、也不是 inset`;
    }
    if (inset > 1) return '一层阴影里写了两个 inset';
    if (color > 1) return '一层阴影里写了两个颜色';
    if (lengths < 2 || lengths > 4) return `一层阴影要 2~4 个长度，读到 ${lengths} 个：${JSON.stringify(valueParser.stringify(layer))}`;
  }
  return null;
}

/** 收集自定义属性定义：name → [{ value, where }]（同值去重）。 */
function collectDefs(sheets) {
  const defs = new Map();
  for (const { name, css } of sheets) {
    postcss.parse(css).walkDecls((d) => {
      if (!d.prop.startsWith('--')) return;
      const list = defs.get(d.prop) || [];
      if (!list.some((x) => x.value === d.value.trim())) list.push({ value: d.value.trim(), where: `${name} ${selectorOf(d)}` });
      defs.set(d.prop, list);
    });
  }
  return defs;
}

function selectorOf(node) {
  const parts = [];
  for (let p = node.parent; p && p.type !== 'root'; p = p.parent) {
    parts.unshift(p.type === 'rule' ? p.selector.replace(/\s+/g, ' ') : `@${p.name} ${p.params}`);
  }
  return parts.join(' › ');
}

/**
 * 把 value 里的 var() 全部代掉。回 { values: [string], missing: [{ name, chain }], overflow: bool }。
 * chain 是从最外层到缺席那个变量的路径（报错时点名用）。
 */
function expand(value, defs, external, chain = []) {
  const parsed = valueParser(value);
  // 先序遍历 ⟹ 找到的是最外层那一个；嵌在函数里的（`rgba(var(--x), .5)`）也找得到
  let first = null;
  parsed.walk((n) => {
    if (!first && n.type === 'function' && n.value === 'var') first = n;
  });
  if (!first) return { values: [value], missing: [], overflow: false };
  return expandAt(parsed, first, defs, external, chain);
}

function expandAt(parsed, node, defs, external, chain) {
  const args = node.nodes;
  const nameNode = args.find((n) => n.type === 'word');
  const name = nameNode ? nameNode.value : '';
  const commaAt = args.findIndex((n) => n.type === 'div' && n.value === ',');
  const fallback = commaAt === -1 ? null : valueParser.stringify(args.slice(commaAt + 1)).trim();
  let candidates;
  const missing = [];
  if (chain.includes(name)) {
    // 循环引用：浏览器里也是失效
    return { values: [], missing: [{ name, chain: [...chain, name], cycle: true }], overflow: false };
  }
  if (defs.has(name)) {
    // 自定义属性写 `initial` = 「保证无效」⟹ var() 走回落值（Bootstrap 表格那条 `--x-table-bg-state: initial` 就是这么用的）；
    // `inherit` / `unset` / `revert` 的值来自父元素，这里判不了 ⟹ 跳过那一种可能（不报、也不当成合法值代进去）。
    candidates = [];
    for (const { value: dv } of defs.get(name)) {
      const kw = dv.toLowerCase();
      if (kw === 'initial') {
        if (fallback !== null) candidates.push(fallback);
        else missing.push({ name, chain: [...chain, name], initial: true });
      } else if (!GLOBAL_KEYWORDS.has(kw)) candidates.push(dv);
    }
  } else if (external.some((re) => re.test(name))) candidates = [EXTERNAL_PLACEHOLDER];
  else if (fallback !== null) candidates = [fallback];
  else return { values: [], missing: [{ name, chain: [...chain, name] }], overflow: false };

  const out = [];
  let overflow = false;
  for (const c of candidates) {
    const inner = expand(c, defs, external, [...chain, name]);
    missing.push(...inner.missing);
    overflow = overflow || inner.overflow;
    for (const iv of inner.values) {
      // 把这一个 var() 节点换成代入值，再把整串继续展开（剩下的 var()）
      const saved = { type: node.type, value: node.value, nodes: node.nodes };
      node.type = 'word'; node.value = iv; delete node.nodes;
      const replaced = valueParser.stringify(parsed.nodes);
      node.type = saved.type; node.value = saved.value; node.nodes = saved.nodes;
      const rest = expand(replaced, defs, external, chain);
      missing.push(...rest.missing);
      overflow = overflow || rest.overflow;
      for (const rv of rest.values) {
        if (out.length >= MAX_EXPANSIONS) { overflow = true; break; }
        out.push(rv);
      }
    }
  }
  return { values: [...new Set(out)], missing, overflow };
}

/**
 * 主入口。sheets = [{ name, css }]（合起来当成同一页上的几份表）。
 * 回 problems = [{ where, prop, value, why }]，空数组 = 全过。
 */
function findBoxShadowProblems(sheets, { external = [] } = {}) {
  const defs = collectDefs(sheets);
  const problems = [];
  const seen = new Set();
  const check = (where, prop, raw) => {
    const key = `${where}\u0000${prop}\u0000${raw}`;
    if (seen.has(key)) return;
    seen.add(key);
    const { values, missing, overflow } = expand(raw, defs, external);
    for (const m of missing) {
      const why = m.cycle ? `变量循环引用：${m.chain.join(' → ')}`
        : m.initial ? `${m.name} 有一处写成 initial（= 无效）而引用处没有回落值（${[prop, ...m.chain].join(' → ')}）`
          : `引用了没人定义、也没有回落值的 ${m.name}（${[prop, ...m.chain].join(' → ')}）`;
      problems.push({ where, prop, value: raw, why });
    }
    if (overflow) problems.push({ where, prop, value: raw, why: `var() 组合超过 ${MAX_EXPANSIONS} 种，没判完 —— 不许当成通过` });
    for (const v of values) {
      const why = boxShadowProblem(v);
      if (why) problems.push({ where, prop, value: raw, why: v === raw ? why : `代入后是 ${JSON.stringify(v)}：${why}` });
    }
  };
  for (const { name, css } of sheets) {
    postcss.parse(css).walkDecls((d) => {
      if (d.prop === 'box-shadow' || SHADOW_TOKEN_NAME.test(d.prop)) check(`${name} ${selectorOf(d)}`, d.prop, d.value.trim());
    });
  }
  return problems;
}

module.exports = { findBoxShadowProblems, boxShadowProblem, SHADOW_TOKEN_NAME };
