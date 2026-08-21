// ══════════════════════════════════════════════════════════════════════════════════════════════════
// gallery.js — 候选的对照图（#1004 AC5：第四道闸的入口）
// ══════════════════════════════════════════════════════════════════════════════════════════════════
//
// 第四道闸是人：Chris 翻图。流水线要做的是**把图摆出来**，然后停下。这个文件就是那一步。
//
// ── 复用了 #963 的哪一半，以及为什么不是另一半 ─────────────────────────────────────────────────
//
// ✅ 复用 `scripts/theme-gallery/shoot.mjs`：它只吃「URL + 输出目录 + id」，跟注册表无关；
//    而且它自带一条我们正需要的自查 —— 页面上读不到 `--color-primary-500` 或 Google Fonts
//    就判这张图不算数（一张样式没加载的页面照样能截出一张"正常"的 PNG）。
//    🔴 #1016 改了那条自查一处（不是接线，是判据本身）：它拿「页面上有没有指向 fonts.googleapis.com
//    的 `<link>`」当「字体加载了没有」，而 #1002 之后字体是 `/theme.css` 里的一条 `@import` ——
//    于是它把**每一张**图都判成「不算数」（实测 3/3，图其实是好的）。现在改成在已加载的样式表里找
//    那条 @import，守的性质一个字没变。
//    它顺带写下 `<id>.json`：那一套的色号、字体、header/footer 的 `data-region-layout` —— 全部是
//    从**被拍的那张页面**的 DOM 上读回来的，不是抄声明。图旁的每一行读数都来自那份 JSON。
//    🔴 #1061 —— 那条自查里「Google Fonts」那一半曾经对**每一个**站都是假红（#1002 之后字体是
//    theme.css 里的一条 `@import`，页面上再没有那个 `<link>`）。修法在 #1016，跟这一段同一次上线
//    ——**但这个文件仍然不拿它的退出码当「有没有图」的答案**：那个退出码是好几件事的或，任何一件
//    为真都会让三张拍好的图一张都不摆。见下面 `shootCandidate` 和 `card`。
//
// ✅ 相似度那半也没有重做：`③ 相似度` 是 gates.js 里可复算的距离；#963 的 `review-pairs.mjs` 吃的
//    是图片对、不读注册表，要跑 AI 评审时可以直接对着这里的 `public/shots/` 跑。
//
// 🔴 没有复用 `scripts/theme-gallery/gallery.mjs`（那一份出的是**注册表 30 套**的图册）。本票作者
//    给了两个形状让我选（A：把它的主题来源做成参数；B：给它一份 themes.js 形状的适配层），两个
//    我都试过，两个都不成立，理由是量出来的、不是推的：
//
//    · B 不成立的地方在**装表那一步**，不在图册那一步：`shoot-themes.sh` 装主题走
//      `scripts/lib/dress-site-in-theme.js`（写 `theme.json {"applied": true}` + 把那套主题的
//      colors/fonts/settings 写进 brand.json），而这两步都要求**注册表里有这个 id**：共用件查不到
//      就直接报错不写，`sync-config.js` 的 `readAppliedThemeId()` 对 `applied: true` 也会去注册表里
//      找它、找不到就 exit 1。候选按 D3「新池重来」根本不进那张旧注册表 ⟹ 无论适配层长什么样，
//      那条路都走不通。候选进站走的是另一条：`{"applied": false, "css": "<id>"}`（#991 的开关，
//      跟 `applied` 是两码事）。
//      🔴 #1121 更新了这一条的**理由**，结论没变：以前这里的理由是「`applied: true` 会让注册表盖掉
//      brand.json 的颜色，而候选不在注册表里」；构建期那处覆盖已经撤掉了，今天挡住这条路的是上面
//      那两道「id 必须在注册表里」。（同款注释也在 `run.js` 的 installCandidate 上。）
//    · A 走到一半也断：`gallery.mjs:19` **必须**读到 `layout-readback.json`，而产出它的
//      `layout-readback.py` 是把 N 套按「页面上真渲染出来的骨架」分一次组、再按「注册表里声明的
//      variant」分一次组，两次分组完全相同才写文件。候选的 id **不在注册表里** ⟹ sync-config 的
//      `readStructureThemeId()` 返回 null ⟹ 一条版式覆盖都不写 ⟹ 几套候选的骨架完全一样，分不出组，
//      它按构造走到
//      `🔴 首页上没能认出 hero —— 图旁那条最要紧的标注没有依据,不写文件` 就退出（实测在交接里）。
//      要让那条路通，得先给候选编一份"声明的 variant"—— 那正是 #963 立那道读回检查要拦的事。
//      🔴 #1121 同样只换了理由：以前是「候选用的是 `applied: false` ⟹ 一条覆盖都不写」，而 variant
//      从本票起不看 `applied` 了 —— 不写覆盖的真正原因是那个 id 查不到，跟布尔无关。
//
//    ⟹ 所以候选的对照页在这里自己出，并且**在页面上写明它没有那条版式标注、以及为什么**。
//      #963 的教训是「图旁的标注不能是抄注册表抄出来的」；这里的做法是同一条规矩的另一半：
//      拿不到的读数就说拿不到，不摆一个看起来像读数的东西。
const fs = require('fs');
const path = require('path');
const cp = require('child_process');
const { clearShots } = require('../theme-gallery/shot-files.js');

