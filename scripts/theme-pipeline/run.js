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
//   ④ 人审：不自动化 —— 打印图册怎么出，然后停在这里
//
// 🔴 ①没过就不进②：建一次站 + 起浏览器要几十秒，而静态那道能拦的东西不值这个钱。
//    报告里会写清每套停在哪一道。
const fs = require('fs');
const path = require('path');
const cp = require('child_process');

const NEXT = path.resolve(__dirname, '..', '..');
const { generateCandidates } = require('./generate');
const { gateStatic, gateInvariants, gateSimilarity, gateHumanReview } = require('./gates');
const {
  shootCandidate, writeComparisonPage, whyNoAllBlocksPage, clearCandidateShots,
} = require('./gallery');

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

/** 把一套候选装进样例站：tokens 进 brand.json、表进 public/themes/、theme.json 指向它。 */
function installCandidate(candidate, siteDir) {
  const brandPath = path.join(siteDir, 'brand.json');
  const brand = JSON.parse(fs.readFileSync(brandPath, 'utf-8'));
  brand.colors = candidate.tokens.colors;
  brand.fonts = candidate.tokens.fonts;
  brand.settings = candidate.tokens.settings;
  fs.writeFileSync(brandPath, `${JSON.stringify(brand, null, 2)}\n`);
  const dest = path.join(NEXT, 'public', 'themes', `${candidate.id}.css`);
  fs.copyFileSync(candidate.sheetPath, dest);
  // 🔴 `applied` 必须是 false：为真时 sync-config 会用**注册表**里那套覆盖 brand 的颜色/字体/settings
  //    （sync-config.js:167），而候选还不在注册表里 —— 那样量到的是别人的 tokens。
  fs.writeFileSync(path.join(siteDir, 'theme.json'),
    `${JSON.stringify({ themeId: candidate.id, applied: false, css: candidate.id }, null, 2)}\n`);
  return dest;
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

  const candidates = arg('--candidates', '')
    ? fs.readdirSync(arg('--candidates', '')).filter((f) => f.endsWith('.css')).map((f) => {
      const id = path.basename(f, '.css');
      const dir = arg('--candidates', '');
      // 🔴 版式从 `<id>.layout.json` 读回来（生成器写的），不再写死成 `{}`：写死那一版让第三道闸的
      //    版式那一项在这条路上永远「没得比」，而它当时算成 0 分 = 完全不像 ⟹ 上限 0.8 < 阈值 0.9，
      //    整道闸不可能开火（QA2 在 #1004 r2 端到端量的）。手工放进来的候选没有这个文件，那就是
      //    真的没有版式可比 —— gates.js 的 `similarity` 现在会把这一项从分母里去掉，不当成 0。
      const layoutFile = path.join(dir, `${id}.layout.json`);
      return {
        id,
        sheetPath: path.join(dir, f),
        tokens: JSON.parse(fs.readFileSync(path.join(dir, `${id}.tokens.json`), 'utf-8')),
        layout: fs.existsSync(layoutFile) ? JSON.parse(fs.readFileSync(layoutFile, 'utf-8')) : {},
      };
    })
    : generateCandidates(count, { seed, outDir: workDir });

  const { themes } = require(path.join(NEXT, 'scripts', 'themes.js'));
  const report = [];

  // #1015：跑之前先存一份，finally 里放回去（理由写在 snapshotSite 头上）。
  const t1015Snap = snapshotSite(siteDir);
  let t1015Restore = null;
  try {
  for (const c of candidates) {
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
      installCandidate(c, siteDir);
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
        const notThisBuild = whyNotThisBuild(outRoot, outDir, c);
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
    if (gates.every((g) => g.pass)) gates.push(gateSimilarity(c, themes));
    if (gates.every((g) => g.pass)) {
      gates.push(gateHumanReview(c, { galleryDir, shot }));
    }
    report.push({
      id: c.id,
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
    const stopped = r.gates.find((g) => g.pass === false);
    console.log(`\n${r.id}: ${stopped ? `🔴 停在【${stopped.gate}】` : '✅ 前三道全过,等人审'}`);
    for (const g of r.gates) {
      const mark = g.pass === true ? '✅' : g.pass === false ? '🔴' : '⏸';
      console.log(`  ${mark} ${g.gate}${g.note ? ` —— ${g.note}` : ''}`);
      for (const p of g.problems) console.log(`       ${p}`);
    }
  }
  const passed = report.filter((r) => r.gates.every((g) => g.pass !== false)).length;
  console.log(`\n${passed}/${report.length} 套过了前三道闸。第四道是人。`);
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
  process.exit(passed === report.length ? 0 : 1);
}

if (require.main === module) main().catch((e) => { console.error(e); process.exit(2); });
