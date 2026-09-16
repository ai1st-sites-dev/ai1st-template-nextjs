// #1353 —— 「顶栏 / 页脚改造前后，每个元素的包围盒一模一样」这句话的尺子。
//
// 🔴 为什么不能用同目录的 `geo.js`（README 第一段写着「31 张搬迁票的判据必须是同一把尺子，不许各票
//    造一份」，所以这里必须说清楚它为什么答不了这一问）：
//
//    `geo.js` 拿 `--parts .a,.b` 这样的**选择器**当键，两臂用同一组选择器各量一次。那对块的搬迁成立，
//    因为块在搬之前就已经是 `.hero__title` 这样的 BEM 类。**顶栏和页脚不是** —— 改造前它们身上一个
//    `.header__*` 类都没有，几何全写在 Tailwind 工具类串里（`flex items-center gap-8 md:flex …`）。
//    拿改造后的选择器去量改造前那一臂，`document.querySelector` 全是 null；拿 Tailwind 类去量改造后
//    那一臂也一样。**选择器这个键在这次搬迁里两臂不通用。**
//
//    按 DOM 下标对齐也不行：改造后遮罩（`.header__scrim`）恒在 DOM 里，而改造前它只在浮层那一支里
//    存在 ⟹ 下标整体错位一格，而错位之后每一格都“不同”，那个红说明不了任何事。
//
// 🔴 所以这里的键是**内容**：一个元素自己带的那段文字（归一化空白）+ 同名重复时的出现序号。
//    内容两臂逐字相同（同一份 `site/` 字节、同一个站），所以它在两臂之间通用，而且它就是“老板看到的
//    那个东西有没有挪地方”这句话本身。链接另按 `href` 收一份，图片按 `src` 收一份 —— 那两样即使不带
//    文字也会挪。
//
// 🔴 只量**看得见**的元素（`checkVisibility`）。收起来的手机菜单在两臂里都有盒子，但用户看不到它；
//    把它算进来，等于拿一个谁都看不见的东西去判“长相变了没有”。
//
// 用法：
//   node scripts/block-migration/region-geo.js --width 1280 --roots header,footer <url>
//   两臂各跑一次，然后 `diff` 两份 JSON —— 相同 = 包围盒无损。
//
// 出参：{ url, width, roots: { header: { box, parts: { "<键>": {x,y,w,h} } }, … }, extras: {…} }
//   · `box` 是那个区自己的包围盒（x/y/w/h 全要 —— 高度变了是真的变了，`geo.js` 只取 x/y/width，
//     那对块够用，对区不够：一个矮了 20px 的页脚在它那三个数上读不出来）。
//   · `--computed <选择器>=<属性>[,…]` 可选：额外读几个计算样式（AC1 点名了遮罩那层的 background）。

/* global document, getComputedStyle */
const { chromium } = require(require('./paths').PLAYWRIGHT_CORE_MODULE);

const argv = process.argv.slice(2);
function opt(name, dflt) {
  const i = argv.indexOf(name);
  return i >= 0 && argv[i + 1] !== undefined ? argv[i + 1] : dflt;
}
const WIDTH = Number(opt('--width', '1280'));
const ROOTS = opt('--roots', 'header,footer').split(',').map((s) => s.trim()).filter(Boolean);
const COMPUTED = opt('--computed', '').split(',').map((s) => s.trim()).filter(Boolean);
// 位置参数 = url（把带值的选项和它们的值都滤掉）
const FLAGS = ['--width', '--roots', '--computed'];
const positional = argv.filter((a, i) => !FLAGS.includes(a) && !FLAGS.includes(argv[i - 1]));
const URL = positional[0];

if (!URL) {
  console.error('用法: region-geo.js [--width 1280] [--roots header,footer] [--computed "sel=prop,…"] <url>');
  process.exit(2);
}

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: WIDTH, height: 900 } });
  await page.goto(URL, { waitUntil: 'load' });
  // 🔴 先证明表真的加载进来了 —— 少一份表的话下面每一个数都说明不了任何事（同 geo.js 的第一步）。
  const sheets = await page.evaluate(() => [...document.styleSheets].map((s) => {
    let n = -1;
    try { n = s.cssRules.length; } catch { n = -1; }
    return (s.href || 'inline').split('/').pop() + ':' + n + 'rules';
  }));

  const out = await page.evaluate(({ roots, computed }) => {
    const r4 = (el) => {
      const b = el.getBoundingClientRect();
      return { x: Math.round(b.x), y: Math.round(b.y), w: Math.round(b.width), h: Math.round(b.height) };
    };
    const visible = (el) => el.checkVisibility
      ? el.checkVisibility({ contentVisibilityAuto: true, opacityProperty: true, visibilityProperty: true })
      : true;
    const norm = (s) => (s || '').replace(/\s+/g, ' ').trim();

    const result = {};
    for (const rootSel of roots) {
      const root = document.querySelector(rootSel);
      if (!root) { result[rootSel] = null; continue; }
      const parts = {};
      const seen = new Map();
      const put = (key, el) => {
        const n = (seen.get(key) || 0) + 1;
        seen.set(key, n);
        parts[n === 1 ? key : `${key}#${n}`] = r4(el);
      };
      for (const el of root.querySelectorAll('*')) {
        if (!visible(el)) continue;
        // ① 自己带文字的元素（文字属于它，不是属于它的后代）
        const own = [...el.childNodes].filter((n) => n.nodeType === 3 && norm(n.textContent)).map((n) => norm(n.textContent)).join(' ');
        if (own) put(`文字:${own.slice(0, 40)}`, el);
        // ② 链接按 href（导航链接即使文字相同，href 也分得开；而且没有文字的图标链接也收得到）
        if (el.tagName === 'A' && el.getAttribute('href')) put(`链接:${el.getAttribute('href')}`, el);
        // ③ 图片按 src 的文件名
        if (el.tagName === 'IMG' && el.getAttribute('src')) put(`图片:${el.getAttribute('src').split('/').pop()}`, el);
      }
      result[rootSel] = { box: r4(root), parts };
    }

    const extras = {};
    for (const spec of computed) {
      const [sel, prop] = spec.split('=');
      const el = document.querySelector(sel);
      extras[spec] = el ? getComputedStyle(el)[prop] : '(选不到这个元素)';
    }
    return { roots: result, extras };
  }, { roots: ROOTS, computed: COMPUTED });

  console.log(JSON.stringify({ url: URL, width: WIDTH, sheets, ...out }, null, 1));
  await browser.close();
})();
