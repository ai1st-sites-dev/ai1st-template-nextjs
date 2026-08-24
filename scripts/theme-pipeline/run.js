#!/usr/bin/env node
// ══════════════════════════════════════════════════════════════════════════════════════════════════
// run.js — 端到端跑一遍流水线：生成 → 四道闸 → 报告（#1004 AC5）
// ══════════════════════════════════════════════════════════════════════════════════════════════════
//
//   node scripts/theme-pipeline/run.js --count 3 --site <一个样例站目录>
//   node scripts/theme-pipeline/run.js --candidates /tmp/cands   # 跑已经生成好的那批
//
// 每套候选走的路：
//   ① 静态（tokens 对 schema · CSS 对契约）—— 不用建站，先拦掉能静态拦的
//   ② 动态：把 tokens 写进样例站的 brand.json、把表放进 public/themes/、`npm run build`、
//      起一个静态服务器、跑 `theme-css-invariants.mjs`，外加「钩子在这套主题自己的表里有规则」
//   ③ 相似度：跟注册表里的 30 套比
//   ⑤ 骨架距离：跟池里每一套算 9 块骨架距离，≤2 的打回（#1173）—— 跑在④之前
//   ④ 人审：不自动化 —— 打印图册怎么出，然后停在这里
//
// 🔴 ①没过就不进②：建一次站 + 起浏览器要几十秒，而静态那道能拦的东西不值这个钱。
//    报告里会写清每套停在哪一道。
const fs = require('fs');
const path = require('path');
const cp = require('child_process');

const NEXT = path.resolve(__dirname, '..', '..');
const { generateCandidates } = require('./generate');
const {
  gateStatic, gateInvariants, gateSimilarity, gateSkeleton, gateHumanReview,
} = require('./gates');
const {
  shootCandidate, writeComparisonPage, whyNoAllBlocksPage, clearCandidateShots,
} = require('./gallery');
// #1079 —— 候选装进样例站时提前算出它上线后的顶栏 / 页脚。跟 `promote.js` 定 supports 用的是同一个
// 函数，理由（两处各算一遍就会漂，而漂出来的差正好是人审读到的那个假标注）写在那个函数上面。
const { regionsForPool } = require('../region-layout.js');

function arg(name, dflt) {
  const i = process.argv.indexOf(name);
  return i >= 0 && process.argv[i + 1] !== undefined ? process.argv[i + 1] : dflt;
}

// 静态服务器 —— **必须是另一个进程**。
//
// 🔴 第一版用 `http.createServer()` 起在本进程里，然后用 `spawnSync` 跑不变量检查器：那个探针
// 每一格都读到「did not answer with a page (no response)」，报告里三套全是「退出码 2」。真因不是
// 主题、也不是探针 —— `spawnSync` **同步阻塞本进程的事件循环**，所以本进程里的服务器在子进程活着
// 的整段时间里一个请求都答不了。判据：同一份产物用 `python3 -m http.server` 端出去，同一个探针
// 立刻 rc=0。⟹ 阻塞式地等一个子进程时，任何跟它对话的东西都不能住在同一个进程里。
function serve(dir, port) {
  const child = cp.spawn('python3', ['-m', 'http.server', String(port), '--bind', '127.0.0.1'],
    { cwd: dir, stdio: 'ignore', detached: false });
  // 等它真的开始应答，别用 sleep 猜。
  const deadline = Date.now() + 10_000;
  for (;;) {
    const probe = cp.spawnSync('curl', ['-s', '-o', '/dev/null', '-w', '%{http_code}',
      `http://127.0.0.1:${port}/index.html`], { encoding: 'utf8' });
    if ((probe.stdout || '').trim() === '200') break;
    if (Date.now() > deadline) { child.kill(); throw new Error(`静态服务器起不来（端口 ${port}）`); }
    cp.spawnSync('sleep', ['0.2']);
  }
  return { close: () => child.kill() };
}

/**
 * 这一次 `npm run build` 把产物放进了 `out/` 下的哪个目录。
 *
 * 判据**派生**自产品自己那一处默认值（`scripts/move-build-output.js` 里的
 * `process.env.SITE_CONFIG || '<名>'`），不在这里抄第二份：两份默认值总会分叉，而分叉是静默的。
 * 读不出来 ⟹ 返回空串，调用方当场停下 —— 「我不知道该量哪个目录」不是通过。
 */
