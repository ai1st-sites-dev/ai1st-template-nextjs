#!/usr/bin/env node
// shell-data.test.js —— 顶栏 / 页脚 data 的构建期派生（#1425 T3，`scripts/lib/shell-data.js`）。
//
// 跑法:  node scripts/lib/shell-data.test.js        退出码: 0 全过 · 1 有失败
//
// 判据都来自 PM 2026-10-02 在 #1425 上的裁定 ①：
//   · 映射 header.links → nav · header.buttons → buttons（#1787，样子按位置补）· footer.columns[0].links → nav · brand.logoUrl → logo · 生意名 → brandName；
//   · 联系方式 / 社交写成引用，不抄值；
//   · 派生不到的维度（columns.areas · form · topbar.links / topbar.social）不造数据。
//   · #1528：navigation.json 的 `topbar`（老公告条那句话）接回 header 的 `topbar.message`。
//   · #1529：navigation.json 里老板写了的 footer.legal 照派生，没写就不进 data。
//   · #1787：顶栏按钮是 0–3 颗的列表，第 1 / 2 / 3 颗补 solid / outline / link，画不出的那颗去掉（后面的不换样子）。
//   · #1648：页脚没有 CTA 条了 —— navigation.json 里残留的 footer.cta 不派生、不报错、不产生 notes。
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
  header: { links: [{ label: 'Home', href: '/' }, { label: 'About', href: '/about' }, { label: '', href: '/x' }], buttons: [{ label: 'Get a Quote', href: '/quote' }] },
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
check(JSON.stringify(d.header.buttons) === JSON.stringify([{ label: 'Get a Quote', href: '/quote', style: 'solid', at: 0 }]), `header.buttons → buttons，第 1 颗实心（读到 ${JSON.stringify(d.header.buttons)}）`);
check(d.header.logo === '/logo.svg' && d.footer.logo === '/logo.svg', 'brand.logoUrl → 两个区的 logo');
// #1784 —— brand.logoHasWordmark → 两个区的 logoHasWordmark（logoType 没存时的默认据它）；只在为真、而且有图时带。
check(!('logoHasWordmark' in d.header) && !('logoHasWordmark' in d.footer), '#1784：brand 没写 logoHasWordmark ⟹ 两个区都没有这一格');
const dw = shellDataFor({ nav: NAV, brand: { ...BRAND, logoHasWordmark: true }, brandName: 'N', services: SERVICES, pages: PAGES, year: 2026 });
check(dw.header.logoHasWordmark === true && dw.footer.logoHasWordmark === true, '#1784：logoHasWordmark=true ⟹ 两个区都带 true');
const df = shellDataFor({ nav: NAV, brand: { ...BRAND, logoHasWordmark: false }, brandName: 'N', services: SERVICES, pages: PAGES, year: 2026 });
check(!('logoHasWordmark' in df.header) && !('logoHasWordmark' in df.footer), '#1784：logoHasWordmark=false（AI 图标 logo）⟹ 不带');
const dn = shellDataFor({ nav: NAV, brand: { ...BRAND, logoUrl: '', logoHasWordmark: true }, brandName: 'N', services: SERVICES, pages: PAGES, year: 2026 });
check(!('logoHasWordmark' in dn.header) && !('logo' in dn.header), '#1784：没有图 ⟹ 不带（没图本来就照店名画）');
check(d.header.brandName === 'Northside Auto Care' && d.footer.brandName === 'Northside Auto Care', '生意名 → 两个区的 brandName');
check(JSON.stringify(d.footer.nav) === JSON.stringify(NAV.footer.columns[0].links), 'footer.columns[0].links → footer.nav');
check(d.footer.tagline === NAV.footer.description, 'footer.description → tagline');
check(JSON.stringify(d.footer.columns.services) === JSON.stringify([{ label: 'Brakes', href: '/services/brakes' }, { label: 'Tires', href: '/services#tires' }]),
  `服务栏：有详情页去详情页、没有就落到服务页那一节、没 id 的不要（读到 ${JSON.stringify(d.footer.columns.services)}）`);

