'use strict';
// #1979（Epic:MultiLocation T4）—— 两个及以上地点的网站：地点总览页 + 每个地点一页 + 菜单一项 Locations + 首页一块全部地点。
//
// 🔴 **纯函数那一半**（§locationPagesPatch）：content 进、补丁出（键 = site/ 下的相对路径，值 = 整份文件 / null = 删掉）。
//    不读盘、不调 AI。调 AI 的那一半（§runLocationPages）只多一步「给缺页面的地点要介绍」，AI 是传进来的函数。
//    三个调用方：建站（`create-site.js` §addLocationPages，站级那一通之后、写完全部语言之后）、
//    命令 `site.js location-pages`（§locationPagesCommand，T5 的 manager 改地点后调）、单测。
//
// 规则（正文 §做什么 1 / 4 / 6）：
//   · 地点 ≥2：每种语言一张总览页 `<语言>/pages/locations.json`（顶层 `locationPage: {kind:"overview"}`）+ 每个地点一张
//     `<语言>/pages/locations/<slug>.json`（`locationPage: {kind:"location", id}`）。已经有标记页的不重建（按标记认，不按 slug 认：
//     老板改过的页原样留着）。
//   · 总览页**是这一次新建的**那种语言：菜单 `header.links` 末尾加一项指向 `/locations`、首页第一个 cta 之前加一块
//     Compact 形态的 contact（块顶层 `locationsAuto: true`）。总览页已经在 ⟹ 菜单、首页都不碰（老板拿掉了就一直拿掉）。
//   · 地点 <2：删掉所有带 `locationPage` 标记的页、指向那张总览页的菜单项、首页带 `locationsAuto` 的块。没有标记的页一张不碰。
//   · 地点没了（还剩 ≥2 家）：它那张标记页跟着删（指向一个不存在的地点，contact 块整块不画，页面只剩空壳）。
//   · slug：这一家已有 `slug` 就用；没有就 `keywordSlug(city)`（没有 city 用 label），跟别家重复改成 `keywordSlug(city + " " +
//     streetAddress)`，仍重复用 `withDedupSuffix`；跟一张没有标记（或标记是别家）的已有页撞了也加后缀；转写不了用地点 id。
//     算出来写回 `brand.locations[i].slug`，以后不再改。
//   · 地点页的评价 = `brand.locations[i].reviews` 原样（建站时由 §storeLocationReviews 存，不经 AI）；没有就不放 testimonials 块。
//
// 🔴 块标记 `locationsAuto` 写在**块顶层**（跟 `type` / `shape` 同级），不在 `data` 里：`data` 顶层的键必须是 manifest 的槽
//    （`block-manifest.js` §validateSite），而槽会进 AI 的提示词和编辑器面板 —— 这个标记谁都不该写、不该改。
//    校验在 `validateSite`（只许 contact 块带、只许 `true`）。编辑器存盘只把字段合回原始那一条（`editor-convert.js` 文件头），
//    顶层键原样留着。

const { keywordSlug, withDedupSuffix } = require('./keyword-slug');
const { withLocationIds } = require('./locations');
const { pageWithBlocks, roleFor, effectiveWeight } = require('../blocks');

const OVERVIEW_SLUG = 'locations';
const OVERVIEW_HREF = `/${OVERVIEW_SLUG}`;
const DEFAULT_MODEL = 'claude-sonnet-4-6'; // 同 create-site.js / seo-refresh.js 的缺省

const isObj = (v) => !!v && typeof v === 'object' && !Array.isArray(v);
const str = (v) => (typeof v === 'string' ? v.trim() : '');
const clone = (v) => JSON.parse(JSON.stringify(v));
const parsed = (content, rel) => (typeof content[rel] === 'string' ? JSON.parse(content[rel]) : content[rel]);
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

/** 页面 JSON 带地点页标记吗（总览 / 地点页两种都算）。菜单同步（`derive-core.js` §syncNavigation）也问它：标记页不自动进菜单。 */
function isLocationPage(page) {
  return isObj(page) && isObj(page.locationPage);
}

