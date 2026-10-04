#!/usr/bin/env node
/**
 * next-config-export-dir.test.js — #1547：`next.config.js` 那一行 `distDir` 是承重的。
 *
 *   node scripts/next-config-export-dir.test.js     （`npm run test:scripts` 自动发现）
 *   退出码: 0 全过 · 1 有失败 · 2 跑不起来（不许当成通过）
 *
 * 上线发布那次构建带 `NEXT_EXPORT_DIR=/tmp/out-live-<id>`，导出必须写到那里，预览那份 `out/` 一个字节不碰
 * （worker/main.go §deployBuildScript）。把那一行删掉，worker / manager 的测试都还能绿（它们不跑 Next），
 * 而真发布会把导出写回 `out/` —— 所以这一格直接读真的 `next.config.js`，再用 **Next 自己的判定**
 * （`next/dist/export/utils` 的 `hasCustomExportOutput`，`next/dist/build/index.js` 拿它决定导出目录）
 * 算出导出落在哪。每一臂在独立子进程里 require，免得 env 和 require 缓存串臂。
 */
'use strict';

const path = require('path');
const { spawnSync } = require('child_process');

let pass = 0, fail = 0;
const ok = (m) => { pass++; console.log(`  ✅ ${m}`); };
const bad = (m) => { fail++; console.log(`  ❌ ${m}`); };
const die = (m) => { console.error(`🔴 跑不起来: ${m}`); process.exit(2); };

const dir = path.resolve(__dirname, '..');
let hasCustomExportOutput;
try { ({ hasCustomExportOutput } = require(require.resolve('next/dist/export/utils', { paths: [dir] }))); } catch (e) { die(`读不到 Next 的 hasCustomExportOutput：${e.message}`); }
if (typeof hasCustomExportOutput !== 'function') die('next/dist/export/utils 没有 hasCustomExportOutput —— Next 改了这条机制，先看 build/index.js 再改这格');

/** 按给定 env 读一次 next.config.js，返回 { output, distDir }。 */
function loadConfig(env) {
  const r = spawnSync(process.execPath, ['-e',
    'const c=require(process.argv[1]);process.stdout.write(JSON.stringify({output:c.output??null,distDir:c.distDir??null}))',
    path.join(dir, 'next.config.js')], { env: { PATH: process.env.PATH, ...env }, encoding: 'utf8' });
  if (r.status !== 0) die(`require next.config.js 失败：${r.stderr}`);
  const c = JSON.parse(r.stdout);
  if (c.distDir === null) delete c.distDir;
  return c;
}

/** Next 的那段（build/index.js）：导出写到哪个目录；不是导出构建返回 null。 */
function exportDirOf(config) {
  if (config.output !== 'export') return null;
  const cfg = { ...config, distDir: config.distDir ?? '.next' };
  return path.join(dir, hasCustomExportOutput(cfg) ? cfg.distDir : 'out');
}

const live = '/tmp/out-live-abc123def456';
const withDir = exportDirOf(loadConfig({ NODE_ENV: 'production', NEXT_EXPORT_DIR: live }));
withDir === live ? ok(`给了 NEXT_EXPORT_DIR：导出写到 ${live}`)
  : bad(`给了 NEXT_EXPORT_DIR=${live}，导出却写到 ${withDir} —— 上线构建会覆盖预览那份 out/（新站发布）`);

const plain = loadConfig({ NODE_ENV: 'production' });
const plainDir = exportDirOf(plain);
plainDir === path.join(dir, 'out') ? ok('不给：导出仍写到 out/（跟改之前一样）')
  : bad(`不给 NEXT_EXPORT_DIR，导出却写到 ${plainDir}，期望 ${path.join(dir, 'out')}`);
(plain.distDir === undefined || plain.distDir === '.next') ? ok('不给：distDir 是 Next 的默认 .next，编译产物位置不变')
  : bad(`不给 NEXT_EXPORT_DIR，distDir 却是 ${JSON.stringify(plain.distDir)}`);

const devCfg = loadConfig({ NODE_ENV: 'development', NEXT_EXPORT_DIR: live });
devCfg.output === null ? ok('next dev 不是导出构建（这条 env 对开发服务没影响）')
  : bad(`NODE_ENV=development 下 output=${JSON.stringify(devCfg.output)}`);

console.log(`\n${pass} 过 · ${fail} 败`);
process.exit(fail ? 1 : 0);
