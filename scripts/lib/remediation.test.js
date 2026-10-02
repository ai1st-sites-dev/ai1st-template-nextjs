#!/usr/bin/env node
/**
 * remediation.test.js — #1108：报错里「那你去做 X」那几句话，说的是今天真能做的事吗？
 *
 *   node scripts/lib/remediation.test.js     （由 `npm run test:scripts` 自动发现）
 *   退出码: 0 全过 · 1 有失败 · 2 跑不起来（**不许当成通过**）
 *
 * ── 这份测试真正守的那一条 ────────────────────────────────────────────────────────────────────
 * 本票要治的缺陷是「产品的报错在建议一个产品自己禁止的动作」。修法的承重性质**不是**「那句话现在
 * 是对的」——那种对法明天就会过期（#1104 正在把 `navigation.json` 的 topbar 开出来）。承重的是
 * **那句话由白名单算出来**：同一份代码，在「写得进」和「写不进」两个世界里各说各的真话。
 *
 * 所以 ② 那一格是两臂对照：同一个 `remediation.js`，一臂配放行的白名单、一臂配拒绝的，
 * 句子必须**不同**。少了这一格，把那两句话写死成任何一边都能让这份测试全绿。
 */

'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');

const mod = require('./remediation.js');
// 📌 #1425（T3）—— `howToAddTopbar` / `themesWithoutOverlayHeader` / `topbarBullets` 随公告条那个区退役，模块只剩
//    `howToChangePageLayout` / `navRelPath`。原来压在 `howToAddTopbar` 上的那几格承重性质（两臂 · 问不到 · 扁平站 ·
//    接线 · 真跑 · 与真编辑器对账）改到 `howToChangePageLayout` / `navRelPath` 上量；只对 topbar 有意义的格原位删了。
const { howToChangePageLayout, navRelPath } = mod;

let pass = 0, fail = 0, skipped = 0;
// #1317 —— 脚手架期（池子 < 10 套）按构造没有对象可问的那一条，见 scripts/lib/scaffolding-pool.js。
const { skipOnScaffoldingPool } = require('./scaffolding-pool.js');
const ok = (m) => { pass++; console.log(`  ✅ ${m}`); };
const bad = (m) => { fail++; console.log(`  ❌ ${m}`); };
const die = (m) => { console.error(`🔴 跑不起来: ${m}`); process.exit(2); };

if (typeof howToChangePageLayout !== 'function' || typeof navRelPath !== 'function') {
  die('remediation.js 没导出 howToChangePageLayout / navRelPath');
}

const NEXTJS = path.join(__dirname, '..', '..');            // templates/nextjs
const REPO = path.join(NEXTJS, '..', '..');                 // 仓根

/** 造一棵只有 `lib/` 的临时树：remediation.js 的副本 + 一个指定行为的假白名单。 */
function treeWith(editableFilesSrc) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'remediation-'));
  fs.mkdirSync(path.join(dir, 'lib'));
  fs.copyFileSync(path.join(__dirname, 'remediation.js'), path.join(dir, 'lib', 'remediation.js'));
  // 🔴 #1138 —— `remediation.js` 现在顶层 require 了 `./site-shape.js`（它要拿这个站的形状去问
  //    白名单）。这棵树少了它，被测的那份副本**加载不起来**，②③ 会当场死掉 —— 那是响的失败，
  //    比"少了一维静默不判"好，所以那个 require 有意不是 try/catch 的。这里把它一起拷过来。
  fs.copyFileSync(path.join(__dirname, 'site-shape.js'), path.join(dir, 'lib', 'site-shape.js'));
  fs.writeFileSync(path.join(dir, 'lib', 'editable-files.js'), editableFilesSrc);
  return dir;
}
/**
 * 一个带 navigation.json 的假站。
 *
 * 🔴 #1138 —— 给了 `locale` 就**必须**同时写 `site_meta.json`，否则这个夹具自相矛盾：`site/en/`
 *    躺在那儿，而「多语言还是扁平」的唯一判据是 `site_meta.json` 在不在（`lib/site-shape.js`
 *    文件头），所以 `readSiteShape` 会把它读成**扁平站**。改之前这不要紧（`remediation.js` 问白名单
 *    时不带形状），#1138 把形状递进去之后就要紧了：`en/navigation.json` 在一个"扁平站"上会被
 *    #1109 那个分支拒掉 ⟹ ① 与 ⑧ 从「AI 编辑器写得进」那一支翻到「写不进」那一支。
 *    🔴 而**两格都仍然是绿的**（① 只断言 `viaProduct` 是 true/false 之一；⑧ 长句支 1089–1170
 *    字符照旧 ≤2000）—— 也就是说这个夹具会静默把两个读数换成另一道题的答案。
 *    多语言站在真世界里永远有 `site_meta.json`（`create-site.js` 的每一条路都写它），夹具跟上。
 * 📌 同一棵树可以调多次（⑧ 就造 22 个语言），所以这里是**累加**进 locales，不是覆盖。
 */
