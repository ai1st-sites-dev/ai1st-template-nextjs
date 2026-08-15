// AC3 —— 没有主题表时的四个读数，每条对应票正文那张表里的一行（含 owner）。
// 桌面 1280 量前三条，手机 375 量第四条。
//
// 用法：ac3.js <url> [臂的名字] [--root .hero --title .hero__title --sub .hero__sub
//                               --media .hero__media --img .hero__img]
//
// 🔴 #1019 —— 那四个选择器是这次变成参数的，缺省值就是 hero 的那四个，所以不带它们跑跟 #1008
//    那次是同一件事。加参数而不是各票复制一份：31 张搬迁票的 AC3 必须是同一把尺子（README 第一段）。
//
// 🔴 ③ 那一条对【没有图片的块】也答得出来，而且答的是同一个问题。hero 问的是「<img> 有没有撑破装它
//    的那个格子」；块里没有 <img> 时（page-header 就没有）问的是「块里最宽的那个后代有没有撑破块
//    自己的盒子」—— 同一个性质，量的是这个块真有的东西。不给 `--img` 就走后一条，读数里写明走的是
//    哪一条，不让「这个块没有图 ⟹ 这一格空着」变成一句没人追的话。
const { chromium } = require(require('./paths').PLAYWRIGHT_CORE_MODULE); // #1020 —— 原来这里写死 /root/wt/1008/…

const argv = process.argv.slice(2);
const opt = (name, dflt) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 ? argv[i + 1] : dflt;
};
const positional = argv.filter((a, i) => !a.startsWith('--') && !(i > 0 && argv[i - 1].startsWith('--')));
const url = positional[0];
const label = positional[1] || '';
const SEL = {
  root: opt('root', '.hero'),
  title: opt('title', '.hero__title'),
  sub: opt('sub', '.hero__sub'),
  media: opt('media', '.hero__media'),
  img: opt('img', '.hero__img'),
};
(async () => {
  const browser = await chromium.launch();
  const out = { arm: label, selectors: SEL };

  const desk = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  await desk.goto(url, { waitUntil: 'load' });
  Object.assign(out, await desk.evaluate((sel) => {
    // 🔴 先把加载到的表打出来：少加载一份表的话，下面的读数说明不了任何事。
    const sheets = [...document.styleSheets].map((s) => {
      let n = -1; try { n = s.cssRules.length; } catch { n = -1; }
      return (s.href || 'inline').split('/').pop() + ':' + n + 'rules';
    });
    const root = document.querySelector(sel.root);
    const sub = document.querySelector(sel.sub);
    const title = document.querySelector(sel.title);
    const media = document.querySelector(sel.media);
    const img = document.querySelector(sel.img);
    const cs = (el) => (el ? getComputedStyle(el) : null);
    const hb = cs(root), bb = cs(sub), tb = cs(title);
    // 🔴 走哪一条不由调用方声明,由页面上有没有那个 <img> 决定 —— 声明会跟真相分叉。
    const hasImg = !!img;

    // ③ 没有 <img> 时的那条：块里最宽的后代 vs 块自己的内容盒。
    let widestChild = null;
    if (root) {
      const rootBox = root.getBoundingClientRect();
      let worst = null;
      for (const el of root.querySelectorAll('*')) {
        const b = el.getBoundingClientRect();
        const over = Math.max(0, Math.round(b.right - rootBox.right), Math.round(rootBox.left - b.left));
        if (!worst || over > worst.overflowPx) {
          worst = {
            selector: el.className && typeof el.className === 'string'
              ? `${el.tagName.toLowerCase()}.${el.className.split(' ')[0]}`
              : el.tagName.toLowerCase(),
            width: Math.round(b.width),
            overflowPx: over,
          };
        }
      }
      widestChild = { rootWidth: Math.round(rootBox.width), worst };
    }

    return {
      sheets,
      imageArm: hasImg,
      // ① 有间距 —— owner: base
      spacing: {
        rootPadding: hb && [hb.paddingTop, hb.paddingRight, hb.paddingBottom, hb.paddingLeft].join(' '),
        subPadding: bb && [bb.paddingTop, bb.paddingRight, bb.paddingBottom, bb.paddingLeft].join(' '),
        rootGap: hb && hb.gap,
        titleX: title ? Math.round(title.getBoundingClientRect().x) : null,
        titleFontSize: tb && tb.fontSize,
        titleLineHeight: tb && tb.lineHeight,
        titleMarginTop: tb && tb.marginTop,
      },
      // ② 长词不撑破 —— owner: base（overflow-wrap / min-width）
      longWord: {
        titleScrollWidth: title && title.scrollWidth,
        titleClientWidth: title && title.clientWidth,
        overflowsContainer: title ? title.scrollWidth > title.clientWidth : null,
        overflowWrap: tb && (tb.overflowWrap || tb.wordWrap),
        titleMinWidth: tb && tb.minWidth,
      },
      // ③ 长内容不溢出容器 —— owner 见票正文那张表（hero 那一臂是 preflight 的 img{max-width:100%}
      //    + globals.css 的 .hero__img；没有图的块走 widestChild 那一条）
      image: hasImg ? {
        imgWidth: img ? Math.round(img.getBoundingClientRect().width) : null,
        mediaWidth: media ? Math.round(media.getBoundingClientRect().width) : null,
        overflowPx: img && media
          ? Math.max(0, Math.round(img.getBoundingClientRect().width - media.getBoundingClientRect().width))
          : null,
        imgMaxWidth: img && getComputedStyle(img).maxWidth,
      } : null,
      widestChild,
    };
  }, SEL));
  await desk.close();

  const phone = await browser.newPage({ viewport: { width: 375, height: 800 } });
  await phone.goto(url, { waitUntil: 'load' });
  // ④ 手机 375 无横向滚动 —— owner: 不是 base（globals.css 的 .<block>{overflow:hidden}）
  out.phone375 = await phone.evaluate((sel) => {
    const root = document.querySelector(sel.root);
    const title = document.querySelector(sel.title);
    const tb = title && getComputedStyle(title);
    return {
      docScrollWidth: document.documentElement.scrollWidth,
      docClientWidth: document.documentElement.clientWidth,
      noHorizontalScroll: document.documentElement.scrollWidth === document.documentElement.clientWidth,
      rootOverflow: root && getComputedStyle(root).overflow,
      // 🔴 ②那条必须在 375 上取，不许在 1280 上判（#1008 DEV 量的：没有 base 时字号掉到 16px，
      //    长词正好塞得进去，字号替代了那条性质）。
      titleScrollWidth: title && title.scrollWidth,
      titleClientWidth: title && title.clientWidth,
      titleOverflows: title ? title.scrollWidth > title.clientWidth : null,
      titleFontSize: tb && tb.fontSize,
      titleOverflowWrap: tb && (tb.overflowWrap || tb.wordWrap),
      titleMinWidth: tb && tb.minWidth,
    };
  }, SEL);
  await phone.close();

  console.log(JSON.stringify(out, null, 1));
  await browser.close();
})();
