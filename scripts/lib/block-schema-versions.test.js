#!/usr/bin/env node
/**
 * block-schema-versions.test.js — #1838（SiteAsData T4b）块版本号机制的验收台。
 *
 * 跑法:  node scripts/lib/block-schema-versions.test.js   （或 `npm run test:scripts`，按文件名发现）
 * 退出码: 0 全过 · 1 有失败 · 2 跑不起来（**不许当成通过**）
 *
 * 假块进测试不进产品：真 `blocks/` 整份拷进模板根下一份临时目录（`tmp-1838-blocks-*`，块组件用 `../../scripts/…` 引脚本，
 * 所以只能在模板根下面一层）+ `scripts/fixtures/blocks/` 的 fake-a（v2，`1→2` 静默迁移）/ fake-b（v3），再
 * `build-blocks.js --blocks-dir --out` 生成一份临时注册表；`AI1ST_BLOCKS_DIR` / `AI1ST_REGISTRY_PATH`（§block-paths）
 * 让 `save` / `editor-data` / `render` 三条路整条改道过去。另造一份「顶栏 v2」：拷过去的 header manifest 改成 v2、
 * 写一份恒等的 `1→2`（外壳区那一侧的版本号住在 navigation.json 的 `header` 上）。
 *
 *   ① 静默迁 + 只落碰到的文件：两页都有 fake-a v1，保存只碰首页 ⟹ 首页 A 是 v2、validateSite 为空；faq 逐字节不变
 *   ② editor-data / render 读同一份 ⟹ 两页都按 v2 画（库里那份没变）
 *   ③ 顺序格：老板改了 A 的新字段 ⟹ 落库是老板的值（迁和套对调 ⟹ 这格红，读数贴交接）
 *   ④ preservesLook: false ⟹ 保存不迁、migrateInMemory 也不迁
 *   ⑤ 盖号：画布新插 fake-b ⟹ 落库 v3 · validate 对 AI 整份重写的页 ⟹ 老块号同上一版、新块当前号 · create 出的每块都有号
 *      （把 stampSchemaVersions 改回 `return next` ⟹ 这三格全红，读数贴交接）
 *   ⑥ 「碰到的文件」白名单：只改 root.headerShape / headerOptions ⟹ navigation.json 逐字节不变；改 headerButtons ⟹ 被迁
 *   ⑦ contentPatchesOf 回对象 + touchedFiles 只迁点名的那几份
 *   ⑧ 假块不进产品：真注册表 / 真块目录 / 真图册 / Puck「可添加」列表（categoriesOf + 真注册表）里都没有 fake-*；
 *      改道之后 categoriesOf 里有（这一格有牙）；真注册表的版本表 = blocks/ 下每个文件夹一行
 *   ⑨ 顶栏 / 页脚盖了号之后，AI 改菜单那道门不把 `schemaVersion` 当陌生键报给老板（navigation-owned.js §NAV_SHAPE）
 */
'use strict';

const assert = require('assert');
const cp = require('child_process');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', '..');
const SCRIPTS = path.join(ROOT, 'scripts');
const REAL_BLOCKS = path.join(ROOT, 'blocks');
const REAL_REGISTRY = path.join(ROOT, 'src', 'lib', 'sections', 'registry.generated.ts');
const FAKES = path.join(SCRIPTS, 'fixtures', 'blocks');
const SITE = path.join(SCRIPTS, 'fixtures', 'site-fixtures', 'site-0448c807.json');

let failed = 0;
let passed = 0;
const ok = (m) => { passed += 1; console.log(`  ✅ ${m}`); };
const bad = (m) => { failed += 1; console.log(`  ❌ ${m}`); };
const check = (cond, m, detail) => (cond ? ok(m) : bad(detail === undefined ? m : `${m}\n       ${detail}`));
const die = (m) => { console.log(`⛔ 跑不起来：${m}`); process.exit(2); };

