#!/usr/bin/env node
'use strict';
// plan-template-layer.js —— 升级时「这次要删哪些模板文件」的命令行入口（#1166 第 1 步 / AC2）。
//
// 用法（在站容器里，**铺之前**跑；脚本本身来自铺进来的那份今天模板，不是站仓里那份老的）：
//   node /app/upgrade-template/scripts/plan-template-layer.js \
//        --today /app/upgrade-template --root /app/repo --baseline /tmp/baseline.json
//
// 🔴 三个清单都由**同一个** walk() 从磁盘上现走一遍：今天的模板、这个站现在这棵树、以及基线（那份
// 是铺之前捕获的 JSON）。一份实现的理由不是洁癖 —— 「铺进去的」和「算出来的」必须是同一个集合，
// 两个 walk 的排除项一旦分叉，删除集就会多算或少算，而两种都静默。
//
// 🔴 **在铺之前算**。铺是覆盖、不删，所以铺完之后要删的那些文件仍在树上；把「铺完的树」当成
// 「今天的模板」去算，`remove` 会恒为空 —— 一组对照全读到同一个值。这一版是改过的：第一版就是那么
// 写的，`lib/template-layer.test.js` 的 ⑥ 那格是为它加的。
//
// --baseline 那份 JSON 是**铺之前**捕获的：`{"paths":[…],"source":"first-commit"|"upgrade-record"}`。
// 必须在铺之前捕获，因为铺是覆盖 —— 铺完就再也读不出「这个站原来身上是哪一版模板」。
//
// 输出一行 JSON：{"event":"template-plan","remove":[…],"layPaths":[…],"lay":N,"keptData":N,"baselineSource":"…"}
//
// 🔴 `layPaths` 是**全份清单**，不只是个数 —— 调用方拿它当 `tar -T` 的输入，铺下去的就是这一份。
// 上一版只给 `lay: N`（个数），于是 worker 只能自己用 `tar --exclude=…` 再造一份「铺什么」的判断，
// 而那份漏了数据层三条判据里的两条（`public/logo.png` · `public/photos/**`）：今天的模板里这两样各 0 个，
// 所以它不开火 —— 那是不对称，不是够用（#1166 r4，QA1 M2 / QA2 Q5：那条 tar 的注释还写着「模板自带的
// 样例 site/ 在这里也排掉了」，而 exclude 清单里没有它）。一个判断两份实现，分叉方向是静默的。
// 退出码：0 算出来了 · 1 算不出来（读不到基线之类）· 4 删除集里混进了数据层（**按设计拒绝**，
// 跟 1 分开，理由同 upgrade-site-data.js 那条：拒绝不是崩了）。
//
// 🔴 判据在 `lib/template-layer.js` 一处，这里只做 IO。worker 不许自己再算一份 —— 同一个判断两份
// 实现，分叉的方向是静默的（Go 那份算多了就会删掉客人的照片）。

const fs = require('fs');
const path = require('path');
const T = require('./lib/template-layer.js');

const argv = process.argv.slice(2);
const opt = (n, d) => { const i = argv.indexOf(`--${n}`); return i >= 0 ? argv[i + 1] : d; };
const rootDir = path.resolve(opt('root', process.cwd()));
const todayDir = path.resolve(opt('today', rootDir));
const baselineFile = opt('baseline', '');
const emit = (o) => process.stdout.write(`${JSON.stringify(o)}\n`);

// 今天模板 / 现在这棵树，都从磁盘上现走一遍。
//
// 🔴 排除分成两半，别混：`SKIP` 是**构建产物和依赖**（不铺、也不算进基线）；而**数据层**
// （`site/` · `public/logo.png` · `public/photos/**`）不在这里排，由 `lib/template-layer.js` 的
// `templateFilesOf` 统一滤 —— 判据只留一处。所以下面 `todayPaths` 的长度里**含**模板自带的样例
// `site/`，而真正会被铺下去的是 `plan.lay`（滤过的那份）。报数时两个都打，免得读的人拿错那一个。
//
// 🔴 铺下去这一步读的就是 `plan.lay` 本身：worker 把它写成一个文件、交给容器里的 `tar -T`
// （`worker/main.go` §layDownTemplate），所以那边**没有** `--exclude` 这种写法可以跟这里分叉。
// 这段上一版写着「它跟 tar 的 `--exclude=site` 是同一个决定的两种写法」—— 那句话在 #1166 r5 把
// tar 换成 `tar -T` 之后就过期了（QA1 r5 的轻微一条）。留着它的坏处不是不准确，是它把一个不存在的
// 第二道防线写成了存在。
const SKIP = new Set(['node_modules', '.git', '.next', 'out', 'sites', 'config']);
function walk(dir, base = dir, out = []) {
  let entries;
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return out; }
  for (const e of entries) {
    if (SKIP.has(e.name)) continue;
    const full = path.join(dir, e.name);
    if (e.isDirectory()) walk(full, base, out);
    else if (e.isFile()) out.push(path.relative(base, full));
  }
  return out;
}

let baseline;
try {
  baseline = JSON.parse(fs.readFileSync(baselineFile, 'utf-8'));
} catch (e) {
  emit({ event: 'error', message: `could not read the baseline (${baselineFile}): ${e.message}` });
  process.exit(1);
}
if (!Array.isArray(baseline.paths)) {
  emit({ event: 'error', message: 'baseline has no paths array — refusing to guess a delete set' });
  process.exit(1);
}

const currentPaths = walk(rootDir);
const todayPaths = walk(todayDir);
if (!todayPaths.length) {
  emit({ event: 'error', message: `today's template looks empty at ${todayDir} — refusing to compute a delete set` });
  process.exit(1);
}
const plan = T.planTemplateLayer({
  baselinePaths: baseline.paths,
  todayPaths,
  currentPaths,
});

try {
  T.assertNoDataLayer(plan.remove, 'delete set');
} catch (e) {
  emit({ event: 'blocked', message: e.message, remove: plan.remove.length });
  process.exit(4);
}

// 🔴 这里**没有**给 `plan.lay` 再加一道 `assertNoDataLayer`，而且这是想过之后的决定，不是漏了。
// `planTemplateLayer` 返回的 `lay` 就是 `templateFilesOf(todayPaths)`，数据层已经被滤掉 ⟹ 任何输入
// 都触发不了那道检查。`lib/template-layer.js` 里那段注释写的就是这条：不可达的保险比没有更糟，因为
// 人会以为那一维有人看着。删除集那一道不同 —— 它守的是**调用方**（拼路径、可能展开目录）。
// 铺这一半的对应保障是：它作为**清单**发出去，容器里 `tar -T` 照单铺，中间没有第二次判断；这个性质
// 由 `lib/template-layer.test.js` 那格钉住（今天的模板里放上 logo / 照片 / 样例 site/，看它们进不进
// `lay`），因为「按构造不可能」正该由测试来证明，不该由一行永不开火的运行时代码来假装。

emit({
  event: 'template-plan',
  baselineSource: baseline.source || 'unknown',
  today: todayPaths.length,
  current: currentPaths.length,
  lay: plan.lay.length,
  layPaths: plan.lay,
  keptData: plan.keptData.length,
  remove: plan.remove,
});
