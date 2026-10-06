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
 * ⑥ validateAiJson（#1618 AC1）三类各一例：合法 / jsonrepair 修得好（事故那种未转义引号）/ jsonrepair 也修不好
 *    （模型中途道歉又重发一份 —— PM 在 #1618 拿 jsonrepair 3.15.0 量出来的那个形状），ok / repaired / position / context 都对
 */

'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');

process.env.AI_RAW_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-raw-test-'));
const { validateAiJson, parseAiJson, saveRawResponse, RAW_DIR } = require('./ai-json');
const { jsonrepair } = require('jsonrepair');

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
// ⑥
{
  const a = validateAiJson('{"a": 1, "b": "x"}');
  check('⑥ 合法：ok、repaired=false、没有 error/position', a.ok === true && a.repaired === false && a.parsed.b === 'x' && !('error' in a) && !('position' in a), JSON.stringify(a));

  const b = validateAiJson('{"desc":"我们提供"专业"的服务","n":1}');
  check('⑥ jsonrepair 修得好：ok、repaired=true、引号里的字保住', b.ok === true && b.repaired === true && b.parsed.n === 1 && b.parsed.desc === '我们提供"专业"的服务', JSON.stringify(b));

  const bad = '{"a":1}\n\n抱歉，上面漏了一个字段，完整的是：\n{"a":1,"b":2}';
  let repairErr = null; try { jsonrepair(bad); } catch (e) { repairErr = e; }
  check('⑥ 第三类的对照：jsonrepair 自己也抛（证明它确实修不好）', !!repairErr, repairErr ? '' : '它修好了 ⟹ 这个例子不算第三类');
  const c = validateAiJson(bad);
  check('⑥ jsonrepair 修不好：ok=false、没有 parsed', c.ok === false && !('parsed' in c), JSON.stringify(c));
  check('⑥ error 是严格解析那一步的报错原文', c.error === (() => { try { JSON.parse(bad); } catch (e) { return e.message; } })(), c.error);
  check('⑥ position = 9（「抱」那个字）', c.position === 9 && bad[c.position] === '抱', String(c.position));
  check('⑥ context = 出错位置前后 200 字符（短串 ⟹ 整串）', c.context === bad, JSON.stringify(c.context));

  // 长串：context 只取前后 200
  const long = `{"t":"${'x'.repeat(500)}"}  多出来的字 ${'y'.repeat(500)}`;
  const d = validateAiJson(long);
  check('⑥ 长串：context 是 [position-200, position+200)', d.ok === false && d.context === long.slice(d.position - 200, d.position + 200) && d.context.length === 400, `${d.position} ${d.context && d.context.length}`);

  // 抠不出位置的报错（空串：Unexpected end of JSON input）
  const e = validateAiJson('');
  check('⑥ 空串：ok=false、position=null、context 是开头那段（空）', e.ok === false && e.position === null && e.context === '', JSON.stringify(e));
}
// parseAiJson 改成包 validateAiJson 后照旧抛 SyntaxError + err.context（create-site.js 之外没别的消费者，但行为别变）
{
  let err = null;
  try { parseAiJson('{"a":1}{"b":2}'); } catch (x) { err = x; }
  check('⑥ parseAiJson 修不好照旧抛 SyntaxError、挂 context、报错原文不变', err instanceof SyntaxError && typeof err.context === 'string' && /position 7/.test(err.message), err && err.message);
}

console.log(`\n${pass} 过 · ${fail} 败`);
process.exit(fail ? 1 : 0);
