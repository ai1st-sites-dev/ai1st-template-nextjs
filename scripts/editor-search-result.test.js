#!/usr/bin/env node
/**
 * editor-search-result.test.js — #1945：编辑器 Website settings 的 Search result 组（这一页在 Google / 浏览器标签上的标题 + 描述，
 *   Automatic / Custom）。存盘落点三条：首页三样走 root 分派表进这种语言的 `seo.json`；子页三样不进分派表，由
 *   `editor-convert.js` §puckToPage 写进那一页自己的 JSON；字数只提示不拦存（`lib/search-result.js`）。
 *
 *   node scripts/editor-search-result.test.js     （由 `npm run test:scripts` 自动发现）
 *   退出码: 0 全过 · 1 有失败 · 2 跑不起来（**不许当成通过**）
 *
 * 夹具：仓里那条 skipAI 建站路造一个两语真站（en 默认 + fr），同 editor-root.test.js。每一格换回刚建好时那一份再动。
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

let editorRoot; let fieldsMod; let convert; let siteShape; let hints; let seoProblems; let editorPage; let editorSchemaLib;
try {
  editorRoot = require('./lib/editor-root.js');
  fieldsMod = require('./lib/editor-root-fields.js');
  convert = require('./lib/editor-convert.js');
  siteShape = require('./lib/site-shape.js');
  hints = require('./lib/search-result.js');
  seoProblems = require('./lib/seo-problems.js');
} catch (e) {
  die(`加载不起来：${e.message}`);
}

// ══ ⓪ 字数提示（纯函数，不要夹具）═════════════════════════════════════════════════════════════
console.log('⓪ 字数提示：只提示、跟建站检查同一把尺');
{
  check(seoProblems.pageTitleBudget === hints.pageTitleBudget && seoProblems.TITLE_MAX === hints.TITLE_MAX,
    'seo-problems.js 的 pageTitleBudget / TITLE_MAX 就是 search-result.js 那一份（判据只有一份）');
  const brand = 'Ten Chars!'; // 10 个字 ⟹ 子页预算 60 − 3 − 10 = 47（seo-problems.test.js 钉的那组数）
  const t47 = hints.titleHint({ title: 'x'.repeat(47), brandName: brand, home: false });
  const t48 = hints.titleHint({ title: 'x'.repeat(48), brandName: brand, home: false });
  check(t47.max === 47 && !t47.over && t48.over, '验收 5：网站名 10 个字，子页标题 47 字不提示、48 字提示', JSON.stringify([t47, t48]));
  check(t47.shown === `${'x'.repeat(47)} | ${brand}`, '子页预览是「<标题> | <网站名>」', t47.shown);
  const h60 = hints.titleHint({ title: 'x'.repeat(60), brandName: brand, home: true });
  const h61 = hints.titleHint({ title: 'x'.repeat(61), brandName: brand, home: true });
  check(h60.max === 60 && !h60.over && h61.over, '首页上限取 seo-limits.json 的 titleMax（60）、不扣网站名', JSON.stringify([h60, h61]));
  const longBrand = hints.titleHint({ title: 'x'.repeat(90), brandName: 'y'.repeat(40), home: false });
  check(longBrand.max === null && !longBrand.over, '子页预算 < 20（网站名太长）⟹ 不判长度，同 seo-problems.js');
  const d = (n, locale) => hints.descriptionHint({ description: 'x'.repeat(n), locale });
  check(d(100, 'en').target.min === 70 && d(100, 'en').target.max === 155 && d(50, 'zh').target.max === 80, '描述提示的目标区间 = descriptionRange（en 70–155 / zh 50–80）');
  check(!d(45, 'en').outside && d(39, 'en').outside && !d(300, 'en').outside && d(301, 'en').outside && !d(0, 'en').outside,
    '只在 descriptionAccept（en 40–300）外面才标红；空的不标红');
}

// ── 夹具 ─────────────────────────────────────────────────────────────────────────────────────
function makeTemplate() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'editor-seo-'));
  temps.push(root);
  const work = path.join(root, 'nextjs');
  cp.execSync(`cp -a --no-dereference "${NEXT}" "${work}"`, { stdio: 'pipe' });
  for (const junk of ['out', '.next', '.out-backup', '.out-temp', 'site', 'node_modules']) {
    fs.rmSync(path.join(work, junk), { recursive: true, force: true });
  }
  fs.symlinkSync(path.join(NEXT, 'node_modules'), path.join(work, 'node_modules'));
  const r = cp.spawnSync(process.execPath, [path.join(work, 'scripts', 'create-site.js')], {
    input: JSON.stringify({ siteId: 'seotest1', siteUrl: 'https://seotest1.example.com', companyName: 'Northside Auto Care', industry: 'auto repair', location: 'Toronto', skipAI: true, language: 'en', secondaryLocales: ['fr'] }),
    cwd: work, encoding: 'utf8', env: { ...process.env, ANTHROPIC_API_KEY: undefined }, timeout: 180000,
  });
  if (!fs.existsSync(path.join(work, 'site', 'fr', 'seo.json'))) die(`夹具立不起来（rc=${r.status}）\n${(r.stderr || '').slice(-600)}`);
  return work;
}
const TEMPLATE = makeTemplate();
const SITE = path.join(TEMPLATE, 'site');
const PRISTINE = path.join(path.dirname(TEMPLATE), 'pristine-site');
cp.execSync(`cp -a "${SITE}" "${PRISTINE}"`);
editorPage = require(path.join(TEMPLATE, 'scripts', 'lib', 'editor-page.js'));
editorSchemaLib = require(path.join(TEMPLATE, 'scripts', 'lib', 'editor-schema.js'));
const SCHEMA = editorSchemaLib.editorSchema({
  rootDir: TEMPLATE, registryPath: path.join(TEMPLATE, 'src', 'lib', 'sections', 'registry.generated.ts'),
  blocksDir: path.join(TEMPLATE, 'blocks'), layoutsDir: path.join(TEMPLATE, 'page-layouts'),
});

function freshSite() {
  fs.rmSync(SITE, { recursive: true, force: true });
  cp.execSync(`cp -a "${PRISTINE}" "${SITE}"`);
}
const readJson = (rel) => JSON.parse(fs.readFileSync(path.join(SITE, rel), 'utf-8'));
const LAYOUTS_DIR = path.join(TEMPLATE, 'page-layouts');
function tryWriteRoot(root, locale) {
  const shape = siteShape.readSiteShape(SITE);
  try {
    const writes = editorRoot.planRootWrite({ siteDir: SITE, localeDir: path.join(SITE, locale), locale, shape, root, layoutsDir: LAYOUTS_DIR });
    for (const w of writes) fs.writeFileSync(w.file, w.content);
    return { files: writes.map((w) => path.relative(SITE, w.file)) };
  } catch (e) {
    return { code: e.code, message: e.message };
  }
}
const readRoot = (locale) => editorRoot.readRootValues({ siteDir: SITE, localeDir: path.join(SITE, locale), locale, layoutsDir: LAYOUTS_DIR });

/** 跑 write-editor-save.js（在站根），同 editor-root.test.js §runScript。 */
function runScript(loc, input) {
  const r = cp.spawnSync(process.execPath, [path.join(TEMPLATE, 'scripts', 'write-editor-save.js'), JSON.stringify(loc)], {
    cwd: TEMPLATE, input: JSON.stringify(input), encoding: 'utf8', timeout: 60000,
  });
  let last = null;
  try { last = JSON.parse((r.stdout || '').trim().split('\n').pop()); } catch { last = null; }
  return { status: r.status, stdout: r.stdout, stderr: r.stderr, last };
}

