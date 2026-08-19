#!/usr/bin/env node
/**
 * edit-site-chain.test.js — 站容器里那条 AI 聊天编辑链的两条承重行为（#1103）。
 *
 *   跑法:  node scripts/lib/edit-site-chain.test.js   （或 `npm run test:scripts`，它按文件名发现）
 *   退出码: 0 全过 · 1 有失败 · 2 跑不起来（**不许当成通过**）
 *
 * ══ 为什么要有它 ═══════════════════════════════════════════════════════════════════════════════
 * #1087 给 `edit-site.js` 加了两条行为，其中一条**没有任何东西盯着**（#1103 正文的表）：
 *
 *   · 哪些文件可写          → `lib/editable-files.test.js` 盯着（活的）
 *   · 同步失败就不保存      → **没有人**。QA3 在 #1087 终审时把这个判断整个撤掉，全套测试照样全绿
 *   · write_file 真问过白名单 → 只测「调用存在」。QA3 保留调用、把判决结果丢弃，测试仍然全绿
 *
 * 这两条的失败方向都是**静默**的：站照样答「Changes applied.」，而坏值进了站仓 —— 站仓是这个站的
 * 真相来源，坏值一旦落进去，它以后每一次构建都是死的。没有一条会让构建变红。
 *
 * ══ 为什么是「起一个真进程」，不是 require 它 ═══════════════════════════════════════════════════
 * `edit-site.js` 没有 `module.exports`，而且文件末尾直接 `main()`（`:17` 还在顶层 require SDK）——
 * require 它等于**真跑一次编辑**。所以这里把它当成它本来的样子跑：一个读 stdin、吐 JSON-lines 的
 * 进程。好处是这两格测的是**真的那条链**（真的 sync-config、真的 git、真的白名单、真的落盘），
 * 唯一被换掉的是**模型**。
 *
 * 🔴 换模型走 `node --require <钩子>`：钩子挂在 `Module._load` 上，把 `@anthropic-ai/sdk` 换成一份
 *    按脚本回放的假客户端。不改 `edit-site.js` 一个字节 —— 被测对象必须是仓里那一份。
 * 🔴 回放的响应**按真 API 的形状写全**（`id` / `type` / `role` / `model` / `content` / `stop_reason`
 *    / `stop_sequence` / `usage`）。只写「我这一格用得到的字段」会在下游读到别的字段时静默出错，
 *    而那种错看起来像被测代码的毛病。
 *
 * ══ 🔴 为什么必须整棵拷到临时目录 ══════════════════════════════════════════════════════════════
 * `edit-site.js` 的自动保存是 `execSync('git add -A && git commit …', { cwd: rootDir })` 加
 * `git push origin main`，而 `rootDir` 就是脚本的上级目录（`templates/nextjs`）。在开发机上那是
 * **本仓的工作区**，`origin` 是真的 GitHub。就地跑一次 = 把整个工作区提交并推上去。
 * 所以每一格都在自己的临时目录里跑，那里有自己的 git 仓和一个本地 bare `origin` ——
 * 这也正是「没有 commit、没有 push」这两句话能被断言的前提：得有一个说得清的仓可以看。
 */

'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const cp = require('child_process');

const NEXT = path.resolve(__dirname, '..', '..');
const EDIT_SITE = path.join(NEXT, 'scripts', 'edit-site.js');

let pass = 0; let fail = 0;
const ok = (m) => { pass += 1; console.log(`  ✅ ${m}`); };
const bad = (m) => { fail += 1; console.log(`  ❌ ${m}`); };
const die = (m) => { console.error(`🔴 跑不起来: ${m}`); process.exit(2); };

if (!fs.existsSync(EDIT_SITE)) die(`找不到被测对象 ${EDIT_SITE}`);

/** 同步的等待 —— 这个文件里没有 async，而下面要等一个**别的进程**开始听端口。 */
const sleepSync = (ms) => { Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms); };

