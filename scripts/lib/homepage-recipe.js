/**
 * homepage-recipe.js — 每个站一份**首页开场配方**，建站 AI 拿它当硬约束（#1034）。
 *
 * ── 要治的是什么 ────────────────────────────────────────────────────────────────────────────────
 * 2026-08-15 在 6 个真实站上量到（`scripts/homepage-fingerprint.js`，语料是 `ai1st-sites` 组织下
 * 的全部站仓库）：
 *
 *     前 2 块完全相同   15/15 个站对 = 100%     ← 六个站全是 `announcement-bar → hero`
 *     前 3 块完全相同   10/15        =  67%     ← 五个站接着 `stats-counter`
 *     前 4 块完全相同    2/15        =  13%
 *     块集合重合度中位数 0.818
 *
 * 也就是说**开场被锁死了**，而第 4 块之后顺序其实是变的（PM 在同一份语料上量的：每站 4-5 处逆序、
 * 15 个站对里 12 对的相对顺序不同）。所以这份配方只钉**开头四块**加**两个必须出现的块**，
 * 其余（3-6 块）照旧交给 AI —— 治的是那段锁死的开场，不是整条序列。
 *
 * ── 为什么是「每个站一个种子」而不是「跟已有站的指纹比」──────────────────────────────────────
 * 建站脚本跑在**每个站自己的容器**里，手上只有这一个站的 payload；别的站的首页在别的仓库、别的
 * 容器里，它读不到。所以差异只能来自「这个站自己有什么是别的站没有的」。
 *
 * 🔴 那个东西是 **siteId**，不是 `themeRotationIndex`（r1 用的是后者，PM 2026-08-16 退回）。
 *    `themeRotationIndex` 是 `SELECT COUNT(*) FROM sites WHERE user_id = $1`
 *    （`manager/sites.go:428-433`）——**这个用户已经有几个站**。它解得了「同一个人连建 N 个站」，
 *    解不了「N 个人各建第一个站」：那时它对每个人都是 0。平台库上的读数：116 个站 / 73 个用户，
 *    73 个站 index=0、33 个 index=1 ⟹ **91% 的站会落在两份配方上**。
 *    ⟹ 调用方（`create-site.js`）传的是 `rotationIndexFromSiteId(siteId)`。本文件只要一个数，
 *      谁给的不管；但那个数必须**按站**变，不是按人。
 *
 * 📌 这份配方能有多少种，是**枚举得出来**的，别当它无限（`homepage-recipe.test.js` 的 ⑪ 现算一遍，
 *    所以下面这几个数被改坏时会当场红）:
 *      整份配方  周期 `index % 308`，308 种互不相同 ⟹ 随机两个站**整份约束一样** 0.32%
 *      只看开场  **33** 种（周期是 池子 22 × BAR_EVERY 4 = 88，但带 announcement-bar 的那 1/4
 *                只用得上开场的后两格，所以合并成 33）⟹ 开场完全相同 **3.4%**
 *    对照:基线那 6 个真实站「前 2 块相同」100%、「前 3 块」67%、「前 4 块」13%（票面 AC1）。
 *    要再稀释就得动 `STRIDES`/`OFFSETS` 的选法，那会改变每个站的配方，是另一张票的事。
 *
 * ── 关掉它（#1034 AC3 的反向对照）──────────────────────────────────────────────────────────────
 * payload 里 `"homepageFingerprint": false` ⟹ 整套约束不参与，提示词逐字回到改动之前。
 * 用的是既有的 payload 开关写法（`input.skipAI` 同一个套路），不是只为测试开的环境变量后门。
 */

'use strict';

/**
 * 不进配方池的 homepage 候选，每一个都写清楚为什么。
 * 🔴 这份名单靠 `poolFor()` 里那句「名字必须还在」自检兜着 —— 有人把块改名时，
 *    静默地把它放回池子里是最坏的失败方向（例如 service-related-pages 跑到首页上）。
 */
