#!/usr/bin/env node
/**
 * site-create.test.js — `site.js create` 把成品交给 manager 之前过一遍 `stampSchemaVersions(null, content)`，
 * 而且用的是它的**返回值**（#1829 r2，QA2 退回：这一条此前只在 `manager/ticket1829_test.go` 头注里写着「已覆盖」，
 * 删掉 `lib/site-create.js` §finishContent 那句调用没有一格会红）。
 *
 * 跑法:  node scripts/lib/site-create.test.js   （或 `npm run test:scripts`，它按文件名发现）
 * 退出码: 0 全过 · 1 有失败 · 2 跑不起来（**不许当成通过**）
 *
 * 🔴 为什么在这里测、不在 Go 里测：调用在 Node 这一侧，manager 只读 `result.json`，Go 看不见它发生没有。
 * 🔴 真进程：`node --require <探针> scripts/site.js create --out-dir <临时目录>`，skipAI payload（0.4 秒，不调 AI、
 *    不查坐标、模板根一个字节不写）。探针在 require 缓存里把 `stamp-schema-versions.js` 换成一个会留痕的版本：
 *    它把「prev 是不是 null、next 里有哪些文件」写进**返回值**里多出来的一份 `stamp-probe.json`。
 *    ⟹ 成品里出现这份文件 = 调用发生了 + 返回值进了成品；三种删法 / 改法（不调、调了不用返回值、prev 传错）各红一处。
 * 🔴 阳性对照（同一进程）：不带探针跑一次，成品里没有 `stamp-probe.json` —— 否则「有它」什么都不证明。
 */
'use strict';

const assert = require('assert');
const cp = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const SCRIPTS = path.resolve(__dirname, '..');
const STAMP = path.join(__dirname, 'stamp-schema-versions.js');
const PROBE_FILE = 'stamp-probe.json';

// manager §runSiteCreate 送的那几个键（skipGeocode 由它加；siteUrl 是 #1547 起必带的）+ 向导的「demo」payload。
const PAYLOAD = {
  siteId: 'site-t1829stamp', siteUrl: 'https://site-t1829stamp.ai1stsite.dev', companyName: 'Stamp Probe Co',
  industry: 'Demo', services: ['Demo Service'], language: 'en', skipAI: true, skipGeocode: true,
};

let failed = 0;
const fail = (m) => { failed += 1; console.log(`  ❌ ${m}`); };
const ok = (m) => console.log(`  ✅ ${m}`);

function writeProbe(dir) {
  const file = path.join(dir, 'stamp-probe.cjs');
  fs.writeFileSync(file, `'use strict';
const Module = require('module');
const p = ${JSON.stringify(STAMP)};
const m = new Module(p);
m.filename = p;
m.loaded = true;
m.exports = {
  stampSchemaVersions(prev, next) {
    return { ...next, ${JSON.stringify(PROBE_FILE)}: { calls: 1, prevIsNull: prev === null, sawFiles: Object.keys(next).sort() } };
  },
};
require.cache[p] = m;
`);
  return file;
}

/** 跑一次 `site.js create`，返回 { code, events, content }。 */
function runCreate(dir, name, preload) {
  const out = path.join(dir, name);
  const args = [...(preload ? ['--require', preload] : []), path.join(SCRIPTS, 'site.js'), 'create', '--out-dir', out];
  const env = { ...process.env };
  delete env.ANTHROPIC_API_KEY; // skipAI 本来就不调；拿掉它，万一走到 AI 那一段是当场报错而不是花钱
  const r = cp.spawnSync(process.execPath, args, {
    input: JSON.stringify(PAYLOAD), cwd: path.resolve(SCRIPTS, '..'), env, encoding: 'utf8', maxBuffer: 64 << 20, timeout: 120000,
  });
  const events = (r.stdout || '').split('\n').filter((l) => l.trim().startsWith('{')).map((l) => {
    try { return JSON.parse(l); } catch { return null; }
  }).filter(Boolean);
  const created = events.find((e) => e.event === 'created');
  const content = created && fs.existsSync(created.result) ? JSON.parse(fs.readFileSync(created.result, 'utf8')).content : null;
  if (r.status !== 0 || !content) {
    throw new Error(`site.js create (${name}) rc=${r.status} signal=${r.signal}\nstdout tail: ${(r.stdout || '').slice(-600)}\nstderr tail: ${(r.stderr || '').slice(-600)}`);
  }
  return { events, content };
}

