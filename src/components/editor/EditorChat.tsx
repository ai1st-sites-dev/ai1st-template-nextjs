'use client';

// #1410 —— 编辑器页里的 AI 聊天：**只有界面**。
//
// 🔴 这里一个请求都不发、不碰任何存储（同 EditorApp 文件头那条硬约束）。发消息、收流式回复、回退、聊天记录
//    全部由框住我们的 dashboard 做（`dashboard/src/hooks/useEditorChat.ts`），经 EditorApp 那条校验过 origin 的
//    postMessage 通道递进来 / 递出去。这个文件里也没有 postMessage：收发都在 EditorApp，守卫
//    （`manager/ticket1409_postmessage_test.go`）照样把它列进被扫的清单 —— 哪天有人在这里直接发，它看得见。
//
// 就地上下文（票正文做什么 3）：「现在选的是谁」直接读 Puck 的选中状态（同一页里，不经过 postMessage）。
// 发出去的那条消息带上这一块的范围（#1351 的 scope：站里 `block-scope.js` 据此拒掉越界的写入）；
// 老板点掉那个标签就是「整站」。

import { useEffect, useRef, useState } from 'react';
import { createUsePuck } from '@puckeditor/core';

const usePuck = createUsePuck();

/** dashboard 递进来的聊天状态（形状在 `dashboard/src/hooks/useEditorChat.ts` §EditorChatState，两边同一份）。 */
export interface EditorChatState {
  messages: { key: string; role: 'user' | 'assistant' | 'error'; text: string; messageId?: number; canRevert?: boolean }[];
  /** 正在进行的那一次编辑：进度一句话 + 模型已经说出来的字。`firstAt` = dashboard 收到第一个字的时刻。 */
  live: { status: string; text: string; firstAt: number | null } | null;
  busy: boolean;
  reverting: boolean;
  enabled: boolean;
}

export interface ChatScope { page: string; locale?: string; blockId?: string; blockIndex?: number }

type Src = { at?: number; entry?: { id?: unknown; ref?: unknown } | null; shared?: string | null; locked?: boolean } | undefined;

/** 选中的块 → 这条消息的范围。认不出这一块在文件里是哪一条（新加的、还没存过）就回 null：发整页范围会误伤。 */
function scopeOf(src: Src, page: string, locale: string, rawKey: 'blocks' | 'sections'): ChatScope | null {
  if (!src) return null;
  const base = { page, ...(locale ? { locale } : {}) };
  if (src.shared) return { ...base, blockId: src.shared };
  if (rawKey === 'sections') return typeof src.at === 'number' && src.at >= 0 ? { ...base, blockIndex: src.at } : null;
  const e = src.entry;
  if (e && typeof e.id === 'string' && e.id) return { ...base, blockId: e.id };
  if (e && typeof e.ref === 'string' && e.ref) return { ...base, blockId: e.ref };
  return null;
}

const C = {
  border: '#e4e7ec', text: '#101828', sub: '#475467', faint: '#667085',
  user: '#4f46e5', bot: '#f2f4f7', err: '#fef3f2', errText: '#b42318',
};

