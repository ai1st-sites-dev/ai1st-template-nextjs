#!/usr/bin/env node
/**
 * site-shape.test.js — #1109：AI 编辑器往「这个站的构建根本不读」的位置写内容，必须被拒。
 *
 *   node scripts/lib/site-shape.test.js     （由 `npm run test:scripts` 自动发现）
 *   退出码: 0 全过 · 1 有失败 · 2 跑不起来（**不许当成通过**）
 *
 * ══ 为什么要有它 ═══════════════════════════════════════════════════════════════════════════════
 * 白名单（`lib/editable-files.js`）只看文件名，而同一个文件名在两种站上住在不同的地方：多语言站
 * 的内容在 `site/<语言>/`，老的单语言扁平站直接在 `site/`。位置写错时这条路**不报错也不生效**：
 * 落盘 → `sync-config` rc=0 → commit + push → 老板收到「Done」→ 站上一个像素都没变。没有任何一层
 * 会红，所以只能靠一道常设的判断。
 *
 * ══ 这份测试跟 `editable-files.test.js` ⑦ 的分工（两个读数，缺一个都不够）═══════════════════════
 * · ⑦ 那边的形状是**造出来的**两个字面量 ⟹ 它证的是「拿到形状之后判得对」。
 * · 这边的形状是**真夹具上读出来的** ⟹ 它证的是「`readSiteShape` 在真站上读得对」，而这一半
 *   ⑦ 按构造看不见：`readSiteShape` 返回错的形状时 ⑦ 全绿，而真站上这道门会开始拒正确的路径。
 *
 * ══ 🔴 扁平夹具是**拼出来的**，这一点必须写在明处 ═══════════════════════════════════════════════
 * 今天没有任何一条建站路会产出扁平站 —— `create-site.js` 连 `skipAI` 的单语言站都带 `site_meta.json`
 * + `site/en/`（#1109 正文第 3 条，出处是 #1087 的 QA3）。所以这里的扁平夹具是**由多语言夹具转出来
 * 的**：把 `site/<语言>/` 底下的东西搬到 `site/`、删掉 `site_meta.json`。
 *
 * 拼的东西凭什么算「真的扁平站」—— 判据不是我说它像，是**构建自己认它**：两个夹具各跑一次
 * `sync-config.js`，多语言那份不带 `[legacy schema]`、扁平那份打出 `[backward-compat] site_meta.json
 * missing`，而且两份都 rc=0。也就是说构建在这两个夹具上真的走了两条不同的分支，并且都成功 ——
 * 这正是「根级那份有没有人读」这个问题的前提。
 */

'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const cp = require('child_process');

const NEXT = path.resolve(__dirname, '..', '..');
const { readSiteShape } = require('./site-shape.js');
const { writeRejection } = require('./editable-files.js');

let pass = 0; let fail = 0;
const ok = (m) => { pass += 1; console.log(`  ✅ ${m}`); };
const bad = (m) => { fail += 1; console.log(`  ❌ ${m}`); };
const die = (m) => { console.error(`🔴 跑不起来: ${m}`); process.exit(2); };

if (typeof readSiteShape !== 'function') die('site-shape.js 没导出 readSiteShape');

// ── 收尾 ────────────────────────────────────────────────────────────────────────────────────────
// 🔴 挂在 `process.on('exit')` 上，不写在最后一行：`die()` 走 exit(2)、断言失败走 exit(1)，
//    两条路都不会执行"最后一行"（同 `edit-site-chain.test.js` 的理由）。排查用 SITE_SHAPE_KEEP=1。
const TEMP = [];
const KEEP = process.env.SITE_SHAPE_KEEP === '1';
function temp(prefix) {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  TEMP.push(d);
  return d;
}
process.on('exit', () => {
  if (KEEP) {
    if (TEMP.length) console.log(`\n📌 SITE_SHAPE_KEEP=1 ⟹ 留着 ${TEMP.length} 个临时目录，第一个是 ${TEMP[0]}`);
    return;
  }
  for (const d of TEMP) { try { fs.rmSync(d, { recursive: true, force: true }); } catch (e) { /* 打扫不成不改结论 */ } }
});

/**
 * 一棵只属于这一跑的模板树。`create-site.js` 往 `<rootDir>/site` 写，而 rootDir 就是 scripts 的上级
 * 目录 —— 就地跑一次会盖掉这棵树上那个在用的 `site/`（开发机上正有人在预览它）。
 * node_modules 借共享那份（create-site.js 顶层 require 了 SDK），不拷。
 */
