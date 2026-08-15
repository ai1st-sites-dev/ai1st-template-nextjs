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

module.exports = {
  HEADER_VARIANTS,
  FOOTER_VARIANTS,
  TOPBAR_VARIANTS,
  DEFAULT_HEADER,
  DEFAULT_FOOTER,
  DEFAULT_TOPBAR,
  resolveRegionLayout,
};