// ── 收尾：临时目录 + 替身进程 ────────────────────────────────────────────────────────────────────
//
// 每一格自己造一棵树（~11 MB）。不收尾的话共享开发机上会攒 —— r1 跑完那几轮在 /tmp 留了 447 MB。
// 🔴 收尾挂在 `process.on('exit')` 上，不是写在最后一行：`die()` 走的是 `process.exit(2)`，
//    断言失败走 `process.exit(1)`，两条路都不会执行"最后一行"。
// 排查用 `EDIT_CHAIN_KEEP=1` 留下来。
const TEMP = [];
const CHILDREN = [];
const KEEP = process.env.EDIT_CHAIN_KEEP === '1';
function temp(prefix) {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  TEMP.push(d);
  return d;
}
process.on('exit', () => {
  for (const c of CHILDREN) { try { c.kill(); } catch (e) { /* 已经死了 */ } }
  if (KEEP) {
    if (TEMP.length) console.log(`\n📌 EDIT_CHAIN_KEEP=1 ⟹ 留着 ${TEMP.length} 个临时目录，第一个是 ${TEMP[0]}`);
    return;
  }
  // 收尾失败不许改变这一跑的结论 —— 结论已经印出来了，这里只是打扫。
  for (const d of TEMP) { try { fs.rmSync(d, { recursive: true, force: true }); } catch (e) { /* 打扫不成不改结论 */ } }
});

// ── 预览端口的替身 ──────────────────────────────────────────────────────────────────────────────
//
// `edit-site.js` 在保存前先问一次预览服务器活不活：5 秒轮询 `http://localhost:<PREVIEW_PORT>/`，
// 读到 0（没人应答）就再进 `waitForDevServer(port, 30000)` —— **每一格纯睡 35 秒**。
// 它自己的注释就写着规避法（`edit-site.js` 里 grep `point PREVIEW_PORT at a stand-in` 那一行：
// "…a stand-in that always answers 200, so this branch is never reached"）。照它做，全套 ~85s → ~15s。
// 🔴 那里有意不写行号：`edit-site.js` 是别的票也在改的文件（#1102 就在改），行号落笔即漂。
//
// 🔴 替身必须是**另一个进程**：这个文件用 `spawnSync` 跑被测进程，那期间本进程的事件循环是
//    停着的 ⟹ 进程内的 http server 一个请求都答不了，被测代码照样读到 0，35 秒照样睡。
// 🔴 端口用 0 让内核挑：这台开发机上六个窗格同时在干活，写死一个端口就是跟别人抢。
function startPreviewStandIn() {
  const dir = temp('edit-standin-');
  const portFile = path.join(dir, 'port');
  const script = path.join(dir, 'standin.js');
  fs.writeFileSync(script, `
    'use strict';
    const http = require('http');
    const fs = require('fs');
    const s = http.createServer((req, res) => { res.writeHead(200, { 'Content-Type': 'text/html' }); res.end('<html>stand-in</html>'); });
    s.listen(0, '127.0.0.1', () => { fs.writeFileSync(process.argv[2], String(s.address().port)); });
  `);
  const child = cp.spawn(process.execPath, [script, portFile], { stdio: 'ignore' });
  child.unref();
  CHILDREN.push(child);

  const deadline = Date.now() + 20000;
  let port = '';
  while (Date.now() < deadline) {
    if (fs.existsSync(portFile)) { port = fs.readFileSync(portFile, 'utf8').trim(); if (port) break; }
    sleepSync(50);
  }
  if (!port) die('预览替身没起来（没写下端口）—— 不许在这上面取读数');

  // 🔴 判据不是"它写下了端口"，是**拿被测代码会拿的那个读数**问一次：GET / 是不是 200。
  const probe = cp.spawnSync(process.execPath, ['-e',
    `require('http').get('http://localhost:${port}/', (r) => { process.exit(r.statusCode === 200 ? 0 : 9); })`
    + `.on('error', () => process.exit(8));`], { encoding: 'utf8', timeout: 15000 });
  if (probe.status !== 0) die(`预览替身在 ${port} 上不答 200（探针 rc=${probe.status}）`);
  return port;
}
const PREVIEW_STANDIN_PORT = startPreviewStandIn();

