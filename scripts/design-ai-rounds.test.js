#!/usr/bin/env node
/**
 * design-ai-rounds.test.js — #1757：底部面板 AI 页从聊天记录里挑哪几轮（`scripts/lib/design-ai-rounds.js`）。
 *
 *   node scripts/design-ai-rounds.test.js     （由 `npm run test:scripts` 自动发现）
 *   退出码: 0 全过 · 1 有失败 · 2 跑不起来（**不许当成通过**）
 *
 * 浏览器里那一半（面板真的显示这几轮、发送 / ↺ / 面板不关）在 tests/e2e/specs/1757-editor-design-ai.spec.ts（本地台子）。
 */
'use strict';

let designAiRounds; let designAiWater;
try { ({ designAiRounds, designAiWater } = require('./lib/design-ai-rounds.js')); } catch (e) { console.log(`💥 加载不起来：${e.message}`); process.exit(2); }

let pass = 0; let fail = 0;
const eq = (a, b, m) => { if (JSON.stringify(a) === JSON.stringify(b)) { pass++; console.log(`  ✅ ${m}`); } else { fail++; console.log(`  ❌ ${m}\n     期望 ${JSON.stringify(b)}\n     实得 ${JSON.stringify(a)}`); } };
const row = (role, text, id) => ({ key: `${role}-${id}`, role, text, messageId: id });
const shape = (rounds) => rounds.map((r) => [r.user.text, ...r.replies.map((x) => `${x.role}:${x.text}`)]);

const W0 = { id: 0, keys: [] };
const older = [row('user', 'Make it blue', 1), row('assistant', 'Done: blue', 1)];

// ① 水位线之前同字的那一句不算；只认水位线之后的。
eq(shape(designAiRounds([...older, row('manual', 'Changed layout', 2), row('user', 'Make it blue', 3), row('assistant', 'Done again', 3)], designAiWater(older), ['Make it blue'])),
  [['Make it blue', 'assistant:Done again']], '① 水位线之前的同一句不显示，之后那一句连它的回答显示');

// ② 左边聊天发的（字不同）夹在中间不显示；两轮顺序对；error 也算回答。
eq(shape(designAiRounds([
  row('user', 'Shorter title', 4), row('assistant', 'Shortened', 4),
  row('user', 'from the left chat', 5), row('assistant', 'left answer', 5),
  row('user', 'Add a button', 6), row('error', 'Could not do it', 6),
], W0, ['Shorter title', 'Add a button'])), [['Shorter title', 'assistant:Shortened'], ['Add a button', 'error:Could not do it']], '② 左边发的不显示；两轮顺序对；error 行算回答');

// ③ 还没进记录的那一句：前面的照常显示，它自己不显示（AI 还在改）；回答还没来 ⟹ 这一轮只有提问。
eq(shape(designAiRounds([row('user', 'A', 7)], W0, ['A', 'B'])), [['A']], '③ 回答没来只显示提问；还没进记录的那句不显示');

// ④ 记录里 B 在 A 前（不会发生）⟹ B 配上之后它前面那句 A 不再等，A 不显示。
eq(shape(designAiRounds([row('user', 'B', 8), row('user', 'A', 9)], W0, ['A', 'B'])), [['B']], '④ 配上一句之后，它前面没配上的那几句不再等');

// ⑤ 同一句连发两次 ⟹ 两轮；首尾空白不算差别；回答只取紧跟着的（manual 行截断）。
eq(shape(designAiRounds([row('user', ' Same ', 10), row('assistant', 'one', 10), row('manual', 'saved', 11), row('assistant', 'stray', 11), row('user', 'Same', 12)], W0, ['Same', 'Same'])),
  [[' Same ', 'assistant:one'], ['Same']], '⑤ 同一句发两次是两轮；空白不算；回答只取紧跟着的');

// ⑥ 什么都没发过 ⟹ 空（关了再开就是这样）。
eq(designAiRounds([...older], W0, []), [], '⑥ 没从这一页发过 ⟹ 没有任何一轮');

// ⑦（QA2 P1）发出去却没进记录的那一句（先存失败 / AI 正忙）不卡住后面那句。
eq(shape(designAiRounds([...older, row('user', 'Change the headline to Hello', 2), row('assistant', 'Changed', 2)], designAiWater(older), ['Make it bolder', 'Change the headline to Hello'])),
  [['Change the headline to Hello', 'assistant:Changed']], '⑦ 没进记录的那一句不卡住它后面那一句');

// ⑧（QA2 P2）记录末尾拼着一条不带 messageId 的红色提示，打开时它已经在了；新的用户行排在它前面 ⟹ 照样认。
const withNote = [...older, { key: 'err-1', role: 'error', text: 'The AI could not make that change.' }];
eq(designAiWater(withNote), { id: 1, keys: ['err-1'] }, '⑧a 水位线 = 最大的 messageId + 当时已在的提示行的 key');
eq(shape(designAiRounds([...older, row('user', 'Shorter subtitle please', 3), row('assistant', 'Shortened', 3), withNote[2]], designAiWater(withNote), ['Shorter subtitle please'])),
  [['Shorter subtitle please', 'assistant:Shortened']], '⑧b 新行排在末尾提示前面也照样认；打开前就有的那条提示不算这一轮的回答');
// ⑧c 打开以后才出现的提示（这一轮 AI 失败了）照常算回答。
eq(shape(designAiRounds([...older, row('user', 'Add a map', 3), withNote[2], { key: 'err-2', role: 'error', text: 'AI failed' }], designAiWater(withNote), ['Add a map'])),
  [['Add a map', 'error:AI failed']], '⑧c 打开以后才出现的提示算这一轮的回答');

// ⑨（QA2 P3）发两句 → 撤回第一句（第二句那几行被删）→ 再发第三句 ⟹ 第一、三句都在。
eq(shape(designAiRounds([...older, row('user', 'First change', 3), row('user', 'Third change', 6), row('assistant', 'Third done', 6)], designAiWater(older), ['First change', 'Second change', 'Third change'])),
  [['First change'], ['Third change', 'assistant:Third done']], '⑨ 撤回删掉的那一句不卡住后面再发的那句');

// ⑩ 没有 messageId 的 user 行（不该有）不算这一页发的。
eq(designAiRounds([{ key: 'x', role: 'user', text: 'A' }], W0, ['A']), [], '⑩ 没有 messageId 的 user 行不认');

console.log(`\n${pass} 过 · ${fail} 败`);
process.exit(fail ? 1 : 0);
