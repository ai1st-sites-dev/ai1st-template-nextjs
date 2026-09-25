#!/usr/bin/env node
/**
 * editor-ai-history.test.js — #1410：AI 改完之后的撤销历史。撤销只退这一页的页面 JSON，共用块在任何一步历史里
 * 都是当前内容；撤销再 Save，网站上退回的是页面那一半。
 *
 *   node scripts/editor-ai-history.test.js     （由 `npm run test:scripts` 自动发现）
 *   退出码: 0 全过 · 1 有失败 · 2 跑不起来（**不许当成通过**）
 *
 * 走的是真链路里浏览器以外的每一段：
 *   底稿    `lib/editor-page.js` §editorBaseline（manager 经 docker exec 调的就是它）
 *   编辑器  `lib/editor-convert.js` §pageToPuck · §aiBaselineStep（EditorApp 收到 `reason: ai` 那一步调的就是它）
 *           · §puckToPage + §puckSharedChanges（EditorApp 存盘那两步）
 *   写盘    `scripts/write-editor-save.js`（worker 在站容器里跑的那个脚本，stdin 同形）
 *   AI      直接改磁盘上的文件 —— edit-site.js 改完就是这个样子，这里只关心它改完之后编辑器怎么接
 *
 * 「历史快照」的形状照 Puck 0.23 的 `History`（`{ state: { data, ui }, id }`）；撤销 = 取前一条的 `state.data`。
 * 反向对照在本文件里自己跑：同样的步骤不换共用块（旧实现的样子），读数必须红。
 */

'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const cp = require('child_process');

const NEXT = path.resolve(__dirname, '..');

let pass = 0; let fail = 0;
const ok = (m) => { pass += 1; console.log(`  ✅ ${m}`); };
const bad = (m) => { fail += 1; console.log(`  ❌ ${m}`); };
const check = (cond, m, detail) => (cond ? ok(m) : bad(detail ? `${m} —— ${detail}` : m));
function die(msg) { console.log(`💥 ${msg}`); process.exit(2); }

const temps = [];
process.on('exit', () => { for (const t of temps) fs.rmSync(t, { recursive: true, force: true }); });

let convert; let editorSchema; let catalogLib; let manifestLib;
try {
  convert = require('./lib/editor-convert.js');
  ({ editorSchema } = require('./lib/editor-schema.js'));
  catalogLib = require('./lib/block-catalog.js');
  manifestLib = require('./lib/block-manifest.js');
} catch (e) {
  die(`加载不起来：${e.message}`);
}
if (typeof convert.aiBaselineStep !== 'function') die('editor-convert.js 没有 aiBaselineStep');
const schema = editorSchema();
const manifests = manifestLib.loadManifests();
const sample = (type) => catalogLib.sampleDataFor(manifests.get(type));

function readJSON(p) { return JSON.parse(fs.readFileSync(p, 'utf-8')); }
function writeJSON(p, v) { fs.writeFileSync(p, `${JSON.stringify(v, null, 2)}\n`); }
const clone = (v) => JSON.parse(JSON.stringify(v));

// ── 夹具：skipAI 建一个单语真站，home 页 ref 一个共用 CTA ─────────────────────────────────────────
function makeTemplate() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'editor-ai-history-'));
  temps.push(root);
  const work = path.join(root, 'nextjs');
  cp.execSync(`cp -a --no-dereference "${NEXT}" "${work}"`, { stdio: 'pipe' });
  for (const junk of ['out', '.next', '.out-backup', '.out-temp', 'site', 'node_modules']) {
    fs.rmSync(path.join(work, junk), { recursive: true, force: true });
  }
  fs.symlinkSync(path.join(NEXT, 'node_modules'), path.join(work, 'node_modules'));
  const r = cp.spawnSync(process.execPath, [path.join(work, 'scripts', 'create-site.js')], {
    input: JSON.stringify({ siteId: 'aihist01', companyName: 'Northside Auto Care', industry: 'auto repair', location: 'Toronto', skipAI: true, language: 'en' }),
    cwd: work, encoding: 'utf8', env: { ...process.env, ANTHROPIC_API_KEY: undefined }, timeout: 180000,
  });
  const home = path.join(work, 'site', 'en', 'pages', 'home.json');
  if (!fs.existsSync(home)) die(`夹具立不起来（rc=${r.status}）\n${(r.stderr || '').slice(-600)}`);
  fs.mkdirSync(path.join(work, 'site', 'en', 'blocks'), { recursive: true });
  writeJSON(path.join(work, 'site', 'en', 'blocks', 'site-blocks.json'), {
    promo: { type: 'cta-banner', data: { ...sample('cta-banner'), headline: 'Promo before AI' } },
  });
  const page = readJSON(home);
  page.blocks.splice(1, 0, { ref: 'promo' });
  writeJSON(home, page);
  cp.execSync('git init -q && git add -A && git -c user.email=t@t -c user.name=t commit -qm fixture', { cwd: path.join(work, 'site') });
  return work;
}

