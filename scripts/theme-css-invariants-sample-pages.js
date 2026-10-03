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
// 🔴 **这道检查瞎掉挡不住 `release`，挡的是 `sync-template`**（`ci-cd.yml` 里 `sync-template` 那个 job 的
//    `needs:` 列着 theme-css，而 `release` 那个 job 的 `needs: [changes, ci]` 不列它）—— 也就是
//    **模板 repo 会被推出去**，而每个新站都从那份字节建。
//    🔴 #1277 台账条 27③ —— 这两个坐标原来写的是 `ci-cd.yml:693` 与 `:412`，两个都已经指错：`:693`
//       今天是一句讲 `ship-check-doc-paths.sh` 的注释。换成 job 名 + `needs:` 这个查得到的锚。
//
// ══ 光把块放上页面还不够 ═══════════════════════════════════════════════════════════════════════
// 有五处要连**块的数据、甚至站的形状**一起给，否则那些钩子仍然不进 DOM（逐处在真机上量过）：
// 📌 #1372 —— 原来还有第六处（某个块的一对 `--yes` / `--no` 修饰钩子），那个块整个删了（D19）。
//
//   `.gallery__placeholder`      GallerySection.tsx:62-67 —— 有 imageUrl 就画 __image，没有才画它。
//                                而夹具生成器给每张图都编了一个 URL ⟹ 让第 3 张不带 imageUrl。
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
//    📌 #1321 在那个文件里只**删**了一个字段（`opt` —— 组件 TS 类型里的那个 `?`，全文只被写不被读，
//    而且对三个没有 `data: {` 的块给不出读数）。这一段说的「别把这道检查的需要塞进去」没有破：
//    最少版的削减整个做在**这里**，做法照旧是「先请它生成，再在产物上动」。
//    📌 #1473 给它加了一个可选参数（写到哪儿），也没有破这一条：那是「产物放哪个 locale 目录」，不是数据。
//
// ══ 两版（#1321）═══════════════════════════════════════════════════════════════════════════════
//   node scripts/theme-css-invariants-sample-pages.js [<站目录>]            全填版（默认，行为一字未改）
//   node scripts/theme-css-invariants-sample-pages.js [<站目录>] --minimal  最少版
//
// 全填版把每个块的槽位**填满**；最少版**只填必填槽**（判据只有一个来源：`blocks/<type>.json` 的
// `slots.<名>.required`），可选槽位一个字节都不写，列表槽只放一项。
//
// 🔴 为什么要有第二版：只量填满那一支，有两类错看不见 —— 「需要图」的形态在**没图**的 hero 上有没有
//    真落回默认，三列卡片组**只填一张卡**时散不散。真站里可选槽位填不填是随机的（设计文档 D5）。
//
// 🔴 最少版**跳过**下面 ② 段里那几处 propping，逐条印出来（不许静默少做）。代价写在明处：
//    `.gallery__placeholder` / FAQ 那对开关对照 / `.card-group__features` / `.hero__form`
//    这几族钩子在最少版上**没有人量** —— 这是接受的，不是漏的。
//    那两处门槛（gallery ≥3 项 · faq-accordion ≥2 项）也只对全填版成立：
//    最少版把列表槽压到一项之后它们按构造撞死，而这个脚本撞死就是 exit 2。
//
// 🔴 ③ 段（services.json 的 products + #1320 那几条服务）和 ④ 段（services/oil-change 那一页）
//    **两版都保留**。前者是因为那三个块（contact-form / services-list / services-nav）的条目数由站的
//    services.json 决定、不由块的槽位决定 ⟹ 两版相同；后者是因为 `service-related-pages` 的
//    `serviceSlug` 是必填槽，最少版会写它，而**光写它不够**：组件拿它去筛页面，筛不到就整块不进 DOM。
//    ② 段里 serviceSlug 那一处同理保留 —— 那两处缺一不可。
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

