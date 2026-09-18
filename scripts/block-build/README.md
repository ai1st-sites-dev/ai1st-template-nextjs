# `scripts/block-build/` — 区块库的生成器（#1387，设计文档 D20）

一个块一个文件夹，一个形态一个子文件夹：

```
blocks/hero/
  manifest.json           槽位 / 行业 / displayName / 是不是外壳区 —— 🔴 没有 shapes 这个键
  Section.tsx             这个块唯一的 HTML
  floor.css               这个块在 public/base.css 里的那一段（地板）
  block.css               这个块跨形态的几何（可选；今天 9 个块有）
  media-cover/
    shape.css             这一种形态的几何
    shape.md              说明；frontmatter 里是 order / needs / candidate / source / layout_intent
```

三份生成物由 `build-blocks.js` 从这些文件夹拼出来，**都进 git**：

| 生成物 | 拼法 |
|---|---|
| `public/shapes.css` | `shapes-head.css` + 每个块（`block.css` 在前、各形态 `shape.css` 在后） |
| `public/base.css` | `base-head.css` + 每个块的 `floor.css` |
| `src/lib/sections/registry.generated.ts` | 每个**非外壳区**的块一行 `'<块>': <组件>` |

顺序是确定的，而且从文件夹派生：块按文件夹名字典序（外壳区殿后），形态按 `shape.md` 的 `order`
（没写就按子文件夹名）。**生成器不读任何清单文件** —— 现取：
`grep -c "readFileSync\|readdirSync" scripts/block-build/build-blocks.js` 读 6，逐处看过去都落在
`blocks/` 与本目录的两份文件头上（`ls scripts/block-build/*.css` 读 2）。

## 怎么改

```bash
# 改完 blocks/ 下的任何东西，跑一次
node scripts/block-build/build-blocks.js

# 只想知道盘上那份跟 blocks/ 对不对得上
node scripts/block-build/build-blocks.js --check
```

- **加一个形态**：新建 `blocks/<块>/<形态名>/`，放 `shape.css` + `shape.md`，跑生成器。不改任何清单。
- **加一个块**：新建 `blocks/<块>/`，放 `manifest.json` + `Section.tsx` + `floor.css` + 至少一个形态子文件夹，跑生成器。

## 为什么生成物进 git

读这三份的人里有一多半根本不构建：`scripts/lib/block-manifest.js`、`scripts/theme-css-lint.js`、
`scripts/css-contract-check.js` 直接读 `public/*.css`，manager 的 admin 区块页读模板目录，
dashboard 的 vite 插件也读它。生成物不在盘上时这些人拿到的是「文件不存在」——而那个方向是静默的。
代价是「改了块要记得跑生成器」，而那件事由 `generated-fresh.test.js` 当场点名
（`npm run test:scripts` 按文件名发现它）。

## 两道自检，和它们各自挡什么

1. `build-blocks.js` §assertPieceOwnsItsRules —— 每个零件里的每条规则，选择器都要指着它自己那个块
   （形态零件还要指着它自己那个形态），两份文件头里一条规则都不许有。
   🔴 它挡的是一个真出现过的失败：注释里写一条带通配的示例命令（星号紧跟斜杠）会把 CSS 块注释**提前
   关掉**，后面几十行注释被解析成一条选择器 —— 文件仍是合法 CSS、构建仍是绿的。
2. `generated-fresh.test.js` —— 盘上那三份 == 现在拼出来的那份，并且自带一个反向对照（往副本里丢一个
   新形态、不跑生成器，`--check` 必须红并点名）。

`css-split.js` 只被一次性的搬家脚本（`scripts/block-migration/to-folders.js`）用，生成器不用它。
