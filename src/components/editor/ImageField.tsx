'use client';

// #1693 —— 面板上的一格「图片」：缩略图 + Change + 图片说明（alt），可选的图再给一个 Remove。
//
// 值就是数据里那个图片对象 `{imageUrl, alt}`（editor-convert.js §toProp 的 `image`：整份对象进出）。
//   · Change  → `InlineApi.pickImage`（EditorApp：postMessage `ai1st:pick-image` 给 dashboard，它开图片库弹窗）→ 换 `imageUrl`，
//               对象里别的键原样留着；原来没有图就是 `{imageUrl, alt: ''}`。
//   · 图片说明 → 只换 `alt`。没有图时灰着（说明的是那张图）。
//   · Remove  → undefined（顶层：存盘删掉这个键；列表项：这一项不再有这个键）。
// 画布里点图走的是同一个 `pickImage`（InlineEdit.tsx §onClick 的图片那一支）。这个页面照旧一个请求都不发：缩略图是 `<img>`，跟画布上那张同一个地址。
//
// #1694 —— 成排的图，两种：
//   · §imageUrlField：项里一格图片地址（点评平台的 `logoUrl`）—— 值就是地址字符串，缩略图 + Change（+ Remove），没有说明。
//   · §imageRowField：一列图（`logos.items`、`hero.band`、`proof.avatars`，项本身就是一张图）—— 每项缩略图 + Change + 名字 / 说明
//     （`alt`）+ 链接（`href`），把手拖动排序、✕ 删；「+ Add」先开图片库，选了图才加一项（放最后）。条数夹在 `min` / `max` 之间，
//     到了就把按钮灰掉。删空了面板上明说「这一排在页面上不显示」—— 块对空的一列是整排不画（logos 块整块不画）。
//     不是对象的项（畸形数据）原样留在原位，那一行不可改。
//
// #1707 —— 子字段带 `required`（槽的 `itemRequires` 点了它，editor-schema §imageRowSubs；今天只有 logos 块的名字）：
//     「+ Add」选完图，新那一项的这一格拿到焦点；哪一项这一格空着，输入框标红 + 下面一句「This logo still needs a name.」。
//     不拦存盘（PM 裁定）—— 空着存得下，只是 AI 改这一页会被退回（`scope: 'edit'` 拒空的必填项），所以在这里当场说出来。

import { useContext, useEffect, useRef, useState, type CSSProperties } from 'react';
import { FieldLabel, type Field } from '@puckeditor/core';
import { InlineApiContext } from './InlineEdit';

type Img = Record<string, unknown> & { imageUrl: string; alt?: unknown };

const BTN = {
  padding: '4px 10px', fontSize: 13, borderRadius: 6, border: '1px solid #d0d5dd', background: '#fff', color: '#344054',
  cursor: 'pointer', fontFamily: 'inherit',
} as const;
const INPUT = { width: '100%', padding: '6px 8px', fontSize: 14, border: '1px solid #d0d5dd', borderRadius: 6, fontFamily: 'inherit' } as const;

function asImg(v: unknown): Img | null {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return null;
  const o = v as Record<string, unknown>;
  return typeof o.imageUrl === 'string' && o.imageUrl ? (o as Img) : null;
}

