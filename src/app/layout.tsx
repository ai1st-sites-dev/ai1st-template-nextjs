import type { Metadata } from 'next';
import './globals.css';
import { brand, getSeo, getBrandName, defaultLocale, siteId, leadApi } from '@/lib/config';
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
  // The fallback is for a hand-written brand.json that predates the field — headings then keep the
  // body font, which is exactly what they did before this line existed.
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
// 🔴 Why an override <style> element and not writing on document.documentElement.style: Cancel has
// to restore EXACTLY what the site had, and what it had is not always the registry's palette — an
// AI edit can change brand.json's colours. Emptying an override element restores the original
// `:root` block byte for byte, with no snapshot to get wrong. Same rule for the font: a second
// <link> that we add and remove, never the site's own one.
function buildThemePreviewScript(trustedOrigin: string): string {
  return `(function(){
if(window.parent===window)return;
var T=${JSON.stringify(trustedOrigin)};
var s=null,f=null;
function els(){
  if(!s){s=document.createElement('style');s.id='ai1st-theme-preview';document.head.appendChild(s);}
  if(!f){f=document.createElement('link');f.id='ai1st-theme-preview-font';f.rel='stylesheet';document.head.appendChild(f);}
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
function clear(){if(s){s.textContent='';}if(f){f.removeAttribute('href');}}
window.addEventListener('message',function(e){
  if(e.origin!==T)return;
  var d=e.data;
  if(!d||typeof d!=='object')return;
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
