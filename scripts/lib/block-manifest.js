// ══════════════════════════════════════════════════════════════════════════════════════════════════
// block-manifest.js — 一个块一份 manifest，34 份，喂给建站提示词和两处校验（#999，spec §4.9①）
// ══════════════════════════════════════════════════════════════════════════════════════════════════
//
// 在这之前，「hero 有哪些槽」只存在于 create-site.js 提示词的散文里，`SectionConfig.data` 是
// `Record<string, unknown>` —— AI 填错槽没人管、行业必需的块缺了没人发现、校验器无从校验。
// 现在那段散文**从这些 manifest 生成**，校验读的也是同一份：一个来源，两个消费者。
//
// 🔴 库定义结构与槽，不定义内容（Chris 2026-08-13 的边界）。manifest 里没有一句文案 —— 文案是
// 建站时 AI 按这家生意生成、填进槽里的。
//
// 🔴 `variants` 是过渡字段（阶段 3 随旧外观退役整字段删除）。它装的是**外观**词，而 `block_layout`
// 装的是**内容结构**（D5：同一份 markup 能画出图左/图右/图上，#991 已证）。两者并存不是含糊，是因为
// 组件今天真的靠 variant 选分支（`HeroSection.tsx:21` 的 `data.variant || 'left'`）——把它挤掉，
// 建站 AI 就不再吐 variant，全站 hero 退回 `left`，而构建照样绿。
const fs = require('fs');
const path = require('path');

const BLOCKS_DIR = path.join(__dirname, '..', '..', 'blocks');

let cache = null;
function loadManifests(dir = BLOCKS_DIR) {
  if (cache && cache.dir === dir) return cache.byType;
  const byType = new Map();
  for (const name of fs.readdirSync(dir).sort()) {
    if (!name.endsWith('.json')) continue;
    const m = JSON.parse(fs.readFileSync(path.join(dir, name), 'utf-8'));
    if (m.type !== path.basename(name, '.json')) {
      throw new Error(`blocks/${name}: type 是 "${m.type}"，跟文件名对不上`);
    }
    // 🔴 空的 `slots` 必须是**有意**的，不能是掉了（#999 r2，QA1 抓到的那条阻断）。
    // r1 的 `quote-form.json` 槽是空的：提示词里那行于是生成成 `data: {  }`，六个字段（formIntro /
    // propertyTypes / urgencyOptions / benefits / redirectMessage / buttonText）从此不再告诉 AI，而
    // `QuoteFormSection.tsx` 逐个读它们 ⟹ 建站过、构建绿、页面空一半。**新加的校验也发现不了**：
    // 一个槽都没声明的块，永远没有必填槽可查。所以「没有槽」这件事本身要有人签字：
    // 真的没有（services-list / services-nav 自己从 services.json 渲染）就写一句 slotsNote，
    // 掉了的话这里当场拒绝。
    if (Object.keys(m.slots || {}).length === 0 && !m.slotsNote) {
      throw new Error(`blocks/${name}: slots 是空的，而且没写 slotsNote。`
        + '如果这个块真的不需要任何数据，用 slotsNote 说一句为什么（它从哪儿取内容）；'
        + '如果是漏了，把槽补上 —— 空 slots 会让提示词里那行退化成 "data: {  }"，而校验永远不会报。');
    }
    byType.set(m.type, m);
  }
  cache = { dir, byType };
  return byType;
}

// ── 提示词那一段，从 manifest 生成 ────────────────────────────────────────────────────────────────
// 🔴 生成的是**逐字节**跟今天那段散文相同的文本（本票交付时对着 origin/main 的 create-site.js 比过）。
// 这一条是这次改动唯一的风险面：提示词变了，AI 吐的东西就会变，而那是花钱才能测的东西。所以形态、
// 顺序、括号、破折号全部照抄，改的只是「它从哪儿来」。
function dataLineFor(m) {
  const parts = Object.entries(m.slots).map(([name, s]) => {
    // 🔴 提示词那行看的是 promptOptional，不是 required —— 两者不是一回事，见 blocks/*.json 的注释：
    //    `variant` 提示词里不带 ?（我们确实希望 AI 每次都给），但校验不拦它（组件自己有默认值，
    //    而 27 个既有站里有 8 个块的 variant 到位率是 0）。
    const opt = s.promptOptional ? '?' : '';
    return s.shape !== undefined ? `${name}${opt}: ${s.shape}` : `${name}${opt}`;
  });
  return `data: { ${parts.join(', ')} }`;
}

