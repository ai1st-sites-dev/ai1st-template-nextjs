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

// 🔴 调色板（色阶怎么算、为什么要为按钮压亮度）住在 `palette.js`，只有那一个定义 ——
// `sheet-recipes.js` 挑字色时要按**这套候选真实的颜色**算对比度（r4），而它不能反过来 require
// 这个文件（成环）。两处各算一遍同一件事就会分叉，这条流水线为此付过账（见 `heroLayoutFor`）。
const { paletteFor } = require('./palette.js');

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
  // 🔴 第 4、5 对是 #1051 加的，而加它们是为了**数量**不是为了好看：只有 3 对时，第 i 套与第 i+3 套
  // 的字体逐字相同，那 0.2 的权重在相似度闸里永远满分（实测见 AC4 的读数）。5 与下面那几个模数互质。
  { heading: quoted(['Bricolage Grotesque', 'system-ui', 'sans-serif']), body: quoted(['Public Sans', 'system-ui', 'sans-serif']), url: 'https://fonts.googleapis.com/css2?family=Bricolage+Grotesque:wght@500;600;700&family=Public+Sans:wght@400;500;600&display=swap' },
  { heading: quoted(['Libre Baskerville', 'Georgia', 'serif']), body: quoted(['Karla', 'system-ui', 'sans-serif']), url: 'https://fonts.googleapis.com/css2?family=Libre+Baskerville:wght@400;700&family=Karla:wght@400;500;600;700&display=swap' },
  // 🔴 第 6、7 对是 r3 加的，理由同上一条但更具体：**5 整除 45**。字体档周期 5、hero 版式周期 9
  // ⟹ 第 i 套与第 i+45 套的字体和版式两项**同时**满分，那是 0.4 的权重白送，剩下的 colour + settings
  // 再怎么散也压不到 0.9 以下（实测那五对是 0.896–0.905，全部贴着线）。7 不整除 45，那五对的字体
  // 从此不同；下一次两项同时撞回来要走到 lcm(7, 9) = 63。
  { heading: quoted(['Outfit', 'system-ui', 'sans-serif']), body: quoted(['Work Sans', 'system-ui', 'sans-serif']), url: 'https://fonts.googleapis.com/css2?family=Outfit:wght@500;600;700&family=Work+Sans:wght@400;500;600&display=swap' },
  { heading: quoted(['Lora', 'Georgia', 'serif']), body: quoted(['Nunito Sans', 'system-ui', 'sans-serif']), url: 'https://fonts.googleapis.com/css2?family=Lora:wght@500;600;700&family=Nunito+Sans:wght@400;500;600&display=swap' },
];

// 每套候选的受限 CSS 由 `sheet-recipes.js` 出（#1051）。🔴 在它之前这里是三段写死的 hero CSS，
// 于是候选只画 hero 一个块 —— 实测 7/213 钩子 · 1/34 块，而三套实证表是 213/213 · 34/34，
// 准入闸②会把「页面上出现、这套主题表里没有」的钩子逐个点名 ⟹ #1016 照那个跑一套都进不了池。
// 版式那个名字仍然从这里出（`layout.json` 写的就是它），配方模块与它共用同一份清单。
const { sheetFor, layoutNamesFor } = require('./sheet-recipes.js');