// 🔴 旗标先摘掉再取站目录：只给 `--minimal` 不给站目录时，`argv[2]` 会是那个旗标本身，
//    而「猜错目录」的后果是「什么都没补上，而读数看起来正常」（同下面那条只认多语言形状的判断）。
const ARGS = process.argv.slice(2);
const MINIMAL = ARGS.includes('--minimal');
const POSITIONAL = ARGS.filter((a) => !a.startsWith('--'));
for (const a of ARGS) {
  if (a.startsWith('--') && a !== '--minimal') die(`unknown flag ${a} — the only flag is --minimal`);
}
const siteDir = POSITIONAL[0] ? path.resolve(POSITIONAL[0]) : path.join(NEXT, 'site');
const VERSION = MINIMAL ? '最少版' : '全填版';

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
const allblocks = path.join(pagesDir, 'allblocks.json');
// #1473 —— 写到本站 defaultLocale 的内容目录。不传时 gen-allblocks.js 写死 site/en/，`ar` 样例站就铺不开。
const gen = cp.spawnSync(process.execPath, [GEN, allblocks], { cwd: NEXT, encoding: 'utf8' });
if (gen.status !== 0) die(`gen-allblocks.js exited ${gen.status}\n${(gen.stderr || '').trim()}`);
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
// 最少版少做的那几件事，逐条记下来印出去 —— 「少做了一件事还绿着」跟「做过了」长得一模一样。
const skipped = [];
// 最少版每个块削成什么样。
const pruned = [];

// ── ①a 每个块的内容换成**演示内容包**（#1383）────────────────────────────────────────────────
//
// 🔴 `gen-allblocks.js` 合成的数据是从**组件 TS 类型**推的占位串（`Headline text` / `/images/
//    grid-pattern.svg` / 三项等长的列表）。图册页 `/__catalog` 与单格页 `/__catalog/<块>/<形态>`
//    今天都读 `scripts/lib/demo-content/`，这一页要跟它们**同一份内容**，否则同一个块在两个地方
//    长得不一样，而看的人分不清哪一份才是我们要给人看的样子。
//
// 🔴 **只换 `data`，不换这一页的骨架**：块有哪些、顺序、id 仍然由 `gen-allblocks.js` 定
//    （本文件头上那条「先请它生成，再在产物上补」原样成立，这里补的是内容那一层）。
// 🔴 换完之后每个键都来自 manifest 的 `slots` ⟹ 下面最少版那段的「manifest 里没有的键」按构造
//    是空的。那段代码不动：它是对**输入**的断言，不是对这一次替换的断言。
const { demoDataFor } = require('./lib/demo-content');
const { loadManifests: loadDemoManifests } = require('./lib/block-manifest');
const DEMO_MANIFESTS = loadDemoManifests(path.join(NEXT, 'blocks'));
for (const sec of sections) {
  const m = DEMO_MANIFESTS.get(sec.type);
  if (!m) die(`no blocks/${sec.type}/manifest.json — 演示内容按 manifest 的槽位发，没有 manifest 就发不出`);
  try {
    sec.data = demoDataFor(m);
  } catch (e) {
    die(`demo-content 发不出 ${sec.type} 的内容: ${(e && e.message) || e}`);
  }
}
patched.push(`每个块的 data 换成演示内容包（${sections.length} 个块，scripts/lib/demo-content/）`);

// ── ①b 最少版：每个块只留必填槽，列表槽只放一项（#1321）──────────────────────────────────────
//
// 🔴 判据只有一个来源：`blocks/<type>.json` 的 `slots.<名>.required`。**不读**组件 TS 类型里的那个
//    `?` —— 那是两套字节，而且对 contact-form / services-list / services-nav 三个块给不出任何读数
//    （它们的 .tsx 里没有 `data: {` 可解析）。#1321 已经把那个字段从 gen-allblocks.js 里删掉了。
const BLOCKS_DIR = path.join(NEXT, 'blocks');
// 🔴 「这个槽是不是一份列表」取**两把尺的并集**，不是任选一把 —— 两把在盘上真的不一致。当时量到分歧的
//    那一处是 #1320 那批里 logo 墙那个块的 `logos` 槽：`kind` 写的是 `"image"`、`shape` 写的是
//    `"[string]"`，只按 `kind` 判会漏掉它（它的 logos 不会被压到一项，`trusted-brands` 会 —— 一组对照里
//    两个块走了两条路）。📌 那个块本身已在 #1375 按 D19 删掉，这段留着是因为它说明的是「取并集」这条
//    规矩，而下一个 `kind` / `shape` 对不上的槽随时会再出现。
//    下面还有一道反向自检：产物里是数组、而这条判据说不是列表的，当场报。
const isListSlot = (spec) => spec.kind === 'list'
  || (typeof spec.shape === 'string' && spec.shape.trim().startsWith('['));
