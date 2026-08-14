// #960 — Header 和 Footer 这两个 Region 的版式,以及「透明浮层压在浅色 hero 上」那条对比度规则。
//
// 为什么单开一个文件:
//
// 🔴 ① 这两个键**不能**走 section 那条路。`sync-config.js` 应用 theme 版式的循环是
//    `const preferred = layout[section.type]` —— 顶栏和页脚不是 section,没有任何 section 的 type 是
//    `header`/`footer`,所以往偏好表里加这两个键会被 `if (!preferred) continue` **静默跳过,还不报错**。
//    ⟹ 它们要走另一个写出口(`config-data.ts` 里跟 brand / navigation 平级的一个导出)。
//
// 🔴 ② 「哪些组合禁配」这件事写成**性质**,不是一张组合清单。#959 正在给 hero 加浅底写法,而一张
//    「`minimal` + 透明浮层禁配」式的清单会在那张票落地当天漏掉新写法 —— 漏的表现是**白字浮在浅图上
//    看不见**,不会报错、也不会红。所以这里反过来问:**这个 hero 能不能被证明是深底?**
//    能证明 ⟹ 透明浮层裸着上;**其余一律加遮罩**(包括新写法、也包括任何这里不认识的写法)。
//    两个方向的错法不对称:多加一层遮罩最多是稍微不好看,少加一层是老板的首屏字看不见。

const fs = require('fs');
const path = require('path');

