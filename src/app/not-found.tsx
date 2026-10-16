// #1552 —— 真 404。静态导出时它就是 `out/404.html`；Cloudflare worker 取不到对象时先找 `<siteId>/404.html`，
// 有就以 HTTP 404 返回（`cloudflare/worker.js` §404），所以这一页就是线上「不存在的地址」看到的那一页。
// #1802 —— 页面本身搬到了 `components/pages/NotFoundPage.tsx`（`render/` 出 `404.html` 用同一个组件）。
import NotFoundPage from '@/components/pages/NotFoundPage';
import { loadSiteData, requestSiteData } from '@/lib/site-data.server';
import { isPreviewRender } from '@/lib/render-mode';

// #1665 —— 发布模式下这个组件是**同步**的，理由同 layout.tsx 的 RootLayout：写成 async 之后，Next 给 404 页插的那条
//    `<meta name="robots" content="noindex">` 在 <head> 里的位置跟着渲染快慢走（本机快的那台排对了、站容器里排错了，实测），
//    发布出去的 404.html 就不再逐字相同。预览模式先 `requestSiteData()`（按请求渲染），再画同一份。
export default function NotFound() {
  return isPreviewRender ? requestSiteData().then((site) => <NotFoundPage site={site} />) : <NotFoundPage site={loadSiteData()} />;
}
