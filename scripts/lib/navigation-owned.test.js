#!/usr/bin/env node
/**
 * navigation-owned.test.js — #1104：给「AI 聊天编辑器能改顶部那个按钮，改不了菜单链接」这条判断
 * 装一个常设的守卫，**并且把它跟 `sync-config.js` 真代码绑在一起**。
 *
 *   node scripts/lib/navigation-owned.test.js     （由 `npm run test:scripts` 自动发现）
 *   退出码: 0 全过 · 1 有失败 · 2 跑不起来（**不许当成通过**）
 *
 * ── 为什么 ③ 那一格是这份测试里最要紧的 ──────────────────────────────────────────────────────────
 * `navigation-owned.js` 里的 `OWNED` 是一张表。表会漂：明天有人往 `sync-config.js` 里加一句
 * `existingNav.footer.description = …`，`OWNED` 不会跟着变，而那一刻这道门开始放行一个**会被
 * 覆盖**的字段 —— 也就是 #1087 治过的静默失败原样回来，而且三盏灯全绿。
 *
 * 所以 ③ 用真解析器把 `sync-config.js` 里**所有**写进 navigation.json 的位置解析出来，跟 `OWNED`
 * 两向比对。它自带阳性对照（往源码里插一条新的赋值，这一格必须红）—— 少了那个对照，"两边对得上"
 * 也可能是因为解析器一个都没找到。
 */

'use strict';

const fs = require('fs');
const path = require('path');

const mod = require('./navigation-owned.js');
const { OWNED, SIDE_EFFECTS, NAV_SHAPE, navigationEditRejection, buildOwnedChanges } = mod;
const { writeRejection, writeNotes } = require('./editable-files.js');

let pass = 0, fail = 0;
const ok = (m) => { pass++; console.log(`  ✅ ${m}`); };
const bad = (m) => { fail++; console.log(`  ❌ ${m}`); };
const die = (m) => { console.error(`🔴 跑不起来: ${m}`); process.exit(2); };

if (typeof navigationEditRejection !== 'function') die('navigation-owned.js 没导出 navigationEditRejection');
if (!Array.isArray(OWNED) || OWNED.length === 0) die('navigation-owned.js 的 OWNED 是空的');

const TEMPLATE_ROOT = path.join(__dirname, '..', '..');
const SYNC_CONFIG = path.join(TEMPLATE_ROOT, 'scripts', 'sync-config.js');
// ⑩ 的判据源头：tsc 拿这个 interface 去量构建生成的那份数据（src/lib/config.ts:26 的 cast）。
const TYPES_FILE = path.join(TEMPLATE_ROOT, 'src', 'lib', 'types', 'config.ts');

// ── 夹具：一份长得像真站的 navigation.json ─────────────────────────────────────────────────────
const BASE = {
  header: {
    links: [{ label: 'Home', href: '/' }, { label: 'About Us', href: '/about' }],
    cta: { label: 'Book Appointment', href: '/contact' },
  },
  footer: {
    description: 'Serving the Greater Toronto Area since 2014.',
    columns: [
      { title: 'Quick Links', links: [{ label: 'Home', href: '/' }] },
      { title: 'Roof Repair', links: [{ label: 'Emergency roof repair', href: '/roof-repair/emergency' }] },
    ],
    copyright: 'Northside Roofing Inc.',
  },
};
const clone = (o) => JSON.parse(JSON.stringify(o));
/** 走真入口（`writeRejection`）的一次写入。`current` 省略 = 磁盘上就是 BASE。 */
const tryWrite = (relPath, next, current = BASE) => writeRejection(relPath, {
  content: JSON.stringify(next),
  readCurrent: () => (current === null ? null : JSON.stringify(current)),
});

// ── ① 构建不碰的那几处：写得进去 ───────────────────────────────────────────────────────────────
{
  const CASES = [
    ['顶部那个按钮的文字（本票的实物）', (n) => { n.header.cta.label = 'Book Now'; }],
    ['顶部那个按钮的链接', (n) => { n.header.cta.href = '/quote'; }],
    ['文字和链接一起改', (n) => { n.header.cta = { label: 'Get a Quote', href: '/quote' }; }],
    ['页脚版权', (n) => { n.footer.copyright = 'Northside Roofing Ltd.'; }],
    ['页脚那段介绍', (n) => { n.footer.description = 'Roofing across the GTA since 2014.'; }],
    ['第一栏页脚的【标题】（它的 links 才是构建的）', (n) => { n.footer.columns[0].title = '快速链接'; }],
    ['关键词分组那一栏的标题', (n) => { n.footer.columns[1].title = 'Roof Repair & Replacement'; }],
    // #1108 关心的那条路：topbar 内容今天没有别的通道能加。它构建不碰 ⟹ 按本票的判据自然放行。
    ['加一段 topbar 内容', (n) => { n.topbar = { message: '24/7 emergency service', link: { label: 'Call', href: '/contact' } }; }],
    ['什么都没改（空写入不该被拦）', () => {}],
  ];
  const wrong = [];
  for (const [name, mutate] of CASES) {
    const next = clone(BASE);
    mutate(next);
    for (const p of ['navigation.json', 'zh/navigation.json', 'zh_CN/navigation.json']) {
      const why = tryWrite(p, next);
      if (why !== null) wrong.push(`${p} · ${name} → 被拒了：${String(why).split('\n')[0]}`);
    }
  }
  if (wrong.length === 0) ok(`构建不碰的那几处：${CASES.length} 种改法 × 3 种路径形状全部可写`);
  else wrong.forEach(bad);
}

// ── ② 构建会重写的那几处：拒，而且理由要说清去改哪儿 ───────────────────────────────────────────
//
// 🔴 每一格配一个「理由里必须出现的词」。只断言「被拒了」的话，把理由换成 Invalid path 也照样绿，
//    而本票跟 #1087 同一条纪律：拒的理由不说清真相，模型就会替老板编一个不存在的后台页。
{
  const CASES = [
    ['改菜单链接的文字', (n) => { n.header.links[1].label = 'Our Story'; }, 'navLabel'],
    ['给菜单加一条', (n) => { n.header.links.push({ label: 'Blog', href: '/blog' }); }, 'navLabel'],
    ['菜单换顺序', (n) => { n.header.links.reverse(); }, 'navOrder'],
    ['菜单清空', (n) => { n.header.links = []; }, 'header.links'],
    ['改第一栏页脚的链接', (n) => { n.footer.columns[0].links[0].label = 'Start here'; }, 'footer.columns[0].links'],
    ['加一栏页脚', (n) => { n.footer.columns.push({ title: 'X', links: [] }); }, 'footer.columns'],
    ['删一栏页脚', (n) => { n.footer.columns.pop(); }, 'footer.columns'],
  ];
  const problems = [];
  for (const [name, mutate, needle] of CASES) {
    const next = clone(BASE);
    mutate(next);
    const why = tryWrite('en/navigation.json', next);
    if (why === null) problems.push(`${name} → 竟然放行了`);
    else if (!String(why).includes(needle)) problems.push(`${name} → 拒了，但理由里没有 "${needle}"：${String(why).split('\n')[0]}`);
  }
  // 拒绝理由还必须告诉模型这里【能】改什么 —— 否则它只知道不许干什么，就又去说「改不了」。
  const why = tryWrite('navigation.json', (() => { const n = clone(BASE); n.header.links = []; return n; })());
  for (const needle of ['header.cta', 'footer copyright', 'Nothing was written']) {
    if (!String(why).includes(needle)) problems.push(`拒绝理由里没有 "${needle}"`);
  }
  if (problems.length === 0) ok(`构建会重写的那几处：${CASES.length} 种改法全部被拒，理由点名了去改 navLabel / navOrder，也说了这里能改什么`);
  else problems.forEach(bad);
}

// ── ③ 判据跟 sync-config.js 绑在一起：`OWNED` == 那个文件真正写进 navigation.json 的位置 ────────
{
  const found = navWritesInSyncConfig(SYNC_CONFIG);
  if (found.unavailable) die(`③ ${found.unavailable}`);      // 读不出来 ≠ 对得上
  if (found.paths.length === 0) die('③ 在 sync-config.js 里一个写进 navigation.json 的位置都没解析到 —— 这不是「对得上」，这是什么都没查');

  const declared = OWNED.map((o) => o.syncConfigWrite).sort();
  const actual = found.paths.slice().sort();
  const onlyDeclared = declared.filter((d) => !actual.includes(d));
  const onlyActual = actual.filter((a) => !declared.includes(a));
  if (onlyDeclared.length === 0 && onlyActual.length === 0) {
    ok(`③ OWNED 跟 sync-config.js 对得上（${actual.length} 处：${actual.join(' · ')}，变量 ${found.navVar}）`);
  } else {
    if (onlyActual.length) {
      bad(`③ sync-config.js 又重写了这些位置，而 OWNED 里没有：${onlyActual.join(' · ')}`
        + ' —— 也就是这道门正在放行会被覆盖的字段（本票要治的静默失败）。往 OWNED 里加一项。');
    }
    if (onlyDeclared.length) {
      bad(`③ OWNED 里这些位置 sync-config.js 已经不写了：${onlyDeclared.join(' · ')}`
        + ' —— 也就是这道门在拒一个本来能改的字段。把这一项摘掉。');
    }
  }

  // 🔴 阳性对照：往源码副本里插各种写法，③ 那把尺子每一种都必须看得见。
  // 少了这一格，「两边对得上」可能只是因为解析器什么都没找到（那种绿跟全过一模一样）。
  //
  // #1104 r2（QA1 中等①）：上一版只插一种形状 —— `nav.footer.description = …`，也就是提取器
  // 唯一处理得最好的那一种。它证明的是「这把尺子看得见它自己为之而写的那种写法」，不是「它看得见漂」。
  // QA1 自己打的三个探针（`Object.assign` 目标 / 先取别名再改 / `delete`）当时**三盏灯全绿**，
  // 而那三种写法下构建确实重写（或删掉）了那个字段。现在四种一起驱动，一种漏掉这一格就红。
  {
    const src = fs.readFileSync(SYNC_CONFIG, 'utf-8');
    const V = found.navVar;
    // 锚点选「把整份写回磁盘」那一句：插在它正上方 = 真的会被写进文件里的改动。
    const anchor = `  fs.writeFileSync(navPath, JSON.stringify(${V}, null, 2));`;
    if (!src.includes(anchor)) {
      bad(`③ 阳性对照立不起来：源码里找不到锚点 \`${anchor}\``);
    } else {
      // 每一项：插什么 · 期望这把尺子怎么反应
      //   'path:<位置>' = 必须把这个位置报成「构建重写了它」
      //   'cantTell'    = 必须说不出来（unavailable），而不是当成零处
      const SHAPES = [
        ['直接赋值',            `  ${V}.footer.description = 'x';`,                                    'path:footer.description'],
        ['Object.assign 目标',  `  Object.assign(${V}.footer, { description: 'x' });`,                  'path:footer'],
        ['先取别名再改',        `  const qaAlias = ${V}.footer; qaAlias.description = 'x';`,            'cantTell'],
        ['delete',              `  delete ${V}.footer.copyright;`,                                      'path:footer.copyright'],
        ['传给不认识的函数',    `  qaHelper(${V}.footer);`,                                             'cantTell'],
      ];
      const problems = [];
      for (const [name, line, expect] of SHAPES) {
        const doctored = src.replace(anchor, `${line}\n${anchor}`);
        if (doctored === src) { problems.push(`「${name}」这一项插不进去`); continue; }
        const tmp = path.join(fs.mkdtempSync(path.join(require('os').tmpdir(), 'nav-owned-')), 'sync-config.js');
        fs.writeFileSync(tmp, doctored);
        const after = navWritesInSyncConfig(tmp);
        fs.rmSync(path.dirname(tmp), { recursive: true, force: true });
        if (expect === 'cantTell') {
          if (!after.unavailable) {
            problems.push(`「${name}」这把尺子没看见（它应当【说不出来】，实际报的是 ${after.paths.join(' · ')}）`);
          }
        } else {
          const want = expect.slice('path:'.length);
          if (after.unavailable) problems.push(`「${name}」这把尺子跑不起来：${after.unavailable}`);
          else if (!after.paths.includes(want)) {
            problems.push(`「${name}」插进去的 \`${want}\` 没被解析到（解析到的是 ${after.paths.join(' · ')}）`);
          }
        }
      }
      if (problems.length === 0) {
        ok(`③ 阳性对照：${SHAPES.length} 种写法（直接赋值 · Object.assign 目标 · 取别名 · delete · 传给不认识的函数）`
          + '每一种这把尺子都有反应 —— 前四种里能定位的报出位置，认不出的说不出来（所以上面那格的绿是活的）');
      } else {
        problems.forEach((m) => bad(`③ 阳性对照失败：${m} —— 这把尺子对这种写法是盲的，上面那格的绿不作数`));
      }
    }
  }

  // 🔴 对象「流到别处去」这件事按【位置】判，不按那行长什么样。
  // 今天有一处：`navigationByLocale[locale] = existingNav`，它在写回磁盘【之后】，所以通过它做的
  // 改动够不着磁盘上那份 —— 无害。有人把它挪到写回【之前】，这把尺子必须当场说不出来。
  {
    const src = fs.readFileSync(SYNC_CONFIG, 'utf-8');
    const V = found.navVar;
    if (found.escapes.length !== 1) {
      bad(`③ 预期 sync-config.js 里只有 1 处「对象流到别处去」且在写回磁盘之后，实际 ${found.escapes.length} 处`
        + `（${found.escapes.map((e) => `第 ${e.line} 行 ${e.text}`).join(' · ')}）—— 多出来的那处要人看一眼是不是一条看不见的改动通道`);
    } else {
      ok(`③ 唯一那处「对象流到别处去」（第 ${found.escapes[0].line} 行）在写回磁盘之后，够不着磁盘上那份`);
    }
    // 反向对照：把它挪到写回之前，这把尺子必须说不出来
    const writeLine = `  fs.writeFileSync(navPath, JSON.stringify(${V}, null, 2));`;
    const escLine = `  navigationByLocale[locale] = ${V};`;
    if (!src.includes(writeLine) || !src.includes(escLine)) {
      bad('③ 位置对照立不起来：找不到写回那句或流到别处那句');
    } else {
      const doctored = src.replace(writeLine, '').replace(escLine, `${escLine}\n${writeLine}`);
      const tmp = path.join(fs.mkdtempSync(path.join(require('os').tmpdir(), 'nav-owned-')), 'sync-config.js');
      fs.writeFileSync(tmp, doctored);
      const after = navWritesInSyncConfig(tmp);
      fs.rmSync(path.dirname(tmp), { recursive: true, force: true });
      if (after.unavailable) ok('③ 位置对照：把它挪到写回磁盘之前，这把尺子当场说不出来（所以上面那格不是恒绿）');
      else bad(`③ 位置对照失败：挪到写回之前也照样打绿灯（报的是 ${after.paths.join(' · ')}）—— 那个「之后所以无害」的判断没在生效`);
    }
  }

  // 构建把整份写回磁盘这件事本身也要钉一次：它不写回，本票整个前提（改了就生效）就不成立。
  const src = fs.readFileSync(SYNC_CONFIG, 'utf-8');
  if (new RegExp(`fs\\.writeFileSync\\(navPath,[^)]*${found.navVar}`).test(src)) {
    ok('③ sync-config.js 确实把 navigation.json 整份写回磁盘（本票"改了就生效"的前提）');
  } else {
    bad('③ 在 sync-config.js 里找不到把 navigation.json 写回磁盘那句 —— 本票的前提要重新量一次');
  }
}