const NEXT = path.resolve(__dirname, '..', '..');
const SHOOT = path.join(NEXT, 'scripts', 'theme-gallery', 'shoot.mjs');

const shotsDir = (galleryDir) => path.join(galleryDir, 'public', 'shots');

// 一套候选要摆几张图。第三张是 #1061 加的。
const FIGURES = [
  ['', '首页', ''],
  ['-about', '内页', ''],
  ['-allblocks', '全部块 —— 样例站里那一页把每种块各摆一次。首页和内页上没有的块，'
    + '只有在这一张上看得见（#1061）。图很高，在框里往下滚；点它开原图', 'wide'],
];

/**
 * #1061 —— 样例站里有没有「每种块各一次」那一页？没有就返回一句人话，有就返回空串。
 *
 * 🔴 这是**提前问一句**，不是判决。判决权在 `shoot.mjs`：它量的是服出来的那一页答不答 200，
 *    也就是被拍的那份产物本身。这里问的是磁盘上的站配置，为的是别等到建完 80 次站、起完 80 次
 *    服务、截完 80 次图之后才在每一套上各红一次。两个判据不同是故意的，两处都失败得响。
 *    （`scripts/theme-gallery/shoot-themes.sh` 里有同一个问题的 bash 版 —— 那条路进不了 Node。）
 */
function whyNoAllBlocksPage(siteDir) {
  const hit = [path.join(siteDir, 'pages', 'allblocks.json')]
    .concat((fs.existsSync(siteDir) ? fs.readdirSync(siteDir) : [])
      .map((d) => path.join(siteDir, d, 'pages', 'allblocks.json')))
    .some((p) => fs.existsSync(p));
  if (hit) return '';
  return `${siteDir} 里没有 allblocks 那一页 —— 图册会漏掉大多数块，第四道闸看不见它们。\n`
    + '   撑开这个样例站（不调 AI、不花钱）：\n'
    + `     cd ${NEXT} && node scripts/theme-css-invariants-sample-pages.js "${siteDir}"`;
}

/**
 * #1061 r2 —— 一套候选**开跑之前**，把它上一轮留在 shots/ 里的图和读数清掉。
 *
 * 🔴 `shoot.mjs` 开头已经清过一次，这里为什么还要清一次：有好几条路**根本走不到** `shoot.mjs` ——
 *    静态闸没过、样例站建不出来、建出来的不是这一份（`run.js` 那三个分支）。那时这一轮对盘的贡献
 *    是零字节，而 `card()` 问的是盘上有没有图 ⟹ 上一轮的三张图会原样摆给人审，卡片上的色号字体
 *    也是上一轮那套表的。所以清的位置是**这一轮的起点**，不是拍图那一步的门口。
 *    （QA3 在 r1 上就是这么打回的：对着一个死端口跑一轮，读数原样返回了上一轮种的标记。）
 */
function clearCandidateShots(galleryDir, id) {
  return clearShots(shotsDir(galleryDir), id);
}

