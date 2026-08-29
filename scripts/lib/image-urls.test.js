#!/usr/bin/env node
/**
 * image-urls.test.js — #1195：图片这一族的两件事，各一道守卫。
 *
 *   node scripts/lib/image-urls.test.js      （由 `npm run test:scripts` 自动发现）
 *   退出码: 0 全过 · 1 有失败 · 2 跑不起来（**不许当成通过**）
 *
 * ══ 一、`lib/image-urls.js` 的判据本身 ═════════════════════════════════════════════════════════
 * 「这个图片地址是谁给的」四类来源、以及拒绝的那一句话。两向都测：给过的要放行，编出来的要拒。
 *
 * ══ 二、提示词里那份【手抄的】图片字段清单 vs 模板真的画出来的 ═══════════════════════════════
 * `edit-site.js` 的 SYSTEM_PROMPT 里有一段 `## Images`，逐项点名「哪些字段会变成 <img src>」。
 * 那是**人手抄的**，跟 `Available section types:` 那一行同一个毛病（#1171 已经给那一行装了守卫）。
 * 两个方向坏起来都是静默的：
 *   · 清单里有模板**不画**的字段/块 ⟹ 模型把地址写进去，落盘、构建绿、老板收到「已完成」，
 *     而站上那张图根本不存在 —— 正是 #1195 起因的形状；
 *   · 模板画了、清单**没写** ⟹ 模型从不知道那个位置能放图，老板永远换不了那张图，没有任何红。
 * 🔴 所以判的是**两个方向**，不是「清单里写的都存在」。
 *
 * 🔴 而且它同时是 `lib/image-urls.js` 里 `IMAGE_FIELDS` 那张清单的守卫：那道写入闸只认这两个字段名，
 *    模板要是哪天多了第三个（比如 `backgroundUrl`），闸对它按构造失明 —— 这里当场红。
 *
 * 🔴 分母先自检再判：抠不到 `## Images` 那一段、或者从模板里一个 <img> 都没抠出来 ⟹ exit 2，
 *    不是通过。「什么都没量到」和「量过且相等」在一个只打 ✅ 的实现里长得一模一样。
 */

'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawnSync } = require('child_process');

// ── #1219 监工：给每一次尝试一个硬死线，到点就杀、换一个新进程重来 ─────────────────────────────
//
// 治的是什么：这份文件偶尔要跑 **510 秒**而不是 15 秒，而且跑完仍然全绿。CI 的 `template-scripts`
// 那个 job 超时 900 秒、今天最长的一次成功跑 440 秒（现取方法写在 ci-cd.yml 那个 job 自己的注释里）
// ⟹ 余量 460 秒 < 510 秒。也就是它只要在 CI 上发生一次，那个 job 就超时变红，而读起来像「有测试
// 挂了」，其实什么都没挂（那一跑自己报的是全过）。🔴 这里**不写**格子数：它随每一张往这份文件加刀
// 的票一起涨，r1 写 421、合并到今天的 main（#1223 又加了刀）之后跑出来是 468。要这个数就自己跑一次
// 看它最后那行。
//
// 🔴 量到哪一步（#1219）：
//   · 慢的是**某几条曲线的采样**，同一跑里其余部分照常。三档一起慢 **317 倍**（8.3s / 32s / 124s，
//     正常 26ms / 100ms / 420ms），而三档之间的**倍数没变**（3.87 / 3.89，正常 3.85 / 4.2）——
//     不是活变多了，是同样的活每字节变慢了。
//   · **不是 V8 的哪个原语变慢了。** 在每次采样旁边放两个旁路探针，在那个 124 秒的采样【进行当中】
//     读到：880KB 串 `toLowerCase` = 0.66 毫秒 · 880KB 串单字符 `indexOf`（找不到，整串扫一遍）
//     = 0.045 毫秒 · **跟被测同一种形状**的 880KB 串同样的 `indexOf` = 0.094 毫秒 —— 三个都正常。
//     #1208 留的那个「SlicedString / ConsString 表示差异」的猜测被第三个探针否掉了：同形状、同长度、
//     同一个进程、同一时刻，它快得很。
//   · 也不是被别人抢 CPU（99.6% 在转）· 不是内存压力 · 不是透明大页的直接规整（AnonHugePages = 0，
//     慢窗口 20 秒里全机 compact_stall 增量 0）。
//   · **根因没有定住。** 掉进去的进程一直待在里面，而同一时刻它的兄弟进程、以及之后新起的进程多半
//     是正常的。顺序跑也会中（15 跑里 2 跑）—— #1208 记的「顺序 10 跑没中过」今天不成立了。
//
// 🔴 **为什么护栏只能在【外面】。** 我先做过一版「在进程里量：一次采样超 3 秒 / 整份超 60 秒就换
//    进程」，它把最慢一次从 510 秒压到了 39 秒。但那一版要在 `curve()` 与 `perCall()` 里插计时 ——
//    而那两个函数正是这份文件用来读速度的地方。实测代价：合并形态 169 跑里出了 3 次
//    `这条曲线不成立`（某一档比前一档还快 = 没热到稳定态）的自检报错，干净 origin/main 同样条件
//    103 跑 0 次。数字不足以定论，但**方向是错的**：一道护栏不该去动它所保护的那个读数。
//    所以改成只在外面拿表 —— 被测的那份代码一个字节都不动。
// 🔴 顺带，这也是唯一能打断**一次**慢调用的办法：单独一次 `extractHtmlImageUrls` 在降速态下实测
//    128.9 秒，任何「两次调用之间」的检查都压不到这个数以下。
//
// 🔴 死线 40 秒的出处：这份文件正常整跑 **CI 上 14.8 秒**（2026-08-27 从 run 33094935163 的 job
//    日志逐行时间戳算的：`── lib/image-urls.test.js` 那一行到下一个测试文件那一行）、这台机器
//    12~24 秒（4 并发下 143 跑的最慢一次 24.0）。40 秒是最慢那个合法读数的 1.7 倍。
//    **这个数会随着往这份文件里加刀而变紧，改它之前自己重量一次，别抄。**
// 🔴 最后一次**不设死线**：一台真的比这里慢好几倍的机器，前几次会被杀光，而那时正确答案是
//    「让它跑完」，不是报一个假的失败。代价说在明处：那一次回到无上界（最坏 ~510 秒），而屏幕上
//    有监工的话说清楚了发生过什么。
// 🔴 两个环境变量的**性质不一样**，别当成一对旋钮（r2 改的就是这句话 —— 上一版写的是「两个都
//    只能调紧、不能放松」，两个方向我都试过，那句话是假的）：
//    · `IMGURL_ATTEMPT_DEADLINE_MS` —— 死线。**只收正整数毫秒，而且只能调得更短**（`Math.min`）；
//      负数 / 0 / 小数 / 非数字 / 无穷 一律落回默认。🔴 这不是防呆，是防**本票要消掉的那种假红**：
//      `spawnSync` 的 `timeout` 只接受非负整数，`-1` 和 `1.5` 都抛未捕获的 `ERR_OUT_OF_RANGE`
//      ⟹ rc=1 ⟹ `npm run test:scripts` 的 runner 把它读成「❌ 有测试挂了」，而这份文件一格都没挂。
//      两个值都是实测的（`-1` 是 PM 在 r1 验收里量到的，`1.5` 是 r2 逐值试出来的第二个）。
//    · `IMGURL_TEST_SUPERVISED_1219` —— **不是旋钮**，是监工告诉子进程「你就是被监工的那个」的暗号。
//      从外面设上它 = **整个关掉这道护栏**，回到没有监工的样子。它留着是因为反向对照要用它
//      （把护栏关掉、造出超标条件的那一格）。所以：它**能**放松，而那正是它的用途。
//
// 🔴 监工被**裸 kill** 时会留下孤儿 —— 边界写在这里，本轮**没有改这个行为**（QA3 #2）：
//    `kill <监工 pid>` 只打监工一个进程，干活那个子进程会被重新挂到 init 上继续跑（r2 复现：
//    子进程 `ppid→1`、96.2% CPU、一直跑到自己结束；监工自己 rc=143）。而 `timeout`、Ctrl-C、
//    CI 取消 job 走的都是**整个进程组**，所以那三条路都不中招（QA3 逐条驱动过）。
//    三条「显然的修法」我都量过或推过，**都更坏**：
//      ① 在监工里 `process.on('SIGTERM')` —— `spawnSync` 把事件循环整个堵死。r2 实测：发了信号之后
//         监工**既不死也不执行回调**，spawnSync 照样跑满 5.05 秒才返回，进程最后 rc=0 ——
//         也就是「裸 kill」从「留个孤儿」变成「按下去完全没反应」。
//      ② `detached: true` 把子进程放进**新的**进程组 —— 那会把上面那三条今天好用的路一起打断。
//      ③ 让子进程自己盯 `ppid` —— 那个定时器住在**被测的那个进程**里，而这道护栏的整个设计前提
//         就是不进那个进程（见上面那段）；何况慢档里那一次调用是同步的，定时器在窗口内根本不会跑。
const SUPERVISOR_ENV = 'IMGURL_TEST_SUPERVISED_1219';
const ATTEMPT_DEADLINE_DEFAULT_MS = 40000;
// 只收正整数毫秒、且只能调得更短；别的一律落回默认（理由见上面那条 🔴）。
// `Number.isSafeInteger` 这一关把非数字 / 空串 / 无穷 / **小数** / 超出安全范围的整数一起挡掉；
// `> 0` 挡掉负数与 0。
// 🔴 这里**不许**先 `Math.floor` 再判（r2 自己踩过，PM 退回的正是同一族毛病）：floor 之后 `1.5`
//    变成 `1`，于是文件头那句「小数落回默认」成了假话，而实际行为是死线被设成 1 毫秒 —— 每次都
//    到点、连杀两次、第三次不设死线跑完。屏幕上很吵，而设它的人以为自己被无视了。
const attemptDeadlineWanted = Number(process.env.IMGURL_ATTEMPT_DEADLINE_MS);
const ATTEMPT_DEADLINE_MS =
  Number.isSafeInteger(attemptDeadlineWanted) && attemptDeadlineWanted > 0
    ? Math.min(ATTEMPT_DEADLINE_DEFAULT_MS, attemptDeadlineWanted)
    : ATTEMPT_DEADLINE_DEFAULT_MS;
const SUPERVISOR_MAX_KILLS = 2;

if (!process.env[SUPERVISOR_ENV]) {
  for (let attempt = 0; ; attempt++) {
    const last = attempt >= SUPERVISOR_MAX_KILLS;
    const startedAt = Date.now();
    // 🔴 `process.execArgv` 必须原样传下去（r2 加的）：真正跑测试的是子进程，node 的命令行参数
    //    不透传的话，`--cpu-prof` / `--inspect` / `--trace-*` 量到的是一个**闲着的监工** ——
    //    PM 在 r1 验收里实测：交付那份 profile 里 `extractHtmlImageUrls` 出现 **0** 次
    //    （干净 main 是 49 次），而两臂 rc 都是 0。**它不报错，只是给出一份空答案，而空答案跟
    //    「量过了、没发现」长得一模一样** —— 本票留下的下一步正是「下一个人来追根因」。
    const r = spawnSync(process.execPath, [...process.execArgv, __filename], {
      stdio: 'inherit',
      env: { ...process.env, [SUPERVISOR_ENV]: '1' },
      ...(last ? {} : { timeout: ATTEMPT_DEADLINE_MS, killSignal: 'SIGKILL' }),
    });
    const elapsedMs = Date.now() - startedAt;
    if (r.status !== null) process.exit(r.status);       // 正常给出了结论（0 / 1 / 2），照搬
    // 到这里 = 这一次是被**信号**打死的。是谁打的有两种，而它们要说不同的话（QA3 #3）：
    // 死线到了是我自己打的（那才是「慢档」）；没到死线就被打死的是**外面**打的（OOM killer、
    // 有人 kill 整个进程组、CI 取消 job）。r1 那一版两种都印同一句「跑到 40 秒死线」，
    // 而读 CI 日志的人正是拿那句话判「这一跑是不是慢档」。
    const byMyDeadline = !last && elapsedMs >= ATTEMPT_DEADLINE_MS;
    const took = `跑了 ${(elapsedMs / 1000).toFixed(1)} 秒`;
    if (last) {                                          // 按构造到不了：最后一次没有死线
      console.log(`\n🔴 #1219 监工：最后一次（没有死线的那次）被 ${r.signal} 打死了（${took}）`
        + ` —— 那不是我打的，按跑不起来处置，不是通过。\n`);
      process.exit(2);
    }
    if (byMyDeadline) {
      console.log(`\n⚠️  #1219 监工：第 ${attempt + 1} 次跑到 ${(ATTEMPT_DEADLINE_MS / 1000).toFixed(0)} 秒`
        + `死线还没跑完（${took}），杀掉换一个新进程重来（最多杀 ${SUPERVISOR_MAX_KILLS} 次，之后那次不设死线）。`);
    } else {
      console.log(`\n⚠️  #1219 监工：第 ${attempt + 1} 次被 ${r.signal} 打死了，而${took}、**没到**`
        + ` ${(ATTEMPT_DEADLINE_MS / 1000).toFixed(0)} 秒死线 —— 打它的不是我（OOM killer / 有人 kill 了整个`
        + `进程组 / CI 取消了 job 都长这样）。这一跑不能当成「慢档」的证据。照样换一个新进程重来。`);
    }
    console.log('   这一行之上那一段输出是被杀掉那次的，不算数。\n');
  }
}

const NEXT = path.resolve(__dirname, '..', '..');
const SRC = path.join(NEXT, 'src');

let pass = 0; let fail = 0;
const ok = (m) => { pass += 1; console.log(`  ✅ ${m}`); };
const bad = (m) => { fail += 1; console.log(`  ❌ ${m}`); };
const die = (m) => { console.error(`🔴 跑不起来: ${m}`); process.exit(2); };

let lib;
try { lib = require('./image-urls.js'); } catch (e) { die(`require ./image-urls.js 失败: ${e.message}`); }
const { collectAllowedImageUrls, imageUrlRejection, attachedImagesNote, IMAGE_FIELDS, extractUrls } = lib;

// ══ 一、判据本身 ══════════════════════════════════════════════════════════════════════════════
console.log('\n── 一、「这个地址是谁给的」 ──────────────────────────────────────');

const ATTACHED = 'https://uploads.ai1stsite.app/u1/8f3c1d2ab_photo.jpg';
const INVENTED = 'https://uploads.ai1stsite.app/u1/profile-photo.jpg';   // #1195 生产站上那个真实的 404
const STOCK    = 'https://images.unsplash.com/photo-1573496359142-b8d87734a5a2';
const ONDISK   = 'https://uploads.ai1stsite.app/u1/c250d3d41_logo.png';

// 造一个只有 JSON 的临时站目录，让「站里已有的」这一类来源有真东西可读。
const siteDir = fs.mkdtempSync(path.join(os.tmpdir(), 'imgurl-site-'));
process.on('exit', () => { try { fs.rmSync(siteDir, { recursive: true, force: true }); } catch (e) { /* 打扫不改结论 */ } });
fs.mkdirSync(path.join(siteDir, 'pages'));
fs.writeFileSync(path.join(siteDir, 'brand.json'), JSON.stringify({ logoUrl: ONDISK }));
fs.writeFileSync(path.join(siteDir, 'pages', 'home.json'), JSON.stringify({ blocks: [] }));

const allowed = collectAllowedImageUrls({
  siteDir,
  images: [{ url: ATTACHED, originalFilename: 'photo.jpg' }],
  message: '把关于我们页那张顾问照片换成这张',
  conversationHistory: [],
});
if (allowed.size < 2) die(`放行名单只收到 ${allowed.size} 个地址 —— 尺子坏了（附件或站目录那一类没进来）`);
allowed.has(ATTACHED) ? ok('附件的地址进了放行名单') : bad('附件的地址【没】进放行名单');
allowed.has(ONDISK) ? ok('站里 brand.json 已有的地址进了放行名单（「把首页那张挪过来」照常能做）')
                    : bad('站里已有的地址【没】进放行名单');

// 阳性：附件那张写进 content-split
const okWrite = { blocks: [{ type: 'content-split', data: { headline: 'x', imageUrl: ATTACHED } }] };
imageUrlRejection(okWrite, allowed) === null
  ? ok('写附件那张 → 放行')
  : bad(`写附件那张被拒了: ${imageUrlRejection(okWrite, allowed)}`);

// 反向①：编出来的地址（生产站上真实发生的那一个）
const badWrite = { blocks: [{ type: 'content-split', data: { imageUrl: INVENTED } }] };
const why1 = imageUrlRejection(badWrite, allowed);
(why1 && why1.includes(INVENTED)) ? ok('编出来的地址 → 拒，且拒绝理由里点了名')
                                  : bad(`编出来的地址【没】被拒: ${why1}`);

// 反向②：图库外链
const stockWrite = { blocks: [{ type: 'hero', data: { imageUrl: STOCK } }] };
imageUrlRejection(stockWrite, allowed) ? ok('Unsplash 外链 → 拒') : bad('Unsplash 外链【没】被拒');

// 反向③：logoUrl 那一维（不是只盯 imageUrl）
imageUrlRejection({ logoUrl: INVENTED }, allowed) ? ok('brand.json 的 logoUrl 也在射程内')
                                                  : bad('logoUrl 上编出来的地址【没】被拒');

// 反向④：gallery 的 items[] 是嵌一层的
const galleryBad = { blocks: [{ type: 'gallery', data: { items: [{ imageUrl: ATTACHED }, { imageUrl: INVENTED }] } }] };
imageUrlRejection(galleryBad, allowed) ? ok('gallery items[].imageUrl 也在射程内')
                                       : bad('gallery 嵌套里的编造地址【没】被拒');

// 边界①：相对路径不在射程内（create-site 生成的 /photos/*.jpg 不许被误伤）
imageUrlRejection({ blocks: [{ data: { imageUrl: '/photos/hero.jpg' } }] }, allowed) === null
  ? ok('站内相对路径 /photos/… → 放行（不是外链，编不出祸）')
  : bad('站内相对路径被误拒了');

// 边界②：老板自己在消息里贴的地址
const typed = collectAllowedImageUrls({ images: [], message: `用这张 ${STOCK} 谢谢`, conversationHistory: [] });
imageUrlRejection({ blocks: [{ data: { imageUrl: STOCK } }] }, typed) === null
  ? ok('老板自己打出来的地址 → 放行')
  : bad('老板自己打出来的地址被拒了');

// 边界③：历史里【老板说过的】收，【模型自己提议的】不收（#1194 接上历史之后这一格才有内容）。
// 🔴 两向都测：只测前一半的话，把 assistant 那条也收进来的实现照样全绿 —— 而那正是把编造洗白的通道。
const hist = [
  { role: 'user', content: `用这张 ${ONDISK}` },
  { role: 'assistant', content: `我可以用 ${STOCK} 这张` },
];
const fromHist = collectAllowedImageUrls({ images: [], message: '换一下', conversationHistory: hist });
fromHist.has(ONDISK) ? ok('老板在之前对话里给过的地址 → 放行')
                     : bad('老板在历史里给过的地址【没】进放行名单');
fromHist.has(STOCK) ? bad('模型自己上一轮提议的图库链接被当成了「有人给过」—— 一条把编造洗白的通道')
                    : ok('模型自己提议的地址不算「有人给过」（assistant 那一半不收）');

// 边界③：非图片字段上的地址不管（seo 的 domain、社交链接…）
imageUrlRejection({ socialLinks: [{ platform: 'x', url: INVENTED }] }, allowed) === null
  ? ok('非图片字段上的地址不在射程内')
  : bad('非图片字段被误拒了');

// 附件清单那段文本
const note = attachedImagesNote([{ url: ATTACHED, originalFilename: 'photo.jpg' }, { url: ONDISK }]);
(note.includes(ATTACHED) && note.includes(ONDISK) && note.indexOf(ATTACHED) < note.indexOf(ONDISK))
  ? ok('附件清单把每个地址按原顺序写成了文本')
  : bad('附件清单没把地址原样按顺序写出来');
attachedImagesNote([]) === '' ? ok('没有附件时那段文本是空串（不附图的那条路一个字节不变）')
                              : bad('没有附件时也吐了东西 —— 会改变不附图的行为');

// ══ 一之二、#1199 收拢的四条覆盖边界 ══════════════════════════════════════════════════════════
// 🔴 每一格都写明**期望**。只打读数不打期望的话，「站内相对路径 → 放行」和「//unsplash → 放行」
//    在屏幕上长得一模一样，而一个是对的、一个正是要治的病。
console.log('\n── 一之二、#1199 的四条边界 ────────────────────────────────────');

const verdict = (parsed, known) => (imageUrlRejection(parsed, known) ? '拒' : '放行');
const grid = (label, parsed, known, expect) => (verdict(parsed, known) === expect
  ? ok(`${label} → ${expect}`)
  : bad(`${label} → 期望 ${expect}，实测 ${verdict(parsed, known)}`));

// ── ① 博客正文那个面（BlogPostPage.tsx:56 把 content 当 HTML 画；blog/*.json 可写）──────────────
grid('博客 content 的 <img src> 里放编造地址',
     { slug: 'p', content: `<h2>x</h2><p><img src="${INVENTED}" alt=""></p>` }, allowed, '拒');
grid('博客 content 里放【老板给过】的那张',
     { slug: 'p', content: `<p><img src="${ATTACHED}"></p>` }, allowed, '放行');
grid('同一面的另一个机制 style="…url(编造)"',
     { slug: 'p', content: `<div style="background-image:url('${INVENTED}')">x</div>` }, allowed, '拒');
// 🔴 边界：`url(…)` 只在 style 属性里认。整段文本都认的话，一篇讲 CSS 的博客里那行代码示例
//    会被当成一张图而整份拒收 —— 误拒方向虽安全，但这一格是可以做对的，所以钉住它。
grid('讲 CSS 的博客里那行代码示例（纯文本 url(…)）',
     { slug: 'p', content: `<pre><code>background-image: url(${INVENTED});</code></pre>` }, allowed, '放行');
grid('博客正文里的普通外链 <a href>（不是图）',
     { slug: 'p', content: `<p><a href="${INVENTED}">看这里</a></p>` }, allowed, '放行');

