'use client';

// #1409 / #1404 —— 编辑器页的客户端那一半：Puck + 从这个站自己的区块库生成的 config。
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
// #1404 —— config 不手写：组件、字段、形态下拉全部来自构建时算好的 `schema`（`scripts/lib/editor-schema.js`
// 文件头说三份清单各从哪儿来），页面 JSON ⇄ Puck Data 走 `scripts/lib/editor-convert.js`（往返守卫
// `scripts/editor-roundtrip.test.js` 跑的是同一份字节）。拖拽 / 增删 / 复制全开（Chris 2026-09-19）；
// 只有共用块（`{ref}` 或按 `visibility` 注进来的）锁着 —— 改它归 #1406。

import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Puck, createUsePuck, type Config, type Data, type Field, type Fields } from '@puckeditor/core';
import '@puckeditor/core/puck.css';
import SectionRenderer from '@/components/SectionRenderer';
import type { BlockConfig } from '@/lib/types/config';
import type { EditorComponent, EditorField, EditorSchema } from '../../../scripts/lib/editor-schema';
import type { PuckItemSrc, PuckLikeData } from '../../../scripts/lib/editor-convert';
import { puckToPage, fieldProps, dataFromProps, deepEqual } from '../../../scripts/lib/editor-convert.js';

export interface EditorAppProps {
  locale: string;
  page: string;
  /** 文件里那一份，存盘的底。见 `scripts/lib/editor-page.js` 文件头。 */
  raw: Record<string, unknown>;
  /**
   * 那份文件字节的 sha256。存盘时原样带回去：站里的 `write-page.js` 拿它跟当前文件比，编辑器打开之后
   * 这一页被别处改过就拒绝写入（#1409 QA2 r1：旧底稿整份写回会冲掉检查器 / AI 聊天刚做的改动）。
   */
  baseHash: string;
  schema: EditorSchema;
  initialData: PuckLikeData;
  /** 框住我们的 dashboard 的 origin。空串 = 构建时没拿到（本地模板 dev），这时不能保存。 */
  trustedOrigin: string;
}

const usePuck = createUsePuck();

function summaryOf(item: unknown, index: number | undefined, subs: string[]): string {
  const o = (item || {}) as Record<string, unknown>;
  for (const k of subs) {
    const v = o[k];
    if (typeof v === 'string' && v.trim()) return v.length > 40 ? `${v.slice(0, 40)}…` : v;
  }
  return `Item ${(index ?? 0) + 1}`;
}

/** manifest 的一个槽位 → 一个 Puck 字段。控件由 `kind` 决定（editor-schema.js 文件头那张表）。 */
function puckField(f: EditorField): Field {
  switch (f.control) {
    case 'text':
      return { type: 'text', label: f.label };
    case 'object':
      return {
        type: 'object',
        label: f.label,
        objectFields: Object.fromEntries(f.subs.map((s) => [s.sub, { type: 'text', label: s.label }])),
      } as Field;
    case 'list':
      return {
        type: 'array',
        label: f.label,
        arrayFields: Object.fromEntries(f.subs.map((s) => [s.sub, { type: 'text', label: s.label }])),
        defaultItemProps: {},
        getItemSummary: (item: unknown, i?: number) => summaryOf(item, i, f.subs.map((s) => s.sub)),
      } as Field;
    case 'strings':
      return {
        type: 'array',
        label: f.label,
        arrayFields: { value: { type: 'text', label: f.label } },
        defaultItemProps: { value: '' },
        getItemSummary: (item: unknown, i?: number) => summaryOf(item, i, ['value']),
      } as Field;
  }
}

type ItemProps = Record<string, unknown> & { id: string; _shape?: string; _src?: PuckItemSrc };

// 共用块面板顶上那句话（只读的说明，不是输入框）。
const SHARED_NOTE: Field = {
  type: 'custom',
  label: 'Shared section',
  render: () => (
    <p data-editor-shared-note style={{ margin: 0, fontSize: 13, lineHeight: 1.5, color: '#475467' }}>
      This section is shared with other pages, so it can&apos;t be changed, moved or removed here yet.
    </p>
  ),
} as Field;

/**
 * 画布上的一块：真站那一个组件（经 `SectionRenderer`），不是示意图。
 *
 * 数据的底是**归一化之后**那一块（`_src.view`，跟真页面同一份：列表已升格、`data-has-*` 已算好），
 * 老板改过的字段才换成新值 —— 用的是存盘时同一个合法（§dataFromProps），画布和落盘不会各说各的。
 */
