// #1801 —— 编辑器（EditorApp）的初始 props，原来写在 `src/app/~editor/[...target]/page.tsx` 里、在 Next 服务端算。
// 搬家之后有两个调用方，同一份实现：
//   · `~editor` 路由（容器那条路，T5 才拆）—— 照旧在 Next 服务端调
//   · `scripts/site.js editor-data`（manager 的 `GET /api/sites/:id/editor` spawn 它）—— esbuild 现打包这一份文件来调
// 它读文件（块库 manifest / shape.md、页面 JSON 的字节、bootstrap-icons 的 svg），所以只在服务端 / Node 里跑；
// 浏览器包（dashboard 的编辑器）不引它，props 由 manager 递过去。
// 不返回 `trustedOrigin`：那是「框住编辑器的那个页面的 origin」，容器那条路自己拼，dashboard 那条路用不到。
import path from 'path';
import { getPage, getForms, getBrandName, getNavigation, getSeo } from '@/lib/config';
import { editorSource, locateInRaw, effectiveWeights } from '../../scripts/lib/editor-page.js';
import { editorSchema } from '../../scripts/lib/editor-schema.js';
import { blocksDir, registryPath } from '../../scripts/lib/block-paths.js';
import { pageToPuck, pageSeoToPuck, rootToPuck } from '../../scripts/lib/editor-convert.js';
import { editorLocations } from '../../scripts/lib/editor-locations.js';
import { editorPages } from '../../scripts/lib/editor-pages.js';
import { topbarLinksOf } from '../../scripts/lib/topbar-links.js';
import { iconTableFor, usesIconTable } from '../../scripts/lib/icons.js';
import { seedProps } from '../../scripts/lib/block-placeholders.js';
import { isButtonRef, itemSourceContext, resolveItemSources, socialPairs } from '@/lib/sections/item-sources';
import type { IconTable } from '@/components/InlineIcon';
import type { SiteData } from '@/lib/types/config';

/** #1759 —— 构建这一份里的顶栏按钮（#1787：`header.buttons`，0–3 颗）+ 菜单（#1781：`header.links` 原样，老板自己的一份列表）；#1780 加顶栏上面那一行的链接列表。 */
// #1779 —— href 可以是电话 / 邮箱引用（`{source: "phone"}`）：原样带进编辑器（按钮弹窗认它），别的形状当空。
function headerContent(nav: { header?: { buttons?: unknown; topbarLinks?: unknown; links?: unknown } }) {
  const btn = (b?: { label?: string; href?: unknown }) => ({
    label: typeof b?.label === 'string' ? b.label : '',
    href: typeof b?.href === 'string' ? b.href : isButtonRef(b?.href) ? { ...b.href } : '',
  });
  const list = Array.isArray(nav.header?.buttons) ? (nav.header.buttons as unknown[]) : [];
  const headerButtons = list.filter((b): b is { label?: string; href?: unknown } => !!b && typeof b === 'object' && !Array.isArray(b)).map(btn);
  // #1783 —— 下拉（`children`）原样带进编辑器（名字是字符串的子项；`description` 是字符串才带）。漏了它，打开编辑器存一次顶栏就把下拉抹掉。
  type Kid = { label: string; href: unknown; description?: unknown };
  const named = <T,>(l: unknown): l is T => !!l && typeof l === 'object' && typeof (l as { label?: unknown }).label === 'string';
  const links = Array.isArray(nav.header?.links)
    ? (nav.header!.links as unknown[]).filter((l): l is Kid & { children?: unknown } => named(l)).map((l) => {
      const kids = Array.isArray(l.children) ? (l.children as unknown[]).filter((c): c is Kid => named(c))
        .map((c) => ({ label: c.label, href: c.href, ...(typeof c.description === 'string' ? { description: c.description } : {}) })) : [];
      return kids.length ? { label: l.label, href: l.href, children: kids } : { label: l.label, href: l.href };
    })
    : null;
  return { headerButtons, headerTopbar: topbarLinksOf(nav.header?.topbarLinks), ...(links ? { headerLinks: links } : {}) };
}

export type EditorPropsResult =
  | { ok: false; reason: 'no-locale' | 'no-page' }
  | { ok: true; props: Record<string, unknown> };

/**
 * `root` = 模板根（读 blocks/、page-layouts/、registry、node_modules/bootstrap-icons）；`siteDir` = 这个站的 `site/` 目录。
 * 页面找不到 ⟹ `{ok: false}`（调用方决定是 404 还是一句话）；页面文件读不出来 ⟹ throw（配置和磁盘对不上）。
 */
