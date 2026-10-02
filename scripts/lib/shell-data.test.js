#!/usr/bin/env node
// shell-data.test.js —— 顶栏 / 页脚 data 的构建期派生（#1425 T3，`scripts/lib/shell-data.js`）。
//
// 跑法:  node scripts/lib/shell-data.test.js        退出码: 0 全过 · 1 有失败
//
// 判据都来自 PM 2026-10-02 在 #1425 上的裁定 ①：
//   · 映射 header.links → nav · header.cta → ctaPrimary · footer.columns[0].links → nav · brand.logoUrl → logo · 生意名 → brandName；
//   · 联系方式 / 社交写成引用，不抄值；
//   · 派生不到的维度（legal · footer.cta · columns.areas · form · ctaSecondary）不造数据。
// 还有一条反向：派生出来的每个键都必须是块 manifest 声明过的槽（写错一个键名，块就静默不画它）。
'use strict';

const path = require('path');
const { shellDataFor, localizeHref } = require('./shell-data');
const { loadManifests } = require('./block-manifest');

let pass = 0;
let fail = 0;
const check = (cond, msg) => {
  if (cond) { pass += 1; console.log(`  ✅ ${msg}`); } else { fail += 1; console.log(`  ❌ ${msg}`); }
};

const NAV = {
  header: { links: [{ label: 'Home', href: '/' }, { label: 'About', href: '/about' }, { label: '', href: '/x' }], cta: { label: 'Get a Quote', href: '/quote' } },
  footer: {
    description: 'Independent auto repair since 1998.',
    columns: [
      { title: 'Quick Links', links: [{ label: 'Home', href: '/' }, { label: 'Services', href: '/services' }] },
      { title: 'Brakes', links: [{ label: 'Brake pads', href: '/brakes/pads' }] },
    ],
    copyright: 'Northside Auto Care. All rights reserved.',
  },
  topbar: { message: 'Spring sale' },
};
const BRAND = { logoUrl: '/logo.svg', email: 'hi@example.com', locations: [{ phone: '416-555-0000', address: '1 Main St' }], socialLinks: { facebook: 'https://facebook.com/x' } };
const SERVICES = [{ id: 'brakes', name: 'Brakes' }, { id: 'tires', name: 'Tires' }, { id: '', name: 'No id' }];
const PAGES = [{ slug: 'home' }, { slug: 'services/brakes' }];

const d = shellDataFor({ nav: NAV, brand: BRAND, brandName: 'Northside Auto Care', services: SERVICES, pages: PAGES, year: 2026 });

console.log('── ① 映射（PM 裁定 ①）');
check(JSON.stringify(d.header.nav) === JSON.stringify([{ label: 'Home', href: '/' }, { label: 'About', href: '/about' }]),
  `header.links → nav，label 空的那一项去掉（读到 ${JSON.stringify(d.header.nav)}）`);
check(JSON.stringify(d.header.ctaPrimary) === JSON.stringify({ label: 'Get a Quote', href: '/quote', style: 'solid' }), 'header.cta → ctaPrimary（实心）');
check(d.header.logo === '/logo.svg' && d.footer.logo === '/logo.svg', 'brand.logoUrl → 两个区的 logo');
check(d.header.brandName === 'Northside Auto Care' && d.footer.brandName === 'Northside Auto Care', '生意名 → 两个区的 brandName');
check(JSON.stringify(d.footer.nav) === JSON.stringify(NAV.footer.columns[0].links), 'footer.columns[0].links → footer.nav');
check(d.footer.tagline === NAV.footer.description, 'footer.description → tagline');
check(JSON.stringify(d.footer.columns.services) === JSON.stringify([{ label: 'Brakes', href: '/services/brakes' }, { label: 'Tires', href: '/services#tires' }]),
  `服务栏：有详情页去详情页、没有就落到服务页那一节、没 id 的不要（读到 ${JSON.stringify(d.footer.columns.services)}）`);

console.log('── ② 联系方式 / 社交是引用，不是抄进来的值（Chris 2026-09-30 #1506）');
check(JSON.stringify(d.header.topbar.contact) === JSON.stringify([{ source: 'phone' }, { source: 'email' }]), 'header.topbar.contact 是 phone / email 两个引用');
check(JSON.stringify(d.footer.contact) === JSON.stringify({ source: 'brand' }) && JSON.stringify(d.footer.social) === JSON.stringify({ source: 'social' }), 'footer.contact / social 是整槽引用');
const flat = JSON.stringify(d);
check(!flat.includes('416-555-0000') && !flat.includes('hi@example.com') && !flat.includes('facebook.com'),
  '派生结果里一个电话 / 邮箱 / 社交网址的字面值都没有');

