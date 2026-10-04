// #1548 —— 挖出来的关键词落盘成站点数据：`<locale>/seo.json` 的 `targetKeywords` + 每页 `seo.targetKeyword`。
//
// 🔴 **一份实现，两条路共用**：真 AI 建站（create-site.js §main，Call 2 之后）和 skipAI 建站（getDemoConfig 那一支）
//    调的是同一个 `assignTargetKeywords`。分配逻辑写两份的话，agent 一律走 skipAI（#1499），真 AI 那一份就没人验得到。
//
// 输入是 `sites.payload.keywords`（按服务**名**分组：`{ "<服务名>": [{ keyword, volume, goldIndex, selected, isPrimary }] }`）。
// 三类页有目标词，其余页没有（PM 2026-10-03 裁定 ②）：
//   · 首页        = 站的主词：Lead 站是 payload.keyword；Brand 站是各服务主词里 goldIndex 最高的那条（并列取服务顺序靠前的；
//                   goldIndex 空的当最低）
//   · 服务详情页  = 它那组里 isPrimary 的那条
//   · 关键词页    = 它自己的词（词↔页是 keywordPagesList 现成的表，不从 slug 反推）
//
// 服务组 ↔ AI 起的服务 id 怎么对（做什么 1 + PM 21:07 第 1 条）：
//   ① 组名逐字等于某个 `content.services[j].name` ⟹ 按名字（名字证据优先；j ≠ i 时记进 reordered）
//   ② 没按名字对上、且组数 == 服务数 ⟹ 按位置（提示词按 payload.services 的顺序列服务，并要求 use EXACTLY these）
//   ③ 都没对上 ⟹ 这一组 unmatched：丢的只是「哪张服务详情页拿它的主词」，所以 unmatched 列的是**那一组的主词**。
//      那一组的非主词照样有关键词页（关键词页的 slug 由 payload 服务名直接算，不经匹配）。
//
// 「第 i 组」的顺序取 payload.services 的顺序，不取 keywords 对象的键序：dashboard 的 keywords 对象是按挖词
// **完成先后**插入的（CreatePage.tsx §searchBrandKeywords 的 Promise.all），跟提示词里列服务的顺序不是一回事。

/** payload 里的一条词 → 落盘的形状。只认带非空 keyword 的对象。 */
function entryOf(k) {
  if (!k || typeof k !== 'object' || typeof k.keyword !== 'string' || !k.keyword.trim()) return null;
  const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
  return {
    keyword: k.keyword.trim(),
    volume: num(k.volume),
    goldIndex: num(k.goldIndex),
    selected: k.selected !== false,
    isPrimary: k.isPrimary === true,
  };
}

/** payload.keywords → 有序的组：先按 payload.services 的顺序，再把不在 services 里的键按原顺序接在后面。 */
function keywordGroups(keywords, services = []) {
  const src = keywords && typeof keywords === 'object' && !Array.isArray(keywords) ? keywords : {};
  const names = [];
  for (const s of Array.isArray(services) ? services : []) {
    if (typeof s === 'string' && Object.prototype.hasOwnProperty.call(src, s) && !names.includes(s)) names.push(s);
  }
  for (const k of Object.keys(src)) if (!names.includes(k)) names.push(k);
  return names.map((name) => ({
    name,
    entries: (Array.isArray(src[name]) ? src[name] : []).map(entryOf).filter(Boolean),
  }));
}

function primaryOf(group) {
  return group.entries.find((e) => e.isPrimary) || null;
}

/** 组 ↔ 服务 id。回 `{ ids, reordered }`：ids[i] 是第 i 组对上的服务 id（对不上是 null）。 */
function matchGroupsToServices(groups, contentServices = []) {
  const svcs = (Array.isArray(contentServices) ? contentServices : []).filter((s) => s && typeof s.id === 'string');
  const claimed = new Set();
  const ids = groups.map(() => null);
  const reordered = [];
  groups.forEach((g, i) => {
    const j = svcs.findIndex((s, k) => !claimed.has(k) && typeof s.name === 'string' && s.name.trim() === g.name.trim());
    if (j < 0) return;
    ids[i] = svcs[j].id;
    claimed.add(j);
    if (groups.length === svcs.length && j !== i) reordered.push({ group: g.name, position: i, matchedBy: 'name', service: svcs[j].id });
  });
  if (groups.length === svcs.length) {
    groups.forEach((g, i) => {
      if (ids[i] !== null || claimed.has(i)) return;
      ids[i] = svcs[i].id;
      claimed.add(i);
    });
  }
  return { ids, reordered };
}

