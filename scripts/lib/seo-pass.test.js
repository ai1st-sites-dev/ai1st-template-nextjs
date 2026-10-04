#!/usr/bin/env node
/**
 * seo-pass.test.js — 打桩建站：create-site.js 的每页 SEO 检查真的跑了、重写一次、按页面类型处置（#1549）。
 *
 * 跑法:  node scripts/lib/seo-pass.test.js   （或 `npm run test:scripts`，它按文件名发现）
 * 退出码: 0 全过 · 1 有失败 · 2 跑不起来（**不许当成通过**）
 *
 * 🔴 为什么是打桩、不是 skipAI：skipAI 走 `getDemoConfig` 的写死页，不经生成也不经 seoProblems ⟹ 量到的是演示夹具。
 *    这里走**真的 create-site.js 主路径**，只把 `@anthropic-ai/sdk` 换成一份按提示词回固定 JSON 的替身
 *    （`node --require <钩子>`，同 `edit-site-chain.test.js`）。agent 不跑真 AI（AI_TEAM 五条硬规则第 3 条，#1499）。
 * 🔴 证据从**日志**读，不从产物读：全过的页在 `pages/*.json` 里跟没跑过一模一样（验收 4）。
 *
 * 四跑（各在一份临时拷贝里，不碰工作区的 site/）：
 *   A  成功的双语站（主 en、次 zh）：about 页编了一个年份 → 重写一次修好；一个关键词页两次都不合格 → 丢掉。
 *      断言：主语言每页一行 `[seo] 检查`（页数 = 主语言页数）· 没有目标词的页只跑 1/2/3/5/6/8 · 「重写一次」·
 *      第 8 条「编造的事实」· 「丢掉 <slug>」+「关键词页 2/3」· 那页不在站里、页脚里也没有指向它的链接 ·
 *      次语言的页不出现在任何 `[seo]` 行里 · 提示词里的 title 预算是按品牌名算的数（不是 60）
 *   A' 反向对照：同一份夹具，about 的重写不修 ⟹ 建站失败 —— 证明 A 里 about 能过是因为那次重写
 *   B  about 页两次都出两个 H1 ⟹ 建站失败，信息写明 about 与「恰好一个 H1」；about 没被丢掉
 *   C  首页的目标词换成页面里不可能出现的词 ⟹ 日志里有首页的「重写一次」，仍不合格 ⟹ 建站失败、信息写明 home 和哪条
 */

'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const cp = require('child_process');

const NEXT = path.resolve(__dirname, '..', '..');

let pass = 0; let fail = 0;
const ok = (m) => { pass += 1; console.log(`  ✅ ${m}`); };
const bad = (m) => { fail += 1; console.log(`  ❌ ${m}`); };
const check = (cond, m, detail) => (cond ? ok(m) : bad(detail ? `${m} —— ${detail}` : m));
const die = (m) => { console.error(`🔴 跑不起来: ${m}`); process.exit(2); };

// ── 一份临时拷贝（node_modules 软链回来；site/ out/ .next 不拷）──────────────────────────────────
// 手跑用的两个开关（CI 不设）：SEO_PASS_ONLY=A 只跑 A；SEO_PASS_KEEP=1 不删临时目录（拿 A 那一站去真构建、读 out/）。
const ONLY = process.env.SEO_PASS_ONLY || '';
const ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'seo-pass-1549-'));
if (process.env.SEO_PASS_KEEP === '1') console.log(`📁 临时目录留着：${ROOT}`);
else process.on('exit', () => { try { fs.rmSync(ROOT, { recursive: true, force: true }); } catch (e) { /* 收尾 */ } });
const WORK = path.join(ROOT, 'nextjs');
fs.mkdirSync(WORK);
for (const e of fs.readdirSync(NEXT)) {
  if (['node_modules', 'out', '.next', '.out-backup', '.out-temp', 'site', 'sites'].includes(e)) continue;
  cp.execFileSync('cp', ['-a', '--no-dereference', path.join(NEXT, e), path.join(WORK, e)]);
}
if (!fs.existsSync(path.join(NEXT, 'node_modules'))) die('templates/nextjs/node_modules 不在');
fs.symlinkSync(path.join(NEXT, 'node_modules'), path.join(WORK, 'node_modules'));

