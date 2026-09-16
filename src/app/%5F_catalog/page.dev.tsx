// ══════════════════════════════════════════════════════════════════════════════════════════════════
// /__catalog —— 区块活图册（#1343，设计文档 D10）
// ══════════════════════════════════════════════════════════════════════════════════════════════════
//
// 一行一个块，一格一种形态，每格是**真组件、真 CSS**。页顶换主题当场换成那套主题完整的样子
// （画法 + 配色 + 字体 + 风格设定），页面不重载；每格的下拉改 `data-shape` 当场重排。
//
// 🔴 **清单不许手写。** 行和格都从 `blockShapeCatalog()` 来 —— 注册表说有哪些块、manifest 说每个块
//    有哪些形态，两边对不上就抛。同一个函数的另外两个调用方是 `scripts/block-migration/gen-allblocks.js`
//    和 `scripts/theme-css-invariants.mjs`（理由整段在 `scripts/lib/block-catalog.js` 的文件头上）。
//    注册表多一个键而图册少一行，这件事因此**做不到**。
//
// 🔴 **为什么这个文件叫 `page.dev.tsx`，以及为什么目录叫 `%5F_catalog`。** 两个都是 Next 的规矩，
//    不是花样：
//    ① `page.dev.tsx` —— 静态导出时这条路由必须**不产出**。`next.config.js` 的 `pageExtensions`
//       在 production 下不认 `.dev.tsx`，于是这个文件根本不是「页面」，路由压根不存在。
//       🔴 票里提过的另一条（`generateStaticParams` 回 `[]`）**实测走不通**：Next 16 的判据是
//       `hasGenerateStaticParams = prerenderedRoutes && prerenderedRoutes.length > 0`
//       （`node_modules/next/dist/build/index.js`），空数组被判成「没写 generateStaticParams」，
//       export 构建当场死在 `Page "/__catalog/[[...rest]]" is missing "generateStaticParams()"`。
//    ② `%5F_catalog` —— 以 `_` 开头的目录是 Next 的**私有目录**，不进路由（实测：`/__catalog`
//       和一个对照用的 `/_zzpriv` 都拿不到这个页面，而同批的 `/zzprobe` 200）。`%5F` 是 Next 为
//       「我就是要 URL 里那个下划线」留的转义，解码之后这条路由的地址正是 `/__catalog`。
//    判据不是这段话，是 `NODE_ENV=production npm run build` 之后 `out/` 里 `__catalog` 命中 0。
//
// 🔴 **「预览」在本仓有歧义，这里专指 `next dev`。** 客户站的 worker 预览不是 `next dev` ——
//    #275a 起它是 `next build`（`output:'export'`）产的 `out/` 用 `serve` 端出去的
//    （`worker/entrypoint.sh:137-139` 原话）。所以客户站的预览上不会有 `/__catalog`，没有暴露面。
//
// 🔴 **图册不替代 QA 的真站验证。** 这里的数据是从 manifest 的槽位现造的示例；真站的数据形状不同
//    （老 `sections` 形状、槽位缺失、站自己的 services.json），那些只有在真站上才看得见。

import path from 'path';
import fs from 'fs';
import SectionRenderer from '@/components/SectionRenderer';
import { defaultLocale, pagesByLocale } from '@/lib/config';
import type { BlockConfig, DynamicPageConfig } from '@/lib/types/config';
import { blockShapeCatalog, sampleDataFor } from '../../../scripts/lib/block-catalog.js';
import { filledOptionalSlots } from '../../../scripts/lib/block-manifest.js';
import { buildThemeCss } from '../../../scripts/theme-css.js';
import themePool from '../../../scripts/theme-pool.json';
import CatalogBoard, { type CatalogTheme } from './CatalogBoard';
import ShapeSelect from './ShapeSelect';

export const metadata = {
  title: 'Block catalogue',
  // 它永远不进静态导出，所以这一行只在开发服务上起作用 —— 留着是因为代价为零。
  robots: { index: false, follow: false },
};

interface PoolTheme {
  label?: string;
  colors: { primary: Record<string, string>; accent: Record<string, string> };
  fonts: { heading: string[]; body: string[]; googleFontsUrl?: string };
  settings?: Record<string, unknown>;
  sheet?: string;
}

