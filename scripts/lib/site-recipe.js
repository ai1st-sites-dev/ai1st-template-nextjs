'use strict';
// #1601 —— 整站配方：页面清单与每页的块序由行业配方给，AI 只填内容。
//
// 首页不在这里排块：首页沿用 #1034 的首页开场配方（lib/homepage-recipe.js），这里只说「有首页」。
// 关键词页也不在这里：它们由 SEO T6 #1550 的计划定，建站后半段（Call 2）才加进站里。
//
// 分组沿用主题那一侧的 16 个行业组（theme-pipeline/industry-sectors.js §SECTORS，按 sectorIndexForIndustry 判组），
// 不另造分类。认不出组的行业（老板填的自由文本，例如 `pet grooming`）走 DEFAULT_RECIPE，不报错。
//
// 每份配方必有：首页、每个服务一张服务页 `services/<id>`、`contact`（行动按钮的落点 —— contact 块没有锚点，
// 「跳到首页的表单」这条路不存在）。顶部导航必须到得了每一张服务页：服务页按构造不进顶部导航
// （create-site.js 的 regularPages），所以每份配方都带一张 `services` 列表页放进导航，它的 features 写
// `items: {source: "services"}`，展开时每一项带上链到那张服务页的「了解更多」（lib/item-sources.js）。
//
// 块的预设只选不靠图片撑场的那几个（图片槽由后面的生图那一步补，补不上时这一页仍要站得住）。
// 例外是服务页的页头（#1627）：它用带图的预设，一张服务页一张主图（Chris 2026-10-06：「服务页有张主图才像一家店」）。
// 补不上时 page-header 照样站得住 —— 没有 imageUrl 就不画 <img>（blocks/page-header/Section.tsx）。

const { SECTORS, sectorIndexForIndustry } = require('../theme-pipeline/industry-sectors');
const { presetsOf, presetKnobs } = require('./header-knobs');

const CTA_PAGE = 'contact';

// ── 页面原型 ──────────────────────────────────────────────────────────────────────────────────────
// `core` = 这一页为它而存在的那个块：后台关掉它 ⟹ 整页不要（一个 FAQ 页没有 faq 块就不是 FAQ 页）。
// `note` = 写进每页那一通提示词的一句话，说这个块在这一页上写什么。
const b = (type, preset, note) => (note ? { type, preset, note } : { type, preset });

const PAGE_DEFAULTS = {
  services: { title: 'Services', navLabel: 'Services', navOrder: 1, changeFrequency: 'monthly', priority: 0.9 },
  about: { title: 'About Us', navLabel: 'About', navOrder: 2, changeFrequency: 'monthly', priority: 0.7 },
  faq: { title: 'FAQ', navLabel: 'FAQ', navOrder: 3, changeFrequency: 'monthly', priority: 0.6 },
  contact: { title: 'Contact Us', navLabel: 'Contact', navOrder: 9, changeFrequency: 'monthly', priority: 0.7 },
};

const CORE = { services: 'features', about: 'content', faq: 'faq', contact: 'contact', service: 'content' };

const SERVICES_NOTE = 'write "items": {"source": "services"} — the list comes from this website\'s services, never type them out';

/**
 * 一组的配方。`opt` 是这一组的取舍；块序与预设都从这几个参数派生，16 组之间只差这几处。
 *   about / faq   开不开这两页
 *   look          这一组的预设：{ header, serviceHeader, features, faq, cta, contact }
 *                 serviceHeader 只给服务页（#1627，带图）；其余页的页头用 header（不带图）
 *   steps         服务页的卖点那一块写成步骤（"01" "02"…），给按流程干活的行当
 */
function recipe({ about, faq, look, steps = false, why }) {
  const header = b('page-header', look.header);
  const cta = b('cta', look.cta);
  const pages = {
    services: [header, b('features', look.features, SERVICES_NOTE), cta],
    contact: [header, b('contact', look.contact, 'the lead form: write "form": { "id": "contact" } and "options": { "form": "full" }')],
  };
  if (about) pages.about = [header, b('content', 'Article', 'the business\'s own story, written as an article'), b('features', look.features, 'what customers can count on — 3-4 points'), cta];
  if (faq) pages.faq = [header, b('faq', look.faq, '6-8 questions customers really ask this kind of business'), cta];
  return {
    why,
    pages,
    // 服务页：每个服务一张，块序相同（文案各写各的）。
    service: [
      b('page-header', look.serviceHeader),
      b('content', 'Article', 'what this service is and who it is for'),
      b('features', steps ? 'Steps' : look.features, steps ? 'how the job is done, as steps numbered "01" "02"…' : 'the selling points of this service'),
      b('faq', look.faq, '3-5 questions about this service'),
      cta,
    ],
    // 顶部导航放哪几页（首页恒在最前；行动按钮那一页不进链接，它是按钮）。
    nav: ['services', ...(about ? ['about'] : []), ...(faq ? ['faq'] : [])],
    ctaPage: CTA_PAGE,
  };
}

