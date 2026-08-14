// AC4 第二半 —— 三臂各取 .hero__media 与 .hero__body 的 getBoundingClientRect()。
// 判决归几何读数（作者 04:17 改的）：截图"看着不同"会被站的配色影响，而 media 分居两侧 / 在上方
// 是布局决定的，跟配色无关。
const { chromium } = require(require('./paths').PLAYWRIGHT_CORE_MODULE); // #1020 —— 原来这里写死 /root/wt/1008/…

const arms = process.argv.slice(2); // 形如 name=url
(async () => {
  const browser = await chromium.launch();
  const out = {};
  for (const spec of arms) {
    const [name, url] = spec.split('=');
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
    await page.goto(url, { waitUntil: 'load' });
    const r = await page.evaluate(() => {
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
      return { sheets, media: box('.hero__media'), body: box('.hero__body'), title: box('.hero__title') };
    });
    out[name] = r;
    await page.close();
  }
  console.log(JSON.stringify(out, null, 1));
  await browser.close();
})();
