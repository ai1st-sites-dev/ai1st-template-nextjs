#!/usr/bin/env node
/**
 * link-href.test.js — #1416：老板填的链接只收那几种地址（判据 `scripts/lib/link-href.js`）。
 *
 *   node scripts/link-href.test.js     （由 `npm run test:scripts` 自动发现）
 *   退出码: 0 全过 · 1 有失败 · 2 跑不起来（**不许当成通过**）
 *
 * 管编辑器那两条写入路径（真进程、真站）：
 *   · 块的链接槽位   → `write-page.js`，以及 `write-editor-save.js` 带页面的那一支（两者共用 `lib/page-write.js`）
 *   · 公告条链接     → `write-editor-save.js` 的 root `topbarLink`（`lib/editor-root.js` → navigation.json）
 * 第三条路（AI 对话，`edit-site.js`）在 `lib/edit-site-chain.test.js` ⑮ —— 它要那边那套假模型钩子。
 *
 * 🔴 判「被拒」看三样：退出码 11、stdout 那一行 `{"ok":false,"message"}`（worker 从这里取给老板的话）、
 *    站文件逐字节不变。只看退出码的话，「拒了但已经写了一半」也是绿的。
 * 夹具用 skipAI 建站路造真站（同 `write-page.test.js` 的理由）。
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

const BAD = ['javascript:alert(1)', 'vbscript:msgbox(1)', 'data:text/html,<script>alert(1)</script>'];
const GOOD = ['https://example.com', 'mailto:a@b.com', 'tel:+15551234', '/contact'];

function makeSite() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'link-href-'));
  temps.push(root);
  const work = path.join(root, 'nextjs');
  cp.execSync(`cp -a --no-dereference "${NEXT}" "${work}"`, { stdio: 'pipe' });
  for (const junk of ['out', '.next', '.out-backup', '.out-temp', 'site', 'node_modules']) {
    fs.rmSync(path.join(work, junk), { recursive: true, force: true });
  }
  fs.symlinkSync(path.join(NEXT, 'node_modules'), path.join(work, 'node_modules'));
  const r = cp.spawnSync(process.execPath, [path.join(work, 'scripts', 'create-site.js')], {
    input: JSON.stringify({ siteId: 'lhtest01', companyName: 'Northside Auto Care', industry: 'auto repair', location: 'Toronto', skipAI: true, language: 'en' }),
    cwd: work, encoding: 'utf8', env: { ...process.env, ANTHROPIC_API_KEY: undefined }, timeout: 180000,
  });
  if (!fs.existsSync(path.join(work, 'site', 'en', 'pages', 'home.json'))) die(`夹具立不起来（rc=${r.status}）\n${(r.stderr || '').slice(-600)}`);
  return work;
}

const sha = (p) => crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');
const read = (p) => JSON.parse(fs.readFileSync(p, 'utf-8'));

function run(work, script, loc, stdin) {
  const r = cp.spawnSync(process.execPath, [path.join(work, 'scripts', script), JSON.stringify(loc)], {
    cwd: work, input: JSON.stringify(stdin), encoding: 'utf8', timeout: 60000,
  });
  const last = (r.stdout || '').trim().split('\n').pop() || '';
  let line = null;
  try { line = JSON.parse(last); } catch { line = null; }
  return { rc: r.status, line, err: (r.stderr || '').trim() };
}

/** 判一次「被拒」：rc=11 + stdout 那行带点名的话 + 列出的文件逐字节不变。 */
function expectRefused(name, r, files, before) {
  const msg = r.line && r.line.ok === false ? String(r.line.message || '') : '';
  const same = files.every((f, i) => fs.readFileSync(f, 'utf-8') === before[i]);
  check(r.rc === 11 && /not an address a link can use/.test(msg) && same,
    `${name} → exit 11、stdout 有给老板的话、站文件逐字节不变`,
    `rc=${r.rc} message=${JSON.stringify(msg.slice(0, 120))} 文件不变=${same} ${r.err.slice(0, 160)}`);
}