export default function EditorChat({ chat, notice, pending, page, locale, rawKey, onSend, onRevert, onClose }: {
  chat: EditorChatState | null;
  /** 这一侧自己的一句话（「先存一下…」「没发出去：…」）。 */
  notice: { kind: 'info' | 'error'; text: string } | null;
  /** 正在先存 / 正在交给 dashboard —— 这期间发送键灰掉。 */
  pending: boolean;
  page: string;
  locale: string;
  rawKey: 'blocks' | 'sections';
  onSend: (text: string, scope: ChatScope | null) => void;
  onRevert: (messageId: number) => void;
  onClose: () => void;
}) {
  const selected = usePuck((s) => s.selectedItem);
  const config = usePuck((s) => s.config);
  const [text, setText] = useState('');
  const [scoped, setScoped] = useState(true);
  const [confirming, setConfirming] = useState<number | null>(null);
  const listRef = useRef<HTMLDivElement>(null);

  // 换了一块就重新默认「只改这一块」：上一块上点掉的标签不该带到下一块。
  const selId = selected ? String((selected.props as { id?: unknown }).id ?? '') : '';
  useEffect(() => { setScoped(true); }, [selId]);

  const src = selected ? (selected.props as { _src?: Src })._src : undefined;
  const label = selected ? (config.components[selected.type]?.label || selected.type) : '';
  const scope = selected && scoped ? scopeOf(src, page, locale, rawKey) : null;

  const live = chat?.live || null;
  // 票正文最后一条 AC：dashboard 收到第一个字 → 这里画出第一个字，隔了多久。画完那一帧再量。
  // 读数挂在侧栏本身（常驻）上，不挂在正在写的那个气泡上：那个气泡在 AI 做完时就卸载了，读数会跟着没了。
  const firstShown = useRef<number | null>(null);
  const [firstMs, setFirstMs] = useState<number | null>(null);
  useEffect(() => {
    if (!live || !live.text) { if (!live) firstShown.current = null; return; }
    if (firstShown.current !== null || live.firstAt === null) return;
    const from = live.firstAt;
    firstShown.current = -1;
    requestAnimationFrame(() => {
      const ms = Date.now() - from;
      firstShown.current = ms;
      setFirstMs(ms);
    });
  }, [live]);

  useEffect(() => {
    const el = listRef.current;
    if (el) el.scrollTo({ top: el.scrollHeight });
  }, [chat?.messages.length, live?.text, live?.status, notice]);

  const busy = !!chat && (chat.busy || chat.reverting);
  const canSend = !!chat?.enabled && !busy && !pending && text.trim().length > 0;
  function send() {
    if (!canSend) return;
    onSend(text.trim(), scope);
    setText('');
  }

  return (
    <aside
      data-editor-chat
      data-editor-chat-first-ms={firstMs ?? undefined}
      style={{ width: 340, flexShrink: 0, display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0, overflow: 'hidden', borderLeft: `1px solid ${C.border}`, background: '#fff', fontFamily: 'system-ui, sans-serif', color: C.text }}
    >
      <div style={{ display: 'flex', alignItems: 'center', padding: '10px 12px', borderBottom: `1px solid ${C.border}` }}>
        <strong style={{ fontSize: 14, flex: 1 }}>AI chat</strong>
        <button type="button" data-editor-chat-close onClick={onClose} aria-label="Close AI chat" style={{ border: 0, background: 'transparent', cursor: 'pointer', fontSize: 16, color: C.faint }}>×</button>
      </div>

      {/* 🔴 minHeight: 0 —— 纵向 flex 里的子项默认最小高度 = 内容高度：不写它，消息一多列表就不滚、而是把整页撑高，
          编辑器页跟着能滚动，Puck 会被滚出视口（#1410 e2e ⑧ 截图：左边整片空白）。 */}
      <div ref={listRef} data-editor-chat-messages style={{ flex: 1, minHeight: 0, overflowY: 'auto', padding: 12, display: 'flex', flexDirection: 'column', gap: 10 }}>
        {!chat && <p style={{ margin: 0, fontSize: 13, color: C.faint }}>Connecting to your dashboard…</p>}
        {chat && chat.messages.length === 0 && !live && (
          <p style={{ margin: 0, fontSize: 13, color: C.faint, lineHeight: 1.5 }}>
            Tell the AI what to change. Select a section on the page first to ask about just that section.
          </p>
        )}
        {chat?.messages.map((m) => (
          <div key={m.key} data-editor-chat-msg={m.role} style={{ alignSelf: m.role === 'user' ? 'flex-end' : 'flex-start', maxWidth: '88%' }}>
            <div style={{
              padding: '8px 12px', borderRadius: 10, fontSize: 14, lineHeight: 1.5, whiteSpace: 'pre-wrap', wordBreak: 'break-word',
              background: m.role === 'user' ? C.user : m.role === 'error' ? C.err : C.bot,
              color: m.role === 'user' ? '#fff' : m.role === 'error' ? C.errText : C.text,
            }}>
              {m.text}
            </div>
            {m.canRevert && m.messageId != null && (
              confirming === m.messageId ? (
                <div data-editor-chat-revert-confirm style={{ marginTop: 6, padding: 8, border: `1px solid ${C.border}`, borderRadius: 8, fontSize: 12, color: C.sub, lineHeight: 1.5 }}>
                  This undoes the whole AI change for this message and everything after it — on every page it touched,
                  including shared sections. It can&apos;t be undone step by step.
                  <div style={{ display: 'flex', gap: 6, marginTop: 6 }}>
                    <button type="button" data-editor-chat-revert-yes onClick={() => { setConfirming(null); onRevert(m.messageId as number); }} style={btn(true)}>Undo it</button>
                    <button type="button" onClick={() => setConfirming(null)} style={btn(false)}>Cancel</button>
                  </div>
                </div>
              ) : (
                <div style={{ textAlign: 'right', marginTop: 4 }}>
                  <button
                    type="button"
                    data-editor-chat-revert={m.messageId}
                    disabled={busy}
                    title="Put the website back the way it was before this message (the whole AI change)"
                    onClick={() => setConfirming(m.messageId as number)}
                    style={{ ...btn(false), fontSize: 12, opacity: busy ? 0.5 : 1 }}
                  >
                    Revert whole AI change
                  </button>
                </div>
              )
            )}
          </div>
        ))}
        {live && (
          <div data-editor-chat-live style={{ alignSelf: 'flex-start', maxWidth: '88%' }}>
            <div style={{ padding: '8px 12px', borderRadius: 10, fontSize: 14, lineHeight: 1.5, whiteSpace: 'pre-wrap', wordBreak: 'break-word', background: C.bot }}>
              {live.text ? <span data-editor-chat-live-text>{live.text}</span> : null}
              <div style={{ fontSize: 12, color: C.faint, fontStyle: 'italic', marginTop: live.text ? 6 : 0 }} data-editor-chat-live-status>{live.status}</div>
            </div>
          </div>
        )}
        {chat?.reverting && <p data-editor-chat-reverting style={{ margin: 0, fontSize: 13, color: C.sub }}>Undoing that AI change…</p>}
        {notice && (
          <p data-editor-chat-notice={notice.kind} style={{ margin: 0, fontSize: 13, lineHeight: 1.5, color: notice.kind === 'error' ? C.errText : C.sub }}>
            {notice.text}
          </p>
        )}
      </div>

      <div style={{ borderTop: `1px solid ${C.border}`, padding: 10, display: 'flex', flexDirection: 'column', gap: 8 }}>
        <div data-editor-chat-context style={{ fontSize: 12, color: C.sub, minHeight: 18 }}>
          {selected ? (
            scoped && scope ? (
              <span data-editor-chat-scope={scope.blockId ?? `#${scope.blockIndex}`}>
                About: <strong>{label}</strong>{' '}
                <button type="button" data-editor-chat-unscope onClick={() => setScoped(false)} style={{ border: 0, background: 'transparent', color: C.faint, cursor: 'pointer', padding: 0 }} aria-label="Ask about the whole website instead">×</button>
              </span>
            ) : scoped ? (
              <span data-editor-chat-scope="">Selected: <strong>{label}</strong> (save it first to ask about just this section)</span>
            ) : (
              <span data-editor-chat-scope="">About: the whole website</span>
            )
          ) : (
            <span data-editor-chat-scope="">About: the whole website</span>
          )}
        </div>
        <textarea
          data-editor-chat-input
          value={text}
          disabled={!chat?.enabled}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); } }}
          placeholder={selected && scope ? `Ask AI to change the ${label} section…` : 'Ask AI to edit your website…'}
          rows={3}
          style={{ width: '100%', boxSizing: 'border-box', resize: 'vertical', fontSize: 14, padding: 8, border: `1px solid ${C.border}`, borderRadius: 8, fontFamily: 'inherit' }}
        />
        <div style={{ display: 'flex', justifyContent: 'flex-end', alignItems: 'center', gap: 8 }}>
          {busy && <span style={{ fontSize: 12, color: C.faint }}>{chat?.reverting ? 'Undoing…' : 'AI is working…'}</span>}
          <button type="button" data-editor-chat-send disabled={!canSend} onClick={send} style={{ ...btn(true), opacity: canSend ? 1 : 0.5 }}>Send</button>
        </div>
      </div>
    </aside>
  );
}

function btn(primary: boolean) {
  return {
    padding: '5px 12px', borderRadius: 6, fontSize: 13, cursor: 'pointer',
    border: primary ? 0 : `1px solid ${C.border}`, background: primary ? '#1d4ed8' : '#fff', color: primary ? '#fff' : C.text,
  } as const;
}
