#!/usr/bin/env node
/**
 * preserves-look.test.js — #1918 preservesLook 尺子里不联网、不开浏览器的那几样（整条路的自检在 `scripts/preserves-look.js` ①，CI 单独一步跑）。
 *
 * 跑法:  node scripts/lib/preserves-look.test.js   （或 `npm run test:scripts`，按文件名发现）
 * 退出码: 0 全过 · 1 有失败 · 2 跑不起来（**不许当成通过**）
 *
 *   ① 基准不对：「前」那份块目录里这个块的 migrations.js 有同一个键 ⟹ 报；没有这份文件 / 只有别的键 ⟹ 不报；跨类型按旧类型找
 *   ② 分类：豁免（带理由，不看 fromBuild）· fromBuild 没写 / 形状不对 ⟹ 条目写错 · false ⟹ 不比 · 其余 ⟹ 要比
 *   ③ 比对：前后一样 ⟹ 空；一个属性不同 ⟹ 点名取样点、属性、前后两个值；结构不同 ⟹ 点名；取样点一边没有 ⟹ 点名
 *   ④ 迁移后那一块：同类型写上 `to` 的版本号；跨类型原样交给迁移函数
 *   ⑤ fromBuild 不是 build-<sha12> ⟹ 当场判拿不到包，不去下载
 *   ⑦ 外壳区（#1918 r3）：「前」那一侧已有同一个键 ⟹ 基准不对；没有 ⟹ 量不了（红、没渲染，话里叫人进豁免表）；
 *      realMigrations 把 manifest 的 `region: true` 带出来，页面块是 false
 *   ⑥ 拿不到包 vs 仪器坏了（PATH 里放一个假 gh）：只有「release not found」且 `gh release list` 读得到 ⟹ 跳过；
 *      401 / 没 token（list 读不到）/ 包解不开 / list 读不到 ⟹ 抛 InstrumentError（CLI rc=2），不许落进跳过
 */
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');

let failed = 0;
let passed = 0;
const check = (cond, m, detail) => {
  if (cond) { passed += 1; console.log(`  ✅ ${m}`); } else { failed += 1; console.log(`  ❌ ${m}${detail === undefined ? '' : `\n       ${detail}`}`); }
};

let pl;
try { pl = require('./preserves-look'); } catch (e) { console.log(`⛔ 跑不起来：${e.message}`); process.exit(2); }

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'preserves-look-test-'));
process.on('exit', () => fs.rmSync(tmp, { recursive: true, force: true }));
const write = (rel, body) => { const f = path.join(tmp, rel); fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, body); };

console.log('① 基准不对');
write('blocks/cta/migrations.js', "module.exports = { '1→2': { preservesLook: true, migrate: (b) => b } };\n");
write('blocks/hero/manifest.json', '{}');
write('blocks/broken/migrations.js', 'module.exports = (;\n');
const dir = path.join(tmp, 'blocks');
check(/已经有 "1→2"/.test(pl.baselineConflict(dir, 'cta', '1→2') || ''), '有同一个键 ⟹ 报基准不对');
check(pl.baselineConflict(dir, 'cta', '2→3') === null, '只有别的键 ⟹ 不报');
check(pl.baselineConflict(dir, 'hero', '1→2') === null, '没有 migrations.js ⟹ 不报');
check(/读不出来/.test(pl.baselineConflict(dir, 'broken', '1→2') || ''), 'migrations.js 读不出来 ⟹ 也报（判不了含不含，不能拿它当「前」）');
check(pl.oldTypeOf('buttons', 'cta→buttons') === 'cta' && pl.oldTypeOf('cta', '1→2') === 'cta', '跨类型迁移的「前」按旧类型找');

