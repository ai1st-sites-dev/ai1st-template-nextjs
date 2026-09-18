// ══════════════════════════════════════════════════════════════════════════════════════════════════
// block-catalog.js — 「今天有哪些块、每个块有哪些形态」只算一次（#1343）
// ══════════════════════════════════════════════════════════════════════════════════════════════════
//
// 在这之前这件事在**三个地方各算各的**，三份实现读的还不是同一批字节：
//
//   `scripts/lib/block-manifest.js`            loadManifests() + shapePairsFromCss()  块 + 形态
//   `scripts/block-migration/gen-allblocks.js` 自己的正则打 registry.ts               只出块
//   `scripts/theme-css-invariants.mjs`         自己 readdirSync(blocks/)               块 + 形态
//
// 三份都是「数得出来」的，问题是它们**在同一天可以给出不同的答案**：注册表里多一个键而 blocks/ 里
// 没有它的 manifest，第二份会把它数进去、第三份看不见它、第一份要等到有人调 registryCoverage 才说话。
// 而那一格的失败方向是静默的 —— 某个块从此在图册上少一行、在几何守卫里少一组断言，页面照样打开。
//
// 🔴 **注册表是「有哪些块」的唯一权威，manifest 是「每个块有哪些形态」的唯一权威。** 两者对不上就
//    **抛**，不回一个残缺的清单：残缺的清单会让调用方各自少判一点而全都绿着。抛出来的那句话三处
//    一模一样（它们调的是同一个函数），所以「往 registry.ts 加一个假类型、不给它 manifest」这件事在
//    图册和几何守卫上读到的是同一条错。
//
// 🔴 **「读不出注册表」跟「注册表对不上」是两件事**，这里也分开：`registryCoverage` 拿不到
//    typescript 时回 `unavailable` 而不是空清单（理由在它自己那儿），本文件把它转成一句
//    「什么都没查」的错 —— 失败方向必须是「读数取不到」，不能是「清单是空的而大家都绿」。
'use strict';

const path = require('path');
const { loadManifests, registryCoverage, registryNames, layoutIntentFor } = require('./block-manifest');

const NEXT_DIR = path.resolve(__dirname, '..', '..');
/** 注册表 —— `sectionRegistry` 那张表的家。`registryCoverage` 用 TS 的 AST 读它的键，不是正则。 */
const REGISTRY_TS = path.join(NEXT_DIR, 'src', 'lib', 'sections', 'registry.ts');

/**
 * 全集：注册表里的每个块 × 它 manifest 里的每个形态。
 *
 * 回 `{ blocks, pairs, manifests }` —— 🔴 **结构只写在 `block-catalog.d.ts` 一份**（图册页是
 * TypeScript，得有类型；在这里再写一遍 `@returns {{…}}` 就是第二份，而且实测 `tsc` 从那一份里
 * 只推出了半个返回值）。
 *
 * 🔴 **每一对都带 `candidate`（#1384）** —— manifest 的 `shapes[i].candidate`，归一成布尔。候选 =
 * 过了全部机器检查、Chris 还没点头。**候选照样在这份清单里**：图册要画它、几何守卫要量它；它只是不许
 * 被挑上真站（两条堵法在 `theme-pipeline/shape-sheet.js` 与 `sync-config.js` §shapeForBlock）。
 * 🔴 **交接给 #1350**：点选检查器那个形态下拉要**过滤掉 `candidate === true` 的项** —— 候选进图册是给
 * Chris 看的，不是给站主挑的。#1384 只把这个读数摆出来，不碰 `dashboard/src/components/BlockInspector.tsx`。
 *
 * @param {object} [opts]
 * @param {string} [opts.registryPath]  默认 `src/lib/sections/registry.ts`
 * @param {string} [opts.blocksDir]     默认 `blocks/`（`loadManifests` 自己的默认值）
 * @throws 注册表与 manifest 对不上、或者根本读不出注册表时
 */
