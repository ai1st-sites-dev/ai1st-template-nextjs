'use strict';
// #1830 (SiteAsData T3b) —— AI 改站走库（设计文档 §9.1）。`site.js edit` / `site.js validate` 的实现（`site.js` 只是分发壳）：
//
//   edit({ sitePath, message, scope, outDir, stdinText })
//       manager 的执行器 `kind=ai-edit` 时 spawn：`site.js edit --site <内容文件> --message <话> [--scope <JSON>] --out-dir <目录>`，
//       标准输入是这一轮的其余载荷（conversationHistory / images / model / maxTokens / uploadsDomain / siteId）。
//       ① 把库里那份内容铺进 `<outDir>/site/`（`site-editor.js` §materialize 同一个写法），② 起 `edit-site.js`（tool_use 循环一行没动，
//       只是站目录换成这一份），它的 JSON-lines 原样转出 —— manager 读一行 Publish 一条（SSE 那一半不动），③ 它说「改完了」
//       （`edit-complete`）而且这一轮写成过文件 ⟹ 把目录读回、过 §validate，过了写 `<outDir>/result.json` = `{content, summary}`，
//       先发一行 `{"event":"edited","result":"<outDir>/result.json","files":[…],"summary":"…"}`、再把那条 edit-complete 转出去；
//       过不了 ⟹ 那条 edit-complete 换成一条 `error`（老板读到的那句话），不出 result。
//       `summary` = AI 自己的改动说明（edit-complete 的 message，截 500 字）。
//   validate({ prev, next, scope })   ← 上面第 ③ 步；`site.js validate --prev <文件> --next <文件> [--scope <JSON>]` 也是它
//       这一轮的产出（next）对着这一轮之前那份（prev）逐项过：
//         · 只许 AI 那条路改的文件（白名单 `editable-files.js` §writeRejection、范围 `block-scope.js`、navigation.json 的
//           `shapeProblems`、页面 / 站级块的块校验 `validateSite`）—— 跟循环里每次 write_file 过的是同一组函数，这里对整轮的结果
//           再问一遍（循环里那几道问的是「这一笔」，这里问的是「这一轮最后落成什么样」）；
//         · 整站派生一遍（`derive-core.js` §deriveSite，不编 site.css）—— 站容器时代 sync-config 那道闸；
//         · 通过 ⟹ `brand.json` 里 AI 写进去的坐标剥掉（坐标住 `sites.geo`、在版本之外，设计文档 §4.1）、并进 `contentPatchesOf`
//           （菜单同步 + custom.css）、过 `stampSchemaVersions(prev, next)`（#1838：不迁，只盖号，`prev` 用原样的 prev）。
//       返回 `{ content, files, geo? }`（`files` = 这一笔改了 content 的哪几个键；`geo` = 剥下来的 `{lat, lng, address}`）。
//       不通过 ⟹ throw `SiteEditorError('refused', <给老板的那句话>)`。
//
// 🔴 落库不在这里：manager 拿 result.json 调 `commitSiteContent(… reason=ai-edit, author=ai, baseVersion=这一轮开始时读到的版本)`，
//    基准过期就按文件三方合并、真撞同一份文件才冲突（manager/site_content.go）。
const fs = require('fs');
const path = require('path');
const cp = require('child_process');

const SCRIPTS = path.resolve(__dirname, '..');

const isObj = (v) => !!v && typeof v === 'object' && !Array.isArray(v);
const contentText = (v) => (typeof v === 'string' ? v : `${JSON.stringify(v, null, 2)}\n`);

/** 两份 content 之间值不同的键（含新增 / 删掉的），排好序。 */
function changedKeys(prev, next) {
  return Object.keys({ ...prev, ...next }).filter((k) => JSON.stringify(prev[k]) !== JSON.stringify(next[k])).sort();
}

const PAGE_JSON = /(?:^|\/)pages\/(?:[^/]+\/)*[^/]+\.json$/i;
const SITE_BLOCKS_JSON = /(?:^|\/)blocks\/site-blocks\.json$/i;
const NAVIGATION_JSON = /(?:^|\/)navigation\.json$/i;

// 给老板的那句话（聊天里显示）。跟站容器时代「同步失败」那一句同一个意思：这一笔没存、网站没变。
const NOT_SAVED = 'This change was not saved: what the AI wrote would stop your website from building, so nothing was changed. '
  + 'Please try again, or ask for the change in a different way.';

