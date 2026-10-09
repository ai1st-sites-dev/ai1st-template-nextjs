#!/usr/bin/env node
'use strict';
// #1666（Epic:Durable T3）—— `scripts/derive-site.js`：内容一改就跑的那一步（菜单、css、补字段 + 校验），不构建。
//
// 夹具走仓里那条 skipAI 建站路（同 lib/site-data.test.js）：主 en、次 zh 的站。每格从这份基底拷一份新的，互不影响。
//
//   ① 六个派生物各一格：site/<locale>/navigation.json · 块的 has / shape（内存里，经 `ready` 交出去）· public/theme.css ·
//      public/site.css · site/custom.css · public/custom.css
//   ② 校验失败：zh 一页 JSON 改坏 ⟹ 退出码非 0，而且**一个派生文件都没动**（字节、改动时间都不变）—— 包括排在坏页
//      前面那个语言（en）的菜单。反向的那一下也在这一格：en 的菜单事先被弄乱，拆之前边算边写的版本会把它写回去
//   ③ `AI1ST_RENDER=preview` ⟹ site.css 不剪（比发布那份大得多、而且含有一条发布那份剪掉了的规则）、不写 config-data.ts；
//      `sync-config.js`（发布）照旧剪、照旧写 config-data.ts
//   ④ `AI1ST_RENDER` 写错 ⟹ 退出码 1，跟 next.config.js 同一句话

const fs = require('fs');
const os = require('os');
const path = require('path');
const cp = require('child_process');

const NEXT = path.resolve(__dirname, '..');

let pass = 0; let fail = 0;
const ok = (m) => { pass += 1; console.log(`  ✅ ${m}`); };
const bad = (m) => { fail += 1; console.log(`  ❌ ${m}`); };
const check = (cond, m, detail) => (cond ? ok(m) : bad(detail ? `${m} —— ${detail}` : m));
function die(msg) { console.log(`💥 跑不起来: ${msg}`); process.exit(2); }

const temps = [];
process.on('exit', () => { for (const t of temps) fs.rmSync(t, { recursive: true, force: true }); });

function makeBase() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'derive-site-'));
  temps.push(root);
  const work = path.join(root, 'base');
  cp.execSync(`cp -a --no-dereference "${NEXT}" "${work}"`, { stdio: 'pipe' });
  for (const junk of ['out', '.next', '.out-backup', '.out-temp', 'site', 'node_modules', path.join('src', 'lib', 'config-data.ts')]) {
    fs.rmSync(path.join(work, junk), { recursive: true, force: true });
  }
  fs.symlinkSync(path.join(NEXT, 'node_modules'), path.join(work, 'node_modules'));
  const r = cp.spawnSync(process.execPath, [path.join(work, 'scripts', 'create-site.js')], {
    input: JSON.stringify({ siteId: 'ds1666aa', siteUrl: 'https://ds1666.example.com', companyName: 'Northside Auto Care',
      industry: 'auto repair', location: 'Toronto', skipAI: true, language: 'en', secondaryLocales: ['zh'] }),
    cwd: work, encoding: 'utf8', env: { ...process.env, ANTHROPIC_API_KEY: undefined }, timeout: 180000,
  });
  if (!fs.existsSync(path.join(work, 'site', 'zh', 'pages', 'home.json'))) die(`夹具立不起来（rc=${r.status}）\n${(r.stderr || '').slice(-600)}`);
  return { root, work };
}

let n = 0;
function copyOf(base) {
  const dir = path.join(base.root, `c${++n}`);
  cp.execSync(`cp -a --no-dereference "${base.work}" "${dir}"`, { stdio: 'pipe' });
  return dir;
}

function run(work, script, env = {}) {
  const e = { ...process.env, ...env };
  for (const [k, v] of Object.entries(env)) if (v === undefined) delete e[k];
  return cp.spawnSync(process.execPath, [path.join(work, 'scripts', script)], { cwd: work, encoding: 'utf8', timeout: 180000, env: e });
}
function derive(work, env = {}) {
  const r = run(work, 'derive-site.js', { AI1ST_RENDER: undefined, ...env });
  if (r.status !== 0) die(`derive-site 失败（rc=${r.status}）\n${(r.stdout + r.stderr).slice(-800)}`);
  return r;
}
const read = (work, f) => fs.readFileSync(path.join(work, f), 'utf-8');
const json = (work, f) => JSON.parse(read(work, f));
const writeJson = (work, f, v) => fs.writeFileSync(path.join(work, f), JSON.stringify(v, null, 2));
const exists = (work, f) => fs.existsSync(path.join(work, f));

const base = makeBase();
// 基底先派生一次（发布模式），让每份拷贝里都已经有「上一版」的派生文件。
derive(base.work);

console.log('① site/<locale>/navigation.json：按页面重写菜单');
{
  const w = copyOf(base);
  const nav = json(w, 'site/en/navigation.json');
  nav.header.links = [{ label: 'stale', href: '/nowhere' }];
  writeJson(w, 'site/en/navigation.json', nav);
  derive(w);
  const links = json(w, 'site/en/navigation.json').header.links;
  check(links.length > 1 && links[0].href === '/' && !links.some((l) => l.href === '/nowhere'),
    'en 的顶栏链接按页面重算（首页打头、旧的那条没了）', JSON.stringify(links));
}

