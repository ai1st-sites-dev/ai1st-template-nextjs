#!/usr/bin/env node
/**
 * fallback-site.test.js — 按钮落点「slug 转路径」那一步（#1623）。
 *
 * 跑法:  node scripts/lib/fallback-site.test.js   （也被 `npm run test:scripts` 自动发现，CI 跑）
 * 退出码: 0 全过 · 1 有失败 · 2 跑不起来（**不许当成通过**）
 *
 * #1601 的配方在平台关掉 contact 块时把 ctaPage 定成 `home`（按钮指首页，不留死链），而 `contactHrefOf`
 * 把命中的 slug 原样拼成 `/<slug>` ⟹ 骨架页按钮指 `/home`，首页的真实路由是 `/`。发布前那道死链检查拦得住，
 * 代价是整站发不出去。同一张票还收 AI 改站提示词里那条 `"href": "/quote"` 的示例（配方里没有 quote 页）。
 *
 * 🔴 AC1 ② 那一格是本票的判别格：把 `contactHrefOf` 里 `s === 'home' ? '/' :` 那一段退回去，它必须红。
 */

'use strict';

const fs = require('fs');
const path = require('path');

let pass = 0; let fail = 0;
const check = (cond, msg) => { if (cond) { pass += 1; console.log(`  ✅ ${msg}`); } else { fail += 1; console.log(`  ❌ ${msg}`); } };
const die = (m) => { console.error(`🔴 跑不起来: ${m}`); process.exit(2); };

let fallbackSite; let siteRecipe; let blockManifest; let siteForms;
try {
  fallbackSite = require('./fallback-site');
  siteRecipe = require('./site-recipe');
  blockManifest = require('./block-manifest');
  siteForms = require('./site-forms');
} catch (e) { die(`require 失败：${e.message}`); }
const { contactHrefOf, skeletonSections } = fallbackSite;
const { sitePagesFor, CTA_PAGE, PAGE_DEFAULTS } = siteRecipe;

const pagesOf = (...slugs) => slugs.map((slug) => ({ slug }));

console.log('AC1 contactHrefOf 三格');
{
  const got = contactHrefOf(pagesOf('home', 'services', 'contact'), 'contact');
  check(got === '/contact', `① 清单里有 contact、ctaPage='contact' ⟹ /contact（读到 ${JSON.stringify(got)}）`);
}
{
  const got = contactHrefOf(pagesOf('home', 'services', 'services/cut'), 'home');
  check(got === '/', `② 清单里没有 contact、ctaPage='home' ⟹ /，不是 /home（读到 ${JSON.stringify(got)}）`);
}
{
  const got = contactHrefOf(pagesOf('home', 'services', 'about'), 'book');
  check(got === '/', `③ 三个候选都不在 ⟹ /（读到 ${JSON.stringify(got)}）`);
}
{
  // #1636 —— 报价页不再算联系页：清单里就算有一张 quote 页（参照站那条路上 AI 真建过的），也不从它这儿取，
  //    跟后面的 ctaPage 走（这里 ctaPage='home' ⟹ /）。故意把候选改回含 'quote'，这一格读成 /quote、变红。
  const got = contactHrefOf(pagesOf('home', 'quote'), 'home');
  check(got === '/', `没有 contact、有 quote ⟹ 不取 quote，走 ctaPage（home ⟹ /）（读到 ${JSON.stringify(got)}）`);
}

console.log('AC2 配方 → contactHrefOf 接起来');
const plan = sitePagesFor('hair salon', { services: [{ id: 'cut' }], disabledBlocks: ['contact'] });
{
  const slugs = plan.pages.map((p) => p.slug);
  // 前提先钉住：这一格量的是「contact 被关掉」那一支，不是正常那一支。
  check(!slugs.includes('contact') && plan.ctaPage === 'home',
    `前提：关掉 contact ⟹ 页清单里没有 contact、ctaPage='home'（读到 ${slugs.join(' · ')} / ctaPage=${JSON.stringify(plan.ctaPage)}）`);
  const got = contactHrefOf(plan.pages, plan.ctaPage);
  check(got === '/', `sitePagesFor(...) 的结果喂给 contactHrefOf ⟹ /（读到 ${JSON.stringify(got)}）`);
}

