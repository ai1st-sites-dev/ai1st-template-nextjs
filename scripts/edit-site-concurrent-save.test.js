#!/usr/bin/env node
'use strict';
// #1807 验收 4 —— 「AI 改站」与「编辑器存盘」撞一次：两笔都不丢，报文不出现「说存好了其实没存」。
//
//   node scripts/edit-site-concurrent-save.test.js   （`npm run test:scripts` 按文件名发现）
//   退出码: 0 全过 · 1 有失败 · 2 跑不起来（**不许当成通过**）
//
// 被测的是**真的** `edit-site.js`（真的 write_file 闸、真的 sync-config 派生、真的 git），唯一换掉的是模型（同
// `lib/edit-site-chain.test.js` 那一招：`node --require` 一个钩子把 `@anthropic-ai/sdk` 换成按脚本回放的假客户端）。
// 站是仓里那条 skipAI 建站路建的、先派生一次再提交（真站提交进站仓的就是派生过的那份）。
//
// 撞的那一刻：AI 这一轮写完一页、进到 sync-config（派生）。派生把菜单读进内存之后、写回之前，本进程像编辑器存盘那样
// 拿着站点文件锁改顶栏按钮并 `git commit`（worker §processBlockPatchTask 的「写盘 + commit」整段）。
//   · 时序判据（默认，`T1807_TRIGGER=flock`）：本进程先拿锁，等到派生的 flock 子进程出现 —— 那一刻派生已经读完菜单、
//     正卡在写盘前 —— 才写。没有睡眠、没有猜。
//   · `T1807_TRIGGER=timer`：sync-config 起来 2.5 秒后写（改之前的派生不拿锁，等不到 flock 子进程；只给交接里的
//     阳性对照用 —— 同一把尺子在改之前的字节上必须读到旧值）。
//
// 读数：① AI 那一轮的终态是 edit-complete（不是 error）· ② AI 改的那一页在 HEAD 里 · ③ 编辑器那颗按钮在工作树里、
//       也在 HEAD 里 · ④ HEAD 与工作树的 navigation.json 逐字节相同 · 并核「派生的写盘确实在编辑器那一笔之后」。

const fs = require('fs');
const os = require('os');
const path = require('path');
const cp = require('child_process');

const NEXT = path.resolve(__dirname, '..');
const TRIGGER = process.env.T1807_TRIGGER || 'flock';

let pass = 0; let fail = 0;
const ok = (m) => { pass += 1; console.log(`  ✅ ${m}`); };
const bad = (m) => { fail += 1; console.log(`  ❌ ${m}`); };
const check = (cond, m, detail) => (cond ? ok(m) : bad(detail ? `${m} —— ${detail}` : m));
function die(msg) { console.log(`💥 跑不起来: ${msg}`); process.exit(2); }

if (cp.spawnSync('flock', ['--version']).status !== 0) die('这台机器上没有 flock（util-linux）');
if (!fs.existsSync('/proc/self/cmdline')) die('要读 /proc 认出派生进程，这台机器没有 /proc');

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'edit-1807-'));
const children = [];
process.on('exit', () => {
  for (const c of children) { try { c.kill('SIGKILL'); } catch (e) { /* 已经退了 */ } }
  fs.rmSync(root, { recursive: true, force: true });
});
process.env.AI1ST_SITE_FILES_LOCK = path.join(root, 'site-files.lock');
const lock = require('./lib/site-files-lock');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ── 预览端口的替身（edit-site.js 存盘前问一次预览活不活；没人答就睡 35 秒 —— 同 edit-site-chain.test.js）──
function startPreviewStandIn() {
  const portFile = path.join(root, 'port');
  const child = cp.spawn(process.execPath, ['-e', `
    // 闸（场景 B 用）：root/gate 在 ⟹ 先写 root/hit 报到，等 root/go 出现（≤ 900 ms，edit-site 那一问 1 秒超时）再答。
    const fs = require('fs'); const R = ${JSON.stringify(root)};
    const s = require('http').createServer((q, r) => {
      if (!fs.existsSync(R + '/gate')) { r.writeHead(200); r.end('ok'); return; }
      fs.writeFileSync(R + '/hit', '1');
      const t0 = Date.now();
      const tick = () => { if (fs.existsSync(R + '/go') || Date.now() - t0 > 900) { r.writeHead(200); r.end('ok'); } else setTimeout(tick, 10); };
      tick();
    });
    s.listen(0, '127.0.0.1', () => fs.writeFileSync(${JSON.stringify(portFile)}, String(s.address().port)));`],
  { stdio: 'ignore' });
  children.push(child);
  const deadline = Date.now() + 20000;
  while (Date.now() < deadline) {
    if (fs.existsSync(portFile) && fs.readFileSync(portFile, 'utf8').trim()) return fs.readFileSync(portFile, 'utf8').trim();
    cp.spawnSync('sleep', ['0.05']);
  }
  return die('预览替身没起来');
}

