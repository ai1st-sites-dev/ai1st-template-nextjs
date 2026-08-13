// #932 — 把 shots/ 里的图拼成一页，一个 URL 翻完全部 theme。
// #963 —— 路径参数化（见 paths.mjs）+ 页顶多了一节「最像的 N 对」，由 review-pairs.mjs 产出。
// 用法: THEME_GALLERY_DIR=/some/dir node gallery.mjs
import fs from 'fs';
import { NEXT_DIR, galleryDir } from './paths.mjs';

const { themes } = await import(`${NEXT_DIR}/scripts/themes.js`);

const GAL = galleryDir();
// 🔴 #932 r2 —— 页面和图都写进 public/，那一层才是 caddy 对外开的 root（见 shoot-themes.sh 的注释）。
const PUB = `${GAL}/public`;
const ids = Object.keys(themes);
// #932 那一轮之前就存在的 11 套 —— 图册用它区分「本次新增」和「原有」，纯标注。
const OLD = ['bold-red','ocean-blue','forest-green','royal-purple','slate-pro','sunset-orange','rose-gold','midnight','earth-tone','electric','golden-yellow'];

// 🔴 #932 r4 —— 图旁的版式读数。它【不是】把注册表抄一遍：layout-readback.py 分别算了
//   「页面按渲染骨架分组」和「注册表按声明 variant 分组」，两个分组完全相同才认。
//   读的是 sites/<id>/ 里那份被拍的产物本身。对不上它就报错不写文件，所以这里读不到就该停。
const RB = JSON.parse(fs.readFileSync(`${GAL}/layout-readback.json`, 'utf-8'));

// #963 —— AI 评审的结果。没有就不渲染那一节（并在页面上说清楚没跑，而不是装作没发现）。
const reviewPath = `${GAL}/review.json`;
const REVIEW = fs.existsSync(reviewPath) ? JSON.parse(fs.readFileSync(reviewPath, 'utf-8')) : null;

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

// 缩略图并排 + 一句理由。它只做提示不做闸 —— 名单是给人看的入口，不是判决。
const reviewSection = () => {
  if (!REVIEW) {
    return `<div class="review"><h2>最像的几对 —— 这一轮没跑</h2>
      <p class="meta">图册没有 review.json。<b>这不等于「没有像的」</b>，只等于这一轮没做 AI 评审。
      跑法：<code>THEME_GALLERY_DIR=… ANTHROPIC_API_KEY=… node review-pairs.mjs</code></p></div>`;
  }
  // 序号交给 <ol> 出，别自己再打一个 —— 打了就是「1. 1. realty-ivory × sage-minimal」。
  const rows = REVIEW.top.map((r) => `
    <li>
      <div class="pairhead"><b>${esc(r.a)} × ${esc(r.b)}</b>
        <span class="score">相似度 ${r.similarity}${r.sameDesign ? ' · 判为「同一套换色」' : ''}</span></div>
      <div class="pairshots">
        <figure><figcaption>${esc(r.a)}</figcaption><a href="shots/${esc(r.a)}.png" target="_blank"><img loading="lazy" src="shots/${esc(r.a)}.png" alt="${esc(r.a)}"></a></figure>
        <figure><figcaption>${esc(r.b)}</figcaption><a href="shots/${esc(r.b)}.png" target="_blank"><img loading="lazy" src="shots/${esc(r.b)}.png" alt="${esc(r.b)}"></a></figure>
      </div>
      <p class="why">${esc(r.reason)}</p>
    </li>`).join('');
  return `<div class="review">
    <h2>最像的 ${REVIEW.top.length} 对 —— 先看这几对就行</h2>
    <p class="meta">同一份内容建了 ${REVIEW.themes} 套，${REVIEW.pairs_scored} 对逐对问了一遍
      「普通人看会不会觉得这两套是同一套的换色」。<b>这只是提示，不是判决</b> —— 好不好看还是你说了算。</p>
    <p class="meta">看了多少：<b>${esc(REVIEW.coverage)}</b> ·
      缩略图 ${esc(REVIEW.thumbnail)} · 模型 ${esc(REVIEW.model)} ·
      本轮花了 <b>$${REVIEW.cost_usd.toFixed(2)}</b>（${esc(REVIEW.price_basis)}）${REVIEW.pairs_failed ? ` · ⚠️ ${REVIEW.pairs_failed} 对没评上，不在名单里` : ''}</p>
    <ol class="pairs">${rows}</ol>
  </div>`;
};
const seenTypes = (page) => RB.matched.filter(m => m.page === page).map(m => m.type);
const readback = (id, page) => seenTypes(page)
  .map(t => `${t} = <b>${RB.themes[id][t].variant}</b>`).join(' · ');

