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
//    · `BLOCK_SLOTS` 哪个块的哪个槽接哪几个源。今天只有 `features.items`；别的块要接，在这里登记一行。
//    校验（`block-manifest.js` §validateSite）、构建兜底（`scripts/blocks.js` §normalizeListSlots）、提示词
//    （§dataLineFor）、编辑器（`editor-convert.js`）、sitemap 依赖（`page-deps.js`）读的都是这两张表。
//    #1506 加了 phone / email / address / brand / social 五个源（联系方式：值住在 `brand.json`，`ctx.brand` 带进来），
//    和另外两类位置 —— 表也住在这个文件顶上：
//    · `ITEM_SLOTS`    哪个块的哪份列表里**每一项**可以整项写成引用（`header.topbar.contact[]`）。
//    · 按钮            **不登记**：任何块里「有 `label` 又有 `href` 的对象」都认（§resolveButtons，按形状认、不按块名），
//                      `href` 接 `BUTTON_SOURCES`，`label` 里认 `LABEL_PLACEHOLDERS`。新块不用登记就能用。
//    `footer.contact` / `footer.social` 是整槽换值，跟 `features.items` 同一回事，所以登记在 `BLOCK_SLOTS`。
//    🔴 电话 → `tel:`、邮箱 → `mailto:` 只用 `contact-facts.js` 那两个函数（contact / footer 也用它们）。
//
// 🔴 **纯函数**：不读文件、不读 `@/lib/config`。站点数据和「slug → 链接」由调用方传进来（`ctx`）——
//    真站的调用方是 `src/lib/sections/item-sources.ts` §itemSourceContext，单格页传演示生意那一份，测试传夹具。
//
// 🔴 **展开过的块带一个标记**：`data._sourced = { <槽>: <源名> }`。`features/Section.tsx` 据它
//    ① 不按 `maxItems` 截（引用写法有几条出几条，`maxItems` 只管 AI 手写的那种）② 展开出 0 条时整块不画
//    ③ 根元素挂 `data-items-source`。标记只活在内存里，不写进任何文件（编辑器「改成手写」写回的是条目数组）。

const { telHref, mailtoHref } = require('./contact-facts');

const SOURCED_KEY = '_sourced';

// services.json 的 `icon` 用的是 `ServiceIcon.tsx` 那一套名字（17 个）。15 个在 Bootstrap Icons 1.13.1 里同名，
// 只有这两个没有（2026-09-30 逐个查过 `node_modules/bootstrap-icons/icons/`）：
//   snowflake → snow   （`snow.svg` 在）
//   shovel    → tools  （1.13.1 里没有铲子；挑最近的「工具」）
// 查不到的名字原样带过去：`icons.js` §readIcon 查不到就不画那一个图标、打一行日志，不报错。
const SERVICE_ICON_ALIASES = { snowflake: 'snow', shovel: 'tools' };

const isObj = (v) => !!v && typeof v === 'object' && !Array.isArray(v);
const str = (v) => (typeof v === 'string' ? v : '');

// ── #1506 联系方式：电话 / 邮箱 / 地址都从 `ctx.brand`（就是 brand.json 那一份）取 ─────────────────────────────

/** 引用点名的那一家门店（`location` 是下标，默认 0）。下标不合法或那一家不存在 ⟹ null（「指向不存在的东西」）。 */
function locationOf(ref, ctx) {
  const i = ref.location === undefined ? 0 : ref.location;
  if (!Number.isInteger(i) || i < 0) return null;
  const locs = isObj(ctx.brand) && Array.isArray(ctx.brand.locations) ? ctx.brand.locations : [];
  return isObj(locs[i]) ? locs[i] : null;
}

const trimmed = (v) => str(v).trim();

/**
 * 一个联系方式 → `{ icon, text, href? }`（页头顶条那一项的形状；按钮只取 `href`）。没有这个值 ⟹ null。
 * 邮箱不分门店（`brand.email` 一份）：没写 `location` 时不要求有门店（#1520，同 `contact-facts.js` §siteFactsFrom
 * 那一侧）；写了 `location` 才要求那一家在。
 */
