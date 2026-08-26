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
/** 改坏之后那一格必须变成 `broken`；没变 = 那几行不承重，或者刀没切在承重处。 */
function arm(label, needle, replacement, probe, broken) {
  const m = mutate(needle, replacement);
  const got = probe(m);
  got === broken ? ok(`故意写坏「${label}」→ 那一格翻成 ${broken}（改前就是这个读数）`)
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
  ['<style> 元素里的 url()',  'for (const sm of text.matchAll(HTML_STYLE_EL_RE)) pushCss(sm[1] || \'\');', '',
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
  ".replace(CSS_FONT_FACE_RE, '')", '',
  (m) => rej(m, { slug: 'p', content: '<style>@font-face{src:url(https://fonts.gstatic.com/s/a/v1/b.woff2)}</style>' }, allowedIn(m)), '拒');
arm('收尾的 </style> 是可选的',
  '(?:<\\/style>|$)', '<\\/style>',
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

console.log(`   📌 一共切了 ${mutN} 刀，每刀只改一处，改的都是 image-urls.js（工作区那份，md5 `
  + `${require('crypto').createHash('md5').update(LIB_SRC).digest('hex').slice(0, 12)}）`);

console.log(`\n${fail === 0 ? '✅' : '❌'} ${pass} 过 · ${fail} 败`);
process.exit(fail === 0 ? 0 : 1);
