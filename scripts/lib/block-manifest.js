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
// 🔴 `variants` 是过渡字段（阶段 3 随旧外观退役整字段删除）。它装的是**外观**词，喂的是建站提示词。
// 📌 #1341 —— 它旁边原来还有一个 `block_layout`（**内容结构**：这个块有没有配图 / 带不带表单），
//    两者并存。那一维整条退役了：可选槽位填没填由 `data-has-<槽位>` 说（#1331），带表单的首屏是
//    自己一个块类型 `hero-with-form`（#1333）。manifest 里 `block_layout` 与 `slots.variant`
//    两个键都没有了，`variants` / `variantKey` 留着（提示词要用）。
const fs = require('fs');
const path = require('path');
const { resolveBlockTypesForCheck } = require('../blocks');

const BLOCKS_DIR = path.join(__dirname, '..', '..', 'blocks');
// #1331 —— 形态层的另一半。manifest 的 `shapes` 清单跟这份 CSS 里出现的 (块, 形态) 对必须逐块相等
// （守卫 `block-shapes.test.js` 两向差集为 0；`checkManifestShape` 逐份核 manifest → CSS 这一向）。
const SHAPES_CSS = path.join(__dirname, '..', '..', 'public', 'shapes.css');
// #1332 —— 排版意图的词表。🔴 **一份定义，两处读**：这里（建站期的校验器，CommonJS）和
// `layout-intent.mjs`（几何守卫，ESM）。两边各抄一份词表的失败方向是静默的 —— 校验器放行一个词、
// 守卫不认识它，于是那一格什么都没判而没有人会红。
const LAYOUT_INTENT_VOCAB = require('./layout-intent-vocab.json');
const LAYOUT_INTENT_AXES = Object.keys(LAYOUT_INTENT_VOCAB.axes);

/**
 * 合并后的排版意图：块级 `layout_intent` 当默认，`shapes[i].layout_intent` 按轴覆盖（#1332）。
 * 形态不在这个块的清单里 ⟹ 回 null（跟「意图不全」分得开，同 `shapeNeedsGap` 的做法）。
 * 🔴 守卫与校验器判的都是**合并之后**的东西，而且合并后五根轴必须齐全 —— 那条闸堵的是
 *    「只声明各形态一致的那几根轴、把分歧最大的那根省掉」这条回避路（#1332 PM 退回第三条）。
 */
function layoutIntentFor(m, shapeName) {
  const sh = (m && Array.isArray(m.shapes) ? m.shapes : []).find((x) => x && x.name === shapeName);
  if (!sh) return null;
  return { ...((m && m.layout_intent) || {}), ...(sh.layout_intent || {}) };
}

/** 合并后的意图缺哪几根轴 / 哪几根写了词表外的值。回 [] 表示齐全且合法。 */
function layoutIntentProblems(intent) {
  const out = [];
  for (const ax of LAYOUT_INTENT_AXES) {
    const v = intent ? intent[ax] : undefined;
    if (v === undefined) { out.push(`缺 "${ax}" 这根轴`); continue; }
    if (!LAYOUT_INTENT_VOCAB.axes[ax].includes(v)) {
      out.push(`"${ax}" 写的是 ${JSON.stringify(v)} —— 只能是 ${LAYOUT_INTENT_VOCAB.axes[ax].join(' / ')}`);
    }
  }
  return out;
}

/**
 * `public/shapes.css` 里出现的 (块, 形态) 对 —— Map<块名, Set<形态名>>。
 * 只认 `[data-block="x"][data-shape="y"]` 这个组合选择器（形态层的全部规则都长这样，spec D4）。
 * 🔴 文件不在就抛，不回空表：空表会让「manifest 写的形态在 CSS 里没有规则」那条检查对一切沉默。
 */
function shapePairsFromCss(cssPath = SHAPES_CSS) {
  if (!fs.existsSync(cssPath)) {
    throw new Error(`${cssPath} 不存在 —— 形态清单的 CSS 那一半没了，manifest 的 shapes 没法核`);
  }
  const css = fs.readFileSync(cssPath, 'utf-8');
  const re = /\[data-block="([a-z0-9-]+)"\]\[data-shape="([a-z0-9-]+)"\]/g;
  const out = new Map();
  let mm;
  while ((mm = re.exec(css)) !== null) {
    if (!out.has(mm[1])) out.set(mm[1], new Set());
    out.get(mm[1]).add(mm[2]);
  }
  return out;
}

/**
 * 一个槽位「填了没」。🔴 三处用同一把尺（#1331）：第 ① 条（必填槽）、第 ⑥ 条（形态的 needs）、
 * 构建时写到块上的 `data-has-*`。分成三份实现的失败方向是静默的：校验放行、构建落回、DOM 又说填了。
 */
function slotFilled(v) {
  return !(v === undefined || v === null || v === '' || (Array.isArray(v) && v.length === 0));
}

/** manifest 的默认形态 —— `shapes[0].name`；没有清单就 undefined（别造兜底值，理由在 sync-config §shapeForBlock）。 */
function defaultShapeOf(m) {
  return m && Array.isArray(m.shapes) && m.shapes[0] && typeof m.shapes[0].name === 'string'
    ? m.shapes[0].name : undefined;
}

/**
 * 形态 `shapeName` 在这份 `data` 上缺哪些它 `needs` 的槽位（数组，空 = 一个不缺）。
 * 形态不在这个块的清单里 ⟹ 回 null，让调用方分得开「缺槽位」和「没这个形态」。
 * validateSite 第 ⑥ 条与 sync-config §shapeForBlock 都调它 —— 同一个判据，两处调（设计文档 D11 ⑥）。
 */
function shapeNeedsGap(m, shapeName, data) {
  const sh = (m && Array.isArray(m.shapes) ? m.shapes : []).find((x) => x && x.name === shapeName);
  if (!sh) return null;
  const d = data || {};
  return (Array.isArray(sh.needs) ? sh.needs : []).filter((slot) => !slotFilled(d[slot]));
}

/**
 * manifest 里 `required: false` 且在 `data` 里填了的槽位名 —— `data-has-<槽位>` 的来源（#1331）。
 * 🔴 名字沿用 manifest 的键原样（`imageUrl` 不改 kebab），shapes.css 和守卫两边才对得上。
 */
function filledOptionalSlots(m, data) {
  const d = data || {};
  return Object.entries((m && m.slots) || {})
    .filter(([slot, spec]) => spec && !spec.required && slotFilled(d[slot]))
    .map(([slot]) => slot);
}

