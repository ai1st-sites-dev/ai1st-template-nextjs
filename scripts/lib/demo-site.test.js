#!/usr/bin/env node
/**
 * demo-site.test.js — skipAI 示例站排出来的块，在主题池的**每一套**主题下都是某个预设（#1620 r2）。
 *
 * 跑法:  node scripts/lib/demo-site.test.js   （或 `npm run test:scripts`，它按文件名发现）
 * 退出码: 0 全过 · 1 有失败 · 2 跑不起来（**不许当成通过**）
 *
 * 🔴 r1 的洞：示例站只写了显示开关（cta 的 `options.image: left`），形态交给主题 —— azure-29 给 cta 的是 Inline，
 *    叠起来不是任何一个预设，1440 宽下文字栏被挤到 94px（QA2 量到；ember-12 给 Boxed 所以截图是好的）。
 *    这里用渲染那一侧同一组函数算：形态 = `block-shape.js` §shapeForBlock（页面 JSON 的 `shape` → 主题选择单 → 默认），
 *    旋钮 = `block-knobs.js` §effectiveKnobs，再问 §presetFor 对不对得上一个预设。
 *
 * 🔴 判据面现算：块从 `loadManifests()`，主题从 `theme-pool.json` 的每一套 `shapes`。分母印出来，0 套主题 / 0 个开了槽的块 = 跑不起来。
 * 🔴 反臂（同一进程）：把 demoSitePages 写的 `shape` 删掉（= r1 的形态），要求至少一套主题下当场红、并点名 cta。
 */
'use strict';

const path = require('path');
const { loadManifests } = require('./block-manifest');
const { shapeForBlock } = require('./block-shape');
const { effectiveKnobs, presetFor } = require('./block-knobs');
const { PAGE_PLAN, demoSitePages } = require('./demo-site');

let failed = 0;
const fail = (m) => { failed += 1; console.log(`  ❌ ${m}`); };
const ok = (m) => console.log(`  ✅ ${m}`);

function offPreset(pages, manifestObj, selection) {
  const bad = [];
  for (const page of pages) {
    for (const sec of page.sections) {
      if (!sec.data || !sec.data.options) continue;
      const m = manifestObj[sec.type];
      const shape = shapeForBlock(sec, selection, manifestObj, () => {});
      if (!presetFor(m, effectiveKnobs(m, shape, sec.data.options))) bad.push(`${page.slug}/${sec.type}（形态 ${shape}）`);
    }
  }
  return bad;
}

function main() {
  const manifests = loadManifests();
  const manifestObj = Object.fromEntries(manifests);
  const pool = require(path.join(__dirname, '..', 'theme-pool.json'));
  const themes = Object.entries(pool).filter(([, t]) => t && t.shapes && typeof t.shapes === 'object');
  const pages = Object.keys(PAGE_PLAN).map((slug) => ({ slug, sections: [] }));
  demoSitePages(pages, manifests);
  const opened = pages.flatMap((p) => p.sections.filter((s) => s.data && s.data.options).map((s) => `${p.slug}/${s.type}`));
  console.log(`分母：主题 ${themes.length} 套 · 带 options 的块 ${opened.length} 个（${opened.join(' ')}）`);
  if (!themes.length || !opened.length) {
    console.log('  ⛔ 分母是 0，这道检查什么都没查');
    process.exit(2);
  }

  console.log('正臂：每套主题下，每个带 options 的块都对得上一个预设');
  const pinned = pages.flatMap((p) => p.sections.filter((s) => s.shape).map((s) => `${p.slug}/${s.type}=${s.shape}`));
  console.log(`  · 钉了形态的 ${pinned.length} 个：${pinned.join(' ')}（其余带 options 的是演示内容自带的，不经显示开关）`);
  for (const [id, t] of themes) {
    const bad = offPreset(pages, manifestObj, t.shapes);
    if (bad.length) fail(`主题 ${id}：不是任何预设 —— ${bad.join(' · ')}`);
    else ok(`主题 ${id}：${opened.length}/${opened.length} 对得上预设`);
  }
  const cta = pages.flatMap((p) => p.sections).find((s) => s.type === 'cta' && s.data && s.data.options);
  if (!cta || cta.shape !== 'photo') fail(`首页 cta 应钉在 photo（PAGE_PLAN 点名的），读到 ${cta && cta.shape}`);
  else ok('首页 cta 钉在 photo');

  console.log('反臂：删掉 shape（= r1 的写法）');
  const stripped = JSON.parse(JSON.stringify(pages));
  for (const p of stripped) for (const s of p.sections) delete s.shape;
  const reds = themes.map(([id, t]) => [id, offPreset(stripped, manifestObj, t.shapes)]).filter(([, b]) => b.length);
  if (reds.some(([, b]) => b.some((x) => x.startsWith('home/cta')))) ok(`当场红：${reds.map(([id, b]) => `${id} → ${b.join(' · ')}`).join(' ； ')}`);
  else fail('删掉 shape 后没有任何一套主题让首页 cta 变红 —— 这道检查瞎了');

  console.log(failed ? `\n有失败 ${failed}` : '\n全过');
  process.exit(failed ? 1 : 0);
}

try {
  main();
} catch (e) {
  console.log(`⛔ 跑不起来：${e && e.stack}`);
  process.exit(2);
}
