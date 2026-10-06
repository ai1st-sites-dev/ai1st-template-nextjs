#!/usr/bin/env node
// #1601 AC1 —— 整站配方的数据（lib/site-recipe.js）：16 个行业组每组一份 + 一份默认配方，每份都过下面这把尺。
//
// 尺子不读实现里的常量来判自己（块名单、预设名单、行业组名单都从别处现取）：
//   行业组   theme-pipeline/industry-sectors.js 的 SECTORS
//   块       templates/nextjs/blocks/*/manifest.json（目录里现数，不经 block-manifest 的缓存）
//   预设     那份 manifest 顶层的 presets[].name
// 每份配方先按两个服务展开（sitePagesFor），量的是「展开之后建出来的那张清单」，不是配方对象长什么样。
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const R = require('./site-recipe');
const { SECTORS, sectorIndexForIndustry } = require('../theme-pipeline/industry-sectors');

const BLOCKS_DIR = path.resolve(__dirname, '..', '..', 'blocks');
const MANIFESTS = new Map(fs.readdirSync(BLOCKS_DIR)
  .filter((d) => fs.existsSync(path.join(BLOCKS_DIR, d, 'manifest.json')))
  .map((d) => [d, JSON.parse(fs.readFileSync(path.join(BLOCKS_DIR, d, 'manifest.json'), 'utf8'))]));

let pass = 0;
let fail = 0;
function check(name, fn) {
  try { fn(); pass += 1; console.log(`  ✅ ${name}`); } catch (e) { fail += 1; console.log(`  ❌ ${name}\n     ${e.message}`); }
}

const SVC = ['alpha', 'beta'];
// 一份行业词能落到哪一组：拿那一组词表的第一个词问 sectorIndexForIndustry（走的是建站时同一条判组的路）。
const WORD_OF = Object.fromEntries(SECTORS.map((s) => [s.key, s.words[0]]));

/** AC1 那把尺：展开后的清单有什么不对，逐条说出来。空数组 = 合格。 */
function problemsOf(plan, svc = SVC) {
  const out = [];
  const slugs = plan.pages.map((p) => p.slug);
  const has = new Set(slugs);
  if (!has.has('home')) out.push('没有首页');
  for (const id of svc) if (!has.has(`services/${id}`)) out.push(`没有服务页 services/${id}`);
  if (!has.has('contact')) out.push('没有 contact');
  for (const p of plan.pages) {
    if (p.slug === 'home') continue; // 首页的块序归 #1034 的首页开场配方
    if (!p.blocks.length) out.push(`${p.slug} 的块序是空的`);
    for (const b of p.blocks) {
      const m = MANIFESTS.get(b.type);
      if (!m) { out.push(`${p.slug} 用了块库里没有的块 "${b.type}"`); continue; }
      if (!(m.presets || []).some((x) => x.name === b.preset)) out.push(`${p.slug} 的 "${b.type}" 用了它没有的预设 "${b.preset}"`);
    }
  }
  if (!has.has(plan.ctaPage)) out.push(`行动按钮指向的 "${plan.ctaPage}" 不在清单里`);
  for (const n of plan.nav) if (!has.has(n)) out.push(`导航里的 "${n}" 不在清单里`);
  // 顶部导航到得了每一张服务页：直接在导航里，或导航里某一页有一块 features 写 {source: "services"}（展开时链到每张服务页）
  const listsServices = plan.nav.some((n) => {
    const p = plan.pages.find((x) => x.slug === n);
    return p && p.blocks.some((b) => b.type === 'features' && /\{"source": "services"\}/.test(b.note || ''));
  });
  for (const id of svc) {
    if (!plan.nav.includes(`services/${id}`) && !listsServices) out.push(`顶部导航到不了 services/${id}`);
  }
  return out;
}

console.log('══ #1601 AC1 整站配方的数据 ══');

check(`行业组：配方里的组 == SECTORS 的 ${SECTORS.length} 组，一个不多一个不少`, () => {
  assert.strictEqual(SECTORS.length, 16);
  assert.deepStrictEqual(Object.keys(R.SITE_RECIPES).sort(), SECTORS.map((s) => s.key).sort());
});

check(`块库：manifest 现数 ${MANIFESTS.size} 份（正文写的 17）`, () => {
  assert.strictEqual(MANIFESTS.size, 17, [...MANIFESTS.keys()].join(' '));
});

for (const s of SECTORS) {
  check(`${s.key}：「${WORD_OF[s.key]}」判到这一组，展开后的清单过 AC1 那把尺；有一行理由`, () => {
    assert.strictEqual(SECTORS[sectorIndexForIndustry(WORD_OF[s.key])].key, s.key);
    const plan = R.sitePagesFor(WORD_OF[s.key], { services: SVC });
    assert.strictEqual(plan.sector, s.key);
    assert.deepStrictEqual(problemsOf(plan), []);
    assert.ok(typeof R.SITE_RECIPES[s.key].why === 'string' && R.SITE_RECIPES[s.key].why.length > 10, '没有理由');
  });
}

