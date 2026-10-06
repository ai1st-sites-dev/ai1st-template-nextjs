#!/usr/bin/env node
// #1618 —— AI 回的 JSON 本地修不好时，先交给 AI「只修语法」一次，再整份重写一次，再降级。
// 真 create-site.js 进程，只把 `@anthropic-ai/sdk` 换成按脚本回放的桩（同 create-site-call1-pages.test.js 的做法）。
//
//   跑法:  node scripts/create-site-json-repair.test.js   （或 `npm run test:scripts`，它按文件名发现）
//   退出码: 0 全过 · 1 有失败 · 2 跑不起来（**不许当成通过**）
//
// 🔴 不调真 AI（#1499）。被测的是 `callAIWithRetry`，五个调用方共用它；这里拿站级那一通（Call 1 base site）当入口，
//    因为它失败时走的是 #1596 的 `degrade('site-plan')` 那条降级、不会再被外层重试一遍 ⟹ 请求序列就是 callAIWithRetry 自己发的那几条。
// 🔴 桩只认站级那一族（原始 / 修复 / 重写），按 cfg.site 的顺序回；其余每一通（每页、关键词页、SEO）一律回 400
//    ⟹ 每页发骨架页（#1596），建站照样成功。这些格子不看页面，只看站级那几条请求。
//
// 量的是正文验收：
//   AC2 只修不重写   原始回「jsonrepair 也修不好」的坏 JSON、修复回好的 ⟹ 用上修复的结果；修复提示词含整份坏 JSON + 出错位置、
//                   不含原来的长提示词；只有「原始 → 修复」两条
//   AC3 兜底顺序     修复也坏、重写好 ⟹ 用重写的；三条都坏 ⟹ 降级、序列是这三条、没有第四条
//   AC4 记账         [json-repair 1] / [retry N] 分开记
//   另：本地修得好的坏 JSON 只发一条（对照）；修复那次撞 max_tokens ⟹ 当作没修好、走重写（jsonrepair 会把截断补成「合法」）
'use strict';

