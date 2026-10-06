#!/usr/bin/env node
// #1633 —— 非英文主语言的站：代码自己写的那几处字（自动补的联系页、导航的首页、页脚第一栏标题）按主语言写；
// 联系页 description 不再是 `Get in touch with [object Object]`；代码补的联系页也过 SEO 检查。
//
// 真 create-site.js 进程，只把 `@anthropic-ai/sdk` 换成按提示词回放的桩（同 create-site-all-locales.test.js）；`fetch` 一律离线。
// 🔴 不是 skipAI：skipAI 在站级那一通之前就 return，量不到这里的任何一格。🔴 不调真 AI（#1499）。
//
// 格子名对应正文验收：
//   AC1 主语言 zh、站级那一通给了主语言字   contact.json 的 title / navLabel / description / 页头 / 表单文字 = 桩给的中文；
//                                          navigation.json 的首页链接与页脚第一栏标题 = 桩给的中文；提示词里要了这三个键
//   AC2 没有 [object Object]                AC1 那一跑 + 桩不给那几处字（退回英文）那一跑，全站落盘 JSON 命中 0；
//                                          退回英文那一跑 contact 的 description 含主语言品牌名
//   AC3 联系页进了 SEO 检查                 build-report.json 的 seo.pages 有 contact；日志有 `[seo] 检查 contact`
//   AC4 英文站                              提示词里不出现 contactPage / homeLabel / quickLinksTitle；导航 Home / Quick Links；
//                                          contact 页是今天的英文常量，description 是品牌名（修补改写的字逐字来自桩的修补回包）
//   （AC4 的「跟今天的 main 比落盘」是一次性对照，读数在交付留言里；本文件守的是交付之后那一半）
'use strict';

const assert = require('assert');
const cp = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const NEXT = path.resolve(__dirname, '..');
const TEMP = [];
process.on('exit', () => {
  if (process.env.P1633_KEEP === '1') { if (TEMP.length) console.log(`📌 P1633_KEEP=1 ⟹ 留着 ${TEMP.join(' ')}`); return; }
  for (const d of TEMP) { try { fs.rmSync(d, { recursive: true, force: true }); } catch (e) { /* 打扫不成不改结论 */ } }
});
function die(msg) { console.log(`💥 ${msg}`); process.exit(2); }
for (const m of ['@anthropic-ai/sdk', 'jsonrepair']) try { require.resolve(m, { paths: [NEXT] }); } catch (e) { die(`templates/nextjs 的 node_modules 不完整（${e.message}）——这不是测试结论`); }

let pass = 0;
let fail = 0;
function check(name, fn) {
  try { fn(); pass += 1; console.log(`  ✅ ${name}`); } catch (e) { fail += 1; console.log(`  ❌ ${name}\n     ${e.message}`); }
}

// ── 桩（序列化进 --require 的文件）──
function stubMain() {
'use strict';
const Module = require('module');
const fs = require('fs');
const cfg = JSON.parse(fs.readFileSync(process.env.P_CFG, 'utf8'));
globalThis.fetch = async () => { throw new Error('offline (test stub)'); };
const CJK = /[一-鿿]/;
function answer(req) {
  const first = req.messages[0].content;
  const kind = first.includes('Generate a JSON object with this EXACT structure') ? 'site'
    : first.includes('Write the sections of ONE page') ? 'page'
      : first.includes('An automatic SEO check found the problems') ? 'seo-fix' : 'other';
  const slug = kind === 'page' ? (first.match(/- slug: "([^"]+)"/) || [])[1] : kind === 'seo-fix' ? (first.match(/^PAGE: (.+)$/m) || [])[1] : null;
  const m = kind === 'seo-fix' ? first.match(/TEXTS TO FIX:\n(\{[\s\S]*?\n\})\n\nPROBLEMS TO FIX/) : null;
  const fields = m ? JSON.parse(m[1]) : null;
  fs.appendFileSync(process.env.P_CALLS, JSON.stringify({ kind, slug, first, fields }) + '\n');
  if (kind === 'site') return cfg.site;
  if (kind === 'page') return { sections: cfg.replies[slug] };
  if (kind === 'seo-fix') {
    if (!fields) throw new Error('修补提示词里没有 TEXTS TO FIX');
    const out = { ...fields };
    const fix = (cfg.fix || {})[slug] || {};
    for (const k of Object.keys(out)) if (typeof fix[k] === 'string') out[k] = fix[k];
    fs.appendFileSync(process.env.P_CALLS, JSON.stringify({ kind: 'seo-fix-reply', slug, out }) + '\n');
    return { fields: out };
  }
  throw new Error('桩不认识这一通调用：' + first.slice(0, 120) + (CJK.test(first) ? '' : ''));
}
class FakeAnthropic {
  constructor() {
    this.messages = {
      stream: (req) => ({
        finalMessage: async () => ({ content: [{ type: 'text', text: JSON.stringify(answer(req)) }], usage: { input_tokens: 0, output_tokens: 0 }, stop_reason: 'end_turn' }),
      }),
    };
  }
}
FakeAnthropic.default = FakeAnthropic;
FakeAnthropic.Anthropic = FakeAnthropic;
const orig = Module._load;
Module._load = function (request) {
  if (request === '@anthropic-ai/sdk') return FakeAnthropic;
  return orig.apply(this, arguments);
};}
const STUB = `(${stubMain.toString()})();\n`;

