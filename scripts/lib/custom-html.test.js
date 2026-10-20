#!/usr/bin/env node
/**
 * custom-html.test.js — #1833（SiteAsData T4a-1）：Custom HTML 入库前的那一次整理（`lib/custom-html.js`）和它的三个接线点。
 *
 *   ① tidyHtml：没闭合的补上、`<html>` / `<body>` 外壳去掉、内容不改；幂等（整理过的再整理逐字相同 —— 料里有 parse5【一遍】
 *      到不了不动点的 `<table><p><form>`，和仓里那份 DOMPurify 向量集全部 223 条）；`<plaintext>` 拒（「Custom HTML can't
 *      use the <plaintext> tag」）；64 KB 是上限（正好 64 KB 收、多一个字节抛 CustomHtmlError，话是「Custom HTML is limited
 *      to 64 KB」，量的是不动点那份）；css 同一个上限。
 *   ② 页面 / 站级块 / content：只动 custom-html 块；content 里没点名、没变的键原样（同一个对象）。
 *   ③ `site.js save`（site-editor.js §save）：落库的是整理过的那份；超 64 KB ⟹ `bad`（manager 回 400 + 那句话）；
 *      存进去之后只改别的块再存 ⟹ 那一块逐字不变、不被拒（#1833 r3 QA1：save 每次都把每一块再整理一遍）；`<plaintext>` 第一次就 `bad`。
 *      反向对照：把 custom-html.js 换成「不整理」的替身 ⟹ 落库的是原文（这一格量得出接没接上）。
 *   ④ `site.js validate`（site-edit.js §validate）：AI 那一轮改过的页面里的 custom-html 落库前整理；没改的文件原样；超限 /
 *      `<plaintext>` ⟹ `refused`。
 *   ⑤ customHtmlOf：页面和站级块里每一块 custom-html 的 html 都收（值是对象或 JSON 原文都认），别的块不收 —— PurgeCSS 看的就是它。
 *   ⑥ 老形状的页面（`sections`，#998 两种并存）：整理和 customHtmlOf 都认（#1833 r5 —— 只认 `blocks` 时样例站 allblocks 页那张
 *      `table-sm` 表被 PurgeCSS 剪掉，theme-css 两片都红；同样的页面在真站上存盘也不会被整理）。
 *
 *   node scripts/lib/custom-html.test.js     （由 `npm run test:scripts` 自动发现）
 *   退出码: 0 全过 · 1 有失败 · 2 跑不起来（**不许当成通过**）
 */
'use strict';

const path = require('path');

let pass = 0; let fail = 0;
const ok = (m) => { pass += 1; console.log(`  ✅ ${m}`); };
const bad = (m) => { fail += 1; console.log(`  ❌ ${m}`); };
const check = (cond, m, detail) => (cond ? ok(m) : bad(detail === undefined ? m : `${m} —— ${typeof detail === 'string' ? detail : JSON.stringify(detail)}`));
function die(msg) { console.log(`💥 跑不起来: ${msg}`); process.exit(2); }

const CH_PATH = path.join(__dirname, 'custom-html.js');
let ch; let FIXTURE;
try {
  ch = require(CH_PATH);
  FIXTURE = require(path.join(__dirname, '..', 'fixtures', 'site-fixtures', 'site-0448c807.json'));
} catch (e) {
  die(`加载不了被测模块 / 夹具站: ${e.message}`);
}
const clone = (v) => JSON.parse(JSON.stringify(v));
const parse5Serialize = (h) => { const p5 = require('parse5'); return p5.serialize(p5.parseFragment(h)); };
const HOME = 'en/pages/home.json';
if (!FIXTURE[HOME]) die(`夹具站里没有 ${HOME}`);

const UNCLOSED = '<html><body><div><b>没闭合</body></html>';
// #1833 r3 QA1：标签全闭合的合法片段，parse5 解析再序列化一遍还不是不动点（第二遍又挪一次、+7 字节）。
const TWO_PASS = '<div><table><p><form>x</form></p></table></div>';
const NO_PLAINTEXT = "Custom HTML can't use the <plaintext> tag";
const TIDIED = '<div><b>没闭合</b></div>';
const block = (html, extra = {}) => ({ id: 'ch1', type: 'custom-html', role: 'optional', region: 'content', weight: 9999, data: { html, label: 'Test', ...extra } });
const throwsTooLarge = (fn) => {
  try { fn(); } catch (e) { return e instanceof ch.CustomHtmlError && e.message === 'Custom HTML is limited to 64 KB'; }
  return false;
};

