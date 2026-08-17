# 主题生成流水线（#1004）

生成一套候选主题 → 四道准入闸 → 进池。spec §4.9③ / §7.1。

```bash
cd templates/nextjs

# 生成候选（确定性，不调 AI，不花钱）
node scripts/theme-pipeline/generate.js --count 3 --out /tmp/cands

# 端到端跑一遍（需要 templates/nextjs/site/ 里有一个样例站）
# 🔴 #1061 —— 要出图（--gallery）的话，那个样例站还得有「每种块各一次」那一页，
#    否则图上只有首页和内页摆得出的那几种块，人审对其余的一概看不见。撑开它（不调 AI、不花钱）：
#      node scripts/theme-css-invariants-sample-pages.js "$PWD/site"
#    run.js 在建第一套站之前就先替你问一遍，没有就退 2。
# --gallery 给了就顺手拍图 + 出对照页，第四道闸（人审）要的就是那一页
node scripts/theme-pipeline/run.js --candidates /tmp/cands --port 18450 --gallery /tmp/gal
open /tmp/gal/public/index.html

# 行业覆盖度：每个行业关键词能匹配到几套主题
node scripts/theme-pipeline/coverage.js

# 一份表画到了几个钩子、几个块，每块画了多少（不用建站，改一行就能问一次）
node scripts/theme-pipeline/hook-coverage.js /tmp/cands/*.css

# 一份表自己画的字，压在它自己画的底上读不读得出来（同样不用建站）
node scripts/theme-pipeline/ink-contrast.js /tmp/cands/*.css
node scripts/theme-pipeline/ink-contrast.js --verbose /tmp/cands/gen-07-5.css   # 逐条列不达标的

# 配方本身的三条承重性质（跟着 `node scripts/run-script-tests.js` 一起跑）
node scripts/theme-pipeline/sheet-recipes.test.js

# 过完闸的候选 → 池成员（#1016）。这一步把候选的 `layout`（一个值）翻成 `supports`（一个清单），
# 补上 industries / label / style / sheet，并把每份表拷进 public/themes/
node scripts/theme-pipeline/promote.js --candidates /tmp/cands --out scripts/theme-pool.json
node scripts/theme-pipeline/promote.js --verify          # 只查，不写

# 池子自己的承重性质（覆盖度 · 词表不缩 · 旧池退役 · supports 翻译 · 表在不在）
node scripts/theme-pipeline/pool.test.js
```

## 一套候选的 CSS 是怎么出来的（#1051）

`generate.js` 出调色板、字体对和一组手感参数，表本身由 `sheet-recipes.js` 出，**34 个块全都画到**。
在 #1051 之前 `generate.js` 里是三段写死的 hero CSS，候选只画 hero 一个块（7/213 钩子 · 1/34 块）——
第②道闸会把「页面上出现、而这套主题自己表里没有规则」的钩子逐个点名，照那个跑一套都进不了池。

配方按**部件扮演的角色**出样式（标题拿字体/字号/字重，卡片拿内边距/圆角/表面色，徽标拿胶囊形状和
大写字距……），不是「每个钩子吐一条声明」。后者钩子和块当场全绿，而每块只有 213/34 ≈ 6 条声明，
60-80 套主题在 33 个块上仍然长得一模一样。`hook-coverage.js` 因此同时量**每块的声明数**，下限照三套
实证表定（min ≥ 11 · 中位 ≥ 28）。密度只是代理，不是「好看」的证明 —— 那一关是 #1016 的人审。

另外三条性质由 `sheet-recipes.test.js` 守着。它们在写出来之前都是坏的，**而且三条都不会让覆盖率
那把尺变红**（表照样生成、契约 lint rc=0、覆盖率照样 213/213）：

1. **`layout.json` 说的版式，产物里要真的看得出来。** r1 只分「是不是 text-only」，于是
   `with-media-left` 与 `with-media-top` 吐同一份 CSS —— 而第③道闸把版式当一整项（0.2 的权重），
   于是那道闸是靠一个产物里不存在的差别在给分。
