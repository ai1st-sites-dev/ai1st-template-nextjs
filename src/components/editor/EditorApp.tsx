'use client';

// #1409 —— 编辑器页的客户端那一半：Puck + 一个写死的 hero（只有标题一个字段）。
//
// 🔴 唯一的硬约束（设计稿 §4）：**这个页面所在的域名上不许出现任何凭证，也不许向 manager 发请求。**
//    所以这里没有 fetch、没有存储、没有 token。存盘 = 把整份页面 JSON `postMessage` 给框住我们的
//    dashboard，由它带自己的凭证去打 manager。
//
// 🔴 收发两向都校验 origin，发消息**不许**用 `'*'`：
//    · 发：目标 origin 是构建时烤进来的 dashboard origin（`trustedOrigin`，与主题预览 #925 同一个来源：
//      `leadApi` 的 origin）。拿不到它就不发，界面上说清楚「只能从 dashboard 里保存」。
//    · 收：`e.origin !== trustedOrigin` 的消息一律忽略。
//    `manager/ticket1409_postmessage_test.go` 守着这两条（改成 `'*'` / 删掉 origin 判断都会红）。
//
// 本票只做**一个写死的块**（票正文 §做什么 7）：config 手写、不从 manifest 生成（那是 #1404）。
// 所以画布上只放这一页的 hero，拖拽 / 增删 / 复制都关着 —— 不是「不给权限」（Chris 2026-09-19 拍的
// 是全开），而是本票的存盘只认 hero 的标题：放开的话老板拖了、删了、点 Save 说「已保存」，重建完
// 什么都没变。#1404 接上整页往返时一起打开。

import { useEffect, useMemo, useRef, useState } from 'react';
import { Puck, createUsePuck, type Config, type Data } from '@puckeditor/core';
import '@puckeditor/core/puck.css';
import HeroSection from '@blocks/hero/Section';
import type { BlockConfig } from '@/lib/types/config';

export interface EditorHero {
  /** 归一化之后的块（画布照它渲染：`data-shape` / `data-has-*` 都从它来，跟真页面同一份）。 */
  block: BlockConfig;
  /** 它在**原始**页面 JSON 数组里的下标；不可写时是 -1 或它那条 `{ref}` 的下标。 */
  at: number;
  writable: boolean;
  /** 不可写的原因：'shared' = 字住在站级块库里（#1406 的事）。 */
  reason: string;
}

export interface EditorAppProps {
  locale: string;
  page: string;
  /** 文件里那一份，存盘的底。见 `scripts/lib/editor-page.js` 文件头。 */
  raw: Record<string, unknown>;
  heroes: EditorHero[];
  /** 框住我们的 dashboard 的 origin。空串 = 构建时没拿到（本地模板 dev），这时不能保存。 */
  trustedOrigin: string;
}

type HeroProps = { headline: string; block: BlockConfig; at: number };

const usePuck = createUsePuck();

// 类型参数只列**字段**（Puck 要求每个声明过的 prop 都有字段）；`block` / `at` 是跟着数据走、不给老板编辑
// 的两个 prop，render 里按 HeroProps 读。
const config: Config<{ hero: { headline: string } }> = {
  components: {
    hero: {
      label: 'Hero',
      fields: { headline: { type: 'text', label: 'Headline' } },
      render: (props) => {
        const { headline, block } = props as unknown as HeroProps;
        // 画布里渲染的就是真站那一个组件，只把标题换成字段里的值。
        return <HeroSection data={{ ...(block.data || {}), headline } as never} block={block} />;
      },
    },
  },
};

/** 把 Puck 里的标题写回原始页面 JSON 的对应那一条。回新的一份，原来那份不动。 */
export function applyHeroHeadlines(raw: Record<string, unknown>, heroes: EditorHero[], data: Data) {
  const next = JSON.parse(JSON.stringify(raw)) as Record<string, unknown>;
  const arr = (Array.isArray(next.blocks) ? next.blocks : next.sections) as Record<string, unknown>[] | undefined;
  let changed = 0;
  if (!Array.isArray(arr)) return { json: next, changed };
  for (const item of data.content || []) {
    const props = item.props as unknown as HeroProps;
    const hero = heroes.find((h) => h.at === props.at && h.writable);
    if (!hero) continue;
    const entry = arr[hero.at];
    if (!entry || typeof entry !== 'object') continue;
    const before = (entry.data as Record<string, unknown> | undefined) || {};
    if (before.headline === props.headline) continue;
    entry.data = { ...before, headline: props.headline };
    changed += 1;
  }
  return { json: next, changed };
}

