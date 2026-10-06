'use strict';
// #1596 —— 付钱之后「某一步没做好」不再让整站失败：AI 那一步没给出能用的东西时，代码拼一份顶上。
//
//   fallbackSitePlan   站级规划那一通失败（第 1–4 条）/ 回包里没有页面（第 5 条）时的站级计划
//   fallbackPages      上面那份计划里的页面清单：home + services + 每个服务一页 services/<id> + contact
//   skeletonSections   一页两次都生成失败（第 6 条）时那一页的「骨架页」
//   missingBlockTypes  整站块库检查「整个站里没有 X」那几条里的 X（第 7 条 degraded 的 target）
//
// 🔴 只用中性句式，事实只从 payload / 站级计划取（判据是 create-site.js 提示词里那条 FACTS_ONLY_FROM_FORM_RULE：
//    它管的是年份、执照认证、价格、评价数、服务区域这类**事实**，不管句式）。
//    · 不取 `lib/demo-content` 的 DEMO_CONTENT —— 那是一家多伦多汽修店的真事实（OMVIC / CAA、4.9 分 612 条评价、员工名、价格），
//      文件头写着「不进真客户的站」（#1620 起只有 skipAI 示例站用它）；而骨架页跳过 seoPass，没有别的检查会拦它。
//    · `getDemoConfig` 里编出来的几项（Toronto 的 areaServed / addresses、营业时间、`$$`、hello@demo.com、123 Demo Street、
//      416-555-0000、「Greater Toronto Area」那两句）一项都不抄：payload 有就用 payload 的，没有就不写。
//    · 通用句式是英文 ⟹ 中文站的骨架页是英文占位（正文接受：这种情况以前是整站失败）。
// T9 #1601 落地后，页面清单由行业配方给，这里那份换掉。

const { assignKeywordSlugs } = require('./keyword-slug');
const { descriptionRange, fitDescription } = require('./description-fit');

const str = (v) => (typeof v === 'string' ? v.trim() : '');

/** payload 的服务名（字符串数组；对象形状也认 `name`），去空去重。 */
function serviceNames(services) {
  const out = [];
  for (const s of Array.isArray(services) ? services : []) {
    const name = str(typeof s === 'string' ? s : s && s.name);
    if (name && !out.includes(name)) out.push(name);
  }
  return out;
}

/** 服务名 → `{ id, name }`。id 用关键词页那套转写（中文 → 拼音），转写不了的叫 `service-<序号>`。 */
function serviceIdsFor(names) {
  const taken = new Set();
  return assignKeywordSlugs(names).map(({ keyword, slug, fallback }, i) => {
    let id = fallback ? `service-${i + 1}` : slug;
    for (let n = 2; taken.has(id); n += 1) id = `${fallback ? `service-${i + 1}` : slug}-${n}`;
    taken.add(id);
    return { id, name: keyword };
  });
}

/**
 * 代码写的 meta description：落在 §descriptionRange(locale) 目标区间内（#1549 r4 起检查只拦更宽的底线区间，目标区间必在其内），否则每页都要触发一次
 * SEO 修补、多记一条 `seo` 降级，把真正那条 `site-plan` 降级淹在建站报告的降级清单里（#1596 r4，PM 2026-10-06 C）。
 * 句子本身都长过拉丁下限 70；超了上限就按 §fitDescription 那套裁（中日韩 80）。
 */
function fittedDescription(text, locale) {
  const out = fitDescription(text, { locale });
  const { min } = descriptionRange(locale);
  return [...out].length >= min ? out : `${out} Get in touch with our team today to learn more.`.slice(0, descriptionRange(locale).max);
}

/**
 * 站级计划的页面清单。`services` = `[{ id, name }]`（AI 回包里的服务，或 payload 拼出来的）。
 * 链接只指向这份清单里有的页：没有 about / quote，按钮一律指 /contact。
 * `location`（payload 的地点）有就写进 description，`locale` 是站的主语言（定 description 的长度区间）。
 */
