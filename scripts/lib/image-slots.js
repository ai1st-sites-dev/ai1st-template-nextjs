// ══════════════════════════════════════════════════════════════════════════════════════════════════
// image-slots.js — 建站时「哪些槽要图、怎么求那张图、求不到怎么说」（#1386）
// ══════════════════════════════════════════════════════════════════════════════════════════════════
//
// 在这之前，这件事是 `create-site.js` 里手写死的四个块名（hero / cta-banner / content-split /
// gallery），加 `buildSlotPrompt` 里逐块一个 `case`。后果量过两处：
//   · `hero-with-form` 有 `imageUrl` 槽却永远拿不到图 —— 它不在那份名单里。
//   · `cta-banner` 在名单里却一个图槽都没有（`CtaBannerSection.tsx` 里 `imageUrl` 命中 0），
//     每个站为它生成的那张图没有任何地方显示。
// 名单改成按 manifest 现算之后，加图槽的那张票不用回头改建站脚本。
//
// 🔴 判据按【槽位】不按【块名】。写成块名单等于把今天要删的那份手写清单换个地方再写一遍。
//    「哪些槽算内容图槽」的唯一定义在 `block-manifest.js §imageSlotsOf`，这里只负责走页面、
//    排顺序、管上限、把结果写回去。
//
// 🔴 这里不碰网络、不碰磁盘。真去生成图片那一步由调用方传进来（`produce`）：
//    建站那条路拿它去调 Nano Banana 并把字节写盘，skipAI 那条路拿它回一张本地占位图。
//    这样这份逻辑能在 `test:scripts` 里被完整跑一遍，不需要任何外部凭证。
const { imageSlotsOf, blocksOf } = require('./block-manifest');
const { effectiveKnobs } = require('./block-knobs');
// #1549 —— 「哪些图算内容图」「alt 含不含目标词」跟 seoProblems 第 6 条用同一份判据（两份实现会让生产侧和检查侧各挑一张）。
const { contentImagesOf, hasPhrase } = require('./seo-problems');
const crypto = require('crypto');
const { FILENAME_MAX_BYTES } = require('./keyword-slug');

/**
 * 页面里每一个内容图槽，按「页面 → 块 → 槽 → 列表项」的书写顺序。
 *
 * 🔴 **槽里现在有没有值都收** —— 这是 #1386 之前就有的行为，不是疏忽：AI 自己填进 `imageUrl`
 *    的那个值不可信（TICKET-172 实例：它会编出 `gradient-about` 这种字符串，最后渲染成一个坏图），
 *    所以这一步照样去求真图并覆盖它。用户自己上传了照片的那条路**在调用点**就整段跳过了选图
 *    （`create-site.js` 的 `if (uploadedImages.length === 0)`），不会走到这里。
 *
 * `manifests` 是 `loadManifests()` 回的 Map。块在 manifest 里没有 ⟹ 它没有图槽，跳过 ——
 * 不抛错：建站那条路上 AI 偶尔会吐回一个不存在的块类型，那件事由 `validateSite` 说，不由这里说。
 */
