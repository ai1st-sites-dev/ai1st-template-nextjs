#!/usr/bin/env node
/**
 * stamp-bad-version.test.js — #1963：盖号不把 prev 里的坏 `schemaVersion` 原样抄回来。
 *
 * 跑法:  node scripts/lib/stamp-bad-version.test.js   （或 `npm run test:scripts`，按文件名发现）
 * 退出码: 0 全过 · 1 有失败 · 2 跑不起来（**不许当成通过**）
 *
 * #1941 的闸（site-edit.js §validate → content-blocks.js §schemaVersionProblems）查的是这一笔**自己写进来**的号；
 * 盖号（stamp-schema-versions.js §stampOne）在它之后，把 prev 里同一块的号抄给这一笔没写号的块 —— 抄之前不问形状。
 * 所以库里一旦有一个 "2"，AI 每碰一次那一页就把它带回来一次，渲染入口每次都整份拒绝出产物（#1941 QA3 反向 2）。
 *
 *   ① validate：prev 首页第一块是 "2" / 2.5 / null，AI 交回的同 id 块不带号 ⟹ 产物里那块【没有】schemaVersion（= 1），
 *      stderr 有一行点名 文件#块 id；prev 是 2（整数）⟹ 照旧抄回 2
 *   ② 共用块（site-blocks.json）和顶栏（navigation.json header）同一条规则
 *   ③ 活路断了：①的产物喂真块目录的 §unrenderableBlocks ⟹ 0 条（改之前 1 条：unsupported schemaVersion 2 of …）
 *
 * 用真站夹具 site-0448c807、真块目录。
 */
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', '..');
const SITE = path.join(ROOT, 'scripts', 'fixtures', 'site-fixtures', 'site-0448c807.json');

let failed = 0;
let passed = 0;
const ok = (m) => { passed += 1; console.log(`  ✅ ${m}`); };
const bad = (m) => { failed += 1; console.log(`  ❌ ${m}`); };
const check = (cond, m, detail) => (cond ? ok(m) : bad(detail === undefined ? m : `${m}\n       ${detail}`));
const die = (m) => { console.log(`⛔ 跑不起来：${m}`); process.exit(2); };

const clone = (v) => JSON.parse(JSON.stringify(v));
const HOME = 'en/pages/home.json';
const NAV = 'en/navigation.json';
const SHARED = 'en/blocks/site-blocks.json';

/** 跑一次 validate，返回 `{ ok, content, message, stderr }`；stdout / stderr 都收下来不打。 */
async function run(prev, next) {
  const { validate } = require('./site-edit');
  const { SiteEditorError } = require('./site-editor');
  const log = console.log;
  const err = console.error;
  const stderr = [];
  console.log = () => {};
  console.error = (...a) => { stderr.push(a.join(' ')); };
  try {
    const r = await validate({ prev, next });
    return { ok: true, content: r.content, stderr };
  } catch (e) {
    if (e instanceof SiteEditorError) return { ok: false, message: e.message, stderr };
    throw e;
  } finally {
    console.log = log;
    console.error = err;
  }
}

/** AI 交回来的那一笔：块没写号（AI 不写这个字段），另外改一个字，让这一页真的算「这一笔碰过」。 */
function aiTouch(content, edit) {
  const next = clone(content);
  edit(next);
  return next;
}

