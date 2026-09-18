// #960 — Header 和 Footer 这两个 Region 的版式,以及「透明浮层压在浅色 hero 上」那条对比度规则。
//
// 为什么单开一个文件:
//
// 🔴 ① 这两个键**不能**走 section 那条路。`sync-config.js` 应用 theme 版式的循环是
//    `const preferred = layout[section.type]` —— 顶栏和页脚不是 section,没有任何 section 的 type 是
//    `header`/`footer`,所以往偏好表里加这两个键会被 `if (!preferred) continue` **静默跳过,还不报错**。
//    ⟹ 它们要走另一个写出口(`config-data.ts` 里跟 brand / navigation 平级的一个导出)。
//
// 🔴 ② 透明浮层的顶栏**一律**配一层遮罩。两个方向的错法不对称:多一层遮罩最多是稍微不好看,
//    少一层是老板首屏上的白字看不见。
//
//    #1024 之前这里不是这么写的:那时按 hero 的 `variant` 查一张类名表,查得到就算「能证明是深底」,
//    深底就不加遮罩。**那张表今天没有依据了** —— #1008 把 hero 搬成中性 markup,九支 variant 分支
//    连同它们的深色底类名一起删了,hero 的底色现在住在主题的样式表里(`public/themes/*.css` 的
//    `.hero { background-color: … }`),没有样式表时就是 base.css,而 base.css 不给 hero 任何底色。
//    表里那 4 个类名串在 `HeroSection.tsx` 里的命中数今天全是 0,而它照样在给 5 个 variant 下
//    「能证明是深底」的结论。实测的后果(#1024 在 origin/main 上量的成品像素):midnight 这套
//    theme 判成深底、不加遮罩,而成品首屏是白的 ⟹ 公司名 + 4 条导航链接全是 1.00:1,一个字都看不见。
//
// 🔴 那为什么不换一张新的证据表:**从 variant 的名字推底色这条路本身已经不成立了。** 底色由样式表
//    决定,而样式表是一份 CSS,不是一个名字。真要保留「能证明是深底就不加遮罩」这个优化,判据必须
//    落在渲染出来的页面上(量 hero 那块的实际颜色),那是另一套机制;在它存在之前,这里只说得出
//    「证明不了」,而「证明不了 ⟹ 加遮罩」就是下面这一行。

const fs = require('fs');
const path = require('path');

// 🔴 #1353 —— 这里原来是三张写死的清单（`HEADER_VARIANTS` 4 · `FOOTER_VARIANTS` 3 ·
// `TOPBAR_VARIANTS` 4）。顶栏 / 页脚 / 公告条按块的规矩搬进形态层之后，「这个区有哪些结构」的
// 唯一权威是**块 manifest**（`blocks/<区>.json` 的 `shapes`），跟别的 32 个块一模一样。
// 留着这三张表就是第二份清单 —— 而本文件原来那句话（「多一处清单就会有一处漂」）说的正是这件事，
// 只不过那时它是唯一那一份，今天它成了多出来的那一份。
//
// 📌 公告条的 manifest 今天只有 **一种** 形态（`stack`）。它以前在这里有四个名字
// （`solid` / `bordered` / `dismissible` / `floating`），但那四个名字**今天画出来是同一个东西**：
// #1036 已经把那四棵树收成一份中性 markup，而四个值只落在 `data-region-layout` 这个属性上，
// **全树没有任何 CSS 选它**（判据：8 份 CSS 里 `region-layout` 命中 0；同一把 grep 换成
// `data-shape` 命中 2 ⟹ 尺子不是恒 0）。搬「四个画出来相同的名字」不是 #1318 的搬不删，是新造
// 四种形态 —— 本文件头上那条「不为将来可能有预留名字」（`public/shapes.css` 文件头同款）禁的就是它。
/** 一个区有哪些形态 —— 从它自己的 manifest 现取（第 0 项是默认，`block-manifest.js` 的
 * `checkManifestShape` 保证它 needs 为空）。
 *
 * 🔴 **直接读那一份 JSON，不走 `block-manifest.js` 的 `loadManifests()`。** 权威是同一个文件，
 * 差别在依赖面：`loadManifests()` 会顺带把**全部 34 份** manifest 读一遍、逐份跑校验、还要核
 * `public/shapes.css`（形态清单两向对账）。本文件只想知道「这个区有哪几个名字」，而它有一批调用方
 * 跑在**只有部分模板**的临时树里（`lib/remediation.test.js` 与 `lib/site-shape.test.js` 造的那几棵
 * 对照树）。走那条重的链，那些树要跟着补 `scripts/blocks.js` + `src/lib/sections/` +
 * `public/shapes.css` 才跑得起来 —— 我真的一步步补过，补到第四样才发现是依赖方向错了：
 * **校验是构建的职责，不是「读一张清单」的职责。**
 * 📌 manifest 本身的合法性照旧有人管：`loadManifests()` 在构建和 `block-manifest.test.js` 里跑，
 *    一份写坏的 manifest 在那两处当场抛。这里读到空清单时 `resolveRegionShapes` 会退回空串并记 notes。
 */
