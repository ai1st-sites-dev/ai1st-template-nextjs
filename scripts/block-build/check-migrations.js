#!/usr/bin/env node
// ══════════════════════════════════════════════════════════════════════════════════════════════════
// check-migrations.js — 块改了数据形状必须带迁移（#1917，设计文档 §8.3 合并闸）
// ══════════════════════════════════════════════════════════════════════════════════════════════════
//
// 跑法:  node templates/nextjs/scripts/block-build/check-migrations.js [--repo <仓根>] [--base <git-ref>]
// 退出码: 0 都交代了 · 1 有块没交代（逐条点名）· 2 跑不起来（取不到基准 / 基准或现在的块读不出来 —— **不许当成通过**）
//
// 拿【现在的工作树】的 `templates/nextjs/blocks/` 跟【基准】那一版比，两条判据：
//   ① 版本涨了没迁移：某块 manifest 的 `schemaVersion` 比基准高，而它文件夹里的 `migrations.js` 缺其中某一步
//      `'<n>→<n+1>'` ⟹ 红，点名块和缺的那一步。
//   ② 块没了没交代：基准里有、现在没有的块类型，既没有任何还在的块的 `migrations.js` 里写着 `'<旧>→<还在的块>'`，
//      也没有在 `templates/nextjs/blocks-retired.json` 登记 `"<旧>": "freeze"` ⟹ 红，点名块。
//      🔴 跨类型那一步只可能写在【别的块】的表里 —— 块文件夹一删，它自己那份 `migrations.js` 跟着没了。
//   ③ 不许退役的块标了退役（#1839，设计文档 §8.2）：带表单或交互的六个块（§NEVER_RETIRED）manifest 里写了 `retired: true` ⟹ 红。
//      退役机制（不可添加、待升级锁块、冻成 Custom HTML）对它们不可用：表单 / 灯箱 / 价格切换冻成静态 HTML 就不工作了。
//
// 基准 = 上一个 `build-*` tag（release 每次部署打的那种，`build-<sha 前 12 位>`），排除这个 commit 自己那枚 ——
//   `ci` 在 release 打完 tag 之后被重跑时，不排除就是拿自己跟自己比，恒绿。
//   🔴 取不到（浅克隆没拉 tag、`ci` 的 checkout 少了 `fetch-depth: 0`）⟹ exit 2「取不到基准」，不是放行：
//      rc=0 地什么都没查，跟「查了没问题」同形。
//
// 两边都经 `block-migrations.js` §loadBlockVersions 读 —— manifest 没写 `schemaVersion` 按 1 算（#1838 之前的 tag
// 上 17 份 manifest 都没写这个字段，那一跳不许红），迁移表的形状也由它的 §checkMigrationTable 判（判据只留一处）。
//
// 用的地方：`ci-cd.yml` 的 `ci` job（push main 之后、release 之前；release `needs: ci`）·
//          `ai-team/dispatcher/ship-check-block-migrations.sh`（ship 前，进 ship-check-all.sh）。
// 只看代码侧（manifest 与 migrations.js 对不对得上），不读库；两个 tag 之间的中间态看不到。
'use strict';

const cp = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { loadBlockVersions } = require('../lib/block-migrations');

const BLOCKS_REL = 'templates/nextjs/blocks';
const RETIRED_REL = 'templates/nextjs/blocks-retired.json';
const TYPE_STEP_RE = /^([a-z0-9-]+)→([a-z0-9-]+)$/;
// #1839 —— 带表单或交互的块，永不退役（设计文档 §8.2「只能改不能删」）。
const NEVER_RETIRED = ['contact', 'header', 'footer', 'gallery', 'testimonials', 'pricing'];

/** 跑不起来（rc=2）—— 跟「有块没交代」（rc=1）分开。 */
class CannotCheck extends Error {}

const git = (repo, args, opts = {}) => cp.execFileSync('git', ['-C', repo, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], ...opts });

