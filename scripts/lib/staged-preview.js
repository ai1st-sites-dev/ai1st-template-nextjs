'use strict';
// #1599 —— 三段式建站：① 骨架（构建、预览进程有东西可服，但不通知平台）→ ② 能看了（发 `preview-viewable`）→
// ③ 后台补齐剩下的阶段（每补完一个阶段重构建一次、发 `preview-reload`）。整次建完照旧由 entrypoint.sh 发 `preview-started`。
//
// 三段不自己列步骤，从 #1598 的 BUILD_PHASES 派生：`pages` 之前的阶段属于 ①，`pages` 是 ②（做完时导航里点得到的页都已是
// 真实文案 —— 关键词页在 keywordPages 阶段才加进站里），`pages` 之后的每个阶段属于 ③。哪天那张表删掉一个阶段，这里一个字不用改。
//
// 每次预览构建怎么做（create-site.js 在每个阶段做完时调 phaseDone）：
//   1. **当场**把 site/ 拷一份快照（不带 `.build/` 存档），给预览用的文件写进快照，不写进 site/ ——
//      site/ 跟阶段提交是一回事（#1598 的不变量：「images 提交里还没有 brand.json」），预览不许往里塞东西。
//   2. 快照里还没写出来的语言从 site_meta.json 的 locales 里拿掉（第二语言在最后一个阶段才写盘，sync-config 见到
//      语言目录不在就 exit 1）。
//   3. 排进队列（一次只跑一个构建）：`SYNC_SITE_DIR=<快照> node scripts/sync-config.js` → `NEXT_EXPORT_DIR=<这次的目录>
//      next build`。sync-config 只往 src/ 和 public/ 写生成文件（都被 .gitignore 挡着），create-site 自己从不写它们。
//   4. 构建成功 ⟹ 把 `out` 这个符号链接原子地换到这次的目录（symlink + rename）。预览进程（serve out）每个请求现读磁盘，
//      换的那一刻前后都是一份完整的站 ⟹ 重构建期间预览不会打不开（以前每次构建先清空 out/，见 entrypoint.sh）。
//   构建失败只影响那一次：不换、不发事件，后面的阶段照常往下走（下一次构建成功时补上该发的那一条）。
//
// 只在 entrypoint.sh 打开它时才做（给了 STAGED_PREVIEW_DIR）：手跑 create-site、测试、以及没有这一段的老 entrypoint 都照旧，
// 一个文件都不多建。最后一个阶段的构建换上去了 ⟹ 写 `<目录>/result.json` 的 `final: true`，entrypoint 据它直接起预览、
// 不再构建一次；没写（中途某次失败 / 没打开）⟹ entrypoint 走老路自己构建。

const fs = require('fs');
const path = require('path');
const http = require('http');
const { spawn } = require('child_process');
const { BUILD_PHASES } = require('./build-phases');

const VIEWABLE_PHASE = 'pages';

/** 一个阶段属于哪一段：'skeleton'（①）· 'viewable'（②）· 'fill'（③）。不认得的阶段抛错 —— 调用方写错名字不能静默变成「不预览」。 */
function stageOf(phase, phases = BUILD_PHASES) {
  const i = phases.indexOf(phase);
  if (i < 0) throw new Error(`不认得的阶段 ${phase}`);
  const v = phases.indexOf(VIEWABLE_PHASE);
  return i < v ? 'skeleton' : i === v ? 'viewable' : 'fill';
}

/** ③ 里的阶段（发 `preview-reload` 的那几个），按顺序。 */
function fillPhases(phases = BUILD_PHASES) {
  return phases.slice(phases.indexOf(VIEWABLE_PHASE) + 1);
}

function run(cmd, args, { cwd, env, log }) {
  return new Promise((resolve) => {
    // 🔴 子进程的 stdout 接到我们的 stderr：create-site 的 stdout 是事件流（worker 只转发 JSON 行），构建日志不许混进去。
    const p = spawn(cmd, args, { cwd, env, stdio: ['ignore', 2, 2] });
    p.on('error', (e) => { log(`[staged-preview] ${cmd} 起不来：${e.message}`); resolve(false); });
    p.on('exit', (code, signal) => {
      if (code !== 0) log(`[staged-preview] ${path.basename(cmd)} ${path.basename(args[0] || '')} 退出 ${code === null ? signal : code}`);
      resolve(code === 0);
    });
  });
}

function probe(url, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  return new Promise((resolve) => {
    const once = () => {
      const req = http.get(url, (r) => { r.resume(); if (r.statusCode === 200) resolve(true); else retry(); });
      req.setTimeout(3000, () => req.destroy());
      req.on('error', retry);
    };
    const retry = () => (Date.now() > deadline ? resolve(false) : setTimeout(once, 500));
    once();
  });
}

/**
 * 从环境变量建一个（entrypoint.sh 给）；没打开回 null。
 *   STAGED_PREVIEW_DIR   构建目录、快照、result.json 都在这下面（容器里是 /tmp/preview-builds，在站仓外面）
 *   STAGED_PREVIEW_PORT  预览进程的端口：发 `preview-viewable` 之前先等它回 200（同 entrypoint 对 `preview-started` 的做法）
 *   STAGED_PREVIEW_KEEP  =1 时不删旧的构建目录和快照（测试要回头读「发事件那一刻」的站）
 */
function fromEnv({ rootDir, siteDir, emit, log, env = process.env }) {
  if (!env.STAGED_PREVIEW_DIR) return null;
  return createStagedPreview({
    rootDir, siteDir, emit, log,
    dir: path.resolve(env.STAGED_PREVIEW_DIR),
    port: Number(env.STAGED_PREVIEW_PORT) || 0,
    keep: env.STAGED_PREVIEW_KEEP === '1',
  });
}

