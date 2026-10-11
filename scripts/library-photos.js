#!/usr/bin/env node
// #1716 —— 建站生成的照片（`public/photos/<key>.jpg`）和 logo（`public/logo.png`）搬进老板的图库之后，
// 把站里引用它们的地方换成图库地址，并删掉本地那几个文件。
//
// 在**站自己的容器里**跑（`docker exec -i -w /app/repo <siteId> node scripts/library-photos.js <模式>`），由 worker
// 调用（`worker/library_photos.go`）。只动磁盘 —— 上传、提交、推送、插图库行都归 worker。
//
// 用法：
//   node scripts/library-photos.js list
//     stdout 一行：{"ok":true,"files":[{"ref":"/photos/home-hero.jpg","path":"public/photos/home-hero.jpg"}, …],
//                   "touches":["site/brand.json","site/en/pages/home.json", …]}
//     files = 站点 JSON 里【原样还在】的本地照片 / logo 引用，且磁盘上真有那个文件。worker 只传这几张。
//     touches = apply 拿这几张的对照表会改写的那几份 JSON（判据跟 apply 换文本的判据是同一句：文本里有带引号的
//     本地路径）⟹ apply 报的 changed 按构造是它的子集。worker 的「动手前必须干净」和回退都只管这几份 + 两样照片 ——
//     建站之后派生改写的 `site/<语言>/navigation.json`、新写出的 `site/custom.css` 不在里面，不挡路也不被回退冲掉（#1716 r2）。
//   node scripts/library-photos.js apply   （stdin：{"/photos/home-hero.jpg":"https://…", "/logo.png":"https://…"}）
//     stdout 一行：{"ok":true,"changed":["site/en/pages/home.json", …],"removed":["public/photos/home-hero.jpg", …]}
//
// 退出码：0 成功 · 5 参数或 stdin 的形状不对 · 7 拒收：要删的本地文件在站里还有别的引用（换不掉的那种），
//        stdout 打 {"ok":false,"message":"…"} —— 一个字节都不写，站停在原样。
//
// ── 换哪些：只换【整个字符串值】恰好等于本地路径的 ────────────────────────────────────────────────
// 🔴 「老板在这之前已经换掉的槽不动」靠的就是这条：他换过的槽，值已经是别的地址，跟本地路径不相等。
//    判据是 JSON 文本里带引号的 `"/photos/x.jpg"` 整段 —— JSON.stringify 不转义 `/`，所以一个值为
//    `/photos/x.jpg` 的字符串在文件里必然就是这一段。按文本换（不 parse 再 stringify），文件的缩进与键序一个字节不动；
//    换完再 JSON.parse 一遍，解析不了就当形状不对（exit 5）。
// 🔴 扫的是 `site/` 下**全部** .json，不只页面：服务清单、博客、seo.json 都可能带一张照片（gallery 复用服务页的图，#1594）。
//
// ── 删哪些：`public/photos/` 整个 + `public/logo.png` ──────────────────────────────────────────────
// 没被引用的照片（生成了、页面没用上）一起删 —— 它们在仓的历史里还在。删之前先查：要删的文件名还以本地路径的
// 样子出现在 `site/` 的任何文件里（博客正文里的 `<img src=\"/photos/x.jpg\">`、custom.css 的 `url(/photos/x.jpg)`
// —— 整值匹配换不到它们），就整个拒收（exit 7）。删了而引用还在 = 一张裂图，而且没人会知道。

const fs = require('fs');
const path = require('path');

const ROOT = process.cwd();
const SITE = path.join(ROOT, 'site');
const PHOTOS = path.join(ROOT, 'public', 'photos');
const LOGO = path.join(ROOT, 'public', 'logo.png');
const LOGO_REF = '/logo.png';
// 照片文件名：create-site 写的是 `<slotKey>.jpg`（`lib/image-slots.js`），slotKey 只有字母数字和 `-` `_`。
// 收紧到这个形状：一个带 `/` 或 `..` 的「文件名」不会被拼成路径。
const PHOTO_NAME_RE = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

function out(obj) {
  process.stdout.write(JSON.stringify(obj) + '\n');
}
function die(code, msg) {
  process.stderr.write(String(msg) + '\n');
  process.exit(code);
}

/** site/ 下的全部文件（相对 ROOT 的路径），按名排序。 */
function siteFiles() {
  const found = [];
  const walk = (dir) => {
    let entries;
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch (e) { return; }
    for (const e of entries) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) walk(p);
      else if (e.isFile()) found.push(path.relative(ROOT, p));
    }
  };
  walk(SITE);
  return found.sort();
}

/** 这个本地路径对应的磁盘文件（相对 ROOT）；不是我们管的形状 ⟹ null。 */
function localFileOf(ref) {
  if (ref === LOGO_REF) return 'public/logo.png';
  const m = /^\/photos\/([^/]+)$/.exec(ref);
  return m && PHOTO_NAME_RE.test(m[1]) ? `public/photos/${m[1]}` : null;
}

