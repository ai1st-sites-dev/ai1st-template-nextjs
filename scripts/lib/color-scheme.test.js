#!/usr/bin/env node
/**
 * color-scheme.test.js — 站级深浅（#1472）那几个判断的机械检查。
 *
 * 跑法:  node scripts/lib/color-scheme.test.js      （`npm run test:scripts` 会自动发现它）
 * 退出码: 0 全过 · 1 有失败 · 2 跑不起来（**不许当成通过**）
 *
 * 管四件事：
 *   ① `colorScheme` 怎么读（没写 = light、写错 = 停；#1523 起 theme.json 优先、site_meta.json 回落，拿真文件测）、
 *      AI 吐回来的怎么归一（写错 = light）
 *   ② `auto` 站首屏前那段内联脚本：在一个假的 document / matchMedia 上真跑一次（它是字符串，单测不跑它就等于没人跑）
 *   ③ 块根上的 `data-bs-theme`（`contrast.js` §bsThemeForBg）：填了 bg / 图铺底 ⟹ light，没填 ⟹ 不挂
 *   ④ purge 之后 `[data-bs-theme=dark]` 规则和 `--scheme-*` 变量还在 —— 内容里**一个 `data-bs-theme` 都没有**时也在。
 *      阳性对照：同一份内容、去掉本票加的那两条 safelist，dark 规则读 0（证明留下它们的是 safelist，不是内容碰巧有那个词）。
 */
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const vm = require('vm');

let failed = 0;
const ok = (m) => console.log(`  ✅ ${m}`);
const bad = (m) => { failed += 1; console.log(`  ❌ ${m}`); };
const eq = (got, want, m) => (got === want ? ok(`${m} → ${JSON.stringify(got)}`) : bad(`${m}：期望 ${JSON.stringify(want)}，读到 ${JSON.stringify(got)}`));

let cs, contrast, siteCss;
try {
  cs = require('./color-scheme.js');
  contrast = require('./contrast.js');
  siteCss = require('./site-css.js');
} catch (e) {
  console.log(`🔴 跑不起来：${e.message}`);
  process.exit(2);
}

