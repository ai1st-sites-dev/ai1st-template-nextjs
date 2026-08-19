#!/usr/bin/env node
/**
 * editable-files.test.js — #1087：给「AI 聊天编辑器只能写站的内容」这条规则装一个常设的守卫。
 *
 *   node scripts/lib/editable-files.test.js     （由 `npm run test:scripts` 自动发现）
 *   退出码: 0 全过 · 1 有失败 · 2 跑不起来（**不许当成通过**）
 *
 * ── 为什么要有它 ────────────────────────────────────────────────────────────────────────────────
 * 本票要治的那个缺陷（一次 AI 编辑给真客户站写进一个不存在的 `themeId`）在 CI 里是**绿的**：
 * `lint:scripts` 只查语法，e2e 不走 AI 编辑那条路。也就是说下一个人把这道判断挪走 / 放宽，
 * 没有任何东西会红。一个只在写的那天跑过的检查等于没有检查（`run-script-tests.js` 的文件头
 * 为同一件事写过一遍）。
 *
 * 🔴 这里的分母不是我想出来的路径清单，是**真实站仓里的每一个文件**（下面 ③）——合成夹具全绿
 *    推不出这道判断在真数据上够用。
 */

'use strict';

const path = require('path');

const mod = require('./editable-files.js');
const { writeRejection } = mod;

let pass = 0, fail = 0;
const ok = (m) => { pass++; console.log(`  ✅ ${m}`); };
const bad = (m) => { fail++; console.log(`  ❌ ${m}`); };
const die = (m) => { console.error(`🔴 跑不起来: ${m}`); process.exit(2); };

if (typeof writeRejection !== 'function') die('editable-files.js 没导出 writeRejection');

const canWrite = (p) => writeRejection(p) === null;

// ── ① 站的内容：写得进去（多语言站的 <locale>/ 形状与老扁平站的根级形状都要收）──────────────────
{
  const WRITABLE = [
    'brand.json',
    'seo.json', 'zh/seo.json', 'zh_CN/seo.json', 'zh-TW/seo.json',
    'services.json', 'en/services.json',
    'pages/home.json', 'zh/pages/home.json',
    'pages/services/engagement-sessions.json', 'zh/pages/services/a.json',   // 服务详情页（多一层）
    'blog/first-post.json', 'en/blog/first-post.json',
    'blocks/site-blocks.json', 'zh/blocks/site-blocks.json',
  ];
  const wrong = WRITABLE.filter((p) => !canWrite(p));
  if (wrong.length === 0) ok(`站的内容 ${WRITABLE.length} 条全部可写`);
  else bad(`这些【应该】可写却被拒了: ${wrong.join(' · ')}`);
}

