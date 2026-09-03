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
    // 📌 #1104 —— `navigation.json` **搬出这张表了**：它现在是有条件可写的（改顶部那个按钮放行，
    // 改菜单链接拒），判断和它的全部断言住在 `navigation-owned.test.js`。这里原来有两格钉着
    // 「no way to change those yet」——那句话本票之后是**假的**，钉着它等于把「老板改不了」钉在原地。
  ];
  // 🔴 #1087 r3 —— page-layout.json 那句话也有两个承重的半句，跟 navigation.json 同构：
  //   ① 它是干什么的（缺文件按 standard 走）② 今天没有任何东西写它 —— 少了 ②，模型又会指一个假地方。
  const PAGE_LAYOUT_ALSO = [
    'the "standard" layout',      // ① 说清缺文件时的真实行为
    'nothing writes it today',    // ② 承重：产品里没有任何写它的地方
  ];
  const problems = [];
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
  // #1104 起这个调用带第二个参数（这次的内容 + 读磁盘那份的函数），所以不能再钉
  // `writeRejection(relPath)` 那个字面写法 —— 钉着它，本票的接线一接上这一格就假红。
  // navigation.json 那一格递没递齐由 `navigation-owned.test.js` ⑥ 单独钉。
  const called = /writeRejection\(\s*relPath\b/.test(src);
  if (required && called) ok('edit-site.js 引了这个模块，并且在 write_file 里拿 relPath 问过它');
  else bad(`edit-site.js 的接线断了（require=${required} · 调用=${called}）—— 这个模块再对也拦不住任何东西`);

  // #1109 —— 形状那一维是**在 ctx 上递进来**的，所以「这个模块判得对」跟「真路径上判得着」是两个
  // 读数。递漏了的失败方向是静默的：下面 ⑦ 全绿（它自己造形状），而真的 write_file 回到放行。
  // 🔴 两条都要：递了这个键 ⟹ 白名单看得见形状；它问的是 lib/site-shape ⟹ 答的是这个站的真形状，
  //    不是一个就地写死的猜测（判据跟构建同一条这件事，整段理由在 lib/site-shape.js 的文件头）。
  const wiredShape = /readSiteShape:/.test(src);
  const asksLib = /readSiteShape:[\s\S]{0,200}?readSiteShape\(\s*siteDir\s*\)/.test(src)
    && /require\(['"]\.\/lib\/site-shape['"]\)/.test(src);
  if (wiredShape && asksLib) ok('edit-site.js 把这个站的形状（readSiteShape）递进了 write_file 的判断，而且是去问 lib/site-shape 的');
  else bad(`形状那一维的接线断了（递了 readSiteShape=${wiredShape} · 问的是 lib/site-shape=${asksLib}）—— ⑦ 会全绿，而真的 write_file 照旧放行写到没人读的地方`);
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
    // navigation.json —— #1104 之后的真话：会被重建的只有那两处，顶部那个按钮不是，而它现在
    // **就在这条路上改**。这里只留这一格（它跨两票都成立）；本票新增的那几句由
    // `navigation-owned.test.js` ⑦ 钉。
    { must: 'header.cta', why: 'SYSTEM_PROMPT 没点名 header.cta —— 模型会以为改页面元数据能动顶部那个按钮' },
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
    // 🔴 #1104 r6 —— 这一条【留着，需要的字面量一个字没改】，但它守的那一半换了对象，理由要写下来，
    //    否则下一个人读到会以为 #1096 那条被悄悄放宽了：#1096 立它的时候这句祈使跟在
    //    「那个按钮改不了」后面，而 #1104 让那个按钮**改得了**了 ⟹ 原来那句陈述今天是假话，随它一起
    //    走了。仍然存在「模型会指一个不存在的设置页」这个风险的，是**今天还拒**的那三处（菜单链接 /
    //    第一栏页脚链接 / 页脚栏目数），所以这句祈使被搬到那三处后面。QA2 那组活体数据
    //    （带祈使 4/4 不指假地方、只陈述 2–3/4 指了）说的是祈使句这个形式，不是它跟着哪个字段，
    //    所以搬对象不削弱它。
    { must: 'do not point them at a settings screen, there is none.',
      why: '今天还拒的那三处只剩陈述句了 —— 少了这句祈使，模型会一边说"改不了"一边把老板指去一个不存在的设置页' },
    { must: "Do not try to change the site's look by writing those",
      why: 'theme.json / page-layout.json 那半只剩陈述句了 —— 少了这句祈使，模型会去写那几个它写不进的文件' },

    // ── 下面 8 条是 #1104 r6 从 `navigation-owned.test.js` 的 ⑦ 整格搬过来的 ────────────────────
    // 搬的理由就是这一格自己上面那段 #1096：那边读的是**整个 edit-site.js 文件**再 includes，而
    // #1096 已经在同族那一格上把这种读法构造成了假绿。这里的尺子切的是真正送进模型的那段话，
    // 所以本票新增的两条（最后两条）必须立在这把尺上，而原有的 6 条一起搬，一条不丢。
    { must: 'navLabel', why: 'SYSTEM_PROMPT 没说菜单链接要去改 navLabel —— 模型只知道被拒，不知道去哪改' },
    { mustNot: 'say it cannot be changed yet',
      why: '还留着「就说改不了」那句 —— #1104 之后它是假话，那个按钮现在改得了' },
    { mustNot: 'DO NOT edit directly',
      why: '还留着「一律不许改 navigation.json」—— 模型会绕开这条现在真能走的路' },
    // #1104 r3：门会因为「删了一个字段 / 把文字改成不是文字」而拒。模型只在被拒之后才知道，老板就
    // 要多等一个来回；而「让版权行消失」真正走得通的办法是写成空串（实测：门放行、npm run build
    // rc=0、产物里那行字没了）。
    { must: 'set it to an empty string',
      why: '没告诉模型「让那行字消失」要写成空串 —— 它会去删字段，然后被拒，老板多等一轮' },
    { must: 'stops the site from building',
      why: '没说清删字段的后果是这个站建不出来 —— 模型不知道这条为什么重要' },
    // #1104 r6（QA1 r5 那条 🟡）：拒绝理由与 SYSTEM_PROMPT 是模型的两条入口，那句假话原来两处都有。
    // 只修拒绝理由 ⟹ 模型在被拒**之前**读到的仍是「改 navLabel 就能加一个页脚栏目」。
    { must: 'navLabel / navOrder will not change it',
      why: '没说清「页脚有几栏」跟 navLabel / navOrder 无关 —— 模型会把那个假补救办法转给老板' },
    { must: 'one extra column per service that has keyword pages',
      why: '没说页脚栏目数真正从哪来 —— 只说「不许改」不够，老板会问那怎么改' },
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

// ── ⑦ 这个文件在【这个站】上有人读吗（#1109）───────────────────────────────────────────────────
//
// 白名单只看文件名，而同一个文件名在两种站上住在不同地方（多语言站 `site/<语言>/`、老扁平站
// `site/`）。位置写错时这条路**不报错也不生效**：落盘 → sync-config rc=0 → commit + push →
// 老板收到「Done」→ 站上一个像素没变。所以这一格钉的是「位置不对就拒，而且说清该写哪里」。
//
// 🔴 这里的形状是**造出来的**（`{flat, locales}` 两个字面量），所以这一格证的是「拿到形状之后
//    判得对」。「真站上读出来的形状对不对」是另一个读数，由 `site-shape.test.js` 在**真夹具**
//    （create-site.js 造的多语言站 + 由它转出来的扁平站）上取 —— 两个读数缺哪个都不够。
{
  const LOCALE = { flat: false, locales: ['en', 'zh'] };
  const FLAT = { flat: true, locales: [] };
  const shaped = (shape) => ({ readSiteShape: () => shape });
  // navigation.json 走的是 #1104 那道窄口子，光有形状还不够（缺内容一律拒），所以正向那一格要把
  // 材料备齐 —— 用一份长得像真站的 navigation.json，改的是构建不碰的 topbar。
  const NAV = {
    header: { links: [{ label: 'Home', href: '/' }], cta: { label: 'Book', href: '/contact' } },
    footer: { description: 'Serving the GTA.', columns: [{ title: 'Quick Links', links: [{ label: 'Home', href: '/' }] }], copyright: 'Northside Inc.' },
  };
  const navCtx = (shape) => ({
    readSiteShape: () => shape,
    content: JSON.stringify({ ...NAV, topbar: { message: '24h emergency', link: { label: 'Call', href: '/contact' } } }),
    readCurrent: () => JSON.stringify(NAV),
  });

  // 多语言站：根目录那几份没人读 ⟹ 拒，而且理由要点明这个站是多语言、内容在 site/<语言>/ 下面
  const problems = [];
  for (const p of ['seo.json', 'services.json', 'pages/home.json', 'pages/services/a.json', 'blog/first.json', 'blocks/site-blocks.json']) {
    const why = writeRejection(p, shaped(LOCALE));
    if (why === null) problems.push(`多语言站上根级 ${p} 竟然可写（写进去没人读，站不会变）`);
    else if (!/multi-language site/.test(why) || !/site\/<language>\//.test(why)) {
      problems.push(`${p} 被拒了，但理由没点明「这个站是多语言结构、内容在 site/<语言>/ 下面」：${why.split('\n')[0]}`);
    } else if (!why.includes(`en/${p}`)) {
      problems.push(`${p} 的理由没告诉模型该写哪个路径（应含 en/${p}）：${why.split('\n')[0]}`);
    }
  }
  // AC4：navigation.json 那道窄口子同样按形状判（它不在 WRITABLE 里，走的是另一条分支）
  {
    const why = writeRejection('navigation.json', navCtx(LOCALE));
    if (why === null) problems.push('多语言站上根级 navigation.json 竟然可写');
    else if (!/multi-language site/.test(why)) problems.push(`根级 navigation.json 被拒了，但不是按形状拒的：${why.split('\n')[0]}`);
  }
  if (problems.length === 0) ok('多语言站：根目录那 6 类内容文件 + navigation.json 全部被拒，理由点名了形状与该写的路径');
  else problems.forEach(bad);

  // 扁平站：反方向。`<语言>/` 底下那几份没人读 ⟹ 拒，理由点明这个站是扁平的、内容直接在 site/ 下
  const rev = [];
  for (const p of ['en/seo.json', 'zh/services.json', 'en/pages/home.json', 'en/blog/first.json', 'en/blocks/site-blocks.json']) {
    const why = writeRejection(p, shaped(FLAT));
    if (why === null) rev.push(`扁平站上 ${p} 竟然可写（写进去没人读，站不会变）`);
    else if (!/flat layout/.test(why) || !/directly under site\//.test(why)) {
      rev.push(`${p} 被拒了，但理由没点明「这个站是扁平结构、内容直接在 site/ 下面」：${why.split('\n')[0]}`);
    }
  }
  {
    const why = writeRejection('en/navigation.json', navCtx(FLAT));
    if (why === null) rev.push('扁平站上 en/navigation.json 竟然可写');
    else if (!/flat layout/.test(why)) rev.push(`en/navigation.json 被拒了，但不是按形状拒的：${why.split('\n')[0]}`);
  }
  if (rev.length === 0) ok('扁平站：<语言>/ 底下那 5 类内容文件 + navigation.json 全部被拒，理由点名了形状');
  else rev.forEach(bad);

  // 🔴 正向：别把功能治死（AC2）。位置**对**的那几条必须照旧放行 —— 少了这一格，把这道判断写成
  //    「一律拒」也能让上面两格全绿。
  const killed = [];
  for (const [p, shape] of [
    ['en/seo.json', LOCALE], ['zh/services.json', LOCALE], ['en/pages/home.json', LOCALE],
    ['en/blog/first.json', LOCALE], ['zh/blocks/site-blocks.json', LOCALE],
    ['seo.json', FLAT], ['services.json', FLAT], ['pages/home.json', FLAT],
    ['blog/first.json', FLAT], ['blocks/site-blocks.json', FLAT],
    // brand.json 两种形状下都住在 site/ 根 —— 形状这一维对它不许说话
    ['brand.json', LOCALE], ['brand.json', FLAT],
  ]) {
    const why = writeRejection(p, shaped(shape));
    if (why !== null) killed.push(`${p}（${shape.flat ? '扁平' : '多语言'}站）本来该放行，却被拒了：${why.split('\n')[0]}`);
  }
  for (const [p, shape] of [['en/navigation.json', LOCALE], ['navigation.json', FLAT]]) {
    const why = writeRejection(p, navCtx(shape));
    if (why !== null) killed.push(`${p}（${shape.flat ? '扁平' : '多语言'}站）改 topbar 本来该放行，却被拒了：${why.split('\n')[0]}`);
  }
  if (killed.length === 0) ok('位置对的 14 条照旧放行（形状判断没把功能治死）');
  else killed.forEach(bad);

  // 🔴 形状问不到时这一维不判：老调用方（不递 readSiteShape）与 `lib/remediation.js` 都走这条路，
  //    在这里拒 = 一份读不出来的站目录让整个编辑器变砖，而 remediation 会据此对老板说「改不了」。
  //    方向与 navigation.json 那道窄口子相反，理由写在 editable-files.js 的文件头。
  const unknown = ['seo.json', 'en/seo.json', 'pages/home.json', 'en/pages/home.json'];
  const wrongWhenUnknown = unknown.filter((p) => writeRejection(p) !== null)
    .concat(unknown.filter((p) => writeRejection(p, { readSiteShape: () => null }) !== null))
    .concat(unknown.filter((p) => writeRejection(p, { readSiteShape: () => { throw new Error('读不到'); } }) !== null));
  if (wrongWhenUnknown.length === 0) ok('形状问不到（没递 / 返回 null / 抛异常）时这一维不判，白名单原来的答案不变');
  else bad(`形状问不到时把这些拒了：${wrongWhenUnknown.join(' · ')} —— 那会让读不出形状的站彻底编辑不了`);

  // 🔴 形状不对的路径拿到的必须是**形状那句话**，不是兜底那句「不是这个站的内容文件」——
  //    两句话的区别就是模型会不会去改对地方（#1087 立的那条：只说无效，模型去试别的写法）。
  const generic = writeRejection('seo.json', shaped(LOCALE)) || '';
  if (/is not one of this site's content files/.test(generic)) {
    bad('多语言站上根级 seo.json 拿到的是兜底那句「不是这个站的内容文件」—— 模型会以为这个文件不能改，而它能改，只是位置不对');
  } else ok('拒的是「位置不对」这件事，不是兜底那句「不是这个站的内容文件」');
}


// ── ⑧ 我判的那个文件，就是落盘会写的那个文件吗（#1109 r2 —— QA3 在 r1 终审打回的那条阻断）────────
//
// 🔴 这一格钉的是一条**不变式**，不是某几种拼法：`writeRejection` 按归一化后的身份放行，而
//    `edit-site.js` 用 `path.join(siteDir, 原始字符串)` 落盘。两者对同一个字符串给出不同的文件时，
//    白名单按 A 放行、字节按 B 落地 —— `en\seo.json` 被判成 `en/seo.json`（正确位置 ⟹ 放行），
//    而 Linux 上 `\` 只是文件名里的一个字符 ⟹ 字节落在 `site/` 根目录，构建读不到，老板收到「Done」。
// 🔴 实测的差集有**两族**（反斜杠 · 结尾带分隔符），所以下面按「`path.join` 收不收敛」分组，
//    **不**按字符分组：照字符写就会漏掉第二族，而漏掉的样子跟修好了一模一样。
console.log('⑧ 判的对象 == 落盘的对象（#1109 r2）');
{
  const SITE = '/S/site';
  const ctx = { readSiteShape: () => ({ flat: false, locales: ['en'] }) };
  // `path.join` 自己就会收敛的写法 —— 判决必须一个字都不变（QA1/QA2 在 r1 量过的就是这些）
  const CONVERGENT = ['en/seo.json', 'en//seo.json', 'en/./seo.json', './en/seo.json',
    'en/pages/home.json', 'en/pages//home.json', 'en/pages/./home.json', 'en/services.json',
    'brand.json', 'seo.json', './seo.json', 'theme.json'];
  // 它**不**收敛的写法 —— 必须拒，而且拒的那句话要把该怎么拼说出来
  const DIVERGENT = ['en\\seo.json', 'en\\pages\\home.json', 'en\\services.json',
    'en\\pages/home.json', 'en/pages\\home.json', 'en/\\seo.json',
    'en/seo.json/', 'en/seo.json//', 'en/./seo.json/'];

  // 变异版：把那道门从**真源码**里摘掉（在内存里编译，不往交付树放探针）
  const REAL = path.join(__dirname, 'editable-files.js');
  const srcReal = require('fs').readFileSync(REAL, 'utf-8');
  const ANCHOR = '  return spellingMismatch(relPath, r.canonical);\n';
  const nAnchor = srcReal.split(ANCHOR).length - 1;
  if (nAnchor !== 1) die(`⑧ 阳性对照的锚点在 editable-files.js 里出现 ${nAnchor} 次（要求正好 1 次）`);
  const Module = require('module');
  const m = new Module(REAL, module);
  m.filename = REAL;
  m.paths = Module._nodeModulePaths(path.dirname(REAL));
  m._compile(srcReal.replace(ANCHOR, '  return null;\n'), REAL);
  const ungated = m.exports.writeRejection;

  // ── a) 收敛的那些：这道门一个判决都没改
  const changed = CONVERGENT.filter((p) => writeRejection(p, ctx) !== ungated(p, ctx));
  if (changed.length === 0) {
    ok(`⑧a ${CONVERGENT.length} 个「path.join 自己会收敛」的写法：判决与没有这道门时逐字相同`);
  } else bad(`⑧a 这道门改了这些写法的判决：${changed.join(' · ')} —— 它收得太宽了`);

  // ── b) 不收敛的那些：全部被拒
  const allowed = DIVERGENT.filter((p) => writeRejection(p, ctx) === null);
  if (allowed.length === 0) ok(`⑧b ${DIVERGENT.length} 个「path.join 不收敛」的写法全部被拒`);
  else bad(`⑧b 这些写法仍被放行，字节会落到判决之外的地方：${allowed.join(' · ')}`);

  // ── c) 判据就是那条不变式本身：从它自己那句话里抠出它让模型改用的拼法，
  //       再拿**落盘用的那个 `path.join`** 问一次「这两种拼法指的是同一个文件吗」——必须不是。
  const notReallyDivergent = [];
  for (const p of DIVERGENT) {
    const why = writeRejection(p, ctx) || '';
    const mm = why.match(/If you meant "([^"]+)"/);
    if (!mm) { notReallyDivergent.push(`${p}（拒的话里没给出该用的拼法）`); continue; }
    if (path.join(SITE, p) === path.join(SITE, mm[1])) {
      notReallyDivergent.push(`${p}（它跟 ${mm[1]} 落到同一个文件，本来就不该进这一组）`);
    }
  }
  if (notReallyDivergent.length === 0) {
    ok('⑧c 这 9 个写法逐个：拒的话里点名了该用的拼法，而 path.join 对两种拼法给出的确实是不同的文件');
  } else notReallyDivergent.forEach(bad);

  // ── d) 阳性对照：摘掉那道门，b) 里那些必须回到放行（否则 b) 的绿是别处挣来的）
  const stillRejected = DIVERGENT.filter((p) => ungated(p, ctx) !== null);
  if (stillRejected.length === 0) {
    ok(`⑧d 阳性对照：摘掉那一行，这 ${DIVERGENT.length} 个写法全部回到放行 —— b) 量的是这道门`);
  } else bad(`⑧d 摘掉之后这些仍被拒：${stillRejected.join(' · ')} —— b) 的绿有一部分不是这道门给的`);

  // ── e) 那个哨兵根不承重：换三个绝对根复算，每一条的答案都必须一样
  //       （这道门拿哨兵根而不是真 `siteDir` 去比，理由写在 `spellingMismatch` 的第三个 🔴：
  //       `..` 已经被拒掉 ⟹ 没有往上逃的分量 ⟹ 判决与前缀无关。这一格就是那句话的读数。
  //       🔴 两种拼法都从**它自己那句话**里取，不在这里重写一份归一化 —— 重写一份就等于
  //       拿我的实现去核我的实现。）
  {
    const pairs = [];
    for (const p2 of DIVERGENT) {
      const mm = (writeRejection(p2, ctx) || '').match(/If you meant "([^"]+)"/);
      if (mm) pairs.push([p2, mm[1]]);
    }
    if (pairs.length !== DIVERGENT.length) {
      bad(`⑧e 立不起来：${DIVERGENT.length} 条里只有 ${pairs.length} 条能从拒绝话里取到该用的拼法`);
    } else {
      const perRoot = ['/', '/a', '/a/b/c/d'].map((root) => pairs
        .map(([raw, canon]) => (path.join(root, raw) === path.join(root, canon) ? '同' : '异')).join(''));
      if (new Set(perRoot).size === 1 && !perRoot[0].includes('同')) {
        ok(`⑧e 哨兵根不承重：三个不同的绝对根下，这 ${pairs.length} 条的答案逐条相同（都是「两种拼法不同文件」）`);
      } else {
        bad(`⑧e 换根之后读数变了：${perRoot.join(' | ')} —— 那「判决与前缀无关」这句话要重新论证`);
      }
    }
  }
  // ── f) 这道门是纯的：同一份语料连问两次，判决集合必须相同
  const verdicts = () => CONVERGENT.concat(DIVERGENT)
    .map((p2) => (writeRejection(p2, ctx) === null ? '放' : '拒')).join('');
  if (verdicts() === verdicts()) ok('⑧f 同一份语料连问两次，判决集合相同（这道门没有藏状态）');
  else bad('⑧f writeRejection 不是纯的：同一份语料连问两次判决不同');
}

// ── ⑨ 这个语言，这个站有吗（#1138）───────────────────────────────────────────────────────────────
//
// ⑦ 关的是「有没有带语言段」这一维。带了语言段、而那个语言**这个站没有**是同一个洞的第三道入口：
// 站里只有 `en`，模型写 `fr/seo.json` ⟹ 落盘 → `sync-config` rc=0 → commit + push → 老板收到
// 「Done」→ 产物里 0 命中。构建只读 `site_meta.json` 列着的那几个语言。
//
// 🔴 这里的形状照旧是**造出来的**两个字面量 ⟹ 这一格证的是「拿到语言清单之后判得对」。
//    「真站上那份清单读得对不对」是另一个读数，`site-shape.test.js` ⑤ 在真夹具上取。
// 🔴 判据是「这个站有没有这个语言」，不是「这是不是一个合法语言代码」——所以下面 ODD 那三种
//    根本不像语言的段不需要单独一条规则，同一条判断就收了。照症状枚举会在下一种拼法出现时漏
//    （#1109 r2 的账：实测的差集有两族，照字符写漏掉第二族）。
console.log('⑨ 这个语言这个站有吗（#1138）');
{
  const SITE = { flat: false, locales: ['en', 'zh'] };          // 这个站有 en 和 zh
  const shaped = (shape) => ({ readSiteShape: () => shape });
  const head = (s) => String(s).replace(/\n/g, '⏎').slice(0, 110);

  // 站里没有的语言 × 每一类按语言存的内容文件
  const UNKNOWN = ['fr/seo.json', 'fr/services.json', 'de/pages/home.json', 'pt/pages/services/a.json',
    'ja/blog/first.json', 'ko/blocks/site-blocks.json', 'xx/seo.json', 'EN/seo.json'];
  // 不像语言的三种拼法（AC3）。`C:/seo.json` 是 #1109 那道拼写门对 `C:\seo.json` 给出的建议 ——
  // 照它写回来，改之前会落进 `site/C:/`。
  const ODD = ['\t/seo.json', '\n/seo.json', 'C:/seo.json'];

  const problems = [];
  for (const p of UNKNOWN.concat(ODD)) {
    const why = writeRejection(p, shaped(SITE));
    if (why === null) { problems.push(`${JSON.stringify(p)} 竟然可写（写进去没人读，站不会变）`); continue; }
    if (!/multi-language site/.test(why)) problems.push(`${JSON.stringify(p)} 的理由没说这个站是多语言的：${head(why)}`);
    if (!/is not one of the languages it has \(it has: en, zh\)/.test(why)) {
      problems.push(`${JSON.stringify(p)} 的理由没点名这个站有哪几个语言：${head(why)}`);
    }
    const bare = p.split('/').slice(1).join('/');
    if (!why.includes(`en/${bare}`)) problems.push(`${JSON.stringify(p)} 没告诉模型该写哪个路径（应含 en/${bare}）：${head(why)}`);
    // 🔴 不许拿到兜底那句「不是这个站的内容文件」—— 两句话的区别就是模型会不会去改对地方
    if (/is not one of this site's content files/.test(why)) {
      problems.push(`${JSON.stringify(p)} 拿到的是兜底那句「不是这个站的内容文件」：${head(why)}`);
    }
    // 🔴 别把话说死（#1138 N3）：将来有了加语言的路，这道门要跟着放行 ——
    //    所以不许出现 never / permanently 这种断言。
    if (/never|permanently|will not have/i.test(why)) {
      problems.push(`${JSON.stringify(p)} 把话说死了（出现 never / permanently）：${head(why)}`);
    }
    // 🔴 也不许把老板指到某个界面去加语言 —— 那个界面不存在（语言只在建站向导里选）。
    //    这一条是活体跑逼出来的：只说「这条聊天改不了」时，真模型自己补出了「去 dashboard 设置里加」。
    //    整段理由 + 那个事实的仓库读数在 `site-shape.test.js` ⑤c（这里是那一格的快版，不用建夹具）。
    if (!/cannot be done yet/i.test(why) || !/no screen or setting/i.test(why) || /dashboard/i.test(why)) {
      problems.push(`${JSON.stringify(p)} 里「加语言」那半句不对（要说清今天做不到 + 没有那个界面，且不许提 dashboard）：${head(why)}`);
    }
  }
  if (problems.length === 0) {
    ok(`站里没有的语言 ${UNKNOWN.length} 条 + 不像语言的 ${ODD.length} 种拼法全部被拒，`
      + '理由点名了这个站有哪几个语言、该写的路径，而且没把话说死');
  } else problems.forEach(bad);

  // 🔴 正向：这个站**真有**的语言照旧放行（AC2）。少了这一格，把这个分支写成「带语言段就拒」
  //    也能让上面全绿 —— 而那会把多语言站的编辑整条治死。
  const killed = [];
  for (const p of ['en/seo.json', 'zh/seo.json', 'en/services.json', 'zh/pages/home.json',
    'en/pages/services/a.json', 'zh/blog/first.json', 'en/blocks/site-blocks.json', 'brand.json']) {
    const why = writeRejection(p, shaped(SITE));
    if (why !== null) killed.push(`${p} → ${head(why)}`);
  }
  if (killed.length === 0) ok('这个站真有的那两个语言（en / zh）下 7 条内容文件 + 根级 brand.json 照旧放行');
  else killed.forEach((k) => bad(`【应该】可写却被拒了：${k}`));

  // 🔴 语言清单问不出来时这一问不判：`site_meta.json` 在、但读不出来 ⟹ 形状确定是多语言，而
  //    「这个站有哪几个语言」没有答案（`lib/site-shape.js` 文件头第三条）。那时开火 = 在一个真
  //    多语言站上拒掉它唯一正确的路径，理由还是一句「这个站没有 en」的假话。
  const BLIND = { flat: false, locales: [] };
  const overreach = ['en/seo.json', 'fr/seo.json', 'en/pages/home.json', '\t/seo.json']
    .filter((p) => writeRejection(p, shaped(BLIND)) !== null);
  if (overreach.length === 0) {
    ok('语言清单为空（site_meta.json 读不出来）时这一问不判 —— 不拿一句猜的话拒掉正确路径');
  } else bad(`语言清单为空时把这些拒了：${overreach.map((p) => JSON.stringify(p)).join(' · ')}`);

  // 🔴 扁平站那一维不许被这个分支碰：扁平站上带语言段的路径拿到的必须还是 ⑦ 那句「这个站是扁平的」，
  //    不是「这个站没有 fr」——后者对一个扁平站是假话（它一个语言目录都不该有）。
  const flatWhy = writeRejection('fr/seo.json', shaped({ flat: true, locales: [] })) || '';
  if (/flat layout/.test(flatWhy) && !/is not one of the languages/.test(flatWhy)) {
    ok('扁平站上 fr/seo.json 拿到的仍是「这个站是扁平的」那句，不是「这个站没有 fr」');
  } else bad(`扁平站上 fr/seo.json 的理由串了：${head(flatWhy)}`);

  // 🔴 阳性对照：只把这个分支的判断条件掐成 false（在内存里编译，不往交付树放探针），
  //    上面 UNKNOWN + ODD 必须全部回到放行，而 ⑦ 立的两向必须照旧全拒 —— 两边都断言，
  //    只断言前一半的话，一个把整个 wrongPlaceForShape 掐掉的变异也能让这一格绿。
  {
    const REAL = path.join(__dirname, 'editable-files.js');
    const srcReal = require('fs').readFileSync(REAL, 'utf-8');
    const ANCHOR = '  if (!shape.flat && locale && shape.locales.length && !shape.locales.includes(locale)) {\n';
    const n = srcReal.split(ANCHOR).length - 1;
    if (n !== 1) die(`⑨ 阳性对照的锚点在 editable-files.js 里出现 ${n} 次（要求正好 1 次）`);
    const Module = require('module');
    const m = new Module(REAL, module);
    m.filename = REAL;
    m.paths = Module._nodeModulePaths(path.dirname(REAL));
    m._compile(srcReal.replace(ANCHOR, '  if (false) {\n'), REAL);
    const ungated = m.exports.writeRejection;

    const stillRejected = UNKNOWN.concat(ODD).filter((p) => ungated(p, shaped(SITE)) !== null);
    if (stillRejected.length === 0) {
      ok(`⑨ 阳性对照：掐掉那一处之后，这 ${UNKNOWN.length + ODD.length} 条全部回到放行 —— 上面量的是这个分支`);
    } else bad(`⑨ 掐掉之后这些仍被拒：${stillRejected.map((p) => JSON.stringify(p)).join(' · ')}`);

    const leaked = ['seo.json', 'pages/home.json', 'blog/first.json'].filter((p) => ungated(p, shaped(SITE)) === null)
      .concat(['en/seo.json', 'zh/pages/home.json'].filter((p) => ungated(p, shaped({ flat: true, locales: [] })) === null));
    if (leaked.length === 0) ok('⑨ 同一个变异下 #1109 立的两向仍然全拒 ⟹ 这次掐掉的确实只是新加的那一处');
    else bad(`⑨ 这个变异把 #1109 那两向也撤掉了（${leaked.join(' · ')}）⟹ 上面那格证明不了「只撤了新那一处」`);
  }
}

// ── ⑩ #1140（来源 #1109 r2 的两条轻微项）：navigation.json 那条路上「拼写」要排在「读磁盘」前面 ──
//
// 🔴 ⑧ 那一组量的是 `seo.json` —— 它走的是**兜底**那条分支，`spellingMismatch` 在函数末尾就能接住。
//    `navigation.json` 不一样：它在 `contentVerdict` 里有自己的分支（#1104 那道窄口子），而那句裁决是
//    **读了磁盘上那份、比出改了哪几处**之后才有的 ⟹ 拼写不对时读的就是别的文件，于是它回
//    「没法跟磁盘那份比对，先 read_file 一次」。那句话方向指错（真毛病是路径拼法），而且它建议的
//    动作**做不成** —— 对同一个带尾斜杠的路径 read_file 一样读不到。
// 🔴 夹具的承重件是 `readCurrent` 必须**按路径**答话（真的那个是 `edit-site.js §executeTool` 的 `writeCtx.readCurrent`：
//    `fs.existsSync(path.join(siteDir, p)) ? read : null`）。第一版我写成「不看参数、一律回内容」，
//    于是拼错的路径也「比对成功」⟹ 走到末尾那一问、拿到拼写提示，**两臂都绿、这一格什么都没测**。
const NAV10 = {
  header: { links: [{ label: 'Home', href: '/' }], cta: { label: 'Book', href: '/contact' } },
  footer: { description: 'Serving the GTA.', columns: [], copyright: 'Northside Inc.' },
};
const MISSPELLED = ['en/navigation.json/', 'en/navigation.json//', 'en/./navigation.json/'];
{
  const fs10 = require('fs');
  const Module10 = require('module');
  const REAL10 = path.join(__dirname, 'editable-files.js');
  const src10 = fs10.readFileSync(REAL10, 'utf-8');
  const compile = (src) => {
    const m = new Module10(REAL10, module);
    m.filename = REAL10; m.paths = Module10._nodeModulePaths(path.dirname(REAL10));
    m._compile(src, REAL10); return m.exports;
  };
  // 只有正确拼法在"盘"上；拼错的读不到 —— 跟真 readCurrent 一样
  const disk = { 'en/navigation.json': JSON.stringify(NAV10) };
  const ctx10 = {
    readSiteShape: () => ({ flat: false, locales: ['en'] }),
    content: JSON.stringify({ ...NAV10, topbar: { message: '24h emergency', link: { label: 'Call', href: '/contact' } } }),
    readCurrent: (p) => (Object.prototype.hasOwnProperty.call(disk, p) ? disk[p] : null),
  };

  // ⑩a 三种拼错的写法都要拿到**拼写**那句，而不是「读不到磁盘那份」那句
  {
    const wrong = MISSPELLED.filter((p) => {
      const why = String(writeRejection(p, ctx10) || '');
      return !/does not name the file it looks like/.test(why);
    });
    if (wrong.length === 0) {
      ok(`⑩a navigation.json 的 ${MISSPELLED.length} 种拼错写法都拿到「这串字节指的不是那个文件」，不是「先 read_file」`);
    } else bad(`⑩a 这些拿到的还是别的理由：${wrong.map((p) => JSON.stringify(p)).join(' · ')}`);
  }

  // ⑩b 阳性对照：把本票加的那两行从**真源码**里摘掉（在内存里编译，不往交付树放探针），
  //     ⑩a 必须回到「读不到磁盘那份」—— 否则 ⑩a 的绿不是这两行挣来的。
  {
    const A1 = "    const spelling = spellingMismatch(r.relPath, r.canonical);\n";
    const A2 = "    if (spelling) return spelling;\n";
    const n1 = src10.split(A1).length - 1, n2 = src10.split(A2).length - 1;
    if (n1 !== 1 || n2 !== 1) {
      bad(`⑩b 阳性对照立不起来：那两行在 editable-files.js 里各出现 ${n1} / ${n2} 次（要求各 1 次）—— 写法改了就来更新这一格`);
    } else {
      const ungated10 = compile(src10.replace(A1, '').replace(A2, '')).writeRejection;
      const back = MISSPELLED.filter((p) => /could not be compared with the copy on disk/.test(String(ungated10(p, ctx10) || '')));
      if (back.length === MISSPELLED.length) {
        ok(`⑩b 阳性对照：摘掉那两行，${MISSPELLED.length} 种拼错写法全部回到「没法跟磁盘那份比对」 —— ⑩a 量的就是这两行`);
      } else bad(`⑩b 摘掉之后只有 ${back.length}/${MISSPELLED.length} 回到旧理由 —— ⑩a 的绿有一部分不是这两行给的`);
      // 不许连正确拼法一起掐掉
      if (ungated10('en/navigation.json', ctx10) === null) {
        ok('⑩b 同一个变异下正确拼法仍然放行 ⟹ 这次摘掉的确实只是拼写那一问');
      } else bad('⑩b 那个变异把正确拼法也拒了 ⟹ 上面那格证明不了「只摘了拼写那一问」');
    }
  }

  // ⑩c writeNotes 也要自己问一次拼写（#1109 r2 的第二条）。
  //     🔴 今天它**碰巧**是 []（`JSON.parse(null)` 抛，被 catch 吞掉），所以这一格必须在
  //     「拼错的路径也解析得出内容」的场景里量 —— 那正是那条轻微项说的「将来的第二个调用方」。
  {
    const disk2 = { 'en/navigation.json': JSON.stringify(NAV10), 'en/navigation.json/': JSON.stringify(NAV10) };
    const ctx2 = { ...ctx10, readCurrent: (p) => (Object.prototype.hasOwnProperty.call(disk2, p) ? disk2[p] : null) };
    const spoke = mod.writeNotes('en/navigation.json/', ctx2);
    const proper = mod.writeNotes('en/navigation.json', ctx2);
    if (spoke.length === 0 && proper.length > 0) {
      ok('⑩c 拼错的路径即使解析得出内容，writeNotes 也闭嘴；而正确拼法照常说话（不是把它一起掐掉）');
    } else {
      bad(`⑩c writeNotes 对拼错的路径说了 ${spoke.length} 条话（应为 0）、对正确拼法说了 ${proper.length} 条（应 >0）`);
    }
    const GATE = "  if (spellingMismatch(r.relPath, r.canonical)) return [];\n";
    const nG = src10.split(GATE).length - 1;
    if (nG !== 1) {
      bad(`⑩c 阳性对照立不起来：那道门在 editable-files.js 里出现 ${nG} 次（要求 1 次）`);
    } else {
      const un = compile(src10.replace(GATE, '')).writeNotes;
      if (un('en/navigation.json/', ctx2).length > 0) {
        ok('⑩c 阳性对照：摘掉那道门，writeNotes 又开始对**另一个文件**说话 —— 上面那格量的就是它');
      } else bad('⑩c 摘掉那道门之后 writeNotes 照样闭嘴 ⟹ 上面那格什么都没证');
    }
  }
}

console.log(`\n══ 汇总: 通过 ${pass} · 失败 ${fail} ══`);
process.exit(fail ? 1 : 0);
