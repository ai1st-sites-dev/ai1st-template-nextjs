#!/usr/bin/env node
/**
 * theme-presets.test.js — #1038 的绝对项：库本身合不合格，以及它跟 tweaks 叠起来产出什么字节。
 *
 *   node scripts/theme-presets.test.js       （CI 里由 `npm run test:scripts` 自动发现，
 *                                              .github/workflows/ci-cd.yml 的 template-scripts）
 *   退出码: 0 全过 · 1 有失败 · 2 跑不起来（**不许当成通过**）
 *
 * ── 这里管什么、不管什么 ────────────────────────────────────────────────────────────────────────
 * 管的是**不用起浏览器就能判死的那些**：策展的可读性判据、`@import` 在不在第一行、中性输入收敛、
 * 以及「绝对项没有渗进 `TWEAK_BOUNDS`」。
 *
 * 不管「页面上量出来的对比度」—— 那要真渲染，是 `theme-css-invariants.mjs` 的活（本票同时把它的
 * 射程从 hero 两行扩到按钮和链接）。两层的分工说在明处：**这里判的是配色表本身的算术**，
 * 那里判的是**这套算术装到真页面上之后眼睛看到的东西**。只有前者会漏掉「主题表自己把按钮改成别的
 * 颜色」，只有后者跑得慢。
 *
 * 🔴 为什么策展判据要写成测试而不是写成注释：下一个人加一组配色时，「白字压 primary-500 要够黑」
 *    这件事没有任何东西会提醒他。注册表里过不了这一关的**不是少数**，所以「随手抄一套好看的」是
 *    最自然的做法，也是会出事的那个做法。**真数读那一格自己印的那句**（第 ① 节末尾那个反向对照
 *    印的「注册表 N 套里报红 M 套」，分子分母都就地算）——这里原来写着「30 套里有 9 套」，
 *    2026-08-18 实测是 110 套里 11 套，写死的数会过期（#1072 / #1083 条 ④）。
 */

'use strict';

const presets = require('./theme-presets.js');
const tweaks = require('./tweaks.js');
const { RADIUS, BUTTON_SHAPE } = require('./theme-settings.js');

let pass = 0; let fail = 0;
const ok = (m) => { pass++; console.log(`  ✅ ${m}`); };
const bad = (m) => { fail++; console.log(`  ❌ ${m}`); };
// ⚠️ = 看得见但不拦。只给【已经成真、而治它要真浏览器重取一份数据】那一类用（#1096 B8）—— 它不计进 pass/fail，
// 所以不许拿它当“软红”去包底任何判据；这一句的存在本身就是一个该被清掉的债。
const warn = (m) => { console.log(`  ⚠️  ${m}`); };
const die = (m) => { console.error(`🔴 跑不起来: ${m}`); process.exit(2); };

for (const name of ['PRESET_GROUPS', 'PRESET_KEYS', 'presetOptions', 'validatePresets', 'presetVars', 'normalisePresets']) {
  if (presets[name] === undefined) die(`theme-presets.js 没导出 ${name}`);
}
if (typeof tweaks.buildCustomCss !== 'function') die('tweaks.js 没导出 buildCustomCss');

// ── 分母自检 ──────────────────────────────────────────────────────────────────────────────────
// 空表会让下面每一格都空过。先把三组各有几项打出来，读报告的人一眼看得见判的是多少个东西。
const counts = Object.entries(presets.presetOptions()).map(([k, v]) => `${k}=${v.length}`).join(' · ');
if (presets.PRESET_KEYS.length === 3 && Object.values(presets.presetOptions()).every((v) => v.length >= 3)) {
  ok(`三组预设都非空：${counts}`);
} else {
  bad(`预设组为空或少了一组（${counts}）—— 下面每一格都会空过`);
}

// ── ① 策展判据：每一组配色，三个按钮的字压底色都要 ≥ 4.5:1 ────────────────────────────────────
//
// 三处是从 globals.css 的 `@layer components` 里**现解出来的**：
//   `.btn-primary`   **算出来的字色**压**算出来的那一档底色**（hover 走**算出来的那一档**，一起判）
//   `.btn-secondary` **算出来的那一档**的字压白底（hover 是算出来的字色压 `--color-primary-500`）
//   `.btn-accent`    `gray-900`(#111827) 的字压 `--color-accent-400`（hover 走 `-500`，一起判）
//
// 🔴 #1091 —— 第一行的**底**此前写的是 `--color-primary-500`。做法 D 之后主按钮的底也是算出来的
//    （`--btn-primary-bg`，见下面 `COMPUTED_VARS` 与 `background-color:` 那一支），所以那半句和 #1084
//    改掉的字色那半句是同一个病：抄一个写死的档号，就会去判一个页面上不存在的配对。
//
// 🔴 #1084 —— 前两行此前写的是「白字压 primary-500」/「primary-500 的字压白底」。那张票把这两个按钮
//    的字色改成**跟着底色算**（白字不够时换纯黑；轮廓按钮沿调色板下挪一档），正本在
//    `scripts/lib/button-ink.js`。所以那两行现在描述的是一个页面上不存在的配对，两个方向都会错：
//    配色正确的站被判红、配色错误的站被判绿。解析器认 `var(--btn-*)` 这三个变量并在**当前这组配色上**
//    现算（见 `buttonPairsFromGlobals` 里 `COMPUTED_VARS` 那段），用的是生产同一个模块 —— 一把尺。
//
// 🔴 #1055 打磨批次 #16 条 9（来源 #1038 QA3）——「现解」这三个字是本批改出来的，此前那三行是
//    **抄在这个文件里的常量**，而 globals.css 那一头没有任何东西钉住它。QA3 在一次性树里把
//    `.btn-primary` 改成白字压 `primary-100`（一眼就读不出来的组合），**37 过 / 0 失败，照样全绿**。
//    主题表那一头早就是「每次现解配对 + md5 钉几何」（见下面 ⑨ 的 `judgeSheet`），只有 globals.css
//    这一头是手抄的 —— 而这个文件顶上那段自己写着「只有前者会漏掉『主题表自己把按钮改成别的颜色』」。
//    改成从文件里解，那句漏洞就不成立了：颜色搬到哪一档，判据就跟到哪一档。
const MIN = 4.5;
const WHITE = '#ffffff';
const GRAY900 = '#111827';

/**
 * 从 `src/app/globals.css` 的 `@layer components` 里解出按钮的「字压底」配对。
 *
 * 读的是 Tailwind 的 `@apply` 那一行（`bg-primary-500` / `hover:bg-primary-600` / `text-white` /
 * `text-gray-900`）。没写 `bg-*` 的按钮（`.btn-secondary`）压的是页面本身的白底 —— 那不是猜的，
 * 是 globals.css 自己在 `.hero__cta .btn-secondary` 那段注释里写的：它「written for a white page」，
 * 深色底上由 `currentColor` 接管，而 `currentColor` 取的是主题表给的颜色，属于下面 ⑨ 的地盘。
 *
 * 🔴 解不出来 = 跑不起来（die，退 2），不是「没有配对要判」。空的配对表会让 ① 和 ⑨ 的按钮那一段
 *    整节空过，而那正是本条要治的形状：一个什么都没判的判据长得跟全绿一模一样。
 *
 * 每一条是 `{ what, fg, bg }`，`fg`/`bg` 各是 `{ hex }`（字面色）或 `{ group, shade }`（跟着配色走
 * 的那一档）。`.btn-secondary` 因此是唯一一条 fg 是 token、bg 是字面白的。
 */
