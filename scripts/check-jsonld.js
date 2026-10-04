#!/usr/bin/env node
/**
 * check-jsonld.js —— 导出产物里给搜索引擎的结构化数据，逐页断言（#1551，SEO epic T7）。
 *
 * 跑法:  node scripts/check-jsonld.js <out 目录> [--site <site 目录>]
 *        --site 给了 ⟹ 再拿站点数据对一遍「出的是不是老板给的料」（营业时间 / 评分 / 街道邮编 / 坐标 / 社交链接）；
 *        不给 ⟹ 只查形状（该出的出没出、出了的合不合法）。
 * 退出码: 0 全过 · 1 有问题（逐条打出来）· 2 跑不起来（没有 out 目录 / 一页 HTML 都没有 —— 不许当成通过）
 *
 * 逐页查的（每页解析全部 `<script type="application/ld+json">`）：
 *   · 每段都能 JSON.parse；
 *   · FAQPage —— 这一页 faq 块里画出来的问答（`data-block="faq"` 里带 `data-slot="items.N.answer"` 的条数）≥1 ⟹ 恰好一份 FAQPage，
 *     `mainEntity` 条数 == 那个数，每条有问题和答案；没有问答 ⟹ 不许有 FAQPage；
 *   · LocalBusiness —— `openingHoursSpecification` 出了就不许是空壳（星期是英文星期名、非空；时间 HH:MM）；
 *     `aggregateRating` 出了就要有 (0,5] 的分数和正整数条数；`geo` 出了就是两个数；街道 / 邮编出了就非空；
 *   · WebSite —— 不许挂 SearchAction（站上没有搜索）；
 *   · 带站点外壳的页（有 LocalBusiness 的那些）—— `og:site_name`、`og:type` 两个 meta 都在；
 *   · Service —— 出了就要有 `name` 和 `provider.name`，`areaServed` 每一项有名字；
 *     给了 --site ⟹ 每个**带目标词的关键词页**恰好一份关键词 Service：`name` == 目标词首字母大写、
 *     `areaServed` == 词里的地名（没有就是站的地区）、`provider.name` == 站名（算法与组件同一份，`scripts/lib/keyword-service.js`）；
 *     没有目标词的关键词页（T4 #1548 落地前的样子）⟹ 不许出关键词 Service（除了站的服务目录里那几个服务名）。
 */
'use strict';

const fs = require('fs');
const path = require('path');
const { DAYS, hoursSegments } = require('./lib/local-business-facts');
const { isKeywordPage, keywordServiceFor } = require('./lib/keyword-service');
const { readPagesRecursive } = require('./lib/page-files');

const LD_RE = /<script[^>]*type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/g;
const TIME = /^\d{2}:\d{2}$/;