function headLineFor(m) {
  const p = m.prompt || {};
  if (p.headExtra) return `- "${m.type}" — ${p.headExtra}`;
  const list = Object.entries(m.variants)
    .map(([word, desc]) => (desc ? `"${word}" (${desc})` : `"${word}"`))
    .join(', ');
  return `- "${m.type}" — ${p.headPrefix || ''}${m.variantKey || 'variants'}: ${list}${p.headSuffix || ''}`;
}

/**
 * 一个块在提示词里的那几行（头 + 续行，续行里的 `@data` 换成从 slots 生成的 data 行），
 * 再加上 manifest 独有的两行。
 *
 * 🔴 那两行是**新加的**，其余逐字节是今天那段散文（交付时对着 origin/main 比过：把这两行去掉之后
 * 与原文完全相同）。加它们是因为 AC5 要「改 manifest 的 block_layout，提示词跟着变」——
 * 也就是这段文字必须真的把 manifest 里的形态和行业说给 AI 听，而不只是重排原来的散文。
 * 📌 只**告诉**它这个块支持哪些内容结构，没有让它多吐一个字段：今天的 section JSON 形状一个字节
 *    没变。`block_layout` 作为内容层的字段在 #998 那张票接进 schema；在那之前 AI 真吐了也不会坏
 *    （校验只认 manifest 里列着的值，渲染器忽略不认识的字段）。
 */
function promptEntry(m) {
  const lines = [headLineFor(m)];
  for (const l of (m.prompt && m.prompt.lines) || []) {
    lines.push(`  ${l === '@data' ? dataLineFor(m) : l}`);
  }
  const layouts = m.block_layout || [];
  // 只有一种结构的块不占一行 —— 34 行 "default" 是噪音，而提示词的每一行都在花钱。
  if (layouts.length > 1 || (layouts.length === 1 && layouts[0] !== 'default')) {
    lines.push(`  content structures: ${layouts.join(' | ')}`);
  }
  const ind = m.industries || {};
  const bits = [];
  if ((ind.required || []).length) {
    bits.push(ind.required.includes('*') ? 'every site must have this block'
      : `every ${ind.required.join(' / ')} site must have this block`);
  }
  if ((ind.recommended || []).length) bits.push(`a good fit for ${ind.recommended.join(', ')}`);
  if ((ind.discouraged || []).length) bits.push(`usually wrong for ${ind.discouraged.join(', ')}`);
  if (bits.length) lines.push(`  industries: ${bits.join('; ')}`);
  return lines.join('\n');
}

/** promptEntry 去掉 manifest 独有的那两行 —— 只给「跟今天那段散文逐字节相同」那条判据用。 */
function promptEntryLegacyOnly(m) {
  return promptEntry(m).split('\n')
    .filter((l) => !/^ {2}(content structures|industries): /.test(l))
    .join('\n');
}

/** 提示词里某一组（homepage / page-specific）的全部块条目。顺序 = manifest 里记的 promptOrder。 */
function promptSection(group, dir, { legacyOnly = false } = {}) {
  const all = [...loadManifests(dir).values()]
    .filter((m) => m.prompt && m.prompt.group === group)
    .sort((a, b) => a.prompt.order - b.prompt.order);
  return all.map(legacyOnly ? promptEntryLegacyOnly : promptEntry).join('\n');
}

// ── 校验 ─────────────────────────────────────────────────────────────────────────────────────────
// 建站脚本（拿到 AI 输出之后，可重试一次）和 sync-config（构建期兜底，防手改 JSON）跑的是**同一个
// 函数** —— 两处各写一遍必然分叉，而分叉的方向永远是「建站放过的东西构建期才炸」。
const ROLE_RANK = { optional: 0, lead: 1, essential: 2 };

