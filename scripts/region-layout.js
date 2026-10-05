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
// 唯一权威是**块自己那个文件夹**（`blocks/<区>/` 下的形态子文件夹，#1387），跟别的块一模一样。
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

// #1387 —— 形态住在 `blocks/<块>/<形态>/`：名字是子文件夹名，`order` 在
// `shape.md` 的 frontmatter 里。
//
// 🔴 **这里只认这一个键，而且是自己读的，不 require `block-build/build-blocks.js` 的解析器。**
//    理由跟上面那条「不走 loadManifests」逐字同一条：本文件有一批调用方跑在**只有部分模板**的临时树里
//    （`region-layout.test.js` / `lib/remediation.test.js` / `lib/site-shape.test.js` 造的那几棵），
//    它们今天只拷 `scripts/region-layout.js` 这一个文件。多 require 一个模块，那几棵树全部要跟着补
//    ——「读一张清单」不该拖着别的模块走。这个键是顶层、零缩进的标量，写它的是同一个子集
//    （`block-build/frontmatter.js` 的 formatFrontmatter），所以一条正则是够的。
function shapeMetaFrom(md) {
  const order = md.match(/^order:\s*(-?\d+)\s*$/m);
  return { order: order ? Number(order[1]) : null };
}

function readShapeDirs(blockType) {
  if (_shapesCache.has(blockType)) return _shapesCache.get(blockType);
  let shapes = [];
  try {
    const dir = path.join(__dirname, '..', 'blocks', blockType);
    shapes = fs.readdirSync(dir, { withFileTypes: true })
      .filter((e) => e.isDirectory())
      .map((e) => {
        let md = '';
        try { md = fs.readFileSync(path.join(dir, e.name, 'shape.md'), 'utf-8'); } catch { md = ''; }
        const meta = shapeMetaFrom(md);
        return { name: e.name, order: meta.order };
      })
      .sort((a, b) => {
        if (a.order !== null && b.order !== null && a.order !== b.order) return a.order - b.order;
        if (a.order !== null && b.order === null) return -1;
        if (a.order === null && b.order !== null) return 1;
        return a.name < b.name ? -1 : a.name > b.name ? 1 : 0;
      });
  } catch { shapes = []; }
  _shapesCache.set(blockType, shapes);
  return shapes;
}

function shapesOf(blockType) {
  return readShapeDirs(blockType).map((sh) => sh.name);
}

/**
 * 「这个区可以被挑中哪几个形态」。#1579 删掉候选形态之后它跟 `shapesOf` 是同一份清单 —— 名字留着，
 * 是因为调用方（`lib/editor-root.js`、`headerVariantForPool` / `regionsForPool`）问的就是这个问题。
 */
function pickableShapesOf(blockType) {
  return shapesOf(blockType);
}

/** 两个区各自的块类型。#1425（T3）：公告条那个区（`topbar` → `announcement-bar`）随旧库退役 ——
 *  它的继任是 header 自己的 `options.topbar`（带不带由主题挑哪套 header 形态决定），不是一个区。 */
const REGION_BLOCK = { header: 'header', footer: 'footer' };

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
      if (list.includes(asked)) shape = asked;
      else notes.push(`theme 给 ${region} 选的形态 "${asked}" 不在 blocks/${blockType}/ 的清单里(${list.join(' / ')}),退回 ${fallback}`);
    }
    out[region] = { shape };
  }
  out.notes = notes;
  return out;
}

/**
 * 生成池成员时,这套主题的顶栏用哪种结构 —— 纯轮换(`index`)。
 *
 * 📌 #1425（T3）:以前这里还有一条「浅底首屏不许配透明浮层」的让开规则(连同 `heroTitleSurvivesHeaderScrim`
 *    和遮罩浓度那两个常数)。新 header 的 7 个预设里没有透明浮层 ⟹ 那条规则守的形态不存在了,整段删掉。
 *
 * @returns {{variant: string, wanted: string, why: null}}
 */
function headerVariantForPool(index) {
  const HEADER_SHAPES = pickableShapesOf('header');
  const wanted = HEADER_SHAPES[index % HEADER_SHAPES.length];
  return { variant: wanted, wanted, why: null };
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
  const headerPick = headerVariantForPool(index);
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
  resolveRegionShapes,
  headerVariantForPool,
  regionsForPool,
};
