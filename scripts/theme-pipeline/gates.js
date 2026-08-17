// ══════════════════════════════════════════════════════════════════════════════════════════════════
// gates.js — 一套候选主题进池前要过的四道闸（#1004，spec §4.9③ / §7.1）
// ══════════════════════════════════════════════════════════════════════════════════════════════════
//
//   ① 静态     tokens 对 schema · 受限 CSS 的选择器/属性/字面色值对契约
//   ② 动态     样例站真构建 + 无头浏览器读五条不变量，外加「钩子在【theme 那一份】CSS 里有规则」
//   ③ 相似度   跟池里已有的比，太像的打回
//   ④ 人审     Chris 翻图 —— 这一道不自动化，流水线只负责把图册摆好并停在这里
//
// 🔴 ②里那条「在 theme 那一份 CSS 里有规则」是本票**自己**实现的，不等 #996。
//    理由（本票 AC2 就是它的证人）：产物里的 CSS 不止一份 —— base.css（#1001）也会给同一批钩子
//    写规则，于是「每个 class 都有规则」这条在「主题漏写了整块」时照样绿。#996 正在把那条不变量
//    收窄成同一个口径，但它还没 ship；这道闸按自己的口径实现，两边将来对齐。
//
// 🔴 ①依赖 #1003 的 tokens schema（`scripts/lib/theme-tokens.js` + `schemas/theme-tokens.schema.json`）。
//    那张票在 QA 手上、还没落 main。**这里不写第二份 schema 检查** —— 两份必然分叉，而分叉的方向
//    是「流水线放过、建站时才炸」。模块不在就当场拒跑并点名那张票，不是静默跳过这道闸。
const fs = require('fs');
const path = require('path');
const cp = require('child_process');

const NEXT = path.resolve(__dirname, '..', '..');
const LINT = path.join(NEXT, 'scripts', 'theme-css-lint.js');
const INVARIANTS = path.join(NEXT, 'scripts', 'theme-css-invariants.mjs');
const TOKENS_LIB = path.join(NEXT, 'scripts', 'lib', 'theme-tokens.js');

// 契约 §1 的 class 钩子。②里那条自查用它。
// 🔴 从 `theme-css-lint.js` 的 `HOOKS` 派生，不再手抄一份（#1018 QA2 抓到的）：这里原来写死了
//    phase 1 那七个 hero 名字，cta-banner 搬完之后没跟上 —— 于是把某套主题里 cta-banner 那段规则
//    整个删掉，这道闸照样打「钩子 7 个,全部有规则」然后放行。后面 31 个块都要靠它。
//    读不到那个文件时给空清单，不是崩：②里那条「一个契约钩子都没有 ⟹ 这道闸没东西可看，不算通过」
//    会接住它 —— 跟这个文件其余部分同一个失败方向（拒跑，不放行）。
const { HOOK_CLASSES } = fs.existsSync(LINT) ? require(LINT) : { HOOK_CLASSES: [] };

// ── 「这份表真的给哪几个钩子写了规则」──────────────────────────────────────────────────────────────
//
// 🔴 判据是 postcss **解析出来的选择器**，不是表的原始字节（#1058）。原来这里对整份表跑一次
//    `/\.([A-Za-z_][\w-]*)/g`，于是「有规则」的字面意思是「这个名字带一个点出现在文件的某处」——
//    注释里算、属性值里算、散文里也算。外科实验（作者做的、PM 复现、我又复现一遍）：从真的出货表
//    `hero-media-left.css` 里把 `.faq-accordion__answer` 的规则块整块删掉、只留一行
//    `/* TODO: .faq-accordion__answer 以后再画 */`，旧判据照样判它「有规则」。
//
// 🔴 为什么现在改（前提变了，不是加严了口味）：#996 → #1015 → #1046 三轮都判「不修」，理由是
//    今天零现实命中 —— 而那句话成立是因为**表是人写的**。#1051 的生成器已经在 main 上
//    （`a52aa06d`），#1016 要拿它跑 60-80 套直接进池子。一个按「让每个钩子的名字出现在文件里」
//    优化的机器，正是这个文本判据唯一防不住的对手。
//
// 🔴 不自己写第二份解析：`hook-coverage.js`（就在这个目录里）已经用 postcss 的 `rule.selector`
//    回答同一个问题，而且它是本票那个外科实验里**唯一抓到**的那把（EXIT=1 逐字点名，原表 EXIT=0）。
//    抄一份必然分叉，而分叉的方向是「这把说画了、那把说没画」。
//    require 放在函数里而不是文件顶上：上面第 33 行有意容忍 `theme-css-lint.js` 不在（给空清单，
//    不崩），而 `hook-coverage.js` 顶层就 require 它 —— 顶上 require 会把那条容忍变成加载即崩。
//    调用方只在「产物里确实有钩子」时才走到这里，所以那条路上它一定在。
//
// 🔴 r2（QA3 抓到的）：「有规则」还要求**那条规则带着至少一条声明**。`.faq-accordion__answer {}`
//    改的像素是零，跟「名字只出现在注释里」同一个性质，只是换了个位置藏 —— 而它当时四道尺全部放行。
//    收紧写在 `hook-coverage.js` 的 `measureSheet` 里，不写在这里：那样这道闸和 #1051 自己那把尺
//    是同一句话，不会一把说画了、另一把说没画。误伤面量过是零（83 份表：3 套出货 + #1016 的 80 套池成员，
//    空规则块 0 个）。📌 本票正文 AC5 的表把 `hook-coverage.js` 列成「不改」—— 那一栏的读数是拿
//    **注释**那种形状取的，对空规则块不成立，交接留言里把这笔账写给 PM 了。
const HOOK_COVERAGE = path.join(__dirname, 'hook-coverage.js');
function hooksDeclaredIn(sheetText) {
  // eslint-disable-next-line global-require
  const { measureSheet } = require(HOOK_COVERAGE);
  const declared = new Set(HOOK_CLASSES);
  for (const h of measureSheet(sheetText).missingHooks) declared.delete(h);
  return declared;
}

