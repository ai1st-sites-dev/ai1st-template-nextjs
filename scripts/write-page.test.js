#!/usr/bin/env node
/**
 * write-page.test.js — #1409：编辑器存盘的那两段站内代码。
 *
 *   node scripts/write-page.test.js     （由 `npm run test:scripts` 自动发现）
 *   退出码: 0 全过 · 1 有失败 · 2 跑不起来（**不许当成通过**）
 *
 * 管两个文件：
 *   · `scripts/write-page.js` —— 容器里把整份页面 JSON 写回文件的那一步（worker 调它）
 *   · `scripts/lib/editor-page.js` —— 编辑器页构建时找「画布上的 hero 是原始 JSON 里哪一条」
 *
 * 夹具用仓里那条 skipAI 建站路造真站（同 `lib/site-shape.test.js` 的理由：手搓最小 JSON 在 #1103 上塌过）。
 * 扁平站由多语言站转出来（今天没有建站路会产出扁平站，`site-shape.test.js` 文件头写了为什么这样算数）。
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

function makeSite(label, flat) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), `write-page-${label}-`));
  temps.push(root);
  const work = path.join(root, 'nextjs');
  cp.execSync(`cp -a --no-dereference "${NEXT}" "${work}"`, { stdio: 'pipe' });
  for (const junk of ['out', '.next', '.out-backup', '.out-temp', 'site', 'node_modules']) {
    fs.rmSync(path.join(work, junk), { recursive: true, force: true });
  }
  fs.symlinkSync(path.join(NEXT, 'node_modules'), path.join(work, 'node_modules'));
  const r = cp.spawnSync(process.execPath, [path.join(work, 'scripts', 'create-site.js')], {
    input: JSON.stringify({ siteId: 'wptest01', companyName: 'Northside Auto Care', industry: 'auto repair', location: 'Toronto', skipAI: true, language: 'en' }),
    cwd: work, encoding: 'utf8', env: { ...process.env, ANTHROPIC_API_KEY: undefined }, timeout: 180000,
  });
  const site = path.join(work, 'site');
  if (!fs.existsSync(path.join(site, 'en', 'pages', 'home.json'))) die(`夹具立不起来（rc=${r.status}）\n${(r.stderr || '').slice(-600)}`);
  if (flat) {
    for (const e of fs.readdirSync(path.join(site, 'en'))) fs.renameSync(path.join(site, 'en', e), path.join(site, e));
    fs.rmSync(path.join(site, 'en'), { recursive: true });
    fs.rmSync(path.join(site, 'site_meta.json'));
  }
  return work;
}

const sha = (p) => crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');

/** 找到这一页的文件（跟 write-page.js 同一份实现），拿不到就回 null。 */
function fileOf(work, loc) {
  const { readSiteShape } = require(path.join(work, 'scripts', 'lib', 'site-shape.js'));
  const { readPagesRecursive } = require(path.join(work, 'scripts', 'lib', 'page-files.js'));
  const shape = readSiteShape(path.join(work, 'site'));
  const dir = shape.flat ? path.join(work, 'site', 'pages') : path.join(work, 'site', loc.locale || 'en', 'pages');
  if (!fs.existsSync(dir)) return null;
  const m = new Map();
  readPagesRecursive(dir, '', [], m);
  return m.get(loc.page) || null;
}

/**
 * 调一次 write-page.js。`loc.baseHash` 没写时默认带**当前文件**的 sha256（= 编辑器底稿就是当前文件，
 * 正常路径）；要测过期 / 缺失时显式传。
 */
