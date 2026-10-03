#!/usr/bin/env node
/**
 * css-shadow-values.test.js —— 一页上挂的几份 CSS 里，`box-shadow` 最终拿到的值合不合法（#1540）。
 *
 * 跑法:  node scripts/lib/css-shadow-values.test.js      （`npm run test:scripts` 会自动发现它）
 * 退出码: 0 全过 · 1 有失败 · 2 跑不起来（**不许当成通过**）
 *
 * 管四件事：
 *   ① 语法判得对不对：好值过、坏值（`box-shadow-2` 这种字面串、长度不够、两个颜色）不过
 *   ② 真编一份 site.css（sass + purge，LTR 和 RTL 各一次），跟 `public/shapes.css` + `src/app/globals.css` 合起来判：0 处坏值
 *      —— 判法与射程见 `css-shadow-values.js` 文件头
 *   ③ 验收 1 的三个读数：`--x-box-shadow*` 每一条的值都合法 · `--x-box-shadow-xs` 定义 ≥ 1 · 引用它的那处还在
 *   ④ 阳性对照：(a) 同一份 site.css 把 `--x-box-shadow-sm` 的好值换成 `box-shadow-9` ⟹ 当场红并点名它；
 *      (b) 拿掉 site-css.js 里 #1540 加的那几行再编一次 ⟹ 上游那三个坏值全被点名（证明 ② 的绿来自修复，不是尺子瞎）
 */
'use strict';

const fs = require('fs');
const path = require('path');

let failed = 0;
const ok = (m) => console.log(`  ✅ ${m}`);
const bad = (m) => { failed += 1; console.log(`  ❌ ${m}`); };

let shadow, siteCss;
try {
  shadow = require('./css-shadow-values.js');
  siteCss = require('./site-css.js');
} catch (e) {
  console.log(`🔴 跑不起来：${e.message}`);
  process.exit(2);
}

const NEXT_DIR = path.resolve(__dirname, '..', '..');
/** 运行时由别处给值的变量：`--color-*` 由 layout 的 `:root` / theme.css 按 brand.json 写。 */
const EXTERNAL = [/^--color-/];
const PRIMARY = '#2563eb';

const read = (rel) => fs.readFileSync(path.join(NEXT_DIR, rel), 'utf8');
const pageSheets = (site) => [
  { name: 'site.css', css: site },
  { name: 'shapes.css', css: read('public/shapes.css') },
  { name: 'globals.css', css: read('src/app/globals.css') },
];
const show = (ps) => ps.map((p) => `\n       ${p.where} | ${p.prop}: ${p.value}\n         → ${p.why}`).join('');