function contactFact(kind, ref, ctx) {
  if (kind === 'email') {
    if (ref.location !== undefined && !locationOf(ref, ctx)) return null;
    const email = trimmed(isObj(ctx.brand) ? ctx.brand.email : '');
    return email ? { icon: 'envelope', text: email, href: mailtoHref(email) } : null;
  }
  const loc = locationOf(ref, ctx);
  if (!loc) return null;
  if (kind === 'phone') {
    const phone = trimmed(loc.phone);
    return phone ? { icon: 'telephone', text: phone, href: telHref(phone) } : null;
  }
  const address = trimmed(loc.address);
  return address ? { icon: 'geo-alt', text: address } : null;
}

// 社交平台名 → 显示名（无障碍标签用）。不在表里的按首字母大写。图标按平台名取 Bootstrap Icons 同名的那一个
// （`facebook` / `instagram` / `google` / `yelp` / `linkedin` / `whatsapp` / `tiktok` / `youtube` 都在 1.13.1 里）；
// 查不到的由 footer 自己落回 `link-45deg`（它今天的兜底，`icons.js` §BLOCK_ICONS 带着这个名字）。
const SOCIAL_LABELS = { linkedin: 'LinkedIn', tiktok: 'TikTok', youtube: 'YouTube', whatsapp: 'WhatsApp', twitter: 'X', x: 'X' };

/** `brand.socialLinks` 的两种存法（数组 `[{platform, url}]` / 对象 `{platform: url}`，config.ts）→ `[[platform, url]]`。 */
function socialPairs(links) {
  if (Array.isArray(links)) return links.filter(isObj).map((l) => [trimmed(l.platform), trimmed(l.url)]);
  if (isObj(links)) return Object.entries(links).map(([k, v]) => [trimmed(k), trimmed(v)]);
  return [];
}

function learnMoreLink(ctx, slug) {
  return { label: str(ctx.learnMore) || 'Learn more', href: ctx.url(slug), style: 'link', arrow: true };
}

/** `params` 里的取值：`true` = 必填、非空字符串；`INDEX` = 选填、非负整数（门店下标）；`BOOL` = 选填、true / false。 */
const INDEX = 'index';
const BOOL = 'bool';