const assert = require('assert');
const cp = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const NEXT = path.resolve(__dirname, '..');
const TEMP = [];
process.on('exit', () => {
  if (process.env.JR_KEEP === '1') { if (TEMP.length) console.log(`📌 JR_KEEP=1 ⟹ 留着 ${TEMP.join(' ')}`); return; }
  for (const d of TEMP) { try { fs.rmSync(d, { recursive: true, force: true }); } catch (e) { /* 打扫不成不改结论 */ } }
});
function die(msg) { console.log(`💥 ${msg}`); process.exit(2); }
if (!fs.existsSync(path.join(NEXT, 'node_modules', 'jsonrepair'))) die('node_modules 里没有 jsonrepair（软链到不完整的共享安装？）—— 先在这棵树 npm ci');

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
const cfg = JSON.parse(fs.readFileSync(process.env.JR_STUB_CFG, 'utf8'));
let siteN = 0;
globalThis.fetch = async () => { throw new Error('offline (test stub)'); };
function answer(req) {
  const first = req.messages[0].content;
  const kind = first.startsWith('The text below was supposed to be one valid JSON document') ? 'repair'
    : first.includes('Generate a JSON object with this EXACT structure') ? 'site' : 'other';
  fs.appendFileSync(process.env.JR_STUB_CALLS, JSON.stringify({ kind, turns: req.messages.length, max_tokens: req.max_tokens, first, last: req.messages[req.messages.length - 1].content }) + '\n');
  if (kind === 'other') { const e = new Error('stub: not the call under test'); e.status = 400; throw e; }
  const step = cfg.site[siteN++];
  if (!step) throw new Error(`桩：站级那一族的第 ${siteN} 条请求不在脚本里（脚本只有 ${cfg.site.length} 条）`);
  return step;
}
class FakeAnthropic {
  constructor() {
    this.messages = {
      stream: (req) => ({
        finalMessage: async () => {
          const a = answer(req);
          return { id: 'msg_stub', type: 'message', role: 'assistant', model: req.model, content: [{ type: 'text', text: a.text }],
            stop_reason: a.stop || 'end_turn', stop_sequence: null, usage: { input_tokens: 100, output_tokens: a.out || 4000 } };
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
  const root = fs.mkdtempSync(path.join(os.tmpdir(), `json-repair-${label}-`));
  TEMP.push(root);
  const work = path.join(root, 'nextjs');
  cp.execSync(`tar --exclude=./node_modules --exclude=./out --exclude=./.next --exclude=./site --exclude=./public/photos -cf - . | (mkdir -p "${work}" && tar -xf - -C "${work}")`, { cwd: NEXT, stdio: 'pipe' });
  fs.symlinkSync(path.join(NEXT, 'node_modules'), path.join(work, 'node_modules'));
  return work;
}

// ── 站级回包 ──────────────────────────────────────────────────────────────────────────────────────
const TAGLINE = 'TAGLINE-FROM-AI-1618';
const DESC = (t) => `${t}：Silky Hair Salon 在多伦多为每一位顾客提供细致的护理与造型服务，预约简单，到店即享专业建议，环境舒适安心，欢迎随时来店体验。`;
const PLAN = {
  colorScheme: 'light',
  brand: { tagline: TAGLINE, logoIcon: 'scissors', email: 'hi@silky.test', locations: [{ label: '店面', address: 'Toronto, ON', phone: '(416) 555-0199' }] },
  navigation: { ctaLabel: '立即预约', ctaPage: 'contact', footerDescription: '多伦多的美发沙龙。' },
  seo: { siteTitle: 'Silky Hair Salon 多伦多美发', siteDescription: DESC('多伦多美发'), areaServed: [{ type: 'City', name: 'Toronto' }], addresses: [], priceRange: '$$', offerCatalogName: '服务' },
  services: [{ id: 'cut', name: '剪发', shortDescription: '剪发服务', fullDescription: '剪发，在多伦多。', icon: 'scissors', features: ['细致'], products: [] }],
  forms: [{ id: 'contact', name: '联系', buttonText: '提交', successMessage: '谢谢' }],
  pages: [
    { slug: 'home', title: '首页', description: DESC('首页'), navLabel: '首页', navOrder: 0, changeFrequency: 'monthly', priority: 1, brief: '首页' },
    { slug: 'contact', title: '联系我们', description: DESC('联系我们'), navLabel: '联系我们', navOrder: 4, changeFrequency: 'monthly', priority: 0.8, brief: '联系' },
  ],
};
const GOOD = JSON.stringify(PLAN, null, 2);
// 「jsonrepair 也修不好」的那一类（#1618 AC1 / PM 2026-10-06 18:37 量出来的形状）：模型中途道歉、又重发一份。
const UNFIXABLE = `${GOOD}\n\n抱歉，上面漏了一个字段，完整的是：\n${GOOD}`;
// 本地修得好的那一类（事故原形：中文文案里没转义的引号）
const FIXABLE = GOOD.replace(`"footerDescription": "多伦多的美发沙龙。"`, `"footerDescription": "多伦多的"专业"美发沙龙。"`);
const ok = (text) => ({ text });

const PAYLOAD = { siteId: 'jr160001', siteUrl: 'https://silky.test', companyName: 'Silky Hair Salon', industry: 'hair salon', location: 'Toronto, ON',
  language: 'zh', services: ['剪发'], homepageFingerprint: false };

function run(label, site) {
  const work = makeTree(label);
  const dir = path.dirname(work);
  const stub = path.join(dir, 'stub.js');
  const cfgFile = path.join(dir, 'cfg.json');
  const calls = path.join(dir, 'calls.jsonl');
  fs.writeFileSync(stub, STUB);
  fs.writeFileSync(cfgFile, JSON.stringify({ site }));
  fs.writeFileSync(calls, '');
  const r = cp.spawnSync(process.execPath, ['--require', stub, path.join(work, 'scripts', 'create-site.js')], {
    input: JSON.stringify(PAYLOAD), cwd: work, encoding: 'utf8', maxBuffer: 64 << 20, timeout: 300000,
    env: { ...process.env, ANTHROPIC_API_KEY: 'stub-not-used', JR_STUB_CFG: cfgFile, JR_STUB_CALLS: calls, AI_RAW_DIR: path.join(dir, 'ai-raw') },
  });
  if (r.error) die(`${label}：进程没跑起来 ${r.error.message}`);
  const events = (r.stdout || '').split('\n').filter(Boolean).map((l) => { try { return JSON.parse(l); } catch (e) { return { event: '(非 JSON)', raw: l }; } });
  const all = fs.readFileSync(calls, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
  const siteCalls = all.filter((c) => c.kind !== 'other');
  const costs = events.filter((e) => e.event === 'cost' && /^Base site/.test(e.detail || '')).map((e) => e.detail);
  const tagline = (() => { try { const t = JSON.parse(fs.readFileSync(path.join(work, 'site', 'brand.json'), 'utf8')).tagline; return t && typeof t === 'object' ? t.zh : t; } catch (e) { return undefined; } })();
  return { rc: r.status, stderr: r.stderr || '', events, siteCalls, costs, tagline,
    error: (events.find((e) => e.event === 'error') || {}).message || '',
    sitePlanDegraded: events.filter((e) => e.event === 'degraded' && e.step === 'site-plan') };
}
const seq = (R) => R.siteCalls.map((c) => (c.kind === 'site' ? (c.turns === 1 ? '原始' : '重写') : '修复')).join(' → ');
const built = (R) => { assert.strictEqual(R.error, '', R.error); assert.strictEqual(R.rc, 0, R.stderr.slice(-800)); };

console.log('══ #1618 坏 JSON：本地修 → AI 只修语法 → 重写 → 降级（打桩）══');

// 前提：夹具真是它自称的那一类（不然下面每一格都可能恒绿）
const { validateAiJson } = require(path.join(NEXT, 'scripts', 'lib', 'ai-json'));
check('夹具：UNFIXABLE 本地修不好、FIXABLE 本地修得好、GOOD 合法', () => {
  assert.strictEqual(validateAiJson(UNFIXABLE).ok, false);
  const f = validateAiJson(FIXABLE); assert.ok(f.ok && f.repaired);
  const g = validateAiJson(GOOD); assert.ok(g.ok && !g.repaired);
});

// ── 对照：本地修得好 ⟹ 一条 ─────────────────────────────────────────────────────────────────────
console.log('── 对照：原始那次本地修得好');
const L = run('local', [ok(FIXABLE)]);
check('对照：只有「原始」一条，用上的是它；日志写「本地修好」', () => {
  built(L);
  assert.strictEqual(seq(L), '原始');
  assert.strictEqual(L.tagline, TAGLINE);
  assert.ok(/本地修好（jsonrepair）/.test(L.stderr), '日志里没有「本地修好」');
});

// ── AC2 ──────────────────────────────────────────────────────────────────────────────────────────
console.log('── AC2：原始坏（本地修不好）、修复好');
const A = run('repair-ok', [ok(UNFIXABLE), ok(GOOD)]);
check('AC2：建站成功，用上的是修复回来的那份（tagline 来自它、站级没降级）', () => {
  built(A);
  assert.strictEqual(A.tagline, TAGLINE);
  assert.deepStrictEqual(A.sitePlanDegraded, []);
});
check('AC2：请求序列 = 原始 → 修复，没有重写', () => assert.strictEqual(seq(A), '原始 → 修复'));
check('AC2：修复提示词含【整份】坏 JSON 原文（不是前 500 字）+ 错误原文 + 出错位置', () => {
  const p = A.siteCalls[1].first;
  assert.ok(UNFIXABLE.length > 500);
  assert.ok(p.includes(UNFIXABLE), '没有整份坏 JSON');
  assert.ok(!p.includes('[truncated]'));
  const v = validateAiJson(UNFIXABLE);
  assert.ok(p.includes(`ERROR: ${v.error}`), '没有错误原文');
  assert.ok(p.includes(`character position ${v.position}`), '没有出错位置');
  assert.ok(p.includes(v.context), '没有出错位置前后的片段');
});
check('AC2：修复是单轮新请求，不带原来那条长提示词；max_tokens 跟原始那次一样', () => {
  const [orig, rep] = A.siteCalls;
  assert.strictEqual(rep.turns, 1);
  assert.ok(!rep.first.includes('Generate a JSON object with this EXACT structure'), '带着站级提示词');
  assert.ok(!rep.first.includes(orig.first.slice(0, 200)), '带着原提示词的开头');
  assert.strictEqual(rep.max_tokens, orig.max_tokens);
});
check('AC2：日志写「AI 修好」', () => assert.ok(/AI 修好（json-repair 1）/.test(A.stderr)));
check('AC4（AC2 那一跑）：cost 里有 [json-repair 1]、没有 [retry', () => {
  assert.strictEqual(A.costs.length, 2, A.costs.join(' · '));
  assert.ok(A.costs.some((d) => d.startsWith('Base site [json-repair 1] (')), A.costs.join(' · '));
  assert.ok(!A.costs.some((d) => d.includes('[retry')), A.costs.join(' · '));
});

// ── AC3 ──────────────────────────────────────────────────────────────────────────────────────────
console.log('── AC3：修复也坏、重写好');
const B = run('rewrite-ok', [ok(UNFIXABLE), ok(UNFIXABLE), ok(GOOD)]);
check('AC3：建站成功，用上的是重写那份；请求序列 = 原始 → 修复 → 重写', () => {
  built(B);
  assert.strictEqual(B.tagline, TAGLINE);
  assert.deepStrictEqual(B.sitePlanDegraded, []);
  assert.strictEqual(seq(B), '原始 → 修复 → 重写');
});
check('AC3：重写那次是今天那条老路（原对话 + 500 字摘要 + Respond AGAIN）', () => {
  const rw = B.siteCalls[2];
  assert.strictEqual(rw.turns, 3);
  assert.ok(/Respond AGAIN with ONLY valid JSON/.test(rw.last), rw.last.slice(0, 200));
});
check('AC4（AC3 那一跑）：[json-repair 1]、[retry 1] 各一条，没有 [json-repair 2]', () => {
  assert.strictEqual(B.costs.length, 3, B.costs.join(' · '));
  assert.strictEqual(B.costs.filter((d) => d.startsWith('Base site [json-repair 1] (')).length, 1, B.costs.join(' · '));
  assert.strictEqual(B.costs.filter((d) => d.startsWith('Base site [retry 1] (')).length, 1, B.costs.join(' · '));
  assert.ok(!B.costs.some((d) => d.includes('[json-repair 2]')), B.costs.join(' · '));
});

console.log('── AC3：三条都坏');
const C = run('all-bad', [ok(UNFIXABLE), ok(UNFIXABLE), ok(UNFIXABLE)]);
check('AC3：请求序列 = 原始 → 修复 → 重写，没有第四条', () => assert.strictEqual(seq(C), '原始 → 修复 → 重写'));
check('AC3：抛错后调用方走 #1596 的降级（一条 site-plan degraded、建站照样成功、tagline 不是 AI 那份）', () => {
  built(C);
  assert.strictEqual(C.sitePlanDegraded.length, 1, JSON.stringify(C.sitePlanDegraded));
  assert.ok(/Failed to parse AI response as JSON/.test(C.sitePlanDegraded[0].reason), C.sitePlanDegraded[0].reason);
  assert.ok(typeof C.tagline === 'string' && C.tagline !== TAGLINE, String(C.tagline));
  assert.ok(/失败：原始 → 修复 → 重写 都没拿到合法 JSON/.test(C.stderr), '日志里没有「失败」那一行');
});

// ── 修复那次自己被截断 ────────────────────────────────────────────────────────────────────────────
console.log('── 修复那次撞 max_tokens');
const T = run('repair-truncated', [ok(UNFIXABLE), { text: GOOD.slice(0, Math.floor(GOOD.length * 0.6)), stop: 'max_tokens' }, ok(GOOD)]);
check('修复那次撞 max_tokens ⟹ 当作没修好、走重写（不让 jsonrepair 把截断的那份补成「合法」）', () => {
  assert.ok(validateAiJson(GOOD.slice(0, Math.floor(GOOD.length * 0.6))).ok, '前提：这份截断的 jsonrepair 确实会「修好」');
  built(T);
  assert.strictEqual(seq(T), '原始 → 修复 → 重写');
  assert.strictEqual(T.tagline, TAGLINE);
  assert.ok(/修复那次也被截断/.test(T.stderr));
});

console.log(`\n${pass} 过 · ${fail} 败`);
process.exit(fail ? 1 : 0);