// ══ ① 判据本身 ══════════════════════════════════════════════════════════════════════════════════
console.log('① hrefAllowed：放行 / 拒收');
{
  const { hrefAllowed } = require(path.join(NEXT, 'scripts', 'lib', 'link-href.js'));
  const allow = [...GOOD, 'http://x.example', 'HTTPS://X.EXAMPLE', 'Mailto:a@b.com', '/', '/services/brakes?x=1#y', ''];
  const reject = [
    ...BAD, 'JaVaScRiPt:alert(1)', ' javascript:alert(1)', 'java\tscript:alert(1)', 'java\nscript:alert(1)',
    'file:///etc/passwd', 'ftp://x.example', '//evil.example', '/\\evil.example', '/\t/evil.example',
    '#contact', 'contact', ' https://example.com', 'https://example.com ',
  ];
  for (const h of allow) check(hrefAllowed(h) === true, `放行 ${JSON.stringify(h)}`);
  for (const h of reject) check(hrefAllowed(h) === false, `拒收 ${JSON.stringify(h)}`);
}

// ══ ② 守卫：判据认得的「链接」跟块清单对得上 ═══════════════════════════════════════════════════
console.log('② 块清单那一侧');
{
  const { loadManifests } = require(path.join(NEXT, 'scripts', 'lib', 'block-manifest.js'));
  const { NAV_LINKS } = require(path.join(NEXT, 'scripts', 'lib', 'link-href.js'));
  const m = loadManifests();
  const linkSlots = [];
  for (const [type, man] of m) for (const [slot, s] of Object.entries(man.slots || {})) if (s && s.kind === 'link') linkSlots.push({ type, slot, s });
  check(linkSlots.length >= 7, `块清单里 kind=link 的槽位 ${linkSlots.length} 个（票上量的是 7 个）`);
  for (const n of NAV_LINKS) {
    const s = m.get(n.block) && m.get(n.block).slots && m.get(n.block).slots[n.slot];
    check(Boolean(s && s.kind === 'link'), `NAV_LINKS 的 ${n.key.join('.')} 对得上 blocks/${n.block} 的 link 槽位 ${n.slot}`);
  }
  // 🔴 检查器那个入口的哨兵（lib/link-href.js 文件头）：`patch-block.js` 能改哪些字由 `editLabel` 定。哪个 link
  //    槽位的 `editLabel` 一旦点名 `href`，检查器那条路就写得到链接地址了，而它今天不过这道判据。
  const opened = linkSlots.filter(({ s }) => typeof s.editLabel === 'string'
    || (s.editLabel && typeof s.editLabel === 'object' && Object.prototype.hasOwnProperty.call(s.editLabel, 'href')));
  check(opened.length === 0, '没有一个 link 槽位让检查器改得到 href（否则 patch-block.js 要先接进 lib/link-href.js）',
    opened.map(({ type, slot }) => `${type}.${slot}`).join(', '));
}

const work = makeSite();
const home = path.join(work, 'site', 'en', 'pages', 'home.json');
const nav = path.join(work, 'site', 'en', 'navigation.json');
const heroOf = (page) => page.blocks.find((b) => b.type === 'hero');
if (!heroOf(read(home)) || !heroOf(read(home)).data.ctaPrimary) die('夹具的首页没有带 ctaPrimary 的 hero，这张表没有对象可验');

/** 首页 hero 的主按钮改成 `href`，其余原样。 */
function homeWith(href, slot = 'ctaPrimary') {
  const page = read(home);
  heroOf(page).data[slot] = { label: 'Book now', href };
  return page;
}

// ══ ③ 块的链接槽位：三种协议各拒一次（两个脚本都走 lib/page-write.js）══════════════════════════════
console.log('③ 块的链接槽位：write-page.js / write-editor-save.js');
for (const href of BAD) {
  const before = [fs.readFileSync(home, 'utf-8')];
  expectRefused(`write-page.js ${href.split(':')[0]}:`, run(work, 'write-page.js', { page: 'home', locale: 'en', baseHash: sha(home) }, homeWith(href)), [home], before);
  expectRefused(`write-editor-save.js（带页面）${href.split(':')[0]}:`, run(work, 'write-editor-save.js', { page: 'home', locale: 'en', baseHash: sha(home) }, { page: homeWith(href) }), [home], before);
}