// ── 代码写的那几行字（不经 AI）：块标题、联系方式三项的标题、按钮。每种语言一行，查不到落回英文 ─────────────────────────
// 语言同 `src/lib/component-labels.ts`（多一个 zh-tw）。`menu` 只在没有 AI 给的菜单字时用（skipAI / AI 没给）。
const LABELS = {
  en: { menu: 'Locations', overviewTitle: 'Our locations', overviewSub: 'Find the location nearest you.', visit: 'Visit us', address: 'Address', phone: 'Phone', hours: 'Hours', reviews: 'What our customers say', ctaTitle: 'Ready to visit?', ctaButton: 'Contact us' },
  zh: { menu: '门店', overviewTitle: '我们的门店', overviewSub: '找到离您最近的门店。', visit: '欢迎光临', address: '地址', phone: '电话', hours: '营业时间', reviews: '顾客评价', ctaTitle: '准备好来店了吗？', ctaButton: '联系我们' },
  'zh-tw': { menu: '門市', overviewTitle: '我們的門市', overviewSub: '找到離您最近的門市。', visit: '歡迎光臨', address: '地址', phone: '電話', hours: '營業時間', reviews: '顧客評價', ctaTitle: '準備好來店了嗎？', ctaButton: '聯絡我們' },
  fr: { menu: 'Emplacements', overviewTitle: 'Nos emplacements', overviewSub: 'Trouvez l’emplacement le plus proche de chez vous.', visit: 'Venez nous voir', address: 'Adresse', phone: 'Téléphone', hours: 'Heures d’ouverture', reviews: 'Ce que disent nos clients', ctaTitle: 'Prêt à nous rendre visite ?', ctaButton: 'Contactez-nous' },
  es: { menu: 'Ubicaciones', overviewTitle: 'Nuestras ubicaciones', overviewSub: 'Encuentre la ubicación más cercana.', visit: 'Visítenos', address: 'Dirección', phone: 'Teléfono', hours: 'Horario', reviews: 'Lo que dicen nuestros clientes', ctaTitle: '¿Listo para visitarnos?', ctaButton: 'Contáctenos' },
  ja: { menu: '店舗一覧', overviewTitle: '店舗一覧', overviewSub: 'お近くの店舗をお探しください。', visit: 'ご来店ください', address: '住所', phone: '電話', hours: '営業時間', reviews: 'お客様の声', ctaTitle: 'ご来店をお待ちしています', ctaButton: 'お問い合わせ' },
  ko: { menu: '지점', overviewTitle: '지점 안내', overviewSub: '가장 가까운 지점을 찾아보세요.', visit: '방문 안내', address: '주소', phone: '전화', hours: '영업시간', reviews: '고객 후기', ctaTitle: '방문할 준비가 되셨나요?', ctaButton: '문의하기' },
  de: { menu: 'Standorte', overviewTitle: 'Unsere Standorte', overviewSub: 'Finden Sie den Standort in Ihrer Nähe.', visit: 'Besuchen Sie uns', address: 'Adresse', phone: 'Telefon', hours: 'Öffnungszeiten', reviews: 'Das sagen unsere Kunden', ctaTitle: 'Bereit für einen Besuch?', ctaButton: 'Kontakt aufnehmen' },
  it: { menu: 'Sedi', overviewTitle: 'Le nostre sedi', overviewSub: 'Trova la sede più vicina a te.', visit: 'Vieni a trovarci', address: 'Indirizzo', phone: 'Telefono', hours: 'Orari', reviews: 'Cosa dicono i nostri clienti', ctaTitle: 'Pronto a venirci a trovare?', ctaButton: 'Contattaci' },
  pt: { menu: 'Unidades', overviewTitle: 'Nossas unidades', overviewSub: 'Encontre a unidade mais próxima de você.', visit: 'Visite-nos', address: 'Endereço', phone: 'Telefone', hours: 'Horário', reviews: 'O que dizem nossos clientes', ctaTitle: 'Pronto para nos visitar?', ctaButton: 'Fale conosco' },
  ru: { menu: 'Филиалы', overviewTitle: 'Наши филиалы', overviewSub: 'Найдите ближайший к вам филиал.', visit: 'Ждём вас', address: 'Адрес', phone: 'Телефон', hours: 'Часы работы', reviews: 'Отзывы клиентов', ctaTitle: 'Готовы прийти к нам?', ctaButton: 'Связаться с нами' },
  vi: { menu: 'Chi nhánh', overviewTitle: 'Các chi nhánh', overviewSub: 'Tìm chi nhánh gần bạn nhất.', visit: 'Ghé thăm chúng tôi', address: 'Địa chỉ', phone: 'Điện thoại', hours: 'Giờ mở cửa', reviews: 'Khách hàng nói gì', ctaTitle: 'Sẵn sàng ghé thăm?', ctaButton: 'Liên hệ' },
  ar: { menu: 'فروعنا', overviewTitle: 'فروعنا', overviewSub: 'اعثر على أقرب فرع إليك.', visit: 'تفضل بزيارتنا', address: 'العنوان', phone: 'الهاتف', hours: 'ساعات العمل', reviews: 'آراء عملائنا', ctaTitle: 'هل أنت مستعد لزيارتنا؟', ctaButton: 'تواصل معنا' },
  hi: { menu: 'शाखाएँ', overviewTitle: 'हमारी शाखाएँ', overviewSub: 'अपने सबसे नज़दीकी शाखा खोजें।', visit: 'हमसे मिलें', address: 'पता', phone: 'फ़ोन', hours: 'समय', reviews: 'हमारे ग्राहक क्या कहते हैं', ctaTitle: 'आने के लिए तैयार हैं?', ctaButton: 'संपर्क करें' },
  th: { menu: 'สาขา', overviewTitle: 'สาขาของเรา', overviewSub: 'ค้นหาสาขาที่ใกล้คุณที่สุด', visit: 'แวะมาหาเรา', address: 'ที่อยู่', phone: 'โทรศัพท์', hours: 'เวลาทำการ', reviews: 'เสียงจากลูกค้า', ctaTitle: 'พร้อมแวะมาหรือยัง?', ctaButton: 'ติดต่อเรา' },
};
const labelsFor = (locale) => ({ ...LABELS.en, ...(LABELS[locale] || {}) });

