#!/usr/bin/env node
/**
 * local-business-facts.test.js — #1551：LocalBusiness 里「从老板给的料来」的几项。
 *   ① 营业时间的转写核对（§verifyTranscription）—— 票上营业时间四臂。「AI 桩」打在 Call 1 解析后的那一项上
 *      （`ai.seo.openingHours`），create-site.js 组 seo 时原样把这个函数的结果写进 `seo.schema.openingHours`（⑤ 钉住接线）；
 *   ② 多段结构的规范化（§hoursSegments，老站单对象照旧认）与 contact 那一行（contact-facts §formatHours）；
 *   ③ 真实评分（§ratingFrom）；
 *   ④ 提示词：留空 ⟹ AI 的请求里不带营业时间、也没有写死的样例；填了 ⟹ 带原文和「只转写」那句。
 *      跑一次 create-site 拿它吐出来的提示词（无效 key ⟹ 请求被拒，不花钱、不建站），同 homepage-recipe.test.js §promptFrom。
 *
 * 跑法:  node scripts/lib/local-business-facts.test.js   （或 `npm run test:scripts`，它按文件名发现）
 * 退出码: 0 全过 · 1 有失败 · 2 跑不起来（不许当成通过）
 */
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync, spawnSync } = require('child_process');

let pass = 0;
let fail = 0;
const ok = (m) => { pass += 1; console.log(`  ✅ ${m}`); };
const bad = (m) => { fail += 1; console.log(`  ❌ ${m}`); };
const check = (cond, m) => (cond ? ok(m) : bad(m));
const J = (v) => JSON.stringify(v);

let F;
let C;
try { F = require('./local-business-facts'); C = require('./contact-facts'); } catch (e) { console.error(`🔴 跑不起来: ${e.message}`); process.exit(2); }

const WEEKDAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'];

console.log('══ #1551 LocalBusiness 的料 ══');

console.log('\n── ① 营业时间：AI 只转写，脚本核（票上四臂 + 段数上限）');
{
  // 填了能认的：两段，原样出
  const two = [{ days: WEEKDAYS, opens: '09:00', closes: '18:00' }, { days: ['Saturday'], opens: '10:00', closes: '16:00' }];
  const r1 = F.verifyTranscription('Mon-Fri 9am-6pm; Sat 10am-4pm', two);
  check(r1.reason === '' && J(r1.segments) === J(two), `「Mon-Fri 9am-6pm; Sat 10am-4pm」+ 桩 2 段 ⟹ 2 段原样出（${J(r1.segments)}）`);
  // 留空：不出，也没有理由（本来就不该有）
  const r2 = F.verifyTranscription('', two);
  check(r2.segments.length === 0 && r2.reason === '', '留空 ⟹ 0 段、不记理由（这一项本来就不该有）');
  const r2b = F.verifyTranscription('   ', two);
  check(r2b.segments.length === 0 && r2b.reason === '', '只有空白 ⟹ 当留空');
  // 认不出：不出，日志有一句
  const r3 = F.verifyTranscription('By appointment', []);
  check(r3.segments.length === 0 && r3.reason !== '', `「By appointment」+ 桩什么都没给 ⟹ 0 段、有理由（${r3.reason}）`);
  const r3b = F.verifyTranscription('By appointment', [{ days: WEEKDAYS, opens: '09:00', closes: '17:00' }]);
  check(r3b.segments.length === 0 && /09:00/.test(r3b.reason), `「By appointment」+ 桩编出周一到周五 9–17 ⟹ 拦下（${r3b.reason}）`);
  // 非英文原文：中文写法里没有 9-6 这种区间形状，照样放行
  const r4 = F.verifyTranscription('周一至周五上午9点至下午6点', [{ days: WEEKDAYS, opens: '09:00', closes: '18:00' }]);
  check(r4.reason === '' && r4.segments.length === 1, `「周一至周五上午9点至下午6点」+ 桩 1 段 ⟹ 1 段放行（${r4.reason || J(r4.segments)}）`);
  const r4b = F.verifyTranscription('月曜〜金曜 ９時〜１８時', [{ days: WEEKDAYS, opens: '09:00', closes: '18:00' }]);
  check(r4b.reason === '' && r4b.segments.length === 1, `全角数字（「９時〜１８時」）⟹ 折成半角后放行（${r4b.reason || 'ok'}）`);
  // 转写核对：原文里不存在的时间
  const r5 = F.verifyTranscription('Mon-Fri 9-6', [{ days: WEEKDAYS, opens: '08:00', closes: '18:00' }]);
  check(r5.segments.length === 0 && /08:00/.test(r5.reason), `「Mon-Fri 9-6」+ 桩 opens 08:00 ⟹ 不出（${r5.reason}）`);
  // 12 小时制比：18:00 对得上「6」
  const r6 = F.verifyTranscription('Mon-Fri 9-6', [{ days: WEEKDAYS, opens: '09:00', closes: '18:00' }]);
  check(r6.reason === '' && r6.segments.length === 1, '「Mon-Fri 9-6」+ 桩 09:00–18:00 ⟹ 放行（18 按 12 小时制是 6）');
  // 反向对照：分钟不算小时（「9:00」里那个 00 不能让 00:00 混过去）
  const r6b = F.verifyTranscription('Mon 9:00-5:00', [{ days: ['Monday'], opens: '00:00', closes: '17:00' }]);
  check(r6b.segments.length === 0, `分钟里的 00 不算一个小时数 ⟹ 编出来的 00:00 拦下（${r6b.reason}）`);
  // Google 商家资料的逐天格式
  const gbp = 'Monday: 9:00 AM – 5:00 PM; Tuesday: 9:00 AM – 5:00 PM; Saturday: 10:00 AM – 2:00 PM; Sunday: Closed';
  const r7 = F.verifyTranscription(gbp, [{ days: ['Monday', 'Tuesday'], opens: '09:00', closes: '17:00' }, { days: ['Saturday'], opens: '10:00', closes: '14:00' }]);
  check(r7.reason === '' && r7.segments.length === 2, 'Google 商家资料逐天格式 + 桩 2 段 ⟹ 放行');
  // 段数上限
  const eight = Array.from({ length: 8 }, () => ({ days: ['Monday'], opens: '09:00', closes: '17:00' }));
  const r8 = F.verifyTranscription('Mon 9-5', eight);
  check(r8.segments.length === 0 && /8/.test(r8.reason), `桩给 8 段 ⟹ 拦下（一周最多 ${F.MAX_SEGMENTS} 段）`);
  const seven = eight.slice(0, 7);
  check(F.verifyTranscription('Mon 9-5', seven).segments.length === 7, '桩给 7 段 ⟹ 放行（边界）');
  // 星期名必须是英文（它直接进 JSON-LD 的 dayOfWeek，contact 那一行也按英文认）
  const r9 = F.verifyTranscription('周一至周五上午9点至下午6点', [{ days: ['周一'], opens: '09:00', closes: '18:00' }]);
  check(r9.segments.length === 0 && r9.reason !== '', `桩给中文星期名 ⟹ 拦下（${r9.reason}）`);
  // 老形状（单个对象）也认
  const r10 = F.verifyTranscription('Mon-Fri 9-5', { days: WEEKDAYS, opens: '09:00', closes: '17:00' });
  check(r10.reason === '' && r10.segments.length === 1, '桩给单个对象（老形状）⟹ 当 1 段');
}