// #981 条6/条7 —— 顶栏和页脚的读数。layout-readback.py 只看 <main> 里面的 <section>,而这两个在它外面
// ⟹ 它们一直没有读数。**这一行读的是产物**:shoot.mjs 在浏览器里从 <header>/<footer> 身上的
// `data-region-layout` 取的,不是把 themes[id].layout.header 抄一遍 —— 抄注册表会说假话,因为
// resolveRegionLayout 会改主意(不认识的写法退回默认;首屏不能被证明是深底时自己加遮罩)。
const REG = Object.fromEntries(ids.map(id => [id, JSON.parse(
  fs.readFileSync(`${PUB}/shots/${id}.json`, 'utf-8')).regions || null]));
const regionCaption = (id) => {
  const r = REG[id];
  if (!r) return '顶栏 / 页脚:<b>这一轮没读到</b>(这套的 shots/&lt;id&gt;.json 是旧的,重跑 shoot-themes.sh)';
  const scrim = r.headerScrim === 'on' ? ' + 遮罩' : r.headerScrim === 'off' ? '(无遮罩)' : '';
  return `顶栏 <b>${esc(r.header)}</b>${esc(scrim)} · 页脚 <b>${esc(r.footer)}</b>`;
};
// 注册表**声明**的那两个,只用来跟上面那个读数比对。两者不一致本身就是要给人看的东西。
const declaredRegions = (id) => ({
  header: (themes[id].layout || {}).header || '(没声明)',
  footer: (themes[id].layout || {}).footer || '(没声明)',
});
const regionMismatch = (id) => {
  const r = REG[id]; if (!r) return '';
  const d = declaredRegions(id);
  const bad = [];
  if (r.header !== d.header) bad.push(`顶栏声明的是 ${d.header}`);
  if (r.footer !== d.footer) bad.push(`页脚声明的是 ${d.footer}`);
  return bad.length ? ` · ⚠️ 跟注册表不一致(${bad.map(esc).join(' · ')})` : '';
};
const tally = (pick) => {
  const c = {};
  for (const id of ids) { const r = REG[id]; if (r) c[pick(r)] = (c[pick(r)] || 0) + 1; }
  return Object.entries(c).sort((a, b) => b[1] - a[1]).map(([k, n]) => `${esc(k)} ${n} 套`).join(' · ') || '这一轮没读到';
};

const kw = (id) => themes[id].industries;
const tag = (id) => {
  const t = [];
  if (kw(id).some(k => k === 'real estate' || k === 'realty')) t.push('地产');
  if (kw(id).some(k => k === 'insurance')) t.push('保险');
  return t;
};

const card = (id) => {
  const t = themes[id];
  const isNew = !OLD.includes(id);
  const facts = JSON.parse(fs.readFileSync(`${PUB}/shots/${id}.json`, 'utf-8'));
  return `
  <section class="card" id="${id}">
    <header>
      <h2>${id} ${isNew ? '<span class="new">本次新增</span>' : '<span class="old">原有</span>'}
        ${tag(id).map(x => `<span class="trade">${x}</span>`).join('')}</h2>
      <p class="label">${t.label}</p>
      <p class="meta">
        <span class="sw" style="background:${t.colors.primary[500]}"></span>${t.colors.primary[500]}
        <span class="sw" style="background:${t.colors.accent[500]}"></span>${t.colors.accent[500]}
        &nbsp;·&nbsp; 字体 ${facts.fontSans.split(',')[0]}
        &nbsp;·&nbsp; 风格 ${t.style}
      </p>
      <p class="meta">适用行业：${t.industries.join(' / ')}</p>
    </header>
    <div class="shots">
      <figure>
        <figcaption>首页 —— 版式：${readback(id, '首页')}<br>${regionCaption(id)}${regionMismatch(id)}</figcaption>
        <a href="shots/${id}.png" target="_blank"><img loading="lazy" src="shots/${id}.png" alt="${id} 首页"></a>
      </figure>
      ${fs.existsSync(`${PUB}/shots/${id}-header.png`) ? `<figure>
        <figcaption>顶栏特写（多语言样例站）—— 最右那个语言开关要跟旁边导航一样读得清；这套页面上有
          ${REG[id] ? REG[id].langSwitchers : 0} 个语言开关</figcaption>
        <a href="shots/${id}-header.png" target="_blank"><img loading="lazy" src="shots/${id}-header.png" alt="${id} 顶栏特写"></a>
      </figure>` : ''}
      <figure>
        <figcaption>内页（关于我们）—— 版式：${readback(id, '内页')}</figcaption>
        <a href="shots/${id}-about.png" target="_blank"><img loading="lazy" src="shots/${id}-about.png" alt="${id} 内页"></a>
      </figure>
    </div>
  </section>`;
};

