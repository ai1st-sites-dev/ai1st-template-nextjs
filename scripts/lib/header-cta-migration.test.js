#!/usr/bin/env node
'use strict';
/**
 * header-cta-migration.test.js —— #1916：顶栏 1→2（`header.cta` → `header.buttons`），第一条跑在 #1838 机制上的真迁移。
 *
 *   跑法:  node scripts/lib/header-cta-migration.test.js  （或 `npm run test:scripts`，它按文件名发现）
 *   退出码: 0 全过 · 1 有失败 · 2 跑不起来（**不许当成通过**）
 *
 * 用真块目录（不改道到假块）：迁移函数是 `blocks/header/migrations.js`，manifest 是 `blocks/header/manifest.json`。
 *   ① 形状：`cta` 对象 ⟹ `buttons: [{label, href}]`、`cta` 不在、`shapeProblems` 为空、陌生键里没有 `cta`
 *      🔴 「`buttons` 在」不够：写成对象 `Section.tsx` 照样画不出（它只认数组），所以三样分开读。
 *   ② 已经是 `buttons` 的（新站 / spike 夹具）⟹ 列表原样，只多一个号；两样都在 ⟹ 留列表、删 `cta`
 *   ③ 编辑器存一笔菜单（真 `save`，夹具 0448c807 把顶栏换成老形状）⟹ navigation.json 迁了，其余文件逐字节不变
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', '..');
const SITE = path.join(ROOT, 'scripts', 'fixtures', 'site-fixtures', 'site-0448c807.json');

let pass = 0; let fail = 0;
const check = (cond, m, extra) => {
  if (cond) { pass += 1; console.log(`  ✅ ${m}`); } else { fail += 1; console.log(`  ❌ ${m}${extra !== undefined ? ` —— ${extra}` : ''}`); }
};
const die = (m) => { console.log(`⛔ 跑不起来：${m}`); process.exit(2); };
const clone = (v) => JSON.parse(JSON.stringify(v));
const bytesOf = (v) => (typeof v === 'string' ? v : `${JSON.stringify(v, null, 2)}\n`);

async function quietly(fn) {
  const log = console.log;
  const err = console.error;
  console.log = () => {};
  console.error = () => {};
  try { return await fn(); } finally { console.log = log; console.error = err; }
}

async function main() {
  if (process.env.AI1ST_BLOCKS_DIR) die('AI1ST_BLOCKS_DIR 在环境里 —— 这一格要量真块目录');
  if (!fs.existsSync(SITE)) die(`夹具 ${SITE} 不在`);
  const { loadBlockVersions, migrateFile } = require('./block-migrations');
  // 顶栏住在 navigation.json 的 `header` 上 ⟹ 走 §migrateFile（content 里一份文件迁一遍）；回 `{ block, changed }` 方便下面读。
  const mig = (header) => {
    const out = migrateFile('en/navigation.json', { header }, versions);
    return out ? { block: out.header, changed: true } : { block: header, changed: false };
  };
  const { shapeProblems, undeclaredKeyPaths } = require('./navigation-owned');
  const versions = loadBlockVersions();
  const info = versions.get('header');
  if (!info || info.schemaVersion !== 2) die(`真块目录里顶栏不是 v2（读到 ${info && info.schemaVersion}）`);
  check(info.renders.includes(1) && info.renders.includes(2), `manifest：renders 含 1 和 2（读到 ${JSON.stringify(info.renders)}）`);
  check(info.migrations['1→2'] && info.migrations['1→2'].preservesLook === true, '1→2 标 preservesLook: true（静默迁只跑这种）');

  const base = JSON.parse(fs.readFileSync(SITE, 'utf-8'));
  const nav = base['en/navigation.json'];
  if (!Array.isArray(nav.header.buttons) || 'cta' in nav.header || nav.header.schemaVersion !== undefined) die('夹具顶栏不是「v1 + buttons、没有 cta」—— 下面的老形状是照它改的');
  const oldHeader = (extra) => {
    const { buttons, ...h } = clone(nav.header);
    return { ...h, cta: { label: 'Get a Quote', href: '/quote' }, ...extra };
  };

  console.log('① 老形状 cta ⟹ buttons 数组');
  {
    const r = mig(oldHeader());
    const h = r.block;
    check(r.changed && h.schemaVersion === 2, `迁到 2（changed=${r.changed} · schemaVersion=${h.schemaVersion}）`);
    check(Array.isArray(h.buttons) && JSON.stringify(h.buttons) === JSON.stringify([{ label: 'Get a Quote', href: '/quote' }]),
      `buttons 是数组 [{label, href}]（读到 ${JSON.stringify(h.buttons)}）`);
    check(!('cta' in h), 'cta 不在');
    const doc = { ...nav, header: h };
    check(shapeProblems(doc).length === 0, 'shapeProblems 为空', JSON.stringify(shapeProblems(doc)));
    check(!undeclaredKeyPaths(doc).some((k) => /cta/.test(k)), `陌生键里没有 cta（${JSON.stringify(undeclaredKeyPaths(doc))}）`);
    // 对照：没迁的老形状，shapeProblems 点名缺 buttons、陌生键里有 cta —— 上面两格不是空尺
    const raw = { ...nav, header: oldHeader() };
    check(shapeProblems(raw).some((p) => /header\.buttons/.test(p)) && undeclaredKeyPaths(raw).some((k) => /cta/.test(k)),
      '对照：没迁的老形状 ⟹ shapeProblems 点名 header.buttons、陌生键里有 cta');
    const links = oldHeader().links;
    check(JSON.stringify(h.links) === JSON.stringify(links), '菜单链接原样');
    const ref = mig(oldHeader({ cta: { label: 'Call', href: { source: 'phone' } } })).block;
    check(JSON.stringify(ref.buttons) === JSON.stringify([{ label: 'Call', href: { source: 'phone' } }]), '电话引用的 href 原样搬过去');
    const empty = mig(oldHeader({ cta: { label: '  ', href: '/quote' } })).block;
    check(!('cta' in empty) && !('buttons' in empty), `cta 没有字 ⟹ 只删不搬（读到 ${JSON.stringify(empty.buttons)}）`);
  }

  console.log('② 已经是 buttons 的不动列表');
  {
    const r = mig(clone(nav.header));
    const { schemaVersion, ...rest } = r.block;
    check(schemaVersion === 2 && JSON.stringify(rest) === JSON.stringify(nav.header), 'spike 夹具的顶栏：只多一个号，其余逐字相同');
    const both = mig({ ...clone(nav.header), cta: { label: 'Old', href: '/old' } }).block;
    check(JSON.stringify(both.buttons) === JSON.stringify(nav.header.buttons) && !('cta' in both), '两样都在 ⟹ 留 buttons、删 cta');
    const again = mig(r.block);
    check(!again.changed && again.block === r.block, '已是 v2 的再跑一遍不动');
  }

  console.log('③ 编辑器存一笔菜单（真 save）：navigation.json 迁了，其余文件逐字节不变');
  {
    const { save } = require('./site-editor');
    const { contentPatchesOf } = require('./derive-core');
    const old = clone(base);
    old['en/navigation.json'] = { ...old['en/navigation.json'], header: oldHeader() };
    // 先把派生补丁套一次（夹具没有 knownPages、没有 custom.css），不然「逐字节不变」量到的是派生，不是迁移。
    const synced = { ...old };
    for (const [rel, v] of Object.entries(contentPatchesOf(old))) { if (v === null) delete synced[rel]; else synced[rel] = v; }
    if (!('cta' in synced['en/navigation.json'].header)) die('菜单同步把 cta 弄没了 —— 夹具没造成老形状');
    const links = clone(synced['en/navigation.json'].header.links);
    links[0] = { ...links[0], label: `${links[0].label} ·` };
    let r;
    try { r = await quietly(() => save({ content: synced, changes: { page: 'home', locale: 'en', root: { headerLinks: links } } })); } catch (e) { die(`存不了：${e.message}`); }
    const h = r.content['en/navigation.json'].header;
    check(Array.isArray(h.buttons) && JSON.stringify(h.buttons) === JSON.stringify([{ label: 'Get a Quote', href: '/quote' }]) && !('cta' in h) && h.schemaVersion === 2,
      `header.buttons 是数组、cta 不在、schemaVersion 2（读到 ${JSON.stringify({ buttons: h.buttons, cta: h.cta, v: h.schemaVersion })}）`);
    check(h.links[0].label === links[0].label, '老板这一笔改的菜单落上了（迁移在套 changes 之前）');
    check(shapeProblems(r.content['en/navigation.json']).length === 0, 'shapeProblems 为空', JSON.stringify(shapeProblems(r.content['en/navigation.json'])));
    const others = Object.keys(synced).filter((k) => k !== 'en/navigation.json');
    const moved = others.filter((k) => bytesOf(synced[k]) !== bytesOf(r.content[k]));
    if (others.length < 5) die(`夹具只有 ${others.length} 份别的文件 —— 下一格成了空尺`);
    check(moved.length === 0, `其余 ${others.length} 份文件逐字节不变`, `变了：${moved.join(', ')}`);
    check(JSON.stringify(r.files) === JSON.stringify(['en/navigation.json']), `这一笔只写了 navigation.json（files: ${r.files.join(', ')}）`);
  }

  console.log(`\n══ 汇总: 通过 ${pass} · 失败 ${fail} ══`);
  process.exit(fail ? 1 : 0);
}

main().catch((e) => { console.log(`⛔ 跑不起来：${e && e.stack}`); process.exit(2); });