console.log('② 分类');
const step = (o) => ({ migrate: (b) => b, preservesLook: true, fromBuild: 'build-0123456789ab', ...o });
const kind = (s, exempt = {}) => pl.classify({ type: 'cta', key: '1→2', step: s }, exempt);
check(kind(step({ fromBuild: undefined }), { 'cta:1→2': '理由 X' }).why === '理由 X', '豁免表里有 ⟹ 豁免、带理由（不看 fromBuild）');
check(kind(step({ fromBuild: undefined })).kind === 'bad-entry', 'fromBuild 没写 ⟹ 条目写错');
check(kind(step({ fromBuild: 'build-91bdef5' })).kind === 'bad-entry', 'fromBuild 不是 build-<sha12> ⟹ 条目写错');
check(kind(step({ preservesLook: false })).kind === 'not-compared', 'preservesLook: false ⟹ 不比');
check(kind(step()).kind === 'compare', '其余 ⟹ 要比');

console.log('③ 比对');
const styles = Object.fromEntries(pl.PROPS.map((p) => [p, `v-${p}`]));
const m = (o = {}) => ({ structure: 'section(h2)', points: { 块根: { ...styles }, 文本: { where: 'h2', ...styles } }, ...o });
check(pl.compare(m(), m()).length === 0, '前后一样 ⟹ 没有差别');
const one = pl.compare(m(), m({ points: { 块根: { ...styles, 'background-color': 'red' }, 文本: { where: 'h2', ...styles } } }));
check(one.length === 1 && one[0].point === '块根' && one[0].prop === 'background-color' && one[0].before === 'v-background-color' && one[0].after === 'red',
  '一个属性不同 ⟹ 点名取样点、属性、前后两个值', JSON.stringify(one));
check(pl.compare(m(), m({ structure: 'section(h2,p)' })).some((d) => d.point === '结构'), '结构不同 ⟹ 点名');
check(pl.compare(m(), m({ points: { 块根: { ...styles }, 文本: null } })).some((d) => d.point === '文本' && d.after === '没有'), '取样点一边没有 ⟹ 点名');
check(pl.PROPS.length === 9, '比 9 个属性（设计文档 §8.5）', String(pl.PROPS.length));

console.log('④ 迁移后那一块');
const fakeA = require('../fixtures/blocks/fake-a/migrations.js')['1→2'];
const v1 = { id: 'x', type: 'fake-a', schemaVersion: 1, data: { headline: 'H' } };
const v2 = pl.migratedBlock(v1, '1→2', fakeA);
check(v2.schemaVersion === 2 && v2.data.title === 'H' && v1.data.headline === 'H', '同类型 ⟹ 写上 to 的版本号、旧那块不被改', JSON.stringify(v2));
const cross = pl.migratedBlock({ id: 'x', type: 'cta', schemaVersion: 1 }, 'cta→buttons', { migrate: (b) => ({ ...b, type: 'buttons' }) });
check(cross.type === 'buttons' && cross.schemaVersion === 1, '跨类型 ⟹ 原样交给迁移函数（版本号不由这里改）');

console.log('⑤ fromBuild 形状不对 ⟹ 不去下载');
const ws = new pl.Workspace({ repo: 'nobody/nothing' });
try {
  check(/不是 build-<sha12>/.test(ws.fetchPackage('main').missing || ''), '「main」⟹ 当场判拿不到包');
} finally { ws.cleanup(); }

