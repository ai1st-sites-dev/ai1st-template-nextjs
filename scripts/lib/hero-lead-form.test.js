#!/usr/bin/env node
/**
 * hero-lead-form.test.js — 「首屏给不给表单」那三道判断的承重性质（#1097）。
 *
 * 跑法:  node scripts/lib/hero-lead-form.test.js   （或 `npm run test:scripts`，它按文件名发现）
 * 退出码: 0 全过 · 1 有失败 · 2 跑不起来（**不许当成通过**）
 *
 * ══ 为什么这几条要有一个自动的调用方 ═════════════════════════════════════════════════════════════
 * 这几条的失败方向全部是**静默**的 —— 站照样建得出来，只是建错了：
 *   · 分类器退回裸 `includes`  → 退休理财的站首屏冒出一个「留下您的电话」，212 个词里只有一个会翻车
 *   · 兜底那一支被去掉          → 表单渲染在没给它写过造型的主题上
 *   · 不给表单那条路被碰到      → 全站产物字节变了，而没有任何断言在看它
 * 没有一条会让构建变红，也没有一条肉眼看得出来。
 */

'use strict';

const path = require('path');

const DIR = __dirname;
const NEXT = path.resolve(DIR, '..', '..');

let pass = 0; let fail = 0;
const ok = (m) => { pass += 1; console.log(`  ✅ ${m}`); };
const bad = (m) => { fail += 1; console.log(`  ❌ ${m}`); };
const die = (m) => { console.error(`🔴 跑不起来: ${m}`); process.exit(2); };

let sectors; let heroForm; let themesMod;
try {
  sectors = require(path.join(NEXT, 'scripts', 'theme-pipeline', 'industry-sectors.js'));
  heroForm = require(path.join(DIR, 'hero-lead-form.js'));
  themesMod = require(path.join(NEXT, 'scripts', 'themes.js'));
} catch (e) {
  die(`require 失败: ${e.message}`);
}

const { SECTORS, isOnSiteIndustry } = sectors;
const { applyHeroLeadForm, themeSupportsHeroForm, HERO_FORM_LAYOUT } = heroForm;
const { poolThemes } = themesMod;

const onWords = SECTORS.filter((s) => s.onSite).flatMap((s) => s.words);
const offWords = SECTORS.filter((s) => !s.onSite).flatMap((s) => s.words);
if (!onWords.length || !offWords.length) die('两个桶里有一个是空的 —— 没东西可查，这不是通过');

// ── ① 分类函数两向零例外（AC1）──────────────────────────────────────────────────────────────────
// 判据是**两张例外清单都为空**，不是命中计数：数对了不等于判对了（一个该给的没给 + 一个不该给的
// 给了，计数一模一样）。
console.log('\n── ① 分类函数：212 个词两向，例外清单都要空');
{
  const missedOn = onWords.filter((w) => !isOnSiteIndustry(w));
  const wrongOff = offWords.filter((w) => isOnSiteIndustry(w));
  if (!missedOn.length && !wrongOff.length) {
    ok(`上门 ${onWords.length} 词全判「给」· 其余 ${offWords.length} 词全判「不给」（两向例外 [] / []）`);
  } else {
    bad(`上门桶判错 ${missedOn.length} 个 ${JSON.stringify(missedOn)}`
      + ` · 不给桶判错 ${wrongOff.length} 个 ${JSON.stringify(wrongOff)}`);
  }

  // 🔴 尺子校准。上面那两个 `[]` 跟「夹具根本抓不住错的实现」长得一模一样，所以这里拿**错的那个
  //    实现**（裸 `includes`，本票之前 `themes.js` 那条路上的写法）跑同一份夹具：它必须在不给桶上
  //    露出恰好一个 `retirement`。露不出来 = 这份夹具没有区分力，上面的绿是空过。
  const naive = (ind) => {
    const lower = String(ind || '').toLowerCase();
    return onWords.some((w) => lower.includes(w));
  };
  const naiveWrong = offWords.filter(naive);
  if (naiveWrong.length === 1 && naiveWrong[0] === 'retirement') {
    ok(`校准：同一份夹具喂给裸 includes，不给桶露出 ${JSON.stringify(naiveWrong)}（它含着上门桶的 "tire"）`);
  } else {
    bad(`校准失败：裸 includes 在不给桶上应该恰好露出 ["retirement"]，实际 ${JSON.stringify(naiveWrong)}`
      + ' —— 词表变了的话这条要重新量，别直接改期望值');
  }
}