function builtSiteName() {
  if (process.env.SITE_CONFIG) return process.env.SITE_CONFIG;
  const src = fs.readFileSync(path.join(NEXT, 'scripts', 'move-build-output.js'), 'utf-8');
  const m = src.match(/SITE_CONFIG\s*\|\|\s*'([^']+)'/);
  return m ? m[1] : '';
}

/**
 * 上面那个目录真的是**刚给这套候选建出来的**吗 → 不是就返回一句人话，是就返回空串。
 *
 * 🔴 第二道核对，问的是**字节**而不是路径算术。路径算错和字节不对要各答一次 —— 错一个不会两个都错，
 * 而 QA2 在 r2 量到的那两个方向（该拦的被放过 / 好的被冤枉）都是「量了另一个站」。
 *
 * 🔴 问的是哪一份字节，#1002 改了。以前是「`index.html` 引没引 `/themes/<id>.css>`」：那个
 * `<link>` 的文件名随主题变，而正是它逼着换主题必须重建，所以 #1002 把表的**字节贴进了
 * `public/theme.css`**，页面只引固定路径。照旧查那个 `<link>` 的话，这道闸在 #1002 之后**永远拦下
 * 每一套候选**（实测：0/2 过，理由是「没有引 /themes/gen-07-1.css」）。换成查产物里那份
 * `theme.css` 有没有这套候选那张表的字节 —— 同一个问题、同一个方向，而且比查文件名更硬：
 * 文件名相同的两套表分不出来，字节分得出来。
 */
function whyNotThisBuild(outRoot, outDir, candidate) {
  const inOut = fs.existsSync(outRoot) ? fs.readdirSync(outRoot).join(' ') : '（没有 out/ 目录）';
  if (!builtSiteName()) {
    return 'scripts/move-build-output.js 里已经没有 `SITE_CONFIG || \'<名>\'` 那个默认值可读了 ——'
      + ' 无从知道产物落在 out/ 的哪个目录（现在有：' + inOut + '）。设 SITE_CONFIG 再跑。';
  }
  const index = path.join(outDir, 'index.html');
  if (!fs.existsSync(index)) {
    return `${index} 不存在 —— 什么都没量到（out/ 里有：${inOut}）。这不是通过。`;
  }
  const skin = path.join(outDir, 'theme.css');
  if (!fs.existsSync(skin)) {
    return `${skin} 不存在 —— 页面无条件引 /theme.css（#1002），所以这份产物不是这个模板建的`
      + `（out/ 里有：${inOut}）。什么都没量到，这不是通过。`;
  }
  const sheet = fs.readFileSync(candidate.sheetPath, 'utf-8').trimEnd();
  if (!fs.readFileSync(skin, 'utf-8').includes(sheet)) {
    return `${skin} 里没有这套候选那张表的字节 —— 这个目录不是刚给这套候选建出来的那份`
      + `（out/ 里有：${inOut}）。什么都没量到，这不是通过。`;
  }
  return '';
}

/**
 * 这一次构建**真的**按「这套主题上线后」的顶栏 / 页脚建的吗?(#1079)
 *
 * 🔴 为什么要有这一格,而不是"算出来了写进 theme.json 就完事":那条链有三段(`installCandidate` 写键
 *    → `sync-config` 的 `readPreviewRegionLayout` 读它 → `resolveRegionLayout` 认它),而**断在任何
 *    一段的表现都是静默的** —— 产物落回默认 solid-bar,图照样拍出来、卡片上照样印一个看起来很正常的
 *    结构名,而人审签的字是「我看过这套上线后的样子」。本票要治的就是这个形状,所以不能靠它自己不复发:
 *    量出来的那个值跟算出来的不一样,这一轮当场判②不过,不许拿去拍图。
 *
 * 🔴 判据是构建自己打的那行 `Regions:`(`sync-config.js` 打的),不是再读一遍 theme.json ——
 *    读回自己刚写的那个文件只证明"我写下了",证明不了"构建按它建"。
 *
 * @returns 空串 = 接上了;非空 = 一句人话,进②那道闸的 problems
 */
