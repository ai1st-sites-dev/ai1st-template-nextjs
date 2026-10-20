#!/usr/bin/env node
/**
 * schema-version-shape.test.js — #1941：写进库的块 `schemaVersion` 只收整数。
 *
 * 跑法:  node scripts/lib/schema-version-shape.test.js   （或 `npm run test:scripts`，按文件名发现）
 * 退出码: 0 全过 · 1 有失败 · 2 跑不起来（**不许当成通过**）
 *
 * 渲染入口（content-blocks.js §unrenderableBlocks）拿 `renders.includes(v)` 比，`"2"` / `2.5` / `null` / `{}` 一律画不出、
 * 整站跑不出产物。#1941 之前写入那两条路一个都不拦：AI 改站（`site.js validate`，lib/site-edit.js）和编辑器存盘
 * （`site.js save`，lib/site-editor.js）都 rc=0、原样存。
 *
 *   ① validate：首页第一块写 "2" / 2.5 / null / {} ⟹ ok:false + refused，那句话点名块；写 2 / 1 ⟹ 照收、存的就是它
 *   ② save：同上五格（编辑器那一笔）
 *   ③ validate：顶栏 `navigation.json` 的 header 写 2.5 ⟹ 拒（菜单那道门只查「是数字」，2.5 能过）
 *   ④ 只查这一笔改到的文件：别的页上早就躺着一个 "2"，这一笔没碰它 ⟹ 照收（不替老数据背锅）
 *
 * 用真站夹具 site-0448c807、真块目录（真块全是 v1，不需要假块）。
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

async function quietly(fn) {
  const log = console.log;
  const err = console.error;
  console.log = () => {};
  console.error = () => {};
  try { return await fn(); } finally { console.log = log; console.error = err; }
}

/** 跑一次，返回 `{ ok, code, message, content }`（SiteEditorError ⟹ ok:false，别的异常照抛）。 */
async function attempt(fn) {
  const { SiteEditorError } = require('./site-editor');
  try {
    const r = await quietly(fn);
    return { ok: true, content: r.content };
  } catch (e) {
    if (e instanceof SiteEditorError) return { ok: false, code: e.code, message: e.message };
    throw e;
  }
}

const SHAPES = [
  { name: '"2"', v: '2', accept: false },
  { name: '2.5', v: 2.5, accept: false },
  { name: 'null', v: null, accept: false },
  { name: '{}', v: {}, accept: false },
  { name: '2', v: 2, accept: true },
  { name: '1', v: 1, accept: true },
];

async function main() {
  if (!fs.existsSync(SITE)) die(`夹具 ${SITE} 不在`);
  for (const k of ['AI1ST_BLOCKS_DIR', 'AI1ST_REGISTRY_PATH']) delete process.env[k];
  const site = JSON.parse(fs.readFileSync(SITE, 'utf-8'));
  if (!site[HOME] || !Array.isArray(site[HOME].blocks) || !site[HOME].blocks.length) die(`夹具没有 ${HOME} 的块`);
  if (!site[NAV] || typeof site[NAV].header !== 'object') die(`夹具没有 ${NAV} 的 header`);
  const first = site[HOME].blocks[0];
  const where = `${HOME}#${first.id}`;
  const { validate } = require('./site-edit');
  const { save } = require('./site-editor');

  console.log('① validate（AI 改站那条路）');
  for (const s of SHAPES) {
    const next = clone(site);
    next[HOME].blocks[0].schemaVersion = s.v;
    const r = await attempt(() => validate({ prev: site, next }));
    if (s.accept) {
      check(r.ok && r.content[HOME].blocks[0].schemaVersion === s.v, `${s.name} ⟹ 照收、存的是 ${s.name}`, JSON.stringify(r).slice(0, 300));
    } else {
      check(!r.ok && r.code === 'refused' && r.message.includes(`schemaVersion ${JSON.stringify(s.v)} of ${first.type} at ${where} is not a whole number`),
        `${s.name} ⟹ refused，点名 ${where}`, JSON.stringify(r).slice(0, 300));
    }
  }

  console.log('② save（编辑器存盘那条路）');
  for (const s of SHAPES) {
    const page = clone(site[HOME]);
    page.blocks[0].schemaVersion = s.v;
    const r = await attempt(() => save({ content: site, changes: { page: 'home', locale: 'en', json: page, baseHash: '' }, keep: true }));
    if (s.accept) {
      check(r.ok && r.content[HOME].blocks[0].schemaVersion === s.v, `${s.name} ⟹ 照收、存的是 ${s.name}`, JSON.stringify(r).slice(0, 300));
    } else {
      check(!r.ok && r.code === 'refused' && r.message.includes(`schemaVersion ${JSON.stringify(s.v)} of ${first.type} at ${where} is not a whole number`),
        `${s.name} ⟹ refused，点名 ${where}`, JSON.stringify(r).slice(0, 300));
    }
  }

  console.log('③ validate：顶栏的号');
  {
    const next = clone(site);
    next[NAV].header.schemaVersion = 2.5;
    const r = await attempt(() => validate({ prev: site, next }));
    check(!r.ok && r.code === 'refused' && r.message.includes(`schemaVersion 2.5 of header at ${NAV}#header is not a whole number`),
      'header schemaVersion 2.5 ⟹ refused', JSON.stringify(r).slice(0, 300));
    const fine = clone(site);
    fine[NAV].header.schemaVersion = 2;
    const r2 = await attempt(() => validate({ prev: site, next: fine }));
    check(r2.ok, 'header schemaVersion 2 ⟹ 照收', JSON.stringify(r2).slice(0, 300));
  }

  console.log('④ 只查这一笔改到的文件');
  {
    const other = Object.keys(site).find((k) => /^en\/pages\/.+\.json$/.test(k) && k !== HOME && Array.isArray(site[k].blocks) && site[k].blocks.length);
    if (!other) die('夹具里找不到首页以外带块的页');
    const old = clone(site);
    old[other].blocks[0].schemaVersion = '2'; // 早就在库里的老数据
    const next = clone(old);
    next[HOME].blocks[0].data = { ...(next[HOME].blocks[0].data || {}) };
    next[HOME].title = `${next[HOME].title || ''} (#1941)`;
    const r = await attempt(() => validate({ prev: old, next }));
    check(r.ok, `${other} 上早有的 "2" 不算在这一笔头上`, JSON.stringify(r).slice(0, 300));
    const page = clone(old[HOME]);
    page.title = `${page.title || ''} (#1941)`;
    const r2 = await attempt(() => save({ content: old, changes: { page: 'home', locale: 'en', json: page, baseHash: '' }, keep: true }));
    check(r2.ok, `save 同样：没碰 ${other} 就不拦`, JSON.stringify(r2).slice(0, 300));
  }

  console.log(`\n${passed} 过 · ${failed} 失败`);
  process.exit(failed ? 1 : 0);
}

main().catch((e) => { console.log(`⛔ 跑不起来：${e && e.stack ? e.stack : e}`); process.exit(2); });