function collectImageSlots(pages, manifests) {
  const out = [];
  for (const page of pages || []) {
    const sections = blocksOf(page);
    for (let i = 0; i < sections.length; i++) {
      const sec = sections[i];
      if (!sec || typeof sec.type !== 'string') continue;
      const m = manifests instanceof Map ? manifests.get(sec.type) : (manifests || {})[sec.type];
      if (!m) continue;
      for (const slot of imageSlotsOf(m)) {
        const data = sec.data || {};
        if (slot.kind === 'object') {
          // #1425 —— 对象图槽（新库的主图 `{imageUrl, alt}`）。🔴 块有一个跟这个槽**同名的旋钮**（hero / content / cta /
          //    page-header 的 `image`，features 的 `introImage` …）时，判据是**这一块自己的 data 写没写那个旋钮、写的是不是
          //    "none" 以外的值**：旋钮没写 = 默认 "none"，填了图也不显示，而且 `validateSite` 会判「写了 image 但
          //    options.image 没写」⟹ AI 改站时这一页的每一次重写都被拒。所以只在块自己说要图时才求图。
          //    不替它把旋钮写上：钉死旋钮会压过主题挑的形态，换主题时图就挪不动了。
          //    没有同名旋钮的块：照列表槽的规矩，写了这个对象才收。
          const knob = ((m.slots && m.slots.options && m.slots.options.knobs) || []).find((k) => k && k.name === slot.name);
          const opts = data.options && typeof data.options === 'object' ? data.options : {};
          const v = data[slot.name];
          const wanted = knob
            ? (typeof opts[slot.name] === 'string' && opts[slot.name] !== 'none')
            : !!(v && typeof v === 'object' && !Array.isArray(v));
          if (wanted) out.push({ pageSlug: page.slug, secIdx: i, secType: sec.type, slotName: slot.name, kind: 'object', itemIdx: null });
          continue;
        }
        if (slot.kind === 'list') {
          // #1594 —— 列表槽有管它的旋钮（manifest 的 `imageKnob`，features.items 归 `itemImage`）⟹ 跟上面对象槽同一条规矩：
          //    这一块自己的 options 里那个旋钮写的是 "none" 以外的值才收。#1601 的配方预设把服务页 features 的 `itemImage`
          //    全写成 "none"，不看这一条的话每页 3 张的名额全花在页面上不显示的条目图上（QA2 实测 24 张里看得见 3 张）。
          //    🔴 判据用渲染那一侧同一个函数（`effectiveKnobs`，features/Section.tsx 就是拿它算 `k.itemImage`）：只看 options
          //    会漏掉「写了 shape: photo-cards、options 里没写 itemImage」这种 —— 预设给的值是 top，条目图照样显示。
          if (slot.imageKnob && effectiveKnobs(m, sec.shape, data.options)[slot.imageKnob] === 'none') continue;
          const items = Array.isArray(data[slot.name]) ? data[slot.name] : [];
          for (let j = 0; j < items.length; j++) {
            if (items[j] && typeof items[j] === 'object') {
              out.push({ pageSlug: page.slug, secIdx: i, secType: sec.type, slotName: slot.name, kind: 'list', itemIdx: j, imageKey: slot.imageKey || null });
            }
          }
        } else {
          out.push({ pageSlug: page.slug, secIdx: i, secType: sec.type, slotName: slot.name, kind: 'image', itemIdx: null });
        }
      }
    }
  }
  return out;
}

// ── 图片文件名的长度上限（#1566）──────────────────────────────────────────────────────────────────
// 图片落盘是 `public/photos/<slotKey>.jpg`，slotKey 拿整条 pageSlug 当前缀。SLUG_MAX_BYTES 只按【页面文件】的后缀推过，
// 图片是另一个 sink：前缀之后还要接 `-s<i>-<块>-<槽>[-i<j>]` 和 `.jpg` ⟹ 顶格的 slug 拼出来的文件名放不下，写盘抛
// ENAMETOOLONG，那一页的图一张都不剩（图已经求到、钱已经花了）。
// 🔴 上限是推出来的：单个文件名上限取 keyword-slug.js 那一份，减掉这里声明的后缀；create-site 写盘也用这个后缀。
const IMAGE_FILE_SUFFIX = '.jpg';
const SLOT_KEY_MAX_BYTES = FILENAME_MAX_BYTES - Buffer.byteLength(IMAGE_FILE_SUFFIX);
// 截过的 key 里接的那段 pageSlug 哈希（十六进制位数）。
const PAGE_TAG_LEN = 10;

/**
 * 这个槽的唯一键 —— 图片文件名用它，日志也用它。
 *
 * 放得下（≤ SLOT_KEY_MAX_BYTES）且 pageSlug 全是 ASCII ⟹ 跟以前逐字相同，今天的站一个字节都不变。
 * 放不下 ⟹ 只截 pageSlug 那一截，后面接 `-<pageSlug 的哈希>`，坐标那一截原样保留：
 *   同一页的槽 pageSlug 截法相同、坐标各不相同 ⟹ 页内唯一；不同页 pageSlug 不同 ⟹ 哈希不同 ⟹ 跨页唯一
 *   （只截不加哈希的话，`services/<顶格 id>` 和它去重出来的 `services/<id 截短>-2` 截完会是同一个前缀）。
 * pageSlug 里有非 ASCII（#1573）⟹ 放得下也接同一段哈希：safe() 把每个非 ASCII 字符换成一个 `_`，
 *   `services/水管维修` 和 `services/电路安装` 换完是同一个串，不接哈希后一张图就盖掉前一张。
 */