const NOT_IN_POOL = {
  'hero': '它自己就是开场的主角，位置由配方另外钉（第 1 或第 2 块）',
  'announcement-bar': '只当 hero 前面那一格用，不参与后面的抽取',
  'divider': '是分隔线不是内容块，摆在开场里没有意义',
  'cta-banner': '收尾用的，钉在开场会把行动召唤提到读者还没读内容的位置',
  'newsletter-signup': '同上，属于页面末尾',
  'service-related-pages': 'blocks/service-related-pages.json 自己写着 "Use ONLY on service detail pages"',
};

/** 抽取用的步长与偏移。步长都跟池子大小互质，所以连续的 index 会走遍池子而不是原地打转。 */
const STRIDES = [1, 5, 9, 13, 17];
const OFFSETS = [0, 3, 7, 12, 18];

/** 多少个站里有一个带 announcement-bar。今天是 6/6 全带 —— 那本身就是雷同的一部分。 */
const BAR_EVERY = 4;

/**
 * homepage 候选里可以进配方的那些，按 prompt.order 排（稳定的顺序 = 可复算的配方）。
 *
 * `industry` 给了就再滤掉 `blocks/<type>.json` 里把这个行业标成 `discouraged` 的块 ——
 * 那张表（#999）是选块的既有输入，本票的配方跟它**协作**，不覆盖它。
 * 📌 今天 28 个 homepage 候选里**一个 `discouraged` 都没有**（2026-08-15 实测），所以这一层今天
 *    一个块都滤不掉；写在这里是为了别人往 `blocks/` 里加 `discouraged` 的那天它自动生效。
 */
function poolFor(manifests, industry = '') {
  const homepage = [...manifests.values()]
    .filter((m) => m.prompt && m.prompt.group === 'homepage')
    .sort((a, b) => a.prompt.order - b.prompt.order);
  const known = new Set(homepage.map((m) => m.type));
  const missing = Object.keys(NOT_IN_POOL).filter((t) => !known.has(t));
  if (missing.length) {
    // 排除项点名的块不在候选里了（改名 / 删了 / 换了组）。静默继续 = 它可能已经悄悄回到池子里。
    throw new Error(`homepage-recipe: 排除名单点名的块不在 homepage 候选里了: ${missing.join(', ')}`
      + ' —— 改名或删块时要同时改 NOT_IN_POOL，否则它会被悄悄放回配方池');
  }
  let discouraged = () => false;
  if (industry) {
    // industryMatches 住在 block-manifest.js —— 行业词怎么算命中只有那一处说了算（#1013 洞 1）。
    const { industryMatches } = require('./block-manifest');
    discouraged = (m) => ((m.industries && m.industries.discouraged) || [])
      .some((w) => industryMatches(industry, w));
  }
  return homepage.filter((m) => !(m.type in NOT_IN_POOL) && !discouraged(m)).map((m) => m.type);
}

/** 从池子里按种子抽 k 个**互不相同**的块。撞了就往后挪一格（池子够大，挪不出界）。 */
function drawDistinct(pool, index, k) {
  const picked = [];
  for (let s = 0; s < k; s++) {
    const stride = STRIDES[s % STRIDES.length];
    const offset = OFFSETS[s % OFFSETS.length];
    let at = ((index * stride + offset) % pool.length + pool.length) % pool.length;
    let tries = 0;
    while (picked.includes(pool[at]) && tries < pool.length) { at = (at + 1) % pool.length; tries++; }
    picked.push(pool[at]);
  }
  return picked;
}

/**
 * 一个站的配方。
 *
 * @param {number} index      轮换索引（manager 的 themeRotationIndex，或 siteId 的哈希）
 * @param {Map}    manifests  loadManifests() 的产物
 * @param {string} industry   这个站的行业（自由文本）；用来滤掉标了 discouraged 的块
 * @returns {{ opener: string[], mustInclude: string[], promptOrder: string[] }}
 *   opener      —— 首页开头**四块**，顺序就是它写的顺序
 *   mustInclude —— 首页里还必须出现的两块（位置随便）
 *   promptOrder —— 提示词里那份候选清单该按什么顺序印（每站不同，见下）
 */
