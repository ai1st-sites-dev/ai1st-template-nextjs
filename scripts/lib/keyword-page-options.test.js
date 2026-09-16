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
const BASELINE = 'origin/main';

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

console.log('\n── ① 什么都没关掉 ⟹ 跟 origin/main 那段写死的散文逐字节相同 ──');
{
  let measured = 0;
  for (const hasDetail of [true, false]) {
    const base = baselineMenu(hasDetail);
    if (base === null) { console.log(`  ⚠️  取不到 ${BASELINE} 上的 create-site.js —— 这一格没有读数（不是通过）`); break; }
    measured++;
    const got = keywordPageSectionOptions({ hasServiceDetailPages: hasDetail, disabledBlocks: [] });
    if (got === base) {
      ok(`hasServiceDetailPages=${hasDetail}：${got.length} 字节，逐字节相同`);
    } else {
      bad(`hasServiceDetailPages=${hasDetail}：不一样\n--- 基线 ---\n${base}\n--- 现在 ---\n${got}`);
    }
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
