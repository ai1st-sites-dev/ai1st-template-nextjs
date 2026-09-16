// ══════════════════════════════════════════════════════════════════════════════════════════════════
// block-page-index.js — 「这个块住在哪一页、它在这一页里排第几、这一页上还有哪些块」（#1351）
// ══════════════════════════════════════════════════════════════════════════════════════════════════
//
// 🔴 **为什么需要它：检查器面板手上只有一个 `data-block-id`，而写回去要的是 `{page, locale, 下标}`。**
//
// 面板是这么拿到那个 id 的：老板在 iframe 里点了一下，站侧回一条 `ai1st:block-selected`
// （`docs/reference/block-preview-messages.md`）。那条消息里**没有页面**，而面板也无法自己算出来 ——
// iframe 是跨源的，`location` 读不到；就算读得到，把 URL 还原成页面 slug 是
// `src/app/[...slug]/page.tsx` §`resolveSlug` 那一套（语言前缀、blog、默认语言重定向桩），在别处
// 再写一遍就是第二份实现，而分叉的样子是「面板改了另一页的同名块」——两边都绿。
//
// 所以问题反过来问：**拿着 id 去站自己的文件里找它。** 判据用的是构建时那一个函数
// （`blocks.js` §`normalizeLocalePages`），所以「这一页上有哪些块、按什么顺序、哪些被藏了」
// 跟构建出来的页面是同一个答案，不是一份重写的近似。
//
// 🔴 **老 `sections` 形状的站也吃这条路，而且正是它最需要。** 那种页面的块 id 是构建时现算的
//    （`blocks.js` §`generatedBlockId`，`<页>-<类型>-<下标>`），**一移动就变** —— 所以 PATCH 不能拿
//    它当目标（#1351 正文那条，dev3 的 `findBlockInPage` 对老形状直接拒 `blockId`）。这里回带的
//    `index` 就是它要的那个下标，而 `index` 是**现查出来的**，不是从 id 字符串里反解的：
//    反解要猜「哪几段是页名、哪几段是类型」，而两者都可能带横杠（`services/drain-repair` /
//    `cta-banner`），猜错的方向是静默的。
//
// 🔴 **回带的 `blocks` 是这一页的【全部】块，含被藏起来的那些。** 面板需要它的理由很实在：
//    被藏的块在产物里根本不存在（`SectionRenderer.tsx:17` 直接 `return null`）⟹ 预览里点不到 ⟹
//    只靠「点一下选中」那条路，老板把一个块藏起来之后就再也没有入口把它放回来。
//
// 回：`{ ok, page, locale, index, id, type, hidden, pos, total, blocks: [...] }`
//   · `index`  它在**文件数组**里的下标（PATCH 老形状用这个）
//   · `pos` / `total`  它在**渲染顺序**里排第几 / 这一页渲染出几个块（面板据此把到头的上移/下移置灰）
//   · `blocks` 这一页渲染顺序上的全部块 `{id, type, role, hidden, index}`，含隐藏的
'use strict';

const fs = require('fs');
const path = require('path');

const blocksLib = require('../blocks');

/** 这个站有哪些语言目录；老扁平站（没有 site_meta.json）回 `['']`，它的 localeDir 就是 `site/` 自己。 */
function localesOf(siteDir) {
  if (!fs.existsSync(path.join(siteDir, 'site_meta.json'))) return [''];
  try {
    const meta = JSON.parse(fs.readFileSync(path.join(siteDir, 'site_meta.json'), 'utf-8'));
    if (Array.isArray(meta.locales) && meta.locales.length) return meta.locales;
    return [meta.defaultLocale || 'en'];
  } catch {
    return ['en'];
  }
}

/**
 * 一页解出来的块清单（渲染顺序），每项带它在文件数组里的下标。
 *
 * 🔴 `normalizeLocalePages` 会**改**传进去的那个对象，所以喂它一份深拷贝；而「渲染顺序里的第 k 个」
 *    要能准确对回「文件数组里的第几条」，做法跟 `patch-block.js` §orderOf 同源：归一化之前给每个原始
 *    条目盖一个临时序号，归一化之后读回来。`{ref}` 条目上盖的序号到不了那一步（解 ref 那一支摊开的是
 *    站级块本体，条目自己的键一个都没带过来），所以那一类按 id 回查原始数组。
 */
