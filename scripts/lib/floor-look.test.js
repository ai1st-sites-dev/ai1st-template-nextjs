#!/usr/bin/env node
/**
 * floor-look.test.js — 「这个站会不会长成地板样」那道守卫的机械检查。（#1198）
 *
 * 跑法:  node scripts/lib/floor-look.test.js      （`npm run test:scripts` 会自动发现它）
 * 退出码: 0 全过 · 1 有失败 · 2 跑不起来（**不许当成通过**）
 *
 * 🔴 夹具是**真的**：阳性那一格用的是 2026-08-25 `site-194f1f41`（真付费客户）线上产物那份
 *    982 字节的 theme.css 的形状 —— 逐字从 `curl https://site-194f1f41.ai1stsite.io/theme.css`
 *    取的三行；阴性那一格直接读仓里真的主题表，不是手写一段 CSS。本仓为「合成夹具全绿、真实数据
 *    当场红」付过账。
 *
 * 🔴 三条子句各有一条单变量反向臂（②③④）。少了它们，这道守卫可能是恒红或恒绿，而两种都长得像
 *    「阳性通过了」。
 */

'use strict';

const fs = require('fs');
const path = require('path');
const { blockTypesStyledBy, assessFloorLook, FLOOR_LOOK_MARKER } = require('./floor-look.js');

let failed = 0;
const ok = (m) => console.log(`  ✅ ${m}`);
const bad = (m) => { failed += 1; console.log(`  ❌ ${m}`); };

const ROOT = path.resolve(__dirname, '..', '..');
const ALL = Object.keys(require(path.join(ROOT, 'src/lib/sections/block-roles.json')));

/** `site-194f1f41` 线上那份 theme.css 的三行（token，零画法）。 */
const TOKENS_ONLY = [
  '@import url("https://fonts.googleapis.com/css2?family=Cormorant+Garamond:wght@400;500;600;700&family=Noto+Serif+SC:wght@300;400;500;600;700&display=swap");',
  ':root { --color-primary-500: #7c6a47; --color-accent-500: #a8852e; --font-sans: Noto Serif SC, Georgia, serif; }',
  ':root { --btn-primary-bg: var(--color-primary-500); --btn-primary-ink: #ffffff; }',
].join('\n');

/**
 * 那个站首页真的摆着的块 —— 2026-08-25 从生产容器里那份 `site/zh/pages/home.json` 逐字取的
 * **完整**类型集合（`docker exec -w /app/repo site-194f1f41 cat site/zh/pages/home.json`），
 * 不是手挑的代表。挑代表在这一格是危险的：这道守卫要判的正是「这个站的块**一个都没有**画法」，
 * 而子集在「全部没有」这一维上给出同一个读数。
 */
const ON_SITE = ['announcement-bar', 'hero', 'trusted-brands', 'stats-counter', 'content-split',
  'features-grid', 'divider', 'process-steps', 'testimonials', 'cta-banner'];

const sheets = fs.existsSync(path.join(ROOT, 'public/themes'))
  ? fs.readdirSync(path.join(ROOT, 'public/themes')).filter((f) => f.endsWith('.css'))
  : [];
if (!sheets.length) {
  console.error('🔴 public/themes 里一张主题表都没有 —— 阴性对照造不出来，这次什么都没验证（exit 2）');
  process.exit(2);
}
if (ALL.length === 0) {
  console.error('🔴 block-roles.json 读出零个块类型 —— 尺子坏了，这次什么都没验证（exit 2）');
  process.exit(2);
}
const REAL_SHEET = fs.readFileSync(path.join(ROOT, 'public/themes', sheets[0]), 'utf-8');

console.log('① 阳性：真客户线上那份 token-only theme.css + 非空站块 ⟹ 必须判成地板样');
{
  const v = assessFloorLook({ themeCss: TOKENS_ONLY, blockTypesOnSite: ON_SITE, allBlockTypes: ALL, hasFloor: true });
  v.floor ? ok('判成地板样') : bad('没判成地板样 —— 守卫看不见它要守的那个东西');
  v.styledCount === 0 ? ok('这份 theme.css 给出画法的块类型数 = 0') : bad(`styledCount = ${v.styledCount}，夹具不是 token-only`);
  v.unstyled.length === ON_SITE.length
    ? ok(`点名了这个站全部 ${ON_SITE.length} 种块`)
    : bad(`只点名了 ${v.unstyled.length}/${ON_SITE.length} 种`);
}

console.log('② 反向对照（单变量：换成真的主题表）：同一个站、同一批块 ⟹ 必须【不】响');
{
  const v = assessFloorLook({ themeCss: REAL_SHEET, blockTypesOnSite: ON_SITE, allBlockTypes: ALL, hasFloor: true });
  v.floor ? bad(`${sheets[0]} 也被判成地板样 —— 这道守卫是恒红的`) : ok(`${sheets[0]} 不响`);
  // 🔴 而且要证明它**真的**给这个站的块写了画法，不是靠别的子句短路才不响的。
  const styled = blockTypesStyledBy(REAL_SHEET, ALL);
  ON_SITE.every((t) => styled.has(t))
    ? ok(`它给这个站 ${ON_SITE.length} 种块全写了画法`)
    : bad(`它漏了：${ON_SITE.filter((t) => !styled.has(t)).join(' ')}`);
}

console.log('③ 反向对照（单变量：站上一个 moved 块都没有）⟹ 必须【不】响');
{
  const v = assessFloorLook({ themeCss: TOKENS_ONLY, blockTypesOnSite: [], allBlockTypes: ALL, hasFloor: true });
  v.floor ? bad('空块集也响 —— 恒红') : ok('空块集不响');
}

console.log('④ 反向对照（单变量：没有 base.css 那层地板）⟹ 必须【不】响');
{
  const v = assessFloorLook({ themeCss: TOKENS_ONLY, blockTypesOnSite: ON_SITE, allBlockTypes: ALL, hasFloor: false });
  v.floor ? bad('没有地板也说「会长成地板样」') : ok('没有地板时不响');
}

console.log('⑤ 尺子本身：主题表的顶层类根集合就是块名 —— 逐份现测，不抄任何写死的数');
{
  let full = 0;
  for (const f of sheets) {
    const styled = blockTypesStyledBy(fs.readFileSync(path.join(ROOT, 'public/themes', f), 'utf-8'), ALL);
    if (styled.size === ALL.length) full += 1;
  }
  full === sheets.length
    ? ok(`${sheets.length}/${sheets.length} 份主题表各自覆盖全部 ${ALL.length} 种块`)
    : bad(`只有 ${full}/${sheets.length} 份覆盖全部 ${ALL.length} 种 —— 尺子或主题池有一边变了，先弄清哪边`);
}

console.log('⑥ 标记那个字面值：`worker/main.go` 按它报警，两处必须一字不差');
{
  const goSrc = path.join(ROOT, '..', '..', 'worker', 'main.go');
  if (!fs.existsSync(goSrc)) {
    // 站自己的仓里没有 worker/ —— 那不是失败，是这一格在那里无从判定。
    ok('（这棵树里没有 worker/main.go，这一格跳过）');
  } else {
    fs.readFileSync(goSrc, 'utf-8').includes(`"${FLOOR_LOOK_MARKER}"`)
      ? ok('worker/main.go 里的 floorLookMarker 与这里逐字相同')
      : bad('worker/main.go 找不到这个字面值 —— 报警那一跳已经聋了');
  }
}

console.log(failed === 0 ? '\n✅ 全过' : `\n❌ ${failed} 处失败`);
process.exit(failed === 0 ? 0 : 1);
