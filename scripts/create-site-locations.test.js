#!/usr/bin/env node
// #1977（Epic:MultiLocation T2）—— payload 带 `locations`（确认页那张地点列表）⟹ brand.json 的 `locations` 由代码写。
// 真 create-site.js 进程（同 create-site-degraded.test.js：`@anthropic-ai/sdk` 换成按提示词回放的桩，不调真 AI）。
//
//   验收 2  三地点 payload、skipAI ⟹ locations 三项、label / address 与 payload 逐项相同、顺序同 payload、id 各不相同、
//           没有一项是 123 Demo Street；第二家没给电话 ⟹ 它没有 phone 这一键
//   验收 6  一个地点、不带 city 等三项、skipAI ⟹ 只有一项，label / address / phone 原样，没有 city / streetAddress / postalCode
//   验收 7  代码兜底建站（站级那一通失败 ⟹ fallbackSitePlan → assembleBrand → locationsWithFacts）：
//           一个地点没带 rating、平台评分只有 yelp ⟹ locations[0].rating = {4.2, 31, yelp}；
//           两个地点、第二个带自己的 Google rating、平台评分另有 google ⟹ 第一个没有 rating 这一键
//   做什么 5 营业时间逐个地点由站级那一通转写、逐个核：核得过的那家写 hours，核不过的那家不写；站级提示词不再要 AI 写 locations
'use strict';

const assert = require('assert');
const cp = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const NEXT = path.resolve(__dirname, '..');
const TEMP = [];
process.on('exit', () => {
  if (process.env.LOC_KEEP === '1') { if (TEMP.length) console.log(`📌 LOC_KEEP=1 ⟹ 留着 ${TEMP.join(' ')}`); return; }
  for (const d of TEMP) { try { fs.rmSync(d, { recursive: true, force: true }); } catch (e) { /* 打扫不成不改结论 */ } }
});
function die(msg) { console.log(`💥 ${msg}`); process.exit(2); }

let pass = 0;
let fail = 0;
function check(name, fn) {
  try { fn(); pass += 1; console.log(`  ✅ ${name}`); } catch (e) { fail += 1; console.log(`  ❌ ${name}\n     ${e.message}`); }
}

