// #998 — 页面内容层的形状：`sections` 数组 → `blocks`。
//
// 这个文件是**两个 node 脚本共用的一份实现**：`create-site.js` 写页面 JSON 时用它把 AI 产出的
// 那份 `sections` 转成 blocks，`sync-config.js` 构建时用它把磁盘上的页面（新老两种形状）归一化成
// 一种形状再交给模板。两处各写一遍必然分叉 —— 而分叉的样子是「建站写出来的站，构建时被判成非法」。
//
// 设计出处：`docs/superpowers/specs/2026-08-12-theme-css-architecture-design.md` §4.6 / §4.7。
//
// ── 两种形状（双 schema，抄 TICKET-127 的先例：sync-config.js:99 / :139 / :203）──────────────
//
//   老（今天磁盘上每一个既有站）  { "sections": [ { "type": "hero", "data": {…}, "hidden": false } ] }
//   新                          { "blocks":   [ { "id": "home-hero", "type": "hero",
//                                                 "block_layout": "with-media", "role": "lead",
//                                                 "region": "content", "weight": 0, "data": {…} },
//                                               { "ref": "our-team" } ] }
//
// 🔴 老形状**不做换算、不改磁盘**：一条 `sections` 记录 1:1 映成一个 block，字段一个不增一个不减
// （`role` 不写进去 —— 让它在渲染时落回类型级默认表，表只有一份）。所以既有站重建出来的 HTML
// 与改动之前逐字节相同，这是本票的 AC2。
//
// 🔴 `data.variant` 原样保留，`block_layout` 是**并存**的新字段，两者不做换算（spec D5）：
// 外观今天仍由组件的 variant 分支画（`HeroSection.tsx:21` 的 `data.variant || 'left'`），而 `block_layout` 装的是内容结构。

const fs = require('fs');
const path = require('path');

const BLOCK_ROLES = require('../src/lib/sections/block-roles.json');
const BLOCK_ALIASES = require('../src/lib/sections/block-aliases.json');
const ROLE_NAMES = ['essential', 'lead', 'optional'];

// 一个块没写 `role` 时的兜底。**表只有一份**（`src/lib/sections/block-roles.json`），运行时那一侧是
// `src/lib/sections/blockAttrs.ts`，读的是同一个文件。表里没有的类型给 `essential`：两个方向的错法
// 不对称，理由写在 blockAttrs.ts 上面那段注释里。
function roleFor(type) {
  return BLOCK_ROLES[type] || 'essential';
}

// ── 老块名 → 通用块的别名（#1132）───────────────────────────────────────────────────────────────
//
// 表在 `../src/lib/sections/block-aliases.json`，**只有一份**（运行时那一侧是
// `src/lib/sections/blockAliases.ts` 读同一个文件；两边各抄一份的后果见 blockAttrs.ts 上那段）。
//
// ── 2026-08-23 #1162：这张表【不再有别名】，这个函数也不再改名字 ──────────────────────────────────
// #1132 / #1143 建的那层老块名兼容（`values-grid` / `benefits-list` / `checklist` /
// `service-highlights` 四行、`role` 补齐、`data` 逐字段改名、以及把老 type 名记进另一个字段）**整层
// 退役了** —— Chris 2026-08-23 裁定：合并从此是干净改名，后面的合并批不再建兼容。
//
// 🔴 表里只剩「键 == 它自己的 `type`」那一行（`card-group`），它从来就不是别名，是通用块自己的词汇。
//    所以那一层的第一个判据（`!row || row.type === block.type`）今天对**任何**输入都成立 ⟹ 只剩
//    归一化那一步。
//
// 🔴 **2026-08-24 #1171（来源 #1162）：那个叫 `applyAlias` 的导出没了 —— 不是改了个名字，是【删掉
//    了一个纯转发的包装】。** #1162 之后它的函数体逐字就是 `return normalizeGenericItems(block);`，
//    而 `normalizeGenericItems` 本来就**同时**在 `module.exports` 里 ⟹ 同一个行为挂着两个导出名，
//    其中一个的名字还在说「套别名」。调用方与测试现在直接叫 `normalizeGenericItems`。
//    📌 判据不是「读起来干净」：行为要逐字节不变，验法是 `blocks.test.js` 全绿 + 同一份含
//    `card-group` 的站 `sync-config.js` 产物 md5 相同（两个读数都在 #1171 的交接留言里）。
//
// 🔴 让退役这件事今天安全的**不是「反正都是测试站」**（prod 5 个站里 2 个属于外部人、1 个是真付费
//    客户，磁盘上写着老 type 名的块共 43 个），而是**平台模板到不了任何已存在的站**：`isLocal()` 在
//    prod 恒 false ⟹ 模板注入的两个点（`manager/sites.go:462` 建站 · `manager/edit.go:93` 打开
//    编辑器/重建存量站）都不成立；模板进站仓只有建站那一刻的 GitHub `/generate` 一条路；而且那 5 个
//    站的仓里一份 `block-aliases.json` 都没有。守这条性质的是
//    `ai-team/dispatcher/ship-check-template-reachability.sh`（#1162），破了它会红。
//
// 🔴 **`normalizeGenericItems` 留着，它不是兼容层。** 票正文 item 1 把「`[string]` 升格」跟老数据
//    映射列在一起，而同一条 item 的 🔴 又写着「为畸形输入做的防御性归一化（#1152 / #1154）不在此列」。
//    两句在这个函数上打架，所以按**它实际服务的路**判：那个升格管**两条**路，其中一条不是老数据 ——
//    新站直接写 `type: "card-group"` 而 `items` 里塞了裸字符串（建站期那道校验 ⑤ 只拦 `null` 和
//    数组，**放行字符串**，实测过）。删掉它那条路会画出空标题：
//      只跑 normalizeListSlots  → items 仍是 ["甲","乙"] → 组件读 item.title = undefined → <h3></h3>
//      跑 normalizeGenericItems → items 变成 [{title:"甲"},{title:"乙"}]
//    ⟹ 保守方向是留（这是**留一道保险**，不是加功能）。已在交接留言里点名请 PM 确认。
// 通用块有几个 —— 从表自己推，不写死名字。「键 == 它自己的 type」那些行就是通用块自己，
// 而每一条别名的 `type` 也指着它们，所以取全部 `type` 的集合就是「本仓今天有哪些通用块」。
const GENERIC_TYPES = new Set(Object.values(BLOCK_ALIASES).map((r) => r.type));

