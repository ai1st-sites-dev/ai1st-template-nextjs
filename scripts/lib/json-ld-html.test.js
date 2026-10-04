#!/usr/bin/env node
/**
 * json-ld-html.test.js — #1551 r3：JSON-LD 写进 <script> 时跳不出标签（QA2 r2 的 XSS 发现）。
 *
 * 跑法:  node scripts/lib/json-ld-html.test.js      （`npm run test:scripts` 会自动发现它）
 * 退出码: 0 全过 · 1 有失败 · 2 跑不起来（**不许当成通过**）
 *
 * 判据（QA2 原话）：写进任何一个 JSON-LD `<script>` 的字符串，产物里都不能出现能关闭这个标签的 `</`；
 * 同时 `JSON.parse` 读回来字段值跟原文相同。另有反事实：裸 `JSON.stringify` 在同一份输入上会漏出 `</script`。
 */
'use strict';

let failed = 0;
const ok = (m) => console.log(`  ✅ ${m}`);
const bad = (m) => { failed += 1; console.log(`  ❌ ${m}`); };

let jsonLdHtml;
try {
  ({ jsonLdHtml } = require('./json-ld-html.js'));
} catch (e) {
  console.log(`🔴 跑不起来：${e.message}`);
  process.exit(2);
}

// QA2 那四个口子各一段（FAQ 答案 / 关键词页 Service name / sameAs / 页面标题），外加 HTML 注释开头与大小写变体。
const ATTACKS = [
  '</script><script>window.__qa2_faq=1</script>',
  '</SCRIPT ><script>window.__x=1</script>',
  'https://x.example/</script><img src=x onerror=alert(1)>',
  '<!--<script>',
  'a < b && c > d',
];
const schema = {
  '@context': 'https://schema.org',
  '@type': 'FAQPage',
  name: ATTACKS[3],
  sameAs: [ATTACKS[2]],
  mainEntity: ATTACKS.map((t) => ({ '@type': 'Question', name: t, acceptedAnswer: { '@type': 'Answer', text: t } })),
};

console.log('① 产物里一个 < 都没有（于是 </script 与 <!-- 都不可能出现）');
const out = jsonLdHtml(schema);
!out.includes('<') ? ok(`输出 ${out.length} 字节，'<' 0 处`) : bad(`输出里还有 '<'：${out.slice(out.indexOf('<') - 20, out.indexOf('<') + 20)}`);
!/<\/script/i.test(out) ? ok('不含 </script（不分大小写）') : bad('含 </script');

console.log('② JSON 语义不变：JSON.parse 读回来跟原文逐字相同');
JSON.stringify(JSON.parse(out)) === JSON.stringify(schema) ? ok('读回 == 原对象') : bad('读回跟原对象不同');
JSON.parse(out).mainEntity[0].acceptedAnswer.text === ATTACKS[0] ? ok(`答案原文保住了：${ATTACKS[0]}`) : bad('答案被改了');

console.log('③ 反事实：裸 JSON.stringify 在同一份输入上会跳出标签（证明 ① 不是恒真）');
/<\/script/i.test(JSON.stringify(schema)) ? ok('裸 JSON.stringify 含 </script ⟹ 上面那格有判别力') : bad('裸 JSON.stringify 也不含 —— 夹具没打中');

console.log('④ 没有 < 的普通数据逐字节不变（老站的产物不动）');
const plain = { '@type': 'LocalBusiness', name: "Bright Smile Dental & Co.", telephone: '+1 416 555 0000' };
jsonLdHtml(plain) === JSON.stringify(plain) ? ok('逐字节相同') : bad('普通数据也被改了');

console.log(failed ? `\n❌ ${failed} 格没过` : '\n✅ 全过');
process.exit(failed ? 1 : 0);