function homepageRecipe(index, manifests, industry = '') {
  const pool = poolFor(manifests, industry);
  const i = Math.abs(Math.trunc(Number(index) || 0));
  const withBar = i % BAR_EVERY === BAR_EVERY - 1;

  // 开场:带 bar 的是 [bar, hero, x, y];不带的是 [hero, x, y, z]。两种都钉住 4 个位置 ——
  // 只钉 3 个的话「前 4 块相同」那个数还留着一半由 AI 决定，而它是本票的防回退条款。
  const picks = drawDistinct(pool, i, withBar ? 4 : 5);
  const opener = withBar
    ? ['announcement-bar', 'hero', picks[0], picks[1]]
    : ['hero', picks[0], picks[1], picks[2]];
  const mustInclude = withBar ? [picks[2], picks[3]] : [picks[3], picks[4]];

  // 提示词里候选清单的顺序也每站不同。今天它恒按 prompt.order 印（block-manifest.js:197-201），
  // 而实测被选中的那批几乎就是清单靠前 + 正文点过名的那批 —— 清单顺序本身在参与选择。
  // 🔴 这里只换**印出来的顺序**，一个块都不加不减：清单少一块就等于把它从产品里拿掉了。
  // 🔴 转多少格写成 `i * 5 + 1`，不是 `i`：`i = 0` 时 `rotate(list, 0)` 是恒等 —— 第一个站的清单
  //    顺序会跟改动之前一模一样，而 `themeRotationIndex: 0` 正是最常见的那个入参
  //    （测试第一版就在这里红了）。5 跟清单长度 28 互质，所以连着 8 个站转到 8 个不同的起点。
  const promptOrder = rotate(allHomepageTypes(manifests), i * 5 + 1);

  return { opener, mustInclude, promptOrder, withBar, index: i, poolSize: pool.length };
}

/**
 * `homepageRecipe` 的不抛版本 —— 调用方拿到 `{ recipe, error }`，两者恰好一个是 null。
 *
 * 🔴 为什么要有它（#1034 r2，QA1/QA2 在 r1 上点的）：`poolFor` 里那句「排除名单点名的块必须还在」
 *    是一条**真**的不变量，但它在建站脚本里 `throw` 的后果是**块被改名的那天 `create-site` 在
 *    提示词发出去之前就死**，而 `origin/main` 上同一棵树照样能建出站来 —— 也就是本票**新开**了一种
 *    让建站失败的方式。方向反了：本文件头上写着「不为骨架撞车让一次建站失败」。
 *
 * 处置：这一趟不用配方（= 退回改动之前的行为）+ 把名字交回调用方去记。
 * 🔴 而「静默放回池子」那个真正危险的方向仍然被挡着：不是继续用一份可能把 `cta-banner` 摆到
 *    开场的配方，而是**一份都不用**。真正的防线是 `npm run test:scripts` 那一格 —— 它在 CI 里跑，
 *    改名的那次 push 当场红（`.github/workflows/ci-cd.yml` 的 `template-scripts`）。
 *
 * 📌 写成这里的一个函数而不是调用方的 try/catch，是为了它能被测到：`create-site.js` 没有单测，
 *    而这条分支恰恰是本票新开的口子带来的风险（同 `afterRetry` 的理由）。
 */
function tryHomepageRecipe(index, manifests, industry = '') {
  try {
    return { recipe: homepageRecipe(index, manifests, industry), error: null };
  } catch (e) {
    return { recipe: null, error: e };
  }
}

function allHomepageTypes(manifests) {
  return [...manifests.values()]
    .filter((m) => m.prompt && m.prompt.group === 'homepage')
    .sort((a, b) => a.prompt.order - b.prompt.order)
    .map((m) => m.type);
}