function slotKey(slot) {
  const coords = [`s${slot.secIdx}`, slot.secType, slot.slotName];
  if (slot.itemIdx !== null && slot.itemIdx !== undefined) coords.push(`i${slot.itemIdx}`);
  const safe = (s) => s.replace(/[^a-zA-Z0-9-]/g, '_');   // 结果只有 ASCII ⟹ 字符数 = 字节数
  const full = safe([slot.pageSlug, ...coords].join('-'));
  if (full.length <= SLOT_KEY_MAX_BYTES && !/[^\x00-\x7F]/.test(String(slot.pageSlug))) return full;
  const tag = crypto.createHash('sha1').update(String(slot.pageSlug)).digest('hex').slice(0, PAGE_TAG_LEN);
  const tail = `-${tag}-${safe(coords.join('-'))}`;
  // 坐标那一截来自块库的块名 / 槽名，长度是几十字节；最外层那次 slice 只防它本身就超长这种到不了的情形。
  return `${safe(String(slot.pageSlug)).slice(0, Math.max(0, SLOT_KEY_MAX_BYTES - tail.length))}${tail}`.slice(0, SLOT_KEY_MAX_BYTES);
}

/** 人话版的槽位坐标：哪一页、哪个块、哪个槽（列表槽带第几项）。三条日志共用它。 */
function slotWhere(slot) {
  const where = slot.itemIdx === null || slot.itemIdx === undefined
    ? slot.slotName : `${slot.slotName}#${slot.itemIdx}`;
  return `页面 ${slot.pageSlug} · 块 ${slot.secType} · 槽 ${where}`;
}

/** 填上了。 */
function logFilled(slot, url) {
  return `[photo-slot] 填上 —— ${slotWhere(slot)} · ${url}`;
}

/**
 * 没拿到图。🔴 **这不是错误路径，是正常的退化**（配额用完 / 关键词太冷 / 生成失败）：
 * 槽留空，块按 `shapes[].needs` 落回不要图的那个形态（#1331）。但它必须**说话** ——
 * 不说的话「这个站为什么没图」只能靠人一页页翻。
 */
function logMissed(slot, reason) {
  return `[photo-slot] 没拿到图 —— ${slotWhere(slot)} · 原因: ${reason}`;
}

/** 超过上限被截掉的那些。 */
function logCapped(cap, total, dropped) {
  return `[photo-slot] 超出上限 ${cap}（共 ${total} 个槽）· 截掉 ${dropped.length} 个: ${dropped.map(slotKey).join(', ')}`;
}

/**
 * 按上限截断。🔴 **按块在页面里的先后截**（`collectImageSlots` 已经是这个顺序），不是随机丢：
 * 先出现的块在页面上更靠前、更可能被人看到。
 */
function capImageSlots(slots, cap) {
  if (!Number.isFinite(cap) || cap < 0 || slots.length <= cap) return { kept: slots, dropped: [] };
  return { kept: slots.slice(0, cap), dropped: slots.slice(cap) };
}

/**
 * 这个槽要一张什么样的图 —— 提示词按 manifest 的 `displayName` + `category` + 站的行业 + 槽位名拼。
 *
 * 🔴 **取景按 `category` 不按块名**（`banner` 类是首屏横幅 ⟹ 宽幅远景；列表槽是一组小图 ⟹ 细节照；
 *    其余单图槽 ⟹ 场景照）。这三种取景就是 #1386 之前那四个 `case` 写的东西，只是判据换成了
 *    manifest 自己声明的字段 —— 新块声明了 category 就自动落到对的那一档，不用回头改这里。
 *
 * 下面那段 `scene` 逐字保留 TICKET-164 v2 的成果（160 PM addendum §1 的 "ABSOLUTELY NO TEXT" 段，
 * 两个行业 2/2 prod-clean 验过 commit 577b22e）：
 *   (a) 去掉 "accents in signage" ⟹ ${primaryColor} 只绑到装潢与环境光，不再把招牌请进画面
 *   (b) 弱的 "AVOID logos or text overlays" 换成 ABSOLUTELY NO TEXT + 九种文字形态逐个点名 ——
 *       模型不能再把 AVOID 理解成「只是别做后期文字叠加」
 * 人脸仍然允许（TICKET-164 用户决定，不走回头路）。
 */