/**
 * 给一套候选拍图（站已经建好、已经有一个 URL 在服它）。
 * 返回 { ok, shots, facts, log }：
 *   ok    —— shoot.mjs 的退出码是不是 0
 *   shots —— **盘上真有哪几张图**（#1061）。它跟 `ok` 是两个读数，不许互相代替：`ok` 是好几件事
 *            的或（某一页 404 · 页面上读不到颜色或字体 · 首页 Region 没读回来），任何一件为真都会
 *            让它是 false，而那时候图可能三张都好好地躺在盘上。「有没有图给人翻」问的是这一个。
 *            🔴 它成立靠一条不变量（#1061 r2）：这一轮开跑之前清过这套 id 的旧产物 ⟹ 「盘上有这张图」
 *            等于「这一轮拍到了这张图」。清的地方有两处，见 `clearCandidateShots` 和 `shoot.mjs` 开头。
 *   facts —— shoot.mjs 从那张页面上读回来的读数，拿不到就是 null
 *   cleared —— 开拍之前清掉了这套 id 的哪几个旧产物（#1061 r2；正常是空数组，因为 `run.js` 已经在
 *            这一轮的起点清过了）
 */
function shootCandidate(candidate, { baseUrl, galleryDir }) {
  const dir = shotsDir(galleryDir);
  fs.mkdirSync(dir, { recursive: true });
  // 🔴 #1061 r2 —— 在这里也清一次（`run.js` 已经在这一轮的起点清过，`shoot.mjs` 自己开头还会再清一次）。
  //    三处不是抄三遍：`run.js` 那次盖的是「根本走不到拍图」的路，`shoot.mjs` 那次盖的是别的调用者
  //    （`shoot-themes.sh` / `check-controls.sh`），而这一次盖的是**直接调这个函数**的人 —— QA3 在 r1 上
  //    就是这么驱动的。放在 spawn 之前还有第二个作用：`shoot.mjs` 到这一步已经没东西可清，它那句
  //    「清掉了几个」就不会出现在下面这份日志里，而 `gates.js` 拿这份日志的第一行印给人看。
  const cleared = clearShots(dir, candidate.id);
  const r = cp.spawnSync(process.execPath, [SHOOT, baseUrl, dir, candidate.id], { encoding: 'utf8' });
  const factsPath = path.join(dir, `${candidate.id}.json`);
  const facts = fs.existsSync(factsPath) ? JSON.parse(fs.readFileSync(factsPath, 'utf-8')) : null;
  return {
    ok: r.status === 0,
    shots: FIGURES.filter(([s]) => fs.existsSync(path.join(dir, `${candidate.id}${s}.png`)))
      .map(([, cap]) => cap.split(' ')[0]),
    facts,
    cleared,
    // 🔴 空的那一半不许留下一个空行：`gates.js` 拿这份日志的**第一行**印在人审那张卡片上，
    //    而 `shoot.mjs` 有几条路只往 stderr 写（清理那句、清单自查那句）—— 拼成 `'\n' + …`
    //    的话第一行就是空串，卡片上会写着「它说：」后面什么都没有。
    log: [String(r.stdout || '').trim(), String(r.stderr || '').trim()].filter(Boolean).join('\n'),
  };
}

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;')
  .replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const swatch = (hex) => (hex
  ? `<span class="sw" style="background:${esc(hex)}"></span><code>${esc(hex)}</code>`
  : '<i>(页面上读不到)</i>');

/**
 * 一套候选一块：三张图 + 图旁那几行读数 + 前三道闸的结论。
 *
 * 🔴 #1061 —— 摆哪几张图，问的是**盘上有哪几张**，不是 `shoot.mjs` 的退出码。
 *    以前是一个总开关：`shoot.mjs` 只要 rc≠0，这一套的图**一张都不摆**。而那个退出码是好几件事
 *    的或：某一页 404、页面上读不到主题的颜色或字体、首页的 Region 没读回来。任何一件为真，
 *    连拍得好好的首页图也一起消失。今天 main 上就正在发生：#1002 之后字体是 theme.css 里的
 *    一条 `@import`，页面上再没有指向 fonts.googleapis.com 的 `<link>`，而那条自查只认 `<link>`
 *    ⟹ 每一套都 rc=1 ⟹ 这一页对每一套都写「这一套没有图」，而三张图其实都在盘上。
 *    （那条自查的修法是 #1016 的事，不在本票交付面内。）
 *    ⟹ 改成逐张问：在就摆，不在就在它自己的位置上说这一张没拍到 —— 缺的那张不再把好的那两张
 *    一起拖走，而「没拍到」这件事也没有被藏起来，只是缩到了它真正的射程里。
 */
