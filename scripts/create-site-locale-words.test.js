#!/usr/bin/env node
// #1631 —— 非英文主语言的站：代码兜底写的字（配方联系页的标题 / 导航名、默认表单文案、代码补的联系页）按主语言写。
//
// 真 create-site.js 进程，只把 `@anthropic-ai/sdk` 换成按提示词回放的桩（同 create-site-call1-pages.test.js /
// create-site-primary-locale-words.test.js）；`fetch` 一律离线。🔴 不是 skipAI（skipAI 走不到这几处，见正文「不做」）。🔴 不调真 AI（#1499）。
//
// 格子对应正文验收：
//   C+B   普通配方路径，zh：站级回包里 contact 页不带 title / navLabel、整份回包不带 forms
//         ⟹ contact.json 的 title / navLabel、forms.json 两张表的 name / buttonText / successMessage = 字表 zh 那一行
//   D     参考站照抄结构（refPrefs: ['structure']）+ 不含 Contact 的 navLinks，桩不给 contactPage
//         ⟹ 代码补出的 contact.json 7 句 = 字表 zh 那一行，description 含中文品牌名，没有英文那几句、没有 [object Object]
//   D'    同一个夹具，桩给 contactPage 的 title 与 headline、其余五句不给 ⟹ 那两句是 AI 的，五句是字表
//   fr/nl 同一个 D 夹具：fr ⟹ 法语那一行；nl（字表里没有）⟹ 英文，进程正常结束
//   F2    第二语言的表单（做什么 4）：zh 主 + en 第二、AI 不给 locales.en.forms（主语言 forms 也不给）
//         ⟹ en/forms.json 三句 = 字表 en、zh/forms.json = 字表 zh、两份 id / fields / primary 逐张相同；
//         第二语言换 fr ⟹ 字表 fr；换 nl ⟹ 英文；AI 给了 locales.en.forms ⟹ 用 AI 的
//   F2-skipAI  同一件事走 skipAI 示例站那条路（第二语言内容是就地手搓的那一处）⟹ en/forms.json = 字表 en
//   记录  zh 主语言 + en 第二语言：/en/contact 现在是什么样（只打印，不断言 —— 正文最后一条）
// 「把 C / B / D 改回英文这一格红」是一次性对照，读数在交付留言里。
'use strict';

const assert = require('assert');
const cp = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const NEXT = path.resolve(__dirname, '..');
const TEMP = [];
process.on('exit', () => {
  if (process.env.LW_KEEP === '1') { if (TEMP.length) console.log(`📌 LW_KEEP=1 ⟹ 留着 ${TEMP.join(' ')}`); return; }
  for (const d of TEMP) { try { fs.rmSync(d, { recursive: true, force: true }); } catch (e) { /* 打扫不成不改结论 */ } }
});
function die(msg) { console.log(`💥 ${msg}`); process.exit(2); }
for (const m of ['@anthropic-ai/sdk', 'jsonrepair']) try { require.resolve(m, { paths: [NEXT] }); } catch (e) { die(`templates/nextjs 的 node_modules 不完整（${e.message}）——这不是测试结论`); }

