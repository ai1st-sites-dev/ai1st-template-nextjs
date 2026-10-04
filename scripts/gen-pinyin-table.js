#!/usr/bin/env node
// #1550 —— 由 Unicode Unihan 数据库重新生成 `scripts/lib/pinyin-table.js`（汉字 → 不带声调的拼音）。
//
// 用法（数据不随仓带，要重生成时自己去取）：
//   curl -sSO https://www.unicode.org/Public/UCD/latest/ucd/Unihan.zip && unzip Unihan.zip Unihan_Readings.txt
//   node scripts/gen-pinyin-table.js Unihan_Readings.txt > scripts/lib/pinyin-table.js
//
// 取法：每个字取 `kMandarin` 的第一个读音（Unihan 把最常用的读音排在第一个），去掉声调；`ü` 写成 `v`
// （拼音输入法和网址里的通行写法：绿 lǜ → lv，免得女 nǚ 跟奴 nú 撞成同一个 nu）。范围是 CJK 统一汉字
// 基本区 U+4E00–U+9FFF 加扩展 A 区 U+3400–U+4DBF；不在这两段里的字由 `keyword-slug.js` 当「表里没有」处理。
'use strict';

const fs = require('fs');

const src = process.argv[2];
if (!src) {
  console.error('用法：node scripts/gen-pinyin-table.js <Unihan_Readings.txt>');
  process.exit(2);
}
const text = fs.readFileSync(src, 'utf8');
const version = (text.match(/^# Unicode Version ([\d.]+)/m) || [])[1] || '?';
const date = (text.match(/^# Date: (.+)$/m) || [])[1] || '?';

const inRange = (cp) => (cp >= 0x4e00 && cp <= 0x9fff) || (cp >= 0x3400 && cp <= 0x4dbf);
const bySyllable = new Map();
let n = 0;
for (const line of text.split('\n')) {
  const m = line.match(/^U\+([0-9A-F]+)\tkMandarin\t(\S+)/);
  if (!m) continue;
  const cp = parseInt(m[1], 16);
  if (!inRange(cp)) continue;
  const syl = m[2].normalize('NFD').replace(/ü/g, 'v').replace(/[̀-ͯ]/g, '').toLowerCase();
  if (!/^[a-z]+$/.test(syl)) continue;
  bySyllable.set(syl, (bySyllable.get(syl) || '') + String.fromCodePoint(cp));
  n += 1;
}

const keys = [...bySyllable.keys()].sort();
const out = [];
out.push('// ⚠️ 生成的文件，别手改 —— 重生成：`node scripts/gen-pinyin-table.js Unihan_Readings.txt > scripts/lib/pinyin-table.js`');
out.push('//');
out.push('// #1550 —— 汉字 → 不带声调的拼音（关键词页 slug 的转写用，`keyword-slug.js`）。');
out.push(`// 来源：Unicode Unihan 数据库 Unihan_Readings.txt 的 kMandarin 字段（Unicode ${version}，${date}），每字取第一个读音。`);
out.push('// 许可证：Unicode License v3（https://www.unicode.org/license.txt，数据文件条款见 https://www.unicode.org/terms_of_use.html）——');
out.push('//   允许复制、修改、再分发，要求保留版权声明：© Unicode, Inc. Unicode and the Unicode Logo are registered trademarks of Unicode, Inc.');
out.push(`// 覆盖：CJK 统一汉字基本区 + 扩展 A 区，${n} 字 / ${keys.length} 个音节。格式：音节 → 读这个音的全部汉字。`);
out.push("'use strict';");
out.push('');
out.push('module.exports = {');
for (const k of keys) out.push(`  ${k}: '${bySyllable.get(k)}',`);
out.push('};');
process.stdout.write(out.join('\n') + '\n');