// ── ② 第 ④ 类来源不再把模型自己写下的洗白 ────────────────────────────────────────────────────
const siteDir2 = fs.mkdtempSync(path.join(os.tmpdir(), 'imgurl-launder-'));
process.on('exit', () => { try { fs.rmSync(siteDir2, { recursive: true, force: true }); } catch (e) { /* 打扫不改结论 */ } });
fs.mkdirSync(path.join(siteDir2, 'pages'));
fs.mkdirSync(path.join(siteDir2, 'blog'));
// 模型上一轮把编造地址写进了一个**纯文本**字段（不是图片位置）
fs.writeFileSync(path.join(siteDir2, 'pages', 'home.json'),
  JSON.stringify({ blocks: [{ type: 'text-block', data: { headline: `见 ${INVENTED} 这张` } }] }));
// 老板给过的那张，在站上真的是一张图（图片字段 / 博客正文各一处）
fs.writeFileSync(path.join(siteDir2, 'brand.json'), JSON.stringify({ logoUrl: ONDISK }));
fs.writeFileSync(path.join(siteDir2, 'blog', 'a.json'),
  JSON.stringify({ slug: 'a', content: `<p><img src="${ATTACHED}"></p>` }));
const fromSite = collectAllowedImageUrls({ siteDir: siteDir2, images: [], message: '换个图', conversationHistory: [] });
grid('模型上一轮写在【文本字段】里的地址 → 这一轮写进 imageUrl',
     { blocks: [{ data: { imageUrl: INVENTED } }] }, fromSite, '拒');
// 🔴 反向：④ 存在的理由（「把首页那张挪到关于页」）不能被治没 —— 两种图片位置各一格。
grid('站的【图片字段】上已有的那张仍要能挪',
     { blocks: [{ data: { imageUrl: ONDISK } }] }, fromSite, '放行');
grid('站的【博客正文】里已有的那张也要能挪到首页',
     { blocks: [{ data: { imageUrl: ATTACHED } }] }, fromSite, '放行');

// ── ③ `//` 与 data: 得先【进入判定】才谈得上判成什么 ──────────────────────────────────────────
const STOCK_REL = '//images.unsplash.com/photo-1573496359142-b8d87734a5a2';
grid('scheme-relative //images.unsplash.com/…（编造）',
     { blocks: [{ data: { imageUrl: STOCK_REL } }] }, allowed, '拒');
grid('data:image/svg+xml;base64,…（编造）',
     { blocks: [{ data: { imageUrl: 'data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=' } }] }, allowed, '拒');
// 两向：老板给过的那张写成 `//` 形式指的是同一张图，不许误拒
grid('老板给过的那张写成 // 形式',
     { blocks: [{ data: { imageUrl: ATTACHED.replace(/^https:/, '') } }] }, allowed, '放行');
const DATA_GIVEN = 'data:image/png;base64,iVBORw0KGgo=';
grid('老板自己在消息里贴的 data: URI',
     { blocks: [{ data: { imageUrl: DATA_GIVEN } }] },
     collectAllowedImageUrls({ images: [], message: `用这个 ${DATA_GIVEN} 谢谢`, conversationHistory: [] }), '放行');

// ── ④ 手打地址被句尾标点粘脏（中文句子没有空格 ⟹ 标点是唯一边界）────────────────────────────
const CLEAN = 'https://example.com/a.jpg';
for (const [name, text] of [
  ['中文句号', `你用这张 ${CLEAN}。`],
  ['中文逗号', `你用这张 ${CLEAN}，谢谢`],
  ['中文顿号', `两张 ${CLEAN}、https://example.com/b.jpg`],
  ['全角括号', `（图在这 ${CLEAN}）`],
  ['全角引号', `“${CLEAN}”`],
  ['英文句号', `use ${CLEAN}.`],
  ['英文对照（本来就干净，读数不许变）', `use ${CLEAN} please`],
]) {
  const got = extractUrls(text);
  got[0] === CLEAN ? ok(`抠地址 · ${name} → ${CLEAN}`)
                   : bad(`抠地址 · ${name} → 期望 ${CLEAN}，实测 ${JSON.stringify(got)}`);
}
grid('老板打带句号的中文句子 → 模型照抄干净地址写入',
     { blocks: [{ data: { imageUrl: CLEAN } }] },
     collectAllowedImageUrls({ images: [], message: `你用这张 ${CLEAN}。`, conversationHistory: [] }), '放行');

// ══ 一之三、#1204：HTML 里另外那八种「能画出一张图」的写法 ════════════════════════════════════
// 🔴 每一行的**射程判据**不是规范怎么写的，而是真浏览器去不去取那张图 —— #1204 在 chromium 上
//    逐格量过（自己起一台 HTTP 服务器，看它收没收到那条请求）。读数贴在 #1204 的交接留言里。
// 🔴 两向都测。只测「编造的被拒」的话，一个把整段 HTML 无脑拒掉的实现也全绿 —— 而那正是误拒：
//    老板自己给过的那张图放在同一种写法里，必须照样放行。
console.log('\n── 一之三、#1204 的八种写法（每种两向）──────────────────────────');

const HTML_FORMS = [
  ['<img srcset>（没有 src）',   (u) => `<img srcset="${u} 1x">`],
  ['<picture><source srcset>',   (u) => `<picture><source srcset="${u}"><img alt="x"></picture>`],
  ['<video poster>',             (u) => `<video poster="${u}"></video>`],
  ['<svg><image href>',          (u) => `<svg><image href="${u}"/></svg>`],
  ['<svg><image xlink:href>',    (u) => `<svg><image xlink:href="${u}"/></svg>`],
  ['<input type=image src>',     (u) => `<input type="image" src="${u}">`],
  ['<object data>',              (u) => `<object data="${u}"></object>`],
  ['<embed src>',                (u) => `<embed src="${u}">`],
  ['裸 <image src>（解析器当 <img>）', (u) => `<image src="${u}">`],
  ['<style> 元素里的 url()',     (u) => `<style>.z{background-image:url('${u}')}</style><div class="z"></div>`],
];
for (const [name, mk] of HTML_FORMS) {
  grid(`${name} 里放编造地址`, { slug: 'p', content: mk(INVENTED) }, allowed, '拒');
  grid(`${name} 里放【老板给过】的那张`, { slug: 'p', content: mk(ATTACHED) }, allowed, '放行');
}

// 🔴 不收的那两格也要钉住 —— 它们是**有意**不收的，而「不收」和「漏了」在只打 ✅ 的实现里长得一样。
//    `<iframe>` 装的是一份文档不是一张图，博客正文里嵌 YouTube / 地图是常事 ⟹ 收它会把老板
//    没打过字的正常嵌入整份拒掉。`<a href>` 实测浏览器压根不取。
grid('<iframe src>（装的是文档，不是图 —— 有意不收）',
     { slug: 'p', content: `<iframe src="${INVENTED}"></iframe>` }, allowed, '放行');
grid('<video><source src>（那是视频，不是图 —— 有意不收）',
     { slug: 'p', content: `<video><source src="${INVENTED}"></video>` }, allowed, '放行');

// ── 真实博客里 HTML 长得千奇百怪：属性不带引号、标签大写、属性跨行、值里带 > ──────────────────
// 🔴 #1204 把两条写死的正则换成了一个标签扫描器 ⟹ 这几种形状是它新引入的失败面，而坏起来是静默的
//    （抠不出来 = 那张图没人问 = 放行）。每一格都写明期望，不是只打读数。
for (const [name, html, expect] of [
  ['属性不带引号 <img src=a.jpg>',        `<img src=${INVENTED}>`,                        [INVENTED]],
  ['单引号',                              `<img src='${INVENTED}'>`,                      [INVENTED]],
  ['标签和属性名大写 <IMG SRCSET=…>',      `<IMG SRCSET="${INVENTED} 1x">`,                [INVENTED]],
  ['属性跨行',                            `<img\n  src="${INVENTED}"\n  alt="x">`,        [INVENTED]],
  ['属性值里带 >（<img src=… alt="a>b">）', `<img src="${INVENTED}" alt="a>b">`,            [INVENTED]],
  ['普通外链 <a href> 不是图',             `<a href="${INVENTED}">看这里</a>`,             []],
  ['一段没有图的正文',                    '<p>hello <strong>world</strong></p>',          []],
]) {
  const got = lib.extractHtmlImageUrls(html);
  JSON.stringify(got) === JSON.stringify(expect)
    ? ok(`抠 HTML 里的图 · ${name} → ${JSON.stringify(expect)}`)
    : bad(`抠 HTML 里的图 · ${name} → 期望 ${JSON.stringify(expect)}，实测 ${JSON.stringify(got)}`);
}

// ── AC2：srcset 是**一串**候选，每一个都要进判定 ──────────────────────────────────────────────
console.log('\n── 一之四、#1204 AC2：srcset 的多候选串 ─────────────────────────');

grid('srcset 两个候选，只有【第二个】是编造的（只判第一个就漏）',
     { slug: 'p', content: `<img srcset="${ATTACHED} 1x, ${INVENTED} 2x">` }, allowed, '拒');
grid('srcset 两个候选，只有【第一个】是编造的',
     { slug: 'p', content: `<img srcset="${INVENTED} 1x, ${ATTACHED} 2x">` }, allowed, '拒');
grid('srcset 两个候选都是老板给过的 → 放行',
     { slug: 'p', content: `<img srcset="${ATTACHED} 1x, ${ONDISK} 2x">` }, allowed, '放行');
grid('srcset 里第【三】个候选是编造的（w 描述符 + 无空格逗号）',
     { slug: 'p', content: `<img srcset="${ATTACHED} 400w,${ONDISK} 800w,${INVENTED} 1200w">` }, allowed, '拒');
grid('srcset 里候选**没有**描述符（逗号直接贴着地址）',
     { slug: 'p', content: `<img srcset="${ATTACHED},${INVENTED}">` }, allowed, '拒');
// 🔴 data: URI 自己就带逗号 ⟹ 无脑 split(',') 会把它拆碎，那张【老板给过的】图从此认不出来。
const givenData = collectAllowedImageUrls({ images: [], message: `用这个 ${DATA_GIVEN} 谢谢`, conversationHistory: [] });
grid('老板给过的 data: URI 放进 srcset（它自己带逗号，拆碎就误拒）',
     { slug: 'p', content: `<img srcset="${DATA_GIVEN} 1x">` }, givenData, '放行');
grid('srcset 里编造的 data: URI',
     { slug: 'p', content: `<img srcset="data:image/svg+xml;base64,PHN2Zz48L3N2Zz4= 1x">` }, givenData, '拒');

// 拆分器本身（判定之外单独钉一格：报数与构造对得上）
{
  const got = lib.splitSrcset(`${ATTACHED} 1x, ${INVENTED} 2x`);
  (got.length === 2 && got[0] === ATTACHED && got[1] === INVENTED)
    ? ok('splitSrcset 把两个候选都拆出来了（描述符已削掉）')
    : bad(`splitSrcset 期望 [${ATTACHED}, ${INVENTED}]，实测 ${JSON.stringify(got)}`);
  const gotData = lib.splitSrcset(`${DATA_GIVEN} 1x, ${ATTACHED} 2x`);
  (gotData.length === 2 && gotData[0] === DATA_GIVEN)
    ? ok('splitSrcset 没把 data: URI 自带的逗号当成候选分隔符')
    : bad(`splitSrcset 把 data: URI 拆碎了: ${JSON.stringify(gotData)}`);
}

// ── 顺带钉住 #1199 那两条边界在新实现下没退化 ────────────────────────────────────────────────
grid('属性值里带 > 的标签（<img src="…" alt="a>b">）',
     { slug: 'p', content: `<img src="${INVENTED}" alt="a>b">` }, allowed, '拒');

// ══ 一之五、#1204 r2：残缺的 HTML（QA1 在 r1 抓的覆盖面回退）════════════════════════════════════
// 🔴 r1 把两条写死的正则换成一个要求「标签必须闭合、引号必须成对」的扫描器，于是三种残缺形状从
//    `origin/main` 的「拒」翻成了「放行」——**方向是误放**，而它们在浏览器上真的会把那张图取回来。
// 🔴 为什么这些形状可达：闸看到的是 `blog/*.json` 的 `content` **一个字段**
//    （`collectImagePositions` 的 `typeof node === 'string'` 分支）⟹ **字段尾就是字符串尾**，
//    正文最后一个标签少一个 `>` 就正好是下面 A / C 的形状。
console.log('\n── 一之五、#1204 r2：残缺的 HTML ───────────────────────────────');

const MANGLED = `${ATTACHED}> <span class=`;   // 引号没闭合时浏览器真去取的那个地址（老板给过的被粘脏了）

grid('A 标签少了收尾的 >（正文末尾）',
     { slug: 'p', content: `<p>hi</p><img src="${INVENTED}"` }, allowed, '拒');
grid('A 两向：同一形状放【老板给过】的那张',
     { slug: 'p', content: `<p>hi</p><img src="${ATTACHED}"` }, allowed, '放行');
grid('B 属性引号没闭合，后面还有一个引号',
     { slug: 'p', content: `<img src="${INVENTED}> <span class="x">y</span>` }, allowed, '拒');
grid('C style= 所在的标签少了收尾的 >',
     { slug: 'p', content: `<p>hi</p><div style="background-image:url('${INVENTED}')"` }, allowed, '拒');
grid('C 两向：同一形状放【老板给过】的那张',
     { slug: 'p', content: `<p>hi</p><div style="background-image:url('${ATTACHED}')"` }, allowed, '放行');
grid('D 引号一次都没闭合（字符串在属性值中间结束）',
     { slug: 'p', content: `<p>hi</p><img src="${INVENTED}` }, allowed, '拒');
// 🔴 这一格钉的是**误放方向的另一半**：老板给过的地址被没闭合的引号粘上后面那一截之后，
//    浏览器去取的是**粘脏的那个地址**（`…photo.jpg> <span class=`），那不是他给的那张 ⟹ 产物上
//    仍然是一张裂图，所以必须拒。抠出来的值要跟浏览器真去取的那个对得上，不是把尾巴截掉。
grid('E 老板给过的地址被没闭合的引号粘脏 → 仍要拒（浏览器取的是粘脏那个）',
     { slug: 'p', content: `<img src="${ATTACHED}> <span class="y">z</span>` }, allowed, '拒');
{
  const got = lib.extractHtmlImageUrls(`<img src="${ATTACHED}> <span class="y">z</span>`);
  got[0] === MANGLED ? ok('抠出来的就是浏览器真去取的那个粘脏地址（尾巴没被截掉）')
                     : bad(`期望抠到 ${JSON.stringify(MANGLED)}，实测 ${JSON.stringify(got)}`);
}

// 🔴 D 的**残留边界**，钉住它别让下一个人当漏洞改掉（理由整段在 image-urls.js 那个 🔴 块里）：
//    同一形状放【老板给过】的那张 → **放行**。浏览器那边取到的是被模板尾巴粘脏的另一个地址
//    （实测 `…/a.png%3C/article%3E%3Cfooter%3E%3Cdiv%20class=`），所以产物上仍是一张裂图 ——
//    但粘上去的是什么由模板决定，这个函数看不到；而那属于「模型吐了残缺 HTML」，不是这道检查
//    要治的「这个地址有人给过吗」。`origin/main` 在这一格行为相同。
grid('D 残留边界：同一形状放【老板给过】的那张 → 放行（理由见注释，不是漏洞）',
     { slug: 'p', content: `<p>hi</p><img src="${ATTACHED}` }, allowed, '放行');

// ── `<style>` 元素这一面的两条边界（都是 #1204 自己引入的面，`origin/main` 看不到 `<style>` 元素）──
grid('F <style> 缺收尾的 </style>（浏览器在字符串尾自己闭合）',
     { slug: 'p', content: `<style>.z{background-image:url("${INVENTED}")}` }, allowed, '拒');
grid('G @font-face 里的 url() 是【字体】不是图 → 放行（r1 把它整份拒了）',
     { slug: 'p', content: '<style>@font-face{font-family:X;src:url(https://fonts.gstatic.com/s/a/v1/b.woff2) format("woff2")}</style>' },
     allowed, '放行');
grid('G 反向：同一个 <style> 里 @font-face 之外的 url() 照样拒',
     { slug: 'p', content: `<style>@font-face{src:url(https://fonts.gstatic.com/s/a/v1/b.woff2)}.z{background-image:url("${INVENTED}")}</style>` },
     allowed, '拒');

// ── 有意收下的那两格「非图片」：钉住它，别让下一个人当 bug 改掉 ──────────────────────────────
// 🔴 判据从来不是「它是不是一张图」，是「这个地址有人给过吗」——没人给过的地址不存在，挂上去就是
//    一块坏掉的嵌入。代价写在明处：老板没打过字的第三方 PDF 会被整份拒掉（两位 QA 都记了，都判非阻断）。
grid('H <object data> 挂一份没人给过的 PDF → 拒（有意的取舍）',
     { slug: 'p', content: '<object data="https://cdn.example.com/paper.pdf" type="application/pdf"></object>' },
     allowed, '拒');
grid('H <embed src> 挂一份没人给过的 PDF → 拒（同上）',
     { slug: 'p', content: '<embed src="https://cdn.example.com/paper.pdf" type="application/pdf">' },
     allowed, '拒');

// ── 扫描器直读一格：报数与构造对得上 ──────────────────────────────────────────────────────────
{
  const tags = lib.scanTags(`<p class="a">x</p><img src="${ATTACHED}" alt="a>b"><br/>`);
  const names = tags.map((t) => t.tag).join(',');
  names === 'p,img,br' ? ok(`scanTags 扫出 ${tags.length} 个标签，名字依次是 ${names}（属性值里那个 > 没把 img 截断）`)
                       : bad(`scanTags 期望 p,img,br，实测 ${names}`);
  const unclosed = lib.scanTags('<img src="a.jpg');
  (unclosed.length === 1 && unclosed[0].tag === 'img' && unclosed[0].body === ' src="a.jpg')
    ? ok('scanTags 对没闭合的标签：标签体吃到字符串尾')
    : bad(`scanTags 对没闭合的标签读数不对: ${JSON.stringify(unclosed)}`);
}

// ══ 一之六、#1204 r3：标签里的引号数是【奇数】（QA1 在 r2 抓的覆盖面回退）══════════════════════
// 🔴 r2 对**任何**引号都跳到配对的那个引号。一个标签里只要有奇数个引号 —— 一个普通的英文所有格
//    撇号就够了（`<a title='Joe's Bakery'>`）—— 它就会一路跳到后面某个图片属性的开引号上，把
//    **整份正文剩下的部分**吞成一个标签体 ⟹ 后面每一个画图的属性都抠不出来。五种形状两位 QA 都
//    在真 chromium 上量到浏览器**照取不误**。
// 🔴 这个洞打**两个方向**，两位 QA 各量到一半，下面各自钉一格：
//    · 误放 —— 这次写入里那个编造地址没被拦（QA1 r2 阻断，5 格）
//    · 误拒 —— `collectImagePositions` 同时在算**放行名单**，正文被吞掉之后名单也丢掉后面那些图，
//      于是老板说「把关于页那张照片也放到首页」时，模型照抄他自己站上的地址反而被拒（QA2a r2 ①）
// 🔴 分界线是**引号落在哪**，不是「main 拒而这里放行就算漏」：引号落在**值**位置时浏览器自己也把
//    后面吞掉、那条请求根本不发 ⟹ 下面「对照①」那一格放行是把 `origin/main` 的误报修掉了，别改回去。
console.log('\n── 一之六、#1204 r3：标签里的引号数是奇数 ──────────────────────');

// 每一格都是「畸形标签在前、画图的标签在后」—— 吞掉的那一段要跨过标签边界才有害。
// （QA2a 复盘自己 r2 那张表的盲区正是这个：他把畸形引号和图片属性放在了**同一个**标签上，
//   那时吞掉的部分仍属于 `<img>` 自己的标签体，属性正则照样找得到。）
const ODD_QUOTE_FORMS = [
  ['A 撇号在单引号属性值里 <a title=\'Joe\'s Bakery\'>',
   (u) => `<p><a href="/x" title='Joe's Bakery'>L</a></p><img src="${u}">`],
  ['B 属性值里未转义的双引号 <a title="a"b">',
   (u) => `<p><a href="/x" title="a"b">L</a></p><img src="${u}">`],
  ['C 落单的引号在属性名位置 <b">',
   (u) => `<p>a <b">text</b></p><img src="${u}">`],
  ['D 同上，中间隔 5 段正文',
   (u) => `<p><b">x</b></p>${'<p>filler</p>'.repeat(5)}<img src="${u}">`],
  ['E 单引号版 <b\'>',
   (u) => `<p><b'>x</b></p><img src="${u}">`],
];
for (const [name, mk] of ODD_QUOTE_FORMS) {
  grid(`${name} → 后面那张编造的图要拒`, { slug: 'p', content: mk(INVENTED) }, allowed, '拒');
  grid(`${name} 两向：后面那张是【老板给过】的 → 放行`, { slug: 'p', content: mk(ATTACHED) }, allowed, '放行');
}

// 反向臂 ①：引号落在【值】位置 —— 浏览器自己也吞掉后面、不发那条请求 ⟹ 这里放行是对的。
grid('对照① 引号在【值】位置 <div class="card>（浏览器不取）→ 放行，不许被一起「修」掉',
     { slug: 'p', content: `<div class="card><p>x</p></div><img src="${INVENTED}">` }, allowed, '放行');
// 反向臂 ②：同一段正文完全良构时必须照旧拒 —— 证明上面那些格子不是靠「什么都拒」蒙对的。
grid('对照② 完全良构 → 拒',
     { slug: 'p', content: `<p>a <b>text</b></p><img src="${INVENTED}">` }, allowed, '拒');
// 撇号跟图片属性在【同一个】标签上时 r2 本来就是对的，钉住它别退化。
grid('对照③ 撇号在 <img> 自己的 alt 上（r2 本来就对）→ 拒',
     { slug: 'p', content: `<p><img src="${ATTACHED}" alt='the baker's hands'></p><img src="${INVENTED}">` },
     allowed, '拒');

// ── 误拒那一半：放行名单不许被吞掉（QA2a r2 ①）────────────────────────────────────────────────
// 🔴 `collectImagePositions` 被问两次，第二次是「这个站上已经有哪些图」。它跟上面那些格子共用
//    同一处修法，但要**各自**钉一格：只修判定那一侧、名单这侧照旧空的话，上面全绿而这里红。
{
  const withApostrophe = `<h2>Our story</h2><p><a title='Joe's Bakery'>Joe</a> started in 2019.</p>`
    + `<img src="${ATTACHED}" alt="shop"><p>more</p><img src="${ONDISK}" alt="team">`;
  const seen = lib.collectImagePositions({ slug: 'about', content: withApostrophe });
  (seen.includes(ATTACHED) && seen.includes(ONDISK))
    ? ok(`撇号后面那两张【老板给过】的图仍在放行名单里（抠到 ${seen.length} 个图片位置）`)
    : bad(`撇号把放行名单吞掉了 —— 期望抠到 ${ATTACHED} 与 ${ONDISK}，实测 ${JSON.stringify(seen)}`);
  // 单变量对照：唯一的变量就是那个撇号，去掉它读数必须一样。
  const cleanHtml = withApostrophe.replace("title='Joe's Bakery'", 'title="Joe Bakery"');
  const seenClean = lib.collectImagePositions({ slug: 'about', content: cleanHtml });
  seenClean.length === seen.length
    ? ok(`单变量对照：去掉那个撇号，名单读数不变（两边都是 ${seen.length} 个图片位置）`)
    : bad(`去掉撇号后名单从 ${seen.length} 变成 ${seenClean.length} —— 那个撇号仍然在改变读数`);
}

