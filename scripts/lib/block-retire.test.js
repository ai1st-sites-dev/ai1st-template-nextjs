#!/usr/bin/env node
/**
 * block-retire.test.js — #1839（SiteAsData T4c）块退役与升级的验收台（设计文档 §8.2 ② ③、§8.5）。
 *
 * 跑法:  node scripts/lib/block-retire.test.js   （或 `npm run test:scripts`，按文件名发现）
 * 退出码: 0 全过 · 1 有失败 · 2 跑不起来（没有 Chromium / esbuild 等，**不许当成通过**）
 *
 * 假块同 #1838 的做法（block-schema-versions.test.js §fakeBlocksDir）：真 `blocks/` 整份拷进模板根下一份临时目录 + 假块
 * fake-a（v2，`1→2`）/ fake-b / fake-c（退役、没有替代块），`build-blocks.js --blocks-dir --out` 生成临时注册表，
 * `AI1ST_BLOCKS_DIR` / `AI1ST_REGISTRY_PATH` 让 save / editor-data / render / freeze 整条改道过去。
 *
 *   ① 退役 A：Puck 的「可添加」列表里没有 A（categoriesOf，纯函数格）· 它照常有字段（照常能编）· 含 A 的站 render 产物里 A 在
 *   ② 弹窗纯函数格（pendingChangesOf）：A `1→2` 标 false ⟹ 一条 upgrade；标 true ⟹ 空；frozenFrom 非空且 ui_flags 里没有 ⟹
 *      一条 retired；ui_flags 里有 ⟹ 空
 *   ③ 真路（save --migrate）：`{changes, migrate}` ⟹ reason upgrade-fake-a、A 是新号新形状、changes 里那一笔也落了；
 *      再 editor-data ⟹ pendingUpgrades 为空
 *   ④ `site.js migrate --dry-run --only` 回迁移后的 content、不带 --dry-run 一律拒
 *   ⑤ `site.js edit --scope` 指到待升级的 A ⟹ 事件流有 needs-upgrade、没有 edited；冻结块改一个字过 validate
 *   ⑥ 冻结：`site.js freeze --type fake-c` ⟹ C 变成 Custom HTML（frozenFrom、attrs 有容器 class / data-tone）；
 *      用**不认识 C 的包**发布一次 ⟹ `data-block-id` 元素的 innerHTML 跟冻结前逐字相同（注入的 <style> 不算）、
 *      块根和第一个含文本的元素那九样 getComputedStyle 相同（无头 Chromium）
 *   ⑦ attrs 白名单：attrs 改成 {onclick, class:"a", style:"background:url(javascript:1)"} ⟹ 产物容器上只有 class="a"
 *   ⑧ check-migrations：六个带表单 / 交互的块标 retired ⟹ 合并闸 rc=1、逐个点名；真块目录 ⟹ 0 条
 */
'use strict';

const cp = require('child_process');
const fs = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', '..');
const SCRIPTS = path.join(ROOT, 'scripts');
const REAL_BLOCKS = path.join(ROOT, 'blocks');
const FAKES = path.join(SCRIPTS, 'fixtures', 'blocks');
const SITE = path.join(SCRIPTS, 'fixtures', 'site-fixtures', 'site-0448c807.json');
const STYLE_PROPS = ['color', 'background-color', 'font-family', 'font-size', 'font-weight', 'padding', 'margin', 'border-radius', 'display'];

let failed = 0;
let passed = 0;
const check = (cond, m, detail) => {
  if (cond) { passed += 1; console.log(`  ✅ ${m}`); } else { failed += 1; console.log(`  ❌ ${m}${detail === undefined ? '' : `\n       ${detail}`}`); }
};
const die = (m) => { console.log(`⛔ 跑不起来：${m}`); process.exit(2); };

const made = [];
const tmpUnder = (prefix) => { const d = fs.mkdtempSync(path.join(ROOT, prefix)); made.push(d); return d; };
const tmpOs = (prefix) => { const d = fs.mkdtempSync(path.join(os.tmpdir(), prefix)); made.push(d); return d; };
process.on('exit', () => { for (const d of made) fs.rmSync(d, { recursive: true, force: true }); });

