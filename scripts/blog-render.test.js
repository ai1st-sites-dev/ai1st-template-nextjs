#!/usr/bin/env node
/**
 * blog-render.test.js — #1497 验收里「看渲染出来的 HTML / 调一次校验器就能判」的那几条。
 *
 * 跑法:  node scripts/blog-render.test.js   （或 `npm run test:scripts`，它按文件名发现）
 * 退出码: 0 全过 · 1 有失败 · 2 跑不起来（**不许当成通过**）
 *
 * 管哪几条：AC1（5 个预设逐字、旋钮名 / 值逐字、目录集合、两两不同、旋钮独立）· AC3（文章来自博客：最新 N 篇、倒序、
 * 链到文章页、块数据里没有文章、0 篇不渲染）· AC4 的 DOM 一半（featured × itemImage 三份两两不同）· AC7（缺字段）·
 * AC8（bg 给 tone、不自己算亮度）· AC9（validateSite 的 postCount）· AC10（block-roles · 首页配方池）·
 * AC12 的 IMAGE_FIELDS 一半（含反向对照：真跑一次 image-urls.test.js）。
 * 几何（16 种组合三端无横向滚动、list 占满整列、background 卡高、计算色）要浏览器：
 * `tests/e2e/specs/1497-blog-new-knobs.spec.ts`。抽步长（AC14）在 `scripts/lib/homepage-recipe.test.js` ⑭。
 *
 * 🔴 每一段都带反向对照（同一进程、单变量），证明判据真会红。
 * 夹具定死：`scripts/lib/demo-content` 的 DEMO_BLOG_POSTS（5 篇，图册单格页挂的也是它）。
 */

'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const Module = require('module');
const { execFileSync, spawnSync } = require('child_process');
const ts = require('typescript');
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');

const NEXT = path.resolve(__dirname, '..');
const SRC = path.join(NEXT, 'src');
const BLOCK = path.join(NEXT, 'blocks', 'blog');
const SECTION = path.join(BLOCK, 'Section.tsx');

let pass = 0;
let fail = 0;
const ok = (m) => { pass += 1; console.log(`  ✅ ${m}`); };
const bad = (m) => { fail += 1; console.log(`  ❌ ${m}`); };
const die = (m) => { console.error(`🔴 跑不起来: ${m}`); process.exit(2); };
const check = (cond, m, detail) => (cond ? ok(m) : bad(detail ? `${m} —— ${detail}` : m));