function card(entry, shotsPath) {
  const f = entry.facts || {};
  const gates = (entry.gates || []).map((g) => {
    const mark = g.pass === true ? '✅' : g.pass === false ? '🔴' : '⏸';
    return `<li>${mark} ${esc(g.gate)}${g.note ? ` —— ${esc(g.note)}` : ''}</li>`;
  }).join('');
  const has = (suffix) => fs.existsSync(path.join(shotsPath, `${entry.id}${suffix}.png`));
  const figures = FIGURES.map(([suffix, cap, cls]) => {
    const src = `shots/${esc(entry.id)}${suffix}.png`;
    const img = `<a href="${src}" target="_blank">
           <img loading="lazy" src="${src}" alt="${esc(entry.id)} ${esc(cap.split(' ')[0])}"></a>`;
    if (!has(suffix)) {
      return `<figure class="${cls}"><figcaption>${esc(cap)}</figcaption>
         <p class="nofig">🔴 这一张没拍到。<b>这不是关于这套皮好不好看的读数</b>，
            日志在这张卡片下面。</p></figure>`;
    }
    return `<figure class="${cls}"><figcaption>${esc(cap)}</figcaption>
         ${cls === 'wide' ? `<div class="scroller">${img}</div>` : img}</figure>`;
  }).join('\n');
  const missing = FIGURES.filter(([s]) => !has(s)).length;
  const shots = missing === FIGURES.length
    ? `<p class="nofig">🔴 这一套一张图都没有。<b>这不等于「它长得不好看」</b>，只等于这一轮没拍成：<br>
         <code>${esc(entry.shotLog || '（没有日志）')}</code></p>`
    : figures + (missing || !entry.shot
      ? `<p class="nofig">📌 ${missing ? `上面 ${missing} 张没拍到；` : ''}shoot.mjs 这一轮退的不是 0，它说：<br>
           <code>${esc(entry.shotLog || '（没有日志）')}</code></p>`
      : '');
  return `<section class="card">
    <h2>${esc(entry.id)}</h2>
    <ul class="gates">${gates}</ul>
    <table class="facts">
      <tr><th>primary 500</th><td>${swatch(f.primary500)}</td>
          <th>primary 900</th><td>${swatch(f.primary900)}</td>
          <th>accent 500</th><td>${swatch(f.accent500)}</td></tr>
      <tr><th>正文字体</th><td colspan="5"><code>${esc(f.bodyFontFamily || '(读不到)')}</code></td></tr>
      <tr><th>header / footer</th>
          <td colspan="5"><code>${esc((f.regions || {}).header || '(读不到)')}</code>
              / <code>${esc((f.regions || {}).footer || '(读不到)')}</code>
              · 遮罩 <code>${esc((f.regions || {}).headerScrim || '(读不到)')}</code></td></tr>
      ${(f.consoleErrors || []).length
    ? `<tr><th>浏览器报错</th><td colspan="5" class="err">${esc(f.consoleErrors.join(' / '))}</td></tr>` : ''}
    </table>
    <div class="shots">${shots}</div>
  </section>`;
}

/**
 * 把这一轮的候选拼成一页对照图，写 `<galleryDir>/public/index.html`。
 * 🔴 只写 public/ 这一层 —— #963 那条规矩：能被对外服出去的目录里只放页面和图，日志、样例站、
 *    任何配置备份都不进去（#932 r2 有一份带 R2 key 的备份在那里公开待过四个小时）。
 */
