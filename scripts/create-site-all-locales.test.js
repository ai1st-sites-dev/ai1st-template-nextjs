#!/usr/bin/env node
// #1593 —— 建站提速三处的验收单测：每页一次产出全部语言 · SEO 字段级修补 · 单页并行 5 · 四个数。
//
// 真 create-site.js 进程，只把 `@anthropic-ai/sdk` 换成按提示词回放的桩（同 #1568 / #1550 的做法）；`fetch` 一律离线。
// 🔴 不是 skipAI：skipAI 在 Call 1 之前就 return，第二语言是逐字复制（`create-site.js` skipAI 那一段），下面每一格在它上面量不出东西。
// 🔴 不调真 AI（#1499）。
//
// 格子名逐条对应正文「agent 的验收项」：
//   AC1 每页一次产出全部语言    主 zh、次 en：没有 translate-secondary-locale；单页调用次数 = 页数；两边页面集合相同、每块 type/options 逐字相同、文案各取各的
//   AC1c 哪些格子取主语言      按「值在块里是什么」判（r2，QA2 打回）：team / testimonials 的 role 是字 ⟹ 取各自那份；颜色槽（featuredColor / bg）
//                               是版式 ⟹ 取主语言，第二语言没写也不算「坏了」；块那一层的 role、引用写法、_sourced 取主语言；块 type 对不上算坏
//   AC1b 整站补块那一通        首页重查的回包也按语言分组：两种语言一起补；en 那份没补 ⟹ 放弃 en、主语言照常
//   AC2 第二语言那份坏了        en 缺字段、重试仍缺 ⟹ 建站成功、site/zh 全在、site/en 不存在、一次 secondary-locale-failed（en）；反向：zh 缺 ⟹ #1596 起是骨架页 + degraded（en 那一页也由代码拼，不丢 en）
//   AC3 第二语言修补仍不合格    en 某页 description 缺目标词、修补回包仍缺 ⟹ 建站成功、这一页照常写进 site/en、日志有这一页没过的记录
//   AC4 字段级修补              description 缺目标词 ⟹ 一次修补、detail 以 SEO fix 开头、提示词无别的块文案、回包只有 description、页面除 description 外不变；
//                               只缺地点 ⟹ 零次修补；中文站提示词里是 50–80 chars
//   AC5 并行 5                  单页调用挂起：同时在飞最多 5、且到过 5
//   #1549 做什么 6           第二语言的 meta description 按它自己的目标区间说：① 读 AC1 真发出去的提示词（主 zh 次 en）② 直接拼 languagesPrompt（主 en 次 zh）
//   AC7 修补不换语言          中文页、英文目标词：桩把 h1 改成纯英文、siteDescription 改成含目标词的中文 ⟹ h1 不采用、siteDescription 采用、日志一行；提示词写明原样嵌进中文句子
//   AC6 四个数                  两次调用各 $0.03 / $0.05、一页字段级修补 ⟹ costUsd 0.08 · seoFixed 1 · pages = 主语言页数 · durationSec > 0
'use strict';

const assert = require('assert');
const cp = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const NEXT = path.resolve(__dirname, '..');
const TEMP = [];
process.on('exit', () => {
  if (process.env.AL_KEEP === '1') { if (TEMP.length) console.log(`📌 AL_KEEP=1 ⟹ 留着 ${TEMP.join(' ')}`); return; }
  for (const d of TEMP) { try { fs.rmSync(d, { recursive: true, force: true }); } catch (e) { /* 打扫不成不改结论 */ } }
});
function die(msg) { console.log(`💥 ${msg}`); process.exit(2); }

let pass = 0;
let fail = 0;
function check(name, fn) {
  try { fn(); pass += 1; console.log(`  ✅ ${name}`); } catch (e) { fail += 1; console.log(`  ❌ ${name}\n     ${e.message}`); }
}