const made = [];
const tmpUnder = (prefix) => { const d = fs.mkdtempSync(path.join(ROOT, prefix)); made.push(d); return d; };
const tmpOs = (prefix) => { const d = fs.mkdtempSync(path.join(os.tmpdir(), prefix)); made.push(d); return d; };

/** 一份带假块的块目录 + 它生成的注册表。`variant(dir)` 在生成之前改它（例：把迁移改成 preservesLook: false）。 */
function fakeBlocksDir(variant) {
  const dir = tmpUnder('tmp-1838-blocks-');
  for (const e of fs.readdirSync(REAL_BLOCKS, { withFileTypes: true })) {
    if (e.isDirectory()) fs.cpSync(path.join(REAL_BLOCKS, e.name), path.join(dir, e.name), { recursive: true });
  }
  for (const name of ['fake-a', 'fake-b']) fs.cpSync(path.join(FAKES, name), path.join(dir, name), { recursive: true });
  // 顶栏 v2：版本号住在 navigation.json 的 header 上；`1→2` 恒等（证据是号）。
  const hm = path.join(dir, 'header', 'manifest.json');
  const m = JSON.parse(fs.readFileSync(hm, 'utf-8'));
  fs.writeFileSync(hm, `${JSON.stringify({ ...m, schemaVersion: 2, renders: [1, 2] }, null, 2)}\n`);
  fs.writeFileSync(path.join(dir, 'header', 'migrations.js'),
    "'use strict';\n// #1838 测试专用：顶栏 v1 → v2，数据不变（证据是号）。\nmodule.exports = { '1→2': { preservesLook: true, migrate: (h) => h } };\n");
  if (variant) variant(dir);
  const gen = tmpOs('tmp-1838-gen-');
  const r = cp.spawnSync(process.execPath, [path.join(SCRIPTS, 'block-build', 'build-blocks.js'), '--blocks-dir', dir, '--out', gen],
    { cwd: ROOT, encoding: 'utf8' });
  if (r.status !== 0) die(`build-blocks.js --blocks-dir 跑不出来（${r.status}）：${r.stdout}${r.stderr}`);
  return { blocksDir: dir, registryPath: path.join(gen, 'registry.generated.ts') };
}

const sha = (s) => crypto.createHash('sha256').update(s).digest('hex');
const bytesOf = (v) => (typeof v === 'string' ? v : `${JSON.stringify(v, null, 2)}\n`);
const clone = (v) => JSON.parse(JSON.stringify(v));
const blockOf = (page, id) => (page.blocks || []).find((b) => b.id === id);

/** 夹具：真站 0448c807，首页和 faq 末尾各加一个 fake-a v1（`data.headline` 是 v1 的字段名）。 */
function fixture() {
  const c = JSON.parse(fs.readFileSync(SITE, 'utf-8'));
  const add = (rel, id, headline) => {
    const p = c[rel];
    p.blocks.push({ id, type: 'fake-a', role: 'optional', region: 'content', weight: 900, data: { headline } });
  };
  add('en/pages/home.json', 'fa-home', 'Old home');
  add('en/pages/faq.json', 'fa-faq', 'Old faq');
  return c;
}

/** 编辑器那一笔：首页（`blockEdit` 改首页里 fake-a 那一块；画布交回的块不带 schemaVersion —— puckToPage 不带）。 */
function homeChange(content, blockEdit, extra = {}) {
  const page = clone(content['en/pages/home.json']);
  for (const b of page.blocks) delete b.schemaVersion;
  const a = blockOf(page, 'fa-home');
  blockEdit(a, page);
  return { page: 'home', locale: 'en', json: page, ...extra };
}

async function quietly(fn) {
  const log = console.log;
  const err = console.error;
  console.log = () => {};
  console.error = () => {};
  try { return await fn(); } finally { console.log = log; console.error = err; }
}