export function editorProps({ site, root, siteDir, locale, slug }: { site: SiteData; root: string; siteDir: string; locale: string; slug: string }): EditorPropsResult {
  const { locales, pagesByLocale, pageLayout, regions } = site;
  if (!locales.includes(locale)) return { ok: false, reason: 'no-locale' };
  const page = slug ? getPage(site, slug, locale) : undefined;
  if (!page) return { ok: false, reason: 'no-page' };

  const src = editorSource(root, locale, slug, siteDir);
  if ('error' in src) {
    // 读不到这一页的文件 = 配置和磁盘对不上。让调用方红，别交出一个存不了盘的编辑器。
    throw new Error(`#1409 editor: ${locale}/${slug} → ${src.error}`);
  }

  // #1404 —— 组件清单 / 字段 / 形态下拉从区块库算。整页每一块都上画布，顺序 = 构建里的顺序。
  // 🔴 路径从调用方给的 `root` 起算、显式传进去：那几个脚本默认按自己的 `__dirname` 找 `blocks/` 与
  //    注册表，而被打进 Next 服务端包之后 `__dirname` 是产物目录（实测报 `ENOENT …/.next/server/app/src/
  //    lib/sections/registry.generated.ts`）—— 跟 `/__catalog` 的 `CATALOG_PATHS` 同一个坑。
  const schema = editorSchema({
    rootDir: root,
    siteDir,
    // #1838 —— 经 §block-paths（测试改道到带假块的临时目录 / 注册表时跟着走；没改道就是 root 下那两份）。
    registryPath: registryPath(root),
    blocksDir: blocksDir(root),
    layoutsDir: path.join(root, 'page-layouts'),
  });
  const located = page.blocks.map((b) => locateInRaw(src.raw, src.siteBlocks, slug, b));
  // #1405 —— 外壳三样的初值取的是**站上正在画的那一份**（`pageLayout` / `regions` / 这种语言的 `navigation`），
  // 不是另读一遍站级文件：形态要经过主题选择单 + `regionLayout` 覆盖那一层解析，那一层在组装站点数据时已经算过了。
  // 🔴 这份初值就是存盘时逐字段比的那个「打开时的值」，它必须跟底稿一起、在打开时定下来。
  const initialData = {
    ...pageToPuck({
      raw: src.raw,
      blocks: page.blocks,
      located,
      schema,
      weights: effectiveWeights(src.raw, src.siteBlocks, page.blocks, located),
      siteBlocks: src.siteBlocks,
    }),
    root: {
      props: {
        ...rootToPuck({
          layout: pageLayout.id,
          headerShape: regions.header.shape,
          footerShape: regions.footer.shape,
          // #1738 —— 顶栏 / 页脚的底色 + 旋钮（`regions.<区>.options`，没存过 = {}）。
          headerOptions: regions.header.options || {},
          footerOptions: regions.footer.options || {},
          // #1681 —— Business info 四样：名字取这种语言那一格，同站上顶栏的读法。
          brandName: getBrandName(site, locale),
          email: site.brand.email ?? '',
          // #1980 —— Locations 区：读法同站里 `editor-root.js` §readBrandValues（`editor-locations.js` §editorLocations；派生过的这一份
          //    老站营业时间已经搬进第一家，所以不再传 seo.json）。
          locations: editorLocations(site.brand, null),
          // #1759 —— 顶栏 Content 页：logo、按钮（#1787）、菜单（#1781）—— 按钮和菜单都在这种语言的 navigation.json。
          logoUrl: site.brand.logoUrl ?? '',
          // #1785 —— Social links：读法同站里 `editor-root.js` §readBrandValues（两种老形状都读成数组、平台名小写）。
          socialLinks: socialPairs(site.brand.socialLinks).map(([platform, url]) => ({ platform: platform.toLowerCase(), url })),
          ...headerContent(getNavigation(site, locale)),
          // #1945 —— 首页的搜索结果三样（这种语言的 seo.json；子页不放，它们的三样在下面按那一页的 JSON 放）。
          ...(slug === 'home' ? {
            siteTitle: getSeo(site, locale).siteTitle ?? '',
            siteDescription: getSeo(site, locale).siteDescription ?? '',
            seoMode: getSeo(site, locale).seoMode === 'custom' ? 'custom' : '',
          } : {}),
        }),
        // #1945 —— 子页的搜索结果三样：那一页 JSON 顶层的 title / description / seoMode（存盘时 puckToPage 写回同一份文件）。
        ...(slug === 'home' ? {} : pageSeoToPuck(src.raw)),
      },
    },
  };

  // #1714 —— 画布上的页面块要的图标表：`iconTableFor` 读文件，只能在服务端算。🔴 按块类型给（`{ [type]: 表 }`），不按下标：
  // 画布上的块会拖、会增删。每一类 = 组件写死的那几个名字（`BLOCK_ICONS`）∪ 这一页该类块数据里的 `icon`（先展开引用列表）。
  // 这一页没有的类型也给一张（只有写死的那几个），从 Blocks 抽屉拖进来的新块照样画箭头 / 勾。
  const pageSlug = slug === 'home' ? undefined : slug;
  const resolved = resolveItemSources(page.blocks, itemSourceContext(site, locale, pageSlug));
  const iconTables: Record<string, IconTable> = {};
  for (const c of schema.components) {
    if (!usesIconTable(c.type)) continue;
    // #1767 —— 再加上「拖下这种块时播的那一份」（§seedProps 写的示例图标），不并进来的话新块的图标位照样是空的。
    const seeded = seedProps(c, locale);
    iconTables[c.type] = iconTableFor(c.type, [...resolved.filter((b) => b.type === c.type).map((b) => b.data), seeded]) as IconTable;
  }

  return {
    ok: true,
    props: {
      site,
      iconTables,
      locale,
      page: slug,
      raw: src.raw,
      baseHash: src.baseHash,
      schema,
      initialData,
      siteBlocks: src.siteBlocks,
      refs: src.refs,
      slugs: src.slugs,
      pages: editorPages(locales, pagesByLocale),
      // #1634 —— 「Edit this form」面板要三句文字的现值（没写的键 = 用默认，面板里那格就是空的）。
      // #1769 —— 自定义字段（`fields` 里的 `{ id, type }`）和 `required` 一起递：面板的 Add custom / Required 要它们。
      forms: getForms(site, locale).map((f) => ({
        id: f.id, name: f.name, fields: f.fields, primary: f.primary, ...(f.required ? { required: f.required } : {}),
        ...(f.buttonText ? { buttonText: f.buttonText } : {}), ...(f.successMessage ? { successMessage: f.successMessage } : {}),
        ...(f.labels ? { labels: f.labels } : {}),
      })),
    },
  };
}