// 提示词里的语言名（同 create-site.js 那张 langMap）。
const LANGUAGE_NAMES = {
  en: 'English', zh: 'Simplified Chinese', 'zh-tw': 'Traditional Chinese', fr: 'French', es: 'Spanish', ja: 'Japanese', ko: 'Korean',
  de: 'German', it: 'Italian', pt: 'Portuguese', ru: 'Russian', vi: 'Vietnamese', ar: 'Arabic', hi: 'Hindi', th: 'Thai',
};

// ── 读站 ─────────────────────────────────────────────────────────────────────────────────────────

/** 这个站有哪几种语言、每种语言的文件前缀（老站没有 site_meta.json：只有一种、文件在根上）。 */
function siteLocales(content) {
  const meta = isObj(parsed(content, 'site_meta.json')) ? parsed(content, 'site_meta.json') : null;
  if (!meta) return { defaultLocale: 'en', locales: [{ locale: 'en', prefix: '' }] };
  const list = Array.isArray(meta.locales) && meta.locales.length ? meta.locales : [meta.defaultLocale || 'en'];
  return { defaultLocale: meta.defaultLocale || list[0], locales: list.map((l) => ({ locale: l, prefix: `${l}/` })) };
}

/** `brand.json` 的地点（补齐 id，同 `locations.js` §withLocationIds）。 */
function locationsOf(content) {
  const brand = isObj(parsed(content, 'brand.json')) ? parsed(content, 'brand.json') : {};
  return withLocationIds((Array.isArray(brand.locations) ? brand.locations : []).filter(isObj));
}

/** 这种语言的品牌名（`brand.name` 是 `{语言: 名}`，老站是字符串）。 */
function brandNameOf(content, locale, defaultLocale) {
  const brand = isObj(parsed(content, 'brand.json')) ? parsed(content, 'brand.json') : {};
  const n = brand.name;
  if (typeof n === 'string') return n.trim();
  if (isObj(n)) return str(n[locale]) || str(n[defaultLocale]) || str(Object.values(n).find((v) => str(v)));
  return '';
}

/** 一种语言的全部页：slug（由路径定）→ { rel, page }。 */
function pagesOf(content, prefix) {
  const dir = `${prefix}pages/`;
  const out = new Map();
  for (const rel of Object.keys(content)) {
    if (!rel.startsWith(dir) || !rel.endsWith('.json')) continue;
    const page = parsed(content, rel);
    if (isObj(page)) out.set(rel.slice(dir.length, -'.json'.length), { rel, page });
  }
  return out;
}

const locName = (loc) => str(loc.label) || str(loc.city) || str(loc.address) || loc.id;

// ── slug（§做什么 1）────────────────────────────────────────────────────────────────────────────

/**
 * 每个地点的 slug：id → slug。`blocked(slug)` = 这个 slug 在某种语言里已经是一张别的页（没有标记 / 标记是别家）。
 * 已存的 `slug` 原样（以后不再改）；其余按 city → city + streetAddress → withDedupSuffix 定（见文件头）。
 */
