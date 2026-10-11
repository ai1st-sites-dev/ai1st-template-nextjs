#!/usr/bin/env node
// #1698 —— 块背景跟着主题走：四个新底（`contrast.js` §THEME_BGS）的校验、渲染、字色、对比度，以及色板与建站提示词。
//
// 量的是正文验收里这几条（逐条标在格子名上）：
//   AC1  四个名字过校验（isColorValue / normalizeBg / bgFromParam）；渲染出来是这套配色的那几档 —— 走真的 Apply 那条路：
//        `tweaks.js` §buildCustomCss 按「主题 × 配色 × 色相」写出 custom.css，再用 `theme-contrast.js` 把 §bgCss 那串
//        CSS 解成颜色，跟配色表里那几档（转过色相的）逐个比；字色三种浅的 light、深渐变 dark。
//   AC2  建站提示词（create-site 印的就是 `promptSection('homepage')` + `promptSection('page-specific')`）里，带
//        「bg is the background colour」那句话的块集合 == 带主题色写法的块集合 == 正文点名的 14 个。
//   AC4  每套配色 + 池里每套主题 × 每个新底 × 色相滑块每一档，字都过 `theme-contrast.js` 那把尺（字先往底色掺 6% 再算，
//        4.5）；色板上没有带颜色的写死值。阳性对照：同一个判据压在点缀色 500 实心底上必须红（本票不做它的理由）。
'use strict';

const path = require('path');
const C = require('./lib/contrast.js');
const TC = require('./theme-contrast.js');
const tweaks = require('./tweaks.js');
const { PALETTES, presetVars } = require('./theme-presets.js');
const POOL = require('./theme-pool.json');
const SHARED = require('./lib/shared-slots.json');
const manifestLib = require('./lib/block-manifest.js');

let pass = 0;
let fail = 0;
function check(name, fn) {
  try { fn(); pass += 1; console.log(`  ✅ ${name}`); } catch (e) { fail += 1; console.log(`  ❌ ${name}\n     ${e.message}`); }
}
function ok(cond, msg) { if (!cond) throw new Error(msg); }

/** 正文「做什么 1」：每个新底是哪几档、字色是哪套。🔴 这张表照正文抄，不从 contrast.js 读 —— 读它就是拿实现验实现。 */
const SPEC = {
  'brand-soft': { stops: [['primary', '50']], tone: 'light' },
  'accent-soft': { stops: [['accent', '50']], tone: 'light' },
  'soft-gradient': { stops: [['primary', '50'], ['accent', '50']], tone: 'light' },
  'deep-gradient': { stops: [['primary', '700'], ['primary', '900']], tone: 'dark' },
};
const NAMES = Object.keys(SPEC);
/** 配色 6 套 + 池里主题（没选配色的站用的就是主题自己那套）。 */
const SETS = [
  ...Object.entries(PALETTES).map(([n, v]) => [n, v.colors]),
  ...Object.entries(POOL).map(([n, v]) => [`主题 ${n}`, v.colors]),
];
const HUES = TC.hueSteps();

/** 一份 `:root` 的变量表：基准（主题的 theme.css）叠上 custom.css 里写了的那几条（后者赢，跟浏览器一样）。 */
function varsFromCss(baseVars, customCss) {
  const out = Object.fromEntries(baseVars);
  for (const m of String(customCss).matchAll(/(--color-[a-z]+-\d+)\s*:\s*([^;]+);/g)) out[m[1]] = m[2].trim();
  return out;
}
/** §bgCss 那串 → 页面上可能出现的每一个底色（渐变取 257 个点）。 */
function paint(name, vars) {
  const css = C.bgCss(name);
  const grad = css.startsWith('linear-gradient(');
  return TC.backgroundColours(grad ? { image: css } : { color: css }, vars);
}
const hex = (rgb) => `#${rgb.map((v) => v.toString(16).padStart(2, '0')).join('')}`;

