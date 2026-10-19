#!/usr/bin/env node
'use strict';
// #1807 验收 4 → #1830 改走新路 —— 「AI 改站」与「编辑器存盘」撞一次：两笔都不丢。
//
//   node scripts/edit-site-concurrent-save.test.js   （`npm run test:scripts` 按文件名发现）
//   退出码: 0 全过 · 1 有失败 · 2 跑不起来（**不许当成通过**）
//
// #1807 那一版撞的是同一棵树、同一个 git（AI 的 sync-config 派生 vs 编辑器的写盘 + commit），用站点文件锁排开。
// #1830 起两边不再共用任何一个文件：编辑器存的是库（manager §commitSiteContent），AI 改的是 `site.js edit` 每一跑新铺的
// 私有临时目录，跑完把整份产出交给 manager，manager 拿「这一轮开始时那一版」当基准落库 —— 基准之后老板改过的文件，只要
// AI 没碰，按文件三方合并留下；两边真改了同一份才 conflict（Go 侧 `manager/ticket1830_test.go` 测合并）。
//
// 所以这一侧要钉的是**合并能成立的前提**：AI 那一轮的产出（`edited.files` 和 result.json）只算它自己改的文件，不把这一轮
// 开始时的旧菜单当成「AI 的改动」带出去。读数：
//   ① 终态 edit-complete，前面有一条 `edited`
//   ② `edited.files` 只有 about 页（navigation.json 不在里面 —— 在里面就是一次假冲突，或者老板那颗按钮被盖掉）
//   ③ result.json 里的 navigation.json 跟这一轮开始时那份逐字相同（AI 没碰它）
//   ④ 编辑器在 AI 跑的半路写进「库」的那一笔原样在（`site.js edit` 从不写 --site 那份）
//   ⑤ `edit-site.js` 里没有 site-files-lock 了（票的 AC：改之前 2 处）
//   并核：编辑器那一笔确实发生在 AI 跑的半路（第二轮模型请求之前写下的）。

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

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'edit-1830-concurrent-'));
process.on('exit', () => fs.rmSync(root, { recursive: true, force: true }));

