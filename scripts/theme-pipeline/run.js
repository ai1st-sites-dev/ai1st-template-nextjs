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
// 放在 finally 里：中途抛异常、闸红，都要走这一步。
//
// 🔴 **Ctrl-C 不在这一列，而它原来跟前两个并排写在这里（#1215 打磨批次 #25 条 20，实测）。**
//    node 对 SIGINT 的默认处置是直接终止进程，`finally` 一行都不跑。两臂读数（同一个夹具、同一
//    个样例站，`kill -INT` 发给**进程组**——真 Ctrl-C 就是这么发的）：改前 SIGINT ⟹ 退出码 130、
//    `brand.json` / `theme.json` 都停在候选那一版、`public/themes/` 多出一张表。
//    后果不在这一轮，在**下一轮**：`snapshotSite` 把这份残留当成「原样」记下来，于是它变成新基线，
//    再也没有人会把它放回去。已经真实发生过的那一次就是这个形状（三份已上线的表测不了，见上面）。
//
// 🔴 **修法【不是】装一个 SIGINT 处理器 —— 那一版写出来、量过、否掉了。** 装上之后 4 次实测里
//    处理器**一次都没跑**（日志里 0 行），而它的副作用是把 Ctrl-C 整个吞掉：光是注册一个监听就
//    让 node 不再默认终止，于是三次实测退出码都是 1、流水线一路跑到底 —— 用户按了 Ctrl-C 而它
//    不停。原因是这几道闸是 `spawnSync` 那一族，JS 线程整段被阻塞，libuv 的信号回调排不上队。
//    ⟹ 拿「样例站变脏」换「Ctrl-C 不管用」不是修，是换一个坑。
//
// 🔴 **改成收工【不依赖那一轮还活着】：开跑前落一张纸条（§writeRestoreCrumb），收工时撕掉。**
//    下一轮开跑的第一件事是 §healUnfinishedRun：纸条还在 ⟹ 上一轮没走完 ⟹ 先按纸条放回去、再
//    拍这一轮的快照。这样 SIGINT / SIGKILL / 断电 / 机器重启全都盖住，而 Ctrl-C 的行为一个字没改。
//    代价说在明处：**Ctrl-C 到下一次开跑之间，样例站是脏的**（信号那一版本来想治的就是这一段，
//    而它治不了）。要在那段时间里手工放回去，跑一次 `node scripts/theme-pipeline/run.js --heal`。
//
// 🔴 **纸条落在模板目录里，【不许】落 `os.tmpdir()`（#1215 r2，QA1 F2 量出来的）。** 上面那句
//    「机器重启也盖住」只有在纸条活得比重启久的时候才成立，而这台机器开机清空 /tmp：
//    `/usr/lib/tmpfiles.d/tmp.conf:11` 是 `D /tmp 1777 root root 30d`（`D` = 开机删内容）、
//    `systemd-tmpfiles-setup.service` active，实测 `uptime -s` = 2026-08-28 09:12:15 而 `/tmp`
//    里最老的条目是 09:13:20。落在那里时四种里只盖住 SIGINT / SIGKILL 两种，而漏掉的那两种
//    （断电 / 重启）落在坏方向：重启后纸条没了 → healUnfinishedRun 返回 false → snapshotSite
//    把残留当「原样」记成新基线 —— 正是本条要治的那件事。
//    落在 NEXT 里还顺手去掉了原来那个按 NEXT 路径算的哈希后缀：一份模板目录一张纸条，名字不用编。
//    它进 `templates/nextjs/.gitignore`（跟 `.out-backup/` 那一族同理由：不忽略就长得像漏 stage 的交付物）。
const T1015_SHEETS = path.join(NEXT, 'public', 'themes');
const T1015_CRUMB = path.join(NEXT, '.theme-pipeline-restore.json');

/**
 * 把快照写成一张纸条落在盘上 —— 这一轮死得多难看都不影响下一轮把样例站放回去。
 *
 * 🔴 先写临时文件再 rename，不直接写目标路径（#1234 打磨批次 #26 条 13）。理由是**这张纸条正是
 *    崩溃恢复用的**：直接 `writeFileSync` 时，在写到一半被 kill 就会在盘上留下半截 JSON，而下一轮
 *    `--heal` 读到它只能 `exit 2` 并要人手工收拾。同一个目录里的 rename 在 POSIX 上是原子的 ⟹
 *    盘上要么是上一张完整的纸条、要么是这一张完整的，不存在半截那一档。这把 H2 那一种坏路整个关掉。
 */