// ── 不带引号的属性值：边界只有空白和 >（#1204 r3，我自己拿真 chromium 当判据扫出来的）──────────
// 🔴 这一格**不是**本轮的回退：`origin/main` / r1 / r2 在它上面一样瞎（四臂逐个量过，全是「放行」）。
//    它是本票主题（「还有哪种画法闸看不见」）里剩下的一格 —— 属性正则原来排掉了不带引号的值里的
//    引号，于是 `<div style=background-image:url('…')>` 只抠到 `background-image:url(`，那张图整个
//    看不见。**真 chromium 上 DPR=1 和 2 都真发了那条请求。**
grid('不带引号的 style=（值里有引号）→ 拒',
     { slug: 'p', content: `<div style=background-image:url('${INVENTED}')>x</div>` }, allowed, '拒');
grid('两向：同一形状放【老板给过】的那张 → 放行',
     { slug: 'p', content: `<div style=background-image:url('${ATTACHED}')>x</div>` }, allowed, '放行');
grid('不带引号的 src=（值里有等号，浏览器读到 > 才停）→ 拒',
     { slug: 'p', content: `<img src=${INVENTED}?w=800&h=600>` }, allowed, '拒');
// 🔴 **这一改的反向承重面**（QA2a r3 提的，我自己在 chromium 上复量过）：不带引号的值后面
//    **没有空白**、紧跟着一个带引号的图片属性时，整段被 HTML 解析器读成**一个**属性 ——
//    那里根本不存在 `src` / `srcset` / `style` 这个属性 ⟹ 浏览器不可能去取 ⟹ **必须放行**。
//    `origin/main` 和 r2 在这四格是**拒**，那是误报，本轮顺带修掉了。
//    读数是浏览器自己吐的属性表，不是「取没取」：
//      `<img alt=a"src="…">` → `[alt="a\"src=\"…\""]`（一个属性）· 对照 `<img alt=hello src="…">`
//      → `[alt="hello", src="…"]`（两个属性，真去取了）
//    🔴 钉住它：哪天有人觉得「引号不该进不带引号的值」把字符类改回去，这四格会变回拒（误报回来），
//       而上面那些「必须拒」的格子一个都不会红 —— 只有这一格看得见。
for (const [name, html] of [
  ['A <img alt=a"src="…">', `<img alt=a"src="${INVENTED}">`],
  ['B 单引号版', `<img alt=a'src='${INVENTED}'>`],
  ['C <img data-x=1"srcset="… 1x">', `<img data-x=1"srcset="${INVENTED} 1x">`],
  ['D <div data-x=a"style="…url()">', `<div data-x=a"style="background:url(${INVENTED})">x</div>`],
]) {
  grid(`${name} 整段被读成一个属性，那里没有图片属性 → 放行（浏览器也不取）`,
       { slug: 'p', content: html }, allowed, '放行');
}

// 反向：空白仍然是边界 —— 值不许吃掉后面那个属性（吃掉了就会把 alt 的内容当成地址的一部分）。
{
  const got = lib.extractHtmlImageUrls(`<img src=${ATTACHED} alt=hello>`);
  (got.length === 1 && got[0] === ATTACHED)
    ? ok('不带引号的值遇到空白就停（后面那个 alt 没被吃进地址里）')
    : bad(`不带引号的值吃过了空白: ${JSON.stringify(got)}`);
}

// ── 扫描器直读一格：奇数个引号时标签体不许跨过自己的 > ────────────────────────────────────────
{
  const tags = lib.scanTags(`<p><a title='Joe's Bakery'>x</a></p><img src="${ATTACHED}">`);
  const names = tags.map((t) => t.tag).join(',');
  names === 'p,a,img'
    ? ok(`scanTags 扫出 ${tags.length} 个标签，名字依次是 ${names}（<a> 的标签体没吞掉后面的 <img>）`)
    : bad(`scanTags 期望 p,a,img，实测 ${names} —— <a> 的标签体吞过了自己的 >`);
}

// ══ 一之七、#1207：`background` 属性这一族 ═════════════════════════════════════════════════════
// 🔴 射程判据是**真 chromium 去不去取**（#1207 自己起一台 HTTP 服务器、一个标签一页单量，看它收没
//    收到那条请求）。八个标签全部 ✅ 真去取了，`<div background>` ❌ 不取 —— 那个 ❌ 是探针的反向
//    对照，也在下面钉了一格：它证明这不是「什么都收」。
// 🔴 这一族**不需要模型犯错**，只要它写一张老式表格。`background` 是被废弃的 HTML，浏览器照样画。
console.log('\n── 一之七、#1207：background 属性这一族 ─────────────────────────');

const BG_FORMS = [
  ['<td background>',    (u) => `<table><tr><td background="${u}">c</td></tr></table>`],
  ['<th background>',    (u) => `<table><tr><th background="${u}">h</th></tr></table>`],
  ['<tr background>',    (u) => `<table><tr background="${u}"><td>c</td></tr></table>`],
  ['<tbody background>', (u) => `<table><tbody background="${u}"><tr><td>c</td></tr></tbody></table>`],
  ['<thead background>', (u) => `<table><thead background="${u}"><tr><td>c</td></tr></thead></table>`],
  ['<tfoot background>', (u) => `<table><tfoot background="${u}"><tr><td>c</td></tr></tfoot></table>`],
  ['<table background>', (u) => `<table background="${u}"><tr><td>c</td></tr></table>`],
  ['<body background>',  (u) => `<body background="${u}">`],
];
for (const [name, mk] of BG_FORMS) {
  grid(`${name} 里放编造地址`, { slug: 'p', content: mk(INVENTED) }, allowed, '拒');
  grid(`${name} 里放【老板给过】的那张`, { slug: 'p', content: mk(ATTACHED) }, allowed, '放行');
}
// 🔴 反向对照：`<div background>` 浏览器**不取**（实测），所以它有意不收。这一格钉的是「不收」——
//    「有意不收」和「漏了」在一个只打 ✅ 的实现里长得一模一样。
grid('对照 <div background>（真 chromium 上不取 —— 有意不收）',
     { slug: 'p', content: `<div background="${INVENTED}">x</div>` }, allowed, '放行');

// ══ 一之八、#1207：`http(s):` 后面的斜杠数不限 ═════════════════════════════════════════════════
// 🔴 原来写死两个斜杠 ⟹ `http:/h/x` 地址抠出来了却**不进入判定**（连问都不问），一个字符就让 #1204
//    新收的六种写法全部失效。四种斜杠数 × 两条通道，真 chromium 上**八格全部真发了请求**。
// 🔴 两向都测：编造的要拒；而老板给过的那张写成任意斜杠数指的是**同一张图**（WHATWG 归一化成两个
//    斜杠，浏览器取的是同一个地址）⟹ 不许误拒。
console.log('\n── 一之八、#1207：斜杠数不限 ───────────────────────────────────');

const HOST_PATH = 'uploads.ai1stsite.app/u1/profile-photo.jpg';        // INVENTED 去掉 scheme 的那一段
const GIVEN_HOSTPATH = 'uploads.ai1stsite.app/u1/8f3c1d2ab_photo.jpg'; // ATTACHED 的那一段
const SLASHES = [['两斜杠(对照)', '//'], ['一斜杠', '/'], ['零斜杠', ''], ['三斜杠', '///']];
const CHANNELS = [
  ['<img src>',    (u) => `<img src="${u}">`],
  ['style url()',  (u) => `<div style="background-image:url(${u})">x</div>`],
];
for (const [sname, sl] of SLASHES) {
  for (const [cname, mk] of CHANNELS) {
    grid(`${cname} http:${sl}编造 · ${sname}`,
         { slug: 'p', content: mk(`http:${sl}${HOST_PATH}`) }, allowed, '拒');
  }
}
// 两向：老板给过的是 `https://…`（附件那一种），模型少打/多打斜杠 → 同一张图，放行。
for (const [sname, sl] of SLASHES) {
  grid(`老板给过的那张写成 https:${sl}… · ${sname}（浏览器取的是同一个地址）`,
       { blocks: [{ data: { imageUrl: `https:${sl}${GIVEN_HOSTPATH}` } }] }, allowed, '放行');
}
// 另一半读法：老板**自己在消息里**就打了个少斜杠的地址 —— 抠地址与判定共用同一个源串 ⟹ 也要放行。
{
  const typedOdd = collectAllowedImageUrls({
    images: [], message: `用这张 http:/${GIVEN_HOSTPATH} 谢谢`, conversationHistory: [],
  });
  typedOdd.has(`http:/${GIVEN_HOSTPATH}`)
    ? ok('老板自己打的单斜杠地址进了放行名单（抠地址那把尺也认它）')
    : bad(`老板打的单斜杠地址【没】进放行名单: ${JSON.stringify([...typedOdd])}`);
  grid('老板打单斜杠、模型照抄单斜杠',
       { blocks: [{ data: { imageUrl: `http:/${GIVEN_HOSTPATH}` } }] }, typedOdd, '放行');
  grid('老板打单斜杠、模型换成另一个域名（仍要拒）',
       { blocks: [{ data: { imageUrl: `http:/${HOST_PATH}` } }] }, typedOdd, '拒');
}
// scheme 的大小写：URL 的 scheme 不区分大小写，浏览器归一化 ⟹ 不许因为大写而误拒。
grid('老板给过的那张写成大写 scheme（HTTPS:/…）',
     { blocks: [{ data: { imageUrl: `HTTPS:/${GIVEN_HOSTPATH}` } }] }, allowed, '放行');
// 🔴 不跨 scheme：老板给的是 https，模型写成 http 仍要拒（今天也是这样，钉住别被上面那层等价带宽）。
grid('老板给的是 https，模型写成 http://（斜杠等价不跨 scheme）',
     { blocks: [{ data: { imageUrl: `http://${GIVEN_HOSTPATH}` } }] }, allowed, '拒');

// ── AC2：放宽斜杠数**没有**把站内相对路径吃进来（改前改后都放行）────────────────────────────────
// 🔴 分界线是**有没有 scheme**。这两格改前就是「放行」，钉在这里防的是「放宽时顺手把它们吃进来」。
grid('AC2 站内相对路径 <img src="/photos/hero.jpg">',
     { slug: 'p', content: '<img src="/photos/hero.jpg">' }, allowed, '放行');
grid('AC2 站内相对路径 style="url(/photos/hero.jpg)"',
     { slug: 'p', content: '<div style="background:url(/photos/hero.jpg)">x</div>' }, allowed, '放行');
grid('AC2 双斜杠开头但不是域名的站内路径 //photos/hero.jpg',
     { blocks: [{ data: { imageUrl: '//photos/hero.jpg' } }] }, allowed, '放行');

// ══ 二之一、#1209 AC1：没有 scheme 的多斜杠 / 反斜杠 ═══════════════════════════════════════════
// 🔴 这一族**不需要模型犯错** —— 多打一个斜杠就中。归一化之后是一个真的跨主机地址。
// 🔴 真 chromium 上逐格量过（页面 https 自签 + sink 走 https，因为没有 scheme 的值继承页面的
//    scheme；每组一个阳性对照 `//host` + 一个阴性对照 `/host`，判据是我那台服务器收没收到请求）：
//      `<img src>` 与 `<td background>` 两条路上 `///` `////` `/\` `\\` `\/` **五种全部真发了请求**。
//      CSS `url()` 那条路上只有 `///` `////` 真发了请求 —— 反斜杠那三种被 **CSS 自己的转义**吃掉了
//      （`\1` 起一段十六进制转义，`\127` 变成 `ħ`），请求打回本站。
//    ⟹ 下面 CSS 那几格里反斜杠那三种是**多收**，不是补洞。明写在这里，别当成"量出来的洞"。
//    判的是**值**不是通道（这个函数看不到自己在哪条通道上），所以三条路一律拒；多收的方向是误拒，
//    而这一族的地址除了跨主机没有别的用途。
// 🔴 反斜杠**一定要用 fromCharCode 造**，不许在字面量里数斜杠：本票的探针第一版就是在这里错的
//    （用例名被剃成同一个 id、四格读到同一张页面，而它给出的假读数恰好是"反斜杠都不取"）。
console.log('\n── 二之一、#1209 AC1：没有 scheme 的多斜杠 / 反斜杠 ─────────────');

const BS = String.fromCharCode(92);
const NOSCHEME = [
  ['三斜杠 ///',  '///'],
  ['四斜杠 ////', '////'],
  [`正反 /${BS}`, '/' + BS],
  [`双反 ${BS}${BS}`, BS + BS],
  [`反正 ${BS}/`, BS + '/'],
];
const CH3 = [
  ['<img src>',       (u) => `<img src="${u}">`],
  ['<td background>', (u) => `<table><tr><td background="${u}">c</td></tr></table>`],
  ['CSS url()',       (u) => `<div style="background-image:url(${u})">x</div>`],
];
for (const [sname, pre] of NOSCHEME) {
  for (const [cname, mk] of CH3) {
    grid(`${cname} ${sname} + 编造的域名`, { slug: 'p', content: mk(pre + HOST_PATH) }, allowed, '拒');
    // 两向：同一种写法，地址换成老板给过的那个 → 归一化后是同一张图 ⟹ 不许误拒。
    grid(`${cname} ${sname} + 【老板给过】的那张`,
         { slug: 'p', content: mk(pre + GIVEN_HOSTPATH) }, allowed, '放行');
  }
}
// 图片字段那一面同样走这条路（不只是博客正文里的 HTML）。
grid('imageUrl 字段里写 ///编造域名', { blocks: [{ data: { imageUrl: '///' + HOST_PATH } }] }, allowed, '拒');
grid('imageUrl 字段里写 ///老板给过的', { blocks: [{ data: { imageUrl: '///' + GIVEN_HOSTPATH } }] }, allowed, '放行');

// ══ 二之二、#1209 AC2：`<col background>` 与 `<colgroup background>` ═══════════════════════════
// 🔴 跟 #1207 收的那八个是同一族，老式表格里 `<colgroup>` 本来就会出现。真 chromium 上两个都
//    ✅ 真去取了（阳性对照 `<td background>` 先命中，阴性对照 `<div background>` 不取）。
console.log('\n── 二之二、#1209 AC2：col / colgroup 的 background ──────────────');

const COL_FORMS = [
  ['<col background>',
   (u) => `<table><colgroup><col background="${u}"></colgroup><tr><td>c</td></tr></table>`],
  ['<colgroup background>',
   (u) => `<table><colgroup background="${u}"><col></colgroup><tr><td>c</td></tr></table>`],
];
for (const [name, mk] of COL_FORMS) {
  grid(`${name} 里放编造地址`, { slug: 'p', content: mk(INVENTED) }, allowed, '拒');
  grid(`${name} 里放【老板给过】的那张`, { slug: 'p', content: mk(ATTACHED) }, allowed, '放行');
}

// ══ 二之三、#1209 AC3：scheme 里插了换行 / TAB ════════════════════════════════════════════════
// 🔴 WHATWG 基本 URL 解析器的**第一步**就是把 TAB / LF / CR 从输入里整个删掉（不限于 scheme 里）
//    ⟹ `ht<LF>tp://h/x` 浏览器取的是 `http://h/x`。真 chromium 上三种（LF / TAB / CR）在
//    `<img src>` 与 `<td background>` 上都真发了请求；不带引号的 CSS `url()` 里三种都不取
//    （换行让整条声明作废）—— 那几格同样是**多收**。
// 🔴 **空格不在其中**：`ht tp://…` 浏览器不当它是地址（探针里那格阴性对照），所以只剔这三个字符。
//    下面「阴性对照」那一格钉的就是它 —— 写宽成 `\s` 会把它误拒。
console.log('\n── 二之三、#1209 AC3：scheme 里插换行 / TAB ─────────────────────');

// 🔴 CSS 那条通道按**引号**分成两种，真 chromium 上读数不一样（一个良构 `http://` 对照先命中）：
//    · `url('…')` / `<style>` 里 `url("…")`：**TAB → 真去取了**（CSS 字符串允许 TAB，URL 解析器再把
//      它剔掉）⟹ 这是一个真洞。LF / CR 不取（CSS 字符串里裸换行是解析错误）。
//    · 不带引号的 `url(…)`：三种空白**都不取**（空白结束那个 url token）—— 而这道闸也抠不出来，
//      两边一致 ⟹ **不是洞**。下面拿它当阴性对照钉住，别把"抠不出来"当漏抓去修。
//    📌 `style="…url(\"…\")…"` 那种写法量不出东西：内层双引号把 HTML 属性提前关掉了，
//       良构对照那一格自己就不取 —— 所以 `style=` 属性这条路用单引号。
const IN_SCHEME = [['LF', '\n'], ['TAB', '\t'], ['CR', '\r']];
const CH3Q = [
  ['<img src>',        (u) => `<img src="${u}">`],
  ['<td background>',  (u) => `<table><tr><td background="${u}">c</td></tr></table>`],
  ["CSS url('…')",     (u) => `<div style="background-image:url('${u}')">x</div>`],
];
for (const [wname, ws] of IN_SCHEME) {
  const mangle = (hp, scheme) => `ht${ws}${scheme.slice(2)}://${hp}`;   // ht<ws>tp:// · ht<ws>tps://
  for (const [cname, mk] of CH3Q) {
    grid(`${cname} scheme 插${wname} + 编造的域名`,
         { slug: 'p', content: mk(mangle(HOST_PATH, 'http')) }, allowed, '拒');
    grid(`${cname} scheme 插${wname} + 【老板给过】的那张`,
         { slug: 'p', content: mk(mangle(GIVEN_HOSTPATH, 'https')) }, allowed, '放行');
  }
  // 阴性对照：**不带引号**的 CSS url() —— 浏览器不取，这道闸也抠不出来，两边一致。
  grid(`阴性对照 不带引号的 url(…) 插${wname}（浏览器也不取 ⟹ 不是洞）`,
       { slug: 'p', content: `<div style="background-image:url(${mangle(HOST_PATH, 'http')})">x</div>` },
       allowed, '放行');
}
// 阴性对照：插的是**空格** —— 浏览器不当地址，这里也不许当（否则就是凭空造出的误拒）。
grid('阴性对照 scheme 插空格（浏览器不取 ⟹ 不进射程）',
     { slug: 'p', content: `<img src="ht tp://${HOST_PATH}">` }, allowed, '放行');
grid("阴性对照 scheme 插空格 · CSS url('…') 那条路",
     { slug: 'p', content: `<div style="background-image:url('ht tp://${HOST_PATH}')">x</div>` }, allowed, '放行');

// ══ 二之四、#1209 AC4：站内相对路径 —— 改前改后都放行 ═════════════════════════════════════════
// 🔴 这一节挡的是「放宽斜杠数时把相对路径一起吃进来」。分界线是**前导斜杠段有几个**外加
//    「后面跟不跟【域名.】」，不是「有没有反斜杠」。
console.log('\n── 二之四、#1209 AC4：站内相对路径的反向对照 ────────────────────');

for (const [name, parsed] of [
  ['/photos/hero.jpg（图片字段）',      { blocks: [{ data: { imageUrl: '/photos/hero.jpg' } }] }],
  ['<img src="/photos/hero.jpg">',      { slug: 'p', content: '<img src="/photos/hero.jpg">' }],
  ['url(/photos/hero.jpg)',             { slug: 'p', content: '<div style="background:url(/photos/hero.jpg)">x</div>' }],
  ['//photos/hero.jpg（单标签主机）',   { blocks: [{ data: { imageUrl: '//photos/hero.jpg' } }] }],
  // 🔴 #1210 补：带端口的单标签主机。`new URL('https://localhost:8080/x.png').host` = `localhost:8080`
  //    —— **不含点**，跟 `//photos` 落在同一侧。端口里那个冒号不是点，别把判据写成「含不含标点」。
  ['///localhost:8080/x.png（带端口的单标签主机）',
                                        { blocks: [{ data: { imageUrl: '///localhost:8080/x.png' } }] }],
  ['<img src="///localhost:8080/x.png">',
                                        { slug: 'p', content: '<img src="///localhost:8080/x.png">' }],
  ['photos/hero.jpg（不带斜杠）',       { blocks: [{ data: { imageUrl: 'photos/hero.jpg' } }] }],
  [`/${BS}photos/hero.jpg（归一化后仍是单标签主机）`,
                                        { blocks: [{ data: { imageUrl: '/' + BS + 'photos/hero.jpg' } }] }],
  [`${BS}${BS}photos/hero.jpg（同上）`, { blocks: [{ data: { imageUrl: BS + BS + 'photos/hero.jpg' } }] }],
]) {
  grid(`AC4 ${name}`, parsed, allowed, '放行');
}
// 🔴 **单个反斜杠不是洞** —— 它跟单个正斜杠一样是本站路径：真 chromium 取的是
//    `https://<本站>/evil.example.com/x.png`，`new URL` 两把尺（chromium / node）读数一致。
//    这一格钉的是「不收」：把判据写成「有没有反斜杠」就会在这里造一个误拒。
grid(`AC4 单个反斜杠 ${BS}编造域名（浏览器取的是本站路径 ⟹ 有意不收）`,
     { blocks: [{ data: { imageUrl: BS + HOST_PATH } }] }, allowed, '放行');
grid(`AC4 单个正斜杠 /编造域名（同上，本站路径）`,
     { blocks: [{ data: { imageUrl: '/' + HOST_PATH } }] }, allowed, '放行');

