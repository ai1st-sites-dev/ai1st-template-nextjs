import type { Metadata } from 'next';
import './globals.css';
import { brand, getSeo, getBrandName, defaultLocale, siteId, leadApi } from '@/lib/config';
import { RADIUS, SHADOW, DENSITY, BUTTON_SHAPE } from '@/lib/themeSettings';

const seo = getSeo(defaultLocale);
// TICKET-136: layout.tsx is a server component with no locale prop — use the
// default-locale brand name for the site-wide baseline metadata (per-page
// metadata builders in lib/metadata.ts already pass locale through).
const defaultBrandName = getBrandName(defaultLocale);

function buildFaviconSvg(): string {
  const letter = (defaultBrandName || 'X').charAt(0).toUpperCase();
  const bg = brand.colors.primary[500] || '#6366f1';
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><rect width="32" height="32" rx="6" fill="${bg}"/><text x="16" y="23" text-anchor="middle" fill="white" font-family="system-ui,sans-serif" font-size="20" font-weight="bold">${letter}</text></svg>`;
  return `data:image/svg+xml,${encodeURIComponent(svg)}`;
}

// 🔴 #1002 —— `buildCssVariables()` 不在这里了。配色 / 字体族 / 风格设定以前是这个文件拼出来、
// 用一段 inline <style> 烤进每一页 HTML 的；现在它们住在 `/theme.css` 里（生成器是
// `scripts/theme-css.js`，由 `scripts/sync-config.js` 在每次构建时写出 `public/theme.css`）。
// 声明的内容和顺序逐字没变，所以搬家不改变任何一个 computed style。
//
// 为什么要搬：只要主题的值烤在 HTML 里，换一次主题就得重写每一页的 HTML —— 也就是必须重建。
// 搬进一个**文件名固定**的样式表之后，换主题就是替换那一个文件的内容，HTML 一个字节都不用动。
//
// 同一个理由带走了字体表的 <link>（`brand.fonts.googleFontsUrl`）：它的地址随主题变。它现在是
// theme.css 的第一行 `@import`。下面两条 preconnect 留着 —— 它们跟主题无关，永远是这两个地址。

// #925 — WHICH PARENT PAGE IS ALLOWED TO RECOLOUR THIS SITE.
//
// The dashboard's "change theme" modal previews a theme by postMessaging the palette into this
// page while it sits in the preview iframe. That listener must accept messages from our dashboard
// and from nobody else, so it needs to know our dashboard's origin at BUILD time — and a static
// export has exactly one channel for that: what sync-config.js bakes into config-data.ts.
//
// 🔴 We do not invent a new field for it: `leadApi` is already baked into every site (268b) and
// its value is `appBaseUrl` — the dashboard's own origin (`deploy/config/manager.*.json`:
// appdev.ai1st.site / app.ai1st.site / apptest.ai1st.site). So the trusted origin is that URL's
// origin, compared with `===`. No wildcard, no suffix matching, no `includes` — the pitfalls of a
// `*.ai1st.site` whitelist do not exist here because there is no pattern to get wrong.
//
// 📌 The cost of deriving it from leadApi rather than declaring it: if the API host is ever split
// off from the dashboard host, this origin stops matching and theme preview stops working. That
// direction is safe — the listener refuses the message, the dashboard's handshake times out, and
// the modal falls back to thumbnails ("applies after Apply"). It never trusts the wrong parent.
// 📌 Empty leadApi (local template dev) ⟹ no listener is emitted at all, same fail-closed end.
const previewTrustedOrigin = (() => {
  try {
    return leadApi ? new URL(leadApi).origin : '';
  } catch {
    return '';
  }
})();

// #925 — the inbound half of the iframe conversation. Kept as its own script tag: the outbound
// navigation script below is deliberately untouched (its `postMessage(…, "*")` is a known separate
// problem, #925 PM note D — fixing it is another ticket, and "it is already *" is not a reason to
// write this half loosely).
//
// Protocol (all four names namespaced `ai1st:theme-preview*`):
//   in  ai1st:theme-preview-ping   → answer, change nothing. Lets the modal find out whether this
//                                    build can preview at all before the owner clicks anything.
//   in  ai1st:theme-preview        → { theme: { colors: {primary,accent}, fontSans, fontHeading,
//                                                googleFontsUrl } }
//                                    paint it, then answer.
//   in  ai1st:theme-preview-reset  → drop the paint (Cancel), then answer.
//   out ai1st:theme-preview-ack    → the answer. Its ABSENCE within the modal's timeout is what
//                                    tells the modal this site was built before this code existed.
//
// #978 阶段 0 加了第二条通道，它自己的三个名字（`…-css*`）和自己的 ack：
//   in  ai1st:theme-preview-css-ping → answer, change nothing. 顺带把这一页有哪些 block 报上去。
//   in  ai1st:theme-preview-css      → { css: "<一段 CSS 文本>" } 注入它，然后答。
//   out ai1st:theme-preview-css-ack  → { blocks:[{type,role}…], ignored:[type…], refused:bool }
//   （清掉走的还是 `ai1st:theme-preview-reset` —— 一个 Cancel 收两条通道，不再多一个名字。）
//
// 🔴 为什么必须是【新名字】而不是给 `ai1st:theme-preview` 加字段（PM 在 #978 r1 量的）：下面那个
// 监听器只对**不认识的类型**才不回话。沿用旧名字的话，老构建照样回 ack、弹窗以为版式预览成功了，
// 而屏幕上只有颜色变了 —— UI 在说假话。新名字让老构建自然不认识 ⟹ 弹窗等不到回话，诚实地说
// 「这个站要重建一次才能预览版式」。
//
// ── #978 版式那一半的四条理由（写在这里而不是脚本里面：脚本是个模板字符串，反引号进不去）──
//
// 🔴 ① 注入的 CSS 自带一行 `main{display:flex;flex-direction:column}`，不靠发的人记得带上。
// block 全在 `<main class="flex-1">` 里面（`SiteShell.tsx:46` 的 `case 'content'` —— #1000 之后外壳按
// 区渲染，而外壳区不带 `data-block`，所以「block 全在 main 里面」这条仍然成立），而它是普通块级容器 ⟹ `order` 对它的
// 子元素不生效。PM 在真产物上量过（1280×900、四个 block）：只注入 order，四个 y 坐标
// `0 · 740 · 1343 · 1799` 一个都没动；先补那一行再注入 ⟹ `2074 · 0 · 603 · 1059`。
// 另一种写法 `main{display:contents}` 同样有效（他两种都量了，都不改变原页面），但它把 main 的盒子整个
// 去掉、`flex-1` 跟着失效，内容很短的页面页脚可能不再被顶到底部 —— 能不去掉盒子就不去掉（作者定）。
// 四个页面入口（首页 / `[...slug]` / blog / blog 详情）全部经 `SiteShell`，补一次就够。
//
// 🔴 ② 「这个 essential 还看得见吗」判据是**它画不画得出盒子**（`getClientRects().length`），不是它自己的
// computed display。后者对「祖先被藏了」按构造失明：父元素 `display:none` 时，子元素自己的 computed
// display 仍然是 `block` —— 而藏掉整块 block 恰恰是最容易写出来的那种规则。
// （同一个洞在 `scripts/theme-css-invariants.mjs:150` 那条不变量里也在，那是 #991 的面，本票没碰。）
//
// 🔴 ③ 挡下隐藏 essential 的判据是**量出来的后果**（这条规则命中了那个元素或它的某个祖先），不是拿正则去
// 猜选择器长什么样。所以按角色写的 `[data-role="essential"]{display:none}`（契约 §3 点名的那一条）和按类型
// 写的 `[data-block="contact-info"]{display:none}`（契约没写、而这是发的人真会写的那种）一起被盖住。
// 摘的是我们自己那张表里的那条 display 声明，站点本来的样式一个字都不碰。
//
// 🔴 ④ 注入之前先量一次。本来就画不出盒子的那些（站点自己的响应式隐藏等）不是我们造成的，也不该报成
// 「我们挡下了一条规则」。少了这一臂，读数就从"我们让谁不见了"变成"注入之后谁不见了"。
//
// 📌 `st` 是**现在注入着的那份 CSS 的性质**（挡下了哪几块 / 是不是整份没要），每一次回话都带上它，ping
// 也带。发的人会反复 ping（它得知道预览框有没有换页、有没有重载），要是 ping 的回话把这两个数报成空的，
// 弹窗上那句提示会在下一次 ping 时自己消失，而那条被挡下的规则还在。
// 📌 摘不掉的那种（例如整块 block 被藏、而 essential 是它的子元素）⟹ 整份不要。essential 不许被藏是
// 硬的，「只生效一半」比「没生效」更难解释。
// 📌 脚本里一条注释都不留：它是内联进**每一个站的每一页**的字节。#925 那一半也是这个规矩。
//
// 🔴 #1084 —— 那段算字色的算术在这里【复制】了一份，而正本是 `scripts/lib/button-ink.js`。
// 为什么必须复制：这段脚本是内联进站产物里在**浏览器**跑的字节，它 require 不到任何东西；而 dashboard
// 与 templates/nextjs 是两个包，也没法共享一个模块。
// 为什么必须有这一份（不是「顺手也加上」）：不加，换装弹窗预览里的按钮仍是兜底的白字，而 Apply
// 之后站上是算出来的深字 —— 预览与构建就不是同一件事了。守着这条一致性的是
// `tests/e2e/specs/925-theme-preview-postmessage-contract.spec.ts`（它在真浏览器里对真 `next build`
// 的产物量 `--color-primary-*`：预览消息一到就换色、Cancel 原样还回去）。
// 📌 那份 spec 今天**量不到这三个变量**（它读的是 `--color-primary-500/700` / `--color-accent-500` /
//    `--font-sans` 四个）⟹ 它不会因为少了这一份而变红。所以这一份的理由不是「让那格绿」，是那格
//    描述的那件事本身；而钉住两份算术不分叉的是 `scripts/lib/button-ink.test.js` 第 ④ 格。
// 🔴 两份不许分叉，而管这件事的**不是**这条注释：`scripts/lib/button-ink.test.js` 把这段脚本从本文件
// 的源码里抠出来在 node 里跑，拿 110 套注册表配色逐套跟正本对答案。
// 🔴 #1084 r3 —— 轮廓按钮那一档要按**它真正被画在上面的那块底**选（正本 `button-ink.js` ③a/③b）。
// 构建时那一侧从主题表的字节里解；这里没有那份字节（预览换的是 `--color-*`，表还是页面上原来那张），
// 所以改成**从真 DOM 量**：`.services-list__item` 优先、其次 `.services-list`，取第一个真的画了底的
// （computed 是 `rgba(...,0)` 的不算 —— QA2 在真机上量到 `__item` 常常是透明的，拿透明去算出来的是
// 页面上不存在的配对）。页面上没有 services-list 时落回白底，而那时这个变量在这一页上不画任何东西。
// 🔴 量之前必须先把颜色那一半写进覆盖元素（见 `paint` 里那次中途 `s.textContent=`）：那块底本身就是
// `var(--color-primary-N)`，不先生效就会拿**上一套**配色的颜色去定这一套的档位。
// 📌 只认 6 位十六进制：上面那个颜色循环接受 3~8 位，而这段算术假定 6 位。认不出的形状**不产出**这三个
// 变量，于是页面落回 globals.css 里的兜底值 = 本票之前的行为，而不是产出一个错的字色。
// 🔴 这里的 `CR()` 判的是 **blended**：先把字色朝底色掺 0.06（= `theme-contrast.js` 的 `PAINT_BLEND`，
//    模拟抗锯齿），再算对比度。**不是**裸对比度 —— 两者在这批配色上差 0.2–0.33，够把一整格从合格翻成
//    不合格。那个 0.06 在这里是**抄来的字面值**（浏览器里 require 不到那个模块），钉住它不漂的同样是
//    `scripts/lib/button-ink.test.js` 第 ④ 格：它拿 110 套配色逐套跟正本对答案，正本改了尺而这里没改
//    的话，那一格当场红。
//
// 🔴 Why an override <style> element and not writing on document.documentElement.style: Cancel has
// to restore EXACTLY what the site had, and what it had is not always the registry's palette — an
// AI edit can change brand.json's colours. Emptying an override element restores the original
// `:root` block byte for byte, with no snapshot to get wrong. Same rule for the font: a second
// <link> that we add and remove, never the site's own one.
function buildThemePreviewScript(trustedOrigin: string): string {
  return `(function(){
if(window.parent===window)return;
var T=${JSON.stringify(trustedOrigin)};
var s=null,f=null,c=null;
function els(){
  if(!s){s=document.createElement('style');s.id='ai1st-theme-preview';document.head.appendChild(s);}
  if(!f){f=document.createElement('link');f.id='ai1st-theme-preview-font';f.rel='stylesheet';document.head.appendChild(f);}
}
function cssEl(){
  if(!c){c=document.createElement('style');c.id='ai1st-theme-preview-css';document.head.appendChild(c);}
  return c;
}
function paint(t){
  els();
  var out=[],g=['primary','accent'],i,k,sh;
  for(i=0;i<g.length;i++){
    sh=(t&&t.colors&&t.colors[g[i]])||{};
    for(k in sh){
      if(Object.prototype.hasOwnProperty.call(sh,k)&&/^[0-9]{2,3}$/.test(k)&&typeof sh[k]==='string'&&/^#[0-9a-fA-F]{3,8}$/.test(sh[k])){
        out.push('--color-'+g[i]+'-'+k+':'+sh[k]+';');
      }
    }
  }
  // #1084 r3 —— 先把颜色那一半贴上去再往下走。下面算轮廓按钮那一档要**从真 DOM 量它坐着的那块底**，
  // 而那块底自己就是 var(--color-primary-N)：不先让被预览的这套配色生效，量到的是上一套的颜色。
  s.textContent=out.length?(':root{'+out.join('')+'}'):'';
  var pk=(t&&t.colors&&t.colors.primary)||{},p5=pk['500'];
  if(typeof p5==='string'&&/^#[0-9a-fA-F]{6}$/.test(p5)){
    var BY=function(h){return [1,3,5].map(function(j){return parseInt(h.substr(j,2),16);});};
    var LU=function(r){var v=r.map(function(b){var c=b/255;return c<=0.03928?c/12.92:Math.pow((c+0.055)/1.055,2.4);});return 0.2126*v[0]+0.7152*v[1]+0.0722*v[2];};
    var CR=function(ih,gh){var i=BY(ih),g=BY(gh),p=i.map(function(v,k){return Math.round(v+(g[k]-v)*0.06);}),x=LU(p),y=LU(g);return (Math.max(x,y)+0.05)/(Math.min(x,y)+0.05);};
    var ok=function(h){return typeof h==='string'&&/^#[0-9a-fA-F]{6}$/.test(h);};
    var ink=CR('#ffffff',p5)>=4.5?'#ffffff':(CR('#000000',p5)>=4.5?'#000000':'#ffffff');
    var lad=ink==='#000000'?['400','300','200','100','50']:['600','700','800','900'],hv='',ol='',q;
    if(ok(pk['600'])&&CR(ink,pk['600'])>=4.5){hv='600';}
    for(q=0;!hv&&q<lad.length;q++){if(ok(pk[lad[q]])&&CR(ink,pk[lad[q]])>=4.5){hv=lad[q];break;}}
    if(!hv){hv='600';}
    var gnd='#ffffff',sel=['.services-list__item','.services-list'],el,mm;
    for(q=0;q<sel.length;q++){
      try{el=document.querySelector(sel[q]);}catch(e){el=null;}
      if(!el){continue;}
      mm=String((getComputedStyle(el)||{}).backgroundColor||'').match(/^rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*([0-9.]+))?\)/);
      if(mm&&(mm[4]===undefined||parseFloat(mm[4])>0)){gnd='#'+[1,2,3].map(function(z){return ('0'+Number(mm[z]).toString(16)).slice(-2);}).join('');break;}
    }
    var OL=['500','600','400','700','300','800','200','900','100','50'];
    for(q=0;q<OL.length;q++){if(ok(pk[OL[q]])&&CR(pk[OL[q]],gnd)>=4.5){ol=OL[q];break;}}
    if(!ol){ol='500';}
    out.push('--btn-primary-ink:'+ink+';');
    if(hv){out.push('--btn-primary-hover:var(--color-primary-'+hv+');');}
    if(ol){out.push('--btn-outline-ink:var(--color-primary-'+ol+');');}
  }
  if(t&&typeof t.fontSans==='string'&&!/[;{}<>]/.test(t.fontSans)){out.push('--font-sans:'+t.fontSans+';');}
  if(t&&typeof t.fontHeading==='string'&&!/[;{}<>]/.test(t.fontHeading)){out.push('--font-heading:'+t.fontHeading+';');}
  // #961 — 风格设定的四组。校验方式比颜色和字体那几条更严：这里【不接受任意字符串】，
  // 只认 S 这张表里的档位名，值也全部来自表本身 ⟹ 拼进 <style> 的字符永远是我们自己写的。
  // S 是构建时从 src/lib/themeSettings.ts 原样塞进来的同一张表，所以预览和构建不会对不上。
  var S=${JSON.stringify({ radius: RADIUS, shadow: SHADOW, density: DENSITY, buttonShape: BUTTON_SHAPE })};
  var grp=[['radius','--radius-'],['shadow','--shadow-'],['density','--section-']];
  for(i=0;i<grp.length;i++){
    var tok=t&&t[grp[i][0]],tbl=S[grp[i][0]];
    if(typeof tok==='string'&&Object.prototype.hasOwnProperty.call(tbl,tok)){
      var vs=tbl[tok];
      for(k in vs){if(Object.prototype.hasOwnProperty.call(vs,k)){out.push(grp[i][1]+k+':'+vs[k]+';');}}
    }
  }
  if(t&&typeof t.buttonShape==='string'&&Object.prototype.hasOwnProperty.call(S.buttonShape,t.buttonShape)){
    out.push('--radius-button:'+S.buttonShape[t.buttonShape]+';');
  }
  s.textContent=out.length?(':root{'+out.join('')+'}'):'';
  if(t&&typeof t.googleFontsUrl==='string'&&/^https:\\/\\/fonts\\.googleapis\\.com\\//.test(t.googleFontsUrl)){f.href=t.googleFontsUrl;}
  else{f.removeAttribute('href');}
}
function clear(){if(s){s.textContent='';}if(f){f.removeAttribute('href');}if(c){c.textContent='';}st={ignored:[],refused:false};}
var MAIN_FLEX='main{display:flex;flex-direction:column}';
var st={ignored:[],refused:false};
function blockList(){
  var out=[],ns=document.querySelectorAll('[data-block]'),i;
  for(i=0;i<ns.length;i++){out.push({type:ns[i].getAttribute('data-block'),role:ns[i].getAttribute('data-role')||''});}
  return out;
}
function unseen(){
  var out=[],ns=document.querySelectorAll('[data-role="essential"]'),i;
  for(i=0;i<ns.length;i++){if(ns[i].getClientRects().length===0){out.push(ns[i]);}}
  return out;
}
function nameOf(el){
  var n=el;
  while(n&&n!==document.body){if(n.getAttribute&&n.getAttribute('data-block')){return n.getAttribute('data-block');}n=n.parentNode;}
  return '?';
}
function chainMatches(el,sel){
  var n=el;
  while(n&&n.nodeType===1){try{if(n.matches(sel))return true;}catch(err){return false;}if(n===document.body)break;n=n.parentNode;}
  return false;
}
function unhide(els){
  var names=[],sheet=c&&c.sheet;
  if(!sheet)return names;
  function scan(rules){
    for(var j=0;j<rules.length;j++){
      var r=rules[j];
      if(r.cssRules&&r.cssRules.length){scan(r.cssRules);continue;}
      if(!r.selectorText||!r.style)continue;
      if((r.style.getPropertyValue('display')||'').replace(/\\s/g,'')!=='none')continue;
      for(var k=0;k<els.length;k++){
        if(chainMatches(els[k],r.selectorText)){
          r.style.removeProperty('display');
          var nm=nameOf(els[k]);
          if(names.indexOf(nm)<0)names.push(nm);
        }
      }
    }
  }
  scan(sheet.cssRules);
  return names;
}
function paintCss(text){
  var el=cssEl(),i,k,before=unseen(),newly=[],now,still=[];
  el.textContent=MAIN_FLEX+text;
  now=unseen();
  for(i=0;i<now.length;i++){if(before.indexOf(now[i])<0){newly.push(now[i]);}}
  if(newly.length===0){st={ignored:[],refused:false};return;}
  var ignored=unhide(newly);
  now=unseen();
  for(i=0;i<now.length;i++){if(before.indexOf(now[i])<0){still.push(nameOf(now[i]));}}
  if(still.length){
    el.textContent='';
    for(k=0;k<still.length;k++){if(ignored.indexOf(still[k])<0)ignored.push(still[k]);}
    st={ignored:ignored,refused:true};
    return;
  }
  st={ignored:ignored,refused:false};
}
window.addEventListener('message',function(e){
  if(e.origin!==T)return;
  var d=e.data;
  if(!d||typeof d!=='object')return;
  if(d.type==='ai1st:theme-preview-css'||d.type==='ai1st:theme-preview-css-ping'){
    if(d.type==='ai1st:theme-preview-css'){paintCss(typeof d.css==='string'?d.css:'');}
    try{window.parent.postMessage({type:'ai1st:theme-preview-css-ack',blocks:blockList(),
      ignored:st.ignored,refused:st.refused,applied:!!(c&&c.textContent)},T);}catch(err){}
    return;
  }
  if(d.type==='ai1st:theme-preview'){paint(d.theme);}
  else if(d.type==='ai1st:theme-preview-reset'){clear();}
  else if(d.type!=='ai1st:theme-preview-ping'){return;}
  try{window.parent.postMessage({type:'ai1st:theme-preview-ack'},T);}catch(err){}
});
})();`;
}

export const metadata: Metadata = {
  title: {
    default: seo.siteTitle,
    template: `%s | ${defaultBrandName}`,
  },
  description: seo.siteDescription,
  keywords: seo.keywords,
  metadataBase: new URL(seo.domain),
  alternates: {
    canonical: '/',
  },
  openGraph: {
    title: seo.siteTitle,
    description: seo.siteDescription,
    url: seo.domain,
    siteName: defaultBrandName,
    locale: seo.locale,
    type: 'website',
  },
  twitter: {
    card: 'summary_large_image',
    title: seo.siteTitle,
    description: seo.siteDescription,
  },
  robots: {
    index: true,
    follow: true,
    googleBot: {
      index: true,
      follow: true,
      'max-video-preview': -1,
      'max-image-preview': 'large',
      'max-snippet': -1,
    },
  },
  verification: seo.verification,
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang={seo.locale.split('_')[0]}>
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        {/* #1001 — the floor, and it is UNCONDITIONAL on purpose. The arm base.css exists for is
            "neutral markup with NO theme sheet" (an old site rebuilding on dev, or phase 2 having
            moved a block before some sheet caught up), so gating it on the theme would take the
            fallback away in exactly the case it is the fallback for. It is one <link> and one
            request for sites that render the old markup, where its rules select nothing.
            🔴 It goes BEFORE the theme link and both are unlayered: same specificity (both files
            select single classes), so the later one wins — that ordering IS the mechanism by which
            a theme overrides the floor. See public/base.css's header. */}
        <link rel="stylesheet" href="/base.css" />
        {/* #1002 — 皮和微调，两个固定路径，无条件加载。
            · /theme.css   主题的全部：字体表的 @import、配色 / 字体族 / 风格设定的 :root、以及
              这个站的形态样式表（#991 的 public/themes/<name>.css，它的字节被贴进这份文件）。
              换主题 = 换掉这个文件的内容，**文件名不变** ⟹ HTML 不用重写 ⟹ 不用重建。
            · /custom.css  这个站自己的微调（#1006）。换主题时它一个字节都不动，所以「换了主题
              微调还在」是结构上自动成立的，不需要任何把微调套回去的逻辑。它排在最后，所以它赢。
            🔴 两份都排在 globals.css 打包出来的那个 <link> 之后（Next 把自己的样式表放在 <head>
            最前面），主题层因此不用 `!important` 就能压过它 —— 契约禁止 !important，这是它能禁的原因。
            🔴 它们生成在 public/ 而不是 src/：Tailwind 的 content glob 扫 src/，样式表落进去不会被
            编译、只会被**扫**，里面每个词都会变成候选 class 名。 */}
        <link rel="stylesheet" href="/theme.css" />
        <link rel="stylesheet" href="/custom.css" />
        {brand.logoUrl ? (
          <link rel="icon" href={brand.logoUrl} />
        ) : (
          <>
            <link rel="icon" type="image/svg+xml" href={buildFaviconSvg()} />
            <link rel="icon" href="/favicon.ico" sizes="any" />
          </>
        )}
      </head>
      <body className="flex min-h-screen flex-col font-sans">
        {/* TICKET-131: when this page is embedded in an iframe (dashboard
            PreviewPanel), notify the parent on every navigation so the URL bar
            stays in sync. Standalone production users (window.parent === window)
            short-circuit immediately — script is a no-op for them. */}
        <script
          dangerouslySetInnerHTML={{
            __html: `(function(){if(window.parent===window)return;function n(){try{window.parent.postMessage({type:"ai1st:nav",path:window.location.pathname+window.location.search+window.location.hash},"*");}catch(e){}}n();var p=history.pushState;history.pushState=function(){p.apply(this,arguments);n();};var r=history.replaceState;history.replaceState=function(){r.apply(this,arguments);n();};window.addEventListener("popstate",n);})();`,
          }}
        />
        {/* #925: theme preview listener — only emitted when we know our dashboard's origin
            (see previewTrustedOrigin). Absent ⟹ the modal's handshake times out and it says so. */}
        {previewTrustedOrigin && (
          <script
            dangerouslySetInnerHTML={{ __html: buildThemePreviewScript(previewTrustedOrigin) }}
          />
        )}
        {children}
        {/* TICKET-273: AI chat widget. Always injected (siteId+leadApi from 268); the widget self-gates
            at runtime via /api/chat/widget-config, so toggling chat_enabled off deactivates it on the
            next load with no rebuild. Absent leadApi/siteId (dev) → skipped. */}
        {siteId && leadApi && (
          <script async src={`${leadApi.replace(/\/$/, '')}/widget.js?site=${siteId}`} />
        )}
      </body>
    </html>
  );
}
