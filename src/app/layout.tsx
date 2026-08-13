import type { Metadata } from 'next';
import './globals.css';
import { brand, getSeo, getBrandName, defaultLocale, siteId, leadApi, themeCss } from '@/lib/config';
import { settingsToCssVars, RADIUS, SHADOW, DENSITY, BUTTON_SHAPE } from '@/lib/themeSettings';

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

function buildCssVariables(): string {
  const vars: string[] = [];
  for (const [shade, value] of Object.entries(brand.colors.primary)) {
    vars.push(`--color-primary-${shade}: ${value};`);
  }
  for (const [shade, value] of Object.entries(brand.colors.accent)) {
    vars.push(`--color-accent-${shade}: ${value};`);
  }
  vars.push(`--font-sans: ${brand.fonts.body.join(', ')};`);
  // #951: every theme has always carried a heading typeface (themes.js: 30/30, 16 of them different
  // from the body one) and nothing read it, so `realty-noir`'s Cormorant Garamond rendered as Jost.
  // 🔴 #953 item 10 — WHAT THE FALLBACK COVERS IS `heading: []`, NOT A MISSING FIELD. This used to say it
  // was for "a hand-written brand.json that predates the field"; such a config never reaches runtime at all,
  // because `heading` is a required `string[]` (lib/types/config.ts) and `next build` stops at type check
  // with "Property 'heading' is missing" — measured on this line's own baseline too, so it was never the
  // shape being defended. An empty array does pass type check, and then headings keep the body font.
  const headingFonts = brand.fonts.heading?.length ? brand.fonts.heading : brand.fonts.body;
  vars.push(`--font-heading: ${headingFonts.join(', ')};`);
  // #961: 风格设定（圆角/留白/阴影/按钮形状）。没有 brand.settings 的站这里一条都不产出，
  // 于是全部落回 globals.css `:root` 的默认值 —— 存量站的样子因此不变。
  vars.push(...settingsToCssVars(brand.settings));
  return `:root { ${vars.join(' ')} }`;
}

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
// block 全在 `<main class="flex-1">` 里面（`SiteShell.tsx:18`），而它是普通块级容器 ⟹ `order` 对它的
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
        <style dangerouslySetInnerHTML={{ __html: buildCssVariables() }} />
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link rel="stylesheet" href={brand.fonts.googleFontsUrl} />
        {/* #991 — the theme stylesheet, and it is LAST on purpose: it is the layer that owns block
            layout, so it has to win over globals.css without anyone reaching for `!important` (the
            contract forbids that, and this is why it can). Absent for every site with no `css` field
            in theme.json, which is all of them today — that is what keeps their HTML unchanged.
            🔴 It lives in public/ rather than src/ so Tailwind's content globs (src/components,
            src/app) cannot see it. If it moved under src/, Tailwind would not compile it — it would
            SCAN it, and every word inside would become a candidate class name. */}
        {themeCss && <link rel="stylesheet" href={`/themes/${themeCss}.css`} />}
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
