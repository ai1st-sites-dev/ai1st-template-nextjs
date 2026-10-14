#!/usr/bin/env node
/**
 * platform-logos.test.js —— #1766：常见平台的 logo 我们自己出、AI 编的外链 logo 地址不进站、新拖下的 logos / gallery / reviews 块各先放 3 项。
 *
 *   跑法:  node scripts/platform-logos.test.js   （或 `npm run test:scripts`，按文件名发现）
 *   退出码: 0 全过 · 1 有失败 · 2 跑不起来（不许当成通过）
 *
 *   ① 验收 1：平台表（review-platforms.js）—— 认名字的几种写法、表外的不认、每一行的文件真的在模板 public/ 里且是 SVG
 *   ② 验收 2（判据本身）：成排小图哪些格、哪些地址留（row-image-urls.js）—— host 相等不是子串、换个环境、没有域名不删
 *   ③ 验收 2（建站那条路）：真 create-site.js（skipAI，不调 AI）写出来的页面 —— 三臂只差 uploadsDomain / 示例图前缀
 *      （AI 改站那条路在 scripts/lib/edit-site-chain.test.js ㉔；manager / worker 两跳在各自的 ticket1766_test.go）
 *   ④ 验收 4 / 5（数据一半）：拖下 logos / gallery / reviews 播什么；Google 真实评分只认来自 Google 的（PM 第三版裁定的两臂）
 *   ⑤ 播出来的块过得了 validateSite（scope: edit）—— 播了却被改站那一关拒，等于没播
 *   ⑥ 提示词：logos 那一行列的文件 = 表里的文件（判据只留一处）
 */
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const cp = require('child_process');

const NEXT = path.resolve(__dirname, '..');
let pass = 0; let fail = 0;
const ok = (m) => { pass += 1; console.log(`  ✅ ${m}`); };
const bad = (m) => { fail += 1; console.log(`  ❌ ${m}`); };
const check = (cond, m, detail) => (cond ? ok(m) : bad(detail !== undefined ? `${m} —— ${typeof detail === 'string' ? detail : JSON.stringify(detail)}` : m));
const die = (m) => { console.log(`🔴 跑不起来：${m}`); process.exit(2); };

let platforms; let rows; let schemaLib; let bp; let manifestLib;
try {
  platforms = require(path.join(NEXT, 'scripts', 'lib', 'review-platforms.js'));
  rows = require(path.join(NEXT, 'scripts', 'lib', 'row-image-urls.js'));
  schemaLib = require(path.join(NEXT, 'scripts', 'lib', 'editor-schema.js'));
  bp = require(path.join(NEXT, 'scripts', 'lib', 'block-placeholders.js'));
  manifestLib = require(path.join(NEXT, 'scripts', 'lib', 'block-manifest.js'));
} catch (e) { die(`载入失败：${e.message}`); }

const temps = [];
process.on('exit', () => { for (const t of temps) { try { fs.rmSync(t, { recursive: true, force: true }); } catch (e) { /* 打扫不改结论 */ } } });

// ══ ① 平台表 ═══════════════════════════════════════════════════════════════════════════════════
console.log('① 平台表（验收 1）');
{
  const want = [
    ['Google', 'google'], ['google reviews', 'google'], [' Google Business Profile ', 'google'], ['Google  Reviews', 'google'],
    ['Google Maps', 'google-maps'], ['Yelp', 'yelp'], ['Yelp Reviews', 'yelp'], ['Facebook', 'facebook'], ['FACEBOOK', 'facebook'],
    ['HomeStars', null], ['Google Mapsx', null], ['', null], [undefined, null],
  ];
  for (const [name, key] of want) check(platforms.platformKey(name) === key, `${JSON.stringify(name)} ⟹ ${key || '没有（写名字）'}`, platforms.platformKey(name));
  check(platforms.platformLogo('HomeStars', '').kind === 'name' && platforms.platformLogo('Google Maps', '').logoUrl === '/images/platforms/google-maps.svg'
    && platforms.platformLogo('Google', 'https://uploads.example/x.png').kind === 'image', '三档：表外 ⟹ name；Google Maps ⟹ 它自己的文件；上传的 logoUrl 优先');
  for (const [key, p] of Object.entries(platforms.PLATFORMS)) {
    const file = path.join(NEXT, 'public', p.logo);
    let body = '';
    try { body = fs.readFileSync(file, 'utf8'); } catch (e) { body = ''; }
    check(/^\/images\/platforms\/[a-z-]+\.svg$/.test(p.logo) && /<svg[\s>]/.test(body) && !/<script|\son[a-z]+=/i.test(body),
      `${key}：${p.logo} 在模板 public/ 里、是 SVG、里面没有脚本`, `${body.length} 字节`);
    check(/\swidth="[\d.]+"[^>]*\sheight="[\d.]+"|\sheight="[\d.]+"[^>]*\swidth="[\d.]+"/.test(body.slice(0, body.indexOf('>', body.indexOf('<svg')) + 1)),
      `${key}：<svg> 根上写了固有宽高（<img> 的 naturalWidth 才不是 0）`);
  }
  check(Object.keys(platforms.PLATFORMS).sort().join() === 'facebook,google,google-maps,yelp', '表里恰好 Google / Google Maps / Yelp / Facebook 四行');
}

