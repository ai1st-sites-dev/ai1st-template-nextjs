'use strict';

// slot-prompt.js —— 「这个图槽要一张什么样的图」的提示词，建站和编辑器共用一份（#1711）。
//
// 🔴 为什么从 `image-slots.js` 搬出来：编辑器页（浏览器里跑）要用同一句提示词，而 `image-slots.js` 顶上 require 了
//    node 内建 `crypto` 和 `seo-problems` / `keyword-slug`，编辑器页 import 不了它。这一份**只拼字符串**，不 require 任何东西，
//    建站（`image-slots.js` 从这里取、照旧导出）和编辑器（`EditorApp.tsx`）读的是同一个函数 —— 两份拼法分叉时没有东西会红。
//    `industry` 有值时的输出跟搬之前逐字相同（`scripts/slot-prompt.test.js` ① 拿搬之前那份函数的原文当期望值）。

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
 *
 * #1711 —— 编辑器这条路手上可能没有行业（dashboard 还没送来 / 老 dashboard）：没有就省掉那个词，
 *    `"<行业> business interior…"` 变成 `"business interior…"`，不出现 `undefined`。有行业时一个字节不变。
 */
function buildSlotPrompt({ manifest, slot, industry, primaryColor, themeWord }) {
  const business = industry ? `${industry} business` : 'business';
  const scene = `${business} interior or exterior scene, warm natural lighting, photorealistic, ${themeWord} aesthetic. Use ${primaryColor} as the dominant color tone in the decor, walls, furnishings, and ambient lighting. Professional friendly diverse people (varied ages and ethnicities) may appear naturally. AVOID children unless industry is pediatric/childcare/school; AVOID medical surgery, distress, or sensitive scenes; AVOID religious symbols not relevant to the brand.

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

/** 编辑器这条路的主题词。建站时它是主题 id（`azure-29`），本来就不是描述词；编辑器页手上也没有它 ——
 *  一律用建站自己拿不到主题时的那个默认值（`create-site.js` §generateSlotPhotos 的 `themeName || 'minimal'`）。 */
const EDITOR_THEME_WORD = 'minimal';

/** 块标题接在提示词后面最多几个字：标题是给人看的一句话，再长就是数据出了问题，不往模型那里送。 */
const HEADLINE_MAX = 200;

/**
 * 编辑器选图弹窗里 Generate 的默认提示词 = 建站那一句（同一个函数、同一组入参，主题词固定 `minimal`）+ 这块现在的标题。
 * 老板自己写的那句不在这里：dashboard 接在后面（编辑器页不发请求、也不知道老板写了什么）。
 *
 * @param {object}  a
 * @param {object}  a.manifest     这块的 `{ type, displayName, category }`（编辑器的块注册表里有）
 * @param {string}  a.slotName     槽名（`image`、`introImage`、`items`）
 * @param {'object'|'list'} a.kind 单图槽还是列表里的一项
 * @param {number} [a.itemIdx]     列表里第几项
 * @param {string} [a.industry]    dashboard 在 `ai1st:editor-baseline` 里带来的行业；没有就省掉
 * @param {string}  a.primaryColor 站的主色（`brand.colors.primary['500']`，建站传的也是它）
 * @param {string} [a.headline]    这块现在的标题
 */
function editorImagePrompt({ manifest, slotName, kind, itemIdx, industry, primaryColor, headline }) {
  const base = buildSlotPrompt({
    manifest,
    slot: { secType: manifest && manifest.type, slotName, kind, itemIdx },
    industry: typeof industry === 'string' ? industry.trim() : '',
    primaryColor,
    themeWord: EDITOR_THEME_WORD,
  });
  const h = typeof headline === 'string' ? headline.replace(/\s+/g, ' ').trim().slice(0, HEADLINE_MAX) : '';
  return h ? `${base} The section's headline is: "${h}".` : base;
}

/**
 * 编辑器里「这张图在这块的哪个槽」→ `{ slotName, kind, itemIdx }`（`buildSlotPrompt` 要的那三样）。
 *
 * 两条入口：
 *   · 画布里点图：手上有 `data-slot`（`image`、`items.2.image`、`band.0.imageUrl`、`proof.avatars.1.imageUrl`）。
 *   · 面板上的 Change：只有那张图的地址（`current`），在这块的数据里找它在哪。找不到（还没有图 / 地址对不上）⟹
 *     第一个顶层单图槽（`{imageUrl}` 对象，按 props 的键序）；一个都没有 ⟹ null（调用方就不带默认提示词）。
 * 判据：路径的第一段是槽名；路径里有数字 ⟹ 列表里的一项（取第一个数字当序号），否则是单图。
 *
 * @param {object}  a
 * @param {object} [a.props] 这块的数据
 * @param {string} [a.slot]  画布上那张图的 `data-slot`
 * @param {string} [a.current] 那张图现在的地址
 */
function editorImageTarget({ props, slot, current }) {
  const fromPath = (segs) => {
    const name = segs[0];
    if (!name || /^\d+$/.test(name)) return null;
    const n = segs.find((x) => /^\d+$/.test(String(x)));
    return n === undefined ? { slotName: name, kind: 'object' } : { slotName: name, kind: 'list', itemIdx: Number(n) };
  };
  if (typeof slot === 'string' && slot) return fromPath(slot.split('.'));
  const isObj = (v) => !!v && typeof v === 'object';
  const cur = typeof current === 'string' ? current.trim() : '';
  if (cur && isObj(props)) {
    // 深度优先找值等于 current 的那一格（`{imageUrl}` 对象，或成排图那种地址字符串）。
    const walk = (v, path) => {
      if (typeof v === 'string') return v === cur ? path : null;
      if (!isObj(v)) return null;
      if (typeof v.imageUrl === 'string' && v.imageUrl === cur) return path;
      for (const k of Object.keys(v)) {
        if (k === 'id') continue;
        const hit = walk(v[k], path.concat(Array.isArray(v) ? String(k) : k));
        if (hit) return hit;
      }
      return null;
    };
    const hit = walk(props, []);
    if (hit && hit.length) return fromPath(hit);
  }
  if (isObj(props)) {
    for (const k of Object.keys(props)) {
      const v = props[k];
      if (isObj(v) && !Array.isArray(v) && 'imageUrl' in v) return { slotName: k, kind: 'object' };
    }
  }
  return null;
}

module.exports = { buildSlotPrompt, editorImagePrompt, editorImageTarget, EDITOR_THEME_WORD };