// 🔴 **路径要从 `process.cwd()` 起算，不能靠那几个脚本自己的 `__dirname`。** 它们是普通 node 脚本，
//    默认按 `__dirname` 找 `blocks/` 和 `registry.ts`；而被 webpack 打进 Next 的服务端包之后
//    `__dirname` 是**产物目录**（实测那一版报的是
//    `ENOENT … .next/dev/server/app/src/lib/sections/registry.ts`）。所以这里把路径显式传进去。
//    `next dev` 的 cwd 就是 `templates/nextjs`（`npm run dev` 与容器里的启动命令都在这个目录下跑）。
const NEXT_DIR = process.cwd();
const sheetPath = (sheet: string) => path.join(NEXT_DIR, 'public', 'themes', `${sheet}.css`);
const CATALOG_PATHS = {
  registryPath: path.join(NEXT_DIR, 'src', 'lib', 'sections', 'registry.ts'),
  blocksDir: path.join(NEXT_DIR, 'blocks'),
};

/**
 * 🔴 **图册自带 `service-related-pages` 要的那几页。**
 *
 * 这是 32 个块里唯一一个**会整块不渲染**的：它拿 `serviceSlug` 去筛**这个站**的页面表
 * （`pagesByLocale[locale]`），一个子页都筛不到就 `return null`（`ServiceRelatedPagesSection.tsx:52`）。
 * 而 `create-site.js` 建出来的站默认一个带 `/` 的 slug 都没有（home / about / services / quote /
 * contact）—— r1 让图册去站里找这样一个前缀、找不到就在行首印一句话，于是在**默认站**上那两格是空的，
 * 双向差集读到 2。AC1 要的是无条件的 0，所以图册不再问这个站有什么页面，自己带着夹具。
 *
 * 配方是这个块自己写着的（`ServiceRelatedPagesSection.tsx:21-25` 原话：不给 `<serviceSlug>/` 下放
 * 两页的夹具，是在用一个空串量这个块；#1027 的夹具为此带了 `services/alpha` 和 `services/beta`）。
 * 这里放**三**页，因为 `three-up` 那一格要三项才看得出它是三列。
 *
 * 🔴 **为什么挂在一个属于图册自己的 locale 键下，而不是塞进站那个 locale**：塞进去就是改展示站 ——
 *    页脚、导航、sitemap 全都从 `pagesByLocale[<站的 locale>]` 取，这几页会当场出现在站上。挂在一个
 *    没有任何路由会问的键上，站那边按构造看不见：app 里对这张表的每一次读取都是按键取
 *    （`pagesByLocale[locale]`），而唯二两处遍历 —— `config.ts` 的 `slugToLocales` 和 `sitemap.ts` ——
 *    遍历的是 `locales` **数组**，图册没往那儿加东西。判据不是这段话，是反向对照：开过图册之后
 *    `/sitemap.xml` 和站的页面里 `sample-service` 0 命中。
 *
 * 🔴 这一格的 `locale` 因此跟别的格不一样，而**渲染那条路一个分支都没多**：每一格仍然是
 *    `<SectionRenderer blocks={[block]} locale={…} />` 走注册表里那个真组件。
 *
 * 📌 这个键写成 `__catalog-fixture` 而不是一个语言码：站的 `locales` 里装的是语言码（`en` / `zh`），
 *    撞不上它。真撞上了的后果也只在 `next dev` 这个进程里 —— 那个 locale 的页面表会被这份夹具盖掉，
 *    而生产构建里这个文件根本不是一个页面（`pageExtensions` 不认 `.dev.tsx`）。
 */
const CATALOG_LOCALE = '__catalog-fixture';
const CATALOG_SERVICE_SLUG = 'sample-service';
const CATALOG_FIXTURE_PAGES: DynamicPageConfig[] = ['First', 'Second', 'Third'].map((ord, i) => ({
  slug: `${CATALOG_SERVICE_SLUG}/keyword-page-${i + 1}`,
  title: `${ord} Keyword Page`,
  description: 'A keyword page under this service — the catalogue supplies these so the block has something to point at.',
  blocks: [],
}));

/** 幂等：`next dev` 里这个模块只求值一次，但重复调用也只是原样写回同一份。 */
function registerCatalogFixturePages(): void {
  pagesByLocale[CATALOG_LOCALE] = CATALOG_FIXTURE_PAGES;
}

