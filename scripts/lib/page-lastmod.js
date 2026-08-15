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
//      🔴 站容器里的 clone 是 `git clone --depth 1`（worker/entrypoint.sh:28），只有一个根提交。
//      那种仓库里所有页面的读数都是那次 push 的时间 —— 这是**对的**：那确实是这些页面最后一次
//      变化的时间。此后每次编辑产生的新提交只会碰到真的改了的那几个文件，所以「改一页 → 只有
//      那一页的时间变」在浅克隆里照样成立。
//
//   2. **文件 mtime**。拿不到 git 读数时用：本仓 `templates/nextjs/site` 被 .gitignore 挡着
//      （templates/nextjs/.gitignore:10），所以本地开发恒走这一档；文件被改过还没提交时也走这一档
//      （那时 git 的时间是旧的，mtime 才是真的）。
//
//   3. **构建时刻**。前两个都拿不到（文件读不到了）才落到这里，并且会在构建日志里**点名说出来** ——
//      静默退回构建时刻就是本票要治的那个毛病本身。
//
// 🔴 边界写在明处：这里量的是**页面自己那份 JSON 文件**变没变。改 brand.json 的配色、换主题、改
// 顶栏结构 —— 这些会让每一页的 HTML 都不一样，但**不**会让这里的读数变。那是有意的：站级的皮肤
// 改动不是「这一页的内容更新了」，把它算进来等于把本票要修的毛病换个入口再犯一次。

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

  return { dates, dirty };
}

/**
 * 建一个「问一个文件路径，答它上次什么时候变的」的东西。git 的两张表只在这里算一次。
 *
 * @param {string} rootDir   仓库/模板根目录（sync-config.js 的 rootDir）
 * @param {string} pathspec  只看这个子树，相对 rootDir（本项目里是 'site'）
 * @param {string} buildTime 兜底用的构建时刻（ISO 字符串）
 */
function createLastModifiedResolver({ rootDir, pathspec, buildTime }) {
  const index = gitIndex(rootDir, pathspec);

  return {
    // 返回 { value, source }，source 是 'git' / 'mtime' / 'build' 三档之一。
    // value 恒是一个可用的 ISO 时间 —— 这个函数不会返回空值。日志由调用方按 source 打，
    // 因为只有它知道这一页属于哪个语言、slug 叫什么。
    resolve(absPath) {
      if (absPath && index && !index.dirty.has(absPath) && index.dates.has(absPath)) {
        return { value: index.dates.get(absPath), source: 'git' };
      }
      if (absPath) {
        try {
          const iso = toIso(fs.statSync(absPath).mtime);
          if (iso) return { value: iso, source: 'mtime' };
        } catch {
          // 读不到这个文件 —— 落到下面那一档，调用方会点名。
        }
      }
      return { value: buildTime, source: 'build' };
    },
  };
}

module.exports = { createLastModifiedResolver, toIso };