function buildSlotPrompt({ manifest, slot, industry, primaryColor, themeWord }) {
  const scene = `${industry} business interior or exterior scene, warm natural lighting, photorealistic, ${themeWord} aesthetic. Use ${primaryColor} as the dominant color tone in the decor, walls, furnishings, and ambient lighting. Professional friendly diverse people (varied ages and ethnicities) may appear naturally. AVOID children unless industry is pediatric/childcare/school; AVOID medical surgery, distress, or sensitive scenes; AVOID religious symbols not relevant to the brand.

ABSOLUTELY NO TEXT IN THE IMAGE. The scene must contain ZERO visible business signage with letters, ZERO storefront signs with words, ZERO wall-mounted signs with text, ZERO printed wordmarks or brand names, ZERO menu boards with readable words, ZERO product labels with letters, ZERO English or any-language words, ZERO numbers or digits, ZERO logos with characters, ZERO typography of any kind anywhere in the scene. Buildings, products, walls, and decor must be free of any written or printed text elements.`;

  const name = (manifest && manifest.displayName) || (manifest && manifest.type) || slot.secType;
  const where = `It fills the "${slot.slotName}" image slot of the "${name}" section.`;

  if (slot.kind === 'list') {
    return `4:3 detail or moment shot of ${scene} ${where} This is photo #${(slot.itemIdx || 0) + 1} of a set — vary the subject (product close-up / service action / interior detail / candid interaction) so it differs from the others in the same set.`;
  }
  if (manifest && manifest.category === 'banner') {
    return `Wide-angle 16:9 exterior storefront or entrance view of ${scene} ${where} Daytime, inviting, welcoming atmosphere with depth.`;
  }
  return `4:3 contextual scene of ${scene} ${where} Authentic candid moment, not posed.`;
}

/**
 * 把求到的那张图写回页面。列表槽写进第 `itemIdx` 项的 `imageUrl`，单图槽写进槽位自己。
 * #1475 —— 列表项的图嵌在一层对象里时（`slot.imageKey`，由 `imageSlotsOf` 从 shape 读出），
 * 写进 `items[i][imageKey].imageUrl`，那个对象里已有的 `alt` 留着。
 */
function setSlotImageUrl(pages, slot, url) {
  const page = (pages || []).find((p) => p && p.slug === slot.pageSlug);
  if (!page) return false;
  const section = blocksOf(page)[slot.secIdx];
  if (!section) return false;
  if (!section.data) section.data = {};
  if (slot.kind === 'list') {
    const items = section.data[slot.slotName];
    if (!Array.isArray(items) || !items[slot.itemIdx] || typeof items[slot.itemIdx] !== 'object') return false;
    const item = items[slot.itemIdx];
    if (slot.imageKey) {
      const prev = item[slot.imageKey];
      item[slot.imageKey] = { ...(prev && typeof prev === 'object' ? prev : {}), imageUrl: url };
    } else {
      item.imageUrl = url;
    }
    return true;
  }
  if (slot.kind === 'object') {
    // #1425 —— `{imageUrl, alt}`：只换 imageUrl，已有的 alt 留着。
    const prev = section.data[slot.slotName];
    section.data[slot.slotName] = { ...(prev && typeof prev === 'object' && !Array.isArray(prev) ? prev : {}), imageUrl: url };
    return true;
  }
  section.data[slot.slotName] = url;
  return true;
}

// ── 每页 / 每站的预算、跨页复用、并行（#1594）─────────────────────────────────────────────────────
//
// 三次真 AI 建站读数：4 服务英文站和 7 服务中文站都是 99 张图 —— 按槽数求、跟站的大小无关，生图一段 9–10 分钟。
// 现在：每页【新生成】≤ PER_PAGE_NEW_IMAGES 张（由下面的档位定，不问 AI）· 每站 ≤ cap · gallery 先用服务详情页的图 · 4 路并行。

const PER_PAGE_NEW_IMAGES = 3;
const IMAGE_CONCURRENCY = 4;

const manifestOf = (manifests, type) => (manifests instanceof Map ? manifests.get(type) : (manifests || {})[type]);