function write(work, loc, json) {
  if (!Object.prototype.hasOwnProperty.call(loc, 'baseHash')) {
    const f = fileOf(work, loc);
    loc = { ...loc, baseHash: f ? sha(f) : '0'.repeat(64) };
  }
  const r = cp.spawnSync(process.execPath, [path.join(work, 'scripts', 'write-page.js'), JSON.stringify(loc)], {
    cwd: work, input: typeof json === 'string' ? json : JSON.stringify(json), encoding: 'utf8', timeout: 60000,
  });
  return { rc: r.status, out: (r.stdout || '').trim(), err: (r.stderr || '').trim() };
}
const read = (p) => JSON.parse(fs.readFileSync(p, 'utf-8'));
const heroOf = (page) => (page.blocks || page.sections).find((b) => b.type === 'hero');

// ══ ① 多语言站：改 hero 标题 → 写回 site/en/pages/home.json ═══════════════════════════════════════
console.log('① 多语言站');
const multi = makeSite('multi', false);
{
  const file = path.join(multi, 'site', 'en', 'pages', 'home.json');
  const page = read(file);
  heroOf(page).data.headline = 'Brakes done right 1409';
  const r = write(multi, { page: 'home', locale: 'en' }, page);
  check(r.rc === 0, 'rc=0', `rc=${r.rc} ${r.err}`);
  check(JSON.parse(r.out || '{}').file === 'site/en/pages/home.json', '回报的文件是 site/en/pages/home.json', r.out);
  check(heroOf(read(file)).data.headline === 'Brakes done right 1409', '磁盘上那一行变了');
  check(fs.readFileSync(file, 'utf-8') === `${JSON.stringify(page, null, 2)}\n`, '格式是两空格缩进 + 结尾换行（跟建站脚本同形）');
  check(!fs.readdirSync(path.dirname(file)).some((f) => f.includes('.tmp-')), '没有留下临时文件');
  // #1415 —— 成功那一行带回写完之后文件字节的 sha256：编辑器拿它当下一次存盘的 baseHash。
  const got = JSON.parse(r.out || '{}').hash;
  check(got === sha(file), '回报的 hash = 写完之后文件字节的 sha256', `回报 ${got} · 实际 ${sha(file)}`);
  // 反向对照：这个 hash 拿去当下一次的 baseHash 真的通得过（它要是写之前那份的，这一次就是 exit 10）。
  const again = read(file);
  heroOf(again).data.headline = 'Second save without reopening 1415';
  const r2 = write(multi, { page: 'home', locale: 'en', baseHash: got }, again);
  check(r2.rc === 0, '拿回报的 hash 连存第二次 rc=0', `rc=${r2.rc} ${r2.err}`);
  const r3 = write(multi, { page: 'home', locale: 'en', baseHash: got }, again);
  check(r3.rc === 10, '再拿第一次的 hash 存第三次 ⟹ exit 10（它已经不是当前文件了）', `rc=${r3.rc}`);
}

// ══ ② 扁平站：同一件事写回 site/pages/home.json ══════════════════════════════════════════════════
console.log('② 扁平站');
const flat = makeSite('flat', true);
{
  const file = path.join(flat, 'site', 'pages', 'home.json');
  const page = read(file);
  heroOf(page).data.headline = 'Flat site headline 1409';
  // 扁平站没有语言目录：调用方就算带了 locale 也写根上那份（构建只读那一份）。
  const r = write(flat, { page: 'home', locale: 'en' }, page);
  check(r.rc === 0 && JSON.parse(r.out || '{}').file === 'site/pages/home.json', '扁平站写 site/pages/home.json', `rc=${r.rc} ${r.out} ${r.err}`);
  check(heroOf(read(file)).data.headline === 'Flat site headline 1409', '磁盘上那一行变了');
  check(!fs.existsSync(path.join(flat, 'site', 'en')), '没有凭空建出 site/en/');
}

