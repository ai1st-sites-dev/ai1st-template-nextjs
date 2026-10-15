// #1791 验收 6 容器那一跳：`edit-site.js` 收到带 `region` 的输入，真的认出了这是顶栏 / 页脚范围。
//
// 读数是它自己吐的进度那一行（`Working on the header...`）—— 这一行只在 `scopeFromInput` 认出 region 之后才吐
// （`edit-site.js` §main），所以 manager / worker 哪一跳把 region 丢了，容器里就不会有这一句（验收 7 在 appdev 上读的也是它）。
// 这里量的是「容器拿到了 region 会不会认」，不是 worker 有没有转发（那是 `worker/ticket1791_test.go`）。
//
// ── 这里什么是真的 ──────────────────────────────────────────────────────────────────────────────
//   真 `edit-site.js`、真站（临时目录里 skipAI 建的，同 editor-ai-history.test.js）、真 stdin / stdout。
//   🔴 不碰真 AI：`ANTHROPIC_API_KEY` 给假值、`ANTHROPIC_BASE_URL` 指本机一个没人听的端口 ⟹ 进度那一行吐完之后，
//      第一次调模型就连不上、脚本以 error 收场。这里只读它在那之前吐的几行。
//
// 每一格两向：带 region 的要吐那一句、不带的（普通聊天 / 块范围）不许吐。

const fs = require('fs');
const os = require('os');
const path = require('path');
const cp = require('child_process');
const net = require('net');

const NEXT = path.resolve(__dirname, '..');
let pass = 0;
let fail = 0;
const ok = (m) => { pass += 1; console.log(`  ✅ ${m}`); };
const bad = (m) => { fail += 1; console.log(`  ❌ ${m}`); };
const temps = [];
function die(m) { console.log(`🔴 ${m}`); for (const t of temps) fs.rmSync(t, { recursive: true, force: true }); process.exit(2); }

// ── 夹具：skipAI 建一个单语真站 ─────────────────────────────────────────────────────────────────
function makeTemplate() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'edit-site-region-'));
  temps.push(root);
  const work = path.join(root, 'nextjs');
  cp.execSync(`cp -a --no-dereference "${NEXT}" "${work}"`, { stdio: 'pipe' });
  for (const junk of ['out', '.next', '.out-backup', '.out-temp', 'site', 'node_modules']) {
    fs.rmSync(path.join(work, junk), { recursive: true, force: true });
  }
  fs.symlinkSync(path.join(NEXT, 'node_modules'), path.join(work, 'node_modules'));
  const r = cp.spawnSync(process.execPath, [path.join(work, 'scripts', 'create-site.js')], {
    input: JSON.stringify({ siteId: 'region01', siteUrl: 'https://region01.example.com', companyName: 'Northside Auto Care', industry: 'auto repair', location: 'Toronto', skipAI: true, language: 'en' }),
    cwd: work, encoding: 'utf8', env: { ...process.env, ANTHROPIC_API_KEY: undefined }, timeout: 180000,
  });
  if (!fs.existsSync(path.join(work, 'site', 'en', 'navigation.json'))) die(`夹具立不起来（rc=${r.status}）\n${(r.stderr || '').slice(-600)}`);
  return work;
}

/** 本机一个此刻没人听的端口（拿到就关掉）。 */
function deadPort() {
  return new Promise((resolve) => {
    const s = net.createServer();
    s.listen(0, '127.0.0.1', () => { const { port } = s.address(); s.close(() => resolve(port)); });
  });
}

function runEdit(work, port, extra) {
  const input = { siteId: 'region01', message: 'Change the hero headline to Hello', ...extra };
  const r = cp.spawnSync(process.execPath, [path.join(work, 'scripts', 'edit-site.js')], {
    input: JSON.stringify(input), cwd: work, encoding: 'utf8', timeout: 120000,
    env: { ...process.env, ANTHROPIC_API_KEY: 'sk-ant-test-not-a-real-key', ANTHROPIC_BASE_URL: `http://127.0.0.1:${port}` },
  });
  const events = (r.stdout || '').split('\n').filter(Boolean).map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
  return { rc: r.status, events, progress: events.filter((e) => e.event === 'progress').map((e) => e.message) };
}

(async () => {
  const work = makeTemplate();
  const port = await deadPort();
  const homeBefore = fs.readFileSync(path.join(work, 'site', 'en', 'pages', 'home.json'), 'utf8');

  const cases = [
    ['region=header', { page: 'home', locale: 'en', region: 'header' }, 'Working on the header...'],
    ['region=footer', { page: 'home', locale: 'en', region: 'footer' }, 'Working on the footer...'],
  ];
  for (const [name, extra, want] of cases) {
    console.log(`\n── ${name}`);
    const r = runEdit(work, port, extra);
    console.log(`     进度: ${JSON.stringify(r.progress)} · rc=${r.rc}`);
    if (r.progress.includes(want)) ok(`吐了「${want}」`); else bad(`没吐「${want}」`);
    if (!r.progress.some((m) => /Working on one block/.test(m))) ok('没说成块范围'); else bad('说成了块范围');
    // 仪器自检：确实停在调模型那一步（假 key + 死端口），没有真去问 AI
    if (r.events.some((e) => e.event === 'error')) ok('以 error 收场（连不上假端口 —— 没碰真 AI）'); else bad(`没有 error 事件: ${JSON.stringify(r.events.slice(-2))}`);
  }

  console.log('\n── 反向对照：不带 region 的输入不吐那一句');
  for (const [name, extra] of [['普通聊天（没有范围）', {}], ['块范围', { page: 'home', locale: 'en', blockId: 'home-hero' }]]) {
    const r = runEdit(work, port, extra);
    console.log(`     ${name} 进度: ${JSON.stringify(r.progress)}`);
    if (!r.progress.some((m) => /Working on the (header|footer)/.test(m))) ok(`${name} ⟹ 没吐 Working on the header / footer`);
    else bad(`${name} 也吐了顶栏 / 页脚那一句`);
  }
  // 块范围那一句照旧（这一格确认仪器读得到「Working on」这一族，不是什么都读不到）
  const blk = runEdit(work, port, { page: 'home', locale: 'en', blockId: 'home-hero' });
  if (blk.progress.some((m) => m === 'Working on one block on en/pages/home.json...')) ok('块范围照旧吐 Working on one block on en/pages/home.json...');
  else bad(`块范围那一句没了: ${JSON.stringify(blk.progress)}`);

  if (fs.readFileSync(path.join(work, 'site', 'en', 'pages', 'home.json'), 'utf8') === homeBefore) ok('跑完首页一个字节没变');
  else bad('首页被改了');

  for (const t of temps) fs.rmSync(t, { recursive: true, force: true });
  console.log(`\n══ ${pass} 过 / ${fail} 败 ══`);
  process.exit(fail ? 1 : 0);
})().catch((e) => die(e.stack || String(e)));