// ── 替身：按提示词认是哪一通，回场景文件里写好的 JSON；每一次请求的提示词记进日志文件 ────────────────
const STUB = path.join(ROOT, 'stub.js');
fs.writeFileSync(STUB, `
const fs = require('fs');
const Module = require('module');
const scenario = JSON.parse(fs.readFileSync(process.env.SEO_STUB, 'utf-8'));
const fenced = (p) => { const m = p.match(/\\x60\\x60\\x60json\\n([\\s\\S]*?)\\n\\x60\\x60\\x60/); return m ? JSON.parse(m[1]) : null; };
function answer(prompt) {
  if (prompt.includes('Generate a JSON object with this EXACT structure')) return scenario.call1;
  // #1568 —— Call 1 每页一次：按提示词里那一页的 slug 回场景 call1 里那一页的 sections（站级那一通回的 sections 会被丢掉）。
  if (prompt.includes('Write the sections of ONE page')) {
    const slug = (prompt.match(/- slug: "([^"]+)"/) || [])[1];
    const pg = (scenario.call1.pages || []).find((x) => x.slug === slug);
    if (!pg) throw new Error('场景 call1 里没有这一页：' + slug);
    return { sections: pg.sections };
  }
  // #1550 —— 关键词页一页一次调用：按提示词里那一页的 slug 回场景里写好的那一页。
  if (prompt.includes('Write ONE keyword landing page')) {
    const slug = (prompt.match(/- slug: "([^"]+)"/) || [])[1];
    const pg = (scenario.call2 || []).find((x) => x.slug === slug);
    if (!pg) throw new Error('场景里没有这一页：' + slug);
    return pg;
  }
  if (prompt.includes('An automatic SEO check found the problems')) {
    const m = prompt.match(/\\n\\n(\\{[\\s\\S]*?\\n\\})\\n\\nPROBLEMS TO FIX/);
    const env = JSON.parse(m[1]);
    const r = (scenario.rewrites || {})[env.page.slug];
    return r && r !== 'echo' ? r : env;
  }
  if (prompt.includes('You are translating a website page')) return fenced(prompt);
  if (prompt.includes('You are translating website supporting config')) return fenced(prompt);
  throw new Error('替身不认得这个提示词：' + prompt.slice(0, 120));
}
class FakeAnthropic {
  constructor() {
    this.messages = {
      stream: (req) => ({
        on: () => {},
        finalMessage: async () => {
          const prompt = req.messages[req.messages.length - 1].content;
          fs.appendFileSync(process.env.SEO_STUB_LOG, JSON.stringify(prompt) + '\\n');
          const text = JSON.stringify(answer(prompt));
          return { id: 'm', type: 'message', role: 'assistant', model: req.model, content: [{ type: 'text', text }],
            stop_reason: 'end_turn', stop_sequence: null, usage: { input_tokens: 1, output_tokens: 1 } };
        },
      }),
    };
  }
}
const realLoad = Module._load;
Module._load = function (request) {
  if (request === '@anthropic-ai/sdk') return FakeAnthropic;
  return realLoad.apply(this, arguments);
};
`);

// ── 夹具 ───────────────────────────────────────────────────────────────────────────────────────
const BRAND = 'Acme Drains'; // 11 字 ⟹ 子页 page.title 预算 46
const desc = (core) => `${core} — Acme Drains serves Markham homeowners with fast, honest plumbing help every day.`;
const sec = (type, data) => ({ type, data });
const header = (h, sub) => sec('page-header', sub ? { headline: h, subheadline: sub } : { headline: h });