const QUIET = { header: 'Simple', serviceHeader: 'Photo', features: 'Side intro', faq: 'Side intro', cta: 'Boxed', contact: 'Details beside' };
const SOFT = { header: 'Centered', serviceHeader: 'Photo', features: 'Cards', faq: 'Accordion', cta: 'Centered', contact: 'Form beside' };
const BOLD = { header: 'Simple', serviceHeader: 'Photo', features: 'Grid', faq: 'Cards', cta: 'Inline', contact: 'Form beside' };
const WARM = { header: 'Centered', serviceHeader: 'Photo', features: 'Grid', faq: 'Accordion', cta: 'Boxed', contact: 'Stacked' };

// 16 组。每组一行理由：为什么开 / 不开 about、faq（给下一个读它的人，和图册那条线）。
const SITE_RECIPES = {
  'legal-professional': recipe({ about: true, faq: true, look: QUIET, why: '资历与执照就是成交理由 ⟹ about；流程与收费的问题多 ⟹ faq。' }),
  'finance-insurance': recipe({ about: true, faq: true, look: QUIET, why: '高单价的信任生意要先认人 ⟹ about；条款与理赔问题多 ⟹ faq。' }),
  'real-estate': recipe({ about: true, faq: false, look: QUIET, why: '经纪人本人就是招牌 ⟹ about；问题因房而异，放在服务页里答，不单开 faq。' }),
  clinic: recipe({ about: true, faq: true, look: SOFT, why: '医生资质要摆出来 ⟹ about；保险、初诊、急诊的问题多 ⟹ faq。' }),
  'wellness-care': recipe({ about: true, faq: true, look: SOFT, why: '照护是托付 ⟹ about 讲人；第一次来的人顾虑多 ⟹ faq。' }),
  beauty: recipe({ about: false, faq: false, look: SOFT, why: 'Chris 2026-10-05：7 服务发廊 = 首页 + 7 张服务页（设计文档 B5）；客人看的是服务本身，故事与问答放首页和服务页里。' }),
  dining: recipe({ about: true, faq: false, look: WARM, why: '店的故事是吃饭的理由之一 ⟹ about；订位、营业时间写在首页与 contact，不单开 faq。' }),
  'artisan-food': recipe({ about: true, faq: false, look: WARM, why: '手作的来历就是卖点 ⟹ about；问题少，不单开 faq。' }),
  'fitness-water': recipe({ about: false, faq: true, look: BOLD, why: '会籍、课程、第一次怎么来的问题多 ⟹ faq；教练放服务页，不单开 about。' }),
  'home-trades': recipe({ about: false, faq: true, look: BOLD, steps: true, why: '上门、报价、保修的问题多 ⟹ faq；按流程干活 ⟹ 服务页卖点写成步骤；客人不为故事下单，不开 about。' }),
  'green-outdoor': recipe({ about: false, faq: true, look: BOLD, steps: true, why: '季节、报价、上门的问题多 ⟹ faq；按流程干活 ⟹ 步骤；不开 about。' }),
  'auto-transport': recipe({ about: false, faq: true, look: BOLD, steps: true, why: '报价、工期、保修的问题多 ⟹ faq；按流程干活 ⟹ 步骤；不开 about。' }),
  'industrial-safety': recipe({ about: true, faq: true, look: QUIET, steps: true, why: '资质认证是门槛 ⟹ about；规范与交付的问题多 ⟹ faq；按流程交付 ⟹ 步骤。' }),
  'tech-media': recipe({ about: true, faq: false, look: BOLD, why: '买的是团队 ⟹ about；问题因项目而异，不单开 faq。' }),
  events: recipe({ about: false, faq: true, look: WARM, why: '档期、定金、流程的问题多 ⟹ faq；作品放首页与服务页，不开 about。' }),
  'retail-lifestyle': recipe({ about: true, faq: false, look: WARM, why: '店的品味就是卖点 ⟹ about；退换货等问题少，不单开 faq。' }),
};

// 认不出组的行业：信息最少，给最稳的那一份 —— about 讲是谁，问题不知道是哪一类，不开 faq。
const DEFAULT_RECIPE = recipe({ about: true, faq: false, look: SOFT, why: '行业认不出来：about 说清是谁；不知道客人会问什么，不开 faq。' });

/** 行业 → 那一组的配方（原样数据，不按服务展开）。认不出组 ⟹ 默认配方，`sector` 为 null。 */
function siteRecipeForIndustry(industry) {
  const i = sectorIndexForIndustry(industry || '');
  const sector = i >= 0 ? SECTORS[i].key : null;
  return { sector, recipe: (sector && SITE_RECIPES[sector]) || DEFAULT_RECIPE };
}