function siteWithNav(dir, locale) {
  const site = path.join(dir, 'site');
  const d = locale ? path.join(site, locale) : site;   // locale=null ⟹ 扁平站（不写 site_meta.json）
  fs.mkdirSync(d, { recursive: true });
  fs.writeFileSync(path.join(d, 'navigation.json'), JSON.stringify({
    header: { links: [{ label: 'Home', href: '/' }], cta: { label: 'Book', href: '/contact' } },
    footer: { description: 'd', columns: [{ title: 'Q', links: [] }], copyright: 'c' },
  }, null, 2));
  if (locale) {
    const metaPath = path.join(site, 'site_meta.json');
    let meta = { siteId: 'remediationtest', defaultLocale: locale, locales: [] };
    try { meta = JSON.parse(fs.readFileSync(metaPath, 'utf-8')); } catch (e) { /* 第一次，用上面那份 */ }
    if (!Array.isArray(meta.locales)) meta.locales = [];
    if (!meta.locales.includes(locale)) meta.locales.push(locale);
    fs.writeFileSync(metaPath, JSON.stringify(meta, null, 2));
  }
  return site;
}

// 📌 #1425（T3）—— 这里原来是 ①：拿真白名单问 `howToAddTopbar`（「公告条文字去哪儿补」）；它随公告条退役。
//    `howToChangePageLayout` 的真读数在下面 ⑤。

// ── ② 承重那一格:两臂对照 —— 白名单放行 vs 拒绝,同一份代码必须说【不同】的话 ────────────────
// #1425（T3）—— 原来两臂问的是 `howToAddTopbar`；改问今天唯一还在的那句 `howToChangePageLayout`，判据不变：
//    同一份 remediation.js，一臂配放行的白名单、一臂配拒绝的，句子必须不同。
{
  const PERMISSIVE = "'use strict';\nmodule.exports = { writeRejection: () => null };\n";
  const STRICT = "'use strict';\nmodule.exports = { writeRejection: () => 'nope: not edited here' };\n";
  const results = {};
  for (const [name, src] of [['放行', PERMISSIVE], ['拒绝', STRICT]]) {
    const dir = treeWith(src);
    const siteDir = siteWithNav(dir, 'en');
    // eslint-disable-next-line global-require
    const copy = require(path.join(dir, 'lib', 'remediation.js'));
    results[name] = copy.howToChangePageLayout({ rootDir: NEXTJS, siteDir });
    fs.rmSync(dir, { recursive: true, force: true });
  }
  if (results['放行'].viaProduct === true) ok('② 白名单放行时 viaProduct=true');
  else bad(`② 白名单放行时却说 viaProduct=${results['放行'].viaProduct}`);
  if (results['拒绝'].viaProduct === false) ok('② 白名单拒绝时 viaProduct=false');
  else bad(`② 白名单拒绝时却说 viaProduct=${results['拒绝'].viaProduct}`);
  if (results['放行'].sentence !== results['拒绝'].sentence) {
    ok('② 两臂句子不同 ⟹ 这句话真的是【算出来】的，不是写死的');
  } else {
    bad(`② 两臂句子逐字相同 ⟹ 它是写死的，白名单一变就成假话：${results['放行'].sentence}`);
  }
  if (/让 AI 编辑器/.test(results['放行'].sentence)) ok('② 放行那臂让人去用 AI 编辑器');
  else bad(`② 放行那臂没提 AI 编辑器：${results['放行'].sentence}`);
  if (!/让 AI 编辑器/.test(results['拒绝'].sentence) && /手改/.test(results['拒绝'].sentence)) {
    ok('② 拒绝那臂不提 AI 编辑器、给的是手改站仓（和页面编辑器）这条真路');
  } else bad(`② 拒绝那臂仍让人去找 AI 编辑器，或没给能走的路：${results['拒绝'].sentence}`);
}

