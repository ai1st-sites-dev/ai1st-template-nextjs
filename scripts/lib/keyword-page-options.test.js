#!/usr/bin/env node
/**
 * keyword-page-options.test.js — #1346：关键词页那一通的块清单。
 *
 *   node scripts/lib/keyword-page-options.test.js     （CI 里由 `npm run test:scripts` 自动发现）
 *   退出码: 0 全过 · 1 有失败 · 2 跑不起来（**不许当成通过**）
 *
 * 🔴 ① 是这个文件存在的全部理由：这段清单本来是 `create-site.js` 里写死的五条散文，改成生成之后
 *    「什么都没关掉」那条路必须**逐字节**回到原文。判据不是人眼，是把 `origin/main` 上那段原文
 *    切出来比 —— 提示词的字节一变，AI 吐的东西就会变，而那是花钱才能测的东西。
 */

'use strict';

const path = require('path');
const { execFileSync } = require('child_process');

let pass = 0; let fail = 0;
const ok = (m) => { pass++; console.log(`  ✅ ${m}`); };
const bad = (m) => { fail++; console.log(`  ❌ ${m}`); };
const die = (m) => { console.error(`🔴 跑不起来: ${m}`); process.exit(2); };

const { keywordPageSectionOptions } = require('./keyword-page-options');
if (typeof keywordPageSectionOptions !== 'function') die('keyword-page-options.js 没导出 keywordPageSectionOptions');

const REPO = path.resolve(__dirname, '..', '..', '..', '..');
const REL = 'templates/nextjs/scripts/create-site.js';
// 🔴 【钉死的一个 commit，不是 `origin/main`】——#1379 hotfix，2026-09-16。
// 写 `origin/main` 时这一格【在本票自己落地的那一刻必红】：基线取的就是改完的那份字节，而本票改的
// 正是下面要切的那个三元表达式 ⟹ 正则切不出来 ⟹ `die()` rc=2。实测：#1346 ship (`b819f59c`) 那一轮
// CI 的 `template-scripts` 当场 failure、`sync-template` 因此 skipped —— 模板侧字节没能到 test/dev。
// ship 之前每一次本地跑都是绿的，因为那时 `origin/main` 还指着改动【之前】的字节：**这把尺当时指着的
// 是它自己要防的那件事的反面**。
// 兄弟文件 `catalog-disabled.test.js` 的头注早就为同一件事写过明文规矩（#1034 r2 起，理由逐字是
// 「下一个改 templates 的人会收到跟他无关的红」），#1346 那批只改了那一份，漏了这一份。
// **维护约定**：这一格哪天真的对不上了，先问「那段散文为什么变了」；确实该变，就把 `BASELINE` 往前
// 挪一格**并在票上说明**，而不是改回一个会动的 ref。
const BASELINE = '9d056fd7';

/** 从某个 commit 上的 create-site.js 里切出那段写死的清单（不含 `EACH PAGE MUST…` 那一行）。 */
function baselineMenu(hasServiceDetailPages) {
  let src;
  try {
    src = execFileSync('git', ['show', `${BASELINE}:${REL}`], { cwd: REPO, maxBuffer: 64 << 20 }).toString();
  } catch (e) {
    return null; // 取不到基线（浅 clone / 没 fetch）——下面按「这一格没读数」处理，不报 PASS
  }
  const head = 'EACH PAGE MUST have 4-6 sections from these options:\n';
  const at = src.indexOf(head);
  if (at < 0) die(`${BASELINE} 上的 create-site.js 里找不到 "${head.trim()}" —— 这个测试在读错东西`);
  const rest = src.slice(at + head.length);
  const end = rest.indexOf('\nReturn a JSON ARRAY of page objects:');
  if (end < 0) die(`${BASELINE} 上那段清单后面找不到 "Return a JSON ARRAY" —— 切不出边界`);
  // 基线那段是模板字符串的一部分，面包屑那一格是个三元表达式。这里按它两个分支的字面量各自代入，
  // 做的是跟 §keywordPageSectionOptions 一模一样的代入，所以比的是【印出来的字节】。
  const withDetail = '[{label:"Home", href:"/"}, {label:"<Service>", href:"<the breadcrumb middle level given for THIS page above — omit the href field entirely when it says NO LINK>"}, {label:"<Page Title>"}]';
  const without = '[{label:"Home", href:"/"}, {label:"<Page Title>"}]  ← EXACTLY TWO LEVELS. This site has no service detail pages, so there is no middle level to link to. Do NOT invent one.';
  const ternary = rest.slice(0, end).match(/\$\{Object\.keys\(serviceDetailMap\)\.length > 0\n[\s\S]*?\n {5}: `[\s\S]*?`\}/);
  if (!ternary) die('基线那段里的面包屑三元表达式切不出来 —— 形状变了，先读它再改这个测试');
  // 🔴 末尾那一个换行不算进来：基线那段和后面的 `Return a JSON ARRAY` 之间隔着一个空行，
  //    `end` 指的是那两个换行里的第二个 ⟹ 切出来的尾巴带着第一个。生成的这一份不带尾换行
  //    （插进模板时后面紧跟着 `\n`），两边要比的是同一个东西。
  const cut = rest.slice(0, end).replace(/\n$/, '');
  return cut.replace(ternary[0], hasServiceDetailPages ? withDetail : without);
}