// ══ AC1 校验 + 字色 ══════════════════════════════════════════════════════════════════════════════
console.log('AC1 校验 + 字色');
check('THEME_BGS 正好是正文那四个名字', () => {
  ok(JSON.stringify(Object.keys(C.THEME_BGS).sort()) === JSON.stringify([...NAMES].sort()), `实际 ${Object.keys(C.THEME_BGS)}`);
});
for (const n of NAMES) {
  check(`AC1 ${n}：isColorValue / normalizeBg / bgFromParam 都认，存盘形状就是名字本身`, () => {
    ok(C.isColorValue(n), 'isColorValue 不认');
    ok(C.normalizeBg(n) === n, `normalizeBg → ${C.normalizeBg(n)}`);
    ok(C.bgFromParam(n) === n, `bgFromParam → ${C.bgFromParam(n)}`);
    ok(C.bsThemeForBg(n) === 'light', 'data-bs-theme 应该是 light（块按自己的底色画）');
  });
  check(`AC1 ${n}：字色 = ${SPEC[n].tone}`, () => { ok(C.toneForBg(n) === SPEC[n].tone, `toneForBg → ${C.toneForBg(n)}`); });
}
check('AC1 形状像名字但不是这四个的不收（大小写、前后空格、拼错）', () => {
  for (const v of ['Brand-Soft', ' brand-soft', 'brand-soft ', 'accent-deep', 'deep_gradient']) ok(!C.isColorValue(v), `${JSON.stringify(v)} 被收了`);
});
check('AC1 validateSite 收新名字（建站写盘前那道校验走的就是它）', () => {
  for (const type of ['hero', 'cta']) {
    for (const n of NAMES) {
      const r = manifestLib.validateSite({ pages: [{ slug: 'p', blocks: [{ type, data: { headline: 'H', bg: n } }] }] });
      const mine = r.problems.filter((p) => p.includes(`("${type}")`));
      ok(!mine.length, `${type} bg=${n}：${mine.join(' | ')}`);
    }
  }
  // 对照：同一个调用，写一个不合法的值必须报 —— 否则上面那几格是空的。
  const r = manifestLib.validateSite({ pages: [{ slug: 'p', blocks: [{ type: 'hero', data: { headline: 'H', bg: 'brand-pale' } }] }] });
  ok(r.problems.some((p) => p.includes('("hero")') && p.includes('bg')), 'bg=brand-pale 没被报，这一格的尺子是空的');
});

// ══ AC1 渲染：真的 Apply 那条路 ═══════════════════════════════════════════════════════════════════
console.log('AC1 渲染（主题 × 配色 × 色相，custom.css 是 buildCustomCss 真写出来的）');
{
  const bad = [];
  let cells = 0;
  for (const [themeName, theme] of Object.entries(POOL)) {
    const base = tweaks.baseVarsFrom(theme.colors).vars;
    for (const palette of [null, ...Object.keys(PALETTES)]) {
      const colors = palette ? PALETTES[palette].colors : theme.colors;
      for (const hue of HUES) {
        const css = tweaks.buildCustomCss(base, { hueShift: hue }, palette ? presetVars({ palette }) : undefined);
        const vars = varsFromCss(base, css);
        for (const n of NAMES) {
          cells += 1;
          const got = paint(n, vars);
          const want = SPEC[n].stops.map(([g, s]) => tweaks.shiftHue(colors[g][s], hue).toLowerCase());
          const ends = got.length === 1 ? [hex(got[0].rgb)] : [hex(got[0].rgb), hex(got[got.length - 1].rgb)];
          if (JSON.stringify(ends) !== JSON.stringify(want)) bad.push(`${themeName}/${palette || '主题自带'}/色相${hue}/${n}: ${ends} ≠ ${want}`);
        }
      }
    }
  }
  check(`AC1 每一格都画成那套配色的那几档（${cells} 格）`, () => ok(cells > 0 && !bad.length, `${bad.length} 格不对，例：${bad.slice(0, 3).join(' · ')}`));
}

