import AnnouncementBarSection from './sections/AnnouncementBarSection';
import { getNavigation, regionLayout } from '@/lib/config';

// #1000 — 顶栏那条细带，page layout 库里 `with-topbar` 的那个区。
//
// 内容来自 `navigation.json` 新增的可选 `topbar` 段（Header / Footer 的导航内容今天就在这个文件里），
// 结构来自 `regionLayout.topbar` —— 跟 header / footer 同一条路：主题注册表说了算，换装才接管
// （`scripts/region-layout.js`）。选了 `with-topbar` 却没配内容的站在**构建期**就被拒绝了
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
export default function TopbarRegion({ locale }: { locale: string }) {
  const nav = getNavigation(locale);
  const topbar = nav.topbar;
  if (!topbar || !topbar.message) return null;
  return (
    <AnnouncementBarSection
      asRegion
      data={{ message: topbar.message, link: topbar.link, variant: regionLayout.topbar }}
    />
  );
}
