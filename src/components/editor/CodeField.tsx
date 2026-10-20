'use client';

// #1833 —— 一格「代码」：Custom HTML 块的 `html`（manifest `kind: code`，editor-schema §fieldsOf 出 `control: 'code'`）。
//    dashboard 的编辑器里它住在「Edit HTML」弹窗里（§EditHtmlDialog.tsx，r5 Chris 退回：不开右栏）；模板那份旧编辑器仍是右栏一格（§codeField）。
//
// 一个 textarea 叠在一层自己着色的 `<pre>` 上：textarea 的字是透明的（光标照常可见），老板看到的颜色来自底下那一层。
// 着色只认几类记号（注释 / 标签名 / 属性名 / 属性值），不解析、不校验 ——
// 那是老板的代码，存盘时 `scripts/lib/custom-html.js` 整理一次，这里只管看得清。
// 🔴 着色层只用 React 文本节点画（`<span>{text}</span>`），**不经 dangerouslySetInnerHTML**：块的 html 在 dashboard 里只有
//    `sanitizeForCanvas` 那一条路能落成 DOM（画布，`blocks/custom-html/Section.tsx`），面板上它永远是文字。
// 📌 不装高亮库（票面的装包清单里没有它）：几十行正则够看，装一个编辑器包要另过一遍体积和 dedupe。

import { useLayoutEffect, useRef, type CSSProperties, type ReactNode } from 'react';
import { FieldLabel, type Field } from '@puckeditor/core';

type Token = { t: string; c?: string };

const COLORS: Record<string, string> = {
  comment: '#6a737d',
  tag: '#22863a',
  attr: '#6f42c1',
  value: '#032f62',
  punct: '#6a737d',
};

function pushText(out: Token[], t: string, c?: string) {
  if (t) out.push(c ? { t, c } : { t });
}

/** 一个标签（`<div class="x">`）拆成 括号 / 名字 / 属性名 / 等号 / 值。 */
function tagTokens(tag: string, out: Token[]) {
  const head = /^(<\/?)([^\s/>]*)/.exec(tag);
  if (!head) { pushText(out, tag, 'tag'); return; }
  pushText(out, head[1], 'punct');
  pushText(out, head[2], 'tag');
  const attr = /(\s+)([^\s=/>]+)(\s*=\s*)?("[^"]*"?|'[^']*'?|[^\s>]+)?|(\/?>)|([\s\S])/g;
  const rest = tag.slice(head[0].length);
  let m: RegExpExecArray | null;
  while ((m = attr.exec(rest))) {
    if (m[5]) { pushText(out, m[5], 'punct'); continue; }
    if (m[6]) { pushText(out, m[6]); continue; }
    pushText(out, m[1]);
    pushText(out, m[2], 'attr');
    pushText(out, m[3] || '', 'punct');
    pushText(out, m[4] || '', 'value');
  }
}

export function htmlTokens(src: string): Token[] {
  const out: Token[] = [];
  const re = /(<!--[\s\S]*?(?:-->|$))|(<\/?[A-Za-z][^<>]*>?)/g;
  let at = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(src))) {
    pushText(out, src.slice(at, m.index));
    if (m[1]) pushText(out, m[1], 'comment');
    else tagTokens(m[2], out);
    at = m.index + m[0].length;
  }
  pushText(out, src.slice(at));
  return out;
}

const BOX: CSSProperties = {
  margin: 0,
  padding: 8,
  fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
  fontSize: 13,
  lineHeight: 1.5,
  whiteSpace: 'pre-wrap',
  overflowWrap: 'anywhere',
  tabSize: 2,
  boxSizing: 'border-box',
  border: '1px solid #d0d5dd',
  borderRadius: 6,
};

/** `label` 空 ⟹ 不画 Puck 的字段标题（弹窗在 Puck 外面，自己画标题）。 */
export function CodeControl({ label, slot, value, onChange, readOnly, hint, rows = 12 }: {
  label: string; slot: string; value: unknown; onChange: (v: string) => void; readOnly?: boolean; hint?: string; rows?: number;
}) {
  const text = typeof value === 'string' ? value : '';
  const preRef = useRef<HTMLPreElement>(null);
  const areaRef = useRef<HTMLTextAreaElement>(null);
  const sync = () => {
    if (preRef.current && areaRef.current) {
      preRef.current.scrollTop = areaRef.current.scrollTop;
      preRef.current.scrollLeft = areaRef.current.scrollLeft;
    }
  };
  useLayoutEffect(sync, [text]);
  const tokens = htmlTokens(text);
  const painted: ReactNode[] = tokens.map((k, i) => (k.c ? <span key={i} style={{ color: COLORS[k.c] }}>{k.t}</span> : k.t));
  // 末尾是换行时 <pre> 不给最后那一行留高度，textarea 会 —— 补一个空格让两层一样高。
  if (text.endsWith('\n') || text === '') painted.push(' ');
  return (
    <div data-editor-code-field={slot}>
      {label ? <FieldLabel label={label} el="div" readOnly={readOnly} /> : null}
      <div style={{ position: 'relative' }}>
        <pre ref={preRef} aria-hidden="true" data-editor-code-paint={slot}
          style={{ ...BOX, position: 'absolute', inset: 0, overflow: 'hidden', color: '#24292e', background: readOnly ? '#f9fafb' : '#fff', pointerEvents: 'none' }}>
          {painted}
        </pre>
        <textarea
          ref={areaRef}
          data-editor-code={slot}
          value={text}
          onChange={(e) => onChange(e.target.value)}
          onScroll={sync}
          readOnly={readOnly}
          spellCheck={false}
          autoCapitalize="off"
          autoComplete="off"
          wrap="soft"
          rows={rows}
          style={{ ...BOX, position: 'relative', display: 'block', width: '100%', resize: 'vertical', color: 'transparent', caretColor: '#111', background: 'transparent', outline: 'none' }}
        />
      </div>
      {hint ? <div style={{ fontSize: 12, color: '#667085', marginTop: 4 }}>{hint}</div> : null}
    </div>
  );
}

export const HTML_HINT = "Scripts don't run in the editor. They run on your preview link and your website.";

/** 一格代码字段（`control: 'code'`），按 HTML 着色。 */
export function codeField(label: string, slot: string): Field {
  return {
    type: 'custom',
    label,
    render: ({ value, onChange, readOnly }: { value: unknown; onChange: (v: string) => void; readOnly?: boolean }) => (
      <CodeControl label={label} slot={slot} value={value} onChange={onChange} readOnly={readOnly} hint={HTML_HINT} />
    ),
  } as unknown as Field;
}