/**
 * 这个块有哪些【内容图槽】—— 按槽位判，不按块名判（#1386）。回 [{ name, kind }]，
 * 顺序照 manifest 里槽位的书写顺序，`kind` 是 `'image'`（单图）或 `'list'`（每项一张）。
 *
 * 算：`kind: "image"` 的单图槽 · `kind: "list"` 且 `shape` 里带 `imageUrl` 的列表槽。
 * 不算：
 *   · 槽名是 `logo` / `logos` —— 那是生意自己的商标位，塞图库照片进去就是假商标。
 *   · 槽名是 `avatar` / `avatars`（#1361）—— 那是**顾客的脸**，跟下面 `socialProof` 那条是同一件事。
 *     #1361 给 `cta-banner` 加的 `avatars`（`kind: "list"` · `shape: "[{imageUrl}]"`）按上面那条本来
 *     会被算进来，而算进来买到的是**假脸**：列表槽的提示词（`image-slots.js §buildSlotPrompt`）写的是
 *     「4:3 detail or moment shot … product close-up / service action / interior detail」—— 生成的是
 *     店内细节照，被塞进 40×40 的圆框里。判据跟 `socialProof` 那条逐字同源：**顾客头像不是内容图**。
 *     🔴 名字这一层是有意的：写入闸那一侧（`image-urls.js` 的 `IMAGE_FIELDS`）必须仍然认得出
 *     `avatars[].imageUrl` 是一张图的地址（否则模型编的外链会落盘），所以字段名不能换 ——
 *     能分开这两件事的只有槽名。
 *   · `kind: "object"` —— hero 的 `socialProof` 的 shape 里**也有** `imageUrl`
 *     （`{avatars: [{imageUrl}], rating, text}`），但那是顾客头像不是内容图。这一条不是可省的
 *     小心眼：去掉它，每个站的 hero 就会多生成一批冒充真人的头像。
 *
 * 🔴 为什么这条规则住在这里：#1386 之前「哪些块能拿到图」是 create-site.js 里手写的四个块名，
 *    manifest 里新加的图槽进不来（`hero-with-form` 有图槽却永远拿不到图）。判据放在 manifest 这一侧，
 *    加槽的那张票不用回头改建站脚本。
 */
function imageSlotsOf(m) {
  const out = [];
  for (const [name, spec] of Object.entries((m && m.slots) || {})) {
    if (!spec || /^(logos?|avatars?)$/.test(name)) continue;
    if (spec.kind === 'image') { out.push({ name, kind: 'image' }); continue; }
    if (spec.kind === 'list' && typeof spec.shape === 'string' && spec.shape.includes('imageUrl')) {
      out.push({ name, kind: 'list' });
    }
  }
  return out;
}

/**
 * manifest 清单 vs shapes.css 集合的两向差集（守卫用）。`manifests` 是 Map 或按类型索引的对象。
 * 回 { onlyInCss: ["block/shape"…], onlyInManifests: ["block/shape"…] }，两个都空才算对齐。
 */
function diffShapesAgainstCss(manifests, cssShapes = shapePairsFromCss()) {
  const entries = manifests instanceof Map ? [...manifests.entries()] : Object.entries(manifests || {});
  const inManifests = new Set();
  for (const [type, m] of entries) {
    for (const sh of (m && Array.isArray(m.shapes) ? m.shapes : [])) {
      if (sh && typeof sh.name === 'string') inManifests.add(`${type}/${sh.name}`);
    }
  }
  const inCss = new Set();
  for (const [block, shapes] of cssShapes) for (const sh of shapes) inCss.add(`${block}/${sh}`);
  return {
    onlyInCss: [...inCss].filter((x) => !inManifests.has(x)).sort(),
    onlyInManifests: [...inManifests].filter((x) => !inCss.has(x)).sort(),
  };
}

// ── manifest 自己的形状（#1013 洞 2）────────────────────────────────────────────────────────────
//
// 🔴 为什么 manifest 也要有人校验：下面那五条检查**读的就是 manifest**，所以 manifest 里一个拼错的
// 字就等于把某一条检查静默关掉。实测（#999 ship 时 QA3 量的）：把 `blocks/hero.json` 的
// `roleDefault` 拼成 `"Essential"`（大写 E），②「角色只能加不能降」那条就再也不会报 ——
// `ROLE_RANK["Essential"]` 是 `undefined`，`ROLE_RANK[sec.role] < undefined` 恒为假。
// 三盏灯全绿，而那条检查已经不在了。同族的还有 `industries.required` 写成字符串（`.some` 报
// TypeError 或逐字符匹配）。
// 📌 #1341 —— 这里原来还列着「`block_layout` 写成字符串」那个例子，连同校验它的那条一起随
//    内容结构那一维退役了。
//
// 今天 34 份全部合法，所以这一条守的是**将来的编辑** —— 而将来的编辑正是它唯一会犯错的时候。
//
// 失败方式是 throw：manifest 是模板自己的文件（跟 registry.ts 同一类），不是某个站的数据。改坏它
// 的人此刻就在改模板，当场报错是他能修的；放过去则是 34 个块里某一个从此形同不存在。
const ROLE_NAMES = ['essential', 'lead', 'optional'];
// 提示词里的三组。`homepage` / `page-specific` 各由 `promptSection()` 印成一段清单；`page-rule` 的
// 四个块（quote-form / services-nav / services-list / contact-form）不进清单，它们由 create-site.js
// 里写死的页面规则点名（`create-site.js §generateContent`，data 那行仍从 manifest 来）。
const PROMPT_GROUPS = ['homepage', 'page-specific', 'page-rule'];

// ── #1352 —— 槽位的 `kind` 词表，以及「老板能直接改的字」这一维 ────────────────────────────────
//
// 🔴 落定这张词表的理由是**校验器此前只查 `kind` 是不是非空字符串**（下面 §checkManifestShape
// 那一行），所以写成 `"url"` / `"Text"` 这种也照样过 —— 而下游按 `kind` 分支的每一处都会静默地
// 走进「不认识、当默认处理」那一支。
const SLOT_KINDS = ['text', 'list', 'link', 'links', 'image', 'object', 'flag', 'control'];