/** 像编辑器那样打开一页：底稿 → Puck Data（子页的 root props 里放那三格，同 editor-props.ts / EditorApp 的接法）。 */
function openPage(slug, locale) {
  const b = editorPage.editorBaseline({ rootDir: TEMPLATE, page: slug, locale });
  if (!b || !b.ok) die(`打不开 ${slug}：${JSON.stringify(b)}`);
  const initial = convert.pageToPuck({ raw: b.raw, blocks: b.blocks, located: b.located, schema: SCHEMA, weights: b.weights, siteBlocks: b.siteBlocks });
  initial.root = { props: { ...convert.rootToPuck(b.root || readRoot(locale)), ...(slug === 'home' ? {} : convert.pageSeoToPuck(b.raw)) } };
  return { b, initial };
}
/** 改右栏那几格之后要交出去的两样：页面 JSON（§puckToPage）+ root 字段（§puckRootChanges）。 */
function edit(page, slug, change) {
  const data = { content: page.initial.content, root: { props: { ...page.initial.root.props, ...change } } };
  return {
    json: convert.puckToPage({ raw: page.b.raw, data, initial: page.initial, schema: SCHEMA, slug }),
    root: convert.puckRootChanges({ initial: page.initial, now: data, schema: SCHEMA }),
  };
}