function makeTree(label) {
  const root = temp(`site-shape-${label}-`);
  const work = path.join(root, 'nextjs');
  cp.execSync(`cp -a --no-dereference "${NEXT}" "${work}"`, { stdio: 'pipe' });
  for (const junk of ['out', '.next', '.out-backup', '.out-temp', 'site', 'node_modules']) {
    fs.rmSync(path.join(work, junk), { recursive: true, force: true });
  }
  fs.symlinkSync(path.join(NEXT, 'node_modules'), path.join(work, 'node_modules'));
  return work;
}

/** 用仓里那条 skipAI 建站路造一份**真的**站（不调 AI、不花钱）。返回 site 目录。 */
function makeLocaleSite(work) {
  const payload = JSON.stringify({
    siteId: 'shapetest', companyName: 'Northside Auto Care', industry: 'auto repair',
    location: 'Toronto', skipAI: true, language: 'en',
  });
  const r = cp.spawnSync(process.execPath, [path.join(work, 'scripts', 'create-site.js')], {
    input: payload, cwd: work, encoding: 'utf8',
    env: { ...process.env, ANTHROPIC_API_KEY: undefined }, timeout: 180000,
  });
  const site = path.join(work, 'site');
  // 🔴 夹具先自证，再取读数：立不起来就 exit 2。手搓最小 JSON 的那条路在 #1103 上塌过一次
  //    （sync-config 在第一行就退出，四条断言全绿、全在测「我的夹具是坏的」）。
  if (!fs.existsSync(path.join(site, 'site_meta.json')) || !fs.existsSync(path.join(site, 'en', 'seo.json'))) {
    die(`多语言夹具立不起来（rc=${r.status}）—— create-site.js 的 skipAI 路没造出 site/site_meta.json + site/en/seo.json\n${(r.stderr || '').slice(-600)}`);
  }
  return site;
}

/** 把多语言夹具转成扁平站（今天没有建站路会产出这个形状，理由在文件头）。 */
function flattenSite(site) {
  const meta = JSON.parse(fs.readFileSync(path.join(site, 'site_meta.json'), 'utf-8'));
  const locale = meta.defaultLocale;
  if (!locale || !fs.existsSync(path.join(site, locale))) die(`转扁平失败：site/${locale} 不在`);
  for (const entry of fs.readdirSync(path.join(site, locale))) {
    fs.renameSync(path.join(site, locale, entry), path.join(site, entry));
  }
  fs.rmSync(path.join(site, locale), { recursive: true, force: true });
  fs.rmSync(path.join(site, 'site_meta.json'));
  return locale;
}

/** 跑一次真的 `sync-config.js`，把它自己说的那句形状交回来。 */
function syncConfig(work) {
  const r = cp.spawnSync(process.execPath, [path.join(work, 'scripts', 'sync-config.js')], {
    cwd: work, encoding: 'utf8', timeout: 180000,
  });
  return { rc: r.status, out: `${r.stdout || ''}${r.stderr || ''}` };
}

// ══ ① 两个真夹具，构建自己认它们是两种形状 ══════════════════════════════════════════════════════
console.log('① 两个真夹具（构建自己认它们是两种形状）');
const localeWork = makeTree('locale');
const localeSite = makeLocaleSite(localeWork);
const flatWork = makeTree('flat');
const flatSite = makeLocaleSite(flatWork);
const flatLocale = flattenSite(flatSite);

{
  const a = syncConfig(localeWork);
  const b = syncConfig(flatWork);
  const problems = [];
  if (a.rc !== 0) problems.push(`多语言夹具过不了 sync-config（rc=${a.rc}）`);
  if (b.rc !== 0) problems.push(`扁平夹具过不了 sync-config（rc=${b.rc}）`);
  if (/\[legacy schema\]/.test(a.out)) problems.push('多语言夹具被构建当成了老扁平站 —— 那这一跑的两个夹具是同一个形状');
  if (!/\[backward-compat\] site_meta\.json missing/.test(b.out)) {
    problems.push('扁平夹具没让构建走 legacy 分支 —— 它不是真的扁平站，下面那几格量的不是本票要治的东西');
  }
  if (problems.length === 0) {
    ok(`两个夹具都 rc=0，而且构建在它们身上走了两条不同的分支（多语言：无 [legacy schema] · 扁平：site_meta.json missing，defaultLocale 原来是 ${flatLocale}）`);
  } else problems.forEach(bad);
}