// ══ ④ 公告条链接：三种协议各拒一次 ════════════════════════════════════════════════════════════════
console.log('④ 公告条链接：write-editor-save.js 的 root.topbarLink');
for (const href of BAD) {
  const before = [fs.readFileSync(nav, 'utf-8')];
  expectRefused(`topbarLink ${href.split(':')[0]}:`, run(work, 'write-editor-save.js', { page: 'home', locale: 'en' },
    { root: { topbarMessage: 'Open Saturday', topbarLink: { label: 'Details', href } } }), [nav], before);
}

// ══ ⑤ 合法的照收，值逐字不变 ══════════════════════════════════════════════════════════════════════
console.log('⑤ 合法的四种：两条路都照收、逐字落盘');
for (const href of GOOD) {
  const r = run(work, 'write-page.js', { page: 'home', locale: 'en', baseHash: sha(home) }, homeWith(href));
  check(r.rc === 0 && heroOf(read(home)).data.ctaPrimary.href === href, `块链接 ${href} → rc=0、落盘逐字相同`, `rc=${r.rc} ${r.err.slice(0, 160)}`);
  const t = run(work, 'write-editor-save.js', { page: 'home', locale: 'en' }, { root: { topbarMessage: 'Open Saturday', topbarLink: { label: 'Details', href } } });
  const got = fs.existsSync(nav) && read(nav).topbar && read(nav).topbar.link;
  check(t.rc === 0 && got && got.href === href, `公告条链接 ${href} → rc=0、落盘逐字相同`, `rc=${t.rc} ${t.err.slice(0, 160)}`);
}

// ══ ⑥ 老数据不炸：文件里本来就有一个不合规的链接 ══════════════════════════════════════════════════
console.log('⑥ 老数据：不碰它照常存，碰到它被拒并点名');
{
  // 页面：直接在磁盘上放一个老的坏链接（模拟本票之前存进去的）。
  const page = homeWith('vbscript:legacy()', 'ctaSecondary');
  fs.writeFileSync(home, `${JSON.stringify(page, null, 2)}\n`);
  const edited = read(home);
  heroOf(edited).data.headline = 'Only the headline changed 1416';
  const r1 = run(work, 'write-page.js', { page: 'home', locale: 'en', baseHash: sha(home) }, edited);
  check(r1.rc === 0 && heroOf(read(home)).data.headline === 'Only the headline changed 1416', '页面：只改标题 → rc=0（老坏链接原样留着）', `rc=${r1.rc} ${r1.err.slice(0, 160)}`);
  const before = [fs.readFileSync(home, 'utf-8')];
  const r2 = run(work, 'write-page.js', { page: 'home', locale: 'en', baseHash: sha(home) }, homeWith('data:text/html,x', 'ctaSecondary'));
  expectRefused('页面：把那个坏链接改成另一个坏的', r2, [home], before);
  check(/"Book now"/.test((r2.line && r2.line.message) || '') && /Hero Section/.test((r2.line && r2.line.message) || ''), '拒收的话点名了是哪个按钮、哪个块', r2.line && r2.line.message);
  const r3 = run(work, 'write-page.js', { page: 'home', locale: 'en', baseHash: sha(home) }, homeWith('/contact', 'ctaSecondary'));
  check(r3.rc === 0, '页面：把它改成合法的 → rc=0', `rc=${r3.rc}`);

  // 公告条：navigation.json 里本来就有一个坏链接，只改公告文字 → 照常；改链接成另一个坏的 → 拒。
  const n = read(nav);
  n.topbar = { message: 'Old', link: { label: 'Old link', href: 'javascript:legacy()' } };
  fs.writeFileSync(nav, JSON.stringify(n, null, 2));
  const t1 = run(work, 'write-editor-save.js', { page: 'home', locale: 'en' }, { root: { topbarMessage: 'New text 1416' } });
  check(t1.rc === 0 && read(nav).topbar.message === 'New text 1416' && read(nav).topbar.link.href === 'javascript:legacy()',
    '公告条：只改文字 → rc=0（老坏链接原样留着）', `rc=${t1.rc} ${t1.err.slice(0, 160)}`);
  const nb = [fs.readFileSync(nav, 'utf-8')];
  const t2 = run(work, 'write-editor-save.js', { page: 'home', locale: 'en' }, { root: { topbarLink: { label: 'Old link', href: 'vbscript:x' } } });
  expectRefused('公告条：把那个坏链接改成另一个坏的', t2, [nav], nb);
  check(/announcement bar/.test((t2.line && t2.line.message) || ''), '拒收的话点名了公告条', t2.line && t2.line.message);
}