// ── 让 node 能 require 这份 .tsx；Next 自己的、站点配置换成替身（这棵树里不一定有生成的 config-data）────────
// 替身要放在 scripts/ 底下：从系统临时目录 require('react') 找不到模块（同 milestones-render.test.js）。
const STUB_DIR = fs.mkdtempSync(path.join(NEXT, 'scripts', 'tmp-blog-stubs-'));
const stub = (name, body) => { const p = path.join(STUB_DIR, `${name}.js`); fs.writeFileSync(p, body); return p; };
// 替身 config：文章由测试放进 globalThis.__BLOG_POSTS__（按 locale），localeUrl 跟真的一样给 /blog/<slug>。
const STUBS = {
  'next/link': stub('link', "const React=require('react');"
    + "const L=({href,children,...r})=>React.createElement('a',{href,...r},children);module.exports=L;module.exports.default=L;\n"),
  '@/lib/config': stub('config', 'module.exports={'
    + 'getBlogPosts:(l)=>((globalThis.__BLOG_POSTS__||{})[l]||[]),'
    + 'localeUrl:(s,l,kind)=>kind==="blogPost"?"/blog/"+s:"/"+s};\n'),
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

let C; let DEMO; let POSTS; let manifestLib; let M; let recipe;
try {
  C = loadSection();
  const demo = require(path.join(NEXT, 'scripts', 'lib', 'demo-content'));
  DEMO = demo.DEMO_CONTENT['blog'];
  POSTS = demo.DEMO_BLOG_POSTS;
  manifestLib = require(path.join(NEXT, 'scripts', 'lib', 'block-manifest.js'));
  M = manifestLib.loadManifests().get('blog');
  recipe = require(path.join(NEXT, 'scripts', 'lib', 'homepage-recipe.js'));
} catch (e) { die(`载入失败: ${e.message}`); }
if (!DEMO) die('demo-content 里没有 blog');
if (!Array.isArray(POSTS) || POSTS.length !== 5) die(`DEMO_BLOG_POSTS 应是 5 篇（读到 ${POSTS && POSTS.length}）`);
if (!M) die('blocks/ 里没有 blog');

const clone = (v) => JSON.parse(JSON.stringify(v));
// 真站上排序是 sync-config 做的（publishedAt 倒序）；替身这里照同一规则排好再放进去。
const sorted = (arr) => [...arr].sort((a, b) => new Date(b.publishedAt).getTime() - new Date(a.publishedAt).getTime());
const setPosts = (arr) => { globalThis.__BLOG_POSTS__ = { en: sorted(arr) }; };
setPosts(POSTS);
const render = (shape, data, Comp = C) => renderToStaticMarkup(React.createElement(Comp, {
  data, locale: 'en', block: { id: 'b', type: 'blog', shape, data: {} },
}));
const withOpts = (o, extra = {}, base = DEMO) => ({ ...clone(base), ...extra, options: { ...(base.options || {}), ...o } });
const count = (html, needle) => html.split(needle).length - 1;
const own = (r) => r.problems.filter((p) => p.includes('("blog")'));
const sectionTag = (html) => (/<section[^>]*>/.exec(html) || [''])[0];
const attr = (html, name) => { const m = new RegExp(`${name}="([^"]*)"`).exec(sectionTag(html)); return m ? m[1] : null; };
const dataAttr = (knob) => `data-${knob.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`)}`;
const posts = (html) => [...html.matchAll(/<article[^>]*data-post="([^"]+)"[\s\S]*?<\/article>/g)].map((m) => ({ slug: m[1], html: m[0] }));
const KNOB_NAMES = ['introPosition', 'introAlign', 'itemsLayout', 'itemsColumns', 'itemStyle', 'itemImage'];

// ══ AC1：5 个预设逐字、旋钮名 / 值逐字、目录集合、两两不同、旋钮独立 ═══════════════════════════════
console.log('── AC1 五个预设');
{
  const WANT = [
    ['Cards', 'cards', 'top', 'center', 'grid', '3', 'card', 'top'],
    ['List', 'list', 'top', 'left', 'list', '3', 'plain', 'left'],
    ['Featured', 'featured', 'top', 'left', 'featured', '3', 'plain', 'left'],
    ['Side intro', 'side-intro', 'left', 'left', 'grid', '2', 'plain', 'top'],
    ['Cover', 'cover', 'top', 'center', 'grid', '3', 'card', 'background'],
  ];
  const got = (M.presets || []).map((p) => [p.name, p.shape, ...KNOB_NAMES.map((c) => p.knobs[c])]);
  check(JSON.stringify(got) === JSON.stringify(WANT), 'presets 5 条与正文表逐字相同（名字 · 形态 · 六列旋钮）', JSON.stringify(got));
  const knobs = M.slots.options.knobs.map((k) => [k.name, k.values]);
  check(JSON.stringify(knobs) === JSON.stringify([
    ['introPosition', ['left', 'right', 'top', 'bottom']], ['introAlign', ['left', 'center', 'right']],
    ['itemsLayout', ['grid', 'list', 'featured']], ['itemsColumns', ['2', '3']],
    ['itemStyle', ['plain', 'card']], ['itemImage', ['left', 'top', 'background']],
  ]), `slots.options.knobs 名字依次 ${knobs.map((k) => k[0]).join(' / ')}、values 与定稿表逐字（#1481 起顺序只管展示，默认看 default ?? values[0]）`);
  check(require('./lib/block-knobs').knobDefault(M.slots.options.knobs.find((k) => k.name === 'itemImage')) === 'top', '#1481：itemImage 排成 left · top · background 之后，没写值时仍是 top（显式 default 钉住，顺序只管展示）');
  const dirs = fs.readdirSync(BLOCK, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name).sort();
  check(JSON.stringify(dirs) === JSON.stringify(WANT.map((w) => w[1]).sort()), `目录集合 == 5 个预设形态（${dirs.join(' / ')}）`);
  check(M.skin === 'site-css' && M.roleDefault === 'optional', `skin=${M.skin} · roleDefault=${M.roleDefault}`);
  const htmls = dirs.map((d) => render(d, clone(DEMO)));
  check(new Set(htmls).size === 5, `同一份夹具下 5 个预设渲染出 ${new Set(htmls).size} 份互不相同的 HTML`);
  const pinned = dirs.map((d) => render(d, withOpts(M.presets[0].knobs)).replace(/data-shape="[^"]*"/g, ''));
  check(new Set(pinned).size === 1, '反向对照：options 里写死六个旋钮 ⟹ 5 个预设（去掉 data-shape 之后）塌成同一份 —— 判据分得开');
  const moved = [];
  const base = M.presets[0].knobs;
  for (const k of M.slots.options.knobs) {
    for (const v of k.values) {
      const h = render('cards', withOpts({ [k.name]: v }));
      if (attr(h, dataAttr(k.name)) !== v || KNOB_NAMES.filter((n) => n !== k.name).some((n) => attr(h, dataAttr(n)) !== base[n])) moved.push(`${k.name}=${v}`);
    }
  }
  check(moved.length === 0, `旋钮独立（Cards 上逐个拧 ${M.slots.options.knobs.reduce((n, k) => n + k.values.length, 0)} 档）：拧的那个到位、其余五个不变`, moved.join(' · '));
  const fbg = JSON.parse(fs.readFileSync(path.join(NEXT, 'blocks', 'footer', 'manifest.json'), 'utf-8')).slots.bg;
  check(JSON.stringify(M.slots.bg) === JSON.stringify(fbg), 'bg 槽整份照抄 footer（逐字节相同）');
  check(M.slots.postCount.kind === 'text' && JSON.stringify(M.slots.postCount.intRange) === '[2,6]', `postCount：kind ${M.slots.postCount.kind} · intRange ${JSON.stringify(M.slots.postCount.intRange)}`);
  check(M.slots.introCta.kind === 'link' && !('max' in M.slots.introCta), 'introCta 是单个 link（不带 max ⟹ admin 工具栏不派生 count: 那一格）');
}