/** 站的主词。Lead：payload.keyword；Brand：各组主词里 goldIndex 最高（空当最低，并列取靠前的）。 */
function sitePrimaryOf(groups, { siteType, keyword } = {}) {
  const pick = (e) => ({ keyword: e.keyword, volume: e.volume, goldIndex: e.goldIndex });
  if (siteType === 'lead' && typeof keyword === 'string' && keyword.trim()) {
    const kw = keyword.trim();
    const hit = groups.flatMap((g) => g.entries).find((e) => e.keyword.toLowerCase() === kw.toLowerCase());
    return hit ? { ...pick(hit), keyword: kw } : { keyword: kw, volume: null, goldIndex: null };
  }
  let best = null;
  for (const g of groups) {
    const p = primaryOf(g);
    if (!p) continue;
    const score = p.goldIndex === null ? -Infinity : p.goldIndex;
    if (best === null || score > best.score) best = { score, entry: p };
  }
  return best ? pick(best.entry) : null;
}

/** 服务详情页说的是哪个服务 id：slug `services/<id>` 的末段，退而求其次读 parentService。 */
function serviceIdOfPage(page) {
  if (!page || page.serviceDetailPage !== true) return null;
  // #1550 —— 只认恰好一段 `services/<id>`（关键词页挂在 `services/<id>/<词>` 下，不是详情页）。
  if (typeof page.slug === 'string' && /^services\/[^/]+$/.test(page.slug)) return page.slug.slice('services/'.length);
  return typeof page.parentService === 'string' ? page.parentService : null;
}

/**
 * 主函数（纯函数，不碰盘、不碰页对象）。
 * @returns {{
 *   targetKeywords: { primary: object|null, byService: Record<string, object[]> },
 *   pageKeywords: Record<string, string>,   // slug → 目标词（只有首页 / 服务详情页 / 关键词页）
 *   unmatched: string[],                    // 对不上服务那几组的主词
 *   unassigned: string[],                   // 选中、非主词、却没有任何页拿它当目标词
 *   reordered: object[],                    // 名字跟位置说法不一致、按名字对上的那几组
 * }}
 */
function assignTargetKeywords({ keywords, services, contentServices, pages, keywordPagesList = [], siteType, keyword } = {}) {
  const groups = keywordGroups(keywords, services);
  const { ids, reordered } = matchGroupsToServices(groups, contentServices);
  const primary = sitePrimaryOf(groups, { siteType, keyword });

  const byService = {};
  groups.forEach((g, i) => {
    const key = ids[i] !== null ? ids[i] : g.name;
    byService[key] = [...(byService[key] || []), ...g.entries];
  });

  const pageKeywords = {};
  const list = Array.isArray(pages) ? pages : [];
  if (primary && list.some((p) => p && p.slug === 'home')) pageKeywords.home = primary.keyword;
  for (const p of list) {
    const id = serviceIdOfPage(p);
    if (id === null) continue;
    const gi = ids.indexOf(id);
    const gp = gi >= 0 ? primaryOf(groups[gi]) : null;
    if (gp) pageKeywords[p.slug] = gp.keyword;
  }
  // 关键词页：同一个 nestedSlug 可能挂着几个词（非拉丁词 slug 化后会撞），按顺序一页一个，多出来的就是没分到页。
  const queue = new Map();
  for (const kp of Array.isArray(keywordPagesList) ? keywordPagesList : []) {
    if (!kp || typeof kp.nestedSlug !== 'string') continue;
    queue.set(kp.nestedSlug, [...(queue.get(kp.nestedSlug) || []), kp.keyword]);
  }
  for (const p of list) {
    if (!p || p.keywordPage !== true || pageKeywords[p.slug] !== undefined) continue;
    const q = queue.get(p.slug);
    if (q && q.length) pageKeywords[p.slug] = q.shift();
  }

  const unmatched = [];
  groups.forEach((g, i) => {
    const gp = primaryOf(g);
    if (ids[i] === null && gp) unmatched.push(gp.keyword);
  });
  const onPages = new Set(Object.values(pageKeywords));
  const unassigned = [];
  for (const g of groups) {
    for (const e of g.entries) {
      if (e.selected && !e.isPrimary && !onPages.has(e.keyword) && !unassigned.includes(e.keyword)) unassigned.push(e.keyword);
    }
  }

  return { targetKeywords: { primary, byService }, pageKeywords, unmatched, unassigned, reordered };
}

/** 把分配结果挂到页对象上（`seo.targetKeyword`）。写盘那一步是 `{ ...page }`（blocks.js §pageWithBlocks），挂上就落盘。 */
function applyPageKeywords(pages, pageKeywords) {
  let n = 0;
  for (const p of Array.isArray(pages) ? pages : []) {
    if (!p || typeof p.slug !== 'string') continue;
    const kw = pageKeywords[p.slug];
    if (typeof kw !== 'string') continue;
    p.seo = { ...(p.seo && typeof p.seo === 'object' ? p.seo : {}), targetKeyword: kw };
    n++;
  }
  return n;
}

// ── 从站文件重算（validateSite 用；PM 裁定 ③(a)）──────────────────────────────────────────────

