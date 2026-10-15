'use strict';

// topbar-links.test.js —— #1780 顶栏上面那一行的链接列表：派生（§topbarContact）· 展开（item-sources §resolveItemSlots 认 label / at）·
//   能不能存（§topbarLinksProblem，编辑器 Done 和写盘同一句）· 写盘（editor-root：读默认值、写 header.topbarLinks、拒收）· 画布预览
//   （nav-editor §liveShellData）。跑：node scripts/lib/topbar-links.test.js

const fs = require('fs');
const os = require('os');
const path = require('path');

const tl = require('./topbar-links');
const { shellDataFor } = require('./shell-data');
const { resolveItemSources, contactRefProblems } = require('./item-sources');
const editorRoot = require('./editor-root');
const { liveShellData } = require('./nav-editor');
const { linksOf, linkRejection } = require('./link-href');

let pass = 0;
let fail = 0;
function check(ok, name) {
  if (ok) { pass += 1; console.log(`  ✅ ${name}`); } else { fail += 1; console.log(`  ❌ ${name}`); }
}
const J = (v) => JSON.stringify(v);

const BRAND = { email: 'hi@northside.test', locations: [{ phone: '+1 416 555 0100', address: '1 Main St' }] };
const ctx = { brand: BRAND, services: [], pages: [], url: (s) => `/${s}`, log: () => {} };
/** 一份列表 → 页面上画出来的 contact（派生 + 展开，同构建 / SiteShell 那条路）。 */
function rendered(list, brand = BRAND, loc) {
  const nav = { header: { links: [], buttons: [{ label: 'Go', href: '/contact' }], ...(list === undefined ? {} : { topbarLinks: list }) }, footer: {} };
  const d = shellDataFor({ nav, brand, brandName: 'Northside', services: [], pages: [], year: 2026, ...(loc || {}) });
  const [h] = resolveItemSources([{ type: 'header', data: d.header }], { ...ctx, brand });
  return h.data.topbar.contact;
}

console.log('── ① 没写过 = 今天的样子（电话 + 邮箱），老站不变');
check(J(rendered(undefined)) === J([
  { icon: 'telephone', text: '+1 416 555 0100', href: 'tel:+14165550100', at: 0 },
  { icon: 'envelope', text: 'hi@northside.test', href: 'mailto:hi@northside.test', at: 1 },
]), `没有 topbarLinks ⟹ 电话 + 邮箱（读到 ${J(rendered(undefined))}）`);
check(J(tl.topbarLinksOf(undefined)) === J(tl.DEFAULT_TOPBAR_LINKS) && tl.topbarLinksOf(undefined) !== tl.DEFAULT_TOPBAR_LINKS,
  '§topbarLinksOf 没写过 ⟹ 默认两项的一份新拷贝（改它不会改到默认值）');

