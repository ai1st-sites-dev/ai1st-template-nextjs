// #1046 条 20 —— `document` / `getComputedStyle` 出现在传给 page.evaluate 的函数体里，跑在浏览器
// 里而不是这个 node 进程里。同 scripts/theme-gallery/shoot.mjs 的写法，用 eslint 的 global 声明
// 告诉它们存在（本票把这个目录接进 `lint:scripts`，在那之前没有任何东西检查这几个文件）。
/* global document, getComputedStyle */
const { chromium } = require(require('./paths').PLAYWRIGHT_CORE_MODULE); // #1020 —— 原来这里写死 /root/wt/1008/…
(async () => {
  const b = await chromium.launch();
  for (const spec of process.argv.slice(2)) {
    const [label, url] = spec.split('=');
    for (const w of [1280, 375]) {
      const p = await b.newPage({ viewport: { width: w, height: 800 } });
      await p.goto(url, { waitUntil: 'load' });
      const r = await p.evaluate(() => {
        const t = document.querySelector('.hero__title');
        const cs = getComputedStyle(t);
        const sheets = [...document.styleSheets].map(s => { let n=-1; try{n=s.cssRules.length}catch{} return (s.href||'inline').split('/').pop()+':'+n; });
        return { sheets: sheets.join(' '), fontSize: cs.fontSize, overflowWrap: cs.overflowWrap,
          scrollWidth: t.scrollWidth, clientWidth: t.clientWidth,
          overflows: t.scrollWidth > t.clientWidth,
          docScroll: document.documentElement.scrollWidth, docClient: document.documentElement.clientWidth };
      });
      console.log(`${label.padEnd(12)} @${w}  font=${r.fontSize.padStart(5)} wrap=${r.overflowWrap.padEnd(10)} title ${r.scrollWidth}/${r.clientWidth} 溢出=${r.overflows}  doc ${r.docScroll}/${r.docClient}`);
      await p.close();
    }
  }
  await b.close();
})();
