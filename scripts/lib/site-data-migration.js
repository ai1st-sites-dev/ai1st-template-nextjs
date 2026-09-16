'use strict';
// site-data-migration.js —— 升级一个已有站时，把它数据里的【老块类型名】改写成今天模板认得的名字
// （#1166 第 2 步）。
//
// ══ 为什么这一步必须存在 ═══════════════════════════════════════════════════════════════════════
// 站的仓里放着它建站那天的模板；升级把模板层换成今天这份。而站的页面 JSON 里写的块类型名，今天的
// 模板可能已经不认识了：#1132 / #1143 把 `values-grid` / `benefits-list` / `checklist` /
// `service-highlights` 并进了 `card-group`，今天靠 `src/lib/sections/block-aliases.json` 那层别名
// 顶着。别名一走（#1162 正在删它），这些名字对新模板就是未知类型，走 `SectionRenderer.tsx` 那条
// 既有路径：一句 `console.warn` 然后 `return null` —— **块在页面上消失，构建照样 exit 0，UI 照样
// 报完成**。prod 磁盘上这类块共 43 个，其中一个真实付费客户（dexin.ca）有 6 个。
//
// 🔴 这是一次性写进磁盘的迁移，不是把那层兼容层建回来。区别：兼容层每次构建翻译一遍、磁盘上永远
// 停在老词汇；这里改完磁盘上就是今天的词汇，下次升级不用再翻。
//
// 🔴 所以这张表【自己带一份】，不 require `block-aliases.json`。那个文件是被删的对象 —— 从它读，
// 等于升级这条路在 #1162 落地的当天一起失效，而失效的样子是「没有块要迁移」，也就是静默。
// 合并线后面每合一批（`docs/.../2026-08-18-block-merge-mapping.md` §2 的批 3~6）往这里加一行。
//
// ══ 改什么、不改什么（#1166 AC1 逐字点名的三样，多一样都不许）═════════════════════════════════
//   ① 块的 `type` —— 换成今天的名字
//   ② `service-highlights` 的 `data.highlights` 改叫 `items`
//   ③ 块自己没写 `role` 时，补上【老类型】那个角色
// 其余逐字节不动。
//
// 🔴 #1333 加了第四样，**只对它那一条规则生效**：`hero` + `block_layout: "with-form"` 改写成
//   `hero-with-form` 时，顺手删掉 `block_layout` 并补一个空的 `data.form`。两样都不是可选的：
//     · 删 `block_layout`：📌 #1341 —— 这一条原来的理由是「新块的取值表里没有 `with-form` 这个值
//       （`blocks/hero-with-form.json` 的 `block_layout` 是 `["default"]`），留着它 `blockAttrs` 会把
//       `data-block-layout="with-form"` 原样送进 DOM」。那两句今天都不成立了：内容结构那一维整条
//       退役，32 份 manifest 里都没有那份取值表了，`blockAttrs.ts` 也不再输出那个属性，老站残留的
//       这个键由 `scripts/blocks.js` 的 `readPageBlocks` 读的时候丢掉。**这一步照旧删它**：迁移的
//       产物是写回磁盘的页面 JSON，把一个已经没人读的键就地清掉，比留着它等下游每次读都丢干净。
//     · 补 `data.form = {}`：`form` 是新块的**必填**槽位，而 `validateSite` 第 ① 条在构建期按必填查
//       （scope 'build' ⟹ warning 不拦）。不补的话这个站此后每一次构建都多一行「缺必填槽 form」的
//       假警报。补的是一个**空**记录：按钮文案和成功提示仍然缺省，由 `HeroLeadForm` 自己那两句顶上
//       ⟹ 客人看到的字一个都没变。建站那条路（`lib/hero-lead-form.js`）写的是同一个东西。
//
// 🔴 `data.variant` / `data.style` 留着，不删。它们今天没人读，而**这一步只做 AC1 点名的那几样**
// —— 不碰客人磁盘上的 data。别名表里那些 `null` 的意思是「继续忽略」，不是「删掉」。
// 📌 #1341 —— 这里原来给的理由是「`CardGroupSection.tsx` 顶上那段写着
//    `scripts/theme-gallery/verify-applied.mjs` 拿磁盘上的 `data.variant` 跟产物里的对账，删掉它
//    那一格会红」。那段逐块对账随内容结构那一维一起退役了（`CardGroupSection.tsx` 顶上那段同日
//    改过），所以今天的理由只剩上面那条。结论没变：照旧不删。
//
// 🔴 `checklist` 的 `items` 是 `[string]`，这里【不动】它。把它升成 `[{title}]` 的是
// `scripts/blocks.js` 的 `normalizeGenericItems`，而那个函数的判据是**归一化之后的 type 落在哪个
// 通用块上**，不是「有没有走过别名」（那个文件 §100-104 逐字写着这条，理由是它要管两条路：老站走
// 别名进来的，和新站直接写 `card-group` 却塞了裸字符串的）。所以改完名字它照样会升 —— 在这里再升
// 一遍就是两份实现。

