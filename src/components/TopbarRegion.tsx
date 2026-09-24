import AnnouncementBarSection from '@blocks/announcement-bar/Section';
import { getNavigation, regions } from '@/lib/config';

// #1000 — 顶栏那条细带，page layout 库里 `with-topbar` 的那个区。
//
// 内容来自 `navigation.json` 新增的可选 `topbar` 段（Header / Footer 的导航内容今天就在这个文件里），
// 结构值来自 `regions.topbar.shape`。🔴 #1353 起这个**值**不再是「主题注册表的 supports」，而是跟别的
// 32 个块同一张**选择单**（`theme-pool.json` 的 `shapes`），形态清单归 `blocks/announcement-bar/manifest.json`。
//
// 🔴🔴 但它跟 header / footer **不是同一条路**，别照字面读（#1353 r3 —— r2 的注释写成了「同一条路」，
//    QA2 在真机上量穿了）：顶栏 / 页脚这两个区挂的是 `data-block` + `data-shape`，画法真的由
//    `public/shapes.css` 接管；**这条外壳带挂的仍然是 `data-region-layout`**（`asRegion`，三个理由见下），
//    而全树没有任何 CSS 选 `[data-region-layout]` ⟹ 这个值今天**画不出任何东西**，外壳带的长相
//    100% 来自 `base.css` 的地板。要让它也吃形态层，就得给它挂块属性，而那**不是无损的**：
//    单变量实测（同一份产物，只加 `data-block`/`data-shape` 两个属性，1280 宽）
//      条 [0,0,1280,44] → [0,0,1280,72]（display flex → grid）
//      文字 [470.5,12,267,20] → [24,12,576,20]（居中 → 靠左）· 链接掉到第二行 [24,40,64,20]
//    而本票 AC1 点名「顶栏 / 页脚 / **公告条** 每个元素 bbox 改造前后相同」⟹ 挂上去就违反它自己的 AC。
//    所以这一轮**有意不挂**，去处交 PM 判（要么 AC1 给公告条开口子，要么这条带就留在地板上）。
// 选了 `with-topbar` 却没配内容的站在**构建期**就被拒绝了
// （`sync-config.js`），所以这里读到空只可能是有人绕过了构建，画不出东西也不该假装有。
//
// 🔴 它渲染的是既有的 `AnnouncementBarSection`，但**不带块属性**（`asRegion`）。PM 在 #1000 让我在
// 两条路里选一条并写明依据，这是选的那条，三个理由都是能查的：
//   ① 主题 CSS 选 `[data-block="announcement-bar"]` 会连外壳这条带一起选中 —— 而它是外壳，不是这一页
//      的内容块；主题动它等于动了每一页的顶部。
//   ② #992 那套不变量按 `[data-role]` 找「必须画出来的东西」并逐个量对比度/可见性；外壳区混进那个集合，
//      它的读数会被当成页面内容的读数。
//   ③ #1002 的「骨一点没动」判据枚举的就是 `[data-block]` —— 外壳多一个块属性，那份基线当天就变。
// 代价说在明处：这个区在产物里带的是 `data-region-layout`（跟 header / footer 一致，也是 PM 定的
// 那条口径），主题要动它就走区那条路。
// #1405 —— `topbar` 传了就用它（编辑器画布上老板正在改的那一份，`null` = 清空了），不传就读 navigation.json。
// 🔴 编辑器那一支单独 return，读 navigation.json 的那几行一个字不动：`navigation-owned.test.js` ⑫ 用 AST 跟着
//    `const topbar = nav.topbar` 这条别名去判「这个组件画了 topbar.message」，把它写成三元式那条守卫就跟丢了
//    （实测：⑫ 红，说「组件根本没把它画进 DOM」）。
type TopbarOverride = { message: string; link?: { label: string; href: string } } | null;
export default function TopbarRegion({ locale, topbar: override }: { locale: string; topbar?: TopbarOverride }) {
  if (override !== undefined) {
    if (!override || !override.message) return null;
    return <AnnouncementBarSection asRegion data={{ message: override.message, link: override.link, variant: regions.topbar.shape }} />;
  }
  const nav = getNavigation(locale);
  const topbar = nav.topbar;
  if (!topbar || !topbar.message) return null;
  return (
    <AnnouncementBarSection
      asRegion
      data={{ message: topbar.message, link: topbar.link, variant: regions.topbar.shape }}
    />
  );
}
