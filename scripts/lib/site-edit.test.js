#!/usr/bin/env node
/**
 * site-edit.test.js — `site.js validate`（#1830 T3b：AI 改站的产出交给 manager 落库之前过的那一道，`lib/site-edit.js` §validate）。
 *
 * 跑法:  node scripts/lib/site-edit.test.js   （或 `npm run test:scripts`，它按文件名发现）
 * 退出码: 0 全过 · 1 有失败 · 2 跑不起来（**不许当成通过**）
 *
 * 钉五件事，每件都在真进程上（`node [--require 探针] scripts/site.js validate --prev <文件> --next <文件> [--scope <JSON>]`）：
 *   ① `stampSchemaVersions(prev, next)` 被调过、prev 是这一轮之前那份、返回值进了产出（票 AC1 的最后一句；PM 10-18 裁定：
 *      在模板侧测 —— Go 那套跑的是假 site.js，按构造碰不到它）。探针形状照 `site-create.test.js`：在 require 缓存里换掉
 *      `stamp-schema-versions.js`，让它往返回值里多塞一份 `stamp-probe.json`。阳性对照：不带探针，产出里没有那份。
 *   ② `contentPatchesOf` 并进了产出：产出里删掉一个页面 ⟹ 返回的 navigation.json 菜单里没有它（票 AC「套了 contentPatchesOf」；
 *      同 ① 的理由放在这一侧）。对照：prev 的菜单里本来有它。
 *   ③ brand.json 里 AI 写的 geo 剥出来：产出不带 geo，返回值的 `geo` 带坐标 + 地址。
 *   ④ 构建不出来的内容被拒（站容器时代 sync-config 那道闸）：services.json 写成对象 ⟹ ok:false、code=refused、那句「not saved」。
 *   （`--scope` 带 region 只放行那一个键，在 `scripts/edit-site-region-scope.test.js` —— 票点名的那一份。）
 */
'use strict';

const cp = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const SCRIPTS = path.resolve(__dirname, '..');
const STAMP = path.join(__dirname, 'stamp-schema-versions.js');
const PROBE_FILE = 'stamp-probe.json';

const PAYLOAD = {
  siteId: 'site-t1830edit', siteUrl: 'https://site-t1830edit.ai1stsite.dev', companyName: 'Edit Probe Co',
  industry: 'Demo', services: ['Demo Service'], language: 'en', skipAI: true, skipGeocode: true,
};