// ══ ③ 顶层页面的文件名 ≠ slug：写进构建真读的那个文件 ═══════════════════════════════════════════
console.log('③ 文件名与 slug 不同的页面');
{
  const pages = path.join(multi, 'site', 'en', 'pages');
  fs.renameSync(path.join(pages, 'about.json'), path.join(pages, 'about-us.json'));
  const page = read(path.join(pages, 'about-us.json'));
  page.title = 'About (edited)';
  const r = write(multi, { page: 'about', locale: 'en' }, page);
  check(r.rc === 0 && JSON.parse(r.out || '{}').file === 'site/en/pages/about-us.json', '写的是 about-us.json（slug 取自内容）', `rc=${r.rc} ${r.out} ${r.err}`);
  check(!fs.existsSync(path.join(pages, 'about.json')), '没有照 slug 拼出一个构建不读的 about.json');
}

// ══ ④ 子目录里的页面 ════════════════════════════════════════════════════════════════════════════
console.log('④ 子目录页面');
{
  const dir = path.join(multi, 'site', 'en', 'pages', 'services');
  fs.mkdirSync(dir, { recursive: true });
  const src = read(path.join(multi, 'site', 'en', 'pages', 'quote.json'));
  delete src.slug;
  fs.writeFileSync(path.join(dir, 'brakes.json'), `${JSON.stringify(src, null, 2)}\n`);
  const page = { ...src, title: 'Brakes (edited)' };
  const r = write(multi, { page: 'services/brakes', locale: 'en' }, page);
  check(r.rc === 0 && JSON.parse(r.out || '{}').file === 'site/en/pages/services/brakes.json', '写回 services/brakes.json', `rc=${r.rc} ${r.out} ${r.err}`);
}

// ══ ⑤ 拒绝：每一种都一个字节不写 ════════════════════════════════════════════════════════════════
console.log('⑤ 拒绝的几种（文件逐字不变）');
{
  const file = path.join(multi, 'site', 'en', 'pages', 'home.json');
  const bytes = fs.readFileSync(file, 'utf-8');
  const page = read(file);
  const cases = [
    ['stdin 不是 JSON', { page: 'home', locale: 'en' }, '{not json', 5],
    ['既没有 blocks 也没有 sections', { page: 'home', locale: 'en' }, { slug: 'home', title: 'x' }, 5],
    ['改 slug', { page: 'home', locale: 'en' }, { ...page, slug: 'about' }, 5],
    ['slug 里有 ..', { page: '../x', locale: 'en' }, page, 5],
    ['没有这一页', { page: 'nope', locale: 'en' }, page, 4],
    ['没有这种语言', { page: 'home', locale: 'fr' }, page, 4],
    // 构建按「形状自相矛盾」抛错的那一类（blocks.js：同一个块既写 ref 又写 type）。📌 ref 指向不存在的
    // 块**不在**这一类：构建只打一行 note 然后跳过它，站照样建得出来 —— 所以那种页面这里也放行。
    ['一个块同时写 ref 和 type（构建会红）', { page: 'home', locale: 'en' }, { ...page, blocks: [...page.blocks, { ref: 'x', type: 'hero' }] }, 9],
    ['一个块既没有 type 也没有 ref（构建会红）', { page: 'home', locale: 'en' }, { ...page, blocks: [...page.blocks, { data: {} }] }, 9],
  ];
  for (const [name, loc, json, want] of cases) {
    const r = write(multi, loc, json);
    check(r.rc === want && fs.readFileSync(file, 'utf-8') === bytes, `${name} → exit ${want}、文件不变`, `rc=${r.rc} ${r.err.slice(0, 160)}`);
  }
  // #1409 QA2 r1 —— 底稿过期：编辑器打开之后别处改了这一页（这里用「文件末尾多一个换行」模拟一次别处的写入），
  // 编辑器拿旧底稿的 hash 来存 ⟹ exit 10、别处那次改动原样留着。
  const staleHash = sha(file);
  fs.writeFileSync(file, `${bytes}\n`);
  const other = fs.readFileSync(file, 'utf-8');
  const st = write(multi, { page: 'home', locale: 'en', baseHash: staleHash }, page);
  check(st.rc === 10 && fs.readFileSync(file, 'utf-8') === other, '底稿过期（别处改过这一页）→ exit 10、别处的改动原样留着', `rc=${st.rc} ${st.err.slice(0, 160)}`);
  const miss = write(multi, { page: 'home', locale: 'en', baseHash: undefined }, page);
  check(miss.rc === 5 && fs.readFileSync(file, 'utf-8') === other, '没带 baseHash → exit 5、文件不变（这道检查不许因为漏带就跳过）', `rc=${miss.rc}`);
  const bad = write(multi, { page: 'home', locale: 'en', baseHash: 'ABC' }, page);
  check(bad.rc === 5, 'baseHash 形状不对 → exit 5', `rc=${bad.rc}`);
  fs.writeFileSync(file, bytes);
  // 反向对照：同一份页面原样写回是 rc=0 —— 证明上面那些 exit 是被各自那一格挡下的，不是这个夹具本来就写不进去。
  const r = write(multi, { page: 'home', locale: 'en' }, page);
  check(r.rc === 0, '对照：原样写回 rc=0', `rc=${r.rc} ${r.err}`);
}