async function main() {
  if (!fs.existsSync(path.join(FAKES, 'fake-a', 'migrations.js'))) die('scripts/fixtures/blocks/fake-a 不在');
  if (!fs.existsSync(SITE)) die(`夹具 ${SITE} 不在`);

  const fake = fakeBlocksDir();
  const lookFalse = fakeBlocksDir((dir) => {
    const f = path.join(dir, 'fake-a', 'migrations.js');
    fs.writeFileSync(f, fs.readFileSync(f, 'utf-8').replace('preservesLook: true', 'preservesLook: false'));
  });
  const useBlocks = (b) => { process.env.AI1ST_BLOCKS_DIR = b.blocksDir; process.env.AI1ST_REGISTRY_PATH = b.registryPath; };
  useBlocks(fake);

  const { save, editorData } = require('./site-editor');
  const { validate } = require('./site-edit');
  const { migrateInMemory, loadBlockVersions } = require('./block-migrations');
  const { contentPatchesOf } = require('./derive-core');
  const blockManifest = require('./block-manifest');

  if (loadBlockVersions(fake.blocksDir).get('fake-a').schemaVersion !== 2) die('假块目录里 fake-a 不是 v2 —— 夹具没拼对');

  // ── ① 静默迁 + 只落碰到的文件 ─────────────────────────────────────────────────────────────────
  console.log('① 静默迁 + 只落碰到的文件（两页都有 fake-a v1，保存只碰首页）');
  const base = fixture();
  const baseCopy = clone(base);
  let saved;
  {
    const changes = homeChange(base, (a) => { a.data = { title: 'Old home' }; }, {});
    // baseHash 用编辑器那一侧算的（editor-data 内存里迁过之后的哈希）—— 这一格同时证「先迁再比」：反过来每次 409。
    const ed = await quietly(() => editorData({ content: base, page: 'home', locale: 'en' }));
    changes.baseHash = ed.props.baseHash;
    try {
      saved = await quietly(() => save({ content: base, changes }));
      ok('拿 editor-data 给的 baseHash 存得进去（没有被当成「别处改过」）');
    } catch (e) {
      bad(`拿 editor-data 给的 baseHash 存不进去：${e.message}`);
      saved = await quietly(() => save({ content: base, changes, keep: true }));
    }
    const home = saved.content['en/pages/home.json'];
    const a = blockOf(home, 'fa-home');
    check(a && a.schemaVersion === 2 && a.data.title === 'Old home' && !('headline' in a.data),
      '首页的 fake-a 落库是 v2（data.title，没有 headline）', JSON.stringify(a));
    const { problems } = blockManifest.validateSite({ pages: [home], scope: 'edit', forms: saved.content['en/forms.json'] });
    check(problems.length === 0, `首页 validateSite（scope edit）为空（${home.blocks.length} 块）`, JSON.stringify(problems));
    check(bytesOf(saved.content['en/pages/faq.json']) === bytesOf(base['en/pages/faq.json']), '没碰的 faq 逐字节等于保存前');
    check(!saved.files.includes('en/pages/faq.json'), `files 里没有 faq（${saved.files.join(', ')}）`);
    check(JSON.stringify(base) === JSON.stringify(baseCopy), '入参 content 没被改');
  }

  // ── ② editor-data / render 读同一份 ───────────────────────────────────────────────────────────
  console.log('② editor-data / render 读同一份内容 ⟹ 两页都按 v2 画，库里那份没变');
  {
    const ed = await quietly(() => editorData({ content: saved.content, page: 'faq', locale: 'en' }));
    const props = JSON.stringify(ed.props);
    check(props.includes('"title":"Old faq"') && !props.includes('"headline":"Old faq"'), 'editor-data（faq）：fake-a 带的是 v2 的 title');
    check(bytesOf(saved.content['en/pages/faq.json']) === bytesOf(base['en/pages/faq.json']), 'editor-data 之后库里的 faq 没变');

    const { bundle, render } = require('../site.js');
    const bundleDir = tmpUnder('tmp-1838-bundle-');
    await quietly(() => bundle(bundleDir, { blocksDir: fake.blocksDir, registryPath: fake.registryPath }));
    const out = path.join(tmpOs('tmp-1838-render-'), 'out');
    const before = bytesOf(saved.content['en/pages/faq.json']);
    await quietly(() => render({ content: saved.content, out, bundleDir, target: 'preview', siteId: 'site-t1838' }));
    const html = (rel) => fs.readFileSync(path.join(out, rel), 'utf-8');
    const titleOf = (h) => (h.match(/data-block="fake-a"[\s\S]*?<h2 data-fake-title="">([^<]*)<\/h2>/) || [])[1];
    check(titleOf(html('index.html')) === 'Old home', `render：首页 fake-a 画出 v2 的 title（读到 ${JSON.stringify(titleOf(html('index.html')))}）`);
    check(titleOf(html('faq/index.html')) === 'Old faq', `render：faq（库里还是 v1）也按 v2 画（读到 ${JSON.stringify(titleOf(html('faq/index.html')))}）`);
    check(bytesOf(saved.content['en/pages/faq.json']) === before, 'render 之后库里的 faq 没变');
  }

  // ── ③ 顺序格 ─────────────────────────────────────────────────────────────────────────────────
  console.log('③ 顺序格：老板改了 A 的新字段（画布交回时旧字段原样带着）⟹ 落库是老板的值');
  {
    const changes = homeChange(base, (a) => { a.data = { headline: 'Old home', title: 'Boss new' }; });
    const r = await quietly(() => save({ content: base, changes, keep: true }));
    const a = blockOf(r.content['en/pages/home.json'], 'fa-home');
    check(a && a.data.title === 'Boss new' && a.schemaVersion === 2, `落库 title = "Boss new"、v2（读到 ${JSON.stringify(a && { title: a.data.title, v: a.schemaVersion })}）`);
  }

  // ── ④ preservesLook: false ───────────────────────────────────────────────────────────────────
  console.log('④ 同一条迁移标 preservesLook: false ⟹ 保存不迁、migrateInMemory 也不迁');
  useBlocks(lookFalse);
  {
    const changes = homeChange(base, (a) => { a.data = { headline: 'Old home' }; });
    const r = await quietly(() => save({ content: base, changes, keep: true }));
    const a = blockOf(r.content['en/pages/home.json'], 'fa-home');
    check(a && a.schemaVersion === undefined && a.data.headline === 'Old home', `保存：fake-a 仍是 v1（读到 ${JSON.stringify(a)}）`);
    const mem = migrateInMemory(base);
    check(bytesOf(mem['en/pages/faq.json']) === bytesOf(base['en/pages/faq.json'])
      && bytesOf(mem['en/pages/home.json']) === bytesOf(base['en/pages/home.json']), 'migrateInMemory：两页都没动');
  }
  useBlocks(fake);
  {
    const mem = migrateInMemory(base);
    check(blockOf(mem['en/pages/faq.json'], 'fa-faq').schemaVersion === 2, '对照：标 true 时 migrateInMemory 把 faq 的 fake-a 升到 v2（上一格不是空尺）');
  }

  // ── ⑤ 盖号 ──────────────────────────────────────────────────────────────────────────────────
  console.log('⑤ 所有写入方盖号走同一个函数（stampSchemaVersions）');
  {
    const changes = homeChange(base, (a, page) => {
      a.data = { title: 'Old home' };
      page.blocks.push({ id: 'fb-new', type: 'fake-b', role: 'optional', region: 'content', weight: 950, data: { title: 'New B' } });
    });
    const r = await quietly(() => save({ content: base, changes, keep: true }));
    const b = blockOf(r.content['en/pages/home.json'], 'fb-new');
    check(b && b.schemaVersion === 3, `画布新插 fake-b ⟹ 落库 schemaVersion 3（读到 ${JSON.stringify(b && b.schemaVersion)}）`);
    check(blockOf(r.content['en/pages/home.json'], 'fa-home').schemaVersion === 2, 'save 里刚迁到 v2 的块没被盖回 1');
  }
  {
    // AI 整份重写首页：老块 fake-a（上一版是 v2）原样留着但没带号，新加一个 fake-b。
    const prev = saved.content;
    const next = clone(prev);
    const page = next['en/pages/home.json'];
    for (const b of page.blocks) delete b.schemaVersion;
    page.blocks.push({ id: 'fb-ai', type: 'fake-b', role: 'optional', region: 'content', weight: 950, data: { title: 'AI B' } });
    const r = await quietly(() => validate({ prev, next }));
    const home = r.content['en/pages/home.json'];
    const hero = home.blocks[0];
    check(blockOf(home, 'fa-home').schemaVersion === 2, `validate：老块 fake-a 继承上一版的 2（读到 ${blockOf(home, 'fa-home').schemaVersion}）`);
    check(blockOf(home, 'fb-ai').schemaVersion === 3, `validate：AI 新加的 fake-b 是当前的 3（读到 ${blockOf(home, 'fb-ai').schemaVersion}）`);
    check(hero.schemaVersion === prev['en/pages/home.json'].blocks[0].schemaVersion, `validate：上一版没写号的老块（${hero.id}）这一版也不写`);
  }
  {
    // 真进程 site.js create（skipAI，真块目录）：每一块、两个外壳区都有号。
    const out = tmpOs('tmp-1838-create-');
    const env = { ...process.env };
    delete env.AI1ST_BLOCKS_DIR; delete env.AI1ST_REGISTRY_PATH; delete env.ANTHROPIC_API_KEY;
    const payload = { siteId: 'site-t1838stamp', siteUrl: 'https://site-t1838stamp.ai1stsite.dev', companyName: 'Stamp Co', industry: 'Demo', services: ['Demo Service'], language: 'en', skipAI: true, skipGeocode: true };
    const r = cp.spawnSync(process.execPath, [path.join(SCRIPTS, 'site.js'), 'create', '--out-dir', out],
      { input: JSON.stringify(payload), cwd: ROOT, env, encoding: 'utf8', maxBuffer: 64 << 20, timeout: 120000 });
    const created = (r.stdout || '').split('\n').filter((l) => l.startsWith('{')).map((l) => { try { return JSON.parse(l); } catch { return {}; } }).find((e) => e.event === 'created');
    if (r.status !== 0 || !created) die(`site.js create rc=${r.status}\n${(r.stderr || '').slice(-800)}`);
    const content = JSON.parse(fs.readFileSync(created.result, 'utf-8')).content;
    const missing = [];
    let n = 0;
    for (const [rel, v] of Object.entries(content)) {
      if (/pages\/.+\.json$/.test(rel)) for (const b of v.blocks || []) { n += 1; if (b.schemaVersion !== 1) missing.push(`${rel}#${b.id}`); }
      if (/navigation\.json$/.test(rel)) for (const reg of ['header', 'footer']) { n += 1; if (!v[reg] || v[reg].schemaVersion !== 1) missing.push(`${rel}#${reg}`); }
    }
    if (n < 5) die(`create 出来的站只数到 ${n} 个块 —— 下一格成了空尺`);
    check(missing.length === 0, `create：${n} 个块（含顶栏 / 页脚）每个都带 schemaVersion 1`, `没带的：${missing.join(', ')}`);
  }

  // ── ⑥ 「碰到的文件」白名单 ────────────────────────────────────────────────────────────────────
  console.log('⑥ 「碰到的文件」白名单：navigation.json 里是一个 v1 的顶栏（假块目录里顶栏是 v2）');
  {
    const navBefore = bytesOf(base['en/navigation.json']);
    if (base['en/navigation.json'].header.schemaVersion !== undefined) die('夹具顶栏已经带号 —— 这一格立不起来');
    // 先让菜单同步过一次（夹具没有 knownPages），否则「逐字节不变」量的是菜单同步，不是迁移。
    const synced = { ...base, 'en/navigation.json': contentPatchesOf(base)['en/navigation.json'] };
    const syncedNav = bytesOf(synced['en/navigation.json']);
    const theme = JSON.parse(JSON.stringify(synced['theme.json']));
    const shape = (theme.regionLayout && theme.regionLayout.header) || null;
    const otherShape = ['centered', 'split', 'minimal', 'classic'].find((s) => s !== shape && fs.existsSync(path.join(REAL_BLOCKS, 'header', s))) || fs.readdirSync(path.join(REAL_BLOCKS, 'header'), { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name).find((s) => s !== shape);
    for (const [label, root] of [['headerShape', { headerShape: otherShape }], ['headerOptions', { headerOptions: { bg: 'brand' } }]]) {
      let r;
      try { r = await quietly(() => save({ content: synced, changes: { page: 'home', locale: 'en', root } })); } catch (e) { bad(`只改 root.${label} 存不了：${e.message}`); continue; }
      check(bytesOf(r.content['en/navigation.json']) === syncedNav, `只改 root.${label} ⟹ navigation.json 逐字节等于保存前（files: ${r.files.join(', ')}）`);
    }
    const buttons = [{ label: 'Call us', href: '/contact' }];
    const r = await quietly(() => save({ content: synced, changes: { page: 'home', locale: 'en', root: { headerButtons: buttons } } }));
    const h = r.content['en/navigation.json'].header;
    check(h.schemaVersion === 2 && JSON.stringify(h.buttons) === JSON.stringify(buttons), `改 root.headerButtons ⟹ navigation.json 被迁（header.schemaVersion = ${h.schemaVersion}）`);
    check(navBefore === bytesOf(base['en/navigation.json']), '入参的 navigation.json 没被改');
  }

  // ── ⑦ contentPatchesOf 回对象 + touchedFiles ──────────────────────────────────────────────────
  console.log('⑦ contentPatchesOf：.json 补丁是对象；touchedFiles 只迁点名的那几份');
  {
    const p = contentPatchesOf(base);
    check(typeof p['en/navigation.json'] === 'object' && p['en/navigation.json'] !== null, 'navigation.json 的补丁是对象');
    check(!('en/pages/home.json' in p) && !('en/pages/faq.json' in p), '不传 touchedFiles ⟹ 一页都不迁');
    const t = contentPatchesOf(base, { touchedFiles: ['en/pages/faq.json'] });
    check(t['en/pages/faq.json'] && blockOf(t['en/pages/faq.json'], 'fa-faq').schemaVersion === 2 && !('en/pages/home.json' in t),
      'touchedFiles = [faq] ⟹ 只有 faq 的补丁（迁到 v2），首页不在');
    for (const f of ['site-editor.js', 'site-create.js', 'site-edit.js']) {
      const src = fs.readFileSync(path.join(__dirname, f), 'utf-8');
      check(!/contentPatchesOf[\s\S]{0,400}JSON\.parse\(text\)/.test(src), `${f}：不再对 contentPatchesOf 的返回值 JSON.parse`);
    }
  }

  // ── ⑧ 假块不进产品 ───────────────────────────────────────────────────────────────────────────
  console.log('⑧ 假块不进产品；真注册表的版本表 = blocks/ 下每个文件夹一行');
  {
    delete process.env.AI1ST_BLOCKS_DIR;
    delete process.env.AI1ST_REGISTRY_PATH;
    const { editorSchema } = require('./editor-schema');
    const { categoriesOf } = require('./editor-convert');
    const { blockShapeCatalog } = require('./block-catalog');
    const real = categoriesOf(editorSchema({ registryPath: REAL_REGISTRY, blocksDir: REAL_BLOCKS })).sections.components;
    const withFakes = categoriesOf(editorSchema({ registryPath: fake.registryPath, blocksDir: fake.blocksDir })).sections.components;
    if (real.length < 5) die(`真注册表的「可添加」列表只有 ${real.length} 项 —— 尺子坏了`);
    check(!real.some((t) => t.startsWith('fake-')), `Puck「可添加」列表（真注册表）没有 fake-*（${real.length} 项）`);
    check(withFakes.includes('fake-a') && withFakes.includes('fake-b'), '对照：改道到假块目录时列表里有 fake-a / fake-b（上一格不是空尺）');
    const catalog = blockShapeCatalog({ registryPath: REAL_REGISTRY, blocksDir: REAL_BLOCKS });
    check(!catalog.blocks.some((t) => t.startsWith('fake-')), `图册（真注册表 + 真块目录）没有 fake-*（${catalog.blocks.length} 个块）`);
    const dirs = fs.readdirSync(REAL_BLOCKS, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name);
    check(!dirs.some((d) => d.startsWith('fake-')), `blocks/ 下没有 fake-*（${dirs.length} 个文件夹）`);
    const reg = fs.readFileSync(REAL_REGISTRY, 'utf-8');
    check(!/fake-/.test(reg), 'registry.generated.ts 里没有 fake-*');
    const table = reg.slice(reg.indexOf('blockSchemaVersions'), reg.indexOf('sectionRegistry'));
    const rows = [...table.matchAll(/^ {2}"([a-z0-9-]+)": \{ schemaVersion: (\d+), renders: \[([\d, ]+)\] \},$/gm)];
    const want = dirs.map((d) => {
      const m = JSON.parse(fs.readFileSync(path.join(REAL_BLOCKS, d, 'manifest.json'), 'utf-8'));
      return `${d}:${m.schemaVersion}:${m.renders.join(',')}`;
    }).sort();
    const got = rows.map((x) => `${x[1]}:${x[2]}:${x[3].replace(/\s/g, '')}`).sort();
    check(JSON.stringify(got) === JSON.stringify(want), `版本表 ${rows.length} 行 = blocks/ 下 ${dirs.length} 个文件夹（含 header / footer），每行跟 manifest 一致`, `表 ${JSON.stringify(got)}\n       盘 ${JSON.stringify(want)}`);
    assert.ok(dirs.includes('header') && dirs.includes('footer'), 'blocks/ 下有 header / footer');
  }

  // ── ⑨ 盖了号的外壳区不被当成陌生键 ──────────────────────────────────────────────────────────
  console.log('⑨ 顶栏 / 页脚带 schemaVersion ⟹ AI 改菜单那道门不把它当「谁都不读的陌生键」报给老板，形状也合格');
  {
    const { undeclaredKeyPaths, shapeProblems } = require('./navigation-owned');
    const nav = clone(base['en/navigation.json']);
    nav.header.schemaVersion = 1;
    nav.footer.schemaVersion = 1;
    const stray = undeclaredKeyPaths(nav).filter((k) => /schemaVersion/.test(k));
    check(stray.length === 0, '陌生键里没有 header / footer.schemaVersion', JSON.stringify(stray));
    check(shapeProblems(nav).length === 0, 'shapeProblems 为空', JSON.stringify(shapeProblems(nav)));
    nav.header.schemaVersion = '2';
    check(shapeProblems(nav).some((p) => /header\.schemaVersion/.test(p)), '对照：header.schemaVersion 写成字符串 ⟹ shapeProblems 点名它');
  }

  console.log(`\n══ block-schema-versions.test.js: ${passed} 过 · ${failed} 失败 ══`);
  return failed ? 1 : 0;
}

main().then((code) => {
  for (const d of made) fs.rmSync(d, { recursive: true, force: true });
  process.exit(code);
}, (e) => {
  for (const d of made) fs.rmSync(d, { recursive: true, force: true });
  console.log(`⛔ 跑不起来：${e && e.stack}`);
  process.exit(2);
});