// ── 归一化那一层直读一格：报数与构造对得上 ──────────────────────────────────────────────────────
{
  const cases = [
    ['///' + HOST_PATH,        '//' + HOST_PATH],
    ['////' + HOST_PATH,       '//' + HOST_PATH],
    ['/' + BS + HOST_PATH,     '//' + HOST_PATH],
    [BS + BS + HOST_PATH,      '//' + HOST_PATH],
    [BS + '/' + HOST_PATH,     '//' + HOST_PATH],
    [BS + HOST_PATH,           BS + HOST_PATH],          // 单个反斜杠：原样（本站路径）
    ['/photos/hero.jpg',       '/photos/hero.jpg'],
    ['ht\ntp://' + HOST_PATH,  'http://' + HOST_PATH],
    ['ht tp://' + HOST_PATH,   'ht tp://' + HOST_PATH],   // 空格不剔
    ['http:/' + HOST_PATH,     'http:/' + HOST_PATH],     // 正斜杠个数不归这一层管（#1207 那两处管）
    ['http:' + BS + BS + HOST_PATH, 'http://' + HOST_PATH],
  ];
  const wrong = cases.filter(([inp, want]) => lib.canonicalAddress(inp) !== want);
  wrong.length === 0
    ? ok(`canonicalAddress 直读 ${cases.length} 格全部对得上（含「单个反斜杠原样」「空格不剔」「正斜杠个数不管」三格阴性）`)
    : bad(`canonicalAddress ${wrong.length}/${cases.length} 格不对: `
        + wrong.map(([i, w]) => `${JSON.stringify(i)} 期望 ${JSON.stringify(w)} 实测 ${JSON.stringify(lib.canonicalAddress(i))}`).join(' · '));
}
// 回执报数：一次写入里三种新写法各一个 → 必须点名三个地址，不多不少。
{
  const three = { slug: 'p',
    content: `<img src="///${HOST_PATH}">`
      + `<table><colgroup><col background="${INVENTED.replace('profile-photo', 'a')}"></colgroup></table>`
      + `<img src="ht\ntp://${HOST_PATH.replace('profile-photo', 'b')}">` };
  const why = imageUrlRejection(three, allowed);
  if (!why) die('三种新写法一起写进去竟然放行了 —— 这一格的前提没了');
  // 🔴 只在**列地址那一段**里数。整句上跑 `/"[^"]+"/g` 会把尾巴上那句
  //    `(see "Images" in your instructions)` 也数成一个地址 —— 本票初版就这么读出了 4 个。
  const head = why.slice(0, Math.max(why.indexOf(' is an address'), why.indexOf(' are addresses')));
  if (!head) die('回执里找不到「is an address / are addresses」那一段 —— 报数这把尺子指错地方了');
  const named = [...new Set((head.match(/"[^"]+"/g) || []))].length;
  named === 3 ? ok('回执点名了 3 个地址（三种新写法各一个，报数与构造对得上）')
              : bad(`回执点名了 ${named} 个地址，构造的是 3 个: ${why.slice(0, 200)}`);
}

// ── 一整篇「什么都没做错」的博客正文：合起来必须放行 ───────────────────────────────────────────
// 🔴 上面那些格子都是一格一维。**误拒是靠合起来才看得见的**：这一篇把本票新收的两条覆盖面
//    （老式表格的 `background` · 少斜杠的地址）跟前几轮那些边界（webfont · 讲 CSS 的代码示例 ·
//    嵌 YouTube · 站内相对路径 · 英文撇号）放在同一篇里，地址全是老板给过的或站内相对路径
//    ⟹ 一处都不许拒。一格一格测全绿、合起来被整份拒掉，是这道闸最贵的坏法（#1204 r1 真的发生过）。
grid('一整篇合法博客正文（老式表格 + webfont + 代码示例 + YouTube + 相对路径 + 撇号）',
     { slug: 'p',
       content: `<style>@font-face{font-family:X;src:url(https://fonts.gstatic.com/s/a/v1/b.woff2)}</style>`
         + `<h2>Joe's Bakery</h2><p><a title='Joe's place'>about</a></p>`
         + `<table background="${ATTACHED}"><tr><td background="${ONDISK}">c</td></tr></table>`
         + `<img src="/photos/hero.jpg"><img src="https:/${'uploads.ai1stsite.app/u1/8f3c1d2ab_photo.jpg'}">`
         + `<div style="background:url(/photos/bg.jpg)">x</div>`
         + `<pre><code>background-image: url(https://example.com/only-a-code-sample.png);</code></pre>`
         + `<iframe src="https://www.youtube.com/embed/abc"></iframe>` },
     allowed, '放行');

// ══ 一之九、#1207 AC7：那句回执不许预设「它是一张图」════════════════════════════════════════════
// 🔴 这句话的读者是**模型**，不是老板（整条链：`edit-site.js:688` 的 `{ error }` → `executeTool`
//    返回值 → `JSON.stringify` → `:1129` 的 `tool_result`）。老板看到的是模型最后那段文字。
// 🔴 为什么钉它：表里 `<object data>` / `<embed src>` 装的可能是一份 PDF，而原来那句写着
//    `is an image URL` —— 拒一份 PDF 时给模型的理由是一句假话。
console.log('\n── 一之九、#1207 AC7：回执的措辞 ───────────────────────────────');
{
  const pdf = 'https://cdn.example.com/paper.pdf';
  const whyPdf = imageUrlRejection({ slug: 'p', content: `<object data="${pdf}" type="application/pdf"></object>` }, allowed);
  if (!whyPdf) die('挂 PDF 的 <object> 没被拒 —— 这一格的前提没了（射程变了？），不是通过');
  /\bis an image URL\b/.test(whyPdf)
    ? bad(`拒一份 PDF 时那句话仍写着 "is an image URL"（假话）: ${whyPdf.slice(0, 120)}`)
    : ok('拒一份 PDF 时那句话不再说「它是一张图」');
  whyPdf.includes(pdf) ? ok('回执里点了那个地址的名') : bad('回执没点名那个地址');
  /\bis an address nobody gave you\b/.test(whyPdf)
    ? ok('单数措辞是「is an address nobody gave you」')
    : bad(`单数措辞不对: ${whyPdf.slice(0, 120)}`);
  // 复数那一支单独一格（两支是两段字符串，只测一支就有一半没测）。
  const whyTwo = imageUrlRejection(
    { slug: 'p', content: `<img src="${INVENTED}"><embed src="${pdf}">` }, allowed);
  /\bare addresses nobody gave you\b/.test(whyTwo)
    ? ok('复数措辞是「are addresses nobody gave you」')
    : bad(`复数措辞不对: ${whyTwo && whyTwo.slice(0, 140)}`);
  /\brenders as a broken image\b/.test(whyTwo)
    ? bad('后果那半句仍写死「渲染成一张裂图」—— 挂 PDF 时同样是假话')
    : ok('后果那半句改成了不预设是图的说法（a picture, a PDF, an embed）');
  // 🔴 一张真的图被拒时那句话仍要说得通 —— 别为了 PDF 把图那一支说没了。
  const whyImg = imageUrlRejection({ blocks: [{ data: { imageUrl: INVENTED } }] }, allowed);
  (whyImg && whyImg.includes('a picture') && whyImg.includes('Images'))
    ? ok('拒一张图时那句话照样说得通（后果里有 a picture，且仍指向提示词的 Images 段）')
    : bad(`拒一张图时那句话不完整: ${whyImg && whyImg.slice(0, 140)}`);
}

// ══ 二、提示词那份清单 vs 模板真的画出来的 ════════════════════════════════════════════════════
console.log('\n── 二、提示词的 ## Images 段 vs 模板真的画出来的 ────────────────');

// ── 尺子一侧：模板 ────────────────────────────────────────────────────────────────────────────
const regPath = path.join(SRC, 'lib', 'sections', 'registry.ts');
let reg;
try { reg = fs.readFileSync(regPath, 'utf-8'); } catch (e) { die(`读不到 ${regPath}: ${e.message}`); }
const imports = Object.fromEntries(
  [...reg.matchAll(/^import\s+(\w+)\s+from\s+'@\/components\/sections\/(\w+)';/gm)].map((m) => [m[1], m[2]]),
);
const regBody = reg.slice(reg.indexOf('sectionRegistry'));
const entries = [...regBody.matchAll(/^\s*'([a-z0-9-]+)':\s*(\w+),/gm)];
if (entries.length < 20) die(`从 registry.ts 只抠出 ${entries.length} 个块 —— 尺子坏了`);

const IMG_SRC_RE = /<img[^>]*\ssrc=\{([^}]+)\}/g;
const leafOf = (expr) => {
  const m = String(expr).trim().match(/([A-Za-z_$][\w$]*)\s*$/);
  return m ? m[1] : null;
};

const blocksThatDrawImages = [];   // 注册表里那些真的画 <img> 的块
const leafFields = new Set();      // 那些 <img src> 读的字段名（叶子）
for (const [, key, comp] of entries) {
  const file = path.join(SRC, 'components', 'sections', `${imports[comp]}.tsx`);
  let t;
  try { t = fs.readFileSync(file, 'utf-8'); } catch (e) { die(`读不到块 ${key} 的组件 ${file}: ${e.message}`); }
  const hits = [...t.matchAll(IMG_SRC_RE)].map((m) => m[1]);
  if (hits.length) {
    blocksThatDrawImages.push(key);
    for (const h of hits) { const l = leafOf(h); if (l) leafFields.add(l); }
  }
}
// 顶栏/页脚那两处不属于任何块 —— 它们读 brand.logoUrl。
for (const shell of ['Header.tsx', 'Footer.tsx']) {
  const t = fs.readFileSync(path.join(SRC, 'components', shell), 'utf-8');
  for (const m of t.matchAll(IMG_SRC_RE)) { const l = leafOf(m[1]); if (l) leafFields.add(l); }
}
if (blocksThatDrawImages.length === 0) die('从 src/components/sections 里一个画 <img> 的块都没抠出来 —— 尺子坏了');
if (leafFields.size === 0) die('从模板里一个 <img src> 字段都没抠出来 —— 尺子坏了');
ok(`模板现读：画图的块 ${blocksThatDrawImages.length} 个（${blocksThatDrawImages.join(' · ')}）`
   + `；<img src> 读的字段 ${leafFields.size} 个（${[...leafFields].join(' · ')}）`);

// ── 尺子另一侧：提示词的 ## Images 段 ─────────────────────────────────────────────────────────
const editSitePath = path.join(NEXT, 'scripts', 'edit-site.js');
let editSite;
try { editSite = fs.readFileSync(editSitePath, 'utf-8'); } catch (e) { die(`读不到 ${editSitePath}: ${e.message}`); }
const start = editSite.indexOf('\n## Images\n');
if (start < 0) die('scripts/edit-site.js 的提示词里找不到 `## Images` 那一段 —— 它被改名或删掉了');
const rest = editSite.slice(start + 1);
const endRel = rest.indexOf('\n## ');
if (endRel < 0) die('`## Images` 之后再没有下一个 `## ` 小节 —— 抠不出这一段的边界');
const imagesSection = rest.slice(0, endRel);
if (imagesSection.length < 400) die(`抠出来的 ## Images 段只有 ${imagesSection.length} 个字符 —— 尺子指错地方了`);

// 段里点名的字段（反引号里的，反引号在模板字符串里是转义的 \`）
const promptFields = new Set(
  [...imagesSection.matchAll(/\\`([^`\\]+)\\`/g)]
    .map((m) => leafOf(m[1].replace(/\[\]/g, '')))
    .filter((f) => f && /url$/i.test(f)),
);
// 段里点名的块类型（`- a **hero** block →` 这种行）
const promptBlocks = new Set(
  [...imagesSection.matchAll(/^-\s+a\s+\*\*([a-z0-9-]+)\*\*\s+block/gm)].map((m) => m[1]),
);
if (promptFields.size === 0) die('从 ## Images 段里一个字段名都没解出来 —— 尺子坏了（反引号写法变了？）');
if (promptBlocks.size === 0) die('从 ## Images 段里一个块类型都没解出来 —— 尺子坏了（行首写法变了？）');
ok(`提示词现读：点名的字段 ${promptFields.size} 个（${[...promptFields].join(' · ')}）`
   + `；点名的块 ${promptBlocks.size} 个（${[...promptBlocks].join(' · ')}）`);

// ── 判据：两个方向 ────────────────────────────────────────────────────────────────────────────
const diff = (a, b) => [...a].filter((x) => !b.has(x));
const blockSet = new Set(blocksThatDrawImages);

const onlyPromptB = diff(promptBlocks, blockSet);
const onlyTplB = diff(blockSet, promptBlocks);
onlyPromptB.length
  ? bad(`提示词点名了模板**不画图**的块: ${onlyPromptB.join(' · ')} —— 模型会把地址写进一个永远不显示的位置`)
  : ok('提示词点名的块，模板都真的画图');
onlyTplB.length
  ? bad(`模板画图、提示词**没写**的块: ${onlyTplB.join(' · ')} —— 模型不知道那里能放图，老板永远换不了那张`)
  : ok('模板画图的块，提示词都点到了');

const onlyPromptF = diff(promptFields, leafFields);
const onlyTplF = diff(leafFields, promptFields);
onlyPromptF.length ? bad(`提示词点名了模板不读的字段: ${onlyPromptF.join(' · ')}`)
                   : ok('提示词点名的字段，模板都真的读');
onlyTplF.length ? bad(`模板读、提示词没写的字段: ${onlyTplF.join(' · ')}`)
                : ok('模板读的字段，提示词都点到了');

// ── ① 的另一半：博客正文这一面，提示词那份位置清单里有没有它（#1199）──────────────────────────
// 🔴 判据不是「我记得该写一句」，而是从**两侧现读**推出来的：
//    ① 模板真的把博客正文当 HTML 画吗（BlogPostPage 的 dangerouslySetInnerHTML + post.content）
//    ② 那个文件真的可写吗（editable-files.js 的白名单里有 blog/*.json）
//    两个都成立 ⟹ 它就是一个「能放图的位置」，提示词漏了它，老板就永远换不掉文章里那张图
//    （方向跟 §二 那条「模板画了、清单没写」完全同形，只是这一面 §二 的尺子按构造量不到 ——
//     它抠的是 JSX 的 `<img src={…}>`，HTML 字符串里的图不在它射程内）。
const blogPagePath = path.join(SRC, 'components', 'pages', 'BlogPostPage.tsx');
let blogPage;
try { blogPage = fs.readFileSync(blogPagePath, 'utf-8'); } catch (e) { die(`读不到 ${blogPagePath}: ${e.message}`); }
const blogRendersHtml = /dangerouslySetInnerHTML=\{\{\s*__html:\s*post\.content\s*\}\}/.test(blogPage);
const editablePath = path.join(NEXT, 'scripts', 'lib', 'editable-files.js');
let editable;
try { editable = fs.readFileSync(editablePath, 'utf-8'); } catch (e) { die(`读不到 ${editablePath}: ${e.message}`); }
const blogIsWritable = /r\[0\] === 'blog'/.test(editable);
// 🔴 分母自检：两侧任一读不出来 ⟹ 这一格的前提没了，不是「通过」。
if (!blogRendersHtml || !blogIsWritable) {
  die(`博客那一面的前提读不出来（正文当 HTML 画=${blogRendersHtml} · blog/*.json 可写=${blogIsWritable}）`
      + ' —— 要么这一面真的没了（那就把这一格和闸里的 HTML 分支一起删），要么尺子指错地方了');
}
const blogNamedInPrompt = (sect) => /blog\//.test(sect) && /<img/.test(sect);
blogNamedInPrompt(imagesSection)
  ? ok('提示词的 ## Images 段点到了博客正文这一面（模板真的把它当 HTML 画，且那个文件可写）')
  : bad('模板把博客正文当 HTML 画、blog/*.json 又可写，而 ## Images 段里没有它 —— 老板永远换不掉文章里那张图');
// 反向臂：把那几行从提示词里拿掉，这一格必须当场红。
blogNamedInPrompt(imagesSection.replace(/^- \*\*a blog post\*\*[\s\S]*?(?=\n\n|\n- |$)/m, ''))
  ? bad('把提示词里博客那几行删掉之后这一格【没】红 —— 它判的不是那几行')
  : ok('故意写坏「提示词里博客那一条」→ 那一格当场红');

// ── 顺带：写入闸认的字段集必须覆盖模板读的全部字段 ────────────────────────────────────────────
const uncovered = [...leafFields].filter((f) => !IMAGE_FIELDS.includes(f));
uncovered.length
  ? bad(`lib/image-urls.js 的 IMAGE_FIELDS 漏了模板真的画的字段: ${uncovered.join(' · ')} —— 那道写入闸对它按构造失明`)
  : ok(`写入闸的 IMAGE_FIELDS（${IMAGE_FIELDS.join(' · ')}）覆盖了模板读的全部字段`);

// ══ 二之五、#1210 AC1：主机那一维 ══════════════════════════════════════════════════════════════
// 🔴 `//` 那一支原来用一个**字面**先行断言 `(?=[\w-]+\.)` 判「后面是不是域名」，只认 ASCII 字母加
//    ASCII 点；浏览器认的是 WHATWG 归一化之后的主机。下面五种写法在 `origin/main` 上**全部放行**，
//    而真 chromium 全部跨主机取了图。今天的判据是 `new URL('https:' + 归一化值).host` 含不含点。
// 🔴 **每一种都配两向**：同一种写法、路径换成老板给过的那个 → 必须放行。少了这一半，一个
//    「什么都拒」的实现在上面那半边也全绿。
console.log('\n── 二之五、#1210 AC1：主机那一维（Unicode 点 / IDN / %2E / 前导点）──');

const U3002 = '。';        // U+3002 IDEOGRAPHIC FULL STOP —— 中文输入法里最常见的替身
const UFF0E = '．';        // U+FF0E FULLWIDTH FULL STOP
const GIVEN_TAIL = '/u1/8f3c1d2ab_photo.jpg';        // ATTACHED 的路径
const BAD_TAIL   = '/u1/profile-photo.jpg';          // INVENTED 的路径（#1195 生产站上那个真 404）
// 只放一条附件进名单 ⟹ 名单里就一个地址，两向的唯一变量是**路径**。
const attOnly = (u) => collectAllowedImageUrls({ images: [{ url: u }], message: '', conversationHistory: [] });

// 第三列 `self` = 这种写法自己那份名单（前导点与 IDN 归一化出来的是**另一个主机**，
// 拿老板那个 ASCII 域名的名单去比，拒才是对的 ⟹ 两向对照必须把同一种写法喂进名单）。
const F1_HOSTS = [
  ['%2E 百分号点',    'uploads%2Eai1stsite.app',           'clean'],
  ['U+3002 中文句号', `uploads${U3002}ai1stsite.app`,      'clean'],
  ['U+FF0E 全角点',   `uploads${UFF0E}ai1stsite.app`,      'clean'],
  ['前导点',          '.uploads.ai1stsite.app',            'self'],
  ['原生 IDN',        'münchen.example',                   'self'],
];
const F1_CHANNELS = [
  ['<img src>',        (u) => ({ slug: 'p', content: `<img src="${u}">` })],
  ['<td background>',  (u) => ({ slug: 'p', content: `<table><tr><td background="${u}">c</td></tr></table>` })],
  ["CSS url('…')",     (u) => ({ slug: 'p', content: `<div style="background-image:url('${u}')">x</div>` })],
  ['imageUrl 字段',    (u) => ({ blocks: [{ data: { imageUrl: u } }] })],
];
for (const [hname, host, mode] of F1_HOSTS) {
  const good = `//${host}${GIVEN_TAIL}`;
  const bad = `//${host}${BAD_TAIL}`;
  const known = mode === 'clean' ? attOnly(ATTACHED) : attOnly(good);
  for (const [cname, mk] of F1_CHANNELS) {
    grid(`AC1 ${hname} · ${cname} · 编造的路径`, mk(bad), known, '拒');
    grid(`AC1 ${hname} · ${cname} · 【老板给过】的那条路径（两向对照）`, mk(good), known, '放行');
  }
}
// 🔴 分母自检：这五种归一化出来的主机必须**真的含点**，否则上面那半边的「拒」是别的原因给的。
{
  const want = [
    [`//uploads%2Eai1stsite.app${BAD_TAIL}`,            'uploads.ai1stsite.app'],
    [`//uploads${U3002}ai1stsite.app${BAD_TAIL}`,       'uploads.ai1stsite.app'],
    [`//uploads${UFF0E}ai1stsite.app${BAD_TAIL}`,       'uploads.ai1stsite.app'],
    [`//.uploads.ai1stsite.app${BAD_TAIL}`,             '.uploads.ai1stsite.app'],
    ['//münchen.example/x.png',                         'xn--mnchen-3ya.example'],
  ];
  const wrong = want.filter(([u, h]) => lib.canonicalAddress(u) !== `//${h}${u.slice(u.indexOf('/', 2))}`);
  wrong.length === 0
    ? ok(`AC1 归一化直读 ${want.length} 格全部对得上（%2E / U+3002 / U+FF0E → 同一个主机；IDN → punycode；前导点保留）`)
    : bad(`AC1 归一化 ${wrong.length}/${want.length} 格不对: `
        + wrong.map(([u]) => `${JSON.stringify(u)} → ${JSON.stringify(lib.canonicalAddress(u))}`).join(' · '));
}

// ══ 二之六、#1210 AC2：首部 C0 控制字符 ═════════════════════════════════════════════════════════
// 🔴 WHATWG 基本 URL 解析器的**第一步**是剥掉首尾的 C0 与空格（`\x00`–`\x20`）。这里原来用的是
//    JS 的 `.trim()`，它剥空白但**不剥** `\x01`–`\x08` / `\x0e`–`\x1f` ⟹ 三种在 main 上放行。
// 🔴 阴性对照钉的是「只剥首尾、不剥中间」：C0 落在主机里浏览器根本不去取，收它就是凭空造的误拒。
console.log('\n── 二之六、#1210 AC2：首部 C0 控制字符 ─────────────────────────');

const C0_PREFIXES = [['\\x01', String.fromCharCode(1)], ['\\x1f', String.fromCharCode(31)],
                     ['\\x08', String.fromCharCode(8)]];
const C0_BODIES = [['///域名', (hp) => `///${hp}`], ['http://域名', (hp) => `http://${hp}`]];
const C0_CHANNELS = [
  ['<img src>',     (u) => ({ slug: 'p', content: `<img src="${u}">` })],
  ['imageUrl 字段', (u) => ({ blocks: [{ data: { imageUrl: u } }] })],
];
for (const [pname, p] of C0_PREFIXES) {
  for (const [bname, mkAddr] of C0_BODIES) {
    for (const [cname, mk] of C0_CHANNELS) {
      grid(`AC2 ${pname} + ${bname} · ${cname}`, mk(p + mkAddr(HOST_PATH)), allowed, '拒');
      // 两向：同一种写法、地址换成老板给过的那个。`http://` 那一支要换成 https（归一化不跨 scheme，
      // 这是 #1207 立的线，不是本票的洞）。
      const giv = bname === 'http://域名' ? `https://${GIVEN_HOSTPATH}` : `///${GIVEN_HOSTPATH}`;
      grid(`AC2 ${pname} + ${bname} · ${cname} · 【老板给过】的那张（两向对照）`,
           mk(p + giv), allowed, '放行');
    }
  }
}
// 阴性对照：C0 落在**主机中间** —— 浏览器不去取（C0 在主机里是解析错误），改前改后都必须放行。
for (const [pname, p] of C0_PREFIXES) {
  grid(`AC2 阴性对照 C0(${pname}) 插在主机中间（浏览器不取 ⟹ 收它就是误拒）`,
       { slug: 'p', content: `<img src="//uploads${p}.ai1stsite.app${BAD_TAIL}">` }, allowed, '放行');
}
// 阴性对照：`.trim()` 会剥、WHATWG 不剥的那两个（BOM / NBSP）—— 剥的这一类**比 trim 窄**才是对的。
// 🔴 它们在**到这里之前**已经被 `:365` / `:408` 那两次 `.trim()` 剥掉了（JS 的 trim 认 BOM 与 NBSP），
//    所以这一格量的是「窄了没把老板给过的那张弄丢」，不是「BOM 前缀会被拒」。
grid('AC2 阴性对照 BOM + 老板给过的那张（上游 trim 已剥，仍要放行）',
     { blocks: [{ data: { imageUrl: `﻿${ATTACHED}` } }] }, allowed, '放行');

// ══ 二之七、#1210 AC3：HTML 实体 ═══════════════════════════════════════════════════════════════
// 🔴 博客正文按 HTML 渲染，HTML 解析器**在把属性值交给 URL 解析器之前**先解实体 ⟹ 四种写法在
//    main 上全部放行，而浏览器真去取了。解实体只在 `extractHtmlImageUrls` 那一侧做一次。
// 🔴 阴性对照钉的是「判定那一侧不解」：`imageUrl` 是模板用 JS 赋属性画的，那条路**不解实体**，
//    在那边解就是凭空造的误拒。
console.log('\n── 二之七、#1210 AC3：HTML 实体 ────────────────────────────────');

const ENT_FORMS = [
  ['&#x2F; ×3（数字实体的斜杠）', (hp) => `&#x2F;&#x2F;&#x2F;${hp}`],
  ['&sol;&sol;（具名实体的斜杠）', (hp) => `&sol;&sol;${hp}`],
  ['scheme 里的 &#58;',            (hp) => `https&#58;//${hp}`],
  ['scheme 首字母 &#104;',         (hp) => `&#104;ttps://${hp}`],
];
for (const [ename, mkAddr] of ENT_FORMS) {
  for (const [cname, mk] of [
    ['<img src>',       (u) => ({ slug: 'p', content: `<img src="${u}">` })],
    ['<td background>', (u) => ({ slug: 'p', content: `<table><tr><td background="${u}">c</td></tr></table>` })],
  ]) {
    grid(`AC3 ${ename} · ${cname}`, mk(mkAddr(HOST_PATH)), allowed, '拒');
    grid(`AC3 ${ename} · ${cname} · 【老板给过】的那张（两向对照）`,
         mk(mkAddr(GIVEN_HOSTPATH)), allowed, '放行');
  }
  // 阴性对照：同一个实体串写进 `imageUrl` 字段（模板用 JS 赋属性画，不解实体）⟹ 改前改后都放行。
  grid(`AC3 阴性对照 ${ename} 写进 imageUrl 字段（JS 赋属性不解实体 ⟹ 不许收）`,
       { blocks: [{ data: { imageUrl: mkAddr(HOST_PATH) } }] }, allowed, '放行');
}
// 票正文点名的那两种 http 写法单独各一格（上面两向那半边用的是 https，这里补 http 那一支）。
grid('AC3 http&#58;// + 编造的域名', { slug: 'p', content: `<img src="http&#58;//${HOST_PATH}">` }, allowed, '拒');
grid('AC3 &#104;ttp:// + 编造的域名', { slug: 'p', content: `<img src="&#104;ttp://${HOST_PATH}">` }, allowed, '拒');
// 🔴 `&Tab;` / `&NewLine;`：解出来正是 `URL_STRIP_RE` 要删掉的那两个字符（WHATWG 第二步）
//    ⟹ `ht&Tab;tp://编造域名` 浏览器真去取，这里必须拒；换成老板给过的那张必须放行。
grid('AC3 ht&Tab;tp:// + 编造的域名', { slug: 'p', content: `<img src="ht&Tab;tps://${HOST_PATH}">` }, allowed, '拒');
grid('AC3 ht&Tab;tp:// + 【老板给过】的那张（两向对照）',
     { slug: 'p', content: `<img src="ht&Tab;tps://${GIVEN_HOSTPATH}">` }, allowed, '放行');
// 🔴 阴性对照 `&nbsp;`：它映到 U+00A0，**不在**具名实体表里（表只收映到 ASCII 的）。WHATWG 只剥
//    C0 与空格、不剥 U+00A0 ⟹ 浏览器不把它当地址；收了它就是凭空造的误拒。改前改后都放行。
grid('AC3 阴性对照 &nbsp;http://…（U+00A0 不在表里 ⟹ 不许收）',
     { slug: 'p', content: `<img src="&nbsp;http://${HOST_PATH}">` }, allowed, '放行');
// 🔴 `<style>` 元素是 raw text，HTML 解析器**不**在里面解实体 ⟹ 这一格改前改后都放行，别去"修"它。
grid('AC3 阴性对照 <style> 元素里的实体（raw text，浏览器不解 ⟹ 不许收）',
     { slug: 'p', content: `<style>.z{background-image:url('&#x2F;&#x2F;${HOST_PATH}')}</style>` },
     allowed, '放行');

// ══ 二之八、#1210 AC5：`&amp;` 那个误拒 ════════════════════════════════════════════════════════
// 🔴 合法 HTML 里 `&` 本来就该写成 `&amp;`。老板给一个带查询串的地址、模型按规范写，`origin/main`
//    上**拒** —— 一个今天就在发生的误拒，解一次实体顺手修好。裸 `&` 两侧都必须放行。
console.log('\n── 二之八、#1210 AC5：`&amp;` 那个误拒 ─────────────────────────');
{
  const AMP_URL = 'https://uploads.ai1stsite.app/a.jpg?x=1&y=2';
  const ampKnown = collectAllowedImageUrls({ images: [], message: `用这张 ${AMP_URL} 谢谢`, conversationHistory: [] });
  ampKnown.has(AMP_URL) ? ok('AC5 前提：老板打的那条带 `&` 的地址真的进了放行名单')
                        : die(`AC5 的前提没了：放行名单里没有 ${AMP_URL}（现读 ${[...ampKnown].join(' · ')}）`);
  grid('AC5 `&amp;` 写法（合规 HTML）—— 改前拒、改后必须放行',
       { slug: 'p', content: '<img src="https://uploads.ai1stsite.app/a.jpg?x=1&amp;y=2">' }, ampKnown, '放行');
  grid('AC5 裸 `&` 写法 —— 两侧都放行',
       { slug: 'p', content: '<img src="https://uploads.ai1stsite.app/a.jpg?x=1&y=2">' }, ampKnown, '放行');
  // 🔴 解实体不许把**没给过**的地址也放过去：同一个查询串换个主机仍要拒。
  grid('AC5 `&amp;` 写法 + 编造的主机（解实体不是放行通道）',
       { slug: 'p', content: '<img src="https://evil.example.com/a.jpg?x=1&amp;y=2">' }, ampKnown, '拒');
  // 🔴 不带分号的具名实体**不解** —— `?a=1&amp=2` 是合法查询串，解了就是凭空造的误拒。
  const AMPQ = 'https://uploads.ai1stsite.app/b.jpg?a=1&amp=2';
  const ampqKnown = collectAllowedImageUrls({ images: [{ url: AMPQ }], message: '', conversationHistory: [] });
  grid('AC5 阴性对照 `&amp=2`（没有分号 ⟹ 不是实体，不许解）',
       { slug: 'p', content: `<img src="${AMPQ}">` }, ampqKnown, '放行');
}

// ── 回执报数：本票三族各一个写进同一份内容 → 必须点名三个地址，不多不少 ────────────────────────
{
  const three = { slug: 'p',
    content: `<img src="//uploads${U3002}ai1stsite.app/u1/a.jpg">`
      + `<img src="${String.fromCharCode(1)}///uploads.ai1stsite.app/u1/b.jpg">`
      + `<img src="&#x2F;&#x2F;&#x2F;uploads.ai1stsite.app/u1/c.jpg">` };
  const why = imageUrlRejection(three, allowed);
  if (!why) die('#1210 三族一起写进去竟然放行了 —— 这一格的前提没了');
  // 🔴 只在**列地址那一段**里数：整句上跑 `/"[^"]+"/g` 会把尾巴那句 `(see "Images" …)` 也数进来。
  const head = why.slice(0, Math.max(why.indexOf(' is an address'), why.indexOf(' are addresses')));
  if (!head) die('回执里找不到「is an address / are addresses」那一段 —— 报数这把尺子指错地方了');
  const named = [...new Set((head.match(/"[^"]+"/g) || []))].length;
  named === 3 ? ok('#1210 回执点名了 3 个地址（三族各一个，报数与构造对得上）')
              : bad(`#1210 回执点名了 ${named} 个地址，构造的是 3 个: ${why.slice(0, 240)}`);
}

// ══ 二之九、#1223 AC1：IPv6 字面量主机（该拦没拦）══════════════════════════════════════════════
// 🔴 `[2001:db8::1]` 这种主机**一个点都没有**，所以 #1210 那条「含不含点」把它跟 `//photos/hero.jpg`
//    归成一类放行了 —— 而 chromium 真的跨主机去取它。同一件事的 IPv4 写法 `//192.0.2.1/x.png`
//    因为带点被拒 ⟹ 同一件事两个答案。判据换成「主机那一段以 `[` 开头就追责」。
// 🔴 **每一种都配两向**：同一种写法、路径换成老板给过的那条 → 必须放行。少了这一半，一个
//    「IPv6 一律拒」的实现在上面那半边也全绿。名单用 `self`（这些主机跟 ATTACHED 不是同一个）。
console.log('\n── 二之九、#1223 AC1：IPv6 字面量主机 ──────────────────────────');

const V6_HOSTS = [
  ['IPv6 字面量',       '[2001:db8::1]'],
  ['IPv6 回环',         '[::1]'],
  // 🔴 这一格 chromium **一个请求都不发**（四种写法量过），仍然收 —— 判据是「老板的正文里会不会
  //    出现这个形状」，而主机以 `[` 开头没有第二种合法读法。理由写在 `isImageAddress` 上面。
  ['IPv6 带 zone id',   '[fe80::1%25eth0]'],
];
// AC1 点名的三条路。
const V6_CHANNELS = [
  ['<img src>',     (u) => ({ slug: 'p', content: `<img src="${u}">` })],
  ["CSS url('…')",  (u) => ({ slug: 'p', content: `<div style="background-image:url('${u}')">x</div>` })],
  ['imageUrl 字段', (u) => ({ blocks: [{ data: { imageUrl: u } }] })],
];
for (const [hname, host] of V6_HOSTS) {
  const good = `//${host}${GIVEN_TAIL}`;
  const known = attOnly(good);
  for (const [cname, mk] of V6_CHANNELS) {
    grid(`AC1 ${hname} · ${cname} · 编造的路径`, mk(`//${host}${BAD_TAIL}`), known, '拒');
    grid(`AC1 ${hname} · ${cname} · 【老板给过】的那条路径（两向对照）`, mk(good), known, '放行');
  }
}
// 🔴 分母自检：这三种的主机那一段**真的**以 `[` 开头（否则上面那半边的「拒」是别的原因给的），
//    而且前两种 `new URL` 解析得出来、第三种解析不出来 —— 判据不许依赖解析得出来这件事。
{
  const seg = (u) => (String(u).match(/^(?:https?:[/\\]*|\/\/)([^/\\?#]*)/i) || [, ''])[1];
  const rows = V6_HOSTS.map(([, h]) => `//${h}${BAD_TAIL}`);
  const notBracket = rows.filter((u) => !seg(lib.canonicalAddress(u)).startsWith('['));
  notBracket.length === 0
    ? ok(`AC1 分母自检：${rows.length} 格归一化之后主机那一段都以 \`[\` 开头`)
    : bad(`AC1 分母自检失败：${notBracket.join(' · ')} 归一化之后主机那一段不以 \`[\` 开头`);
  let parses = 0;
  for (const u of rows) { try { new URL('https:' + u); parses += 1; } catch (e) { /* 解析不出来正是要点 */ } }
  parses === 2
    ? ok('AC1 分母自检：三格里 2 格 `new URL` 解析得出来、1 格解析不出来 —— 判据没有依赖「解析得出来」')
    : bad(`AC1 分母自检：期望 2 格能解析，实测 ${parses} 格 —— 这三格不再覆盖「解析不出来」那一档`);
}
// 🔴 #1199 那条线没被吃掉（AC3）：单标签主机与相对路径改前改后都放行。
for (const r of ['//photos/hero.jpg', '///localhost:8080/x.png', '/photos/hero.jpg', 'photos/hero.jpg']) {
  lib.isImageAddress(r) === false ? ok(`AC3 #1199 那条线还在：${r} → 放行`)
                                  : bad(`AC3 #1199 那条线被吃掉了：${r} → 追责`);
}
// 🔴 本票**不动**的那一格，钉住它，免得下一个人以为是漏改：`^` 那种可能是老板打错的站内相对
//    路径，收它才是真误拒。两支对它仍然给相反答案，这是已知边界（#1223 正文点名不改）。
(lib.isImageAddress('//evil^example.com/x.png') === false
  && lib.isImageAddress('https://evil^example.com/x.png') === true)
  ? ok('AC1 已知边界：`//evil^example.com/x` 仍放行、`https://` 那支仍追责（本票有意不动）')
  : bad('AC1 已知边界变了：`evil^example.com` 两支的读数不再是 放行/追责');
