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
// 有六处要连**块的数据、甚至站的形状**一起给，否则那些钩子仍然不进 DOM（逐处在真机上量过）：
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
//   ~~`.service-highlights__item`~~ #1162 划掉：那四个老 type 名（`values-grid` / `benefits-list` /
//   ~~`__title` `__desc` `__features`~~  `checklist` / `service-highlights`）随别名兼容层
//                                2026-08-23 整层退役 —— 它们不在注册表、它们的钩子也不在契约里，
//                                所以这一页不再有那个块，也没有那族钩子要撑。#1143 当天那段理由
//                                （槽位名 `items` vs 老站的 `highlights`、`blocks.js` 里
//                                那层已退役的别名映射的 §2.5 坑三守卫）搬到了下面 propping 那一段的 📌 里，
//                                作出处留着。今天代替它的是一格**反向的分母自检**：这一页上再出现
//                                这四个 type 名之一就报（在下面 read-back 那段）。
//   `.card-group__features`      同一批里这个键是**另一个原因**没被生成：`gen-allblocks.js` 的 `fields()`
//                                按顶层逗号/分号切类型体、**不认注释**，于是 `CardGroupItem` 里 `features?`
//                                上面那段 doc 注释被吃进了字段名（实测那个块 `items[0]` 的键是
//                                `["title","description","/** … 老站那条路"]`，没有 `features`）。那是那个
//                                工具的既有脆弱处、被本票新写的那段注释踩中，按下面那条不在这里修
//                                ⟹ 在产物上补。
//                                📌 #1149 item 25 —— 这个洞落在**三个块**上,不是一个:`checklist` /
//                                `service-highlights` / `card-group` 三个 type 在 registry.ts 里都指向
//                                `CardGroupSection`,所以生成器给它们合成的 `items[0]` 键**逐字相同**
//                                (实测三个都是 `["title","description","/** #1143 …"]`)。而下面第 ②
//                                段只替换了后两个的整条数组 ——**`checklist` 那块原样留着那个垃圾键**。
//                                今天无害,理由是契约里 `checklist` 一族根本没有 `__features` 这个钩子:
//                                  grep -ohE '\.checklist__[a-z-]+' docs/reference/theme-css-contract.md | sort -u
//                                ⟹ 只有 `__headline` / `__item` / `__sub` 三条。哪天有人给契约加一条
//                                `.checklist__features`,同一个形态会再红一次,那时把 `checklist` 一起补上。
//                                🔴 #1162:上面这一段整体是**出处**了 —— `checklist` 与 `service-highlights`
//                                这两个 type 名已随别名兼容层退役,这一页上一个都没有(反向自检见
//                                read-back 那段)。今天走 `CardGroupSection` 的只剩 `card-group` 一个 type,
//                                所以「三个 type 键逐字相同」那句话今天量不出来了。机理没变。
//                                📌 我把它自己那份 `fields()` 原样抠出来跑了一遍全部已注册组件：真正落在
//                                `data` 那一层里、名字被注释吃掉的只有三个键 —— 本块的 `features`、
//                                `FaqAccordionSection` 的 `defaultOpen`、`AnnouncementBarSection` 的
//                                `variant`（其余命中都是 `block?: BlockConfig` 那条，它是 Props 的字段、
//                                不在 `data` 里，不影响产物）。`defaultOpen` 上面 faq-accordion 那一段
//                                已经在补（那是 #1060 为开/关两臂补的，不是为这个洞）；`variant` 本轮
//                                **不补** —— 给它喂值会让那个块新收到一个它今天收不到的东西，是另一件事。
//
// 📌 **到不了 0，下限是那几个「提交之后才有」的表单状态**，它们不是补数据能救的：`.contact-form__error`
//    / `__success`、`.quote-form__error` / `__success`（`ContactFormSection.tsx:109/112/142`、
//    `QuoteFormSection.tsx:118/121/188`），加上 hero 那一对：#1150 的 `.hero__form-error` 与
//    #1158 的 `.hero__form-success`（`HeroLeadForm.tsx` 那两个 `<p>` 一个只在提交失败时渲染、一个
//    只在提交成功时渲染）。`__success` 还要 `POST /api/leads` 返回 ok，而演示站是静态导出、没有那个接口。
//    🔴 #1158 顺带证一件事：这一族的判据是 `theme-css-invariants.mjs` 的 `reachableOnSubmitOnly`
//    （`/(?:__|-)(?:error|success)$/`，一处定义），**新加的钩子只要按这个命名就自动在豁免里**——
//    `.hero__form-success` 一个字节都没改那条正则就被收进去了。所以上面这段散文是【出处】，不是判据；
//    判据永远是下面那条自己算一次的命令。
//    🔴 **这里不写「一共几条」**：那个数每加一个表单部件就变，而写死它的样子跟没过期一模一样
//    （#1150 之前这里写的是「一共就这四条，其余 209 条」，两个数当天都已经旧了）。自己算一次 ——
//    豁免的那一族由 `theme-css-invariants.mjs` 的 `reachableOnSubmitOnly` 一处定义：
//      node -e "const {HOOK_CLASSES}=require('./scripts/theme-css-lint.js');
//               const f=(h)=>/(?:__|-)(?:error|success)$/.test(h);
//               console.log(HOOK_CLASSES.filter(f).length, '/', HOOK_CLASSES.length)"
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
{
  // #1065 —— hero 的第八个部件 `.hero__form` 只在这块 hero 自己说「我是带表单的那种」时才进 DOM
  //（`HeroSection.tsx` 读的是页面 JSON 的 `block_layout`，不是主题的 `supports.hero` —— 内容结构
  //  归站，08-12 spec D5 / 08-18 spec D3）。`gen-allblocks.js` 从组件的 props 类型推数据，推不出
  //  这个字段，所以它归这里补。
  //
  // 🔴 不补的后果不是「少量了一个钩子」：`theme-css-invariants.mjs` 在 THEME_CSS_SAMPLE_WIDENED=1
  //    下把「契约里有、这个站的页面上没有」当成 finding（rc≠0），豁免的只有「提交之后才进 DOM 的
  //    表单状态」那一族（判据是那个文件里的 `reachableOnSubmitOnly` 一处，#1150 起它认两种拼法：
  //    块自己就是表单时写 `__error`，表单是块的一个部件时写 `-error`）。也就是说往契约里加一个
  //    钩子而不喂它数据 = CI 当场红。
  const s = sectionOf('hero');
  if (!s) die('the generated page has no hero block');
  s.block_layout = 'with-form';
  patched.push('hero block_layout=with-form → .hero__form（#1065）');
}
{
  // #1143 —— 并进「卡片组」的块要连数据一起补，否则钩子一页都不进 DOM。
  //
  // 🔴 **#1162 拿掉了这里的第 ① 段（`service-highlights` 那半）。** 原文留在下面 📌 里作出处。
  //    理由：那半段补的是**老站那条路**（把 `items` 改名回老槽位 `highlights`，顺带真跑一次别名映射），
  //    而别名兼容层 2026-08-23 整层退役 —— `service-highlights` 这个 type 名不在注册表里、
  //    `.service-highlights__*` 五条钩子也不在契约里了 ⟹ 这一页不再有那个块，`sectionOf` 会返回
  //    undefined 并 `die`。留着它等于让这份夹具去撑一族**已经不存在**的钩子。
  //    今天要撑的只剩 `.card-group__features` 一条（下面 ② 那个原因），它照旧补。
  //
  //    📌 出处（#1143 当天那段，读的时候记住它说的是别名层还在的时候）：合并之后 `checklist` /
  //    `service-highlights` / `card-group` 三个 type 都指向 `CardGroupSection`，而 `gen-allblocks.js`
  //    是照**组件的 TS 类型**合成数据的 ⟹ 它给 `service-highlights` 块写的是 `items`；老站那条路上
  //    那个槽位叫 `highlights`（`src/lib/sections/block-aliases.json`），而 `scripts/blocks.js` 的
  //    那层已退役的别名映射有一道守卫：改名的**源不在、目标在** ⟹ 把目标也删掉（映射文档 §2.5 坑三），
  //    于是那一节只剩标题、零条目。
  //
  // 🔴 ② `features` 这个字段。`gen-allblocks.js` 的 `fields()` 按顶层逗号/分号切类型体、**不认注释**，
  //    于是 `CardGroupItem` 里 `features?` 上面那段 doc 注释被当成了字段名的一部分，真正的
  //    `features` 键根本没被合成（实测：那个块 `items[0]` 的键是 `["title","description","/** … features"]`）。
  //    这是那个工具的既有脆弱处，不归这里修（它自己的注释写着别把这道检查的需要塞进它）——
  //    这里的做法照本文件头上那条：**先请它生成，再在产物上补**。
  //    📌 这个洞吃掉的键不止一个，清单与处置写在本文件头上那一段（`variant` 本轮不补，理由在那里）。
  const FEATURED = (n) => ({
    title: `Title text ${n}`,
    description: 'Description text',
    features: ['Feature one', 'Feature two'],
  });
  const PLAIN = (n) => ({ title: `Title text ${n}`, description: 'Description text' });

  const cg = sectionOf('card-group');
  if (!cg || !cg.data) die('the generated page has no card-group block');
  cg.data.items = [FEATURED(1), PLAIN(2), PLAIN(3)];
  patched.push('card-group item 1 has features → .card-group__features');
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
  if (find('hero').block_layout !== 'with-form') bad.push('hero block_layout is not with-form — .hero__form would be on no page');
  // #1060 —— 两个方向都读回来：第 1 条真的开着，而第 2 条真的还关着。只问前半句的话，
  // 「全部开着」跟「只开了第一条」在这里长得一样，而那两种情况对 #1056 那条豁免的意思相反。
  {
    const faq = find('faq-accordion').data.items;
    if (faq[0].defaultOpen !== true) bad.push('faq-accordion item 1 is not open');
    if (faq[1].defaultOpen !== undefined) bad.push('faq-accordion item 2 was left open too — the closed arm is gone');
  }
  // #1143 —— 读回来:`card-group` 的 `items` 在,而且第一条真的带 `features`。
  // 🔴 #1162:这里原来还读 `service-highlights` 的 `highlights` 两个方向(补上了 / `items` 没留下)。
  //    那个 type 名随别名兼容层退役,这一页不再有那个块 ⟹ 那两条断言会读到 undefined 并报假红。
  //    下面那段 #1149 item 26 的更正说的是**那半段**,留作出处 —— 当年那层别名映射两支(源在 / 源不在
  //    而目标在)的机理没变,只是今天没有块走它们了。
  //
  // 🔴 #1149 item 26 更正:上一版这里(以及下面那条报文)给的理由是「只问 `highlights` 在不在的话,
  //    `items` 还留着时那道 §2.5 坑三守卫会把两个槽位一起清掉」——**那是假的**。`blocks.js` 的
  //    那层已退役的别名映射里两个键都在时走的是**源在**那一支(当年 `blocks.js`:`if (源在) {
  //    data[to]=data[from]; delete data[from] }`),也就是 `highlights` 赢、`items` 被换成它的内容、
  //    **照样渲染**;另一支(源不在、目标在)那个 `else if` 按构造进不去。三份独立读数结果相同。
  //    🔴 #1171:这一段原来写着 `blocks.js:70` / `:74` 两个行号 —— 今天整个 `applyAlias` 连同那两支
  //    已经不在文件里了(#1162 退役别名层,#1171 删掉那个纯转发包装),所以改成按机制说。
  // ⟹ 断言留着,但它守的**不是**「不这么写就会被清空」。它守的是:这个夹具要长得**跟真实老站一样**
  //    —— 老站磁盘上只有 `highlights` 这一个槽位(它就是 `block-aliases.json` 里那条改名的源)。
  //    两个键都写会造出一个真实站点里不存在的形状,那样它顺带跑过的那次别名映射就不是老站走的那条。
  //    开火方向是保守的(多一个键就报),留着不亏。
  {
    // 🔴 反向的分母自检(#1162):这一页上**不许**再有那四个已退役的 type 名。少了这一格，
    //    「那族钩子不用撑了」这个前提就没人验 —— 而它一旦回来，上面那段被删掉的补法也得回来。
    for (const t of ['values-grid', 'benefits-list', 'checklist', 'service-highlights']) {
      if (find(t)) bad.push(`the generated page still has a "${t}" block — that type name retired with the alias layer (#1162); either the generator came back or the registry did`);
    }
    const cg = find('card-group');
    const it = cg && cg.data && cg.data.items;
    if (!Array.isArray(it) || !it.length) bad.push('card-group has no items array');
    else if (!Array.isArray(it[0].features) || !it[0].features.length) bad.push('card-group item 1 has no features → .card-group__features would be on no page');
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