/**
 * 这个槽的「每一项都必须有图」声明：列表槽在 manifest 里写了 `itemRequires: ["<imageKey>.imageUrl"]`（平铺的写 `imageUrl`）。
 * 有 ⟹ 回 { minItems }；没有 ⟹ null。今天只有 `gallery.items` 是这一种。
 * 🔴 判据读 manifest，不写块名：这一对声明（每项必须有图 + 至少 N 项）就是「这种槽的图不受每页预算管、被截时不少于 N 项」的来源。
 */
function requiredImageList(slot, manifests) {
  if (slot.kind !== 'list') return null;
  const spec = ((manifestOf(manifests, slot.secType) || {}).slots || {})[slot.slotName];
  const req = spec && Array.isArray(spec.itemRequires) ? spec.itemRequires : [];
  const path = slot.imageKey ? `${slot.imageKey}.imageUrl` : 'imageUrl';
  if (!req.includes(path)) return null;
  return { minItems: Number.isInteger(spec.minItems) ? spec.minItems : 0 };
}

/**
 * 这个槽排第几档（#1594 做什么 1）。从 manifest 派生（`imageSlotsOf` 给的 `kind` / `main`），不手抄槽名：
 *   1  `main: true` 的对象槽（hero / page-header / content / cta 的 `image`）；旧口径的单图槽（`kind: image`）也算这一档
 *   2  非 main 的对象槽（features 的 introImage / itemsImage、milestones 的 blockImage / introImage）
 *   3  列表槽，按项依次（features.items · hero.band）
 *   'reuse'  每项都必须有图的列表槽（gallery.items）—— 不在每页预算里排，先复用、不够的新生成（做什么 3）
 */
function slotTier(slot, manifests) {
  if (slot.kind === 'list') return requiredImageList(slot, manifests) ? 'reuse' : 3;
  if (slot.kind === 'object') {
    const s = imageSlotsOf(manifestOf(manifests, slot.secType) || {}).find((x) => x.name === slot.slotName);
    return s && s.main ? 1 : 2;
  }
  return 1;
}

/** 服务详情页：slug 形如 `services/<id>`（不含它下面 `services/<id>/<词>` 的关键词页）。 */
const isServiceDetailSlug = (slug) => /^services\/[^/]+$/.test(String(slug || ''));

/**
 * 每页取前 `perPage` 个可自由支配的槽（按档，同档按书写顺序 —— `collectImageSlots` 已是「块 → 槽 → 项」的顺序，
 * 所以第 3 档天然是 items[0]、items[1]…）。回 { chosen, skipped }，两者都按页面顺序。
 */
function pickPerPage(slots, manifests, perPage) {
  const chosen = [];
  const skipped = [];
  const byPage = new Map();
  for (const s of slots) {
    if (!byPage.has(s.pageSlug)) byPage.set(s.pageSlug, []);
    byPage.get(s.pageSlug).push(s);
  }
  for (const list of byPage.values()) {
    const ranked = list.map((s, i) => ({ s, i, t: slotTier(s, manifests) })).sort((a, b) => (a.t - b.t) || (a.i - b.i));
    ranked.forEach((x, k) => (k < perPage ? chosen : skipped).push(x.s));
  }
  return { chosen, skipped };
}

/** n 个任务最多 limit 个同时在飞（同 create-site.js §runPool）。 */
async function runPool(n, limit, fn) {
  let next = 0;
  const worker = async () => {
    while (next < n) {
      const i = next++;
      await fn(i);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, n) }, worker));
}

/** 把一个槽里 AI 自己写的 imageUrl 清掉（没被选中的槽「留空」；AI 自填的值不可信，见 §collectImageSlots）。 */
function clearSlotImageUrl(pages, slot) {
  const page = (pages || []).find((p) => p && p.slug === slot.pageSlug);
  const section = page && blocksOf(page)[slot.secIdx];
  const data = section && section.data;
  if (!data) return;
  if (slot.kind === 'list') {
    const item = Array.isArray(data[slot.slotName]) ? data[slot.slotName][slot.itemIdx] : null;
    if (!item || typeof item !== 'object') return;
    const holder = slot.imageKey ? item[slot.imageKey] : item;
    if (holder && typeof holder === 'object') delete holder.imageUrl;
    return;
  }
  if (slot.kind === 'object') {
    if (data[slot.slotName] && typeof data[slot.slotName] === 'object') delete data[slot.slotName].imageUrl;
    return;
  }
  delete data[slot.slotName];
}

