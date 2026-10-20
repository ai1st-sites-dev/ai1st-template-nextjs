#!/usr/bin/env node
/**
 * check-migrations.test.js — #1917：块改了数据形状必须带迁移，机器来守。
 *
 * 跑法:  node scripts/block-build/check-migrations.test.js   （或 `npm run test:scripts`，按文件名发现）
 * 退出码: 0 全过 · 1 有失败 · 2 跑不起来（**不许当成通过**）
 *
 * 每一格在临时目录里造一个假仓：`templates/nextjs/blocks/` 下只有假块（最小 manifest），基准那一笔打一枚 `build-*` tag，
 * 然后再提交一笔（`ci` 的形状）或只改工作树（ship 前的形状），跑真的 check-migrations.js 子进程，读 rc 和报文。
 * 🔴 真块一个都不碰（正文验收：改真块会污染别人的树）。
 *
 *   ① 版本涨了 + 有迁移 ⟹ 0 · 涨了没迁移 ⟹ 1，点名块和「从几到几」· 1→3 只有 '1→2' ⟹ 1，点名缺的 '2→3'
 *   ② 删了 + blocks-retired.json 登记 freeze ⟹ 0 · 删了什么都没有 ⟹ 1，点名块
 *      删了 + 别的块写着 '<旧>→<它>' ⟹ 0（迁移只可能写在别的块的表里）· 指向一个不存在的块 ⟹ 1
 *      登记写的不是 "freeze" ⟹ 1
 *   ③ 基准的 manifest 没写 schemaVersion、现在写 1 ⟹ 0（#1838 之前的 tag 就是这样，那一跳不许红）
 *   ④ 基准取不到：浅克隆（--depth 1，不带 tag）⟹ 2「取不到基准」并说出浅克隆；同一个仓完整克隆 ⟹ 能取到（阳性对照）
 *   ⑤ HEAD 自己那枚 build tag 不算基准：涨了没迁移的那一笔自己也打上 tag ⟹ 仍然 1（不是拿自己跟自己比的恒绿）
 *   ⑥ 真仓冒烟：这棵树自己跑一次 ⟹ 0，并且「共查 N 个块类型」的 N = 基准那版的块数
 *   ⑦ 现在的块读不出来（migrations.js 键写成 ASCII 箭头 '1->2'）⟹ 2，只说那一条真因，不把别的块报成「没了」
 */
'use strict';

const cp = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', '..');
const SCRIPT = path.join(__dirname, 'check-migrations.js');

let failed = 0;
let passed = 0;
const ok = (m) => { passed += 1; console.log(`  ✅ ${m}`); };
const bad = (m) => { failed += 1; console.log(`  ❌ ${m}`); };
const check = (cond, m, detail) => (cond ? ok(m) : bad(detail === undefined ? m : `${m}\n       ${detail}`));
const die = (m) => { throw new Error(m); }; // 落到文件末尾那个 catch：打「跑不起来」、清临时仓、exit 2

const made = [];
const tmp = (prefix) => { const d = fs.mkdtempSync(path.join(os.tmpdir(), prefix)); made.push(d); return d; };