const fs = require('fs');
const path = require('path');

// LEGACY_BLOCK_TYPES —— 这条升级路自己带的迁移表。
//
// `role` 是【老类型】的角色，只在「补了才有区别」时才写进磁盘（见下面 roleToWrite）。
//
// 🔴 上一版这里写的理由是「不补会落到兜底的 `essential`」——**那句话今天是假的**（PM 在 #1166
// 三稿裁定里更正的，我自己重量过）：兜底是 `blockAttrs.ts:78` 的 `BLOCK_ROLES[type] || 'essential'`，
// 而迁移之后 `type` 就是 `card-group`，`block-roles.json` 里 `card-group` 那一行从 #1132 进表那天
// 起就在（`git log -S` 查得到），值也是 `optional` —— 查得到就落 `optional`，落不到兜底那一支。
// 那句话说的是**别名那条路**：那条路 `blockAttrs` 收到的是 `__legacyType`，四个老名字被 #1162 从
// `block-roles.json` 删掉之后那次查表才会落空。迁移这条路不经过它。
//
// 实测（#1166，四个老类型各拿德馨金融真数据跑一次构建）：补与不补，四个块产物里的 `data-role`
// 都是 `optional`，整块 HTML 逐字节相同（md5 四对四相同）。
// LEGACY_BLOCK_SHAPES —— 带条件的迁移规则（#1333）。
//
// 🔴 为什么不能塞进上面那张 `LEGACY_BLOCK_TYPES`：那张表是**类型对类型**的，键就是老 type 名。
// 本票要迁的不是「所有 hero」，是「hero 里 `block_layout` 恰好是 `with-form` 的那些」——
// 不带表单的 hero 一个都不许碰（它们在今天的模板里仍然是合法的 `hero`）。把它写成表的一行，
// 要么迁多了（全部 hero），要么迁不到（表按 type 查，查不到条件）。
//
// 每条规则：
//   · `when`  这个块符不符合（只读，别改它）
//   · `to`    换成哪个 type
//   · `drop`  顺手从块上删掉哪几个键
//   · `data`  往 `block.data` 上补哪几个键（**只在缺的时候补**，已经有的不覆盖）
//   · `role`  【老形状】那个角色，走跟上面同一个 `roleToWrite`（补了才有区别时才写）
const LEGACY_BLOCK_SHAPES = [
  {
    when: (b) => b.type === 'hero' && b.block_layout === 'with-form',
    to: 'hero-with-form',
    drop: ['block_layout'],
    data: { form: {} },
    role: 'lead',
  },
];

const LEGACY_BLOCK_TYPES = {
  'values-grid': { to: 'card-group', role: 'optional', rename: {} },
  'benefits-list': { to: 'card-group', role: 'optional', rename: {} },
  'checklist': { to: 'card-group', role: 'optional', rename: {} },
  'service-highlights': { to: 'card-group', role: 'optional', rename: { highlights: 'items' } },
};