const _shapesCache = new Map();
function shapesOf(blockType) {
  if (_shapesCache.has(blockType)) return _shapesCache.get(blockType);
  let names = [];
  try {
    const raw = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'blocks', `${blockType}.json`), 'utf-8'));
    if (Array.isArray(raw.shapes)) names = raw.shapes.map((sh) => sh && sh.name).filter(Boolean);
  } catch { names = []; }
  _shapesCache.set(blockType, names);
  return names;
}

/**
 * 同一份清单，**去掉候选**（#1384）—— 「这个区可以被挑中哪几个形态」。
 *
 * 🔴 `shapesOf` 自己**不过滤**，是有意的：它回答的是「这个块有哪些形态」，`region-layout.test.js` ⑦
 *    正拿它跟 manifest 逐项对账，`lib/page-layout.js` / `lib/navigation-owned.js` 也按那个语义读它。
 *    过滤掉候选就是把一个「清单」悄悄变成一份「可选项」，两个语义住在一个函数名下是它们分叉的方式。
 *
 * 🔴 **为什么这条也要有**：Region（顶栏 / 页脚 / 公告条）的形态**不走** `theme-pipeline/shape-sheet.js`
 *    的 `shapeSheetFor`，也**不走** `sync-config.js` 的 `shapeForBlock` —— 它们由 `regionsForPool`
 *    （生成池成员时）与 `resolveRegionShapes`（构建时）各自挑。#1384 正文点名的两处堵法按构造
 *    对这三个区一个字都不说，而它们跟别的 30 个块共用 manifest、共用形态层 ⟹ 一个标了候选的顶栏形态
 *    会被轮换直接挑中，戴到每一个穿这套主题的真站上。两处各堵一处，同一条规矩。
 *
 * 🔴 空清单当场抛，不悄悄回一个候选或者空串：按构造走不到（`checkManifestShape` 不许 `shapes[0]`
 *    是候选 ⟹ 每个块至少剩一个非候选），真响那天说明那条校验被人放宽了。
 *    读不出 manifest（`shapesOf` 回 []）时照旧回 [] —— 那是「读不到」，由调用方自己的 notes 处置。
 */
function pickableShapesOf(blockType) {
  const all = shapesOf(blockType);
  if (!all.length) return all;
  const pickable = all.filter((name) => !candidateShapeNames(blockType).has(name));
  if (!pickable.length) {
    throw new Error(`blocks/${blockType}.json 的形态全是 candidate —— 这个区没得挑。`
      + '默认形态（shapes[0]）按 checkManifestShape 就不许是候选，走到这里说明那条校验被放宽了');
  }
  return pickable;
}

/** 这个块里标了 `candidate: true` 的形态名（#1384）。跟 `shapesOf` 同一个读法、同一份缓存纪律。 */
const _candidateCache = new Map();
function candidateShapeNames(blockType) {
  if (_candidateCache.has(blockType)) return _candidateCache.get(blockType);
  let names = new Set();
  try {
    const raw = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'blocks', `${blockType}.json`), 'utf-8'));
    if (Array.isArray(raw.shapes)) {
      names = new Set(raw.shapes.filter((sh) => sh && sh.candidate === true).map((sh) => sh.name));
    }
  } catch { names = new Set(); }
  _candidateCache.set(blockType, names);
  return names;
}

