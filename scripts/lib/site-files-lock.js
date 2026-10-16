'use strict';
// ══════════════════════════════════════════════════════════════════════════════════════════════════
// site-files-lock.js —— 「谁正在改这个站的文件」只有一个判据（#1807）
// ══════════════════════════════════════════════════════════════════════════════════════════════════
//
// 同一份 `site/<语言>/navigation.json`（以及别的站点文件）有三条路在读-改-写：
//   · 编辑器存盘 —— worker 在容器外 `docker exec` 存盘脚本 + `git add/commit`（`worker/blocks_task.go`）
//   · 派生 —— `derive-site.js` 开头读、跑完约 5 秒的 site.css、收尾写（本文件之前不拿任何锁）
//   · AI 改站 —— `edit-site.js` 的 write_file / 回滚 / `git add -A && git commit`（本文件之前不拿任何锁）
// 三条路今天都进这一把锁：容器里的 `flock /tmp/site-files.lock`。worker 那一侧拿的是同一个路径
// （`worker/site_files_lock.go` §siteFilesLockPath，`ticket1807_test.go` 逐字比对两边）。
//
// 🔴 **持锁时间是毫秒级**，这是这把锁存在的理由（#1807 验收 4b）：只罩「写盘 + 提交」那一刻，从不罩构建。
//    所以不复用 `/tmp/preview-build.lock` —— 那把里装着整次 `next build` 和带 `npm ci` 的升级，存盘排在它后面
//    就是老板点完 Done 面板转几分钟。
// 🔴 **拿着这把锁的时候不许跑派生**（`derive-site.js` / `sync-config.js`）：派生写盘那一刻自己要拿它 ⟹ 自己等自己，
//    直到 §WAIT_SECONDS 超时。`edit-site.js` 跑 sync-config 那一句因此在锁外。
//
// 形状是一份「租约」：起一个 `flock -o <锁> sh -c 'echo locked; exec cat'` 子进程，读到 `locked` 就算拿到，
// 放锁 = 杀掉 flock 进程（`-o`：锁只在 flock 自己手里，它一死内核就放，不等本进程的事件循环 —— 放锁之后
// 紧跟一句 `execSync` 堵住事件循环也不会自己等自己）。本进程不管怎么死（异常、SIGKILL），管道一断 flock 就退、锁就放。
//
// 🔴 拿不到（`flock` 不在 / 等满 §WAIT_SECONDS）⟹ **照旧不带锁做**，并且喊出来（`onUnlocked`）。理由：拿不到锁时
//    这几条路退回的是本票之前的行为（各自的读后核对还在），而反过来「拿不到就不写」会让派生 / AI 改站在一台没有
//    flock 的开发机上整条跑不起来。worker 那一侧方向相反（拿不到就不存、告诉老板什么都没改），理由写在那边。

const { spawn } = require('child_process');

const LOCK_PATH = '/tmp/site-files.lock';
const WAIT_SECONDS = 30;

/** 测试改道用（不碰本机那份真锁）；产品里从不设。 */
function lockPath() {
  return process.env.AI1ST_SITE_FILES_LOCK || LOCK_PATH;
}

/**
 * 拿锁。回 `{ locked, why, release }`：`locked=false` 时 `why` 是一句人话、`release` 是空操作。
 * @param {{ waitSeconds?: number }} [opts]
 */
function hold(opts = {}) {
  const waitSeconds = opts.waitSeconds || WAIT_SECONDS;
  const file = lockPath();
  return new Promise((resolve) => {
    let settled = false;
    const done = (v) => { if (!settled) { settled = true; resolve(v); } };
    const notLocked = (why) => done({ locked: false, why, release() {} });
    let child;
    try {
      child = spawn('flock', ['-o', '-w', String(waitSeconds), file, 'sh', '-c', 'echo locked; exec cat >/dev/null'],
        { stdio: ['pipe', 'pipe', 'pipe'] });
    } catch (e) {
      notLocked(`could not start flock: ${e.message}`);
      return;
    }
    let out = '';
    let err = '';
    const release = () => {
      // 只杀还活着的那一个：退了之后 pid 可能已经给了别的进程。
      if (child.exitCode === null && child.signalCode === null) {
        try { process.kill(child.pid, 'SIGKILL'); } catch (e) { /* 刚好退了 */ }
      }
      try { child.stdin.destroy(); } catch (e) { /* 同上 */ }
    };
    child.stdout.on('data', (d) => {
      out += d;
      if (out.includes('locked')) done({ locked: true, why: null, release });
    });
    child.stderr.on('data', (d) => { err += d; });
    child.stdin.on('error', () => {});
    child.on('error', (e) => notLocked(e.code === 'ENOENT' ? 'flock is not installed here' : `flock failed: ${e.message}`));
    child.on('exit', (code, signal) => notLocked(`flock gave up before taking ${file} `
      + `(exit ${code === null ? signal : code}, waited up to ${waitSeconds}s)${err.trim() ? `: ${err.trim()}` : ''}`));
  });
}

/**
 * 在锁里跑 `fn`（同步或 async 都行），跑完放锁，回 `fn` 的结果。拿不到锁 ⟹ 调 `onUnlocked(why)` 后照旧跑（见文件头）。
 * @template T
 * @param {() => T | Promise<T>} fn
 * @param {{ onUnlocked?: (why: string) => void, waitSeconds?: number }} [opts]
 * @returns {Promise<T>}
 */
async function withSiteFilesLock(fn, opts = {}) {
  const h = await hold(opts);
  if (!h.locked) {
    (opts.onUnlocked || ((why) => console.error(`  🔴 #1807 没拿到站点文件锁，这一步不带锁做：${why}`)))(h.why);
  }
  try {
    return await fn();
  } finally {
    h.release();
  }
}

module.exports = { LOCK_PATH, WAIT_SECONDS, lockPath, hold, withSiteFilesLock };
