// #1409 —— 编辑器页：`/~editor/<语言>/<页面 slug>`，每一页每一种语言各导出一个静态页（票正文 §做什么 1 的 A）。
//
// ── 为什么选 A（每页一个编辑器页），不选 B（一个编辑器页运行时取页面 JSON）──────────────────────
// · 一一对应：这个静态页里**不写任何取数逻辑**。B 要在运行时去取页面 JSON，取数就是一个请求，
//   而这个页面所在的域名上规矩是「界面可以进来，网络不行」（设计稿 §4）；把页面 JSON 当静态资源
//   摆出来又等于多上传一份内容文件到 R2 —— 两条都比 A 贵。
// · 页面清单从这个站**自己的**配置派生（`pagesByLocale`，即 sync-config 按 `scripts/lib/page-files.js`
//   读出来的那份），加一页就多一个编辑器页，不用改代码。
// · 代价：三语九页的站导出 27 个编辑器页。每个页面自己的 HTML 只有几十 KB，Puck 的 JS 分块是
//   共享的 —— 体积读数在 #1409 的交付留言里。
//
// ── 为什么是普通的 `page.tsx`，不是 `.dev.tsx` ────────────────────────────────────────────────
// `.dev.tsx` 那一类（`/__catalog`）在 production 下被 `next.config.js` 的 `pageExtensions` 排除，
// 这个页面要反过来：**必须**进生产静态导出，因为预览容器发的就是 `out/`（`serve out/`），dashboard
// 框住的正是那一份。所以它就是一个普通页面，两种构建里都在。
// 🔴 它进了 `out/` 就会跟着整份 `out/` 上传 R2 —— 客户的正式域名上不许有它。挡在上传那一步：
//    `worker/main.go` §isEditorOutput 把 `~editor/` 底下的产物全部跳过（有守卫），预览照常可用。
//
// ── 为什么路由叫 `~editor` ─────────────────────────────────────────────────────────────────────
// · 撞不上任何页面：页面 slug 与语言码都以字母或数字开头（manager `blockPageSlugPattern` /
//   `blockLocalePattern`），`~` 开头的段按构造不会是一个页面，根上那个 `[...slug]` 永远轮不到它。
// · 🔴 **不能**照 `/__catalog` 的先例用 `%5F_editor`：实测 Next 16 的静态导出对 URL 编码的文件夹名
//   不生成 `generateStaticParams` 给出的路径 —— 构建 rc=0，`generateStaticParams` 返回了 5 条，
//   `out/` 里却一个编辑器页都没有，只在 `.next` 里渲染出一个字面的 `[...target].html`。
//   `/__catalog` 是 dev 专用路由、从没进过导出，所以那个先例从没碰到过这一格。
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import path from 'path';
import EditorApp from '@/components/editor/EditorApp';
import { leadApi, locales, pagesByLocale, getPage } from '@/lib/config';
import { editorSource, locateInRaw, effectiveWeights } from '../../../../scripts/lib/editor-page.js';
import { editorSchema } from '../../../../scripts/lib/editor-schema.js';
import { pageToPuck } from '../../../../scripts/lib/editor-convert.js';

// 只导出 generateStaticParams 给出的那些；别的路径在静态导出里本来就不存在（serve 回 404）。
export const dynamicParams = false;

// 与 `[...slug]/page.tsx` 同一份保留字：这两个 slug 的页面 JSON 不会被渲染成页面。
const RESERVED_SLUGS = ['blog', '_next'];

export function generateStaticParams() {
  const params: { target: string[] }[] = [];
  for (const locale of locales) {
    for (const p of pagesByLocale[locale] || []) {
      if (RESERVED_SLUGS.some((r) => p.slug === r || p.slug.startsWith(r + '/'))) continue;
      params.push({ target: [locale, ...p.slug.split('/')] });
    }
  }
  return params;
}

export const metadata: Metadata = {
  title: 'Editor',
  robots: { index: false, follow: false },
};

// 框住我们的 dashboard 的 origin。与根布局里主题预览那条（#925 `previewTrustedOrigin`）同一个来源
// 同一个算法：`leadApi` 就是 dashboard 自己的地址（`cfg.AppBaseURL`）。空 = 本地模板 dev，不能保存。
function trustedOrigin(): string {
  try {
    return leadApi ? new URL(leadApi).origin : '';
  } catch {
    return '';
  }
}

export default async function EditorPage({ params }: { params: Promise<{ target: string[] }> }) {
  const { target } = await params;
  const [locale, ...rest] = target;
  const slug = rest.join('/');
  if (!locales.includes(locale) || !slug) notFound();
  const page = getPage(slug, locale);
  if (!page) notFound();

  const src = editorSource(path.join(process.cwd()), locale, slug);
  if ('error' in src) {
    // 构建时读不到这一页的文件 = 配置和磁盘对不上。让构建红，别导出一个存不了盘的编辑器。
    throw new Error(`#1409 editor: ${locale}/${slug} → ${src.error}`);
  }

  // #1404 —— 组件清单 / 字段 / 形态下拉从**这个站自己的**区块库算（构建就在站自己的仓里跑，
  // `blocks/` 就是它建站那天的版本）。整页每一块都上画布，顺序 = 构建里的顺序。
  // 🔴 路径从 `process.cwd()` 起算、显式传进去：那几个脚本默认按自己的 `__dirname` 找 `blocks/` 与
  //    注册表，而被打进 Next 服务端包之后 `__dirname` 是产物目录（实测报 `ENOENT …/.next/server/app/src/
  //    lib/sections/registry.generated.ts`）—— 跟 `/__catalog` 的 `CATALOG_PATHS` 同一个坑。
  const root = process.cwd();
  const schema = editorSchema({
    rootDir: root,
    registryPath: path.join(root, 'src', 'lib', 'sections', 'registry.generated.ts'),
    blocksDir: path.join(root, 'blocks'),
  });
  const located = page.blocks.map((b) => locateInRaw(src.raw, src.siteBlocks, slug, b));
  const initialData = pageToPuck({
    raw: src.raw,
    blocks: page.blocks,
    located,
    schema,
    weights: effectiveWeights(src.raw, src.siteBlocks, page.blocks, located),
  });

  return (
    <EditorApp
      locale={locale}
      page={slug}
      raw={src.raw}
      baseHash={src.baseHash}
      schema={schema}
      initialData={initialData}
      trustedOrigin={trustedOrigin()}
    />
  );
}