const W = require(path.join(NEXT, 'scripts', 'lib', 'locale-words.js'));

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
const cfg = JSON.parse(fs.readFileSync(process.env.LW_CFG, 'utf8'));
globalThis.fetch = async () => { throw new Error('offline (test stub)'); };
const BODY = '我们为每一位顾客提供细致的护理与造型服务，预约简单，到店即享专业建议，环境舒适安心，欢迎随时来店体验我们团队带来的放松时光。';
// 配方页的块序写在提示词里（`write exactly these N, in this order: …`）：桩照它回，每种块一份过得了块库的 data。
const BLOCK = {
  'page-header': (title) => ({ type: 'page-header', data: { headline: title } }),
  content: (title) => ({ type: 'content', data: { headline: `关于${title}`, body: BODY } }),
  features: (title, prompt) => ({ type: 'features', data: /"features": write "items": \{"source": "services"\}/.test(prompt)
    ? { headline: '我们的服务', items: { source: 'services' } }
    : { headline: `${title}的亮点`, items: [1, 2, 3].map((n) => ({ title: `亮点${n}`, text: '每一步都由资深发型师完成。' })) } }),
  faq: () => ({ type: 'faq', data: { headline: '常见问题', items: [{ question: '需要预约吗？', answer: '建议提前预约，也欢迎直接到店。' }] } }),
  cta: () => ({ type: 'cta', data: { headline: '现在预约', body: '告诉我们您想要的造型。', ctas: [{ label: '预约', href: '/contact', style: 'solid' }] } }),
  // 配方的 contact 页由 AI 写块（AI 写的字，不是本票的事）；这里给一份中性的，只为过块库。
  contact: () => ({ type: 'contact', data: { headline: 'AI-HEAD', body: 'AI-BODY', form: { id: 'contact' }, options: { form: 'full' } } }),
};
function sectionsFor(slug, title, prompt) {
  const fixed = (prompt.match(/write exactly these \d+, in this order: ([^\n]+?)\. Do not add/) || [])[1];
  if (fixed) return fixed.split(' → ').map((t) => BLOCK[JSON.parse(t)](title, prompt));
  const tail = [BLOCK.faq(), { type: 'cta', data: { headline: '现在预约', body: '告诉我们您想要的造型。', ctas: [{ label: '预约', href: '/quote', style: 'solid' }] } }];
  if (slug === 'home') {
    return [{ type: 'hero', data: { headline: title, subheadline: BODY, ctas: [{ label: '预约', href: '/quote', style: 'solid' }] } },
      { type: 'features', data: { headline: '我们的服务', body: BODY, items: { source: 'services' } } }, ...tail];
  }
  return [BLOCK['page-header'](title), BLOCK.content(title), ...tail];
}
function answer(req) {
  const first = req.messages[0].content;
  const kind = first.includes('Generate a JSON object with this EXACT structure') ? 'site'
    : first.includes('Write the sections of ONE page') ? 'page'
      : first.includes('An automatic SEO check found the problems') ? 'seo-fix' : 'other';
  fs.appendFileSync(process.env.LW_CALLS, JSON.stringify({ kind, head: first.slice(0, 200) }) + '\n');
  if (kind === 'site') return cfg.plan;
  if (kind === 'page') {
    const slug = (first.match(/- slug: "([^"]+)"/) || [])[1];
    const title = (first.match(/\n- title: ([^\n]+)/) || [])[1] || slug;
    const sections = sectionsFor(slug, title, first);
    if (!cfg.bilingual) return { sections };
    // 第二语言（默认 en）：每页一次调用里一起回（#1593 的形状）。字是假的英文，只为让第二语言那份落盘。
    return { zh: { sections }, [cfg.second || 'en']: { title: `EN ${slug}`, navLabel: `EN ${slug}`, ...(['home', 'services/cut'].includes(slug) ? { targetKeyword: 'haircut' } : {}),
      description: `EN ${slug}: Silky Hair Salon gives every guest in Toronto careful styling, easy booking and expert advice in a calm place.`, sections } };
  }
  if (kind === 'seo-fix') {
    // 字段级修补：原样退回（本票只看兜底的字，不让修补改写它们）。
    const fields = JSON.parse((first.match(/TEXTS TO FIX:\n(\{[\s\S]*?\n\})\n\nPROBLEMS TO FIX/) || [])[1] || '{}');
    return { fields };
  }
  throw new Error('桩不认识这一通调用：' + first.slice(0, 120));
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
  const root = fs.mkdtempSync(path.join(os.tmpdir(), `lw1631-${label}-`));
  TEMP.push(root);
  const work = path.join(root, 'nextjs');
  cp.execSync(`tar --exclude=./node_modules --exclude=./out --exclude=./.next --exclude=./site --exclude=./public/photos -cf - . | (mkdir -p "${work}" && tar -xf - -C "${work}")`, { cwd: NEXT, stdio: 'pipe' });
  fs.symlinkSync(path.join(NEXT, 'node_modules'), path.join(work, 'node_modules'));
  return work;
}

