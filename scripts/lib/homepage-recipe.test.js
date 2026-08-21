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
 * 🔴 「关掉之后跟改动之前逐字节相同」这一格比的是**两棵树**(基线那个 commit 的 scripts/ vs 这棵树的),
 *    不是「同一份代码传不同参数」。后者证不了任何事:改动之前那份代码根本没有这个参数。
 *
 * 🔴 基线是**钉死的一个 commit**(下面的 `BASELINE`),不是 `origin/main`。r2 之前写的是 origin/main,
 *    那是个会移动的东西:本票一合并进 main,main 那棵树自己就带上配方了(而且默认是开着的)
 *    ⟹ 「关掉 == main」当场变成假的,而这份测试从 r2 起在 CI 里跑
 *    (`.github/workflows/ci-cd.yml` 的 `template-scripts`) ⟹ **下一个改 templates 的人会收到一格假红**,
 *    红的原因跟他改的东西毫无关系。钉死的 commit 不会这样。
 *
 * 📌 代价说在明处:以后谁**有意**改这份提示词的字节,这一格会红。那时正确的动作是**在同一次改动里
 *    把 `BASELINE` 往前挪一格**,并在票上说一句 OFF 那条路的字节为什么变了 —— 而不是把这一格删掉。
 *    这一格问的就是「关掉之后是不是真的等于没这个功能」,基线一旦跟着当前代码走,它就什么都不问了。
 */

'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');
const { execFileSync, spawnSync } = require('child_process');
const crypto = require('crypto');

const DIR = __dirname;                                   // …/templates/nextjs/scripts/lib
const NEXT = path.resolve(DIR, '..', '..');              // …/templates/nextjs
const REPO = execFileSync('git', ['rev-parse', '--show-toplevel'], { cwd: NEXT }).toString().trim();
const REL = 'templates/nextjs';
// 「改动之前」= 本票开工时的那个 commit(#1034 的 base)。理由和维护约定见文件头最后两条。
const BASELINE = 'd882d5de';

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

// ── 造一棵「某个版本的 scripts/」的树 ───────────────────────────────────────────────────────────
// blocks/ 和 node_modules 用软链(两个版本读的是同一份块清单 —— 本票没有改 blocks/,
// 要是把它也换成基线那个 commit 的那份,这一格就同时在量两件事)。
function treeAt(ref, tmp) {
  const root = path.join(tmp, ref === null ? 'work' : 'base');
  fs.mkdirSync(root, { recursive: true });
  if (ref === null) {
    execFileSync('cp', ['-a', path.join(NEXT, 'scripts'), root]);
  } else {
    const files = execFileSync('git', ['ls-tree', '-r', '--name-only', ref, '--', `${REL}/scripts`],
      { cwd: REPO }).toString().trim().split('\n').filter(Boolean);
    if (!files.length) die(`${ref} 上没有 ${REL}/scripts —— ls-tree 读到 0 个文件`);
    for (const f of files) {
      const out = path.join(root, f.slice(REL.length + 1));
      fs.mkdirSync(path.dirname(out), { recursive: true });
      fs.writeFileSync(out, execFileSync('git', ['show', `${ref}:${f}`], { cwd: REPO, maxBuffer: 64 << 20 }));
    }
  }
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
  companyName: 'Bright Smile Dental',
  industry: 'dental clinic',
  location: 'Toronto, ON',
  services: ['Teeth Cleaning', 'Whitening', 'Invisalign', 'Implants', 'Root Canal', 'Emergency Dental'],
  language: 'en',
  themeRotationIndex: 0,
  // 🔴 #1134（来源 #1139）—— 这份夹具是**一个有关键词页的站**。它是承重的:#1134 让提示词里
  //    `service-related-pages` 那两句只在有子页的站上发(那个块在没有子页的站上恒 `return null`),
  //    所以「有没有关键词」现在会改变提示词的字节。⑥ 那格比的是「关掉配方 ⟹ 跟基线那棵树逐字节
  //    相同」,基线那棵树不认 `hasKeywordPages` ⟹ 两臂必须落在**同一个**关键词状态上,否则那一格
  //    会因为一件跟配方无关的事而红。另一半状态由 ⑧ 单独钉(见下面)。
  keywords: { 'Teeth Cleaning': [{ keyword: 'teeth cleaning toronto', selected: true, volume: 320 }] },
  ...over,
});