function makeTree(label) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), `p1633-${label}-`));
  TEMP.push(root);
  const work = path.join(root, 'nextjs');
  cp.execSync(`tar --exclude=./node_modules --exclude=./out --exclude=./.next --exclude=./site --exclude=./public/photos -cf - . | (mkdir -p "${work}" && tar -xf - -C "${work}")`, { cwd: NEXT, stdio: 'pipe' });
  fs.symlinkSync(path.join(NEXT, 'node_modules'), path.join(work, 'node_modules'));
  return work;
}

// ── 夹具：美发站，单一语言（没有第二语言）。页面都按 SEO 八条写合格，联系页由代码补 ──
const BRAND = 'Silky Hair Salon';
const T = {
  zh: {
    home: '首页', about: '关于我们', quote: '预约', svc: '剪发', svcName: '剪发',
    desc: (t) => `${t}就在多伦多：${BRAND} 为每一位顾客提供细致贴心的服务，预约简单，环境舒适安心，欢迎随时到店体验。`,
    body: (t) => `${t}：我们在多伦多为每一位顾客提供细致的护理与造型服务，预约简单，到店即享专业建议，环境舒适安心。`,
    faq: ['常见问题', '需要预约吗？', '建议提前预约，也欢迎直接到店。'], cta: ['现在预约', '告诉我们您想要的造型。', '预约'], how: '怎么做', ours: '我们的服务',
  },
  en: {
    home: 'Home', about: 'About us', quote: 'Book', svc: 'haircut', svcName: 'Haircut',
    desc: (t) => `${t} in Toronto: ${BRAND} gives every guest careful, friendly service, easy booking and a calm, comfortable place to relax.`,
    body: (t) => `${t}: we give every guest in Toronto careful care and styling, easy booking, expert advice and a calm place to relax.`,
    faq: ['Questions', 'Do I need to book?', 'Booking ahead is best, walk-ins are welcome.'], cta: ['Book now', 'Tell us the look you want.', 'Book'], how: 'How we do it', ours: 'Our services',
  },
};
// 这一页的目标词：首页与服务页是「剪发 / haircut」，其余没有
function fixture(lang, { words = null } = {}) {
  const L = T[lang];
  const sep = lang === 'zh' ? '：' : ': ';
  const pages = [['home', L.home, L.svc], ['about', L.about, ''], ['quote', L.quote, ''], ['services/cut', L.svcName, L.svc]];
  const sectionsOf = (slug, t, k) => {
    const h = (s) => (k ? `${k}${sep}${s}` : s);
    const tail = [
      { type: 'faq', data: { headline: h(L.faq[0]), items: [{ question: L.faq[1], answer: L.faq[2] }] } },
      { type: 'cta', data: { headline: L.cta[0], body: L.cta[1], ctas: [{ label: L.cta[2], href: '/quote', style: 'solid' }] } },
    ];
    if (slug === 'home') {
      return [{ type: 'hero', data: { headline: k, subheadline: L.body(k), ctas: [{ label: L.cta[2], href: '/quote', style: 'solid' }] } },
        { type: 'features', data: { headline: h(L.ours), body: L.body(k), items: { source: 'services' } } }, ...tail];
    }
    return [{ type: 'page-header', data: { headline: k || t } }, { type: 'content', data: { headline: h(L.how), body: L.body(k || t) } }, ...tail];
  };
  const site = {
    colorScheme: 'light',
    brand: { tagline: lang === 'zh' ? '让头发如丝般顺滑' : 'Silky-smooth hair', logoIcon: 'scissors', email: 'hi@silky.test', locations: [{ label: 'Salon', address: 'Toronto, ON', phone: '(416) 555-0199' }] },
    navigation: { ctaLabel: L.cta[0], ctaPage: 'quote', footerDescription: lang === 'zh' ? '多伦多的美发沙龙。' : 'A hair salon in Toronto.' },
    seo: { siteTitle: `${L.svc} | ${BRAND}`, siteDescription: L.desc(L.svc), areaServed: [{ type: 'City', name: 'Toronto' }], addresses: [], priceRange: '$$', offerCatalogName: L.ours },
    services: [{ id: 'cut', name: L.svcName, shortDescription: L.svcName, fullDescription: `${L.svcName}, Toronto.`, icon: 'scissors', features: ['x'], products: [] }],
    forms: [{ id: 'quote', name: L.quote, buttonText: 'OK', successMessage: 'Thanks' }, { id: 'contact', name: 'Contact', buttonText: 'OK', successMessage: 'Thanks' }],
    pages: pages.map(([slug, t, k], i) => ({
      slug, title: k ? `${k} | ${t}` : t, description: L.desc(k || t), navLabel: t, navOrder: slug.startsWith('services/') ? 10 : i,
      changeFrequency: 'monthly', priority: 0.8, brief: `${t}.`,
      ...(slug.startsWith('services/') ? { serviceDetailPage: true, parentService: 'cut' } : {}),
    })),
    ...(words || {}),
  };
  const replies = Object.fromEntries(pages.map(([slug, t, k]) => [slug, sectionsOf(slug, t, k)]));
  return { site, replies };
}
const ZH_WORDS = {
  homeLabel: '首页', quickLinksTitle: '快速链接',
  contactPage: {
    title: '联系我们', navLabel: '联系', description: `欢迎联系 ${BRAND}：在多伦多为您提供剪发、染发与造型服务，留下电话或邮件，我们会尽快回复您的预约与问题。`,
    headline: '联系我们', subheadline: '给我们留言，我们会尽快回复。', formHeadline: '与我们取得联系', formBody: '留下您的联系方式，我们会尽快联系您。',
  },
};
const PAYLOAD = (lang) => ({
  siteId: `p1633${lang}`, siteUrl: 'https://silky.test', companyName: BRAND, industry: 'hair salon', location: 'Toronto, ON',
  ...(lang === 'zh' ? { locationLocalized: '多伦多, 安大略省, 加拿大' } : {}),
  language: lang, services: [T[lang].svcName], homepageFingerprint: false,
  refSite: 'https://reference.test', refPrefs: ['structure'], refAnalysis: { navLinks: ['Home', 'About', 'Quote'] },
  keywords: { [T[lang].svcName]: [{ keyword: T[lang].svc, isPrimary: true, selected: true, goldIndex: 50, volume: 900 }] },
});