function CanvasBlock({ component, props, locale }: { component: EditorComponent; props: ItemProps; locale: string }) {
  const src = props._src;
  // 复制出来的条目跟原件共用一份 `_src.view`，画布上的 `data-block-id` 换成它自己的 id（存盘时它也会拿到新 id）。
  const baseView = (src?.view || { type: component.type }) as unknown as BlockConfig;
  const view = { ...baseView, id: src && props.id === src.pid ? baseView.id : props.id } as BlockConfig;
  let data: Record<string, unknown>;
  if (src) {
    const baseData = (src.locked ? view.data : src.entry?.data) || {};
    const initial = fieldProps(component, baseData);
    const merged = dataFromProps(component, baseData, props);
    data = { ...((view.data as Record<string, unknown>) || {}) };
    for (const f of component.fields) {
      if (deepEqual(props[f.slot], initial[f.slot])) continue;
      if (f.slot in merged) data[f.slot] = merged[f.slot]; else delete data[f.slot];
    }
  } else {
    data = dataFromProps(component, {}, props);
  }
  const block = { ...view, data, shape: props._shape || undefined } as BlockConfig;
  if (view.hidden) {
    // `hidden` 整条由 #1411 退役；在那之前它还在页面 JSON 里，画布上给一条看得见的占位，别让它成为
    // 一个点不中的空条目。
    return (
      <div data-editor-hidden style={{ padding: '10px 16px', fontSize: 13, color: '#667085', background: '#f2f4f7' }}>
        {component.label} — hidden on the live page
      </div>
    );
  }
  return <SectionRenderer blocks={[block]} locale={locale} />;
}

export function buildConfig(schema: EditorSchema, locale: string): Config {
  const components: Record<string, Config['components'][string]> = {};
  for (const c of schema.components) {
    const fields: Fields = {};
    for (const f of c.fields) fields[f.slot] = puckField(f);
    fields._shape = {
      type: 'select',
      label: 'Layout',
      // 选项 = 形态子目录去掉候选（schema 里已经过滤好）。`needs` 不为空的形态，这个块缺那些槽位时
      // 构建会落回默认 —— 选项上写明，别让老板选了之后以为坏了。
      options: c.shapes.map((s) => ({ value: s.name, label: s.needs.length ? `${s.name} (needs ${s.needs.join(', ')})` : s.name })),
    };
    const defaultProps: Record<string, unknown> = { ...fieldProps(c, {}) };
    if (c.defaultShape) defaultProps._shape = c.defaultShape;
    components[c.type] = {
      label: c.label,
      fields,
      defaultProps,
      // 共用块：内容 / 位置 / 删除都归 #1406，这里一样都不许动（复制会造出同 id 的第二条 `{ref}`）。
      // 🔴 不关 `edit`：Puck 对 `edit: false` 的块整块禁用、点都点不中 —— 那就是「点了没反应」。
      //    留着能选中，字段按条目上的 `readOnly` 灰掉，面板顶上一句话说为什么。
      resolvePermissions: (data: { props?: ItemProps }) => (data.props?._src?.locked
        ? { drag: false, duplicate: false, delete: false }
        : {}),
      resolveFields: (data: { props?: ItemProps }) => (data.props?._src?.locked
        ? { _shared: SHARED_NOTE, ...fields }
        : fields),
      render: (props: ItemProps) => <CanvasBlock component={c} props={props} locale={locale} />,
    } as unknown as Config['components'][string];
  }
  // 根上不放字段：Puck 默认给根一个 `title` 输入框，而页面标题 / 外壳归 #1405 —— 留着它就是一个
  // 「改了、保存、什么都没变」的输入框。
  return { components, root: { fields: {} } };
}

type Status = { kind: 'idle' | 'saving' | 'saved' | 'error'; text: string };

function SaveButton({ onSave, status }: { onSave: (d: Data) => void; status: Status }) {
  const data = usePuck((s) => s.appState.data);
  // 🔴 按钮上写的是 Save，因为它做的就是保存（#1409 票正文 §做什么 9 三选一的「等于保存」）。
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

export default function EditorApp({ locale, page, raw, baseHash, schema, initialData, trustedOrigin }: EditorAppProps) {
  const [status, setStatus] = useState<Status>({ kind: 'idle', text: '' });
  const statusRef = useRef(status);
  statusRef.current = status;

  const config = useMemo(() => buildConfig(schema, locale), [schema, locale]);

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
    let json: Record<string, unknown>;
    try {
      json = puckToPage({ raw, data: data as never, initial: initialData, schema, slug: page });
    } catch (e) {
      setStatus({ kind: 'error', text: `Could not save: ${(e as Error).message}` });
      return;
    }
    if (deepEqual(json, raw)) {
      setStatus({ kind: 'idle', text: 'Nothing to save.' });
      return;
    }
    setStatus({ kind: 'saving', text: 'Saving…' });
    // 不带文件路径：写哪个文件由站里的 `scripts/write-page.js` 按 page/locale 自己算（它文件头说为什么）。
    window.parent.postMessage({ type: 'ai1st:editor-save', page, locale, json, baseHash }, trustedOrigin);
  }

  let empty: ReactNode = null;
  if (schema.components.length === 0) {
    empty = (
      <div style={{ padding: 32, fontFamily: 'system-ui, sans-serif' }} data-editor-empty>
        This site has no sections the editor knows about.
      </div>
    );
  }
  if (empty) return empty;

  return (
    <div data-editor-root style={{ height: '100vh' }}>
      <Puck
        config={config}
        data={initialData as unknown as Data}
        iframe={{ enabled: true, syncHostStyles: true, waitForStyles: true }}
        overrides={{
          headerActions: () => <SaveButton onSave={save} status={status} />,
        }}
        onPublish={save}
      />
    </div>
  );
}