// ══ AC4 对比度 ════════════════════════════════════════════════════════════════════════════════════
console.log('AC4 对比度（配色 6 套 + 池里主题 × 新底 × 色相每一档）');
/** 各档字色：浅底上是 Webpixels 的正文色 / 灰字（`site-css.js` 的 `$body-secondary-color`），深底上是 §DEEP_COMMON / §ON_DEEP_MUTED 那几档白。 */
const INKS = {
  light: [['正文 #525252', [82, 82, 82], 1], ['灰字 rgba(#525252,.9)', [82, 82, 82], 0.9]],
  dark: [['白', [255, 255, 255], 1], ['白 .92', [255, 255, 255], 0.92], ['白 .85', [255, 255, 255], 0.85]],
};
/** 一个底色表达式在一套颜色、全部色相上，某套字色里最差的那个读数。 */
function worst(bgOf, colors, tone) {
  let w = null;
  for (const hue of HUES) {
    const vars = {};
    for (const [g, shades] of Object.entries(colors)) for (const [s, v] of Object.entries(shades)) vars[`--color-${g}-${s}`] = tweaks.shiftHue(v, hue);
    for (const { rgb } of bgOf(vars)) {
      for (const [ink, fg, a] of INKS[tone]) {
        const declared = fg.map((v, i) => Math.round(v * a + rgb[i] * (1 - a)));
        const ratio = TC.contrast(TC.mixBytes(declared, rgb, TC.PAINT_BLEND), rgb);
        if (!w || ratio < w.ratio) w = { ratio, ink, hue, bg: hex(rgb) };
      }
    }
  }
  return w;
}
for (const n of NAMES) {
  const rows = SETS.map(([set, colors]) => [set, worst((vars) => paint(n, vars), colors, SPEC[n].tone)]);
  const low = rows.reduce((a, b) => (b[1].ratio < a[1].ratio ? b : a));
  check(`AC4 ${n}：${SETS.length} 套 × ${HUES.length} 档色相，最低 ${low[1].ratio.toFixed(2)}（${low[0]} · ${low[1].ink} · 色相 ${low[1].hue} · 底 ${low[1].bg}）≥ ${TC.MIN_CONTRAST}`, () => {
    const under = rows.filter(([, r]) => r.ratio < TC.MIN_CONTRAST);
    ok(!under.length, under.map(([s, r]) => `${s} ${r.ratio.toFixed(2)}（${r.ink} @ 色相 ${r.hue}）`).join(' · '));
  });
}
check('AC4 阳性对照：同一把尺压在点缀色 500 实心底上，浅字深字都红（本票不做它的理由；尺子不红这一节就是空的）', () => {
  const accent500 = (vars) => TC.backgroundColours({ color: 'var(--color-accent-500)' }, vars);
  for (const tone of ['light', 'dark']) {
    const r = SETS.map(([set, colors]) => worst(accent500, colors, tone)).reduce((a, b) => (b.ratio < a.ratio ? b : a));
    ok(r.ratio < TC.MIN_CONTRAST, `${tone} 那套字在点缀色 500 上最低 ${r.ratio.toFixed(2)}，没红`);
  }
});