function createStagedPreview({ rootDir, siteDir, emit, log = () => {}, dir, port = 0, keep = false, phases = BUILD_PHASES }) {
  const out = path.join(rootDir, 'out');
  fs.mkdirSync(dir, { recursive: true });
  // Rebuild：预览进程正在服上一次建好的站（entrypoint 把它挪进构建目录、out 换成指向它的链接）。① 的骨架不换上去 ——
  // 老板看到的仍是他的旧站，直到 ② 那一版建好。新建的站 out 还不存在，① 换上去让预览进程先有东西可服（不通知任何人）。
  const hadSite = fs.existsSync(path.join(out, 'index.html'));
  const nextBin = path.join(rootDir, 'node_modules', '.bin', 'next');
  const last = phases[phases.length - 1];
  let n = 0;
  let chain = Promise.resolve();
  let viewable = false;
  const result = { final: false, viewable: false, reloads: [] };
  const live = [];   // 换上去过的构建目录，新的在后

  const writeResult = () => fs.writeFileSync(path.join(dir, 'result.json'), JSON.stringify(result) + '\n');

  function snapshot(k, write) {
    const snap = path.join(dir, String(k), 'site');
    fs.cpSync(siteDir, snap, { recursive: true, filter: (src) => path.basename(src) !== '.build' });
    if (write) write(snap);
    const metaFile = path.join(snap, 'site_meta.json');
    if (fs.existsSync(metaFile)) {
      const meta = JSON.parse(fs.readFileSync(metaFile, 'utf8'));
      if (Array.isArray(meta.locales)) {
        const present = meta.locales.filter((l) => l === meta.defaultLocale || fs.existsSync(path.join(snap, l)));
        if (present.length !== meta.locales.length) {
          log(`[staged-preview] #${k} 只构建已经写出来的语言 ${present.join(', ')}（${meta.locales.filter((l) => !present.includes(l)).join(', ')} 还没写）`);
          meta.locales = present;
          fs.writeFileSync(metaFile, JSON.stringify(meta, null, 2) + '\n');
        }
      }
    }
    return snap;
  }

  function swap(target) {
    const tmp = `${out}.swap-${process.pid}`;
    fs.rmSync(tmp, { force: true });
    fs.symlinkSync(target, tmp);
    fs.renameSync(tmp, out);
    live.push(target);
    // 留两份：刚换下来的那份可能还有请求在读。更早的删掉（容器里 /tmp 的空间）。
    if (!keep) while (live.length > 2) fs.rmSync(path.dirname(live.shift()), { recursive: true, force: true });
  }

  async function build(k, phase, snap) {
    const exportDir = path.join(dir, String(k), 'out');
    const t0 = Date.now();
    const env = { ...process.env, SYNC_SITE_DIR: snap, NEXT_EXPORT_DIR: exportDir };
    const ok = await run(process.execPath, [path.join(rootDir, 'scripts', 'sync-config.js')], { cwd: rootDir, env, log })
      && await run(fs.existsSync(nextBin) ? nextBin : 'npx', fs.existsSync(nextBin) ? ['build', '--webpack'] : ['next', 'build', '--webpack'], { cwd: rootDir, env, log })
      && fs.existsSync(path.join(exportDir, 'index.html'));
    const secs = ((Date.now() - t0) / 1000).toFixed(1);
    if (!keep) fs.rmSync(snap, { recursive: true, force: true });
    if (!ok) {
      log(`[staged-preview] #${k}（${phase} 之后）构建失败，${secs}s —— 预览不换，后面的阶段照常`);
      return;
    }
    const stage = stageOf(phase, phases);
    if (stage === 'skeleton' && hadSite) {
      log(`[staged-preview] #${k}（${phase} 之后，骨架）构建好了，${secs}s —— 预览上还是上一次建好的站，不换`);
      return;
    }
    swap(exportDir);
    log(`[staged-preview] #${k}（${phase} 之后，${stage}）构建好了，${secs}s —— 预览已换上`);
    if (phase === last) result.final = true;
    if (stage === 'skeleton') { writeResult(); return; }
    const remaining = phases.slice(phases.indexOf(phase) + 1);
    if (!viewable) {
      const previewUrl = port ? `http://localhost:${port}` : '';
      if (port && !(await probe(`http://127.0.0.1:${port}/`, 60000))) log(`[staged-preview] 预览进程 60 秒内没回 200 —— 照发 preview-viewable`);
      viewable = true;
      result.viewable = true;
      emit('preview-viewable', { previewUrl, phase, remaining });
    } else {
      result.reloads.push(phase);
      emit('preview-reload', { phase, remaining });
    }
    writeResult();
  }

  return {
    /**
     * 一个阶段做完了。`write(dir)`：往快照目录里写给预览用的站点文件（null = site/ 里的就是这一刻要看的站）。
     * 快照当场拍、当场写（同步），构建排队在后台跑 —— 不挡建站往下走。
     */
    phaseDone(phase, write = null) {
      stageOf(phase, phases);
      const k = ++n;
      let snap;
      try {
        snap = snapshot(k, write);
      } catch (e) {
        log(`[staged-preview] #${k}（${phase} 之后）快照写不出来：${e.message} —— 这一次不构建`);
        return;
      }
      chain = chain.then(() => build(k, phase, snap)).catch((e) => log(`[staged-preview] #${k} 出错：${e.stack || e.message}`));
    },
    /** 等排着的构建全部跑完。回 { final, viewable, reloads }，同 result.json。 */
    async finish() {
      await chain;
      writeResult();
      return { ...result };
    },
  };
}

module.exports = { VIEWABLE_PHASE, stageOf, fillPhases, fromEnv, createStagedPreview };
