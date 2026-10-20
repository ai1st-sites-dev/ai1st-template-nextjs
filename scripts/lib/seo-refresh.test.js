#!/usr/bin/env node
/**
 * seo-refresh.test.js — #1938：一页的 title / description 自动维护（lib/seo-refresh.js + `site.js seo-refresh`）。
 *
 * 跑法:  node scripts/lib/seo-refresh.test.js   （或 `npm run test:scripts`）
 * 退出码: 0 全过 · 1 有失败
 *
 * ① 文案比对（AC1），`blocks` 页和 `sections` 页各一张夹具、结果逐条相同：
 *    只改 imageUrl / href / alt / options / 块顺序 ⟹ 退出（same-text）；改 headline / 列表项 title / FAQ 答案 ⟹ 重写
 * ② 共用块（`{ref}`）的字改了 ⟹ 引用它的两页重写，没引用的那页退出
 * ③ 收尾的上限（AC8）：AI 回 70 字的 title ⟹ 落盘 ≤ pageTitleBudget；description 超过 descriptionAccept 上限 ⟹ 被裁
 * ④ 只写两个键：子页改它那份页面 JSON 的 title / description、别的键不动；首页改 seo.json、pages/home.json 不动
 * ⑤ seoMode = custom ⟹ 什么都不写；--force ⟹ 字没变也重写；AI 调不通 ⟹ 抛错，用量照样带出来（manager 记账）
 * ⑤b title / description 取到是空、或收尾裁完才空 ⟹ 不写（skipped: empty），AI / skipAI 两条路都验
 * ⑥ 命令行（真 `site.js seo-refresh --skip-ai`）：result.json 只带那一个文件、summary 是那句话；字没变 ⟹ skipped，不写 result.json
 */

'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const { seoRefresh, SUMMARY } = require('./seo-refresh');
const { pageTitleBudget, TITLE_MAX } = require('./seo-problems');
const { descriptionAccept, descriptionRange } = require('./description-fit');

let pass = 0;
let fail = 0;
function check(name, cond, detail) {
  if (cond) { pass += 1; console.log(`  ✓ ${name}`); } else { fail += 1; console.log(`  ✗ ${name}${detail ? ` —— ${detail}` : ''}`); }
}
const clone = (v) => JSON.parse(JSON.stringify(v));
const cp = (s) => [...String(s)].length;

// 一页的块：hero（标题 + 图 + 按钮 + 旋钮）· features（列表项 title）· faq（问答）· 一个引用共用块的 `{ref}`。
function blocks(slug, { ref = true } = {}) {
  return [
    { id: `${slug}-hero`, type: 'hero', data: { options: { textAlign: 'left' }, headline: `Window Cleaning in Toronto (${slug})`, subheadline: 'Streak-free windows for busy Toronto homes and offices, done by bonded teams.',
      image: { imageUrl: 'https://img.example/a.jpg', alt: 'A clean window' }, ctas: [{ label: 'Get a quote', href: '/contact', style: 'solid' }] } },
    { id: `${slug}-features`, type: 'features', data: { headline: 'Why us', items: [{ title: 'Eco products', description: 'Safe for kids and pets.', icon: 'leaf' }, { title: 'Same-day', description: 'Book by noon.', icon: 'clock' }] } },
    { id: `${slug}-faq`, type: 'faq', data: { headline: 'Questions', items: [{ question: 'Do you do high-rises?', answer: 'Up to six floors.' }] } },
    ...(ref ? [{ ref: 'shared-cta' }] : []),
  ];
}
const withShape = (page, shape) => {
  if (shape === 'blocks') return page;
  const { blocks: b, ...rest } = page;
  // 老站形状：没有 id，块序就是数组顺序。
  return { ...rest, sections: b.map((x) => (x.ref ? x : { type: x.type, data: x.data })) };
};

function site(shape) {
  const page = (slug, title, opts) => withShape({ slug, title, description: `Old description of ${slug}.`, navLabel: title, seo: { targetKeyword: 'Window Cleaning' }, blocks: blocks(slug, opts) }, shape);
  return {
    'brand.json': { name: { en: 'SparkleClean' } },
    'site_meta.json': { siteId: 'site-t', defaultLocale: 'en', locales: ['en'] },
    'en/seo.json': { siteTitle: 'Old home title', siteDescription: 'Old home description.', targetKeywords: { primary: { keyword: 'Window Cleaning' } }, schema: { priceRange: '$$' } },
    'en/blocks/site-blocks.json': { 'shared-cta': { type: 'cta', data: { headline: 'Call SparkleClean today', ctas: [{ label: 'Call', href: 'tel:1' }] } } },
    'en/pages/home.json': page('home', 'Home'),
    'en/pages/services/window-cleaning.json': page('services/window-cleaning', 'Window Cleaning'),
    'en/pages/contact.json': page('contact', 'Contact', { ref: false }),
  };
}
const PAYLOAD = { companyName: 'SparkleClean', industry: 'Window cleaning', location: 'Toronto, Ontario, Canada' };

