#!/usr/bin/env node
// #1596 —— 付钱之后不再 fatal：create-site.js 里 11 处「某一步没做好」各改成降级 + 一条 `degraded` 事件。
// 真 create-site.js 进程，`@anthropic-ai/sdk` 换成按提示词回放的桩（同 create-site-call1-pages.test.js，输入也是它那份
// 7 服务中文站）。不调真 AI（#1499），不是 skipAI（skipAI 在这 11 处之前就 return）。
//
// 量的是正文验收：
//   AC2 第 1–4 条  站级那一通四种失败（截断 / API 错 / 解析失败 / 其他）⟹ 建站成功、恰好一条 step=site-plan、页面 = 站级计划那份清单
//   AC2 第 5 条    回包里没有页面 ⟹ 恰好一条 step=site-plan-pages，页面清单换掉、回包里别的字段（tagline）照用
//   AC2 第 6 条    首页 + 一张服务详情页两次都失败 ⟹ 各一条 step=page、块正是骨架页那几块、seo.placeholder、seoPass 没为它们发起重写
//   AC2 第 7 条    整站缺 gallery、补的那一通把首页改出新的逐块问题 ⟹ 丢掉补的那份、首页原样、恰好一条 step=site-blocks（target gallery）
//                  （「补不上、补的那份没改坏」那一支在 create-site-call1-pages.test.js 的 sitefix-no 那一格）
//   AC2 第 8–10 条 关键词页父页补不出 / 代码补的详情页块不合格 / seoPass 之后详情页不见了 ⟹ 恰好一条对应 step、那个服务下的关键词页不在产物里
//                  （这三处按构造很难从输入走到：桩包一层 lib/keyword-pages 的 ensureServiceDetailPages，让它返回那种结果）
//   AC2 第 11 条   在 lib/seo-pass.test.js 的 A' / B / C 三格（同一个 seoPass）
//   AC4            T8 #1600 已在 main ⟹ 降级进 `site/build-report.json` 的 `degraded` 那一格（#1596 r3）。每一跑：那一格 =
//                  create-site.js 攒的 `degradedSteps`（桩在进程退出时把它写出来）= `degraded` 事件，逐条相同、三个字段；
//                  单处失败的跑（第 7 条）里恰好一条；什么都不弄坏的那一跑是 []（不是 null）
//   AC8            主 zh、次 en：一页降级成骨架 / 站级计划失败 ⟹ site/en 照写、页面集合与 site/zh 相同、0 条 secondary-locale-failed；
//                  各带一格单变量反向对照（在临时拷贝里拿掉「第二语言那份由代码拼」那一处 ⟹ 1 条 secondary-locale-failed、没有 site/en）
//   AC9            站级计划那条路不给 email ⟹ 每份 brand.json 都没有 email 键；给了就写那一个值；AI 那条路三臂读数不变
//   AC10           站级计划那条路（en / zh 各一格）：每页 description 在 descriptionRange 内、site-plan 恰好 1 条、没有指向长度的 seo 降级；
//                  阳性对照：首页那句换回改之前的短句 ⟹ 读到一条
//   AC7            第 1–5 条与第 6 条的跑，payload 地点 Calgary, AB、不给营业时间和价位 ⟹ site/ 下全部 JSON 跑事实词正则 0 命中、
//                  没有 openingHours / priceRange；阳性对照两份（DEMO_CONTENT 六个词 · getDemoConfig 那份示例站四个词）
//   构建得出来    #1596 r2 —— 降级产出的站要过 `next build` 的类型检查（QA2 r1 真跑构建抓到：代码拼的站级计划没有 priceRange、
//                  地点没有 address ⟹ TS 报错、预览永远起不来，而上面那些只看 JSON 的格子全绿）。做法：在产物上跑真的 sync-config.js
//                  生成 src/lib/config-data.ts，再用项目自己的 tsconfig 对 src/lib/config.ts 做类型检查 —— 站点数据就是在那里
//                  按 BrandConfig / SeoConfig 断言的（`next build` 报的正是这一处）。站级计划那条路另跑两份 payload（只给地址 /
//                  地点电话邮箱地址全不给），各自的 locations / areaServed 形状不同。带一格阳性对照：把 areaServed 删掉必须读红。
'use strict';

const assert = require('assert');
const cp = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const NEXT = path.resolve(__dirname, '..');
const TEMP = [];
process.on('exit', () => {
  if (process.env.DG_KEEP === '1') { if (TEMP.length) console.log(`📌 DG_KEEP=1 ⟹ 留着 ${TEMP.join(' ')}`); return; }
  for (const d of TEMP) { try { fs.rmSync(d, { recursive: true, force: true }); } catch (e) { /* 打扫不成不改结论 */ } }
});
function die(msg) { console.log(`💥 ${msg}`); process.exit(2); }

let pass = 0;
let fail = 0;
function check(name, fn) {
  try { fn(); pass += 1; console.log(`  ✅ ${name}`); } catch (e) { fail += 1; console.log(`  ❌ ${name}\n     ${e.message}`); }
}

