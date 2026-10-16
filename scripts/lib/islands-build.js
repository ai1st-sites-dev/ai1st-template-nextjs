// #1798 —— 岛的两样产物，都用 esbuild 打（模板没有 Vite；T2a-2 的整页 bundle 用的也是它，多一个 entry 而已）：
//
//   buildRuntime({ outdir })   浏览器那一份：`src/islands/runtime.tsx` → iife、压缩、NODE_ENV=production，
//                              文件名 `runtime.<内容哈希>.js`（内容不变哈希不变；改一个岛哈希就变）。
//                              页面底部引 `/_platform/runtime.<hash>.js`，上传归 T2c。
//   buildServer({ entry, outfile })   服务端那一份：任意 TSX 入口（例如测试的 harness）→ CommonJS，给 node require。
//                              react / react-dom 和 `scripts/` 下的 CommonJS 一律留成外部引用：
//                              🔴 后者靠自己的 `__dirname` 找 blocks/ 和清单，打进包里 `__dirname` 就成了产物目录（#1409 踩过）。
//
// `noHydrate: true` 只给测试的变异臂用：runtime 里 `hydrateRoot` 那一行不执行（见 runtime.tsx）。
// `plugins`：原样交给 esbuild（测试拿它在打包时改一个岛的源码，量「改一个岛哈希就变」，不碰磁盘上的文件）。
'use strict';
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const crypto = require('crypto');

const ROOT = path.resolve(__dirname, '..', '..');
const SCRIPTS = path.join(ROOT, 'scripts') + path.sep;

function esbuild() {
  return require('esbuild');
}

// Bootstrap 里 runtime 不带的模块。它们只经 `BootstrapJs.tsx` 那张按需加载表（LOADERS）进来 —— 在 Next 里按需切块、不用不下载；
// 打成 iife 时按需 import 会被整个内联，tooltip 还拖进 popper。现取没有任何块用它们（`data-bs-toggle` 只有 collapse / modal，
// `loadBootstrap(...)` 只点名 carousel / collapse / modal），换成一个一被调用就报错的桩：真有人用上，控制台当场说出来。
const RUNTIME_STUBBED = ['offcanvas', 'tooltip'];
const stubUnusedBootstrap = {
  name: 'islands-stub-unused-bootstrap',
  setup(b) {
    const re = new RegExp(`^bootstrap/js/dist/(${RUNTIME_STUBBED.join('|')})(\\.js)?$`);
    b.onResolve({ filter: re }, (args) => ({ path: args.path, namespace: 'islands-stub' }));
    b.onLoad({ filter: /.*/, namespace: 'islands-stub' }, (args) => ({
      contents: `const fail = () => { throw new Error(${JSON.stringify(`#1798: the islands runtime does not ship ${args.path} (scripts/lib/islands-build.js RUNTIME_STUBBED)`)}); };
export default { getOrCreateInstance: fail, getInstance: fail };`,
      loader: 'js',
    }));
  },
};

// 🔴 临时（T1b #1794 合进 main 之前）：顶栏 / 页脚经 `SiteLink`、价格表直接，都还 import `next/link`；离开 Next 它跑不起来。
//    T1b 把 `SiteLink` 改成普通 `<a>` 并让块不再 import `next/link`，这里换的就是那个形状（`href` 原样，其余属性透传）。
//    T1b 合进来之后岛的依赖里一处 `next/link` 都没有 ⟹ 这个插件一次都不触发 —— 后合的那张票把它连同下面两处引用一起删掉。
const nextLinkUntilT1b = {
  name: 'islands-next-link-until-t1b',
  setup(b) {
    b.onResolve({ filter: /^next\/link$/ }, () => ({ path: 'next/link', namespace: 'islands-next-link' }));
    b.onLoad({ filter: /.*/, namespace: 'islands-next-link' }, () => ({
      contents: `import { createElement } from 'react';
export default function Link({ href, prefetch: _p, replace: _r, scroll: _s, ...rest }) { return createElement('a', { ...rest, href: typeof href === 'string' ? href : String(href) }); }`,
      loader: 'js',
      resolveDir: ROOT,
    }));
  },
};

async function buildRuntime({ outdir, noHydrate = false, minify = true, plugins = [] } = {}) {
  const r = await esbuild().build({
    entryPoints: [path.join(ROOT, 'src', 'islands', 'runtime.tsx')],
    bundle: true,
    format: 'iife',
    platform: 'browser',
    target: ['es2019'],
    minify,
    write: false,
    jsx: 'automatic',
    tsconfig: path.join(ROOT, 'tsconfig.json'),
    define: { 'process.env.NODE_ENV': '"production"', __ISLANDS_NO_HYDRATE__: noHydrate ? 'true' : 'false' },
    legalComments: 'none',
    plugins: [stubUnusedBootstrap, nextLinkUntilT1b, ...plugins],
    logLevel: 'silent',
  });
  const code = r.outputFiles[0].contents;
  const hash = crypto.createHash('sha256').update(code).digest('hex').slice(0, 16);
  const name = `runtime.${hash}.js`;
  let file = null;
  if (outdir) {
    fs.mkdirSync(outdir, { recursive: true });
    file = path.join(outdir, name);
    fs.writeFileSync(file, code);
  }
  return { name, hash, file, bytes: code.length, gzipBytes: zlib.gzipSync(code, { level: 9 }).length, code };
}

// `scripts/` 下的 .js（CommonJS）留给 node 自己 require —— 按解析出来的绝对路径判，别名 / 相对路径都一样。
const keepScriptsExternal = {
  name: 'islands-keep-scripts-external',
  setup(b) {
    b.onResolve({ filter: /\.js$|^(\.\.?\/)+scripts\// }, async (args) => {
      if (args.pluginData === 'inner') return null;
      const r = await b.resolve(args.path, { resolveDir: args.resolveDir, kind: args.kind, importer: args.importer, pluginData: 'inner' });
      if (r.errors.length || !r.path.startsWith(SCRIPTS) || !r.path.endsWith('.js')) return null;
      return { path: r.path, external: true };
    });
  },
};

async function buildServer({ entry, outfile }) {
  await esbuild().build({
    entryPoints: [entry],
    outfile,
    bundle: true,
    format: 'cjs',
    platform: 'node',
    target: ['node20'],
    jsx: 'automatic',
    tsconfig: path.join(ROOT, 'tsconfig.json'),
    external: ['react', 'react-dom', 'react/*', 'react-dom/*'],
    plugins: [keepScriptsExternal, nextLinkUntilT1b],
    define: { 'process.env.NODE_ENV': '"production"' },
    logLevel: 'silent',
  });
  return outfile;
}

module.exports = { buildRuntime, buildServer, RUNTIME_STUBBED };