console.log('── ② 怎么画（正文做什么 2 那张表）');
{
  const c = rendered([
    { label: 'Call us', href: { source: 'phone' } },
    { label: '', href: { source: 'email' } },
    { label: 'Book', href: 'https://example.com' },
  ]);
  check(J(c[0]) === J({ icon: 'telephone', text: 'Call us', href: 'tel:+14165550100', at: 0 }), `电话引用 + label ⟹ 电话图标、字是 label、tel: 网站电话（${J(c[0])}）`);
  check(J(c[1]) === J({ icon: 'envelope', text: 'hi@northside.test', href: 'mailto:hi@northside.test', at: 1 }), `邮箱引用、label 空 ⟹ 显示网站邮箱（${J(c[1])}）`);
  check(J(c[2]) === J({ icon: 'link-45deg', text: 'Book', href: 'https://example.com', at: 2 }), `外部链接 + label ⟹ 链接图标 + label（${J(c[2])}）`);
}
{
  const c = rendered([{ label: '', href: 'tel:+15550001' }, { label: 'Mail', href: 'mailto:a@b.test' }, { label: 'About', href: '/about' }],
    BRAND, { locale: 'fr', defaultLocale: 'en' });
  check(J(c) === J([
    { icon: 'telephone', text: '+15550001', href: 'tel:+15550001', at: 0 },
    { icon: 'envelope', text: 'Mail', href: 'mailto:a@b.test', at: 1 },
    { icon: 'link-45deg', text: 'About', href: '/fr/about', at: 2 },
  ]), `另填的号码 label 空 ⟹ 显示号码本身；站内页按语言加前缀（${J(c)}）`);
}
{
  // 引用指向的值不存在 ⟹ 那一项不画；后面那一项的 at 仍是它在列表里的下标（画布点它对得上）。
  const c = rendered([{ label: 'Call', href: { source: 'phone' } }, { label: '', href: { source: 'email' } }], { email: 'x@y.test', locations: [] });
  check(J(c) === J([{ icon: 'envelope', text: 'x@y.test', href: 'mailto:x@y.test', at: 1 }]), `没有电话 ⟹ 电话那一项不画、邮箱 at=1（${J(c)}）`);
}
{
  const c = rendered([{ label: 'Bad', href: 'javascript:alert(1)' }, { label: '', href: 'https://example.com' }, { label: 'x', href: '' }, 'junk', { label: 'Ok', href: '/ok' }]);
  check(J(c) === J([{ icon: 'link-45deg', text: 'Ok', href: '/ok', at: 4 }]), `不过白名单 / 外部链接没字 / 没链接 / 不是对象 ⟹ 不画（${J(c)}）`);
}
check(J(rendered([])) === '[]', '清空的列表 ⟹ 一项都不画（编辑器那头不让存成这样，§③）');

console.log('── ③ 能不能存（编辑器 Done 和写盘同一句）');
const P = (list, shown = true) => tl.topbarLinksProblem(list, shown);
check(/at least one link/.test(P([])) && /without it/.test(P([])), `0 项 ⟹ 拒收，说改用不带 top bar 的版式（「${P([])}」）`);
// r1 QA2：版式不带这一行时一条都不判 —— 「换个不带 top bar 的版式」是拒收那句话给的出路，照着走要存得进去。
check(P([], false) === '' && P([{ label: '', href: 'https://' }], false) === '', '版式不带 top bar ⟹ 0 项 / 坏项都不拒（那一段不出、那一行不画）');
check(/could not be read/.test(P({ a: 1 }, false)), '不是数组 ⟹ 不管带不带都拒');
check(/at most 3/.test(P([1, 2, 3, 4].map(() => ({ label: 'a', href: '/a' })))), '4 项 ⟹ 拒收');
check(P(tl.DEFAULT_TOPBAR_LINKS) === '', '默认两项能存');
check(P([{ label: '', href: 'tel:+1555' }, { label: '', href: { source: 'email', location: 1 } }]) === '', '电话 / 邮箱 label 空能存（显示号码本身）');
check(/Link 1 .*needs a label/.test(P([{ label: '', href: 'https://example.com' }])), '外部链接没字 ⟹ 拒收');
check(/Link 2 .*needs a label/.test(P([{ label: 'a', href: '/a' }, { label: ' ', href: '/about' }])), '站内页没字 ⟹ 拒收（第几项说对）');
check(/Link 1 .*somewhere to go/.test(P([{ label: 'Book', href: 'https://' }])), '只有 https:// ⟹ 拒收（+ Add link 新加那一项的初值）');
check(/somewhere to go/.test(P([{ label: 'x', href: { source: 'fax' } }])), '不认识的引用 ⟹ 拒收');

console.log('── ④ 展开那一侧：整项引用多带 label / at 不算错');
check(contactRefProblems('header', { topbar: { contact: [{ source: 'phone', label: 'Call', at: 0 }] } }).length === 0, 'label + at ⟹ 校验不报');
check(contactRefProblems('header', { topbar: { contact: [{ source: 'phone', label: 3 }] } }).length === 1, 'label 不是字符串 ⟹ 报一条');

