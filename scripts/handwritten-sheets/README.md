# handwritten-sheets — 三份手写表（#991 阶段一的遗留）

`hero-media-left.css` / `hero-media-right.css` / `hero-media-top.css`。

## 它们不是主题表，而且从来没有站穿过

一个站只在「**文件名 == 主题 id**」时才会把一份表写进 `site/theme.json`
（`scripts/theme-sheet.js:37-41`，判据是 `create-site.js §main` → 那个函数）。注册表里从来没有任何一套
主题叫 `hero-media-*`（`themes.js` 在用的 2 套、`themes-retired.js` 退役的 125 套，以这三个名字打头的
各 **0** 个）⟹ **没有任何站到得了它们**。

## 它们今天唯一的用处：对比度语料

`scripts/theme-presets.test.js` 第 ⑨ / ⑩ 节拿它们当「一张没有自己配色的表 × 每一套配色 × 色相滑块
31 档」的样本 —— 那个问题只有对「没有自己配色的表」才成立，池里那些**为自己那套配色生成的**表配上
别人的配色是任何客户都做不出来的组合（#1016 r4 的裁定）。所以这三份留着，而且那两节仍然逐张判它们。

## 为什么 2026-09-15 从 `public/themes/` 搬到这里（#1318）

契约 v3 把几何那一族从主题可写属性表里拿掉了，这三份表里的排版跟着删掉（删、不搬：没有站穿得到
它们，删掉页面不变一个像素）。删完之后 `hero-media-left` / `-right` 的 `.hero__body` 和三份的
`.cta-banner__action` **整条只剩几何**，规则跟着消失 ⟹ `theme-css-invariants.mjs` 的第 ⑤ 条
（「这张表给页面上每个钩子出过规则吗」）当场点名，三份全红。

那条检查问的是「**一个站穿着这张表时，主题有没有漏画某个钩子**」—— 对一张没有站穿得到的表，这个
问题本身就不成立。#1318 的 AC1 写死了处置：**不许给检查器开白名单**，改走第二档 —— 把它们挪出
`public/themes/`。挪出去之后 `css-contract-check.js`（readdir `public/themes/`）和
`theme-css-invariants-all-sheets.sh`（同一个目录）都不再把它们当主题表判，而
`theme-presets.test.js` 那两节照旧逐张判它们（那两节从**两个目录的并集**取表，所以搬迁前后它们判的
是同一份清单）。

🔴 **别把它们搬回 `public/themes/`。** 那个目录的语义是「一个站可能穿上的表」，而它们不是；搬回去
会让上面那条 ⑤ 立刻再红一次，而红的原因跟主题质量无关。