export default function CatalogPage() {
  const { blocks, manifests } = blockShapeCatalog(CATALOG_PATHS);
  const locale = defaultLocale;
  registerCatalogFixturePages();

  const pool = themePool as unknown as Record<string, PoolTheme>;
  const themes: CatalogTheme[] = Object.keys(pool).map((id) => {
    const t = pool[id];
    return {
      id,
      label: t.label || id,
      sheet: t.sheet || id,
      // 🔴 皮走那一份翻译器，一个公式都不在这里重写。`blockLayoutCss` 有意不传：那个参数在
      //    `sync-config.js` 的调用里装的是**站自己的**画法表，而图册的画法是按主题换的那一张，
      //    由 CatalogBoard 单独 fetch 进第二张 <style>（顺序跟这份翻译器自己拼的一样：皮在前）。
      skinCss: buildThemeCss({ colors: t.colors, fonts: t.fonts, settings: t.settings }),
    };
  });
  const initial = themes[0];
  let initialSheetCss = '';
  if (initial) {
    const p = sheetPath(initial.sheet);
    initialSheetCss = fs.existsSync(p) ? fs.readFileSync(p, 'utf-8')
      : `/* ${path.relative(NEXT_DIR, p)} 不在 —— 这套主题没有画法表 */`;
  }

  let cellCount = 0;
  const rows = blocks.map((type) => {
    const m = manifests.get(type);
    // `blockShapeCatalog()` 已经保证注册表里的每个块都有 manifest（对不上它会抛）。走到这里拿不到
    // 只可能是那个保证自己坏了 —— 当场说出来，不许静默少画一行（少一行正是本票要消灭的那种失败）。
    if (!m) throw new Error(`block catalogue: "${type}" 在注册表里，而 manifests 里没有它`);
    const shapes: string[] = m.shapes.map((s) => s.name);
    const full = sampleDataFor(m);
    const minimal = sampleDataFor(m, { minimal: true });
    // 这个块的示例数据不能用 manifest 里那个 `"<service-id>"` 占位串：它要筛得到东西才画得出来。
    const isRelatedPages = type === 'service-related-pages';
    if (isRelatedPages) {
      full.serviceSlug = CATALOG_SERVICE_SLUG;
      minimal.serviceSlug = CATALOG_SERVICE_SLUG;
    }
    const cellLocale = isRelatedPages ? CATALOG_LOCALE : locale;
    const arms: Array<{ key: 'full' | 'minimal'; title: string; data: Record<string, unknown> }> = [
      { key: 'full', title: '全填版', data: full },
      { key: 'minimal', title: '最少版', data: minimal },
    ];
    return (
      <section className="catalog-row" data-catalog-row={type} key={type}>
        <h2 className="catalog-row__name">
          {type} <span className="catalog-row__count">{shapes.length} 种形态</span>
          {isRelatedPages ? (
            <span className="catalog-row__warn">
              这一行的页面表是图册自带的夹具（`{CATALOG_SERVICE_SLUG}/` 下三页，卡片链接是夹具地址、点不开）
              —— 这个块只画站里 `&lt;serviceSlug&gt;/` 下面真有的子页
            </span>
          ) : null}
        </h2>
        <div className="catalog-row__cells">
          {shapes.map((shape) => {
            cellCount += 1;
            return (
              <div
                className="catalog-cell"
                data-catalog-cell=""
                data-catalog-block={type}
                data-catalog-shape={shape}
                key={shape}
              >
                <div className="catalog-cell__head">
                  <code className="catalog-cell__id">{type} / {shape}</code>
                  <ShapeSelect block={type} shapes={shapes} initialShape={shape} />
                </div>
                <div className="catalog-cell__arms">
                  {arms.map((arm) => {
                    const block: BlockConfig = {
                      type,
                      shape,
                      data: arm.data,
                      has: filledOptionalSlots(m, arm.data),
                    };
                    return (
                      <div className="catalog-arm" data-catalog-arm={arm.key} key={arm.key}>
                        <div className="catalog-arm__label">{arm.title}</div>
                        <div className="catalog-arm__stage">
                          <SectionRenderer blocks={[block]} locale={cellLocale} />
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      </section>
    );
  });

  const summary = `${blocks.length} 个块 · ${cellCount} 格（块 × 形态）· ${themes.length} 套主题`;

  return (
    <>
      {/* 🔴 把展示站**自己那套主题**关掉。不关的话页面上会是一份混合体：我们注进去的皮赢了
          （同名变量、我们排在后面），而**画法**只是叠在 `/theme.css` 上面 —— 选中的那套主题没写的
          每一条规则，都从展示站那套里漏上来。实测（图册穿 ember-12、展示站是 azure-29）：
          `.hero__body` 的背景来自 `/theme.css`，而 ember-12 自己的表里根本没有这条规则 ⟹ 看到的
          是「ember 的颜色 + azure 的画法」，正是本票要消灭的那种半个换装。
          同族做法在 `layout.tsx` 的试穿通道里已经有了（`paintSheet` 停用 /theme.css，#1123）。
          🔴 **`/custom.css` 留着**：那是这个站自己的微调层，按 #1006 的设计「换主题时它一个字节都
          不动」—— 关掉它等于把图册变成一个没人会有的状态。代价写在明处：块级的留白/圆角基准
          （`--radius-block` / `--section-block-*`，globals.css 给默认值、custom.css 按**这个站**的
          主题设定覆盖）因此不随页顶切主题而变。
          🔴 它是一段**解析期就跑**的内联脚本，不是 effect：晚一帧关掉就会先闪一眼别人的画法。 */}
      <script dangerouslySetInnerHTML={{ __html: OWN_THEME_OFF }} />
      {/* 图册自己的外壳样式。它跟主题层没有共用的选择器，所以两边不会互相压。 */}
      <style dangerouslySetInnerHTML={{ __html: CHROME_CSS }} />
      <CatalogBoard
        themes={themes}
        initialThemeId={initial ? initial.id : ''}
        initialSheetCss={initialSheetCss}
        summary={summary}
      >
        <main className="catalog" data-catalog="">{rows}</main>
      </CatalogBoard>
    </>
  );
}

const OWN_THEME_OFF = "(function(){var l=document.querySelectorAll('link[rel=\"stylesheet\"]');"
  + "for(var i=0;i<l.length;i++){if((l[i].getAttribute('href')||'')==='/theme.css'){l[i].disabled=true;}}})();";

const CHROME_CSS = `
.catalog { display: block; padding: 0 0 6rem; }
.catalog-bar { position: sticky; top: 0; z-index: 9999; display: flex; gap: 1rem;
  align-items: center; flex-wrap: wrap; padding: .6rem 1rem;
  background: #10131a; color: #e8ecf4; font: 13px/1.4 ui-monospace, monospace; }
.catalog-bar__title { font-size: 14px; }
.catalog-bar__field { display: inline-flex; gap: .4rem; align-items: center; }
.catalog-bar select { font: inherit; padding: .2rem .3rem; max-width: 34rem;
  color: #10131a; background: #fff; border: 1px solid #55607a; border-radius: 3px; }
.catalog-bar select:disabled { opacity: .55; }
.catalog-bar__summary { opacity: .75; }
.catalog-bar__note { color: #ffb4a2; }
.catalog-row { border-top: 2px solid #10131a; }
.catalog-row__name { margin: 0; padding: .7rem 1rem; background: #1d2330; color: #e8ecf4;
  font: 600 14px/1.4 ui-monospace, monospace; display: flex; gap: .8rem; align-items: baseline;
  flex-wrap: wrap; position: sticky; top: 2.3rem; z-index: 9998; }
.catalog-row__count { opacity: .6; font-weight: 400; }
.catalog-row__warn { color: #ffb4a2; font-weight: 400; }
.catalog-row__cells { display: block; }
.catalog-cell { border-top: 1px dashed #b9c2d0; }
.catalog-cell__head { display: flex; gap: 1rem; align-items: center; flex-wrap: wrap;
  padding: .45rem 1rem; background: #eef1f6; color: #1d2330;
  font: 12px/1.4 ui-monospace, monospace; }
.catalog-cell__shape { display: inline-flex; gap: .35rem; align-items: center; }
.catalog-cell__arms { display: grid; grid-template-columns: 1fr 1fr; }
.catalog-arm { min-width: 0; border-left: 1px solid #dfe4ec; }
.catalog-arm:first-child { border-left: 0; }
.catalog-arm__label { padding: .25rem 1rem; background: #f7f9fc; color: #55607a;
  font: 11px/1.4 ui-monospace, monospace; }
.catalog-arm__stage { overflow-x: auto; }
`;
