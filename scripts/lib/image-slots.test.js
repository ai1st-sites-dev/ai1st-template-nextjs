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
 *    槽名 logo / logos 不算（生意自己的商标位）。
 * ② **本票的要害 —— 名单是不是真的现算的**：给一份 manifest 临时加一个新的 `kind: image` 槽
 *    （只在内存里加，不动盘上的文件，也不改 create-site.js 里任何名单）⟹ 那个槽被填到；
 *    把它去掉再跑 ⟹ 它不再出现。这一格红了就说明名单又变回写死的了。
 * ③ 全填一遍：一份多页夹具里每个内容图槽都拿到图，gallery 的每一项都拿到自己那张。
 *    🔴 配一格**反向对照**：让求图那步永远回空 ⟹ 这些断言必须全部翻面，否则上面的「全填上」是恒真的。
 * ④ 上限：按块在页面里的先后截断，被截掉的逐个点名进日志。
 * ⑤ 拿不到图时那行日志的格式（哪一页 · 哪个块 · 哪个槽 · 什么原因），以及一个槽失败不牵连别的槽。
 * ⑥ 今天真 manifest 上的两条回归判据：`hero-with-form.imageUrl` 在名单里（它正是本票要治的洞），
 *    `cta-banner` 一个图槽都没有（本票把它从名单里省掉）；外壳区那两个 `logo` 槽不在名单里。
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
    slots: { headline: { kind: 'text', required: true }, description: { kind: 'text', required: false } },
  },
}));

const fakeSite = () => ([
  {
    slug: 'home',
    sections: [
      { type: 'hero', data: { headline: 'Hi' } },
      { type: 'cta-banner', data: { headline: 'Call' } },
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
  check(names('cta-banner') === '', '一个图槽都没有的块，名单里不出现');

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
  check(Array.isArray(realNames('hero-with-form')) && realNames('hero-with-form').includes('imageUrl'),
    'hero-with-form 的 imageUrl 在名单里 —— 它就是本票立票的那个洞（它有图槽却一直拿不到图）');
  check(Array.isArray(realNames('cta-banner')) && realNames('cta-banner').length === 0,
    'cta-banner 一个图槽都没有 ⟹ 不再为它生成图（这是省掉，不是退化）');
  for (const shell of ['header', 'footer']) {
    check(Array.isArray(realNames(shell)) && realNames(shell).length === 0,
      `${shell} 的 logo 槽不在名单里`);
  }
  const everyKnown = [...real.entries()].every(([, m]) => imageSlotsOf(m)
    .every((s) => s.kind === 'image' || s.kind === 'list'));
  check(everyKnown, '名单里每一项都带 image / list 两种口径之一（提示词按它选取景）');

  console.log(`\n逐条断言: PASS ${pass} · FAIL ${fail}`);
  if (fail) { console.log('❌ #1386 image-slots: 有失败'); process.exit(1); }
  console.log('✅ #1386 image-slots: 全过');
})().catch((e) => die(e.stack || e.message));