const TEMPLATE = makeTemplate();
const SITE = path.join(TEMPLATE, 'site');
const HOME = path.join(SITE, 'en', 'pages', 'home.json');
const LIB = path.join(SITE, 'en', 'blocks', 'site-blocks.json');
const NAV = path.join(SITE, 'en', 'navigation.json');
const editorPage = require(path.join(TEMPLATE, 'scripts', 'lib', 'editor-page.js'));

function reset() { cp.execSync('git checkout -q -- . && git clean -qfd', { cwd: SITE }); }

function baseline() {
  const b = editorPage.editorBaseline({ rootDir: TEMPLATE, page: 'home', locale: 'en' });
  if (!b.ok) die(`底稿取不到：${b.reason} ${b.message}`);
  return b;
}
const toPuck = (b) => convert.pageToPuck({ raw: b.raw, blocks: b.blocks, located: b.located, schema, weights: b.weights, siteBlocks: b.siteBlocks });

/** 存盘：EditorApp §save 那两步 + 站里的写盘脚本。`base` = { raw, initial, hash, siteBlocks, own }。 */
function save(base, data) {
  const json = convert.puckToPage({ raw: base.raw, data, initial: base.initial, schema, slug: 'home', moved: [] });
  const shared = convert.puckSharedChanges({ data, initial: base.initial, siteBlocks: base.siteBlocks, schema, slug: 'home', own: base.own || {} });
  const input = { page: json };
  if (Object.keys(shared).length) input.shared = shared;
  const r = cp.spawnSync(process.execPath, [path.join(TEMPLATE, 'scripts', 'write-editor-save.js'), JSON.stringify({ page: 'home', locale: 'en', baseHash: base.hash })], {
    cwd: TEMPLATE, input: JSON.stringify(input), encoding: 'utf8', timeout: 60000,
  });
  return { status: r.status, stderr: r.stderr, json, shared };
}

const heroOf = (d) => d.content.find((c) => c.type === 'hero');
const promoOf = (d) => d.content.find((c) => c.props._src && c.props._src.shared === 'promo');
const withHero = (d, headline) => {
  const d2 = clone(d);
  heroOf(d2).props.headline = headline;
  return d2;
};
// 真的 Puck 快照里还有一份 `indexes`（节点索引，指向这份 data 里的对象）—— 这里也放一份，量「换了 data 的那条不许带着它」。
const snap = (data) => ({ state: { data, ui: {}, indexes: { nodes: {}, zones: {}, of: data } }, id: `h-${Math.random()}` });

/**
 * 同一段剧本：打开 → 手改 hero → 发 AI 之前先存 → AI 改磁盘（`ai` 决定改什么）→ 新底稿按 §aiBaselineStep 接进来。
 * `replace = false` 是反向对照：不换历史里的共用块（旧的做法）。
 */
function play(ai, { replace = true } = {}) {
  reset();
  const b0 = baseline();
  const data0 = toPuck(b0);
  const base = { raw: b0.raw, initial: data0, hash: b0.hash, siteBlocks: b0.siteBlocks };
  const data1 = withHero(data0, 'Hand edit');
  let histories = [snap(data0), snap(data1)];
  const before = histories;
  // 做什么 4：发给 AI 之前先存一次。存成功 → 编辑器手上的 hash 换成刚存下去那份（`reason: saved`）。
  const pre = save(base, data1);
  if (pre.status !== 0) die(`先存那一次没存上（rc=${pre.status}）：${pre.stderr.slice(-300)}`);
  const b1 = baseline();
  base.hash = b1.hash;
  ai();
  const b2 = baseline();
  const next = { ...toPuck(b2), root: data0.root };
  const step = convert.aiBaselineStep({ current: data1, histories, next, hash: base.hash, nextHash: b2.hash });
  if (replace) histories = step.histories;
  let canvas;
  if (step.record) {
    histories = [...histories, snap(next)];
    canvas = next;
  } else {
    canvas = replace ? step.current : data1;
  }
  const base2 = { raw: b2.raw, initial: next, hash: b2.hash, siteBlocks: b2.siteBlocks, own: {} };
  return { b0, b1, b2, step, histories, before, canvas, base: base2 };
}

const aiEditsPage = () => {
  const p = readJSON(HOME);
  p.blocks.find((x) => x && x.type === 'hero').data.subheadline = 'Written by AI';
  writeJSON(HOME, p);
};
const aiEditsShared = () => {
  const l = readJSON(LIB);
  l.promo.data.headline = 'Promo after AI';
  writeJSON(LIB, l);
};

