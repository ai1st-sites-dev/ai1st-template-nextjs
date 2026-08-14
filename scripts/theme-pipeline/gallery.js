// ══════════════════════════════════════════════════════════════════════════════════════════════════
// gallery.js — 候选的对照图（#1004 AC5：第四道闸的入口）
// ══════════════════════════════════════════════════════════════════════════════════════════════════
//
// 第四道闸是人：Chris 翻图。流水线要做的是**把图摆出来**，然后停下。这个文件就是那一步。
//
// ── 复用了 #963 的哪一半，以及为什么不是另一半 ─────────────────────────────────────────────────
//
// ✅ 复用 `scripts/theme-gallery/shoot.mjs`（一个字没改）：它只吃「URL + 输出目录 + id」，跟注册表
//    无关；而且它自带一条我们正需要的自查 —— 页面上读不到 `--color-primary-500` 或 Google Fonts
//    的 link 就判这张图不算数（一张样式没加载的页面照样能截出一张"正常"的 PNG）。
//    它顺带写下 `<id>.json`：那一套的色号、字体、header/footer 的 `data-region-layout` —— 全部是
//    从**被拍的那张页面**的 DOM 上读回来的，不是抄声明。图旁的每一行读数都来自那份 JSON。
//
// ✅ 相似度那半也没有重做：`③ 相似度` 是 gates.js 里可复算的距离；#963 的 `review-pairs.mjs` 吃的
//    是图片对、不读注册表，要跑 AI 评审时可以直接对着这里的 `public/shots/` 跑。
//
// 🔴 没有复用 `scripts/theme-gallery/gallery.mjs`（那一份出的是**注册表 30 套**的图册）。本票作者
//    给了两个形状让我选（A：把它的主题来源做成参数；B：给它一份 themes.js 形状的适配层），两个
//    我都试过，两个都不成立，理由是量出来的、不是推的：
//
//    · B 不成立的地方在**装表那一步**，不在图册那一步：`shoot-themes.sh` 装主题的写法是
//      `theme.json {"applied": true}`，而 `sync-config.js:44` 对 `applied: true` 会去注册表里找那个
//      id，找不到就报错退出。候选按 D3「新池重来」根本不进那张旧注册表 ⟹ 无论适配层长什么样，
//      那条路都走不通。候选进站走的是另一条：`{"applied": false, "css": "<id>"}`（#991 的开关，
//      跟 `applied` 是两码事），日志里的凭据也因此不同 —— 不是 `Theme "<id>" applied` 而是
//      `Theme CSS: public/themes/<id>.css`。
//    · A 走到一半也断：`gallery.mjs:19` **必须**读到 `layout-readback.json`，而产出它的
//      `layout-readback.py` 是把 N 套按「页面上真渲染出来的骨架」分一次组、再按「注册表里声明的
//      variant」分一次组，两次分组完全相同才写文件。候选用的是 `applied: false` ⟹ sync-config
//      一条版式覆盖都不写 ⟹ 几套候选的骨架完全一样，分不出组，它按构造走到
//      `🔴 首页上没能认出 hero —— 图旁那条最要紧的标注没有依据,不写文件` 就退出（实测在交接里）。
//      要让那条路通，得先给候选编一份"声明的 variant"—— 那正是 #963 立那道读回检查要拦的事。
//
//    ⟹ 所以候选的对照页在这里自己出，并且**在页面上写明它没有那条版式标注、以及为什么**。
//      #963 的教训是「图旁的标注不能是抄注册表抄出来的」；这里的做法是同一条规矩的另一半：
//      拿不到的读数就说拿不到，不摆一个看起来像读数的东西。
const fs = require('fs');
const path = require('path');
const cp = require('child_process');

const NEXT = path.resolve(__dirname, '..', '..');
const SHOOT = path.join(NEXT, 'scripts', 'theme-gallery', 'shoot.mjs');

const shotsDir = (galleryDir) => path.join(galleryDir, 'public', 'shots');

/**
 * 给一套候选拍图（站已经建好、已经有一个 URL 在服它）。
 * 返回 { ok, facts, log } —— `facts` 是 shoot.mjs 从那张页面上读回来的读数，拿不到就是 null。
 */
