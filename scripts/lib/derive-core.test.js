#!/usr/bin/env node
'use strict';
/**
 * derive-core.test.js —— #1797（Epic:SiteAsData T2a-1）：派生改成纯函数之后的那几条合同。
 *
 *   ① `process.exit` 只剩薄壳的 CLI 入口；deriveSite 拒绝 ⟹ CLI 退出码非 0（staged-preview.js 靠退出码判派生失败）
 *   ② 同一进程 Promise.all 并发 4 次（两个夹具站 × 两个 outDir）⟹ 各自的产物跟单独调一次逐字节相同；变异臂：两个 outDir 指同一个目录 ⟹ 对不上
 *   ③ contentPatchesOf 三格（#1781 的 syncMenu 语义）+ 一格带下拉（#1783：页脚第一列只抄顶层）+ content 入参不被改 + 没有微调 ⟹ custom.css 为 null + 跟 deriveSite 的补丁逐字节相同
 *   ④ site.css 缓存键：每格真编一次 CSS。真实输入变 ⟹ 键变（字节变的那几格连字节一起量）；字体 / themeId 变 ⟹ 键不变、字节不变
 *   ⑤ custom-html 进 purge
 *
 * 夹具是 `scripts/fixtures/site-fixtures/` 那两个真站（「库里一行 JSON」的形状）。
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const cp = require('child_process');

const SCRIPTS = path.resolve(__dirname, '..');
const NEXT = path.resolve(SCRIPTS, '..');
const { deriveSite, contentPatchesOf, siteCssKey } = require('./derive-core');

let pass = 0; let fail = 0;
const ok = (m) => { pass += 1; console.log(`  ✅ ${m}`); };
const bad = (m) => { fail += 1; console.log(`  ❌ ${m}`); };
const check = (cond, m, detail) => (cond ? ok(m) : bad(detail ? `${m} —— ${detail}` : m));
function die(msg) { console.log(`💥 跑不起来: ${msg}`); process.exit(2); }

const temps = [];
process.on('exit', () => { for (const t of temps) fs.rmSync(t, { recursive: true, force: true }); });
const tmp = (tag) => { const d = fs.mkdtempSync(path.join(os.tmpdir(), `derive-core-${tag}-`)); temps.push(d); return d; };

const fixture = (id) => JSON.parse(fs.readFileSync(path.join(SCRIPTS, 'fixtures', 'site-fixtures', `${id}.json`), 'utf-8'));
const A = fixture('site-0448c807');
const B = fixture('site-bbc4ff97');
const clone = (c) => JSON.parse(JSON.stringify(c));
const read = (dir, f) => fs.readFileSync(path.join(dir, f));
const OUTS = ['theme.css', 'custom.css', 'site.css'];
const same = (d1, d2) => OUTS.every((f) => read(d1, f).equals(read(d2, f)));

/** 派生一次，日志吞掉（这份测试的读数是产物和返回值，不是那几十行日志）。 */
async function quiet(fn) {
  const log = console.log; const err = console.error;
  console.log = () => {}; console.error = () => {};
  try { return await fn(); } finally { console.log = log; console.error = err; }
}
const derive = (opts) => quiet(() => deriveSite(opts));