function whyRegionsNotWired(buildStdout, regions) {
  if (!regions) return ''; // 没给位子(不走池那条路)⟹ 本来就是默认,没有要对的东西
  const m = /^\s*Regions: header=(\S+) footer=(\S+)/m.exec(String(buildStdout || ''));
  if (!m) {
    return '构建日志里没有 `Regions: header=… footer=…` 那一行 —— 那是 sync-config 唯一说出'
      + '「这次按哪个顶栏建的」的地方,读不到就等于这一维没量到。这不是通过。';
  }
  if (m[1] === regions.header && m[2] === regions.footer) return '';
  return `顶栏/页脚没接上：这套候选上线后是 ${regions.header} / ${regions.footer}，`
    + `而这次构建按 ${m[1]} / ${m[2]} 建的 —— 图册会把后者摆给人审看。`
    + '（链子三段：run.js 写 theme.json 的 regionLayout → sync-config 的 readPreviewRegionLayout'
    + ' → region-layout.js 的 resolveRegionLayout，断哪段都是这个症状。）';
}

/**
 * 把一套候选装进样例站：tokens 进 brand.json、表进 public/themes/、theme.json 指向它。
 *
 * 🔴 #1079 —— `slot` 是这套候选**将要占的那个池位子**（`poolSlots()[ci]`）。给它是为了让这一轮
 *    建出来的产物带上这套主题**上线后**的顶栏 / 页脚，因为人审翻的那本图册就是从这份产物拍的。
 *    不给（`--pool` 那条路以外的调用、或候选比位子还多时）就退回默认，跟本票之前一样。
 */
function installCandidate(candidate, siteDir, slot) {
  const brandPath = path.join(siteDir, 'brand.json');
  const brand = JSON.parse(fs.readFileSync(brandPath, 'utf-8'));
  brand.colors = candidate.tokens.colors;
  brand.fonts = candidate.tokens.fonts;
  brand.settings = candidate.tokens.settings;
  fs.writeFileSync(brandPath, `${JSON.stringify(brand, null, 2)}\n`);
  const dest = path.join(NEXT, 'public', 'themes', `${candidate.id}.css`);
  fs.copyFileSync(candidate.sheetPath, dest);
  // 🔴 `applied` 必须是 false。#1121 换了理由、没换结论：以前是「为真时 sync-config 会用**注册表**
  // 里那套覆盖 brand 的颜色/字体/settings」，而构建期那处覆盖已经撤掉了。今天的理由是
  // `readAppliedThemeId()` 对**注册表里没有的 id** 直接 `process.exit(1)`，而候选的 id 按定义还不在
  // 注册表里 ⟹ 写 true 会让每个候选站构建当场失败。原来那句话保留在下面，它记的是当时的因果
  //    （sync-config.js:167），而候选还不在注册表里 —— 那样量到的是别人的 tokens。
  //
  // 🔴 #1079 —— 顶栏和页脚也曾被按在默认上（当时的因果是 `applied:false` ⟹ `readAppliedThemeId`
  //    回 null ⟹ `resolveRegionLayout({})` ⟹ solid-bar + multi-column）。上线池子 80 套里 solid-bar
  //    只有 22 套、multi-column 只有 27 套，所以人审那本图册对这一维是按构造瞎的：80 张卡全印
  //    `solid-bar`，而 58 套上线后不是它。`regionLayout` 这个键就是补这一维 —— 值由 `regionsForPool`
  //    算，跟 `promote.js` 定 `supports.header/footer` 用的是**同一个函数**（那是它搬进
  //    region-layout.js 的理由）。
  //
  //    🔴 #1086（2026-08-18）换掉了上面那半句因果，这个键**照样需要**，但理由不同了：结构现在
  //    跟着 `themeId` 走、不看 `applied`，而候选的 id **还不在注册表里** ⟹ `readStructureThemeId`
  //    对它返回 null ⟹ 仍然是 solid-bar + multi-column。所以断的那一维没变，断点从「applied 是
  //    false」挪到了「查不到这个 id」。
  //    📌 它不再限定在 `applied !== true` 那条路上（#1086 摘掉了 `readPreviewRegionLayout` 开头
  //       那句 `if (appliedThemeId) return {}`）。现在的规则是**逐键显式赢**：theme.json 里写了
  //       哪个键，那个键就压过注册表。而 `applied:true` + 这个键这个组合没有任何代码路径造得出来
  //       —— 写它的只有这里（恒 `applied:false`），换装那一下（`worker/main.go` processThemeTask）
  //       写的是 `{themeId, applied:true}`，连前一份的 regionLayout 都不带过去。
  const regions = slot
    ? regionsForPool(slot.index, fs.readFileSync(candidate.sheetPath, 'utf-8'),
      candidate.tokens.colors)
    : null;
  fs.writeFileSync(path.join(siteDir, 'theme.json'),
    `${JSON.stringify({
      themeId: candidate.id,
      applied: false,
      css: candidate.id,
      ...(regions ? { regionLayout: { header: regions.header, footer: regions.footer } } : {}),
    }, null, 2)}\n`);
  return { dest, regions };
}

