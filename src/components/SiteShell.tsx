import { Fragment } from 'react';
import Header, { type HeaderNewData } from '@blocks/header/Section';
import Footer, { type FooterNewData } from '@blocks/footer/Section';
import type { IconTable } from './InlineIcon';
import LanguageSwitcher from './LanguageSwitcher';
import { LocalBusinessJsonLd, WebSiteJsonLd } from './JsonLd';
import { getServices, leadFormSite, localeSwitchIndex } from '@/lib/config';
import { itemSourceContext, resolveItemSources } from '@/lib/sections/item-sources';
import type { BlockConfig, SiteData } from '@/lib/types/config';

// TICKET-129: shared layout wrapper used by [locale]/layout.tsx and the
// default-locale root alias pages (src/app/page.tsx, [...slug]/page.tsx,
// blog/page.tsx, blog/[slug]/page.tsx). Centralizes Header/Footer/JsonLd
// rendering so all entry points produce equivalent UI without duplication.
// 📌 #1425（T3）—— 这里原来有一个 `overHero` 参数（#960：这一页第一段是不是 hero，透明浮层那种顶栏只在
//    那时浮起来）。新库的 header 没有透明浮层这个形态，参数随它一起删了。
//
// 🔴 #1425（T3）—— 顶栏 / 页脚现在是新库那两个**纯 props** 块（`blocks/header` / `blocks/footer`）。data 是构建期
//    从 navigation.json + brand.json 派生的那一份（`regions.<区>.dataByLocale`，`scripts/lib/shell-data.js`），
//    形态是 `regions.<区>.shape`；联系方式 / 社交链接在 data 里是引用，这里用页面块同一个 `resolveItemSources`
//    展开。图标表是构建期查好的那一份（`regions.<区>.iconTableByLocale`）：这个组件也被编辑器画布（客户端）渲染，
//    读文件的 `iconTableFor` 进不了浏览器包。
//
// 🔴 #1000 — 哪些区、什么顺序，现在由 page layout 库说了算（`pageLayout.regions`，构建期从
// `site/page-layout.json` 选出来并校验过，缺文件的站拿到的是 `standard` = 下面那三行的老样子）。
//
// 🔴 两段 JSON-LD 不在 regions 里，是外壳的固定件。它们不占一个像素，所以「换个布局重建一次、逐像素
// 相同」这种判据看不见它们消失 —— 而我们靠被搜索引擎和 AI 找到吃饭。要它们变成可选，得有人先说服
// 自己那件事值得；在那之前它们无条件渲染（#1000 的 AC7 盯着这一条，带反向对照）。
//
// #1351 —— `page` 是**这一页在站自己的 `pages/` 里那个名字**（`home` / `about` / `services/oil-change`）。
// 它落到 `<main data-page="…">` 上，唯一的读者是检查器：面板点中一个块之后要问「它住在哪一页」，
// 而站级共用块（`blocks/site-blocks.json`）在**好几页上都叫同一个 id** —— 不说页面的话，服务器只能
// 按文件名顺序挑第一个，于是老板在 A 页点「隐藏」，改的是 B 页。那种错法是静默的：两页都建得出来。
// 🔴 不传就不写这个属性（博客那两页没有 pages/ 里的记录），老站也没有它 —— 面板那边退回本票之前的
//    行为（不带 page 去问），不造一个猜出来的值。
// 🔴 它跟 `data-block-id` 同类：是编辑器的标识，不是主题表的钩子（`theme-css-lint.js` §EDITOR_ATTRS 拒绝它）。
//
// #1405 —— `shell`：编辑器画布用的覆盖值（布局 / 顶栏形态 / 页脚形态；公告条文字随 #1425 退役）。编辑器的 root 字段
// 改了之后画布要当场变，而站上的这几样是构建时烤进 config 的 —— 所以编辑器把它手上那一份传进来，
// 走的仍是这一个组件、这几个真组件（票正文做什么 3「不做简化版」）。站上的页面不传它，行为一个字节不变。
export interface ShellOverride {
  layout: { regions: string[]; repeatVariants?: Record<string, string> };
  headerShape: string;
  footerShape: string;
}

/** 一个区那个块这次要用的图标表：构建期查好的，这种语言的那一份（没有就落回默认语言）。 */
function shellIconTable(site: SiteData, region: 'header' | 'footer', locale: string): IconTable {
  const byLocale = site.regions[region].iconTableByLocale || {};
  return (byLocale[locale] ?? byLocale[site.defaultLocale] ?? {}) as IconTable;
}

/** 一个区那个块这次要画的 data：这种语言的那一份（没有就落回默认语言），引用展开之后。 */
function shellBlockData(site: SiteData, region: 'header' | 'footer', locale: string): Record<string, unknown> {
  const byLocale = site.regions[region].dataByLocale || {};
  const raw = byLocale[locale] ?? byLocale[site.defaultLocale] ?? {};
  const [b] = resolveItemSources([{ type: region, data: raw } as unknown as BlockConfig], itemSourceContext(site, locale));
  return ((b && b.data) || {}) as Record<string, unknown>;
}