console.log('── ② 联系方式 / 社交是引用，不是抄进来的值（Chris 2026-09-30 #1506）');
// #1780 —— 没写 `header.topbarLinks` ⟹ 默认那两项；每项带 `at`（在老板列表里的下标，编辑器画布靠它对回那一项）。
const DEFAULT_CONTACT = [{ source: 'phone', at: 0 }, { source: 'email', at: 1 }];
check(JSON.stringify(d.header.topbar.contact) === JSON.stringify(DEFAULT_CONTACT), 'header.topbar.contact 是 phone / email 两个引用');
check(JSON.stringify(d.footer.contact) === JSON.stringify({ source: 'brand' }) && JSON.stringify(d.footer.social) === JSON.stringify({ source: 'social' }), 'footer.contact / social 是整槽引用');
const flat = JSON.stringify(d);
check(!flat.includes('416-555-0000') && !flat.includes('hi@example.com') && !flat.includes('facebook.com'),
  '派生结果里一个电话 / 邮箱 / 社交网址的字面值都没有');

console.log('── ③ 派生不到的不造（PM 裁定 ①）');
for (const k of ['legal', 'cta', 'form', 'bg', 'options']) check(!(k in d.footer), `footer 没有 ${k}（NAV 里没写 legal / cta）`);
check(!('areas' in d.footer.columns), 'footer.columns 没有 areas');
for (const k of ['bg', 'options']) check(!(k in d.header), `header 没有 ${k}`);
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
    check(!('message' in t) && JSON.stringify(t) === JSON.stringify({ contact: DEFAULT_CONTACT }),
      `${name} ⟹ 不写这一格，topbar 跟改前逐字相同（读到 ${JSON.stringify(t)}）`);
  }
}

