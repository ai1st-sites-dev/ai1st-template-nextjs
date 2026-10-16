#!/usr/bin/env node
/**
 * site-render.test.js — #1802：`scripts/site.js render`（Next 外的整页渲染）在夹具站上量得到的那几样。
 *
 * 跟 Next 产物逐页比对**不在这里**（`scripts/render-diff.js`，要跑 next build，手跑、贴票）；这里量的是不需要 Next 的那些：
 *   ① bundle：包里包外怎么分（真用 `__dirname` 的 scripts/ 文件留在包外、路径相对产物）、平台文件按内容哈希定名
 *   ② live：每页都在、版本 meta、siteId 覆盖、GSC、自定义域名的 canonical、站根三份文本
 *   ③ preview：没有 sitemap、robots 全禁、每页 noindex
 *   ④ 每个块的容器带 `data-block-id`，页面 JSON 里缺 id 的块走 `generatedBlockId` 补
 *   ⑤ 同一份输入出两次逐字节相同；键序按 Postgres jsonb 重排之后仍逐字节相同（库里读回来就是那个次序）
 *   ⑥ 博客正文里写出一个字面的岛占位，整页照样渲染、那段字原样留着（#1798 QA3 量出来的那一条）
 *   ⑦ `--geo` 合并、IndexNow key 文件
 *
 * 跑法:  node scripts/site-render.test.js   （或 `npm run test:scripts`）
 * 退出码: 0 全过 · 1 有失败 · 2 跑不起来（不许当成通过）
 */
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');

let pass = 0;
let fail = 0;
const check = (cond, m) => { if (cond) { pass += 1; console.log(`  ✅ ${m}`); } else { fail += 1; console.log(`  ❌ ${m}`); } };

const ROOT = path.resolve(__dirname, '..');
const FIXTURES = path.join(__dirname, 'fixtures', 'site-fixtures');
const fixture = (name) => JSON.parse(fs.readFileSync(path.join(FIXTURES, `${name}.json`), 'utf-8'));
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'site-render-test-'));
// 🔴 bundle 必须放在模板树里（react 这些包按产物的位置解析）；放进 gitignore 了的 render/dist/ 下面，跑完删。
const BUNDLE = path.join(ROOT, 'render', 'dist', `test-${process.pid}`);
const CACHE = path.join(tmp, 'css-cache');
process.on('exit', () => { fs.rmSync(tmp, { recursive: true, force: true }); fs.rmSync(BUNDLE, { recursive: true, force: true }); });

let site;
let renderBundle;
let renderDiff;
try {
  site = require('./site');
  renderBundle = require('./lib/render-bundle');
  renderDiff = require('./render-diff');
} catch (e) { console.error(`🔴 跑不起来: ${e.stack}`); process.exit(2); }

const files = (dir, rel = '') => fs.readdirSync(path.join(dir, rel), { withFileTypes: true })
  .flatMap((e) => (e.isDirectory() ? files(dir, rel ? `${rel}/${e.name}` : e.name) : [rel ? `${rel}/${e.name}` : e.name]));
const read = (dir, rel) => fs.readFileSync(path.join(dir, rel), 'utf-8');
const html = (dir) => files(dir).filter((f) => f.endsWith('.html'));
const sha16 = (file) => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex').slice(0, 16);

async function render(name, out, extra = {}) {
  return site.render({ content: fixture(name), out: path.join(tmp, out), bundleDir: BUNDLE, cacheDir: CACHE, version: 7, ...extra });
}