// ── 假客户端：按脚本回放，形状照真 API 写全 ─────────────────────────────────────────────────────
const STUB = `
'use strict';
const Module = require('module');
const fs = require('fs');
const script = JSON.parse(fs.readFileSync(process.env.EDIT_STUB_SCRIPT, 'utf8'));
let turn = 0;
class FakeAnthropic {
  constructor() {
    this.messages = {
      create: async (req) => {
        fs.appendFileSync(process.env.EDIT_STUB_CALLS,
          JSON.stringify({ turn, messages: req.messages }) + '\\n');
        const r = script[turn];
        turn += 1;
        if (!r) throw new Error('回放脚本用完了，但被测代码又要了一轮 —— 脚本写少了');
        return r;
      },
    };
  }
}
const realLoad = Module._load;
Module._load = function (request, parent, isMain) {
  if (request === '@anthropic-ai/sdk') return FakeAnthropic;
  return realLoad.apply(this, arguments);
};
`;

/** 一条 assistant 回复，字段按真 Messages API 写全。 */
function reply(content, stopReason = 'end_turn') {
  return {
    id: 'msg_test',
    type: 'message',
    role: 'assistant',
    model: 'claude-sonnet-4-6',
    content,
    stop_reason: stopReason,
    stop_sequence: null,
    usage: { input_tokens: 10, output_tokens: 20 },
  };
}
const textBlock = (text) => ({ type: 'text', text });
const writeCall = (id, filePath, content) => ({
  type: 'tool_use', id, name: 'write_file', input: { path: filePath, content },
});

// ── 造一棵只属于这一格的树 ──────────────────────────────────────────────────────────────────────
//
// 拷 templates/nextjs（去掉 node_modules / out / .next，node_modules 用 symlink 借），在里面
// `git init` 并配一个本地 bare `origin`。于是 `git add -A && commit && push origin main` 有地方去，
// 而「有没有 commit、有没有 push」两个问题都有确定的答案。
function makeRoot(label) {
  const root = temp(`edit-chain-${label}-`);
  const work = path.join(root, 'nextjs');
  cp.execSync(`cp -a --no-dereference "${NEXT}" "${work}"`, { stdio: 'pipe' });
  for (const junk of ['out', '.next', '.out-backup', '.out-temp', 'site']) {
    fs.rmSync(path.join(work, junk), { recursive: true, force: true });
  }
  fs.rmSync(path.join(work, 'node_modules'), { recursive: true, force: true });
  fs.symlinkSync(path.join(NEXT, 'node_modules'), path.join(work, 'node_modules'));

  const bare = path.join(root, 'origin.git');
  cp.execSync(`git init --bare -q "${bare}"`, { stdio: 'pipe' });
  const git = (c) => cp.execSync(c, { cwd: work, stdio: 'pipe' });
  git('git init -q -b main');
  git('git config user.email t@t.test && git config user.name t');
  git(`git remote add origin "${bare}"`);
  return { root, work, bare, git };
}

/**
 * 一份**真的**站，用仓里那条 skipAI 建站路造出来（不调 AI、不花钱 —— `create-site.js` 的 skipAI
 * 分支在检查 `ANTHROPIC_API_KEY` 之前就返回了）。
 *
 * 🔴 不手搓这份夹具。我第一版是手搓的最小 JSON，结果 `sync-config.js` 在**第一行**就退出
 *    （它无条件要 `site/brand.json`，多语言站在 locale 目录之外**还**有一份），于是①那四条断言
 *    全是绿的、却全都在测「我的夹具是坏的」——**是下面②那条反向对照把它抓出来的**。
 *    用建站脚本自己产出的站，形状就永远是今天真站的形状。
 */