/**
 * 有哪些源。每个源：
 *   params   除 `source` 之外认的键 → `true`（必填，非空字符串）、`INDEX`（选填，非负整数）或 `BOOL`（选填，布尔）
 *   prompt   提示词里那一段写法（§dataLineFor 拼在槽的 shape 后面）
 *   expand   (ref, ctx) → 整槽换成的值（写法一的形状）—— 接在 `BLOCK_SLOTS` 上的源才有
 *   fact     (ref, ctx) → `{ icon, text, href? }` 或 null —— 按钮 / `ITEM_SLOTS` 的那一项用它
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
  // #1550 —— 关键词页挂在 `services/<id>/<词>` 下，`under` 就是 `services/<id>`（服务详情页列它下面的全部关键词页，
  //    关键词页页尾列同服务的兄弟页）。正在画的这一页（`ctx.pageSlug`）不列自己。
  // #1630 —— `withParent: true`：最前面多一条指向 `under` 那一页本身（关键词页页尾链回服务详情页；面包屑删了之后
  //    这是唯一一条回去的路）。文字是服务目录里的服务名（`under` 是 `services/<id>` 时按 id 找），找不到才用那一页的
  //    title。那一页不存在就不出这一条（不指向 404）。只有代码写它（`keyword-pages.js` §addRelatedBlocks），不进提示词。
  pages: {
    params: { under: true, withParent: BOOL },
    prompt: '{source: "pages", under: "services/<service id>"}',
    expand(ref, ctx) {
      const under = str(ref.under);
      if (!under) return [];
      const all = (Array.isArray(ctx.pages) ? ctx.pages : []).filter((p) => isObj(p) && typeof p.slug === 'string');
      const children = all
        .filter((p) => p.slug.startsWith(`${under}/`) && p.slug !== under)
        .filter((p) => p.slug !== ctx.pageSlug)
        .map((p) => ({ title: str(p.title), text: str(p.description), link: learnMoreLink(ctx, p.slug) }));
      const parent = ref.withParent === true ? all.find((p) => p.slug === under) : null;
      if (!parent || parent.slug === ctx.pageSlug) return children;
      const m = under.match(/^services\/([^/]+)$/);
      const svc = m ? (Array.isArray(ctx.services) ? ctx.services : []).find((s) => isObj(s) && s.id === m[1]) : null;
      const title = (svc && str(svc.name)) || str(parent.title);
      return [{ title, text: str(parent.description), link: learnMoreLink(ctx, under) }, ...children];
    },
  },
  // #1506 —— 联系方式。`location` 是门店下标（默认 0）；email 不分门店，但写了 `location` 也要那一家存在。
  phone: {
    params: { location: INDEX },
    prompt: '{source: "phone"}',
    fact: (ref, ctx) => contactFact('phone', ref, ctx),
  },
  email: {
    params: { location: INDEX },
    prompt: '{source: "email"}',
    fact: (ref, ctx) => contactFact('email', ref, ctx),
  },
  address: {
    params: { location: INDEX },
    prompt: '{source: "address"}',
    fact: (ref, ctx) => contactFact('address', ref, ctx),
  },
  // footer 的 `contact`：`{phone, email, address, city}`，取 `locations[location]` 和 `email`。没有的那一样不带（页脚空的不画）；
  // 写了 `location` 而那一家不存在 ⟹ 空对象（整段联系信息不画）；没写 `location` 而一家门店都没有 ⟹ 只剩 `email`（#1520）。
  // #1530 —— `city` 是那一家的 `city`（geocode 带回来的），`row` 底栏露它；没有就不带 —— 不从地址串猜。
  brand: {
    params: { location: INDEX },
    prompt: '{source: "brand"}',
    expand(ref, ctx) {
      const out = {};
      for (const k of ['phone', 'email', 'address']) {
        const f = contactFact(k, ref, ctx);
        if (f) out[k] = f.text;
      }
      const loc = locationOf(ref, ctx);
      const city = loc ? trimmed(loc.city) : '';
      if (city) out.city = city;
      return out;
    },
  },
  // footer 的 `social`：`brand.socialLinks` → `[{label, href, icon}]`，顺序同存的那一份；没有网址的那一条不带。
  social: {
    params: {},
    prompt: '{source: "social"}',
    expand(ref, ctx) {
      return socialPairs(isObj(ctx.brand) ? ctx.brand.socialLinks : undefined)
        .filter(([platform, url]) => platform && url)
        .map(([platform, url]) => {
          const key = platform.toLowerCase();
          return { label: SOCIAL_LABELS[key] || platform.charAt(0).toUpperCase() + platform.slice(1), href: url, icon: key };
        });
    },
  },
};

/** 哪个块的哪个槽接哪几个源（整槽写成引用，展开后整槽换掉）。 */
const BLOCK_SLOTS = {
  'features': { items: ['services', 'pages'] },
  'footer': { contact: ['brand'], social: ['social'] },
};

/** #1506 —— 哪个块的哪份列表里**每一项**可以整项写成引用（路径用 `.` 分层）。展开成 `{icon, text, href?}`；值不存在的那一项去掉。 */
const ITEM_SLOTS = {
  'header': { 'topbar.contact': ['phone', 'email', 'address'] },
};

/** #1506 —— 按钮（任何块里有 `label` 又有 `href` 的对象）的 `href` 能写成哪几个源；`label` 里认哪几个占位。 */
const BUTTON_SOURCES = ['phone', 'email'];
const LABEL_PLACEHOLDERS = ['phone', 'email'];
const PLACEHOLDER_RE = /\{([A-Za-z_][\w-]*)\}/g;

/**
 * #1506 —— 提示词里讲按钮的那一句（建站 `create-site.js`、改站 `edit-site.js` 都印它，不各写一份）。
 * 🔴 改它要连 `contact-refs.test.js` 那几格一起看：它们判的是这句话里的两种写法在不在。
 */
const BUTTON_REF_PROMPT = 'Phone and email buttons: never write the phone number or email address into a page. '
  + 'In any button ({label, href, ...}) write href as {"source": "phone"} or {"source": "email"} '
  + '(add "location": 1 for the second location, and so on), and if the button text should show it, write {phone} or {email} '
  + 'in the label, e.g. {"label": "Call {phone}", "href": {"source": "phone"}}. They are filled in from brand.json when the site '
  + 'is built, so they stay right when the number changes. Do not write phone numbers in body text either.';