const SUB = fs.readdirSync(path.join(PRISTINE, 'en', 'pages')).map((f) => f.replace(/\.json$/, '')).find((s) => s !== 'home');
if (!SUB) die('夹具里没有子页');
const subRel = path.join('en', 'pages', `${SUB}.json`);

// ══ ① 分派表：首页三样各写一次读得回来；删掉任一行 ⟹ 存不下去并点名它；分派表里没有 scope: 'page' ═════════════
console.log('① 分派表（首页三样 → en/seo.json）');
{
  const values = { siteTitle: 'Brake Repair in Toronto | Northside', siteDescription: 'Same-day brake and tire service in Toronto. Free estimates, honest prices, five-star reviews.', seoMode: 'custom' };
  const problems = [];
  for (const [field, want] of Object.entries(values)) {
    freshSite();
    const before = readRoot('en');
    const r = tryWriteRoot({ [field]: want }, 'en');
    if (r.code) { problems.push(`${field}（写不进去：${r.message}）`); continue; }
    if (JSON.stringify(r.files) !== JSON.stringify([path.join('en', 'seo.json')])) problems.push(`${field}（写的是 ${JSON.stringify(r.files)}）`);
    const after = readRoot('en');
    if (after[field] !== want) problems.push(`${field}（读回 ${JSON.stringify(after[field])}）`);
    for (const g of Object.keys(before)) if (g !== field && JSON.stringify(after[g]) !== JSON.stringify(before[g])) problems.push(`${field}（顺带改了 ${g}）`);
    if (readJson(path.join('fr', 'seo.json')).seoMode !== undefined || JSON.stringify(readJson(path.join('fr', 'seo.json'))) !== JSON.stringify(JSON.parse(fs.readFileSync(path.join(PRISTINE, 'fr', 'seo.json'), 'utf-8')))) {
      problems.push(`${field}（fr/seo.json 被动了）`);
    }
  }
  check(problems.length === 0, 'siteTitle / siteDescription / seoMode 各写一次：只写 en/seo.json、读得回来、不碰别的字段和别的语言', problems.join(' · '));

  const table = fieldsMod.ROOT_FIELDS;
  for (const field of Object.keys(values)) {
    const at = table.findIndex((f) => f.field === field);
    const [removed] = table.splice(at, 1);
    freshSite();
    const r = tryWriteRoot({ [field]: values[field] }, 'en');
    table.splice(at, 0, removed);
    check(r.code === 5 && r.message.includes(JSON.stringify(field)), `反向：分派表少了 ${field} ⟹ 存不下去、报错点它的名`, JSON.stringify(r));
  }
  const src = fs.readFileSync(path.join(NEXT, 'scripts', 'lib', 'editor-root-fields.js'), 'utf-8');
  check((src.match(/scope: 'page'/g) || []).length === 0, "editor-root-fields.js 里 `scope: 'page'` 出现 0 次（子页三样不进分派表）");
  freshSite();
  check(tryWriteRoot({ seoMode: 'manual' }, 'en').code === 5, 'seoMode 只收 "custom" / ""：别的值 ⟹ 形状错（5）');
}