// ══ ① AI 同时改了页面和共用块 ══════════════════════════════════════════════════════════════════
console.log('① AI 同时改了这一页和一个共用块：record 一步；撤销退页面那半，共用块不退');
{
  const r = play(() => { aiEditsPage(); aiEditsShared(); });
  check(r.step.record === true && r.step.pageChanged === true, '页面 JSON 的 hash 变了 ⟹ record', JSON.stringify({ record: r.step.record }));
  check(r.step.mixed === true && JSON.stringify(r.step.sharedIds) === '["promo"]', 'mixed = true、变了的共用块是 promo（状态栏要多说那一句）', JSON.stringify(r.step.sharedIds));
  check(r.histories.length === 3, `历史 3 步（打开 · 手改 · AI）`, String(r.histories.length));
  // 🔴 换了共用块的快照带着旧 indexes 的话，Puck 的 set 会跳过重建、顺着旧索引把这条快照原地改掉（e2e ⑧ 撤销退不回去）。
  const swapped = r.step.histories.filter((h, i) => h !== r.before[i]);
  check(swapped.length > 0 && swapped.every((h) => !('indexes' in h.state)), '换过共用块的快照都不带旧的 indexes（让 Puck 按新 data 重建）', `${swapped.length} 条换过`);
  check(r.step.histories.every((h, i) => h !== r.before[i] || 'indexes' in h.state), '没换的快照原样（indexes 留着）');
  const undone = r.histories[1].state.data;
  check(heroOf(undone).props.subheadline !== 'Written by AI' && heroOf(undone).props.headline === 'Hand edit', '撤销一步：画布上 AI 写的副标题没了、手改还在');
  check(promoOf(undone).props.headline === 'Promo after AI', '撤销一步：画布上共用块仍是 AI 的字（= 网站上的字）', promoOf(undone).props.headline);
  const s1 = save(r.base, undone);
  check(s1.status === 0, 'Save 被站里收下（baseHash 是 AI 改完那份）', `rc=${s1.status} ${s1.stderr.slice(-200)}`);
  check(Object.keys(s1.shared).length === 0, 'Save 不写块库（换进历史的共用块跟底稿比差 0）', JSON.stringify(s1.shared));
  check(JSON.stringify(readJSON(HOME)) === JSON.stringify(r.b1.raw), 'Save 之后 home.json = AI 之前那一版（先存的那份）');
  check(readJSON(LIB).promo.data.headline === 'Promo after AI', 'Save 之后块库里仍是 AI 的字 —— 要退它走聊天里的回退');
  const undone2 = r.histories[0].state.data;
  check(promoOf(undone2).props.headline === 'Promo after AI', '再撤销一步（手改那步）：共用块仍是当前的字');
}

// ══ ② 手改一次 → AI 只改共用块 ═════════════════════════════════════════════════════════════════
console.log('② AI 只改了注进这一页的共用块：不 record；历史长度不变；撤销手改时共用块也不退');
{
  const r = play(() => aiEditsShared());
  check(r.step.pageChanged === false && r.step.record === false, '页面 JSON 的 hash 没变 ⟹ 不 record');
  check(r.histories.length === 2, '历史长度不变（2 步）', String(r.histories.length));
  check(promoOf(r.canvas).props.headline === 'Promo after AI', '画布上那块的字换成了 AI 的（底稿换了）');
  check(heroOf(r.canvas).props.headline === 'Hand edit', '画布上的手改没被冲掉');
  const undone = r.histories[0].state.data;
  check(promoOf(undone).props.headline === 'Promo after AI', '撤销那次手改：共用块仍是 AI 的字', promoOf(undone).props.headline);
  const s = save(r.base, undone);
  check(s.status === 0 && Object.keys(s.shared).length === 0, '撤销后 Save：只写页面，不写块库', `rc=${s.status} ${JSON.stringify(s.shared)}`);
  check(JSON.stringify(readJSON(HOME)) === JSON.stringify(r.b0.raw), 'home.json 退回打开时那一版');
}

// ══ ③ AI 只改了别的文件（navigation.json）═══════════════════════════════════════════════════════
console.log('③ AI 只改了别的文件：不 record、历史原样（一条都没换）');
{
  const r = play(() => {
    const n = readJSON(NAV);
    n.footer = { ...(n.footer || {}), phone: '555-0199' };
    writeJSON(NAV, n);
  });
  check(r.step.record === false && r.step.sharedIds.length === 0, '不 record、没有共用块变化');
  check(r.histories.every((h, i) => h === r.step.histories[i]), '历史里每一条都是原来那个对象（没被换）');
}

// ══ ④ 反向对照：不换历史里的共用块 ═══════════════════════════════════════════════════════════════
console.log('④ 反向对照：同样的剧本不换共用块（旧做法）→ 撤销后画布上的共用块退回旧字，跟网站对不上');
{
  const r = play(() => { aiEditsPage(); aiEditsShared(); }, { replace: false });
  const undone = r.histories[1].state.data;
  check(promoOf(undone).props.headline === 'Promo before AI', '没换的话撤销一步，画布上共用块是旧字（= 这道守卫在旧实现上会红）', promoOf(undone).props.headline);
}

console.log(`\n══ 汇总: 通过 ${pass} · 失败 ${fail} ══`);
process.exit(fail ? 1 : 0);