function blocksOfPage(page, siteBlocks, locale) {
  const copy = JSON.parse(JSON.stringify(page));
  const list = copy.blocks || copy.sections || [];
  list.forEach((e, i) => { if (e && typeof e === 'object') e.__bpiIdx = i; });
  const out = blocksLib.normalizeLocalePages([copy], JSON.parse(JSON.stringify(siteBlocks)), locale || 'en', {});
  return (out[0].blocks || []).map((b) => {
    let raw = Number.isInteger(b.__bpiIdx) ? b.__bpiIdx : -1;
    if (raw === -1 && typeof b.id === 'string' && b.id) {
      raw = list.findIndex((e) => e && typeof e === 'object' && (e.ref === b.id || e.id === b.id));
    }
    return {
      id: typeof b.id === 'string' ? b.id : '',
      type: b.type || '',
      // 🔴 角色跟 DOM 上那个 `data-role` 同一个来源：块自己写了就用它自己的，没写按类型默认表
      //    （`blockAttrs.ts` 读的也是这张表，`blocks.js` §pageWithBlocks 写盘时也是这一句）。
      //    面板靠它决定「藏一个 essential 的块要不要多说一句」——而被藏起来的块在预览里没有 DOM，
      //    `data-role` 读不到，只能从这里拿。
      role: (typeof b.role === 'string' && b.role) ? b.role : blocksLib.roleFor(b.type),
      hidden: b.hidden === true,
      index: raw,
    };
  });
}

/**
 * 按 `blockId` 在整个站里找它住在哪一页。
 *
 * @param {object} opts `{ rootDir?, blockId, page?, locale? }` —— 给了 `page` 就只查那一页（省一圈 IO）。
 */
function locateBlockInSite(opts) {
  const o = opts || {};
  const rootDir = o.rootDir || process.cwd();
  const siteDir = path.join(rootDir, 'site');
  const wantId = typeof o.blockId === 'string' ? o.blockId : '';
  if (!wantId) return { ok: false, reason: 'bad-locator', message: '没说要找哪一个块' };

  const isLegacy = !fs.existsSync(path.join(siteDir, 'site_meta.json'));
  const locales = (typeof o.locale === 'string' && o.locale) ? [o.locale] : localesOf(siteDir);

  for (const locale of locales) {
    const localeDir = isLegacy ? siteDir : path.join(siteDir, locale);
    const pagesDir = path.join(localeDir, 'pages');
    if (!fs.existsSync(pagesDir)) continue;
    let siteBlocks = {};
    try { siteBlocks = blocksLib.readSiteBlocks(localeDir); } catch { siteBlocks = {}; }

    const files = fs.readdirSync(pagesDir).filter((f) => f.endsWith('.json')).sort();
    for (const f of files) {
      const slug = f.replace(/\.json$/, '');
      if (typeof o.page === 'string' && o.page && o.page !== slug) continue;
      let page;
      try { page = JSON.parse(fs.readFileSync(path.join(pagesDir, f), 'utf-8')); } catch { continue; }
      if (!page || typeof page !== 'object') continue;
      // `normalizeLocalePages` 按页面自己的 slug 判 visibility，而文件名才是权威（页面 JSON 里那个
      // `slug` 字段老站不一定有）。补上，免得靠 visibility 进来的站级块在这里少一块。
      if (typeof page.slug !== 'string' || !page.slug) page.slug = slug;
      let list;
      try { list = blocksOfPage(page, siteBlocks, locale); } catch { continue; }
      const pos = list.findIndex((b) => b.id === wantId);
      if (pos === -1) continue;
      const hit = list[pos];
      return {
        ok: true,
        page: slug,
        locale,
        index: hit.index,
        id: hit.id,
        type: hit.type,
        hidden: hit.hidden,
        pos,
        total: list.length,
        blocks: list,
      };
    }
  }
  return { ok: false, reason: 'not-found', message: `这个网站上找不到 ${JSON.stringify(wantId)} 这个块` };
}

module.exports = { locateBlockInSite, blocksOfPage, localesOf };
