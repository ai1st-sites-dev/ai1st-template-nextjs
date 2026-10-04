// ══════════════════════════════════════════════════════════════════════════════════════════════════
// seo-problems.js — 一页生成出来之后，关键词在不在该在的位置、事实有没有出处（#1549，设计文档 S2）
// ══════════════════════════════════════════════════════════════════════════════════════════════════
//
// 🔴 **这是检查，不是提示词里的一句话。** 在这之前对关键词位置的全部要求是 Call 2 提示词里一句
//    「Use the target keyword naturally in …」，生成后没有任何东西核对。建站那条路（create-site.js
//    §seoPass）每页跑一次：有问题带着问题重写那一页一次，仍有问题按页面类型处置。
//
// 纯函数：不碰盘、不碰网络、不改页对象。读的是 AI 吐回来的页（`sections` 或 `blocks`，§blocksOf 两种都认）。
//
// 八条规则（正文做什么 1 那张表）。`targetKeyword` 为空的页（about / contact / services 列表 …）
// **按半条拆**，跟目标词无关的那一半照判：
//
//   条            有目标词                                    没有目标词
//   1 title       含目标词；连品牌后缀 ≤ 60                   只判长度
//   2 description 含目标词 + 地点；70–155                     只判长度
//   3 H1          恰好一个；含目标词的每个词干                只判恰好一个
//   4 前 100 词   出现目标词                                  不判
//   5 slug        每段非空 + 站内唯一                         同左（转写对不对归 T6 #1550）
//   6 内容图 alt  每张非空；至少一张含目标词                  只判每张非空
//   7 两个 H2     ≥2 个 H2 各含目标词的至少一个词干           不判
//   8 事实出处    年份 / 金额 / licensed … 在建站表格里有出处 同左
//
// 每条 problem 以 `[<条号> <名字>]` 开头 —— 日志、重写提示词、建站失败信息读的都是这一串，
// 测试按前缀判是哪一条开的火。

'use strict';

const { blocksOf, loadManifests } = require('./block-manifest');
const { effectiveKnobs } = require('./block-knobs');

// ── 字与词 ─────────────────────────────────────────────────────────────────────────────────────

/** 字数 = Unicode 码点数（「é」「剪」都算 1，代理对不拆成 2）。 */
const charLen = (s) => [...String(s || '')].length;