type Status = { kind: 'idle' | 'saving' | 'saved' | 'error'; text: string };

function SaveButton({ onSave, status }: { onSave: (d: Data) => void; status: Status }) {
  const data = usePuck((s) => s.appState.data);
  // 🔴 按钮上写的是 Save，因为它做的就是保存（票正文 §做什么 9 三选一的「等于保存」）。
  //    发布到正式域名是 dashboard 上另一个动作（Publish），两件事不许共用一个字。
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
      {status.text && (
        <span data-editor-status={status.kind} style={{ fontSize: 13, color: status.kind === 'error' ? '#b42318' : '#475467' }}>
          {status.text}
        </span>
      )}
      <button
        type="button"
        data-editor-save
        disabled={status.kind === 'saving'}
        onClick={() => onSave(data)}
        style={{ padding: '6px 14px', borderRadius: 6, border: 0, background: '#1d4ed8', color: '#fff', fontSize: 14, cursor: 'pointer' }}
      >
        Save
      </button>
    </span>
  );
}

export default function EditorApp({ locale, page, raw, heroes, trustedOrigin }: EditorAppProps) {
  const [status, setStatus] = useState<Status>({ kind: 'idle', text: '' });
  const statusRef = useRef(status);
  statusRef.current = status;

  const initialData = useMemo<Data>(() => ({
    root: { props: {} },
    content: heroes.map((h, i) => ({
      type: 'hero',
      props: {
        id: h.block.id || `hero-${i}`,
        headline: String((h.block.data as Record<string, unknown> | undefined)?.headline ?? ''),
        block: h.block,
        at: h.at,
      },
      ...(h.writable ? {} : { readOnly: { headline: true } }),
    })),
  }), [heroes]);

  // 告诉 dashboard「编辑器起来了、我编辑的是哪一页」。它拿这条确认 iframe 里真的是编辑器。
  useEffect(() => {
    if (!trustedOrigin || window.parent === window) return;
    window.parent.postMessage({ type: 'ai1st:editor-ready', page, locale }, trustedOrigin);
  }, [trustedOrigin, page, locale]);

  // dashboard 回的保存结果。🔴 只认那一个 origin。
  useEffect(() => {
    if (!trustedOrigin) return;
    function onMessage(e: MessageEvent) {
      if (e.origin !== trustedOrigin) return;
      const d = e.data as { type?: unknown; ok?: unknown; message?: unknown };
      if (!d || typeof d !== 'object' || d.type !== 'ai1st:editor-save-result') return;
      const text = typeof d.message === 'string' ? d.message : '';
      setStatus(d.ok === true ? { kind: 'saved', text: text || 'Saved.' } : { kind: 'error', text: text || 'Could not save.' });
    }
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, [trustedOrigin]);

  function save(data: Data) {
    if (!trustedOrigin || window.parent === window) {
      setStatus({ kind: 'error', text: 'Open this editor from your dashboard to save.' });
      return;
    }
    const { json, changed } = applyHeroHeadlines(raw, heroes, data);
    if (changed === 0) {
      setStatus({ kind: 'idle', text: 'Nothing to save.' });
      return;
    }
    setStatus({ kind: 'saving', text: 'Saving…' });
    // 不带文件路径：写哪个文件由站里的 `scripts/write-page.js` 按 page/locale 自己算（它文件头说为什么）。
    window.parent.postMessage({ type: 'ai1st:editor-save', page, locale, json }, trustedOrigin);
  }

  if (heroes.length === 0) {
    return (
      <div style={{ padding: 32, fontFamily: 'system-ui, sans-serif' }} data-editor-empty>
        This page has no section that can be edited here yet.
      </div>
    );
  }

  return (
    <div data-editor-root style={{ height: '100vh' }}>
      <Puck
        config={config as unknown as Config}
        data={initialData}
        iframe={{ enabled: true, syncHostStyles: true, waitForStyles: true }}
        permissions={{ drag: false, insert: false, delete: false, duplicate: false }}
        overrides={{
          headerActions: () => <SaveButton onSave={save} status={status} />,
        }}
        onPublish={save}
      />
    </div>
  );
}
