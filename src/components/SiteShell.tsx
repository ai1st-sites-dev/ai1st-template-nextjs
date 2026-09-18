import Header from '@blocks/header/Section';
import Footer from '@blocks/footer/Section';
import TopbarRegion from './TopbarRegion';
import { LocalBusinessJsonLd, WebSiteJsonLd } from './JsonLd';
import { pageLayout } from '@/lib/config';

// TICKET-129: shared layout wrapper used by [locale]/layout.tsx and the
// default-locale root alias pages (src/app/page.tsx, [...slug]/page.tsx,
// blog/page.tsx, blog/[slug]/page.tsx). Centralizes Header/Footer/JsonLd
// rendering so all entry points produce equivalent UI without duplication.
// #960 — `overHero` 说的是「这一页的第一段是不是 hero」。只有它为真时,透明浮层那种顶栏才真的浮起来
// 压在首屏上;别的页第一段是 page-header,浮上去就是标题被压在横条底下。判断由**页面**给(它自己知道
// 第一段是什么),这里只负责传下去 —— 其余三种顶栏结构跟这个参数无关。
//
// 🔴 #1000 — 哪些区、什么顺序，现在由 page layout 库说了算（`pageLayout.regions`，构建期从
// `site/page-layout.json` 选出来并校验过，缺文件的站拿到的是 `standard` = 下面那三行的老样子）。
//
// 🔴 两段 JSON-LD 不在 regions 里，是外壳的固定件。它们不占一个像素，所以「换个布局重建一次、逐像素
// 相同」这种判据看不见它们消失 —— 而我们靠被搜索引擎和 AI 找到吃饭。要它们变成可选，得有人先说服
// 自己那件事值得；在那之前它们无条件渲染（#1000 的 AC7 盯着这一条，带反向对照）。
//
// 🔴 `overHero` 仍由**页面**算好传进来，page layout 只决定有哪些区、不接管它（正文第 3 条）。
// #1351 —— `page` 是**这一页在站自己的 `pages/` 里那个名字**（`home` / `about` / `services/oil-change`）。
// 它落到 `<main data-page="…">` 上，唯一的读者是检查器：面板点中一个块之后要问「它住在哪一页」，
// 而站级共用块（`blocks/site-blocks.json`）在**好几页上都叫同一个 id** —— 不说页面的话，服务器只能
// 按文件名顺序挑第一个，于是老板在 A 页点「隐藏」，改的是 B 页。那种错法是静默的：两页都建得出来。
// 🔴 不传就不写这个属性（博客那两页没有 pages/ 里的记录），老站也没有它 —— 面板那边退回本票之前的
//    行为（不带 page 去问），不造一个猜出来的值。
// 🔴 它跟 `data-block-id` 同类：是编辑器的标识，不是主题表的钩子（`theme-css-lint.js` §EDITOR_ATTRS 拒绝它）。
export default function SiteShell({ locale, overHero = false, page, children }: { locale: string; overHero?: boolean; page?: string; children: React.ReactNode }) {
  const regions = pageLayout.regions;
  const repeatVariants = pageLayout.repeatVariants || {};

  // 区名是「类」本身（`footer`）或者「类-后缀」（`footer-a`）；后缀只在同一类出现多次时用来区分谁是谁，
  // 那时结构由布局自己钉（主题每类只有一个值，分不出第几个）。
  const kindOf = (region: string) => {
    const dash = region.indexOf('-');
    const head = dash > 0 ? region.slice(0, dash) : region;
    return ['topbar', 'header', 'content', 'footer'].includes(region) ? region
      : (['topbar', 'header', 'content', 'footer'].includes(head) ? head : '');
  };

  return (
    <>
      <LocalBusinessJsonLd locale={locale} />
      <WebSiteJsonLd locale={locale} />
      {regions.map((region) => {
        switch (kindOf(region)) {
          case 'topbar':
            return <TopbarRegion key={region} locale={locale} />;
          case 'header':
            return <Header key={region} locale={locale} overHero={overHero} />;
          case 'content':
            // #1351 —— `data-locale` 跟 `data-page` 一起写：多语言站里同一个站级块 id 在每种语言下都存在，
            //    只说页面仍然分不清是哪一份。值取的是**站自己的语言目录名**（`site/<locale>/`），不是
            //    `<html lang>` —— 后者是 `seo.locale` 切出来的展示用语言码，两者不保证相等，而不相等时
            //    的错法是静默的（改到另一种语言的那一份）。
            return <main key={region} className="flex-1" {...(page ? { 'data-page': page, 'data-locale': locale } : {})}>{children}</main>;
          case 'footer':
            // 🔴 #1014 — footer 是唯一接了 `variant` 线的区。上面 topbar / header 两支不传，所以布局
            // 里写 `repeatVariants` 给它们是不生效的 —— 那件事现在由 schema 直接拒绝
            // （`scripts/lib/page-layout.js` 的 `REPEATABLE_KINDS`）。给它们也接上线的话，记得
            // 同时把那个常量改掉，两处必须一起动。
            return <Footer key={region} locale={locale} variant={repeatVariants[region]} />;
          default:
            // 构建期的 schema 已经把不认识的区拦掉了（scripts/lib/page-layout.js）。这一支是为了
            // 「万一」也不静默：什么都不画，但类型上说得清楚。
            return null;
        }
      })}
    </>
  );
}