// ── ② 别的通道拥有的开关 / 构建生成的产物：一律拒，而且理由要点名它归谁管 ────────────────────────
{
  // 每一项配一个「这句话里必须出现的词」——只断言「被拒了」的话，把理由换成 Invalid path 也照样绿，
  // 而本票的判据之一正是「拒的理由不能只说路径不合法，否则模型会去试别的写法」。
  const REJECTED = [
    ['theme.json', 'theme picker'],
    ['theme.css', 'theme'],
    ['custom.css', 'generates'],
    ['site_meta.json', 'locales'],
    // 🔴 #1087 r3 —— 这一格原来钉的是 `layout picker`，而那个东西**不存在**（dashboard/manager/worker
    //    里 grep 命中 0，尺子校准 ThemeModal=3）。钉住它等于把「去某某地方改」这个假象钉在原地 ——
    //    跟 r2 治掉 navigation.json 那个 `regenerates` needle 是同一件事。现在钉承重的那半句。
    ['page-layout.json', 'cannot be changed yet'],
    // 🔴 #1087 r2 —— 这两格原来钉的是 `regenerates`，也就是**那句半真的话**本身：它只描述了链接那一半，
    // 而这个文件里最要紧的 `header.cta` 恰恰不被覆盖。钉住它等于把那个假象钉在原地。
    // 现在钉的是新那句话里**承重的第三句**：「今天没有别的地方能改」。选它不是随手挑一个词 ——
    // QA2 在真容器上量到的退步是模型替老板编了一个不存在的后台页（"Dashboard → Navigation settings"），
    // 而挡住那件事的就是这一句。前两句（哪一半会被覆盖）由下面那两格分别钉。
    ['navigation.json', 'no way to change those yet'],
    ['zh/navigation.json', 'no way to change those yet'],
  ];
  // 🔴 #1087 r2 —— navigation.json 那句话现在有三个承重的半句，上面的清单一项只能钉一个词。
  // 另外两个在这里各钉一次：说反了任何一句，模型给老板的答复就会是假的（这正是 r1 被退回的那件事）。
  const NAV_ALSO = [
    // ① 会被覆盖的到底是哪两处 —— 说成「整份都会被覆盖」就是 r1 那句半真的话
    'the header menu links and the first footer column',
    // ② 不会被覆盖的那部分要点名 header.cta —— 它就是每一页顶部那个按钮
    'header.cta',
  ];
  // 🔴 #1087 r3 —— page-layout.json 那句话也有两个承重的半句，跟 navigation.json 同构：
  //   ① 它是干什么的（缺文件按 standard 走）② 今天没有任何东西写它 —— 少了 ②，模型又会指一个假地方。
  const PAGE_LAYOUT_ALSO = [
    'the "standard" layout',      // ① 说清缺文件时的真实行为
    'nothing writes it today',    // ② 承重：产品里没有任何写它的地方
  ];
  const problems = [];
  for (const needle of NAV_ALSO) {
    const why = writeRejection('navigation.json') || '';
    if (!why.includes(needle)) problems.push(`navigation.json 的理由里没有 "${needle}"`);
  }
  for (const needle of PAGE_LAYOUT_ALSO) {
    const why = writeRejection('page-layout.json') || '';
    if (!why.includes(needle)) problems.push(`page-layout.json 的理由里没有 "${needle}"`);
  }
  for (const [p, needle] of REJECTED) {
    const why = writeRejection(p);
    if (why === null) problems.push(`${p} 竟然可写`);
    else if (!why.includes(needle)) problems.push(`${p} 被拒了，但理由里没有 "${needle}"：${why.split('\n')[0]}`);
  }
  if (problems.length === 0) ok(`开关 / 生成物 ${REJECTED.length} 条全部被拒，且理由点名了它归谁管`);
  else problems.forEach(bad);

  // 本票的实物：那个真客户站被写进去的就是这一个文件。
  const why = writeRejection('theme.json');
  if (why && /does not exist|build/i.test(why)) ok('theme.json 的拒绝理由说出了后果（写一个不存在的主题 = 这个站以后建不出来）');
  else bad(`theme.json 的拒绝理由没说后果：${why}`);
}

// ── ③ 认不出来的一律拒（白名单方向）——分母取【真实站仓里的每一个文件】 ─────────────────────────
{
  // 认不出来的新文件必须落在拒那一边。这是白名单与黑名单唯一的分歧点，也是本票选白名单的理由。
  const UNKNOWN = [
    'secrets.json', 'package.json', '.github/workflows/x.yml', 'zh/brand.json',
    'zh/blocks/other.json', 'pages', 'theme.jsonx', 'blogx/a.json',
  ];
  const leaked = UNKNOWN.filter(canWrite);
  if (leaked.length === 0) ok(`认不出来的 ${UNKNOWN.length} 条全部被拒（白名单方向）`);
  else bad(`这些认不出来的路径【漏】了进去: ${leaked.join(' · ')}`);

  // 反向对照：上面那一格如果是因为 writeRejection 恒返回字符串（判断坏了）才绿的，
  // ① 会红。两格必须同时成立才说明这把尺子是活的 —— 单独一格全拒或全放都能骗过自己。
  if (pass === 0) bad('分母自检：一条都没通过 —— 这几格里的绿不可信');
}

// ── ④ 绕路写法：分隔符 / 多余的 ./ 不许把开关文件变成「认不出来的内容文件」 ──────────────────────
{
  // `edit-site.js` 的 `validatePath` 已经挡掉 `..` 和绝对路径，所以最后那条在真路径上到不了这里。
  // 它仍然要断言 —— 这一格是我第一版写错的地方：那版只按分隔符切片，`pages/../theme.json` 被切成
  // 三段之后命中「pages/ 底下任何一层的 .json」，判成**可写**，而它落盘的位置正是 site/theme.json。
  // 一个「这个文件是什么」的判断不该把正确性寄在调用方的另一道检查上。
  const SNEAKY = ['./theme.json', 'theme.json/', './/theme.json', 'pages/../theme.json'];
  const leaked = SNEAKY.filter(canWrite);
  if (leaked.length === 0) ok(`绕路写法 ${SNEAKY.length} 条全部被拒`);
  else bad(`这些绕路写法漏了进去: ${leaked.join(' · ')}`);
}