if (MINIMAL) {
  const judgeMissed = [];
  for (const sec of sections) {
    // #1387 —— 一个块一个文件夹，槽位住在 `blocks/<块>/manifest.json`。
    const mf = path.join(BLOCKS_DIR, sec.type, 'manifest.json');
    if (!fs.existsSync(mf)) {
      die(`no blocks/${sec.type}/manifest.json — 最少版的判据只有 manifest 一个来源，没有它就说不出这个块该削成什么样`);
    }
    const slots = readJson(mf).slots || {};
    const data = sec.data || {};
    for (const [k, v] of Object.entries(data)) {
      if (Array.isArray(v) && slots[k] && !isListSlot(slots[k])) judgeMissed.push(`${sec.type}.${k}`);
    }
    const kept = {};
    const missing = [];
    const dropped = [];
    const trimmed = [];
    for (const [name, spec] of Object.entries(slots)) {
      if (!spec.required) { if (name in data) dropped.push(name); continue; }
      if (!(name in data)) { missing.push(name); continue; }
      let v = data[name];
      if (isListSlot(spec)) {
        if (!Array.isArray(v)) {
          die(`${sec.type}: 必填列表槽 "${name}" 生成出来的不是数组（${typeof v}）—— 压不到一项`);
        }
        if (v.length > 1) { v = v.slice(0, 1); trimmed.push(`${name}(${data[name].length}→1)`); }
      }
      kept[name] = v;
    }
    // 🔴 必填槽在产物里找不到 = 最少版会缺一个必填槽，而 `validateSite` 的第 ① 条当场报它
    //    （AC1 要 0 problem）。这里先说，别让它变成下游一句读不懂的校验失败。
    if (missing.length) {
      die(`${sec.type}: manifest 说必填的槽 ${missing.join(' / ')} 在 gen-allblocks.js 生成的数据里没有`);
    }
    // manifest 里没有这个槽、而 TS 类型有 —— 也一并去掉（最少版按 manifest 定义，不按 TS 类型定义），
    // 但要点名，否则「这个键去哪了」没人答得上来。
    // 🔴 键名里可能带换行：`gen-allblocks.js` 的 `fields()` 按顶层逗号/分号切类型体、**不认注释**，
    //    于是一段 doc 注释会被吃进字段名（#1143 记的是同一个洞，那次吃掉的是 `card-group` 的
    //    `features`；现测 `announcement-bar` 的 `variant` 也被吃掉）。这里把空白压成一格再印 ——
    //    一条跨行的读数会被 grep 切成两半，而这几行名单正是 AC5 要人逐条读的东西。
    const oneLine = (k) => k.replace(/\s+/g, ' ').trim().slice(0, 48);
    const notInManifest = Object.keys(data).filter((k) => !(k in slots)).map(oneLine);
    sec.data = kept;
    pruned.push(`${sec.type}: 必填槽 ${Object.keys(kept).join(' / ') || '(一个都没有)'}`
      + `${dropped.length ? ` · 去掉可选槽 ${dropped.join(' / ')}` : ''}`
      + `${notInManifest.length ? ` · 去掉 manifest 里没有的键 ${notInManifest.join(' / ')}` : ''}`
      + `${trimmed.length ? ` · 列表槽压到 1 项 ${trimmed.join(' / ')}` : ''}`);
  }
  if (judgeMissed.length) {
    die('最少版「哪个槽是列表」的判据漏了 ' + judgeMissed.join(' / ')
      + ' —— 它们在产物里是数组，而 manifest 的 kind / shape 两把尺都没说它是列表');
  }
}

// ── ② ③ ④ 原来在这里 —— #1425（T3）整段删了 ──────────────────────────────────────────────────────
// 📌 原来这里给**旧库**的块补数据、补站的形状，好让契约里那几族钩子进 DOM：gallery 第 3 张不带图（`.gallery__placeholder`）、
//    faq-accordion 第 1 条打开（#1060）、card-group 带 features、service-related-pages 的 serviceSlug + 一页
//    `services/oil-change`、services.json 的 products 和 #1320 那三条服务、services 页补 services-nav（#1327）。
//    那些块和它们的钩子随旧库一起删了；新库的 17 个块不走主题表契约里的那族 BEM 钩子（形态层是 `public/shapes.css`
//    + `site.css`），演示内容包本身就把每个槽填满了 ⟹ 这一页今天不需要任何补丁。
patched.push('allblocks navLabel is empty → 它不进任何一页的导航（#1061）');
writeJson(allblocks, page);