// ── ③ 问不到白名单时:不许替它选一个答案 ───────────────────────────────────────────────────────
// #1425（T3）—— 改问 `howToChangePageLayout`。它的 null 支按设计跟拒绝支同一句（见 remediation.js 那段注释：
//    两种情况下「页面编辑器 / 手改站仓」都是真路），所以原来那条「句子里说明了没问到」没有对象，删了；
//    viaProduct=null 与「给了真能做的动作」两条照旧钉。
{
  const dir = treeWith("throw new Error('boom');\n");
  const siteDir = siteWithNav(dir, 'en');
  // eslint-disable-next-line global-require
  const copy = require(path.join(dir, 'lib', 'remediation.js'));
  const r = copy.howToChangePageLayout({ rootDir: NEXTJS, siteDir });
  if (r.viaProduct === null) ok('③ 读不到那个判断模块 ⟹ viaProduct=null（"没问到"不是一个答案）');
  else bad(`③ 读不到判断模块却给了 viaProduct=${r.viaProduct} —— 那是一句没人查过的话`);
  if (/手改/.test(r.sentence) && !/让 AI 编辑器/.test(r.sentence)) ok('③ 仍然给了一个今天真能做的动作（手改站仓），且没替白名单说「AI 编辑器能改」');
  else bad(`③ 没给能做的事，或替问不到的白名单说了放行：${r.sentence}`);
  fs.rmSync(dir, { recursive: true, force: true });
}

// 📌 #1425（T3）—— 这里原来是 ④：navigation.json 读不出来时 `howToAddTopbar` 说人话；它随公告条退役。

// ── ④b 老的扁平站:文件在 site/navigation.json,不在 site/en/ 下面 ─────────────────────────────
// #1425（T3）—— 原来经 `howToAddTopbar` 的句子间接量；它删了，改为直接量还导出着的 `navRelPath`（两臂）。
{
  const flat = navRelPath('en', true);
  if (flat === 'navigation.json') ok('④b 扁平站：navRelPath(en, flat) = navigation.json');
  else bad(`④b 扁平站上指错了文件：${flat}`);
  // 反向对照：同一个 locale、不是扁平站 ⟹ 必须带语言目录（证明上面那格判的是 flat 这一维）
  const loc = navRelPath('en', false);
  if (loc === 'en/navigation.json') ok('④b 反向对照：同一个 locale 不传 flat ⟹ en/navigation.json ⟹ 上面那格判的就是这一维');
  else bad(`④b 反向对照失败：不传 flat 时读到 ${loc}`);
}

