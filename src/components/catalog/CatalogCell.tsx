// #1828 —— 块图册的一格（`src/lib/catalog/cell.ts` 算好的那份 → 页面）。dashboard 的 `/admin/catalog/<块>/<形态>`（浏览器）和
// `site.js render-catalog`（Node，esbuild 打的包）画的都是这个组件。样式表、高度上报、`<html>` 那一层归调用方。
//
// 🔴 外层容器**没有任何文字**，它只带读数（`data-catalog-*`）：e2e 在这一格上量「文字里有没有占位串」「`data-has-*` 有几个」，
//    容器自己往里加字就是往尺子上加噪音（同 page.dev.tsx）。
// 🔴 外壳区（header / footer）不走 SectionRenderer —— 它们按构造不在 `registry.generated.ts` 里，交给它是 `console.warn` + 空页面；
//    它们走 CellOptions（那里自己画 header / footer 的 Section）。
import CellOptions from '@template/components/catalog/CellOptions';
import KnobBar from '@template/components/catalog/KnobBar';
import SectionRenderer from '@template/components/SectionRenderer';
import type { IconTable } from '@template/components/InlineIcon';
import type { CatalogCellModel } from '@template/lib/catalog/cell';
import { usesIconTable } from '../../../scripts/lib/icon-names.js';

interface Props {
  model: CatalogCellModel;
  /** 落到哪一套主题（`resolveTheme` 之后的 id，写在根元素上 —— 打错的 `?theme=` 落回了哪套，页面自己说得出来）。 */
  themeId: string;
  /** 一个块 + 它的数据 → 图标表（Node：`icons.js` §iconTableFor；dashboard：从预读好的表里挑）。 */
  iconTable: (block: string, data: unknown) => IconTable;
}

export default function CatalogCell({ model: m, themeId, iconTable }: Props) {
  return (
    <main
      data-catalog-single=""
      data-catalog-block={m.block}
      data-catalog-shape={m.shape}
      data-catalog-theme={themeId}
      data-catalog-fill={m.fill}
    >
      {m.isRegion && m.hasOptionBar ? (
        <CellOptions
          block={m.block}
          shape={m.shape}
          data={m.shownData}
          has={m.has}
          optionKeys={m.meta.optionKeys}
          widgets={m.meta.widgets}
          colors={m.meta.colors}
          knobs={m.meta.knobs}
          presets={m.meta.presets}
          coupling={m.meta.coupling}
          groups={m.meta.groups}
          iconTable={iconTable(m.block, m.shownData)}
          initial={m.initial}
          showBar={!m.embed}
        />
      ) : null}
      {m.knobBar && !m.embed ? <KnobBar {...m.knobBar} /> : null}
      {m.isRegion ? null : (
        <SectionRenderer
          site={m.site}
          blocks={m.shown}
          locale={m.locale}
          iconTables={m.shown.map((b) => (usesIconTable(b.type) ? iconTable(b.type, b.data) : undefined))}
          siteFacts={m.siteFacts}
          pageSlug={m.pageSlug}
        />
      )}
    </main>
  );
}
