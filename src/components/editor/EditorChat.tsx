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
  /** #1454 —— `manual` = 老板在编辑器里点 Save 存下的一笔（正文是编辑器自己算的那句人话）。它的撤销 = 回到这一笔之前，
   *  后面的一起撤掉，跟 AI 那一行同一个后果，所以同一个确认、同一个按钮位置，只是字不说「AI」。 */
  /** #1456 —— 记录里的每一种行都递进来，跟 dashboard 的聊天一模一样：`system`（审计卡片 / Deployed to live 那种居中一行）、
   *  `theme`（Theme changed，能撤）。哪些行、哪条能撤、带不带时间、卡片上写哪些字都是 dashboard 算好的（它那边
   *  `lib/chatTimeline.ts` 一处），这里只排版 —— 这个 app 导不了 dashboard 的代码，自己再算一遍就是两份迟早对不上。 */
  messages: {
    key: string;
    role: 'user' | 'assistant' | 'error' | 'manual' | 'system' | 'theme';
    text: string;
    messageId?: number;
    canRevert?: boolean;
    /** 气泡底下那句相对时间（「5 hours ago」）。没有 = 这一条不带时间（system / error 就没有，同 dashboard）。 */
    time?: string;
    /** 这条 system 行是审计事件：画卡片，不画 `text`（那是一段 JSON）。 */
    audit?: { kind: 'complete'; card: AuditCard } | { kind: 'error'; message: string } | { kind: 'running' };
  }[];
  /** 正在进行的那一次编辑：进度一句话 + 模型已经说出来的字。`firstAt` = dashboard 收到第一个字的时刻。 */
  live: { status: string; text: string; firstAt: number | null } | null;
  busy: boolean;
  reverting: boolean;
  enabled: boolean;
}

/** 审计卡片上的字（dashboard `lib/chatTimeline.ts` §auditCard 算的）：标题括号里那句 + 四行。 */
export interface AuditCard {
  subtitle: string;
  rows: { dot: string; label: string; score: number; delta: string }[];
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
  user: '#4f46e5', bot: '#f2f4f7', err: '#fef3f2', errText: '#b42318', manual: '#ecfdf3', manualText: '#067647',
};

/**
 * #1454 —— 撤销 `messageId` 那一行时，**还有哪些**改动会跟着没了（老板自己的话 / 手改记录的那句）。同
 * `dashboard/src/components/ChatPanel.tsx` §laterChangesAfter：按聊天算，不按 git 算 —— 聊天是老板看得见的那份。
 * AI 的回复和提示不算改动（AI 的那一笔记在它前面那条老板的话上）。#1456 —— theme 行（换主题 / 升级）也是一笔改动，同 dashboard 那份。
 */
function laterChangesAfter(messages: EditorChatState['messages'], messageId: number): string[] {
  const at = messages.findIndex((m) => m.messageId === messageId);
  if (at < 0) return [];
  const out: string[] = [];
  for (let i = at + 1; i < messages.length; i++) {
    const m = messages[i];
    if (m.messageId == null || (m.role !== 'user' && m.role !== 'manual' && m.role !== 'theme')) continue;
    const oneLine = m.text.replace(/\s+/g, ' ').trim();
    out.push(oneLine.length > 80 ? `${oneLine.slice(0, 80)}…` : oneLine);
  }
  return out;
}

