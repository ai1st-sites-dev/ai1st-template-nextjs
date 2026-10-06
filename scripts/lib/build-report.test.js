#!/usr/bin/env node
/**
 * build-report.test.js — 建站报告（#1600）。
 *
 * 跑法:  node scripts/lib/build-report.test.js   （或 `npm run test:scripts`，它按文件名发现）
 * 退出码: 0 全过 · 1 有失败 · 2 跑不起来（**不许当成通过**）
 *
 * ① AC2 有来源的格子填真数：喂一份 seoPass 返回值（一页首查没过、重写后过；一个关键词页重写后仍没过被丢）
 *    + 一份 keyword-pages 报告（一个关键词页失败）⟹ 哪一页哪一条没过、N/M、修补数逐项对得上
 * ② AC2 没来源那一份：九个键都在，seo / repair / keywordPages / deadLinks 是 null（不是 0）
 * ③ 死链：数与 dead-links 事件一致；一个 html 都没看到（pages 0）是「没查」⟹ null，不是 0 条
 * ④ seoPass 跑两次（整站 + 代码补的详情页）⟹ 按 slug 合并、修补数累加
 * ⑤ scripts/finish-build-report.js：并进死链 + 耗时、打一行 build-report 事件；没有报告文件 ⟹ 什么都不打、rc 0
 */

'use strict';

const assert = require('assert');
const cp = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

let pass = 0;
let fail = 0;
const check = (name, fn) => {
  try { fn(); pass += 1; console.log(`  ✅ ${name}`); } catch (e) { fail += 1; console.log(`  ❌ ${name}\n     ${e.message}`); }
};
const die = (m) => { console.error(`🔴 跑不起来: ${m}`); process.exit(2); };

let br;
try { br = require('./build-report'); } catch (e) { die(e.stack || e.message); }

// seoPass 回来的形状（create-site.js §seoPass 的 `pages`）—— 问题文案照 seo-problems.js 的真前缀写。
const SEO_RESULT = {
  checked: 3,
  rewritten: 2,
  dropped: [{ slug: 'services/plumbing/emergency-plumber', keyword: 'emergency plumber', problems: ['[1 title] title 不含目标词「emergency plumber」：「Plumbing」'] }],
  fatalPages: [],
  pages: [
    { slug: 'home', targetKeyword: 'plumber toronto', rules: [1, 2, 3, 4, 5, 6, 7, 8], first: [], final: [], rewritten: false, outcome: 'pass' },
    { slug: 'services', targetKeyword: null, rules: [1, 2, 3, 5, 6, 8],
      first: ['[2 description] description 40 字，要 70–155 字', '[6 alt] 内容图 alt 为空：块 content（第 2 块）· image'],
      final: [], rewritten: true, outcome: 'fixed' },
    { slug: 'services/plumbing/emergency-plumber', targetKeyword: 'emergency plumber', rules: [1, 2, 3, 4, 5, 6, 7, 8],
      first: ['[1 title] title 不含目标词「emergency plumber」：「Plumbing」', '[7 H2] 要至少 2 个 H2 含目标词的词，这一页 3 个 H2 里有 0 个'],
      final: ['[1 title] title 不含目标词「emergency plumber」：「Plumbing」'], rewritten: true, outcome: 'dropped' },
  ],
};
const KW_REPORT = {
  total: 3, ok: 2,
  failed: [{ keyword: 'emergency plumber', slug: 'services/plumbing/emergency-plumber', problems: ['[1 title] title 不含目标词「emergency plumber」：「Plumbing」'] }],
  fallbackSlugs: [], similarity: [], addedServices: [],
};

