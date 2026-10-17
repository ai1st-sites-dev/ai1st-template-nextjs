#!/usr/bin/env node
/**
 * site-render-unknown-blocks.test.js — #1826：`site.js render` 入口那一扫（不认识的块 ⟹ 不出产物）、`--only-blocks` 的输出合同、
 * `--out` / `--site` 的路径校验。
 *
 *   ① 五个夹具站一个都不误报（扫描的范围跟真站一致：页面块 + 老形状 sections + 共用块）
 *   ② 页面里塞一个 `type: "no-such-block"` ⟹ 退出码 3、标准错误那一行逐字、`--out` 没被建出来
 *   ③ 共用块（site-blocks.json）里的也扫得到；第二种错（schemaVersion 不在 renders 里）的措辞
 *   ④ `--only-blocks`：只出 `blocks/<语言>/<id>.html|.css|.attrs.json`、content 里有别的不认识的块照画、不编 Sass、
 *      多语言每种一份、找不到的 id ⟹ 退出码 1
 *   ⑤ `--out` / `--site` 带 `.` / `..` / 空段 ⟹ 拒（各一格）
 *   ⑥ 渲染层照旧静默跳过（扫描不许挪进 SectionRenderer：画布 / 图册 / 只读画布都用它）
 *
 * 跑法:  node scripts/site-render-unknown-blocks.test.js   （或 `npm run test:scripts`）
 * 退出码: 0 全过 · 1 有失败 · 2 跑不起来（不许当成通过）
 */
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

let pass = 0;
let fail = 0;
const check = (cond, m) => { if (cond) { pass += 1; console.log(`  ✅ ${m}`); } else { fail += 1; console.log(`  ❌ ${m}`); } };

const ROOT = path.resolve(__dirname, '..');
const FIXTURES = path.join(__dirname, 'fixtures', 'site-fixtures');
const fixture = (name) => JSON.parse(fs.readFileSync(path.join(FIXTURES, `${name}.json`), 'utf-8'));
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'site-unknown-blocks-test-'));
const BUNDLE = path.join(ROOT, 'render', 'dist', `test-unknown-${process.pid}`);
process.on('exit', () => { fs.rmSync(tmp, { recursive: true, force: true }); fs.rmSync(BUNDLE, { recursive: true, force: true }); });

let scan;
let renderBundle;
try {
  scan = require('./lib/content-blocks');
  renderBundle = require('./lib/render-bundle');
} catch (e) { console.error(`🔴 跑不起来: ${e.stack}`); process.exit(2); }

const SITE_JS = path.join(__dirname, 'site.js');
const writeSite = (name, content) => { const f = path.join(tmp, `${name}.json`); fs.writeFileSync(f, JSON.stringify(content)); return f; };
const run = (args) => spawnSync(process.execPath, [SITE_JS, 'render', ...args, '--bundle-dir', BUNDLE], { encoding: 'utf-8', timeout: 120000 });
const files = (dir, rel = '') => (fs.existsSync(path.join(dir, rel)) ? fs.readdirSync(path.join(dir, rel), { withFileTypes: true })
  .flatMap((e) => (e.isDirectory() ? files(dir, rel ? `${rel}/${e.name}` : e.name) : [rel ? `${rel}/${e.name}` : e.name])) : []);

