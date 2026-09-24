#!/usr/bin/env node
/**
 * publish-notice.test.js — #1408：发布前那句「没有联系表单了」的提示。
 *
 *   node scripts/publish-notice.test.js     （由 `npm run test:scripts` 自动发现）
 *   退出码: 0 全过 · 1 有失败 · 2 跑不起来（**不许当成通过**）
 *
 * 管两个文件：`scripts/publish-notice.js`（容器里 worker 调的那一步）和 `scripts/lib/contact-entry.js`（判据）。
 *
 * 夹具用仓里那条 skipAI 建站路造真站（同 `write-page.test.js` 的理由：手搓最小 JSON 在 #1103 上塌过），
 * 放进一个真 git 仓，「上一次发布」就是真打一个 `ai1st-published` tag —— 跟 worker 发布成功后做的是同一件事。
 * 脚本在夹具目录里跑（cwd = 夹具），manifest 读夹具自己的 `blocks/`（从模板拷一份），所以「库里临时加一个
 * contact 类的块」那一格只动夹具，不碰模板。
 */

'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const cp = require('child_process');

const NEXT = path.resolve(__dirname, '..');
const SCRIPT = path.join(__dirname, 'publish-notice.js');
const TAG = 'ai1st-published';

let pass = 0; let fail = 0;
const ok = (m) => { pass += 1; console.log(`  ✅ ${m}`); };
const bad = (m) => { fail += 1; console.log(`  ❌ ${m}`); };
const check = (cond, m, detail) => (cond ? ok(m) : bad(detail ? `${m} —— ${detail}` : m));
function die(msg) { console.log(`💥 ${msg}`); process.exit(2); }

const temps = [];
process.on('exit', () => { for (const t of temps) fs.rmSync(t, { recursive: true, force: true }); });

// ── 夹具 ────────────────────────────────────────────────────────────────────────────────────────
// 一次 skipAI 建站（约 0.3 秒），之后每一格拷一份。skipAI 站的页面（2026-09-23 现取）：
//   home: hero, features-grid, cta-banner, contact-form   contact: page-header, contact-form
//   quote: page-header, quote-form                        about / services: 没有入口块
const BASE = (() => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'publish-notice-base-'));
  temps.push(root);
  const work = path.join(root, 'nextjs');
  cp.execSync(`cp -a --no-dereference "${NEXT}" "${work}"`, { stdio: 'pipe' });
  for (const junk of ['out', '.next', '.out-backup', '.out-temp', 'site', 'node_modules']) {
    fs.rmSync(path.join(work, junk), { recursive: true, force: true });
  }
  fs.symlinkSync(path.join(NEXT, 'node_modules'), path.join(work, 'node_modules'));
  const r = cp.spawnSync(process.execPath, [path.join(work, 'scripts', 'create-site.js')], {
    input: JSON.stringify({ siteId: 'pntest01', companyName: 'Northside Auto Care', industry: 'auto repair', location: 'Toronto', skipAI: true, language: 'en' }),
    cwd: work, encoding: 'utf8', env: { ...process.env, ANTHROPIC_API_KEY: undefined }, timeout: 180000,
  });
  if (!fs.existsSync(path.join(work, 'site', 'en', 'pages', 'home.json'))) die(`夹具立不起来（rc=${r.status}）\n${(r.stderr || '').slice(-600)}`);
  return work;
})();

const git = (dir, ...args) => {
  const r = cp.spawnSync('git', args, { cwd: dir, encoding: 'utf8' });
  if (r.status !== 0) die(`git ${args.join(' ')} 失败：${r.stderr}`);
  return r.stdout.trim();
};

/** 一个新的站仓：blocks/ + site/，提交一次。 */
function makeRepo(label) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `publish-notice-${label}-`));
  temps.push(dir);
  cp.execSync(`cp -a "${path.join(BASE, 'blocks')}" "${path.join(BASE, 'site')}" "${dir}/"`);
  git(dir, 'init', '-q', '-b', 'main');
  git(dir, 'config', 'user.email', 't@example.com');
  git(dir, 'config', 'user.name', 't');
  commit(dir, 'init');
  return dir;
}
function commit(dir, msg) { git(dir, 'add', '-A'); git(dir, 'commit', '-q', '--allow-empty', '-m', msg); }
function publish(dir) { git(dir, 'tag', '-f', TAG, 'HEAD'); }

