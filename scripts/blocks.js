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
// 每一行写齐映射文档（`docs/superpowers/specs/2026-08-18-block-merge-mapping.md`）§2.1 那四件事。
//
// 🔴 键 == 它自己的 `type` 的那一行不是别名，是通用块自己的词汇 —— 下面第一个判据跳过它。
//
// 🔴 老站的**磁盘一个字节都不改**：换名字这件事只发生在这里，也就是 #998 那条 1:1 映射上。
//    换完之后老词汇住在 `__legacyType` 里，产物上那五样（`data-block` / `data-role` / 类名 /
//    React 的 key / 不许凭空多出 `data-block-layout`）全部从它来 —— 逐样的出处写在
//    `src/components/sections/CardGroupSection.tsx` 头上。
//
// 🔴 `role` 只在这个块**自己没写**的时候补。老形状（`sections`）从来不带 `role`，所以补的就是老类型
//    在 `block-roles.json` 里那个角色（不补的话 `blockAttrs` 按新 type 名查表、查不到、落到兜底的
//    `essential` —— 映射文档 §2.5 坑一实测过）。新形状（`blocks`）自己带 `role`，显式的赢。
//
// 🔴 `data` 里那些映射到 `null` 的字段（`style` / `variant`）是「继续忽略」，**不是删掉**：没人读
//    它们，而删了会让 `scripts/theme-gallery/verify-applied.mjs` 那格对不上账（它拿磁盘上的
//    `data.variant` 跟产物里的比）。本批两个来源块的字段名跟通用块逐字相同 ⟹ 改名一处都不发生，
//    `data` 连对象都不换。
//
// 🔴 #1143 —— `data` 那条「一个字节都不改」有**一个**例外，写在下面 `normalizeGenericItems` 上。
function applyAlias(block) {
  const row = BLOCK_ALIASES[block.type];
  if (!row || row.type === block.type) return normalizeGenericItems(block);
  const out = { ...block, type: row.type, __legacyType: block.type };
  if (out.role === undefined) out.role = row.role;
  const data = { ...(block.data || {}) };
  let renamed = 0;
  for (const [from, to] of Object.entries(row.data || {})) {
    if (to === null || to === from) continue;
    if (Object.prototype.hasOwnProperty.call(data, from)) {
      data[to] = data[from];
      delete data[from];
      renamed += 1;
    } else if (Object.prototype.hasOwnProperty.call(data, to)) {
      // 🔴 #1143 —— 改名的**源没有、而目标名字在磁盘上有**。这是映射文档 §2.5 坑三那一族：
      //    那个键**老组件从来没读过**（本票删掉的 `ServiceHighlightsSection` 读的是 `data.highlights`，
      //    磁盘上写成 `items` 的那些块今天在页面上是空的 —— `scripts/lib/block-manifest.js` 顶上
      //    那段 #999 的实测里点了这种站的名）。别名把 `items` 变成通用块**真会读**的那个槽位之后，
      //    不删它就等于「顺手接上」：线上一块本来空着的地方**突然长出内容**，而没有人决定过这件事。
      //    判据写成一句话就是：新组件读 `data[to]`，老组件读 `data[from]` ⟹ 源不在，目标也必须不在。
      delete data[to];
      renamed += 1;
    }
  }
  if (renamed) out.data = data;
  return normalizeGenericItems(out);
}

// 通用块有几个 —— 从表自己推，不写死名字。「键 == 它自己的 type」那些行就是通用块自己，
// 而每一条别名的 `type` 也指着它们，所以取全部 `type` 的集合就是「本仓今天有哪些通用块」。
const GENERIC_TYPES = new Set(Object.values(BLOCK_ALIASES).map((r) => r.type));

// ── 通用块的列表槽位归一：`[string]` 升成 `[{title}]`（#1143）─────────────────────────────────
//
// 映射文档 §1.3 那条 🔴 逐字：「升成 `[{title}]`，`description` 缺省。反方向（通用块同时收字符串
// 和对象）会把『这一项有没有描述』变成两种写法，而建站 AI 是照 manifest 写的 —— 两种写法就是两条
// 要一直维护下去的路。」本批把 `checklist`（磁盘上是 `items: ["甲","乙"]`）并进卡片组，它是仓里
// 唯一一个 `[string]` 的列表槽位。
//
// 🔴 **归一在这里做、不在组件里做**，理由是它得管**两条**路而不是一条：
//   ① 老站走别名进来的（`checklist`）；
//   ② 新站直接写 `type: "card-group"`、而 `items` 里塞了裸字符串的 —— 那条路**不经过**上面
//      `applyAlias` 的改名分支（「键 == 它自己的 type」那一行提前返回），所以判据是**归一化之后
//      的 type 落在哪个通用块上**，不是「有没有别名」。这就是 AC3 的反向那一半：喂裸字符串数组
//      给新 type 名，它被规范化，而不是画出一个空标题。
//
// 🔴 **不是数组、或者一个字符串都没有 ⟹ 原对象原样返回**（同一个引用）。别名表里的 `values-grid`
//    / `benefits-list` / `service-highlights` 三条路上 `items` 装的本来就是对象，这个函数对它们
//    是**恒等**的 —— 批 1 那句「老站产物逐字节不变」不会因为本批多了一个函数就变假。
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
    // #1132 —— 别名在这里生效，一处。三个来路（页面块 / `ref` 解出来的站级块 / `visibility` 命中
    // 追加的站级块）都汇到了 `resolved`，所以放在这里就是三条路一起管；分别在三个 push 那里做的话，
    // 下一批合并漏掉一条不会有任何东西报错。
    for (let k = 0; k < resolved.length; k += 1) resolved[k] = applyAlias(resolved[k]);

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
  applyAlias,
  normalizeGenericItems,
  effectiveWeight,
  byWeightThenOrder,
  readPageBlocks,
  readSiteBlocks,
  normalizeLocalePages,
  loadBlockManifests,
  validateBlockLayouts,
  pageWithBlocks,
  MANIFEST_DIR,
};
