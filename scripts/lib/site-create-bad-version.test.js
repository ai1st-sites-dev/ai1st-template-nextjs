#!/usr/bin/env node
/**
 * site-create-bad-version.test.js — #1987：建站那条路跟 AI 改站（site-edit.js §validate）同一个判据、同一种处置 ——
 * 成品里块的 schemaVersion 不是整数 ⟹ `site.js create` 拒收（`error` 事件点名文件和块、退出码非 0、不发 `created`）；
 * 是整数 ⟹ 照旧建成、存的就是它。
 *
 * 跑法:  node scripts/lib/site-create-bad-version.test.js   （或 `npm run test:scripts`，它按文件名发现）
 * 退出码: 0 全过 · 1 有失败 · 2 跑不起来（**不许当成通过**）
 *
 * 🔴 真进程：`node --require <探针> scripts/site.js create --out-dir <临时目录>`，skipAI payload（同 site-create.test.js）。
 *    探针在 require 缓存里把 `stamp-schema-versions.js` 包一层：先往 next 里那个块写上要测的号（= AI 交回来的块自己带着它），
 *    再交给**真函数**盖号 —— 盖号对已带号的块不动手，所以坏号原样进到它后面那一步，就是 AI 真交回坏号时的形状。
 * 🔴 阳性对照：同一个探针写整数 2 ⟹ 建成、成品里那个块是 2（不然「被拒」可能只是探针把站弄坏了）。
 */
'use strict';

const cp = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const SCRIPTS = path.resolve(__dirname, '..');
const STAMP = path.join(__dirname, 'stamp-schema-versions.js');
const PAYLOAD = {
  siteId: 'site-t1987bad', siteUrl: 'https://site-t1987bad.ai1stsite.dev', companyName: 'Bad Version Co',
  industry: 'Demo', services: ['Demo Service'], language: 'en', skipAI: true, skipGeocode: true,
};

let failed = 0;
const fail = (m) => { failed += 1; console.log(`  ❌ ${m}`); };
const ok = (m) => console.log(`  ✅ ${m}`);
const die = (m) => { console.log(`⛔ 跑不起来：${m}`); process.exit(2); };

// T1987_INJECT = {"region":"page"|"header","value":<号>}。page = 首页第一块；header = navigation.json 的 header。
function writeProbe(dir) {
  const file = path.join(dir, 'inject-probe.cjs');
  fs.writeFileSync(file, `'use strict';
const real = require(${JSON.stringify(STAMP)});
const inject = JSON.parse(process.env.T1987_INJECT);
const parsed = (v) => (typeof v === 'string' ? JSON.parse(v) : v);
require.cache[${JSON.stringify(STAMP)}].exports = {
  stampSchemaVersions(prev, next) {
    const out = { ...next };
    let where = null;
    for (const k of Object.keys(out).sort()) {
      if (where) break;
      if (inject.region === 'page' && /^en\\/pages\\/home\\.json$/.test(k)) {
        const page = parsed(out[k]);
        const b = page.blocks[0];
        out[k] = { ...page, blocks: [{ ...b, schemaVersion: inject.value }, ...page.blocks.slice(1)] };
        where = k + '#' + b.id;
      }
      if (inject.region === 'header' && /(^|\\/)navigation\\.json$/.test(k)) {
        const nav = parsed(out[k]);
        if (nav && nav.header) {
          out[k] = { ...nav, header: { ...nav.header, schemaVersion: inject.value } };
          where = k + '#header';
        }
      }
    }
    if (!where) throw new Error('probe: nothing to put ' + JSON.stringify(inject.value) + ' on (' + inject.region + ')');
    process.stderr.write('[t1987-probe] wrote ' + JSON.stringify(inject.value) + ' at ' + where + '\\n');
    return real.stampSchemaVersions(prev, out);
  },
};
`);
  return file;
}

function runCreate(dir, name, probe, inject) {
  const out = path.join(dir, name);
  const env = { ...process.env, T1987_INJECT: JSON.stringify(inject) };
  delete env.ANTHROPIC_API_KEY;
  const r = cp.spawnSync(process.execPath, ['--require', probe, path.join(SCRIPTS, 'site.js'), 'create', '--out-dir', out], {
    input: JSON.stringify(PAYLOAD), cwd: path.resolve(SCRIPTS, '..'), env, encoding: 'utf8', maxBuffer: 64 << 20, timeout: 120000,
  });
  const events = (r.stdout || '').split('\n').filter((l) => l.trim().startsWith('{')).map((l) => {
    try { return JSON.parse(l); } catch { return null; }
  }).filter(Boolean);
  const where = ((r.stderr || '').match(/\[t1987-probe\] wrote .* at (\S+)/) || [])[1];
  if (!where) die(`${name}: 探针没写上号（rc=${r.status}）\nstderr tail: ${(r.stderr || '').slice(-800)}`);
  const created = events.find((e) => e.event === 'created');
  const content = created && fs.existsSync(created.result) ? JSON.parse(fs.readFileSync(created.result, 'utf8')).content : null;
  return { code: r.status, events, created, content, where };
}

function blockAt(content, where) {
  const [key, id] = where.split('#');
  const doc = typeof content[key] === 'string' ? JSON.parse(content[key]) : content[key];
  return id === 'header' ? doc.header : doc.blocks.find((b) => b.id === id);
}

function main() {
  console.log('══ #1987 site.js create：块的 schemaVersion 不是整数 ⟹ 拒收、点名 ══');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'site-create-bad-version-'));
  try {
    const probe = writeProbe(dir);
    for (const region of ['page', 'header']) {
      for (const [name, value] of [['"2"', '2'], ['2.5', 2.5], ['null', null]]) {
        const r = runCreate(dir, `${region}-${name.replace(/\W/g, '_')}`, probe, { region, value });
        const err = r.events.find((e) => e.event === 'error');
        const type = region === 'header' ? 'header' : null;
        const said = err && String(err.message);
        const want = `schemaVersion ${JSON.stringify(value)} of ${type || ''}`;
        if (r.code !== 0 && !r.created && said && said.includes(`at ${r.where} is not a whole number`) && said.includes(want)) {
          ok(`${region} ${name} ⟹ 建站被拒（rc=${r.code}），点名 ${r.where}`);
        } else {
          fail(`${region} ${name} ⟹ rc=${r.code} created=${!!r.created} error=${JSON.stringify(said)} —— 要拒收并点名 ${r.where}`);
        }
      }
      // 阳性对照：整数照旧建成，存的就是它。
      const r = runCreate(dir, `${region}-int`, probe, { region, value: 2 });
      const b = r.content && blockAt(r.content, r.where);
      if (r.code === 0 && b && b.schemaVersion === 2) ok(`${region} 2 ⟹ 照旧建成，${r.where} 存的是 2`);
      else fail(`${region} 2 ⟹ rc=${r.code} block=${JSON.stringify(b)} —— 要建成、存 2`);
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
  die(e && e.stack ? e.stack : e);
}
