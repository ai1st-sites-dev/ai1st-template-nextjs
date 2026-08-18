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

// 这两张表就是「这两个 Region 有哪些结构」的唯一清单 —— 组件按它渲染,theme 注册表按它填,
// 校验也按它。多一处清单就会有一处漂。
const HEADER_VARIANTS = [
  'solid-bar', // 现状:白底实色横条,sticky
  'transparent-overlay', // 透明浮层,压在首屏 hero 上(一律配一层遮罩,见文件顶上 ②)
  'centered-logo', // logo 居中,菜单分两侧
  'pill-floating', // 圆角胶囊浮动条,离顶部有间距
];

const FOOTER_VARIANTS = [
  'multi-column', // 现状:多列大脚
  'slim-row', // 单行小脚
  'cta-band', // 强调色 CTA 色带 + 小脚
];

// #1000 —— topbar 是 page layout 库里的第四种区（`with-topbar`）。它渲染的是既有的
// `AnnouncementBarSection`，所以这张清单逐字抄它的 props（`AnnouncementBarSection.tsx:11`）。
// 放在这里而不是那个组件里，理由跟 header/footer 一样：组件按它渲染、主题注册表按它填、校验按它，
// 多一处清单就会有一处漂。
const TOPBAR_VARIANTS = [
  'solid', // 现状默认:强调色实底细条
  'bordered', // 白底 + 强调色描边
  'dismissible', // 带关闭按钮
  'floating', // 居中圆角胶囊
];

const DEFAULT_HEADER = 'solid-bar';
const DEFAULT_FOOTER = 'multi-column';
const DEFAULT_TOPBAR = 'solid';

// resolveRegionLayout —— 一次构建里这两个 Region 到底长什么样。
//
// 入参:
//   layout   theme 对每个 block 用哪种写法的结论(`layoutFor(themeId)` —— 注册表里那张表 #1010 起
//            叫 `supports`,装的是清单,这个函数吐结论);没换装时传 {},两个 Region 都回到现状
//
// 📌 #1024 把 `pages` 和 `palette` 两个入参去掉了:它们只喂上面那张已经没有依据的证据表,
//    而「透明浮层一律加遮罩」不需要看页面、也不需要看调色板。留着不读的入参就是这张表回来的路。
//
// 出参:
//   header / footer  组件要渲染的结构名
//   headerScrim      透明浮层是否需要遮罩(见上面那条规则)
//   notes            人话解释,构建日志打出来 —— 「静默降级」是这类改动最容易长出来的病
function resolveRegionLayout(layout) {
  const wanted = layout || {};
  const notes = [];

  let header = DEFAULT_HEADER;
  if (wanted.header) {
    if (HEADER_VARIANTS.includes(wanted.header)) {
      header = wanted.header;
    } else {
      notes.push(`theme 想要的 header 版式 "${wanted.header}" 不在清单里,退回 ${DEFAULT_HEADER}`);
    }
  }

  let footer = DEFAULT_FOOTER;
  if (wanted.footer) {
    if (FOOTER_VARIANTS.includes(wanted.footer)) {
      footer = wanted.footer;
    } else {
      notes.push(`theme 想要的 footer 版式 "${wanted.footer}" 不在清单里,退回 ${DEFAULT_FOOTER}`);
    }
  }

  // #1000 —— topbar 的结构跟 header / footer 走同一条路:主题注册表想要什么就给什么,给不出来
  // 就退回默认并把理由记进 notes。没有 topbar 区的站也照样算出这个值(不占字节、不影响产物)。
  let topbar = DEFAULT_TOPBAR;
  if (wanted.topbar) {
    if (TOPBAR_VARIANTS.includes(wanted.topbar)) {
      topbar = wanted.topbar;
    } else {
      notes.push(`theme 想要的 topbar 版式 "${wanted.topbar}" 不在清单里,退回 ${DEFAULT_TOPBAR}`);
    }
  }

  // 对比度:透明浮层的字是白的,而它压着的那一段是什么颜色,这里没有任何办法知道 —— 底色住在
  // 主题的样式表里(见文件顶上 ②)。所以判据只剩一条:**是浮层就加遮罩**。
  //
  // 📌 遮罩本身只在浮层那一支里渲染(`Header.tsx` 的 floating 分支),而浮层只在第一段是 hero 的
  //    页面上才浮起来(SiteShell 的 overHero)。其余页面顶栏退回实色横条,这个值到不了 DOM,
  //    所以「整站一个值」不会让不浮的页面平白多一层遮罩。
  const headerScrim = header === 'transparent-overlay';
  if (headerScrim) {
    notes.push('透明浮层 ⟹ 加遮罩(首屏底色由主题样式表决定,这里证明不了它是深的;少一层遮罩就是白字压浅底)');
  }

  return { header, footer, topbar, headerScrim, notes };
}