const clone = (v) => JSON.parse(JSON.stringify(v));
const blockOf = (page, id) => (page.blocks || []).find((b) => b.id === id);

/** 一份块目录 + 它生成的注册表。`fakes` = 拷哪几个假块；`variant(dir)` 在生成之前改它。 */
function fakeBlocksDir(fakes, variant) {
  const dir = tmpUnder('tmp-1839-blocks-');
  for (const e of fs.readdirSync(REAL_BLOCKS, { withFileTypes: true })) {
    if (e.isDirectory()) fs.cpSync(path.join(REAL_BLOCKS, e.name), path.join(dir, e.name), { recursive: true });
  }
  for (const name of fakes) fs.cpSync(path.join(FAKES, name), path.join(dir, name), { recursive: true });
  if (variant) variant(dir);
  const gen = tmpOs('tmp-1839-gen-');
  const r = cp.spawnSync(process.execPath, [path.join(SCRIPTS, 'block-build', 'build-blocks.js'), '--blocks-dir', dir, '--out', gen], { cwd: ROOT, encoding: 'utf8' });
  if (r.status !== 0) die(`build-blocks.js --blocks-dir 跑不出来（${r.status}）：${r.stdout}${r.stderr}`);
  return { blocksDir: dir, registryPath: path.join(gen, 'registry.generated.ts') };
}
const editFile = (f, fn) => fs.writeFileSync(f, fn(fs.readFileSync(f, 'utf-8')));
const lookFalse = (dir) => editFile(path.join(dir, 'fake-a', 'migrations.js'), (s) => s.replace('preservesLook: true', 'preservesLook: false'));
const retireA = (dir) => editFile(path.join(dir, 'fake-a', 'manifest.json'), (s) => JSON.stringify({ ...JSON.parse(s), retired: true }, null, 2));
const useBlocks = (b) => { process.env.AI1ST_BLOCKS_DIR = b.blocksDir; process.env.AI1ST_REGISTRY_PATH = b.registryPath; };
const envOf = (b) => ({ ...process.env, AI1ST_BLOCKS_DIR: b.blocksDir, AI1ST_REGISTRY_PATH: b.registryPath });

/** 夹具：真站 0448c807；首页 + faq 各一个 fake-a v1（`data.headline` 是 v1 的字段名）、各一个 fake-c。 */
function fixture({ withC = true } = {}) {
  const c = JSON.parse(fs.readFileSync(SITE, 'utf-8'));
  const add = (rel, block) => c[rel].blocks.push(block);
  add('en/pages/home.json', { id: 'fa-home', type: 'fake-a', role: 'optional', region: 'content', weight: 900, data: { headline: 'Old home' } });
  add('en/pages/faq.json', { id: 'fa-faq', type: 'fake-a', role: 'optional', region: 'content', weight: 900, data: { headline: 'Old faq' } });
  if (withC) {
    add('en/pages/home.json', { id: 'fc-home', type: 'fake-c', role: 'optional', region: 'content', weight: 950, data: { title: 'Kept home' } });
    add('en/pages/faq.json', { id: 'fc-faq', type: 'fake-c', role: 'optional', region: 'content', weight: 950, data: { title: 'Kept faq' } });
  }
  return c;
}

async function quietly(fn) {
  const log = console.log;
  const err = console.error;
  console.log = () => {};
  console.error = () => {};
  try { return await fn(); } finally { console.log = log; console.error = err; }
}

/** `node site.js …` 一个进程，环境改道到 `blocks`。回 `{ status, lines, stdout, stderr }`。 */
function siteJs(args, blocks, input) {
  const r = cp.spawnSync(process.execPath, [path.join(SCRIPTS, 'site.js'), ...args], {
    cwd: ROOT, encoding: 'utf8', env: envOf(blocks), input: input || '', maxBuffer: 64 << 20,
  });
  const lines = (r.stdout || '').split('\n').filter(Boolean).map((l) => { try { return JSON.parse(l); } catch { return { raw: l }; } });
  return { status: r.status, lines, stdout: r.stdout || '', stderr: r.stderr || '' };
}