function assignSlugs(locations, blocked) {
  const out = new Map();
  const used = new Set();
  for (const l of locations) {
    if (str(l.slug)) { out.set(l.id, str(l.slug)); used.add(str(l.slug)); }
  }
  const pending = locations.filter((l) => !str(l.slug));
  const base = (l) => keywordSlug(str(l.city) || str(l.label));
  const bases = pending.map(base);
  for (const [i, l] of pending.entries()) {
    let stem = bases[i];
    const clash = stem && (used.has(stem) || bases.some((b, j) => j !== i && b === stem));
    if (clash && str(l.city) && str(l.streetAddress)) stem = keywordSlug(`${str(l.city)} ${str(l.streetAddress)}`) || stem;
    if (!stem) stem = keywordSlug(l.id) || 'location';
    let slug = stem;
    for (let n = 2; used.has(slug) || blocked(slug, l.id); n += 1) slug = withDedupSuffix(stem, n);
    used.add(slug);
    out.set(l.id, slug);
  }
  return out;
}

// ── 块 ───────────────────────────────────────────────────────────────────────────────────────────

const contactItems = (t) => [{ kind: 'address', title: t.address }, { kind: 'phone', title: t.phone }, { kind: 'hours', title: t.hours }];

/** 页尾那一块：有联系页就一颗按钮去联系页，没有就只留标题。 */
function ctaSection(t, hasContactPage) {
  return { type: 'cta', data: { headline: t.ctaTitle, ...(hasContactPage ? { ctas: [{ label: t.ctaButton, href: '/contact', style: 'solid' }] } : {}) } };
}

/** skipAI（或 AI 没给这一家）时的介绍：「<品牌名> <地点名> — <地址>」（正文 §3）。 */
function fallbackIntro(brandName, loc) {
  const head = [brandName, locName(loc)].filter(Boolean).join(' ');
  return str(loc.address) ? `${head} — ${str(loc.address)}` : head;
}

function overviewPage({ t, brandName, locations, hasContactPage }) {
  return pageWithBlocks({
    slug: OVERVIEW_SLUG,
    title: t.overviewTitle,
    description: [brandName, locations.map(locName).join(' · ')].filter(Boolean).join(' — '),
    navLabel: t.overviewTitle,
    changeFrequency: 'monthly',
    priority: 0.7,
    locationPage: { kind: 'overview' },
    sections: [
      { type: 'page-header', data: { headline: t.overviewTitle, subheadline: t.overviewSub } },
      { type: 'contact', shape: 'location-cards', data: { headline: t.visit, items: contactItems(t) } },
      ctaSection(t, hasContactPage),
    ],
  });
}

function locationPageOf({ t, slug, loc, intro, hasContactPage }) {
  const reviews = (Array.isArray(loc.reviews) ? loc.reviews : []).filter((r) => isObj(r) && str(r.quote));
  return pageWithBlocks({
    slug: `${OVERVIEW_SLUG}/${slug}`,
    title: locName(loc),
    description: intro.description,
    navLabel: locName(loc),
    changeFrequency: 'monthly',
    priority: 0.7,
    locationPage: { kind: 'location', id: loc.id },
    sections: [
      { type: 'page-header', data: { headline: locName(loc), ...(str(loc.address) ? { subheadline: str(loc.address) } : {}) } },
      { type: 'contact', shape: 'map-beside', data: { headline: t.visit, items: contactItems(t), location: loc.id } },
      { type: 'content', data: { body: intro.paragraphs.join('\n\n') } },
      ...(reviews.length ? [{ type: 'testimonials', data: { headline: t.reviews, items: clone(reviews) } }] : []),
      ctaSection(t, hasContactPage),
    ],
  });
}

/** 首页那一块（正文 §6）：插在第一个 cta 之前（权重取那个 cta 的，同权按数组先后 ⟹ 排在它前面）；一个 cta 都没有就追加在最后。 */
function withHomeLocationsBlock(home, t) {
  const page = clone(home);
  const blocks = Array.isArray(page.blocks) ? page.blocks : null;
  if (!blocks) return null; // 老 `sections` 形状的首页不动（今天的建站都写 blocks）
  const ids = new Set(blocks.map((b) => (isObj(b) ? b.id : null)).filter(Boolean));
  let id = 'home-contact-locations';
  for (let n = 2; ids.has(id); n += 1) id = `home-contact-locations-${n}`;
  const at = blocks.findIndex((b) => isObj(b) && b.type === 'cta');
  const weights = blocks.map((b, i) => (isObj(b) ? effectiveWeight(b, i) : i * 10));
  const weight = at >= 0 ? weights[at] : (weights.length ? Math.max(...weights) + 10 : 0);
  const block = {
    id, type: 'contact', role: roleFor('contact'), region: 'content', weight, shape: 'compact', locationsAuto: true,
    data: { headline: t.overviewTitle, items: contactItems(t) },
  };
  if (at >= 0) blocks.splice(at, 0, block);
  else blocks.push(block);
  return page;
}

