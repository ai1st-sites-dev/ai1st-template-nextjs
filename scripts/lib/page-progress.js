'use strict';
/**
 * #1724 —— 整站范围的改站，面板上那句进度说到页：`Page N of M: pages/about.json (en)`。
 *
 *   M = 这一轮开始时站上页面文件的总数（各语言的 `pages/**.json` 加起来）
 *   N = 到此为止读过或写过的**不同**页面文件数
 *
 * 只给整站范围用（`scope` 为 null）；块范围的那一轮不带这串字，调用方不建它。
 *
 * 🔴 「是不是页面文件」用的是 edit-site.js 自己那条 `PAGE_JSON`（调用方传进来），不在这里另立一条：
 *    两条判据一分叉，这里数的「页」和写入校验认的「页」就不是同一批文件。
 * 🔴 非页面文件（brand.json / seo.json …）那一条照样带 `Page N of M`，只是 N 不涨（PM 在 #1724 r4 定的）。
 * 📌 这一轮新建的页会让 N 超过开始时的 M —— 那时 M 跟着 N 走，不写出「Page 4 of 3」。
 */
const fs = require('fs');
const path = require('path');

/** 工具调用里的路径 → 相对 `site/` 的规范写法（`./en//pages/a.json`、`en\pages\a.json` 都归成 `en/pages/a.json`）。 */
function normalizeSitePath(p) {
  const s = path.posix.normalize(String(p || '').replace(/\\/g, '/'));
  return s.replace(/^(\.\/)+/, '').replace(/^\/+/, '');
}

function listJson(dir, rel, out) {
  let entries;
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch (e) { return; }
  for (const e of entries) {
    if (e.isDirectory()) listJson(path.join(dir, e.name), `${rel}${e.name}/`, out);
    else if (e.isFile() && e.name.toLowerCase().endsWith('.json')) out.push(`${rel}${e.name}`);
  }
}

/**
 * 站上的页面文件，相对 `site/`。扁平站 = `pages/`；多语言站 = 每个语言目录下的 `pages/`
 * （`site_meta.json` 里没写出语言时，凡是有 `pages/` 的子目录都算）。
 * @param {{flat: boolean, locales: string[]}|null} shape  lib/site-shape.js §readSiteShape 的结果
 */
function listPageFiles(siteDir, shape) {
  if (!shape) return [];
  let roots = [''];
  if (!shape.flat) {
    roots = shape.locales.length ? shape.locales : (() => {
      try {
        return fs.readdirSync(siteDir, { withFileTypes: true })
          .filter((e) => e.isDirectory() && fs.existsSync(path.join(siteDir, e.name, 'pages')))
          .map((e) => e.name);
      } catch (e) { return []; }
    })();
    roots = roots.map((l) => `${l}/`);
  }
  const out = [];
  for (const r of roots) listJson(path.join(siteDir, r, 'pages'), `${r}pages/`, out);
  return out;
}

/** 扁平站的语言：`seo.json` 的 `locale`；读不出来就不写。 */
function flatLocale(siteDir) {
  try {
    const seo = JSON.parse(fs.readFileSync(path.join(siteDir, 'seo.json'), 'utf8'));
    return typeof seo.locale === 'string' ? seo.locale : '';
  } catch (e) { return ''; }
}

/**
 * @param {string} siteDir
 * @param {{flat: boolean, locales: string[]}|null} shape
 * @param {(rel: string) => boolean} isPageFile  edit-site.js 的 PAGE_JSON.test
 * @returns {(toolPath: string) => string}  每次读 / 写一个文件调一次，回那一刻面板该显示的那串字
 */
function createPageProgress(siteDir, shape, isPageFile) {
  const total = listPageFiles(siteDir, shape).length;
  const lang = shape && shape.flat ? flatLocale(siteDir) : '';
  const seen = new Set();
  return (toolPath) => {
    const rel = normalizeSitePath(toolPath);
    const isPage = isPageFile(rel);
    if (isPage) seen.add(rel);
    const head = `Page ${seen.size} of ${Math.max(total, seen.size)}`;
    if (!isPage) return head;
    // 多语言站：`pages/` 前面那一段就是语言；扁平站：seo.json 的 locale。
    const at = rel.indexOf('pages/');
    const prefix = at > 0 ? rel.slice(0, at).replace(/\/$/, '') : '';
    const pageLang = shape && !shape.flat ? prefix.split('/').pop() : lang;
    return `${head}: ${rel.slice(at < 0 ? 0 : at)}${pageLang ? ` (${pageLang})` : ''}`;
  };
}

module.exports = { createPageProgress, listPageFiles, normalizeSitePath };