function blockShapeCatalog(opts) {
  const registryPath = (opts && opts.registryPath) || REGISTRY_TS;
  const blocksDir = opts && opts.blocksDir;
  const cov = registryCoverage(registryPath, blocksDir);
  if (cov.unavailable) {
    throw new Error(`block catalogue: ${cov.unavailable}`);
  }
  if (cov.missingManifest.length > 0 || cov.unknownBlock.length > 0) {
    throw new Error('block catalogue: 注册表与 blocks/ 对不上 ——'
      + ` 注册表里有而没有 manifest 的：${cov.missingManifest.join(' / ') || '（无）'};`
      + ` 有 manifest 而不在注册表里的：${cov.unknownBlock.join(' / ') || '（无）'}。`
      + ' 这两半必须逐个对上，否则「有哪些块」这个问题在不同的地方会有不同的答案。');
  }
  const manifests = loadManifests(blocksDir);
  // 🔴 顺序取注册表自己写的那个，不是 `cov.known` 那份排过序的 —— 那一份排序是为了做差集。
  //    `gen-allblocks.js` 写出的那一页的 section 顺序是**看得见的东西**（主题图册在拍它），
  //    换成字典序就是一次没人要的改动。
  const registryBlocks = registryNames(registryPath);
  // #1353 —— **外壳区也是块，也要上图册。** `header` / `footer` 有 manifest、有形态、有 shapes.css 的
  // 规则、在每套主题的选择单上各占一行 —— 跟别的 32 个块一模一样；它们唯一不同的地方是**不进页面
  // JSON**，所以按构造不在 `registry.ts` 里（那张表是「页面 JSON 的 type → 组件」）。
  // 🔴 只按 `registryNames` 取块，图册就会少掉它们，而那是静默的：页面照样打开、少两行没人会发现，
  //    而这两行恰恰是本票要让人看见的东西（#1353 AC4）。判据用 manifest 自己声明的 `region: true`，
  //    不推断 —— 同一条理由写在 `block-manifest.js` 的 `isRegionManifest` 上面。
  // 🔴 排在注册表那批**之后**，顺序不插队：上面那段注释说的「那一页的 section 顺序是看得见的东西」
  //    仍然成立，追加在末尾不会动已有的任何一行。
  const regionBlocks = [...loadManifests(blocksDir).values()]
    .filter((m) => m.region === true && !registryBlocks.includes(m.type))
    .map((m) => m.type);
  const blocks = [...registryBlocks, ...regionBlocks];
  const pairs = [];
  for (const block of blocks) {
    const m = manifests.get(block);
    for (const sh of m.shapes) {
      pairs.push({
        block,
        shape: sh.name,
        needs: Array.isArray(sh.needs) ? sh.needs.slice() : [],
        intent: layoutIntentFor(m, sh.name),
        // #1384 —— 候选身份跟着形态走。🔴 **候选照样进这份清单**：图册要画它、几何守卫要量它
        //    （`theme-css-invariants.mjs` 检查 ⑨ 从这里取 manifests），它只是不许被**挑**上真站。
        //    归一成布尔，消费者不用去判「有没有这个键」。
        // 🔴 交接给 #1350：形态下拉要过滤掉 `candidate === true` 的项（理由在 block-catalog.d.ts
        //    的那个字段上）。本票不碰 `BlockInspector.tsx`。
        candidate: sh.candidate === true,
      });
    }
  }
  return { blocks, pairs, manifests };
}

// ── 示例数据（图册那一个消费者用；#1343 做什么 #1）──────────────────────────────────────────────
//
// 🔴 判据只有一个来源：`blocks/<type>.json` 的 `slots`。**不读**组件的 TS 类型 —— 那是
//    `gen-allblocks.js` 走的另一条路，两套字节，而且对 contact-form / services-list / services-nav
//    三个块给不出任何读数（它们的 .tsx 里没有 `data: {` 可解析）。#1321 已经为同一个理由把
//    「可选与否」那个字段从那个工具里删掉了。
//
// 📌 这里原来还有一条「`kind: "variant"` 的槽一个都不填」。#1341 把 `slots.variant` 从**每一份**
//    manifest 里删掉了（`block-manifest.js:15-16` 原话），今天盘上的槽只有
//    text / link / list / image / object / flag 六种 —— 那条分支从此没有输入，连同它解释的那件事
//    一起去掉，免得下一个人以为盘上还有这种槽。
//
// 🔴 `shape` 这个字段是**写给建站 AI 看的提示**，不是一套语法，所以下面这个解析器是**容忍式**的：
//    认不出来的一律落回「按槽位名编一句话」，绝不抛 —— 图册少一句示例文案是看得见的，
//    而为了一句提示串把整页打死不是。
const PLACEHOLDER_IMAGE = '/images/grid-pattern.svg';

/** `{a, b}` / `[x, y]` 最外层的逗号切开（认括号嵌套，也认引号里的逗号）。 */
function topLevelParts(body) {
  const out = [];
  let depth = 0;
  let quote = '';
  let cur = '';
  for (const ch of body) {
    if (quote) {
      cur += ch;
      if (ch === quote) quote = '';
      continue;
    }
    if (ch === '"' || ch === "'") { quote = ch; cur += ch; continue; }
    if ('{[('.includes(ch)) depth++;
    if ('}])'.includes(ch)) depth--;
    if (ch === ',' && depth === 0) { if (cur.trim()) out.push(cur.trim()); cur = ''; continue; }
    cur += ch;
  }
  if (cur.trim()) out.push(cur.trim());
  return out;
}

const isQuoted = (s) => /^".*"$/s.test(s) || /^'.*'$/s.test(s);
const unquote = (s) => s.slice(1, -1);
const words = (name) => name.replace(/([a-z0-9])([A-Z])/g, '$1 $2').replace(/[-_]+/g, ' ').trim();
const titleOf = (name) => { const w = words(name); return w.charAt(0).toUpperCase() + w.slice(1); };

