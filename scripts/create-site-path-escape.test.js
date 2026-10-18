#!/usr/bin/env node
// #1829 第 9 条 —— 建站写盘不许跑出输出目录。建站脚本从这张票起在 manager 机上以 root 跑（不再关在一次性容器里），
// 而服务页的文件名是 AI（Call 1）写的服务 id：`pages/services/<id>.json`。改之前短的 id 不清洗（`keyword-pages.js §capServiceIds`
// 只收超长的），`../../x` 原样拼进路径 ⟹ QA3 用离线桩写出了 `/tmp/QA3_ESCAPE_MARKER.json`。
//
// 两道（PM 2026-10-17 21:05 裁定）：
//   ① 主路：清洗 —— 不是安全单段名的 id 跟超长的一样走 keywordSlug()，这一页的去向 = 被清洗成单段名，建站照常成功
//   ② 兜底：写盘前 `page-files.js §pageFilePath` 检查解析后落在 `<locale>/pages/` 里，越界就抛（整站失败成 error）
//
// 量的是（真 create-site.js 进程 + 按提示词回放的桩，桩同 create-site-resume.test.js；🔴 不调真 AI，#1499）：
//   不越界    两个越界 id（一个算好正落在本测试自己的临时根目录里，一个是 QA3 那发六个 `../`）⟹ 两个解析出来的绝对路径都不存在，
//             临时根目录跑前跑后的条目一个不多（🔴 只比上级目录是瞎的：六个 `../` 那发不落在上级目录 —— PM 裁定②）
//   去向      这两页被清洗成单段名：services.json 里是新 id、页面文件在 pages/services/<新 id>.json、站里没有一个路径带 `..`
//   兜底      pageFilePath 对越界 slug 抛、对正常 slug 回 pages/ 下面的路径（单删清洗时上面那几格红在「去向」，单删兜底时红在这里）
'use strict';

const assert = require('assert');
const cp = require('child_process');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { pageFilePath } = require('./lib/page-files');
const { capServiceIds } = require('./lib/keyword-pages');

const NEXT = path.resolve(__dirname, '..');
const TEMP = [];
process.on('exit', () => { for (const d of TEMP) { try { fs.rmSync(d, { recursive: true, force: true }); } catch (e) { /* 打扫不成不改结论 */ } } });
function die(msg) { console.log(`💥 ${msg}`); process.exit(2); }

let pass = 0;
let fail = 0;
function check(name, fn) {
  try { fn(); pass += 1; console.log(`  ✅ ${name}`); } catch (e) { fail += 1; console.log(`  ❌ ${name}\n     ${e.message}`); }
}