const html = `<!doctype html>
<html lang="zh"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Theme 库存 ${ids.length} 套 — 人审</title>
<style>
 body{font:15px/1.6 system-ui,sans-serif;margin:0;background:#f6f7f9;color:#111}
 .top{padding:24px 32px;background:#fff;border-bottom:1px solid #e3e6ea;position:sticky;top:0;z-index:2}
 .top h1{margin:0 0 6px;font-size:20px}
 .top p{margin:2px 0;color:#555;font-size:14px}
 nav{padding:12px 32px;background:#fff;border-bottom:1px solid #e3e6ea;line-height:2.2}
 nav a{display:inline-block;margin-right:10px;padding:2px 8px;border:1px solid #d6dae0;border-radius:4px;text-decoration:none;color:#222;font-size:13px}
 nav a.new{border-color:#1d6fb8;color:#1d6fb8}
 .card{background:#fff;margin:20px 32px;border:1px solid #e3e6ea;border-radius:8px;overflow:hidden}
 .card header{padding:16px 20px;border-bottom:1px solid #eef0f3}
 .card h2{margin:0;font-size:17px}
 /* 🔴 #932 r3 —— 这三条只管标题里的徽章 <span>。之前写成 .new{...} 时，nav 里的
    <a class="new"> 也被涂成蓝底，而 nav a.new 又把文字设成同一个蓝 ⟹ 19 个新 theme 的
    名字在导航条上是蓝底蓝字（对比度 1.00:1）。灰/绿两条的底色也调深了，白字都够看。 */
 h2 span.new{background:#1d6fb8;color:#fff;font-size:11px;padding:2px 6px;border-radius:3px;vertical-align:2px}
 h2 span.old{background:#6f767e;color:#fff;font-size:11px;padding:2px 6px;border-radius:3px;vertical-align:2px}
 h2 span.trade{background:#0d817c;color:#fff;font-size:11px;padding:2px 6px;border-radius:3px;vertical-align:2px;margin-left:4px}
 .label{margin:6px 0 2px;color:#333}
 .meta{margin:2px 0;color:#666;font-size:13px}
 .sw{display:inline-block;width:12px;height:12px;border-radius:3px;border:1px solid #0002;margin:0 4px -1px 8px}
 .shots{display:grid;grid-template-columns:1fr 1fr;gap:16px;padding:16px 20px}
 figure{margin:0}
 figcaption{font-size:12px;color:#5b6169;margin-bottom:6px}
 /* 🔴 #932 r4 —— 版式读数要读得清:r3 那次 QA2 拦下来的正是「导航条上蓝底蓝字」，
    所以这里的加粗只用深色，不再引入新的底色。 */
 figcaption b{color:#12324d}
 .ceiling{margin-top:10px;font-size:13px;color:#444}
 .ceiling summary{cursor:pointer;color:#1d6fb8}
 .ceiling p,.ceiling li{margin:6px 0}
 .ceiling ul{margin:6px 0;padding-left:20px}
 img{width:100%;border:1px solid #e3e6ea;border-radius:4px;display:block}
 /* #963 —— 页顶那一节:最像的 N 对,两张图并排 + 一句为什么像 */
 .review{background:#fff;margin:20px 32px;border:1px solid #e3e6ea;border-radius:8px;padding:16px 20px}
 .review h2{margin:0 0 6px;font-size:18px}
 .pairs{margin:12px 0 0;padding-left:22px}
 .pairs li{margin:0 0 18px}
 .pairhead{display:flex;flex-wrap:wrap;gap:10px;align-items:baseline}
 .score{color:#5b6169;font-size:13px}
 .pairshots{display:grid;grid-template-columns:1fr 1fr;gap:12px;margin:6px 0}
 .why{margin:4px 0 0;color:#333;font-size:13px}
 @media (max-width:700px){ .review{margin:16px 8px} .pairshots{grid-template-columns:1fr} }
 /* 手机上两列会把一张图压到 136px 宽，什么都判不了 —— 窄屏改成一列 */
 @media (max-width:700px){ .shots{grid-template-columns:1fr;padding:12px} .card{margin:16px 8px} .top,nav{padding-left:16px;padding-right:16px} }
</style></head><body>
<div class="top">
  <h1>Theme 库存 ${ids.length} 套 — 请挑掉不好看的</h1>
  <p>同一个样例站（内容一个字没改）换了 ${ids.length} 次装，每套真构建一次后整页截图。${ids.filter(i => !OLD.includes(i)).length ? `<b>其中 ${ids.filter(i => !OLD.includes(i)).length} 套是 #932 之后新增的</b>，原有 ${ids.filter(i => OLD.includes(i)).length} 套一并放进来当参照。` : ''}</p>
  <p>怎么看：每套两张图 —— 首页 + 内页。点图开原图。看着不行的，把它的名字（如 <code>plum-modern</code>）告诉我们就行。</p>
  <details class="ceiling"><summary>每张图下面那行「版式」是什么 / 这一页看不出什么（点开）</summary>
    <p><b>图下面那行版式是从这张图那份产物里读回来的</b>，不是把注册表抄一遍：把 30 套按「页面上真渲染出来的结构」分一次组，再按「注册表里声明的写法」分一次组，两次分组完全一样才敢写上去。所以你可以拿它当核对用——比如 hero 写着 <code>split</code> 的那 ${RB.facts.hero_distribution.split ?? 0} 套，图上就该是左文右图。</p>
    <p><b>这一页看不出差别的三样（也是量出来的）：</b></p>
    <ul>
      <li>每套的<b>页面组成完全相同</b> —— 首页都是 ${RB.facts.sections_home} 段、内页都是 ${RB.facts.sections_about} 段，顺序也一样。今天的换装只能给每一段挑一种写法，改不了「这页上有哪些段、按什么顺序排」。</li>
      <!-- #981 条6/条7 —— 这一条原来是一句写死的话，说这两个 Region 各只有一种结构、身上没有换装这回事。
           #960 给了顶栏 4 种、页脚 3 种，那句话从那天起就是假的，而写死的话不会因为代码变了自己更新。
           换成从每张图那份产物读回来的两个分布（读法见 shoot.mjs 的 readRegions）。 -->
      <li><b>顶栏</b>（从每张图的产物读回来）：${tally(r => r.header)}。<b>页脚</b>：${tally(r => r.footer)}。
        每张图下面第二行写着这一套是哪一种；跟注册表声明不一致的那几套，那行末尾会挂一个 ⚠️。</li>
      <!-- #963 —— 这句原来写死了「浅底的只有 minimal 那几套」。#959 之后浅底有四种写法，
           那个括号就成了页面上一句假话。改成只报从图上读回来的两个数。 -->
      <li>hero 一共 ${Object.keys(RB.facts.hero_distribution).length} 种写法：<b>${RB.facts.dark_hero} 套第一屏是深色满幅大标题</b>，${RB.facts.light_hero} 套是浅底。这两个数是从每张图那份产物的第一屏底色读回来的，不是按注册表数的。</li>
    </ul>
  </details>
</div>
<nav>${ids.map(id => `<a class="${OLD.includes(id) ? '' : 'new'}" href="#${id}">${id}</a>`).join('')}</nav>
${reviewSection()}
${ids.map(card).join('\n')}
</body></html>`;

fs.writeFileSync(`${PUB}/index.html`, html);
console.log(`写好了 ${PUB}/index.html —— ${ids.length} 套`);