/** 比较用的形式：NFKD 去掉附加符号（é → e）、小写、标点当空格、空白压成一个。 */
function fold(s) {
  return String(s || '')
    .normalize('NFKD').replace(/\p{M}+/gu, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}

// 没有空格分词的文字：一个字算一个词（「前 100 词」对中文就是前 100 个字）。
const CJK = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/u;

/** 词序列（已 fold）。拉丁 / 西里尔等按空格；CJK 逐字。 */
function words(s) {
  const out = [];
  for (const chunk of fold(s).split(' ')) {
    if (!chunk) continue;
    if (!CJK.test(chunk)) { out.push(chunk); continue; }
    let buf = '';
    for (const ch of chunk) {
      if (CJK.test(ch)) { if (buf) { out.push(buf); buf = ''; } out.push(ch); } else buf += ch;
    }
    if (buf) out.push(buf);
  }
  return out;
}

// 只收不承载话题的词。🔴 不收 "service(s)" / "best" 这类 —— 它们在目标词里时就是目标词的一部分。
const STOPWORDS = new Set(('a an and are at be by for from in into is it me my near of on or our the to with your you '
  + 'de des du la le les et en un une el los las y del da do das dos e em der die das und im zu mit').split(' '));

/**
 * 极简词干：剥最常见的英文后缀，让「自然变体」认成同一个词 —— plumber / plumbers / plumbing、delivery / delivered、
 * decorating / decorate / decoration。不追求语言学正确：两边过的是同一个函数，过度合并（corner → corn）只会让第 3、7 条
 * 更宽，不会让它们误报。
 * 📌 #1549 交付前在一个真 AI 建的站上量出来的：只剥屈折后缀时，「Plant Delivery」对 H1「…Plants Delivered…」、
 *    「Event Decorating」对「…Floral Design」以外的写法都读成「不含」—— 所以收尾再剥一次 -e / -y。
 */
function stem(w) {
  if (w.length <= 3 || CJK.test(w)) return w;
  let out = w;
  for (const [suf, rep] of [['ions', ''], ['ion', ''], ['ies', 'y'], ['ing', ''], ['ers', ''], ['er', ''], ['ed', ''], ['es', ''], ['s', '']]) {
    if (out.endsWith(suf) && out.length - suf.length >= 3) { out = out.slice(0, out.length - suf.length) + rep; break; }
  }
  if (out.length > 4 && /[ey]$/.test(out)) out = out.slice(0, -1);
  return out;
}

/**
 * 目标词的「词干」：去停用词后每个词的词干。CJK 连着的一串按**两字一组**（「剪头发」→ 剪头 / 头发）——
 * 单字太宽（「发」到处都有），整串太窄（「剪发」认不出来）。只有一个字的串就是那个字。
 */
function keywordStems(keyword) {
  const out = [];
  let run = '';
  const flush = () => {
    if (!run) return;
    const cs = [...run];
    if (cs.length === 1) out.push(cs[0]);
    for (let i = 0; i + 1 < cs.length; i++) out.push(cs[i] + cs[i + 1]);
    run = '';
  };
  for (const w of words(keyword)) {
    if (CJK.test(w) && [...w].length === 1) { run += w; continue; }
    flush();
    if (!STOPWORDS.has(w)) out.push(stem(w));
  }
  flush();
  return [...new Set(out)];
}

/** 这段文字里有没有这个词干（拉丁按词比词干；CJK 两字组按子串）。 */
function hasStem(text, st) {
  if (CJK.test(st)) return fold(text).replace(/ /g, '').includes(st);
  return words(text).some((w) => stem(w) === st);
}

/** 整个目标词按词序出现（fold 之后逐词相等）。「Plumbing in Markham」不含「plumbing markham」。 */
function hasPhrase(text, keyword) {
  const k = words(keyword);
  if (!k.length) return false;
  const t = words(text);
  for (let i = 0; i + k.length <= t.length; i++) {
    let hit = true;
    for (let j = 0; j < k.length; j++) if (t[i + j] !== k[j]) { hit = false; break; }
    if (hit) return true;
  }
  return false;
}

// ── 页面里的字 ────────────────────────────────────────────────────────────────────────────────

// 不是给访客读的字：旋钮、颜色、链接、图址、图标名、引用写法、表单引用 …
const NOT_TEXT = new Set(['options', 'bg', 'href', 'imageUrl', 'alt', 'icon', 'id', 'form', 'source', 'under',
  'style', 'size', 'arrow', 'kind', 'shape', 'role', 'region', 'weight', 'visibility', 'type', 'logoUrl', 'url']);

const stripTags = (s) => String(s).replace(/<[^>]*>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&');

function textsOf(v, out) {
  if (typeof v === 'string') { if (v.trim()) out.push(stripTags(v)); return out; }
  if (Array.isArray(v)) { for (const x of v) textsOf(x, out); return out; }
  if (v && typeof v === 'object') {
    for (const [k, x] of Object.entries(v)) if (!NOT_TEXT.has(k)) textsOf(x, out);
  }
  return out;
}

/** 一页给访客读的字，按块的先后；每块先 headline 再其余（「前 100 词」从页面顶上数）。 */
function pageText(page) {
  const out = [];
  for (const sec of blocksOf(page)) {
    const d = sec && sec.data && typeof sec.data === 'object' ? sec.data : {};
    if (typeof d.headline === 'string') textsOf(d.headline, out);
    const { headline: _h, ...rest } = d;
    textsOf(rest, out);
  }
  return out.join('\n');
}

const str = (v) => (typeof v === 'string' && v.trim() ? v.trim() : '');

// ── H1 / H2 ───────────────────────────────────────────────────────────────────────────────────
// 🔴 两张表是**块渲染出来的标签**，不是猜的：`seo-problems.test.js` ⑤ 把每个块真渲染一遍数 <h1> / <h2>，
//    跟这两张表对账。加一个出 <h2> 的块而不改这里，那一格会红。

const H1_BLOCKS = new Set(['hero', 'page-header']);
const H2_BLOCKS = new Set(['blog', 'contact', 'content', 'cta', 'faq', 'features', 'gallery', 'logos', 'milestones',
  'pricing', 'reviews', 'team', 'testimonials']);

function headingsOf(page, set) {
  return blocksOf(page)
    .filter((s) => s && set.has(s.type) && s.data && str(s.data.headline))
    .map((s) => str(s.data.headline));
}

// ── 内容图 ────────────────────────────────────────────────────────────────────────────────────
//
// 判据（正文做什么 2，PM 2026-10-04 裁）：一个图槽算内容图，当且仅当它**真的渲染出一个 <img>**，再减掉
// 装饰图和人像 / 标志。下面这张表就是按这条从各块 Section.tsx 读出来的，`seo-problems.test.js` ⑥ 把块
// 真渲染出来数 <img src> 跟它对账（读源码的判断可能错，渲染出来的不会）。
//
//   命中（场景图，alt 该是一句描述）：
//     hero.image（image ∈ left/right/top/bottom）· hero.band[] · cta.image（left/right）· content.image（≠ none）
//     page-header.image（left/right）· features.introImage / itemsImage / items[].image（各自旋钮 ≠ none）
//     milestones.blockImage / introImage（≠ none；blockImage=background 也画 <img>）· gallery.items[].image
//   不算：
//     page-header.image=background —— 铺底，组件写死 alt=""（旁边有文字，空 alt 才是对的无障碍写法）
//     hero / cta 的 image=background —— 只是 CSS 背景 + aria-label，不出 <img>
//     头像与标志：hero / pricing 的 proof.avatars 与 logos、logos 块、team 成员照、testimonials 照片 ——
//       它们的 alt 该是人名 / 品牌名，不是描述（正文「作者头像」那条同类）
//     blog 封面 —— 在 `blog/*.json` 里，不在页面数据里
//
// 每项回 `{ secIdx, type, slot, itemIdx, img, alt }`：`img` 是页面数据里那个 `{imageUrl, alt}` 对象本身（生图那一侧
// 往里写 alt 用它），`alt` 是**渲染出来的** alt（gallery 没写 alt 时组件拿条目标题顶上，§altOf）。

const IMG_SLOTS = {
  hero: [{ slot: 'image', knob: 'image', on: ['left', 'right', 'top', 'bottom'] }, { slot: 'band', list: true, max: 6 }],
  cta: [{ slot: 'image', knob: 'image', on: ['left', 'right'] }],
  content: [{ slot: 'image', knob: 'image' }],
  'page-header': [{ slot: 'image', knob: 'image', on: ['left', 'right'] }],
  features: [
    { slot: 'introImage', knob: 'introImage' },
    { slot: 'itemsImage', knob: 'itemsImage' },
    { slot: 'items', list: true, nested: 'image', knob: 'itemImage', maxFrom: 'items', capBeforeFilter: true },
  ],
  milestones: [{ slot: 'blockImage', knob: 'blockImage' }, { slot: 'introImage', knob: 'introImage' }],
  gallery: [{ slot: 'items', list: true, nested: 'image', maxFrom: 'items', altFallback: 'title' }],
};

const hasUrl = (o) => !!(o && typeof o === 'object' && !Array.isArray(o) && str(o.imageUrl));

let manifestCache = null;
function manifestsMap(manifests) {
  if (manifests) return manifests instanceof Map ? manifests : new Map(Object.entries(manifests));
  if (!manifestCache) manifestCache = loadManifests();
  return manifestCache;
}

function contentImagesOf(page, manifests) {
  const ms = manifestsMap(manifests);
  const out = [];
  blocksOf(page).forEach((sec, secIdx) => {
    const rules = sec && IMG_SLOTS[sec.type];
    if (!rules) return;
    const d = sec.data && typeof sec.data === 'object' ? sec.data : {};
    const m = ms.get(sec.type);
    const k = m ? effectiveKnobs(m, sec.shape, d.options) : {};
    for (const r of rules) {
      if (r.knob) {
        const v = k[r.knob];
        if (v === 'none' || (r.on && !r.on.includes(v))) continue;
      }
      if (!r.list) {
        if (hasUrl(d[r.slot])) out.push({ secIdx, type: sec.type, slot: r.slot, itemIdx: null, img: d[r.slot], alt: str(d[r.slot].alt) });
        continue;
      }
      const max = r.max || (r.maxFrom && m && m.slots && m.slots[r.maxFrom] && m.slots[r.maxFrom].maxItems) || Infinity;
      const items = Array.isArray(d[r.slot]) ? d[r.slot] : [];
      // 上限怎么截跟组件一样：features 先截条目再看有没有图（`allItems.slice(0, MAX)`）；band / gallery 先滤掉没图的再截。
      let n = 0;
      items.forEach((it, itemIdx) => {
        if (r.capBeforeFilter ? itemIdx >= max : n >= max) return;
        if (!it || typeof it !== 'object') return;
        const img = r.nested ? it[r.nested] : it;
        if (!hasUrl(img)) return;
        n += 1;
        const alt = str(img.alt) || (r.altFallback ? str(it[r.altFallback]) : '');
        out.push({ secIdx, type: sec.type, slot: r.slot, itemIdx, img, alt });
      });
    }
  });
  return out;
}

// ── title 预算 ────────────────────────────────────────────────────────────────────────────────

// #1563 —— 这个数住在 seo-limits.json：dashboard 的 Lead 主词框从同一份文件取它当上限（Lead 主词就是首页的目标词，
//    首页 title 必须含它且 ≤ TITLE_MAX ⟹ 超过它的主词必然让整站建不出来）。JSON 不带依赖，浏览器能直接 import。
const { titleMax: TITLE_MAX } = require('./seo-limits.json');
const SUFFIX = ' | ';
const MIN_PAGE_TITLE_BUDGET = 20; // 正文做什么 4：子页 page.title 的预算 < 20 ⟹ 长度那一半不判（品牌名是用户填的）

/** 主语言的品牌名：`brand.name[locale]`，不回退到别的语言（正文做什么 1）。 */
function brandNameOf(brand, locale) {
  const n = brand && brand.name;
  if (typeof n === 'string') return n;
  if (n && typeof n === 'object' && typeof n[locale] === 'string') return n[locale];
  return '';
}

/** 子页 `page.title` 最多几个字：60 − 3 − 品牌名字数。 */
function pageTitleBudget(brandName) {
  return TITLE_MAX - charLen(SUFFIX) - charLen(brandName);
}

// ── 事实出处（规则 8）──────────────────────────────────────────────────────────────────────────
//
// 🔴 出处 = **整份建站表格**里的字（正文点名的 USP / 描述 / 评价 / 营业时间 / 地址，加上同一张表格里的电话、公司名、
//    地点、价格区间、服务、补充说明）：只按那五栏找，电话「416-555-2015」里的 2015、公司名「Plumbing 2000」、价格区间
//    「$50–$100」都会被判成编造，而首页上判一条就是整站建不出来。判据仍是「建站表格里有没有」。
// 🔴 声明词按**整词**认，不按词干：按词干 `insurance` 会命中 `insured`，保险经纪的站每页开火。

const SOURCE_FIELDS = ['companyName', 'industry', 'location', 'address', 'phone', 'email', 'services', 'usp',
  'targetCustomers', 'brandDescription', 'reviews', 'onlinePresence', 'hours', 'priceRange', 'keyword',
  'additionalContext', 'brandNameByLocale'];

function sourceText(payload) {
  const p = payload && typeof payload === 'object' ? payload : {};
  const out = [];
  const walk = (v) => {
    if (typeof v === 'string') out.push(v);
    else if (typeof v === 'number') out.push(String(v));
    else if (Array.isArray(v)) v.forEach(walk);
    else if (v && typeof v === 'object') Object.values(v).forEach(walk);
  };
  for (const f of SOURCE_FIELDS) walk(p[f]);
  return out.join('\n');
}

const digitsOf = (s) => String(s).replace(/[,\s]/g, '');

// 声明词：页面上出现 ⟹ 表格里要有同一族的词。中文对应词只收不会撞上普通用法的（「保险」单独是 insurance，不收）。
const CLAIMS = [
  { name: 'licensed', page: /\blicensed\b|持牌|有执照|持证/i, source: /\blicen[cs]ed?\b|\blicen[cs]e\b|持牌|执照|牌照|持证/i },
  { name: 'insured', page: /\binsured\b|已投保|全额投保/i, source: /\binsured\b|投保|保险/i },
  { name: 'certified', page: /\bcertified\b|认证/i, source: /\bcertifi(?:ed|cation|cate)s?\b|认证/i },
  { name: 'award', page: /\bawards?\b|\baward-winning\b|\bawarded\b|获奖|荣获/i, source: /\bawards?\b|\baward-winning\b|\bawarded\b|获奖|荣获|奖/i },
];

function factProblems(text, src) {
  const problems = [];
  const srcFold = src.toLowerCase();
  const srcDigits = digitsOf(src);
  const seen = new Set();
  const flag = (what, why) => {
    if (seen.has(what)) return;
    seen.add(what);
    problems.push(`[8 事实出处] 编造的事实：「${what}」—— ${why}`);
  };
  // 年份：独立的 19xx / 20xx —— 前后不挨着数字，也不是「555-2015」这种用 - / . 连着别的数字的（电话、日期）。
  //   句末的句点不算连着（「since 2015.」照样是年份）。
  for (const m of text.matchAll(/(?<!\d)(?<!\d[-./])((?:19|20)\d{2})(?!\d)(?![-./]\d)/g)) {
    if (!new RegExp(`(?<!\\d)${m[1]}(?!\\d)`).test(src)) flag(m[1], `年份 ${m[1]} 在建站表格里找不到`);
  }
  // 金额：$ € £ ¥ 打头，或数字 + 元 / dollars
  for (const m of text.matchAll(/[$€£¥]\s?(\d[\d,]*(?:\.\d+)?)|(\d[\d,]*(?:\.\d+)?)\s?(?:元|块钱|dollars?\b)/gi)) {
    const num = digitsOf(m[1] || m[2]);
    if (!srcDigits.includes(num)) flag(m[0].trim(), `金额 ${num} 在建站表格里找不到`);
  }
  // 「N years」「N 年经验」：N 和「年 / year」都要在表格里
  for (const m of text.matchAll(/(\d+)\+?\s*(?:years?|yrs?)\b|(\d+)\s*\+?\s*(?:多)?年(?:经验|历史|以上)/gi)) {
    const n = m[1] || m[2];
    if (n.length === 4) continue; // 2015年 这种是年份，上面那条管
    const ok = new RegExp(`(?<!\\d)${n}(?!\\d)`).test(src) && /years?|yrs?|年/i.test(src);
    if (!ok) flag(m[0].trim(), `「${n} 年」在建站表格里找不到`);
  }
  for (const c of CLAIMS) {
    const m = text.match(c.page);
    if (m && !c.source.test(srcFold)) flag(m[0], `「${c.name}」在建站表格里找不到`);
  }
  return problems;
}

// ── 主函数 ────────────────────────────────────────────────────────────────────────────────────

/** 这一页会跑哪几条（建站日志每页一行用它；没有目标词时第 4、7 条不跑）。 */
function rulesFor(targetKeyword) {
  return str(targetKeyword) ? [1, 2, 3, 4, 5, 6, 7, 8] : [1, 2, 3, 5, 6, 8];
}

/**
 * @param {{ page, pages, targetKeyword, brand, payload, locale, seo, manifests? }} p
 *   page          AI 吐回来的一页（`sections` 或 `blocks`）
 *   pages         整站的页（第 5 条站内去重）
 *   targetKeyword 这一页的目标词（T4 #1548 挂的 `seo.targetKeyword`；没有就空）
 *   brand         BrandConfig（`brand.name` 是按语言的表）
 *   payload       建站表格（第 2 条的地点、第 8 条的出处）
 *   locale        站的主语言
 *   seo           站的 seo（首页渲染出来的 <title> / description 是 `seo.siteTitle` / `seo.siteDescription`，
 *                 不在 page 对象上 —— `metadata.ts §homeMetadata`）
 * @returns {string[]}
 */
function seoProblems({ page, pages = [], targetKeyword, brand, payload, locale, seo, manifests } = {}) {
  const problems = [];
  if (!page || typeof page !== 'object') return ['[0] 页面不是一个对象'];
  const kw = str(targetKeyword);
  const isHome = page.slug === 'home';
  const s = seo && typeof seo === 'object' ? seo : {};
  const brandName = brandNameOf(brand, locale);

  // 1 title
  {
    const title = isHome ? str(s.siteTitle) : str(page.title);
    const budget = isHome ? TITLE_MAX : pageTitleBudget(brandName);
    const total = isHome ? charLen(title) : charLen(title) + charLen(SUFFIX) + charLen(brandName);
    if (isHome || budget >= MIN_PAGE_TITLE_BUDGET) {
      if (total > TITLE_MAX) {
        problems.push(isHome
          ? `[1 title] 首页 title（seo.siteTitle）${total} 字，最多 ${TITLE_MAX} 字`
          : `[1 title] title 总长 ${total} 字（page.title ${charLen(title)} 字 + " | ${brandName}"），page.title 最多 ${budget} 字`);
      }
    }
    if (kw && !hasPhrase(title, kw)) problems.push(`[1 title] title 不含目标词「${kw}」：「${title}」`);
  }

  // 2 description
  {
    const desc = isHome ? str(s.siteDescription) : str(page.description);
    const n = charLen(desc);
    if (n < 70 || n > 155) problems.push(`[2 description] description ${n} 字，要 70–155 字`);
    if (kw) {
      if (!hasPhrase(desc, kw)) problems.push(`[2 description] description 不含目标词「${kw}」`);
      const place = str(String((payload && payload.location) || '').split(',')[0]);
      if (place && !hasPhrase(desc, place)) problems.push(`[2 description] description 不含地点「${place}」`);
    }
  }

  // 3 H1
  {
    const h1 = headingsOf(page, H1_BLOCKS);
    if (h1.length !== 1) problems.push(`[3 H1] 要恰好一个 H1（hero / page-header 的 headline），这一页有 ${h1.length} 个`);
    if (kw && h1.length >= 1) {
      const miss = keywordStems(kw).filter((st) => !hasStem(h1[0], st));
      if (miss.length) problems.push(`[3 H1] H1「${h1[0]}」不含目标词「${kw}」（缺 ${miss.join(' / ')}）`);
    }
  }

  // 4 前 100 词
  if (kw) {
    const first = words(pageText(page)).slice(0, 100).join(' ');
    if (!hasPhrase(first, kw)) problems.push(`[4 前 100 词] 页面前 100 词里没有目标词「${kw}」`);
  }

  // 5 slug
  {
    const slug = typeof page.slug === 'string' ? page.slug : '';
    if (!slug || slug.split('/').some((seg) => !seg.trim())) problems.push(`[5 slug] slug「${slug}」有空段`);
    const same = (Array.isArray(pages) ? pages : []).filter((p) => p && p !== page && p.slug === slug);
    if (slug && same.length) problems.push(`[5 slug] slug「${slug}」站内重复 ${same.length + 1} 次`);
  }

  // 6 内容图 alt
  {
    const imgs = contentImagesOf(page, manifests);
    const empty = imgs.filter((x) => !x.alt);
    for (const x of empty) {
      problems.push(`[6 alt] 内容图 alt 为空：块 ${x.type}（第 ${x.secIdx + 1} 块）· ${x.slot}${x.itemIdx === null ? '' : `#${x.itemIdx}`}`);
    }
    if (kw && imgs.length && !imgs.some((x) => hasPhrase(x.alt, kw))) {
      problems.push(`[6 alt] ${imgs.length} 张内容图的 alt 没有一张含目标词「${kw}」`);
    }
  }

  // 7 两个 H2
  if (kw) {
    const stems = keywordStems(kw);
    const h2 = headingsOf(page, H2_BLOCKS);
    const hit = h2.filter((h) => stems.some((st) => hasStem(h, st)));
    if (hit.length < 2) problems.push(`[7 H2] 要至少 2 个 H2 含目标词「${kw}」的词（${stems.join(' / ')}），这一页 ${h2.length} 个 H2 里有 ${hit.length} 个`);
  }

  // 8 事实出处
  {
    const text = [isHome ? s.siteTitle : page.title, isHome ? s.siteDescription : page.description, pageText(page)]
      .filter((x) => typeof x === 'string').join('\n');
    problems.push(...factProblems(text, sourceText(payload)));
  }

  return problems;
}

module.exports = {
  seoProblems,
  rulesFor,
  contentImagesOf,
  pageTitleBudget,
  brandNameOf,
  keywordStems,
  hasPhrase,
  hasStem,
  pageText,
  sourceText,
  H1_BLOCKS,
  H2_BLOCKS,
  IMG_SLOTS,
  TITLE_MAX,
  MIN_PAGE_TITLE_BUDGET,
};
