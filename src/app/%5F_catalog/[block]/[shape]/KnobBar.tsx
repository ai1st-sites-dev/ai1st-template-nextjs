'use client';

// #1463 —— 单格页上「预设 + 旋钮」那一类块（今天是 hero-new）的工具条：预设一排 + 旋钮 + 修饰（布尔 / 底色）
// + 部件开关 + 细节（词表子字段，eyebrow 五式）。顺序照 manifest 的声明（排布 → 修饰 → 部件 → 细节）。
//
// 🔴 **它不持有状态，只改地址栏**：每点一下就换一个 `?…` 重新打开这一页，页面由服务端按地址栏渲染
//    （`page.dev.tsx` §knobOverrides）。所以「新窗口」单开看到的和 admin 嵌着、把同样的参数带进来时看到的
//    按构造是同一个东西 —— 没有第二份「开关在客户端怎么拼数据」的实现（CellOptions.tsx 那一套是外壳区块的）。
// 🔴 被 admin 嵌着（`embed=1`）时不画 —— admin 那条块级工具条认枚举旋钮是 #1462 的活（PM #1463 r3 b）。

import { useEffect, useState } from 'react';

export interface KnobBarProps {
  knobs: { name: string; values: string[] }[];
  presets: { name: string; shape: string; knobs: Record<string, string> }[];
  booleans: string[];
  swatches: string[] | null;
  parts: string[];
  choices: { key: string; values: string[] }[];
  current: {
    knobs: Record<string, string>;
    preset: string;
    booleans: Record<string, boolean>;
    bg: string;
    parts: string[];
    choices: Record<string, string>;
  };
}

const bar = {
  display: 'flex', flexWrap: 'wrap' as const, gap: 10, alignItems: 'center', padding: '6px 10px',
  font: '12px system-ui, sans-serif', background: '#f4f4f5', borderBottom: '1px solid #d4d4d8', color: '#3f3f46',
};
const sep = { width: 1, alignSelf: 'stretch', background: '#d4d4d8' };
const lab = { display: 'inline-flex', gap: 4, alignItems: 'center' };

export default function KnobBar({ knobs, presets, booleans, swatches, parts, choices, current }: KnobBarProps) {
  const [ready, setReady] = useState(false);
  useEffect(() => { setReady(true); }, []);

  const go = (edit: (q: URLSearchParams) => void) => {
    const q = new URLSearchParams(window.location.search);
    edit(q);
    window.location.search = q.toString();
  };
  const setKnobs = (vals: Record<string, string>) => go((q) => { for (const [k, v] of Object.entries(vals)) q.set(k, v); });
  const toggleBool = (b: string, on: boolean) => go((q) => {
    const s = new Set((q.get('opt') || '').split(',').filter(Boolean));
    if (on) s.add(b); else s.delete(b);
    if (s.size) q.set('opt', Array.from(s).join(',')); else q.delete('opt');
  });
  const togglePart = (p: string, on: boolean) => go((q) => {
    const s = new Set(current.parts);
    if (on) s.add(p); else s.delete(p);
    q.set('parts', Array.from(s).join(',') || '-');
  });

  return (
    <div style={bar} data-catalog-knobs="">
      <span>preset:</span>
      {presets.map((p) => (
        <label key={p.name} style={lab}>
          <input type="radio" name="catalog-preset" data-catalog-preset={p.name} disabled={!ready}
            checked={current.preset === p.name} onChange={() => setKnobs(p.knobs)} />
          <span>{p.name}</span>
        </label>
      ))}
      <span data-catalog-custom={current.preset === 'custom' ? 'true' : 'false'} style={{ fontWeight: current.preset === 'custom' ? 700 : 400 }}>custom</span>
      <span style={sep} />
      {knobs.map((k) => (
        <span key={k.name} style={lab}>
          <b>{k.name}</b>
          {k.values.map((v) => (
            <label key={v} style={lab}>
              <input type="radio" name={`catalog-knob-${k.name}`} data-catalog-knob={`${k.name}=${v}`} disabled={!ready}
                checked={current.knobs[k.name] === v} onChange={() => setKnobs({ [k.name]: v })} />
              <span>{v}</span>
            </label>
          ))}
        </span>
      ))}
      <span style={sep} />
      {booleans.map((b) => (
        <label key={b} style={lab}>
          <input type="checkbox" data-catalog-option={b} disabled={!ready} checked={!!current.booleans[b]}
            onChange={(e) => toggleBool(b, e.target.checked)} />
          <span>{b}</span>
        </label>
      ))}
      {swatches ? (
        <span style={lab}>
          <b>bg</b>
          {swatches.map((c) => (
            <button key={c} type="button" title={c} data-catalog-bg={c} disabled={!ready} onClick={() => go((q) => q.set('bg', c))}
              style={{ width: 18, height: 18, borderRadius: 4, cursor: 'pointer', padding: 0,
                border: current.bg === c ? '2px solid #1d4ed8' : '1px solid #a1a1aa', background: c === 'brand' ? 'var(--x-primary)' : c }} />
          ))}
          <input type="color" aria-label="任意颜色" data-catalog-bg-input="" disabled={!ready}
            value={/^#[0-9a-f]{6}$/i.test(current.bg) ? current.bg.toLowerCase() : '#ffffff'}
            onChange={(e) => go((q) => q.set('bg', e.target.value.toLowerCase()))} style={{ width: 26, height: 20, padding: 0, border: 'none' }} />
        </span>
      ) : null}
      {parts.length ? <span style={sep} /> : null}
      {parts.map((p) => (
        <label key={p} style={lab}>
          <input type="checkbox" data-catalog-part={p} disabled={!ready} checked={current.parts.includes(p)}
            onChange={(e) => togglePart(p, e.target.checked)} />
          <span>{p}</span>
        </label>
      ))}
      {choices.length ? <span style={sep} /> : null}
      {choices.map((c) => (
        <span key={c.key} style={lab}>
          <b>{c.key.split('.')[0]}</b>
          {c.values.map((v) => (
            <label key={v} style={lab}>
              <input type="radio" name={`catalog-choice-${c.key}`} data-catalog-choice={`${c.key}=${v}`} disabled={!ready}
                checked={current.choices[c.key] === v} onChange={() => go((q) => q.set(c.key, v))} />
              <span>{v}</span>
            </label>
          ))}
        </span>
      ))}
    </div>
  );
}
