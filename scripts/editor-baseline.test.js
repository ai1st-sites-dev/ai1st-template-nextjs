#!/usr/bin/env node
/**
 * editor-baseline.test.js — #1415：编辑器底稿在**运行时**现算（`lib/editor-page.js` §editorBaseline），
 * 必须跟构建时烤进编辑器页的那份逐项相同。
 *
 *   node scripts/editor-baseline.test.js     （由 `npm run test:scripts` 自动发现）
 *   退出码: 0 全过 · 1 有失败 · 2 跑不起来（**不许当成通过**）
 *
 * 判据是真构建的产物：对夹具站跑一次 `scripts/sync-config.js`，从它写出的 `config-data.ts` 里取每一页的
 * `blocks`（= 编辑器页 `getPage()` 拿到的那份），再按 `src/app/~editor/[...target]/page.tsx` 同一对调用算
 * `located` / `weights`。运行时那份必须一个字节都不差。
 *
 *   ① 穿 azure-29 的多语言站（它有 16 种块的主题形态跟 manifest 默认不同）：每一页相同，而且真有块戴着
 *     主题给的形态 —— 否则「相同」可能只是两边都没有 `shape`
 *   ② 反向对照：只归一化、不补字段 ⟹ 跟构建**不同**（这一格证明上面那个比对有分辨力，也就是 #1415 DEV
 *     开工前审查抓到的那一格）
 *   ③ 站级共用块（按 visibility 注入 + `{ref}`）、子目录页面、ember-12 的老扁平 `sections` 站
 *   ④ 探针那条路：子进程里调，stdout 只有一份 JSON —— 哪怕这一页有一个会触发「落回默认」日志的块
 *   ⑤ 拒绝：没有这一页 / 没有这种语言 / 读不到 site/ / 这一页会让构建报错
 */

'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const cp = require('child_process');
const crypto = require('crypto');

const NEXT = path.resolve(__dirname, '..');

let pass = 0; let fail = 0;
const ok = (m) => { pass += 1; console.log(`  ✅ ${m}`); };
const bad = (m) => { fail += 1; console.log(`  ❌ ${m}`); };
const check = (cond, m, detail) => (cond ? ok(m) : bad(detail ? `${m} —— ${detail}` : m));
function die(msg) { console.log(`💥 ${msg}`); process.exit(2); }

const temps = [];
process.on('exit', () => { for (const t of temps) fs.rmSync(t, { recursive: true, force: true }); });

// 夹具：仓里那条 skipAI 建站路（同 write-page.test.js 的理由），`template` 点名主题。
function makeSite(label, theme, flat) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), `editor-baseline-${label}-`));
  temps.push(root);
  const work = path.join(root, 'nextjs');
  cp.execSync(`cp -a --no-dereference "${NEXT}" "${work}"`, { stdio: 'pipe' });
  for (const junk of ['out', '.next', '.out-backup', '.out-temp', 'site', 'node_modules']) {
    fs.rmSync(path.join(work, junk), { recursive: true, force: true });
  }
  fs.symlinkSync(path.join(NEXT, 'node_modules'), path.join(work, 'node_modules'));
  const r = cp.spawnSync(process.execPath, [path.join(work, 'scripts', 'create-site.js')], {
    input: JSON.stringify({ siteId: 'ebtest01', companyName: 'Northside Auto Care', industry: 'auto repair', location: 'Toronto', skipAI: true, language: 'en', template: theme }),
    cwd: work, encoding: 'utf8', env: { ...process.env, ANTHROPIC_API_KEY: undefined }, timeout: 180000,
  });
  const site = path.join(work, 'site');
  if (!fs.existsSync(path.join(site, 'en', 'pages', 'home.json'))) die(`夹具立不起来（rc=${r.status}）\n${(r.stderr || '').slice(-600)}`);
  const themeId = JSON.parse(fs.readFileSync(path.join(site, 'theme.json'), 'utf-8')).themeId;
  if (themeId !== theme) die(`夹具的主题是 ${themeId}，不是点名的 ${theme}`);
  if (flat) {
    for (const e of fs.readdirSync(path.join(site, 'en'))) fs.renameSync(path.join(site, 'en', e), path.join(site, e));
    fs.rmSync(path.join(site, 'en'), { recursive: true });
    fs.rmSync(path.join(site, 'site_meta.json'));
  }
  return work;
}