function buttonPairsFromGlobals() {
  const fs = require('fs');
  const path = require('path');
  const file = path.join(__dirname, '..', 'src', 'app', 'globals.css');
  let css;
  try { css = fs.readFileSync(file, 'utf8'); } catch { die(`读不到 ${file} —— 按钮那两节会整节空过`); }
  // Tailwind 默认色板里的字面色。按钮上今天只用得到这两个；第三种出现时下面会点名拒测。
  const LITERAL = { white: WHITE, 'gray-900': GRAY900 };
  const colourWord = /^(?:hover:)?(bg|text)-([a-z]+)(?:-(\d{2,3}))?$/;
  /** `bg-primary-500` → {group,shade}；`text-white` → {hex}；认不出来 → null */
  const specOf = (word) => {
    const m = word.match(colourWord);
    if (!m) return null;
    const [, , name, shade] = m;
    const key = shade ? `${name}-${shade}` : name;
    if (LITERAL[key]) return { hex: LITERAL[key], label: key };
    if (shade) return { group: name, shade, label: key };
    return null;
  };
  // 🔴 #1068 条 4 —— 认出一个 token 组之后还要问一句「那个组真的在调色板里吗」。
  //
  // `specOf` 只看**拼法**：`bg-slate-50` 与 `bg-primary-500` 在它眼里长得一样，都回 {group, shade}。
  // 而 `pairColours` 下一步做的是 `colors[s.group][s.shade]`，组不存在时那是 `undefined[shade]`
  // ⟹ TypeError ⟹ node 退 **1**。而 1 在这个脚本的契约上的意思是「某组配色不合格」（`bad()` 那条链），
  // 「跑不起来」保留给 **2**（`die`，见文件上面那个定义）。所以把 `text-gray-900` 手滑写成
  // `text-slate-50` 这种事，会被读成「库里有一组配色过不了 4.5:1」——仪器坏了和库不合格逐字相同。
  // 实测（#1055 QA1）：改前 rc=1，没有任何一句说是拼法的问题。
  //
  // 🔴 判据是「**每一组**调色板都有这个 group/shade」，不是「至少一组有」：下面那一圈对
  // `presets.PALETTES` 的每一组各算一次，缺一组就在那一组上炸。反向对照喂的注册表主题走的是
  // `pairColours` 里那道同族的判断（同一条理由，见那里）。
  //
  // 🔴 #1084 —— 本票加了第三种 spec（`{computed}`：字色/档位是**算出来的**），而这个函数原来只认
  // 「字面色」和「{group, shade}」两种。不给它一条路的话，`spec.group` 是 `undefined` ⟹
  // `pal.colors[undefined]` 恒为假 ⟹ **每一组都被报成缺** ⟹ 三个算出来的 spec 全进 `unknown` ⟹ die。
  // 也就是漏掉这一支的失败方向是 rc=2 恒红，不是静默 —— 但它红在「调色板里没有」这句假话上。
  // 算出来的那三档共同的输入只有一个：`primary-500`（`inkFor` 从它起算，两把梯子也都在 primary 上走），
  // 所以这里查的就是它。梯子上其余档位的缺席由 `hoverShadeFor` / `outlineShadeFor` 自己用
  // `typeof … === 'string'` 滤掉，取不到值的那一次由 `needShade` 答 2。
  const paletteSets = Object.entries(presets.PALETTES);
  // 🔴 #1100 —— 「算出来的」那几档不再**一律**以 `primary-500` 为输入：`.btn-accent` 的 hover 档是从
  // **accent** 那一组的 400 起算的（`button-ink.js` §accentHoverShadeFor）。写死成 primary-500 的话，
  // 一组只有 primary 没有 accent 的配色会走成 `undefined[shade]` ⟹ TypeError ⟹ node 退 1，而 1 在这个
  // 脚本的契约上的意思是「某组配色不合格」—— 仪器坏了会被读成库不合格（本文件自己在 #1055 上记过这条）。
  const INPUT_OF = { accentHoverShade: ['accent', '400'] };
  const whoLacks = (spec) => {
    if (spec.hex !== undefined) return '';          // 字面色，不查调色板
    const [group, shade] = spec.computed !== undefined
      ? (INPUT_OF[spec.computed] || ['primary', '500'])
      : [spec.group, spec.shade];
    const missing = paletteSets
      .filter(([, pal]) => !pal.colors[group] || pal.colors[group][shade] === undefined)
      .map(([name]) => name);
    if (!missing.length) return '';
    const what = spec.computed !== undefined ? `${spec.label} 要的 ${group}-${shade}` : spec.label;
    return `指的是调色板里没有的 ${what}（这些组没有它：${missing.slice(0, 3).join(' · ')}`
      + `${missing.length > 3 ? ` 等 ${missing.length} 组` : ''}）`;
  };

  // 🔴 `text-` 在 Tailwind 里管三件事：字号、对齐、颜色。`.btn-primary` 那一行同时写着 `text-base`
  //    和 `text-white`，取第一个命中的会取到字号 —— 第一版就是这么写的，三个按钮全部报「字色认不
  //    出来」。所以先把不是颜色的那些排掉，剩下的 `text-*` 必须是颜色（认不出来就拒测，不是跳过）。
  const NOT_A_COLOUR = /^text-(xs|sm|base|lg|\d?xl|left|center|right|justify|start|end|wrap|nowrap|balance|pretty|ellipsis|clip)$/;
  // 🔴 #1084 —— 按钮的字色不再是 `@apply` 里一个字面的 `text-white` 了：它是**算出来的**，从三个
  //    CSS 变量进来（`scripts/lib/button-ink.js` 是那段算术的正本，`sync-config.js` 按每个站最终生效
  //    的配色把值写进 `public/theme.css`）。所以这里多认一种 spec：`{computed}`，由 `pairColours`
  //    在**当前这组配色上**现算 —— 这一节因此量的是「这个按钮真的会用的那个字色」，而不是一个被
  //    冻在测试里的配对。
  //    📌 只改这份解析器就够，没动这一节任何一条判据：下面 `buttonRatios` / `judgeButtons` 拿到的
  //    仍是 `{what, fg, bg}`，只是 fg/bg 可以是「算出来的那一档」。
  //    🔴 认不出的变量名一律进 `unknown` ⟹ die，跟这个函数原来对认不出的 `text-*` 的处置同一条：
  //    「解不出来不是『没有配对要判』」。按钮上加第四个变量而忘了这里，会是一次大声失败。
  //    🔴 #1091 加了两个（`--btn-primary-bg` / `--btn-outline-hover-ink`），而上面那句「忘了这里会是
  //    一次大声失败」当场兑现了：只改 `globals.css` 不改这里，这个文件 rc=2 报
  //    「`.btn-secondary:hover` 的 color: var(--btn-outline-hover-ink, #fff) 认不出来」。
  const COMPUTED_VARS = {
    // #1091 —— 主按钮静止态的底，算出来的那一档（`button-ink.js` §baseShadeFor）。
    '--btn-primary-bg': { computed: 'baseShade', label: '算出来的主按钮底色' },
    '--btn-primary-ink': { computed: 'ink', label: '算出来的字色' },
    '--btn-primary-hover': { computed: 'hoverShade', label: '算出来的 hover 底色' },
    '--btn-outline-ink': { computed: 'outlineShade', label: '算出来的轮廓色' },
    // 🔴 #1100 —— `--btn-outline-hover-ink` **删了**：`.btn-secondary:hover` 现在直接用
    // `--btn-primary-bg` / `--btn-primary-ink` 那一对（底和字一起），所以上面那两条就是它的 spec，
    // 这里不再需要第三个。
    // #1100 —— `.btn-accent` 的 hover 底色：accent 那一组上算出来的那一档。
    '--btn-accent-hover': { computed: 'accentHoverShade', label: '算出来的 accent hover 底色' },
  };
  /** `color: var(--btn-primary-ink, #fff)` → 那条 spec；`var(--color-primary-500)` → {group,shade}。 */
  const specOfDecl = (value) => {
    const v = String(value).trim();
    const varName = (v.match(/^var\(\s*(--[a-z0-9-]+)/) || [])[1];
    if (!varName) return null;
    if (COMPUTED_VARS[varName]) return COMPUTED_VARS[varName];
    const tok = varName.match(/^--color-([a-z]+)-(\d{2,3})$/);
    if (tok) return { group: tok[1], shade: tok[2], label: `${tok[1]}-${tok[2]}` };
    return null;
  };
  const declOf = (body, prop) => {
    const re = new RegExp(`(?:^|[;{\\s])${prop}\\s*:\\s*([^;]+);`);
    const m = body.match(re);
    return m ? m[1] : null;
  };
  const pairs = [];
  const unknown = [];
  // `.btn-x { … }` 和 `.btn-x:hover { … }` 都要收 —— #1084 起 hover 的底色/字色写在自己那条规则里。
  //
  // 🔴 选择器必须**独占一行的开头**。写成 `/\.(btn-[a-z]+)(:hover)?\s*\{/` 会把
  // `.hero__cta .btn-secondary { color: currentColor }` 也算成 `.btn-secondary` 的规则，而这里按类名
  // 建索引 ⟹ 后出现的那条**覆盖**掉真正那条，于是 `.btn-secondary` 整个消失（实测：分母自检当场
  // die 在「解不到 .btn-secondary」上）。原来那版逐个 match 遍历、每个 match 各自 push，所以没有这
  // 个形状；改成按类名索引之后它就出现了 —— 索引的键必须能唯一指向一条规则。
  const blocks = new Map();
  for (const m of css.matchAll(/(?:^|\n)[ \t]*(\.btn-[a-z]+(?::hover)?)[ \t]*\{([^}]*)\}/g)) {
    blocks.set(m[1].slice(1), m[2]);
  }
  for (const [key, body] of blocks) {
    if (key.endsWith(':hover')) continue;          // hover 在它对应的静止态那一轮里一起处理
    const cls = key;
    const hoverBody = blocks.get(`${cls}:hover`) || '';
    const words = ((body.match(/@apply([^;]*);/) || [, ''])[1]).split(/\s+/).filter(Boolean);
    const textWord = words.find((w) => /^text-[a-z]+(-\d{2,3})?$/.test(w) && !NOT_A_COLOUR.test(w));
    const colourDecl = declOf(body, 'color');
    let fg = null;
    let fgSrc = '';
    if (textWord) {
      fg = specOf(textWord);
      fgSrc = `字色 ${textWord}`;
      if (!fg) { unknown.push(`.${cls} 的字色 ${textWord} 认不出来`); continue; }
    } else if (colourDecl) {
      fg = specOfDecl(colourDecl);
      fgSrc = `color: ${colourDecl.trim()}`;
      if (!fg) { unknown.push(`.${cls} 的 color: ${colourDecl.trim()} 认不出来`); continue; }
    } else {
      continue;                                    // 真的没写字色的不判
    }
    // 🔴 #1068 条 4 的守卫，织进本票的新形状（原来它只贴在 `specOf` 那一条路后面）：字色现在有
    // **两条**来路（`@apply` 的 `text-*` 与 `color:` 里的 `var()`），两条都要过这一问。少贴一条 =
    // 那条路上的「调色板里没有这个 token」重新读成 rc=1（某组配色不合格），而它是仪器坏了 rc=2。
    const fgMissing = whoLacks(fg);
    if (fgMissing) { unknown.push(`.${cls} 的${fgSrc} ${fgMissing}`); continue; }
    const bgWord = words.find((w) => /^bg-[a-z]+-\d{2,3}$/.test(w));
    const hoverWord = words.find((w) => /^hover:bg-[a-z]+-\d{2,3}$/.test(w));
    // #1084 —— hover 的底色/字色现在可能写在 `.btn-x:hover` 那条规则里。
    const hoverBgDecl = declOf(hoverBody, 'background-color');
    const hoverFgDecl = declOf(hoverBody, 'color');
    if (hoverBgDecl) {
      const hbg = specOfDecl(hoverBgDecl);
      if (!hbg) unknown.push(`.${cls}:hover 的 background-color: ${hoverBgDecl.trim()} 认不出来`);
      else {
        const hfg = hoverFgDecl ? specOfDecl(hoverFgDecl) : fg;
        if (hoverFgDecl && !hfg) unknown.push(`.${cls}:hover 的 color: ${hoverFgDecl.trim()} 认不出来`);
        // 🔴 #1068 条 4 的守卫也要贴在这条**本票新开的**路上（hover 的字/底写在 `.btn-x:hover`
        // 自己那条规则里）。这一支绕过上面那两处 `whoLacks` ⟹ 不贴的话，hover 那一行把
        // `var(--color-primary-500)` 写成 `var(--color-slate-500)` 会重新走成 rc=1。
        else if (whoLacks(hbg)) unknown.push(`.${cls}:hover 的 background-color: ${hoverBgDecl.trim()} ${whoLacks(hbg)}`);
        else if (whoLacks(hfg)) unknown.push(`.${cls}:hover 的 color: ${String(hoverFgDecl || '').trim() || '（沿用静止态）'} ${whoLacks(hfg)}`);
        else pairs.push({ what: `.${cls}:hover ${hfg.label} 的字压 ${hbg.label}`, fg: hfg, bg: hbg });
      }
    }
    // 🔴 #1091 —— 静止态的底也可能写在 `background-color:` 声明里，不在 `@apply` 的词里。
    // `.btn-primary` 从 `bg-primary-500` 换成了 `background-color: var(--btn-primary-bg, …)`
    // （底色现在是**算出来的那一档**），而这个解析器原来只看 `@apply` ⟹ 它会判成「没写底色 = 压白底」，
    // 于是「白字压白底 = 1.00:1」被报成**六组配色不合格**。仪器把自己的盲区报成了库的问题 ——
    // 这正是这个文件自己在别处写的那条：解不出来不是「没有配对要判」。
    const bgDecl = declOf(body, 'background-color');
    if (!bgWord && bgDecl) {
      const dbg = specOfDecl(bgDecl);
      if (!dbg) { unknown.push(`.${cls} 的 background-color: ${bgDecl.trim()} 认不出来`); continue; }
      const dbgMissing = whoLacks(dbg);
      if (dbgMissing) { unknown.push(`.${cls} 的 background-color: ${bgDecl.trim()} ${dbgMissing}`); continue; }
      pairs.push({ what: `.${cls} ${fg.label} 的字压 ${dbg.label}`, fg, bg: dbg });
      continue;
    }
    if (!bgWord) {
      // 没写底色 = 压着页面本身的白底。不是猜的：globals.css 在 `.hero__cta .btn-secondary` 那段
      // 注释里写着它 "written for a white page"，深色底上由 `currentColor` 接管，而 currentColor
      // 取的是主题表给的颜色 —— 那是下面 ⑨ 的地盘，不是这一节的。
      pairs.push({ what: `.${cls} ${fg.label} 的字压白底`, fg, bg: { hex: WHITE, label: 'white' } });
      continue;
    }
    for (const [suffix, word] of [['', bgWord], [':hover', hoverWord]]) {
      if (!word) continue;
      const bg = specOf(word);
      if (!bg) { unknown.push(`.${cls}${suffix} 的底色 ${word} 认不出来`); continue; }
      const bgMissing = whoLacks(bg);
      if (bgMissing) { unknown.push(`.${cls}${suffix} 的底色 ${word} ${bgMissing}`); continue; }
      pairs.push({ what: `.${cls}${suffix} ${fg.label} 的字压 ${bg.label}`, fg, bg });
    }
  }
  if (unknown.length) {
    die(`globals.css 里的按钮配色解不出来：${unknown.join('；')} —— 解不出来不是「没有配对要判」`);
  }
  // 分母自检。判据是**解到了这三个类**，不是「解到了 N 条」：条数会随 hover 的有无变，而三个类
  // 是这一节存在的理由（少一个就等于那个按钮没人判）。
  const classes = [...new Set(pairs.map((p) => p.what.split(' ')[0].replace(/:hover$/, '')))];
  for (const need of ['.btn-primary', '.btn-secondary', '.btn-accent']) {
    if (!classes.includes(need)) {
      die(`从 globals.css 解不到 ${need} 的字压底配对（解到的是：${classes.join(' · ') || '一个都没有'}）`
        + ' —— 这一节会空过');
    }
  }
  return pairs;
}
const BUTTON_PAIRS = buttonPairsFromGlobals();
/** 一条配对在某组配色（可选再偏 `hue` 度）下的两个具体颜色。 */
// #1084 —— `{computed}` 的那三种在**这一组配色上**现算，用的是生产同一个模块（一把尺）。
const buttonInk = require('./lib/button-ink.js');

// 🔴 #1068 条 4 的同族一半，织进本票的新形状。**它答的是 2，不是 1** —— 上面 `whoLacks` 查的是
// `presets.PALETTES`，而这条路还被反向对照拿**注册表主题**的 colors 喂过；那一侧缺一个组会走成
// `undefined[shade]` ⟹ TypeError ⟹ node 退 1，而 1 在这个脚本的契约上的意思是「某组配色不合格」。
// 拿不到颜色不是一个关于对比度的读数。
//
// 🔴 本票把它从「一个 if」改成「一个取值函数」，因为**要查的档位现在是算出来的**：`hoverShade` /
// `outlineShade` 落在哪一档取决于这组配色本身，写不成一条静态的 {group, shade}。所以每一次真正
// 去调色板取色都经过这里，包括算出来的那两档 —— 否则新形状上那两条路又变成裸的 `colors[g][sh]`。
const needShade = (p, colors, group, shade) => {
  if (!colors[group] || typeof colors[group][shade] !== 'string') {
    die(`配对「${p.what}」要的 ${group}-${shade} 不在这组 colors 里（有的组是：`
      + `${Object.keys(colors).join(' · ') || '一个都没有'}）—— 拿不到颜色不是「对比度不合格」`);
  }
  return colors[group][shade];
};

// 🔴 轮廓按钮的字色档位，按**它真正被画在上面的那块底**选（2026-08-19 票正文第三次改的口径）。
// 在这个文件里那块底就是这条配对自己的 `bg`：`globals.css` 单独看时 `.btn-secondary` 没写 `bg-*`
// ⟹ 上面那条 `if (!bgWord)` 把它定成字面白（= 未套主题的站）。套了主题的站那块底来自主题表自己的
// `.services-list` / `.services-list__item`，那一群由 `scripts/lib/button-ink.test.js` §⑤ 逐套判 ——
// **这里不能拿白底去替它们答**，所以这个函数只回答「这条配对写着的那块底」。
const outlineGroundOf = (p) => (p.bg && p.bg.hex !== undefined ? p.bg.hex : buttonInk.WHITE);

