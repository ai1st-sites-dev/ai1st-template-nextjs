/** @type {import('next').NextConfig} */
const nextConfig = {
  // output: 'export' 仅 production build（next build → NODE_ENV='production'）— 生成 static HTML 给 R2 publish.
  // Dev 模式（next dev → NODE_ENV='development'）必须 undefined，否则:
  //   - /_next/webpack-hmr WS endpoint 被当 dynamic route → 307 redirect → HMR 断
  //   - /_next/static/media/*.woff2 字体 → 403
  //   - [...slug]/page generateStaticParams() error
  // TICKET-211: see 209 invalid 4-direction lesson — root cause 在 template config 不在 CF/cert.
  output: process.env.NODE_ENV === 'production' ? 'export' : undefined,
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