// ── 桩（写成真函数、序列化进 --require 的文件）──────────────────────────────────────────────────────
function stubMain() {
'use strict';
const Module = require('module');
const fs = require('fs');
const cfg = JSON.parse(fs.readFileSync(process.env.AL_CFG, 'utf8'));
const seen = {};
let inflight = 0;
let maxInflight = 0;
// 生图那一家（Nano Banana）回一张假图，只在 payload 带 geminiApiKey 的那几跑才会被问到（AC1d）；其余一律离线。
globalThis.fetch = async (url) => {
  if (String(url).includes('generativelanguage')) {
    return { ok: true, json: async () => ({ candidates: [{ content: { parts: [{ inlineData: { data: Buffer.from('fakejpg').toString('base64') } }] } }] }), text: async () => '' };
  }
  throw new Error('offline (test stub)');
};
const CJK = /[一-鿿]/;
function answer(req) {
  const first = req.messages[0].content;
  const turns = req.messages.length;
  const kind = first.includes('Generate a JSON object with this EXACT structure') ? 'site'
    : first.includes('Write the sections of ONE page') ? 'page'
      : first.includes('An automatic SEO check found the problems') ? 'seo-fix' : 'other';
  const grouped = first.includes('Respond with ONE JSON object keyed by language code');
  const slug = kind === 'page' ? (first.match(/- slug: "([^"]+)"/) || [])[1] : kind === 'seo-fix' ? (first.match(/^PAGE: (.+)$/m) || [])[1] : null;
  // 先记账、再解析：修补提示词形状不对（比如改之前那种整页重写）时，这一通照样记进 calls（不让「零次修补」那格靠桩抛错变绿）。
  const m = kind === 'seo-fix' ? first.match(/TEXTS TO FIX:\n(\{[\s\S]*?\n\})\n\nPROBLEMS TO FIX/) : null;
  const fields = m ? JSON.parse(m[1]) : null;
  const lang = kind === 'seo-fix' ? (CJK.test(fields ? Object.values(fields).join('') : first) ? 'zh' : 'en') : null;
  const key = `${kind}:${lang ? `${lang}:` : ''}${slug || ''}`;
  seen[key] = (seen[key] || 0) + 1;
  fs.appendFileSync(process.env.AL_CALLS, JSON.stringify({ kind, slug, lang, turns, grouped, first, last: req.messages[turns - 1].content, n: seen[key] }) + '\n');
  if (kind === 'site') return { json: cfg.site, out: (cfg.tokens || {}).site || 0 };
  if (kind === 'page') {
    const r = JSON.parse(JSON.stringify(cfg.replies[slug]));
    if (!grouped) return { json: r[cfg.primary], out: 0 };
    // badSecondary[slug] = 第二语言那一份前几次缺 title（缺字段）；badPrimary[slug] = 主语言那一份前几次没有 sections
    for (const loc of cfg.secondary) if ((cfg.badSecondary || {})[slug] >= seen[key]) delete r[loc].title;
    if ((cfg.badPrimary || {})[slug] >= seen[key]) delete r[cfg.primary].sections;
    // siteFix：整站检查之后首页那一通补 gallery（photography 行业必需）—— 两种语言都补；siteFixSecondary === false ⟹ 第二语言那份不补（对不上）
    const last = req.messages[turns - 1].content;
    if (slug === 'home' && cfg.siteFix && turns > 1 && /The website as a whole/.test(last)) {
      const gal = (zh) => ({ type: 'gallery', data: { headline: zh ? '作品集' : 'Our work', items: [1, 2].map((n) => ({ image: { imageUrl: '/images/grid-pattern.svg', alt: zh ? '店里完成的一次造型' : 'A finished look in the salon' }, title: zh ? `作品 ${'甲乙'[n - 1]}` : `Look ${n}`, caption: zh ? '一次造型。' : 'One look.' })) } });
      r[cfg.primary].sections.push(gal(true));
      for (const loc of cfg.secondary) if (cfg.siteFixSecondary !== false) r[loc].sections.push(gal(false));
    }
    return { json: r, out: 0 };
  }
  if (kind === 'seo-fix') {
    if (!fields) throw new Error('修补提示词里没有 TEXTS TO FIX');
    const how = (cfg.fix || {})[`${lang}:${slug}`];
    const out = { ...fields };
    if (how && how.description) for (const k of Object.keys(out)) if (k === 'description' || k === 'siteDescription') out[k] = how.description;
    // how.fields = 按名字换掉回包里的那几格（AC7：把 h1 换成纯英文、把 siteDescription 换成含目标词的中文）
    if (how && how.fields) for (const [k, v] of Object.entries(how.fields)) if (Object.prototype.hasOwnProperty.call(out, k)) out[k] = v;
    return { json: { fields: out }, out: (cfg.tokens || {}).fix || 0 };
  }
  throw new Error('桩不认识这一通调用：' + first.slice(0, 120));
}
class FakeAnthropic {
  constructor() {
    this.messages = {
      stream: (req) => ({
        finalMessage: async () => {
          const isPage = req.messages[0].content.includes('Write the sections of ONE page');
          if (isPage) { inflight += 1; maxInflight = Math.max(maxInflight, inflight); fs.writeFileSync(process.env.AL_MAX, String(maxInflight)); }
          try {
            if (isPage && cfg.delayMs) await new Promise((r) => setTimeout(r, cfg.delayMs));
            const a = answer(req);
            return { content: [{ type: 'text', text: JSON.stringify(a.json) }], usage: { input_tokens: 0, output_tokens: a.out }, stop_reason: 'end_turn' };
          } finally {
            if (isPage) inflight -= 1;
          }
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

function makeTree(label) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), `al-1593-${label}-`));
  TEMP.push(root);
  const work = path.join(root, 'nextjs');
  cp.execSync(`tar --exclude=./node_modules --exclude=./out --exclude=./.next --exclude=./site --exclude=./public/photos -cf - . | (mkdir -p "${work}" && tar -xf - -C "${work}")`, { cwd: NEXT, stdio: 'pipe' });
  fs.symlinkSync(path.join(NEXT, 'node_modules'), path.join(work, 'node_modules'));
  return work;
}

// ── 夹具：中文美发站，主语言 zh（第二语言 en）。每页都按 SEO 八条写合格（目标词在 title / description / H1 / 两个 H2 / 前 100 词）──
const BRAND = 'Silky Hair Salon';
const SERVICES = [['cut', '剪发', 'haircut'], ['color', '染发', 'hair coloring']];
const PAGES = [
  ['home', '首页', 'Home'], ['about', '关于我们', 'About us'], ['quote', '预约', 'Book'], ['reviews', '顾客评价', 'Reviews'],
  ['process', '服务流程', 'How it works'], ['team', '团队', 'Our team'],
  ...SERVICES.map(([id, zh, en]) => [`services/${id}`, zh, en]),
];
// 目标词（create-site 按 T4 分配：首页 = goldIndex 最高那组的主词；服务详情页 = 它那组的主词）
const KW = { home: ['剪发', 'haircut'], 'services/cut': ['剪发', 'haircut'], 'services/color': ['染发', 'hair coloring'] };
const fit = (s, min, max) => { const c = [...s]; assert.ok(c.length >= min && c.length <= max, `夹具 description ${c.length} 字不在 ${min}–${max}：${s}`); return s; };
const DESC = {
  zh: (k, t) => fit(`${k || t}就在多伦多：${BRAND} 为每一位顾客提供细致贴心的服务，预约简单，环境舒适安心，欢迎随时到店体验。`, 50, 80),
  en: (k, t) => fit(`${k || t} in Toronto: ${BRAND} gives every guest careful, friendly service, easy booking and a calm, comfortable place to relax.`, 70, 155),
};
function sections(lang, slug, k, t) {
  const zh = lang === 'zh';
  const h = (s) => (k ? `${k}${zh ? '：' : ': '}${s}` : s);
  const body = zh ? `${k || t}：我们在多伦多为每一位顾客提供细致的护理与造型服务，预约简单，到店即享专业建议，环境舒适安心。`
    : `${k || t}: we give every guest in Toronto careful care and styling, easy booking, expert advice and a calm place to relax.`;
  const tail = [
    { type: 'faq', data: { headline: h(zh ? '常见问题' : 'Questions'), items: [{ question: zh ? '需要预约吗？' : 'Do I need to book?', answer: zh ? '建议提前预约，也欢迎直接到店。' : 'Booking ahead is best, walk-ins are welcome.' }] } },
    { type: 'cta', data: { headline: zh ? '现在预约' : 'Book now', body: zh ? '告诉我们您想要的造型。' : 'Tell us the look you want.', ctas: [{ label: zh ? '预约' : 'Book', href: '/quote', style: 'solid' }] } },
  ];
  if (slug === 'home') {
    return [
      { type: 'hero', data: { headline: k || t, subheadline: body, ctas: [{ label: zh ? '预约' : 'Book', href: '/quote', style: 'solid' }] } },
      { type: 'features', data: { headline: h(zh ? '我们的服务' : 'Our services'), body: zh ? '每一项都由资深发型师完成。' : 'Every service is done by a senior stylist.', items: { source: 'services' } } },
      ...tail,
    ];
  }
  return [{ type: 'page-header', data: { headline: k || t } }, { type: 'content', data: { headline: h(zh ? '怎么做' : 'How we do it'), body } }, ...tail];
}
function fixture({ primary = 'zh', secondary = ['en'], descOf = {} } = {}) {
  const langs = [primary, ...secondary];
  const pageOf = (lang, [slug, zhT, enT]) => {
    const t = lang === 'zh' ? zhT : enT;
    const k = KW[slug] ? KW[slug][lang === 'zh' ? 0 : 1] : '';
    return { title: k ? `${k}｜${t}` : t, description: (descOf[`${lang}:${slug}`]) || DESC[lang](k, t), navLabel: t, k, sections: sections(lang, slug, k, t) };
  };
  const site = {
    colorScheme: 'light',
    brand: { tagline: '让头发如丝般顺滑', logoIcon: 'scissors', email: 'hi@silky.test', locations: [{ label: '店面', address: 'Toronto, ON', phone: '(416) 555-0199' }] },
    navigation: { ctaLabel: '立即预约', ctaPage: 'quote', footerDescription: '多伦多的美发沙龙。' },
    seo: { siteTitle: `剪发｜${BRAND}`, siteDescription: DESC.zh('剪发'), areaServed: [{ type: 'City', name: 'Toronto' }], addresses: [], priceRange: '$$', offerCatalogName: '服务' },
    services: SERVICES.map(([id, zh]) => ({ id, name: zh, shortDescription: `${zh}服务`, fullDescription: `${zh}，在多伦多。`, icon: 'scissors', features: ['细致'], products: [] })),
    forms: [{ id: 'quote', name: '预约', buttonText: '提交', successMessage: '谢谢' }, { id: 'contact', name: '联系', buttonText: '提交', successMessage: '谢谢' }],
    // #1633 —— 主语言不是英文 ⟹ 站级那一通也给主语言的「代码自己写的字」（首页、页脚第一栏标题、代码补的 contact 页）。
    //    不给的话 contact 退回英文、34 字过不了中文 description 50–80 字那条，每一跑多一次修补，下面数修补 / 花费的格子量的就不是本来的事了。
    ...(primary === 'zh' ? {
      homeLabel: '首页', quickLinksTitle: '快速链接',
      contactPage: { title: '联系我们', navLabel: '联系', description: fit(`欢迎联系 ${BRAND}：我们在多伦多为每一位顾客提供细致贴心的美发服务，留下电话或邮件，我们会尽快回复您的预约与问题。`, 50, 80),
        headline: '联系我们', subheadline: '给我们留言，我们会尽快回复。', formHeadline: '与我们取得联系', formBody: '留下您的联系方式，我们会尽快联系您。' },
    } : {}),
    pages: PAGES.map((p, i) => {
      const z = pageOf('zh', p);
      return { slug: p[0], title: z.title, description: z.description, navLabel: z.navLabel, navOrder: p[0].startsWith('services/') ? 10 + i : i,
        changeFrequency: 'monthly', priority: 0.8, brief: `这一页讲${p[1]}。`,
        ...(p[0].startsWith('services/') ? { serviceDetailPage: true, parentService: p[0].slice(9) } : {}) };
    }),
  };
  if (secondary.length) {
    site.locales = Object.fromEntries(secondary.map((loc) => [loc, {
      tagline: 'Silky-smooth hair', ctaLabel: 'Book now', footerDescription: 'A hair salon in Toronto.', homeLabel: 'Home', quickLinksTitle: 'Quick links',
      copyright: `${BRAND}. All rights reserved.`,
      seo: { siteTitle: `Haircut | ${BRAND}`, siteDescription: DESC.en('haircut'), offerCatalogName: 'Services' },
      services: SERVICES.map(([id, , en]) => ({ id, name: en, shortDescription: `${en} service`, fullDescription: `${en} in Toronto.`, features: ['Careful'], products: [] })),
      forms: [{ id: 'quote', name: 'Book', buttonText: 'Send', successMessage: 'Thanks' }, { id: 'contact', name: 'Contact', buttonText: 'Send', successMessage: 'Thanks' }],
      contactPage: { title: 'Contact us', navLabel: 'Contact', description: `Get in touch with ${BRAND}`, headline: 'Contact us', subheadline: 'Send us a message.', formHeadline: 'Get in touch', formBody: 'Leave your details.' },
    }]));
  }
  // 每页回包：{ zh: { sections }, en: { title, description, navLabel, targetKeyword?, sections } }
  const replies = {};
  for (const p of PAGES) {
    replies[p[0]] = {};
    for (const lang of langs) {
      const g = pageOf(lang, p);
      replies[p[0]][lang] = lang === primary ? { sections: g.sections }
        : { title: g.title, description: g.description, navLabel: g.navLabel, ...(g.k ? { targetKeyword: g.k } : {}), sections: g.sections };
    }
  }
  return { primary, secondary, site, replies };
}
const PAYLOAD = (extra = {}) => ({
  siteId: 'al159301', siteUrl: 'https://silky.test', companyName: BRAND, industry: 'hair salon', location: 'Toronto, ON', locationLocalized: '多伦多, 安大略省, 加拿大',
  language: 'zh', secondaryLocales: ['en'], services: SERVICES.map(([, zh]) => zh), homepageFingerprint: false,
  // #1601 —— 页面清单从此由整站配方给（beauty 组没有 about / quote / reviews / process / team），而这份夹具的场景就长在
  //    这几页上（team 的职位、reviews 的顾客身份、about 的颜色槽）。本测试量的是「一次写全部语言」，不是谁挑页：走「照抄
  //    参照站结构」那条仍由 AI 定页面清单的老路（create-site.js §pagesInstruction 的例外），场景一个字不改。配方那条路上的
  //    第二语言由本文件末尾 #1601 那一跑覆盖。
  refSite: 'https://reference.test', refPrefs: ['structure'], refAnalysis: { navLinks: ['Home', 'About', 'Quote', 'Reviews', 'Process', 'Team'] },
  keywords: {
    剪发: [{ keyword: '剪发', isPrimary: true, selected: true, goldIndex: 50, volume: 900 }],
    染发: [{ keyword: '染发', isPrimary: true, selected: true, goldIndex: 20, volume: 300 }],
  },
  ...extra,
});

function run(label, payload, cfg) {
  const work = makeTree(label);
  const dir = path.dirname(work);
  const stub = path.join(dir, 'stub.js');
  const cfgFile = path.join(dir, 'cfg.json');
  const calls = path.join(dir, 'calls.jsonl');
  const maxFile = path.join(dir, 'max.txt');
  fs.writeFileSync(stub, STUB);
  fs.writeFileSync(cfgFile, JSON.stringify(cfg));
  fs.writeFileSync(calls, '');
  fs.writeFileSync(maxFile, '0');
  const r = cp.spawnSync(process.execPath, ['--require', stub, path.join(work, 'scripts', 'create-site.js')], {
    input: JSON.stringify(payload), cwd: work, encoding: 'utf8', maxBuffer: 64 << 20, timeout: 300000,
    env: { ...process.env, ANTHROPIC_API_KEY: 'stub-not-used', AL_CFG: cfgFile, AL_CALLS: calls, AL_MAX: maxFile },
  });
  if (r.error) die(`${label}：进程没跑起来 ${r.error.message}`);
  const events = (r.stdout || '').split('\n').filter(Boolean).map((l) => { try { return JSON.parse(l); } catch (e) { return { event: '(非 JSON)', raw: l }; } });
  const site = path.join(work, 'site');
  const pagesOf = (loc) => {
    const base = path.join(site, loc, 'pages');
    if (!fs.existsSync(base)) return null;
    const out = {};
    (function walk(d, pre) {
      for (const e of fs.readdirSync(d, { withFileTypes: true })) {
        if (e.isDirectory()) walk(path.join(d, e.name), `${pre}${e.name}/`);
        else if (e.name.endsWith('.json')) out[`${pre}${e.name.replace(/\.json$/, '')}`] = JSON.parse(fs.readFileSync(path.join(d, e.name), 'utf8'));
      }
    }(base, ''));
    return out;
  };
  return {
    rc: r.status, stdout: r.stdout || '', stderr: r.stderr || '', events, site, pagesOf,
    calls: fs.readFileSync(calls, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)),
    maxInflight: Number(fs.readFileSync(maxFile, 'utf8')),
    error: (events.find((e) => e.event === 'error') || {}).message || '',
  };
}
const blocksOf = (pg) => pg.blocks || pg.sections || [];
const CJK_RE = /[一-鿿]/;
const N = PAGES.length; // 8

console.log('══ #1593 一次产出全部语言 · 字段级修补 · 并行 5 · 四个数（打桩）══');

// ── AC1 ─────────────────────────────────────────────────────────────────────────────────────────
console.log('── AC1：主 zh、次 en，每页一次调用写两种语言');
const A = run('ac1', PAYLOAD(), fixture());
check('建站成功', () => { assert.strictEqual(A.error, ''); assert.strictEqual(A.rc, 0, A.stderr.slice(-800)); });
check('没有一次调用的 operation 是 translate-secondary-locale（cost 事件 + 提示词里都没有整页翻译）', () => {
  assert.strictEqual(A.events.filter((e) => e.event === 'cost' && e.operation === 'translate-secondary-locale').length, 0);
  assert.ok(!A.calls.some((c) => /You are translating/.test(c.first)));
});
check(`单页调用次数 = 页数（${N}，不是 ${N * 2}），每一通都要两种语言`, () => {
  const pages = A.calls.filter((c) => c.kind === 'page');
  assert.strictEqual(pages.length, N, pages.map((c) => c.slug).join(' '));
  assert.ok(pages.every((c) => c.grouped));
});
const zhA = A.pagesOf('zh') || {};
const enA = A.pagesOf('en') || {};
check('site/en 与 site/zh 页面集合相同', () => {
  assert.ok(Object.keys(zhA).length >= N);
  assert.deepStrictEqual(Object.keys(enA).sort(), Object.keys(zhA).sort());
});
check('每页每块的 type / options 逐字相同', () => {
  for (const slug of Object.keys(zhA)) {
    const z = blocksOf(zhA[slug]); const e = blocksOf(enA[slug]);
    assert.strictEqual(e.length, z.length, slug);
    z.forEach((b, i) => {
      assert.strictEqual(e[i].type, b.type, `${slug} #${i}`);
      assert.deepStrictEqual((e[i].data || {}).options, (b.data || {}).options, `${slug} #${i} options`);
    });
  }
});
check('文案各取各的：zh 页是桩里中文那份、en 页是英文那份（两份故意不同）', () => {
  assert.strictEqual(blocksOf(zhA['services/color'])[1].data.headline, '染发：怎么做');
  assert.strictEqual(blocksOf(enA['services/color'])[1].data.headline, 'hair coloring: How we do it');
  assert.strictEqual(enA.about.title, 'About us');
  assert.strictEqual(enA['services/color'].seo.targetKeyword, 'hair coloring');
  assert.strictEqual(enA['services/color'].seo.translated, true);
  assert.ok(A.events.some((e) => e.event === 'secondary-locale-success' && e.locale === 'en'));
});

// ── AC1c：哪些格子取主语言（r2）──────────────────────────────────────────────────────────────────────
// 料跟 QA2 那份刻意不同：店员 / 顾客身份换了人和词、颜色用渐变 bg + 品牌色 featuredColor、testimonials 带平台 source。
console.log('── AC1c：哪些格子取主语言 —— 按值在块里是什么，不按键名');
const AL = require('./lib/all-locales');
const staff = (zh) => ({ type: 'team', role: 'optional', data: { headline: zh ? '认识我们的发型师' : 'Meet our stylists', members: [
  { name: zh ? '陈静' : 'Jing Chen', role: zh ? '造型总监' : 'Style director', bio: zh ? '擅长中长发层次。' : 'Loves layered mid-length cuts.', links: [{ icon: 'instagram', href: 'https://instagram.com/jing' }] },
  { name: zh ? '赵磊' : 'Lei Zhao', role: zh ? '烫发师' : 'Perm specialist', bio: zh ? '十年烫发经验。' : 'Ten years of perms.' } ] } });
const guests = (zh) => ({ type: 'testimonials', data: { headline: zh ? '老顾客的话' : 'From our regulars', items: [
  { quote: zh ? '每次来都很放松。' : 'Always a relaxing visit.', name: 'Grace', role: zh ? '每月来一次的熟客' : 'Monthly regular', rating: 5, source: 'Google' } ] } });
const plans = (zh, color, bg) => { const d = { headline: zh ? '套餐' : 'Packages', plans: [
  { name: zh ? '护理' : 'Treatment', price: { monthly: zh ? '面议' : 'On request' }, period: zh ? '/ 次' : '/ visit', description: zh ? '深层护理。' : 'Deep treatment.', features: [zh ? '护发' : 'Conditioning'], cta: { label: zh ? '预约' : 'Book', href: '/quote', style: 'solid' }, featured: true, badge: zh ? '推荐' : 'Pick' } ] };
  if (color !== undefined) d.featuredColor = color; if (bg !== undefined) d.bg = bg; return { type: 'pricing', data: d }; };
const put = (cfg, slug, mk) => { for (const lang of Object.keys(cfg.replies[slug])) { const secs = cfg.replies[slug][lang].sections; secs.splice(secs.length - 2, 0, mk(lang === 'zh')); } return cfg; };
const GRAD = { stops: ['#0f172a', '#1e293b'], angle: 135 };
const H = run('ac1c', PAYLOAD(), put(put(put(fixture(), 'team', staff), 'reviews', guests),
  'about', (zh) => plans(zh, zh ? 'brand' : '#dc2626', zh ? GRAD : '#ffffff')));
const zhH = H.pagesOf('zh') || {}; const enH = H.pagesOf('en') || {};
const blk = (pg, t) => blocksOf(pg || {}).find((b) => b.type === t);
check('建站成功、en 没被放弃', () => {
  assert.strictEqual(H.rc, 0, H.stderr.slice(-600));
  assert.deepStrictEqual(H.events.filter((e) => e.event === 'secondary-locale-failed'), []);
});
check('team 的 role（职位）是字：en 页取英文那份，zh 页取中文那份；块那一层的 role 两边都是 optional', () => {
  assert.deepStrictEqual(blk(enH.team, 'team').data.members.map((m) => m.role), ['Style director', 'Perm specialist']);
  assert.deepStrictEqual(blk(zhH.team, 'team').data.members.map((m) => m.role), ['造型总监', '烫发师']);
  assert.strictEqual(blk(enH.team, 'team').role, blk(zhH.team, 'team').role);
  assert.strictEqual(blk(enH.team, 'team').data.members[0].links[0].href, 'https://instagram.com/jing');
});
check('testimonials 的 role（顾客身份）是字、source（平台）取主语言', () => {
  const it = blk(enH.reviews, 'testimonials').data.items[0];
  assert.strictEqual(it.role, 'Monthly regular');
  assert.strictEqual(it.source, 'Google');
});
check('颜色槽取主语言：en 那份写了别的 featuredColor / bg，写盘仍是 zh 那份（brand + 渐变）', () => {
  const e = blk(enH.about, 'pricing').data; const z = blk(zhH.about, 'pricing').data;
  assert.strictEqual(z.featuredColor, 'brand');
  assert.strictEqual(e.featuredColor, 'brand');
  assert.deepStrictEqual(e.bg, GRAD);
  assert.strictEqual(e.plans[0].badge, 'Pick');
});
const H2 = run('ac1c2', PAYLOAD(), put(fixture(), 'about', (zh) => plans(zh, zh ? '#16a34a' : undefined, zh ? GRAD : undefined)));
check('反向：en 那份根本没写颜色槽 ⟹ 不算「坏了」，about 只调一次、en 照常写出、颜色取主语言', () => {
  assert.strictEqual(H2.rc, 0, H2.stderr.slice(-600));
  assert.deepStrictEqual(H2.events.filter((e) => e.event === 'secondary-locale-failed'), []);
  assert.strictEqual(H2.calls.filter((c) => c.kind === 'page' && c.slug === 'about').length, 1);
  const e = blk((H2.pagesOf('en') || {}).about, 'pricing').data;
  assert.strictEqual(e.featuredColor, '#16a34a');
  assert.deepStrictEqual(e.bg, GRAD);
});
check('纯函数：引用写法 / _sourced 取主语言；块 type 对不上算坏、缺职位算坏', () => {
  const z = { type: 'features', data: { headline: '服务', items: { source: 'services' }, _sourced: { items: 'services' } } };
  const m = AL.mergeLocale(z, { type: 'features', data: { headline: 'Services', items: { source: 'pages', under: 'x' } } });
  assert.deepStrictEqual(m.data.items, { source: 'services' });
  assert.deepStrictEqual(m.data._sourced, { items: 'services' });
  assert.strictEqual(m.data.headline, 'Services');
  assert.deepStrictEqual(AL.localeShapeProblems([z], [{ type: 'features', data: { headline: 'Services' } }], 'sections'), []);
  assert.deepStrictEqual(AL.localeShapeProblems([z], [{ type: 'faq', data: { headline: 'Services' } }], 'sections'), ['sections[0]: type "faq", the main language has "features"']);
  const t = staff(true); const e = staff(false); delete e.data.members[1].role;
  assert.deepStrictEqual(AL.localeShapeProblems([t], [e], 'sections'), ['sections[0].data.members[1].role: missing text']);
});
check('manifest 里每一个枚举键（shape 里 `键: "a" | "b"`）都登记在 STRUCT_KEYS（新写枚举忘了登记 ⟹ 这格红）', () => {
  const ms = require('./lib/block-manifest').loadManifests();
  const enums = new Set();
  for (const [, m] of ms) for (const slot of Object.values(m.slots || {})) {
    for (const x of String(slot.shape || '').matchAll(/([A-Za-z_]\w*)\??:\s*"[^"]*"\s*\|/g)) enums.add(x[1]);
  }
  assert.ok(enums.size > 0, '一个枚举键都没读到 —— 正则读不到 shape 了');
  const missing = [...enums].filter((k) => !AL.STRUCT_KEYS.has(k));
  assert.deepStrictEqual(missing, [], `manifest 里的枚举键 ${missing.join(' / ')} 不在 STRUCT_KEYS`);
});

// ── AC1b：整站补块那一通（首页重查）也按语言分组 ──────────────────────────────────────────────────────
console.log('── AC1b：整站缺 gallery ⟹ 首页那一通补一次，两种语言一起补');
const G = run('ac1b', PAYLOAD({ industry: 'photography' }), { ...fixture(), siteFix: true });
check('建站成功；首页那一通补过一次（三轮对话，回显的是两种语言）', () => {
  assert.strictEqual(G.rc, 0, `${G.error}\n${G.stderr.slice(-600)}`);
  const fix = G.calls.filter((c) => c.kind === 'page' && c.slug === 'home' && c.turns === 3);
  assert.strictEqual(fix.length, 1);
  assert.ok(/the same object keyed by language code/.test(fix[0].last), fix[0].last.slice(0, 300));
});
check('两种语言的首页都有 gallery，块的 type 逐个相同，文案各取各的', () => {
  const z = blocksOf((G.pagesOf('zh') || {}).home || {}); const e = blocksOf((G.pagesOf('en') || {}).home || {});
  assert.deepStrictEqual(e.map((b) => b.type), z.map((b) => b.type));
  assert.strictEqual(z.find((b) => b.type === 'gallery').data.headline, '作品集');
  assert.strictEqual(e.find((b) => b.type === 'gallery').data.headline, 'Our work');
});
const G2 = run('ac1b2', PAYLOAD({ industry: 'photography' }), { ...fixture(), siteFix: true, siteFixSecondary: false });
check('反向：补块那一通里 en 那份没补（对不上新的块）⟹ 放弃 en、主语言照常', () => {
  assert.strictEqual(G2.rc, 0, `${G2.error}\n${G2.stderr.slice(-600)}`);
  assert.ok(!fs.existsSync(path.join(G2.site, 'en')));
  assert.deepStrictEqual(G2.events.filter((e) => e.event === 'secondary-locale-failed').map((e) => e.locale), ['en']);
  assert.ok(blocksOf((G2.pagesOf('zh') || {}).home || {}).some((b) => b.type === 'gallery'));
});

// ── AC2 ─────────────────────────────────────────────────────────────────────────────────────────
console.log('── AC1d：图是代码求的、alt 是代码写的（块开了 options.image、两种语言都没写 image 对象）—— 第二语言的 alt 用第二语言写');
// #1593 r3（QA2 r2 打回）：这种 alt 不在任何一份回包里，r2 写盘时退回主语言 ⟹ 英文页上是中文 alt。料跟 QA2 那份刻意不同：
// 首页 hero、没有目标词的 process、有目标词的 services/cut，外加一页（reviews）en 那份自己写了 alt（要原样留着）。
const AC1D = fixture();
for (const slug of ['home', 'process', 'services/cut']) {
  for (const lang of Object.keys(AC1D.replies[slug])) {
    for (const b of AC1D.replies[slug][lang].sections) {
      if (['hero', 'page-header', 'content'].includes(b.type)) b.data.options = { ...(b.data.options || {}), image: 'right' };
    }
  }
}
for (const lang of Object.keys(AC1D.replies.reviews)) {
  const b = AC1D.replies.reviews[lang].sections[0];
  b.data.options = { ...(b.data.options || {}), image: 'right' };
  b.data.image = { imageUrl: '/images/grid-pattern.svg', alt: lang === 'zh' ? '店里的一角' : 'A corner of the salon' };
}
const I = run('ac1d', PAYLOAD({ geminiApiKey: 'stub-not-a-real-key' }), AC1D);
const zhI = I.pagesOf('zh') || {}; const enI = I.pagesOf('en') || {};
/** 一页里带 imageUrl 的图片对象：[{ at, imageUrl, alt }] */
const imagesOf = (pg) => {
  const out = [];
  (function walk(o, at) {
    if (Array.isArray(o)) { o.forEach((x, i) => walk(x, `${at}[${i}]`)); return; }
    if (!o || typeof o !== 'object') return;
    if (typeof o.imageUrl === 'string' && o.imageUrl) out.push({ at, imageUrl: o.imageUrl, alt: o.alt });
    for (const k of Object.keys(o)) walk(o[k], at ? `${at}.${k}` : k);
  }(blocksOf(pg || {}), ''));
  return out;
};
check('建站成功、en 没被放弃', () => {
  assert.strictEqual(I.error, ''); assert.strictEqual(I.rc, 0, I.stderr.slice(-800));
  assert.ok(enI.home, 'site/en 不存在');
});
check('阳性对照：zh 那几页的图确实是代码求的（/photos/…）、alt 是代码写的中文 —— 这一格量得到东西', () => {
  for (const slug of ['home', 'process', 'services/cut']) {
    const imgs = imagesOf(zhI[slug]).filter((x) => x.imageUrl.startsWith('/photos/'));
    assert.ok(imgs.length >= 1, `${slug} 没有代码求的图`);
    for (const x of imgs) assert.ok(CJK_RE.test(x.alt || ''), `${slug} ${x.at} 的 alt 不是中文：${x.alt}`);
  }
});
check('en 页的每一张图：imageUrl 与 zh 同一张、alt 非空且没有汉字', () => {
  for (const slug of Object.keys(zhI)) {
    const z = imagesOf(zhI[slug]); const e = imagesOf(enI[slug]);
    assert.deepStrictEqual(e.map((x) => x.imageUrl), z.map((x) => x.imageUrl), slug);
    for (const x of e) {
      assert.ok(typeof x.alt === 'string' && x.alt.trim(), `${slug} ${x.at} alt 是空的`);
      assert.ok(!CJK_RE.test(x.alt), `${slug} ${x.at} alt 是主语言那句：${x.alt}`);
    }
  }
});
check('en 有目标词的页，第一张内容图的 alt 带翻译过的目标词（首页 / services/cut = haircut）', () => {
  for (const slug of ['home', 'services/cut']) {
    const first = imagesOf(enI[slug]).find((x) => x.imageUrl.startsWith('/photos/'));
    assert.ok(first && /haircut/i.test(first.alt), `${slug}：${first && first.alt}`);
  }
});
check('en 那份自己写了 alt 的图原样留着（reviews：「A corner of the salon」）', () => {
  // 占位图那张会被代码换成真求的图（imageUrl 变成 /photos/…），对象里已有的 alt 留着（§setSlotImageUrl）。
  const at = (pg) => imagesOf(pg).find((y) => y.at === '[0].data.image');
  assert.strictEqual(at(enI.reviews) && at(enI.reviews).alt, 'A corner of the salon');
  assert.strictEqual(at(zhI.reviews) && at(zhI.reviews).alt, '店里的一角');
});
check('这几页不再因为 alt 触发 SEO 修补调用（两种语言都是 0）', () => {
  // 🔴 不按桩的 lang 过滤：桩按「要改的字里有没有汉字」判语言，而 r2 那几通修补要改的正是 en 页上的中文 alt ⟹ 会被记成 zh。
  const fixes = I.calls.filter((c) => c.kind === 'seo-fix' && ['home', 'process', 'services/cut'].includes(c.slug));
  assert.deepStrictEqual(fixes.map((c) => c.slug), []);
});
check('纯函数 mergeLocale：图片对象的 alt —— 第二语言有就取它，没有就留空串（不退回主语言）；别的字照旧退回主语言', () => {
  const p = { type: 'content', data: { headline: '标题', image: { imageUrl: '/photos/a.jpg', alt: '主语言的 alt' } } };
  assert.strictEqual(AL.mergeLocale(p, { type: 'content', data: { headline: 'Title', image: { alt: 'Own alt' } } }).data.image.alt, 'Own alt');
  const m = AL.mergeLocale(p, { type: 'content', data: { headline: 'Title' } });
  assert.strictEqual(m.data.image.alt, '');
  assert.strictEqual(m.data.image.imageUrl, '/photos/a.jpg');
  assert.strictEqual(AL.mergeLocale(p, { type: 'content', data: {} }).data.headline, '标题', '对照：非 alt 的字仍退回主语言');
});

console.log('── AC2：第二语言那一份坏了（重试仍坏）/ 反向：主语言那一份坏了');
const B = run('ac2', PAYLOAD(), { ...fixture(), badSecondary: { about: 2 } });
check('en 缺字段、重试仍缺 ⟹ 建站成功', () => { assert.strictEqual(B.error, ''); assert.strictEqual(B.rc, 0, B.stderr.slice(-800)); });
check('about 这一页被重试过一次（第二轮带着「en 那一份对不上」）', () => {
  const c = B.calls.filter((x) => x.kind === 'page' && x.slug === 'about');
  assert.strictEqual(c.length, 2);
  assert.strictEqual(c[1].turns, 3);
  assert.ok(/the "en" part does not match the "zh" part: title: missing text/.test(c[1].last), c[1].last);
});
check('site/zh 全部页面在，site/en 不存在', () => {
  const z = B.pagesOf('zh') || {};
  assert.ok(PAGES.every(([s]) => z[s]), Object.keys(z).join(' '));
  assert.ok(!fs.existsSync(path.join(B.site, 'en')));
});
check('发了一次 secondary-locale-failed，locale 为 en', () => {
  const f = B.events.filter((e) => e.event === 'secondary-locale-failed');
  assert.strictEqual(f.length, 1);
  assert.strictEqual(f[0].locale, 'en');
  assert.ok(!B.events.some((e) => e.event === 'secondary-locale-success'));
});
const B2 = run('ac2r', PAYLOAD(), { ...fixture(), badPrimary: { about: 2 } });
// 🔴 #1596 有意推翻这一格（PM 2026-10-06 06:47 裁定 #1596 赢、授权改它）：#1593 落地时它断言的是「建站失败、报错是 pageFatal
//    那句」；#1596 第 6 条把那一页改成骨架页 + 一条 degraded，而且 #1596 AC8 要求第二语言那一页也由代码拼（不丢整个 en）。
check('反向：zh 那一份缺 sections、重试仍缺 ⟹ 建站成功，about 是骨架页 + 一条 degraded（#1596 起不再建站失败）', () => {
  assert.strictEqual(B2.error, '');
  assert.strictEqual(B2.rc, 0, B2.stderr.slice(-800));
  const d = B2.events.filter((e) => e.event === 'degraded');
  assert.deepStrictEqual(d.map((x) => [x.step, x.target]), [['page', 'about']], JSON.stringify(d));
  assert.ok(/^Page \d+\/\d+ "about" could not be generated after one retry \(#1568\)/.test(d[0].reason), d[0].reason);
  assert.strictEqual(((B2.pagesOf('zh') || {}).about || {}).seo.placeholder, true);
});
check('反向（#1596 AC8）：第二语言没被放弃 —— site/en 的页面集合 = site/zh，en 的 about 也是骨架页，0 条 secondary-locale-failed', () => {
  const z = B2.pagesOf('zh') || {};
  const e = B2.pagesOf('en') || {};
  assert.deepStrictEqual(Object.keys(e).sort(), Object.keys(z).sort());
  assert.strictEqual(e.about.seo.placeholder, true);
  assert.ok(!B2.events.some((x) => x.event === 'secondary-locale-failed'));
});

// ── AC3 ─────────────────────────────────────────────────────────────────────────────────────────
console.log('── AC3：第二语言修补一次仍不合格 ⟹ 照常发布');
const EN_NO_KW = `${BRAND} in Toronto gives every guest careful, friendly service, easy booking and a calm, comfortable place to relax.`;
const C = run('ac3', PAYLOAD(), fixture({ descOf: { 'en:services/color': EN_NO_KW } }));
check('建站成功', () => { assert.strictEqual(C.error, ''); assert.strictEqual(C.rc, 0, C.stderr.slice(-800)); });
check('en 的 services/color 被修补过一次（回包原样 ⟹ 仍缺目标词）', () => {
  assert.strictEqual(C.calls.filter((x) => x.kind === 'seo-fix' && x.slug === 'services/color' && x.lang === 'en').length, 1);
});
check('这一页照常写进 site/en/', () => {
  const e = C.pagesOf('en') || {};
  assert.ok(e['services/color']);
  assert.strictEqual(e['services/color'].description, EN_NO_KW);
});
check('日志里有这一页这一条没过的记录', () => {
  const line = C.stderr.split('\n').find((l) => l.startsWith('[seo en] 修补一次后仍不合格') && l.includes('services/color'));
  assert.ok(line && line.includes('description 不含目标词「hair coloring」'), C.stderr.split('\n').filter((l) => l.startsWith('[seo en]')).join('\n'));
});
// #1600 建站报告按 slug 合并 seoPass 的逐页结果；第二语言的页跟主语言同 slug ⟹ 那一次绝不能记进报告，否则
// 主语言这一页（没出过问题）的结果会被英文那一页（修补后仍不合格）盖掉。
const reportOf = (R) => JSON.parse(fs.readFileSync(path.join(R.site, 'build-report.json'), 'utf8'));
check('#1600 报告：services/color 记的是主语言那一页（pass，没被修补），不是英文那一页的「修补后仍不合格」', () => {
  const rep = reportOf(C);
  const pg = rep.seo.pages.find((p) => p.slug === 'services/color');
  assert.ok(pg, JSON.stringify(rep.seo.pages.map((p) => p.slug)));
  assert.strictEqual(pg.outcome, 'pass', JSON.stringify(pg));
  assert.strictEqual(pg.rewritten, false);
  assert.strictEqual(rep.repair.rewritten, 0, JSON.stringify(rep.repair));
  // repair.pages 是过了 SEO 检查的主语言页数（#1600 的口径 = seo-check 事件 pages 之和）；#1633 起代码插的 Contact 页也单独过一次检查、算在里面。
  assert.strictEqual(rep.repair.pages, C.events.filter((e) => e.event === 'seo-check').reduce((a, e) => a + e.pages, 0), JSON.stringify(rep.repair));
});

// ── #1549 做什么 6：第二语言的 meta description 按它自己的目标区间说（`lib/all-locales.js` §languagesPrompt 末行）──
// 正文验收「读实际发给 AI 的提示词，单测拼两个方向」：① 读 AC1 那一跑真发出去的单页提示词（主 zh、次 en）；
// ② 主 en、次 zh 这份夹具造不出（页面内容是给中文站写的），直接拼 languagesPrompt。
// 只改 descriptionSpec、不改 all-locales 那一行的实现 ⟹ ① 红（英文那份又是 `same length limits`）；把第二语言写死成英文数字 ⟹ ② 红。
console.log('── #1549 做什么 6：第二语言的 description 长度按各自语言说');
check('① 主 zh、次 en：每一通单页提示词里英文那份写 70–155 characters，不是沿用主语言的 50–80', () => {
  const pages = A.calls.filter((c) => c.kind === 'page');
  assert.ok(pages.length > 0, '一通单页调用都没有 ⟹ 这一格是空的');
  for (const c of pages) {
    assert.ok(c.first.includes('\n- "en" meta description: 70–155 characters.'), c.slug);
    // 改之前那一行是 `… in that language (same length limits).` —— description 也跟着主语言的数走
    assert.ok(!c.first.includes('in that language (same length limits)'), c.slug);
  }
});
check('② 主 en、次 zh：中文那份写 50–80 个汉字；title / navLabel 那半句不动', () => {
  const p = AL.languagesPrompt({ primary: { code: 'en', name: 'English' }, others: [{ code: 'zh', name: 'Chinese' }], kind: 'page' });
  assert.ok(p.includes('\n- "zh" meta description: 50–80 个汉字 (Chinese characters).'), p.slice(-400));
  assert.ok(!p.includes('"zh" meta description: 70–155'), p.slice(-400));
  assert.ok(p.includes('(title and nav label: same length limits)'), p.slice(-400));
});

// ── AC4 ─────────────────────────────────────────────────────────────────────────────────────────
console.log('── AC4：字段级修补（只主语言 zh 的站）');
const ZH_NO_KW = fit(`多伦多的 ${BRAND} 为每一位顾客提供细致贴心的护理服务，预约简单，环境舒适安心，欢迎随时到店体验我们的手艺。`, 50, 80);
const ZH_FIXED = DESC.zh('染发');
const ONE = { secondaryLocales: [] };
const D0 = run('ac4base', PAYLOAD(ONE), fixture({ secondary: [] }));
const D = run('ac4', PAYLOAD(ONE), { ...fixture({ secondary: [], descOf: { 'zh:services/color': ZH_NO_KW } }), fix: { 'zh:services/color': { description: ZH_FIXED } } });
const fixes = D.calls.filter((c) => c.kind === 'seo-fix');
check('两跑都建站成功；对照那一跑零次修补', () => {
  assert.strictEqual(D0.rc, 0, D0.stderr.slice(-600)); assert.strictEqual(D.rc, 0, D.stderr.slice(-600));
  assert.strictEqual(D0.calls.filter((c) => c.kind === 'seo-fix').length, 0);
});
check('description 缺目标词 ⟹ 只发出一次修补调用，detail 以 SEO fix 开头', () => {
  assert.strictEqual(fixes.length, 1, fixes.map((c) => c.slug).join(' '));
  assert.strictEqual(fixes[0].slug, 'services/color');
  const costs = D.events.filter((e) => e.event === 'cost' && /^SEO fix/.test(e.detail));
  assert.strictEqual(costs.length, 1);
  assert.ok(costs[0].detail.startsWith('SEO fix services/color'), costs[0].detail);
});
check('修补提示词只带 description：没有这一页别的块的文案', () => {
  const p = fixes[0].first;
  const texts = JSON.parse(p.match(/TEXTS TO FIX:\n(\{[\s\S]*?\n\})\n\nPROBLEMS TO FIX/)[1]);
  assert.deepStrictEqual(Object.keys(texts), ['description']);
  for (const other of ['染发：怎么做', '染发：常见问题', '现在预约', '需要预约吗', '告诉我们您想要的造型', '我们在多伦多为每一位顾客提供细致的护理']) assert.ok(!p.includes(other), other);
});
check('中文站提示词里的长度是 50–80 个汉字，不是 70–155', () => {
  assert.ok(fixes[0].first.includes('50–80 个汉字') && !fixes[0].first.includes('70–155'));
});
check('目标词跟页面同一种文字（中文「染发」）⟹ 提示词里没有「原样嵌进中文句子」那句（它只给拉丁字母的目标词）', () => {
  assert.ok(!/embed "[^"]+" verbatim inside a sentence/.test(fixes[0].first), fixes[0].first);
});
check('修补后页面除 description 外逐字等于没修补的那一跑；description 是回包那一句', () => {
  const a = (D.pagesOf('zh') || {})['services/color'];
  const b = (D0.pagesOf('zh') || {})['services/color'];
  assert.strictEqual(a.description, ZH_FIXED);
  const { description: _a, ...ra } = a; const { description: _b, ...rb } = b;
  assert.deepStrictEqual(ra, rb);
});
const ZH_NO_PLACE = fit(`染发：${BRAND} 为每一位顾客提供细致贴心的护理服务，预约简单，环境舒适安心，欢迎随时到店体验我们的手艺。`, 50, 80);
const D2 = run('ac4place', PAYLOAD(ONE), fixture({ secondary: [], descOf: { 'zh:services/color': ZH_NO_PLACE } }));
check('description 只缺地点 ⟹ 零次修补调用（由 appendPlace 在检查之前补上）', () => {
  assert.strictEqual(D2.rc, 0, D2.stderr.slice(-600));
  assert.strictEqual(D2.calls.filter((c) => c.kind === 'seo-fix').length, 0);
  assert.ok(D2.stderr.includes('[seo] 补地点 services/color：「多伦多」'));
  assert.ok((D2.pagesOf('zh') || {})['services/color'].description.endsWith('｜多伦多'));
});

// ── AC7 ─────────────────────────────────────────────────────────────────────────────────────────
// 做什么 4（缺陷 site-f764403b）：中文站、首页目标词是英文。修补回包把 h1 换成纯英文、把 siteDescription 换成含目标词的中文
// ⟹ h1 不采用（仍是原来的中文）、siteDescription 采用新值、日志一行「换了语言，不采用」；提示词里写明把词原样嵌进中文句子。
console.log('── AC7：修补不换语言（中文页、英文目标词）');
const KW_EN = 'delivery';
const H1_EN = 'Silky Hair Salon Delivery – Haircuts Brought to Your Door';
const SD_ZH = fit(`${BRAND} 提供 ${KW_EN} 上门剪发：资深发型师为每一位顾客细致护理，预约简单，环境舒适安心。`, 50, 80);
const LG = run('ac7', PAYLOAD({ ...ONE, keywords: { 剪发: [{ keyword: KW_EN, isPrimary: true, selected: true, goldIndex: 50, volume: 900 }], 染发: [{ keyword: '染发', isPrimary: true, selected: true, goldIndex: 20, volume: 300 }] } }),
  { ...fixture({ secondary: [] }), fix: { 'zh:home': { fields: { h1: H1_EN, siteDescription: SD_ZH } } } });
const homeFix = LG.calls.find((c) => c.kind === 'seo-fix' && c.slug === 'home');
const gSeo = (() => { try { return JSON.parse(fs.readFileSync(path.join(LG.site, 'zh', 'seo.json'), 'utf8')); } catch (e) { return null; } })();
const gHome = (LG.pagesOf('zh') || {}).home;
check('建站成功；首页发出过一次修补，送出去的字段里有 h1 和 siteDescription（夹具确实走到了要量的那一步）', () => {
  assert.strictEqual(LG.rc, 0, LG.stderr.slice(-800));
  assert.ok(homeFix, LG.calls.map((c) => `${c.kind}:${c.slug}`).join(' '));
  const texts = JSON.parse(homeFix.first.match(/TEXTS TO FIX:\n(\{[\s\S]*?\n\})\n\nPROBLEMS TO FIX/)[1]);
  assert.ok('h1' in texts && 'siteDescription' in texts, Object.keys(texts).join(' '));
  assert.ok(CJK_RE.test(texts.h1), texts.h1);
});
check('写回后 h1 仍是原来的中文（回包那句纯英文没被采用）', () => {
  const hero = blocksOf(gHome).find((b) => b.type === 'hero');
  assert.ok(hero, JSON.stringify(gHome).slice(0, 300));
  assert.strictEqual(hero.data.headline, '剪发');
  assert.ok(!JSON.stringify(gHome).includes(H1_EN));
});
check('siteDescription 是回包那句新的中文（同一次回包里没换语言的字段照常采用）', () => {
  assert.ok(gSeo, `${LG.site}/zh/seo.json 读不到`);
  // 写回之后 appendPlace 会去掉句末「。」再接「｜多伦多」⟹ 比去掉句末标点的那一段
  assert.ok(String(gSeo.siteDescription).startsWith(SD_ZH.replace(/。$/, '')), gSeo.siteDescription);
});
check('日志一行「[seo] 修补 home.h1 换了语言，不采用」，且 siteDescription 没有这一行', () => {
  assert.ok(LG.stderr.includes('[seo] 修补 home.h1 换了语言，不采用'), LG.stderr.split('\n').filter((l) => l.startsWith('[seo]')).join('\n'));
  assert.ok(!LG.stderr.includes('home.siteDescription 换了语言'));
});
check('提示词：目标词是拉丁字母、页面是中文 ⟹ 写明把「delivery」原样嵌进中文句子、别把字换成英文', () => {
  assert.ok(homeFix.first.includes(`embed "${KW_EN}" verbatim inside a sentence that is still written in Chinese`), homeFix.first);
  assert.ok(homeFix.first.includes('Never rewrite a text into the keyword\'s language'), homeFix.first);
});

// ── AC5 ─────────────────────────────────────────────────────────────────────────────────────────
console.log('── AC5：单页调用挂起，同时在飞的数');
const E = run('ac5', PAYLOAD(ONE), { ...fixture({ secondary: [] }), delayMs: 400 });
check(`同时在飞的单页调用最多 5 个、且确实到过 5 个（${N} 页）`, () => {
  assert.strictEqual(E.rc, 0, E.stderr.slice(-600));
  assert.strictEqual(E.maxInflight, 5);
});

// ── AC6 ─────────────────────────────────────────────────────────────────────────────────────────
console.log('── AC6：四个数');
// haiku-4.5 单价 $1 / $5 每百万：站级那一通 6000 out = $0.03，修补那一通 10000 out = $0.05，别的调用 0 token。
const F = run('ac6', PAYLOAD({ ...ONE, model: 'claude-haiku-4-5' }), {
  ...fixture({ secondary: [], descOf: { 'zh:services/color': ZH_NO_KW } }), fix: { 'zh:services/color': { description: ZH_FIXED } }, tokens: { site: 6000, fix: 10000 },
});
const statsLine = F.stderr.split('\n').find((l) => l.startsWith('[build-stats] ')) || '';
const stats = statsLine ? JSON.parse(statsLine.slice('[build-stats] '.length)) : {};
check('cost 事件恰好两条非零：0.03 和 0.05', () => {
  assert.strictEqual(F.rc, 0, F.stderr.slice(-600));
  assert.deepStrictEqual(F.events.filter((e) => e.event === 'cost' && e.cost > 0).map((e) => e.cost).sort(), [0.03, 0.05]);
});
check('交出去的 costUsd 0.08 · seoFixed 1 · pages = 主语言页数 · durationSec > 0', () => {
  assert.strictEqual(stats.costUsd, 0.08, statsLine);
  assert.strictEqual(stats.seoFixed, 1, statsLine);
  const zh = F.pagesOf('zh') || {};
  assert.strictEqual(stats.pages, Object.keys(zh).length, statsLine);
  assert.ok(typeof stats.durationSec === 'number' && stats.durationSec > 0, statsLine);
});
check('seoFixed 与 seo-check 事件的 rewritten 是同一个数（#1600 从那个键取）', () => {
  const ev = F.events.find((e) => e.event === 'seo-check');
  assert.strictEqual(ev.rewritten, stats.seoFixed);
});
// #1600 先落地了 ⟹ 四个数直接进 site/build-report.json（正文「接线」那一支）。
check('#1600 报告：costUsd 0.08（顶层）· repair.rewritten = seoFixed 1 · repair.pages = 过了 SEO 检查的页数 · durationSec 是整数', () => {
  const rep = reportOf(F);
  assert.strictEqual(rep.costUsd, 0.08, JSON.stringify(rep));
  assert.strictEqual(rep.repair.rewritten, stats.seoFixed);
  // repair.pages = 过了 SEO 检查的页数（#1600 口径）；stats.pages 是写盘时的主语言页数。#1633 之前多出的那一页是写盘时
  // 由代码插的 Contact 页（不过检查）；之后它也单独过一次检查，两个数相等。修补率按前者算：没过检查的页不可能被修补。
  const checked = F.events.filter((e) => e.event === 'seo-check').reduce((a, e) => a + e.pages, 0);
  assert.strictEqual(rep.repair.pages, checked);
  assert.ok(stats.pages - checked <= 1, `${stats.pages} vs ${checked}`);
  assert.ok(Number.isInteger(rep.durationSec) && rep.durationSec >= 0, String(rep.durationSec));
});
check('#1600 报告：被字段级修补救回的那一页 outcome=fixed、rewritten=true；description 那条（第 2 条）是 fixed', () => {
  const pg = reportOf(F).seo.pages.find((p) => p.slug === 'services/color');
  assert.ok(pg);
  assert.strictEqual(pg.outcome, 'fixed', JSON.stringify(pg));
  assert.strictEqual(pg.rewritten, true);
  assert.strictEqual(pg.checks['2'], 'fixed', JSON.stringify(pg.checks));
});

// ── #1601：整站配方那条路上的第二语言 ──────────────────────────────────────────────────────────────────
// 上面各跑都走「照抄参照站结构」那条老路（见 PAYLOAD 的注释）；这一跑不勾它 ⟹ 页面清单与每页块序由 beauty 组配方给。
// 要量的是两件事接得上：配方的预设是在每页那一通【之后】写进主语言块的 options（create-site.js §按配方写预设），
// 而第二语言那一页是写盘时按主语言的块拼出来的（§LocaleBook.build）⟹ en 页必须拿到同一份预设，不是 AI 写的那份、也不是空的。
console.log('── #1601：整站配方 + 第二语言（不勾 structure）');
const SR = require('./lib/site-recipe');
const RP = SR.sitePagesFor('hair salon', { services: SERVICES.map(([id]) => id) });
const RECIPE_TEXT = { services: ['服务', 'Services'], contact: ['联系我们', 'Contact us'] };
function recipeFixture() {
  const cfg = fixture();
  const langs = [cfg.primary, ...cfg.secondary];
  const titleOf = (slug, lang) => {
    const zh = lang === 'zh';
    const svc = SERVICES.find(([id]) => `services/${id}` === slug);
    const t = svc ? (zh ? svc[1] : svc[2]) : RECIPE_TEXT[slug][zh ? 0 : 1];
    const k = KW[slug] ? KW[slug][zh ? 0 : 1] : '';
    return { t, k, title: k ? `${k}｜${t}` : t, description: DESC[lang](k, t), navLabel: t };
  };
  const block = (type, lang, { t, k }) => {
    const zh = lang === 'zh';
    const h = (x) => (k ? `${k}${zh ? '：' : ': '}${x}` : x);
    const body = zh ? `${k || t}：我们在多伦多为每一位顾客提供细致的护理与造型服务，预约简单，到店即享专业建议，环境舒适安心。`
      : `${k || t}: we give every guest in Toronto careful care and styling, easy booking, expert advice and a calm place to relax.`;
    switch (type) {
      case 'page-header': return { type, data: { headline: k || t } };
      case 'content': return { type, data: { headline: h(zh ? '怎么做' : 'How we do it'), body } };
      case 'features': return { type, data: t === RECIPE_TEXT.services[zh ? 0 : 1]
        ? { headline: zh ? '我们的服务' : 'Our services', items: { source: 'services' } }
        : { headline: h(zh ? '亮点' : 'Highlights'), items: [1, 2, 3].map((n) => ({ title: zh ? `亮点${n}` : `Point ${n}`, text: zh ? '每一步都由资深发型师完成。' : 'A senior stylist does every step.' })) } };
      case 'faq': return { type, data: { headline: h(zh ? '常见问题' : 'Questions'), items: [{ question: zh ? '需要预约吗？' : 'Do I need to book?', answer: zh ? '建议提前预约，也欢迎直接到店。' : 'Booking ahead is best, walk-ins are welcome.' }] } };
      case 'cta': return { type, data: { headline: zh ? '现在预约' : 'Book now', body: zh ? '告诉我们您想要的造型。' : 'Tell us the look you want.', ctas: [{ label: zh ? '联系' : 'Contact', href: '/contact', style: 'solid' }] } };
      case 'contact': return { type, data: { headline: zh ? '联系我们' : 'Contact us', body: zh ? '留下联系方式，我们尽快回复。' : 'Leave your details and we will reply soon.', form: { id: 'contact' }, options: { form: 'full' } } };
      default: throw new Error(`夹具没写 ${type}`);
    }
  };
  // 站级回包照旧多列 about / quote / reviews / process / team（AI 不听话的样子），再补上配方要的 services / contact。
  for (const slug of ['services', 'contact']) {
    const z = titleOf(slug, 'zh');
    cfg.site.pages.push({ slug, title: z.title, description: z.description, navLabel: z.navLabel, navOrder: 1, changeFrequency: 'monthly', priority: 0.8, brief: `这一页讲${z.t}。` });
  }
  for (const rp of RP.pages) {
    if (!rp.blocks.length) continue; // 首页不受整站配方锁（#1034 的首页配方管它），回包用上面那份
    cfg.replies[rp.slug] = {};
    for (const lang of langs) {
      const x = titleOf(rp.slug, lang);
      const secs = rp.blocks.map((b) => block(b.type, lang, x));
      cfg.replies[rp.slug][lang] = lang === cfg.primary ? { sections: secs }
        : { title: x.title, description: x.description, navLabel: x.navLabel, ...(x.k ? { targetKeyword: x.k } : {}), sections: secs };
    }
  }
  return cfg;
}
const { refSite: _rs, refPrefs: _rp, refAnalysis: _ra, ...NO_REF } = PAYLOAD();
const RG = run('recipe-locales', NO_REF, recipeFixture());
const zhR = RG.pagesOf('zh') || {}; const enR = RG.pagesOf('en') || {};
const recipeSlugs = RP.pages.map((p) => p.slug).sort();
check('建站成功、en 没被放弃（走的是配方那条路）', () => {
  assert.strictEqual(RG.rc, 0, RG.stderr.slice(-800));
  assert.deepStrictEqual(RG.events.filter((e) => e.event === 'secondary-locale-failed'), []);
  assert.ok(RG.stderr.includes('[recipe] 整站配方（beauty）'), RG.stderr.slice(-800));
});
check(`单页调用 = 配方页数（${RP.pages.length}），每一通都要两种语言；回包里配方外的页一张没调`, () => {
  const pages = RG.calls.filter((c) => c.kind === 'page');
  assert.deepStrictEqual(pages.map((c) => c.slug).sort(), recipeSlugs);
  assert.ok(pages.every((c) => c.grouped));
});
check('site/zh 与 site/en 的页面集合相同，且都是配方那一份（about / quote / team 一张没有）', () => {
  const kwOnly = (o) => Object.keys(o).filter((k) => !recipeSlugs.includes(k));
  assert.deepStrictEqual(Object.keys(enR).sort(), Object.keys(zhR).sort());
  for (const slug of recipeSlugs) assert.ok(zhR[slug] && enR[slug], slug);
  for (const extra of kwOnly(zhR)) assert.ok(zhR[extra].keywordPage || /^services\/[^/]+\/./.test(extra), `配方外的页 ${extra}`);
});
check('en 页的块序 = 配方；每块的 options 跟 zh 逐字相同，且含配方预设的旋钮（预设跟到了第二语言）', () => {
  const manifests = require('./lib/block-manifest').loadManifests();
  let knobbed = 0;
  for (const rp of RP.pages) {
    if (!rp.blocks.length) continue;
    const z = blocksOf(zhR[rp.slug]); const e = blocksOf(enR[rp.slug]);
    assert.deepStrictEqual(e.map((b) => b.type), rp.blocks.map((b) => b.type), rp.slug);
    rp.blocks.forEach((_, i) => {
      assert.deepStrictEqual((e[i].data || {}).options, (z[i].data || {}).options, `${rp.slug} #${i}`);
    });
    // 期望的旋钮 = 同一个 applyPresets 在空块上写出来的那份（预设名 → 旋钮的解析不在这里重抄）
    const probe = rp.blocks.map((b) => ({ type: b.type, data: {} }));
    SR.applyPresets(probe, rp.blocks, manifests);
    probe.forEach((p, i) => {
      for (const [k, v] of Object.entries((p.data && p.data.options) || {})) {
        assert.deepStrictEqual(((e[i].data || {}).options || {})[k], v, `${rp.slug} #${i} ${p.type} 旋钮 ${k}`);
        knobbed += 1;
      }
    });
  }
  assert.ok(knobbed > 0, '一个预设旋钮都没量到 ⟹ 这一格是空的');
});
check('两种语言的顶部导航都到得了服务列表页、按钮都指 contact（配方的导航与按钮跟到了第二语言）', () => {
  for (const loc of ['zh', 'en']) {
    const nav = JSON.parse(fs.readFileSync(path.join(RG.site, loc, 'navigation.json'), 'utf8'));
    assert.deepStrictEqual(nav.header.links.map((l) => l.href), ['/', '/services'], loc);
    assert.strictEqual(nav.header.cta.href, '/contact', loc);
  }
});
check('文案各取各的：en 的服务页是英文那份', () => {
  assert.strictEqual(blocksOf(enR['services/color'])[1].data.headline, 'hair coloring: How we do it');
  assert.strictEqual(blocksOf(zhR['services/color'])[1].data.headline, '染发：怎么做');
  assert.strictEqual(enR.contact.title, 'Contact us');
});

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
