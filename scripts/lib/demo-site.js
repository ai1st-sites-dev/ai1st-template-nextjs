'use strict';

// ══════════════════════════════════════════════════════════════════════════════════════════════════
// demo-site.js —— skipAI 示例站的页面内容从 `lib/demo-content/` 取（#1620）
// ══════════════════════════════════════════════════════════════════════════════════════════════════
//
// 在这之前示例站的每一块都写死在 `create-site.js` §getDemoConfig 里：5 页、只用到 hero / features / cta /
// contact / page-header / content 六种块，新库里另外九种一次都不出现，所以在示例站上看不到、也测不到它们。
// 现在：**站的骨架**（brand / seo / services / navigation / 5 页的 slug、标题、导航顺序）仍是 getDemoConfig 那一份 ——
// 其它测试和 `ar` 那张译文表都按那份写的；**每一页的块**换成演示内容包里那一份（`DEMO_CONTENT`），
// 块库里的每个页面块至少出现一次。header / footer 是外壳（`shell-data.js` 从 navigation.json + brand.json 派生），
// 不在页面里。
//
// 🔴 块的集合不写死在这里：`PAGE_PLAN` 只说「哪一块放哪一页」，没被点名的页面块按块库的顺序追加到首页
//    （`demoSitePages` 的 `manifests` 参数，调用方传 `blocks/` 下有 manifest 的那一份）。以后块库加一个块、在
//    `DEMO_CONTENT` 补一份内容，示例站自动就有它，不用再改这里或 create-site.js（正文「要变成什么样」1）。

const { DEMO_CONTENT, SITE, DEMO_BLOG_POSTS } = require('./demo-content');

/** 外壳的两个区：数据从 navigation.json 派生，不进页面。 */
const SHELL_BLOCKS = new Set(['header', 'footer']);

/**
 * 哪一块放哪一页（getDemoConfig 那 5 页的 slug）。`preset` 是显示开关照哪个预设开、并钉成这块的形态（不写 = 打开填了的槽最多的那个，§showFilledSlots）；`at` 是页面块的 data 覆盖（只改标题这类给人读的话，
 * 用的是 getDemoConfig 原来那几句 —— `ar.js` 的译文表认的就是它们）。
 */
const PAGE_PLAN = {
  home: [
    // hero 用 split（图 + 按钮）：lead-form 会把按钮那一排让给表单。
    { type: 'hero', preset: 'split' },
    { type: 'logos' },
    { type: 'features' },
    { type: 'milestones' },
    { type: 'testimonials' },
    { type: 'reviews' },
    { type: 'blog' },
    // cta 用 photo（图 + 按钮）：同时开 image 和 form 是没有哪个预设用过的组合。
    { type: 'cta', preset: 'photo' },
  ],
  about: [
    { type: 'page-header', at: { introEyebrow: { text: 'About', style: 'pill' }, headline: 'About Us', subheadline: 'Learn more about our company and mission' } },
    { type: 'content' },
    { type: 'team' },
    { type: 'gallery' },
  ],
  services: [
    { type: 'page-header', at: { introEyebrow: { text: 'Services', style: 'pill' }, headline: 'Our Services', subheadline: 'Discover what we can do for you' } },
    // 引用写法（#1505）：服务那一格的条目来自 services.json —— 跟 getDemoConfig 原来那一格同一个做法。
    { type: 'features', at: { headline: 'What we do', items: { source: 'services' } } },
    { type: 'pricing' },
    { type: 'faq' },
  ],
  quote: [
    { type: 'page-header', at: { introEyebrow: { text: 'Get a Quote', style: 'pill' }, headline: 'Get a Free Quote', subheadline: 'Fill out the form below and we will get back to you within 24 hours' } },
    // 表单用站级表单库的第一张（form.id 空 = 第一张；#1635 起默认只有 contact 这一张）。
    { type: 'contact', at: { headline: 'Tell us about your project', form: {} } },
  ],
  contact: [
    { type: 'page-header', at: { introEyebrow: { text: 'Contact', style: 'pill' }, headline: 'Contact Us', subheadline: "Send us a message and we'll get back to you shortly." } },
    // TICKET-268e：导航里点得进去的 Contact 页，表单 POST 到 /api/leads。
    { type: 'contact', at: { form: { id: 'contact' } } },
  ],
};

const clone = (v) => JSON.parse(JSON.stringify(v));

/**
 * 一块 `{ type, shape?, data }`。data 是演示内容那一份 + 这一页的覆盖，去掉值为 `null` 的顶层键。
 * 🔴 `null` 不进真站：演示内容里 `bg: null` 是「这一格不上底色」，而编辑器存盘时把「没有底色」写成**没有这个键** ——
 *    带着 null 写进去，老板打开编辑器、什么都不改再存一次，页面 JSON 就变了（`editor-ai-history.test.js` 量到的就是这个）。
 */
