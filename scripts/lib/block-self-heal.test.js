#!/usr/bin/env node
/**
 * block-self-heal.test.js — #1840（SiteAsData T4d）自愈的模板这一半（设计文档 §8.3）。manager 那一半（挑旧包、解包、spawn
 * 次数、排 freeze）在 manager/ticket1840_test.go。
 *
 * 跑法:  node scripts/lib/block-self-heal.test.js   （或 `npm run test:scripts`，按文件名发现）
 * 退出码: 0 全过 · 1 有失败 · 2 跑不起来（没有 esbuild 等，**不许当成通过**）
 *
 * 两份块目录（同 block-retire.test.js §fakeBlocksDir）：withC = 真 blocks/ + fake-a / fake-b / fake-c（「旧包」认识 C）；
 * noC = 真 blocks/ + fake-a / fake-b（「新包」，C 的文件夹删了）。各打一份 bundle。
 *
 *   ① `render --freeze-from`：noC 包直接画含 C 的站 ⟹ 退出码 3（读红）；withC 包 `--only-blocks` 画出 C，noC 包带 `--freeze-from`
 *      再画 ⟹ 成功、C 的位置 innerHTML 跟 withC 包整站画的逐字相同（注入的 <style> 不算）、容器带 attrs（class / data-tone）、
 *      标准输出 `frozen` 点名两块；只给一块的 ids ⟹ 另一块照样被入口扫描报出来（退出码 3，没冻的块不会悄悄消失）
 *   ② `freeze --rendered <目录> --ids --label`：只转换不画；ids 只冻点名的那块；label 用给的名字；summary 跟着它
 *   ③ 先迁后冻：noC 的 fake-b 表里有 `fake-c→fake-b`（preservesLook: true）⟹ 渲染直接成功、C 画成 B；标 false ⟹ 照旧退出码 3；
 *      写库那一笔（migrateTouched）不跑它
 *   ④ `--freeze-from` 形状不对 ⟹ 整跑拒（退出码 1），不当成空
 */
'use strict';

const cp = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', '..');
const SCRIPTS = path.join(ROOT, 'scripts');
const REAL_BLOCKS = path.join(ROOT, 'blocks');
const FAKES = path.join(SCRIPTS, 'fixtures', 'blocks');
const SITE = path.join(SCRIPTS, 'fixtures', 'site-fixtures', 'site-0448c807.json');

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
const editFile = (f, fn) => fs.writeFileSync(f, fn(fs.readFileSync(f, 'utf-8')));

/** 一份块目录 + 它生成的注册表。`fakes` = 拷哪几个假块；`variant(dir)` 在生成之前改它。 */
function fakeBlocksDir(fakes, variant) {
  const dir = tmpUnder('tmp-1840-blocks-');
  for (const e of fs.readdirSync(REAL_BLOCKS, { withFileTypes: true })) {
    if (e.isDirectory()) fs.cpSync(path.join(REAL_BLOCKS, e.name), path.join(dir, e.name), { recursive: true });
  }
  for (const name of fakes) fs.cpSync(path.join(FAKES, name), path.join(dir, name), { recursive: true });
  if (variant) variant(dir);
  const gen = tmpOs('tmp-1840-gen-');
  const r = cp.spawnSync(process.execPath, [path.join(SCRIPTS, 'block-build', 'build-blocks.js'), '--blocks-dir', dir, '--out', gen], { cwd: ROOT, encoding: 'utf8' });
  if (r.status !== 0) die(`build-blocks.js --blocks-dir 跑不出来（${r.status}）：${r.stdout}${r.stderr}`);
  return { blocksDir: dir, registryPath: path.join(gen, 'registry.generated.ts') };
}

/** fake-b 的表里加一步 `fake-c→fake-b`：`data.title` 原样搬（两块的字段同名）。 */
const cToB = (look) => (dir) => fs.writeFileSync(path.join(dir, 'fake-b', 'migrations.js'),
  `'use strict';\nmodule.exports = { 'fake-c→fake-b': { migrate: (b) => ({ ...b, data: { title: (b.data && b.data.title) || '' } }), preservesLook: ${look} } };\n`);

const envOf = (b, extra = {}) => ({ ...process.env, AI1ST_BLOCKS_DIR: b.blocksDir, AI1ST_REGISTRY_PATH: b.registryPath, ...extra });