// ══ ⑦ 页面 + 外壳一起存：外壳的链接被拒 ⟹ 页面也一个字节不写（所有校验先于所有写入）═════════════
console.log('⑦ 一次存盘里页面是好的、公告条链接是坏的 ⟹ 两份都不写');
{
  const before = [fs.readFileSync(home, 'utf-8'), fs.readFileSync(nav, 'utf-8')];
  const page = read(home);
  heroOf(page).data.headline = 'Would be written 1416';
  const r = run(work, 'write-editor-save.js', { page: 'home', locale: 'en', baseHash: sha(home) },
    { page, root: { topbarLink: { label: 'x', href: 'data:text/html,x' } } });
  expectRefused('页面好 + 链接坏', r, [home, nav], before);
}

// ══ ⑧ #1430：块多带一个字符串 ref 键 —— 编辑器存页面那条路照样查它自己的 data ═════════════════════════
// 修之前这一格是 exit 9（构建试跑说「ref 和 type 同时写了」）而不是 11：链接那一关整块跳过了它。
console.log('⑧ 页面里的块带 ref 又带自己的 data（#1430）：链接照样查');
for (const href of BAD) {
  const before = [fs.readFileSync(home, 'utf-8')];
  const page = homeWith(href);
  heroOf(page).ref = 'whatever';
  expectRefused(`write-page.js 带 ref 的块 ${href.split(':')[0]}:`, run(work, 'write-page.js', { page: 'home', locale: 'en', baseHash: sha(home) }, page), [home], before);
  expectRefused(`write-editor-save.js 带 ref 的块 ${href.split(':')[0]}:`, run(work, 'write-editor-save.js', { page: 'home', locale: 'en', baseHash: sha(home) }, { page }), [home], before);
}

// ══ ⑨ #1430：要写的那份顶层是 JSON 数组 —— §commitWrites 不许整份跳过 ═══════════════════════════════════
// 今天没有写入方会产出顶层数组；#1427 承诺「新写入方不用记得接线」，这一类正好是它按构造看不见的。
console.log('⑨ commitWrites：顶层是数组的一份里埋一个坏链接 → 拒、不落盘；合法的照写');
{
  const pw = require(path.join(work, 'scripts', 'lib', 'page-write.js'));
  const file = path.join(work, 'site', 'en', 'blocks', 'promos-1430.json');
  fs.mkdirSync(path.dirname(file), { recursive: true }); // skipAI 建的站没有 blocks/ 目录
  const doc = (href) => `${JSON.stringify([{ id: 'spring', block: { type: 'cta-banner', data: { headline: 'Spring', button: { label: 'Go', href } } } }], null, 2)}\n`;
  for (const href of BAD) {
    let err = null;
    try { pw.commitWrites([{ file, content: doc(href) }]); } catch (e) { err = e; }
    check(err instanceof pw.PageWriteError && err.code === pw.REFUSED && /"Go"/.test(err.message) && !fs.existsSync(file),
      `顶层数组 ${href.split(':')[0]}: → PageWriteError(REFUSED)、点名 "Go"、文件没落盘`, err ? `${err.code} ${String(err.message).slice(0, 100)}` : '没抛');
  }
  for (const href of GOOD) {
    let err = null;
    try { pw.commitWrites([{ file, content: doc(href) }]); } catch (e) { err = e; }
    const got = fs.existsSync(file) ? read(file)[0].block.data.button.href : null;
    check(!err && got === href, `顶层数组 ${href} → 照写、落盘逐字相同`, err ? String(err.message).slice(0, 100) : JSON.stringify(got));
  }
  // 老数据：数组里本来就有的坏链接，这次只改别的字 → 照写
  fs.writeFileSync(file, doc('vbscript:legacy()'));
  const legacy = read(file);
  legacy[0].block.data.headline = 'Only the headline 1430';
  let err = null;
  try { pw.commitWrites([{ file, content: `${JSON.stringify(legacy, null, 2)}\n` }]); } catch (e) { err = e; }
  check(!err && read(file)[0].block.data.headline === 'Only the headline 1430', '顶层数组：老坏链接没碰 → 照写', err && err.message);
  fs.rmSync(file, { force: true });
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