/** 在 key 那一页上做一个改动（两种形状都认：blocks 按 id、sections 按位置）。 */
function edit(content, key, fn) {
  const next = clone(content);
  const p = next[key];
  fn(p.blocks || p.sections, p);
  return next;
}
const blockOf = (arr, type) => arr.find((b) => b.type === type);

async function run(before, after, page, extra = {}) {
  return seoRefresh({ site: after, before, locale: 'en', page, skipAI: true, payload: PAYLOAD, ...extra });
}

(async () => {
  // ① 文案比对
  const SUB = 'services/window-cleaning';
  const KEY = `en/pages/${SUB}.json`;
  const cases = [
    ['imageUrl', (a) => { blockOf(a, 'hero').data.image.imageUrl = 'https://img.example/b.jpg'; }, 'same-text'],
    ['href', (a) => { blockOf(a, 'hero').data.ctas[0].href = '/book'; }, 'same-text'],
    ['alt', (a) => { blockOf(a, 'hero').data.image.alt = 'Another photo'; }, 'same-text'],
    ['options', (a) => { blockOf(a, 'hero').data.options.textAlign = 'center'; }, 'same-text'],
    ['块顺序', (a) => { const i = a.findIndex((b) => b.type === 'faq'); const j = a.findIndex((b) => b.type === 'features'); [a[i], a[j]] = [a[j], a[i]]; }, 'same-text'],
    ['headline', (a) => { blockOf(a, 'hero').data.headline = 'Spotless Window Cleaning for Toronto Homes'; }, 'rewrite'],
    ['列表项 title', (a) => { blockOf(a, 'features').data.items[0].title = 'Green products only'; }, 'rewrite'],
    ['FAQ 答案', (a) => { blockOf(a, 'faq').data.items[0].answer = 'Up to ten floors.'; }, 'rewrite'],
  ];
  const outcome = {};
  for (const shape of ['blocks', 'sections']) {
    const before = site(shape);
    for (const [what, fn, want] of cases) {
      const r = await run(before, edit(before, KEY, fn), SUB);
      const got = r.skipped ? r.skipped : 'rewrite';
      (outcome[what] = outcome[what] || []).push(got);
      check(`① ${shape} · 改 ${what} ⟹ ${want === 'same-text' ? '退出' : '重写'}`, want === 'same-text' ? r.skipped === 'same-text' : !r.skipped && r.key === KEY,
        JSON.stringify(r).slice(0, 200));
    }
  }
  check('① sections 和 blocks 两张夹具结果逐条相同', Object.values(outcome).every(([a, b]) => a === b), JSON.stringify(outcome));

  // ② 共用块的字改了 ⟹ 引用它的两页重写，没引用的那页退出
  for (const shape of ['blocks', 'sections']) {
    const before = site(shape);
    const after = clone(before);
    after['en/blocks/site-blocks.json']['shared-cta'].data.headline = 'Book SparkleClean online';
    const home = await run(before, after, 'home');
    const sub = await run(before, after, SUB);
    const contact = await run(before, after, 'contact');
    check(`② ${shape} · 共用块改字 ⟹ 引用它的 home、${SUB} 重写`, !home.skipped && !sub.skipped, `${home.skipped} ${sub.skipped}`);
    check(`② ${shape} · 没引用的 contact 退出`, contact.skipped === 'same-text', String(contact.skipped));
    const linkOnly = clone(before);
    linkOnly['en/blocks/site-blocks.json']['shared-cta'].data.ctas[0].href = 'tel:2';
    check(`② ${shape} · 共用块只改链接 ⟹ 引用它的页也退出`, (await run(before, linkOnly, SUB)).skipped === 'same-text');
  }

  // ③ 收尾的上限
  {
    const before = site('blocks');
    const after = edit(before, KEY, (a) => { blockOf(a, 'hero').data.headline = 'Changed'; });
    const longTitle = 'Window Cleaning Toronto Experts Offering Streak Free Results All Years'; // 70
    const longDesc = `Window Cleaning in Toronto by SparkleClean. ${'Streak-free glass, careful teams, fair prices. '.repeat(9)}`;
    let prompt = '';
    const ai = async (a) => { prompt = a.prompt; return { title: longTitle, description: longDesc, usage: { model: a.model, inputTokens: 10, outputTokens: 5 } }; };
    const r = await seoRefresh({ site: after, before, locale: 'en', page: SUB, payload: PAYLOAD, ai });
    const budget = pageTitleBudget('SparkleClean');
    check('③ 喂 70 字 title ⟹ 落盘 ≤ pageTitleBudget', cp(longTitle) === 70 && cp(r.title) <= budget && r.title.startsWith('Window Cleaning'), `${cp(r.title)} > ${budget}? ${r.title}`);
    check('③ description 超过 descriptionAccept 上限 ⟹ 被裁（裁到目标区间）', cp(longDesc) > descriptionAccept('en').max && cp(r.description) <= descriptionRange('en').max, String(cp(r.description)));
    check('③ 用量带出来（manager 按它记账）', r.usage && r.usage.inputTokens === 10 && r.usage.outputTokens === 5 && r.usage.model);
    check('③ 提示词带目标词、地点、建站时那句 title 规格', prompt.includes('"Window Cleaning"') && prompt.includes('"Toronto"') && prompt.includes(`max ${budget} chars`) && prompt.includes('Changed'));
    const home = await seoRefresh({ site: edit(before, 'en/pages/home.json', (a) => { blockOf(a, 'hero').data.headline = 'X'; }), before, locale: 'en', page: 'home', payload: PAYLOAD,
      ai: async () => ({ title: `${longTitle} and more`, description: 'Window Cleaning in Toronto, done right by SparkleClean teams who care about every pane of glass.' }) });
    check('③ 首页 title 上限是 60（原样当 <title>）', cp(home.title) <= TITLE_MAX && cp(home.title) > budget, String(cp(home.title)));
  }

  // ④ 只写两个键
  {
    const before = site('blocks');
    const after = edit(before, KEY, (a) => { blockOf(a, 'hero').data.headline = 'Spotless Window Cleaning for Toronto Homes'; });
    const r = await run(before, after, SUB);
    const changed = Object.keys(r.file).filter((k) => JSON.stringify(r.file[k]) !== JSON.stringify(after[KEY][k]));
    check('④ 子页：只有 title / description 变了', JSON.stringify(changed.sort()) === '["description","title"]' && Object.keys(r.file).length === Object.keys(after[KEY]).length, JSON.stringify(changed));
    check('④ skipAI：title = H1（含地点就不再补）、description = 第一段正文', r.title === 'Spotless Window Cleaning for Toronto Homes' && r.description.startsWith('Streak-free windows'), `${r.title} / ${r.description}`);
    const h = await run(before, edit(before, 'en/pages/home.json', (a) => { blockOf(a, 'hero').data.headline = 'Clear Views Every Season'; }), 'home');
    check('④ 首页：写的是 seo.json 的 siteTitle / siteDescription', h.key === 'en/seo.json' && h.file.siteTitle === 'Clear Views Every Season | Toronto' && h.file.schema.priceRange === '$$', `${h.key} ${h.file && h.file.siteTitle}`);
    const asString = clone(after);
    asString[KEY] = JSON.stringify(after[KEY]);
    const s = await run(before, asString, SUB);
    check('④ 存成字符串的文件还是字符串', typeof s.file === 'string' && JSON.parse(s.file).title === r.title);
  }

  // ⑤ custom / force / AI 失败
  {
    const before = site('blocks');
    const after = edit(before, KEY, (a, p) => { blockOf(a, 'hero').data.headline = 'Something new'; p.seoMode = 'custom'; });
    check('⑤ 子页 seoMode = custom ⟹ 什么都不写', (await run(before, after, SUB)).skipped === 'custom');
    const homeCustom = clone(edit(before, 'en/pages/home.json', (a) => { blockOf(a, 'hero').data.headline = 'Y'; }));
    homeCustom['en/seo.json'].seoMode = 'custom';
    check('⑤ 首页 seoMode（在 seo.json）= custom ⟹ 什么都不写', (await run(before, homeCustom, 'home')).skipped === 'custom');
    const forced = await run(before, before, SUB, { force: true });
    check('⑤ --force ⟹ 字没变也重写', !forced.skipped && forced.key === KEY, JSON.stringify(forced).slice(0, 120));
    let thrown = null;
    try {
      await seoRefresh({ site: edit(before, KEY, (a) => { blockOf(a, 'hero').data.headline = 'Z'; }), before, locale: 'en', page: SUB, payload: PAYLOAD,
        ai: async (a) => ({ error: '回包不是 JSON 对象', usage: { model: a.model, inputTokens: 3, outputTokens: 1 } }) });
    } catch (e) { thrown = e; }
    check('⑤ AI 吐不回对象 ⟹ 抛错，用量挂在错误上', thrown && thrown.usage && thrown.usage.inputTokens === 3);
  }

  // ⑤b 空的不写（PM 2026-10-20 12:52 裁定 ②）：文字块删光的页，skipAI 取到空 title / description ⟹ 这一页不写；AI 那条回了
  //    title 却回空 description 也走同一道闸
  {
    const before = site('blocks');
    const emptied = edit(before, KEY, (a, p) => { p.blocks = []; });
    const r = await run(before, emptied, SUB);
    check('⑤b skipAI 文字块删光 ⟹ skipped，不出 file', r.skipped === 'empty' && !r.file && !r.key, JSON.stringify(r).slice(0, 160));
    const ai = await seoRefresh({ site: edit(before, KEY, (a) => { blockOf(a, 'hero').data.headline = 'Q'; }), before, locale: 'en', page: SUB, payload: PAYLOAD,
      ai: async (a) => ({ title: 'Window Cleaning Toronto', description: '  ', usage: { model: a.model, inputTokens: 5, outputTokens: 2 } }) });
    check('⑤b AI 回空 description ⟹ 同一道闸 skipped，用量照样带出来', ai.skipped === 'empty' && !ai.file && ai.usage && ai.usage.inputTokens === 5, JSON.stringify(ai).slice(0, 160));
    // 裁完才空（QA3 r2）：H1 是一整排 `—`，取到时不空、§fitTitle 裁头剥分隔符之后成了空串 ⟹ 落盘前那一次判断拦下
    const dashes = '—'.repeat(70);
    const r2 = await run(before, edit(before, KEY, (a) => { blockOf(a, 'hero').data.headline = dashes; }), SUB);
    check('⑤b skipAI H1 = 70 个 — ⟹ 裁完是空 ⟹ skipped，不出 file', r2.skipped === 'empty' && !r2.file && !r2.key, JSON.stringify(r2).slice(0, 160));
    const ai2 = await seoRefresh({ site: edit(before, KEY, (a) => { blockOf(a, 'hero').data.headline = 'R'; }), before, locale: 'en', page: SUB, payload: PAYLOAD,
      ai: async (a) => ({ title: dashes, description: 'Streak-free windows for busy Toronto homes and offices, done by bonded and insured teams.', usage: { model: a.model, inputTokens: 7, outputTokens: 2 } }) });
    check('⑤b AI 回 70 个 — 的 title ⟹ 裁完是空 ⟹ skipped，用量照样带出来', ai2.skipped === 'empty' && !ai2.file && ai2.usage && ai2.usage.inputTokens === 7, JSON.stringify(ai2).slice(0, 160));
  }

  // ⑥ 命令行
  {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'seo-refresh-test-'));
    try {
      const before = site('blocks');
      const after = edit(before, KEY, (a) => { blockOf(a, 'hero').data.headline = 'Spotless Window Cleaning for Toronto Homes'; });
      fs.writeFileSync(path.join(dir, 'before.json'), JSON.stringify(before));
      fs.writeFileSync(path.join(dir, 'after.json'), JSON.stringify(after));
      const cli = (siteFile, out) => execFileSync('node', [path.join(__dirname, '..', 'site.js'), 'seo-refresh', '--site', path.join(dir, siteFile), '--before', path.join(dir, 'before.json'),
        '--locale', 'en', '--page', SUB, '--skip-ai', '--out-dir', path.join(dir, out)], { input: JSON.stringify(PAYLOAD), stdio: ['pipe', 'pipe', 'pipe'] }).toString().trim().split('\n');
      const lines = cli('after.json', 'o1');
      const last = JSON.parse(lines[lines.length - 1]);
      const result = JSON.parse(fs.readFileSync(path.join(dir, 'o1', 'result.json'), 'utf-8'));
      check('⑥ 最后一行 seo-refresh 指着 result.json', last.event === 'seo-refresh' && last.result === path.join(dir, 'o1', 'result.json') && last.path === 'skipAI', lines[lines.length - 1]);
      check('⑥ result.json 只带那一个文件、summary 是那句话', JSON.stringify(Object.keys(result.content)) === JSON.stringify([KEY]) && result.summary === SUMMARY && SUMMARY === 'Page title updated automatically');
      const same = JSON.parse(cli('before.json', 'o2').pop());
      check('⑥ 字没变 ⟹ skipped，不写 result.json', same.skipped === 'same-text' && !fs.existsSync(path.join(dir, 'o2', 'result.json')), JSON.stringify(same));
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  }

  console.log(`\n${pass} 过 · ${fail} 败`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