// ── 通用块的列表槽位归一：`[string]` 升成 `[{title}]`（#1143，#1162 之后只剩一条路）───────────────
//
// 映射文档 §1.3 那条 🔴 逐字：「升成 `[{title}]`，`description` 缺省。反方向（通用块同时收字符串
// 和对象）会把『这一项有没有描述』变成两种写法，而建站 AI 是照 manifest 写的 —— 两种写法就是两条
// 要一直维护下去的路。」
//
// 🔴 **#1162：它服务的两条路里，老站那一条没了，新站那一条还在** —— 所以这个函数留着。
//   ① ~~老站写 `type: "checklist"`、`items` 是 `["甲","乙"]`，走别名进来~~ ← 别名层 2026-08-23 退役
//   ② **新站直接写 `type: "card-group"`、而 `items` 里塞了裸字符串** ← 这条路还在，而且**没有别的
//      东西挡它**：建站期 `block-manifest.js` 的校验 ⑤ 只拦 `null` 和数组，**放行字符串**；
//      `normalizeListSlots` 的 `drawableItem` 也把字符串算作可画。少了这一步，组件读
//      `item.title` 得到 `undefined`，画出来是 `<h3 class="card-group__title"></h3>` —— 空标题，
//      不炸、也没人会红。实测两臂：
//        只跑 normalizeListSlots  → items 仍是 ["甲","乙"]
//        跑本函数                 → items 变成 [{title:"甲"},{title:"乙"}]
//
// 🔴 **不是数组、或者一个字符串都没有 ⟹ 原对象原样返回**（同一个引用）。今天表里只有 `card-group`
//    一行，而它磁盘上的 `items` 装的本来就是对象 ⟹ 正常的站走到这里是**恒等**的，
//    `blocks.test.js` 那条反向对照判的就是「同一个数组引用」。加过滤时最容易弄丢的就是它。
function normalizeGenericItems(block) {
  if (!GENERIC_TYPES.has(block.type)) return block;
  const items = block.data && block.data.items;
  if (!Array.isArray(items)) return block;
  // 一个条目能不能画出来:裸字符串(升成 `{title}`)、或者一个普通对象。别的一律丢掉。
  //
  // 🔴 #1152 —— 为什么要丢:`CardGroupSection` 三支(`:90` / `:96` / `:110`)全都直接读 `item.title`,
  //    没有一处可选链。一个 `null` 穿过这里,预渲染那一页就当场炸
  //    `Cannot read properties of null (reading 'title')`,**整个站建不出来**(五个 type 逐个实测,
  //    改之前 rc=1)。建站期那道校验也拦不住它(`block-manifest.js` 的 validateSite 第 ⑤ 条是本票补的),
  //    所以这里是兜底:有人手改 `site/**/pages/*.json`、或者旧站带着脏数据重建,都只经过这一层。
  const usable = (it) => typeof it === 'string'
    || (it !== null && typeof it === 'object' && !Array.isArray(it));
  // 🔴 没有东西要动就返回**同一个 block**,不重建对象。#1143 的「老站重建逐字节不变」建立在这上面
  //    —— `blocks.test.js` 第 ⑥ 格那条反向对照判的是**同一个数组引用**(`untouched.data.items !== objs`
  //    就报红)。加过滤时最容易弄丢的就是它:无条件 `filter().map()` 每次都造新数组,那一格当场红。
  if (!items.some((it) => typeof it === 'string' || !usable(it))) return block;
  return {
    ...block,
    data: {
      ...block.data,
      items: items.filter(usable).map((it) => (typeof it === 'string' ? { title: it } : it)),
    },
  };
}