/**
 * 见文件头。`prev` / `next` 是「库里一行 JSON」的形状；`scope` 是 manager 递过来的那一份（`{page, locale, blockId, blockIndex, region}`
 * 或 null）。
 */
async function validate({ prev, next, scope = null }) {
  const { SiteEditorError, materialize } = require('./site-editor');
  if (!isObj(prev) || !isObj(next)) throw new SiteEditorError('bad', 'prev / next 必须都是对象（库里一行 JSON 的形状）');
  const files = changedKeys(prev, next);
  const problems = [];
  // 删掉的键只许是页面（菜单随之由 contentPatchesOf 同步掉它）；别的文件这条路上不许少。今天 AI 的工具里没有「删」，
  // 这一条是给读回来的整份内容兜底，不是给 AI 开的口子。
  const removed = files.filter((k) => !Object.prototype.hasOwnProperty.call(next, k));
  for (const k of removed) if (!PAGE_JSON.test(k)) problems.push(`${k}: the AI cannot delete this file.`);

  const { writeRejection } = require('./editable-files');
  const blockScope = require('./block-scope');
  const siteShape = require('./site-shape');
  const siteRegions = require('./site-regions');
  const { shapeProblems } = require('./navigation-owned');
  const { validateSite } = require('./block-manifest');
  const { readPageBlocks, normalizeLocalePages } = require('../blocks');

  // 白名单那几问按「这一轮之前」那份站来答（读当前文件、站的形状、画出哪些区）—— 跟循环里第一笔 write_file 看到的是同一份。
  const { dir, siteDir } = materialize(prev);
  try {
    const shape = siteShape.readSiteShape(siteDir);
    const sc = isObj(scope) ? blockScope.scopeFromInput(scope, shape) : null;
    const readCurrent = (p) => (Object.prototype.hasOwnProperty.call(prev, p) ? contentText(prev[p]) : null);
    const formsAt = (locale) => {
      const v = next[locale === '(site)' ? 'forms.json' : `${locale}/forms.json`];
      if (v === undefined) return [];
      return Array.isArray(v) ? v : undefined;
    };
    for (const rel of files) {
      if (removed.includes(rel)) continue;
      const text = contentText(next[rel]);
      const ctx = {
        content: text,
        scope: sc,
        readCurrent,
        readSiteShape: () => shape,
        readRenderedRegions: () => {
          try {
            const r = siteRegions.resolveSiteRegions(siteDir);
            return { header: [r.regions.header.shape], footer: r.footerVariants };
          } catch (e) {
            return null;
          }
        },
      };
      const notWritable = writeRejection(rel, ctx);
      if (notWritable) { problems.push(`${rel}: ${notWritable}`); continue; }
      let parsed = next[rel];
      if (typeof parsed === 'string' && rel.endsWith('.json')) {
        try { parsed = JSON.parse(parsed); } catch (e) { problems.push(`${rel}: not valid JSON (${e.message})`); continue; }
      }
      const outOfScope = blockScope.blockScopeRejection(rel, parsed, sc, readCurrent);
      if (outOfScope) { problems.push(`${rel}: ${outOfScope}`); continue; }
      if (NAVIGATION_JSON.test(rel)) {
        for (const p of shapeProblems(parsed)) problems.push(`${rel}: ${p}`);
      }
      if (PAGE_JSON.test(rel)) {
        const locale = rel.includes('/pages/') ? rel.split('/pages/')[0] : '(site)';
        const where = `Locale "${locale}" page "${(parsed && parsed.slug) || path.basename(rel, '.json')}"`;
        try {
          normalizeLocalePages([JSON.parse(JSON.stringify(parsed))], {}, locale, {});
          const own = readPageBlocks(parsed, where).blocks.filter((b) => !b || typeof b.ref !== 'string');
          const r = validateSite({ pages: [{ slug: parsed.slug || path.basename(rel, '.json'), blocks: own }], scope: 'edit', forms: formsAt(locale) });
          for (const p of r.problems) problems.push(`${rel}: ${p}`);
        } catch (e) {
          problems.push(`${rel}: ${e.message}`);
        }
      }
      if (SITE_BLOCKS_JSON.test(rel)) {
        const locale = rel.includes('/blocks/') ? rel.split('/blocks/')[0] : '(site)';
        try {
          if (!isObj(parsed)) throw new Error('blocks/site-blocks.json must be a JSON object');
          normalizeLocalePages([], JSON.parse(JSON.stringify(parsed)), locale, {});
          const r = validateSite({ pages: Object.entries(parsed).map(([id, b]) => ({ slug: `站级块 "${id}"`, blocks: [b] })), scope: 'edit', forms: formsAt(locale) });
          for (const p of r.problems) problems.push(`${rel}: ${p}`);
        } catch (e) {
          problems.push(`${rel}: ${e.message}`);
        }
      }
    }
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
  if (problems.length) throw new SiteEditorError('refused', `${NOT_SAVED}\n\n${problems.map((p) => `  - ${p}`).join('\n')}`);

  // 坐标剥掉：只在 AI 这一轮碰过 brand.json 时（没碰的话这一份跟 prev 一样，剥了反而算成「这一笔改了 brand.json」）。
  let content = { ...next };
  // #1833 —— 这一轮改过的页面 / 站级块文件里，每一块 custom-html 落库前整理一次（`lib/custom-html.js`，跟 site.js save 同一份）。
  //    只动改过的那几个键：没碰的文件逐字节原样（整理是幂等的，但「这一笔改了哪些文件」不能因为它多出来）。
  {
    const ch = require('./custom-html');
    try {
      content = ch.tidyCustomHtmlInContent(content, files.filter((k) => Object.prototype.hasOwnProperty.call(content, k)));
    } catch (e) {
      if (e instanceof ch.CustomHtmlError) throw new SiteEditorError('refused', `${NOT_SAVED}\n\n${e.message}`);
      throw e;
    }
  }
  let geo;
  if (files.includes('brand.json')) {
    const brand = typeof content['brand.json'] === 'string' ? JSON.parse(content['brand.json']) : content['brand.json'];
    const loc = isObj(brand) && Array.isArray(brand.locations) && isObj(brand.locations[0]) ? brand.locations[0] : null;
    if (loc && Object.prototype.hasOwnProperty.call(loc, 'geo')) {
      const { geo: g, ...rest } = loc;
      if (isObj(g) && Number.isFinite(g.lat) && Number.isFinite(g.lng)) {
        geo = { lat: g.lat, lng: g.lng, address: typeof loc.address === 'string' ? loc.address.trim() : '' };
      }
      content['brand.json'] = { ...brand, locations: [rest, ...brand.locations.slice(1)] };
    }
  }

  // 整站派生一遍（站容器时代的 sync-config 那道闸）：构建不出来的内容 throw DeriveError，原话给老板。
  const { deriveSite, contentPatchesOf } = require('./derive-core');
  const { stampSchemaVersions } = require('./stamp-schema-versions');
  const out = fs.mkdtempSync(path.join(require('os').tmpdir(), 'site-validate-'));
  const log = console.log;
  try {
    console.log = (...a) => console.error(...a);
    await deriveSite({ content, outDir: out, purge: false, skipSiteCss: true, siteLabel: 'site' });
    // #1838 —— AI 交回的是整份结果（「套」已经发生）⟹ 这里不迁、只盖号（PM 2026-10-19 裁）：再迁会把 AI 新加、还没盖号的块
    //    当 v1 再迁一遍。`touchedFiles` 不传；AI 留着的老块继承旧号，留到下一次在编辑器里保存时迁（读的时候内存里照样迁）。
    for (const [rel, value] of Object.entries(contentPatchesOf(content))) {
      if (value === null) delete content[rel];
      else content[rel] = value;
    }
  } catch (e) {
    throw new SiteEditorError('refused', `${NOT_SAVED}\n\n${e && e.message ? e.message : e}`);
  } finally {
    console.log = log;
    fs.rmSync(out, { recursive: true, force: true });
  }
  content = stampSchemaVersions(prev, content);
  content = Object.fromEntries(Object.keys(content).sort().map((k) => [k, content[k]]));
  return { content, files: changedKeys(prev, content), ...(geo ? { geo } : {}) };
}

function emit(event, data = {}) {
  process.stdout.write(`${JSON.stringify({ event, ...data })}\n`);
}

/** 跑完返回退出码。见文件头。 */
async function edit({ sitePath, message, scope = null, outDir, stdinText }) {
  const { readTree } = require('./site-editor');
  let payload;
  let prev;
  try {
    payload = stdinText && stdinText.trim() ? JSON.parse(stdinText) : {};
    if (!isObj(payload)) throw new Error('stdin must be a JSON object');
    prev = JSON.parse(fs.readFileSync(sitePath, 'utf-8'));
    if (!isObj(prev) || Object.keys(prev).length === 0) throw new Error('this website has no content');
  } catch (e) {
    emit('error', { message: `Failed to read input: ${e.message}` });
    return 1;
  }
  // #1839 —— 「让 AI 改这一块」指到的是一块待升级的旧块（样子会变的新版本还没点 Update）⟹ 不替他升、也不改，说一句就收（设计文档 §8.2 ②）。
  //    `needs-upgrade` 由聊天那一侧接（dashboard useEditorChat 的那句提示）；edit-complete 那句进聊天记录，不带版本 = 什么都没改。
  const pendingBlock = require('./block-changes').upgradeAt(prev, scope);
  if (pendingBlock) {
    emit('needs-upgrade', { blockId: pendingBlock.blockId, type: pendingBlock.type, label: pendingBlock.label });
    emit('edit-complete', { message: `I didn't change it: the ${pendingBlock.label} block has a newer version. Click Update on that block in the editor, then ask me again.`, filesModified: false, cost: 0 });
    return 0;
  }
  const siteDir = path.join(outDir, 'site');
  fs.mkdirSync(siteDir, { recursive: true });
  for (const [rel, value] of Object.entries(prev)) {
    const f = path.join(siteDir, rel);
    if (path.isAbsolute(rel) || path.relative(siteDir, f).startsWith('..')) {
      emit('error', { message: `Failed to read input: a path in the content leaves the site directory: ${rel}` });
      return 1;
    }
    fs.mkdirSync(path.dirname(f), { recursive: true });
    fs.writeFileSync(f, contentText(value));
  }

  const input = { ...payload, message, siteDir };
  for (const k of ['page', 'locale', 'blockId', 'blockIndex', 'region']) {
    delete input[k];
    if (isObj(scope) && scope[k] !== undefined && scope[k] !== null && scope[k] !== '') input[k] = scope[k];
  }
  // `process.execArgv` 照传：测试用 `node --require <假 SDK>` 起 site.js，钩子要跟到真跑循环的那个进程里（manager 起的 node 不带）。
  const child = cp.spawn(process.execPath, [...process.execArgv, path.join(SCRIPTS, 'edit-site.js')], {
    cwd: path.resolve(SCRIPTS, '..'), env: process.env, stdio: ['pipe', 'pipe', 'inherit'],
  });
  child.stdin.end(JSON.stringify(input));
  let held = null; // edit-complete：校验过了才转出去
  const pass = (line) => {
    let evt = null;
    try { evt = JSON.parse(line); } catch (e) { evt = null; }
    if (evt && evt.event === 'edit-complete') { held = evt; return; }
    process.stdout.write(`${line}\n`);
  };
  let rest = '';
  child.stdout.on('data', (chunk) => {
    rest += chunk;
    const lines = rest.split('\n');
    rest = lines.pop();
    for (const line of lines) if (line.trim()) pass(line);
  });
  const code = await new Promise((resolve) => child.on('close', (c, sig) => resolve(c === null ? (sig ? 1 : 0) : c)));
  if (rest.trim()) pass(rest);
  if (code !== 0 || !held) return code;

  if (held.filesModified) {
    let result;
    try {
      const next = readTree(siteDir);
      result = await validate({ prev, next, scope });
    } catch (e) {
      const { SiteEditorError } = require('./site-editor');
      if (!(e instanceof SiteEditorError)) process.stderr.write(`${e && e.stack ? e.stack : e}\n`);
      emit('error', { message: e instanceof SiteEditorError ? e.message : `${NOT_SAVED}\n\n${e && e.message ? e.message : e}` });
      return 0;
    }
    if (result.files.length) {
      const summary = String(held.message || '').trim().slice(0, 500);
      const file = path.join(outDir, 'result.json');
      fs.writeFileSync(file, JSON.stringify({ content: result.content, summary, ...(result.geo ? { geo: result.geo } : {}) }));
      emit('edited', { result: file, files: result.files, summary });
    }
  }
  process.stdout.write(`${JSON.stringify(held)}\n`);
  return 0;
}

module.exports = { edit, validate, changedKeys, NOT_SAVED };
