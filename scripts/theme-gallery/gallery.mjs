// #932 — 把 shots/ 里的图拼成一页，一个 URL 翻完全部 theme。
// #963 —— 路径参数化（见 paths.mjs）+ 页顶多了一节「最像的 N 对」，由 review-pairs.mjs 产出。
// 用法: THEME_GALLERY_DIR=/some/dir node gallery.mjs
import fs from 'fs';
import { NEXT_DIR, galleryDir } from './paths.mjs';

const { themes, layoutFor } = await import(`${NEXT_DIR}/scripts/themes.js`);

const GAL = galleryDir();
// 🔴 #932 r2 —— 页面和图都写进 public/，那一层才是 caddy 对外开的 root（见 shoot-themes.sh 的注释）。
const PUB = `${GAL}/public`;
// 🔴 #1174 —— **可以只出一部分**：位置参数给几个 theme id，就只渲染那几套（跟 `shoot-themes.sh` 的
// 接口一样，不给就是全部）。为什么要有这个开关：往末尾补池那种票（本票 80 → 97）只拍新增那几套，
// 而这里原来无条件取整张注册表 ⟹ 页面会摆出 97 个格子、其中 80 个的图根本不存在，**而翻图的人
// 看不出这是「没拍」还是「拍坏了」**。同族的坑 #1004 记过一次（照着现成命令跑会真的出一本图册，
// 里面一张候选都没有）—— 那次的教训就是「先查这条管线的 id 是从哪儿来的」。
// 🔴 给了不在注册表里的 id 就当场退出，不静默忽略：静默忽略会让「我明明传了它」和「它没被渲染」
//    同时成立，而页面上看不出来。
const SELECT = process.argv.slice(2);
const unknown = SELECT.filter((id) => !themes[id]);
if (unknown.length) {
  console.error(`🔴 这些 id 不在注册表里，不渲染：${unknown.join(' ')}`);
  console.error(`   注册表现在有 ${Object.keys(themes).length} 套。用法: node gallery.mjs [theme-id ...]`);
  process.exit(2);
}
// 保持注册表的顺序（页面按位子顺序读起来才对得上），只是筛掉没选的。
const ids = SELECT.length ? Object.keys(themes).filter((id) => SELECT.includes(id)) : Object.keys(themes);
const POOL_TOTAL = Object.keys(themes).length;
const IS_SUBSET = ids.length !== POOL_TOTAL;
// 🔴 #1161 —— 这里原来是一个写死的 11 个 id 的数组（#932 那一轮之前就存在的那批），图册用它把每套
// 标成「本次新增」或「原有」。那 11 个**今天一个都不在注册表里了**（它们全在已下架那 30 套里），
// 所以那个判断已经恒为「本次新增」—— 一个恒真的标注不是标注，它比没有更坏，因为它看起来还在说话。
// ⟹ 整个「新增 / 原有」这一维去掉。要区分代次的话，判据该是主题自己的出身（`theme-pool.json` 里
// 那份 provenance），不是一份手抄的 id 名单 —— 那正是这一行为什么会悄悄失效。

