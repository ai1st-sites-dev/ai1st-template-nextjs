#!/usr/bin/env node
// #1408 —— 发布前那一句不挡路的提示：「这次发布之后网站上没有联系表单了」。
//
// 在**站自己的容器里**跑（`docker exec -w /app/repo <siteId> node scripts/publish-notice.js`），由 worker
// 在发布构建之前调用（`worker/main.go` §processDeployTask）。只读，不写任何文件、不动 git 状态。
//
// 成功时 stdout 打**一行** JSON：
//   {"ok":true,"marker":"<sha>|null","before":<n|null>,"after":<n|null>,"reason":"…","notice":null|{"kind","message"}}
//   · before / after：上一次发布那份 / 这次那份里，实际渲染出来的收客入口块有几个（`lib/contact-entry.js`）
//   · notice 只在 before > 0 且 after === 0 时有 —— 「跟上一次发布比」，不是跟空白比：
//     首次发布（没有标记）不说；本来就没有入口的站再发一次也不说（没变就不说）。
// 退出码恒 0（除非脚本自己崩了）：这是一句提示，它出任何问题都不许挡发布。
//
// ── 「上一次发布」是哪一份 ──────────────────────────────────────────────────────────────────────
// 🔴 站仓里的 tag `ai1st-published`，worker 在发布上传成功之后把它挪到这次构建的那个 commit 并推到
//    GitHub（名字跟 worker 那边的 `publishedTag` 常量是同一个串）。**不能拿最后一个 commit 当上一次发布**：
//    每次 AI 编辑 / 编辑器存盘都 commit + push 站仓，一次 commit ≠ 一次发布。
//    用 tag 而不是只留在容器里的东西：容器每次冷启动都重新 clone，tag 是 clone 默认会带下来的。
// 🔴 标记那份用 `git archive <tag> site` 解到临时目录再算，**不 checkout**：AI 编辑和编辑器存盘都在写
//    这棵工作区。
//
// ── 这次那份是哪一份 ────────────────────────────────────────────────────────────────────────────
//    工作区里的 `site/` —— 紧接着的发布构建读的就是它。

'use strict';

const cp = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { loadBlockManifests } = require('./blocks');
const { entryTypes, contactEntriesOf, footerContactOf } = require('./lib/contact-entry');

const PUBLISHED_TAG = 'ai1st-published';
const ROOT = process.cwd();

function out(o) {
  process.stdout.write(`${JSON.stringify({ ok: true, ...o })}\n`);
  process.exit(0);
}

// 文案只说判据真能证明的那部分：页脚每一页都画邮箱 / 电话（`blocks/footer/Section.tsx` 的联系栏），
// 所以不许说「没有任何联系方式」；这个站两样都没填时，后半句也不说。
function noticeText(footer) {
  const first = 'After this publish your website has no contact form.';
  const via = footer.email && footer.phone ? 'the email / phone in the footer'
    : footer.email ? 'the email in the footer'
      : footer.phone ? 'the phone number in the footer'
        : '';
  return via ? `${first} Customers can only reach you through ${via}.` : first;
}

function main() {
  let types;
  try {
    types = entryTypes(loadBlockManifests(ROOT));
  } catch (e) {
    out({ marker: null, before: null, after: null, reason: `manifests-unreadable: ${e.message}`, notice: null });
  }

  const siteDir = path.join(ROOT, 'site');
  const after = contactEntriesOf(siteDir, types);
  if (after === null) out({ marker: null, before: null, after: null, reason: 'current-unreadable', notice: null });

  const rev = cp.spawnSync('git', ['rev-parse', '-q', '--verify', `refs/tags/${PUBLISHED_TAG}^{commit}`],
    { cwd: ROOT, encoding: 'utf8' });
  const marker = rev.status === 0 ? rev.stdout.trim() : '';
  if (!marker) out({ marker: null, before: null, after: after.length, reason: 'no-marker', notice: null });

  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'publish-notice-'));
  let before;
  try {
    // 一条管道，两端都在 argv 里 —— marker 是 rev-parse 验过的 40 位 sha，不是外来字符串。
    const x = cp.spawnSync('sh', ['-c', `git archive "$1" site | tar -x -C "$2"`, 'sh', marker, tmp],
      { cwd: ROOT, encoding: 'utf8' });
    before = x.status === 0 ? contactEntriesOf(path.join(tmp, 'site'), types) : null;
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
  if (before === null) out({ marker, before: null, after: after.length, reason: 'marker-unreadable', notice: null });

  const notice = before.length > 0 && after.length === 0
    ? { kind: 'no-contact-form', message: noticeText(footerContactOf(siteDir)) }
    : null;
  out({ marker, before: before.length, after: after.length, reason: notice ? 'entries-gone' : 'nothing-to-say', notice });
}

if (require.main === module) main();

module.exports = { PUBLISHED_TAG, noticeText };
