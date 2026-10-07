#!/usr/bin/env node
// #1405 —— 编辑器的一次存盘：页面 JSON（可选）+ 外壳四样（root 字段，可选），**先全判、再全写**。
//
// 跟 `write-page.js` 同一个位置、同一种调用：在**站自己的容器里**跑
// （`docker exec -i -w /app/repo <siteId> node scripts/write-editor-save.js '<定位>' < 存盘内容`），由 worker
// 调用（`worker/blocks_task.go` §processBlockPatchTask 带 root 的那一支）。只写磁盘，不 commit、不构建。
//
// 用法：
//   node scripts/write-editor-save.js '{"page":"<页面 slug>","locale":"<语言，可空>","baseHash":"<sha256，带页面时必填>"}'
//   stdin：{ "page": <整份页面 JSON，可缺>, "root": { <改过的 root 字段> }, "shared": { <共用块的改动>，#1406 },
//           "forms": { <一张表单的文案改动>，#1634 } }
//   （四样都可缺，但不能一样都没有；`shared` 的形状与判据见 `lib/shared-blocks-write.js` 文件头，`forms` 见 `lib/forms-write.js`）
//
// 成功时 stdout 打**一行** JSON：{"ok":true,"files":["site/en/pages/home.json","site/theme.json",…],"hash":"<sha256>"}
//   （`files` 是这次真写了的文件，worker 拿它 `git add`；一个都没写 ⟹ 空数组）
//   （`notice` 是 #1420 加的，可缺：这一笔替换掉了一个「编辑器打开之后别处改过」的共用块字段时，给老板看的一句话）
//   （`hash` 是 #1415 加的：**这次写了页面**才有，是写进去那份页面字节的 sha256，编辑器拿它当下一次的 baseHash。
//    只改外壳时没有这个键 —— 页面文件没动，编辑器手上那个 baseHash 仍然对；回一个「当前文件的 hash」反而会
//    把别处在这期间对这一页的改动悄悄认成底稿，下一次存页面就把那次改动冲掉了）
// 拒收时 stdout 也打一行：{"ok":false,"message":"<给老板看的一句话>"}，退出码 11。
//
// 退出码：
//   0 成功   4 找不到那一页 / 那种语言   5 参数或内容的形状不对
//   9 写进去这个站就建不出来了 —— 不写     10 这一页在编辑器打开之后被别处改过了（baseHash）—— 不写
//  11 **拒收**：这个组合构建不收（带公告条的布局 + 透明浮层顶栏 / 某种语言缺公告条文字 / 布局自带页脚时改页脚），
//     或者老板填的链接不是能用的地址（#1416：页面里块的链接 / 公告条链接；#1427：共用块里的链接 ——
//     `lib/page-write.js` §commitWrites 对这次每一份写入都判一遍，判据在 `lib/link-href.js`），
//     或者（#1406）要从这一页删一个「所有页面」上的共用块，
//     或者（#1634）表单文案超过上限 / 带了文案以外的键（改字段是 #1637 的事），
//     那句话原样进编辑器状态栏（worker 从 stdout 那一行取 `message`）—— 不写
//
// 🔴 所有校验在所有写入之前（票正文做什么 6）：页面判过了、外壳被拒 ⟹ 页面也一个字节不写。判与写分开
//    住在 `lib/page-write.js` §planPageWrite / `lib/editor-root.js` §planRootWrite（都只算字节），最后
//    一起交给 §commitWrites。
// 🔴 页面那一半的判据跟 `write-page.js` 是同一份代码（`lib/page-write.js`），不是这里另写。

const fs = require('fs');
const path = require('path');

const ROOT = process.cwd();

function die(code, msg) {
  process.stderr.write(String(msg) + '\n');
  process.exit(code);
}

let blocks;
let pageFiles;
let siteShape;
let pageWrite;
let editorRoot;
let sharedWrite;
let formsWrite;
try {
  blocks = require(path.join(ROOT, 'scripts', 'blocks.js'));
  pageFiles = require(path.join(ROOT, 'scripts', 'lib', 'page-files.js'));
  siteShape = require(path.join(ROOT, 'scripts', 'lib', 'site-shape.js'));
  pageWrite = require(path.join(ROOT, 'scripts', 'lib', 'page-write.js'));
  editorRoot = require(path.join(ROOT, 'scripts', 'lib', 'editor-root.js'));
  sharedWrite = require(path.join(ROOT, 'scripts', 'lib', 'shared-blocks-write.js'));
  formsWrite = require(path.join(ROOT, 'scripts', 'lib', 'forms-write.js'));
} catch (e) {
  die(5, `读不到构建脚本：${e.message}`);
}