/**
 * 走一遍所有内容图槽，按预算求图、写回页面。**这一步就是「选图」本身** —— 建站那条路和 skipAI
 * 那条路走的是同一份代码，差的只是传进来的 `produce`。
 *
 *   produce({ slot, prompt, key }) → url | null    回 null 或抛出 = 这个槽没拿到图（正常退化）
 *   log(line)                                      每条读数一行；不传就不打
 *
 * 顺序（#1594）：
 *   ① 每页挑前 3 个可自由支配的槽（§pickPerPage）；gallery 这种「每项必须有图」的列表槽不在这里挑、不占这 3 张。
 *   ② 每站上限 `cap`：先给每个 gallery 预留 minItems 张（按「一张都复用不到」算 ⟹ 预留够用，cap 是硬上限），
 *      可自由支配的按页面顺序截（排在最后几页的先被截）。
 *   ③ 并行（最多 4 张同时在求）生成 ①② 留下的槽。
 *   ④ gallery：前 R 项复用服务详情页（页面顺序）上填上了的第 1 档图，其余项新生成 —— 不删 AI 写的项、文字原样。
 *      只有两种情况删项：那一项的图生成失败；站上限剩下的名额不够（这时每个 gallery 至少留 minItems 项）。
 *      没图的项不能留：`itemRequires` 会让下一次改站被拒。
 *
 * 回 { totalSlots, attempted, success, dropped, skipped, failures, alts, images: { requested, generated, reused } }
 *   `dropped` 是被每站上限截掉的，`skipped` 是被每页上限留空的。requested = 要填的槽数（生成 + 复用）·
 *   generated = 新生成成功的张数 · reused = 用复用填上的槽数 ⟹ 填上的槽数 = generated + reused。
 * 🔴 单个槽失败不许影响别的槽（一次 5xx 不该让整个建站倒），所以 try/catch 在每个槽里面。
 */