function writeSite(work) {
  const payload = JSON.stringify({
    siteId: 'edittest', companyName: 'Northside Auto Care', industry: 'auto repair',
    location: 'Toronto', skipAI: true, language: 'en',
  });
  const r = cp.spawnSync(process.execPath, [path.join(work, 'scripts', 'create-site.js')], {
    input: payload, cwd: work, encoding: 'utf8',
    env: { ...process.env, ANTHROPIC_API_KEY: undefined }, timeout: 180000,
  });
  const site = path.join(work, 'site');
  if (!fs.existsSync(path.join(site, 'brand.json'))) {
    die(`夹具立不起来：create-site.js 的 skipAI 路没造出 site/brand.json\n${(r.stderr || '').slice(-600)}`);
  }
  return site;
}

/** 这份夹具是不是**真的**能通过 sync-config —— 立不起来就 exit 2，不给读数。 */
function assertSyncsClean(work, where) {
  const r = cp.spawnSync(process.execPath, [path.join(work, 'scripts', 'sync-config.js')], {
    cwd: work, encoding: 'utf8', timeout: 180000,
  });
  if (r.status !== 0) {
    die(`${where}：夹具本身就过不了 sync-config（rc=${r.status}）⟹ 这一格测的会是「我的夹具是坏的」，`
      + `不是被测的行为。\n${(r.stderr || '').slice(-600)}`);
  }
}

/**
 * 跑一次真的编辑。返回这一跑留下的全部痕迹 —— 事件、退出码、仓里多了几个 commit、bare 上有没有。
 */
function runEdit(ctx, script) {
  const dir = temp('edit-stub-');
  const stubPath = path.join(dir, 'stub.js');
  const scriptPath = path.join(dir, 'script.json');
  const callsPath = path.join(dir, 'calls.jsonl');
  fs.writeFileSync(stubPath, STUB);
  fs.writeFileSync(scriptPath, JSON.stringify(script));
  fs.writeFileSync(callsPath, '');

  const before = ctx.git('git rev-list --count HEAD').toString().trim();
  const r = cp.spawnSync(process.execPath, ['--require', stubPath, path.join(ctx.work, 'scripts', 'edit-site.js')], {
    input: JSON.stringify({ siteId: 'test1234', message: 'change something' }),
    cwd: ctx.work,
    encoding: 'utf8',
    env: {
      ...process.env,
      ANTHROPIC_API_KEY: 'stub-not-used',
      EDIT_STUB_SCRIPT: scriptPath,
      EDIT_STUB_CALLS: callsPath,
      // 指向恒答 200 的替身 ⟹ 保存前那道预览健康检查一次就过，不进它那 35 秒的等待分支。
      PREVIEW_PORT: PREVIEW_STANDIN_PORT,
    },
    timeout: 120000,
  });
  const after = ctx.git('git rev-list --count HEAD').toString().trim();
  let pushed = '';
  try { pushed = cp.execSync(`git --git-dir="${ctx.bare}" rev-list --count main`, { stdio: 'pipe' }).toString().trim(); }
  catch (e) { pushed = '0'; }   // bare 上还没有 main 这个 ref

  const events = r.stdout.split('\n').filter(Boolean).map((l) => {
    try { return JSON.parse(l); } catch (e) { return { event: '(不是 JSON)', raw: l }; }
  });
  return {
    events, rc: r.status, stderr: r.stderr || '',
    commitsBefore: Number(before), commitsAfter: Number(after), pushedCommits: Number(pushed),
    requests: fs.readFileSync(callsPath, 'utf8').split('\n').filter(Boolean).map(JSON.parse),
  };
}

const ev = (res, name) => res.events.filter((e) => e.event === name);

/**
 * 第 `turn` 轮请求里，`toolUseId` 那次工具调用的**回执自己的 content**（`edit-site.js` 把
 * `JSON.stringify(result)` 塞进 `tool_result.content`）。找不到就 null。
 *
 * 🔴 存在的理由：整轮请求 blob 里还有**假模型自己说的话**，在它上面 grep 会命中测试自己喂进去的
 *    字面量 —— 断言因此恒绿（#1103 r1 中等①）。要问「模型收到了什么回执」，就只看那条回执。
 */
