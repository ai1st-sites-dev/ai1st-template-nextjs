// #1802 —— 整页外壳里那几段「不是 metadata、也不是块」的东西：Next 的根布局（`app/layout.tsx`）和 Next 外的整页渲染
// （`render/document.tsx`）都要出它们，所以住这一处，两边 import 同一份 —— 只写一份才不会一边改了另一边没跟。
import type { SiteData } from './types/config';
import { getBrandName } from './config';

// TICKET-136: layout.tsx is a server component with no locale prop — use the
// default-locale brand name for the site-wide baseline metadata (per-page
// metadata builders in lib/metadata.ts already pass locale through).
export function buildFaviconSvg(site: SiteData): string {
  const letter = (getBrandName(site, site.defaultLocale) || 'X').charAt(0).toUpperCase();
  const bg = site.brand.colors.primary[500] || '#6366f1';
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><rect width="32" height="32" rx="6" fill="${bg}"/><text x="16" y="23" text-anchor="middle" fill="white" font-family="system-ui,sans-serif" font-size="20" font-weight="bold">${letter}</text></svg>`;
  return `data:image/svg+xml,${encodeURIComponent(svg)}`;
}

// #1409 — the chat widget loader (TICKET-273). Everything except the editor route gets the widget; see the call site in
// app/layout.tsx. 🔴 The prefix is the editor's route (`src/app/~editor`). `JSON.stringify` + escaping `<` keeps the URL one
// string literal inside the script.
const EDITOR_ROUTE_PREFIX = '/~editor/';
export function buildChatWidgetLoader(src: string): string {
  return `(function(){if(location.pathname.indexOf(${JSON.stringify(EDITOR_ROUTE_PREFIX)})===0)return;`
    + `var s=document.createElement("script");s.async=true;s.src=${JSON.stringify(src).replace(/</g, '\\u003c')};`
    + `document.body.appendChild(s);})();`;
}

/** 聊天小部件那段加载脚本要的地址；`leadApi` / `siteId` 缺一个 ⟹ `null`（不出这段脚本，本地开发就是这样）。 */
export function chatWidgetSrc(site: Pick<SiteData, 'leadApi' | 'siteId'>): string | null {
  const { leadApi, siteId } = site;
  return siteId && leadApi ? `${leadApi.replace(/\/$/, '')}/widget.js?site=${siteId}` : null;
}