/** 上一个 `build-*` tag（不含 HEAD 自己那枚）。取不到 ⟹ CannotCheck。 */
function findBase(repo) {
  let head;
  try { head = git(repo, ['rev-parse', 'HEAD']).trim(); } catch (e) { throw new CannotCheck(`读不到 HEAD：${(e.stderr || e.message).trim()}`); }
  try {
    return git(repo, ['describe', '--tags', '--abbrev=0', '--match', 'build-*', '--exclude', `build-${head.slice(0, 12)}`, 'HEAD']).trim();
  } catch (e) {
    const shallow = (() => { try { return git(repo, ['rev-parse', '--is-shallow-repository']).trim() === 'true'; } catch { return false; } })();
    throw new CannotCheck(`取不到基准：HEAD 往上找不到任何 build-* tag（${(e.stderr || e.message).trim().split('\n')[0]}）`
      + (shallow ? ' —— 这是一份浅克隆，checkout 要 `fetch-depth: 0` 才会带上历史和 tag' : ''));
  }
}

/** 基准那一版的块目录，解到一个临时目录里。读不出来 ⟹ CannotCheck。 */
function extractBlocks(repo, ref) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'check-migrations-'));
  try {
    const tar = cp.execFileSync('git', ['-C', repo, 'archive', '--format=tar', ref, BLOCKS_REL], { stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 1 << 30 });
    cp.execFileSync('tar', ['-x', '-C', tmp], { input: tar, stdio: ['pipe', 'ignore', 'pipe'] });
  } catch (e) {
    fs.rmSync(tmp, { recursive: true, force: true });
    throw new CannotCheck(`基准 ${ref} 的 ${BLOCKS_REL} 读不出来：${String(e.stderr || e.message).trim().split('\n')[0]}`);
  }
  return { dir: path.join(tmp, BLOCKS_REL), cleanup: () => fs.rmSync(tmp, { recursive: true, force: true }) };
}

/** `blocks-retired.json`：`{ "<类型>": "freeze" }`。文件不在 = 一个都没登记。形状不对 ⟹ 返回 problem，不当成空。 */
function readRetired(file) {
  if (!fs.existsSync(file)) return { frozen: new Set(), problems: [] };
  let v;
  try { v = JSON.parse(fs.readFileSync(file, 'utf8')); } catch (e) { return { frozen: new Set(), problems: [`${RETIRED_REL} 不是合法 JSON：${e.message}`] }; }
  if (v === null || typeof v !== 'object' || Array.isArray(v)) return { frozen: new Set(), problems: [`${RETIRED_REL} 要是一个对象 { "<块类型>": "freeze" }`] };
  const frozen = new Set();
  const problems = [];
  for (const [type, how] of Object.entries(v)) {
    if (how === 'freeze') frozen.add(type);
    else problems.push(`${RETIRED_REL} 的 ${JSON.stringify(type)} 写的是 ${JSON.stringify(how)} —— 只认 "freeze"`);
  }
  return { frozen, problems };
}

/**
 * 两份 `loadBlockVersions` 的结果比一次。回 `{ checked, problems }`：checked = 基准里的块类型数（每个都按 ① 或 ② 判过一次）。
 * 新加的块（基准里没有）没有可比的东西，不计。
 */
function compare(base, current, frozen) {
  const problems = [];
  for (const [type, b] of base) {
    const c = current.get(type);
    if (c) {
      for (let n = b.schemaVersion; n < c.schemaVersion; n += 1) {
        const key = `${n}→${n + 1}`;
        if (!Object.prototype.hasOwnProperty.call(c.migrations, key)) {
          problems.push(`块 ${type} 的 schemaVersion 从 ${b.schemaVersion} 涨到了 ${c.schemaVersion}，它文件夹里的 migrations.js 缺 '${key}'`);
        }
      }
      continue;
    }
    const by = [];
    for (const [owner, v] of current) {
      for (const key of Object.keys(v.migrations)) {
        const m = key.match(TYPE_STEP_RE);
        if (m && m[1] === type && current.has(m[2])) by.push(`${owner} 的 '${key}'`);
      }
    }
    if (by.length || frozen.has(type)) continue;
    problems.push(`块 ${type} 在基准里有、现在没了：没有任何还在的块的 migrations.js 写着 '${type}→<还在的块>'，`
      + `${RETIRED_REL} 里也没有 "${type}": "freeze"`);
  }
  return { checked: base.size, problems };
}