// ── 补丁 ─────────────────────────────────────────────────────────────────────────────────────────

/**
 * 还缺地点页的那几家（每种语言各算）：`[{ locale, id }]`。地点 <2 ⟹ 空。§runLocationPages 只给它们要介绍。
 */
function missingLocationPages(content) {
  const locations = locationsOf(content);
  if (locations.length < 2) return [];
  const out = [];
  for (const { locale, prefix } of siteLocales(content).locales) {
    const marked = new Set([...pagesOf(content, prefix).values()]
      .filter(({ page }) => isLocationPage(page) && page.locationPage.kind === 'location').map(({ page }) => page.locationPage.id));
    for (const l of locations) if (!marked.has(l.id)) out.push({ locale, id: l.id });
  }
  return out;
}

/**
 * content → 补丁 `{ <相对路径>: 整份文件 | null }`（没有要改的 ⟹ `{}`）。
 * `intros`：`{ <语言>: { <地点 id>: { paragraphs: [..], description } } }`（AI 给的，缺的那一家用 §fallbackIntro）；
 * `menuLabels`：`{ <语言>: '…' }`（AI 给的菜单字，缺的落回 LABELS）。
 */
function locationPagesPatch(content, { intros = {}, menuLabels = {} } = {}) {
  if (!isObj(content)) throw new TypeError('locationPagesPatch: content 必须是对象（键 = site/ 下的相对路径）');
  const patch = {};
  const { defaultLocale, locales } = siteLocales(content);
  const locations = locationsOf(content);
  const many = locations.length >= 2;
  const ids = new Set(locations.map((l) => l.id));

  // slug：算一次，所有语言共用（同一家各语言同一个 slug）。挡路的 = 任一语言里 `locations/<slug>` 已是别的页。
  const allPages = locales.map(({ prefix }) => pagesOf(content, prefix));
  const blocked = (slug, id) => allPages.some((pages) => {
    const hit = pages.get(`${OVERVIEW_SLUG}/${slug}`);
    return !!hit && !(isLocationPage(hit.page) && hit.page.locationPage.kind === 'location' && hit.page.locationPage.id === id);
  });
  const slugs = many ? assignSlugs(locations, blocked) : new Map();

  // brand.json：把算出来的 slug 写回（只在 ≥2 家时；已有的不动）。
  if (many) {
    const brand = clone(parsed(content, 'brand.json'));
    const withIds = withLocationIds(brand.locations.filter(isObj));
    const next = withIds.map((l) => (str(l.slug) ? l : { ...l, slug: slugs.get(l.id) }));
    if (!same(next, brand.locations)) patch['brand.json'] = { ...brand, locations: next };
  }

  for (const [li, { locale, prefix }] of locales.entries()) {
    const t = labelsFor(locale);
    const brandName = brandNameOf(content, locale, defaultLocale);
    const pages = allPages[li];
    const hasContactPage = pages.has('contact');
    const marked = [...pages.entries()].filter(([, { page }]) => isLocationPage(page));
    const overview = marked.find(([, { page }]) => page.locationPage.kind === 'overview');
    const navRel = `${prefix}navigation.json`;
    const homeRel = `${prefix}pages/home.json`;

    if (!many) {
      // §做什么 1 最后一条 + §6：删标记页、指向被删总览页的菜单项、首页那一块。
      for (const [, { rel }] of marked) patch[rel] = null;
      const goneHrefs = new Set(marked.filter(([, { page }]) => page.locationPage.kind === 'overview').map(([slug]) => `/${slug}`));
      const nav = isObj(parsed(content, navRel)) ? clone(parsed(content, navRel)) : null;
      if (nav && goneHrefs.size && isObj(nav.header) && Array.isArray(nav.header.links)) {
        const keep = (l) => !(isObj(l) && goneHrefs.has(l.href));
        const links = nav.header.links.filter(keep).map((l) => (isObj(l) && Array.isArray(l.children) ? { ...l, children: l.children.filter(keep) } : l));
        if (!same(links, nav.header.links)) patch[navRel] = { ...nav, header: { ...nav.header, links } };
      }
      const home = isObj(parsed(content, homeRel)) ? parsed(content, homeRel) : null;
      if (home && Array.isArray(home.blocks) && home.blocks.some((b) => isObj(b) && b.locationsAuto === true)) {
        patch[homeRel] = { ...clone(home), blocks: clone(home.blocks).filter((b) => !(isObj(b) && b.locationsAuto === true)) };
      }
      continue;
    }

    // 地点没了 ⟹ 它那张标记页删掉。
    for (const [, { rel, page }] of marked) {
      if (page.locationPage.kind === 'location' && !ids.has(page.locationPage.id)) patch[rel] = null;
    }
    // 总览页：没有标记页、`locations` 这个 slug 也空着 ⟹ 新建；被一张手写页占着 ⟹ 不建（也就不加菜单、不加首页那块）。
    const newOverview = !overview && !pages.has(OVERVIEW_SLUG);
    if (newOverview) patch[`${prefix}pages/${OVERVIEW_SLUG}.json`] = overviewPage({ t, brandName, locations, hasContactPage });
    // 缺页的地点。
    const have = new Set(marked.filter(([, { page }]) => page.locationPage.kind === 'location').map(([, { page }]) => page.locationPage.id));
    for (const loc of locations) {
      if (have.has(loc.id)) continue;
      const slug = slugs.get(loc.id);
      // 已存的 slug 被一张别的页占着（老板后来手写的）⟹ 不覆盖它，这一家这一次不建页。
      if (pages.has(`${OVERVIEW_SLUG}/${slug}`)) continue;
      const ai = isObj(intros[locale]) && isObj(intros[locale][loc.id]) ? intros[locale][loc.id] : null;
      const sentence = fallbackIntro(brandName, loc);
      const intro = {
        paragraphs: ai && Array.isArray(ai.paragraphs) && ai.paragraphs.some(str) ? ai.paragraphs.map(str).filter(Boolean) : [sentence],
        description: (ai && str(ai.description)) || sentence,
      };
      patch[`${prefix}pages/${OVERVIEW_SLUG}/${slug}.json`] = locationPageOf({ t, slug, loc, intro, hasContactPage });
    }
    if (!newOverview) continue;
    // 菜单（只在总览页新建时）：末尾加一项；已经有一项指着它就不加。
    const nav = isObj(parsed(content, navRel)) ? clone(parsed(content, navRel)) : null;
    if (nav && isObj(nav.header)) {
      const links = Array.isArray(nav.header.links) ? nav.header.links : [];
      if (!links.some((l) => isObj(l) && l.href === OVERVIEW_HREF)) {
        patch[navRel] = { ...nav, header: { ...nav.header, links: [...links, { label: str(menuLabels[locale]) || t.menu, href: OVERVIEW_HREF }] } };
      }
    }
    // 首页那一块（只在总览页新建时；已经有一块带标记就不加）。
    const home = isObj(parsed(content, homeRel)) ? parsed(content, homeRel) : null;
    if (home && !(Array.isArray(home.blocks) && home.blocks.some((b) => isObj(b) && b.locationsAuto === true))) {
      const next = withHomeLocationsBlock(home, t);
      if (next) patch[homeRel] = next;
    }
  }
  return patch;
}

