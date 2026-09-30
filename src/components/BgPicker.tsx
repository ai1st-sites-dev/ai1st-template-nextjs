// ══════════════════════════════════════════════════════════════════════════════════════════════════
// BgPicker —— 颜色槽（`kind: "color"`，如 `bg`）的色板：纯色一排 + 任意取色器 + 三档预设渐变 + 自定义渐变 + 「无」（#1477）
// ══════════════════════════════════════════════════════════════════════════════════════════════════
//
// 🔴 **四个地方用的是这一份**，不各画一份：单格页的页面块工具条（`_catalog/…/KnobBar.tsx`）、外壳块工具条
//    （`_catalog/…/CellOptions.tsx`）、Puck 编辑器的字段（`src/components/editor/EditorApp.tsx` §ColorField）、
//    admin › Blocks & Themes 的块级工具栏（`dashboard/src/pages/admin/CatalogPage.tsx`，经 dashboard 的 vite 配置引过去）。
//    预设渐变只从 `contrast.js` §GRADIENT_SWATCHES 来，纯色色板是调用方从 manifest 的 `swatches` 读的。
// 🔴 **不带状态、不用 hook**：值由调用方持有（地址栏 / Puck 的 data / admin 的 state），这里只画、只回调。
//    这也是它能被 dashboard（React 18）拿去用的前提 —— 那边的 vite 把 `react` 去重到它自己那一份。
// 🔴 `attrs` 决定 DOM 上的测试钩子叫什么：单格页和 admin 用 `catalog`（`data-catalog-bg*`），编辑器用 `editor`
//    （`data-editor-swatch` / `data-editor-color-input`，#1463 起的 e2e 读的就是这两个名字；渐变那几格另起名字，
//    不混进 `data-editor-swatch` —— 1463 那条「6 色 + None」的读数不因为多了渐变而变）。
//
// 值的形状：`#rrggbb`（小写）· `brand` · `{ stops: [2–3 个 #rrggbb], angle }`；「无」回 null。存盘前一律过
// `contrast.js` §normalizeBg，不合法的不回调。

import { GRADIENT_ANGLE, GRADIENT_SWATCHES, bgCss, normalizeBg, type BgValue, type GradientBg } from '../../scripts/lib/contrast.js';

type Attrs = 'catalog' | 'editor';

const HOOK = {
  catalog: { swatch: 'data-catalog-bg', input: 'data-catalog-bg-input', gradient: 'data-catalog-bg-gradient', custom: 'data-catalog-bg-custom',
    stop: 'data-catalog-bg-stop', stops: 'data-catalog-bg-stops', angle: 'data-catalog-bg-angle', clear: 'data-catalog-bg-clear' },
  editor: { swatch: 'data-editor-swatch', input: 'data-editor-color-input', gradient: 'data-editor-gradient', custom: 'data-editor-gradient-custom',
    stop: 'data-editor-gradient-stop', stops: 'data-editor-gradient-stops', angle: 'data-editor-gradient-angle', clear: 'data-editor-swatch' },
} as const;

const key = (v: BgValue | null) => (v === null ? '' : typeof v === 'string' ? v : JSON.stringify(v));

export interface BgPickerProps {
  /** 当前值（null = 没填）。 */
  value: BgValue | null;
  /** 纯色色板（manifest 的 `swatches`，原样）。 */
  swatches: string[];
  /** 预设渐变；不给 = `contrast.js` §GRADIENT_SWATCHES（编辑器从它的字段 schema 带下来同一份的副本）。 */
  gradients?: GradientBg[];
  /** 选了一档 / 改了色标 / 点了「无」（null）。 */
  onChange: (v: BgValue | null) => void;
  disabled?: boolean;
  attrs?: Attrs;
  /** 色块边长（px）：单格页 18，编辑器侧栏 26。 */
  size?: number;
  /** 「无」那格的字。 */
  clearLabel?: string;
}