function toolResultContent(res, turn, toolUseId) {
  const call = res.requests.find((c) => c.turn === turn);
  if (!call || !Array.isArray(call.messages)) return null;
  for (const msg of call.messages) {
    if (!Array.isArray(msg.content)) continue;
    for (const block of msg.content) {
      if (block && block.type === 'tool_result' && block.tool_use_id === toolUseId) return String(block.content);
    }
  }
  return null;
}

// ══ ① 同步失败 ⟹ 发一条 error，而且没有 commit、没有 push ═══════════════════════════════════════
//
// 触发的方式是**真的写坏一个文件**，不是预先把站弄坏：让模型把 `en/services.json` 写成一个对象。
// 它是站的内容文件（白名单收），是合法 JSON（write_file 的 JSON 校验过），而 `sync-config.js`
// 当场拒绝（`services.json must be an array`）—— 这正是 #1087 要治的那个形状：这次编辑写出来的
// 东西构建不出来。
console.log('① 同步失败：发 error · 没有 commit · 没有 push');
{
  const ctx = makeRoot('syncfail');
  writeSite(ctx.work);
  assertSyncsClean(ctx.work, '①');
  ctx.git('git add -A && git commit -q -m base && git push -q origin main');

  const res = runEdit(ctx, [
    reply([textBlock('Updating services.'), writeCall('t1', 'en/services.json', JSON.stringify({ oops: 'an object, not an array' }))], 'tool_use'),
    reply([textBlock('Changes applied.')], 'end_turn'),
  ]);

  const errors = ev(res, 'error');
  const complete = ev(res, 'edit-complete');
  if (errors.length === 1 && !complete.length) {
    ok(`发了一条 error、没有 edit-complete —— 「${String(errors[0].message).split('\n')[0].slice(0, 60)}…」`);
  } else {
    bad(`事件不对：error ${errors.length} 条 · edit-complete ${complete.length} 条`
      + `（全部事件：${res.events.map((e) => e.event).join(' ')}）`);
  }
  // 🔴 这一格 r1 是恒绿的，QA1 抓出来的（#1103 r1 中等②）：`/services\.json must be an array/`
  //    分不开两条路 —— Node 的 `execSync` 抛出的 `e.message` **本身就是**
  //    `"Command failed: <cmd>\n\n<stderr>"`，stderr 原文已经在里面。所以撤掉 #1087 那句「优先取
  //    stderr」的修法（`syncError = String(e.message)`），这个断言照样绿。
  //    能分开两条路的是**只有 e.message 那条才有**的东西：`Command failed:` 这三个词。
  //    ⟹ 判据两半都要：① 真原因在里面 ② 而且不是裹在 `Command failed:` 那层壳里。
  const errMsg = errors.length ? String(errors[0].message) : '';
  const hasReason = /services\.json must be an array/.test(errMsg);
  const wrapped = /Command failed/.test(errMsg);
  if (hasReason && !wrapped) {
    ok('那条 error 里是 sync-config 自己写在 stderr 上的原因，没裹着 execSync 那句「Command failed」');
  } else if (!errors.length) {
    bad('error 没有把真原因带出来：(没有 error)');
  } else if (!hasReason) {
    bad(`error 里没有真原因：${errMsg.slice(0, 160)}`);
  } else {
    bad(`error 裹在 execSync 的壳里（含「Command failed」）⟹ 取的是 e.message，不是 stderr：${errMsg.slice(0, 160)}`);
  }
  if (res.commitsAfter === res.commitsBefore) ok(`没有 commit（前后都是 ${res.commitsBefore} 个）`);
  else bad(`🔴 提交了：${res.commitsBefore} → ${res.commitsAfter} 个 commit —— 说了「没有保存」却保存了`);
  if (res.pushedCommits === 1) ok(`没有 push（bare 上仍然是那 1 个 base commit）`);
  else bad(`🔴 push 了：bare 上现在有 ${res.pushedCommits} 个 commit`);
}

