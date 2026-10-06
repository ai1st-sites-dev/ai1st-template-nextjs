#!/usr/bin/env node
/**
 * ai-json.test.js — AI 回包 JSON 先严格解析、失败再修一次（FastBuild T2 #1596 第 4 条先行落地）。
 *
 * 跑法:  node scripts/lib/ai-json.test.js   （或 `npm run test:scripts`）
 * 退出码: 0 全过 · 1 有失败 · 2 跑不起来
 *
 * ① 合法 JSON 原样过，repaired=false
 * ② 2026-10-06 那种病：中文文案里没转义的 `"` → 修复后解析成功，repaired=true，值保住引号里的字
 * ③ 尾逗号 / 代码围栏 / 行注释 各一例 → 修复后成功
 * ④ 修不好的（JSON 前面有散文，jsonrepair 自己也抛）→ 抛 SyntaxError，带 `context`（出错位置前后文）
 * ⑤ saveRawResponse 落盘到 AI_RAW_DIR，文件名是 label-attempt，label 里的奇怪字符被换掉
 */

'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');

process.env.AI_RAW_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-raw-test-'));
const { parseAiJson, saveRawResponse, RAW_DIR } = require('./ai-json');

let pass = 0, fail = 0;
function check(name, cond, detail) {
  if (cond) { pass += 1; console.log(`  ✓ ${name}`); } else { fail += 1; console.log(`  ✗ ${name}${detail ? ` —— ${detail}` : ''}`); }
}

// ①
{
  const r = parseAiJson('{"a": 1, "b": "x"}');
  check('① 合法 JSON 原样过', r.parsed.a === 1 && r.parsed.b === 'x' && r.repaired === false);
}
// ②
{
  const bad = '{\n  "siteTitle": "Silky Hair Salon",\n  "body": "我们提供"专业"的服务，就在 T&T 超市旁边",\n  "n": 2\n}';
  let strict = null; try { JSON.parse(bad); } catch (e) { strict = e; }
  check('② 严格解析确实失败（对照）', !!strict && /Expected/.test(strict.message), strict && strict.message);
  const r = parseAiJson(bad);
  check('② 修复后解析成功、repaired=true', r.repaired === true && r.parsed.n === 2);
  check('② 引号里的字保住', typeof r.parsed.body === 'string' && r.parsed.body.includes('专业'), JSON.stringify(r.parsed.body));
}
// ③
{
  const r1 = parseAiJson('{"a": [1,2,],}');
  check('③ 尾逗号', r1.repaired === true && r1.parsed.a.length === 2);
  const r2 = parseAiJson('```json\n{"a": 1}\n```');
  check('③ 代码围栏（stripFences 就够，repaired=false）', r2.parsed.a === 1 && r2.repaired === false);
  const r3 = parseAiJson('{"a": 1 // comment\n}');
  check('③ 行注释', r3.repaired === true && r3.parsed.a === 1);
}
// ④
{
  let err = null;
  // jsonrepair 会把半截 JSON 补全（`{"a": [1,2` → `{"a": [1,2]}`），所以「修不好」要用它真会抛的形状：JSON 前面有散文。
  try { parseAiJson('Here is the site: not json at all {"a": 1}'); } catch (e) { err = e; }
  check('④ 修不好的抛 SyntaxError', err instanceof SyntaxError, err && err.message);
  check('④ 带 context', !!err && typeof err.context === 'string' && err.context.length > 0);
}
// ⑤
{
  const f = saveRawResponse('Call 1 base site', 2, 'RAW TEXT');
  check('⑤ 落盘到 AI_RAW_DIR', !!f && f.startsWith(RAW_DIR) && fs.readFileSync(f, 'utf8') === 'RAW TEXT', String(f));
  check('⑤ 文件名 label-attempt、奇怪字符换掉', !!f && path.basename(f) === 'Call_1_base_site-2.txt', f && path.basename(f));
}

console.log(`\n${pass} 过 · ${fail} 败`);
process.exit(fail ? 1 : 0);