/**
 * 一页里的块 —— **两种形状都要认**（#998 把 `sections` 迁成了 `blocks`，老站磁盘上仍是 `sections`）。
 *
 * 🔴 只读 `page.sections` 会让这个函数在构建期整个瞎掉，而且是静默的：构建期这条路上
 * `normalizeLocalePages` 先跑（`sync-config.js:265`），它把页面转成 blocks 形状并**删掉**
 * `sections`，`validateSite` 在它之后才跑（`:302`）。于是下面两个循环恒空 ——
 * 逐块那几条检查一条都不执行（真毛病不再说），而「整个站里没有 X」那条因为 `seenTypes` 恒空，
 * 会对**每一个**站凭空报一条假的。两个方向都错，而 rc 仍是 0。（QA1 在 #998 r3 上量出来的。）
 *
 * 建站那条路正相反：这里跑在 AI 刚吐回来那份上，那时还是 `sections`。所以判据不是「哪条路」，
 * 是「这一页自己是什么形状」。
 */
function blocksOf(page) {
  if (!page) return [];
  if (Array.isArray(page.blocks)) return page.blocks;
  if (Array.isArray(page.sections)) return page.sections;
  return [];
}

/** 行业匹配跟 themes.js:856 同一条口径：把用户填的行业串小写化，再看它 includes 哪个词。 */
function industryMatches(industry, word) {
  if (word === '*') return true;
  return String(industry || '').toLowerCase().includes(word);
}

/**
 * validateSite({ pages, industry, dir, scope }) → { problems, warnings }
 * pages: [{ slug, blocks: [{ type, data, role? }] }]（老形状的 `sections` 同样认，见 blocksOf）
 *
 * 两处跑的是同一个函数、同一套五条检查；`scope` 只决定**发现之后怎么办**：
 *
 *   'create'（默认，建站脚本收到 AI 输出后）—— 全部算 problem。那一刻有救：重试一次让 AI 重写，
 *      再不行就退出，站根本不会被建出来。这是本票的价值所在。
 *   'build'（sync-config 构建期兜底）—— 全部算 warning，一条都不拦。
 *
 * 🔴 为什么构建期一条都不拦（#999 r3，QA2 在真站上量出来的）：**构建期没有救，只有毁。**
 *    那时 site/ 里的 JSON 已经是既成事实，没有重试、没有人在旁边、也没有第二次机会 ——
 *    退出码 1 唯一的后果是**这个站从此重建不出来、预览也开不出来**（worker/entrypoint.sh:198-206
 *    的 preview 分支带着 `set -e`，sync-config 一挂就走不到起服务那一步）。
 *    也就是说硬失败把「有一块地方是空的」换成了「整个站没了」，而后者严重得多。
 *
 *    这不是假设：拿交付版对 GitHub 上**真实存在的 28 个站**跑一遍（dev 20 / test 2 / prod 6），
 *    prod 里有 2 个站会被拦死 —— `site-943130a2`（benefits-list 写成 `benefits`、
 *    service-highlights 写成 `items`）和 `site-77863888`（pricing-table 写成 `plans`、
 *    feature-comparison 写成 `plans`+`categories`）。那几个键名跟组件真读的对不上，
 *    所以这四块**今天在页面上本来就是空的**；本票要是硬拦，它们会从「空一块」变成「打不开」。
 *    其中一个站建于 2026-08-07，不是只有老站才有的形状 —— 而 `edit-site.js:188-196` 只校验
 *    「是合法 JSON」就落盘，模型随时能再写出一个错键名。
 *
 *    构建期该做的是**说出来**：warning 照常打印在构建日志里，一条都不少。
 *    真正的闸在建站那一刻（scope 'create'），那里拦得住、也修得回来。
 */
