'use strict';

/**
 * remediation.js — 报错里「那你去做 X」那几句话（#1108）
 *
 *   const { howToAddTopbar, howToChangePageLayout } = require('./lib/remediation.js');
 *   const r = howToAddTopbar({ siteDir, locale: 'en' });   // { viaProduct, sentence }
 *
 * ── 为什么要有这个模块 ──────────────────────────────────────────────────────────────────────────
 * 构建在两个地方拦下带 topbar 的布局，两处都告诉人「去换个 page layout」或者「去 navigation.json 里
 * 加 topbar」——**这两条路当时一条都走不通**：`site/page-layout.json` 产品里 0 个写入者，
 * 而 `navigation.json` 被 #1087 的白名单整份拒掉了。产品自己的报错在建议一个产品自己禁止的动作。
 *
 * 🔴 这些话**不是内部日志**：`edit-site.js` 把 `sync-config.js` 的 stderr **原文推进老板的聊天窗口**
 *    （那段 catch 里 `syncError = String((e.stderr && …))`，#1102 治的就是它）。所以这里每一句都是
 *    用户可见文案，说错一句 = 让老板去点一个不存在的按钮。
 *
 * ── 判据:能不能走【算出来】,不写死 ────────────────────────────────────────────────────────────
 * 「AI 编辑器能不能写它」这件事的唯一权威是白名单自己（`lib/editable-files.js` 的 `writeRejection`），
 * 所以这里**去问它**，而不是抄一个结论。这一条是承重的，理由是具体的：
 *   · #1104 正在把 `navigation.json` 里「构建不覆盖」的那几处（topbar 是其中之一）开出来。
 *     写死「现在还改不了」→ 它一落地就变成假话；写死「去叫 AI 编辑器加」→ 今天就是假话。
 *   · 而且 #1104 还在 QA 手上，它的判据可能被改。**任何一边的硬编码都会在某个时刻说谎，而没有东西会红。**
 * ⟹ 同一份代码在两个世界里各说各的真话，ship 顺序也就不用错开。
 *
 * 🔴 射程（别把它读大了）：runtime 只问得到**AI 编辑器**这条通道。「dashboard 里有没有一个改它的界面」
 *    是仓库层面的事实，runtime 问不到 —— 那一半由 `remediation.test.js` 用 grep 钉住（有人真做出那个
 *    界面时那一格会红，逼人回来改这里的措辞）。
 */

const fs = require('fs');
const path = require('path');
const { readSiteShape } = require('./site-shape.js');

/**
 * 白名单说这条路径写得进去吗？拿不到那个模块时返回 null（= 问不到，不许当成任何一个答案）。
 *
 * 🔴 `siteDir` 是**必填位置参数**，不是 ctx 里一个可选的键（#1138）。理由是具体的：白名单判的第二问
 *    是「这个文件在**这个站**上有人读吗」，它要的是这个站的形状（`lib/editable-files.js` 的「第二问」
 *    那一段），而形状问不到时那一维**不判** —— 也就是说，一个调用点忘了递形状，它拿到的不是错误，
 *    是**另一道题的答案**，而两个答案今天碰巧相同（#1138 正文的 N2 量过：`:97` 问的路径形状本来就对、
 *    `:145` 那个文件两种问法都拒）。#1138 给白名单加了「这个语言这个站有没有」这一问之后，这条路
 *    就会开始分歧：remediation 会说「这个在聊天里改得了」，而真编辑器会拒。
 *    ⟹ 把 siteDir 摆成位置参数，让「忘了递形状」这件事**写不出来**：没有站目录就得显式传 `''`
 *    （那时 `readSiteShape('')` 返回 null，跟今天一样不判这一维，而且这个选择在代码上看得见）。
 *    这一条由 `remediation.test.js` ⑨ 钉着 —— 判据是行为：同一条路径，这里的答案必须与真编辑器
 *    （`edit-site.js` 那套 ctx）的答案相同。
 */