// 🔴 **这八个不是抄来的，是量出来的，而且有一道守卫盯着它别过期**（§slotKindVocabularyProblems，
// 跑在 `block-manifest.test.js`）：它拿这个常量跟 `blocks/` 里**实际出现**的取值做两向差集，
// 哪一向不空都点名是谁。下次 main 再加一种 `kind`，红的是那道守卫、报的是那个槽位的名字，
// 不是这条注释再过期一次 —— 本票第一版就是照票里手抄的「六个」写死的，而 #1353 把顶栏页脚
// 做成块之后立刻多出两个（`links` / `control`），照那六个写死会当场拒掉 main 自己的 manifest。
// 现取（2026-09-18，28 份 manifest / 98 个槽位）：
//   text 56 · list 21 · link 7 · image 6 · links 3 · object 3 · control 1 · flag 1
//   links = footer.columns / footer.social / header.menu · control = header.language
//   node -e "const {loadManifests}=require('./scripts/lib/block-manifest.js');const c={};
//            for (const [,m] of loadManifests()) for (const s of Object.values(m.slots||{}))
//              c[s.kind]=(c[s.kind]||0)+1; console.log(c)"

// 🔴 **「哪些字是老板能直接改的」不从 `kind` 推，要显式标 `editLabel`。** 实测过 `kind` 答不了这个
// 问题：`kind: text` 里混着 `features-grid.columns`（列数）、`text-block.background`（`"gray"`）、
// `service-related-pages.serviceSlug`（一个 id）；反过来要改的文字不少在**子字段**上 ——
// `hero.ctaPrimary` 的 kind 是 `link` 而按钮上那行字是它的 `label`，21 个 `list` 槽每项里也都是文字。
//
// `editLabel` 的两种写法：
//   字符串 —— 这个槽位本身就是一行字：`"headline": {"kind":"text","editLabel":"Headline"}`
//   对象   —— 要改的是它的子字段：`"ctaPrimary": {"kind":"link","editLabel":{"label":"Button text"}}`
//                                 `"items": {"kind":"list","editLabel":{"title":"Item title"}}`
// 值是**英文人话名**（dashboard 是英文界面），不拿 `subheadline` 这种原文当界面文字 ——
// 跟 #1349 给块加顶层 `displayName` 同一条理由。
const EDIT_LABEL_KINDS = ['text', 'link', 'object', 'list'];

// 🔴 **`kind: text` 但【不是】老板要改的字** —— 只有这三个，写死在这里而不是靠「谁没标就算例外」。
// 方向是有意的：新加一个文字槽忘了标 `editLabel` ⟹ 当场红，而不是静默地不出现在面板上
// （后者跟「这个槽位还没做」长得一模一样）。
//
// 🔴 名单里每一项都要在 manifest 里找得到同名槽位，写错名字当场红 —— 一个拼错的例外等于把那个
// 槽位的检查关掉，而它看起来跟「已经豁免过了」一模一样。
const NON_EDITABLE_TEXT_SLOTS = [
  'features-grid.columns',          // 列数，不是文字
  'text-block.background',          // "gray" 这种取值
  'service-related-pages.serviceSlug', // 一个 id
];

// 🔴 **外壳区的两个块整块不进这一维** —— 它们没有「老板能直接改的字」这条路可走，不是「这几个槽位
// 不是文字」。`header` / `footer`（#1353）不经 `SectionRenderer` 渲染，`Header.tsx` / `Footer.tsx`
// 上今天连 `data-block-id` 都没有 ⟹ 点选检查器选不中它们，给它们标 `editLabel` 就是标一条谁也走不到
// 的路（面板列出输入框、改完保存、页面一个字不变，而没有任何东西会出声 —— 本票在 `blog-preview`
// 上已经抓过一次同形的假象）。
// 🔴 **所以它们也不进 `NON_EDITABLE_TEXT_SLOTS`**：那张名单说的是「这个槽位不是文字」，
// 而 `footer.copyright` / `footer.description` 恰恰**是**文字。两件事分两张表，理由才不会串。
// 📌 #1353 把外壳区接进检查器的那天，把这两个名字从这里拿掉、按普通块标 `editLabel` 即可。
const NO_SLOT_PATH_BLOCKS = ['header', 'footer'];

// ── #1352 —— 一份 manifest 上「老板能直接改的字」都在哪儿 ──────────────────────────────────────
//
// 🔴 **一份实现，两个调用方。** 面板按它列出可改的字，守卫按它跟组件里真的挂上的 `data-slot` 做差集。
// 两份实现的失败形态是「面板列出来的和组件挂上的对不上」，而两边各自都绿 —— 差集那道守卫用的要是
// 自己另算的一份，它就是在跟自己比。（这条教训的出处是 #1351：那张票里「找哪一条」被两个调用方
// 各写一遍，失败形态是「校验放行的是 A、写下去的是 B」。）
//
// 回一个数组，每项 `{ path, label, slot, kind, sub }`：
//   · `path`  组件上 `data-slot` 要写的值 —— **不带列表序号**。列表项的实际属性是 `items.2.title`，
//              而这里回的是 `items.title`；两边比之前由 §stripSlotIndex 把序号去掉（AC1 那条差集）。
//   · `sub`   子字段名（`editLabel` 写成对象时才有），顶层槽位是 `null`。
function editableSlotPaths(manifest) {
  const out = [];
  for (const [slot, s] of Object.entries((manifest && manifest.slots) || {})) {
    if (!s || s.editLabel === undefined) continue;
    if (typeof s.editLabel === 'string') {
      out.push({ path: slot, label: s.editLabel, slot, kind: s.kind, sub: null });
      continue;
    }
    for (const [sub, label] of Object.entries(s.editLabel)) {
      out.push({ path: `${slot}.${sub}`, label, slot, kind: s.kind, sub });
    }
  }
  return out;
}

