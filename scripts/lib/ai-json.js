'use strict';
/**
 * ai-json.js — AI 回包的 JSON 解析：先严格解析，失败再修一次（FastBuild T2 #1596 的第 4 条，先行落地）。
 *
 * 为什么：2026-10-06 `site-87c53d50` 站级那一通 3/3 次 `Expected ',' or '}' after property value`，同一偏移——
 * 模型在中文文案里写了没转义的 `"`（`"我们提供"专业"的服务"`），不是随机抖动，重试三次照样坏，273 秒 $0.31 后整站 fatal。
 * 这类错（没转义的引号、尾逗号、代码围栏、注释）是机械的，`jsonrepair` 修得了；修不了的才值得重试。
 *
 * 另：解析失败时原始回包今天不留，失败只能猜。这里把它存到 `/tmp/ai-raw/<label>-<attempt>.txt`（容器里），
 * 并把出错位置前后 200 字符带回去给日志 / 事件。
 */

const fs = require('fs');
const path = require('path');
const { jsonrepair } = require('jsonrepair');

const RAW_DIR = process.env.AI_RAW_DIR || '/tmp/ai-raw';

/** 去代码围栏（```json … ```）与首尾空白。 */
function stripFences(text) {
  return String(text || '').trim().replace(/^```[\w-]*\n?/, '').replace(/\n?```$/, '');
}

/**
 * 解析 AI 回包。回 `{ parsed, repaired }`：`repaired` 为 true 表示严格解析失败、修复后才成功。
 * 两次都失败抛原来的 SyntaxError，并挂上 `err.context`（出错位置前后 200 字符）。
 */
function parseAiJson(text) {
  const jsonStr = stripFences(text);
  try {
    return { parsed: JSON.parse(jsonStr), repaired: false };
  } catch (strictErr) {
    try {
      const fixed = jsonrepair(jsonStr);
      return { parsed: JSON.parse(fixed), repaired: true };
    } catch (_repairErr) {
      strictErr.context = contextAround(jsonStr, strictErr.message);
      throw strictErr;
    }
  }
}

/** 从 `… at position N` 抠出位置，回前后 200 字符；抠不出就回开头 200 字符。 */
function contextAround(jsonStr, message) {
  const m = /position (\d+)/.exec(String(message || ''));
  const pos = m ? parseInt(m[1], 10) : 0;
  const start = Math.max(0, pos - 200);
  return jsonStr.slice(start, pos + 200);
}

/** 把原始回包存盘（失败只记日志，不抛）。回写入的路径或 null。 */
function saveRawResponse(label, attempt, text) {
  try {
    fs.mkdirSync(RAW_DIR, { recursive: true });
    const safe = String(label || 'ai').replace(/[^\w.-]+/g, '_').slice(0, 60);
    const file = path.join(RAW_DIR, `${safe}-${attempt}.txt`);
    fs.writeFileSync(file, String(text || ''));
    return file;
  } catch (_e) {
    return null;
  }
}

module.exports = { parseAiJson, stripFences, contextAround, saveRawResponse, RAW_DIR };