// ── 桩 ────────────────────────────────────────────────────────────────────────────────────────────
function stubMain() {
'use strict';
const Module = require('module');
const fs = require('fs');
const cfg = JSON.parse(fs.readFileSync(process.env.DG_STUB_CFG, 'utf8'));
const seen = {};
globalThis.fetch = async () => { throw new Error('offline (test stub)'); };
const P = cfg.place || '多伦多';
const BODY = `我们在${P}为每一位顾客提供细致的护理与造型服务，预约简单，到店即享专业建议，环境舒适安心，欢迎随时来店体验我们团队带来的放松时光与焕然一新的造型。`;
const DESC_KW = (kw) => `${kw}就在 ${P}：Silky Hair Salon 在${P}为每一位顾客提供细致的${kw}服务，预约简单，到店即享专业建议，环境舒适安心，欢迎随时来店体验焕然一新的造型。`;
// #1601 —— 非首页的块序由整站配方定，写在提示词里（`write exactly these N, in this order: "a" → "b"`）：桩照它回，
//    每种块一份过得了块库的 data（同 create-site-resume.test.js 的桩）。
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
    { type: 'cta', data: { headline: '现在预约', body: '告诉我们您想要的造型。', ctas: [{ label: '预约', href: '/contact', style: 'solid' }] } },
  ];
  if (slug === 'home') {
    return [
      { type: 'hero', data: { headline: title, subheadline: BODY, ctas: [{ label: '预约', href: '/contact', style: 'solid' }] } },
      { type: 'features', data: { headline: '我们的服务', body: '每一项都由资深发型师完成。', items: { source: 'services' } } },
      ...tail,
    ];
  }
  return [{ type: 'page-header', data: { headline: title } }, { type: 'content', data: { headline: `关于${title}`, body: BODY } }, ...tail];
}
function answer(req) {
  const first = req.messages[0].content;
  const turns = req.messages.length;
  const last = req.messages[turns - 1].content;
  const kind = first.includes('Generate a JSON object with this EXACT structure') ? 'site'
    : first.includes('Write the sections of ONE page') ? 'page'
      : first.includes('Write ONE keyword landing page') ? 'keyword'
        : first.includes('An automatic SEO check found the problems') ? 'seo-fix' : 'other';
  const slug = kind === 'page' || kind === 'keyword' ? (first.match(/- slug: "([^"]+)"/) || [])[1] : null;
  if (slug) seen[slug] = (seen[slug] || 0) + 1;
  fs.appendFileSync(process.env.DG_STUB_CALLS, JSON.stringify({ kind, slug, turns }) + '\n');
  if (kind === 'site') {
    // 第 1–4 条：四种失败；第 5 条：回包里没有页面
    if (cfg.site === 'truncated') return { json: cfg.plan, out: 4000, stop: 'max_tokens' };
    if (cfg.site === 'apierror') { const e = new Error('stub: invalid request'); e.status = 400; throw e; }
    // #1597：Anthropic 连续回 429（SDK 自己那 2 次重试已放弃、抛到我们这层的样子）；cfg.retryAfter 给了就带 retry-after 头
    if (cfg.site === 'ratelimited') {
      const e = new Error('429 {"type":"error","error":{"type":"rate_limit_error","message":"stub: rate limited"}}');
      e.status = 429; e.error = { type: 'rate_limit_error' };
      if (cfg.retryAfter) e.headers = new Headers({ 'retry-after': cfg.retryAfter });
      throw e;
    }
    if (cfg.site === 'badjson') return { text: 'this is not json {', out: 10 };
    if (cfg.site === 'other') throw new Error('stub: socket hang up');
    if (cfg.site === 'nopages') return { json: { ...cfg.plan, pages: [] }, out: 4000 };
    return { json: cfg.plan, out: 4000 };
  }
  if (kind === 'page') {
    if ((cfg.failCalls || {})[slug] >= seen[slug]) { const e = new Error(`stub: page ${slug} refused (call ${seen[slug]})`); e.status = 400; throw e; }
    const page = (cfg.plan.pages || []).find((p) => p.slug === slug) || { title: slug };
    let sections = sectionsFor(slug, page.title, first);
    // AC8：有第二语言时回包按语言分组（#1593）—— 第二语言那份 = 同一组块（字都在），页名 / 描述 / 目标词各一句。
    if (first.includes('Respond with ONE JSON object keyed by language code')) {
      const g = { [cfg.primary]: { sections } };
      for (const loc of cfg.secondary) {
        g[loc] = { title: `Page ${slug}`, description: `Page ${slug} of Silky Hair Salon.`, navLabel: `Page ${slug}`, targetKeyword: 'haircut', sections: JSON.parse(JSON.stringify(sections)) };
      }
      return { json: g, out: 3000 };
    }
    // 第 7 条：整站检查之后首页那一通补 —— 'breaks' = 补回来的那份带一个块库不认的块、也没补 gallery
    if (slug === 'home' && turns > 1 && /The website as a whole/.test(last) && cfg.siteFix === 'breaks') {
      sections = [...sections, { type: 'not-a-block', data: {} }];
    }
    // r5（QA2 r4 的 E 臂）：'obeys' = 哪一页被叫去补，就照办补回一块 gallery（数据同 create-site-call1-pages.test.js 的桩）
    if (turns > 1 && /The website as a whole/.test(last) && cfg.siteFix === 'obeys') {
      sections = [...sections, { type: 'gallery', data: { headline: '作品集', items: [1, 2].map((n) => ({ image: { imageUrl: '/images/grid-pattern.svg', alt: '店里完成的一次造型' }, title: `作品 ${'甲乙'[n - 1]}`, caption: '一次造型。' })) } }];
    }
    return { json: { sections }, out: 3000 };
  }
  if (kind === 'keyword') {
    const kw = (first.match(/- target keyword: "([^"]+)"/) || [])[1];
    const sections = [
      { type: 'page-header', data: { headline: `${kw}｜${P}` } },
      { type: 'content', data: { headline: `${kw}怎么做`, body: `${kw}：${BODY}` } },
      { type: 'faq', data: { headline: `${kw}常见问题`, items: [{ question: `${kw}需要预约吗？`, answer: '建议提前预约，也欢迎直接到店。' }] } },
      { type: 'cta', data: { headline: '现在预约', body: '告诉我们您想要的造型。', ctas: [{ label: '预约', href: '/contact', style: 'solid' }] } },
    ];
    return { json: { slug, title: `${kw}｜${P}`, description: DESC_KW(kw), navLabel: kw, navOrder: 50, changeFrequency: 'monthly', priority: 0.6, sections }, out: 2000 };
  }
  if (kind === 'seo-fix') {
    // #1593 字段级修补：回原样那几个字段（= 修不好，第 11 条那一支）
    const m = first.match(/TEXTS TO FIX:\n(\{[\s\S]*?\n\})\n\nPROBLEMS TO FIX/);
    if (!m) throw new Error('修补提示词里没有 TEXTS TO FIX');
    return { json: { fields: JSON.parse(m[1]) }, out: 300 };
  }
  throw new Error('桩不认识这一通调用：' + first.slice(0, 120));
}
class FakeAnthropic {
  constructor() {
    this.messages = {
      stream: (req) => ({
        finalMessage: async () => {
          const a = answer(req);
          return { content: [{ type: 'text', text: a.text !== undefined ? a.text : JSON.stringify(a.json) }], usage: { input_tokens: 100, output_tokens: a.out }, stop_reason: a.stop || 'end_turn' };
        },
      }),
    };
  }
}
FakeAnthropic.default = FakeAnthropic;
FakeAnthropic.Anthropic = FakeAnthropic;
// 第 8–10 条：包一层 ensureServiceDetailPages（create-site.js 每次都按 `kwPages.` 取它）
function ensureHook(real) {
  const T = cfg.ensure.service;
  let n = 0;
  return (opts) => {
    n += 1;
    if (cfg.ensure.mode === 'fail' && n === 1) {
      const r = real({ ...opts, serviceIds: opts.serviceIds.filter((x) => x !== T) });
      return { ...r, failed: [...r.failed, T] };
    }
    // vanish：第二次（seoPass 之后那次）之前先把详情页从页表里拿掉 = 「seoPass 之后不见了」，真函数自己补回来、报 added。
    if (cfg.ensure.mode === 'vanish' && n === 2) {
      const i = opts.pages.findIndex((p) => p.slug === `services/${T}`);
      if (i >= 0) opts.pages.splice(i, 1);
    }
    const r = real(opts);
    if (cfg.ensure.mode === 'badblock' && n === 1) {
      const pg = opts.pages.find((p) => p.slug === `services/${T}`);
      if (pg) (pg.sections || pg.blocks).push({ type: 'not-a-block', data: {} });
    }
    return r;
  };
}
const orig = Module._load;
Module._load = function (request) {
  if (request === '@anthropic-ai/sdk') return FakeAnthropic;
  const m = orig.apply(this, arguments);
  if (cfg.ensure && /lib[\\/]keyword-pages$/.test(request) && !m.__dgWrapped) {
    m.ensureServiceDetailPages = ensureHook(m.ensureServiceDetailPages);
    m.__dgWrapped = true;
  }
  return m;
};
// AC4：进程退出时把 create-site.js 攒的那个数组写出来
process.on('exit', () => {
  // 🔴 不用 require.main：这个桩是 --require 预加载的，它的 require.main 在主模块加载之前就定下了（读出来是 undefined）。
  const main = process.mainModule;
  const arr = main && main.exports && main.exports.degradedSteps;
  fs.writeFileSync(process.env.DG_STUB_ARRAY, JSON.stringify(arr === undefined ? null : arr));
});
}
const STUB = `(${stubMain.toString()})();\n`;

function makeTree(label) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), `dg1596-${label}-`));
  TEMP.push(root);
  const work = path.join(root, 'nextjs');
  cp.execSync(`tar --exclude=./node_modules --exclude=./out --exclude=./.next --exclude=./site --exclude=./public/photos -cf - . | (mkdir -p "${work}" && tar -xf - -C "${work}")`, { cwd: NEXT, stdio: 'pipe' });
  fs.symlinkSync(path.join(NEXT, 'node_modules'), path.join(work, 'node_modules'));
  return work;
}

