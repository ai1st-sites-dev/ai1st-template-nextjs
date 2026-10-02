#!/usr/bin/env node
// shell-data.test.js —— 顶栏 / 页脚 data 的构建期派生（#1425 T3，`scripts/lib/shell-data.js`）。
//
// 跑法:  node scripts/lib/shell-data.test.js        退出码: 0 全过 · 1 有失败
//
// 判据都来自 PM 2026-10-02 在 #1425 上的裁定 ①：
//   · 映射 header.links → nav · header.cta → ctaPrimary · footer.columns[0].links → nav · brand.logoUrl → logo · 生意名 → brandName；
//   · 联系方式 / 社交写成引用，不抄值；
//   · 派生不到的维度（columns.areas · form · topbar.links / topbar.social）不造数据。
//   · #1528：navigation.json 的 `topbar`（老公告条那句话）接回 header 的 `topbar.message`。
//   · #1529：navigation.json 里老板写了的 header.ctaSecondary / footer.legal / footer.cta 照派生，没写就不进 data。
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
for (const k of ['legal', 'cta', 'form', 'bg', 'options']) check(!(k in d.footer), `footer 没有 ${k}（NAV 里没写 legal / cta）`);
check(!('areas' in d.footer.columns), 'footer.columns 没有 areas');
for (const k of ['ctaSecondary', 'bg', 'options']) check(!(k in d.header), `header 没有 ${k}（NAV 里没写 ctaSecondary）`);
check(Array.isArray(d.notes) && d.notes.length === 0, `没有要说的事 ⟹ notes 是空数组（读到 ${JSON.stringify(d.notes)}）`);
check(!('links' in d.header.topbar) && !('social' in d.header.topbar), 'header.topbar 没有 links / social');

console.log('── ③b 老公告条那句话接回 header.topbar.message（#1528；输入是 #1425 之前就存在的形状 {message, link?: {label, href}}）');
{
  const msgOf = (topbar, extra = {}) => {
    const nav = { ...NAV };
    if (topbar === undefined) delete nav.topbar; else nav.topbar = topbar;
    return shellDataFor({ nav, brand: BRAND, brandName: 'x', services: [], pages: [], year: 2026, ...extra }).header.topbar;
  };
  check(JSON.stringify(d.header.topbar.message) === JSON.stringify({ text: 'Spring sale' }), `只有 message ⟹ {text}（纯文字，读到 ${JSON.stringify(d.header.topbar.message)}）`);
  check(JSON.stringify(d.footer).indexOf('Spring sale') < 0, '页脚里没有它');
  const full = msgOf({ message: '24/7 emergency service', link: { label: 'Call now', href: '/contact' } }).message;
  check(JSON.stringify(full) === JSON.stringify({ text: '24/7 emergency service', href: '/contact', label: 'Call now' }), `message + link ⟹ {text, href, label}（读到 ${JSON.stringify(full)}）`);
  const onlyLink = msgOf({ message: '', link: { label: 'Book now', href: '/quote' } }).message;
  check(JSON.stringify(onlyLink) === JSON.stringify({ text: 'Book now', href: '/quote' }), `只填了链接（老编辑器允许）⟹ 链接文字当那句话、整句是链接（读到 ${JSON.stringify(onlyLink)}）`);
  const noLabel = msgOf({ message: 'Open Sunday', link: { label: '', href: '/hours' } }).message;
  check(JSON.stringify(noLabel) === JSON.stringify({ text: 'Open Sunday', href: '/hours' }), `链接没写文字 ⟹ 整句是链接（读到 ${JSON.stringify(noLabel)}）`);
  const noHref = msgOf({ message: 'Open Sunday', link: { label: 'More', href: '' } }).message;
  check(JSON.stringify(noHref) === JSON.stringify({ text: 'Open Sunday' }), `链接没写地址 ⟹ 纯文字，label 不留（读到 ${JSON.stringify(noHref)}）`);
  for (const bad of ['javascript:alert(1)', 'vbscript:msgbox(1)', 'data:text/html,x', 'java\tscript:alert(1)']) {
    const m = msgOf({ message: 'Open Sunday', link: { label: 'Go', href: bad } }).message;
    check(JSON.stringify(m) === JSON.stringify({ text: 'Open Sunday' }), `链接地址是 ${JSON.stringify(bad)}（写盘那一关会拒的）⟹ 只画字，不带链接（读到 ${JSON.stringify(m)}）`);
  }
  const zh = msgOf({ message: '周日营业', link: { label: '看看', href: '/hours' } }, { locale: 'zh', defaultLocale: 'en' }).message;
  check(zh && zh.href === '/zh/hours', `副语言那一份链接加 /zh 前缀（读到 ${zh && zh.href}）`);
  for (const [name, tb] of [['没有 topbar', undefined], ['topbar 是字符串', 'hello'], ['message / link 都空', { message: '  ', link: { label: '', href: '' } }], ['只有 label 没有地址', { message: '', link: { label: 'x', href: '' } }]]) {
    const t = msgOf(tb);
    check(!('message' in t) && JSON.stringify(t) === JSON.stringify({ contact: [{ source: 'phone' }, { source: 'email' }] }),
      `${name} ⟹ 不写这一格，topbar 跟改前逐字相同（读到 ${JSON.stringify(t)}）`);
  }
}

