// #1026 — 「这一页的内容上次是什么时候变的」。
//
// sitemap.xml 里每个页面的 <lastmod> 以前写的是**构建时刻**，所以一个站每重建一次就等于告诉
// 搜索引擎「所有页面都更新了」—— 哪怕一个字节都没动。而重建在这个产品里非常频繁：换主题要重建、
// AI Writer 发一篇博客要重建、改任何配置都要重建。这个文件回答的是另一个问题：**这一页自己**
// 上次什么时候变的。
//
// 取值有三个来源，按可信度排：
//
//   1. **git 提交时间**。每个站本身就是一个 git 仓库 —— 建站时 `git add site/ public/` 提交
//      （create-site.js），之后每次编辑 `git add -A && git commit`（edit-site.js:598），换主题只提交
//      theme.json（worker/main.go:1612）。所以「这个页面文件上次被哪一次提交碰过」就是权威答案，
//      而且它跨重建、跨容器重建都不变：没有新提交 = 读数一个字符都不变。
//      🔴 前提是**克隆带着完整历史**。#1033 之前站容器跑的是 `git clone --depth 1`，浅克隆里只有
//      一个提交，`git log --name-only` 会把所有文件都算成它碰过的 ⟹ 容器一重新拉代码，全站每一页
//      的日期就并成那一次提交的时间，哪怕那次只提交了 site/theme.json（#1026 的 QA2 实测：完整历史
//      5 种取值，浅克隆 3 种，18 个页面并成一个）。这里原来写着「那确实是这些页面最后一次变化的
//      时间」—— 那句只有在仓库一辈子只有一个提交时才成立，上面那个读数就是它的反例。
//      现在 worker/entrypoint.sh 的克隆带着完整历史（代价与另一个被否掉的选项都写在那里），
//      而这个文件仍然会在浅克隆下把话说出来（下面 `shallow`，由 sync-config 打印）—— 少报是静默的，
//      不说出来就没人会发现。
//
//   2. **文件 mtime**。拿不到 git 读数时用：本仓 `templates/nextjs/site` 被 .gitignore 挡着
//      （ai1st 仓库根的 `.gitignore:47`，那一行写的是 `templates/nextjs/site/`；#1026 这里写的是
//      `templates/nextjs/.gitignore:10`，而那个文件第 10 行是 `sites/`（复数，另一个目录）——
//      判据 `git check-ignore -v templates/nextjs/site` 打的是根那份），所以本地开发恒走这一档；
//      文件被改过还没提交时也走这一档
//      （那时 git 的时间是旧的，mtime 才是真的）。
//
//   3. **构建时刻**。前两个都拿不到（文件读不到了）才落到这里，并且会在构建日志里**点名说出来** ——
//      静默退回构建时刻就是本票要治的那个毛病本身。
//
// 🔴 边界写在明处（#1033 挪了一次，往「多算」的方向）：一页的日期取**这一页渲染时读到的那几份
// 文件里最晚的那个**，不再只看页面自己那份 JSON。哪几份由 page-deps.js 算（页面 JSON + 这一页真的
// 渲染 services 时的 services.json —— 服务详情页 `/services/<id>` 也算，它那份 Service 结构化数据是
// 页面外壳自己发的、不经过任何块 + 这一页用到站级块时的 blocks/site-blocks.json）。
// 在此之前，改 site/<locale>/services.json 一个服务名 —— 好几个 HTML 文件真的变了，而 sitemap 一字不动
// （PM ship #1026 时量的：16 个 .html 含新字符串，sitemap.xml 与基线逐字节相同）。
//
// 仍然**不**算进来的是**站级外壳**：brand.json 的配色、主题、导航、页脚、每页都发的那份
// LocalBusiness 结构化数据。它们同样会让每一页的 HTML 不一样，但那不是「这一页的内容更新了」，
// 把它算进来等于把 #1026 要修的毛病换个入口再犯一次（每次换主题都告诉搜索引擎全站更新了）。
// 📌 所以有一个说在明处的代价：改一个服务名，页脚和那份 LocalBusiness 结构化数据里的服务清单在
// **每一页**上都变了，而只有真的把这个服务渲染出来的那几页会报新日期。#1033 r2 在真站
// site-51c2f83b 上量的（真改一个服务名、真提交、在真的 builder 镜像里重建）：20 个 .html 里 10 个
// 含新名字，而报新日期的是 4 页 —— 首页（6 处）/ services（14 处）/ quote（5 处）/
// services/manicure（8 处，其中 3 处是它自己那份 Service 结构化数据）。另外 4 页
// about / gallery / testimonials / contact 各只有 4 处，全在页脚和那份 LocalBusiness 里
// （含 RSC 负载里重复的那份），日期不动。

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

// git log 的每条记录用它开头，把「时间那一行」和「文件名那些行」分开。用控制字符是因为它不可能
// 出现在路径里。
const MARK = '\u0001';

function git(cwd, args) {
  try {
    return execFileSync('git', ['-c', 'core.quotePath=false', ...args], {
      cwd,
      encoding: 'utf-8',
      stdio: ['ignore', 'pipe', 'ignore'],
      maxBuffer: 64 * 1024 * 1024,
    });
  } catch {
    // 不是仓库、没装 git、命令失败 —— 三种都是「拿不到 git 读数」，落到 mtime 那一档。
    return null;
  }
}

