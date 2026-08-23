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
const { resolveBlockTypesForCheck } = require('../blocks');

const BLOCKS_DIR = path.join(__dirname, '..', '..', 'blocks');

// ── manifest 自己的形状（#1013 洞 2）────────────────────────────────────────────────────────────
//
// 🔴 为什么 manifest 也要有人校验：下面那五条检查**读的就是 manifest**，所以 manifest 里一个拼错的
// 字就等于把某一条检查静默关掉。实测（#999 ship 时 QA3 量的）：把 `blocks/hero.json` 的
// `roleDefault` 拼成 `"Essential"`（大写 E），②「角色只能加不能降」那条就再也不会报 ——
// `ROLE_RANK["Essential"]` 是 `undefined`，`ROLE_RANK[sec.role] < undefined` 恒为假。
// 三盏灯全绿，而那条检查已经不在了。同族的还有：`block_layout` 写成字符串（`includes` 于是变成
// 子串匹配，`"with"` 会被当成合法值）、`industries.required` 写成字符串（`.some` 报 TypeError 或
// 逐字符匹配）。
//
// 今天 34 份全部合法，所以这一条守的是**将来的编辑** —— 而将来的编辑正是它唯一会犯错的时候。
//
// 失败方式是 throw：manifest 是模板自己的文件（跟 registry.ts 同一类），不是某个站的数据。改坏它
// 的人此刻就在改模板，当场报错是他能修的；放过去则是 34 个块里某一个从此形同不存在。
const ROLE_NAMES = ['essential', 'lead', 'optional'];
// 提示词里的三组。`homepage` / `page-specific` 各由 `promptSection()` 印成一段清单；`page-rule` 的
// 四个块（quote-form / services-nav / services-list / contact-form）不进清单，它们由 create-site.js
// 里写死的页面规则点名（`create-site.js:1960-1962`，data 那行仍从 manifest 来）。
const PROMPT_GROUPS = ['homepage', 'page-specific', 'page-rule'];