// ══ ② 判据本身 ═════════════════════════════════════════════════════════════════════════════════
console.log('\n② 成排小图：哪些格、哪些地址留（验收 2 判据）');
{
  const { loadManifests } = manifestLib;
  const cells = [];
  for (const [t, m] of loadManifests()) for (const c of rows.rowImageCellsOf(m)) cells.push(`${t}.${c}`);
  const wantCells = ['hero.proof.avatars.imageUrl', 'hero.logos.items.imageUrl', 'hero.band.imageUrl', 'logos.items.imageUrl',
    'pricing.proof.avatars.imageUrl', 'pricing.logos.items.imageUrl', 'reviews.platforms.logoUrl', 'testimonials.summary.logoUrl'];
  check(cells.sort().join() === wantCells.sort().join(), `范围 = §inlineSlotsOf 标 url: true 的 8 格（含 testimonials.summary.logoUrl）`, cells);

  const WIKI = 'https://upload.wikimedia.org/wikipedia/commons/thumb/2/2f/Google_2015_logo.svg/1200px-Google_2015_logo.svg.png';
  const page = (urls) => ({ blocks: [{ id: 'l', type: 'logos', data: { items: urls.map((u, i) => ({ imageUrl: u, alt: `L${i}` })) } }] });
  const run = (urls, uploadsDomain) => { const p = page(urls); const r = rows.scrubRowImageUrls(p, { uploadsDomain }); return { r, items: p.blocks[0].data.items }; };
  const dev = 'https://uploads.ai1stsite.dev/u/a.png';
  const app = 'https://uploads.ai1stsite.app/u/a.png';
  const a = run([WIKI, dev, '/images/platforms/google.svg'], 'uploads.ai1stsite.dev');
  check(a.r.removed === 1 && !('imageUrl' in a.items[0]) && a.items[0].alt === 'L0' && a.items[1].imageUrl === dev && a.items[2].imageUrl === '/images/platforms/google.svg',
    '维基 / 图片库 / 模板自带三项 ⟹ 第一项地址删掉、名字还在，后两项原样', a.items);
  const b = run([app, dev], 'uploads.ai1stsite.app');
  check(b.items[0].imageUrl === app && !('imageUrl' in b.items[1]), '换个环境（配置 = uploads.ai1stsite.app）⟹ .app 的不删、同一时刻 .dev 的被删', b.items);
  const c = run([WIKI, dev, '/x.svg'], '');
  check(c.r.skipped && c.r.removed === 0 && c.items[0].imageUrl === WIKI, '没有 uploads 域名 ⟹ 三项一个都不删', c.items);
  const tricky = ['https://uploads.ai1stsite.dev.evil.example/a.png', 'https://evil.example/uploads.ai1stsite.dev/a.png', '//uploads.ai1stsite.dev/a.png',
    '/\\evil.example/a.png', 'data:image/png;base64,AAAA', 'javascript:alert(1)', 'https://upload.ai1stsite.dev/a.png'];
  const t = run(tricky, 'uploads.ai1stsite.dev');
  check(t.items.every((x) => !('imageUrl' in x)), '比的是 host 本身：后缀伪装 / 路径里带域名 / 协议相对 / data: / javascript: / 少一个字母，全删', t.items);
  const up = run(['https://UPLOADS.ai1stsite.dev/a.png', 'http://uploads.ai1stsite.dev/a.png'], ' uploads.ai1stsite.dev ');
  check(up.r.removed === 0, '大小写 / 配置值首尾空格 / http 不影响同一个 host 被认出', up.items);
  // 别的格、别的块
  const mixed = { sections: [
    { type: 'hero', data: { image: { imageUrl: WIKI, alt: '' }, logos: { items: [{ imageUrl: WIKI, alt: 'G' }] }, proof: { avatars: [{ imageUrl: WIKI }] } } },
    { type: 'reviews', data: { platforms: [{ source: 'Google', rating: 4, count: 3, logoUrl: WIKI }] } },
    { type: 'testimonials', data: { summary: [{ source: 'Yelp', rating: 4, count: 3, logoUrl: WIKI }] } },
    { ref: 'shared-logos' },
  ] };
  const mr = rows.scrubRowImageUrls(mixed, { uploadsDomain: 'uploads.ai1stsite.dev' });
  const [hero, rv, tm] = mixed.sections;
  check(mr.removed === 4 && hero.data.image.imageUrl === WIKI && !('imageUrl' in hero.data.logos.items[0]) && !('imageUrl' in hero.data.proof.avatars[0])
    && !('logoUrl' in rv.data.platforms[0]) && !('logoUrl' in tm.data.summary[0]),
    '老 sections 形状也认；hero 的 logo / 头像、reviews / testimonials 的 logoUrl 删掉，hero 主图（不在范围里）不碰', mixed);
  const sb = { 'shared-logos': { type: 'logos', data: { items: [{ imageUrl: WIKI, alt: 'G' }] } } };
  check(rows.scrubSiteBlocks(sb, { uploadsDomain: 'uploads.ai1stsite.dev' }).removed === 1 && !('imageUrl' in sb['shared-logos'].data.items[0]), '站级块库（site-blocks.json）同一条规则');
}