/** 把清单转 i 格（不是洗牌 —— 转位是可复算的，而且一眼看得出没有增删）。 */
function rotate(list, i) {
  if (!list.length) return list;
  const at = ((i % list.length) + list.length) % list.length;
  return [...list.slice(at), ...list.slice(0, at)];
}

/** 提示词里那几行硬要求。 */
function recipePromptLines(recipe) {
  return [
    `- 🔒 YOUR HOMEPAGE MUST OPEN WITH EXACTLY THESE SECTIONS, IN THIS ORDER: `
      + recipe.opener.map((t) => `"${t}"`).join(' → ')
      + `. These are positions 1-${recipe.opener.length}. Do not reorder them, do not insert anything between them.`,
    `- 🔒 THE HOMEPAGE MUST ALSO INCLUDE these sections somewhere after the opening: `
      + recipe.mustInclude.map((t) => `"${t}"`).join(', ')
      + `. You choose where.`,
    `- After the opening, pick 4-6 more sections yourself (the two required ones above count toward `
      + `that) and order them however suits this industry. End with "cta-banner". `
      + `Use "divider" 1-2 times to break the page up.`,
  ].join('\n');
}

/**
 * AI 吐回来的首页合不合配方。返回 problem 字符串数组（空数组 = 合）。
 *
 * 🔴 只看首页（#1034 AC6 的射程）—— 这句话同时印在返回的每条 problem 里，
 *    免得下一个人拿它的读数去回答别的问题。
 */
function recipeProblems(pages, recipe) {
  const home = (pages || []).find((p) => p && p.slug === 'home');
  if (!home) return ['首页(slug "home")不在 pages 里 —— 没法核首页骨架配方'];
  const seq = (Array.isArray(home.blocks) ? home.blocks : home.sections || []).map((b) => b && b.type);
  const problems = [];
  const got = seq.slice(0, recipe.opener.length);
  if (got.join('|') !== recipe.opener.join('|')) {
    problems.push(`首页（只看首页）开头必须逐个是 ${recipe.opener.join(' → ')}，`
      + `实际是 ${got.join(' → ') || '（空）'}`);
  }
  const present = new Set(seq);
  for (const t of recipe.mustInclude) {
    if (!present.has(t)) problems.push(`首页（只看首页）里必须有 "${t}"，实际没有`);
  }
  return problems;
}

/** payload 里关掉了吗。缺省 = 开着。 */
function fingerprintEnabled(input) {
  return !(input && input.homepageFingerprint === false);
}

/**
 * 重试跑完、块库仍有问题时该怎么办（#1034）。写成一个纯函数是为了能测 —— 那条分支只有 AI 参与时
 * 才走得到，而它恰恰是本票新开的口子带来的风险。
 *
 * 改动之前：只有「块库有问题」才进得了重试 ⟹ 重试后仍有问题 = 这个站本来就是坏的 ⟹ `fatal` 是对的。
 * 改动之后：「只有首页骨架跟配方对不上」也能进重试。那时第一次的输出**块库是干净的**，而重试可能
 * 把它改坏 —— 据此 fatal 等于「为了骨架撞车让一次建站失败」，正是本文件头上那段理由要防的事。
 *
 * @returns {'ok'|'fatal'|'revert'}  revert = 丢掉重试的产物，用第一次那份
 */
function afterRetry({ firstBlockProblems = 0, retryBlockProblems = 0 } = {}) {
  if (retryBlockProblems === 0) return 'ok';
  return firstBlockProblems > 0 ? 'fatal' : 'revert';
}

module.exports = {
  homepageRecipe,
  tryHomepageRecipe,
  recipePromptLines,
  recipeProblems,
  fingerprintEnabled,
  afterRetry,
  poolFor,
  rotate,
  NOT_IN_POOL,
  BAR_EVERY,
};
