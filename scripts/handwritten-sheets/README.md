# handwritten-sheets — 三份手写表（#991 阶段一的遗留）

`hero-media-left.css` / `hero-media-right.css` / `hero-media-top.css`。

## 它们不是主题表：我查过的 127 套注册表条目里，没有一套叫这三个名字

一个站只在「**文件名 == 主题 id**」时才会把一份表写进 `site/theme.json` —— 判据是
`scripts/theme-sheet.js` 的 `sheetNameForTheme()`：它拿主题 id 去 `public/themes/<id>.css` 找文件，
找不到就回空串（`create-site.js §main` 调它）。而注册表里这两批条目**实测 0 条**以 `hero-media-`
打头（2026-09-15 现取）：

```bash
$ node -e "const t=require('./scripts/themes.js');
    const f=x=>Object.keys(x).filter(n=>n.startsWith('hero-media-')).length;
    console.log('在用', Object.keys(t.themes).length, '命中', f(t.themes));
    console.log('退役', Object.keys(t.retiredThemes).length, '命中', f(t.retiredThemes));"
在用 2 命中 0
退役 125 命中 0
```

⟹ 这 127 套里没有一套穿得到这三份表。🔴 **这个读数会过期**（池子重新生成那天两个数都会变）—— 自己
重跑上面那条，别引用这里的 2 / 125。

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