const resolveSpec = (s, colors, p) => {
  if (s.hex !== undefined) return s.hex;
  if (s.computed !== undefined) {
    // 🔴 #1091 —— 顺序跟生产那一份逐句同源：**先选底，再按那块底选字**。上一版从 `primary-500` 起算
    // 字色，那在底会挪之后就是关于另一块底的答案（`button-ink.js` §buttonInkReport 那段注释同理由）。
    const baseShade = buttonInk.baseShadeFor(colors.primary);
    const inkHex = buttonInk.inkFor(needShade(p, colors, 'primary', baseShade));
    if (s.computed === 'baseShade') return needShade(p, colors, 'primary', baseShade);
    if (s.computed === 'ink') return inkHex;
    // #1100 —— `.btn-accent` 的 hover 底：走 accent 那一组，与 primary 那把梯子同一个函数
    // （`hoverShadeFor`，方向按亮度判）。字色是 `text-gray-900`，由上面 `specOf` 那条字面色的路给出，
    // 所以这里只答底。
    if (s.computed === 'accentHoverShade') {
      return needShade(p, colors, 'accent', buttonInk.accentHoverShadeFor(colors.accent));
    }
    if (s.computed === 'hoverShade') {
      return needShade(p, colors, 'primary', buttonInk.hoverShadeFor(colors.primary, inkHex, baseShade));
    }
    if (s.computed === 'outlineShade') {
      return needShade(p, colors, 'primary', buttonInk.outlineShadeFor(colors.primary, outlineGroundOf(p)));
    }
    // 同族第三条：认得出变量名、却没有对应的算法 ⟹ 也是仪器坏了，不是配色不合格。
    die(`配对「${p.what}」要的算法 ${s.computed} 这里没有实现 —— 拿不到颜色不是「对比度不合格」`);
  }
  return needShade(p, colors, s.group, s.shade);
};
// 🔴 #1084 —— 色相偏移必须**在算字色之前**施加到调色板上，不是之后施加到算出来的那个颜色上。
// 站上的次序是：`buildCustomCss` 把偏移写进 `custom.css` 的 `--color-*`，而 `sync-config.js` 算这三个
// 变量时读的是 `theme.css + custom.css` 层叠**之后**的值 ⟹ 决定字色的那个底色**已经转过色相了**。
// 反过来写（先按未偏移的底色定字色、再去转底色）量的是一个站上不存在的配对：实测这组阳性对照在 14°
// 上正是这么给出 4.46 的 —— 未偏移时白字够，偏移后白字不够，而生产会在那一档换成深字。
// 📌 字面色（`text-white` / `text-gray-900`）仍照旧施加 `shift`：那是本票之前的行为，一个读数都不动。
//    （站上 hueShift 只重写 `--color-*`、碰不到 Tailwind 的字面字色 ⟹ 那一处偏严，是既有口径，不在本票圈内。）
const shiftPalette = (colors, shift) => {
  const out = {};
  for (const [group, shades] of Object.entries(colors)) {
    out[group] = {};
    for (const [shade, hex] of Object.entries(shades)) {
      out[group][shade] = typeof hex === 'string' ? shift(hex) : hex;
    }
  }
  return out;
};
const pairColours = (p, colors, shift) => {
  const shifted = shift ? shiftPalette(colors, shift) : colors;
  return [p.fg, p.bg].map((s) => (s.hex !== undefined
    ? (shift ? shift(s.hex) : s.hex)
    : resolveSpec(s, shifted, p)));
};
function lin(c) { const s = c / 255; return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4; }
function lum(hex) {
  const h = hex.replace('#', '');
  return 0.2126 * lin(parseInt(h.slice(0, 2), 16))
    + 0.7152 * lin(parseInt(h.slice(2, 4), 16))
    + 0.0722 * lin(parseInt(h.slice(4, 6), 16));
}
function ratio(a, b) { const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x); return (hi + 0.05) / (lo + 0.05); }
/** 一组配色的承重读数，配对从 globals.css 现解（#1055 条 9）。返回 [[名字, 比值], …]。 */
function buttonRatios(colors) {
  return BUTTON_PAIRS.map((p) => {
    const [fg, bg] = pairColours(p, colors);
    return [p.what, ratio(bg, fg)];
  });
}
for (const [name, p] of Object.entries(presets.PALETTES)) {
  const rows = buttonRatios(p.colors);
  const worstRow = rows.reduce((a, b) => (b[1] < a[1] ? b : a));
  if (worstRow[1] >= MIN) {
    ok(`配色 ${name}：最差的一处是「${worstRow[0]}」= ${worstRow[1].toFixed(2)}:1（≥ ${MIN}）`);
  } else {
    bad(`配色 ${name}：「${worstRow[0]}」= ${worstRow[1].toFixed(2)}:1，低于 ${MIN}:1 —— `
      + '这一组会让按钮上的字读不出来，不该进库');
  }
}

// 🔴 反向对照：判据必须真的能判红。
//
// 🔴 #1100 —— **这个对照原来靠「注册表里有坏主题」，而本票把最后那批坏的修好了 ⟹ 它退化成了恒绿。**
// 上一版的话是「拿注册表里已知过不了这一关的那一套（`golden-yellow` 的 primary-500 是 1.92:1）喂同一个
// 函数」，而报红的那些走的都是 `.btn-secondary:hover`（字按 `primary-500` 算、底就是 `primary-500`，两头
// 都不自愈）。本票把那一格换成主按钮静止态那一对之后，**注册表 110 套一套都不红了**（实测：最接近破线的
// 是 `rose-56` 的 `.btn-secondary` 静止 4.506、`lavender-calm` 的 `.btn-primary` 4.523）。
//
// ⟹ 对照改成**人造夹具**，而这不只是「换个夹具」：靠库里恰好有坏数据的对照，会在库被修好的那一天静默
// 变空 —— 而「库被修好」正是这些票要干的事。人造夹具不会因为产品变好而失效。
// 📌 注册表那一圈**留着，但降级成读数**：0 套报红是本票的结果，值得印出来，而它不再承担「判据分得开
//    好坏」这件事（那件事由下面两个人造夹具承担，且**两条路各一个** —— 本票给按钮层加了 accent 那条路）。
{
  let registry = null;
  try { ({ themes: registry } = require('./themes.js')); } catch { /* 没有注册表就跳过这一格 */ }
  if (!registry) {
    bad('读不到 themes.js —— 注册表那个读数取不到（这不是通过）');
  } else {
    const entries = Object.entries(registry);
    const failing = entries
      .filter(([, t]) => buttonRatios(t.colors).some(([, r]) => r < MIN))
      .map(([id]) => id);
    // 🔴 #1083 条 ④ —— 分子分母都现算（「注册表 30 套」曾写死在这里，#1016 之后是 110 套）。
    ok(`读数：同一个判据打在注册表 ${entries.length} 套主题上，报红 ${failing.length} 套`
      + `${failing.length ? `（${failing.slice(0, 3).join(', ')}${failing.length > 3 ? '…' : ''}）` : ''}`
      + ' —— 这是一个读数，不是这一节的反向对照（对照在下面两个人造夹具上）');
  }

  // 🔴 两个人造夹具，一条路一个。缺哪一个，那条路上「判据分不分得开」就没被验过。
  const LADDER = ['50', '100', '200', '300', '400', '500', '600', '700', '800', '900'];
  const violetC = presets.PALETTES.violet.colors;
  // ① primary 那条路：整条梯子都是 `#777777`。
  //
  // 🔴 **这一档是算出来的，不是随手挑的深灰**，而算它的时候撞上了一件必须写下来的事：**这一节判的是
  // 【裸】对比度**（本文件自己那个 `ratio()`，不掺色），而 `baseShadeFor` / `inkDecision` 判的是
  // **blended**。裸 ≥ blended，所以只要 `baseShadeFor` 挑得出一档，那一格在这一节里**按构造必然过线**
  // —— 也就是说 #1091 之后 `.btn-primary` 在这一节里是**判不红的**，除非整条梯子在 blended 下全废
  // （落回 500）**并且**那一档上白字连裸尺也过不了。
  // 第一版我喂的是 `#747474`（`button-ink.js` ①a 那段 `gray 114…119` 里的一档）：blended 下确实全废，
  // 但裸尺是 **4.583** ⟹ 这一节照样绿，对照当场报了「一条都没报红」。
  // 逐灰阶扫 100…140 找「裸尺也不合格」的那些，**只有一档**：`gray-119` = `#777777`
  // （base 落回 500 · 字仍是白 · 裸 **4.4781** · blended 4.1800）。所以这个值是那次扫描的唯一解。
  const GREY119 = '#777777';
  const hopelessPrimary = {};
  for (const sh of LADDER) hopelessPrimary[sh] = GREY119;
  // ② accent 那条路（本票新开的）：accent 色阶全是深色 ⟹ `gray-900` 的字压 `accent-400` 过不了线，
  //    而 `accentHoverShadeFor` 朝浅走也一档都救不回来。primary 用健康的那套，所以红只会落在 accent 上。
  const darkAccent = {};
  for (const sh of LADDER) darkAccent[sh] = '#1a1a1a';
  for (const [name, colors, expect] of [
    ['primary 整条梯子都救不回来（gray-119，裸尺也不合格的唯一那一档）',
      { primary: hopelessPrimary, accent: violetC.accent }, '.btn-primary'],
    ['accent 整条色阶都是深色', { primary: violetC.primary, accent: darkAccent }, '.btn-accent'],
  ]) {
    const red = buttonRatios(colors).filter(([, r]) => r < MIN);
    const hit = red.filter(([what]) => what.startsWith(expect));
    if (!red.length) {
      bad(`反向对照「${name}」一条都没报红 —— 这条路上的判据判不出东西，上面那圈绿是空的`);
    } else if (!hit.length) {
      // 🔴 红在别处不算：这个夹具是为了验**那一条路**，红在另一条上说明它验的不是它自己声称的那件事。
      bad(`反向对照「${name}」报红了，但没有一条是 ${expect} 的：`
        + red.map(([w, r]) => `${w}=${r.toFixed(2)}`).join(' · '));
    } else {
      ok(`反向对照「${name}」⟹ 报红 ${red.length} 条，其中 ${expect} 的 ${hit.length} 条`
        + `（最差 ${Math.min(...hit.map(([, r]) => r)).toFixed(2)}:1）—— 这条路上的判据红得起来`);
    }
  }
}

// ── ② 圆角档用的是 theme-settings.js 现成那两张表，不是另抄一份数 ───────────────────────────────
{
  const wrong = Object.entries(presets.CORNERS)
    .filter(([, c]) => !Object.values(RADIUS).includes(c.radius) || !Object.values(BUTTON_SHAPE).includes(c.button));
  if (!wrong.length) {
    ok(`三档圆角的值全部是 theme-settings.js 里 RADIUS / BUTTON_SHAPE 的对象本身（同一份数，不是副本）`);
  } else {
    bad(`圆角档 ${wrong.map(([k]) => k).join(', ')} 用了自己抄的数 —— 同一张表两份拷贝正是 #961/#1002 一路在堵的东西`);
  }
}

// ── ③ 校验：认不出的名字必须报错，不能静默忽略 ─────────────────────────────────────────────────
{
  const cases = [
    [undefined, 0, '没有 presets 是合法的'],
    [{}, 0, '空对象是合法的'],
    [{ palette: 'ocean', corners: 'round', fonts: 'modern' }, 0, '三组都选'],
    [{ palette: '' }, 0, '空串 = 清掉这一组'],
    [{ palette: 'chartreuse' }, 1, '不在库里的名字'],
    [{ palettes: 'ocean' }, 1, '不是一个预设组'],
    [{ corners: 3 }, 1, '类型不对'],
    [['ocean'], 1, '整个不是 object'],
  ];
  for (const [input, want, why] of cases) {
    const got = presets.validatePresets(input).length;
    if (got === want) ok(`校验：${why} → ${got} 条问题`);
    else bad(`校验：${why} → 期望 ${want} 条问题，实际 ${got} 条（${presets.validatePresets(input).join(' / ')}）`);
  }
}

// ── ④ 绝对项没有渗进 tweaks 那三个旋钮里（AC4b 的静态那半） ─────────────────────────────────────
{
  const want = ['hueShift', 'radiusScale', 'densityScale'];
  const same = tweaks.TWEAK_KEYS.length === want.length && want.every((k) => tweaks.TWEAK_KEYS.includes(k));
  if (same) ok(`TWEAK_KEYS 仍然正好是 {${want.join(', ')}}（写的是集合，不是条数）`);
  else bad(`TWEAK_KEYS 变成了 [${tweaks.TWEAK_KEYS.join(', ')}] —— 绝对项属于 theme-presets.js，`
    + '塞进这里会让 withDefaults 静默丢掉它、让弹窗的 Apply 永远亮着');
  const overlap = presets.PRESET_KEYS.filter((k) => tweaks.TWEAK_KEYS.includes(k));
  if (!overlap.length) ok('两组键没有重名');
  else bad(`${overlap.join(', ')} 同时是 tweak 和预设组 —— 一个值两个主人`);
}

// ── ⑤ 生成器：中性输入收敛成空串（AC5） ────────────────────────────────────────────────────────
const BASE = [
  ['--color-primary-500', '#2563eb'],
  ['--color-accent-400', '#fbbf24'],
  ['--radius-lg', '0.5rem'],
  ['--section-y', '4rem'],
];
{
  const a = tweaks.buildCustomCss(BASE, undefined);
  const b = tweaks.buildCustomCss(BASE, { hueShift: 0, radiusScale: 1, densityScale: 1 }, presets.presetVars(undefined));
  const c = tweaks.buildCustomCss(BASE, null, presets.presetVars({}));
  if (a === '' && b === '' && c === '') ok('中性 tweaks + 没选任何预设 ⟹ 空串（跟从没设过的站逐字节相同）');
  else bad(`中性输入没有收敛成空串：${JSON.stringify([a, b, c])}`);
}