// 🔴 `[` 开头那两种形状，两支现在对齐了（本票收的就是这一条）。
{
  const off = ['//[2001:db8::1]/x.png', '//[fe80::1%25eth0]/x.png']
    .filter((u) => lib.isImageAddress(u) !== lib.isImageAddress('https:' + u));
  off.length === 0 ? ok('AC1 两支对齐：`[` 开头那两种形状 `//` 与 `https://` 给同一个答案')
                   : bad(`AC1 两支仍不一致: ${off.join(' · ')}`);
}

// 🔴 **这个修法自己的反向风险，量出来钉在这里（#1223 DEV 自查，不是 AC 要求的）。**
//    收了 IPv6 之后，「老板真给过一个 IPv6 地址」这件事就变成了要能放行的情形。四类来源里
//    **只有正文/历史那两类过 `ADDR_TAIL` 正则，而它有意排除 `]`**（`[text](url)` 那种写法要靠它
//    断开）⟹ 老板在聊天里**打字**给一个 IPv6 地址，抠出来是截断的半截，模型照抄完整地址会被误拒。
//    附件与站内 JSON 那两类不经正则，完整放行（下面两格量的就是这个）。
//    📌 **本票不动 `ADDR_TAIL`**：正文点名不许顺手动别的维，而收 IPv6 的整个理由正是
//    「老板的正文里按构造不会出现这个形状」—— 那个前提同时说明这条路走不到。真要改，是另一张票。
{
  const V6 = '//[2001:db8::1]/x.png';
  const fromText = lib.extractUrls(`用这张 ${V6} 谢谢`);
  fromText.length === 1 && fromText[0] === '//[2001:db8::1'
    ? ok('AC1 已知边界：老板【打字】给 IPv6 地址会被 ADDR_TAIL 在 `]` 处截断（本票不动它）')
    : bad(`AC1 已知边界变了：正文里抠出来的是 ${JSON.stringify(fromText)}，期望截断成 "//[2001:db8::1"`);
  const att = collectAllowedImageUrls({ images: [{ url: V6 }], message: '', conversationHistory: [] });
  grid('AC1 已知边界的另一半：走【附件】给同一个 IPv6 地址 → 完整进名单、放行',
       { blocks: [{ data: { imageUrl: V6 } }] }, att, '放行');
}

// ══ 二之十、#1223 AC2：放行名单那一侧也过同一台归一化器（该放没放）══════════════════════════════
// 🔴 归一化改之前只做在**被测那一侧**，名单里放的是老板给的原样字符串 ⟹ 同一个地址的两种写法
//    只有一个方向对得上。规律干净：**老板给的那份不是归一化后的形状，就一定被拒**。
//    覆盖面按 `canonicalHost` 收平的全集逐族取，每族两向。
console.log('\n── 二之十、#1223 AC2：名单那一侧也归一化 ───────────────────────');

// 每族一对「同一个地址的两种写法」。左边是老板可能打出来的那种，右边是归一化之后的那种。
const F2_PAIRS = [
  ['原生 IDN ↔ punycode', 'https://例え.jp/x.png',        'https://xn--r8jz45g.jp/x.png'],
  ['`%2E` ↔ `.`',         'https://a%2Eb.example/x.png',  'https://a.b.example/x.png'],
  [`U+3002 \`${U3002}\` ↔ \`.\``, `https://a${U3002}b.example/x.png`, 'https://a.b.example/x.png'],
  [`U+FF0E \`${UFF0E}\` ↔ \`.\``, `https://a${UFF0E}b.example/x.png`, 'https://a.b.example/x.png'],
  ['大写 ↔ 小写',         'https://EXAMPLE.com/x.png',    'https://example.com/x.png'],
];
for (const [label, a, b] of F2_PAIRS) {
  grid(`AC2 ${label} · 老板给左边、模型写右边`, { blocks: [{ data: { imageUrl: b } }] }, attOnly(a), '放行');
  grid(`AC2 ${label} · 老板给右边、模型写左边（反向）`, { blocks: [{ data: { imageUrl: a } }] }, attOnly(b), '放行');
}
// 🔴 分母自检：每一对的两种写法**真的**归一化到同一个字符串，否则上面十格的「放行」是别的原因给的。
{
  const off = F2_PAIRS.filter(([, a, b]) => lib.canonicalAddress(a) !== lib.canonicalAddress(b));
  off.length === 0
    ? ok(`AC2 分母自检：${F2_PAIRS.length} 对逐对归一化到同一个字符串`)
    : bad(`AC2 分母自检失败：${off.map(([l]) => l).join(' · ')} 两边归一化结果不同`);
}
// 🔴 名单变宽了，但**不许**变宽到别的地址上去。这三格是这条修法的安全侧：
//    编造的地址照样拒；而 `addressForms` 有意不跨 scheme 那条线也不许被名单这一侧顶掉
//    （我第一版用 `addressForms` 展开名单，就是在这里破的 —— 两格同时红）。
grid('AC2 安全侧 · 编造的地址照样拒',
     { blocks: [{ data: { imageUrl: 'https://made-up.example/x.png' } }] },
     attOnly('https://a.b.example/x.png'), '拒');
grid('AC2 安全侧 · 老板给 https、模型写 http（归一化不跨 scheme）',
     { blocks: [{ data: { imageUrl: 'http://h.example/p.png' } }] },
     attOnly('https://h.example/p.png'), '拒');
grid('AC2 安全侧 · 老板给 http、模型写 https（反向也不跨）',
     { blocks: [{ data: { imageUrl: 'https://h.example/p.png' } }] },
     attOnly('http://h.example/p.png'), '拒');

// ══ 三、故意写坏（每条新覆盖面一格单变量反向臂）════════════════════════════════════════════════
// 🔴 上面那些格子只证明「现在的实现在这几个输入上答对了」。它**不**证明那几行代码是承重的 ——
//    一个把「什么都放行」写死的实现在阳性格上也全绿。所以每条新覆盖面配一格：把它那一处
//    （**只有那一处**）改回 #1195 的写法，对应的格子必须当场翻面。
// 🔴 而且要先证明**这一刀真的切下去了** —— needle 找不到就是 die，不是"跳过"。
//    「什么都没改到」和「改了但行为不变」在一个只看结果的实现里长得一模一样。
console.log('\n── 三、故意写坏：每条覆盖面一格单变量反向臂 ─────────────────────');

const LIB_SRC = fs.readFileSync(path.join(__dirname, 'image-urls.js'), 'utf-8');
const mutDir = fs.mkdtempSync(path.join(os.tmpdir(), 'imgurl-mut-'));
process.on('exit', () => { try { fs.rmSync(mutDir, { recursive: true, force: true }); } catch (e) { /* 打扫不改结论 */ } });

let mutN = 0;
/** 只改一处，返回改坏之后的那个模块。needle 必须命中且**只命中一次**。 */
function mutate(needle, replacement) {
  const hits = LIB_SRC.split(needle).length - 1;
  if (hits !== 1) die(`反向臂的 needle 在 image-urls.js 里命中 ${hits} 次（要 1 次）: ${needle.slice(0, 60)}…`);
  mutN += 1;
  const f = path.join(mutDir, `m${mutN}.js`);
  fs.writeFileSync(f, LIB_SRC.split(needle).join(replacement));
  return require(f);
}
/**
 * 改坏之后那一格必须变成 `broken`；没变 = 那几行不承重，或者刀没切在承重处。
 *
 * 🔴 `baseline`（第 6 个参数，可选）= **改坏之前**那一格该读到什么。给了就先量一次没改坏的，
 *    读数不是 `baseline` 就当场红。#1218 加的，起因是它抓到的一把**空刀**：
 *    那把刀（`WS_SET` 拿掉 NBSP → `url(<NBSP>"编造.png")` 期望翻成「放行」）在 #1218 把
 *    `url()` 那趟换成 CSS 的 5 个空白之后，**没改坏的时候读数本来就已经是「放行」** ——
 *    两边同值，于是它照样打 ✅。**「翻面了」和「本来就是这个值」在只看结果的实现里长得一模一样。**
 *    ⚠️ 只有新加的几把刀传了这个参数；另外那 61 把没传（那是 #1218 圈外，见票上留言）。
 */
function arm(label, needle, replacement, probe, broken, baseline) {
  if (baseline !== undefined) {
    const got0 = probe(lib);
    if (got0 === broken) {
      bad(`「${label}」这把刀是空的：没改坏时读数就已经是 ${broken}（= 期望的改坏读数）—— 它不可能红`);
      return;
    }
    if (got0 !== baseline) {
      bad(`「${label}」改坏之前那一格读到 ${got0}，期望 ${baseline} —— 这把刀的前提不成立，先弄清楚再判`);
      return;
    }
  }
  const m = mutate(needle, replacement);
  const got = probe(m);
  // 🔴 传了 `baseline` 的,把**两边**的读数都打出来 —— 只打一个数看不出它翻没翻面（#1218）。
  const shown = baseline === undefined ? `（改前就是这个读数）` : `（没改坏时是 ${baseline} ⟹ 真翻面了）`;
  got === broken ? ok(`故意写坏「${label}」→ 那一格翻成 ${broken}${shown}`)
                 : bad(`故意写坏「${label}」→ 期望翻成 ${broken}，实测 ${got} —— 这条覆盖面不是那几行撑的`);
}