// ── 被测模块 ────────────────────────────────────────────────────────────────────────────────────
const { homepageRecipe, tryHomepageRecipe, recipeProblems, recipePromptLines, fingerprintEnabled,
  afterRetry, poolFor, industryRank, rotate, NOT_IN_POOL, BAR_EVERY } = require('./homepage-recipe');
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

  // 前 2 块:带 announcement-bar 的那些互相是相同的(有意的,1/4 的站才带),其余必须各不相同
  const first2 = openers.map((o) => o.split('|').slice(0, 2).join('|'));
  const bars = first2.filter((x) => x.startsWith('announcement-bar'));
  const rest = first2.filter((x) => !x.startsWith('announcement-bar'));
  new Set(rest).size === rest.length
    ? ok(`不带 announcement-bar 的 ${rest.length} 个站前 2 块互不相同`)
    : bad(`不带 bar 的站里前 2 块有重复: ${rest.join(' · ')}`);
  bars.length === 2
    ? ok(`8 个站里 2 个带 announcement-bar（BAR_EVERY=4）—— 今天真站是 6/6 都带`)
    : bad(`带 bar 的站数是 ${bars.length}，期望 2`);
}

// ── ② 池子:排除名单在,而且改名会当场炸 ─────────────────────────────────────────────────────────
console.log('── ② 配方池:该排除的排除了;有人把块改名时不许静默放回');
{
  const pool = poolFor(manifests);
  const leaked = Object.keys(NOT_IN_POOL).filter((t) => pool.includes(t));
  leaked.length === 0 ? ok(`排除名单里的 ${Object.keys(NOT_IN_POOL).length} 个块一个都没进池子（池子 ${pool.length} 种）`)
    : bad(`这些不该在池子里: ${leaked.join(', ')}`);

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
  const oneLess = plain.split('\n').filter((l) => !/^- "trusted-brands"/.test(l)).join('\n');
  a.length === 28 && typesIn(oneLess).length === 27 && !typesIn(oneLess).includes('trusted-brands')
    ? ok(`取块名这把尺子有判别力:完整清单读到 28 种,手工拿掉 trusted-brands 之后读到 27 种`)
    : bad(`取块名这把尺子坏了:完整 ${a.length} 种 / 拿掉一块之后 ${typesIn(oneLess).length} 种`);

  JSON.stringify([...a].sort()) === JSON.stringify([...b].sort())
    ? ok(`块集合一样（各 ${a.length} 种）`)
    : bad(`块集合变了:只在原顺序里 ${a.filter((x) => !b.includes(x))} / 只在新顺序里 ${b.filter((x) => !a.includes(x))}`);
  JSON.stringify(a) !== JSON.stringify(b) ? ok(`顺序确实变了（${a[0]} … → ${b[0]} …）`)
    : bad('换了 order 之后块的顺序一模一样 —— 这一层没生效');
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
  const good = [{ slug: 'home', sections: [...r.opener, ...r.mustInclude, 'cta-banner'].map((t) => ({ type: t })) }];
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
    { slug: 'about', sections: [{ type: 'cta-banner' }, { type: 'divider' }] },
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

// ── ⑥⑦ 提示词:关掉 = 跟基线那个 commit 逐字节相同;开着 = 只在两个地方不同 ────────────────────
console.log(`── ⑥ 关掉之后,整份提示词跟基线那棵树(${BASELINE})逐字节相同`);
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'recipe-test-'));
let promptOff = ''; let promptBase = '';
try {
  const baseRoot = treeAt(BASELINE, tmp);
  const workRoot = treeAt(null, tmp);
  promptBase = promptFrom(baseRoot, basePayload());
  promptOff = promptFrom(workRoot, basePayload({ homepageFingerprint: false }));
  promptBase === promptOff
    ? ok(`逐字节相同（md5 ${md5(promptBase)} · ${promptBase.length} 字节）`)
    : bad(`不一样:基线 md5 ${md5(promptBase)} (${promptBase.length}B) vs 关掉 ${md5(promptOff)} (${promptOff.length}B)`);

  console.log('── ⑦ 开着的时候,变的只有【候选清单的顺序】和【那一行举例名单】');
  const promptOn = promptFrom(workRoot, basePayload());
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
  const exampleLine = '- Include at least TWO sections that most sites wouldn\'t have (e.g., content-split,';
  promptOff.includes(exampleLine) && !promptOn.includes(exampleLine)
    ? ok('举例名单那一行:关着在、开着被硬要求取代（它正是 6 个真站选中的那批块）')
    : bad(`举例名单那一行的在/不在判错了(关着 ${promptOff.includes(exampleLine)} / 开着 ${promptOn.includes(exampleLine)})`);

  // 块集合不变:两份提示词的 homepage 清单里出现的块名逐个相同（顺序可以不同）
  const homeSeg = (s) => s.slice(s.indexOf('HOMEPAGE SECTIONS'), s.indexOf('PAGE-SPECIFIC SECTION RULES'));
  const onTypes = typesIn(homeSeg(promptOn)); const offTypes = typesIn(homeSeg(promptOff));
  onTypes.length === 28 && offTypes.length === 28
    ? ok('两份提示词里各读到 28 种块（尺子在真提示词上也读得到数，不是恒 0/恒 1）')
    : bad(`读到的块数不对:开着 ${onTypes.length} / 关着 ${offTypes.length}，期望各 28`);
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

  // ── ⑧b #1134（来源 #1139；r2 按 QA2 的真机读数扩了射程）—— `service-related-pages` 只在会有子页的站上发 ──
  //
  // 那个块是候选块里唯一有 `return null` 的（`ServiceRelatedPagesSection.tsx`）：它只在那个服务
  // 底下**真有子页**时才渲染，而子页只由关键词矩阵产生（`nestedSlug = <服务>/<关键词>`）。
  // #1139 实测 66 个互异站：221 个实例只有 14 个渲染出卡片，56 个带它的站里 48 个一张卡都没有；
  // 生产库那个唯一的第三方客户站 6 个实例全空。用户看不见（渲染成 null，页面不留空框），所以这是
  // 提示词的准确性问题，不是缺陷 —— 但让 AI 去加一个注定为空的块，本身也在挤掉真正该在那里的块。
  // 🔴 两向都判。只判「没关键词时不发」的话，一个把那两句**整个删掉**的改动也会绿。
  //
  // 🔴 r2 扩的那一半（QA2 在 r1 上量到的）：只把那三句散文改成有条件的**不够** —— 交付版提示词
  //    确实少了那三句（−237 字节），而**站建出来一点没变**：3 个互异 siteId × 6 个服务详情页
  //    = 18/18 照旧带那个块，与基线那次 6/6 逐个相同。真因是**清单**那一条自己就在说「加它」：
  //    `blocks/service-related-pages.json` 的 `headExtra` 是 `Use ONLY on service detail pages`，
  //    它的 `lines` 里还有 `safe to include on all service detail pages` ⟹ 模型照做。
  //    所以 r2 让清单那一条也让开（`promptSection` 的 `omit`），本格的针也跟着从「两句散文」
  //    扩到「清单那一条的每一行」。
  // 🔴 针**不写死**：清单那几行从 manifest 现算（开着的那份 minus 关掉的那份），否则这里就是
  //    manifest 的第二份抄本，而两份抄本必然分叉 —— 分叉的方向是这一格静默地不再判清单那一条。
  // 📌 这一格的边界写在这里，别把它读成更强的东西：它量的是**提示词字节**。「模型收到这份提示词
  //    之后到底加不加」只有真 AI build 量得到（QA2 那四跑），本格对那一维按构造是盲的。
  console.log('── ⑧b service-related-pages：有关键词页才发，没有就不发（散文三句 + 清单那一条）');
  {
    const bm = require('./block-manifest');
    const listOn = bm.promptSection('homepage').split('\n');
    const listOff = bm.promptSection('homepage', undefined, { omit: ['service-related-pages'] }).split('\n');
    const LIST_LINES = listOn.filter((l) => !listOff.includes(l));
    const PROSE = [
      'service-related-pages data: { serviceSlug:',
      'Include a "service-related-pages" section on each service detail page',
    ];
    // 分母自检：清单那一条现算不出来（改名/搬家/omit 坏了）时，下面的针会变空 ⟹ 空绿。
    LIST_LINES.length > 0 && LIST_LINES.some((l) => /^- "service-related-pages"/.test(l))
      ? ok(`清单那一条现算出 ${LIST_LINES.length} 行（omit 拿掉的正好是它自己那几行）`)
      : bad('从 manifest 现算不出 service-related-pages 那一条 —— 下面的针会是空的，这一格不许当成过');
    const NEEDLES = [...PROSE, ...LIST_LINES];
    const withKw = promptFrom(workRoot, basePayload());                       // 夹具自带关键词
    const noKw = promptFrom(workRoot, basePayload({ keywords: {} }));
    const inWith = NEEDLES.filter((n) => withKw.includes(n));
    const inNo = NEEDLES.filter((n) => noKw.includes(n));
    inWith.length === NEEDLES.length
      ? ok(`有关键词页的站：那 ${NEEDLES.length} 处都在（散文 ${PROSE.length} + 清单 ${LIST_LINES.length}；`
        + '这一半是阳性对照 —— 少了它「不发」那格就成了空绿）')
      : bad(`有关键词页的站却少了这几处：${NEEDLES.filter((n) => !withKw.includes(n)).join(' | ')}`);
    inNo.length === 0
      ? ok('没有关键词页的站：散文和清单里一处都不发 ⟹ AI 不会从任何一头被要求加那个注定 return null 的块')
      : bad(`没有关键词页的站仍然被要求加那个块：${inNo.join(' | ')}`);
    // 第三条：除了那个块自己的行，两份提示词不该有别的差别（否则这一格量到的是别的东西）
    const diffLines = withKw.split('\n').filter((l) => !noKw.split('\n').includes(l));
    const foreign = diffLines.filter((l) => !/service-related-pages/.test(l) && !LIST_LINES.includes(l));
    foreign.length === 0
      ? ok(`两份提示词的差别只在那个块自己的行（${diffLines.length} 行：点名它的 `
        + `${diffLines.filter((l) => /service-related-pages/.test(l)).length} 行 + 清单续行 `
        + `${diffLines.filter((l) => !/service-related-pages/.test(l)).length} 行）`)
      : bad(`两份提示词还有别的差别，这一格量的不只是那个块：${foreign.slice(0, 3).join(' ⏎ ')}`);
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
  new Set(openers).size >= 2 && !openers.includes(under_r1)
    ? ok(`8 个站主各自的第一个站落在 ${new Set(openers).size} 份不同的配方上（r1 下是 1 份，而且没有一个站落回那一份）`)
    : bad(`差异源没换干净:${new Set(openers).size} 份配方，含 r1 那一份: ${openers.includes(under_r1)}`);

  // 🔴 上面那 8 个 id 是**一个样本**，不是判据 —— 换一批 id 数字就会变（这次 8 个里有一对撞了，
  //    真实分布本来就会撞）。判据要落在**配方一共有几种**上，那个数是可枚举的:
  //      开场只由 `index % (池子 × BAR_EVERY)` 决定 ⟹ 枚举那么多个索引就看得见全部。
  const pool = poolFor(manifests, 'dental clinic');
  const PERIOD = pool.length * BAR_EVERY;               // 池子 22 × BAR_EVERY 4 = 88:开场按这个数循环
  const all = [];
  for (let i = 0; i < PERIOD; i++) all.push(homepageRecipe(i, manifests, 'dental clinic').opener);
  const repeat = [];
  for (let i = 0; i < PERIOD; i++) repeat.push(homepageRecipe(i + PERIOD, manifests, 'dental clinic').opener);
  JSON.stringify(all) === JSON.stringify(repeat)
    ? ok(`配方按 index % ${PERIOD} 循环（枚举 ${PERIOD} 个 + 再枚举 ${PERIOD} 个，逐个相同）`)
    : bad(`配方的周期不是 ${PERIOD} —— 下面那几个概率全是错的`);
  const distinct = new Set(all.map((o) => o.join('|'))).size;
  console.log(`     ${PERIOD} 个索引给出 ${distinct} 种不同的开场`
    + `（少于 ${PERIOD} 是因为带 announcement-bar 的那 1/4 只用得上开场的后 2 格）`);

  // 🔴 这才是能跟 AC 门槛对话的读数:假设 siteId 的哈希在 44 个类上均匀，随机两个站的
  //    「前 N 块完全相同」就是 Σ(每个前缀出现的概率)²。算给三个前缀，逐个对 AC2 的门槛。
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
  const renamed = new Map([...manifests.entries()].filter(([k]) => k !== 'cta-banner'));
  const attempt = tryHomepageRecipe(7, renamed, 'dental clinic');
  attempt.recipe === null && attempt.error && /cta-banner/.test(attempt.error.message)
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

  // (a) 点名的四个行业，在同一个序号上两两都不相同
  const openerOf = (ind) => tryHomepageRecipe(AT, manifests, ind).recipe.opener.join('>');
  const collisions = [];
  for (let a = 0; a < NAMED.length; a++) {
    for (let b = a + 1; b < NAMED.length; b++) {
      if (openerOf(NAMED[a]) === openerOf(NAMED[b])) collisions.push(`${NAMED[a]} == ${NAMED[b]}`);
    }
  }
  collisions.length
    ? bad(`点名的行业里有 ${collisions.length} 对拿到相同开场:${collisions.join(' · ')}`)
    : ok(`${NAMED.join(' / ')} 在 index=${AT} 上两两都不相同`);

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

console.log(`\n逐条断言:PASS ${pass} · FAIL ${fail}`);
console.log(fail === 0 ? '✅ #1034 homepage-recipe: 全过' : '❌ #1034 homepage-recipe: 有失败');
process.exit(fail === 0 ? 0 : 1);
