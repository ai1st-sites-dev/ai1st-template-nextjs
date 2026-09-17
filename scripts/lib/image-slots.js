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
        if (slot.kind === 'list') {
          const items = Array.isArray(data[slot.name]) ? data[slot.name] : [];
          for (let j = 0; j < items.length; j++) {
            if (items[j] && typeof items[j] === 'object') {
              out.push({ pageSlug: page.slug, secIdx: i, secType: sec.type, slotName: slot.name, kind: 'list', itemIdx: j });
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

/** 这个槽的唯一键 —— 图片文件名用它，日志也用它。 */
function slotKey(slot) {
  const parts = [slot.pageSlug, `s${slot.secIdx}`, slot.secType, slot.slotName];
  if (slot.itemIdx !== null && slot.itemIdx !== undefined) parts.push(`i${slot.itemIdx}`);
  return parts.join('-').replace(/[^a-zA-Z0-9-]/g, '_');
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

/** 把求到的那张图写回页面。列表槽写进第 `itemIdx` 项的 `imageUrl`，单图槽写进槽位自己。 */
function setSlotImageUrl(pages, slot, url) {
  const page = (pages || []).find((p) => p && p.slug === slot.pageSlug);
  if (!page) return false;
  const section = blocksOf(page)[slot.secIdx];
  if (!section) return false;
  if (!section.data) section.data = {};
  if (slot.kind === 'list') {
    const items = section.data[slot.slotName];
    if (!Array.isArray(items) || !items[slot.itemIdx] || typeof items[slot.itemIdx] !== 'object') return false;
    items[slot.itemIdx].imageUrl = url;
    return true;
  }
  section.data[slot.slotName] = url;
  return true;
}

/**
 * 走一遍所有内容图槽，逐个求图、写回页面。**这一步就是「选图」本身** —— 建站那条路和 skipAI
 * 那条路走的是同一份代码，差的只是传进来的 `produce`。
 *
 *   produce({ slot, prompt, key }) → url | null    回 null 或抛出 = 这个槽没拿到图（正常退化）
 *   log(line)                                      每条读数一行；不传就不打
 *
 * 回 { totalSlots, attempted, success, dropped, failures } —— `dropped` 是被上限截掉的那些。
 * 🔴 单个槽失败不许影响别的槽（一次 5xx 不该让整个建站倒），所以 try/catch 在循环里面。
 */
async function fillImageSlots({ pages, manifests, industry, primaryColor, themeWord, cap = Infinity, produce, log }) {
  const say = typeof log === 'function' ? log : () => {};
  const all = collectImageSlots(pages, manifests);
  const { kept, dropped } = capImageSlots(all, cap);
  if (dropped.length) say(logCapped(cap, all.length, dropped));
  for (const slot of dropped) say(logMissed(slot, `超出本站图片上限 ${cap}`));

  let success = 0;
  const failures = [];
  for (const slot of kept) {
    const m = manifests instanceof Map ? manifests.get(slot.secType) : (manifests || {})[slot.secType];
    const prompt = buildSlotPrompt({ manifest: m, slot, industry, primaryColor, themeWord });
    try {
      const url = await produce({ slot, prompt, key: slotKey(slot) });
      if (!url) throw new Error('没有回图');
      if (!setSlotImageUrl(pages, slot, url)) throw new Error('写回页面时找不到这个槽');
      success += 1;
      say(logFilled(slot, url));
    } catch (err) {
      failures.push({ slot, reason: err.message });
      say(logMissed(slot, err.message));
    }
  }
  return { totalSlots: all.length, attempted: kept.length, success, dropped, failures };
}

module.exports = {
  collectImageSlots,
  capImageSlots,
  buildSlotPrompt,
  setSlotImageUrl,
  fillImageSlots,
  slotKey,
  slotWhere,
  logFilled,
  logMissed,
  logCapped,
};
