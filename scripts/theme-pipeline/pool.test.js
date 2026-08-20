#!/usr/bin/env node
/**
 * pool.test.js — 主题池的六条承重性质（#1016）。
 *
 * 跑法:  node scripts/theme-pipeline/pool.test.js
 * 退出码: 0 全过 · 1 有失败 · 2 跑不起来（**不许当成通过**）
 *
 * ══ 为什么这几条要有一个自动的调用方 ═════════════════════════════════════════════════════════════
 * #1016 的验收标准里有四条是**关于这一池数据的**（行业覆盖度、旧池退役、layout→supports、词表不缩）。
 * 交付那天跑一遍是容易的，难的是**下一次有人动这池数据时它们还成立** —— 而这四条的失败方向全部是
 * 静默的：
 *   · 少几个行业词      → 覆盖度那张表照样全绿（它统计的是池子自己有的词，缩词表反而让分布更好看）
 *   · 退役的 id 漏在池里 → 新站抽到一套本该退役的皮，没有任何东西会说话
 *   · supports 没翻     → `layoutFor()` 返回 {}，这套主题静默地对每个块都没有意见
 *   · 每套多塞十几个词  → 覆盖度当场变绿，产品面零变化
 * 所以它们落在这里：`npm run test:scripts` 会发现它（按文件名，不是清单），CI 的 template-scripts
 * 那个 job 每次动 templates/nextjs 都跑。同 #1034 r2 给 homepage-recipe.test.js 接调用方那次。
 */

'use strict';

const fs = require('fs');
const path = require('path');

const DIR = __dirname;
const NEXT = path.resolve(DIR, '..', '..');

let pass = 0; let fail = 0;
const ok = (m) => { pass += 1; console.log(`  ✅ ${m}`); };
const bad = (m) => { fail += 1; console.log(`  ❌ ${m}`); };
const die = (m) => { console.error(`🔴 跑不起来: ${m}`); process.exit(2); };

let themesMod; let surveyCoverage; let verifyPool; let sectors;
try {
  themesMod = require(path.join(NEXT, 'scripts', 'themes.js'));
  ({ surveyCoverage } = require(path.join(DIR, 'coverage.js')));
  ({ verifyPool } = require(path.join(DIR, 'promote.js')));
  sectors = require(path.join(DIR, 'industry-sectors.js'));
} catch (e) {
  die(`require 失败: ${e.message}`);
}

const { poolThemes, retiredThemes, themes } = themesMod;
const { industryTokens, hasPhrase } = sectors;   // #1115 —— 判据只有一份，见 industry-sectors.js
const poolIds = Object.keys(poolThemes);
const retiredIds = Object.keys(retiredThemes);

if (!poolIds.length || !retiredIds.length) die('池子或退役表是空的 —— 没东西可查，这不是通过');

// ── ① 行业覆盖度（AC2）──────────────────────────────────────────────────────────────────────────
// 判据与 `coverage.js --max-thin-pools 0 --max-thin-hits 0` 逐字同源：调的就是它那个函数。
console.log('\n── ① 行业覆盖度：每个行业词至少 4 套真命中');
{
  const s = surveyCoverage();
  const line = `${s.themeCount} 套 · ${s.keywordCount} 个词 · 候选池 ${JSON.stringify(s.poolDistribution)}`
    + ` · 真命中 ${JSON.stringify(s.hitDistribution)}`;
  if (s.thinPools === 0 && s.thinHits === 0) ok(`${line}（薄格子 0 个）`);
  else bad(`${line} —— 候选池 == ${s.minRotationPool} 的 ${s.thinPools} 个 · 真命中 == 1 的 ${s.thinHits} 个`);
}

// ── ② 词表不许缩（AC2 的另一半）─────────────────────────────────────────────────────────────────
// 🔴 覆盖度那张表**看不见**这件事：关键词全集是从池子自己的 `industries` 并起来的，删掉一个词，
//    那个词就从分母里消失，分布只会更好看。而线上的后果是「今天匹配得上的生意明天落进兜底」。
console.log('\n── ② 词表是退役那 30 套的超集，一个词都没少');
{
  const oldWords = [...new Set(retiredIds.flatMap((id) => retiredThemes[id].industries || []))];
  const newWords = new Set(poolIds.flatMap((id) => poolThemes[id].industries || []));
  const missing = oldWords.filter((w) => !newWords.has(w));
  if (!missing.length) ok(`旧词 ${oldWords.length} 个，新池全都有（新池 ${newWords.size} 个）`);
  else bad(`新池少了 ${missing.length} 个旧行业词：${missing.slice(0, 12).join(' · ')}${missing.length > 12 ? ' …' : ''}`);
}