export default function EditorChat({ chat, notice, pending, page, locale, rawKey, onSend, onRevert }: {
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
      style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0, overflow: 'hidden', background: '#fff', fontFamily: 'system-ui, sans-serif', color: C.text }}
    >
      {/* 🔴 minHeight: 0 —— 纵向 flex 里的子项默认最小高度 = 内容高度：不写它，消息一多列表就不滚、而是把整页撑高，
          编辑器页跟着能滚动，Puck 会被滚出视口（#1410 e2e ⑧ 截图：左边整片空白）。 */}
      <div ref={listRef} data-editor-chat-messages style={{ flex: 1, minHeight: 0, overflowY: 'auto', padding: 12, display: 'flex', flexDirection: 'column', gap: 10 }}>
        {!chat && <p style={{ margin: 0, fontSize: 13, color: C.faint }}>Connecting to your dashboard…</p>}
        {chat && chat.messages.length === 0 && !live && (
          <p style={{ margin: 0, fontSize: 13, color: C.faint, lineHeight: 1.5 }}>
            Tell the AI what to change. Select a section on the page first to ask about just that section.
          </p>
        )}
        {chat?.messages.map((m) => {
          if (m.role === 'system') return <SystemRow key={m.key} m={m} />;
          const manual = m.role === 'manual';
          // #1456 —— theme 行跟手改那一行是同一种撤销（回到这一笔之前，后面的一起撤掉），同 dashboard 的聊天。
          const ownChange = manual || m.role === 'theme';
          const later = ownChange && confirming === m.messageId ? laterChangesAfter(chat.messages, m.messageId as number) : [];
          return (
          <div key={m.key} data-editor-chat-msg={m.role} data-message-id={m.messageId} style={{ alignSelf: m.role === 'user' ? 'flex-end' : 'flex-start', maxWidth: '88%' }}>
            {manual && <div style={{ fontSize: 11, color: C.faint, marginBottom: 2 }}>You saved</div>}
            <div style={{
              padding: '8px 12px', borderRadius: 10, fontSize: 14, lineHeight: 1.5, whiteSpace: 'pre-wrap', wordBreak: 'break-word',
              background: m.role === 'user' ? C.user : m.role === 'error' ? C.err : manual ? C.manual : C.bot,
              color: m.role === 'user' ? '#fff' : m.role === 'error' ? C.errText : manual ? C.manualText : C.text,
            }}>
              {m.text}
              {m.time && (
                <div data-editor-chat-time style={{ marginTop: 6, fontSize: 11, color: m.role === 'user' ? 'rgba(255,255,255,0.7)' : C.faint, whiteSpace: 'normal' }}>{m.time}</div>
              )}
            </div>
            {m.canRevert && m.messageId != null && (
              confirming === m.messageId ? (
                <div data-editor-chat-revert-confirm style={{ marginTop: 6, padding: 8, border: `1px solid ${C.border}`, borderRadius: 8, fontSize: 12, color: C.sub, lineHeight: 1.5 }}>
                  {ownChange ? (
                    <>
                      {manual ? 'Your website goes back to the way it was before this save.' : 'Your website goes back to the way it looked before this change.'}
                      {later.length > 0 && (
                        <>
                          <div style={{ marginTop: 6 }}>{`This also undoes the ${later.length} change${later.length === 1 ? '' : 's'} made after it:`}</div>
                          <ul data-editor-chat-revert-also style={{ margin: '4px 0 0', paddingLeft: 18 }}>
                            {later.map((t, i) => <li key={i}>{t}</li>)}
                          </ul>
                        </>
                      )}
                    </>
                  ) : (
                    <>
                      This undoes the whole AI change for this message and everything after it — on every page it touched,
                      including shared sections. It can&apos;t be undone step by step.
                    </>
                  )}
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
                    title={manual ? 'Put the website back the way it was before this save' : ownChange ? 'Put the website back the way it looked before this change' : 'Put the website back the way it was before this message (the whole AI change)'}
                    onClick={() => setConfirming(m.messageId as number)}
                    style={{ ...btn(false), fontSize: 12, opacity: busy ? 0.5 : 1 }}
                  >
                    {manual ? 'Revert this save' : ownChange ? 'Revert this change' : 'Revert whole AI change'}
                  </button>
                </div>
              )
            )}
          </div>
          );
        })}
        {live && (
          <div data-editor-chat-live style={{ alignSelf: 'flex-start', maxWidth: '88%' }}>
            <div style={{ padding: '8px 12px', borderRadius: 10, fontSize: 14, lineHeight: 1.5, whiteSpace: 'pre-wrap', wordBreak: 'break-word', background: C.bot }}>
              {live.text ? <span data-editor-chat-live-text>{live.text}</span> : null}
              <div style={{ fontSize: 12, color: C.faint, fontStyle: 'italic', marginTop: live.text ? 6 : 0 }} data-editor-chat-live-status>{live.status}</div>
            </div>
          </div>
        )}
        {chat?.reverting && <p data-editor-chat-reverting style={{ margin: 0, fontSize: 13, color: C.sub }}>Undoing that change…</p>}
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