function run(label, lang, cfg) {
  const work = makeTree(label);
  const dir = path.dirname(work);
  const stub = path.join(dir, 'stub.js');
  const cfgFile = path.join(dir, 'cfg.json');
  const calls = path.join(dir, 'calls.jsonl');
  fs.writeFileSync(stub, STUB);
  fs.writeFileSync(cfgFile, JSON.stringify(cfg));
  fs.writeFileSync(calls, '');
  const r = cp.spawnSync(process.execPath, ['--require', stub, path.join(work, 'scripts', 'create-site.js')], {
    input: JSON.stringify(PAYLOAD(lang)), cwd: work, encoding: 'utf8', maxBuffer: 64 << 20, timeout: 300000,
    env: { ...process.env, ANTHROPIC_API_KEY: 'stub-not-used', P_CFG: cfgFile, P_CALLS: calls },
  });
  if (r.error) die(`${label}：进程没跑起来 ${r.error.message}`);
  const events = (r.stdout || '').split('\n').filter(Boolean).map((l) => { try { return JSON.parse(l); } catch (e) { return {}; } });
  const site = path.join(work, 'site');
  const read = (rel) => { const f = path.join(site, rel); return fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, 'utf8')) : null; };
  const allJson = [];
  (function walk(d) {
    if (!fs.existsSync(d)) return;
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const f = path.join(d, e.name);
      if (e.isDirectory()) walk(f); else if (e.name.endsWith('.json')) allJson.push(f);
    }
  }(site));
  return {
    rc: r.status, stderr: r.stderr || '', error: (events.find((e) => e.event === 'error') || {}).message || '', site, read, allJson,
    calls: fs.readFileSync(calls, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)),
  };
}
const blocksOf = (pg) => (pg && (pg.blocks || pg.sections)) || [];
const objectObjectHits = (R) => R.allJson.filter((f) => fs.readFileSync(f, 'utf8').includes('[object Object]')).map((f) => path.relative(R.site, f));