console.log('── ③c 老板能写的几格（#1529 · #1787 按钮列表）：写了照派生，没写 / 写坏了就不进 data · 残留的 footer.cta 被忽略（#1648）');
{
  const der = (edit, extra = {}) => {
    const nav = JSON.parse(JSON.stringify(NAV)); edit(nav);
    return shellDataFor({ nav, brand: BRAND, brandName: 'x', services: [], pages: [], year: 2026, ...extra });
  };
  // header.buttons（#1787）：样子按位置补；画不出的那颗去掉，后面那颗的样子和 at 不变（at = 老板列表里的下标）。
  const three = der((n) => { n.header.buttons = [{ label: ' Get a quote ', href: '/contact' }, { label: 'Call us', href: '/call' }, { label: 'Book online', href: 'https://book.example.com' }]; }).header.buttons;
  check(JSON.stringify(three) === JSON.stringify([
    { label: 'Get a quote', href: '/contact', style: 'solid', at: 0 },
    { label: 'Call us', href: '/call', style: 'outline', at: 1 },
    { label: 'Book online', href: 'https://book.example.com', style: 'link', at: 2 },
  ]), `3 颗 ⟹ 实心 · 描边 · 文字链接样，去首尾空格（读到 ${JSON.stringify(three)}）`);
  const holed = der((n) => { n.header.buttons = [{ label: 'A', href: '/a' }, { label: '', href: '/b' }, { label: 'C', href: '/c' }]; }).header.buttons;
  check(JSON.stringify(holed) === JSON.stringify([{ label: 'A', href: '/a', style: 'solid', at: 0 }, { label: 'C', href: '/c', style: 'link', at: 2 }]),
    `中间那颗画不出 ⟹ 去掉，第 3 颗仍是文字链接样、at=2（读到 ${JSON.stringify(holed)}）`);
  check(JSON.stringify(der((n) => { n.header.buttons = []; }).header.buttons) === '[]', '0 颗 ⟹ buttons 是空数组');
  check(JSON.stringify(der((n) => { delete n.header.buttons; }).header.buttons) === '[]', 'buttons 这一格不在（#1787 之前的站）⟹ 空数组，不抛');
  const four = der((n) => { n.header.buttons = ['a', 'b', 'c', 'd'].map((x) => ({ label: x, href: `/${x}` })); }).header.buttons;
  check(four.map((b) => b.label).join('') === 'abc', `超过 3 颗 ⟹ 只画前 3 颗（读到 ${four.map((b) => b.label).join('')}）`);
  for (const [name, v] of [['没有 label', { label: '', href: '/c' }], ['没有 href', { label: 'Call', href: '  ' }], ['是字符串', 'Call'], ['是数组', [{ label: 'a', href: '/a' }]]]) {
    check(der((n) => { n.header.buttons = [v]; }).header.buttons.length === 0, `header.buttons 里那一颗${name} ⟹ 不进 data`);
  }
  check(der((n) => { n.header.buttons = { label: 'A', href: '/a' }; }).header.buttons.length === 0, 'header.buttons 是对象不是数组 ⟹ 空数组');
  // footer.legal
  const legal = der((n) => { n.footer.legal = [{ label: 'Privacy policy', href: '/privacy' }, { label: '', href: '/x' }, null, { label: 'Terms', href: 'https://x.com/terms' }]; }).footer.legal;
  check(JSON.stringify(legal) === JSON.stringify([{ label: 'Privacy policy', href: '/privacy' }, { label: 'Terms', href: 'https://x.com/terms' }]),
    `footer.legal → legal，缺字段 / null 的那几项去掉（读到 ${JSON.stringify(legal)}）`);
  for (const [name, v] of [['空数组', []], ['全是坏项', [{ label: '' }, 'x']], ['是对象', { label: 'P', href: '/p' }]]) {
    check(!('legal' in der((n) => { n.footer.legal = v; }).footer), `footer.legal ${name} ⟹ 不进 data`);
  }
  // #1648 —— 残留的 footer.cta：页脚已经没有 CTA 条，构建不派生它，也不因为它报错 / 记 notes（#1529 那时会记的坏 style
  //    也不再记：没人画它，说「按钮用默认样式」是假话）。同一份 navigation 里的 legal 照常派生 = 阳性对照（der 真的跑了）。
  for (const [name, v] of [
    ['完整的一份', { title: 'Ready for a new roof?', subtitle: 'Free estimates.', buttons: [{ label: 'Get a quote', href: '/quote', style: 'solid' }] }],
    ['style 不认识', { title: 'Ready?', buttons: [{ label: 'Go', href: '/go', style: 'primary' }] }],
    ['地址被白名单拒', { title: 'R', buttons: [{ label: 'Q', href: 'javascript:alert(1)' }] }],
    ['是字符串', 'Ready?'],
  ]) {
    let x;
    try {
      x = der((n) => { n.footer.cta = v; n.footer.legal = [{ label: 'Privacy', href: '/privacy' }]; });
    } catch (e) { check(false, `footer.cta ${name} ⟹ 派生不抛`, e.message); continue; }
    check(!('cta' in x.footer) && x.notes.length === 0 && JSON.stringify(x.footer.legal) === JSON.stringify([{ label: 'Privacy', href: '/privacy' }]),
      `残留的 footer.cta（${name}）⟹ 页脚 data 里没有 cta、notes 为空；同一份里的 legal 照常派生（读到 cta=${JSON.stringify(x.footer.cta)} notes=${JSON.stringify(x.notes)}）`);
  }
  // 写盘那一关会拒的地址（#1529 之前这两格不在那一关里）⟹ 当没写。
  for (const bad of ['javascript:alert(1)', 'vbscript:msgbox(1)', 'data:text/html,x', 'java\tscript:alert(1)', ' /contact']) {
    const x = der((n) => {
      n.header.buttons = [{ label: 'C', href: bad }, { label: 'D', href: '/d' }];
      n.footer.legal = [{ label: 'P', href: '/privacy' }, { label: 'T', href: bad }];
    });
    check(JSON.stringify(x.header.buttons) === JSON.stringify([{ label: 'D', href: '/d', style: 'outline', at: 1 }])
      && JSON.stringify(x.footer.legal) === JSON.stringify([{ label: 'P', href: '/privacy' }]),
      `地址 ${JSON.stringify(bad)} ⟹ 两格里那一项都不进 data（读到 ${JSON.stringify([x.header.buttons, x.footer.legal])}）`);
  }
  // 副语言：两格里的站内链接都加 /zh，站外不动（判据形状照 ⑦）。
  const zh = der((n) => {
    n.header.buttons = [{ label: 'C', href: '/contact' }, { label: 'B', href: 'https://book.example.com' }];
    n.footer.legal = [{ label: 'P', href: '/privacy' }, { label: 'T', href: 'https://x.com/terms' }];
  }, { locale: 'zh', defaultLocale: 'en' });
  const zhHrefs = [...zh.header.buttons.map((b) => b.href), ...zh.footer.legal.map((l) => l.href)];
  check(JSON.stringify(zhHrefs) === JSON.stringify(['/zh/contact', 'https://book.example.com', '/zh/privacy', 'https://x.com/terms']),
    `zh：两格的站内链接加 /zh，站外不动（读到 ${zhHrefs.join(' ')}）`);
}