// ── ③ 覆盖度不许靠「每套多塞几个词」凑（AC2 写死的两个分布）────────────────────────────────────
console.log('\n── ③ 每套声明的行业数 / 每套的真命中对数，都不比退役那 30 套宽');
{
  const stat = (arr) => {
    const s = [...arr].sort((a, b) => a - b);
    return {
      min: s[0], max: s[s.length - 1], med: s[Math.floor(s.length / 2)],
      avg: s.reduce((a, b) => a + b, 0) / s.length,
    };
  };
  const declOld = stat(retiredIds.map((id) => (retiredThemes[id].industries || []).length));
  const declNew = stat(poolIds.map((id) => (poolThemes[id].industries || []).length));
  // 真命中对数 = 这套主题能命中几个行业词。
  // 🔴 #1115 —— 判据换成生产那一份（`hasPhrase`，词边界），不再是裸 `includes`。这一格守的是
  //    「别靠每套多塞几个短词把覆盖度撑出来」，而**撑得出来靠的就是生产那条匹配** ⟹ 拿一条生产
  //    已经不用的口径来守它，守的是一个不存在的通道。两种口径我都量过，这一格都绿
  //    （裸: 旧池平均 14.73 / 新池 13.13；词边界: 旧池 13.30 / 新池 12.44），所以换过来是安全的。
  const hitsOf = (pool, ids, vocab) => ids.map((id) => vocab
    .filter((w) => (pool[id].industries || []).some((kw) => hasPhrase(industryTokens(w), kw))).length);
  const oldVocab = [...new Set(retiredIds.flatMap((id) => retiredThemes[id].industries || []))];
  const newVocab = [...new Set(poolIds.flatMap((id) => poolThemes[id].industries || []))];
  const hitOld = stat(hitsOf(retiredThemes, retiredIds, oldVocab));
  const hitNew = stat(hitsOf(poolThemes, poolIds, newVocab));
  const fmt = (s) => `min ${s.min} / 中位 ${s.med} / max ${s.max} / 平均 ${s.avg.toFixed(2)}`;
  if (declNew.avg <= declOld.avg && declNew.max <= declOld.max) {
    ok(`声明数 新池 ${fmt(declNew)} ≤ 旧池 ${fmt(declOld)}`);
  } else {
    bad(`声明数 新池 ${fmt(declNew)} 比旧池 ${fmt(declOld)} 宽 —— 缺口要靠套数补，不是靠每套多声明`);
  }
  if (hitNew.avg <= hitOld.avg) ok(`真命中对数 新池 ${fmt(hitNew)} ≤ 旧池 ${fmt(hitOld)}`);
  else bad(`真命中对数 新池 ${fmt(hitNew)} 比旧池 ${fmt(hitOld)} 宽（声明词越短越通用，这个数越容易被撑大）`);
}

// ── ④ 旧 30 套退役（AC4）────────────────────────────────────────────────────────────────────────
console.log('\n── ④ 退役的 30 套：新建网站一套都抽不到，而定义一个字都没删');
{
  const vocab = [...new Set(poolIds.flatMap((id) => poolThemes[id].industries || [])
    .concat(retiredIds.flatMap((id) => retiredThemes[id].industries || [])))];
  // 探的是**两边词表的并集**：只探新池自己的词，就问不到「旧池的某个词今天会兜出什么」。
  const leaked = new Set();
  for (const w of vocab.concat(['', 'quantum widgets', '汽车维修'])) {
    for (const id of themesMod.candidateThemesForIndustry(w)) if (retiredThemes[id]) leaked.add(id);
  }
  if (!leaked.size) ok(`${vocab.length} 个行业词逐个跑 candidateThemesForIndustry()，退役 id 出现 0 次`);
  else bad(`退役的 id 仍然会被新站抽到：${[...leaked].join(' · ')}`);

  if (retiredIds.length === 30) ok('退役表仍是 30 套（文件在 scripts/themes-retired.js，没删）');
  else bad(`退役表现在是 ${retiredIds.length} 套，不是 30 —— 有人删了已经上线的站在穿的皮`);

  const notLookupable = retiredIds.filter((id) => !themes[id]);
  if (!notLookupable.length) ok('30 套仍然按 id 查得到（sync-config 的 applied 分支要用）');
  else bad(`这几套按 id 查不到了，穿着它们的站会建不出来：${notLookupable.join(' · ')}`);

  const topupOutside = themesMod.NEUTRAL_TOPUP
    ? themesMod.NEUTRAL_TOPUP.filter((id) => !poolThemes[id]) : ['(没导出 NEUTRAL_TOPUP)'];
  if (!topupOutside.length) ok('NEUTRAL_TOPUP 四套都在新池里');
  else bad(`NEUTRAL_TOPUP 指向池外的 id：${topupOutside.join(' · ')}`);
}

// ── ⑤ layout → supports（AC6）───────────────────────────────────────────────────────────────────
console.log('\n── ⑤ 池里每一套都有 supports、没有一套还留着 layout');
{
  const problems = verifyPool(poolThemes);
  if (!problems.length) ok(`${poolIds.length} 套逐套查过`);
  else { bad(`${problems.length} 处不达标：`); for (const p of problems.slice(0, 6)) console.log(`     ${p}`); }

  // 反向对照：故意留一套没翻，这把尺必须点名它。没有这一格，上面那个 ✅ 分不出
  // 「全都翻好了」和「这个检查什么都没看」。
  const [firstId] = poolIds;
  const rigged = { ...poolThemes, [firstId]: { ...poolThemes[firstId], layout: { hero: 'text-only' } } };
  const caught = verifyPool(rigged).filter((p) => p.startsWith(`${firstId}:`));
  if (caught.length) ok(`反向对照：给 ${firstId} 留一个 layout 键，它当场被点名`);
  else bad('反向对照失败：留着 layout 的那一套没被点名 —— 这把尺量不出东西');

  const noSupports = { ...poolThemes, [firstId]: { ...poolThemes[firstId], supports: {} } };
  if (verifyPool(noSupports).some((p) => p.startsWith(`${firstId}:`))) {
    ok(`反向对照：把 ${firstId} 的 supports 清空，它当场被点名`);
  } else {
    bad('反向对照失败：supports 为空的那一套没被点名');
  }

  // `layoutFor()` 是 #1010 那条「行为不变」保证的消费方 —— 池里每一套都要取得到值。
  const noLayout = poolIds.filter((id) => !Object.keys(themesMod.layoutFor(id)).length);
  if (!noLayout.length) ok('layoutFor() 对池里每一套都取得到值');
  else bad(`layoutFor() 对这几套返回 {}：${noLayout.slice(0, 6).join(' · ')}`);
}

