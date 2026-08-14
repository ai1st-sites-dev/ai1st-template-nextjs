#!/usr/bin/env node
// ══════════════════════════════════════════════════════════════════════════════════════════════════
// generate.js — 生成候选主题（#1004，spec §7.1 的「生成一套主题」那一步）
// ══════════════════════════════════════════════════════════════════════════════════════════════════
//
// 🔴 这一版是**确定性**的，不调 AI。本票要建的是**流水线**（生成器 + 四道闸 + 图册），而流水线
// 「只依赖契约的格式，不依赖最终内容」（正文第一句）。用确定性生成器有三个实在的好处：
//   · 四道闸的每一格都能被**同一个输入**反复驱动 —— AC1/AC6 那种「该被拦的样本」必须可复现
//   · 跑一次不花钱、不等 30 秒，CI 里也跑得动
//   · 把「生成器」和「四道闸」的接缝钉死：换成 AI 生成器时，只有这个文件被换掉
// 真正批量生成 N 套正式池是后续那张票的事（那时只是把这个文件换成调模型的版本再跑一次）。
//
//   node scripts/theme-pipeline/generate.js --count 3 --out /tmp/candidates
const fs = require('fs');
const path = require('path');

// 色相 → 十档色阶。HSL 转 hex，饱和度和亮度曲线照抄注册表里既有主题的手感
// （50 很浅、500 是主色、900 很深），这样生成出来的调色板与人手写的那 30 套是同一类东西。
function hslToHex(h, s, l) {
  const a = s * Math.min(l, 1 - l);
  const f = (n) => {
    const k = (n + h / 30) % 12;
    const c = l - a * Math.max(-1, Math.min(k - 3, Math.min(9 - k, 1)));
    return Math.round(255 * c).toString(16).padStart(2, '0');
  };
  return `#${f(0)}${f(8)}${f(4)}`;
}
const SHADES = { 50: 0.96, 100: 0.9, 200: 0.82, 300: 0.7, 400: 0.6, 500: 0.5, 600: 0.42, 700: 0.34, 800: 0.26, 900: 0.16 };
function rampFor(hue, sat, keys) {
  const out = {};
  for (const k of keys) out[k] = hslToHex(hue, sat, SHADES[k]);
  return out;
}

// 🔴 非通用字体族一律**带引号**。这些名字最后被 `layout.tsx` 的 `join(', ')` 拼成 `--font-sans` /
// `--font-heading` 的值，而 CSS 里一个不带引号的字体族是一串标识符 —— 标识符不能以数字开头，所以
// `Source Sans 3` 里那个 `3` 让**整条 `font-family` 声明非法，浏览器把它整个丢掉**。实测（QA1 在
// #1004 r1 抓的，QA2 在一次全新的跑里独立重现）：第三套的正文渲染成 `Times New Roman` —— 不是这套
// 主题的字体，也不是浏览器的锅，是这个拼法。加引号后计算值就是声明的那串。
// 📌 注册表里 `earth-tone` / `golden-yellow` 两套有同样的写法（`themes.js:243` / `:293`，也就是今天
// 真站的正文字体就是 Times New Roman）。那是本票范围之外的存量数据，交作者定夺（QA1 也这么判的），
// 这里只保证**生成器自己**产不出这个形状。
const GENERIC_FAMILIES = new Set(['serif', 'sans-serif', 'monospace', 'cursive', 'fantasy',
  'system-ui', 'ui-serif', 'ui-sans-serif', 'ui-monospace', 'ui-rounded', 'math', 'emoji']);
const quoted = (names) => names.map((n) => (GENERIC_FAMILIES.has(n) ? n : `"${n}"`));

const FONT_PAIRS = [
  { heading: quoted(['Fraunces', 'Georgia', 'serif']), body: quoted(['Inter', 'system-ui', 'sans-serif']), url: 'https://fonts.googleapis.com/css2?family=Fraunces:wght@400;600;700&family=Inter:wght@400;500;600;700&display=swap' },
  { heading: quoted(['Space Grotesk', 'system-ui', 'sans-serif']), body: quoted(['IBM Plex Sans', 'system-ui', 'sans-serif']), url: 'https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@500;600;700&family=IBM+Plex+Sans:wght@400;500;600&display=swap' },
  { heading: quoted(['Playfair Display', 'Georgia', 'serif']), body: quoted(['Source Sans 3', 'system-ui', 'sans-serif']), url: 'https://fonts.googleapis.com/css2?family=Playfair+Display:wght@500;600;700&family=Source+Sans+3:wght@400;500;600&display=swap' },
];