console.log('── ① AC2：有来源的格子填真数');
const r1 = br.createReport({ path: 'ai' });
br.recordSeo(r1, SEO_RESULT);
br.recordKeywordPages(r1, KW_REPORT);
const bySlug = new Map(r1.seo.pages.map((p) => [p.slug, p]));
check('首查没过、重写后过的那一页：第 2、6 条是 fixed，没跑的第 4、7 条是 n/a，其余 pass', () => {
  assert.deepStrictEqual(bySlug.get('services').checks, { 1: 'pass', 2: 'fixed', 3: 'pass', 4: 'n/a', 5: 'pass', 6: 'fixed', 7: 'n/a', 8: 'pass' });
  assert.strictEqual(bySlug.get('services').outcome, 'fixed');
});
check('被丢掉的关键词页：第 1 条 fail（最后仍没过）、第 7 条 fixed（重写修好了）、outcome=dropped、问题原文带着', () => {
  const p = bySlug.get('services/plumbing/emergency-plumber');
  assert.strictEqual(p.checks[1], 'fail');
  assert.strictEqual(p.checks[7], 'fixed');
  assert.strictEqual(Object.values(p.checks).filter((c) => c === 'fail').length, 1);
  assert.strictEqual(p.outcome, 'dropped');
  assert.deepStrictEqual(p.problems, SEO_RESULT.pages[2].final);
});
check('一次就过的那一页：八条全 pass', () => {
  assert.ok(Object.values(bySlug.get('home').checks).every((c) => c === 'pass'), JSON.stringify(bySlug.get('home').checks));
});
check('修补：重写 2 / 共 3 页（= seoPass 的 rewritten / checked）', () => {
  assert.deepStrictEqual(r1.repair, { rewritten: 2, pages: 3 });
});
check('关键词页 N/M = 2/3，失败的词和 slug 对得上', () => {
  assert.deepStrictEqual([r1.keywordPages.ok, r1.keywordPages.total], [2, 3]);
  assert.deepStrictEqual(r1.keywordPages.failed.map((f) => [f.keyword, f.slug]), [['emergency plumber', 'services/plumbing/emergency-plumber']]);
});
check('反向对照：把那一页的 final 清空（= 重写修好了）⟹ 第 1 条从 fail 变 fixed（判据真看 final）', () => {
  const r = br.createReport();
  const pages = SEO_RESULT.pages.map((p) => (p.outcome === 'dropped' ? { ...p, final: [], outcome: 'fixed' } : p));
  br.recordSeo(r, { ...SEO_RESULT, pages });
  assert.strictEqual(r.seo.pages.find((p) => p.slug === 'services/plumbing/emergency-plumber').checks[1], 'fixed');
});