async function fillImageSlots({ pages, manifests, industry, primaryColor, themeWord, cap = Infinity, perPage = PER_PAGE_NEW_IMAGES, concurrency = IMAGE_CONCURRENCY, produce, log, targetKeywordOf }) {
  const say = typeof log === 'function' ? log : () => {};
  const all = collectImageSlots(pages, manifests);
  const reuseSlots = all.filter((s) => slotTier(s, manifests) === 'reuse');
  const free = all.filter((s) => slotTier(s, manifests) !== 'reuse');

  // ① 每页 ≤ perPage
  const { chosen, skipped } = pickPerPage(free, manifests, perPage);
  if (skipped.length) {
    const byPage = new Map();
    for (const s of skipped) byPage.set(s.pageSlug, (byPage.get(s.pageSlug) || []).concat(s));
    for (const [slug, list] of byPage) say(`[photo-slot] 每页上限 ${perPage}：页面 ${slug} 留空 ${list.length} 个槽: ${list.map(slotKey).join(', ')}`);
  }

  // gallery 按块分组（一块 = 一个 secIdx 上的一个列表槽）
  const galleries = [];
  for (const s of reuseSlots) {
    let g = galleries.find((x) => x.pageSlug === s.pageSlug && x.secIdx === s.secIdx && x.slotName === s.slotName);
    if (!g) {
      g = { pageSlug: s.pageSlug, secIdx: s.secIdx, secType: s.secType, slotName: s.slotName, minItems: requiredImageList(s, manifests).minItems, slots: [] };
      galleries.push(g);
    }
    g.slots.push(s);
  }

  // ② 每站上限：先给每个 gallery 预留它的 minItems（按 R = 0 算 —— 真 R 要等 ③ 生成完才知道，按预估留会不够，
  //    QA1 r1 实测 cap=3 生成了 4 张）。可自由支配的拿剩下的，按页面顺序截。
  const reserve = galleries.reduce((n, g) => n + Math.min(g.slots.length, g.minItems), 0);
  const freeCap = Number.isFinite(cap) ? Math.max(0, cap - reserve) : cap;
  const { kept, dropped } = capImageSlots(chosen, freeCap);
  if (dropped.length) say(logCapped(cap, all.length, dropped));
  for (const slot of dropped) say(logMissed(slot, `超出本站图片上限 ${cap}`));
  for (const slot of [...skipped, ...dropped]) clearSlotImageUrl(pages, slot);

  const failures = [];
  const filled = new Map();   // slot → url
  let calls = 0;
  let generated = 0;
  let reused = 0;
  const generate = async (slot) => {
    const m = manifestOf(manifests, slot.secType);
    const prompt = buildSlotPrompt({ manifest: m, slot, industry, primaryColor, themeWord });
    calls += 1;
    try {
      const url = await produce({ slot, prompt, key: slotKey(slot) });
      if (!url) throw new Error('没有回图');
      if (!setSlotImageUrl(pages, slot, url)) throw new Error('写回页面时找不到这个槽');
      generated += 1;
      filled.set(slot, url);
      say(logFilled(slot, url));
    } catch (err) {
      failures.push({ slot, reason: err.message });
      say(logMissed(slot, err.message));
    }
  };

  // ③ 并行生成
  await runPool(kept.length, concurrency, (i) => generate(kept[i]));

  // ④ gallery：服务详情页（页面顺序）上填上了的第 1 档图
  const serviceImages = [];
  for (const page of pages || []) {
    if (!page || !isServiceDetailSlug(page.slug)) continue;
    const hit = kept.find((s) => s.pageSlug === page.slug && slotTier(s, manifests) === 1 && filled.has(s));
    if (hit) serviceImages.push(filled.get(hit));
  }
  const R = serviceImages.length;
  // 复用之后还没图的项要新生成。名额 = 站上限剩下的（③ 用掉 calls 张，② 留够了每个 gallery 的 minItems）：
  // 先给每个 gallery 补到 minItems，剩下的再按页面顺序分给后面的项；分不到的项截掉。
  const toGen = galleries.map((g) => g.slots.slice(Math.min(R, g.slots.length)));
  galleries.forEach((g) => g.slots.forEach((slot, j) => {
    if (j >= R) return;
    if (setSlotImageUrl(pages, slot, serviceImages[j])) {
      reused += 1;
      filled.set(slot, serviceImages[j]);
      say(`[photo-slot] 复用 —— ${slotWhere(slot)} · ${serviceImages[j]}`);
    }
  }));
  let left = Number.isFinite(cap) ? Math.max(0, cap - calls) : Infinity;
  const allow = galleries.map((g, k) => {
    const n = Math.min(toGen[k].length, Math.max(0, g.minItems - Math.min(R, g.slots.length)));
    left -= n;
    return n;
  });
  galleries.forEach((g, k) => {
    const more = Math.min(toGen[k].length - allow[k], Math.max(0, left));
    allow[k] += more;
    left -= more;
  });
  const galleryJobs = [];
  const cut = new Set();
  galleries.forEach((g, k) => {
    toGen[k].forEach((slot, j) => (j < allow[k] ? galleryJobs.push(slot) : cut.add(slot)));
    const n = toGen[k].length - allow[k];
    if (n) say(`[photo-slot] 超出上限 ${cap}：页面 ${g.pageSlug} 块 ${g.secType} 截掉 ${n} 项（留 ${g.slots.length - n} 项，不少于 minItems ${g.minItems}）`);
  });
  await runPool(galleryJobs.length, concurrency, (i) => generate(galleryJobs[i]));

  // 没图的 gallery 项删掉（站上限截掉的、生成失败的）—— 从后往前删，下标不乱。
  for (const g of galleries) {
    const page = (pages || []).find((p) => p && p.slug === g.pageSlug);
    const section = page && blocksOf(page)[g.secIdx];
    const items = section && section.data && section.data[g.slotName];
    if (!Array.isArray(items)) continue;
    const gone = g.slots.filter((s) => !filled.has(s));
    const failed = gone.filter((s) => !cut.has(s)).length;
    for (const j of gone.map((s) => s.itemIdx).sort((a, b) => b - a)) items.splice(j, 1);
    if (failed) say(`[photo-slot] ${g.secType}：页面 ${g.pageSlug} 删掉 ${failed} 个图生成失败的项（留 ${items.length} 项）`);
  }

  const images = { requested: calls + reused, generated, reused };
  say(`[photo-slot] 图：requested ${images.requested} · generated ${images.generated} · reused ${images.reused}`);
  // #1549 —— 填完图写 alt：每张内容图非空，每页第一张含这一页的目标词（seoProblems 第 6 条查的就是这两样）。
  const alts = writeImageAlts({ pages, manifests, industry, targetKeywordOf });
  if (alts.written || alts.keyworded) say(`[photo-slot] alt：补了 ${alts.written} 张 · ${alts.keyworded} 页的第一张内容图带上了目标词`);
  return { totalSlots: all.length, attempted: calls + reused, success: generated + reused, dropped, skipped, failures, alts, images };
}