// ══ AC4 色板 ══════════════════════════════════════════════════════════════════════════════════════
console.log('AC4 色板');
const COLOURED = ['#e0f2fe', '#7d52f4', '#f7b733', '#0ea5e9', '#6366f1'];
/** 写死的格子只能是中性底（白 / 浅灰 / 两档深，加深灰渐变的第二个色标）—— PM 2026-10-11 的角色判据，不是饱和度阈值。 */
const NEUTRAL = ['#ffffff', '#f1f5f9', '#1e293b', '#0f172a', '#334155'];
const hexesIn = (v) => (JSON.stringify(v).match(/#[0-9a-fA-F]{6}/g) || []).map((h) => h.toLowerCase());
check('AC4 swatches / GRADIENT_SWATCHES 里没有正文点名的那 5 个着色值', () => {
  const hits = [...hexesIn(SHARED.bg.swatches), ...hexesIn(C.GRADIENT_SWATCHES)].filter((h) => COLOURED.includes(h));
  ok(!hits.length, `还在：${hits.join(' ')}`);
});
check('AC4 色板里写死的十六进制全是中性底', () => {
  const odd = [...hexesIn(SHARED.bg.swatches), ...hexesIn(C.GRADIENT_SWATCHES)].filter((h) => !NEUTRAL.includes(h));
  ok(!odd.length, `不是中性底：${odd.join(' ')}`);
});
check('AC4 色板以跟主题走的为主：单色排在最前的是 brand-soft / accent-soft / brand，预设渐变前两档是 soft-gradient / deep-gradient', () => {
  ok(JSON.stringify(SHARED.bg.swatches.slice(0, 3)) === JSON.stringify(['brand-soft', 'accent-soft', 'brand']), `swatches = ${SHARED.bg.swatches}`);
  ok(JSON.stringify(C.GRADIENT_SWATCHES.slice(0, 2)) === JSON.stringify(['soft-gradient', 'deep-gradient']), `GRADIENT_SWATCHES = ${JSON.stringify(C.GRADIENT_SWATCHES)}`);
  for (const v of [...SHARED.bg.swatches, ...C.GRADIENT_SWATCHES]) ok(C.isColorValue(v), `色板上这一格过不了校验：${JSON.stringify(v)}`);
});

// ══ AC2 建站提示词 ════════════════════════════════════════════════════════════════════════════════
console.log('AC2 建站提示词');
{
  const EXPECTED = ['blog', 'contact', 'content', 'cta', 'faq', 'features', 'gallery', 'hero', 'logos', 'milestones', 'page-header', 'reviews', 'team', 'testimonials'];
  // create-site 的块菜单就是这两段（`create-site.js` 里两处 `blockPromptSection(...)`）。
  const text = [manifestLib.promptSection('homepage'), manifestLib.promptSection('page-specific')].join('\n');
  const entries = new Map();
  for (const chunk of text.split(/\n(?=- ")/)) {
    const m = /^- "([^"]+)"/.exec(chunk);
    if (m) entries.set(m[1], chunk);
  }
  const THEME_LINE = 'bg?: "brand-soft" | "accent-soft" | "soft-gradient" | "deep-gradient" | "brand"';
  const withSentence = [...entries].filter(([, c]) => c.includes('bg is the background colour')).map(([t]) => t).sort();
  const withTheme = [...entries].filter(([, c]) => c.includes(THEME_LINE) && /only when the owner asks for that exact colour/.test(c)).map(([t]) => t).sort();
  check(`AC2 带「bg is the background colour」那句话的块 == 正文那 14 个（读到 ${withSentence.length} 个）`, () => {
    ok(JSON.stringify(withSentence) === JSON.stringify(EXPECTED), `实际 ${withSentence.join(' ')}`);
  });
  check(`AC2 这 14 个块的提示词都列出主题色写法 + 「只有老板要具体颜色才写十六进制」（读到 ${withTheme.filter((t) => EXPECTED.includes(t)).length} 个）`, () => {
    const missing = EXPECTED.filter((t) => !withTheme.includes(t));
    ok(!missing.length, `没取到：${missing.join(' ')}`);
  });
  check('AC2 主题色写法排在十六进制前面（提示词里先出现的是名字）', () => {
    const c = entries.get('hero');
    ok(c && c.indexOf('"brand-soft"') >= 0 && c.indexOf('"brand-soft"') < c.indexOf('"#rrggbb"'), 'hero 那一行里名字不在十六进制前面');
  });
}

// ══ r2：pricing 的高亮色（featuredColor）不收三种浅的 ══════════════════════════════════════════════════
// PM 2026-10-11 14:34 退回：`featuredColor` 的值还当勾号 / 描边的字色（`--pr-fc-ink`，`featured=outline` 时压在白卡上），
// 浅的三种压白只有 1.04–1.09。它跟 bg 不是同一种用途 ⟹ 提示词不教、色板不给；正文只管背景，「高亮色要不要跟主题走」不在本票。
console.log('r2 pricing featuredColor');
{
  const PALE = ['brand-soft', 'accent-soft', 'soft-gradient'];
  const pricing = manifestLib.loadManifests().get('pricing');
  const field = (slot) => require('./lib/editor-schema.js').fieldsOf(pricing).find((f) => f.slot === slot);
  const line = (() => {
    const t = manifestLib.promptSection('page-specific') + manifestLib.promptSection('homepage');
    const chunk = t.split(/\n(?=- ")/).find((c) => c.startsWith('- "pricing"')) || '';
    const at = chunk.indexOf('featuredColor?:');
    return at < 0 ? '' : chunk.slice(at).split(/,\s+[A-Za-z]+\??:\s/)[0];
  })();
  check(`r2 建站提示词里 featuredColor 那一段不提三种浅的（读到：${line.slice(0, 80)}…）`, () => {
    ok(line.startsWith('featuredColor?:'), 'pricing 的提示词里没找到 featuredColor —— 这一格读空了');
    const hit = PALE.filter((n) => line.includes(`"${n}"`));
    ok(!hit.length, `提示词还在教：${hit.join(' ')}`);
  });
  check('r2 编辑器色板：featuredColor 的纯色 + 预设渐变里没有三种浅的；bg 那一格照旧有（对照，证明这格读的是同一份 schema）', () => {
    const f = field('featuredColor');
    const b = field('bg');
    ok(f && b, 'pricing 的 featuredColor / bg 字段没取到');
    const offered = [...f.swatches, ...f.gradients].filter((v) => typeof v === 'string');
    const hit = PALE.filter((n) => offered.includes(n));
    ok(!hit.length, `featuredColor 色板还给：${hit.join(' ')}`);
    ok(PALE.every((n) => [...b.swatches, ...b.gradients].includes(n)), `bg 色板缺了浅的：${JSON.stringify([...b.swatches, ...b.gradients])}`);
  });
  // 勾号的颜色 = Section.tsx §featuredVars 的 ink：对象取第一个色标，具名渐变取 §bgCss 串里第一个变量，纯色就是它自己。
  // 门槛 3：勾号是图形不是正文（WCAG 1.4.11 非文字 3:1）。只量跟主题走的名字 —— 写死的四个纯色和 brand 是存量，本票不动。
  const inkWorst = (name) => {
    const css = C.bgCss(name);
    const ref = (css.match(/var\(--[a-z0-9-]+\)/) || [css])[0];
    let w = null;
    for (const [set, colors] of SETS) {
      for (const hue of HUES) {
        const vars = {};
        for (const [g, shades] of Object.entries(colors)) for (const [sh, v] of Object.entries(shades)) vars[`--color-${g}-${sh}`] = tweaks.shiftHue(v, hue);
        for (const { rgb } of TC.backgroundColours({ color: ref }, vars)) {
          const r = TC.contrast(rgb, [255, 255, 255]);
          if (!w || r < w.r) w = { r, set, hue };
        }
      }
    }
    return w;
  };
  const f = field('featuredColor');
  const offeredNames = f ? [...f.swatches, ...f.gradients].filter((v) => C.isThemeBg && C.THEME_BGS[v]) : [];
  check(`r2 featuredColor 色板上跟主题走的每一档（${offeredNames.join(' / ') || '无'}），勾号压白在 ${SETS.length} 套 × ${HUES.length} 档色相上都 ≥ 3`, () => {
    ok(offeredNames.length, '一档都没有 —— 这一格是空的');
    const under = offeredNames.map((n) => [n, inkWorst(n)]).filter(([, w]) => w.r < 3);
    ok(!under.length, under.map(([n, w]) => `${n} ${w.r.toFixed(2)}（${w.set} 色相 ${w.hue}）`).join(' · '));
  });
  check('r2 阳性对照：同一把尺量三种浅的，压白都 < 3（尺子不红这一节就是空的）', () => {
    const notRed = PALE.map((n) => [n, inkWorst(n)]).filter(([, w]) => w.r >= 3);
    ok(!notRed.length, notRed.map(([n, w]) => `${n} 最低也有 ${w.r.toFixed(2)}`).join(' · '));
  });
  // 走真入口 `loadManifests`（create-site / sync-config 用的那个），在临时目录里造一份 blocks/ 再弄坏 —— 同 block-manifest.test.js ⑫。
  check('r2 manifest 的 gradients 写歪了当场拒（不是数组 / 空数组 / 某一档不合法 / 给了非颜色槽），原样那份照过', () => {
    const fs = require('fs');
    const os = require('os');
    const load = (mutate) => {
      const root = fs.mkdtempSync(path.join(os.tmpdir(), 'tb-'));
      try {
        fs.cpSync(path.join(__dirname, '..', 'blocks'), path.join(root, 'blocks'), { recursive: true });
        const mp = path.join(root, 'blocks', 'pricing', 'manifest.json');
        const d = JSON.parse(fs.readFileSync(mp, 'utf-8'));
        mutate(d);
        fs.writeFileSync(mp, JSON.stringify(d, null, 2));
        try { manifestLib.loadManifests(path.join(root, 'blocks')); return null; } catch (e) { return e.message; }
      } finally { fs.rmSync(root, { recursive: true, force: true }); }
    };
    const base = load(() => {});
    ok(base === null, `原样复制一份就报了，夹具不成立：${base}`);
    for (const g of ['deep-gradient', [], ['brand-pale'], [{ stops: ['#fff'] }]]) {
      const err = load((d) => { d.slots.featuredColor.gradients = g; });
      ok(err && err.includes('gradients'), `gradients=${JSON.stringify(g)} 没被拒（${err}）`);
    }
    const err = load((d) => { d.slots.headline = { ...d.slots.headline, gradients: ['deep-gradient'] }; });
    ok(err && err.includes('gradients'), `非颜色槽带 gradients 没被拒（${err}）`);
  });
}

// ══ #1717 写歪时回给建站 AI 的那句话 ═══════════════════════════════════════════════════════════════
// 那句话列几种写法，AI 就照着改成哪种；少列了主题名字，它就改写十六进制，这个站的背景从此不跟主题换。
console.log('#1717 颜色槽写歪时的报文');
{
  const messageFor = (bg) => {
    const r = manifestLib.validateSite({ pages: [{ slug: 'p', blocks: [{ type: 'hero', data: { headline: 'H', bg } }] }] });
    return r.problems.filter((p) => p.includes('("hero")') && p.includes(JSON.stringify(bg))).join('\n');
  };
  check('#1717 AC1 bg="brandsoft" ⟹ 报文里四个主题名字和 #rrggbb 都在（名字照正文抄，不从 contrast.js 读）', () => {
    const msg = messageFor('brandsoft');
    ok(msg, 'bg="brandsoft" 没被报，这一格的尺子是空的');
    const missing = [...NAMES, '#rrggbb'].filter((n) => !msg.includes(n));
    ok(!missing.length, `报文里缺 ${missing.join(' / ')}：${msg}`);
  });
  check('#1717 AC3 往 THEME_BGS 临时加一个名字 ⟹ 报文跟着多它一个；删掉 ⟹ 报文复原（名字不是手抄进报文的）', () => {
    const extra = 'probe-1717-bg';
    const before = messageFor('brandsoft');
    ok(!before.includes(extra), `加之前报文里就有 ${extra}`);
    C.THEME_BGS[extra] = { css: 'var(--color-primary-100)', tone: 'light' };
    let during;
    try { during = messageFor('brandsoft'); } finally { delete C.THEME_BGS[extra]; }
    const after = messageFor('brandsoft');
    console.log(`     加之前：${before.split('——')[1]}\n     加之后：${during.split('——')[1]}`);
    ok(during.includes(JSON.stringify(extra)), `加了 ${extra} 报文没跟：${during}`);
    ok(after === before, `删掉之后报文没复原：${after}`);
  });
}

console.log(`\n══ 汇总: 通过 ${pass} · 失败 ${fail} ══`);
process.exit(fail ? 1 : 0);