// 假模型（同 lib/edit-site-chain.test.js 那一招）。一条回复可以带 `__before`：在把它交给 edit-site.js 之前先做的写盘 ——
// 这里拿它扮演「老板在 AI 跑的半路点了存盘」。
const STUB = `
'use strict';
const fs = require('fs');
const Module = require('module');
const script = JSON.parse(fs.readFileSync(process.env.EDIT_STUB_SCRIPT, 'utf8'));
let turn = 0;
class FakeAnthropic {
  constructor() {
    const next = () => {
      const r = script[turn]; turn += 1;
      if (!r) throw new Error('回放脚本用完了');
      for (const w of r.__before || []) { fs.writeFileSync(w.file, w.content); fs.writeFileSync(w.file + '.at-turn', String(turn)); }
      const { __before, ...reply } = r;
      return reply;
    };
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

/** 一份真的站（skipAI 建站，同 site-create.test.js），就是「库里那一行」。 */
function makeContent() {
  const out = path.join(root, 'create');
  const env = { ...process.env };
  delete env.ANTHROPIC_API_KEY;
  const r = cp.spawnSync(process.execPath, [path.join(NEXT, 'scripts', 'site.js'), 'create', '--out-dir', out], {
    input: JSON.stringify({ siteId: 'edit1830c', siteUrl: 'https://edit1830c.example.com', companyName: 'Northside Auto Care',
      industry: 'auto repair', location: 'Toronto', skipAI: true, skipGeocode: true, language: 'en' }),
    cwd: NEXT, env, encoding: 'utf8', maxBuffer: 64 << 20, timeout: 180000,
  });
  const created = (r.stdout || '').split('\n').map((l) => { try { return JSON.parse(l); } catch (e) { return null; } }).find((e) => e && e.event === 'created');
  if (r.status !== 0 || !created) die(`夹具立不起来（site.js create rc=${r.status}）\n${(r.stderr || '').slice(-600)}`);
  return JSON.parse(fs.readFileSync(created.result, 'utf8')).content;
}

// 深拷贝：content 里的值本来就是对象，改 about / 顶栏不许改到 content 本身。
const asObj = (v) => JSON.parse(typeof v === 'string' ? v : JSON.stringify(v));
const NAV = 'en/navigation.json';
const ABOUT = 'en/pages/about.json';

function main() {
  console.log('\n#1830 AI 改站跑到半路，老板在编辑器里存了顶栏 ⟹ AI 的产出只算 about 页');
  const content = makeContent();
  if (!content[NAV] || !content[ABOUT]) die(`夹具里没有 ${NAV} / ${ABOUT}`);
  const db = path.join(root, 'content.json'); // 「库」
  fs.writeFileSync(db, JSON.stringify(content));

  // AI 改 about 页里一个块的标题（不碰页面标题 —— 那会经菜单同步改到 navigation.json，是另一件事）。
  const about = asObj(content[ABOUT]);
  const block = (about.blocks || []).find((b) => b && b.data && typeof b.data.headline === 'string');
  if (!block) die('about 页上没有带 headline 的块');
  block.data.headline = 'Edited by the AI (#1830)';
  // 编辑器那一笔：库里的顶栏多一颗按钮（manager 的 site.js save 落库后那一行的样子）。
  const ownerNav = asObj(content[NAV]);
  ownerNav.header = { ...(ownerNav.header || {}), buttons: [...((ownerNav.header || {}).buttons || []), { label: 'SAVED-IN-THE-EDITOR', href: '/contact' }] };
  const ownerContent = { ...content, [NAV]: ownerNav };

  const script = [
    reply([{ type: 'tool_use', id: 'w1', name: 'write_file', input: { path: ABOUT, content: JSON.stringify(about, null, 2) } }], 'tool_use'),
    { ...reply([{ type: 'text', text: 'Updated the About page.' }]), __before: [{ file: db, content: JSON.stringify(ownerContent) }] },
  ];
  const stub = path.join(root, 'stub.js');
  const scriptPath = path.join(root, 'script.json');
  fs.writeFileSync(stub, STUB);
  fs.writeFileSync(scriptPath, JSON.stringify(script));
  const out = path.join(root, 'ai-out');
  fs.mkdirSync(out);
  const r = cp.spawnSync(process.execPath, ['--require', stub, path.join(NEXT, 'scripts', 'site.js'), 'edit',
    '--site', db, '--message', 'Change the About page', '--out-dir', out], {
    cwd: NEXT, encoding: 'utf8', input: JSON.stringify({ siteId: 'edit1830c' }), timeout: 180000,
    env: { ...process.env, ANTHROPIC_API_KEY: 'stub-not-used', EDIT_STUB_SCRIPT: scriptPath },
  });
  const events = (r.stdout || '').split('\n').filter(Boolean).map((l) => { try { return JSON.parse(l); } catch (e) { return {}; } });
  const edited = events.find((e) => e.event === 'edited');
  const terminal = events.filter((e) => e.event === 'edit-complete' || e.event === 'error');

  check(fs.existsSync(`${db}.at-turn`) && fs.readFileSync(`${db}.at-turn`, 'utf8') === '2',
    '前提：编辑器那一笔写在 AI 跑的半路（第二轮模型请求之前）');
  check(r.status === 0 && terminal.length === 1 && terminal[0].event === 'edit-complete' && !!edited,
    '① 终态 edit-complete、前面有一条 edited', `rc=${r.status} · ${events.map((e) => e.event).join(' ')}\n${(r.stderr || '').slice(-600)}`);
  if (edited) {
    check(JSON.stringify(edited.files) === JSON.stringify([ABOUT]), '② edited.files 只有 about 页', JSON.stringify(edited.files));
    const result = JSON.parse(fs.readFileSync(edited.result, 'utf8'));
    check(JSON.stringify(asObj(result.content[NAV])) === JSON.stringify(asObj(content[NAV])),
      '③ result.json 里的 navigation.json 跟这一轮开始时那份逐字相同（AI 没碰它，manager 合并时留老板那份）');
    check(JSON.stringify(asObj(result.content[ABOUT])).includes('Edited by the AI (#1830)'), '③b result.json 里 about 页带着 AI 那一处');
  }
  const dbNow = JSON.parse(fs.readFileSync(db, 'utf8'));
  check(JSON.stringify(dbNow[NAV]).includes('SAVED-IN-THE-EDITOR') && !JSON.stringify(dbNow[ABOUT]).includes('Edited by the AI'),
    '④ 「库」里是编辑器那一笔、没被 site.js edit 写过');
  const lockHits = (fs.readFileSync(path.join(NEXT, 'scripts', 'edit-site.js'), 'utf8').match(/site-files-lock/g) || []).length;
  check(lockHits === 0, '⑤ edit-site.js 里没有 site-files-lock 了', `${lockHits} 处`);

  console.log(`\n══ 汇总: 通过 ${pass} · 失败 ${fail} ══`);
  process.exit(fail ? 1 : 0);
}

main();