function fallbackPages({ companyName, services, location, locale }) {
  const svc = (Array.isArray(services) ? services : []).filter((s) => s && str(s.id));
  const inLoc = str(location) ? ` in ${str(location)}` : '';
  const desc = (text) => fittedDescription(text, locale);
  const pages = [
    { slug: 'home', title: 'Home', description: desc(`Welcome to ${companyName}${inLoc}. Learn what we offer, how we work and how to reach our team, then get in touch with us today.`), navLabel: 'Home', navOrder: 0, changeFrequency: 'weekly', priority: 1 },
    { slug: 'services', title: 'Our Services', description: desc(`Explore the services ${companyName} offers${inLoc}. See what each one covers and get in touch with our team to find the right fit for you.`), navLabel: 'Services', navOrder: 1, changeFrequency: 'monthly', priority: 0.8 },
    ...svc.map((s, i) => ({
      slug: `services/${s.id}`, title: str(s.name) || s.id,
      description: desc(`${str(s.name) || s.id} from ${companyName}${inLoc}. Find out what this service covers and how it works, then get in touch with our team to get started.`),
      navLabel: str(s.name) || s.id,
      navOrder: 10 + i, changeFrequency: 'monthly', priority: 0.8, serviceDetailPage: true, parentService: s.id,
    })),
    { slug: 'contact', title: 'Contact Us', description: desc(`Get in touch with ${companyName}${inLoc}. Send us a message with your details and questions, and our team will get back to you shortly.`), navLabel: 'Contact', navOrder: 2, changeFrequency: 'monthly', priority: 0.7 },
  ];
  return pages;
}

/**
 * 站级规划那一通整个没成时（第 1–4 条）的站级计划，形状同那一通的回包（create-site.js §generateContent 往下读的那些字段）。
 * 之后每页那一通照常调 AI —— 这里只定页面清单和站级字段。
 */
function fallbackSitePlan({ companyName, services, location, address, phone, email, locale }) {
  const loc = str(location);
  const addr = str(address);
  const tel = str(phone);
  const mail = str(email);
  const svc = serviceIdsFor(serviceNames(services)).map(({ id, name }) => ({
    id, name, shortDescription: `${name} by ${companyName}.`, fullDescription: '', icon: 'shield-check', features: [], products: [],
  }));
  const brand = { tagline: 'Your trusted local business', logoIcon: 'shield-check' };
  if (mail) brand.email = mail;
  // 没给的那一格不写（BrandLocation 的 address / phone 可以没有）；两样都没给 ⟹ 空数组 —— brand.json 的 locations 是必填项，
  // 而读它的地方（JsonLd · contact-facts · item-sources · geocode）对空数组都按「没有地点」处理。
  brand.locations = addr || tel ? [{ label: 'Main Office', ...(addr ? { address: addr } : {}), ...(tel ? { phone: tel } : {}) }] : [];
  return {
    brand,
    navigation: { ctaLabel: 'Contact Us', ctaPage: 'contact', footerDescription: `${companyName} — Your trusted local business.` },
    seo: {
      siteTitle: `${companyName} — Professional Services`,
      // 首页的 description 就是这一句（SEO 检查第 2 条首页读 siteDescription）⟹ 同样落在区间内。
      siteDescription: fittedDescription(`${companyName} provides professional services${loc ? ` in ${loc}` : ''}. Learn what we offer and how we work, then get in touch with our team today.`, locale),
      // 营业时间、价位不写（payload 给了也是原样文本，核不了 —— 那是站级那一通 + verifyTranscription 的事）。
      // 🔴 不写 = 键不在（seo.schema 的 priceRange / openingHours 是可选项）；areaServed / addresses 是必填的数组，没有就写空数组
      //    —— 写成「键不在」的话 JsonLd.tsx 的 `.map` 会在构建时直接抛（#1596 r2：QA2 真跑 next build 抓到的就是这一族）。
      areaServed: loc ? [{ type: 'City', name: loc }] : [],
      addresses: [],
      offerCatalogName: 'Services',
    },
    services: svc,
    pages: fallbackPages({ companyName, services: svc, location: loc, locale }),
  };
}

