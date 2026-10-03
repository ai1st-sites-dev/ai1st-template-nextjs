#!/usr/bin/env node
/**
 * team-render.test.js — #1487 验收里「看渲染出来的 HTML / 调一次校验器就能判」的那几条。
 *
 * 跑法:  node scripts/team-render.test.js   （或 `npm run test:scripts`，它按文件名发现）
 * 退出码: 0 全过 · 1 有失败 · 2 跑不起来（**不许当成通过**）
 *
 * 管哪几条：AC1（5 个预设逐字、旋钮名 / 值逐字、parts、目录集合、两两不同、旋钮独立）· AC4 的 DOM 一半（没写 photo 就没有
 * <img>）与规则一半（三种尺寸）· AC5 的源码一半（没有 64ch / 52ch、侧列取消 80%）· AC7（部件清空不渲染、每条 link 一个非空
 * <svg>、`icon` 改名 `kind` 那一格红）· AC8（memberPhoto=left 时 memberAlign 只改根属性）· AC9（bg + 不自己算亮度）·
 * AC10 前半（members 0 / 13 报、1 / 12 放行）· AC11（block-roles · 首页配方池 + 反向对照）· AC13 的编辑器 schema ·
 * 建站填图不给 members 生成人脸（本票新加的那条排除，带反向对照）。
 * 几何（16 种组合三端无横向滚动、列数、照片尺寸、块头宽度、计算色）要浏览器：`tests/e2e/specs/1487-team-new-knobs.spec.ts`。
 *
 * 🔴 每一段都带反向对照（同一进程、单变量），证明判据真会红。
 * 夹具定死：演示内容包里的 Northside Auto Care（`scripts/lib/demo-content`，正文做什么 9）。
 */

'use strict';

const fs = require('fs');
const path = require('path');
const Module = require('module');
const ts = require('typescript');
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');

const NEXT = path.resolve(__dirname, '..');
// #1533 —— 各块共有的深底反白（标题 · eyebrow · 主按钮 / 描边 / link）收进了全站一份（site-css.js §DEEP_COMMON，按块点名），
//    块的 block.css 里不再有；这里断言本块在那张登记表里、值没变。
const DEEP = require(path.join(NEXT, 'scripts', 'lib', 'site-css.js')).DEEP_COMMON_CSS;
const SRC = path.join(NEXT, 'src');
const BLOCK = path.join(NEXT, 'blocks', 'team');
const SECTION = path.join(BLOCK, 'Section.tsx');

let pass = 0;
let fail = 0;
const ok = (m) => { pass += 1; console.log(`  ✅ ${m}`); };
const bad = (m) => { fail += 1; console.log(`  ❌ ${m}`); };
const die = (m) => { console.error(`🔴 跑不起来: ${m}`); process.exit(2); };
const check = (cond, m, detail) => (cond ? ok(m) : bad(detail ? `${m} —— ${detail}` : m));

