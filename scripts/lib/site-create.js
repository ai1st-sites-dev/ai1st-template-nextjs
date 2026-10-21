'use strict';
// #1829 (SiteAsData T3a) —— `site.js create` 的实现（设计文档 §9.3）。manager 的执行器 `kind=create` 时 spawn 它：
//
//   node scripts/site.js create --out-dir <目录>       标准输入：建站 payload（跟 create-site.js 读的是同一份）
//
// 做三件事：
//   ① 起 `create-site.js`（子进程，payload 加上 `outDir`），它的标准输出逐行原样转出来 —— progress / cost / phase-saved …
//      manager 读一行 Publish 一条（SSE 那一半不动）。
//   ② 它成功退出之后，把 `<outDir>/site/` 读回成「库里一行 JSON」的形状（`site-editor.js` §readTree），去掉建站自己的
//      记账文件（`.build/` 续跑存档、`build-report.json`），在 Node 这一侧套一遍 `contentPatchesOf`（菜单同步 +
//      custom.css；它是 JS，manager 调不了），再过 `stampSchemaVersions(null, content)`（#1838：每块盖当前号）和
//      `content-blocks.js` §schemaVersionProblems（#1987：号不是整数 ⟹ 拒收、点名），写进 `<outDir>/result.json`。
//   ③ 发 `build-report`（建站报告，耗时改成整次 `site.js create` 的墙钟秒数 —— 今天 entrypoint 的 finish-build-report.js
//      做的那一步）和最后一行 `{"event":"created","result":"<outDir>/result.json"}`。
//
// 退出码：create-site.js 失败 ⟹ 照它的退出码（它的 `error` 事件已经转出去了）；收尾那一步失败 ⟹ 发 `error` 事件 + 1。
// 照片（`<outDir>/photos/`）、logo（`<outDir>/logo.png`）原样留在目录里：传图库、改引用归 manager（`putUploadObject`）。
const fs = require('fs');
const path = require('path');
const cp = require('child_process');

const SCRIPTS = path.resolve(__dirname, '..');

// 建站自己的记账文件，不进 content：续跑存档（Resume 时 manager 从 version 0 那份阶段内容写回来，建完就没用了）和建站报告
// （走 `build-report` 事件进 site_build_reports）。
function isBuildBookkeeping(rel) {
  return rel === 'build-report.json' || rel === '.build' || rel.startsWith('.build/');
}

/** `<siteDir>` → 成品 content（键排序）。 */
function finishContent(siteDir) {
  const { readTree } = require('./site-editor');
  const { contentPatchesOf } = require('./derive-core');
  const { stampSchemaVersions } = require('./stamp-schema-versions');
  const tree = readTree(siteDir);
  let content = {};
  for (const [rel, v] of Object.entries(tree)) if (!isBuildBookkeeping(rel)) content[rel] = v;
  // 同 site-editor.js §save 那一段：补丁直接是对象 / 字符串（#1838），null = 删掉那一份。建站不迁（全是当前号），
  // `touchedFiles` 不传；版本号由 stampSchemaVersions 一次盖齐（没有之前 ⟹ 每块都是新块）。
  for (const [rel, value] of Object.entries(contentPatchesOf(content))) {
    if (value === null) delete content[rel];
    else content[rel] = value;
  }
  content = stampSchemaVersions(null, content);
  // #1987 —— 跟 AI 改站（site-edit.js §validate）同一个判据、同一种处置：块的 schemaVersion 只收整数。盖号对已带号的块
  //    不动手，AI 交回来的 "2" 会原样留着，而渲染入口画不出它 ⟹ 这个站以后发布不出去。在这里拒收是最便宜的失败点。
  const badVersions = require('./content-blocks').schemaVersionProblems(content, Object.keys(content));
  if (badVersions.length) throw new Error(badVersions.join('; '));
  return Object.fromEntries(Object.keys(content).sort().map((k) => [k, content[k]]));
}

function emit(event, data = {}) {
  process.stdout.write(`${JSON.stringify({ event, ...data })}\n`);
}

/** 跑完返回退出码。`stdinText` = 建站 payload 原文。 */
async function create({ outDir, stdinText }) {
  const t0 = Date.now();
  let payload;
  try {
    payload = JSON.parse(stdinText);
  } catch (e) {
    emit('error', { message: `Failed to read input: ${e.message}` });
    return 1;
  }
  fs.mkdirSync(outDir, { recursive: true });
  payload.outDir = outDir;

  const child = cp.spawn(process.execPath, [path.join(SCRIPTS, 'create-site.js')], {
    cwd: path.resolve(SCRIPTS, '..'), env: process.env, stdio: ['pipe', 'pipe', 'inherit'],
  });
  child.stdin.end(JSON.stringify(payload));
  let rest = '';
  child.stdout.on('data', (chunk) => {
    rest += chunk;
    const lines = rest.split('\n');
    rest = lines.pop();
    for (const line of lines) if (line.trim()) process.stdout.write(`${line}\n`);
  });
  const code = await new Promise((resolve) => child.on('close', (c, sig) => resolve(c === null ? (sig ? 1 : 0) : c)));
  if (rest.trim()) process.stdout.write(`${rest}\n`);
  if (code !== 0) return code;

  const siteDir = path.join(outDir, 'site');
  try {
    const content = finishContent(siteDir);
    const result = path.join(outDir, 'result.json');
    fs.writeFileSync(result, JSON.stringify({ content }));
    const br = require('./build-report');
    const report = br.readReport(siteDir);
    if (report) {
      report.durationSec = Math.max(0, Math.round((Date.now() - t0) / 1000));
      emit('build-report', { report });
    }
    emit('created', { result, files: Object.keys(content).length });
    return 0;
  } catch (e) {
    process.stderr.write(`${e && e.stack ? e.stack : e}\n`);
    emit('error', { message: `Finishing the website failed: ${e && e.message ? e.message : e}` });
    return 1;
  }
}

module.exports = { create, finishContent, isBuildBookkeeping };