// ── ⑥ 生成器：`@import` 必须是第一行（AC4 的静态那半） ──────────────────────────────────────────
{
  const abs = presets.presetVars({ fonts: 'editorial' });
  const css = tweaks.buildCustomCss(BASE, undefined, abs);
  const first = css.split('\n')[0];
  if (/^@import url\("https:\/\/fonts\.googleapis\.com\//.test(first)) {
    ok(`字体预设 ⟹ 第一行就是 @import：${first.slice(0, 60)}…`);
  } else {
    bad(`第一行不是 @import，而是 ${JSON.stringify(first)} —— CSS 规定 @import 只能在最前面，`
      + '排到后面浏览器整条丢掉，症状是「字体没换」而不是报错');
  }
  if (/--font-heading: Playfair Display, serif;/.test(css) && /--font-sans: "Source Sans 3", /.test(css)) {
    ok('字体预设同时写了 --font-heading 和 --font-sans');
  } else {
    bad(`字体预设没写全两个字体变量：\n${css}`);
  }
  // 🔴 名字里带数字的必须加引号，否则整条 font-family 声明无效、浏览器退回默认字体（真浏览器上
  // 量到的是 `"Times New Roman"`，而文件里那一行看着完全正常）。逐对检查，不只检查这一对。
  {
    const badly = [];
    for (const name of Object.keys(presets.FONT_PAIRS)) {
      const { vars } = presets.presetVars({ fonts: name });
      for (const [varName, value] of vars.filter(([n]) => n.startsWith('--font-'))) {
        for (const part of value.split(',').map((s) => s.trim())) {
          // 不加引号的字体名 = 若干个 CSS 标识符；带数字段的那种必须加引号
          const bare = !/^["']/.test(part);
          const legal = part.split(' ').every((p) => /^[A-Za-z_-][A-Za-z0-9_-]*$/.test(p));
          if (bare && !legal) badly.push(`${name} 的 ${varName}: ${part}`);
        }
      }
    }
    if (!badly.length) ok(`${Object.keys(presets.FONT_PAIRS).length} 对字体的每个名字在 CSS 里都是合法写法（该加引号的加了）`);
    else bad(`这些字体名不加引号会让整条 font-family 失效：${badly.join(' · ')}`);
  }
  // 没选字体时不许平白冒出一条 @import（多一条字体表请求 = 多一次首屏阻塞）
  const noFont = tweaks.buildCustomCss(BASE, { hueShift: 5 }, presets.presetVars({ palette: 'ocean' }));
  if (!/@import/.test(noFont)) ok('没选字体对 ⟹ 一条 @import 都不写');
  else bad(`没选字体对却写了 @import：\n${noFont}`);
}

// ── ⑦ 生成器：绝对值真的盖过基准，而且偏移叠在【盖完之后】的值上 ────────────────────────────────
{
  const abs = presets.presetVars({ palette: 'navy' });
  const flat = tweaks.buildCustomCss(BASE, undefined, abs);
  if (/--color-primary-500: #2a4d84;/.test(flat)) ok('配色预设 navy ⟹ --color-primary-500 写成 #2a4d84（盖过主题的 #2563eb）');
  else bad(`配色预设没有盖过基准：\n${flat}`);

  // 先换基准、再施加偏移。判据是「跟只有偏移、和只有预设，两个都不一样」——
  // 只跟其中一个比，分不出实现是不是把某一层当成了空操作。
  const both = tweaks.buildCustomCss(BASE, { hueShift: 12 }, abs);
  const onlyTweak = tweaks.buildCustomCss(BASE, { hueShift: 12 });
  const line = (css) => (css.match(/--color-primary-500: (#[0-9a-f]{6});/) || [])[1];
  if (line(both) && line(both) !== line(flat) && line(both) !== line(onlyTweak)) {
    ok(`配色 + 色相 ⟹ ${line(both)}，既不等于只有配色（${line(flat)}）也不等于只有色相（${line(onlyTweak)}）`);
  } else {
    bad(`两层没有真的叠起来：配色+色相=${line(both)} · 只有配色=${line(flat)} · 只有色相=${line(onlyTweak)}`);
  }

  // 圆角档给的是绝对值，radiusScale 乘在它上面。
  const corners = tweaks.buildCustomCss(BASE, { radiusScale: 1.25 }, presets.presetVars({ corners: 'round' }));
  if (/--radius-lg: 1\.25rem;/.test(corners)) ok('圆角档 round（--radius-lg: 1rem）× radiusScale 1.25 ⟹ 1.25rem');
  else bad(`圆角档和 radiusScale 没有叠对：\n${corners}`);

  // `--radius-button` 在基准里根本不存在（没写风格设定的站），预设仍然要把它写出来 ——
  // 少了它，「胶囊按钮」这一档表达不出来。
  if (/--radius-button: 9999px;/.test(tweaks.buildCustomCss(BASE, undefined, presets.presetVars({ corners: 'round' })))) {
    ok('基准里没有的变量（--radius-button）预设照样写得出来');
  } else {
    bad('预设没写出 --radius-button —— 没写风格设定的站，胶囊按钮这一档就表达不出来');
  }
}

// ── ⑧ 生成器：跟主题说的一模一样的那一行不写进去 ────────────────────────────────────────────────
{
  // ocean 的 primary-500 恰好就是 BASE 里那个值 ⟹ 这一行是噪音，不该出现。
  const css = tweaks.buildCustomCss([['--color-primary-500', '#2563eb']], undefined, presets.presetVars({ palette: 'ocean' }));
  if (!/--color-primary-500:/.test(css)) ok('预设算出来的值跟主题一样时，那一行不写进 custom.css');
  else bad(`写了一行跟 theme.css 一字不差的声明（噪音）：\n${css}`);
}

/**
 * 🔴 第 ⑨ 节那个阳性对照要用的一组配色：**滑块归零时它是达标的，拖到某个角度才破线。**
 *
 * 📌 **这一整段是【历史】，不再描述今天在用的那个值** —— 它讲的是「驱动的 token 换过两次、每次为什么
 * 退化」，而 #1100 换了第三次（今天在用的是下面那个 `HUE_ONLY_BREACH_ACCENT_600`，它自己那段注释里带
 * 着余量上限的算法）。这一段留着是因为**两次退化的机制仍然会再发生一次**：一个靠「某个 token 恰好把
 * 某一对推到门槛上」的夹具，会在那一对被改掉/被自愈的那天静默变绿。
 * 🔴 曾经的那个值 `#9640ef` 已经**没有消费者了，删了** —— 留一个不开火的常量在这里，下一个人会以为
 * 它还是驱动那个夹具的值（同族纪律：#1091 r2 QA1 对 `HOVER_LIGHTER`/`HOVER_DARKER` 点过同一件事）。
 *
 * 它曾经是 violet 只把 `primary-500` 挪到一个搜出来的值。`primary-500` 当时是 `globals.css` 里
 * `.btn-primary` 的底色 —— 在**色相这一维上摆幅最大**的一对，所以它是当时唯一还能被色相推过线、
 * 而两边又都留得住余量的地方。
 *
 * ── 🔴 #1084 之后这一对为什么还能被推过线（不推自明，我量过才敢留）────────────────────────────
 * 那张票把 `.btn-primary` 的字色改成算出来的：白字够就白字，不够就换纯黑，**两种都不够时保持白字**。
 * 所以这个对照会不会退化，取决于色相拖到 14° 时那两种字色各是多少。量出来（这一节与生产用的是
 * **同一把尺** —— `theme-contrast.js` 的 `PAINT_BLEND`＝0.06，先把字色朝底色掺一点再算，模拟抗锯齿）：
 *     色相 0°  底 #9640ef   白字 **4.5362** ✅ ⟹ 选白字（够，不换）
 *     色相 14° 底 #b31aec   白字 **4.4619** ❌ · 纯黑 **4.1542** ❌ ⟹ 两种都不够 ⟹ **保持白字**
 * ⟹ 破线那一档之所以还破得了，是因为**纯黑在那里更差**（4.15 < 4.46），规则不会换过去。
 * 🔴 这句话是承重的：如果哪天这一对被挪到一个「纯黑能救」的位置，生产会换成纯黑、读数直接跳到 4 以上，
 *    这个对照当场变成恒绿。换驱动 token 之前先把两种字色都算一遍。
 * 📌 对照的数（4.5362 / 4.4619）在 #1084 前后**逐字相同**，但来路变了：从前它是「白字」这个字面常量，
 *    现在它是「算出来的字色恰好也是白」—— 后者是量出来的，前者是写死的。
 *
 * ── 🔴 为什么驱动的 token 换过两次，别再换回去 ──────────────────────────────────────────────
 * ① 最早挪的是 `primary-600`（`.cta-banner` 那条渐变的近端）。#1072 把那条渐变从中间调的
 *    `primary-600 → accent-500` 换成深的 `primary-800 → primary-900`，`primary-600` 从此不在任何
 *    一条被判的渐变里 ⟹ 对照退化成恒绿。
 * ② 接着挪的是 `accent-600`（`hero-media-top` 那张表 `.announcement-bar__link` 的字色）。#1072
 *    第三轮把那三张手写表里写死的 `accent-600` 换掉了（它压在 `primary-50` / `primary-100` 的浅底
 *    上，110 套配色里 90–102 套低于门槛）⟹ 这个对照又退化成恒绿。
 * 两次都**不是我发现的**，是下面第 ② 条断言当场报出来的。这正是那两条断言存在的理由。
 *
 * ── 🔴 为什么 `accent-600` 这条路是走死的，不是没挑好（2026-08-18 量的）────────────────────────
 * 换掉之后，`accent-600 on primary-50` 仍是**表这一层**最紧的一对（violet：归零 5.009、整个色相
 * 区间最低 4.983）—— 但那是 **0.026 的摆幅**：两端都跟着色相转，转过去几乎抵消。把它逐档扫过一遍，
 * 归零合格且余量 < 0.25 的候选有 13 个，**没有一个**能在区间里掉到 4.5 以下（最接近的 `#17766e`：
 * 归零 4.520、区间最低 4.502）。⟹ 那个窗口只有 0.02 宽，比颜色的整数粒度还窄。
 *
 * ── 🔴 摆幅决定了余量的上限，这是这组值只能这么紧的原因 ────────────────────────────────────────
 * `shiftHue` 基本保亮度，所以色相这一维对对比度的影响本来就小。四条按钮实测的摆幅：
 *     `.btn-primary` 算出来的字色/primary-500  **0.076**  ← 最大，选它（这一组里它算出来是白）
 *     `.btn-accent` gray-900/accent-400         0.074
 *     `.btn-primary:hover` white/primary-600    0.049
 *     `.btn-accent:hover` gray-900/accent-500   0.041
 * 一个「归零绿、某档红」的夹具必须把归零那一档塞进门槛上方**不到一个摆幅**的地方 ⟹ 两边余量的
 * 较小者最多只能是摆幅的一半（0.038）。在 `#993feb` 邻域 ±5 做三通道细搜（1331 个候选、263 个
 * 在按钮层合格）取两边余量较小者最大的那个，就是下面这个值：
 *     归零那一档最紧 **4.5362**（+0.036）· 拖到 14° 时 `.btn-primary` 掉到 **4.4619**（−0.038）
 * ⟹ **已经贴着理论上限**，不存在「再挑松一点的」。判据的常数或 globals.css 的按钮一动，这一档
 * 大概率滑出去，而下面两条断言会当场说清滑向了哪一边。**滑出去的处置是重挑，不是把断言放宽。**
 *
 * 📌 这一组在 **83 张表那一层一处都不破**（归零 0 处、非 0 档 0 处，实测）—— 破线只落在
 *    `globals.css` 的按钮上。所以下面第 ② 条断言数的是**表 + 按钮**，不能只数表；`judgeButtons`
 *    为此回了 `hits`，理由写在它上面。
 *
 * ── 🔴 为什么不是随便挑一组坏配色（QA1 在 r3 上把这件事驱动出来了）──────────────────────────────
 * 上一版这里冻的是 r2 那组 violet accent（QA3 在真浏览器上量到 −15° 掉到 4.45 的那组）。
 * 但**在这一层它每一档都是红的**（−15…15 全部落在 3.79–3.89），因为这一层比真机严。
 * 于是那个对照证明的只是「一组坏配色会被判红」，**跟色相那一维没有关系** —— QA1 把
 * `hueSteps()` 改成只回 `[0]`，六组配色照样全过、对照照样报红、整套 37 过 0 失败。
 * 而第 ⑨ 节存在的全部理由就是色相那一维（配色本身那一层 r2 就有了，逃掉的正是叠加）。
 *
 * ⟹ 合格的对照必须**两半都成立**，下面那一格因此写了两条断言：归零那一档全绿、整个区间里有一格
 * 破线且**破线的那一档不是 0°**。这两条也是这组值的维护说明：判据的常数一动，它可能滑向任何一边，
 * 而两条断言会当场说清楚滑向了哪一边、该重挑。
 */
/**
 * 🔴 ③（#1100）驱动的 token **第三次换了，这次换成 `accent-600`**，而换掉它的理由、以及这一版余量为什么
 * 只有上一版的三分之一，都是这张票量出来的结果。
 *
 * ── 上一版为什么退化 ────────────────────────────────────────────────────────────────────────────
 * 它靠 `primary-500` 驱动，而它在 14° 上真正破的那一格是 **`.btn-secondary:hover`**（字按 `primary-500`
 * 算、底就是 `primary-500`，两头都不自愈）—— 本票把那一格换成了主按钮静止态那一对 ⟹ 它跟着
 * `baseShadeFor` 自愈，破不了了。实测（本票改完之后，上一版夹具 `#9640ef`）：归零那一档 4.5362 ✅，
 * 而**整个 −15…15° 区间一格都不破** ⟹ 对照恒绿，而那一格当场报了出来（它就是为这件事写的）。
 *
 * ── 🔴 余量的上限是【算出来的】，不是「我挑不到更好的」（本票四次搜索的结论）──────────────────────
 * 一个「归零绿、某档红」的夹具，归零那一档必须落在门槛上方**不到一个摆幅**的地方 ⟹ 两边余量的较小者
 * ≤ 摆幅 / 2。所以能拿到多大余量，只取决于**在门槛处 binding 的那一对摆幅多大**。而摆幅最大的那些对
 * （`.services-nav__link` 0.146 · `.page-header__sub` / `.hero__sub` / `.cta-banner__desc` 0.079 ·
 * `.announcement-bar__link` 0.065）**没有一个能被推到门槛**：往那个方向压任何一个 token，总有一对
 * 摆幅只有 0.024 的跨组配对（`accent-600` 压 `primary-50` / `accent-400` 压 `primary-800` 那一族）
 * 先到门槛、抢走 binding 的位置。四条搜索路线各自撞在同一堵墙上：
 *     驱动 `accent-400`（全色立方粗筛 2073 候选）  归零就破 —— 它同时是好几张表的底
 *     驱动 `accent-400` + `primary-800`（两 token） 朝黑 1 个候选 score 0.0030 · 朝白 0 个
 *     驱动 `accent-300`（一维 71 档）               0 个
 *     驱动 `primary-900`（一维 91 档）              1 个 score 0.0112
 *     驱动 `accent-600`（一维 + ±4 三通道细搜）     27 个，最好 **score 0.0115** ← 选它
 * ⟹ **±0.011 就是今天的天花板**（≈ 0.024 / 2）。上一版能有 ±0.037 是因为当时还存在
 * `.btn-secondary:hover` 这种「白字压一个 token」的高摆幅、又无自愈的对；本票把它治好了，代价就是
 * 这个夹具从此只能这么紧。**这不是没挑好，是墙。**
 *
 * ── 选中的值 ────────────────────────────────────────────────────────────────────────────────────
 *     `#157672`   归零那一档最紧 **4.5125**（+0.0125，binding：`crimson-30` 的 `.announcement-bar__link`）
 *                 拖到 **−12°** 时同一格掉到 **4.4885**（−0.0115）
 *
 * 🔴 **为什么 primary 这一侧此后【结构上】驱动不了这个对照了**：#1091 之后 `.btn-primary` 静止/hover
 * 与（本票之后）`.btn-secondary:hover` 三条都走 `baseShadeFor` —— 它按构造挑「第一个压得住的档」，
 * 所以除非 500…900 整条梯子在那一档上都救不回来，这三条就不会破线。而 `.btn-accent` 的 hover 本票也
 * 改成算出来的了 ⟹ 按钮层今天**只剩 `.btn-accent` 静止态一对不自愈**，而它的驱动 token（`accent-400`）
 * 同时是多张表的底色，压暗它归零那一档当场就破（上表第一行）。
 *
 * 🔴 维护说明**变严了**：滑出去的处置仍然是重挑（不是放宽断言），但重挑之前先照上面那条算一遍
 * 「今天 binding 的那一对摆幅多大」—— 如果它 < 0.02，那不是挑不到，是这个形状的对照到期了，该换的是
 * 判据的形状（例如改成「同一夹具在非 0 档的最差读数必须显著低于归零那一档」），而那是一次立票的活。
 */
const HUE_ONLY_BREACH_ACCENT_600 = '#157672';

// ── ⑨a 那份被量的单子本身：改窄它、写错它，都必须报错（#1083 条 ① / 条 ②）────────────────────
//
// 编号是 ⑨a 而不是往后接一个新数字：下面 ⑨ / ⑩ 消费这一节钉住的两个常量，而「第 ⑨ 节」「第 ⑩ 节」
// 这两个说法被别的文件引用着（`theme-text-targets.js` · `hero-media-*.css` · #1072 的交接），改号会
// 让那些引用指向别处。
//
// 🔴 为什么要有这一节 —— 两个读数，都是在隔离树上真跑出来的（#1083）：
//     把 `scripts/theme-text-targets.js` 里 `.cta-banner__headline` / `.cta-banner__desc` 两行删掉
//       ⟹ **39 过 / 0 失败、rc=0**，而第 ⑩ 节报告里「共 2640 对」静默印成「共 1980 对」
//     把一个选择器名写错成 `.announcement-bar__linkTYPO`
//       ⟹ 同样全过，每张表从 8 对掉到 7 对
// 原因只有一个：那两节的「该量到多少对」和「实际量到多少对」**都是从同一份单子、同一个 `textPairs`
// 算出来的**，单子一缩两边一起缩，差值恒为 0。分母自检要能自检，它的期望值就不能来自被它检查的那
// 份数据。
//
// 所以「该量到多少」在这里**写死**：
//   · `PINNED_MEASURED_TARGETS` —— 单子的内容逐个钉住。钉全部 10 个而不是只钉个数：改名和写错名
//     **不改个数**，而「个数一样、内容不一样」正是上面第二个读数。改单子就必须同时改这里，改不动
//     就是报红 —— 这一条治的是「悄悄少量几个选择器」。
//   · `PINNED_RESOLVED_PER_SHEET` —— 一张主题表该解出几个被量的选择器。今天 `public/themes` 下
//     83 张表**每张都是 8**（2026-08-18 实测）；另外两个是 `.btn-primary` / `.btn-accent`，颜色住在
//     `globals.css`，表里一条都没写，第 ⑨ 节按钮那一段判它们。
//
// 🔴 **条 ② 也是这一条治的**（本票正文点明「①那个写死的数同时就治了这一条」）：让判三张表那条路
// 解不出任何配对时，第 ⑩ 节的 `judged` 变 0，而它的分母从今以后是写死的数 ⟹ `0 < 8 × 3 × 110`
// 报红。在此之前分母跟着一起变 0，`0 < 0` 为假，那一节报绿。下面第 ⑩ 节末尾另有一个**喂坏配色**的
// 反向对照，管的是另一半：路能解出配对，但判据判不出红。
const PINNED_MEASURED_TARGETS = [
  '.hero__title', '.hero__sub',
  '.cta-banner__headline', '.cta-banner__desc',
  '.page-header__title', '.page-header__sub',
  '.btn-primary', '.btn-accent',
  '.announcement-bar__link', '.services-nav__link',
];
const PINNED_RESOLVED_PER_SHEET = 8;
{
  const { MEASURED_TARGETS } = require('./theme-text-targets.js');
  const extra = MEASURED_TARGETS.filter((t) => !PINNED_MEASURED_TARGETS.includes(t));
  const gone = PINNED_MEASURED_TARGETS.filter((t) => !MEASURED_TARGETS.includes(t));
  if (!extra.length && !gone.length && MEASURED_TARGETS.length === PINNED_MEASURED_TARGETS.length) {
    ok(`被量的那份单子跟这里钉住的 ${PINNED_MEASURED_TARGETS.length} 个逐个对得上`
      + '（单子在 scripts/theme-text-targets.js，钉子在本节）');
  } else {
    bad(`被量的那份单子跟这里钉住的对不上：单子 ${MEASURED_TARGETS.length} 个 / 钉住 `
      + `${PINNED_MEASURED_TARGETS.length} 个 · 单子里多出来 ${extra.length} 个`
      + `（${extra.join(' · ') || '无'}）· 单子里少掉 ${gone.length} 个（${gone.join(' · ') || '无'}）`
      + ' —— 要改单子就连本节的 PINNED_MEASURED_TARGETS 一起改。「该量到多少」不许从单子自己算出来。'
      + '#1083 条 ① 在隔离树上真跑过两种改法，**它们的症状不一样**（下面这两句说的都是'
      + '**装上本节这个钉子之前**的样子 —— 你现在看到的这条红就是它装上之后的样子）：删掉三张表'
      + '都写了的两个（.cta-banner__headline / .cta-banner__desc），第 ⑩ 节会少量 660 对、分母从'
      + ' 2640 静默变成 1980，而那时整套照样报全过；删掉三张表一条都没写的那两个'
      + '（.btn-primary / .btn-accent），连对数都不动（还是 2640）—— 后一种连第 ⑩ 节都看不见，'
      + '只有本节这个「钉内容」的钉子抓得住，钉个数的版本对它全绿');
  }
}

// ── ⑨ 配色 × 主题表 × 色相滑块的每一个取值（#1038 r3） ──────────────────────────────────────────
//
// 🔴 上面第 ① 节判的是**按钮**（那两处颜色住在 globals.css）。而页面上还有一大批字的颜色是**主题表
// 自己写的** —— hero 的标题、cta-banner 的两行、page-header、导航链接。这一节把那些配对从三张表里
// **解出来**判，并且跟**色相滑块**叠起来：滑块是 #1006 已经上线的旋钮，站主选了配色之后照样能拖它
// （本票 AC4c 就要求配色在拖过之后还在），所以「配色 + 某个角度」是本票明确保证会出现的状态。
//
// 立这一节的直接原因：QA3 在 r2 上量到 violet + 滑块 −15° ⟹ `.cta-banner__desc` 掉到 4.45:1，而 r2
// 的 18 格读数**全部是滑块归零时量的**，枚举里没有那一格。机理、以及三处「往严的方向兜」写在
// `scripts/theme-contrast.js` 的文件头。
//
// 🔴 判的不是「把声明出来的 token 两两配对」：破线那一对根本不是两个 token —— `.cta-banner` 的底是
// 一条渐变，字压着的是渐变上一个混色。
//
// 🔴 #1072 —— 下面这两个绑定把第 ⑨ 节的**同一个判据**借给第 ⑩ 节（那一节枚举的是注册表里的
// **每一套**配色，2026-08-18 是 110 套 —— 原来这里写着「那 30 套」，而 #1016 之后它早就不是 30 了，
// #1083 条 ④ 顺手改；那一节报告里的数是现算的）。借的是函数本身而不是抄一份：两份实现必然分叉，而分叉在这里是静默的（一节绿、一节红，
// 读的人分不出是配色群不同还是判据不同）。
let sheetsForRegistrySweep = [];
let judgeSheetForRegistrySweep = null;
{
  const fs = require('fs');
  const path = require('path');
  const contrast = require('./theme-contrast.js');
  const { MEASURED_TARGETS } = require('./theme-text-targets.js');

  const themeDir = path.join(__dirname, '..', 'public', 'themes');
  const bandsFile = path.join(__dirname, 'theme-text-bands.json');
  if (!fs.existsSync(themeDir)) die(`找不到 ${themeDir} —— 这一节会整节空过`);
  const sheets = fs.readdirSync(themeDir).filter((f) => f.endsWith('.css')).sort();
  if (!sheets.length) die('public/themes 下一张表都没有 —— 这一节会整节空过');

  let bands = { sheets: {} };
  try { bands = JSON.parse(fs.readFileSync(bandsFile, 'utf8')); } catch { /* 下面按「没有这一格」处理 */ }
  const md5 = (file) => require('crypto').createHash('md5').update(fs.readFileSync(file)).digest('hex');

  /**
   * 一组配色在色相偏 `hue` 度之后的 `--color-*` 表。
   * 顺序跟 `buildCustomCss` 一样：**先换成绝对值，再在它上面转色相**（反过来会让滑块变成空操作）。
   */
  const varsFor = (colors) => (hue) => {
    const out = {};
    for (const [group, shades] of Object.entries(colors)) {
      for (const [shade, hex] of Object.entries(shades)) out[`--color-${group}-${shade}`] = tweaks.shiftHue(hex, hue);
    }
    return out;
  };

  /**
   * 一组配色对一张表的全部判决。
   *
   * `colors` 是传进来的而不是直接读库 —— 下面的阳性对照要拿**一组已知会破线的值**跑同一个判据，
   * 两条路必须是同一个函数，否则对照证明的是另一段代码。
   *
   * @returns {{problems: string[], worst: object|null}}
   */
  // 🔴 #1072 加了第四个参数 `targets`：第 ⑩ 节要用**同一个判据**只判 CTA 那两行（理由写在那一节）。
  //    默认仍是 MEASURED_TARGETS，所以第 ⑨ 节一个字节都没变。
  const judgeSheet = (sheetFile, colors, hues, targets = MEASURED_TARGETS) => {
    const name = sheetFile.replace(/\.css$/, '');
    const css = fs.readFileSync(path.join(themeDir, sheetFile), 'utf8');
    const pairs = contrast.textPairs(css, targets);
    const varsAt = varsFor(colors);
    const problems = [];
    let worst = null;
    let judged = 0;
    const hits = [];
    const note = (r, selector) => { if (r && (!worst || r.ratio < worst.ratio)) worst = { ...r, selector, sheet: name }; };
    const hit = (r, selector) => hits.push({ ...r, selector, sheet: name });

    for (const pair of pairs) {
      // 整条渐变（或纯色）上最差的那个点。过了就不需要几何 —— 见 theme-contrast.js 文件头 ②。
      const wide = contrast.worstOverHue(pair, varsAt, undefined, hues);
      if (wide) judged += 1;
      if (!wide) {
        problems.push(`${name} ${pair.selector}：颜色解不出来（${pair.fg} on ${pair.bg.image || pair.bg.color}）`
          + ' —— 这一格什么都没判到，不许当成过');
        continue;
      }
      if (wide.ratio >= contrast.MIN_CONTRAST) { note(wide, pair.selector); continue; }

      if (!pair.bg.image || wide.t === null) {
        note(wide, pair.selector);
        hit(wide, pair.selector);
        problems.push(`${name} ${pair.selector}：${wide.ratio.toFixed(2)}:1 @色相 ${wide.hue}°`
          + `（底色 rgb(${wide.bgRgb})，纯色 —— 收窄不了，只能改配色）`);
        continue;
      }
      // 渐变：收窄到字真正压着的那一段。那一段是**几何**，由真浏览器量过存在 JSON 里。
      const entry = bands.sheets[name];
      const band = entry && entry.targets && entry.targets[pair.selector];
      const cmd = `node scripts/theme-text-bands.mjs <baseUrl> ${name} --write`;
      if (!entry || !band) {
        problems.push(`${name} ${pair.selector}：整条渐变上最差 ${wide.ratio.toFixed(2)}:1，要收窄到字真正压着的`
          + `那一段才判得了，而 scripts/theme-text-bands.json 里没有这一格 —— 跑 \`${cmd}\``);
        continue;
      }
      if (entry.md5 !== md5(path.join(themeDir, sheetFile))) {
        problems.push(`${name} 这张表改过了（md5 对不上），存着的那段几何读数作废 —— 重跑 \`${cmd}\``);
        continue;
      }
      const narrow = contrast.worstOverHue(pair, varsAt, band, hues);
      note(narrow, pair.selector);
      if (narrow.ratio < contrast.MIN_CONTRAST) {
        hit(narrow, pair.selector);
        problems.push(`${name} ${pair.selector}：${narrow.ratio.toFixed(2)}:1 @色相 ${narrow.hue}°`
          + `（渐变上 t=${narrow.t.toFixed(3)}，底色 rgb(${narrow.bgRgb})）`);
      }
    }
    // `judged` = 真的取到读数的对数（不是解出来的对数）。第 ⑩ 节拿它当分母自检：
    // 选择器写错时 pairs 会是 0，而「一对都没量到」和「每一对都达标」在报告上长得一样。
    return { problems, hits, worst, pairs: pairs.length, judged };
  };

  // ── 存着的那段几何读数会不会已经过期(#1096 B8)─────────────────────────────────────────────
  //
  // 🔴 原来的 md5 核对住在 `judgeSheet` 的**渐变那一支**里,而那一支只在「整条渐变已经破线」时才
  // 到得了(前面 `wide.ratio >= contrast.MIN_CONTRAST` 就 `continue` 了)⟹ 给一张**通过的**表改
  // 内容而不更新 `theme-text-bands.json`,整套仍然 rc=0,存着的几何静默过期直到这张表哪天破线。
  // PM 在 #1083 上实测过这个形状(给 hero-media-top.css 追加一行注释,md5 变了,`node
  // scripts/theme-presets.test.js` 仍然 41 过 / 0 失败 · rc=0)。
  //
  // 🔴 台账那条说这个修法的代价是「每张表每次都读一遍文件」——**那笔代价不存在**:`judgeSheet` 本来
  // 就要 `readFileSync` 这张表,而这里每张表只算一次 md5(不是每套配色一次)。实测 `Buffer.from(css,
  // 'utf8')` 与直接读文件的 digest 逐字相同,所以从哪一串字节算都一样。
  //
  // 🔴 为什么这里是 ⚠️ 而不是 ❌ —— **这段话 2026-08-23(#1149 item 2)改过,先读这一段再读下面的历史。**
  // 那三份几何**已经重取过了**:三张表现在 0/3 过期(存 = 实际 = 01c8d568 / f2265847 / 49760fdc)。
  // 重取是真浏览器跑的,照 `theme-css-invariants-all-sheets.sh` 那条路:造 skipAI 演示站 → 撑开 →
  // 逐张表 `dress-site-in-theme.js` + `npm run build` → `python3 -m http.server` 服 out/ →
  // `node scripts/theme-text-bands.mjs <baseUrl> <sheet> --write`。三张表各一遍,约十分钟。
  // ⟹ 「重取要真浏览器」是真的,但它**不是做不动的活**,下一个人不用再把它当成拦路的东西。
  //
  // 🔴 那么为什么还是 ⚠️:**升成 ❌ 是一个判法上的决定,不是打磨。** 这三张表会被**整批重新生成**
  // (#1150 那次给 `.hero__form-error` 加钩子,83 张表全部重生),而每一次重生都让这三份几何过期。
  // 升成 ❌ 就等于「以后每一次加钩子都必须先跑一遍上面那十分钟,否则 main 红」。那笔账该由 #968 /
  // #1038 那条线的作者来算,不是本批次能替他定的。已在 #1096 的留言里摆给作者定夺。
  //
  // 📌 历史读数留在这里当出处(它们记的是**过期那段时间**的状态,不是现在):
  //     2026-08-19 (#1096, f110380e 与 a382db2b 两次读数相同)  实际 b0e49963 / 1a34e960 / c41b73ff
  //     2026-08-21 (#1134)                                     实际 b90ee644 / eb346671 / 139ffdeb
  //     2026-08-23 (#1149 重取前)                              实际 01c8d568 / f2265847 / 49760fdc
  //     存量(前两次都是,#1149 已改写)                            83b9bd9b / 7f6ae9bd / b35f4919
  //   「实际」那一栏每次都不同 ⟹ 表在这几次之间一直在被重生。**别拿任何一次写下来的 md5 当参照**。
  //   当时它影响不到任何判决:第 ⑩ 节 2640 对每一处都 ≥ 4.5:1 ⟹ 一对都没走进渐变那一支 ⟹ 存着的
  //   几何一次都没被读。今天同样如此 —— 只是它现在**新鲜**,而不是「过期但用不上」。
  {
    const stale = [];
    let checked = 0;
    for (const f of sheets) {
      const name = f.replace(/\.css$/, '');
      const entry = bands.sheets[name];
      if (!entry || !entry.md5) continue;
      checked += 1;
      const actual = md5(path.join(themeDir, f));
      if (entry.md5 !== actual) {
        stale.push(`${name}(存 ${String(entry.md5).slice(0, 8)} · 实际 ${actual.slice(0, 8)})`);
      }
    }
    if (checked === 0) {
      warn('theme-text-bands.json 里一张表都没有存几何读数 —— 这一格什么都没核对,不是「都新鲜」');
    } else if (stale.length === 0) {
      ok(`theme-text-bands.json 里 ${checked} 份几何读数的 md5 都还对得上它们那张表`);
    } else {
      // 🔴 #1149 item 2 —— **这一支现在是「真的有东西过期了」,不再是「今天本来就这样」。**
      //    #1096 / #1134 那两轮它 3/3 恒响,于是「真的刚被弄坏」和「今天本来就这样」长得一模一样;
      //    #1149 用真浏览器重取了那三份几何,干净 main 上现在是 0/3 ⟹ 这一句响就是有事发生。
      // 🔴 最可能的那件事:有人重生过 public/themes 里的表(加一条钩子会让 83 张全部重生,#1150 就是
      //    那样)。那不是错,只是那三份几何跟着作废了 —— 补法是下面那条命令,约十分钟,走法写在
      //    上面那段注释里。
      // 🔴 「实际」那一栏每次都不同,所以**别拿任何一次写下来的 md5 当参照**,那是这一格自己现算的。
      warn(`theme-text-bands.json 里 ${stale.length}/${checked} 份几何读数**已经过期**:${stale.join(' · ')}`
        + ' —— 那张表改过了,存着的那段几何是关于旧字节的。哪天这张表破线,判它的就是一份过期几何。'
        + ' 🔴 #1149 起这一句**不再是背景噪音**:那三份几何 2026-08-23 用真浏览器重取过,'
        + ' 干净 main 上是 0/3 ⟹ 你现在看到它响,就是有东西真的变了。'
        + ' 最可能的那件事:有人重生过 public/themes 里的表(给块加一条钩子会让 83 张全部重生)。'
        + ' 补法约十分钟,走法写在源码里这一段上面的注释里,一句话版是:造 skipAI 演示站 → 撑开 →'
        + ' 逐张 dress-site-in-theme + npm run build → 服 out/ →'
        + ' `node scripts/theme-text-bands.mjs <baseUrl> <name> --write`。'
        + ' 🔴 这一句只出声、不计进失败数(升成 ❌ 是判法决定,归 #968 / #1038 那条线的作者)'
        + ' —— 不许当成「核对过了」。');
    }
  }

  // 分母自检：每张表解出来的配对数必须**等于** ⑨a 钉住的那个数。
  //
  // 🔴 这里原来的判据是「每张表 ≥ 4 对」，而单子上有 10 个选择器、每张表解得出 8 个 —— 也就是说
  // 那条判据容得下「单子被砍掉一半」。#1083 条 ① 在隔离树上真跑过：删掉两个选择器，这一格照样绿。
  // 「至少几对」这种下界判据在这里没有意义：该有几对是**知道的**，就按知道的判。
  {
    const rows = sheets.map((f) => ({
      name: f.replace(/\.css$/, ''),
      n: contrast.textPairs(fs.readFileSync(path.join(themeDir, f), 'utf8'), MEASURED_TARGETS).length,
    }));
    const off = rows.filter((r) => r.n !== PINNED_RESOLVED_PER_SHEET);
    const shown = rows.map((r) => `${r.name}=${r.n}`).join(' · ');
    if (!off.length) {
      ok(`从 ${sheets.length} 张主题表里解出被量的配对，每张都是钉住的 ${PINNED_RESOLVED_PER_SHEET} 对：`
        + `${shown}（被量的选择器共 ${MEASURED_TARGETS.length} 个，单子在 scripts/theme-text-targets.js，`
        + '这两个数由 ⑨a 钉住）');
    } else {
      bad(`${rows.length} 张主题表里有 ${off.length} 张解出的配对数不是钉住的 `
        + `${PINNED_RESOLVED_PER_SHEET} 对：${off.slice(0, 6).map((r) => `${r.name}=${r.n}`).join(' · ')}`
        + `${off.length > 6 ? ` …共 ${off.length} 张` : ''} —— 要么单子被改了（连 ⑨a 的`
        + ' PINNED_RESOLVED_PER_SHEET 一起改），要么某个选择器名写错了、或某张表真的少写了一条规则');
    }
  }

  // 判哪几条:见下面 judgeButtons 上方那段注释（#1055 条 9）。
  //
  // 🔴 #1084 —— 谓词从 `p.bg.group !== undefined` 改成「底色不是字面色」。它们在本票之前是同一件事，
  // 之后不是：`.btn-primary:hover` 的底色现在是 `{computed:'hoverShade'}`（算出来的那一档），它**没有**
  // `group` 字段，于是旧谓词把它划进「留在外面」，而下面那行会把它的理由印成「底是固定白、动的是字」
  // —— 对它是假的。后果不是印错一句话：它在本票之前是被这一节判着的那 4 条之一，改完就静默掉出去了，
  // 而条数仍然是 4（`.btn-secondary:hover` 补了进来）⟹ 分母自检也看不出来。
  // 真正区分这两类的是「底色跟不跟着配色走」，字面白那条才是不跟的。
  const isLiteral = (spec) => spec.hex !== undefined;
  const JUDGED_BUTTON_PAIRS = BUTTON_PAIRS.filter((p) => !isLiteral(p.bg));
  const SKIPPED_BUTTON_PAIRS = BUTTON_PAIRS.filter((p) => isLiteral(p.bg));

  // #1055 条 9 —— 按钮那一段自己的分母，连同它**没判**的那条一起说出来。
  // 「这一节判了几条」和「哪条被留在外面、为什么」是两个读数，而只打前一个的话，
  // 把某条悄悄拿掉会跟从来没有过它长得一模一样。
  {
    const named = (list) => (list.length ? list.map((p) => p.what).join(' · ') : '（没有）');
    if (JUDGED_BUTTON_PAIRS.length >= 4) {
      ok(`从 globals.css 现解出 ${BUTTON_PAIRS.length} 条按钮配对，这一节判其中 `
        + `${JUDGED_BUTTON_PAIRS.length} 条（底色跟着配色走的那些）：${named(JUDGED_BUTTON_PAIRS)}`
        + ` · 留在外面 ${SKIPPED_BUTTON_PAIRS.length} 条（底是固定白、动的是字）：`
        + `${named(SKIPPED_BUTTON_PAIRS)} —— 它们在上面第 ① 节判过（滑块归零那一档），`
        + '要不要连色相一起判见本函数上方那段注释（#1055 条 9）');
    } else {
      bad(`按钮那一段只解到 ${JUDGED_BUTTON_PAIRS.length} 条有 token 底色的配对（${named(BUTTON_PAIRS)}）`
        + ' —— 期望至少 4 条（btn-primary / btn-accent 各含 hover），这一节会空过');
    }
  }

  /**
   * 按钮那两处也要过一遍色相滑块。
   *
   * 🔴 为什么单独一段：`.btn-primary` / `.btn-accent` 的颜色写在 `globals.css`，**主题表里没有**，
   * 所以上面从表里解配对时解不到它们，而第 ① 节只在滑块归零那一档判过。色相偏移**保住每个颜色
   * 自己的相对亮度**，纯色底上因此几乎不动对比度 —— 但那是个应该被量出来的性质，不是可以直接
   * 拿来当结论的断言。这一段就是把它量了。
   *
   * 🔴 #1055 条 9 —— 配对改成从 globals.css 现解（`BUTTON_PAIRS`），这里原来抄的是四行常量。
   *
   * 🔴 **判的仍然是「底色跟着配色走」的那几条**，也就是恰好原来那四行。`.btn-secondary` 是
   * primary-500 的字压页面的白底：底是固定的，动的是字，而这一段的算法（`mixBytes(fg, bg,
   * PAINT_BLEND)`，把字色往底色里掺一点再比）是为「字色固定、底色跟着配色走」写的。把它一起判
   * **不是没有代价的**：实测 forest 那一组在色相 −15…−3° 上读到 4.45–4.49:1，也就是 CI 当场变红。
   * 那个红是真是假、门槛该不该对这一条也是 4.5 —— 那是产品判断，不是打磨批次能顺手拍的板，而
   * 「会让 main 变红的东西」按本票正文第 3 条本来就不许进这一批。所以这里**明确地**只判有 token
   * 底色的那几条，并且下面把判了几条、留了哪条打印出来 —— 少判一条不许是静默的。
   */
  // 🔴 #1072 r3 加了 `hits`：跟 `judgeSheet` 对齐，回**每一处**破线（带它是在哪一档色相上破的），
  //    不只回人话。下面那个阳性对照的「非 0 档破线」那一半要数它 —— 在此之前那一半只数表里的命中，
  //    而「归零那一档全绿」那一半是表 + 按钮一起数的。**同一个对照，两半的射程不一样**，于是
  //    「破线只落在按钮上」的夹具会被判成「整个区间都没破线」。今天选中的那一组正是这种。
  const judgeButtons = (colors, hues = contrast.hueSteps()) => {
    const problems = [];
    const hits = [];
    let worst = null;
    for (const hue of hues) {
      const shift = (hex) => tweaks.shiftHue(hex, hue);
      const rows = JUDGED_BUTTON_PAIRS.map((p) => [p.what, ...pairColours(p, colors, shift)]);
      for (const [what, fg, bg] of rows) {
        const bgRgb = contrast.hexToRgb(bg);
        const r = contrast.contrast(contrast.mixBytes(contrast.hexToRgb(fg), bgRgb, contrast.PAINT_BLEND), bgRgb);
        if (!worst || r < worst.ratio) worst = { ratio: r, hue, what };
        if (r < contrast.MIN_CONTRAST) {
          hits.push({ ratio: r, hue, sheet: 'globals.css', selector: what });
          problems.push(`globals.css 「${what}」：${r.toFixed(2)}:1 @色相 ${hue}°`);
        }
      }
    }
    return { problems, worst, hits };
  };

  const hues = contrast.hueSteps();
  for (const [name, p] of Object.entries(presets.PALETTES)) {
    const problems = [];
    let worst = null;
    for (const f of sheets) {
      const r = judgeSheet(f, p.colors);
      problems.push(...r.problems);
      if (r.worst && (!worst || r.worst.ratio < worst.ratio)) worst = r.worst;
    }
    {
      const b = judgeButtons(p.colors);
      problems.push(...b.problems);
      if (b.worst && (!worst || b.worst.ratio < worst.ratio)) worst = { ...b.worst, sheet: 'globals.css', selector: b.worst.what };
    }
    if (!problems.length) {
      ok(`配色 ${name} × ${sheets.length} 张主题表 × 色相 ${hues[0]}…${hues[hues.length - 1]}° 共 ${hues.length} 档：`
        + `最差的一处是 ${worst.sheet} 的「${worst.selector}」= ${worst.ratio.toFixed(2)}:1 @${worst.hue}°`);
    } else {
      bad(`配色 ${name} 在色相滑块的某些取值上读不出来：\n     ${problems.join('\n     ')}`);
    }
  }

  // #1072：把这一节的判据与表清单借给第 ⑩ 节（见文件里那两个 let 的注释）。
  sheetsForRegistrySweep = sheets;
  judgeSheetForRegistrySweep = judgeSheet;

  // 🔴 阳性对照：一组「归零达标、某个色相取值才破线」的配色，跑**同一个** judgeSheet。
  //
  // 两条断言缺一不可，理由写在上面那个夹具的注释里：只断言「会报红」的对照，把色相那一维整个删掉
  // 之后照样是绿的 —— 那它就没在证明这一节存在的那件事。
  {
    const fixture = JSON.parse(JSON.stringify(presets.PALETTES.violet.colors));
    // #1100 —— 驱动的 token 从 `primary-500` 换成 `accent-400`，理由与读数在那两个常量上面。
    fixture.accent['600'] = HUE_ONLY_BREACH_ACCENT_600;

    // ① 滑块归零那一档：这组配色是达标的（否则它只是一组坏配色，跟色相无关）
    const atZero = [
      ...sheets.flatMap((f) => judgeSheet(f, fixture, [0]).problems),
      ...judgeButtons(fixture, [0]).problems,
    ];
    // ② 整个区间：有一格破线，而且破线的那一档不是 0°
    // 🔴 表 **和** 按钮一起数 —— 跟 ① 同一个射程。只数表的话，破线落在 globals.css 按钮上的夹具
    //    （今天选中的这一组就是）会被判成「整个区间都没破线」，而那句话是假的。
    const full = [
      ...sheets.flatMap((f) => judgeSheet(f, fixture).hits),
      ...judgeButtons(fixture).hits,
    ];
    const offZero = full.filter((h) => h.hue !== 0);

    if (atZero.length) {
      bad('阳性对照的夹具退化了：它在**滑块归零**那一档就已经破线，所以它证明不了色相那一维'
        + `有用（把 hueSteps() 改成只回 [0]，它照样报红）—— 重挑一组，挪 primary-500，见夹具注释。\n     ${atZero.join('\n     ')}`);
    } else if (!offZero.length) {
      bad('阳性对照的夹具退化了：整个色相区间里一格都没破线 —— 判据对它是恒绿的，'
        + `重挑一组，挪 primary-500，见夹具注释。（归零那一档：全绿，共 ${full.length} 条命中）`);
    } else {
      const shown = offZero.reduce((a, b) => (b.ratio < a.ratio ? b : a));
      ok(`阳性对照：violet 把 accent-600 挪到 ${HUE_ONLY_BREACH_ACCENT_600} ⟹ **滑块归零那一档全绿**，`
        + `而拖到 ${shown.hue}° 时 ${shown.sheet} 的「${shown.selector}」掉到 ${shown.ratio.toFixed(2)}:1 —— `
        + '这一格证明的是色相那一维真的在判事，不只是「坏配色会被判红」');
    }
  }
}

// ── ⑩ 三张手写表 × **`themes.js` 里的每一套配色**（#1072）───────────────────────────────────────
//
// 🔴 枚举的是 `Object.keys(themes)` —— 今天是 110 套（#1016 落地后：80 套池 + 30 套冻结退役的）。
// 报告里那个数是现算的；这段注释里写「110」的地方都注明了是 2026-08-18 量的，别当常数用。
//
// 🔴 为什么这一节是新的：上面第 ⑨ 节枚举的是**6 组预设配色**（站主在 Customize 里能挑的那六个），
// 而这三张手写表在校准时穿的是**样例站自己那套主题的配色** —— 也就是 `scripts/themes.js` 里的一套，
// 由轮换序号决定是哪一套（`theme-css-invariants-all-sheets.sh` 把站的 themeId 交给构建）。
// **那一群从来没有任何东西枚举过**，而 #1072 要治的两条读数正好都在那一群里：
//     midnight → `.cta-banner__headline` 3.21:1 / `.cta-banner__desc` 3.08:1   （#1046 的 QA2）
//     jade-60  → 4.00:1 / 3.96:1                                              （#1016 r4 的 QA2）
// 第 ⑨ 节当时是绿的（预设那一群最差 4.56），所以「测试全绿」跟「这三张表没问题」是两件事 ——
// 这张票在两个打磨批次里各漂过一次，靠的就是没人枚举这一群。
//
// 🔴 这一群是「校准语料」的射程，不是客户的射程，两句话都要说准：注册表里没有任何一套主题叫
// `hero-media-*`，而一个站穿哪张表由它自己的主题名决定（`create-site.js:907` → `theme-sheet.js:41`），
// 所以**没有客户的站会穿上这三张表**。它们的读数之所以承重，是因为 #1011 AC3、CI 那道运行时检查、
// 以及别的票拿它们校准量法 —— 一份自己都不合格的语料，拿它校准出来的读数没法当依据。
//
// 判据跟第 ⑨ 节同一个函数（`judgeSheet`），只换枚举的配色群，所以两节不会分叉。色相那一维这里
// **只取归零那一档**：滑块是站主对**自己的站**做的事，而这三张表没有站，取全区间只会把这一节
// 变成第 ⑨ 节的重复。
//
// 🔴🔴 这一节判**被量的每一个选择器**，不是只判 CTA 横幅那两行（#1072 第三轮改的，Chris 把 #1068
// 条 7 并进本票时点的就是这件事）。前两轮它只判 CTA，理由是「别的选择器那批破线不属于本票，一起判会
// 让 main 变红」—— 那个理由在第三轮不成立了，因为第三轮把那批破线**治掉了**：
//
//     改前（110 套配色 × 3 张表 × 8 个解得出来的选择器 = 2640 对）：194 处低于 4.5:1
//        `.announcement-bar__link` 192 处（hero-media-top 102 · hero-media-right 90，最差 1.69:1 magenta-14）
//        `.page-header__sub` 1 处 · `.services-nav__link` 1 处（都是 golden-yellow/hero-media-right 4.27:1）
//     改后：**0 处**
//
// 🔴🔴 **这一节判的是 `MEASURED_TARGETS` 那 10 个，而三张表一共给 441 个元素写了 `color:`。**
// 「一处不漏」不能按这一节的射程算，所以 #1072 r3 另外量了两圈（读数是 2026-08-18 的，命令写在
// 本票的交接留言里，两圈都是「从表里现解出选择器」，不喂任何单子）：
//     · **超集** 441 个元素 × 110 套 = 48510 对 ⟹ 改前 5827 处破线（187 条声明），改后 5450 处（151 条）。
//       这一圈**今天没有任何东西在判**：里面大量是刻意压低的装饰件（`.feature-comparison__mark--no`
//       最差 1.26、`.divider__label`、图标、星级），而 4.5:1 是**文字**那条尺。它是读数，不是判据。
//     · **真机在判的那一集** = `block-roles.json` 里 role=essential 的 7 个块里的每一段字
//       （`theme-css-invariants.mjs` §② 量的就是它们）：86 个元素 × 110 套 = 9460 对 ⟹
//       改前 976 处（36 条声明），改后 **613 处（7 条）**。
//       🔴 #1083 条 ④ —— **613 这个数是按 4.5:1 数的，而 §② 判的门槛是 2.5:1**
//       （`theme-css-invariants.mjs` 的 `MIN_ESSENTIAL_INK_CONTRAST`）。所以它读不成
//       「真机会在这一集上报 613 处红」。同一集、同一天（2026-08-18）、改成 §② 那把尺再数一遍：
//       **209 处低于 2.5:1**（最差 1.21:1）。两个数都复算过：按 4.5 数得到 613，逐字对上 #1072 r3
//       写下的那个数 —— 元素集的枚举法一样：三张手写表里凡是给 `block-roles.json` 中 role=essential
//       那 7 个块写了 `color:` 的选择器，**31 · 30 · 25 = 86 条，全部解得出底色（解不出的 0 条），
//       86 × 110 套 = 9460 对**，也就是 #1072 r3 写的那两个数本来就是对的。
//       🔴 #1083 r2 —— 上一版在这里另写了一组分母（8470 对），并且说 #1072 的 9460 把「解不出来的」
//       算进了分母：**都不成立**，而且它跟本段上面那句「86 个元素 × 110 套 = 9460 对」自相矛盾 ——
//       正是这张票要治的那个病，被 QA1 抓住。别再从这一段里读第二个分母；枚举当场可复算：
//         node -e "const r=require('../src/lib/sections/block-roles.json'),c=require('./theme-contrast.js'),fs=require('fs');
//                  const e=Object.keys(r).filter(k=>r[k]==='essential');
//                  for(const n of ['hero-media-left','hero-media-right','hero-media-top']){
//                    const css=fs.readFileSync('../public/themes/'+n+'.css','utf8'),d=new Set();
//                    for(const{sel,decls}of c.parseSheet(css)) if(decls.color&&e.some(b=>sel.includes('.'+b))) d.add(sel);
//                    console.log(n, [...d].length, c.textPairs(css,[...d]).length); }"
//         → hero-media-left 31 31 · hero-media-right 30 30 · hero-media-top 25 25   （2026-08-18）
//       🔴 而 §② 问的本来就不是同一个问题：它量的是**画出来的字离它背后多远**（照两张图，一张带
//       自己的字、一张不带），不是「声明出来的两个 token 之间的比值」。上面这两个数是本层算术在
//       两把尺上的读数，不是对 §② 判决的预测。
//       剩下的 7 条全部是同两种形状，
//       而它们**是产品判断、不是打磨**，已在交接留言里摆给 PM：
//         ① `.contact-form__error` / `.quote-form__error`（5 条）—— 要它 110 套全绿，全绿候选只有
//            `primary-800` / `primary-900` / `#000000`（左表那条只有 `#ffffff`）⟹ **错误提示不再是红的**。
//         ② `.services-list__icon`（2 条）—— 同上，而且它是**图标不是文字**，非文字那条尺是 3:1。
//       📌 `#ffffff` / `#000000` 这条路本身也被 §4（#1003「受限 CSS 不许字面色值」）挡着：实测写进
//          左表 4 处 ⟹ `CSS contract violations (4)`、构建被拒。所以「换个字面色」不是一个可选项。
//
// 那 194 处压在**四条声明**上（hero-media-right 三条 · hero-media-top 一条），全部是「随手挑一对颜色
// 而不量」：`.announcement-bar__link` 写 `color: var(--color-accent-600)` 压在 `primary-50` / `primary-100`
// 的浅底上，而 accent-600 落在那两个浅底上时 110 套配色里 90–102 套低于门槛 —— 等于在配色上赌，而它
// 八成会输。改成 `primary-800` 之后 110 套里 0 套破线（最差 5.60:1）。逐档量过的候选：
//
//     底 primary-50    primary-600 破线 6/110 · primary-700 破线 1/110 · primary-800 破线 0（最差 5.76）
//     底 primary-100   primary-600 破线 67/110 · primary-700 破线 1/110 · primary-800 破线 0（最差 5.60）
//
// 🔴 **收窄到 CTA 那半没有了，所以那句「本节不判什么」也没有了。** 判据变宽之后，报告里的分母跟着
// 从 660 对变成 2640 对 —— 分母印在结论同一句话里，理由不变：一对都没量到时「0 处破线」跟「都达标」
// 长得一模一样。
//
// 🔴 会过期的数一律就地算，不写成常数（#1072 r2 立的规矩）：第一版把「52 处」写死在报告里，#1016 把
// 配色从 30 套扩到 110 套之后真数是 194，那句话当天就成了假的。上面注释里那几个数写清了是在多少套
// 配色上量的，报告里的是当天现算的。
{
  const { themes } = require('./themes.js');
  // 判被量的每一个选择器。单子只有 `theme-text-targets.js` 一处定义，真浏览器那侧读的是同一份 ——
  // 这里再抄一份就会出现「扩了一边、另一边悄悄还是老的」，而失败方向是变绿（#1038 r3 的理由）。
  const { MEASURED_TARGETS: JUDGED_TARGETS } = require('./theme-text-targets.js');
  const contrastHere = require('./theme-contrast.js');
  const fsHere = require('fs');
  const pathHere = require('path');
  const themeDirHere = pathHere.join(__dirname, '..', 'public', 'themes');
  // 🔴🔴 只有这三张**手写**表进这一节，而且是按名字点的，不是「public/themes 下所有表」。
  // 理由是 #1016 的裁定：那张票把池子扩到 80 套**生成**表，而每一份生成表是**为它自己那一套配色
  // 生成的**（`theme-pipeline/sheet-recipes.js` §pickInk 按那套配色挑字色），一个站穿哪张表也由它
  // 自己的主题名决定（`create-site.js:907` → `theme-sheet.js:41`）。所以「80 份表 × 110 套配色」
  // 这个笛卡尔积里绝大多数格子是**任何客户的站都做不出来的配对**，判它们等于拿真算术去量不存在的
  // 组合 —— #1016 r4 就是这么红的，PM 的处置是「改检查，不改主题表」。
  // 这三张手写表不一样：它们**没有**自己的配色（注册表里没有任何一套主题叫 hero-media-*），校准时
  // 穿的是样例站那套，所以「它们 × 每一套配色」才是真问题。
  // 📌 我是在一棵把本票与 review/1016 合起来的树上量到这件事的：那棵树里注册表 110 套 / 表 83 份，
  //    照「目录下所有表」写会一次判 18260 对。
  const HANDWRITTEN = ['hero-media-left.css', 'hero-media-right.css', 'hero-media-top.css'];
  const sheetsHere = sheetsForRegistrySweep.filter((f) => HANDWRITTEN.includes(f));
  const missing = HANDWRITTEN.filter((f) => !sheetsForRegistrySweep.includes(f));
  if (missing.length) {
    bad(`这一节点名的手写表有 ${missing.length} 张不在 public/themes 下（${missing.join(' · ')}）`
      + ' —— 少一张就等于那张没人判，不许当成过');
  }
  const names = Object.keys(themes);
  if (names.length < 10) {
    bad(`themes.js 只读到 ${names.length} 套主题 —— 这一节的分母塌了，不许当成过`);
  } else {
    const rows = [];
    let judged = 0;
    for (const name of names) {
      const colors = themes[name].colors;
      if (!colors || !colors.primary || !colors.accent) {
        bad(`主题 ${name} 没有可用的 colors —— 这一格什么都没判到`);
        continue;
      }
      for (const f of sheetsHere) {
        const r = judgeSheetForRegistrySweep(f, colors, [0], JUDGED_TARGETS);
        judged += r.judged;
        for (const p of r.problems) rows.push(`${name}: ${p}`);
      }
    }
    /**
     * 🔴 分母自检 —— 这一节该量到几对，是 ⑨a **写死**的那个数乘出来的，不是从表里现解出来的。
     *
     * 收窄选择器最容易出的错是选择器名写错：一对都没量到，而这一节照样报绿，跟「每一对都达标」
     * 长得一模一样。
     *
     * 🔴 #1083 条 ① —— 这里原来把分母也交给 `textPairs` 现解，于是「该量到多少」和「实际量到多少」
     * 同源：删两个选择器两边一起缩，差值恒为 0，实测 **39 过 / 0 失败 rc=0**，只有报告里那句
     * 「共 2640 对」静默变成「共 1980 对」。期望值必须来自被检查的数据之外，所以它现在是
     * `PINNED_RESOLVED_PER_SHEET × 表数 × 配色套数`。
     *
     * 🔴 条 ② 也靠这一条：判三张表那条路解不出任何配对时 `judged` 是 0，写死的分母让 `0 < 2640`
     * 报红；同源的分母那时是 `0 < 0`，为假，报绿。
     *
     * 🔴 并且把**没有任何一张表写的**那几个选择器印出来。今天是 `.btn-primary` / `.btn-accent`：
     * 这三张手写表一条都没碰过它们（`grep -c '\.btn-primary\|\.btn-accent'` = 0），按钮的脸是
     * `globals.css` 画的、由配色决定，第 ⑨ 节判的就是那一层。不印的话，「10 个选择器只量到 8 个」
     * 会被读成覆盖面缩了。
     */
    const resolvedPerSheet = sheetsHere.map((f) => ({
      sheet: f.replace(/\.css$/, ''),
      selectors: contrastHere
        .textPairs(fsHere.readFileSync(pathHere.join(themeDirHere, f), 'utf8'), JUDGED_TARGETS)
        .map((p) => p.selector),
    }));
    const expected = sheetsHere.length * PINNED_RESOLVED_PER_SHEET * names.length;
    const writtenByNone = JUDGED_TARGETS.filter(
      (t) => !resolvedPerSheet.some((s) => s.selectors.includes(t)),
    );
    const noneLine = writtenByNone.length
      ? `；被量的 ${JUDGED_TARGETS.length} 个选择器里有 ${writtenByNone.length} 个这三张表一条都没写`
        + `（${writtenByNone.join(' · ')}）—— 那是 globals.css 画的脸，第 ⑨ 节判它们`
      : '';

    if (judged !== expected) {
      bad(`这一节量到 ${judged} 对，而该有 ${expected} 对（${names.length} 套配色 × ${sheetsHere.length} 张表`
        + ` × ⑨a 钉住的 ${PINNED_RESOLVED_PER_SHEET} 对/张）—— 表里现解出来的是 `
        + `${resolvedPerSheet.map((s) => `${s.sheet}=${s.selectors.length}`).join(' · ')}。`
        + '选择器名或表名大概写错了，也可能单子被改窄了（那就连 ⑨a 的钉子一起改），报绿也是空的');
    } else if (rows.length) {
      bad(`${names.length} 套配色里，三张手写表有 ${rows.length} 处低于 ${MIN}:1 或读不出来：\n     `
        + rows.slice(0, 8).join('\n     ') + (rows.length > 8 ? `\n     …共 ${rows.length} 处` : ''));
    } else {
      ok(`${sheetsHere.length} 张手写表 × ${names.length} 套配色 × 被量的每一个选择器`
        + `（滑块归零那一档，共 ${judged} 对）：每一处都 ≥ ${MIN}:1${noneLine}`);
    }

    // 🔴 反向对照：判三张表那条路必须真的会报红（#1083 条 ②）─────────────────────────────────
    //
    // 为什么这一节需要自己的一个。第 ⑨ 节末尾那个阳性对照是**量过**的：它引起的 7 处破线
    // **全部**落在 `globals.css` 的按钮上，三张表那一层是 **0 处**（`sheetHits=0 btnHits=7`）——
    // 所以判三张表的那条路即使整个失效，那一格照样绿。改之前（`ce77e88b`）那条断言只数三张表，
    // 是有牙齿的；把射程扩到「表 + 按钮」修好了另一个洞，同时把这一个打开了。
    //
    // 🔴 不是「重挑一组配色」——那条路在这一层做不到（本票正文条 ②：最紧的那一对
    // `accent-600` 压 `primary-50` 在整个色相区间只摆动 0.026，比颜色的整数粒度还窄，算术不出来）。
    // 换的是做法：拿**上面刚刚逐套判过全绿的那一群里的一套**，只动一个 token，动到一个必然读不出来
    // 的值，再喂**同一个** `judgeSheetForRegistrySweep`。上面那一圈（`rows.length === 0`）就是这个
    // 对照的空白组 —— 原配色在这三张表上是干净的，所以报出来的红只能是这一个 token 引起的。
    //
    // 🔴 为什么动 `primary-800`：它在三张表里都承重，而且两个方向都占着（2026-08-18 实测）——
    //   hero-media-left  它是渐变的浅端（`.hero__title` / `.page-header__title` 压在上面），
    //                    又是 `.services-nav__link` 的**底**
    //   hero-media-right 它是 `.hero__sub` / `.cta-banner__desc` / `.page-header__sub` /
    //                    `.announcement-bar__link` / `.services-nav__link` 的**字**，底是 primary-50
    //   hero-media-top   同上，底是 primary-100；又是 CTA 渐变的浅端
    // 把它改成近白 ⟹ 三张表各自都有配对读不出来，所以这个对照对**每一张表**都说话，不是只对一张。
    //
    // 🔴 并且断言报出来的红**落在三张表上**，不是落在别处。这正是它要防的那个形状：第 ⑨ 节那个
    // 对照之所以对这一层失明，就是因为它的命中全跑到 globals.css 去了，而断言只问「有没有红」。
    {
      // 🔴 #1161 —— 原来是 `ocean-blue`，它在被下架的那 30 套里 ⟹ `themes['ocean-blue']` 现在是
      // undefined，下面那句自保当场报红（实测过，就是本次改这一行的起因 —— 自保是有牙的）。
      // 换成池里一套。这一格对 DONOR 的唯一要求写在上面：**它必须是刚刚逐套判过全绿的那一群里的**
      // （空白组 = 原配色在三张表上干净），而那一群就是 `themes` 的全部。
      const DONOR = 'magenta-01';
      const MUTATED_INK = '#fdfdfd';
      if (!themes[DONOR] || !themes[DONOR].colors || !themes[DONOR].colors.primary) {
        bad(`反向对照拿不到配色 ${DONOR}（themes.js 里没有它，或它没有 colors）—— 上面那圈绿没有对照兜着，`
          + '这不是通过。换一套上面判过的配色，改 DONOR');
      } else {
        const fixture = JSON.parse(JSON.stringify(themes[DONOR].colors));
        fixture.primary['800'] = MUTATED_INK;
        const hits = [];
        for (const f of sheetsHere) {
          hits.push(...judgeSheetForRegistrySweep(f, fixture, [0], JUDGED_TARGETS).problems);
        }
        const sheetNames = sheetsHere.map((f) => f.replace(/\.css$/, ''));
        const silent = sheetNames.filter((n) => !hits.some((h) => h.startsWith(`${n} `)));
        const elsewhere = hits.filter((h) => !sheetNames.some((n) => h.startsWith(`${n} `)));
        if (!hits.length) {
          bad(`反向对照：把 ${DONOR} 的 primary-800 改成 ${MUTATED_INK}（近白，压在它自己的浅底上）`
            + '，判三张手写表那条路**一处都没报红** —— 那么上面那一圈绿是空的，它证明不了这条路在判事');
        } else if (elsewhere.length) {
          bad(`反向对照报出来的 ${hits.length} 处里有 ${elsewhere.length} 处不属于这三张手写表`
            + `（${elsewhere.slice(0, 3).join(' / ')}）—— 这一节该量的就是表那一层，命中跑到别处去`
            + '就说明它量的不是这条路（第 ⑨ 节那个对照正是这么对本层失明的）');
        } else if (silent.length) {
          bad(`反向对照报了 ${hits.length} 处，但有 ${silent.length} 张表一处都没报`
            + `（${silent.join(' · ')}）—— 对照只对一部分表说话，剩下那些的判决路照样可能是死的。`
            + '换一个三张表都承重的 token');
        } else {
          ok(`反向对照：${DONOR} 的 primary-800 改成 ${MUTATED_INK} ⟹ 同一个 judgeSheet 在 `
            + `${sheetsHere.length} 张手写表上共报 ${hits.length} 处（每张表都有），而它没改过的那一版`
            + `就在上面那 ${judged} 对里判过全绿 —— 这一格证明的是「判三张表那条路真的会报红」，`
            + '不是「上面那圈绿是空的」');
        }
      }
    }
  }
}

console.log(`\n${fail ? '❌' : '✅'} theme-presets.test.js — ${pass} 过 / ${fail} 失败`);
process.exit(fail ? 1 : 0);