// ── ④ 材料不齐一律拒（fail-closed）───────────────────────────────────────────────────────────
{
  const problems = [];
  // 没有 ctx：调用方没把内容递进来 ⟹ 判不了「改的是哪几处」⟹ 必须拒
  if (writeRejection('navigation.json') === null) problems.push('没给 ctx 时竟然放行');
  if (writeRejection('zh/navigation.json', {}) === null) problems.push('ctx 是空对象时竟然放行');
  if (writeRejection('navigation.json', { content: JSON.stringify(BASE) }) === null) {
    problems.push('只给 content、没给 readCurrent 时竟然放行');
  }
  // 磁盘上那份读不到 / 不是合法 JSON ⟹ 没有对照物 ⟹ 必须拒
  if (tryWrite('navigation.json', clone(BASE), null) === null) problems.push('磁盘上那份读不到时竟然放行');
  const brokenDisk = writeRejection('navigation.json', {
    content: JSON.stringify(BASE),
    readCurrent: () => '{ this is not json',
  });
  if (brokenDisk === null) problems.push('磁盘上那份不是合法 JSON 时竟然放行');
  // 这次要写的内容不是合法 JSON ⟹ 交给 edit-site.js 那句 Invalid JSON，这里不抢它的话
  const badJson = writeRejection('navigation.json', {
    content: '{ this is not json',
    readCurrent: () => JSON.stringify(BASE),
  });
  if (badJson !== null) problems.push(`这次内容不是合法 JSON 时应该放手给 edit-site.js 报 Invalid JSON，却自己拒了：${badJson}`);
  if (problems.length === 0) ok('④ 材料不齐（没 ctx / 读不到磁盘那份 / 磁盘那份坏了）一律拒；而"这次内容不是 JSON"留给 edit-site.js 报');
  else problems.forEach(bad);
}

// ── ⑤ 构建每次都读的那几处缺了：拒，而且说清缺的是什么 ─────────────────────────────────────────
//
// 放行一份缺了它们的 navigation.json，后果不是"这次编辑没生效"，是这个站从此重建不出来
// （sync-config.js 对 header.cta.href 直接 .replace、对 footer.columns 直接取 .length）。
{
  const CASES = [
    ['按钮整个没了', (n) => { delete n.header.cta; }, 'header.cta'],
    ['按钮没有链接', (n) => { delete n.header.cta.href; }, 'header.cta.href'],
    ['按钮链接写成了空串', (n) => { n.header.cta.href = ''; }, 'header.cta.href'],
    ['按钮没有文字', (n) => { delete n.header.cta.label; }, 'header.cta.label'],
    ['按钮文字写成了数字', (n) => { n.header.cta.label = 42; }, 'header.cta.label'],
    // QA3 在 #1104 r2 报的非阻断第 2 条：纯空白也是一个没有字的按钮。
    ['按钮文字只有空格', (n) => { n.header.cta.label = '   '; }, 'header.cta.label'],
    ['footer.columns 不是数组', (n) => { n.footer.columns = { '0': {} }; }, 'footer.columns'],
    ['footer 整个没了', (n) => { delete n.footer; }, 'footer'],
    ['header 整个没了', (n) => { delete n.header; }, 'header'],
  ];
  const problems = [];
  for (const [name, mutate, needle] of CASES) {
    const next = clone(BASE);
    mutate(next);
    const why = tryWrite('navigation.json', next);
    if (why === null) problems.push(`${name} → 竟然放行了`);
    else if (!String(why).includes(needle)) problems.push(`${name} → 拒了，但理由里没点名 "${needle}"：${String(why).split('\n')[0]}`);
  }
  // 顶层不是对象（模型写了个数组 / 字符串）
  for (const junk of ['[]', '"nope"', 'null', '3']) {
    const why = writeRejection('navigation.json', { content: junk, readCurrent: () => JSON.stringify(BASE) });
    if (why === null) problems.push(`顶层是 ${junk} 时竟然放行`);
  }
  if (problems.length === 0) ok(`⑤ 构建每次都读的那几处缺了：${CASES.length} 种 + 4 种非对象顶层全部被拒，且理由点名了缺的是什么`);
  else problems.forEach(bad);
}

