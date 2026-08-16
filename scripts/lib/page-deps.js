// #1033 — 「这一页渲染时读到了哪些文件」。
//
// sitemap 的 <lastmod> 要写「这一页上次什么时候变的」（#1026），而一页的内容不止来自它自己那份
// JSON：services.json 和 blocks/site-blocks.json 是**跨页共享的内容**。改它们，用到的那几页的 HTML
// 真的变了，但 #1033 之前没有任何一页的日期会动 —— 少报比多报麻烦：搜索引擎拿 <lastmod> 决定要不要
// 重新抓这一页，一个真改了却说没改的页面会晚很久才被重新收录。
//
// ── 算进去的和不算进去的 ────────────────────────────────────────────────────────────────────────
//
//   算：页面自己那份 JSON（sync-config 传进来）
//   算：`<localeDir>/services.json`，两条路各算一次 ——
//         · 这一页有真的把服务渲染出来的块（下面 SERVICES 那段）
//         · 这一页是**服务详情页**（`/services/<id>`）：页面外壳
//           `src/components/pages/SubPage.tsx:16-19,56-63` 自己给它发一份该服务的 `Service` 结构化
//           数据（serviceType / name / description 全取自 services.json），不经过任何块
//   算：`<localeDir>/blocks/site-blocks.json` —— 只算到真的用上了站级块的那几页（ref 或 visibility 命中）
//
//   不算：brand.json / theme.json / navigation.json / seo.json —— 站级外壳。它们变了每一页的 HTML
//         都不一样，但那不是「这一页的内容更新了」，算进来就是 #1026 要治的那个毛病换个入口再犯
//         （整段理由在 page-lastmod.js 的文件头上）。
//   不算：services.json 经**页脚 + 每页那份 LocalBusiness 结构化数据**到达的那一份。同一个文件，
//         多条到达路径，只有上面那两条算数。代价说在明处：改一个服务名，页脚里那份清单在每一页上
//         都变了，而只有真的渲染了这个服务的那几页会报新日期。
//
// ── SERVICES：谁会读 services.json 是**从代码里量出来的，不是手写的清单** ──────────────────────
//
// 手写清单会过期，而过期的样子跟没过期一模一样：将来谁加一个读 services 的块，忘了回来改清单，
// 那个块所在的页面从此少报，构建照样是绿的。所以这里读 `src/lib/sections/registry.ts`（块类型 →
// 组件），再看那个组件文件里有没有 `getServices` —— 组件拿服务数据只有这一个入口
// （`src/lib/config.ts` 导出的那个函数）。
//
// 🔴 但**块不是唯一的读法**（#1033 r2，QA2 在真站上量到的）：`/services/manicure` 这种服务详情页
//    的那份 `Service` 结构化数据是页面外壳自己发的，不经过任何块 ⟹ 只扫「块 → 组件」这条路按构造
//    看不见它。真站读数：改一个服务名并提交、容器重建之后 `/` `/services` `/quote` 三页的日期都变了，
//    而 `/services/manicure` 不动 —— 那一页的 HTML 里有 8 处新名字，其中 3 处是它自己那份结构化数据。
//    所以现在扫的是 **`src/` 整棵树里所有 `getServices` 的使用处**，每一处都要有归属：
//
//      · 注册表里的块组件           → 变成 types 里的一个块类型（上面那条路）
//      · `src/lib/config.ts`        → 那个函数自己的定义，不是使用处
//      · Footer.tsx / JsonLd.tsx    → 站级外壳，说在明处不算（上面「不算」那段）
//      · pages/SubPage.tsx          → 服务详情页那条（下面 isServiceDetailPage）
//      · 以上都不是                 → **归不了属**：调用方把 services.json 算给所有页面并点名
//                                      （错的方向要选多报；少报是静默的）
//
//    这份归属表是手写的，但漏一条不再是静默的 —— 新的使用处会立刻掉进最后那一档并被点名。
//    🔴 它此前的射程只有 `src/components/sections/` 这一个目录，而目录外当时就已经有一个真实使用处。
//
// 🔴 「读不出来」不是「没有块读 services」。解析失败时这里返回 unavailable，调用方把 services.json
//    算给**所有**页面并把话说出来：错的方向要选多报（多报 = 退回 #1026 之前的样子，少报是静默的）。
// 🔴 还有一条反向检查：`src/components/sections/` 里有 `getServices` 却没出现在注册表映射里的组件
//    要点名。它抓的是「解析把某个块漏掉了」——那种漏法本身是静默的。

const fs = require('fs');
const path = require('path');

