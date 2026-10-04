#!/usr/bin/env node
/**
 * homepage-recipe.test.js — #1034 首页开场配方的机械检查。
 *
 * 跑法:  node scripts/lib/homepage-recipe.test.js
 * 退出码: 0 全过 · 1 有失败 · 2 跑不起来(**不许当成通过**)
 *
 * 🔴 提示词那几格是怎么拿到读数的:`create-site.js` 在发 API 请求**之前**就把整份提示词作为一条
 *    `{"event":"prompt"}` 打在 stdout 上。所以拿一把无效的 key 跑它,提示词照样拿得到,
 *    而 API 那一步当场 401 —— **一分钱不花**,也不碰任何真站。
 *
 * 📌 #1425（T3）—— ⑥ 原来比的是**两棵树**（钉死的基线 commit `d882d5de` 的 scripts/ vs 这棵树的，配今天的 blocks/，
 *    中间靠一个 manifest 适配层 + 十几条逐条登记的差异撑着）。本票按设计把提示词里的块名整批换成新库（旧库 28 块删了、
 *    16 个 `-new` 改回正名），基线那份 scripts 配今天的 blocks/ 已经吐不出提示词（`没拿到提示词`，rc=2）。
 *    ⟹ ⑥ 换成**同一棵树两臂互比**：开着 vs 关着，把配方那几处（三行硬要求 · 一行举例名单 · 候选清单的顺序）
 *    逐条拿掉之后两边逐字节相同 —— 守的仍是「关掉 == 没有这个功能，配方只动它自己那几处」。
 */

'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');
const { execFileSync, spawnSync } = require('child_process');
const crypto = require('crypto');

const DIR = __dirname;                                   // …/templates/nextjs/scripts/lib
const NEXT = path.resolve(DIR, '..', '..');              // …/templates/nextjs
// 「取块名这把尺子没退化成恒 0 / 恒 1」的下限。③ 和 ⑦ 两格共用它。
//
// 🔴 它守的是**尺子**，不是块库有多大 —— 两处的原注释（#1162）写得很清楚：判据是相对的
//    （拿掉一整块就正好少一种 / 两份读到同一个数），这个下限只是不让那个数退化成 0 或 1。
// 🔴 所以它不许按当前输入现算：现算的下限测的是自洽不是回归（同 `MAX_COLLIDING_PAIRS` 那条）。
// 📌 #1162 当时写死的是 20，那是 34 个块的年代。今天（#1375 删掉 logo 墙之后）这两格读到 19，
//    而 `origin/main` 上读 20 —— 也就是说 20 这个数会被区块库瘦身（#1372/#1375/#1376，32 → 26）
//    一路擦着过去，每删一个块就要有人来动它一次。定 12 是为了在整个瘦身期间不用再动：瘦身做完
//    这两格预计还有 17 上下，而离它真正要挡的那件事（0/1）仍隔一个数量级。
const NOT_DEGENERATE = 12;

let pass = 0; let fail = 0;
const ok = (m) => { pass++; console.log(`  ✅ ${m}`); };
const bad = (m) => { fail++; console.log(`  ❌ ${m}`); };
const die = (m) => { console.error(`🔴 跑不起来: ${m}`); process.exit(2); };

const md5 = (s) => crypto.createHash('md5').update(s).digest('hex').slice(0, 8);

/**
 * 一段清单文本里出现的块名，按出现顺序。清单每一条的头一行长这样:
 *   `- "hero" — variants: …`
 * 🔴 别写成「取每行第一个词」—— 每行都以 `- ` 开头，那样对任何清单都返回同一串东西，
 *    两份清单于是永远"相同"。第一版就是这么假绿的，所以下面有一格专门量这把尺子的判别力。
 */
const typesIn = (s) => {
  const out = [];
  for (const line of s.split('\n')) {
    const m = /^- "([a-z0-9-]+)"/.exec(line);
    if (m && !out.includes(m[1])) out.push(m[1]);
  }
  return out;
};

// ── 造一棵今天这份 scripts/ 的副本树；blocks/ node_modules/ src/ 软链今天这份 ────────────────────────────
// 📌 #1425（T3）—— 原来还能按一个 commit 造基线那棵树，外加一个把基线 manifest 键补回去的适配层（#1341 / #1387 / #1419）。
//    ⑥ 换成同树两臂之后那两段没有调用方，删了。
function treeAt(tmp) {
  const root = path.join(tmp, 'work');
  fs.mkdirSync(root, { recursive: true });
  execFileSync('cp', ['-a', path.join(NEXT, 'scripts'), root]);
  for (const link of ['blocks', 'node_modules', 'src']) {
    const target = path.join(NEXT, link);
    if (fs.existsSync(target) && !fs.existsSync(path.join(root, link))) {
      fs.symlinkSync(target, path.join(root, link));
    }
  }
  return root;
}

/** 在某棵树上跑一次 create-site,拿回它打出来的那份提示词。用无效 key ⟹ 不花钱。 */
function promptFrom(root, payload) {
  const r = spawnSync('node', [path.join(root, 'scripts', 'create-site.js')], {
    input: JSON.stringify(payload),
    env: { ...process.env, ANTHROPIC_API_KEY: 'sk-ant-invalid-for-test' },
    encoding: 'utf8',
    maxBuffer: 64 << 20,
    timeout: 120000,
  });
  for (const line of (r.stdout || '').split('\n')) {
    if (!line.trim()) continue;
    let ev; try { ev = JSON.parse(line); } catch { continue; }
    if (ev.event === 'prompt' && ev.name === 'Base Site') return ev.content;
  }
  die(`没拿到提示词(这棵树: ${root})。stderr 尾巴:\n${(r.stderr || '').slice(-600)}`);
  return '';
}

const basePayload = (over = {}) => ({
  siteId: 'tsite001',
  siteUrl: 'https://example.com', // #1547：manager 给的这次构建的地址，create-site 没它就退出
  companyName: 'Bright Smile Dental',
  industry: 'dental clinic',
  location: 'Toronto, ON',
  services: ['Teeth Cleaning', 'Whitening', 'Invisalign', 'Implants', 'Root Canal', 'Emergency Dental'],
  language: 'en',
  themeRotationIndex: 0,
  // 🔴 #1134（来源 #1139）—— 这份夹具是**一个有关键词页的站**：「有没有关键词」会改变提示词的字节
  //    （#1425（T3）起是服务详情页那行「第二个 features 列关键词页」+ 它那行 data），⑥ 两臂必须落在**同一个**
  //    关键词状态上。另一半状态由 ⑧b 单独钉。
  keywords: { 'Teeth Cleaning': [{ keyword: 'teeth cleaning toronto', selected: true, volume: 320 }] },
  ...over,
});

// ── 被测模块 ────────────────────────────────────────────────────────────────────────────────────
const { homepageRecipe, tryHomepageRecipe, recipeProblems, recipePromptLines, fingerprintEnabled,
  afterRetry, poolFor, industryRank, rotate, NOT_IN_POOL } = require('./homepage-recipe');
const { rotationIndexFromSiteId } = require('../themes');
const { loadManifests, promptSection } = require('./block-manifest');
const manifests = loadManifests();

console.log('══ #1034 首页开场配方 ══');

// ── ① 配方本身:确定性 + 连续索引互不相同 ───────────────────────────────────────────────────────
console.log('── ① 配方:同一个索引给同一份,连着的 8 个索引给 8 份不同的开场');
{
  const a = homepageRecipe(3, manifests, 'dental clinic');
  const b = homepageRecipe(3, manifests, 'dental clinic');
  JSON.stringify(a) === JSON.stringify(b)
    ? ok('同一个索引两次调用逐字相同（配方是可复算的，不是随机的）')
    : bad(`同一个索引给了两份不同的配方:\n${JSON.stringify(a)}\n${JSON.stringify(b)}`);

  const openers = [];
  for (let i = 0; i < 8; i++) openers.push(homepageRecipe(i, manifests, 'dental clinic').opener.join('|'));
  const uniq = new Set(openers);
  uniq.size === 8
    ? ok(`连着 8 个索引给出 8 个互不相同的开场（今天真站是 6/6 同一个开场）`)
    : bad(`8 个索引只给出 ${uniq.size} 种开场:\n  ${openers.join('\n  ')}`);

  // 📌 #1425（T3）—— 原来这里分两类数：带 announcement-bar 的站（BAR_EVERY=4，1/4 的站，前 2 块彼此相同）和其余。
  //    公告条块随旧库删了、`BAR_EVERY` / `withBar` 退役 ⟹ 开场恒为 hero + 三个，**每一个**站的前 2 块都必须互不相同。
  const recs = [];
  for (let i = 0; i < 8; i++) recs.push(homepageRecipe(i, manifests, 'dental clinic'));
  const first2 = recs.map((r) => r.opener.slice(0, 2).join('|'));
  new Set(first2).size === first2.length
    ? ok(`8 个站前 2 块互不相同（${first2.join(' · ')}）`)
    : bad(`8 个站里前 2 块有重复: ${first2.join(' · ')}`);
  const shapeBad = recs.filter((r) => r.opener.length !== 4 || r.opener[0] !== 'hero' || r.mustInclude.length !== 2 || 'withBar' in r);
  shapeBad.length === 0
    ? ok('8 份配方逐个：开场 4 块且第 1 块是 hero、必须出现的 2 个、没有 withBar 这个键')
    : bad(`配方形状不对: ${JSON.stringify(shapeBad[0])}`);
}