// 把任意时间表示归一化成 ISO 8601（带 Z）。认不出来的返回 null —— 认不出来和「没有」是同一件事。
function toIso(value) {
  if (!value) return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

// porcelain 的一行长这样：`XY <路径>`，改名是 `R  <旧> -> <新>`。
function statusPath(line) {
  let p = line.slice(3);
  const arrow = p.indexOf(' -> ');
  if (arrow !== -1) p = p.slice(arrow + 4);
  if (p.startsWith('"') && p.endsWith('"')) p = p.slice(1, -1);
  return p;
}

// git 那一档的两张表：每个文件上次被提交碰过是什么时候，以及哪些文件在工作区里被改过还没提交。
// 一个站一次构建只走一遍（三次 git 调用），不是每页一次。
function gitIndex(rootDir, pathspec) {
  const top = git(rootDir, ['rev-parse', '--show-toplevel']);
  if (!top) return null;
  const toplevel = top.trim();

  const log = git(rootDir, ['log', `--pretty=format:${MARK}%cI`, '--name-only', '--', pathspec]);
  if (log === null) return null;

  const dates = new Map();
  let current = null;
  for (const line of log.split('\n')) {
    if (line.startsWith(MARK)) {
      current = toIso(line.slice(MARK.length).trim());
      continue;
    }
    const rel = line.trim();
    if (!rel || !current) continue;
    const abs = path.resolve(toplevel, rel);
    // git log 是新 → 旧，所以第一次见到某个文件就是它最近一次被碰的时间。
    if (!dates.has(abs)) dates.set(abs, current);
  }

  const dirty = new Set();
  const status = git(rootDir, ['status', '--porcelain', '--', pathspec]);
  for (const line of (status || '').split('\n')) {
    if (line.length < 4) continue;
    dirty.add(path.resolve(toplevel, statusPath(line)));
  }

  // #1033 —— 浅克隆里上面那张表是**假的**（只有一个提交，所有文件都算成它碰过的）。判断出来交给
  // 调用方去说，不在这里改行为：那一档的读数仍然是这个仓库能给出的最好答案，只是它是并起来的。
  const shallow = (git(rootDir, ['rev-parse', '--is-shallow-repository']) || '').trim() === 'true';

  return { dates, dirty, shallow };
}

/**
 * 建一个「问一页读了哪几个文件，答它上次什么时候变的」的东西。git 的两张表只在这里算一次。
 *
 * @param {string} rootDir   仓库/模板根目录（sync-config.js 的 rootDir）
 * @param {string} pathspec  只看这个子树，相对 rootDir（本项目里是 'site'）
 * @param {string} buildTime 兜底用的构建时刻（ISO 字符串）
 */
function createLastModifiedResolver({ rootDir, pathspec, buildTime }) {
  const index = gitIndex(rootDir, pathspec);

  // 🔴 #1025 条 12 —— 上界。文件的 mtime 可以是未来（`touch -d 2030-01-01` 就够了，QA3 在 #1026
  //    实测过：`config-data.ts` 里当场写出 `"2030-01-01T00:00:00.000Z"`）。一个未来的 <lastmod>
  //    对搜索引擎是明确的坏信号，而它不会自己好——要等到有人真的再编辑一次这个文件才自愈。
  //    压回构建时刻是安全方向：构建时刻本来就是这个函数最后那一档的取值。
  //    只压上界、不碰下界：很旧的日期是真话，没有理由改它。
  function capFuture(iso, source) {
    if (iso && buildTime && iso > buildTime) return { value: buildTime, source: `${source}-capped` };
    return { value: iso, source };
  }

  function resolveOne(absPath) {
    if (absPath && index && !index.dirty.has(absPath) && index.dates.has(absPath)) {
      return capFuture(index.dates.get(absPath), 'git');
    }
    if (absPath) {
      try {
        const iso = toIso(fs.statSync(absPath).mtime);
        if (iso) return capFuture(iso, 'mtime');
      } catch {
        // 读不到这个文件 —— 落到下面那一档，调用方会点名。
      }
    }
    return { value: buildTime, source: 'build' };
  }

  return {
    // 这个仓库是不是浅克隆（history 被砍掉了）。true 时上面那张「每个文件上次被哪次提交碰过」的表
    // 会把所有文件并成同一个时间 —— 调用方要把这件事说出来（#1033）。
    shallow: Boolean(index && index.shallow),

    // 一页读了哪几个文件（页面自己那份 + services.json + 站级块库，由 page-deps.js 算），这一页的
    // 日期就是它们里面**最晚**的那个。#1033 之前这里是一页一个文件的 `resolve(absPath)`，改成多文件
    // 之后那个单文件版本没有调用方了，所以没留。
    //
    // 返回 { value, source, from }：value 恒是一个可用的 ISO 时间（这个函数不会返回空值），
    // source 是 'git' / 'mtime' / 'build' 三档之一、from 是赢的那个文件 —— 日志和排查都要它们，
    // 否则「为什么这一页是这个日期」没法回答。日志由调用方打，因为只有它知道这一页属于哪个语言。
    // 🔴 空数组（一页一个源文件都说不出来）落到最后那一档：构建时刻 + 调用方点名。
    resolveLatest(absPaths) {
      let best = null;
      for (const p of absPaths || []) {
        const got = resolveOne(p);
        // 两边都是 toIso 的产物（`YYYY-MM-DDTHH:mm:ss.sssZ`），同一种格式定长、都带 Z ——
        // 字符串比大小就是比时间。
        if (!best || got.value > best.value) best = { ...got, from: p };
      }
      return best || { ...resolveOne(undefined), from: null };
    },
  };
}

// 🔴 #1025 条 11 —— `toIso` 不再导出:全仓外部调用点 0 个(它只被本文件内部用了 3 次)。
//    留着一个没人调的导出，下一个人会以为它是这个模块对外契约的一部分而不敢动它。
module.exports = { createLastModifiedResolver };