function kwPage(slug, kw, { title } = {}) {
  return {
    slug, title: title || `${kw.replace(/\b\w/g, (c) => c.toUpperCase())} Pros`, description: desc(`Fast ${kw}`),
    navLabel: kw, navOrder: 50, changeFrequency: 'monthly', priority: 0.6,
    sections: [
      header(`${kw} done right`, `Book ${kw} with local plumbers today.`),
      sec('content', { headline: `Why choose our ${kw}`, body: 'Licensed crews, clear prices, tidy work.' }),
      sec('faq', { headline: `${kw} questions`, items: [{ question: 'How fast?', answer: 'Usually the same day.' }] }),
      sec('cta', { headline: 'Book a visit', body: 'Call us today.', ctas: [{ label: 'Quote', href: '/quote', style: 'solid' }] }),
    ],
  };
}

function call1({ aboutBody = 'We started small and grew by word of mouth.', aboutTwoH1 = false } = {}) {
  return {
    colorScheme: 'light',
    brand: { tagline: 'Clear drains, same day', logoIcon: 'wrench', email: 'hi@acme.test', locations: [{ label: 'Main', address: '1 Main St, Markham', phone: '905-555-0142' }] },
    navigation: { ctaLabel: 'Get a quote', ctaPage: 'quote', footerDescription: 'Drain cleaning in Markham.' },
    seo: {
      domain: 'https://acme.test', siteTitle: 'Drain Cleaning in Markham | Acme Drains', siteDescription: desc('Drain cleaning and water heater repair'),
      areaServed: [{ type: 'City', name: 'Markham' }], addresses: [{ locality: 'Markham', region: 'ON', country: 'CA' }],
      openingHours: { days: ['Monday'], opens: '08:00', closes: '18:00' }, priceRange: '$$', offerCatalogName: 'Plumbing',
    },
    services: [
      { id: 'drain-cleaning', name: 'Drain Cleaning', shortDescription: 'Clogs cleared', fullDescription: 'We clear clogs.', icon: 'wrench', features: ['a'], products: [] },
      { id: 'water-heaters', name: 'Water Heaters', shortDescription: 'Repairs', fullDescription: 'We fix heaters.', icon: 'flame', features: ['b'], products: [] },
    ],
    forms: [
      { id: 'quote', name: 'Get a quote', buttonText: 'Send', successMessage: 'Thanks!' },
      { id: 'contact', name: 'Contact us', buttonText: 'Send', successMessage: 'Thanks!' },
    ],
    pages: [
      { slug: 'home', title: 'Home', description: desc('Drain cleaning'), navLabel: 'Home', navOrder: 0, changeFrequency: 'weekly', priority: 1,
        sections: [
          sec('hero', { headline: 'Drain Cleaning in Markham', subheadline: 'Fast drain cleaning by local plumbers.', ctas: [{ label: 'Get a quote', href: '/quote', style: 'solid' }] }),
          sec('features', { headline: 'Drain cleaning services', body: 'What we do.', items: { source: 'services' } }),
          sec('faq', { headline: 'Drain cleaning questions', items: [{ question: 'How fast?', answer: 'Same day.' }] }),
          sec('cta', { headline: 'Book a visit', body: 'Call us today.', ctas: [{ label: 'Quote', href: '/quote', style: 'solid' }] }),
        ] },
      { slug: 'about', title: 'About Acme', description: 'We are a family-run plumbing company that serves homeowners with care, honesty and fair prices.',
        navLabel: 'About', navOrder: 1, changeFrequency: 'monthly', priority: 0.7,
        sections: [header('About us'), ...(aboutTwoH1 ? [header('Our people')] : []), sec('content', { headline: 'Our story', body: aboutBody })] },
      { slug: 'quote', title: 'Get a Quote', description: 'Tell us about your plumbing problem and we will call you back the same day with an honest price.',
        navLabel: 'Quote', navOrder: 2, changeFrequency: 'monthly', priority: 0.8,
        sections: [header('Get a quote'), sec('contact', { headline: 'Request a quote', body: 'We reply the same day.', form: {}, options: { form: 'full' } })] },
      { slug: 'services/drain-cleaning', title: 'Drain Cleaning', description: desc('Drain cleaning for kitchens, baths and main lines'),
        navLabel: 'Drain Cleaning', navOrder: 10, changeFrequency: 'monthly', priority: 0.8, serviceDetailPage: true, parentService: 'drain-cleaning',
        sections: [header('Drain cleaning in Markham', 'Drain cleaning, same day.'), sec('content', { headline: 'How drain cleaning works', body: 'We camera-inspect, then clear.' }),
          sec('faq', { headline: 'Drain cleaning FAQ', items: [{ question: 'Is it messy?', answer: 'No.' }] })] },
    ],
  };
}
// #1550 起关键词页挂在 `services/<服务 id>/<词>` 下（URL 由代码定，AI 照抄）。
const KW_SLUGS = ['services/drain-cleaning/drain-cleaning-markham', 'services/drain-cleaning/clogged-drain-repair', 'services/water-heaters/tankless-water-heater'];
function call2() {
  return [
    kwPage(KW_SLUGS[0], 'drain cleaning Markham'),
    kwPage(KW_SLUGS[1], 'clogged drain repair'),
    kwPage(KW_SLUGS[2], 'tankless water heater', { title: 'Hot Water, Fast' }), // title 不含目标词 ⟹ 第 1 条
  ];
}
const KEYWORDS = (primary = 'drain cleaning') => ({
  'Drain Cleaning': [
    { keyword: primary, isPrimary: true, selected: true, goldIndex: 50, volume: 900 },
    { keyword: 'drain cleaning Markham', selected: true, goldIndex: 30, volume: 200 },
    { keyword: 'clogged drain repair', selected: true, goldIndex: 20, volume: 150 },
  ],
  'Water Heaters': [
    { keyword: 'water heater repair', isPrimary: true, selected: true, goldIndex: 40, volume: 500 },
    { keyword: 'tankless water heater', selected: true, goldIndex: 10, volume: 90 },
  ],
});
const PAYLOAD = (extra = {}) => ({
  siteId: 'seo1549t', companyName: BRAND, industry: 'plumbing', location: 'Markham, ON', address: '1 Main St, Markham',
  phone: '905-555-0142', email: 'hi@acme.test', services: ['Drain Cleaning', 'Water Heaters'], keywords: KEYWORDS(),
  usp: 'Licensed plumbers, same-day service', brandDescription: 'Family-run drain company', hours: 'Mon–Fri 8–6',
  reviews: [{ author: 'Sam', rating: 5, text: 'They came the same day. Great!' }], language: 'en',
  siteUrl: 'https://seo1549t.preview.test', // #1547 之后 create-site 要它；之前的版本忽略这个键
  // 首页开场配方（#1034）按 siteId 每站不同、不合就多要一次 Call 1b —— 跟本票那一维无关，关掉免得夹具去追配方
  homepageFingerprint: false,
  ...extra,
});