let loc;
try {
  loc = JSON.parse(process.argv[2] || '');
} catch (e) {
  die(5, `第一个参数不是合法 JSON：${e.message}`);
}
if (!loc || typeof loc !== 'object' || Array.isArray(loc)) die(5, '第一个参数必须是一个对象');
const slug = typeof loc.page === 'string' ? loc.page : '';
const baseHash = typeof loc.baseHash === 'string' ? loc.baseHash : '';
const localeIn = typeof loc.locale === 'string' ? loc.locale : '';

let input;
try {
  input = JSON.parse(fs.readFileSync(0, 'utf-8'));
} catch (e) {
  die(5, `stdin 不是合法 JSON：${e.message}`);
}
if (!input || typeof input !== 'object' || Array.isArray(input)) die(5, 'stdin 必须是一个对象 { page?, root?, shared?, forms? }');
const hasPage = Object.prototype.hasOwnProperty.call(input, 'page') && input.page !== null;
const root = Object.prototype.hasOwnProperty.call(input, 'root') ? input.root : {};
const shared = Object.prototype.hasOwnProperty.call(input, 'shared') && input.shared !== null ? input.shared : null;
// #1634 —— 表单文案（一张表单的 name / buttonText / successMessage）。只改表单的那一笔不带页面、不带 baseHash。
const forms = Object.prototype.hasOwnProperty.call(input, 'forms') && input.forms !== null ? input.forms : null;
const hasRoot = !!root && typeof root === 'object' && Object.keys(root).length > 0;
if (!hasPage && !hasRoot && !shared && !forms) die(5, '这次存盘既没有页面、也没有 root 字段、也没有共用块、也没有表单');

try {
  const target = pageWrite.resolveTarget(ROOT, siteShape, localeIn);
  const writes = [];
  let pageHash = '';
  // #1406 —— 块库那一半先算（页面那一半的校验要拿写完以后的块库），两半都判过了才一起写。
  const s = shared ? sharedWrite.planSharedWrite({ blocks, pageFiles, target, slug, shared }) : null;
  if (hasPage) {
    const w = pageWrite.planPageWrite({ root: ROOT, blocks, pageFiles, target, slug, baseHash, next: input.page, siteBlocks: s ? s.next : undefined });
    pageHash = w.hash;
    writes.push(w);
  }
  if (s) writes.push(s);
  // #1634 —— 表单那一半同样只判、算字节，跟别的几半一起交给 commitWrites（被拒 ⟹ 页面 / 外壳 / 共用块一个字节都不写）。
  const f = forms ? formsWrite.planFormsWrite({ target, forms }) : null;
  if (f) writes.push(f);
  writes.push(...editorRoot.planRootWrite({
    siteDir: path.join(ROOT, 'site'),
    localeDir: target.localeDir,
    locale: target.locale,
    shape: target.shape,
    root,
  }));
  pageWrite.commitWrites(writes);
  const files = writes.map((w) => path.relative(ROOT, w.file).split(path.sep).join('/'));
  // #1420 —— `notice`：这一笔替换掉了别处刚改过的同一个共用块字段（§shared-blocks-write overwrittenFields），worker 原样带进 page-saved。
  const out = { ok: true, files, ...(pageHash ? { hash: pageHash } : {}), ...(s && s.notice ? { notice: s.notice } : {}) };
  process.stdout.write(`${JSON.stringify(out)}\n`);
} catch (e) {
  if ((e instanceof editorRoot.RootWriteError && e.code === editorRoot.REFUSED)
    || (e instanceof pageWrite.PageWriteError && e.code === pageWrite.REFUSED)
    || (e instanceof sharedWrite.SharedWriteError && e.code === sharedWrite.REFUSED)
    || (e instanceof formsWrite.FormsWriteError && e.code === formsWrite.REFUSED)) {
    process.stdout.write(`${JSON.stringify({ ok: false, message: e.message })}\n`);
    die(e.code, e.message);
  }
  if (e instanceof pageWrite.PageWriteError || e instanceof editorRoot.RootWriteError || e instanceof sharedWrite.SharedWriteError
    || e instanceof formsWrite.FormsWriteError) die(e.code, e.message);
  throw e;
}