// #1628 —— `notFound`：只有 app/not-found.tsx 传，交给语言开关（404 页上一律回目标语言首页）。
export default function SiteShell({ site, locale, page, shell, notFound, children }: { site: SiteData; locale: string; page?: string; shell?: ShellOverride; notFound?: boolean; children: React.ReactNode }) {
  const { defaultLocale, locales, pageLayout, regions: siteRegions } = site;
  const regions = shell ? shell.layout.regions : pageLayout.regions;
  const repeatVariants = (shell ? shell.layout.repeatVariants : pageLayout.repeatVariants) || {};

  // 区名是「类」本身（`footer`）或者「类-后缀」（`footer-a`）；后缀只在同一类出现多次时用来区分谁是谁，
  // 那时结构由布局自己钉（主题每类只有一个值，分不出第几个）。
  const kindOf = (region: string) => {
    const dash = region.indexOf('-');
    const head = dash > 0 ? region.slice(0, dash) : region;
    return ['header', 'content', 'footer'].includes(region) ? region
      : (['header', 'content', 'footer'].includes(head) ? head : '');
  };
  // #1425 QA2 r1 F2 —— logo 回首页的那个链接（TICKET-129：默认语言走根路径）。
  const homeHref = locale === defaultLocale ? '/' : `/${locale}`;
  const headerData = shellBlockData(site, 'header', locale);
  const footerData = shellBlockData(site, 'footer', locale);
  // #1665 —— 页脚是浏览器端组件，读不到站点内容：它表单要的东西在这里取好递下去（服务下拉的选项 + 提交地址 / 站 / 表单库）。
  //    这一处 getServices 在 `scripts/lib/page-deps.js` 的 ACCOUNTED 里写明了（站级外壳，不算进哪一页的 <lastmod>）。
  const footerLeadForm = {
    services: (getServices(site, locale) || []).map((s) => ({ id: s.id, name: s.name })),
    ...leadFormSite(site, locale),
  };

  return (
    <>
      <LocalBusinessJsonLd site={site} locale={locale} />
      <WebSiteJsonLd site={site} locale={locale} />
      {regions.map((region) => {
        switch (kindOf(region)) {
          case 'header':
            // 🔴 #1425（T3）—— 语言开关。旧 header 自己在顶栏里画它（唯一的渲染方）；新库的 header 是纯 props、markup 里
            //    没有这一格，所以外壳在顶栏**上方**挂一条细带（PM 2026-10-02 裁定：放进顶栏那一行是改块，另开 T2.n）。
            //    只在多语言站挂：单语言站的 DOM 一个元素都不多（不靠 LanguageSwitcher 自己 return null —— 那样外面这层
            //    div 还在）。不挂 `data-block`：它不是块，编辑器 / 检查器 / 主题表都不该把它当块（同 #1000 外壳固定件）。
            return (
              <Fragment key={region}>
                {locales.length > 1 ? (
                  <div className="bg-body border-bottom">
                    <div className="container d-flex justify-content-end py-1">
                      <LanguageSwitcher currentLocale={locale} notFound={notFound} locales={locales} switchIndex={localeSwitchIndex(site)} />
                    </div>
                  </div>
                ) : null}
                <Header shape={shell?.headerShape || siteRegions.header.shape} data={headerData as HeaderNewData} homeHref={homeHref}
                  iconTable={shellIconTable(site, 'header', locale)} />
              </Fragment>
            );
          case 'content':
            // #1351 —— `data-locale` 跟 `data-page` 一起写：多语言站里同一个站级块 id 在每种语言下都存在，
            //    只说页面仍然分不清是哪一份。值取的是**站自己的语言目录名**（`site/<locale>/`），不是
            //    `<html lang>` —— 后者是 `seo.locale` 切出来的展示用语言码，两者不保证相等，而不相等时
            //    的错法是静默的（改到另一种语言的那一份）。
            return <main key={region} className="flex-grow-1" {...(page ? { 'data-page': page, 'data-locale': locale } : {})}>{children}</main>;
          case 'footer':
            // 🔴 #1014 — footer 是唯一接了 `repeatVariants` 线的区。header 那一支不接，所以布局
            // 里写 `repeatVariants` 给它是不生效的 —— 那件事现在由 schema 直接拒绝
            // （`scripts/lib/page-layout.js` 的 `REPEATABLE_KINDS`）。给它们也接上线的话，记得
            // 同时把那个常量改掉，两处必须一起动。
            return <Footer key={region} shape={repeatVariants[region] || shell?.footerShape || siteRegions.footer.shape}
              locale={locale} homeHref={homeHref}
              data={footerData as FooterNewData} iconTable={shellIconTable(site, 'footer', locale)} leadForm={footerLeadForm} />;
          default:
            // 构建期的 schema 已经把不认识的区拦掉了（scripts/lib/page-layout.js）。这一支是为了
            // 「万一」也不静默：什么都不画，但类型上说得清楚。
            return null;
        }
      })}
    </>
  );
}
