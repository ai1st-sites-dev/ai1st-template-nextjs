import Header from './Header';
import Footer from './Footer';
import { LocalBusinessJsonLd, WebSiteJsonLd } from './JsonLd';

// TICKET-129: shared layout wrapper used by [locale]/layout.tsx and the
// default-locale root alias pages (src/app/page.tsx, [...slug]/page.tsx,
// blog/page.tsx, blog/[slug]/page.tsx). Centralizes Header/Footer/JsonLd
// rendering so all entry points produce equivalent UI without duplication.
// #960 — `overHero` 说的是「这一页的第一段是不是 hero」。只有它为真时,透明浮层那种顶栏才真的浮起来
// 压在首屏上;别的页第一段是 page-header,浮上去就是标题被压在横条底下。判断由**页面**给(它自己知道
// 第一段是什么),这里只负责传下去 —— 其余三种顶栏结构跟这个参数无关。
export default function SiteShell({ locale, overHero = false, children }: { locale: string; overHero?: boolean; children: React.ReactNode }) {
  return (
    <>
      <LocalBusinessJsonLd locale={locale} />
      <WebSiteJsonLd locale={locale} />
      <Header locale={locale} overHero={overHero} />
      <main className="flex-1">{children}</main>
      <Footer locale={locale} />
    </>
  );
}
