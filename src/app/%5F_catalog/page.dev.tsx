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

import SectionRenderer from '@/components/SectionRenderer';
import { defaultLocale } from '@/lib/config';
import type { BlockConfig } from '@/lib/types/config';
import { blockShapeCatalog } from '../../../scripts/lib/block-catalog.js';
import { demoDataFor } from '../../../scripts/lib/demo-content/index.js';
import { filledOptionalSlots } from '../../../scripts/lib/block-manifest.js';
import CatalogBoard from './CatalogBoard';
import CatalogScroll from './CatalogScroll';
import ShapeSelect from './ShapeSelect';
import {
  CATALOG_LOCALE,
  CATALOG_PATHS,
  CATALOG_SERVICE_SLUG,
  OWN_THEME_OFF,
  catalogThemes,
  readSheetCss,
  registerCatalogFixturePages,
} from './catalogShared';

export const metadata = {
  title: 'Block catalogue',
  // 它永远不进静态导出，所以这一行只在开发服务上起作用 —— 留着是因为代价为零。
  robots: { index: false, follow: false },
};

// 🔴 **每一格的内容来自演示内容包**（#1383）。#1343 那会儿它是 `sampleDataFor()` 现编的占位串
//    （`Headline` / `Label`）加一张 `/images/grid-pattern.svg` 色块 —— 那份东西回答得了「这个块
//    渲染得出来吗」，回答不了「这个形态排得好不好」。今天两边都读
//    `scripts/lib/demo-content/`：一家虚构汽修店的真文案 + FlyonUI 的真图。
//
const CATALOG_ADMIN_ORIGIN = (process.env.AI1ST_CATALOG_ADMIN_ORIGIN || '').trim();
// 🔴 夹具页（`service-related-pages` 那一行要它才画得出来）、主题皮、以及关掉站自己那套主题的
//    那段脚本，都搬去了 `./catalogShared`（#1383：单格页要用同一份，两处各写一份会分叉）。

export default function CatalogPage() {
  const { blocks, manifests } = blockShapeCatalog(CATALOG_PATHS);
  const locale = defaultLocale;
  registerCatalogFixturePages();

  const themes = catalogThemes();
  const initial = themes[0];
  const initialSheetCss = initial ? readSheetCss(initial.sheet) : '';

  let cellCount = 0;
  const rows = blocks.map((type) => {
    const m = manifests.get(type);
    // `blockShapeCatalog()` 已经保证注册表里的每个块都有 manifest（对不上它会抛）。走到这里拿不到
    // 只可能是那个保证自己坏了 —— 当场说出来，不许静默少画一行（少一行正是本票要消灭的那种失败）。
    if (!m) throw new Error(`block catalogue: "${type}" 在注册表里，而 manifests 里没有它`);
    const shapes: string[] = m.shapes.map((s) => s.name);
    const full = demoDataFor(m);
    const minimal = demoDataFor(m, { minimal: true });
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
      {/* 收 admin 页发来的滚动消息。来源没配就整个不挂（见 CATALOG_ADMIN_ORIGIN 上面那段）。 */}
      {CATALOG_ADMIN_ORIGIN ? <CatalogScroll adminOrigin={CATALOG_ADMIN_ORIGIN} /> : null}
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
.catalog-cell { border-top: 1px dashed #b9c2d0;
  /* 滚到一格时让开吸顶的那两条（.catalog-bar 约 2.3rem + .catalog-row__name 约 2.4rem），
     否则 scrollIntoView 把格顶推到视口顶、正好被它们盖住。 */
  scroll-margin-top: 5rem; }
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
