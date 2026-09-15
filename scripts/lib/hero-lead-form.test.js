#!/usr/bin/env node
/**
 * hero-lead-form.test.js — 「首屏给不给表单」那两道判断的承重性质（#1097，#1333 改了做法）。
 *
 * 跑法:  node scripts/lib/hero-lead-form.test.js   （或 `npm run test:scripts`，它按文件名发现）
 * 退出码: 0 全过 · 1 有失败 · 2 跑不起来（**不许当成通过**）
 *
 * ══ 为什么这几条要有一个自动的调用方 ═════════════════════════════════════════════════════════════
 * 这几条的失败方向全部是**静默**的 —— 站照样建得出来，只是建错了：
 *   · 分类器退回裸 `includes`  → 退休理财的站首屏冒出一个「留下您的电话」，212 个词里只有一个会翻车
 *   · 换出来的块类型拼错        → `SectionRenderer` 走未知类型那一支（`console.warn` + `return null`），
 *                                 首屏整块**从页面上消失**，而构建 exit 0、UI 报完成
 *   · 不给表单那条路被碰到      → 全站产物字节变了，而没有任何断言在看它
 * 没有一条会让构建变红，也没有一条肉眼看得出来。
 *
 * 🔴 #1333 —— 中间那道「这个站抽到的主题给带表单的 hero 写过造型没有」删掉了（任何主题都画得出，
 * 理由写在 `hero-lead-form.js` 上），所以下面 ③ 换了对象：它现在问的是**换出来的那个块类型真的接线了吗**。
 */

'use strict';

const path = require('path');

const DIR = __dirname;
const NEXT = path.resolve(DIR, '..', '..');

let pass = 0; let fail = 0;
const ok = (m) => { pass += 1; console.log(`  ✅ ${m}`); };
const bad = (m) => { fail += 1; console.log(`  ❌ ${m}`); };
const die = (m) => { console.error(`🔴 跑不起来: ${m}`); process.exit(2); };

const fs = require('fs');

let sectors; let heroForm; let manifests; let blockRoles; let registrySrc;
try {
  sectors = require(path.join(NEXT, 'scripts', 'theme-pipeline', 'industry-sectors.js'));
  heroForm = require(path.join(DIR, 'hero-lead-form.js'));
  manifests = require(path.join(DIR, 'block-manifest.js')).loadManifests();
  blockRoles = JSON.parse(fs.readFileSync(path.join(NEXT, 'src', 'lib', 'sections', 'block-roles.json'), 'utf-8'));
  registrySrc = fs.readFileSync(path.join(NEXT, 'src', 'lib', 'sections', 'registry.ts'), 'utf-8');
} catch (e) {
  die(`require 失败: ${e.message}`);
}

const { SECTORS, isOnSiteIndustry } = sectors;
const { applyHeroLeadForm, HERO_FORM_BLOCK } = heroForm;

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

