#!/usr/bin/env node
// SiteAsData 夹具：把一个站的 `site/` 目录导成「库里一行 JSON」的形状，或者反过来把 JSON 铺回目录。
//
// 形状（设计文档 2026-10-13-one-template-platform-design.md §4.1）：
//   键 = site/ 下的相对路径（`brand.json`、`en/pages/home.json`、`custom.css` …）
//   值 = JSON 文件存解析后的对象，其它文本文件（txt / css / md）存字符串
//
//   node export-site-json.js to-json   <site 目录> <输出 .json>
//   node export-site-json.js to-dir    <输入 .json> <site 目录>
//
// 两个夹具 `site-0448c807.json`（SparkleClean，单语）、`site-bbc4ff97.json`（Petal & Bloom，单语）
// 是 2026-10-12 spike 用的两个真站，T1d / T2a / T2b 的验收都拿它们当夹具；多语言 / 博客 / RTL 三个夹具由 T2a-3 #1804 补（`make-fixture.sh`，一条命令可复现）。
// 🔴 往返必须无损：`to-json` 再 `to-dir` 出来的目录跟原目录逐文件相同（JSON 文件按 2 空格缩进 + 末尾换行比）。
const fs = require('fs');
const path = require('path');

const [cmd, a, b] = process.argv.slice(2);
if (!cmd || !a || !b) {
  console.error('usage: export-site-json.js to-json <siteDir> <out.json> | to-dir <in.json> <siteDir>');
  process.exit(2);
}

function walk(root, rel = '', out = {}) {
  for (const e of fs.readdirSync(path.join(root, rel), { withFileTypes: true })) {
    const r = rel ? `${rel}/${e.name}` : e.name;
    if (e.isDirectory()) walk(root, r, out);
    else {
      const text = fs.readFileSync(path.join(root, r), 'utf-8');
      out[r] = r.endsWith('.json') ? JSON.parse(text) : text;
    }
  }
  return out;
}

if (cmd === 'to-json') {
  const content = walk(path.resolve(a));
  const sorted = Object.fromEntries(Object.keys(content).sort().map((k) => [k, content[k]]));
  fs.writeFileSync(b, JSON.stringify(sorted, null, 2) + '\n');
  console.log(`${b}: ${Object.keys(sorted).length} files`);
} else if (cmd === 'to-dir') {
  const content = JSON.parse(fs.readFileSync(a, 'utf-8'));
  for (const [rel, value] of Object.entries(content)) {
    const f = path.join(path.resolve(b), rel);
    fs.mkdirSync(path.dirname(f), { recursive: true });
    fs.writeFileSync(f, rel.endsWith('.json') ? JSON.stringify(value, null, 2) + '\n' : value);
  }
  console.log(`${b}: ${Object.keys(content).length} files`);
} else {
  console.error(`unknown command: ${cmd}`);
  process.exit(2);
}