// ── 输入（同 create-site-call1-pages.test.js：7 个服务、中文）────────────────────────────────────────
const SERVICES = [
  ['cut', '剪发'], ['color', '染发'], ['perm', '烫发'], ['treatment', '护发'],
  ['styling', '造型'], ['scalp', '头皮护理'], ['bridal', '新娘造型'],
];
function plan(place = '多伦多', city = 'Toronto') {
  const DESC = (t) => `${t}：Silky Hair Salon 在${place}为每一位顾客提供细致的护理与造型服务，预约简单，到店即享专业建议，环境舒适安心，欢迎随时来店体验。`;
  const page = (slug, title, navOrder, extra = {}) => ({ slug, title, description: DESC(title), navLabel: title, navOrder,
    changeFrequency: 'monthly', priority: 0.8, brief: `BRIEF<${slug}>：这一页讲${title}。`, ...extra });
  return {
    colorScheme: 'light',
    brand: { tagline: '让头发如丝般顺滑', logoIcon: 'scissors', email: 'hi@silky.test', locations: [{ label: '店面', address: `${city}, AB`, phone: '(403) 555-0199' }] },
    navigation: { ctaLabel: '立即预约', ctaPage: 'contact', footerDescription: `${place}的美发沙龙。` },
    seo: { siteTitle: `Silky Hair Salon ${place}美发`, siteDescription: DESC(`${place}美发`), areaServed: [{ type: 'City', name: city }], addresses: [], offerCatalogName: '服务' },
    services: SERVICES.map(([id, name]) => ({ id, name, shortDescription: `${name}服务`, fullDescription: `${name}，在${place}。`, icon: 'scissors', features: ['细致'], products: [] })),
    forms: [{ id: 'contact', name: '联系', buttonText: '提交', successMessage: '谢谢' }],
    pages: [
      page('home', '首页', 0), page('services', '服务', 1), page('about', '关于我们', 2), page('contact', '联系我们', 3),
      ...SERVICES.map(([id, name], i) => page(`services/${id}`, name, 10 + i, { serviceDetailPage: true, parentService: id })),
    ],
  };
}
const PAYLOAD = (extra = {}) => ({
  siteId: 'dg159601', siteUrl: 'https://silky.test', companyName: 'Silky Hair Salon', industry: 'hair salon', location: 'Toronto, ON',
  language: 'zh', services: SERVICES.map(([, n]) => n), homepageFingerprint: false, ...extra,
});
// AC7：地点 Calgary、不给营业时间和价位
const CALGARY = (extra = {}) => PAYLOAD({ location: 'Calgary, AB', phone: '(403) 555-0199', email: 'hi@silky.test', ...extra });
const KW = { '剪发': [{ keyword: '剪发店', selected: true, volume: 300 }, { keyword: '男士理发', selected: true, volume: 200 }] };

function run(label, payload, cfg) {
  const work = makeTree(label);
  // 反向 / 阳性对照：在这份拷贝的源文件上把一处原样替换掉（默认 create-site.js；必须恰好命中一次，否则这格对照本身不成立）
  for (const [from, to, file = 'create-site.js'] of cfg.mutate || []) {
    const f = path.join(work, 'scripts', file);
    const src = fs.readFileSync(f, 'utf8');
    if (src.split(from).length !== 2) die(`${label}：变异串在 ${file} 里不是恰好一处：${from}`);
    fs.writeFileSync(f, src.replace(from, to));
  }
  const dir = path.dirname(work);
  const stub = path.join(dir, 'stub.js');
  const cfgFile = path.join(dir, 'cfg.json');
  const calls = path.join(dir, 'calls.jsonl');
  const arrFile = path.join(dir, 'degraded.json');
  fs.writeFileSync(stub, STUB);
  fs.writeFileSync(cfgFile, JSON.stringify({ plan: plan(), primary: payload.language || 'zh', secondary: payload.secondaryLocales || [], ...cfg }));
  fs.writeFileSync(calls, '');
  const r = cp.spawnSync(process.execPath, ['--require', stub, path.join(work, 'scripts', 'create-site.js')], {
    input: JSON.stringify(payload), cwd: work, encoding: 'utf8', maxBuffer: 64 << 20, timeout: 300000,
    env: { ...process.env, ANTHROPIC_API_KEY: 'stub-not-used', DG_STUB_CFG: cfgFile, DG_STUB_CALLS: calls, DG_STUB_ARRAY: arrFile },
  });
  if (r.error) die(`${label}：进程没跑起来 ${r.error.message}`);
  const events = (r.stdout || '').split('\n').filter(Boolean).map((l) => { try { return JSON.parse(l); } catch (e) { return { event: '(非 JSON)', raw: l }; } });
  const callList = fs.readFileSync(calls, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
  let array;
  try { array = JSON.parse(fs.readFileSync(arrFile, 'utf8')); } catch (e) { array = undefined; }
  return { work, rc: r.status, stdout: r.stdout || '', stderr: r.stderr || '', events, calls: callList, array,
    error: (events.find((e) => e.event === 'error') || {}).message || '' };
}

const degradedOf = (R, step) => R.events.filter((e) => e.event === 'degraded' && (!step || e.step === step));
const siteJsonFiles = (work) => {
  const out = [];
  const walk = (d) => { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const f = path.join(d, e.name); if (e.isDirectory()) walk(f); else if (e.name.endsWith('.json')) out.push(f); } };
  walk(path.join(work, 'site'));
  return out;
};
const pageSlugs = (work) => {
  const dir = path.join(work, 'site', 'zh', 'pages');
  return siteJsonFiles(work).filter((f) => f.startsWith(dir + path.sep)).map((f) => path.relative(dir, f).replace(/\.json$/, '').split(path.sep).join('/')).sort();
};
const readPage = (R, slug) => JSON.parse(fs.readFileSync(path.join(R.work, 'site', 'zh', 'pages', `${slug}.json`), 'utf8'));
const typesOf = (pg) => (pg.blocks || pg.sections || []).map((b) => b.type);
function assertOk(R) { assert.strictEqual(R.rc, 0, `${R.error}\n${R.stderr.slice(-1200)}`); assert.strictEqual(R.error, ''); }
// AC4：建站报告的 degraded 那一格 = 数组 = 事件，逐条相同（三个字段）
const reportOf = (R) => JSON.parse(fs.readFileSync(path.join(R.work, 'site', 'build-report.json'), 'utf8'));
function assertArrayMatchesEvents(R) {
  assert.ok(Array.isArray(R.array), `degradedSteps 没写出来：${JSON.stringify(R.array)}`);
  assert.deepStrictEqual(R.array, degradedOf(R).map(({ step, target, reason }) => ({ step, target, reason })));
  assert.deepStrictEqual(reportOf(R).degraded, R.array, 'site/build-report.json 的 degraded 那一格跟数组 / 事件对不上');
}

// AC7 的事实词（正文 AC7 原文那条正则）
const FACT_RE = /Northside|North York|OMVIC|\bCAA\b|\b612\b|\b4\.9\b|Demo Street|hello@demo\.com|416-555-0000|Toronto/;
const FACT_RE_G = new RegExp(FACT_RE.source, 'g');
function assertNoBorrowedFacts(R) {
  const all = siteJsonFiles(R.work).map((f) => fs.readFileSync(f, 'utf8')).join('\n');
  assert.deepStrictEqual([...new Set(all.match(FACT_RE_G) || [])], [], '产物里出现了别人的事实');
  const keys = [];
  const scan = (o) => { if (o && typeof o === 'object') for (const [k, v] of Object.entries(o)) { if (k === 'openingHours' || k === 'priceRange') keys.push(k); scan(v); } };
  for (const f of siteJsonFiles(R.work)) scan(JSON.parse(fs.readFileSync(f, 'utf8')));
  assert.deepStrictEqual(keys, [], 'seo.schema 里不该有营业时间 / 价位');
}

