#!/usr/bin/env node
/**
 * build-target.test.js — #1547：sync-config 用 env 覆盖 `seo.domain` / `seo.indexable` 的那一层。
 *
 *   node scripts/lib/build-target.test.js        （`npm run test:scripts` 自动发现）
 *   退出码: 0 全过 · 1 有失败 · 2 跑不起来（不许当成通过）
 */
'use strict';

const { readBuildTarget, applyBuildTarget } = require('./build-target.js');

let pass = 0, fail = 0;
const ok = (m) => { pass++; console.log(`  ✅ ${m}`); };
const bad = (m) => { fail++; console.log(`  ❌ ${m}`); };
const die = (m) => { console.error(`🔴 跑不起来: ${m}`); process.exit(2); };
if (typeof readBuildTarget !== 'function' || typeof applyBuildTarget !== 'function') die('build-target.js 没导出两个函数');

const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const check = (name, got, want) => (eq(got, want) ? ok(name) : bad(`${name} —— 得到 ${JSON.stringify(got)}，期望 ${JSON.stringify(want)}`));
const throws = (name, fn, re) => {
  try { fn(); bad(`${name} —— 没抛错`); } catch (e) { re.test(e.message) ? ok(name) : bad(`${name} —— 抛的是 ${e.message}`); }
};

// ① 预览（dev：previewScheme=http）与上线两种目标
check('dev 预览地址按原样收下（http + 端口）',
  readBuildTarget({ SITE_URL: 'http://a1b2.ai1st-clouddev.localhost:8090', SITE_INDEXABLE: 'false' }),
  { siteUrl: 'http://a1b2.ai1st-clouddev.localhost:8090', indexable: false });
check('上线地址 + indexable=true',
  readBuildTarget({ SITE_URL: 'https://example.com', SITE_INDEXABLE: 'true' }),
  { siteUrl: 'https://example.com', indexable: true });
check('结尾斜杠去掉（seo.domain 后面直接拼路径）',
  readBuildTarget({ SITE_URL: 'https://example.com/' }).siteUrl, 'https://example.com');

// ② 两个都缺 = 本票之前的容器：不碰
check('两个 env 都缺 → 都是 null', readBuildTarget({}), { siteUrl: null, indexable: null });

// ③ 不合法就停，不猜
throws('SITE_URL 不带 scheme → 抛错', () => readBuildTarget({ SITE_URL: 'example.com' }), /SITE_URL/);
throws('SITE_URL 是 ftp → 抛错', () => readBuildTarget({ SITE_URL: 'ftp://example.com' }), /http/);
throws('SITE_URL 带路径 → 抛错', () => readBuildTarget({ SITE_URL: 'https://example.com/en' }), /根地址/);
throws('SITE_INDEXABLE=1 → 抛错（只认 true/false）', () => readBuildTarget({ SITE_INDEXABLE: '1' }), /SITE_INDEXABLE/);

// ④ 写进每个语言
const seo = { en: { domain: 'https://made-up.example' }, fr: { domain: 'https://made-up.example' } };
applyBuildTarget(seo, { siteUrl: 'https://example.com', indexable: false });
check('每个语言的 domain 都换成目标地址', [seo.en.domain, seo.fr.domain], ['https://example.com', 'https://example.com']);
check('每个语言都写上 indexable', [seo.en.indexable, seo.fr.indexable], [false, false]);
const untouched = { en: { domain: 'https://kept.example' } };
applyBuildTarget(untouched, { siteUrl: null, indexable: null });
check('目标为空时 seo 一个字节不动', untouched, { en: { domain: 'https://kept.example' } });

console.log(`\nbuild-target: ${pass} 过 · ${fail} 败`);
process.exit(fail ? 1 : 0);
