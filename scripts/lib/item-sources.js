'use strict';

// ══════════════════════════════════════════════════════════════════════════════════════════════════
// item-sources.js —— 列表槽的「引用写法」：`items: { source: "services" }`，构建时展开成条目（#1505，总纲 #1422）
// ══════════════════════════════════════════════════════════════════════════════════════════════════
//
// Chris 2026-09-30 定的规矩：**内容和样子分开**。内容（本站的服务目录、某个服务下面的页面）只存一份，块是它的
// 一种显示方式。所以块的列表槽除了「AI 写好的一组条目」（写法一，值），还接受「指向一份站点数据的引用」（写法二），
// 每次渲染前由这里展开成写法一的形状，再交给同一个渲染函数 —— 改 `services.json` 一处，用到它的块处处跟着变。
//
// 🔴 **两张表都住在这个文件顶上，别处不许再写一份**：
//    · `SOURCES`     有哪些源、每个源带什么参数、展开成什么（「每一条怎么对应」只写在这里，跟着源走、不跟着块走：
//                    以后别的块接同一个源，拿到的是同一套说法）。
//    · `BLOCK_SLOTS` 哪个块的哪个槽接哪几个源。今天只有 `features-new.items`；别的块要接，在这里登记一行。
//    校验（`block-manifest.js` §validateSite）、构建兜底（`scripts/blocks.js` §normalizeListSlots）、提示词
//    （§dataLineFor）、编辑器（`editor-convert.js`）、sitemap 依赖（`page-deps.js`）读的都是这两张表。
//    #1506 要再加 phone / email / address / brand / social 五个源：每个源一行 `SOURCES`，`ctx` 里多带它要的那份
//    站点数据，`BLOCK_SLOTS` 里登记接它的块 —— 表的形状不用改。
//
// 🔴 **纯函数**：不读文件、不读 `@/lib/config`。站点数据和「slug → 链接」由调用方传进来（`ctx`）——
//    真站的调用方是 `src/lib/sections/item-sources.ts` §itemSourceContext，单格页传演示生意那一份，测试传夹具。
//
// 🔴 **展开过的块带一个标记**：`data._sourced = { <槽>: <源名> }`。`features-new/Section.tsx` 据它
//    ① 不按 `maxItems` 截（引用写法有几条出几条，`maxItems` 只管 AI 手写的那种）② 展开出 0 条时整块不画
//    ③ 根元素挂 `data-items-source`。标记只活在内存里，不写进任何文件（编辑器「改成手写」写回的是条目数组）。

const SOURCED_KEY = '_sourced';

// services.json 的 `icon` 用的是 `ServiceIcon.tsx` 那一套名字（17 个）。15 个在 Bootstrap Icons 1.13.1 里同名，
// 只有这两个没有（2026-09-30 逐个查过 `node_modules/bootstrap-icons/icons/`）：
//   snowflake → snow   （`snow.svg` 在）
//   shovel    → tools  （1.13.1 里没有铲子；挑最近的「工具」）
// 查不到的名字原样带过去：`icons.js` §readIcon 查不到就不画那一个图标、打一行日志，不报错。
const SERVICE_ICON_ALIASES = { snowflake: 'snow', shovel: 'tools' };

const isObj = (v) => !!v && typeof v === 'object' && !Array.isArray(v);
const str = (v) => (typeof v === 'string' ? v : '');

function learnMoreLink(ctx, slug) {
  return { label: str(ctx.learnMore) || 'Learn more', href: ctx.url(slug), style: 'link', arrow: true };
}

/**
 * 有哪些源。每个源：
 *   params   除 `source` 之外认的键 → 是否必填（必填的要是非空字符串）
 *   prompt   提示词里那一段写法（§dataLineFor 拼在槽的 shape 后面）
 *   expand   (ref, ctx) → 条目数组（写法一的形状）
 */
const SOURCES = {
  // 本站服务目录里的每个服务，顺序同 services.json。有详情页（`services/<id>` 这一页存在）才带「了解更多」。
  services: {
    params: {},
    prompt: '{source: "services"}',
    expand(ref, ctx) {
      const pages = Array.isArray(ctx.pages) ? ctx.pages : [];
      const hasPage = new Set(pages.map((p) => p && p.slug));
      return (Array.isArray(ctx.services) ? ctx.services : []).filter(isObj).map((s) => {
        const it = { title: str(s.name), text: str(s.shortDescription) };
        if (str(s.icon)) it.icon = SERVICE_ICON_ALIASES[s.icon] || s.icon;
        const slug = `services/${s.id}`;
        if (str(s.id) && hasPage.has(slug)) it.link = learnMoreLink(ctx, slug);
        return it;
      });
    },
  },
  // slug 以 `<under>/` 开头、且不等于 `<under>` 的页面（同 `service-related-pages/Section.tsx` 那一行筛法），
  // 顺序同 pagesByLocale。不带图标。
  pages: {
    params: { under: true },
    prompt: '{source: "pages", under: "<service slug>"}',
    expand(ref, ctx) {
      const under = str(ref.under);
      if (!under) return [];
      return (Array.isArray(ctx.pages) ? ctx.pages : [])
        .filter((p) => isObj(p) && typeof p.slug === 'string' && p.slug.startsWith(`${under}/`) && p.slug !== under)
        .map((p) => ({ title: str(p.title), text: str(p.description), link: learnMoreLink(ctx, p.slug) }));
    },
  },
};