// ── ② 池子:排除名单在,而且改名会当场炸 ─────────────────────────────────────────────────────────
console.log('── ② 配方池:该排除的排除了;有人把块改名时不许静默放回');
{
  const pool = poolFor(manifests);
  const leaked = Object.keys(NOT_IN_POOL).filter((t) => pool.includes(t));
  leaked.length === 0 ? ok(`排除名单里的 ${Object.keys(NOT_IN_POOL).length} 个块一个都没进池子（池子 ${pool.length} 种）`)
    : bad(`这些不该在池子里: ${leaked.join(', ')}`);

  // 🔴 #1425（T3）—— 改名之后反方向的那个失败：继任块跟旧块同名（gallery / testimonials 正是这样），排除名单里要是
  //    留着旧那一条，它就把**新的**那个块静默挡在池外 —— 不 throw（名字还在）。所以拿全部 manifest 跑一次 poolFor：
  //    不 throw，且池子里有 gallery 和 testimonials；再从 manifest 现算「首页组里不在排除名单的那些」逐个比，一个不许少。
  {
    let p0 = null; let err = null;
    try { p0 = poolFor(manifests); } catch (e) { err = e; }
    if (err) bad(`拿全部 manifest 跑 poolFor 抛了: ${err.message}`);
    else {
      const want = ['gallery', 'testimonials'].filter((t) => !p0.includes(t));
      want.length === 0
        ? ok(`全部 manifest 跑 poolFor 不抛，池子里有 gallery 和 testimonials（池子 ${p0.length} 种: ${p0.join(' ')}）`)
        : bad(`池子里没有 ${want.join(' / ')} —— 改名后的继任块被挡在池外了（池子: ${p0.join(' ')}）`);
      const expect = [...manifests.values()].filter((m) => m.prompt && m.prompt.group === 'homepage' && !(m.type in NOT_IN_POOL)).map((m) => m.type);
      const lost = expect.filter((t) => !p0.includes(t));
      lost.length === 0 && p0.length === expect.length
        ? ok(`池子 == 首页组减去排除名单（${Object.keys(NOT_IN_POOL).join(' / ')}）= ${expect.length} 个，一个不少一个不多`)
        : bad(`池子跟「首页组减排除名单」对不上：少了 ${lost.join(' / ') || '无'} · 池子 ${p0.length} vs 期望 ${expect.length}`);
    }
  }

  // 阳性对照:把 hero 改个名字塞进去 ⟹ poolFor 必须炸,而不是"少排除一个,接着跑"
  const renamed = new Map([...manifests.entries()].filter(([k]) => k !== 'hero'));
  let threw = false;
  try { poolFor(renamed); } catch { threw = true; }
  threw ? ok('排除名单点名的块不在候选里时当场报错（改名不会把它静默放回池子）')
    : bad('把 hero 从候选里拿掉之后 poolFor 照样返回了 —— 排除名单会静默失效');
}

// ── ③ 清单只换顺序,一块都不加不减 ──────────────────────────────────────────────────────────────
console.log('── ③ 提示词里那份候选清单:只换顺序,块集合逐个不变');
{
  const plain = promptSection('homepage');
  const r = homepageRecipe(5, manifests, 'dental clinic');
  const shuffled = promptSection('homepage', undefined, { order: r.promptOrder });
  const a = typesIn(plain); const b = typesIn(shuffled);

  // 🔴 先证明这把尺子有判别力,再用它下结论。第一版的取块名写成了「取每行第一个词」,
  //    而每一行都以 "- " 开头 ⟹ 它对每份清单都返回同一个东西,两边当然"相同" —— 那是假绿。
  //    阳性对照:手工从清单里拿掉一整块,尺子必须看得出来。
  // #1425（T3）—— 原来手工拿掉的是 trusted-brands（旧库，删了）；改为拿掉清单里现读到的最后一块，不写死名字。
  const victim = typesIn(plain)[typesIn(plain).length - 1];
  const oneLess = plain.split('\n').filter((l) => !l.startsWith(`- "${victim}"`)).join('\n');
  // 🔴 #1162：这两个数原来写死成 28 / 27。写死一个「今天有多少种块」的数，在下一次加/删块的当天就
  //    成了假话（本仓 sync-config.js 里 MOVED_BLOCKS 那段注释记着同一个教训：写死的 34 在 #1132
  //    当天就印出了 -1）。本票删掉四个老 type 名之后它读到 24，于是这一格红在一件**它并不打算测**的
  //    事上。它真正要证的是「这把尺子分得开多一块和少一块」，所以判据换成**相对**的：
  //    拿掉一整块之后正好少一种，而且总数不能退化成 0/1（那才是尺子坏了）。数照旧打出来，只是不钉死。
  a.length >= NOT_DEGENERATE && typesIn(oneLess).length === a.length - 1 && !typesIn(oneLess).includes(victim)
    ? ok(`取块名这把尺子有判别力:完整清单读到 ${a.length} 种,手工拿掉 ${victim} 之后读到 ${typesIn(oneLess).length} 种（少正好一种）`)
    : bad(`取块名这把尺子坏了:完整 ${a.length} 种 / 拿掉一块之后 ${typesIn(oneLess).length} 种（期望少正好一种，且总数 ≥${NOT_DEGENERATE}）`);

  JSON.stringify([...a].sort()) === JSON.stringify([...b].sort())
    ? ok(`块集合一样（各 ${a.length} 种）`)
    : bad(`块集合变了:只在原顺序里 ${a.filter((x) => !b.includes(x))} / 只在新顺序里 ${b.filter((x) => !a.includes(x))}`);
  // 🔴 #1496 —— 转 `i * 步长 + 1` 格，在长度为 len 的一整圈里按构造恰好有一个 i 转回原位（len 26、步长 5 时正是 i = 5：
  //    5 × 5 + 1 = 26）。那一格不是「这一层没生效」，所以同时问相邻的 i = 6：步长跟 len 互质 ⟹ 相邻两个站不可能都转回原位，
  //    而这一层真没生效时两个都不变，照样红。
  const b6 = typesIn(promptSection('homepage', undefined, { order: homepageRecipe(6, manifests, 'dental clinic').promptOrder }));
  const moved = [[5, b], [6, b6]].filter(([, x]) => JSON.stringify(a) !== JSON.stringify(x));
  moved.length ? ok(`顺序确实变了（index ${moved.map(([k]) => k).join(' / ')}：${a[0]} … → ${moved[0][1][0]} …）`)
    : bad('换了 order 之后块的顺序一模一样（index 5 和 6 都是）—— 这一层没生效');
  // 🔴 index 0 也必须变。第一版按 `rotate(list, i)` 转，i=0 是恒等 —— 而 themeRotationIndex: 0
  //    是最常见的那个入参，等于第一个站白做。这一格就是那次真失败留下来的。
  const at0 = typesIn(promptSection('homepage', undefined, { order: homepageRecipe(0, manifests, 'dental clinic').promptOrder }));
  JSON.stringify(at0) !== JSON.stringify(a)
    ? ok(`index 0 也换了顺序（${a[0]} … → ${at0[0]} …）`)
    : bad('index 0 的清单顺序跟没换一样 —— 第一个站等于白做');
  const rotations = new Set();
  for (let i = 0; i < 8; i++) rotations.add(homepageRecipe(i, manifests, 'dental clinic').promptOrder[0]);
  rotations.size === 8 ? ok('连着 8 个索引，清单起点是 8 个不同的块')
    : bad(`8 个索引只给出 ${rotations.size} 个不同的清单起点`);
  // order 给一份少一块的名单,也不许掉块（没提到的接在后面）
  const short = promptSection('homepage', undefined, { order: r.promptOrder.slice(0, 3) });
  JSON.stringify([...typesIn(short)].sort()) === JSON.stringify([...a].sort())
    ? ok('order 名单不全时，没提到的块照旧接在后面（不会掉块）')
    : bad('order 名单不全就掉块了');
}

