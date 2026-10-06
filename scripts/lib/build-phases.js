'use strict';
// #1598 —— 建站分五个阶段存档，「续跑」从最后一个完成的阶段接着做。
//
// 阶段顺序是代码**今天**的顺序（PM r2 裁定 二）：出图在 Call 1 里面、在关键词页之前。正文「做什么 1」写的
// `keywordPages → images` 是反的，以那条裁定为准。T4 #1593 删掉第二语言那一步时，由它来改这张表。
//
// 每个阶段结束时 create-site.js §checkpoint 做三件事，放进**同一个提交**：
//   ① `site/site_meta.json` 的 `buildPhase` = 这个阶段
//   ② `site/.build/state.json` = 后面阶段要用的内存对象（`content` 等；`writeSiteConfig` 写出来的文件反推不回它，
//      `content.ai` 就不落盘）；最后一个阶段删掉它。#1600 的建站报告也在里面（`buildReport`）：SEO 检查和关键词页 N/M
//      记在 keywordPages 阶段，从它之后续跑时没人再记，不带上它那几格就成了 null
//      #1593 的第二语言账（`locales`）也在里面：它按对象身份挂在页上，读回来的页是新对象，不带上它续跑的站拼不出第二语言
//   ③ 这个阶段的产物（图、页面文件）
// 🔴 承重的不变量：标记和产物在同一个提交里 ⟹ 任何一份克隆要么两样都有、要么都没有，「有标记、没产物」按构造不存在。
//    所以推送失败不用回滚标记：没推上去的那个提交，在别的克隆里连标记一起不存在。
//
// 只有任务带 `resume: true` 才读这里（PM r2 裁定 一）：Rebuild 复用同一个仓，一个建成过的站仓里 `buildPhase`
// 已经是最后一个阶段 —— 不带这个条件，Rebuild 会变成什么都不重建。

const fs = require('fs');
const path = require('path');

const BUILD_PHASES = ['plan', 'pages', 'images', 'keywordPages', 'secondaryLocales'];
const STATE_VERSION = 1;

// 这个阶段**做完**时进度条到哪儿 —— 续跑从这个数开始（正文做什么 4）。取的是今天流水线上那一刻已经发过的数：
// plan 之后 20（`AI is planning the site...`）· pages 之后 42（`Parsing AI response...`）· images 之后 50
// （`Writing base configuration files...`）· keywordPages 之后 70（`Writing configuration files...`）· 全部做完 85。
const PHASE_DONE_PERCENT = { plan: 20, pages: 42, images: 50, keywordPages: 70, secondaryLocales: 85 };

function statePath(siteDir) {
  return path.join(siteDir, '.build', 'state.json');
}

/**
 * 读这个站的续跑点。回 `{ phase, index, state }`，或 `{ why }`（续不了，原因是给人读的一句话）。
 * `state` 在最后一个阶段为 null（那时已经没有存档 —— 站建完了）。
 *
 * 🔴 存档要跟标记对得上（`state.phase === buildPhase`）才算数：两样东西在同一个提交里，对不上就是有人手改过仓，
 *    或者是这张票之前的代码写的标记 —— 都不该拿去跳过阶段。
 */
function readResumePoint(siteDir) {
  let meta;
  try {
    meta = JSON.parse(fs.readFileSync(path.join(siteDir, 'site_meta.json'), 'utf8'));
  } catch (e) {
    return { why: `site/site_meta.json 读不到（${e.code || e.message}）—— 这个仓里没有存档` };
  }
  const phase = meta && meta.buildPhase;
  if (phase === undefined) return { why: 'site/site_meta.json 里没有 buildPhase —— 这个站还没有完成过任何一个阶段' };
  const index = BUILD_PHASES.indexOf(phase);
  if (index < 0) return { why: `buildPhase 是 ${JSON.stringify(phase)}，不是认得的阶段（${BUILD_PHASES.join(' / ')}）` };
  if (index === BUILD_PHASES.length - 1) return { phase, index, state: null };
  let state;
  try {
    state = JSON.parse(fs.readFileSync(statePath(siteDir), 'utf8'));
  } catch (e) {
    return { why: `buildPhase 是 ${phase}，但存档 site/.build/state.json 读不到（${e.code || e.message}）` };
  }
  if (!state || state.version !== STATE_VERSION || state.phase !== phase) {
    return { why: `存档跟标记对不上：buildPhase ${phase}，存档写的是 ${JSON.stringify(state && state.phase)}（版本 ${JSON.stringify(state && state.version)}）` };
  }
  if (typeof state.themeName !== 'string' || !state.themeName) {
    return { why: `存档里没有主题名（buildPhase ${phase}）—— 续跑必须沿用第一次挑的那套，不能重新挑` };
  }
  return { phase, index, state };
}

/**
 * 这个阶段那次提交的标题里，括号中那一段：`images 3/5`（第几个 / 一共几个）。
 *
 * 🔴 「n/N」是写给 manager 的，不是写给人看的装饰（正文做什么 5）：版本历史（`manager/versions.go`
 *    §isUnfinishedBuildStage）只列 n = N 那一个 —— 前面几个是半截的站（前三个连 `site/brand.json` 都没有），
 *    老板点「回到这个版本」网站就坏。哪个是「最后一个阶段」只在这里定义一次（BUILD_PHASES 的长度）：
 *    #1593 删掉 secondaryLocales 那天，keywordPages 自动变成 `4/4`，manager 那边一个字不用改，也不认得任何阶段名。
 */
function phaseCommitLabel(phase) {
  const i = BUILD_PHASES.indexOf(phase);
  if (i < 0) throw new Error(`不认得的阶段 ${phase}`);
  return `${phase} ${i + 1}/${BUILD_PHASES.length}`;
}

/** 写这个阶段的标记和存档（不提交 —— 提交在 create-site.js §checkpoint）。`state` 为 null ⟹ 删掉存档目录。 */
function writePhaseFiles(siteDir, phase, state) {
  if (!BUILD_PHASES.includes(phase)) throw new Error(`不认得的阶段 ${phase}`);
  const metaFile = path.join(siteDir, 'site_meta.json');
  const meta = JSON.parse(fs.readFileSync(metaFile, 'utf8'));
  meta.buildPhase = phase;
  fs.writeFileSync(metaFile, JSON.stringify(meta, null, 2) + '\n');
  if (state) {
    fs.mkdirSync(path.dirname(statePath(siteDir)), { recursive: true });
    fs.writeFileSync(statePath(siteDir), JSON.stringify({ version: STATE_VERSION, phase, ...state }) + '\n');
  } else {
    fs.rmSync(path.join(siteDir, '.build'), { recursive: true, force: true });
  }
}

/**
 * 一份存档里的那组页：plan / pages 两个阶段存的是 `ai`（页在 `ai.pages`），images / keywordPages 存的是 `content`（`content.pages`，
 * 跟 `ai.pages` 是同一个数组）。#1593 的第二语言账（create-site.js §LocaleBook.snapshot / restore）按这组页的顺序记。
 */
function pagesOfState(state) {
  if (state && state.content && Array.isArray(state.content.pages)) return state.content.pages;
  if (state && state.ai && Array.isArray(state.ai.pages)) return state.ai.pages;
  return [];
}

module.exports = { BUILD_PHASES, PHASE_DONE_PERCENT, readResumePoint, writePhaseFiles, statePath, phaseCommitLabel, pagesOfState };