// #1352 —— 例外名单里每一项，在 manifest 里都找得到同名槽位吗。
//
// 🔴 **它不挂在 `loadManifests` 上，这是量出来的**：第一版挂在那儿，结果任何**局部**的 manifest
// 夹具（`block-catalog.test.js` 只造一份 `alpha.json`）一加载就抛 —— 名单点名的 `features-grid`
// 根本不在那份夹具里。它查的是**全仓的一条不变量**，不是「这一批 manifest 合不合法」，所以它的家
// 是 `test:scripts`，调用方拿全套 `blocks/` 喂它。
//
// 🔴 它守的是**唯一**逐槽位那条检查够不着的那一格：一个例外**什么都没豁免**（块名或槽位名拼错）。
// 拼错槽位名的另一半由逐槽位那条兜住 —— 那个槽位不再被豁免，于是它当场变成「kind: text 却没有
// editLabel」而红（`block-manifest.test.js` ⑫ 里两格分别钉着这两条路）。
//
// 回一个字符串数组，空数组 = 名单是干净的。
// #1352 —— 词表常量跟 `blocks/` 里**实际在用**的取值对得上吗（两向差集）。
//
// 🔴 它治的是**这张常量表自己会过期**：本票第一版照票里手抄的六个写死，而 #1353 把顶栏页脚做成块
// 时带进了 `links` / `control` 两个新取值 —— 那种过期的样子跟没过期一模一样，直到有人建站时撞上
// 「kind 只能是 …」当场拒。加了这一道之后，失败方向变成**守卫点名**：哪个取值多了、哪个少了、
// 少的那个是被哪几个槽位在用。
//
// 🔴 跟 §nonEditableExceptionProblems 同一个安排：**不挂在 `loadManifests` 上**。它查的是全仓的一条
// 不变量，而局部 manifest 夹具（`block-catalog.test.js` 只造一份 `alpha.json`）按构造凑不齐八个取值，
// 挂上去就是一片跟被测那一维无关的红。所以它的家在 `test:scripts`，调用方拿全套 `blocks/` 喂它。
//
// 两向各报一次，回一个字符串数组，空数组 = 对得上。
function slotKindVocabularyProblems(manifests, kinds = SLOT_KINDS) {
  const byType = manifests instanceof Map ? manifests : new Map(Object.entries(manifests || {}));
  const used = new Map();
  for (const [type, m] of byType) {
    for (const [slot, s] of Object.entries((m && m.slots) || {})) {
      if (!s || typeof s.kind !== 'string' || !s.kind) continue;
      if (!used.has(s.kind)) used.set(s.kind, []);
      used.get(s.kind).push(`${type}.${slot}`);
    }
  }
  const out = [];
  // 一向：manifest 在用、词表里没有 —— 点名是哪几个槽位在用它（谁都建不出站的那一向）。
  for (const kind of [...used.keys()].sort()) {
    if (!kinds.includes(kind)) {
      out.push(`blocks/ 里有槽位在用 kind: ${JSON.stringify(kind)}，而词表里没有它 —— 用它的是 `
        + `${used.get(kind).sort().join(' / ')}`);
    }
  }
  // 另一向：词表里写着、全仓一个槽位都不用 —— 多半是删块/改槽之后忘了收，留着它就等于把
  // 「kind 只能是这几个」那条检查悄悄放宽一格。
  for (const kind of kinds) {
    if (!used.has(kind)) {
      out.push(`词表里写着 ${JSON.stringify(kind)}，而今天 blocks/ 里没有任何槽位在用它`);
    }
  }
  return out;
}

function nonEditableExceptionProblems(manifests, list = NON_EDITABLE_TEXT_SLOTS) {
  const byType = manifests instanceof Map ? manifests : new Map(Object.entries(manifests || {}));
  const out = [];
  for (const ref of list) {
    const [type, slot] = ref.split('.');
    const m = byType.get(type);
    if (!m) { out.push(`NON_EDITABLE_TEXT_SLOTS 里写着 "${ref}"，而 blocks/ 里没有 ${type} 这个块`); continue; }
    if (!m.slots || m.slots[slot] === undefined) {
      out.push(`NON_EDITABLE_TEXT_SLOTS 里写着 "${ref}"，而 ${type} 没有 ${slot} 这个槽位`);
    }
  }
  return out;
}

// 把一个真实的 `data-slot` 值归一成 manifest 里那条路径：去掉纯数字的那一段（列表序号）。
// `items.2.title` → `items.title`；`headline` 原样。
function stripSlotIndex(value) {
  return String(value).split('.').filter((seg) => !/^\d+$/.test(seg)).join('.');
}