/** 生成 n 套候选。同一个 seed 出同一批 —— 闸的每一格都要能被同一个输入反复驱动。 */
function generateCandidates(n = 3, { seed = 7, outDir } = {}) {
  const out = [];
  for (let i = 0; i < n; i += 1) {
    // 🔴 每一档各用一个**互质的**模数（5 · 4 · 3 · 5 · 3），而不是一起 `% 3`。一起用同一个模数时，
    // 整组参数每 3 套就原样重复一次；互质之后要走到 lcm = 60 套才第一次整组重复，而 #1016 要的是
    // 60-80 套。这是本票唯一一处不在「画满 34 个块」射程里的改动，理由写在 AC4 的读数里。
    const fonts = FONT_PAIRS[i % FONT_PAIRS.length];
    const id = `gen-${String(seed).padStart(2, '0')}-${i + 1}`;
    const tokens = {
      // 色相怎么排、色阶怎么压，全在 `palette.js`；`sheet-recipes.js` 挑字色时也从同一个函数取（r4）。
      colors: paletteFor(i, seed),
      fonts: { heading: fonts.heading, body: fonts.body, googleFontsUrl: fonts.url },
      // 数值形状（#1003）——生成的主题用它，因为每站微扰是整套缩放（#1006）。
      // 🔴 这几档的模数要**除不尽 45**（r3 改的）。字体档周期 5、hero 版式周期 9 ⟹ 第 i 套与第
      // i+45 套的「字体」和「版式」两项必然满分，于是那一对能不能过线全压在 colour + settings 上。
      // 而 `% 3` 与 `% 5` 都整除 45 ⟹ 那两项在 45 距离上也相同，settings 只剩 radius 一项在动
      // （相似度 0.67）。实测：r2 那批 80 套里 i↔i+45 的五对是 0.896–0.898，贴着 0.9 那条线；
      // r3 为了按钮可读性压了一点色阶的亮度范围（见上面 §rampFor），colour 从 0.89 抬到 0.90，
      // 那五对当场全部越线（被拦 10/80）。把 density 换成 4 档、shadowStrength 换成 6 档之后，
      // 45 距离上这两项都不同（45%4=1 · 45%6=3），settings 相似度掉下来，最像的一对回到 0.85 以下。
      // 取值范围仍在 schema 里（density 0.6–1.6 · shadowStrength 0–0.4，见 schemas/theme-tokens.schema.json）。
      settings: {
        radius: [4, 10, 16, 22][i % 4],
        density: [0.85, 0.95, 1.05, 1.2][i % 4],
        shadowStrength: [0.06, 0.1, 0.14, 0.18, 0.22, 0.26][i % 6],
        buttonShape: ['rounded', 'pill', 'square'][i % 3],
      },
    };
    const sheet = `/* theme-css-contract: v1\n   ${id} — generated by scripts/theme-pipeline/generate.js`
      + ` (#1004; all 34 blocks since #1051). */\n\n${sheetFor(i, seed)}`;
    // #1090 —— `layout` 现在带四个键，不再只有 hero。两件事挂在它上面：
    //   · `promote.js:91-93` 把 layout 的**每一个键**翻成 `theme-pool.json` 的 `supports` 清单，
    //     所以这里加一个键 = 池子那边自动多一项（AC1 要求的「两边都写」是这条路给的，不是手抄）；
    //   · 相似度闸的 `layout` 分项只比**两边都有**的键（`gates.js:459` 的 `lB.has(k)`）⟹ 漏写一个键
    //     等于这一族对闸不存在，两套画法完全不同的主题在那一维上照样满分。
    const entry = {
      id,
      tokens,
      layout: layoutNamesFor(i),
      sheet,
    };
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
  // 🔴 #1055 打磨批次 #16 条 8(来源 #1051)—— 两个入参都要校验,而理由不是「防手滑」。
  //
  // `Number('abc')` 是 NaN,而 NaN 一路走到底都不报错:调色算出来的每个值都是 NaN,
  // `#${NaN}${NaN}${NaN}` 拼成 `#NaNNaNNaN` 写进 tokens,然后**下游那把检查器说全场通过** ——
  // `ink-contrast.js` 打出「✅ 全场最低 NaN」,因为 `NaN < 门槛` 永远是 false。
  // 一个静默产出垃圾、而且让检查器说好话的入口,比一个报错的入口危险得多。
  // `--count 0` / `--count -3` 是同一族:循环一次都不转,rc=0,产出零套候选,输出是空的。
  //
  // 📌 第①道静态检查(`gates.js`)后来会拿 tokens 对 schema 把这种候选拒掉(`#NaNNaNNaN` 不符合
  //    `^#[0-9a-fA-F]{6}$`),所以垃圾进不了池 —— 但那是**下游**兜的,而且中间那一段(生成器自己的
  //    输出、ink-contrast 的判决)全是假读数。在入口拒绝,那一段就不存在。
  const num = (flag, dflt, check, what) => {
    const raw = arg(flag, undefined);
    if (raw === undefined) return dflt;
    const v = Number(raw);
    if (!Number.isFinite(v) || !check(v)) {
      console.error(`🔴 ${flag} ${JSON.stringify(raw)} 不是${what} —— 一套候选都没生成。`);
      process.exit(2);
    }
    return v;
  };
  const count = num('--count', 3, (v) => Number.isInteger(v) && v >= 1, '一个 ≥1 的整数');
  const seed = num('--seed', 7, (v) => Number.isInteger(v), '一个整数');
  const cands = generateCandidates(count, { seed, outDir: arg('--out', undefined) });
  console.log(cands.map((c) => `${c.id}  ${c.layout.hero}  primary-500 ${c.tokens.colors.primary['500']}`).join('\n'));
}

module.exports = { generateCandidates };
