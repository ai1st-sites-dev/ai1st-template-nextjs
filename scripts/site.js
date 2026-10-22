#!/usr/bin/env node
'use strict';
// #1802 / #1801 —— 站点脚本的命令行入口（设计文档 §3：`site.js <命令> …`）。#1802 加了 `render` 和它要的 `bundle`，#1801 加了编辑器那四条（下面）。
//
//   node scripts/site.js render-catalog --out <目录> [--build-version <v>]
//       #1828 发版检查：块图册的每个 (块, 形态)（`blocks/<块>/<形态>/shape.css` 的全集，§block-catalog.js blockShapeCatalog）用演示数据
//       渲一张 `<out>/<块>/<形态>/index.html`（dashboard 的 `/admin/catalog/<块>/<形态>` 画的是同一份：`src/lib/catalog/cell.ts` +
//       `CatalogCell`）。有一格渲不出来（块组件抛错 / 画出来不带 `data-block="<块>"`）⟹ 退出码 1，标准错误每格一行。产物不传 R2。
//       🔴 每次现打一份 bundle（模板树里的临时目录，跑完删）：拿 `render/dist` 里一份旧包来判，读到的是旧源码。
//       标准输出：一行 `{"event":"catalog-rendered","cells":N,"failed":M,"ms":…}`。
//
//   node scripts/site.js bundle [--out-dir <dir>] [--blocks-dir <dir> --registry <file>]
//       打 `render/dist/`：整页渲染的 bundle + 平台文件（带内容哈希的三份样式表 + runtime）+ manifest。`render` 发现没打过会先打一次。
//       --blocks-dir / --registry（#1838，测试专用）：`@blocks/*` 指到另一份块目录、块注册表换成另一份（`build-blocks.js
//       --blocks-dir --out` 生成的；它旁边的 shapes.css / base.css 一起用）。拿这份包 `render --bundle-dir` 时要带同一对
//       `AI1ST_BLOCKS_DIR` / `AI1ST_REGISTRY_PATH`（入口按块目录判认不认识，§lib/block-paths.js）。
//
//   node scripts/site.js render --site <站 JSON> --out <目录> [选项]
//       站 JSON 进、整套静态网页出：每页 `index.html`、`404.html`、`sitemap.xml`、`robots.txt`、`llms.txt`、`theme.css`、`custom.css`，
//       模板自带的 `public/images/**`，给了 IndexNow key 时还有 `<key>.txt`。
//       --site-id <id>        覆盖 `site_meta.json` 的 siteId（线索表单、聊天小部件的 `?site=` 都取它）。没给才用 site_meta 的。
//       --geo <JSON | 文件>   `sites.geo`：一组 `[{address, lat, lng, …}]`（#1976；老的单个 `{lat, lng, address}` 当一项）。
//                             哪个地点的 address 跟某一项一样，那一项的 lat/lng 并进它的 geo（`lib/locations.js` §mergeGeo）。
//       --site-url <地址>     这次发布到的站点根地址（canonical / og:url / sitemap / robots 都用它；绑了自定义域名就是那个域名）。
//       --lead-api <地址>     线索表单 + 聊天小部件打的 manager 地址。
//       --gsc-token <值>      Search Console 验证 meta。🔴 `seo.json` 里那份（建站写的是占位值 YOUR_GOOGLE_VERIFICATION_CODE）一律不用。
//       --indexnow-key <key>  写 `<key>.txt`（内容就是 key；跟 worker/indexnow.go §indexNowKeyFile 同一个规矩，不合格式就不写）。
//       --version <N>         每页 `<meta name="ai1st-version" content="vN">`。
//       --build-version <v>   平台 build 版本，进 site.css 的缓存键（T2a-1 §siteCssKey）。
//       --target live|preview preview：site.css 不剪、整站 noindex、robots.txt 全禁、不出 sitemap.xml。默认 live。
//       --cache-dir <目录>    site.css 按缓存键缓存在这里（命中就不编 Sass）。不给 = 不缓存、每次都编。
//                             🔴 缓存键里有 `--build-version`：平台发版换模板之后要换一个值，否则命中的是旧模板编出来的那份。
//       --last-modified <JSON | 文件>  `{ "<站内相对路径>": ISO 时间 }`，sitemap 的 <lastmod>（T2c 从 site_versions 取）。不给 = 渲染时刻。
//       --platform-out <目录> 把这个站要的平台文件（三份样式表、runtime、它的 site.css）拷到这里，按 `_platform/…` 的路径。
//                             不给就不拷，站的输出目录里没有它们。#1826：manager 每次渲染都给它，拿回来的每份按名字 Head 一次、
//                             R2 上缺哪份补传哪份（manager/site_render.go §uploadMissingPlatformFiles）—— 平台文件不另由 deploy 传。
//       --bundle-dir <目录>   用这一份 bundle（`bundle --out-dir` 打的；必须在模板树里，react 这些包按它的位置解析）。不给 = render/dist。
//       --only-blocks <id,id> #1826：只画这几个块（T4d 自愈用旧包画一个新包已不认识的块）。🔴 输出合同从第一份包起定死，改不得：
//                             `<out>/blocks/<语言>/<块 id>.html`（`<section>` 里面那段）+ 同名 `.css`（这个块类型在 shapes.css 里
//                             那一段：生成的网格 / 图位 / 块头规则 + block.css + 各形态 shape.css）+ 同名 `.attrs.json`（`<section>`
//                             容器自己的属性）；同一个 id 在几种语言里都有就每种语言一份。不编 Sass、不扫不认识的块（别的块
//                             这份包不认识也照画这几个）；页面数据仍由派生组出来（派生对不认识的块只警告）。没找到的 id ⟹ 退出码 1。
//       --freeze-from <JSON | 文件>  #1840（T4d 自愈）：`[{type, rendered, ids, label?}]` —— 这几块在入口扫描之前先在内存里换成
//                             Custom HTML（`rendered` = 一份旧包按 `--only-blocks` 画出来的目录，转换同 `freeze`）。不写库；没换成的块
//                             照样被入口扫描报出来（退出码 3）。标准输出那一行多一个 `frozen: ["<类型>#<块 id>", …]`。
//     标准输出：一行 JSON（`{"event":"rendered", …}`，含页数、平台文件清单、耗时）。派生的日志走标准错误。
//     失败 ⟹ 退出码 1；content 里有这份包画不出来的块 ⟹ 退出码 3，`--out` 一个文件都不写，标准错误每块一行
//       `unknown block type <t> at <文件>#<块 id>` / `unsupported schemaVersion <n> of <t> at <文件>#<块 id>`（§content-blocks.js）。
//     🔴 `--out` 由调用方每次 mkdtemp 新建（#1802 终审：预置的软链会顺着写到外面去、残留文件会混进产物）；`--site` 给文件路径，
//       不内联（单个 argv 上限 128 KiB）。两者带 `.` / `..` / 空段的一律拒（路径要原样就是它自己）。
//
// #1801（T1）—— 编辑器那几条，manager spawn（工作目录 = 平台那份模板，`template.dir`），实现在 `lib/site-editor.js`：
//   node scripts/site.js editor-data --site <站 JSON> [--geo <JSON>] [--locale <语言>] [--page <slug>] [--theme <id>] [--cache-dir <目录>] [--build-version <v>]
//       --geo 是 `sites.geo`，按地址并进各地点的规矩同上面 render 的 --geo。
//       --theme（#1874）：content 先在内存里穿上那一套（同 `theme` 那条的换装，不写库）再算 —— 只读画布按 `?theme=` 画用。
//       编辑器的初始 props + 画布样式（theme.css / custom.css）+ site.css 的缓存键。`--site` 的内容是 null ⟹ {"ok":true,"content":null}。
//       --ui-flags（#1839）：`sites.ui_flags`。输出多两样：`pendingUpgrades`（样子会变的待升级块）、`pendingRetired`（冻结过、
//       ui_flags.frozenAcknowledged 里还没有的块），整站算（§lib/block-changes.js pendingChangesOf）。
//   node scripts/site.js save --site <站 JSON> --changes <编辑器那一笔> [--keep] [--migrate <块 id,…>]
//       {"ok":true,"content":{…},"summary":"…","files":[…],"hash"?,"notice"?,"shared"?,"addressChanged"?,"upgraded"?,"reason"?}
//       --migrate（#1839，老板点了 Update）：套完这一笔之后，这几块（只认还待升级的）整条链迁到新版；迁了 ⟹ `reason`
//       = `upgrade-<类型>`、`summary` = "Updated the <Type> block to its latest version"。changes 可以只有 page / locale。
//   node scripts/site.js migrate --site <站 JSON> --dry-run --only <块 id,…>
//       #1839：升级弹窗的「后」。{"ok":true,"content":{…},"migrated":[…]}，不落库；不带 --dry-run 一律 bad。
//   node scripts/site.js freeze --site <站 JSON> --type <块类型> [--bundle-dir <目录>] [--rendered <目录>] [--ids <块 id,…>] [--label <名字>]
//       #1840：--rendered = 那几块已经由一份还认识这个类型的旧包按 `--only-blocks` 画好（manager 从 archives/ 解的），这里只转换、
//       不画；--ids = 只冻这几块；--label = 弹窗 / summary 里的名字（类型在这份包里已删时，从旧包的 manifest 取）。
//       #1839：那一型的块冻成 Custom HTML（用这份模板按 --only-blocks 画一次，`<style>` + `<section>` 里那段 + 容器属性 `attrs`）。
//       {"ok":true,"content":{…},"frozen":[id…],"label":"…","summary":"Kept the <Type> block as it was"}；没有这一型 ⟹ frozen 空、
//       content 原样。包：--bundle-dir，没给看 AI1ST_BUNDLE_DIR（测试专用），都没有 = render/dist。manager 执行器 kind=freeze spawn。
//   node scripts/site.js theme --site <站 JSON> [--theme <id>] [--tweaks <JSON>] [--presets <JSON>] [--color-scheme light|dark|auto]
//       #1873：换主题 / Customize 的 Apply（manager 执行器 `kind=theme` spawn，实现 `lib/site-editor.js` §theme）。
//       {"ok":true,"content":{…},"summary":"Changed the theme to <名字>" | "Adjusted the theme colors","files":[…]}
//       四样至少给一样；主题不在注册表里 ⟹ ok:false + code bad。
//   node scripts/site.js site-css --site <站 JSON> [--theme <id>] [--cache-dir <目录>] [--build-version <v>]
//       {"ok":true,"key":"…","cached":true|false,"css":"…"}（不剪，画布用）
//       --theme（#1874 试穿）：主色取那套主题的 `primary['500']`、不套站上 custom.css 的色相旋转，文字方向仍是这个站的。
//   node scripts/site.js theme-css --site <站 JSON> [--theme <id>] [--cache-dir <目录>] [--build-version <v>]
//       #1874（T3c-3）：只出 theme.css —— content 在内存里穿上那一套（`lib/site-editor.js` §dressContent，跟 `theme` 的 Apply
//       同一个函数）再派生。试穿、只读画布共用。{"ok":true,"css":"…"}；主题不在注册表里 ⟹ ok:false + code bad。
//   node scripts/site.js geocode --address <地址>
//       {"ok":true,"address":"…","lat":…,"lng":…}（查不到 lat / lng 是 null）
//       #1826：manager 改地址时排 `kind=geocode` 任务调它（site_render.go §runSiteGeocode）。每次是一个新进程，`lib/geocode.js`
//       进程内的 1.1 秒节流管不到别的进程 ⟹ 跨站的间隔由 manager 那一把锁管（§takeGeocodeTurn）。lat 为 null ⟹ manager 把
//       sites.geo 清掉：地址改了，钉子不能还扎在老地方。
//   node scripts/site.js catalog-site-css --theme <主题 id> [--cache-dir <目录>] [--build-version <v>]
//       #1828：块图册用的 site.css —— 按**主题**（不按站）编：那套主题的 `colors`（`$primary` = `primary['500']`）、ltr、不剪，
//       走 `derive-core.js` §buildSiteCssCached（同一个 `siteCssKey` 缓存）。{"ok":true,"key":"…","cached":…,"css":"…","theme":"<id>"}
//       主题不在池里 ⟹ ok:false + code bad。manager `GET /api/admin/catalog/site.css?theme=` spawn 它。
//       📌 不走上面那条 `site-css`：它跑整站 `deriveSite`，喂一份只带配色的站 JSON 会被拒（`Required file missing: site/seo.json`）。
//   node scripts/site.js location-pages --site <站 JSON> [--skip-ai] [--model <id>]
//       #1979（T4，T5 的 manager 改地点后调）：两个及以上地点的地点总览页 + 每家一页 + 菜单一项 + 首页一块；不到两家 ⟹ 删掉这些
//       （规则全在 `lib/location-pages.js` 文件头）。只给还缺地点页的那几家调一次 AI 写介绍；--skip-ai 用代码那一句。
//       {"ok":true,"patch":{"<相对路径>": 整份文件 | null（删掉）},"usage":{"model":…|null,"inputTokens":N,"outputTokens":N},"aiError"?:"…"}
//       `usage` 是这一次 AI 的 token 数（没调 ⟹ 0 / 0），钱由 manager 按 model_pricing.go 算（同 seo-refresh 的 ai-usage）。
//       补丁里新块已盖当前 schemaVersion。--site 读不了（没有这个文件 / 不是 JSON / 没有 brand.json）⟹ ok:false + code bad。
//   这几条（#1839 起含 migrate / freeze）的输出约定跟上面 bundle / render **不一样**（manager 按 `ok` + `code` 定 HTTP 状态，`site_editor.go` §writeSiteScriptError）：
//     成功          标准输出一行 {"ok":true, …}                                  退出码 0
//     拒收 / 不合法  标准输出一行 {"ok":false,"code":"refused|bad|stale","message":"…","field"?}   退出码 3
//                   （`field`：这一笔里有编辑器改不了的字段时，那个字段名）
//     崩了          标准错误里的堆栈                                              退出码 1
//   `--site` / `--changes`：内联 JSON，或一个文件路径（manager 传文件：一个参数在 Linux 上最多 128 KB）。
//
// #1829（T3a）—— 建站，manager 的执行器 `kind=create` 时 spawn（实现在 `lib/site-create.js`，那份文件头有完整约定）：
//   node scripts/site.js create --out-dir <目录>      标准输入：建站 payload（create-site.js 读的那一份）
//       标准输出：create-site.js 的 JSON-lines 原样转出，跑完再加 `build-report` 和最后一行
//       `{"event":"created","result":"<目录>/result.json","files":N}`（result.json = `{"content":{…}}`，已套菜单同步 + custom.css
//       + stampSchemaVersions）。照片在 `<目录>/photos/`、logo 在 `<目录>/logo.png`。失败 ⟹ 退出码非 0（`error` 事件已发）。
//       --out-dir 由 manager 每次 mkdtemp 新建；Resume 时 manager 先把阶段内容写进 `<目录>/site/`。
//
// #1830（T3b）—— AI 改站，manager 的执行器 `kind=ai-edit` 时 spawn（实现在 `lib/site-edit.js`，那份文件头有完整约定）：
//   node scripts/site.js edit --site <站 JSON 文件> --message <老板那句话> [--scope <JSON>] --out-dir <目录>
//       标准输入：这一轮其余的载荷（siteId / conversationHistory / images / model / maxTokens / uploadsDomain）。
//       --scope：`{page, locale?, blockId?, blockIndex?, region?}`（「让 AI 改这一块」/ #1791 顶栏页脚）。
//       标准输出：edit-site.js 的 JSON-lines 原样转出；这一轮改成了东西 ⟹ 在 edit-complete 之前多一行
//       `{"event":"edited","result":"<目录>/result.json","files":[…],"summary":"…"}`（result.json = `{content, summary, geo?}`，
//       已过 validate）。校验不过 ⟹ 那条 edit-complete 换成一条 `error`。退出码同 edit-site.js。
//   node scripts/site.js validate --prev <站 JSON> --next <站 JSON> [--scope <JSON>]
//       上面那一步单独拿出来（输出约定同编辑器那几条）：{"ok":true,"content":{…},"files":[…],"geo"?} / ok:false + refused。
//
// #1938 —— 一页的 title / description 自动维护，manager 的执行器 `kind=seo-refresh` 时 spawn（实现在 `lib/seo-refresh.js`，那份
//   文件头有完整约定）：
//   node scripts/site.js seo-refresh --site <站 JSON 文件> --before <站 JSON 文件> --locale <l> --page <slug|home> [--force] [--skip-ai] --out-dir <目录>
//       标准输入：建站表格（地点 / 行业 / 事实出处）。最后一行 `{"event":"seo-refresh", "result"?: "<目录>/result.json", "skipped"?: …}`。
//
// #1999 —— 建站之后再加一种语言，manager 的执行器 `kind=add-locale` 时 spawn（实现在 `lib/add-locale.js`，那份文件头有完整约定）：
//   node scripts/site.js add-locale --site <站 JSON 文件> --locale <语言> [--brand-name <这个语言的店名>] --out-dir <目录>
//       标准输入：建站表格（行业 / model）。标准输出：`ai-usage` · `add-locale-progress {done, total}`（按页）· 最后一行
//       `{"event":"add-locale","result":"<目录>/result.json",…}`（result.json = 只有新增的文件 + 品牌名 / 标语两格），
//       或 `{"event":"add-locale-failed","message":"…","where":"…"}` + 退出码 1。主语言那一份不在产物里。
//
// 🔴 渲染只读不写：拿到的 content 不回写（菜单同步、custom.css 的补丁只用在这一次的输出里，设计文档 §6.1「渲染任务只读库」）。
const fs = require('fs');
const os = require('os');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const { DEFAULT_OUTDIR } = require('./lib/render-bundle');