const rej = (m, parsed, known) => (m.imageUrlRejection(parsed, known) ? '拒' : '放行');
const allowedIn = (m) => m.collectAllowedImageUrls({
  siteDir, images: [{ url: ATTACHED, originalFilename: 'photo.jpg' }],
  message: '把关于我们页那张顾问照片换成这张', conversationHistory: [],
});

// ① 博客正文的 <img src>
arm('博客正文那一面（collectImagePositions 的字符串分支）',
  'for (const u of extractHtmlImageUrls(node)) acc.push(u);', '',
  (m) => rej(m, { slug: 'p', content: `<p><img src="${INVENTED}"></p>` }, allowedIn(m)), '放行');

// ① 同一面的 style url()
// 🔴 needle 随 #1204 换了：`style=` 不再是一条独立正则，它是标签扫描里的一个分支。
arm('博客正文里的 style="…url(…)"',
  "if (name === 'style') { pushCss(value); continue; }",
  "if (name === 'styleNEVER') { pushCss(value); continue; }",
  (m) => rej(m, { slug: 'p', content: `<div style="background-image:url('${INVENTED}')">x</div>` }, allowedIn(m)), '放行');

// ② 第 ④ 类来源改回扫原文
arm('第 ④ 类来源只取图片位置（改回扫原文就洗白）',
  "collectImagePositions(JSON.parse(fsmod.readFileSync(full, 'utf-8')))",
  "extractUrls(fsmod.readFileSync(full, 'utf-8'))",
  (m) => {
    const known = m.collectAllowedImageUrls({ siteDir: siteDir2, images: [], message: '换个图', conversationHistory: [] });
    return rej(m, { blocks: [{ data: { imageUrl: INVENTED } }] }, known);
  }, '放行');

// ③ 判定的过滤改回只认 http(s)
arm('判定认 // 与 data:（改回只认 http(s) 就整条溜过去）',
  "new RegExp('^' + ADDR_HEAD, 'i')", "new RegExp('^https?://', 'i')",
  (m) => rej(m, { blocks: [{ data: { imageUrl: STOCK_REL } }] }, allowedIn(m)), '放行');
arm('同上，data: 那一维',
  "new RegExp('^' + ADDR_HEAD, 'i')", "new RegExp('^https?://', 'i')",
  (m) => rej(m, { blocks: [{ data: { imageUrl: 'data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=' } }] }, allowedIn(m)), '放行');

// ③ // 与 https 的等价写法（这一刀的方向相反：拆掉它是【误拒】）
arm('`//h/p` 与 `https://h/p` 是同一张图（拆掉就误拒老板给过的那张）',
  '!addressForms(u).some((f) => known.has(f))', '!known.has(u)',
  (m) => rej(m, { blocks: [{ data: { imageUrl: ATTACHED.replace(/^https:/, '') } }] }, allowedIn(m)), '拒');

// ④ 全角标点
arm('抠地址时排除全角标点（改回 ASCII-only）',
  String.raw`\\u3000-\\u303f\\uff00-\\uffef\\u2018-\\u201f\\u2026`, '',
  (m) => (m.extractUrls(`你用这张 ${CLEAN}。`)[0] === CLEAN ? '干净' : '脏'), '脏');

// ④ 英文句尾那半（中文有边界靠排除类，英文靠削尾巴 —— 两个机制，各一刀）
arm('削掉英文句尾的标点',
  '/[.,;:!?]+$/', '/(?!)/',
  (m) => (m.extractUrls(`use ${CLEAN}.`)[0] === CLEAN ? '干净' : '脏'), '脏');

// ── #1204：每条新覆盖面一刀。把它在 IMAGE_ATTRS 里那一行（**只有那一行**）拿掉，对应格子必须翻面。
// 🔴 这一族刀切的是「表里有没有这一行」，不是「代码跑不跑得动」—— 少了它整个实现照样绿，
//    而那正是 #1199 的形态：两条写死的正则，别的写法在它眼皮底下静默放行。
for (const [label, needle, replacement, content] of [
  ['<img srcset>',            "img: ['src', 'srcset'],",              "img: ['src'],",
   `<img srcset="${INVENTED} 1x">`],
  ['<picture><source srcset>', "source: ['srcset'],",                 'source: [],',
   `<picture><source srcset="${INVENTED}"><img alt="x"></picture>`],
  ['<video poster>',          "video: ['poster'],",                   'video: [],',
   `<video poster="${INVENTED}"></video>`],
  ['<svg><image href>',       "image: ['href', 'xlink:href', 'src'],", 'image: [],',
   `<svg><image href="${INVENTED}"/></svg>`],
  ['<input src>',             "input: ['src'],",                      'input: [],',
   `<input type="image" src="${INVENTED}">`],
  ['<object data>',           "object: ['data'],",                    'object: [],',
   `<object data="${INVENTED}"></object>`],
  ['<embed src>',             "embed: ['src'],",                      'embed: [],',
   `<embed src="${INVENTED}">`],
  // 🔴 needle 随 #1208 换了：`<style>` 不再是一条正则，是 styleElementBodies 那一趟扫描。
  ['<style> 元素里的 url()',  'for (const body of styleElementBodies(text)) pushCss(body);', '',
   `<style>.z{background-image:url('${INVENTED}')}</style>`],
]) {
  arm(label, needle, replacement,
    (m) => rej(m, { slug: 'p', content }, allowedIn(m)), '放行');
}

// AC2 那条机制单独一刀：拆候选串改回「整串只判第一个」。
arm('srcset 拆成每一个候选（改回只判第一个就漏掉后面的）',
  'if (SRCSET_ATTRS.has(name)) for (const u of splitSrcset(value)) push(u);',
  "if (SRCSET_ATTRS.has(name)) push(String(value).split(' ')[0]);",
  (m) => rej(m, { slug: 'p', content: `<img srcset="${ATTACHED} 1x, ${INVENTED} 2x">` }, allowedIn(m)), '放行');

// 同一条机制的**反方向**一刀：无脑 split(',') 会把 data: URI 拆碎 ⟹ 老板给过的那张被误拒。
arm('splitSrcset 不拿逗号当唯一分隔符（改回 split(\',\') 就误拒 data: URI）',
  'function splitSrcset(value) {',
  "function splitSrcset(value) { return String(value).split(',').map((c) => c.trim().split(/\\s+/)[0]).filter(Boolean); } function splitSrcsetUnused(value) {",
  (m) => rej(m, { slug: 'p', content: `<img srcset="${DATA_GIVEN} 1x">` },
    m.collectAllowedImageUrls({ images: [], message: `用这个 ${DATA_GIVEN} 谢谢`, conversationHistory: [] })), '拒');

// ── #1204 r2 的七刀。🔴 每一刀的靶子是**实验量出来的**，不是我按直觉挑的：先把候选那几行逐个切一遍、
//    看哪一格翻面，再把靶子写进来。两刀因此换过靶子 —— 「引号跳到配对那个引号」和「属性正则里未闭合
//    引号那两支」在 A/B/C 三格上**一格都不翻**（标签闭合那一行把它们盖住了），它们各自真正承重的是
//    E 和 D 两格。照直觉写就会得到两把恒绿的尺。
arm('标签没有收尾的 > 时照样收它（改回 r1 要求闭合，就是 QA1 抓的那个回退）',
  'out.push({ tag: m[1].toLowerCase(), body: text.slice(start, j) });',
  "if (text[j] === '>') out.push({ tag: m[1].toLowerCase(), body: text.slice(start, j) });",
  (m) => rej(m, { slug: 'p', content: `<p>hi</p><img src="${INVENTED}"` }, allowedIn(m)), '放行');
arm('值位置的引号跳到配对的那个引号（拆掉它，粘脏的地址会被截回老板给过的那个 ⟹ 误放）',
  "if ((c === '\"' || c === \"'\") && quoteOpensValue(text, j)) {", 'if (false) {',
  (m) => rej(m, { slug: 'p', content: `<img src="${ATTACHED}> <span class="y">z</span>` }, allowedIn(m)), '放行');
arm('属性正则里「引号一次都没闭合」那两支',
  '|"([^"]*)$|\'([^\']*)$', '',
  (m) => rej(m, { slug: 'p', content: `<p>hi</p><img src="${INVENTED}` }, allowedIn(m)), '放行');
arm('@font-face 整块剔掉（不剔就把字体当成图，一篇用了 webfont 的博客被整份拒）',
  'stripFontFaces(String(css))', 'String(css)',
  (m) => rej(m, { slug: 'p', content: '<style>@font-face{src:url(https://fonts.gstatic.com/s/a/v1/b.woff2)}</style>' }, allowedIn(m)), '拒');
arm('收尾的 </style> 是可选的',
  'out.push(text.slice(gt + 1, close === -1 ? n : close));',
  'if (close !== -1) out.push(text.slice(gt + 1, close));',
  (m) => rej(m, { slug: 'p', content: `<style>.z{background-image:url("${INVENTED}")}` }, allowedIn(m)), '放行');
arm('image 上的 xlink:href（单独一刀 —— QA1 非阻断②：原来三个属性一根针）',
  "image: ['href', 'xlink:href', 'src'],", "image: ['href', 'src'],",
  (m) => rej(m, { slug: 'p', content: `<svg><image xlink:href="${INVENTED}"/></svg>` }, allowedIn(m)), '放行');
arm('image 上的裸 src（同上，单独一刀）',
  "image: ['href', 'xlink:href', 'src'],", "image: ['href', 'xlink:href'],",
  (m) => rej(m, { slug: 'p', content: `<image src="${INVENTED}">` }, allowedIn(m)), '放行');

// ── #1204 r3 的两刀：同一处修法，两个方向各一刀（QA1 量的是误放，QA2a 量的是误拒）。
//    拆掉「只有值位置的引号才开属性值」这一条 = 回到 r2，两个方向必须同时翻面。
arm('引号只在【值】位置才开属性值 · 误放方向（拿掉它，一个英文撇号就让后面整份正文对闸不可见）',
  ' && quoteOpensValue(text, j)', '',
  (m) => rej(m, { slug: 'p', content: `<p><a href="/x" title='Joe's Bakery'>L</a></p><img src="${INVENTED}">` },
    allowedIn(m)), '放行');
arm('同一处 · 误拒方向（放行名单也被吞掉 ⟹ 老板自己站上的图被判成「没人给过你」）',
  ' && quoteOpensValue(text, j)', '',
  (m) => (m.collectImagePositions({ slug: 'p', content: `<p><a title='Joe's Bakery'>x</a></p><img src="${ATTACHED}">` }).length
    ? '名单里有' : '名单空了'), '名单空了');

// 不带引号的属性值那一刀：把字符类改回 main/r1/r2 那个（排掉引号），不带引号的 style= 当场翻回放行。
arm('不带引号的属性值边界只有空白和 >（改回排掉引号，url() 就被截断成看不见）',
  '|([^\\s>]+))/g;', "|([^\\s\"'`=<>]+))/g;",
  (m) => rej(m, { slug: 'p', content: `<div style=background-image:url('${INVENTED}')>x</div>` }, allowedIn(m)), '放行');
// 同一处的**反方向**一刀：改回旧字符类，A 那格就从「放行」翻成「拒」—— 误报回来了。
arm('同一处 · 误报方向（改回旧字符类，浏览器根本不去取的那一格会被拒）',
  '|([^\\s>]+))/g;', "|([^\\s\"'`=<>]+))/g;",
  (m) => rej(m, { slug: 'p', content: `<img alt=a"src="${INVENTED}">` }, allowedIn(m)), '拒');

// ── #1207：`background` 那一族**一个标签一刀**（不是一族一刀）────────────────────────────────────
// 🔴 一族一根针的话，八个标签里少写一个是静默的 —— 那正是 #1204 QA1 非阻断② 点过的形状
//    （`image` 上三个属性共用一根针）。所以逐个切：把那一行（**只有那一行**）拿掉，
//    对应那一格必须从「拒」翻成「放行」。
for (const [tag, content] of [
  ['td',    `<table><tr><td background="${INVENTED}">c</td></tr></table>`],
  ['th',    `<table><tr><th background="${INVENTED}">h</th></tr></table>`],
  ['tr',    `<table><tr background="${INVENTED}"><td>c</td></tr></table>`],
  ['tbody', `<table><tbody background="${INVENTED}"><tr><td>c</td></tr></tbody></table>`],
  ['thead', `<table><thead background="${INVENTED}"><tr><td>c</td></tr></thead></table>`],
  ['tfoot', `<table><tfoot background="${INVENTED}"><tr><td>c</td></tr></tfoot></table>`],
  ['table', `<table background="${INVENTED}"><tr><td>c</td></tr></table>`],
  ['body',  `<body background="${INVENTED}">`],
]) {
  arm(`<${tag} background>（表里拿掉它那一行）`,
    `  ${tag}: ['background'],\n`, '',
    (m) => rej(m, { slug: 'p', content }, allowedIn(m)), '放行');
}

// ── #1207：斜杠数不限那一刀。改回写死两个斜杠 = 回到 `origin/main`，两条通道各一格必须翻面。
//    🔴 这一处是**共用源串**（`URL_RE` 抠地址 / `ADDR_HEAD_RE` 判定），所以一刀切下去两侧同时变 ——
//       那正是 #1199 ③ 立这个源串的理由。两条通道各钉一格：只钉 <img src> 的话，CSS 那条路没人量。
arm('`http(s):` 后面斜杠数不限 · <img src>（改回写死两个斜杠，单斜杠就连问都不问）',
  "'(?:https?:\\\\/*|", "'(?:https?:\\\\/\\\\/|",
  (m) => rej(m, { slug: 'p', content: `<img src="http:/${HOST_PATH}">` }, allowedIn(m)), '放行');
arm('同上 · CSS url() 那条通道',
  "'(?:https?:\\\\/*|", "'(?:https?:\\\\/\\\\/|",
  (m) => rej(m, { slug: 'p', content: `<div style="background-image:url(http:/${HOST_PATH})">x</div>` },
    allowedIn(m)), '放行');
// 同一处的**反方向**一刀：斜杠数的等价关系（`addressForms`）拆掉之后，老板给过的那张写成单斜杠
// 会被判成「没人给过你」—— 误拒方向。
// 🔴 单变量：只把斜杠的**宽度**改回去，捕获组结构不动（换成 `(\/\/.*)` 会连组的含义一起改，
//    那把刀就有两个变量了）。
arm('斜杠数等价（拆掉它，老板给过的那张少一个斜杠就被误拒）',
  '/^(https?):\\/*(.*)$/i', '/^(https?):\\/\\/(.*)$/i',
  (m) => rej(m, { blocks: [{ data: { imageUrl: `https:/${GIVEN_HOSTPATH}` } }] }, allowedIn(m)), '拒');

// ── #1209 AC5：本票三条新覆盖面，每条一刀；另外三刀切**反方向**（放宽过头就是误拒）──────────────
// 🔴 前两刀跟 #1207 那一族同一个形状：一个标签一刀，一族一根针的话少写一个是静默的。
for (const [tag, content] of [
  ['col',      `<table><colgroup><col background="${INVENTED}"></colgroup><tr><td>c</td></tr></table>`],
  ['colgroup', `<table><colgroup background="${INVENTED}"><col></colgroup><tr><td>c</td></tr></table>`],
]) {
  arm(`<${tag} background>（表里拿掉它那一行）`,
    `  ${tag}: ['background'],\n`, '',
    (m) => rej(m, { slug: 'p', content }, allowedIn(m)), '放行');
}
// 第 1 条（前导斜杠段归一化）：拿掉那一支 ⟹ `///编造域名` 连问都不问。
arm('前导斜杠段归一化（拿掉它，`///域名` 回到「连问都不问」）',
  'if (run && run[0].length >= 2) return `//${s.slice(run[0].length)}`;', '',
  (m) => rej(m, { slug: 'p', content: `<img src="///${HOST_PATH}">` }, allowedIn(m)), '放行');
// 第 3 条（剔掉 TAB/LF/CR）：改成什么都不匹配 ⟹ `ht<LF>tp://` 回到「连问都不问」。
arm('剔掉 TAB/LF/CR（改成什么都不剔，畸形 scheme 回到「连问都不问」）',
  '/[\\t\\n\\r]/g', '/(?!)/g',
  (m) => rej(m, { slug: 'p', content: `<img src="ht\ntp://${HOST_PATH}">` }, allowedIn(m)), '放行');
// 🔴 上面两刀切的是**那一层自己**。这一刀切的是**接线** —— 判定那一侧忘了调它。
//    「函数写对了」和「函数被接上了」在一个只看函数的实现里长得一模一样。
// 🔴 needle 随 #1210 换了位置：这一句从 `imageUrlRejection` 的 filter 搬进了 `isImageAddress`
//    （`//` 那一支的主机判据改成 WHATWG 的 `.host` 之后，判定不再是一条正则）。**刀切的还是同一处
//    接线** —— 把归一化摘掉、直接拿原值去问那把尺子，`///编造域名` 必须回到「连问都不问」。
arm('判定那一侧真的调了归一化（拆掉接线，那一层写得再对也没人用）',
  'const s = canonicalAddress(v);', 'const s = String(v);',
  (m) => rej(m, { slug: 'p', content: `<img src="///${HOST_PATH}">` }, allowedIn(m)), '放行');
// 🔴 另一侧的接线，方向相反：`addressForms` 不认这层等价 ⟹ 老板给过的那张写成 `///` 被误拒。
arm('放行名单那一侧也认这层等价（拆掉就误拒老板给过的那张）',
  'new Set([u, canonicalAddress(u)])', 'new Set([u])',
  (m) => rej(m, { blocks: [{ data: { imageUrl: '///' + GIVEN_HOSTPATH } }] }, allowedIn(m)), '拒');
// ── 两刀切**放宽过头**：这两处各自都有一个"顺手写宽一格"的写法，后果是误拒。────────────────────
// 🔴 `>= 2` 改成 `>= 1`：单个正斜杠也被当跨主机 ⟹ 站内相对路径里凡第一段带点的（`/a.b/c.jpg`）
//    全被拒。真 chromium 取的是本站地址。
arm('前导斜杠段的分界线是 ≥2（改成 ≥1 就把站内相对路径吃进来 —— 误拒）',
  'run[0].length >= 2', 'run[0].length >= 1',
  (m) => rej(m, { blocks: [{ data: { imageUrl: '/' + HOST_PATH } }] }, allowedIn(m)), '拒');
// 🔴 只剔那三个字符（改成 `\s` 就把空格也剔了）：`ht tp://…` 浏览器不当地址，这里当了就是误拒。
arm('只剔 TAB/LF/CR（改成 \\s 连空格一起剔 —— 浏览器不取的那种被误拒）',
  '/[\\t\\n\\r]/g', '/\\s/g',
  (m) => rej(m, { slug: 'p', content: `<img src="ht tp://${HOST_PATH}">` }, allowedIn(m)), '拒');

// ══ 四、#1208：那三趟扫描 ══════════════════════════════════════════════════════════════════════
// 🔴 这一节的刀分**两种**，因为 #1208 的改动也分两种：
//   · **覆盖面**的刀（跟上面同款）：把某一支拿掉 → 对应格子当场翻面。
//   · **线性**的刀：把某一处「只往前走的游标」或「配不上就收工」改回去 → **行为一模一样**，只有
//     时间翻。这类刀只能拿时间当判据 —— 而这正是本票要治的那个性质，没有别的尺子量得到它。
//     🔴 判据是**每一臂自己的翻倍比**（N 翻倍时间涨几倍：二次 ≈ 4.0，线性 ≈ 2.0），不是绝对毫秒、
//     也不是「改坏比改好慢几倍」。后两个都随 N 和机器漂；翻倍比问的是那个性质本身。
//     「慢几倍」照旧打印（`末档差距`，实测 13×~900×），只是不当判据。
console.log('\n── 四、#1208：三趟扫描（覆盖面的刀 + 线性的刀）─────────────────');

const cpuMs = () => { const u = process.cpuUsage(); return (u.user + u.system) / 1000; };
const timeOf = (f) => { const a = cpuMs(); f(); return cpuMs() - a; };