/**
 * #1456 —— 一条 system 行，画法同 dashboard 的聊天（`ChatPanel.tsx` §renderBubble 的 system 那一支）：审计结果是一张卡片、
 * 审计失败是一张红卡片、审计进行中是 ⏳ 一行，其余（「Deployed to live: …」）居中一行灰字。都不带时间，也没有撤销。
 * 🔴 卡片不用 dashboard 那张 `<table>`：左栏只有两百来像素，四列定宽加起来就把「Best Practices」那格挤没了。这里每一行
 *    是「圆点 · 名称 · 分数 · 差值」四格的 grid，名称那格可以换行、不截断。
 */
function SystemRow({ m }: { m: EditorChatState['messages'][number] }) {
  const a = m.audit;
  if (a?.kind === 'complete') {
    return (
      <div data-editor-chat-msg="system" data-message-id={m.messageId} data-editor-chat-audit="complete" style={{ alignSelf: 'stretch', border: `1px solid ${C.border}`, borderRadius: 8, padding: '10px 12px', fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', fontSize: 13, lineHeight: 1.6, color: C.text }}>
        <div data-editor-chat-audit-title style={{ color: C.sub, marginBottom: 4, overflowWrap: 'anywhere' }}>🔍 Site Audit ({a.card.subtitle})</div>
        {a.card.rows.map((r) => (
          <div key={r.label} data-editor-chat-audit-row style={{ display: 'grid', gridTemplateColumns: 'auto minmax(0, 1fr) auto auto', columnGap: 8, alignItems: 'baseline' }}>
            <span data-audit-dot>{r.dot}</span>
            <span data-audit-label style={{ overflowWrap: 'anywhere' }}>{r.label}</span>
            <span data-audit-score style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{r.score}</span>
            <span data-audit-delta style={{ textAlign: 'right', color: C.faint }}>{r.delta}</span>
          </div>
        ))}
      </div>
    );
  }
  if (a?.kind === 'error') {
    return (
      <div data-editor-chat-msg="system" data-message-id={m.messageId} data-editor-chat-audit="error" style={{ alignSelf: 'stretch', background: C.err, border: '1px solid #fecdca', borderRadius: 8, padding: '10px 12px', fontSize: 13, lineHeight: 1.6, color: C.errText }}>
        <div style={{ fontWeight: 600, marginBottom: 4 }}>⚠️ Site audit failed</div>
        <div style={{ color: C.sub, fontSize: 12, overflowWrap: 'anywhere' }}>Reason: {a.message}</div>
      </div>
    );
  }
  if (a?.kind === 'running') {
    return <div data-editor-chat-msg="system" data-message-id={m.messageId} data-editor-chat-audit="running" style={{ textAlign: 'center', color: C.faint, fontSize: 13, padding: '4px 0', fontStyle: 'italic' }}>⏳ Running site audit… (~30s)</div>;
  }
  return <div data-editor-chat-msg="system" data-message-id={m.messageId} style={{ textAlign: 'center', color: C.faint, fontSize: 13, padding: '4px 0', overflowWrap: 'anywhere' }}>{m.text}</div>;
}

function btn(primary: boolean) {
  return {
    padding: '5px 12px', borderRadius: 6, fontSize: 13, cursor: 'pointer',
    border: primary ? 0 : `1px solid ${C.border}`, background: primary ? '#1d4ed8' : '#fff', color: primary ? '#fff' : C.text,
  } as const;
}