// 构建得出来：真 sync-config.js 生成 config-data.ts → 项目 tsconfig 把那 15 个值按 `SiteData` 的字段类型各 `as` 一次再做类型检查。
// 返回诊断（空 = 过）。
// 🔴 #1665 —— 以前检查的就是 `src/lib/config.ts`：它 import config-data.ts 并把每个值 `as` 成声明的类型，所以 next build 的类型检查
//    顺带判了站点数据。现在 config.ts 是纯函数、不再 import 它（站点数据是服务端加载器每次请求读的，next build 看不见）⟹ 那条路
//    对数据恒绿（本票 r1 实测：阳性对照那一格读成 0 条问题）。这里自己写一份同样的 `as`（类型取 `SiteData` 的字段 = 原来那几个
//    cast 的目标类型），量的仍是「这份数据跟组件以为的形状对不对得上」—— 对不上的那一格在真站上是渲染时抛（例：JsonLd 的 `.map`）。
const ts = require('typescript');
const SITE_DATA_KEYS = ['siteId', 'leadApi', 'colorScheme', 'dir', 'defaultLocale', 'locales', 'brand', 'seoByLocale', 'servicesByLocale',
  'formsByLocale', 'navigationByLocale', 'pagesByLocale', 'blogPostsByLocale', 'regions', 'pageLayout'];
function typeProblems(work) {
  const sc = cp.spawnSync(process.execPath, [path.join(work, 'scripts', 'sync-config.js')], { cwd: work, encoding: 'utf8', timeout: 180000 });
  if (sc.status !== 0) return [`sync-config.js rc=${sc.status}：${(sc.stderr || sc.stdout || '').slice(-600)}`];
  const checkFile = path.join(work, 'src', 'lib', 'tmp-site-data-typecheck.ts');
  fs.writeFileSync(checkFile, "import type { SiteData } from './types/config';\nimport * as d from './config-data';\n"
    + `export const checked = {\n${SITE_DATA_KEYS.map((k) => `  ${k}: d.${k} as SiteData['${k}'],`).join('\n')}\n};\n`);
  const conf = ts.parseJsonConfigFileContent(ts.readConfigFile(path.join(work, 'tsconfig.json'), ts.sys.readFile).config, ts.sys, work);
  const prog = ts.createProgram([checkFile], { ...conf.options, incremental: false, noEmit: true });
  return ts.getPreEmitDiagnostics(prog).map((d) => {
    const where = d.file ? `${path.relative(work, d.file.fileName)}:${d.file.getLineAndCharacterOfPosition(d.start).line + 1} ` : '';
    return where + ts.flattenDiagnosticMessageText(d.messageText, ' ').slice(-300);
  });
}
const TYPECHECK = []; // [名字, R] —— 跑完各格之后统一类型检查（每份 ~5 秒，集中在一段里好认）

const SKELETON_FIX_PROMPT = /^SEO (fix|rewrite) (home|services\/perm)\b/; // 第 6 条「没为骨架页发起修补」与 AC10 阳性对照共用
const SVC_IDS = require('./lib/fallback-site').serviceIdsFor(SERVICES.map(([, n]) => n)).map((s) => s.id);
const PLAN_PAGES = ['contact', 'home', 'services', ...SVC_IDS.map((id) => `services/${id}`)].sort();

console.log('══ #1596 付钱之后不再 fatal（打桩，7 服务中文站）══');

// ── AC7 阳性对照：正则不瞎 ───────────────────────────────────────────────────────────────────────────
console.log('── AC7 阳性对照：同一条正则在两份「别人的事实」上各自命中');
check('① DEMO_CONTENT ⟹ Northside · North York · OMVIC · CAA · 612 · 4.9 六个都命中', () => {
  const s = JSON.stringify(require('./lib/demo-content').DEMO_CONTENT);
  const hits = new Set(s.match(FACT_RE_G) || []);
  for (const w of ['Northside', 'North York', 'OMVIC', 'CAA', '612', '4.9']) assert.ok(hits.has(w), `${w} 没命中：${[...hits].join(' · ')}`);
});
{
  // ② getDemoConfig 的等价产物：skipAI 示例站就是 getDemoConfig 写出来的那份
  const work = makeTree('skipai');
  const r = cp.spawnSync(process.execPath, [path.join(work, 'scripts', 'create-site.js')], {
    input: JSON.stringify(CALGARY({ siteId: 'dg15960s', skipAI: true })), cwd: work, encoding: 'utf8', timeout: 120000,
  });
  check('② getDemoConfig（skipAI 示例站的产物）⟹ Demo Street · hello@demo.com · 416-555-0000 · Toronto 四个都命中', () => {
    assert.strictEqual(r.status, 0, (r.stderr || '').slice(-600));
    const all = siteJsonFiles(work).map((f) => fs.readFileSync(f, 'utf8')).join('\n');
    const hits = new Set(all.match(FACT_RE_G) || []);
    for (const w of ['Demo Street', 'hello@demo.com', '416-555-0000', 'Toronto']) assert.ok(hits.has(w), `${w} 没命中：${[...hits].join(' · ')}`);
  });
  check('AC4 反向：skipAI 走不到那 11 步 ⟹ 建站报告的 degraded 那一格仍是 null（没人数过），不是 []', () => {
    const g = JSON.parse(fs.readFileSync(path.join(work, 'site', 'build-report.json'), 'utf8'));
    assert.strictEqual(g.path, 'skipAI');
    assert.strictEqual(g.degraded, null);
  });
}

// ── 第 1–4 条：站级那一通四种失败 ─────────────────────────────────────────────────────────────────────
const SITE_FAILS = [
  ['truncated', 'AI response was truncated'],
  ['apierror', 'AI service error'],
  ['badjson', 'Failed to parse AI response as JSON'],
  ['other', 'AI call failed'],
];
for (const [mode, text] of SITE_FAILS) {
  console.log(`── 第 1–4 条：站级那一通 ${mode}`);
  const R = run(`site-${mode}`, CALGARY(), { site: mode, place: 'Calgary' });
  if (mode === 'truncated') TYPECHECK.push([`第 1–4 条（${mode}，地点 + 电话 + 邮箱，没有地址）`, R]);
  check(`${mode}：建站成功；恰好一条 step=site-plan，reason 里是原来那句「${text}」`, () => {
    assertOk(R);
    const d = degradedOf(R, 'site-plan');
    assert.strictEqual(d.length, 1, JSON.stringify(degradedOf(R)));
    assert.ok(d[0].reason.startsWith(text), d[0].reason);
  });
  check(`${mode}：页面 = 站级计划那份清单（home · services · 每个服务一页 · contact），每页那一通照常调了 AI`, () => {
    assert.deepStrictEqual(pageSlugs(R.work), PLAN_PAGES);
    assert.strictEqual(R.calls.filter((c) => c.kind === 'page').length, PLAN_PAGES.length);
  });
  check(`${mode}：AC7 —— 产物里没有别人的事实，没有营业时间 / 价位；AC4 —— 数组跟事件逐条相同，每条三个字段`, () => {
    assertNoBorrowedFacts(R);
    assertArrayMatchesEvents(R);
    assert.ok(R.array.every((d) => Object.keys(d).sort().join() === 'reason,step,target'));
    // r4（AC10）：站级计划写的 description 本身就落在区间内 ⟹ 不再每页触发一次 SEO 修补、多记一条 seo。
    // r3 这里只许多出 seo 那一族；现在除了那一条 site-plan 什么都没有（降级清单里不会把真正那条淹掉）。
    const other = R.array.filter((d) => d.step !== 'site-plan');
    assert.deepStrictEqual(other, [], R.array.map((d) => `${d.step} | ${d.target}`).join(' · '));
  });
  if (mode === 'badjson') {
    check('badjson：AI 原始回包存在 site/ 外面（site/ 会整个提交进客户的站仓）', () => {
      assert.ok(fs.existsSync(path.join(R.work, '_ai-response.txt')));
      assert.ok(!fs.existsSync(path.join(R.work, 'site', '_ai-response.txt')));
    });
  }
}

// ── #1597：Anthropic 连续 429 ⟹ 退避带抖动 / 照 retry-after，第 3 次失败后那一步降级、建站成功 ─────────────────
// 读的是我们这层（create-site.js §callAIWithRetry）那行 `[ai-retry] … retrying in Nms (why)`，不是 SDK 的。
const retryWaits = (R) => R.stderr.split('\n').filter((l) => l.startsWith('[ai-retry] Call 1 base site API error 429'))
  .map((l) => { const m = l.match(/retrying in (\d+)ms \((backoff|retry-after)\)$/); return m ? { ms: Number(m[1]), why: m[2] } : { bad: l }; });