/**
 * #1506 —— 页头顶条 / 页脚里那三个位置怎么写引用（`header` / `footer` 还没进提示词：它们是 staging 外壳块，
 * 加 `prompt` 就进了建站菜单）。T3（#1425）接线、它们进提示词时印这几句。
 */
const REGION_REF_PROMPTS = {
  'header': 'topbar.contact: each item may be {"source": "phone"} / {"source": "email"} / {"source": "address"} '
    + '(optional "location") instead of {icon, text, href} — it is filled in from brand.json.',
  'footer': 'contact may be {"source": "brand"} (optional "location") and social may be {"source": "social"} '
    + 'instead of writing them out — they are filled in from brand.json.',
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
  return refProblemsAt(slot, allowed, v);
}

/** 一个引用对象（`v` 已知是对象）在「只许 `allowed` 这几个源」的位置上合不合法。`at` 是报错里那个位置的名字。 */
function refProblemsAt(at, allowed, v) {
  if (typeof v.source !== 'string' || !allowed.includes(v.source)) {
    return [`"${at}" 的 source ${JSON.stringify(v.source)} 不认识 —— 只能是 ${allowed.map((s) => `"${s}"`).join(' / ')}`];
  }
  const def = SOURCES[v.source];
  const out = [];
  for (const [k, req] of Object.entries(def.params)) {
    if (req === INDEX) {
      if (v[k] !== undefined && !(Number.isInteger(v[k]) && v[k] >= 0)) {
        out.push(`"${at}" 引用 source "${v.source}" 的 ${k} 是 ${JSON.stringify(v[k])} —— 只能是非负整数（0 = 第一家门店，可省）`);
      }
    } else if (req === BOOL) {
      if (v[k] !== undefined && typeof v[k] !== 'boolean') {
        out.push(`"${at}" 引用 source "${v.source}" 的 ${k} 是 ${JSON.stringify(v[k])} —— 只能是 true / false（可省）`);
      }
    } else if (req && !(typeof v[k] === 'string' && v[k].trim())) {
      out.push(`"${at}" 引用 source "${v.source}" 要带 ${k}（非空字符串）：${def.prompt}`);
    }
  }
  const extra = Object.keys(v).filter((k) => k !== 'source' && !(k in def.params));
  if (extra.length) out.push(`"${at}" 引用 source "${v.source}" 不认 ${extra.map((k) => `"${k}"`).join(' / ')} —— 写法是 ${def.prompt}`);
  return out;
}

/** 按 `a.b` 这种路径取值 / 换值（`ITEM_SLOTS` 的位置）。换值时沿路复制，不改原对象。 */
function getPath(obj, dotted) {
  return dotted.split('.').reduce((o, k) => (isObj(o) ? o[k] : undefined), obj);
}
function setPath(obj, dotted, value) {
  const [head, ...rest] = dotted.split('.');
  return { ...obj, [head]: rest.length ? setPath(isObj(obj[head]) ? obj[head] : {}, rest.join('.'), value) : value };
}

/** 按钮的形状：有 `label`（字符串）又有 `href` 这个键的对象（#1506 做什么 1，不按块名登记）。 */
function isButton(v) {
  return isObj(v) && typeof v.label === 'string' && 'href' in v;
}

/**
 * #1506 —— 一个块的 data 里写成引用的联系方式问题清单（`validateSite` 调；空 = 合法）。下面几处：
 *   · 按钮：`href` 是对象 ⟹ 只能是 `BUTTON_SOURCES` 的引用；`label` 里的 `{…}` 只认 `LABEL_PLACEHOLDERS`
 *   · `ITEM_SLOTS`：那份列表里是对象且带 `source` 的那一项 ⟹ 只能是登记的那几个源
 *   · 半截形状（#1520）：不是按钮、`href` 却是对象（`{icon, text, href: {source: "phone"}}`）⟹ 报一条。
 *     展开那一侧（§resolveItemSlots 认整项、§resolveButtons 认按钮）两条路都认不出它，对象会原样留到渲染端。
 *   （`BLOCK_SLOTS` 的整槽引用由调用方按槽调 §refProblems —— 列表槽和对象槽都走那一条。）
 */