// ── ③ 换出来的那个块类型，三处都接上线了吗（#1333）─────────────────────────────────────────────
//
// 🔴 这一格接替的是 #1097 那道「主题声明过造型没有」的位置，治的是**同族但更严重**的失败：
//    `applyHeroLeadForm` 写下的 type，只要有一处没接线，`SectionRenderer` 就走未知类型那一支
//    （`console.warn` + `return null`）—— 首屏整块从页面上消失，而构建 exit 0、UI 报完成。
//    这正是 `site-data-migration.js` 文件头记着的那个形状（prod 上真发生过 43 个块）。
// 🔴 判据用**产出端那个常量**（`HERO_FORM_BLOCK`），不在这里重写一遍块名：写死一份就等于
//    「产出者改了名、这一格还在验旧名」，而那是绿着坏。
console.log('\n── ③ hero-with-form 三处接线：manifest / 角色表 / 注册表');
{
  const m = manifests.get(HERO_FORM_BLOCK);
  if (!m) bad(`blocks/${HERO_FORM_BLOCK}.json 不在 loadManifests 的结果里 —— 建站期的校验器不认识它`);
  else ok(`blocks/${HERO_FORM_BLOCK}.json 加载得到（category ${m.category} · roleDefault ${m.roleDefault}）`);

  if (blockRoles[HERO_FORM_BLOCK]) ok(`block-roles.json 里有它：${blockRoles[HERO_FORM_BLOCK]}`);
  else bad(`block-roles.json 里没有 ${HERO_FORM_BLOCK} —— data-role 会落到兜底的 essential，而它该是 lead`);

  // 注册表是 TypeScript，node require 不动 —— 按文本找那一行（同 `site-data-migration.js` 文件头
  // 记着的理由：正则抠 TS 是第二份实现，所以这里**只**问「有没有这一行」，权威仍是 block-roles.json）。
  if (new RegExp(`'${HERO_FORM_BLOCK}':\\s*\\w`).test(registrySrc)) ok(`registry.ts 里有 '${HERO_FORM_BLOCK}' 那一行`);
  else bad(`registry.ts 里没有 '${HERO_FORM_BLOCK}' ⟹ SectionRenderer 走未知类型那一支，首屏整块消失而构建照样绿`);

  // 表单那组槽位：manifest 说必填，而产出者必须真的填上（不填的话每次构建多一条假警报）。
  const formSlot = m && m.slots && m.slots.form;
  if (formSlot && formSlot.required === true) ok('manifest 把 form 槽位标成必填（validateSite 第 ① 条按它查）');
  else bad(`manifest 的 form 槽位不是必填（读到 ${JSON.stringify(formSlot)}）—— AC 要的是按必填查`);

  // 反向对照：拿一个不存在的块名问同样的三句话，三句都要说「没有」。
  const ghost = 'hero-with-form-nope';
  const ghostSeen = [
    manifests.get(ghost) ? 'manifest' : null,
    blockRoles[ghost] ? '角色表' : null,
    new RegExp(`'${ghost}':\\s*\\w`).test(registrySrc) ? '注册表' : null,
  ].filter(Boolean);
  if (!ghostSeen.length) ok(`反向对照：不存在的块名 ${ghost} 在三处都查不到 —— 上面三条不是恒真`);
  else bad(`反向对照失效：${ghost} 居然在 ${ghostSeen.join(' / ')} 里查得到`);
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

{
  const before = fixture();
  const after = fixture();
  const r = applyHeroLeadForm({ content: after, industry: 'cozy restaurant' });
  const d = diffJson(before, after);
  if (!r.applied && JSON.stringify(before) === JSON.stringify(after)) {
    ok(`restaurant（被行业那一道拦下）：JSON.stringify 逐字相同 · reason=${r.reason}`);
  } else {
    bad(`restaurant 夹具被改动了 —— applied=${r.applied}，差异:\n     ${d.join('\n     ') || '(无，但 applied 是 true)'}`);
  }
}
{
  const before = fixture();
  const after = fixture();
  const r = applyHeroLeadForm({ content: after, industry: 'plumbing' });
  const d = diffJson(before, after);
  // 🔴 逐条对，不是数条数：AC6b 要的是「只动这两处」。`type` 换名 + `data.form` 多出来一个空记录
  //    （`form` 是新块的必填槽，理由写在 `hero-lead-form.js` 的 `applyHeroLeadForm` 上）。
  const want = [
    `pages.0.sections.0.type: "hero" → "${HERO_FORM_BLOCK}"`,
    'pages.0.sections.0.data.form: (缺) → {}',
  ];
  if (r.applied && JSON.stringify(d) === JSON.stringify(want)) {
    ok(`plumbing：差异恰好两条 —— ${d.join(' · ')}`);
  } else {
    bad(`plumbing 的差异不是那两条：applied=${r.applied}\n     期望 ${JSON.stringify(want)}\n     实际 ${JSON.stringify(d)}`);
  }
  // 🔴 别的块一个都不许碰：同一页第二个块、以及另一页，逐字节不变。
  const untouched = diffJson(fixture().pages[0].sections[1], after.pages[0].sections[1])
    .concat(diffJson(fixture().pages[1], after.pages[1]));
  if (!untouched.length) ok('同一页的第二个块与另一页：逐字相同（只动首页第一个 hero）');
  else bad(`动到了不该动的地方：${untouched.join(' · ')}`);
}

// ── ⑤ 「行业算上门但落不了地」的几种形状，一律不写、也不许抛（AC5 同族）──────────────────────
//
// 🔴 #1333 少了一种（「主题没声明 with-form」跟那道判断一起退役了），多了一种更险的：
//    `content` 本身形状不对。`applyHeroLeadForm` 抛出去的话，`create-site.js` 那一层没有 catch，
//    一路冒到 `main().catch` ⟹ 建站直接死，而它做的只是一件锦上添花的事。
console.log('\n── ⑤ 落不了地的几种形状');
{
  const cases = [
    ['没有 slug==="home" 的页面', () => ({ pages: [{ slug: 'about', sections: [{ type: 'hero', data: {} }] }] })],
    ['首页里没有 hero 块', () => ({ pages: [{ slug: 'home', sections: [{ type: 'text-block', data: {} }] }] })],
    ['content 压根没有 pages', () => ({})],
    ['pages 不是数组', () => ({ pages: null })],
  ];
  for (const [name, mk] of cases) {
    const before = mk(); const after = mk();
    let r;
    try {
      r = applyHeroLeadForm({ content: after, industry: 'plumbing' });
    } catch (e) {
      bad(`${name}：抛了 —— ${e.message}`);
      continue;
    }
    const d = diffJson(before, after);
    if (!r.applied && !d.length) ok(`${name}：没写、没改动 · reason=${r.reason}`);
    else bad(`${name}：applied=${r.applied}，差异 ${JSON.stringify(d)}`);
  }
}

// ── ⑥ 每个上门行业词建出来的站，首页第一个块就是 hero-with-form（#1114 那条保证的新住处）─────────
//
// 🔴 这一格接替了 #1114 那条「每个上门行业词的候选池里都要有一套带表单的主题」。它当时问的是
//    **候选池**，因为那时「画得出带表单的首屏」是主题的属性，而池子按 16 组 × 5 套排、带表单的画法
//    每 7 个位子才出现一次 ⟹ 7 与 5 错开，必然有整组被永远跳过（当天 53 个上门词里 28 个是 0）。
//    #1333 之后那句话问不出东西了（没有任何主题再声明 `with-form`），而它真正想保证的事没变：
//    **上门行业的生意，首屏得有一个能留电话的地方**。所以判据换成直接量那件事本身，逐词量。
//
// 🔴 「不保证」那一半（Chris 2026-08-19：「有需要就有，碰上就有，不是一定要有的」）**按 #1333 的决定
//    退役了** —— 那句话说的是「抽到哪套主题」这份运气，而运气这一维随着主题那道判断一起没了。
//    今天是：上门行业 ⟹ 一定有。别把这一格改回「既不是 0 也不是全部」，那是在验一个已经被拍板去掉的性质。
console.log('\n── ⑥ 53 个上门行业词逐词：建出来的首页第一个块是 hero-with-form');
{
  const firstHomeType = (industry) => {
    const content = fixture();
    applyHeroLeadForm({ content, industry });
    return content.pages[0].sections[0].type;
  };
  const missing = onWords.filter((w) => firstHomeType(w) !== HERO_FORM_BLOCK);
  if (!missing.length) {
    ok(`${onWords.length} 个上门行业词逐个：首页第一个块都是 ${HERO_FORM_BLOCK}`);
  } else {
    bad(`🔴 ${missing.length} 个上门行业词建出来的站首屏没有表单：${missing.join(' ')}`);
  }

  // 🔴 反向那一半同样要守：非上门行业一个都不许被换掉，否则上面那条绿可以用「见谁都换」换来。
  const leaked = offWords.filter((w) => firstHomeType(w) !== 'hero');
  if (!leaked.length) {
    ok(`${offWords.length} 个非上门词逐个：首页第一个块仍然是 hero（没有一个被顺手换掉）`);
  } else {
    bad(`🔴 ${leaked.length} 个非上门词的首屏被换成了 ${HERO_FORM_BLOCK}：${leaked.slice(0, 8).join(' ')}`);
  }
}

console.log(`\n══ ${pass} 过 · ${fail} 失败 ══`);
process.exit(fail ? 1 : 0);