export function ImageControl({ label, optional, value, onChange, readOnly }: {
  label: string; optional: boolean; value: unknown; onChange: (v: unknown) => void; readOnly?: boolean;
}) {
  const api = useContext(InlineApiContext);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState('');
  const img = asImg(value);
  const off = !!readOnly || !api || api.locked || busy;

  async function change() {
    if (!api || off) return;
    setBusy(true);
    setNote('');
    const r = await api.pickImage(img ? img.imageUrl : '');
    setBusy(false);
    if (r.ok) onChange({ ...(img || { alt: '' }), imageUrl: r.url });
    else if (!r.cancelled) setNote(r.message);
  }

  return (
    <div data-editor-image={label}>
      <FieldLabel label={label} el="div" readOnly={readOnly} />
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
        <div style={{ width: 72, height: 54, flex: 'none', borderRadius: 6, border: '1px solid #e4e7ec', background: '#f2f4f7', overflow: 'hidden', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          {img
            // eslint-disable-next-line @next/next/no-img-element
            ? <img data-editor-image-thumb="" src={img.imageUrl} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
            : <span data-editor-image-empty="" style={{ fontSize: 12, color: '#98a2b3' }}>No image</span>}
        </div>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          <button type="button" data-editor-image-change="" disabled={off} onClick={() => { void change(); }}
            style={{ ...BTN, cursor: off ? 'default' : 'pointer', opacity: off ? 0.6 : 1 }}>
            {busy ? 'Choosing…' : 'Change'}
          </button>
          {optional && img && (
            <button type="button" data-editor-image-remove="" disabled={off} onClick={() => onChange(undefined)}
              style={{ ...BTN, cursor: off ? 'default' : 'pointer', opacity: off ? 0.6 : 1 }}>
              Remove
            </button>
          )}
        </div>
      </div>
      <FieldLabel label="Image description" el="div" readOnly={readOnly || !img} />
      <input type="text" data-editor-image-alt="" value={img && typeof img.alt === 'string' ? img.alt : ''}
        readOnly={!!readOnly} disabled={!img}
        placeholder={img ? 'Describe the image for search engines and screen readers' : 'Choose an image first'}
        onChange={(e) => { if (img) onChange({ ...img, alt: e.target.value }); }}
        style={INPUT} />
      {note && <p data-editor-image-note="" style={{ margin: '6px 0 0', fontSize: 13, color: '#b42318' }}>{note}</p>}
    </div>
  );
}

/** 一格图片字段（顶层的 `control: 'image'`，或列表项里 `image: true` 的子字段）。 */
export function imageField(label: string, optional: boolean): Field {
  return {
    type: 'custom',
    label,
    render: ({ value, onChange, readOnly }: { value: unknown; onChange: (v: unknown) => void; readOnly?: boolean }) => (
      <ImageControl label={label} optional={optional} value={value} onChange={onChange} readOnly={readOnly} />
    ),
  } as unknown as Field;
}

type Sub = { sub: string; label: string; image?: boolean; url?: boolean; optional?: boolean; required?: boolean };

/** #1694 —— 画一个缩略图框（有图画图，没图写 No image）。 */
function Thumb({ src, size }: { src: string; size: { width: number; height: number } }) {
  return (
    <div style={{ ...size, flex: 'none', borderRadius: 6, border: '1px solid #e4e7ec', background: '#f2f4f7', overflow: 'hidden', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      {src
        // eslint-disable-next-line @next/next/no-img-element
        ? <img data-editor-image-thumb="" src={src} alt="" style={{ width: '100%', height: '100%', objectFit: 'contain' }} />
        : <span data-editor-image-empty="" style={{ fontSize: 12, color: '#98a2b3' }}>No image</span>}
    </div>
  );
}

/** #1694 —— 项里一格图片地址（值是字符串）：缩略图 + Change，可选的再给 Remove。 */
export function ImageUrlControl({ label, optional, value, onChange, readOnly }: {
  label: string; optional: boolean; value: unknown; onChange: (v: unknown) => void; readOnly?: boolean;
}) {
  const api = useContext(InlineApiContext);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState('');
  const url = typeof value === 'string' ? value : '';
  const off = !!readOnly || !api || api.locked || busy;
  async function change() {
    if (!api || off) return;
    setBusy(true);
    setNote('');
    const r = await api.pickImage(url);
    setBusy(false);
    if (r.ok) onChange(r.url);
    else if (!r.cancelled) setNote(r.message);
  }
  return (
    <div data-editor-image={label} data-editor-image-url="">
      <FieldLabel label={label} el="div" readOnly={readOnly} />
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <Thumb src={url} size={{ width: 72, height: 54 }} />
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          <button type="button" data-editor-image-change="" disabled={off} onClick={() => { void change(); }}
            style={{ ...BTN, cursor: off ? 'default' : 'pointer', opacity: off ? 0.6 : 1 }}>
            {busy ? 'Choosing…' : 'Change'}
          </button>
          {optional && url && (
            <button type="button" data-editor-image-remove="" disabled={off} onClick={() => onChange(undefined)}
              style={{ ...BTN, cursor: off ? 'default' : 'pointer', opacity: off ? 0.6 : 1 }}>
              Remove
            </button>
          )}
        </div>
      </div>
      {note && <p data-editor-image-note="" style={{ margin: '6px 0 0', fontSize: 13, color: '#b42318' }}>{note}</p>}
    </div>
  );
}

/** #1694 —— 项里一格图片地址字段（`url: true` 的子字段）。 */
export function imageUrlField(label: string, optional: boolean): Field {
  return {
    type: 'custom',
    label,
    render: ({ value, onChange, readOnly }: { value: unknown; onChange: (v: unknown) => void; readOnly?: boolean }) => (
      <ImageUrlControl label={label} optional={optional} value={value} onChange={onChange} readOnly={readOnly} />
    ),
  } as unknown as Field;
}

// 不是对象的项被转换器包成 `{__orig: …}`（editor-convert §toProp），存盘原样还原 —— 那一行不可改，改了也存不下去。
const isItem = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v) && !('__orig' in v);

/** #1694 —— 一列图：每项缩略图 + Change + 名字 / 说明 + 链接；能加（先选图）、删、拖动排序；条数夹在 `min` / `max` 之间。 */
export function ImageRowControl({ label, subs, min, max, value, onChange, readOnly }: {
  label: string; subs: Sub[]; min?: number; max?: number; value: unknown; onChange: (v: unknown[]) => void; readOnly?: boolean;
}) {
  const api = useContext(InlineApiContext);
  const [busy, setBusy] = useState<number | 'add' | null>(null);
  const [note, setNote] = useState('');
  const [dragFrom, setDragFrom] = useState<number | null>(null);
  const [focusAt, setFocusAt] = useState<number | null>(null);
  const firstInput = useRef(new Map<number, HTMLInputElement>());
  const list = Array.isArray(value) ? value : [];
  const urlSub = subs.find((s) => s.image);
  const urlKey = (urlSub || { sub: 'imageUrl' }).sub;
  const noun = urlSub && urlSub.label ? urlSub.label.toLowerCase() : 'image';
  const text = subs.filter((s) => !s.image);
  const firstRequired = text.find((s) => s.required);
  // 新加的那一项画出来之后（值是 Puck 回灌的，晚一拍）把焦点给它的必填格。
  useEffect(() => {
    if (focusAt === null || focusAt >= list.length) return;
    const el = firstInput.current.get(focusAt);
    if (el) el.focus();
    setFocusAt(null);
  }, [focusAt, list.length]);
  const off = !!readOnly || !api || api.locked || busy !== null;
  const canAdd = !off && (max === undefined || list.length < max);
  const canRemove = !off && list.length > (min ?? 0);
  const btn = (on: boolean): CSSProperties => ({ ...BTN, cursor: on ? 'pointer' : 'default', opacity: on ? 1 : 0.6 });

  async function pick(at: number | 'add') {
    if (!api || off) return;
    setBusy(at);
    setNote('');
    const cur = at === 'add' ? '' : (isItem(list[at]) && typeof list[at][urlKey] === 'string' ? (list[at][urlKey] as string) : '');
    const r = await api.pickImage(cur);
    setBusy(null);
    if (!r.ok) { if (!r.cancelled) setNote(r.message); return; }
    if (at === 'add') {
      const fresh: Record<string, unknown> = { [urlKey]: r.url };
      if (text.some((s) => s.sub === 'alt')) fresh.alt = '';
      onChange([...list, fresh]);
      if (firstRequired) setFocusAt(list.length);
      return;
    }
    const next = list.slice();
    next[at] = { ...(list[at] as Record<string, unknown>), [urlKey]: r.url };
    onChange(next);
  }
  function setText(i: number, sub: string, v: string) {
    const next = list.slice();
    const item = { ...(list[i] as Record<string, unknown>) };
    // 可选的那格（`href?`）清空 = 删掉这个键，不留 `"href": ""`；`alt` 是名字 / 说明，留着空串（必填的那种照样是个键）。
    if (v === '' && sub !== 'alt') delete item[sub]; else item[sub] = v;
    next[i] = item;
    onChange(next);
  }
  function move(from: number, to: number) {
    if (from === to) return;
    const next = list.slice();
    const [x] = next.splice(from, 1);
    next.splice(to, 0, x);
    onChange(next);
  }

  return (
    <div data-editor-image-row={label}>
      <FieldLabel label={label} el="div" readOnly={readOnly} />
      {list.map((it, i) => {
        const ok = isItem(it);
        const src = ok && typeof it[urlKey] === 'string' ? (it[urlKey] as string) : '';
        return (
          <div key={i} data-editor-image-item={i}
            onDragOver={(e) => { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; }}
            onDrop={(e) => { e.preventDefault(); if (dragFrom !== null && !off) move(dragFrom, i); setDragFrom(null); }}
            style={{ display: 'flex', gap: 8, alignItems: 'flex-start', padding: '8px 0', borderTop: i ? '1px solid #eaecf0' : 'none', opacity: dragFrom === i ? 0.5 : 1 }}>
            {/* 只有把手可拖：整行可拖的话，输入框里没法用鼠标选字（同 StringListControl）。 */}
            <span data-editor-image-handle="" draggable={!off} aria-hidden="true" title="Drag to reorder"
              onDragStart={(e) => { setDragFrom(i); e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', String(i)); }}
              onDragEnd={() => setDragFrom(null)}
              style={{ cursor: off ? 'default' : 'grab', color: '#98a2b3', padding: '14px 2px 0', userSelect: 'none' }}>⋮⋮</span>
            <Thumb src={src} size={{ width: 56, height: 42 }} />
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ display: 'flex', gap: 6, marginBottom: text.length ? 6 : 0 }}>
                <button type="button" data-editor-image-change="" disabled={off || !ok} onClick={() => { void pick(i); }} style={btn(!off && ok)}>
                  {busy === i ? 'Choosing…' : 'Change'}
                </button>
                <button type="button" data-editor-image-remove="" disabled={!canRemove} aria-label={`Remove ${label} ${i + 1}`}
                  title={canRemove ? 'Remove' : `At least ${min} needed`}
                  onClick={() => onChange(list.filter((_, j) => j !== i))} style={btn(canRemove)}>✕</button>
              </div>
              {text.map((s) => {
                const val = ok && typeof it[s.sub] === 'string' ? (it[s.sub] as string) : '';
                const missing = ok && !!s.required && !val.trim();
                return (
                  <div key={s.sub}>
                    <input type="text" data-editor-image-text={s.sub} aria-label={`${s.label} ${i + 1}`}
                      placeholder={s.required ? `${s.label} (required)` : s.label}
                      ref={s === firstRequired ? (el) => { if (el) firstInput.current.set(i, el); else firstInput.current.delete(i); } : undefined}
                      value={val} readOnly={!!readOnly || !ok} required={!!s.required} aria-required={s.required ? true : undefined}
                      aria-invalid={missing ? true : undefined}
                      onChange={(e) => setText(i, s.sub, e.target.value)}
                      style={{ ...INPUT, marginBottom: 4, ...(missing ? { borderColor: '#f04438' } : {}) }} />
                    {missing && (
                      <p data-editor-image-missing={s.sub} style={{ margin: '0 0 4px', fontSize: 12, color: '#b42318' }}>
                        This {noun} still needs a {s.label.toLowerCase()}.
                      </p>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        );
      })}
      {!list.length && (
        <p data-editor-image-row-empty="" style={{ margin: '4px 0 8px', fontSize: 13, color: '#475467' }}>
          No images here, so this row doesn&apos;t show on the page. Add one to bring it back.
        </p>
      )}
      <button type="button" data-editor-image-add="" disabled={!canAdd} onClick={() => { void pick('add'); }} style={btn(canAdd)}
        title={canAdd || off ? undefined : `At most ${max}`}>
        {busy === 'add' ? 'Choosing…' : '+ Add'}
      </button>
      {note && <p data-editor-image-note="" style={{ margin: '6px 0 0', fontSize: 13, color: '#b42318' }}>{note}</p>}
    </div>
  );
}

/** #1694 —— 一列图字段（顶层 `imageRow` 的 list，或对象字段里 `imageRow` 的子字段）。 */
export function imageRowField(label: string, subs: Sub[], min?: number, max?: number): Field {
  return {
    type: 'custom',
    label,
    render: ({ value, onChange, readOnly }: { value: unknown; onChange: (v: unknown[]) => void; readOnly?: boolean }) => (
      <ImageRowControl label={label} subs={subs} min={min} max={max} value={value} onChange={onChange} readOnly={readOnly} />
    ),
  } as unknown as Field;
}