// ══ AC3：文章来自博客 ════════════════════════════════════════════════════════════════════════════
console.log('\n── AC3 文章来自博客');
{
  const html = render('cards', { ...clone(DEMO), postCount: '3' });
  const ps = posts(html);
  const want = sorted(POSTS).slice(0, 3).map((p) => p.slug);
  check(JSON.stringify(ps.map((p) => p.slug)) === JSON.stringify(want), `夹具 5 篇、postCount 3 ⟹ 最新 3 篇按 publishedAt 倒序（${ps.map((p) => p.slug).join(' · ')}）`);
  check(ps.every((p) => new RegExp(`<h3[^>]*><a[^>]*href="/blog/${p.slug}"`).test(p.html)), '每篇标题是 <h3><a href="/blog/<slug>">');
  check(ps.every((p) => /<time datetime="\d{4}-\d{2}-\d{2}"/i.test(p.html)), '每篇日期是 <time datetime>（React 输出 dateTime，HTML 属性名不分大小写）');
  check(/Sep 18, 2026/.test(html), '日期按 UTC 格式化成「Sep 18, 2026」');
  const titles = POSTS.map((p) => p.title);
  check(titles.every((t) => !JSON.stringify(DEMO).includes(t)), '块数据里没有任何一篇文章的标题（JSON.stringify(block.data) 不含）');
  for (const [pc, n] of [['2', 2], ['6', 5], [undefined, 3], ['9', 5], ['abc', 3]]) {
    check(posts(render('cards', { ...clone(DEMO), postCount: pc })).length === n, `postCount ${JSON.stringify(pc)} ⟹ ${n} 篇（2–6，夹具只有 5 篇；写歪按默认 3）`);
  }
  const first = POSTS.find((p) => p.slug === 'check-engine-light');
  const words = first.content.replace(/<[^>]*>/g, ' ').split(/\s+/).filter(Boolean).length;
  const mins = Math.ceil(words / 220);
  check(new RegExp(`data-post="check-engine-light"[\\s\\S]*?>${mins} min read<`).test(html), `阅读时长 = ⌈${words} 词 ÷ 220⌉ = ${mins} min read`);
  setPosts([]);
  check(render('cards', clone(DEMO)) === '', '博客 0 篇 ⟹ 块不渲染（空串）');
  setPosts(POSTS);
  // 反向对照：组件改成不读博客（永远 0 篇）⟹ 上面「最新 3 篇」那格会红。
  const NoBlog = loadSection(fs.readFileSync(SECTION, 'utf-8').replace('getBlogPosts(loc).slice(', '([] as BlogPostConfig[]).slice('));
  check(posts(render('cards', clone(DEMO), NoBlog)).length === 0, '反向对照：组件不读博客 ⟹ 0 篇（判据分得开）');
  loadSection();
}