function checkManifestShape(name, m, cssShapes) {
  const bad = (msg) => { throw new Error(`blocks/${name}: ${msg}`); };
  const isStr = (v) => typeof v === 'string' && v.length > 0;
  const strArray = (v) => Array.isArray(v) && v.every(isStr);

  // #1349 —— 这个块给**用户**看的名字。点选检查器的右侧面板显示的就是它。
  //
  // 🔴 必填，而且不许拿 `type` 顶替：`hero` / `cta-banner` 是内行黑话，CLAUDE.md 的术语冻结不许它
  // 出现在用户可见 UI。少一个的失败方向是静默的 —— 面板会显示 `undefined`（或者退化成类型原文），
  // 而那一格看起来就像「这个块没名字」，没有人会红。所以在这儿当场拒。
  // 🔴 也不是 manifest 里的 `label`：那是**槽位**名（`divider.json` 的 `slots.label`、按钮的
  // `{label, href}`），跟「这个块叫什么」是两件事。
  if (!isStr(m.displayName)) {
    bad(`displayName 是 ${JSON.stringify(m.displayName)} —— 必须是非空字符串（给用户看的名字，`
      + '编辑器右侧面板显示的就是它；不许拿 type 原文顶替，那是内行黑话）');
  }
  if (!isStr(m.category)) bad('category 必须是非空字符串');
  if (!ROLE_NAMES.includes(m.roleDefault)) {
    bad(`roleDefault 是 ${JSON.stringify(m.roleDefault)} —— 只能是 ${ROLE_NAMES.join(' / ')}`
      + '（全小写，大小写错会让「角色只能加不能降」那条检查静默失效）');
  }
  if (m.slots === null || typeof m.slots !== 'object' || Array.isArray(m.slots)) bad('slots 必须是对象');
  for (const [slot, s] of Object.entries(m.slots)) {
    if (s === null || typeof s !== 'object') bad(`slots.${slot} 必须是对象`);
    if (!isStr(s.kind)) bad(`slots.${slot}.kind 必须是非空字符串`);
    // #1352 —— 取值也要在词表里。只查「是非空字符串」的话，`"url"` / `"Text"` 这种照样过，
    // 而下游每一处按 kind 分支的地方都会静默走进「不认识」那一支。
    if (isStr(s.kind) && !SLOT_KINDS.includes(s.kind)) {
      bad(`slots.${slot}.kind 是 ${JSON.stringify(s.kind)} —— 只能是 ${SLOT_KINDS.join(' / ')}`);
    }
    // #1352 —— 可改文字这一维的两条。
    if (s.editLabel !== undefined) {
      if (!EDIT_LABEL_KINDS.includes(s.kind)) {
        bad(`slots.${slot} 的 kind 是 ${JSON.stringify(s.kind)}，不该有 editLabel`
          + `（只有 ${EDIT_LABEL_KINDS.join(' / ')} 这几种装得下老板能直接改的字）`);
      }
      if (isStr(s.editLabel)) {
        // 这个槽位本身就是一行字 —— 没别的要查的。
      } else if (s.editLabel !== null && typeof s.editLabel === 'object' && !Array.isArray(s.editLabel)) {
        const keys = Object.keys(s.editLabel);
        if (!keys.length) bad(`slots.${slot}.editLabel 是空对象 —— 要么写一个字符串，要么列出子字段`);
        for (const k of keys) {
          if (!isStr(s.editLabel[k])) bad(`slots.${slot}.editLabel.${k} 必须是非空字符串（给人看的名字）`);
        }
      } else {
        bad(`slots.${slot}.editLabel 必须是字符串，或者一个「子字段 → 名字」的对象`);
      }
    } else if (s.kind === 'text' && !NO_SLOT_PATH_BLOCKS.includes(name.replace(/\.json$/, ''))
      && !NON_EDITABLE_TEXT_SLOTS.includes(`${name.replace(/\.json$/, '')}.${slot}`)) {
      // 🔴 这一条的方向：忘了标当场红，不是静默不出现在面板上。后者跟「这个槽位还没做」
      //    在界面上长得一模一样，而这正是本票要治的那族毛病。
      bad(`slots.${slot} 是 kind: text 但没有 editLabel —— 要么标上（老板能直接改的字），`
        + `要么把它加进 block-manifest.js 的 NON_EDITABLE_TEXT_SLOTS（现在名单上是 `
        + `${NON_EDITABLE_TEXT_SLOTS.join(' / ')}）`);
    }
    if (typeof s.required !== 'boolean') bad(`slots.${slot}.required 必须是 true/false（现在是 ${JSON.stringify(s.required)}）`);
    if (typeof s.promptOptional !== 'boolean') bad(`slots.${slot}.promptOptional 必须是 true/false`);
    if (s.shape !== undefined && !isStr(s.shape)) bad(`slots.${slot}.shape 有的话必须是非空字符串`);
  }
  // #1331 —— 形态清单。第 0 项是默认；每项 { name, needs }。四条都是白名单式（拼错键要当场红，不许静默）：
  //   name 在 public/shapes.css 里必须有 [data-block="<块>"][data-shape="<name>"] 的规则；
  //   needs 里每个名字必须是这个块 slots 的键；默认那项的 needs 必须为空（缺槽位落回的就是它）。
  if (!Array.isArray(m.shapes) || m.shapes.length === 0) {
    bad(`shapes 是 ${JSON.stringify(m.shapes)} —— 必须是非空的【数组】，第 0 项是默认形态（每项 { "name", "needs" }）`);
  }
  const shapeNames = new Set();
  m.shapes.forEach((sh, i) => {
    if (sh === null || typeof sh !== 'object' || Array.isArray(sh)) bad(`shapes[${i}] 必须是对象 { name, needs }`);
    if (!isStr(sh.name)) bad(`shapes[${i}].name 必须是非空字符串`);
    if (shapeNames.has(sh.name)) bad(`shapes 里 "${sh.name}" 写了两次`);
    shapeNames.add(sh.name);
    if (!strArray(sh.needs)) {
      bad(`shapes[${i}] ("${sh.name}").needs 是 ${JSON.stringify(sh.needs)} —— 必须是字符串【数组】（不需要槽位就写 []）`);
    }
    for (const slot of sh.needs) {
      if (!Object.prototype.hasOwnProperty.call(m.slots, slot)) {
        bad(`shapes[${i}] ("${sh.name}").needs 里的 "${slot}" 不是这个块的槽位（slots 的键：${Object.keys(m.slots).join(' / ') || '（空）'}）`);
      }
      // needs 只说【可选】槽位：必填槽由第 ① 条保证到位，写在这儿是重复声明，而且会让默认形态
      // 也「有需要」—— 那样缺槽位就无处可落（下面那条）。
      if (m.slots[slot].required !== false) {
        bad(`shapes[${i}] ("${sh.name}").needs 里的 "${slot}" 是必填槽 —— needs 只写 required:false 的槽位（必填的由第 ① 条保证）`);
      }
    }
    if (i === 0 && sh.needs.length > 0) {
      bad(`shapes[0] ("${sh.name}") 是默认形态，needs 必须为空 —— 别的形态缺槽位落回的就是它，它自己再缺就无处可落`);
    }
    // #1384 —— `candidate: true` 说的是「这个形态**过了全部机器检查，但 Chris 还没点头**」。
    //
    // 它是身份，不是豁免：候选**进** `shapes.css`、**进** `blockShapeCatalog()`、**过**每一道自动
    // 检查（含 #1332 那道排版意图闸）—— 唯独不进任何一条会让真站戴上它的路（主题选择单：
    // `theme-pipeline/shape-sheet.js`；页面 JSON：`sync-config.js` §shapeForBlock）。Chris 说「进」
    // 就删掉这个键，一行改动。
    //
    // 🔴 它必须被**声明**，跟上面 `hooksFrom` / 下面 `region` 同一条路：不许靠别的字段推。推出来的
    //    身份没人守，改那个字段的人不会知道自己让一个未签字的形态戴到了客户站上。
    if (sh.candidate !== undefined && typeof sh.candidate !== 'boolean') {
      bad(`shapes[${i}] ("${sh.name}").candidate 有的话必须是 true/false（现在是 ${JSON.stringify(sh.candidate)}）`
        + ' —— 它说的是「这个形态还没被 Chris 点头，别让真站戴上」');
    }
    // 🔴 **默认形态不许是候选**，而这一条就是「`defaultShapeOf` 不许回一个候选」的**唯一**写法
    //    （`defaultShapeOf` 取的就是 `shapes[0]`，PM 2026-09-17 定：实现一处，别写成两道判据）。
    //    少了它，上面那两条「不许戴上候选」的路会把站落回默认——而默认自己就是候选，整条堵法作废。
    if (i === 0 && sh.candidate === true) {
      bad(`shapes[0] ("${sh.name}") 是默认形态，不许标 candidate —— 别的形态点名候选时落回的就是它，`
        + '它自己是候选的话「候选不许上真站」这条就从落回那一端整个漏掉');
    }
    // `name` 是文件名（带 .json），CSS 里点名用的是块类型 —— 上面 loadManifests 已核过两者对得上。
    // #1332 —— 每个形态一段排版意图（可以只写跟块级默认不同的轴，但**合并之后**五根轴必须齐全）。
    if (sh.layout_intent !== undefined
      && (sh.layout_intent === null || typeof sh.layout_intent !== 'object' || Array.isArray(sh.layout_intent))) {
      bad(`shapes[${i}] ("${sh.name}").layout_intent 有的话必须是对象（五根轴 → 词表里的一个词）`);
    }
    const merged = { ...(m.layout_intent || {}), ...(sh.layout_intent || {}) };
    for (const k of Object.keys(merged)) {
      if (!LAYOUT_INTENT_AXES.includes(k)) {
        bad(`shapes[${i}] ("${sh.name}") 的 layout_intent 里有一根不存在的轴 "${k}" —— 只有 ${LAYOUT_INTENT_AXES.join(' / ')}`
          + '（拼错的轴名不会有任何断言去读它，而那是静默的：守卫照跑、这一根永远没人判）');
      }
    }
    const gaps = layoutIntentProblems(merged);
    if (gaps.length) {
      bad(`shapes[${i}] ("${sh.name}") 的排版意图不完整：${gaps.join('；')}。`
        + '🔴 五根轴一根都不能省 —— 省掉的那一根恰好是这个块两种形态分歧最大的地方时，守卫会全绿而'
        + '什么都没看（#1332 PM 退回的第三条）');
    }
    const inCss = cssShapes instanceof Map ? cssShapes.get(m.type) : undefined;
    if (!inCss || !inCss.has(sh.name)) {
      bad(`shapes 里的 "${sh.name}" 在 public/shapes.css 没有 [data-block="${m.type}"][data-shape="${sh.name}"] 的规则`
        + ' —— 写进 manifest 的形态必须有人排它（要加形态先写 CSS）');
    }
  });
  if (m.layout_intent !== undefined
    && (m.layout_intent === null || typeof m.layout_intent !== 'object' || Array.isArray(m.layout_intent))) {
    bad('layout_intent 有的话必须是对象（块级默认，形态可以按轴覆盖）');
  }
  if (m.variants === null || typeof m.variants !== 'object' || Array.isArray(m.variants)) {
    bad('variants 必须是对象（外观词 → 一句说明）');
  }
  if (m.variantKey !== undefined && !isStr(m.variantKey)) bad('variantKey 有的话必须是非空字符串');
  // #1333 —— `hooksFrom` 说的是「这个块的 HTML 用的是**另一个块**那套部件类名」。
  //
  // 今天只有一个：`hero-with-form` 渲染的是 `.hero` / `.hero__body` / `.hero__form` 这一家
  // （`src/components/sections/HeroWithFormSection.tsx` 上写了为什么 —— 皮那一层按类名写，两个块
  // 本来就是同一副骨架、同一块底，真正的差别是「有没有那个表单」，而那由块类型说，不由类名说）。
  //
  // 🔴 它必须被**声明**，不能靠读组件源码猜：`theme-pipeline/sheet-recipes.test.js` ⑫ 的分母自检
  // 拿「block-roles.json 的块」跟「钩子清单里的块」对差集，而一个借用别人类名的块在后者里按构造
  // 不存在 ⟹ 那一格会 die 在一个其实正确的状态上。有了这个键，两边就能说清是哪一个块、为什么。
  // 指向的必须是真块（拼错的话那一格又会把它当成「少了一个块」）—— 这一条在 loadManifests 里核，
  // 因为这里看不到别的 manifest。
  if (m.hooksFrom !== undefined && !isStr(m.hooksFrom)) {
    bad('hooksFrom 有的话必须是非空字符串（另一个块的 type —— 这个块的 HTML 用的是它那套部件类名）');
  }

  // #1353 —— `region: true` 说的是「这个块是**外壳区**，不是页面里的内容块」。今天只有两个：
  // `header` / `footer`（顶栏页脚从 D14 的已知例外搬进形态层之后，它们跟别的 32 个块共用 manifest、
  // 形态层、选择单和守卫，唯独**不进页面 JSON** —— 哪一页有没有它们由 page layout 库说，
  // `SiteShell.tsx` 渲染，`registry.ts` 那张「页面 JSON 的 type → 组件」的表里按构造不该有它们）。
  //
  // 🔴 它必须被**声明**，不能靠 `category === 'region'` 之类去推：`category` 今天是自由文本
  // （上面那条只校验它是非空字符串，17 个取值没有任何消费者），拿它当判据就是把一个没人守的字段
  // 悄悄变成承重件 —— 改一个 category 的人不会知道自己关掉了一道闸。同一条理由写在上面 `hooksFrom`
  // 那段里，那是本仓第一个走这条路的键。
  if (m.region !== undefined && typeof m.region !== 'boolean') {
    bad(`region 有的话必须是 true/false（现在是 ${JSON.stringify(m.region)}）—— 它说的是「这个块是外壳区，不进页面 JSON、不在 registry.ts 里」`);
  }

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
  // #1331 —— CSS 那一半读一次给每份 manifest 核。路径按 dir 推（`<dir>/../public/shapes.css`），测试用临时
  // 目录时把 CSS 也摆到同样的相对位置。
  // 🔴 先 realpath：homepage-recipe.test.js 那类夹具只把 `blocks/` **软链**进临时树、不带 `public/`，按软链
  //    的位置推会推到一个不存在的 public/ ⟹ 整个 create-site 在提示词那一步就死（第一版就是这么把它打红的）。
  //    顺着软链到真目录再推，读到的是那份 blocks/ 真正配套的 CSS。
  const cssShapes = shapePairsFromCss(path.resolve(fs.realpathSync(dir), '..', 'public', 'shapes.css'));
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
    checkManifestShape(name, m, cssShapes);
    byType.set(m.type, m);
  }
  // #1333 —— `hooksFrom` 指的必须是这一批里真的有的块。拼错的方向是静默的：借用关系认不出来，
  // 于是那个块在「钩子清单里有没有它」那道差集里被当成漏了一个块（见 checkManifestShape 里那段）。
  for (const [type, m] of byType) {
    if (m.hooksFrom !== undefined && !byType.has(m.hooksFrom)) {
      throw new Error(`blocks/${type}.json: hooksFrom 指向 "${m.hooksFrom}"，而 blocks/ 里没有这个块`);
    }
    if (m.hooksFrom === type) {
      throw new Error(`blocks/${type}.json: hooksFrom 指向自己 —— 它说的是「借用【别的】块那套部件类名」`);
    }
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
 * 🔴 那一行是**新加的**，其余逐字节是今天那段散文（交付时对着 origin/main 比过：把它去掉之后
 * 与原文完全相同）。加它是因为 AC5 要「改 manifest 里写的东西，提示词跟着变」—— 也就是这段文字
 * 必须真的把 manifest 里的行业说给 AI 听，而不只是重排原来的散文。
 * 📌 #1341 —— 原来还有第二行 `content structures: …`（从 manifest 的 `block_layout` 印出来的）。
 *    内容结构那一维整条退役了，所以那一行和它的来源一起没了。
 */
function promptEntry(m) {
  const lines = [headLineFor(m)];
  for (const l of (m.prompt && m.prompt.lines) || []) {
    lines.push(`  ${l === '@data' ? dataLineFor(m) : l}`);
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

/** promptEntry 去掉 manifest 独有的那一行（#1341 之前是两行）—— 只给「跟今天那段散文逐字节相同」那条判据用。 */
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
 *    另一个块写成 `plans`+`categories`）。那几个键名跟组件真读的对不上，
 *    所以这四块**今天在页面上本来就是空的**；本票要是硬拦，它们会从「空一块」变成「打不开」。
 *    其中一个站建于 2026-08-07，不是只有老站才有的形状 —— 而 `edit-site.js §executeTool` 的 `JSON.parse` 只校验
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
function validateSite({ pages, industry = '', dir, scope = 'create', siteBlocks = {}, disabledBlocks = [] } = {}) {
  const manifests = loadManifests(dir);
  // #1346 —— 后台「区块与主题」页关掉的那些块。只有建站那条路会传（create-site.js 的两个调用点），
  // 构建期和 AI 改站那两条路不传 ⟹ `off` 是空集合，下面两处一个字节都不改变行为。
  const off = new Set((disabledBlocks || []).filter((t) => typeof t === 'string' && t));
  const problems = [];
  const warnings = [];
  const seenTypes = new Set();
  // 全部检查经这里出口 —— 别在下面直接 push，否则漏掉一条就又出现一个构建期硬闸。
  //（第 ⑤ 条是 #1152 加的，第 ⑥ 条是 #1331 加的；第 ④ 条在循环**之后**，因为它问的是整个站，不是某一个块。）
  const flag = (msg) => (scope === 'build' ? warnings : problems).push(msg);

  for (const page of pages || []) {
    for (const [i, sec] of blocksOf(page).entries()) {
      // 🔴 #1154 —— `blocks` 数组里那一格根本不是块（`null` / 一个字符串 / 一个数组）。
      //    在这条守卫之前，下面那句 `sec.type` 直接抛 `TypeError: Cannot read properties of
      //    null (reading 'type')`，而这个函数的调用方是按「返回 problems」写的：
      //    `create-site.js §generateContent` 那个 `if` 拿 problems 决定要不要**重试一次**（问题由
      //    `const first = validateBlocks({ pages: ai.pages, industry })` 产出；重试之后
      //    `issues = validateBlocks({ … }).problems` 重取一遍，`switch (afterRetry({ … }))` 下判决）。
      //    📌 #1157（来源 #1154）更正：这里原写成「那两次 `validateBlocks` 调用拿 problems 决定」—— 它们是
      //    **调用点**，不是决定点；做决定的是 `if (issues.length || skinIssues.length)`。本文件下面
      //    #1155 那段注释（「伤害不止「日志里多一行」」那句）指的就是同一个 `if` —— 两句原来是打架的。
      //    🔴 这里不写「往下 N 行 / 本文件 :NNN」：改这段注释本身就会把那个数挤走
      //    （我第一版写了 `:417`，加完这四行它就变成 `:421` 了）。按内容指，别按行号指。
      //    抛异常则一路冒到顶层的 `main().catch(err => {`（`create-site.js` 末尾那三行）⟹ 建站直接死，
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
      //    伤害不止「日志里多一行」：`create-site.js §generateContent` 拿 `problems.length` 决定要不要让模型
      //    重写一遍 ⟹ 一条不存在的问题烧掉一次真的 API 调用，而重写之后它**还在**（它跟模型写得
      //    对不对无关），`switch (afterRetry({ … }))` 于是读到「重试也没修好」。而 #1154 印进提示词的
      //    那句话（本文件上面那句 `flag('… blocks 数组里只能放块对象（`{ "type": … }` 或 `{ "ref": … }`）')`）
      //    正在逐字告诉模型 ref 是合法格子。
      //
      // 🔴 这里**只压掉这一条报文**，没有新加「见到 ref 就整格 continue」那种口子：`continue` 是
      //    这一支本来就有的（没有 manifest 就没有 `m.slots` / `m.roleDefault`，下面第 ①②⑤⑥ 条
      //    逐条都要读 `m`，物理上跑不了）。上面 #1154 那道「这一格是不是块」的检查
      //    仍然照跑 —— ref 条目是对象，它本来就从那里正常通过。
      //
      // 🔴 谓词比 `edit-site.js §ownBlocksOf` 严一格，多一个「而且没写 type」：
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

      // ⑦ #1346 —— 这个块被关掉了。只有建站那条路会传清单进来，所以这条检查也只在那一刻存在。
      //
      // 🔴 它必须是 problem 而不是只剔菜单就算了：菜单是**建议**，模型照旧可以吐一个不在清单上的
      //    块名（清单也不是它唯一的语料，提示词别处还点名过几个块）。剔菜单少了这一条，"关掉了"
      //    这件事就只有在模型听话的时候才成立 —— 而那是一个不可复算的条件。进 problems 之后它走的
      //    是这个函数本来就有的那条路:重试一次，再不行 create-site.js §generateContent 干净失败。
      if (off.has(sec.type)) {
        flag(`${where}: 这个块已经在后台关掉了 —— 换一个（后台「区块与主题」页可以重新打开它）`);
      }

      // ① 必填槽
      const data = sec.data || {};
      for (const [slot, spec] of Object.entries(m.slots)) {
        if (!spec.required) continue;
        // #1331 —— 「空」的判据抽成 slotFilled，跟第 ⑥ 条、data-has-* 同一把尺；语义逐字没变。
        if (!slotFilled(data[slot])) flag(`${where}: 缺必填槽 "${slot}"（blocks/${sec.type}.json 里写着 required）`);
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

      // 📌 ③ 曾经是「block_layout 只能取 manifest 列出的值」。#1341 把内容结构那一维整条退役了
      //    （设计文档 D15 ③ 写的就是「随 data-block-layout 退役一起删」），所以这里没有第 ③ 条。
      //    老站页面 JSON 里残留的那个键由 `scripts/blocks.js` 读的时候丢掉，不报错。

      // ⑥ #1331（设计文档 D11 ⑥）—— 页面 JSON 点名的形态，它 needs 的槽位填了没。判据是 shapeNeedsGap，
      //    跟 sync-config §shapeForBlock 构建时落回默认用的是**同一个函数**：这里说「会落回」，那里真落回。
      //    形态不在清单里也在这条报。
      if (sec.shape !== undefined) {
        const gap = shapeNeedsGap(m, sec.shape, data);
        const names = (m.shapes || []).map((x) => x.name).join(' / ');
        if (gap === null) {
          flag(`${where}: shape "${sec.shape}" 不在 blocks/${sec.type}.json 的 shapes 清单里（${names}）`);
        } else if (gap.length > 0) {
          flag(`${where}: shape "${sec.shape}" 需要槽位 ${gap.map((x) => `"${x}"`).join('、')} 而它是空的`
            + ` —— 构建时会落回默认 "${defaultShapeOf(m)}"（shapes[0]）；要么填上，要么别点名这个形态`);
        }
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
  //    而那个块在产物里是有的。伤害不是日志多一行：`create-site.js §generateContent` 拿 problems 决定要不要让
  //    模型重写一遍，而这条问题跟模型写得对不对无关、重写之后还在 ⟹ `afterRetry` 判 `fatal`，
  //    整次建站死（#1155 QA1 的圈外发现 ①）。
  //    🔴 #1149 item 31 —— 上面那句「整次建站死」**今天走不到**，读的时候别当成正在发生的事:
  //    要有「只由站级块提供的块」，站级块库就得非空，而建站脚本手上那份按构造是空的 ——
  //    `create-site.js` §generateContent 调 `validateBlocks({ pages, industry })` **不传** `siteBlocks`
  //    （本文件 `:387` 的默认值就是 `{}`），而且 `create-site.js §main` 开工先删整个 `site/`，
  //    全仓唯一产出 `blocks/site-blocks.json` 的 `edit-site.js` 发生在建站之后。
  //    ⟹ 准确说法：**若站级块库非空**，那条链才成立;今天这一半尚未可达。这一条改动本身照旧成立
  //    （它让第 ④ 条问的是「解析完之后这个站有哪些块」，而不是「页面文件里写了哪些」）。
  //    解析规矩不在这里写第二份 —— 用 `blocks.js` 的 `resolveBlockTypesForCheck`，它跟构建期的
  //    `normalizeLocalePages` 共用**同一套「哪些块出现在这一页」**的规矩（ref 指得到就换成目标的
  //    type、指不到就丢掉、visibility 命中的追加）。⚠️ 但**顺序那一维两者不同**（#1149 item 32:
  //    `normalizeLocalePages` 追加完还按 weight 排一次，那个函数不排）—— 第 ④ 条问的是**集合**，
  //    不问顺序，所以这里不受影响;理由整段写在那个函数的头注上。逐块那几条检查（①②③⑤）**一个字都没动**：它们问的是「这一格自己填对了没有」，
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
      // #1346 —— 关掉压过「行业必需」。少了这一句，关掉 contact-info（它写着 required: ["*"]）之后
      // **每一个**新站都建不出来：菜单里没有它 ⟹ 模型不放 ⟹ 这里报 problem ⟹ 重试仍缺 ⟹
      // create-site.js 那句 fatal。关掉一个块的意思是「以后别再选它」，不是「以后建不出站」。
      if (off.has(m.type)) continue;
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

/** 这个块是不是外壳区（manifest 里显式写了 `region: true`）。#1353。 */
function isRegionManifest(dir, type) {
  const m = loadManifests(dir).get(type);
  return !!(m && m.region === true);
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
    // #1353 —— 外壳区（`region: true`）按构造不在 registry.ts 里：那张表是「页面 JSON 里写的 type
    // → 渲染它的组件」，而顶栏页脚不进页面 JSON（由 page layout 库决定哪一页有它们，`SiteShell.tsx`
    // 渲染）。把它们算进 `unknownBlock` 会让 sync-config 那道 `process.exit(1)` 拒掉**每一个站**。
    // 🔴 反过来那一半（`missingManifest`）一个字没改：registry 里有而 blocks/ 里没有，仍然是错。
    unknownBlock: manifests.filter((t) => !known.includes(t) && !isRegionManifest(dir, t)).sort(),
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
  // #1343 —— 注册表**自己声明的顺序**（`registryCoverage` 回的那两张单子是排过序的，那是为了做差集）。
  // 图册按这个顺序排行、`gen-allblocks.js` 按这个顺序写那一页 —— 它们要的是「注册表里写成什么样」，
  // 不是字典序（改成字典序会把那一页既有的 section 顺序整个换掉）。
  registryNames,
  isRegionManifest,
  applyRoleDefaults,
  industryMatches,
  recogniseIndustry,
  // #1331 —— 形态层
  SHAPES_CSS,
  shapePairsFromCss,
  slotFilled,
  defaultShapeOf,
  shapeNeedsGap,
  filledOptionalSlots,
  // #1386 —— 「这个块有哪些内容图槽」，建站选图那条路的唯一判据
  imageSlotsOf,
  diffShapesAgainstCss,
  // #1352 —— 槽位的 kind 词表 + 「老板能直接改的字」这一维
  SLOT_KINDS,
  EDIT_LABEL_KINDS,
  NON_EDITABLE_TEXT_SLOTS,
  NO_SLOT_PATH_BLOCKS,
  nonEditableExceptionProblems,
  slotKindVocabularyProblems,
  editableSlotPaths,
  stripSlotIndex,
  // #1332 —— 排版意图
  LAYOUT_INTENT_VOCAB,
  LAYOUT_INTENT_AXES,
  layoutIntentFor,
  layoutIntentProblems,
};
