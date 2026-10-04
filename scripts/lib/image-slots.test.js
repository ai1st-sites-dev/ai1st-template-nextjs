#!/usr/bin/env node
/**
 * image-slots.test.js — 建站选图的名单按 manifest 现算（#1386）。
 *
 * 跑法:  node scripts/lib/image-slots.test.js   （或 `npm run test:scripts`，它按文件名发现）
 * 退出码: 0 全过 · 1 有失败 · 2 跑不起来（**不许当成通过**）
 *
 * ══ 守什么 ═══════════════════════════════════════════════════════════════
 * ① 「哪些槽算内容图槽」这条规则本身：单图槽算 · 列表槽带 imageUrl 算 · 列表槽不带不算 ·
 *    `kind: object` 即使 shape 里有 imageUrl 也不算（hero 的 socialProof 是顾客头像）·
 *    槽名 logo / logos 不算（生意自己的商标位）· 槽名 avatar / avatars 不算（顾客的脸，#1361）。
 * ② **本票的要害 —— 名单是不是真的现算的**：给一份 manifest 临时加一个新的 `kind: image` 槽
 *    （只在内存里加，不动盘上的文件，也不改 create-site.js 里任何名单）⟹ 那个槽被填到；
 *    把它去掉再跑 ⟹ 它不再出现。这一格红了就说明名单又变回写死的了。
 * ③ 全填一遍：一份多页夹具里每个内容图槽都拿到图，gallery 的每一项都拿到自己那张。
 *    🔴 配一格**反向对照**：让求图那步永远回空 ⟹ 这些断言必须全部翻面，否则上面的「全填上」是恒真的。
 * ④ 上限：按块在页面里的先后截断，被截掉的逐个点名进日志。
 * ⑤ 拿不到图时那行日志的格式（哪一页 · 哪个块 · 哪个槽 · 什么原因），以及一个槽失败不牵连别的槽。
 * ⑥ 今天真 manifest 上的两条回归判据：`hero` 的主图槽在名单里（#1425（T3）前是 `hero-with-form.imageUrl`，
 *    它正是本票要治的洞），`testimonials` 一个图槽都没有（前是 `cta-banner`）；外壳区那两个 `logo` 槽不在名单里。
 *    🔴 `cta-banner` 那条 2026-09-18（#1361）起换了理由，green 的来历不一样了：它**有**一个
 *    `avatars` 列表槽、每项带 `imageUrl`，是槽名那条规则把它挡在名单外的。所以那一格现在**先**
 *    断言这个槽真的在 manifest 里 —— 否则有人把槽删了，这一格照样绿，而它什么都没守。
 */

'use strict';

const path = require('path');

const NEXT = path.resolve(__dirname, '..', '..');

let pass = 0; let fail = 0;
const ok = (m) => { pass += 1; console.log(`  ✅ ${m}`); };
const bad = (m) => { fail += 1; console.log(`  ❌ ${m}`); };
const die = (m) => { console.error(`🔴 跑不起来: ${m}`); process.exit(2); };
const check = (cond, m) => (cond ? ok(m) : bad(m));

let bm; let ims;
try {
  bm = require(path.join(NEXT, 'scripts', 'lib', 'block-manifest.js'));
  ims = require(path.join(NEXT, 'scripts', 'lib', 'image-slots.js'));
} catch (e) {
  die(`require 失败: ${e.message}`);
}
const { imageSlotsOf, loadManifests } = bm;
const { collectImageSlots, capImageSlots, fillImageSlots, logMissed, slotKey } = ims;

// ── 夹具：一份自造的 manifest 集合 + 一份多页的站 ────────────────────────────────────────────
const fakeManifests = () => new Map(Object.entries({
  hero: {
    type: 'hero', displayName: 'Hero Section', category: 'banner',
    slots: {
      headline: { kind: 'text', required: true },
      imageUrl: { kind: 'image', required: false, shape: 'string' },
      socialProof: { kind: 'object', required: false, shape: '{avatars: [{imageUrl}], rating, text}' },
    },
  },
  gallery: {
    type: 'gallery', displayName: 'Gallery', category: 'gallery',
    slots: {
      headline: { kind: 'text', required: true },
      items: { kind: 'list', required: true, shape: '[{title, description?, imageUrl?: string}]' },
    },
  },
  'content-split': {
    type: 'content-split', displayName: 'Content Split', category: 'text',
    slots: {
      content: { kind: 'text', required: true },
      bullets: { kind: 'list', required: false, shape: '[string]' },
      imageUrl: { kind: 'image', required: false, shape: 'string' },
    },
  },
  header: {
    type: 'header', displayName: 'Header', category: 'region',
    slots: { logo: { kind: 'image', required: false, shape: 'string' } },
  },
  'cta-banner': {
    type: 'cta-banner', displayName: 'Call To Action', category: 'cta',
    slots: {
      headline: { kind: 'text', required: true },
      description: { kind: 'text', required: false },
      // #1361 —— 顾客头像带。形状跟 gallery 的 items 是同一族（列表 + imageUrl），**只有槽名不同** ——
      // 所以下面那一格量的就是「名字这条规则真的在起作用」，不是「这个块碰巧没有列表槽」。
      avatars: { kind: 'list', required: false, shape: '[{imageUrl}]' },
    },
  },
}));