// ══ ② 反向对照：同一条路，写的东西是好的 ⟹ 真的会 commit + push ══════════════════════════════
//
// 少了这一格，上面那四条可能只是「这条链根本走不到保存」—— 那样它对本票要守的性质一个字都没说。
console.log('\n② 反向对照：写的东西是好的 ⟹ 走到底、真的保存');
{
  const ctx = makeRoot('syncok');
  writeSite(ctx.work);
  assertSyncsClean(ctx.work, '②');
  ctx.git('git add -A && git commit -q -m base && git push -q origin main');

  const good = [{ id: 's1', name: 'Renamed', shortDescription: 'a', fullDescription: 'b', icon: 'leaf', features: [], products: [] }];
  const res = runEdit(ctx, [
    reply([textBlock('Renaming the service.'), writeCall('t1', 'en/services.json', JSON.stringify(good, null, 2))], 'tool_use'),
    reply([textBlock('Changes applied.')], 'end_turn'),
  ]);

  const complete = ev(res, 'edit-complete');
  if (complete.length === 1 && !ev(res, 'error').length) ok('发了 edit-complete、没有 error');
  else bad(`事件不对：edit-complete ${complete.length} · error ${ev(res, 'error').length}（${res.events.map((e) => e.event).join(' ')}）`);
  if (res.commitsAfter === res.commitsBefore + 1) ok(`commit 了一个（${res.commitsBefore} → ${res.commitsAfter}）`);
  else bad(`没有 commit：${res.commitsBefore} → ${res.commitsAfter} —— 那么上面①的「没有 commit」什么都没证明`);
  if (res.pushedCommits === 2) ok('push 到 origin 了（bare 上 2 个 commit）');
  else bad(`没有 push：bare 上 ${res.pushedCommits} 个 commit —— ①的「没有 push」什么都没证明`);
  const onDisk = JSON.parse(fs.readFileSync(path.join(ctx.work, 'site', 'en', 'services.json'), 'utf8'));
  if (Array.isArray(onDisk) && onDisk[0].name === 'Renamed') ok('改动真的落盘了（services.json 第一项现在叫 Renamed）');
  else bad(`没落盘：${JSON.stringify(onDisk).slice(0, 80)}`);
}