(async () => {
  await renderBundle.buildRenderBundle({ outdir: BUNDLE });
  const known = scan.knownBlockTypes(ROOT);

  console.log('\n── ① 夹具站不误报');
  check(known.size >= 10 && !known.has('header') && !known.has('footer') && known.has('hero'), `认识的页面块 ${known.size} 种（外壳区 header / footer 不算）`);
  for (const name of ['site-0448c807', 'site-bbc4ff97', 'site-blog', 'site-multilang', 'site-rtl']) {
    const blocks = scan.contentBlocks(fixture(name));
    const problems = scan.unrenderableBlocks(fixture(name), known);
    check(blocks.length > 5 && problems.length === 0, `${name}：扫到 ${blocks.length} 个块，0 个画不出来`);
  }

  console.log('\n── ② 页面里有不认识的块 ⟹ 退出码 3、不出产物');
  const bad = fixture('site-bbc4ff97');
  bad['en/pages/home.json'] = { ...bad['en/pages/home.json'], blocks: [...bad['en/pages/home.json'].blocks] };
  bad['en/pages/home.json'].blocks.splice(1, 0, { id: 'zz-1', type: 'no-such-block', data: {} });
  const badFile = writeSite('bad', bad);
  const out2 = path.join(tmp, 'out-bad');
  const r2 = run(['--site', badFile, '--out', out2]);
  check(r2.status === 3, `退出码 3（读到 ${r2.status}）`);
  check(r2.stderr.trim() === 'unknown block type no-such-block at en/pages/home.json#zz-1', `标准错误就那一行：${JSON.stringify(r2.stderr.trim())}`);
  check(!fs.existsSync(out2), '--out 没被建出来（一个文件都不写）');
  check(r2.stdout === '', '标准输出没有 rendered 那一行');
  const good = run(['--site', writeSite('good', fixture('site-bbc4ff97')), '--out', path.join(tmp, 'out-good')]);
  check(good.status === 0 && files(path.join(tmp, 'out-good')).includes('index.html'), '尺子是活的：同一个夹具不塞那一块就照常出产物');

  console.log('\n── ③ 共用块、老形状 sections、第二种错');
  const shared = { 'en/blocks/site-blocks.json': { 'promo-1': { type: 'gone-block', visibility: ['*'], data: {} }, 'ok-1': { type: 'cta', data: {} } } };
  check(JSON.stringify(scan.unrenderableBlocks(shared, known)) === JSON.stringify(['unknown block type gone-block at en/blocks/site-blocks.json#promo-1']), '共用块里的也扫得到（键就是块 id）');
  const legacy = { 'pages/about.json': JSON.stringify({ sections: [{ type: 'hero' }, { type: 'values-grid' }] }) };
  check(JSON.stringify(scan.unrenderableBlocks(legacy, known)) === JSON.stringify(['unknown block type values-grid at pages/about.json#sections[1]']), '老形状 sections + 原文字符串的页面 + 没有 id 的块（报它在第几个）');
  const v = new Map([['hero', [1, 2]]]);
  const versioned = { 'en/pages/home.json': { blocks: [{ id: 'a', type: 'hero' }, { id: 'b', type: 'hero', schemaVersion: 2 }, { id: 'c', type: 'hero', schemaVersion: 3 }] } };
  check(JSON.stringify(scan.unrenderableBlocks(versioned, v)) === JSON.stringify(['unsupported schemaVersion 3 of hero at en/pages/home.json#c']),
    '第二种错：manifest 带 renders 时按版本判（没写 schemaVersion = 1）');

  console.log('\n── ④ --only-blocks');
  const out4 = path.join(tmp, 'out-only');
  const cache4 = path.join(tmp, 'css-cache-only');
  const t0 = Date.now();
  const r4 = run(['--site', badFile, '--out', out4, '--only-blocks', 'home-hero-0,home-reviews-2', '--cache-dir', cache4]);
  const ms = Date.now() - t0;
  const got = files(out4).sort();
  check(r4.status === 0, `content 里有这份包不认识的块，--only-blocks 照画（退出码 ${r4.status}）${r4.status ? r4.stderr.slice(-300) : ''}`);
  check(JSON.stringify(got) === JSON.stringify([
    'blocks/en/home-hero-0.attrs.json', 'blocks/en/home-hero-0.css', 'blocks/en/home-hero-0.html',
    'blocks/en/home-reviews-2.attrs.json', 'blocks/en/home-reviews-2.css', 'blocks/en/home-reviews-2.html',
  ]), `只出合同里那几份文件：${got.join(' · ')}`);
  const attrs = JSON.parse(fs.readFileSync(path.join(out4, 'blocks/en/home-hero-0.attrs.json'), 'utf-8'));
  check(attrs['data-block'] === 'hero' && attrs['data-block-id'] === 'home-hero-0' && typeof attrs.class === 'string', '.attrs.json 是 <section> 容器自己的属性（data-block / data-block-id / class …）');
  const inner = fs.readFileSync(path.join(out4, 'blocks/en/home-hero-0.html'), 'utf-8');
  check(inner.length > 100 && !/^<section/.test(inner) && !/<\/main>|<html/.test(inner), '.html 是 <section> 里面那段（不含容器本身、不是整页）');
  const css = fs.readFileSync(path.join(out4, 'blocks/en/home-hero-0.css'), 'utf-8');
  check(css.startsWith('/* ══ hero ═') && !css.includes('/* ══ reviews ═'), '.css 是 shapes.css 里 hero 那一段（不串到别的块）');
  check(!fs.existsSync(cache4) || fs.readdirSync(cache4).length === 0, '不编 Sass：site.css 缓存目录里什么都没有');
  check(ms < 5000, `整跑 ${ms} ms（冷 spawn；票面判据「不跑 Sass、< 1 秒」在 test 机上量）`);
  const out4b = path.join(tmp, 'out-only-ml');
  const ml = fixture('site-multilang');
  const sharedIds = ml['en/pages/home.json'].blocks.map((b) => b.id).filter((id) => (ml['fr/pages/home.json'].blocks || []).some((b) => b.id === id));
  const pick = sharedIds[0] || ml['en/pages/home.json'].blocks[0].id;
  const r4b = run(['--site', writeSite('ml', ml), '--out', out4b, '--only-blocks', pick]);
  const gotMl = files(out4b).filter((f) => f.endsWith('.html')).sort();
  check(r4b.status === 0 && (sharedIds.length ? gotMl.length === 2 && gotMl[0].startsWith('blocks/en/') && gotMl[1].startsWith('blocks/fr/') : gotMl.length >= 1),
    `多语言站：块 ${pick} 每种语言一份（${gotMl.join(' · ')}）`);
  const r4c = run(['--site', badFile, '--out', path.join(tmp, 'out-only-miss'), '--only-blocks', 'home-hero-0,nope-9']);
  check(r4c.status === 1 && /nope-9/.test(r4c.stderr), '找不到的 id ⟹ 退出码 1，报出是哪个');

  console.log('\n── ⑤ --out / --site 路径校验');
  const goodFile = path.join(tmp, 'good.json');
  for (const [flag, value] of [
    ['--out', '.'], ['--out', '..'], ['--out', `${tmp}/../x`], ['--out', `${tmp}//x`], ['--out', `${tmp}/./x`],
    ['--site', '.'], ['--site', `${tmp}/../good.json`], ['--site', `${tmp}//good.json`],
  ]) {
    const args = flag === '--out' ? ['--site', goodFile, '--out', value] : ['--site', value, '--out', path.join(tmp, 'never')];
    const r = run(args);
    check(r.status === 1 && /不能带 \. \/ \.\. \/ 空段/.test(r.stderr), `${flag} ${JSON.stringify(value)} ⟹ 拒（退出码 ${r.status}）`);
  }
  check(!fs.existsSync(path.join(tmp, 'never')) && !fs.existsSync(path.join(path.dirname(tmp), 'x')), '被拒的那几跑一个目录都没建');

  console.log('\n── ⑥ 渲染层照旧静默跳过');
  const sr = fs.readFileSync(path.join(ROOT, 'src', 'components', 'SectionRenderer.tsx'), 'utf-8');
  check(/console\.warn\(/.test(sr) && /return null/.test(sr) && !/\bthrow\b/.test(sr), 'SectionRenderer.tsx 没有 throw（扫描住在 site.js 入口）');

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(`🔴 跑不起来: ${e.stack}`); process.exit(2); });
