/** @type {import('next').NextConfig} */
const nextConfig = {
  // output: 'export' 仅 production build（next build → NODE_ENV='production'）— 生成 static HTML 给 R2 publish.
  // Dev 模式（next dev → NODE_ENV='development'）必须 undefined，否则:
  //   - /_next/webpack-hmr WS endpoint 被当 dynamic route → 307 redirect → HMR 断
  //   - /_next/static/media/*.woff2 字体 → 403
  //   - [...slug]/page generateStaticParams() error
  // TICKET-211: see 209 invalid 4-direction lesson — root cause 在 template config 不在 CF/cert.
  output: process.env.NODE_ENV === 'production' ? 'export' : undefined,
  images: {
    unoptimized: true,
  },
};

module.exports = nextConfig;