console.log('── ④ 版权行');
check(d.footer.copyright === '© 2026 Northside Auto Care. All rights reserved.', `不带 © 的补上「© 年份」（读到 ${d.footer.copyright}）`);
const withSign = shellDataFor({ nav: { ...NAV, footer: { ...NAV.footer, copyright: '© 2026 Demo Company. All rights reserved.' } }, brand: BRAND, brandName: 'x', services: [], pages: [], year: 2026 });
check(withSign.footer.copyright === '© 2026 Demo Company. All rights reserved.', '已经带 © 的照原样（不印两遍 ©）');

console.log('── ⑤ 空输入不抛、不造');
const empty = shellDataFor({});
check(Array.isArray(empty.header.nav) && empty.header.nav.length === 0 && Array.isArray(empty.header.buttons) && empty.header.buttons.length === 0
  && !('copyright' in empty.footer) && !('logo' in empty.header),
  '什么都没给：nav 空、buttons 空、没有 copyright / logo');

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
  const hrefs = (x) => [...x.header.nav, ...x.header.buttons, ...x.footer.nav, ...x.footer.columns.services].map((l) => l.href);
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

console.log('── ⑧ #1632：关键词页栏从当前页面现算（columns.keywordGroups），不读 navigation.json 的 footer.columns[1..]');
{
  const KW = [
    { slug: 'home' },
    { slug: 'about' },
    { slug: 'services/brakes' }, // 服务详情页：不是关键词页
    { slug: 'services/brakes/brake-repair-toronto', title: 'Brake repair Toronto', navOrder: 51 },
    { slug: 'services/brakes/cheap-brakes', title: 'Cheap brakes', navOrder: 50 },
    { slug: 'services/tires/winter-tires', title: 'Winter tires', navOrder: 50 },
  ];
  const d8 = shellDataFor({ nav: NAV, brand: BRAND, brandName: 'x', services: SERVICES, pages: KW, year: 2026 });
  const g = d8.footer.columns.keywordGroups || [];
  // #1739 —— 每组多带 `href` = 它那个服务在 `columns.services` 里的地址（有详情页去详情页，没有落到服务页那一节）。
  check(JSON.stringify(g) === JSON.stringify([
    { title: 'Brakes', href: '/services/brakes', links: [{ label: 'Cheap brakes', href: '/services/brakes/cheap-brakes' }, { label: 'Brake repair Toronto', href: '/services/brakes/brake-repair-toronto' }] },
    { title: 'Tires', href: '/services#tires', links: [{ label: 'Winter tires', href: '/services/tires/winter-tires' }] },
  ]), `每个服务一栏、栏名取服务名、栏内按 navOrder、链接就是那几页、带服务页地址：${JSON.stringify(g)}`);
  check(g.every((x) => d8.footer.columns.services.some((s) => s.href === x.href)), '每组的 href 都能在 columns.services 里找到同一个地址（块按它配对）');
  const all = g.flatMap((x) => x.links.map((l) => l.href));
  check(!all.includes('/brakes/pads'), 'navigation.json 第 1 栏里那条页面里没有的链接（/brakes/pads）不出现');
  check(!all.some((h) => h === '/about' || h === '/' || h === '/services/brakes'), '首页、普通页、服务详情页都不进关键词栏（先去掉首页再 isKeywordPage）');
  // 页面变了，栏跟着变 —— navigation.json 一个字节没改（建站之后增删页那条路）。
  const after = shellDataFor({ nav: NAV, brand: BRAND, brandName: 'x', services: SERVICES, year: 2026,
    pages: KW.filter((p) => p.slug !== 'services/brakes/cheap-brakes').concat([{ slug: 'services/tires/all-season', title: 'All season', navOrder: 51 }]) });
  const afterH = (after.footer.columns.keywordGroups || []).flatMap((x) => x.links.map((l) => l.href));
  check(!afterH.includes('/services/brakes/cheap-brakes') && afterH.includes('/services/tires/all-season'), `删掉的那页没了、新加的那页出现了：${afterH.join(' ')}`);
  // 副语言：链接加 /<locale> 前缀，栏名照服务名。
  const zh8 = shellDataFor({ nav: NAV, brand: BRAND, brandName: 'x', services: SERVICES, pages: KW, locale: 'zh', defaultLocale: 'en', year: 2026 });
  const zhH = (zh8.footer.columns.keywordGroups || []).flatMap((x) => x.links.map((l) => l.href));
  check(zhH.length === 3 && zhH.every((h) => h.startsWith('/zh/services/')), `副语言（zh）关键词页链接都带 /zh：${zhH.join(' ')}`);
  const zhG = zh8.footer.columns.keywordGroups || [];
  check(zhG.map((x) => x.href).join(' ') === '/zh/services/brakes /zh/services#tires'
    && zhG.every((x) => zh8.footer.columns.services.some((s) => s.href === x.href)), `#1739 副语言（zh）组的 href 也带 /zh、跟服务栏同一个地址：${zhG.map((x) => x.href).join(' ')}`);
  // #1739 —— 挂不上服务的组不带 href：老形状 `<服务slug>/<词>`，以及 id 在服务目录里没有的那种。
  const orphan = shellDataFor({ nav: NAV, brand: BRAND, brandName: 'x', services: SERVICES, year: 2026, pages: [
    { slug: 'services/brakes/cheap-brakes', title: 'Cheap brakes', navOrder: 50, keyword: 'cheap brakes' },
    { slug: 'oil-change/oil-change-toronto', title: 'Oil change Toronto', navOrder: 50, keyword: 'oil change toronto' },
    { slug: 'services/glass/windshield-repair', title: 'Windshield repair', navOrder: 50, keyword: 'windshield repair' },
  ] }).footer.columns.keywordGroups || [];
  const byTitle = Object.fromEntries(orphan.map((x) => [x.title, x]));
  check(orphan.length === 3 && byTitle.Brakes && byTitle.Brakes.href === '/services#brakes'
    && byTitle['Oil Change'] && !('href' in byTitle['Oil Change']) && byTitle.Glass && !('href' in byTitle.Glass),
  `#1739 挂得上服务的组带 href；老形状 / 服务目录里没有的 id 那两组没有 href 这个键：${JSON.stringify(orphan.map((x) => [x.title, x.href]))}`);
  // 11 个关键词页：10 条，最后一条「全部 11 页 →」指向服务详情页。
  const many = Array.from({ length: 11 }, (_, i) => ({ slug: `services/brakes/w${i}`, title: `W${i}`, navOrder: 50 + i }));
  const g11 = shellDataFor({ nav: NAV, brand: BRAND, brandName: 'x', services: SERVICES, pages: many, year: 2026 }).footer.columns.keywordGroups[0].links;
  check(g11.length === 10 && /11/.test(g11[9].label) && g11[9].href === '/services/brakes', `11 页 ⟹ 10 条，最后一条是「${g11[9].label}」→ ${g11[9].href}`);
  // 没有关键词页：键不存在（不是空数组）。
  check(!('keywordGroups' in d.footer.columns), `没有关键词页 ⟹ columns 里没有 keywordGroups 这个键（${Object.keys(d.footer.columns).join(',')}）`);
}