const decode = (s) => s.replace(/&quot;/g, '"').replace(/&#x27;|&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
const typesOf = (node) => (Array.isArray(node['@type']) ? node['@type'] : [node['@type']]);

/** 一页 HTML 里全部 JSON-LD 节点（`@graph` 摊开）；解析失败的段记成问题。 */
function ldNodes(html, problems) {
  const out = [];
  for (const m of html.matchAll(LD_RE)) {
    let v;
    try { v = JSON.parse(m[1]); } catch (e) {
      try { v = JSON.parse(decode(m[1])); } catch (e2) { problems.push(`JSON-LD 解析不了：${e2.message}`); continue; }
    }
    for (const n of Array.isArray(v) ? v : v && v['@graph'] ? v['@graph'] : [v]) if (n && typeof n === 'object') out.push(n);
  }
  return out;
}

/** 这一页 faq 块里画出来的问答条数（问题和答案都有的那几条）。 */
function faqAnswersOnPage(html) {
  let n = 0;
  for (const m of html.matchAll(/data-block="faq"/g)) {
    const start = m.index;
    const end = html.indexOf('</section>', start);
    const body = html.slice(start, end < 0 ? undefined : end);
    n += (body.match(/data-slot="items\.\d+\.answer"/g) || []).length;
  }
  return n;
}

const metaContent = (html, prop) => {
  const m = new RegExp(`<meta[^>]*property="${prop}"[^>]*content="([^"]*)"`).exec(html)
    || new RegExp(`<meta[^>]*content="([^"]*)"[^>]*property="${prop}"`).exec(html);
  return m ? decode(m[1]) : null;
};

/**
 * 一页 → 问题清单。`expected`（可选）是站点数据推出来的「应当是什么」（§expectedFromSite）；
 * `slug`（可选）是这一页的页面 slug —— 给了才能对「这一页该不该有关键词 Service」。
 * @returns {{ problems: string[], blocks: number }}
 */
function checkHtml(html, expected, slug) {
  const problems = [];
  const nodes = ldNodes(html, problems);

  // ── FAQPage ──
  const faqPages = nodes.filter((n) => typesOf(n).includes('FAQPage'));
  const answers = faqAnswersOnPage(html);
  if (answers > 0 && faqPages.length !== 1) problems.push(`这一页 faq 块里画了 ${answers} 条问答，FAQPage 却有 ${faqPages.length} 份（应当恰好 1 份）`);
  if (answers === 0 && faqPages.length) problems.push(`这一页没有画出任何问答，却出了 ${faqPages.length} 份 FAQPage`);
  for (const fp of faqPages) {
    const me = Array.isArray(fp.mainEntity) ? fp.mainEntity : [];
    if (me.length !== answers) problems.push(`FAQPage.mainEntity 有 ${me.length} 条，页面上画出的问答是 ${answers} 条`);
    me.forEach((q, i) => {
      const a = q && q.acceptedAnswer;
      if (!q || !typesOf(q).includes('Question') || !String(q.name || '').trim() || !a || !String(a.text || '').trim()) {
        problems.push(`FAQPage.mainEntity[${i}] 不是一条完整的问答（要 @type Question、name、acceptedAnswer.text）`);
      }
    });
  }

  // ── LocalBusiness ──
  const lbs = nodes.filter((n) => typesOf(n).includes('LocalBusiness'));
  for (const lb of lbs) {
    if ('openingHoursSpecification' in lb) {
      const specs = Array.isArray(lb.openingHoursSpecification) ? lb.openingHoursSpecification : [lb.openingHoursSpecification];
      if (!specs.length) problems.push('LocalBusiness.openingHoursSpecification 是空数组（没有营业时间就不该出这一项）');
      specs.forEach((sp, i) => {
        const days = sp && Array.isArray(sp.dayOfWeek) ? sp.dayOfWeek : [];
        if (!days.length || days.some((d) => !DAYS.includes(d)) || !TIME.test(String(sp && sp.opens)) || !TIME.test(String(sp && sp.closes))) {
          problems.push(`LocalBusiness.openingHoursSpecification[${i}] 是空壳或认不出：${JSON.stringify(sp)}`);
        }
      });
    }
    if ('aggregateRating' in lb) {
      const r = lb.aggregateRating || {};
      if (!(r.ratingValue > 0 && r.ratingValue <= 5) || !(Number.isInteger(r.reviewCount) && r.reviewCount > 0)) {
        problems.push(`LocalBusiness.aggregateRating 不完整：${JSON.stringify(r)}`);
      }
    }
    if ('geo' in lb && !(lb.geo && Number.isFinite(lb.geo.latitude) && Number.isFinite(lb.geo.longitude))) {
      problems.push(`LocalBusiness.geo 不是两个数：${JSON.stringify(lb.geo)}`);
    }
    const addr0 = Array.isArray(lb.address) ? lb.address[0] : lb.address;
    for (const k of ['streetAddress', 'postalCode']) {
      if (addr0 && k in addr0 && !String(addr0[k] || '').trim()) problems.push(`LocalBusiness.address.${k} 出了但是空的`);
    }
    if (expected) {
      const got = (key) => JSON.stringify(key);
      const specs = Array.isArray(lb.openingHoursSpecification) ? lb.openingHoursSpecification.map((s) => ({ days: s.dayOfWeek, opens: s.opens, closes: s.closes })) : [];
      if (got(specs) !== got(expected.hours)) problems.push(`营业时间跟站点数据不一致：JSON-LD ${got(specs)} · 站点数据 ${got(expected.hours)}`);
      const rating = lb.aggregateRating ? { ratingValue: lb.aggregateRating.ratingValue, reviewCount: lb.aggregateRating.reviewCount } : null;
      if (got(rating) !== got(expected.rating)) problems.push(`aggregateRating 跟站点数据不一致：JSON-LD ${got(rating)} · 站点数据 ${got(expected.rating)}`);
      if (got(lb.sameAs || []) !== got(expected.sameAs)) problems.push(`sameAs 跟站点数据不一致：JSON-LD ${got(lb.sameAs || [])} · 站点数据 ${got(expected.sameAs)}`);
      for (const [k, want] of [['streetAddress', expected.streetAddress], ['postalCode', expected.postalCode]]) {
        const have = addr0 && addr0[k] ? addr0[k] : '';
        if (have !== want) problems.push(`address.${k} 跟站点数据不一致：JSON-LD ${got(have)} · 站点数据 ${got(want)}`);
      }
      const geo = lb.geo ? { lat: lb.geo.latitude, lng: lb.geo.longitude } : null;
      if (got(geo) !== got(expected.geo)) problems.push(`geo 跟站点数据不一致：JSON-LD ${got(geo)} · 站点数据 ${got(expected.geo)}`);
    }
  }

  // ── WebSite ──
  for (const ws of nodes.filter((n) => typesOf(n).includes('WebSite'))) {
    const acts = Array.isArray(ws.potentialAction) ? ws.potentialAction : ws.potentialAction ? [ws.potentialAction] : [];
    if (acts.some((a) => a && typesOf(a).includes('SearchAction'))) problems.push('WebSite 挂着 SearchAction（站上没有搜索）');
  }

  // ── Service ──
  const svcs = nodes.filter((n) => typesOf(n).includes('Service'));
  svcs.forEach((sv, i) => {
    if (!String(sv.name || '').trim()) problems.push(`Service[${i}] 没有 name`);
    if (!sv.provider || !String(sv.provider.name || '').trim()) problems.push(`Service[${i}]（${sv.name}）没有 provider.name`);
    const areas = Array.isArray(sv.areaServed) ? sv.areaServed : sv.areaServed ? [sv.areaServed] : [];
    if (areas.some((a) => !a || !String(a.name || '').trim())) problems.push(`Service[${i}]（${sv.name}）的 areaServed 有一项没有名字`);
  });
  if (expected && expected.keywordPages && slug !== undefined && expected.keywordPages.has(slug)) {
    const want = expected.keywordPages.get(slug);
    const kw = svcs.filter((sv) => !expected.serviceNames.has(sv.name));
    if (!want) {
      if (kw.length) problems.push(`这一页是关键词页、没有目标词，却出了 Service：${kw.map((sv) => sv.name).join(' / ')}`);
    } else if (kw.length !== 1) {
      problems.push(`关键词页（目标词「${want.keyword}」）的 Service 应当恰好 1 份，实际 ${kw.length} 份`);
    } else {
      const sv = kw[0];
      const got = (v) => JSON.stringify(v);
      const areas = (Array.isArray(sv.areaServed) ? sv.areaServed : sv.areaServed ? [sv.areaServed] : []).map((a) => a && a.name);
      if (sv.name !== want.name) problems.push(`Service.name 跟目标词对不上：JSON-LD ${got(sv.name)} · 应当 ${got(want.name)}`);
      if (got(areas) !== got(want.areaServed.map((a) => a.name))) problems.push(`Service.areaServed 跟词里的地名 / 站的地区对不上：JSON-LD ${got(areas)} · 应当 ${got(want.areaServed.map((a) => a.name))}`);
      if (!sv.provider || sv.provider.name !== expected.siteName || !typesOf(sv.provider).includes('LocalBusiness')) {
        problems.push(`Service.provider 不是本站 LocalBusiness：JSON-LD ${got(sv.provider)} · 站名 ${got(expected.siteName)}`);
      }
    }
  }

  // ── openGraph（带站点外壳的页）──
  if (lbs.length) {
    for (const prop of ['og:site_name', 'og:type']) if (!metaContent(html, prop)) problems.push(`缺 <meta property="${prop}">`);
  }

  return { problems, blocks: nodes.length };
}

/** 站点数据 → 期望值（默认语言那份 seo；brand 全站一份）。 */
function expectedFromSite(siteDir) {
  const read = (p) => JSON.parse(fs.readFileSync(path.join(siteDir, p), 'utf-8'));
  const meta = read('site_meta.json');
  const brand = read('brand.json');
  const seo = read(path.join(meta.defaultLocale || 'en', 'seo.json'));
  const loc = (brand.locations && brand.locations[0]) || {};
  const links = brand.socialLinks;
  const sameAs = (Array.isArray(links) ? links.map((l) => l && l.url) : links && typeof links === 'object' ? Object.values(links) : [])
    .filter((u) => typeof u === 'string' && /^https?:\/\//.test(u.trim())).map((u) => u.trim());
  const r = seo.schema && seo.schema.aggregateRating;
  // 关键词页 → 它该出的那份 Service（没有目标词 ⟹ null，也就是「不该出」）。
  const pages = [];
  const pagesDir = path.join(siteDir, meta.defaultLocale || 'en', 'pages');
  if (fs.existsSync(pagesDir)) readPagesRecursive(pagesDir, '', pages);
  const keywordPages = new Map();
  for (const p of pages) if (isKeywordPage(p)) keywordPages.set(p.slug, keywordServiceFor(p, { seo, brand }));
  const names = brand.name && typeof brand.name === 'object' ? brand.name : { _: brand.name };
  let services = [];
  try { services = read(path.join(meta.defaultLocale || 'en', 'services.json')); } catch (e) { services = []; }
  const list = Array.isArray(services) ? services : Array.isArray(services && services.services) ? services.services : [];
  return {
    keywordPages,
    serviceNames: new Set(list.map((sv) => sv && sv.name).filter(Boolean)),
    siteName: names[meta.defaultLocale || 'en'] || Object.values(names)[0] || '',
    hours: hoursSegments(seo.schema && seo.schema.openingHours),
    rating: r && r.ratingValue > 0 && r.reviewCount > 0 ? { ratingValue: r.ratingValue, reviewCount: r.reviewCount } : null,
    sameAs,
    streetAddress: loc.streetAddress || '',
    postalCode: loc.postalCode || '',
    geo: loc.geo && Number.isFinite(loc.geo.lat) && Number.isFinite(loc.geo.lng) ? { lat: loc.geo.lat, lng: loc.geo.lng } : null,
  };
}

function htmlFiles(dir) {
  const out = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) { if (e.name !== '_next') out.push(...htmlFiles(p)); } else if (e.name.endsWith('.html')) out.push(p);
  }
  return out.sort();
}