// ── 夹具：美发站，一个服务 ──
const BRAND = 'Silky Hair Salon';
const BRAND_ZH = '丝滑美发';
const DESC = (t) => `${t}：${BRAND} 为每一位顾客提供细致的护理与造型服务，预约简单，到店即享专业建议，环境舒适安心，欢迎随时来店体验。`;
function plan({ pages, extra = {} }) {
  const page = (slug, title, navOrder, more = {}) => ({ slug, title, description: DESC(title), navLabel: title, navOrder,
    changeFrequency: 'monthly', priority: 0.8, brief: `${title}。`, ...more });
  return {
    colorScheme: 'light',
    brand: { tagline: '让头发如丝般顺滑', logoIcon: 'scissors', email: 'hi@silky.test', locations: [{ label: '店面', address: 'Toronto, ON', phone: '(416) 555-0199' }] },
    navigation: { ctaLabel: '立即预约', ctaPage: 'quote', footerDescription: '多伦多的美发沙龙。' },
    seo: { siteTitle: `剪发 | ${BRAND}`, siteDescription: DESC('多伦多美发'), areaServed: [{ type: 'City', name: 'Toronto' }], addresses: [], priceRange: '$$', offerCatalogName: '服务' },
    services: [{ id: 'cut', name: '剪发', shortDescription: '剪发服务', fullDescription: '剪发，在多伦多。', icon: 'scissors', features: ['细致'], products: [] }],
    pages: pages.map(([slug, title, order, more]) => page(slug, title, order, more)),
    ...extra,
  };
}
// 配方路径的站级回包：contact 页在，但不带 title / navLabel（`more` 里把它们删掉）；整份不带 forms。
const RECIPE_PLAN = plan({ pages: [['home', '首页', 0], ['services', '服务', 1], ['services/cut', '剪发', 10, { serviceDetailPage: true, parentService: 'cut' }], ['contact', 'X', 4]] });
for (const p of RECIPE_PLAN.pages) if (p.slug === 'contact') { delete p.title; delete p.navLabel; }
// 补页路径的站级回包：没有 contact 页（照抄结构那条路由代码补）。
const STRUCT_PAGES = [['home', '首页', 0], ['about', '关于我们', 1], ['quote', '预约', 2], ['services/cut', '剪发', 10, { serviceDetailPage: true, parentService: 'cut' }]];

const PAYLOAD = (lang, extra = {}) => ({
  siteId: `lw1631${lang.replace(/[^a-z]/g, '')}`, siteUrl: 'https://silky.test', companyName: BRAND, brandNameByLocale: { zh: BRAND_ZH },
  industry: 'hair salon', location: 'Toronto, ON', language: lang, services: ['剪发'], homepageFingerprint: false,
  keywords: { 剪发: [{ keyword: '剪发', isPrimary: true, selected: true, goldIndex: 50, volume: 900 }] },
  ...extra,
});
const STRUCTURE = { refSite: 'https://reference.test', refPrefs: ['structure'], refAnalysis: { navLinks: ['Home', 'About', 'Quote'] } };

function run(label, payload, cfg) {
  const work = makeTree(label);
  const dir = path.dirname(work);
  const stub = path.join(dir, 'stub.js');
  const cfgFile = path.join(dir, 'cfg.json');
  const calls = path.join(dir, 'calls.jsonl');
  fs.writeFileSync(stub, STUB);
  fs.writeFileSync(cfgFile, JSON.stringify(cfg));
  fs.writeFileSync(calls, '');
  const r = cp.spawnSync(process.execPath, ['--require', stub, path.join(work, 'scripts', 'create-site.js')], {
    input: JSON.stringify(payload), cwd: work, encoding: 'utf8', maxBuffer: 64 << 20, timeout: 300000,
    env: { ...process.env, ANTHROPIC_API_KEY: 'stub-not-used', LW_CFG: cfgFile, LW_CALLS: calls },
  });
  if (r.error) die(`${label}：进程没跑起来 ${r.error.message}`);
  const events = (r.stdout || '').split('\n').filter(Boolean).map((l) => { try { return JSON.parse(l); } catch (e) { return {}; } });
  const site = path.join(work, 'site');
  const read = (rel) => { const f = path.join(site, rel); return fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, 'utf8')) : null; };
  const raw = (rel) => { const f = path.join(site, rel); return fs.existsSync(f) ? fs.readFileSync(f, 'utf8') : ''; };
  return { rc: r.status, stderr: r.stderr || '', events, error: (events.find((e) => e.event === 'error') || {}).message || '', read, raw };
}
const blocksOf = (pg) => (pg && (pg.blocks || pg.sections)) || [];
const sevenOf = (pg) => {
  const ph = blocksOf(pg).find((b) => b.type === 'page-header') || { data: {} };
  const ct = blocksOf(pg).find((b) => b.type === 'contact') || { data: {} };
  return { title: pg.title, navLabel: pg.navLabel, description: pg.description, headline: ph.data.headline, subheadline: ph.data.subheadline, formHeadline: ct.data.headline, formBody: ct.data.body };
};
const ENGLISH = ['Contact Us', 'Get in touch', 'Send us a message', 'Leave your details', '[object Object]'];
const ok = (R) => { assert.strictEqual(R.error, ''); assert.strictEqual(R.rc, 0, R.stderr.slice(-1500)); };

console.log('══ #1631 代码兜底的字按主语言（打桩）══');