/**
 * 本站页面清单里第一个存在的联系页（contact → quote → 站的 CTA 页），都没有就回首页。
 * #1623 —— 命中的是 `home` 时路径是 `/`（首页的真实路由），不是 `/home`：配方关掉 contact 时 ctaPage 就是 `home`。
 */
function contactHrefOf(sitePages, ctaPage) {
  const slugs = new Set((Array.isArray(sitePages) ? sitePages : []).map((p) => p && p.slug));
  for (const s of ['contact', 'quote', str(ctaPage)]) if (s && slugs.has(s)) return s === 'home' ? '/' : `/${s}`;
  return '/';
}

/**
 * 骨架页（第 6 条）：那一页两次都生成失败时发出去的块。块与句式照 `getDemoConfig` 那几页，`Demo Company` 换成 companyName：
 *   首页            hero · features（服务引用）· cta · contact —— 不走首页配方（配方的开场块有 reviews / team / pricing 这类
 *                   按构造没有中性内容可填的块）
 *   服务详情页      page-header · features（服务引用）· cta
 *   contact / quote page-header · contact
 *   其他页          page-header · content · cta
 * page-header 用这一页在站级计划里的 title / description；content 用 brief，没有就一句通用话。关掉的块不出现。
 */
function skeletonSections(page, { companyName, sitePages, ctaPage, disabledBlocks = [] }) {
  const off = new Set(disabledBlocks);
  const contactHref = contactHrefOf(sitePages, ctaPage);
  const title = str(page.title) || str(page.navLabel) || page.slug;
  const cta = { type: 'cta', data: { headline: 'Ready to get started?', body: 'Contact us today and we will get back to you shortly.', ctas: [{ label: 'Contact Us', href: contactHref, style: 'solid' }] } };
  const header = { type: 'page-header', data: { headline: title, ...(str(page.description) ? { subheadline: str(page.description) } : {}) } };
  const services = (headline) => ({ type: 'features', data: { headline, ...(headline === 'Why Choose Us' ? { body: 'What sets us apart from the rest' } : {}), items: { source: 'services' } } });
  const contact = (form) => ({ type: 'contact', data: { headline: 'Get in touch', body: 'Leave your details and we will reach out soon.', form, options: { form: 'full' } } });
  let blocks;
  if (page.slug === 'home') {
    blocks = [
      { type: 'hero', data: { headline: `Welcome to ${companyName}`, subheadline: 'Your trusted local business partner', ctas: [{ label: 'Get Started', href: contactHref, style: 'solid' }, { label: 'Learn More', href: contactHref, style: 'outline' }] } },
      services('Why Choose Us'),
      cta,
      { type: 'contact', data: { headline: 'Contact us', body: "Leave your details and we'll get back to you shortly.", form: { id: 'contact' }, options: { form: 'full' } } },
    ];
  } else if (page.serviceDetailPage === true) {
    blocks = [header, services('What we do'), cta];
  } else if (page.slug === 'contact' || page.slug === 'quote') {
    blocks = [header, contact(page.slug === 'quote' ? {} : { id: 'contact' })];
  } else {
    blocks = [header, { type: 'content', data: { body: str(page.brief) || `Get in touch with ${companyName} to learn more.`, options: { textStyle: 'article' } } }, cta];
  }
  return blocks.filter((b) => !off.has(b.type));
}

/** 整站块库检查的问题里「整个站里没有 "X"」的那几个 X（lib/block-manifest.js §validateSite 的原文）。 */
function missingBlockTypes(problems) {
  const out = [];
  for (const p of Array.isArray(problems) ? problems : []) {
    const m = /整个站里没有 "([^"]+)"/.exec(String(p));
    if (m && !out.includes(m[1])) out.push(m[1]);
  }
  return out;
}

module.exports = { serviceNames, serviceIdsFor, fittedDescription, fallbackPages, fallbackSitePlan, skeletonSections, missingBlockTypes, contactHrefOf };
