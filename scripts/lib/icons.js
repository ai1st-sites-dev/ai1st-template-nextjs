'use strict';

// ══════════════════════════════════════════════════════════════════════════════════════════════════
// icons.js —— 图标名 → 内联 SVG（#1462；替掉 #1424 那条 Bootstrap Icons 字体路）
// ══════════════════════════════════════════════════════════════════════════════════════════════════
//
// 槽位契约里 `icon` 是一个 Bootstrap Icons 的名字（`house-door`）。以前它变成 `<i class="bi bi-house-door">`，
// 靠 `site.css` 里编进去的图标字体画；Chris 2026-09-27 拍板「不引字体」：构建时按名读
// `node_modules/bootstrap-icons/icons/<名>.svg`，渲染成 `<svg>`（`src/components/InlineIcon.tsx`）。
//
// 🔴 只在服务端跑（读文件）。块的 Section 是 `'use client'`（抽屉的 useState），读不了文件 ⟹ 服务端
//    （今天是单格页 `page.dev.tsx`，T3 接回 SiteShell 时是站的构建）先按数据里出现的名字查好一张表，
//    当 prop 传进去。
// 🔴 包在 devDependencies 里是够的：站容器装依赖（`worker/Dockerfile` 的 `npm ci`、`worker/entrypoint.sh`
//    的 `npm install`）都不带 `--omit=dev`（PM #1462 r2 量过）。别把它挪进 dependencies —— 那会让站容器
//    的 node_modules 缓存整份失效。
// 🔴 名字不存在 ⟹ 表里没有这一项、组件不渲染，并且这里打一行 `console.warn`（票正文：「图标名不存在时
//    不渲染、构建打一行日志」）。名字只认 `[a-z0-9-]`：它会拼进路径。

const fs = require('fs');
const path = require('path');

// 🔴 两个候选、取第一个在的：这份 CJS 被打进 Next 的服务端包之后 `__dirname` 指向 `.next/server/...`
//    （#1404 踩过，`/__catalog` 的 CATALOG_PATHS 同一个坑），那时要从 `process.cwd()`（= 模板根）找；
//    node 直接跑（测试、sync-config）时 `__dirname` 是对的，而 cwd 不一定是模板根。
const ICON_REL = path.join('node_modules', 'bootstrap-icons', 'icons');
const ICON_DIR = [path.resolve(__dirname, '..', '..', ICON_REL), path.join(process.cwd(), ICON_REL)]
  .find((d) => fs.existsSync(d)) || path.resolve(__dirname, '..', '..', ICON_REL);
const NAME = /^[a-z0-9-]+$/;

/** 一个名字 → `{ viewBox, body }`（`<svg>` 外壳自己画，只取里面那几条 path）；查不到回 null。 */
function readIcon(name, { dir = ICON_DIR, warn = console.warn } = {}) {
  if (typeof name !== 'string' || !NAME.test(name)) {
    warn(`[icons] 图标名 ${JSON.stringify(name)} 不合法（只认 a-z 0-9 -），不渲染`);
    return null;
  }
  let src;
  try {
    src = fs.readFileSync(path.join(dir, `${name}.svg`), 'utf-8');
  } catch {
    warn(`[icons] bootstrap-icons 里没有「${name}」，不渲染`);
    return null;
  }
  const m = src.match(/<svg\b([^>]*)>([\s\S]*?)<\/svg>/);
  const vb = m && m[1].match(/viewBox="([^"]+)"/);
  if (!m || !vb) {
    warn(`[icons] ${name}.svg 解析不了，不渲染`);
    return null;
  }
  return { viewBox: vb[1], body: m[2].trim() };
}

/** 数据里每一个叫 `icon` 的字符串值（槽位契约：它就是图标名）。 */
function iconNamesIn(value, out = new Set()) {
  if (Array.isArray(value)) { for (const v of value) iconNamesIn(v, out); return out; }
  if (value && typeof value === 'object') {
    for (const [k, v] of Object.entries(value)) {
      if (k === 'icon' && typeof v === 'string') out.add(v);
      else iconNamesIn(v, out);
    }
  }
  return out;
}