const pageFile = (dir, slug) => path.join(dir, 'site', 'en', 'pages', `${slug}.json`);
const readPage = (dir, slug) => JSON.parse(fs.readFileSync(pageFile(dir, slug), 'utf-8'));
const writePage = (dir, slug, p) => fs.writeFileSync(pageFile(dir, slug), JSON.stringify(p, null, 2));
/** 把整站某些类型的块从页面 JSON 里删掉（blocks 形状）。 */
function dropTypes(dir, types) {
  for (const f of fs.readdirSync(path.join(dir, 'site', 'en', 'pages'))) {
    const slug = f.replace(/\.json$/, '');
    const p = readPage(dir, slug);
    p.blocks = p.blocks.filter((b) => !types.includes(b.type));
    writePage(dir, slug, p);
  }
}
/** 整站只留一个指定类型的入口块（其余入口全删）。 */
function keepOnly(dir, type) {
  dropTypes(dir, ['contact-form', 'quote-form', 'contact-info', 'hero-with-form'].filter((t) => t !== type));
}
function addBlock(dir, slug, block) { const p = readPage(dir, slug); p.blocks.push(block); writePage(dir, slug, p); }
function setBrand(dir, fn) {
  const f = path.join(dir, 'site', 'brand.json');
  const b = JSON.parse(fs.readFileSync(f, 'utf-8')); fn(b); fs.writeFileSync(f, JSON.stringify(b, null, 2));
}
function writeSiteBlocks(dir, obj) {
  fs.mkdirSync(path.join(dir, 'site', 'en', 'blocks'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'site', 'en', 'blocks', 'site-blocks.json'), JSON.stringify(obj, null, 2));
}

function run(dir) {
  const r = cp.spawnSync(process.execPath, [SCRIPT], { cwd: dir, encoding: 'utf8' });
  const line = (r.stdout || '').trim().split('\n').pop();
  let j = null;
  try { j = JSON.parse(line); } catch { /* 下面判 */ }
  if (r.status !== 0 || !j) die(`脚本没跑出一行 JSON（rc=${r.status}）\nstdout=${r.stdout}\nstderr=${r.stderr}`);
  return j;
}

const LONG = 'After this publish your website has no contact form. Customers can only reach you through the email / phone in the footer.';

// ── ① 该出现时出现 ──────────────────────────────────────────────────────────────────────────────
console.log('① 删光全部收客入口后发布 → 提示出现');
{
  const d = makeRepo('gone'); publish(d);
  dropTypes(d, ['contact-form', 'quote-form', 'contact-info', 'hero-with-form']);
  const j = run(d);
  check(j.notice && j.notice.kind === 'no-contact-form', '有提示', JSON.stringify(j));
  check(j.notice && j.notice.message === LONG, '文案是那一句（提到页脚的邮箱 / 电话）', j.notice && j.notice.message);
  check(j.notice && !/any contact/i.test(j.notice.message), '不说「没有任何联系方式」');
  check(j.before === 3 && j.after === 0, `上一次 3 个入口、这次 0 个（读数 ${j.before} → ${j.after}）`);
}

console.log('① 页脚没有邮箱 / 电话时后半句不说；只有一样时只点那一样');
{
  const d = makeRepo('nofooter'); publish(d);
  dropTypes(d, ['contact-form', 'quote-form']);
  setBrand(d, (b) => { b.email = ''; b.locations = b.locations.map((l) => ({ ...l, phone: '' })); });
  check(run(d).notice?.message === 'After this publish your website has no contact form.', '两样都空：只说前半句');
  setBrand(d, (b) => { b.email = 'a@b.co'; });
  check(/through the email in the footer\.$/.test(run(d).notice?.message || ''), '只有邮箱：只说邮箱');
  setBrand(d, (b) => { b.email = ''; b.locations[0].phone = '416-555-0000'; });
  check(/through the phone number in the footer\.$/.test(run(d).notice?.message || ''), '只有电话：只说电话');
}

// ── ② 共用块也算 ────────────────────────────────────────────────────────────────────────────────
console.log('② contact-form 放成 visibility ["*"] 的共用块、页面 JSON 里没有它');
{
  const d = makeRepo('shared');
  dropTypes(d, ['contact-form', 'quote-form']);
  writeSiteBlocks(d, { 'shared-form': { type: 'contact-form', visibility: ['*'], data: { headline: 'Get in touch' } } });
  commit(d, 'form becomes a shared block'); publish(d);
  const p = readPage(d, 'home'); p.blocks = p.blocks.filter((b) => b.type !== 'cta-banner'); writePage(d, 'home', p);
  const j1 = run(d);
  check(j1.notice === null && j1.after > 0, `删页面上别的块 → 0 条提示（这次入口 ${j1.after} 个，全来自共用块）`, JSON.stringify(j1));
  writeSiteBlocks(d, {});
  const j2 = run(d);
  check(j2.notice && j2.notice.kind === 'no-contact-form', '从 site-blocks.json 删掉那个共用表单 → 提示出现', JSON.stringify(j2));
}

// ── ③ 判据是现算的 ──────────────────────────────────────────────────────────────────────────────
for (const [type, add] of [
  ['quote-form', null],
  ['contact-info', { type: 'contact-info', id: 'home-contact-info-9', data: { headline: 'Visit us' } }],
  ['hero-with-form', { type: 'hero-with-form', id: 'home-hero-with-form-9', data: { headline: 'Book a repair' } }],
]) {
  console.log(`③ 只有 ${type} 的站，删掉别的块再发布`);
  // 上一次发布那份是整站（contact-form + quote-form，再加上这一格要的那一块），这次删掉别的入口只留它。
  // 手写名单漏了它的话，这里就是 before > 0、after = 0 ⟹ 一条真的假提示（不只是数错）。
  const d = makeRepo(`only-${type}`);
  if (add) { addBlock(d, 'home', add); commit(d, `add ${type}`); }
  publish(d);
  keepOnly(d, type);
  const j = run(d);
  check(j.notice === null && j.after >= 1, `0 条提示（${type} 算作入口，这次 ${j.after} 个）`, JSON.stringify(j));
}