// ── 所有块的列表槽位兜底：画不出来的条目滤掉、整个不是数组的换成空数组（#1154）──────────────
//
// 🔴 为什么上面那个 `normalizeGenericItems` 不够：它头一行就是 `GENERIC_TYPES.has(block.type)`，
//    而 `GENERIC_TYPES` 今天只有 `card-group` 一个值，并且只看 `items` 一个槽。也就是说 #1152 买到的
//    那道兜底**按构造只管卡片组那一家**。同一个坏数据换个块就照样让构建当场死：
//      timeline 的 events 混一个 null   → Cannot read properties of null (reading 'year')
//      testimonials / process-steps / team-grid / faq-accordion 各有各的那一句（逐个实测过）
//    而 `card-group.items` 写成一个字符串 → `a.items?.map is not a function`（`?.` 只挡 null/undefined）。
//
// 🔴 判据按 **manifest 里的 `kind: "list"`**，不按块的名字，也不按槽叫不叫 `items`：
//    `timeline` 的列表槽是 `events`、`process-steps` 是 `steps`、`team-grid` 是 `members`。
//    照名字写死的话，新加的块默认不在保护里，
//    而它长得跟「查过了」一模一样（跟 block-manifest.js 第 ⑤ 条同一条理由）。
//
// 🔴 **没有东西要动就返回同一个 block、同一个数组**（下面那两处提前 return）。#1143/#1152 的
//    「老站重建逐字节不变」建立在这上面 —— `blocks.test.js` 判的是**同一个数组引用**。
//    无条件 `filter()` 每次都造新数组，那一格当场红。
//
// 📌 这一层是**兜底**，不是校验：建站/编辑那一刻由 `block-manifest.js` 的 `validateSite` 报出来并
//    还能重试一次；走到这里已经是构建期，只有「滤掉」和「整个站建不出来」两条路可选。
const LIST_SLOT_CACHE = new Map();

function listSlotsFor(type) {
  if (LIST_SLOT_CACHE.has(type)) return LIST_SLOT_CACHE.get(type);
  if (!LIST_SLOT_CACHE.size) {
    // 一次性把整份 manifest 读进来。读不到（比如别人把 blocks.js 单独 require 走）就退化成
    // 「一个列表槽都不知道」——那时本函数是恒等的，跟改这一条之前的行为一样，不会把谁弄坏。
    let manifests = {};
    try {
      manifests = loadBlockManifests(path.join(__dirname, '..'));
    } catch (e) {
      manifests = {};
    }
    for (const [t, m] of Object.entries(manifests)) {
      LIST_SLOT_CACHE.set(t, Object.entries((m && m.slots) || {})
        .filter(([, spec]) => spec && spec.kind === 'list')
        .map(([slot]) => slot));
    }
    LIST_SLOT_CACHE.set('\u0000loaded', []);
  }
  return LIST_SLOT_CACHE.get(type) || [];
}

// 一个条目画不画得出来：裸字符串、或者一个普通对象。跟 validateSite 第 ⑤ 条和
// normalizeGenericItems 里那个 `usable` 是同一条判据 —— 三处分叉的话，建站期报的和构建期滤的
// 就不是同一批东西。
function drawableItem(it) {
  return typeof it === 'string' || (it !== null && typeof it === 'object' && !Array.isArray(it));
}

function normalizeListSlots(block) {
  if (!block || typeof block !== 'object') return block;
  const slots = listSlotsFor(block.type);
  if (!slots.length) return block;
  const data = block.data;
  if (!data || typeof data !== 'object' || Array.isArray(data)) return block;
  let out = null;
  for (const slot of slots) {
    const v = data[slot];
    // 没填 = 没这回事，归 validateSite 的第 ① 条管（必填才报）。这里不许无中生有塞一个空数组，
    // 那会给每个块的 data 多出一堆键，「逐字节不变」当场作废。
    if (v === undefined || v === null) continue;
    let next;
    if (!Array.isArray(v)) {
      next = [];               // 整个不是数组：换成空数组，组件 map 出零个条目，不炸
    } else if (v.every(drawableItem)) {
      continue;                // 一个都不用动
    } else {
      next = v.filter(drawableItem);
    }
    if (!out) out = { ...block, data: { ...data } };
    out.data[slot] = next;
  }
  return out || block;
}

// 页面清单里那些块**排布**的顺序：写了 `weight` 就按它，没写就按它在数组里的位置。
//
// 🔴 没写时用 `位置 × 10` 而不是 `位置`：站级块库里的块带着自己的 `weight`（spec §4.6 的例子是 30），
// 它要能插进页面自己那些块**之间**。用位置本身当权重的话，10 个页面块占满 0–9，任何 ≥10 的站级块
// 都只能排到最后 —— 那不是「跨页复用的块有自己的位置」，那是「永远垫底」。
function effectiveWeight(block, index) {
  return typeof block.weight === 'number' && Number.isFinite(block.weight) ? block.weight : index * 10;
}

// 权重相同时按它在页面里出现的先后排。
//
// 🔴 不靠 Array.prototype.sort 的稳定性：那是语言给的保证没错，但读代码的人得先知道这一点才看得懂
// 「为什么 ref 排在 weight 相同的那个块前面」。写出来的另一个理由是 ref 那条规矩本身
// —— `{ "ref": … }` 的权重取自它所在的位置（下面 normalizeLocalePages 里），页面块又常写整十的
// weight，撞上同一个数是常态而不是边界情况。
function byWeightThenOrder(a, b) {
  return (effectiveWeight(a, a.__order) - effectiveWeight(b, b.__order)) || (a.__order - b.__order);
}

