#!/usr/bin/env node
// ══════════════════════════════════════════════════════════════════════════════════════════════════
// theme-css-invariants-sample-pages.js — 把演示站撑到覆盖契约里的全部块（#1052）
// ══════════════════════════════════════════════════════════════════════════════════════════════════
//
//   node scripts/theme-css-invariants-sample-pages.js [<站目录>]      默认 templates/nextjs/site
//
// 退出 0 = 撑好了（每一处都读回验过）· 退出 2 = 没撑成，一个字节都别信后面的读数。
// 🔴 **没有退出 1**：这个脚本不判任何主题的好坏，它只负责把被量的那个站铺开。它失败的方向必须是
//    「读数取不到」，不能是「读数是绿的」—— 后者正是本票要治的那个洞。
//
// ══ 为什么要有这个文件 ═════════════════════════════════════════════════════════════════════════
// CI 的 `theme-css` job 跑 `theme-css-invariants-all-sheets.sh --make-sample-site`，那个演示站是
// `create-site.js` 的 skipAI 路径现造的，只有 5 页、只用到 8 种块。契约里 213 条钩子有 **171 条
// 一次都没被量到，而命令照样 rc=0**（#1052 立票时实测，本轮在 4e4b27df 上复现同一个数）。
// 阶段 2 每搬一批块就新增一批钩子（`HOOK_CLASSES` 三天里 15 → 213），这道检查对新钩子全是瞎的：
// 主题表漏了规则、CI 照样绿。#1023 修过的「只看首页」是同一族，这次是「页面里根本没有那些块」。
//
// 🔴 **这道检查瞎掉挡不住 `release`，挡的是 `sync-template`**（`ci-cd.yml:693` 依赖 theme-css，
//    `:412` 的 release 不依赖）—— 也就是**模板 repo 会被推出去**，而每个新站都从那份字节建。
//
// ══ 光把块放上页面还不够 ═══════════════════════════════════════════════════════════════════════
// 有四处要连**块的数据、甚至站的形状**一起给，否则那些钩子仍然不进 DOM（逐处在真机上量过）：
//
//   `.gallery__placeholder`      GallerySection.tsx:62-67 —— 有 imageUrl 就画 __image，没有才画它。
//                                而夹具生成器给每张图都编了一个 URL ⟹ 让第 3 张不带 imageUrl。
//   `.feature-comparison__mark--no`
//                                FeatureComparisonSection.tsx:61 —— 类名由 boolean 决定，而生成器
//                                把 boolean 一律编成 true ⟹ 把某一行的 `them` 设成 false。
//   `.services-list__products`   ServicesListSection.tsx:74 要 `service.products.length > 0`，而它读
//                                的是 **services.json**，不是块自己的 data ⟹ 给第一条服务加 products。
//   `.service-related-pages`+3   ServiceRelatedPagesSection.tsx:45-48 —— 站里没有 slug 以
//                                `<serviceSlug>/` 开头的**页面**就 `return null`。这是站的形状，
//                                光给块喂数据没用 ⟹ 把 serviceSlug 设成 services，并加一页
//                                slug = `services/oil-change`（`src/app/[...slug]` 是 catch-all，
//                                带斜杠的 slug 建得出来）。
//                                📌 那个块自己的注释（:20-23）说夹具要**两页**——那句话管的是搬迁那条线
//                                的改前/改后对照（两边都空就会被读成「没变」）。这里问的是别的问题：
//                                四个钩子进没进 DOM。一页就够，实测四条全被量到，多一页只是多建一页。
//
// 📌 **到不了 0，下限是 4**，而那四条不是补数据能救的：`.contact-form__error` / `__success` /
//    `.quote-form__error` / `__success` 只在用户点了提交之后才进 DOM
//    （`ContactFormSection.tsx:109/112/142`、`QuoteFormSection.tsx:118/121/188`；`__success` 还要
//    `POST /api/leads` 返回 ok，而演示站是静态导出、没有那个接口）。契约里以 `__error`/`__success`
//    结尾的钩子一共就这四条，其余 209 条都是块渲染出来就在。
//
// 🔴 **不改 `gen-allblocks.js` 本身**：那是 block-migration 那条线的手工工具（它自己的 README 里
//    有用法），本票要的这几处数据是**这道检查专用**的。改它等于把本票的需要塞进别人的工具里。
//    所以这里的做法是「先请它生成，再在产物上补」。
'use strict';

const fs = require('fs');
const path = require('path');
const cp = require('child_process');

const NEXT = path.resolve(__dirname, '..');
const GEN = path.join(NEXT, 'scripts', 'block-migration', 'gen-allblocks.js');

const die = (msg) => { console.error(`🔴 cannot widen the sample site: ${msg}`); process.exit(2); };
// 🔴 一个没接住的异常退的是 1，而 1 在这条链上是「某套主题表破了不变量」的意思。把它也收成 2，
//    上面那句「没有退出 1」才是真的：这个脚本永远不判主题的好坏，它只会说「铺不开，别信读数」。
process.on('uncaughtException', (e) => die(`unexpected: ${(e && e.message) || e}`));
const readJson = (p) => JSON.parse(fs.readFileSync(p, 'utf-8'));
const writeJson = (p, v) => fs.writeFileSync(p, `${JSON.stringify(v, null, 2)}\n`);