// ── #1016 —— 透明浮层要求首屏是深的，而这一问只有【生成池子的时候】答得出来 ────────────────────
//
// 上面 ② 说的是一半：构建期证明不了首屏是深的,所以浮层一律配遮罩。那层遮罩是页面最上面 160px
// 的一条黑色渐变(`src/components/Header.tsx` 的 `from-black/75 via-black/55 to-transparent`),
// 浓度按「首屏是纯白」这个最坏情况定的 —— 浮层的字是白的,不这么浓就读不出来。
//
// 🔴 另一半此前没人管:同一层遮罩压在【浅底 + 深字】的 hero 上,把标题最上面那一截压到 rgb(110)
//    左右,而标题的字本来就是深的。实测(#1016 r5,真机、脚本自己造的样例站、80 份表全量跑):
//      azure-50    `.hero__title`  3.89:1   底 rgb(110,112,115) · 字 rgb(9,13,30)
//      crimson-30  `.hero__title`  3.81:1   底 rgb(115,110,111) · 字 rgb(30,9,10)
//    照片在 #1016 的交接留言里:第一行字压在深灰上,人真的读不出来。
//
// 🔴 这不是挑颜色的事,所以修法不是换一档字色:遮罩那一段里要浅字,遮罩外的浅底上要深字,
//    没有哪一种字色能同时活过两段。⟹ 只能【不产生这个搭配】—— 一套主题的表把首屏画成浅底时,
//    它不许声明 `transparent-overlay`。这就是下面这两个函数,`promote.js` 定 `supports.header`
//    时用它们。
//
// 🔴 判据落在【表自己的字节 + 这套主题自己的调色板】上,不是版式的名字 —— 上面 ② 已经写明
//    「从 variant 的名字推底色这条路本身不成立」。生成器手里同时有这两样东西,所以它答得出来;
//    `resolveRegionLayout` 手里没有,所以它一个字节都没改,现有的站和退役那 30 套的行为完全不变。
//
// 🔴 证明不了「深」就当它不是深的。两个方向的错法仍然不对称:少一套浮层最多是少一点花样,
//    多一套是老板首屏上的标题读不出来。
//
// 🔴 `via-black/55` 这个数在两处出现(那个组件里的 class 串 + 这里),而两处必然分叉。
//    `theme-pipeline/pool.test.js` 有一格读 `Header.tsx` 的原文盯它,改了那个 class 会红。
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
  const wanted = HEADER_VARIANTS[index % HEADER_VARIANTS.length];
  if (wanted !== 'transparent-overlay') return { variant: wanted, wanted, why: null };
  const verdict = heroTitleSurvivesHeaderScrim(sheetCss, colors);
  if (verdict.ok) return { variant: wanted, wanted, why: null };
  const next = HEADER_VARIANTS.filter((v) => v !== 'transparent-overlay');
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
 *     就是这套主题上线后的顶栏(在它之前,候选那条路 `applied:false` ⟹ 恒是默认 `solid-bar`,
 *     而上线池子里 80 套只有 22 套是它 —— 人审读到的标注与成品不符,#1079 就是这件事)。
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
    footer: FOOTER_VARIANTS[index % FOOTER_VARIANTS.length],
    headerMovedBy: headerPick.why,
  };
}

module.exports = {
  HEADER_VARIANTS,
  FOOTER_VARIANTS,
  TOPBAR_VARIANTS,
  DEFAULT_HEADER,
  DEFAULT_FOOTER,
  DEFAULT_TOPBAR,
  HEADER_SCRIM_MID_ALPHA,
  HEADER_SCRIM_INK_FLOOR,
  resolveRegionLayout,
  heroTitleSurvivesHeaderScrim,
  headerVariantForPool,
  regionsForPool,
};