// ── 一页的原始形状 → blocks ─────────────────────────────────────────────────────────────────────
//
// 返回 { blocks, schema }。schema 是 'blocks' 或 'sections'，只用来打日志和报错点名。
// 形状本身非法（两个都有 / 两个都没有 / 不是数组）时抛错，调用方负责把它变成构建失败。
function readPageBlocks(page, where) {
  const hasBlocks = Object.prototype.hasOwnProperty.call(page, 'blocks');
  const hasSections = Object.prototype.hasOwnProperty.call(page, 'sections');

  if (hasBlocks && hasSections) {
    throw new Error(`${where} 同时有 "blocks" 和 "sections" 两个数组 —— 只能有一个（新形状用 blocks）`);
  }
  if (!hasBlocks && !hasSections) {
    throw new Error(`${where} 既没有 "blocks" 也没有 "sections"`);
  }

  const raw = hasBlocks ? page.blocks : page.sections;
  if (!Array.isArray(raw)) {
    const t = raw === undefined ? 'undefined' : raw === null ? 'null' : typeof raw;
    throw new Error(`${where} 的 "${hasBlocks ? 'blocks' : 'sections'}" 不是数组（现在是 ${t}）`);
  }
  return { blocks: raw, schema: hasBlocks ? 'blocks' : 'sections' };
}

// ── 站级块库（跨页复用的内容块）─────────────────────────────────────────────────────────────────
//
// 文件在 `<localeDir>/blocks/site-blocks.json`。老的扁平站 localeDir 就是 `site/`，所以它正好是
// spec §4.6 写的 `site/blocks/site-blocks.json`；多语言站每个 locale 各一份 —— 里面装的是 `data`，
// 也就是**正文**，那本来就是每个语言各写一遍的东西。
//
// 🔴 不放进 `site_meta.json`：那个文件在不在，是「老扁平站 / 新多语言站」的开关
// （`sync-config.js` 那一段），给老站塞一个进去 = 那个站构建不出来。
function readSiteBlocks(localeDir) {
  const p = path.join(localeDir, 'blocks', 'site-blocks.json');
  if (!fs.existsSync(p)) return {};
  let parsed;
  try {
    parsed = JSON.parse(fs.readFileSync(p, 'utf-8'));
  } catch (e) {
    throw new Error(`${p} 不是合法 JSON：${e.message}`);
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error(`${p} 必须是一个对象（键是块的 id）`);
  }
  return parsed;
}

// 一个块该出现在哪些页面上。
//
// 规矩（两条，缺一不可）：
//   ① 页面自己的 blocks 里写了 `{ "ref": "<id>" }`  → 出现在这一页，位置就是那条 ref 的位置
//   ② 站级块的 `visibility` 里列了这一页的 slug（或 `"*"`）→ 出现在这一页，位置按它自己的 weight
// 两条都成立时**只出现一次**（ref 那条赢，因为它多说了一件事：位置）。
//
// 🔴 「ref 的位置」是指它**压过站级块自带的 `weight`**：ref 解出来的那个块，权重取自这条 ref 在
// 页面数组里的位置（`位置 × 10`，跟页面块没写 weight 时同一个算法），站级块自己那个 weight 被丢掉；
// ref 条目自己写了 weight 就用它自己写的。不这么做的话，`{ ref }` 放在数组哪一格都不影响结果
// —— 而那正是本票要防的那一族「写了什么都不发生」的死配置（正文 AC8②）。
//
// 🔴 `visibility` 里的 slug 必须是真实存在的页面（AC5）：拼错一个字母，那个块会**静默地哪儿都不
// 出现**，而构建是绿的。同族先例是 `sync-config.js` 那条「必须有 slug=home 的页面」。
function visibilityMatches(siteBlock, slug) {
  const vis = siteBlock.visibility;
  if (!Array.isArray(vis)) return false;
  return vis.includes('*') || vis.includes(slug);
}

