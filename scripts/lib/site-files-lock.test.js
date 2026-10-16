#!/usr/bin/env node
'use strict';
// #1807 —— `lib/site-files-lock.js`：编辑器存盘 / 派生 / AI 改站共用的那把站点文件锁。
//
//   node scripts/lib/site-files-lock.test.js   （`npm run test:scripts` 按文件名发现）
//   退出码: 0 全过 · 1 有失败 · 2 跑不起来（**不许当成通过**）
//
//   ① 两个持有者真的互斥：第二个等到第一个放了才拿到（等的时长 ≈ 第一个持有的时长）
//   ② 放锁不靠本进程的事件循环：放完紧跟一句 execSync（事件循环堵住）去拿同一把锁，毫秒级拿到 ——
//      edit-site.js 放锁之后紧跟的就是 execSync('node scripts/sync-config.js')，派生在那里面要拿这把锁
//   ③ 等满还拿不到 ⟹ locked=false + 一句人话；withSiteFilesLock 照旧跑 fn 并且喊出来（onUnlocked）
//   ④ flock 不在 ⟹ 同上（不抛、不卡）
//   ⑤ 持有者进程被 SIGKILL ⟹ 锁随之放掉（不会留一把永远放不掉的锁）

const fs = require('fs');
const os = require('os');
const path = require('path');
const cp = require('child_process');

let pass = 0; let fail = 0;
const ok = (m) => { pass += 1; console.log(`  ✅ ${m}`); };
const bad = (m) => { fail += 1; console.log(`  ❌ ${m}`); };
const check = (cond, m, detail) => (cond ? ok(m) : bad(detail ? `${m} —— ${detail}` : m));
function die(msg) { console.log(`💥 跑不起来: ${msg}`); process.exit(2); }

if (cp.spawnSync('flock', ['--version']).status !== 0) die('这台机器上没有 flock（util-linux），量不了这把锁');

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'site-files-lock-'));
process.on('exit', () => fs.rmSync(dir, { recursive: true, force: true }));
// 改道到临时文件，不碰本机那份真锁（别的窗格的派生在用它）。
process.env.AI1ST_SITE_FILES_LOCK = path.join(dir, 'site-files.lock');
const lock = require('./site-files-lock');
const LOCKFILE = process.env.AI1ST_SITE_FILES_LOCK;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  console.log('① 两个持有者互斥');
  {
    const a = await lock.hold();
    if (!a.locked) die(`第一个持有者都拿不到：${a.why}`);
    const t0 = Date.now();
    let bAt = 0;
    const bp = lock.hold().then((b) => { bAt = Date.now(); return b; });
    await sleep(800);
    check(bAt === 0, '第一个拿着时，第二个拿不到');
    a.release();
    const b = await bp;
    check(b.locked && bAt - t0 >= 700, `第一个放了，第二个才拿到（等了 ${bAt - t0} ms）`);
    b.release();
  }

  console.log('② 放锁不靠事件循环');
  {
    const a = await lock.hold();
    if (!a.locked) die(`拿不到锁：${a.why}`);
    a.release();
    const t0 = Date.now();
    const r = cp.spawnSync('flock', ['-w', '5', LOCKFILE, 'true']);
    check(r.status === 0 && Date.now() - t0 < 1000,
      `放完紧跟一句同步调用去拿同一把锁：rc=${r.status}，${Date.now() - t0} ms`);
  }

  console.log('③ 等满还拿不到 ⟹ 不卡、说清楚，withSiteFilesLock 照旧跑并喊出来');
  {
    const holder = cp.spawn('flock', [LOCKFILE, 'sleep', '10'], { stdio: 'ignore' });
    await sleep(300);
    const h = await lock.hold({ waitSeconds: 1 });
    check(!h.locked && /gave up/.test(h.why || ''), `locked=false，why=${JSON.stringify(h.why)}`);
    let said = null;
    const out = await lock.withSiteFilesLock(() => 'ran', { waitSeconds: 1, onUnlocked: (why) => { said = why; } });
    check(out === 'ran' && said, `fn 照旧跑了（回 ${JSON.stringify(out)}），onUnlocked 说了：${JSON.stringify(said)}`);
    holder.kill('SIGKILL');
    await sleep(200);
  }

  console.log('④ flock 不在');
  {
    const saved = process.env.PATH;
    process.env.PATH = dir; // 一个没有 flock 的 PATH
    const h = await lock.hold();
    process.env.PATH = saved;
    check(!h.locked && /not installed/.test(h.why || ''), `locked=false，why=${JSON.stringify(h.why)}`);
  }

  console.log('⑤ 持有者进程被 SIGKILL ⟹ 锁随之放掉');
  {
    const child = cp.spawn(process.execPath, ['-e', `
      process.env.AI1ST_SITE_FILES_LOCK = ${JSON.stringify(LOCKFILE)};
      require(${JSON.stringify(path.join(__dirname, 'site-files-lock.js'))}).hold().then((h) => {
        console.log(h.locked ? 'HELD' : 'NOT ' + h.why);
        setInterval(() => {}, 1000);
      });`], { stdio: ['ignore', 'pipe', 'inherit'] });
    const held = await new Promise((r) => child.stdout.on('data', (d) => r(String(d).trim())));
    if (held !== 'HELD') die(`子进程没拿到锁：${held}`);
    const busy = cp.spawnSync('flock', ['-n', LOCKFILE, 'true']).status;
    child.kill('SIGKILL');
    await sleep(300);
    const t0 = Date.now();
    const r = cp.spawnSync('flock', ['-w', '5', LOCKFILE, 'true']);
    check(busy !== 0 && r.status === 0 && Date.now() - t0 < 1000,
      `子进程拿着时别人 -n 拿不到（rc=${busy}），它被 SIGKILL 之后 ${Date.now() - t0} ms 拿到（rc=${r.status}）`);
  }

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch((e) => die(e && e.stack));