/** 三个区各自的块类型。`topbar` 这个区名对应的块是公告条。 */
const REGION_BLOCK = { header: 'header', footer: 'footer', topbar: 'announcement-bar' };

// resolveRegionShapes —— 一次构建里这三个 Region 到底长什么样。
//
// 入参:
//   chosen   这套主题给三个区挑的形态(`regionShapesFor(themeId)` —— 读的是选择单 `shapes` 里
//            `header` / `footer` / `announcement-bar` 那三行,每行一个名字);注册表里查不到这个
//            id 就传 {},三个区都落回各自 manifest 的默认形态
//            🔴 #1353 之前这个入参叫 `layout`、读的是 `supports`(一个清单,取第一项)。那个键退役了。
//
// 📌 #1024 把 `pages` 和 `palette` 两个入参去掉了:它们只喂上面那张已经没有依据的证据表,
//    而「透明浮层一律加遮罩」不需要看页面、也不需要看调色板。留着不读的入参就是这张表回来的路。
//
// 出参:
//   header / footer  组件要渲染的结构名
//   headerScrim      透明浮层是否需要遮罩(见上面那条规则)
//   notes            人话解释,构建日志打出来 —— 「静默降级」是这类改动最容易长出来的病
function resolveRegionShapes(chosen) {
  const wanted = chosen || {};
  const notes = [];
  const out = {};
  for (const [region, blockType] of Object.entries(REGION_BLOCK)) {
    const list = shapesOf(blockType);
    const fallback = list[0] || '';
    // 区名与块名不同的那一个：选择单里公告条的键是块类型 `announcement-bar`，不是区名 `topbar`。
    const asked = wanted[blockType] !== undefined ? wanted[blockType] : wanted[region];
    let shape = fallback;
    if (asked) {
      // #1384 —— 候选点名了也退回默认。跟 `sync-config.js` §shapeForBlock 那条同一条规矩，只是这三个区
      // 不走那个函数（它只走页面 JSON 里的块），所以判据在这里再说一次。**分开报**：「是候选」跟
      // 「不在清单里」是两件事，合成一句会让读日志的人以为 manifest 写漏了一个名字。
      if (candidateShapeNames(blockType).has(asked)) {
        notes.push(`theme 给 ${region} 选的形态 "${asked}" 是候选(还没签字进库),退回 ${fallback}`);
      } else if (list.includes(asked)) shape = asked;
      else notes.push(`theme 给 ${region} 选的形态 "${asked}" 不在 blocks/${blockType}.json 的清单里(${list.join(' / ')}),退回 ${fallback}`);
    }
    out[region] = { shape };
  }
  out.notes = notes;
  return out;
}