/**
 * 行业 + 服务清单 → 这个站的页面清单（#1596 的兜底也调它）。
 * @param {string} industry
 * @param {{ services?: Array<string|{id: string, name?: string}>, disabledBlocks?: string[] }} opts
 *   services 给对象时用它的 `id`（站级回包里的服务）；给字符串时那就是 id。
 * @returns {{ sector: string|null, pages: Array<{slug: string, kind: string, blocks: {type: string, preset: string, note?: string}[],
 *   serviceDetailPage?: true, parentService?: string}>, nav: string[], ctaPage: string }}
 *   pages 顺序：home · services · about · faq · 每个服务 · contact。home 的 `blocks` 是空的 —— 首页归 #1034 的配方。
 *
 * 后台关掉的块（同 #1346 在 skipAI 那条路上的写法）：从块序里拿掉；一页的 `core` 块被关、或拿空了 ⟹ 整页不要。
 * 拿掉的页从导航里一起拿掉；`contact` 没了 ⟹ 按钮指首页（不留死链）。
 *
 * 🔴 `nav` 恒等于「普通页（非首页、非服务页）里除了按钮那一页」—— 因为 sync-config.js 每次构建都按这条规则重排顶部导航
 *    （§Auto-generate navigation），写别的也会被构建覆盖。所以 `features` 被后台关掉、`services` 列表页随之拿掉时，
 *    顶部导航到不了服务页（只剩页脚那一栏）—— 这跟今天关掉 features 时一样，配方不在这里假装做得到。
 */
function sitePagesFor(industry, { services = [], disabledBlocks = [] } = {}) {
  const { sector, recipe: r } = siteRecipeForIndustry(industry);
  const off = new Set(disabledBlocks);
  const keep = (kind, blocks) => {
    if (off.has(CORE[kind])) return null;
    const left = blocks.filter((x) => !off.has(x.type)).map((x) => ({ ...x }));
    return left.length ? left : null;
  };
  const pages = [{ slug: 'home', kind: 'home', blocks: [] }];
  for (const kind of ['services', 'about', 'faq']) {
    if (!r.pages[kind]) continue;
    const blocks = keep(kind, r.pages[kind]);
    if (blocks) pages.push({ slug: kind, kind, blocks });
  }
  const ids = [...new Set((Array.isArray(services) ? services : [])
    .map((s) => (typeof s === 'string' ? s : s && s.id))
    .filter((id) => typeof id === 'string' && id.trim()))];
  for (const id of ids) {
    const blocks = keep('service', r.service);
    if (blocks) pages.push({ slug: `services/${id}`, kind: 'service', blocks, serviceDetailPage: true, parentService: id });
  }
  const contact = keep('contact', r.pages.contact);
  if (contact) pages.push({ slug: 'contact', kind: 'contact', blocks: contact });

  const has = new Set(pages.map((p) => p.slug));
  return { sector, pages, nav: r.nav.filter((slug) => has.has(slug)), ctaPage: has.has(r.ctaPage) ? r.ctaPage : 'home' };
}

/** 一页的块序在提示词里的写法：`"page-header" → "features" → "cta"`。 */
function blockOrderLine(blocks) {
  return blocks.map((x) => `"${x.type}"`).join(' → ');
}

/** AI 写回来的块序跟配方对不对得上；对得上回 []，否则回一条问题（进块库那一组，触发同一次重试）。 */
function blockOrderProblems(sections, blocks) {
  const got = (Array.isArray(sections) ? sections : []).map((s) => (s && s.type) || '?');
  const want = blocks.map((x) => x.type);
  if (got.length === want.length && got.every((t, i) => t === want[i])) return [];
  return [`this page's sections must be exactly ${blockOrderLine(blocks)}, in this order (got ${got.map((t) => `"${t}"`).join(' → ') || 'none'})`];
}

/**
 * 把配方给的预设写进每块的 `options`（覆盖 AI 写的同名旋钮；别的键原样留着）。预设靠旋钮值认（header-knobs §presetOf），
 * 所以写旋钮就是选了那个预设。`manifests` = block-manifest §loadManifests 的那张表。回改了几块。
 */
function applyPresets(sections, blocks, manifests) {
  let n = 0;
  (Array.isArray(sections) ? sections : []).forEach((sec, i) => {
    const want = blocks[i];
    if (!sec || !want || sec.type !== want.type) return;
    const knobs = presetKnobs(presetsOf(manifests.get(want.type)), want.preset);
    if (!knobs) return;
    sec.data = sec.data && typeof sec.data === 'object' ? sec.data : {};
    const opts = sec.data.options && typeof sec.data.options === 'object' && !Array.isArray(sec.data.options) ? sec.data.options : {};
    sec.data.options = { ...opts, ...knobs };
    n += 1;
  });
  return n;
}

module.exports = {
  applyPresets,
  SITE_RECIPES,
  DEFAULT_RECIPE,
  PAGE_DEFAULTS,
  CTA_PAGE,
  siteRecipeForIndustry,
  sitePagesFor,
  blockOrderLine,
  blockOrderProblems,
};
