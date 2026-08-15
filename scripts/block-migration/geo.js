// AC4 第二半 —— 三臂各取被搬那个 block 的两个部件的 getBoundingClientRect()。
// 判决归几何读数（作者 04:17 改的）：截图"看着不同"会被站的配色影响，而 media 分居两侧 / 在上方
// 是布局决定的，跟配色无关。
//
// 用法：geo.js [--parts .a,.b,.c] name=url [name=url …]
//
// 🔴 #1019 —— `--parts` 是这次加的，缺省仍是 hero 的三个部件，所以不带它跑跟 #1008 那次是同一件事。
//    加参数而不是各票复制一份：31 张搬迁票的 AC4 必须是同一把尺子（README 第一段）。
//    #1019 用的是 `--parts .page-header__title,.page-header__sub`。
const { chromium } = require(require('./paths').PLAYWRIGHT_CORE_MODULE); // #1020 —— 原来这里写死 /root/wt/1008/…

const argv = process.argv.slice(2);
const partsIdx = argv.indexOf('--parts');
const PARTS = partsIdx >= 0
  ? argv[partsIdx + 1].split(',').map((s) => s.trim()).filter(Boolean)
  : ['.hero__media', '.hero__body', '.hero__title'];
// 🔴 `partsIdx < 0 ||` 这一半不能省：没写 --parts 时 partsIdx 是 -1，partsIdx + 1 就是 0，
//    于是第一个臂被当成"--parts 的值"悄悄滤掉 —— 剩下两臂照样算得出「两两不同 = True」，
//    少量一臂看不出来（#1019 r1 QA1 抓到）。
const arms = argv.filter((a, i) => partsIdx < 0 || (i !== partsIdx && i !== partsIdx + 1)); // 形如 name=url

(async () => {
  const browser = await chromium.launch();
  const out = {};
  for (const spec of arms) {
    const [name, url] = spec.split('=');
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
    await page.goto(url, { waitUntil: 'load' });
    const r = await page.evaluate((parts) => {
      const box = (sel) => {
        const el = document.querySelector(sel);
        if (!el) return null;
        const b = el.getBoundingClientRect();
        return { x: Math.round(b.x), y: Math.round(b.y), width: Math.round(b.width) };
      };
      // 🔴 先证明那份表真的加载进来了。少加载一份表的话下面的读数说明不了任何事。
      const sheets = [...document.styleSheets].map((s) => {
        let n = -1;
        try { n = s.cssRules.length; } catch { n = -1; }
        return (s.href || 'inline').split('/').pop() + ':' + n + 'rules';
      });
      const boxes = {};
      for (const sel of parts) boxes[sel] = box(sel);
      return { sheets, boxes };
    }, PARTS);
    out[name] = r;
    await page.close();
  }
  console.log(JSON.stringify(out, null, 1));
  await browser.close();
})();