console.log('── ③d 顶栏按钮的 href 写成电话 / 邮箱引用（#1779）：原样交下去，外壳渲染前展开成 tel: / mailto:');
{
  const { resolveItemSources } = require('./item-sources');
  const der = (edit) => {
    const nav = JSON.parse(JSON.stringify(NAV)); edit(nav);
    return shellDataFor({ nav, brand: BRAND, brandName: 'x', services: [], pages: [], year: 2026, locale: 'fr', defaultLocale: 'en' });
  };
  const x = der((n) => { n.header.buttons = [{ label: 'Call us', href: { source: 'phone' } }, { label: 'Email us', href: { source: 'email' } }]; });
  check(JSON.stringify(x.header.buttons) === JSON.stringify([
    { label: 'Call us', href: { source: 'phone' }, style: 'solid', at: 0 }, { label: 'Email us', href: { source: 'email' }, style: 'outline', at: 1 },
  ]), `两颗按钮的引用原样进 data（不加语言前缀、不被吞掉）：${JSON.stringify(x.header.buttons)}`);
  // 外壳那一步（SiteShell §shellBlockData）跟页面块同一个 resolveItemSources：展开成 brand.json 里那个号码 / 邮箱。
  const [b] = resolveItemSources([{ type: 'header', data: x.header }], { brand: BRAND, log: () => {} });
  check(b.data.buttons[0].href === 'tel:4165550000', `第 1 颗展开成 brand.json 第一家的电话 tel:4165550000（读到 ${b.data.buttons[0].href}）`);
  check(b.data.buttons[1].href === 'mailto:hi@example.com', `第 2 颗展开成 mailto:hi@example.com（读到 ${b.data.buttons[1].href}）`);
  for (const [name, v] of [['源不认识（address）', { source: 'address' }], ['多一个键', { source: 'phone', x: 1 }], ['空对象', {}]]) {
    const y = der((n) => { n.header.buttons = [{ label: 'Call', href: v }, { label: 'Call', href: v }]; });
    check(y.header.buttons.length === 0, `按钮 href ${name} ⟹ 两颗都不进 data（读到 ${JSON.stringify(y.header.buttons)}）`);
  }
}

