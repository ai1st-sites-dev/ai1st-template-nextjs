// #1502 —— 一页的面包屑，按页面路径算（Chris 2026-09-30：内容和样子分开，面包屑 AI 不写）。
//
// 🔴 **算法只有这一份**：原来写在 `SubPage.tsx` 里给 `BreadcrumbList` 结构化数据用（按 slug 拆层级，中间一级查
//    `services/<第一段>` 这一页在不在）。现在结构化数据和 `page-header` 页面上那一行都调这里 ⟹ 两处的文字
//    出自同一个函数，页面改名 / 挪位置后不会一处跟着变、一处不变。
//
// 每一级给三样：
//   · `label` —— 这一级的名字。第一级固定是 `'Home'`（结构化数据就写这个；页面上那一行由块换成本地化的词）。
//   · `url`   —— 绝对地址（`seo.domain` + 本地化路径），结构化数据用。行为跟抽出来之前逐字相同。
//   · `href`  —— 页面上的链接，**只在那一页真的存在时才有**（跟 `keyword-page-options.js` 让 AI 写「NO LINK」同一个
//                意思）；最后一级（当前页）永远没有。结构化数据不读它。
import { getPage, getSeo, getServices, localeUrl } from '@/lib/config';
import { getLabels } from '@/lib/component-labels';

export interface Crumb {
  label: string;
  url: string;
  href?: string;
}

const titleFromSlug = (s: string) => s.replace(/-/g, ' ').replace(/\b\w/g, (c: string) => c.toUpperCase());

/** `slug` 是页面 JSON 里那个 slug（`about` / `services/x` / `x/y`），首页（`home`）不调它。页面不在就回空数组。 */
export function breadcrumbsFor(slug: string, locale: string): Crumb[] {
  const page = getPage(slug, locale);
  if (!page) return [];
  const seo = getSeo(locale);
  const abs = (s: string) => `${seo.domain}${localeUrl(s, locale)}`;
  const home: Crumb = { label: 'Home', url: abs('home'), href: localeUrl('home', locale) };
  const current: Crumb = { label: page.title, url: abs(slug) };

  const slugParts = slug.split('/');
  if (slugParts.length <= 1) return [home, current];

  // #1550 —— 关键词页的新形状 `services/<id>/<词>`：中间一级就是它的服务详情页 `services/<id>`，文字是服务名
  //    （服务目录里的那个名字；详情页的 title 往往是一句 SEO 标题）。详情页不在时只出文字、不出链接。
  //    下面那段按「第一段 = 服务」认的是老形状 `<服务slug>/<词>`，老站照旧走它。
  if (slugParts.length === 3 && slugParts[0] === 'services') {
    const parentSlug = `services/${slugParts[1]}`;
    const parent = getPage(parentSlug, locale);
    const svc = (getServices(locale) || []).find((s) => s.id === slugParts[1]);
    const label = svc?.name || parent?.title || titleFromSlug(slugParts[1]);
    const middle: Crumb = parent
      ? { label, url: abs(parentSlug), href: localeUrl(parentSlug, locale) }
      : { label, url: abs(parentSlug) };
    return [home, middle, current];
  }

  const serviceDetailSlug = `services/${slugParts[0]}`;
  const serviceDetailPage = getPage(serviceDetailSlug, locale);
  const middle: Crumb = serviceDetailPage
    ? { label: serviceDetailPage.title, url: abs(serviceDetailSlug), href: localeUrl(serviceDetailSlug, locale) }
    : { label: titleFromSlug(slugParts[0]), url: abs(slugParts[0]) };
  if (!serviceDetailPage && getPage(slugParts[0], locale)) middle.href = localeUrl(slugParts[0], locale);
  return [home, middle, current];
}

/**
 * #1552 —— 喂 `BreadcrumbList` 结构化数据的那一份（`SubPage.tsx` 用）。跟 `breadcrumbsFor` 同一套层级，两处不同：
 *   · 首项 `name` 按语言取词（`component-labels` 的 `home`，跟页头那一行同一张表）—— `breadcrumbsFor` 的第一级
 *     固定是 `'Home'`，页头那一行自己换词，结构化数据原来没换，法语站的 JSON-LD 里就是英文；
 *   · 中间层只在那一页**存在**时带 `url`（它存在 ⟺ `breadcrumbsFor` 给了它 `href`）。原来没有服务详情页时，中间层
 *     指向一个不存在的 `/<服务slug>`。首项和当前页永远存在。
 */
export function breadcrumbJsonLdItems(slug: string, locale: string): { name: string; url?: string }[] {
  const crumbs = breadcrumbsFor(slug, locale);
  const homeLabel = getLabels(locale).home;
  return crumbs.map((c, i) => {
    const last = i === crumbs.length - 1;
    const name = i === 0 ? homeLabel : c.label;
    return i === 0 || last || c.href ? { name, url: c.url } : { name };
  });
}