function writeComparisonPage(galleryDir, entries) {
  const pub = path.join(galleryDir, 'public');
  fs.mkdirSync(pub, { recursive: true });
  // #1061 —— 「有图」问的是盘上有没有图，不是 shoot.mjs 的退出码（理由写在 card() 头上）。
  const shotsPath = shotsDir(galleryDir);
  const withShots = entries.filter((e) => FIGURES
    .some(([suffix]) => fs.existsSync(path.join(shotsPath, `${e.id}${suffix}.png`)))).length;
  const html = `<!doctype html><meta charset="utf-8"><title>#1004 候选主题对照图</title>
<style>
  body{font:15px/1.6 system-ui,sans-serif;margin:0;padding:24px;background:#0f1115;color:#e8eaed}
  h1{font-size:22px;margin:0 0 4px} h2{font-size:18px;margin:0 0 8px}
  .meta{color:#9aa0a6;font-size:13px;margin:0 0 18px}
  .note{border-left:3px solid #f0a020;background:#1b1d22;padding:10px 14px;margin:0 0 22px;font-size:13px}
  .card{background:#16181d;border:1px solid #24272e;border-radius:10px;padding:16px;margin:0 0 22px}
  .gates{margin:0 0 10px;padding-left:18px} .gates li{margin:2px 0}
  table.facts{border-collapse:collapse;font-size:13px;margin:0 0 12px}
  table.facts th{text-align:left;color:#9aa0a6;font-weight:500;padding:2px 10px 2px 0;white-space:nowrap}
  table.facts td{padding:2px 18px 2px 0}
  .sw{display:inline-block;width:12px;height:12px;border-radius:3px;vertical-align:-1px;margin-right:5px;
      border:1px solid #3a3d45}
  .err{color:#ff8080}
  .shots{display:flex;gap:14px;flex-wrap:wrap}
  figure{margin:0;flex:1 1 320px;min-width:280px}
  /* #1061 —— 「全部块」那张自己占一行：它是几十段堆一页的整页图，挤进三分之一栏就什么都判不了。
     再装进一个能滚的框：那张图铺到卡片宽度上是一万九千多像素高，几十套候选叠起来人翻不动。 */
  figure.wide{flex:1 1 100%}
  figure.wide .scroller{max-height:820px;overflow-y:auto;border:1px solid #24272e;border-radius:6px}
  figure.wide .scroller img{border:0;border-radius:0}
  figcaption{color:#9aa0a6;font-size:12px;margin:0 0 4px}
  img{width:100%;border:1px solid #24272e;border-radius:6px;display:block}
  .nofig{color:#ffb4b4;font-size:13px}
  code{background:#22252b;padding:1px 5px;border-radius:4px}
</style>
<h1>#1004 候选主题对照图</h1>
<p class="meta">${entries.length} 套候选 · ${withShots} 套有图 · 每套三张（首页 / 内页 / 全部块），点图看原尺寸。</p>
<div class="note">
  <b>图旁那几行读数是从这张图那份产物的 DOM 上读回来的</b>（<code>shoot.mjs</code> 拍完顺手读的），
  不是把候选的 tokens 抄一遍 —— 一张样式没加载的页面照样能截出一张看着正常的 PNG，所以色号读不到
  的那一套会在上面直接说读不到。<br>
  <b>「浏览器报错」那一栏说的可能是样例站，不是这套皮</b> —— 这一页所有候选装在<b>同一个</b>样例站上
  建出来，所以样例站自己缺的素材（例如 <code>favicon.ico</code>、某张图）会在每一张卡片上重复出现。
  判法：几套候选报的错一字不差 ⟹ 那是样例站的。<br>
  <b>这一页没有 #963 那本图册里的「版式读回」标注</b>，原因写在
  <code>scripts/theme-pipeline/gallery.js</code> 的文件头：那条标注要把 N 套按渲染骨架和按声明
  variant 各分一次组、两次相同才敢写，而候选的 id 还不在主题注册表里、一条版式覆盖都没有，
  几套的骨架完全一样 ⟹ 分不出组。拿不到的读数就说拿不到，不摆一个看起来像读数的东西。
</div>
${entries.map((e) => card(e, shotsPath)).join('\n')}
`;
  const out = path.join(pub, 'index.html');
  fs.writeFileSync(out, html);
  return out;
}

module.exports = {
  shootCandidate, writeComparisonPage, shotsDir, whyNoAllBlocksPage, clearCandidateShots,
};