// registry.ts 里的两样东西：
//   import HeroSection from '@/components/sections/HeroSection';
//   'hero': HeroSection,
//
// 键的引号可有可无、单双都行，末尾逗号可有可无 —— 这些都是格式，改了不该让这里失明。真正卡住的
// 是右边那个名字：它必须是本文件 import 进来的某个组件（下面 componentPath 查得到），所以文件里
// 别的对象字面量不会被误当成注册表。
const IMPORT_RE = /^import\s+([A-Za-z0-9_$]+)\s+from\s+'(@\/[^']+)';/gm;
const ENTRY_RE = /^\s*['"]?([a-z0-9-]+)['"]?\s*:\s*([A-Za-z0-9_$]+)\s*,?\s*$/gm;

// 组件拿服务数据的唯一入口（src/lib/config.ts 导出）。
const SERVICES_MARKER = /\bgetServices\b/;

// `getServices` 的使用处里，**不**通过块到达页面的那些。键是相对模板根的路径，值是它的归属说明
// （为什么算 / 为什么不算）。不在这张表里、也不是注册表里的块组件 = 归不了属，调用方多报 + 点名。
const ACCOUNTED = new Map([
  ['src/lib/config.ts', 'getServices 自己的定义，不是使用处'],
  ['src/components/Footer.tsx', '页脚里那份服务清单 —— 站级外壳，说在明处不算'],
  ['src/components/JsonLd.tsx', '每页都发的那份 LocalBusiness 结构化数据 —— 站级外壳，不算'],
  ['src/components/pages/SubPage.tsx', '服务详情页自己那份 Service 结构化数据 —— 下面 isServiceDetailPage 那条'],
]);

// 服务详情页（`/services/<id>` 那种页面）。这份判断本来就在 sync-config.js 里（导航要把这类页面
// 排除在外），#1033 r2 搬到这里让两处共用一个定义 —— 两份拷贝里的一份改了另一份没改，正是本文件
// 头上说的那种「过期了跟没过期长得一模一样」。
// 🔴 渲染那一侧（`src/components/pages/SubPage.tsx:16-19`）还多一个条件：slug 去掉前缀之后要对得上
//    某个服务的 id，对不上就不发那份结构化数据。这里**故意不加**那个条件：加了之后「新添一个服务，
//    让一张已经存在的 services/<id> 页面第一次匹配上」这种改法会少报，而少报是静默的。不加的代价是
//    services/<不存在的 id> 这种页面会跟着 services.json 动 —— 多报，看得见。
function isServiceDetailPage(page) {
  if (!page) return false;
  const slug = page.slug;
  return page.serviceDetailPage === true
    || (typeof slug === 'string' && slug.startsWith('services/') && slug !== 'services');
}

// src/ 里所有 .ts / .tsx，用来找出 getServices 的全部使用处。
function walkSources(dir, out) {
  let names = [];
  try {
    names = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const e of names) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walkSources(p, out);
    else if (e.isFile() && /\.tsx?$/.test(e.name)) out.push(p);
  }
  return out;
}

