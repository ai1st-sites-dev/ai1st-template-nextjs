'use strict';
// ══════════════════════════════════════════════════════════════════════════════════════════════════
// local-business-facts.js —— LocalBusiness 结构化数据里「从老板给的料来」的那几项（#1551，SEO epic T7）
// ══════════════════════════════════════════════════════════════════════════════════════════════════
//
// 🔴 **营业时间**（`seo.schema.openingHours`）：建站表格里的 `hours` 是老板用母语写的**一句话**（`Mon-Fri 9-6`、
//    Google 商家资料的逐天格式、`周一至周五上午9点至下午6点`……语言不限）。所以：
//    · 没写 ⟹ 整项不出，也不问 AI（`create-site.js` 的提示词里这一项只在有料时出现）；
//    · 写了 ⟹ AI 只把这句话**转写**成结构，这里再核一遍（§verifyTranscription）：每个 `opens` / `closes` 的小时数
//      必须在原文里出现（按 12 小时制比：`18:00` 对得上原文的 `6pm` / `6点`），段数 ≤ 7；核不过 ⟹ 不出。
//      🔴 不按「原文里有几个时间区间」去数段数：中文写法里没有 `9-6` 这种区间形状，会数出 0 而把整项误杀（PM #1551 裁定）。
//    · 结构是**多段**：一组 `{days, opens, closes}`（老站那种单个对象照旧认，§hoursSegments）。读它的有两处 ——
//      JSON-LD（每段一条 `openingHoursSpecification`）和 contact 块那一行（`contact-facts.js` §formatHours）。
// 🔴 **评分**（`seo.schema.aggregateRating`）：只在 payload 抓到了真实评分（`onlinePresence.platformRatings`）时出；
//    分数和评价条数缺一个就不出，不编（§ratingFrom）。

const DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
const MAX_SEGMENTS = 7;

const str = (v) => (typeof v === 'string' ? v.trim() : '');

/** `Monday` / `mon` / `Mo` → `Monday`；认不出 → ''（只认英文星期名：它直接进 JSON-LD 的 `dayOfWeek`）。 */
function canonicalDay(d) {
  const s = str(d).toLowerCase().replace(/\.$/, '');
  if (s.length < 2) return '';
  return DAYS.find((day) => day.toLowerCase().startsWith(s)) || '';
}

/** `9:00` / `09:00` / `24:00` → `09:00` / `24:00`；认不出 → ''。 */
function canonicalTime(t) {
  const m = /^(\d{1,2}):(\d{2})$/.exec(str(t));
  if (!m) return '';
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h > 24 || min > 59 || (h === 24 && min !== 0)) return '';
  return `${String(h).padStart(2, '0')}:${m[2]}`;
}

/** 一段 → `{days, opens, closes}`（规范化过的）；任何一格认不出 → null。`strict`：有一天认不出也算整段认不出。 */
function canonicalSegment(seg, strict) {
  if (!seg || typeof seg !== 'object' || Array.isArray(seg)) return null;
  const rawDays = Array.isArray(seg.days) ? seg.days : [];
  const days = [];
  for (const d of rawDays) {
    const c = canonicalDay(d);
    if (!c) { if (strict) return null; continue; }
    if (!days.includes(c)) days.push(c);
  }
  const opens = canonicalTime(seg.opens);
  const closes = canonicalTime(seg.closes);
  if (!days.length || !opens || !closes) return null;
  return { days: days.sort((a, b) => DAYS.indexOf(a) - DAYS.indexOf(b)), opens, closes };
}

/**
 * 站点数据里的 `openingHours` → 一组规范化的段。老站的单个对象、新站的数组都认；没填（`days` 空 / 时间空串）或认不出的段丢掉。
 * 一段都没有 ⟹ []（JSON-LD 不出 `openingHoursSpecification`，contact 那一行不画）。
 */
function hoursSegments(value) {
  const list = Array.isArray(value) ? value : value && typeof value === 'object' ? [value] : [];
  return list.map((s) => canonicalSegment(s, false)).filter(Boolean);
}

/** 原文里出现过的整数（不含紧跟在 `:` 后面的分钟；全角数字先折成半角）。 */
function numbersIn(text) {
  const s = String(text || '').normalize('NFKC');
  const out = new Set();
  for (const m of s.matchAll(/(?<![:\d])\d+/g)) out.add(Number(m[0]));
  return out;
}

/** 一个 `HH:MM` 的小时数在原文里出现过吗（按 12 小时制比：18 → 6，0 → 12）。 */
function hourInText(time, nums) {
  const h = Number(time.slice(0, 2));
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return nums.has(h) || nums.has(h12);
}

/**
 * 核 AI 对 `hours` 那句话的转写。
 * @param {string} text  payload 的 `hours`（老板写的原文）
 * @param {unknown} aiValue  AI 填的 `seo.openingHours`（一组段，或单个对象）
 * @returns {{ segments: Array<{days: string[], opens: string, closes: string}>, reason: string }}
 *   通过 ⟹ `segments` 非空、`reason` 空串；不出 ⟹ `segments` 空、`reason` 说为什么（原文为空时也是空串：本来就不该有）。
 */
function verifyTranscription(text, aiValue) {
  const src = str(text);
  if (!src) return { segments: [], reason: '' };
  const raw = Array.isArray(aiValue) ? aiValue : aiValue && typeof aiValue === 'object' ? [aiValue] : [];
  if (!raw.length) return { segments: [], reason: `AI 没有给出营业时间（原文「${src}」）` };
  if (raw.length > MAX_SEGMENTS) return { segments: [], reason: `AI 给了 ${raw.length} 段营业时间，一周最多 ${MAX_SEGMENTS} 段` };
  const nums = numbersIn(src);
  const segments = [];
  for (const seg of raw) {
    const c = canonicalSegment(seg, true);
    if (!c) return { segments: [], reason: `AI 给的营业时间有一段认不出：${JSON.stringify(seg)}` };
    for (const t of [c.opens, c.closes]) {
      if (!hourInText(t, nums)) return { segments: [], reason: `AI 给的 ${t} 在原文「${src}」里找不到（按 12 小时制比）` };
    }
    segments.push(c);
  }
  return { segments, reason: '' };
}

/**
 * payload 抓到的平台评分 → `{ ratingValue, reviewCount }`；没有真实数据 ⟹ null。优先 google，其余按出现顺序取第一个
 * 分数在 (0, 5]、评价条数是正整数的那一家。
 */
function ratingFrom(onlinePresence) {
  const pr = onlinePresence && typeof onlinePresence === 'object' ? onlinePresence.platformRatings : null;
  if (!pr || typeof pr !== 'object') return null;
  const names = Object.keys(pr).sort((a, b) => (a === 'google' ? -1 : b === 'google' ? 1 : 0));
  for (const name of names) {
    const info = pr[name];
    if (!info || typeof info !== 'object') continue;
    const ratingValue = Number(info.rating);
    const reviewCount = Number(info.reviewCount);
    if (Number.isFinite(ratingValue) && ratingValue > 0 && ratingValue <= 5 && Number.isInteger(reviewCount) && reviewCount > 0) {
      return { ratingValue, reviewCount };
    }
  }
  return null;
}

module.exports = { DAYS, MAX_SEGMENTS, canonicalDay, canonicalTime, hoursSegments, numbersIn, verifyTranscription, ratingFrom };