// ── 桩（同 create-site-call1-pages.test.js：认得站级 / 每页 / 关键词页 / SEO 重写四种调用）───────────────────────
function stubMain() {
'use strict';
const Module = require('module');
const fs = require('fs');
const cfg = JSON.parse(fs.readFileSync(process.env.RS_STUB_CFG, 'utf8'));
globalThis.fetch = async () => { throw new Error('offline (test stub)'); };
const BODY = '我们在多伦多为每一位顾客提供细致的护理与造型服务，预约简单，到店即享专业建议，环境舒适安心，欢迎随时来店体验我们团队带来的放松时光与焕然一新的造型。';
const DESC_KW = (kw) => `${kw}就在 Toronto：Silky Hair Salon 在多伦多为每一位顾客提供细致的${kw}服务，预约简单，到店即享专业建议，环境舒适安心，欢迎随时来店体验焕然一新的造型。`;
// #1601 —— 非首页的块序由整站配方定，写在提示词里（`write exactly these N, in this order: "a" → "b"`）：桩照它回，
//    每种块一份过得了块库的 data（同 create-site-call1-pages.test.js 的桩）。
const BLOCK = {
  'page-header': (title) => ({ type: 'page-header', data: { headline: title } }),
  content: (title) => ({ type: 'content', data: { headline: `关于${title}`, body: BODY } }),
  features: (title, prompt) => ({ type: 'features', data: /"features": write "items": \{"source": "services"\}/.test(prompt)
    ? { headline: '我们的服务', items: { source: 'services' } }
    : { headline: `${title}的亮点`, items: [1, 2, 3].map((n) => ({ title: `亮点${n}`, text: '每一步都由资深发型师完成。' })) } }),
  faq: () => ({ type: 'faq', data: { headline: '常见问题', items: [{ question: '需要预约吗？', answer: '建议提前预约，也欢迎直接到店。' }] } }),
  cta: () => ({ type: 'cta', data: { headline: '现在预约', body: '告诉我们您想要的造型。', ctas: [{ label: '预约', href: '/contact', style: 'solid' }] } }),
  contact: () => ({ type: 'contact', data: { headline: '联系我们', body: '留下联系方式，我们尽快回复。', form: { id: 'contact' }, options: { form: 'full' } } }),
};
function sectionsFor(slug, title, prompt) {
  const fixed = (prompt.match(/write exactly these \d+, in this order: ([^\n]+?)\. Do not add/) || [])[1];
  if (fixed) return fixed.split(' → ').map((t) => BLOCK[JSON.parse(t)](title, prompt));
  const tail = [
    { type: 'faq', data: { headline: '常见问题', items: [{ question: '需要预约吗？', answer: '建议提前预约，也欢迎直接到店。' }] } },
    { type: 'cta', data: { headline: '现在预约', body: '告诉我们您想要的造型。', ctas: [{ label: '预约', href: '/quote', style: 'solid' }] } },
  ];
  if (slug === 'home') {
    return [
      { type: 'hero', data: { headline: title, subheadline: BODY, ctas: [{ label: '预约', href: '/quote', style: 'solid' }] } },
      { type: 'features', data: { headline: '我们的服务', body: '每一项都由资深发型师完成。', items: { source: 'services' } } },
      ...tail,
    ];
  }
  return [{ type: 'page-header', data: { headline: title } }, { type: 'content', data: { headline: `关于${title}`, body: BODY } }, ...tail];
}
// #1593 —— 有第二语言（en）时回包按语言分组：第二语言那一份 = 主语言同一组块、每段字前面加 "EN "（结构逐字相同，取主语言的格子
// 写盘时照样取主语言那份）。
const KEEP = new Set(['type', 'href', 'style', 'source', 'icon', 'id', 'imageUrl', 'kind', 'size', 'role']);
const enText = (v) => (typeof v === 'string' ? (v ? `EN ${v}` : v) : Array.isArray(v) ? v.map(enText)
  : v && typeof v === 'object' ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, KEEP.has(k) ? x : enText(x)])) : v);