// ── ⑥ 每一套的表都在磁盘上 ─────────────────────────────────────────────────────────────────────
// 阶段 2 之后一套主题的样子主要在它自己那份表里；`sheet` 指着一个不存在的文件时，
// `sync-config.js` 的 readThemeSheet 会 `process.exit(1)` —— 站建不出来，而这里问一次只要几毫秒。
console.log('\n── ⑥ 每套的表 public/themes/<sheet>.css 都在');
{
  const missing = poolIds.filter((id) => {
    const sheet = poolThemes[id].sheet;
    return !sheet || !fs.existsSync(path.join(NEXT, 'public', 'themes', `${sheet}.css`));
  });
  if (!missing.length) ok(`${poolIds.length} 份表都在`);
  else bad(`${missing.length} 套的表不在磁盘上：${missing.slice(0, 6).join(' · ')}`);
}

// ── ⑦ 行业组表自己的两条机械性质 ───────────────────────────────────────────────────────────────
console.log('\n── ⑦ 行业组表：不重不漏，位子数 == 池子大小');
{
  const words = sectors.SECTORS.flatMap((s) => s.words);
  const dupes = [...new Set(words.filter((w, i) => words.indexOf(w) !== i))];
  if (!dupes.length) ok(`${sectors.SECTORS.length} 组 · ${words.length} 个词，无重复`);
  else bad(`行业组之间有重复的词：${dupes.join(' · ')}`);

  const slots = sectors.poolSlots();
  if (slots.length === poolIds.length) ok(`位子 ${slots.length} 个 == 池子 ${poolIds.length} 套`);
  else bad(`位子 ${slots.length} 个，池子 ${poolIds.length} 套 —— 对不上就有主题拿不到行业词`);
}