let failed = 0;
const fail = (m) => { failed += 1; console.log(`  ❌ ${m}`); };
const ok = (m) => console.log(`  ✅ ${m}`);
const die = (m) => { console.log(`  💥 跑不起来：${m}`); process.exit(2); };

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
    return { ...next, ${JSON.stringify(PROBE_FILE)}: { prevBrand: prev && prev['brand.json'] ? JSON.stringify(prev['brand.json']) : null, sawFiles: Object.keys(next).sort() } };
  },
};
require.cache[p] = m;
`);
  return file;
}

/** 一份真的站（skipAI 建站，同 site-create.test.js）。 */
function makeContent(dir) {
  const out = path.join(dir, 'create');
  const env = { ...process.env };
  delete env.ANTHROPIC_API_KEY;
  const r = cp.spawnSync(process.execPath, [path.join(SCRIPTS, 'site.js'), 'create', '--out-dir', out], {
    input: JSON.stringify(PAYLOAD), cwd: path.resolve(SCRIPTS, '..'), env, encoding: 'utf8', maxBuffer: 64 << 20, timeout: 120000,
  });
  const created = (r.stdout || '').split('\n').map((l) => { try { return JSON.parse(l); } catch { return null; } }).find((e) => e && e.event === 'created');
  if (r.status !== 0 || !created) die(`site.js create rc=${r.status}\n${(r.stderr || '').slice(-600)}`);
  return JSON.parse(fs.readFileSync(created.result, 'utf8')).content;
}

let n = 0;
function validate(dir, prev, next, { scope, preload } = {}) {
  n += 1;
  const pf = path.join(dir, `prev-${n}.json`);
  const nf = path.join(dir, `next-${n}.json`);
  fs.writeFileSync(pf, JSON.stringify(prev));
  fs.writeFileSync(nf, JSON.stringify(next));
  const args = [...(preload ? ['--require', preload] : []), path.join(SCRIPTS, 'site.js'), 'validate', '--prev', pf, '--next', nf,
    ...(scope ? ['--scope', JSON.stringify(scope)] : [])];
  const r = cp.spawnSync(process.execPath, args, { cwd: path.resolve(SCRIPTS, '..'), encoding: 'utf8', maxBuffer: 64 << 20, timeout: 120000 });
  const line = (r.stdout || '').split('\n').filter((l) => l.trim().startsWith('{')).pop();
  let out = null;
  try { out = JSON.parse(line); } catch { out = null; }
  if (!out) die(`site.js validate 没有结果行 rc=${r.status}\nstdout: ${(r.stdout || '').slice(-400)}\nstderr: ${(r.stderr || '').slice(-600)}`);
  return { rc: r.status, out };
}

const clone = (v) => JSON.parse(JSON.stringify(v));
const asObj = (v) => (typeof v === 'string' ? JSON.parse(v) : v);
const menuHrefs = (nav) => JSON.stringify((asObj(nav).header || {}).links || []);

function main() {
  console.log('══ #1830 site.js validate ══');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'site-edit-test-'));
  try {
    const prev = makeContent(dir);
    const pages = Object.keys(prev).filter((k) => /^en\/pages\/[^/]+\.json$/.test(k) && k !== 'en/pages/home.json');
    if (!prev['brand.json'] || !prev['en/navigation.json'] || !pages.length) die(`夹具不对：${Object.keys(prev).join(', ')}`);

    // ── ① stampSchemaVersions ──
    console.log('\n① stampSchemaVersions(prev, next) 在 validate 这条路上被调过');
    const next1 = clone(prev);
    const brand1 = asObj(next1['brand.json']);
    next1['brand.json'] = { ...brand1, tagline: 'Probe tagline 1830' };
    const plain = validate(dir, prev, next1);
    if (!plain.out.ok) die(`阳性对照没过 validate：${plain.out.message}`);
    if (PROBE_FILE in plain.out.content) fail(`不带探针的产出里也有 ${PROBE_FILE} —— 判据分不开`);
    else ok(`阳性对照：不带探针 ⟹ 产出里没有 ${PROBE_FILE}（files=${JSON.stringify(plain.out.files)}）`);
    const probed = validate(dir, prev, next1, { preload: writeProbe(dir) });
    const stamp = probed.out.ok && probed.out.content[PROBE_FILE];
    if (!stamp) {
      fail(`产出里没有 ${PROBE_FILE} ⟹ stampSchemaVersions 没被调，或者调了但没用它的返回值（${JSON.stringify(probed.out).slice(0, 200)}）`);
    } else {
      ok(`产出里有 ${PROBE_FILE} ⟹ 调用发生、返回值进了产出`);
      if (stamp.prevBrand === JSON.stringify(prev['brand.json'])) ok('prev 传的是这一轮之前那份（brand.json 逐字相同）');
      else fail(`prev 不是这一轮之前那份：${String(stamp.prevBrand).slice(0, 120)}`);
      const finalFiles = Object.keys(probed.out.content).filter((k) => k !== PROBE_FILE).sort();
      if (JSON.stringify(stamp.sawFiles) === JSON.stringify(finalFiles)) ok('它看到的 next 就是产出本身 ⟹ 它是最后一步（contentPatchesOf 之后）');
      else fail(`它看到的文件跟产出不同：${JSON.stringify(stamp.sawFiles)} vs ${JSON.stringify(finalFiles)}`);
    }

    // ── ② contentPatchesOf：删掉一个页面 ⟹ 菜单里没有它 ──
    console.log('\n② contentPatchesOf 并进了产出：删掉一个页面 ⟹ navigation.json 菜单里没有它');
    const victim = pages.find((k) => menuHrefs(prev['en/navigation.json']).includes(`/${path.basename(k, '.json')}`));
    if (!victim) die(`prev 的菜单里找不到任何一个非首页页面：${menuHrefs(prev['en/navigation.json'])}`);
    const slug = path.basename(victim, '.json');
    ok(`对照：prev 的菜单里有 /${slug}`);
    const next2 = clone(prev);
    delete next2[victim];
    const r2 = validate(dir, prev, next2);
    if (!r2.out.ok) fail(`删页面被拒了：${r2.out.message}`);
    else {
      const hrefs = menuHrefs(r2.out.content['en/navigation.json']);
      if (!hrefs.includes(`/${slug}"`) && !hrefs.includes(`/${slug}/`)) ok(`产出的菜单里没有 /${slug} 了（${hrefs.slice(0, 160)}）`);
      else fail(`产出的菜单里还有 /${slug}：${hrefs}`);
      if (!(victim in r2.out.content) && r2.out.files.includes(victim) && r2.out.files.includes('en/navigation.json')) ok(`files 点名了 ${victim} 和 en/navigation.json`);
      else fail(`files 不对：${JSON.stringify(r2.out.files)}`);
    }
    const next2b = clone(prev);
    delete next2b['en/services.json'];
    const r2b = validate(dir, prev, next2b);
    if (!r2b.out.ok && /cannot delete this file/.test(r2b.out.message)) ok('删的不是页面（services.json）⟹ 拒');
    else fail(`删 services.json 没被拒：${JSON.stringify(r2b.out).slice(0, 200)}`);

    // ── ③ geo 剥出来 ──
    console.log('\n③ brand.json 里的 geo 剥到返回值的 geo');
    const next3 = clone(prev);
    const brand3 = asObj(next3['brand.json']);
    brand3.locations = [{ ...(brand3.locations || [{}])[0], address: '12 Probe Street, Toronto, ON', geo: { lat: 43.5, lng: -79.5 } }, ...(brand3.locations || []).slice(1)];
    next3['brand.json'] = brand3;
    const r3 = validate(dir, prev, next3);
    const loc3 = r3.out.ok ? asObj(r3.out.content['brand.json']).locations[0] : null;
    // #1976 —— 返回值的 geo 是一组（每个地点一项，按地址对回去）。
    const g3 = Array.isArray(r3.out.geo) && r3.out.geo.length === 1 ? r3.out.geo[0] : null;
    if (r3.out.ok && loc3 && !('geo' in loc3) && g3 && g3.lat === 43.5 && g3.lng === -79.5 && g3.address === '12 Probe Street, Toronto, ON') {
      ok(`产出的 brand.json 不带 geo，返回值 geo=${JSON.stringify(r3.out.geo)}`);
    } else fail(`geo 没剥对：${JSON.stringify({ ok: r3.out.ok, loc3, geo: r3.out.geo, msg: r3.out.message })}`);

    // ── ④ 构建不出来 ⟹ 拒 ──
    console.log('\n④ 构建不出来的内容被拒');
    const next4 = clone(prev);
    next4['en/services.json'] = { oops: 'an object, not an array' };
    const r4 = validate(dir, prev, next4);
    if (!r4.out.ok && r4.out.code === 'refused' && /This change was not saved/.test(r4.out.message) && r4.rc === 3) ok(`拒了（rc=3）：${r4.out.message.split('\n')[0].slice(0, 90)}…`);
    else fail(`没拒：${JSON.stringify(r4.out).slice(0, 240)} rc=${r4.rc}`);

  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
  console.log(`\n══ ${failed ? `失败 ${failed}` : '全过'} ══`);
  process.exit(failed ? 1 : 0);
}

main();