// ── ④ 校验:该红的红,该绿的绿,而且只看首页 ──────────────────────────────────────────────────────
console.log('── ④ recipeProblems:只看首页（AC6 射程），该红的红');
{
  const r = homepageRecipe(1, manifests, 'dental clinic');
  // #1425（T3）：cta-banner → cta、text-block → content（旧库删了）。
  const good = [{ slug: 'home', sections: [...r.opener, ...r.mustInclude, 'cta'].map((t) => ({ type: t })) }];
  recipeProblems(good, r).length === 0 ? ok('照配方来的首页:0 个问题')
    : bad(`照配方来的首页也被判红: ${recipeProblems(good, r).join(' / ')}`);

  const reordered = [{ slug: 'home', sections: [r.opener[1], r.opener[0], ...r.opener.slice(2), ...r.mustInclude].map((t) => ({ type: t })) }];
  recipeProblems(reordered, r).some((p) => p.includes('开头'))
    ? ok('开场前两块调个个儿 ⟹ 报「开头必须逐个是…」')
    : bad('开场被调换了却没报');

  const missing = [{ slug: 'home', sections: r.opener.map((t) => ({ type: t })) }];
  recipeProblems(missing, r).filter((p) => p.includes('必须有')).length === r.mustInclude.length
    ? ok(`少了 ${r.mustInclude.length} 个必须出现的块 ⟹ 逐个报出来`)
    : bad(`必须出现的块少了却没逐个报: ${recipeProblems(missing, r).join(' / ')}`);

  // 🔴 AC6 射程:子页面乱七八糟也不许报
  const otherPageBroken = [
    { slug: 'home', sections: [...r.opener, ...r.mustInclude].map((t) => ({ type: t })) },
    { slug: 'about', sections: [{ type: 'cta' }, { type: 'content' }] },
    { slug: 'services', sections: [{ type: 'hero' }] },
  ];
  recipeProblems(otherPageBroken, r).length === 0
    ? ok('子页面随便怎么排都不报 —— 射程只有首页')
    : bad(`子页面被算进来了: ${recipeProblems(otherPageBroken, r).join(' / ')}`);

  // #998 两种形状都要认
  const asBlocks = [{ slug: 'home', blocks: [...r.opener, ...r.mustInclude].map((t) => ({ type: t })) }];
  recipeProblems(asBlocks, r).length === 0 ? ok('`blocks` 形状和 `sections` 形状都认（#998）')
    : bad('blocks 形状没被认出来');
}

// ── ④b recipeProblems 按站级块库解析之后再判（#1156）───────────────────────────────────────────
//
// 🔴 为什么这条要有测试：这个函数问的是「建出来的首页长什么样」，而它此前读的是「磁盘上那个数组
//    长什么样」。有 `{ "ref": … }` 时两者不是一回事 —— ref 条目没有 `type`，于是
//      · ref 落在开场那几格 ⟹ 开场序列里多一个 undefined，报一条假的「开头必须逐个是 …」
//      · 必须出现的块由站级块提供 ⟹ 报一条假的「首页里必须有 X，实际没有」
//    两条都让 `create-site.js §generateContent` 白烧一次真模型调用（重写也修不掉，跟模型写得对不对无关）。
//    这两格是 #1155 QA3 反向角度 ① 的 H1a / H1c，本票交付前两臂真跑过 create-site.js 复现。
//
// 🔴 反向对照守两个方向：H1b（ref 追加在末尾，本来就静默，别让它开始报）+ 真的骨架撞车（照旧报）。
console.log('── ④b recipeProblems:站级块提供的块也要算进首页骨架（#1156）');
{
  const r = homepageRecipe(1, manifests, 'dental clinic');
  const T = (t) => ({ type: t });
  const base = [...r.opener, ...r.mustInclude, 'cta'];   // #1425（T3）：cta-banner → cta
  const LIB = { 'our-team': { type: r.opener[1], data: {} },
    'shared-must': { type: r.mustInclude[0], data: {} } };
  const home = (blocks) => [{ slug: 'home', blocks }];

  // 真阳 H1a —— ref 正落在 opener 第 2 格那个块的位置上
  const h1a = home([T(r.opener[0]), { ref: 'our-team' }, ...r.opener.slice(2).map(T),
    ...r.mustInclude.map(T), T('cta')]);
  recipeProblems(h1a, r, LIB).length === 0
    ? ok('H1a: 开场里那一格由站级 ref 提供 ⟹ 0 个问题')
    : bad(`H1a 仍被误报: ${recipeProblems(h1a, r, LIB).join(' / ')}`);

  // 真阳 H1a' —— ref 指不到 id（建站那一刻站级块库还是空的，这是今天唯一到得了的形状）
  const dangling = home([{ ref: 'our-team' }, ...base.map(T)]);
  recipeProblems(dangling, r, {}).length === 0
    ? ok('H1a\': ref 指不到 id ⟹ 跟构建期一样丢掉这一格，0 个问题')
    : bad(`H1a' 仍被误报: ${recipeProblems(dangling, r, {}).join(' / ')}`);

  // 真阳 H1c —— 必须出现的块只由站级 ref 提供
  const h1c = home([...r.opener.map(T), { ref: 'shared-must' },
    ...r.mustInclude.slice(1).map(T), T('cta')]);
  recipeProblems(h1c, r, LIB).length === 0
    ? ok(`H1c: 必须出现的 "${r.mustInclude[0]}" 由站级 ref 提供 ⟹ 0 个问题`)
    : bad(`H1c 仍被误报: ${recipeProblems(h1c, r, LIB).join(' / ')}`);

  // 真阳 —— 必须出现的块由站级块的 visibility 提供
  const viaVis = home([...r.opener.map(T), ...r.mustInclude.slice(1).map(T), T('cta')]);
  const VIS = { 'shared-must': { type: r.mustInclude[0], visibility: ['home'], data: {} } };
  recipeProblems(viaVis, r, VIS).length === 0
    ? ok('visibility 命中首页的站级块也算「首页里有」')
    : bad(`visibility 那条没算进来: ${recipeProblems(viaVis, r, VIS).join(' / ')}`);

  // 反向对照 H1b —— ref 追加在末尾，本来就静默，改完还要静默
  recipeProblems(home([...base.map(T), { ref: 'our-team' }]), r, LIB).length === 0
    ? ok('反向对照 H1b: ref 追加在首页末尾 ⟹ 照旧静默')
    : bad('H1b 开始报了');

  // 反向对照 —— 真的骨架撞车照旧报
  const swapped = home([r.opener[1], r.opener[0], ...r.opener.slice(2), ...r.mustInclude,
    'cta'].map(T));
  recipeProblems(swapped, r, LIB).some((p) => p.includes('开头'))
    ? ok('反向对照: 开场前两块调个个儿 ⟹ 照旧报「开头必须逐个是…」')
    : bad('真的骨架撞车不报了 —— 这条检查被写瞎了');

  // 反向对照 —— ref 真的把别的块塞进了开场，那是真撞车，必须报
  const wrongSlot = home([{ ref: 'our-team' }, ...base.map(T)]);
  recipeProblems(wrongSlot, r, LIB).some((p) => p.includes('开头'))
    ? ok(`反向对照: ref 把 "${r.opener[1]}" 塞到第 1 格 ⟹ 那是真撞车，照旧报`)
    : bad('ref 造成的真撞车被一起压掉了 —— 压过头了');

  // 反向对照 —— 少了必须出现的块，照旧逐个报
  recipeProblems(home(r.opener.map(T)), r, LIB).filter((p) => p.includes('必须有')).length
    === r.mustInclude.length
    ? ok(`反向对照: 少了 ${r.mustInclude.length} 个必须出现的块 ⟹ 照旧逐个报`)
    : bad('必须出现的块少了却没逐个报');
}

// ── ⑤ 开关 ─────────────────────────────────────────────────────────────────────────────────────
console.log('── ⑤ payload 开关');
{
  fingerprintEnabled({}) && fingerprintEnabled({ homepageFingerprint: true }) && !fingerprintEnabled({ homepageFingerprint: false })
    ? ok('缺省开着;homepageFingerprint:false 才关')
    : bad('开关判反了');
  const rl = recipePromptLines(homepageRecipe(2, manifests, 'dental clinic'));
  /MUST OPEN WITH EXACTLY/.test(rl) && /MUST ALSO INCLUDE/.test(rl)
    ? ok('提示词那几行两条硬要求都在') : bad(`提示词那几行不对:\n${rl}`);
}