/** 发布产物里 `data-block-id="<id>"` 那个 `<section>`：`{ open, inner }`（site.js §extractSection 同一个切法）。 */
function sectionOf(html, id) {
  const { extractSection } = require('../site');
  const sec = extractSection(html, id);
  if (!sec) return null;
  const open = new RegExp(`<section\\b[^>]*\\sdata-block-id="${id}"[^>]*>`).exec(html)[0];
  return { ...sec, open };
}

function serve(roots) {
  const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css' };
  const srv = http.createServer((req, res) => {
    const url = decodeURIComponent((req.url || '/').split('?')[0]);
    const [, which, ...rest] = url.split('/');
    const r = roots[which];
    const rel = `/${rest.join('/')}`;
    const base = r && (rel.startsWith('/_platform/') ? r.platform : r.out);
    const f = base && path.join(base, rel.endsWith('/') ? `${rel}index.html` : rel);
    if (!f || !f.startsWith(base) || !fs.existsSync(f) || !fs.statSync(f).isFile()) { res.writeHead(404); res.end(); return; }
    let body = fs.readFileSync(f);
    // 页面引的是根路径（`/_platform/…`）：两份产物挂在 /before/、/after/ 下面，引用跟着改一下。
    if (f.endsWith('.html')) body = Buffer.from(body.toString('utf-8').replace(/(href|src)="\/(?!\/)/g, `$1="/${which}/`));
    res.writeHead(200, { 'Content-Type': types[path.extname(f)] || 'application/octet-stream' });
    res.end(body);
  });
  return new Promise((resolve) => srv.listen(0, '127.0.0.1', () => resolve(srv)));
}

/** 一页里 `data-block-id` 那块：块根 + 第一个含文本的元素的那九样。 */
async function computedOf(browser, url, id) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const p = await ctx.newPage();
  await p.route((u) => !u.hostname.startsWith('127.0.0.1'), (r) => r.fulfill({ status: 200, body: '' }));
  await p.goto(url);
  await p.waitForLoadState('load');
  const r = await p.evaluate(({ id, props }) => {
    const root = document.querySelector(`[data-block-id="${id}"]`);
    if (!root) return null;
    const pick = (el) => { const cs = getComputedStyle(el); return Object.fromEntries(props.map((k) => [k, cs.getPropertyValue(k)])); };
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, { acceptNode: (n) => (n.textContent.trim() && n.parentElement.tagName !== 'STYLE' ? 1 : 3) });
    const t = walker.nextNode();
    return { root: pick(root), text: t ? pick(t.parentElement) : null, textTag: t ? t.parentElement.tagName : null };
  }, { id, props: STYLE_PROPS });
  await ctx.close();
  return r;
}

async function main() {
  for (const f of ['fake-a', 'fake-b', 'fake-c']) if (!fs.existsSync(path.join(FAKES, f, 'manifest.json'))) die(`scripts/fixtures/blocks/${f} 不在`);
  if (!fs.existsSync(SITE)) die(`夹具 ${SITE} 不在`);
  let chromium;
  try { ({ chromium } = require('playwright')); require.resolve('esbuild'); } catch (e) { die(`载入失败：${e.message}`); }

  const fakeTrue = fakeBlocksDir(['fake-a', 'fake-b', 'fake-c']);
  const fakeFalse = fakeBlocksDir(['fake-a', 'fake-b', 'fake-c'], lookFalse);
  const fakeRetiredA = fakeBlocksDir(['fake-a', 'fake-b', 'fake-c'], retireA);
  const noC = fakeBlocksDir(['fake-a', 'fake-b'], lookFalse);
  const { loadBlockVersions } = require('./block-migrations');
  const changes = require('./block-changes');
  const sitejs = require('../site');

  // ── ① 退役 A ────────────────────────────────────────────────────────────────────────────────
  console.log('① A 标 retired ⟹ 菜单里没有、照常能编、照常渲染');
  {
    useBlocks(fakeRetiredA);
    const { editorSchema } = require('./editor-schema');
    const { categoriesOf } = require('./editor-convert');
    const schema = editorSchema({ blocksDir: fakeRetiredA.blocksDir, registryPath: fakeRetiredA.registryPath });
    const cats = categoriesOf(schema);
    const a = schema.components.find((c) => c.type === 'fake-a');
    check(!cats.sections.components.includes('fake-a'), 'Puck 的 Sections（可添加）里没有 fake-a', JSON.stringify(cats.sections.components));
    check(cats.retired.visible === false && cats.retired.components.includes('fake-a'), '它在藏起来的 retired 那一格（visible:false）');
    check(cats.sections.components.includes('fake-b'), '对照：没退役的 fake-b 还在 Sections（这一格有牙）');
    check(!!a && a.retired === true && a.fields.length > 0, `fake-a 的组件还在、带字段（画布照常能编），retired=${a && a.retired}`);
    const bundleDir = tmpUnder('tmp-1839-bundle-');
    await quietly(() => sitejs.bundle(bundleDir, fakeRetiredA));
    const out = path.join(tmpOs('tmp-1839-render-'), 'out');
    let err = null;
    try { await quietly(() => sitejs.render({ content: fixture({ withC: false }), out, bundleDir, target: 'preview', siteId: 'site-t1839' })); } catch (e) { err = e; }
    const home = err ? '' : fs.readFileSync(path.join(out, 'index.html'), 'utf-8');
    check(!err && home.includes('data-block-id="fa-home"') && home.includes('data-block="fake-a"'),
      `含退役 A 的站照常渲染、产物里 A 在（也就是回退到含退役类型的旧版本照旧代码画）${err ? `：${err.message}` : ''}`);
  }

  // ── ② 弹窗纯函数格 ──────────────────────────────────────────────────────────────────────────
  console.log('② pendingChangesOf（假 manifest）');
  {
    const base = fixture({ withC: false });
    const vFalse = loadBlockVersions(fakeFalse.blocksDir);
    const vTrue = loadBlockVersions(fakeTrue.blocksDir);
    const p1 = changes.pendingChangesOf(base, vFalse);
    check(p1.upgrades.length === 2 && p1.upgrades.every((u) => u.type === 'fake-a' && u.from === 1 && u.to === 2 && u.label === 'Fake A (test only)'),
      'A 1→2 标 preservesLook:false ⟹ 每块一条 upgrade（from 1 → to 2，label 取 manifest displayName）', JSON.stringify(p1.upgrades));
    check(p1.retired.length === 0, '没有冻结块 ⟹ retired 空');
    const p2 = changes.pendingChangesOf(base, vTrue);
    check(p2.upgrades.length === 0, 'A 1→2 标 true ⟹ upgrades 空（静默迁，不弹）', JSON.stringify(p2.upgrades));
    const frozen = clone(base);
    frozen['en/pages/home.json'].blocks.push({ id: 'ch-frozen', type: 'custom-html', schemaVersion: 1, data: { html: '<p>x</p>', label: 'Fake C (test only)', frozenFrom: 'fake-c' } });
    const p3 = changes.pendingChangesOf(frozen, vTrue);
    check(p3.retired.length === 1 && p3.retired[0].blockId === 'ch-frozen' && p3.retired[0].label === 'Fake C (test only)',
      'frozenFrom 非空且 ui_flags 里没有 ⟹ 一条 retired（label 取 manifest）', JSON.stringify(p3.retired));
    const p4 = changes.pendingChangesOf(frozen, vTrue, { uiFlags: { frozenAcknowledged: ['ch-frozen'] } });
    check(p4.retired.length === 0, 'ui_flags.frozenAcknowledged 里有它 ⟹ retired 空');
    const p5 = changes.pendingChangesOf(frozen, vFalse, { uiFlags: { frozenAcknowledged: [] } });
    check(p5.upgrades.length === 2 && p5.retired.length === 1, '升级和退役同时有 ⟹ 两样都回（弹窗合成一个、两段）');
  }

  // ── ③ 真路：save --migrate ─────────────────────────────────────────────────────────────────
  console.log('③ save {changes, migrate} ⟹ upgrade-fake-a、新号、changes 也落；再 editor-data ⟹ pendingUpgrades 空');
  let savedContent = null;
  {
    useBlocks(fakeFalse);
    const { save, editorData } = require('./site-editor');
    const base = fixture({ withC: true });
    const ed0 = await quietly(() => editorData({ content: base, page: 'home', locale: 'en' }));
    check(Array.isArray(ed0.pendingUpgrades) && ed0.pendingUpgrades.map((u) => u.blockId).sort().join() === 'fa-faq,fa-home',
      `editor-data 回 pendingUpgrades（整站：fa-home + fa-faq）`, JSON.stringify(ed0.pendingUpgrades));
    const page = clone(base['en/pages/home.json']);
    for (const b of page.blocks) delete b.schemaVersion;
    blockOf(page, 'fc-home').data = { title: 'Edited C' };
    const ch = { page: 'home', locale: 'en', json: page, baseHash: ed0.props.baseHash };
    let r = null;
    try { r = await quietly(() => save({ content: base, changes: ch, migrate: ['fa-home', 'fa-faq'] })); } catch (e) { check(false, `save --migrate 抛了：${e.message}`); }
    if (r) {
      const home = r.content['en/pages/home.json'];
      const faq = r.content['en/pages/faq.json'];
      const a = blockOf(home, 'fa-home');
      check(r.reason === 'upgrade-fake-a', `reason = upgrade-fake-a（读到 ${r.reason}）`);
      check(r.summary === 'Updated the Fake A (test only) block to its latest version', `summary 是票面那句（读到 ${JSON.stringify(r.summary)}）`);
      check(a && a.schemaVersion === 2 && a.data.title === 'Old home' && a.data.headline === undefined, `首页 A 是 v2 新形状（${JSON.stringify(a)}）`);
      check(blockOf(faq, 'fa-faq').schemaVersion === 2, '另一页（这一笔没碰的 faq）上点了 Update 的那块也迁了');
      check(blockOf(home, 'fc-home').data.title === 'Edited C', 'changes 里那一笔（改 C 的标题）也落了');
      savedContent = r.content;
      const ed1 = await quietly(() => editorData({ content: r.content, page: 'home', locale: 'en' }));
      check(ed1.pendingUpgrades.length === 0, `再 editor-data ⟹ pendingUpgrades 为空（读到 ${JSON.stringify(ed1.pendingUpgrades)}）`);
    }
    // 对照：不带 migrate 的同一笔 ⟹ A 还是 v1（这一格证明是 migrate 在迁，不是保存顺手迁）
    const r0 = await quietly(() => save({ content: base, changes: ch }));
    check(blockOf(r0.content['en/pages/home.json'], 'fa-home').data.headline === 'Old home' && !r0.reason,
      '对照：不带 migrate ⟹ A 原样是 v1、reason 不是 upgrade（老板不动站不动）');
    // 只点 Update、手上没有别的改动：changes 只有 page / locale
    const r2 = await quietly(() => save({ content: base, changes: { page: 'home', locale: 'en' }, migrate: ['fa-home'] }));
    check(blockOf(r2.content['en/pages/home.json'], 'fa-home').schemaVersion === 2 && r2.reason === 'upgrade-fake-a', '只带 migrate 的一笔也收、也迁');
  }

  // ── ④ migrate --dry-run ────────────────────────────────────────────────────────────────────
  console.log('④ site.js migrate --dry-run --only');
  {
    const dir = tmpOs('tmp-1839-mig-');
    const f = path.join(dir, 'site.json');
    fs.writeFileSync(f, JSON.stringify(fixture({ withC: false })));
    const r = siteJs(['migrate', '--site', f, '--dry-run', '--only', 'fa-home'], fakeFalse);
    const out = r.lines[r.lines.length - 1] || {};
    const home = out.content && out.content['en/pages/home.json'];
    check(r.status === 0 && out.ok === true && blockOf(home, 'fa-home').schemaVersion === 2 && blockOf(out.content['en/pages/faq.json'], 'fa-faq').data.headline === 'Old faq',
      `回迁移后的 content：只迁 --only 点名的那块（rc=${r.status}）`, r.stdout.slice(0, 300) + r.stderr.slice(-300));
    const r2 = siteJs(['migrate', '--site', f, '--only', 'fa-home'], fakeFalse);
    const o2 = r2.lines[r2.lines.length - 1] || {};
    check(r2.status === 3 && o2.ok === false && o2.code === 'bad', `不带 --dry-run ⟹ 拒（rc=${r2.status} ${JSON.stringify(o2)}）`);
  }

  // ── ⑤ needs-upgrade ────────────────────────────────────────────────────────────────────────
  console.log('⑤ site.js edit --scope 指到待升级的 A ⟹ needs-upgrade、不改；冻结块改一个字过 validate');
  {
    const dir = tmpOs('tmp-1839-edit-');
    const f = path.join(dir, 'site.json');
    fs.writeFileSync(f, JSON.stringify(fixture({ withC: false })));
    const r = siteJs(['edit', '--site', f, '--message', 'Make this shorter', '--scope', JSON.stringify({ page: 'home', locale: 'en', blockId: 'fa-home' }), '--out-dir', path.join(dir, 'out')], fakeFalse, '{}');
    const ev = r.lines.map((l) => l.event);
    check(r.status === 0 && ev.includes('needs-upgrade') && !ev.includes('edited') && ev[ev.length - 1] === 'edit-complete',
      `事件流：needs-upgrade → edit-complete，没有 edited（读到 ${JSON.stringify(ev)}，rc=${r.status}）`, r.stderr.slice(-400));
    const done = r.lines.find((l) => l.event === 'edit-complete') || {};
    check(done.filesModified === false && !fs.existsSync(path.join(dir, 'out', 'result.json')), '内容没变（没有 result.json、filesModified:false）');
    useBlocks(fakeTrue);
    const { validate } = require('./site-edit');
    const prev = fixture({ withC: false });
    prev['en/pages/home.json'].blocks.push({ id: 'ch-frozen', type: 'custom-html', schemaVersion: 1, role: 'optional', region: 'content', weight: 990, data: { html: '<div class="container"><h2>Kept as is</h2></div>', label: 'Fake C (test only)', frozenFrom: 'fake-c', attrs: { class: 'position-relative section-padding' } } });
    const next = clone(prev);
    blockOf(next['en/pages/home.json'], 'ch-frozen').data.html = '<div class="container"><h2>Kept as it is</h2></div>';
    let v = null;
    try { v = await quietly(() => validate({ prev, next, scope: { page: 'home', locale: 'en', blockId: 'ch-frozen' } })); } catch (e) { check(false, `冻结块改一个字被拒：${e.message}`); }
    if (v) check(v.files.includes('en/pages/home.json') && blockOf(v.content['en/pages/home.json'], 'ch-frozen').data.html.includes('Kept as it is'), '已冻结成 Custom HTML 的块 AI 改一个字 ⟹ 过、改了');
  }

  // ── ⑥ 冻结 + 发布比对 ───────────────────────────────────────────────────────────────────────
  console.log('⑥ site.js freeze --type fake-c ⟹ Custom HTML；用不认识 C 的包发布 ⟹ innerHTML 逐字、九样 computed style 相同');
  const browser = await chromium.launch().catch((e) => die(`Chromium 起不来：${e.message}`));
  try {
    const bundleC = tmpUnder('tmp-1839-bundle-c-');
    const bundleNoC = tmpUnder('tmp-1839-bundle-noc-');
    await quietly(() => sitejs.bundle(bundleC, fakeFalse));
    await quietly(() => sitejs.bundle(bundleNoC, noC));
    const before = savedContent || fixture({ withC: true });
    const dir = tmpOs('tmp-1839-freeze-');
    const f = path.join(dir, 'site.json');
    fs.writeFileSync(f, JSON.stringify(before));
    const r = siteJs(['freeze', '--site', f, '--type', 'fake-c', '--bundle-dir', bundleC], fakeFalse);
    const out = r.lines[r.lines.length - 1] || {};
    check(r.status === 0 && out.ok === true && (out.frozen || []).sort().join() === 'fc-faq,fc-home', `冻了 fc-home + fc-faq（rc=${r.status}，${JSON.stringify(out.frozen)}）`, r.stderr.slice(-600));
    const after = out.content;
    const fc = after && blockOf(after['en/pages/home.json'], 'fc-home');
    check(fc && fc.type === 'custom-html' && fc.data.frozenFrom === 'fake-c' && fc.data.label === 'Fake C (test only)' && fc.schemaVersion === 1,
      'C 变成 Custom HTML 块（frozenFrom: "fake-c"，label 取 manifest）', JSON.stringify(fc).slice(0, 300));
    check(fc && /section-padding/.test(fc.data.attrs.class || '') && typeof fc.data.attrs['data-tone'] === 'string' && fc.data.attrs['data-block'] === 'fake-c' && !('data-block-id' in fc.data.attrs),
      `attrs 有容器的 class / data-tone / data-block（${JSON.stringify(fc && fc.data.attrs)}）`);
    check(out.summary === 'Kept the Fake C (test only) block as it was', `summary 是设计文档那句（${JSON.stringify(out.summary)}）`);

    // 冻结前：认识 C 的包 + 带 C 的块目录；冻结后：不认识 C 的包 + 没有 C 的块目录（块代码删了的那一天，样子全靠冻进去的那段）
    const roots = {};
    for (const [name, content, blocks, bundleDir] of [['before', before, fakeFalse, bundleC], ['after', after, noC, bundleNoC]]) {
      useBlocks(blocks);
      const o = path.join(tmpOs(`tmp-1839-${name}-`), 'out');
      const plat = path.join(path.dirname(o), 'platform');
      let err = null;
      try { await quietly(() => sitejs.render({ content, out: o, bundleDir, target: 'live', siteId: 'site-t1839', platformOut: plat })); } catch (e) { err = e; }
      check(!err, `${name}：发布渲染成功${err ? `：${err.message}` : ''}`);
      roots[name] = { out: o, platform: plat };
    }
    const html = (n) => fs.readFileSync(path.join(roots[n].out, 'index.html'), 'utf-8');
    const sb = sectionOf(html('before'), 'fc-home');
    const sa = sectionOf(html('after'), 'fc-home');
    const injected = sa ? sa.inner.replace(/^<style>[\s\S]*?<\/style>/, '') : null;
    check(!!sb && !!sa && injected === sb.inner, '`data-block-id="fc-home"` 的 innerHTML 冻结前后逐字相同（注入的 <style> 不算）',
      `before ${sb && sb.inner.slice(0, 200)}\n       after  ${injected && injected.slice(0, 200)}`);
    check(!!sa && /^<style>/.test(sa.inner) && !html('after').includes('data-block="custom-html" data-role'), '冻结后那块带注入的 <style>，容器上是原来那一型（不是 custom-html）');
    check(!fs.readdirSync(path.join(roots.after.platform, '_platform', 'css')).some((n) => n.startsWith('shapes.') && fs.readFileSync(path.join(roots.after.platform, '_platform', 'css', n), 'utf-8').includes('[data-block="fake-c"]')),
      '对照：冻结后那份包的 shapes.css 里没有 fake-c 的规则（样子只能来自冻进去的那段）');
    const srv = await serve(roots);
    const base = `http://127.0.0.1:${srv.address().port}`;
    try {
      const cb = await computedOf(browser, `${base}/before/`, 'fc-home');
      const ca = await computedOf(browser, `${base}/after/`, 'fc-home');
      for (const part of ['root', 'text']) {
        const diff = STYLE_PROPS.filter((k) => !cb || !ca || !cb[part] || !ca[part] || cb[part][k] !== ca[part][k]);
        check(cb && ca && cb[part] && diff.length === 0, `${part === 'root' ? '块根 <section>' : `第一个含文本的元素（${cb && cb.textTag}）`} 九样 getComputedStyle 相同`,
          diff.map((k) => `${k}: ${cb && cb[part] && cb[part][k]} → ${ca && ca[part] && ca[part][k]}`).join(' · '));
      }
      check(cb && cb.root['background-color'] === 'rgb(236, 248, 255)' && cb.text.color === 'rgb(180, 30, 60)', '比的不是浏览器默认值：C 的 block.css 在冻结前确实生效（底色 / 字色）', JSON.stringify(cb));

      // ── ⑦ attrs 白名单 ────────────────────────────────────────────────────────────────────
      console.log('⑦ attrs 改成 {onclick, class:"a", style:"background:url(javascript:1)"} ⟹ 容器上只有 class="a"');
      const evil = clone(after);
      blockOf(evil['en/pages/home.json'], 'fc-home').data.attrs = { onclick: 'x', class: 'a', style: 'background:url(javascript:1)' };
      useBlocks(noC);
      const o = path.join(tmpOs('tmp-1839-evil-'), 'out');
      await quietly(() => sitejs.render({ content: evil, out: o, bundleDir: bundleNoC, target: 'live', siteId: 'site-t1839' }));
      const se = sectionOf(fs.readFileSync(path.join(o, 'index.html'), 'utf-8'), 'fc-home');
      check(!!se && /\sclass="a"/.test(se.open) && !/onclick/i.test(se.open) && !/\sstyle=/.test(se.open) && !/javascript/i.test(se.open),
        `容器：class="a"、没有 onclick、style 被清掉（${se && se.open}）`);
      // 上面那组料同时撞 DANGER 和 URL 白名单两道闸；这一格不带 url(，只有 DANGER 那条 javascript: 拦得住（#1839 r1 QA1 观察 1）
      const bare = require('./sanitize-css').frozenContainerAttrs({ style: 'color:red;background:javascript:alert(1)' });
      check(JSON.stringify(bare.style) === '{"color":"red"}', `不带 url( 的 javascript: 那条声明被丢、别的留下（${JSON.stringify(bare)}）`);
    } finally {
      srv.close();
    }
  } finally {
    await browser.close();
  }

  // ── ⑧ check-migrations：六个永不退役的块 ──────────────────────────────────────────────────────
  console.log('⑧ 带表单 / 交互的六个块 manifest 加 retired ⟹ check-migrations.js 红');
  {
    const cm = require('../block-build/check-migrations');
    const repo = tmpOs('tmp-1839-repo-');
    const blocks = path.join(repo, 'templates', 'nextjs', 'blocks');
    fs.mkdirSync(path.dirname(blocks), { recursive: true });
    fs.cpSync(REAL_BLOCKS, blocks, { recursive: true });
    const git = (...a) => cp.execFileSync('git', ['-C', repo, ...a], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
    git('init', '-q');
    git('-c', 'user.email=t@t', '-c', 'user.name=t', 'add', '.');
    git('-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-qm', 'base');
    git('tag', 'build-base');
    // 真进程跑闸（同 CI 的跑法）：§loadBlockVersions 一个进程按目录只读一次，同一个进程里改完 manifest 再跑读到的是旧的。
    const quietMain = (args) => {
      const r = cp.spawnSync(process.execPath, [path.join(SCRIPTS, 'block-build', 'check-migrations.js'), ...args], { encoding: 'utf8' });
      return { rc: r.status, lines: `${r.stdout}${r.stderr}`.split('\n') };
    };
    const clean = quietMain(['--repo', repo, '--base', 'build-base']);
    check(clean.rc === 0, `对照：没人标 retired ⟹ rc=0（读到 ${clean.rc}）`, clean.lines.join(' | '));
    for (const t of cm.NEVER_RETIRED) editFile(path.join(blocks, t, 'manifest.json'), (s) => JSON.stringify({ ...JSON.parse(s), retired: true }, null, 2));
    const red = quietMain(['--repo', repo, '--base', 'build-base']);
    const named = cm.NEVER_RETIRED.filter((t) => red.lines.some((l) => l.includes(`块 ${t} 的 manifest 标了 retired`)));
    check(red.rc === 1 && named.length === 6, `六个块标 retired ⟹ rc=1、逐个点名（rc=${red.rc}，点名 ${named.join(' / ')}）`, red.lines.join(' | '));
    editFile(path.join(blocks, 'contact', 'manifest.json'), (s) => { const m = JSON.parse(s); delete m.retired; return JSON.stringify(m, null, 2); });
    editFile(path.join(blocks, 'hero', 'manifest.json'), (s) => JSON.stringify({ ...JSON.parse(s), retired: true }, null, 2));
    const blocks5 = tmpOs('tmp-1839-blocks5-');
    fs.cpSync(blocks, blocks5, { recursive: true });
    const r5 = cm.neverRetiredProblems(loadBlockVersions(blocks5));
    check(r5.length === 5 && !r5.some((p) => p.includes('块 hero ')), `别的块（hero）标 retired 不算这条（读到 ${r5.length} 条）`);
  }

  console.log(`\n${failed ? '🔴' : '✅'} block-retire：${passed} 过 / ${failed} 不过`);
  process.exit(failed ? 1 : 0);
}

main().catch((e) => { console.log(`⛔ 跑不起来：${e && e.stack ? e.stack : e}`); process.exit(2); });
