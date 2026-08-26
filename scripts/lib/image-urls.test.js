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
arm('博客正文里的 style="…url(…)"',
  '\\bstyle\\s*=', '\\bstyleNEVER\\s*=',
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

console.log(`   📌 一共切了 ${mutN} 刀，每刀只改一处，改的都是 image-urls.js（工作区那份，md5 `
  + `${require('crypto').createHash('md5').update(LIB_SRC).digest('hex').slice(0, 12)}）`);

console.log(`\n${fail === 0 ? '✅' : '❌'} ${pass} 过 · ${fail} 败`);
process.exit(fail === 0 ? 0 : 1);