// 不带值的开关（`save --keep`、#1839 `migrate --dry-run`、#1938 `seo-refresh --force / --skip-ai`、#1979 `location-pages --skip-ai`）。不登记在这里的 `--x` 一律要跟一个值。
const BOOLEAN_FLAGS = new Set(['keep', 'dry-run', 'force', 'skip-ai']);
// #1830 —— 值是老板打的字（`edit --message`）：它自己就可能以 `--` 开头，下一个参数原样就是它的值。
// #1999 —— `add-locale --brand-name`：老板填的店名，同理。
const FREE_TEXT_FLAGS = new Set(['message', 'brand-name']);

function parseArgs(argv) {
  const out = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith('--')) { out._.push(a); continue; }
    const key = a.slice(2);
    if (BOOLEAN_FLAGS.has(key)) { out[key] = true; continue; }
    const val = argv[i + 1];
    if (val === undefined || (val.startsWith('--') && !FREE_TEXT_FLAGS.has(key))) throw new Error(`${a} 后面要跟一个值`);
    out[key] = val;
    i += 1;
  }
  return out;
}

/** 内联 JSON 或一个文件路径。没给 ⟹ undefined（render 的 --geo / --last-modified 是可选的）；编辑器那几条要必给的用 `requiredJsonArg`。 */
function jsonArg(v, name) {
  if (v === undefined) return undefined;
  const text = /^\s*([{[]|null\s*$)/.test(v) ? v : fs.readFileSync(v, 'utf-8');
  try { return JSON.parse(text); } catch (e) { throw new Error(`--${name} 不是合法 JSON：${e.message}`); }
}

function requiredJsonArg(v, name) {
  if (v === undefined) throw new Error(`要给 --${name}`);
  return jsonArg(v, name);
}

// #1801 —— 编辑器那四条 + #1828 图册的 catalog-site-css + #1873 的 theme + #1874 的 theme-css（输出约定见文件头）。
const EDITOR_COMMANDS = {
  'editor-data': (a, ed) => ed.editorData({ content: requiredJsonArg(a.site, 'site'), geo: jsonArg(a.geo, 'geo'), locale: a.locale, page: a.page, themeId: a.theme, cacheDir: a['cache-dir'], buildVersion: a['build-version'], uiFlags: jsonArg(a['ui-flags'], 'ui-flags') }),
  save: (a, ed) => ed.save({ content: requiredJsonArg(a.site, 'site'), changes: requiredJsonArg(a.changes, 'changes'), keep: !!a.keep, migrate: idList(a.migrate) }),
  theme: (a, ed) => ed.theme({ content: requiredJsonArg(a.site, 'site'), themeId: a.theme, tweaks: jsonArg(a.tweaks, 'tweaks'), presets: jsonArg(a.presets, 'presets'), colorScheme: a['color-scheme'] }),
  'site-css': (a, ed) => ed.siteCss({ content: requiredJsonArg(a.site, 'site'), themeId: a.theme, cacheDir: a['cache-dir'], buildVersion: a['build-version'] }),
  'theme-css': (a, ed) => ed.themeCss({ content: requiredJsonArg(a.site, 'site'), themeId: a.theme, cacheDir: a['cache-dir'], buildVersion: a['build-version'] }),
  geocode: (a, ed) => ed.geocode({ address: a.address }),
  validate: (a) => require('./lib/site-edit').validate({ prev: requiredJsonArg(a.prev, 'prev'), next: requiredJsonArg(a.next, 'next'), scope: jsonArg(a.scope, 'scope') || null }),
  'catalog-site-css': (a, ed) => catalogSiteCss({ theme: a.theme, cacheDir: a['cache-dir'], buildVersion: a['build-version'] }, ed),
  migrate: (a, ed) => migrateDryRun({ content: requiredJsonArg(a.site, 'site'), only: idList(a.only), dryRun: !!a['dry-run'] }, ed),
  'location-pages': (a, ed) => locationPages(a, ed),
  freeze: (a, ed) => freeze({
    content: requiredJsonArg(a.site, 'site'), type: a.type, bundleDir: a['bundle-dir'],
    rendered: a.rendered, ids: a.ids === undefined ? undefined : idList(a.ids), label: a.label,
  }, ed),
};

/** #1979 —— `location-pages`：库那一侧的「读不了 / 不合法」换成编辑器那几条的 bad（退出码 3、一行 JSON），别的照常冒上去。 */
async function locationPages(a, ed) {
  const lp = require('./lib/location-pages');
  try {
    return await lp.locationPagesCommand({ site: a.site, skipAI: !!a['skip-ai'], model: a.model });
  } catch (e) {
    if (e instanceof lp.LocationPagesError) throw new ed.SiteEditorError(e.code, e.message);
    throw e;
  }
}

/** `--migrate a,b` / `--only a,b` → 去空的 id 数组；没给 ⟹ []。 */
function idList(v) {
  return typeof v === 'string' ? v.split(',').map((x) => x.trim()).filter(Boolean) : [];
}

/**
 * #1839 —— `migrate --dry-run --only <ids>`：升级弹窗的「后」。只迁 `ids` 里还待升级的那几块（§block-changes.js migrateBlocks，
 * 样子会变的那几步也跑），不落库。没有 `--dry-run` 一律拒：落库只走保存那一笔（`save --migrate`），这里没有第二条写路。
 */
async function migrateDryRun({ content, only, dryRun }, ed) {
  if (!dryRun) throw new ed.SiteEditorError('bad', 'migrate 只有 --dry-run（真迁走 save --migrate）');
  if (!only.length) throw new ed.SiteEditorError('bad', '要给 --only <块 id,…>');
  if (content === null || typeof content !== 'object' || Array.isArray(content)) throw new ed.SiteEditorError('bad', '--site 要是一份 content 对象');
  const r = require('./lib/block-changes').migrateBlocks(content, only);
  return { content: r.content, migrated: r.migrated };
}

/**
 * #1839 —— `freeze --type <t>`：把一份 content 里那一型的块冻成 Custom HTML（设计文档 §8.2 ③ / §8.3）。用这份模板（还认识 t 的
 * 旧代码）按 `--only-blocks` 画一次那几块，切出来的 `<section>` 里面那段 + 那一型的样式 + 容器属性写成 Custom HTML 块
 * （§block-changes.js freezeContent）。不连库：哪些站要冻、写版本，都是 manager 的事（`-freeze-type` 排队、执行器 kind=freeze 提交）。
 * 这份 content 里没有这一型 ⟹ `frozen: []`、content 原样（执行器据此不写版本）。有块画不出来 ⟹ 整个拒（不写半份）。
 */
async function freeze({ content, type, bundleDir, rendered: renderedDir, ids: onlyIds, label }, ed) {
  if (typeof type !== 'string' || !/^[a-z0-9][a-z0-9-]*$/.test(type)) throw new ed.SiteEditorError('bad', `--type 要是一个块类型：${JSON.stringify(type)}`);
  if (type === 'custom-html') throw new ed.SiteEditorError('bad', 'custom-html 本身就是冻结的形状，不能再冻');
  if (content === null || typeof content !== 'object' || Array.isArray(content)) throw new ed.SiteEditorError('bad', '--site 要是一份 content 对象');
  const changes = require('./lib/block-changes');
  const all = changes.blockIdsOfType(content, type);
  const ids = onlyIds ? all.filter((id) => onlyIds.includes(id)) : all;
  if (!ids.length) return { content, frozen: [], summary: '', label: label || changes.labelOf(require('./lib/block-migrations').loadBlockVersions(), type) };
  // #1840 —— `--rendered <目录>`：那几块已经由一份旧包（manager 从 archives/ 解出来的、还认识这个类型的那一份）按
  //   `--only-blocks` 画好了，这里只做转换、不画 —— 这份包已经不认识这个类型，自己画只会画出空的。
  if (renderedDir !== undefined) {
    checkPathArg('rendered', renderedDir);
    return freezeFromRendered(content, { type, rendered: renderedDir, ids, label }, ed);
  }
  const out = fs.mkdtempSync(path.join(os.tmpdir(), 'site-freeze-'));
  try {
    // 包：`--bundle-dir`，没给看 `AI1ST_BUNDLE_DIR`（测试专用，同 AI1ST_BLOCKS_DIR 那一对：manager 的测试 spawn 不带参数），都没有 = render/dist。
    const bundleAt = bundleDir || process.env.AI1ST_BUNDLE_DIR;
    await render({ content, out, onlyBlocks: ids, ...(bundleAt ? { bundleDir: path.resolve(bundleAt) } : {}) });
    return freezeFromRendered(content, { type, rendered: out, ids: onlyIds ? ids : undefined, label }, ed);
  } finally {
    fs.rmSync(out, { recursive: true, force: true });
  }
}

/** `render --only-blocks` 的产物（输出合同见文件头）读回来：`<locale>/<id>` → { html, css, attrs }，外加有哪几种语言。 */
function readRenderedBlocks(out) {
  const rendered = new Map();
  const dir = path.join(out, 'blocks');
  const locales = fs.existsSync(dir) ? fs.readdirSync(dir).sort() : [];
  for (const locale of locales) {
    for (const f of fs.readdirSync(path.join(dir, locale))) {
      if (!f.endsWith('.html')) continue;
      const id = f.slice(0, -'.html'.length);
      const base = path.join(dir, locale, id);
      rendered.set(`${locale}/${id}`, {
        html: fs.readFileSync(`${base}.html`, 'utf-8'),
        css: fs.existsSync(`${base}.css`) ? fs.readFileSync(`${base}.css`, 'utf-8') : '',
        attrs: JSON.parse(fs.readFileSync(`${base}.attrs.json`, 'utf-8')),
      });
    }
  }
  return { rendered, locales };
}

/**
 * 一份画好的 `--only-blocks` 产物 → 那一型（给了 ids 就只那几块）冻成 Custom HTML（§block-changes.js freezeContent）。
 * `ed` 给了（freeze 命令）⟹ 有块没画出来整个拒；没给（render --freeze-from）⟹ 回 missing，没冻的块留给入口那一遍扫描去报。
 */
function freezeFromRendered(content, { type, rendered: dir, ids, label }, ed) {
  const { rendered, locales } = readRenderedBlocks(dir);
  const r = require('./lib/block-changes').freezeContent(content, type, rendered, undefined, { defaultLocale: locales[0] || 'en', ids, label });
  if (ed && r.missing.length) throw new ed.SiteEditorError('bad', `这几块画不出来，没冻：${r.missing.join(', ')}`);
  return { content: r.content, frozen: r.frozen, missing: r.missing, label: r.label, summary: `Kept the ${r.label} block as it was` };
}

/** #1828 —— 图册按主题编的 site.css（见文件头）。 */
async function catalogSiteCss({ theme, cacheDir, buildVersion = '' }, ed) {
  const pool = require('./theme-pool.json');
  if (typeof theme !== 'string' || !Object.prototype.hasOwnProperty.call(pool, theme)) {
    throw new ed.SiteEditorError('bad', `--theme 不是池里的主题：${JSON.stringify(theme)}（池里有 ${Object.keys(pool).join(' / ')}）`);
  }
  const { buildSiteCssCached } = require('./lib/derive-core');
  const r = await buildSiteCssCached({ brand: { colors: pool[theme].colors }, rootDir: ROOT, dir: 'ltr', purge: false, customHtml: [], buildVersion, cacheDir });
  return { key: r.key, cached: Boolean(r.cached), css: r.css, theme };
}

/** 跑一条编辑器命令，返回退出码（0 / 3 / 1）。参数解析的错也算「不合法」⟹ ok:false + 3，manager 照样拿得到一行 JSON。 */
async function runEditorCommand(cmd, rest) {
  const ed = require('./lib/site-editor');
  try {
    const out = await EDITOR_COMMANDS[cmd](parseArgs(rest), ed);
    process.stdout.write(`${JSON.stringify({ ok: true, ...out })}\n`);
    return 0;
  } catch (e) {
    if (e instanceof ed.SiteEditorError) {
      process.stdout.write(`${JSON.stringify({ ok: false, code: e.code, message: e.message, ...(e.field ? { field: e.field } : {}) })}\n`);
      return 3;
    }
    if (e instanceof Error && /^--|后面要跟一个值|不是合法 JSON|要给 --/.test(e.message)) {
      process.stdout.write(`${JSON.stringify({ ok: false, code: 'bad', message: e.message })}\n`);
      return 3;
    }
    process.stderr.write(`${e && e.stack ? e.stack : e}\n`);
    return 1;
  }
}

const parsed = (content, rel) => (typeof content[rel] === 'string' ? JSON.parse(content[rel]) : content[rel]);

async function bundle(dir = DEFAULT_OUTDIR, { blocksDir, registryPath } = {}) {
  return require('./lib/render-bundle').buildRenderBundle({ outdir: dir, blocksDir, registryPath });
}

function loadBundle(dir) {
  const manifestFile = path.join(dir, 'manifest.json');
  return { manifest: JSON.parse(fs.readFileSync(manifestFile, 'utf-8')), render: require(path.join(dir, 'render.cjs')) };
}

function copyTree(src, dst) {
  if (!fs.existsSync(src)) return 0;
  let n = 0;
  for (const e of fs.readdirSync(src, { withFileTypes: true })) {
    const s = path.join(src, e.name);
    const d = path.join(dst, e.name);
    if (e.isDirectory()) n += copyTree(s, d);
    else { fs.mkdirSync(dst, { recursive: true }); fs.copyFileSync(s, d); n += 1; }
  }
  return n;
}

/**
 * 渲染一个站。命令行和测试都调它。返回 `{ pages, files, platform, siteCssKey, ms }`。
 * `content` 是「库里一行 JSON」的形状（键 = site/ 下的相对路径，`export-site-json.js`）。
 */
class UnrenderableContentError extends Error {
  constructor(problems) {
    super(problems.join('\n'));
    this.problems = problems;
  }
}

async function render({
  content: input, out, siteId, geo, siteUrl, leadApi, gscToken, indexnowKey, version = 0, buildVersion = '',
  target = 'live', cacheDir, lastModified = {}, platformOut, bundleDir = DEFAULT_OUTDIR, onlyBlocks, freezeFrom,
}) {
  const t0 = Date.now();
  if (target !== 'live' && target !== 'preview') throw new Error(`--target 只认 live / preview：${JSON.stringify(target)}`);
  if (!out) throw new Error('要给 --out');
  // #1838 —— 读的时候内存里全量迁（只跑 `preservesLook: true` 的，§block-migrations），不落库：老站的 v1 块按新版画。
  let content = { ...require('./lib/block-migrations').migrateInMemory(input) };
  // #1840 (T4d 自愈) —— `--freeze-from`：这份包画不出来的那几块，manager 已经拿还认识它们的旧包画好了（`--only-blocks`），
  //   这里在内存里把它们换成 Custom HTML 再往下画（设计文档 §8.3「只在内存里冻、不写库、不重跑」）。没换成的块原样留着，
  //   下面那一遍扫描照样报它 ⟹ 退出码 3，跟没有自愈时一样。
  const frozen = [];
  for (const f of Array.isArray(freezeFrom) ? freezeFrom : []) {
    const r = freezeFromRendered(content, f);
    content = r.content;
    frozen.push(...r.frozen.map((id) => `${f.type}#${id}`));
  }

  // #1826 —— 先整体扫一遍，有这份包画不出来的块就整跑不出产物（设计文档 §8.3；为什么在这里不在 SectionRenderer，见 content-blocks.js）。
  //    --only-blocks 不扫：它就是拿旧包去画「新包不认识」的那几块，content 里别的块这份旧包不认识是常态。
  if (!onlyBlocks) {
    const { knownBlockTypes, unrenderableBlocks } = require('./lib/content-blocks');
    const problems = unrenderableBlocks(content, knownBlockTypes(ROOT)); // 块目录经 §block-paths（测试改道）
    if (problems.length) throw new UnrenderableContentError(problems);
  }

  if (siteId !== undefined && Object.prototype.hasOwnProperty.call(content, 'site_meta.json')) {
    content['site_meta.json'] = { ...parsed(content, 'site_meta.json'), siteId };
  }
  // #1976 —— `sites.geo` 是一组、按地址对（老的单个对象当一项）：`lib/locations.js` §mergeGeo。
  if (geo && typeof geo === 'object' && Object.prototype.hasOwnProperty.call(content, 'brand.json')) {
    const brand = parsed(content, 'brand.json');
    const merged = require('./lib/locations').mergeGeo(brand, geo);
    if (merged !== brand) content['brand.json'] = merged;
  }

  // 派生：菜单同步、theme.css / custom.css / site.css、整站校验，以及页面要的那份站点数据（T2a-1）。日志改走标准错误。
  const { deriveSite } = require('./lib/derive-core');
  const work = fs.mkdtempSync(path.join(os.tmpdir(), 'site-render-'));
  const consoleLog = console.log;
  let derived;
  try {
    console.log = (...a) => console.error(...a);
    // #1833 —— Custom HTML 块里老板写的类（`btn-outline-primary` …）要被 PurgeCSS 看见，否则发布那份 site.css 把它们剪掉
    //    （设计文档 §6.4；入口是 T2a-1 留的 `customHtml`）。
    derived = await deriveSite({
      content, outDir: work, cacheDir, purge: target === 'live', lastModified, buildVersion, siteLabel: 'site', skipSiteCss: Boolean(onlyBlocks),
      customHtml: require('./lib/custom-html').customHtmlOf(content),
    });
  } finally {
    console.log = consoleLog;
  }

  const { readBuildTarget, applyBuildTarget } = require('./lib/build-target');
  const site = JSON.parse(JSON.stringify(derived.data));
  applyBuildTarget(site.seoByLocale, readBuildTarget({ SITE_URL: siteUrl, SITE_INDEXABLE: target === 'preview' ? 'false' : 'true' }));
  if (leadApi !== undefined) site.leadApi = leadApi;
  if (siteId !== undefined) site.siteId = siteId;
  for (const seo of Object.values(site.seoByLocale)) {
    const { google: _placeholder, ...rest } = (seo.verification && typeof seo.verification === 'object') ? seo.verification : {};
    seo.verification = gscToken ? { ...rest, google: gscToken } : rest;
  }

  if (!fs.existsSync(path.join(bundleDir, 'manifest.json'))) {
    console.error(`site.js: ${path.relative(ROOT, bundleDir)} 还没打过，先打一次（node scripts/site.js bundle）`);
    await bundle(bundleDir);
  }
  // react 留在包外、由 Node 现 require：它按 NODE_ENV 挑生产 / 开发版（开发版慢、还会打 key 之类的警告）。Next 发布构建是生产版。
  if (process.env.NODE_ENV === undefined) process.env.NODE_ENV = 'production';
  const { manifest, render: r } = loadBundle(bundleDir);
  if (onlyBlocks) {
    try {
      const shapesFile = manifest.platform && manifest.platform.shapesCss ? path.join(bundleDir, manifest.platform.shapesCss.replace(/^\//, '')) : '';
      return { ...renderOnlyBlocks(r, site, onlyBlocks, { out, target, version, platform: manifest.platform, shapesFile }), ms: Date.now() - t0 };
    } finally {
      fs.rmSync(work, { recursive: true, force: true });
    }
  }
  const siteCssRel = `_platform/css/${derived.siteCss.key}.css`;
  const { files, pages } = r.renderSite(site, { target, version, platform: manifest.platform, siteCssHref: `/${siteCssRel}` });

  // 落盘前整批验一遍：slug 是内容里的字段（页面 / 博客 / 默认语言跳转页都由它拼路径），带 `../` 就会写到 --out 之外。
  // 今天的 Next 构建对同样输入当场失败（`Requested and resolved page mismatch`）；这里也整跑失败、一个文件都不写。
  const outAbs = path.resolve(out);
  for (const rel of Object.keys(files)) {
    const segs = rel.split('/');
    const file = path.resolve(outAbs, rel);
    if (path.isAbsolute(rel) || rel.includes('\\') || segs.some((s) => s === '' || s === '.' || s === '..')
      || !file.startsWith(outAbs + path.sep)) {
      throw new Error(`产物路径不合法（slug 带 ../ 之类？），整跑不写：${JSON.stringify(rel)}`);
    }
  }
  fs.mkdirSync(out, { recursive: true });
  for (const [rel, body] of Object.entries(files)) {
    const file = path.join(out, rel);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, body);
  }
  for (const name of ['theme.css', 'custom.css']) fs.copyFileSync(path.join(work, name), path.join(out, name));
  copyTree(path.join(ROOT, 'public', 'images'), path.join(out, 'images'));
  if (typeof indexnowKey === 'string' && /^[a-zA-Z0-9-]{8,128}$/.test(indexnowKey)) fs.writeFileSync(path.join(out, `${indexnowKey}.txt`), indexnowKey);

  const platform = [...manifest.files.map((rel) => ({ path: rel, file: path.join(bundleDir, rel) })),
    { path: siteCssRel, file: path.join(work, 'site.css') }];
  if (platformOut) for (const p of platform) { const d = path.join(platformOut, p.path); fs.mkdirSync(path.dirname(d), { recursive: true }); fs.copyFileSync(p.file, d); }
  fs.rmSync(work, { recursive: true, force: true });
  return {
    pages: pages.length, files: Object.keys(files).length,
    platform: platform.map((p) => p.path), siteCssKey: derived.siteCss.key, siteCssCached: Boolean(derived.siteCss.cached),
    externals: manifest.externals, ...(frozen.length ? { frozen } : {}), ms: Date.now() - t0,
  };
}

/** `<section …>` 开始标签里的属性 → 对象（值按 HTML 转义还原）。 */
function sectionAttrs(openTag) {
  const unescape = (v) => v.replace(/&quot;/g, '"').replace(/&#x27;|&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
  const attrs = {};
  for (const m of openTag.replace(/^<section\b/, '').matchAll(/([^\s=>\/]+)(?:="([^"]*)")?/g)) attrs[m[1]] = m[2] === undefined ? '' : unescape(m[2]);
  return attrs;
}

/** 一页 HTML 里 `data-block-id="<id>"` 那个块：`{ attrs, inner }`；没有 ⟹ null。按 `<section` / `</section>` 配对数深度。 */
function extractSection(html, id) {
  const esc = id.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const open = new RegExp(`<section\\b[^>]*\\sdata-block-id="${esc}"[^>]*>`).exec(html);
  if (!open) return null;
  const tag = /<(\/?)section\b[^>]*>/g;
  tag.lastIndex = open.index + open[0].length;
  let depth = 1;
  for (let m = tag.exec(html); m; m = tag.exec(html)) {
    depth += m[1] ? -1 : 1;
    if (depth === 0) return { attrs: sectionAttrs(open[0]), inner: html.slice(open.index + open[0].length, m.index) };
  }
  return null;
}

/**
 * shapes.css 里这个块类型那一段（`build-blocks.js` §buildShapesCss 每个块一段，以 `/* ══ <类型> ═…` 打头）。
 * #1839 —— 读的是画这一次的那份包自己的 shapes.css（`manifest.platform.shapesCss`）：测试包的假块只在它那份里；没有才退回模板树那份。
 */
function blockTypeCss(type, shapesFile) {
  const file = shapesFile && fs.existsSync(shapesFile) ? shapesFile : path.join(ROOT, 'public', 'shapes.css');
  const css = fs.readFileSync(file, 'utf-8');
  const parts = css.split(/(?=^\/\* ══ [^ ]+ ═+ \*\/$)/m);
  return parts.find((p) => p.startsWith(`/* ══ ${type} ═`)) || '';
}

/** `--only-blocks`：只把这几块画出来（输出合同见文件头）。 */
function renderOnlyBlocks(r, site, ids, { out, target, version, platform, shapesFile }) {
  const wanted = [...new Set(ids)];
  const found = new Map(); // `${locale}/${id}` → { attrs, inner }
  const opts = { target, version, platform, siteCssHref: '' };
  const pagesByLocale = new Map();
  for (const route of r.pageRoutes(site)) {
    if (route.kind !== 'home' && route.kind !== 'subpage') continue; // 块只在首页和子页上（博客 / 跳转小页 / 404 没有页面块）
    if (!pagesByLocale.has(route.locale)) pagesByLocale.set(route.locale, []);
    pagesByLocale.get(route.locale).push(route);
  }
  for (const [locale, routes] of pagesByLocale) {
    for (const route of routes) {
      if (wanted.every((id) => found.has(`${locale}/${id}`))) break;
      const { html } = r.renderRoute(site, route, opts);
      for (const id of wanted) {
        if (found.has(`${locale}/${id}`)) continue;
        const sec = extractSection(html, id);
        if (sec) found.set(`${locale}/${id}`, sec);
      }
    }
  }
  const missing = wanted.filter((id) => ![...found.keys()].some((k) => k.endsWith(`/${id}`)));
  if (missing.length) throw new Error(`--only-blocks：这几个块在页面上找不到：${missing.join(', ')}`);
  const outAbs = path.resolve(out);
  const written = [];
  for (const [k, { attrs, inner }] of found) {
    const [locale, ...rest] = k.split('/');
    const id = rest.join('/');
    const base = path.resolve(outAbs, 'blocks', locale, id);
    if (!base.startsWith(path.join(outAbs, 'blocks') + path.sep) || /[\\/]/.test(id)) throw new Error(`块 id 不能当文件名：${JSON.stringify(id)}`);
    fs.mkdirSync(path.dirname(base), { recursive: true });
    fs.writeFileSync(`${base}.html`, inner);
    fs.writeFileSync(`${base}.css`, blockTypeCss(attrs['data-block'], shapesFile));
    fs.writeFileSync(`${base}.attrs.json`, `${JSON.stringify(attrs, null, 2)}\n`);
    written.push(`blocks/${locale}/${id}`);
  }
  return { blocks: written.sort() };
}

/**
 * #1828 —— 发版检查：块图册的每一格用演示数据渲一遍（见文件头 `render-catalog`）。返回 `{ cells, failed, problems, ms }`，
 * 不抛 —— 哪一格坏了逐格记下来，一次报全（只报第一格的话修一格跑一次）。
 */
async function renderCatalog({ out, buildVersion = '' }) {
  const t0 = Date.now();
  if (!out) throw new Error('要给 --out');
  const { blockShapeCatalog } = require('./lib/block-catalog');
  const { iconTableFor } = require('./lib/icons');
  const pool = require('./theme-pool.json');
  const { pairs, manifests } = blockShapeCatalog();
  const dir = fs.mkdtempSync(path.join(ROOT, 'render', '.catalog-'));
  let r;
  try {
    await bundle(dir);
    if (process.env.NODE_ENV === undefined) process.env.NODE_ENV = 'production';
    r = loadBundle(dir).render;
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
  const themeId = Object.keys(pool)[0] || '';
  const problems = [];
  const warn = () => {};
  for (const { block, shape } of pairs) {
    try {
      const html = r.renderCatalogCell({
        manifest: manifests.get(block), block, shape, themeId, iconTable: (b, data) => iconTableFor(b, data, { warn }),
      });
      if (html === null) { problems.push(`${block}/${shape}: 清单里有这一格，渲染层却说没有`); continue; }
      if (!html.includes(`data-block="${block}"`)) { problems.push(`${block}/${shape}: 画出来不带 data-block="${block}"（块没画出来）`); continue; }
      const file = path.join(out, block, shape, 'index.html');
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><title>${block} / ${shape}</title>`
        + `<meta name="ai1st-build" content="${String(buildVersion).replace(/[^\w.-]/g, '')}"></head><body class="site-body">${html}</body></html>\n`);
    } catch (e) {
      problems.push(`${block}/${shape}: ${e && e.message ? e.message.split('\n')[0] : e}`);
    }
  }
  return { cells: pairs.length, failed: problems.length, problems, ms: Date.now() - t0 };
}

/**
 * #1840 —— `render --freeze-from <JSON | 文件>`：`[{ "type": "<块类型>", "rendered": "<--only-blocks 的 --out>", "ids": [块 id…],
 * "label"?: "<名字>" }]`（manager 的自愈写，site_heal.go）。形状不对 ⟹ 整跑拒，不当成空。
 */
function freezeFromArg(v) {
  const list = jsonArg(v, 'freeze-from');
  if (list === undefined) return undefined;
  if (!Array.isArray(list)) throw new Error('--freeze-from 要是一个数组 [{type, rendered, ids, label?}]');
  return list.map((f, i) => {
    const bad = (why) => new Error(`--freeze-from 第 ${i + 1} 项${why}：${JSON.stringify(f)}`);
    if (!f || typeof f !== 'object' || typeof f.type !== 'string' || !/^[a-z0-9][a-z0-9-]*$/.test(f.type) || f.type === 'custom-html') throw bad('的 type 不是一个能冻的块类型');
    if (!Array.isArray(f.ids) || !f.ids.length || f.ids.some((x) => typeof x !== 'string' || !x)) throw bad('的 ids 要是非空的块 id 数组');
    checkPathArg('freeze-from 的 rendered', f.rendered);
    return { type: f.type, rendered: path.resolve(f.rendered), ids: f.ids, label: typeof f.label === 'string' ? f.label : undefined };
  });
}

/** `--out` / `--site` 原样就得是它自己：带 `.` / `..` / 空段的拒（绝对路径开头那一个 `/` 不算空段）。 */
function checkPathArg(name, v) {
  if (typeof v !== 'string' || v === '') throw new Error(`要给 --${name}`);
  const segs = v.split('/');
  if (segs[0] === '') segs.shift();
  if (segs.some((s) => s === '' || s === '.' || s === '..')) throw new Error(`--${name} 不能带 . / .. / 空段：${JSON.stringify(v)}`);
}

async function main() {
  const [cmd, ...rest] = process.argv.slice(2);
  if (Object.prototype.hasOwnProperty.call(EDITOR_COMMANDS, cmd)) {
    process.exitCode = await runEditorCommand(cmd, rest);
    return;
  }
  const a = parseArgs(rest);
  if (cmd === 'create') {
    checkPathArg('out-dir', a['out-dir']);
    const chunks = [];
    for await (const c of process.stdin) chunks.push(c);
    process.exitCode = await require('./lib/site-create').create({ outDir: path.resolve(a['out-dir']), stdinText: Buffer.concat(chunks).toString('utf-8') });
    return;
  }
  if (cmd === 'edit') {
    checkPathArg('site', a.site);
    checkPathArg('out-dir', a['out-dir']);
    if (typeof a.message !== 'string' || !a.message.trim()) throw new Error('要给 --message');
    const chunks = [];
    for await (const c of process.stdin) chunks.push(c);
    process.exitCode = await require('./lib/site-edit').edit({
      sitePath: a.site, message: a.message, scope: jsonArg(a.scope, 'scope') || null,
      outDir: path.resolve(a['out-dir']), stdinText: Buffer.concat(chunks).toString('utf-8'),
    });
    return;
  }
  if (cmd === 'seo-refresh') {
    checkPathArg('site', a.site);
    checkPathArg('out-dir', a['out-dir']);
    if (!a.force) checkPathArg('before', a.before);
    const chunks = [];
    for await (const c of process.stdin) chunks.push(c);
    process.exitCode = await require('./lib/seo-refresh').seoRefreshCommand({
      sitePath: a.site, beforePath: a.before, locale: a.locale, page: a.page, force: !!a.force, skipAI: !!a['skip-ai'],
      outDir: path.resolve(a['out-dir']), stdinText: Buffer.concat(chunks).toString('utf-8'),
    });
    return;
  }
  if (cmd === 'add-locale') {
    checkPathArg('site', a.site);
    checkPathArg('out-dir', a['out-dir']);
    const chunks = [];
    for await (const c of process.stdin) chunks.push(c);
    process.exitCode = await require('./lib/add-locale').addLocaleCommand({
      sitePath: a.site, locale: a.locale, brandName: a['brand-name'] || '',
      outDir: path.resolve(a['out-dir']), stdinText: Buffer.concat(chunks).toString('utf-8'),
    });
    return;
  }
  if (cmd === 'bundle') {
    // #1838 —— `--blocks-dir` / `--registry`：测试包（假块 A / B 那份块目录 + 它生成的注册表），见文件头。
    if (!!a['blocks-dir'] !== !!a.registry) throw new Error('--blocks-dir 和 --registry 要一起给');
    const m = await bundle(a['out-dir'] ? path.resolve(a['out-dir']) : DEFAULT_OUTDIR,
      a['blocks-dir'] ? { blocksDir: path.resolve(a['blocks-dir']), registryPath: path.resolve(a.registry) } : {});
    process.stdout.write(`${JSON.stringify({ event: 'bundled', ...m })}\n`);
    return;
  }
  if (cmd === 'render-catalog') {
    checkPathArg('out', a.out);
    const { problems, ...result } = await renderCatalog({ out: path.resolve(a.out), buildVersion: a['build-version'] ?? '' });
    for (const p of problems) console.error(`render-catalog: ${p}`);
    process.stdout.write(`${JSON.stringify({ event: 'catalog-rendered', ...result })}\n`);
    if (problems.length) process.exitCode = 1;
    return;
  }
  if (cmd === 'render') {
    // 先判再 resolve：path.resolve('') 是当前目录，下面 render() 里那句 `if (!out)` 就永远打不着了。
    checkPathArg('site', a.site);
    checkPathArg('out', a.out);
    const onlyBlocks = a['only-blocks'] === undefined ? undefined : a['only-blocks'].split(',').map((x) => x.trim()).filter(Boolean);
    if (onlyBlocks && onlyBlocks.length === 0) throw new Error('--only-blocks 要给至少一个块 id');
    const freezeFrom = freezeFromArg(a['freeze-from']);
    const result = await render({
      onlyBlocks,
      freezeFrom,
      content: JSON.parse(fs.readFileSync(a.site, 'utf-8')),
      out: path.resolve(a.out),
      siteId: a['site-id'],
      geo: jsonArg(a.geo, 'geo'),
      siteUrl: a['site-url'],
      leadApi: a['lead-api'],
      gscToken: a['gsc-token'],
      indexnowKey: a['indexnow-key'],
      version: a.version ?? 0,
      buildVersion: a['build-version'] ?? '',
      target: a.target || 'live',
      ...(a['cache-dir'] ? { cacheDir: path.resolve(a['cache-dir']) } : {}),
      lastModified: jsonArg(a['last-modified'], 'last-modified') || {},
      ...(a['platform-out'] ? { platformOut: path.resolve(a['platform-out']) } : {}),
      ...(a['bundle-dir'] ? { bundleDir: path.resolve(a['bundle-dir']) } : {}),
    });
    process.stdout.write(`${JSON.stringify({ event: 'rendered', ...result })}\n`);
    return;
  }
  throw new Error(`用法：node scripts/site.js <${['bundle', 'render', 'render-catalog', 'create', 'edit', 'seo-refresh', 'add-locale', ...Object.keys(EDITOR_COMMANDS)].join('|')}> …（拿到的是 ${JSON.stringify(cmd)}）`);
}

if (require.main === module) {
  main().catch((e) => {
    if (e instanceof UnrenderableContentError) {
      for (const p of e.problems) console.error(p);
      process.exit(3);
    }
    console.error(`site.js: ${e && e.message ? e.message : e}`);
    process.exit(1);
  });
}

module.exports = { render, renderCatalog, bundle, UnrenderableContentError, extractSection, checkPathArg };