/** 夹具：真站 0448c807；首页 + faq 各一个 fake-c。 */
function fixture() {
  const c = JSON.parse(fs.readFileSync(SITE, 'utf-8'));
  c['en/pages/home.json'].blocks.push({ id: 'fc-home', type: 'fake-c', role: 'optional', region: 'content', weight: 950, data: { title: 'Kept home' } });
  c['en/pages/faq.json'].blocks.push({ id: 'fc-faq', type: 'fake-c', role: 'optional', region: 'content', weight: 950, data: { title: 'Kept faq' } });
  return c;
}

/** `node site.js …` 一个进程（真命令行，退出码是对外合同）。回 `{ status, lines, stdout, stderr }`。 */
function siteJs(args, blocks) {
  const r = cp.spawnSync(process.execPath, [path.join(SCRIPTS, 'site.js'), ...args], { cwd: ROOT, encoding: 'utf8', env: envOf(blocks), maxBuffer: 64 << 20 });
  const lines = (r.stdout || '').split('\n').filter(Boolean).map((l) => { try { return JSON.parse(l); } catch { return { raw: l }; } });
  return { status: r.status, lines, stdout: r.stdout || '', stderr: r.stderr || '' };
}

function bundleFor(blocks) {
  const dir = tmpUnder('tmp-1840-bundle-');
  const r = cp.spawnSync(process.execPath, [path.join(SCRIPTS, 'site.js'), 'bundle', '--out-dir', dir, '--blocks-dir', blocks.blocksDir, '--registry', blocks.registryPath],
    { cwd: ROOT, encoding: 'utf8', env: envOf(blocks) });
  if (r.status !== 0) die(`site.js bundle 跑不出来（${r.status}）：${(r.stderr || '').slice(-600)}`);
  return dir;
}

const writeJSON = (dir, name, v) => { const f = path.join(dir, name); fs.writeFileSync(f, JSON.stringify(v)); return f; };

function sectionOf(html, id) {
  const { extractSection } = require('../site');
  const sec = extractSection(html, id);
  if (!sec) return null;
  const open = new RegExp(`<section\\b[^>]*\\sdata-block-id="${id}"[^>]*>`).exec(html)[0];
  return { ...sec, open };
}