/** 导出产物里的文件 → 默认语言那一页的 slug（`index.html` 是首页）。编辑器副本（`~editor/…`）和别的语言（`<语言>/…`）
 *  得到的是对不上任何页面的 slug ⟹ 不对站点数据（编辑器副本不带 JSON-LD；站点数据只取默认语言那份）。 */
function slugOf(rel) {
  const s = rel.split(path.sep).join('/').replace(/\.html$/, '');
  return s === 'index' ? 'home' : s;
}

/** @returns {{ code: 0|1|2, lines: string[] }} */
function checkOut(outDir, { siteDir } = {}) {
  if (!outDir || !fs.existsSync(outDir) || !fs.statSync(outDir).isDirectory()) return { code: 2, lines: [`check-jsonld: 没有 out 目录（${outDir}）`] };
  const files = htmlFiles(outDir);
  if (!files.length) return { code: 2, lines: [`check-jsonld: ${outDir} 里一页 HTML 都没有`] };
  let expected = null;
  if (siteDir) {
    try { expected = expectedFromSite(siteDir); } catch (e) { return { code: 2, lines: [`check-jsonld: 读不了站点数据（${siteDir}）：${e.message}`] }; }
  }
  const lines = [];
  let total = 0;
  let blocks = 0;
  for (const f of files) {
    const r = checkHtml(fs.readFileSync(f, 'utf-8'), expected, slugOf(path.relative(outDir, f)));
    blocks += r.blocks;
    for (const p of r.problems) { lines.push(`${path.relative(outDir, f)}: ${p}`); total += 1; }
  }
  lines.push(`check-jsonld: ${files.length} 页 · ${blocks} 段 JSON-LD · ${total} 处问题${expected ? '（含对站点数据）' : ''}`);
  return { code: total ? 1 : 0, lines };
}

if (require.main === module) {
  const args = process.argv.slice(2);
  const si = args.indexOf('--site');
  const siteDir = si >= 0 ? args[si + 1] : '';
  const outDir = args.filter((a, i) => !a.startsWith('--') && (si < 0 || i !== si + 1))[0];
  const r = checkOut(outDir, { siteDir });
  for (const l of r.lines) console.log(l);
  process.exit(r.code);
}

module.exports = { checkHtml, checkOut, expectedFromSite, faqAnswersOnPage, slugOf };