// ══ ② 子页那条路：只经页面 JSON；write-editor-save 的 files 里那一页只出现一次；baseHash 照旧管用 ═══════════════
console.log(`② 子页（${SUB}）：页面 JSON 是唯一的写者`);
{
  freshSite();
  const page = openPage(SUB, 'en');
  const { json, root } = edit(page, SUB, { pageSeoMode: 'custom', pageTitle: 'Brake Service Toronto' });
  check(Object.keys(root).length === 0, '子页三格改了，puckRootChanges 交出去的 root 是空的（不会被 checkShape 当成不认识的字段整笔退掉）', JSON.stringify(root));
  check(json.title === 'Brake Service Toronto' && json.seoMode === 'custom', 'puckToPage 把它们写进页面 JSON 顶层', JSON.stringify({ title: json.title, seoMode: json.seoMode }));
  const out = runScript({ page: SUB, locale: 'en', baseHash: page.b.hash }, { page: json });
  const files = (out.last && out.last.files) || [];
  const mine = files.filter((f) => f === `site/${subRel.split(path.sep).join('/')}`);
  check(out.status === 0 && mine.length === 1 && files.length === 1, `验收 2：write-editor-save 的 files 里 ${SUB}.json 恰好一次、没有别的文件`, `rc=${out.status} ${JSON.stringify(out.last)} ${out.stderr.slice(-300)}`);
  const disk = readJson(subRel);
  check(disk.title === 'Brake Service Toronto' && disk.seoMode === 'custom', '盘上那一页读回新标题和 seoMode: custom');

  // 手改盘上那份文件，再拿旧 baseHash 存 ⟹ fail(10)
  freshSite();
  const p2 = openPage(SUB, 'en');
  const raw = readJson(subRel);
  fs.writeFileSync(path.join(SITE, subRel), `${JSON.stringify({ ...raw, navLabel: 'Changed elsewhere' }, null, 2)}\n`);
  const stale = runScript({ page: SUB, locale: 'en', baseHash: p2.b.hash }, { page: edit(p2, SUB, { pageSeoMode: 'custom', pageTitle: 'Another title' }).json });
  check(stale.status === 10 && readJson(subRel).title === raw.title, '验收 2：盘上那一页被别处改过 ⟹ baseHash 对不上、退出码 10、一个字节不写', `rc=${stale.status}`);

  // 首页那一笔不带子页三格：首页的 Puck root props 里没有它们，puckToPage 不碰首页 JSON 的 title / description
  freshSite();
  const home = openPage('home', 'en');
  check(!('pageTitle' in home.initial.root.props) && 'siteTitle' in home.initial.root.props, '首页的 root props 里是 siteTitle 那一组，不是 pageTitle 那一组');
  const hj = edit(home, 'home', { seoMode: 'custom', siteTitle: 'New Home Title' });
  check(JSON.stringify(hj.json) === JSON.stringify(home.b.raw) && hj.root.siteTitle === 'New Home Title' && hj.root.seoMode === 'custom',
    '首页改那三格：页面 JSON 一个字不变，改动作为 root 字段交出去', JSON.stringify(hj.root));
}

// ══ ③ 清空：标题不写（原值不动）、描述删键 —— 首页和子页同样 ════════════════════════════════════════
console.log('③ 清空');
{
  freshSite();
  const seoBefore = fs.readFileSync(path.join(SITE, 'en', 'seo.json'), 'utf-8');
  const r = tryWriteRoot({ siteTitle: '   ' }, 'en');
  check(!r.code && r.files.length === 0 && fs.readFileSync(path.join(SITE, 'en', 'seo.json'), 'utf-8') === seoBefore,
    '验收 3：首页标题清空 ⟹ 不报错、一份都不写，seo.json 逐字节不变（siteTitle 原值还在）', JSON.stringify(r));
  const r2 = tryWriteRoot({ siteDescription: '' }, 'en');
  const seo = readJson(path.join('en', 'seo.json'));
  check(!r2.code && !('siteDescription' in seo) && seo.siteTitle === JSON.parse(seoBefore).siteTitle, '验收 3：首页描述清空 ⟹ seo.json 里那个键没了（不是空串）');

  freshSite();
  const page = openPage(SUB, 'en');
  const before = page.b.raw;
  check(typeof before.title === 'string' && before.title && typeof before.description === 'string' && before.description,
    `前提：${SUB} 本来就有标题和描述（否则下一格量不到「清空」）`, JSON.stringify({ title: before.title, description: before.description }));
  const { json } = edit(page, SUB, { pageSeoMode: 'custom', pageTitle: '', pageDescription: '' });
  check(json.title === before.title && !('description' in json), '验收 3：子页标题清空 ⟹ 标题原值不动；描述清空 ⟹ 键没了',
    JSON.stringify({ was: before.title, title: json.title, description: json.description }));
}

