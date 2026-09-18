// ══════════════════════════════════════════════════════════════════════════════════════════════════
// frontmatter.js — `shape.md` 头上那一小段的读与写（#1387）
// ══════════════════════════════════════════════════════════════════════════════════════════════════
//
// 🔴 **单独一个文件，而且一个依赖都不许有。** 它本来写在 `build-blocks.js` 里，而那份 require 了
//    `postcss`（生成器要解析 CSS）。于是每一个只想读 manifest 的人 —— `scripts/lib/block-manifest.js`、
//    `scripts/blocks.js`，进而 `sync-config.js` —— 都被那条 require 拖着走，**在一棵没有
//    node_modules 的树里当场 `Cannot find module 'postcss'`**。实测：`lib/remediation.test.js` 的
//    ⑦b 造的临时树只拷 `scripts/`、软链 `blocks/`，sync-config 在第一行就死，而那一格读到的 rc 恰好
//    也是 1（它期望的就是 1），所以它不是当场红在「装不起来」上，是红在「诊断那句话不在」——
//    失败方向差一点就被读成别的毛病。
'use strict';

/**
 * frontmatter 只认这一个子集 —— 写它的也是我们自己：一次性的搬家脚本
 * `scripts/block-migration/to-folders.js`（`formatFrontmatter`），以及两处夹具
 * （`scripts/lib/block-shapes.test.js` 用同一个 `formatFrontmatter`；manager 的
 * `template_blocks_fixture_test.go` 自己拼同样几行）。现取：
 * 现取：`grep -rln formatFrontmatter templates/nextjs/scripts` 读 6 —— 本文件 + `build-blocks.js`
 * （它转出去）+ 上面那两个真写它的 + `region-layout.js` / `theme-pipeline/gates.js` 两处**注释里
 * 提到它**（那两处自己用窄正则读，理由写在它们各自那一段上）。
 *     key: 标量
 *     key:
 *       - 列表项
 *     key:
 *       子键: 标量
 * 判「是列表还是子对象」看缩进后的第一行是不是 `- ` 开头。不引第三方 YAML —— 模板今天没有这个依赖，
 * 而这几行是我们自己写出来的，形状是已知的。读到不认识的行就跳过（失败方向：那一项当没写）。
 */
function parseFrontmatter(text) {
  if (!text.startsWith('---\n')) return {};
  const end = text.indexOf('\n---', 3);
  if (end < 0) return {};
  const lines = text.slice(4, end + 1).split('\n').filter((l) => l.trim());

  const parseAt = (i, indent) => {
    const obj = {};
    while (i < lines.length) {
      const cur = lines[i];
      const ind = cur.length - cur.trimStart().length;
      if (ind < indent) break;
      const m = cur.trim().match(/^([A-Za-z0-9_]+):\s*(.*)$/);
      if (!m) { i += 1; continue; }
      const [, key, val] = m;
      if (val === '') {
        const nxt = lines[i + 1];
        const nInd = nxt ? nxt.length - nxt.trimStart().length : -1;
        if (nxt && nInd > ind && nxt.trim().startsWith('- ')) {
          const arr = [];
          i += 1;
          while (i < lines.length && lines[i].trim().startsWith('- ')
                 && lines[i].length - lines[i].trimStart().length > ind) {
            arr.push(coerce(lines[i].trim().slice(2).trim()));
            i += 1;
          }
          obj[key] = arr;
        } else if (nxt && nInd > ind) {
          const [child, next] = parseAt(i + 1, nInd);
          obj[key] = child;
          i = next;
        } else {
          obj[key] = {};
          i += 1;
        }
      } else {
        obj[key] = val === '[]' ? [] : coerce(val);
        i += 1;
      }
    }
    return [obj, i];
  };
  return parseAt(0, 0)[0];
}
function coerce(v) {
  if (v === 'true') return true;
  if (v === 'false') return false;
  if (/^-?\d+$/.test(v)) return Number(v);
  return v;
}


/** 反过来：把一个对象写成上面那个子集的 frontmatter（搬家脚本、promote.js、测试夹具共用一份）。 */
function formatFrontmatter(obj) {
  const lines = [];
  const emit = (k, v, indent) => {
    const pad = ' '.repeat(indent);
    if (Array.isArray(v)) {
      if (!v.length) { lines.push(`${pad}${k}: []`); return; }
      lines.push(`${pad}${k}:`);
      v.forEach((x) => lines.push(`${pad}  - ${x}`));
    } else if (v && typeof v === 'object') {
      lines.push(`${pad}${k}:`);
      Object.entries(v).forEach(([kk, vv]) => emit(kk, vv, indent + 2));
    } else {
      lines.push(`${pad}${k}: ${v}`);
    }
  };
  Object.entries(obj).forEach(([k, v]) => { if (v !== undefined) emit(k, v, 0); });
  return `---\n${lines.join('\n')}\n---\n`;
}

module.exports = { parseFrontmatter, coerce, formatFrontmatter };