const siteDir = process.argv[2] ? path.resolve(process.argv[2]) : path.join(NEXT, 'site');

// 🔴 这个脚本只认多语言形状（`site/<locale>/`）—— 那是 `create-site.js` 现造的演示站的形状，
//    也是唯一会走到这里的形状。猜错目录的后果是「什么都没补上，而读数看起来正常」。
const meta = path.join(siteDir, 'site_meta.json');
if (!fs.existsSync(meta)) die(`no site_meta.json at ${siteDir} — this is not the demo site's shape`);
const locale = readJson(meta).defaultLocale;
if (!locale) die('site_meta.json has no defaultLocale');
const contentDir = path.join(siteDir, locale);
const pagesDir = path.join(contentDir, 'pages');
if (!fs.existsSync(pagesDir)) die(`no ${path.relative(NEXT, pagesDir)}`);

// ── ① 一页含全部块 ────────────────────────────────────────────────────────────────────────────
if (!fs.existsSync(GEN)) die(`no ${path.relative(NEXT, GEN)}`);
const gen = cp.spawnSync(process.execPath, [GEN], { cwd: NEXT, encoding: 'utf8' });
if (gen.status !== 0) die(`gen-allblocks.js exited ${gen.status}\n${(gen.stderr || '').trim()}`);
const allblocks = path.join(pagesDir, 'allblocks.json');
if (!fs.existsSync(allblocks)) die(`gen-allblocks.js did not write ${path.relative(NEXT, allblocks)}`);
console.log(`  sample site: ${String(gen.stdout || '').trim()}`);

// ── ② 三处块数据 ─────────────────────────────────────────────────────────────────────────────
const page = readJson(allblocks);
// 🔴 #1061 — 这一页不进导航。`gen-allblocks.js` 给它写的是 `navLabel: 'All Blocks'`，而导航是
//    sync-config 从每一页的 navLabel 生成的（sync-config.js:560/567）⟹ 撑开这个站会给**每一页**的
//    页头和页脚多一个「All Blocks」链接。它改的不只是这一页：#1061 让主题图册也拍这一页之后，
//    首页和关于页那两张图上都会多出这个链接，而真实站上没有它。实测（bold-red，撑开前后两次构建，
//    把 index.html 按 `>` 断行再 diff）：整页 DOM 唯一的差别就是那一个 <a>。
//    下面那一页 services/oil-change 早就是这么处理的，理由同一条——它存在是为了让别的东西有东西可指，
//    不是为了被人点。改完之后首页/关于页的 PNG 与撑开之前逐字节相同。
//    📌 不影响这个脚本原本要服务的 CI 检查：`theme-css-invariants.mjs` 的页面清单读的是站自己的
//    /sitemap.xml（它自己的注释：not a crawl of the nav），而 sitemap 不看 navLabel——
//    实测撑开后的 sitemap 里 allblocks 和 services/oil-change 两条都在。
page.navLabel = '';
const sections = page.sections || page.blocks || [];
if (!sections.length) die('the generated allblocks page has no sections');
const sectionOf = (type) => sections.find((s) => s.type === type);
const patched = [];

{
  const s = sectionOf('gallery');
  const items = s && s.data && s.data.items;
  if (!Array.isArray(items) || items.length < 3) die('the generated gallery block has fewer than 3 items');
  // 第 3 张不带图 —— 组件在这一支画 __placeholder。留前两张带图，__image 那条也要有人量。
  delete items[2].imageUrl;
  patched.push('gallery item 3 has no imageUrl → .gallery__placeholder');
}
{
  const s = sectionOf('feature-comparison');
  const rows = s && s.data && s.data.comparisons;
  if (!Array.isArray(rows) || !rows.length) die('the generated feature-comparison block has no comparisons');
  rows[0].us = true;            // --yes 和 --no 都要有人量，所以两种都留着
  rows[0].them = false;
  patched.push('feature-comparison row 1 has them:false → .feature-comparison__mark--no');
}
{
  // #1060 —— 第 1 条问答建出来就是打开的。
  //
  // 🔴 为什么非补这一处不可：#1056 之后，关着的 `<details>` 里的字不再当成客人读得到的正文，而
  //    `FaqAccordionSection.tsx` 渲染出的每一条**都是**关着的 ⟹ 一套主题表写
  //    `.faq-accordion__answer { max-height: 3px; overflow: hidden }` 时四道闸没有一道看得见
  //    （改这一行之前在这个站上端到端量过：`theme-pipeline/run.js` rc=0，报告里 `faq-accordion`
  //    一次都没出现）。而真人点开 FAQ 看到的是一条 3px 的缝。
  //
  // 🔴 只开**一条**，不是全开：其余两条仍然关着，于是同一页同时回答两个问题 —— 打开的那条的答案
  //    重新被量（本票要的视力），关着的那两条照旧被豁免（#1056 的结论，不许回退）。全开会把后半句
  //    从这个站上抹掉，那时「豁免坏了」跟「一切正常」在读数上长得一模一样。
  //
  // 🔴 这个字段只写在这里。`blocks/faq-accordion.json` 故意没有这个槽，所以 AI 建的真实站一条都
  //    不会带上它 —— 客人的 FAQ 照旧默认全部关着（#1060 正文里那条硬边界）。
  const s = sectionOf('faq-accordion');
  const items = s && s.data && s.data.items;
  if (!Array.isArray(items) || items.length < 2) {
    die('the generated faq-accordion block has fewer than 2 items — one open and one closed are both needed');
  }
  items[0].defaultOpen = true;
  patched.push('faq-accordion item 1 is open → .faq-accordion__answer is measured again (#1060)');
}
const SERVICE_SLUG = 'services';
{
  const s = sectionOf('service-related-pages');
  if (!s || !s.data) die('the generated page has no service-related-pages block');
  s.data.serviceSlug = SERVICE_SLUG;
  patched.push(`service-related-pages serviceSlug=${SERVICE_SLUG}`);
}
patched.push('allblocks navLabel is empty → 它不进任何一页的导航（#1061）');
writeJson(allblocks, page);