async function main() {
  console.log('① box-shadow 的语法');
  for (const v of [
    'none', 'inherit', '0 0 0 0 transparent', '0 1px 2px 0 rgba(0, 0, 0, 0.05)',
    '0 1px 3px 0 rgba(0,0,0,.1), 0 1px 2px -1px rgba(0,0,0,.1)', 'inset 0 0 0 9999px #fff', '#000 0 0 2px', 'red 1px 1px',
    '0 0 0 0.15rem rgba(13, 110, 253, .5)', '0 0 0 calc(1px + 2px) currentColor',
  ]) {
    const why = shadow.boxShadowProblem(v);
    why === null ? ok(`合法：${v}`) : bad(`判成不合法：${v} → ${why}`);
  }
  for (const v of ['box-shadow-2', 'box-shadow-9', '1px', '0 0 0 0 0', '0 0 red blue', '0 0 2px, ', 'inset inset 0 0', '0 red 0']) {
    const why = shadow.boxShadowProblem(v);
    why !== null ? ok(`不合法：${JSON.stringify(v)} → ${why}`) : bad(`坏值被判成合法：${JSON.stringify(v)}`);
  }

  console.log('\n② 真编的 site.css + shapes.css + globals.css：0 处坏值');
  const raw = siteCss.compileSiteCss(PRIMARY);
  const ltr = await siteCss.purgeSiteCss(raw);
  const rtl = await siteCss.purgeSiteCss(siteCss.mirrorSiteCss(raw));
  for (const [label, css] of [['LTR', ltr], ['RTL', rtl]]) {
    const ps = shadow.findBoxShadowProblems(pageSheets(css), { external: EXTERNAL });
    ps.length === 0 ? ok(`${label}：0 处`) : bad(`${label}：${ps.length} 处${show(ps)}`);
  }

  console.log('\n③ 验收 1 的读数（LTR 那份）');
  {
    const tokens = [...ltr.matchAll(/(--x-box-shadow[a-z0-9-]*):\s*([^;]*);/g)];
    tokens.length > 0 ? ok(`--x-box-shadow* 定义 ${tokens.length} 条`) : bad('一条 --x-box-shadow* 都没读到 —— 尺子量错了地方');
    for (const [, name, value] of tokens) {
      const why = shadow.boxShadowProblem(value);
      why === null ? ok(`${name}: ${value}`) : bad(`${name}: ${value} → ${why}`);
    }
    const defs = (ltr.match(/--x-box-shadow-xs:/g) || []).length;
    const refs = (ltr.match(/var\(--x-box-shadow-xs\)/g) || []).length;
    defs >= 1 ? ok(`--x-box-shadow-xs 定义 ${defs} 处`) : bad('--x-box-shadow-xs 没有定义（按钮的焦点环会整条失效）');
    refs >= 1 ? ok(`var(--x-box-shadow-xs) 引用 ${refs} 处（.btn 的 --x-btn-box-shadow）`) : bad('读不到 var(--x-box-shadow-xs) 的引用 —— 上游改了写法，这一格要重看');
  }

  console.log('\n④ 阳性对照');
  {
    const broken = ltr.replace(/(--x-box-shadow-sm:)[^;]*;/, '$1 box-shadow-9;');
    if (broken === ltr) bad('对照没造出来：site.css 里找不到 --x-box-shadow-sm 的定义');
    else {
      const ps = shadow.findBoxShadowProblems(pageSheets(broken), { external: EXTERNAL });
      ps.some((p) => p.prop === '--x-box-shadow-sm' && /box-shadow-9/.test(p.why))
        ? ok(`(a) --x-box-shadow-sm 换成 box-shadow-9 ⟹ 红 ${ps.length} 处，点名了 --x-box-shadow-sm`)
        : bad(`(a) 换成坏值之后没有点名 --x-box-shadow-sm：${ps.length} 处${show(ps)}`);
    }

    // (b) 拿掉 #1540 的覆盖：scss 里那四个 `$…box-shadow…:` 赋值 + 追加的 `--x-box-shadow-xs` 那一段
    const scss = siteCss.siteScss(PRIMARY);
    const unfixed = scss
      .split('\n').filter((l) => !/^\$(box-shadow(-sm|-lg)?|form-select-box-shadow):/.test(l)).join('\n')
      .replace(siteCss.SHADOW_TOKENS, '');
    if (unfixed === scss || unfixed.includes('--x-box-shadow-xs')) bad('(b) 没能从 scss 里拿掉 #1540 的覆盖 —— 对照不成立');
    else {
      const sass = require('sass');
      const plain = sass.compileString(unfixed, {
        loadPaths: [path.join(NEXT_DIR, 'node_modules')], quietDeps: true, silenceDeprecations: ['import'], logger: sass.Logger.silent,
      }).css;
      const ps = shadow.findBoxShadowProblems(pageSheets(await siteCss.purgeSiteCss(plain)), { external: EXTERNAL });
      const named = (re) => ps.some((p) => re.test(`${p.prop} ${p.why}`));
      const want = [
        ['--x-box-shadow: box-shadow-2', /^--x-box-shadow .*box-shadow-2/],
        ['--x-box-shadow-sm: box-shadow-1', /^--x-box-shadow-sm .*box-shadow-1/],
        ['--x-box-shadow-xs 没定义（.btn:focus-visible）', /--x-box-shadow-xs/],
        ['--x-shadow-sm 没定义（.form-select）', /--x-shadow-sm/],
      ];
      for (const [label, re] of want) named(re) ? ok(`(b) 不带修复编 ⟹ 点名 ${label}`) : bad(`(b) 不带修复编，却没点名 ${label}`);
    }
  }

  console.log(failed ? `\n🔴 ${failed} 格失败` : '\n✅ 全过');
  process.exit(failed ? 1 : 0);
}

main().catch((e) => { console.log(`🔴 跑不起来：${e.stack || e.message}`); process.exit(2); });