// ── ⑥ 接线：edit-site.js 真的把【内容】和【磁盘上那份】都递进来了 ──────────────────────────────
//
// 🔴 这一格不能只查「调了 writeRejection」：#1087 那份测试查的是 `writeRejection(relPath)`，
//    而本票之后那个写法已经不够 —— 少递 ctx 的话，navigation.json 会走进 ④ 那条 fail-closed 分支，
//    表现是「老板还是改不了那个按钮」，而所有单元测试照样全绿。
{
  const src = fs.readFileSync(path.join(__dirname, '..', 'edit-site.js'), 'utf-8');
  const bads = [];
  if (!/require\(['"]\.\/lib\/editable-files['"]\)/.test(src)) bads.push('没 require lib/editable-files');
  if (!/writeRejection\(\s*relPath\s*,/.test(src)) bads.push('调 writeRejection 时没带第二个参数（ctx）');
  if (!/content:\s*toolInput\.content/.test(src)) bads.push('没把这次要写的内容（toolInput.content）递进去');
  if (!/readCurrent:/.test(src)) bads.push('没把读磁盘上那份的函数（readCurrent）递进去');
  if (!/readCurrent:[\s\S]{0,240}?fs\.readFileSync/.test(src)) bads.push('readCurrent 里没真去读文件');
  // #1104 r2 —— 附带说明那条线也要接上：算出来但没进回话，等于没说（QA1 中等②要治的就是「没人被告知」）。
  if (!/writeNotes\(\s*relPath\s*,/.test(src)) bads.push('没调 writeNotes（放行时那句「菜单也会跟着变」算不出来）');
  if (!/message:[\s\S]{0,200}?sideEffects/.test(src)) bads.push('writeNotes 的结果没进回给模型的 message —— 算出来了但没人看到');
  // #1104 r6 —— 第二问（这个站的页面读不读它）要的那个读数也在这条线上。少了它，`writeNotes` 拿到
  // `rendered = null`，走的是「我说不准」那一支：老板听到的是一句含糊话而不是真相，而单元测试全绿。
  // 📌 真进程那一头由 `edit-site-chain.test.js` 的 ⑦ 驱动（摘掉这个键那一格当场红）；这里是静态那一半。
  if (!/readRenderedRegions:/.test(src)) bads.push('没把「这个站真的画出哪些区」的读数（readRenderedRegions）递进去');
  if (!/readRenderedRegions:[\s\S]{0,400}?resolveSiteRegions/.test(src)) bads.push('readRenderedRegions 里没去问 lib/site-regions（那它答的不是这个站的真实版式）');
  if (bads.length === 0) ok('⑥ edit-site.js 的接线齐了（内容 + 磁盘上那份 + 这个站画出哪些区都递进去了，附带说明也进了回话）');
  else bads.forEach((b) => bad(`⑥ 接线断了：${b} —— 这个模块再对，老板也还是改不了那个按钮`));
}

// ── ⑦ SYSTEM_PROMPT —— **搬到 `editable-files.test.js` 的 ⑥ 去了**（#1104 r6）────────────────────
//
// 这里原来有一格，读的是 `readFileSync(edit-site.js)` 的**整个文件**再 `includes`。#1096（2026-08-20，
// 已在 main 上）把同族的那一格判成了假绿并给出了构造：把 prompt 里那几句真话**搬进文件头注释**、
// prompt 里换成一句假话，8 格全绿 rc=0。一句话说：**文件里有这串 ≠ 模型看到这串。**
//
// ⟹ 本票新增的两条 prompt 断言不能立在那把尺上。`editable-files.test.js` 的 ⑥ 已经有一把量对了的尺
//    （它切出 `const SYSTEM_PROMPT = \`` 到那个没被转义的收尾反引号之间那段，再自检三条），所以这里
//    整格搬过去而不是在这个文件里抄第二份提取器 —— 两份提取器必然分叉，而分叉的方向是假绿。
//    搬过去的是**这一格原有的 6 条 + 本票新增的 2 条**，一条都没丢，各自的理由跟着搬。

// ── ⑧ 分母自检 ───────────────────────────────────────────────────────────────────────────────
{
  // buildOwnedChanges 恒空（判断坏了）会让 ② 全红；恒非空会让 ① 全红。这里再直接钉一次两向。
  const same = buildOwnedChanges(clone(BASE), clone(BASE));
  const diff = buildOwnedChanges((() => { const n = clone(BASE); n.header.links = []; return n; })(), BASE);
  if (same.length === 0 && diff.length > 0) ok('⑧ 差异判断两向都活着（同一份 = 0 处不同 · 动了菜单 = 有不同）');
  else bad(`⑧ 差异判断坏了：同一份算出 ${same.length} 处不同、动了菜单算出 ${diff.length} 处不同`);
}

/**
 * 用真解析器把 `sync-config.js` 里**所有**写进 navigation.json 那个对象的位置解析出来。
 *
 * 判据是**代码的结构**，不是源码的字面格式：正则会被换行、改缩进、`prettier` 绕过，而绕过的方向
 * 是「有一处重写我没数到」，正好是这道门最怕的那件事（同 `block-manifest.js:registryNames` 的理由）。
 *
 * 🔴 变量名不写死成 `existingNav`：先找住着 `navigation.json` 路径的那个变量，再找拿它 `JSON.parse`
 *    出来的那个变量。有人改名时这里会**说不出来**（→ exit 2），而不是静默返回一个空集合。
 *
 * 返回 `{ paths, navVar, unavailable }`。`paths` 是相对 nav 对象的位置，如 `header.links`；
 * 数组的原地修改（`push` / `splice` / …）记成 `<位置>.<方法名>`。
 */
// ── ⑨ 放行了，但别处会跟着变的那些改动要说出来（#1104 r2，QA1 中等②）──────────────────────────
{
  const problems = [];
  const nav = (mutate) => { const n = clone(BASE); mutate(n); return n; };

  // 走真入口 writeNotes（不是只调那个纯函数）—— 接线漏了的话，那几句话到不了模型手里。
  const notesVia = (next) => writeNotes('en/navigation.json', {
    content: JSON.stringify(next),
    readCurrent: () => JSON.stringify(BASE),
  });

  const onlyLabel = notesVia(nav((n) => { n.header.cta.label = 'Book Now'; }));
  if (onlyLabel.length !== 0) problems.push(`只改按钮文字不该有附带说明，实际有 ${onlyLabel.length} 句`);

  const hrefChanged = notesVia(nav((n) => { n.header.cta.href = '/about'; n.header.cta.label = 'Read Our Story'; }));
  if (hrefChanged.length !== 1) {
    problems.push(`改了按钮链接应当带 1 句附带说明，实际 ${hrefChanged.length} 句`);
  } else {
    const text = hrefChanged[0];
    for (const needle of ['/about', BASE.header.cta.href, 'top menu']) {
      if (!text.includes(needle)) problems.push(`那句附带说明里没有 "${needle}"（它必须点名改前改后是哪两页）`);
    }
  }

  // 🔴 它是【说明】不是【拒绝】：同一次编辑必须照常放行，否则本票就白做了。
  const stillAllowed = writeRejection('en/navigation.json', {
    content: JSON.stringify(nav((n) => { n.header.cta.href = '/about'; })),
    readCurrent: () => JSON.stringify(BASE),
  });
  if (stillAllowed !== null) problems.push(`改按钮链接被拒了（本票要它能改）：${stillAllowed}`);

  if (problems.length === 0) {
    ok('⑨ 改按钮链接：照常放行，并且回话里带上「菜单也会跟着变」这句实话；只改文字时不多话');
  } else problems.forEach(bad);
}

// ── ⑨ 那句话不许悄悄变成假话：它描述的耦合必须在 sync-config.js 里真的还在 ──────────────────
{
  const src = fs.readFileSync(SYNC_CONFIG, 'utf-8');
  const problems = [];
  for (const e of SIDE_EFFECTS) {
    for (const needle of e.coupling) {
      if (!src.includes(needle)) {
        problems.push(`\`${e.key}\` 那句附带说明靠的是 sync-config.js 里的 \`${needle}\`，而它不在了`
          + ' —— 那句话现在是假话，要么改话、要么这一项摘掉');
      }
    }
  }
  if (problems.length === 0) {
    ok(`⑨ ${SIDE_EFFECTS.length} 项附带说明各自描述的耦合，在 sync-config.js 里逐句都还在`
      + `（${SIDE_EFFECTS.flatMap((e) => e.coupling).map((c) => `\`${c}\``).join(' · ')}）`);
  } else problems.forEach(bad);

  // 反向对照：把那个过滤拿掉，这一格必须红 —— 否则它只是一句恒真的话。
  const filter = SIDE_EFFECTS[0].coupling[1];
  if (!src.includes(filter)) {
    bad('⑨ 反向对照立不起来：源码里找不到那个过滤');
  } else {
    const doctored = src.split(filter).join('true /* qa removed */');
    const missing = SIDE_EFFECTS[0].coupling.filter((n) => !doctored.includes(n));
    if (missing.length) ok('⑨ 反向对照：把那个过滤从源码里拿掉，这一格当场红（所以上面那格不是恒绿）');
    else bad('⑨ 反向对照失败：过滤拿掉了这一格照样绿 —— 这句话没有真的被钉在代码上');
  }
}

function navWritesInSyncConfig(file) {
  let ts;
  try {
    ts = require('typescript');
  } catch (e) {
    if (e.code !== 'MODULE_NOT_FOUND') throw e;
    return { paths: [], navVar: null, escapes: [], unavailable: '读不到 typescript 这个模块，没法解析 sync-config.js（在 templates/nextjs 里跑 npm ci）' };
  }
  const src = fs.readFileSync(file, 'utf-8');
  const sf = ts.createSourceFile(file, src, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);

  // 原地改数组的那些方法。`push` 之外的今天一个都没用到，但漏掉任何一个的方向都是「没数到」。
  const MUTATORS = new Set(['push', 'pop', 'shift', 'unshift', 'splice', 'sort', 'reverse', 'fill', 'copyWithin']);
  // 确定不改对象的那些方法。🔴 白名单而不是黑名单：认不出的方法名一律「说不出来」，
  // 因为一个没见过的方法既可能是只读的、也可能是原地改的，而猜错的那个方向是静默放行。
  const SAFE_READS = new Set([
    'replace', 'replaceAll', 'trim', 'trimStart', 'trimEnd', 'split', 'join', 'slice', 'concat',
    'toString', 'toLowerCase', 'toUpperCase', 'startsWith', 'endsWith', 'includes', 'indexOf',
    'lastIndexOf', 'padStart', 'padEnd', 'charAt', 'repeat', 'match', 'map', 'filter', 'find',
    'findIndex', 'some', 'every', 'reduce', 'flat', 'flatMap', 'at', 'keys', 'values', 'entries',
    'hasOwnProperty',
  ]);

  /** 一条 `a.b[0].c` 链的根标识符 + 相对根的位置文本；不是这种链就返回 null。 */
  const chain = (node) => {
    const segs = [];
    let cur = node;
    for (;;) {
      if (ts.isPropertyAccessExpression(cur)) { segs.unshift(`.${cur.name.text}`); cur = cur.expression; continue; }
      if (ts.isElementAccessExpression(cur)) { segs.unshift(`[${cur.argumentExpression.getText()}]`); cur = cur.expression; continue; }
      break;
    }
    if (!ts.isIdentifier(cur)) return null;
    return { root: cur.text, rel: segs.join('').replace(/^\./, '') };
  };

  // ① 哪个变量是 navigation.json 的路径？（`const navPath = path.join(localeDir, 'navigation.json')`）
  let pathVar = null;
  // ② 哪个变量是它 JSON.parse 出来的那个对象？（`const existingNav = JSON.parse(fs.readFileSync(navPath…))`）
  let navVar = null;
  const findVars = (node) => {
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer) {
      const init = node.initializer.getText();
      if (!pathVar && init.includes("'navigation.json'")) pathVar = node.name.text;
      else if (pathVar && !navVar && init.includes('JSON.parse') && new RegExp(`\\b${pathVar}\\b`).test(init)) {
        navVar = node.name.text;
      }
    }
    ts.forEachChild(node, findVars);
  };
  findVars(sf);
  if (!pathVar) return { paths: [], navVar: null, escapes: [], unavailable: "在 sync-config.js 里找不到住着 'navigation.json' 的那个变量" };
  if (!navVar) return { paths: [], navVar: null, escapes: [], unavailable: `找到了路径变量 ${pathVar}，但找不到把它 JSON.parse 出来的那个变量` };

  // ③ 把整份写回磁盘那一句在哪。#1104 r2：对象在【那一句之后】流到别处去是够不着磁盘的，
  //    在它【之前】流走就是一条这把尺子看不见的改动通道 —— 两者必须分开判，判据是位置而不是那行长什么样。
  let writeBackPos = null;
  const findWriteBack = (node) => {
    if (ts.isCallExpression(node)
        && node.expression.getText() === 'fs.writeFileSync'
        && node.arguments.length > 0
        && node.arguments[0].getText() === pathVar) {
      if (writeBackPos === null) writeBackPos = node.getStart();
    }
    ts.forEachChild(node, findWriteBack);
  };
  findWriteBack(sf);

  // ④ 逐个看 navVar 的【每一处出现】，按用法归类。
  //    #1104 r2（QA1 中等①）：上一版只认「直接赋值 / 数组原地改 / 整个对象被换掉」这三种形状，
  //    别的写法（`Object.assign(nav.footer, …)` · `const q = nav.footer; q.x = …` · `delete nav.x`）
  //    一处都没归类，于是被当成「零处重写」而这一格打的是**肯定句**的绿灯。
  //    现在的纪律与「变量改名」那一维一致：认不出的用法一律【说不出来】（unavailable → 调用方 exit 2），
  //    不许静默当成没有。
  const paths = new Set();
  const escapes = [];
  const cantTell = [];

  /** 从这个标识符往外走到最长的那条访问链（`nav` → `nav.footer.columns`）。 */
  const outermost = (id) => {
    let n = id;
    while (n.parent
           && ((ts.isPropertyAccessExpression(n.parent) && n.parent.expression === n)
               || (ts.isElementAccessExpression(n.parent) && n.parent.expression === n))) {
      n = n.parent;
    }
    return n;
  };

  const lineOf = (node) => sf.getLineAndCharacterOfPosition(node.getStart()).line + 1;
  const snippet = (node) => {
    const stmt = (function up(n) { return (!n.parent || ts.isSourceFile(n.parent)) ? n : (ts.isStatement(n) ? n : up(n.parent)); })(node);
    return stmt.getText().split('\n')[0].trim().slice(0, 90);
  };

  const classify = (id) => {
    const node = outermost(id);
    const c = chain(node);
    const rel = c ? c.rel : '';
    const p = node.parent;
    if (!p) { cantTell.push({ line: lineOf(node), why: '没有父节点', text: snippet(node) }); return; }

    // 赋值的左边：`nav.header.links = …`（含 `+=` 这类复合赋值）
    if (ts.isBinaryExpression(p)
        && p.operatorToken.kind >= ts.SyntaxKind.FirstAssignment
        && p.operatorToken.kind <= ts.SyntaxKind.LastAssignment
        && p.left === node) {
      paths.add(rel === '' ? '(整个对象被重新赋值)' : rel);
      return;
    }
    // `delete nav.footer.copyright` —— 删掉也是构建改了这个位置
    if (ts.isDeleteExpression(p)) {
      paths.add(rel === '' ? '(整个对象被重新赋值)' : rel);
      return;
    }
    // 方法调用，链本身是被调的那个：`nav.footer.columns.push(…)` / `nav.header.cta.href.replace(…)`
    if (ts.isCallExpression(p) && p.expression === node && ts.isPropertyAccessExpression(node)) {
      const m = node.name.text;
      if (MUTATORS.has(m)) { paths.add(rel); return; }
      if (SAFE_READS.has(m)) return;                     // 只读，不记
      cantTell.push({ line: lineOf(node), why: `方法 \`${m}\` 不在「确定只读」那张白名单里`, text: snippet(node) });
      return;
    }
    // 当参数传出去
    if (ts.isCallExpression(p) && p.arguments.includes(node)) {
      const callee = p.expression.getText();
      const idx = p.arguments.indexOf(node);
      if (callee === 'JSON.stringify') return;                       // 只读
      if (callee === 'Object.assign') {
        if (idx === 0) { paths.add(rel === '' ? '(整个对象被重新赋值)' : rel); return; }  // 目标 = 被改的那个
        return;                                                       // 源 = 只读
      }
      cantTell.push({ line: lineOf(node), why: `被当参数传给 \`${callee}\`（传出去之后改了什么这里看不见）`, text: snippet(node) });
      return;
    }
    // 被存到别处去：`x = nav` · `const q = nav.footer` · 放进对象/数组字面量
    const escaped = (ts.isBinaryExpression(p) && p.operatorToken.kind === ts.SyntaxKind.EqualsToken && p.right === node)
      || (ts.isVariableDeclaration(p) && p.initializer === node)
      || ts.isPropertyAssignment(p) || ts.isArrayLiteralExpression(p) || ts.isSpreadElement(p)
      || ts.isShorthandPropertyAssignment(p) || ts.isReturnStatement(p);
    if (escaped) {
      const after = writeBackPos !== null && node.getStart() > writeBackPos;
      const rec = { line: lineOf(node), rel, text: snippet(node), afterWriteBack: after };
      if (after) escapes.push(rec);
      else cantTell.push({ line: rec.line, why: '对象在写回磁盘【之前】就流到别处去了 —— 通过它做的改动这把尺子看不见', text: rec.text });
      return;
    }
    // 比较 / 算术 / 模板 / 括号 / 取反 …… 这些都只读
    if (ts.isBinaryExpression(p) || ts.isPrefixUnaryExpression(p) || ts.isPostfixUnaryExpression(p)
        || ts.isTemplateSpan(p) || ts.isParenthesizedExpression(p) || ts.isIfStatement(p)
        || ts.isConditionalExpression(p) || ts.isExpressionStatement(p)) {
      return;
    }
    cantTell.push({ line: lineOf(node), why: `没见过的用法（父节点是 ${ts.SyntaxKind[p.kind]}）`, text: snippet(node) });
  };

  const walk = (node) => {
    if (ts.isIdentifier(node) && node.text === navVar) {
      const isDeclName = ts.isVariableDeclaration(node.parent) && node.parent.name === node;
      const isPropName = ts.isPropertyAccessExpression(node.parent) && node.parent.name === node;
      if (!isDeclName && !isPropName) classify(node);
    }
    ts.forEachChild(node, walk);
  };
  walk(sf);

  if (cantTell.length) {
    const lines = cantTell.map((c) => `第 ${c.line} 行 ${c.why} —— \`${c.text}\``).join('；');
    return {
      paths: [...paths], navVar, escapes,
      unavailable: `sync-config.js 里有 ${cantTell.length} 处对 \`${navVar}\` 的用法归不了类，所以「它重写了哪几处」这个问题今天答不了：${lines}`,
    };
  }
  return { paths: [...paths], navVar, escapes, unavailable: null };
}

// ── ⑩ 判据跟 src/lib/types/config.ts 绑在一起：`NAV_SHAPE` == `NavigationConfig` ─────────────────
//
// #1104 r3（QA3 阻断）。这道门有**三个**读者，上一版只认了两个：
//   · `sync-config.js` 直接读的那两处（`header.cta.href` 拿去 `.replace`、`footer.columns` 取 `.length`）
//   · 🔴 **tsc** —— `src/lib/config.ts:26` 把构建生成的那份数据 cast 成
//     `Record<string, NavigationConfig>`，任何字段跟那个类型对不上，`npm run build` 整个死掉。
// 漏掉第三个的后果 QA3 实测过：老板说「把页脚版权行去掉」→ 门放行 → sync-config rc=0（#1087 那道
// 保存前检查看不见）→ 聊天说改好了 → 自动保存 push 进站仓 → 这个站从此建不出来。
//
// 跟 ③ 同一条纪律：`NAV_SHAPE` 是一张会漂的镜像，所以这里用 **TypeScript 自己的解析器**把那个
// interface 读出来跟它两向比对，并且配阳性对照（改那个 .ts 的副本，这把尺子每一种改法都要有反应）。
{
  const found = navShapeFromTypes(TYPES_FILE);
  if (found.unavailable) die(`⑩ ${found.unavailable}`);        // 读不出来 ≠ 对得上
  const fromTypes = flattenShape(found.shape);
  const declared = flattenShape(NAV_SHAPE);
  if (fromTypes.length === 0) die('⑩ 从 NavigationConfig 里一个字段都没解析到 —— 这不是「对得上」，这是什么都没查');

  const onlyTypes = fromTypes.filter((x) => !declared.includes(x));
  const onlyDeclared = declared.filter((x) => !fromTypes.includes(x));
  if (onlyTypes.length === 0 && onlyDeclared.length === 0) {
    ok(`⑩ NAV_SHAPE 跟 NavigationConfig 对得上（${declared.length} 处：${declared.join(' · ')}）`);
  } else {
    if (onlyTypes.length) {
      bad(`⑩ NavigationConfig 里有这些、而 NAV_SHAPE 里没有：${onlyTypes.join(' · ')}`
        + ' —— 也就是这道门正在放行一份让 tsc 报错的 navigation.json，写进去之后这个站建不出来（QA3 在 #1104 r2 抓到的就是这件事）。往 NAV_SHAPE 里补上。');
    }
    if (onlyDeclared.length) {
      bad(`⑩ NAV_SHAPE 里有这些、而 NavigationConfig 里没有：${onlyDeclared.join(' · ')}`
        + ' —— 也就是这道门在按一个已经不存在的要求拒，老板改不了本来能改的东西。把这几项摘掉。');
    }
  }

  // 🔴 阳性对照：改那个 .ts 文件的副本，这把尺子每一种改法都必须有反应。
  // 少了这一格，「对得上」也可能只是因为解析器什么都没读到（那种绿跟全过一模一样）。
  {
    const src = fs.readFileSync(TYPES_FILE, 'utf-8');
    // `footer` 那个内联对象的原文 —— 下面两格 extends 的锚点。它变了的话，`doctored === src`
    // 会让那一格报「锚点不在了」，而不是悄悄跳过。
    const FOOTER_INLINE = '  footer: {\n    description: string;\n    columns: FooterColumn[];\n    copyright: string;\n  };\n';
    // 'differs' = 必须报出跟 NAV_SHAPE 不同 · 'cantTell' = 必须说不出来（unavailable），不许当成对得上
    const SHAPES = [
      ['加一个必需字段',      (s) => s.replace('export interface NavigationConfig {', 'export interface NavigationConfig {\n  newThing: string;'), 'differs'],
      ['必需改成可选',        (s) => s.replace('    copyright: string;', '    copyright?: string;'), 'differs'],
      ['删掉一个字段',        (s) => s.replace('    description: string;\n', ''), 'differs'],
      ['可选改成必需',        (s) => s.replace('  topbar?: {', '  topbar: {'), 'differs'],
      ['跨类型引用里改可选',  (s) => s.replace('export interface NavLink {\n  label: string;\n  href: string;', 'export interface NavLink {\n  label: string;\n  href?: string;'), 'differs'],
      ['换成认不出的类型',    (s) => s.replace('export interface FooterColumn {\n  title: string;', 'export interface FooterColumn {\n  title: number;'), 'cantTell'],
      // 🔴 #1104 r4（QA1 的 ⑩）：`extends` 是「往那个 interface 里加一个必需字段」的一种很普通的写法，
      //    而继承来的成员【不在】 `decl.members` 里。这两格之前都是**静默绿** —— 解析到的处数改前改后
      //    逐字相同，而那个类型下站里那份 navigation.json 会让 `src/lib/config.ts` 那句 cast 报 TS2352。
      //    两个都要有：漂可以发生在 `NavigationConfig` 自己身上，也可以发生在链上任何一个别的 interface 上。
      ['自己 extends 一个带必需字段的基接口',
        (s) => 'export interface QaNavBase { legalNotice: string; }\n'
          + s.replace('export interface NavigationConfig {', 'export interface NavigationConfig extends QaNavBase {'), 'cantTell'],
      ['链上别的 interface extends（footer 抽成具名的）',
        (s) => s.replace(FOOTER_INLINE, '  footer: QaFooterConfig;\n')
          + '\nexport interface QaFooterBase { legalNotice: string; }\n'
          + 'export interface QaFooterConfig extends QaFooterBase {\n'
          + FOOTER_INLINE.replace(/^  footer: \{\n/, '').replace(/\n  \};\n$/, '') + '\n}\n', 'cantTell'],
      // 同族的第二种：同名 interface 会被 TypeScript 合并，而这把尺子的 Map 只留最后一个。
      ['同名 interface 声明第二次（声明合并）',
        (s) => s + '\nexport interface NavigationConfig { legalNotice: string; }\n', 'cantTell'],
    ];
    const problems = [];
    for (const [name, doctor, expect] of SHAPES) {
      const doctored = doctor(src);
      if (doctored === src) { problems.push(`「${name}」这一项改不进去（锚点不在了）`); continue; }
      const dir = fs.mkdtempSync(path.join(require('os').tmpdir(), 'nav-shape-'));
      const tmp = path.join(dir, 'config.ts');
      fs.writeFileSync(tmp, doctored);
      const after = navShapeFromTypes(tmp);
      fs.rmSync(dir, { recursive: true, force: true });
      if (expect === 'cantTell') {
        if (!after.unavailable) {
          problems.push(`「${name}」这把尺子没看见（它应当【说不出来】，实际读出了 ${flattenShape(after.shape).length} 处）`);
        }
      } else if (after.unavailable) {
        problems.push(`「${name}」这把尺子跑不起来：${after.unavailable}`);
      } else if (flattenShape(after.shape).join('|') === declared.join('|')) {
        problems.push(`「${name}」改完之后跟 NAV_SHAPE 还是一模一样 —— 这把尺子对这种漂是盲的`);
      }
    }
    if (problems.length === 0) {
      ok(`⑩ 阳性对照：${SHAPES.length} 种漂（加字段 · 必需↔可选两向 · 删字段 · 跨类型引用 · 换成认不出的类型 · extends 两处 · 声明合并）`
        + '每一种这把尺子都有反应 —— 认得出的报不同，认不出的说不出来（所以上面那格的绿是活的）');
    } else {
      problems.forEach((m) => bad(`⑩ 阳性对照失败：${m} —— 上面那格的绿不作数`));
    }
  }

  // ⑩ 的前提：tsc 真的会拿 NavigationConfig 去量构建生成的那份数据。
  // 有人把这句 cast 改成先转 `unknown`，整组就成了一句空话 —— 那时这一格必须红。
  {
    const cfg = fs.readFileSync(path.join(TEMPLATE_ROOT, 'src', 'lib', 'config.ts'), 'utf-8');
    if (/_navigationByLocale as Record<string, NavigationConfig>/.test(cfg)) {
      ok('⑩ 前提还在：src/lib/config.ts 把构建生成的那份数据直接 cast 成 Record<string, NavigationConfig>（tsc 因此会量它）');
    } else {
      bad('⑩ 前提没了：src/lib/config.ts 不再把那份数据直接 cast 成 Record<string, NavigationConfig>'
        + ' —— NAV_SHAPE 凭什么等于「构建读的全集」要重新量一次（先转 unknown 的写法会让 tsc 一句话都不说）');
    }
  }
}

// ── ⑪ 放行字段里塞的【值】：形状不对一律拒（#1104 r3，QA3 的阻断项）────────────────────────────
//
// 🔴 这一组跟 ⑤ 不是一回事：⑤ 问的是「构建每次都读的那几处在不在」，⑪ 问的是「放行的那几处里
//    塞进去的值，构建吃不吃得下」。QA3 打的 15 种值里有 6 种是门放行 + 下一次构建 rc=1。
{
  const CASES = [
    ['老板说「把页脚版权行去掉」', (n) => { delete n.footer.copyright; }, 'footer.copyright'],
    ['版权写成 null', (n) => { n.footer.copyright = null; }, 'footer.copyright'],
    ['版权写成一个对象', (n) => { n.footer.copyright = { note: 'x' }; }, 'footer.copyright'],
    ['页脚那段介绍写成数组', (n) => { n.footer.description = ['a']; }, 'footer.description'],
    ['页脚那段介绍整个没了', (n) => { delete n.footer.description; }, 'footer.description'],
    ['栏标题写成一个对象', (n) => { n.footer.columns[0].title = { t: 1 }; }, 'footer.columns[0].title'],
    ['topbar 写成一个字符串', (n) => { n.topbar = 'hello'; }, 'topbar'],
    ['topbar 有了但没有 message', (n) => { n.topbar = { link: { label: 'C', href: '/c' } }; }, 'topbar.message'],
    ['关键词那一栏的链接项坏了', (n) => { n.footer.columns[1].links = [{ label: 5, href: '/x' }]; }, 'footer.columns[1].links[0].label'],
    ['关键词那一栏没有 links', (n) => { delete n.footer.columns[1].links; }, 'footer.columns[1].links'],
  ];
  const problems = [];
  for (const [name, mutate, needle] of CASES) {
    const next = clone(BASE);
    mutate(next);
    const why = tryWrite('en/navigation.json', next);
    if (why === null) problems.push(`${name} → 竟然放行了（写进去这个站下一次就建不出来）`);
    else if (!String(why).includes(needle)) problems.push(`${name} → 拒了，但理由里没点名 "${needle}"：${String(why).split('\n')[1] || ''}`);
  }
  if (problems.length === 0) ok(`⑪ 放行字段里塞坏值：${CASES.length} 种全部被拒，理由点名了是哪一处`);
  else problems.forEach(bad);
}

// ── ⑪ 反向：tsc 不管的东西这道门也不许**拒**（多拒 = 这个站改不动，#1013 r2 那道门的坑）────────
//
// `as` 那种 cast 只查「两个类型有没有足够重叠」，多出来的键 tsc 一个字都不说。实测过（#1104 r3，
// skipAI 真站 + 真 tsc）：顶层加陌生键 / footer 里加陌生键 / cta 里加陌生键，三种都 rc=0。
// 🔴 这一格钉的只是「不拒」。**「不拒」不等于「不说」** —— 那几个键谁都不读，不说出来就是 #1128 要治
//    的那个静默失败，而这一格的绿正好是它的样子。管「必须说」的那一半在 ⑯，两格缺一不可。
{
  const CASES = [
    ['顶层多一个没人认识的键', (n) => { n.somethingNew = { a: 1 }; }],
    ['footer 里多一个陌生键', (n) => { n.footer.extraThing = 5; }],
    ['按钮上多一个陌生键', (n) => { n.header.cta.style = 'big'; }],
    ['topbar 只写 message（link 是可选的）', (n) => { n.topbar = { message: '24/7 emergency service' }; }],
    ['本来就没有 topbar（可选，缺了不算错）', (n) => { delete n.topbar; }],
  ];
  const problems = [];
  for (const [name, mutate] of CASES) {
    const next = clone(BASE);
    mutate(next);
    const why = tryWrite('en/navigation.json', next);
    if (why !== null) problems.push(`${name} → 被拒了，而 tsc 不管这个：${String(why).split('\n')[1] || String(why).split('\n')[0]}`);
  }
  if (problems.length === 0) ok(`⑪ 反向：${CASES.length} 种 tsc 不管的写法这道门也放行（多拒的方向是「这个站改不动」）`);
  else problems.forEach(bad);
}

// ── ⑯ 放行了，可那几个键**谁都不读** —— 必须点名（#1128）────────────────────────────────────────
//
// 🔴 这一格是 ⑪ 反向那一格的另一半，两格缺一不可：⑪ 反向钉的是「不许拒」（多拒 = 这个站改不动），
//    ⑯ 钉的是「不许不说」。少了 ⑯，⑪ 反向的绿正好就是本票要治的那个静默失败。
// 判据两向都钉：陌生键在 ⟹ 恰好多出那一句且点名每一个键；正当编辑 ⟹ **一句都不许多**
// （多说一句就是新的假话，同 ⑬ 的 AC3）。
{
  // 🔴 认这一句用的串必须**单复数都命中**：那句话一个键时是 "It is not a field of navigation.json"、
  //    多个键时是 "They are not fields of navigation.json"（#1136 改的措辞）。只挑单数那一种，
  //    多键那几格会读到 0 句 —— 而 0 句在下面 AC3 那一半正好是"通过"的样子，也就是这把尺子会
  //    在自己失明的时候打绿灯。取两边共有的那一段。
  const NEEDLE = 'navigation.json, so nothing reads';
  // 这个站：多栏页脚 + 常规顶栏 + 没有 topbar 区 —— 挑它是为了让 ⑬ 那一路（「你这个站看不到」）
  // 对下面每一格都**不**开口，于是这一格数出来的句子只可能是本票加的那一句。
  const SITE = { header: ['solid-bar'], footer: ['multi-column'], topbar: [] };
  const notesFor = (next, rel = 'en/navigation.json') => writeNotes(rel, {
    content: JSON.stringify(next),
    readCurrent: () => JSON.stringify(BASE),
    readRenderedRegions: () => SITE,
  });
  const mine = (next, rel) => notesFor(next, rel).filter((n) => n.includes(NEEDLE));
  // 🔴 三种路径形状都要走一遍：`resolveRel` / `splitLocale` 判「这是哪个文件」的那条分支按形状不同
  //    （老扁平站根级那份没有 locale 段），而放不放行和说不说话都挂在它后面。① 已经在**放行**那一半
  //    上钉了这三种，这里钉的是**说话**那一半。
  const SHAPES = ['navigation.json', 'en/navigation.json', 'zh_CN/navigation.json'];

  // 第一二格就是本票 AC1 / AC2 的两臂（QA2 在 #1104 r4 真机上量的那两个）。
  const CASES = [
    ['B 臂：footer 多一个 copyRight（原 copyright 仍在）', (n) => { n.footer.copyRight = 'X Ltd.'; }, ['footer.copyRight']],
    ['C 臂：header.cta 多一个 text（label 没动）', (n) => { n.header.cta.text = 'Book Now'; }, ['header.cta.text']],
    ['顶层多一个没人认识的键', (n) => { n.somethingNew = { a: 1 }; }, ['somethingNew']],
    ['一次多两个键', (n) => { n.footer.copyRight = 'X'; n.header.cta.text = 'Y'; }, ['footer.copyRight', 'header.cta.text']],
    // 陌生子树只报最外面那一层 —— 里面每一层同样没人读，逐层报是把同一件事说成好几件。
    ['陌生键底下还套着东西', (n) => { n.footer.extra = { a: { b: 1 } }; }, ['footer.extra']],
    ['第二栏那个对象上多一个键（构建不重写它 ⟹ 走得到这一步）', (n) => { n.footer.columns[1].note = 'x'; }, ['footer.columns[1].note']],
    ['topbar 里多一个键', (n) => { n.topbar = { message: '24/7', urgent: true }; }, ['topbar.urgent']],
  ];
  const problems = [];
  for (const [name, mutate, expect] of CASES) {
    const next = clone(BASE);
    mutate(next);
    // 先确认它**没被拒** —— 本票选的是「放行 + 说出来」，拒了的话下面数句子是数不到的。
    const why = tryWrite('en/navigation.json', next);
    if (why !== null) { problems.push(`${name} → 被拒了（本票选的是放行+说实话）：${String(why).split('\n')[0]}`); continue; }
    // 三种路径形状读数必须一致 —— 有一种不说话，就是「这个站的形状决定老板听不听得到实话」
    const byShape = SHAPES.map((rel) => [rel, mine(next, rel).length]);
    const off = byShape.filter(([, n]) => n !== 1);
    if (off.length) { problems.push(`${name} → 那句话在 ${off.map(([r, n]) => `${r}:${n} 次`).join(' · ')}（每种路径形状都要恰好 1 次）`); continue; }
    const said = mine(next);
    const missing = expect.filter((k) => !said[0].includes(k));
    if (missing.length) problems.push(`${name} → 说了，但没点名 ${missing.join(' / ')}：${said[0].split('\n')[1] || ''}`);
    // 后果必须写成「页面不会变」，不是「可能不生效」；而且要给一条照做有用的路。
    // 🔴 needle 挑的是**两种数都命中**的那一段：一个键时那句话是 "it changes nothing on the site"、
    //    多个键时是 "they change nothing on the site" —— 只写单数那一种，多键那一格会因为**措辞**红，
    //    而它量的其实是「有没有说后果」。
    // #1136 —— 这四段是那句话的承重部分，少一段就是本票要治的那个假话换个样子：
    //   ① 后果写成「页面不会变」            ' nothing on the site:'
    //   ② 事实钉死「键还在刚存下的那份里」    'on disk right now'
    //   ③ 四种说法明文禁掉：前三种是 4 次真 LLM 里实际出现过的那三句假话；第四种
    //      （'do not say the build does not read'）是第一版措辞跑完 5 次之后加的 —— 那 5 次
    //      假话 0 次，但 4 次把「谁都不读它」压成了「构建不读它」，而那句话是假的（#1128 在
    //      真站上量过：那个键进了产物、连访客浏览器都收到了，没有的是页面去看它）
    //   ④ 还是要给一条照做有用的路          'header.cta'（来自 NAVIGATION_EDITABLE_SUMMARY）
    // 🔴 ③ 那三条挑的都是**单复数同形**的片段（`removed it` / `removed them` 的公共前缀等），
    //    理由跟上面 NEEDLE 那条一样。
    for (const needle of [' nothing on the site:', 'on disk right now', 'do not tell the owner that you removed',
      'only the recognised fields were saved', 'that you will clean', 'do not say the build does not read',
      'header.cta']) {
      if (!said[0].includes(needle)) problems.push(`${name} → 那句话里没有 "${needle}"`);
    }
    // 报出来的键数 == 真的陌生键数（多报一个就是对一个真生效的字段说假话）
    const listed = said[0].split('\n').filter((l) => l.startsWith('  - ')).map((l) => l.slice(4));
    if (listed.length !== expect.length) problems.push(`${name} → 列了 ${listed.length} 个键，该是 ${expect.length} 个：${listed.join(' / ')}`);
  }

  // 🔴 反向（AC3）：#1104 那些**正当**编辑一句都不许多。这一半不是可选的 —— 没有它，把判据写成
  //    「恒定说一句」也能让上面全绿，而那句话对每一次正常编辑都是假话。
  const LEGIT = [
    ['改按钮文字', (n) => { n.header.cta.label = 'Book Now'; }],
    ['改按钮链接', (n) => { n.header.cta.href = '/quote'; }],
    ['文字和链接一起改', (n) => { n.header.cta = { label: 'Get a Quote', href: '/quote' }; }],
    ['改页脚版权', (n) => { n.footer.copyright = 'Northside Roofing Ltd.'; }],
    ['版权设成空串', (n) => { n.footer.copyright = ''; }],
    ['页脚介绍', (n) => { n.footer.description = 'Roofing across the GTA since 2014.'; }],
    ['介绍设成空串', (n) => { n.footer.description = ''; }],
    ['两处一起清空', (n) => { n.footer.copyright = ''; n.footer.description = ''; }],
    ['第一栏标题', (n) => { n.footer.columns[0].title = 'What We Do'; }],
    ['第二栏标题', (n) => { n.footer.columns[1].title = 'Roof Repair & Replacement'; }],
    ['第二栏链接', (n) => { n.footer.columns[1].links[0].label = 'Emergency callout'; }],
    ['加 topbar（只 message）', (n) => { n.topbar = { message: '24/7 emergency service' }; }],
    ['加 topbar（message + link）', (n) => { n.topbar = { message: '24/7', link: { label: 'Call', href: '/contact' } }; }],
    ['只换键序', (n) => { const f = n.footer; n.footer = { copyright: f.copyright, columns: f.columns, description: f.description }; }],
    ['什么都没改', () => {}],
  ];
  let clean = 0;
  for (const [name, mutate] of LEGIT) {
    const next = clone(BASE);
    mutate(next);
    const why = tryWrite('en/navigation.json', next);
    if (why !== null) { problems.push(`正当编辑「${name}」被拒了：${String(why).split('\n')[0]}`); continue; }
    const said = mine(next);
    if (said.length !== 0) problems.push(`正当编辑「${name}」被多说了一句：${said[0].split('\n')[0]}`);
    else clean++;
  }
  if (problems.length === 0) ok(`⑯ 形状外的键：${CASES.length} 种 × ${SHAPES.length} 种路径形状全部放行且点名（含 AC1/AC2 两臂）· ${clean}/${LEGIT.length} 种正当编辑零多话`);
  else problems.forEach(bad);
}



/**
 * 把 `src/lib/types/config.ts` 里的 `NavigationConfig`（连着它引用的 `NavLink` / `FooterColumn`）
 * 用 **TypeScript 自己的解析器**读成跟 `NAV_SHAPE` 同一种结构。
 *
 * 🔴 认不出来的东西一律 `unavailable`，**不许当成「这里没有字段」**：这两件事在汇总行里长得一样，
 *    而它们的方向相反 —— 据「认不出」当成对得上，正好把 QA3 抓到的那个洞放回去。
 *
 * @returns {{shape: object}|{unavailable: string}}
 */
function navShapeFromTypes(file) {
  let ts;
  try { ts = require('typescript'); } catch (e) { return { unavailable: `require('typescript') 失败：${e.message}` }; }
  let text;
  try { text = fs.readFileSync(file, 'utf-8'); } catch (e) { return { unavailable: `读不到 ${file}：${e.message}` }; }

  const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true);
  const ifaces = new Map();
  const duplicated = new Set();
  source.forEachChild((n) => {
    if (!ts.isInterfaceDeclaration(n)) return;
    if (ifaces.has(n.name.text)) duplicated.add(n.name.text);   // 声明合并：下面那个 Map 只留最后一个
    ifaces.set(n.name.text, n);
  });
  if (!ifaces.has('NavigationConfig')) return { unavailable: `${file} 里没有 interface NavigationConfig` };

  const problems = [];

  /**
   * 拿一个 interface 声明的成员之前先问两件事，任何一件成立就【说不出来】,不许接着往下读 ——
   * 因为接着读出来的那份形状会跟 tsc 看到的不一样，而它长得跟"对得上"一模一样。
   *
   * 🔴 `extends`（#1104 r4，QA1 的 ⑩）：继承来的成员【不在】 `decl.members` 里。不拦的话，
   *    基接口上一个**必需**字段这里一个字都不说 —— 实测：把 footer 抽成 `FooterConfig extends
   *    FooterBase { legalNotice: string }`，改前改后都解析到 23 处、逐字相同，而那个类型下
   *    站里那份 navigation.json 让 `src/lib/config.ts` 那句 cast 报 TS2352、这个站从此建不出来。
   *    这正是本文件 :150 那句"明天有人往那个 interface 里加一个必需字段"说的事，而
   *    `extends` 就是加它的一种很普通的写法。
   * 🔴 **重名**：同名 interface 会被 TypeScript 合并成一个，而上面那个 Map 只留最后一个 ⟹
   *    读出来的是其中一半。它今天恰好也报"不同"，但那是碰上的，不是判据。
   */
  const membersOfInterface = (decl, name, at) => {
    const where = at || '(顶层)';
    if (decl.heritageClauses && decl.heritageClauses.length) {
      const bases = decl.heritageClauses
        .flatMap((h) => (h.types || []).map((t) => t.getText()))
        .join(', ');
      problems.push(`${where}: \`${name}\` 是 \`extends ${bases}\` 来的，继承来的字段不在它自己的成员里`
        + ' —— 这把尺子读不出它的完整形状（基接口上加一个必需字段这里会一个字都不说）');
      return null;
    }
    if (duplicated.has(name)) {
      problems.push(`${where}: \`${name}\` 在这个文件里声明了不止一次（TypeScript 会把它们合并），`
        + '这把尺子只读到其中一个 —— 完整形状读不出来');
      return null;
    }
    return decl.members;
  };

  const fromMembers = (members, at, seen) => {
    const fields = {};
    for (const m of members) {
      if (!ts.isPropertySignature(m) || !m.name || !ts.isIdentifier(m.name)) {
        problems.push(`${at || '(顶层)'}: 有一个成员这把尺子认不出来 —— \`${m.getText().split('\n')[0].trim()}\``);
        continue;
      }
      const key = m.name.text;
      const path_ = at ? `${at}.${key}` : key;
      if (!m.type) { problems.push(`${path_}: 没写类型`); continue; }
      const sub = convert(m.type, path_, seen);
      if (!sub) continue;
      fields[key] = m.questionToken ? Object.assign({}, sub, { optional: true }) : sub;
    }
    return { kind: 'object', fields };
  };

  const convert = (node, at, seen) => {
    if (ts.isTypeLiteralNode(node)) return fromMembers(node.members, at, seen);
    if (ts.isArrayTypeNode(node)) {
      const of = convert(node.elementType, `${at}[]`, seen);
      return of ? { kind: 'array', of } : null;
    }
    if (ts.isTypeReferenceNode(node) && ts.isIdentifier(node.typeName)) {
      const name = node.typeName.text;
      if (seen.includes(name)) { problems.push(`${at}: 类型 ${name} 绕回自己，读不出一个固定的形状`); return null; }
      const decl = ifaces.get(name);
      if (!decl) { problems.push(`${at}: 引用了一个不在这个文件里的类型 \`${name}\``); return null; }
      const members = membersOfInterface(decl, name, at);
      if (!members) return null;
      return fromMembers(members, at, seen.concat(name));
    }
    if (node.kind === ts.SyntaxKind.StringKeyword) return { kind: 'string' };
    problems.push(`${at}: 这里的类型这把尺子认不出来 —— \`${node.getText()}\``);
    return null;
  };

  const topMembers = membersOfInterface(ifaces.get('NavigationConfig'), 'NavigationConfig', '');
  const shape = topMembers ? fromMembers(topMembers, '', ['NavigationConfig']) : { kind: 'object', fields: {} };
  if (problems.length) return { unavailable: `NavigationConfig 里有 ${problems.length} 处读不出来，所以「NAV_SHAPE 跟类型对不对得上」这个问题今天答不了：${problems.join('；')}` };
  return { shape };
}

