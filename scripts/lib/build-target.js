'use strict';
/**
 * build-target.js — #1547：这一次构建要发布到哪个地址、要不要被搜索引擎收录。
 *
 * 🔴 权威只有一个：manager。它在派每一次构建时就知道这次是预览还是上线，所以由它给出两个值，
 *    worker 把它们注入站容器的 env（`SITE_URL` / `SITE_INDEXABLE`），发布那一次 exec 再换成上线值。
 *    这里**只读这两个 env，不推断** —— 不比对 host 后缀，不回落到任何写死的域名。
 *
 * 为什么在 sync-config 这一层而不是只在 create-site：`seo.json` 只在新建时写一次，而每一次
 * `next build`（冷启动 / 后台重建 / 改后重建 / 升级 / 发布）前面都跑 sync-config —— 覆盖写在这里，
 * 一处就管到全部构建。
 *
 * 两个 env 都缺 = 这个容器是本票之前的 manager 起的（或本地手跑）：`seo.json` 原样用、不标 noindex，
 * 也就是跟改之前逐字节相同。写了但值不合法 = 抛错，构建当场停 —— 一个错的正本地址比停一次构建更糟。
 */

/** 从 env 读出这次构建的目标。返回 `{ siteUrl: string|null, indexable: boolean|null }`；值不合法时抛错。 */
function readBuildTarget(env) {
  const rawUrl = env.SITE_URL;
  const rawIdx = env.SITE_INDEXABLE;
  let siteUrl = null;
  if (rawUrl !== undefined && rawUrl !== '') {
    let u;
    try { u = new URL(rawUrl); } catch { throw new Error(`SITE_URL 不是一个绝对地址：${JSON.stringify(rawUrl)}`); }
    if (u.protocol !== 'http:' && u.protocol !== 'https:') {
      throw new Error(`SITE_URL 只认 http / https：${JSON.stringify(rawUrl)}`);
    }
    if ((u.pathname !== '/' && u.pathname !== '') || u.search || u.hash) {
      throw new Error(`SITE_URL 只能是站点根地址（不带路径 / 查询 / #）：${JSON.stringify(rawUrl)}`);
    }
    siteUrl = `${u.protocol}//${u.host}`;
  }
  let indexable = null;
  if (rawIdx !== undefined && rawIdx !== '') {
    if (rawIdx === 'true') indexable = true;
    else if (rawIdx === 'false') indexable = false;
    else throw new Error(`SITE_INDEXABLE 只认 "true" / "false"：${JSON.stringify(rawIdx)}`);
  }
  return { siteUrl, indexable };
}

/** 把目标写进每个语言的 seo（原地改）。缺的那一项不碰。 */
function applyBuildTarget(seoByLocale, target) {
  for (const seo of Object.values(seoByLocale)) {
    if (target.siteUrl !== null) seo.domain = target.siteUrl;
    if (target.indexable !== null) seo.indexable = target.indexable;
  }
  return seoByLocale;
}

module.exports = { readBuildTarget, applyBuildTarget };