(async () => {
  console.log('\n── ① bundle');
  const m = await renderBundle.buildRenderBundle({ outdir: BUNDLE });
  check(m.platform.globalsCss === `/_platform/css/globals.${sha16(path.join(ROOT, 'src/app/globals.css'))}.css`, `globals.css 按内容哈希定名（${m.platform.globalsCss}）`);
  check(m.platform.baseCss === `/_platform/css/base.${sha16(path.join(ROOT, 'public/base.css'))}.css`, `base.css 按内容哈希定名（${m.platform.baseCss}）`);
  check(m.platform.shapesCss === `/_platform/css/shapes.${sha16(path.join(ROOT, 'public/shapes.css'))}.css`, `shapes.css 按内容哈希定名（${m.platform.shapesCss}）`);
  check(/^\/_platform\/runtime\.[0-9a-f]{16}\.js$/.test(m.platform.runtimeJs), `runtime 按内容哈希定名（${m.platform.runtimeJs}）`);
  for (const rel of m.files) check(fs.existsSync(path.join(BUNDLE, rel)), `平台文件在：${rel}`);
  const again = await renderBundle.buildRenderBundle({ outdir: path.join(BUNDLE, 'again') });
  check(JSON.stringify(again.platform) === JSON.stringify(m.platform), '同一份源码打两次，平台文件名逐个相同（内容不变 ⟹ 哈希不变）');
  fs.rmSync(path.join(BUNDLE, 'again'), { recursive: true, force: true });

  const code = read(BUNDLE, 'render.cjs');
  const reqs = [...new Set([...code.matchAll(/require\("([^"]+)"\)/g)].map((x) => x[1]))];
  const relReqs = reqs.filter((r) => r.startsWith('.'));
  check(relReqs.length > 0 && JSON.stringify(m.externals) === JSON.stringify(relReqs.map((r) => path.relative(ROOT, path.resolve(BUNDLE, r)).split(path.sep).join('/')).sort()),
    `包外的相对引用 = manifest 的 externals（${m.externals.join(', ')}）`);
  for (const r of relReqs) {
    const abs = path.resolve(BUNDLE, r);
    check(abs.startsWith(path.join(ROOT, 'scripts') + path.sep) && fs.existsSync(abs) && /\b__dirname\b/.test(fs.readFileSync(abs, 'utf-8')),
      `${r} 从产物目录解析到模板树里那份真文件（${path.relative(ROOT, abs)}），而它确实用 __dirname`);
  }
  check(!/\/root\/|\/home\/|\/tmp\//.test(reqs.join(' ')), '包里没有烤进去的绝对路径（T2c 要把整棵树打包到别的机器上解开）');
  check(reqs.filter((r) => !r.startsWith('.')).every((r) => !r.startsWith('/')), `其余都是裸包名（${reqs.filter((r) => !r.startsWith('.')).join(' · ')}）`);
  const bundle = require(path.join(BUNDLE, 'render.cjs'));
  check(typeof bundle.renderSite === 'function', 'bundle 放在最终位置真 require 得起来，交出 renderSite');
  const iconsAbs = require.resolve(relReqs.find((r) => r.endsWith('icons.js')) || './missing', { paths: [BUNDLE] });
  check(iconsAbs === path.join(ROOT, 'scripts', 'lib', 'icons.js'), `包里 require 的 icons.js 就是 scripts/lib/icons.js（它的 __dirname = ${path.relative(ROOT, path.dirname(iconsAbs))}）`);

  console.log('\n── ② live（site-bbc4ff97，--site-id bbc4ff97 --version 7 --gsc-token --site-url 客户域名）');
  const live = path.join(tmp, 'live');
  const r1 = await render('site-bbc4ff97', 'live', {
    siteId: 'bbc4ff97', gscToken: 'gsc-abc123', siteUrl: 'https://www.customer-flowers.ca', leadApi: 'https://app.example', target: 'live',
  });
  const pages = html(live);
  const expectPages = ['index.html', 'services/index.html', 'faq/index.html', 'contact/index.html', 'services/custom-bouquets/index.html',
    'services/wedding-flowers/index.html', 'services/funeral-arrangements/index.html', 'blog/index.html', '404.html'];
  for (const p of expectPages) check(pages.includes(p), `有 ${p}`);
  for (const f of ['sitemap.xml', 'robots.txt', 'llms.txt', 'theme.css', 'custom.css']) check(fs.existsSync(path.join(live, f)), `有 ${f}`);
  check(r1.pages === pages.length, `报告的页数 = 目录里的 HTML 份数（${r1.pages}）`);
  check(pages.every((p) => read(live, p).includes('<meta name="ai1st-version" content="v7"/>')), `每页 ai1st-version = v7（${pages.length} 页）`);
  const all = pages.map((p) => read(live, p)).join('\n');
  check(!all.includes('site-bbc4ff97'), '夹具自带的 siteId（site-bbc4ff97）一处都不出现');
  check(pages.every((p) => read(live, p).includes('widget.js?site=bbc4ff97')), '每页的聊天小部件加载器带 ?site=bbc4ff97、打 --lead-api 那个地址');
  check(/"siteId":"bbc4ff97"/.test(read(live, 'contact/index.html')) && /"leadApi":"https:\/\/app\.example"/.test(read(live, 'contact/index.html')),
    '联系页线索表单（岛的 props）带的 siteId 是 bbc4ff97、提交地址是 --lead-api');
  check(pages.every((p) => read(live, p).includes('<meta name="google-site-verification" content="gsc-abc123"/>')), '每页 GSC meta 就是 --gsc-token 给的值');
  check(!all.includes('YOUR_GOOGLE_VERIFICATION_CODE'), 'seo.json 里的占位值一处都不出现');
  check(/<link rel="canonical" href="https:\/\/www\.customer-flowers\.ca\/faq"\/>/.test(read(live, 'faq/index.html'))
    && /<link rel="canonical" href="https:\/\/www\.customer-flowers\.ca"\/>/.test(read(live, 'index.html')), 'canonical 用 --site-url（客户自己的域名）');
  check(read(live, 'robots.txt') === 'User-Agent: *\nAllow: /\n\nSitemap: https://www.customer-flowers.ca/sitemap.xml\n', 'robots.txt 放行、Sitemap 指客户域名');
  check(/<loc>https:\/\/www\.customer-flowers\.ca\/services\/wedding-flowers<\/loc>/.test(read(live, 'sitemap.xml')), 'sitemap 用客户域名');
  check(pages.every((p) => read(live, p).includes(`<link rel="stylesheet" href="/_platform/css/${r1.siteCssKey}.css"/>`)), 'site.css 引的是 _platform/css/<缓存键>.css');
  check(pages.every((p) => !/href="\/(base|shapes|site)\.css"/.test(read(live, p))), '固定名的 /base.css、/shapes.css、/site.css 不再被引用');
  check(pages.every((p) => read(live, p).includes(`href="${m.platform.baseCss}"`) && read(live, p).includes(`href="${m.platform.shapesCss}"`) && read(live, p).includes(`href="${m.platform.globalsCss}"`)), '三份平台样式表引的是带哈希的地址');
  check(pages.every((p) => !/ai1st:nav|ai1st:theme-preview|ai1st:editor-ping/.test(read(live, p))), '编辑器 iframe 用的三段脚本（ai1st:nav / 换主题预览 / 编辑器探针）都不在');
  // regression map（T0 附表）那一行：`lib/keyword-slug.test.js` 从 Next 的常量现取「一页按页名落成哪几种文件名」来算 slug 上限。
  // 新路落成的形状是 `<slug>/index.html` —— 带页名的那一段只有目录本身（后缀 ''），它在 PAGE_FILE_SUFFIXES 里 ⟹ 上限照旧成立。
  const { PAGE_FILE_SUFFIXES } = require('./lib/keyword-slug');
  const named = pages.filter((p) => p !== 'index.html' && p !== '404.html');
  check(named.length > 0 && named.every((p) => /\/index\.html$/.test(p)) && PAGE_FILE_SUFFIXES.includes(''),
    `新路每页都是 <slug>/index.html（${named.length} 页），带页名的只有目录那一段、后缀 '' 在 keyword-slug 的后缀清单里`);
  check(r1.platform.includes(`_platform/css/${r1.siteCssKey}.css`) && m.files.every((f) => r1.platform.includes(f)), '报告列出这个站要的平台文件（含它自己的 site.css）');

  console.log('\n── ③ preview');
  const prev = path.join(tmp, 'preview');
  await render('site-bbc4ff97', 'preview', { target: 'preview', gscToken: 'gsc-abc123' });
  check(!fs.existsSync(path.join(prev, 'sitemap.xml')), '没有 sitemap.xml');
  check(read(prev, 'robots.txt') === 'User-Agent: *\nDisallow: /\n\n', 'robots.txt 是 Disallow: /');
  const prevPages = html(prev);
  check(prevPages.length === pages.length && prevPages.every((p) => /<meta name="robots" content="noindex[^"]*"\/>/.test(read(prev, p))), `每页 robots 是 noindex（${prevPages.length} 页）`);
  check(prevPages.every((p) => read(prev, p).includes('<meta name="ai1st-version" content="v7"/>')), '预览也带 ai1st-version');

  console.log('\n── ④ 块容器 data-block-id');
  const noId = fixture('site-bbc4ff97');
  const home = JSON.parse(JSON.stringify(noId['en/pages/home.json']));
  const second = home.blocks[1];
  delete second.id;
  noId['en/pages/home.json'] = home;
  await site.render({ content: noId, out: path.join(tmp, 'noid'), bundleDir: BUNDLE, cacheDir: CACHE });
  const { generatedBlockId } = require('./blocks');
  const homeHtml = read(path.join(tmp, 'noid'), 'index.html');
  const want = generatedBlockId('home', second.type, 1);
  check(homeHtml.includes(`data-block-id="${want}"`), `缺 id 的第 2 个块（${second.type}）拿到 generatedBlockId 补的 id（${want}）`);
  const sections = homeHtml.match(/<section[^>]* data-block="[^"]+"[^>]*>/g) || [];
  check(sections.length === home.blocks.length && sections.every((s) => / data-block-id="[^"]+"/.test(s)), `首页 ${sections.length} 个块的 <section> 都带 data-block-id（页面 JSON 里 ${home.blocks.length} 块）`);

  console.log('\n── ⑤ 确定性');
  await render('site-bbc4ff97', 'live2', { siteId: 'bbc4ff97', gscToken: 'gsc-abc123', siteUrl: 'https://www.customer-flowers.ca', leadApi: 'https://app.example' });
  const live2 = path.join(tmp, 'live2');
  const same = (a, b) => files(a).length === files(b).length && files(a).every((f) => fs.existsSync(path.join(b, f)) && fs.readFileSync(path.join(a, f)).equals(fs.readFileSync(path.join(b, f))));
  const noLastmod = (dir) => read(dir, 'sitemap.xml').replace(/<lastmod>[^<]*<\/lastmod>/g, '');
  const sameButLastmod = (a, b) => files(a).filter((f) => f !== 'sitemap.xml').every((f) => fs.readFileSync(path.join(a, f)).equals(fs.readFileSync(path.join(b, f)))) && noLastmod(a) === noLastmod(b);
  check(sameButLastmod(live, live2), '同一份输入出两次：每个文件逐字节相同（sitemap 的 <lastmod> 没给 --last-modified = 渲染时刻，除外）');
  const reordered = renderDiff.jsonbOrder(fixture('site-bbc4ff97'));
  check(JSON.stringify(Object.keys(reordered['brand.json'])) !== JSON.stringify(Object.keys(fixture('site-bbc4ff97')['brand.json'])), '尺子是活的：jsonb 重排之后 brand.json 的键序确实变了');
  await site.render({ content: reordered, out: path.join(tmp, 'jsonb'), bundleDir: BUNDLE, cacheDir: CACHE, version: 7, siteId: 'bbc4ff97', gscToken: 'gsc-abc123', siteUrl: 'https://www.customer-flowers.ca', leadApi: 'https://app.example' });
  check(sameButLastmod(live, path.join(tmp, 'jsonb')), '键按 Postgres jsonb 的规则重排（先长度、再字节）之后，每个文件仍逐字节相同');
  // 一页的 <lastmod> = 它读的所有文件里最晚的那个（T2a-1 §lastModifiedLookup），没给时间的文件按渲染时刻算 ⟹ 每份都给。
  const stamps = Object.fromEntries(Object.keys(fixture('site-bbc4ff97')).map((k) => [k, '2026-03-04T05:06:07.000Z']));
  stamps['en/pages/faq.json'] = '2026-05-06T07:08:09.000Z';
  const lm = await site.render({ content: fixture('site-bbc4ff97'), out: path.join(tmp, 'lm'), bundleDir: BUNDLE, cacheDir: CACHE, lastModified: stamps });
  const sm = read(path.join(tmp, 'lm'), 'sitemap.xml');
  check(/<loc>[^<]*\/faq<\/loc>\n<lastmod>2026-05-06T07:08:09\.000Z<\/lastmod>/.test(sm) && /<loc>[^<]*\/contact<\/loc>\n<lastmod>2026-03-04T05:06:07\.000Z<\/lastmod>/.test(sm),
    '--last-modified 给的时间进 sitemap：faq 是它自己那份的时间，contact 是共同的那个');
  check(lm.siteCssCached === true, '第二次以后 site.css 命中缓存（同一个有效主色 + 方向 + 剪 / 不剪）');
  check(same(live, live) && !same(live, prev), '尺子是活的：live 和 preview 两份产物判成不同');

  console.log('\n── ⑥ 博客正文里的字面岛占位');
  const blog = fixture('site-blog');
  const postKey = Object.keys(blog).find((k) => /\/blog\/[^/]+\.json$/.test(k));
  const post = JSON.parse(JSON.stringify(blog[postKey]));
  const literal = '<div data-island="lead-form" data-island-slot="0"></div>';
  post.content = `${post.content}${literal}`;
  blog[postKey] = post;
  let ok6 = true;
  try { await site.render({ content: blog, out: path.join(tmp, 'blog'), bundleDir: BUNDLE, cacheDir: CACHE }); } catch (e) { ok6 = false; console.log(`     ${e.message}`); }
  check(ok6, `正文含 ${literal} 的博客站照样渲染得出来（不再整页抛错）`);
  const postFile = path.join(tmp, 'blog', 'blog', post.slug, 'index.html');
  check(ok6 && fs.readFileSync(postFile, 'utf-8').includes(literal), '那段字面原样留在文章页里（没被当成岛去填）');
  check(ok6 && !/data-island-token/.test(html(path.join(tmp, 'blog')).map((p) => read(path.join(tmp, 'blog'), p)).join('')), '真岛的占位全部填回去了（产物里不剩 data-island-token）');

  console.log('\n── ⑥b 默认语言里有一页的 slug 恰好是语言码');
  // Next 那边 `[...slug]` §resolveSlug 先判第一段是不是语言码 ⟹ `/fr` 永远是法语首页、那一页从来出不来（#1802 QA1 反向线索）。
  const ml = fixture('site-multilang');
  const homeEn = typeof ml['en/pages/home.json'] === 'string' ? JSON.parse(ml['en/pages/home.json']) : ml['en/pages/home.json'];
  ml['en/pages/fr.json'] = { ...JSON.parse(JSON.stringify(homeEn)), slug: 'fr', title: 'Collides With French', navLabel: 'Collides', navOrder: 50 };
  await site.render({ content: ml, out: path.join(tmp, 'collide'), bundleDir: BUNDLE, cacheDir: CACHE });
  const frHome = read(path.join(tmp, 'collide'), 'fr/index.html');
  check(/<main [^>]*data-locale="fr"/.test(frHome) && /<main [^>]*data-page="home"/.test(frHome) && !frHome.includes('Collides With French'),
    '/fr 出的是法语首页，不是默认语言那个叫 fr 的页（跟 Next 一样）');
  check(/window\.location\.replace\("\/fr"\)/.test(read(path.join(tmp, 'collide'), 'en/fr/index.html')), '/en/fr 照旧是跳回 /fr 的小页（跟 Next 一样）');

  console.log('\n── ⑥c slug 带 ../ ⟹ 整跑失败，--out 内外一个文件都不写（#1802 QA3）');
  // Next 对同样输入当场失败（`Requested and resolved page mismatch`）；新路之前 rc=0、把 index.html 写到 --out 之外。
  // 页面 slug 同时覆盖默认语言跳转页（/en/<slug>）那一处落点，博客 slug 是另一条路。
  const escapes = [
    ['页面 slug', 'site-bbc4ff97', 'en/pages/faq.json', '../../qa3-escape'],
    ['博客 slug', 'site-blog', 'en/blog/battery-cold-start.json', '../../qa3-blog-escape'],
    ['段中夹 ..', 'site-bbc4ff97', 'en/pages/faq.json', 'a/../../b'],
  ];
  for (const [label, name, key, slug] of escapes) {
    const evil = fixture(name);
    const doc = typeof evil[key] === 'string' ? JSON.parse(evil[key]) : evil[key];
    evil[key] = { ...doc, slug };
    const jail = fs.mkdtempSync(path.join(tmp, 'jail-'));
    let err = null;
    try { await site.render({ content: evil, out: path.join(jail, 'a', 'b', 'out'), bundleDir: BUNDLE, cacheDir: CACHE }); } catch (e) { err = e; }
    check(err && /产物路径不合法/.test(err.message), `${label} = ${JSON.stringify(slug)} ⟹ render 抛错（${err ? err.message.slice(0, 60) : '没抛'}）`);
    check(files(jail).length === 0, `${label}：jail 里（--out 内外）0 个文件`);
  }

  console.log('\n── ⑥d 命令行不给 --out ⟹ rc=1，当前目录一个文件都不写');
  const cwd = fs.mkdtempSync(path.join(tmp, 'noout-'));
  const run = require('child_process').spawnSync(process.execPath,
    [path.join(__dirname, 'site.js'), 'render', '--site', path.join(FIXTURES, 'site-bbc4ff97.json'), '--target', 'live'], { cwd, encoding: 'utf-8' });
  check(run.status === 1 && /要给 --out/.test(run.stderr), `rc=${run.status}，报文要 --out`);
  check(fs.readdirSync(cwd).length === 0, '当前目录 0 项');

  console.log('\n── ⑦ --geo / IndexNow key');
  const brand = fixture('site-bbc4ff97')['brand.json'];
  const addr = brand.locations[0].address;
  await site.render({ content: fixture('site-bbc4ff97'), out: path.join(tmp, 'geo'), bundleDir: BUNDLE, cacheDir: CACHE, geo: { address: addr, lat: 12.5, lng: -45.25 }, indexnowKey: 'abcd1234-key' });
  check(/"latitude":12\.5,"longitude":-45\.25/.test(read(path.join(tmp, 'geo'), 'index.html')), `--geo 的地址跟 brand 的一样（${addr}）⟹ 坐标进了 LocalBusiness`);
  await site.render({ content: fixture('site-bbc4ff97'), out: path.join(tmp, 'geo2'), bundleDir: BUNDLE, cacheDir: CACHE, geo: { address: 'somewhere else', lat: 12.5, lng: -45.25 } });
  check(!/"latitude":12\.5/.test(read(path.join(tmp, 'geo2'), 'index.html')), '--geo 的地址对不上 ⟹ 不合并');
  check(read(path.join(tmp, 'geo'), 'abcd1234-key.txt') === 'abcd1234-key', 'IndexNow key 文件 <key>.txt，内容是 key');
  await site.render({ content: fixture('site-bbc4ff97'), out: path.join(tmp, 'badkey'), bundleDir: BUNDLE, cacheDir: CACHE, indexnowKey: 'bad key/../x' });
  check(!files(path.join(tmp, 'badkey')).some((f) => f.endsWith('.txt') && !['llms.txt', 'robots.txt'].includes(f)), '不合格式的 key 不写文件（跟 worker/indexnow.go 同一个正则）');

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(`🔴 跑不起来: ${e.stack}`); process.exit(2); });
