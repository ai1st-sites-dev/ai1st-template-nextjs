// #1353 r3 —— 「顶栏 / 页脚改造前后，**画出来的装饰**一样吗」这句话的尺子。
//
// 🔴 为什么同目录的 `region-geo.js` 答不了这一问（这是它被 QA2 打回那一轮的直接产物，不是补一把
//    「更全的尺子」那种泛泛动机）：`region-geo.js` 按 `:88-96` 只收三类元素 —— 自己直接带文字节点的、
//    带 `href` 的 `<a>`、带 `src` 的 `<img>`。**边框和阴影挂在没有文字的外壳 `div` 上**，三类都不是，
//    所以它在射程之外。实测：r2 那份交付上 `region-geo.js` 两臂读到 0 处差异，而同一份字节在真机上
//    页脚的分隔线从 1216px 顶到了 1280px、浮动药丸的投影从 26% 黑掉到 10% 黑。**两个读数都是真的。**
//
// 🔴 不按 DOM 下标对齐、也不按选择器对齐 —— 改造把页脚从 18 个元素变成 43 个（本票实测），
//    按序号比会整体错位，而错位之后每一格都“不同”，那个红说明不了任何事。这里比的是**集合**：
//    任何一个画得出东西的元素（可见边框 / 阴影 / 描边 / 不透明底色 / 圆角），记下它的盒子 + 那几条
//    计算样式，两棵树各得一个集合，排序后逐条比。键是「画出来长什么样 + 画在哪儿」，两臂通用。
//
// 🔴 两条【证明画不出东西】才做的归一化（别再往里加第三条 —— 归一化擦掉的可能正是那一维唯一的痕迹）：
//    ① 0 宽的边框：它的颜色不是一维读数（`border-top: 0` 这个简写会把颜色重置成 currentColor），
//       而 0 宽的边框按定义一个像素都不画。
//    ② 全透明的阴影层：Tailwind 的 ring-offset / ring 在没上环时是 `rgba(0, 0, 0, 0) 0 0 0 0`。
//
// 🔴🔴 夹具必须离开中性点，否则这把尺对**写死的圆角**完全失明：`--radius-*` 在 `radius: 4` 那一档上
//    跟 Tailwind 的字面值逐字相同（md 0.375rem / lg 0.5rem / 2xl 1rem，见 `globals.css` 的 `:root`）。
//    拿一个 `radius: 4` 的站做两臂，五处写死的圆角一处都读不出来 —— 这正是 r2 漏掉它们的原因。
//    用 `ember-12` 自己的 `radius: 22` / `shadowStrength: 0.26`（主题一旦 applied，这两个数就写进
//    站自己的 `site/brand.json`，见 `sync-config.js` 那段注释）。
//
// 用法：
//   node scripts/block-migration/region-paint.js [--width 1280] [--roots header,footer,.announcement-bar]
//        [--open-menu] <url>
//   两臂各跑一次，然后 `diff` 两份 JSON —— 相同 = 装饰无损。
//   `--open-menu` 先点一下汉堡按钮再读（手机抽屉的圆角和投影只有点开才量得到）。
//
// 出参：{ url, width, menuOpen, sheets, painted: [ {box, …计算样式} ] }，`painted` 已排序。

/* global document, getComputedStyle */
const { chromium } = require(require('./paths').PLAYWRIGHT_CORE_MODULE);

const argv = process.argv.slice(2);
function opt(name, dflt) {
  const i = argv.indexOf(name);
  return i >= 0 && argv[i + 1] !== undefined ? argv[i + 1] : dflt;
}
const WIDTH = Number(opt('--width', '1280'));
const ROOTS = opt('--roots', 'header,footer,.announcement-bar').split(',').map((s) => s.trim()).filter(Boolean);
const OPEN_MENU = argv.includes('--open-menu');
const FLAGS = ['--width', '--roots'];
const positional = argv.filter((a, i) => !FLAGS.includes(a) && !FLAGS.includes(argv[i - 1]) && a !== '--open-menu');
const URL = positional[0];

if (!URL) {
  console.error('用法: region-paint.js [--width 1280] [--roots header,footer,.announcement-bar] [--open-menu] <url>');
  process.exit(2);
}

const PROPS = ['boxShadow', 'outlineWidth', 'outlineStyle', 'outlineColor', 'outlineOffset',
  'borderTopWidth', 'borderTopColor', 'borderBottomWidth', 'borderBottomColor',
  'borderLeftWidth', 'borderLeftColor', 'borderRightWidth', 'borderRightColor',
  'borderTopLeftRadius', 'borderTopRightRadius', 'borderBottomLeftRadius', 'borderBottomRightRadius',
  'backgroundColor', 'backgroundImage', 'opacity'];

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: WIDTH, height: 900 } });
  await page.goto(URL, { waitUntil: 'load' });
  await page.evaluate(() => document.fonts.ready);

  // 🔴 同 region-geo.js 的第一步：先证明表真的加载进来了 —— 少一份表的话下面每个数都说明不了任何事。
  const sheets = await page.evaluate(() => [...document.styleSheets].map((s) => {
    let n = -1;
    try { n = s.cssRules.length; } catch { n = -1; }
    return (s.href || 'inline').split('/').pop() + ':' + n + 'rules';
  }));

  let menuOpen = false;
  if (OPEN_MENU) {
    const burger = await page.$('.header__burger, header button');
    if (burger && await burger.isVisible()) {
      await burger.click();
      await page.waitForTimeout(200);
      menuOpen = true;
    }
  }

  const painted = await page.evaluate(({ roots, props }) => {
    const TRANSPARENT = ['rgba(0, 0, 0, 0)', 'transparent'];
    const rows = [];
    const seen = new Set();
    for (const sel of roots) {
      for (const root of document.querySelectorAll(sel)) {
        const walk = (el) => {
          if (!seen.has(el)) {
            seen.add(el);
            const b = el.getBoundingClientRect();
            const cs = getComputedStyle(el);
            const rec = { box: [b.x, b.y, b.width, b.height].map((n) => Math.round(n * 100) / 100) };
            for (const p of props) rec[p] = cs[p];

            // —— 两条归一化，各自都能证明「它画不出东西」——
            for (const side of ['Top', 'Bottom', 'Left', 'Right']) {
              if (rec[`border${side}Width`] === '0px') rec[`border${side}Color`] = '(0 宽，画不出东西)';
            }
            if (rec.boxShadow !== 'none') {
              const layers = rec.boxShadow.split(/,(?![^(]*\))/)
                .map((l) => l.trim())
                .filter((l) => !l.includes('rgba(0, 0, 0, 0)') && !l.includes('transparent'));
              rec.boxShadow = layers.length ? layers.join(', ') : 'none';
            }

            const paints = rec.boxShadow !== 'none'
              || rec.outlineStyle !== 'none'
              || ['Top', 'Bottom', 'Left', 'Right'].some((s) => rec[`border${s}Width`] !== '0px')
              || !TRANSPARENT.includes(rec.backgroundColor)
              || rec.backgroundImage !== 'none'
              || rec.borderTopLeftRadius !== '0px';
            if (paints && rec.box[2] > 0 && rec.box[3] > 0) rows.push(rec);
          }
          for (const c of el.children) walk(c);
        };
        walk(root);
      }
    }
    return rows.map((r) => JSON.stringify(r)).sort();
  }, { roots: ROOTS, props: PROPS });

  console.log(JSON.stringify({
    url: URL, width: WIDTH, menuOpen, sheets, painted: painted.map((s) => JSON.parse(s)),
  }, null, 1));
  await browser.close();
})();