// ══════════════════════════════════════════════════════════════════════════════════════════════════
// 🔴 #1015 打磨批次 #13（来源 #1004）—— 跑完要把样例站放回去，正常退出也一样
// ══════════════════════════════════════════════════════════════════════════════════════════════════
// installCandidate 会改样例站的三处：`brand.json`（颜色/字体/settings 被换成候选的）、`theme.json`
// （指向候选那个 id）、`public/themes/<id>.css`（多出一份表）。跑完这三处原样留在树里，就是污染。
//
// 🔴 #1046 条 12 —— 这里原来写的因果是假的，改掉：它说「候选不在注册表里 ⟹ 同一棵树里下一次任何
//    构建当场失败：theme.json names theme "gen-07-3", which is not in the registry」。那句报文来自
//    `sync-config.js` 的 `readAppliedThemeId`，而那个函数**第一件事就是 `if (meta.applied !== true)
//    return null`** —— 上面 installCandidate 写进去的恒是 `applied: false`（就在它自己那条 🔴 注释
//    里，为的是不让注册表盖掉候选的 tokens）。所以留在树里的 theme.json 走不到那句话，QA2 在污染态
//    实测构建 rc=0。真正会失败的是**另一种**残留：表被删掉而 theme.json 留着，那时 `readThemeSheet`
//    报的是「names public/themes/<id>.css, which is not there」，另一句话。
//    已经真实发生过的后果只有一个，而它跟构建无关：role-user 撞到三份已上线的表全部测不了
//    （`theme-css-invariants-all-sheets.sh` → rc=2）—— 那才是这段收工代码存在的理由。
// 🔴 EXIT=0 的那条路也一样会留 —— "跑成功了"和"跑失败了"留下同样的污染，所以这不是错误处理，是收工。
// 放在 finally 里：中途抛异常、闸红、Ctrl-C 之后的那次 catch，都要走这一步。
const T1015_SHEETS = path.join(NEXT, 'public', 'themes');

function snapshotSite(siteDir) {
  const read = (p) => (fs.existsSync(p) ? fs.readFileSync(p) : null);
  return {
    siteDir,
    brand: read(path.join(siteDir, 'brand.json')),
    theme: read(path.join(siteDir, 'theme.json')),
    // 表是**加进来**的，所以记下"跑之前有哪些"，跑完把多出来的删掉 —— 别去猜候选叫什么名字。
    sheets: new Set(fs.existsSync(T1015_SHEETS) ? fs.readdirSync(T1015_SHEETS) : []),
  };
}