function main() {
  for (const f of ['fake-a', 'fake-b', 'fake-c']) if (!fs.existsSync(path.join(FAKES, f, 'manifest.json'))) die(`scripts/fixtures/blocks/${f} 不在`);
  if (!fs.existsSync(SITE)) die(`夹具 ${SITE} 不在`);
  try { require.resolve('esbuild'); } catch (e) { die(`载入失败：${e.message}`); }

  const withC = fakeBlocksDir(['fake-a', 'fake-b', 'fake-c']);
  const noC = fakeBlocksDir(['fake-a', 'fake-b']);
  const bundleC = bundleFor(withC);
  const bundleNoC = bundleFor(noC);
  const dir = tmpOs('tmp-1840-work-');
  const site = writeJSON(dir, 'site.json', fixture());
  const render = (blocks, bundle, extra = []) => {
    const out = path.join(fs.mkdtempSync(path.join(dir, 'r-')), 'out');
    return { out, r: siteJs(['render', '--site', site, '--out', out, '--bundle-dir', bundle, '--target', 'live', '--site-id', 'site-t1840', ...extra], blocks) };
  };

  // ── ① render --freeze-from ───────────────────────────────────────────────────────────────────
  console.log('① noC 包画含 C 的站 ⟹ 3；withC 包 --only-blocks 画 C、noC 包 --freeze-from 再画 ⟹ 成功、innerHTML 逐字、容器带 attrs');
  const red = render(noC, bundleNoC);
  check(red.r.status === 3 && /unknown block type fake-c at en\/pages\/home\.json#fc-home/.test(red.r.stderr) && !fs.existsSync(red.out),
    `读红：没有自愈 ⟹ 退出码 3、点名 fc-home、--out 不写（rc=${red.r.status}）`, red.r.stderr.slice(-300));
  const before = render(withC, bundleC);
  check(before.r.status === 0, `对照：认识 C 的包整站画 ⟹ 0（rc=${before.r.status}）`, before.r.stderr.slice(-300));
  const only = path.join(fs.mkdtempSync(path.join(dir, 'only-')), 'out');
  const ob = siteJs(['render', '--site', site, '--out', only, '--bundle-dir', bundleC, '--only-blocks', 'fc-home,fc-faq'], withC);
  check(ob.status === 0 && ['html', 'css', 'attrs.json'].every((x) => fs.existsSync(path.join(only, 'blocks', 'en', `fc-home.${x}`))),
    `旧包 --only-blocks ⟹ blocks/en/fc-home.{html,css,attrs.json}（rc=${ob.status}）`, ob.stderr.slice(-300));
  const plan = writeJSON(dir, 'freeze-from.json', [{ type: 'fake-c', rendered: only, ids: ['fc-home', 'fc-faq'], label: 'Fake C (test only)' }]);
  const healed = render(noC, bundleNoC, ['--freeze-from', plan]);
  const line = healed.r.lines[healed.r.lines.length - 1] || {};
  check(healed.r.status === 0 && (line.frozen || []).sort().join() === 'fake-c#fc-faq,fake-c#fc-home',
    `新包带 --freeze-from ⟹ 0、标准输出 frozen 点名两块（rc=${healed.r.status}，${JSON.stringify(line.frozen)}）`, healed.r.stderr.slice(-400));
  if (healed.r.status === 0 && before.r.status === 0) {
    const html = (o, p) => fs.readFileSync(path.join(o, p), 'utf-8');
    for (const [p, id] of [['index.html', 'fc-home'], ['faq/index.html', 'fc-faq']]) {
      const sb = sectionOf(html(before.out, p), id);
      const sa = sectionOf(html(healed.out, p), id);
      const inner = sa ? sa.inner.replace(/^<style>[\s\S]*?<\/style>/, '') : null;
      check(!!sb && !!sa && inner === sb.inner, `${p} 的 ${id}：innerHTML 跟认识 C 的包画的逐字相同（注入的 <style> 不算）`,
        `before ${sb && sb.inner.slice(0, 160)}\n       after  ${inner && inner.slice(0, 160)}`);
      check(!!sa && /^<style>/.test(sa.inner) && /\sclass="[^"]*section-padding/.test(sa.open) && /\sdata-tone="/.test(sa.open) && /\sdata-block="fake-c"/.test(sa.open),
        `${id} 的容器带冻进去的 attrs（class / data-tone / data-block="fake-c"）+ 注入的 <style>`, sa && sa.open);
    }
  }
  const half = writeJSON(dir, 'freeze-half.json', [{ type: 'fake-c', rendered: only, ids: ['fc-home'] }]);
  const halfR = render(noC, bundleNoC, ['--freeze-from', half]);
  check(halfR.r.status === 3 && /fake-c at en\/pages\/faq\.json#fc-faq/.test(halfR.r.stderr) && !/#fc-home/.test(halfR.r.stderr),
    `只冻 fc-home ⟹ fc-faq 照样被入口报出来、退出码 3（rc=${halfR.r.status}）`, halfR.r.stderr.slice(-300));

  // ── ② freeze --rendered ─────────────────────────────────────────────────────────────────────
  console.log('② freeze --rendered（只转换不画）· --ids 只冻点名的 · --label 进名字和 summary');
  const fz = siteJs(['freeze', '--site', site, '--type', 'fake-c', '--rendered', only, '--ids', 'fc-faq', '--label', 'Old C'], noC);
  const fo = fz.lines[fz.lines.length - 1] || {};
  const fcFaq = fo.content && blockOf(fo.content['en/pages/faq.json'], 'fc-faq');
  const fcHome = fo.content && blockOf(fo.content['en/pages/home.json'], 'fc-home');
  check(fz.status === 0 && fo.ok === true && JSON.stringify(fo.frozen) === '["fc-faq"]', `rc=0、frozen 只有 fc-faq（rc=${fz.status}，${JSON.stringify(fo.frozen)}）`, fz.stderr.slice(-300));
  check(fcFaq && fcFaq.type === 'custom-html' && fcFaq.data.frozenFrom === 'fake-c' && fcFaq.data.label === 'Old C' && fcHome && fcHome.type === 'fake-c',
    'fc-faq 冻成 Custom HTML（label 是给的名字），fc-home 原样', JSON.stringify({ fcFaq, fcHome }).slice(0, 300));
  check(fo.summary === 'Kept the Old C block as it was', `summary 用给的名字（${JSON.stringify(fo.summary)}）`);
  const fzAll = siteJs(['freeze', '--site', site, '--type', 'fake-c', '--rendered', only], noC);
  const fa = fzAll.lines[fzAll.lines.length - 1] || {};
  check(fzAll.status === 0 && (fa.frozen || []).sort().join() === 'fc-faq,fc-home' && fa.label === 'Fake c', `不给 --ids ⟹ 两块都冻；类型已删、不给 --label ⟹ 名字退回 humanize（${JSON.stringify(fa.label)}）`, fzAll.stderr.slice(-300));
  const emptyDir = fs.mkdtempSync(path.join(dir, 'empty-'));
  const fzMiss = siteJs(['freeze', '--site', site, '--type', 'fake-c', '--rendered', emptyDir], noC);
  const fm = fzMiss.lines[fzMiss.lines.length - 1] || {};
  check(fzMiss.status === 3 && fm.ok === false && /fc-home/.test(fm.message || ''), `--rendered 里没有那几块 ⟹ 整个拒（rc=${fzMiss.status}，${fm.message}）`);

  // ── ③ 先迁后冻 ──────────────────────────────────────────────────────────────────────────────
  console.log('③ noC 的表里有 fake-c→fake-b：true ⟹ 直接画成 B；false ⟹ 照旧 3；写库那一笔不跑它');
  const lookTrue = fakeBlocksDir(['fake-a', 'fake-b'], cToB(true));
  const lookFalse = fakeBlocksDir(['fake-a', 'fake-b'], cToB(false));
  const mt = render(lookTrue, bundleNoC);
  const mtHtml = mt.r.status === 0 ? fs.readFileSync(path.join(mt.out, 'index.html'), 'utf-8') : '';
  const ms = mtHtml && sectionOf(mtHtml, 'fc-home');
  check(mt.r.status === 0 && ms && /\sdata-block="fake-b"/.test(ms.open) && ms.inner.includes('Kept home') && !(mt.r.lines.at(-1) || {}).frozen,
    `preservesLook: true ⟹ 渲染成功、fc-home 画成 fake-b、文字还在、没冻（rc=${mt.r.status}）`, mt.r.stderr.slice(-300) || (ms && ms.open));
  const mf = render(lookFalse, bundleNoC);
  check(mf.r.status === 3 && /unknown block type fake-c/.test(mf.r.stderr), `preservesLook: false ⟹ 照旧退出码 3（不替老板换样子，rc=${mf.r.status}）`);
  {
    process.env.AI1ST_BLOCKS_DIR = lookTrue.blocksDir;
    process.env.AI1ST_REGISTRY_PATH = lookTrue.registryPath;
    const bm = require('./block-migrations');
    const c = fixture();
    const touched = bm.migrateTouched(c, ['en/pages/home.json']);
    const mem = bm.migrateInMemory(c);
    check(!touched['en/pages/home.json'], '写库那一笔（migrateTouched）不跑已删类型那一步');
    check(blockOf(mem['en/pages/home.json'], 'fc-home').type === 'fake-b' && blockOf(mem['en/pages/home.json'], 'fc-home').schemaVersion === 3,
      '读的时候（migrateInMemory）跑：fake-c → fake-b、版本号写成 fake-b 的当前版（3）');
    delete process.env.AI1ST_BLOCKS_DIR;
    delete process.env.AI1ST_REGISTRY_PATH;
  }

  // ── ④ --freeze-from 形状 ─────────────────────────────────────────────────────────────────────
  console.log('④ --freeze-from 形状不对 ⟹ 整跑拒（退出码 1）');
  for (const [why, v] of [['不是数组', { type: 'fake-c' }], ['ids 空', [{ type: 'fake-c', rendered: only, ids: [] }]],
    ['type 是 custom-html', [{ type: 'custom-html', rendered: only, ids: ['x'] }]], ['rendered 带 ..', [{ type: 'fake-c', rendered: `${only}/../x`, ids: ['fc-home'] }]]]) {
    const r = render(noC, bundleNoC, ['--freeze-from', writeJSON(dir, 'bad.json', clone(v))]);
    check(r.r.status === 1 && /--freeze-from/.test(r.r.stderr), `${why} ⟹ 1（rc=${r.r.status}）`, r.r.stderr.slice(-200));
  }

  console.log(`\n${failed ? '🔴' : '✅'} block-self-heal：${passed} 过 / ${failed} 不过`);
  process.exit(failed ? 1 : 0);
}

try { main(); } catch (e) { console.log(`⛔ 跑不起来：${e && e.stack ? e.stack : e}`); process.exit(2); }