// ── ⑧ 透明浮层只给深底首屏（#1016 r5）────────────────────────────────────────────────────────────
//
// 浮层配一层压在页面最上面 160px 的黑色渐变（`src/components/Header.tsx`），浓度是按「首屏是纯白」
// 定的，因为浮层的字是白的。同一层遮罩压在「浅底 + 深字」的 hero 上，把标题最上面那一截压到
// rgb(110) 左右：真机量到 azure-50 `.hero__title` 3.89:1、crimson-30 3.81:1，而 CI 那道运行时检查
// 就是为这种事红的。规则和为什么换字色治不了，写在 `region-layout.js` 那个函数上面。
//
// 🔴 这一格有两半，缺哪半都不行：
//   · 后一半问「今天这池数据成立吗」——它是会被下一次改动破坏的那个性质；
//   · 前一半问「那个遮罩还是我以为的那个吗」——判据里的 55% 在两处出现（组件里的 class 串 +
//     region-layout.js 的常量），而两处必然分叉。分叉的方向是**静默变绿**：有人把遮罩调浓，
//     生成器仍按 55% 挑，池子照样"全过"，而真机上标题已经读不出来了。所以这里读组件的原文。
console.log('\n── ⑧ 透明浮层只给深底首屏；判据里那个遮罩浓度跟组件里的一致');
{
  const region = require(path.join(NEXT, 'scripts', 'region-layout.js'));
  const headerTsx = path.join(NEXT, 'src', 'components', 'Header.tsx');
  let src = '';
  try { src = fs.readFileSync(headerTsx, 'utf-8'); } catch { /* 下面按读不到处理 */ }
  const scrim = /from-black\/(\d+)\s+via-black\/(\d+)\s+to-transparent/.exec(src);
  if (!src) {
    bad(`读不到 src/components/Header.tsx —— 遮罩浓度那半没法核，这不是通过`);
  } else if (!scrim) {
    bad('Header.tsx 里找不到 `from-black/NN via-black/NN to-transparent` 那条遮罩 —— '
      + '要么遮罩改写法了、要么没了，两种情况下 region-layout.js 那条规则都要重新量一次');
  } else {
    const mid = Number(scrim[2]) / 100;
    if (Math.abs(mid - region.HEADER_SCRIM_MID_ALPHA) < 1e-9) {
      ok(`Header.tsx 的遮罩是 from-black/${scrim[1]} via-black/${scrim[2]}，`
        + `跟 region-layout.js 的 HEADER_SCRIM_MID_ALPHA=${region.HEADER_SCRIM_MID_ALPHA} 一致`);
    } else {
      bad(`遮罩浓度对不上：Header.tsx 是 via-black/${scrim[2]}（${mid}），`
        + `region-layout.js 按 ${region.HEADER_SCRIM_MID_ALPHA} 挑顶栏 —— 挑的时候量的不是真遮罩`);
    }
  }

  const overlay = poolIds.filter((id) => ((poolThemes[id].supports || {}).header || [])[0] === 'transparent-overlay');
  const breaks = [];
  for (const id of overlay) {
    const sheetPath = path.join(NEXT, 'public', 'themes', `${poolThemes[id].sheet}.css`);
    let css = '';
    try { css = fs.readFileSync(sheetPath, 'utf-8'); } catch { /* 下面 verdict 会因为读不到而 ok=false */ }
    const verdict = region.heroTitleSurvivesHeaderScrim(css, poolThemes[id].colors);
    if (!verdict.ok) breaks.push(`${id}（${verdict.why}）`);
  }
  if (!overlay.length) {
    // 一套都没有不是通过：说明这一维的花样全没了，或者 supports.header 根本没写进去。
    bad('池里一套 transparent-overlay 都没有 —— 这一格就什么都没验，而顶栏那一维也没了花样');
  } else if (!breaks.length) {
    ok(`${overlay.length}/${poolIds.length} 套用透明浮层，每一套的 .hero__title 压在遮罩下都 ≥ `
      + `${region.HEADER_SCRIM_INK_FLOOR}:1`);
  } else {
    bad(`${breaks.length} 套的浮层配的是浅底首屏：${breaks.slice(0, 6).join(' · ')}`);
  }

  // 反向对照：拿一套**真的**浅底表喂给挑顶栏那个函数，它必须让开。不做这一格的话，
  // 上面那句"每一套都过"在函数恒返回 ok 时长得完全一样。
  const paleId = poolIds.find((id) => {
    const css = fs.readFileSync(path.join(NEXT, 'public', 'themes', `${poolThemes[id].sheet}.css`), 'utf-8');
    return !region.heroTitleSurvivesHeaderScrim(css, poolThemes[id].colors).ok;
  });
  if (!paleId) {
    bad('池里找不到一套浅底首屏的表 —— 反向对照没法做，那么上面那句"每一套都过"证明不了函数在判事');
  } else {
    const paleCss = fs.readFileSync(path.join(NEXT, 'public', 'themes', `${poolThemes[paleId].sheet}.css`), 'utf-8');
    // index 取 HEADER_VARIANTS 里浮层那一格，也就是"本来该轮到浮层"的那些位子。
    const overlayIndex = region.HEADER_VARIANTS.indexOf('transparent-overlay');
    const picked = region.headerVariantForPool(overlayIndex, paleCss, poolThemes[paleId].colors);
    if (picked.variant !== 'transparent-overlay' && picked.why) {
      ok(`反向对照：拿 ${paleId} 那份浅底表 + 本来轮到浮层的位子 ⟹ 让开成 ${picked.variant}（${picked.why}）`);
    } else {
      bad(`反向对照失败：${paleId} 是浅底首屏，却仍然拿到 ${picked.variant}`);
    }
  }
}