// ── 建站时存评价（§做什么 4）──────────────────────────────────────────────────────────────────────

/**
 * payload 的 `reviews` → 每个地点各自的评价（testimonials 的条目形状）。`location` 是 `brand.locations` 里的下标（#1993 起两边对齐）；
 * 只存 4 星及以上（没有 `rating` 当 5 星，同 `create-site.js` 那条规则）；不带 `location` / 下标不在范围里 / 没有字的不存。
 * 回新的 locations 数组（一条都没有的那一家不写 `reviews` 这一键）；没有要存的 ⟹ 原样那一份。
 */
function storeLocationReviews(locations, reviews) {
  if (!Array.isArray(locations) || !Array.isArray(reviews)) return locations;
  const byLoc = new Map();
  for (const r of reviews) {
    if (!isObj(r) || !Number.isInteger(r.location) || r.location < 0 || r.location >= locations.length) continue;
    if (!((r.rating || 5) >= 4) || !str(r.text)) continue;
    const item = { quote: str(r.text) };
    if (str(r.author)) item.name = str(r.author);
    if (Number.isFinite(r.rating)) item.rating = r.rating;
    if (str(r.platform)) item.source = str(r.platform);
    if (!byLoc.has(r.location)) byLoc.set(r.location, []);
    byLoc.get(r.location).push(item);
  }
  if (!byLoc.size) return locations;
  return locations.map((l, i) => (byLoc.has(i) && isObj(l) ? { ...l, reviews: byLoc.get(i) } : l));
}

// ── AI 介绍（§做什么 3）─────────────────────────────────────────────────────────────────────────