/** 把一份形状摊成 `路径: 类型` 的有序清单 —— 两边比对和报差异都用它，读起来也是人话。 */
function flattenShape(shape, at = '', out = []) {
  if (at) out.push(`${at}: ${shape.kind}${shape.optional ? '?' : ''}`);
  if (shape.kind === 'array') flattenShape(shape.of, `${at}[]`, out);
  else if (shape.kind === 'object') {
    Object.keys(shape.fields).sort().forEach((k) => flattenShape(shape.fields[k], at ? `${at}.${k}` : k, out));
  }
  return out;
}



// ── ⑬ 「写进去了，但你这个站看不到」那句话（#1104 r6，AC1 / AC3 / AC5②）────────────────────────
//
// 判据分两半，而**两半都必须有**：
//   AC1 看不见的那几格 —— 照常放行（值真的写进去），并且回话里点名这个站的页面不显示它
//   AC3 看得见的那两格 —— **一句都不许多**。它们本来就真生效，多说一句「可能没生效」就是新的假话，
//       而本票存在的全部意义就是别让老板听到假话。这一格在「算得出版式」和「算不出版式」两条路上
//       各钉一次 —— 第一版只在前一条路上成立，后一条路上 `header.cta` 也被多说了一句（自己抓到的）。
{
  const { PAGE_READS, alwaysRendered, VARIANTS_BY_REGION } = mod;
  const NEEDLE = 'One more thing to tell the owner:';
  const SAVED_BUT = 'was saved, but nothing on the';

  /** 走真入口拿那几句话。`rendered` = 这个站真的画出哪些区；null = 算不出来。 */
  const notesFor = (next, rendered) => writeNotes('en/navigation.json', {
    content: JSON.stringify(next),
    readCurrent: () => JSON.stringify(BASE),
    ...(rendered === undefined ? {} : { readRenderedRegions: () => rendered }),
  });

  /** 一个「这一格看不见」的站：它那一类区取一个**不在** renderedBy 里的版式（topbar 取「没有这个区」）。 */
  const siteWhereInvisible = (e) => {
    const others = (VARIANTS_BY_REGION[e.region] || []).filter((v) => !e.renderedBy.includes(v));
    return {
      header: ['solid-bar'],
      footer: ['multi-column'],
      topbar: [],
      [e.region]: e.region === 'topbar' ? [] : others.slice(0, 1),
    };
  };
  /** 每一格各改一处它自己的值。 */
  const MUTATE = {
    'header.cta': (n) => { n.header.cta.label = 'Book Now Today'; },
    'footer.copyright': (n) => { n.footer.copyright = 'Northside Roofing Ltd.'; },
    'footer.description': (n) => { n.footer.description = 'Roofing across the GTA since 2014.'; },
    'footer.columns[].title': (n) => { n.footer.columns[0].title = 'What We Do'; },
    'footer.columns[>0].links': (n) => { n.footer.columns[1].links[0].label = 'Emergency callout'; },
    topbar: (n) => { n.topbar = { message: '24/7 emergency service' }; },
  };

  /** AC1 + AC3 的判据本体。返回一串问题；空 = 过。做成函数是为了下面能拿同一把判据去量变异版。 */
  const judge = (impl) => {
    const bads = [];
    const notes = (next, rendered) => {
      const raw = impl.navigationEditSideEffects(next, JSON.parse(JSON.stringify(BASE)), rendered);
      return raw.filter((s) => s.includes(SAVED_BUT) || s.includes('could not be worked out'));
    };
    for (const e of PAGE_READS) {
      const mut = MUTATE[e.key];
      if (!mut) { bads.push(`⑬ \`${e.key}\` 没有对应的改法 —— 这一格什么都没量到`); continue; }
      const next = clone(BASE); mut(next);

      if (alwaysRendered(e)) {
        // AC3 —— 两条路都不许多话
        for (const [name, rendered] of [['算得出版式', siteWhereInvisible(e)], ['算不出版式', null]]) {
          const got = notes(next, rendered);
          if (got.length !== 0) {
            bads.push(`⑬ AC3 \`${e.key}\` 在任何站上都真生效，${name}那条路上却多出了 ${got.length} 句：`
              + `「${got[0].slice(0, 90)}…」—— 多说一句就是新的假话`);
          }
        }
        continue;
      }

      // AC1 —— 看不见的时候必须说，而且要点名是哪个字段
      const rendered = siteWhereInvisible(e);
      const got = notes(next, rendered);
      if (got.length !== 1) {
        bads.push(`⑬ AC1 \`${e.key}\` 在一个看不见它的站上应当有 1 句实话，实际 ${got.length} 句`);
      } else {
        for (const needle of [NEEDLE, e.key, e.what]) {
          if (!got[0].includes(needle)) bads.push(`⑬ AC1 \`${e.key}\` 那句话里没有 "${needle}"`);
        }
      }
      // 反过来：在一个**看得见**它的站上，同一次编辑不许多话
      const visible = { ...siteWhereInvisible(e), [e.region]: [e.renderedBy[0]] };
      const quiet = notes(next, visible);
      if (quiet.length !== 0) {
        bads.push(`⑬ \`${e.key}\` 在一个真的画它的站（${e.renderedBy[0]}）上多说了 ${quiet.length} 句 —— `
          + '这句话会变成「你这个站不显示它」而页面上其实显示着');
      }
      // 算不出版式那条路：也要说话，而且要点名这个字段（沉默 = 本票要治的那个病）
      const unknown = notes(next, null);
      if (unknown.length !== 1 || !unknown[0].includes(e.key)) {
        bads.push(`⑬ \`${e.key}\` 算不出版式时应当有 1 句点名它的「说不准」，实际 ${unknown.length} 句`
          + `${unknown[0] ? `：「${unknown[0].slice(0, 80)}…」` : ''}`);
      }
    }
    return bads;
  };

  const bads = judge(mod);
  if (bads.length === 0) {
    const invisible = PAGE_READS.filter((e) => !alwaysRendered(e));
    ok(`⑬ AC1：${invisible.length} 格看不见的字段（${invisible.map((e) => `\`${e.key}\``).join(' · ')}）`
      + '各自照常放行 + 回话点名这个站不显示它；换成真的画它的站就闭嘴'
      + `；AC3：${PAGE_READS.length - invisible.length} 格永远看得见的（\`header.cta\` · \`footer.copyright\`）`
      + '在两条路上都一句不多');
  } else bads.forEach(bad);

  // 🔴 AC1 照常放行 —— 它是【说明】不是【拒绝】。这一条单独钉：说了实话却把编辑拒了，本票就白做了。
  {
    const stillAllowed = [];
    for (const e of PAGE_READS.filter((x) => !alwaysRendered(x))) {
      const next = clone(BASE); MUTATE[e.key](next);
      const why = tryWrite('en/navigation.json', next);
      if (why !== null) stillAllowed.push(`\`${e.key}\` 被拒了：${String(why).split('\n')[0]}`);
    }
    if (stillAllowed.length === 0) ok('⑬ 那几句话是【说明】不是【拒绝】：同样的编辑照常放行（值真的落盘）');
    else stillAllowed.forEach(bad);
  }

  // 🔴 AC5② 反向对照 —— 把发出那句话的那一行拿掉，上面那格必须当场红。
  //    在内存里编译一份改过的 `navigation-owned.js`（相对 require 照样解析得到，因为 filename 是真路径），
  //    **不往交付树里写任何临时文件**。
  {
    const Module = require('module');
    const target = path.join(__dirname, 'navigation-owned.js');
    const src = fs.readFileSync(target, 'utf-8');
    const line = 'if (notRenderedHere(e, rendered)) out.push(invisibleNote(e, rendered));';
    if (!src.includes(line)) {
      bad(`⑬ AC5② 立不起来：navigation-owned.js 里找不到那一行（\`${line}\`）`);
    } else {
      const m = new Module(target, module);
      m.filename = target;
      m.paths = Module._nodeModulePaths(path.dirname(target));
      m._compile(src.split(line).join('/* qa removed */'), target);
      const stillBad = judge(m.exports);
      if (stillBad.length > 0) {
        ok(`⑬ AC5② 反向对照：把发出那句话的那一行拿掉，同一把判据当场报 ${stillBad.length} 条`
          + `（第一条：${stillBad[0].slice(0, 70)}…）⟹ 上面那格的绿是那句话给的`);
      } else {
        bad('⑬ AC5② 失败：那一行拿掉了判据照样全绿 —— 上面那格不是在量这句话');
      }
    }
  }
}