{
  const s1 = readSiteShape(localeSite);
  const s2 = readSiteShape(flatSite);
  const problems = [];
  if (!s1 || s1.flat !== false) problems.push(`多语言夹具读成了 ${JSON.stringify(s1)}`);
  else if (!s1.locales.includes('en')) problems.push(`多语言夹具读到的 locales 里没有 en：${JSON.stringify(s1.locales)}`);
  if (!s2 || s2.flat !== true) problems.push(`扁平夹具读成了 ${JSON.stringify(s2)}`);
  if (problems.length === 0) ok(`readSiteShape 在真夹具上读对了（多语言 ${JSON.stringify(s1)} · 扁平 ${JSON.stringify(s2)}）`);
  else problems.forEach(bad);
}

// ── 真路径上那次调用长什么样：`edit-site.js` 的 write_file 递的就是这两个键（+ navigation 那两个）

/** 这个夹具里那份**真的** navigation.json 在哪（多语言站在 `<语言>/` 下，扁平站在根）。 */
function navSourceOf(site) {
  const flat = path.join(site, 'navigation.json');
  if (fs.existsSync(flat)) return flat;
  for (const entry of fs.readdirSync(site, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const nested = path.join(site, entry.name, 'navigation.json');
    if (fs.existsSync(nested)) return nested;
  }
  return die(`${site} 里找不到 navigation.json —— 夹具不完整，不给读数`);
}

function ctxFor(site, relPath) {
  const ctx = { readSiteShape: () => readSiteShape(site) };
  if (relPath.endsWith('navigation.json')) {
    // navigation.json 走 #1104 那道窄口子：光有形状不够，得有这次的内容 + 磁盘上那份。
    // 🔴 拿这个站**真实的**那份当基准（合成一份会把别的字段也算成改动 ⟹ 问出来的是另一道题的
    //    答案，同 `lib/remediation.js` 里那段），改的是构建不碰的 topbar。
    const cur = JSON.parse(fs.readFileSync(navSourceOf(site), 'utf-8'));
    ctx.content = JSON.stringify({ ...cur, topbar: { message: '24h emergency', link: { label: 'Call', href: '/contact' } } });
    ctx.readCurrent = (p) => { try { return fs.readFileSync(path.join(site, p), 'utf-8'); } catch (e) { return null; } };
  }
  return ctx;
}
const askOn = (site, relPath) => writeRejection(relPath, ctxFor(site, relPath));

// 本票钉住的那几个路径：多语言站上写在根 = 没人读；扁平站上写在 <语言>/ = 没人读。
const ROOT_PATHS = ['seo.json', 'services.json', 'pages/home.json', 'navigation.json'];
const LOCALE_PATHS = ROOT_PATHS.map((p) => `en/${p}`);

// ══ ② 多语言真夹具：根目录那几份被拒（AC1/AC4），正确路径照旧放行（AC2）═══════════════════════
console.log('② 多语言真夹具');
{
  const problems = [];
  for (const p of ROOT_PATHS) {
    const why = askOn(localeSite, p);
    if (why === null) problems.push(`根级 ${p} 竟然可写 —— 写进去落盘、同步过、老板收到 Done，而站上什么都没变`);
    else if (!/multi-language site/.test(why) || !/site\/<language>\//.test(why)) {
      problems.push(`${p} 被拒了，但理由没点明「这个站是多语言结构，内容在 site/<语言>/ 下面」：${why.split('\n')[0]}`);
    }
  }
  if (problems.length === 0) ok(`根目录那 ${ROOT_PATHS.length} 个路径全部被拒，理由点名了这个站是多语言结构`);
  else problems.forEach(bad);

  const killed = LOCALE_PATHS.filter((p) => askOn(localeSite, p) !== null);
  if (killed.length === 0) ok(`正确路径 ${LOCALE_PATHS.join(' · ')} 照旧放行（没把功能治死）`);
  else bad(`这些【应该】可写却被拒了：${killed.map((p) => `${p} → ${String(askOn(localeSite, p)).split('\n')[0]}`).join(' ｜ ')}`);

  // 🔴 今天（改之前）根级 navigation.json 在这个夹具上**也**是拒的，但那是**碰巧**：#1104 那道门
  //    读不到磁盘上那份就 fail-closed，而这个夹具的根目录里没有 navigation.json。老扁平站升级布局
  //    留下一份残留的根级 navigation.json 时，改之前那条路是**放行**的（我在这一轮真量过）。
  //    所以这一格把那份残留造出来，钉的是「按形状拒」而不是「碰巧没有那个文件」。
  withStaleNav(localeSite, 'navigation.json', () => {
    const why = askOn(localeSite, 'navigation.json');
    if (why === null) bad('根级 navigation.json 真的存在时竟然可写 —— 这正是改之前那条路的样子');
    else if (!/multi-language site/.test(why)) bad(`根级 navigation.json 被拒了，但不是按形状拒的（换个站就会放行）：${why.split('\n')[0]}`);
    else ok('根级 navigation.json 真的存在时也按形状拒（不是靠「那个文件碰巧不在」）');
  });
}

/**
 * 造一份「残留在错位置的 navigation.json」，跑完就清掉。
 *
 * 🔴 为什么两个方向都需要它：#1104 那道窄口子在**读不到磁盘上那份**时 fail-closed，而位置写错的时候
 *    那个文件通常正好不在 ⟹ 改之前这条路也是拒的，但拒的是「没法跟磁盘上那份比」，换个站（那份真的
 *    在）就放行。所以要钉「按形状拒」，得先让那个文件真的在。
 */
function withStaleNav(site, rel, fn) {
  const target = path.join(site, rel);
  const source = navSourceOf(site);
  if (path.resolve(target) === path.resolve(source)) die(`${rel} 已经是这个夹具里那份真的 navigation.json —— 造不出「错位置的残留」`);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.copyFileSync(source, target);
  try {
    return fn();
  } finally {
    fs.rmSync(target, { force: true });
  }
}

// ══ ③ 扁平真夹具：反方向（AC3 —— 判据是真造一个扁平夹具跑一遍，不是「按代码是对称的」）══════════
console.log('③ 扁平真夹具（反方向）');
{
  const problems = [];
  for (const p of LOCALE_PATHS) {
    const why = askOn(flatSite, p);
    if (why === null) problems.push(`${p} 竟然可写 —— 这个站是扁平的，那个位置没人读`);
    else if (!/flat layout/.test(why) || !/directly under site\//.test(why)) {
      problems.push(`${p} 被拒了，但理由没点明「这个站是扁平结构，内容直接在 site/ 下面」：${why.split('\n')[0]}`);
    }
  }
  if (problems.length === 0) ok(`<语言>/ 底下那 ${LOCALE_PATHS.length} 个路径全部被拒，理由点名了这个站是扁平结构`);
  else problems.forEach(bad);

  const killed = ROOT_PATHS.filter((p) => askOn(flatSite, p) !== null);
  if (killed.length === 0) ok(`正确路径 ${ROOT_PATHS.join(' · ')} 照旧放行（没把功能治死）`);
  else bad(`这些【应该】可写却被拒了：${killed.map((p) => `${p} → ${String(askOn(flatSite, p)).split('\n')[0]}`).join(' ｜ ')}`);

  // 跟 ② 对称的那一格：`site/en/navigation.json` 真的存在时，还得按形状拒。
  // 🔴 顺带钉住「判据只看 site_meta.json 在不在」这件事：这一步在扁平夹具里造出了 `site/en/`，
  //    而形状必须还是扁平。换成「有没有 <语言>/ 目录」那种判据，这一格会翻面 —— 而那正是
  //    `lib/site-shape.js` 文件头说不许发明的第二条判据。
  withStaleNav(flatSite, 'en/navigation.json', () => {
    const shape = readSiteShape(flatSite);
    if (!shape || shape.flat !== true) bad(`造出 site/en/ 之后形状读成了 ${JSON.stringify(shape)} —— 判据不该看目录，只看 site_meta.json 在不在`);
    else ok('造出 site/en/ 之后形状仍是扁平（判据只看 site_meta.json 在不在，跟构建同一条）');
    const why = askOn(flatSite, 'en/navigation.json');
    if (why === null) bad('en/navigation.json 真的存在时竟然可写 —— 这正是改之前那条路的样子');
    else if (!/flat layout/.test(why)) bad(`en/navigation.json 被拒了，但不是按形状拒的（换个站就会放行）：${why.split('\n')[0]}`);
    else ok('en/navigation.json 真的存在时也按形状拒（不是靠「那个文件碰巧不在」）');
  });
}

// ══ ④ 阳性对照：把形状那道判断从**真源码**里删掉，上面那些路径必须回到放行 ══════════════════════
//
// 🔴 不照抄判据再实现一份：读 `editable-files.js` 自己的字节，断言那个锚点**正好出现一次**，删掉它
//    写进一棵临时的 scripts 树（require 闭包整棵拷过去），再问同样的问题。少了这一格，②③ 的绿
//    也可能来自「这两个夹具本来就哪儿都写不进去」。
// 🔴 变异写在临时目录里，不往交付树里放探针：被 SIGKILL 时收尾不跑，探针会跟着 ship（#1108 的账）。
console.log('④ 阳性对照（撤掉形状判断）');
{
  const REAL = path.join(__dirname, 'editable-files.js');
  const src = fs.readFileSync(REAL, 'utf-8');
  const ANCHORS = [
    '  const wrongPlace = wrongPlaceForShape(normalized, locale, rest, siteShapeOf(ctx));\n',
    '  if (wrongPlace) return wrongPlace;\n',
  ];
  for (const a of ANCHORS) {
    const n = src.split(a).length - 1;
    if (n !== 1) die(`阳性对照的锚点在 editable-files.js 里出现 ${n} 次（要求正好 1 次）：${a.trim()}`);
  }
  let mutated = src;
  for (const a of ANCHORS) mutated = mutated.replace(a, '');

  const dir = temp('site-shape-control-');
  cp.execSync(`cp -a "${path.join(NEXT, 'scripts')}" "${path.join(dir, 'scripts')}"`, { stdio: 'pipe' });
  const copy = path.join(dir, 'scripts', 'lib', 'editable-files.js');
  fs.writeFileSync(copy, mutated);
  // 动态 require：被测对象是那份变异过的拷贝，路径是算出来的
  const controlWrite = require(copy).writeRejection;

  const askControl = (site, relPath) => controlWrite(relPath, ctxFor(site, relPath));
  // 🔴 两个方向都得先把那份错位的 navigation.json 造出来，否则 #1104 的 fail-closed 会替这道判断
  //    背书：撤掉形状判断之后那一格仍然是拒的，而那不是形状判断的功劳（第一版就这么红过一次）。
  const stillRejected = withStaleNav(localeSite, 'navigation.json', () => withStaleNav(flatSite, 'en/navigation.json', () => [
    ...ROOT_PATHS.filter((p) => askControl(localeSite, p) !== null).map((p) => `多语言站 ${p}`),
    ...LOCALE_PATHS.filter((p) => askControl(flatSite, p) !== null).map((p) => `扁平站 ${p}`),
  ]));
  if (stillRejected.length === 0) {
    ok(`撤掉那一处之后，本票钉的 ${ROOT_PATHS.length + LOCALE_PATHS.length} 个路径全部回到放行 —— ②③ 量的是这道判断，不是夹具`);
  } else {
    bad(`撤掉形状判断之后这些仍被拒：${stillRejected.join(' · ')} —— 说明 ②③ 的绿有一部分不是这道判断给的`);
  }
}

// ══ ⑤ 「问不到形状」不许被当成任何一个答案 ══════════════════════════════════════════════════════
//
// 最容易犯的错是把「读不到」判成「扁平」：`fs.existsSync` 对一个不存在的目录里的文件也返回 false。
// 那会在一个真多语言站上把 `en/seo.json` 拒掉，理由还是一句「这个站是扁平的」假话。
console.log('⑤ 问不到形状时');
{
  const problems = [];
  const missing = readSiteShape(path.join(localeSite, 'no-such-dir'));
  if (missing !== null) problems.push(`不存在的目录读成了 ${JSON.stringify(missing)}（不许当成扁平）`);
  if (readSiteShape(path.join(localeSite, 'brand.json')) !== null) problems.push('把一个文件当成站目录读出了形状');
  if (readSiteShape('') !== null || readSiteShape(undefined) !== null) problems.push('空路径 / undefined 读出了形状');
  // `site_meta.json` 在、但读不出来：形状仍然是多语言（文件在），只是语言名说不出来。
  const broken = temp('site-shape-broken-');
  fs.writeFileSync(path.join(broken, 'site_meta.json'), '{ this is not json');
  const s = readSiteShape(broken);
  if (!s || s.flat !== false) problems.push(`site_meta.json 读不出来时形状判成了 ${JSON.stringify(s)}（它在，就是多语言站）`);
  else if (s.locales.length !== 0) problems.push(`site_meta.json 读不出来却报出了语言名：${JSON.stringify(s.locales)}`);
  if (problems.length === 0) ok('不存在的目录 / 文件 / 空路径都返回 null；site_meta.json 读不出来时形状仍是多语言、语言名为空');
  else problems.forEach(bad);
}

console.log(`\n══ 汇总: 通过 ${pass} · 失败 ${fail} ══`);
process.exit(fail ? 1 : 0);