// ── ⑨ hero 的两条轴：池里存的是内容结构，画法只在表里（#1065）──────────────────────────────────
//
// 这一格问的是**池子这份数据**，跟 `sheet-recipes.test.js` ⑤ 那一格问生成器不是同一个对象：
// 生成器改对了而池子忘了重新生成，是这条流水线已经付过账的失败形态（`sheet-fresh.js` 的文件头）。
console.log('\n── ⑨ hero：supports 里只有内容结构，画法在表里');
{
  const heroManifest = JSON.parse(fs.readFileSync(path.join(NEXT, 'blocks', 'hero.json'), 'utf-8'));
  const allowed = heroManifest.block_layout;
  let recipes;
  try {
    recipes = require(path.join(DIR, 'sheet-recipes.js'));   // eslint-disable-line global-require
  } catch (e) {
    die(`sheet-recipes.js require 失败：${e.message}`);
  }
  const { heroLookFor, HERO_LOOKS, HERO_LOOK_NAMES } = recipes;

  // 判据写成函数：反向对照要拿一份动过手脚的池子再问一次同样的话。
  const heroValueProblems = (pool) => Object.entries(pool)
    .map(([id, t]) => {
      const forms = ((t || {}).supports || {}).hero;
      if (!Array.isArray(forms) || !forms.length) return `${id}: supports.hero 是空的`;
      const badOnes = forms.filter((f) => !allowed.includes(f));
      if (badOnes.length) {
        return `${id}: supports.hero 里有 blocks/hero.json 不认的值 ${JSON.stringify(badOnes)}`
          + `（认的是 ${allowed.join(' / ')}）`;
      }
      return null;
    })
    .filter(Boolean);

  const problems = heroValueProblems(poolThemes);
  const vocab = [...new Set(poolIds.flatMap((id) => poolThemes[id].supports.hero))].sort();
  if (problems.length) {
    bad(`${problems.length} 处不达标：${problems.slice(0, 4).join(' · ')}`);
  } else {
    ok(`${poolIds.length} 套的 supports.hero 只用了内容结构词：${vocab.join(' / ')}`);
  }

  // 🔴 反向对照 —— 把一套的 supports.hero 换成 #1065 之前那个外观词，这把尺必须当场点名。
  const rigged = {
    ...poolThemes,
    [poolIds[0]]: {
      ...poolThemes[poolIds[0]],
      supports: { ...poolThemes[poolIds[0]].supports, hero: ['with-media-left'] },
    },
  };
  const caught = heroValueProblems(rigged);
  if (caught.length === 1 && caught[0].includes('with-media-left')) {
    ok(`反向对照：把 ${poolIds[0]} 的 supports.hero 换回外观词 with-media-left，它当场被点名`);
  } else {
    bad(`反向对照对不上：点名了 ${caught.length} 条（应当只有 1 条）—— ${caught.join(' · ')}`);
  }

  // 每一套的表是 `sheetFor(i, seed)` 的产物，而 `(i, seed)` 就写在表自己横幅的候选号
  // `gen-<seed>-<i+1>` 里（`sheet-fresh.js` 靠的是同一条）。⟹ 池里每一套的画法是问得出来的，
  // 而「这套主题声明的内容结构」必须等于「它那份表实际画的那种画法的内容结构」。
  // 两者对不上 = 池子跟表分叉，正是 #1051 r1 那个「说的和画的不一致」换了个地方。
  const counts = new Map(HERO_LOOK_NAMES.map((n) => [n, []]));
  const mismatched = [];
  const unreadable = [];
  for (const id of poolIds) {
    const sheet = path.join(NEXT, 'public', 'themes', `${poolThemes[id].sheet || id}.css`);
    const m = /gen-\d+-(\d+)/.exec(fs.readFileSync(sheet, 'utf-8').slice(0, 400));
    if (!m) { unreadable.push(id); continue; }
    const look = heroLookFor(Number(m[1]) - 1);
    counts.get(look).push(id);
    if (poolThemes[id].supports.hero[0] !== HERO_LOOKS[look].content) {
      mismatched.push(`${id}: 表画的是 ${look}（${HERO_LOOKS[look].content}），池里写的是 ${poolThemes[id].supports.hero[0]}`);
    }
  }
  if (unreadable.length) bad(`${unreadable.length} 套的表读不出候选号（${unreadable.slice(0, 3).join(', ')}）—— 这一格什么都没验成`);
  else if (mismatched.length) bad(`${mismatched.length} 套的池子记录跟它自己那份表对不上：${mismatched.slice(0, 3).join(' · ')}`);
  else ok(`${poolIds.length} 套逐套：池里写的内容结构 == 它那份表实际画的那种画法的内容结构`);

  // AC-C 的下限：七种外观每种 ≥ 8 套，带表单那种单独数也要 ≥ 8。
  const thin = [...counts].filter(([, ids]) => ids.length < 8);
  const line = [...counts].map(([n, ids]) => `${n} ${ids.length}`).join(' · ');
  if (thin.length) bad(`有画法不到 8 套：${thin.map(([n, ids]) => `${n} ${ids.length}`).join(', ')}（全表：${line}）`);
  else ok(`每种画法都 ≥ 8 套：${line}`);
}