const readJSON = (p) => JSON.parse(fs.readFileSync(p, 'utf-8'));
const writeJSON = (p, v) => fs.writeFileSync(p, `${JSON.stringify(v, null, 2)}\n`);

/** 真构建一次，回 config-data.ts 里的 pagesByLocale。 */
function build(work) {
  const r = cp.spawnSync(process.execPath, [path.join(work, 'scripts', 'sync-config.js')], { cwd: work, encoding: 'utf8', timeout: 180000 });
  if (r.status !== 0) die(`sync-config 失败（rc=${r.status}）\n${(r.stdout + r.stderr).slice(-800)}`);
  const txt = fs.readFileSync(path.join(work, 'src', 'lib', 'config-data.ts'), 'utf-8');
  const m = txt.match(/^export const pagesByLocale = (.*);$/m);
  if (!m) die('config-data.ts 里找不到 pagesByLocale');
  return JSON.parse(m[1]);
}

/** 每一页：运行时那份 vs 构建那份。回 { pages, diff, shaped, diffs[] }。 */
function compare(work, flat, baselineFn) {
  const lib = require(path.join(work, 'scripts', 'lib', 'editor-page.js'));
  const cfg = build(work);
  const out = { pages: 0, diff: 0, shaped: 0, diffs: [] };
  for (const [locale, pages] of Object.entries(cfg)) {
    for (const p of pages) {
      if (p.slug === 'blog' || p.slug.startsWith('blog/')) continue; // 编辑器不导出这两个（page.tsx RESERVED_SLUGS）
      out.pages += 1;
      const got = (baselineFn || lib.editorBaseline)({ rootDir: work, page: p.slug, locale: flat ? '' : locale });
      // page.tsx 的算法原样：
      const src = lib.editorSource(work, locale, p.slug);
      const located = p.blocks.map((b) => lib.locateInRaw(src.raw, src.siteBlocks, p.slug, b));
      const want = {
        raw: src.raw, siteBlocks: src.siteBlocks, hash: src.baseHash, blocks: p.blocks, located,
        weights: lib.effectiveWeights(src.raw, src.siteBlocks, p.blocks, located),
      };
      out.shaped += p.blocks.filter((b) => typeof b.shape === 'string' && b.shape).length;
      const bads = got && got.ok ? Object.keys(want).filter((k) => JSON.stringify(got[k]) !== JSON.stringify(want[k])) : ['ok=false'];
      if (bads.length) { out.diff += 1; out.diffs.push(`${locale}/${p.slug}: ${bads.join(',')}${got && got.message ? ` (${got.message})` : ''}`); }
    }
  }
  return out;
}