/** 把 snapshotSite 记下的那三处放回去，返回一行人话说明动了什么。 */
function restoreSite(snap) {
  const done = [];
  for (const [name, bytes] of [['brand.json', snap.brand], ['theme.json', snap.theme]]) {
    const p = path.join(snap.siteDir, name);
    const now = fs.existsSync(p) ? fs.readFileSync(p) : null;
    if (bytes === null) {
      if (now !== null) { fs.unlinkSync(p); done.push(`删掉 ${name}（跑之前没有）`); }
    } else if (now === null || !now.equals(bytes)) {
      fs.writeFileSync(p, bytes); done.push(`还原 ${name}`);
    }
  }
  if (fs.existsSync(T1015_SHEETS)) {
    for (const f of fs.readdirSync(T1015_SHEETS)) {
      if (snap.sheets.has(f)) continue;
      fs.unlinkSync(path.join(T1015_SHEETS, f));
      done.push(`删掉 public/themes/${f}（这一轮放进去的）`);
    }
  }
  // 🔴 自证：放回去之后再读一次真字节去比。没有这一步，"我恢复了"就只是一句声明 ——
  //    而它失败的方向是静默的（下一次构建才炸，那时没人记得是这一轮留下的）。
  const still = [];
  for (const [name, bytes] of [['brand.json', snap.brand], ['theme.json', snap.theme]]) {
    const p = path.join(snap.siteDir, name);
    const now = fs.existsSync(p) ? fs.readFileSync(p) : null;
    const same = bytes === null ? now === null : now !== null && now.equals(bytes);
    if (!same) still.push(name);
  }
  const extra = fs.existsSync(T1015_SHEETS)
    ? fs.readdirSync(T1015_SHEETS).filter((f) => !snap.sheets.has(f)) : [];
  return { done, bad: still.concat(extra.map((f) => `public/themes/${f}`)) };
}