(async () => {
  console.log('① process.exit 只剩薄壳；deriveSite 拒绝 ⟹ CLI 退出码非 0');
  {
    const count = (f) => (fs.readFileSync(f, 'utf-8').match(/^\s*process\.exit\(/gm) || []).length;
    check(count(path.join(__dirname, 'derive-core.js')) === 0, `derive-core.js 里 ^\\s*process.exit( 读 0（实得 ${count(path.join(__dirname, 'derive-core.js'))}）`);
    const shell = count(path.join(SCRIPTS, 'derive-site.js'));
    check(shell === 4, `derive-site.js 只剩 4 处（找不到 site/ · AI1ST_RENDER 校验 · deriveSite 拒绝 · 写盘失败），实得 ${shell}`);

    // 一个站目录：site_meta.json 的 defaultLocale 不在 locales 里 —— 校验在 derive-core 里，拒绝要一路传成退出码。
    const site = path.join(tmp('cli'), 'site');
    const bad1 = clone(A);
    bad1['site_meta.json'].defaultLocale = 'fr';
    for (const [rel, v] of Object.entries(bad1)) {
      fs.mkdirSync(path.dirname(path.join(site, rel)), { recursive: true });
      fs.writeFileSync(path.join(site, rel), typeof v === 'string' ? v : `${JSON.stringify(v, null, 2)}\n`);
    }
    const r = cp.spawnSync(process.execPath, [path.join(SCRIPTS, 'derive-site.js')], {
      cwd: NEXT, encoding: 'utf8', timeout: 180000, env: { ...process.env, SYNC_SITE_DIR: site, AI1ST_RENDER: 'preview' },
    });
    check(r.status === 1 && /site_meta\.json invalid: defaultLocale "fr" not in locales/.test(r.stderr),
      `deriveSite 拒绝 ⟹ derive-site.js rc=${r.status}、stderr 是那句话`, (r.stderr || '').slice(0, 300));
    check(!/at runDerive|DeriveError/.test(r.stderr), '拒绝只打那句话，不打栈（stderr 会被 edit-site.js 原文推给老板）', (r.stderr || '').slice(0, 300));

    let threw = null;
    try { await derive({ content: bad1, outDir: path.join(tmp('throw'), 'out') }); } catch (e) { threw = e; }
    check(threw && /not in locales/.test(threw.message) && !threw.message.includes(os.tmpdir()),
      'deriveSite 本身是 throw（进程还活着），报错里没有临时目录的路径', threw && threw.message);
  }

  console.log('② Promise.all 并发 4 次（两个站 × 两个 outDir）⟹ 各自跟单独调一次逐字节相同');
  {
    const soloA = path.join(tmp('soloA'), 'out'); const soloB = path.join(tmp('soloB'), 'out');
    await derive({ content: A, outDir: soloA });
    await derive({ content: B, outDir: soloB });
    if (same(soloA, soloB)) die('两个夹具站产物一模一样 —— 这一格量不出覆盖');
    const outs = [['A', A, soloA], ['B', B, soloB], ['A', A, soloA], ['B', B, soloB]].map(([n, c, s], i) => ({ n, c, s, out: path.join(tmp(`par${i}`), 'out') }));
    await quiet(() => Promise.all(outs.map((o) => deriveSite({ content: o.c, outDir: o.out }))));
    const wrong = outs.filter((o) => !same(o.out, o.s)).map((o) => `${o.n}→${o.out}`);
    check(wrong.length === 0, '全部完成后逐个比：4 份产物各自跟单独调一次的逐字节相同', wrong.join(' · '));

    // 变异臂：A、B 的 outDir 指同一个目录 ⟹ 至少一个对不上（证明上一格比的是真东西，不是恒等）
    const shared = path.join(tmp('shared'), 'out');
    await quiet(() => Promise.all([deriveSite({ content: A, outDir: shared }), deriveSite({ content: B, outDir: shared })]));
    check(!(same(shared, soloA) && same(shared, soloB)), '变异臂：两个站共用一个 outDir ⟹ 至少一个站的产物对不上（尺子能读红）');
  }

  console.log('③ contentPatchesOf（#1781 syncMenu 语义）');
  {
    // #1838 起 .json 的补丁是解析后的对象（原来是原文字符串）。
    const navOf = (patches) => {
      const v = patches['en/navigation.json'];
      if (typeof v !== 'object' || v === null) die(`contentPatchesOf 回的 navigation.json 不是对象（${typeof v}）—— #1838 之后它该是对象`);
      return JSON.parse(JSON.stringify(v));
    };
    // ③ spike 夹具：有 links、没 knownPages，页脚第一列多一个 Contact
    {
      const c = clone(A); const before = JSON.stringify(c);
      const n0 = c['en/navigation.json'];
      if (Array.isArray(n0.header.knownPages)) die('夹具已经有 knownPages —— ③ 那格立不起来');
      if (n0.footer.columns[0].links.length <= n0.header.links.length) die('夹具页脚第一列没有多出来的那一项 —— ③ 那格立不起来');
      const p = contentPatchesOf(c);
      const nav = navOf(p);
      check(JSON.stringify(nav.header.links) === JSON.stringify(n0.header.links), '③ 第一次调：header.links 原样', JSON.stringify(nav.header.links));
      check(Array.isArray(nav.header.knownPages) && nav.header.knownPages.length > 0, `③ 多出 knownPages（${JSON.stringify(nav.header.knownPages)}）`);
      check(JSON.stringify(nav.footer.columns[0].links) === JSON.stringify(nav.header.links), '③ 页脚第一列 = 菜单（多出来的 Contact 没了）', JSON.stringify(nav.footer.columns[0].links));
      check(JSON.stringify(c) === before, '③ content 入参没被改');
    }
    // ① 不在 knownPages 的新页 ⟹ 菜单末尾多它
    {
      const c = clone(A);
      const seeded = navOf(contentPatchesOf(c));
      c['en/navigation.json'] = seeded;
      c['en/pages/about.json'] = { slug: 'about', title: 'About Us', navLabel: 'About', navOrder: 50, blocks: [] };
      const before = JSON.stringify(c);
      const nav = navOf(contentPatchesOf(c));
      const last = nav.header.links[nav.header.links.length - 1];
      check(last && last.href === '/about' && nav.header.links.length === seeded.header.links.length + 1,
        '① 不在 knownPages 的新页 ⟹ 菜单末尾多它', JSON.stringify(nav.header.links));
      check(JSON.stringify(c) === before, '① content 入参没被改');
    }
    // ② 在 knownPages 里、菜单上已删的页 ⟹ 不补回
    {
      const c = clone(A);
      const seeded = navOf(contentPatchesOf(c));
      const dropped = seeded.header.links.find((l) => l.href === '/faq');
      if (!dropped || !seeded.header.knownPages.includes('faq')) die('夹具菜单里没有 /faq 或 knownPages 里没有 faq —— ② 那格立不起来');
      seeded.header.links = seeded.header.links.filter((l) => l.href !== '/faq');
      c['en/navigation.json'] = seeded;
      const before = JSON.stringify(c);
      const nav = navOf(contentPatchesOf(c));
      check(!nav.header.links.some((l) => l.href === '/faq'), '② 老板删掉的 /faq（还在 knownPages 里）⟹ 不补回', JSON.stringify(nav.header.links));
      check(JSON.stringify(c) === before, '② content 入参没被改');
    }
    // #1783 菜单项带下拉 ⟹ 菜单里子项原样留着，页脚第一列只抄顶层。上面三格都不带 children，
    //    而 topLevelLinks 在没有子项时恒等于 links ⟹ 那三格对「页脚把子项抄进去」按构造是盲的，这一格补上。
    {
      const c = clone(A);
      const seeded = navOf(contentPatchesOf(c));
      const kids = [{ label: 'Drain cleaning', href: '/faq', description: 'Same-day' }];
      seeded.header.links[0] = { ...seeded.header.links[0], children: kids };
      c['en/navigation.json'] = seeded;
      const before = JSON.stringify(c);
      const nav = navOf(contentPatchesOf(c));
      check(JSON.stringify(nav.header.links[0].children) === JSON.stringify(kids), '③ 下拉：菜单项带下拉 ⟹ header.links 里子项原样', JSON.stringify(nav.header.links[0]));
      const col = nav.footer.columns[0].links;
      check(col.length === nav.header.links.length && col.every((l) => !('children' in l))
        && JSON.stringify(col[0]) === JSON.stringify((({ children, ...rest }) => rest)(nav.header.links[0])), // eslint-disable-line no-unused-vars
      '③ 下拉：页脚第一列 = 菜单的顶层（不带 children）', JSON.stringify(col));
      check(JSON.stringify(c) === before, '③ 下拉：content 入参没被改');
    }
    // 没有微调 ⟹ custom.css 为 null；有 ⟹ 是一份字符串
    {
      const c = clone(A);
      delete c['theme.json'].tweaks;
      check(contentPatchesOf(c)['custom.css'] === null, 'tweaks 为空 ⟹ custom.css 为 null');
      check(typeof contentPatchesOf(A)['custom.css'] === 'string' && /--/.test(contentPatchesOf(A)['custom.css']), '夹具带 tweaks ⟹ custom.css 是一份 CSS');
    }
    // deriveSite 的补丁 == contentPatchesOf（同输入）。#1838：deriveSite 那份是要写回磁盘的原文字符串，contentPatchesOf 的
    //    .json 补丁是对象 ⟹ 前者的 .json 解析一次再比。
    for (const [n, c] of [['A', A], ['B', B]]) {
      const r = await derive({ content: c, outDir: path.join(tmp(`patch${n}`), 'out') });
      const asObjects = Object.fromEntries(Object.entries(r.contentPatches).map(([k, v]) => [k, k.endsWith('.json') && typeof v === 'string' ? JSON.parse(v) : v]));
      check(JSON.stringify(asObjects) === JSON.stringify(contentPatchesOf(c)), `站 ${n}：deriveSite 返回的 contentPatches（.json 解析后）跟 contentPatchesOf 相同`);
    }
  }

  console.log('④ site.css 缓存键（每格真编一次）');
  {
    const cacheDir = path.join(tmp('cache'), 'c');
    const run = async (c, extra = {}) => {
      const out = path.join(tmp('key'), 'out');
      const r = await derive({ content: c, outDir: out, cacheDir, ...extra });
      return { key: r.siteCss.key, cached: r.siteCss.cached, css: read(out, 'site.css') };
    };
    const base = await run(A);
    const again = await run(A);
    check(again.cached && again.key === base.key && again.css.equals(base.css), '同一输入第二次：命中缓存、键相同、字节相同');

    // 同一个键两路并发写一个空的缓存目录：两份产物都完整、缓存里恰好一份、没有留下临时文件
    {
      const sameDir = path.join(tmp('samekey'), 'c');
      const o1 = path.join(tmp('samekey1'), 'out'); const o2 = path.join(tmp('samekey2'), 'out');
      await quiet(() => Promise.all([deriveSite({ content: A, outDir: o1, cacheDir: sameDir }), deriveSite({ content: A, outDir: o2, cacheDir: sameDir })]));
      const left = fs.readdirSync(sameDir);
      check(read(o1, 'site.css').equals(base.css) && read(o2, 'site.css').equals(base.css)
        && left.length === 1 && left[0] === `${base.key}.css` && read(sameDir, left[0]).equals(base.css),
      '同一个键两路并发：两份 site.css 都跟单独编的逐字节相同、缓存目录里只剩 <键>.css 一份', left.join(' · '));
    }

    const primary = clone(A); primary['brand.json'].colors.primary['500'] = '#c2185b';
    const p = await run(primary);
    check(p.key !== base.key && !p.cached && !p.css.equals(base.css), 'brand 主色变 ⟹ 键变、字节变');

    // custom.css 里的 --color-primary-500 覆盖（配色方案）变 —— brand.json 不动
    const palette = clone(A); palette['theme.json'].presets = { palette: 'burgundy' };
    if (!/--color-primary-500/.test(contentPatchesOf(palette)['custom.css'] || '')) die('burgundy 配色没往 custom.css 写 --color-primary-500 —— 这一格立不起来');
    const pal = await run(palette);
    check(pal.key !== base.key && !pal.css.equals(base.css), 'custom.css 的 --color-primary-500 覆盖变 ⟹ 键变、字节变');

    // 文字方向：同一个站换成阿拉伯语主语言
    const rtl = {};
    for (const [rel, v] of Object.entries(clone(A))) rtl[rel.startsWith('en/') ? `ar/${rel.slice(3)}` : rel] = v;
    rtl['site_meta.json'] = { ...rtl['site_meta.json'], defaultLocale: 'ar', locales: ['ar'] };
    const r = await run(rtl);
    check(r.key !== base.key && !r.css.equals(base.css), 'dir ltr → rtl ⟹ 键变（字节也变）');

    const unpurged = await run(A, { purge: false });
    check(unpurged.key !== base.key && unpurged.css.length > base.css.length * 3, `purge 翻转 ⟹ 键变（不剪 ${unpurged.css.length} vs 剪 ${base.css.length} 字节）`);

    const v2 = await run(A, { buildVersion: 'v2' });
    check(v2.key !== base.key && !v2.cached && fs.existsSync(path.join(cacheDir, `${v2.key}.css`)) && fs.existsSync(path.join(cacheDir, `${base.key}.css`)),
      'buildVersion 变 ⟹ 新键的文件出现、旧键的文件还在');

    // 两个反例：它们不是 Sass 的输入 —— 键不变，而且真编出来字节也不变（不靠缓存：用一个空的缓存目录）
    const fresh = async (c) => {
      const out = path.join(tmp('fresh'), 'out');
      const res = await derive({ content: c, outDir: out, cacheDir: path.join(tmp('freshc'), 'c') });
      return { key: res.siteCss.key, cached: res.siteCss.cached, css: read(out, 'site.css') };
    };
    const fonts = clone(A);
    fonts['brand.json'].fonts = { ...fonts['brand.json'].fonts, heading: ['"Lobster"', 'cursive'], body: ['"Roboto"', 'sans-serif'],
      googleFontsUrl: 'https://fonts.googleapis.com/css2?family=Lobster&family=Roboto&display=swap' };
    const f = await fresh(fonts);
    check(!f.cached && f.key === base.key && f.css.equals(base.css), '反例：只改字体 ⟹ 键不变、真编出来的 site.css 字节也不变');
    const theme = clone(A); theme['theme.json'].themeId = 'ember-12';
    const t = await fresh(theme);
    check(!t.cached && t.key === base.key && t.css.equals(base.css), '反例：只改 themeId ⟹ 键不变、真编出来的 site.css 字节也不变');

    // 不剪的时候 custom-html 不影响字节，也不进键
    check(siteCssKey({ primary: '#123456', dir: 'ltr', purge: false, html: ['<b class="x">'], buildVersion: '' })
      === siteCssKey({ primary: '#123456', dir: 'ltr', purge: false, html: [], buildVersion: '' }), '不剪时 custom-html 不进键');
  }

  console.log('⑤ custom-html 进 purge');
  {
    // 🔴 探针类选模板源码里一处都没有的 `.btn-outline-danger`：票面举的 `.btn-outline-primary` 模板自己用着
    //    （blocks/header · logos · pricing · src/components/Button.tsx），剪不剪都在，「不传 ⟹ 不含」那一臂按构造立不住。
    const probe = 'btn-outline-danger';
    const inSrc = cp.spawnSync('grep', ['-rl', probe, 'blocks', 'src', '--include=*.tsx'], { cwd: NEXT, encoding: 'utf8' }).stdout.trim();
    if (inSrc) die(`探针类 ${probe} 在模板源码里出现了（${inSrc}）—— 换一个`);
    const html = `<div class="d-flex"><a class="btn ${probe}" href="#">Book</a></div>`;
    const withOut = path.join(tmp('html1'), 'out'); const without = path.join(tmp('html0'), 'out');
    await derive({ content: A, outDir: withOut, customHtml: [{ type: 'custom-html', html }] });
    await derive({ content: A, outDir: without });
    const rule = new RegExp(`\\.${probe}\\s*[{,]`);
    check(rule.test(read(withOut, 'site.css').toString()), `传入带 .${probe} 的 custom-html ⟹ 剪后 site.css 有那条规则`);
    check(!rule.test(read(without, 'site.css').toString()), `不传 ⟹ 剪后没有（尺子能读红）`);
    check(/\.btn-outline-primary\s*[{,]/.test(read(without, 'site.css').toString()), '对照：票面那个 .btn-outline-primary 不传也在（模板自己用着）');
  }

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch((e) => die(e && e.stack));