function contactRefProblems(type, data) {
  const out = [];
  const walk = (v, at) => {
    if (Array.isArray(v)) { v.forEach((x, i) => walk(x, `${at}[${i}]`)); return; }
    if (!isObj(v)) return;
    if (at && isButton(v)) {
      if (isObj(v.href)) out.push(...refProblemsAt(`${at}.href`, BUTTON_SOURCES, v.href));
      for (const [, name] of v.label.matchAll(PLACEHOLDER_RE)) {
        if (!LABEL_PLACEHOLDERS.includes(name)) {
          out.push(`"${at}.label" 里的 {${name}} 不认识 —— 按钮文字里只认 ${LABEL_PLACEHOLDERS.map((x) => `{${x}}`).join(' / ')}`);
        }
      }
    } else if (at && isObj(v.href)) {
      const why = 'label' in v ? 'label 不是字符串' : '没有 label';
      out.push(`"${at}.href" 是对象，但这一项不是按钮（${why}）—— 引用 {"source": …} 只能写在按钮 {label, href} 的 href 里，`
        + '或者整项写成引用（页头顶条那一项：{"source": "phone"}）；不然 href 写成字符串');
    }
    for (const [k, x] of Object.entries(v)) if (k !== 'href') walk(x, at ? `${at}.${k}` : k);
  };
  walk(isObj(data) ? data : {}, '');
  const rows = Object.prototype.hasOwnProperty.call(ITEM_SLOTS, type) ? ITEM_SLOTS[type] : {};
  for (const [dotted, allowed] of Object.entries(rows)) {
    const list = getPath(data, dotted);
    if (!Array.isArray(list)) continue;
    list.forEach((it, i) => { if (isObj(it) && 'source' in it) out.push(...refProblemsAt(`${dotted}[${i}]`, allowed, it)); });
  }
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
 * @param {{ services?: object[], pages?: object[], url: (slug: string) => string, learnMore?: string, pageSlug?: string }} ctx
 */
function resolveItemSources(blocks, ctx) {
  if (!Array.isArray(blocks)) return blocks;
  const c = ctx || {};
  let changed = false;
  const out = blocks.map((b) => {
    if (!b || !isObj(b.data)) return b;
    let data = null;
    for (const slot of Object.keys(BLOCK_SLOTS[b.type] || {})) {
      const v = b.data[slot];
      if (!isSourceRef(v) || !sourcesFor(b.type, slot).includes(v.source)) continue;
      data = data || { ...b.data, [SOURCED_KEY]: { ...(isObj(b.data[SOURCED_KEY]) ? b.data[SOURCED_KEY] : {}) } };
      data[slot] = expandRef(v, c);
      data[SOURCED_KEY][slot] = v.source;
    }
    const items = resolveItemSlots(b.type, data || b.data, c);
    const buttons = resolveButtons(items, c, b.type, true);
    if (buttons !== b.data) data = buttons;
    if (!data) return b;
    changed = true;
    return { ...b, data };
  });
  return changed ? out : blocks;
}

/** 一行日志：引用指向的东西不存在（站点没有邮箱、`location: 2` 但只有一家门店）。构建不报错。 */
function logMissing(ctx, type, what) {
  const log = typeof ctx.log === 'function' ? ctx.log : (m) => console.warn(m);
  log(`[item-sources] ${type || '?'}: ${what} —— 站点数据里没有这一样，那一项不画`);
}

/** #1506 —— `ITEM_SLOTS` 的那几份列表：写成引用的那一项换成 `{icon, text, href?}`，值不存在就去掉。没动 ⟹ 原样返回。 */
function resolveItemSlots(type, data, ctx) {
  const rows = Object.prototype.hasOwnProperty.call(ITEM_SLOTS, type) ? ITEM_SLOTS[type] : null;
  if (!rows) return data;
  let out = data;
  for (const [dotted, allowed] of Object.entries(rows)) {
    const list = getPath(out, dotted);
    if (!Array.isArray(list) || !list.some(isSourceRef)) continue;
    const next = [];
    for (const it of list) {
      if (!isSourceRef(it)) { next.push(it); continue; }
      const def = allowed.includes(it.source) ? SOURCES[it.source] : null;
      const f = def && def.fact ? def.fact(it, ctx) : null;
      if (f) next.push(f); else logMissing(ctx, type, `${dotted} 里的 ${JSON.stringify(it)}`);
    }
    out = setPath(out, dotted, next);
  }
  return out;
}

const DROP = Symbol('drop');

/**
 * #1506 —— 一个按钮：`href` 写成引用 ⟹ 换成 `tel:` / `mailto:`；`label` 里的 `{phone}` / `{email}` ⟹ 换成号码 / 邮箱原文
 * （占位用 `href` 引用的那一家门店，没写就第一家）。指向的东西不存在 ⟹ DROP（整个按钮不画）。没有引用 ⟹ 原样返回。
 */
function resolveButton(btn, ctx, type) {
  const ref = isObj(btn.href) ? btn.href : null;
  const names = [...btn.label.matchAll(PLACEHOLDER_RE)].map((m) => m[1]).filter((n) => LABEL_PLACEHOLDERS.includes(n));
  if (!ref && !names.length) return btn;
  let href = btn.href;
  if (ref) {
    const def = isSourceRef(ref) && BUTTON_SOURCES.includes(ref.source) ? SOURCES[ref.source] : null;
    const f = def ? def.fact(ref, ctx) : null;
    if (!f) { logMissing(ctx, type, `按钮「${btn.label}」的 href ${JSON.stringify(ref)}`); return DROP; }
    href = f.href;
  }
  const at = ref && Number.isInteger(ref.location) ? { location: ref.location } : {};
  let label = btn.label;
  for (const n of new Set(names)) {
    const f = contactFact(n, at, ctx);
    if (!f) { logMissing(ctx, type, `按钮「${btn.label}」里的 {${n}}`); return DROP; }
    label = label.split(`{${n}}`).join(f.text);
  }
  return { ...btn, href, label };
}

/**
 * #1506 —— 走一遍 data，所有按钮（§isButton）都过 §resolveButton。列表里 DROP 的那一项去掉；对象属性 DROP ⟹ 删掉那个键。
 * 一处都没动 ⟹ 原样返回**同一个对象**（良构、无引用的块一个字节不变）。
 * `isRoot`：块的 data 本身不当按钮认（哪个块顶层正好有 `label` + `href` 两个槽，整块也不会被换掉或丢掉）。
 */
function resolveButtons(v, ctx, type, isRoot = false) {
  if (Array.isArray(v)) {
    let changed = false;
    const out = [];
    for (const x of v) {
      const r = resolveButtons(x, ctx, type);
      if (r !== x) changed = true;
      if (r !== DROP) out.push(r);
    }
    return changed ? out : v;
  }
  if (!isObj(v)) return v;
  const self = !isRoot && isButton(v) ? resolveButton(v, ctx, type) : v;
  if (self === DROP) return DROP;
  let out = self;
  for (const [k, x] of Object.entries(self)) {
    if (k === 'href' || k === SOURCED_KEY) continue;
    const r = resolveButtons(x, ctx, type);
    if (r === x) continue;
    if (out === v) out = { ...v };
    if (r === DROP) delete out[k]; else out[k] = r;
  }
  return out;
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
  if (ref.source === 'pages') {
    return ref.withParent === true
      ? `These items are “${str(ref.under)}” and the pages under it.`
      : `These items are the pages under “${str(ref.under)}”.`;
  }
  return `These items come from “${ref.source}”.`;
}

module.exports = {
  SOURCES, BLOCK_SLOTS, ITEM_SLOTS, BUTTON_SOURCES, LABEL_PLACEHOLDERS, SOURCED_KEY, SERVICE_ICON_ALIASES,
  BUTTON_REF_PROMPT, REGION_REF_PROMPTS,
  isSourceRef, sourcesFor, refProblems, contactRefProblems, expandRef, resolveItemSources, blocksUseSource, promptAlternatives, describeRef,
};