function checkManifestShape(name, m) {
  const bad = (msg) => { throw new Error(`blocks/${name}: ${msg}`); };
  const isStr = (v) => typeof v === 'string' && v.length > 0;
  const strArray = (v) => Array.isArray(v) && v.every(isStr);

  if (!isStr(m.category)) bad('category 必须是非空字符串');
  if (!ROLE_NAMES.includes(m.roleDefault)) {
    bad(`roleDefault 是 ${JSON.stringify(m.roleDefault)} —— 只能是 ${ROLE_NAMES.join(' / ')}`
      + '（全小写，大小写错会让「角色只能加不能降」那条检查静默失效）');
  }
  if (!strArray(m.block_layout) || m.block_layout.length === 0) {
    bad(`block_layout 是 ${JSON.stringify(m.block_layout)} —— 必须是非空的字符串【数组】`
      + '（写成字符串的话 includes 会退化成子串匹配，"with" 之类的半个词就成了合法值）');
  }
  if (m.slots === null || typeof m.slots !== 'object' || Array.isArray(m.slots)) bad('slots 必须是对象');
  for (const [slot, s] of Object.entries(m.slots)) {
    if (s === null || typeof s !== 'object') bad(`slots.${slot} 必须是对象`);
    if (!isStr(s.kind)) bad(`slots.${slot}.kind 必须是非空字符串`);
    if (typeof s.required !== 'boolean') bad(`slots.${slot}.required 必须是 true/false（现在是 ${JSON.stringify(s.required)}）`);
    if (typeof s.promptOptional !== 'boolean') bad(`slots.${slot}.promptOptional 必须是 true/false`);
    if (s.shape !== undefined && !isStr(s.shape)) bad(`slots.${slot}.shape 有的话必须是非空字符串`);
  }
  if (m.variants === null || typeof m.variants !== 'object' || Array.isArray(m.variants)) {
    bad('variants 必须是对象（外观词 → 一句说明）');
  }
  if (m.variantKey !== undefined && !isStr(m.variantKey)) bad('variantKey 有的话必须是非空字符串');

  const ind = m.industries;
  if (ind === null || typeof ind !== 'object' || Array.isArray(ind)) bad('industries 必须是对象');
  for (const key of ['required', 'recommended', 'discouraged']) {
    if (!strArray(ind[key])) {
      bad(`industries.${key} 是 ${JSON.stringify(ind[key])} —— 必须是字符串【数组】（没有就写 []）`);
    }
    for (const word of ind[key]) {
      // 🔴 受控词表（#1013 洞 1 的另一半）：行业词只许用 INDUSTRY_VOCABULARY 里的键。行业本身是自由
      // 文本（payload 里由调用方给），所以「哪些写法算这个行业」收在一处、由词表说；manifest 只引用键。
      // 少了这一条，一个拼错的 "photograpy" 会让「摄影站必须有 gallery」永远不生效，而没有东西会红。
      if (key === 'required' && word === '*') continue;
      if (!Object.prototype.hasOwnProperty.call(INDUSTRY_VOCABULARY, word)) {
        bad(`industries.${key} 里的 "${word}" 不在行业词表里。`
          + `能用的是：${Object.keys(INDUSTRY_VOCABULARY).join(' / ')}`
          + `${key === 'required' ? '（required 还可以写 "*" = 每个站都要）' : ''}。`
          + '要加新行业就往 block-manifest.js 的 INDUSTRY_VOCABULARY 里加一个键 + 它的写法');
      }
    }
  }

  const p = m.prompt;
  if (p !== undefined) {
    if (p === null || typeof p !== 'object' || Array.isArray(p)) bad('prompt 必须是对象');
    if (!PROMPT_GROUPS.includes(p.group)) {
      bad(`prompt.group 是 ${JSON.stringify(p.group)} —— 只能是 ${PROMPT_GROUPS.join(' / ')}`
        + '（写错的话这个块在提示词里整块消失，AI 从此不会选它）');
    }
    if (!Number.isInteger(p.order)) bad(`prompt.order 必须是整数（现在是 ${JSON.stringify(p.order)}）`);
    if (p.lines !== undefined && !strArray(p.lines)) bad('prompt.lines 有的话必须是字符串数组');
    if (p.headExtra !== undefined && p.headExtra !== null && !isStr(p.headExtra)) {
      bad('prompt.headExtra 只能是字符串或 null');
    }
  }
}

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
    checkManifestShape(name, m);
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

/**
 * 提示词里某一组（homepage / page-specific）的全部块条目。顺序 = manifest 里记的 promptOrder。
 *
 * `order`（#1034）：给一份 type 名单，就按那份名单的顺序印。**只换顺序，一块都不加不减** ——
 * 名单里没提到的块照旧按 prompt.order 接在后面，名单里有而这一组没有的块直接忽略。
 * 为什么要能换：实测被 AI 选中的那批几乎就是清单靠前的那批，清单顺序本身在参与选择
 * （6 个真实站 100% 以 `announcement-bar → hero` 开场）。判据是「印出来的块集合逐个不变」，
 * 见 `scripts/lib/homepage-recipe.test.js`。
 *
 * `omit`（#1134 r2）：给一份 type 名单，这一组里的这些块**整条不印**。
 * 🔴 它跟 `order` 是刻意分开的两件事：`reorderByNames` 上面那句「永远不会掉块」是它的承重性质，
 *    把「拿掉」塞进那条路会把它废掉。所以拿掉是**另一个参数**，缺省 `null` ⟹ 一块不少，
 *    输出与改这一版之前逐字节相同。
 * 🔴 为什么需要它（QA2 在 #1134 r1 的真机读数）：`service-related-pages` 的三句散文指令被改成
 *    「只在会有子页的站上发」之后，**站建出来一点没变**（3 个互异 siteId × 6 个服务详情页 = 18/18
 *    照旧带那个块）。真因是这里：manifest 那一条自己就写着
 *    `Use ONLY on service detail pages` 和 `safe to include on all service detail pages`
 *    —— 在模型眼里就是「加它」。⟹ 光把散文改成有条件的不够，清单这一条也要跟着让开。
 * 📌 #1140 已经把 `lines` 里那半句 `safe to include on all service detail pages` 删掉了
 *    （`blocks/service-related-pages.json` 现在那一行讲的是「没有关键词页时它整块不渲染，
 *    但仍占掉页面的一个位置」）；`headExtra` 那句 `Use ONLY on service detail pages` 原样还在。
 *    上面这段是 #1134 r1 当时的读数，照原样留着 —— 它是 `omit` 这个参数存在的理由。
 */