// ── alt（#1549 做什么 5）────────────────────────────────────────────────────────────────────────
//
// 🔴 「内容图」= seoProblems 第 6 条那份（`seo-problems.js §contentImagesOf`，真渲染出 <img> 的场景图），不是上面
//    `collectImageSlots` 那份「要不要去求图」的名单 —— 后者多收了不出 <img> 的槽（比如 hero 的 image=background），
//    按它挑「第一张」会挑到一张访客看不见的图。
//
// alt 从哪来：
//   ① AI 在 Call 1 / Call 2 里自己写了（提示词要它给每张图一句话描述）⟹ 留着；
//   ② 没写 ⟹ 按这张图所在的地方补一句：条目自己的标题（gallery / features 的项）→ 块标题 → 页面标题 → 行业。
//      组件那一侧对空 alt 只会回退成空串（`blockMedia.tsx §slotImg`），所以这里不补，访客就读到一张没有描述的图。
//   ③ 每页**第一张**内容图要含这一页的目标词（正文定死「第一张」，PM 2026-10-04）：已经含就不动，不含就把目标词
//      放在前面（「drain cleaning Markham: Plumber clearing a kitchen sink」）。
// 只写**有 imageUrl** 的图（没图的槽不出 <img>，写 alt 没有意义）。

const strOf = (v) => (typeof v === 'string' && v.trim() ? v.trim() : '');

function fallbackAlt(page, image, industry) {
  const sec = blocksOf(page)[image.secIdx] || {};
  const d = sec.data && typeof sec.data === 'object' ? sec.data : {};
  const items = Array.isArray(d[image.slot]) ? d[image.slot] : [];
  const item = image.itemIdx !== null && image.itemIdx !== undefined ? items[image.itemIdx] : null;
  return strOf(item && item.title) || strOf(d.headline) || strOf(page && page.title) || (strOf(industry) ? `${strOf(industry)} photo` : 'Photo');
}

/**
 * 给页面里的内容图写 alt（就地改页面对象）。回 `{ written, keyworded }`：补了几张 alt、几页的第一张带上了目标词。
 * `targetKeywordOf(page)` → 这一页的目标词或空；不传就只保证非空。
 */
function writeImageAlts({ pages, manifests, industry, targetKeywordOf } = {}) {
  let written = 0;
  let keyworded = 0;
  for (const page of pages || []) {
    if (!page) continue;
    const imgs = contentImagesOf(page, manifests);
    for (const x of imgs) {
      // 写进数据里那个 `alt` 键（组件的回退 —— gallery 拿条目标题顶上 —— 也照写进去，不靠渲染那一侧兜）
      if (strOf(x.img.alt)) continue;
      x.img.alt = strOf(x.alt) || fallbackAlt(page, x, industry);
      x.alt = x.img.alt;
      written += 1;
    }
    const kw = typeof targetKeywordOf === 'function' ? strOf(targetKeywordOf(page)) : '';
    if (kw && imgs.length && !hasPhrase(imgs[0].alt, kw)) {
      imgs[0].img.alt = `${kw}: ${strOf(imgs[0].alt)}`;
      keyworded += 1;
    }
  }
  return { written, keyworded };
}

module.exports = {
  collectImageSlots,
  capImageSlots,
  buildSlotPrompt,
  setSlotImageUrl,
  fillImageSlots,
  writeImageAlts,
  slotTier,
  pickPerPage,
  isServiceDetailSlug,
  PER_PAGE_NEW_IMAGES,
  IMAGE_CONCURRENCY,
  slotKey,
  IMAGE_FILE_SUFFIX,
  SLOT_KEY_MAX_BYTES,
  slotWhere,
  logFilled,
  logMissed,
  logCapped,
};