/**
 * 块组件自己点名的图标（不来自数据）：header-new 的汉堡 / 关闭 / 电话，footer-new 联系信息那几个，
 * 以及社交链接没写图标时的兜底。改组件里的字面名要同步这里 —— 漏了的失败方向是可见的：那个图标不画，
 * 且 `icons.test.js` 会逐个核「组件里写的字面名都在这张表里」。
 */
const BLOCK_ICONS = {
  'header-new': ['list', 'x-lg', 'telephone', 'link-45deg'],
  'footer-new': ['telephone', 'geo-alt', 'clock', 'envelope', 'link-45deg'],
  // #1475 —— 按钮的箭头（`arrow: true`）。项目的图标来自数据（`items[].icon`），由 §iconNamesIn 收，不写在这里。
  'features-new': ['arrow-right'],
  // #1482 —— 同 features-new：块头按钮的箭头；stats 的图标来自数据（`stats[].icon`），由 §iconNamesIn 收。
  milestones: ['arrow-right'],
  // #1487 —— 招聘卡的图标圈（person-plus）+ 它按钮的箭头（`join.cta.arrow`）。成员链接的图标来自数据（`members[].links[].icon`），
  //    由 §iconNamesIn 收 —— 所以那个字段必须叫 `icon`。
  'team-new': ['person-plus', 'arrow-right'],
  // #1489 —— contact items 五种 kind 的图标（同 footer-new 那五个）+ 地图地址卡上的钉子。
  'contact-new': ['telephone', 'envelope', 'geo-alt', 'clock', 'link-45deg', 'geo-alt-fill'],
  // #1483 —— 功能清单每行的勾号；highlights 的图标来自数据（`highlights[].icon`），由 §iconNamesIn 收。
  'pricing-new': ['check'],
  // #1488 —— 星级（每条 n 颗实心 + 空心补到 5 颗；总评分按 0.5 取整会用到半星）和轮播的前 / 后箭头，都是组件里写死的名字。
  'testimonials-new': ['star-fill', 'star-half', 'star', 'chevron-left', 'chevron-right'],
  // #1484 —— 问答的开合图标（itemToggle：chevron = chevron-down；plus = plus + dash，展开时换着显示）+ help 卡按钮的箭头。
  'faq-new': ['chevron-down', 'plus', 'dash', 'arrow-right'],
};

/**
 * #1475 —— 这个块的组件画不画服务端查好的图标表：`BLOCK_ICONS` 里有它这一行 = 画（那一行可以是空数组 ——
 * 组件没写死任何名字、图标全来自数据的块也要登记一行）。老块（`ServiceIcon` 那一套）不在这里，
 * 它们数据里的 `icon` 是另一套图标的名字，拿来查 bootstrap-icons 只会刷一排「查不到」。
 */
function usesIconTable(block) {
  return typeof block === 'string' && Object.prototype.hasOwnProperty.call(BLOCK_ICONS, block);
}

/**
 * #1475 —— 一页的块 → 与之逐项对齐的图标表数组（给 `SectionRenderer` 的 `iconTables`）：用图标表的块给它那一张，
 * 别的块给 `undefined`（不往它们身上多挂一个 prop —— 老页面的产物一个字节不变）。只在服务端调（读文件）：
 * 真站的 HomePage / SubPage、单格页。
 * @returns {Array<Record<string, { viewBox: string, body: string }> | undefined>}
 */
function iconTablesFor(blocks, opts) {
  return (Array.isArray(blocks) ? blocks : []).map((b) => (b && usesIconTable(b.type) ? iconTableFor(b.type, b.data, opts) : undefined));
}

/** 一个块 + 它的数据 → 这次渲染要用到的整张图标表 `{ 名: { viewBox, body } }`。 */
function iconTableFor(block, data, opts) {
  const names = new Set([...(BLOCK_ICONS[block] || []), ...iconNamesIn(data)]);
  const out = {};
  for (const n of [...names].sort()) {
    const icon = readIcon(n, opts);
    if (icon) out[n] = icon;
  }
  return out;
}

module.exports = { readIcon, iconNamesIn, iconTableFor, iconTablesFor, usesIconTable, BLOCK_ICONS, ICON_DIR };
