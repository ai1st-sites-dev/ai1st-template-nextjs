// build-report.js —— 建站报告（#1600，设计文档 B4）。
//
// 一次建站结束时 `site/build-report.json` 里的那一份：「这个站建得好不好、差在哪」。
//
// 🔴 结构一次写全：下面 REPORT_KEYS 九个键**恒在**。今天没有生产者的格子值是 `null`，不是 0、不是缺键 ——
//    0 会被读成「真的是零」（0 处降级 ≠ 没人数过降级），缺键会让 admin 卡整行消失。
//    每一格由谁生产（今天）：
//      seo / repair / keywordPages  create-site.js 真 AI 路（seoPass #1549 / 关键词页 #1550）；skipAI 走不到 ⟹ null
//      deadLinks                    worker/entrypoint.sh 在 next build 之后跑 check-dead-links.js，经
//                                   scripts/finish-build-report.js 并进来（两条路都有）
//      lighthouse                   恒 null：preview-started 之后才跑，进不了这份文件；admin 卡从 site_quality 取
//      stages / images / degraded / archive   T7 #1599 / T5 #1594 / T2 #1596 / T1 #1592 接上之前是 null
//
// 📌 这份文件不进站仓（.gitignore），数据库 `site_build_reports` 那一行才是权威（manager 收 `build-report` 事件落库）。

'use strict';

const fs = require('fs');
const path = require('path');

const REPORT_VERSION = 1;
const REPORT_KEYS = ['seo', 'repair', 'keywordPages', 'deadLinks', 'lighthouse', 'stages', 'images', 'degraded', 'archive'];
const SEO_RULES = [1, 2, 3, 4, 5, 6, 7, 8];
const REPORT_FILE = 'build-report.json';
// 死链清单可能很长；数照记，清单只留前这么多条（admin 卡也只列这么多）。
const DEAD_LIST_MAX = 100;

/**
 * 空报告：九个键都在、全是 null。
 * 🔴 报告里**不放站 id**：数据库那一行的 `site_id` 列就是它的锚。JSON 里再存一份，#711 的 ID 迁移改写 site id 时
 *    改不到它（迁移残留扫描会把它当成一个没被改写的旧 id）—— 一份没人读的副本只会变成迁移的绊脚石。
 */
function createReport({ path: buildPath = 'ai' } = {}) {
  const r = { version: REPORT_VERSION, path: buildPath, generatedAt: null, durationSec: null };
  for (const k of REPORT_KEYS) r[k] = null;
  return r;
}

/** 一条 seoProblems 问题属于第几条规则（问题文案恒以 `[N 名字]` 开头，seo-problems.js）；认不出 ⟹ null。 */
function ruleOf(problem) {
  const m = /^\[(\d)\b/.exec(String(problem || ''));
  const n = m ? Number(m[1]) : NaN;
  return SEO_RULES.includes(n) ? n : null;
}

/**
 * 一页的八条结果：pass（跑了、没出过问题）· fixed（第一次没过、重写后过了）· fail（最后仍没过）· n/a（这一页不跑这一条）。
 * @param {{ rules:number[], first:string[], final:string[] }} p
 */
function pageChecks({ rules, first, final }) {
  const ran = new Set(Array.isArray(rules) ? rules : SEO_RULES);
  const firstFail = new Set((first || []).map(ruleOf));
  const finalFail = new Set((final || []).map(ruleOf));
  const out = {};
  for (const n of SEO_RULES) {
    if (finalFail.has(n)) out[n] = 'fail';
    else if (firstFail.has(n)) out[n] = 'fixed';
    else out[n] = ran.has(n) ? 'pass' : 'n/a';
  }
  return out;
}

/**
 * 记一次 seoPass 的结果（create-site.js 里可能跑两次：整站一次 + 代码补出来的服务详情页一次）。
 * 按 slug 合并（后一次覆盖同 slug），修补数累加。
 * @param {object} report
 * @param {{ checked:number, rewritten:number, pages:Array<{slug,targetKeyword,rules,first,final,rewritten,outcome}> }} result
 */
function recordSeo(report, result) {
  if (!report || !result || !Array.isArray(result.pages)) return report;
  const prev = report.seo && Array.isArray(report.seo.pages) ? report.seo.pages : [];
  const bySlug = new Map(prev.map((p) => [p.slug, p]));
  for (const p of result.pages) {
    bySlug.set(p.slug, {
      slug: p.slug,
      targetKeyword: p.targetKeyword || null,
      checks: pageChecks(p),
      firstProblems: (p.first || []).slice(),
      problems: (p.final || []).slice(),
      rewritten: !!p.rewritten,
      outcome: p.outcome,
    });
  }
  report.seo = { pages: [...bySlug.values()] };
  const r = report.repair || { rewritten: 0, pages: 0 };
  report.repair = {
    rewritten: r.rewritten + (Number(result.rewritten) || 0),
    pages: r.pages + (Number(result.checked) || 0),
  };
  return report;
}

/** 关键词页 N/M（create-site.js 的 `keyword-pages` 事件那一份 kwReport）。没计划任何关键词页的真 AI 站是 0/0，不是 null。 */
function recordKeywordPages(report, kw) {
  if (!report || !kw) return report;
  report.keywordPages = {
    ok: Number(kw.ok) || 0,
    total: Number(kw.total) || 0,
    failed: (Array.isArray(kw.failed) ? kw.failed : []).map((f) => ({
      keyword: f.keyword, slug: f.slug, problems: Array.isArray(f.problems) ? f.problems.slice() : [],
    })),
  };
  return report;
}

/**
 * 死链（check-dead-links.js 打的那一行 `dead-links` 事件）。
 * 🔴 一个 html 都没看到（pages 0，脚本 rc=2）是「什么都没查」，不是「0 条死链」⟹ 留 null。
 */
function recordDeadLinks(report, ev) {
  if (!report || !ev || typeof ev !== 'object') return report;
  const pages = Number(ev.pages) || 0;
  if (pages === 0) { report.deadLinks = null; return report; }
  const dead = Array.isArray(ev.dead) ? ev.dead : [];
  report.deadLinks = {
    pages,
    checked: Number(ev.checked) || 0,
    count: Number.isFinite(Number(ev.deadCount)) ? Number(ev.deadCount) : dead.length,
    dead: dead.slice(0, DEAD_LIST_MAX).map((d) => ({ file: d.file, href: d.href })),
  };
  return report;
}

/** 补齐九个键（读回来的旧文件 / 手改过的文件也照样九个键都在）。 */
function normalize(report) {
  const r = report && typeof report === 'object' ? report : createReport();
  for (const k of REPORT_KEYS) if (r[k] === undefined) r[k] = null;
  return r;
}

function reportPath(siteDir) {
  return path.join(siteDir, REPORT_FILE);
}

function writeReport(siteDir, report) {
  const r = normalize(report);
  r.generatedAt = new Date().toISOString();
  fs.writeFileSync(reportPath(siteDir), JSON.stringify(r, null, 2) + '\n');
  return r;
}

/** 读不到 / 不是 JSON ⟹ null（调用方自己决定怎么办）。 */
function readReport(siteDir) {
  try {
    return normalize(JSON.parse(fs.readFileSync(reportPath(siteDir), 'utf-8')));
  } catch (e) {
    return null;
  }
}

module.exports = {
  REPORT_VERSION, REPORT_KEYS, SEO_RULES, REPORT_FILE, DEAD_LIST_MAX,
  createReport, ruleOf, pageChecks, recordSeo, recordKeywordPages, recordDeadLinks, normalize, reportPath, writeReport, readReport,
};