// ══ AC4（DOM 一半）：featured × itemImage ═════════════════════════════════════════════════════════
console.log('\n── AC4 featured × itemImage');
{
  const three = ['top', 'left', 'background'].map((v) => render('featured', withOpts({ itemImage: v })));
  check(new Set(three).size === 3, 'featured 下 itemImage top / left / background 渲染 HTML 两两不同');
  check(three.every((h) => attr(h, 'data-items-layout') === 'featured'), '三份都是 data-items-layout=featured');
  const imgs = three.map((h) => posts(h).map((p) => (/data-image="([^"]+)"/.exec(p.html) || [])[1]));
  check(imgs.every((arr, i) => arr[0] === 'top' && arr.slice(1).every((x) => x === ['top', 'left', 'background'][i])),
    `featured：大篇 data-image 恒为 top、小篇跟 itemImage（${imgs.map((a) => a.join('/')).join(' ｜ ')}）`);
  const grid = posts(render('cover', clone(DEMO))).map((p) => (/data-image="([^"]+)"/.exec(p.html) || [])[1]);
  check(grid.every((x) => x === 'background'), `对照：grid（Cover）每篇都跟 itemImage = background（${grid.join('/')}）`);
}

// ══ AC7：缺字段 ══════════════════════════════════════════════════════════════════════════════════
console.log('\n── AC7 缺字段');
{
  const html = render('cards', { ...clone(DEMO), postCount: '5' });
  const by = Object.fromEntries(posts(html).map((p) => [p.slug, p.html]));
  const noCover = by['oil-change-intervals'];
  check(!!noCover && !/<img/.test(noCover) && /data-part="cover-placeholder"/.test(noCover) && />Maintenance</.test(noCover),
    '没 coverImage ⟹ 占位块（带分类名 Maintenance），没有 <img>');
  const bare = by['battery-cold-start'];
  check(!!bare && !/data-part="excerpt"/.test(bare) && !/data-part="author"/.test(bare), '没 excerpt ⟹ 没有摘要节点；没 author ⟹ 没有作者行');
  const full = by['check-engine-light'];
  check(/data-part="excerpt"/.test(full) && /data-part="author"/.test(full) && count(full, '<img') === 2, '对照：有封面 + 作者 + 头像的那篇 ⟹ 摘要、作者行、两张 <img>（封面 + 头像）');
  const noAvatar = by['oil-change-intervals'];
  check(/data-part="author"/.test(noAvatar) && !/<img/.test(noAvatar), '有作者、没头像 ⟹ 作者行在、没有头像 <img>');
}

// ══ AC8：bg ══════════════════════════════════════════════════════════════════════════════════════
console.log('\n── AC8 bg');
{
  check(attr(render('cards', { ...clone(DEMO), bg: '#0f172a' }), 'data-tone') === 'dark', 'bg #0f172a ⟹ data-tone=dark');
  check(attr(render('cards', { ...clone(DEMO), bg: '#ffffff' }), 'data-tone') === 'light', 'bg #ffffff ⟹ data-tone=light');
  const g = render('cards', { ...clone(DEMO), bg: { stops: ['#0f172a', '#334155'], angle: 135 } });
  check(attr(g, 'data-tone') === 'dark' && /linear-gradient/.test(sectionTag(g)), '渐变 ⟹ toneForBg 给 dark、背景是 linear-gradient');
  const src = fs.readFileSync(SECTION, 'utf-8');
  check(count(src, 'toneFor(') === 0 && src.includes('toneForBg(d.bg)'), `Section.tsx 里 toneFor( 出现 ${count(src, 'toneFor(')} 次、走 toneForBg`);
}

// ══ AC9：validateSite 的 postCount ═══════════════════════════════════════════════════════════════
console.log('\n── AC9 validateSite');
{
  const v = (postCount) => own(manifestLib.validateSite({ pages: [{ slug: 'p', blocks: [{ type: 'blog', data: { headline: 'H', postCount } }] }], scope: 'edit' }));
  for (const x of [1, 7, 'abc']) {
    const r = v(x);
    check(r.length === 1 && r[0].includes('postCount') && r[0].includes('2–6'), `postCount ${JSON.stringify(x)} ⟹ 报一条（点名 postCount）`, JSON.stringify(r));
  }
  for (const x of [2, 6, '3']) check(v(x).length === 0, `postCount ${JSON.stringify(x)} ⟹ 放行`, JSON.stringify(v(x)));
  // SLOT_KINDS 与 merge-base 相同（没有为 postCount 新增一种 kind）。
  // 🔴 #1498 ship 时补上「已落地就跳过」那一半（写法照抄本文件 AC13）：这一格比的是【活文件 vs merge-base】，
  //    所以 #1497 自己落 main 之后它就不再量 #1497 的交付了，而是变成「全仓谁都不许再加 slot kind」——
  //    下一张合法加 kind 的票（#1498 的 richtext，正文第 2 条、Chris 定）会被它判红。
  let baseKinds = null;
  try {
    const base = execFileSync('git', ['merge-base', 'HEAD', 'origin/main'], { cwd: NEXT, encoding: 'utf8' }).trim();
    // 📌 #1425（T3）—— 块改回正名后 merge-base 上那个块住在 blocks/blog-new/：两个名字哪个在都算已落地，
    //    否则这一格就变成本文件上面说的那种「全仓不许加 kind」。
    const landed = ['blog', 'blog-new'].some((d) => { try { execFileSync('git', ['cat-file', '-e', `${base}:templates/nextjs/blocks/${d}/manifest.json`], { cwd: NEXT, stdio: 'ignore' }); return true; } catch { return false; } });
    if (landed) {
      console.log(`  ⏭  blog 已在 merge-base ${base.slice(0, 8)} 上（#1497 已落地），这一格只管 #1497 自己的交付 —— 不算通过`);
    } else {
      const baseSrc = execFileSync('git', ['show', `${base}:templates/nextjs/scripts/lib/block-manifest.js`], { cwd: NEXT, encoding: 'utf8', maxBuffer: 64 << 20 });
      baseKinds = (/const SLOT_KINDS = (\[[^\]]*\]);/.exec(baseSrc) || [])[1] || null;
    }
  } catch (e) { console.log(`  ⚠️  取不到 merge-base 的 SLOT_KINDS（${e.message.split('\n')[0]}），这一格跳过 —— 不算通过`); }
  const nowKinds = (/const SLOT_KINDS = (\[[^\]]*\]);/.exec(fs.readFileSync(path.join(NEXT, 'scripts', 'lib', 'block-manifest.js'), 'utf-8')) || [])[1];
  if (baseKinds !== null) check(baseKinds === nowKinds, `SLOT_KINDS 与 merge-base 相同（${nowKinds}）`);
  // manifest 写歪当场拒。
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'blog-range-'));
  try {
    const load = (edit) => {
      const dir = path.join(tmp, String(Math.random()).slice(2));
      fs.cpSync(BLOCK, path.join(dir, 'blog'), { recursive: true });
      const mf = path.join(dir, 'blog', 'manifest.json');
      const j = JSON.parse(fs.readFileSync(mf, 'utf-8')); edit(j); fs.writeFileSync(mf, JSON.stringify(j));
      try { manifestLib.loadManifests(dir); return ''; } catch (e) { return e.message; }
    };
    check(/intRange/.test(load((j) => { j.slots.postCount.intRange = [6, 2]; })), 'intRange 写成 [6, 2]（最小 > 最大）⟹ manifest 当场被拒');
    check(/intRange/.test(load((j) => { j.slots.headline.intRange = ['2', '6']; })), 'intRange 写成字符串 ⟹ 当场被拒');
    check(/intRange/.test(load((j) => { j.slots.introCta.intRange = [2, 6]; })), 'intRange 写在不是 text 的槽（introCta 是 link）⟹ 当场被拒');
    check(load(() => {}) === '', '对照：原样 ⟹ 载得进');
  } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
}

