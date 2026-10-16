'use strict';
// #1802 —— 把 `render/`（整页渲染：块 + SiteShell + React 服务端渲染）用 esbuild 打成一份 CommonJS，外加平台那几份文件：
//
//   <outdir>/render.cjs                         `scripts/site.js render` 每次冷启动只 require 它
//   <outdir>/_platform/css/globals.<哈希>.css   `src/app/globals.css`（Next 原来自己打包它，Next 外要单独出成文件）
//   <outdir>/_platform/css/base.<哈希>.css      `public/base.css`
//   <outdir>/_platform/css/shapes.<哈希>.css    `public/shapes.css`
//   <outdir>/_platform/runtime.<哈希>.js        岛 + Bootstrap 的那份脚本（#1798 §buildRuntime）
//   <outdir>/manifest.json                      上面那几份的地址 + 哪些模块留在包外（`externals`）
//
// 🔴 平台文件按**内容哈希**定名（16 位 sha256）：T2d 给 `_platform/` 配的是一年 immutable 缓存，固定名就等于发版改了
//    `shapes.css` 老板一年看不到（决定 13）。内容不变 ⟹ 名字不变（同一份源码打两次逐字相同）。
//
// 🔴 包里包外怎么分（PM 2026-10-16 裁定，#1802 留言「三条技术判断」第 1 条）：
//   · `node_modules` 里的包（react / react-dom / sass / purgecss / postcss / rtlcss / bootstrap …）一律**裸名字**留在包外，
//     由 Node 从运行树解析（`packages: 'external'`）。
//   · `scripts/` 下的 CommonJS，**只有真用 `__dirname` 的那些**留在包外 —— 它们靠自己的位置去读 blocks/、清单、主题表；
//     打进包里 `__dirname` 就成了产物目录（`lib/icons.js` 文件头记过这个坑，#1409）。名单不写死：打包时按 import 图现取
//     （§keepDirnameModulesOutside 对图上每个落在 `scripts/` 的文件读一次源码），写进 manifest 的 `externals`。
//   · 🔴 留在包外的那些，import 路径改写成**相对产物目录**的路径（`../../scripts/lib/icons.js`）。esbuild 对 external 的路径
//     原样保留不改写，而渲染层引 `scripts/` 的相对深度有五种 ⟹ 原样保留就全错（PM 实测 MODULE_NOT_FOUND）。不写构建期的
//     绝对路径：T2c 要把整棵树打成 `template.tar.gz` 到别的机器上解开，绝对路径那一刻就失效；相对路径只要树的布局不变就对。
//   · 其余（`src/` / `blocks/` / `render/` / 没用 `__dirname` 的 `scripts/` 文件）打进包里。
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const islandsBuild = require('./islands-build');

const ROOT = path.resolve(__dirname, '..', '..');
const SCRIPTS = path.join(ROOT, 'scripts') + path.sep;
const DEFAULT_OUTDIR = path.join(ROOT, 'render', 'dist');
const ENTRY = path.join(ROOT, 'render', 'index.tsx');

const hash16 = (bytes) => crypto.createHash('sha256').update(bytes).digest('hex').slice(0, 16);

function keepDirnameModulesOutside(outdir, externals) {
  const usesDirname = new Map();
  return {
    name: 'render-keep-dirname-modules-outside',
    setup(b) {
      b.onResolve({ filter: /.*/ }, async (args) => {
        if (args.pluginData === 'render-inner' || args.kind === 'entry-point') return null;
        if (!args.path.startsWith('.') && !args.path.startsWith('/') && !args.path.startsWith('@/') && !args.path.startsWith('@blocks/')) return null;
        const r = await b.resolve(args.path, { resolveDir: args.resolveDir, kind: args.kind, importer: args.importer, pluginData: 'render-inner' });
        if (r.errors.length || r.external || !r.path.startsWith(SCRIPTS) || !/\.(c?js)$/.test(r.path)) return null;
        if (!usesDirname.has(r.path)) usesDirname.set(r.path, /\b__dirname\b/.test(fs.readFileSync(r.path, 'utf-8')));
        if (!usesDirname.get(r.path)) return null;
        let rel = path.relative(outdir, r.path).split(path.sep).join('/');
        if (!rel.startsWith('.')) rel = `./${rel}`;
        externals.add(path.relative(ROOT, r.path).split(path.sep).join('/'));
        return { path: rel, external: true };
      });
    },
  };
}

function writePlatformFile(outdir, rel, bytes) {
  const file = path.join(outdir, rel);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, bytes);
  return `/${rel}`;
}

/**
 * 打包。返回 manifest（也写进 `<outdir>/manifest.json`）。
 * @param {{ outdir?: string, minifyRuntime?: boolean }} [opts]
 */
async function buildRenderBundle({ outdir = DEFAULT_OUTDIR } = {}) {
  const esbuild = require('esbuild');
  fs.rmSync(outdir, { recursive: true, force: true });
  fs.mkdirSync(outdir, { recursive: true });
  const externals = new Set();
  const bundleFile = path.join(outdir, 'render.cjs');
  await esbuild.build({
    entryPoints: [ENTRY],
    outfile: bundleFile,
    bundle: true,
    format: 'cjs',
    platform: 'node',
    target: ['node20'],
    jsx: 'automatic',
    tsconfig: path.join(ROOT, 'tsconfig.json'),
    packages: 'external',
    plugins: [keepDirnameModulesOutside(outdir, externals)],
    define: { 'process.env.NODE_ENV': '"production"' },
    logLevel: 'silent',
  });

  const platform = {};
  const files = [];
  for (const [key, name, src] of [
    ['globalsCss', 'globals', path.join(ROOT, 'src', 'app', 'globals.css')],
    ['baseCss', 'base', path.join(ROOT, 'public', 'base.css')],
    ['shapesCss', 'shapes', path.join(ROOT, 'public', 'shapes.css')],
  ]) {
    const bytes = fs.readFileSync(src);
    const rel = `_platform/css/${name}.${hash16(bytes)}.css`;
    platform[key] = writePlatformFile(outdir, rel, bytes);
    files.push(rel);
  }
  const rt = await islandsBuild.buildRuntime({ outdir: path.join(outdir, '_platform') });
  platform.runtimeJs = `/_platform/${rt.name}`;
  files.push(`_platform/${rt.name}`);

  const manifest = {
    bundle: 'render.cjs',
    platform,
    files,
    externals: [...externals].sort(),
  };
  fs.writeFileSync(path.join(outdir, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
  return { ...manifest, outdir };
}

module.exports = { buildRenderBundle, DEFAULT_OUTDIR };