console.log('── ⑤ 写盘（editor-root）');
{
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'topbar-links-'));
  const en = path.join(d, 'en');
  fs.mkdirSync(en);
  fs.writeFileSync(path.join(d, 'site_meta.json'), J({ defaultLocale: 'en', locales: ['en'] }));
  const nav = { header: { links: [], buttons: [{ label: 'Go', href: '/contact' }] }, footer: { description: '', columns: [], copyright: '' } };
  fs.writeFileSync(path.join(en, 'navigation.json'), `${JSON.stringify(nav, null, 2)}\n`);
  // 盘上的顶栏是带 top bar 的版式（没有 theme.json 的站解析成 logo-left，那一行不画 ⟹ 列表不判）。
  const themeFile = path.join(d, 'theme.json');
  const setDiskShape = (shape) => fs.writeFileSync(themeFile, `${J({ themeId: 'azure-29', regionLayout: { header: shape } })}\n`);
  setDiskShape('topbar-stacked');
  const args = (root) => ({ siteDir: d, localeDir: en, locale: 'en', shape: { flat: false, locales: ['en'] }, root });
  const tryPlan = (root) => { try { return { writes: editorRoot.planRootWrite(args(root)) }; } catch (e) { return { code: e.code, message: e.message }; } };
  const read = editorRoot.readRootValues({ siteDir: d, localeDir: en, locale: 'en' }).headerTopbar;
  check(J(read) === J(tl.DEFAULT_TOPBAR_LINKS), `没写过 ⟹ 读回默认两项（${J(read)}）`);
  const r = tryPlan({ headerTopbar: [{ label: ' Call us ', href: { source: 'phone' } }, { label: '', href: { source: 'email' } }] });
  const after = r.writes ? JSON.parse(r.writes[0].content) : null;
  check(after && J(after.header.topbarLinks[0]) === J({ label: 'Call us', href: { source: 'phone' } }),
    `写进 header.topbarLinks[0] = {"label":"Call us","href":{"source":"phone"}}（读到 ${after && J(after.header.topbarLinks)}）`);
  check(after && J({ ...after, header: { ...after.header, topbarLinks: undefined } }) === J(nav), 'navigation.json 别的键一个不动');
  const empty = tryPlan({ headerTopbar: [] });
  check(empty.code === editorRoot.REFUSED && /at least one link/.test(empty.message) && /Nothing was changed\.$/.test(empty.message), `清空 ⟹ 拒收码 + 那句话（${empty.message}）`);
  // r1 QA2 Q1：清空 → 照那句话去 Layout 换成 logo-left → Done。同一笔里换了版式 ⟹ 按存完以后的版式判，存得进去。
  const q1 = tryPlan({ headerShape: 'logo-left', headerTopbar: [] });
  const q1Files = (q1.writes || []).map((w) => [path.relative(d, w.file), JSON.parse(w.content)]);
  const q1Nav = q1Files.find(([f]) => f === path.join('en', 'navigation.json'));
  const q1Theme = q1Files.find(([f]) => f === 'theme.json');
  check(!q1.code && q1Nav && J(q1Nav[1].header.topbarLinks) === '[]' && q1Theme && q1Theme[1].regionLayout.header === 'logo-left',
    `清空 + 同一笔换成 logo-left ⟹ 两份都写（${q1.message || J(q1Files.map(([f]) => f))}）`);
  const toTopbar = tryPlan({ headerShape: 'topbar', headerTopbar: [] });
  check(toTopbar.code === editorRoot.REFUSED && /at least one link/.test(toTopbar.message), `清空 + 同一笔换成另一个带 top bar 的版式 ⟹ 仍拒收（${toTopbar.message}）`);
  setDiskShape('logo-left');
  const hidden = tryPlan({ headerTopbar: [] });
  check(!hidden.code && J(JSON.parse(hidden.writes[0].content).header.topbarLinks) === '[]', `盘上已是 logo-left、这一笔只清空列表 ⟹ 存得进去（${hidden.message || 'ok'}）`);
  const back = tryPlan({ headerShape: 'topbar-stacked', headerTopbar: [] });
  check(back.code === editorRoot.REFUSED, '盘上 logo-left、这一笔换回带 top bar 的版式但列表是空的 ⟹ 拒收');
  setDiskShape('topbar-stacked');
  const nolabel = tryPlan({ headerTopbar: [{ label: '', href: 'https://example.com' }] });
  check(nolabel.code === editorRoot.REFUSED && /needs a label/.test(nolabel.message), `外部链接没字 ⟹ 拒收（${nolabel.message}）`);
  for (const [name, v] of [['不是数组', { a: 1 }], ['多一个键', [{ label: 'a', href: '/a', icon: 'x' }]], ['href 是数字', [{ label: 'a', href: 1 }]], ['引用带怪键', [{ label: '', href: { source: 'phone', x: 1 } }]]]) {
    const b = tryPlan({ headerTopbar: v });
    check(b.code === 5, `${name} ⟹ 形状不对（code 5，不是给老板看的话）`);
  }
  // 写盘那一关的链接判据（`link-href.js` §NAV_LINKS）认这份列表：新写进去的 javascript: 被拒，引用那几项不归它管。
  const next = { ...nav, header: { ...nav.header, topbarLinks: [{ label: 'X', href: 'javascript:alert(1)' }, { label: '', href: { source: 'phone' } }] } };
  check(linksOf('navigation', next).filter((l) => l.place === 'header.topbarLinks').length === 1, 'linksOf 收到 topbarLinks 里那一条字符串链接（引用那一项不算）');
  check(/the top bar/.test(linkRejection('navigation', next, nav) || ''), `新写的 javascript: ⟹ 拒（${linkRejection('navigation', next, nav)}）`);
  fs.rmSync(d, { recursive: true, force: true });
}

