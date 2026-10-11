'use client';

// #1693 —— 面板上的一格「图片」：缩略图 + Change + 图片说明（alt），可选的图再给一个 Remove。
//
// 值就是数据里那个图片对象 `{imageUrl, alt}`（editor-convert.js §toProp 的 `image`：整份对象进出）。
//   · Change  → `InlineApi.pickImage`（EditorApp：postMessage `ai1st:pick-image` 给 dashboard，它开图片库弹窗）→ 换 `imageUrl`，
//               对象里别的键原样留着；原来没有图就是 `{imageUrl, alt: ''}`。
//   · 图片说明 → 只换 `alt`。没有图时灰着（说明的是那张图）。
//   · Remove  → undefined（顶层：存盘删掉这个键；列表项：这一项不再有这个键）。
// 画布里点图走的是同一个 `pickImage`（InlineEdit.tsx §onClick 的图片那一支）。这个页面照旧一个请求都不发：缩略图是 `<img>`，跟画布上那张同一个地址。

import { useContext, useState } from 'react';
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