console.log('── ③e 顶栏社交图标（#1785）：站里有带网址的社交链接才写 header.social（整槽引用），展开后顺序同存的那一份、X 画 twitter-x');
{
  const { resolveItemSources } = require('./item-sources');
  const withBrand = (socialLinks) => shellDataFor({ nav: NAV, brand: { ...BRAND, socialLinks }, brandName: 'x', services: [], pages: [], year: 2026 });
  const two = [{ platform: 'instagram', url: 'https://instagram.com/n' }, { platform: 'x', url: 'https://x.com/n' }, { platform: 'facebook', url: 'https://facebook.com/n' }];
  const d2 = withBrand(two);
  check(JSON.stringify(d2.header.social) === JSON.stringify({ source: 'social' }), `有社交链接 ⟹ header.social 是整槽引用（读到 ${JSON.stringify(d2.header.social)}）`);
  const [h] = resolveItemSources([{ type: 'header', data: d2.header }], { brand: { ...BRAND, socialLinks: two }, log: () => {} });
  const got = (h.data.social || []).map((x) => `${x.icon} ${x.href}`);
  check(JSON.stringify(got) === JSON.stringify(['instagram https://instagram.com/n', 'twitter-x https://x.com/n', 'facebook https://facebook.com/n']),
    `展开：顺序同存的那一份，X 的图标是 twitter-x（不是关闭叉 x）：${JSON.stringify(got)}`);
  const [f] = resolveItemSources([{ type: 'footer', data: d2.footer }], { brand: { ...BRAND, socialLinks: two }, log: () => {} });
  check(JSON.stringify((f.data.social || []).map((x) => x.icon)) === JSON.stringify(['instagram', 'twitter-x', 'facebook']), '页脚同一份、同一个顺序、同一套图标');
  for (const [name, v] of [['没有这个键', undefined], ['空数组', []], ['空对象', {}], ['只有一条没网址的', [{ platform: 'facebook', url: '  ' }]]]) {
    check(!('social' in withBrand(v).header), `社交链接${name} ⟹ header 没有 social 这个键（不写空数组占位）`);
  }
  check(JSON.stringify(withBrand({ facebook: 'https://facebook.com/x' }).header.social) === JSON.stringify({ source: 'social' }), '老形状（对象 {platform: url}）也认');
  check(!('social' in d2.header.topbar), 'topbar 里照旧不写 social（顶条里画不画由组件按版式定，数据只有 header.social 一份）');
}