// ══ ③b 同一次会话：先存自己写的标题、再清空 ⟹ 盘上还是自己写的那句（#1945 QA1 r1 ①）═══════════════════════════
// 编辑器一次会话里 `raw` 不跟着存盘换（打开时那份），`saved` 跟着换（EditorApp §planSave 把它交给 puckToPage）。
// 拿 `raw` 兜底时，第二笔把标题写回打开时那句 —— 首页那条路同样的顺序一个字节都不写，两边要一样。
console.log('③b 同一次会话里先存再清空');
{
  freshSite();
  const page = openPage(SUB, 'en');
  const first = edit(page, SUB, { pageSeoMode: 'custom', pageTitle: 'Wedding Flowers Toronto' }).json;
  const w1 = runScript({ page: SUB, locale: 'en', baseHash: page.b.hash }, { page: first });
  check(w1.status === 0 && readJson(subRel).title === 'Wedding Flowers Toronto' && w1.last && w1.last.hash,
    '前提：第一笔把自己写的标题存进盘上那一页', `rc=${w1.status} ${JSON.stringify(w1.last)}`);
  const data = { content: page.initial.content, root: { props: { ...page.initial.root.props, pageSeoMode: 'custom', pageTitle: 'Wedding Flowers Toronto' } } };
  data.root.props.pageTitle = '';
  const second = convert.puckToPage({ raw: page.b.raw, data, initial: page.initial, schema: SCHEMA, slug: SUB, saved: first });
  check(second.title === 'Wedding Flowers Toronto' && convert.deepEqual(second, first),
    '同一次会话里清空标题 ⟹ 交出来的页面 JSON 跟上一次存下去的那份一样（标题是自己写的那句，不是打开时那句），这一笔不用发',
    JSON.stringify({ opened: page.b.raw.title, title: second.title }));
  const w2 = runScript({ page: SUB, locale: 'en', baseHash: w1.last.hash }, { page: second });
  check(w2.status === 0 && readJson(subRel).title === 'Wedding Flowers Toronto',
    '验收 3：就算这一笔照样发出去，盘上那一页的标题仍是自己写的那句', `rc=${w2.status} disk=${readJson(subRel).title}`);
  // 描述在同样的顺序下仍是删键（它不靠 raw / saved 兜底）
  const third = convert.puckToPage({ raw: page.b.raw, data: { ...data, root: { props: { ...data.root.props, pageDescription: '' } } }, initial: page.initial, schema: SCHEMA, slug: SUB, saved: second });
  check(!('description' in third) && third.title === 'Wedding Flowers Toronto', '同一会话里再清空描述 ⟹ 描述键没了、标题仍是自己写的那句');
}

// ══ ④ 模式：切 Custom 写 seoMode: "custom"；切回 Automatic 键没了 ═══════════════════════════════════════
console.log('④ 模式');
{
  freshSite();
  tryWriteRoot({ seoMode: 'custom' }, 'en');
  const on = readJson(path.join('en', 'seo.json')).seoMode;
  const back = tryWriteRoot({ seoMode: '' }, 'en');
  const after = readJson(path.join('en', 'seo.json'));
  check(on === 'custom' && !back.code && !('seoMode' in after) && readRoot('en').seoMode === '', '首页：custom ⟹ 写进 seo.json；Automatic（""）⟹ 键没了、读回 ""');

  freshSite();
  const p1 = openPage(SUB, 'en');
  const j1 = edit(p1, SUB, { pageSeoMode: 'custom' }).json;
  runScript({ page: SUB, locale: 'en', baseHash: p1.b.hash }, { page: j1 });
  const p2 = openPage(SUB, 'en');
  check(p2.initial.root.props.pageSeoMode === 'custom', '子页：切 Custom 存下去之后重新打开，模式读回 custom');
  const j2 = edit(p2, SUB, { pageSeoMode: '' }).json;
  check(!('seoMode' in j2), '子页：切回 Automatic ⟹ 页面 JSON 里 seoMode 键没了');
  const untouched = edit(p2, SUB, {}).json;
  check(JSON.stringify(untouched) === JSON.stringify(p2.b.raw), '三格一格都没碰 ⟹ puckToPage 交出来的页面 JSON 跟盘上那份一样（不会凭空多一笔存盘）');
}

// ══ ⑤ 存盘记录：子页改标题那一笔说「Website settings · Title」，不是一句通用话 ══════════════════════════════
console.log('⑤ 存盘记录');
{
  freshSite();
  const page = openPage(SUB, 'en');
  const { json } = edit(page, SUB, { pageSeoMode: 'custom', pageTitle: 'Brake Service Toronto', pageDescription: 'A brand new description for this page.' });
  const labels = { pageTitle: 'Website settings · Title', pageDescription: 'Website settings · Description', pageSeoMode: 'Website settings · Search result mode' };
  const said = convert.describeSave({ saved: page.b.raw, json, root: null, shared: null, schema: SCHEMA, rootLabels: labels, slug: SUB });
  check(said.includes('Website settings · Title') && said.includes('Website settings · Description') && said.includes('Website settings · Search result mode'),
    '子页三格各说一句，名字同首页那三条', said);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