async function main() {
  if (!fs.existsSync(SITE)) die(`夹具 ${SITE} 不在`);
  for (const k of ['AI1ST_BLOCKS_DIR', 'AI1ST_REGISTRY_PATH']) delete process.env[k];
  const site = JSON.parse(fs.readFileSync(SITE, 'utf-8'));
  if (!site[HOME] || !Array.isArray(site[HOME].blocks) || !site[HOME].blocks.length) die(`夹具没有 ${HOME} 的块`);
  if (!site[NAV] || typeof site[NAV].header !== 'object') die(`夹具没有 ${NAV} 的 header`);
  const first = site[HOME].blocks[0];
  if (!first.id) die(`${HOME} 第一块没有 id`);
  const where = `${HOME}#${first.id}`;
  const { knownBlockTypes, unrenderableBlocks } = require('./content-blocks');
  const known = knownBlockTypes(ROOT);
  if (!known.has(first.type)) die(`真块目录里没有 ${first.type}`);

  const homeTouched = (n) => {
    delete n[HOME].blocks[0].schemaVersion;
    n[HOME].title = `${n[HOME].title || ''} (#1963)`;
  };

  console.log('① validate：prev 里的坏号不被抄回来');
  let leftover = null;
  for (const v of ['2', 2.5, null]) {
    const prev = clone(site);
    prev[HOME].blocks[0].schemaVersion = v;
    const r = await run(prev, aiTouch(prev, homeTouched));
    const b = r.ok && r.content[HOME].blocks.find((x) => x.id === first.id);
    check(r.ok && b && !('schemaVersion' in b), `prev ${JSON.stringify(v)} ⟹ 产物里 ${where} 没有 schemaVersion（= 1）`,
      JSON.stringify(r.ok ? b : r).slice(0, 300));
    check(r.stderr.some((l) => l.includes(where) && l.includes(JSON.stringify(v)) && l.includes('not a whole number')),
      `prev ${JSON.stringify(v)} ⟹ stderr 有一行点名 ${where}`, JSON.stringify(r.stderr).slice(0, 400));
    if (v === '2' && r.ok) leftover = r.content;
  }
  {
    const prev = clone(site);
    prev[HOME].blocks[0].schemaVersion = 2;
    const r = await run(prev, aiTouch(prev, homeTouched));
    const b = r.ok && r.content[HOME].blocks.find((x) => x.id === first.id);
    check(r.ok && b && b.schemaVersion === 2, 'prev 2（整数）⟹ 照旧抄回 2', JSON.stringify(r.ok ? b : r).slice(0, 300));
  }

  console.log('② 共用块、顶栏同一条规则');
  {
    const prev = clone(site);
    prev[SHARED] = { promo1963: { id: 'promo1963', type: first.type, data: clone(first.data || {}), schemaVersion: '2' } };
    const next = aiTouch(prev, (n) => {
      delete n[SHARED].promo1963.schemaVersion;
      n[HOME].title = `${n[HOME].title || ''} (#1963)`;
    });
    const r = await run(prev, next);
    const b = r.ok && r.content[SHARED] && (typeof r.content[SHARED] === 'string' ? JSON.parse(r.content[SHARED]) : r.content[SHARED]).promo1963;
    check(r.ok && b && !('schemaVersion' in b), `共用块 prev "2" ⟹ 产物里 ${SHARED}#promo1963 没有 schemaVersion`,
      JSON.stringify(r.ok ? b : r).slice(0, 300));
  }
  {
    const prev = clone(site);
    prev[NAV].header.schemaVersion = '2';
    const next = aiTouch(prev, (n) => {
      delete n[NAV].header.schemaVersion;
      n[HOME].title = `${n[HOME].title || ''} (#1963)`;
    });
    const r = await run(prev, next);
    const h = r.ok && r.content[NAV].header;
    check(r.ok && h && !('schemaVersion' in h), `顶栏 prev "2" ⟹ 产物里 ${NAV}#header 没有 schemaVersion`,
      JSON.stringify(r.ok ? h : r).slice(0, 300));
  }

  console.log('③ 活路断了：产物喂渲染入口');
  if (!leftover) {
    bad('① 的 "2" 那一格没有产物，这一格没法量');
  } else {
    const problems = unrenderableBlocks(leftover, known).filter((p) => p.includes(where));
    check(problems.length === 0, `prev "2" + AI 不写号 ⟹ §unrenderableBlocks 对 ${where} 读 0 条`, JSON.stringify(problems));
  }

  console.log(`\n${passed} 过 · ${failed} 失败`);
  process.exit(failed ? 1 : 0);
}

main().catch((e) => { console.log(`⛔ 跑不起来：${e && e.stack ? e.stack : e}`); process.exit(2); });