// ── #1016 —— 透明浮层要求首屏是深的，而这一问只有【生成池子的时候】答得出来 ────────────────────
//
// 上面 ② 说的是一半：构建期证明不了首屏是深的,所以浮层一律配遮罩。那层遮罩是页面最上面 160px
// 的一条黑色渐变,浓度按「首屏是纯白」这个最坏情况定的 —— 浮层的字是白的,不这么浓就读不出来。
// 📌 #1353 之前它写在 `Header.tsx` 的 Tailwind 串上(`from-black/75 via-black/55 to-transparent`),
//    今天写在 `public/base.css` 的 `.header__scrim`。浏览器算出来的 `background-image` 两边同一个串
//    (`linear-gradient(rgba(0, 0, 0, 0.75), rgba(0, 0, 0, 0.55), rgba(0, 0, 0, 0))`,#1353 两臂各量一次)。
//
// 🔴 另一半此前没人管:同一层遮罩压在【浅底 + 深字】的 hero 上,把标题最上面那一截压到 rgb(110)
//    左右,而标题的字本来就是深的。实测(#1016 r5,真机、脚本自己造的样例站、80 份表全量跑):
//      azure-50    `.hero__title`  3.89:1   底 rgb(110,112,115) · 字 rgb(9,13,30)
//      crimson-30  `.hero__title`  3.81:1   底 rgb(115,110,111) · 字 rgb(30,9,10)
//    照片在 #1016 的交接留言里:第一行字压在深灰上,人真的读不出来。
//
// 🔴 这不是挑颜色的事,所以修法不是换一档字色:遮罩那一段里要浅字,遮罩外的浅底上要深字,
//    没有哪一种字色能同时活过两段。⟹ 只能【不产生这个搭配】—— 一套主题的表把首屏画成浅底时,
//    它不许声明 `transparent-overlay`。这就是下面这两个函数,`promote.js` 定选择单里 `header` 那一行
//    时用它们(#1353 之前那一行叫 `supports.header`)。
//
// 🔴 判据落在【表自己的字节 + 这套主题自己的调色板】上,不是版式的名字 —— 上面 ② 已经写明
//    「从 variant 的名字推底色这条路本身不成立」。生成器手里同时有这两样东西,所以它答得出来;
//    `resolveRegionShapes`(#1353 之前叫 `resolveRegionLayout`)手里没有,所以它一个字节都没改,
//    现有的站和退役那 30 套的行为完全不变。
//
// 🔴 证明不了「深」就当它不是深的。两个方向的错法仍然不对称:少一套浮层最多是少一点花样,
//    多一套是老板首屏上的标题读不出来。
//
// 🔴 这个数在两处出现(遮罩那条 CSS 规则 + 这里),而两处必然分叉。
//    `theme-pipeline/pool.test.js` 有一格盯着它:#1353 之前读 `Header.tsx` 里的 `via-black/55`,
//    今天读 `public/base.css` 的 `.header__scrim` 那条 `linear-gradient` 的中间那一档。改了会红。
const HEADER_SCRIM_MID_ALPHA = 0.55;
// 标题要读得出来的门槛。跟 `sheet-recipes.js` 的 `INK_FLOOR` 同一个数(WCAG 正文 4.5:1),
// 但故意不 require 它:那份文件是生成表用的配方,而这条规则管的是顶栏,两者没有依赖关系。
const HEADER_SCRIM_INK_FLOOR = 4.5;

/**
 * 这份表的 hero 标题,压在遮罩底下还读得出来吗?
 *
 * @param {string} sheetCss  这套主题自己那份 `public/themes/<id>.css` 的原文
 * @param {object} colors    这套主题的调色板(`{ primary: {50..900}, accent: {50..600} }`)
 * @returns {{ok: boolean, why: string, ratio: number|null}}
 *          `ok` 为真 = 可以给它透明浮层。**答不出来一律回 false**(见上面那条 fail-safe)。
 */
function heroTitleSurvivesHeaderScrim(sheetCss, colors) {
  // 用 `theme-contrast.js` 那套解析和算术,不在这里再写一份:两处各算一遍同一件事就会分叉。
  const contrastLib = require('./theme-contrast.js');
  const vars = {};
  for (const [ramp, shades] of Object.entries(colors || {})) {
    for (const [shade, hex] of Object.entries(shades || {})) vars[`--color-${ramp}-${shade}`] = hex;
  }
  const { colourOf, bgOf } = contrastLib.indexSheet(contrastLib.parseSheet(String(sheetCss || '')));
  const bgExpr = (bgOf.get('.hero') || {}).color;
  const fgExpr = colourOf.get('.hero__title');
  if (!bgExpr || !fgExpr) {
    return { ok: false, ratio: null, why: `表里读不到 ${bgExpr ? '.hero__title 的 color' : '.hero 的背景色'}` };
  }
  const bg = contrastLib.resolveColour(bgExpr, vars);
  const fg = contrastLib.resolveColour(fgExpr, vars);
  if (!bg || !fg || bg.alpha !== 1) {
    return { ok: false, ratio: null, why: `解不出颜色(底 ${bgExpr} · 字 ${fgExpr})` };
  }
  // 遮罩是黑色的半透明层压在首屏上,所以底色变成「底色跟黑色按遮罩浓度混一下」。
  const under = contrastLib.mixBytes(bg.rgb, [0, 0, 0], HEADER_SCRIM_MID_ALPHA);
  const ratio = contrastLib.contrast(fg.rgb, under);
  return {
    ok: ratio >= HEADER_SCRIM_INK_FLOOR,
    ratio,
    why: `.hero__title ${fgExpr} 压在「${bgExpr} 混 ${Math.round(HEADER_SCRIM_MID_ALPHA * 100)}% 黑」`
      + `= rgb(${under}) 上是 ${ratio.toFixed(2)}:1（门槛 ${HEADER_SCRIM_INK_FLOOR}）`,
  };
}