console.log('── ③c 老板能写的三格（#1529）：写了照派生，没写 / 写坏了就不进 data');
{
  const der = (edit, extra = {}) => {
    const nav = JSON.parse(JSON.stringify(NAV)); edit(nav);
    return shellDataFor({ nav, brand: BRAND, brandName: 'x', services: [], pages: [], year: 2026, ...extra });
  };
  // header.ctaSecondary
  const sec = der((n) => { n.header.ctaSecondary = { label: ' Call us ', href: '/contact' }; }).header.ctaSecondary;
  check(JSON.stringify(sec) === JSON.stringify({ label: 'Call us', href: '/contact', style: 'outline' }), `header.ctaSecondary → ctaSecondary，补 style: outline（读到 ${JSON.stringify(sec)}）`);
  for (const [name, v] of [['没有 label', { label: '', href: '/c' }], ['没有 href', { label: 'Call', href: '  ' }], ['是字符串', 'Call'], ['是数组', [{ label: 'a', href: '/a' }]]]) {
    check(!('ctaSecondary' in der((n) => { n.header.ctaSecondary = v; }).header), `header.ctaSecondary ${name} ⟹ 不进 data`);
  }
  // footer.legal
  const legal = der((n) => { n.footer.legal = [{ label: 'Privacy policy', href: '/privacy' }, { label: '', href: '/x' }, null, { label: 'Terms', href: 'https://x.com/terms' }]; }).footer.legal;
  check(JSON.stringify(legal) === JSON.stringify([{ label: 'Privacy policy', href: '/privacy' }, { label: 'Terms', href: 'https://x.com/terms' }]),
    `footer.legal → legal，缺字段 / null 的那几项去掉（读到 ${JSON.stringify(legal)}）`);
  for (const [name, v] of [['空数组', []], ['全是坏项', [{ label: '' }, 'x']], ['是对象', { label: 'P', href: '/p' }]]) {
    check(!('legal' in der((n) => { n.footer.legal = v; }).footer), `footer.legal ${name} ⟹ 不进 data`);
  }
  // footer.cta
  const full = der((n) => { n.footer.cta = { title: 'Ready for a new roof?', subtitle: 'Free estimates.', buttons: [{ label: 'Get a quote', href: '/quote', style: 'solid' }, { label: 'Call', href: 'tel:+14165550000', style: 'outline' }, { label: '', href: '/x' }] }; });
  check(JSON.stringify(full.footer.cta) === JSON.stringify({ title: 'Ready for a new roof?', subtitle: 'Free estimates.', buttons: [{ label: 'Get a quote', href: '/quote', style: 'solid' }, { label: 'Call', href: 'tel:+14165550000', style: 'outline' }] }),
    `footer.cta → cta，没字的按钮去掉（读到 ${JSON.stringify(full.footer.cta)}）`);
  check(full.notes.length === 0, '合法的 cta 不产生 notes');
  const bare = der((n) => { n.footer.cta = { title: 'Ready?' }; }).footer.cta;
  check(JSON.stringify(bare) === JSON.stringify({ title: 'Ready?' }), `只有 title ⟹ {title}，不造 subtitle / buttons（读到 ${JSON.stringify(bare)}）`);
  const badStyle = der((n) => { n.footer.cta = { title: 'Ready?', buttons: [{ label: 'Go', href: '/go', style: 'primary' }, { label: 'More', href: '/more' }] }; });
  check(JSON.stringify(badStyle.footer.cta.buttons) === JSON.stringify([{ label: 'Go', href: '/go' }, { label: 'More', href: '/more' }]),
    `style 不在 solid | outline | link 里 ⟹ 丢掉 style 那一格、按钮照留（读到 ${JSON.stringify(badStyle.footer.cta.buttons)}）`);
  check(badStyle.notes.length === 1 && /buttons\[0\]\.style = "primary"/.test(badStyle.notes[0]), `丢的时候记一行 notes（PM：别静默丢；读到 ${JSON.stringify(badStyle.notes)}）`);
  for (const [name, v] of [['没有 title', { subtitle: 's', buttons: [{ label: 'a', href: '/a' }] }], ['title 只有空白', { title: '   ' }], ['是字符串', 'Ready?']]) {
    check(!('cta' in der((n) => { n.footer.cta = v; }).footer), `footer.cta ${name} ⟹ 不进 data（块没标题就不画这一条）`);
  }
  // 写盘那一关会拒的地址（#1529 之前这三格不在那一关里）⟹ 当没写。
  for (const bad of ['javascript:alert(1)', 'vbscript:msgbox(1)', 'data:text/html,x', 'java\tscript:alert(1)', ' /contact']) {
    const x = der((n) => {
      n.header.ctaSecondary = { label: 'C', href: bad };
      n.footer.legal = [{ label: 'P', href: '/privacy' }, { label: 'T', href: bad }];
      n.footer.cta = { title: 'R', buttons: [{ label: 'Q', href: bad }, { label: 'Ok', href: '/ok' }] };
    });
    check(!('ctaSecondary' in x.header) && JSON.stringify(x.footer.legal) === JSON.stringify([{ label: 'P', href: '/privacy' }])
      && JSON.stringify(x.footer.cta.buttons) === JSON.stringify([{ label: 'Ok', href: '/ok' }]),
      `地址 ${JSON.stringify(bad)} ⟹ 三格里那一项都不进 data（读到 ${JSON.stringify([x.header.ctaSecondary, x.footer.legal, x.footer.cta])}）`);
  }
  // 副语言：三格里的站内链接都加 /zh，站外 / tel: 不动（判据形状照 ⑦）。
  const zh = der((n) => {
    n.header.ctaSecondary = { label: 'C', href: '/contact' };
    n.footer.legal = [{ label: 'P', href: '/privacy' }, { label: 'T', href: 'https://x.com/terms' }];
    n.footer.cta = { title: 'R', buttons: [{ label: 'Q', href: '/quote' }, { label: 'Call', href: 'tel:+1416' }] };
  }, { locale: 'zh', defaultLocale: 'en' });
  const zhHrefs = [zh.header.ctaSecondary.href, ...zh.footer.legal.map((l) => l.href), ...zh.footer.cta.buttons.map((b) => b.href)];
  check(JSON.stringify(zhHrefs) === JSON.stringify(['/zh/contact', '/zh/privacy', 'https://x.com/terms', '/zh/quote', 'tel:+1416']),
    `zh：三格的站内链接加 /zh，站外 / tel: 不动（读到 ${zhHrefs.join(' ')}）`);
}

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
