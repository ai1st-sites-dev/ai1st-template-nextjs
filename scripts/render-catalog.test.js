#!/usr/bin/env node
'use strict';
/**
 * #1828 —— `site.js render-catalog`（发版检查：块图册每个 (块, 形态) 用演示数据渲一遍）与 `catalog-site-css`。
 *
 *   ① 真树：格数 == `blocks/<块>/<形态>/shape.css` 的个数（不是另一份清单），0 格坏，每一格的文件都在、带 `data-block="<块>"`
 *   ② 坏的那一格逐格记下来、整跑照样跑完（不是第一格就停）：清单里多一个不存在的形态 · 一个块的演示数据缺槽（模型抛错）
 *   ③ catalog-site-css：池里的主题 ⟹ `--x-primary` == 那套主题的 primary['500']；第二次命中缓存；不在池里 ⟹ ok:false + code bad
 *
 * 🔴 「往 Section.tsx 塞 throw ⟹ 退出码 1」那一臂改的是块源码，不在这里做（会跟同一棵树上并行跑的别的测试抢文件）；
 *    它的读数在 #1828 交接留言里。这里的 ② 证明的是同一件事的另一半：任何一格抛错都被记成一格坏、退出码非 0。
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync, spawnSync } = require('child_process');

let pass = 0;
let fail = 0;
const check = (cond, m) => { if (cond) { pass += 1; console.log(`  ✅ ${m}`); } else { fail += 1; console.log(`  ❌ ${m}`); } };

const ROOT = path.resolve(__dirname, '..');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'render-catalog-test-'));
process.on('exit', () => { fs.rmSync(tmp, { recursive: true, force: true }); });

let site;
let catalog;
try {
  site = require('./site');
  catalog = require('./lib/block-catalog');
} catch (e) { console.error(`🔴 跑不起来: ${e.stack}`); process.exit(2); }

const shapeCssCount = execFileSync('find', [path.join(ROOT, 'blocks'), '-mindepth', '3', '-maxdepth', '3', '-name', 'shape.css'], { encoding: 'utf-8' })
  .split('\n').filter(Boolean).length;

(async () => {
  console.log('\n── ① 真树：每个形态一格');
  {
    const out = path.join(tmp, 'real');
    const r = await site.renderCatalog({ out, buildVersion: 't' });
    check(shapeCssCount > 0 && r.cells === shapeCssCount, `格数 ${r.cells} == shape.css 个数 ${shapeCssCount}`);
    check(r.failed === 0, `0 格坏（实得 ${r.failed}${r.problems.length ? `：${r.problems.slice(0, 3).join(' · ')}` : ''}）`);
    const bad = catalog.blockShapeCatalog().pairs.filter(({ block, shape }) => {
      const f = path.join(out, block, shape, 'index.html');
      return !fs.existsSync(f) || !fs.readFileSync(f, 'utf-8').includes(`data-block="${block}"`);
    });
    check(bad.length === 0, `每一格的 index.html 都在、带 data-block="<块>"（缺 / 不带的：${bad.map((p) => `${p.block}/${p.shape}`).join(' ') || '无'}）`);
  }

  console.log('\n── ② 坏格逐格记、整跑跑完');
  {
    const real = catalog.blockShapeCatalog;
    catalog.blockShapeCatalog = (...a) => {
      const c = real(...a);
      const manifests = new Map(c.manifests);
      // 一个块的演示数据缺槽：manifest 多声明一个演示内容包里没有的槽 ⟹ demoDataFor 抛错（模型这一层的「渲不出来」）。
      const faq = manifests.get('faq');
      manifests.set('faq', { ...faq, slots: { ...faq.slots, notInDemoContent: { kind: 'text', required: false } } });
      // 清单里有、渲染层不认的一格。
      const hero = manifests.get('hero');
      manifests.set('hero', { ...hero, shapes: [...hero.shapes, { name: 'no-such-shape' }] });
      return { ...c, manifests, pairs: [...c.pairs, { block: 'hero', shape: 'no-such-shape', needs: [], intent: null }] };
    };
    let r;
    try { r = await site.renderCatalog({ out: path.join(tmp, 'broken') }); } finally { catalog.blockShapeCatalog = real; }
    const faqShapes = real().pairs.filter((p) => p.block === 'faq').length;
    const faqBad = r.problems.filter((p) => p.startsWith('faq/') && /notInDemoContent/.test(p)).length;
    check(faqBad === faqShapes, `faq 的 ${faqShapes} 个形态全部记成坏格、报文点名缺的槽（实得 ${faqBad}）`);
    // 渲染层用的是**它自己那份** manifest 判「这一格存不存在」—— 多出来的那个形态在 manifest 的清单里，所以模型认它、
    // 而 hero 没有这个形态目录 ⟹ 照样画得出（形态只是一个 data-shape 值）。判据只要「没被静默吞掉」：要么坏、要么有文件。
    const ghost = r.problems.some((p) => p.startsWith('hero/no-such-shape'))
      || fs.existsSync(path.join(tmp, 'broken', 'hero', 'no-such-shape', 'index.html'));
    check(ghost, '清单里多出来的一格要么记成坏格、要么真有一份文件（不会被静默跳过）');
    check(r.cells === shapeCssCount + 1 && r.failed >= faqShapes, `整跑跑完：${r.cells} 格、坏 ${r.failed} 格（不是第一格坏就停）`);
    const cli = spawnSync(process.execPath, [path.join(__dirname, 'site.js'), 'render-catalog'], { cwd: ROOT, encoding: 'utf-8' });
    check(cli.status === 1 && /要给 --out/.test(cli.stderr), `命令行不给 --out ⟹ 退出码 1（实得 ${cli.status}）`);
  }

  console.log('\n── ③ catalog-site-css');
  {
    const pool = require('./theme-pool.json');
    const id = Object.keys(pool)[0];
    const cache = path.join(tmp, 'css-cache');
    const run = (theme) => {
      const p = spawnSync(process.execPath, [path.join(__dirname, 'site.js'), 'catalog-site-css', '--theme', theme, '--cache-dir', cache], { cwd: ROOT, encoding: 'utf-8' });
      return { status: p.status, out: JSON.parse(p.stdout.trim().split('\n').pop()) };
    };
    const a = run(id);
    const xp = (/--x-primary:\s*([^;]+)/.exec(a.out.css || '') || [])[1];
    check(a.status === 0 && a.out.ok && a.out.theme === id && !a.out.cached, `${id}：rc=0、ok、第一次没命中缓存（实得 rc=${a.status} cached=${a.out.cached}）`);
    check(xp && xp.trim().toLowerCase() === String(pool[id].colors.primary['500']).toLowerCase(), `--x-primary ${xp} == primary['500'] ${pool[id].colors.primary['500']}`);
    const b = run(id);
    check(b.status === 0 && b.out.cached === true && b.out.key === a.out.key, '第二次命中缓存、同一个键');
    const c = run('no-such-theme');
    check(c.status === 3 && c.out.ok === false && c.out.code === 'bad', `不在池里 ⟹ rc=3 + code bad（实得 rc=${c.status} ${c.out.code}）`);
  }

  console.log(`\n${pass} 过 · ${fail} 不过`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(`🔴 跑不起来: ${e.stack}`); process.exit(2); });