console.log('\n── ② 多段结构：规范化 + contact 那一行');
{
  check(J(F.hoursSegments({ days: [], opens: '', closes: '' })) === '[]', '老站的空壳 {days: [], opens: "", closes: ""} ⟹ 0 段');
  check(J(F.hoursSegments(undefined)) === '[]', '没有这一项 ⟹ 0 段');
  check(J(F.hoursSegments({ days: ['Monday', 'mon', 'Tu'], opens: '9:00', closes: '17:00' })) === J([{ days: ['Monday', 'Tuesday'], opens: '09:00', closes: '17:00' }]),
    '老站单对象：星期去重、缩写认、时间补零');
  const one = { days: ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'], opens: '08:00', closes: '18:00' };
  check(C.formatHours(one) === 'Mon–Sat · 8am – 6pm', `只有一段时那一行跟以前逐字相同（${C.formatHours(one)}）`);
  const two = [{ days: WEEKDAYS, opens: '09:00', closes: '18:00' }, { days: ['Saturday'], opens: '10:00', closes: '16:00' }];
  check(C.formatHours(two) === 'Mon–Fri · 9am – 6pm; Sat · 10am – 4pm', `两段 ⟹ 「${C.formatHours(two)}」`);
  check(C.formatHours(undefined) === '' && C.formatHours({ days: [], opens: '', closes: '' }) === '', '没有 / 空壳 ⟹ 那一行不画');
}

console.log('\n── ③ 评分：只在抓到真实数据时出');
{
  check(J(F.ratingFrom({ platformRatings: { yelp: { rating: 4.1, reviewCount: 9 }, google: { rating: 4.8, reviewCount: 127 } } })) === J({ ratingValue: 4.8, reviewCount: 127 }), '有 google ⟹ 优先 google');
  check(J(F.ratingFrom({ platformRatings: { yelp: { rating: 4.1, reviewCount: 9 } } })) === J({ ratingValue: 4.1, reviewCount: 9 }), '没有 google ⟹ 第一家完整的');
  check(F.ratingFrom({ platformRatings: { google: { rating: 4.8 } } }) === null, '只有分数、没有条数 ⟹ 不出');
  check(F.ratingFrom({ platformRatings: { google: { rating: 7, reviewCount: 3 } } }) === null, '分数超过 5 ⟹ 不出');
  check(F.ratingFrom({}) === null && F.ratingFrom(undefined) === null, '没有 platformRatings ⟹ 不出');
}

console.log('\n── ④ 提示词：留空不带营业时间、填了只让 AI 转写');
const NEXT = path.resolve(__dirname, '..', '..');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'lbf-'));
try {
  const root = path.join(tmp, 'work');
  fs.mkdirSync(root, { recursive: true });
  execFileSync('cp', ['-a', path.join(NEXT, 'scripts'), root]);
  for (const link of ['blocks', 'node_modules', 'src']) {
    const target = path.join(NEXT, link);
    if (fs.existsSync(target)) fs.symlinkSync(target, path.join(root, link));
  }
  const promptFor = (hours) => {
    const payload = { siteId: 'tlbf0001', siteUrl: 'https://example.com', // #1547：manager 给的这次构建的地址，create-site 没它就退出
      companyName: 'Bright Pipes', industry: 'plumbing', location: 'Toronto, ON',
      services: ['Drain Cleaning'], language: 'en', themeRotationIndex: 0, ...(hours ? { hours } : {}) };
    const r = spawnSync('node', [path.join(root, 'scripts', 'create-site.js')], {
      input: JSON.stringify(payload), env: { ...process.env, ANTHROPIC_API_KEY: 'sk-ant-invalid-for-test' },
      encoding: 'utf8', maxBuffer: 64 << 20, timeout: 120000,
    });
    for (const line of (r.stdout || '').split('\n')) {
      let ev; try { ev = JSON.parse(line); } catch { continue; }
      if (ev && ev.event === 'prompt' && ev.name === 'Base Site') return ev.content;
    }
    return null;
  };
  const empty = promptFor('');
  const filled = promptFor('Mon-Fri 9am-6pm; Sat 10am-4pm');
  if (empty === null || filled === null) { console.error('🔴 跑不起来：没拿到提示词'); process.exit(2); }
  check(!/openingHours/.test(empty) && !/HOURS OF OPERATION/.test(empty), '留空 ⟹ 提示词里没有 openingHours、没有 HOURS OF OPERATION');
  check(!/"opens": "09:00"/.test(empty) && !/"opens": "09:00"/.test(filled), '两臂都没有写死的周一到周五 9–17 样例');
  check(/HOURS OF OPERATION: Mon-Fri 9am-6pm; Sat 10am-4pm/.test(filled) && /transcribe ONLY these hours/.test(filled), '填了 ⟹ 带原文和「只转写」那句');
  check(/"openingHours": \[\{ "days"/.test(filled), '填了 ⟹ JSON 结构里有 openingHours（一组段）');
  // 反向对照：两臂只差营业时间这一处（别的字节没被这次改动带歪）
  const strip = (s) => s.replace(/\nHOURS OF OPERATION:[^\n]*\n\(For seo\.openingHours:[^\n]*\)/, '').replace(/ {4}"openingHours": \[[^\n]*\n/, '');
  check(strip(filled) === empty, '去掉营业时间那两处之后，两臂提示词逐字相同');
} finally { fs.rmSync(tmp, { recursive: true, force: true }); }

console.log('\n── ⑤ 接线：create-site.js 组 seo 时用的是核过的段与真实评分');
{
  const src = fs.readFileSync(path.join(NEXT, 'scripts', 'create-site.js'), 'utf8');
  check(/verifyTranscription\(hours, ai\.seo && ai\.seo\.openingHours\)/.test(src), 'Call 1 的 openingHours 先过 verifyTranscription');
  check(/\.\.\.\(hoursCheck\.segments\.length \? \{ openingHours: hoursCheck\.segments \} : \{\}\)/.test(src), 'seo.schema.openingHours 只写核过的段，没有就没有这一项');
  check(!/openingHours: ai\.seo\.openingHours/.test(src), '不再把 AI 填的原样写进去');
  check(/const rating = ratingFrom\(onlinePresence\)/.test(src) && /\.\.\.\(rating \? \{ aggregateRating: rating \} : \{\}\)/.test(src), 'aggregateRating 只来自 ratingFrom(onlinePresence)');
}

console.log(`\n══ 汇总: 通过 ${pass} · 失败 ${fail} ══`);
process.exit(fail ? 1 : 0);