// ── ② 真实行业串，含那颗磁铁（AC2）──────────────────────────────────────────────────────────────
// 只跑单词会漏掉真实输入的样子：真实 payload 里的 `industry` 是一句话，不是词表里那一个词。
console.log('\n── ② 五条真实行业串');
{
  const cases = [
    ['retirement planning', false],
    ['plumbing services', true],
    ['tire shop', true],
    ['cozy restaurant', false],
    ['pet grooming', false],
  ];
  for (const [input, want] of cases) {
    const got = isOnSiteIndustry(input);
    const say = (v) => (v ? '给' : '不给');
    if (got === want) ok(`${JSON.stringify(input)} → ${say(got)}`);
    else bad(`${JSON.stringify(input)} → ${say(got)}，应该是 ${say(want)}`);
  }
}

// ── ③ 兜底：主题没声明造型就不给（AC5 的单元那一半）──────────────────────────────────────────────
// 🔴 用**注册表里真的主题**，不用手搓对象：手搓的 `{supports:{hero:[...]}}` 只能证明这个函数读得懂
//    自己造的形状，证明不了它读得懂池子里那 80 套的形状。
console.log('\n── ③ 兜底：theme.supports.hero 含不含 with-form');
{
  const ids = Object.keys(poolThemes);
  const declaring = ids.filter((id) => (poolThemes[id].supports.hero || []).includes(HERO_FORM_LAYOUT));
  const notDeclaring = ids.filter((id) => !(poolThemes[id].supports.hero || []).includes(HERO_FORM_LAYOUT));
  if (!declaring.length || !notDeclaring.length) {
    bad(`池子里两边有一边是空的（声明 ${declaring.length} 套 / 没声明 ${notDeclaring.length} 套）`
      + ' —— 这一格失去区分力，不是通过');
  } else {
    const yesWrong = declaring.filter((id) => !themeSupportsHeroForm(poolThemes[id]));
    const noWrong = notDeclaring.filter((id) => themeSupportsHeroForm(poolThemes[id]));
    if (!yesWrong.length && !noWrong.length) {
      ok(`声明的 ${declaring.length} 套全判 true（${declaring.slice(0, 3).join(' · ')} …）`
        + ` · 其余 ${notDeclaring.length} 套全判 false，两向例外 [] / []`);
    } else {
      bad(`声明却判 false: ${JSON.stringify(yesWrong)} · 没声明却判 true: ${JSON.stringify(noWrong)}`);
    }
  }
  const junk = [undefined, null, {}, { supports: {} }, { supports: { hero: 'with-form' } }, { supports: { hero: [] } }];
  const junkWrong = junk.filter((t) => themeSupportsHeroForm(t));
  if (!junkWrong.length) ok(`读不到 supports.hero 的六种形状全判 false（fail-safe 方向是不给）`);
  else bad(`读不到 supports.hero 却判 true: ${JSON.stringify(junkWrong)}`);
}

// ── ④ 逻辑层两向：不给表单的站逐字不变（AC6a）───────────────────────────────────────────────────
console.log('\n── ④ 夹具走一遍这段逻辑：restaurant 逐字不变 · plumbing 只多一个键');

/** 递归比两份 JSON，返回 `path: 左 → 右` 的清单。用来把差异**逐条打出来**，不是打条数。 */
function diffJson(a, b, prefix = '') {
  const out = [];
  const ka = a && typeof a === 'object' ? Object.keys(a) : [];
  const kb = b && typeof b === 'object' ? Object.keys(b) : [];
  if (!ka.length && !kb.length) {
    if (JSON.stringify(a) !== JSON.stringify(b)) out.push(`${prefix}: ${JSON.stringify(a)} → ${JSON.stringify(b)}`);
    return out;
  }
  for (const k of [...new Set([...ka, ...kb])]) {
    const p = prefix ? `${prefix}.${k}` : k;
    const va = a ? a[k] : undefined; const vb = b ? b[k] : undefined;
    if (va === undefined && vb !== undefined) { out.push(`${p}: (缺) → ${JSON.stringify(vb)}`); continue; }
    if (va !== undefined && vb === undefined) { out.push(`${p}: ${JSON.stringify(va)} → (缺)`); continue; }
    if (va && vb && typeof va === 'object' && typeof vb === 'object') { out.push(...diffJson(va, vb, p)); continue; }
    if (JSON.stringify(va) !== JSON.stringify(vb)) out.push(`${p}: ${JSON.stringify(va)} → ${JSON.stringify(vb)}`);
  }
  return out;
}