// ── 桩（站级那一通按 cfg 回 / 失败；每页那一通按提示词里锁定的块序回）────────────────────────────────
function stubMain() {
'use strict';
const Module = require('module');
const fs = require('fs');
const cfg = JSON.parse(fs.readFileSync(process.env.LOC_STUB_CFG, 'utf8'));
globalThis.fetch = async () => { throw new Error('offline (test stub)'); };
const BODY = 'We look after every guest with careful cuts and colour, simple booking and honest advice in a calm and friendly salon.';
const BLOCK = {
  'page-header': (title) => ({ type: 'page-header', data: { headline: title } }),
  content: (title) => ({ type: 'content', data: { headline: `About ${title}`, body: BODY } }),
  features: (title, prompt) => ({ type: 'features', data: /"features": write "items": \{"source": "services"\}/.test(prompt)
    ? { headline: 'Our services', items: { source: 'services' } }
    : { headline: `${title} highlights`, items: [1, 2, 3].map((n) => ({ title: `Highlight ${n}`, text: 'Done by a senior stylist.' })) } }),
  faq: () => ({ type: 'faq', data: { headline: 'FAQ', items: [{ question: 'Do I need to book?', answer: 'Booking ahead is best.' }] } }),
  cta: () => ({ type: 'cta', data: { headline: 'Book now', body: 'Tell us what you want.', ctas: [{ label: 'Book', href: '/contact', style: 'solid' }] } }),
  contact: () => ({ type: 'contact', data: { headline: 'Contact us', body: 'Leave your details.', form: { id: 'contact' }, options: { form: 'full' } } }),
};
function sectionsFor(title, prompt) {
  const fixed = (prompt.match(/write exactly these \d+, in this order: ([^\n]+?)\. Do not add/) || [])[1];
  if (fixed) return fixed.split(' → ').map((t) => (BLOCK[JSON.parse(t)] || BLOCK.content)(title, prompt));
  return [BLOCK['page-header'](title), BLOCK.content(title), BLOCK.faq(), BLOCK.cta()];
}
function answer(req) {
  const first = req.messages[0].content;
  if (first.includes('Generate a JSON object with this EXACT structure')) {
    fs.writeFileSync(process.env.LOC_STUB_PROMPT, first);
    if (cfg.site === 'apierror') { const e = new Error('stub: invalid request'); e.status = 400; throw e; }
    return { json: cfg.plan, out: 4000 };
  }
  if (first.includes('Write the sections of ONE page')) {
    const slug = (first.match(/- slug: "([^"]+)"/) || [])[1];
    const page = (cfg.plan.pages || []).find((p) => p.slug === slug) || { title: slug };
    return { json: { sections: sectionsFor(page.title, first) }, out: 3000 };
  }
  if (first.includes('An automatic SEO check found the problems')) {
    const m = first.match(/TEXTS TO FIX:\n(\{[\s\S]*?\n\})\n\nPROBLEMS TO FIX/);
    return { json: { fields: m ? JSON.parse(m[1]) : {} }, out: 300 };
  }
  throw new Error('桩不认识这一通调用：' + first.slice(0, 120));
}
class FakeAnthropic {
  constructor() {
    this.messages = {
      stream: (req) => ({
        finalMessage: async () => {
          const a = answer(req);
          return { content: [{ type: 'text', text: JSON.stringify(a.json) }], usage: { input_tokens: 100, output_tokens: a.out }, stop_reason: 'end_turn' };
        },
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
};
}
const STUB = `(${stubMain.toString()})();\n`;

function makeTree(label) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), `loc1977-${label}-`));
  TEMP.push(root);
  const work = path.join(root, 'nextjs');
  cp.execSync(`tar --exclude=./node_modules --exclude=./out --exclude=./.next --exclude=./site --exclude=./public/photos -cf - . | (mkdir -p "${work}" && tar -xf - -C "${work}")`, { cwd: NEXT, stdio: 'pipe' });
  fs.symlinkSync(path.join(NEXT, 'node_modules'), path.join(work, 'node_modules'));
  return work;
}

const SERVICES = ['Haircut', 'Colour', 'Perm'];
function plan(extraSeo = {}) {
  const DESC = (t) => `${t} at Hair J: careful cuts, colour and styling in a calm salon, with simple booking and honest advice from our senior stylists.`;
  const page = (slug, title, navOrder, extra = {}) => ({ slug, title, description: DESC(title), navLabel: title, navOrder,
    changeFrequency: 'monthly', priority: 0.8, brief: `This page covers ${title}.`, ...extra });
  return {
    colorScheme: 'light',
    brand: { tagline: 'Hair you love', logoIcon: 'scissors', email: 'hi@hairj.test' },
    navigation: { ctaLabel: 'Book now', ctaPage: 'contact', footerDescription: 'A hair salon in Pickering.' },
    seo: { siteTitle: 'Hair J — Hair Salon in Pickering', siteDescription: DESC('Hair salon'), areaServed: [{ type: 'City', name: 'Pickering' }], addresses: [], offerCatalogName: 'Services', ...extraSeo },
    services: SERVICES.map((name) => ({ id: name.toLowerCase(), name, shortDescription: `${name} service`, fullDescription: `${name} in Pickering.`, icon: 'scissors', features: ['Careful'], products: [] })),
    forms: [{ id: 'contact', name: 'Contact', buttonText: 'Send', successMessage: 'Thanks' }],
    pages: [
      page('home', 'Home', 0), page('services', 'Services', 1), page('contact', 'Contact', 2),
      ...SERVICES.map((name, i) => page(`services/${name.toLowerCase()}`, name, 10 + i, { serviceDetailPage: true, parentService: name.toLowerCase() })),
    ],
  };
}
const PAYLOAD = (extra = {}) => ({
  siteId: 'loc19770', siteUrl: 'https://hairj.test', companyName: 'Hair J', industry: 'hair salon', location: 'Pickering, ON',
  language: 'en', services: SERVICES, homepageFingerprint: false, skipGeocode: true, ...extra,
});

