# 块搬迁用的夹具与尺子（#1008 那一套，#1020 收进仓库）

阶段 2 还有 31 个 block 要从「组件里的 variant 分支」搬成「CSS 里的 block_layout 规则」。每一张搬迁票
都要回答同样两个问题 —— **别的 block 有没有被误伤**、**三套表画不画得出三个样** —— 所以量它们的尺子
只该有一份。#998 r1 定下这个比较方法、QA 认可过，#1008 第一次用它。

> **为什么这些脚本在仓库里而夹具本身不在**：夹具是 `site/` 底下的一堆 JSON，而 `site/` 被
> `templates/nextjs/.gitignore` 忽略。所以能留住的是**造夹具的脚本**，页面每次现造。
>
> **为什么从 worktree 搬进来（#1020）**：这套东西原来只存在于 `/root/wt/1008/scratch/`，
> 而 `git worktree remove` 一跑它就没了。31 张票的验收标准里写着「夹具用 #1008 那个生成器，不许重造」——
> 重造的代价不是多花一次时间，是**两张票的「其余 33 个 block 逐字节不变」不再是同一句话**。

## 这里有什么

| 文件 | 干什么 |
|---|---|
| `gen-allblocks.js` | 造 `site/en/pages/allblocks.json` —— 34 种 block 每种一节。data 是**从每个组件自己的 props 类型现读出来**再合成的（`items` 在一处是 `string[]`、另一处是对象数组，一份通用 data 服务不了；命名 interface 如 `TeamMember[]` 也会展开）。**在 `templates/nextjs/` 下跑** |
| `dom-compare.py` | 「别的 block 没被误伤」的尺子（#1008 的 AC6）：剔掉 Next 自己的 script/preload 和资源哈希 → 把 hero 那一节整个摘掉 → 剩下的逐字节比两臂 |
| `ac4-compare.py` | 「三套表画得出三个样」第一半（#1008 的 AC4）：三臂 HTML 逐字节比。buildId 按**每臂实测到的那个字符串**整串替换，不用「看起来像 id 的正则」 |
| `geo.js` | 同上第二半：各臂取 `.hero__media` / `.hero__body` 的 `getBoundingClientRect()`（1280×900） |
| `ac3.js` · `ac3-wrap.js` | 「没有主题表时不塌」的四个读数（桌面 1280 + 手机 375），以及长词那条在两个宽度上的对照 |
| `paths.js` | 上面三个用浏览器的脚本从这里取 playwright。**它是这次搬家唯一改过的东西** —— 原来三个文件各自写死 `/root/wt/1008/tests/e2e/node_modules/playwright-core`。要指别处就设 `PLAYWRIGHT_CORE_MODULE` |

## 怎么把夹具重建出来

```bash
cd templates/nextjs
cp -r <任何一个站的 site 目录> .            # 例如 /root/wt/1003/templates/nextjs/site
node scripts/block-migration/gen-allblocks.js   # 写出 allblocks.json（34 种 block）
```

🔴 **`service-related-pages` 在没有子页面时 `return null`，要补两个才让它上场：**
`site/en/pages/services-alpha.json` 与 `services-beta.json`，**slug 写成 `services/alpha` · `services/beta`**，
并把 `allblocks.json` 里 `service-related-pages` 的 `data.serviceSlug` 设成 `"services"`。
不补的话它整节不渲染，而 `allblocks.json` 里照样有它 —— 「34 种都在页面上」这句话就是假的。

🔴 **`ac3.js` / `ac3-wrap.js` 要的是一张【只有一个 hero】的页面，而上面这几步不会造出它。**
补 `site/en/pages/ac3.json`（`slug` 写 `"ac3"`，`sections` 里只放一节 `hero`，headline 里塞一个
**一个连字符都没有**的长词 —— 带连字符的词浏览器本来就能断行，那条对照臂什么都证不了）。
判据：加了它之后产物是 **22** 份 HTML（`ac3.html` + `en/ac3.html`），不加是 20 份。#1008 交付里
那个「22 个 HTML 文件」就是这么来的，而 #1020 照旧步骤重建只得到 20，直到补上这一页。

```bash
npm run build          # 产物在 out/<站名>/
```

## 取读数时的三个坑

🔴 **起本地服务器之前先确认端口是空的。** 这台机器上同时跑着别的 agent。#1008 第一次量对照臂时
`python3 -m http.server 18962` 因为**端口已被别人占用**而启动失败，而那个端口上**确实有人在响应** ——
于是他拿别人的页面量了一次（`/ac3.html` 在那台服务器上是 404、`.hero` 是 null，脚本崩了才暴露）。
做法：让内核分配端口（`socket.bind(('127.0.0.1', 0))` 或 python 里 `TCPServer(('127.0.0.1', 0), …)`），
起完**先 curl 一次确认 200**，并且把服务的字节跟磁盘上的 md5 对一次，再取读数。

🔴 **`buildId` 按每臂实测到的那个字符串整串替换，不要用正则去匹「看起来像 id 的东西」** ——
那种写法会顺手抹掉别的东西，于是两臂被抹平成一样，比较器报绿而它什么都没比。`ac4-compare.py`
已经是这么做的（它自己去产物目录里读出这一臂真实的 buildId），别在调用方另写一份。

🔴 **`top` 那一臂 `.hero__body` 的宽度是【字体】决定的，不是布局决定的。** #1020 实测：同一份产物，
字体真加载时 body = `(436, 472, 407)`，把 `fonts.gstatic.com` 拦掉时 body = `(416, 472, 448)` ——
而 `.hero__media` 两次都是 `(0, 76, 1280)`。#1008 交付里 top 臂的 body 记的是 `(416, 472, 448)`，
它自己也写了「那次有一个谷歌字体 woff2 404」。**判决要归 `.hero__media`**（media 在左 / 在右 / 在上方
是 grid 列决定的，跟字体无关）；引用 body 的数字时必须同时说清那次字体加载上了没有。

## 跟别的目录的关系

`scripts/theme-gallery/`（截图与主题走查）和 `scripts/theme-pipeline/`（造主题）是同族的两个目录。
`theme-gallery/paths.mjs` 是 `paths.js` 的 ESM 兄弟 —— 它存在的理由跟这里一模一样：
#932 那批脚本各自写死了一个 ticket 的临时工作目录，于是只在一台机器的一个会被清掉的目录里能跑。