// ── ⑥⑦ 提示词:关掉 = 没有这个功能(同树两臂);开着 = 只在配方那几处不同 ────────────────────────────
// 📌 #1425（T3）—— 原来 ⑥ 拿钉死的基线 commit 那棵树比（理由与换法见文件头）。现在两臂都在这棵树上：
//    开着那份把配方那几处逐条拿掉、关着那份把配方取代掉的那一行拿掉、两份的候选清单都按块名排 ⟹ 必须逐字节相同。
console.log('── ⑥ 关掉之后 == 没这个功能：开着那份去掉配方那几处之后，跟关着那份逐字节相同（同一棵树两臂）');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'recipe-test-'));
let promptOff = '';
try {
  const workRoot = treeAt(tmp);
  promptOff = promptFrom(workRoot, basePayload({ homepageFingerprint: false }));
  const promptOn0 = promptFrom(workRoot, basePayload());
  const r0x = homepageRecipe(rotationIndexFromSiteId(basePayload().siteId), manifests, 'dental clinic');
  const RECIPE_LINES = recipePromptLines(r0x).split('\n');
  const EXAMPLE_PREFIX = '- Include at least TWO sections that most sites wouldn\'t have';
  /** 候选清单那一段（HOMEPAGE SECTIONS … PAGE-SPECIFIC）里的块条目按块名排；其余原样。 */
  const sortHomeList = (t) => {
    const at = t.indexOf('HOMEPAGE SECTIONS'); const end = t.indexOf('PAGE-SPECIFIC SECTION RULES');
    if (at < 0 || end < 0) die('提示词里切不出 HOMEPAGE SECTIONS … PAGE-SPECIFIC SECTION RULES 那一段');
    const seg = t.slice(at, end).split('\n');
    const pre = []; const entries = []; const post = [];
    for (const l of seg) {
      if (/^- "/.test(l)) entries.push([l]);
      else if (entries.length && l.startsWith('  ')) entries[entries.length - 1].push(l);
      else (entries.length ? post : pre).push(l);
    }
    entries.sort((x, y) => (x[0] < y[0] ? -1 : x[0] > y[0] ? 1 : 0));
    return t.slice(0, at) + [...pre, ...entries.flat(), ...post].join('\n') + t.slice(end);
  };
  const normOn = sortHomeList(promptOn0).split('\n').filter((l) => !RECIPE_LINES.includes(l)).join('\n');
  const normOff = sortHomeList(promptOff).split('\n').filter((l) => !l.startsWith(EXAMPLE_PREFIX)).join('\n');
  if (normOn === normOff) {
    ok(`开着那份去掉配方 ${RECIPE_LINES.length} 行 + 关着那份去掉举例名单那一行 + 候选清单按块名排 ⟹ 逐字节相同（md5 ${md5(normOn)} · ${normOn.length} 字节）`);
  } else {
    const A = normOn.split('\n'); const B = normOff.split('\n');
    bad(`去掉配方那几处之后两份仍不同 —— 配方动了它自己以外的字节。只在开着: ${A.filter((l) => !B.includes(l)).slice(0, 3).join(' ⏎ ')}`
      + ` · 只在关着: ${B.filter((l) => !A.includes(l)).slice(0, 3).join(' ⏎ ')}`);
  }
  // 🔴 判别力①：三处拿掉逐条都是承重的 —— 少拿任何一处，两份就对不上（否则上面那格什么都没证明）。
  {
    const plainOn = promptOn0.split('\n').filter((l) => !RECIPE_LINES.includes(l)).join('\n');
    const keepRecipe = sortHomeList(promptOn0);
    const keepExample = sortHomeList(promptOff);
    const legs = [
      ['候选清单不排序', plainOn !== promptOff.split('\n').filter((l) => !l.startsWith(EXAMPLE_PREFIX)).join('\n')],
      ['开着那份不去配方行', keepRecipe !== normOff],
      ['关着那份不去举例行', normOn !== keepExample],
    ];
    const dead = legs.filter(([, differs]) => !differs).map(([n]) => n);
    dead.length === 0
      ? ok(`判别力：三处拿掉逐条都是承重的（${legs.map(([n]) => n).join(' / ')} 各自都对不上）`)
      : bad(`有一处拿掉是死的（不做也对得上）：${dead.join(' · ')} —— 那这一格对它什么都没证明`);
  }
  // 🔴 判别力②：每一条配方行都真在开着那份里（一行没印出来也会让上面「去掉之后相同」照样成立）。
  {
    const missingLines = RECIPE_LINES.filter((l) => !promptOn0.split('\n').includes(l));
    missingLines.length === 0 && promptOff.split('\n').some((l) => l.startsWith(EXAMPLE_PREFIX))
      ? ok(`配方那 ${RECIPE_LINES.length} 行逐行都在开着那份里，举例名单那一行在关着那份里`)
      : bad(`配方行缺 ${missingLines.length} 行 / 关着那份没有举例行 —— 上面那格是在比两份都缺了东西的提示词`);
  }

  console.log('── ⑦ 开着的时候,变的只有【候选清单的顺序】和【那一行举例名单】');
  const promptOn = promptOn0;
  promptOn !== promptOff ? ok('开着和关着的提示词不一样（否则这张票什么都没做）')
    : bad('开着跟关着一模一样 —— 配方没进提示词');

  // 🔴 期望值按 **siteId** 算，不是按 themeRotationIndex（#1034 r2 换了差异源）。
  //    这一行本身就是接线检查:算错了这一格当场红。
  const r0 = homepageRecipe(rotationIndexFromSiteId(basePayload().siteId), manifests, 'dental clinic');
  promptOn.includes(`MUST OPEN WITH EXACTLY THESE SECTIONS, IN THIS ORDER: `
    + r0.opener.map((t) => `"${t}"`).join(' → '))
    ? ok(`开场那条硬要求逐字在提示词里: ${r0.opener.join(' → ')}`)
    : bad('开场那条硬要求没进提示词');

  // 那份被当成待办清单的举例名单:关着在、开着不在
  // #1425（T3）—— 举例名单换成新库的块（milestones / logos / team / gallery），这里只认那一行的句头。
  const exampleLine = EXAMPLE_PREFIX;
  promptOff.includes(exampleLine) && !promptOn.includes(exampleLine)
    ? ok('举例名单那一行:关着在、开着被硬要求取代（它正是 6 个真站选中的那批块）')
    : bad(`举例名单那一行的在/不在判错了(关着 ${promptOff.includes(exampleLine)} / 开着 ${promptOn.includes(exampleLine)})`);

  // 块集合不变:两份提示词的 homepage 清单里出现的块名逐个相同（顺序可以不同）
  const homeSeg = (s) => s.slice(s.indexOf('HOMEPAGE SECTIONS'), s.indexOf('PAGE-SPECIFIC SECTION RULES'));
  const onTypes = typesIn(homeSeg(promptOn)); const offTypes = typesIn(homeSeg(promptOff));
  // 🔴 #1162：同上，原来写死 28。这一格问的是「尺子在真提示词上读得到一个像样的数，不是恒 0/恒 1」，
  //    所以判据是「两份读到的数相同且不退化」，把那个数打出来而不是钉死它。下限见模块顶部
  //    `NOT_DEGENERATE`（#1375 写的那一份，#1376 逐字采用）。
  onTypes.length === offTypes.length && onTypes.length >= NOT_DEGENERATE
    ? ok(`两份提示词里各读到 ${onTypes.length} 种块（相同，且不是恒 0/恒 1）`)
    : bad(`读到的块数不对:开着 ${onTypes.length} / 关着 ${offTypes.length}（期望两者相同且 ≥${NOT_DEGENERATE}）`);
  JSON.stringify([...onTypes].sort()) === JSON.stringify([...offTypes].sort())
    ? ok('候选块集合一样 —— 只换了顺序，没拿掉任何块')
    : bad(`候选块集合变了: 只在开着 ${onTypes.filter((x) => !offTypes.includes(x))}`
      + ` / 只在关着 ${offTypes.filter((x) => !onTypes.includes(x))}`);
  JSON.stringify(onTypes) !== JSON.stringify(offTypes)
    ? ok(`清单顺序在真提示词里确实变了（${offTypes[0]} … → ${onTypes[0]} …）`)
    : bad('真提示词里清单顺序没变');

  console.log('── ⑧ 用户点名照抄参照站布局时,配方让开');
  const withRef = promptFrom(workRoot, basePayload({
    refPrefs: ['layout'],
    refAnalysis: { primaryColor: '#123456', sections: 'hero, features, testimonials', navLinks: [] },
  }));
  !withRef.includes('MUST OPEN WITH EXACTLY THESE SECTIONS')
    ? ok('refPrefs 里有 layout ⟹ 提示词里没有配方那条硬要求（用户点名的那个赢）')
    : bad('照抄参照站布局时配方还在，两条硬要求会打架');

  // ── ⑧b #1134（来源 #1139）—— 关键词页那一格只在会有子页的站上发 ────────────────────────────────
  //
  // 📌 #1425（T3）—— 原来盯的是 `service-related-pages` 那个块（散文三句 + 它在清单里那一条）：它只在那个服务底下真有
  //    关键词子页时才渲染，没有就恒 `return null`。那个块随旧库删了（#1505 定不做新块），它的位置由服务详情页那行
  //    「第二个 features 列这个服务的关键词页」接替（items 写引用 `{"source":"pages","under":…}`），同样只在有关键词页
  //    的站上发（`create-site.js` 的 `hasKeywordPages`）。性质不变：两向都判，除了那两处之外两份提示词不许有别的差别。
  console.log('── ⑧b 关键词页那一格（第二个 features）：有关键词页才发，没有就不发');
  {
    const NEEDLES = [
      'a second features listing this service\'s keyword pages',
      '- the keyword-pages features: { headline: ',
    ];
    // 📌 #1548 —— 「SEO TARGET KEYWORDS」那一段（站主词 / 每服务主词 / 关键词页清单）按构造随关键词变，两臂比之前先从
    //    两份里摘掉，这一格才仍然只量关键词页那一格。那一段自己的判据在 `lib/target-keywords.test.js` ④。
    const dropBrief = (p) => p.replace(/\n\nSEO TARGET KEYWORDS[^]*?(?=\n\n)/, '');
    const withKw = dropBrief(promptFrom(workRoot, basePayload()));            // 夹具自带关键词
    const noKw = dropBrief(promptFrom(workRoot, basePayload({ keywords: {} })));
    const inWith = NEEDLES.filter((n) => withKw.includes(n));
    const inNo = NEEDLES.filter((n) => noKw.includes(n));
    inWith.length === NEEDLES.length
      ? ok(`有关键词页的站：那 ${NEEDLES.length} 处都在（阳性对照 —— 少了它「不发」那格就成了空绿）`)
      : bad(`有关键词页的站却少了这几处：${NEEDLES.filter((n) => !withKw.includes(n)).join(' | ')}`);
    inNo.length === 0
      ? ok('没有关键词页的站：一处都不发 ⟹ AI 不会被要求写一个注定没有条目的关键词页列表')
      : bad(`没有关键词页的站仍然被要求写关键词页列表：${inNo.join(' | ')}`);
    // 除了那两处自己的行，两份提示词不该有别的差别（空行不算：那行 data 不发时留下的是一个空行）
    const noLines = noKw.split('\n');
    const diffLines = withKw.split('\n').filter((l) => !noLines.includes(l));
    const foreign = diffLines.filter((l) => !NEEDLES.some((n) => l.includes(n)));
    const extraNo = noLines.filter((l) => l.trim() && !withKw.split('\n').includes(l) && !/^- Each page needs 5-7 sections: /.test(l));
    diffLines.length > 0 && foreign.length === 0 && extraNo.length === 0
      ? ok(`两份提示词的差别只在那两处自己的行（${diffLines.length} 行）`)
      : bad(`两份提示词还有别的差别，这一格量的不只是关键词页那一格：${[...foreign, ...extraNo].slice(0, 3).join(' ⏎ ')}`);
  }
} finally {
  try { fs.rmSync(tmp, { recursive: true, force: true }); } catch {}
}

// ── ⑨ 重试之后的判决 ───────────────────────────────────────────────────────────────────────────
console.log('── ⑨ 重试跑完块库仍有问题时的判决（afterRetry）');
{
  afterRetry({ firstBlockProblems: 0, retryBlockProblems: 0 }) === 'ok'
    ? ok('重试之后块库干净 ⟹ ok') : bad('块库干净却不是 ok');
  afterRetry({ firstBlockProblems: 2, retryBlockProblems: 1 }) === 'fatal'
    ? ok('第一次就有块库问题、重试没修好 ⟹ fatal（逐字保持改动之前的行为）')
    : bad('第一次有块库问题时不再 fatal —— 那是行为回退');
  afterRetry({ firstBlockProblems: 0, retryBlockProblems: 1 }) === 'revert'
    ? ok('第一次块库干净（只为骨架撞车才重试）、重试把它改坏 ⟹ revert，不是 fatal')
    : bad('只为骨架撞车发起的重试会让整个站建不出来 —— 方向反了');
  afterRetry({}) === 'ok' ? ok('两个数都是 0/缺省 ⟹ ok') : bad('缺省参数下判错');
}

// ── ⑩ 接线:上面那个判决真的接在 create-site.js 上 ──────────────────────────────────────────────
//    🔴 这一格是**静态**的:它读源码，不跑那条分支（那条分支只有 AI 参与时才走得到）。
//    所以它能证明的是「create-site 用的是 afterRetry 的判决、那句 fatal 只在 'fatal' 那一支下面」，
//    证明不了「AI 真吐回坏 JSON 时确实退回了第一次那份」。下面第三条是这把尺子自己的判别力检查。
console.log('── ⑩ 接线：create-site.js 用的就是 afterRetry 的判决（静态，只读源码）');
{
  const src = fs.readFileSync(path.join(NEXT, 'scripts/create-site.js'), 'utf8');
  const FATAL = 'The generated layout still breaks the block library after a retry';
  const fatalCount = src.split(FATAL).length - 1;
  fatalCount === 1 ? ok('那句 fatal 全文只有一处') : bad(`那句 fatal 出现 ${fatalCount} 次，接线判据失效`);
  /switch \(afterRetry\(\{ firstBlockProblems: first\.problems\.length, retryBlockProblems: issues\.length \}\)\)/.test(src)
    ? ok('判决的两个入参就是 first.problems.length 与重试后的 issues.length')
    : bad('create-site.js 没有把这两个数喂给 afterRetry —— 判决可能拿错了数');
  // 那句 fatal 必须落在 case 'fatal' 之后、下一个 case 之前。
  const seg = src.slice(src.indexOf("case 'fatal':"), src.indexOf("case 'revert':"));
  seg && seg.includes(FATAL)
    ? ok(`那句 fatal 落在 case 'fatal' 那一支里（改动之前它是无条件的）`)
    : bad('那句 fatal 不在 fatal 分支里');
  // 判别力:把源码里的 afterRetry 调用抹掉，上面第二条必须翻红。恒真的尺子读不出接线断了。
  /switch \(afterRetry\(/.test(src.replace('switch (afterRetry(', 'switch (somethingElse('))
    ? bad('这把尺子恒真 —— 源码被改坏了它也读不出来')
    : ok('尺子有判别力:把那个调用换个名字，上面那条当场读不到');
}

// ── ⑪ 差异源按【站】变，不是按【人】变（#1034 r2，PM 2026-08-16 退回的那件事）─────────────────
//    r1 拿 `themeRotationIndex` 当配方的索引，而那个数是 `SELECT COUNT(*) … WHERE user_id = $1`
//    ⟹ 每个客户的第一个站都是 0，全都拿同一份配方（平台库上 116 个站里 73 个是这个样子）。
console.log('── ⑪ 差异源:8 个不同站主各自的第一个站,配方必须各不相同');
{
  // 真实形状的 siteId（8 位十六进制）。🔴 不用连号 id:`rotationIndexFromSiteId` 是 h*31+c，
  //    连号 id 的哈希也是连号 ⟹ 会走出一条不真实的完美均匀分布，等于给自己送一份好读数。
  const IDS = ['a3f19c40', '7b21de08', 'c0d4471a', '19e6b3f5',
    'f5820ac7', '4d7c1e93', 'b6039fa2', '2ec85d71'];
  const openers = IDS.map((id) => homepageRecipe(rotationIndexFromSiteId(id), manifests, 'dental clinic')
    .opener.join('|'));
  const under_r1 = homepageRecipe(0, manifests, 'dental clinic').opener.join('|');
  console.log(`     r1 下这 8 个站全都是这一份: ${under_r1.split('|').join(' → ')}`);
  for (let k = 0; k < IDS.length; k++) console.log(`     ${IDS[k]}  ${openers[k].split('|').join(' → ')}`);
  // 🔴 #1372 —— 这一格原来还多要一句「没有一个站落回 r1 那一份」。那半句是**靠运气**的：
  //    可达的配方一共 30 份（`homepageRecipe(i)` 跑 20000 个 i 数出来的，本票删 4 个块之后从 27 涨到
  //    30），8 个站各自独立抽一份，其中恰好有一个抽到「第 0 号」那份的概率约 1-(29/30)^8 ≈ 24%。
  //    本票删块之后 `4d7c1e93` 就抽中了它 —— 那不是「差异源没换干净」，它跟另外 7 个站两两都不同。
  //    这里改成量真正那条性质：**8 个站不是全都落回 r1 那一份**，并把撞上的个数打出来。
  const sameAsR1 = openers.filter((o) => o === under_r1).length;
  new Set(openers).size >= 2 && sameAsR1 < openers.length
    ? ok(`8 个站主各自的第一个站落在 ${new Set(openers).size} 份不同的配方上（r1 下是 1 份；其中 ${sameAsR1} 个跟 r1 那一份相同）`)
    : bad(`差异源没换干净:${new Set(openers).size} 份配方，跟 r1 那一份相同的有 ${sameAsR1} 个`);

  // 🔴 上面那 8 个 id 是**一个样本**，不是判据 —— 换一批 id 数字就会变（这次 8 个里有一对撞了，
  //    真实分布本来就会撞）。判据要落在**配方一共有几种**上，那个数是可枚举的:
  //      开场只由 `index % 池子` 决定 ⟹ 枚举那么多个索引就看得见全部。
  //      📌 #1425（T3）—— 原来是 `池子 × BAR_EVERY`（带公告条的那 1/4 让周期乘 4）；BAR_EVERY 随公告条退役。
  const pool = poolFor(manifests, 'dental clinic');
  const PERIOD = pool.length;                            // 开场按池子长度循环
  const all = [];
  for (let i = 0; i < PERIOD; i++) all.push(homepageRecipe(i, manifests, 'dental clinic').opener);
  const repeat = [];
  for (let i = 0; i < PERIOD; i++) repeat.push(homepageRecipe(i + PERIOD, manifests, 'dental clinic').opener);
  JSON.stringify(all) === JSON.stringify(repeat)
    ? ok(`配方按 index % ${PERIOD} 循环（枚举 ${PERIOD} 个 + 再枚举 ${PERIOD} 个，逐个相同）`)
    : bad(`配方的周期不是 ${PERIOD} —— 下面那几个概率全是错的`);
  const distinct = new Set(all.map((o) => o.join('|'))).size;
  console.log(`     ${PERIOD} 个索引给出 ${distinct} 种不同的开场`);

  // 🔴 这才是能跟 AC 门槛对话的读数:假设 siteId 的哈希在 44 个类上均匀，随机两个站的
  //    「前 N 块完全相同」就是 Σ(每个前缀出现的概率)²。（#1425（T3）：类数 = 池子长度，不再 × 4）算给三个前缀，逐个对 AC2 的门槛。
  const rateFor = (n) => {
    const c = new Map();
    for (const o of all) { const k = o.slice(0, n).join('|'); c.set(k, (c.get(k) || 0) + 1); }
    return [...c.values()].reduce((s, v) => s + (v / PERIOD) ** 2, 0);
  };
  const LIMITS = { 2: 0.30, 3: 0.20, 4: 0.18 };          // 我 23:25 写死的那三个门槛
  for (const n of [2, 3, 4]) {
    const p = rateFor(n);
    p <= LIMITS[n]
      ? ok(`随机两个站「前 ${n} 块完全相同」= ${(p * 100).toFixed(1)}%，门槛 ≤${LIMITS[n] * 100}%`
        + `（基线那 6 个真实站:前2 100% · 前3 67% · 前4 13%）`)
      : bad(`「前 ${n} 块完全相同」= ${(p * 100).toFixed(1)}%，超过门槛 ${LIMITS[n] * 100}%`);
  }
  // 判别力:把这把尺子喂给「所有站同一份配方」的那个极端，它必须读到 100%。
  const degenerate = [...Array(PERIOD)].map(() => all[0]);
  (() => {
    const c = new Map();
    for (const o of degenerate) { const k = o.slice(0, 2).join('|'); c.set(k, (c.get(k) || 0) + 1); }
    return [...c.values()].reduce((s, v) => s + (v / PERIOD) ** 2, 0);
  })() === 1
    ? ok('尺子有判别力:喂给「所有站同一份配方」它读到 100%（那正是 r1 跨用户时的样子）')
    : bad('这把尺子对「全都一样」也读不到 100% —— 它说明不了任何事');
}

// ── ⑫ 块被改名时:不用配方，而不是让建站失败（#1034 r2，QA1/QA2 在 r1 上点的）──────────────────
console.log('── ⑫ 块被改名:tryHomepageRecipe 交回 error，create-site 不再当场死');
{
  // #1425（T3）：cta-banner → cta（排除名单里今天的那一个收尾块）。
  const renamed = new Map([...manifests.entries()].filter(([k]) => k !== 'cta'));
  const attempt = tryHomepageRecipe(7, renamed, 'dental clinic');
  attempt.recipe === null && attempt.error && /"?cta"?/.test(attempt.error.message)
    ? ok('块被改名 ⟹ recipe 是 null、error 点名那个块（这一趟不用配方 = 退回改动之前的行为）')
    : bad(`块被改名时的返回不对: ${JSON.stringify({ recipe: attempt.recipe, error: String(attempt.error) })}`);

  const good = tryHomepageRecipe(7, manifests, 'dental clinic');
  good.error === null && good.recipe && good.recipe.opener.length === 4
    ? ok('正常情况下 error 是 null、配方照常给出来')
    : bad(`正常情况下的返回不对: ${JSON.stringify(good)}`);

  // 静态接线:create-site.js 必须走这条不抛的路，而且索引来自 siteId 不是 themeRotationIndex。
  const src = fs.readFileSync(path.join(NEXT, 'scripts/create-site.js'), 'utf8');
  /const recipeIndex = rotationIndexFromSiteId\(siteId\);/.test(src)
    ? ok('create-site.js 的配方索引来自 rotationIndexFromSiteId(siteId)')
    : bad('create-site.js 没有按 siteId 算配方索引 —— 跨用户那件事没修');
  /tryHomepageRecipe\(recipeIndex,/.test(src) && !/[^y]homepageRecipe\(themeRotationIndex/.test(src)
    ? ok('喂给配方的就是那个 siteId 索引，themeRotationIndex 不再参与骨这一半')
    : bad('create-site.js 仍在拿 themeRotationIndex 算配方');
  !/\bhomepageRecipe\(/.test(src.replace(/tryHomepageRecipe\(/g, ''))
    ? ok('create-site.js 里没有会抛的那个直接调用了')
    : bad('create-site.js 仍然直接调 homepageRecipe —— 块改名那天它还是会 0.1 秒死掉');
  // 判别力:把源码里那行索引改个名，上面第一条必须翻红。
  /const recipeIndex = rotationIndexFromSiteId\(siteId\);/
    .test(src.replace('const recipeIndex = rotationIndexFromSiteId(siteId);', 'const recipeIndex = 0;'))
    ? bad('这把尺子恒真 —— 源码被改回去它也读不出来')
    : ok('尺子有判别力:把那行换成写死的 0，上面那条当场读不到');
}

// ── ⑬ 行业【真的】参与首页结构（#1124）────────────────────────────────────────────────────────────
//
// 本票之前 `industry` 这个入参是空转的：`poolFor` 只装一个 `discouraged` 谓词，而 34 份 manifest 里
// `discouraged` 是 0/34 ⟹ 面包店和律所拿到逐字相同的开场。这一节钉三件事，每件都带自己的反向对照。
console.log('── ⑬ #1124 行业参与结构:两两不同 · 认不出来的回到今天 · 撞车率不退步');
{
  const { industryMatches, recogniseIndustry, INDUSTRY_VOCABULARY } = require('./block-manifest');
  const NAMED = ['plumbing', 'bakery', 'law firm', 'gallery'];
  const AT = 7;   // 同一个序号上比，AC1 要的就是这个口径

  // (a) 点名的四个行业拿到的开场，**撞车对数不许超过下面这个实测数**。
  //
  // 🔴 #1162 换掉了这一格的判据，原来写的是「在 index=7 上两两都不相同」。为什么换（读数逐条）：
  //    · 撞车**改之前就有**：200 个序号 × 6 对 = 1200 对里，改前 75 对撞（67 个序号有撞车），
  //      改后 98 对（83 个序号）。`index=7` 只是改前**恰好**不撞的那种 —— 所以原来那一格是拿
  //      单个序号抽查一件本来就普遍存在的事，它翻红说明的是「7 这个数变了」，不是「变差了」。
  //    · 变差的**真原因**是本票：`values-grid` / `benefits-list` / `checklist` /
  //      `service-highlights` 五块并成一块（`card-group`），manifest 从 35 份掉到 31 份、首页候选池
  //      从 22 块掉到 18 块 ⟹ 能排出来的开场组合本来就少了。开场种数每个行业 **33 → 27**。
  //    · 🔴 那个真损失**下面 (c) 那一格看不见**：它的基线 `distinct('')` 是在同一次跑里现算的，
  //      33 → 27 时基线自己也掉到 27，所以它按构造照旧绿。想看那一维要拿两棵树各跑一次
  //      （#1162 的交付留言里给了 33→27 与 75→98 两组数）。这里不给 (c) 加一个写死的下限，
  //      是因为「合并要不要付这个代价」是产品决定，已经由 Chris 拍过（#1162 / #1161 同一裁定框架）。
  //    · 上限写死，不按当前输入现算 —— 现算的下限测的是自洽不是回归（同 `SHAPE_FLOOR` 那条）。
  //      合并批 3~6 还会往下压这个数，那时**在同一次改动里**把它改掉并写下新的两组读数。
  //
  // 🔴 #1375（2026-09-17）按上面那句话把它从 98 挪到 107，两组读数如下（同一天、同一条命令，
  //    两棵树各跑一次 `node scripts/lib/homepage-recipe.test.js`）：
  //      改前 `origin/main c26076d8`：撞车 **59**/1200 对（59/200 个序号）· 每个行业的候选池 15 块
  //      改后 本票交付            ：撞车 **107**/1200 对（107/200 个序号）· 候选池 14 块
  //    · 变差的原因跟 #1162 那次同族、而且是**这一族票要买的东西本身**：按 spec D19 从区块库里删块
  //      （#1372 删 4 个、本票删 logo 墙、#1376 还要并一个），候选池一小，能排出来的开场组合就少，
  //      四个行业在同一个序号上撞上的概率必然上升。它不是实现缺陷。
  //    · 🔴 「删块要不要付这个代价」是产品决定，已经由 Chris 在本票上拍过（2026-09-17：「不写搬家
  //      规则，直接删（并）…按 D19 继续，可以上线」），跟 #1162 / #1161 是同一个裁定框架。
  //    · 🔴 上面那句预测（「#1376 ship 时这个数还会再涨一次」）**被实测推翻了，上限不用挪**：
  //      PM 2026-09-17 在 #1375 + #1376 的合并形态上跑同一条命令，读到 **88**/1200 对
  //      （88/200 个序号）· 候选池 13 块 —— 比 #1375 单独那次的 107 **低**。方向不是单调的：
  //      候选池变小既减少可排的组合、也改变每个序号挑到谁，两个效应叠起来往哪走要量，不能推。
  //      所以 `MAX_COLLIDING_PAIRS` 在 #1376 落地时保持 107（留着余量），没有按那句预测改动。
  // 🔴 #1497 r2（2026-10-01）按同一句话把它从 107 挪到 118。读数（同一条命令，两棵树各跑一次；
  //    拆成两个变量是拿 `tryHomepageRecipe` 直接数的，口径同下面这一格）：
  //      改前 `origin/main 610e175e`：撞车 **84**/1200 对 · 候选池 13 块 · 写死的步长
  //      只拿掉 blog-preview（池 12）· 仍写死步长：**134** 对  ← 涨的是池子变小这一项
  //      改后 本票交付（池 12 · 步长按池长现算互质）：**118** 对  ← 互质步长反而压回 16 对
  //    · 同族、同一个裁定框架：两个博客块出池是本票正文做什么 6 写明的后果（「池子少一种，每个站号
  //      抽出来的配方会整体漂」），不是实现缺陷。
  // 🔴 #1497 r3（2026-10-01，在 #1487 team 落地后的 main 上重放）**上限不挪，仍是 118**。读数（同一条命令）：
  //      干净 `origin/main 9e3d2e787`：**99** 对（team 的 industries 空着，被 blog-preview 的行业标签遮住）
  //      本票重放、team 的 industries 仍空着：**303** 对  ← 两个博客块出池后，法律行业的候选只剩 faq-accordion
  //      本票交付（team 的 industries 逐字照抄 team-grid：dental / law / medical / salon）：**118** 对
  //    · 补标签是 PM 在本票上的裁定（走 A：「上限不许往上挪」），不是放宽尺子 —— 303 全部来自那一行空标签。
  //    · #1495 gallery 落地后在 `origin/main ec1ee5310` 上复量，三个数一个不差：99 / 303 / 118。
  const MAX_COLLIDING_PAIRS = 118;  // 2026-10-01 实测（r2 改前 84；r3 补 team 标签前 303）。1200 对里的对数。
  const SPAN = 200;                 // 序号 0…199，跟上面两个数同一个口径
  const openerAt = (i, ind) => tryHomepageRecipe(i, manifests, ind).recipe.opener.join('>');
  let collidingPairs = 0; let collidingIndices = 0;
  for (let i = 0; i < SPAN; i += 1) {
    let p = 0;
    for (let a = 0; a < NAMED.length; a += 1) {
      for (let b = a + 1; b < NAMED.length; b += 1) {
        if (openerAt(i, NAMED[a]) === openerAt(i, NAMED[b])) p += 1;
      }
    }
    if (p) collidingIndices += 1;
    collidingPairs += p;
  }
  const totalPairs = SPAN * (NAMED.length * (NAMED.length - 1)) / 2;
  collidingPairs <= MAX_COLLIDING_PAIRS
    ? ok(`撞车 ${collidingPairs}/${totalPairs} 对（${collidingIndices}/${SPAN} 个序号有撞车），`
      + `不超过实测上限 ${MAX_COLLIDING_PAIRS}`)
    : bad(`撞车 ${collidingPairs}/${totalPairs} 对（${collidingIndices}/${SPAN} 个序号），`
      + `超过实测上限 ${MAX_COLLIDING_PAIRS} —— 有东西又把候选池压窄了，量一次「改前/改后」再决定改这个数`);
  // 🔴 判别力：上限不许宽到「怎么都过」。用一个比实测数小一档的假上限跑同一个读数，它必须不通过。
  collidingPairs > Math.floor(MAX_COLLIDING_PAIRS / 2)
    ? ok(`尺子有判别力：把上限减半（${Math.floor(MAX_COLLIDING_PAIRS / 2)}）这一格就会红`)
    : bad(`这个上限太松：实测只有 ${collidingPairs} 对，减半的上限也过 ⟹ 它挡不住退步`);
  // `index=7` 那四个开场照旧打出来当例子（它是原来那一格抽查的那个序号）。
  for (const ind of NAMED) {
    // eslint-disable-next-line no-console
    console.log(`     index=${AT} ${ind}: ${openerAt(AT, ind).split('>').join(' > ')}`);
  }

  // (b) 🔴 认不出来的行业**逐字**回到今天的行为，而且不报错。`gallery` 是块名不是行业词，
  //     `zzz-unknown` 是正文 AC2 点名的那个 —— 两个都必须走这一支。
  const bare = poolFor(manifests).join('>');
  const unknowns = ['zzz-unknown', 'gallery', 'no-such-trade'];
  const moved = unknowns.filter((u) => poolFor(manifests, u).join('>') !== bare);
  moved.length
    ? bad(`认不出来的行业把池子的顺序改了:${moved.join(' · ')} —— AC2 的反向对照要求它退回今天的行为`)
    : ok(`认不出来的行业(${unknowns.join(' / ')})池子顺序逐字不动 = 改动之前的行为，且不抛`);
  // 判别力:这把尺必须**认得出**顺序真的变了 —— 不然上面那个绿可能是「poolFor 恒返回同一个东西」
  poolFor(manifests, 'plumbing').join('>') === bare
    ? bad('这把尺恒真:连 plumbing 都没改动顺序 ⟹ 上面那条读不出任何东西')
    : ok('尺子有判别力:plumbing 确实改了池子顺序，所以上面那条「不动」是真读数');

  // (c) 🔴 AC3 每个行业内的撞车率不许退步。判据用**整数种数**比，不用四舍五入的百分数
  //     (基线 100/33 = 3.0303…%，拿 3.03 去比会让基线自己都判红 —— 我第一版就是这么错的)。
  const distinct = (ind) => {
    const s = new Set();
    for (let i = 0; i < 500; i++) s.add(tryHomepageRecipe(i, manifests, ind).recipe.opener.join('>'));
    return s.size;
  };
  // 🔴 #1162：`base` 是**同一次跑里现算的**，所以本票把每个行业的种数从 33 压到 27 时它自己也
  //    跟着掉到 27 ⟹ 这一格按构造不会红。它问的是「有没有哪个行业比大盘更差」，不是「大盘退步了没」。
  //    大盘那一维见上面 (a) 那段注释里的两组读数。
  const base = distinct('');
  const worse = [...Object.keys(INDUSTRY_VOCABULARY), ...NAMED, 'zzz-unknown']
    .map((ind) => [ind, distinct(ind)]).filter(([, n]) => n < base);
  worse.length
    ? bad(`有 ${worse.length} 个行业的开场种数比基线 ${base} 少:${worse.map(([i, n]) => `${i}=${n}`).join(' · ')}`)
    : ok(`基线 ${base} 种;词表 ${Object.keys(INDUSTRY_VOCABULARY).length} 个行业 + 点名的 ${NAMED.length} 个 + 反向对照，没有一个少于基线`);
  // 为什么它按构造不会退步:池子大小一个都不变（重排不是过滤）
  const sizes = new Set([...Object.keys(INDUSTRY_VOCABULARY), '', 'zzz-unknown']
    .map((ind) => poolFor(manifests, ind).length));
  sizes.size === 1
    ? ok(`每个行业的池子都是 ${[...sizes][0]} 块 —— 重排没有筛掉任何块，这是上面那条的构造性理由`)
    : bad(`池子大小不一致:${[...sizes].join(' / ')} ⟹ 有行业被筛窄了，AC3 迟早退步`);

  // (d) `required: ["*"]` 不许参与排序 —— 它对「这个行业 vs 别的行业」一个字都没说
  const starOnly = [...manifests.values()].filter((m) => {
    const i = m.industries || {};
    return (i.required || []).includes('*') && !(i.required || []).some((w) => w !== '*')
      && !(i.recommended || []).length;
  });
  starOnly.length === 0
    ? ok('今天没有「只写 * 且没有别的正向词」的块 —— 这一格暂时问不出问题(夹具下面自造)')
    : (starOnly.every((m) => industryRank(m, 'plumbing') === 2)
      ? ok(`只写 * 的块(${starOnly.map((m) => m.type).join(' · ')})排名是 2 = 不参与行业排序`)
      : bad(`只写 * 的块参与了行业排序 —— contact-info 会对每个行业都跳到队首`));
  // 自造夹具:一个只写 `*` 的块，rank 必须是 2；一个写具体词的，必须是 0
  industryRank({ industries: { required: ['*'], recommended: [], discouraged: [] } }, 'plumbing') === 2
    ? ok('夹具:required=["*"] ⟹ rank 2(不参与)')
    : bad('夹具:required=["*"] 参与了排序');
  industryRank({ industries: { required: ['plumbing'], recommended: [], discouraged: [] } }, 'plumbing') === 0
    ? ok('夹具:required=["plumbing"] ⟹ rank 0(队首)')
    : bad('夹具:具体的 required 词没有把块提到队首');
  industryRank({ industries: { required: [], recommended: ['plumbing'], discouraged: [] } }, 'plumbing') === 1
    ? ok('夹具:recommended=["plumbing"] ⟹ rank 1(次席)')
    : bad('夹具:recommended 没有被读进排序');

  // (e) 差异说得出理由:每个点名行业被提到队首的块，都要能报出是哪个词命中的
  for (const ind of NAMED) {
    const front = poolFor(manifests, ind).filter((t) => industryRank(manifests.get(t), ind) < 2);
    const why = front.map((t) => {
      const i = manifests.get(t).industries || {};
      const w = [...(i.required || []).filter((x) => x !== '*'), ...(i.recommended || [])]
        .filter((x) => industryMatches(ind, x));
      return `${t}(${w.join(',')})`;
    });
    const keys = recogniseIndustry(ind);
    if (!keys.length && front.length) bad(`${ind} 认不出来却有块被提前 —— 那就不是"说得出理由"`);
    else ok(`${ind} → 词表认成 [${keys.join(',')}] · 提前的块:${why.join(' · ') || '（无，顺序不动）'}`);
  }
}

// ── ⑭ 抽步长跟池子长度互质（#1497 做什么 11 / AC14）─────────────────────────────────────────────────────
//    池子一增一减长度就变：写死的 STRIDES = [1, 5, 9, 13, 17] 在池子恰好是 13 时，第 4 抽位 `index * 13 % 13` 恒为 0，
//    跟站号无关（2000 个站号只剩 3 种、map-area 77%）。现在每次按长度现算互质的那个（§strideFor）。
console.log('── ⑭ 抽步长跟池子长度互质:池长 11–20 每个抽位都互质、第 4 抽位 ≥ 8 种;写死的那版在池 13 上塌');
{
  const { drawDistinct, strideFor, STRIDES, OFFSETS } = require('./homepage-recipe');
  const gcd = (a, b) => (b === 0 ? a : gcd(b, a % b));
  // 写死步长的那一版（#1497 之前的 drawDistinct 逐字）—— 反向对照用。
  const fixedDraw = (pool, index, k) => {
    const picked = [];
    for (let s = 0; s < k; s++) {
      const stride = STRIDES[s % STRIDES.length];
      const offset = OFFSETS[s % OFFSETS.length];
      let at = ((index * stride + offset) % pool.length + pool.length) % pool.length;
      let tries = 0;
      while (picked.includes(pool[at]) && tries < pool.length) { at = (at + 1) % pool.length; tries++; }
      picked.push(pool[at]);
    }
    return picked;
  };
  const slot4Kinds = (draw, len) => {
    const pool = Array.from({ length: len }, (_, i) => `b${i}`);
    const seen = new Set();
    for (let i = 0; i < 2000; i++) seen.add(draw(pool, i, 5)[3]);
    return seen.size;
  };
  const rows = [];
  let coprime = true; let enough = true;
  for (let len = 11; len <= 20; len++) {
    const strides = [0, 1, 2, 3, 4].map((s) => strideFor(s, len));
    if (!strides.every((st) => gcd(st, len) === 1)) coprime = false;
    const k = slot4Kinds(drawDistinct, len);
    if (k < 8) enough = false;
    rows.push(`池 ${len}: 步长 [${strides.join(',')}] · 第 4 抽位 ${k} 种（写死那版 ${slot4Kinds(fixedDraw, len)}）`);
  }
  for (const r of rows) console.log(`     ${r}`);
  coprime ? ok('池长 11–20：五个抽位实际用的步长都跟池长互质') : bad('有抽位的步长跟池长不互质');
  enough ? ok('池长 11–20：2000 个站号下第 4 抽位都 ≥ 8 种') : bad('有池长下第 4 抽位少于 8 种');
  // 真池子（种数现算：本票 r2 落在 main 之上时是 12 种 —— #1489 / #1496 先落了地）。
  const cnt = new Set(); let n = 0;
  for (let i = 0; i < 2000; i++) {
    const r = tryHomepageRecipe(i, manifests);
    if (!r.recipe) continue;
    const rec = r.recipe; n++;
    cnt.add([...rec.opener.slice(1), ...rec.mustInclude][3]);   // #1425（T3）：withBar 退役，开场恒以 hero 起头
  }
  const realLen = poolFor(manifests).length;
  cnt.size >= 8 ? ok(`真池子（${realLen} 种）第 4 抽位 ${cnt.size} 种 ≥ 8（${n} 个站号）`) : bad(`真池子（${realLen} 种）第 4 抽位只有 ${cnt.size} 种`);
  // 反向对照：写死的那版在池 13 上第 4 抽位 < 8（上面同一把尺子会红）。
  const fixed13 = slot4Kinds(fixedDraw, 13);
  fixed13 < 8 ? ok(`反向对照：写死的步长 ⟹ 池 13 第 4 抽位只剩 ${fixed13} 种 —— 判据分得开`) : bad(`反向对照没红：写死的步长在池 13 上也有 ${fixed13} 种`);
  // 池长 14（五个步长都互质）：新旧两版对 0–399 逐个相同 —— 互质的步长真的没动。
  const pool14 = Array.from({ length: 14 }, (_, i) => `b${i}`);
  let diff14 = 0;
  for (let i = 0; i < 400; i++) if (JSON.stringify(drawDistinct(pool14, i, 5)) !== JSON.stringify(fixedDraw(pool14, i, 5))) diff14++;
  diff14 === 0 ? ok('池长 14：新旧两版 drawDistinct 对 i = 0–399 逐个相同（互质的步长保持原值）') : bad(`池长 14：新旧两版有 ${diff14} 个站号不同`);
}

console.log(`\n逐条断言:PASS ${pass} · FAIL ${fail}`);
console.log(fail === 0 ? '✅ #1034 homepage-recipe: 全过' : '❌ #1034 homepage-recipe: 有失败');
process.exit(fail === 0 ? 0 : 1);