async function main() {
  console.log('① tidyHtml');
  check(ch.tidyHtml(UNCLOSED) === TIDIED, `${UNCLOSED} ⟹ ${TIDIED}`, ch.tidyHtml(UNCLOSED));
  const samples = [UNCLOSED, '<p>hi<p>there', '<table><tr><td>x</table>', '<script>if (a < b) { go() }</script><p>x</p>',
    '<!-- note --><div data-x="1">ok</div>', '<iframe src="https://calendly.com/x"></iframe>', 'plain text & stuff',
    TWO_PASS, '<svg><plaintext>x</plaintext></svg>'];
  check(parse5Serialize(parse5Serialize(TWO_PASS)) !== parse5Serialize(TWO_PASS), '夹具自证：TWO_PASS 解析再序列化一遍不是不动点（这条料有牙）');
  for (const s of samples) {
    const once = ch.tidyHtml(s);
    check(ch.tidyHtml(once) === once, `幂等：${JSON.stringify(s).slice(0, 50)}`, once);
  }
  check(ch.tidyHtml('<script>if (a < b) { go() }</script>') === '<script>if (a < b) { go() }</script>', '脚本里的字一个不改（不「修复」老板的代码）');
  check(ch.tidyHtml(undefined) === '', '不是字符串 ⟹ 空串');
  {
    const vectors = (await import(path.join(__dirname, '..', 'fixtures', 'dompurify-vectors', 'expect-3.4.17.mjs'))).default;
    const unstable = [];
    for (const v of vectors) {
      try {
        const once = ch.tidyHtml(v.payload);
        if (ch.tidyHtml(once) !== once) unstable.push(v.title);
      } catch (e) {
        if (!(e instanceof ch.CustomHtmlError)) unstable.push(`${v.title}: ${e.message}`);
      }
    }
    check(vectors.length > 200 && vectors.every((v) => typeof v.payload === 'string' && v.payload) && unstable.length === 0, `仓里的 DOMPurify 向量集 ${vectors.length} 条：每条整理一遍之后再整理逐字相同`, unstable);
  }
  const throwsPlaintext = (fn) => {
    try { fn(); } catch (e) { return e instanceof ch.CustomHtmlError && e.message === NO_PLAINTEXT; }
    return false;
  };
  for (const s of ['<plaintext>hello & <b>world</b>', '<p>x</p><PLAINTEXT>y', '<template><plaintext>x</template>']) {
    check(throwsPlaintext(() => ch.tidyHtml(s)), `${JSON.stringify(s)} ⟹ CustomHtmlError「${NO_PLAINTEXT}」（它吞掉后面整页，整理闭合不了它）`);
  }
  check(ch.tidyHtml('<p>&lt;plaintext&gt;</p>') === '<p>&lt;plaintext&gt;</p>', '只是文字里写着 <plaintext> ⟹ 照收');
  const at = 'x'.repeat(ch.MAX_BYTES);
  check(ch.tidyHtml(at) === at, `正好 ${ch.MAX_BYTES} 字节 ⟹ 收`);
  check(throwsTooLarge(() => ch.tidyHtml(`${at}x`)), '多一个字节 ⟹ CustomHtmlError「Custom HTML is limited to 64 KB」');
  check(throwsTooLarge(() => ch.tidyHtml('é'.repeat(ch.MAX_BYTES / 2 + 1))), '按 UTF-8 字节算，不按字符数（é 两个字节）');
  check(throwsTooLarge(() => ch.tidyCustomHtmlData({ html: '<p>x</p>', css: `${at}x` })), 'css 同一个上限');
  // #1833 r3（QA3）：上限量的是落库那份 —— 整理会让输出比输入大（补闭合、转义）。
  const growP = '<p>'.repeat(21000);      // 63,000 字节 → 整理后 147,000
  const growAmp = `<div>${'a & '.repeat(16000)}</div>`; // 64,011 字节 → 整理后 128,011
  check(Buffer.byteLength(growP) < ch.MAX_BYTES && Buffer.byteLength(parse5Serialize(growP)) > ch.MAX_BYTES, '夹具自证：未闭合的 <p> 原文不到 64 KB、整理后超');
  check(throwsTooLarge(() => ch.tidyHtml(growP)), '原文不到 64 KB、补闭合后超 ⟹ 第一次就抛（不让它落库）');
  check(throwsTooLarge(() => ch.tidyHtml(growAmp)), '原文不到 64 KB、`&` 转义后超 ⟹ 第一次就抛');
  const nearP = '<p>'.repeat(Math.floor(ch.MAX_BYTES / 7)); // 整理后正好落在上限以内
  const nearOnce = ch.tidyHtml(nearP);
  check(Buffer.byteLength(nearOnce) <= ch.MAX_BYTES && Buffer.byteLength(nearOnce) > ch.MAX_BYTES - 7 && ch.tidyHtml(nearOnce) === nearOnce,
    '整理后贴着上限的那份：再整理一遍不抛、逐字相同（已经存进去的块，改别的块再保存不被拒）', Buffer.byteLength(nearOnce));
  // #1833 r3 QA1 实例 B：原文 65,518 字节、整理一遍不变大、第二遍才变大 ⟹ 第一次就该抛，不是存进去之后下一次保存才抛。
  const twoPassBig = TWO_PASS.repeat(1394);
  check(Buffer.byteLength(twoPassBig) < ch.MAX_BYTES && Buffer.byteLength(parse5Serialize(twoPassBig)) <= ch.MAX_BYTES,
    '夹具自证：TWO_PASS ×1394 原文和整理一遍都不到 64 KB（只量一遍会放它进去）');
  check(throwsTooLarge(() => ch.tidyHtml(twoPassBig)), 'TWO_PASS ×1394：不动点那份超 64 KB ⟹ 第一次就抛');
  const twoPassNear = TWO_PASS.repeat(Math.floor(ch.MAX_BYTES / ch.tidyHtml(TWO_PASS).length));
  {
    let once; let again; let err = null;
    try { once = ch.tidyHtml(twoPassNear); again = ch.tidyHtml(once); } catch (e) { err = e; }
    check(!err && Buffer.byteLength(once) > ch.MAX_BYTES - 60 && again === once,
      'TWO_PASS 贴着上限的那份：再整理一遍不抛、逐字相同', err ? err.message : Buffer.byteLength(once));
  }

  console.log('② 页面 / 站级块 / content');
  const page = { slug: 'home', blocks: [{ id: 'h', type: 'hero', data: { headline: '<b>not code' } }, block(UNCLOSED)] };
  const tp = ch.tidyCustomHtmlInPage(page);
  check(tp.blocks[1].data.html === TIDIED && tp.blocks[1].data.label === 'Test', '页面：custom-html 那一块整理了，别的键原样');
  check(tp.blocks[0] === page.blocks[0], '页面：别的块原样（同一个对象，一个字不碰）');
  check(page.blocks[1].data.html === UNCLOSED, '不改传进来的那一份');
  const sb = ch.tidyCustomHtmlInSiteBlocks({ a: block(UNCLOSED), b: { type: 'cta', data: { headline: 'x' } } });
  check(sb.a.data.html === TIDIED && sb.b.data.headline === 'x', '站级块：custom-html 那一块整理了，别的块原样');
  const content = { [HOME]: JSON.stringify({ ...page }), 'en/pages/faq.json': { slug: 'faq', blocks: [block(UNCLOSED)] }, 'brand.json': { name: 'x' } };
  const tc = ch.tidyCustomHtmlInContent(content, [HOME]);
  check(tc[HOME].blocks[1].data.html === TIDIED, 'content：点名的页面（值是 JSON 原文）整理了，换成对象');
  check(tc['en/pages/faq.json'] === content['en/pages/faq.json'] && tc['brand.json'] === content['brand.json'], 'content：没点名的键原样（同一个对象）');
  const already = { [HOME]: { slug: 'home', blocks: [block(TIDIED)] } };
  check(ch.tidyCustomHtmlInContent(already, [HOME])[HOME] === already[HOME], 'content：整理过的再整理 ⟹ 原样（「这一笔改了哪些文件」不会因为它多出来）');

  console.log('③ site.js save（site-editor.js §save）');
  const ed = require('./site-editor');
  const homePage = clone(typeof FIXTURE[HOME] === 'string' ? JSON.parse(FIXTURE[HOME]) : FIXTURE[HOME]);
  const withBlock = (html) => ({ ...homePage, blocks: [...homePage.blocks, block(html)] });
  const saved = await ed.save({ content: clone(FIXTURE), changes: { page: 'home', locale: 'en', json: withBlock(UNCLOSED) }, keep: true });
  const savedHtml = (saved.content[HOME].blocks.find((b) => b.id === 'ch1') || {}).data;
  check(savedHtml && savedHtml.html === TIDIED, `落库的是 ${TIDIED}`, savedHtml && savedHtml.html);
  check(saved.files.includes(HOME), '这一笔写了首页', saved.files);
  let tooBig = null;
  try {
    await ed.save({ content: clone(FIXTURE), changes: { page: 'home', locale: 'en', json: withBlock('x'.repeat(65 * 1024)) }, keep: true });
  } catch (e) { tooBig = e; }
  check(tooBig instanceof ed.SiteEditorError && tooBig.code === 'bad' && tooBig.message === 'Custom HTML is limited to 64 KB',
    '贴 65 KB ⟹ SiteEditorError(bad)「Custom HTML is limited to 64 KB」（manager 回 400 + 这句）', tooBig && `${tooBig.code} ${tooBig.message}`);
  let grown = null;
  try {
    await ed.save({ content: clone(FIXTURE), changes: { page: 'home', locale: 'en', json: withBlock('<p>'.repeat(21000)) }, keep: true });
  } catch (e) { grown = e; }
  check(grown instanceof ed.SiteEditorError && grown.code === 'bad' && grown.message === 'Custom HTML is limited to 64 KB',
    '贴 63 KB 未闭合 <p>（整理后 147 KB）⟹ 第一次保存就 bad「Custom HTML is limited to 64 KB」', grown && `${grown.code} ${grown.message}`);
  // #1833 r3 QA1：存进去之后只改 hero 再存（编辑器回传的是上一次落库那份）⟹ custom-html 那一块逐字不变、不被拒。
  const heroEdit = (pageJson) => ({ ...pageJson, blocks: pageJson.blocks.map((b) => (b.type === 'hero' ? { ...b, data: { ...b.data, headline: `${b.data.headline || ''}!` } } : b)) });
  for (const [name, html] of [['TWO_PASS', TWO_PASS], ['TWO_PASS 贴着上限', twoPassNear]]) {
    let content = clone(FIXTURE);
    let json = withBlock(html);
    const seen = [];
    let err = null;
    try {
      for (let i = 0; i < 3; i += 1) {
        const r = await ed.save({ content, changes: { page: 'home', locale: 'en', json }, keep: true });
        content = r.content;
        seen.push(r.content[HOME].blocks.find((b) => b.id === 'ch1').data.html);
        json = heroEdit(r.content[HOME]);
      }
    } catch (e) { err = e; }
    check(!err && seen.length === 3 && seen.every((h) => h === seen[0]),
      `${name}：存一次，再只改 hero 存两次 ⟹ 三次都 200、那一块逐字相同`, err ? `${err.code} ${err.message}` : seen.map((h) => Buffer.byteLength(h)));
  }
  let pt = null;
  try {
    await ed.save({ content: clone(FIXTURE), changes: { page: 'home', locale: 'en', json: withBlock('<plaintext>hello & <b>world</b>') }, keep: true });
  } catch (e) { pt = e; }
  check(pt instanceof ed.SiteEditorError && pt.code === 'bad' && pt.message === NO_PLAINTEXT,
    `贴 <plaintext> ⟹ 第一次保存就 bad「${NO_PLAINTEXT}」`, pt && `${pt.code} ${pt.message}`);
  // 反向对照：custom-html.js 换成「不整理」的替身 ⟹ 落库的是原文。
  {
    const real = require.cache[CH_PATH];
    const stub = { ...ch, tidyCustomHtmlInPage: (p) => p, tidyCustomHtmlData: (d) => d };
    require.cache[CH_PATH] = { ...real, exports: stub };
    let raw;
    try {
      const r = await ed.save({ content: clone(FIXTURE), changes: { page: 'home', locale: 'en', json: withBlock(UNCLOSED) }, keep: true });
      raw = (r.content[HOME].blocks.find((b) => b.id === 'ch1') || {}).data.html;
    } finally {
      require.cache[CH_PATH] = real;
    }
    check(raw !== TIDIED, `反向对照：不整理的替身 ⟹ 落库的不是 ${TIDIED}（读到 ${JSON.stringify(raw)}）—— 上面那格量的是接线`);
  }

  console.log('④ site.js validate（site-edit.js §validate）');
  const { validate: validateLoud } = require('./site-edit');
  // 整站派生一遍的日志走 console.error（site-edit.js 自己把 console.log 改道过去），一屏跟判定无关 ⟹ 这两次调用期间收起来。
  const validate = async (args) => {
    const err = console.error;
    console.error = () => {};
    try { return await validateLoud(args); } finally { console.error = err; }
  };
  const next = clone(FIXTURE);
  next[HOME] = withBlock(UNCLOSED);
  const v = await validate({ prev: clone(FIXTURE), next });
  const vHtml = (v.content[HOME].blocks.find((b) => b.id === 'ch1') || {}).data;
  check(vHtml && vHtml.html === TIDIED, `AI 那一轮改过的首页：custom-html 落库前整理成 ${TIDIED}`, vHtml && vHtml.html);
  check(JSON.stringify(v.content['en/pages/faq.json']) === JSON.stringify(FIXTURE['en/pages/faq.json']), '没改的页面原样');
  let vBig = null;
  const nextBig = clone(FIXTURE);
  nextBig[HOME] = withBlock('x'.repeat(65 * 1024));
  try { await validate({ prev: clone(FIXTURE), next: nextBig }); } catch (e) { vBig = e; }
  check(vBig && vBig.code === 'refused' && /Custom HTML is limited to 64 KB/.test(vBig.message), '超 64 KB ⟹ refused，原话里有那一句', vBig && vBig.message.slice(-80));
  let vPt = null;
  const nextPt = clone(FIXTURE);
  nextPt[HOME] = withBlock('<plaintext>x');
  try { await validate({ prev: clone(FIXTURE), next: nextPt }); } catch (e) { vPt = e; }
  check(vPt && vPt.code === 'refused' && vPt.message.endsWith(NO_PLAINTEXT), '<plaintext> ⟹ refused，原话里有那一句', vPt && vPt.message.slice(-80));

  console.log('⑤ customHtmlOf（PurgeCSS 看的那份）');
  const got = ch.customHtmlOf({
    [HOME]: JSON.stringify({ blocks: [block('<a class="btn btn-outline-primary">x</a>'), { type: 'hero', data: { html: '<i>not ours</i>' } }] }),
    'zh/pages/about.json': { blocks: [block('<p class="lead">zh</p>')] },
    'en/blocks/site-blocks.json': { s1: block('<span class="badge">shared</span>') },
    'en/navigation.json': { html: '<b>nope</b>' },
    'en/pages/broken.json': '{ not json',
  });
  check(JSON.stringify(got.sort()) === JSON.stringify(['<a class="btn btn-outline-primary">x</a>', '<p class="lead">zh</p>', '<span class="badge">shared</span>'].sort()),
    '页面（原文 / 对象）+ 站级块里的 custom-html 都收；别的块、别的文件、坏 JSON 不收', got);

  console.log('⑥ 老形状的页面（sections）');
  const old = { slug: 'allblocks', sections: [{ type: 'hero', data: { headline: 'x' } }, block(UNCLOSED)] };
  const to = ch.tidyCustomHtmlInPage(old);
  check(Array.isArray(to.sections) && !('blocks' in to) && to.sections[1].data.html === TIDIED && to.sections[0] === old.sections[0],
    'sections 形状：custom-html 那一块整理了、还是 sections、别的块原样', to);
  const oldGot = ch.customHtmlOf({ 'en/pages/allblocks.json': JSON.stringify({ sections: [block('<table class="table table-sm"></table>')] }) });
  check(oldGot.length === 1 && oldGot[0].includes('table-sm'), 'customHtmlOf 收 sections 形状页面里的 custom-html', oldGot);
  const both = ch.customHtmlOf({ [HOME]: { blocks: [block('<i class="a">b</i>')], sections: [block('<i class="s">s</i>')] } });
  check(both.length === 1 && both[0].includes('class="a"'), '两个键都在 ⟹ 只读 blocks（同 blocks.js 的判法）', both);

  console.log(`\n${fail === 0 ? '✅' : '❌'} ${pass} 过 · ${fail} 失败`);
  process.exit(fail === 0 ? 0 : 1);
}

main().catch((e) => die(e && e.stack ? e.stack : String(e)));
