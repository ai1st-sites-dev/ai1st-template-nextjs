const path = require('path');

/** @type {import('next').NextConfig} */
const nextConfig = {
  // output: 'export' 仅 production build（next build → NODE_ENV='production'）— 生成 static HTML 给 R2 publish.
  // Dev 模式（next dev → NODE_ENV='development'）必须 undefined，否则:
  //   - /_next/webpack-hmr WS endpoint 被当 dynamic route → 307 redirect → HMR 断
  //   - /_next/static/media/*.woff2 字体 → 403
  //   - [...slug]/page generateStaticParams() error
  // TICKET-211: see 209 invalid 4-direction lesson — root cause 在 template config 不在 CF/cert.
  output: process.env.NODE_ENV === 'production' ? 'export' : undefined,
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
  // 🔴 这条要跟上面那行 `output` 用**同一个**谓词：一个说「这次是静态导出」，另一个说「这次不带
  //    dev 专用路由」，两句话必须同时翻面，否则会出现「导出构建里还认得 .dev.tsx」这一格。
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