// 这两张表就是「这两个 Region 有哪些结构」的唯一清单 —— 组件按它渲染,theme 注册表按它填,
// 校验也按它。多一处清单就会有一处漂。
const HEADER_VARIANTS = [
  'solid-bar', // 现状:白底实色横条,sticky
  'transparent-overlay', // 透明浮层,压在首屏 hero 上(深底 hero 才裸着上,见下面那条规则)
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

// 🔴 每一种「能证明是深底」的 hero 写法,都要在这里写出它**靠哪一档颜色**深下来 —— 而且那一档要真的
// 画得出来。判据不是我读源码时觉得它深(r1 就是这么写的,五行里三行跟源码对不上),而是两件当场能查的事:
//
//   ① `tailwind.config.ts` 声明了这一档吗?没声明 ⟹ 那个 class 不产生任何 CSS 规则,什么都不画。
//   ② 这个站的调色板里有这一档吗?没有 ⟹ CSS 变量是空的,同样什么都不画。
//
// 任何一条不成立 ⟹ 证明不了 ⟹ 按浅底处理,加遮罩。
//
// 🔴 r1 为什么错(QA2 在成品像素上量出来的):`video-style` 那行写的证据是 `bg-primary-950`,而 tailwind 的
// primary 只到 900、30 套 theme 里定义 950 的有 0 套 ⟹ 那个 class 什么都不画,首屏就是页面的白底,
// 白字压白底,midnight / charcoal-lime / copper-dark 三套的整条导航在成品里一个字都看不见。
// 上面那两个条件就是为这件事加的:证据不再是我读源码时的印象,而是两件当场查得到的事。
//
// 📌 #966(2026-08-12 落地)把 `HeroSection.tsx` 里 video-style 那一支的根节点从 `bg-primary-950` 改成了
// `bg-primary-900`(它治的是同一个根:那个 class 什么都不画,所以那三套的**首屏标题**也是白字压白底)。
// 于是这一行跟着改成 900 —— 表里记的必须是**源码今天真正用的那一档**,`spec:197` 会逐支核对。
// 连带的后果有两个,都量过:①那三套 theme 从「有遮罩」变成「裸着浮」,而裸浮压在 primary-900 上导航文字是
// 10.96–15.40:1,比带遮罩时更清楚 ②30 套里**再没有一套**会走遮罩这条路,所以那条规则的正向验证只能用
// 合成夹具(spec 里那一臂造的是「透明浮层 + #959 的浅底首屏」这个组合)。
//
// 表里没有的名字一律按浅底处理。#959 加的新写法不用来动这张表 —— 它们默认就会拿到遮罩。
//
// 🔴 r2 这张表带着行号,而**三行的行号是串位的**(QA1 在 r2 上逐行读源码抓到的):记的 left 那一行其实是
// split 的、split 那一行其实是 centered 的、centered 那一行其实是兜底那支的。三行记的颜色档碰巧都是
// primary-900、跟各自实际用的一致,所以判定没错 —— 但**没有任何一项测试拦得住它**:那一项先把行号删掉,
// 再拿类名在整份文件里搜,而这三行的类名本来就彼此重复,怎么串位都搜得到。
// ⟹ r3 把行号整个去掉,改成让测试**按分支**核对:每个变体去 `if (variant === 'x')` 那一支里取它真正的
// 根节点类名,跟这里记的逐字比。行号是会漂的注释、核起来还会为无关改动变红;而「这个类名是不是这一支
// 渲染的」才是这张表真正要成立的那件事。
const PROVABLY_DARK_HERO_EVIDENCE = {
  // 变体 → [根节点类名(逐字抄自 HeroSection.tsx 里【它自己那一支】), 顶部那一档颜色]
  left: ['relative bg-gradient-to-br from-primary-900 via-primary-800 to-primary-700 text-white', ['primary', '900']],
  split: ['relative bg-gradient-to-b from-primary-900 via-primary-800 to-primary-700 text-white', ['primary', '900']],
  centered: ['relative bg-gradient-to-b from-primary-900 via-primary-800 to-primary-700 text-white', ['primary', '900']],
  'gradient-overlay': ['relative overflow-hidden bg-gradient-to-br from-primary-600 to-accent-600 text-white', ['primary', '600']],
  'video-style': ['relative bg-primary-900 text-white', ['primary', '900']], // #966 起是 900(原来是 950,那一档没人声明)
  // minimal 那一支是 `bg-white` —— 浅底,本来就不该在这张表里
};

// tailwind 声明了哪些档。**读不到 / 解析不出就返回空集** —— 于是没有一种 hero 能被证明是深底,全部加遮罩。
// 这是安全的那个方向:多一层遮罩最多是稍微不好看,少一层是老板首屏上的字看不见。
let utilityShadesMemo = null;
function utilityShades() {
  if (utilityShadesMemo) return utilityShadesMemo;
  const out = {};
  try {
    const src = fs.readFileSync(path.join(__dirname, '..', 'tailwind.config.ts'), 'utf8');
    for (const family of ['primary', 'accent']) {
      const block = src.match(new RegExp(`${family}:\\s*\\{([^}]*)\\}`));
      if (!block) continue;
      out[family] = (block[1].match(/(\d+)\s*:/g) || []).map(s => s.replace(/\s*:$/, ''));
    }
  } catch {
    /* 读不到就是空集,见上 */
  }
  utilityShadesMemo = out;
  return out;
}

// 一页的第一段是不是 hero。
//
// 🔴 数的是**画得出来的**第一段:站自己的页面 JSON 可以把某一段标成不显示(`hidden`,SectionRenderer
// 直接 return null),而那一段仍然留在 sections 里。运行时那一侧是 `config.ts` 的 pageStartsWithHero,
// 两处必须说同一件事 —— 一边判"浮不浮"、一边判"要不要遮罩",分歧的表现就是白字压白底。
function firstSectionHero(page) {
  const sections = page && Array.isArray(page.sections) ? page.sections : [];
  const first = sections.find(s => s && !s.hidden) || null;
  return first && first.type === 'hero' ? first : null;
}

// 这个 hero 能不能被证明是深底。palette = 这个站的 brand.colors(`{ primary: {50..900}, accent: {…} }`)。
// 返回 { dark, why } —— why 是判不成立时的人话,构建日志要打出来。
function heroIsProvablyDark(heroSection, palette) {
  if (!heroSection) return { dark: false, why: '第一段不是 hero' };
  const variant = (heroSection.data && heroSection.data.variant) || 'left'; // HeroSection 的默认值
  const evidence = PROVABLY_DARK_HERO_EVIDENCE[variant];
  if (!evidence) return { dark: false, why: `hero 写法 "${variant}" 不在「能证明是深底」那张表里` };

  const [className, [family, shade]] = evidence;
  if (!(utilityShades()[family] || []).includes(shade)) {
    return { dark: false, why: `"${variant}" 靠 ${family}-${shade}(HeroSection.tsx 那一支的根节点是 "${className}"),而 tailwind.config.ts 没声明这一档 ⟹ 那个 class 什么都不画` };
  }
  const shades = (palette && palette[family]) || {};
  if (shades[shade] === undefined) {
    return { dark: false, why: `"${variant}" 靠 ${family}-${shade}(HeroSection.tsx 那一支的根节点是 "${className}"),而这个站的调色板里没有这一档 ⟹ CSS 变量是空的` };
  }
  return { dark: true, why: '' };
}

// resolveRegionLayout —— 一次构建里这两个 Region 到底长什么样。
//
// 入参:
//   layout   theme 的版式偏好表(`layoutFor(themeId)`);没换装时传 {},两个 Region 都回到现状
//   pages    这个站**全部** locale 的**全部**页面 —— 见下面「为什么不是只给首页」
//   palette  这个站的 brand.colors —— 判「深底」要查颜色档在不在,不传就等于查不过(⟹ 加遮罩)
//
// 出参:
//   header / footer  组件要渲染的结构名
//   headerScrim      透明浮层是否需要遮罩(见上面那条规则)
//   notes            人话解释,构建日志打出来 —— 「静默降级」是这类改动最容易长出来的病
function resolveRegionLayout(layout, pages, palette) {
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

  // 对比度:透明浮层压在它下面那一段上,那就得知道那一段是什么颜色。**任何一页**只要不能证明是深底,
  // 就整站加遮罩 —— 遮罩是一层半透明的深色底,加了在深底上也看不出来,而少加会让字消失。
  //
  // 🔴 为什么判的是「所有第一段是 hero 的页」而不是只判首页(QA3 在 r2 上量出来的):浮层浮不浮起来由
  // **页面**说了算(SiteShell 的 overHero = 这一页第一段是不是 hero),而 r2 这里只拿首页当证据 ⟹
  // 一个 about 页第一段放浅底 hero 时,那页的浮层照浮、遮罩却没有,白字压白底。r2 那会儿注册表恰好
  // 造不出这个组合(8 套浮层 theme 全带 hero 偏好,换装后全站 hero 都成了深色写法),但那是巧合不是保证:
  // 哪天有 theme 挑浮层却不管 hero,这个洞当天生效。**证据面必须跟生效面一样宽。**
  let headerScrim = false;
  if (header === 'transparent-overlay') {
    // 浮层只在第一段是 hero 的页面上真的浮起来,所以要判的正是这些页(其余页面顶栏退回实色横条)。
    const heroes = (Array.isArray(pages) ? pages : []).map(firstSectionHero).filter(Boolean);
    if (heroes.length === 0) {
      headerScrim = true;
      notes.push('透明浮层 + 一个第一段是 hero 的页面都读不到 ⟹ 加遮罩(判不出来就按浅底处理)');
    } else {
      // 🔴 判不成立的**理由**要跟着走。r1 只说了「不能被证明是深底」,而那次真正的错在理由里
      // (证据那一行跟源码对不上),日志上看不出来。
      const reasons = heroes
        .map(h => heroIsProvablyDark(h, palette))
        .filter(r => !r.dark)
        .map(r => r.why);
      if (reasons.length > 0) {
        headerScrim = true;
        notes.push(`透明浮层 + 首屏不能被证明是深底 ⟹ 加遮罩(白字浮在浅图上会看不见):${[...new Set(reasons)].join(' · ')}`);
      }
    }
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
  PROVABLY_DARK_HERO_EVIDENCE,
  utilityShades,
  firstSectionHero,
  heroIsProvablyDark,
  resolveRegionLayout,
};
