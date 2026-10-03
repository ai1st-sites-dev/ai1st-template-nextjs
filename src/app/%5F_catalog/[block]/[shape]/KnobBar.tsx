'use client';

// #1463 —— 单格页上「预设 + 旋钮」那一类块（今天是 hero）的工具条：预设一排 + 旋钮 + 修饰（布尔 / 底色）
// + 部件开关 + 细节（词表子字段，eyebrow 五式）。顺序照 manifest 的声明（排布 → 修饰 → 部件 → 细节）。
//
// 🔴 **它不持有状态，只改地址栏**：每点一下就换一个 `?…` 重新打开这一页，页面由服务端按地址栏渲染
//    （`page.dev.tsx` §knobOverrides）。所以「新窗口」单开看到的和 admin 嵌着、把同样的参数带进来时看到的
//    按构造是同一个东西 —— 没有第二份「开关在客户端怎么拼数据」的实现（CellOptions.tsx 那一套是外壳区块的）。
// 🔴 被 admin 嵌着（`embed=1`）时不画 —— admin 那条块级工具条认枚举旋钮是 #1462 的活（PM #1463 r3 b）。

import { useEffect, useState, type ReactNode } from 'react';
import type { BgValue } from '../../../../../scripts/lib/contrast.js';
import BgPicker from '@/components/BgPicker';
import { arrangeToolbar } from '../../../../../scripts/lib/block-knobs.js';