// #1156 —— 「这一页解析完站级块库之后，上面会有哪些块」，只回答类型、只给检查用。
//
// 为什么要有它：建站那一刻有两道检查是**按整页/整站**问问题的 —— `block-manifest.js` 的第 ④ 条
// （「行业必需的块，整个站里一个都没有」）和 `homepage-recipe.js` 的 `recipeProblems`（首页开场
// 骨架）。两处都直接读条目的 `type`，而 `{ "ref": "<id>" }` 没有 `type` ⟹ 由站级块提供的块在它们
// 眼里不存在，一个完全合法的 ref 反而变成一条问题。
//
// 🔴 #1149 item 31 —— 上一版这句话后面接的是「（`create-site.js:2331` 拿它决定要不要让模型重写一遍：
// 第 ④ 条那条修不掉 ⟹ `afterRetry` 判 fatal，整次建站死）」，读起来像**今天正在发生**的事。
// **那一半今天走不到。** 站级块库要非空才谈得上「由站级块提供的块」，而建站脚本手上那份按构造是空的：
//   · `create-site.js:2317` / `:2353` 调 `validateBlocks({ pages, industry })` —— 根本**不传** `siteBlocks`
//     （`block-manifest.js:387` 的默认值就是 `{}`）；
//   · 就算传，也没有东西可传:`create-site.js:807-810` 开工先 `rmSync` 整个 `site/`，而全仓唯一产出
//     `blocks/site-blocks.json` 的是 AI 编辑那条路（`edit-site.js`），发生在建站**之后**。
// ⟹ 准确的说法是：**若站级块库非空**，那条链才成立；今天建站脚本传的是空库，所以这一半尚未可达。
// 本函数存在的理由不受影响 —— 它是为那一天准备的，而且 `edit-site.js` 那条路已经在用同一套解析。
//
// 🔴 它跟 `normalizeLocalePages` **共用同一套「哪些块出现在这一页」的规矩**，只是不落盘、不报错、
// 不改任何东西。⚠️ #1149 item 32 —— 上一版这里写的是「**同一套解析规矩**」，那句话在 **weight 这一维
// 不成立**：本函数按数组顺序排、visibility 命中的追加在末尾就完事，而 `normalizeLocalePages` 追加完
// 还会 `resolved.sort(byWeightThenOrder)`（`blocks.js:545`）。实测（站级块写
// `visibility:["home"] + weight:-100`）：本函数看到的顺序是 `hero → team-grid → …`，而构建出来的
// 首页第一块是那个站级块。**这不是 #1156 改坏的** —— 改之前页面块自己写 `weight:-100` 就有同款错位。
// 它也跟本文件 `:506` 那句既有注释（「追加（位置按它自己的 weight，见 effectiveWeight）」）相矛盾。
// ⟹ **本函数回答的是「这一页上有哪些 type」，不是「它们按什么顺序排」**；两道调用它的检查
// （第 ④ 条 / `recipeProblems` 的骨架）问的都是集合，不是顺序。要让检查反映**建出来的页面**顺序，
// 那是另一张票的事（顺带:`hidden` 也要一起进去，见 #1149 台账里那条给未来那张票的射程说明）。
//
// 逐条规矩：
//   · `{ ref }` 指得到 → 换成那个站级块的 type，位置就是这条 ref 的位置
//   · `{ ref }` 指不到 → **丢掉这一格**（构建期就是 note 一句然后跳过，页面上不会有这一块。
//     不在这里新报一条问题 —— 「ref 指不到 id 怎么办」是 #1156 明写划在射程外的事）
//   · 同时写了 `ref` 和 `type` → 按普通块算（跟 `validateSite` 的 `isRefEntry` 逐字同一个谓词；
//     那种形状构建期直接 throw，不是一个合法的 ref 条目）
//   · `visibility` 命中而这一页没有 ref 它的 → 追加在末尾（`normalizeLocalePages` 也是追加在末尾）
//
// 入参 entries 是这一页**磁盘上那个数组**（`blocks` 或老形状的 `sections`，由调用方自己挑，
// 因为两个调用方对「读哪个数组」各有自己的兜底）。出参是一串 type，可能含 undefined
// （条目本来就没有 type —— 那是别的检查的事，这里原样留着，别替它做主）。
function resolveBlockTypesForCheck(entries, siteBlocks, slug) {
  const lib = siteBlocks && typeof siteBlocks === 'object' && !Array.isArray(siteBlocks)
    ? siteBlocks : {};
  const types = [];
  const seenRefs = new Set();
  for (const entry of Array.isArray(entries) ? entries : []) {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
      types.push(undefined);
      continue;
    }
    if (typeof entry.ref === 'string' && entry.type === undefined) {
      const target = lib[entry.ref];
      seenRefs.add(entry.ref);
      if (target && typeof target === 'object' && !Array.isArray(target)) types.push(target.type);
      continue; // 指不到 ⟹ 这一格在构建产物里不存在，检查也不该看见它
    }
    types.push(entry.type);
  }
  for (const id of Object.keys(lib)) {
    if (seenRefs.has(id)) continue;
    const b = lib[id];
    if (!b || typeof b !== 'object' || Array.isArray(b)) continue;
    if (!visibilityMatches(b, slug)) continue;
    types.push(b.type);
  }
  return types;
}