async function main() {
  const count = Number(arg('--count', 3));
  const seed = Number(arg('--seed', 7));
  const siteDir = arg('--site', path.join(NEXT, 'site'));
  const workDir = arg('--work', fs.mkdtempSync('/tmp/theme-pipeline-'));
  const port = Number(arg('--port', 18450));
  const galleryDir = arg('--gallery', '');

  // #1061 —— 要出图就先确认样例站摆得出全部块，否则这一轮的图对大多数块是瞎的。问在建站之前：
  // 一套候选要建站 + 起服务 + 截图几十秒，80 套就是一小时，而答案在第一秒就知道了。
  if (galleryDir) {
    const why = whyNoAllBlocksPage(siteDir);
    if (why) { console.error(`🔴 ${why}`); process.exit(2); }
  }

  // 🔴 读候选这件事只有一份实现，在 `promote.js` 的 `readCandidates` —— 这里原来有第二份，
  //    而两份**已经分叉过**：这里按 `readdirSync` 的顺序（字母序：1 · 10 · 11 · … · 2 · 20 …），
  //    promote 按编号排序。后果不是排版问题：`--pool new` 那条路上池成员的 id 是按
  //    「第几个候选」× `poolSlots()` 现起的，两种顺序起出**两套不同的 id**，于是第③道闸报告里
  //    写的「最像的是 fern-02」指的根本不是最终池子里那套 fern-02。#1016 实测到这个形状。
  //    （版式从 `<id>.layout.json` 读回来这件事也在那份实现里：写死成 `{}` 会让第③道闸的版式那项
  //    在这条路上永远「没得比」——当时算成 0 分 ⟹ 上限 0.8 < 阈值 0.9，整道闸不可能开火，
  //    QA2 在 #1004 r2 端到端量过。）
  const { readCandidates, toPoolEntry } = require('./promote.js');
  const candidates = arg('--candidates', '')
    ? readCandidates(arg('--candidates', ''))
    : generateCandidates(count, { seed, outDir: workDir });

  // 第③道跟**谁**比（#1016）。
  //
  // 🔴 `--pool new` 是跑正式池那一次要用的：D3 说旧 30 套冻结退役，新池是重来的一池 —— 一套候选
  //    要不像的是**它将要加入的那个池**，而不是一个没有任何新站抽得到的旧池。默认仍是注册表，
  //    因为平时跑一两套试流水线时，问「跟今天在用的比像不像」才是那个场景要的答案。
  //    新池那条路上，池子随着这一轮**逐套长出来**：第 1 套跟空池比（照 gates.js 的口径 = 通过），
  //    第 k 套跟前面已经收下的 k-1 套比。收下的定义是「前三道全过」。
  const poolMode = arg('--pool', 'registry');
  const { themes } = require(path.join(NEXT, 'scripts', 'themes.js'));
  const { poolSlots } = require('./industry-sectors.js');
  const slots = poolSlots();
  const growing = {};
  const poolFor = () => (poolMode === 'new' ? growing : themes);
  const report = [];

  // #1015：跑之前先存一份，finally 里放回去（理由写在 snapshotSite 头上）。
  const t1015Snap = snapshotSite(siteDir);
  let t1015Restore = null;
  try {
  for (const [ci, c] of candidates.entries()) {
    // 🔴 #1061 r2 —— 这一轮对这套 id 的起点：先清掉它上一轮留在 shots/ 里的图和读数。
    //    必须在这里、在第一道闸之前 —— 下面任何一个分支都可能让这一轮**一张图都不拍**（静态闸没过、
    //    样例站建不出来、建出来的不是这一份），而对照页问的是盘上有没有图。不清就是把上一轮的图和
    //    上一轮那套表的色号摆给人审看，人审看不出来。理由整段在 `gallery.js` 的 clearCandidateShots。
    if (galleryDir) {
      const gone = clearCandidateShots(galleryDir, c.id);
      if (gone.length) console.log(`🧹 ${c.id}：清掉上一轮留下的 ${gone.length} 个产物`);
    }
    const gates = [];
    let shot = null;
    gates.push(gateStatic(c));
    if (gates[0].pass) {
      // 🔴 #1079 —— `slots[ci]` 是这套候选**全收时**会占的位子，顶栏/页脚按它算（理由整段写在
      //    installCandidate 上面）。人审拒掉几套就会让后面每一套的位子往前挪，那时图上这一维
      //    仍然是「全收假设下的样子」—— 这条边界写进交接与 AC5，不在这里悄悄兜。
      // 🔴 #1134 —— 上面那句只说了「拒掉几套」这一种,还有**第二种**:`ci` 超过位子数时 `slots[ci]`
      //    是 `undefined`(`poolSlots()` 今天 80 个位子),`installCandidate` 退回默认顶栏/页脚。
      //    而**拍图那步没有对应的守卫**:下面 `shootCandidate` 照拍、三道闸照过、图册里有图,只是
      //    那行「顶栏 X · 页脚 Y」不打(它挂在 `installed.regions` 上)⟹ 第 81 套起,图上顶栏那一维
      //    静默回到修复前的样子(QA3 实测:与修复前的 `gen-07-2` 图逐字节相同,md5 3291e63d)。
      //    `--count` 没有 ≤80 的闸(`Number(arg('--count', 3))`),所以这是「拒几套之后补池」时真会
      //    走到的一条路。⟹ 这里**仍然不悄悄兜**(兜了就是把一个人审要知道的边界藏起来),
      //    边界写在 `theme-pipeline/README.md` §这本图册仍然看不见的维度 ⑥。
      const installed = installCandidate(c, siteDir, slots[ci]);
      if (installed.regions) {
        console.log(`  ${c.id}：顶栏 ${installed.regions.header} · 页脚 ${installed.regions.footer}`
          + `（位子 ${ci}${installed.regions.headerMovedBy ? `，顶栏让开了：${installed.regions.headerMovedBy}` : ''}）`);
      }
      const build = cp.spawnSync('npm', ['run', 'build'], { cwd: NEXT, encoding: 'utf8' });
      if (build.status !== 0) {
        gates.push({ gate: '② 动态', pass: false, problems: [`样例站建不出来：${String(build.stdout || '').split('\n').slice(-6).join(' ')}`] });
      } else {
        // 🔴 哪个目录是**刚建出来的这个站**，不许用 `fs.readdirSync(outRoot)[0]` 挑（QA2 在 #1004 r2
        // 的真机上量的）。`out/` 按设计装多个站：`npm run build` 自己调的 `move-build-output.js` 会
        // 把别的站的旧构建放回来（它自己的注释：restore previous out/ with other sites' builds），
        // 站名来自 `SITE_CONFIG`。第二个目录一出现，readdir 的第一项就可能不是候选那份，而两个方向
        // 都真机复现过：旁边站健康时，本该被拦的 low-contrast 三道全过 rc=0；干净树上 3/3 过的
        // gen-07-1 反而红，报出来的对比度数字属于另一套主题。
        // 名字从产品自己那处默认值派生（`move-build-output.js` 的 `SITE_CONFIG || '…'`），不在这里
        // 抄第二份；派生不出来就当场停，「我不知道该量哪个」永远不是通过。
        const outRoot = path.join(NEXT, 'out');
        const outDir = path.join(outRoot, builtSiteName());
        // 两问并在一条 `||` 上，因为它们是同一件事的两半：这份产物是不是**我以为的那份**。
        // 前者问「是不是这套候选的字节」，后者（#1079）问「顶栏/页脚是不是这套候选上线后的那个」。
        const notThisBuild = whyNotThisBuild(outRoot, outDir, c)
          || whyRegionsNotWired(build.stdout, installed.regions);
        if (notThisBuild) {
          gates.push({ gate: '② 动态', pass: false, problems: [notThisBuild] });
        } else {
          const server = serve(outDir, port);
          try {
            gates.push(gateInvariants(c, { outDir, baseUrl: `http://127.0.0.1:${port}` }));
            // 🔴 拍图就在这里，趁站还在服着 —— 不是"回头再跑一遍图册"。第四道闸要的是这一套【被这
            //    一轮闸量过的那份产物】的图；分两次跑就有两份产物，图上那套和读数那套可以不是同一个。
            if (galleryDir) {
              shot = shootCandidate(c, { baseUrl: `http://127.0.0.1:${port}`, galleryDir });
            }
          } finally { server.close(); }
        }
      }
    }
    if (gates.every((g) => g.pass)) gates.push(gateSimilarity(c, poolFor()));
    // 🔴 #1173 —— ⑤ 骨架距离排在③之后、④人审之前：骨架双胞胎不该浪费人审。它跟③互补不替代
    //    （③读 tokens/layout 管气质相近，⑤读表里的规则管骨架双胞胎），理由整段在 gates.js 那一节头上。
    if (gates.every((g) => g.pass)) gates.push(gateSkeleton(c, poolFor()));
    if (gates.every((g) => g.pass)) {
      gates.push(gateHumanReview(c, { galleryDir, shot }));
    }
    // 前三道全过 ⟹ 收下，它成为后面那些候选要比对的池子的一员（只在 --pool new 那条路上）。
    let poolId = null;
    if (poolMode === 'new' && gates.every((g) => g.pass !== false) && slots[ci]) {
      const promoted = toPoolEntry(c, slots[ci]);
      // 🔴 #1173 —— `growing` 的成员要带着**自己那份表在哪**。`toPoolEntry` 写的 `entry.sheet` 是
      //    新起的 pool id，而那份表此刻还在候选的工作目录里：拷进 `public/themes/` 是 `promote.js`
      //    写池那一步，发生在整轮跑完之后。不带着走的话，⑤ 在「同一批候选互比」这条路上每次都读不到
      //    表 ⟹ 整轮报「量不到」拒跑，而那条路恰恰是本票最要防的（一批里的双胞胎会一起进池）。
      // 🔴 挂在这里而不是挂进 `toPoolEntry` 的返回值：`growing` **只用于比较、从不落盘**（写池是
      //    `promote.js` 自己读候选目录那条路），所以多这一个键不会漏进 `theme-pool.json`。
      growing[promoted.id] = { ...promoted.entry, sheetPath: c.sheetPath };
      poolId = promoted.id;
    }
    report.push({
      id: c.id,
      poolId,
      gates,
      facts: shot && shot.facts,
      // `shot` = shoot.mjs 退的是不是 0；`shots` = 盘上真有哪几张图。#1061 起这两个不许互相代替
      //（理由在 gallery.js 的 card() 头上）—— 下面那句「N/M 套有图」问的是后者。
      shot: !!(shot && shot.ok),
      shots: (shot && shot.shots) || [],
      shotLog: shot && shot.log,
    });
  }
  } finally {
    t1015Restore = restoreSite(t1015Snap);
  }

  console.log('\n════ 流水线报告 ════');
  for (const r of report) {
    // 🔴 「没量成」跟「停在这一道」要用不同的话说（#1062）。前者是关于这台机器的，后者是关于这套
    //    主题的，而它们此前在这一行上逐字相同 —— 缺浏览器时 60-80 套会整批打成「停在②动态」，
    //    人的第一反应是去查主题。判它的不是这里的措辞，是闸自己挂的那面 `instrument` 旗子。
    const jammed = r.gates.find((g) => g.instrument);
    const stopped = r.gates.find((g) => g.pass === false);
    console.log(`\n${r.id}: ${jammed
      ? `🔴 没量成【${jammed.gate}】—— 这台机器缺东西，不是这套主题的问题`
      : stopped ? `🔴 停在【${stopped.gate}】` : '✅ 前三道全过,等人审'}`);
    for (const g of r.gates) {
      const mark = g.pass === true ? '✅' : g.pass === false ? '🔴' : '⏸';
      console.log(`  ${mark} ${g.gate}${g.note ? ` —— ${g.note}` : ''}`);
      for (const p of g.problems) console.log(`       ${p}`);
    }
  }
  const passed = report.filter((r) => r.gates.every((g) => g.pass !== false)).length;
  const jammed = report.filter((r) => r.gates.some((g) => g.instrument));
  console.log(`\n${passed}/${report.length} 套过了前三道闸。第四道是人。`);
  if (jammed.length) {
    console.log(`  🔴 其中 ${jammed.length} 套【没量成】—— 这台机器缺东西（每套下面写着缺什么）。`
      + '这不是「这几套主题不合格」：把机器补上再跑一次，读数才存在。');
  }
  // #1015：收工这一步要说出来 —— 沉默的清理和"根本没清理"在屏幕上长得一样。
  if (t1015Restore && t1015Restore.done.length) {
    console.log(`  样例站已收工：${t1015Restore.done.join('、')}`);
  } else if (t1015Restore) {
    console.log('  样例站没被改动（这一轮没有候选走到②动态那一步）。');
  }
  if (t1015Restore && t1015Restore.bad.length) {
    console.log(`  🔴 这几处没能放回去：${t1015Restore.bad.join('、')}`);
    console.log('     ⟹ 样例站还指着这一轮的候选，`theme-css-invariants-all-sheets.sh` 之类拿它当基准的'
      + '检查会读到候选而不是已上线的表。先手工恢复再跑别的。');
    process.exit(2);
  }
  if (galleryDir) {
    const page = writeComparisonPage(galleryDir, report);
    const shots = report.filter((r) => r.shots.length).length;
    console.log(`  对照图：${page}（${shots}/${report.length} 套有图）`);
    console.log('  请 Chris 翻这一页 —— 第四道闸没有机器能给的答案。');
  } else {
    // 🔴 不给 --gallery 就直说没图，不打印一条"跑这个就有了"的命令。
    //    第一版打印的是 `shoot-themes.sh` + `gallery.mjs` 那两条 —— 它们跑的是**注册表里的老 30 套**，
    //    照着跑真的会出一本图册，里面一张候选都没有，而翻图的人看不出来（QA1 r1 抓到的就是这个）。
    console.log('  没有传 --gallery ⟹ 这一轮没出图。要出图：--gallery <目录>，然后打开 <目录>/public/index.html');
  }
  // 🔴 退出码要把「没量成」和「主题不合格」分开（#1062 AC2）：0 = 全过 · 1 = 至少一套真的不合格 ·
  //    2 = 至少一套没量成。选 2 是因为这个仓库里 2 到处都是「读不到」：`theme-css-invariants.mjs`
  //    自己（:60 / :176 / 加载仪器那一段）、`theme-css-invariants-all-sheets.sh`（#1009 立的）。
  //    📌 说在明处：**这个文件里 2 现在有三个占用方** —— 这里、`:293` 样例站没能放回去、`:303`
  //    未捕获异常。三个都是「这台机器上出了事，这一轮没有主题的裁定」，读的人不会被误导成
  //    「主题不合格」；但拿 2 去反推是哪一种是不行的，要看上面打的那几行。
  //    先判「没量成」再判「不合格」：一套都没量成时 `passed` 恒小于总数，那个 1 会盖掉真因。
  if (jammed.length) process.exit(2);
  process.exit(passed === report.length ? 0 : 1);
}

if (require.main === module) main().catch((e) => { console.error(e); process.exit(2); });
