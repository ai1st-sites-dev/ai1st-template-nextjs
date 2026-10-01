#!/usr/bin/env node
/**
 * content-new-render.test.js — #1498 验收里「看渲染出来的 HTML / 调一次校验器就能判」的那几条。
 *
 * 跑法:  node scripts/content-new-render.test.js   （或 `npm run test:scripts`，它按文件名发现）
 * 退出码: 0 全过 · 1 有失败 · 2 跑不起来（**不许当成通过**）
 *
 * 管哪几条：AC1（4 个预设逐字、旋钮名 / 值逐字、目录集合、两两不同、旋钮独立）· AC3 的组件与校验一半
 * （富文本画成 <p>/<ul>/<strong>/<a>、HTML 原样转义、坏协议链接只剩文字、validateSite 各报一条；
 * 解析器本身逐字那一半在 `scripts/richtext.test.js`）· AC5 / AC6 / AC7 的 DOM 一半（statement 没标题时 eyebrow 仍在、
 * 图在卡外、image=none 没有 <img>、按钮截到 max 2）· AC8（bg 给 tone、不自己算亮度）· AC9（block-roles · 首页配方池 ·
 * 内页提示词）· AC10 的数据一半（ctas.max）· AC12（text-block / content-split 零改动）。
 * 几何（16 种组合三端无横向滚动、宽度、1:2、字号、图的位置、计算色）要浏览器：`tests/e2e/specs/1498-content-new-knobs.spec.ts`。
 *
 * 🔴 每一段都带反向对照（同一进程、单变量），证明判据真会红。
 * 夹具定死：演示内容包里的 Northside Auto Care（`scripts/lib/demo-content`，正文做什么 8）。
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
const BLOCK = path.join(NEXT, 'blocks', 'content-new');
const SECTION = path.join(BLOCK, 'Section.tsx');

let pass = 0;
let fail = 0;
const ok = (m) => { pass += 1; console.log(`  ✅ ${m}`); };
const bad = (m) => { fail += 1; console.log(`  ❌ ${m}`); };
const die = (m) => { console.error(`🔴 跑不起来: ${m}`); process.exit(2); };
const check = (cond, m, detail) => (cond ? ok(m) : bad(detail ? `${m} —— ${detail}` : m));

// ── 让 node 能 require 这份 .tsx；Next 自己的换成替身（同 milestones-render.test.js）────────────────────
const STUB_DIR = path.join(NEXT, 'scripts', '.content-new-stubs');
fs.mkdirSync(STUB_DIR, { recursive: true });
const stub = (name, body) => { const p = path.join(STUB_DIR, `${name}.js`); fs.writeFileSync(p, body); return p; };
const STUBS = {
  'next/link': stub('link', "const React=require('react');"
    + "const L=({href,children,...r})=>React.createElement('a',{href,...r},children);module.exports=L;module.exports.default=L;\n"),
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

let C; let DEMO; let manifestLib; let M; let icons; let recipe;
try {
  C = loadSection();
  DEMO = require(path.join(NEXT, 'scripts', 'lib', 'demo-content')).DEMO_CONTENT['content-new'];
  manifestLib = require(path.join(NEXT, 'scripts', 'lib', 'block-manifest.js'));
  M = manifestLib.loadManifests().get('content-new');
  icons = require(path.join(NEXT, 'scripts', 'lib', 'icons.js'));
  recipe = require(path.join(NEXT, 'scripts', 'lib', 'homepage-recipe.js'));
} catch (e) { die(`载入失败: ${e.message}`); }
if (!DEMO) die('demo-content 里没有 content-new');
if (!M) die('blocks/ 里没有 content-new');

const clone = (v) => JSON.parse(JSON.stringify(v));
const TABLE = icons.iconTableFor('content-new', DEMO, { warn: () => {} });
const render = (shape, data, Comp = C) => renderToStaticMarkup(React.createElement(Comp, {
  data, locale: 'en', iconTable: TABLE, block: { id: 'c', type: 'content-new', shape, data: {} },
}));
const withOpts = (o, extra = {}, base = DEMO) => ({ ...clone(base), ...extra, options: { ...(base.options || {}), ...o } });
const count = (html, needle) => html.split(needle).length - 1;
const own = (r) => r.problems.filter((p) => p.includes('("content-new")'));
const sectionTag = (html) => (/<section[^>]*>/.exec(html) || [''])[0];
const attr = (html, name) => { const m = new RegExp(`${name}="([^"]*)"`).exec(sectionTag(html)); return m ? m[1] : null; };
const dataAttr = (knob) => `data-${knob.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`)}`;
const bodyOf = (html) => (/<div class="co-body"[^>]*>([\s\S]*?)<\/div>/.exec(html) || [null, null])[1];
const KNOB_NAMES = ['headlinePosition', 'textAlign', 'textStyle', 'image', 'frame'];

// ══ AC1：4 个预设逐字、旋钮名 / 值逐字、目录集合、两两不同、旋钮独立 ═══════════════════════════════
console.log('── AC1 四个预设');
{
  // 列：名字 · 形态目录 · headlinePosition · textAlign · textStyle · image · frame（正文预设表逐字）
  const WANT = [
    ['Article', 'article', 'top', 'left', 'article', 'none', 'none'],
    ['Title left', 'title-left', 'left', 'left', 'article', 'none', 'none'],
    ['Image right', 'image-right', 'top', 'left', 'article', 'right', 'none'],
    ['Statement', 'statement', 'top', 'left', 'statement', 'none', 'card'],
  ];
  const got = (M.presets || []).map((p) => [p.name, p.shape, ...KNOB_NAMES.map((c) => p.knobs[c])]);
  check(JSON.stringify(got) === JSON.stringify(WANT), 'presets 4 条与正文表逐字相同（名字 · 形态 · 五列旋钮）', JSON.stringify(got));
  const knobs = M.slots.options.knobs.map((k) => [k.name, k.values]);
  check(JSON.stringify(knobs) === JSON.stringify([
    ['headlinePosition', ['top', 'left']], ['textAlign', ['left', 'center']], ['textStyle', ['article', 'statement']],
    ['image', ['none', 'left', 'right', 'top', 'bottom']], ['frame', ['none', 'card']],
  ]), `slots.options.knobs 名字依次 ${knobs.map((k) => k[0]).join(' / ')}、values 与定稿表逐字（values[0] = 默认）`);
  const dirs = fs.readdirSync(BLOCK, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name).sort();
  check(JSON.stringify(dirs) === JSON.stringify(WANT.map((w) => w[1]).sort()), `目录集合 == 4 个预设形态（${dirs.join(' / ')}）`);
  check(dirs.every((d) => !fs.existsSync(path.join(BLOCK, d, 'Section.tsx'))), '一份 Section.tsx（形态目录里没有第二份 markup）');
  check(M.skin === 'site-css' && M.roleDefault === 'optional', `skin=${M.skin} · roleDefault=${M.roleDefault}`);
  const htmls = dirs.map((d) => render(d, clone(DEMO)));
  check(new Set(htmls).size === 4, `同一份夹具下 4 个预设渲染出 ${new Set(htmls).size} 份互不相同的 HTML`);
  const pinned = dirs.map((d) => render(d, withOpts(M.presets[0].knobs)).replace(/data-shape="[^"]*"/g, ''));
  check(new Set(pinned).size === 1, '反向对照：options 里写死五个旋钮 ⟹ 4 个预设（去掉 data-shape 之后）塌成同一份 —— 判据分得开');
  const moved = [];
  const base = M.presets[2].knobs;
  for (const k of M.slots.options.knobs) {
    for (const v of k.values) {
      const h = render('image-right', withOpts({ [k.name]: v }));
      if (attr(h, dataAttr(k.name)) !== v || KNOB_NAMES.filter((n) => n !== k.name).some((n) => attr(h, dataAttr(n)) !== base[n])) moved.push(`${k.name}=${v}`);
    }
  }
  check(moved.length === 0, `旋钮独立（Image right 上逐个拧 ${M.slots.options.knobs.reduce((n, k) => n + k.values.length, 0)} 档）：拧的那个到位、其余四个不变`, moved.join(' · '));
  check(M.slots.body.kind === 'richtext' && M.slots.body.required === true, `body 是 kind richtext、必填（${M.slots.body.kind} / ${M.slots.body.required}）`);
  check(M.slots.ctas.max === 2 && M.slots.image.shape === '{imageUrl, alt}', `ctas.max = ${M.slots.ctas.max}（admin 的 count:ctas 从它派生）· image = ${M.slots.image.shape}`);
  const fbg = JSON.parse(fs.readFileSync(path.join(NEXT, 'blocks', 'footer-new', 'manifest.json'), 'utf-8')).slots.bg;
  check(JSON.stringify(M.slots.bg) === JSON.stringify(fbg), 'bg 槽整份照抄 footer-new（逐字节相同）');
  check(JSON.stringify(M.slots.introEyebrow.choices) === JSON.stringify({ style: ['none', 'pill', 'outline', 'dash', 'plain'] }), 'introEyebrow.style 词表 none · pill · outline · dash · plain');
}

// ══ AC3（组件与校验一半）：富文本 ════════════════════════════════════════════════════════════════
console.log('\n── AC3 富文本');
{
  const html = render('article', { headline: 'H', body: '第一段\n\n- a\n- b\n\n**粗** 和 [链接](/about)' });
  const b = bodyOf(html);
  check(b === '<p>第一段</p><ul><li>a</li><li>b</li></ul><p><strong>粗</strong> 和 <a href="/about">链接</a></p>',
    '正文画成 <p> / <ul> / <strong> / <a>（逐字）', b);
  const xss = render('article', { body: '<script>x</script>' });
  check(!xss.includes('<script>') && bodyOf(xss) === '<p>&lt;script&gt;x&lt;/script&gt;</p>', 'HTML 原样转义成文字，DOM 里没有 <script>', bodyOf(xss));
  const js = render('article', { body: '[x](javascript:alert(1))' });
  check(bodyOf(js) === '<p>x</p>' && !/javascript:/.test(js), 'javascript: 链接 ⟹ 没有 <a>、只剩文字 x', bodyOf(js));
  const demo = bodyOf(render('article', clone(DEMO)));
  check(count(demo, '<p>') === 2 && count(demo, '<li>') === 3 && count(demo, '<strong>') === 1 && count(demo, '<a href="/quote">') === 1,
    `演示内容：两段话 + 三条列表 + 一处加粗 + 一个站内链接（p ${count(demo, '<p>')} · li ${count(demo, '<li>')} · strong ${count(demo, '<strong>')}）`);
  // 反向对照：组件直接把 body 当一段字画（像旧 text-block 那样）⟹ 上面那格分得开。
  const Raw = loadSection(fs.readFileSync(SECTION, 'utf-8').replace('const body = parseRichtext(d.body);', "const body = [{ t: 'p', c: [{ t: 'text', v: str(d.body) }] }] as ReturnType<typeof parseRichtext>;"));
  const rawB = bodyOf(render('article', { headline: 'H', body: '第一段\n\n- a\n- b' }, Raw));
  check(rawB !== null && !rawB.includes('<ul>'), '反向对照：不经解析器、原样画 ⟹ 没有 <ul>（判据分得开）', rawB);
  loadSection();
  const v = (body) => own(manifestLib.validateSite({ pages: [{ slug: 'p', blocks: [{ type: 'content-new', data: { headline: 'H', body } }] }], scope: 'edit' }));
  const r1 = v('<script>x</script>');
  check(r1.length === 1 && r1[0].includes('HTML'), 'validateSite：写了 HTML ⟹ 报一条', JSON.stringify(r1));
  const r2 = v('[x](javascript:alert(1))');
  check(r2.length === 1 && r2[0].includes('协议不认'), 'validateSite：链接协议不认 ⟹ 报一条', JSON.stringify(r2));
  check(v(clone(DEMO).body).length === 0 && v('**粗** [a](https://x.example) [b](mailto:a@b.c) [c](tel:+1416) [d](#top)').length === 0, '对照：演示内容 / 五种认的链接开头 ⟹ 放行');
  const r3 = v(['not', 'a', 'string']);
  check(r3.length === 1 && r3[0].includes('字符串'), 'validateSite：body 不是字符串 ⟹ 报一条', JSON.stringify(r3));
  const r4 = own(manifestLib.validateSite({ pages: [{ slug: 'p', blocks: [{ type: 'content-new', data: { headline: 'H' } }] }], scope: 'edit' }));
  // 四个预设各自那组值（五个旋钮写全）+ 演示内容 ⟹ 放行；只有 Image right 带图，别的三个写了 image 槽却
  // image=none —— 那是通用的「写了槽却没开旋钮」检查（同 milestones 的 blockImage），所以这里给那三个去掉图。
  for (const p of M.presets) {
    const data = { ...clone(DEMO), options: p.knobs };
    if (p.knobs.image === 'none') delete data.image;
    const r = own(manifestLib.validateSite({ pages: [{ slug: 'p', blocks: [{ type: 'content-new', shape: p.shape, data }] }], scope: 'edit' }));
    check(r.length === 0, `预设 ${p.name} 那组值 + 演示内容 ⟹ 放行`, JSON.stringify(r));
  }
  const withImg = own(manifestLib.validateSite({ pages: [{ slug: 'p', blocks: [{ type: 'content-new', shape: 'article', data: clone(DEMO) }] }], scope: 'edit' }));
  console.log(`     （Article 形态 + 带图的演示内容：validateSite 报 ${withImg.length} 条 —— ${withImg.map((x) => x.slice(x.indexOf(':') + 1, x.indexOf(':') + 60)).join(' / ') || '无'}）`);
  check(r4.length === 1 && r4[0].includes('body'), 'validateSite：没写 body ⟹ 报一条（必填）', JSON.stringify(r4));
}

// ══ AC5 / AC6 / AC7（DOM 一半）══════════════════════════════════════════════════════════════════
console.log('\n── AC5 / AC6 / AC7 DOM');
{
  const st = render('statement', { ...clone(DEMO), headline: '' });
  check(!/<h2/.test(st) && /data-part="eyebrow"/.test(st), 'statement：headline 为空 ⟹ 没有 <h2>，eyebrow 仍在');
  check(attr(st, 'data-text-style') === 'statement' && attr(st, 'data-frame') === 'card', 'Statement 预设根元素 data-text-style=statement · data-frame=card');
  const noHead = render('article', { body: 'x' });
  check(!/data-part="head"/.test(noHead), '没有 eyebrow 也没有 headline ⟹ 块头那一层不渲染');
  const art = render('article', clone(DEMO));
  check(!/<img/.test(art) && attr(art, 'data-image') === 'none', 'Article（image=none）⟹ DOM 里没有 <img>（演示内容里有图也不画）');
  for (const pos of ['left', 'right', 'top', 'bottom']) {
    const h = render('article', withOpts({ image: pos }));
    const frame = (/<div class="co-frame"[\s\S]*$/.exec(h) || [''])[0];
    check(count(h, '<img') === 1 && !frame.includes('<img'), `image=${pos} ⟹ 一张 <img>，在 .co-frame（卡）外面`);
  }
  check(count(render('article', withOpts({ image: 'right' }, { image: undefined })), '<img') === 0, 'image=right 但没有图 ⟹ 不画 <img>');
  const card = render('statement', clone(DEMO));
  const frame = (/<div class="co-frame"[\s\S]*$/.exec(card) || [''])[0];
  check(frame.includes('data-part="head"') && frame.includes('class="co-body"') && frame.includes('data-part="ctas"'), 'frame=card：卡（.co-frame）包住块头 + 正文 + 按钮');
  check(count(art, 'data-cta=') === 2, `演示内容给 6 个按钮 ⟹ 画 ${count(art, 'data-cta=')} 个（manifest max 2）`);
  check(/data-cta="solid"[\s\S]*data-cta="outline"/.test(art), '两个按钮：第一个实心、第二个描边');
}

// ══ AC8：bg ══════════════════════════════════════════════════════════════════════════════════════
console.log('\n── AC8 bg');
{
  check(attr(render('article', { ...clone(DEMO), bg: '#0f172a' }), 'data-tone') === 'dark', 'bg #0f172a ⟹ data-tone=dark');
  check(attr(render('article', { ...clone(DEMO), bg: '#ffffff' }), 'data-tone') === 'light', 'bg #ffffff ⟹ data-tone=light');
  const g = render('article', { ...clone(DEMO), bg: { stops: ['#0f172a', '#334155'], angle: 135 } });
  check(attr(g, 'data-tone') === 'dark' && /linear-gradient/.test(sectionTag(g)), '渐变 ⟹ toneForBg 给 dark、背景是 linear-gradient');
  const src = fs.readFileSync(SECTION, 'utf-8');
  check(count(src, 'toneFor(') === 0 && src.includes('toneForBg(d.bg)'), `Section.tsx 里 toneFor( 出现 ${count(src, 'toneFor(')} 次、走 toneForBg`);
}

// ══ AC9：block-roles · 首页配方池 · 内页提示词 ═══════════════════════════════════════════════════════
console.log('\n── AC9 block-roles · 首页配方');
{
  const roles = JSON.parse(fs.readFileSync(path.join(SRC, 'lib', 'sections', 'block-roles.json'), 'utf-8'));
  check(roles['content-new'] === M.roleDefault, `block-roles.json 的 content-new（${roles['content-new']}）== manifest roleDefault（${M.roleDefault}）`);
  const all = manifestLib.loadManifests();
  const pool = recipe.poolFor(all);
  check(pool.includes('content-new') && !pool.includes('content-split') && 'content-split' in recipe.NOT_IN_POOL,
    `poolFor 含 content-new、不含 content-split，'content-split' in NOT_IN_POOL（池子 ${pool.length} 种）`);
  // 「交付前的 main」那一格：不要 content-new、把 content-split 放回池子。
  const reason = recipe.NOT_IN_POOL['content-split'];
  delete recipe.NOT_IN_POOL['content-split'];
  const both = recipe.poolFor(all);
  const before = recipe.poolFor(new Map([...all].filter(([k]) => k !== 'content-new')));
  recipe.NOT_IN_POOL['content-split'] = reason;
  check(pool.length === before.length, `池子种数 == 交付前（没有 content-new、content-split 在池里）的 ${before.length} 种`);
  check(both.includes('content-new') && both.includes('content-split') && both.length === pool.length + 1,
    `反向对照：从排除名单拿掉 content-split ⟹ 两个都进池、种数 +1（${both.length}）`);
  check(manifestLib.promptSection('homepage').includes('"content-new"'), '首页提示词清单里有 content-new');
  const cs = fs.readFileSync(path.join(NEXT, 'scripts', 'create-site.js'), 'utf-8');
  check(/\$\{blockPromptSection\('page-specific'[^\n]*\)\}\$\{contentNewPageLine\}/.test(cs) && /blockOff\.has\('content-new'\) \? ''/.test(cs),
    '内页提示词：PAGE-SPECIFIC 段后面接 contentNewPageLine，content-new 被关掉时整行不印（字节由 homepage-recipe.test.js ⑥ 钉着）');
}

// ══ AC12：text-block / content-split 零改动 ══════════════════════════════════════════════════════
console.log('\n── AC12 旧块零改动');
{
  let diff = null;
  try {
    const base = execFileSync('git', ['merge-base', 'HEAD', 'origin/main'], { cwd: NEXT, encoding: 'utf8' }).trim();
    let landed = true;
    try { execFileSync('git', ['cat-file', '-e', `${base}:templates/nextjs/blocks/content-new/manifest.json`], { cwd: NEXT, stdio: 'ignore' }); } catch { landed = false; }
    if (landed) console.log(`  ⏭  content-new 已在 merge-base ${base.slice(0, 8)} 上（#1498 已落地），这一格只管 #1498 自己的交付 —— 不算通过`);
    else diff = execFileSync('git', ['diff', '--name-only', base, '--', 'blocks/text-block', 'blocks/content-split'], { cwd: NEXT, encoding: 'utf8' }).trim();
  } catch (e) { console.log(`  ⚠️  取不到 git 读数（${e.message.split('\n')[0]}），这一格跳过 —— 不算通过`); }
  if (diff !== null) check(diff === '', `text-block / content-split 相对 merge-base 没有改动${diff ? `：${diff}` : ''}`);
}

console.log(`\n══ 汇总: 通过 ${pass} · 失败 ${fail} ══`);
process.exit(fail ? 1 : 0);