// ══ ① 多语言站 × azure-29 ═════════════════════════════════════════════════════════════════════════
console.log('① 多语言站（azure-29）');
const multi = makeSite('multi', 'azure-29', false);
{
  const c = compare(multi, false);
  check(c.pages >= 3, `比了 ${c.pages} 页（至少 3 页，否则夹具不对）`);
  check(c.diff === 0, '每一页 raw / siteBlocks / hash / blocks / located / weights 都跟构建相同', c.diffs.join(' · '));
  check(c.shaped > 0, `构建里真有块戴着形态（${c.shaped} 个）—— 「相同」不是两边都没有 shape`);
  const home = require(path.join(multi, 'scripts', 'lib', 'editor-page.js')).editorBaseline({ rootDir: multi, page: 'home', locale: '' });
  check(home.ok && home.locale === 'en', 'locale 空 ⟹ 用 site_meta 的默认语言，回报实际用的那一个', JSON.stringify(home.locale));
  const f = path.join(multi, 'site', 'en', 'pages', 'home.json');
  check(home.hash === crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex'), 'hash = 文件字节的 sha256（write-page 比的就是它）');
}

// ══ ② 反向对照：只归一化、不补字段 ════════════════════════════════════════════════════════════════
console.log('② 反向对照：不补 has / shape');
{
  const lib = require(path.join(multi, 'scripts', 'lib', 'editor-page.js'));
  const decorate = require(path.join(multi, 'scripts', 'lib', 'block-decorate.js'));
  const real = decorate.decorateBlocks;
  decorate.decorateBlocks = () => ({ carried: 0, shaped: 0 });
  // editor-page.js 在 require 时解构拿走了函数引用 ⟹ 重新加载它，让它拿到替身。
  const key = require.resolve(path.join(multi, 'scripts', 'lib', 'editor-page.js'));
  delete require.cache[key];
  const stubbed = require(key).editorBaseline;
  decorate.decorateBlocks = real;
  delete require.cache[key];
  const c = compare(multi, false, stubbed);
  check(c.diff > 0, `不补字段时 ${c.diff}/${c.pages} 页跟构建不同 ⟹ 上面那个比对量得出这一格`);
  check(c.diffs.every((d) => /: blocks$/.test(d)), '不同的只有 blocks（定位 / 权重 / 原文不受补字段影响）', c.diffs.join(' · '));
  void lib;
}

// ══ ③ 共用块 / 子目录页面 / 老扁平 sections 站 ═══════════════════════════════════════════════════
console.log('③ 共用块、子目录页面、老扁平 sections 站（ember-12）');
{
  const en = path.join(multi, 'site', 'en');
  fs.mkdirSync(path.join(en, 'blocks'), { recursive: true });
  writeJSON(path.join(en, 'blocks', 'site-blocks.json'), {
    'shared-cta': { type: 'cta-banner', visibility: ['home', 'about'], data: { headline: 'Shared CTA 1415', button: { label: 'Call', href: '/quote' } } },
    'shared-faq': { type: 'faq-accordion', data: { heading: 'FAQ 1415', items: [{ question: 'Q?', answer: 'A.' }] } },
  });
  const about = readJSON(path.join(en, 'pages', 'about.json'));
  about.blocks.push({ ref: 'shared-faq' });
  writeJSON(path.join(en, 'pages', 'about.json'), about);
  fs.mkdirSync(path.join(en, 'pages', 'services'), { recursive: true });
  const sub = readJSON(path.join(en, 'pages', 'quote.json'));
  delete sub.slug;
  writeJSON(path.join(en, 'pages', 'services', 'brakes.json'), sub);
  const c = compare(multi, false);
  check(c.diff === 0, '加了注入块 / {ref} / 子目录页面之后每一页仍然相同', c.diffs.join(' · '));
  const b = require(path.join(multi, 'scripts', 'lib', 'editor-page.js')).editorBaseline({ rootDir: multi, page: 'about', locale: 'en' });
  const reasons = b.located.map((l) => l.reason);
  check(b.ok && reasons.filter((r) => r === 'shared').length === 2, 'about 页上两个共用块都定位成 shared（注入的 + ref 的）', JSON.stringify(reasons));
  const brakes = require(path.join(multi, 'scripts', 'lib', 'editor-page.js')).editorBaseline({ rootDir: multi, page: 'services/brakes', locale: 'en' });
  check(brakes.ok && brakes.page === 'services/brakes', '子目录页面按路径 slug 取得到');

  const flat = makeSite('flat', 'ember-12', true);
  // 今天磁盘上的老站就是这种：没有 site_meta.json，页面是老 `sections` 形状（只有 type / data）。
  const pagesDir = path.join(flat, 'site', 'pages');
  for (const f of fs.readdirSync(pagesDir).filter((x) => x.endsWith('.json'))) {
    const p = readJSON(path.join(pagesDir, f));
    p.sections = p.blocks.map((x) => ({ type: x.type, data: x.data }));
    delete p.blocks;
    writeJSON(path.join(pagesDir, f), p);
  }
  const cf = compare(flat, true);
  check(cf.diff === 0, `老扁平 sections 站 ${cf.pages} 页都相同`, cf.diffs.join(' · '));
  check(cf.shaped > 0, `这个站的构建里也有块戴着形态（${cf.shaped} 个）`);
  const hf = require(path.join(flat, 'scripts', 'lib', 'editor-page.js')).editorBaseline({ rootDir: flat, page: 'home', locale: 'zh' });
  check(hf.ok && hf.locale === '', '扁平站不看 locale（带了也照样取根上那份），回报 locale 为空', JSON.stringify(hf.locale));
}

// ══ ④ 探针那条路：stdout 只有一份 JSON ═══════════════════════════════════════════════════════════
console.log('④ 探针：子进程 stdout 只有那一份 JSON');
{
  // 给 home 的第一个块点一个清单里没有的形态 ⟹ shapeForBlock 会打一行「落回默认」。构建里那一行进日志；
  // 探针里它必须被吞掉，否则 manager 读到的 stdout 不是 JSON。
  const f = path.join(multi, 'site', 'en', 'pages', 'home.json');
  const home = readJSON(f);
  home.blocks[0].shape = 'no-such-shape-1415';
  writeJSON(f, home);
  // 跟 manager 的内联脚本同形（`manager/page_baseline.go` §pageBaselineProbeScript）。
  const script = "let m; try { m = require(process.cwd() + '/scripts/lib/editor-page.js'); } catch (e) { process.exit(4); }"
    + "if (typeof m.editorBaseline !== 'function') process.exit(5);"
    + 'process.stdout.write(JSON.stringify(m.editorBaseline(JSON.parse(process.argv[1]))));';
  const r = cp.spawnSync(process.execPath, ['-e', script, JSON.stringify({ page: 'home', locale: 'en' })], { cwd: multi, encoding: 'utf8', timeout: 60000 });
  let parsed = null;
  try { parsed = JSON.parse(r.stdout); } catch { parsed = null; }
  check(r.status === 0 && parsed && parsed.ok === true, 'rc=0，stdout 整个是一份 JSON、ok=true', `rc=${r.status} stdout 开头 ${JSON.stringify((r.stdout || '').slice(0, 120))}`);
  const c = compare(multi, false);
  check(c.diff === 0, '有「落回默认」的块时仍然跟构建相同', c.diffs.join(' · '));
}

// ══ ⑤ 拒绝 ═══════════════════════════════════════════════════════════════════════════════════════
console.log('⑤ 拒绝');
{
  const { editorBaseline } = require(path.join(multi, 'scripts', 'lib', 'editor-page.js'));
  const reason = (o) => (editorBaseline({ rootDir: multi, ...o }) || {}).reason;
  check(reason({ page: 'nope' }) === 'no-page', '没有这一页 ⟹ no-page');
  check(reason({ page: 'home', locale: 'fr' }) === 'no-locale', '没有这种语言 ⟹ no-locale');
  check(reason({ page: '' }) === 'bad-request', '没说哪一页 ⟹ bad-request');
  check(editorBaseline({ rootDir: os.tmpdir(), page: 'home' }).reason === 'no-site', '读不到 site/ ⟹ no-site');
  const f = path.join(multi, 'site', 'en', 'pages', 'about.json');
  const about = readJSON(f);
  about.sections = [];
  writeJSON(f, about);
  const r = editorBaseline({ rootDir: multi, page: 'home', locale: 'en' });
  check(r.reason === 'build-error' && /about/.test(r.message), '同一种语言里另一页会让构建报错 ⟹ build-error，话里点名那一页', JSON.stringify(r));
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
