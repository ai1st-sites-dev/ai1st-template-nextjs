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
// 回：`{ ok, page, locale, shape, index, id, type, hidden, pos, total, blocks: [...] }`
//   · `shape`  这一页写的是 `blocks` 还是 `sections` —— PATCH 的定位方式由它决定，调用方猜不出来
//   · `index`  它在**文件数组**里的下标（PATCH 老形状用这个）
//   · `pos` / `total`  它在**渲染顺序**里排第几 / 这一页渲染出几个块（含被藏起来的那些）
//   · `visPos` / `visTotal`  **只数看得见的那几个**：它前面有几个没被藏的 / 这一页看得见几个块。
//     🔴 面板的上移下移按钮什么时候置灰，用的是这一对，不是上面那一对 —— 藏起来的块在建出来的
//     页面上没有 DOM，所以它不占一格：`patch-block.js` 挪一格时会跳过它，预览里换的也是下一个
//     看得见的块。要是按 `pos`/`total` 置灰，「最后一个看得见的块」后面还挂着一个藏起来的块时
//     下移按钮是亮的，而按下去的结果是权重换了、看得见的顺序一个字没变（QA1 在 #1351 r3 抓到的
//     就是这一格：点了、预览里动了、重建完跟点之前一模一样，没有任何地方会红）。
//     被藏起来的块自己也有 `visPos`，它的意思是「它前面有几个看得见的块」。
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
 * 按 `blockId`，或者按 `{page, index}`，在站里找一个块住在哪一页。
 *
 * @param {object} opts `{ rootDir?, blockId?, index?, page?, locale? }` —— 给了 `page` 就只查那一页（省一圈 IO）。
 *
 * 🔴 **为什么要有 `{page, index}` 这条问法（#1351 r6，QA2 在真机上量到的那一格）。**
 *    老 `sections` 形状的块 id 是按数组下标现算的，**挪一格 id 就变**。面板存下一笔之后要重新问
 *    「它现在住在哪」—— 那时它手上那个 id 已经不存在了（真机读数：`legacy-features-grid-1` 回 404，
 *    而那个块已经变成 `legacy-features-grid-3`），面板于是把控件全收起来，老板看到一句
 *    "Could not read this section."。挪完之后的下标是 `patch-block.js` 回带、经 worker 带给面板的，
 *    所以这里要能按那个下标问 —— 这一条跟 PATCH 的定位方式是同一条规矩（老形状按下标，新形状按 id），
 *    而不是给面板一个「自己从 id 串里反解下标」的新路（那条路要猜页名和类型各占几段，都可能带横杠）。
 * 🔴 **按下标问时 `page` 必填，而且只认 ≥ 0 的整数。** 下标只在一页之内有意义；而 `-1` 是
 *    「靠 visibility 进来、这一页文件里没有它的条目」那一类的下标，同一页上可以有好几个 —— 拿它
 *    当定位会静默指到另一个块上。
 */
function locateBlockInSite(opts) {
  const o = opts || {};
  const rootDir = o.rootDir || process.cwd();
  const siteDir = path.join(rootDir, 'site');
  const wantId = typeof o.blockId === 'string' ? o.blockId : '';
  const wantPage = typeof o.page === 'string' ? o.page : '';
  const wantIndex = Number.isInteger(o.index) && o.index >= 0 ? o.index : -1;
  if (!wantId && wantIndex === -1) return { ok: false, reason: 'bad-locator', message: '没说要找哪一个块' };
  if (!wantId && !wantPage) return { ok: false, reason: 'bad-locator', message: '按下标找块要说是哪一页' };

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
      const hasSections = !Object.prototype.hasOwnProperty.call(page, 'blocks')
        && Object.prototype.hasOwnProperty.call(page, 'sections');
      let list;
      try { list = blocksOfPage(page, siteBlocks, locale); } catch { continue; }
      const pos = wantId ? list.findIndex((b) => b.id === wantId) : list.findIndex((b) => b.index === wantIndex);
      if (pos === -1) continue;
      const hit = list[pos];
      return {
        ok: true,
        page: slug,
        locale,
        // 🔴 **这一页写的是 `blocks` 还是 `sections`，必须由这里说出来 —— 调用方猜不出来。**
        //    两种形状的 PATCH 定位方式不同（新形状按 `blockId`，老形状按 `index`，因为老形状的
        //    id 是构建时按下标现算的、一移动就变），而 dev3 的 `findBlockInPage` 对老形状的
        //    `blockId` 直接回 'bad-locator'。
        //    我第一版让面板拿「回来的 id 跟我手上那个一不一样」去判 —— **它恒为假**：老形状的块
        //    id 也是现算出来的同一个串，两边逐字相同。于是老站上每一次保存都会撞 bad-locator，
        //    而新站上一切正常 ⟹ 这种坏法只有在老站上才看得见，最容易漏过去。
        shape: hasSections ? 'sections' : 'blocks',
        index: hit.index,
        id: hit.id,
        type: hit.type,
        hidden: hit.hidden,
        pos,
        total: list.length,
        // 看得见的那几个里它排第几 / 一共几个。被藏的块不占位置，所以这两个数跟上面那两个
        // 在「这一页有块被藏起来」时就不是一回事 —— 面板的按钮用的是这一对（见文件头）。
        visPos: list.slice(0, pos).filter((b) => !b.hidden).length,
        visTotal: list.filter((b) => !b.hidden).length,
        blocks: list,
      };
    }
  }
  return {
    ok: false,
    reason: 'not-found',
    message: wantId
      ? `这个网站上找不到 ${JSON.stringify(wantId)} 这个块`
      : `${JSON.stringify(wantPage)} 这一页上没有第 ${wantIndex} 个块`,
  };
}

module.exports = { locateBlockInSite, blocksOfPage, localesOf };