function run(label, payload, cfg = {}) {
  const work = makeTree(label);
  const dir = path.dirname(work);
  const stub = path.join(dir, 'stub.js');
  const cfgFile = path.join(dir, 'cfg.json');
  const promptFile = path.join(dir, 'site-prompt.txt');
  fs.writeFileSync(stub, STUB);
  fs.writeFileSync(cfgFile, JSON.stringify({ plan: plan(cfg.seo), ...cfg }));
  const r = cp.spawnSync(process.execPath, ['--require', stub, path.join(work, 'scripts', 'create-site.js')], {
    input: JSON.stringify(payload), cwd: work, encoding: 'utf8', maxBuffer: 64 << 20, timeout: 300000,
    env: { ...process.env, ANTHROPIC_API_KEY: 'stub-not-used', LOC_STUB_CFG: cfgFile, LOC_STUB_PROMPT: promptFile },
  });
  if (r.error) die(`${label}：进程没跑起来 ${r.error.message}`);
  const events = (r.stdout || '').split('\n').filter(Boolean).map((l) => { try { return JSON.parse(l); } catch (e) { return {}; } });
  const error = (events.find((e) => e.event === 'error') || {}).message || '';
  if (r.status !== 0 || error) die(`${label}：建站失败 rc=${r.status} ${error}\n${(r.stderr || '').slice(-1500)}`);
  const brand = JSON.parse(fs.readFileSync(path.join(work, 'site', 'brand.json'), 'utf8'));
  const prompt = fs.existsSync(promptFile) ? fs.readFileSync(promptFile, 'utf8') : null;
  return { brand, prompt, events };
}

const THREE = [
  { label: 'Hair J Pickering', address: '1355 Kingston Rd, Pickering, ON L1V 1B8', phone: '(905) 555-0101', hours: 'Mon-Fri 9-6',
    rating: { ratingValue: 4.6, reviewCount: 212, source: 'google' }, googleMapsUrl: 'https://maps.google.com/?cid=1', city: 'Pickering', streetAddress: '1355 Kingston Rd', postalCode: 'L1V 1B8' },
  { label: 'Hair J Ajax', address: '75 Bayly St W, Ajax, ON L1S 7K7', phone: '' },
  { label: 'Hair J Ontario', address: '1 Yonge St, Toronto, ON', phone: '(416) 555-0303' },
];

console.log('验收 2 —— 三地点、skipAI');
{
  const R = run('ac2', PAYLOAD({ skipAI: true, locations: THREE }));
  const locs = R.brand.locations;
  check('locations 三项，label / address 与 payload 逐项相同、顺序相同', () => {
    assert.deepStrictEqual(locs.map((l) => [l.label, l.address]), THREE.map((l) => [l.label, l.address]));
  });
  check('id 各不相同', () => {
    assert.strictEqual(new Set(locs.map((l) => l.id)).size, 3, JSON.stringify(locs.map((l) => l.id)));
    assert.ok(locs.every((l) => typeof l.id === 'string' && l.id));
  });
  check('没有一项是 123 Demo Street', () => assert.ok(!JSON.stringify(locs).includes('123 Demo Street'), JSON.stringify(locs)));
  check('第二家没给电话 ⟹ 没有 phone 这一键', () => assert.ok(!('phone' in locs[1]), JSON.stringify(locs[1])));
  check('skipAI 不写 hours / geo；其余字段原样', () => {
    assert.ok(locs.every((l) => !('hours' in l) && !('geo' in l)), JSON.stringify(locs));
    const { hours: _h, ...want } = THREE[0];
    assert.deepStrictEqual({ ...locs[0], id: undefined }, { id: undefined, ...want });
  });
}

console.log('验收 6 —— 一个地点、skipAI');
{
  const one = { label: 'Main', address: '9 Main St, Newmarket, ON', phone: '905-555-1234' };
  const R = run('ac6', PAYLOAD({ skipAI: true, locations: [one] }));
  check('只有一项，label / address / phone 原样，没有 city 等三项', () => {
    assert.strictEqual(R.brand.locations.length, 1);
    const { id, ...rest } = R.brand.locations[0];
    assert.ok(id);
    assert.deepStrictEqual(rest, one);
  });
}