// 🔴 #932 r4 —— 图旁的版式读数。它【不是】把注册表抄一遍：layout-readback.py 分别算了
//   「页面按渲染骨架分组」和「注册表按声明 variant 分组」，两个分组完全相同才认。
//   读的是 sites/<id>/ 里那份被拍的产物本身。对不上它就报错不写文件，所以这里读不到就该停。
// 🔴 #1174 —— 这里原来是无条件 readFileSync，读不到就整份脚本抛在第一屏，**图册一张也出不来**。
// 今天 `layout-readback.py` 在**任何**套数上都写不出这份文件，而原因是结构性的、不是本票造的：
// 它的判据是「把这些套按页面上真渲染出来的骨架分组」，而今天产物里那一段是
// `<section data-block="hero" class="hero">` —— **一个固定的语义类名，长相全靠主题那张表**。
// 于是每个位置的分组恒为「1 组、全部成员都在里面」，它按自己的纪律拒绝写文件（那条纪律是对的）。
// 实测：本轮 17 套，首页 4 段 + 内页 2 段，六个位置全部读到 `1 组 [17]`。
// 对照 `/root/theme-gallery/963/sites`（那一轮它成功过，14 个类型都认出来了）：同一位置的 class 是
// `bg-white` / `border-b bg-gray-50 py-10` / `section-padding` —— 那时候写法差异确实落在 class 上。
// ⟹ 是模板从「每种写法一套 Tailwind 类」换成「语义类名 + 主题表」之后，这把尺失明了。**圈外，另开票。**
//
// 🔴 处置是「读不到就说读不到」，不是造一个看起来像读数的东西（#1004 的教训，dev 记忆里记着：
//    自己出一份图册时，把拿不到的那条标注**和为什么拿不到**写在页面上）。所以这里跟下面 review.json
//    同款：缺了就渲染，页面上用红字讲清缺的是哪一维、为什么缺、这一页因此**不能**用来核对
//    「这套主题有没有按它声明的写法渲染」。
const rbPath = `${GAL}/layout-readback.json`;
const RB = fs.existsSync(rbPath) ? JSON.parse(fs.readFileSync(rbPath, 'utf-8')) : null;

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
// #1061 —— 「全部块」那一页上到底摆了多少种块。读的是**被拍的那份产物**（`sites/<id>/allblocks.html`
// 里 `data-block` 属性的去重数），不是去数注册表 —— 注册表里有而页面上没渲染出来的块，正是这张图
// 该让人发现的东西，拿注册表的数当说明就把它盖住了。读不到就说读不到。
const blockTypesOnAllBlocks = (() => {
  try {
    const html = fs.readFileSync(`${GAL}/sites/${ids[0]}/allblocks.html`, 'utf-8');
    return new Set([...html.matchAll(/data-block="([a-z0-9-]+)"/g)].map(m => m[1])).size;
  } catch { return 0; }
})();

const seenTypes = (page) => (RB ? RB.matched.filter(m => m.page === page).map(m => m.type) : []);
const readback = (id, page) => seenTypes(page)
  .map(t => `${t} = <b>${RB.themes[id][t].variant}</b>`).join(' · ');

