// ══════════════════════════════════════════════════════════════════════════════════════════════════
// demo-content/index.js — 「这个块拿什么内容画」只算一处（#1383）
// ══════════════════════════════════════════════════════════════════════════════════════════════════
//
// 在这之前图册每一格的数据是 `block-catalog.js` 的 `sampleDataFor()` 现编的：槽位名转成标题大小写
// （`Headline` / `Subheadline` / `Label`），图一律是 `/images/grid-pattern.svg` 的色块，列表槽一律
// 三项、三项等长。那份东西回答得了「这个块渲染得出来吗」，回答不了本票要问的那个问题 ——
// **这个形态排得好不好看**。三个等长的占位串在 `three-up` 和 `four-up-tight` 上长得一模一样。
//
// 🔴 **`sampleDataFor()` 没有删**：它是 `block-catalog.js` 的导出，守卫 (c) 的真阳对照就是拿它的
//    输出喂的（`trusted-brands/brands` 实发 3 项且三项等长，两个条件各踩一个）。删了它那格对照就没了。
//
// ── 三条判据在这里定义，守卫和内容包共用同一份 ────────────────────────────────────────────────
// 🔴 `isListSlot` / `declaredMinItems` / `itemTextLength` **只写一遍**。守卫拿它们判，
//    `demoDataFor` 也拿它们判 —— 两边各写一份的话，分歧那天两边都不会红
//    （本仓为这个形状付过账：`theme-css-invariants-sample-pages.js` 里那条「两把尺的并集」）。
'use strict';

const { DEMO_CONTENT, SITE } = require('./content');
const { IMAGES, imageUrl } = require('./images');

/**
 * 这个槽是不是一份列表 —— **两把尺的并集**，不是任选一把。
 * 盘上真的不一致，今天 3 处（现取）：`footer/columns` · `footer/social` · `header/menu` 的 `kind`
 * 都写的是 `"links"`，而 `shape` 是 `[…]`。只看 `kind` 会把它们全漏掉。
 * 同一条判据 `theme-css-invariants-sample-pages.js` 也有一份（它的注释里记着同族的反例）。
 */
function isListSlot(spec) {
  if (!spec) return false;
  return spec.kind === 'list'
    || (typeof spec.shape === 'string' && spec.shape.trim().startsWith('['));
}

/**
 * 这个槽的 shape 有没有**自己写着要几项**，有就回那个数，没有回 null。
 *
 * 认的是 `[6 brand name strings]` / `[3-4]` / `[5]` 这一族 —— 方括号开头紧跟一个数字。
 * `block-catalog.js:198` 那行注释就是在解释这件事（「说的是『几项』，不是『什么形状』」）。
 * 🔴 `["ASAP","Within 1 week",…]` **不算**：那是一串例子，不是一个条数。
 * 🔴 **不新加 `minItems` 字段**：那个数今天已经写在 shape 里了，新开一个字段要逐块回填，
 *    而空着的时候守卫恒绿（#1383 PM 在 r1 裁定里量过：`minItems` 全树 0 处）。
 */