console.log('── ② AC2：全部没来源那一份');
const r0 = br.createReport({ path: 'skipAI' });
check('九个键都在', () => {
  assert.deepStrictEqual(Object.keys(r0).filter((k) => br.REPORT_KEYS.includes(k)).sort(), [...br.REPORT_KEYS].sort());
  assert.strictEqual(br.REPORT_KEYS.length, 9);
});
check('seo / repair / keywordPages / deadLinks 四格是 null，不是 0（其余五格同样 null）', () => {
  for (const k of br.REPORT_KEYS) {
    assert.strictEqual(r0[k], null, `${k} = ${JSON.stringify(r0[k])}`);
    assert.notStrictEqual(r0[k], 0, k);
  }
});
check('报告里没有站 id（库那一行的 site_id 是锚；JSON 里的副本会变成 #711 ID 迁移扫出来的旧 id 残留）', () => {
  assert.ok(!Object.keys(r0).some((k) => /^site_?id$/i.test(k)), Object.keys(r0).join(','));
});
check('写盘再读回：九个键仍都在（JSON 里 null 不会被丢）', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'br1600-'));
  try {
    br.writeReport(dir, r0);
    const back = JSON.parse(fs.readFileSync(path.join(dir, br.REPORT_FILE), 'utf8'));
    assert.deepStrictEqual(br.REPORT_KEYS.filter((k) => !(k in back)), []);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

console.log('── ③ 死链');
check('数与 dead-links 事件一致（deadCount），清单带 file / href', () => {
  const r = br.createReport();
  br.recordDeadLinks(r, { event: 'dead-links', outDir: '/x/out', pages: 7, checked: 40, deadCount: 2, dead: [{ file: 'index.html', href: '/quote' }, { file: 'a.html', href: '/blog' }] });
  assert.deepStrictEqual(r.deadLinks, { pages: 7, checked: 40, count: 2, dead: [{ file: 'index.html', href: '/quote' }, { file: 'a.html', href: '/blog' }] });
});
check('零死链是真的 0（查过了），不是 null', () => {
  const r = br.createReport();
  br.recordDeadLinks(r, { event: 'dead-links', pages: 5, checked: 30, deadCount: 0, dead: [] });
  assert.strictEqual(r.deadLinks.count, 0);
});
check('一个 html 都没看到（pages 0，脚本 rc=2）⟹ null，不是「0 条死链」', () => {
  const r = br.createReport();
  br.recordDeadLinks(r, { event: 'dead-links', pages: 0, checked: 0, deadCount: 0, dead: [] });
  assert.strictEqual(r.deadLinks, null);
});
check('清单截到前 100 条，数照记全量', () => {
  const r = br.createReport();
  const dead = Array.from({ length: 130 }, (_, i) => ({ file: `p${i}.html`, href: `/x${i}` }));
  br.recordDeadLinks(r, { event: 'dead-links', pages: 3, checked: 200, deadCount: 130, dead });
  assert.strictEqual(r.deadLinks.count, 130);
  assert.strictEqual(r.deadLinks.dead.length, br.DEAD_LIST_MAX);
});

console.log('── ④ seoPass 跑两次');
check('按 slug 合并、修补数累加', () => {
  const r = br.createReport();
  br.recordSeo(r, SEO_RESULT);
  br.recordSeo(r, { checked: 1, rewritten: 1, pages: [{ slug: 'services/drain', targetKeyword: 'drain', rules: [1, 2, 3, 4, 5, 6, 7, 8], first: ['[3 H1] 要恰好一个 H1，这一页有 0 个'], final: [], rewritten: true, outcome: 'fixed' }] });
  assert.strictEqual(r.seo.pages.length, 4);
  assert.deepStrictEqual(r.repair, { rewritten: 3, pages: 4 });
});

console.log('── ⑤ scripts/finish-build-report.js');
function finishTree() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'br1600-fin-'));
  fs.mkdirSync(path.join(root, 'scripts', 'lib'), { recursive: true });
  fs.mkdirSync(path.join(root, 'site'));
  fs.copyFileSync(path.join(__dirname, '..', 'finish-build-report.js'), path.join(root, 'scripts', 'finish-build-report.js'));
  fs.copyFileSync(path.join(__dirname, 'build-report.js'), path.join(root, 'scripts', 'lib', 'build-report.js'));
  return root;
}
check('并进死链 + 耗时，写回文件，stdout 恰好一行 build-report 事件（内容 = 文件）', () => {
  const root = finishTree();
  try {
    br.writeReport(path.join(root, 'site'), br.createReport({ path: 'skipAI' }));
    const dl = path.join(root, 'dl.json');
    fs.writeFileSync(dl, JSON.stringify({ event: 'dead-links', pages: 6, checked: 25, deadCount: 1, dead: [{ file: 'index.html', href: '/nope' }] }) + '\n');
    const start = Math.floor(Date.now() / 1000) - 90;
    const r = cp.spawnSync(process.execPath, [path.join(root, 'scripts', 'finish-build-report.js'), dl, String(start)], { encoding: 'utf8' });
    assert.strictEqual(r.status, 0, r.stderr);
    const lines = r.stdout.split('\n').filter(Boolean);
    assert.strictEqual(lines.length, 1, r.stdout);
    const ev = JSON.parse(lines[0]);
    assert.strictEqual(ev.event, 'build-report');
    assert.strictEqual(ev.report.deadLinks.count, 1);
    assert.ok(ev.report.durationSec >= 89 && ev.report.durationSec <= 120, String(ev.report.durationSec));
    assert.deepStrictEqual(JSON.parse(fs.readFileSync(path.join(root, 'site', br.REPORT_FILE), 'utf8')), ev.report);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});
check('没有死链文件（老站仓没有 check-dead-links.js）⟹ 照样发事件，死链那格 null', () => {
  const root = finishTree();
  try {
    br.writeReport(path.join(root, 'site'), br.createReport());
    const r = cp.spawnSync(process.execPath, [path.join(root, 'scripts', 'finish-build-report.js'), path.join(root, 'missing.json')], { encoding: 'utf8' });
    assert.strictEqual(r.status, 0);
    const ev = JSON.parse(r.stdout.trim());
    assert.strictEqual(ev.report.deadLinks, null);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});
check('没有报告文件（preview 模式 / 老站仓的 create-site）⟹ stdout 什么都没有、rc 0', () => {
  const root = finishTree();
  try {
    const r = cp.spawnSync(process.execPath, [path.join(root, 'scripts', 'finish-build-report.js')], { encoding: 'utf8' });
    assert.strictEqual(r.status, 0);
    assert.strictEqual(r.stdout, '');
    assert.ok(r.stderr.includes('#1600'), r.stderr);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