// ── ⑤ 换 page layout:那句话必须说实话,而且库的名单是【读目录】读出来的 ────────────────────────
{
  const r = howToChangePageLayout({ rootDir: NEXTJS });
  if (/手改/.test(r.sentence)) ok('⑤ 给了真能走的路（页面编辑器之外，也写了手改站仓的 site/page-layout.json）');
  else bad(`⑤ 没给真能走的路：${r.sentence}`);
  if (/picker|换装弹窗|布局选择器/i.test(r.sentence)) {
    bad(`⑤ 把人指到一个不存在的布局选择器 —— #1087 r3 就是为这个被退回过：${r.sentence}`);
  } else ok('⑤ 没有把人指到一个不存在的布局选择器');
  if (/standard/.test(r.sentence)) ok('⑤ 名单里有 standard');
  else bad(`⑤ 名单里没有 standard：${r.sentence}`);

  // 🔴 阳性对照:名单是读目录读出来的,还是抄了一份写死的?
  //    **在一棵临时树里做,不碰真的 `page-layouts/`** —— 往交付树里写一个探针文件,只要这个进程被
  //    掐掉(前台命令撞超时会被 SIGKILL)就会留在那儿跟着 ship 出去,而 `finally` 那时不跑。
  //    临时树同样证得了「名单是读目录来的」：换一个 rootDir，名单就跟着换。
  {
    const t = fs.mkdtempSync(path.join(os.tmpdir(), 'remediation-layouts-'));
    fs.mkdirSync(path.join(t, 'page-layouts'));
    for (const n of ['aaa-probe', 'zzz-probe']) {
      fs.writeFileSync(path.join(t, 'page-layouts', `${n}.json`), '{"regions":["content"]}');
    }
    const s2 = howToChangePageLayout({ rootDir: t }).sentence;
    fs.rmSync(t, { recursive: true, force: true });
    // 🔴 只看**名单那一段**。整句话里还有一句固定的「这个文件不在就按 standard 走」——
    //    拿整句话去断言「不含 standard」永远失败，而那看起来像「名单是写死的」。
    //    （我第一版就是这么假红的：坏的是断言，不是被测的代码。）
    //    🔴 收尾符必须把**两种句形**都算进去：拒绝那句用 `；` 收尾，放行那句用 `）` 收尾。
    //    只写 `[^；]*` 时，放行句形下会把 `）。` 一起吞进名单里 —— 于是这一格红，而它印的理由是
    //    「那份名单是写死的」**假话**（名单其实跟着目录变了）。抓到它的是「反方向写死成放行」那一臂。
    const listOf = (str) => (str.match(/库里有：([^；）]*)/) || [, ''])[1];
    if (listOf(s2) === 'aaa-probe / zzz-probe') {
      ok('⑤ 阳性对照：换一棵只有两个假布局的树，名单那一段变成 `aaa-probe / zzz-probe`'
        + ' ⟹ 它是读目录来的，不是写死的');
    } else {
      bad(`⑤ 阳性对照失败：换了目录名单没跟着变 ⟹ 那份名单是写死的，加布局时它会过期：`
        + `名单那一段读到「${listOf(s2)}」`);
    }
  }
  // 真的那个目录一个字节都没被这份测试碰过
  {
    const real = fs.readdirSync(path.join(NEXTJS, 'page-layouts')).sort().join(' ');
    if (!/probe/.test(real)) ok(`⑤ 真的 page-layouts/ 没被污染（现在是：${real}）`);
    else bad(`⑤ 真的 page-layouts/ 里有探针残留：${real}`);
  }
}

// 📌 #1425（T3）—— 这里原来是 ⑤b：「换一套顶栏不是透明浮层的主题」那份名单（`themesWithoutOverlayHeader`）。新库的 header
//    没有透明浮层形态，「浮层 + 公告条」那条拒绝和这个函数一起删了。

// ── ⑥ 「改布局去哪儿改」是一句关于仓库的断言,在仓库上钉住它（#1405 起答案是页面编辑器）──────────
{
  const { execFileSync } = require('child_process');
  const dirs = ['dashboard/src', 'manager', 'worker'].map((d) => path.join(REPO, d));
  const present = dirs.filter((d) => fs.existsSync(d));
  if (present.length !== dirs.length) {
    console.log(`  ⚠️  ⑥ 跳过：在 ${REPO} 底下找不到 ${dirs.filter((d) => !fs.existsSync(d)).join(' / ')}`
      + ' —— 这**不是**通过，只是这次没在仓里跑（副本树里跑就会这样）');
  } else {
    const count = (pattern) => {
      try {
        const out = execFileSync('grep', ['-rIlE', pattern, ...present], { encoding: 'utf-8' });
        return out.split('\n').filter(Boolean).length;
      } catch (e) {
        return 0;   // grep 没命中时退出码 1
      }
    };
    // 🔴 #1405 起产品里**有**写入者了：页面编辑器的 root 字段「Page layout」（容器里那一步是
    //    `scripts/write-editor-save.js`）。这一格原来钉的是「0 个写入者」—— 那一天它红了，正是它该红的时候，
    //    措辞随之改成把人指到编辑器。现在钉反过来那一半：句子声称有一个界面，那个界面就必须真在。
    const editorDir = path.join(REPO, 'templates', 'nextjs', 'src', 'components', 'editor');
    const field = fs.existsSync(editorDir) ? (() => {
      try {
        return execFileSync('grep', ['-rIlF', 'Page layout (whole website)', editorDir], { encoding: 'utf-8' }).split('\n').filter(Boolean).length;
      } catch (e) {
        return 0;
      }
    })() : 0;
    const sentence = howToChangePageLayout({ rootDir: NEXTJS }).sentence;
    const writer = fs.existsSync(path.join(REPO, 'templates', 'nextjs', 'scripts', 'write-editor-save.js'));
    if (!/Page layout \(whole website\)/.test(sentence)) {
      bad(`⑥ 页面编辑器能改布局了，而那句补救的话没把人指到它：${sentence}`);
    } else if (field === 0 || !writer) {
      bad('⑥ 那句话把人指到页面编辑器的「Page layout (whole website)」，而编辑器里找不到这个字段 / 容器里没有'
        + ' write-editor-save.js —— 那句话现在是假的，回去改措辞');
    } else {
      ok(`⑥ 补救的话指到页面编辑器的「Page layout」，而那个字段真在编辑器里（${field} 个文件）、写它的脚本真在`);
    }
    const calib = count('themeId');
    if (calib === 0) bad('⑥ 尺子校准失败：连 themeId 都数到 0 —— 这几个 grep 的读数一个都不能信');
    // 📌 #1425（T3）—— 这里原来还钉着「换装弹窗（ThemeModal）真在」：那是透明浮层那条报错把人指去的界面，
    //    那条报错随公告条一起删了，这一半没有对象。
    if (calib > 0) ok(`⑥ 尺子校准：themeId 命中 ${calib} 个文件`);
  }
}