const BLOCKS = 'templates/nextjs/blocks';
const RETIRED = 'templates/nextjs/blocks-retired.json';
const GIT_ENV = { ...process.env, GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t', GIT_CONFIG_NOSYSTEM: '1' };
const git = (dir, ...args) => cp.execFileSync('git', ['-C', dir, ...args], { encoding: 'utf8', env: GIT_ENV, stdio: ['ignore', 'pipe', 'pipe'] });

/** 写一个假块：`{ type, schemaVersion? }` manifest，`migrations` 给了就写一份 migrations.js（键 → preservesLook）。 */
function writeBlock(repo, type, { schemaVersion, migrations } = {}) {
  const dir = path.join(repo, BLOCKS, type);
  fs.mkdirSync(dir, { recursive: true });
  const m = { type };
  if (schemaVersion !== undefined) m.schemaVersion = schemaVersion;
  fs.writeFileSync(path.join(dir, 'manifest.json'), `${JSON.stringify(m, null, 2)}\n`);
  const mig = path.join(dir, 'migrations.js');
  if (migrations) {
    const body = Object.keys(migrations).map((k) => `  ${JSON.stringify(k)}: { preservesLook: ${migrations[k]}, migrate: (b) => b },`).join('\n');
    fs.writeFileSync(mig, `'use strict';\nmodule.exports = {\n${body}\n};\n`);
  } else if (fs.existsSync(mig)) fs.rmSync(mig);
}
const dropBlock = (repo, type) => fs.rmSync(path.join(repo, BLOCKS, type), { recursive: true, force: true });
const writeRetired = (repo, v) => fs.writeFileSync(path.join(repo, RETIRED), `${JSON.stringify(v, null, 2)}\n`);

/** 假仓：基准那一笔（`base` 里的块）+ tag `build-<12 位>`。回仓根。 */
function repoWith(base) {
  const repo = tmp('t1917-repo-');
  git(repo, 'init', '-q', '-b', 'main');
  for (const [type, opts] of Object.entries(base)) writeBlock(repo, type, opts);
  git(repo, 'add', '-A');
  git(repo, 'commit', '-q', '-m', 'base');
  git(repo, 'tag', 'build-aaaaaaaaaaaa');
  return repo;
}
const commitAll = (repo, msg) => { git(repo, 'add', '-A'); git(repo, 'commit', '-q', '--allow-empty', '-m', msg); };

function runCheck(repo, extra = []) {
  const r = cp.spawnSync(process.execPath, [SCRIPT, '--repo', repo, ...extra], { encoding: 'utf8', env: GIT_ENV });
  return { rc: r.status, out: `${r.stdout}${r.stderr}` };
}
const show = (r) => `rc=${r.rc} · ${r.out.trim().replace(/\n/g, ' ⏎ ').slice(0, 400)}`;

function main() {
  if (!fs.existsSync(SCRIPT)) die(`${SCRIPT} 不在`);
  try { cp.execFileSync('git', ['--version'], { stdio: 'ignore' }); } catch { die('没有 git'); }

  console.log('① 版本涨了');
  {
    const repo = repoWith({ 'fake-x': { schemaVersion: 1 }, 'fake-y': { schemaVersion: 1 } });
    writeBlock(repo, 'fake-x', { schemaVersion: 2, migrations: { '1→2': true } });
    commitAll(repo, 'x 1→2 带迁移');
    const r = runCheck(repo);
    check(r.rc === 0 && r.out.includes('共查 2 个块类型（基准 build-aaaaaaaaaaaa）'), '涨了 + 有 \'1→2\' ⟹ rc=0，基准是那枚 build tag', show(r));
  }
  {
    const repo = repoWith({ 'fake-x': { schemaVersion: 1 }, 'fake-y': { schemaVersion: 1 } });
    writeBlock(repo, 'fake-x', { schemaVersion: 2 });
    commitAll(repo, 'x 1→2 没迁移');
    const r = runCheck(repo);
    check(r.rc === 1 && r.out.includes("块 fake-x 的 schemaVersion 从 1 涨到了 2，它文件夹里的 migrations.js 缺 '1→2'") && !r.out.includes('块 fake-y'),
      '涨了没迁移 ⟹ rc=1，点名 fake-x、从 1 到 2；没牵连 fake-y', show(r));
  }
  {
    const repo = repoWith({ 'fake-x': { schemaVersion: 1 } });
    writeBlock(repo, 'fake-x', { schemaVersion: 3, migrations: { '1→2': true } });
    const r = runCheck(repo); // 只改工作树（ship 前的形状）
    check(r.rc === 1 && r.out.includes("缺 '2→3'") && !r.out.includes("缺 '1→2'"), "1→3 只有 '1→2'（只改工作树）⟹ rc=1，点名缺的 '2→3'", show(r));
  }

  console.log('② 块没了');
  {
    const repo = repoWith({ 'fake-x': { schemaVersion: 1 }, 'fake-y': { schemaVersion: 1 } });
    dropBlock(repo, 'fake-y');
    writeRetired(repo, { 'fake-y': 'freeze' });
    commitAll(repo, '删 y，登记 freeze');
    const r = runCheck(repo);
    check(r.rc === 0, '删了 + blocks-retired.json 登记 freeze ⟹ rc=0', show(r));
  }
  {
    const repo = repoWith({ 'fake-x': { schemaVersion: 1 }, 'fake-y': { schemaVersion: 1 } });
    dropBlock(repo, 'fake-y');
    commitAll(repo, '删 y，什么都没有');
    const r = runCheck(repo);
    check(r.rc === 1 && r.out.includes('块 fake-y 在基准里有、现在没了') && r.out.includes('"fake-y": "freeze"'), '删了、没登记也没迁移 ⟹ rc=1，点名 fake-y', show(r));
  }
  {
    const repo = repoWith({ 'fake-x': { schemaVersion: 1 }, 'fake-y': { schemaVersion: 1 } });
    dropBlock(repo, 'fake-y');
    writeBlock(repo, 'fake-x', { schemaVersion: 1, migrations: { 'fake-y→fake-x': false } });
    commitAll(repo, '删 y，x 的表里写着 y→x');
    const r = runCheck(repo);
    check(r.rc === 0, "删了 + 还在的 fake-x 的表里有 'fake-y→fake-x' ⟹ rc=0", show(r));
  }
  {
    const repo = repoWith({ 'fake-x': { schemaVersion: 1 }, 'fake-y': { schemaVersion: 1 } });
    dropBlock(repo, 'fake-y');
    writeBlock(repo, 'fake-x', { schemaVersion: 1, migrations: { 'fake-y→fake-ghost': false } });
    commitAll(repo, '删 y，迁移指向不存在的块');
    const r = runCheck(repo);
    check(r.rc === 1 && r.out.includes('块 fake-y 在基准里有、现在没了'), "'fake-y→fake-ghost'（fake-ghost 不存在）不算交代 ⟹ rc=1", show(r));
  }
  {
    const repo = repoWith({ 'fake-x': { schemaVersion: 1 }, 'fake-y': { schemaVersion: 1 } });
    dropBlock(repo, 'fake-y');
    writeRetired(repo, { 'fake-y': 'keep' });
    commitAll(repo, '删 y，登记写错');
    const r = runCheck(repo);
    check(r.rc === 1 && r.out.includes('只认 "freeze"') && r.out.includes('块 fake-y 在基准里有、现在没了'), '登记写的是 "keep" ⟹ rc=1，两句都说', show(r));
  }

  console.log('③ 基准没写 schemaVersion');
  {
    const repo = repoWith({ 'fake-x': {}, 'fake-y': {} });
    writeBlock(repo, 'fake-x', { schemaVersion: 1 });
    writeBlock(repo, 'fake-y', { schemaVersion: 1 });
    commitAll(repo, '补上 schemaVersion: 1');
    const r = runCheck(repo);
    check(r.rc === 0, '基准没这个字段、现在写 1 ⟹ rc=0（按 1 算，不是 0）', show(r));
    writeBlock(repo, 'fake-x', { schemaVersion: 2 });
    const r2 = runCheck(repo);
    check(r2.rc === 1 && r2.out.includes('从 1 涨到了 2'), '阳性对照：同一个仓再把 fake-x 涨到 2 不带迁移 ⟹ rc=1、读成「从 1」', show(r2));
  }

  console.log('④ 取不到基准');
  {
    const origin = repoWith({ 'fake-x': { schemaVersion: 1 } });
    writeBlock(origin, 'fake-x', { schemaVersion: 2 });
    commitAll(origin, '涨了没迁移');
    const shallow = path.join(tmp('t1917-shallow-'), 'r');
    cp.execFileSync('git', ['clone', '-q', '--depth', '1', '--no-tags', `file://${origin}`, shallow], { env: GIT_ENV, stdio: 'ignore' });
    const r = runCheck(shallow);
    check(r.rc === 2 && r.out.includes('取不到基准') && r.out.includes('浅克隆') && r.out.includes('fetch-depth: 0'),
      '浅克隆（没有 tag）⟹ rc=2「取不到基准」，并说出是浅克隆、要 fetch-depth: 0', show(r));
    const full = path.join(tmp('t1917-full-'), 'r');
    cp.execFileSync('git', ['clone', '-q', `file://${origin}`, full], { env: GIT_ENV, stdio: 'ignore' });
    const r2 = runCheck(full);
    check(r2.rc === 1 && r2.out.includes('基准 build-aaaaaaaaaaaa'), '阳性对照：同一个仓完整克隆 ⟹ 取到 build-aaaaaaaaaaaa、照常判出红', show(r2));
  }

  console.log('⑤ HEAD 自己那枚 tag 不算');
  {
    const repo = repoWith({ 'fake-x': { schemaVersion: 1 } });
    writeBlock(repo, 'fake-x', { schemaVersion: 2 });
    commitAll(repo, '涨了没迁移');
    const head = git(repo, 'rev-parse', 'HEAD').trim();
    git(repo, 'tag', `build-${head.slice(0, 12)}`);
    const r = runCheck(repo);
    check(r.rc === 1 && r.out.includes('基准 build-aaaaaaaaaaaa'), `HEAD 带着 build-${head.slice(0, 12)} ⟹ 基准仍是上一枚，照样 rc=1`, show(r));
  }

  console.log('⑦ 现在的块读不出来');
  {
    const repo = repoWith({ 'fake-x': { schemaVersion: 1 }, 'fake-y': { schemaVersion: 1 } });
    writeBlock(repo, 'fake-x', { schemaVersion: 2, migrations: { '1->2': true } });
    commitAll(repo, 'x 的迁移键写成 ASCII 箭头');
    const r = runCheck(repo);
    check(r.rc === 2 && r.out.includes('现在的块读不出来') && r.out.includes('1->2') && !r.out.includes('现在没了'),
      "migrations.js 键写成 '1->2' ⟹ rc=2「现在的块读不出来」，没有把 fake-y 报成「没了」", show(r));
  }

  console.log('⑥ 真仓冒烟（只读，不改这棵树）');
  {
    let top;
    try { top = git(ROOT, 'rev-parse', '--show-toplevel').trim(); } catch (e) { die(`这棵树不是 git 仓：${e.message}`); }
    const r = runCheck(top);
    const m = r.out.match(/共查 (\d+) 个块类型（基准 (build-[0-9a-f]+)）/);
    if (!m) {
      check(false, '真仓跑得出一行「共查 N 个块类型（基准 build-…）」', show(r));
    } else {
      const n = git(top, 'ls-tree', '-d', '--name-only', `${m[2]}:${BLOCKS}`).split('\n').filter(Boolean)
        .filter((d) => { try { git(top, 'cat-file', '-e', `${m[2]}:${BLOCKS}/${d}/manifest.json`); return true; } catch { return false; } }).length;
      check(r.rc === 0 && Number(m[1]) === n && n > 0, `真仓 rc=0，共查 ${m[1]} 个 = 基准 ${m[2]} 上带 manifest 的块文件夹 ${n} 个`, show(r));
    }
  }

  console.log(`\n${passed} 过 · ${failed} 失败`);
  return failed ? 1 : 0;
}

let code = 2;
try { code = main(); } catch (e) { console.log(`⛔ 跑不起来：${e && e.stack ? e.stack : e}`); } finally {
  for (const d of made) fs.rmSync(d, { recursive: true, force: true });
}
process.exit(code);