// knownBlockTypes —— 今天的模板认得哪些块类型。
//
// 🔴 权威是 `src/lib/sections/block-roles.json` 的键，不是 `registry.ts`：后者是 TypeScript，node
// require 不动，而按正则去抠一份 TS 文件就是第二份实现。那张 JSON 是类型级角色表，CLAUDE.md 的
// 「Adding a New Section」第 3 步要求每个新类型都在里面有一行，`978-theme-preview-layout.spec.ts`
// 会当场抓住漏的。两边的键集相等由 §site-data-migration.test.js 盯着。
// 🔴 #1353 —— 这个集合问的是「**页面 JSON 里**写得出哪些 type」，所以**外壳区不算**。顶栏 / 页脚
// 今天在角色表里各占一行（它们是块：有 manifest、有形态、受同一批守卫），但它们**不进页面 JSON**：
// 哪一页有它们由 page layout 库说、`SiteShell.tsx` 渲染，`registry.ts` 那张「页面 JSON 的 type →
// 组件」的表里按构造没有它们。不滤掉的后果是这个函数会把 `{"type":"header"}` 判成一个认得的页面块
// —— 迁移放行、构建不拦，而 `SectionRenderer` 查不到组件，那一块**静默不渲染**。
// 判据用 manifest 自己声明的 `region: true`，不推断（同 `block-manifest.js` 的 `isRegionManifest`）。
function knownBlockTypes(rootDir) {
  let manifests;
  try {
    manifests = require(path.join(rootDir, 'scripts', 'lib', 'block-manifest.js'))
      .loadManifests(path.join(rootDir, 'blocks'));
  } catch {
    manifests = null; // 读不到 manifest 就不滤 —— 失败方向是「多认几个」，跟本函数此前的行为一致。
  }
  return new Set(Object.keys(blockRoles(rootDir))
    .filter((t) => !(manifests && manifests.get(t) && manifests.get(t).region === true)));
}

// blockRoles —— 今天那张类型级角色表本身（`knownBlockTypes` 只要它的键，补 role 那一步要它的值）。
function blockRoles(rootDir) {
  const p = path.join(rootDir, 'src', 'lib', 'sections', 'block-roles.json');
  return JSON.parse(fs.readFileSync(p, 'utf-8'));
}

// roleToWrite —— 这个块要不要把老类型那个角色写进磁盘？
//
// 🔴 判据是「补了才有区别」，不是「老形状没写就补」。产物里那个 `data-role` 由
// `blockAttrs.ts:78` 的 `block.role ?? (BLOCK_ROLES[新type] || 'essential')` 决定 —— 所以
// **新类型在今天那张表里查到的值 == 老类型那个角色** 时，写与不写产物一模一样，而写这个动作
// 落在的是**付费客户仓库里的数据文件**。本票正文对老板的承诺是「内容一个字不变」，两者相等时
// 不写更贴合它（AC1 说的是这几样**可以**变，不是必须变）。
//
// 🔴 但这个判断不许写死成「永远不补」：迁移表后面还要加行（映射文档 §2 的批 3~6），下一批完全
// 可能是「老类型 essential → 新类型 optional」，那时不补就是**静默改掉一个块的角色**，而角色管的
// 是「主题许不许藏它」。所以留着能力、按每个块现算，两种情况各由 §site-data-migration.test.js
// 钉一格。
function roleToWrite(row, roles) {
  const effective = Object.prototype.hasOwnProperty.call(roles, row.to) ? roles[row.to] : 'essential';
  return effective === row.role ? null : row.role;
}

// siteDataFiles —— 这次要看的文件：每一页，加上站级块库（如果有）。
//
// 两种布局都收：`site/pages/*.json`（老的单语言，扁平）和 `site/<locale>/pages/*.json`
// （`site_meta.json` 在场时的多语言）。判据是**目录里有没有 `pages/`**，不是读 `site_meta.json`
// —— 后者是「用哪种布局」的开关，而这里问的是「有哪些页面文件」，前者答得更直接，也顺带收得住
// 「两种布局同时存在」这种手改出来的树。
function siteDataFiles(siteDir) {
  const out = [];
  const walk = (dir) => {
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      const full = path.join(dir, e.name);
      if (e.isDirectory()) {
        walk(full);
      } else if (e.isFile() && e.name.endsWith('.json')) {
        const rel = path.relative(siteDir, full).split(path.sep);
        if (rel.includes('pages')) out.push(full);
        else if (rel[rel.length - 2] === 'blocks' && e.name === 'site-blocks.json') out.push(full);
      }
    }
  };
  walk(siteDir);
  return out.sort();
}