// ── 让 node 能 require 这份 .tsx；Next 自己的换成替身（同 milestones-render.test.js）──────────────────────
const STUB_DIR = path.join(NEXT, 'scripts', '.team-stubs');
fs.mkdirSync(STUB_DIR, { recursive: true });
const stub = (name, body) => { const p = path.join(STUB_DIR, `${name}.js`); fs.writeFileSync(p, body); return p; };
const STUBS = {
  'next/link': stub('link', "const React=require('react');"
    // data-next-link —— 让断言分得出这一条走的是 next/link 还是裸 <a>（#1508 那条规则，见 AC7 末尾）。
    + "const L=({href,children,...r})=>React.createElement('a',{'data-next-link':'',href,...r},children);module.exports=L;module.exports.default=L;\n"),
};
process.on('exit', () => { try { fs.rmSync(STUB_DIR, { recursive: true, force: true }); } catch (e) { /* 收尾 */ } });
for (const ext of ['.tsx', '.ts']) {
  require.extensions[ext] = (mod, filename) => mod._compile(ts.transpileModule(fs.readFileSync(filename, 'utf-8'), {
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

let C; let DEMO; let manifestLib; let M; let icons;
try {
  C = require(SECTION).default;
  DEMO = require(path.join(NEXT, 'scripts', 'lib', 'demo-content')).DEMO_CONTENT['team'];
  manifestLib = require(path.join(NEXT, 'scripts', 'lib', 'block-manifest.js'));
  M = manifestLib.loadManifests().get('team');
  icons = require(path.join(NEXT, 'scripts', 'lib', 'icons.js'));
} catch (e) { die(`载入失败: ${e.message}`); }
if (!DEMO) die('demo-content 里没有 team');
if (!M) die('blocks/ 里没有 team');

const clone = (v) => JSON.parse(JSON.stringify(v));
const tableFor = (data) => icons.iconTableFor('team', data, { warn: () => {} });
const render = (shape, data, iconTable = tableFor(data)) => renderToStaticMarkup(React.createElement(C, {
  data, locale: 'en', iconTable, block: { id: 't', type: 'team', shape, data: {} },
}));
const withOpts = (o, extra = {}, base = DEMO) => ({ ...clone(base), ...extra, options: { ...(base.options || {}), ...o } });
const count = (html, needle) => html.split(needle).length - 1;
const own = (r) => r.problems.filter((p) => p.includes('("team")'));
const sectionTag = (html) => (/<section[^>]*>/.exec(html) || [''])[0];
const attr = (html, name) => { const m = new RegExp(`\\s${name}="([^"]*)"`).exec(sectionTag(html)); return m ? m[1] : null; };
const membersOf = (html) => html.split('data-part="member"').slice(1).map((x) => x.split('data-part="join"')[0]);
const CSS = fs.readFileSync(path.join(BLOCK, 'block.css'), 'utf-8');
const SRC_TEXT = fs.readFileSync(SECTION, 'utf-8');
const KNOB_NAMES = ['introPosition', 'introAlign', 'membersColumns', 'memberPhoto', 'photoShape', 'memberStyle', 'memberAlign'];
const dataAttr = (n) => `data-${n.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`)}`;

// ══ AC1：5 个预设逐字、旋钮名 / 值逐字、parts、目录集合、两两不同、旋钮独立 ═════════════════════════
console.log('── AC1 五个预设');
{
  // 列：名字 · 形态目录 · introPosition · introAlign · membersColumns · memberPhoto · photoShape · memberStyle · memberAlign · join（正文预设表逐字）
  const WANT = [
    ['Photo grid', 'photo-grid', 'top', 'center', '4', 'top', 'square', 'plain', 'left', false],
    ['Cards', 'cards', 'top', 'center', '2', 'top', 'circle', 'card', 'center', false],
    ['Side intro', 'side-intro', 'left', 'left', '2', 'top', 'square', 'plain', 'left', false],
    ['List', 'list', 'top', 'left', '2', 'left', 'circle', 'plain', 'left', false],
    ['Hiring', 'hiring', 'top', 'center', '3', 'top', 'circle', 'card', 'left', true],
  ];
  const got = (M.presets || []).map((p) => [p.name, p.shape, ...KNOB_NAMES.map((c) => p.knobs[c]), JSON.stringify(p.parts) === '["join"]']);
  check(JSON.stringify(got) === JSON.stringify(WANT), 'presets 5 条与正文表逐字相同（名字 · 形态 · 七列旋钮 · join）', JSON.stringify(got));
  check((M.presets || []).every((p) => Object.keys(p.knobs).join() === KNOB_NAMES.join()), '每个预设的 knobs 键就是这七个、同一顺序');
  check(M.presets.filter((p) => 'parts' in p).map((p) => `${p.name}:${JSON.stringify(p.parts)}`).join() === 'Hiring:["join"]',
    '只有 Hiring 带 parts，且逐字是 ["join"]');
  const knobs = M.slots.options.knobs.map((k) => [k.name, k.values]);
  check(JSON.stringify(knobs) === JSON.stringify([
    ['introPosition', ['left', 'right', 'top', 'bottom']], ['introAlign', ['left', 'center', 'right']],
    ['membersColumns', ['2', '3', '4']], ['memberPhoto', ['left', 'top']], ['photoShape', ['square', 'circle']],
    ['memberStyle', ['plain', 'card']], ['memberAlign', ['left', 'center']],
  ]), `slots.options.knobs 名字依次 ${knobs.map((k) => k[0]).join(' / ')}、values 与旋钮表逐字（#1481 起顺序只管展示，默认看 default ?? values[0]）`);
  check(require('./lib/block-knobs').knobDefault(M.slots.options.knobs.find((k) => k.name === 'memberPhoto')) === 'top', '#1481：memberPhoto 排成 left · top 之后，没写值时仍是 top（显式 default 钉住，顺序只管展示）');
  check(M.slots.options.knobs.filter((k) => 'default' in k).map((k) => k.name).join() === 'memberPhoto', '显式 default 只在 memberPhoto 上（#1481：排序挪了第一项的只有它）');
  check(JSON.stringify(M.parts) === '["join"]', `顶层 parts == ["join"]（${JSON.stringify(M.parts)}）`);
  const dirs = fs.readdirSync(BLOCK, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name).sort();
  check(JSON.stringify(dirs) === JSON.stringify(WANT.map((w) => w[1]).sort()), `目录集合 == 5 个预设形态（${dirs.join(' / ')}）`);
  check(dirs.every((d) => !fs.existsSync(path.join(BLOCK, d, 'Section.tsx'))), '一份 Section.tsx（形态目录里没有第二份 markup）');
  check(M.skin === 'site-css' && M.roleDefault === 'optional', `skin=${M.skin} · roleDefault=${M.roleDefault}`);
  const htmls = dirs.map((d) => render(d, clone(DEMO)));
  check(new Set(htmls).size === 5, `同一份夹具下 5 个预设渲染出 ${new Set(htmls).size} 份互不相同的 HTML`);
  const pinned = dirs.map((d) => render(d, withOpts(M.presets[0].knobs)).replace(/data-shape="[^"]*"/g, ''));
  check(new Set(pinned).size === 1, '反向对照：options 里写死七个旋钮 ⟹ 5 个预设（去掉 data-shape 之后）塌成同一份 —— 判据分得开');
  const r = render('photo-grid', clone(DEMO));
  const miss = KNOB_NAMES.filter((n) => attr(r, dataAttr(n)) !== M.presets[0].knobs[n]);
  check(miss.length === 0, 'Photo grid：七个旋钮都写在 <section> 上', miss.join(' · '));
  // 旋钮独立：拧一个，其余六个不变（组件里没有联动纠正）。
  const base = M.presets[4].knobs;
  const moved = [];
  for (const k of M.slots.options.knobs) {
    for (const v of k.values) {
      const h = render('hiring', withOpts({ [k.name]: v }));
      const others = KNOB_NAMES.filter((n) => n !== k.name);
      if (attr(h, dataAttr(k.name)) !== v || others.some((n) => attr(h, dataAttr(n)) !== base[n])) moved.push(`${k.name}=${v}`);
    }
  }
  check(moved.length === 0, `旋钮独立（Hiring 上逐个拧 ${M.slots.options.knobs.reduce((n, k) => n + k.values.length, 0)} 档）：拧的那个到位、其余六个不变`, moved.join(' · '));
  check(!KNOB_NAMES.some((n) => /^member(Bio|Links)$/.test(n)) && !/memberBio|memberLinks/.test(JSON.stringify(M)),
    '图册的 +memberBio / +memberLinks 两个勾选框没有做成旋钮（bio / links 是内容，有就渲染）');
}

// ══ AC4：照片 ═══════════════════════════════════════════════════════════════════════════════════
console.log('\n── AC4 照片');
{
  const h = render('photo-grid', clone(DEMO));
  check(count(h, '<img') === DEMO.members.length, `夹具 ${DEMO.members.length} 位成员都有 photo ⟹ ${count(h, '<img')} 张 <img>`);
  const d = clone(DEMO); delete d.members[1].photo;
  const per = membersOf(render('photo-grid', d)).map((x) => (x.includes('<img') ? 1 : 0));
  check(per.join('') === '101111', `第 2 位没写 photo ⟹ 只那一位没有 <img>（${per.join('')}）`);
  const m2 = membersOf(render('photo-grid', d))[1];
  check(m2.includes('data-slot="members.1.name"') && m2.includes('data-slot="members.1.role"') && m2.includes('data-part="bio"') && m2.includes('data-part="links"'),
    '没写 photo 的那一位：名字 / 职位 / 简介 / 链接照常');
  const noUrl = clone(DEMO); noUrl.members[0].photo = { alt: 'x' };
  check(membersOf(render('photo-grid', noUrl))[0].indexOf('<img') === -1, 'photo 只有 alt、没有 imageUrl ⟹ 不渲染');
  check(/alt="Marcus Oyelaran"/.test(h), '<img> 的 alt 取 photo.alt');
  check(/\[data-member-photo="top"\]\[data-photo-shape="square"\] \.tm-photo img \{\s*width: 100%;\s*aspect-ratio: 1 \/ 1;\s*border-radius: 1rem;/.test(CSS),
    'block.css：top + square = 宽 100%、1:1、圆角 1rem');
  check(/\[data-member-photo="top"\]\[data-photo-shape="circle"\] \.tm-photo img \{\s*width: 6rem;\s*height: 6rem;\s*border-radius: 50%;/.test(CSS),
    'block.css：top + circle = 6rem 圆');
  check(/\[data-member-photo="left"\] \.tm-photo img \{\s*width: 5rem;\s*height: 5rem;\s*border-radius: 0\.75rem;/.test(CSS)
    && /\[data-member-photo="left"\]\[data-photo-shape="circle"\] \.tm-photo img \{\s*border-radius: 50%;/.test(CSS),
    'block.css：left = 5rem 方图（圆角 .75rem）或圆');
}

// ══ AC5（源码一半）：块头宽度 ═══════════════════════════════════════════════════════════════════
console.log('\n── AC5 块头宽度（源码）');
{
  check(count(SRC_TEXT + CSS, '64ch') === 0 && count(SRC_TEXT + CSS, '52ch') === 0, `组件与 block.css 里 64ch / 52ch 各 ${count(SRC_TEXT + CSS, '64ch')} / ${count(SRC_TEXT + CSS, '52ch')} 处`);
  check(/@media \(min-width: 992px\) \{\s*\[data-block="team"\]\[data-intro-align="center"\] \.tm-intro-text \{\s*max-width: 80%;\s*margin-inline-start: auto;\s*margin-inline-end: auto;/.test(CSS),
    'center 在 ≥992 最宽 80%、居中（<992 没有这条 = 100%）');
  check(/\[data-intro-position="left"\] \.tm-intro-text,\s*\[data-block="team"\]\[data-intro-position="right"\] \.tm-intro-text \{\s*max-width: none;\s*margin: 0;/.test(CSS),
    'introPosition left / right（≥992）⟹ 80% 那条取消、占满侧列');
  check(/\[data-intro-position="left"\] \.tm-introcol,\s*\[data-block="team"\]\[data-intro-position="right"\] \.tm-introcol \{\s*flex: 0 0 auto;\s*width: 33\.3333%;\s*position: sticky;\s*top: 2rem;/.test(CSS),
    'left / right 块头一列 33.33%、sticky top 2rem');
}

// ══ AC7：部件 ═══════════════════════════════════════════════════════════════════════════════════
console.log('\n── AC7 部件');
{
  const full = render('hiring', clone(DEMO));
  check(count(full, 'data-part="join"') === 1, '夹具带 join ⟹ 一张招聘卡');
  check(full.lastIndexOf('data-part="member"') < full.indexOf('data-part="join"'), '招聘卡排在成员网格的最后一格');
  check(/class="tm-member" data-part="join"/.test(full), '招聘卡跟成员同一个格子类（.tm-member，同宽）');
  check(/class="tm-join-icon[^"]*"[^>]*><svg[^>]*data-icon="person-plus"/.test(full), '招聘卡图标圈里是 person-plus 的内联 <svg>');
  check(/class="btn btn-outline-primary[^"]*tm-join-cta"/.test(full), '招聘卡按钮是描边按钮');
  const noJoin = clone(DEMO); delete noJoin.join;
  check(count(render('hiring', noJoin), 'data-part="join"') === 0 && count(render('hiring', noJoin), 'tm-join') === 0, 'join 清空 ⟹ 招聘卡节点不存在');
  const emptyJoin = clone(DEMO); emptyJoin.join = { cta: DEMO.join.cta };
  check(count(render('hiring', emptyJoin), 'data-part="join"') === 0, 'join 只剩按钮、没有标题和正文 ⟹ 也不渲染');
  for (const [field, needle] of [['bio', 'data-part="bio"'], ['links', 'data-part="links"']]) {
    const d = clone(DEMO); delete d.members[2][field];
    const per = membersOf(render('hiring', d)).map((x) => (x.includes(needle) ? 1 : 0));
    check(per.join('') === '110111', `第 3 位清空 ${field} ⟹ 只那一位没有这个节点（${per.join('')}）`);
  }
  const allNoBio = clone(DEMO); allNoBio.members.forEach((m) => { delete m.bio; delete m.links; });
  const nb = render('hiring', allNoBio);
  check(count(nb, 'data-part="bio"') === 0 && count(nb, 'data-part="links"') === 0 && count(nb, 'tm-bio') === 0, '全员清空 bio / links ⟹ 一个 bio / links 节点都没有');
  // 每条 link 的 <a> 里一个非空的内联 <svg>；<a> 的条数 == 夹具里 link 的条数。
  const want = DEMO.members.reduce((n, m) => n + m.links.length, 0);
  const anchors = full.match(/<a class="tm-link[^"]*"[^>]*>[\s\S]*?<\/a>/g) || [];
  const filled = anchors.filter((a) => /<svg[^>]*>[\s\S]*?<path[\s\S]*?<\/svg>/.test(a));
  check(anchors.length === want && filled.length === want, `夹具 ${want} 条 link ⟹ ${anchors.length} 个 <a>、其中 ${filled.length} 个带非空内联 <svg>`);
  // #1508 那条规则：站内路径走 next/link（展示站 basePath 下裸 <a> 不吃前缀）；mailto: / tel: / https: 保持裸 <a>。
  const mixed = clone(DEMO);
  mixed.members[0].links = [{ icon: 'linkedin', href: '/about' }, { icon: 'envelope', href: 'mailto:a@b.example' }, { icon: 'telephone', href: 'tel:+1' }, { icon: 'instagram', href: 'https://x.example/' }];
  const linksOf0 = (membersOf(render('hiring', mixed))[0].match(/<a [^>]*data-part="link"[^>]*>/g) || []);
  const viaLink = linksOf0.map((a) => (a.includes('data-next-link') ? 1 : 0)).join('');
  check(linksOf0.length === 4 && viaLink === '1000', `成员链接 /about 走 next/link、mailto / tel / https 走裸 <a>（${viaLink}）`);
  check(/data-next-link=""[^>]*tm-join-cta/.test(full), '对照：招聘卡按钮（/contact）走的是 next/link，替身的标记读得出来');
  // 阳性对照：把一条 link 的 `icon` 键改名成 `kind` ⟹ 图标表里收不到、那一条画不出来，上面那格就红。
  const renamed = clone(DEMO); renamed.members[0].links[0] = { kind: renamed.members[0].links[0].icon, href: renamed.members[0].links[0].href };
  const ra = render('hiring', renamed).match(/<a class="tm-link[^"]*"[^>]*>[\s\S]*?<\/a>/g) || [];
  const rf = ra.filter((a) => /<svg[^>]*>[\s\S]*?<path[\s\S]*?<\/svg>/.test(a));
  check(!(ra.length === want && rf.length === want), `阳性对照：第 1 位第 1 条 link 的 icon 改名 kind ⟹ 那格红（<a> ${ra.length} / 带图标 ${rf.length}，期望 ${want}）`);
  check(icons.iconNamesIn({ links: [{ kind: 'linkedin' }] }).size === 0 && icons.iconNamesIn({ links: [{ icon: 'linkedin' }] }).has('linkedin'),
    '对照的机理：iconNamesIn 只收键名正好是 icon 的值');
  const badName = clone(DEMO); badName.members[0].links[0].icon = 'no-such-icon-xyz';
  check(membersOf(render('hiring', badName))[0].match(/data-part="link"/g).length === DEMO.members[0].links.length - 1, '图标名查不到 ⟹ 那一条 link 不画（不留一个空 <a>）');
  check(count(render('hiring', clone(DEMO), {}), '<svg') === 0, '对照：不给图标表 ⟹ 一个 <svg> 都没有（图标全靠服务端那张表）');
  check(JSON.stringify(icons.BLOCK_ICONS['team']) === '["person-plus","arrow-right"]' && icons.usesIconTable('team'),
    `BLOCK_ICONS['team'] = ${JSON.stringify(icons.BLOCK_ICONS['team'])}`);
  const noHead = clone(DEMO); delete noHead.headline; delete noHead.body;
  const nh = render('hiring', noHead);
  check(!nh.includes('data-part="intro"') && nh.includes('data-part="members"'), 'headline + body 都清空 ⟹ 块头那一列不渲染、成员照画');
  const styles = M.slots.introEyebrow.choices.style.filter((s) => s !== 'none')
    .map((s) => (/data-eyebrow="([^"]*)"/.exec(render('hiring', { ...clone(DEMO), introEyebrow: { text: 'x', style: s } })) || [])[1]);
  check(styles.join() === 'pill,outline,dash,plain', `introEyebrow 四式都画得出来（${styles.join(' / ')}）`);
  check(!render('hiring', { ...clone(DEMO), introEyebrow: { text: 'x', style: 'none' } }).includes('data-part="eyebrow"'), 'introEyebrow.style=none ⟹ 不渲染');
}

// ══ AC8：memberPhoto=left 时 memberAlign 不起作用 ════════════════════════════════════════════════
console.log('\n── AC8 memberAlign 在照片在左时不起作用');
{
  const strip = (h) => h.replace(/\sdata-member-align="[^"]*"/, '');
  const l = render('list', withOpts({ memberAlign: 'left' }));
  const c = render('list', withOpts({ memberAlign: 'center' }));
  check(attr(l, 'data-member-align') === 'left' && attr(c, 'data-member-align') === 'center' && strip(l) === strip(c),
    'memberPhoto=left：拧 memberAlign ⟹ HTML 除 data-member-align 外逐字相同');
  const tl = render('cards', withOpts({ memberAlign: 'left' }));
  const tc = render('cards', withOpts({ memberAlign: 'center' }));
  check(strip(tl) === strip(tc), '（markup 本来就不随 memberAlign 变 —— 起不起作用住在 block.css）');
  const alignRules = CSS.split('}').filter((r) => r.includes('[data-member-align="center"]'));
  check(alignRules.length >= 3 && alignRules.every((r) => (r.match(/\[data-member-align="center"\]/g) || []).length === (r.match(/\[data-member-align="center"\]\[data-member-photo="top"\]/g) || []).length),
    `block.css：${alignRules.length} 条 memberAlign 规则每个选择器都带 [data-member-photo="top"]`);
}

// ══ AC9：bg ══════════════════════════════════════════════════════════════════════════════════════
console.log('\n── AC9 bg');
{
  const at = (bg) => render('hiring', withOpts({}, { bg }));
  check(attr(at('#0f172a'), 'data-tone') === 'dark' && /style="background:#0f172a"/.test(sectionTag(at('#0f172a'))), '#0f172a ⟹ data-tone="dark"、<section> 底色 #0f172a');
  check(attr(at('#ffffff'), 'data-tone') === 'light', '#ffffff ⟹ light');
  check(attr(at('brand'), 'data-tone') === 'brand', 'brand ⟹ data-tone="brand"');
  const g = at({ stops: ['#7d52f4', '#f7b733'], angle: 135 });
  check(/style="background:linear-gradient\(135deg,#7d52f4,#f7b733\)"/.test(sectionTag(g)) && attr(g, 'data-tone') === 'dark', '渐变 ⟹ linear-gradient(135deg,…) + data-tone="dark"（toneForBg）');
  check(count(SRC_TEXT, 'toneFor(') === 0 && count(SRC_TEXT, 'linear-gradient') === 0 && count(SRC_TEXT, 'toneForBg(') === 1,
    `Section.tsx 里 toneFor( ${count(SRC_TEXT, 'toneFor(')} 处、linear-gradient ${count(SRC_TEXT, 'linear-gradient')} 处、toneForBg( ${count(SRC_TEXT, 'toneForBg(')} 处`);
  const { ON_DEEP_MUTED } = require(path.join(NEXT, 'scripts', 'lib', 'site-css.js'));
  check(/\[data-tone="dark"\] \.text-muted,/.test(ON_DEEP_MUTED) && !/\.text-muted\s*\{[^}]*rgba\(255, 255, 255/.test(CSS) && /class="tm-bio text-sm text-muted/.test(at('#0f172a')),
    '简介是 .text-muted ⟹ 深底白 .92 由全站那条给（block.css 里没有自己那份）');
  check(/\[data-tone="dark"\] \.tm-name,[\s\S]*?\[data-tone="brand"\] \.tm-name,[\s\S]*?\{\s*color: #fff !important;/.test(CSS)
    && /\[data-block="team"\]\[data-tone="dark"\] \.tm-title,[\s\S]*?\{\s*color: #fff !important;/.test(DEEP), 'dark / brand 时名字反白（block.css）、标题反白（site-css §DEEP_COMMON）');
  check(/\[data-tone="dark"\]\[data-member-style="card"\] \.tm-inner,[\s\S]*?\{\s*background: rgba\(255, 255, 255, 0\.06\);/.test(CSS)
    && /\[data-tone="dark"\] \.tm-join,[\s\S]*?\{\s*border-color: rgba\(255, 255, 255, 0\.35\);/.test(CSS)
    && /\[data-block="team"\]\[data-tone="dark"\] \.btn-outline-primary,[\s\S]*?\{\s*color: #fff !important;/.test(DEEP),
    'block.css：card .06 底、招聘卡虚线 .35 白；描边按钮反白在 site-css §DEEP_COMMON');
  check(JSON.stringify(M.slots.bg) === JSON.stringify(manifestLib.loadManifests().get('footer').slots.bg), 'bg 槽对象与 footer 的 slots.bg 逐字相同');
}

// ══ AC10 前半：validateSite ═════════════════════════════════════════════════════════════════════
console.log('\n── AC10 validateSite（members 条数）');
{
  const member = (i) => ({ name: `Person ${i}`, role: 'Technician' });
  const v = (data) => own(manifestLib.validateSite({ pages: [{ slug: 'p', blocks: [{ type: 'team', data: { headline: 'H', ...data } }] }], scope: 'edit' }));
  for (const n of [0, 13]) {
    const r = v({ members: Array.from({ length: n }, (_, i) => member(i)) });
    check(r.length >= 1 && r.every((p) => p.includes('members')), `members ${n} 条 ⟹ 被拦、报错点名 members`, JSON.stringify(r));
  }
  for (const n of [1, 12]) {
    const r = v({ members: Array.from({ length: n }, (_, i) => member(i)) });
    check(r.length === 0, `members ${n} 条 ⟹ 放行`, JSON.stringify(r));
  }
  for (const p of M.presets) {
    const r = own(manifestLib.validateSite({ pages: [{ slug: 'p', blocks: [{ type: 'team', shape: p.shape, data: { ...clone(DEMO), options: p.knobs } }] }], scope: 'edit' }));
    check(r.length === 0, `预设 ${p.name} 那组值（七个旋钮写全）+ 演示内容 ⟹ 放行`, JSON.stringify(r));
  }
}

// ══ AC6（纯函数一半）：预设带部件 —— presetNameFor / presetClickProps；AC10 后半：声明校验 ══════════════════
console.log('\n── AC6 预设带部件（presetNameFor / presetClickProps）· AC10 后半（knobDeclarationProblems）');
{
  const K = require(path.join(NEXT, 'scripts', 'lib', 'block-knobs.js'));
  const { editorSchema } = require(path.join(NEXT, 'scripts', 'lib', 'editor-schema.js'));
  const H = M.presets.find((p) => p.name === 'Hiring');
  const name = (knobs, join) => K.presetNameFor(M, { ...knobs, join });
  const JOIN = clone(DEMO.join);
  check(name(H.knobs, JOIN) === 'Hiring', `Hiring 的旋钮 + join 有内容 ⟹ Hiring（${name(H.knobs, JOIN)}）`);
  check(name(H.knobs, undefined) === 'custom', `Hiring 的旋钮 + join 空 ⟹ Custom（${name(H.knobs, undefined)}）`);
  check(name(H.knobs, { title: '', body: '  ', cta: { label: 'x', href: '/' } }) === 'custom',
    'join 只剩按钮（title / body 空，招聘卡不画）⟹ 也算空、Custom');
  const cards = M.presets.find((p) => p.name === 'Cards');
  check(name(cards.knobs, JOIN) === 'Cards' && name(cards.knobs, undefined) === 'Cards', '没写 parts 的预设（Cards）不看 join：有没有都亮');
  // 渲染那一侧同一条判据：join 只剩按钮 ⟹ 招聘卡不画。
  check(!render('hiring', { ...clone(DEMO), join: { title: '', body: '', cta: JOIN.cta } }).includes('data-part="join"'),
    '渲染侧同一条判据：只剩按钮的 join 不画招聘卡');

  const field = editorSchema({}).components.find((c) => c.type === 'team').fields.find((f) => f.slot === 'options');
  check(JSON.stringify(field.partDemos) === JSON.stringify({ join: M.slots.join.demo }), 'editor schema 带下去 partDemos == { join: slots.join.demo }');
  check(JSON.stringify(field.presets.find((p) => p.name === 'Hiring').parts) === '["join"]', 'editor schema 的 Hiring 带 parts');
  const nameOf = (props) => K.presetNameFor({ slots: { options: { knobs: field.knobs } }, presets: field.presets }, { ...props.options, join: props.join });
  // 三步：空 join 点 Hiring ⟹ demo 填上、Hiring 亮；再点 Cards ⟹ Cards 亮、join 还在；清空 join ⟹ Custom。
  const base = { ...clone(DEMO), options: { ...cards.knobs } }; delete base.join;
  let props = K.presetClickProps(field, base, 'Hiring');
  check(JSON.stringify(props.join) === JSON.stringify(M.slots.join.demo) && nameOf(props) === 'Hiring',
    `① join 空时点 Hiring ⟹ 用 demo 填上、Hiring 亮（${nameOf(props)}）`);
  props.join = { ...props.join, title: 'We are hiring techs' };
  props = K.presetClickProps(field, props, 'Cards');
  check(props.join && props.join.title === 'We are hiring techs' && nameOf(props) === 'Cards', `② 再点 Cards ⟹ Cards 亮、join 内容还在（${nameOf(props)}）`);
  props = K.presetClickProps(field, props, 'Hiring');
  check(props.join.title === 'We are hiring techs', '已有内容时点 Hiring ⟹ 不覆盖');
  props = { ...props, join: undefined };
  check(nameOf(props) === 'custom', `③ 把 join 清空 ⟹ Hiring 不亮（${nameOf(props)}）`);
  check(render('hiring', { ...clone(DEMO), options: K.presetClickProps(field, base, 'Hiring').options, join: K.presetClickProps(field, base, 'Hiring').join }).includes('data-part="join"'),
    '点 Hiring 之后渲染出招聘卡');
  // 反向：pricing（带颜色、不带部件）点 Rainbow 不会凭空长出部件。
  const pf = editorSchema({}).components.find((c) => c.type === 'pricing');
  if (pf) {
    const of = pf.fields.find((f) => f.slot === 'options');
    check(JSON.stringify(of.partDemos) === '{}', '没有带部件预设的块 partDemos 是 {}');
  }
  check(JSON.stringify(K.presetPartFills(M, 'Cards')) === '{}' && JSON.stringify(Object.keys(K.presetPartFills(M, 'Hiring'))) === '["join"]',
    'presetPartFills：Cards = {}、Hiring = { join }');

  // AC10 后半：声明校验。
  check(K.knobDeclarationProblems(M).length === 0, `team 自己的声明 0 条问题（${JSON.stringify(K.knobDeclarationProblems(M))}）`);
  const bad = clone(M); bad.presets.find((p) => p.name === 'Hiring').parts = ['help'];
  const pr = K.knobDeclarationProblems(bad);
  check(pr.length === 1 && pr[0].includes('"help"') && pr[0].includes('顶层'), `预设 parts 写了顶层没有的 "help" ⟹ 报一条（${JSON.stringify(pr)}）`);
  const nodemo = clone(M); delete nodemo.slots.join.demo;
  const pr2 = K.knobDeclarationProblems(nodemo);
  check(pr2.length === 1 && pr2[0].includes('demo'), `join 槽没有 demo ⟹ 报一条（${JSON.stringify(pr2)}）`);
  const notarr = clone(M); notarr.presets.find((p) => p.name === 'Hiring').parts = 'join';
  check(K.knobDeclarationProblems(notarr).some((x) => x.includes('字符串数组')), 'parts 不是数组 ⟹ 报');
  // 组合里算进部件：一个旋钮跟 Cards 一样、只多 parts 的预设不算「一模一样」；两个都带同样 parts 才算。
  const dup = clone(M); dup.presets.find((p) => p.name === 'Hiring').knobs = { ...cards.knobs };
  check(!K.knobDeclarationProblems(dup).some((x) => x.includes('一模一样')), 'Hiring 旋钮改成跟 Cards 一样但带部件 ⟹ 组合不算重复');
  check(K.presetNameFor(dup, { ...cards.knobs, join: JOIN }) === 'Hiring' && K.presetNameFor(dup, { ...cards.knobs }) === 'Cards',
    '那时带部件的先判：join 有内容 ⟹ Hiring；清空 ⟹ 回落 Cards');
}

// ══ 建站填图：members 不生成人脸（槽上写 generateImages: false，#1488 那条声明）═══════════════════════
console.log('\n── 建站填图不给 members 生成照片');
{
  const { collectImageSlots } = require(path.join(NEXT, 'scripts', 'lib', 'image-slots.js'));
  const pages = [{ slug: 'home', blocks: [{ type: 'team', data: clone(DEMO) }] }];
  const all = manifestLib.loadManifests();
  check(M.slots.members.generateImages === false, 'manifest 的 members 槽写着 generateImages: false');
  check(manifestLib.imageSlotsOf(M).length === 0 && collectImageSlots(pages, all).length === 0, 'imageSlotsOf(team) 空、collectImageSlots 在一页 team 上 0 个槽');
  // 反向对照：同一份 manifest 只拿掉那条声明 ⟹ 每位成员一个槽（证明排除靠的是声明，不是槽名）。
  const undeclared = clone(M); delete undeclared.slots.members.generateImages;
  const got = collectImageSlots(pages, new Map([['team', undeclared]]));
  check(got.length === DEMO.members.length && got.every((s) => s.imageKey === 'photo'), `反向对照：拿掉 generateImages ⟹ ${got.length} 个槽（imageKey=photo）`);
  const { IMAGE_FIELDS } = require(path.join(NEXT, 'scripts', 'lib', 'image-urls.js'));
  check(IMAGE_FIELDS.includes('imageUrl'), '写入闸那一侧仍认得 members[].photo.imageUrl 是图片地址（IMAGE_FIELDS 含 imageUrl）');
}

// ══ AC11：block-roles · 首页配方 ══════════════════════════════════════════════════════════════════
console.log('\n── AC11 block-roles · 首页配方');
{
  const roles = JSON.parse(fs.readFileSync(path.join(SRC, 'lib', 'sections', 'block-roles.json'), 'utf-8'));
  check(roles['team'] === M.roleDefault, `block-roles.json 的 team（${roles['team']}）== manifest roleDefault（${M.roleDefault}）`);
  const recipe = require(path.join(NEXT, 'scripts', 'lib', 'homepage-recipe.js'));
  const all = manifestLib.loadManifests();
  const pool = recipe.poolFor(all);
  // 📌 #1425（T3）—— 这里原来测「team-grid 在 NOT_IN_POOL、拿掉它两个都进池、种数 == 交付前、order 紧挨它、它在 block-roles 里仍 optional」；team-grid 随旧库删了。今天的不变量：team 在池里、池子 11 种、排除名单不点它。
  check(pool.includes('team') && !('team' in recipe.NOT_IN_POOL) && pool.length === 11, `poolFor 含 team、team 不在 NOT_IN_POOL、池子 11 种（读到 ${pool.length}）`);
  // 反向对照：把 team 放进排除名单 ⟹ 它出池、种数 -1 —— 判据分得开。
  recipe.NOT_IN_POOL['team'] = 'test';
  let outPool;
  try { outPool = recipe.poolFor(all); } finally { delete recipe.NOT_IN_POOL['team']; }
  check(!outPool.includes('team') && outPool.length === pool.length - 1, `反向对照：排除 team ⟹ 它出池、种数 ${pool.length} → ${outPool.length}（-1）`);
  check(M.prompt.group === 'homepage', 'prompt.group == homepage');
  const lines = M.prompt.lines.join('\n');
  check(/real people/.test(lines) && /leave the block out/.test(lines) && /uploaded a photo/.test(lines) && /hiring/.test(lines) && /top-level in data \(not inside options\)/.test(lines),
    'prompt.lines：只写真实的人、编不出就别放、photo 只用上传的、join 只在招人时写、bg 在 data 顶层');
  const pool2 = JSON.parse(fs.readFileSync(path.join(NEXT, 'scripts', 'theme-pool.json'), 'utf-8'));
  const shapes = Object.fromEntries(Object.entries(pool2).map(([id, t]) => [id, t.shapes['team']]));
  check(Object.values(shapes).every((s) => M.presets.some((p) => p.shape === s)), `theme-pool 两套都给了 team 一个预设形态（${JSON.stringify(shapes)}）`);
}

// ══ AC13（编辑器 schema 一半；往返无损由 editor-roundtrip.test.js 对全部页面块量）═══════════════════════
console.log('\n── AC13 编辑器 schema');
{
  const { editorSchema } = require(path.join(NEXT, 'scripts', 'lib', 'editor-schema.js'));
  const on = editorSchema({}).components.find((c) => c.type === 'team');
  check(!!on, 'Puck 组件里有 team（能从左栏拖进页面）');
  const order = on.fields.map((f) => f.slot);
  check(JSON.stringify(order) === JSON.stringify(['options', 'introEyebrow', 'headline', 'body', 'members', 'join', 'bg']),
    `字段顺序 = 旋钮 → 眉标 → 块头 → 成员 → 招聘卡 → bg（${order.join(' → ')}）`);
  const mem = on.fields.find((f) => f.slot === 'members');
  check(mem.control === 'list' && mem.subs.map((x) => x.sub).join() === 'name,role,bio', `members 是列表字段、每条可改 name / role / bio（${mem.subs.map((x) => x.sub).join(' / ')}）`);
  const j = on.fields.find((f) => f.slot === 'join');
  check(j.control === 'object' && j.subs.map((x) => x.sub).join() === 'title,body', `join 是对象字段、可改 title / body（${j.subs.map((x) => x.sub).join(' / ')}）`);
  // 面板列出来的每个可改的字，组件都挂了 data-slot（否则面板里那一格改不动任何东西）。
  const h = render('hiring', clone(DEMO));
  const paths = manifestLib.editableSlotPaths(M).map((e) => (e.sub ? `${e.slot}.${e.kind === 'list' ? '0.' : ''}${e.sub}` : e.slot));
  const missing = paths.filter((p) => !h.includes(`data-slot="${p}"`));
  check(missing.length === 0, `editLabel 的 ${paths.length} 个路径都在渲染产物的 data-slot 里`, missing.join(' · '));
}

// 📌 #1425（T3）—— 这里原来测 AC14「blocks/team-grid 相对 merge-base 零改动」；team-grid 随旧库删了。

console.log(`\n══ 汇总: 通过 ${pass} · 失败 ${fail} ══`);
process.exit(fail ? 1 : 0);
