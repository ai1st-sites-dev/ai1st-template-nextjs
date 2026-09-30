#!/usr/bin/env node
/**
 * contact-new-render.test.js — #1489 验收里「看渲染出来的 HTML / 调一次校验器就能判」的那几条。
 *
 * 跑法:  node scripts/contact-new-render.test.js   （或 `npm run test:scripts`，它按文件名发现）
 * 退出码: 0 全过 · 1 有失败 · 2 跑不起来（**不许当成通过**）
 *
 * 管哪几条：判据 1（5 个预设逐字、旋钮名 / 值逐字、目录集合、两两不同）· 3（值只有一处、tel / mailto、没填营业时间那一条不画）·
 * 4（items 可关）· 5 / 6 的 DOM 一半（节点在哪一列、空列不占位、split）· 7 的 DOM 一半（地址卡：钉子 / 地址 / Open map / 署名，
 * 没有 <img>、首屏没有 openstreetmap 的 src；嵌入地址带 marker；没 geo 不画）· 8（表单三档、id 前缀 ct、/api/leads）·
 * 9（bg + 不自己算亮度）· 10（validateSite）· 11（block-roles · 首页配方池）· 13 的编辑器 schema · 14（旧块零改动）。
 * 几何（16 组合三端无横向滚动、列的左右上下、图标竖线、计算色、站外请求集合、点开之后的 iframe）要浏览器：
 * `tests/e2e/specs/1489-contact-new-knobs.spec.ts`。
 *
 * 🔴 每一段都带反向对照（同一进程、单变量），证明判据真会红。
 * 夹具定死：演示内容包里的 Northside Auto Care（`scripts/lib/demo-content`：块数据 DEMO_CONTENT['contact-new'] + 站点数据 DEMO_SITE）。
 */

'use strict';

const fs = require('fs');
const path = require('path');
const Module = require('module');
const { execFileSync } = require('child_process');
const ts = require('typescript');
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');

const NEXT = path.resolve(__dirname, '..');
const SRC = path.join(NEXT, 'src');
const BLOCK = path.join(NEXT, 'blocks', 'contact-new');
const SECTION = path.join(BLOCK, 'Section.tsx');

let pass = 0;
let fail = 0;
const ok = (m) => { pass += 1; console.log(`  ✅ ${m}`); };
const bad = (m) => { fail += 1; console.log(`  ❌ ${m}`); };
const die = (m) => { console.error(`🔴 跑不起来: ${m}`); process.exit(2); };
const check = (cond, m, detail) => (cond ? ok(m) : bad(detail ? `${m} —— ${detail}` : m));

// ── 让 node 能 require 这份 .tsx；Next 自己的换成替身（同 cta-new-render.test.js）──────────────────────
// `@/lib/config` 的替身带一份**跟演示站不同**的站点数据：判据 3 要证明「不传 siteFacts ⟹ 读这个站自己的」。
const STUB_DIR = path.join(NEXT, 'scripts', '.contact-new-stubs');
fs.mkdirSync(STUB_DIR, { recursive: true });
const stub = (name, body) => { const p = path.join(STUB_DIR, `${name}.js`); fs.writeFileSync(p, body); return p; };
const STUBS = {
  'next/link': stub('link', "const React=require('react');"
    + "const L=({href,children,...r})=>React.createElement('a',{href,...r},children);module.exports=L;module.exports.default=L;\n"),
  '@/lib/config': stub('config', 'module.exports={siteId:"t-site",leadApi:"https://lead.example",'
    + 'getServices:()=>[{id:"brakes",name:"Brakes"}],'
    + 'brand:{email:"own@site.example",locations:[{label:"Own",address:"1 Own Rd",phone:"+1 (905) 555-0199"}]},'
    + 'getSeo:()=>({schema:{openingHours:{days:["Monday","Tuesday"],opens:"10:00",closes:"16:30"}}})};\n'),
};
process.on('exit', () => { try { fs.rmSync(STUB_DIR, { recursive: true, force: true }); } catch (e) { /* 收尾 */ } });
const sourceOverride = new Map();
for (const ext of ['.tsx', '.ts']) {
  require.extensions[ext] = (mod, filename) => mod._compile(ts.transpileModule(sourceOverride.get(filename) ?? fs.readFileSync(filename, 'utf-8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true, resolveJsonModule: true },
    fileName: filename,
  }).outputText, filename);
}
const origResolve = Module._resolveFilename;
Module._resolveFilename = function resolve(req, ...rest) {
  if (STUBS[req]) return STUBS[req];
  if (req.startsWith('@/')) return origResolve.call(this, path.join(SRC, req.slice(2)), ...rest);
  return origResolve.call(this, req, ...rest);
};

function loadSection(override) {
  delete require.cache[SECTION];
  if (override) sourceOverride.set(SECTION, override); else sourceOverride.delete(SECTION);
  return require(SECTION).default;
}