// ══ AC10：block-roles · 首页配方池 ════════════════════════════════════════════════════════════════
console.log('\n── AC10 block-roles · 首页配方');
{
  const roles = JSON.parse(fs.readFileSync(path.join(SRC, 'lib', 'sections', 'block-roles.json'), 'utf-8'));
  check(roles['blog'] === M.roleDefault, `block-roles.json 的 blog（${roles['blog']}）== manifest roleDefault（${M.roleDefault}）`);
  // 📌 #1425（T3）—— 这里原来还测 blog-preview 在 NOT_IN_POOL、「交付前的 main」种数；blog-preview 随旧库删了。
  check('blog' in recipe.NOT_IN_POOL, "'blog' 在 NOT_IN_POOL");
  const all = manifestLib.loadManifests();
  const pool = recipe.poolFor(all);
  check(!pool.includes('blog') && pool.length === 11, `poolFor 不含 blog、池子 11 种（读到 ${pool.length}）`);
  const saved = recipe.NOT_IN_POOL['blog'];
  let leak;
  try { delete recipe.NOT_IN_POOL['blog']; leak = recipe.poolFor(all); } finally { recipe.NOT_IN_POOL['blog'] = saved; }
  check(leak.includes('blog') && leak.length === pool.length + 1, `反向对照：从排除名单拿掉 blog ⟹ 它进池、种数 +1（读到 ${leak.length}）`);
  let hits = 0;
  for (let i = 0; i < 400; i++) {
    const r = recipe.tryHomepageRecipe(i, all);
    if (!r.recipe) continue;
    for (const t of [...r.recipe.opener, ...r.recipe.mustInclude]) if (t === 'blog') hits++;
  }
  check(hits === 0, `tryHomepageRecipe(0–399) 的 opener + mustInclude 里 blog 出现 ${hits} 次`);
}