console.log('══ #1633 主语言的「代码自己写的字」· 联系页 description · 联系页过 SEO 检查（打桩）══');

// ── AC1 / AC2 / AC3：主语言 zh，站级那一通给了主语言字 ──
console.log('── AC1：主语言 zh，站级那一通给了 homeLabel / quickLinksTitle / contactPage');
const A = run('zh-words', 'zh', fixture('zh', { words: ZH_WORDS }));
check('建站成功', () => { assert.strictEqual(A.error, ''); assert.strictEqual(A.rc, 0, A.stderr.slice(-1500)); });
check('站级那一通的提示词向主语言要了这三个键（放在回包顶层）', () => {
  const p = (A.calls.find((c) => c.kind === 'site') || {}).first || '';
  for (const k of ['"homeLabel"', '"quickLinksTitle"', '"contactPage"']) assert.ok(p.includes(k), `提示词里没有 ${k}`);
  assert.ok(!p.includes('"locales"'), '单语言站的提示词不该出现 locales');
});
const cA = A.read('zh/pages/contact.json');
check('zh/pages/contact.json：title / navLabel / description 是桩给的中文', () => {
  assert.ok(cA, 'zh/pages/contact.json 不存在');
  assert.strictEqual(cA.title, ZH_WORDS.contactPage.title);
  assert.strictEqual(cA.navLabel, ZH_WORDS.contactPage.navLabel);
  assert.strictEqual(cA.description, ZH_WORDS.contactPage.description);
});
check('zh/pages/contact.json：页头与表单文字是桩给的中文', () => {
  const ph = blocksOf(cA).find((b) => b.type === 'page-header');
  const ct = blocksOf(cA).find((b) => b.type === 'contact');
  assert.strictEqual(ph.data.headline, ZH_WORDS.contactPage.headline);
  assert.strictEqual(ph.data.subheadline, ZH_WORDS.contactPage.subheadline);
  assert.strictEqual(ct.data.headline, ZH_WORDS.contactPage.formHeadline);
  assert.strictEqual(ct.data.body, ZH_WORDS.contactPage.formBody);
  assert.deepStrictEqual(ct.data.form, { id: 'contact' }, '表单还是站级表单库的 contact 那张');
});
const navA = A.read('zh/navigation.json');
check('zh/navigation.json：顶栏 / 页脚的首页链接与页脚第一栏标题是桩给的中文', () => {
  assert.strictEqual(navA.header.links[0].href, '/');
  assert.strictEqual(navA.header.links[0].label, ZH_WORDS.homeLabel);
  assert.strictEqual(navA.footer.columns[0].title, ZH_WORDS.quickLinksTitle);
  assert.strictEqual(navA.footer.columns[0].links[0].label, ZH_WORDS.homeLabel);
  assert.ok(!JSON.stringify(navA).includes('"Home"') && !JSON.stringify(navA).includes('Quick Links'));
});
check('AC2：这一跑全站落盘 JSON 里 [object Object] 命中 0', () => assert.deepStrictEqual(objectObjectHits(A), []));
const report = A.read('build-report.json');
check('AC3：build-report.json 的 seo.pages 有 contact 一行', () => {
  const row = ((report && report.seo && report.seo.pages) || []).find((p) => p.slug === 'contact');
  assert.ok(row, `seo.pages 里没有 contact：${JSON.stringify(((report || {}).seo || {}).pages || []).slice(0, 300)}`);
});
check('AC3：日志里有 `[seo] 检查 contact` 一行，而且只有一行（没被主 seoPass 提前查过）', () => {
  const n = A.stderr.split('\n').filter((l) => l.startsWith('[seo] 检查 contact ')).length;
  assert.strictEqual(n, 1, A.stderr.split('\n').filter((l) => l.startsWith('[seo] 检查')).join('\n'));
});