// ══ ③ 白名单的判决**真的被拿来拦截**，不只是被调用 ═══════════════════════════════════════════
//
// QA3 在 #1087 里的那次故意改坏就是「保留 `writeRejection(relPath)` 这次调用、把结果丢掉」，而当时
// 全套测试照样绿。所以这一格问的不是「有没有调用它」，是**落盘那一侧有没有被拦住**：
// 文件的字节要一个都没变，而且拒绝的理由要回到模型手里（不然模型不知道该换个说法）。
console.log('\n③ 白名单：theme.json 写不进去，理由回到模型手里，文件一个字节没变');
{
  const ctx = makeRoot('whitelist');
  const site = writeSite(ctx.work);
  assertSyncsClean(ctx.work, '③');
  // 用建站脚本自己写下的那份 theme.json，不覆盖它 —— 被测的是「这条路能不能改它」，
  // 那就该拿这个站真正带着的那一份来问。
  const themePath = path.join(site, 'theme.json');
  if (!fs.existsSync(themePath)) die('③：建出来的站里没有 theme.json，这一格没有对象可验');
  const beforeBytes = fs.readFileSync(themePath);
  ctx.git('git add -A && git commit -q -m base && git push -q origin main');

  const res = runEdit(ctx, [
    reply([textBlock('Switching the theme.'), writeCall('t1', 'theme.json', JSON.stringify({ themeId: 'luxury-dark', applied: true }))], 'tool_use'),
    reply([textBlock('Done.')], 'end_turn'),
  ]);

  const afterBytes = fs.readFileSync(themePath);
  if (Buffer.compare(beforeBytes, afterBytes) === 0) ok('theme.json 逐字节没变 —— 判决真的拦在落盘之前');
  else bad(`🔴 theme.json 被改了：${afterBytes.toString().slice(0, 90)}`);

  // 拒绝的理由有没有回到模型手里 —— 只看第二轮请求里**那条 tool_result 自己的 content**。
  //
  // 🔴 r1 这里打的是 `JSON.stringify(整个第二轮请求)`，而那个 blob 里**装着假模型自己刚说的那句话**
  //    （`'Switching the theme.'`，就是上面那份回放脚本里写的字面量）。于是 `/theme/i` 命中的是测试
  //    自己喂进去的话，永远到不了拒绝理由那一侧 —— 恒绿。QA1 抓出来的（#1103 r1 中等①）：
  //    把 theme.json 的理由整句换成 `'Invalid JSON: …'`（正是它点名要排除的那种话）也照样绿。
  const reason = toolResultContent(res, 1, 't1');
  if (reason === null) {
    bad('第二轮请求里找不到 t1 那条 tool_result —— 模型根本没收到任何回执');
    bad('（同上）没有理由可判方向');
  } else {
    if (/is not edited here/.test(reason)) ok('拒绝的理由回到了模型手里（下一轮那条 tool_result 里带着它）');
    else bad(`模型没收到理由，它不知道该换个说法：${reason.slice(0, 200)}`);
    // 判据用**只属于 theme.json 那条理由**的话（`belongs to the theme picker`，
    // `lib/editable-files.js` 的 REJECT_REASON['theme.json']）。加一半反向：它不能是
    // 「你的 JSON 写错了」那种指错方向的话 —— write_file 里白名单排在 JSON.parse 前面就是为了这个。
    const pointsAtOwner = /belongs to the theme picker/.test(reason);
    const looksLikeJsonComplaint = /Invalid JSON/.test(reason);
    if (pointsAtOwner && !looksLikeJsonComplaint) {
      ok('理由说清了它归谁管（换装弹窗），不是一句「你的 JSON 写错了」');
    } else {
      bad(`理由指错了方向（点名 owner=${pointsAtOwner} · 像 JSON 报错=${looksLikeJsonComplaint}）：${reason.slice(0, 200)}`);
    }
  }
}

// ══ ④ 反向对照：白名单收的那个文件，同一条路真的写得进去 ═══════════════════════════════════════
//
// 少了这一格，③ 的「没变」可能只是「write_file 根本不落盘」。
console.log('\n④ 反向对照：白名单收的文件，同一条路真的写得进去');
{
  const ctx = makeRoot('whitelist-ok');
  const site = writeSite(ctx.work);
  assertSyncsClean(ctx.work, '④');
  ctx.git('git add -A && git commit -q -m base && git push -q origin main');
  const target = path.join(site, 'en', 'pages', 'home.json');
  const before = fs.readFileSync(target, 'utf8');
  const page = JSON.parse(before);
  page.title = 'Changed By Test';

  const res = runEdit(ctx, [
    reply([textBlock('Renaming the page.'), writeCall('t1', 'en/pages/home.json', JSON.stringify(page, null, 2))], 'tool_use'),
    reply([textBlock('Done.')], 'end_turn'),
  ]);
  const after = fs.readFileSync(target, 'utf8');
  if (before !== after && JSON.parse(after).title === 'Changed By Test') {
    ok('home.json 写进去了 —— 所以③那个「没变」是白名单拦的，不是这条路不落盘');
  } else {
    bad(`白名单收的文件也没写进去，③那一格因此什么都没证明（事件：${res.events.map((e) => e.event).join(' ')}）`);
  }
}

console.log(`\n══ 汇总: 通过 ${pass} · 失败 ${fail} ══`);
process.exit(fail ? 1 : 0);