function validateSite({ pages, industry = '', dir, scope = 'create' } = {}) {
  const manifests = loadManifests(dir);
  const problems = [];
  const warnings = [];
  const seenTypes = new Set();
  // 五条检查全部经这里出口 —— 别在下面直接 push，否则漏掉一条就又出现一个构建期硬闸。
  const flag = (msg) => (scope === 'build' ? warnings : problems).push(msg);

  for (const page of pages || []) {
    for (const [i, sec] of blocksOf(page).entries()) {
      const where = `${page.slug || '(no slug)'} 第 ${i + 1} 个块 ("${sec.type}")`;
      const m = manifests.get(sec.type);
      if (!m) {
        flag(`${where}: 没有这种块 —— blocks/ 里没有 ${sec.type}.json，registry 也不会认它`);
        continue;
      }
      seenTypes.add(sec.type);

      // ① 必填槽
      const data = sec.data || {};
      for (const [slot, spec] of Object.entries(m.slots)) {
        if (!spec.required) continue;
        const v = data[slot];
        const empty = v === undefined || v === null || v === ''
          || (Array.isArray(v) && v.length === 0);
        if (empty) flag(`${where}: 缺必填槽 "${slot}"（blocks/${sec.type}.json 里写着 required）`);
      }

      // ② 角色只能加不能降（spec §4.2 / D4）。没写 role 的按 manifest 的 roleDefault 兜底 —— 兜底在
      //    下面 applyRoleDefaults 里做，这里只拦「写了、而且比默认弱」。
      if (sec.role !== undefined) {
        if (!(sec.role in ROLE_RANK)) {
          flag(`${where}: role "${sec.role}" 不是 essential / lead / optional`);
        } else if (ROLE_RANK[sec.role] < ROLE_RANK[m.roleDefault]) {
          flag(`${where}: 把 role 从默认的 "${m.roleDefault}" 降成了 "${sec.role}" —— `
            + '只能加不能降（blocks/ 里那份是底线）');
        }
      }

      // ③ block_layout 只能取 manifest 列出的值
      if (sec.block_layout !== undefined && !(m.block_layout || []).includes(sec.block_layout)) {
        flag(`${where}: block_layout "${sec.block_layout}" 不在 blocks/${sec.type}.json 的清单里`
          + `（${(m.block_layout || []).join(' / ')}）`);
      }
    }
  }

  // ④ 行业必需的块，整个站里一个都没有
  for (const m of manifests.values()) {
    const req = (m.industries && m.industries.required) || [];
    if (!req.some((w) => industryMatches(industry, w))) continue;
    if (seenTypes.has(m.type)) continue;
    const why = req.includes('*') ? '每个站都要有它' : `"${industry}" 属于 ${req.join(' / ')}`;
    flag(`整个站里没有 "${m.type}" —— ${why}（blocks/${m.type}.json 的 industries.required）`);
  }

  return { problems, warnings };
}

/**
 * 「渲染器认得的块」与「有 manifest 的块」必须是同一个集合 —— 返回两边的差集。
 *
 * 🔴 为什么做成机器检查而不是交付时数一次：本票的全部价值建在「每个块都有一份 manifest」上，而
 * 加第 35 个块的人不会记得来 blocks/ 补一份。少了 manifest 的块，提示词里不会出现（AI 永远不选它）、
 * 校验也不认它 —— 而这两件事都不会红，只是那个块从此形同不存在。
 */
function registryCoverage(registryPath, dir) {
  const ts = fs.readFileSync(registryPath, 'utf-8');
  const start = ts.indexOf('sectionRegistry');
  const known = [...ts.slice(start).matchAll(/^ {2}'([a-z0-9-]+)':/gm)].map((m) => m[1]);
  const manifests = [...loadManifests(dir).keys()];
  return {
    known: known.sort(),
    manifests: manifests.slice().sort(),
    missingManifest: known.filter((t) => !manifests.includes(t)).sort(),
    unknownBlock: manifests.filter((t) => !known.includes(t)).sort(),
  };
}

/** 没写 role 的 section 按 manifest 的 roleDefault 补上。就地改，返回补了几个。 */
function applyRoleDefaults(pages, dir) {
  const manifests = loadManifests(dir);
  let filled = 0;
  for (const page of pages || []) {
    for (const sec of blocksOf(page)) {
      const m = manifests.get(sec.type);
      if (!m || sec.role !== undefined) continue;
      sec.role = m.roleDefault;
      filled += 1;
    }
  }
  return filled;
}

module.exports = {
  BLOCKS_DIR,
  blocksOf,
  loadManifests,
  promptSection,
  promptEntry,
  promptEntryLegacyOnly,
  dataLineFor,
  headLineFor,
  validateSite,
  registryCoverage,
  applyRoleDefaults,
  industryMatches,
};
