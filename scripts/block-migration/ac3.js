// AC3 —— 没有主题表时的四个读数，每条对应正文那张表里的一行（含 owner）。
// 桌面 1280 量前三条，手机 375 量第四条。
const { chromium } = require(require('./paths').PLAYWRIGHT_CORE_MODULE); // #1020 —— 原来这里写死 /root/wt/1008/…

const url = process.argv[2];
const label = process.argv[3] || '';

(async () => {
  const browser = await chromium.launch();
  const out = { arm: label };

  const desk = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  await desk.goto(url, { waitUntil: 'load' });
  Object.assign(out, await desk.evaluate(() => {
    // 🔴 先把加载到的表打出来：少加载一份表的话，下面的读数说明不了任何事。
    const sheets = [...document.styleSheets].map((s) => {
      let n = -1; try { n = s.cssRules.length; } catch { n = -1; }
      return (s.href || 'inline').split('/').pop() + ':' + n + 'rules';
    });
    const hero = document.querySelector('.hero');
    const body = document.querySelector('.hero__body');
    const title = document.querySelector('.hero__title');
    const media = document.querySelector('.hero__media');
    const img = document.querySelector('.hero__img');
    const cs = (el) => (el ? getComputedStyle(el) : null);
    const hb = cs(hero), bb = cs(body), tb = cs(title);
    return {
      sheets,
      // ① 有间距 —— owner: base
      spacing: {
        heroPadding: hb && [hb.paddingTop, hb.paddingRight, hb.paddingBottom, hb.paddingLeft].join(' '),
        bodyPadding: bb && [bb.paddingTop, bb.paddingRight, bb.paddingBottom, bb.paddingLeft].join(' '),
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
      // ③ 图片不撑破容器 —— owner: 不是 base（preflight img{max-width:100%} + globals.css .hero__img）
      image: {
        imgWidth: img ? Math.round(img.getBoundingClientRect().width) : null,
        mediaWidth: media ? Math.round(media.getBoundingClientRect().width) : null,
        overflowPx: img && media
          ? Math.max(0, Math.round(img.getBoundingClientRect().width - media.getBoundingClientRect().width))
          : null,
        imgMaxWidth: img && getComputedStyle(img).maxWidth,
      },
    };
  }));
  await desk.close();

  const phone = await browser.newPage({ viewport: { width: 375, height: 800 } });
  await phone.goto(url, { waitUntil: 'load' });
  // ④ 手机 375 无横向滚动 —— owner: 不是 base（globals.css 的 .hero{overflow:hidden}）
  out.phone375 = await phone.evaluate(() => ({
    docScrollWidth: document.documentElement.scrollWidth,
    docClientWidth: document.documentElement.clientWidth,
    noHorizontalScroll: document.documentElement.scrollWidth === document.documentElement.clientWidth,
    heroOverflow: getComputedStyle(document.querySelector('.hero')).overflow,
  }));
  await phone.close();

  console.log(JSON.stringify(out, null, 1));
  await browser.close();
})();