const STUB = `
'use strict';
const Module = require('module');
const script = JSON.parse(require('fs').readFileSync(process.env.EDIT_STUB_SCRIPT, 'utf8'));
let turn = 0;
class FakeAnthropic {
  constructor() {
    const next = () => { const r = script[turn]; turn += 1; if (!r) throw new Error('回放脚本用完了'); return r; };
    this.messages = {
      stream: () => { const r = next(); return { on: () => {}, finalMessage: async () => r }; },
      create: async () => next(),
    };
  }
}
const realLoad = Module._load;
Module._load = function (request) {
  if (request === '@anthropic-ai/sdk') return FakeAnthropic;
  return realLoad.apply(this, arguments);
};
`;
const reply = (content, stop = 'end_turn') => ({
  id: 'msg_test', type: 'message', role: 'assistant', model: 'claude-sonnet-4-6', content,
  stop_reason: stop, stop_sequence: null, usage: { input_tokens: 10, output_tokens: 20 },
});

function makeSite(label) {
  const work = path.join(root, label);
  cp.execSync(`cp -a --no-dereference "${NEXT}" "${work}"`, { stdio: 'pipe' });
  for (const junk of ['out', '.next', '.out-backup', '.out-temp', 'site', 'node_modules']) {
    fs.rmSync(path.join(work, junk), { recursive: true, force: true });
  }
  fs.symlinkSync(path.join(NEXT, 'node_modules'), path.join(work, 'node_modules'));
  const r = cp.spawnSync(process.execPath, ['scripts/create-site.js'], {
    input: JSON.stringify({ siteId: 'edit1807', siteUrl: 'https://edit1807.example.com', companyName: 'Northside Auto Care',
      industry: 'auto repair', location: 'Toronto', skipAI: true, language: 'en' }),
    cwd: work, encoding: 'utf8', env: { ...process.env, ANTHROPIC_API_KEY: undefined }, timeout: 180000,
  });
  if (!fs.existsSync(path.join(work, 'site', 'en', 'navigation.json'))) die(`夹具立不起来（rc=${r.status}）\n${(r.stderr || '').slice(-600)}`);
  const d = cp.spawnSync(process.execPath, ['scripts/sync-config.js'], { cwd: work, encoding: 'utf8', timeout: 180000 });
  if (d.status !== 0) die(`夹具过不了 sync-config（rc=${d.status}）\n${(d.stdout + d.stderr).slice(-600)}`);
  const bare = path.join(root, `${label}-origin.git`);
  const git = (c) => cp.execSync(c, { cwd: work, stdio: 'pipe' }).toString();
  cp.execSync(`git init --bare -q -b main "${bare}"`, { stdio: 'pipe' });
  git('git init -q -b main && git config user.email t@t.test && git config user.name t');
  git('git add -A && git commit -qm fixture');
  git(`git remote add origin "${bare}" && git push -q origin HEAD:main`);
  return { work, git };
}

/** /proc 里 cwd 是 `work`、命令行带着 `needle` 的进程；`ppid` 给了就只认它的子进程。 */
function findProc(work, needle, ppid) {
  for (const pid of fs.readdirSync('/proc').filter((p) => /^\d+$/.test(p))) {
    try {
      const cmd = fs.readFileSync(`/proc/${pid}/cmdline`, 'utf8');
      if (!cmd.includes(needle)) continue;
      if (ppid !== undefined) {
        const pp = fs.readFileSync(`/proc/${pid}/stat`, 'utf8').split(') ')[1].split(' ')[1];
        if (Number(pp) !== ppid) continue;
      } else if (fs.readlinkSync(`/proc/${pid}/cwd`) !== work) continue;
      return Number(pid);
    } catch (e) { /* 读的时候刚好退了 */ }
  }
  return null;
}

const NAV = 'site/en/navigation.json';
const ABOUT = 'site/en/pages/about.json';