const ok = (name, note) => ({ gate: name, pass: true, problems: [], note: note || '' });
const bad = (name, problems) => ({ gate: name, pass: false, problems });
// 🔴 这道闸**没量成** —— 跟「这套主题不合格」是两件事（#1062）。
//    `pass` 仍然是 false：没取到读数不是通过，而 `pass: null`（④ 人审用的那个）会被 run.js 的
//    `g.pass !== false` 算进「过了」。另挂一面 `instrument` 旗子，报告和退出码据它说真因。
const jammed = (name, problems) => ({ gate: name, pass: false, instrument: true, problems });

// 这棵树里的 theme-css-lint 会不会拒掉字面色值 —— 拿一个探针问一次，别问「文件在不在」。
//
// 🔴 为什么是行为自查而不是存在性检查（QA1 r1 量出来的）：这道闸依赖 #1003 的**两个**文件
//    （`scripts/lib/theme-tokens.js` 和被 #1003 改过的 `scripts/theme-css-lint.js`），而第一版
//    只守了前者。`origin/main` 上那份 lint 对 `.hero { background-color: #ff0000 }` 返回 **rc=0**
//    —— 也就是说在只有前者、后者还是旧版的树上，这道闸会**放行**契约明令禁止的写法，而它自己
//    报「① 静态 ✅」。存在性是行为的代理，代理会说谎；这里直接问那个行为。
let lintRejectsLiteral = null;   // 一个进程里只探一次
function lintCanSeeLiteralColours() {
  if (lintRejectsLiteral !== null) return lintRejectsLiteral;
  if (!fs.existsSync(LINT)) { lintRejectsLiteral = false; return lintRejectsLiteral; }
  const probe = path.join(fs.mkdtempSync('/tmp/theme-lint-probe-'), 'probe.css');
  fs.writeFileSync(probe, '/* theme-css-contract: v1 */\n.hero { background-color: #ff0000 }\n');
  const r = cp.spawnSync(process.execPath, [LINT, probe], { encoding: 'utf8' });
  fs.rmSync(path.dirname(probe), { recursive: true, force: true });
  lintRejectsLiteral = r.status !== 0;
  return lintRejectsLiteral;
}

// ── ① 静态：tokens 对 schema + 受限 CSS 对契约 ───────────────────────────────────────────────────
function gateStatic(candidate) {
  const problems = [];
  if (!fs.existsSync(TOKENS_LIB)) {
    return bad('① 静态', [`拿不到 tokens schema（${path.relative(NEXT, TOKENS_LIB)} 不在）——`
      + ' 它是 #1003 的交付，那张票还没落 main。这道闸不许在没有 schema 的情况下放行。']);
  }
  if (!lintCanSeeLiteralColours()) {
    return bad('① 静态', [`${path.relative(NEXT, LINT)} 在这棵树里【不拒绝字面色值】`
      + '（探针 `.hero { background-color: #ff0000 }` 拿到 rc=0）—— 那是 #1003 之前的旧版。'
      + '这道闸不许在只有一半依赖的情况下放行：tokens 有 schema 管，而契约那半会整个失效。']);
  }
  // eslint-disable-next-line global-require
  const tokensLib = require(TOKENS_LIB);
  problems.push(...tokensLib.validateTokens(candidate.tokens).map((p) => `tokens: ${p}`));

  const sheet = candidate.sheetPath;
  if (!sheet || !fs.existsSync(sheet)) {
    problems.push(`受限 CSS 找不到（${sheet}）`);
  } else {
    const r = cp.spawnSync(process.execPath, [LINT, sheet], { encoding: 'utf8' });
    if (r.status !== 0) {
      problems.push(...String(r.stdout || '').split('\n').filter((l) => l.trim().startsWith('/') || l.includes('—'))
        .map((l) => `contract: ${l.trim()}`));
      if (!problems.length) problems.push(`contract: theme-css-lint 退出码 ${r.status}`);
    }
  }
  return problems.length ? bad('① 静态', problems) : ok('① 静态');
}