function editorCanWrite(relPath, siteDir, extraCtx) {
  let writeRejection;
  try {
    ({ writeRejection } = require('./editable-files.js'));
  } catch (e) {
    return null;
  }
  const ctx = { ...(extraCtx || {}), readSiteShape: () => readSiteShape(siteDir) };
  try {
    return writeRejection(relPath, ctx) === null;
  } catch (e) {
    return null;
  }
}

/**
 * 这个站的 navigation.json 相对 `site/` 在哪。
 *
 * 🔴 判据是**这个站是什么形状**，不是「有没有 locale 这个值」：老扁平站在 `sync-config.js` 里
 *    `locales` 仍然是 `['en']`（`:321-323` 那一段），而它的文件住在 `site/navigation.json`，
 *    **不是** `site/en/navigation.json`（同一个文件里 `localeDir = isLegacySchema ? siteDir : …`）。
 *    只看 locale 有没有值，会在扁平站上算出一个不存在的路径 —— 然后那句话让老板去改一个没有的文件。
 *    （这就是我第一版写的样子；夹具是 locale 站，所以它没红。）
 */
function navRelPath(locale, flat) {
  if (flat || !locale) return 'navigation.json';
  return `${locale}/navigation.json`;
}

/**
 * 同一个文件，**从站仓根看**的路径。
 *
 * 🔴 #1134 —— 一句话里说的是哪一个坐标系，要跟这句话让人做的动作对上：
 *    · 「AI 编辑器写得进 X」   → X 用 `navRelPath` 那种**相对 `site/`** 的写法，因为白名单
 *      (`editorCanWrite`) 收的就是这种（`en/navigation.json`）。
 *    · 「手改这个站仓里的 X」  → X 必须带 `site/`，因为人是在**站仓根**上找这个文件的。
 *    原来两句都用了前者 ⟹ 照字面去找会扑空一次（#1134 走那条路时实测过：在 `site/en/navigation.json`
 *    上加 topbar，`sync-config` 就 rc=0 了 —— 路本身是通的，只是那句话少了一层目录）。
 *    同一段里换布局那句一直写的是带 `site/` 的全路径（`site/page-layout.json`），两句原来不一致。
 */
function navRepoPath(locale, flat) {
  return `site/${navRelPath(locale, flat)}`;
}

/**
 * 「顶栏那段文案今天怎么加」。
 *
 * @param {{siteDir: string, locale?: string, flat?: boolean}} opts
 *        flat = 老的单语言扁平站（`site_meta.json` 不存在那种），它的文件不在 `<locale>/` 下面
 * @returns {{viaProduct: boolean|null, sentence: string}}
 *   viaProduct: true = 产品里有路（AI 编辑器写得进）· false = 没有，只能手改站仓 · null = 没问到
 */
function howToAddTopbar(opts) {
  const siteDir = (opts && opts.siteDir) || '';
  const locale = (opts && opts.locale) || '';
  const flat = !!(opts && opts.flat);
  const rel = navRelPath(locale, flat);
  const repoRel = navRepoPath(locale, flat);   // 人在站仓根上找它时的路径（#1134）
  const full = path.join(siteDir, rel);

  // 🔴 拿这个站**真实的**那份去问，不是拿一个想象的最小 JSON:白名单（#1104 之后）判的是
  //    「这次写入改了哪几处」，喂一份合成的会把别的字段也算成改动 ⟹ 问出来的是另一道题的答案。
  let current = null;
  try {
    current = JSON.parse(fs.readFileSync(full, 'utf-8'));
  } catch (e) {
    current = null;
  }
  if (current === null) {
    return {
      viaProduct: false,
      sentence: `这个站的 ${rel} 读不出来（不在，或者不是合法 JSON）——`
        + `先把这个文件补好，再加 topbar。`,
    };
  }
  const candidate = JSON.stringify({
    ...current,
    topbar: { message: '示例文案', link: { label: '示例', href: '/contact' } },
  });
  const can = editorCanWrite(rel, siteDir, {
    content: candidate,
    readCurrent: () => { try { return fs.readFileSync(full, 'utf-8'); } catch (e) { return null; } },
  });

  if (can === true) {
    return {
      viaProduct: true,
      sentence: `在聊天里让 AI 编辑器加一段顶栏文案（例如「顶部加一条横幅，写 24 小时急修」）——`
        + `它写得进 ${rel} 的 topbar。`,
    };
  }
  if (can === false) {
    return {
      viaProduct: false,
      sentence: `现在还加不了：AI 编辑器写不进 ${rel}，dashboard 里也没有改顶栏文案的界面。`
        + `今天唯一的办法是手改这个站仓里的 ${repoRel}，加上 `
        + `{ "topbar": { "message": "…", "link": { "label": "…", "href": "…" } } }。`,
    };
  }
  // can === null:问不到。**不许替它选一个答案** —— 两个方向都会变成一句没人查过的话。
  return {
    viaProduct: null,
    sentence: `手改这个站仓里的 ${repoRel}，加上 `
      + `{ "topbar": { "message": "…", "link": { "label": "…", "href": "…" } } }。`
      + `（这次没问出来 AI 编辑器能不能写它 —— 读不到那个判断模块。）`,
  };
}