console.log('③ 库里临时加一个 category: contact 的块 → 自动算作入口，不改代码');
{
  const d = makeRepo('newcat');
  fs.mkdirSync(path.join(d, 'blocks', 'callback-request'));
  fs.writeFileSync(path.join(d, 'blocks', 'callback-request', 'manifest.json'),
    JSON.stringify({ type: 'callback-request', displayName: 'Callback Request', category: 'contact', roleDefault: 'essential', slots: {} }));
  addBlock(d, 'home', { type: 'callback-request', id: 'home-callback-request-9', data: {} });
  dropTypes(d, ['contact-form', 'quote-form']);
  commit(d, 'only the new contact block'); publish(d);
  const j1 = run(d);
  check(j1.notice === null && j1.before === 1 && j1.after === 1, '只有这个新块的站再发一次：0 条提示，它被数成 1 个入口', JSON.stringify(j1));
  dropTypes(d, ['callback-request']);
  const j2 = run(d);
  check(j2.notice && j2.notice.kind === 'no-contact-form', '删掉它 → 提示出现', JSON.stringify(j2));
}

console.log('③ 被藏起来的入口块不算（产物里不渲染）');
{
  const d = makeRepo('hidden'); publish(d);
  for (const slug of ['home', 'contact', 'quote']) {
    const p = readPage(d, slug);
    p.blocks = p.blocks.map((b) => (['contact-form', 'quote-form'].includes(b.type) ? { ...b, hidden: true } : b));
    writePage(d, slug, p);
  }
  const j = run(d);
  check(j.notice && j.after === 0, '全部入口都藏起来 → 提示出现', JSON.stringify(j));
}

// ── ④ 不该出现时不出现 ──────────────────────────────────────────────────────────────────────────
console.log('④ 不该出现时不出现');
{
  const d = makeRepo('first');
  dropTypes(d, ['contact-form', 'quote-form']);
  const j = run(d);
  check(j.notice === null && j.reason === 'no-marker', '首次发布（没有标记）0 条提示 —— 就算这次删光了表单', JSON.stringify(j));
}
{
  const d = makeRepo('text'); publish(d);
  const p = readPage(d, 'home'); p.blocks[0].data = { ...(p.blocks[0].data || {}), headline: 'Changed headline' }; writePage(d, 'home', p);
  const j = run(d);
  check(j.notice === null && j.before === j.after, '改一句文案后发布 0 条提示', JSON.stringify(j));
}
{
  const d = makeRepo('never');
  dropTypes(d, ['contact-form', 'quote-form']);
  commit(d, 'no entries'); publish(d);
  const p = readPage(d, 'home'); p.blocks = p.blocks.filter((b) => b.type !== 'cta-banner'); writePage(d, 'home', p);
  const j = run(d);
  check(j.notice === null && j.before === 0 && j.after === 0, '本来就没有收客入口的站再发一次 0 条提示', JSON.stringify(j));
}

// ── ⑤ 比的是标记那份，不是最后一个 commit ─────────────────────────────────────────────────────────
console.log('⑤ 发布一次 → 两次 AI 编辑（两个 commit）不发布 → 比的是标记那份');
{
  const d = makeRepo('marker'); publish(d);
  const tagged = git(d, 'rev-parse', `${TAG}^{commit}`);
  dropTypes(d, ['contact-form']); commit(d, 'AI edit 1');
  dropTypes(d, ['quote-form']); commit(d, 'AI edit 2');
  check(git(d, 'rev-parse', `${TAG}^{commit}`) === tagged, '两个 commit 之后标记没动');
  const j = run(d);
  check(j.marker === tagged, '脚本读的是标记那个 commit', `${j.marker} vs ${tagged}`);
  check(j.notice && j.before === 3, '比标记那份（3 个入口）→ 提示出现；拿最后一个 commit 比会是 0 → 0、不提示', JSON.stringify(j));
}

// ── 读不到就不说 ────────────────────────────────────────────────────────────────────────────────
console.log('读不到就不说（不许把「问不出来」当成「没有入口」）');
{
  const d = makeRepo('broken'); publish(d);
  git(d, 'tag', '-f', TAG, git(d, 'commit-tree', git(d, 'mktree', '--missing'), '-m', 'empty'));
  dropTypes(d, ['contact-form', 'quote-form']);
  const j = run(d);
  check(j.notice === null && j.reason === 'marker-unreadable', '标记那份里没有 site/ → 0 条提示', JSON.stringify(j));
}

console.log(`\n${pass} 过 / ${fail} 挂`);
process.exit(fail ? 1 : 0);