function resolveAlias(rootDir, spec) {
  // tsconfig 里只有 `@/*` → `./src/*` 这一个别名（CLAUDE.md §Path Aliases）。
  const rel = spec.replace(/^@\//, '');
  for (const ext of ['.tsx', '.ts']) {
    const p = path.join(rootDir, 'src', rel + ext);
    if (fs.existsSync(p)) return p;
  }
  return null;
}

function readFileOrNull(p) {
  try {
    return fs.readFileSync(p, 'utf-8');
  } catch {
    return null;
  }
}

/**
 * 谁会读 services.json：哪些块类型，以及 src/ 里还有没有归不了属的使用处。
 * @returns {{ types: Set<string>, unavailable: string|null, unmapped: string[], unaccounted: string[] }}
 *   unavailable 非空 = 什么都没量到，调用方按「所有页面都算」处理并把这句话打出来。
 *   unmapped = `src/components/sections/` 里用了 getServices 却没在注册表映射里的组件文件名（点名用）。
 *   unaccounted = 用了 getServices、既不是注册表里的块组件、也不在 ACCOUNTED 那张归属表里的文件
 *                 （#1033 r2）。非空 = 有一条到达页面的路我算不出来，调用方也按「所有页面都算」处理。
 */
function blockTypesReadingServices(rootDir) {
  const registryPath = path.join(rootDir, 'src', 'lib', 'sections', 'registry.ts');
  const src = readFileOrNull(registryPath);
  if (src === null) {
    return {
      types: new Set(),
      unmapped: [],
      unaccounted: [],
      unavailable: `读不到 ${path.relative(rootDir, registryPath)}`,
    };
  }

  const componentPath = new Map();
  for (const m of src.matchAll(IMPORT_RE)) componentPath.set(m[1], m[2]);

  const types = new Set();
  const usedComponentFiles = new Set();
  let entries = 0;
  for (const m of src.matchAll(ENTRY_RE)) {
    const [, type, component] = m;
    const spec = componentPath.get(component);
    if (!spec) continue;
    const file = resolveAlias(rootDir, spec);
    if (!file) continue;
    entries += 1;
    usedComponentFiles.add(path.resolve(file));
    const body = readFileOrNull(file);
    if (body !== null && SERVICES_MARKER.test(body)) types.add(type);
  }

  if (entries === 0) {
    // 一条都没解析出来 = 没找到那张表（改名了 / 换写法了）。「什么都没数到」不是「没有块读
    // services」—— 同族先例是 block-manifest.js 的 registryCoverage 对 known.length === 0 的处置。
    return {
      types: new Set(),
      unmapped: [],
      unaccounted: [],
      unavailable: `在 ${path.relative(rootDir, registryPath)} 里一条「块类型 → 组件」都没解析出来`,
    };
  }

  // 反向检查（#1033 r2 扩到整棵 src/）：每一处 getServices 都要有归属 —— 是注册表里的块组件、
  // 还是 ACCOUNTED 里写明了怎么算的那几个。剩下的两档分开点名，因为它们的后果不一样：
  //   · sections/ 里没进注册表的组件 = 它根本渲染不出来，影响零个页面 ⟹ 只点名（多半是注册表
  //     解析漏了一条，那种漏法本身是静默的）
  //   · 其它位置 = 有一条我算不出来的到达路径 ⟹ 点名 + 多报（调用方处理）
  const sectionsDir = path.resolve(rootDir, 'src', 'components', 'sections');
  const unmapped = [];
  const unaccounted = [];
  for (const abs of walkSources(path.join(rootDir, 'src'), [])) {
    if (usedComponentFiles.has(path.resolve(abs))) continue;
    const body = readFileOrNull(abs);
    if (body === null || !SERVICES_MARKER.test(body)) continue;
    const rel = path.relative(rootDir, abs).split(path.sep).join('/');
    if (ACCOUNTED.has(rel)) continue;
    if (path.resolve(abs).startsWith(sectionsDir + path.sep)) unmapped.push(path.basename(abs));
    else unaccounted.push(rel);
  }

  return { types, unmapped, unaccounted, unavailable: null };
}

/**
 * 建一个「问一页，答它读了哪些文件」的东西。上面那次代码扫描一个 locale 只做一次。
 *
 * @param {string} rootDir    模板根目录
 * @param {string} localeDir  这个 locale 的配置目录（老扁平站就是 site/）
 * @param {{types:Set<string>, unavailable:string|null, unaccounted?:string[]}} services
 *        blockTypesReadingServices 的结果
 */
function createPageDeps({ localeDir, services }) {
  const servicesPath = path.resolve(localeDir, 'services.json');
  const siteBlocksPath = path.resolve(localeDir, 'blocks', 'site-blocks.json');
  const hasSiteBlocksFile = fs.existsSync(siteBlocksPath);
  // 两种「算不出来」都退成「所有页面都算」：注册表读不出来（unavailable），或者有一处 getServices
  // 归不了属（unaccounted，#1033 r2）。两种调用方都会点名 —— 多报看得见，少报是静默的。
  const servicesForEveryPage = Boolean(services.unavailable) || (services.unaccounted || []).length > 0;

  return {
    /**
     * @param {object} page          归一化之后的页面对象（blocks 已经解开）
     * @param {string|undefined} pageSource  这一页是从哪个文件读出来的
     * @param {string[]} siteBlockIds 这一页用到的站级块 id（blocks.js 的 report 给的）
     * @returns {{ files: string[], usesServices: boolean, usesSiteBlocks: boolean }}
     */
    filesFor(page, pageSource, siteBlockIds) {
      const files = [];
      if (pageSource) files.push(path.resolve(pageSource));

      // 三条路都算：这一页有读 services 的块 · 这一页是服务详情页（外壳自己发那份结构化数据，
      // 不经过任何块）· 算不出来时的多报兜底。
      const usesServices = servicesForEveryPage
        || isServiceDetailPage(page)
        || (page.blocks || []).some((b) => services.types.has(b.type));
      if (usesServices) files.push(servicesPath);

      const usesSiteBlocks = hasSiteBlocksFile && (siteBlockIds || []).length > 0;
      if (usesSiteBlocks) files.push(siteBlocksPath);

      return { files, usesServices, usesSiteBlocks };
    },
  };
}

module.exports = { blockTypesReadingServices, createPageDeps, isServiceDetailPage };