/**
 * 「换一个 page layout 今天怎么换」。
 *
 * @param {{rootDir?: string, siteDir?: string}} [opts]
 *        rootDir = templates/nextjs（用来列出库里有哪些布局）
 *        siteDir = 这个站的 `site/`（问白名单时要它，见 `editorCanWrite` 上面那段）。
 *          🔴 不传时这一维不判 —— 今天的答案不变（`page-layout.json` 不是按语言存的文件，形状
 *             对它不说话），但**别把「今天不说话」写成「不用传」**：那正是 #1138 要治的那条路。
 * @returns {{viaProduct: boolean|null, sentence: string}}
 */
function howToChangePageLayout(opts) {
  const rootDir = (opts && opts.rootDir) || path.join(__dirname, '..', '..');
  const siteDir = (opts && opts.siteDir) || '';
  // 库里有哪些 —— 读目录，不抄名单（加一个新布局时这句话自己跟上）
  let available = [];
  try {
    available = fs.readdirSync(path.join(rootDir, 'page-layouts'))
      .filter((f) => f.toLowerCase().endsWith('.json'))
      .map((f) => f.replace(/\.json$/i, ''))
      .sort();
  } catch (e) {
    available = [];
  }
  const list = available.length ? available.join(' / ') : '（读不出 page-layouts/ 目录）';
  const can = editorCanWrite('page-layout.json', siteDir);
  if (can === true) {
    return {
      viaProduct: true,
      sentence: `在聊天里让 AI 编辑器改 site/page-layout.json 的 layoutId（库里有：${list}）。`,
    };
  }
  return {
    // null（问不到）也走这一支:两种情况下这句话都成立 —— 手改站仓永远是一条真路。
    viaProduct: can === false ? false : null,
    sentence: `现在还换不了：产品里没有任何界面或工具会写 site/page-layout.json。`
      + `今天唯一的办法是手改这个站仓里的 site/page-layout.json（{"layoutId":"…"}，`
      + `库里有：${list}；这个文件不在就按 standard 走）。`,
  };
}

/**
 * 「换一套顶栏不是透明浮层的主题」—— 哪些主题算？
 *
 * 🔴 这一格是我自己第一版交付里的假话，跟本票要治的病一模一样：那句话教人按
 *    `themes.js 的 supports.header !== 'transparent-overlay'` 去挑。而 `supports` 装的是
 *    **清单**（#1010 起就是数组），拿数组 `!==` 一个字符串**恒为真** ⟹ 那个判据一个主题都排除不掉。
 *    实测（110 个主题）：照它挑得到 110 个候选，其中 **20 个解析出来仍然是透明浮层**。
 *    ⟹ 老板照着做，五分之一的概率换完还是看不见那条横条，而报错不会再说一次。
 *
 * 真正的权威是构建自己用的那两个函数：`layoutFor(themeId)` 吐结论、`resolveRegionLayout()` 定版式
 * （`sync-config.js` 判 `regionLayout.header === 'transparent-overlay'` 用的就是它）。所以这里**去问它们**。
 *
 * @param {{rootDir?: string}} [opts]
 * @returns {{viaProduct: boolean|null, sentence: string, safe: string[], overlay: string[]}}
 */