/** 提示词：每个缺页面的地点 × 它缺的语言各一段介绍 + description；有总览页要新建的语言另要一个菜单字。 */
function introPrompt({ brandName, services, wants, menuLocales }) {
  const langs = [...new Set(wants.flatMap((w) => w.locales))];
  const name = (l) => `${LANGUAGE_NAMES[l] || l} (${l})`;
  const lines = wants.map((w, i) => {
    const l = w.location;
    const facts = [`id: "${l.id}"`, `name: "${locName(l)}"`, str(l.address) && `address: "${str(l.address)}"`, str(l.city) && `city: "${str(l.city)}"`]
      .filter(Boolean).join(' · ');
    return `${i + 1}. ${facts} — languages: ${w.locales.join(', ')}`;
  });
  const menu = menuLocales.length
    ? `\n- "menuLabel": the website menu item that opens the page listing all locations, one or two words, for each of: ${menuLocales.join(', ')}.`
    : '';
  return `You write the introduction for each location page of the website for "${brandName}". Respond with ONE JSON object — no markdown fences, no explanation:
{"locations": [{"id": "<location id>", "intros": {"<language code>": {"paragraphs": ["<paragraph 1>", "<paragraph 2>"], "description": "<one sentence>"}}}]${menuLocales.length ? ', "menuLabel": {"<language code>": "<menu text>"}' : ''}}

BUSINESS: ${brandName}
SERVICES: ${services.length ? services.join(', ') : '(not given)'}
LANGUAGES: ${langs.map(name).join(', ')}

LOCATIONS (write only these, only in the languages listed for each):
${lines.join('\n')}

RULES:
- Use only the facts given above. Do not invent anything else: no opening hours, prices, years, staff names, awards, parking or landmarks.
- Do not copy sentences between locations: each location's introduction must be worded differently from every other location's.
- "paragraphs": exactly 2 paragraphs, 120–180 words in total, written in that language. Name the location and its city; keep the business name "${brandName}" verbatim.
- "description": the page's meta description, one sentence in that language, at most 155 characters.${menu}`;
}

/** 回包 → `{ intros: {语言: {id: {paragraphs, description}}}, menuLabels: {语言: 字} }`；形状不对的那一项丢掉（落回代码那一句）。 */
function readIntros(parsedReply, wants) {
  const intros = {};
  const menuLabels = {};
  const allowed = new Map(wants.map((w) => [w.location.id, new Set(w.locales)]));
  const list = isObj(parsedReply) && Array.isArray(parsedReply.locations) ? parsedReply.locations : [];
  for (const e of list) {
    if (!isObj(e) || !allowed.has(e.id) || !isObj(e.intros)) continue;
    for (const [locale, v] of Object.entries(e.intros)) {
      if (!allowed.get(e.id).has(locale) || !isObj(v)) continue;
      const paragraphs = Array.isArray(v.paragraphs) ? v.paragraphs.map(str).filter(Boolean) : [];
      if (!paragraphs.length) continue;
      (intros[locale] = intros[locale] || {})[e.id] = { paragraphs, description: str(v.description) };
    }
  }
  if (isObj(parsedReply) && isObj(parsedReply.menuLabel)) {
    for (const [locale, v] of Object.entries(parsedReply.menuLabel)) if (str(v)) menuLabels[locale] = str(v);
  }
  return { intros, menuLabels };
}

/** 默认的 AI 调用（命令那条路；建站换成 create-site.js 的 callAIWithRetry，测试换成桩）：回 `{ parsed, usage }`。 */
async function callAnthropic({ prompt, model }) {
  const Anthropic = require('@anthropic-ai/sdk');
  const { validateAiJson } = require('./ai-json');
  const client = new Anthropic();
  const res = await client.messages.create({ model, max_tokens: 16000, messages: [{ role: 'user', content: prompt }] });
  const text = (res.content || []).filter((c) => c.type === 'text').map((c) => c.text).join('').trim();
  const v = validateAiJson(text);
  const usage = { model, inputTokens: (res.usage && res.usage.input_tokens) || 0, outputTokens: (res.usage && res.usage.output_tokens) || 0 };
  return { parsed: v.ok ? v.parsed : null, usage, ...(v.ok ? {} : { error: `回包不是 JSON：${String(v.error || text).slice(0, 200)}` }) };
}

/**
 * 跑一遍（§做什么 5）：缺页面的地点要介绍（`skipAI` 不要）→ §locationPagesPatch。
 * 回 `{ patch, usage, wants }`：`usage` = 这一次 AI 的 `{model, inputTokens, outputTokens}`（没调 ⟹ 两个数都是 0、model null），
 * 记账归调用方（manager 按 model_pricing.go 算钱，同 seo-refresh 的 ai-usage，这边不另抄一份价目表）。
 * AI 调不通 / 回包坏了 ⟹ 不抛，缺的那几家落回代码那一句（`aiError` 带原因）—— 页面照样建出来，老板之后可以改字。
 */