2. **表本身不许有双胞胎。** r1 各档模数没错开，整份表的周期只有 36，跑 200 套只出 24 份不同的 CSS。
   🔴 第③道闸看不见这件事：它只读 tokens 和 layout，**一个字节的 CSS 都不读**。
3. **表画的字要读得出来。** r3 之前 `contact` / `figure` / `star` / `yes` 四个角色的字色是**写死的
   `accent-500`**，跟它压在什么底上无关。实测那批 80 套里 20 套的 `contact-info__phone` / `__email`
   落在 1.45–2.49:1，而第②道闸对 essential 块的下限是 2.5:1 ⟹ 候选当场被拦；同一个毛病还落在
   另外 8 个钩子上，只是那些块不是 essential，**闸看不见，客人一样读不出来**。
   现在字色由 `surfaceFor()` 按这套候选真实的调色板挑（见 `sheet-recipes.js` 的 §INK_FLOOR），
   判据是 `ink-contrast.js`——它只读产物 + 这套候选的 tokens，不 import 生成器的取色逻辑。
4. **挑出来的档位要在【站主换掉调色板之后】仍然成立**（#1016 r4）。表里存的是 token 名，而站主可以
   点一个配色预设（`theme-presets.js` 的 6 组把整组 `--color-*` 换掉）再拖色相滑块（`tweaks.js` 的
   `shiftHue`，±15°）—— 两件事都不改名字，于是「这个名字在这套调色板下够黑」这句保证被静默作废。
   实测只按自己的调色板挑时 `theme-presets.test.js` 报 **242 行破线**，其中 52 行就在色相 0°
   （只点一下配色、滑块都不用拖）。现在 `pickInk` 与「药丸自带底 + 底上的字」那一对**都**要过
   6 组预设 × 31 档色相。🔴 那两处是**两条独立的产生路径**：只扩 `pickInk` 时还剩 128 行破线，
   全部是 `.services-nav__link`（它走的是药丸那条路）。判据是 `theme-presets.test.js`。

🔴 **`sheet-recipes.js` 的 `sheetFor(i, seed)` 要跟 `generate.js` 用同一个 seed** —— 从 r4 起表里的
字色是按 `paletteFor(i, seed)` 挑的。seed 对不上 = 表按 A 的颜色挑、站里装的是 B 的颜色，那条对比度
保证当场作废，**而没有任何东西会为此报错**。调色板因此只有一个定义（`palette.js`），两边都从它取。

## 四道闸

| | 查什么 | 在哪儿 |
|---|---|---|
| ① 静态 | tokens 对 schema（#1003）· 受限 CSS 的选择器 / 属性 / 不许字面色值（`theme-css-lint.js`） | `gates.js` |
| ② 动态 | 样例站真构建 + 无头浏览器读五条不变量；**外加**「页面上的钩子在【这套主题自己那份】CSS 里有规则」 | `gates.js` |
| ③ 相似度 | 跟池里已有的比，**两条判据任一成立就打回**：① 颜色与字体逐字相同；② 可复算的距离 ≥0.9。详见下面《第③道闸怎么判》 | `gates.js` |
| | 🔴 **跟谁比**（#1016）：默认是今天的注册表；`run.js --pool new` 改成「跟这一轮自己长出来的新池比」——D3 说旧 30 套冻结退役，一套候选要不像的是**它将要加入的那个池**。第 1 套跟空池比（照 `gates.js` 的口径 = 通过），第 k 套跟前面已收下的 k-1 套比 | `run.js` |
| ④ 人审 | Chris 翻**这一轮候选自己的**对照页。**不自动化，也不假装自动化** —— 这一道返回 `pass: null`，报告里是 ⏸ 不是 ✅ | `gates.js` + `gallery.js` |