/** 按槽位/字段名编一个值。名字里带 href/image/icon 那几族有专门的落点，其余是一句话。 */
function byName(name, index) {
  const n = String(name || 'value');
  const suffix = index === undefined ? '' : ` ${index + 1}`;
  if (/^(href|url|link)$/i.test(n)) return '/';
  if (/icon/i.test(n)) return 'shield-check';
  if (/(image|img|photo|src|logo|avatar)/i.test(n)) return PLACEHOLDER_IMAGE;
  if (/^(rating|stars)$/i.test(n)) return 5;
  if (/^(reviews|count|number)$/i.test(n)) return 128;
  if (/^year$/i.test(n)) return '2024';
  if (/^date$/i.test(n)) return '2026-01-15';
  if (/^price$/i.test(n)) return '$99';
  if (/^(id|slug)$/i.test(n)) return `sample-${n.toLowerCase()}${suffix ? `-${index + 1}` : ''}`;
  if (/(html|body)$/i.test(n)) return `<p>${titleOf(n)}${suffix} — sample copy.</p>`;
  return `${titleOf(n)}${suffix}`;
}

/** `key`、`key?`、`key: hint`、`key?: hint` → { key, hint }。 */
function fieldSpec(part) {
  const i = part.indexOf(':');
  if (i < 0) return { key: part.trim().replace(/\?$/, ''), hint: undefined };
  return {
    key: part.slice(0, i).trim().replace(/^["']|["']$/g, '').replace(/\?$/, ''),
    hint: part.slice(i + 1).trim(),
  };
}

function synthObject(spec, index) {
  const out = {};
  for (const part of topLevelParts(spec)) {
    const { key, hint } = fieldSpec(part);
    if (!key) continue;
    out[key] = synth(key, hint, index);
  }
  return out;
}

/**
 * 一个值。`hint` 是 manifest 里那段 `shape` 提示（可能没有）。
 * `index` 有值时表示「这是列表里第 index 项」，用来让三项不至于一模一样。
 */
function synth(name, hint, index) {
  const h = typeof hint === 'string' ? hint.trim() : '';
  if (!h) return byName(name, index);
  if (isQuoted(h)) return unquote(h);
  if (h === 'true') return true;
  if (h === 'false') return false;
  if (/^(bool|boolean)$/i.test(h)) return true;
  if (/^-?\d+(\.\d+)?$/.test(h)) return Number(h);
  if (/^(string|text)$/i.test(h)) return byName(name, index);
  if (h.startsWith('{') && h.endsWith('}')) return synthObject(h.slice(1, -1), index);
  if (h.startsWith('[') && h.endsWith(']')) {
    const inner = h.slice(1, -1).trim();
    if (!inner) return [0, 1, 2].map((i) => byName(name, i));
    const parts = topLevelParts(inner);
    // 🔴 一格 = 一份「规格」，多格 = 一串「例子」。`[{title, description}]` 是前者（造三项），
    //    `["ASAP","Within 1 week",…]` 和 `[{label:"Home", href:"/"}, {label:"<Page Name>"}]`
    //    是后者（原样用）—— 后者按规格去造会把人家写好的那串例子丢掉。
    if (parts.length > 1) return parts.map((p, i) => synth(name, p, i));
    const one = parts[0];
    if (one.startsWith('{') && one.endsWith('}')) {
      return [0, 1, 2].map((i) => synthObject(one.slice(1, -1), i));
    }
    if (/^(string|text)$/i.test(one)) return [0, 1, 2].map((i) => byName(name, i));
    if (isQuoted(one)) return [unquote(one)];
    // `[3-4]` / `[5]` / `[6 brand name strings]` —— 说的是「几项」，不是「什么形状」。
    return [0, 1, 2].map((i) => byName(name, i));
  }
  return byName(name, index);
}

/**
 * 一个块的示例 `data`。
 *
 * @param {object} manifest              `blocks/<type>.json` 读进来的那份
 * @param {object} [opts]
 * @param {boolean} [opts.minimal]       只填必填槽（图册「最少版」那一列；#1337 那条空色带就是这么漏的）
 */
function sampleDataFor(manifest, opts) {
  const minimal = !!(opts && opts.minimal);
  const out = {};
  for (const [slot, spec] of Object.entries((manifest && manifest.slots) || {})) {
    if (!spec) continue;
    if (minimal && spec.required !== true) continue;
    if (spec.kind === 'image' && !spec.shape) { out[slot] = PLACEHOLDER_IMAGE; continue; }
    if (spec.kind === 'flag' && !spec.shape) { out[slot] = true; continue; }
    if (spec.kind === 'list' && !spec.shape) { out[slot] = [0, 1, 2].map((i) => byName(slot, i)); continue; }
    out[slot] = synth(slot, spec.shape, undefined);
  }
  return out;
}

module.exports = {
  blockShapeCatalog,
  sampleDataFor,
  REGISTRY_TS,
  PLACEHOLDER_IMAGE,
};
