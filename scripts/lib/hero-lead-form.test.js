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

// ── ⑥ 每个上门行业词的候选池里都要有一套带表单的主题（#1114 AC4）─────────────────────────────────
//
// 🔴 这一格治的是「整组永远碰不上」。Chris 2026-08-19 拍的是**不保证**（「有需要就有，碰上就有，
// 不是一定要有的」），加一条「但没有一组可以是永远碰不上」。所以判据**不是命中率**，是一个集合：
// 每个 `isOnSiteIndustry()` 为真的行业词，它的候选池里至少有一套 `themeSupportsHeroForm()` 为真。
// 命中率会随池子重生成漂（今天 10%-33%），集合不会 —— 承 `CLAUDE.md`「AC 不许拿命中数当判据」。
//
// 🔴 为什么这件事会重演、所以必须留成一格测试（票正文 AC4）：0% 那 28 个词不是哪张表写漏了，是两个
// 小机制干涉出来的 —— 池子按 16 组 × 5 套排，而带表单的 hero 外观每 7 个位子才出现一次（8 档里 1 档），
// **7 与 5 错开 ⟹ 必然有整组被跳过**。池子只要重生成一次，被跳过的就换成另外几组。
console.log('\n── ⑥ 每个上门行业词的候选池里都有带表单的主题（#1114）');
{
  const { candidateThemesForIndustry, NEUTRAL_TOPUP } = themesMod;
  const formsIn = (p) => p.filter((id) => themeSupportsHeroForm(poolThemes[id]));

  // 🔴 先问兜底源本身 —— 缺了它，下面那条会红在「28 个词」上，而真因是「兜底源里没有带表单的那一套」。
  //    两个读数分开报，红的那一行才说得出真因（同族纪律：仪器坏了 ≠ 被测的东西坏了）。
  const topupWithForm = NEUTRAL_TOPUP.filter((id) => poolThemes[id] && themeSupportsHeroForm(poolThemes[id]));
  if (topupWithForm.length) {
    ok(`兜底源 NEUTRAL_TOPUP 里有 ${topupWithForm.length} 套带表单的：${topupWithForm.join(', ')}`);
  } else {
    bad(`🔴 兜底源 NEUTRAL_TOPUP（${NEUTRAL_TOPUP.join(', ')}）里一套带表单的都没有 —— `
      + '`candidateThemesForIndustry` 那道 #1114 兜底因此哑掉，下面那条会红在词上而真因在这里');
  }

  const missing = onWords.filter((w) => !formsIn(candidateThemesForIndustry(w) || []).length);
  if (!missing.length) {
    // 报的是「哪几套」，不是一个百分比 —— AC1 要的就是这份名单。
    const hit = new Map();
    for (const w of onWords) for (const id of formsIn(candidateThemesForIndustry(w))) hit.set(id, (hit.get(id) || 0) + 1);
    const shown = [...hit].sort((a, b) => b[1] - a[1]).map(([id, n]) => `${id}×${n}`).join(' · ');
    ok(`${onWords.length} 个上门行业词逐个：候选池里都有带表单的主题（谁被命中：${shown}）`);
  } else {
    bad(`🔴 ${missing.length} 个上门行业词的候选池里一套带表单的都没有 ⟹ 这些生意的站**按构造**`
      + `拿不到第一屏那个表单，跟运气无关：${missing.join(' ')}`);
  }

  // 🔴 「不保证」那一半也要守住，否则上面那条绿可以用「见谁都给」换来 —— 而 Chris 拍的正是不保证。
  //    判据写成「既不是 0 也不是全部」，不写具体数字（同上：数字会漂）。
  const probe = 'landscaping';
  const p = candidateThemesForIndustry(probe);
  const f = formsIn(p).length;
  if (f > 0 && f < p.length) {
    ok(`「不保证」也成立：${probe} 的池子 ${p.length} 套里带表单的 ${f} 套 ⟹ 命中率既不是 0% 也不是 100%`);
  } else {
    bad(`${probe} 的池子 ${p.length} 套里带表单的 ${f} 套 —— ${f === 0 ? '一档机会都没有' : '变成了「每站必有」，那不是 Chris 拍的那一条'}`);
  }

  // 🔴 反向对照：非上门行业**不该**因为这道兜底被改动。它不是保险 —— 那些站的表单一个都不会多
  //    （表单要「上门行业 且 主题带表单」两个条件），多出来的只有被改掉的主题轮换。
  //    判据：把兜底那一套加进去之后，非上门词的池子里【不该】出现它，除非它本来就在。
  const topup = topupWithForm[0];
  const leaked = topup ? offWords.filter((w) => {
    const pool = candidateThemesForIndustry(w) || [];
    if (!pool.includes(topup)) return false;
    // 本来就声明了这个行业、或者被 MIN_ROTATION_POOL 那道旧兜底带进来的，都不算泄漏
    const declared = poolThemes[topup].industries.some((kw) => String(w).toLowerCase().includes(kw));
    return !declared && pool.length > themesMod.MIN_ROTATION_POOL;
  }) : [];
  if (!topup) {
    bad('反向对照立不起来：兜底源里没有带表单的那一套（上面已经报过）');
  } else if (!leaked.length) {
    ok(`反向对照：${offWords.length} 个非上门词里，没有一个是因为这道兜底才多出 ${topup} 的`);
  } else {
    bad(`🔴 ${leaked.length} 个非上门词的池子里多出了 ${topup}，而它们拿不到表单 ⟹ 纯副作用：`
      + leaked.slice(0, 8).join(' '));
  }
}

console.log(`\n══ ${pass} 过 · ${fail} 失败 ══`);
process.exit(fail ? 1 : 0);