// ══ ③ 建站那条路：真 create-site.js（skipAI）══════════════════════════════════════════════════════
// 示例站的 logo 都是 `<demoImageBase>client-logo-N.svg`。示例图前缀与 uploadsDomain 两个变量各拧一次：
//   C1 前缀在 .dev、配置是 .app（模拟「别的环境的图片库地址」）⟹ logos 块的地址全删、名字还在；hero 主图（不在范围）原样
//   C2 前缀与配置都是 .app ⟹ 原样
//   C3 跟 C1 一样、但载荷不带 uploadsDomain ⟹ 原样（不删）
console.log('\n③ 建站那条路（真 create-site.js，skipAI，不调 AI）');
{
  const build = (label, extra) => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), `platform-logos-${label}-`));
    temps.push(root);
    const work = path.join(root, 'nextjs');
    cp.execSync(`cp -a --no-dereference "${NEXT}" "${work}"`, { stdio: 'pipe' });
    for (const junk of ['out', '.next', '.out-backup', '.out-temp', 'site', 'node_modules']) fs.rmSync(path.join(work, junk), { recursive: true, force: true });
    fs.symlinkSync(path.join(NEXT, 'node_modules'), path.join(work, 'node_modules'));
    const r = cp.spawnSync(process.execPath, [path.join(work, 'scripts', 'create-site.js')], {
      input: JSON.stringify({ siteId: 'pltest01', siteUrl: 'https://pltest01.example.com', companyName: 'Northside Auto Care', industry: 'auto repair',
        location: 'Toronto', skipAI: true, language: 'en', ...extra }),
      cwd: work, encoding: 'utf8', env: { ...process.env, ANTHROPIC_API_KEY: undefined }, timeout: 180000,
    });
    const dir = path.join(work, 'site', 'en', 'pages');
    if (!fs.existsSync(dir)) die(`${label}：skipAI 建站没写出页面（rc=${r.status}）\n${(r.stderr || '').slice(-600)}`);
    const blocks = fs.readdirSync(dir).flatMap((f) => (JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')).blocks || []));
    return { blocks, log: r.stderr || '' };
  };
  const logosOf = (b) => b.filter((x) => x.type === 'logos').flatMap((x) => x.data.items || []);
  const heroImgs = (b) => b.filter((x) => x.type === 'hero' && x.data && x.data.image).map((x) => x.data.image.imageUrl);
  const c1 = build('c1', { demoImageBase: 'https://uploads.ai1stsite.dev/demo/', uploadsDomain: 'uploads.ai1stsite.app' });
  const l1 = logosOf(c1.blocks);
  if (!l1.length) die('C1：示例站里一个 logos 块都没有 —— 这一组没有可测的东西');
  check(l1.every((it) => !('imageUrl' in it) && typeof it.alt === 'string' && it.alt) && /\[row-images\] .*dropped \d+ image address/.test(c1.log),
    `C1 别的环境的地址：logos ${l1.length} 项的地址全删、名字都在；日志报了删几个`, l1);
  check(heroImgs(c1.blocks).some((u) => u.startsWith('https://uploads.ai1stsite.dev/demo/')), 'C1 对照：hero 主图（不在范围里）照样是 .dev 那个地址，没被碰', heroImgs(c1.blocks));
  const c2 = build('c2', { demoImageBase: 'https://uploads.ai1stsite.app/demo/', uploadsDomain: 'uploads.ai1stsite.app' });
  const l2 = logosOf(c2.blocks);
  check(l2.length === l1.length && l2.every((it) => /^https:\/\/uploads\.ai1stsite\.app\/demo\/client-logo-\d\.svg$/.test(it.imageUrl)), 'C2 本环境的地址：logos 每一项原样', l2);
  const c3 = build('c3', { demoImageBase: 'https://uploads.ai1stsite.dev/demo/' });
  const l3 = logosOf(c3.blocks);
  check(l3.length === l1.length && l3.every((it) => /^https:\/\/uploads\.ai1stsite\.dev\/demo\//.test(it.imageUrl)) && /\[row-images\] 载荷里没有 uploadsDomain/.test(c3.log),
    'C3 载荷没有 uploadsDomain：一个都不删，日志喊一行', l3);
}

// ══ ④ 拖下新块播什么 ═══════════════════════════════════════════════════════════════════════════
console.log('\n④ 拖下 logos / gallery / reviews 播什么（验收 4 / 5 的数据一半）');
const schema = schemaLib.editorSchema();
const comp = (t) => schema.components.find((c) => c.type === t);
{
  const lg = bp.seedProps(comp('logos'), 'en');
  check(lg.items.length === 3 && lg.items.map((x) => x.alt).join() === 'Logo 1,Logo 2,Logo 3' && lg.items.every((x) => !('imageUrl' in x)), 'logos：3 项「Logo 1 / 2 / 3」、没有图（画占位图）', lg.items);
  check(bp.seedProps(comp('logos'), 'ja').items[0].alt === 'ロゴ 1', 'logos：名字按站的语言（ja ⟹ ロゴ 1）');
  const gl = bp.seedProps(comp('gallery'), 'en');
  check(gl.items.length === 3 && gl.items.every((x) => JSON.stringify(x) === '{}'), 'gallery：3 张空图位', gl.items);
  for (const t of ['logos', 'gallery', 'reviews']) {
    const names = bp.fillFields(comp(t), bp.seedProps(comp(t), 'en')).map((f) => f.name);
    const listSlot = t === 'reviews' ? 'platforms' : 'items';
    check(names.length >= 1 && names.every((n) => !n.startsWith(`${listSlot}.`)), `${t}：播出来的 ${listSlot} 不交给 AI（交的只有块头 ${names.join(' / ')}）`);
  }
  const rv = bp.seedProps(comp('reviews'), 'en').platforms;
  check(rv.map((p) => platforms.platformKey(p.source)).join() === 'google,yelp,facebook', 'reviews：Google / Yelp / Facebook 三个，都认得出（画模板自带的 logo）', rv);
  check(new Set(rv.map((p) => p.rating)).size === 3 && rv.every((p) => p.rating > 0 && p.rating <= 5 && Number.isInteger(p.count) && p.count > 0), 'reviews：三个分数不一样，分数 / 条数在范围里', rv);
  const site = (r) => ({ defaultLocale: 'en', seoByLocale: { en: { schema: r ? { aggregateRating: r } : {} } } });
  // #1767 —— seedProps 的第三个参数是 SeedContext（编辑器 §seedContextFor 用 §realGoogleRating 算 `rating`），不再直接收 site。
  const ctxOf = (st, loc = 'en') => ({ rating: bp.realGoogleRating(st, loc) });
  const g = bp.seedProps(comp('reviews'), 'en', ctxOf(site({ ratingValue: 4.4, reviewCount: 37, source: 'google' }))).platforms;
  check(g[0].rating === 4.4 && g[0].count === 37 && g[1].rating === rv[1].rating && g[2].count === rv[2].count, '站里有来自 google 的真实评分 4.4 / 37 ⟹ Google 那一项正好是它，别的照旧示例', g);
  const y = bp.seedProps(comp('reviews'), 'en', ctxOf(site({ ratingValue: 4.4, reviewCount: 37, source: 'yelp' }))).platforms;
  check(JSON.stringify(y) === JSON.stringify(rv) && y.every((p) => p.rating !== 4.4 && p.count !== 37), '反臂：同一份数只差平台名（yelp）⟹ Google 那一项是示例分，4.4 / 37 一个都不出现（Yelp 也不用 —— B 出局）', y);
  check(rv.every((p) => p.rating !== 4.4 && p.count !== 37), '对照：示例分里本来就没有 4.4 / 37（否则上面那一格分不出「用了真数」和「示例恰好相等」）', rv);
  const old = bp.seedProps(comp('reviews'), 'en', ctxOf(site({ ratingValue: 4.4, reviewCount: 37 }))).platforms;
  check(JSON.stringify(old) === JSON.stringify(rv), '老站（aggregateRating 没有 source）⟹ 示例分，不猜它是 Google', old);
  const zh = { defaultLocale: 'en', seoByLocale: { en: { schema: { aggregateRating: { ratingValue: 4.6, reviewCount: 12, source: 'Google' } } } } };
  check(bp.seedProps(comp('reviews'), 'zh', ctxOf(zh, 'zh')).platforms[0].count === 12, '这个语言没有 seo ⟹ 退主语言那份');
  const fz = require(path.join(NEXT, 'scripts', 'lib', 'local-business-facts.js'));
  const fromYelp = fz.ratingFrom({ platformRatings: { yelp: { rating: 4.4, reviewCount: 37 } } });
  const y2 = bp.seedProps(comp('reviews'), 'en', ctxOf(site(fromYelp))).platforms;
  check(fromYelp.source === 'yelp' && y2[0].rating === rv[0].rating, '端到端（数据一半）：§ratingFrom 只抓到 yelp ⟹ 写进站里的 source 是 yelp ⟹ Google 那一项是示例分', { fromYelp, g0: y2[0] });
}

// ══ ④+ 点占位图换图：成排的图那一格要写字符串（e2e 1766 验收 3 量到的）══════════════════════════════
console.log('\n④+ 点 logos 的占位图：定位结果说「这一格是地址字符串」（url: true），换图写回字符串不写 {imageUrl}');
{
  const { resolveInlineSlot } = require(path.join(NEXT, 'scripts', 'lib', 'inline-edit.js'));
  const lg = comp('logos');
  const props = { items: [{ alt: 'Logo 1' }, { alt: 'Logo 2' }, { alt: 'Logo 3' }] };
  const r = resolveInlineSlot({ component: lg, props, slot: 'items.1.imageUrl', text: '/images/grid-pattern.svg', placeholder: true, item: 'items.1' });
  check(r.ok && r.image && r.url === true && r.path.join('.') === 'items.1.imageUrl' && r.value === '', 'logos 第 2 项的占位图 ⟹ ok · image · url: true · 路径 items.1.imageUrl · 现值空', r);
  const ft = comp('features');
  const rf = resolveInlineSlot({ component: ft, props: { items: [{ title: 'a' }] }, slot: 'items.0.image', text: '/images/grid-pattern.svg', placeholder: true, item: 'items.0' });
  check(rf.ok && rf.image && rf.url === undefined, '对照：features 那种 {imageUrl, alt} 对象格 ⟹ 没有 url（照旧写对象）', rf);
  const src = fs.readFileSync(path.join(NEXT, 'src', 'components', 'editor', 'InlineEdit.tsx'), 'utf8');
  check(/if \(isUrlCell \|\| typeof cur === 'string'\) return url;/.test(src) && (src.match(/r\.url === true/g) || []).length === 2,
    'InlineEdit.tsx：§withUrl 按 isUrlCell 回字符串，两处 pickFor 调用都把 r.url 传进去（🔴 弱判据：只证源码接上了，行为在 e2e 1766 验收 3）');
}

// ══ ⑤ 播出来的块过得了改站那一关 ═══════════════════════════════════════════════════════════════
console.log('\n⑤ 播出来的块过 validateSite（scope: edit）');
for (const t of ['logos', 'gallery', 'reviews']) {
  const props = bp.seedProps(comp(t), 'en');
  const data = Object.fromEntries(Object.entries(props).filter(([k, v]) => !k.startsWith('_') && v !== undefined));
  const { problems } = manifestLib.validateSite({ pages: [{ slug: 'p', blocks: [{ type: t, data }] }], scope: 'edit' });
  const own = problems.filter((p) => p.includes(`"${t === 'reviews' ? 'platforms' : 'items'}"`));
  check(own.length === 0, `${t}：拖下去那一份的列表一条都不被拒`, own);
}

// ══ ⑥ 提示词 ═══════════════════════════════════════════════════════════════════════════════════
console.log('\n⑥ 提示词：logos 列的平台文件 = 表里的文件');
{
  const line = (manifestLib.loadManifests().get('logos').prompt.lines || []).find((l) => /\/images\/platforms\//.test(l)) || '';
  const listed = (line.match(/\/images\/platforms\/[a-z-]+\.svg/g) || []).sort();
  const table = Object.values(platforms.PLATFORMS).map((p) => p.logo).sort();
  check(listed.join() === table.join(), 'logos 提示词那一行列的文件逐个等于平台表', { listed, table });
}

console.log(`\n══ 汇总: 通过 ${pass} · 失败 ${fail} ══`);
process.exit(fail ? 1 : 0);