check('认不出组的行业（pet grooming / church）⟹ 默认配方，过同一把尺', () => {
  for (const w of ['pet grooming', 'church']) {
    assert.strictEqual(sectorIndexForIndustry(w), -1, `${w} 今天认得出来了，换一个词`);
    const { sector, recipe } = R.siteRecipeForIndustry(w);
    assert.strictEqual(sector, null);
    assert.strictEqual(recipe, R.DEFAULT_RECIPE);
    assert.deepStrictEqual(problemsOf(R.sitePagesFor(w, { services: SVC })), []);
  }
});

check('beauty（7 服务发廊那一组）：首页 + 服务列表页 + 每个服务一页 + contact，没有 about / faq / gallery / quote', () => {
  const plan = R.sitePagesFor('hair salon', { services: SVC });
  assert.deepStrictEqual(plan.pages.map((p) => p.slug), ['home', 'services', 'services/alpha', 'services/beta', 'contact']);
  assert.deepStrictEqual(plan.nav, ['services']);
  assert.strictEqual(plan.ctaPage, 'contact');
});

check('服务给对象（站级回包的形状）也认它的 id；一个服务就一张服务页（#1601 做什么 3：不再有「少于 3 个」那道闸）', () => {
  const plan = R.sitePagesFor('hair salon', { services: [{ id: 'cut', name: '剪发' }] });
  assert.deepStrictEqual(plan.pages.filter((p) => p.serviceDetailPage).map((p) => [p.slug, p.parentService]), [['services/cut', 'cut']]);
  assert.deepStrictEqual(problemsOf(plan, ['cut']), []);
});

// ── 尺子的判别力：每一条都拿一份故意弄坏的清单驱动一次 ─────────────────────────────────────────────
check('判别力：把尺子喂坏清单，每种坏法各报一条（上面那些绿格不是恒绿）', () => {
  const good = R.sitePagesFor('plumbing', { services: SVC });
  const bend = (fn) => { const p = JSON.parse(JSON.stringify(good)); fn(p); return problemsOf(p); };
  const cases = {
    '块库里没有的块': (p) => { p.pages[1].blocks[1].type = 'not-a-block'; },
    '没有的预设': (p) => { p.pages[1].blocks[0].preset = 'No such preset'; },
    '空块序': (p) => { p.pages[1].blocks = []; },
    '按钮指清单外': (p) => { p.ctaPage = 'quote'; },
    '导航指清单外': (p) => { p.nav.push('gallery'); },
    '没有 contact': (p) => { p.pages = p.pages.filter((x) => x.slug !== 'contact'); },
    '少一张服务页': (p) => { p.pages = p.pages.filter((x) => x.slug !== 'services/beta'); },
    '导航到不了服务页': (p) => { p.nav = p.nav.filter((x) => x !== 'services'); },
  };
  assert.deepStrictEqual(problemsOf(good), []);
  for (const [why, fn] of Object.entries(cases)) assert.ok(bend(fn).length >= 1, `${why}：尺子没报`);
});

// ── 后台关掉配方里的块（同 #1346 在 skipAI 路上的写法）──────────────────────────────────────────────
check('关掉 faq ⟹ faq 页整页不要、导航里也没有它；服务页的块序里没有 faq，其余原样', () => {
  const on = R.sitePagesFor('plumbing', { services: SVC });
  const off = R.sitePagesFor('plumbing', { services: SVC, disabledBlocks: ['faq'] });
  assert.ok(on.pages.some((p) => p.slug === 'faq') && on.nav.includes('faq'), '对照臂：不关的时候 plumbing 有 faq 页');
  assert.ok(!off.pages.some((p) => p.slug === 'faq') && !off.nav.includes('faq'));
  const types = (plan) => plan.pages.find((p) => p.slug === 'services/alpha').blocks.map((b) => b.type);
  assert.deepStrictEqual(types(off), types(on).filter((t) => t !== 'faq'));
  assert.ok(types(on).includes('faq'));
});
check('关掉 features ⟹ 服务列表页不要了（它的 core 块没了），导航里也没有它', () => {
  const plan = R.sitePagesFor('hair salon', { services: SVC, disabledBlocks: ['features'] });
  assert.ok(!plan.pages.some((p) => p.slug === 'services'));
  assert.ok(!plan.nav.includes('services'));
  assert.ok(plan.pages.some((p) => p.slug === 'services/alpha'), '服务页本身还在（它的 core 是 content）');
});
check('关掉 contact ⟹ contact 页不要了，按钮指首页（不留死链）', () => {
  const plan = R.sitePagesFor('hair salon', { services: SVC, disabledBlocks: ['contact'] });
  assert.ok(!plan.pages.some((p) => p.slug === 'contact'));
  assert.strictEqual(plan.ctaPage, 'home');
});