/** 哪个块的哪个槽接哪几个源。 */
const BLOCK_SLOTS = {
  'features-new': { items: ['services', 'pages'] },
};

/** 这个值是不是一个引用（写法二）：普通对象、带一个字符串 `source`。合不合法另说（§refProblems）。 */
function isSourceRef(v) {
  return isObj(v) && typeof v.source === 'string';
}

/** 这个块的这个槽接哪几个源（不接 ⟹ 空数组）。 */
function sourcesFor(type, slot) {
  const row = Object.prototype.hasOwnProperty.call(BLOCK_SLOTS, type) ? BLOCK_SLOTS[type] : null;
  return row && Array.isArray(row[slot]) ? row[slot] : [];
}

/**
 * 这个槽上写的一个**对象**（不是数组）合不合法 → 问题清单（空 = 合法）。只对接源的槽调；`v` 不是对象由调用方另报。
 * 每种错报一条：源不认识 · 必填参数没写 · 多余的键。
 */
function refProblems(type, slot, v) {
  const allowed = sourcesFor(type, slot);
  if (!isObj(v)) return [`"${slot}" 只能是条目数组，或者引用 ${allowed.map((s) => SOURCES[s].prompt).join(' / ')}`];
  if (typeof v.source !== 'string' || !allowed.includes(v.source)) {
    return [`"${slot}" 的 source ${JSON.stringify(v.source)} 不认识 —— 只能是 ${allowed.map((s) => `"${s}"`).join(' / ')}`];
  }
  const def = SOURCES[v.source];
  const out = [];
  for (const [k, req] of Object.entries(def.params)) {
    if (req && !(typeof v[k] === 'string' && v[k].trim())) out.push(`"${slot}" 引用 source "${v.source}" 要带 ${k}（非空字符串）：${def.prompt}`);
  }
  const extra = Object.keys(v).filter((k) => k !== 'source' && !(k in def.params));
  if (extra.length) out.push(`"${slot}" 引用 source "${v.source}" 不认 ${extra.map((k) => `"${k}"`).join(' / ')} —— 写法是 ${def.prompt}`);
  return out;
}

/** 一个引用 → 条目数组。源不认识 ⟹ 空数组（校验那一侧会报，渲染这一侧不炸）。 */
function expandRef(ref, ctx) {
  const def = isSourceRef(ref) && Object.prototype.hasOwnProperty.call(SOURCES, ref.source) ? SOURCES[ref.source] : null;
  return def ? def.expand(ref, ctx || {}) : [];
}

/**
 * 一页的块 → 引用都展开过的块（数组逐项对齐）。没有要展开的块原样返回**同一个对象**；一个都没有就返回同一个数组。
 * @param {Array} blocks
 * @param {{ services?: object[], pages?: object[], url: (slug: string) => string, learnMore?: string }} ctx
 */
function resolveItemSources(blocks, ctx) {
  if (!Array.isArray(blocks)) return blocks;
  let changed = false;
  const out = blocks.map((b) => {
    if (!b || !isObj(b.data) || !BLOCK_SLOTS[b.type]) return b;
    let data = null;
    for (const slot of Object.keys(BLOCK_SLOTS[b.type])) {
      const v = b.data[slot];
      if (!isSourceRef(v) || !sourcesFor(b.type, slot).includes(v.source)) continue;
      data = data || { ...b.data, [SOURCED_KEY]: { ...(isObj(b.data[SOURCED_KEY]) ? b.data[SOURCED_KEY] : {}) } };
      data[slot] = expandRef(v, ctx);
      data[SOURCED_KEY][slot] = v.source;
    }
    if (!data) return b;
    changed = true;
    return { ...b, data };
  });
  return changed ? out : blocks;
}

/** 这一页有没有块引用了某个源（`SubPage` 判要不要发服务结构化数据、`page-deps` 判 sitemap 依赖都问它）。 */
function blocksUseSource(blocks, source) {
  return (Array.isArray(blocks) ? blocks : []).some((b) => b && isObj(b.data) && BLOCK_SLOTS[b.type]
    && Object.keys(BLOCK_SLOTS[b.type]).some((slot) => isSourceRef(b.data[slot]) && b.data[slot].source === source
      && sourcesFor(b.type, slot).includes(source)));
}

/** 提示词里这个槽多出来的那几种写法（`| {source: "services"} | …`）；不接源 ⟹ 空串。 */
function promptAlternatives(type, slot) {
  return sourcesFor(type, slot).map((s) => ` | ${SOURCES[s].prompt}`).join('');
}

/** 编辑器只读提示那一句：条目来自哪里。 */
function describeRef(ref) {
  if (!isSourceRef(ref)) return '';
  if (ref.source === 'services') return "These items come from this website's services.";
  if (ref.source === 'pages') return `These items are the pages under “${str(ref.under)}”.`;
  return `These items come from “${ref.source}”.`;
}

module.exports = {
  SOURCES, BLOCK_SLOTS, SOURCED_KEY, SERVICE_ICON_ALIASES,
  isSourceRef, sourcesFor, refProblems, expandRef, resolveItemSources, blocksUseSource, promptAlternatives, describeRef,
};