// ── ② 动态：样例站真构建 + 五条不变量 + 钩子在 theme 那份表里有规则 ──────────────────────────────
//
// `buildSample(candidate)` 由调用方给：它负责把候选的 tokens 写进站的 brand.json、把表放进
// public/themes/，跑一次 `npm run build`，然后把产物目录和一个已经起好的 URL 交回来。
// 这一层不自己造站，因为「样例站长什么样」是调用方的事（图册用一个、CI 可能用另一个）。
function gateInvariants(candidate, { outDir, baseUrl }) {
  const problems = [];

  // ②a 五条不变量 —— 真浏览器读渲染后的页面
  const r = cp.spawnSync(process.execPath, [INVARIANTS, baseUrl], { encoding: 'utf8' });
  // 🔴 退出码 2 = 那个检查器说它没量成（#1062 让「这台机器没有浏览器」也落到这里，以前它是 1）。
  //    当场返回，不往下走 ②b：②b 读的是文件、没有浏览器也答得出，但「②b 一格」不是②。
  //    把没量成的那一格和量出来的那一格并进同一条 🔴，读的人分不出该去修机器还是修主题。
  if (r.status === 2) {
    // 那个检查器自己写的那几行照原样带出来（它说得出缺的是什么、去哪儿装），一行一条：
    // 60-80 套一起跑时，把四句话挤成一行会让每一套都变成一堵墙。
    //
    // 🔴 r2 —— 取的是【头两行 + 末两行】，不是 `slice(-4)`。原来那个写法成立的前提是「那个检查器
    //    永远只打四行」，而 #1062 r2 让它把仪器自己的报错原文一起带出来了（浏览器没下载时
    //    playwright 印的是七行一个框）⟹ 末四行正好把**第一行**挤掉，而第一行才是
    //    「🔴 cannot take the reading: …」这句身份声明。取两端的写法对行数不敏感。
    const all = String(r.stderr || r.stdout || '').trim().split('\n')
      .map((l) => l.trim()).filter(Boolean);
    const said = all.length <= 5 ? all
      : [...all.slice(0, 2), '…（完整的几行在那个检查器自己的输出里）', ...all.slice(-2)];
    return jammed('② 动态', ['invariants: 读不到（退出码 2，仪器问题不是主题问题）', ...said]);
  }
  if (r.status !== 0) {
    // 🔴 明细行的真实长相是【三个空格 + 一句话】（`theme-css-invariants.mjs:425` 打的是 `   ${p}`），
    //    既没有 `·` 也没有 🔴。第一版按「行首是 · 或含 🔴」过滤 ⟹ 一条明细都匹配不上，报告里只剩
    //    汇总那一行「🔴 2 invariant violation(s)」，读的人不知道是哪条不变量、哪个元素 —— QA1 r1
    //    量到的就是这个。判据现在按那个检查器**自己的结构**取：汇总打在
    //    `🔴 N invariant violation(s)` 那一行，明细全在它【之后】直到结束（同文件 :424-426）。
    const out = String(r.stdout || '').split('\n');
    const head = out.findIndex((l) => /🔴\s*\d+\s*invariant violation/.test(l));
    const lines = head >= 0
      ? [out[head], ...out.slice(head + 1)].map((l) => l.trim()).filter(Boolean)
      : [];
    // 🔴 兜底这一句留着，不许换成「一定是仪器坏了」：它管的是**我们没预料到的**失败方式，
    //    而现在能说出真因的那两支（退出码 2 在上面、明细行在这里）都不吃它。删了它，下一种未知
    //    失败就变成静默。这一支仍然算「这套主题没过②」—— 不知道是什么就不该替它认领一个身份。
    problems.push(...(lines.length ? lines.map((l) => `invariants: ${l.trim()}`)
      : [`invariants: 退出码 ${r.status}`]));
  }

  // ②b 🔴 本票自己那条：页面上出现的钩子，必须在【这套主题自己那份 CSS】里有规则。
  // 判据是「读 theme 那一份表」，不是「读产物里所有 CSS」—— 后者会被 base.css / 站自己的
  // Tailwind 产物顶过去，于是「主题整块没写」也全绿（AC2 驱动的就是这个形状）。
  const html = fs.existsSync(path.join(outDir, 'index.html'))
    ? fs.readFileSync(path.join(outDir, 'index.html'), 'utf-8') : '';
  const onPage = HOOK_CLASSES.filter((c) => new RegExp(`class="[^"]*\\b${c}\\b`).test(html));
  if (!onPage.length) {
    problems.push('theme coverage: 产物里一个契约钩子都没有 —— 这道闸没东西可看，不算通过');
  } else {
    const sheetText = fs.existsSync(candidate.sheetPath) ? fs.readFileSync(candidate.sheetPath, 'utf-8') : '';
    let declared;
    try {
      declared = hooksDeclaredIn(sheetText);
    } catch (e) {
      // 解析不了就没量成 —— 空清单会把 213 个钩子全报一遍，那是噪音不是读数。
      // （这条路在流水线里到不了：①静态先跑 `theme-css-lint.js`，它也用 postcss。）
      return bad('② 动态', [...problems, `theme coverage: ${path.basename(candidate.sheetPath || '')}`
        + ` 解析不了（${String(e.message).split('\n')[0]}）—— 这一格没量成，不算通过`]);
    }
    for (const c of onPage.filter((c2) => !declared.has(c2))) {
      problems.push(`theme coverage: 页面上有 ".${c}"，而这套主题自己的表里没有它的规则`
        + '（别的表兜底不算 —— 那样每套主题的这一块都长一个样）');
    }
  }
  return problems.length ? bad('② 动态', problems)
    : ok('② 动态', `钩子 ${onPage.length} 个,全部在这套主题自己的表里有规则`);
}