// ── C + B：普通配方路径 ──
console.log('── C + B：配方路径，zh，站级回包里 contact 不带 title / navLabel、整份不带 forms');
const CB = run('recipe-zh', PAYLOAD('zh'), { plan: RECIPE_PLAN });
check('建站成功', () => ok(CB));
const zh = W.contactPageWords('zh', BRAND_ZH);
check('C：zh/pages/contact.json 的 title / navLabel 是字表 zh 那一行', () => {
  const c = CB.read('zh/pages/contact.json');
  assert.ok(c, 'zh/pages/contact.json 不存在');
  assert.strictEqual(c.title, zh.title);
  assert.strictEqual(c.navLabel, zh.navLabel);
});
check('B：zh/forms.json 两张表的 name / buttonText / successMessage 是字表 zh 那一行', () => {
  const forms = CB.read('zh/forms.json');
  assert.ok(Array.isArray(forms) && forms.length === 2, JSON.stringify(forms));
  for (const f of forms) {
    const want = W.formWords('zh', f.id);
    for (const k of ['name', 'buttonText', 'successMessage']) assert.strictEqual(f[k], want[k], `${f.id}.${k}`);
  }
});

// ── D：代码补的联系页 ──
console.log('── D：照抄结构（补页分支），zh，桩不给 contactPage');
const D = run('struct-zh', PAYLOAD('zh', STRUCTURE), { plan: plan({ pages: STRUCT_PAGES }) });
check('建站成功', () => ok(D));
const cD = D.read('zh/pages/contact.json');
check('D：盘上真有代码补出来的 zh/pages/contact.json', () => assert.ok(cD, 'zh/pages/contact.json 不存在'));
check('D：7 句等于字表 zh 那一行（description 含中文品牌名）', () => {
  assert.deepStrictEqual(sevenOf(cD), zh);
  assert.ok(cD.description.includes(BRAND_ZH), cD.description);
});
check('D：文件里没有 Contact Us / Get in touch / Send us a message / Leave your details / [object Object]', () => {
  const t = D.raw('zh/pages/contact.json');
  assert.deepStrictEqual(ENGLISH.filter((e) => t.includes(e)), []);
});

console.log('── D′：同一个夹具，桩给 contactPage 的 title 与 headline，其余五句不给');
const AI2 = { title: 'AI 写的标题', headline: 'AI 写的页头' };
const D2 = run('struct-zh-ai', PAYLOAD('zh', STRUCTURE), { plan: plan({ pages: STRUCT_PAGES, extra: { contactPage: AI2 } }) });
check('建站成功', () => ok(D2));
check('D′：AI 给的两句是 AI 的，其余五句是字表 zh 那一行（字表不盖 AI 的字）', () => {
  const s = sevenOf(D2.read('zh/pages/contact.json'));
  assert.deepStrictEqual(s, { ...zh, ...AI2 });
});

console.log('── 同一个 D 夹具换语言');
const DF = run('struct-fr', PAYLOAD('fr', STRUCTURE), { plan: plan({ pages: STRUCT_PAGES }) });
check('fr：建站成功', () => ok(DF));
check('fr：7 句是字表 fr 那一行', () => {
  const s = sevenOf(DF.read('fr/pages/contact.json'));
  assert.deepStrictEqual(s, W.contactPageWords('fr', BRAND));
  assert.ok(!s.title.includes('Contact Us'), s.title);
});
const DN = run('struct-nl', PAYLOAD('nl', STRUCTURE), { plan: plan({ pages: STRUCT_PAGES }) });
check('nl（字表里没有）：进程正常结束，7 句回英文', () => {
  ok(DN);
  const s = sevenOf(DN.read('nl/pages/contact.json'));
  assert.deepStrictEqual(s, W.contactPageWords('en', BRAND));
  assert.strictEqual(s.title, 'Contact Us');
});