function declaredMinItems(spec) {
  if (!spec || typeof spec.shape !== 'string') return null;
  const m = /^\[\s*(\d+)/.exec(spec.shape.trim());
  return m ? Number(m[1]) : null;
}

/**
 * 一个字符串是不是一个**地址**（而不是给人读的文字）。
 * `https://…` / `data:…` / `tel:` / `mailto:` / `/services/brakes` 这几族。
 */
const isAddress = (s) => /^(https?:|data:|tel:|mailto:|#|\/)/.test(s);

/**
 * 一个条目的「文字长度」—— 给人读的那些字有多少个。
 * 字符串条目就是它自己的长度；对象条目是它所有字符串叶子的长度之和。
 *
 * 🔴 **地址不算文字**（`href` / `url` / `imageUrl` 这些）。理由是守卫 (c) 的第二半要量的是
 *    「条目有长有短吗」—— 那是**排版**的问题，而一条 URL 有多少个字符跟排版无关：面包屑里
 *    `{label:"Home", href:"/"}` 和 `{label:"Brakes, rotors and callipers", href:"/services/…"}`
 *    的差别在 label 上，不在 href 上。把地址算进来会让一串长得差不多的 CDN 地址把真正的差别抹平。
 * 🔴 数字和布尔也**不计**：`rating: 5` / `highlighted: true` 不是给人读的文字。
 *
 * 🔴 **代价写在明处**：条目**只有**地址的那种 list 槽，每一项都量到 0，于是「最长 ≥ 最短的
 *    2 倍」在那一格退化成 `0 >= 0`、恒真。守卫不会假装它查过：`guardC` 把这种槽单独列出来印一行
 *    「没有文字可量」，≥ 6 项那一半照旧真查。
 *    📌 今天这种槽**一处都没有**（`demo-content.test.js` ② 段那行印的就是这个集合，现在是空的）。
 *    它的来历是 `logo-carousel/logos`（一串图片地址），而那个块 2026-09-17 已被 #1375 删掉 ——
 *    这一段留着，是因为下一个往包里写地址列表的人会重新踩进来。
 */
function itemTextLength(item) {
  if (typeof item === 'string') return isAddress(item) ? 0 : item.length;
  if (!item || typeof item !== 'object') return 0;
  let n = 0;
  for (const v of Object.values(item)) {
    if (typeof v === 'string') n += isAddress(v) ? 0 : v.length;
    else if (v && typeof v === 'object') n += itemTextLength(v);
  }
  return n;
}

/** 这个块在内容包里那一份（原样，不复制）。块不在包里就抛 —— 少一个块是静默失败。 */
function demoContentFor(type) {
  const c = DEMO_CONTENT[type];
  if (!c) {
    throw new Error(`demo-content: 没有 "${type}" 的演示内容 —— `
      + `包里有 ${Object.keys(DEMO_CONTENT).length} 个块，缺的这个要补进 scripts/lib/demo-content/content.js`);
  }
  return c;
}

/** 深拷贝，让调用方可以随手改（夹具页就在改 items[2].imageUrl）而不污染包本身。 */
const clone = (v) => (v === undefined ? undefined : JSON.parse(JSON.stringify(v)));

/**
 * 一个块的演示 `data`。**签名跟 `sampleDataFor` 一样**（吃 manifest 对象，不是块名），
 * 所以调用点是一行替换。
 *
 * @param {object} manifest          `blocks/<type>.json` 读进来的那份
 * @param {object} [opts]
 * @param {boolean} [opts.minimal]   只填必填槽（图册「最少版」那一列）
 *
 * @throws 全填版下某个槽位在包里没有值 —— 🔴 **不静默跳过**：跳过的后果是图册上少画一个零件，
 *         而页面照样打开。守卫 (a) 会在 CI 里先一步点名，这里是运行时的那一道。
 */
function demoDataFor(manifest, opts) {
  const minimal = !!(opts && opts.minimal);
  const type = manifest && manifest.type;
  const content = demoContentFor(type);
  const out = {};
  const missing = [];
  for (const [slot, spec] of Object.entries((manifest && manifest.slots) || {})) {
    if (!spec) continue;
    if (minimal && spec.required !== true) continue;
    if (!(slot in content)) { missing.push(slot); continue; }
    out[slot] = clone(content[slot]);
  }
  if (missing.length) {
    throw new Error(`demo-content: "${type}" 缺了槽位 ${missing.join(' / ')} 的演示内容`);
  }
  return out;
}

module.exports = {
  DEMO_CONTENT,
  SITE,
  IMAGES,
  imageUrl,
  demoContentFor,
  demoDataFor,
  isListSlot,
  declaredMinItems,
  itemTextLength,
  isAddress,
};