// 🔴🔴 上面那行「取时间」的办法是 #1208 第二轮换掉的 —— QA2 打回的就是它。上一版是
//    「**墙钟** · 同一份输入背靠背量三遍取最快」，而它在这台八个窗格共用的机器上会**假红**：
//    实测整套 `npm run test:scripts` rc=1，红的不是被测代码，是这套取数的办法自己。
//    两个方向都真的出现过：
//      · 改好那一臂最后一档被别人抢一次 → 翻倍比读成 3.6 → 判「它自己就是二次的」
//      · 改坏那一臂第一档被抢一次       → 翻倍比读成 2.98 → 判「这一行不承重」
//
// 换了三件事，各治一件。三件都有读数，别只留一件：
//
// ① 🔴 **用 CPU 时间（`process.cpuUsage`），不用墙钟** —— 这是最要紧的那一条。别人抢走 CPU 时
//    我们是被**调度出去**的，那段时间根本不是我们在跑，而墙钟把它整个算在被测代码头上。
//    实测（load 22 / 12 核，10 个形状 × 15 次试验，只看改好那一臂的翻倍比）：
//        墙钟 采 3 遍 → 假红 34/150  ｜  墙钟 采 16 遍 → 7/150  ｜  CPU 时间 采 3 遍 → **0/150**
//    也就是墙钟采 16 遍都追不上 CPU 时间采 3 遍。分辨率不成问题：`process.cpuUsage()` 实测约 1 微秒。
//    🔴 **代价要说在明处：这一节往下所有毫秒都是 CPU 毫秒，不是老板真的要等的那个秒数。**
//       「真触发一次要等几秒」那种数必须另外用墙钟量，两者不可混着引。
//
// ② **批次自动放大**（`perCall`）：一次采样把被测调用连跑到批次 ≥ `TARGET_MS`，回报「每次多少毫秒」。
//    上一版直接量单次调用，而这里有的读数只有 0.2~1 ms —— 一次 2 ms 的干扰就是几倍误差。
//
// ③ **多遍交错取最小**（`curve`）：干扰只会**加**时间，所以每档取最小是单向正确的估计（二次的代码
//    不可能被采出线性的读数）。交错（每遍把三档各采一次）是为了让一次突发不可能落在同一档的
//    所有采样上 —— 上一版那三遍是背靠背的，一次 100 ms 的突发就把一整档吃掉。
//
// ④ 还有一件跟机器忙不忙无关、单独就能造一格假红的（第二轮实测抓到的）：**改坏那一臂是当场
//    `require` 进来的新模块**，里面那个函数一次都没被调用过；而改好那一臂（`lib`）是整份测试
//    从头用到尾的那个，早就热了。V8 把一个函数调到稳定态要几次调用，在那之前同一份字节的吞吐量
//    能差 **18 倍** —— 于是「第一档还没热、后两档热了」读出 `27 → 8.76 → 20 ms`、翻倍比 2.3，
//    判成「这一行不承重」。🔴 注意 `8.76 < 27`：**第二档比第一档快，那是物理上不可能的读数**
//    （输入更大不可能更快），也就是那条曲线整个不成立。而 `perCall` 对慢档只跑一次
//    （27 ms 已经满 `TARGET_MS`），所以它自己永远走不出这个状态。
//    修法：先拿**同一形状的小输入**把这一臂调到稳定态，再量真输入。小输入便宜到可以忽略
//    （二次的那一臂上，N/16 的输入是 1/256 的代价），而 JIT 的状态**跟函数走、不跟输入长度走**
//    —— 实测：用小输入热过之后，真输入的**第一次**调用就已经是稳定值。
const WARM_CALLS = 24;    // 用小输入把这一臂调到稳定态要调几次
const TARGET_MS = 5;      // 一次采样至少跑这么久（CPU 毫秒）
const REPS = 4;           // 每档最多采几遍，取最小
const REPS_MIN = 2;       // 贵的曲线至少采几遍
const CURVE_BUDGET_MS = 1500;   // 一条曲线的墙钟预算：只用来【减遍数】，不参与判读数
const wallMs = () => Number(process.hrtime.bigint()) / 1e6;
/**
 * 一次采样：把 f 连跑到批次 ≥ TARGET_MS，回报**每次调用**多少 CPU 毫秒。
 * 🔴 `iters` 每步最多放大 8 倍。上一版写的是 `ceil(iters * TARGET_MS / max(t, 0.01))`，
 *    一步能放大 500 倍 —— 那一批要跑多久，全看一个刚读到的、可能异常的 t。实测这台机器上
 *    `process.cpuUsage()` 的差值 576 万次采样里一次都没读到 0（最小 1 微秒），所以我**没有**
 *    证明那条路真的被走过；封住它是因为它的代价上界不可控，而封住不花钱。
 */
function perCall(f) {
  let iters = 1;
  for (;;) {
    const t = timeOf(() => { for (let i = 0; i < iters; i++) f(); });
    if (t >= TARGET_MS || iters >= 8192) return t / iters;
    const want = t > 0 ? Math.ceil(iters * TARGET_MS / t) : iters * 8;
    iters = Math.min(Math.max(iters + 1, Math.min(want, iters * 8)), 8192);
  }
}
/**
 * 一条曲线：同一形状在 N / 2N / 4N 上每次调用多少 CPU 毫秒 + 两个相邻倍数 + 跨跨度的倍数。
 * 🔴 也回报**这条曲线自己花了多少墙钟秒**（`wall`），并且打印出来 —— 理由是实测踩过：
 *    2026-08-27 有一次整份跑卡了 5 分钟（99.7% CPU 在转，不是被别人挤掉），停在第二把线性刀上，
 *    而当时**屏幕上没有任何东西说得出它慢在哪一格**。根因我没有定住（复现率约 1/30），所以这一轮
 *    做的是两件不靠猜的事：① 每条曲线的耗时打出来，下次卡住时它自己会指出是哪一格；
 *    ② 给它一个构造上的上界 —— 采到 `REPS_MIN` 遍之后，墙钟一过 `CURVE_BUDGET_MS` 就停。
 * 🔴 减遍数只能往「少采」的方向走，而少采让读数**偏大**（取最小值的估计，采得越少越偏高）——
 *    也就是它只可能让判据更严，不可能把该红的读成绿的。
 */
function curve(mod, gen, N) {
  const inps = [N, 2 * N, 4 * N].map(gen);
  const warm = gen(Math.max(64, Math.round(N / 16)));        // 同一形状的小输入
  for (let k = 0; k < WARM_CALLS; k++) mod.extractHtmlImageUrls(warm);
  inps.forEach((s) => mod.extractHtmlImageUrls(s));          // 再各跑一次真输入，都不计时
  const ms = [Infinity, Infinity, Infinity];
  const t0 = wallMs();
  let reps = 0;
  while (reps < REPS) {
    inps.forEach((s, i) => { const v = perCall(() => mod.extractHtmlImageUrls(s)); if (v < ms[i]) ms[i] = v; });
    reps += 1;
    if (reps >= REPS_MIN && wallMs() - t0 > CURVE_BUDGET_MS) break;
  }
  const ratios = ms.slice(1).map((v, i) => v / ms[i]);
  return { ms, ratios, reps, wall: (wallMs() - t0) / 1000, span: ms[2] / ms[0], least: Math.min(...ratios) };
}
// 🔴 判据的统计量是**跨整个跨度**的倍数（N 涨到 4N，时间涨几倍：线性 ≈ 4，二次 ≈ 16），
//    不是逐档翻倍比里最大的那个。第二轮换的 —— 两把尺都量过，这把分得开得多：
//      逐档最大：线性 2.00~2.25 · 二次 3.36~4.24 → 门槛 3.0 两边余量 1.33× / 1.12×
//      跨跨度  ：线性 4.05~4.10 · 二次 10.6~16.2 → 门槛 8   两边余量 1.58× / 1.33×
//    （二次那一侧有两个稳定的档位：同一份字节在 V8 里有快慢两种状态，差 18 倍，各自内部很稳
//      —— 快的那个跨跨度读 10.6，慢的读 16.2。上面那个 1.33× 说的是快的那个。）
const SPAN_CUT = 8;
/**
 * 「这条曲线读得到吗」——任一档的每次调用低于这个数就判读不到（不是只看第一档）。
 * 🔴 **这道闸【不是】上面那些假红的修法**，写清楚免得下一个人以为它是：干扰是把读数**变大**，
 *    而这道闸只抓**太小**的读数。它防的是另一件事 —— 有人后来把 N 调到「这个形状还没进入
 *    渐近区」的量级，那时翻倍比读出什么都不说明问题。（上一版这道闸只看第一档；三档的耗时
 *    是单调的，所以对「太小」来说看第一档和看三档等价 —— 改成看三档是为了让它对**任何**
 *    档位的异常都开口，包括将来有人把 gen 改成非单调的形状。）
 */
const FLOOR_MS = 0.05;
const tooSmall = (ms) => ms.findIndex((v) => v < FLOOR_MS);
/**
 * 线性的刀。判据是**N 涨到 4N 时间涨几倍**，不是绝对毫秒也不是「改坏比改好慢几倍」：
 *   · 改坏那一臂 ≥ 8  ⟹ 它是二次的（二次 ≈ 16）
 *   · 改好那一臂 < 8  ⟹ 现在这份字节在同一形状上不是二次的（线性 ≈ 4）
 *   （两个数都是 CPU 毫秒算出来的比值，见上面那段 🔴 ①；门槛怎么标出来的见 `SPAN_CUT` 那几行）
 * 🔴 为什么不用「慢 N 倍」当判据：那个数随 N 和机器漂 —— 同一把刀在 N=5000 上只慢 3.8 倍
 *    （看着像「这一行不承重」），在 N=40000 上慢 2620 倍。**翻倍比**问的是那个性质本身，不随 N 漂。
 *    这五把刀的 N 是**实验挑出来的**（先跑几档看两臂的曲线分不分得开），不是按直觉写的 ——
 *    #1204 r2 在这上面付过一轮账。慢几倍那个数照旧**打印出来**（下面 `差距`），只是不当判据。
 * 🔴 同时要求**行为一模一样**：这类刀改的是「快不快」，一旦输出也变了，说明靶子挑错了（那是覆盖面的刀）。
 * 🔴 判据的门槛跟取时间那套办法是**一对**，动一个就要把另一个重标一遍：`SPAN_CUT` 上面那些
 *    读数是**CPU 时间 + 批次放大 + 4 遍交错 + 小输入预热**这一套量出来的，换回墙钟就不成立了。
 */
function armQuadratic(label, needle, replacement, gen, N) {
  const m = mutate(needle, replacement);
  const probe = gen(N);
  const okOut = lib.extractHtmlImageUrls(probe);
  const badOut = m.extractHtmlImageUrls(probe);
  if (!(okOut.length === badOut.length && okOut.every((v, i) => v === badOut[i]))) {
    bad(`线性刀「${label}」改坏之后**行为也变了**（${okOut.length} vs ${badOut.length}）—— 靶子挑错了，这是覆盖面的刀`);
    return;
  }
  const g = curve(lib, gen, N);
  const b = curve(m, gen, N);
  const f = (v) => (v < 10 ? v.toFixed(2) : v.toFixed(0));
  const arm2 = (c) => `${c.ms.map(f).join(' → ')}（N→4N 涨 ${c.span.toFixed(1)} 倍，逐档 ${c.ratios.map((v) => v.toFixed(1)).join('/')}，采 ${c.reps} 遍用 ${c.wall.toFixed(1)}s）`;
  const say = `改坏 ${arm2(b)} · 改好 ${arm2(g)} CPU 毫秒/次 · 末档差距 ${(b.ms[2] / g.ms[2]).toFixed(0)}×`;
  const small = Math.max(tooSmall(g.ms), tooSmall(b.ms));
  const sick = Math.min(g.least, b.least);
  if (small !== -1) bad(`线性刀「${label}」→ 第 ${small + 1} 档读不到（低于 ${FLOOR_MS} ms/次）——`
    + ` 这个 N 上的倍数不说明问题，把 N 提上去再判。${say}`);
  // 🔴 更大的输入读到更快 = 那条曲线物理上不成立（某一档还没进稳定态）。这一句存在的意义是
  //    **把仪器故障说成仪器故障**，而不是让它冒充「这一行不承重」那个结论 —— 第二轮之前就是
  //    后者：同一次测量读出 27 → 8.76 ms，报出来的话却是「这一行不承重」。
  else if (sick < 1.2) bad(`线性刀「${label}」→ 这条曲线不成立：有一档比它前一档【快】`
    + `（相邻倍数最小 ${sick.toFixed(2)}，输入更大不可能更快）—— 是没热到稳定态，不是这一行不承重。${say}`);
  else if (b.span >= SPAN_CUT && g.span < SPAN_CUT) ok(`线性刀「${label}」→ ${say}`);
  else if (b.span < SPAN_CUT) bad(`线性刀「${label}」→ 改坏之后**也不是二次的**（N→4N 只涨 ${b.span.toFixed(1)} 倍 < ${SPAN_CUT}）—— 这一行不承重，或者这个 N/形状分不开两种实现。${say}`);
  else bad(`线性刀「${label}」→ 改好那一臂**自己就是二次的**（N→4N 涨 ${g.span.toFixed(1)} 倍 ≥ ${SPAN_CUT}）。${say}`);
}

// ── 覆盖面的刀（4 把）───────────────────────────────────────────────────────────────────────────
arm('cssUrlValues 的「不带引号」那一支（url(地址) 不带引号也要收）',
  "if (css[k] === ')') { out.push(css.slice(p, e)); i = k + 1; }", '',
  (m) => rej(m, { slug: 'p', content: `<style>.z{background-image:url(${INVENTED})}</style>` }, allowedIn(m)), '放行');
arm('cssUrlValues 的「带引号」那一支',
  "{ out.push(css.slice(p + 1, c)); i = k + 1; continue; }", '{ i = k + 1; continue; }',
  (m) => rej(m, { slug: 'p', content: `<style>.z{background-image:url("${INVENTED}")}</style>` }, allowedIn(m)), '放行');
arm('stripFontFaces 里 `@font-face` 与 `{` 之间那个 \\s*（拿掉就漏剔 ⟹ 把字体当成图，误拒）',
  "while (p < n && isWs(css[p])) p += 1;      // 老正则里的 `\\s*`", '',
  (m) => rej(m, { slug: 'p', content: '<style>@font-face {src:url(https://fonts.gstatic.com/s/a/v1/b.woff2)}</style>' }, allowedIn(m)), '拒');
arm('styleElementBodies 的 \\b（拿掉它，`<styles>` 会被当成 <style> 元素）',
  'if (text[i] !== undefined && WORD_CHAR_RE.test(text[i])) continue;', '',
  (m) => (m.styleElementBodies('<styles>x</styles>').length ? '当成了 style' : '没当成'), '当成了 style');

// ── 空白集合（两个）与「小写不许改长度」这几维（#1208 r3 补的；#1218 加了窄那个集合）─────────
// 🔴 #1218 起空白有**两个**集合，因为两趟问的不是同一个问题（理由与三个引擎的读数在
//    `image-urls.js` 的 `WS_CHARS` / `CSS_WS_CHARS` 上面那两段）：
//      · 宽（25 个，逐字符等于 `\s`）→ `stripFontFaces`  —— 下面 ① 钉它
//      · 窄（5 个，CSS 规范的空白）  → `cssUrlValues`     —— 下面 ①b 钉它
//    ⟹ **两个集合各有一格全码位守卫**，别只钉一个：把哪一个「统一」成另一个都会造出误拒。
// 🔴 为什么补这两格：r2 交付时 `isCssWs` 只认 6 个 ASCII 空白，而它替的那些老正则用的是 `\s`
//    （BMP 里 25 个）⟹ 差集那 19 个字符上两臂判决相反；同时 `low = text.toLowerCase()` 被当成
//    `text` 的**索引尺**，而 `U+0130`(İ) 小写成两个码位 ⟹ 从它往后每个下标错一格。
//    QA1 实测：把这两处各修回去（= 改变行为），**38 把刀一把都没红**。这一节就是那两维的牙。
//    🔴 两维**各两个方向**都钉：空白集合缩了会误拒（@font-face 那块不再被剔掉 ⟹ 拒掉老板整份编辑）
//       也会误放（url( 后那个地址抠不到）—— 一个方向一把刀。
const CP = (h) => String.fromCharCode(h);
const NBSP = CP(0xa0);
const IDOT = CP(0x130);          // İ —— BMP 里唯一小写会变长的字符（下面那格自己枚举证明）

// ① 空白集合逐字符等于 `\s`：**BMP 全集 65536 个码位**，不是抽几个代表。
//    判据走真函数 `stripFontFaces`（不为测试导出内部件）：`@font-face<C>{a}` 被整块剔掉 ⟺ C 算空白。
//    🔴 `{` 要排掉：C 就是 `{` 时 `skipWs` 一格没走就落在 `{` 上、照样剔掉 —— 那不是「它算空白」，
//       是这把探针在这一个码位上问不出问题（唯一一个，下面顺带证了它确实只有一个）。
{
  const isWsByBehavior = (c) => lib.stripFontFaces(`@font-face${c}{a}`) === '';
  const wrong = [];
  let brace = 0;
  for (let cp = 0; cp <= 0xffff; cp += 1) {
    const c = CP(cp);
    if (cp === 0x7b) { brace = isWsByBehavior(c) ? 1 : 0; continue; }
    if (isWsByBehavior(c) !== /\s/.test(c)) wrong.push(`U+${cp.toString(16).toUpperCase().padStart(4, '0')}`);
  }
  const n = [...Array(0x10000).keys()].filter((cp) => /\s/.test(CP(cp))).length;
  if (wrong.length === 0 && n === 25 && brace === 1) {
    ok(`空白集合逐字符等于 \\s —— BMP 全 65536 个码位扫过，差集为空（\\s 在 BMP 里 ${n} 个；`
      + `唯一排掉的 U+007B 单独核过，它是探针的盲点不是集合的）`);
  } else {
    bad(`空白集合跟 \\s 不一致：${wrong.length} 个码位对不上（${wrong.slice(0, 12).join(' ')}${wrong.length > 12 ? ' …' : ''}）`
      + `；\\s 在 BMP 里数到 ${n} 个（期望 25）；U+007B 探针自检 ${brace}（期望 1）`);
  }
}

// ①b `url()` 那趟的空白集合逐字符等于 **CSS 那 5 个**：同样是 **BMP 全集 65536 个码位**。
//    判据走真函数 `cssUrlValues`：`url(<C>"<地址>")` 抠得到那个地址 ⟺ C 算空白。
//    🔴 这把探针**一个盲点都没有**（不像 ① 要排掉 `{`）—— 65536 个码位差集为空，
//       所以这里不排任何码位；哪天要排，得先证明它是探针的盲点、不是集合的。
//    🔴 期望值 5 是**量出来的**（#1218 AC1：三个引擎 × 两条写法 × `\s` 全部 25 个字符，
//       判据是真的有没有发出请求），不是抄 CSS 规范抄来的。表在 `CSS_WS_CHARS` 上面那段。
{
  const isCssWsByBehavior = (c) => lib.cssUrlValues(`.a{background-image:url(${c}"${INVENTED}")}`).includes(INVENTED);
  const CSS5 = new Set(' \t\n\r\f');
  const wrong = [];
  for (let cp = 0; cp <= 0xffff; cp += 1) {
    const c = CP(cp);
    if (isCssWsByBehavior(c) !== CSS5.has(c)) wrong.push(`U+${cp.toString(16).toUpperCase().padStart(4, '0')}`);
  }
  // 分母自检：这把探针在那 5 个上必须全部抠得到（否则差集为空可能是「它对谁都抠不到」）
  const positives = [...CSS5].filter((c) => isCssWsByBehavior(c)).length;
  if (wrong.length === 0 && positives === 5) {
    ok('`url()` 那趟的空白集合逐字符等于 CSS 那 5 个 —— BMP 全 65536 个码位扫过，差集为空'
      + '（阳性那 5 个逐个抠得到；#1218 三个引擎实测：另外 20 个 `\\s` 字符浏览器一条请求都不发）');
  } else {
    bad(`\`url()\` 那趟的空白集合跟 CSS 那 5 个不一致：${wrong.length} 个码位对不上`
      + `（${wrong.slice(0, 12).join(' ')}${wrong.length > 12 ? ' …' : ''}）`
      + `；阳性自检 ${positives} / 5`);
  }
}

// ② 那把索引尺不许改长度：**自己枚举** BMP 里所有「小写会变长」的字符，逐个要求闸仍然看得见地址。
//    🔴 不写死 `İ`：写死的话，将来 Node 换一版 Unicode 表新增一个这样的字符时这一格是瞎的。
{
  const growers = [];
  for (let cp = 0; cp <= 0xffff; cp += 1) { const c = CP(cp); if (c.toLowerCase().length !== 1) growers.push(c); }
  const blind = growers.filter((c) => !lib.extractHtmlImageUrls(
    `<style>.a{content:"${c}"}.b{background-image:url("${INVENTED}")}</style>`).includes(INVENTED));
  if (blind.length === 0) {
    ok(`小写那把索引尺不改长度 —— BMP 里「小写会变长」的字符共 ${growers.length} 个`
      + `（${growers.map((c) => `U+${c.codePointAt(0).toString(16).toUpperCase().padStart(4, '0')}`).join(' ')}），`
      + `每个后面那条 background-image 闸都仍然看得见`);
  } else {
    bad(`小写那把索引尺改了长度：${blind.length} / ${growers.length} 个字符后面的地址闸看不见了`
      + `（${blind.map((c) => `U+${c.codePointAt(0).toString(16).toUpperCase().padStart(4, '0')}`).join(' ')}）`);
  }
}

// ③ 刀：每个承重行一把，一维两个方向
// 🔴 从这里开始的几把都传了第 6 个参数（改坏之前该读到什么）—— 见 `arm()` 的注释：
//    #1218 换掉的那把刀在改完之后**两边同值**、照样打 ✅，那个参数就是为它加的。
arm('WS_CHARS 少一个字符（拿掉 NBSP）→ @font-face 那块不再被剔掉 ⟹ 拒掉老板整份编辑（误拒）',
  "const WS_CHARS = ' \\t\\n\\r\\f\\v\\u00a0", "const WS_CHARS = ' \\t\\n\\r\\f\\v",
  (m) => rej(m, { slug: 'p', content: `<style>@font-face${NBSP}{font-family:F;src:url(https://fonts.gstatic.com/s/x/v1/f.woff2)}</style>` }, allowedIn(m)), '拒', '放行');

// 🔴 下面这把替掉了 #1208 的一把刀。原来那把是「`WS_SET` 拿掉 NBSP → `url(<NBSP>"编造.png")`
//    期望翻成放行」，而 #1218 把 `url()` 那趟换成 CSS 的 5 个之后，**没改坏时那一格本来就是放行**
//    ⟹ 它变成一把空刀（实测：换完集合、守卫一个字没动，304 格全绿）。承重的行换了，刀也要跟着换。
arm('CSS_WS_CHARS 多一个字符（把 NBSP 加回去）→ url( 后那个编造地址又被抠出来 ⟹ 拒掉老板整份编辑（误拒，= 本票治的那个病）',
  "const CSS_WS_CHARS = ' \\t\\n\\r\\f';", "const CSS_WS_CHARS = ' \\t\\n\\r\\f\\u00a0';",
  (m) => rej(m, { slug: 'p', content: `<style>.z{background-image:url(${NBSP}"${INVENTED}")}</style>` }, allowedIn(m)), '拒', '放行');
arm('CSS_WS_CHARS 少一个字符（拿掉 \\f）→ url( 后那个编造地址抠不到（误放）',
  "const CSS_WS_CHARS = ' \\t\\n\\r\\f';", "const CSS_WS_CHARS = ' \\t\\n\\r';",
  (m) => rej(m, { slug: 'p', content: `<style>.z{background-image:url(\f"${INVENTED}")}</style>` }, allowedIn(m)), '放行', '拒');
arm('skipWs 换回宽集合（isCssWs → isWs）→ url(<NBSP>"编造.png") 又被抠出来（误拒）',
  'while (k < n && isCssWs(css[k])) k += 1;', 'while (k < n && isWs(css[k])) k += 1;',
  (m) => rej(m, { slug: 'p', content: `<style>.z{background-image:url(${NBSP}"${INVENTED}")}</style>` }, allowedIn(m)), '拒', '放行');