function themesWithoutOverlayHeader(opts) {
  const rootDir = (opts && opts.rootDir) || path.join(__dirname, '..');
  let themes, layoutFor, resolveRegionLayout;
  try {
    ({ themes, layoutFor } = require(path.join(rootDir, 'themes.js')));
    ({ resolveRegionLayout } = require(path.join(rootDir, 'region-layout.js')));
  } catch (e) {
    return {
      viaProduct: null,
      safe: [],
      overlay: [],
      sentence: '换一套顶栏不是透明浮层的主题 —— 在 dashboard 的换装弹窗里挑'
        + '（这次列不出是哪些：读不到 themes.js / region-layout.js）。',
    };
  }
  const safe = [], overlay = [];
  for (const id of Object.keys(themes || {})) {
    let header;
    try {
      header = resolveRegionLayout(layoutFor(id)).header;
    } catch (e) {
      continue;   // 这一套算不出来 ⟹ 不许把它算进"安全"那边（错的方向不对称）
    }
    (header === 'transparent-overlay' ? overlay : safe).push(id);
  }
  if (!safe.length) {
    return {
      viaProduct: null,
      safe,
      overlay,
      sentence: '换一套顶栏不是透明浮层的主题 —— 在 dashboard 的换装弹窗里挑'
        + '（这次一套都没算出来）。',
    };
  }
  return {
    viaProduct: true,
    safe,
    overlay,
    // 🔴 只报数 + 举几个例子，不把 90 个名字铺进老板的聊天窗口。
    //    判据那句话必须说**真能用的**那个（`layoutFor` 的结论），不是 `supports` 那张清单。
    sentence: `换一套顶栏不是透明浮层的主题 —— 在 dashboard 的换装弹窗里挑，`
      + `${safe.length} 套里挑一套（例如 ${safe.slice(0, 3).join(' / ')}）；`
      + `另外 ${overlay.length} 套的顶栏是透明浮层，换过去还是同一个毛病。`,
  };
}

/**
 * topbar 缺内容那条报错要打印的补救行（每个缺的语言一条），**条数有上限**。
 *
 * 🔴 为什么要有上限：`edit-site.js:594` 把这段 stderr `.slice(0, 2000)` 之后原文推进老板的聊天窗口
 *    （`:678`）。一条补救句 ~164 字符 ⟹ 一个语言一条时，**10 个语言起就会把后面那条「或者不要
 *    topbar」整条切掉**（实测：10 个语言约 2035 字符）。而改这条之前那版是**一行讲完所有语言**，
 *    也就是说「一个语言一条」这个更精确的写法在这一维上是个退步。上限把它按回来：
 *    最多 CAP 条，其余合成一行（把 `<locale>` 换成它自己即可）。
 *
 * @param {{siteDir: string, locales: string[], flat?: boolean, cap?: number}} opts
 * @returns {string[]} 每条都是一行的正文（调用方自己加 `  · ` 前缀）
 */
const BULLET_CAP = 4;
function topbarBullets(opts) {
  const siteDir = (opts && opts.siteDir) || '';
  const locales = (opts && opts.locales) || [];
  const flat = !!(opts && opts.flat);
  const cap = (opts && opts.cap) || BULLET_CAP;
  const shown = locales.slice(0, cap);
  const rest = locales.slice(cap);
  const out = shown.map((loc) => {
    const r = howToAddTopbar({ siteDir, locale: loc, flat });
    return flat ? r.sentence : `[${loc}] ${r.sentence}`;
  });
  if (rest.length) {
    out.push(`其余 ${rest.length} 个语言（${rest.join(', ')}）同理 —— `
      + `把上面那句里的语言目录换成它自己。`);
  }
  return out;
}

module.exports = {
  howToAddTopbar, howToChangePageLayout, themesWithoutOverlayHeader, topbarBullets, navRelPath, BULLET_CAP,
};