// ── 归一化一整个 locale ─────────────────────────────────────────────────────────────────────────
//
// 入参 pages 是磁盘上读进来的页面对象数组（新老形状混着也行），siteBlocks 是站级块库。
// 出参：同一批页面对象，每个都带上归一化后的 `blocks`，`sections` 被删掉。
//
// 第四个入参 `report` 是可选的收纳盒：传一个对象进来，跑完会得到 `report.unusedSiteBlockIds`
// ——一个页面都没用上的那些站级块（见函数末尾）。不传就什么都不发生，老调用方不用改。
//
// 抛错 = 构建失败，消息里点名是哪个 locale、哪一页、第几个块。
function normalizeLocalePages(pages, siteBlocks, locale, report) {
  const slugs = new Set(pages.map(p => p.slug));
  const siteBlockIds = Object.keys(siteBlocks);
  const usedSiteBlockIds = new Set();
  // 🔴 构建期的两种待遇（PM 在 #998 r4 定的，理由与 #999 已上线那条同源，整段写在
  // `sync-config.js` 的 validateSite 那一节）：**构建期没有救，只有毁**。这里 exit 1 的唯一后果是
  // 这个站从此重建不出来、预览也开不出来（`worker/entrypoint.sh` 的 preview 分支带 `set -e`）。
  // 📌 #1087 之前这里还有一句「而写入侧会把 sync-config 的失败吞掉再照样 commit+push」——
  // 那个洞已经堵上了：`edit-site.js` 现在同步失败就发一条 error 事件给老板，并且**不再往下走**
  // 那段 `git add -A && commit && push`。所以「一次 AI 编辑就能让一个在跑的站再也打不开」这条路
  // 不通了；这里 exit 1 的代价仍然是真的（这个站要人去修那份文件），只是它到不了站仓。
  //
  //   · **能安全兜底的 → 打印点名 + 继续**：一个字段的值不合法，但「不要这个字段」有明确、无歧义的
  //     默认行为（role 落回类型默认表、weight 落回按位置、block_layout 不落这个属性、
  //     visibility 里那一条忽略、ref 指不到就跳过那一条）。
  //   · **没有它就渲染不出来的 → 仍然 exit 1**：形状本身矛盾或缺内容，兜底只能靠猜
  //     （页面既没 blocks 也没 sections / 两个都写了 / 不是数组 / 块不是对象 / 既没 type 也没 ref）。
  //
  // 点名这一半一个字不减：每条都说出哪个 locale、哪一页、第几个块、哪个字段、落回了什么。
  const notes = [];
  const note = (m) => notes.push(m);
  // #1033 —— 每一页各自用上了哪些站级块。sitemap 的 <lastmod> 要问「这一页读了哪些文件」，而
  // `blocks/site-blocks.json` 只算到真的用上它的那几页（ref 或 visibility 命中）。这里是唯一
  // 算得出这件事的地方 —— 归一化之后页面上只剩块，看不出哪个块是从站级块库来的。
  const siteBlockIdsByPage = {};

  // 站级块自己的形状 + visibility 的 slug
  for (const id of siteBlockIds) {
    const b = siteBlocks[id];
    const where = `Locale "${locale}" 站级块 "${id}"`;
    if (!b || typeof b !== 'object' || Array.isArray(b)) {
      throw new Error(`${where} 必须是一个对象`);
    }
    if (typeof b.type !== 'string' || !b.type) {
      throw new Error(`${where} 缺 "type"`);
    }
    // 🔴 下面几条跟页面块那边**逐字同一套口径**（本文件下方那个 raw.forEach 里）：同一个写错
    // 在两个地方必须是同一个待遇 —— 包括「兜底成什么」也要一样。
    if (b.role !== undefined && !ROLE_NAMES.includes(b.role)) {
      note(`${where} 的 "role" 是 ${JSON.stringify(b.role)}，只能是 ${ROLE_NAMES.join(' / ')}`
        + ` —— 这个字段被忽略，按类型默认表算（${b.type} → ${roleFor(b.type)}）`);
      delete b.role;
    }
    if (b.block_layout !== undefined && typeof b.block_layout !== 'string') {
      note(`${where} 的 "block_layout" 是 ${JSON.stringify(b.block_layout)}，必须是字符串`
        + ' —— 不落这个属性');
      delete b.block_layout;
    }
    if (b.weight !== undefined && !(typeof b.weight === 'number' && Number.isFinite(b.weight))) {
      note(`${where} 的 "weight" 是 ${JSON.stringify(b.weight)}，必须是数字 —— 这个字段被忽略，`
        + '按它在页面里的位置排');
      delete b.weight;
    }
    if (b.visibility !== undefined) {
      if (!Array.isArray(b.visibility)) {
        note(`${where} 的 "visibility" 是 ${JSON.stringify(b.visibility)}，必须是数组 —— 整个字段`
          + '被忽略，这个块只会出现在 ref 它的页面上');
        delete b.visibility;
      } else {
        const bad = b.visibility.filter(s => s !== '*' && !slugs.has(s));
        if (bad.length) {
          note(`${where} 的 visibility 里写了 ${bad.map(s => JSON.stringify(s)).join(' / ')}，`
            + `这些 slug 在 ${locale} 下没有对应的页面 —— 忽略这几条（现有页面：`
            + `${[...slugs].sort().join(', ')}）`);
          b.visibility = b.visibility.filter(s => s === '*' || slugs.has(s));
        }
      }
    }
  }

  for (const page of pages) {
    const where = `Locale "${locale}" page "${page.slug}"`;
    const { blocks: raw } = readPageBlocks(page, where);

    const resolved = [];
    const seenRefs = new Set();

    raw.forEach((entry, i) => {
      if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
        throw new Error(`${where} 第 ${i} 个块不是对象`);
      }
      if (typeof entry.ref === 'string') {
        if (entry.type !== undefined) {
          // 形状自相矛盾，兜底只能靠猜哪一半是真的（跟「blocks 和 sections 都写了」同一族）⟹ exit 1。
          throw new Error(`${where} 第 ${i} 个块同时写了 "ref" 和 "type" —— ref 是引用站级块库，不带自己的内容`);
        }
        const target = siteBlocks[entry.ref];
        if (!target) {
          note(`${where} 第 ${i} 个块引用了 ${JSON.stringify(entry.ref)}，站级块库里没有这个 id`
            + ` —— 跳过这一条（现有：${siteBlockIds.length ? siteBlockIds.join(', ') : '(空)'}）`);
          return;
        }
        const refWeightOk = typeof entry.weight === 'number' && Number.isFinite(entry.weight);
        if (entry.weight !== undefined && !refWeightOk) {
          note(`${where} 第 ${i} 个块（ref ${JSON.stringify(entry.ref)}）的 "weight" 是 `
            + `${JSON.stringify(entry.weight)}，必须是数字 —— 按它在页面里的位置排（${i * 10}）`);
        }
        seenRefs.add(entry.ref);
        usedSiteBlockIds.add(entry.ref);
        // 站级块自带的 weight 在这里被**丢掉**（`weight: undefined` 之后再赋值）：这一页显式写了
        // 位置，显式的赢（见上面 visibilityMatches 那段注释）。ref 自己写了 weight 就用它自己的。
        resolved.push({
          ...target,
          id: entry.ref,
          weight: refWeightOk ? entry.weight : i * 10,
          __order: i,
        });
        return;
      }
      if (typeof entry.type !== 'string' || !entry.type) {
        // 既不知道渲染什么，也没有可猜的默认 ⟹ exit 1。
        throw new Error(`${where} 第 ${i} 个块既没有 "type" 也没有 "ref"`);
      }
      const block = { ...entry, __order: i };
      if (block.role !== undefined && !ROLE_NAMES.includes(block.role)) {
        note(`${where} 第 ${i} 个块的 "role" 是 ${JSON.stringify(block.role)}，只能是 `
          + `${ROLE_NAMES.join(' / ')} —— 这个字段被忽略，按类型默认表算（${block.type} → `
          + `${roleFor(block.type)}）`);
        delete block.role;
      }
      if (block.block_layout !== undefined && typeof block.block_layout !== 'string') {
        note(`${where} 第 ${i} 个块的 "block_layout" 是 ${JSON.stringify(block.block_layout)}，`
          + '必须是字符串 —— 不落这个属性');
        delete block.block_layout;
      }
      if (block.weight !== undefined && !(typeof block.weight === 'number' && Number.isFinite(block.weight))) {
        note(`${where} 第 ${i} 个块的 "weight" 是 ${JSON.stringify(block.weight)}，必须是数字 —— `
          + `按它在页面里的位置排（${i * 10}）`);
        delete block.weight;
      }
      resolved.push(block);
    });

    // visibility 命中但这一页没有 ref 它的 → 追加（位置按它自己的 weight，见 effectiveWeight）
    let extra = raw.length;
    const visibilityHitsHere = new Set();
    for (const id of siteBlockIds) {
      if (seenRefs.has(id)) continue;
      if (!visibilityMatches(siteBlocks[id], page.slug)) continue;
      usedSiteBlockIds.add(id);
      visibilityHitsHere.add(id);
      resolved.push({ ...siteBlocks[id], id, __order: extra++ });
    }

    // id 在一页之内必须唯一 —— SectionRenderer 拿它当 React 的 key。撞了的话 React 会把两个块当成
    // 同一个,页面上少一块而构建是绿的(老站没有 id,走的是 type+位置那条兜底,不受这条影响)。
    // 🔴 撞了的处置是「点名 + 把后面那个的 id 摘掉」，不是 exit 1（PM r4 那条原则的直接应用：
    // 摘掉 id 之后那个块照样渲染，只是 React 的 key 落回 `type+位置` 那条兜底 —— 有明确、无歧义的
    // 默认行为 ⟹ 属于「能安全兜底」那一栏。留着才是真丢东西：React 把两个块当成同一个，页面上
    // 少一块而构建是绿的）。PM 的表里没有这一行，是我按同一条原则判的。
    // #1132 —— 归一在这里生效，一处。三个来路（页面块 / `ref` 解出来的站级块 / `visibility` 命中
    // 追加的站级块）都汇到了 `resolved`，所以放在这里就是三条路一起管；分别在三个 push 那里做的话，
    // 下一批合并漏掉一条不会有任何东西报错。
    // #1154 —— 列表槽位的兜底走同一个漏斗（三条来路都汇到 resolved）。
    // 📌 #1162：这里原来写着「顺序是承重的：先归一化把 `service-highlights` 的 `highlights`
    //    改名成 `items`、type 变成 `card-group`，再按改完之后那个 type 的 manifest 查列表槽」——
    //    别名层退役之后 `normalizeGenericItems` 不再改 `type` 也不再改字段名，那条理由**没了**。顺序留着，
    //    因为 `normalizeGenericItems` 仍会把裸字符串升成对象，而后一步按 `drawableItem` 过滤 —— 反过来跑的话
    //    过滤先看到字符串（它也算可画），结果一样；也就是说今天两种顺序等价，写成这一种是为了
    //    「先规范内容、再兜底形状」读起来顺。别把「等价」读成「随便」：下一批再并块时先回来重判。
    for (let k = 0; k < resolved.length; k += 1) {
      resolved[k] = normalizeListSlots(normalizeGenericItems(resolved[k]));
    }

    const seenIds = new Map();
    resolved.forEach((b, i) => {
      if (typeof b.id !== 'string' || !b.id) return;
      if (seenIds.has(b.id)) {
        note(`${where} 的第 ${seenIds.get(b.id)} 个和第 ${i} 个块都叫 ${JSON.stringify(b.id)} —— `
          + '一页之内 id 必须唯一；第二个的 id 被摘掉（它照样渲染，只是渲染器按 type+位置 给它 key）');
        delete b.id;
        return;
      }
      seenIds.set(b.id, i);
    });

    resolved.sort(byWeightThenOrder);
    for (const b of resolved) delete b.__order;

    page.blocks = resolved;
    delete page.sections;
    // ref 命中的（seenRefs，只有真找到目标才进）+ visibility 命中的（上面那个循环塞进 usedSiteBlockIds
    // 的那些），合起来就是这一页用上的站级块。
    siteBlockIdsByPage[page.slug] = [...new Set([...seenRefs, ...visibilityHitsHere])].sort();
  }

  // 一个站级块可以没被任何页面用上：没人 `ref` 它，`visibility` 也没命中任何页面（写成 `[]`、
  // 或者干脆没写）。这**不是错误** —— 先把块写好、过几天再挂到页面上，是正常的草稿态，所以不报错。
  //
  // 🔴 但要点名。口径跟上面 validateBlockLayouts 那个「跳过要打印」完全一样：静默跳过和「一切正常」
  // 在日志里长得一模一样，而作者最想知道的恰恰是「我写的那个块，今天一页都没出现」（正文 AC9②）。
  // 打印交给调用方（sync-config.js），这里只把名单交出去 —— 跟 validateBlockLayouts 同一个分工。
  if (report && typeof report === 'object') {
    report.unusedSiteBlockIds = siteBlockIds.filter(id => !usedSiteBlockIds.has(id)).sort();
    // #1033 —— 每页各自用上的站级块（见上面 siteBlockIdsByPage 那段）。
    report.siteBlockIdsByPage = siteBlockIdsByPage;
    // 上面每一处「点名 + 继续」的话都在这里交给调用方去打印。🔴 调用方**必须**打印它：一个被忽略的
    // 字段和一份完全正常的配置，在日志里长得一模一样 —— 而这正是本票要治的那一族毛病。
    report.notes = notes;
  }

  return pages;
}