let C; let DEMO; let DEMO_SITE; let manifestLib; let M; let icons; let facts;
try {
  C = loadSection();
  const demo = require(path.join(NEXT, 'scripts', 'lib', 'demo-content'));
  DEMO = demo.DEMO_CONTENT['contact-new'];
  DEMO_SITE = demo.DEMO_SITE;
  manifestLib = require(path.join(NEXT, 'scripts', 'lib', 'block-manifest.js'));
  M = manifestLib.loadManifests().get('contact-new');
  icons = require(path.join(NEXT, 'scripts', 'lib', 'icons.js'));
  facts = require(path.join(NEXT, 'scripts', 'lib', 'contact-facts.js'));
} catch (e) { die(`载入失败: ${e.message}`); }
if (!DEMO) die('demo-content 里没有 contact-new');
if (!DEMO_SITE) die('demo-content 里没有 DEMO_SITE');
if (!M) die('blocks/ 里没有 contact-new');

const clone = (v) => JSON.parse(JSON.stringify(v));
const TABLE = icons.iconTableFor('contact-new', DEMO, { warn: () => {} });
const siteOf = (mut) => { const s = clone(DEMO_SITE); if (mut) mut(s); return facts.siteFactsFrom(s.brand, s.seo); };
const FACTS = siteOf();
const render = (shape, data, { site = FACTS, Comp = C, iconTable = TABLE } = {}) => renderToStaticMarkup(React.createElement(Comp, {
  data, locale: 'en', iconTable, block: { id: 'ct', type: 'contact-new', shape, data: {} }, ...(site ? { siteFacts: site } : {}),
}));
const withOpts = (o, extra = {}, base = DEMO) => ({ ...clone(base), ...extra, options: { ...(base.options || {}), ...o } });
const count = (html, needle) => html.split(needle).length - 1;
const own = (r) => r.problems.filter((p) => p.includes('("contact-new")'));
const sectionTag = (html) => (/<section[^>]*>/.exec(html) || [''])[0];
const attr = (html, name) => { const m = new RegExp(`\\s${name}="([^"]*)"`).exec(sectionTag(html)); return m ? m[1] : null; };
const itemsOf = (html) => html.split('data-part="item"').slice(1);
const CSS = fs.readFileSync(path.join(BLOCK, 'block.css'), 'utf-8');
const SRC_TEXT = fs.readFileSync(SECTION, 'utf-8');
const KNOB_NAMES = ['introPosition', 'introAlign', 'sidePosition', 'form', 'formStyle', 'itemsLayout', 'itemStyle', 'itemAlign', 'itemIcon', 'map'];
const dataAttr = (n) => `data-${n.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`)}`;

// ══ 判据 1：5 个预设逐字、旋钮名 / 值逐字、目录集合、两两不同 ═══════════════════════════════════════
console.log('── 判据 1 五个预设');
{
  // 列：名字 · 形态目录 · 十个旋钮（正文预设表逐字）
  const WANT = [
    ['Form beside', 'form-beside', 'beside', 'left', 'right', 'full', 'card', 'list', 'plain', 'left', 'left', 'none'],
    ['Details beside', 'details-beside', 'top', 'center', 'left', 'full', 'plain', 'list', 'plain', 'left', 'left', 'none'],
    ['Stacked', 'stacked', 'top', 'center', 'bottom', 'full', 'card', 'grid', 'card', 'center', 'top', 'none'],
    ['Map beside', 'map-beside', 'beside', 'left', 'right', 'none', 'card', 'list', 'plain', 'left', 'left', 'beside'],
    ['Map', 'map', 'top', 'center', 'right', 'none', 'card', 'grid', 'card', 'center', 'top', 'bottom'],
  ];
  const got = (M.presets || []).map((p) => [p.name, p.shape, ...KNOB_NAMES.map((c) => p.knobs[c])]);
  check(JSON.stringify(got) === JSON.stringify(WANT), 'presets 5 条与正文表逐字相同（名字 · 形态 · 十列旋钮）', JSON.stringify(got));
  check((M.presets || []).every((p) => Object.keys(p.knobs).join() === KNOB_NAMES.join()), '每个预设的 knobs 键就是这十个、同一顺序');
  const knobs = M.slots.options.knobs.map((k) => [k.name, k.values]);
  check(JSON.stringify(knobs) === JSON.stringify([
    ['introPosition', ['top', 'beside']], ['introAlign', ['left', 'center', 'right']],
    ['sidePosition', ['left', 'right', 'bottom']], ['form', ['none', 'teaser', 'full']], ['formStyle', ['plain', 'card']],
    ['itemsLayout', ['list', 'grid']], ['itemStyle', ['plain', 'card']], ['itemAlign', ['left', 'center']], ['itemIcon', ['left', 'top']],
    ['map', ['none', 'beside', 'bottom']],
  ]), `slots.options.knobs 名字依次 ${knobs.map((k) => k[0]).join(' / ')}、values 与旋钮表逐字（values[0] = 默认）`);
  check(M.slots.options.knobs.every((k) => !('default' in k)), '旋钮上没有显式 default（归 #1481）');
  const dirs = fs.readdirSync(BLOCK, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name).sort();
  check(JSON.stringify(dirs) === JSON.stringify(WANT.map((w) => w[1]).sort()), `目录集合 == 5 个预设形态（${dirs.join(' / ')}）`);
  check(dirs.every((d) => !fs.existsSync(path.join(BLOCK, d, 'Section.tsx')) && fs.existsSync(path.join(BLOCK, d, 'shape.md'))),
    '一份 Section.tsx（形态目录里没有第二份 markup）、每个形态目录各一份 shape.md');
  check(M.skin === 'site-css' && M.roleDefault === 'essential', `skin=${M.skin} · roleDefault=${M.roleDefault}`);
  const htmls = dirs.map((d) => render(d, clone(DEMO)));
  check(new Set(htmls).size === 5, `同一份夹具下 5 个预设渲染出 ${new Set(htmls).size} 份互不相同的 HTML`);
  const pinned = dirs.map((d) => render(d, withOpts(M.presets[0].knobs)).replace(/data-shape="[^"]*"/g, ''));
  check(new Set(pinned).size === 1, '反向对照：options 里写死十个旋钮 ⟹ 5 个预设（去掉 data-shape 之后）塌成同一份 —— 判据分得开');
  const r = render('form-beside', clone(DEMO));
  const miss = KNOB_NAMES.filter((n) => attr(r, dataAttr(n)) !== M.presets[0].knobs[n]);
  check(miss.length === 0, 'Form beside：十个旋钮都写在 <section> 上', miss.join(' · '));
  // 旋钮独立：拧一个，其余九个不变（组件里没有联动纠正）。
  const base = M.presets[0].knobs;
  const moved = [];
  for (const k of M.slots.options.knobs) {
    for (const v of k.values) {
      const h = render('form-beside', withOpts({ [k.name]: v }));
      if (attr(h, dataAttr(k.name)) !== v || KNOB_NAMES.filter((n) => n !== k.name).some((n) => attr(h, dataAttr(n)) !== base[n])) moved.push(`${k.name}=${v}`);
    }
  }
  check(moved.length === 0, `旋钮独立（逐个拧 ${M.slots.options.knobs.reduce((n, k) => n + k.values.length, 0)} 档）：拧的那个到位、其余九个不变`, moved.join(' · '));
}

// ══ 判据 3：值只有一处 ═════════════════════════════════════════════════════════════════════════════
console.log('\n── 判据 3 值只读站点数据');
{
  check(DEMO.items.every((it) => !('value' in it) && !('phone' in it)) && !JSON.stringify(DEMO).includes('555-0142') && !JSON.stringify(DEMO).includes('2150 Yonge'),
    '夹具的块数据里没有电话 / 地址字符串（JSON.stringify(block.data) 不含那个号码）');
  const h = render('form-beside', clone(DEMO));
  check(h.includes('(416) 555-0142') && h.includes('href="tel:4165550142"'), '电话读站点数据、渲染成 tel: 链接');
  check(h.includes('href="mailto:service@northsideauto.ca"'), '邮箱读站点数据、渲染成 mailto: 链接');
  check(h.includes('2150 Yonge St, Toronto, ON') && h.includes('Mon–Sat · 8am – 6pm'), `地址与营业时间读站点数据（营业时间格式化成一行「Mon–Sat · 8am – 6pm」）`);
  const changed = render('form-beside', clone(DEMO), { site: siteOf((s) => { s.brand.locations[0].phone = '(647) 555-0000'; }) });
  check(changed.includes('(647) 555-0000') && changed.includes('tel:6475550000') && !changed.includes('555-0142'), '把站点数据的电话改掉 ⟹ 渲染的电话跟着变、旧号码一处都不剩');
  const noHours = render('form-beside', clone(DEMO), { site: siteOf((s) => { s.seo.schema.openingHours = { days: [], opens: '', closes: '' }; }) });
  const kinds = (x) => itemsOf(x).map((i) => (/data-kind="([^"]+)"/.exec(i) || [])[1]).join(',');
  check(kinds(h) === 'phone,email,address,hours,link,link' && kinds(noHours) === 'phone,email,address,link,link',
    `站点数据删掉营业时间 ⟹ hours 那一条不渲染、其余照常（${kinds(h)} → ${kinds(noHours)}）`);
  const own = render('form-beside', clone(DEMO), { site: null });
  check(own.includes('1 Own Rd') && own.includes('tel:+19055550199') && own.includes('Mon, Tue · 10am – 4:30pm') && !own.includes('2150 Yonge'),
    '不传 siteFacts ⟹ 读这个站自己的（@/lib/config 的 brand / getSeo）');
  const linkRow = itemsOf(h).find((i) => i.includes('data-kind="link"'));
  check(!!linkRow && linkRow.includes('href="https://wa.me/14165550142"') && linkRow.includes('>Text us on WhatsApp</a>'), 'link：值就是标题、跳 href');
  check(facts.formatHours({ days: ['Monday', 'Wednesday', 'Thursday', 'Friday', 'Sunday'], opens: '07:00', closes: '19:00' }) === 'Mon, Wed–Fri, Sun · 7am – 7pm'
    && facts.formatHours({ days: ['Monday'], opens: '', closes: '17:00' }) === '', '营业时间：不连的逗号隔开、连着的收成一段；opens 空串 = 没填');
}

console.log('\n── 判据 3（r2，QA2 打回 r1）抄进 title / hint 的值：写盘剔掉、渲染也不画');
{
  // QA2 在真 AI 建出来的站上抓到的那四条（逐字；电话 / 邮箱 / 地址换成本夹具站点数据里的那几个），外加一条 link 当对照。
  const b = DEMO_SITE.brand;
  const phone = b.locations[0].phone; const email = b.email; const address = b.locations[0].address;
  const REAL = () => [
    { kind: 'phone', title: 'Call Us', hint: `${phone} — Mon–Fri 8 AM–6 PM`, href: `tel:${phone}` },
    { kind: 'email', title: 'Email Us', hint: email },
    { kind: 'address', title: 'Visit the Shop', hint: address },
    { kind: 'hours', title: 'Business Hours', hint: 'Monday – Friday, 8:00 AM – 6:00 PM' },
    { kind: 'link', title: 'Text us on WhatsApp', hint: 'Replies in minutes', href: 'https://wa.me/14165550142' },
  ];
  const page = { slug: 'quote', blocks: [{ id: 'q-ct', type: 'contact-new', data: { headline: 'Get in touch', items: REAL() } }] };
  const before = JSON.stringify(page.blocks[0].data);
  check(before.includes(phone) && before.includes(email) && before.includes(address), '前提：剔之前块数据里有电话 / 邮箱 / 地址（尺子读得到它）');
  const n = facts.scrubContactCopies(page, FACTS);
  const after = JSON.stringify(page.blocks[0].data);
  const its = page.blocks[0].data.items;
  check(n === 4 && ![phone, email, address, '8:00 AM', '8 AM'].some((v) => after.includes(v)),
    `scrubContactCopies：4 条 fact item 都剔了，JSON.stringify(block.data) 不含电话 / 邮箱 / 地址 / 钟点（剔了 ${n} 条）`);
  check(its.slice(0, 4).map((i) => i.title).join('|') === 'Call Us|Email Us|Visit the Shop|Business Hours' && its.slice(0, 4).every((i) => !('hint' in i) && !('href' in i)),
    '标题照留（它们没抄值）、hint 删、phone 的 href 删（tel: 由站点数据现算）');
  check(JSON.stringify(its[4]) === JSON.stringify(REAL()[4]), 'link 那条一个字不动（它的值就是标题，href 是它自己的）');
  check(facts.scrubContactCopies(page, FACTS) === 0, '再剔一次 = 0（幂等）');
  const titled = { sections: [{ type: 'contact-new', data: { items: [{ kind: 'phone', title: `Call ${phone}` }] } }, { type: 'cta-new', data: { items: [{ kind: 'phone', hint: phone }] } }] };
  check(facts.scrubContactCopies(titled, FACTS) === 1 && !('title' in titled.sections[0].data.items[0]) && titled.sections[1].data.items[0].hint === phone,
    '老 sections 形状也认；标题抄了值 ⟹ 标题删；别的块一个字不动');
  const keep = ['Same-day reply', 'Open 24/7', 'Free parking out front', 'We reply within 2 hours', 'Mon–Sat', 'Book online anytime'];
  check(keep.every((t) => !facts.copiesSiteFact(t, FACTS)), `正常的提示不误伤：${keep.join(' / ')}`);
  check(['(604) 555 0142', 'call 416.555.0199', 'x@y.co', '7:30', '9am', address.split(',')[0]].every((t) => facts.copiesSiteFact(t, FACTS)),
    '电话 / 邮箱 / 钟点按样子认（换一个号码也认得出），地址按站点现值认（整条或逗号前那段）');

  // 接线：建站写页面的两个循环（主语言 §writeSiteConfig、其余语言 §writeSecondaryLocaleConfig）在 pageWithBlocks 之前剔一遍。
  // 📌 建站那条路是 AI 路，本仓的 agent 按 #1499 跑不了它 ⟹ 这里量源码里的调用点；函数本身上面用 QA2 那四条真样本量过。
  const CS = fs.readFileSync(path.join(NEXT, 'scripts', 'create-site.js'), 'utf-8');
  const wired = (factsVar) => new RegExp(`for \\(const page of \\w+\\.pages\\) \\{\\s*const scrubbed = scrubContactCopies\\(page, ${factsVar}\\);[\\s\\S]{0,400}?pageWithBlocks\\(page\\)`).test(CS);
  check(wired('facts') && wired('secFacts') && /const facts = siteFactsFrom\(content\.brand, content\.seo\);/.test(CS) && /const secFacts = siteFactsFrom\(existingBrand, secContent\.seo\);/.test(CS),
    'create-site.js：主语言 / 其余语言两个写页面的循环都在 pageWithBlocks 之前 scrubContactCopies（值取这个站自己的 brand / seo）');

  // 渲染那一侧：可视化编辑器里手打进去的那份不经过写盘那两处 —— 画出来也只剩站点数据那一处值。
  const html = render('form-beside', { ...clone(DEMO), items: REAL() });
  const row = (k) => itemsOf(html).find((i) => i.includes(`data-kind="${k}"`)) || '';
  check(count(row('phone'), phone) === 1 && !row('phone').includes('8 AM') && count(row('email'), email) === 2 && count(row('address'), address) === 1 && !row('hours').includes('8:00 AM'),
    '渲染：每条只剩站点数据那一处值（email 那条 2 = 链接文字 + mailto:），抄进来的 hint 一条都不画');
  const stale = render('form-beside', { ...clone(DEMO), items: REAL() }, { site: siteOf((st) => { st.brand.locations[0].phone = '(647) 555-0000'; }) });
  check(!stale.includes(phone) && stale.includes('(647) 555-0000'), `老板改了站点电话之后，同一张卡上不会一新一旧两个号码（旧号 ${phone} 一处都不剩）`);
  const noGuard = { ...clone(DEMO), items: REAL().map((it) => ({ ...it, hint: it.kind === 'link' ? it.hint : 'Same-day reply' })) };
  check(count(render('form-beside', noGuard), 'Same-day reply') === 4, '反向对照：hint 没抄值 ⟹ 四条都照画（闸只拦抄值的那几条）');
}

// ══ 判据 4：items 可关 ═════════════════════════════════════════════════════════════════════════════
console.log('\n── 判据 4 items 可关');
{
  const empty = withOpts({}, { items: [] });
  const top = render('details-beside', empty);
  check(!top.includes('data-part="items"') && !top.includes('data-part="textcol"') && top.includes('data-part="side"') && attr(top, 'data-split') === 'one',
    'items: [] + introPosition=top ⟹ 没有 items 节点、items 列不画、侧列占满（split=one）');
  const beside = render('form-beside', empty);
  const col = (beside.split('data-part="textcol"')[1] || '').split('data-part="side"')[0];
  check(!beside.includes('data-part="items"') && col.includes('data-part="intro"') && attr(beside, 'data-split') === 'form',
    'items: [] + introPosition=beside ⟹ 那一列只剩块头、仍是两列');
  check(render('details-beside', clone(DEMO)).includes('data-part="items"'), '对照：有 items ⟹ 有那一组');
}

// ══ 判据 5 / 6（DOM 一半）═════════════════════════════════════════════════════════════════════════
console.log('\n── 判据 5 / 6 列的组成');
{
  const introTop = render('details-beside', clone(DEMO));
  check(count(introTop, 'data-part="intro"') === 1 && introTop.indexOf('data-part="intro"') < introTop.indexOf('data-part="textcol"'), 'introPosition=top：块头只画一份、在两列上面');
  const introBeside = render('form-beside', clone(DEMO));
  const tc = introBeside.indexOf('data-part="textcol"');
  check(count(introBeside, 'data-part="intro"') === 1 && introBeside.indexOf('data-part="intro"') > tc && introBeside.indexOf('data-part="intro"') < introBeside.indexOf('data-part="items"'),
    'introPosition=beside：块头只画一份、在 items 那一列最上面');
  const noSide = render('form-beside', withOpts({ form: 'none', map: 'none' }));
  check(!noSide.includes('data-part="side"') && attr(noSide, 'data-split') === 'one', 'form=none + map=none ⟹ 侧列不渲染、split=one');
  const mapOnly = render('form-beside', withOpts({ form: 'none', map: 'beside' }));
  check(mapOnly.includes('data-part="side"') && !/<form\b/.test(mapOnly) && attr(mapOnly, 'data-split') === 'even', 'form=none + map=beside ⟹ 两列各半（split=even）');
  check(attr(introBeside, 'data-split') === 'form', '有表单 ⟹ split=form（5/12 + 7/12）');
  check(/\[data-split="form"\][^{]*\.ct-textcol \{\s*flex: 0 0 auto;\s*width: 41\.6667%;/.test(CSS) && /\[data-split="form"\][^{]*\.ct-sidecol \{\s*flex: 0 0 auto;\s*width: 58\.3333%;/.test(CSS)
    && /\[data-split="even"\][^{]*\.ct-sidecol \{\s*flex: 0 0 auto;\s*width: 50%;/.test(CSS), 'block.css：form 5/12 + 7/12、even 各半（真宽度在 e2e 里量）');
  check(/\[data-side-position="bottom"\] \.ct-sidecol \.ct-form \{\s*max-width: 40rem;/.test(CSS), 'block.css：bottom 表单限 40rem');
  check(/\[data-items-layout="list"\]\[data-item-align="center"\] \.ct-info \{\s*width: fit-content;/.test(CSS) && !/data-intro-align[^{]*\.ct-(info|ch)/.test(CSS),
    'block.css：list + center 整组 fit-content 居中；item 的规则没有一条读 introAlign（脱钩）');
}

// ══ 判据 7（DOM 一半）：地图 ═══════════════════════════════════════════════════════════════════════
console.log('\n── 判据 7 地图（点之前是地址卡）');
{
  for (const [shape, where] of [['map-beside', 'side'], ['map', 'bottom']]) {
    const h = render(shape, clone(DEMO));
    const map = (h.split('data-part="map"')[1] || '').split('</div></div>')[0] + (h.split('data-part="map"')[1] || '');
    check(count(h, 'data-part="map"') === 1 && h.includes(`data-map-where="${where}"`) && h.includes('data-map-state="closed"'), `${shape}：一格地图（${where}）、初始是关着的`);
    check(map.includes('data-part="map-address"') && map.includes('>2150 Yonge St, Toronto, ON<') && map.includes('data-part="map-open"') && map.includes('>Open map</button>'),
      `${shape}：地址卡 = 地址（== brand.locations[0].address）+「Open map」按钮`);
    check(map.includes('data-icon="geo-alt-fill"') && map.includes('<svg'), `${shape}：有钉子图标`);
    check(/©\s*<a[^>]*>OpenStreetMap<\/a>\s*contributors/.test(map), `${shape}：「© OpenStreetMap contributors」署名`);
    check(!/<img\b/.test(h) && !/<iframe\b/.test(h) && !/\ssrc="[^"]*openstreetmap/.test(h) && !/background-image/.test(h), `${shape}：首屏没有 <img>、没有 iframe、没有任何 src 含 openstreetmap、没有 background-image`);
  }
  check(!/\.ct-map[^{]*\{[^}]*background(-image)?:\s*url/.test(CSS), 'block.css：地图那一格没有 url() 底图');
  const url = facts.osmEmbedUrl(DEMO_SITE.brand.locations[0].geo);
  check(url.startsWith('https://www.openstreetmap.org/export/embed.html?bbox=') && url.includes('&marker=43.7056,-79.3983'), `嵌入地址 = OSM 官方嵌入、marker=<lat>,<lng>（${url}）`);
  const noGeo = siteOf((s) => { delete s.brand.locations[0].geo; });
  const ng = render('map', clone(DEMO), { site: noGeo });
  check(!ng.includes('data-part="map"') && ng.includes('data-part="items"'), '去掉 geo ⟹ 地图那一格不渲染、其余照常');
  check(!render('map', clone(DEMO), { site: siteOf((s) => { s.brand.locations[0].address = ''; }) }).includes('data-part="map"'), '对照：有 geo 没地址 ⟹ 也不画（地址卡没东西可写）');
  const mapSrc = fs.readFileSync(path.join(BLOCK, 'ContactMap.tsx'), 'utf-8');
  check(/^'use client';/.test(mapSrc) && !/'use client'/.test(SRC_TEXT), 'ContactMap.tsx 是块里唯一的客户端组件（Section.tsx 是服务端组件）');
  check(/loading="lazy"/.test(mapSrc) && /src=\{embedUrl\}/.test(mapSrc), '点开之后的 iframe：src = 嵌入地址、loading=lazy');
}

// ══ 判据 8：表单 ══════════════════════════════════════════════════════════════════════════════════
console.log('\n── 判据 8 表单');
{
  const fieldIds = (h) => (h.match(/<(?:input|select|textarea)[^>]*\sid="(ct-[a-z]+)"/g) || []).map((x) => /id="([^"]+)"/.exec(x)[1]).filter((i) => i !== 'ct-hp');
  const teaser = render('form-beside', withOpts({ form: 'teaser' }));
  const full = render('form-beside', withOpts({ form: 'full' }));
  const none = render('form-beside', withOpts({ form: 'none' }));
  check(fieldIds(teaser).length === 1 && fieldIds(full).length > 1, `teaser 只有首要字段（${fieldIds(teaser)}）、full 整张（${fieldIds(full)}）`);
  check(teaser.includes('data-form-variant="inline"') && full.includes('data-form-variant="stacked"'), 'teaser → inline、full → stacked');
  check(!/<form\b/.test(none), 'none ⟹ 没有 <form>');
  check(/id="ct-/.test(full) && !/id="(hro|ftr|cta)-/.test(teaser + full), 'id 前缀 ct-（不跟 hero / footer / cta 撞）');
  const formSrc = fs.readFileSync(path.join(SRC, 'components', 'BlockLeadForm.tsx'), 'utf-8');
  check(/import BlockLeadForm from '@\/components\/BlockLeadForm'/.test(SRC_TEXT) && /'\/api\/leads'/.test(formSrc), '表单用共用的 BlockLeadForm，提交走 /api/leads（真提交在 e2e 里）');
}

// ══ 判据 9：bg ═════════════════════════════════════════════════════════════════════════════════════
console.log('\n── 判据 9 bg');
{
  const at = (bg) => render('form-beside', withOpts({}, { bg }));
  check(attr(at('#0f172a'), 'data-tone') === 'dark' && /style="background:#0f172a"/.test(sectionTag(at('#0f172a'))), '#0f172a ⟹ data-tone="dark"、<section> 底色 #0f172a');
  check(attr(at('#ffffff'), 'data-tone') === 'light', '#ffffff ⟹ light');
  const g = at({ stops: ['#7d52f4', '#f7b733'], angle: 135 });
  check(/style="background:linear-gradient\(135deg,#7d52f4,#f7b733\)"/.test(sectionTag(g)) && attr(g, 'data-tone') === 'dark', '渐变 ⟹ linear-gradient + 按 toneForBg 给 tone');
  check(count(SRC_TEXT, 'toneFor(') === 0 && count(SRC_TEXT, 'linear-gradient') === 0 && /toneForBg\(d\.bg\)/.test(SRC_TEXT),
    `Section.tsx 里 toneFor( ${count(SRC_TEXT, 'toneFor(')} 处、linear-gradient ${count(SRC_TEXT, 'linear-gradient')} 处（走 contrast.js）`);
  check(/:not\(\[data-tone="light"\]\) \.ct-title,[\s\S]*?\.ct-value \{\s*color: #fff !important;/.test(CSS), 'block.css：深底标题 / item 标题 / 值反白');
  // #1477 —— 深底提示白 .92 全站只有一条（site-css.js §ON_DEEP_MUTED，认根上的 data-tone），block.css 里不抄一份（同 milestones / features-new）。
  const { ON_DEEP_MUTED } = require(path.join(NEXT, 'scripts', 'lib', 'site-css.js'));
  check(/\[data-tone="dark"\] \.text-muted,\s*\n\[data-tone="brand"\] \.text-muted,[\s\S]*?\{\s*color: rgba\(255, 255, 255, \.92\) !important;/.test(ON_DEEP_MUTED)
    && !/\.ct-(?:intro-text|info) \.text-muted\s*\{[^}]*rgba\(255, 255, 255/.test(CSS), '深底提示白 .92：全站那条，block.css 里没有自己那份');
  check(/:not\(\[data-tone="light"\]\)\[data-form-style="card"\] \.ct-form \{\s*color: #1e293b;/.test(CSS) && /\[data-form-style="card"\] \.ct-form \{\s*background: #fff;/.test(CSS),
    'block.css：表单卡保持白底、卡里字回到深色');
  const dark = at('#0f172a');
  const formTag = (h) => (/<form[^>]*>/.exec(h) || [''])[0];
  const darkPlain = render('form-beside', withOpts({ formStyle: 'plain' }, { bg: '#0f172a' }));
  check(/<form\b/.test(dark) && !/data-tone=/.test(formTag(dark)) && /data-tone="dark"/.test(formTag(darkPlain)),
    `深底 + 卡片表单 ⟹ 表单按浅底画（<form> 不带 data-tone）；对照：深底 + plain ⟹ <form data-tone="dark">（${formTag(darkPlain).match(/data-tone="[^"]*"/)}）`);
  check(JSON.stringify(M.slots.bg) === JSON.stringify(manifestLib.loadManifests().get('footer-new').slots.bg), 'bg 槽对象与 footer-new 的 slots.bg 逐字相同');
}

// ══ 判据 10：validateSite ═════════════════════════════════════════════════════════════════════════
console.log('\n── 判据 10 validateSite');
{
  const v = (data) => own(manifestLib.validateSite({ pages: [{ slug: 'p', blocks: [{ type: 'contact-new', data: { headline: 'H', ...data } }] }], scope: 'edit' }));
  const it = (i) => ({ kind: 'phone', title: `T${i}` });
  const r7 = v({ items: Array.from({ length: 7 }, (_, i) => it(i)) });
  check(r7.length === 1 && r7[0].includes('最多只能有 6 项'), 'items 7 条 ⟹ 报一条', JSON.stringify(r7));
  check(v({ items: Array.from({ length: 6 }, (_, i) => it(i)) }).length === 0, '对照：6 条放行');
  const fax = v({ items: [{ kind: 'fax', title: 'Fax' }] });
  check(fax.length === 1 && fax[0].includes('items[0].kind') && fax[0].includes('"fax"'), 'kind: "fax" ⟹ 报一条', JSON.stringify(fax));
  const noHref = v({ items: [{ kind: 'link', title: 'WhatsApp' }] });
  check(noHref.length === 1 && noHref[0].includes('"href"'), 'kind: "link" 没有 href ⟹ 报一条', JSON.stringify(noHref));
  check(v({ items: [{ kind: 'link', title: 'WhatsApp', href: 'https://wa.me/1' }] }).length === 0, '对照：link 带 href 放行');
  for (const p of M.presets) {
    const r = own(manifestLib.validateSite({ pages: [{ slug: 'p', blocks: [{ type: 'contact-new', shape: p.shape, data: { ...clone(DEMO), options: p.knobs } }] }], scope: 'edit' }));
    check(r.length === 0, `预设 ${p.name}（十个旋钮写全）+ 演示内容 ⟹ 放行`, JSON.stringify(r));
  }
}

// ══ 判据 11：block-roles · 首页配方 ════════════════════════════════════════════════════════════════
console.log('\n── 判据 11 block-roles · 首页配方');
{
  const roles = JSON.parse(fs.readFileSync(path.join(SRC, 'lib', 'sections', 'block-roles.json'), 'utf-8'));
  check(roles['contact-new'] === M.roleDefault, `block-roles.json 的 contact-new（${roles['contact-new']}）== manifest roleDefault（${M.roleDefault}）`);
  const recipe = require(path.join(NEXT, 'scripts', 'lib', 'homepage-recipe.js'));
  const all = manifestLib.loadManifests();
  const pool = recipe.poolFor(all);
  check(pool.includes('contact-new') && !pool.includes('contact-info') && !pool.includes('map-area'), `poolFor 含 contact-new、不含 contact-info / map-area（池子 ${pool.length} 种）`);
  check('contact-info' in recipe.NOT_IN_POOL && 'map-area' in recipe.NOT_IN_POOL && !('contact-new' in recipe.NOT_IN_POOL), 'contact-info / map-area 在 NOT_IN_POOL、contact-new 不在');
  // 反向对照：从排除名单拿掉这两个 ⟹ 三个都进池、种数 +2。
  const saved = { ci: recipe.NOT_IN_POOL['contact-info'], ma: recipe.NOT_IN_POOL['map-area'] };
  delete recipe.NOT_IN_POOL['contact-info']; delete recipe.NOT_IN_POOL['map-area'];
  const leaked = recipe.poolFor(all);
  recipe.NOT_IN_POOL['contact-info'] = saved.ci; recipe.NOT_IN_POOL['map-area'] = saved.ma;
  check(['contact-new', 'contact-info', 'map-area'].every((t) => leaked.includes(t)) && leaked.length === pool.length + 2, `反向对照：不排除这两个 ⟹ 三个都进池、种数 ${pool.length} → ${leaked.length}（+2）`);
  const withoutNew = recipe.poolFor(new Map([...all].filter(([k]) => k !== 'contact-new')));
  check(withoutNew.length === pool.length - 1, `对照：块库里没有 contact-new ⟹ 池子少一（${withoutNew.length}）`);
  const order = (t) => all.get(t).prompt.order;
  check(M.prompt.group === 'homepage' && M.prompt.order === order('contact-info') + 1, `prompt.group == homepage、order ${M.prompt.order} 紧挨 contact-info（${order('contact-info')}）`);
  const lines = M.prompt.lines.join('\n');
  check(/only pick the kinds the site data really has/.test(lines) && /no real street address/.test(lines) && /lead form/.test(lines) && /top-level in data \(not inside options\)/.test(lines),
    'prompt.lines：items 只挑站点数据有的、没地址别用带地图的预设、form 用站点表单、bg 在 data 顶层');
}

// ══ 判据 13（编辑器 schema 一半；往返无损由 editor-roundtrip.test.js 对全部页面块量）═══════════════════
console.log('\n── 判据 13 编辑器 schema');
{
  const { editorSchema } = require(path.join(NEXT, 'scripts', 'lib', 'editor-schema.js'));
  const { presetNameFor } = require(path.join(NEXT, 'scripts', 'lib', 'block-knobs.js'));
  const on = editorSchema({}).components.find((c) => c.type === 'contact-new');
  check(!!on, 'Puck 组件里有 contact-new（能从左栏拖进页面）');
  const opt = on.fields[0];
  check(opt.control === 'options' && opt.presets.map((p) => p.name).join() === M.presets.map((p) => p.name).join() && opt.knobs.map((k) => k.name).join() === KNOB_NAMES.join(),
    '第一个字段：预设 5 个 → 十个旋钮');
  const items = on.fields.find((f) => f.slot === 'items');
  check(items && items.control === 'list' && items.subs.map((x) => x.sub).join() === 'title,hint,kind,href'
    && JSON.stringify(items.subs.find((x) => x.sub === 'kind').choices) === JSON.stringify(M.slots.items.itemChoices.kind),
    `items 是列表字段、每条可改 title / hint、kind 是下拉（五个值）、href 一格（${items ? items.subs.map((x) => x.sub).join(' / ') : '无'}）`);
  const man = { slots: { options: { knobs: opt.knobs } }, presets: opt.presets };
  check(presetNameFor(man, M.presets[2].knobs) === 'Stacked' && presetNameFor(man, { ...M.presets[2].knobs, map: 'bottom' }) === 'custom', '点 Stacked = 那一组旋钮；拧偏一个（map=bottom）⟹ custom');
}

// ══ 判据 14：旧块零改动 ═══════════════════════════════════════════════════════════════════════════
console.log('\n── 判据 14 旧块零改动');
{
  let diff = null;
  try {
    const base = execFileSync('git', ['merge-base', 'HEAD', 'origin/main'], { cwd: NEXT, encoding: 'utf8' }).trim();
    let landed = true;
    try { execFileSync('git', ['cat-file', '-e', `${base}:templates/nextjs/blocks/contact-new/manifest.json`], { cwd: NEXT, stdio: 'ignore' }); } catch { landed = false; }
    if (landed) console.log(`  ⏭  contact-new 已在 merge-base ${base.slice(0, 8)} 上（#1489 已落地），这一格只管 #1489 自己的交付 —— 不算通过`);
    else diff = execFileSync('git', ['diff', '--name-only', base, '--', 'blocks/contact-form', 'blocks/contact-info', 'blocks/map-area'], { cwd: NEXT, encoding: 'utf8' }).trim();
  } catch (e) { console.log(`  ⚠️  取不到 git 读数（${e.message.split('\n')[0]}），这一格跳过 —— 不算通过`); }
  if (diff !== null) check(diff === '', `contact-form / contact-info / map-area 相对 merge-base 没有改动${diff ? `：${diff}` : ''}`);
}

console.log(`\n══ 汇总: 通过 ${pass} · 失败 ${fail} ══`);
process.exit(fail ? 1 : 0);
