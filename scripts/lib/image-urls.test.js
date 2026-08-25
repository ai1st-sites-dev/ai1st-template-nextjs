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
const { collectAllowedImageUrls, imageUrlRejection, attachedImagesNote, IMAGE_FIELDS } = lib;

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

// ── 顺带：写入闸认的字段集必须覆盖模板读的全部字段 ────────────────────────────────────────────
const uncovered = [...leafFields].filter((f) => !IMAGE_FIELDS.includes(f));
uncovered.length
  ? bad(`lib/image-urls.js 的 IMAGE_FIELDS 漏了模板真的画的字段: ${uncovered.join(' · ')} —— 那道写入闸对它按构造失明`)
  : ok(`写入闸的 IMAGE_FIELDS（${IMAGE_FIELDS.join(' · ')}）覆盖了模板读的全部字段`);

console.log(`\n${fail === 0 ? '✅' : '❌'} ${pass} 过 · ${fail} 败`);
process.exit(fail === 0 ? 0 : 1);