console.log('── ⑥ 画布预览（nav-editor §liveShellData）跟构建同一条规则');
{
  const built = { header: { topbar: { message: { text: 'Open Sunday' }, contact: [{ source: 'phone', at: 0 }] } }, footer: {} };
  const list = [{ label: 'Book', href: '/book' }];
  const live = liveShellData(built, { headerTopbar: list }, 'fr', 'en');
  check(J(live.header.topbar) === J({ message: { text: 'Open Sunday' }, contact: tl.topbarContact(list, (h) => (h.startsWith('/') ? `/fr${h}` : h)) }),
    `换 contact、公告那句留着、站内链接加语言前缀（${J(live.header.topbar)}）`);
  check(J(liveShellData(built, {}, 'en', 'en').header.topbar) === J(built.header.topbar), '面板没带 headerTopbar ⟹ 原样');
}

console.log('── ⑦ href 的形状跟顶栏按钮同一份（#1779）：引用判据、写盘那道门、类型');
{
  const { isButtonRef } = require('./item-sources');
  check(tl.isContactRef === isButtonRef, 'isContactRef 就是 item-sources §isButtonRef（不另写一份）');
  const { NAV_SHAPE } = require('./navigation-owned');
  const tb = NAV_SHAPE && NAV_SHAPE.fields && NAV_SHAPE.fields.header.fields.topbarLinks;
  check(!!tb && tb.of === NAV_SHAPE.fields.header.fields.buttons.of, `NAV_SHAPE 的 header.topbarLinks 每一项 = 顶栏按钮那一段（${J(tb && tb.of)}）`);
}

console.log(`\n══ 汇总: 通过 ${pass} · 失败 ${fail} ══`);
process.exit(fail ? 1 : 0);