function demoBlock(type, at, manifest, preset) {
  const out = { ...clone(DEMO_CONTENT[type]), ...clone(at || {}) };
  for (const k of Object.keys(out)) if (out[k] === null) delete out[k];
  // 列表槽按块自己声明的上限截（pricing 的 plans / highlights 是 4）：演示内容为了图册的「≥ 6 项」守卫给了 6 条，
  // 真站里多出来的那几条 `validateSite` 会判「最多只能有 N 项」。取前 N 条。
  for (const [slot, spec] of Object.entries((manifest && manifest.slots) || {})) {
    if (spec && Number.isInteger(spec.maxItems) && Array.isArray(out[slot]) && out[slot].length > spec.maxItems) {
      out[slot] = out[slot].slice(0, spec.maxItems);
    }
  }
  const shape = showFilledSlots(out, manifest, preset);
  return shape ? { type, shape, data: out } : { type, data: out };
}

/**
 * 跟旋钮同名、又填了内容的槽（hero 的 `image` / `form`、features 的 `introImage` …）按**一个预设**打开或去掉。
 * 🔴 演示内容的 `options` 是空的 —— 图册里旋钮由每个预设卡片自己给；写进一个真站时旋钮没写 = 默认 "none"，
 *    图和表单整个不出现，`validateSite` 也会报「写了 X 但 options.X 没写」。
 * 🔴 **只照一个预设开，不把每个填了的槽都开**：各开各的会拼出没有哪个预设用过的组合 —— 第一版那么做，
 *    cta 同时开了 image + form，文字那一栏在窄屏被挤成 0px 宽；hero 开了 form，按钮那一排整个让给了表单
 *    （theme-css 那道检查两处都量出来了）。所以：用 `preset`（PAGE_PLAN 点名的）或「打开填了的槽最多的那个预设」，
 *    它打开的写进 `options`，它不打开的那几格内容删掉。
 * 🔴 **开了槽就把那个预设钉进块的 `shape`**（回它的形态名；一格都没开回 null，那块照旧由主题定）。r1 只写开关、
 *    其余旋钮交给主题选的形态 —— 而主题的形态叠上这个开关未必是任何一个预设：azure-29 给 cta 的是 Inline
 *    （`layout: inline`），叠上 Photo 的 `image: left`，1440 宽下文字那一栏被挤到 94px、标题一行一个词（#1620 r1 QA2
 *    量到；ember-12 给的是 Boxed，看起来是好的）。块自己的 `shape` 是形态三级取值的第 ① 级（`block-shape.js`
 *    §shapeForBlock；编辑器的 Layout 下拉钉一个形态也是写它），渲染时 `effectiveKnobs` 拿它当旋钮的底 ⟹ 换哪套主题
 *    都是那个预设。代价：开了槽的这几块不再随主题换形态，跟老板在编辑器里钉了一个 Layout 一样。
 */
function showFilledSlots(data, manifest, presetShape) {
  const slots = (manifest && manifest.slots) || {};
  const knobs = ((slots.options && slots.options.knobs) || [])
    .filter((k) => k && k.name in slots && Array.isArray(k.values) && k.values.includes('none'));
  const opts = data.options && typeof data.options === 'object' ? data.options : {};
  const filled = knobs.filter((k) => data[k.name] !== undefined && data[k.name] !== null && opts[k.name] === undefined);
  if (!filled.length) return null;
  const presets = (manifest && manifest.presets) || [];
  const shows = (p) => filled.filter((k) => p && p.knobs && p.knobs[k.name] && p.knobs[k.name] !== 'none').length;
  let preset = presetShape ? presets.find((p) => p && p.shape === presetShape) : null;
  if (presetShape && !preset) throw new Error(`demo-site: ${manifest.type} 没有叫 "${presetShape}" 的预设`);
  if (!preset) preset = presets.reduce((best, p) => (shows(p) > shows(best) ? p : best), presets[0]);
  const next = { ...opts };
  let opened = 0;
  for (const k of filled) {
    const v = preset && preset.knobs && preset.knobs[k.name];
    if (v && v !== 'none') { next[k.name] = v; opened += 1; }
    else delete data[k.name];
  }
  if (Object.keys(next).length) data.options = next;
  return opened && preset.shape ? preset.shape : null;
}