console.log('验收 7 —— 代码兜底建站，非 Google 评分不丢');
{
  const R = run('ac7a', PAYLOAD({ locations: [{ label: 'Main', address: '9 Main St, Newmarket, ON', phone: '', hours: '' }],
    onlinePresence: { platformRatings: { yelp: { rating: 4.2, reviewCount: 31 } } } }), { site: 'apierror' });
  check('走的是代码兜底（site-plan 降级）', () => assert.ok(R.events.some((e) => e.event === 'degraded' && e.step === 'site-plan')));
  check('locations[0].rating = {4.2, 31, yelp}', () => {
    assert.deepStrictEqual(R.brand.locations[0].rating, { ratingValue: 4.2, reviewCount: 31, source: 'yelp' });
  });
  const R2 = run('ac7b', PAYLOAD({
    locations: [{ label: 'Text one', address: '9 Main St, Newmarket, ON' }, { label: 'Google one', address: '75 Bayly St W, Ajax', rating: { ratingValue: 4.4, reviewCount: 50, source: 'google' } }],
    onlinePresence: { platformRatings: { google: { rating: 4.4, reviewCount: 50 }, yelp: { rating: 4.2, reviewCount: 31 } } } }), { site: 'apierror' });
  check('第二个地点带自己的 Google rating ⟹ 第一个没有 rating 这一键', () => {
    assert.ok(!('rating' in R2.brand.locations[0]), JSON.stringify(R2.brand.locations[0]));
    assert.deepStrictEqual(R2.brand.locations[1].rating, { ratingValue: 4.4, reviewCount: 50, source: 'google' });
  });
  check('代码兜底写全部地点（两项）', () => assert.strictEqual(R2.brand.locations.length, 2));
}

console.log('做什么 5 —— AI 那条路：营业时间逐个地点转写、逐个核');
{
  const R = run('hours', PAYLOAD({ locations: [
    { label: 'A', address: '1 A St', hours: 'Mon-Fri 9am-6pm' },
    { label: 'B', address: '2 B St', hours: 'Sat 10am-4pm' },
    { label: 'C', address: '3 C St', hours: 'Sun 10am-4pm' },
    { label: 'D', address: '4 D St' },
  ] }), { seo: { openingHoursByLocation: [
    { location: 1, openingHours: [{ days: ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'], opens: '09:00', closes: '18:00' }] },
    { location: 2, openingHours: [{ days: ['Saturday'], opens: '10:00', closes: '16:00' }] },
    // 第三家：AI 编了一个原文里没有的 11 点 ⟹ 核不过，不写
    { location: 3, openingHours: [{ days: ['Sunday'], opens: '11:00', closes: '16:00' }] },
  ] } });
  const locs = R.brand.locations;
  check('四项，顺序同 payload', () => assert.deepStrictEqual(locs.map((l) => l.label), ['A', 'B', 'C', 'D']));
  check('第一、二家各按自己的原文核过 ⟹ 各写自己的 hours', () => {
    assert.deepStrictEqual(locs[0].hours, [{ days: ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'], opens: '09:00', closes: '18:00' }]);
    assert.deepStrictEqual(locs[1].hours, [{ days: ['Saturday'], opens: '10:00', closes: '16:00' }]);
  });
  check('第三家核不过 ⟹ 没有 hours；第四家没给 ⟹ 没有 hours', () => {
    assert.ok(!('hours' in locs[2]), JSON.stringify(locs[2]));
    assert.ok(!('hours' in locs[3]), JSON.stringify(locs[3]));
  });
  check('站级提示词不再要 AI 写 locations，要的是 openingHoursByLocation', () => {
    assert.ok(R.prompt, '没截到站级提示词');
    assert.ok(!R.prompt.includes('"locations": [{ "label"'), '提示词里还有 locations 那一行');
    assert.ok(R.prompt.includes('"openingHoursByLocation"'));
    assert.ok(!/^ {4}"openingHours": \[\{/m.test(R.prompt), '单份 openingHours 那一行还在');
  });
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