/** 一个 JSON 值里所有字符串（递归）。 */
function stringsIn(v, acc) {
  if (typeof v === 'string') acc.push(v);
  else if (Array.isArray(v)) v.forEach((x) => stringsIn(x, acc));
  else if (v && typeof v === 'object') Object.values(v).forEach((x) => stringsIn(x, acc));
  return acc;
}

function list() {
  const refs = new Set();
  for (const f of siteFiles().filter((p) => p.endsWith('.json'))) {
    let doc;
    try { doc = JSON.parse(fs.readFileSync(path.join(ROOT, f), 'utf8')); } catch (e) { continue; }
    for (const s of stringsIn(doc, [])) {
      const file = localFileOf(s);
      if (file && fs.existsSync(path.join(ROOT, file))) refs.add(s);
    }
  }
  const quoted = [...refs].map((ref) => JSON.stringify(ref));
  const touches = siteFiles().filter((p) => p.endsWith('.json'))
    .filter((f) => { const text = fs.readFileSync(path.join(ROOT, f), 'utf8'); return quoted.some((q) => text.includes(q)); });
  out({ ok: true, files: [...refs].sort().map((ref) => ({ ref, path: localFileOf(ref) })), touches });
}

/** 要删的本地文件（相对 ROOT）：public/photos/ 下的全部文件 + logo。 */
function filesToRemove() {
  const files = [];
  try {
    for (const e of fs.readdirSync(PHOTOS, { withFileTypes: true })) {
      if (e.isFile()) files.push(`public/photos/${e.name}`);
    }
  } catch (e) { /* 没有这个目录 */ }
  if (fs.existsSync(LOGO)) files.push('public/logo.png');
  return files.sort();
}

/** 本地路径（`/photos/x.jpg`、`/logo.png`）在一段文本里以「站内相对地址」的样子出现了吗。前面是引号、括号、`=`、
 *  空白或开头才算 —— `https://partner.example.com/logo.png` 里那个 `/logo.png` 前面是主机名，不是我们的文件。 */
function mentionsLocal(text, ref) {
  const esc = ref.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(^|["'(=\\s\\\\])${esc}(?![A-Za-z0-9._-])`).test(text);
}

function apply(raw) {
  let mapping;
  try { mapping = JSON.parse(raw); } catch (e) { die(5, `stdin is not JSON: ${e.message}`); }
  if (!mapping || typeof mapping !== 'object' || Array.isArray(mapping)) die(5, 'stdin must be an object { "<local path>": "<library url>" }');
  for (const [ref, url] of Object.entries(mapping)) {
    if (!localFileOf(ref)) die(5, `not a local photo path: ${JSON.stringify(ref)}`);
    if (typeof url !== 'string' || !/^https:\/\/[^/\s"]+\/\S+$/.test(url)) die(5, `not a library address for ${ref}: ${JSON.stringify(url)}`);
  }

  // 先在内存里换完、查完，最后才写盘 —— 拒收时一个字节都没动。
  const next = new Map(); // 相对路径 → 新文本
  for (const f of siteFiles().filter((p) => p.endsWith('.json'))) {
    const before = fs.readFileSync(path.join(ROOT, f), 'utf8');
    let after = before;
    for (const [ref, url] of Object.entries(mapping)) {
      after = after.split(JSON.stringify(ref)).join(JSON.stringify(url));
    }
    if (after === before) continue;
    try { JSON.parse(after); } catch (e) { die(5, `${f} would not parse after the change: ${e.message}`); }
    next.set(f, after);
  }

  const removed = filesToRemove();
  for (const f of siteFiles()) {
    const text = next.has(f) ? next.get(f) : fs.readFileSync(path.join(ROOT, f), 'utf8');
    for (const file of removed) {
      const ref = file === 'public/logo.png' ? LOGO_REF : `/${file.slice('public/'.length)}`;
      if (mentionsLocal(text, ref)) {
        out({ ok: false, message: `${f} still refers to ${ref} in a way this script does not rewrite — nothing was changed` });
        process.exit(7);
      }
    }
  }

  for (const [f, text] of next) fs.writeFileSync(path.join(ROOT, f), text);
  for (const f of removed) fs.rmSync(path.join(ROOT, f), { force: true });
  try { fs.rmdirSync(PHOTOS); } catch (e) { /* 不是空的或不存在 —— 都不要紧 */ }
  out({ ok: true, changed: [...next.keys()], removed });
}

if (require.main === module) {
  const mode = process.argv[2];
  if (mode === 'list') list();
  else if (mode === 'apply') apply(fs.readFileSync(0, 'utf8'));
  else die(5, 'usage: node scripts/library-photos.js list | apply < mapping.json');
}

module.exports = { localFileOf, mentionsLocal };