// ── block manifest（#999 的交付物）───────────────────────────────────────────────────────────────
//
// 一个块一份 manifest，`blocks/<type>.json`，里面的 `block_layout` 是这个块**允许的形态清单**。
// #999 还没落盘时这个目录不存在 —— 那时校验**跳过并点名**（不是静默跳过：静默跳过和「校验通过」
// 在日志里长得一模一样，而它们是两件完全不同的事）。
const MANIFEST_DIR = 'blocks';

function loadBlockManifests(rootDir) {
  const dir = path.join(rootDir, MANIFEST_DIR);
  if (!fs.existsSync(dir)) return {};
  const out = {};
  for (const f of fs.readdirSync(dir)) {
    if (!f.endsWith('.json')) continue;
    const p = path.join(dir, f);
    let m;
    try {
      m = JSON.parse(fs.readFileSync(p, 'utf-8'));
    } catch (e) {
      throw new Error(`${p} 不是合法 JSON：${e.message}`);
    }
    const type = typeof m.type === 'string' && m.type ? m.type : f.replace(/\.json$/, '');
    out[type] = m;
  }
  return out;
}

// 校验每个块的 `block_layout` 落在它自己 manifest 的清单里。
//
// 🔴 不在清单里 = **点名 + 把这个属性摘掉**，不是构建失败（PM 在 #998 r4 定的口径，理由见
// normalizeLocalePages 头上那段）：摘掉之后这个块落回它的默认形态照常渲染，而 exit 1 的后果是
// 这个站从此重建不出来 —— 而写这个值的那条路（AI 编辑）今天既不校验也拦不住，还会把坏值 commit 进仓。
//
// 返回 { skipped, notes }：`skipped` 是没有 manifest 的类型（校验没跑到，也要点名），
// `notes` 是每一处被摘掉的属性。两样都由调用方打印。
function validateBlockLayouts(pagesByLocale, manifests) {
  const skipped = new Set();
  const notes = [];
  for (const [locale, pages] of Object.entries(pagesByLocale)) {
    for (const page of pages) {
      (page.blocks || []).forEach((b, i) => {
        if (typeof b.block_layout !== 'string' || !b.block_layout) return;
        const m = manifests[b.type];
        if (!m || !Array.isArray(m.block_layout)) { skipped.add(b.type); return; }
        if (!m.block_layout.includes(b.block_layout)) {
          notes.push(
            `Locale "${locale}" page "${page.slug}" 第 ${i} 个块（${b.type}）的 block_layout 是 ` +
            `${JSON.stringify(b.block_layout)}，不在 ${MANIFEST_DIR}/${b.type}.json 声明的清单里` +
            `（${m.block_layout.join(', ')}）—— 不落这个属性，这个块按默认形态渲染`
          );
          delete b.block_layout;
        }
      });
    }
  }
  return { skipped: [...skipped].sort(), notes };
}