/**
 * 生成池成员时,这套主题的顶栏用哪种结构。
 *
 * 想要的那一种由 `index` 轮换决定(跟改这条规则之前一样);唯一的约束是上面那条 —— 浅底首屏
 * 不许配透明浮层,撞上就顺着清单往后取第一个不是浮层的。
 *
 * @returns {{variant: string, wanted: string, why: string|null}} `why` 非空 = 让开了,原因在里面
 */
function headerVariantForPool(index, sheetCss, colors) {
  // #1384 —— 挑的时候跳过候选（`pickableShapesOf`，理由在它上面）。
  const HEADER_SHAPES = pickableShapesOf('header');
  const wanted = HEADER_SHAPES[index % HEADER_SHAPES.length];
  if (wanted !== 'transparent-overlay') return { variant: wanted, wanted, why: null };
  const verdict = heroTitleSurvivesHeaderScrim(sheetCss, colors);
  if (verdict.ok) return { variant: wanted, wanted, why: null };
  const next = HEADER_SHAPES.filter((v) => v !== 'transparent-overlay');
  return {
    variant: next[index % next.length],
    wanted,
    why: `透明浮层要求首屏是深的 —— ${verdict.why}`,
  };
}

/**
 * 一个池位子上的那两个 Region 长什么样 —— 顶栏走上面那条让开规则,页脚是纯轮换。
 *
 * 🔴 #1079 —— 这个函数存在的理由是**两个调用方要拿到同一个答案**,而它们相隔一整道人审:
 *   · `promote.js` 定池成员的 `supports.header/footer`(人审**之后**);
 *   · `theme-pipeline/run.js` 把候选装进样例站时提前算同一个值,好让人审那本图册拍到的顶栏
 *     就是这套主题上线后的顶栏(在它之前,候选那条路恒是默认 `solid-bar`,而上线池子里 80 套只有
 *     22 套是它 —— 人审读到的标注与成品不符,#1079 就是这件事)。
 *     📌 那时的断点是 `applied:false`;#1086(2026-08-18)之后是「候选的 id 不在注册表里」——
 *        断的那一维没变,所以这个函数照样是候选那条路唯一的来源。
 *
 * 🔴 页脚那行轮换算术此前是 `promote.js` 里的一句 inline。两处各写一遍就会漂成两个答案,
 *    而漂的后果正是本票要治的那个毛病(图上那个 ≠ 上线后那个),所以它搬进来跟顶栏并排。
 *
 * 🔴 这个答案只在【人审全收】时等于上线后的那个值:`promote.js` 的 `buildPool` 按**过滤之后的
 *    位置**发位子(`take.forEach((c, i) => … slots[i])`),所以人审拒掉一套,它后面每一套的
 *    `index` 都往前挪一格,顶栏(`index % 4`)跟着变。判据在调用方,不在这里 —— 这个函数只回答
 *    "第 index 个位子上是什么"。
 *
 * @param index    池位子的序号(`poolSlots()[k].index`)
 * @param sheetCss 这套候选自己那份表的原文(顶栏那条让开规则要读它)
 * @param colors   这套候选的调色板
 * @returns {{header: string, footer: string, headerMovedBy: string|null}}
 *          `headerMovedBy` 非空 = 顶栏被那条规则挪走了,原因在里面
 */
function regionsForPool(index, sheetCss, colors) {
  const headerPick = headerVariantForPool(index, sheetCss, colors);
  return {
    header: headerPick.variant,
    footer: pickableShapesOf('footer')[index % pickableShapesOf('footer').length],
    headerMovedBy: headerPick.why,
  };
}

module.exports = {
  REGION_BLOCK,
  shapesOf,
  pickableShapesOf,
  candidateShapeNames,
  HEADER_SCRIM_MID_ALPHA,
  HEADER_SCRIM_INK_FLOOR,
  resolveRegionShapes,
  heroTitleSurvivesHeaderScrim,
  headerVariantForPool,
  regionsForPool,
};