// ── ⑭ 拒绝理由里那句「从哪来的 / 该去改什么」每一处都得是真话（#1104 r6，QA1 r5 那条 🟡）────────
//
// 三处原来共用一句话，把原因写死成「构建从各页自己的 navLabel / navOrder 重建它」。前两处是真的，
// **第三处（页脚有几栏）是假的** —— 它来自关键词页按 service 分的组。后果：老板想加一个页脚栏目，
// 被正确地拒绝了，却拿到一个照做也长不出栏目的补救办法。跟本票要治的病同一个方向：说的话跟真实
// 发生的事对不上。
{
  const src = fs.readFileSync(SYNC_CONFIG, 'utf-8');
  const problems = [];

  // ① 每一处那句话靠的是 sync-config.js 里哪几句 —— 逐句必须还在（同 ⑨ 的做法）
  for (const e of OWNED) {
    if (!Array.isArray(e.rebuiltFromCode) || e.rebuiltFromCode.length === 0) {
      problems.push(`⑭ \`${e.key}\` 没写 rebuiltFromCode —— 那它那句「从哪来的」没有任何东西钉着`);
      continue;
    }
    for (const needle of e.rebuiltFromCode) {
      if (!src.includes(needle)) {
        problems.push(`⑭ \`${e.key}\` 那句「rebuilt from ${e.rebuiltFrom}」靠的是 sync-config.js 里的 `
          + `\`${needle}\`，而它不在了 —— 那句话现在是假话`);
      }
    }
  }

  // ② 🔴 承重的那一条：只改「页脚有几栏」时，拒绝理由里**不许**出现 navLabel / navOrder。
  //    这两个词对这一处是假的补救办法，而它恰好是老板最可能撞上的那一处（他想加一个页脚栏目）。
  {
    const next = clone(BASE);
    next.footer.columns.push({ title: 'Emergency Service', links: [] });
    const why = String(tryWrite('en/navigation.json', next));
    for (const lie of ['navLabel', 'navOrder']) {
      if (why.includes(lie)) {
        problems.push(`⑭ 只改了「页脚有几栏」，拒绝理由里却还写着 "${lie}" —— 照它做长不出一个页脚栏目`);
      }
    }
    for (const truth of ['keyword pages', 'footer.columns']) {
      if (!why.includes(truth)) problems.push(`⑭ 那句拒绝理由里没有 "${truth}"`);
    }
  }

  // ③ 反过来：改菜单链接时那两个词**必须**在（别为了治 ② 把真话也删了）
  {
    const next = clone(BASE);
    next.header.links[1].label = 'Our Story';
    const why = String(tryWrite('en/navigation.json', next));
    for (const truth of ['navLabel', 'navOrder']) {
      if (!why.includes(truth)) problems.push(`⑭ 改菜单链接的拒绝理由里没有 "${truth}"，而对这一处它是真话`);
    }
    if (why.includes('keyword pages')) {
      problems.push('⑭ 改菜单链接的拒绝理由里混进了「keyword pages」—— 那是另一处的来源');
    }
  }

  // ④ 两处一起改时，两句各自出现一次（共用一句的写法在这一格上塌成一句）
  {
    const next = clone(BASE);
    next.header.links = [];
    next.footer.columns.push({ title: 'X', links: [] });
    const why = String(tryWrite('en/navigation.json', next));
    const lines = why.split('\n').filter((l) => l.trim().startsWith('- '));
    if (lines.length !== 2) problems.push(`⑭ 两处一起改应当逐处各给一句（2 行），实际 ${lines.length} 行`);
    if (!why.includes('navLabel') || !why.includes('keyword pages')) {
      problems.push('⑭ 两处一起改时，两句「从哪来的」没有各自出现 —— 说明它又塌成一句共用的话了');
    }
  }

  if (problems.length === 0) {
    ok(`⑭ ${OWNED.length} 处拒绝理由各自那句「从哪来的 / 去改什么」都钉在 sync-config.js 真代码上`
      + `（${OWNED.flatMap((e) => e.rebuiltFromCode).map((c) => `\`${c}\``).join(' · ')}）；`
      + '页脚栏目数那一处不再拿 navLabel / navOrder 当补救办法，而菜单那两处照旧给它');
  } else problems.forEach(bad);

  // 🔴 阳性对照：把那三处的 `rebuiltFrom` / `remediation` 换回**一句共用的**，② 必须当场红。
  {
    const Module = require('module');
    const target = path.join(__dirname, 'navigation-owned.js');
    const raw = fs.readFileSync(target, 'utf-8');
    const m = new Module(target, module);
    m.filename = target;
    m.paths = Module._nodeModulePaths(path.dirname(target));
    m._compile(raw, target);
    for (const e of m.exports.OWNED) {
      e.rebuiltFrom = "each page's own navLabel / navOrder";
      e.remediation = "To change a menu entry, change that page's navLabel or navOrder instead.";
    }
    const next = clone(BASE);
    next.footer.columns.push({ title: 'X', links: [] });
    const why = String(m.exports.navigationEditRejection(next, clone(BASE)));
    if (why.includes('navLabel')) {
      ok('⑭ 阳性对照：把三处换回一句共用的话，「只改页脚栏目数」的拒绝理由里 navLabel 当场回来 '
        + '⟹ 上面那格量的就是「每处一句」这件事，不是恒真');
    } else {
      bad('⑭ 阳性对照失败：换回共用那句话之后 navLabel 也没出现 —— 这一格量的不是它');
    }
  }
}


// ── ⑮ 一页上有三个页脚的站（`tri-footer`）不许被判成「看不见」（#1104 r6）────────────────────────
//
// 🔴 这一格钉的是 `lib/site-regions.js` 里那句承重的话：**这个站真的画出几个页脚，不是主题那一个值。**
//    页面版式库里的 `tri-footer` 把页脚拆成三个区，每个区的版式由布局自己钉（`repeatVariants`）。
//    只看 `regionLayout.footer` 的实现会把这种站判成「页脚是 multi-column」——碰巧对；但反过来
//    主题给 `slim-row` 而布局里那三支含 `multi-column` 时，就会对一个**真的显示着**的栏目标题说
//    「你这个站不显示它」= 新造一句假话。两种方向都由这一格量。
{
  const os = require('os');
  const siteRegions = require('./site-regions.js');
  const { PAGE_READS, notRenderedHere } = mod;
  const title = PAGE_READS.find((e) => e.key === 'footer.columns[].title');
  if (!title) die('⑮ PAGE_READS 里找不到 footer.columns[].title —— 这一格量的是它');

  // 夹具目录跑完就收 —— 留在 /tmp 里的半个站会被下一个人当成真站（本仓的 fixture 卫生那条）。
  const madeDirs = [];
  /** 造一个只写了 page-layout.json 的站目录（theme.json 不写 ⟹ 主题那一维走默认值）。 */
  const siteWith = (layoutId) => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'navowned-regions-'));
    madeDirs.push(dir);
    const site = path.join(dir, 'site');
    fs.mkdirSync(site);
    if (layoutId) fs.writeFileSync(path.join(site, 'page-layout.json'), JSON.stringify({ layoutId }));
    return site;
  };
  const seenBy = (site) => {
    const r = siteRegions.resolveSiteRegions(site);
    return {
      footerVariants: r.footerVariants,
      invisible: notRenderedHere(title, {
        header: [r.regionLayout.header], footer: r.footerVariants, topbar: r.hasTopbarRegion ? [r.regionLayout.topbar] : [],
      }),
      hasTopbar: r.hasTopbarRegion,
    };
  };

  const problems = [];
  const tri = seenBy(siteWith('tri-footer'));
  if (tri.footerVariants.length !== 3) {
    problems.push(`⑮ tri-footer 的站应当画 3 个页脚，量到 ${tri.footerVariants.length} 个`
      + `（${JSON.stringify(tri.footerVariants)}）—— 只看主题那一个值就会是 1 个`);
  }
  if (tri.invisible) {
    problems.push('⑮ tri-footer 的站上三支页脚里有 multi-column（它真的画栏目标题），却被判成「看不见」'
      + ' —— 这道门会对一个真会显示的字段说假话');
  }

  // 反向对照：默认版式（一个页脚）+ 主题默认（multi-column）⟹ 一个页脚、看得见；
  //           而把它换成不画标题的那种版式就该看不见。两向都量，否则上面那格可能只是「恒 false」。
  const std = seenBy(siteWith(null));
  if (std.footerVariants.length !== 1) {
    problems.push(`⑮ 默认版式应当只画 1 个页脚，量到 ${std.footerVariants.length} 个`);
  }
  if (std.hasTopbar) problems.push('⑮ 默认版式不该有 topbar 区，量到有');
  const topbarSite = seenBy(siteWith('with-topbar'));
  if (!topbarSite.hasTopbar) problems.push('⑮ with-topbar 的站应当有 topbar 区，量到没有');
  // 这一支：假设它的页脚是不画标题的那种 ⟹ 必须判成看不见（同一个函数，只换输入）
  const invisibleArm = notRenderedHere(title, { header: ['solid-bar'], footer: ['slim-row'], topbar: [] });
  if (!invisibleArm) {
    problems.push('⑮ 反向对照塌了：页脚只有 slim-row 时 footer.columns[].title 也被判成看得见'
      + ' —— 那上面那格的 false 是恒 false，什么都没量到');
  }

  if (problems.length === 0) {
    ok(`⑮ 「这个站真的画出几个页脚」量的是布局而不是主题那一个值：tri-footer → `
      + `${JSON.stringify(tri.footerVariants)}（含 multi-column ⟹ 栏目标题看得见，不说那句话）· `
      + '默认版式 → 1 个 · with-topbar → 有 topbar 区 · 只有 slim-row → 看不见（反向对照有量程）');
  } else problems.forEach(bad);
  for (const d of madeDirs) fs.rmSync(d, { recursive: true, force: true });
}

// ── ⑫ `PAGE_READS` 的 `renderedBy` == 组件里**真的**画了它的那几支（#1104 r6）─────────────────
//
// 🔴 为什么这一格是这批改动里最要紧的：`renderedBy` 是一张表，而这张表决定「要不要跟老板说一句
//    你这个站看不见它」。表漂了，两个方向的后果都是新的假话：
//      · 表里说这一支画它、其实已经不画了 ⟹ 老板拿到「已完成」，页面上什么都没变（本票要治的病）
//      · 表里没写、其实画了     ⟹ 我们对一个真会显示的字段说「你这个站不显示它」（新造一句假话）
//    所以这里用 TypeScript 自己的解析器把 `Footer.tsx` / `Header.tsx` 按 `data-region-layout` 拆成
//    各支，逐支解出「这一支读了 navigation.json 的哪几处」，再跟表两向比对。自带阳性对照：
//    从源码里删掉一个渲染点，这一格必须当场红 —— 少了那个对照，「两边对得上」也可能是因为解析器
//    一处都没找到（本票的三个人各自踩过一次这个坑）。
{
  const { PAGE_READS, VARIANTS_BY_REGION } = mod;
  // 每一类区由哪个组件画。`splitByVariant:false` = 这个组件不按版式分支，它读什么就是每一种版式
  // 都读什么（下面会把「它真的不分支」也断言一次，哪天有人给它加了分支这一格会说话）。
  const REGION_FILES = [
    { region: 'header', file: path.join('src', 'components', 'Header.tsx'), splitByVariant: true },
    { region: 'footer', file: path.join('src', 'components', 'Footer.tsx'), splitByVariant: true },
    { region: 'topbar', file: path.join('src', 'components', 'TopbarRegion.tsx'), splitByVariant: false },
  ];

  /** region → { variant → Set(读到的 navigation.json 路径) }；读不出来的一律 unavailable。 */
  const measured = {};
  for (const r of REGION_FILES) {
    const abs = path.join(TEMPLATE_ROOT, r.file);
    if (!fs.existsSync(abs)) die(`⑫ 读不到 ${r.file} —— 这一格量的是它`);
    const got = navReadsByVariant(abs, fs.readFileSync(abs, 'utf-8'), r, VARIANTS_BY_REGION[r.region]);
    if (got.unavailable) die(`⑫ ${r.file}：${got.unavailable}`);
    measured[r.region] = got.byVariant;
  }

  const problems = [];
  let compared = 0;
  for (const e of PAGE_READS) {
    const byVariant = measured[e.region];
    if (!byVariant) { problems.push(`⑫ \`${e.key}\` 的区 "${e.region}" 没有对应的组件文件`); continue; }
    for (const v of VARIANTS_BY_REGION[e.region]) {
      compared++;
      const reads = byVariant[v] || new Set();
      const reallyReads = e.renderPaths.some((p) => reads.has(p));
      const claimed = e.renderedBy.includes(v);
      if (claimed && !reallyReads) {
        problems.push(`⑫ \`${e.key}\`：表里说 "${v}" 这一支画它，而解析器在那一支里找不到 `
          + `${e.renderPaths.map((p) => `\`${p}\``).join(' / ')} —— 渲染点没了，`
          + '而这道门现在会漏说那句话（老板会拿到「已完成」而页面没变）');
      } else if (!claimed && reallyReads) {
        problems.push(`⑫ \`${e.key}\`：解析器量到 "${v}" 这一支真的画它，而表里没写 —— `
          + '这道门会对一个真会显示的字段说「你这个站不显示它」，是新造的一句假话');
      }
    }
  }
  if (problems.length === 0) {
    ok(`⑫ ${PAGE_READS.length} 格 × 各自那一类区的全部版式 = ${compared} 个组合，`
      + '「表里说画不画」跟解析器在组件里量到的逐个相同');
  } else problems.forEach(bad);

  // 🔴 阳性对照 —— 两个方向各一个，都只改一处源码。
  const footerAbs = path.join(TEMPLATE_ROOT, 'src', 'components', 'Footer.tsx');
  const footerSrc = fs.readFileSync(footerAbs, 'utf-8');
  const footerCfg = REGION_FILES.find((r) => r.region === 'footer');
  const readsOf = (src) => {
    const got = navReadsByVariant(footerAbs, src, footerCfg, VARIANTS_BY_REGION.footer);
    return got.unavailable ? got : got.byVariant;
  };

  // ① 删掉一个渲染点：`multi-column` 那一支里画栏目标题的那**一句** —— 只删 `<h3>` 里那处，
  //    **`:266` 的 `key={column.title}` 留着**。这个夹具的选法是承重的：把两处一起删（我第一版
  //    `split/join` 就是）的话，一个把 React key 也算成渲染的实现照样会红 ⟹ 对照分不出两种实现。
  {
    const line = (footerSrc.split('\n').find((l) => l.includes('<h3') && l.includes('{column.title}')) || '');
    if (!line) {
      bad('⑫ 阳性对照① 立不起来：Footer.tsx 里找不到那一行 `<h3 …>{column.title}</h3>`');
    } else if (!/key=\{column\.title\}/.test(footerSrc)) {
      bad('⑫ 阳性对照① 立不起来：Footer.tsx 里没有 `key={column.title}` —— 这个夹具的意义就是留着它'
        + '，好让「把 React key 算成渲染」的实现被抓出来');
    } else {
      const got = readsOf(footerSrc.replace(line, line.replace('{column.title}', '{/* qa removed */}')));
      const still = got.unavailable ? null : (got['multi-column'] || new Set()).has('footer.columns[].title');
      if (still === false) {
        ok('⑫ 阳性对照①：只把 `<h3>` 里那一处 `{column.title}` 删掉（`key={column.title}` 留着），'
          + '解析器当场说 `multi-column` 不再画栏目标题 ⟹ 上面那格的绿是活的，而且这把尺没把 '
          + 'React key 当成渲染');
      } else {
        bad(`⑫ 阳性对照①失败：删掉那个渲染点之后解析器照样说它画（${got.unavailable || '仍然命中'}）`
          + ' —— 这把尺子没有真的在读组件');
      }
    }
  }

  // ② 反方向：给一支加一个它今天不画的渲染点，表里没写 ⟹ 必须报「新造的假话」那一条
  {
    const anchor = 'data-region-layout="slim-row"';
    if (!footerSrc.includes(anchor)) {
      bad(`⑫ 阳性对照② 立不起来：Footer.tsx 里找不到 \`${anchor}\``);
    } else {
      const got = readsOf(footerSrc.replace(anchor, `${anchor} title={footer.description}`));
      const now = got.unavailable ? null : (got['slim-row'] || new Set()).has('footer.description');
      if (now === true) {
        ok('⑫ 阳性对照②：给 `slim-row` 那一支加上一处读 `footer.description`，解析器当场量到它 '
          + '⟹ 「表里没写而其实画了」这个方向也有量程');
      } else {
        bad(`⑫ 阳性对照②失败：加了渲染点解析器没看见（${got.unavailable || '没命中'}）`);
      }
    }
  }
}