// ── 建站脚本那一侧：AI 产出的 sections → 写进磁盘的 blocks ──────────────────────────────────────
//
// 🔴 建站提示词今天仍然让 AI 吐 `sections`（它选形态、填 `block_layout` 是 #999 的 AC5）。这里做的
// 只是**写盘那一刻**的形状转换：给每个块补 `id` / `role` / `region` / `weight`，`data` 原样带过去。
// 转换放在写盘这一步而不是改提示词，是因为 AI 输出还要过 create-site 自己那一串校验，那些校验读的
// 是 `sections` —— 一起改会把「形状迁移」和「AI 行为」两件事搅在一次改动里。
function pageWithBlocks(page) {
  const { blocks: raw } = readPageBlocks(page, `page "${page.slug}"`);
  const out = { ...page };
  delete out.sections;
  out.blocks = raw.map((s, i) => {
    if (typeof s.ref === 'string') return { ...s };
    const b = {
      id: `${page.slug.replace(/\//g, '-')}-${s.type}-${i}`,
      type: s.type,
      role: s.role || roleFor(s.type),
      region: s.region || 'content',
      weight: typeof s.weight === 'number' ? s.weight : i * 10,
    };
    if (typeof s.block_layout === 'string') b.block_layout = s.block_layout;
    if (s.hidden !== undefined) b.hidden = s.hidden;
    b.data = s.data || {};
    return b;
  });
  return out;
}

module.exports = {
  BLOCK_ROLES,
  BLOCK_ALIASES,
  GENERIC_TYPES,
  ROLE_NAMES,
  roleFor,
  normalizeGenericItems,
  normalizeListSlots,
  effectiveWeight,
  byWeightThenOrder,
  readPageBlocks,
  readSiteBlocks,
  visibilityMatches,
  resolveBlockTypesForCheck,
  normalizeLocalePages,
  loadBlockManifests,
  validateBlockLayouts,
  pageWithBlocks,
  MANIFEST_DIR,
};
