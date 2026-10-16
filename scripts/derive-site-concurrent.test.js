#!/usr/bin/env node
'use strict';
// #1807 —— 派生（`derive-site.js`）跑到一半时别处改了它开头读过的站点文件：派生收尾**不许**拿开头那份旧内容盖掉它。
//
//   node scripts/derive-site-concurrent.test.js   （`npm run test:scripts` 按文件名发现）
//   退出码: 0 全过 · 1 有失败 · 2 跑不起来（**不许当成通过**）
//
// 夹具同 derive-site.test.js：仓里那条 skipAI 建站路建一个主 en、次 zh 的站，先派生一次。
//
//   ① 重现步骤那条尺子：派生把每种语言的菜单读进内存之后（stdout 打出 `Regenerated navigation.json`），像编辑器存盘那样
//      拿着站点文件锁改 en 的 navigation.json；派生收尾后读回 —— 必须是改过的那份。zh 那份没人动 ⟹ 照常派生
//      （阳性对照：派生在这一格里确实写了盘，不是整次什么都没写）。并核一次「派生的写盘确实在这一笔之后」，否则这把尺子没咬到窗口。
//   ② 派生写盘排在站点文件锁后面：别人拿着锁时，派生算完了也不写盘（public/site.css 不出现）；锁一放，它写完退出。
//   ③ site/custom.css 同一条规矩：派生读完之后它被删了 ⟹ 派生不把它写回来。
//
// 🔴 ① 的阳性对照（本票之前的字节上同一把尺子读到**旧值**）不在这份文件里：它要的是改之前那份 derive-site.js，交接里贴读数。

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

if (cp.spawnSync('flock', ['--version']).status !== 0) die('这台机器上没有 flock（util-linux）');

const temps = [];
process.on('exit', () => { for (const t of temps) fs.rmSync(t, { recursive: true, force: true }); });

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'derive-1807-'));
temps.push(root);
// 改道到临时文件，不碰本机那份真锁。派生子进程继承这个环境变量。
process.env.AI1ST_SITE_FILES_LOCK = path.join(root, 'site-files.lock');
const lock = require('./lib/site-files-lock');

function makeBase() {
  const work = path.join(root, 'base');
  cp.execSync(`cp -a --no-dereference "${NEXT}" "${work}"`, { stdio: 'pipe' });
  for (const junk of ['out', '.next', '.out-backup', '.out-temp', 'site', 'node_modules', path.join('src', 'lib', 'config-data.ts')]) {
    fs.rmSync(path.join(work, junk), { recursive: true, force: true });
  }
  fs.symlinkSync(path.join(NEXT, 'node_modules'), path.join(work, 'node_modules'));
  const r = cp.spawnSync(process.execPath, [path.join(work, 'scripts', 'create-site.js')], {
    input: JSON.stringify({ siteId: 'ds1807aa', siteUrl: 'https://ds1807.example.com', companyName: 'Northside Auto Care',
      industry: 'auto repair', location: 'Toronto', skipAI: true, language: 'en', secondaryLocales: ['zh'] }),
    cwd: work, encoding: 'utf8', env: { ...process.env, ANTHROPIC_API_KEY: undefined }, timeout: 180000,
  });
  if (!fs.existsSync(path.join(work, 'site', 'zh', 'pages', 'home.json'))) die(`夹具立不起来（rc=${r.status}）\n${(r.stderr || '').slice(-600)}`);
  const d = cp.spawnSync(process.execPath, ['scripts/derive-site.js'], { cwd: work, encoding: 'utf8', timeout: 180000 });
  if (d.status !== 0) die(`基底派生失败（rc=${d.status}）\n${(d.stdout + d.stderr).slice(-800)}`);
  return work;
}
let n = 0;
function copyOf(base) {
  const d = path.join(root, `c${++n}`);
  cp.execSync(`cp -a --no-dereference "${base}" "${d}"`, { stdio: 'pipe' });
  return d;
}

/** 起一次派生（发布模式：site.css 要剪，读完菜单之后还要好几秒）；`menusRead` 在每种语言的菜单都读进内存后 resolve。 */
function startDerive(work, locales) {
  const child = cp.spawn(process.execPath, ['scripts/derive-site.js'], { cwd: work, stdio: ['ignore', 'pipe', 'pipe'] });
  let out = '';
  let seen = 0;
  let onMenus;
  const menusRead = new Promise((r) => { onMenus = r; });
  child.stdout.on('data', (d) => {
    out += d;
    seen = (out.match(/Regenerated navigation\.json/g) || []).length;
    if (seen >= locales) onMenus();
  });
  child.stderr.on('data', (d) => { out += d; });
  const exited = new Promise((r) => child.on('exit', (code) => { onMenus(); r({ code, out }); }));
  return { child, menusRead, exited };
}