// ── ⑤ 接线：edit-site.js 真的调了这个模块（不是只在这里绿）────────────────────────────────────
{
  const fs = require('fs');
  const src = fs.readFileSync(path.join(__dirname, '..', 'edit-site.js'), 'utf-8');
  const required = /require\(['"]\.\/lib\/editable-files['"]\)/.test(src);
  const called = /writeRejection\(relPath\)/.test(src);
  if (required && called) ok('edit-site.js 引了这个模块，并且在 write_file 里拿 relPath 问过它');
  else bad(`edit-site.js 的接线断了（require=${required} · 调用=${called}）—— 这个模块再对也拦不住任何东西`);
}

// ── ⑥ SYSTEM_PROMPT 里说的那两处也必须是真话（#1087 r3）───────────────────────────────────────
//
// 🔴 为什么单独一格：⑤ 只问「edit-site.js 有没有调这个模块」，**没有任何东西看那段 SYSTEM_PROMPT**。
//    而拒绝理由与 SYSTEM_PROMPT 是模型的两条不同入口 —— r2 把拒绝理由改成了真话，却没治把模型
//    **从那条路上引开**的这一句，于是模型压根走不到那句真话（QA2 四臂里三臂如此，日志里
//    `navigation.json is not edited here` 命中 0），然后把一句假话 commit + push 给了老板。
//
// 🔴 每一条都是「必须出现的真话」+「必须消失的假话」配对着钉。只钉消失的那半，把整段删光也能绿。
{
  const fs = require('fs');
  const prompt = fs.readFileSync(path.join(__dirname, '..', 'edit-site.js'), 'utf-8');
  const CLAIMS = [
    // navigation.json —— 真话：会被重建的只有那两处，而顶部那个按钮不是，且今天没别的地方能改
    { must: 'header.cta', why: 'SYSTEM_PROMPT 没点名 header.cta —— 模型会以为改页面元数据能动顶部那个按钮' },
    { must: 'cannot be changed yet', why: 'SYSTEM_PROMPT 没说「今天还改不了」—— 模型会替老板编一个不存在的设置页' },
    { mustNot: 'It is auto-regenerated from page metadata.',
      why: 'SYSTEM_PROMPT 里那句「整份由页面元数据自动重建」又回来了 —— header.cta 恰恰不是' },
    // page-layout.json —— 真话：没有 picker
    { must: 'nothing in the product changes it today',
      why: 'SYSTEM_PROMPT 没说清 page-layout.json 今天没人改得了' },
    { mustNot: 'page-layout.json (the layout picker)',
      why: 'SYSTEM_PROMPT 又把 page-layout.json 说成归一个不存在的 layout picker 管' },
  ];
  const bads = [];
  for (const c of CLAIMS) {
    if (c.must && !prompt.includes(c.must)) bads.push(`${c.why}（找不到 "${c.must}"）`);
    if (c.mustNot && prompt.includes(c.mustNot)) bads.push(`${c.why}（还留着 "${c.mustNot}"）`);
  }
  if (bads.length === 0) ok(`SYSTEM_PROMPT 的 ${CLAIMS.length} 条断言全部成立（两句真话在、两句假话不在）`);
  else bads.forEach(bad);

  // 🔴 分母自检：上面那一格如果因为读错文件（读到空串）而"全绿"，`must` 那三条会红；
  //    反过来读到一个恒含全部字符串的东西，`mustNot` 那两条会红。这里再钉一次「读的是那个文件」。
  if (!/const SYSTEM_PROMPT/.test(prompt)) bad('⑥ 读到的 edit-site.js 里没有 SYSTEM_PROMPT —— 这一格量的不是那段话');
  else ok('⑥ 读的确实是 edit-site.js 里那段 SYSTEM_PROMPT 所在的文件');
}

console.log(`\n══ 汇总: 通过 ${pass} · 失败 ${fail} ══`);
process.exit(fail ? 1 : 0);
