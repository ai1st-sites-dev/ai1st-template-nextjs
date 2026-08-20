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
//
// 🔴 量的对象是**送进模型的那段话**，不是整个源文件（#1096 B1）。这一格原来 `readFileSync` 之后对
//    整个 `edit-site.js` 做 `includes`，而它的报错文案说的是「SYSTEM_PROMPT 没点名 header.cta」——
//    PM 在隔离副本上把这道判断构造成了假绿：把 prompt 里 navigation.json 那 6 行真话**搬进文件头
//    注释**、prompt 里换成 `Change it in Dashboard → Navigation settings.`（QA2 上一轮在真容器里量到
//    真模型说出来的正是这句假话）⟹ 8 格全绿 rc=0。一句话说：文件里有这串 ≠ 模型看到这串。
{
  const fs = require('fs');
  const src = fs.readFileSync(path.join(__dirname, '..', 'edit-site.js'), 'utf-8');

  // 取那段模板字面量。开头锚在声明上，结尾找第一个**没被转义的**反引号 —— 这段话里的 `blocks` 之类
  // 是写成 \` 的，直接找第一个反引号会把话切断（切断的方向是假绿：needle 找不到才报红，而 mustNot
  // 那半会因为文本变短而"通过"）。
  const OPEN = 'const SYSTEM_PROMPT = `';
  const at = src.indexOf(OPEN);
  if (at < 0) die('edit-site.js 里找不到 `const SYSTEM_PROMPT = ` —— 这一格量不到那段话，而这不是通过');
  let end = at + OPEN.length;
  for (;;) {
    const k = src.indexOf('`', end);
    if (k < 0) die('SYSTEM_PROMPT 那段模板字面量没有结尾反引号 —— 读到的不是一段完整的话');
    if (src[k - 1] === '\\') { end = k + 1; continue; } // 转义的反引号，是话的一部分
    end = k;
    break;
  }
  const prompt = src.slice(at + OPEN.length, end);

  // 🔴 分母自检，三条，缺一条这一格就在量别的东西：
  //    ① 取到的是**字面量里面**，不是整个文件（文件里才有 `const SYSTEM_PROMPT`）
  //    ② 它真的被送进模型（接线在同一个文件里，`system: SYSTEM_PROMPT`）—— 不然量的是一段死文本
  //    ③ 长度不是退化值（切断/取空时 must 那几条会红、mustNot 那几条会"通过"，方向是假绿）
  if (prompt.includes('const SYSTEM_PROMPT')) die('取出来的文本里还有声明本身 —— 切片没切在字面量里面');
  if (!/\bsystem:\s*SYSTEM_PROMPT\b/.test(src)) {
    bad('⑥ edit-site.js 没有把 SYSTEM_PROMPT 当 system 送进模型 —— 这一格量的话没人读，接线先修');
  } else if (prompt.length < 1000) {
    bad(`⑥ 取到的 SYSTEM_PROMPT 只有 ${prompt.length} 字 —— 这不像一段完整的话，先修这把尺`);
  } else {
    ok(`⑥ 量的是送进模型的那段 SYSTEM_PROMPT 本身（${prompt.length} 字，且 edit-site.js 真把它当 system 送出去）`);
  }

  // 换行不算差别：这段话是按 110 列手工折行的，`do not point them at\n  a settings screen` 在源文件里
  // 跨两行，而模型读到的是同一句。两侧都压成单空格再比。
  const flat = (x) => x.replace(/\s+/g, ' ').trim();
  const inPrompt = (needle) => flat(prompt).includes(flat(needle));

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

    // 🔴 #1096 B2 —— 两处「别指地方」的**祈使句**，各自单独钉住。
    //    上面那几条钉的是**事实**那半（"那个按钮改不了"），而 QA2 的活体数据说明**祈使**那半才是行为
    //    差异的来源：带祈使 4/4 不指假地方，只陈述 2–3/4 指了。QA3 变异实测把它们各自删掉，8 格全绿。
    //    📌 台账那条把它们写成 `do not point them at a picker, there is none.` 与
    //    `do not point them at a settings screen, there is none.` 两句 —— 我逐字 grep 过 origin/main
    //    (2026-08-19 重取，a382db2b)：`picker` 那句出现 0 次，只有后者存在（`:367-368`，跨两行）；
    //    page-layout 那半的祈使句实际是 `Do not try to change the site's look by writing those`
    //    （`:376-377`，也跨两行）。钉的是仓里真有的这两句。
    { must: 'do not point them at a settings screen, there is none.',
      why: 'header.cta 那半只剩陈述句了 —— 少了这句祈使，模型会一边说"改不了"一边把老板指去一个不存在的设置页' },
    { must: "Do not try to change the site's look by writing those",
      why: 'theme.json / page-layout.json 那半只剩陈述句了 —— 少了这句祈使，模型会去写那几个它写不进的文件' },
  ];
  const bads = [];
  for (const c of CLAIMS) {
    if (c.must && !inPrompt(c.must)) bads.push(`${c.why}（找不到 "${c.must}"）`);
    if (c.mustNot && inPrompt(c.mustNot)) bads.push(`${c.why}（还留着 "${c.mustNot}"）`);
  }
  if (bads.length === 0) {
    const mustN = CLAIMS.filter((c) => c.must).length;
    const notN = CLAIMS.filter((c) => c.mustNot).length;
    ok(`SYSTEM_PROMPT 的 ${CLAIMS.length} 条断言全部成立（${mustN} 句真话在、${notN} 句假话不在）`);
  } else bads.forEach(bad);
}

console.log(`\n══ 汇总: 通过 ${pass} · 失败 ${fail} ══`);
process.exit(fail ? 1 : 0);
