'use strict';

/**
 * #1757 —— 底部面板 AI 页显示哪几轮：面板这一次打开以来、从这一页发出去的那几句，和各自后面 AI 的回答。
 *
 * 聊天记录只有左边那一份（dashboard 递进来的 `ai1st:chat-state` 的 `messages`），这里只是从里面挑。
 * `ai1st:chat-sent` 不回 messageId（`dashboard/src/components/VisualEditorPanel.tsx` §chat-send）⟹ 认不了 id，按 PM 定的判据认：
 *   `water` = 面板打开那一刻的水位线（§designAiWater）：记录里最大的 messageId，和当时已经在的那几条不带 messageId 的行的 key；`sent` = 从这一页发出去的那几句，按发出的顺序。
 *   messageId 大于水位线的 user 行，按顺序跟「这一页发过、还没配上的」那几句比字（两边都去掉首尾空白），
 *   从还没配上的第一句往后找，找到一样的就配上 —— 它前面那几句跳过、不再等；
 *   配上的那一行连它紧跟着的 AI 回答（assistant / error 行）一起算这一轮。
 * 所以：水位线之前的、从左边聊天发的（字不同）都不显示。
 *
 * 🔴 水位线按 messageId、不按「第几条」，跳过而不是卡住（QA2 退 r1 的三条）：
 *   - dashboard 把会话里的红色提示（AI 失败 / 撤回失败）固定拼在记录**末尾**、不带 messageId（`useEditorChat.ts` §state），
 *     新的用户行排在它们前面 ⟹ 按条数记的水位线会把新的那句挡在线下。messageId 是库里的自增 id，新行一定更大。
 *     这些提示又一直不清 ⟹ 打开时已经在的那几条会紧跟在新一轮后面，不许当成这一轮的回答（按 key 记下、排除）；
 *     打开以后才出现的（这一轮 AI 失败了）照常算回答。
 *   - 发出去却没进记录的那一句（先存失败 / dashboard 回「AI 正忙」），和撤回删掉的那几行（`manager/edit.go`
 *     §handleEditMessageRevert 删掉那一行之后的所有行）永远配不上 ⟹ 严格逐句配的话，它后面的每一句都跟着显示不出来。
 *
 * @param {{ key?: string, role: string, text: string, messageId?: number }[]} messages
 * @param {{ id: number, keys: string[] }} water
 * @param {string[]} sent
 * @returns {{ user: object, replies: object[] }[]}
 */
function designAiRounds(messages, water, sent) {
  const out = [];
  const list = Array.isArray(messages) ? messages : [];
  const line = Number(water && water.id) || 0;
  const old = new Set(water && Array.isArray(water.keys) ? water.keys : []);
  let q = 0;
  for (let i = 0; i < list.length && q < sent.length; i++) {
    const m = list[i];
    if (!m || m.role !== 'user' || m.messageId == null || !(Number(m.messageId) > line)) continue;
    const t = String(m.text || '').trim();
    let k = q;
    while (k < sent.length && String(sent[k]).trim() !== t) k++;
    if (k === sent.length) continue;
    const replies = [];
    for (let j = i + 1; j < list.length && list[j] && (list[j].role === 'assistant' || list[j].role === 'error'); j++) {
      if (list[j].messageId == null && old.has(list[j].key)) continue;
      replies.push(list[j]);
    }
    out.push({ user: m, replies });
    q = k + 1;
  }
  return out;
}

/** 面板打开那一刻的水位线：记录里最大的 messageId（没有就是 0），和当时已经在的那几条不带 messageId 的行（会话里的提示）的 key。 */
function designAiWater(messages) {
  let id = 0;
  const keys = [];
  for (const m of Array.isArray(messages) ? messages : []) {
    if (!m) continue;
    if (m.messageId != null) { if (Number(m.messageId) > id) id = Number(m.messageId); } else if (m.key != null) keys.push(String(m.key));
  }
  return { id, keys };
}

module.exports = { designAiRounds, designAiWater };
