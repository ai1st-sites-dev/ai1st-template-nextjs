// #1802 —— 一页的整份 HTML（原来是 Next 的根布局 `src/app/layout.tsx` + Next 自己往 <head> 里加的那几样）。
//
// 跟 layout.tsx 逐段对照（谁变了、为什么，`scripts/render-diff.js` 的白名单里各有一条）：
//   <html lang dir data-bs-theme>                同
//   <head> charset / viewport                    Next 自己加的那两条，照抄
//          auto 配色脚本（#1472）                 留
//          globals.css                            Next 把它打包成 `/_next/static/css/<哈希>.css` 放在最前；这里是平台文件
//                                                 `/_platform/css/globals.<内容哈希>.css`，位置同（最前）
//          preconnect ×2 / icon                   同
//          metadata                               同一份 `Metadata`，按 Next 的规则合并、写出（`meta.tsx`）
//          base / site / shapes / theme / custom  同一个次序（次序就是层叠的机制，layout.tsx 那几段注释）。base / shapes 换成
//                                                 `/_platform/css/<名>.<哈希>.css`（决定 13：`_platform/` 一年 immutable 缓存，
//                                                 固定名就等于发版改了它老板一年看不到）；site.css 换成 `/_platform/css/<缓存键>.css`
//                                                 （T2a-1 的键）；theme / custom 是这个站自己的，原名
//          ai1st-version                          新加（T2c / 设计文档 §14 / e2e 在 live 上读它判版本）
//          preview ⟹ seo.indexable=false          robots 那条变成 `noindex, nofollow`（跟今天的预览构建同一条路，#1547）
//   <body> ai1st:nav / 换主题预览 / 编辑器探针    🔴 删：三段都是给编辑器 iframe 用的（后两段本来就只在 leadApi 的 origin 下回话），
//                                                 画布改在 dashboard 里本地画（设计文档 §5.5）
//          页面                                   同一组组件；岛（#1798）外面多一层 `<div data-island style="display:contents">`
//                                                 + 紧跟一份 props JSON
//          聊天小部件加载器（TICKET-273）          🔴 必须在，同一个函数（`lib/document-parts.ts`）
//          runtime                                新加：`/_platform/runtime.<哈希>.js`（岛 + Bootstrap 的那份脚本，替代 Next 的 chunk）
import { renderToStaticMarkup } from 'react-dom/server';
import type { ReactElement } from 'react';
import { AUTO_SCHEME_SCRIPT } from '../scripts/lib/color-scheme.js';
import { getSeo } from '@/lib/config';
import { buildChatWidgetLoader, buildFaviconSvg, chatWidgetSrc } from '@/lib/document-parts';
import type { SiteData } from '@/lib/types/config';

/** 平台那几份文件在站上的地址（`render-bundle.js` 打包时按内容哈希定名，写进 manifest）。 */
export interface PlatformHrefs {
  globalsCss: string;
  baseCss: string;
  shapesCss: string;
  runtimeJs: string;
}

export interface DocumentInput {
  site: SiteData;
  metaTags: ReactElement[];
  bodyHtml: string;
  version: number | string;
  platform: PlatformHrefs;
  /** `/_platform/css/<缓存键>.css` */
  siteCssHref: string;
  /** 要放进 <head> 的那几条首屏图预加载提示（`renderWithIslands` 摘下来交给这里，见 `src/islands/render.tsx` §splitPreloads）。 */
  headPreloads?: string[];
  /** 跳转小页：`<meta http-equiv="refresh">` 的目标（Next 那边 React 把它从 body 提进了 <head>，这里直接写进 <head>）。 */
  refreshTo?: string | null;
}

export function renderDocument({ site, metaTags, bodyHtml, version, platform, siteCssHref, headPreloads = [], refreshTo = null }: DocumentInput): string {
  const { brand, colorScheme, dir } = site;
  const seo = getSeo(site, site.defaultLocale);
  const chatSrc = chatWidgetSrc(site);
  const tail = renderToStaticMarkup(
    <>
      {chatSrc ? <script dangerouslySetInnerHTML={{ __html: buildChatWidgetLoader(chatSrc) }} /> : null}
      <script src={platform.runtimeJs} defer />
    </>,
  );
  // 整份文档一次渲染（跟 Next 一样由 React 排 <head>：样式表被它挪到 <head> 末尾、彼此次序不变）。body 是已经画好、岛已填好的
  // 那段 HTML（`render.tsx` §renderWithIslands），原样塞进去。
  // 首屏图的预加载提示（React 自己出的那几条，原样）接在 viewport 后面。🔴 不放进下面那棵树：React 把 `rel="preload"` 的 link 当
  // 「资源」处理，这条渲染路径下它会被冲到 <body> 最前面去（实测）。
  const VIEWPORT = '<meta name="viewport" content="width=device-width, initial-scale=1"/>';
  const preloads = headPreloads.join('');
  const doc = renderToStaticMarkup(
    <html lang={seo.locale.split('_')[0]} dir={dir} {...(colorScheme === 'auto' ? {} : { 'data-bs-theme': colorScheme })}>
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <link rel="stylesheet" href={platform.globalsCss} />
        {colorScheme === 'auto' ? <script dangerouslySetInnerHTML={{ __html: AUTO_SCHEME_SCRIPT }} /> : null}
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        {brand.logoUrl ? <link rel="icon" href={brand.logoUrl} /> : <link rel="icon" type="image/svg+xml" href={buildFaviconSvg(site)} />}
        {refreshTo ? <meta httpEquiv="refresh" content={`0; url=${refreshTo}`} /> : null}
        {metaTags}
        <link rel="stylesheet" href={platform.baseCss} />
        <link rel="stylesheet" href={siteCssHref} />
        <link rel="stylesheet" href={platform.shapesCss} />
        <link rel="stylesheet" href="/theme.css" />
        <link rel="stylesheet" href="/custom.css" />
        <meta name="ai1st-version" content={`v${version}`} />
      </head>
      <body className="d-flex flex-column min-vh-100 site-body" dangerouslySetInnerHTML={{ __html: bodyHtml + tail }} />
    </html>,
  );
  if (!doc.includes(VIEWPORT)) throw new Error('render/document.tsx: <head> 里找不到 viewport 那一条（React 的输出变了？）');
  return `<!DOCTYPE html>${doc.replace(VIEWPORT, VIEWPORT + preloads)}`;
}