// ── ③ services.json 的 products（块的 data 管不到它）────────────────────────────────────────
{
  const p = path.join(contentDir, 'services.json');
  if (!fs.existsSync(p)) die(`no ${path.relative(NEXT, p)}`);
  const services = readJson(p);
  if (!Array.isArray(services) || !services.length) die('services.json is not a non-empty array');
  if (!Array.isArray(services[0].products) || services[0].products.length === 0) {
    services[0].products = [{ name: 'Synthetic oil', description: 'Full synthetic, 5W-30.' }];
    writeJson(p, services);
  }
  patched.push('services.json service 1 has products → .services-list__products');
}

// ── ④ 站的形状：一页挂在 services/ 底下 ───────────────────────────────────────────────────────
{
  const child = path.join(pagesDir, `${SERVICE_SLUG}-oil-change.json`);
  writeJson(child, {
    slug: `${SERVICE_SLUG}/oil-change`,
    title: 'Oil Change',
    description: 'Oil change service page — makes service-related-pages render.',
    // 🔴 navLabel 空是有意的：sync-config 的导航是 `.filter(p => p.navLabel)`（sync-config.js:529/536），
    //    空串会被滤掉。给了它就等于往**每一页**的页头多加一个链接，那会改掉所有页面的读数——
    //    这一页存在是为了让 service-related-pages 有东西可指，不是为了被人点。
    navLabel: '',
    navOrder: 99,
    changeFrequency: 'monthly',
    priority: 0.1,
    blocks: [{
      id: 'oil-change-page-header',
      type: 'page-header',
      role: 'optional',
      region: 'content',
      weight: 0,
      data: { title: 'Oil Change', subtitle: 'What it costs and how long it takes' },
    }],
  });
  patched.push(`page ${SERVICE_SLUG}/oil-change → .service-related-pages*`);
}

// ── 读回验一次 ────────────────────────────────────────────────────────────────────────────────
// 🔴 上面每一处都是「我写了」，这里问的是「盘上现在是什么」。少了这一步，某一处被后来的改动
//    弄丢时，这个脚本仍然会打印它做过 —— 而那正是本票要治的那种「看起来在工作」。
{
  const back = readJson(allblocks);
  const bs = back.sections || back.blocks || [];
  const find = (t) => bs.find((s) => s.type === t);
  const bad = [];
  if (back.navLabel !== '') bad.push('allblocks navLabel is not empty — every page would grow a nav link to it');
  if (find('gallery').data.items[2].imageUrl !== undefined) bad.push('gallery item 3 still has imageUrl');
  if (find('feature-comparison').data.comparisons[0].them !== false) bad.push('feature-comparison row 1 them is not false');
  if (find('service-related-pages').data.serviceSlug !== SERVICE_SLUG) bad.push('serviceSlug did not stick');
  // #1060 —— 两个方向都读回来：第 1 条真的开着，而第 2 条真的还关着。只问前半句的话，
  // 「全部开着」跟「只开了第一条」在这里长得一样，而那两种情况对 #1056 那条豁免的意思相反。
  {
    const faq = find('faq-accordion').data.items;
    if (faq[0].defaultOpen !== true) bad.push('faq-accordion item 1 is not open');
    if (faq[1].defaultOpen !== undefined) bad.push('faq-accordion item 2 was left open too — the closed arm is gone');
  }
  const svc = readJson(path.join(contentDir, 'services.json'));
  if (!Array.isArray(svc[0].products) || !svc[0].products.length) bad.push('services.json products is still empty');
  const childPath = path.join(pagesDir, `${SERVICE_SLUG}-oil-change.json`);
  if (!fs.existsSync(childPath) || readJson(childPath).slug !== `${SERVICE_SLUG}/oil-change`) {
    bad.push('the services/oil-change page is not on disk');
  }
  if (bad.length) die(`read-back failed: ${bad.join(' · ')}`);
}

for (const p of patched) console.log(`  sample site: ${p}`);
