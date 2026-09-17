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
  if (!m) die(`no blocks/${sec.type}.json — 演示内容按 manifest 的槽位发，没有 manifest 就发不出`);
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
// 🔴 「这个槽是不是一份列表」取**两把尺的并集**，不是任选一把 —— 两把在盘上真的不一致，而分歧那一处
//    恰好是本票要压的块之一：`logo-carousel.logos` 的 `kind` 写的是 `"image"`、`shape` 写的是
//    `"[string]"`。只按 `kind` 判会漏掉它（那个块的 logos 不会被压到一项，`trusted-brands` 会 ——
//    一组对照里两个块走了两条路）。下面还有一道反向自检：产物里是数组、而这条判据说不是列表的，当场报。
const isListSlot = (spec) => spec.kind === 'list'
  || (typeof spec.shape === 'string' && spec.shape.trim().startsWith('['));
if (MINIMAL) {
  const judgeMissed = [];
  for (const sec of sections) {
    const mf = path.join(BLOCKS_DIR, `${sec.type}.json`);
    if (!fs.existsSync(mf)) {
      die(`no blocks/${sec.type}.json — 最少版的判据只有 manifest 一个来源，没有它就说不出这个块该削成什么样`);
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

if (MINIMAL) {
  // 最少版：`items` 是必填列表槽、已被压到一项 ⟹ 没有第 3 张可以拿掉图，下面那道 ≥3 的门槛也
  // 只对全填版成立。`.gallery__placeholder` 这一族在最少版上没有人量（接受的代价）。
  skipped.push('gallery item 3 has no imageUrl → .gallery__placeholder（items 压到 1 项，没有第 3 张）');
} else {
  const s = sectionOf('gallery');
  const items = s && s.data && s.data.items;
  if (!Array.isArray(items) || items.length < 3) die('the generated gallery block has fewer than 3 items');
  // 第 3 张不带图 —— 组件在这一支画 __placeholder。留前两张带图，__image 那条也要有人量。
  delete items[2].imageUrl;
  patched.push('gallery item 3 has no imageUrl → .gallery__placeholder');
}
if (MINIMAL) {
  // 最少版：`items` 压到一项 ⟹ #1060 那对「一条开着、一条关着」的对照按构造造不出来，下面那道
  // ≥2 的门槛也只对全填版成立。那对对照在最少版上没有人量（接受的代价）。
  skipped.push('faq-accordion item 1 is open → .faq-accordion__answer（#1060 那对开/关对照要 ≥2 项，'
    + 'items 压到 1 项）');
} else {
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
// #1333 —— `.hero__form` 这一族不再靠往 hero 上补一个字段来进 DOM，所以这里不再补任何东西。
//
// 以前这里写的是 `s.block_layout = 'with-form'`：`.hero__form` 只在页面 JSON 说「这块 hero 是带表单
// 的那种」时才渲染（#1065），而 `gen-allblocks.js` 从组件的 props 类型推数据，推不出那个字段。
// 📌 #1341 之后连那个字段本身都没有了（内容结构那一维整条退役）。
// #1333 把带表单的首屏拆成了自己一个块类型 `hero-with-form`，它**在注册表里** ⟹ `gen-allblocks.js`
// 按构造就把它连同 `data.form` 一起写进这一页了（组件类型里那个槽是 `{ buttonText?, successMessage? }`，
// 合成器照着造一个对象）。
//
// 🔴 不补的后果那一段照旧成立，只是换了保证人：`theme-css-invariants.mjs` 在
//    THEME_CSS_SAMPLE_WIDENED=1 下把「契约里有、这个站的页面上没有」当成 finding（rc≠0），豁免的
//    只有「提交之后才进 DOM 的表单状态」那一族（`reachableOnSubmitOnly`）。`.hero__form` 不在豁免里
//    ⟹ 它一页都不进 DOM 就是 CI 红。今天保它进 DOM 的是注册表那一行，不是这里的一次 patch，
//    而「它真的在这一页上」由下面那段读回逐版核。
// 🔴 最少版也照样有它：`form` 是 `blocks/hero-with-form.json` 的**必填**槽，而最少版削的是
//    `required: false` 的槽位。#1065 当时接受的那个代价（「`.hero__form` 这一族在最少版上没有人量」）
//    本票顺带还掉了。
if (MINIMAL) {
  // 🔴 #1383 —— 这一格从「接受的代价」变成了「顺带还上」，所以这句话换了内容：
  //    以前最少版的那一张卡是 `gen-allblocks.js` 合成的，而它按构造合成不出 `features`
  //    （原因在下面 else 那支的 ② 里）⟹ `.card-group__features` 在最少版上没有人量。
  //    现在两臂的内容都来自演示内容包（上面 ①a），包里 `card-group.items` 每一项自带 `features`，
  //    压到一项之后那一项照样带 ⟹ 这条钩子在最少版上**也被量到了**。
  // 🔴 这不是把最少版弄宽了：最少版的合同是**槽位**那一层（可选槽位不存在、必填列表槽只剩一项），
  //    而 `features` 是必填槽 `items` 里**一个条目自己的键**，不是一个槽位。两条合同各自照旧，
  //    由下面读回那段的通用循环逐块核。
  const cgMin = sectionOf('card-group');
  const cgMinItems = cgMin && cgMin.data && cgMin.data.items;
  if (!Array.isArray(cgMinItems) || !cgMinItems.some((it) => Array.isArray(it && it.features) && it.features.length)) {
    die('card-group：最少版那一张卡不带 features ⟹ .card-group__features 在这一臂上又没人量了');
  }
  patched.push('card-group 最少版那一张卡也带 features → .card-group__features 在最少版上也被量到（#1383）');
} else {
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
  // 🔴 #1383 —— 这里原来拿三个占位条目（`Title text 1` / `Description text`）**整条覆盖**
  //    `cg.data.items`，为的就是让某一项带上 `features`。演示内容包自己就带 `features`
  //    （`content.js` 的 `card-group.items`），所以覆盖那一手去掉了 —— 留着它等于把刚换上去的
  //    真文案又换回占位串，而本票要的正是这一页跟图册**同一份内容**。
  //    换成一条**对内容包的断言**：一项都没有 `features` 就当场说出来，别让这族钩子静默地
  //    没人量（那正是本文件存在的理由）。
  const cg = sectionOf('card-group');
  if (!cg || !cg.data) die('the generated page has no card-group block');
  const cgItems = cg.data.items;
  if (!Array.isArray(cgItems) || !cgItems.some((it) => Array.isArray(it && it.features) && it.features.length)) {
    die('card-group：演示内容里没有一项带 features ⟹ .card-group__features 一页都不进 DOM');
  }
  patched.push(`card-group ${cgItems.filter((it) => Array.isArray(it && it.features) && it.features.length).length}`
    + `/${cgItems.length} 项带 features → .card-group__features（内容来自演示内容包）`);
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

// ── ③ services.json 的 products（块的 data 管不到它）+ 够多的服务（#1320）─────────────────────
//
// 🔴 #1320 —— 服务的条数也补在这里，理由跟 products 那半完全一样：`services-nav` 的同级项是
//    `getServices(locale)` 一条一个链接（`ServicesNavSection.tsx` 第一行），**不是块自己的槽位**
//    （`gen-allblocks.js` 给这个块写的 `data` 是空对象）。而夹具站走 `create-site.js` 的 skipAI
//    路径建，那份 demo 配置只有 **1 条**服务（`create-site.js` §DEMO_CONTENT 的 `services:`）⟹
//    这个块在夹具页上只有一个同级项，而「横排条」那三条几何断言（同级项的 x 至少两个不同值、
//    375 下换行、每项不越界）**按构造一条都取不到读数**：一个项没有「至少两个不同值」可言。
//
// 🔴 补到「375 下一行放不下」为止，不是补到「有两条」为止。⑤ 那条断言的前件就是「项宽合计（含
//    项间 gap）超过容器 content-box 宽」—— 只补到两条的话前件不成立，那一维仍然一个字都不说，
//    而它看起来跟量过了一模一样。375 的容器内容宽是 327（375 - 两侧 24 的内边距），补完这三条
//    之后本机实测 azure-29 上四个链接合计 550 上下，余量足够两套主题的字体差异。
//
// 🔴 幂等：按 id 判在不在，不按条数。这个脚本对同一个站可能跑第二次（`--make-sample-site` 只在
//    站不存在时造站，但站在、脚本再跑一次是允许的），按条数判会一直往上堆。
const EXTRA_SERVICES = [
  { id: 'brake-repair', name: 'Brake Repair', shortDescription: 'Pads, rotors and fluid.' },
  { id: 'transmission-service', name: 'Transmission Service', shortDescription: 'Fluid, filter and pan gasket.' },
  { id: 'wheel-alignment', name: 'Wheel Alignment & Tire Balancing', shortDescription: 'Four-wheel alignment.' },
];
{
  const p = path.join(contentDir, 'services.json');
  if (!fs.existsSync(p)) die(`no ${path.relative(NEXT, p)}`);
  const services = readJson(p);
  if (!Array.isArray(services) || !services.length) die('services.json is not a non-empty array');
  let touched = false;
  if (!Array.isArray(services[0].products) || services[0].products.length === 0) {
    services[0].products = [{ name: 'Synthetic oil', description: 'Full synthetic, 5W-30.' }];
    touched = true;
  }
  // 形状照第一条现造的那一条抄（`create-site.js` 写的那个），只换 id / 名字 / 两句描述：夹具的
  // 形状要跟真站一样，多一个键少一个键都可能让别的块走到另一支。
  for (const extra of EXTRA_SERVICES) {
    if (services.some((s) => s.id === extra.id)) continue;
    services.push({
      ...services[0],
      id: extra.id,
      name: extra.name,
      shortDescription: extra.shortDescription,
      fullDescription: `${extra.name} — demo copy for the theme-css fixture.`,
      products: [],
    });
    touched = true;
  }
  if (touched) writeJson(p, services);
  patched.push('services.json service 1 has products → .services-list__products');
  patched.push(`services.json 共 ${services.length} 条服务（+${EXTRA_SERVICES.length}，#1320）→ `
    + 'services-nav 有足够多的同级项，375 下一行放不下');
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

// ── ⑤ 服务页也挂一条服务导航（#1327）─────────────────────────────────────────────────────────
//
// 🔴 检查 ⑩ 要的那一对（同一页上既有 `services-nav` 又有 `services-list`）在这个夹具站上此前
//    只出现在 /allblocks.html，而那一页的 navLabel 是空的、按构造不进任何一页的导航（上面 §② 那段
//    注释就是为此写的）⟹ 检查 ⑩ 里「从首页点链接走过去」那条臂**没有任何一页可走**，它会报
//    「这一轮什么都没量到」。而站内跳转正是 #1327 r3 漏掉的那个形状：next/link 换页不重新执行
//    layout 里那段量条高的脚本。夹具缺这一对，那条臂就永远说不出话。
//
// 🔴 补的是夹具缺的**真形状**，不是为了让检查变绿摆的姿势：`create-site.js:2185` 给模型的规矩
//    逐字是 `SERVICES pages must include: "page-header", "services-nav", "services-list", "cta-banner"`
//    —— 真站的服务页有这一对。而夹具站走 skipAI 那条路，根本不问模型、用写死的 demo 配置，那份
//    配置的服务页只有 page-header + services-list（本机现测）。
//
// 🔴 补在服务页而不是别处，是因为它的 navLabel 非空（`Services`）⟹ 首页页头真有一个链接指着它。
//    给 /allblocks.html 加 navLabel 是另一条路，上面 §② 已经把它判掉了（那会给每一页多一个链接，
//    改掉所有页面的读数）。
// 🔴 幂等：按块类型判在不在，重复跑不会堆第二条。
{
  const svc = path.join(pagesDir, `${SERVICE_SLUG}.json`);
  if (!fs.existsSync(svc)) die(`no ${path.relative(NEXT, svc)} — the demo site has no services page`);
  const sp = readJson(svc);
  const sbs = sp.sections || sp.blocks || [];
  if (!sbs.some((s) => s.type === 'services-list')) {
    die(`${path.relative(NEXT, svc)} has no services-list — the pair check ⑩ needs cannot be made here`);
  }
  if (!sbs.some((s) => s.type === 'services-nav')) {
    const listAt = sbs.findIndex((s) => s.type === 'services-list');
    // 排在 services-list 前面（真站的顺序：先条后列表），weight 取两者之间。
    const listWeight = Number(sbs[listAt].weight);
    const prevWeight = listAt > 0 ? Number(sbs[listAt - 1].weight) : listWeight - 10;
    sbs.splice(listAt, 0, {
      id: `${SERVICE_SLUG}-services-nav-fixture`,
      type: 'services-nav',
      role: 'essential',
      region: 'content',
      weight: Number.isFinite(listWeight) && Number.isFinite(prevWeight)
        ? (prevWeight + listWeight) / 2
        : listWeight,
      data: {},
    });
    if (sp.sections) sp.sections = sbs; else sp.blocks = sbs;
    writeJson(svc, sp);
  }
  patched.push(`page ${SERVICE_SLUG} 上补了 services-nav → 检查 ⑩ 那一对落在一个首页点得到的页面上（#1327）`);
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
  // 🔴 serviceSlug 两版都读回：它是必填槽，最少版照样写，而且**必须**是真 slug —— 合成值
  //    （`'ServiceSlug text'`）筛不到任何页面，组件 `return null`，整块不进 DOM。
  if (find('service-related-pages').data.serviceSlug !== SERVICE_SLUG) bad.push('serviceSlug did not stick');
  // #1333 —— 两版都读回：`.hero__form` / `.hero__form-error` / `.hero__form-success` 三个契约钩子
  // 全靠 `hero-with-form` 这个块进 DOM。它不在、或者它的 `form` 被削掉了 ⟹ 那三个钩子一页都没有，
  // 而那是上面那段说的 CI 红。两版都问，是因为最少版削的是可选槽而 `form` 是必填槽 —— 这句话要有人核。
  const hwf = find('hero-with-form');
  if (!hwf) bad.push('hero-with-form is not on the allblocks page — .hero__form* hooks would be on no page');
  else if (!hwf.data || typeof hwf.data.form !== 'object' || hwf.data.form === null) {
    bad.push(`hero-with-form has no data.form (${JSON.stringify(hwf.data && hwf.data.form)}) — on the MINIMAL page that would mean a required slot got trimmed`);
  }
  if (!MINIMAL) {
    if (find('gallery').data.items[2].imageUrl !== undefined) bad.push('gallery item 3 still has imageUrl');
    // 📌 #1341 —— 这里原来还有一条「hero 不许带 `block_layout`」（#1333 立的）。那个字段整条退役了
    //    （manifest 里没有清单、`blockAttrs` 不落属性、老站残留的键读的时候丢掉）⟹ 那条判据恒真，
    //    留着就是一格靠语料没了而绿的死判据。`.hero__form` 由 `hero-with-form` 这个块带进来这件事，
    //    上面那两条（块在不在 · `data.form` 是不是对象）仍然在问。
  } else {
    // 🔴 最少版自己的读回，两个方向都问 —— 「削过了」和「一个字节都没削」在只问前半句时长得一样。
    //    ① 可选槽位真的**不存在**（不是空串）· ② 必填列表槽真的只剩一项 · ③ 那五处 propping 真的没写进去。
    for (const sec of back.sections || back.blocks || []) {
      const mf = path.join(BLOCKS_DIR, `${sec.type}.json`);
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
    // 🔴 #1383 —— 这条断言**翻了个方向**。它原来问的是「最少版不许带 features」，守的是
    //    「全填版那次【整条覆盖 items】没有漏进最少版」；而那次覆盖本票已经删掉了（两臂内容
    //    同出一个演示内容包），于是那个问题按构造不可能发生 —— 一条问不出坏的断言，就是一格
    //    靠语料没了而绿的死判据（同 :531 那段 #1341 划掉 `block_layout` 的理由）。
    //    现在问的是**还剩的那件真事**：最少版那一张卡真的带上了 features，所以
    //    `.card-group__features` 在这一臂上真的有人量。上面那句 `patched` 说的就是它，这里读回。
    const cgMin = find('card-group');
    const cgMinItems = cgMin && cgMin.data && cgMin.data.items;
    if (!Array.isArray(cgMinItems) || !cgMinItems.some((i) => Array.isArray(i && i.features) && i.features.length)) {
      bad.push('card-group: the one card in the minimal version carries no features — '
        + '.card-group__features goes unmeasured on this arm (#1383)');
    }
  }
  // #1060 —— 两个方向都读回来：第 1 条真的开着，而第 2 条真的还关着。只问前半句的话，
  // 「全部开着」跟「只开了第一条」在这里长得一样，而那两种情况对 #1056 那条豁免的意思相反。
  if (!MINIMAL) {
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
    // 🔴 `features` 只在全填版问 —— 最少版**有意**不补它（上面 skipped 里逐条点了名）。
    else if (!MINIMAL && (!Array.isArray(it[0].features) || !it[0].features.length)) bad.push('card-group item 1 has no features → .card-group__features would be on no page');
  }
  const svc = readJson(path.join(contentDir, 'services.json'));
  if (!Array.isArray(svc[0].products) || !svc[0].products.length) bad.push('services.json products is still empty');
  // #1320 —— 读回「盘上现在真的有那几条服务」。只问「条数 > 1」的话，别的改动把它们换成别的名字
  // 时这里照样绿，而 services-nav 那三条几何断言的前件是**项有多宽**，跟是哪几条服务直接相关。
  for (const extra of EXTRA_SERVICES) {
    if (!svc.some((s) => s.id === extra.id && s.name === extra.name)) {
      bad.push(`services.json has no service "${extra.id}" (${extra.name}) — services-nav would be too `
        + 'narrow on the fixture page and the row-shape assertions would have nothing to measure (#1320)');
    }
  }
  // #1327 —— 读回两半，因为它们各自都能单独坏掉，而只问前半句时两种坏法长得一样：
  //   ① 服务页上那一对（services-nav + services-list）真的都在盘上；
  //   ② 那一页真的进得了导航（navLabel 非空）—— 检查 ⑩ 的软导航臂走的是首页上的链接，
  //      navLabel 一空，那一对还在而那条臂又没路可走了。
  {
    const sp = readJson(path.join(pagesDir, `${SERVICE_SLUG}.json`));
    const types = (sp.sections || sp.blocks || []).map((s) => s.type);
    for (const t of ['services-nav', 'services-list']) {
      if (!types.includes(t)) bad.push(`the ${SERVICE_SLUG} page has no "${t}" — check ⑩ needs both on one page (#1327)`);
    }
    if (!sp.navLabel) {
      bad.push(`the ${SERVICE_SLUG} page has an empty navLabel — nothing on the home page would link to it, `
        + "and check ⑩'s click-through arm would have nowhere to go (#1327)");
    }
  }
  const childPath = path.join(pagesDir, `${SERVICE_SLUG}-oil-change.json`);
  if (!fs.existsSync(childPath) || readJson(childPath).slug !== `${SERVICE_SLUG}/oil-change`) {
    bad.push('the services/oil-change page is not on disk');
  }
  if (bad.length) die(`read-back failed: ${bad.join(' · ')}`);
}

for (const p of patched) console.log(`  sample site: ${p}`);
// 🔴 最少版少做的每一件事逐条印出来（AC5 的第一份名单）。「这一类 0 条」也要印 —— 印不出来
//    跟做过了长得一模一样，而这正是本票要治的形状。
if (MINIMAL) {
  for (const p of pruned) console.log(`  sample site (最少版): ${p}`);
  if (skipped.length) {
    for (const p of skipped) console.log(`  sample site (最少版跳过): ${p}`);
  } else {
    console.log('  sample site (最少版跳过): 0 条 —— 上面 ② 段一处 propping 都没有被版本关掉，'
      + '这跟「这一版忘了做削减」长得一样，去看 ② 段');
  }
  console.log(`  sample site (最少版): 跳过 ${skipped.length} 处 propping · 削了 ${pruned.length} 个块`);
}
