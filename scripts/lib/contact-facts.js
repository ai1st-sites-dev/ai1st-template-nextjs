'use strict';
// ══════════════════════════════════════════════════════════════════════════════════════════════════
// contact-facts.js —— contact 从站点数据里取的那几样值（#1489，总纲 #1422 的 T2.11）
// ══════════════════════════════════════════════════════════════════════════════════════════════════
//
// 🔴 **值只有一处**：电话 / 邮箱 / 地址 / 营业时间 / 坐标都读站点数据（`brand.locations[0]` · `brand.email` ·
//    `seo.schema.openingHours`，#1551 起可以是多段），块数据里只存 kind + 标题 + 提示。全站只有一处电话地址，老板改一次处处跟着变。
// 🔴 **「没填」就不画那一条**：`openingHours` 没有这一项（#1551 起没写营业时间的站就是这样），或 `days` 是空数组、
//    `opens` / `closes` 是空串（老站的空壳），都当作没填（PM #1489 09-29 裁定）。
// 🔴 **坐标只从站点数据来**（`brand.locations[0].geo`，建站 / 改地址时由 `scripts/lib/geocode.js` 查一次写进去）；
//    这里不发任何请求。没有 geo ⟹ 地图那一格不渲染。

const { hoursSegments } = require('./local-business-facts');

const WEEK = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

const str = (v) => (typeof v === 'string' ? v.trim() : '');

/** `Monday` / `mon` / `Mo` → 0…6；认不出 → -1。 */
function dayIndex(d) {
  const s = str(d).slice(0, 2).toLowerCase();
  return WEEK.findIndex((w) => w.slice(0, 2).toLowerCase() === s);
}

/** `09:00` → `9am` · `17:30` → `5:30pm` · `00:00` → `12am` · `12:00` → `12pm`；认不出原样返回。 */
function formatTime(t) {
  const m = /^(\d{1,2}):(\d{2})/.exec(str(t));
  if (!m) return str(t);
  const h = Number(m[1]) % 24;
  const suffix = h < 12 ? 'am' : 'pm';
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return m[2] === '00' ? `${h12}${suffix}` : `${h12}:${m[2]}${suffix}`;
}

/** 连着的几天收成一段：Mon–Sat；不连的逗号隔开：Mon–Wed, Fri。 */
function formatDays(days) {
  const idx = Array.from(new Set((Array.isArray(days) ? days : []).map(dayIndex).filter((i) => i >= 0))).sort((a, b) => a - b);
  const runs = [];
  for (const i of idx) {
    const last = runs[runs.length - 1];
    if (last && i === last[1] + 1) last[1] = i; else runs.push([i, i]);
  }
  return runs.map(([a, b]) => (a === b ? WEEK[a] : b === a + 1 ? `${WEEK[a]}, ${WEEK[b]}` : `${WEEK[a]}–${WEEK[b]}`)).join(', ');
}

/**
 * 营业时间一行（「Mon–Sat · 7am – 7pm」）；没填（days 空 / opens、closes 空串）或认不出一天 → ''。
 * #1551 —— `openingHours` 可以是**多段**（一组 `{days, opens, closes}`，老站的单个对象照旧认，`local-business-facts.js`
 *    §hoursSegments）：每段一截，用 `; ` 连起来（「Mon–Fri · 9am – 6pm; Sat · 10am – 4pm」）。只有一段时跟以前逐字相同。
 */
function formatHours(h) {
  return hoursSegments(h)
    .map((seg) => `${formatDays(seg.days)} · ${formatTime(seg.opens)} – ${formatTime(seg.closes)}`)
    .join('; ');
}

/** 坐标能不能用：两个有限数、在经纬度范围里。 */
function validGeo(g) {
  return !!g && typeof g === 'object' && Number.isFinite(g.lat) && Number.isFinite(g.lng)
    && Math.abs(g.lat) <= 90 && Math.abs(g.lng) <= 180;
}

/**
 * 站点数据 → 块要的那几样值。`brand` / `seo` 就是 `@/lib/config` 的 `brand` 与 `getSeo(locale)`。
 * @returns {{ phone: string, email: string, address: string, hours: string, geo: { lat: number, lng: number } | null }}
 */
function siteFactsFrom(brand, seo) {
  const b = brand && typeof brand === 'object' ? brand : {};
  const loc = Array.isArray(b.locations) && b.locations[0] && typeof b.locations[0] === 'object' ? b.locations[0] : {};
  const schema = seo && typeof seo === 'object' && seo.schema && typeof seo.schema === 'object' ? seo.schema : {};
  return {
    phone: str(loc.phone),
    email: str(b.email),
    address: str(loc.address),
    hours: formatHours(schema.openingHours),
    geo: validGeo(loc.geo) ? { lat: loc.geo.lat, lng: loc.geo.lng } : null,
  };
}

const telHref = (phone) => `tel:${str(phone).replace(/[^\d+]/g, '')}`;
const mailtoHref = (email) => `mailto:${str(email)}`;

// 嵌入框露出多大一片：经纬度各 ±0.006 度（多伦多那个纬度上约 1 km 宽），钉子在正中间。
const EMBED_SPAN = 0.006;
const round = (n) => Math.round(n * 1e6) / 1e6;