console.log('⑥ 拿不到包 vs 仪器坏了');
// 假 gh：`release list` 按 FAKE_LIST（ok / 401），`release download` 按 FAKE_DL（notfound / 401 / junk = 写一份解不开的包）
write('bin/gh', `#!/bin/sh
if [ "$2" = list ]; then
  [ "$FAKE_LIST" = ok ] && { echo '[{"tagName":"build-0123456789ab","createdAt":"2026-10-19T00:00:00Z"}]'; exit 0; }
  echo 'non-200 OK status code: 401 Unauthorized body: "Bad credentials"' >&2; exit 1
fi
case "$FAKE_DL" in
  notfound) echo 'release not found' >&2; exit 1 ;;
  401) echo 'HTTP 401: Bad credentials (https://api.github.com/…)' >&2; exit 1 ;;
  junk) while [ $# -gt 0 ]; do [ "$1" = -D ] && echo junk > "$2/template.tar.gz"; shift; done; exit 0 ;;
esac
`);
fs.chmodSync(path.join(tmp, 'bin/gh'), 0o755);
const fake = (list, dl, fn) => {
  const w = new pl.Workspace({ repo: 'x/y', env: { ...process.env, PATH: `${path.join(tmp, 'bin')}:${process.env.PATH}`, FAKE_LIST: list, FAKE_DL: dl } });
  try { return { value: fn(w) }; } catch (e) { return { error: e }; } finally { w.cleanup(); }
};
const broken = (r) => r.error instanceof pl.InstrumentError;
let r = fake('ok', 'notfound', (w) => w.fetchPackage('build-0123456789ab'));
check(!r.error && /release not found/.test(r.value.missing || ''), 'release not found + list 读得到 ⟹ 跳过', String(r.error || JSON.stringify(r.value)));
r = fake('401', 'notfound', (w) => w.fetchPackage('build-0123456789ab'));
check(broken(r), 'release not found 但 list 读不到（没 token 时私有库就是这样）⟹ 仪器坏了，不是跳过', String(r.error || JSON.stringify(r.value)));
r = fake('ok', '401', (w) => w.fetchPackage('build-0123456789ab'));
check(broken(r) && /401/.test(r.error.message), '下载 401 ⟹ 仪器坏了，不是跳过', String(r.error || JSON.stringify(r.value)));
r = fake('ok', 'junk', (w) => w.fetchPackage('build-0123456789ab'));
check(broken(r) && /解不开/.test(r.error.message), '包解不开 ⟹ 仪器坏了，不是跳过', String(r.error || JSON.stringify(r.value)));
r = fake('401', 'notfound', (w) => w.latestBlocksDirPackage());
check(broken(r), '取最新包时 list 读不到 ⟹ 仪器坏了，不是跳过', String(r.error || JSON.stringify(r.value)));

console.log('⑦ 外壳区');
write('region-before/header/migrations.js', "module.exports = { '1→2': { preservesLook: true, migrate: (b) => b } };\n");
write('region-before/footer/manifest.json', '{}');
{
  const rb = path.join(tmp, 'region-before');
  const hit = pl.regionVerdict(rb, 'header', '1→2');
  check(hit.reason === 'baseline' && hit.verdict === 'red' && hit.rendered === false, '「前」那一侧已有同一个键 ⟹ 基准不对（先于「量不了」）', JSON.stringify(hit));
  const miss = pl.regionVerdict(rb, 'footer', '1→2');
  check(miss.reason === 'unmeasurable' && miss.verdict === 'red' && miss.rendered === false && /豁免表/.test(miss.why), '没有 ⟹ 量不了：红、没渲染、叫人进豁免表', JSON.stringify(miss));
  write('region-now/header/manifest.json', JSON.stringify({ type: 'header', schemaVersion: 2, renders: [1, 2], region: true }));
  write('region-now/header/migrations.js', "module.exports = { '1→2': { preservesLook: true, migrate: (b) => b } };\n");
  write('region-now/hero/manifest.json', JSON.stringify({ type: 'hero', schemaVersion: 2, renders: [1, 2] }));
  write('region-now/hero/migrations.js', "module.exports = { '1→2': { preservesLook: true, migrate: (b) => b } };\n");
  const got = Object.fromEntries(pl.realMigrations(path.join(tmp, 'region-now')).map((m) => [m.type, m.region]));
  check(got.header === true && got.hero === false, 'realMigrations 带出 region：header true · hero false', JSON.stringify(got));
}

console.log(`\n${passed} 过 · ${failed} 失败`);
process.exit(failed ? 1 : 0);