export interface KnobBarProps {
  knobs: { name: string; values: string[] }[];
  /** #1483 —— `colors`：点这个预设时各颜色槽该是什么（null = 清掉；空对象 = 不碰，没有带颜色预设的块全是空对象）。 */
  /** #1487 —— `parts`：这个预设要的部件（Hiring 的 join）；点它时没开的就打开，已开的不动。别的预设是 []（点它们不关部件）。 */
  presets: { name: string; shape: string; knobs: Record<string, string>; colors: Record<string, BgValue | null>; parts: string[] }[];
  booleans: string[];
  /** #1483 —— 每个颜色槽一格（顺序 = manifest 声明顺序），地址参数名 = 槽名。 */
  colors: { slot: string; swatches: string[] }[];
  parts: string[];
  choices: { key: string; values: string[] }[];
  /** #1532 —— manifest 顶层 `toolbarGroups`（block-knobs.js §toolbarGroupsOf）。[] ⟹ 不分组。 */
  groups: string[][];
  current: {
    knobs: Record<string, string>;
    preset: string;
    booleans: Record<string, boolean>;
    colors: Record<string, BgValue | null>;
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

export default function KnobBar({ knobs, presets, booleans, colors, parts, choices, groups, current }: KnobBarProps) {
  const [ready, setReady] = useState(false);
  useEffect(() => { setReady(true); }, []);

  const go = (edit: (q: URLSearchParams) => void) => {
    const q = new URLSearchParams(window.location.search);
    edit(q);
    // #1483 —— 地址没变就不重开（点一个已经亮着的预设时走到这里）。
    if (q.toString() === new URLSearchParams(window.location.search).toString()) return;
    window.location.search = q.toString();
  };
  const setKnobs = (vals: Record<string, string>) => go((q) => { for (const [k, v] of Object.entries(vals)) q.set(k, v); });
  const colorParam = (v: BgValue) => (typeof v === 'string' ? v : JSON.stringify(v));
  // #1483 —— 点预设 = 旋钮 + 这个预设管的颜色（Rainbow 设上两道渐变；块里有带颜色的预设时，点别的预设把它们清掉）。
  //    挂在 onClick 上、不挂 onChange：featuredColor 一改，Plan cards 就已经是亮着的那一格，再点它不会触发 change ——
  //    而「点 Plan cards 把颜色清掉」正是要在那一刻发生的事（AC3 第三步）。
  const pickPreset = (p: KnobBarProps['presets'][number]) => go((q) => {
    for (const [k, v] of Object.entries(p.knobs)) q.set(k, v);
    for (const [slot, v] of Object.entries(p.colors || {})) { if (v === null) q.delete(slot); else q.set(slot, colorParam(v)); }
    const missing = (p.parts || []).filter((x) => !current.parts.includes(x));
    if (missing.length) {
      const s = new Set([...current.parts, ...missing]);
      if (s.size === parts.length) q.delete('parts'); else q.set('parts', Array.from(s).join(','));
    }
  });
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

  // #1532 —— 一个控件 = 它的 token + 它画什么；分组后组间插一条竖线（`data-catalog-sep` = 组序号，序列按 Set 读也不会把分界合并掉）。
  const tok = (token: string, node: ReactNode) => ({ token, node });
  const grouped = (controls: { token: string; node: ReactNode }[]) => {
    const byToken = new Map(controls.map((c) => [c.token, c.node]));
    return (arrangeToolbar(controls.map((c) => c.token), groups) as string[][]).flatMap((g, i) => [
      ...(i > 0 ? [<span key={`sep-${i}`} style={sep} data-catalog-sep={i} aria-hidden="true" />] : []),
      ...g.map((t) => byToken.get(t)),
    ]);
  };

  return (
    <div style={bar} data-catalog-knobs="">
      <span>preset:</span>
      {presets.map((p) => (
        <label key={p.name} style={lab}>
          <input type="radio" name="catalog-preset" data-catalog-preset={p.name} disabled={!ready}
            checked={current.preset === p.name} readOnly onClick={() => pickPreset(p)} />
          <span>{p.name}</span>
        </label>
      ))}
      <span data-catalog-custom={current.preset === 'custom' ? 'true' : 'false'} style={{ fontWeight: current.preset === 'custom' ? 700 : 400 }}>custom</span>
      <span style={sep} />
      {/* #1532 —— 控件按 manifest 的 `toolbarGroups` 分组（block-knobs.js §arrangeToolbar），组间一条标了 `data-catalog-sep`
          的竖线。每个控件配它的 token（e2e `barSequence()` 那一套），按原次序收齐再按声明重排。原来那几条「按控件种类」的
          竖线由组间分界取代；预设后面那条照旧（预设恒自成一组）。 */}
      {grouped([
      ...knobs.map((k) => tok(k.name, (
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
      ))),
      ...booleans.map((b) => tok(`bool:${b}`, (
        <label key={b} style={lab}>
          <input type="checkbox" data-catalog-option={b} disabled={!ready} checked={!!current.booleans[b]}
            onChange={(e) => toggleBool(b, e.target.checked)} />
          <span>{b}</span>
        </label>
      ))),
      ...colors.map((c) => tok(`color:${c.slot}`, (
        <span key={c.slot} style={{ ...lab, flexWrap: 'wrap' }} data-catalog-color={c.slot}>
          <b>{c.slot}</b>
          {/* #1477 —— 色板是共用的 `src/components/BgPicker.tsx`（外壳块 / 编辑器 / admin 同一份）。渐变写成 JSON 进地址栏。
              #1483 —— 每个颜色槽一格、参数名 = 槽名（`?bg=` / `?featuredColor=`）。 */}
          <BgPicker value={current.colors[c.slot] ?? null} swatches={c.swatches} disabled={!ready}
            onChange={(v) => go((q) => { if (v === null) q.delete(c.slot); else q.set(c.slot, colorParam(v)); })} />
        </span>
      ))),
      ...parts.map((p) => tok(`part:${p}`, (
        <label key={p} style={lab}>
          <input type="checkbox" data-catalog-part={p} disabled={!ready} checked={current.parts.includes(p)}
            onChange={(e) => togglePart(p, e.target.checked)} />
          <span>{p}</span>
        </label>
      ))),
      ...choices.map((c) => tok(`choice:${c.key}`, (
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
      ))),
      ])}
    </div>
  );
}