function promptSection(group, dir, { legacyOnly = false, order = null, omit = null } = {}) {
  const skip = new Set(omit || []);
  const all = [...loadManifests(dir).values()]
    .filter((m) => m.prompt && m.prompt.group === group && !skip.has(m.type))
    .sort((a, b) => a.prompt.order - b.prompt.order);
  const ordered = order ? reorderByNames(all, order) : all;
  return ordered.map(legacyOnly ? promptEntryLegacyOnly : promptEntry).join('\n');
}

/** 按名单重排；名单没提到的按原顺序接在后面（所以永远不会掉块）。 */
function reorderByNames(manifests, names) {
  const byType = new Map(manifests.map((m) => [m.type, m]));
  const out = [];
  const taken = new Set();
  for (const t of names) {
    const m = byType.get(t);
    if (m && !taken.has(t)) { out.push(m); taken.add(t); }
  }
  for (const m of manifests) if (!taken.has(m.type)) out.push(m);
  return out;
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

/**
 * 一个行业词能被认出来的写法（#1013 洞 1）。**这份表就是行业词表本身** —— manifest 的
 * `industries.*` 只许写这里的键（`checkManifestShape` 拦），所以「哪些写法算这个行业」只有一处。
 *
 * 🔴 为什么不能继续用「小写化之后 includes」（原来那一条，跟 themes.js:856 同源）：它两个方向都错。
 *   放过：`photographer` / `wedding photographer` / `photo studio` 都不含 "photography" 这个子串
 *         ⟹ gallery 的「摄影站必须有」等于没有（#999 ship 时 QA3 量的，本票开工前我又复量了一次）。
 *   误伤：`law` 是 `lawn care` 和 `flawless cleaning` 的子串 ⟹ 真出现 `required: ["law"]` 的那天，
 *         割草公司会被要求放律师事务所才有的块。
 *
 * 写法两种，由词表作者选，不靠猜：
 *   `'spa'`         —— 整词：左右都要挨着非字母（所以 "space" / "spanish" 不算）
 *   `'photograph-'` —— 词干：左边挨着非字母，右边可以再接字母（photography / photographer /
 *                      photographie 全算）。French 那个例子是这么免费拿到的。
 *   中文没有词边界，所以中文写法一律按**子串**判（`'摄影'` 命中 `婚纱摄影工作室`）。
 *
 * 📌 这张表只影响一件事：`validateSite` 的第 ④ 条「行业必需的块，整个站里一个都没有」。提示词里印的
 *    是**键**（`every photography site must have this block`），所以改这张表不会动提示词的字节，
 *    也就不会改 AI 吐什么 —— 那是要花钱才能测的东西（本票交付时对着 origin/main 逐字节比过）。
 */
const INDUSTRY_VOCABULARY = {
  photography:  ['photograph-', 'photo studio', 'photo shoot', 'headshot-', '摄影'],
  roofing:      ['roof-', '屋顶', '房顶'],
  construction: ['construct-', 'builder-', 'contractor-', 'renovation-', 'remodel-', 'masonry',
    '建筑', '装修', '施工'],
  security:     ['security', 'alarm-', 'surveillance', 'cctv', 'locksmith-', '安防', '监控'],
  // 🔴 `law` 在这里是**整词**写法，不是词干 —— 这正是原来那条子串检查错的地方：整词形式下
  //    `lawn care` 的 "law" 右边挨着字母 n、`flawless` 的左边挨着字母 f，两个都不算命中，
  //    而 `law` / `law firm` 算。（少了这一条，把行业直接填成 "law" 的站会认不出来。）
  law:          ['law', 'law firm', 'law office', 'law practice', 'lawyer-', 'attorney-', 'legal',
    'solicitor-', '律师', '法律'],
  insurance:    ['insur-', '保险'],
  medical:      ['medical', 'medicine', 'clinic-', 'physician-', 'doctor-', 'physio-', '医疗', '诊所'],
  dental:       ['dental', 'dentist-', 'orthodont-', '牙科', '牙医'],
  landscaping:  ['landscap-', 'lawn care', 'lawn mowing', 'garden-', 'tree service', 'tree removal',
    '园艺', '绿化', '景观'],
  restaurant:   ['restaurant-', 'cafe', 'café', 'coffee shop', 'bakery', 'bistro', 'diner',
    'catering', 'caterer-', 'pizzeria', 'food truck', '餐厅', '餐馆', '烘焙'],
  salon:        ['salon-', 'barber-', 'hairdress-', 'hair salon', 'hair studio', 'hair styl-',
    'nail salon', 'nail bar', 'spa', 'beauty', '美发', '美容', '沙龙'],
  plumbing:     ['plumb-', '水暖', '管道'],
  cleaning:     ['clean-', 'janitorial', 'maid service', 'housekeeping', '保洁', '清洁'],
  fitness:      ['fitness', 'gym', 'yoga', 'pilates', 'crossfit', 'personal train-', '健身', '瑜伽'],
};

const NOT_A_LETTER = /[^a-z]/;
function stemHits(text, stem) {
  // 中文写法没有词边界可言 —— 直接看在不在里面。
  if (!/^[a-z][a-z .'-]*$/.test(stem)) return text.includes(stem);
  const prefixForm = stem.endsWith('-');
  const needle = prefixForm ? stem.slice(0, -1) : stem;
  let from = 0;
  for (;;) {
    const at = text.indexOf(needle, from);
    if (at < 0) return false;
    const before = at === 0 ? ' ' : text[at - 1];
    const afterIdx = at + needle.length;
    const after = afterIdx >= text.length ? ' ' : text[afterIdx];
    // 左边一律要词边界；右边:整词形式也要，词干形式允许再接字母。
    if (NOT_A_LETTER.test(before) && (prefixForm || NOT_A_LETTER.test(after))) return true;
    from = at + 1;
  }
}

/** 这段自由文本被认出来是哪些行业。认不出来就是空数组 —— 而空数组要被**说出来**，见 validateSite。 */
function recogniseIndustry(industry) {
  const text = String(industry || '').toLowerCase();
  if (!text.trim()) return [];
  return Object.keys(INDUSTRY_VOCABULARY)
    .filter((key) => INDUSTRY_VOCABULARY[key].some((stem) => stemHits(text, stem)));
}

/** manifest 里的一个行业词，配不配得上这段自由文本。`"*"` = 每个站都算。 */
function industryMatches(industry, word) {
  if (word === '*') return true;
  const stems = INDUSTRY_VOCABULARY[word];
  if (!stems) return false; // 词表里没有的键早在 checkManifestShape 就被拦了，这里是第二道
  const text = String(industry || '').toLowerCase();
  return stems.some((stem) => stemHits(text, stem));
}

/**
 * validateSite({ pages, industry, dir, scope, siteBlocks }) → { problems, warnings }
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
 *    退出码 1 唯一的后果是**这个站从此重建不出来、预览也开不出来**（worker/entrypoint.sh 里
 *    `"$MODE" = "preview"` 那个分支带着 `set -e`，sync-config 一挂就走不到起服务那一步）。
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
 *
 *   'edit'（#1013 洞 4，AI 改站那条路）—— 逐个 section 的毛病算 problem（调用方据此**拒绝这次写入**
 *      并把原因退给模型，模型在同一轮对话里重写，见 edit-site.js 的 write_file），
 *      而第 ④ 条「整个站里没有某个块」**不查**。
 *
 *   🔴 为什么 'edit' 既不是 'create' 也不是 'build'：
 *      · 不是 'build'（只警告）—— 编辑这一刻有救。模型就在旁边，`executeTool` 返回 `{error}` 就是
 *        一条 tool_result，它会拿着原因重写一遍（`edit-site.js` 的循环最多 20 轮），
 *        磁盘上一个字节都还没动。#1012 那 4 块空白正是从这条路进来的，而它当时只校验「是合法 JSON」。
 *      · 也不是照搬 'create' 全套 —— 第 ④ 条问的是**整个站**有没有某个块，而这一刻手上只有正在被写的
 *        那一个页面。拿一页去回答整站的问题，结果是：编辑 about.json 会因为「整个站里没有
 *        contact-info」被拒，而那件事既不是这次编辑造成的，模型也没法在 about.json 里修好它
 *        ⟹ 那个站从此改不动了。整站那条检查的家在建站那一刻和构建期，不在这里。
 */
function validateSite({ pages, industry = '', dir, scope = 'create', siteBlocks = {} } = {}) {
  const manifests = loadManifests(dir);
  const problems = [];
  const warnings = [];
  const seenTypes = new Set();
  // 六条检查全部经这里出口 —— 别在下面直接 push，否则漏掉一条就又出现一个构建期硬闸。
  //（第 ⑤ 条是 #1152 加的；第 ④ 条在循环**之后**，因为它问的是整个站，不是某一个块。）
  const flag = (msg) => (scope === 'build' ? warnings : problems).push(msg);

  for (const page of pages || []) {
    for (const [i, sec] of blocksOf(page).entries()) {
      // 🔴 #1154 —— `blocks` 数组里那一格根本不是块（`null` / 一个字符串 / 一个数组）。
      //    在这条守卫之前，下面那句 `sec.type` 直接抛 `TypeError: Cannot read properties of
      //    null (reading 'type')`，而这个函数的调用方是按「返回 problems」写的：
      //    `create-site.js:2317/2353` 拿 problems 决定要不要**重试一次**（`:2353` 那一支），
      //    抛异常则一路冒到顶层的 `main().catch(err => fatal(err.stack))` ⟹ 建站直接死，
      //    连那一次重试都没有。所以这里的处置是「点名 + 跳过这一格」，不是让它炸。
      if (sec === null || typeof sec !== 'object' || Array.isArray(sec)) {
        // 前导空格是有意的：`是 null` / `是一个 string` 两种都读得通（#1152 那条报文同一套写法）
        const what = sec === null ? ' null'
          : Array.isArray(sec) ? '一个数组'
            : sec === undefined ? ' undefined' : `一个 ${typeof sec}`;
        flag(`${page.slug || '(no slug)'} 第 ${i + 1} 格不是一个块 —— 是${what}。`
          + 'blocks 数组里只能放块对象（`{ "type": … }` 或 `{ "ref": … }`）');
        continue;
      }
      const where = `${page.slug || '(no slug)'} 第 ${i + 1} 个块 ("${sec.type}")`;
      // 🔴 #1155 —— `{ "ref": "<站级块的 id>" }` 是 CLAUDE.md §Dynamic Pages 冻结的合法形状，它
      //    **没有 `type` 字段**，所以下面那句 `manifests.get(sec.type)` 必然拿到 undefined，
      //    于是「没有这种块」那一支会对一个完全正确的条目开火，还把 `undefined` 当成块名打进报文。
      //    伤害不止「日志里多一行」：`create-site.js:2331` 拿 `problems.length` 决定要不要让模型
      //    重写一遍 ⟹ 一条不存在的问题烧掉一次真的 API 调用，而重写之后它**还在**（它跟模型写得
      //    对不对无关），`:2357` 的 `afterRetry` 于是读到「重试也没修好」。而 #1154 印进提示词的
      //    那句话（本文件 `:409`）正在逐字告诉模型 ref 是合法格子。
      //
      // 🔴 这里**只压掉这一条报文**，没有新加「见到 ref 就整格 continue」那种口子：`continue` 是
      //    这一支本来就有的（没有 manifest 就没有 `m.slots` / `m.roleDefault` / `m.block_layout`，
      //    下面第 ①②③⑤ 条逐条都要读 `m`，物理上跑不了）。上面 #1154 那道「这一格是不是块」的检查
      //    仍然照跑 —— ref 条目是对象，它本来就从那里正常通过。
      //
      // 🔴 谓词比 `edit-site.js:314` 的 `ownBlocksOf` 严一格，多一个「而且没写 type」：
      //    `blocks.js:387-389` 写着**同时**写了 `ref` 和 `type` 的块在构建期直接 throw
      //    （「ref 是引用站级块库，不带自己的内容」）⟹ 那不是一个合法的 ref 条目，把它的报文也
      //    一起压掉等于建站期放行、构建期才炸。`{ "ref": 7 }`（ref 不是字符串）同理照旧报。
      const isRefEntry = typeof sec.ref === 'string' && sec.type === undefined;
      const m = manifests.get(sec.type);
      if (!m) {
        if (!isRefEntry) {
          flag(`${where}: 没有这种块 —— blocks/ 里没有 ${sec.type}.json，registry 也不会认它`);
        }
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

      // ⑤ 列表槽里的条目只能是字符串或对象（#1152）。
      //
      // 🔴 为什么这条非有不可：`null` 混进条目列表时，通用块 `CardGroupSection` 三支
      //    （`:90` / `:96` / `:110`）都直接读 `item.title` ⟹ 预渲染当场炸
      //    `Cannot read properties of null (reading 'title')`，**整个站建不出来**（五个归到
      //    `card-group` 的 type 逐个实测，改之前全是 rc=1）。而 ① 那条只问「这个槽是不是空的」，
      //    `['甲', null, '乙']` 在它眼里是个长度 3 的非空数组 ⟹ 一路放行。
      // 🔴 为什么放在建站期而不是只靠构建期兜底：这一刻还能重试，构建期只能整个站建不出来
      //    （跟 create-site.js 调这个函数那段注释同源）。构建期那一层是 `scripts/blocks.js` 的
      //    `normalizeGenericItems`，它把画不出来的条目滤掉 —— 两层管的是不同的时刻，不是一层的抄本。
      // 🔴 判据按**槽的 kind**，不按块的名字：今天归到 `card-group` 的是五个 type，明天还会多。
      //    照名字写死的话，新加的块默认不在保护里，而它长得跟「查过了」一模一样。
      // 🔴 #1154 —— 上一版这里是 `if (!Array.isArray(v)) continue`，也就是**槽的值整个不是数组**
      //    时一句话都不说。而 ① 那条只问「这个槽是不是空的」，`items: "甲、乙"` 在它眼里是有值的
      //    ⟹ 两条都放行，构建期当场炸 `a.items?.map is not a function`（`?.` 只挡 null/undefined，
      //    挡不住一个字符串）。这条路 AI 走得到：提示词让它填这个槽，它填了个字符串。
      //    `undefined` / `null` 仍然跳过 —— 那是「没填」，归 ① 管（必填才报，选填就是没有）。
      for (const [slot, spec] of Object.entries(m.slots)) {
        if (spec.kind !== 'list') continue;
        const v = data[slot];
        if (v === undefined || v === null) continue;
        if (!Array.isArray(v)) {
          const what = typeof v === 'object' ? '一个对象' : `一个 ${typeof v}`;
          flag(`${where}: 槽 "${slot}" 不是列表 —— 是${what}（${JSON.stringify(v).slice(0, 40)}）。`
            + `blocks/${sec.type}.json 里它写着 kind: "list"，只能放数组`);
          continue;
        }
        v.forEach((el, k) => {
          if (typeof el === 'string') return;
          if (el !== null && typeof el === 'object' && !Array.isArray(el)) return;
          const what = el === null ? 'null' : (Array.isArray(el) ? '一个数组' : `一个 ${typeof el}`);
          flag(`${where}: 槽 "${slot}" 的第 ${k + 1} 个条目是 ${what} —— 列表里只能是字符串或对象`);
        });
      }
    }
  }

  // ④ 行业必需的块，整个站里一个都没有。
  //    'edit' 不查这一条 —— 手上只有一个页面，答不了整站的问题（理由整段写在函数头上）。
  //
  // 🔴 #1156 —— 这一条问的是**整个站**，所以它必须按站级块库解析完再问。上面那个逐块循环只会把
  //    **页面自己写下的**块记进 `seenTypes`（`{ "ref": … }` 没有 `type`，在 `!m` 那一支就 continue
  //    走了），于是一个 `contact-info` 只由站级块提供的站会被报「整个站里没有 contact-info」——
  //    而那个块在产物里是有的。伤害不是日志多一行：`create-site.js:2331` 拿 problems 决定要不要让
  //    模型重写一遍，而这条问题跟模型写得对不对无关、重写之后还在 ⟹ `afterRetry` 判 `fatal`，
  //    整次建站死（#1155 QA1 的圈外发现 ①，交付之后实测仍复现）。
  //    解析规矩不在这里写第二份 —— 用 `blocks.js` 的 `resolveBlockTypesForCheck`，它跟构建期的
  //    `normalizeLocalePages` 是同一套（ref 指得到就换成目标的 type、指不到就丢掉、visibility 命中
  //    的追加）。逐块那几条检查（①②③⑤）**一个字都没动**：它们问的是「这一格自己填对了没有」，
  //    而站级块的那一格内容不在这个页面文件里。
  const industryKeys = recogniseIndustry(industry);
  if (scope !== 'edit') {
    for (const page of pages || []) {
      const slug = page && page.slug;
      for (const t of resolveBlockTypesForCheck(blocksOf(page), siteBlocks, slug)) {
        if (typeof t === 'string' && t) seenTypes.add(t);
      }
    }
    for (const m of manifests.values()) {
      const req = (m.industries && m.industries.required) || [];
      if (!req.some((w) => industryMatches(industry, w))) continue;
      if (seenTypes.has(m.type)) continue;
      const why = req.includes('*') ? '每个站都要有它' : `"${industry}" 属于 ${req.join(' / ')}`;
      flag(`整个站里没有 "${m.type}" —— ${why}（blocks/${m.type}.json 的 industries.required）`);
    }

    // 🔴 说出这条检查的射程（#1013 洞 1）。行业是自由文本，认不出来的写法一定存在 —— 而
    //    「认不出来」和「这个行业不需要任何特定的块」今天长得一模一样：两种情况都是一条 problem 都没有。
    //    所以认不出来的时候必须自己说一句，否则读日志的人会以为查过了。
    //    永远是 warning，从不阻断：认不出行业不是这个站的错。
    if (String(industry || '').trim() && industryKeys.length === 0) {
      warnings.push(`行业 "${industry}" 不在我认得的写法里，所以「某些行业必须有的块」这条`
        + `只按 required: "*"（每个站都要）查了一遍。我认得的行业是：`
        + `${Object.keys(INDUSTRY_VOCABULARY).join(' / ')} —— 写法收在 block-manifest.js 的`
        + ' INDUSTRY_VOCABULARY 里，要加就往那儿加一行');
    }
  }

  return { problems, warnings, industryKeys };
}

/**
 * 「渲染器认得的块」与「有 manifest 的块」必须是同一个集合 —— 返回两边的差集。
 *
 * 🔴 为什么做成机器检查而不是交付时数一次：本票的全部价值建在「每个块都有一份 manifest」上，而
 * 加第 35 个块的人不会记得来 blocks/ 补一份。少了 manifest 的块，提示词里不会出现（AI 永远不选它）、
 * 校验也不认它 —— 而这两件事都不会红，只是那个块从此形同不存在。
 */

/**
 * `sectionRegistry` 那个对象里登记了哪些块名 —— 用 TypeScript 自己的解析器读，不看源码长什么样
 * （#1013 洞 3）。
 *
 * 🔴 原来那一版是一条正则：`/^ {2}'([a-z0-9-]+)':/gm`。它要求**行首正好两个空格 + 单引号**，
 * 于是同一份注册表的三种合法写法它都看不见（本票开工前逐个量过）：
 *
 *   写法                                        原来的读数              后果
 *   `  "fake": FakeSection,`（双引号）           known 仍是 34           新块不会被要求补 manifest
 *   `    'fake': FakeSection,`（4 空格缩进）      known 仍是 34           同上
 *   多行 `/* … *\/` 里包着一条正常写法的登记       known 变 35，含被注释的   注释掉的块被当成还在
 *
 * 三种都是「放行」方向：检查说没事，而它其实没看见。而且这类洞**改不干净** —— 下一种写法（模板字符串
 * 键、`as const`、prettier 换个缩进）照样绕过。所以判据不该是源码的字面格式，而该是**代码本身的结构**。
 * `typescript` 已经是 templates/nextjs 的依赖（`package.json` devDependencies，容器里的
 * `npm ci --ignore-scripts` 不带 --omit=dev，而且 `next build` 本来就要它），所以这不是新依赖。
 *
 * 🔴 读不出来 ≠ 对不上。拿不到解析器就返回 null，由调用方说一句然后继续 —— 把「工具没装」判成
 * 「注册表对不上」会让 sync-config 当场 exit 1，也就是让那个站从此重建不出来（同 #1009 的形状）。
 */
function registryNames(registryPath) {
  let ts;
  try {
    ts = require('typescript');
  } catch (e) {
    if (e.code !== 'MODULE_NOT_FOUND') throw e;
    return null;
  }
  const src = fs.readFileSync(registryPath, 'utf-8');
  const sf = ts.createSourceFile(registryPath, src, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  let names = null;
  const visit = (node) => {
    if (names) return;
    if (ts.isVariableDeclaration(node)
        && ts.isIdentifier(node.name) && node.name.text === 'sectionRegistry'
        && node.initializer && ts.isObjectLiteralExpression(node.initializer)) {
      names = node.initializer.properties.map((p) => {
        if (ts.isPropertyAssignment(p) || ts.isShorthandPropertyAssignment(p)) {
          const n = p.name;
          if (ts.isStringLiteral(n) || ts.isIdentifier(n) || ts.isNoSubstitutionTemplateLiteral(n)) {
            return n.text;
          }
        }
        // 展开、计算出来的键、方法写法 —— 名字不是静态可读的。**不许静默跳过**：跳过的方向是
        // 「registry 里有个块我没数」，而那正是这个检查要防的事。
        throw new Error(`${registryPath}: sectionRegistry 里有一项的键读不出来`
          + `（${ts.SyntaxKind[p.kind]}，第 ${sf.getLineAndCharacterOfPosition(p.getStart()).line + 1} 行）`
          + ' —— 块名必须是写死的字符串键，这个检查才数得准');
      });
      return;
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return names;
}

function registryCoverage(registryPath, dir) {
  const known = registryNames(registryPath);
  const manifests = [...loadManifests(dir).keys()];
  if (known === null) {
    return {
      known: [],
      manifests: manifests.slice().sort(),
      missingManifest: [],
      unknownBlock: [],
      unavailable: `读不到 typescript 这个模块，没法解析 ${path.basename(registryPath)}`
        + ' —— 这不是关于注册表的读数，什么都没查（在 templates/nextjs 里跑 npm ci）',
    };
  }
  if (known.length === 0) {
    // 一个键都没读到 = 没找到 sectionRegistry 那个对象（改名了 / 换成别的写法了）。
    // 「什么都没数到」不是「全都对得上」：那样 34 个 manifest 会全部变成 unknownBlock，
    // 而这里说清楚它是仪器的问题。
    return {
      known: [],
      manifests: manifests.slice().sort(),
      missingManifest: [],
      unknownBlock: [],
      unavailable: `在 ${path.basename(registryPath)} 里没找到 sectionRegistry 那个对象字面量`
        + ' —— 什么都没查（它改名或换写法了？）',
    };
  }
  return {
    known: known.slice().sort(),
    manifests: manifests.slice().sort(),
    missingManifest: known.filter((t) => !manifests.includes(t)).sort(),
    unknownBlock: manifests.filter((t) => !known.includes(t)).sort(),
    unavailable: null,
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
  INDUSTRY_VOCABULARY,
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
  recogniseIndustry,
};