/** 起一次 AI 改站（改 about 页的标题）；回 { edit, exited, out(), errOut() }。 */
function startEdit(work, port) {
  if (!fs.existsSync(path.join(work, ABOUT))) die(`夹具里没有 ${ABOUT}`);

  // AI 这一轮：改 about 页的标题，然后收尾。
  const about = JSON.parse(fs.readFileSync(path.join(work, ABOUT), 'utf8'));
  about.title = 'About us — edited by the AI (#1807)';
  const script = [
    reply([{ type: 'tool_use', id: 'w1', name: 'write_file', input: { path: 'en/pages/about.json', content: JSON.stringify(about, null, 2) } }], 'tool_use'),
    reply([{ type: 'text', text: 'Updated the About page title.' }]),
  ];
  const stub = path.join(work, '..', `${path.basename(work)}-stub.js`);
  const scriptPath = path.join(work, '..', `${path.basename(work)}-script.json`);
  fs.writeFileSync(stub, STUB);
  fs.writeFileSync(scriptPath, JSON.stringify(script));

  const edit = cp.spawn(process.execPath, ['--require', stub, 'scripts/edit-site.js'], {
    cwd: work, stdio: ['pipe', 'pipe', 'pipe'],
    env: { ...process.env, ANTHROPIC_API_KEY: 'stub-not-used', EDIT_STUB_SCRIPT: scriptPath, PREVIEW_PORT: port },
  });
  children.push(edit);
  let out = '';
  let errOut = '';
  edit.stdout.on('data', (d) => { out += d; });
  edit.stderr.on('data', (d) => { errOut += d; });
  const exited = new Promise((r) => edit.on('exit', r));
  edit.stdin.end(JSON.stringify({ siteId: 'edit1807', message: 'Change the About page title' }));
  return { edit, exited, out: () => out, errOut: () => errOut };
}

/** 读 AI 那一轮的终态事件。 */
function terminalOf(out) {
  return out.split('\n').filter(Boolean).map((l) => { try { return JSON.parse(l); } catch (e) { return {}; } })
    .filter((e) => e.event === 'edit-complete' || e.event === 'error');
}

// ── 场景 A：撞一次 ───────────────────────────────────────────────────────────────────────────────
async function scenarioCollide(port) {
  const { work, git } = makeSite('a');
  const { edit, exited, out: outOf, errOut: errOf } = startEdit(work, port);

  // ── 编辑器存盘撞进来 ─────────────────────────────────────────────────────────────────────────
  let sync = null;
  const deadline = Date.now() + 120000;
  while (!sync && Date.now() < deadline && edit.exitCode === null) { sync = findProc(work, 'sync-config.js'); if (!sync) await sleep(20); }
  if (!sync) die(`等不到 AI 改站那一轮的 sync-config 起来（edit-site 已退出：${edit.exitCode}）\n${errOf().slice(-800)}`);
  let held = null;
  let how;
  if (TRIGGER === 'timer') {
    await sleep(2500);
    held = await lock.hold();
    how = 'sync-config 起来 2.5 秒后';
  } else {
    held = await lock.hold();
    if (!held.locked) die(`测试自己拿不到站点文件锁：${held.why}`);
    let blocked = null;
    while (!blocked && Date.now() < deadline && findProc(work, 'sync-config.js') === sync) {
      // 认锁文件的路径（这一跑独有的临时路径），不认父进程：sync-config 是 execSync 经 sh 起的，flock 是它的孙子。
      // 本进程自己那个 flock 的 cwd 不是 `work`，findProc 按 cwd 已经把它排除了。
      blocked = findProc(work, process.env.AI1ST_SITE_FILES_LOCK);
      if (!blocked) await sleep(20);
    }
    if (!blocked) { held.release(); die('派生没有在写盘前去拿站点文件锁（等不到它的 flock 子进程）—— 这一格要的时序立不起来'); }
    how = '派生读完菜单、卡在写盘前（它的 flock 子进程已出现）';
  }
  const nav = JSON.parse(fs.readFileSync(path.join(work, NAV), 'utf8'));
  nav.header.buttons = [...(nav.header.buttons || []), { label: 'SAVED-IN-THE-EDITOR', href: '/contact' }];
  fs.writeFileSync(path.join(work, NAV), JSON.stringify(nav, null, 2));
  git(`git add -- ${NAV} && git commit -qm "Edit the website's layout"`);
  const editorAt = Date.now();
  held.release();
  console.log(`  （编辑器那一笔在${how}写下并提交）`);

  const code = await exited;
  const terminal = terminalOf(outOf());
  const siteCss = path.join(work, 'public', 'site.css');
  if (!fs.existsSync(siteCss) || fs.statSync(siteCss).mtimeMs <= editorAt) {
    die('尺子没咬到窗口：AI 那一轮的派生写盘不在编辑器那一笔之后（public/site.css 的改动时间更早）—— 这一格的绿/红都不算数');
  }

  console.log('验收 4：AI 改站与编辑器存盘撞一次');
  check(code === 0 && terminal.length === 1 && terminal[0].event === 'edit-complete',
    `① AI 那一轮的终态是 edit-complete（rc=${code}，终态 ${JSON.stringify(terminal.map((e) => e.event))}）`, errOf().slice(-400));
  let headAbout = '';
  try { headAbout = git(`git show HEAD:${ABOUT}`); } catch (e) { headAbout = ''; }
  check(headAbout.includes('edited by the AI (#1807)'), '② AI 改的那一页在 HEAD 里');
  const workNav = fs.readFileSync(path.join(work, NAV), 'utf8');
  let headNav = '';
  try { headNav = git(`git show HEAD:${NAV}`); } catch (e) { headNav = ''; }
  check(workNav.includes('SAVED-IN-THE-EDITOR') && headNav.includes('SAVED-IN-THE-EDITOR'),
    '③ 编辑器那颗按钮在工作树里、也在 HEAD 里',
    `工作树 buttons=${JSON.stringify(JSON.parse(workNav).header.buttons)}`);
  check(workNav === headNav, '④ HEAD 与工作树的 navigation.json 逐字节相同');
}