/** 一份最小的建站产物形状：首页带 hero，另有一页不带。跟 `content` 在 `:1127` 那一刻同形（`sections`）。 */
function fixture() {
  return {
    pages: [
      {
        slug: 'home',
        title: 'Home',
        sections: [
          { type: 'hero', data: { headline: 'H', subheadline: 'S', variant: 'left' } },
          { type: 'features-grid', data: { items: [] } },
        ],
      },
      { slug: 'about', title: 'About', sections: [{ type: 'page-header', data: {} }] },
    ],
  };
}

// 承重的那套主题：注册表里真的、真声明了 with-form 的那一套（今天 10 套里的第一套）。
const formThemeId = Object.keys(poolThemes)
  .find((id) => (poolThemes[id].supports.hero || []).includes(HERO_FORM_LAYOUT));
if (!formThemeId) die(`池子里没有任何主题声明 supports.hero 含 "${HERO_FORM_LAYOUT}" —— 这一格没有对象可验`);
const formTheme = poolThemes[formThemeId];

{
  const before = fixture();
  const after = fixture();
  const r = applyHeroLeadForm({ content: after, industry: 'cozy restaurant', theme: formTheme });
  const d = diffJson(before, after);
  if (!r.applied && JSON.stringify(before) === JSON.stringify(after)) {
    ok(`restaurant（主题声明了 with-form，被行业那一道拦下）：JSON.stringify 逐字相同 · reason=${r.reason}`);
  } else {
    bad(`restaurant 夹具被改动了 —— applied=${r.applied}，差异:\n     ${d.join('\n     ') || '(无，但 applied 是 true)'}`);
  }
}
{
  const before = fixture();
  const after = fixture();
  const r = applyHeroLeadForm({ content: after, industry: 'plumbing', theme: formTheme });
  const d = diffJson(before, after);
  const want = `pages.0.sections.0.block_layout: (缺) → "${HERO_FORM_LAYOUT}"`;
  if (r.applied && d.length === 1 && d[0] === want) {
    ok(`plumbing：差异只有 —— ${d[0]}`);
  } else {
    bad(`plumbing 的差异不是「只多一个键」：applied=${r.applied}\n     ${d.join('\n     ') || '(无差异)'}`);
  }
}

// ── ⑤ 三种「行业算上门但落不了地」的形状，一律不写、也不许抛（AC5 同族）─────────────────────────
console.log('\n── ⑤ 落不了地的三种形状');
{
  const noFormTheme = poolThemes[Object.keys(poolThemes)
    .find((id) => !(poolThemes[id].supports.hero || []).includes(HERO_FORM_LAYOUT))];
  const cases = [
    ['主题没声明 with-form', () => fixture(), noFormTheme],
    ['没有 slug==="home" 的页面', () => ({ pages: [{ slug: 'about', sections: [{ type: 'hero', data: {} }] }] }), formTheme],
    ['首页里没有 hero 块', () => ({ pages: [{ slug: 'home', sections: [{ type: 'text-block', data: {} }] }] }), formTheme],
  ];
  for (const [name, mk, theme] of cases) {
    const before = mk(); const after = mk();
    let r;
    try {
      r = applyHeroLeadForm({ content: after, industry: 'plumbing', theme });
    } catch (e) {
      bad(`${name}：抛了 —— ${e.message}`);
      continue;
    }
    const d = diffJson(before, after);
    if (!r.applied && !d.length) ok(`${name}：没写、没改动 · reason=${r.reason}`);
    else bad(`${name}：applied=${r.applied}，差异 ${JSON.stringify(d)}`);
  }
}

console.log(`\n══ ${pass} 过 · ${fail} 失败 ══`);
process.exit(fail ? 1 : 0);