check('导航 == 普通页里除了按钮那一页（sync-config 每次构建按这条规则重排顶部导航，写别的会被覆盖）—— 16 组 + 默认、关不关块都成立', () => {
  const words = [...SECTORS.map((s) => WORD_OF[s.key]), 'pet grooming'];
  for (const w of words) {
    for (const off of [[], ['faq'], ['features'], ['contact'], ['content']]) {
      const plan = R.sitePagesFor(w, { services: SVC, disabledBlocks: off });
      const regular = plan.pages.filter((p) => p.slug !== 'home' && !p.serviceDetailPage && p.slug !== plan.ctaPage).map((p) => p.slug);
      assert.deepStrictEqual(plan.nav, regular, `${w} 关 ${off.join(',') || '（无）'}`);
    }
  }
});

// ── #1627 服务页有一张主图，其余页的页头没有 ─────────────────────────────────────────────────────────
// 旋钮值按 manifest 现算（header-knobs §presetKnobs），不手抄预设名：判据是「这个预设把 image 旋钮开在哪」。
check('#1627 服务页的 page-header 预设 image ≠ none；services / about / faq / contact 的页头 image 仍是 none（16 组 + 默认）', () => {
  const { presetsOf, presetKnobs } = require('./header-knobs');
  const imageOf = (preset) => {
    const k = presetKnobs(presetsOf(MANIFESTS.get('page-header')), preset);
    assert.ok(k, `page-header 没有叫 "${preset}" 的预设`);
    return k.image;
  };
  const rows = [...SECTORS.map((s) => [s.key, WORD_OF[s.key]]), ['default', 'zzz-unknown-trade']];
  const bad = [];
  for (const [label, w] of rows) {
    const plan = R.sitePagesFor(w, { services: SVC });
    const head = (p) => p.blocks.find((x) => x.type === 'page-header');
    const cells = [];
    for (const p of plan.pages) {
      const h = head(p);
      if (!h) continue;
      const img = imageOf(h.preset);
      cells.push(`${p.slug}=${h.preset}/${img}`);
      if (p.serviceDetailPage ? img === 'none' : img !== 'none') bad.push(`${label} ${p.slug}: ${h.preset} image=${img}`);
    }
    console.log(`     ${label.padEnd(18)} ${cells.join(' · ')}`);
  }
  assert.deepStrictEqual(bad, []);
});

// ── 块序 / 预设的两个小函数 ──────────────────────────────────────────────────────────────────────────
check('blockOrderProblems：对得上回 []，少一块 / 换了顺序 / 多一块各报一条', () => {
  const blocks = [{ type: 'page-header' }, { type: 'faq' }, { type: 'cta' }];
  const S = (...t) => t.map((type) => ({ type, data: {} }));
  assert.deepStrictEqual(R.blockOrderProblems(S('page-header', 'faq', 'cta'), blocks), []);
  assert.strictEqual(R.blockOrderProblems(S('page-header', 'cta'), blocks).length, 1);
  assert.strictEqual(R.blockOrderProblems(S('page-header', 'cta', 'faq'), blocks).length, 1);
  assert.strictEqual(R.blockOrderProblems(S('page-header', 'faq', 'cta', 'cta'), blocks).length, 1);
  assert.strictEqual(R.blockOrderProblems(null, blocks).length, 1);
});
check('applyPresets：把预设的旋钮写进 options（覆盖 AI 写的同名旋钮，别的键留着），旋钮值逐个等于 manifest 那个预设', () => {
  const ms = new Map([...MANIFESTS].map(([k, v]) => [k, v]));
  const sections = [{ type: 'features', data: { options: { itemsColumns: '4', notAKnob: 'x' } } }, { type: 'cta', data: {} }];
  const n = R.applyPresets(sections, [{ type: 'features', preset: 'Cards' }, { type: 'cta', preset: 'Boxed' }], ms);
  assert.strictEqual(n, 2);
  const want = (type, name) => MANIFESTS.get(type).presets.find((p) => p.name === name).knobs;
  assert.deepStrictEqual(sections[0].data.options, { ...want('features', 'Cards'), notAKnob: 'x' });
  assert.deepStrictEqual(sections[1].data.options, want('cta', 'Boxed'));
  // 块序对不上的那一块不动
  const odd = [{ type: 'faq', data: { options: { a: 1 } } }];
  assert.strictEqual(R.applyPresets(odd, [{ type: 'cta', preset: 'Boxed' }], ms), 0);
  assert.deepStrictEqual(odd[0].data.options, { a: 1 });
});

console.log(`\n══ 汇总: 通过 ${pass} · 失败 ${fail} ══`);
process.exit(fail ? 1 : 0);
