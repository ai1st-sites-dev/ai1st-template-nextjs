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
          JSON.stringify({ turn, messages: req.messages,
            hasTools: Array.isArray(req.tools), hasSystem: req.system !== undefined,
            maxTokens: req.max_tokens }) + '\\n');
        const r = script[turn];
        turn += 1;
        if (!r) throw new Error('回放脚本用完了，但被测代码又要了一轮 —— 脚本写少了');
        // #1200：一轮也可以是"provider 拒收"。形状照真 SDK 的 APIError 写：status 是判据，
        // message 里是 provider 的原话（本票的判据**不读**它，正因如此它才必须在这里出现）。
        if (r.__throw) {
          const e = new Error(r.__throw.message);
          e.status = r.__throw.status;
          e.error = r.__throw.error;
          throw e;
        }
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
function runEdit(ctx, script, stdinExtra = {}) {
  const dir = temp('edit-stub-');
  const stubPath = path.join(dir, 'stub.js');
  const scriptPath = path.join(dir, 'script.json');
  const callsPath = path.join(dir, 'calls.jsonl');
  fs.writeFileSync(stubPath, STUB);
  fs.writeFileSync(scriptPath, JSON.stringify(script));
  fs.writeFileSync(callsPath, '');

  const before = ctx.git('git rev-list --count HEAD').toString().trim();
  const r = cp.spawnSync(process.execPath, ['--require', stubPath, path.join(ctx.work, 'scripts', 'edit-site.js')], {
    input: JSON.stringify({ siteId: 'test1234', message: 'change something', ...stdinExtra }),
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

  // 🔴 #1104 r5 —— 写成功的那份回执里必须带 `path`。
  //
  // 为什么值一格：`path` 是 #1102（`5ccfb541`）加在 `write_file` 那条 return 上的，而**本票也在同一行上
  // 加东西**（放行后要把后果说给老板听）。两张票冲突在同一行，rebase 时「取一侧」就是静默删掉另一张票的
  // 交付 —— 而我实测过它有多静默：把 `path` 那一行删掉，`edit-site-chain` / `editable-files` /
  // `navigation-owned` 三套测试**全绿**（16/0 · 8/0 · 21/0），全仓没有一处会说话。反过来删掉本票那一侧
  // 立刻红（navigation-owned 20/1）—— 两侧不对称，这一格补的就是没人守的那一侧。
  //
  // 📌 它断言的是「回执里有这个字段」，不是它的用途：`result.path` 在 edit-site.js 里没有消费者，整个
  //    返回值被 JSON.stringify 塞进发回模型的 tool_result，所以这就是它唯一能被观测到的地方。
  {
    const receipt = toolResultContent(res, 1, 't1');
    if (receipt === null) {
      bad('④b 前提不成立：第二轮请求里找不到 t1 那条 tool_result —— 回执里有没有 path 问不出来');
    } else {
      let parsed = null;
      try { parsed = JSON.parse(receipt); } catch { /* 下面按 null 报 */ }
      if (parsed && parsed.path === 'en/pages/home.json') {
        ok('④b 写成功的回执里带着 path（#1102 的字段，本票在同一行上改过东西，别把它挤掉）');
      } else {
        bad('④b 回执里没有 #1102 那个 path 字段（或值不对）'
          + ` —— 读到的是 ${receipt.slice(0, 160)}`);
      }
    }
  }
}

// ══ ⑤ 同一个文件用两种路径写法写两遍 ⟹ 回滚仍然回到「这次编辑之前」════════════════════════════
//
// 🔴 这一格是 QA3 在 #1102 r2 上打回的那条阻断的钉子。它的成因不在回滚那三支里，而在**快照的键**：
// r2 用模型给的原始字符串当键，而同一个物理文件有多种写法（`en/pages/about.json` /
// `./en/pages/about.json` / `en//pages/about.json` / `en/./pages/about.json` —— `validatePath` 只拦
// `..` 与绝对路径，`writeRejection` 自己归一化所以四种一视同仁地放行）。于是「同一个文件只记第一次」
// 那条纪律被写法拆成两条快照，第二条记下的「写之前」是**第一笔写完之后**的样子；回滚按插入序两条都
// 写回、后写的盖住先写的 ⟹ 磁盘上留下第一笔的改动，而回滚自报 `restored 2 · failed 0`，
// 下一次成功的编辑把它带进 commit（本票正文判据 1 的字面违反）。
//
// 判据两半，缺一不可：
//   ① 回滚之后那个文件与「这次编辑之前」**逐字节相同**，工作树里它不脏 ← 真正要保的性质
//   ② `restored` 的**计数**：别名收成一条快照 ⟹ 两个文件被写、`restored 2`。修法没生效时是 3。
//      光有①不够 —— ① 在「回滚碰巧顺序反过来」的世界里也可能绿；计数直接量的是「算成几个文件」。
console.log('\n⑤ 同一个文件两种写法写两遍：回滚回到编辑之前，而且只算一个文件');
{
  const ctx = makeRoot('alias');
  const site = writeSite(ctx.work);
  assertSyncsClean(ctx.work, '⑤');
  ctx.git('git add -A && git commit -q -m base && git push -q origin main');

  const about = path.join(site, 'en', 'pages', 'about.json');
  const beforeBytes = fs.readFileSync(about);
  const page = JSON.parse(beforeBytes.toString('utf8'));
  const one = JSON.stringify({ ...page, title: 'EDIT ONE' }, null, 2);
  const two = JSON.stringify({ ...page, title: 'EDIT TWO' }, null, 2);

  // 三次写：about.json 两种写法各一次（同一个物理文件）+ services.json 写成对象让 sync 当场失败
  // （与①同一个触发器 —— 真的写坏一个文件，不是预先把站弄坏）。
  const res = runEdit(ctx, [
    reply([
      textBlock('Editing the about page twice, then services.'),
      writeCall('t1', 'en/pages/about.json', one),
      writeCall('t2', './en/pages/about.json', two),
      writeCall('t3', 'en/services.json', JSON.stringify({ oops: 'an object, not an array' })),
    ], 'tool_use'),
    reply([textBlock('Changes applied.')], 'end_turn'),
  ]);

  // 前提：这一跑真的走到了「同步失败 ⟹ 回滚」那条路。不成立的话下面两条断言什么都没测。
  const errs = ev(res, 'error');
  if (errs.length !== 1 || ev(res, 'edit-complete').length) {
    bad(`⑤ 前提不成立：没走到「同步失败」那条路（事件：${res.events.map((e) => e.event).join(' ')}）`
      + ' ⟹ 下面两条断言不算数');
  } else {
    const afterBytes = fs.readFileSync(about);
    if (afterBytes.equals(beforeBytes)) {
      ok('about.json 回到了这次编辑之前，逐字节相同（两种写法各写了一次）');
    } else {
      const t = (() => { try { return JSON.parse(afterBytes.toString('utf8')).title; } catch (e) { return '(读不出 title)'; } })();
      bad(`🔴 about.json 没回到编辑之前 —— 磁盘上现在是 title=${JSON.stringify(t)}`
        + '，而老板刚被告知「the change was rolled back」');
    }
    const dirty = ctx.git('git status --porcelain -- site/en/pages/about.json').toString().trim();
    if (!dirty) ok('工作树里 about.json 不脏 ⟹ 下一次成功的编辑不会把它带进 commit');
    else bad(`🔴 工作树里 about.json 还带着这次的改动：${dirty}`);

    // 计数那一半。`debug()` 无条件写 stderr（`edit-site.js:49`），所以这行一定在。
    const m = res.stderr.match(/#1102 rollback: restored (\d+) · removed (\d+) · failed (\d+)/);
    if (!m) {
      bad(`⑤ stderr 里找不到那行回滚读数 ⟹ 计数这一半没测到（stderr 尾：${res.stderr.slice(-200)}）`);
    } else if (m[1] === '2' && m[3] === '0') {
      ok(`回滚把别名收成了一个文件：restored 2（about.json + services.json）· failed 0`);
    } else {
      bad(`🔴 回滚算成了 restored ${m[1]} · removed ${m[2]} · failed ${m[3]} —— `
        + '别名被当成了两个不同的文件（同一个物理文件记了两条快照）');
    }
  }
}

// ══ ⑥ 反向对照：两笔【同一种写法】—— 上面那一格不是在测「写两遍就一定坏」═══════════════════════
//
// 少了这一格，⑤ 的绿分不开两件事：「别名被收住了」和「写两遍这条路本来就没问题」。QA3 的对照臂就是
// 这一支（他量到 `restored 1`，回滚后逐字节相同），这里把它钉进仓里。
console.log('\n⑥ 反向对照：两笔同一种写法 —— ⑤ 那一格不是在测「写两遍就一定坏」');
{
  const ctx = makeRoot('alias-control');
  const site = writeSite(ctx.work);
  assertSyncsClean(ctx.work, '⑥');
  ctx.git('git add -A && git commit -q -m base && git push -q origin main');

  const about = path.join(site, 'en', 'pages', 'about.json');
  const beforeBytes = fs.readFileSync(about);
  const page = JSON.parse(beforeBytes.toString('utf8'));

  const res = runEdit(ctx, [
    reply([
      textBlock('Editing the about page twice, same spelling.'),
      writeCall('t1', 'en/pages/about.json', JSON.stringify({ ...page, title: 'EDIT ONE' }, null, 2)),
      writeCall('t2', 'en/pages/about.json', JSON.stringify({ ...page, title: 'EDIT TWO' }, null, 2)),
      writeCall('t3', 'en/services.json', JSON.stringify({ oops: 'an object, not an array' })),
    ], 'tool_use'),
    reply([textBlock('Changes applied.')], 'end_turn'),
  ]);

  const errs = ev(res, 'error');
  if (errs.length !== 1 || ev(res, 'edit-complete').length) {
    bad(`⑥ 前提不成立：没走到「同步失败」那条路（事件：${res.events.map((e) => e.event).join(' ')}）`);
  } else if (fs.readFileSync(about).equals(beforeBytes)) {
    const m = res.stderr.match(/#1102 rollback: restored (\d+) ·/);
    ok(`同写法两笔也回到了编辑之前，逐字节相同（restored ${m ? m[1] : '?'}）`
      + ' ⟹ ⑤ 量的是写法那一维，不是「写两遍」本身');
  } else {
    bad('🔴 连同一种写法写两遍都回不去 —— ⑤ 那一格的读数不能归给「路径写法」这一维');
  }
}


// ══ ⑦ 页脚栏目标题：门放行，而**这个站的页脚版式不画它** ⟹ 回执里必须说出来 ═══════════════════
//
// #1104 r6（QA2 r5 那条中等）。这一格是本轮唯一一条端到端的：**真进程 + 真站 + 真的那道门**，
// 问的是「那句实话有没有到模型手里」。
//
// 🔴 为什么必须在这里而不是只在 navigation-owned.test.js 里：这一轮新加的读数是
//    `readRenderedRegions` —— 它住在 `edit-site.js` 的 `writeCtx` 上（**接线**），而纯函数那边的
//    测试是自己把 `rendered` 递进去的（**代理**）。接线漏了的话，纯函数那边照样全绿，而老板一句话
//    都听不到。QA1 r5 数过：本仓此前没有任何一格驱动这条接线。
//
// 两臂只差一个变量 —— **同一个站、同一次编辑，只换页脚版式**：
//    ⑦  页脚是 `slim-row`（不画栏目标题）⟹ 回执里必须有那句实话
//    ⑦b 页脚是 `multi-column`（真的画它）⟹ 回执里**一句都不许有**（多说就是新的假话）
console.log('\n⑦ 页脚版式不画栏目标题时，回执里带着那句实话（真进程 + 真站）');
{
  /**
   * 跑一次「把页脚第一栏的标题改掉」，返回那次 write_file 的回执。
   * @param {string} footerVariant 这个站的页脚版式（写进 site/theme.json 的 regionLayout）
   */
  const runTitleEdit = (label, footerVariant) => {
    const ctx = makeRoot(label);
    const site = writeSite(ctx.work);

    // 🔴 页脚版式走 theme.json 的 `regionLayout`（#1079 那条路，构建自己也读它）——
    //    **不是**手改组件、也不是给测试开后门。原来那份 theme.json 的别的键一个都不动。
    const themePath = path.join(site, 'theme.json');
    const theme = fs.existsSync(themePath) ? JSON.parse(fs.readFileSync(themePath, 'utf8')) : {};
    theme.regionLayout = { ...(theme.regionLayout || {}), footer: footerVariant };
    fs.writeFileSync(themePath, JSON.stringify(theme, null, 2));
    assertSyncsClean(ctx.work, `⑦(${footerVariant})`);

    // 夹具自检：这个站真的解析成那个版式了吗？（拿构建和门共用的那份实现问，不是相信我刚写进去的键）
    const regions = cp.spawnSync(process.execPath, ['-e',
      'const r = require(process.argv[1]).resolveSiteRegions(process.argv[2]);'
      + 'process.stdout.write(JSON.stringify(r.footerVariants));',
      path.join(ctx.work, 'scripts', 'lib', 'site-regions.js'), site,
    ], { cwd: ctx.work, encoding: 'utf8' });
    const got = (regions.stdout || '').trim();
    if (got !== JSON.stringify([footerVariant])) {
      die(`⑦ 夹具立不起来：想让这个站的页脚是 ${footerVariant}，而 site-regions 说它是 ${got || regions.stderr}`
        + ' ⟹ 这一格量的不是我以为的那个状态');
    }

    const navPath = path.join(site, 'en', 'navigation.json');
    const nav = JSON.parse(fs.readFileSync(navPath, 'utf8'));
    if (!Array.isArray(nav.footer.columns) || !nav.footer.columns[0]
        || typeof nav.footer.columns[0].title !== 'string') {
      die('⑦ 夹具立不起来：这个站的 navigation.json 里没有 footer.columns[0].title');
    }
    const titleBefore = nav.footer.columns[0].title;
    nav.footer.columns[0].title = 'What We Do';

    ctx.git('git add -A && git commit -q -m base && git push -q origin main');
    const res = runEdit(ctx, [
      reply([textBlock('Renaming that footer column.'),
        writeCall('t1', 'en/navigation.json', JSON.stringify(nav, null, 2))], 'tool_use'),
      reply([textBlock('Done.')], 'end_turn'),
    ]);
    const onDisk = JSON.parse(fs.readFileSync(navPath, 'utf8')).footer.columns[0].title;
    return { res, receipt: toolResultContent(res, 1, 't1'), titleBefore, onDisk };
  };

  const SENTENCE = 'was saved, but nothing on the';

  // ── ⑦ 不画它的那一支：放行 + 说实话 ──────────────────────────────────────────────────────────
  {
    const { receipt, titleBefore, onDisk } = runTitleEdit('nav-title-invisible', 'slim-row');
    if (receipt === null) {
      bad('⑦ 第二轮请求里找不到 t1 那条 tool_result —— 模型收到了什么问不出来');
    } else {
      let parsed = null;
      try { parsed = JSON.parse(receipt); } catch { /* 下面按 null 报 */ }
      const msg = parsed && typeof parsed.message === 'string' ? parsed.message : '';
      const allowed = !!(parsed && parsed.success === true);
      if (!allowed) {
        bad(`⑦ 门把这次编辑拒了 —— 本票要它写得进去：${receipt.slice(0, 200)}`);
      } else if (onDisk !== 'What We Do' || titleBefore === 'What We Do') {
        bad(`⑦ 值没有真的落盘（改前 "${titleBefore}" → 磁盘上 "${onDisk}"）`);
      } else if (!msg.includes(SENTENCE)) {
        bad(`⑦ 放行了、值也写进去了，而回执里【没有】那句实话 —— 老板会拿到「已完成」而页面不变。`
          + `回执：${receipt.slice(0, 260)}`);
      } else if (!msg.includes('footer.columns[].title') || !msg.includes('slim-row')) {
        bad(`⑦ 那句话在，但没点名是哪个字段 / 这个站是什么版式：${msg.slice(0, 260)}`);
      } else {
        ok('⑦ 页脚是 slim-row 的真站上改栏目标题：门放行、值真的落盘，而回执里带着'
          + '「写进去了，但你这个站的页脚不显示它」并点名了字段和版式 —— 接线是通的');
      }
    }
  }

  // ── ⑦b 反向对照：真的画它的那一支，一句都不许多 ─────────────────────────────────────────────
  {
    const { receipt, onDisk } = runTitleEdit('nav-title-visible', 'multi-column');
    if (receipt === null) {
      bad('⑦b 第二轮请求里找不到 t1 那条 tool_result');
    } else if (onDisk !== 'What We Do') {
      bad(`⑦b 值没有落盘（磁盘上是 "${onDisk}"）—— 这一臂什么都没证明`);
    } else if (receipt.includes(SENTENCE)) {
      bad('⑦b 页脚是 multi-column（它真的画栏目标题），回执里却说「你这个站不显示它」'
        + ` —— 这是新造的一句假话：${receipt.slice(0, 260)}`);
    } else {
      ok('⑦b 反向对照：同一个站、同一次编辑，只把页脚换成真的画它的 multi-column，那句话当场消失'
        + ' ⟹ ⑦ 那句绿是版式那一维给的，不是「凡是改 navigation.json 就多一句」');
    }
  }
}

// ══ ⑧ 反斜杠那种拼法：拒得住，而且模型照回执改一次就成（#1109 r2）══════════════════════════════
//
// 🔴 这一格是 QA3 在 #1109 r1 终审打回那条阻断的真路径读数。上一版：`en\seo.json` 被
//    `writeRejection` 判成 `en/seo.json`（正确位置 ⟹ 放行），而 Linux 上 `\` 只是文件名里的一个字符，
//    于是 `path.join(siteDir, 原始字符串)` 把字节写到 `site/` **根目录**、文件名字面是 `en\seo.json`。
//    后果：`sync-config` rc=0（它读的是 `site/en/seo.json`）⟹ 编辑走到底、commit + push、
//    老板收到「Done」，而站上一个像素没变。**纯函数那一层由 `editable-files.test.js` ⑧ 钉，
//    这一格钉的是真进程**：真的 create-site 夹具、真的 sync-config、真的 git、真的落盘。
// 🔴 两半都要：① 那个文件名不许出现在 `site/` 根目录（也就是「字节没落到判决之外的地方」）
//    ② 回执里那句话要能让模型自己改对 —— 所以第二轮就按回执里点名的拼法再写一次，必须成功保存。
//    少了 ② 这一格就退化成「拒了就算赢」，而这条链上「拒得住但修不回来」跟静默写错一样是坏的
//    （`block-manifest.js` 的 `scope: 'edit'` 那段写着同一条理由）。
console.log('\n⑧ en\\seo.json：字节没落到根目录，且回执让模型改一次就成（#1109 r2）');
{
  const ctx = makeRoot('backslash');
  const site = writeSite(ctx.work);
  assertSyncsClean(ctx.work, '⑧');
  ctx.git('git add -A && git commit -q -m base && git push -q origin main');

  const seo = JSON.parse(fs.readFileSync(path.join(site, 'en', 'seo.json'), 'utf8'));
  const edited = { ...seo, metaTitle: 'QA3 backslash probe title' };
  const body = JSON.stringify(edited, null, 2);

  const res = runEdit(ctx, [
    // 第 1 轮：模型用 Windows 习惯的反斜杠
    reply([textBlock('Updating SEO.'), writeCall('t1', 'en\\seo.json', body)], 'tool_use'),
    // 第 2 轮：照回执里点名的拼法重写一次（真模型拿到那句话就该这么做）
    reply([textBlock('Retrying with forward slashes.'), writeCall('t2', 'en/seo.json', body)], 'tool_use'),
    reply([textBlock('Changes applied.')], 'end_turn'),
  ]);

  // ① 根目录里不许出现那个字面文件名
  const rootEntries = fs.readdirSync(site);
  const littered = rootEntries.filter((n) => n.includes('\\'));
  if (littered.length === 0) {
    ok(`site/ 根目录里没有带反斜杠的文件（现在是：${rootEntries.join(' ')}）`);
  } else {
    bad(`🔴 字节落到了判决之外的地方：site/ 根目录出现 ${littered.map((n) => JSON.stringify(n)).join(' · ')}`);
  }

  // ② 第 1 轮的回执必须是拒绝，而且点名该用的拼法
  const r1 = toolResultContent(res, 2, 't1');
  if (r1 === null) {
    bad('⑧ 取不到第 1 轮那次 write_file 的回执 —— 这一格的读数不作数');
  } else if (/Invalid path/.test(r1) && /en\/seo\.json/.test(r1) && !/"success":true/.test(r1)) {
    ok('第 1 轮被拒，回执里点名了该用的拼法 en/seo.json');
  } else {
    bad(`第 1 轮的回执不是「拒 + 点名拼法」：${r1.slice(0, 200)}`);
  }

  // ③ 第 2 轮（照回执改）必须真的落盘 + 保存 —— 拒得住还要修得回来
  const onDisk = JSON.parse(fs.readFileSync(path.join(site, 'en', 'seo.json'), 'utf8'));
  if (onDisk.metaTitle === 'QA3 backslash probe title') ok('第 2 轮照回执改的那次真的落到了 site/en/seo.json');
  else bad(`第 2 轮没落盘：metaTitle 现在是 ${JSON.stringify(onDisk.metaTitle)}`);
  if (ev(res, 'edit-complete').length === 1 && !ev(res, 'error').length) ok('整次编辑走到底：一条 edit-complete、零 error');
  else bad(`事件不对：edit-complete ${ev(res, 'edit-complete').length} · error ${ev(res, 'error').length}（${res.events.map((e) => e.event).join(' ')}）`);
  if (res.commitsAfter === res.commitsBefore + 1) ok(`commit 了一个（${res.commitsBefore} → ${res.commitsAfter}）`);
  else bad(`commit 数不对：${res.commitsBefore} → ${res.commitsAfter}`);
}

// ══ ⑨ 这个站没有的语言：`site/fr/` 没被造出来，且回执让模型改一次就成（#1138）════════════════════
//
// 这个夹具的 `site_meta.json` 只列 `en`。改之前 `fr/seo.json` 是**放行**的：`path.join` 把 `site/fr/`
// 造出来、字节落进去、`sync-config` rc=0（它只读 `site_meta.json` 列着的语言）⟹ 编辑走到底、
// commit + push、老板收到「Done」，而产物里探针 0 命中。逐字是 #1109 那句病的第三道入口。
// 🔴 纯函数那一层由 `editable-files.test.js` ⑨ 与 `site-shape.test.js` ⑤ 钉，**这一格钉的是真进程**：
//    真的 create-site 夹具、真的 `edit-site.js`、真的 sync-config、真的 git、真的落盘。
// 🔴 两半都要（AC5）：① `site/fr/` 不许被创建，而且产物里不许有探针 ② 回执里那句话要能让模型自己
//    改对 —— 所以第二轮就按它点名的路径再写一次，必须真的保存、而且**值真的进产物**。
//    少了 ② 这一格就退化成「拒了就算赢」，而「拒得住但改不回来」跟静默写错一样坏。
console.log('\n⑨ fr/seo.json（这个站没有的语言）：site/fr/ 没被造出来，回执让模型改一次就成（#1138）');
{
  const ctx = makeRoot('unknown-locale');
  const site = writeSite(ctx.work);
  assertSyncsClean(ctx.work, '⑨');
  ctx.git('git add -A && git commit -q -m base && git push -q origin main');

  // 前提先自证：这个站真的只有 en（不然下面量的不是本票要治的东西）
  const meta = JSON.parse(fs.readFileSync(path.join(site, 'site_meta.json'), 'utf8'));
  if (!Array.isArray(meta.locales) || meta.locales.join(',') !== 'en') {
    die(`⑨ 夹具的语言清单不是 ['en']（是 ${JSON.stringify(meta.locales)}）—— 换个夹具再取读数`);
  }

  const PROBE = 'DEV1138 unknown-locale probe title';
  const seo = JSON.parse(fs.readFileSync(path.join(site, 'en', 'seo.json'), 'utf8'));
  const body = JSON.stringify({ ...seo, metaTitle: PROBE }, null, 2);

  const res = runEdit(ctx, [
    // 第 1 轮：模型自己编了一个这个站没有的语言
    reply([textBlock('Adding the French SEO copy.'), writeCall('t1', 'fr/seo.json', body)], 'tool_use'),
    // 第 2 轮：照回执里点名的路径重写一次（真模型拿到那句话就该这么做）
    reply([textBlock('Writing the English file instead.'), writeCall('t2', 'en/seo.json', body)], 'tool_use'),
    reply([textBlock('Changes applied.')], 'end_turn'),
  ]);

  // ① `site/fr/` 不许被造出来（`path.join` 会连目录一起建，所以它在就是字节落过去了）
  const entries = fs.readdirSync(site).sort();
  if (!entries.includes('fr')) ok(`site/ 底下没有 fr 目录（现在是：${entries.join(' ')}）`);
  else bad(`🔴 site/fr/ 被造出来了，里面是 ${fs.readdirSync(path.join(site, 'fr')).join(' ')} —— 字节落到了构建不读的地方`);

  // ② 第 1 轮的回执必须是拒绝，而且点名这个站有哪几个语言 + 该写哪个路径
  const r1 = toolResultContent(res, 2, 't1');
  if (r1 === null) {
    bad('⑨ 取不到第 1 轮那次 write_file 的回执 —— 这一格的读数不作数');
  } else if (/is not one of the languages it has \(it has: en\)/.test(r1)
             && /en\/seo\.json/.test(r1) && !/"success":true/.test(r1)) {
    ok('第 1 轮被拒，回执点名了这个站只有 en、以及该写 en/seo.json');
  } else {
    bad(`第 1 轮的回执不是「拒 + 点名语言和路径」：${r1.slice(0, 240)}`);
  }

  // ③ 第 2 轮（照回执改）必须真的落盘 —— 拒得住还要修得回来
  const onDisk = JSON.parse(fs.readFileSync(path.join(site, 'en', 'seo.json'), 'utf8'));
  if (onDisk.metaTitle === PROBE) ok('第 2 轮照回执改的那次真的落到了 site/en/seo.json');
  else bad(`第 2 轮没落盘：metaTitle 现在是 ${JSON.stringify(onDisk.metaTitle)}`);

  // ④ 🔴 **值真的进产物** —— 这是本票要治的那句病的唯一直接读数：「落盘 + rc=0」两个都成立时，
  //    改之前产物里是 0 命中。所以这里量的不是落盘，是构建到底读到了没有。
  const generated = path.join(ctx.work, 'src', 'lib', 'config-data.ts');
  const hits = (() => {
    try { return (fs.readFileSync(generated, 'utf8').match(new RegExp(PROBE, 'g')) || []).length; }
    catch (e) { return -1; }
  })();
  if (hits >= 1) ok(`探针进了产物 src/lib/config-data.ts（${hits} 处命中）⟹ 站真的变了，不是「写进去没人读」`);
  else bad(`产物里探针 ${hits === -1 ? '读不到那个文件' : `${hits} 处命中`} —— 这次编辑落盘了但站没变，正是本票要治的那句病`);

  if (ev(res, 'edit-complete').length === 1 && !ev(res, 'error').length) ok('整次编辑走到底：一条 edit-complete、零 error');
  else bad(`事件不对：edit-complete ${ev(res, 'edit-complete').length} · error ${ev(res, 'error').length}（${res.events.map((e) => e.event).join(' ')}）`);
  if (res.commitsAfter === res.commitsBefore + 1) ok(`commit 了一个（${res.commitsBefore} → ${res.commitsAfter}）`);
  else bad(`commit 数不对：${res.commitsBefore} → ${res.commitsAfter}`);
}

// ══ ⑩ 站级块库:六种枚举出来的畸形形状 + 真模型写出来的那一份,一个都写不进去,报文点名是哪一条(#1160)══
//
// 页面块从 #1152/#1154 起在写入这一刻就被拦;站级块走**同一条** `write_file`,而那道闸的正则钉在
// `pages/**.json` 上 ⟹ 同一份畸形内容放在这个文件里以前一条都不报。后两种(E/F)更重:它们让
// `sync-config.js` exit 1,那个站从此重建不出来、预览也开不出来。
//
// 🔴 每一格库里放**两个** id,只有一个是坏的:AC2 问的是「模型知不知道该改哪一条」,而
//    「报文里出现了坏的那个」和「报文里没出现好的那个」是两个读数,少一个都答不了这件事。
// 🔴 六格共用一棵树:每一格都该是「被拒 + 一个字节没落盘」,所以树在格与格之间不变。
//    那也正好让「文件没被造出来」这一半在每一格都能重新问一次 —— 哪一格漏了,下一格的前提就当场崩。
console.log('\n⑩ 站级块库:六种枚举出来的畸形形状 + 真模型写出来的那一份,全部被拒且报文点名是哪个 id');
{
  const ctx = makeRoot('siteblocks-reject');
  const site = writeSite(ctx.work);
  assertSyncsClean(ctx.work, '⑩');
  ctx.git('git add -A && git commit -q -m base && git push -q origin main');

  const target = path.join(site, 'en', 'blocks', 'site-blocks.json');
  if (fs.existsSync(target)) {
    die('⑩ 前提不成立:建出来的站已经带着 site-blocks.json ⟹ 「这次写入没落盘」这一半问不出来');
  }
  // 好的那一条。它的 id 是 `keepme`,坏的那条是 `busted` —— 两个词在被测代码的静态文案里都不出现
  // (报文是拿它们拼出来的),所以「出现/不出现」这两个断言都有判别力。
  const keepme = { type: 'card-group', data: { headline: 'Why us', items: ['Licensed', 'Insured'] } };
  const SHAPES = [
    ['A items 里有 null', { type: 'card-group', data: { headline: 'K', items: ['a', null] } }],
    ['B items 整个不是数组', { type: 'card-group', data: { headline: 'K', items: 'a、b' } }],
    ['C type 是不存在的块名', { type: 'no-such-block', data: { headline: 'K' } }],
    ['D 缺必填槽', { type: 'card-group', data: {} }],
    ['E 值本身写成 ref(没自己的 type)', { ref: 'keepme', visibility: ['*'] }],
    ['F 值整格是 null', null],
  ];

  for (const [label, busted] of SHAPES) {
    const body = JSON.stringify({ keepme, busted }, null, 2);
    const res = runEdit(ctx, [
      reply([textBlock('Adding a shared block.'), writeCall('t1', 'en/blocks/site-blocks.json', body)], 'tool_use'),
      reply([textBlock('Done.')], 'end_turn'),
    ]);
    // 🔴 回执是 `JSON.stringify(result)`,所以报文里的 `"` 在这个字符串里是 `\"` —— 直接在它上面
    //    grep `站级块 "busted"` 恒不命中。判据要取**解开之后**那句话(`result.error`),
    //    这一步本身也是「模型收到的是不是一条 error」的读数。
    const raw = toolResultContent(res, 1, 't1');
    if (raw === null) {
      bad(`⑩ ${label}:取不到那次 write_file 的回执 —— 这一格的读数不作数`);
      continue;
    }
    let r = '';
    try { r = String((JSON.parse(raw) || {}).error || ''); } catch (e) { r = ''; }
    const refused = !/"success"\s*:\s*true/.test(raw) && /Nothing was written/.test(r);
    const namesBusted = /站级块 "busted"/.test(r);
    const namesKeeper = /keepme/.test(r);
    const landed = fs.existsSync(target);
    if (refused && namesBusted && !namesKeeper && !landed) {
      ok(`⑩ ${label}:被拒 · 报文点名 "busted" 且不提 keepme · 文件没被造出来`);
    } else {
      bad(`⑩ ${label}:被拒=${refused} · 点名坏的=${namesBusted} · 误提好的=${namesKeeper}`
        + ` · 落盘了=${landed}\n      回执:${r.slice(0, 260)}`);
    }
  }

  // 🔴 E 那一格单独再问一句:它是**唯一**逃过 `validateSite` 的形状(`isRefEntry` 见
  //    `lib/block-manifest.js` 的注释),所以拦住它的必须是第一关(构建期那个函数),而它的报文
  //    还得把模型指向对的地方 —— 不能像页面块那条现成的报文那样说「`{ "ref": … }` 也行」。
  {
    const res = runEdit(ctx, [
      reply([textBlock('Adding a shared block.'), writeCall('t1', 'en/blocks/site-blocks.json',
        JSON.stringify({ keepme, busted: { ref: 'keepme' } }, null, 2))], 'tool_use'),
      reply([textBlock('Done.')], 'end_turn'),
    ]);
    const raw = toolResultContent(res, 1, 't1') || '';
    let r = '';
    try { r = String((JSON.parse(raw) || {}).error || ''); } catch (e) { r = ''; }
    const saysNeedsOwnType = /must be a block that carries its own "type"/.test(r);
    const saysRefOnlyInPages = /only allowed inside a page's blocks array/.test(r);
    if (saysNeedsOwnType && saysRefOnlyInPages) {
      ok('⑩ E 的报文告诉模型:值必须自带 type、ref 只能写在页面的 blocks 数组里');
    } else {
      bad(`⑩ E 的报文没把模型指对(自带 type=${saysNeedsOwnType} · ref 只在页面里=${saysRefOnlyInPages})`
        + `:${r.slice(0, 260)}`);
    }
  }

  // 🔴 上面那六格是**枚举出来的**形状。这一格不是:它是**真模型在今天的 origin/main 上真的写出来的**
  //    那一份 —— 我拿同一句话("每页都加一个 CTA,放进跨页复用的库里")在两条臂上各跑一次活体,
  //    origin/main 那一臂的模型把整个文件包成了 `{"blocks": [ {...} ]}`(它没见过这个文件的样子,
  //    只好照页面块的形状猜),写入被放行(回执 `"success":true`)、`sync-config` 随后 exit 1、
  //    整次编辑回滚 —— 老板收到的是「This change was not saved」。
  //    合成夹具全绿不等于这道闸对真实输入有用,所以把那份真形状钉成一格。
  {
    const realModelShape = {
      blocks: [{
        id: 'shared-cta-banner', type: 'cta-banner', role: 'optional', region: 'content', weight: 90,
        data: { headline: 'Ready to book?', description: 'Call us today.', button: { label: 'Quote', href: '/quote' } },
      }],
    };
    const res = runEdit(ctx, [
      reply([textBlock('Adding a shared block.'), writeCall('t1', 'en/blocks/site-blocks.json',
        JSON.stringify(realModelShape, null, 2))], 'tool_use'),
      reply([textBlock('Done.')], 'end_turn'),
    ]);
    const raw = toolResultContent(res, 1, 't1') || '';
    let r = '';
    try { r = String((JSON.parse(raw) || {}).error || ''); } catch (e) { r = ''; }
    const refused = !/"success"\s*:\s*true/.test(raw) && /Nothing was written/.test(r);
    const namesIt = /站级块 "blocks"/.test(r);
    if (refused && namesIt && !fs.existsSync(target)) {
      ok('⑩ G 真模型在 origin/main 上写出来的那份形状(整个文件包在一个 blocks 数组里):被拒、点名、没落盘');
    } else {
      bad(`⑩ G 真模型那份形状没被拦住(被拒=${refused} · 点名=${namesIt} · 落盘=${fs.existsSync(target)})`
        + `:${r.slice(0, 260)}`);
    }
  }
}

// ══ ⑪ 反向对照:合法的站级块 + 页面里的 ref 条目,两种都放行并且真的进产物(#1160 AC3)══════════
//
// 少了这一格,⑩ 的六个「被拒」可能只是「这条路把这个文件一律拒了」—— 那样交付的是一道把
// `blocks/site-blocks.json` 变成只读的闸,而不是一道内容检查。
console.log('\n⑪ 反向对照:合法站级块 + 页面里的 ref 条目 ⟹ 放行、落盘、进产物');
{
  const PROBE = 'DEV1160 shared block probe headline';
  const ctx = makeRoot('siteblocks-ok');
  const site = writeSite(ctx.work);
  assertSyncsClean(ctx.work, '⑪');
  ctx.git('git add -A && git commit -q -m base && git push -q origin main');

  const target = path.join(site, 'en', 'blocks', 'site-blocks.json');
  const homePath = path.join(site, 'en', 'pages', 'home.json');
  const home = JSON.parse(fs.readFileSync(homePath, 'utf8'));
  // 这个站的首页是 `blocks` 还是 `sections` 由建站脚本决定,不由我假设 —— 猜错的话下面那个 push
  // 会往 undefined 上打,而那种红看起来像被测代码的毛病。
  const arrayKey = Array.isArray(home.blocks) ? 'blocks' : (Array.isArray(home.sections) ? 'sections' : null);
  if (!arrayKey) die(`⑪ 前提不成立:建出来的首页既没有 blocks 也没有 sections(键:${Object.keys(home).join(' ')})`);

  // AC3② 站级块的值:带 visibility(含 "*")、自己的 weight / role / block_layout
  const lib = {
    'shared-cta': {
      type: 'cta-banner',
      visibility: ['*'],
      weight: 90,
      role: 'optional',
      block_layout: 'default',
      data: {
        headline: PROBE,
        description: 'Tell us what you need and we will get back to you the same day.',
        button: { label: 'Get a quote', href: '/quote' },
      },
    },
  };
  // AC3① 页面里指向站级块的 ref 条目
  home[arrayKey] = home[arrayKey].concat([{ ref: 'shared-cta', weight: 95 }]);

  const res = runEdit(ctx, [
    reply([textBlock('Adding the shared banner.'), writeCall('t1', 'en/blocks/site-blocks.json', JSON.stringify(lib, null, 2))], 'tool_use'),
    reply([textBlock('Pointing the homepage at it.'), writeCall('t2', `en/pages/${path.basename(homePath)}`, JSON.stringify(home, null, 2))], 'tool_use'),
    reply([textBlock('Changes applied.')], 'end_turn'),
  ]);

  const r1 = toolResultContent(res, 1, 't1');
  if (r1 && /"success"\s*:\s*true/.test(r1)) ok('⑪ 合法站级块放行了(回执 success:true)');
  else bad(`⑪ 合法站级块被拒了 —— ⑩ 那六个「被拒」因此什么都没证明:${String(r1).slice(0, 260)}`);

  const r2 = toolResultContent(res, 2, 't2');
  if (r2 && /"success"\s*:\s*true/.test(r2)) ok('⑪ 页面里的 `{ "ref": … }` 条目放行了(回执 success:true)');
  else bad(`⑪ 页面里的 ref 条目被拒了:${String(r2).slice(0, 260)}`);

  if (fs.existsSync(target) && JSON.parse(fs.readFileSync(target, 'utf8'))['shared-cta'].data.headline === PROBE) {
    ok('⑪ 站级块库真的落盘了');
  } else {
    bad(`⑪ 没落盘:${fs.existsSync(target) ? fs.readFileSync(target, 'utf8').slice(0, 120) : '(文件不存在)'}`);
  }

  // 🔴 落盘 + rc=0 都成立时,「站到底变了没有」仍然是另一个读数(同⑨那一格的理由)。
  const generated = path.join(ctx.work, 'src', 'lib', 'config-data.ts');
  const hits = (() => {
    try { return (fs.readFileSync(generated, 'utf8').match(new RegExp(PROBE, 'g')) || []).length; }
    catch (e) { return -1; }
  })();
  if (hits >= 1) ok(`⑪ 探针进了产物 src/lib/config-data.ts(${hits} 处命中)⟹ 站真的变了`);
  else bad(`⑪ 产物里探针 ${hits === -1 ? '读不到那个文件' : `${hits} 处命中`} —— 写进去了但构建没读到`);

  if (ev(res, 'edit-complete').length === 1 && !ev(res, 'error').length) ok('⑪ 整次编辑走到底:一条 edit-complete、零 error');
  else bad(`⑪ 事件不对:edit-complete ${ev(res, 'edit-complete').length} · error ${ev(res, 'error').length}（${res.events.map((e) => e.event).join(' ')}）`);
}

// ══ ⑫ 提示词里那个站级块的例子,必须真的过得了构建期和这道新闸(#1160 AC5)════════════════════════
//
// 🔴 为什么值一格:E/F 那两种最坏形状的成因就是模型没见过这个文件长什么样。而**一个过不了自己那道闸
//    的例子比没有例子更坏** —— 模型照抄一遍就被拒,而它手上唯一的样子就是那个例子 ⟹ 这个文件从此
//    写不进去。判据是把例子从**源码里原样抠出来**真跑,不是我读一遍觉得它对。
console.log('\n⑫ 提示词里那个站级块的例子:构建期 rc=0,新那道闸 0 条问题');
{
  const src = fs.readFileSync(EDIT_SITE, 'utf8');
  // 提示词住在模板字符串里,所以围栏在源码里是 `\`\`\`json`(反引号被转义过)。
  const m = src.match(/## Site-Wide Blocks[\s\S]*?\\`\\`\\`json\n([\s\S]*?)\n\\`\\`\\`/);
  if (!m) {
    bad('⑫ 提示词里找不到 ## Site-Wide Blocks 那一节的 json 例子 —— AC5 没有对象可验');
  } else {
    let example = null;
    try { example = JSON.parse(m[1]); } catch (e) { bad(`⑫ 那个例子不是合法 JSON:${e.message}`); }
    if (example) {
      const { normalizeLocalePages } = require(path.join(NEXT, 'scripts', 'blocks.js'));
      const { validateSite } = require(path.join(NEXT, 'scripts', 'lib', 'block-manifest.js'));
      const page = { slug: 'home', blocks: [{ type: 'text-block', data: { body: 'x' } }] };
      let buildErr = null;
      try { normalizeLocalePages([page], JSON.parse(JSON.stringify(example)), 'en', {}); }
      catch (e) { buildErr = e.message; }
      if (!buildErr) ok('⑫ 例子过构建期(normalizeLocalePages 没抛)');
      else bad(`⑫ 例子构建不出来:${buildErr}`);

      // 同一份例子过一遍新闸自己那一关(一个 id 一「页」,跟 edit-site.js 里那次调用同一个口径)
      const { problems } = validateSite({
        pages: Object.entries(example).map(([id, b]) => ({ slug: `站级块 "${id}"`, blocks: [b] })),
        scope: 'edit',
      });
      if (problems.length === 0) ok('⑫ 例子过新那道闸(0 条问题)');
      else bad(`⑫ 例子被自己那道闸拒了 —— 模型照抄就写不进去:${problems.join(' | ')}`);

      // 🔴 阳性对照:这把尺子有牙吗。把例子里的必填槽挖掉一个,同一句判断必须报出来。
      const mutated = JSON.parse(JSON.stringify(example));
      const firstId = Object.keys(mutated)[0];
      if (mutated[firstId] && mutated[firstId].data) delete mutated[firstId].data.headline;
      const { problems: mutProblems } = validateSite({
        pages: Object.entries(mutated).map(([id, b]) => ({ slug: `站级块 "${id}"`, blocks: [b] })),
        scope: 'edit',
      });
      if (mutProblems.length >= 1) ok(`⑫ 阳性对照:挖掉一个必填槽,同一句判断报 ${mutProblems.length} 条 ⟹ 尺子有牙`);
      else bad('⑫ 阳性对照失败:挖掉必填槽之后它仍然 0 条 —— 上面那个「0 条问题」什么都没证明');
    }
  }
}

// ══ ⑬ 图片取不到时老板拿到的是一句人话，不是一段 JavaScript 栈（#1200）═══════════════════════════
//
// 改之前这两个入口都一路 throw 到 `main().catch` → `fatal(err.stack)` → `emit('error', …)`，
// **整段栈进聊天窗**。判据现在是**实验**不是措辞：所以下面每一格喂给假 provider 的那条 400，
// 原话都是票正文里那条真读数（`Unable to download the file.` —— 全串里没有 `image` 一词），
// 老判据在它上面是**不开火**的。
//
// 🔴 五臂共用一棵树：这五格全部在**第一次 API 调用**就结束，一个文件都碰不到（AC4 就是这句话的
//    另一面）。每臂各拷一棵 11 MB 的树只会让这份文件更慢，证不出多一分东西。
const T1200_DOWNLOAD_400 = {
  __throw: {
    status: 400,
    message: '400 {"type":"error","error":{"type":"invalid_request_error","message":"Unable to download the file. Please verify the URL and try again."},"request_id":"req_stub"}',
    error: { type: 'error', error: { type: 'invalid_request_error', message: 'Unable to download the file. Please verify the URL and try again.' } },
  },
};
// r3（QA3 终审）：**跟请求内容无关**的 400。原话取自公开抓包（continuedev/continue#5499）——
// 账号 credit 烧光时 Anthropic 回的就是一个 HTTP 400 `invalid_request_error`，那种状态下任何请求
// 都 400，探针也 400。判据只读 status，所以这里承重的是那个 400，不是这串字。
const T1200_CREDIT_400 = {
  __throw: {
    status: 400,
    message: '400 {"type":"error","error":{"type":"invalid_request_error","message":"Your credit balance is too low to access the Anthropic API. Please go to Plans & Billing to upgrade or purchase credits."},"request_id":"req_stub_credit"}',
    error: { type: 'error', error: { type: 'invalid_request_error', message: 'Your credit balance is too low to access the Anthropic API. Please go to Plans & Billing to upgrade or purchase credits.' } },
  },
};
// r3：对照臂自己炸成别的（判不出来）。429 走 probeImagesAccepted 的 `return null` 那一支。
const T1200_RATE_429 = {
  __throw: {
    status: 429,
    message: '429 {"type":"error","error":{"type":"rate_limit_error","message":"Number of requests has exceeded your rate limit."},"request_id":"req_stub_429"}',
    error: { type: 'error', error: { type: 'rate_limit_error', message: 'Number of requests has exceeded your rate limit.' } },
  },
};
const T1200_TOOL_400 = {
  __throw: {
    status: 400,
    message: '400 {"type":"error","error":{"type":"invalid_request_error","message":"tools.0.custom.input_schema: JSON schema is invalid."},"request_id":"req_stub"}',
    error: { type: 'error', error: { type: 'invalid_request_error', message: 'tools.0.custom.input_schema: JSON schema is invalid.' } },
  },
};
/** stdout 里有没有 JS 栈行。判据是**产物本身**（老板看到的那串字），不是我复述它。 */
const stackLines = (res) => JSON.stringify(res.events).match(/\\n\s+at /g) || [];

console.log('\n⑬ 图片取不到 ⟹ 一句人话，不是一段 JS 栈（#1200）');
{
  const ctx = makeRoot('img-error');
  writeSite(ctx.work);
  assertSyncsClean(ctx.work, '⑬ 夹具');
  ctx.git('git add -A && git commit -q -m base && git push -q origin main');

  const fingerprint = () => cp.execSync(
    `find site -type f | sort | xargs md5sum | md5sum`, { cwd: ctx.work, encoding: 'utf8' }).trim();
  const beforeAll = fingerprint();

  // 用 #1194 自己的 helper 播出来的那段历史（manager/ticket1200_test.go 盯着它不过期）。
  const HISTORY = JSON.parse(fs.readFileSync(
    path.join(NEXT, 'scripts', 'lib', 'testdata', '1200-history-with-image.json'), 'utf8'));

  // ── A（AC1，入口①）：当轮附件取不到 ──────────────────────────────────────────────────────────
  {
    // 三条：① 主请求 400 ② 图片探针 400 ③ **对照臂**（一张图都不带）被收下 ⟹ 账号是好的（r3）
    const res = runEdit(ctx, [T1200_DOWNLOAD_400, T1200_DOWNLOAD_400, reply([textBlock('.')])], {
      message: 'Put this photo on the home page',
      images: [{ url: 'https://uploads.ai1st.site/gone.png', originalFilename: 'gone.png' }],
    });
    const done = ev(res, 'edit-complete');
    const msg = done.length ? String(done[0].message) : '';
    if (done.length === 1 && !ev(res, 'error').length) ok('⑬A 一条 edit-complete、零 error');
    else bad(`⑬A 事件不对：${res.events.map(e => e.event).join(' ')}｜stderr 尾：${res.stderr.slice(-300)}`);
    if (stackLines(res).length === 0) ok('⑬A 事件里一行 `at ` 栈都没有');
    else bad(`⑬A 栈漏进事件里了（${stackLines(res).length} 行）：${JSON.stringify(res.events).slice(0, 400)}`);
    if (/gone\.png/.test(msg) && /attached/i.test(msg)) ok(`⑬A 人话点名了那张图：「${msg}」`);
    else bad(`⑬A 那句话不对：「${msg}」`);
  }

  // ── B（AC2，入口②）：当轮纯文字，历史里那张图取不到 ────────────────────────────────────────
  {
    const res = runEdit(ctx, [T1200_DOWNLOAD_400, T1200_DOWNLOAD_400, reply([textBlock('.')])], {
      message: 'Actually make the headline shorter',
      conversationHistory: HISTORY,
    });
    const done = ev(res, 'edit-complete');
    const msg = done.length ? String(done[0].message) : '';
    if (done.length === 1 && !ev(res, 'error').length) ok('⑬B 一条 edit-complete、零 error');
    else bad(`⑬B 事件不对：${res.events.map(e => e.event).join(' ')}｜stderr 尾：${res.stderr.slice(-300)}`);
    if (stackLines(res).length === 0) ok('⑬B 事件里一行 `at ` 栈都没有');
    else bad(`⑬B 栈漏进事件里了（${stackLines(res).length} 行）：${JSON.stringify(res.events).slice(0, 400)}`);
    if (/earlier in this chat/i.test(msg) && /deleted-by-owner\.png/.test(msg)) ok(`⑬B 说的是**历史里那张**，不是"你刚附的"：「${msg}」`);
    else bad(`⑬B 那句话不对（入口②要跟入口①说不同的话）：「${msg}」`);
    // 探针必须是"只问图片"：带上 tools 的话，工具 schema 坏掉那种 400 会让它也 400 ⟹ 赖到图片头上。
    const probe = res.requests[1];
    if (probe && probe.hasTools === false && probe.hasSystem === false && probe.maxTokens === 1) {
      ok('⑬B 探针只问图片：无 tools、无 system、max_tokens=1');
    } else {
      bad(`⑬B 探针形状不对：${JSON.stringify(probe && { hasTools: probe.hasTools, hasSystem: probe.hasSystem, maxTokens: probe.maxTokens })}`);
    }
  }

  // ── C（AC3）：跟图片无关的 400 不被吞掉 ──────────────────────────────────────────────────────
  //     喂的是工具参数错。带着图片进来（这才是能骗到人的那一格）—— 探针**过**，于是原样 rethrow。
  {
    const res = runEdit(ctx, [T1200_TOOL_400, reply([textBlock('ok')])], {
      message: 'Put this photo on the home page',
      images: [{ url: 'https://uploads.ai1st.site/fine.png', originalFilename: 'fine.png' }],
    });
    const errs = ev(res, 'error');
    if (errs.length === 1 && !ev(res, 'edit-complete').length) ok('⑬C 走原来的路：一条 error、零 edit-complete');
    else bad(`⑬C 被分类器吞掉了：${res.events.map(e => e.event).join(' ')}`);
    const m = errs.length ? String(errs[0].message) : '';
    if (/input_schema/.test(m) && !/attach/i.test(m)) ok('⑬C 报的还是工具参数那条错，没被改写成"你的图坏了"');
    else bad(`⑬C 报文被改写了：「${m.slice(0, 300)}」`);
  }

  // ── G（AC3，r3；QA3 终审打回 r2）：跟请求内容【无关】的 400 也不许被吞掉 ─────────────────────
  //
  // 🔴 这一格跟 C 不是同一件事，而 r2 只有 C。C 喂的是工具参数错 ⟹ 探针**过**，所以那条实验自己
  //    就答对了。这里喂的是**账号级** 400（credit 烧光是真实存在的一种）：主请求 400、图片探针也
  //    400、任何请求都 400 —— r2 那份字节据此判成"你的图坏了"，于是 manager 的 key 一烧光，老板
  //    每次带图编辑都被要求重传图片，而事故本身以**成功事件**的形状被盖掉。
  //    判据不是措辞（`credit` 这个词一改就漏），是**对照臂**：一张图都不带也被拒 ⟹ 锅不在图片上。
  {
    const res = runEdit(ctx, [T1200_CREDIT_400, T1200_CREDIT_400, T1200_CREDIT_400], {
      message: 'Put this photo on the home page',
      images: [{ url: 'https://uploads.ai1st.site/photo.png', originalFilename: 'photo.png' }],
    });
    const errs = ev(res, 'error');
    if (errs.length === 1 && !ev(res, 'edit-complete').length) ok('⑬G1 账号级 400 走原来的路：一条 error、零 edit-complete');
    else bad(`🔴 ⑬G1 账号级 400 被写成了"你的图坏了"：${res.events.map(e => e.event).join(' ')}`);
    // 终点是**产物里还有没有原话** —— 那才是事后有人能查出真因的唯一依据（QA3 两臂量的就是这个）。
    const all = JSON.stringify(res.events) + res.stderr;
    if (/credit balance is too low/.test(all)) ok('⑬G1 provider 的原话还在产物里 ⟹ 事故查得出真因');
    else bad('🔴 ⑬G1 产物里一个 `credit balance` 都不剩 —— 事故被盖成了图片问题');
    const m = errs.length ? String(errs[0].message) : '';
    if (!/attach/i.test(m)) ok('⑬G1 报文没被改写成"重新附一张图"');
    else bad(`🔴 ⑬G1 报文被改写了：「${m.slice(0, 300)}」`);
    // 对照臂真的是"一张图都不带"吗 —— 不然这一格只是碰巧红了。
    const ctrl = res.requests[2];
    const ctrlImgs = ctrl ? JSON.stringify(ctrl.messages).match(/"type":"image"/g) || [] : null;
    if (ctrl && ctrlImgs.length === 0 && ctrl.hasTools === false && ctrl.maxTokens === 1) {
      ok('⑬G1 第 3 次请求真的是对照臂：零个 image 块、无 tools、max_tokens=1');
    } else {
      bad(`⑬G1 第 3 次请求不是对照臂的形状：${JSON.stringify(ctrl && { imgs: ctrlImgs.length, hasTools: ctrl.hasTools, maxTokens: ctrl.maxTokens })}`);
    }
  }

  // ── G2（r3）：对照臂自己判不出来（429）⟹ fail-safe 方向是不动，不是编一句话 ─────────────────
  {
    const res = runEdit(ctx, [T1200_DOWNLOAD_400, T1200_DOWNLOAD_400, T1200_RATE_429], {
      message: 'Put this photo on the home page',
      images: [{ url: 'https://uploads.ai1st.site/gone.png', originalFilename: 'gone.png' }],
    });
    if (ev(res, 'error').length === 1 && !ev(res, 'edit-complete').length) {
      ok('⑬G2 对照臂炸成 429（判不出来）⟹ 原样 rethrow，跟文件头第 3 条同一条规矩');
    } else {
      bad(`🔴 ⑬G2 判不出来却编了一句话：${res.events.map(e => e.event).join(' ')}`);
    }
  }

  // ── G3（r3）：真吞掉的时候，被吞的那条 400 必须在 stderr 上留痕 ──────────────────────────────
  //     ⑬A 那一格里老板拿到的是人话，而 provider 的原话就此消失 —— 没有这一行，事后没人能复核
  //     那次分类对不对。
  {
    const res = runEdit(ctx, [T1200_DOWNLOAD_400, T1200_DOWNLOAD_400, reply([textBlock('.')])], {
      message: 'Put this photo on the home page',
      images: [{ url: 'https://uploads.ai1st.site/gone.png', originalFilename: 'gone.png' }],
    });
    const swallowed = /#1200 swallowed provider 400/.test(res.stderr);
    const keptOriginal = /Unable to download the file/.test(res.stderr);
    const notInEvents = !/Unable to download the file/.test(JSON.stringify(res.events));
    if (ev(res, 'edit-complete').length === 1 && swallowed && keptOriginal && notInEvents) {
      ok('⑬G3 吞掉那次 400 时 stderr 上留了痕（含 provider 原话），而老板那边仍然只有人话');
    } else {
      bad(`⑬G3 留痕不对：edit-complete=${ev(res, 'edit-complete').length} 留痕=${swallowed} 有原话=${keptOriginal} 没漏进事件=${notInEvents}｜stderr 尾：${res.stderr.slice(-400)}`);
    }
  }

  // ── H（r3）：多张图时那条【逐张再问一次】的循环 ──────────────────────────────────────────────
  //
  // 🔴 补的是我自己在 r1/r2 写下的那条盲区（「多张图……合成不出夹具，没实测」）—— QA3 终审用替身
  //    把它合成出来了，所以那句话现在不成立了。而 r3 在这条循环**前面**插了一次对照臂请求，
  //    请求序号整个往后挪一格 ⟹ 这条路必须有自己的回归格，不能靠"读代码觉得没影响"。
  {
    // 主 400 → 图片探针 400 → 对照臂过 → 逐张：good 过、bad 400 ⟹ 只点名 bad。
    const res = runEdit(ctx, [
      T1200_DOWNLOAD_400, T1200_DOWNLOAD_400, reply([textBlock('.')]),
      reply([textBlock('.')]), T1200_DOWNLOAD_400,
    ], {
      message: 'Put these two photos on the home page',
      images: [
        { url: 'https://uploads.ai1st.site/good.png', originalFilename: 'good.png' },
        { url: 'https://uploads.ai1st.site/bad.png', originalFilename: 'bad.png' },
      ],
    });
    const done = ev(res, 'edit-complete');
    const msg = done.length ? String(done[0].message) : '';
    if (done.length === 1 && /bad\.png/.test(msg) && !/good\.png/.test(msg)) {
      ok(`⑬H1 两张图一好一坏 ⟹ 只点名坏的那张：「${msg.slice(0, 110)}…」`);
    } else {
      bad(`⑬H1 点名不对（该只有 bad.png）：${res.events.map(e => e.event).join(' ')}｜「${msg}」`);
    }
    // 🔴 前提自检：逐张那两次请求真的各带一张 —— 不然"只点名 bad"可能是别的原因凑出来的。
    const imgsOf = r => (JSON.stringify(r.messages).match(/"type":"image"/g) || []).length;
    const shape = res.requests.map(imgsOf).join(',');
    if (shape === '2,2,0,1,1') ok(`⑬H1 前提成立：请求带图数逐条 ${shape}（主 2 · 探针 2 · 对照臂 0 · 逐张 1,1）`);
    else bad(`⑬H1 前提不成立：请求带图数逐条 ${shape} ⟹ 上面那条什么都没证明`);
  }
  {
    // 逐张都过、合起来才 400（总张数/总大小那种）⟹ 名字点不出来，把这次带的都说出来。
    const res = runEdit(ctx, [
      T1200_DOWNLOAD_400, T1200_DOWNLOAD_400, reply([textBlock('.')]),
      reply([textBlock('.')]), reply([textBlock('.')]),
    ], {
      message: 'Put these two photos on the home page',
      images: [
        { url: 'https://uploads.ai1st.site/a.png', originalFilename: 'a.png' },
        { url: 'https://uploads.ai1st.site/b.png', originalFilename: 'b.png' },
      ],
    });
    const done = ev(res, 'edit-complete');
    const msg = done.length ? String(done[0].message) : '';
    if (done.length === 1 && /a\.png/.test(msg) && /b\.png/.test(msg)) {
      ok(`⑬H2 逐张都过、合起来才 400 ⟹ 两张都说出来，不瞎点名：「${msg.slice(0, 110)}…」`);
    } else {
      bad(`⑬H2 该两张都点名：${res.events.map(e => e.event).join(' ')}｜「${msg}」`);
    }
  }

  // ── D（AC4）：两个入口下磁盘零改动 ───────────────────────────────────────────────────────────
  if (fingerprint() === beforeAll) ok('⑬D 八格跑完，site/ 指纹跟开跑前逐字节相同');
  else bad('⑬D 磁盘被动过了 —— 这一半以前是对的，别改坏');

  // ── E（AC5）：两向守卫 —— 故意把新判据改坏，上面那些必须红 ────────────────────────────────
  //
  // 🔴 变异做在**这棵树自己那份** edit-site.js 上（它是拷贝，不是仓里那份），跑完写回去。
  //    两处变异各对应新判据的一半，各自单独跑，报数要跟构造对得上。
  {
    const target = path.join(ctx.work, 'scripts', 'edit-site.js');
    const pristine = fs.readFileSync(target, 'utf8');
    const arms = [
      {
        why: 'E1 只看当轮附件（= 改之前那条 `images.length === 0` 早退）⟹ 入口②必须回到栈',
        from: '  const sentImages = sentImageRefs(images, conversationHistory);',
        to:   '  const sentImages = sentImageRefs(images, []);',
        run:  () => runEdit(ctx, [T1200_DOWNLOAD_400, T1200_DOWNLOAD_400], {
                message: 'Actually make the headline shorter', conversationHistory: HISTORY }),
        want: 'error',
        // 🔴 这一臂要证的不是"事件变了"，是**那个 bug 原样回来了**：老板收到的是一段 JS 栈。
        alsoWantStack: true,
      },
      {
        why: 'E2 拿掉那次实验（带图片的 400 一律算图片的锅）⟹ AC3 那条工具参数错必须被错吞掉',
        from: '  if (await probe(sent) !== false) return null;',
        to:   '  if (false) return null;',
        run:  () => runEdit(ctx, [T1200_TOOL_400, reply([textBlock('ok')])], {
                message: 'Put this photo on the home page',
                images: [{ url: 'https://uploads.ai1st.site/fine.png', originalFilename: 'fine.png' }] }),
        want: 'edit-complete',
      },
      {
        // r3：⑬G1 那一格红不红，全靠这一行。拿掉它 ⟹ 账号级 400 又被写成"你的图坏了"。
        why: 'E3 拿掉那条对照臂（r3）⟹ ⑬G1 那条账号级 400 必须重新被错吞成 edit-complete',
        from: '  if (await probe([]) !== true) return null;',
        to:   '  if (false) return null;',
        run:  () => runEdit(ctx, [T1200_CREDIT_400, T1200_CREDIT_400, T1200_CREDIT_400], {
                message: 'Put this photo on the home page',
                images: [{ url: 'https://uploads.ai1st.site/photo.png', originalFilename: 'photo.png' }] }),
        want: 'edit-complete',
      },
    ];
    for (const arm of arms) {
      if (!pristine.includes(arm.from)) { bad(`⑬${arm.why.slice(0, 2)} 变异锚点找不到 —— 这一臂什么都没证明`); continue; }
      fs.writeFileSync(target, pristine.replace(arm.from, arm.to));
      const res = arm.run();
      fs.writeFileSync(target, pristine);
      const got = res.events.map(e => e.event).join(' ');
      const stacks = stackLines(res).length;
      const wantOk = ev(res, arm.want).length === 1 && (!arm.alsoWantStack || stacks > 0);
      if (wantOk) ok(`⑬${arm.why} —— 实测事件序列 ${got}${arm.alsoWantStack ? `、栈行 ${stacks} 行` : ''}`);
      else bad(`⑬${arm.why}，但它没红：事件 ${got}、栈行 ${stacks}`);
    }
    if (fs.readFileSync(target, 'utf8') === pristine) ok('⑬E 变异已还原（这棵树上那份 edit-site.js 跟变异前逐字节相同）');
    else bad('⑬E 变异没还原干净 —— 后面任何一格的读数都不许用');
  }
}

// ══ ⑬F 说了「Nothing on your site was changed.」就真的没改（#1200 r2，QA2 打回 r1）═════════════
//
// 🔴 A~E 五格**全部在第一次 API 调用就结束** ⟹ 磁盘从来没被写过，那句「Nothing on your site was
//    changed.」在它们身上是**恒真**的 —— 它们对这条性质一个字都没说。能分辨的只有这个形状：
//    **第 1 轮模型成功 write_file 落盘 → 第 2 轮 provider 才 400**。QA2 在真 `edit-site.js` 进程 +
//    真 git 仓上量到 r1 在这里说了假话：老板收到「什么都没改」，而 `site/en/pages/about.json` 还
//    带着这次的改动躺在工作树上；接着一次**改别的文件**的成功编辑，它的 `git add -A` 把它一起提交
//    进了 HEAD。跟 #1102 头注里那条时间线逐字同形。
//
// 🔴 所以这一格的终点不是「事件里那句话」，是**下一次成功编辑之后 HEAD 里有没有这次的字节** ——
//    那才是老板真正受的伤（他被告知没改，而它进了他的站）。
{
  const MARK = 'MARK-1200F-DO-NOT-SHIP';

  /**
   * 跑完整条时间线，返回它留下的**事实**。`mutate` 非 null 时先在这棵树自己那份 edit-site.js 上
   * 做一处单变量变异（⑬F3 的反向对照用）。
   */
  function timeline(label, mutate) {
    const c = makeRoot(`img-error-after-write-${label}`);
    const site = writeSite(c.work);
    assertSyncsClean(c.work, `⑬F(${label}) 夹具`);
    c.git('git add -A && git commit -q -m base && git push -q origin main');

    const target = path.join(c.work, 'scripts', 'edit-site.js');
    if (mutate) {
      const src = fs.readFileSync(target, 'utf8');
      if (!src.includes(mutate.from)) return { anchorMissing: true };
      fs.writeFileSync(target, src.replace(mutate.from, mutate.to));
    }

    const about = path.join(site, 'en', 'pages', 'about.json');
    const beforeBytes = fs.readFileSync(about);
    const page = JSON.parse(beforeBytes.toString('utf8'));

    // 第 1 轮：模型先成功写 about.json，下一轮 provider 拿 400 拒收
    //（第 3 条是图片探针，第 4 条是 r3 那条对照臂 —— 一张图都不带，被收下 ⟹ 账号是好的）。
    const res1 = runEdit(c, [
      reply([textBlock('Updating the about page first.'),
        writeCall('t1', 'en/pages/about.json', JSON.stringify({ ...page, title: MARK }, null, 2))], 'tool_use'),
      T1200_DOWNLOAD_400,
      T1200_DOWNLOAD_400,
      reply([textBlock('.')]),
    ], {
      message: 'Now put this photo on the home page',
      images: [{ url: 'https://uploads.ai1st.site/gone.png', originalFilename: 'gone.png' }],
    });

    const done = ev(res1, 'edit-complete');
    const msg = done.length ? String(done[0].message) : '';
    const restored = /#1200 rollback: restored (\d+)/.exec(res1.stderr);
    const wroteThisRun = /"tool":"write_file"/.test(JSON.stringify(res1.events));
    const aboutIsBack = fs.readFileSync(about).equals(beforeBytes);
    const dirty = cp.execSync('git status --porcelain', { cwd: c.work, encoding: 'utf8' }).trim();

    // 第 2 轮：一次**改别的文件**的成功编辑 —— 它的 `git add -A` 会把工作树上剩下的东西一起提交。
    const good = [{ id: 's1', name: 'Renamed', shortDescription: 'a', fullDescription: 'b', icon: 'leaf', features: [], products: [] }];
    const res2 = runEdit(c, [
      reply([textBlock('Renaming the service.'), writeCall('t1', 'en/services.json', JSON.stringify(good, null, 2))], 'tool_use'),
      reply([textBlock('Changes applied.')], 'end_turn'),
    ]);
    let inHead = '';
    try { inHead = cp.execSync('git show HEAD:site/en/pages/about.json', { cwd: c.work, encoding: 'utf8' }); }
    catch (e) { inHead = ''; }

    return {
      events1: res1.events.map(e => e.event).join(' '), msg, restored: restored ? Number(restored[1]) : null,
      wroteThisRun, aboutIsBack, dirty, stderrTail: res1.stderr.slice(-400),
      secondEditCommitted: res2.commitsAfter === res2.commitsBefore + 1,
      markInHead: inHead.includes(MARK),
    };
  }

  console.log('\n⑬F 先写了盘、下一轮才 400 ⟹ 那句「什么都没改」必须是真的（#1200 r2）');
  const t = timeline('real', null);

  // 🔴 前提自检先跑：这一跑要是根本没写过盘，下面每一条断言都是恒绿的（跟 A~E 同盲）。
  if (t.wroteThisRun && t.restored >= 1) ok(`⑬F0 前提成立：这一跑真的写过盘（tool_use write_file 发出去了、回滚 restored ${t.restored}）`);
  else bad(`⑬F0 前提不成立：wroteThisRun=${t.wroteThisRun} restored=${t.restored} ⟹ 下面的读数什么都没证明。stderr 尾：${t.stderrTail}`);

  if (/Nothing on your site was changed\./.test(t.msg) && /gone\.png/.test(t.msg)) ok('⑬F1 老板收到的还是那句人话 + 「Nothing on your site was changed.」');
  else bad(`⑬F1 事件/措辞不对：${t.events1}｜「${t.msg}」`);

  if (t.aboutIsBack) ok('⑬F2 磁盘上 about.json 逐字节回到编辑之前 ⟹ 那句话在磁盘上也成立');
  else bad('🔴 ⑬F2 那句话是假的：about.json 还带着这次写进去的改动');

  if (!t.dirty) ok('⑬F3 工作树干净 ⟹ 下一次成功编辑的 `git add -A` 扫不到这次的东西');
  else bad(`🔴 ⑬F3 工作树还脏着：${t.dirty.replace(/\n/g, ' | ')}`);

  if (t.secondEditCommitted && !t.markInHead) ok('⑬F4 下一次成功编辑之后，HEAD 里的 about.json 不带这次的字节 ⟹ 老板的站上真的没有它');
  else bad(`🔴 ⑬F4 它进 HEAD 了（第二次编辑 commit=${t.secondEditCommitted}、HEAD 里有标记=${t.markInHead}）—— 这正是 QA2 量到的那条时间线`);

  // ── 反向对照（AC5 那一维）：把新加的那次回滚拿掉，上面四条必须红，而且红在**它该红的那一格** ──
  {
    const m = timeline('nofix', {
      from: '            const rb = rollbackWrittenFiles(siteDir, writeSnapshots);',
      to:   '            const rb = { restored: [], removed: [], failed: [] };',
    });
    if (m.anchorMissing) {
      bad('⑬F5 变异锚点找不到 —— 这一臂什么都没证明');
    } else if (!m.aboutIsBack && m.markInHead && /Nothing on your site was changed\./.test(m.msg)) {
      ok(`⑬F5 反向对照：拿掉那次回滚 ⟹ 老板照样收到「什么都没改」，而 about.json 留在盘上（工作树 ${m.dirty.replace(/\n/g, ' | ')}）并进了 HEAD ⟹ ⑬F2/F4 量的就是这次修法`);
    } else {
      bad(`⑬F5 反向对照没红成它该红的样子：aboutIsBack=${m.aboutIsBack} markInHead=${m.markInHead} 措辞=「${m.msg.slice(0, 120)}」`);
    }
  }

  // ── F6：退不掉的时候**改口**，不硬说那句话 ────────────────────────────────────────────────
  //
  // 新那段有两条出路（跟 #1102 / #1192 两处同一套）：退干净 ⟹ 说「Nothing on your site was
  // changed.」；退不掉 ⟹ 改口。上面 F1~F5 全部走的是前一条 —— 后一条要是从来没被跑过，
  // 「它会改口」就只是我写在注释里的一句话。
  //
  // 🔴 触发用的是**真机制**，不是变异：`write_file` 在落盘之前给这个文件拍快照，而
  //    `st.size > SNAPSHOT_MAX_BYTES`（32 MB）时它记的是一句「太大，存不下」而不是字节
  //    （`edit-site.js` 搜 `SNAPSHOT_MAX_BYTES`）。所以先把 `en/seo.json` 撑过 32 MB。
  {
    const c = makeRoot('img-error-undo-failed');
    const site = writeSite(c.work);
    assertSyncsClean(c.work, '⑬F6 夹具');
    c.git('git add -A && git commit -q -m base && git push -q origin main');

    const seoPath = path.join(site, 'en', 'seo.json');
    const seo = JSON.parse(fs.readFileSync(seoPath, 'utf8'));
    fs.writeFileSync(seoPath, JSON.stringify({ ...seo, __pad: 'x'.repeat(33 * 1024 * 1024) }));
    const padded = fs.statSync(seoPath).size;

    const res = runEdit(c, [
      reply([textBlock('Updating SEO first.'),
        writeCall('t1', 'en/seo.json', JSON.stringify({ ...seo, metaTitle: MARK }, null, 2))], 'tool_use'),
      T1200_DOWNLOAD_400,
      T1200_DOWNLOAD_400,
      reply([textBlock('.')]),
    ], {
      message: 'Now put this photo on the home page',
      images: [{ url: 'https://uploads.ai1st.site/gone.png', originalFilename: 'gone.png' }],
    });
    const done = ev(res, 'edit-complete');
    const msg = done.length ? String(done[0].message) : '';
    const failedN = /#1200 rollback: .* failed (\d+)/.exec(res.stderr);

    if (padded > 32 * 1024 * 1024 && failedN && Number(failedN[1]) === 1) {
      ok(`⑬F6 前提成立：撑到 ${padded} 字节 ⟹ 快照记的是「太大」，这一跑回滚 failed=1`);
    } else {
      bad(`⑬F6 前提不成立：padded=${padded} failed=${failedN && failedN[1]} ⟹ 下面那条断言什么都没证明。stderr 尾：${res.stderr.slice(-400)}`);
    }
    const changedTack = !/Nothing on your site was changed\./.test(msg)
      && /could not be undone/.test(msg) && /seo\.json/.test(msg);
    if (done.length === 1 && changedTack) ok(`⑬F6 它改口了，没硬说那句话：「${msg}」`);
    else bad(`🔴 ⑬F6 退不掉却还在说「什么都没改」：${res.events.map(e => e.event).join(' ')}｜「${msg}」`);
    // 诚实性自检：改口的前提是那份改动**真的**还在盘上 —— 不然改口本身才是那句假话。
    if (fs.readFileSync(seoPath, 'utf8').includes(MARK)) ok('⑬F6 那份改动确实还在盘上 ⟹ 改口说的是实话');
    else bad('🔴 ⑬F6 改了口，但盘上其实已经退干净了 —— 这次是反过来吓唬老板');
  }
}

console.log(`\n══ 汇总: 通过 ${pass} · 失败 ${fail} ══`);
process.exit(fail ? 1 : 0);