// ── 场景 B：AI 改站自己那两处写（write_file、提交）排在站点文件锁后面 ────────────────────────────────
// 拿掉 edit-site.js 里 write_file 或 `git add -A && git commit` 那一处的锁，⑤ / ⑥ 当场红（#1807 验收 5）。
async function scenarioEditWaits(port) {
  const { work, git } = makeSite('b');
  const lockPath = process.env.AI1ST_SITE_FILES_LOCK;
  const aboutBefore = fs.readFileSync(path.join(work, ABOUT), 'utf8');
  const headBefore = git('git rev-parse HEAD').trim();
  fs.writeFileSync(path.join(root, 'gate'), '1');
  fs.rmSync(path.join(root, 'hit'), { force: true });
  fs.rmSync(path.join(root, 'go'), { force: true });
  const waitFor = async (what, cond, ms = 60000) => {
    const end = Date.now() + ms;
    while (!cond()) { if (Date.now() > end) die(`等不到：${what}`); await sleep(20); }
  };
  // 等「它去拿锁了」最多 ms：等不到**不**判跑不起来 —— 拿掉锁的那种变异正是等不到，它该落在下面那条断言上（红），不是 exit 2。
  const waitUpTo = async (cond, ms) => { const end = Date.now() + ms; while (!cond() && Date.now() < end) await sleep(20); };

  let held = await lock.hold();
  if (!held.locked) die(`测试自己拿不到站点文件锁：${held.why}`);
  const { exited, out: outOf, errOut: errOf } = startEdit(work, port);
  await waitUpTo(() => findProc(work, lockPath) || fs.readFileSync(path.join(work, ABOUT), 'utf8') !== aboutBefore, 15000);
  await sleep(1000);
  const aboutWhileHeld = fs.readFileSync(path.join(work, ABOUT), 'utf8');
  held.release();
  check(aboutWhileHeld === aboutBefore, '⑤ 别人拿着站点文件锁时，AI 的 write_file 一个字节都没写（它在等锁）');

  await waitFor('AI 那一轮走到「问预览活不活」（同步之后、提交之前）', () => fs.existsSync(path.join(root, 'hit')));
  held = await lock.hold();
  if (!held.locked) die(`测试自己拿不到站点文件锁：${held.why}`);
  fs.writeFileSync(path.join(root, 'go'), '1');
  await waitUpTo(() => findProc(work, lockPath) || git('git rev-parse HEAD').trim() !== headBefore, 5000);
  await sleep(1000);
  const headWhileHeld = git('git rev-parse HEAD').trim();
  held.release();
  check(headWhileHeld === headBefore, '⑥ 别人拿着站点文件锁时，AI 那一轮没有提交（它在等锁）');
  fs.rmSync(path.join(root, 'gate'), { force: true });

  const code = await exited;
  const terminal = terminalOf(outOf());
  let headAbout = '';
  try { headAbout = git(`git show HEAD:${ABOUT}`); } catch (e) { headAbout = ''; }
  check(code === 0 && terminal.length === 1 && terminal[0].event === 'edit-complete' && headAbout.includes('edited by the AI (#1807)'),
    `⑦ 锁放了之后那一轮照常做完、提交进 HEAD（rc=${code}，终态 ${JSON.stringify(terminal.map((e) => e.event))}）`, errOf().slice(-400));
}

(async () => {
  const port = startPreviewStandIn();
  await scenarioCollide(port);
  if (TRIGGER !== 'timer') {
    console.log('AI 改站自己那两处写排在站点文件锁后面');
    await scenarioEditWaits(port);
  }
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch((e) => die(e && e.stack));