// ══ ⑥ editor-page.js：画布上的 hero 对应原始 JSON 的哪一条 ═════════════════════════════════════
console.log('⑥ editor-page.js');
{
  // 必须 require 夹具那一份：它按夹具的 cwd 读 site/。
  const { editorSource, locateInRaw } = require(path.join(multi, 'scripts', 'lib', 'editor-page.js'));
  const src = editorSource(multi, 'en', 'home');
  check(src.file === 'site/en/pages/home.json', `多语言站 file = site/en/pages/home.json`, JSON.stringify(src.file || src.error));
  check(src.baseHash === sha(path.join(multi, src.file)), 'baseHash = 那个文件字节的 sha256（write-page.js 拿同一个值比）', src.baseHash);
  const hero = heroOf(src.raw);
  const at = src.raw.blocks.indexOf(hero);
  const loc = locateInRaw(src.raw, src.siteBlocks, 'home', { id: hero.id, type: 'hero' });
  check(loc.writable && loc.at === at, `新 blocks 形状：按 id 找到第 ${at} 条且可写`, JSON.stringify(loc));

  const flatSrc = editorSource(flat, 'en', 'home');
  check(flatSrc.file === 'site/pages/home.json', '扁平站 file = site/pages/home.json', JSON.stringify(flatSrc.file || flatSrc.error));
  check(editorSource(multi, 'en', 'about').file === 'site/en/pages/about-us.json', '文件名与 slug 不同的页面也找得到');

  // 老 sections 形状：块 id 是构建时按下标现算的（blocks.js §generatedBlockId）。
  const legacy = { slug: 'home', sections: [{ type: 'features-grid', data: {} }, { type: 'hero', data: { headline: 'old' } }] };
  const l = locateInRaw(legacy, {}, 'home', { id: 'home-hero-1', type: 'hero' });
  check(l.writable && l.at === 1, '老 sections 形状：home-hero-1 → 下标 1', JSON.stringify(l));

  // 站级共用块：一条 {ref} —— 字住在 site-blocks.json，这里不可写。
  const lib = { 'shared-hero': { type: 'hero', data: { headline: 'shared' } } };
  const withRef = { slug: 'home', blocks: [{ ref: 'shared-hero' }] };
  const s = locateInRaw(withRef, lib, 'home', { id: 'shared-hero', type: 'hero' });
  check(!s.writable && s.reason === 'shared', '{ref} 条目不可写（reason=shared）', JSON.stringify(s));
  // 靠 visibility 注进来、这一页根本没有它的条目 —— 同样不可写。
  const lib2 = { 'shared-hero': { type: 'hero', visibility: ['home'], data: {} } };
  const v = locateInRaw({ slug: 'home', blocks: [] }, lib2, 'home', { id: 'shared-hero', type: 'hero' });
  check(!v.writable && v.reason === 'shared', 'visibility 注入的共用块不可写', JSON.stringify(v));
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