function writeRestoreCrumb(snap) {
  const body = JSON.stringify({
    siteDir: snap.siteDir,
    brand: snap.brand === null ? null : snap.brand.toString('base64'),
    theme: snap.theme === null ? null : snap.theme.toString('base64'),
    sheets: [...snap.sheets],
  });
  // 同一个目录（rename 跨设备会 EXDEV），名字带 pid 免得两个进程互相踩。
  const tmp = `${T1015_CRUMB}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, body);
  fs.renameSync(tmp, T1015_CRUMB);
}

/**
 * 纸条 → 内存快照（`restoreSite` 要的形状）。
 *
 * 🔴 **`null` 只有一个意思：盘上没有纸条。** 读到了但读不成 —— 无论是 JSON 解析失败，还是解析出来
 *    形状不对 —— 一律 `exit 2`（#1234 打磨批次 #26 条 12，来源 #1215 QA3 H3，真驱动过）。
 *    上一版形状不对那一支是 `return null`，而**调用方 `healUnfinishedRun` 把 null 读成「上一轮走完了」**：
 *    `--heal` 会打 rc=0「没有没走完的那一轮」、纸条不撕，下一次正常开跑于是把脏站当基线、并覆盖掉
 *    那张唯一能还原它的纸条。同一个函数的两条坏路方向相反，那一条落在坏方向。
 *    「合法 JSON 但形状不对」不是假想：改这张纸条的 schema、或者手编它，都会到这一支。
 */
function readRestoreCrumb() {
  if (!fs.existsSync(T1015_CRUMB)) return null;
  const bail = (why) => {
    console.error(`🔴 上一轮的收工纸条读不成（${T1015_CRUMB}）：${why}`);
    console.error('   ⟹ 这一轮不动它，也不敢拿现在的样例站当「原样」。');
    console.error('   出路：先照纸条里的 siteDir 把样例站手工核一遍，然后');
    console.error(`     rm ${T1015_CRUMB}`);
    console.error('   再重新开跑。（撕掉纸条 = 放弃自动还原，所以先核样例站。）');
    process.exit(2);
  };
  let j;
  try {
    j = JSON.parse(fs.readFileSync(T1015_CRUMB, 'utf-8'));
  } catch (e) {
    bail(e.message);
  }
  // 🔴 `brand` / `theme` 也要在这里查，不能只查 siteDir + sheets（#1238 打磨批次 #27 条 1，来源 #1234）。
  //    下面 `return` 里那两个 `Buffer.from(j.<key>, 'base64')` 在 **try 外面** ⟹ 一张「合法 JSON、
  //    有字符串 siteDir + 数组 sheets、但缺 brand 键」的纸条会走到 `Buffer.from(undefined,'base64')`，
  //    打一屏裸 node 栈（`main().catch` 兜成 rc=2），而这一支本来的出口是上面 `bail` 那段人话 + 出路。
  //    形状检查是唯一一处能在 `Buffer.from` 之前拦住它的地方，所以补在这里、不是把 return 包进 try。
  //    值域按写入侧来（`writeRestoreCrumb`：`snap.brand === null ? null : …toString('base64')`）⟹
  //    合法的只有「base64 字符串」和「null」两种，`undefined` / 数字 / 对象一律不是这张纸条的形状。
  const crumbB64 = (v) => v === null || typeof v === 'string';
  if (!j || typeof j.siteDir !== 'string' || !Array.isArray(j.sheets)
      || !crumbB64(j.brand) || !crumbB64(j.theme)) {
    bail('是合法 JSON，但不是这张纸条该有的形状'
       + '（要有字符串 siteDir、数组 sheets，以及 brand 和 theme 两个键——各自是 base64 字符串或 null）');
  }
  return {
    siteDir: j.siteDir,
    brand: j.brand === null ? null : Buffer.from(j.brand, 'base64'),
    theme: j.theme === null ? null : Buffer.from(j.theme, 'base64'),
    sheets: new Set(j.sheets),
  };
}

/**
 * 上一轮没走完就把它的收工补上。返回 true = 真的动了东西。
 *
 * 🔴 它必须跑在 `snapshotSite` **之前** —— 反过来就是把残留当基线记下来，也就是本票要治的那件事。
 */
function healUnfinishedRun() {
  const snap = readRestoreCrumb();
  if (!snap) return false;
  console.log(`  🔴 上一轮没走完（收工纸条还在：${T1015_CRUMB}）—— 先把样例站放回去再开跑。`);
  const r = restoreSite(snap);
  // 🔴 「一件都没做」有两种成因，别用同一句话说（#1234 打磨批次 #26 条 13）：盘上本来就干净，
  //    和**每一处都试过但都失败了**。后者说成「本来就是干净的」是句假话，而它正好出现在最坏的那一刻。
  if (r.done.length) console.log(`     ${r.done.join('、')}`);
  else if (!r.bad.length) console.log('     盘上本来就是干净的（纸条是上一轮正常收工前掉的）');
  if (r.bad.length) {
    console.error(`  🔴 这几处没能放回去：${r.bad.join('、')}`);
    console.error('     不往下跑：拿一个放不回去的样例站开跑，这一轮量到的是上一轮的残留。');
    // 🔴 报文要说出路（#1234 打磨批次 #26 条 13）。上一版到上面那句就没了，于是再跑一次 `--heal`
    //    还是撞同一句 —— 而这条路本来就是给「上一轮没走完」准备的唯一出口。
    console.error('     最常见的两种，各有各的出路：');
    console.error(`       · 纸条指的那个样例站目录已经不在了 ⟹ mkdir -p ${snap.siteDir}  然后重跑 --heal`);
    console.error(`       · 那几处怎么都写不回去（权限 / 盘满）⟹ 手工核一遍样例站，然后 rm ${T1015_CRUMB}`);
    process.exit(2);
  }
  return true;
}

function snapshotSite(siteDir) {
  const read = (p) => (fs.existsSync(p) ? fs.readFileSync(p) : null);
  const snap = {
    siteDir,
    brand: read(path.join(siteDir, 'brand.json')),
    theme: read(path.join(siteDir, 'theme.json')),
    // 表是**加进来**的，所以记下"跑之前有哪些"，跑完把多出来的删掉 —— 别去猜候选叫什么名字。
    sheets: new Set(fs.existsSync(T1015_SHEETS) ? fs.readdirSync(T1015_SHEETS) : []),
  };
  // 🔴 纸条要在**弄脏之前**落下（installCandidate 还没跑）。晚一步就有一个窗口：那期间被打断，
  //    下一轮没有纸条可读，退回旧行为。
  writeRestoreCrumb(snap);
  return snap;
}

/** 把 snapshotSite 记下的那三处放回去，返回一行人话说明动了什么。 */
function restoreSite(snap) {
  const done = [];
  // 🔴 每一处写/删都不许把整个 --heal 掀掉（#1234 打磨批次 #26 条 13）。上一版是裸的
  //    `fs.writeFileSync`：纸条指的样例站目录已经被删掉时（H1），它在这里抛 ENOENT 一路冒到顶，
  //    屏幕上是一串 node 栈 —— 而**下面那段「这几处没能放回去」连同它的出路根本没机会打出来**。
  //    失败要变成一条 `bad`（靠后面那次自证读回来算），让调用方按它自己的口径报出来。
  let failed = 0;
  const attempt = (fn, label) => {
    try { fn(); done.push(label); }
    catch (e) { failed += 1; console.error(`     （${label} 失败：${e.message}）`); }
  };
  for (const [name, bytes] of [['brand.json', snap.brand], ['theme.json', snap.theme]]) {
    const p = path.join(snap.siteDir, name);
    const now = fs.existsSync(p) ? fs.readFileSync(p) : null;
    if (bytes === null) {
      if (now !== null) attempt(() => fs.unlinkSync(p), `删掉 ${name}（跑之前没有）`);
    } else if (now === null || !now.equals(bytes)) {
      attempt(() => fs.writeFileSync(p, bytes), `还原 ${name}`);
    }
  }
  // 🔴 上面那一半有任何一处没做成，就【不往下删表】（#1234 r2，QA1 F4）。
  //    不吞异常之前，第一处失败会当场抛出，后面这个删除循环一步都不走；改成逐处试之后，它就在
  //    「样例站已经处于一个我还原不了的状态」这个前提下继续做**破坏动作**了 —— QA1 用一张
  //    `siteDir` 指向已删目录、`sheets: []` 的纸条量到过后果：100 份被 git 跟踪的 .css 全被删掉。
  //    （那张纸条是造出来的，真纸条的 sheets 是开跑那一刻的全集；但失败面确实被放开了一格。）
  //    不删也不会漏做：这些表还在盘上 ⟹ 下面那次自证会把它们算进 `bad` ⟹ 纸条不撕、rc=2，
  //    人按提示 mkdir -p 之后重跑 --heal，这一半照样会做完。**先把能还原的还原掉，再谈删。**
  if (failed) {
    console.error(`     （上面有 ${failed} 处没还原成 ⟹ 这一轮不删 public/themes/ 下的任何东西）`);
  } else if (fs.existsSync(T1015_SHEETS)) {
    for (const f of fs.readdirSync(T1015_SHEETS)) {
      if (snap.sheets.has(f)) continue;
      attempt(() => fs.unlinkSync(path.join(T1015_SHEETS, f)),
        `删掉 public/themes/${f}（这一轮放进去的）`);
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
  const bad = still.concat(extra.map((f) => `public/themes/${f}`));
  // 🔴 只有**真的放回去了**才撕纸条。还剩东西没放回去时留着它，下一轮开跑会再试一次并当场停住 ——
  //    比悄悄开跑、拿残留当基线好。
  if (!bad.length && fs.existsSync(T1015_CRUMB)) fs.unlinkSync(T1015_CRUMB);
  return { done, bad };
}

async function main() {
  // 🔴 `--heal` —— 只把上一轮没走完的收工补上，什么都不跑。上面 §T1015_CRUMB 那段写着「Ctrl-C 到
  //    下一次开跑之间样例站是脏的」，这条命令就是那句话给出的那个出路，所以它必须真的存在。
  if (process.argv.includes('--heal')) {
    if (!healUnfinishedRun()) console.log('  没有没走完的那一轮（收工纸条不在盘上）—— 什么都没动。');
    process.exit(0);
  }
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
  const { readCandidates, toPoolEntry, writeVerdict, VERDICT_FILE } = require('./promote.js');
  const candidates = arg('--candidates', '')
    ? readCandidates(arg('--candidates', ''))
    : generateCandidates(count, { seed, outDir: workDir });

  // 🔴 #1182 —— 这一轮的裁定要落到盘上，因为写池那一步是另一个进程。整段理由（含「为什么名单里
  //    带着位子」和「为什么开跑前先落哨兵」）写在 `promote.js` 的 §闸的裁定怎么交到写池这一步。
  //    一句话版：在这之前，「哪些候选过了闸」算完就留在这个进程里没了，而 `promote.js` 不给
  //    `--accepted` 就把候选目录里的全部收进池 —— 漏传一次，五道闸对写池那一步全部不承重。
  // 🔴 哨兵先落、且**落不下去就当场停**：这一步失败时唯一安全的下一步是「不写池」，而写池那一步
  //    只能靠这份文件的状态判断。哨兵没落成就往下跑，盘上就会是「没有这份文件」= 手工那条路的样子。
  const candidatesDir = arg('--candidates', '') || workDir;
  try {
    writeVerdict(candidatesDir, {
      complete: false,
      why: '流水线开跑了,还没跑完 —— 写池那一步看到这个状态必须拒绝写池,不许退回全收',
      candidatesDir,
      total: candidates.length,
    });
  } catch (e) {
    console.error(`🔴 落不下裁定哨兵（${path.join(candidatesDir, VERDICT_FILE)}）：${e.message}`);
    console.error('   不往下跑：这一轮的裁定没法交给写池那一步，而盘上「没有这份文件」跟'
      + '「手工挑候选」长得一模一样 —— 那时写池会全收，五道闸白跑。');
    process.exit(2);
  }

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
  // 🔴 #1174 —— `--slot-offset N`：这一批候选要占的是位子 N 起那一段，不是 0 起。
  //    为什么需要它：位子表的下标里那个 `ci` 是候选在**这一批**里的序号。往末尾补池（本票是位子
  //    80-96 那 17 套）时只喂这 17 套，它们会按位子 0-16 装 —— 顶栏/页脚按错位子算、图册上标的
  //    也是那个、第③道闸报告里的 id 也是那批。喂满整池 97 套能绕开，代价是 97 次真构建。
  //    偏移量还顺手把 README §这本图册仍然看不见的维度 ⑥ 那颗地雷在这条路上关掉：`ci + offset`
  //    落在位子表里，`slots[...]` 就不是 `undefined`。
  //    🔴 越界仍然**不悄悄兜**：偏移量把这一批推出位子表时当场退出，不留一个「图拍了、顶栏那行
  //    没打」的半哑状态（那正是 ⑥ 记的那个形状）。
  const slotOffset = Number(arg('--slot-offset', 0));
  const slots = poolSlots();
  if (!Number.isInteger(slotOffset) || slotOffset < 0) {
    console.error(`🔴 --slot-offset 要是个 ≥0 的整数，收到 ${arg('--slot-offset', 0)}`);
    process.exit(2);
  }
  if (slotOffset + candidates.length > slots.length) {
    console.error(`🔴 --slot-offset ${slotOffset} + ${candidates.length} 套候选 = ${slotOffset + candidates.length}，`
      + `超出位子表的 ${slots.length} 个 —— 位子表在 industry-sectors.js，要放更多套先改那张表。`);
    process.exit(2);
  }
  const growing = {};
  const poolFor = () => (poolMode === 'new' ? growing : themes);
  const report = [];

  // #1015：跑之前先存一份，finally 里放回去（理由写在 snapshotSite 头上）。
  // 🔴 先把上一轮**没走完**留下的脏状态放回去，再给这一轮拍快照（#1215 打磨批次 #25 条 20）。
  //    次序反了这个修法就是空的：`snapshotSite` 会把上一轮的残留当成「原样」记下来。
  healUnfinishedRun();
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
    // 🔴 #1174 + #1182 —— 这一批的第 ci 套候选要占的**那一个位子对象**，整个循环体只算这一次，
    //    下面四处全部读它：装样例站（顶栏/页脚按位子算）· 收进 growing 池 · 写裁定里那个 `slot`。
    //    位子只许有一个来源。#1182 落地后合本票时这里真出过一次事故（QA2 在合并形态上驱动出来的）：
    //    裁定那一处留着**裸 `ci` 那个下标**、没跟上偏移量，于是闸把候选量在位子 80/81、裁定却写 0/1，
    //    `promote.js` 照裁定发位子 ⟹ 写出 `magenta-01`/`fern-02`（**存量成员的 id**，会覆盖它们的
    //    条目和表），而 merge rc=0、`npm run test:scripts` 全绿、一处红都没有。
    const slot = slots[ci + slotOffset];
    const gates = [];
    let shot = null;
    gates.push(gateStatic(c));
    if (gates[0].pass) {
      // 🔴 #1079 —— 上面那个 `slot` 是这套候选**全收时**会占的位子，顶栏/页脚按它算（理由整段写在
      //    installCandidate 上面）。人审拒掉几套就会让后面每一套的位子往前挪，那时图上这一维
      //    仍然是「全收假设下的样子」—— 这条边界写进交接与 AC5，不在这里悄悄兜。
      // 🔴 #1134 —— 上面那句只说了「拒掉几套」这一种,还有**第二种**:`ci + slotOffset` 超过位子数时 `slot`
      //    是 `undefined`(`poolSlots()` 今天 80 个位子),`installCandidate` 退回默认顶栏/页脚。
      //    而**拍图那步没有对应的守卫**:下面 `shootCandidate` 照拍、三道闸照过、图册里有图,只是
      //    那行「顶栏 X · 页脚 Y」不打(它挂在 `installed.regions` 上)⟹ 第 81 套起,图上顶栏那一维
      //    静默回到修复前的样子(QA3 实测:与修复前的 `gen-07-2` 图逐字节相同,md5 3291e63d)。
      //    `--count` 没有 ≤80 的闸(`Number(arg('--count', 3))`),所以这是「拒几套之后补池」时真会
      //    走到的一条路。⟹ 这里**仍然不悄悄兜**(兜了就是把一个人审要知道的边界藏起来),
      //    边界写在 `theme-pipeline/README.md` §这本图册仍然看不见的维度 ⑥。
      const installed = installCandidate(c, siteDir, slot);
      if (installed.regions) {
        console.log(`  ${c.id}：顶栏 ${installed.regions.header} · 页脚 ${installed.regions.footer}`
          + `（位子 ${slot.index}${installed.regions.headerMovedBy ? `，顶栏让开了：${installed.regions.headerMovedBy}` : ''}）`);
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
    if (poolMode === 'new' && gates.every((g) => g.pass !== false) && slot) {
      const promoted = toPoolEntry(c, slot);
      // 🔴 这三行是 #1173 与 #1174 撞在一起的地方，而**两边都要**（合并时解掉任一边都会静默坏掉一条路）：
      //    · 位子取上面那个 `slot`（= `slots[ci + slotOffset]`，#1174）—— 往末尾补池时这一批的位子
      //      不是从 0 起的，按**裸 `ci`** 取会让这些套按位子 0-16 装：顶栏/页脚按错位子算、图册上
      //      标错、报告里的 id 也是错的那一批。
      //    · `growing` 的成员带上 `sheetPath`（#1173）—— 见下面那两段。
      // 🔴 #1173 —— `growing` 的成员要带着**自己那份表在哪**。`toPoolEntry` 写的 `entry.sheet` 是
      //    新起的 pool id，而那份表此刻还在候选的工作目录里：拷进 `public/themes/` 是 `promote.js`
      //    写池那一步，发生在整轮跑完之后。不带着走的话，⑤ 在「同一批候选互比」这条路上每次都读不到
      //    表 ⟹ 整轮报「量不到」拒跑，而那条路恰恰是 #1173 最要防的（一批里的双胞胎会一起进池）。
      // 🔴 挂在这里而不是挂进 `toPoolEntry` 的返回值：`growing` **只用于比较、从不落盘**（写池是
      //    `promote.js` 自己读候选目录那条路），所以多这一个键不会漏进 `theme-pool.json`。
      growing[promoted.id] = { ...promoted.entry, sheetPath: c.sheetPath };
      poolId = promoted.id;
    }
    report.push({
      id: c.id,
      poolId,
      // #1182 —— 这套候选是被量在哪个位子上的。读的就是循环体开头那个 `slot`，也就是
      // installCandidate 与 toPoolEntry 上面那两处用的**同一个对象**（#1174 之后位子是
      // `ci + slotOffset`，不是 `ci`；这里别重算，理由写在那个 const 上面）。写池那一步照它发位子，
      // 所以闸量过的那一套和写进池的那一套是同一套。位子表装不下这一批时它是 undefined
      //（README §那本图册仍然看不见的维度 ⑥ 记着这条路），这里如实记成 null，不兜。
      slot: slot ? slot.index : null,
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

  // 🔴 #1182 —— 把这一轮的裁定翻成 complete，写池那一步才认它。入池判据跟上面 `passed` 那一行
  //    **同一个表达式**（`gates.every((g) => g.pass !== false)`），不在这里写第二份。
  // 🔴 落不下去就当场停（exit 2）：那时盘上留着的是开跑前那份 `complete:false` 哨兵，写池那一步
  //    读到它会拒绝写池 —— 这正是本票要的失败方向。
  const acceptedRows = report
    .filter((r) => r.gates.every((g) => g.pass !== false) && r.slot !== null)
    .map((r) => ({ candidate: r.id, slot: r.slot }));
  // 🔴 「过了闸但没位子」要说出来，不许静默少一套：`ci` 超出位子表时上面那个 `slot` 是 null，
  //    而那种候选没法算 pool id（`toPoolEntry` 要一个位子）。静默丢掉它跟「它被闸拒了」在池子里
  //    长得一模一样。
  const noSlot = report.filter((r) => r.gates.every((g) => g.pass !== false) && r.slot === null);
  try {
    writeVerdict(candidatesDir, {
      complete: true,
      candidatesDir,
      total: report.length,
      accepted: acceptedRows,
      rejected: report.filter((r) => r.gates.some((g) => g.pass === false)).map((r) => r.id),
      jammed: jammed.map((r) => r.id),
      noSlot: noSlot.map((r) => r.id),
    });
    console.log(`  裁定已落盘：${path.join(candidatesDir, VERDICT_FILE)}`
      + `（收 ${acceptedRows.length} 套 · 写池那一步不必再手工传名单）`);
  } catch (e) {
    console.error(`🔴 裁定写不进去（${path.join(candidatesDir, VERDICT_FILE)}）：${e.message}`);
    // 🔴 这句话对**两种**盘上状态都要成立，所以不许写成「留着的是那份哨兵」：写不进去的原因可能
    //    正是那个路径被别的东西占了（实测过 EISDIR，那时哨兵已经不在了）。写池那一步两种都不认，
    //    这才是能说的那一句。
    console.error('   写池那一步会拒绝写池：盘上要么是开跑前那份 complete:false 的哨兵，要么是这次'
      + '写不进去的那个东西 —— 它两种都不认。这是有意的：没有名单时唯一安全的动作是不写，不是全收。');
    process.exit(2);
  }
  if (noSlot.length) {
    console.log(`  🔴 这 ${noSlot.length} 套过了闸却没有位子（候选比位子表还多）：`
      + `${noSlot.map((r) => r.id).join(' ')} —— 它们不在名单里，理由见 README §那本图册仍然看不见的维度 ⑥。`);
  }
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