// ── ⑩ 挑主题按【词边界】匹配，不是子串（#1115，#1119 换了量的对象）───────────────────────────
//
// 要守的事实：`fitness` / `furniture` / `architect` 里都含着 `it`，而 `it` 是科技那四套主题声明的
// 关键词。裸 `includes` 会把健身房 / 家具店 / 建筑事务所拉进**科技主题**的候选池，而抽到哪一套
// 按 siteId 均匀分 ⟹ 有一部分真客人的站长着不属于它那行的脸。#1115 量到的是 14 个词 / 55 处。
//
// 🔴 这一格**不拿 `hasPhrase` 去核 `hasPhrase`**（那是同义反复，只能证明实现调了那个函数，
//    对函数自己的 bug 完全失明）。判据是**字面值**：四个惹事的声明词、各自那几套主题的 id、
//    每个词归哪一组、每个词的真命中数，都是一个个量出来写死在这里的。
// 🔴 每一条都配**阳性对照**：先证那几套主题的 `industries` 里**真的**写着那个短词（读的是池子
//    这份数据，不经过任何匹配函数）。少了它，「那几套不在候选池里」跟「那几套根本不存在 / id 打错了」
//    长得一模一样 —— 而 id 打错的那种恒绿。
//
// ═══ 🔴 #1119：这一格原来的形态【在组邻接之后三条都失明了】，所以整格重锚 ═══════════════════
//
// 原形态是「拿词表里的词跑 `candidateThemesForIndustry`，声明短词的那几套不许在池子里」。
// #1119 把候选池换成【组成员】取（本组 5 套 + 伙伴组 5 套，不看 `industries`）之后：
//
//   · 那 7 个 case 的词**全都在词表里** ⟹ 它们一个都不再走 `industries` 匹配那条路。
//     实测（把落回路那行退回裸 `includes`，只变这一个变量）：整份输出**逐字不变**
//     ⟹ 6 个 ✅ 是**恒真**的，剩下 1 个（`party`）是**假红**：`fern-73` 进 `party` 的池子
//     是因为它就是 `events` 组的成员（`party` 也归 `events`），跟它声明过 `art` 无关。
//   · 「真命中 ≤ 候选池」那条也失明了：候选池下限从 4-10 抬成**恒 10**，而裸 `includes` 下
//     真命中的**最大值恰好也是 10**（`interior design` / `marketing`）⟹ `hits > pool`
//     按构造不可达，余量 0。实测把 `coverage.js` 那行退回裸 `includes`：输出同样逐字不变。
//
// ⟹ 重锚到匹配器**今天真正还在决定的那两处后果**上，四个惹事的声明词一个不少（覆盖面没缩）：
//
//   ⑩a **归组**（`sectorIndexForIndustry`）—— 词表的词现在靠它决定看哪两组的皮。裸 `includes`
//        会让 3 个词归错组：`furniture` / `architect` → `tech-media`（正是 #1115 那句「家具店 /
//        建筑事务所被拉进科技主题」，只是今天这条路是归组、不是词匹配）· `marketing` → `dining`。
//   ⑩b **落回路**（`candidateThemesForIndustry` 的 ② 分支）—— 老板自己填的自由文本。这是
//        `industries` 匹配今天唯一还在挑主题的地方，四个短词在这里全都还咬得住。
//   ⑩c **覆盖度同源**（`coverage.js` 的「真命中」）—— 钉 #1115 那 14 个词的字面命中数。
//        它是把两个文件的判据别在一起的那根钉子（原来那根靠 `hits > pool`，已经不可达）。
console.log('\n── ⑩ 挑主题按词边界匹配：短声明词不再靠子串把整组主题拉进来（#1115 · #1119 重锚）');
{
  // 🔴 每一条 case 都要先过两道**只读原始数据、不碰任何匹配函数**的阳性对照，否则下面的断言
  //    跟「id 打错了」/「这个词其实不含那个短词」长得一样 —— 而那两种都是恒绿。
  //    ① `offenders` 的 `industries` 里真的写着那个短词吗（读 `theme-pool.json`）
  //    ② 那个短词真的是「是子串、不是词」吗（纯字符串算术：`indexOf` 命中而 token 清单里没有）
  const declares = (id, kw) => !!(poolThemes[id] && (poolThemes[id].industries || []).includes(kw));
  const substringTrap = (word, culprit) => String(word).toLowerCase().includes(culprit)
    && !industryTokens(word).includes(culprit);
  function controlsHold(label, word, culprit, offenders) {
    const notDeclaring = offenders.filter((id) => !declares(id, culprit));
    if (notDeclaring.length) {
      bad(`${label} 阳性对照①没过：${notDeclaring.join(' · ')} 的 industries 里没有 "${culprit}"`
        + '（id 写错了 / 池子改过了 ⟹ 下面那条断言恒绿，什么都没守）');
      return false;
    }
    if (!substringTrap(word, culprit)) {
      bad(`${label} 阳性对照②没过："${culprit}" 在 "${word}" 里不是「是子串但不是词」的形状`
        + '（这条 case 已经分不出裸 includes 和词边界 ⟹ 它恒绿）');
      return false;
    }
    return true;
  }

  // ── ⑩a 归组：词表里的词靠 `sectorIndexForIndustry` 决定看哪两组的皮 ──────────────────────
  //
  // 字面值是量出来的：第 4 列是**今天**那个词归的组（词边界），第 5 列是把那一处退回裸 `includes`
  // 时它会归到的组 —— 只有 3 个词会变，而那 3 个正是 #1115 那句话里的家具店 / 建筑事务所 / 营销。
  // 归错组 = 整池 10 套全换成另一行的皮，比 #1115 原来那条（挤进来 4-5 套）更重。
  //
  // 词 → [惹事的短声明词, 裸 includes 会被它拉进来的那几套, 今天归的组, 裸 includes 会归到的组]
  const CASES = [
    ['fitness', 'it', ['indigo-66', 'ember-67', 'magenta-69', 'lime-70'], 'fitness-water', 'fitness-water'],
    ['furniture', 'it', ['indigo-66', 'ember-67', 'magenta-69', 'lime-70'], 'retail-lifestyle', 'tech-media'],
    ['architect', 'it', ['indigo-66', 'ember-67', 'magenta-69', 'lime-70'], 'retail-lifestyle', 'tech-media'],
    ['retirement', 'tire', ['rose-56', 'fern-57', 'indigo-58', 'jade-60'], 'finance-insurance', 'finance-insurance'],
    ['martial arts', 'art', ['azure-71', 'crimson-72', 'fern-73', 'violet-74', 'amber-75'], 'fitness-water', 'fitness-water'],
    ['marketing', 'market', ['fern-31', 'violet-32', 'amber-33', 'teal-34', 'magenta-35'], 'tech-media', 'dining'],
    // 🔴 #1115 r2 加它是为了钉住**最小的那个差值**（其余 13 个词掉 4-5 套，它只掉 1 套）。
    //    #1119 之后它的角色变了：`fern-73` 就是 `events` 组的成员，而 `party` 也归 `events`
    //    ⟹ 它**合法地**在池子里。所以下面 offenders 那条断言对 `party` 不成立，也不该成立 ——
    //    它现在只参加归组那条断言（`events`，两种匹配器下都一样），并在 ⑩b 里由自由文本探针
    //    `quartz countertops`（同一个短词 `art`）接手「不许靠子串挤进来」那一半。
    ['party', 'art', ['fern-73'], 'events', 'events'],
  ];
  const sectorKeyOf = (i) => (i >= 0 && sectors.SECTORS[i] ? sectors.SECTORS[i].key : '(认不出组)');
  for (const [word, culprit, offenders, wantSector, naiveSector] of CASES) {
    if (!controlsHold(`"${word}"`, word, culprit, offenders)) continue;
    const gotSector = sectorKeyOf(sectors.sectorIndexForIndustry(word));
    if (gotSector !== wantSector) {
      bad(`"${word}" 归到了 ${gotSector}，字面值是 ${wantSector}`
        + `（裸 includes 会把它归到 ${naiveSector}；归错组 = 整池 10 套换成另一行的皮）`);
    } else {
      ok(`"${word}" 归 ${wantSector}`
        + (naiveSector === wantSector ? '' : `（裸 includes 会归到 ${naiveSector} ⟹ 这条 case 咬得住）`));
    }
    // 🔴 走组邻接的词，池子已经不看 `industries` ⟹ 「offenders 不在池里」对它们**恒真**，
    //    单独当一格报会是零信息读数。只在 offenders 里**没有一个**是这个词那两组的成员时才有话可说
    //    —— 那时它仍然是一条真断言（谁都不该从别的组挤进来）；否则明说这一条今天不适用。
    // 🔴 这个「是本组/伙伴组成员就放过」的口子是**故意留的**，它的边界量过：把 `retail-lifestyle`
    //    的 partner 改成 `tech-media`，`furniture` 的池子里就真的有那 4 套科技皮，而这里会打
    //    「是伙伴组成员」的绿。那不是本格失明 —— 伙伴表本身由别处守：同一个变异下
    //    `industry-sectors.test.js` 一次红三格（一对一 `tech-media×2` · 那条判据没牙 ·
    //    AC4 五套进了 3 个组）。**别指望这一格能替你审伙伴表。**
    const pool = themesMod.candidateThemesForIndustry(word);
    const leaked = offenders.filter((id) => pool.includes(id));
    const legit = leaked.filter((id) => {
      const g = sectors.sectorIndexOfTheme(poolThemes[id]);
      const sec = sectors.sectorIndexForIndustry(word);
      return g === sec || g === sectors.partnerIndexOf(sec);
    });
    if (leaked.length && legit.length === leaked.length) {
      ok(`  └ "${word}" 池里那 ${leaked.length} 套（${leaked.join(' · ')}）是本组/伙伴组成员，`
        + `不是靠 "${culprit}" 挤进来的 —— 这一半由 ⑩b 的自由文本探针接手`);
    } else if (leaked.length) {
      bad(`  └ "${word}" 的候选池里有 ${leaked.filter((id) => !legit.includes(id)).join(' · ')}，`
        + `它们既不是本组也不是伙伴组的成员，只声明了 "${culprit}"`);
    } else {
      ok(`  └ "${word}" 的候选池 ${pool.length} 套，不含声明 "${culprit}" 的那 ${offenders.length} 套`);
    }
  }

  // ── ⑩b 落回路：老板自己填的自由文本（`industries` 匹配今天唯一还在挑主题的地方）──────────
  //
  // 🔴 每个探针都必须**认不出行业组**（`sectorIndexForIndustry < 0`），否则它走的是 ⑩a 那条路、
  //    这一格恒绿。这一条是机器判的，不是我在注释里保证的。
  // 探针都是真实形状的行业文字，不是造出来的乱码：一个超市、一家做礼服的、一个石英台面商、
  // 一家审计事务所 —— 四个短词（market / tire / art / it）各一个。
  // 第 3 列的字面值 = 把落回路那行退回裸 `includes` 时会被拉进池子的那几套（一个个量出来的）。
  const FREE_TEXT = [
    ['supermarket delivery', 'market', ['fern-31', 'violet-32', 'amber-33', 'teal-34', 'magenta-35']],
    ['custom attire', 'tire', ['rose-56', 'fern-57', 'indigo-58', 'jade-60']],
    ['quartz countertops', 'art', ['azure-71', 'crimson-72', 'fern-73', 'amber-75']],
    ['audit services', 'it', ['indigo-66', 'ember-67', 'magenta-69', 'lime-70']],
  ];
  for (const [probe, culprit, offenders] of FREE_TEXT) {
    if (!controlsHold(`落回路 "${probe}"`, probe, culprit, offenders)) continue;
    // 阳性对照③：它真的走落回路吗
    const sec = sectors.sectorIndexForIndustry(probe);
    if (sec >= 0) {
      bad(`落回路 "${probe}" 阳性对照③没过：它归到了 ${sectorKeyOf(sec)}`
        + '（那就走组邻接、不走 industries 匹配 ⟹ 这一格恒绿，换一个认不出组的探针）');
      continue;
    }
    // 🔴 兜底会开火（自由文本匹配不到东西，池子被 NEUTRAL_TOPUP 填到下限），所以不能像 ⑩a
    //    那样拿池长当前提。改成先证 offenders 与兜底那几套**无交集** —— 那时下面这条断言
    //    与兜底开不开火无关。
    const fromTopup = offenders.filter((id) => themesMod.NEUTRAL_TOPUP.includes(id));
    if (fromTopup.length) {
      bad(`落回路 "${probe}" 阳性对照④没过：${fromTopup.join(' · ')} 也在 NEUTRAL_TOPUP 里`
        + '（那它进池子可能是兜底推的，这条断言会因为别的原因说话）');
      continue;
    }
    const pool = themesMod.candidateThemesForIndustry(probe);
    const leaked = offenders.filter((id) => pool.includes(id));
    if (leaked.length) {
      bad(`落回路 "${probe}" 仍然靠子串把 ${leaked.join(' · ')} 拉进了候选池`
        + `（它们声明的是 "${culprit}"，而 "${probe}" 只是【含】这几个字母，不是【有这个词】）`);
    } else {
      ok(`落回路 "${probe}"（认不出组）的候选池 ${pool.length} 套，`
        + `不含声明 "${culprit}" 的那 ${offenders.length} 套`);
    }
  }

  // ── ⑩c 覆盖度同源：`coverage.js` 的「真命中」必须与挑主题那条路同一份判据 ────────────────
  //
  // 🔴 原来这根钉子是「真命中 ≤ 候选池」（下面还留着，但见那里的余量说明）。#1119 把候选池抬成
  //    恒 10，而裸 includes 下真命中的最大值恰好也是 10 ⟹ 那条不可达了。这里换成钉**字面命中数**：
  //    #1115 那 14 个词，每个词今天的真命中数写死在下面。把 coverage.js 那行退回裸 `includes`，
  //    每一个都会变大（括号里就是那时的值，取自 #1115 的实测表）⟹ 这一格会一次红 14 行。
  const HITS = [
    ['title', 5, 9], ['credit union', 4, 8], ['retirement', 5, 9], ['underwriting', 5, 9],
    ['benefits', 5, 9], ['mediterranean', 5, 9], ['fitness', 4, 8], ['martial arts', 4, 9],
    ['security', 5, 9], ['marketing', 5, 10], ['party', 4, 5], ['furniture', 4, 8],
    ['architect', 5, 9], ['architecture', 5, 9],
  ];
  {
    const rows = new Map(surveyCoverage().rows.map((r) => [r.word, r]));
    const wrong = [];
    const missing = [];
    for (const [word, want, naive] of HITS) {
      const r = rows.get(word);
      if (!r) { missing.push(word); continue; }
      if (r.hits !== want) wrong.push(`${word} ${r.hits}（字面值 ${want}，裸 includes 是 ${naive}）`);
    }
    if (missing.length) {
      bad(`⑩c 阳性对照没过：${missing.join(' · ')} 不在覆盖度普查的行里`
        + '（词表改过了 / 拼写变了 ⟹ 下面那条断言少守几个词，而少守是静默的）');
    } else if (wrong.length) {
      bad(`${wrong.length} 个词的真命中数与字面值不符 —— coverage.js 与挑主题那条路的判据分叉了：`
        + wrong.join(' · '));
    } else {
      ok(`#1115 那 14 个词的真命中数逐个等于字面值（4-5 套；裸 includes 是 8-10 ⟹ 这一格咬得住）`);
    }
  }

  // 🔴 跨文件的一条不变量:「真命中」和「候选池」必须用**同一份判据**。
  //    一套真声明了这个词的主题**必然**在它的候选池里 ⟹ hits > pool 是逻辑上不可能的。
  //    这一格守的是「只改了一处、另一处还是裸 includes」那种半修 —— #1115 量过，那时这里会有 14 个。
  //    它不假设哪一处是对的，所以两处任何一处漂了都说话。
  //
  // 🔴 #1119 起这一条的**余量是 0，别把它的绿当成一个读数**：组邻接把候选池抬成恒 10，而裸
  //    `includes` 下真命中的最大值**恰好也是 10**（`interior design` / `marketing` 各 10）
  //    ⟹ `hits > pool` 已经不可达。实测：把 coverage.js 那行退回裸 `includes`，这一格照绿。
  //    留着它是因为它表达的那句话仍然是真的，而且**池子一旦缩回去它就重新咬得住**（伙伴组那半
  //    被撤掉 ⟹ 池长回到 4-6，那时它会立刻红）。今天真正把两个文件别在一起的钉子是上面 ⑩c。
  {
    const s10 = surveyCoverage();
    const impossible = s10.rows.filter((r) => r.hits > r.pool);
    const margin = Math.min(...s10.rows.map((r) => r.pool)) - Math.max(...s10.rows.map((r) => r.hits));
    if (impossible.length) {
      bad(`${impossible.length} 个词的「真命中」大于「候选池」——两处判据分叉了`
        + `（真命中在 coverage.js，候选池在 themes.js）：`
        + impossible.slice(0, 5).map((r) => `${r.word} ${r.hits}/${r.pool}`).join(' · '));
    } else {
      ok(`${s10.rows.length} 个词逐个:真命中 ≤ 候选池（池长下限 `
        + `${Math.min(...s10.rows.map((r) => r.pool))} − 命中上限 ${Math.max(...s10.rows.map((r) => r.hits))}`
        + ` = 余量 ${margin}；#1119 后这条靠 ⑩c 顶，见上面注释）`);
    }
  }
}

console.log(`\n══ 汇总: 通过 ${pass} · 失败 ${fail} ══`);
process.exit(fail ? 1 : 0);