/**
 * 一个组件里，**按版式分开**，每一支读了 `navigation.json` 的哪几处？（⑫ 用它）
 *
 * 判据不是 grep 字段名 —— 那会漏掉两种今天真实存在的写法，而漏掉的方向是「说它不画」：
 *   · **别名**：`Footer.tsx` 把版权行 hoist 成 `const copyright = <p>…{footer.copyright}</p>`，
 *     `slim-row` / `cta-band` 两支渲染的是 `{copyright}` —— 只 grep `footer.copyright` 会判成
 *     这两支不画版权行（QA2 和 PM 各自踩过一次这个坑，两人第一版的射程表都是错的）。
 *   · **回调参数**：`footer.columns.map((column) => … {column.title} …)` 里那个字段是
 *     `column.title`，源码里根本没有 `footer.columns[].title` 这个串。
 * 所以这里跟着别名走、也跟着回调参数走。
 *
 * 🔴 认不出的写法一律【说不出来】(`unavailable` → 调用方 exit 2)，不许静默当成「没读」：
 *    静默那个方向会让这一格变成恒绿，而它恰好是本票要防的那种失明。同 ③ 的纪律。
 *
 * @param {string} file 文件名（只用来报位置）
 * @param {string} src  源码文本 —— **传文本而不是只传路径，是为了阳性对照能改一处再量一次**
 * @param {{region: string, splitByVariant: boolean}} cfg
 * @param {string[]} variants 这一类区一共有哪些版式
 * @returns {{byVariant?: Object<string, Set<string>>, unavailable?: string}}
 */