for (const [label, extra] of [['429 无 retry-after', {}], ['429 带 retry-after: 1', { retryAfter: '1' }]]) {
  console.log(`── #1597：站级那一通 ${label}`);
  const R = run(`ratelimit-${extra.retryAfter ? 'ra' : 'jitter'}`, CALGARY(), { site: 'ratelimited', place: 'Calgary', ...extra });
  check(`${label}：建站成功；恰好一条 step=site-plan（reason 是「AI service error」那句）；站级那一通恰好 3 次（2 次重试后放弃）`, () => {
    assertOk(R);
    const d = degradedOf(R, 'site-plan');
    assert.strictEqual(d.length, 1, JSON.stringify(degradedOf(R)));
    assert.ok(d[0].reason.startsWith('AI service error: 429'), d[0].reason);
    assert.strictEqual(R.calls.filter((c) => c.kind === 'site').length, 3);
    assertArrayMatchesEvents(R);
  });
  const w = retryWaits(R);
  if (extra.retryAfter) {
    check(`${label}：两次都按服务器说的等 1000ms`, () => assert.deepStrictEqual(w, [{ ms: 1000, why: 'retry-after' }, { ms: 1000, why: 'retry-after' }]));
  } else {
    check(`${label}：两次退避带抖动 —— 不是固定的 5000 / 10000，落在 [2500, 7500) · [5000, 15000)`, () => {
      assert.strictEqual(w.length, 2, JSON.stringify(w));
      assert.ok(w.every((x) => x.why === 'backoff'), JSON.stringify(w));
      assert.ok(!(w[0].ms === 5000 && w[1].ms === 10000), JSON.stringify(w));
      assert.ok(w[0].ms >= 2500 && w[0].ms < 7500 && w[1].ms >= 5000 && w[1].ms < 15000, JSON.stringify(w));
    });
  }
}

// ── 第 5 条：回包里没有页面 ─────────────────────────────────────────────────────────────────────────
console.log('── 第 5 条：站级回包里没有页面');
{
  const R = run('nopages', CALGARY(), { site: 'nopages', plan: plan('Calgary', 'Calgary'), place: 'Calgary' });
  TYPECHECK.push(['第 5 条（nopages）', R]);
  check('建站成功；恰好一条 step=site-plan-pages；页面换成站级计划那份清单（服务 id 用回包里的）', () => {
    assertOk(R);
    assert.strictEqual(degradedOf(R, 'site-plan-pages').length, 1, JSON.stringify(degradedOf(R)));
    assert.deepStrictEqual(pageSlugs(R.work), ['contact', 'home', 'services', ...SERVICES.map(([id]) => `services/${id}`)].sort());
  });
  check('回包里别的字段照用：tagline 是 AI 写的那句', () => {
    const brand = JSON.parse(fs.readFileSync(path.join(R.work, 'site', 'brand.json'), 'utf8'));
    assert.ok(JSON.stringify(brand.tagline).includes('让头发如丝般顺滑'), JSON.stringify(brand.tagline));
  });
  check('AC7 / AC4（数组跟事件逐条相同；除 site-plan-pages 那一条外什么都没有，理由同第 1–4 条）', () => {
    assertNoBorrowedFacts(R);
    assertArrayMatchesEvents(R);
    assert.deepStrictEqual(R.array.filter((d) => d.step !== 'site-plan-pages'), [], R.array.map((d) => `${d.step} | ${d.target}`).join(' · '));
  });
}

