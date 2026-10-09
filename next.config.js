const path = require('path');

// #1665 —— 两种 production 构建，用 `AI1ST_RENDER` 切（两种都是 `next build` ⟹ NODE_ENV 都是 production，拿它当不了开关）：
//   · publish（不给 = 这个）  今天的静态导出：`output:'export'`，每页构建时渲染成 HTML 传 R2。一个字不变。
//   · preview                不导出：`next start` 起服务，每个页面在被访问时才渲染，站点内容每次从 site/ 读
//                            （`src/lib/site-data.server.ts`）⟹ 改内容不用重新构建。
// 🔴 只有这里读这个环境变量。应用代码要知道「这次是不是 preview」，读的是下面 `env` 里那个构建期烤进去的值
//    （`src/lib/render-mode.ts`）—— 所以 `.next/` 是哪种模式由**构建那一刻**定，起服务时的环境变量改不了它。
//    但 `next start` 也会读这份文件，起 preview 服务时要同样带 `AI1ST_RENDER=preview`，否则这里说 export、
//    Next 拒绝 `next start`。
// 不认识的值当场报错：拼错一个字母静默落回 publish，预览就又变回「改了要重建」，而且没人看得出来。
const renderMode = process.env.AI1ST_RENDER || 'publish';
if (renderMode !== 'preview' && renderMode !== 'publish') {
  throw new Error(`AI1ST_RENDER 只认 preview / publish（不给 = publish），拿到的是 ${JSON.stringify(process.env.AI1ST_RENDER)}`);
}
const isPreviewRender = renderMode === 'preview';

// 预览时这几份样式表是保存时重新生成的（主题 / 微调 / 配色 → Sass），文件名不变 ⟹ 浏览器不许拿缓存的旧版。
// `site.css` 以前的 `serve` 配置（worker/serve-preview.json）里漏了它，颜色改动走的正是它。
const NO_CACHE_CSS = ['theme.css', 'custom.css', 'base.css', 'site.css'];

/** @type {import('next').NextConfig} */
const nextConfig = {
  // output: 'export' 仅发布模式的 production build — 生成 static HTML 给 R2 publish.
  // Dev 模式（next dev → NODE_ENV='development'）必须 undefined，否则:
  //   - /_next/webpack-hmr WS endpoint 被当 dynamic route → 307 redirect → HMR 断
  //   - /_next/static/media/*.woff2 字体 → 403
  //   - [...slug]/page generateStaticParams() error
  // TICKET-211: see 209 invalid 4-direction lesson — root cause 在 template config 不在 CF/cert.
  // #1665: 预览模式也是 undefined —— 它要的就是一个 `next start` 能起的服务。
  output: process.env.NODE_ENV === 'production' && !isPreviewRender ? 'export' : undefined,
  // #1665 —— 应用代码读的那个布尔值（`src/lib/render-mode.ts`）。Next 在构建时把它原样替换进服务端和浏览器两份包。
  env: {
    AI1ST_PREVIEW_RENDER: isPreviewRender ? '1' : '',
  },
  ...(isPreviewRender ? {
    async headers() {
      return NO_CACHE_CSS.map((name) => ({
        source: `/${name}`,
        headers: [{ key: 'Cache-Control', value: 'no-cache' }],
      }));
    },
  } : {}),
  // #1547 —— 上线发布那一次构建把导出写进另一个目录（worker 发布时给一个绝对路径 `NEXT_EXPORT_DIR=/tmp/out-live-<id>`，
  // 见 worker/main.go §deployBuildScript），预览由 `serve` 供应的那份 `out/` 一个字节都不碰。机制是 Next 自己的：
  // `output:'export'` 且 distDir 不是 `.next` 时，distDir 被当成导出目录、编译产物仍进 `.next`
  // （node_modules/next/dist/build/index.js 的 `hasCustomExportOutput` 分支）。Next 拿 distDir 跟项目根做
  // path.join，所以绝对路径要先换成相对的。没给这个 env = `.next` = 跟改之前逐字节相同。
  distDir: process.env.NEXT_EXPORT_DIR ? path.relative(__dirname, process.env.NEXT_EXPORT_DIR) : '.next',
  // #1343 —— 只在开发服务里存在的路由（今天只有 `/__catalog/<块>/<形态>` 单格页 —— admin › Blocks & Themes
  // 的预览引擎；整页图册 board 在 #1458 退役）。
  // production 下这张清单是 Next 的默认值，所以**产物一个字节都不受影响**；dev 下多认一种
  // 扩展名 `.dev.tsx`，`src/app/.../page.dev.tsx` 于是只在 `next dev` 里是一个页面。
  // 🔴 为什么不用 `generateStaticParams` 回 `[]`（那是本来打算走的路）：Next 16 判「有没有写
  //    generateStaticParams」用的是 `prerenderedRoutes.length > 0`
  //    （`node_modules/next/dist/build/index.js`），空数组被判成没写，export 构建当场失败 ——
  //    `Page "/__catalog/[[...rest]]" is missing "generateStaticParams()"`（实测，#1343）。
  // 🔴 #1665 —— 这条跟上面那行 `output` **有意不再用同一个谓词**。以前两句都看 NODE_ENV，注释要求它们同时翻面，
  //    防的是「导出构建里还认得 .dev.tsx」那一格。现在 production 有两种：publish 导出、preview 不导出 ——
  //    `output` 要分开这两种，而 `.dev.tsx` 两种都不该认（单格页只在 `next dev` 里存在），所以这一句仍然只看
  //    NODE_ENV。那一格照旧不会出现：只要是 production 构建，不管哪种模式，这张清单都是 Next 的默认值。
  pageExtensions: process.env.NODE_ENV === 'production'
    ? ['tsx', 'ts', 'jsx', 'js']
    : ['dev.tsx', 'tsx', 'ts', 'jsx', 'js'],
  // Cross-origin allowlist for dev mode (Next.js 16 默认仅允许 localhost):
  //   *.ai1stsite.dev / *.ai1stsite.io  = cloud preview iframe own origin
  //   *.ai1st.site                      = cloud dashboard parent origin (浏览器从 iframe 加载 sub-resource
  //                                       时发的 Origin header 是 parent dashboard 的 origin)
  //   ai1st.local + localhost + 127.0.0.1  = 本地 dev (local manager + worker, preview = http://localhost:400X)
  // TICKET-211 follow-up: 真 browser e2e 发现 woff2/wss 都被 Next.js 16 cross-origin check 拦,
  // 必须把 parent dashboard domain 也加白名单。Production build 时此 field 被忽略 (dev only).
  allowedDevOrigins: ['*.ai1stsite.dev', '*.ai1stsite.io', '*.ai1st.site', 'ai1st.local', 'localhost', '127.0.0.1'],
  images: {
    unoptimized: true,
  },
};

module.exports = nextConfig;