async function runLocationPages({ content, skipAI = false, ai = callAnthropic, model = DEFAULT_MODEL, log = () => {} }) {
  const missing = missingLocationPages(content);
  let usage = { model: null, inputTokens: 0, outputTokens: 0 };
  let intros = {};
  let menuLabels = {};
  let aiError = null;
  const byId = new Map(locationsOf(content).map((l) => [l.id, l]));
  const wants = [];
  for (const m of missing) {
    let w = wants.find((x) => x.location.id === m.id);
    if (!w) { w = { location: byId.get(m.id), locales: [] }; wants.push(w); }
    w.locales.push(m.locale);
  }
  if (!skipAI && wants.length) {
    const { defaultLocale, locales } = siteLocales(content);
    // 总览页要新建的语言（同 §locationPagesPatch 的判据）才要菜单字。
    const menuLocales = locales.filter(({ prefix }) => {
      const pages = pagesOf(content, prefix);
      return ![...pages.values()].some(({ page }) => isLocationPage(page) && page.locationPage.kind === 'overview') && !pages.has(OVERVIEW_SLUG);
    }).map(({ locale }) => locale);
    const main = locales.find((l) => l.locale === defaultLocale) || locales[0];
    const svc = parsed(content, `${main.prefix}services.json`);
    const services = (Array.isArray(svc) ? svc : []).map((s) => (isObj(s) ? str(s.name) : '')).filter(Boolean);
    const prompt = introPrompt({ brandName: brandNameOf(content, defaultLocale, defaultLocale), services, wants, menuLocales });
    try {
      const r = await ai({ prompt, model, wants });
      if (r && r.usage) usage = r.usage;
      if (r && r.parsed) ({ intros, menuLabels } = readIntros(r.parsed, wants));
      else aiError = (r && r.error) || 'AI 没有回 JSON';
    } catch (e) {
      if (e && e.usage) usage = e.usage;
      aiError = e && e.message ? e.message : String(e);
    }
    if (aiError) log(`[location-pages] AI 介绍没拿到（${aiError}），缺的那几家用代码那一句`);
  }
  return { patch: locationPagesPatch(content, { intros, menuLabels }), usage, wants: wants.map((w) => ({ id: w.location.id, locales: w.locales })), aiError };
}

// ── 命令 `site.js location-pages --site <站 JSON> [--skip-ai] [--model <id>]`（输出约定同 site.js 头注的编辑器那几条）──────

class LocationPagesError extends Error {
  constructor(code, message) { super(message); this.code = code; }
}

/** 命令那一层：读 `--site`（文件路径或内联 JSON）、跑、补丁里的块盖当前版本号。回 `{ patch, usage }`，不合法抛 LocationPagesError('bad')。 */
async function locationPagesCommand({ site, skipAI = false, model, ai }) {
  const fs = require('fs');
  if (typeof site !== 'string' || !site) throw new LocationPagesError('bad', '要给 --site <站 JSON>');
  let content;
  try {
    const text = /^\s*[{[]/.test(site) ? site : fs.readFileSync(site, 'utf-8');
    content = JSON.parse(text);
  } catch (e) {
    throw new LocationPagesError('bad', `--site 读不了：${e.code === 'ENOENT' ? `没有这个文件 ${site}` : e.message}`);
  }
  if (!isObj(content)) throw new LocationPagesError('bad', '--site 要是一份 content 对象');
  if (!isObj(parsed(content, 'brand.json'))) throw new LocationPagesError('bad', '--site 里没有 brand.json');
  const r = await runLocationPages({ content, skipAI, ...(model ? { model } : {}), ...(ai ? { ai } : {}), log: (l) => process.stderr.write(`${l}\n`) });
  // 新块盖当前号（同 site-create.js §finishContent 的 stampSchemaVersions：之前没有的块 = 新块）。删掉的那几份是 null，不盖。
  const { stampSchemaVersions } = require('./stamp-schema-versions');
  const kept = Object.fromEntries(Object.entries(r.patch).filter(([, v]) => v !== null));
  const stamped = stampSchemaVersions(content, kept);
  const patch = Object.fromEntries(Object.keys(r.patch).sort().map((k) => [k, r.patch[k] === null ? null : stamped[k]]));
  return { patch, usage: r.usage, ...(r.aiError ? { aiError: r.aiError } : {}) };
}

module.exports = {
  OVERVIEW_SLUG, LABELS, isLocationPage, missingLocationPages, locationPagesPatch, storeLocationReviews,
  introPrompt, readIntros, runLocationPages, locationPagesCommand, LocationPagesError,
};