const fakeSite = () => ([
  {
    slug: 'home',
    sections: [
      { type: 'hero', data: { headline: 'Hi' } },
      { type: 'cta-banner', data: { headline: 'Call', avatars: [{ imageUrl: '' }, { imageUrl: '' }] } },
      { type: 'gallery', data: { headline: 'Work', items: [{ title: 'a' }, { title: 'b' }, { title: 'c' }] } },
      { type: 'header', data: {} },
    ],
  },
  {
    slug: 'about',
    sections: [
      { type: 'content-split', data: { content: '<p>x</p>' } },
      { type: 'hero', data: { headline: 'Already has one', imageUrl: '/photos/kept.jpg' } },
    ],
  },
]);

const fillOpts = (pages, manifests, extra = {}) => ({
  pages,
  manifests,
  industry: 'auto repair',
  primaryColor: '#3b82f6',
  themeWord: 'minimal',
  produce: async ({ key }) => `/photos/${key}.jpg`,
  ...extra,
});

const slotsOf = (pages) => {
  const out = [];
  for (const p of pages) {
    for (const s of p.sections) {
      if (s.data && typeof s.data.imageUrl === 'string') out.push(`${p.slug}/${s.type}/imageUrl`);
      for (const it of (Array.isArray(s.data && s.data.items) ? s.data.items : [])) {
        if (it.imageUrl) out.push(`${p.slug}/${s.type}/items`);
      }
    }
  }
  return out;
};