function navReadsByVariant(file, src, cfg, variants) {
  let ts;
  try {
    ts = require('typescript');
  } catch (e) {
    if (e.code !== 'MODULE_NOT_FOUND') throw e;
    return { unavailable: "读不到 typescript 这个模块，没法解析组件（在 templates/nextjs 里跑 npm ci）" };
  }
  const sf = ts.createSourceFile(file, src, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const lineOf = (n) => sf.getLineAndCharacterOfPosition(n.getStart()).line + 1;
  const cantTell = [];

  // 会把「这一段里还读了哪些更深的字段」带走的方法：只列**确定只读**的。认不出的方法名走 cantTell。
  const ITERATORS = new Set(['map', 'flatMap', 'filter', 'find', 'findIndex', 'some', 'every', 'forEach']);
  const SAFE_READS = new Set([
    'slice', 'concat', 'join', 'includes', 'indexOf', 'lastIndexOf', 'at', 'reverse', 'sort',
    'toString', 'trim', 'replace', 'replaceAll', 'split', 'startsWith', 'endsWith', 'toLowerCase',
    'toUpperCase', 'keys', 'values', 'entries', 'reduce',
  ]);

  /** 一条 `a.b[0].c` 链 → { root, rel }；不是这种链就 null。数组下标一律归一成 `[]`。 */
  const chain = (node) => {
    const segs = [];
    let cur = node;
    for (;;) {
      if (ts.isPropertyAccessExpression(cur)) { segs.unshift(`.${cur.name.text}`); cur = cur.expression; continue; }
      if (ts.isElementAccessExpression(cur)) { segs.unshift('[]'); cur = cur.expression; continue; }
      break;
    }
    if (!ts.isIdentifier(cur)) return null;
    return { root: cur.text, rel: segs.join('').replace(/^\./, '') };
  };

  /** 从这个标识符往外走到最长的那条访问链。 */
  const outermost = (id) => {
    let n = id;
    while (n.parent
           && ((ts.isPropertyAccessExpression(n.parent) && n.parent.expression === n)
               || (ts.isElementAccessExpression(n.parent) && n.parent.expression === n))) {
      n = n.parent;
    }
    return n;
  };

  const joinPath = (base, rel) => (base ? (rel ? `${base}.${rel}` : base) : rel);

  // ── ① 哪些局部变量就是 navigation.json 里的东西？根是 `getNavigation(...)` 的返回值 ────────────
  //    `const { footer } = getNavigation(locale)` → footer 对应 "footer"
  //    `const nav = getNavigation(locale)`        → nav 对应 ""（整份）
  const env = new Map();
  const findRoots = (node) => {
    if (ts.isVariableDeclaration(node) && node.initializer
        && /\bgetNavigation\s*\(/.test(node.initializer.getText())) {
      if (ts.isIdentifier(node.name)) env.set(node.name.text, '');
      else if (ts.isObjectBindingPattern(node.name)) {
        for (const el of node.name.elements) {
          if (!ts.isIdentifier(el.name)) {
            cantTell.push(`第 ${lineOf(el)} 行 getNavigation() 的解构里有一处不是普通名字（\`${el.getText()}\`）`);
            continue;
          }
          const from = el.propertyName && ts.isIdentifier(el.propertyName) ? el.propertyName.text : el.name.text;
          env.set(el.name.text, from);
        }
      } else {
        cantTell.push(`第 ${lineOf(node)} 行 getNavigation() 的接法认不出来：\`${node.name.getText()}\``);
      }
    }
    ts.forEachChild(node, findRoots);
  };
  findRoots(sf);
  if (env.size === 0) return { unavailable: '找不到任何 getNavigation(...) 的接收方 —— 这个组件还读 navigation.json 吗？' };

  // ── ② 把它存到别的变量里的那些（`const topbar = nav.topbar`）也算同一个东西，跑到不动为止 ──────
  for (let round = 0; round < 8; round++) {
    let grew = false;
    const findAliases = (node) => {
      if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer
          && !env.has(node.name.text)
          && (ts.isPropertyAccessExpression(node.initializer) || ts.isElementAccessExpression(node.initializer)
              || ts.isIdentifier(node.initializer))) {
        const c = chain(node.initializer);
        if (c && env.has(c.root)) { env.set(node.name.text, joinPath(env.get(c.root), c.rel)); grew = true; }
      }
      ts.forEachChild(node, findAliases);
    };
    findAliases(sf);
    if (!grew) break;
  }

  // 值被整个交到别处去的那些位置（判在最后，那里才知道 renderPaths）。
  const handoffs = [];

  // ── ③ 一段代码里读了哪几处 + 它引用了哪些「装着 JSX 的变量」──────────────────────────────────
  /**
   * @param {ts.Node} root 从哪一段开始看
   * @param {Map<string,string>} scope 名字 → navigation.json 里的位置
   */
  const scan = (root, scope) => {
    const paths = new Set();
    const refs = new Set();          // 这一段引用到的本地变量名（用来把 JSX 别名的读数并进来）
    const walk = (node, sc) => {
      // 🔴 `key={column.title}` / `ref={…}` 这两个属性【不进 DOM】—— React 自己吃掉它们。把它们算成
      //    「这一支画了这个字段」，正是这道守卫要防的那件事的反面：`Footer.tsx` 里 `column.title`
      //    出现两次（`:266` 的 key 与 `:267` 的 `<h3>`），只删掉真正渲染的那一处之后，key 还在 ⟹
      //    解析器照样说它画，这一格全绿。**实测过：那次变异 rc=0 · 0 红。**（我自己第一版的阳性对照
      //    没抓到它，因为那个对照用 `split/join` 把两处一起删了 —— 对照跑在一个分不出两种实现的夹具上。）
      if (ts.isJsxAttribute(node) && ['key', 'ref'].includes(node.name.getText())) return;
      // `X.map(cb)` 这类：把回调那个参数绑成 `X[]`，然后进回调里继续看
      if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression)) {
        const callee = node.expression;
        const c = chain(callee);
        if (c && sc.has(c.root)) {
          const method = callee.name.text;
          // `columns[].map` → 去掉尾巴上那个方法名，剩下的才是「被读的那一处」。
          const relNoMethod = c.rel === method ? '' : c.rel.slice(0, c.rel.length - method.length - 1);
          const base = joinPath(sc.get(c.root), relNoMethod);
          if (base) paths.add(base);
          if (ITERATORS.has(method)) {
            const cb = node.arguments[0];
            const inner = new Map(sc);
            if (cb && (ts.isArrowFunction(cb) || ts.isFunctionExpression(cb))) {
              const p0 = cb.parameters[0];
              if (p0 && ts.isIdentifier(p0.name)) inner.set(p0.name.text, `${base}[]`);
              else if (p0) cantTell.push(`第 ${lineOf(p0)} 行 \`${method}\` 的回调参数不是普通名字（\`${p0.getText()}\`）`);
            } else if (cb) {
              cantTell.push(`第 ${lineOf(cb)} 行 \`${method}\` 的第一个参数不是函数字面量 —— 里面读了什么这里看不见`);
            }
            node.arguments.forEach((a) => walk(a, inner));
            return;                                            // callee 已经数过，别再走一遍
          }
          if (!SAFE_READS.has(method)) {
            cantTell.push(`第 ${lineOf(callee)} 行 方法 \`${method}\` 不在「确定只读」那张白名单里 —— `
              + `\`${callee.getText().slice(0, 60)}\``);
          }
          node.arguments.forEach((a) => walk(a, sc));
          return;
        }
      }
      if (ts.isIdentifier(node)) {
        const isDeclName = (ts.isVariableDeclaration(node.parent) || ts.isParameter(node.parent))
          && node.parent.name === node;
        const isPropName = (ts.isPropertyAccessExpression(node.parent) && node.parent.name === node)
          || (ts.isPropertyAssignment(node.parent) && node.parent.name === node)
          || (ts.isJsxAttribute(node.parent) && node.parent.name === node);
        if (!isDeclName && !isPropName) {
          if (sc.has(node.text)) {
            const outer = outermost(node);
            const c = chain(outer);
            const full = joinPath(sc.get(node.text), c ? c.rel : '');
            if (full) paths.add(full);
            // 🔴 值被交到别处去（当参数 / 塞进对象或数组 / 传成 JSX 的 prop）⟹ 拿走它的那一段还会
            //    读它下面哪几个字段，这把尺子看不见。只有当它是某个 renderPath 的【真前缀】时才要紧,
            //    所以先记下来，判在调用方（那里知道 renderPaths）。
            const p = outer.parent;
            const handoff = (ts.isCallExpression(p) && p.arguments.includes(outer))
              || ts.isJsxExpression(p) && p.parent && ts.isJsxAttribute(p.parent)
              || ts.isPropertyAssignment(p) || ts.isShorthandPropertyAssignment(p)
              || ts.isArrayLiteralExpression(p) || ts.isSpreadElement(p) || ts.isSpreadAssignment(p);
            if (handoff && full) handoffs.push({ line: lineOf(outer), at: full, text: outer.getText().slice(0, 60) });
          } else {
            refs.add(node.text);
          }
        }
      }
      ts.forEachChild(node, (c) => walk(c, sc));
    };
    walk(root, scope);
    return { paths, refs };
  };

  // ── ④ 装着 JSX 的那些变量（`const copyright = <p>…</p>`）各自读了什么，跑到不动为止 ──────────
  const jsxVars = new Map();        // 名字 → { paths:Set, refs:Set }
  const hasJsx = (node) => {
    let found = false;
    const look = (n) => {
      if (found) return;
      if (ts.isJsxElement(n) || ts.isJsxSelfClosingElement(n) || ts.isJsxFragment(n)) { found = true; return; }
      ts.forEachChild(n, look);
    };
    look(node);
    return found;
  };
  const findJsxVars = (node) => {
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer
        && !env.has(node.name.text) && hasJsx(node.initializer)) {
      jsxVars.set(node.name.text, scan(node.initializer, env));
    }
    ts.forEachChild(node, findJsxVars);
  };
  findJsxVars(sf);
  /** 把 `{copyright}` 这类引用的读数并进来（别名引别名也跟着走）。 */
  const closure = (seed, seen = new Set()) => {
    const out = new Set(seed.paths);
    for (const name of seed.refs) {
      if (seen.has(name) || !jsxVars.has(name)) continue;
      seen.add(name);
      for (const p of closure(jsxVars.get(name), seen)) out.add(p);
    }
    return out;
  };

  // ── ⑤ 按 `data-region-layout` 把各支拆开 ──────────────────────────────────────────────────────
  const byVariant = {};
  if (cfg.splitByVariant) {
    const branches = new Map();
    const findBranches = (node) => {
      if (ts.isJsxAttribute(node) && node.name.getText() === 'data-region-layout') {
        const init = node.initializer;
        if (!init || !ts.isStringLiteral(init)) {
          cantTell.push(`第 ${lineOf(node)} 行 data-region-layout 的值不是一个字符串字面量 —— 分不出这是哪一支`);
        } else if (!variants.includes(init.text)) {
          cantTell.push(`第 ${lineOf(node)} 行 data-region-layout="${init.text}" 不在 ${cfg.region} 的版式清单里`);
        } else {
          // 属性 → JsxAttributes → 开标签；开标签再往上一层才是**带着孩子**的那个元素。
          let el = node.parent && node.parent.parent;
          if (el && ts.isJsxOpeningElement(el) && el.parent && ts.isJsxElement(el.parent)) el = el.parent;
          if (!el || !(ts.isJsxElement(el) || ts.isJsxSelfClosingElement(el))) {
            cantTell.push(`第 ${lineOf(node)} 行 找不到 data-region-layout 挂在哪个元素上`);
          }
          else if (branches.has(init.text)) cantTell.push(`data-region-layout="${init.text}" 出现了不止一次 —— 这一支该按哪一段算`);
          else branches.set(init.text, el);
        }
      }
      ts.forEachChild(node, findBranches);
    };
    findBranches(sf);
    const missing = variants.filter((v) => !branches.has(v));
    if (missing.length) {
      cantTell.push(`${cfg.region} 的这些版式在组件里找不到对应的那一支：${missing.join(' / ')}`);
    }
    for (const [v, el] of branches) byVariant[v] = closure(scan(el, env));
  } else {
    // 这个组件不按版式分支 ⟹ 它读什么，每一种版式就都读什么。**「它不分支」这件事也要钉住**：
    // 哪天有人给它加了 data-region-layout，下面这句就会红，而不是继续按「不分支」算。
    // 🔴 判据必须是 AST 里**真的有那个属性**，不是源码里出现过这个串：`TopbarRegion.tsx` 的注释里
    //    就写着这个词（在解释它为什么带的是区属性而不是块属性）—— 拿文本判会把一句注释当成分支，
    //    而那正是本仓「尺子先剥注释」那条纪律说的形态。第一版就是这么假红的。
    let branches = false;
    const findAttr = (node) => {
      if (ts.isJsxAttribute(node) && node.name.getText() === 'data-region-layout') branches = true;
      if (!branches) ts.forEachChild(node, findAttr);
    };
    findAttr(sf);
    if (branches) {
      cantTell.push(`${cfg.region} 那个组件现在按 data-region-layout 分支了，而这一格还按「不分支」算 —— `
        + 'REGION_FILES 里那一行要改成 splitByVariant:true');
    }
    const all = closure(scan(sf, env));
    for (const v of variants) byVariant[v] = all;
  }

  // ── ⑥ 认不出的写法 / 看不见的交接 ⟹ 说不出来 ─────────────────────────────────────────────────
  const blind = handoffs.filter((h) => {
    const deeper = new Set();
    for (const e of mod.PAGE_READS) {
      if (e.region !== cfg.region) continue;
      for (const p of e.renderPaths) if (p !== h.at && p.startsWith(`${h.at}.`)) deeper.add(p);
    }
    return deeper.size > 0;
  });
  for (const h of blind) {
    cantTell.push(`第 ${h.line} 行 \`${h.at}\` 被整个交到别处去了（\`${h.text}\`）—— 拿走它的那一段读了`
      + '它下面哪几个字段，这把尺子看不见');
  }
  if (cantTell.length) {
    return { unavailable: `${cantTell.length} 处读不出来，所以「哪一支画了哪个字段」这个问题今天答不了：${cantTell.join('；')}` };
  }
  return { byVariant };
}

console.log(`\n══ 汇总: 通过 ${pass} · 失败 ${fail} ══`);
process.exit(fail ? 1 : 0);