/** ③：六个永不退役的块里有谁的 manifest 标了 `retired: true`。 */
function neverRetiredProblems(current) {
  return NEVER_RETIRED.filter((t) => current.has(t) && current.get(t).retired === true)
    .map((t) => `块 ${t} 的 manifest 标了 retired: true —— 带表单或交互的块（${NEVER_RETIRED.join(' / ')}）永不退役，只能改`);
}

function run({ repo, base }) {
  const ref = base || findBase(repo);
  const old = extractBlocks(repo, ref);
  let baseVersions;
  try {
    if (!fs.existsSync(old.dir)) throw new CannotCheck(`基准 ${ref} 里没有 ${BLOCKS_REL}`);
    try { baseVersions = loadBlockVersions(old.dir); } catch (e) { throw new CannotCheck(`基准 ${ref} 的块读不出来：${e.message}`); }
  } finally {
    old.cleanup();
  }
  const problems = [];
  // 读不出来 ⟹ 什么都没比，跟「基准读不出来」同档（rc=2）。r1 把它记成一条问题、再拿一张空表去比，
  // 于是基准里每个块都被报成「没了」—— 1 条真因后面跟着 18 条假的（#1917 r1，QA1）。
  let current;
  try {
    current = loadBlockVersions(path.join(repo, BLOCKS_REL));
  } catch (e) {
    throw new CannotCheck(`现在的块读不出来：${e.message}`);
  }
  const retired = readRetired(path.join(repo, RETIRED_REL));
  problems.push(...retired.problems);
  const r = compare(baseVersions, current, retired.frozen);
  problems.push(...r.problems);
  problems.push(...neverRetiredProblems(current));
  return { ref, checked: r.checked, problems };
}

function main(argv) {
  let repo = null;
  let base = null;
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--repo') repo = argv[(i += 1)];
    else if (argv[i] === '--base') base = argv[(i += 1)];
    else { console.log(`⛔ 不认识的参数 ${argv[i]}。用法：check-migrations.js [--repo <仓根>] [--base <git-ref>]`); return 2; }
  }
  try {
    repo = path.resolve(repo || git(__dirname, ['rev-parse', '--show-toplevel']).trim());
    const r = run({ repo, base });
    if (r.checked === 0) {
      console.log(`⛔ 跑不起来：基准 ${r.ref} 里一个块都没读到 —— 什么都没比，不是通过`);
      return 2;
    }
    for (const p of r.problems) console.log(`🔴 ${p}`);
    if (r.problems.length) {
      console.log('   ⟹ 块改了数据形状要同一个 PR 带迁移（设计文档 §8.3）；删掉的块要么写一步跨类型迁移，要么在 blocks-retired.json 登记 freeze。');
    }
    console.log(`共查 ${r.checked} 个块类型（基准 ${r.ref}）· ${r.problems.length ? `${r.problems.length} 处没交代` : '都交代了'}`);
    return r.problems.length ? 1 : 0;
  } catch (e) {
    if (e instanceof CannotCheck) { console.log(`⛔ 跑不起来：${e.message}`); return 2; }
    console.log(`⛔ 跑不起来：${e && e.stack ? e.stack : e}`);
    return 2;
  }
}

if (require.main === module) process.exit(main(process.argv.slice(2)));

module.exports = { compare, readRetired, findBase, run, main, neverRetiredProblems, NEVER_RETIRED };