console.log('AC3 骨架页真出来的按钮');
{
  // 页清单照 create-site.js 组 ai.pages 那一步的形状（slug + 文字字段 + 服务页标记，不带配方的 blocks）。
  const sitePages = plan.pages.map((rp) => ({
    slug: rp.slug,
    ...(rp.kind === 'home' ? { title: 'Home' } : rp.kind === 'service' ? { title: 'Cut' } : { ...PAGE_DEFAULTS[rp.kind] }),
    ...(rp.serviceDetailPage ? { serviceDetailPage: true, parentService: rp.parentService } : {}),
  }));
  const disabledBlocks = ['contact'];
  const forms = siteForms.siteFormsFrom(undefined);
  for (const page of sitePages) {
    const sections = skeletonSections(page, { companyName: 'Cedar Cuts', sitePages, ctaPage: plan.ctaPage, disabledBlocks });
    const hrefs = [];
    for (const sec of sections) for (const c of (sec.data && Array.isArray(sec.data.ctas) ? sec.data.ctas : [])) hrefs.push(c.href);
    check(hrefs.length > 0 && hrefs.every((h) => h === '/'),
      `${page.slug}：骨架页的按钮 href 全是 /（读到 ${JSON.stringify(hrefs)}）`);
    const problems = blockManifest.validateSite({ pages: [{ ...page, sections }], industry: 'hair salon', disabledBlocks, forms, scope: 'edit' }).problems;
    check(problems.length === 0, `${page.slug}：骨架页过 validateBlocks 不报错（${problems.length ? problems.join(' | ') : '0 条'}）`);
  }
}

console.log('AC4 AI 改站提示词里站级块示例的按钮落点');
{
  const src = fs.readFileSync(path.join(__dirname, '..', 'edit-site.js'), 'utf8');
  check(!src.includes('"/quote"'), 'edit-site.js 里没有 "/quote"');
  // 那个示例住在 `const SYSTEM_PROMPT = \`…\`` 模板字面量里（同 editable-files.test.js ⑥ 的取法：切在字面量里面）。
  const at = src.indexOf('const SYSTEM_PROMPT = `');
  if (at < 0) die('edit-site.js 里找不到 `const SYSTEM_PROMPT = `');
  const body = src.slice(at, src.indexOf('\n`;', at));
  const ex = body.indexOf('"shared-cta": {');
  if (ex < 0) die('SYSTEM_PROMPT 里找不到 "shared-cta" 那个示例 —— 这一格量不到那一行，而这不是通过');
  const line = body.slice(ex).split('\n').find((l) => l.includes('"ctas"'));
  if (!line) die('"shared-cta" 示例里找不到 "ctas" 那一行');
  // 那一行里的 `${CTA_PAGE}` 按 edit-site.js 自己的绑定求值：它必须就是配方那一个常量。
  check(/const \{ CTA_PAGE \} = require\('\.\/lib\/site-recipe'\);/.test(src), "edit-site.js 的 CTA_PAGE 取自 require('./lib/site-recipe')");
  let ctas;
  try {
    // eslint-disable-next-line no-new-func
    const rendered = new Function('CTA_PAGE', `return \`${line}\`;`)(CTA_PAGE);
    ctas = JSON.parse(`{${rendered.trim()}}`).ctas;
  } catch (e) { die(`那一行求值/解析失败：${e.message}（行：${line.trim()}）`); }
  const hrefs = ctas.map((c) => c.href);
  check(hrefs.length === 1 && hrefs[0] === `/${CTA_PAGE}`, `示例 href 等于 /<site-recipe.js 的 CTA_PAGE>（读到 ${JSON.stringify(hrefs)}，CTA_PAGE=${JSON.stringify(CTA_PAGE)}）`);
}

console.log(`\n${pass} 通过 · ${fail} 失败`);
process.exit(fail ? 1 : 0);