// ── ③ 相似度：跟池里已有的比 ─────────────────────────────────────────────────────────────────────
//
// 🔴 这一道是**机器**那半，不是 #963 那份 AI 图册评审。两者分工：这里用可复算的距离拦掉
// 「几乎一样」的候选（跑一次是毫秒级、不花钱），图册评审负责「看着像不像」那种人眼的判断。
// 距离拆成四项，各自归一化再加权 —— 一项完全相同不该把整体拖成「不像」。
function paletteDistance(a, b) {
  const shades = ['50', '500', '900'];
  const hex = (v) => {
    const m = /^#?([0-9a-f]{6})$/i.exec(String(v || ''));
    if (!m) return null;
    const n = parseInt(m[1], 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  };
  let sum = 0; let n = 0;
  for (const group of ['primary', 'accent']) {
    for (const s of shades) {
      const x = hex(((a.colors || {})[group] || {})[s]);
      const y = hex(((b.colors || {})[group] || {})[s]);
      if (!x || !y) continue;
      sum += Math.sqrt(x.reduce((acc, v, i) => acc + (v - y[i]) ** 2, 0)) / 441.67; // 0..1
      n += 1;
    }
  }
  return n ? sum / n : 1;
}

// ── settings：两种形状先翻成 CSS 变量值，再比 ─────────────────────────────────────────────────────
//
// 🔴 为什么必须先翻译（QA2 在 #1004 r4 量出来的，同一道闸第三次被「有一项算不出真读数」卡住）：
//    生成器产出的是**数值形状**（`radius: 4` · `density: 0.9` · `shadowStrength: 0.08`，
//    `generate.js:125-130`），而池里那 30 套是**枚举形状**（`radius: "subtle"` · `shadow: "soft"`）。
//    第一版按键取并集比字符串 ⟹ 只可能在 `buttonShape` 上偶然相等，这一项**结构性地只能是 0 或
//    0.2**，于是整道闸的上限死在 (0.45×1 + 0.2×1 + 0.15×0.2) / 0.80 = 0.8500 < 0.9 —— 一套颜色和
//    字体逐字照抄 `ocean-blue` 的候选端到端拿到「✅ 前三道全过」。
//
//    `"subtle"` 和 `4` 不是「不同」，是**不可比**。两种形状都能被翻成同一组 CSS 变量值，那才是
//    可比的东西，而它也正是「两套主题看起来像不像」真正取决于的东西：
//      枚举 radius:"subtle" → `--radius-lg: 0.5rem`      数值 radius:4 → `--radius-lg: 8px`
//    再把单位归一（1rem = 16px）⟹ 两边都是 8px，形状差异消失，剩下的是真的一样还是真的不一样。
//
// 🔴 翻译器只有一份：`src/lib/themeSettings.ts` 的 `settingsToCssVars` —— 构建和换装预览读的就是它。
//    这里**不抄第二份档位表**（抄了必然分叉，而分叉的方向是「闸算的像不像」跟「站上真正长什么样」
//    对不上，静默）。`.ts` 用一个子进程 import 进来，桥在 `settings-vars.mjs`。#1002 把那个函数搬进
//    `scripts/` 之后，这一段换成一句 require 就行。
const SETTINGS_VARS = path.join(__dirname, 'settings-vars.mjs');
const settingsVarsCache = new Map();   // JSON(settings) → Map(变量名 → 归一后的值)
let translatorTrouble = null;          // 请不动翻译器时的那句人话；null = 它是好的

// `0.5rem` 与 `8px` 是同一个长度 —— 比之前先把 rem 折成 px（根字号 16px，`globals.css` 没动过它）。
const normVarValue = (v) => String(v).toLowerCase()
  .replace(/(-?\d*\.?\d+)rem\b/g, (_, n) => `${Math.round(parseFloat(n) * 16 * 1000) / 1000}px`)
  .replace(/\s+/g, ' ').trim();

function runTranslator(payload) {
  // node 22 要 `--experimental-strip-types`；node ≥23 默认剥类型（那个开关仍然收，收不了就退回不带）。
  for (const argv of [['--experimental-strip-types', SETTINGS_VARS], [SETTINGS_VARS]]) {
    const r = cp.spawnSync(process.execPath, argv, { input: payload, encoding: 'utf8' });
    if (r.status === 0) return JSON.parse(r.stdout);
    if (!/bad option|not allowed|unknown|unrecognized/i.test(String(r.stderr || ''))) {
      // 报**说得出事的那一行**，不是 stderr 的最后两行 —— node 的最后两行是空行和版本号。
      const why = String(r.stderr || r.stdout || '').split('\n')
        .map((l) => l.trim()).filter((l) => /^(\w*Error|Cannot|SyntaxError)/.test(l))[0];
      throw new Error(why || `退出码 ${r.status}`);
    }
  }
  throw new Error('两种调用方式都跑不起来');
}

/** 一批 settings 一次翻完（一次 gateSimilarity 只起一个子进程），结果进缓存。 */
function warmSettingsVars(list) {
  if (translatorTrouble) return;
  const missing = [...new Set(list.filter(Boolean).map((s) => JSON.stringify(s)))]
    .filter((k) => !settingsVarsCache.has(k));
  if (!missing.length) return;
  try {
    const out = runTranslator(JSON.stringify(missing.map((k) => JSON.parse(k))));
    missing.forEach((k, i) => {
      const m = new Map();
      for (const decl of out[i] || []) {
        const at = decl.indexOf(':');
        if (at > 0) m.set(decl.slice(0, at).trim(), normVarValue(decl.slice(at + 1).replace(/;\s*$/, '')));
      }
      settingsVarsCache.set(k, m);
    });
  } catch (e) {
    // 🔴 翻不动就判「没法比」—— 这一项退出分母，分数只会变高、更容易拦，方向是安全的那一边。
    //    但必须**说出来**：静默少一维正是这道闸前四轮反复栽的那个坑。
    translatorTrouble = `settings 这一项没算：请不动 ${path.relative(NEXT, SETTINGS_VARS)}（${e.message}）`;
  }
}

function settingsVarsOf(settings) {
  if (!settings || !Object.keys(settings).length) return null;
  warmSettingsVars([settings]);
  const m = settingsVarsCache.get(JSON.stringify(settings));
  return m && m.size ? m : null;
}

/**
 * 一套候选跟池里某一套有多像 → { score, parts, identical }。`score` 是**能比的那几项**的加权平均。
 *
 * 🔴 「没法比」不等于「不像」，而第一版把这两件事写成了同一个 0（QA2 在 #1004 r2 量出来的）。
 * 分数是 `0.45×颜色 + 0.2×字体 + 0.15×settings + 0.2×版式`、阈值 0.9，而**版式那项在两条真路径上
 * 恒为 0**：`run.js --candidates` 那条以前把 `layout` 写死成 `{}`，生成器出的候选只有一个键
 * （`{hero:…}`）而注册表那 30 套各有 30 个键 —— 按并集算，对得上的比例约等于 0。于是上限恰好
 * **0.8000 < 0.9**：QA2 拿注册表 30 套逐个照抄 colors+fonts+settings，**30/30 全放过**，端到端跑一套
 * `clone-of-ocean-blue` 拿到「✅ 前三道全过」。这道闸在真路径上不可能开火，而它长得像在工作。
 *
 * 所以每一项现在可以回答 `null` = 这一项没法比（两边都没有可对照的东西），权重从分母里去掉：
 *   · 颜色：两边都解得出色阶才比；一边解不出（① 静态会先拦掉）→ null
 *   · 字体：按 heading / body 两格里两边都写了的那些比
 *   · settings：两边都翻得成 CSS 变量才比（见上面那段 —— 比的是翻译之后的值，不是字面值）
 *   · 版式：见下面那段 —— 判据是**取值在不在同一套词表里**，不是键在不在
 * 分母是被算进来的权重之和 ⟹ 一套颜色/字体/settings 全同的克隆拿到 1.000，而不是 0.800。
 *
 * 🔴🔴 第一版把版式那项的「能不能比」判在**键在不在**上，而那个判据对生成器真产出的候选是错的
 *      （QA1 在 #1004 r3 量出来的，第二次栽在同一个 0.8000 上）：
 *        注册表 30 套的 hero 取值是 gradient-overlay / split / centered / minimal / left / … 9 个
 *        生成器的   hero 取值是 with-media-left / with-media-top / text-only        3 个
 *        两个词表交集 = 0，而 30 套**每一套都有 hero 这个键**
 *      ⟹ 交集非空 ⟹ 判成「能比」⟹ 逐键比值，永远不等 ⟹ 恒等于 0.00，0.2 那份权重永远留在分母，
 *      上限又回到 0.45+0.2+0.15 = 0.8000 < 0.9。实测：拿 ocean-blue 的 colors+fonts+settings 原样抄进
 *      一套生成器形状的候选，三个 hero 取值各跑一遍注册表 30 套，**拦下 0/30**。
 *      「恒等于同一个数」不是读数 —— 它只是把所有人的分数一起按同一个比例压低，而阈值是绝对的。
 *
 *      所以现在问的是那个真性质：**这个键上，候选的取值在池子里出现过吗？**
 *        出现过 → 两边说的是同一套词表，取值不同就是真的「不像」，这一键照常比
 *        没出现过 → 两边说的是两套词表，判「没法比」，这一键不进分母
 *      它会自己跟着池子走：等新池里有主题也用 `with-media-left`，那个键当场变回能比的。
 *      方向也是安全的那一边 —— 判「没法比」只会让分数变高、更容易拦，而放过一套克隆是看不见的。
 *
 * `parts` 一起回传，报告里逐项打印：QA2 之所以能定位到这件事，是因为他自己手算了逐项分解 ——
 * 那份分解现在是读数的一部分，不用谁再手算一次。
 *
 * 🔴🔴 `identical` 是**加权分之外的一条充分条件**（Chris 2026-08-14 在 #1004 拍的板）：
 *      「两套主题：颜色逐字相同、字体逐字相同，只有一个 block 的形态不同 —— 算『几乎一样』。」
 *      所以颜色与字体**在能比的每一处都逐字相同**时（`parts.colour === 1 && parts.fonts === 1`
 *      —— 距离为 0 才会等于 1，一处都没比成时 `paletteDistance` 返回 1、`parts.colour` 是 0，
 *      拿不到这个 1），这一套直接判「几乎一样」，**不看加权分**。
 *
 *      为什么写成充分条件而不是调权重/降阈值（这张票为此走了四轮）：那道闸的分数**上限被结构性地
 *      压在阈值之下**，压它的是哪一项还会换 —— r3 是版式（上限 0.8000）、r4 是 settings（0.8500）。
 *      三轮调参数都没治住。而即使 settings 这一项现在算得出真读数，一套颜色+字体照抄的克隆仍然只有
 *        (0.45×1 + 0.2×1 + 0.15×0.40) / 0.80 = 0.8875 < 0.9
 *      ⟹ 想靠权重满足拍板那句话，就得让颜色+字体的分量压过其余全部，那等于把另外两项废掉。
 *      充分条件不经过分母那套算术，谁都压不低它；代价也说在明处：这条只咬**逐字相同**，
 *      差一个色阶的近似克隆仍然走加权分那条路。
 *      📌 收严的风险量过（作者 2026-08-14 在票上）：现有 30 套两两 435 对，按颜色+字体算最高 0.103；
 *      QA1 r4 那 30 套合法候选被拦 0 套 —— 这一条只会咬克隆。
 *
 * @param layoutVocab 池子在每个版式键上出现过哪些取值（`{ hero: Set(['split', …]) }`）。
 *        不传就按「池子里只有 existing 这一套」算 —— 单套池子的口径，跟 gateSimilarity 一致。
 */
// 🔴 一套主题「在这个版式键上认哪些值」—— 答案统一成一个集合，因为注册表和生成器的形状不一样
// （#1010）。注册表那 30 套现在写的是 `supports: { hero: ['with-media', …] }`（我为哪些形态写了
// 样式），而生成器写出来的候选仍然是 `layout: { hero: 'split' }`（一个值）。两种都在这个函数里，
// 老形状 = 单元素集合。
//
// 🔴 为什么必须在这里认第二种形状，而不是等它自己冒出来：这段代码**绕过 `layoutFor()` 直接读字段**，
// 而字段改名对"直接读"的一方是静默的 —— `(t||{}).layout` 对新形状答 `undefined`，于是词表是空的、
// `comparable` 是空的、`parts.layout` 变成 `null`，被加权平均**从分母里去掉**。这道闸不会报错，
// 它会少一维继续给分（权重 0.2 的那一维），而输出里那句 `layout 没法比` 是唯一的痕迹。实测：
// 用改名后的注册表跑，30 套逐套 `layout 没法比`；接上这个函数之后，30 套的读数与改名前**逐个相同**
// （改名把每个值转成「恰好含它一项的清单」，所以今天的算术一个数都不动）。
const layoutSetsOf = (t) => {
  const sets = new Map();
  for (const [k, v] of Object.entries((t || {}).layout || {})) {
    sets.set(k, new Set([String(v)]));
  }
  for (const [k, v] of Object.entries((t || {}).supports || {})) {
    sets.set(k, new Set((Array.isArray(v) ? v : [v]).map(String)));
  }
  return sets;
};
// 池子在每个版式键上出现过哪些取值。第③道用它判「候选说的是不是同一套词表」。
function layoutVocabOf(pool) {
  const vocab = new Map();
  for (const t of Object.values(pool || {})) {
    for (const [k, values] of layoutSetsOf(t)) {
      if (!vocab.has(k)) vocab.set(k, new Set());
      for (const v of values) vocab.get(k).add(v);
    }
  }
  return vocab;
}

function similarity(candidate, existing, layoutVocab) {
  const t = candidate.tokens || {};
  const e = existing || {};
  const parts = {};

  const paletteComparable = (x, y) => {
    const has = (o) => ['primary', 'accent'].some((g) => Object.keys(((o.colors || {})[g]) || {}).length);
    return has(x) && has(y);
  };
  parts.colour = paletteComparable(t, e) ? 1 - paletteDistance(t, e) : null;

  // 🔴 比的是**字体的名字**，不是它在 CSS 里的拼法：生成器给非通用字体族加了引号（否则
  // `Source Sans 3` 那条 font-family 整个非法，见 generate.js 里那段），而注册表那 30 套是不带引号
  // 的。不归一化的话 `"Inter"` 与 `Inter` 判成两种字体 —— 一套照抄注册表字体的克隆会拿到 fonts 0 分，
  // 正好把这一项变成又一处「长得像在工作」。
  const fontName = (v) => (v === undefined ? undefined
    : String(v).trim().replace(/^["']|["']$/g, '').toLowerCase());
  const fontSlots = ['heading', 'body'].map((slot) => {
    const a = fontName(((t.fonts || {})[slot] || [])[0]);
    const b = fontName(((e.fonts || {})[slot] || [])[0]);
    if (a === undefined || b === undefined) return null;
    return a === b ? 1 : 0;
  }).filter((v) => v !== null);
  parts.fonts = fontSlots.length ? fontSlots.reduce((a, b) => a + b, 0) / fontSlots.length : null;

  const vA = settingsVarsOf(t.settings); const vB = settingsVarsOf(e.settings);
  if (vA && vB) {
    const names = [...new Set([...vA.keys(), ...vB.keys()])];
    parts.settings = names.filter((k) => vA.has(k) && vB.has(k) && vA.get(k) === vB.get(k)).length
      / names.length;
  } else {
    parts.settings = null;
  }

  // 候选那一边是「一个值」（生成器写的 `<id>.layout.json`），池子那一边可能是「一个清单」
  // （注册表的 `supports`，#1010）—— 所以问的是「这一套认不认候选说的那个值」。对今天的 30 套
  // 来说每个清单恰好一项，这个问法与改名前的 `lA[k] === lB[k]` 逐个同值（读数在 layoutSetsOf 上面）。
  const lA = candidate.layout || {};
  const lB = layoutSetsOf(e);
  const vocab = layoutVocab || layoutVocabOf({ _: e });
  const comparable = Object.keys(lA).filter((k) => lB.has(k)
    && vocab.get(k) && vocab.get(k).has(String(lA[k])));
  parts.layout = comparable.length
    ? comparable.filter((k) => lB.get(k).has(String(lA[k]))).length / comparable.length : null;

  const WEIGHTS = { colour: 0.45, fonts: 0.2, settings: 0.15, layout: 0.2 };
  let num = 0; let den = 0;
  for (const [k, w] of Object.entries(WEIGHTS)) {
    if (parts[k] === null) continue;
    num += w * parts[k]; den += w;
  }
  // 颜色与字体在能比的每一处都逐字相同 ⟹ 「几乎一样」，不看加权分（见上面那段）。
  const identical = parts.colour === 1 && parts.fonts === 1;
  return {
    score: den ? num / den : null, parts, weighed: den, identical,
  };
}

const partsText = (parts) => Object.entries(parts)
  .map(([k, v]) => `${k} ${v === null ? '没法比' : v.toFixed(2)}`).join(' · ');

function gateSimilarity(candidate, pool, { max = 0.9 } = {}) {
  // 🔴 词表按**整个池子**建，不是按正在比的那一套：只跟一套比，分不出「同一套词表里换了个值」
  //    和「压根是两套词表」—— 两种情况下那个键的值都不相等。
  const vocab = layoutVocabOf(pool);
  // settings 那一项要起子进程翻译 —— 候选和池子一次翻完，一次 gateSimilarity 只起一个。
  warmSettingsVars([(candidate.tokens || {}).settings,
    ...Object.values(pool || {}).map((t) => (t || {}).settings)]);
  const scored = Object.entries(pool || {})
    .map(([id, t]) => ({ id, ...similarity(candidate, t, vocab) }))
    // 🔴 排序把「最需要说的那一套」放在最前：先是颜色+字体逐字相同的（拍板那条），再是一项都没法比
    //    的（没取到读数不是通过），最后才按分数从高到低。
    .sort((a, b) => (b.identical ? 1 : 0) - (a.identical ? 1 : 0)
      || (b.score === null ? 1 : 0) - (a.score === null ? 1 : 0)
      || b.score - a.score);
  const worst = scored[0];
  if (!worst) return ok('③ 相似度', '池子是空的');
  // 🔴 翻译器请不动时 settings 会整项缺席 —— 那件事必须写在读数旁边，不许静默少一维。
  const tail = translatorTrouble ? ` · 📌 ${translatorTrouble}` : '';
  const scoreText = worst.score === null ? '没法比' : worst.score.toFixed(3);
  if (worst.identical) {
    return bad('③ 相似度', [`跟池里的 "${worst.id}" 颜色和字体逐字相同（${partsText(worst.parts)}）`
      + ` —— 只有形态不一样也算「几乎一样」，拦下。这一条不看加权分（那个分数是 ${scoreText}）：`
      + `Chris 2026-08-14 在 #1004 拍的板${tail}`]);
  }
  if (worst.score === null) {
    return bad('③ 相似度', [`跟 "${worst.id}" 一项都没法比（${partsText(worst.parts)}）——`
      + `这道闸没取到读数，而没取到读数不是通过${tail}`]);
  }
  if (worst.score >= max) {
    return bad('③ 相似度', [`跟池里的 "${worst.id}" 太像（${worst.score.toFixed(3)} ≥ ${max}；`
      + `${partsText(worst.parts)}）—— 同一个行业的两个站抽到这两套，客人看不出区别${tail}`]);
  }
  return ok('③ 相似度',
    `最像的是 ${worst.id}（${worst.score.toFixed(3)} < ${max}；${partsText(worst.parts)}）${tail}`);
}

// ── ④ 人审 ───────────────────────────────────────────────────────────────────────────────────────
// 不自动化，也不假装自动化：流水线把图册摆好、把前三道的读数写在旁边，然后停在这里。
function gateHumanReview(candidate, { galleryDir, shot } = {}) {
  // 🔴 「图册在 X，等人翻」这句话得先成立才能说。第一版只看有没有传 galleryDir 就这么写了，
  //    而那时候一张候选的图都还没有 —— 一个人照着那句话打开目录，看到的要么是空的，要么是
  //    别人（注册表 30 套）的图。所以这里问的是**这一套自己的图拍成了吗**。
  // 🔴 #1061 —— 判据是**盘上有哪几张图**（`shot.shots`），不是 shoot.mjs 的退出码（`shot.ok`）。
  //    那个退出码是好几件事的或，其中一件为真时三张图仍然可能都在盘上；照它判就会对着一页
  //    摆得满满当当的图说「没有这一套的图，人无从翻起」。理由全文在 gallery.js 的 card() 头上。
  const got = (shot && shot.shots) || [];
  let note;
  if (!galleryDir) note = '没有传 --gallery ⟹ 这一轮没出图，人无从翻起';
  else if (!got.length) note = `🔴 ${galleryDir} 里没有这一套的图（${(shot && shot.log) || '这一轮没拍'}）—— 人无从翻起`;
  else if (shot.ok) note = `图在 ${path.join(galleryDir, 'public')}（${got.join(' / ')}），等人翻`;
  else {
    note = `图在 ${path.join(galleryDir, 'public')}（${got.join(' / ')}），等人翻`
      + ` —— 📌 但 shoot.mjs 这一轮退的不是 0：${(shot.log || '').split('\n')[0]}`;
  }
  return {
    gate: '④ 人审',
    pass: null,   // 🔴 null 不是 true：这一道没有机器能给的答案
    problems: [],
    note,
  };
}

module.exports = {
  HOOK_CLASSES,
  // 复核 ②b 的人要能不建站就问「这份表给哪几个钩子写了规则」—— 那正是本票换掉的那个判据（#1058）。
  hooksDeclaredIn,
  gateStatic,
  gateInvariants,
  gateSimilarity,
  gateHumanReview,
  similarity,
  layoutVocabOf,
  // 复核这道闸的人要看得到 settings 翻成了什么、翻译器活着没有 —— 别让他们自己去猜。
  settingsVarsOf,
  translatorTrouble: () => translatorTrouble,
};