function main() {
  console.log('══ #1829 site.js create → stampSchemaVersions(null, content)，返回值进成品 ══');

  // 空壳的接口（T4b 填实时调用方一个字不改，所以接口本身也钉一下）：两个参数，原样返回 next。
  const { stampSchemaVersions } = require('./stamp-schema-versions');
  assert.strictEqual(stampSchemaVersions.length, 2, 'stampSchemaVersions(prev, next) 是两个参数');
  const sample = { 'brand.json': { name: 'x' } };
  assert.strictEqual(stampSchemaVersions(null, sample), sample, '空壳原样返回 next');
  ok('空壳：两个参数、原样返回 next');

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'site-create-test-'));
  try {
    const probe = writeProbe(dir);

    // 阳性对照：真空壳，成品里没有探针那份文件。
    const plain = runCreate(dir, 'plain', null);
    const plainFiles = Object.keys(plain.content);
    if (plainFiles.length === 0) throw new Error('成品是空的 —— 下面的断言全是空尺');
    if (PROBE_FILE in plain.content) fail(`没带探针的成品里也有 ${PROBE_FILE} —— 判据分不开`);
    else ok(`阳性对照：不带探针 ⟹ 成品 ${plainFiles.length} 份文件，没有 ${PROBE_FILE}`);

    // 带探针：调用发生、prev 是 null、返回值进了成品。
    const probed = runCreate(dir, 'probed', probe);
    const stamp = probed.content[PROBE_FILE];
    if (!stamp) {
      fail(`成品里没有 ${PROBE_FILE} ⟹ stampSchemaVersions 没被调用，或者调了但成品没用它的返回值`);
    } else {
      ok(`成品里有 ${PROBE_FILE} ⟹ 调用发生，返回值进了成品`);
      if (stamp.prevIsNull === true) ok('prev 传的是 null（建站没有上一版）');
      else fail(`prev 不是 null：${JSON.stringify(stamp.prevIsNull)}`);
      // 它看到的 next 就是成品本身（除它自己加的那份）：说明它是最后一步 —— 在 contentPatchesOf 之后、去掉建站记账文件之后。
      const finalFiles = Object.keys(probed.content).filter((k) => k !== PROBE_FILE).sort();
      try {
        assert.deepStrictEqual(stamp.sawFiles, finalFiles);
        ok(`它看到的 next 就是成品（${finalFiles.length} 份）：在 contentPatchesOf 之后、记账文件去掉之后`);
      } catch {
        fail(`它看到的 next ≠ 成品：看到 ${JSON.stringify(stamp.sawFiles)}\n     成品 ${JSON.stringify(finalFiles)}`);
      }
      const bookkeeping = stamp.sawFiles.filter((k) => k === 'build-report.json' || k === '.build' || k.startsWith('.build/'));
      if (bookkeeping.length) fail(`它看到了建站记账文件：${bookkeeping.join(', ')}`);
      // 上一句不是空尺的前提：建出来的 site/ 里真有那份记账文件。
      if (fs.existsSync(path.join(dir, 'probed', 'site', 'build-report.json'))) ok('site/ 里有 build-report.json，它没进 stampSchemaVersions 看到的 next');
      else fail('site/ 里没有 build-report.json —— 「记账文件去掉了」这一格成了空尺');
      if (!stamp.sawFiles.includes('brand.json')) fail(`它看到的 next 里没有 brand.json：${JSON.stringify(stamp.sawFiles)}`);
    }
    // 两次的成品除了探针那份完全一样：探针只多写一份文件，没改别的（不然上面那几格量的就不是真路径）。
    const { [PROBE_FILE]: _drop, ...rest } = probed.content;
    try {
      assert.deepStrictEqual(rest, plain.content);
      ok('除了探针那份，两次成品逐字相同');
    } catch {
      fail('带探针那次的成品除了探针那份还有别的不同');
    }
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }

  console.log(failed ? `\n有失败 ${failed}` : '\n全过');
  process.exit(failed ? 1 : 0);
}

try {
  main();
} catch (e) {
  console.log(`⛔ 跑不起来：${e && e.stack}`);
  process.exit(2);
}