function shootCandidate(candidate, { baseUrl, galleryDir }) {
  const dir = shotsDir(galleryDir);
  fs.mkdirSync(dir, { recursive: true });
  const r = cp.spawnSync(process.execPath, [SHOOT, baseUrl, dir, candidate.id], { encoding: 'utf8' });
  const factsPath = path.join(dir, `${candidate.id}.json`);
  const facts = fs.existsSync(factsPath) ? JSON.parse(fs.readFileSync(factsPath, 'utf-8')) : null;
  return {
    ok: r.status === 0,
    facts,
    log: String(r.stdout || '').trim() + (r.stderr ? `\n${String(r.stderr).trim()}` : ''),
  };
}

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;')
  .replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const swatch = (hex) => (hex
  ? `<span class="sw" style="background:${esc(hex)}"></span><code>${esc(hex)}</code>`
  : '<i>(页面上读不到)</i>');

/** 一套候选一块：两张图 + 图旁那几行读数 + 前三道闸的结论。 */
function card(entry) {
  const f = entry.facts || {};
  const gates = (entry.gates || []).map((g) => {
    const mark = g.pass === true ? '✅' : g.pass === false ? '🔴' : '⏸';
    return `<li>${mark} ${esc(g.gate)}${g.note ? ` —— ${esc(g.note)}` : ''}</li>`;
  }).join('');
  const shots = entry.shot
    ? `<figure><figcaption>首页</figcaption>
         <a href="shots/${esc(entry.id)}.png" target="_blank">
           <img loading="lazy" src="shots/${esc(entry.id)}.png" alt="${esc(entry.id)} 首页"></a></figure>
       <figure><figcaption>内页</figcaption>
         <a href="shots/${esc(entry.id)}-about.png" target="_blank">
           <img loading="lazy" src="shots/${esc(entry.id)}-about.png" alt="${esc(entry.id)} 内页"></a></figure>`
    : `<p class="nofig">🔴 这一套没有图。<b>这不等于「它长得不好看」</b>，只等于这一轮没拍成：<br>
         <code>${esc(entry.shotLog || '（没有日志）')}</code></p>`;
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
  const withShots = entries.filter((e) => e.shot).length;
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
  figcaption{color:#9aa0a6;font-size:12px;margin:0 0 4px}
  img{width:100%;border:1px solid #24272e;border-radius:6px;display:block}
  .nofig{color:#ffb4b4;font-size:13px}
  code{background:#22252b;padding:1px 5px;border-radius:4px}
</style>
<h1>#1004 候选主题对照图</h1>
<p class="meta">${entries.length} 套候选 · ${withShots} 套有图 · 每套两张（首页 / 内页），点图看原尺寸。</p>
<div class="note">
  <b>图旁那几行读数是从这张图那份产物的 DOM 上读回来的</b>（<code>shoot.mjs</code> 拍完顺手读的），
  不是把候选的 tokens 抄一遍 —— 一张样式没加载的页面照样能截出一张看着正常的 PNG，所以色号读不到
  的那一套会在上面直接说读不到。<br>
  <b>「浏览器报错」那一栏说的可能是样例站，不是这套皮</b> —— 这一页所有候选装在<b>同一个</b>样例站上
  建出来，所以样例站自己缺的素材（例如 <code>favicon.ico</code>、某张图）会在每一张卡片上重复出现。
  判法：几套候选报的错一字不差 ⟹ 那是样例站的。<br>
  <b>这一页没有 #963 那本图册里的「版式读回」标注</b>，原因写在
  <code>scripts/theme-pipeline/gallery.js</code> 的文件头：那条标注要把 N 套按渲染骨架和按声明
  variant 各分一次组、两次相同才敢写，而候选是 <code>applied:false</code> 进站的、一条版式覆盖都
  没有，几套的骨架完全一样 ⟹ 分不出组。拿不到的读数就说拿不到，不摆一个看起来像读数的东西。
</div>
${entries.map(card).join('\n')}
`;
  const out = path.join(pub, 'index.html');
  fs.writeFileSync(out, html);
  return out;
}

module.exports = { shootCandidate, writeComparisonPage, shotsDir };
