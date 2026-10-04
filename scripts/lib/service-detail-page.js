/**
 * service-detail-page.js —— 「这一页是不是服务详情页」唯一的一份判断（#1551 从 page-deps.js 原样搬出来）。
 * 搬出来是因为它不该拖着 fs：关键词页的 Service 结构化数据（keyword-service.js）在前端组件里也要问它。
 */
'use strict';

// 服务详情页（`/services/<id>` 那种页面）。这份判断本来就在 sync-config.js 里（导航要把这类页面
// 排除在外），#1033 r2 搬到这里让两处共用一个定义 —— 两份拷贝里的一份改了另一份没改，正是 page-deps.js
// 文件头上说的那种「过期了跟没过期长得一模一样」。
// 🔴 渲染那一侧（`src/components/pages/SubPage.tsx:16-19`）还多一个条件：slug 去掉前缀之后要对得上
//    某个服务的 id，对不上就不发那份结构化数据。这里**故意不加**那个条件：加了之后「新添一个服务，
//    让一张已经存在的 services/<id> 页面第一次匹配上」这种改法会少报，而少报是静默的。不加的代价是
//    services/<不存在的 id> 这种页面会跟着 services.json 动 —— 多报，看得见。
// 🔴 #1550 —— slug 那一支只认**恰好一段** `services/<id>`：关键词页挂在 `services/<id>/<词>` 下，
//    以前那句 `startsWith('services/')` 会把它们全当成服务详情页（进不了页脚、按服务 id 找不到服务、
//    keyword-service.js 的 isKeywordPage 为假 ⟹ 一条 Service 结构化数据都不出）。
function isServiceDetailPage(page) {
  if (!page) return false;
  const slug = page.slug;
  return page.serviceDetailPage === true
    || (typeof slug === 'string' && /^services\/[^/]+$/.test(slug));
}

module.exports = { isServiceDetailPage };