// ── F2：第二语言的表单（做什么 4）+ 记录 /en/contact ──
// 站级那一通给第二语言的 locales，但【不给】forms 与 contactPage（`forms` 只在 AI 那一臂给）。
const secondPlan = (code, forms) => ({ ...RECIPE_PLAN, locales: { [code]: {
  tagline: 'Silky-smooth hair', ctaLabel: 'Book now', footerDescription: 'A hair salon in Toronto.', homeLabel: 'Home', quickLinksTitle: 'Quick links',
  copyright: `${BRAND}. All rights reserved.`,
  seo: { siteTitle: `Haircut | ${BRAND}`, siteDescription: 'Haircut in Toronto: Silky Hair Salon gives every guest careful, friendly service and easy booking.', offerCatalogName: 'Services' },
  services: [{ id: 'cut', name: 'Haircut', shortDescription: 'Haircut service', fullDescription: 'Haircut in Toronto.', features: ['Careful'], products: [] }],
  ...(forms ? { forms } : {}),
} } });
const runSecond = (code, forms) => run(`recipe-zh-${code}${forms ? '-ai' : ''}`, PAYLOAD('zh', { secondaryLocales: [code] }), { plan: secondPlan(code, forms), bilingual: true, second: code });
const TEXT3 = ['name', 'buttonText', 'successMessage'];
const textOf = (forms) => (forms || []).map((f) => [f.id, ...TEXT3.map((k) => f[k])]);
const wordsRow = (lang) => ['quote', 'contact'].map((id) => [id, ...TEXT3.map((k) => W.formWords(lang, id)[k])]);
const shapeOf = (forms) => JSON.stringify((forms || []).map((f) => [f.id, f.fields, f.primary]));

console.log('── F2：第二语言的表单，zh 主 + en 第二，AI 不给 locales.en.forms（主语言的 forms 也不给）');
const BI = runSecond('en');
check('zh + en：建站成功', () => ok(BI));
check('F2：en/forms.json 两张表的三句是字表【英文】那一行（不是主语言的中文）', () => {
  assert.deepStrictEqual(textOf(BI.read('en/forms.json')), wordsRow('en'));
});
check('F2：zh/forms.json 是字表中文那一行', () => assert.deepStrictEqual(textOf(BI.read('zh/forms.json')), wordsRow('zh')));
check('F2：两份的 id / fields / primary 逐张相同', () => {
  const a = shapeOf(BI.read('zh/forms.json'));
  assert.ok(a.includes('quote') && a.includes('contact'), a);
  assert.strictEqual(shapeOf(BI.read('en/forms.json')), a);
});
const BF = runSecond('fr');
check('F2：第二语言 fr ⟹ fr/forms.json 是字表法语那一行', () => { ok(BF); assert.deepStrictEqual(textOf(BF.read('fr/forms.json')), wordsRow('fr')); });
const BN = runSecond('nl');
check('F2：第二语言 nl（字表里没有）⟹ nl/forms.json 是英文那一行，不是中文', () => { ok(BN); assert.deepStrictEqual(textOf(BN.read('nl/forms.json')), wordsRow('en')); });
const AI_FORMS = [{ id: 'quote', name: 'AI quote', buttonText: 'AI quote button', successMessage: 'AI quote thanks' },
  { id: 'contact', name: 'AI contact', buttonText: 'AI contact button', successMessage: 'AI contact thanks' }];
const BA = runSecond('en', AI_FORMS);
check('F2：AI 给了 locales.en.forms ⟹ en/forms.json 用 AI 的', () => { ok(BA); assert.deepStrictEqual(textOf(BA.read('en/forms.json')), textOf(AI_FORMS)); });

// skipAI 示例站那条路（create-site.js 里就地手搓第二语言内容的那一处）：第二语言的表单也要用它自己那一行字表。
console.log('── F2-skipAI：zh 主 + en 第二，skipAI（示例站），不调 AI');
const SK = run('skipai-zh-en', PAYLOAD('zh', { skipAI: true, secondaryLocales: ['en'] }), { plan: {} });
check('F2-skipAI：建站成功', () => ok(SK));
check('F2-skipAI：en/forms.json 三句是字表英文那一行（不是主语言的中文）', () => assert.deepStrictEqual(textOf(SK.read('en/forms.json')), wordsRow('en')));
check('F2-skipAI：zh/forms.json 是字表中文那一行；两份 id / fields / primary 逐张相同', () => {
  assert.deepStrictEqual(textOf(SK.read('zh/forms.json')), wordsRow('zh'));
  assert.strictEqual(shapeOf(SK.read('en/forms.json')), shapeOf(SK.read('zh/forms.json')));
});

console.log('── 记录（不断言）：zh 主语言 + en 第二语言，/en/contact 现在是什么样');
{
  const c = BI.read('en/pages/contact.json');
  for (const e of BI.events.filter((x) => x.event === 'secondary-locale-failed')) console.log(`  📋 secondary-locale-failed：${JSON.stringify(e).slice(0, 400)}`);
  console.log(`  📋 en/pages/contact.json：${c ? JSON.stringify(sevenOf(c)) : '（不存在）'}`);
}

console.log(`\n${fail === 0 ? '✅' : '❌'} #1631：${pass} 通过 · ${fail} 失败`);
process.exit(fail === 0 ? 0 : 1);