// ══ AC12（IMAGE_FIELDS 那一半）════════════════════════════════════════════════════════════════════
console.log('\n── AC12 IMAGE_FIELDS');
{
  const urlsPath = path.join(NEXT, 'scripts', 'lib', 'image-urls.js');
  const fields = require(urlsPath).IMAGE_FIELDS;
  check(fields.includes('authorAvatarUrl'), `IMAGE_FIELDS 含 authorAvatarUrl（${fields.join(' · ')}）`);
  // 反向对照：子进程里载入 image-urls.js 时把那一行换成不含 authorAvatarUrl 的，真跑一次 image-urls.test.js。
  const pre = path.join(STUB_DIR, 'drop-avatar.js');
  fs.writeFileSync(pre, `const fs=require('fs');const target=${JSON.stringify(urlsPath)};
const orig=require.extensions['.js'];
require.extensions['.js']=(mod,fn)=>{ if(fn!==target) return orig(mod,fn);
  const src=fs.readFileSync(fn,'utf-8'); const out=src.replace("const IMAGE_FIELDS = ['imageUrl', 'logoUrl', 'authorAvatarUrl'];","const IMAGE_FIELDS = ['imageUrl', 'logoUrl'];");
  if(out===src) throw new Error('drop-avatar: 那一行没找到，反向对照没生效'); mod._compile(out,fn); };\n`);
  const r = spawnSync('node', ['-r', pre, path.join(NEXT, 'scripts', 'lib', 'image-urls.test.js')], { cwd: NEXT, encoding: 'utf8', maxBuffer: 64 << 20 });
  const out = `${r.stdout}${r.stderr}`;
  check(r.status === 1 && /IMAGE_FIELDS 漏了模板真的画的字段: authorAvatarUrl/.test(out),
    `反向对照：IMAGE_FIELDS 拿掉 authorAvatarUrl ⟹ image-urls.test.js 红（rc=${r.status}），点名「漏了模板真的画的字段: authorAvatarUrl」`,
    out.split('\n').filter((l) => /❌|跑不起来|drop-avatar/.test(l)).slice(0, 3).join(' / '));
}

// 📌 #1425（T3）—— 这里原来测 AC13「blog-preview 相对 merge-base 零改动」；blog-preview 随旧库删了。

console.log(`\n══ 汇总: 通过 ${pass} · 失败 ${fail} ══`);
process.exit(fail ? 1 : 0);
