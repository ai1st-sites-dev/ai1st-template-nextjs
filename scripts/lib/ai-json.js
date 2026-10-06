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
 * 校验 AI 回包（#1618）：严格解析 → `jsonrepair`，两步都不成就带回出错的地方，给「交给 AI 只修语法」那一步用。
 *   成功 `{ ok: true, parsed, repaired }` —— `repaired` 为 true 表示严格解析失败、`jsonrepair` 修复后才成功。
 *   失败 `{ ok: false, error, position, context }` —— `error` 是严格解析那一步的报错原文，`position` 是从里面抠出的
 *        字符位置（抠不出为 null），`context` 是出错位置前后 200 字符。
 */
function validateAiJson(text) {
  const jsonStr = stripFences(text);
  try {
    return { ok: true, parsed: JSON.parse(jsonStr), repaired: false };
  } catch (strictErr) {
    try {
      const fixed = jsonrepair(jsonStr);
      return { ok: true, parsed: JSON.parse(fixed), repaired: true };
    } catch (_repairErr) {
      return { ok: false, error: strictErr.message, position: positionOf(strictErr.message), context: contextAround(jsonStr, strictErr.message) };
    }
  }
}

/**
 * 解析 AI 回包。回 `{ parsed, repaired }`（含义同 `validateAiJson`）。
 * 两步都失败抛 SyntaxError（严格解析那一步的报错原文），并挂上 `err.context`（出错位置前后 200 字符）。
 */
function parseAiJson(text) {
  const v = validateAiJson(text);
  if (v.ok) return { parsed: v.parsed, repaired: v.repaired };
  const err = new SyntaxError(v.error);
  err.context = v.context;
  throw err;
}

/** 从 `… at position N` 抠出位置；抠不出回 null。 */
function positionOf(message) {
  const m = /position (\d+)/.exec(String(message || ''));
  return m ? parseInt(m[1], 10) : null;
}

/** 从 `… at position N` 抠出位置，回前后 200 字符；抠不出就回开头 200 字符。 */
function contextAround(jsonStr, message) {
  const pos = positionOf(message) || 0;
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

module.exports = { validateAiJson, parseAiJson, stripFences, contextAround, saveRawResponse, RAW_DIR };