console.log('── ③f 平台清单（#1785 r5，Chris 2026-10-15 加 Pinterest / Threads / Telegram / Medium）：13 个、顺序和叫法照定稿；每个都有占位字、图标在 bootstrap-icons 里真有、并且进了顶栏 / 页脚的常备图标表');
{
  const fs = require('fs');
  const { SOCIAL_PLATFORMS, socialIcon } = require('./item-sources');
  const { BLOCK_ICONS, readIcon, ICON_DIR } = require('./icons');
  const want = ['Facebook', 'Instagram', 'Google', 'X', 'LinkedIn', 'YouTube', 'TikTok', 'WhatsApp', 'Yelp', 'Pinterest', 'Threads', 'Telegram', 'Medium'];
  check(JSON.stringify(SOCIAL_PLATFORMS.map((p) => p.label)) === JSON.stringify(want), `13 个，顺序和叫法照定稿：${JSON.stringify(SOCIAL_PLATFORMS.map((p) => p.label))}`);
  check(SOCIAL_PLATFORMS.every((p) => typeof p.placeholder === 'string' && p.placeholder.startsWith('https://')), '每个平台都有以 https:// 开头的占位字');
  const ph = Object.fromEntries(SOCIAL_PLATFORMS.map((p) => [p.platform, p.placeholder]));
  check(ph.youtube === 'https://youtube.com/@yourchannel' && ph.pinterest === 'https://pinterest.com/yourname' && ph.threads === 'https://threads.net/@yourname'
    && ph.telegram === 'https://t.me/yourname' && ph.medium === 'https://medium.com/@yourname', '占位字逐字照 Chris 那张表（抽 5 个）');
  const dir = ICON_DIR;
  const missing = SOCIAL_PLATFORMS.map((p) => socialIcon(p.platform)).filter((n) => !fs.existsSync(path.join(dir, `${n}.svg`)) || !readIcon(n, { warn: () => {} }));
  check(missing.length === 0, `每个平台的图标在装着的 bootstrap-icons 里都有（不会落回 link-45deg）：缺 ${JSON.stringify(missing)}`);
  for (const r of ['header', 'footer']) {
    const absent = ['pinterest', 'threads', 'telegram', 'medium'].filter((n) => !BLOCK_ICONS[r].includes(n));
    check(absent.length === 0, `${r} 的常备图标表带上了四个新平台（编辑器里刚加、没重建时画布也画得对）：缺 ${JSON.stringify(absent)}`);
  }
}

console.log(`\n══ 汇总: 通过 ${pass} · 失败 ${fail} ══`);
process.exit(fail ? 1 : 0);