// ── AC2：主语言 zh，站级那一通【不】给那几处字 ⟹ 退回英文，但品牌名对 ──
console.log('── AC2：主语言 zh，站级那一通没给那几处字（联系页退回字表 zh 那一行 #1631，导航仍是英文常量）');
const B = run('zh-nowords', 'zh', fixture('zh'));
check('建站成功', () => { assert.strictEqual(B.error, ''); assert.strictEqual(B.rc, 0, B.stderr.slice(-1500)); });
check('全站落盘 JSON 里 [object Object] 命中 0', () => assert.deepStrictEqual(objectObjectHits(B), []));
const cB = B.read('zh/pages/contact.json');
// #1631 —— 这一跑原来退回英文常量；#1631 把「AI 没给」的落点换成字表里主语言那一行（`lib/locale-words.js`）⟹ 中文。
//    逐字比字表那一行（不在这里抄一份中文），品牌名照旧要在 description 里。
check('没给字那一跑：contact 的 title / navLabel 是字表里 zh 那一行（#1631；不再是英文常量），description 含主语言品牌名', () => {
  const zhRow = require(path.join(NEXT, 'scripts', 'lib', 'locale-words.js')).contactPageWords('zh', BRAND);
  assert.strictEqual(cB.title, zhRow.title);
  assert.strictEqual(cB.navLabel, zhRow.navLabel);
  assert.notStrictEqual(cB.title, 'Contact Us');
  assert.ok(cB.description.includes(BRAND), cB.description);
});
check('退回英文那一跑：导航是今天的英文常量', () => {
  const nav = B.read('zh/navigation.json');
  assert.strictEqual(nav.header.links[0].label, 'Home');
  assert.strictEqual(nav.footer.columns[0].title, 'Quick Links');
});

// ── AC4：主语言 en，没有第二语言 ──
console.log('── AC4：主语言 en、没有第二语言 —— 不走新路');
const EN_FIX = `Contact ${BRAND} in Toronto for haircuts, colour and styling — call, email or send a message and we will reply soon.`;
const C = run('en', 'en', { ...fixture('en'), fix: { contact: { description: EN_FIX } } });
check('建站成功', () => { assert.strictEqual(C.error, ''); assert.strictEqual(C.rc, 0, C.stderr.slice(-1500)); });
check('站级那一通的提示词里不出现 contactPage / homeLabel / quickLinksTitle', () => {
  const p = (C.calls.find((c) => c.kind === 'site') || {}).first || '';
  assert.ok(p.length > 0);
  for (const k of ['contactPage', 'homeLabel', 'quickLinksTitle']) assert.ok(!p.includes(k), `英文站提示词里出现了 ${k}`);
});
check('导航：Home / Quick Links 不变', () => {
  const nav = C.read('en/navigation.json');
  assert.strictEqual(nav.header.links[0].label, 'Home');
  assert.strictEqual(nav.footer.columns[0].title, 'Quick Links');
  assert.strictEqual(nav.footer.columns[0].links[0].label, 'Home');
});
const cC = C.read('en/pages/contact.json');
check('contact 页：title / navLabel / 页头 / 表单文字是今天的英文常量', () => {
  assert.strictEqual(cC.title, 'Contact Us');
  assert.strictEqual(cC.navLabel, 'Contact');
  const ph = blocksOf(cC).find((b) => b.type === 'page-header');
  const ct = blocksOf(cC).find((b) => b.type === 'contact');
  assert.strictEqual(ph.data.headline, 'Contact Us');
  assert.strictEqual(ph.data.subheadline, "Send us a message and we'll get back to you shortly.");
  assert.strictEqual(ct.data.headline, 'Get in touch');
  assert.strictEqual(ct.data.body, 'Leave your details and we will reach out soon.');
});
check('contact 页 description：品牌名对；若被 SEO 修补改写，新字逐字来自桩的修补回包', () => {
  const row = ((C.read('build-report.json') || {}).seo || { pages: [] }).pages.find((p) => p.slug === 'contact');
  assert.ok(row, 'seo.pages 没有 contact');
  if (row.rewritten) {
    const replies = C.calls.filter((c) => c.kind === 'seo-fix-reply' && c.slug === 'contact').map((c) => c.out.description);
    assert.ok(replies.includes(cC.description), `description「${cC.description}」不在修补回包里：${JSON.stringify(replies)}`);
  } else {
    assert.strictEqual(cC.description, `Get in touch with ${BRAND}`);
  }
});
check('全站落盘 JSON 里 [object Object] 命中 0', () => assert.deepStrictEqual(objectObjectHits(C), []));

console.log(`\n${fail ? '❌' : '✅'} #1633：${pass} 通过 · ${fail} 失败`);
process.exit(fail ? 1 : 0);