// #981 条6/条7 —— 顶栏和页脚的读数。layout-readback.py 只看 <main> 里面的 <section>,而这两个在它外面
// ⟹ 它们一直没有读数。**这一行读的是产物**:shoot.mjs 在浏览器里从 <header>/<footer> 身上的
// `data-region-layout` 取的,不是把注册表的 supports.header 抄一遍 —— 抄注册表会说假话,因为
// resolveRegionLayout 会改主意(不认识的写法退回默认;透明浮层自己带一层遮罩)。
//
// 🔴 #1061 r2 —— 读不到那份 JSON 不再是"不可能"：shoot-themes.sh 现在每套开拍之前会先清掉它上一轮的
//   产物（理由在 shot-files.js 头上），所以一套建不出来的主题在盘上就是**什么都没有**，不再是留着
//   上一轮那份被当成这一轮的。这里跟着改成读不到就说读不到 —— 原来的写法会当场抛异常，让一套没建成
//   把整本 30 套的图册一起打掉。
const readFacts = (id) => {
  const p = `${PUB}/shots/${id}.json`;
  return fs.existsSync(p) ? JSON.parse(fs.readFileSync(p, 'utf-8')) : null;
};
const REG = Object.fromEntries(ids.map(id => [id, (readFacts(id) || {}).regions || null]));
const regionCaption = (id) => {
  const r = REG[id];
  if (!r) return '顶栏 / 页脚:<b>这一轮没读到</b>(这套这一轮没拍成 —— shots/&lt;id&gt;.json 不在了,重跑 shoot-themes.sh)';
  const scrim = r.headerScrim === 'on' ? ' + 遮罩' : r.headerScrim === 'off' ? '(无遮罩)' : '';
  return `顶栏 <b>${esc(r.header)}</b>${esc(scrim)} · 页脚 <b>${esc(r.footer)}</b>`;
};
// 注册表**声明**的那两个,只用来跟上面那个读数比对。两者不一致本身就是要给人看的东西。
const declaredRegions = (id) => ({
  header: layoutFor(id).header || '(没声明)',
  footer: layoutFor(id).footer || '(没声明)',
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

// 🔴 一张 404 的图在页面上是一个小破图标，看起来像"这套没什么可看的"（这一句本来就写在下面「全部块」
//   那一格上）。#1061 r2 之后首页和内页也到得了这个状态 —— 这一轮没拍成时盘上就是空的，不再有上一轮
//   那张顶着 —— 所以三格用同一个写法：有就摆图，没有就说这一张没拍到、并且说清这不是关于这套皮的读数。
const figImg = (id, suffix, alt) => (fs.existsSync(`${PUB}/shots/${id}${suffix}.png`)
  ? `<a href="shots/${id}${suffix}.png" target="_blank">
        <img loading="lazy" src="shots/${id}${suffix}.png" alt="${alt}"></a>`
  : '<p class="meta">🔴 <b>这一轮没拍到这一张</b>（这不是关于这套皮的读数）—— 那一套可能没建出来，'
    + '看 logs/build-&lt;id&gt;.log，重跑 shoot-themes.sh。</p>');

const card = (id) => {
  const t = themes[id];
  const facts = readFacts(id);
  return `
  <section class="card" id="${id}">
    <header>
      <h2>${id}
        ${tag(id).map(x => `<span class="trade">${x}</span>`).join('')}</h2>
      <p class="label">${t.label}</p>
      <p class="meta">
        <span class="sw" style="background:${t.colors.primary[500]}"></span>${t.colors.primary[500]}
        <span class="sw" style="background:${t.colors.accent[500]}"></span>${t.colors.accent[500]}
        &nbsp;·&nbsp; 字体 ${facts && facts.fontSans ? facts.fontSans.split(',')[0] : '<b>这一轮没读到</b>'}
        &nbsp;·&nbsp; 风格 ${t.style}
      </p>
      <p class="meta">适用行业：${t.industries.join(' / ')}</p>
    </header>
    <div class="shots">
      <figure>
        <figcaption>首页 —— 版式：${readback(id, '首页')}<br>${regionCaption(id)}${regionMismatch(id)}</figcaption>
        ${figImg(id, '', `${id} 首页`)}
      </figure>
      ${fs.existsSync(`${PUB}/shots/${id}-header.png`) ? `<figure>
        <figcaption>顶栏特写（多语言样例站）—— 最右那个语言开关要跟旁边导航一样读得清；这套页面上有
          ${REG[id] ? REG[id].langSwitchers : 0} 个语言开关</figcaption>
        <a href="shots/${id}-header.png" target="_blank"><img loading="lazy" src="shots/${id}-header.png" alt="${id} 顶栏特写"></a>
      </figure>` : ''}
      <figure>
        <figcaption>内页（关于我们）—— 版式：${readback(id, '内页')}</figcaption>
        ${figImg(id, '-about', `${id} 内页`)}
      </figure>
      <figure class="wide">
        <figcaption>全部块（样例站的 allblocks 页）—— ${blockTypesOnAllBlocks
    ? `这一页上有 <b>${blockTypesOnAllBlocks}</b> 种块，每种一次（从这张图那份产物的 <code>data-block</code> 数回来的）`
    : '<b>这一轮没读到这一页上有几种块</b>（sites/ 里没有 allblocks.html，重跑 shoot-themes.sh）'}。
          上面两张图上只有其中一部分，所以不在首页和关于页上的那些块，只有在这一张上看得见（#1061）。
          这一页下面没有版式读数：layout-readback.py 只给首页和内页分了组，
          <b>拿不到的读数就不摆一个看起来像读数的东西</b>。<br>
          图很高，<b>在下面这个框里往下滚</b>；点它开原图。</figcaption>
        ${fs.existsSync(`${PUB}/shots/${id}-allblocks.png`)
    ? `<div class="scroller"><a href="shots/${id}-allblocks.png" target="_blank"><img loading="lazy" src="shots/${id}-allblocks.png" alt="${id} 全部块"></a></div>`
    // 一张 404 的图在页面上是一个小破图标，看起来像"这套没什么可看的"。说出来。
    : '<p class="meta">🔴 <b>这一轮没拍到这一页</b>（这不是关于这套皮的读数）—— 样例站可能没撑开，重跑 shoot-themes.sh，它会先告诉你怎么撑。</p>'}
      </figure>
      ${fs.existsSync(`${PUB}/shots/${id}-slid.png`) ? `<figure class="wide">
        <figcaption>滑到底（#1190）—— 这套主题把某个块画成了一条能横滑的横条，这张图是把它
          <b>推到底之后</b>的样子。要看的是：条目滑走了，而这个块自己的标题和副题<b>还在原地</b>
          （它们不在滑动轴上）。静态图上一条能滑的横条跟一排卡片长得一模一样，所以单独拍这一张。<br>
          🔴 <b>没有这一格 ≠ 这一轮没拍成</b>：97 套里今天只有一套画了横条，其余的这一格本来就不存在。</figcaption>
        <div class="scroller"><a href="shots/${id}-slid.png" target="_blank">
          <img loading="lazy" src="shots/${id}-slid.png" alt="${id} 滑到底"></a></div>
      </figure>` : ''}
    </div>
  </section>`;
};

const html = `<!doctype html>
<html lang="zh"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${IS_SUBSET ? `Theme ${ids.length} 套（池子 ${POOL_TOTAL} 套里的一部分）` : `Theme 库存 ${ids.length} 套`} — 人审</title>
<style>
 body{font:15px/1.6 system-ui,sans-serif;margin:0;background:#f6f7f9;color:#111}
 .top{padding:24px 32px;background:#fff;border-bottom:1px solid #e3e6ea;position:sticky;top:0;z-index:2}
 .top h1{margin:0 0 6px;font-size:20px}
 .top p{margin:2px 0;color:#555;font-size:14px}
 nav{padding:12px 32px;background:#fff;border-bottom:1px solid #e3e6ea;line-height:2.2}
 nav a{display:inline-block;margin-right:10px;padding:2px 8px;border:1px solid #d6dae0;border-radius:4px;text-decoration:none;color:#222;font-size:13px}
 .card{background:#fff;margin:20px 32px;border:1px solid #e3e6ea;border-radius:8px;overflow:hidden}
 .card header{padding:16px 20px;border-bottom:1px solid #eef0f3}
 .card h2{margin:0;font-size:17px}
 /* 🔴 #932 r3 —— 这一条只管标题里的徽章 <span>；写成 .trade{...} 会连 nav 里的 <a> 一起涂。
    （#1161 拿掉了「本次新增 / 原有」那两个徽章和 nav 的 .new，因为那个判断已经恒真 —— 理由在
    文件顶部 OLD 那段。） */
 h2 span.trade{background:#0d817c;color:#fff;font-size:11px;padding:2px 6px;border-radius:3px;vertical-align:2px;margin-left:4px}
 .label{margin:6px 0 2px;color:#333}
 .meta{margin:2px 0;color:#666;font-size:13px}
 .sw{display:inline-block;width:12px;height:12px;border-radius:3px;border:1px solid #0002;margin:0 4px -1px 8px}
 .shots{display:grid;grid-template-columns:1fr 1fr;gap:16px;padding:16px 20px}
 /* #1061 —— 「全部块」那张占满一行。它是 34 段堆一页的整页图，挤进半栏之后每一段只有一百多像素宽，
    翻图的人分不出哪段是哪段 —— 那就等于没拍。
    🔴 但它必须装在一个能滚的框里：那张图 1440×23569，铺到卡片宽度上是一万九千多像素高，
    30 套就是六十多万像素的一页 —— 上下两套 theme 之间隔着二十几屏，人翻不动。
    装进 820px 的框之后每张卡片高度可控，要看细节点开原图。 */
 figure.wide{grid-column:1 / -1}
 figure.wide .scroller{max-height:820px;overflow-y:auto;border:1px solid #e3e6ea;border-radius:4px}
 figure.wide .scroller img{border:0;border-radius:0}
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
  <h1>${IS_SUBSET
    ? `Theme ${ids.length} 套 — 请挑掉不好看的`
    : `Theme 库存 ${ids.length} 套 — 请挑掉不好看的`}</h1>
  ${IS_SUBSET ? `<p>🔴 <b>这一页只有 ${ids.length} 套，不是全池。</b>池子现在共 ${POOL_TOTAL} 套；
    这一页是被点名的那 ${ids.length} 套（${ids.join(' ')}）。没在这一页上的不代表没问题，只代表这一轮没拍它。</p>` : ''}
  <p>同一个样例站（内容一个字没改）换了 ${ids.length} 次装，每套真构建一次后整页截图。</p>
  <p>怎么看：每套三张图 —— 首页 + 内页 + <b>全部块</b>（#1061 加的第三张：样例站里那一页把
    ${blockTypesOnAllBlocks || '全部'} 种块各摆一次，首页和关于页上没有的块只有在它上面看得见）。
    点图开原图。看着不行的，把它的名字（如 <code>plum-modern</code>）告诉我们就行。</p>
  <details class="ceiling"><summary>每张图下面那行「版式」是什么 / 这一页看不出什么（点开）</summary>
    ${RB
      ? `<p><b>图下面那行版式是从这张图那份产物里读回来的</b>，不是把注册表抄一遍：把这些套按「页面上真渲染出来的结构」分一次组，再按「注册表里声明的写法」分一次组，两次分组完全一样才敢写上去。所以你可以拿它当核对用——比如 hero 写着 <code>split</code> 的那 ${RB.facts.hero_distribution.split ?? 0} 套，图上就该是左文右图。</p>`
      : `<p style="color:#b00"><b>🔴 这一轮没有「版式读回」那条标注，图下面那一行是空的。</b>
         产出它的 <code>layout-readback.py</code> 按自己的纪律拒绝写文件，而那条纪律是对的：它的判据是
         「把这些套按页面上真渲染出来的骨架分组」，而今天产物里那一段是
         <code>&lt;section data-block="hero" class="hero"&gt;</code> —— 一个固定的语义类名，长相全靠主题那张表。
         于是每个位置都只有一组（本轮实测：首页 4 段 + 内页 2 段，六个位置全部是「1 组、17 套都在里面」）。
         <b>后果说在明处：这一页可以用来看「好不好看」，但【不能】用来核对「这套主题有没有按它声明的写法渲染」</b>
         —— 那一维这一轮没有读数。</p>`}
    <p><b>这一页看不出差别的三样（也是量出来的）：</b></p>
    <ul>
      ${RB ? `<li>每套的<b>页面组成完全相同</b> —— 首页都是 ${RB.facts.sections_home} 段、内页都是 ${RB.facts.sections_about} 段，顺序也一样。今天的换装只能给每一段挑一种写法，改不了「这页上有哪些段、按什么顺序排」。</li>` : ''}
      <!-- #981 条6/条7 —— 这一条原来是一句写死的话，说这两个 Region 各只有一种结构、身上没有换装这回事。
           #960 给了顶栏 4 种、页脚 3 种，那句话从那天起就是假的，而写死的话不会因为代码变了自己更新。
           换成从每张图那份产物读回来的两个分布（读法见 shoot.mjs 的 readRegions）。 -->
      <li><b>顶栏</b>（从每张图的产物读回来）：${tally(r => r.header)}。<b>页脚</b>：${tally(r => r.footer)}。
        每张图下面第二行写着这一套是哪一种；跟注册表声明不一致的那几套，那行末尾会挂一个 ⚠️。</li>
      <!-- #963 —— 这句原来写死了「浅底的只有 minimal 那几套」。#959 之后浅底有四种写法，
           那个括号就成了页面上一句假话。改成只报从图上读回来的两个数。 -->
      ${RB ? `<li>hero 一共 ${Object.keys(RB.facts.hero_distribution).length} 种写法：<b>${RB.facts.dark_hero} 套第一屏是深色满幅大标题</b>，${RB.facts.light_hero} 套是浅底。这两个数是从每张图那份产物的第一屏底色读回来的，不是按注册表数的。</li>` : ''}
    </ul>
  </details>
</div>
<nav>${ids.map(id => `<a href="#${id}">${id}</a>`).join('')}</nav>
${reviewSection()}
${ids.map(card).join('\n')}
</body></html>`;

fs.writeFileSync(`${PUB}/index.html`, html);
console.log(`写好了 ${PUB}/index.html —— ${ids.length} 套`);