console.log('── ③ 派生不到的不造（PM 裁定 ①）');
for (const k of ['legal', 'cta', 'form', 'bg', 'options']) check(!(k in d.footer), `footer 没有 ${k}`);
check(!('areas' in d.footer.columns), 'footer.columns 没有 areas');
for (const k of ['ctaSecondary', 'bg', 'options']) check(!(k in d.header), `header 没有 ${k}`);
check(!('links' in d.header.topbar) && !('social' in d.header.topbar), 'header.topbar 只有 contact（没有 links / social）');
check(!flat.includes('Spring sale'), 'navigation.json 的 topbar（公告条那句话）不进任何一个区（公告条退役，数据留着不读）');

console.log('── ④ 版权行');
check(d.footer.copyright === '© 2026 Northside Auto Care. All rights reserved.', `不带 © 的补上「© 年份」（读到 ${d.footer.copyright}）`);
const withSign = shellDataFor({ nav: { ...NAV, footer: { ...NAV.footer, copyright: '© 2026 Demo Company. All rights reserved.' } }, brand: BRAND, brandName: 'x', services: [], pages: [], year: 2026 });
check(withSign.footer.copyright === '© 2026 Demo Company. All rights reserved.', '已经带 © 的照原样（不印两遍 ©）');

console.log('── ⑤ 空输入不抛、不造');
const empty = shellDataFor({});
check(Array.isArray(empty.header.nav) && empty.header.nav.length === 0 && !('ctaPrimary' in empty.header) && !('copyright' in empty.footer) && !('logo' in empty.header),
  '什么都没给：nav 空、没有 ctaPrimary / copyright / logo');

console.log('── ⑥ 每个键都是块 manifest 声明过的槽（写错键名 ⟹ 块静默不画它）');
const manifests = loadManifests(path.join(__dirname, '..', '..', 'blocks'));
for (const region of ['header', 'footer']) {
  const slots = (manifests.get(region) || {}).slots || {};
  check(Object.keys(slots).length > 0, `blocks/${region} 的 manifest 读得到槽（分母不是 0）`);
  const unknown = Object.keys(d[region]).filter((k) => !(k in slots));
  check(unknown.length === 0, `${region} 派生的键全在它的 slots 里${unknown.length ? `（多出 ${unknown.join(' / ')}）` : ''}`);
}
// 反向对照：同一把尺对一个写错键名的 data 要报。
const slotsH = (manifests.get('header') || {}).slots || {};
check(['navLinks'].filter((k) => !(k in slotsH)).length === 1, '反向对照：一个不存在的键（navLinks）这把尺量得出来');

console.log('── ⑦ 副语言那一份：站内链接加 /<locale> 前缀，默认语言和站外链接不动（#1425 QA2 r1 F2，TICKET-129）');
{
  const zh = shellDataFor({ nav: NAV, brand: BRAND, brandName: 'x', services: SERVICES, pages: PAGES, locale: 'zh', defaultLocale: 'en', year: 2026 });
  const en = shellDataFor({ nav: NAV, brand: BRAND, brandName: 'x', services: SERVICES, pages: PAGES, locale: 'en', defaultLocale: 'en', year: 2026 });
  const hrefs = (x) => [...x.header.nav, ...(x.header.ctaPrimary ? [x.header.ctaPrimary] : []), ...x.footer.nav, ...x.footer.columns.services].map((l) => l.href);
  const zhH = hrefs(zh); const enH = hrefs(en);
  check(zhH.length > 0, `zh 那一份有站内链接可查（${zhH.length} 个，分母不是 0）`);
  check(zhH.every((h) => h === '/zh' || h.startsWith('/zh/')), `zh 那一份每个站内链接都在 /zh 下：${zhH.join(' ')}`);
  check(JSON.stringify(enH) === JSON.stringify(hrefs(d)), '默认语言那一份跟不传 locale 时逐字相同（不加前缀）');
  check(localizeHref('/', 'zh', 'en') === '/zh' && localizeHref('/about', 'zh', 'en') === '/zh/about', "'/' → /zh、'/about' → /zh/about");
  check(localizeHref('tel:+1416', 'zh', 'en') === 'tel:+1416' && localizeHref('https://x.com/a', 'zh', 'en') === 'https://x.com/a'
    && localizeHref('//cdn.x/a', 'zh', 'en') === '//cdn.x/a' && localizeHref('#top', 'zh', 'en') === '#top', 'tel: / https: / // / #… 原样不动');
  // 反向对照：不传 locale（= 改前的调用方式）时 zh 那一份的链接不带前缀 —— 上面那一格确实分得开两种实现。
  const before = hrefs(shellDataFor({ nav: NAV, brand: BRAND, brandName: 'x', services: SERVICES, pages: PAGES, year: 2026 }));
  check(!before.every((h) => h === '/zh' || h.startsWith('/zh/')), '反向对照：不传 locale 时同一个判据读到「不在 /zh 下」');
}

console.log(`\n══ 汇总: 通过 ${pass} · 失败 ${fail} ══`);
process.exit(fail ? 1 : 0);