function run(label, scenario, payload) {
  fs.rmSync(path.join(WORK, 'site'), { recursive: true, force: true });
  const scen = path.join(ROOT, `${label}.json`);
  const log = path.join(ROOT, `${label}.prompts`);
  fs.writeFileSync(scen, JSON.stringify(scenario));
  fs.writeFileSync(log, '');
  const r = cp.spawnSync(process.execPath, ['--require', STUB, path.join(WORK, 'scripts', 'create-site.js')], {
    input: JSON.stringify(payload), cwd: WORK, encoding: 'utf8', timeout: 240000,
    env: { ...process.env, ANTHROPIC_API_KEY: 'test-not-real', SEO_STUB: scen, SEO_STUB_LOG: log },
  });
  const events = (r.stdout || '').split('\n').filter(Boolean).map((l) => { try { return JSON.parse(l); } catch (e) { return null; } }).filter(Boolean);
  const prompts = fs.readFileSync(log, 'utf-8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
  return { rc: r.status, stderr: r.stderr || '', events, prompts, site: path.join(WORK, 'site') };
}
const seoLines = (stderr) => stderr.split('\n').filter((l) => l.startsWith('[seo]'));
const errorOf = (res) => (res.events.find((e) => e.event === 'error') || {}).message || '';

console.log('\n── A 成功的双语站：每页都查了、about 重写一次修好、一个关键词页丢掉');
const A = run('A', {
  call1: call1({ aboutBody: 'Serving Markham since 2015, we grew by word of mouth.' }),
  call2: call2(),
  rewrites: {
    about: { page: call1().pages.find((p) => p.slug === 'about') }, // 去掉编出来的年份
    [KW_SLUGS[2]]: 'echo', // 原样回来 ⟹ 仍不合格 ⟹ 丢掉
  },
}, PAYLOAD({ secondaryLocales: ['zh'] }));
{
  check(A.rc === 0, `建站成功（rc=${A.rc}）`, `${errorOf(A)}\n${A.stderr.slice(-1500)}`);
  const lines = seoLines(A.stderr);
  const checked = lines.filter((l) => l.startsWith('[seo] 检查 ')).map((l) => l.split(' ')[2]);
  const primaryPages = ['home', 'about', 'quote', 'services/drain-cleaning', ...KW_SLUGS];
  check(checked.length === primaryPages.length && primaryPages.every((s) => checked.includes(s)),
    `主语言每页各一行「[seo] 检查」：${checked.length} 行 = 主语言 ${primaryPages.length} 页`, checked.join(' '));
  const aboutLine = lines.find((l) => l.startsWith('[seo] 检查 about ')) || '';
  check(/目标词 （无） · 跑了第 1\/2\/3\/5\/6\/8 条/.test(aboutLine), '没有目标词的页（about）只跑 1/2/3/5/6/8', aboutLine);
  const homeLine = lines.find((l) => l.startsWith('[seo] 检查 home ')) || '';
  check(/目标词 「drain cleaning」 · 跑了第 1\/2\/3\/4\/5\/6\/7\/8 条 · 0 条问题/.test(homeLine), '首页按站的主词跑八条、0 条问题', homeLine);
  check(A.stderr.includes('[8 事实出处] 编造的事实：「2015」'), '第 8 条在 about 上报了「编造的事实：2015」');
  check(lines.some((l) => /^\[seo\] 重写一次后 about · .* · 0 条问题$/.test(l)), 'about 重写一次之后 0 条问题', lines.filter((l) => l.includes('about')).join(' | '));
  const aboutJson = JSON.parse(fs.readFileSync(path.join(A.site, 'en', 'pages', 'about.json'), 'utf-8'));
  check(!JSON.stringify(aboutJson).includes('2015'), '站里写的是重写之后那份 about（没有 2015）');
  check(lines.some((l) => l.startsWith(`[seo] 丢掉 ${KW_SLUGS[2]}：`) && l.includes('[1 title]')), `日志「丢掉 ${KW_SLUGS[2]}：…」带着问题`);
  check(lines.some((l) => l.startsWith('[seo] 关键词页 2/3') && l.includes('「tankless water heater」')), '日志「关键词页 2/3」且 2 < 3，列出没成的词', lines.filter((l) => l.includes('关键词页')).join(' | '));
  const pagesDir = path.join(A.site, 'en', 'pages');
  const flat = (d) => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? flat(path.join(d, e.name)).map((x) => `${e.name}/${x}`) : [e.name]));
  const files = flat(pagesDir);
  check(!files.includes(`${KW_SLUGS[2]}.json`) && files.includes(`${KW_SLUGS[0]}.json`), '丢掉的那页不在站里，另外两页在', files.join(' '));
  const nav = fs.readFileSync(path.join(A.site, 'en', 'navigation.json'), 'utf-8');
  check(!nav.includes(KW_SLUGS[2]) && nav.includes(KW_SLUGS[0]), '页脚里没有指向丢掉那页的链接，别的关键词页还在');
  const ev = A.events.find((e) => e.event === 'seo-check') || {};
  check(ev.keywordPages && ev.keywordPages.ok === 2 && ev.keywordPages.total === 3 && ev.dropped.length === 1 && ev.rewritten === 2,
    '`seo-check` 事件：关键词页 2/3 · 丢 1 · 重写过 2 页（about 修好了、那页关键词页没修好）', JSON.stringify(ev));
  // 双语：次语言的页不进 seo 检查
  check(fs.existsSync(path.join(A.site, 'zh', 'pages', 'about.json')), '次语言 zh 的页生成了');
  check(!lines.some((l) => /\bzh\b|\/zh\//.test(l)) && checked.length === primaryPages.length, '次语言的页不出现在任何 [seo] 行里（检查行数 = 主语言页数）');
  // 提示词里的 title 预算
  const c1 = A.prompts.find((p) => p.includes('Generate a JSON object with this EXACT structure')) || '';
  const c2s = A.prompts.filter((p) => p.includes('Write ONE keyword landing page'));
  const spec = `max 46 chars; " | ${BRAND}" is appended automatically`;
  check(c1.includes(`"title": "<Page Title, ${spec}`) && c1.includes(`Page titles (pages[].title): ${spec}`), `Call 1 提示词：子页 title 预算 46（60 − 3 − ${BRAND.length}），不是 60`);
  check(!c1.includes('All meta titles under 60') && !c1.includes('| <Company>'), 'Call 1 提示词：那句「All meta titles under 60」和 `| <Company>` 都没了');
  check(c2s.length === 3 && c2s.every((c2) => c2.includes(`"title": "<Page Title with the keyword, ${spec}`)), `Call 2（一页一次，${c2s.length} 通）提示词：同一个预算`);
  const rw = A.prompts.find((p) => p.includes('An automatic SEO check found the problems') && p.includes('"slug": "about"')) || '';
  check(rw.includes('[8 事实出处]') && rw.includes(`page.title: ${spec}`), '重写提示词带着问题清单和同一个预算');
}

console.log('\n── A\' 反向对照：about 的重写不修 ⟹ 建站失败');
if (!ONLY) {
  const R = run('A2', { call1: call1({ aboutBody: 'Serving Markham since 2015, we grew by word of mouth.' }), call2: call2(), rewrites: { about: 'echo', [KW_SLUGS[2]]: 'echo' } }, PAYLOAD());
  check(R.rc !== 0 && errorOf(R).includes('about') && errorOf(R).includes('[8 事实出处]'), `建站失败，信息写明 about 与第 8 条（rc=${R.rc}）`, errorOf(R).slice(0, 400));
}

console.log('\n── B about 两次都出两个 H1 ⟹ 建站失败，不是丢掉 about');
if (!ONLY) {
  const B = run('B', { call1: call1({ aboutTwoH1: true }), call2: call2(), rewrites: { about: 'echo', [KW_SLUGS[2]]: 'echo' } }, PAYLOAD());
  const msg = errorOf(B);
  check(B.rc !== 0, `建站失败（rc=${B.rc}）`);
  check(msg.includes('about') && msg.includes('[3 H1] 要恰好一个 H1'), '失败信息写明 about 页和「恰好一个 H1」那一条', msg.slice(0, 400));
  check(!seoLines(B.stderr).some((l) => l.startsWith('[seo] 丢掉 about')), 'about 没被丢掉（没有目标词的页走「建站失败」那一支）');
}

console.log('\n── C 首页的目标词换成不可能出现的词 ⟹ 重写一次、仍不合格、建站失败');
if (!ONLY) {
  const C = run('C', { call1: call1(), call2: call2(), rewrites: { home: 'echo', [KW_SLUGS[2]]: 'echo' } },
    PAYLOAD({ keywords: { ...KEYWORDS('zzqx flurbington'), 'Drain Cleaning': KEYWORDS('zzqx flurbington')['Drain Cleaning'].map((k) => (k.isPrimary ? { ...k, goldIndex: 99 } : k)) } }));
  const lines = seoLines(C.stderr);
  check(lines.some((l) => l.startsWith('[seo] 检查 home · 目标词 「zzqx flurbington」')), '首页的目标词是那个不可能的词', lines.find((l) => l.includes(' home ')));
  check(C.prompts.some((p) => p.includes('An automatic SEO check found the problems') && p.includes('"slug": "home"')), '首页被带着问题重写了一次（发出去了重写提示词）');
  check(lines.some((l) => l.startsWith('[seo] 重写一次后 home ')), '日志里有首页「重写一次后」那一行');
  const msg = errorOf(C);
  check(C.rc !== 0 && msg.includes('home:') && msg.includes('[1 title]'), `建站失败，信息写明 home 和哪条（rc=${C.rc}）`, msg.slice(0, 400));
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
