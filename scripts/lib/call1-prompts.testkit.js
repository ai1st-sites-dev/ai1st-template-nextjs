'use strict';
/**
 * call1-prompts.testkit.js —— 测试用：拿到一次建站 Call 1 发出去的**全部**提示词（#1568）。
 *
 * Call 1 拆成「站级一次 + 每页一次」之后，块菜单 / 页面规则 / 首页配方这些字节住在**每页**那几份提示词里，
 * 而每页的提示词要等站级那一通**回来**（页面清单定了）才发得出。以前几份测试拿一把无效 key 让第一次请求被拒、
 * 读那一份 `Base Site` —— 那条路今天只拿得到站级那一份。
 *
 * 这里改用一个桩（`node --require`，同 `create-site-keyword-pages.test.js`）：站级那一通回一份按提示词里的服务现编的
 * 固定页面清单（home / services / about / quote，服务 ≥ 3 个时再加每个服务的详情页 —— 同 `pagesInstruction` 的规矩），
 * 每页那几通一律回 400 ⟹ create-site 先把每页的提示词全部发出去，然后那一页重试一次仍失败、建站退出。不联网、不花钱、不建站。
 *
 * 不是测试文件（文件名不以 `.test.js` 结尾，`test:scripts` 不会把它当一份测试跑）。
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

function stubMain() {
  const Module = require('module');
  const slugify = (s) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  function planFor(prompt) {
    const m = prompt.match(/SERVICES \(use EXACTLY these[^\n]*\n((?:\d+\. [^\n]*(?:\n|$))+)/);
    const names = m ? m[1].trim().split('\n').map((l) => l.replace(/^\d+\.\s*/, '')) : ['General Services'];
    const services = names.map((n, i) => ({ id: slugify(n) || `service-${i + 1}`, name: n, shortDescription: `${n} done right.` }));
    const page = (slug, title, navOrder, extra = {}) => ({ slug, title, description: `${title} — a page of this test site.`, navLabel: title, navOrder, changeFrequency: 'monthly', priority: 0.8, brief: `What ${title} covers.`, ...extra });
    return {
      colorScheme: 'light',
      brand: { tagline: 'Test tagline', logoIcon: 'star', email: 'hi@example.com', locations: [{ label: 'Main', address: 'Toronto', phone: '(416) 555-0100' }] },
      navigation: { ctaLabel: 'Get a quote', ctaPage: 'quote', footerDescription: 'Test footer' },
      seo: { siteTitle: 'Test', siteDescription: 'Test site', areaServed: [], addresses: [], priceRange: '$$', offerCatalogName: 'Services' },
      services,
      forms: [{ id: 'contact', name: 'Contact', buttonText: 'Send', successMessage: 'Thanks' }],
      pages: [
        page('home', 'Home', 0), page('services', 'Services', 1), page('about', 'About', 2), page('quote', 'Quote', 3),
        ...(services.length >= 3 ? services.map((s, i) => page(`services/${s.id}`, s.name, 10 + i, { serviceDetailPage: true, parentService: s.id })) : []),
      ],
    };
  }
  class FakeAnthropic {
    constructor() {
      this.messages = {
        stream: (req) => ({
          finalMessage: async () => {
            const first = req.messages[0].content;
            if (first.includes('Generate a JSON object with this EXACT structure')) {
              return { content: [{ type: 'text', text: JSON.stringify(planFor(first)) }], usage: { input_tokens: 1, output_tokens: 1 }, stop_reason: 'end_turn' };
            }
            const e = new Error('call1-prompts.testkit: page calls are refused on purpose');
            e.status = 400;
            throw e;
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
  globalThis.fetch = async () => { throw new Error('offline (call1-prompts.testkit)'); };
}

/**
 * 在 `root`（一棵含 scripts/ 的模板树）上跑一次 create-site，回 Call 1 的提示词。
 * @returns {{ site: string|null, pages: {name: string, content: string}[], all: string, stderr: string }}
 *   site  = 站级那一份（`Base Site`）；pages = 每页那几份（`Page: <slug>`，发射顺序 = 页面清单顺序）；
 *   all   = site + 全部 pages，按这个顺序用空行接起来（「整份提示词里有没有 X」那类判据读它）。
 */
function call1Prompts(root, payload, { timeout = 180000 } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'call1-prompts-'));
  try {
    const stub = path.join(dir, 'stub.js');
    fs.writeFileSync(stub, `(${stubMain.toString()})();\n`);
    const r = spawnSync(process.execPath, ['--require', stub, path.join(root, 'scripts', 'create-site.js')], {
      input: JSON.stringify(payload),
      env: { ...process.env, ANTHROPIC_API_KEY: 'stub-not-used' },
      encoding: 'utf8',
      maxBuffer: 64 << 20,
      timeout,
    });
    const events = [];
    for (const line of (r.stdout || '').split('\n')) {
      if (!line.trim()) continue;
      try { events.push(JSON.parse(line)); } catch { /* 非事件行 */ }
    }
    const prompts = events.filter((e) => e.event === 'prompt');
    const site = (prompts.find((e) => e.name === 'Base Site') || {}).content || null;
    const pages = prompts.filter((e) => /^Page: /.test(e.name || '')).map((e) => ({ name: e.name, content: e.content }));
    return { site, pages, all: [site || '', ...pages.map((p) => p.content)].join('\n\n'), stderr: r.stderr || '' };
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

module.exports = { call1Prompts };