// ── 第 6 条：首页 + 一张服务详情页两次都失败 ⟹ 骨架页 ─────────────────────────────────────────────────
console.log('── 第 6 条：首页 + services/perm 两次都失败（首页配方是开着的）');
{
  const R = run('skeleton', CALGARY({ homepageFingerprint: true }), { plan: plan('Calgary', 'Calgary'), place: 'Calgary', failCalls: { home: 2, 'services/perm': 2 } });
  TYPECHECK.push(['第 6 条（骨架页）', R]);
  check('前提：这个 siteId 算得出首页配方（AC7 要求首页那格走得到配方那条路）', () => {
    assert.ok(/\[fingerprint\] 首页开场配方 #\d+/.test(R.stderr), R.stderr.split('\n').filter((l) => l.includes('[fingerprint]')).join('\n'));
  });
  check('建站成功；step=page 恰好两条，一页一条（home · services/perm），reason 写明是哪一页', () => {
    assertOk(R);
    const d = degradedOf(R, 'page');
    assert.deepStrictEqual(d.map((x) => x.target).sort(), ['home', 'services/perm']);
    assert.ok(d.every((x) => x.reason.includes(`"${x.target}"`) && /could not be generated after one retry/.test(x.reason)), JSON.stringify(d));
  });
  check('骨架页的块正是规则给的那几块：首页 hero · features · cta · contact（不走配方），服务详情页 page-header · features · cta', () => {
    assert.deepStrictEqual(typesOf(readPage(R, 'home')), ['hero', 'features', 'cta', 'contact']);
    assert.deepStrictEqual(typesOf(readPage(R, 'services/perm')), ['page-header', 'features', 'cta']);
  });
  check('两页都标 seo.placeholder: true；别的页没有', () => {
    assert.strictEqual(readPage(R, 'home').seo.placeholder, true);
    assert.strictEqual(readPage(R, 'services/perm').seo.placeholder, true);
    assert.ok(!(readPage(R, 'services').seo || {}).placeholder); // #1601：配方站没有 about，换同一类的普通页
  });
  check('seoPass 没为骨架页发起修补（没有 SEO fix 提示词，日志「跳过 … 骨架页」各一行）', () => {
    // #1593 起提示词叫「SEO fix <slug>」（以前叫 SEO rewrite —— 只认旧名在今天恒为 0 条，这格会恒绿）。
    // 同一条正则的阳性对照在 AC10 阳性对照那一格（那一跑首页真发了修补，正则读到它）。
    assert.deepStrictEqual(R.events.filter((e) => e.event === 'prompt' && SKELETON_FIX_PROMPT.test(e.name)).map((e) => e.name), []);
    assert.ok(R.stderr.includes('[seo] 跳过 home：骨架页') && R.stderr.includes('[seo] 跳过 services/perm：骨架页'));
  });
  check('骨架页上的按钮只指向本站有的页（这一站有 contact）', () => {
    const hrefs = JSON.stringify(readPage(R, 'home')).match(/"href":"[^"]*"/g);
    assert.deepStrictEqual([...new Set(hrefs)], ['"href":"/contact"']);
  });
  check('AC7：产物里没有别人的事实，没有营业时间 / 价位；AC4：数组跟事件逐条相同', () => { assertNoBorrowedFacts(R); assertArrayMatchesEvents(R); });
}

// ── 第 7 条：补的那一通把首页改出新的逐块问题 ⟹ 丢掉补的那份 ───────────────────────────────────────────
console.log('── 第 7 条：photography 站缺 gallery，补的那一通带回一个块库不认的块');
{
  const R = run('sitefix-breaks', PAYLOAD({ industry: 'photography' }), { siteFix: 'breaks' });
  check('建站成功；恰好一条 step=site-blocks，target 是 gallery', () => {
    assertOk(R);
    const d = degradedOf(R, 'site-blocks');
    assert.strictEqual(d.length, 1, JSON.stringify(degradedOf(R)));
    assert.strictEqual(d[0].target, 'gallery');
  });
  check('首页用的是补之前那份（没有 not-a-block，也没有多出 gallery），日志说了丢掉补的那份', () => {
    assert.deepStrictEqual(typesOf(readPage(R, 'home')), ['hero', 'features', 'faq', 'cta']);
    assert.ok(R.stderr.includes('[blocks] 补的那一通把 home 改出'), R.stderr.split('\n').filter((l) => l.startsWith('[blocks]')).join('\n'));
  });
  check('AC4：site/build-report.json 的 degraded 那一格恰好一条、step / target / reason 三个字段对得上（= 数组 = 事件）', () => {
    assertArrayMatchesEvents(R);
    const g = reportOf(R).degraded;
    assert.strictEqual(g.length, 1, JSON.stringify(g));
    assert.deepStrictEqual(Object.keys(g[0]).sort(), ['reason', 'step', 'target']);
    assert.deepStrictEqual([g[0].step, g[0].target], ['site-blocks', 'gallery']);
    assert.ok(g[0].reason.startsWith('The generated layout still breaks the block library after a retry'), g[0].reason);
  });
}

// ── r5（QA2 r4 打回）：首页降级成骨架页之后，整站补块那一通不许再打在骨架页上 ─────────────────────────────
//    r4 只按 slug 挑首页去补 ⟹ AI 的块顶掉了骨架、`placeholder: true` 却留着 ⟹ seoPass 跳过一页真 AI 首页，降级记录还说「发骨架页」。
//    谓词（QA2 r4 原文）：产物首页「块 == 骨架规则那几块 且 placeholder: true」或「placeholder 不为 true 且 seoPass 查过它」；降级清单对首页的说法与产物一致。
const SKELETON_HOME = ['hero', 'features', 'cta', 'contact'];
const fixCalls = (R) => R.calls.filter((c) => c.kind === 'page' && c.turns > 1).map((c) => c.slug);
const GALLERY_ARMS = [
  ['D', '首页两次都失败 · 补的那一通不补', { failCalls: { home: 2 } }, ['page:home', 'site-blocks:gallery']],
  ['E', '首页两次都失败 · 补的那一通照办', { failCalls: { home: 2 }, siteFix: 'obeys' }, ['page:home']],
  ['F', '对照：什么都不弄坏 · 补的那一通照办', { siteFix: 'obeys' }, []],
];
for (const [arm, what, cfg, want] of GALLERY_ARMS) {
  console.log(`── r5 ${arm}：photography 站缺 gallery，${what}`);
  const R = run(`sitefix-${arm}`, PAYLOAD({ industry: 'photography' }), cfg);
  check(`${arm}：建站成功；降级恰好 ${JSON.stringify(want)}；数组 = 事件 = 报告`, () => {
    assertOk(R);
    assert.deepStrictEqual(degradedOf(R).map((d) => `${d.step}:${d.target}`), want);
    assertArrayMatchesEvents(R);
  });
  const home = readPage(R, 'home');
  if (cfg.failCalls) {
    check(`${arm}：首页仍是骨架页 —— 块 = ${SKELETON_HOME.join(' · ')}、placeholder: true；补的那一通没打在首页上`, () => {
      assert.deepStrictEqual(typesOf(home), SKELETON_HOME);
      assert.strictEqual(home.seo.placeholder, true);
      assert.deepStrictEqual(fixCalls(R), ['services'], '补的那一通应落在第一张不是骨架页的页（services）');
    });
  } else {
    check(`${arm}：首页是 AI 那份、补了 gallery、不是骨架页，seoPass 没跳过它`, () => {
      assert.deepStrictEqual(typesOf(home), ['hero', 'features', 'faq', 'cta', 'gallery']);
      assert.ok(!(home.seo || {}).placeholder);
      assert.deepStrictEqual(fixCalls(R), ['home']);
      assert.ok(!R.stderr.includes('[seo] 跳过 home'));
    });
  }
  if (cfg.siteFix === 'obeys' && cfg.failCalls) {
    check(`${arm}：被叫去补的 services 用了补过那份（多一块 gallery），不是骨架页，seoPass 没跳过它`, () => {
      const pg = readPage(R, 'services');
      assert.strictEqual(typesOf(pg).filter((t) => t === 'gallery').length, 1, typesOf(pg).join(','));
      assert.ok(!(pg.seo || {}).placeholder);
      assert.ok(!R.stderr.includes('[seo] 跳过 services：'));
    });
  }
}
{
  console.log('── r5 G：photography 站缺 gallery，每一页都两次失败（全是骨架页）⟹ 不调 AI 补');
  // #1601 —— 页面清单由配方定（photography → events 组，比 plan() 多一张 faq）⟹ 「每一页」按配方那份数，不按站级回包。
  const recipeSlugs = require('./lib/site-recipe').sitePagesFor('photography', { services: plan().services }).pages.map((p) => p.slug);
  const all = Object.fromEntries(recipeSlugs.map((slug) => [slug, 2]));
  const R = run('sitefix-G', PAYLOAD({ industry: 'photography' }), { failCalls: all, siteFix: 'obeys' });
  TYPECHECK.push(['r5 G（每一页都是骨架页，#1643）', R]);
  check('G：建站成功；没有补的那一通；每页一条 page 降级 + 一条 site-blocks:gallery；首页仍是骨架页', () => {
    assertOk(R);
    assert.deepStrictEqual(fixCalls(R), []);
    assert.strictEqual(degradedOf(R, 'page').length, recipeSlugs.length);
    assert.deepStrictEqual(degradedOf(R, 'site-blocks').map((d) => d.target), ['gallery']);
    assert.deepStrictEqual(typesOf(readPage(R, 'home')), SKELETON_HOME);
    assert.ok(R.stderr.includes('每一页都是骨架页 ⟹ 不补'), R.stderr.split('\n').filter((l) => l.startsWith('[blocks]')).join('\n'));
  });
  // #1643 —— 这一格也进「构建得出来」那段：每一页都是骨架页 ⟹ 产物里没有一页带 targetKeyword。下面这条前提守着它，
  //    免得哪天骨架页带上了目标词、那一格的类型检查就成了空尺子（部分降级的对照是第 6 条那格）。
  check('G：每一页都是 seo.placeholder: true，没有一页带 seo.targetKeyword（「全降级」那一臂的前提）', () => {
    const slugs = pageSlugs(R.work);
    assert.strictEqual(slugs.length, recipeSlugs.length, slugs.join(' · '));
    for (const slug of slugs) {
      const seo = readPage(R, slug).seo || {};
      assert.ok(seo.placeholder === true && !('targetKeyword' in seo), `${slug}：${JSON.stringify(seo)}`);
    }
  });
}

// ── 第 8–10 条：关键词页的父页出问题 ─────────────────────────────────────────────────────────────────
const KW_SLUGS_UNDER_CUT = (R) => {
  const dir = path.join(R.work, 'site', 'zh', 'pages', 'services', 'cut');
  return fs.existsSync(dir) ? fs.readdirSync(dir) : [];
};
const planWithoutCutDetail = () => { const p = plan(); p.pages = p.pages.filter((x) => x.slug !== 'services/cut'); return p; };
const CASES = [
  ['fail', 'keyword-parent', '关键词页的父页面补不出来', plan()],
  ['badblock', 'keyword-parent-blocks', '代码补出来的服务详情页过不了块库检查', planWithoutCutDetail()],
  ['vanish', 'keyword-parent-after-seo', 'seoPass 之后服务详情页不见了', plan()],
];
for (const [mode, step, text, p] of CASES) {
  console.log(`── 第 8–10 条：${mode}（${text}）`);
  // #1601 —— 配方站的服务详情页由配方给（services/cut 一定在）⟹「代码补出来的详情页」那一支只在照抄参照站结构的老路上走得到：
  //    badblock 那一臂勾 structure，页面清单照旧来自站级回包（它拿掉了 services/cut）。
  const ref = mode === 'badblock' ? { refSite: 'https://ref.test', refPrefs: ['structure'], refAnalysis: { navLinks: ['Home', 'Services', 'About', 'Contact'] } } : {};
  const R = run(`kw-${mode}`, PAYLOAD({ keywords: KW, ...ref }), { plan: p, ensure: { mode, service: 'cut' } });
  check(`建站成功；恰好一条 step=${step}，target services/cut，reason 里是「${text}」和「关键词页 0/2」`, () => {
    assertOk(R);
    const d = degradedOf(R, step);
    assert.strictEqual(d.length, 1, JSON.stringify(degradedOf(R)));
    assert.strictEqual(d[0].target, 'services/cut');
    assert.ok(d[0].reason.startsWith(text) && d[0].reason.includes('关键词页 0/2'), d[0].reason);
  });
  check('Call 2 确实建过这个服务下的两页（前提），而它们都不在产物里；keyword-pages 事件报 0/2', () => {
    assert.strictEqual(R.calls.filter((c) => c.kind === 'keyword').length, 2);
    assert.deepStrictEqual(KW_SLUGS_UNDER_CUT(R), []);
    const kw = R.events.find((e) => e.event === 'keyword-pages');
    assert.deepStrictEqual([kw.ok, kw.total], [0, 2]);
  });
  if (mode !== 'fail') {
    check(`${mode}：代码补的那张详情页也不在产物里（块不合格 / 补回来的没过 SEO 检查）`, () => {
      assert.ok(!fs.existsSync(path.join(R.work, 'site', 'zh', 'pages', 'services', 'cut.json')));
    });
  }
  check('AC4：数组跟事件逐条相同', () => assertArrayMatchesEvents(R));
}

// ── 构建得出来：降级产出的站过得了 next build 的类型检查 ────────────────────────────────────────────────
console.log('── 构建得出来（#1596 r2）：站级计划另两份 payload 形状');
{
  // 只给地址（没有电话 / 地点）⟹ locations 只有 address；areaServed 空
  const A = run('site-addr-only', PAYLOAD({ location: undefined, address: '1200 Centre St NE, Calgary, AB', email: 'hi@silky.test' }), { site: 'other', place: 'Calgary' });
  // 地点 / 地址 / 电话 / 邮箱全不给 ⟹ locations 空、areaServed 空
  const B = run('site-bare', PAYLOAD({ location: undefined }), { site: 'other' });
  for (const [name, R, want] of [['只给地址', A, [{ label: 'Main Office', address: '1200 Centre St NE, Calgary, AB' }]], ['什么都不给', B, []]]) {
    check(`${name}：建站成功、恰好一条 site-plan；brand.locations = ${JSON.stringify(want)}、seo.schema.areaServed = []`, () => {
      assertOk(R);
      assert.strictEqual(degradedOf(R, 'site-plan').length, 1, JSON.stringify(degradedOf(R)));
      const brand = JSON.parse(fs.readFileSync(path.join(R.work, 'site', 'brand.json'), 'utf8'));
      assert.deepStrictEqual(brand.locations.map(({ geo, city, streetAddress, postalCode, ...rest }) => rest), want);
      const seo = JSON.parse(fs.readFileSync(path.join(R.work, 'site', 'zh', 'seo.json'), 'utf8'));
      assert.deepStrictEqual(seo.schema.areaServed, []);
      assert.ok(!('priceRange' in seo.schema) && !('openingHours' in seo.schema), JSON.stringify(seo.schema));
    });
    TYPECHECK.push([`站级计划（${name}）`, R]);
  }
}
console.log('── 构建得出来：sync-config.js + 站点数据按 SiteData 的字段类型做类型检查（#1665 以前就是 next build 经 config.ts 判的那一处）');
for (const [name, R] of TYPECHECK) {
  check(`${name}：类型检查 0 条问题`, () => {
    assertOk(R);
    const probs = typeProblems(R.work);
    assert.deepStrictEqual(probs, []);
  });
}
{
  // 阳性对照：同一把尺子在「键不在」的形状上读红 —— 删掉第 1–4 条那棵树 seo.json 里的 areaServed（r1 没写它时就是这样，
  // JsonLd.tsx 的 `.map` 会在构建时抛），必须报出 areaServed。删完还原。
  const R = TYPECHECK[0][1];
  const f = path.join(R.work, 'site', 'zh', 'seo.json');
  const orig = fs.readFileSync(f, 'utf8');
  const doc = JSON.parse(orig);
  delete doc.schema.areaServed;
  fs.writeFileSync(f, JSON.stringify(doc, null, 2));
  let probs;
  try { probs = typeProblems(R.work); } finally { fs.writeFileSync(f, orig); }
  check('阳性对照：删掉 seo.schema.areaServed ⟹ 类型检查读红、问题里点名 areaServed（这把尺子不是恒绿）', () => {
    assert.ok(probs.length > 0 && probs.some((p) => p.includes('areaServed')), JSON.stringify(probs));
  });
}

// ── AC8 一页降级不丢第二语言（主 zh、次 en）──────────────────────────────────────────────────────────
const localeSlugs = (work, loc) => {
  const dir = path.join(work, 'site', loc, 'pages');
  return fs.existsSync(dir) ? siteJsonFiles(work).filter((f) => f.startsWith(dir + path.sep)).map((f) => path.relative(dir, f).replace(/\.json$/, '').split(path.sep).join('/')).sort() : null;
};
const secFailed = (R) => R.events.filter((e) => e.event === 'secondary-locale-failed');
const BILINGUAL = (extra = {}) => CALGARY({ secondaryLocales: ['en'], ...extra });
// 两处「第二语言那份由代码拼」，各自的单变量反向对照（原样拿掉那一处）
const NO_PLACEHOLDER_EN = [' || placeholderPageIn(p);', ';'];
const NO_SITEPLAN_EN = ['    ai.locales = Object.fromEntries(others.map((o) => [o.code, {}]));\n', ''];
const AC8 = [
  // #1601：配方站没有 about ⟹ 换成配方里同一类的普通页 services（骨架同为 page-header · content · cta）
  ['① services 两次都失败 ⟹ 骨架页', { plan: { ...plan('Calgary', 'Calgary'), locales: { en: { tagline: 'Silky-smooth hair' } } }, place: 'Calgary', failCalls: { services: 2 } }, NO_PLACEHOLDER_EN, 'page'],
  ['② 站级计划失败（第 1 条）', { site: 'truncated', place: 'Calgary' }, NO_SITEPLAN_EN, 'site-plan'],
];
for (const [name, cfg, mut, step] of AC8) {
  console.log(`── AC8 ${name}（主 zh、次 en）`);
  const R = run(`ac8-${step}`, BILINGUAL(), cfg);
  check(`${name}：rc=0；恰好一条 step=${step}；site/en 存在、页面 slug 集合与 site/zh 相同；secondary-locale-failed 0 条`, () => {
    assertOk(R);
    assert.strictEqual(degradedOf(R, step).length, 1, JSON.stringify(degradedOf(R)));
    const zh = localeSlugs(R.work, 'zh');
    const en = localeSlugs(R.work, 'en');
    assert.ok(en, 'site/en 不存在');
    assert.deepStrictEqual(en, zh);
    assert.deepStrictEqual(secFailed(R), []);
    assert.ok(R.events.some((e) => e.event === 'secondary-locale-success' && e.locale === 'en'));
  });
  if (step === 'page') {
    check(`${name}：en 那一页也是骨架页（seo.placeholder: true，块跟 zh 那一页相同）`, () => {
      const en = JSON.parse(fs.readFileSync(path.join(R.work, 'site', 'en', 'pages', 'services.json'), 'utf8'));
      assert.strictEqual(en.seo.placeholder, true);
      assert.deepStrictEqual(typesOf(en), typesOf(readPage(R, 'services')));
      assert.deepStrictEqual(typesOf(en), ['page-header', 'content', 'cta']);
    });
  }
  check(`${name}：AC7 —— 两种语言的产物里都没有别人的事实`, () => assertNoBorrowedFacts(R));
  const X = run(`ac8-${step}-rev`, BILINGUAL(), { ...cfg, mutate: [mut] });
  check(`${name} 反向对照：单独拿掉「第二语言那份由代码拼」那一处 ⟹ secondary-locale-failed(en) 1 条、site/en 不存在（主语言照常）`, () => {
    assertOk(X);
    const f = secFailed(X);
    assert.strictEqual(f.length, 1, JSON.stringify(f));
    assert.strictEqual(f[0].locale, 'en');
    assert.strictEqual(localeSlugs(X.work, 'en'), null);
  });
}

// ── AC9 不编邮箱 ─────────────────────────────────────────────────────────────────────────────────
const brandFiles = (work) => siteJsonFiles(work).filter((f) => path.basename(f) === 'brand.json');
const emailsOf = (R) => brandFiles(R.work).map((f) => { const b = JSON.parse(fs.readFileSync(f, 'utf8')); return 'email' in b ? b.email : '(没有这个键)'; });
console.log('── AC9 站级计划那条路：payload 不给 email ⟹ brand.json 没有 email 键；给了就是那一个值');
{
  const R = run('ac9-none', CALGARY({ email: undefined }), { site: 'other', place: 'Calgary' });
  check('不给 email：site/ 下每一份 brand.json 都没有 email 键（不是 info@example.com）', () => {
    assertOk(R);
    assert.strictEqual(degradedOf(R, 'site-plan').length, 1);
    const e = emailsOf(R);
    assert.ok(e.length >= 1, '一份 brand.json 都没找到');
    assert.deepStrictEqual([...new Set(e)], ['(没有这个键)']);
  });
  // 构建得出来：brand.email 这一项不在（#1596 r4 起 BrandConfig.email 是可选项）—— 上面那段统一类型检查已经跑过了，这里单独跑一次
  check('不给 email：类型检查 0 条问题（brand.json 没有 email 键也过得了 next build 判站点数据的那一处）', () => assert.deepStrictEqual(typeProblems(R.work), []));
  const P = run('ac9-given', CALGARY({ email: 'owner@calgary-test.ca' }), { site: 'other', place: 'Calgary' });
  check('阳性对照：给 email: "owner@calgary-test.ca" ⟹ 写的正是这一个值', () => {
    assertOk(P);
    assert.deepStrictEqual([...new Set(emailsOf(P))], ['owner@calgary-test.ca']);
  });
}
console.log('── AC9 旁证（PM 07:03 注记 2）：AI 那条路的三种输入，brand.email 读数不变');
{
  const withAi = run('ai-email-ai', CALGARY({ email: 'payload@calgary-test.ca' }), { place: 'Calgary' });
  const noAi = () => { const p = plan('Calgary', 'Calgary'); delete p.brand.email; return p; };
  const fromPayload = run('ai-email-payload', CALGARY({ email: 'payload@calgary-test.ca' }), { plan: noAi(), place: 'Calgary' });
  const neither = run('ai-email-none', CALGARY({ email: undefined }), { plan: noAi(), place: 'Calgary' });
  check('AI 回包有 email ⟹ 用 AI 的（hi@silky.test）；AI 没有、payload 有 ⟹ payload 的；两者都没有 ⟹ info@example.com（既有兜底，没动）', () => {
    for (const R of [withAi, fromPayload, neither]) { assertOk(R); assert.deepStrictEqual(degradedOf(R, 'site-plan'), []); }
    assert.deepStrictEqual([...new Set(emailsOf(withAi))], ['hi@silky.test']);
    assert.deepStrictEqual([...new Set(emailsOf(fromPayload))], ['payload@calgary-test.ca']);
    assert.deepStrictEqual([...new Set(emailsOf(neither))], ['info@example.com']);
  });
}

// ── AC10 description 不触发 SEO 修补 ───────────────────────────────────────────────────────────────
const { descriptionRange } = require('./lib/description-fit');
// #1549 r4：第 2 条长度报文改成只说底线（「至少 N 字」/「最多 N 字」）—— 旧的「要 N–M 字」这条正则会读 0、让下面两格白绿
const DESC_LEN = /\[2 description\] description \d+ 字，(至少|最多) \d+ 字/;
for (const lang of ['en', 'zh']) {
  console.log(`── AC10 站级计划那条路，主语言 ${lang}`);
  const R = run(`ac10-${lang}`, CALGARY({ language: lang }), { site: 'other', place: 'Calgary' });
  const { min, max } = descriptionRange(lang);
  check(`${lang}：站级计划写出的每一页 description（首页读 seo.siteDescription）长度都在 ${min}–${max}`, () => {
    assertOk(R);
    const seo = JSON.parse(fs.readFileSync(path.join(R.work, 'site', lang, 'seo.json'), 'utf8'));
    const dir = path.join(R.work, 'site', lang, 'pages');
    const lens = siteJsonFiles(R.work).filter((f) => f.startsWith(dir + path.sep)).map((f) => {
      const pg = JSON.parse(fs.readFileSync(f, 'utf8'));
      return [pg.slug || path.basename(f), [...(path.basename(f) === 'home.json' ? seo.siteDescription : pg.description)].length];
    });
    assert.ok(lens.length >= 4, JSON.stringify(lens));
    assert.deepStrictEqual(lens.filter(([, n]) => n < min || n > max), [], JSON.stringify(lens));
  });
  check(`${lang}：step:"site-plan" 恰好 1 条，没有一条 step:"seo" 的 reason 指向 description 长度`, () => {
    assert.strictEqual(degradedOf(R, 'site-plan').length, 1);
    assert.deepStrictEqual(degradedOf(R, 'seo').filter((d) => DESC_LEN.test(d.reason)), [], JSON.stringify(degradedOf(R, 'seo')));
  });
}
{
  // 阳性对照（这条谓词不瞎）：把站级计划里首页那句换成低于底线（英文 40）的短句 ⟹ 首页那条 seo 降级的 reason 命中 DESC_LEN
  //    #1549 r4：改之前那句「<公司> provides professional services in <城市>.」约 50 字，在新底线之上、不再报 ⟹ 换成只有公司名（补完地点也 < 40）
  const short = ['      siteDescription: fittedDescription(`${companyName} provides professional services${loc ? ` in ${loc}` : \'\'}. Learn what we offer and how we work, then get in touch with our team today.`, locale),\n',
    '      siteDescription: `${companyName}.`,\n'];
  check('阳性对照：首页 description 换成低于底线的短句 ⟹ 读到一条 reason 命中 DESC_LEN 的 seo 降级（en）', () => {
    const X = run('ac10-ctl', CALGARY({ language: 'en' }), { site: 'other', place: 'Calgary', mutate: [[short[0], short[1], 'lib/fallback-site.js']] });
    assertOk(X);
    const hits = degradedOf(X, 'seo').filter((d) => DESC_LEN.test(d.reason));
    assert.ok(hits.length >= 1, JSON.stringify(degradedOf(X)));
    // 顺带：第 6 条那格「没有为骨架页发起修补」用的正则在这一跑读得到首页那次修补（它不是恒为 0 的尺子）
    assert.ok(X.events.some((e) => e.event === 'prompt' && SKELETON_FIX_PROMPT.test(e.name)), X.events.filter((e) => e.event === 'prompt').map((e) => e.name).join(' · '));
  });
}

// ── 反向对照：一切正常的一跑没有任何降级 ─────────────────────────────────────────────────────────────
console.log('── 反向对照：同一份输入、什么都不弄坏');
{
  const R = run('clean', PAYLOAD({ keywords: KW }), {});
  check('建站成功，0 条 degraded，数组是空的（不是 undefined —— 数组接上了）；报告那一格是 []（数过了），不是 null', () => {
    assertOk(R);
    assert.deepStrictEqual(degradedOf(R), []);
    assert.deepStrictEqual(R.array, []);
    assert.deepStrictEqual(reportOf(R).degraded, []);
  });
  check('关键词页两页都在（第 8–10 条那几格的「不在产物里」不是恒真）', () => assert.strictEqual(KW_SLUGS_UNDER_CUT(R).length, 2));
}

console.log(`\n══ 汇总: 通过 ${pass} · 失败 ${fail} ══`);
process.exit(fail ? 1 : 0);