(async () => {
  // ── ① 规则本身 ────────────────────────────────────────────────────────────────────────────
  console.log('── ① 哪些槽算内容图槽（按槽位判，不按块名判）');
  const ms = fakeManifests();
  const names = (t) => imageSlotsOf(ms.get(t)).map((s) => `${s.name}:${s.kind}`).join(',');
  check(names('hero') === 'imageUrl:image', `单图槽算，object 槽不算（hero 读到 "${names('hero')}"）`);
  check(names('gallery') === 'items:list', `列表槽带 imageUrl 算（gallery 读到 "${names('gallery')}"）`);
  check(imageSlotsOf(ms.get('content-split')).length === 1, '同一个块里不带 imageUrl 的列表槽（bullets）不算');
  check(names('header') === '', 'logo 槽不算 —— 那是生意自己的商标位，不能塞图库照片');
  check(names('cta-banner') === '',
    `槽名 avatars 不算 —— 那是顾客的脸，列表槽的提示词求的是店内细节照（cta-banner 读到 "${names('cta-banner')}"）`);
  // 🔴 反过来那一半：同一份 spec 换个槽名就**算**。少了这一格，上面那条绿也可能是
  //    「列表槽带 imageUrl 这条规则整个坏了」换来的 —— 两种原因给出同一个读数。
  const renamed = fakeManifests();
  const ctaSlots = renamed.get('cta-banner').slots;
  ctaSlots.faces = ctaSlots.avatars; delete ctaSlots.avatars;
  check(imageSlotsOf(renamed.get('cta-banner')).map((x) => `${x.name}:${x.kind}`).join(',') === 'faces:list',
    '同一份 spec 改名叫 faces ⟹ 它又算了（挡住它的是槽名，不是别的）');

  // ── ② 名单真的是现算的（本票的要害）──────────────────────────────────────────────────────
  console.log('── ② 往 manifest 里加一个新图槽 ⟹ 不改任何名单它就被填到');
  const withNew = fakeManifests();
  withNew.get('cta-banner').slots.backdropUrl = { kind: 'image', required: false, shape: 'string' };
  const pagesA = fakeSite();
  const beforeAdd = collectImageSlots(fakeSite(), fakeManifests()).filter((s) => s.secType === 'cta-banner');
  const afterAdd = collectImageSlots(pagesA, withNew).filter((s) => s.secType === 'cta-banner');
  check(beforeAdd.length === 0 && afterAdd.length === 1 && afterAdd[0].slotName === 'backdropUrl',
    `加槽之前 cta-banner 有 ${beforeAdd.length} 个图槽、加槽之后 ${afterAdd.length} 个（${afterAdd.map((s) => s.slotName).join(',')}）`);
  const rNew = await fillImageSlots(fillOpts(pagesA, withNew));
  const ctaData = pagesA[0].sections[1].data;
  check(typeof ctaData.backdropUrl === 'string' && ctaData.backdropUrl.startsWith('/photos/'),
    `新槽被填上了：${ctaData.backdropUrl}`);
  check(rNew.success === rNew.attempted && rNew.attempted > 0, `这一轮 ${rNew.success}/${rNew.attempted} 个槽拿到图`);
  // 反向：把那个槽去掉，它不再出现
  const pagesB = fakeSite();
  await fillImageSlots(fillOpts(pagesB, fakeManifests()));
  check(pagesB[0].sections[1].data.backdropUrl === undefined, '把那个槽从 manifest 去掉之后，它不再进待填清单');

  // ── ③ 全填一遍 + 反向对照 ─────────────────────────────────────────────────────────────────
  console.log('── ③ 每个内容图槽都拿到图');
  const pages = fakeSite();
  const filled = await fillImageSlots(fillOpts(pages, fakeManifests()));
  const got = slotsOf(pages);
  check(pages[0].sections[0].data.imageUrl.startsWith('/photos/'), 'home 的 hero 拿到了图');
  check(pages[1].sections[0].data.imageUrl.startsWith('/photos/'), 'about 的 content-split 拿到了图');
  check(pages[0].sections[2].data.items.every((it) => typeof it.imageUrl === 'string'),
    `gallery 三项各拿到自己那张（${pages[0].sections[2].data.items.map((it) => it.imageUrl.split('-').pop()).join(' ')}）`);
  check(pages[0].sections[3].data.logo === undefined, 'header 的 logo 槽没有被塞图库照片');
  check(pages[0].sections[1].data.imageUrl === undefined, 'cta-banner 没有图槽 ⟹ 一张图都不为它生成');
  // 🔴 槽里本来就有值的也照样求图并覆盖 —— AI 自己填的那个值不可信（TICKET-172 那种编出来的
  //    `gradient-about`）。用户真上传了照片的那条路在调用点就整段跳过选图，走不到这里。
  check(pages[1].sections[1].data.imageUrl.startsWith('/photos/about-s1-hero-'),
    `AI 自己编的那个值被真图覆盖了（${pages[1].sections[1].data.imageUrl}）`);
  check(filled.success === 6 && filled.totalSlots === 6, `这份夹具上共 6 个图槽，全部填上（读到 ${filled.success}/${filled.totalSlots}）`);
  // 🔴 反向对照：求图那步永远回空 ⟹ 上面那些断言必须全部翻面
  const empty = fakeSite();
  const none = await fillImageSlots(fillOpts(empty, fakeManifests(), { produce: async () => null }));
  check(none.success === 0 && none.failures.length === 6 && slotsOf(empty).length === 1,
    `反向对照：求不到图时 0 个槽被填（失败 ${none.failures.length} 个，站里只剩 AI 自己填的那 1 处）`);
  // 6 = 新填的 5 张 + about 那个本来就带图的 hero；反向那一轮只剩后者那 1 张。
  check(got.length === 6, `正向那一轮站里数出 ${got.length} 处有图 —— 跟反向那一轮的 1 处分得开`);

  // ── ④ 上限 ────────────────────────────────────────────────────────────────────────────────
  console.log('── ④ 超过上限按页面先后截断，截掉的逐个点名');
  const capped = capImageSlots(collectImageSlots(fakeSite(), fakeManifests()), 2);
  check(capped.kept.length === 2 && capped.dropped.length === 4, `上限 2：留 ${capped.kept.length} 个、截 ${capped.dropped.length} 个`);
  check(capped.kept[0].pageSlug === 'home' && capped.kept[0].secType === 'hero',
    `留下的是页面里最靠前的那些（第一个是 ${capped.kept[0].pageSlug}/${capped.kept[0].secType}）`);
  const lines = [];
  const capRun = await fillImageSlots(fillOpts(fakeSite(), fakeManifests(), { cap: 2, log: (l) => lines.push(l) }));
  const capLine = lines.find((l) => l.includes('超出上限'));
  check(!!capLine && capRun.dropped.every((s) => capLine.includes(slotKey(s))),
    `截掉的槽逐个点名在日志里：${capLine}`);
  check(capRun.success === 2, `上限之内的 ${capRun.success} 个照常拿到图`);

  // ── ⑤ 拿不到图时的那行日志 + 一个槽失败不牵连别的 ──────────────────────────────────────────
  console.log('── ⑤ 拿不到图是正常退化，但必须说清楚是哪一页哪个块哪个槽');
  const one = { pageSlug: 'home', secIdx: 2, secType: 'gallery', slotName: 'items', kind: 'list', itemIdx: 1 };
  const line = logMissed(one, '配额用完');
  check(line === '[photo-slot] 没拿到图 —— 页面 home · 块 gallery · 槽 items#1 · 原因: 配额用完',
    `日志格式：${line}`);
  const flaky = fakeSite();
  const logs = [];
  const r = await fillImageSlots(fillOpts(flaky, fakeManifests(), {
    log: (l) => logs.push(l),
    produce: async ({ slot, key }) => {
      if (slot.secType === 'gallery' && slot.itemIdx === 1) throw new Error('Nano Banana 503');
      return `/photos/${key}.jpg`;
    },
  }));
  check(r.success === 5 && r.failures.length === 1 && r.failures[0].reason === 'Nano Banana 503',
    `一个槽失败，其余 ${r.success} 个照常（失败原因原样带出：${r.failures[0].reason}）`);
  check(flaky[0].sections[2].data.items[1].imageUrl === undefined
    && typeof flaky[0].sections[2].data.items[2].imageUrl === 'string',
    '失败那一项留空、它后面那一项照样拿到图');
  check(logs.some((l) => l === '[photo-slot] 没拿到图 —— 页面 home · 块 gallery · 槽 items#1 · 原因: Nano Banana 503'),
    '那一行真的被打出来了');

  // ── ⑥ 今天真 manifest 上的回归判据 ────────────────────────────────────────────────────────
  console.log('── ⑥ 真 manifest（相对判据，不写死总数）');
  let real;
  try { real = loadManifests(); } catch (e) { die(`loadManifests 失败: ${e.message}`); }
  const realNames = (t) => (real.get(t) ? imageSlotsOf(real.get(t)).map((s) => s.name) : null);
  // 📌 #1425（T3）—— 这里原来点名 `hero-with-form.imageUrl`（本票立票的那个洞）与 `cta-banner.avatars`；
  //    两个块随旧库删了。今天的等价物：带表单的首屏就是 `hero`（`options.form`），它的主图槽是 `image`；
  //    「有图槽但该挡」那一臂换成 `testimonials.items`（每项 `photo.imageUrl` 是顾客的脸，挡它的是
  //    `generateImages: false`；槽名 avatars 那条规则仍由 ① 的假 manifest 两臂钉着）。
  check(Array.isArray(realNames('hero')) && realNames('hero').includes('image'),
    `hero 的主图槽 image 在名单里 —— 建站时首屏得拿到图（现取 ${JSON.stringify(realNames('hero'))}）`);
  check(Array.isArray(realNames('hero')) && realNames('hero').includes('band'),
    `hero 的 band（[{imageUrl}] 列表）在名单里（现取 ${JSON.stringify(realNames('hero'))}）`);
  // 🔴 先证「有东西可挡」再证「挡住了」：不先量一句，删掉那个槽也是绿 —— 那时它什么都没守。
  const tSpec = ((real.get('testimonials') || {}).slots || {}).items;
  check(!!tSpec && tSpec.kind === 'list' && String(tSpec.shape).includes('imageUrl') && tSpec.generateImages === false,
    `testimonials 真的有一个带 imageUrl 的列表槽 items、并声明 generateImages:false（现取 ${JSON.stringify(tSpec && { kind: tSpec.kind, shape: tSpec.shape, generateImages: tSpec.generateImages })}）`);
  check(Array.isArray(realNames('testimonials')) && realNames('testimonials').length === 0,
    'testimonials 一个图槽都没有 ⟹ 不为顾客头像生成图库照片');
  for (const shell of ['header', 'footer']) {
    check(Array.isArray(realNames(shell)) && realNames(shell).length === 0,
      `${shell} 的 logo 槽不在名单里`);
  }
  // 📌 #1425（T3）—— 第三种口径 `object`（新库的主图 `{imageUrl, alt}`）；提示词把它跟单图槽同样取景。
  const everyKnown = [...real.entries()].every(([, m]) => imageSlotsOf(m)
    .every((s) => s.kind === 'image' || s.kind === 'list' || s.kind === 'object'));
  check(everyKnown, '名单里每一项都带 image / list / object 三种口径之一（提示词按它选取景）');

  // ── ⑦ #1475 —— 列表项的图嵌一层（features 的 `image?: {imageUrl, alt}`）─────────────────────
  // QA2 r1 真 AI 建站读到的：写回写成了 items[i].imageUrl（平铺），而块读的是 items[i].image.imageUrl
  // ⟹ Photo cards / Cover cards 一张图都不显示。数据形状照那次 AI 真吐出来的（项里没有 image）。
  console.log('── ⑦ 列表项的图嵌在对象里时，写回那一层（#1475）');
  // 📌 #1425（T3）—— features 还有两个对象图槽（introImage / itemsImage，要配旋钮才显示），这一格只看 items 那一项。
  const fnAll = real.get('features') ? imageSlotsOf(real.get('features')) : null;
  const fnSlots = fnAll ? fnAll.filter((x) => x.name === 'items') : null;
  check(JSON.stringify(fnSlots) === JSON.stringify([{ name: 'items', kind: 'list', imageKey: 'image' }]),
    `features 的 items 槽读出 imageKey=image（现取 ${JSON.stringify(fnSlots)}）`);
  // 📌 #1425（T3）—— 原来「平铺那一族」是旧 gallery 的 items；新 gallery 的项也嵌一层（`image: {imageUrl, alt}`），
  //    今天平铺的那一族是 hero 的 band（`[{imageUrl, alt?}]`）。
  check(JSON.stringify(imageSlotsOf(real.get('gallery'))) === JSON.stringify([{ name: 'items', kind: 'list', imageKey: 'image' }]),
    `gallery 的 items 也读出 imageKey=image（现取 ${JSON.stringify(imageSlotsOf(real.get('gallery')))}）`);
  const bandSlot = imageSlotsOf(real.get('hero')).find((x) => x.name === 'band');
  check(!!bandSlot && !bandSlot.imageKey,
    `平铺的那一族（hero 的 band）不带 imageKey —— 照旧写 band[i].imageUrl（现取 ${JSON.stringify(bandSlot)}）`);
  const aiItems = () => [
    { icon: 'shield-check', title: 'Vehicle Diagnostics', text: 'x' },
    { icon: 'tools', title: 'Brakes', text: 'y', image: { alt: 'Brake pads' } },
    { icon: 'disc', title: 'Tires', text: 'z' },
  ];
  const fnPages = [{ slug: 'home', sections: [
    { type: 'features', shape: 'photo-cards', data: { title: 'Services', items: aiItems() } },
    { type: 'hero', data: { headline: 'Hi', band: [{ alt: 'a' }] } },
  ] }];
  const fnRun = await fillImageSlots(fillOpts(fnPages, real));
  const fnOut = fnPages[0].sections[0].data.items;
  check(fnRun.failures.length === 0 && fnOut.every((it) => typeof (it.image && it.image.imageUrl) === 'string' && it.image.imageUrl.startsWith('/photos/')),
    `fillImageSlots 之后 features 每一项都有 image.imageUrl（${fnOut.map((it) => it.image && it.image.imageUrl).join(' · ')}）`);
  check(fnOut.every((it) => it.imageUrl === undefined), '没有写成平铺的 items[i].imageUrl');
  check(fnOut[1].image.alt === 'Brake pads', `项里原来的 image.alt 留着（读到 ${JSON.stringify(fnOut[1].image)}）`);
  const galOut = fnPages[0].sections[1].data.band[0];
  check(typeof galOut.imageUrl === 'string' && galOut.image === undefined, `同一页的 hero band 照旧平铺（读到 ${JSON.stringify(galOut)}）`);

  // ── ⑧ #1425（T3）—— 新库的主图是对象槽 `{imageUrl, alt}`。求不求图看这一块自己的**同名旋钮**写没写：没写 = 默认 none，
  //    填了也不显示、而且改站校验会拒那一页；写了非 none 才求。写回只换 imageUrl、alt 留着。
  console.log('── ⑧ 对象图槽（#1425）');
  const obPages = [{ slug: 'home', sections: [
    { type: 'hero', data: { headline: 'Hi', image: { alt: 'Our shop' }, options: { image: 'left' } } },
    { type: 'cta', data: { headline: 'Go' } },
    { type: 'hero', data: { headline: 'No knob', image: { alt: 'x' } } },
    { type: 'features', data: { headline: 'H', introImage: { alt: 'intro' }, items: [{ title: 't', text: 'x' }] } },
    { type: 'features', data: { headline: 'H', options: { introImage: 'left' }, items: [{ title: 't', text: 'x' }] } },
  ] }];
  const obSlots = collectImageSlots(obPages, real).map((x) => `${x.secIdx}.${x.slotName}`);
  check(obSlots.includes('0.image'), `旋钮写了 image: left 的 hero 收（读到 ${obSlots.join(' · ')}）`);
  check(!obSlots.includes('1.image') && !obSlots.includes('2.image'),
    '反向：旋钮没写的 cta、写了图却没写旋钮的 hero 都不收（填了也不显示，改站校验还会拒那一页）');
  check(!obSlots.includes('3.introImage') && obSlots.includes('4.introImage'),
    '非主图同理：features.introImage 只在 options.introImage 写了非 none 时才收（第 3 块只写了对象不收、第 4 块写了旋钮收）');
  await fillImageSlots(fillOpts(obPages, real));
  const heroImg = obPages[0].sections[0].data.image;
  check(typeof heroImg.imageUrl === 'string' && heroImg.imageUrl.startsWith('/photos/') && heroImg.alt === 'Our shop',
    `hero.image 写回成 {imageUrl, alt}、alt 留着（读到 ${JSON.stringify(heroImg)}）`);
  const fImg = obPages[0].sections[4].data.introImage;
  check(fImg && typeof fImg === 'object' && typeof fImg.imageUrl === 'string', `没写过 introImage 的 features 写回成对象、不是一格字符串（读到 ${JSON.stringify(fImg)}）`);
  check(obPages[0].sections[1].data.image === undefined, '没收的 cta 一个字节没写');
  const vs = require('../lib/block-manifest.js').validateSite({ pages: obPages.map((p) => ({ slug: p.slug, blocks: p.sections.map((b, i) => ({ id: `b${i}`, ...b })) })), scope: 'edit' });
  const imgProbs = (vs.problems || []).filter((x) => /options\.(image|introImage) 没写/.test(x));
  // 求过图的是第 1 块（hero）和第 5 块（features）；第 3、4 块是夹具里本来就「写了图、没写旋钮」的输入，它们被报是对的。
  check(imgProbs.filter((x) => /第 (1|5) 个块/.test(x)).length === 0 && imgProbs.filter((x) => /第 (3|4) 个块/.test(x)).length === 2,
    `填完之后求过图的两块改站校验不报；本来就没写旋钮的两块照报（尺子有牙）—— 读到 ${imgProbs.length} 条`);

  // ── ⑨ #1549 —— 填完图写 alt：每张内容图非空，每页第一张含这一页的目标词 ───────────────────────
  console.log('\n── ⑨ #1549 生图流程写 alt（生产侧）');
  {
    const { seoProblems } = require('./seo-problems');
    const KW = 'drain cleaning Markham';
    const altPages = () => [{
      slug: 'services/drains', title: 'Drains',
      sections: [
        { type: 'page-header', data: { headline: 'Drains', options: { image: 'left' }, image: {} } },
        { type: 'content', data: { headline: 'Why drains clog', options: { image: 'right' }, image: { alt: 'Roots inside an old clay pipe' } } },
        { type: 'gallery', data: { headline: 'Our work', items: [{ title: 'Kitchen sink', image: {} }, { image: {} }] } },
      ],
    }, { slug: 'about', title: 'About us', sections: [{ type: 'content', data: { headline: 'Our story', options: { image: 'left' }, image: {} } }] }];
    let n = 0;
    const produce = async () => `/photos/p${(n += 1)}.jpg`;
    const pages = altPages();
    await fillImageSlots({ pages, manifests: real, industry: 'plumbing', primaryColor: '#123456', themeWord: 'x', produce,
      targetKeywordOf: (p) => (p.slug === 'services/drains' ? KW : '') });
    const { contentImagesOf } = require('./seo-problems');
    const imgs = contentImagesOf(pages[0], real);
    check(imgs.length === 4 && imgs.every((x) => typeof x.img.imageUrl === 'string' && x.img.imageUrl.startsWith('/photos/')),
      `夹具第一页 4 张内容图都求到了图（读到 ${imgs.length} 张）`);
    check(imgs.every((x) => typeof x.img.alt === 'string' && x.img.alt.trim()), `每一张 alt 非空（读到 ${JSON.stringify(imgs.map((x) => x.img.alt))}）`);
    check(imgs[0].img.alt.includes(KW) && imgs.slice(1).every((x) => !x.img.alt.includes(KW)),
      `第一张内容图（page-header）的 alt 含目标词，其余不硬塞（读到「${imgs[0].img.alt}」）`);
    check(imgs[1].img.alt === 'Roots inside an old clay pipe', 'AI 自己写的 alt 留着');
    check(imgs[2].img.alt === 'Kitchen sink', '没写 alt 的 gallery 项用自己的标题');
    const about = contentImagesOf(pages[1], real);
    check(about.length === 1 && about[0].img.alt === 'Our story', '没有目标词的页：只保证非空（读到 ' + JSON.stringify(about.map((x) => x.img.alt)) + '）');
    const p6 = (page, kw) => seoProblems({ page, pages, targetKeyword: kw, brand: { name: { en: 'Acme' } }, payload: {}, locale: 'en', seo: {} })
      .filter((x) => x.startsWith('[6 '));
    check(p6(pages[0], KW).length === 0 && p6(pages[1], '').length === 0, '生产侧写完，seoProblems 第 6 条两页都不报（两侧用的同一份判据）');
    // 反向对照：不给目标词 ⟹ 第一张不含它，检查侧第 6 条必须开火
    const bare = altPages();
    await fillImageSlots({ pages: bare, manifests: real, industry: 'plumbing', primaryColor: '#123456', themeWord: 'x', produce });
    check(p6(bare[0], KW).some((x) => x.includes('没有一张含目标词')), '　反向对照：生产侧不拿目标词 ⟹ 第 6 条报「没有一张含目标词」');
    // 反向对照：求不到图 ⟹ 没有 imageUrl，不写 alt（没图的槽不出 <img>）
    const none = altPages();
    await fillImageSlots({ pages: none, manifests: real, industry: 'plumbing', primaryColor: '#123456', themeWord: 'x', produce: async () => null,
      targetKeywordOf: () => KW });
    check(contentImagesOf(none[0], real).length === 0 && none[0].sections[0].data.image.alt === undefined, '　反向对照：求不到图的槽不算内容图，也不写 alt');
  }

  // ⑩ #1566 —— 图片文件名放得下：顶格 slug 拼出来的 key 收进上限，截了也唯一，短 slug 一个字节都不动。
  console.log('\n── ⑩ #1566 图片文件名的长度上限');
  {
    const fs = require('fs');
    const os = require('os');
    const { SLUG_MAX_BYTES, FILENAME_MAX_BYTES } = require('./keyword-slug');
    const { SLOT_KEY_MAX_BYTES, IMAGE_FILE_SUFFIX } = ims;
    const fileName = (sl) => `${slotKey(sl)}${IMAGE_FILE_SUFFIX}`;
    const B = (x) => Buffer.byteLength(x);
    check(SLOT_KEY_MAX_BYTES === FILENAME_MAX_BYTES - B(IMAGE_FILE_SUFFIX),
      `上限 = 单个文件名上限 ${FILENAME_MAX_BYTES} − 后缀「${IMAGE_FILE_SUFFIX}」（读到 ${SLOT_KEY_MAX_BYTES}）`);
    // 短 slug 逐字不变（AC5 的单元版；真站那份对照在交接里贴）
    const short = { pageSlug: 'services/drain-cleaning', secIdx: 2, secType: 'features', slotName: 'items', itemIdx: 1 };
    check(slotKey(short) === 'services_drain-cleaning-s2-features-items-i1', `短 slug 的 key 跟以前逐字相同（读到 ${slotKey(short)}）`);
    // 顶格：两条路的 pageSlug 都顶到 SLUG_MAX_BYTES
    const top = 'd'.repeat(SLUG_MAX_BYTES);
    const tops = [`services/${top}`, `services/drain-cleaning/${top}`];
    const shapes = [
      { secIdx: 0, secType: 'hero', slotName: 'image', itemIdx: null },
      { secIdx: 3, secType: 'features', slotName: 'items', itemIdx: 9 },
      { secIdx: 3, secType: 'features', slotName: 'items', itemIdx: 10 },
    ];
    for (const pageSlug of tops) {
      const raw = `${pageSlug}-s0-hero-image`.replace(/[^a-zA-Z0-9-]/g, '_');
      check(B(raw) + B(IMAGE_FILE_SUFFIX) > FILENAME_MAX_BYTES, `　阳性对照：不截的话 ${pageSlug.slice(0, 26)}… 的文件名是 ${B(raw) + B(IMAGE_FILE_SUFFIX)} 字节，放不下`);
      const names = shapes.map((sh) => fileName({ pageSlug, ...sh }));
      check(names.every((n) => B(n) <= FILENAME_MAX_BYTES), `顶格 ${pageSlug.slice(0, 26)}…：每个文件名 ≤ ${FILENAME_MAX_BYTES}（读到 ${names.map(B).join(' / ')}）`);
      check(new Set(names).size === names.length, '　同一页三个槽（含只在尾部不同的第 9 / 第 10 项）文件名各不相同');
      const tails = ['-s0-hero-image.jpg', '-s3-features-items-i9.jpg', '-s3-features-items-i10.jpg'];
      check(names.every((n, i) => new RegExp(`-[0-9a-f]{10}${tails[i].replace(/\./g, '\\.')}$`).test(n)),
        `　坐标那一截原样保留（读到 …${names.map((n) => n.slice(-28)).join(' · …')}）`);
      // 真写盘：两个文件都在、内容不互相覆盖（AC4）
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'slotkey-'));
      try {
        names.forEach((n, i) => fs.writeFileSync(path.join(dir, n), `img-${i}`));
        const back = names.map((n) => fs.readFileSync(path.join(dir, n), 'utf8'));
        check(back.join(',') === 'img-0,img-1,img-2' && fs.readdirSync(dir).length === 3, `　写盘：${fs.readdirSync(dir).length} 个文件都在，各是各的内容（读到 ${back.join(',')}）`);
      } catch (e) {
        bad(`　写盘抛了：${e.code || e.message}`);
      } finally {
        fs.rmSync(dir, { recursive: true, force: true });
      }
    }
    // 全部块库的图槽（不是挑出来的三种形状）：每个块 × 每个图槽，块序号 / 项序号取两位数，两条路顶格 ⟹ 都放得下、页内互不相同。
    // 📌 头像（hero / pricing 的 proof.avatars）不在这份清单里 —— imageSlotsOf 不收它们，建站不为它们求图。
    {
      const bm = require('./block-manifest');
      const all = [];
      for (const [type, m] of bm.loadManifests()) for (const sl of bm.imageSlotsOf(m) || []) all.push({ secIdx: 12, secType: type, slotName: sl.name, itemIdx: sl.kind === 'list' ? 12 : null });
      for (const pageSlug of tops) {
        const names = all.map((sh) => fileName({ pageSlug, ...sh }));
        const longest = Math.max(...names.map(B));
        check(all.length >= 8 && longest <= FILENAME_MAX_BYTES && new Set(names).size === names.length,
          `全部 ${all.length} 个图槽 × 顶格 ${pageSlug.slice(0, 26)}…：最长文件名 ${longest} ≤ ${FILENAME_MAX_BYTES}、互不相同`);
      }
    }
    // 跨页：顶格 id 和它去重出来的 `<截短>-2` 截完前缀相同 ⟹ 靠哈希分开
    const a = { pageSlug: `services/${top}`, secIdx: 0, secType: 'hero', slotName: 'image', itemIdx: null };
    const b2 = { ...a, pageSlug: `services/${top.slice(0, SLUG_MAX_BYTES - 2)}-2` };
    check(slotKey(a) !== slotKey(b2) && B(slotKey(b2)) <= SLOT_KEY_MAX_BYTES, '两页 pageSlug 只在尾部不同（顶格 id 与它的 -2）⟹ 截完 key 仍不同');
    // 恰好顶到上限的那一个不截、上限 +1 的那一个截（边界两侧）
    const fit = (n) => ({ pageSlug: 'x'.repeat(n - '-s0-hero-image'.length), secIdx: 0, secType: 'hero', slotName: 'image', itemIdx: null });
    check(slotKey(fit(SLOT_KEY_MAX_BYTES)) === `${'x'.repeat(SLOT_KEY_MAX_BYTES - 14)}-s0-hero-image`, `key 恰好 ${SLOT_KEY_MAX_BYTES} 字节 ⟹ 原样不截`);
    const over = slotKey(fit(SLOT_KEY_MAX_BYTES + 1));
    check(B(over) <= SLOT_KEY_MAX_BYTES && /-[0-9a-f]{10}-s0-hero-image$/.test(over), `key ${SLOT_KEY_MAX_BYTES + 1} 字节 ⟹ 截到 ${B(over)}、接上哈希`);
  }

  // ⑪ #1573 —— 非 ASCII 的 pageSlug 不撞名：safe() 把每个非 ASCII 字符换成一个 `_`，等长的两个中文 slug 以前拼出同一个 key。
  console.log('\n── ⑪ #1573 非 ASCII pageSlug 的图片文件名不撞');
  {
    const fs = require('fs');
    const os = require('os');
    const { SLUG_MAX_BYTES, FILENAME_MAX_BYTES } = require('./keyword-slug');
    const { SLOT_KEY_MAX_BYTES, IMAGE_FILE_SUFFIX } = ims;
    const B = (x) => Buffer.byteLength(x);
    const hero = (pageSlug) => ({ pageSlug, secIdx: 0, secType: 'hero', slotName: 'image', itemIdx: null });
    // 改前那一版的写法（只做 safe()，不看是不是 ASCII）—— 阳性对照：同一组输入在它下面确实撞
    const before = (sl) => [sl.pageSlug, `s${sl.secIdx}`, sl.secType, sl.slotName].join('-').replace(/[^a-zA-Z0-9-]/g, '_');
    const pairs = [
      ['两个等长中文服务 id', 'services/水管维修', 'services/电路安装'],
      ['两个等长 emoji slug', 'services/🚰🔧', 'services/🔌💡'],
      ['中文 slug 与同长度全 `_` 的 ASCII slug', 'services/水管维修', 'services/____'],
    ];
    for (const [label, x, y] of pairs) {
      check(before(hero(x)) === before(hero(y)), `　阳性对照（改前）：${label} 拼出同一个 key（读到 ${before(hero(x))}）`);
      const kx = slotKey(hero(x));
      const ky = slotKey(hero(y));
      check(kx !== ky, `${label} ⟹ key 不同（读到 ${kx} · ${ky}）`);
      // 真写盘：两个文件都在、内容不互相覆盖（AC1）
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'slotkey-1573-'));
      try {
        fs.writeFileSync(path.join(dir, `${kx}${IMAGE_FILE_SUFFIX}`), 'img-x');
        fs.writeFileSync(path.join(dir, `${ky}${IMAGE_FILE_SUFFIX}`), 'img-y');
        const back = [kx, ky].map((k) => fs.readFileSync(path.join(dir, `${k}${IMAGE_FILE_SUFFIX}`), 'utf8'));
        check(back.join(',') === 'img-x,img-y' && fs.readdirSync(dir).length === 2, `　写盘：${fs.readdirSync(dir).length} 个文件都在，各是各的内容（读到 ${back.join(',')}）`);
      } finally {
        fs.rmSync(dir, { recursive: true, force: true });
      }
    }
    // 纯 ASCII 的那一侧一个字节不变（含 `_` 和 `/` 这类会被 safe() 换掉的 ASCII 字符）
    check(slotKey(hero('services/____')) === 'services_____-s0-hero-image', `纯 ASCII slug 的 key 跟以前逐字相同（读到 ${slotKey(hero('services/____'))}）`);
    check(slotKey(hero('services/drain-cleaning')) === before(hero('services/drain-cleaning')), '　services/drain-cleaning 跟改前那一版逐字相同');
    // 同一页里两个只在尾部不同的槽（#1566 AC4 那一条）：中文 slug 下仍各不相同
    const z9 = slotKey({ pageSlug: 'services/水管维修', secIdx: 3, secType: 'features', slotName: 'items', itemIdx: 9 });
    const z10 = slotKey({ pageSlug: 'services/水管维修', secIdx: 3, secType: 'features', slotName: 'items', itemIdx: 10 });
    check(z9 !== z10 && /-s3-features-items-i9$/.test(z9) && /-s3-features-items-i10$/.test(z10), `中文 slug 同一页第 9 / 第 10 项 ⟹ key 不同、坐标原样（读到 …${z9.slice(-24)} · …${z10.slice(-25)}）`);
    // 顶格的中文 slug（字节顶到 SLUG_MAX_BYTES）：文件名仍放得下（AC4）
    const zhTop = '水'.repeat(Math.floor(SLUG_MAX_BYTES / B('水')));
    for (const pageSlug of [`services/${zhTop}`, `services/drain-cleaning/${zhTop}`]) {
      const names = [hero(pageSlug), { pageSlug, secIdx: 12, secType: 'features', slotName: 'items', itemIdx: 12 }].map((sl) => `${slotKey(sl)}${IMAGE_FILE_SUFFIX}`);
      check(names.every((n) => B(n) <= FILENAME_MAX_BYTES && B(n) - B(IMAGE_FILE_SUFFIX) <= SLOT_KEY_MAX_BYTES) && names[0] !== names[1],
        `顶格中文 slug（${B(zhTop)} 字节）${pageSlug.slice(0, 24)}…：文件名 ${names.map(B).join(' / ')} ≤ ${FILENAME_MAX_BYTES}、互不相同`);
    }
  }

  console.log(`\n逐条断言: PASS ${pass} · FAIL ${fail}`);
  if (fail) { console.log('❌ #1386 image-slots: 有失败'); process.exit(1); }
  console.log('✅ #1386 image-slots: 全过');
})().catch((e) => die(e.stack || e.message));