🔴 **第四道闸的图为什么不是跑 `scripts/theme-gallery/gallery.mjs`**：那一份出的是**注册表里那 30 套**的
图册（`gallery.mjs:12` 的 id 来自 `Object.keys(themes)`），而候选按 D3「新池重来」根本不进那张注册表。
照着它跑会真的出一本图册，里面一张候选都没有 —— 而翻图的人看不出来。所以候选的对照页由
`gallery.js` 自己出；它**复用** `theme-gallery/shoot.mjs`（一个字没改），图旁每一行读数都是那份脚本
从被拍的那张页面的 DOM 上读回来的。完整理由（含 A/B 两个接线形状为什么都不成立）写在 `gallery.js` 文件头。
每套候选三张图：首页 / 内页 / **全部块**（#1061 加的第三张 —— 前两页加起来只摆得出一小部分块，
不在那两页上的块，人翻多少套都看不见）。

## 第③道闸怎么判

**两条判据，任一成立就打回。**

### ① 颜色与字体逐字相同 ⟹ 直接判「几乎一样」，不看分数

Chris 2026-08-14 在 #1004 拍的板：「两套主题，颜色逐字相同、字体逐字相同，只有一个 block 的形态
不同 —— 算几乎一样。」

写成一条充分条件、而不是去调权重或降阈值，理由是这张票走过的四轮：**那道闸的分数上限被结构性地压在
阈值之下，而压它的是哪一项还会换** —— r3 是版式（上限 0.8000）、r4 是 settings（0.8500）。就算两项都
修好，一套颜色和字体照抄的克隆也只有 (0.45+0.2+0.15×0.40)/0.80 = **0.8875 < 0.9**；想靠权重满足拍板
那句话，就得让颜色+字体的分量压过其余全部，等于把另外两项废掉。充分条件不经过分母那套算术。

代价说在明处：这一条只咬**逐字相同**，差一个色阶的近似克隆仍然走下面那条分数。

### ② 可复算的距离 ≥ 0.9

颜色 45% / 字体 20% / settings 15% / 版式 20%。

🔴 **权重只算「能比的那几项」**，没法比的那项从分母里去掉，而不是当成 0 分 —— 当成 0 分时上限恰好
0.8 < 0.9，这道闸在真路径上永远不会开火（QA2 在 #1004 r2 量到 30 套克隆全放过）。

🔴 **版式那项「能不能比」判在【取值】上，不是【键在不在】上**：注册表 30 套的 `hero` 取值是
`split` / `centered` / … 9 个，生成器出的是 `with-media-left` / `with-media-top` / `text-only` 3 个，
两个词表交集为 0 而 30 套每套都有 `hero` 这个键 —— 按「键在不在」判就成了「能比且恒等于 0.00」，上限
又回到 0.8（QA1 在 #1004 r3 量到生成器形状的克隆 0/30 全放过）。所以问的是「候选这个取值在池子里
出现过吗」：出现过才比，没出现过判「没法比」。等新池里有主题也用同一套词，那个键自己变回能比的。

🔴 **settings 那一项比的是【翻译之后的 CSS 变量值】**，不是字面值。生成器产数值形状（`radius: 4`）、
池里 30 套是枚举形状（`radius: "subtle"`）—— `"subtle"` 和 `4` 不是「不同」，是**不可比**。按字面比时
这一项结构性地只能是 0 或 0.2，把上限钉死在 0.8500（QA2 在 #1004 r4 量的）。现在两边都用产品自己
那份 `settingsToCssVars` 翻成 CSS 变量、单位归一（1rem = 16px）再比：

```
枚举 radius:"subtle" → --radius-lg: 0.5rem → 8px      数值 radius:4 → --radius-lg: 8px
⟹ 圆角五档逐个相同、阴影(0.1 vs 0.08)和留白(4rem vs 3.6rem)不同 ⟹ 0.40，一个真读数
```