const navOf = (work, loc) => JSON.parse(fs.readFileSync(path.join(work, 'site', loc, 'navigation.json'), 'utf-8'));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  const base = makeBase();

  console.log('① 派生跑到一半时存一笔：收尾后那一笔还在');
  {
    const w = copyOf(base);
    // 让派生在 zh 那份上一定有东西要写（阳性对照：它确实写了盘）。
    // #1781 起菜单是老板自己的列表，派生不再从页面重算 ⟹ 用它仍会动的那一种：一个「见过」（记在 knownPages 里）
    // 而这次已经没有的页 ⟹ 菜单里指向它的那一项要被去掉（`nav-menu.js` §syncMenu）。
    const zh = navOf(w, 'zh');
    if (!Array.isArray(zh.header.knownPages)) die('夹具的 zh/navigation.json 没有 header.knownPages —— 先派生过一次的站应该有');
    zh.header.links = [...zh.header.links, { label: 'stale', href: '/nowhere' }];
    zh.header.knownPages = [...zh.header.knownPages, 'nowhere'];
    fs.writeFileSync(path.join(w, 'site', 'zh', 'navigation.json'), JSON.stringify(zh, null, 2));
    const d = startDerive(w, 2);
    await d.menusRead;
    const en = navOf(w, 'en');
    en.header.buttons = [{ label: 'CHANGED-DURING-DERIVE', href: '/contact' }];
    const saved = `${JSON.stringify(en, null, 2)}\n`;
    let savedAt = 0;
    await lock.withSiteFilesLock(() => {
      fs.writeFileSync(path.join(w, 'site', 'en', 'navigation.json'), saved);
      savedAt = Date.now();
    });
    const { code, out } = await d.exited;
    if (code !== 0) die(`派生失败（rc=${code}）\n${out.slice(-800)}`);
    const siteCss = path.join(w, 'public', 'site.css');
    if (!fs.existsSync(siteCss) || fs.statSync(siteCss).mtimeMs <= savedAt) {
      die('尺子没咬到窗口：派生的写盘不在这一笔之后（public/site.css 的改动时间早于存盘）—— 这一格的绿/红都不算数');
    }
    const after = fs.readFileSync(path.join(w, 'site', 'en', 'navigation.json'), 'utf-8');
    check(after === saved, 'en 的 navigation.json 收尾后仍是存进去的那份（逐字节）',
      `读回的 header.buttons = ${JSON.stringify(JSON.parse(after).header.buttons)}`);
    check(/#1807 site\/en\/navigation\.json changed while this derive was running/.test(out), '派生说了它为什么没写 en 那一份');
    const zhLinks = navOf(w, 'zh').header.links;
    check(!zhLinks.some((l) => l.href === '/nowhere'), '阳性对照：没人动的 zh 那份照常派生（指向已经没有的页的那一项被去掉了）', JSON.stringify(zhLinks));
  }

  console.log('② 别人拿着站点文件锁时，派生算完了也不写盘');
  {
    const w = copyOf(base);
    fs.rmSync(path.join(w, 'public', 'site.css'), { force: true });
    const held = await lock.hold();
    if (!held.locked) die(`测试自己拿不到锁：${held.why}`);
    const d = startDerive(w, 2);
    let exitedEarly = false;
    d.exited.then(() => { exitedEarly = true; });
    // 等它把 site.css 算完（打出 Generated public/site.css）再多等 1.5 秒：没有锁的话这时早就写完退出了。
    const deadline = Date.now() + 120000;
    let outSoFar = '';
    d.child.stdout.on('data', (x) => { outSoFar += x; });
    while (!/Generated public\/site\.css/.test(outSoFar) && !exitedEarly && Date.now() < deadline) await sleep(100);
    await sleep(1500);
    check(!exitedEarly && !fs.existsSync(path.join(w, 'public', 'site.css')),
      '算完 site.css 1.5 秒后：派生没退出、public/site.css 没写出来（排在锁后面）');
    const t0 = Date.now();
    held.release();
    const { code } = await d.exited;
    check(code === 0 && fs.existsSync(path.join(w, 'public', 'site.css')),
      `锁一放，派生写完退出（rc=${code}，${Date.now() - t0} ms）`);
  }

  console.log('③ site/custom.css：派生读完之后它被删了 ⟹ 不写回来');
  {
    const w = copyOf(base);
    const theme = JSON.parse(fs.readFileSync(path.join(w, 'site', 'theme.json'), 'utf-8'));
    theme.tweaks = { ...(theme.tweaks || {}), radiusScale: 1.2 };
    fs.writeFileSync(path.join(w, 'site', 'theme.json'), JSON.stringify(theme, null, 2));
    const pre = cp.spawnSync(process.execPath, ['scripts/derive-site.js'], { cwd: w, encoding: 'utf8', timeout: 180000 });
    const custom = path.join(w, 'site', 'custom.css');
    if (pre.status !== 0 || !fs.existsSync(custom)) die(`夹具：tweaks 之后派生没写出 site/custom.css（rc=${pre.status}）\n${(pre.stdout + pre.stderr).slice(-600)}`);
    // 改 tweaks 让派生这一次要重写 custom.css，然后在它读完之后把文件删掉。
    theme.tweaks.radiusScale = 0.9;
    fs.writeFileSync(path.join(w, 'site', 'theme.json'), JSON.stringify(theme, null, 2));
    const d = startDerive(w, 2);
    await d.menusRead;
    // custom.css 在菜单之后才读 —— 等它算到 site.css 那一步（那时 custom.css 早就读过了）。
    let outSoFar = '';
    d.child.stdout.on('data', (x) => { outSoFar += x; });
    while (!/Tweaks:/.test(outSoFar)) await sleep(50);
    await lock.withSiteFilesLock(() => fs.rmSync(custom));
    const { code, out } = await d.exited;
    check(code === 0 && !fs.existsSync(custom), `派生没把读完之后被删掉的 site/custom.css 写回来（rc=${code}）`, out.slice(-300));
  }

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch((e) => die(e && e.stack));