export default function BgPicker({ value, swatches, gradients = GRADIENT_SWATCHES, onChange, disabled, attrs = 'catalog', size = 18, clearLabel = '无' }: BgPickerProps) {
  const h = HOOK[attrs];
  const cur = key(value);
  const grad = value && typeof value === 'object' ? value : null;
  // 自定义渐变的色标：当前是渐变就用它的，否则从第一档预设起步。
  const stops = grad ? grad.stops : (gradients[0] || GRADIENT_SWATCHES[0]).stops;
  const angle = grad ? grad.angle : GRADIENT_ANGLE;
  const set = (v: unknown) => { const n = normalizeBg(v); if (n) onChange(n); };
  const cell = (on: boolean, background: string) => ({
    width: size, height: size, borderRadius: Math.round(size / 4.5), cursor: 'pointer', padding: 0,
    border: on ? '2px solid #1d4ed8' : '1px solid #a1a1aa', background,
  });
  const small = { font: '11px system-ui, sans-serif', padding: '0 6px', cursor: 'pointer' };
  const hook = (name: string, v: string | number = '') => ({ [name]: v });
  return (
    <>
      {swatches.map((c) => (
        <button key={c} type="button" title={c} {...hook(h.swatch, c)} aria-pressed={cur === c} disabled={disabled}
          onClick={() => set(c)} style={cell(cur === c, c === 'brand' ? 'var(--x-primary, #1d4ed8)' : c)} />
      ))}
      <input type="color" aria-label="Any colour" {...hook(h.input)} disabled={disabled}
        value={typeof value === 'string' && /^#[0-9a-f]{6}$/i.test(value) ? value.toLowerCase() : '#ffffff'}
        onChange={(e) => set(e.target.value)} style={{ width: size + 8, height: size + 2, padding: 0, border: 'none' }} />
      {gradients.map((g) => (
        <button key={key(g)} type="button" title={g.stops.join(' → ')} {...hook(h.gradient, g.stops.join(','))} aria-pressed={cur === key(g)}
          disabled={disabled} onClick={() => set(g)} style={cell(cur === key(g), bgCss(g) || '')} />
      ))}
      {/* 自定义渐变：2–3 个色标 + 角度。改任何一个 = 当场换成这一条渐变。 */}
      <span style={{ display: 'inline-flex', gap: 4, alignItems: 'center' }} {...hook(h.custom, grad ? 'on' : 'off')}>
        {stops.map((c, i) => (
          <input key={i} type="color" aria-label={`Gradient stop ${i + 1}`} {...hook(h.stop, i)} disabled={disabled} value={c}
            onChange={(e) => { const st = stops.slice(); st[i] = e.target.value; set({ stops: st, angle }); }}
            style={{ width: size + 2, height: size + 2, padding: 0, border: 'none' }} />
        ))}
        <button type="button" disabled={disabled} {...hook(h.stops, stops.length === 3 ? '3' : '2')}
          title={stops.length === 3 ? 'Remove the 3rd stop' : 'Add a 3rd stop'}
          onClick={() => set({ stops: stops.length === 3 ? stops.slice(0, 2) : [...stops, '#ffffff'], angle })} style={small}>
          {stops.length === 3 ? '−' : '+'}
        </button>
        <input type="number" min={0} max={360} step={15} aria-label="Gradient angle" {...hook(h.angle)} disabled={disabled} value={angle}
          onChange={(e) => { const a = Number(e.target.value); if (Number.isFinite(a) && a >= 0 && a <= 360) set({ stops, angle: a }); }}
          style={{ width: 52, font: '11px system-ui, sans-serif' }} />
        <span style={{ font: '11px system-ui, sans-serif' }}>°</span>
      </span>
      <button type="button" {...hook(h.clear)} aria-pressed={value === null} disabled={disabled || (attrs === 'catalog' && value === null)}
        onClick={() => onChange(null)} style={small}>{clearLabel}</button>
    </>
  );
}