const enGroup = (pg, sections) => ({ title: enText(pg.title), description: enText(pg.description), navLabel: enText(pg.navLabel || pg.title), targetKeyword: 'haircut', sections: enText(sections) });
function answer(req) {
  const first = req.messages[0].content;
  const grouped = first.includes('Respond with ONE JSON object keyed by language code');
  const kind = first.includes('Generate a JSON object with this EXACT structure') ? 'site'
    : first.includes('Write the sections of ONE page') ? 'page'
      : first.includes('Write ONE keyword landing page') ? 'keyword'
        : first.includes('An automatic SEO check found the problems') ? 'seo-rewrite' : 'other';
  const slug = kind === 'page' || kind === 'keyword' ? (first.match(/- slug: "([^"]+)"/) || [])[1] : null;
  fs.appendFileSync(process.env.RS_STUB_CALLS, JSON.stringify({ kind, slug }) + '\n');
  // #1596 —— 站级那一通被截断 ⟹ create-site 用代码拼的站级计划（降级记一笔）
  if (kind === 'site' && cfg.site === 'truncated') return { json: cfg.plan, out: 4000, stop: 'max_tokens' };
  if (kind === 'site') return { json: cfg.locales ? { ...cfg.plan, locales: cfg.locales } : cfg.plan, out: 4000 };
  if (kind === 'page') {
    // #1596 —— 走代码拼的站级计划时，页面清单不是 plan() 那份（services/<拼音 id>、contact）⟹ 认不出的页用 slug 当标题
    const page = cfg.plan.pages.find((p) => p.slug === slug) || { slug, title: slug };
    const sections = sectionsFor(slug, page.title, first);
    return { json: grouped ? { zh: { sections }, en: enGroup(page, sections) } : { sections }, out: 3000 };
  }
  if (kind === 'keyword') {
    const kw = (first.match(/- target keyword: "([^"]+)"/) || [])[1];
    const sections = [
      { type: 'page-header', data: { headline: `${kw}｜多伦多` } },
      { type: 'content', data: { headline: `${kw}怎么做`, body: `${kw}：${BODY}` } },
      { type: 'faq', data: { headline: `${kw}常见问题`, items: [{ question: `${kw}需要预约吗？`, answer: '建议提前预约，也欢迎直接到店。' }] } },
      { type: 'cta', data: { headline: '现在预约', body: '告诉我们您想要的造型。', ctas: [{ label: '预约', href: '/quote', style: 'solid' }] } },
    ];
    const pg = { slug, title: `${kw}｜多伦多`, description: DESC_KW(kw), navLabel: kw, navOrder: 50, changeFrequency: 'monthly', priority: 0.6, sections };
    return { json: grouped ? { zh: pg, en: enGroup(pg, sections) } : pg, out: 2000 };
  }
  if (kind === 'seo-rewrite' && first.includes('TEXTS TO FIX:')) {
    // #1593 起修补是字段级的：原样退回那几个字段（修不好 —— 主语言那几跑本来就不会走到这里，第二语言修不好只记日志）。
    return { json: { fields: JSON.parse((first.match(/TEXTS TO FIX:\n(\{[\s\S]*?\n\})\n\nPROBLEMS TO FIX/) || [])[1]) }, out: 1000 };
  }
  if (kind === 'seo-rewrite') {
    const env = JSON.parse((first.match(/\n\n(\{[\s\S]*?\n\})\n\nPROBLEMS TO FIX/) || [])[1]);
    return { json: env, out: 1000 };
  }
  throw new Error('桩不认识这一通调用：' + first.slice(0, 120));
}
class FakeAnthropic {
  constructor() {
    this.messages = {
      stream: (req) => ({
        finalMessage: async () => {
          const a = answer(req);
          return { content: [{ type: 'text', text: JSON.stringify(a.json) }], usage: { input_tokens: 100, output_tokens: a.out }, stop_reason: a.stop || 'end_turn' };
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
};}
const STUB = `(${stubMain.toString()})();\n`;

// ── 工作区：一份模板 + 一个空的输出目录（= manager 每次建站 mkdtemp 的那个）───────────────────────────────────
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cs1829-escape-'));
TEMP.push(root);
const work = path.join(root, 'template');
cp.execSync(`tar --exclude=./node_modules --exclude=./out --exclude=./.next --exclude=./site --exclude=./public/photos -cf - . | (mkdir -p "${work}" && tar -xf - -C "${work}")`, { cwd: NEXT, stdio: 'pipe' });
fs.symlinkSync(path.join(NEXT, 'node_modules'), path.join(work, 'node_modules'));
const out = path.join(root, 'out');
fs.mkdirSync(out);
const pagesDir = path.join(out, 'site', 'zh', 'pages');

// ── 两个越界 id ─────────────────────────────────────────────────────────────────────────────────────────────
const TAG = crypto.randomBytes(4).toString('hex');
const target = (id) => path.resolve(pagesDir, `services/${id}.json`);
// 正落在本测试自己的临时根目录里：`../` 加到解析结果的目录 == root 为止（不假设层数）。
let ESC_ROOT = null;
for (let k = 1; k < 12 && !ESC_ROOT; k += 1) {
  const id = `${'../'.repeat(k)}ESCAPE_ROOT_${TAG}`;
  if (path.dirname(target(id)) === root) ESC_ROOT = id;
}
if (!ESC_ROOT) die('算不出落在临时根目录里的那个 id');
// QA3 那一发：六个 `../`，落点取决于输出目录多深（PM 算到 `/`，QA3 落在 /tmp）—— 自己解析成绝对路径再断言。
const ESC_DEEP = `../../../../../../ESCAPE_DEEP_${TAG}`;
const ESCAPES = [ESC_ROOT, ESC_DEEP];
for (const id of ESCAPES) {
  if (target(id).startsWith(out + path.sep)) die(`${id} 没有越界（${target(id)}），这条测试量不到东西`);
  if (fs.existsSync(target(id))) die(`跑之前 ${target(id)} 就已经在了`);
}

const SERVICES = [['cut', '剪发'], [ESC_ROOT, '染发'], [ESC_DEEP, '烫发']];
const DESC = (t) => `${t}：Silky Hair Salon 在多伦多为每一位顾客提供细致的护理与造型服务，预约简单，到店即享专业建议，环境舒适安心，欢迎随时来店体验。`;
function plan() {
  const page = (slug, title, navOrder, extra = {}) => ({ slug, title, description: DESC(title), navLabel: title, navOrder,
    changeFrequency: 'monthly', priority: 0.8, brief: `BRIEF<${slug}>：这一页讲${title}。`, ...extra });
  return {
    colorScheme: 'light',
    brand: { tagline: '让头发如丝般顺滑', logoIcon: 'scissors', email: 'hi@silky.test', locations: [{ label: '店面', address: 'Toronto, ON', phone: '(416) 555-0199' }] },
    navigation: { ctaLabel: '立即预约', ctaPage: 'contact', footerDescription: '多伦多的美发沙龙。' },
    seo: { siteTitle: 'Silky Hair Salon 多伦多美发', siteDescription: DESC('多伦多美发'), areaServed: [{ type: 'City', name: 'Toronto' }], addresses: [], priceRange: '$$', offerCatalogName: '服务' },
    services: SERVICES.map(([id, name]) => ({ id, name, shortDescription: `${name}服务`, fullDescription: `${name}，在多伦多。`, icon: 'scissors', features: ['细致'], products: [] })),
    forms: [{ id: 'contact', name: '联系', buttonText: '提交', successMessage: '谢谢' }],
    pages: [
      page('home', '首页', 0), page('services', '服务', 1),
      ...SERVICES.map(([id, name], i) => page(`services/${id}`, name, 10 + i, { serviceDetailPage: true, parentService: id })),
      page('contact', '联系我们', 9),
    ],
  };
}

const before = fs.readdirSync(root).sort();
const stubFile = path.join(root, 'stub.js');
const cfgFile = path.join(root, 'cfg.json');
const callsFile = path.join(root, 'calls.jsonl');
fs.writeFileSync(stubFile, STUB);
fs.writeFileSync(cfgFile, JSON.stringify({ plan: plan() }));
fs.writeFileSync(callsFile, '');
const listed = [...before, 'calls.jsonl', 'cfg.json', 'stub.js'].sort();

console.log('══ #1829 第 9 条：建站写盘不越界（打桩，3 服务中文站，其中 2 个服务 id 带 ../）══');
const r = cp.spawnSync(process.execPath, ['--require', stubFile, path.join(work, 'scripts', 'create-site.js')], {
  input: JSON.stringify({ siteId: 'cs182909', siteUrl: 'https://silky.test', companyName: 'Silky Hair Salon', industry: 'hair salon',
    location: 'Toronto, ON', language: 'zh', services: SERVICES.map(([, n]) => n), homepageFingerprint: false, themeRotationIndex: 0, outDir: out }),
  cwd: work, encoding: 'utf8', maxBuffer: 64 << 20, timeout: 300000,
  env: { ...process.env, ANTHROPIC_API_KEY: 'stub-not-used', RS_STUB_CFG: cfgFile, RS_STUB_CALLS: callsFile },
});
if (r.error) die(`进程没跑起来 ${r.error.message}`);
const events = (r.stdout || '').split('\n').filter(Boolean).map((l) => { try { return JSON.parse(l); } catch (e) { return {}; } });
const error = (events.find((e) => e.event === 'error') || {}).message || '';

check('不越界：两个越界 id 解析出来的绝对路径都不存在（含 QA3 那发六个 ../）', () => {
  for (const id of ESCAPES) assert.ok(!fs.existsSync(target(id)), `写出去了：${target(id)}`);
});
check('不越界：临时根目录跑前跑后条目一个不多（只多了本测试自己写的桩 / 配置 / 调用记录）', () => {
  assert.deepStrictEqual(fs.readdirSync(root).sort(), listed);
});
check('去向 = 清洗成单段名：建站照常成功（rc 0、没有 error 事件）', () => {
  assert.strictEqual(r.status, 0, `${error}\n${(r.stderr || '').slice(-1500)}`);
  assert.strictEqual(error, '');
});
const svcFile = path.join(out, 'site', 'zh', 'services.json');
const svcIds = fs.existsSync(svcFile) ? JSON.parse(fs.readFileSync(svcFile, 'utf8')).map((s) => s.id) : [];
check('去向：services.json 里三个 id 都是单段名，越界那两个换成了 escape-root-… / escape-deep-…', () => {
  assert.strictEqual(svcIds.length, 3, JSON.stringify(svcIds));
  assert.ok(svcIds.every((id) => /^[a-z0-9-]+$/.test(id)), JSON.stringify(svcIds));
  assert.ok(svcIds.includes('cut'));
  assert.ok(svcIds.includes(`escape-root-${TAG}`) && svcIds.includes(`escape-deep-${TAG}`), JSON.stringify(svcIds));
});
check('去向：每个服务的详情页在 pages/services/<新 id>.json，parentService 跟着改了', () => {
  for (const id of svcIds) {
    const f = path.join(pagesDir, 'services', `${id}.json`);
    assert.ok(fs.existsSync(f), `没有 ${f}`);
    assert.strictEqual(JSON.parse(fs.readFileSync(f, 'utf8')).parentService, id);
  }
});
check('去向：站点目录里没有一个路径段是 ..，也没有一个文件内容里还留着越界的旧 id', () => {
  const walk = (d) => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(d, e.name)) : [path.join(d, e.name)]));
  for (const f of walk(path.join(out, 'site'))) {
    assert.ok(!f.split(path.sep).includes('..'), f);
    const txt = fs.readFileSync(f, 'utf8');
    for (const id of ESCAPES) assert.ok(!txt.includes(id), `${path.relative(out, f)} 里还有 ${id}`);
  }
});

console.log('── 兜底：page-files.js §pageFilePath');
check('越界的 slug 一律抛（../、绝对路径、空串），不碰盘', () => {
  for (const slug of [`services/${ESC_DEEP}`, `services/${ESC_ROOT}`, '../x', '/etc/x', '', 'services/../../x']) {
    assert.throws(() => pageFilePath('/srv/site/en', slug), /outside/, JSON.stringify(slug));
  }
});
check('正常的 slug 回 pages/ 下面那个文件', () => {
  assert.strictEqual(pageFilePath('/srv/site/en', 'home'), '/srv/site/en/pages/home.json');
  assert.strictEqual(pageFilePath('/srv/site/en', 'services/cut'), '/srv/site/en/pages/services/cut.json');
  assert.strictEqual(pageFilePath('/srv/site/en', 'services/cut/fade'), '/srv/site/en/pages/services/cut/fade.json');
});

console.log('── 清洗：keyword-pages.js §capServiceIds');
check('不是安全单段名的 id 都清洗（带 / 或 \\、整段是点、空串），正常的一个字不动', () => {
  const services = [{ id: 'cut', name: 'Cut' }, { id: ESC_DEEP, name: 'A' }, { id: 'a\\b', name: 'B' }, { id: '..', name: 'Dots' }, { id: '', name: 'Empty' }];
  const pages = [{ slug: `services/${ESC_DEEP}`, parentService: ESC_DEEP }, { slug: 'home', sections: [{ data: { ctas: [{ href: `/services/${ESC_DEEP}#top` }] } }] }];
  const renames = capServiceIds({ services, pages });
  assert.deepStrictEqual(renames.map((x) => x.from), [ESC_DEEP, 'a\\b', '..', '']);
  assert.deepStrictEqual(services.map((s) => s.id), ['cut', `escape-deep-${TAG}`, 'a-b', 'dots', 'empty']);
  assert.strictEqual(pages[0].slug, `services/escape-deep-${TAG}`);
  assert.strictEqual(pages[0].parentService, `escape-deep-${TAG}`);
  assert.strictEqual(pages[1].sections[0].data.ctas[0].href, `/services/escape-deep-${TAG}#top`);
});

console.log(`\n══ 汇总: 通过 ${pass} · 失败 ${fail} ══`);
process.exit(fail ? 1 : 0);