// 🔴 这一把钉的是「两处必须同一个集合」：`firstWs` 那条正则宽而 `skipWs` 窄时，`e` 会停在 NBSP 上、
//    而 `skipWs` 不肯消费它 ⟹ `css[k]` 不是 `)`，整个 `url(…)` 一个地址都抠不到（误放方向）。
//    这正是 #1208 第一版那个洞的形状，只是两把尺的宽窄反了过来。
arm('firstWs 那条正则换回 /\\s/（宽），skipWs 还是窄 ⟹ 两把尺不一致，不带引号那条地址整个抠不到（误放）',
  "const wsRe = new RegExp(`[${CSS_WS_CHARS}]`, 'g');", 'const wsRe = /\\s/g;',
  (m) => rej(m, { slug: 'p', content: `<style>.z{background-image:url(${INVENTED}${NBSP})}</style>` }, allowedIn(m)), '放行', '拒');
arm('asciiLower 换回 toLowerCase（索引尺变长）→ İ 后面那条 background-image 整个看不见（误放）',
  'const asciiLower = (s) => (NON_ASCII_RE.test(s) ? s.replace(/[A-Z]+/g, (m) => m.toLowerCase()) : s.toLowerCase());',
  'const asciiLower = (s) => s.toLowerCase();',
  (m) => rej(m, { slug: 'p', content: `<style>.a{font-family:"${IDOT}stanbul"}.b{background-image:url("${INVENTED}")}</style>` }, allowedIn(m)), '放行');

arm('asciiLower 那条 ASCII 快路的判据取反（让非 ASCII 串也走 toLowerCase）→ İ 那一格翻面',
  'const NON_ASCII_RE = /[^\\x00-\\x7f]/;', 'const NON_ASCII_RE = /(?!)/;',
  (m) => rej(m, { slug: 'p', content: `<style>.a{font-family:"${IDOT}stanbul"}.b{background-image:url("${INVENTED}")}</style>` }, allowedIn(m)), '放行');

// ── 线性的刀（5 把）—— 这五处就是「不再是二次的」那个性质的全部承重件 ─────────────────────────
// 🔴 needle 带上下一行：那句话在它上面那段 🔴 注释里也逐字出现过一次，只写单行会命中 2 次（mutate 会 die）。
//
// 🔴🔴 **每把刀的 N 由它自己的余量定，不是抄一个统一的数** —— 这是 #1208 r3 补的，QA1 打回的就是它：
//    r2 交的那份里 `styleElementBodies` 在 N=5000 上改坏臂只读到 **10.8**（门槛 8，余量 1.35×），
//    而 QA2 实测「三格各红过一次」正好命中这类贴线的刀。
//    余量往哪个方向要：**改坏臂要读得【高】**（≥ 8），而让它读低的原因是「这个 N 还没进渐近区」，
//    不是机器忙 —— 干扰只会把时间**加**上去（而且 `curve` 取多遍最小值）。所以余量不足就**提 N**。
//    **改坏臂余量的下限定在 1.5×（也就是 span ≥ 12）**，逐把量出来的读数（同一台共享 dev 机，
//    每把跑三遍取中间那次；括号里是这一臂采样花的墙钟）：
//        刀                        N        改坏 span     余量     改好 span   代价
//        styleElementBodies      20000      13.8         1.73×      3.9       1.1s   ← r3 从 5000 提上来
//        stripFontFaces          20000      15.4         1.93×      4.1       2.0s
//        cssUrlValues nextClose  20000      12.4         1.55×      3.9       1.2s
//        cssUrlValues nextWs      2500      15.6         1.95×      4.0       1.0s
//        cssUrlValues wsEndAt     2500      16.0         2.00×      4.0       4.2s
//    📌 二次的理论上限就是 16（N→4N ⟹ 时间 ×16），所以 `nextWs` / `wsEndAt` 那两把在 N=2500 上
//       已经贴着上限，**它们的 N 小不等于余量小** —— 判据是余量那一列，不是 N 那一列。
//    📌 `styleElementBodies` 那把逐档量过：N=5000 → 10.8 · 10000 → 12.3 · 20000 → 13.8 · 40000 更高但
//       改坏臂一次采样就要 2.7s 且遍数被预算砍到 2 ⟹ 20000 是余量够用里最便宜的那一档。
//    📌 `nextClose` 那把在 N=40000 上读 19.0（余量 2.4×）但采样 2.7s、遍数掉到 2 ⟹ 留在 20000。
armQuadratic('styleElementBodies 的「连 > 都没有就收工」',
  "if (gt === -1) break;\n    const close = low.indexOf('</style>', gt + 1);",
  "if (gt === -1) continue;\n    const close = low.indexOf('</style>', gt + 1);",
  (N) => '<style'.repeat(N), 20000);
armQuadratic('stripFontFaces 的「没有 } 就收工」',
  'if (end === -1) break;\n    out += css.slice(cut, at);',
  'if (end === -1) continue;\n    out += css.slice(cut, at);',
  (N) => '<style>' + '@font-face{'.repeat(N), 20000);
armQuadratic('cssUrlValues 的 nextClose 游标（改回每个起点都重新找一次 `)`）',
  "if (nextClose < from) { const j = css.indexOf(')', from); nextClose = j === -1 ? n : j; }",
  "{ const j = css.indexOf(')', from); nextClose = j === -1 ? n : j; }",
  (N) => '<style>' + 'url(x '.repeat(N) + ')', 20000);
armQuadratic('cssUrlValues 的 nextWs 游标（改回每个起点都重新找一次空白）',
  'if (nextWs < from) { wsRe.lastIndex = from; const m = wsRe.exec(css); nextWs = m ? m.index : n; }',
  '{ wsRe.lastIndex = from; const m = wsRe.exec(css); nextWs = m ? m.index : n; }',
  (N) => '<style>' + 'url('.repeat(N) + ' x)', 2500);
armQuadratic('cssUrlValues 的 wsEndAt 缓存（同一段空白被连续多个起点问到）',
  'const skipWsAtE = (e) => { if (wsEndAt !== e) { wsEndAt = e; wsEndVal = skipWs(e); } return wsEndVal; };',
  'const skipWsAtE = (e) => skipWs(e);',
  (N) => '<style>' + 'url('.repeat(N) + ' '.repeat(N) + 'x)', 2500);

// ── 现在这份字节自己在那五个病态形状上是【线性】的：N 涨到 4N，时间不许涨 16 倍 ─────────────
// 🔴 判据跟上面那五把线性刀同一把尺（N→4N 涨几倍：线性 ≈ 4，二次 ≈ 16，门槛 8），不是绝对毫秒
//    —— 绝对值在这台共享机上漂。
console.log(`   ── 病态形状：N 涨到 4N 时间涨几倍（线性 ≈ 4，二次 ≈ 16，每一格都要 < ${SPAN_CUT}）──`);
for (const [name, gen] of [
  ['<style> 无闭合 + N×url(',        (N) => '<style>' + 'url('.repeat(N)],
  ['N×@font-face{ 无闭合',           (N) => '<style>' + '@font-face{'.repeat(N)],
  ['N×url("（引号都没闭合）',          (N) => '<style>' + 'url("'.repeat(N)],
  ['N×<style（连 > 都没有）',          (N) => '<style'.repeat(N)],
  ['style= 属性 + N×url(',           (N) => `<div style="${'url('.repeat(N)}">x</div>`],
]) {
  // 🔴 N 从 40000 起，而这个数是**标定出来的**：先按 5000 跑，`@font-face` 那格读出
  //    0.2 → 0.4 → 1.1 ms、翻倍比 3.0 判红；按 20000 跑读出 1.1 → 4.2 → 7.3、翻倍比 3.6 仍判红
  //    —— 两次都不是它二次（那一趟是两遍 indexOf，按构造线性），是**尺子在这个量级上读不到**：
  //    几毫秒的读数里 GC 与缓存台阶就有 3 倍。到 40000 五个形状全部稳定在 ~2.0，重跑两遍一致。
  //    📌 那次标定用的是**上一版**取时间的办法（背靠背三遍）。#1208 第二轮换成上面那套（批次放大 +
  //    多遍交错取最小）之后，「读不到」这件事已经由 `perCall` 治掉了，40000 保留是因为它便宜
  //    （每档只跑一两次就满 5 ms）而且离渐近区更远的量级没必要再试。
  const { ms, span, ratios, reps, wall } = curve(lib, gen, 40000);
  const detail = `${ms.map((v) => v.toFixed(1)).join(' → ')} CPU 毫秒/次，N=40000/80000/160000，逐档 ${ratios.map((v) => v.toFixed(1)).join('/')}，采 ${reps} 遍用 ${wall.toFixed(1)}s`;
  const small = tooSmall(ms);
  if (small !== -1) bad(`${name} 第 ${small + 1} 档读不到（低于 ${FLOOR_MS} ms/次）—— 这个 N 上的倍数不说明问题，把 N 提上去再判`);
  else if (span < SPAN_CUT) ok(`${name} N→4N 涨 ${span.toFixed(1)} 倍（${detail}）`);
  else bad(`${name} N→4N 涨 ${span.toFixed(1)} 倍 ≥ ${SPAN_CUT} —— 它还是二次的（${detail}）`);
}
// ── #1210：三族各一刀，另加三刀切**反方向**（放宽过头就是误拒）────────────────────────────────
// 🔴 每一族都切**两处**：那一层自己，以及**接线**。「函数写对了」和「函数被接上了」在一个只看
//    结果的实现里长得一模一样（#1209 那一刀立的规矩，本票照办）。

// 🔴 第 1 族有**两个**机制，各自承重的方向不同，一刀只能切到一个 —— 这是实测出来的，不是我按
//    直觉分的：第一版只切了 `canonicalHost`，那一格**不翻面**，因为判定那一侧直接调 `hostOf`、
//    不经 `canonicalHost`。⟹ 判定这一侧的承重件是 `hostOf` 里那次 `new URL`，而 `canonicalHost`
//    承的是**放行名单**那一侧（老板给过的那张写成这种写法不许被误拒）。两刀分开切。
//
// 第 1 族 · 判定这一侧：主机那一段不过 WHATWG 归一化，改成拿原样那一段。
arm('主机那一段真的过了 WHATWG 归一化（改成拿原样那一段，U+3002 那种回到「连问都不问」）',
  'return new URL(abs).host || null;',
  "return abs.replace(/^https?:/i, '').replace(/^[/\\\\]*/, '').split(/[/\\\\?#]/)[0] || null;",
  // 🔴 探针主机里**不许再有 ASCII 点**：`uploads。ai1stsite.app` 的 `.app` 会让切坏的那把尺照样
  //    读到点、那一格不翻面（第一版就是这么读出「这条覆盖面不是那几行撑的」的假结论）。
  (m) => rej(m, { slug: 'p', content: `<img src="//evil${U3002}example/x.png">` },
    allowedIn(m)), '放行');
// 第 1 族 · 放行名单这一侧（方向相反）：`canonicalHost` 拆掉，老板给过的那张写成 `%2E` 就被误拒。
arm('放行名单那一侧也认主机这层等价（拆掉 canonicalHost，`%2E` 写法的那张被误拒）',
  '  const h = hostOf(s);\n  return h ? m[1] + h + String(s).slice(m[0].length) : s;',
  '  return s;',
  (m) => rej(m, { blocks: [{ data: { imageUrl: `//uploads%2Eai1stsite.app${GIVEN_TAIL}` } }] },
    allowedIn(m)), '拒');
// 第 1 族 · 接线：判定那一侧不问主机 ⟹ 单标签主机那条线没了，两个方向各翻一格。
// 🔴 needle 随 #1223 换了：那三行中间插进了 IPv6 字面量那一档，原来那一整段不再是连续文本
//    （改之前这把刀读到「命中 0 次」而 exit 2 —— 它没有安静地变绿，这一点是它自己证明的）。
arm('`//` 那一支真的问了主机含不含点 · 误放方向（改成恒真，判据就退回"只要两个斜杠"）',
  "  const head = s.match(HOST_HEAD_RE);\n"
  + "  if (head && head[2].startsWith('[')) return true;\n"
  + '  const h = hostOf(s);\n  return h !== null && h.includes(\'.\');',
  '  return true;',
  (m) => rej(m, { blocks: [{ data: { imageUrl: '//photos/hero.jpg' } }] }, allowedIn(m)), '拒');
// 🔴 同一处的**另一个**写坏法：把「含点」换成「非空」—— 它在编造域名那格照样绿，只有单标签
//    主机那格露馅。两刀切的是同一行，方向相反，缺一格就有一半没人守。
arm('同一处 · 判据是【含点】不是【非空】（换成非空，`//photos/hero.jpg` 被误拒）',
  "h !== null && h.includes('.')", "h !== null && h.length > 0",
  (m) => rej(m, { blocks: [{ data: { imageUrl: '//photos/hero.jpg' } }] }, allowedIn(m)), '拒');

// 第 2 族 · 那一层自己：不剥首尾 C0 ⟹ `\x01http://…` 回到「连问都不问」。
arm('剥首尾的 C0 与空格（改成什么都不剥，`\\x01http://…` 回到「连问都不问」）',
  'stripUrlEdges(v).replace(URL_STRIP_RE', 'String(v).replace(URL_STRIP_RE',
  (m) => rej(m, { slug: 'p', content: `<img src="${String.fromCharCode(1)}http://${HOST_PATH}">` },
    allowedIn(m)), '放行');
// 第 2 族 · **反方向**：只剥首尾，不剥中间。改成"哪儿都剥"，主机里插 C0 那格就被误拒。
// 🔴 needle 随 r2 换了:那两端现在是 §stripUrlEdges 的两个 charCodeAt 扫描,不是正则(r1 那把 `$`
//    锚定的尾部剥法在中间一长串空白上是平方级 —— QA3 退回的就是它)。这一刀把「只剥两端」换成
//    「哪儿都剥」,方向不变。
arm('只剥【首尾】的 C0（改成哪儿都剥，主机里插 C0 那格被误拒）',
  'return i === 0 && j === s.length ? s : s.slice(i, j);',
  "return s.replace(/[\\x00-\\x20]+/g, '');",
  (m) => rej(m, { slug: 'p', content: `<img src="//uploads${String.fromCharCode(1)}.ai1stsite.app${BAD_TAIL}">` },
    allowedIn(m)), '拒');

// 第 2 族 · **剥【尾部】那一半单独一刀**（#1234 打磨批次 #26 条 9，来源 #1210）。
// 🔴 为什么它得单独有一刀：上面两刀切的是「剥不剥」和「剥哪儿」，**没有一刀切得动「首尾里的尾」**。
//    实测把 `stripUrlEdges` 里剥尾部那一行整行删掉，整份测试仍然 468 过 / 0 败、rc=0 —— 那一半
//    今天是**没人守的**。方向是误拒：老板给过的那张图，页面里写成末尾多一个 C0，不剥尾就成了另一个
//    地址，于是被判成「没人给过你」。
//    📌 探针用 `\x01` 不用空格：属性值里的尾部空格在到这一层之前就已经没了，拿它当探针这把刀是空的
//    （两边都读「放行」），而 `arm` 的第六个参数正好会把那种空刀当场打红。
arm('只剥首尾里的【尾】（把剥尾部那一行删掉，老板给过的那张末尾多一个 C0 就被误拒）',
  '  while (j > i && s.charCodeAt(j - 1) <= 0x20) j -= 1;', '',
  (m) => rej(m, { slug: 'p', content: `<img src="${ATTACHED}${String.fromCharCode(1)}">` },
    allowedIn(m)), '拒', '放行');

// 第 3 族 · 那一层自己：属性值不解实体 ⟹ 四种写法回到「连问都不问」。
arm('属性值解一次 HTML 实体（拿掉它，`&#x2F;&#x2F;&#x2F;域名` 回到「连问都不问」）',
  'decodeEntities(firstGroup(am, 2))', 'firstGroup(am, 2)',
  (m) => rej(m, { slug: 'p', content: `<img src="&#x2F;&#x2F;&#x2F;${HOST_PATH}">` }, allowedIn(m)), '放行');
// 第 3 族 · **反方向**（AC5）：同一刀切下去，今天那个 `&amp;` 误拒就回来了。
arm('同一处 · 误拒方向（拿掉解实体，合规写法 `&amp;` 又被判成「没人给过你」）',
  'decodeEntities(firstGroup(am, 2))', 'firstGroup(am, 2)',
  (m) => rej(m, { slug: 'p', content: '<img src="https://uploads.ai1stsite.app/a.jpg?x=1&amp;y=2">' },
    m.collectAllowedImageUrls({ images: [], message: '用这张 https://uploads.ai1stsite.app/a.jpg?x=1&y=2 谢谢',
      conversationHistory: [] })), '拒');
// 第 3 族 · **具名实体那半张表**单独一刀（数字实体那一支盖得住它 ⟹ 一根针会让它静默失守，
// 跟 #1204 那个「三个属性一根针」同一个形状）。
arm('具名实体表里的 `&sol;`（拿掉它那一项，`&sol;&sol;域名` 回到「连问都不问」）',
  "sol: '/',", '', (m) => rej(m, { slug: 'p', content: `<img src="&sol;&sol;${HOST_PATH}">` },
    allowedIn(m)), '放行');
// 第 3 族 · **具名实体必须带分号**那条：拿掉分号要求，`?a=1&amp=2` 这种合法查询串被解坏 ⟹ 误拒。
arm('具名实体必须带分号（改成分号可选，合法查询串 `&amp=2` 被解坏 —— 误拒）',
  '|([a-zA-Z][a-zA-Z0-9]*);)', '|([a-zA-Z][a-zA-Z0-9]*);?)',
  (m) => {
    const u = 'https://uploads.ai1stsite.app/b.jpg?a=1&amp=2';
    return rej(m, { slug: 'p', content: `<img src="${u}">` },
      m.collectAllowedImageUrls({ images: [{ url: u }], message: '', conversationHistory: [] }));
  }, '拒');

// 第 5 族 · #1223：IPv6 字面量那一档。两刀切同一处，方向不同 —— 缺一格就有一半没人守。
// 🔴 第一刀：整档拿掉 ⟹ 退回 #1210 的「含不含点」，`//[2001:db8::1]/…` 又被放行。
arm('`[` 开头的主机先于「含不含点」被追责（拿掉这一档，IPv6 字面量又被放行）',
  "  const head = s.match(HOST_HEAD_RE);\n  if (head && head[2].startsWith('[')) return true;\n", '',
  (m) => rej(m, { blocks: [{ data: { imageUrl: `//[2001:db8::1]${BAD_TAIL}` } }] },
    m.collectAllowedImageUrls({ images: [{ url: `//[2001:db8::1]${GIVEN_TAIL}` }], message: '', conversationHistory: [] })),
  '放行', '拒');
// 🔴 第二刀：**同一处的另一个写坏法** —— 改成问 `hostOf` 的结果而不是源串里那一段。
//    它在能解析的那两种上照样绿（`.host` 也以 `[` 开头），只有 zone id 那种露馅（`new URL` 抛，
//    `hostOf` 返回 null）。这一刀钉的是 `isImageAddress` 里那句「读的是源串，不是 hostOf」。
arm('同一处 · 读的是【源串里那一段主机】不是 hostOf（改成问 hostOf，带 zone id 那种又被放行）',
  "  const head = s.match(HOST_HEAD_RE);\n  if (head && head[2].startsWith('['))",
  "  const head = [null, hostOf(s) || ''];\n  if (head && head[1].startsWith('['))",
  (m) => rej(m, { blocks: [{ data: { imageUrl: `//[fe80::1%25eth0]${BAD_TAIL}` } }] },
    m.collectAllowedImageUrls({ images: [{ url: `//[fe80::1%25eth0]${GIVEN_TAIL}` }], message: '', conversationHistory: [] })),
  '放行', '拒');
// 🔴 第二刀的阴性对照：同一刀之下，**能解析**的那种必须**仍然被拒** —— 否则上面那格的翻面
//    可能是「整档都没了」而不是「只有 zone id 那一档没了」，两者在一个只看一格的读法里同形。
{
  const m = mutate("  const head = s.match(HOST_HEAD_RE);\n  if (head && head[2].startsWith('['))",
    "  const head = [null, hostOf(s) || ''];\n  if (head && head[1].startsWith('['))");
  const got = rej(m, { blocks: [{ data: { imageUrl: `//[2001:db8::1]${BAD_TAIL}` } }] },
    m.collectAllowedImageUrls({ images: [{ url: `//[2001:db8::1]${GIVEN_TAIL}` }], message: '', conversationHistory: [] }));
  got === '拒' ? ok('同一刀的阴性对照：能解析的 IPv6 字面量仍被拒 ⟹ 上一格翻的确实只有 zone id 那一档')
               : bad(`同一刀的阴性对照读到 ${got}，期望 拒 —— 那一刀切掉的比它声称的多`);
}

// 第 6 族 · #1223：放行名单那一侧的归一化。
// 🔴 拿掉它 ⟹ 「老板给的那份不是归一化形状」那一向全部回到误拒。
arm('放行名单那一侧过 canonicalAddress（拿掉它，老板给原生 IDN 那张又被误拒）',
  '  for (const a of allowed || []) { known.add(a); known.add(canonicalAddress(a)); }',
  '  for (const a of allowed || []) known.add(a);',
  (m) => rej(m, { blocks: [{ data: { imageUrl: 'https://xn--r8jz45g.jp/x.png' } }] },
    m.collectAllowedImageUrls({ images: [{ url: 'https://例え.jp/x.png' }], message: '', conversationHistory: [] })),
  '拒', '放行');
// 🔴 **另一个方向的写坏法**：名单这一侧改成 `addressForms` 那种等价展开（我第一版写的就是它）。
//    它把 AC2 那十格照样跑绿，只有跨 scheme 那条线露馅 —— 所以这一刀钉的是「名单这一侧只许
//    归一化、不许展开」，而不是「有没有归一化」。
arm('同一处 · 名单只许【归一化】不许【等价展开】（换成 addressForms，跨 scheme 那条线没了）',
  '  for (const a of allowed || []) { known.add(a); known.add(canonicalAddress(a)); }',
  '  for (const a of allowed || []) for (const f of addressForms(a)) known.add(f);',
  (m) => rej(m, { blocks: [{ data: { imageUrl: 'http://h.example/p.png' } }] },
    m.collectAllowedImageUrls({ images: [{ url: 'https://h.example/p.png' }], message: '', conversationHistory: [] })),
  '放行', '拒');

console.log(`   📌 一共切了 ${mutN} 刀，每刀只改一处，改的都是 image-urls.js（工作区那份，md5 `
  + `${require('crypto').createHash('md5').update(LIB_SRC).digest('hex').slice(0, 12)}）`);

console.log(`\n${fail === 0 ? '✅' : '❌'} ${pass} 过 · ${fail} 败`);
process.exit(fail === 0 ? 0 : 1);