// 📌 #1425（T3）—— 这里原来是 ⑧：topbar 补救行的条数上限（`topbarBullets` / `BULLET_CAP`）；随公告条退役。

// ── ⑦ 接线:sync-config.js 真的用这几句话(否则模块再对,报错照样在说假话)──────────────────────
{
  const src = fs.readFileSync(path.join(NEXTJS, 'scripts', 'sync-config.js'), 'utf-8');
  const bads = [];
  if (!/require\(['"]\.\/lib\/remediation(\.js)?['"]\)/.test(src)) bads.push('没 require lib/remediation');
  // 📌 #1425（T3）—— topbar 那几句的接线（topbarBullets / flat 传参 / themesWithoutOverlayHeader）随公告条
  //    退役，这里删了；旧假话「不许回来」那几条反向断言照留。
  if (!/howToChangePageLayout\(/.test(src)) bads.push('没调 howToChangePageLayout');
  // 🔴 #1138 —— 每一处 howToChangePageLayout 都要把 siteDir 传进去。
  //    说在明处：**今天这个参数不改变任何答案** —— `page-layout.json` 不是按语言存的文件，形状那一维
  //    对它不说话（⑨ 那格量的就是它：两种问法同一个答案）。所以这一格钉的不是一个后果，是一条**纪律**：
  //    「问白名单时不带这个站的形状」正是 #1138 正文 N2 描述的那个形状 —— 拿到的不是错误，是另一道题的
  //    答案，而两个答案碰巧相同的那一天没有任何东西会说话。#1138 给白名单加了一问之后，
  //    `howToAddTopbar` 那条路当场就分歧了（⑨ 的阳性对照是它的读数）。这一条挡的是下一个 REJECT_REASON
  //    落在按语言存的文件上时，这条路静默说出一句真编辑器会拒的建议。
  {
    const calls = src.match(/howToChangePageLayout\(\{[^}]*\}\)/g) || [];
    const noSite = calls.filter((c) => !/siteDir/.test(c));
    if (!calls.length) bads.push('数不出 howToChangePageLayout 的调用点 —— 这条读数不作数（改了写法就来改这条正则）');
    else if (noSite.length) bads.push(`${noSite.length}/${calls.length} 处 howToChangePageLayout 调用没传 siteDir：${noSite.join(' · ')}`);
  }
  // 🔴 旧那两句假话必须消失。只钉「新话在」的话，把旧话留在旁边也照样绿。
  if (/在 navigation\.json 里加 \{ "topbar"/.test(src)) {
    bads.push('还留着旧那句「在 navigation.json 里加 { "topbar"…」——它当时是走不通的那条路');
  }
  if (/· 换一个不带 topbar 区的 page layout，或者换一套顶栏不是透明浮层的主题/.test(src)) {
    bads.push('透明浮层那条报错还留着旧措辞（它的「换 page layout」那一半走不通）');
  }
  // 🔴 AC3 扫查抓到的第三处：CSS 契约那条报错以前给裸的 `docs/reference/…`，而这个脚本的 cwd
  //    （平台仓的 templates/nextjs / 站容器的 /app/repo）底下都没有 docs/ ⟹ 那条路两处都走不通。
  if (/'  · docs\/reference\/theme-css-contract\.md says/.test(src)) {
    bads.push('CSS 契约那条又变回裸的 docs/reference/… —— 从这个脚本的 cwd 解析不开');
  }
  // 🔴 旧那个恒为真的判据不许留在报错里（`supports` 是数组，`!==` 一个字符串排除不掉任何主题）
  if (/supports\.header 不是 transparent-overlay/.test(src)) {
    bads.push('还留着「supports.header 不是 transparent-overlay 的那些」——那个判据恒为真，一套都排除不掉');
  }
  if (bads.length === 0) ok('⑦ sync-config.js 接上了换布局那句话，旧那几句假话也不在了');
  else bads.forEach((b) => bad(`⑦ ${b}`));
}

// ── ⑦b 真跑一次 sync-config，读它自己吐出来的那两行（#1134，来源 #1108）──────────────────────────
//
// 🔴 上面 ⑦ 是**在源码上 grep**，它按构造对一种失效瞎：**字符串还在、那条调用变成不可达**
//    （分支条件改了 / 那段被移到一个走不到的地方 / 报错在它之前就 return 了）。那时 ⑦ 全绿，而
//    老板一句补救办法都拿不到。
// 🔴 #1108 的 QA2 量过升级成真跑的代价并判它值：造一个最小站 + 一次 `sync-config` ——
//    不用 LLM、不用构建。#1134 实测这一格总共 **~0.1 秒**（比 QA2 估的 4 秒还便宜；那 4 秒里
//    大概含了 npm 那一段）。
// 🔴 隔离：一切都在 `mkdtemp` 出来的一次性目录里。绝不在真树上跑 —— `sync-config.js` 读的是
//    `path.resolve(__dirname, '..') + '/site'`，在真树上跑会拿真站的 `site/` 说话，还会重写
//    `src/lib/config-data.ts`（那是共享树上别人正在用的字节）。
// 🔴 **`scripts/` 必须真拷，不许 symlink** —— 这是 #1134 立这一格时踩到的仪器坑，写在明处：
//    `__dirname` 会**穿过 symlink 解到真路径**，于是 `rootDir` 算出来是真树，这一格就跑去读真树的
//    `site/` 了（第一版的读数逐字是 `Site config not found: <真树>/templates/nextjs/site/brand.json`
//    —— 这棵树恰好没有 `site/` 才没造成后果，那是运气，不是判据）。`page-layouts` / `schemas` /
//    `blocks` 是相对 `rootDir` 读的，symlink 对它们是安全的。
// #1425（T3）—— 原来的夹具是「挑 with-topbar 布局却没写 topbar 内容」（两条补救办法：topbar 那条 + 换布局那条）。
//    with-topbar 布局与 topbar 那条一起删了；今天还能走到 howToChangePageLayout 的那条真路是「page-layout.json
//    选了一个库里没有的布局」（sync-config 的 layoutProblems 支）。夹具换成它，判据照旧：rc=1 + 诊断在 + 补救在。
console.log('── ⑦b 真跑一次 sync-config：page-layout.json 选了库里没有的布局 ⟹ rc=1 且换布局那条补救办法在 stderr 上');
{
  const t = fs.mkdtempSync(path.join(os.tmpdir(), 'remediation-live-sync-'));
  try {
    // scripts 真拷（理由见上面那条 🔴：symlink 会让 __dirname 解到真树）
    require('child_process').execSync(`cp -a "${path.join(NEXTJS, 'scripts')}" "${path.join(t, 'scripts')}"`, { stdio: 'pipe' });
    // 这三块相对 rootDir 读，symlink 安全，也省掉整份拷贝
    for (const d of ['page-layouts', 'schemas', 'blocks']) {
      fs.symlinkSync(path.join(NEXTJS, d), path.join(t, d));
    }
    // 会被写的那两块：真目录（`src/lib/config-data.ts` 与 `public/theme.css` 落在这里）
    fs.mkdirSync(path.join(t, 'src', 'lib'), { recursive: true });
    fs.mkdirSync(path.join(t, 'public'), { recursive: true });
    // 🔴 `scripts/blocks.js` 会 `require('../src/lib/sections/block-roles.json')` —— require 闭包
    //    离开了 scripts/，所以这一块也得在。只拷它，不拷整个 src/（`src/` 里那份 config-data.ts
    //    是**产物**，拷进来只会让这一格读到别人上一次同步的字节）。
    require('child_process').execSync(
      `mkdir -p "${path.join(t, 'src', 'lib', 'sections')}" && `
      + `cp -a "${path.join(NEXTJS, 'src', 'lib', 'sections')}/." "${path.join(t, 'src', 'lib', 'sections')}/"`,
      { stdio: 'pipe' });
    const site = path.join(t, 'site');
    fs.mkdirSync(path.join(site, 'pages'), { recursive: true });
    const shade = (ks, v) => Object.fromEntries(ks.map((k) => [String(k), v]));
    const w = (rel, obj) => fs.writeFileSync(path.join(site, rel), JSON.stringify(obj, null, 2));
    w('page-layout.json', { layoutId: 'zz-no-such-layout' });     // ← 库里没有这个布局
    w('brand.json', {
      name: 'T', tagline: 't', logoIcon: 'shield-check',
      colors: { primary: shade([50, 100, 200, 300, 400, 500, 600, 700, 800, 900], '#0ea5e9'),
        accent: shade([50, 100, 200, 300, 400, 500, 600], '#f97316') },
      fonts: { heading: ['"Inter"', 'sans-serif'], body: ['"Inter"', 'sans-serif'], googleFontsUrl: '' },
      email: 'a@b.c', locations: [],
    });
    w('seo.json', { domain: 't.example', locale: 'en', metaTitle: 'T', metaDescription: 't', keywords: [] });
    fs.writeFileSync(path.join(site, 'services.json'), '[]');
    w('navigation.json', { header: { links: [], cta: { label: 'Go', href: '/contact' } },
      footer: { columns: [], copyright: 'c' } });
    w('pages/home.json', { slug: 'home', title: 'Home', description: 'd', navLabel: 'Home', navOrder: 1,
      changeFrequency: 'weekly', priority: 1, blocks: [] });

    const r = require('child_process').spawnSync(process.execPath, [path.join(t, 'scripts', 'sync-config.js')],
      { cwd: t, encoding: 'utf-8', timeout: 120000 });
    const all = `${r.stdout || ''}\n${r.stderr || ''}`;
    r.status === 1
      ? ok(`⑦b 真跑：rc=1（选了库里没有的布局 ⟹ 拒绝，不是静默按 standard 走）`)
      : bad(`⑦b 真跑：rc=${r.status}，期望 1 —— 这个缺口没被拦住，或者夹具立不起来。输出末尾：`
        + `${all.trim().split('\n').slice(-3).join(' ⏎ ')}`);
    // 那句诊断
    /选的 "zz-no-such-layout" 不在库里/.test(all)
      ? ok('⑦b 真跑：那句诊断在（点名是哪个缺口）')
      : bad('⑦b 真跑：那句诊断不在 —— 拒的可能是别的原因，这一格量的不是这条路');
    // 🔴 两条补救办法都要真的印出来。这才是 ⑦ 那种静态 grep 证不了的那一半。
    for (const [what, re] of [
      ['换布局那条', /手改这个站仓里的 site\/page-layout\.json/],
    ]) {
      re.test(all)
        ? ok(`⑦b 真跑：${what}补救办法印出来了，而且路径是**从站仓根看**的（带 site/，#1134 item 34）`)
        : bad(`⑦b 真跑：${what}补救办法没印出来（或者路径少了 site/ 那一层）—— `
          + `字符串在源码里而这条调用走不到，正是 ⑦ 看不见的那种失效`);
    }
  } finally {
    try { fs.rmSync(t, { recursive: true, force: true }); } catch { /* 清不掉不该让这一格红 */ }
  }
}

// ── ⑨ 这里问出来的答案，必须跟【真编辑器】对同一条路径的答案相同（#1138）────────────────────────
//
// 🔴 为什么要有这一格。`editorCanWrite` 问的是白名单，而白名单的第二问是「这个文件在**这个站**上
//    有人读吗」—— 它要这个站的形状。形状问不到时那一维**不判**，也就是说：一个调用点忘了递形状，
//    它拿到的不是错误，是**另一道题的答案**。#1138 之前这条路碰巧不产生假建议（#1138 正文 N2 量过：
//    `howToAddTopbar` 问的路径形状本来就对、`howToChangePageLayout` 问的那个文件两种问法都拒）。
//    #1138 给白名单加了「这个语言这个站有没有」这一问之后就开始分歧了：站里只有 `en` 而这里问
//    `fr/navigation.json`，不递形状 ⟹ 这里说「在聊天里让 AI 编辑器加」，而真编辑器当场拒 ——
//    那句话就是 #1108 立这个模块要治的那个病（产品的报错在建议一个产品自己禁止的动作）。
//
// 🔴 判据是**行为**，不是「源码里有没有 readSiteShape 这个词」：下面拿真编辑器那套 ctx
//    （`edit-site.js §executeTool` 的 `writeCtx` 递的那几个键）独立算一遍，两个答案必须逐条相同。
{
  const { writeRejection } = require('./editable-files.js');
  const { readSiteShape } = require('./site-shape.js');

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'remediation-locale-'));
  const siteDir = siteWithNav(dir, 'en');            // site_meta.json 只列 en
  // 一个**站里没有**的语言目录：升级/误写留下的残留。site_meta.json 不动 ⟹ 这个站仍然只有 en。
  fs.mkdirSync(path.join(siteDir, 'fr'), { recursive: true });
  fs.copyFileSync(path.join(siteDir, 'en', 'navigation.json'), path.join(siteDir, 'fr', 'navigation.json'));
  const shape = readSiteShape(siteDir);
  if (!shape || shape.flat !== false || shape.locales.join(',') !== 'en') {
    die(`⑨ 夹具不对：readSiteShape 读到 ${JSON.stringify(shape)}，要的是 {flat:false, locales:['en']}`);
  }

  /**
   * 真编辑器会怎么答同一条路径 —— ctx 按 `edit-site.js` 的 write_file 原样搭。
   * 🔴 送进去的内容必须跟 `howToAddTopbar` 送的那份**一样**（#1104 之后白名单判的是「这次写入改了
   *    哪几处」）：喂一份别的内容问出来的是另一道题的答案。所以这里照它的做法现搭一份。
   */
  const askRealEditor = (rel) => {
    const full = path.join(siteDir, rel);
    let current = null;
    try { current = JSON.parse(fs.readFileSync(full, 'utf-8')); } catch (e) { current = null; }
    const ctx = { readSiteShape: () => readSiteShape(siteDir) };
    if (current !== null) {
      ctx.content = JSON.stringify({ ...current, topbar: { message: '示例文案', link: { label: '示例', href: '/contact' } } });
      ctx.readCurrent = (p) => { try { return fs.readFileSync(path.join(siteDir, p), 'utf-8'); } catch (e) { return null; } };
    }
    return writeRejection(rel, ctx) === null;
  };

  /** 一组要对账的问题：这里怎么答（viaProduct） vs 真编辑器怎么答。
   *  📌 #1425（T3）—— 原来还有 en/fr navigation.json 两条（经 `howToAddTopbar` 问），随它删了；只剩 page-layout.json。 */
  const askHere = (mod2) => [
    ['page-layout.json', mod2.howToChangePageLayout({ rootDir: NEXTJS, siteDir }).viaProduct],
  ];

  const rows = askHere(mod).map(([rel, here]) => ({ rel, here, real: askRealEditor(rel) }));
  const mismatch = rows.filter((r) => r.here !== r.real);
  if (mismatch.length === 0) {
    ok(`⑨ ${rows.length} 条路径逐条对账，这里的答案与真编辑器相同（`
      + `${rows.map((r) => `${r.rel}=${r.here}`).join(' · ')}）`);
  } else {
    mismatch.forEach((r) => bad(`⑨ ${r.rel}：这里说 ${r.here}，真编辑器说 ${r.real}`
      + ' —— 那句话在建议一个真编辑器会拒的动作（#1108 要治的那个病）'));
  }

  // 📌 #1425（T3）—— 这里原来还有两格：「这组问题有区分力（en 放行 / fr 拒）」与阳性对照「撤掉递形状那一步 ⟹
  //    在 fr/navigation.json 上分歧」。两格的区分力都来自按语言存的 navigation.json（经 `howToAddTopbar` 问），
  //    而 page-layout.json 不按语言存、形状对它不说话 ⟹ 新库里找不到等价的反向臂。「放行 / 拒绝」那一维由 ② 的
  //    两臂守着；「形状真被递进去」今天没有任何读数能区分（按构造不影响唯一剩下的那个答案）。
  fs.rmSync(dir, { recursive: true, force: true });
}

console.log(`\n══ 汇总: 通过 ${pass} · 失败 ${fail}`
  + (skipped ? ` · 🔴 脚手架池跳过 ${skipped} 格（#1317，不是通过）` : '') + ' ══');
process.exit(fail ? 1 : 0);