// 受限 CSS 的样板。🔴 只用契约 §1 的钩子、只用 §2 白名单里的属性、**颜色一律走变量**
// （#1003 那条「不许字面色值」）。三种排布轮换 —— 图在左 / 图在上 / 只有字。
const SHEET_TEMPLATES = [
  { layout: 'with-media-left', css: `.hero {
  display: grid;
  grid-template-columns: 1fr;
  gap: 2rem;
  padding: 3rem 1.5rem;
  background-color: var(--color-primary-900);
  color: var(--color-primary-50);
}

@media (min-width: 1024px) {
  .hero { grid-template-columns: 5fr 6fr; align-items: center; gap: 3.5rem; padding: 4.5rem 3rem; }
}

.hero__media { order: 2; aspect-ratio: 4 / 3; width: 100%; border-radius: 1.25rem; background-color: var(--color-primary-800); }
.hero__body { order: 3; max-width: 34rem; }
.hero__title { font-size: 2.5rem; line-height: 1.1; font-weight: 700; color: var(--color-primary-50); }
.hero__sub { margin-top: 1.25rem; font-size: 1.0625rem; line-height: 1.7; color: var(--color-primary-100); }
.hero__cta { margin-top: 2rem; }
.hero__deco { order: 1; grid-column: 1 / -1; height: 0.375rem; background-color: var(--color-accent-500); }
` },
  { layout: 'with-media-top', css: `.hero {
  display: grid;
  gap: 0;
  padding: 0 0 3rem;
  background-color: var(--color-primary-50);
  color: var(--color-primary-900);
  text-align: center;
}

.hero__media { order: 1; width: 100%; height: 15rem; background-color: var(--color-primary-100); }
.hero__deco { order: 2; width: 4rem; height: 0.25rem; margin: 2rem auto 0; background-color: var(--color-accent-500); }
.hero__body { order: 3; max-width: 44rem; margin: 0 auto; padding: 1.25rem 1.5rem 0; }
.hero__title { font-size: 2.25rem; line-height: 1.2; font-weight: 700; color: var(--color-primary-900); }
.hero__sub { margin-top: 1rem; font-size: 1rem; line-height: 1.75; color: var(--color-primary-800); }
.hero__cta { margin-top: 1.75rem; justify-content: center; }
` },
  { layout: 'text-only', css: `.hero {
  display: grid;
  gap: 1.5rem;
  padding: 4rem 1.5rem;
  background-color: var(--color-primary-800);
  color: var(--color-primary-50);
}

.hero__media { order: 4; display: none; }
.hero__deco { order: 1; width: 5rem; height: 0.25rem; background-color: var(--color-accent-400); }
.hero__body { order: 2; max-width: 40rem; }
.hero__title { font-size: 3rem; line-height: 1.05; font-weight: 800; letter-spacing: -0.02em; color: var(--color-primary-50); }
.hero__sub { margin-top: 1.5rem; font-size: 1.125rem; line-height: 1.7; color: var(--color-primary-100); }
.hero__cta { margin-top: 2.25rem; }
` },
];

/** 生成 n 套候选。同一个 seed 出同一批 —— 闸的每一格都要能被同一个输入反复驱动。 */
function generateCandidates(n = 3, { seed = 7, outDir } = {}) {
  const out = [];
  for (let i = 0; i < n; i += 1) {
    const hue = (seed * 47 + i * 113) % 360;
    const accentHue = (hue + 150 + i * 17) % 360;
    const fonts = FONT_PAIRS[i % FONT_PAIRS.length];
    const tpl = SHEET_TEMPLATES[i % SHEET_TEMPLATES.length];
    const id = `gen-${String(seed).padStart(2, '0')}-${i + 1}`;
    const tokens = {
      colors: {
        primary: rampFor(hue, 0.55, Object.keys(SHADES)),
        accent: rampFor(accentHue, 0.6, ['50', '100', '200', '300', '400', '500', '600']),
      },
      fonts: { heading: fonts.heading, body: fonts.body, googleFontsUrl: fonts.url },
      // 数值形状（#1003）——生成的主题用它，因为每站微扰是整套缩放（#1006）。
      settings: {
        radius: [4, 12, 20][i % 3],
        density: [0.9, 1, 1.2][i % 3],
        shadowStrength: [0.08, 0.14, 0.2][i % 3],
        buttonShape: ['rounded', 'pill', 'square'][i % 3],
      },
    };
    const sheet = `/* theme-css-contract: v1\n   ${id} — generated by scripts/theme-pipeline/generate.js (#1004). */\n\n${tpl.css}`;
    const entry = { id, tokens, layout: { hero: tpl.layout }, sheet };
    if (outDir) {
      fs.mkdirSync(outDir, { recursive: true });
      entry.sheetPath = path.join(outDir, `${id}.css`);
      fs.writeFileSync(entry.sheetPath, sheet);
      fs.writeFileSync(path.join(outDir, `${id}.tokens.json`), `${JSON.stringify(tokens, null, 2)}\n`);
      // 🔴 版式**不进** tokens 文件（tokens 有自己的 schema，多一个键就该被第一道闸点名），但也不能
      // 只活在内存里：`run.js --candidates` 从磁盘读回候选，第一版因此把 layout 当 `{}`，第三道闸
      // 的版式那一项永远没得比（QA2 在 r2 量到的那件事的一半）。它自己一个文件。
      fs.writeFileSync(path.join(outDir, `${id}.layout.json`),
        `${JSON.stringify(entry.layout, null, 2)}\n`);
    }
    out.push(entry);
  }
  return out;
}

if (require.main === module) {
  const argv = process.argv.slice(2);
  const arg = (name, dflt) => {
    const i = argv.indexOf(name);
    return i >= 0 ? argv[i + 1] : dflt;
  };
  const cands = generateCandidates(Number(arg('--count', 3)), {
    seed: Number(arg('--seed', 7)), outDir: arg('--out', undefined),
  });
  console.log(cands.map((c) => `${c.id}  ${c.layout.hero}  primary-500 ${c.tokens.colors.primary['500']}`).join('\n'));
}

module.exports = { generateCandidates };