// blocksOf —— 一个文件里的块数组，连它叫什么一起返回。
//
// 页面有两种形状并存（#998）：新建的站写 `blocks`，#998 之前建的站磁盘上仍然是 `sections`。站级块
// 库是第三种：键是块 id、值是块。三种都要迁，因为老类型名在三种里都可能出现。
function blocksOf(doc) {
  if (Array.isArray(doc.blocks)) return { kind: 'array', key: 'blocks', list: doc.blocks };
  if (Array.isArray(doc.sections)) return { kind: 'array', key: 'sections', list: doc.sections };
  // 站级块库：整份就是一张 id → 块 的表，没有 blocks/sections 键。
  const values = Object.values(doc);
  if (values.length && values.every((v) => v && typeof v === 'object' && !Array.isArray(v))) {
    return { kind: 'map', key: null, list: values };
  }
  return { kind: 'none', key: null, list: [] };
}

// migrateBlock —— 一个块，改完返回 true；不用改返回 false。原地改，因为调用方要么整份写回、要么
// 整份丢掉（见 planSiteMigration 的两阶段）。
function migrateBlock(block, row, roleWanted) {
  block.type = row.to;
  if (block.role === undefined && roleWanted !== null) block.role = roleWanted;
  const data = block.data;
  if (data && typeof data === 'object') {
    for (const [from, to] of Object.entries(row.rename)) {
      if (Object.prototype.hasOwnProperty.call(data, from)) {
        // 🔴 目标名字已经在磁盘上时，源覆盖它 —— 而这一支今天到不了：`service-highlights` 的老
        //    组件读的是 `data.highlights`，两个键同时在的块，`items` 那个从来没被读过。同族的判据
        //    写在 `scripts/blocks.js` §normalizeGenericItems 的 #1143 那段注释里。
        data[to] = data[from];
        delete data[from];
      }
    }
  }
  return true;
}

// migrateShapeBlock —— 带条件那种规则的改写（#1333）。跟 `migrateBlock` 分开是因为它们改的东西
// 不一样：那个换名 + 改数据键名，这个换名 + 删键 + 补一个缺省记录。
function migrateShapeBlock(block, rule, roleWanted) {
  block.type = rule.to;
  for (const key of rule.drop || []) delete block[key];
  if (rule.data) {
    // 🔴 只在缺的时候补：磁盘上已经写了文案的站（老板自己改过按钮字）不许被这一步覆盖。
    const data = (block.data && typeof block.data === 'object' && !Array.isArray(block.data)) ? block.data : {};
    for (const [k, v] of Object.entries(rule.data)) {
      if (!Object.prototype.hasOwnProperty.call(data, k)) data[k] = v;
    }
    block.data = data;
  }
  if (block.role === undefined && roleWanted !== null) block.role = roleWanted;
  return true;
}