/** 「这个 byService 键没对上服务」唯一的谓词：键不在 services.json 的 id 集合里。 */
function unmatchedServiceKeys(targetKeywords, serviceIds) {
  const ids = new Set(Array.isArray(serviceIds) ? serviceIds : [...(serviceIds || [])]);
  const by = targetKeywords && typeof targetKeywords.byService === 'object' && targetKeywords.byService ? targetKeywords.byService : {};
  return Object.keys(by).filter((k) => !ids.has(k));
}

function pageTargetOf(page) {
  const s = page && page.seo;
  if (!s || typeof s !== 'object' || typeof s.targetKeyword !== 'string' || !s.targetKeyword.trim()) return null;
  return { keyword: s.targetKeyword.trim(), translated: s.translated === true };
}

/**
 * validateSite 那两条（#1548 做什么 4）+ 没分到页的词。
 *   ① 每页的 targetKeyword 必须在 targetKeywords 里（primary 或 byService 任一条）；翻译过来的页（translated: true）不查
 *   ② 每个**非主词**的 selected 词最多分到一页（主词同在首页 + 服务详情页不算，PM 裁定 ①）
 * @returns {{ problems: string[], unassigned: string[] }}
 */
function targetKeywordProblems({ pages, targetKeywords }) {
  const tk = targetKeywords && typeof targetKeywords === 'object' ? targetKeywords : {};
  const entries = Object.values(tk.byService && typeof tk.byService === 'object' ? tk.byService : {})
    .flatMap((arr) => (Array.isArray(arr) ? arr : []))
    .filter((e) => e && typeof e.keyword === 'string');
  const known = new Set(entries.map((e) => e.keyword));
  if (tk.primary && typeof tk.primary.keyword === 'string') known.add(tk.primary.keyword);
  const primaries = new Set(entries.filter((e) => e.isPrimary === true).map((e) => e.keyword));
  if (tk.primary && typeof tk.primary.keyword === 'string') primaries.add(tk.primary.keyword);

  const problems = [];
  const pagesOf = new Map();
  for (const p of Array.isArray(pages) ? pages : []) {
    const t = pageTargetOf(p);
    if (!t || t.translated) continue;
    const slug = (p && p.slug) || '(no slug)';
    if (!known.has(t.keyword)) {
      problems.push(`${slug}: seo.targetKeyword "${t.keyword}" 不在 seo.json 的 targetKeywords 里`);
    }
    pagesOf.set(t.keyword, [...(pagesOf.get(t.keyword) || []), slug]);
  }
  for (const [kw, slugs] of pagesOf) {
    if (primaries.has(kw) || slugs.length <= 1) continue;
    problems.push(`关键词 "${kw}" 分到了 ${slugs.length} 页（${slugs.join(' / ')}）—— 非主词每个最多一页`);
  }
  const unassigned = [];
  for (const e of entries) {
    if (e.selected === false || e.isPrimary === true || primaries.has(e.keyword)) continue;
    if (!pagesOf.has(e.keyword) && !unassigned.includes(e.keyword)) unassigned.push(e.keyword);
  }
  return { problems, unassigned };
}

// ── 提示词那一段（Call 1 / Call 2 共用；做什么 5）────────────────────────────────────────────────

/**
 * (a) 站的主词 (b) 每服务主词 (c) 关键词页清单 → 一段提示词。什么都没有时回空串（提示词不多一个字节）。
 * @param {{ sitePrimary: object|null, groups: object[], keywordPagesList: object[] }} p
 */
function keywordBrief({ sitePrimary, groups = [], keywordPagesList = [] }) {
  const svc = groups.map((g) => ({ name: g.name, p: primaryOf(g) })).filter((x) => x.p);
  if (!sitePrimary && !svc.length && !keywordPagesList.length) return '';
  const lines = ['SEO TARGET KEYWORDS (from the owner\'s keyword research — use these exact phrases, do not swap them for others):'];
  if (sitePrimary) lines.push(`- Site primary keyword: "${sitePrimary.keyword}" — the HOME page targets it: build the home page title, meta description and h1 around it.`);
  if (svc.length) {
    lines.push('- Each service\'s primary keyword — that service\'s detail page (if there is one) targets it: build its title, meta description and h1 around it:');
    for (const x of svc) lines.push(`  - ${x.name} → "${x.p.keyword}"`);
  }
  if (keywordPagesList.length) {
    lines.push('- Keyword pages (one page per keyword, each targets its own keyword):');
    // #1550 —— Call 1 那一刻服务 id 还没有，关键词页的 URL（`services/<id>/<slug>`）定不下来：没有路径时写它属于哪个服务。
    for (const kp of keywordPagesList) {
      lines.push(kp.nestedSlug ? `  - /${kp.nestedSlug} → "${kp.keyword}"` : `  - "${kp.keyword}" (a page of its own under the ${kp.group} service)`);
    }
  }
  return lines.join('\n');
}

module.exports = {
  keywordGroups,
  matchGroupsToServices,
  sitePrimaryOf,
  assignTargetKeywords,
  applyPageKeywords,
  unmatchedServiceKeys,
  targetKeywordProblems,
  keywordBrief,
};