console.log('① 块的 has / shape：经 `ready` 交出去的页面上每块都补了 shape，填了可选槽位的补了 has');
{
  const w = copyOf(base);
  const r = cp.spawnSync(process.execPath, ['-e',
    "require('./scripts/derive-site.js').ready.then((d) => { process.stdout.write('\\n@@' + JSON.stringify("
    + "Object.values(d.pagesByLocale).flat().flatMap((p) => p.blocks.map((b) => ({ type: b.type, shape: b.shape, has: b.has })))) + '\\n'); })"],
  { cwd: w, encoding: 'utf8', timeout: 180000 });
  const line = (r.stdout || '').split('\n').find((l) => l.startsWith('@@'));
  if (r.status !== 0 || !line) die(`ready 读不出来（rc=${r.status}）\n${(r.stdout + r.stderr).slice(-600)}`);
  const blocks = JSON.parse(line.slice(2));
  check(blocks.length > 0 && blocks.every((b) => typeof b.shape === 'string' && b.shape),
    `${blocks.length} 个块每个都有 shape`, JSON.stringify(blocks.filter((b) => !b.shape).slice(0, 3)));
  check(blocks.some((b) => Array.isArray(b.has) && b.has.length > 0), '至少一个块补了 has（填了的可选槽位）');
}

console.log('① public/theme.css 与 public/site.css：跟着 brand.json 的主色变');
{
  const w = copyOf(base);
  const brand = json(w, 'site/brand.json');
  brand.colors.primary['500'] = '#c2185b';
  writeJson(w, 'site/brand.json', brand);
  derive(w);
  check(read(w, 'public/theme.css').toLowerCase().includes('#c2185b'), 'public/theme.css 里是新主色');
  check(read(w, 'public/site.css').toLowerCase().includes('#c2185b'), 'public/site.css 里是新主色（$primary 重编了）');
}

console.log('① site/custom.css 与 public/custom.css：theme.json 的微调');
{
  const w = copyOf(base);
  const theme = exists(w, 'site/theme.json') ? json(w, 'site/theme.json') : {};
  const before = exists(w, 'site/custom.css') ? read(w, 'site/custom.css') : '';
  // 建站时按 siteId 挑了一组微调 —— 换成一个跟它不同的圆角，才看得出重算了
  const radiusScale = (theme.tweaks || {}).radiusScale === 1.2 ? 1.1 : 1.2;
  theme.tweaks = { ...(theme.tweaks || {}), radiusScale };
  writeJson(w, 'site/theme.json', theme);
  derive(w);
  check(exists(w, 'site/custom.css') && /--radius/.test(read(w, 'site/custom.css')) && read(w, 'site/custom.css') !== before,
    'site/custom.css 按新的微调重算了（变了、里面是圆角）');
  check(exists(w, 'public/custom.css') && read(w, 'public/custom.css') === read(w, 'site/custom.css'),
    'public/custom.css 跟 site/custom.css 逐字相同');
}

console.log('② 校验失败：一个派生文件都不动');
{
  const w = copyOf(base);
  const outs = ['public/theme.css', 'public/site.css', 'public/custom.css', 'site/en/navigation.json', 'site/zh/navigation.json'];
  // en 的菜单弄乱：拆之前的写法（边算边写）会在 zh 那页报错之前把它写回去
  const nav = json(w, 'site/en/navigation.json');
  nav.header.links = [];
  writeJson(w, 'site/en/navigation.json', nav);
  const snap = () => outs.map((f) => `${f} ${fs.statSync(path.join(w, f)).mtimeMs} ${read(w, f).length} ${read(w, f).slice(0, 4000)}`).join('\n');
  const before = snap();
  fs.writeFileSync(path.join(w, 'site/zh/pages/home.json'), '{ broken');
  cp.execSync('sleep 1.1');
  const r = run(w, 'derive-site.js', { AI1ST_RENDER: 'preview' });
  check(r.status !== 0, `退出码非 0（实得 ${r.status}）`);
  check(/JSON/.test(r.stderr), 'stderr 里是那个错', (r.stderr || '').slice(0, 200));
  check(snap() === before, '五个派生文件的字节、改动时间都没变（en 的菜单也没被写回去）');
}

console.log('③ AI1ST_RENDER=preview：site.css 不剪、不写 config-data.ts；sync-config.js 照旧剪、照旧写');
{
  const w = copyOf(base);
  fs.rmSync(path.join(w, 'src/lib/config-data.ts'), { force: true });
  derive(w, { AI1ST_RENDER: 'preview' });
  const preview = read(w, 'public/site.css');
  check(!exists(w, 'src/lib/config-data.ts'), 'derive-site.js 没写 src/lib/config-data.ts');
  const r = run(w, 'sync-config.js', { AI1ST_RENDER: undefined });
  check(r.status === 0, `sync-config.js rc=0（实得 ${r.status}）`, (r.stderr || '').slice(-300));
  const published = read(w, 'public/site.css');
  check(exists(w, 'src/lib/config-data.ts'), 'sync-config.js 写了 src/lib/config-data.ts');
  check(preview.length > published.length * 3, `预览那份没剪：${preview.length} 字节 vs 发布 ${published.length} 字节`);
  // 一条模板源码里不会出现的工具类：发布那份剪掉它，预览那份留着
  const rule = '.d-print-none';
  check(preview.includes(rule) && !published.includes(rule), `「${rule}」预览有、发布没有`);
}

console.log('④ AI1ST_RENDER 写错 ⟹ 退出码 1');
{
  const w = copyOf(base);
  const r = run(w, 'derive-site.js', { AI1ST_RENDER: 'live' });
  check(r.status === 1 && /AI1ST_RENDER 只认 preview \/ publish/.test(r.stderr), `rc=${r.status}，报错说清楚了`, (r.stderr || '').slice(0, 200));
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