翻译器住在 `src/lib/themeSettings.ts`，闸是 CommonJS 脚本请不动 `.ts` ⟹ `settings-vars.mjs` 起一个
子进程把它 import 进来。**不在闸里抄第二份档位表**：抄了必然分叉，而分叉的方向是「闸算的像不像」跟
「站上真正长什么样」对不上，静默。#1002 把 `settingsToCssVars` 搬进 `scripts/` 之后这座桥可以拆掉。
请不动翻译器时这一项判「没法比」（分数只会变高、更容易拦），**并把那句话写进读数旁边** —— 静默少
一维正是这道闸前四轮反复栽的坑。

报告里逐项打印分解，不用谁再手算一次。

🔴 **②里那条自查为什么必须读「主题自己那份表」**：产物里的 CSS 不止一份。`base.css`（#1001）和站
自己的 Tailwind 产物都会给同一批钩子写规则，所以「每个 class 都有规则」这条在「主题整块没写」时
照样绿 —— 那种主题装上去，每个站的那几块长得一模一样。#996 正在把那条不变量收窄成同一个口径，
本流水线不等它，自己实现了一份。

## 覆盖度那两个数

```
候选池大小   candidateThemesForIndustry() 最后给几套 —— 带兜底,永远 ≥ MIN_ROTATION_POOL(3)
真命中       有几套主题的 industries 里写了这个词 —— 没有兜底,分布从 1 起步
```

只报前者的话，薄格子会全部显示成健康的「3 套」。**#1016 跑完这条流水线之后**（`coverage.js` 量的是
`poolThemes`，也就是新建网站挑得到的那一池）：

```
80 套 · 212 个去重关键词（含重复 980）
候选池 {4:73, 5:123, 8:3, 9:11, 10:2}
真命中 {4:73, 5:123, 8:3, 9:11, 10:2}      ← 兜底一次都没开火，两份分布因此逐字相同
```

📌 **#1016 之前**（手写的那 30 套，现在冻结退役在 `scripts/themes-retired.js`）是这样，留着当对照：

```
30 套 · 212 个去重关键词（含重复 389）
候选池 {3:175, 4:18, 5:9, 6:9, 7:1}
真命中 {1:113, 2:35, 3:27, 4:18, 5:9, 6:9, 7:1}
```

`--max-thin-pools 0 --max-thin-hits 0` 是 #1016 AC2 的判据：两个薄格子都要为 0 才 rc=0。

## 池子长什么样（#1016）

| 文件 | 是什么 |
|---|---|
| `scripts/theme-pool.json` | 新建网站**挑得到**的那一池，80 套。`promote.js` 写出来的 |
| `scripts/themes-retired.js` | #924~#961 手写的 30 套，spec D3 冻结退役：新站抽不到，但一个字都不许删（线上每个站的 `theme.json` 写的都是这 30 个里的某个 id） |
| `scripts/theme-pipeline/industry-sectors.js` | 16 个行业组 × 5 个位子 = 80 个池位子。哪一套皮为哪些生意做的，在这里定 |
| `public/themes/<id>.css` | 每套自己那份表。阶段 2 之后 34 个块的外观都住在这儿 |

🔴 `themes.js` 导出的 `themes` 是**两者的并集** —— 「按 id 查得到」（sync-config 的 applied 分支、
`themeStyle` / `layoutFor` / `settingsFor`、换主题对话框）必须包含退役那 30 套，否则穿着它们的站
建不出来。而**挑**那条路（`candidateThemesForIndustry`）只走 `poolThemes`。两件事，别合并。

## 生成器是确定性的，不是 AI

本票要建的是**流水线**（生成器 + 四道闸 + 图册），它「只依赖契约的格式，不依赖最终内容」。
确定性生成器让四道闸的每一格都能被同一个输入反复驱动，也让这条链在 CI 里跑得动。
换成 AI 生成器时，**只有 `generate.js` 被换掉** —— 闸和报告一行都不用动。