/**
 * OSM 官方嵌入（不要 key）：`openstreetmap.org/export/embed.html?bbox=…&marker=lat,lng`。只在访客点「Open map」之后才用
 * （瓦片条款允许「真人在看」的正常浏览，禁的是预取 / 离线 —— 正文「地图」②）。坐标不能用 → ''。
 */
function osmEmbedUrl(geo) {
  if (!validGeo(geo)) return '';
  const bbox = [geo.lng - EMBED_SPAN, geo.lat - EMBED_SPAN, geo.lng + EMBED_SPAN, geo.lat + EMBED_SPAN].map(round).join(',');
  return `https://www.openstreetmap.org/export/embed.html?bbox=${bbox}&layer=mapnik&marker=${geo.lat},${geo.lng}`;
}

// ── 「值只有一处」的闸（#1489 r2，QA2 打回 r1）──────────────────────────────────────────────────────
//
// 🔴 r1 只在提示词里说「只写 kind + 标题 + 提示」，真模型照样把电话 / 邮箱 / 地址 / 营业时间抄进 `hint`（4 条里 4 条）：
//    访客每条看到两遍，老板改了电话之后同一张卡上一新一旧两个号码。提示词只能降低概率，这里是**确定的**那道闸。
// 判「这段字抄了一个值」：
//   · 电话 —— 一串（数字 / 空格 / `-` `.` `(` `)` `+`）里有 ≥7 位数字。**按样子认，不按站点现值比**：旧号码也要认得出来。
//   · 邮箱 —— `x@y.z`。同上，按样子认。
//   · 钟点 —— `9am` / `9:00 AM` / `17:30`。同上（营业时间那条的值已经是站点数据格式化出来的一行）。
//   · 地址 —— 站点现在那个地址（整条，或逗号前那一段、≥6 个字），不分大小写、忽略空白与标点。地址没有可靠的「样子」，
//     所以只认得出现值；改地址之后留在别处的旧地址这里认不出（建站 / 改站写盘时现值已经被剔掉了，见调用点）。
// 只管 phone / email / address / hours 四种：`link` 的值**就是**标题，不查。
const FACT_KINDS = ['phone', 'email', 'address', 'hours'];
const PHONE_RUN = /\+?\d[\d\s().-]{5,}\d/g;
const EMAIL_RE = /[^\s@]+@[^\s@]+\.[^\s@]+/;
const TIME_RE = /\b\d{1,2}(?::\d{2})?\s*[ap]\.?m\b\.?|\b\d{1,2}:\d{2}\b/i;
const squash = (s) => str(s).toLowerCase().replace(/[\s,.;:#/-]+/g, ' ').trim();

/** 这段字里有没有抄一个站点数据的值（电话 / 邮箱 / 钟点按样子认，地址按 `facts.address` 现值认）。 */
function copiesSiteFact(text, facts) {
  const s = str(text);
  if (!s) return false;
  if ((s.match(PHONE_RUN) || []).some((run) => run.replace(/\D/g, '').length >= 7)) return true;
  if (EMAIL_RE.test(s) || TIME_RE.test(s)) return true;
  const addr = squash(facts && facts.address);
  if (!addr) return false;
  const t = squash(s);
  if (t.includes(addr)) return true;
  const head = squash(String((facts && facts.address) || '').split(',')[0]);
  return head.length >= 6 && t.includes(head);
}

/**
 * 一条 item 就地剔掉抄进来的值：`hint` 抄了 ⟹ 删；`title` 抄了 ⟹ 删（值本来就画在下面，标题空着不画）；
 * 非 link 的 `href` 一律删（电话 / 邮箱的链接由站点数据现算，存一份就是第二处号码）。回有没有改。
 */
function scrubContactItem(item, facts) {
  if (!item || typeof item !== 'object' || !FACT_KINDS.includes(str(item.kind))) return false;
  let changed = false;
  for (const key of ['hint', 'title']) {
    if (key in item && copiesSiteFact(item[key], facts)) { delete item[key]; changed = true; }
  }
  if ('href' in item) { delete item.href; changed = true; }
  return changed;
}

/**
 * 一份页面 JSON（`blocks` 新形状或 `sections` 老形状）里所有 contact 的 items 就地剔一遍。回改了几条。
 * 调用点：建站写页面那一刻（`create-site.js` §writeSiteConfig / §writeSecondaryLocaleConfig）、改站同步之前
 * （`edit-site.js`，这一轮写过的页面）。渲染那一侧（`Section.tsx` §rowOf）用同一个 `copiesSiteFact` 再挡一次 ——
 * 可视化编辑器里老板手打进去的那份不经过前两处。
 */
function scrubContactCopies(page, facts) {
  let n = 0;
  if (!page || typeof page !== 'object') return n;
  for (const list of [page.blocks, page.sections]) {
    if (!Array.isArray(list)) continue;
    for (const b of list) {
      if (!b || b.type !== 'contact' || !b.data || !Array.isArray(b.data.items)) continue;
      for (const it of b.data.items) if (scrubContactItem(it, facts)) n++;
    }
  }
  return n;
}

module.exports = { WEEK, formatTime, formatDays, formatHours, validGeo, siteFactsFrom, telHref, mailtoHref, osmEmbedUrl, copiesSiteFact, scrubContactItem, scrubContactCopies };