// 🔴 #1419 有意改了这段字节：AI 不再挑形态，每条的形态清单（`— variants: …` / 单独一行的
//    `<块> variants: …` / card-group 那句「没有形态」）和 `data` 里的 `variant` 字段都删了；
//    card-group / process-steps 那两行 data 前面各补上块名（它们原来靠上一行的形态清单认块，
//    那一行没了就分不清哪行 data 是谁的）。BASELINE 不能挪到本票自己（一个 commit 的 sha 写不进
//    它自己的树），所以照 `homepage-recipe.test.js` ⑥ 的做法逐条登记，并配两格判别力。
const DELTAS = [
  {
    why: '#1419 card-group 那句「没有形态」和 process-steps 那行形态清单整行删掉',
    apply: (t) => t.split('\n').filter((l) => !/^ {3}(card-group has NO variants|process-steps variants: )/.test(l)).join('\n'),
  },
  {
    why: '#1419 编号那行尾巴上的 `— variants: …` 删掉',
    apply: (t) => t.replace(/ — variants: [^\n]*/g, ''),
  },
  {
    why: '#1419 data 里的 `variant` 字段删掉',
    apply: (t) => t.replace(/, variant(?= \}|,)/g, ''),
  },
  {
    why: '#1419 card-group / process-steps 那两行 data 前面补块名',
    apply: (t) => t
      .replace('\n   data: { headline, subheadline?, items: [{title, description?, features?: [string]}] }',
        '\n   card-group data: { headline, subheadline?, items: [{title, description?, features?: [string]}] }')
      .replace(/\n {3}data: \{ headline, steps: \[\{title, description\}\](, variant)? \}/,
        '\n   process-steps data: { headline, steps: [{title, description}] }'),
  },
];

console.log('\n── ① 什么都没关掉 ⟹ 跟基线那段写死的散文（套上登记的差异）逐字节相同 ──');
{
  let measured = 0;
  for (const hasDetail of [true, false]) {
    const base = baselineMenu(hasDetail);
    if (base === null) { console.log(`  ⚠️  取不到 ${BASELINE} 上的 create-site.js —— 这一格没有读数（不是通过）`); break; }
    measured++;
    const got = keywordPageSectionOptions({ hasServiceDetailPages: hasDetail, disabledBlocks: [] });
    const patched = DELTAS.reduce((acc, d) => d.apply(acc), base);
    if (got === patched) {
      ok(`hasServiceDetailPages=${hasDetail}：${got.length} 字节，套上 ${DELTAS.length} 条差异后逐字节相同`);
    } else {
      bad(`hasServiceDetailPages=${hasDetail}：不一样\n--- 基线+差异 ---\n${patched}\n--- 现在 ---\n${got}`);
    }
    // 判别力①：一条都不套就对不上 ⟹ 上面那格不是恒真
    base !== got ? ok(`判别力①（${hasDetail}）：一条差异都不套就对不上`)
      : bad(`判别力①（${hasDetail}）：一条都不套也相同 ⟹ 差异表是死的`);
    // 判别力②：每一条单独套在基线上都真的改变它（没有死条目）
    const dead = DELTAS.filter((d) => d.apply(base) === base);
    dead.length === 0 ? ok(`判别力②（${hasDetail}）：${DELTAS.length} 条差异每一条都改变了基线`)
      : bad(`判别力②（${hasDetail}）：${dead.length} 条对基线什么都没做：${dead.map((d) => d.why).join(' · ')}`);
  }
  if (measured === 0) bad(`① 一个读数都没取到（拿不到 ${BASELINE}）—— 这一格不报 PASS`);
}

console.log('\n── ② 关掉一个块 ⟹ 它整条消失，编号重排 ──');
const full = keywordPageSectionOptions({ hasServiceDetailPages: true });
{
  const got = keywordPageSectionOptions({ hasServiceDetailPages: true, disabledBlocks: ['faq-accordion'] });
  !got.includes('faq-accordion')
    ? ok('关掉 faq-accordion ⟹ 清单里 0 命中')
    : bad('关掉 faq-accordion，清单里还有它');
  full.includes('faq-accordion')
    ? ok('反向臂：不关的时候它在清单里 ⟹ 上一格不是恒真')
    : bad('反向臂失败：不关也没有它');
  const nums = [...got.matchAll(/^(\d+)\. /gm)].map((m) => Number(m[1]));
  JSON.stringify(nums) === JSON.stringify(nums.map((_, i) => i + 1))
    ? ok(`编号连续无空号：${nums.join(' ')}`)
    : bad(`编号有空号：${nums.join(' ')} —— 留一个空号等于告诉模型「这里本来有个东西」`);
}

console.log('\n── ③ 「A OR B」那一格：只剩一个时不许再写 OR ──');
{
  const got = keywordPageSectionOptions({ hasServiceDetailPages: true, disabledBlocks: ['card-group'] });
  !got.includes('card-group') && got.includes('"process-steps" (use it on every page)')
    ? ok('关掉 card-group ⟹ 那一格写成「process-steps，每页都用」，card-group 0 命中')
    : bad(`关掉 card-group 之后那一格不对：\n${got}`);
  const both = keywordPageSectionOptions({ hasServiceDetailPages: true, disabledBlocks: ['card-group', 'process-steps'] });
  !both.includes('card-group') && !both.includes('process-steps')
    ? ok('两个都关掉 ⟹ 那一条整条消失')
    : bad(`两个都关掉之后还留着：\n${both}`);
  const nums = [...both.matchAll(/^(\d+)\. /gm)].map((m) => Number(m[1]));
  nums.length === 4 && nums[nums.length - 1] === 4
    ? ok('剩下 4 条，编号 1..4')
    : bad(`剩下的编号是 ${nums.join(' ')}`);
  full.includes('"card-group" OR "process-steps"')
    ? ok('反向臂：两个都在时那句 OR 原样还在')
    : bad('反向臂失败：不关的时候也没有那句 OR');
}

console.log(`\n${fail ? '❌' : '✅'} ${pass} 过 / ${fail} 失败`);
process.exit(fail ? 1 : 0);