async function main() {
  console.log('① site_meta 读取 / AI 值归一');
  eq(cs.colorSchemeFromMeta(undefined), 'light', '没写');
  eq(cs.colorSchemeFromMeta(null), 'light', 'null');
  for (const v of ['light', 'dark', 'auto']) eq(cs.colorSchemeFromMeta(v), v, `写了 ${v}`);
  for (const v of ['Dark', 'night', 1, '', {}]) {
    try { cs.colorSchemeFromMeta(v); bad(`写错（${JSON.stringify(v)}）没抛 —— 老板选的深浅会被静默换掉`); } catch { ok(`写错（${JSON.stringify(v)}）⟹ 抛`); }
  }
  eq(cs.normalizeColorScheme(' Dark '), 'dark', 'AI 给 " Dark "');
  eq(cs.normalizeColorScheme('auto'), 'auto', 'AI 给 auto');
  eq(cs.normalizeColorScheme('night'), 'light', 'AI 给 night');
  eq(cs.normalizeColorScheme(undefined), 'light', 'AI 没给');

  console.log('①b 一个站的深浅住哪儿（#1523：theme.json 优先，site_meta.json 回落）—— 拿真文件测');
  {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'tmp-1523-scheme-'));
    let n = 0;
    // files: { 'theme.json': obj, 'site_meta.json': obj }，值为 undefined 的文件不写。
    const site = (files) => {
      const d = path.join(root, String(n++));
      fs.mkdirSync(d);
      for (const [f, v] of Object.entries(files)) if (v !== undefined) fs.writeFileSync(path.join(d, f), JSON.stringify(v));
      return d;
    };
    const theme = { themeId: 'azure-29', applied: false };
    const meta = { siteId: 'x', defaultLocale: 'en', locales: ['en'] };
    try {
      eq(cs.readSiteColorScheme(site({})), 'light', '两个文件都没有（#924 之前的扁平老站）');
      eq(cs.readSiteColorScheme(site({ 'theme.json': theme, 'site_meta.json': meta })), 'light', '两个文件都在、都没写这个键');
      // AC3 那一格：#1472 落地后、#1523 落地前建的站 —— 值只在老地方。
      eq(cs.readSiteColorScheme(site({ 'theme.json': theme, 'site_meta.json': { ...meta, colorScheme: 'dark' } })), 'dark',
        '值只在 site_meta.json（dark），theme.json 没这个键 ⟹ 回落读得出');
      eq(cs.readSiteColorScheme(site({ 'theme.json': theme, 'site_meta.json': { ...meta, colorScheme: 'auto' } })), 'auto',
        '值只在 site_meta.json（auto）');
      eq(cs.readSiteColorScheme(site({ 'theme.json': { ...theme, colorScheme: 'dark' }, 'site_meta.json': meta })), 'dark', '值在 theme.json（dark）');
      eq(cs.readSiteColorScheme(site({ 'theme.json': { ...theme, colorScheme: 'light' }, 'site_meta.json': { ...meta, colorScheme: 'dark' } })), 'light',
        '两处都写了、说法不同 ⟹ theme.json 赢（老板把建站时的 dark 改回了 light）');
      eq(cs.readSiteColorScheme(site({ 'theme.json': { ...theme, colorScheme: 'auto' } })), 'auto', '扁平老站（没有 site_meta.json）也读 theme.json');
      try {
        cs.readSiteColorScheme(site({ 'theme.json': { ...theme, colorScheme: 'night' }, 'site_meta.json': { ...meta, colorScheme: 'dark' } }));
        bad('theme.json 写错没抛 —— 会静默回落到 site_meta 的值');
      } catch (e) {
        /theme\.json invalid/.test(e.message) ? ok(`theme.json 写错 ⟹ 抛，并点名文件：${e.message}`) : bad(`抛了但没点名 theme.json：${e.message}`);
      }
      try {
        cs.readSiteColorScheme(site({ 'theme.json': theme, 'site_meta.json': { ...meta, colorScheme: 'Dark' } }));
        bad('site_meta.json 写错没抛');
      } catch (e) {
        /site_meta\.json invalid/.test(e.message) ? ok('site_meta.json 写错 ⟹ 抛，并点名文件') : bad(`抛了但没点名 site_meta.json：${e.message}`);
      }
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  }

  console.log('② auto 站那段内联脚本（真跑）');
  const run = (matchMedia) => {
    const attrs = {};
    const listeners = [];
    const mql = matchMedia ? { matches: matchMedia.dark, addEventListener: (t, f) => listeners.push(f) } : null;
    const window = matchMedia ? { matchMedia: (q) => { mql.query = q; return mql; } } : {};
    const document = { documentElement: { setAttribute: (k, v) => { attrs[k] = v; } } };
    vm.runInNewContext(cs.AUTO_SCHEME_SCRIPT, { window, document });
    return { attrs, mql, listeners };
  };
  const dark = run({ dark: true });
  eq(dark.attrs['data-bs-theme'], 'dark', '系统暗色');
  eq(dark.mql.query, '(prefers-color-scheme: dark)', '问的是哪条媒体查询');
  const light = run({ dark: false });
  eq(light.attrs['data-bs-theme'], 'light', '系统亮色');
  light.mql.matches = true;
  light.listeners.forEach((f) => f());
  eq(light.attrs['data-bs-theme'], 'dark', '系统从亮切到暗（change 事件）');
  eq(run(null).attrs['data-bs-theme'], 'light', '没有 matchMedia');

  console.log('③ 块根上的 data-bs-theme（bsThemeForBg）');
  eq(contrast.bsThemeForBg(undefined), undefined, '没填 bg');
  eq(contrast.bsThemeForBg(''), undefined, '空串');
  eq(contrast.bsThemeForBg('red'), undefined, '填错（不是 #rrggbb）—— 当没填');
  eq(contrast.bsThemeForBg('#ffffff'), 'light', '白底');
  eq(contrast.bsThemeForBg('#0f172a'), 'light', '深底（深底规则是照 light 变量写的）');
  eq(contrast.bsThemeForBg('brand'), 'light', 'brand');
  eq(contrast.bsThemeForBg({ stops: ['#7d52f4', '#f7b733'], angle: 135 }), 'light', '渐变');
  eq(contrast.bsThemeForBg(undefined, true), 'light', '图铺底、没填 bg');

  console.log('④ purge 之后 dark 规则和 --scheme-* 变量还在');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tmp-1472-purge-'));
  try {
    // 内容里只有块的普通标记，**没有** data-bs-theme 这个词 —— 改前 dark 规则能留下，靠的正是源码里碰巧有它。
    fs.writeFileSync(path.join(dir, 'a.tsx'),
      'export const A = () => <section data-block="x" className="bg-body text-body-secondary card container"><p className="text-muted">x</p></section>;\n');
    const raw = siteCss.compileSiteCss('#2563eb');
    const count = (css) => (css.match(/\[data-bs-theme=dark\]/g) || []).length;
    const rawDark = count(raw);
    if (rawDark === 0) { bad('编译产物里一条 [data-bs-theme=dark] 都没有 —— Webpixels 那一侧变了，下面的读数都没意义'); }
    const purged = await siteCss.purgeSiteCss(raw, { rootDir: dir, content: ['*.tsx'] });
    const kept = count(purged);
    kept > 0 && kept === rawDark ? ok(`dark 规则：编译 ${rawDark} 条 · purge 后 ${kept} 条（全留）`) : bad(`dark 规则：编译 ${rawDark} 条，purge 后只剩 ${kept} 条`);
    const darkBlock = (purged.match(/\[data-bs-theme=dark\]\s*\{[^}]*--scheme-[^}]*\}/) || [''])[0];
    const lightBlock = (purged.match(/\[data-bs-theme=light\]\s*\{[^}]*--scheme-[^}]*\}/) || [''])[0];
    for (const v of ['--scheme-surface-muted', '--scheme-surface-sunken', '--scheme-surface-map', '--scheme-ink-strong', '--scheme-ink', '--scheme-ink-muted', '--scheme-ink-faint', '--scheme-line', '--scheme-primary-ink']) {
      darkBlock.includes(`${v}:`) && lightBlock.includes(`${v}:`)
        ? ok(`${v} 在 light / dark 两侧都还在`) : bad(`${v} 被 purge 删了（light ${lightBlock.includes(v)} · dark ${darkBlock.includes(v)}）—— block.css 读它会落回初始值`);
    }
    /--x-body-bg:/.test(darkBlock) || /\[data-bs-theme=dark\][^{]*\{[^}]*--x-body-bg:/.test(purged)
      ? ok('dark 一侧的 --x-body-bg 改写还在（variables: true 没把它顺手删掉）') : bad('dark 一侧的 --x-body-bg 改写被删了');
    /:where\(\[data-block\]\[data-bs-theme=light\]\)/.test(purged)
      ? ok('填了 bg 的块那条「字色从 light 变量重算」规则还在') : bad('`:where([data-block][data-bs-theme=light])` 那条规则被 purge 删了');

    // 阳性对照：同一份内容，safelist 退回改前那样（只有主题色变量）。
    const { PurgeCSS } = require('purgecss');
    const [before] = await new PurgeCSS().purge({
      content: [path.join(dir, '*.tsx')], css: [{ raw }],
      safelist: { variables: siteCss.THEME_COLOR_VARIABLES }, fontFace: true, keyframes: true, variables: true,
    });
    count(before.css) === 0
      ? ok('阳性对照：去掉本票那两条 safelist，同一份内容 purge 后 dark 规则读 0（留下它们的是 safelist）')
      : bad(`阳性对照没立起来：不加 safelist 也留下了 ${count(before.css)} 条 —— 上面那格证不出 safelist 有用`);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }

  // 深色站把 `--x-heading-color` 设成 `initial`（site-css.js §SCHEME_SURFACES：不让 Webpixels 的 dark 白标题套进浅底）
  // ⟹ `var(--x-heading-color, <写死的颜色>)` 在深色站上落到那个写死的颜色（content 曾是 #0f172a 压 #131313 = 1.05:1）。
  // 兜底只许写 `--scheme-*` 变量（light 值等于原字面量，dark 下跟着换）。
  console.log('\n── 块 CSS 里 --x-heading-color 的兜底');
  {
    const blocksDir = path.join(__dirname, '..', '..', 'blocks');
    const hits = [];
    let seen = 0;
    for (const b of fs.readdirSync(blocksDir)) {
      const f = path.join(blocksDir, b, 'block.css');
      if (!fs.existsSync(f)) continue;
      const css = fs.readFileSync(f, 'utf-8').replace(/\/\*[\s\S]*?\*\//g, '');
      for (const m of css.matchAll(/var\(--x-heading-color\s*,\s*([^)]*\)?)\)/g)) {
        seen += 1;
        if (!/^var\(--scheme-/.test(m[1].trim())) hits.push(`${b}: ${m[0]}`);
      }
    }
    hits.length === 0
      ? ok(`${seen} 处 var(--x-heading-color, …) 的兜底都读 --scheme-* 变量`)
      : bad(`兜底写死了颜色（深色站上会落到它）：${hits.join(' · ')}`);
  }

  // #1472 r2（QA2 打回）：博客两页不是块，字色写死在 Tailwind 灰上，深色站上黑底黑字 1.05:1。
  // 判据：同一个 className 里，每个 text-/bg-/border-gray-N 都要配一个 dark: 搭档；不许用 bg-white
  // （Bootstrap 也有 `.bg-white` 且带 !important，dark: 压不过它 —— 实测白卡片 + 浅字 1.1:1）。
  console.log('\n── 博客两页的写死灰色都有 dark: 搭档');
  {
    const pagesDir = path.join(__dirname, '..', '..', 'src', 'components', 'pages');
    for (const f of ['BlogIndexPage.tsx', 'BlogPostPage.tsx']) {
      const src = fs.readFileSync(path.join(pagesDir, f), 'utf-8');
      const miss = [];
      let seen = 0;
      for (const m of src.matchAll(/className="([^"]*)"/g)) {
        const cls = m[1].split(/\s+/);
        for (const c of cls) {
          const g = /^(?:hover:|group-hover:)?(text|bg|border)-gray-\d+$/.exec(c);
          if (g) { seen += 1; if (!cls.some((d) => d.startsWith('dark:') && d.includes(`${g[1]}-`))) miss.push(c); }
          if (c === 'bg-white') miss.push('bg-white（被 Bootstrap 的 !important 压住）');
        }
      }
      miss.length === 0 ? ok(`${f}：${seen} 个写死的灰色都有 dark: 搭档`) : bad(`${f}：${miss.join(' · ')}`);
    }
  }

  console.log(failed ? `\n🔴 ${failed} 格失败` : '\n✅ 全过');
  process.exit(failed ? 1 : 0);
}

main().catch((e) => { console.log(`🔴 跑不起来：${e.stack || e.message}`); process.exit(2); });