// ── ⑤ 博客文章（#1426）──────────────────────────────────────────────────────────────────────────────
// 演示站（create-site skipAI）一篇文章都没有 ⟹ /blog 与 /blog/<slug> 两页不存在、不进 sitemap，这道检查从来没量过它们；
// blog 块也因为「站里没文章就整块不渲染」在 allblocks 页上是空的。写进 5 篇演示文章 + 1 篇正文带全套裸标签的
// （`DEMO_BLOG_POST_RICH`）。两版都写：文章是站的形状，不是块的数据，最少版削的是块的槽。
const { DEMO_BLOG_POSTS, DEMO_BLOG_POST_RICH } = require('./lib/demo-content');
const BLOG_POSTS = [...DEMO_BLOG_POSTS, DEMO_BLOG_POST_RICH];
const blogDir = path.join(contentDir, 'blog');
fs.mkdirSync(blogDir, { recursive: true });
for (const post of BLOG_POSTS) writeJson(path.join(blogDir, `${post.slug}.json`), post);
patched.push(`blog/: ${BLOG_POSTS.length} 篇文章（/blog 与 /blog/<slug> 进 sitemap，blog 块有文章可画）`);

// ── 读回 —— 每一处都从盘上读回来再验一次 ─────────────────────────────────────────────────────
{
  const back = readJson(allblocks);
  const bs = back.sections || back.blocks || [];
  const bad = [];
  if (back.navLabel !== '') bad.push('allblocks navLabel is not empty — every page would grow a nav link to it');
  // 🔴 分母自检：注册表里的每一个**页面块**都要在这一页上（外壳区 header / footer 不在注册表里，由每一页的外壳画）。
  //    少一个 = 那个块的读数在这道检查里根本不存在，而命令照样 rc=0 —— 本文件立起来要治的就是这个形状（#1052）。
  const registry = fs.readFileSync(path.join(NEXT, 'src', 'lib', 'sections', 'registry.generated.ts'), 'utf-8');
  const registered = [...registry.matchAll(/^\s*'([a-z0-9-]+)':\s*[A-Za-z0-9_]+,?/gm)].map((m) => m[1]);
  if (!registered.length) bad.push('read 0 block types from registry.generated.ts — the denominator collapsed');
  const onPage = new Set(bs.map((s) => s.type));
  const absent = registered.filter((t) => !onPage.has(t));
  if (absent.length) bad.push(`registered page blocks missing from the allblocks page: ${absent.join(', ')}`);
  if (MINIMAL) {
    for (const sec of bs) {
      const mf = path.join(BLOCKS_DIR, sec.type, 'manifest.json');  // #1387 —— 一个块一个文件夹
      if (!fs.existsSync(mf)) continue;
      const slots = readJson(mf).slots || {};
      const d = sec.data || {};
      for (const [name, spec] of Object.entries(slots)) {
        if (!spec.required) {
          if (name in d) bad.push(`${sec.type}: optional slot "${name}" is still on the page (minimal)`);
          continue;
        }
        if (!(name in d)) bad.push(`${sec.type}: required slot "${name}" is missing (minimal)`);
        else if (isListSlot(spec) && Array.isArray(d[name]) && d[name].length !== 1) {
          bad.push(`${sec.type}: list slot "${name}" has ${d[name].length} item(s), not 1 (minimal)`);
        }
      }
    }
  }
  for (const post of BLOG_POSTS) {
    const f = path.join(blogDir, `${post.slug}.json`);
    if (!fs.existsSync(f) || readJson(f).slug !== post.slug) bad.push(`blog post ${post.slug} did not land in ${path.relative(NEXT, blogDir)}`);
  }
  if (bad.length) die(`read-back failed: ${bad.join(' · ')}`);
  patched.push(`读回：注册表里 ${registered.length} 个页面块全在这一页上`);
}

for (const p of patched) console.log(`  sample site: ${p}`);
// 🔴 最少版少做的每一件事逐条印出来（AC5 的第一份名单）。「这一类 0 条」也要印 —— 印不出来
//    跟做过了长得一模一样，而这正是本票要治的形状。
if (MINIMAL) {
  for (const p of pruned) console.log(`  sample site (最少版): ${p}`);
  if (skipped.length) {
    for (const p of skipped) console.log(`  sample site (最少版跳过): ${p}`);
  } else {
    console.log('  sample site (最少版跳过): 0 条 —— #1425 起这一页没有任何 propping（② 段整段删了），所以没有可跳的');
  }
  console.log(`  sample site (最少版): 跳过 ${skipped.length} 处 propping · 削了 ${pruned.length} 个块`);
}
