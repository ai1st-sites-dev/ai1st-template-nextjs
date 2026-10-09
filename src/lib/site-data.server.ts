// #1665 —— 站点内容的服务端加载器：每次调用读 site/，按文件改动时间缓存。
//
// 🔴 只许服务端用。下面那行 `server-only` 让它一旦被浏览器端代码引到（`'use client'` 文件，或被它们 import 的模块），
//    构建当场报错 —— 它读文件，编进浏览器包就是坏的。这个名字由 Next 自己解析到它内置的那份（不是 package.json 里的依赖）。
//
// 拼对象的是 `scripts/lib/site-data.js`（跟 `sync-config.js` 拼 config-data.ts 是同一套 lib 调用，理由写在那个文件头）。
// 这里只管三件事：
//   · 用 Node 自己的 require 载入它 —— 那边是 CommonJS，按 `__dirname` 找 blocks/ 和 page-layouts/，不能被打包器改写。
//     🔴 经 `process.getBuiltinModule` 拿 `createRequire`，不写 `import { createRequire } from 'module'`：webpack 会去解析
//        `createRequire(...)` 的参数（实测打 `module.createRequire failed parsing argument`），这条路它不碰。Node ≥ 22.3（容器是 node:22）。
//   · 缓存：site/ 下每个文件的「路径 + 改动时间 + 大小」拼成钥匙，钥匙不变就还给同一个对象（`config.ts` 按对象缓存反查表）。
//     改一个文件 → 下一次请求钥匙变了 → 重读。预览模式下页面在被访问时才渲染，所以「改了刷新就是新的」靠的就是这里。
//   · 两种模式各取一档 <lastmod>：发布 = git 提交时间（同 sync-config），预览 = 文件改动时间。
// `SYNC_SITE_DIR`：#1599 的分段预览构建读快照目录，跟 sync-config 同一个约定。
import 'server-only';
import fs from 'fs';
import path from 'path';
import type { SiteData } from './types/config';
import { isPreviewRender, renderOnRequest } from './render-mode';

type Assemble = (opts: { rootDir: string; siteDir: string; lastModified: 'git' | 'mtime' }) => SiteData;

function siteDirOf(rootDir: string): string {
  return process.env.SYNC_SITE_DIR ? path.resolve(process.env.SYNC_SITE_DIR) : path.join(rootDir, 'site');
}

function fingerprint(dir: string, rel = '', out: string[] = []): string[] {
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(path.join(dir, rel), { withFileTypes: true });
  } catch {
    return out;
  }
  for (const e of entries) {
    const r = rel ? `${rel}/${e.name}` : e.name;
    if (e.isDirectory()) fingerprint(dir, r, out);
    else {
      try {
        const st = fs.statSync(path.join(dir, r));
        out.push(`${r}\0${st.mtimeMs}\0${st.size}`);
      } catch { /* 读的那一刻被删了 —— 不算进钥匙，下一次再看 */ }
    }
  }
  return out;
}

let cached: { key: string; data: SiteData } | null = null;

export function loadSiteData(): SiteData {
  const rootDir = process.cwd();
  const siteDir = siteDirOf(rootDir);
  const key = `${siteDir}\n${fingerprint(siteDir).sort().join('\n')}`;
  if (cached && cached.key === key) return cached.data;
  const { createRequire } = process.getBuiltinModule('module') as typeof import('module');
  const nodeRequire = createRequire(path.join(rootDir, 'package.json'));
  const { assembleSiteData } = nodeRequire('./scripts/lib/site-data.js') as { assembleSiteData: Assemble };
  const data = assembleSiteData({ rootDir, siteDir, lastModified: isPreviewRender ? 'mtime' : 'git' });
  cached = { key, data };
  return data;
}

/**
 * 页面 / layout / 路由取站点内容走这一个：先在预览模式下把这次渲染标成「按请求」（`renderOnRequest`），再读。
 * 两步绑在一起，是为了不会有哪一处读了内容却忘了标 —— 忘了的那一页在预览构建时会被预先渲染（`site/` 可能是空的），
 * 之后改内容它也不变。发布模式下第一步什么都不做。
 */
export async function requestSiteData(): Promise<SiteData> {
  await renderOnRequest();
  return loadSiteData();
}