/**
 * 每一页的块。`pages` 是 getDemoConfig 那 5 页（就地换 `sections`），`manifests` 是块库里有 manifest 的块（Map：类型 → manifest）。
 * 回 `{ placed, appended }`：按计划放下的块类型、被追加到首页的块类型（读数用）。
 * 🔴 `DEMO_CONTENT` 里没有的块：抛错，不静默跳过 —— 跳过就是「块库多了一块、示例站上没有」而建站照样成功。
 */
function demoSitePages(pages, manifests) {
  const pageTypes = [...((manifests && manifests.keys()) || [])].filter((t) => !SHELL_BLOCKS.has(t));
  const missing = pageTypes.filter((t) => !DEMO_CONTENT[t]);
  if (missing.length) {
    throw new Error(`demo-site: 块库里有 ${missing.join(' / ')}，演示内容包里没有它的内容 —— 补进 scripts/lib/demo-content/content.js`);
  }
  const planned = new Set();
  for (const page of pages) {
    const plan = PAGE_PLAN[page.slug];
    if (!plan) continue;
    page.sections = plan
      .filter((p) => pageTypes.includes(p.type))
      .map((p) => {
        planned.add(p.type);
        return demoBlock(p.type, p.at, manifests.get(p.type), p.preset);
      });
  }
  const appended = pageTypes.filter((t) => !planned.has(t));
  const home = pages.find((p) => p.slug === 'home');
  if (home && appended.length) {
    // 放在首页最后一块（cta）之前，别把收尾那一块挤到中间。
    const tail = home.sections.length && home.sections[home.sections.length - 1].type === 'cta' ? [home.sections.pop()] : [];
    for (const t of appended) home.sections.push(demoBlock(t, null, manifests.get(t)));
    home.sections.push(...tail);
  }
  return { placed: [...planned], appended };
}

/**
 * 演示内容里指向示例站**没有**的页面的站内链接（`/warranty` · `/reviews` · `/services/brakes` …）改指到有的页上：
 * `/services/…` → `/services`，其余 → `/contact`。只动 `href` 字符串和正文里 Markdown 链接的地址，文字一个字不改。
 * `slugs` 是站里有的页（`home` 记作 `/`），`extra` 是另外存在的路径（有博客文章时的 `/blog`）。回改了几处。
 */
function retargetDeadLinks(pages, slugs, extra = []) {
  const live = new Set([...slugs.map((s) => (s === 'home' ? '/' : `/${s}`)), ...extra]);
  const fix = (href) => {
    if (typeof href !== 'string' || !href.startsWith('/') || href.startsWith('//')) return href;
    const pathOnly = href.split(/[?#]/)[0].replace(/\/+$/, '') || '/';
    if (live.has(pathOnly)) return href;
    return pathOnly.startsWith('/services') && live.has('/services') ? '/services' : '/contact';
  };
  let n = 0;
  const walk = (v) => {
    if (Array.isArray(v)) return v.map(walk);
    if (!v || typeof v !== 'object') return v;
    for (const [k, x] of Object.entries(v)) {
      if (k === 'href' && typeof x === 'string') {
        const y = fix(x);
        if (y !== x) { v[k] = y; n += 1; }
      } else if (typeof x === 'string' && x.includes('](/')) {
        v[k] = x.replace(/\]\((\/[^)\s]*)\)/g, (m, h) => {
          const y = fix(h);
          if (y === h) return m;
          n += 1;
          return `](${y})`;
        });
      } else {
        walk(x);
      }
    }
    return v;
  };
  for (const page of pages) walk(page.sections);
  return n;
}

/**
 * 演示内容里那家演示生意的名字（`Northside Auto Care`）换成这个站的生意名。只换整段名字，不碰别的字。
 * 回换了几处。
 */
function renameDemoBusiness(node, name) {
  if (typeof name !== 'string' || !name.trim() || name === SITE) return 0;
  let n = 0;
  const walk = (v) => {
    if (Array.isArray(v)) {
      v.forEach((x, i) => { if (typeof x === 'string' && x.includes(SITE)) { v[i] = x.split(SITE).join(name); n += 1; } else walk(x); });
    } else if (v && typeof v === 'object') {
      for (const k of Object.keys(v)) {
        const x = v[k];
        if (typeof x === 'string' && x.includes(SITE)) { v[k] = x.split(SITE).join(name); n += 1; } else walk(x);
      }
    }
  };
  walk(node);
  return n;
}

/** 示例站的博客文章（blog 块只从站点博客读，站里没文章它就整块不画）。深拷贝。 */
function demoBlogPosts() {
  return clone(DEMO_BLOG_POSTS);
}

module.exports = { PAGE_PLAN, SHELL_BLOCKS, demoSitePages, retargetDeadLinks, renameDemoBusiness, demoBlogPosts };