// planSiteMigration —— 先把整个站算一遍，再决定动不动手。
//
// 🔴 两阶段是硬要求，不是洁癖：**迁不了的一律不许升**（#1166 AC10 反向那一半）。数据里出现一个
// 既不在今天 registry、迁移表里也没有的类型名 ⟹ 在动任何文件之前中止，报出是哪几页哪几个块。
// 边写边发现 = 半新半旧的磁盘，而那正是「宁可升不了，也不许静默删掉客人的内容」要防的东西。
//
// 返回 { blockers, changes, files }：
//   blockers  [{ file, index, id, type }]  —— 非空就不许写
//   changes   [{ file, index, id, from, to, renamed, roleAdded }]
//   files     [{ file, doc, changed }]     —— applyPlan 要写的那些
function planSiteMigration(siteDir, options = {}) {
  const rootDir = options.rootDir || path.resolve(siteDir, '..');
  const roles = options.blockRoles || blockRoles(rootDir);
  const known = options.knownTypes || new Set(Object.keys(roles));
  const blockers = [];
  const changes = [];
  const files = [];

  for (const file of options.files || siteDataFiles(siteDir)) {
    let doc;
    try {
      doc = JSON.parse(fs.readFileSync(file, 'utf-8'));
    } catch (e) {
      // 读不出来的 JSON 也是「不许升」：它可能正是那一页的内容，而我们无从判断它里面有什么。
      blockers.push({ file, index: -1, id: null, type: null, reason: `unreadable JSON: ${e.message}` });
      continue;
    }
    const { list } = blocksOf(doc);
    let changed = false;
    list.forEach((block, index) => {
      if (!block || typeof block !== 'object') return;
      // `{ "ref": "<id>" }` 那种条目没有自己的 type，它指向站级块库里那一条（#998）。
      if (typeof block.type !== 'string') return;
      // #1333 —— 带条件的规则先问，它比按 type 查的那张表窄（同一个 type 里只有一部分块符合）。
      // 🔴 顺序不是随意的：`hero` 不在 `LEGACY_BLOCK_TYPES` 里，所以今天两条路碰不到同一个块；
      //    写在前面是为了将来某个老 type 同时要走两条路时，窄的那条先说话。
      const rule = LEGACY_BLOCK_SHAPES.find((r) => r.when(block));
      if (rule) {
        const before = block.type;
        const hadRole = block.role !== undefined;
        const roleWanted = roleToWrite(rule, roles);
        const droppedKeys = (rule.drop || []).filter((k) => Object.prototype.hasOwnProperty.call(block, k));
        migrateShapeBlock(block, rule, roleWanted);
        changes.push({
          file, index, id: block.id || null, from: before, to: rule.to,
          renamed: [], dropped: droppedKeys, roleAdded: hadRole ? null : roleWanted,
        });
        changed = true;
        return;
      }
      const row = LEGACY_BLOCK_TYPES[block.type];
      if (row) {
        const before = block.type;
        const hadRole = block.role !== undefined;
        const renamed = Object.keys(row.rename).filter(
          (k) => block.data && Object.prototype.hasOwnProperty.call(block.data, k),
        );
        const roleWanted = roleToWrite(row, roles);
        migrateBlock(block, row, roleWanted);
        changes.push({
          file, index, id: block.id || null, from: before, to: row.to,
          renamed, roleAdded: hadRole ? null : roleWanted,
        });
        changed = true;
        return;
      }
      if (!known.has(block.type)) {
        blockers.push({ file, index, id: block.id || null, type: block.type, reason: 'unknown block type' });
      }
    });
    files.push({ file, doc, changed });
  }
  return { blockers, changes, files };
}

// applyPlan —— 把改过的文件写回去。计划里有 blocker 时它拒绝动手（第二道，第一道是调用方）。
//
// 🔴 写法是 `JSON.stringify(doc, null, 2) + '\n'` —— 跟 `create-site.js` / worker 写 theme.json
// 用的同一种，所以「没有块要迁移的站，文件逐字节不变」这件事靠的是**根本不写**（`changed` 为 false
// 的文件跳过），不是靠格式化碰巧一致。AC1 要的就是这个。
function applyPlan(plan) {
  if (plan.blockers.length) {
    throw new Error(`refusing to write: ${plan.blockers.length} block(s) cannot be migrated`);
  }
  const written = [];
  for (const f of plan.files) {
    if (!f.changed) continue;
    fs.writeFileSync(f.file, `${JSON.stringify(f.doc, null, 2)}\n`);
    written.push(f.file);
  }
  return written;
}

module.exports = {
  LEGACY_BLOCK_TYPES,
  LEGACY_BLOCK_SHAPES,
  knownBlockTypes,
  blockRoles,
  roleToWrite,
  siteDataFiles,
  blocksOf,
  planSiteMigration,
  applyPlan,
};
