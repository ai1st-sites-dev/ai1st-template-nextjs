'use client';

// #1458 —— 单格页上的选项开关（只对声明了 `options` 槽的块出现：今天是 header-new / footer-new）。
//
// 整页索引 board 退役之后，这几个开关是从它那两行（HeaderNewRow / FooterNewRow）搬来的：块的唯一可看面
// 是 admin › Blocks & Themes，而那一页的卡片和「新窗口」嵌的都是这一页 —— 开关住在这里，两处都能切。
// 🔴 开关有哪些不是写死的名单：`optionKeys` / `ctaStyles` / `hasNewsletter` / `knobs` / `presets` 由服务端
//    从 manifest 读出来（page.dev.tsx §optionMetaOf），第三个带选项的块出现时这里不用改。
// 🔴 hydration 之前勾它，勾选框变了、页面不变 —— 一个会骗人的开关；所以 `ready` 之前全部 disabled。
//
// #1462 —— **预设 + 旋钮**（照定稿图册 `docs/reference/webpixels/gallery/build.py` 那条工具栏）：
//   顺序 = 预设一排（外加 Custom）→ 排布旋钮（logo · menu · topbar）→ 修饰（reverse · dark）→ 部件（icons）。
//   点预设 = 三个旋钮一次设好；拧旋钮后跟任何预设都对不上 ⟹ Custom 亮。不成立的组合当场纠正，用的是
//   Section 渲染时同一个纯函数（`scripts/lib/header-knobs.js` §normalizeKnobs），拧了谁谁不让步。
//   单开（「新窗口」，不带 embed）时改动 `replaceState` 回地址栏，刷新还在；被 admin 嵌着时不碰地址栏。

import { useEffect, useState } from 'react';
import FooterNewSection, { type FooterNewData } from '@blocks/footer-new/Section';
import HeaderNewSection, { type HeaderNewData } from '@blocks/header-new/Section';
import type { IconTable } from '@/components/InlineIcon';
import type { BlockConfig } from '@/lib/types/config';
import { normalizeKnobs, presetOf } from '../../../../../scripts/lib/header-knobs.js';

export interface CellOptionsInitial {
  knobs: Record<string, string>;
  opts: Record<string, boolean>;
  cta: string;
  newsletter: boolean;
}

interface Knob { name: string; values: string[] }

interface Props {
  block: string;
  shape: string;
  data: Record<string, unknown>;
  has: string[];
  optionKeys: string[];
  ctaStyles: string[];
  hasNewsletter: boolean;
  knobs: Knob[];
  presets: Array<Record<string, string>>;
  coupling: [string, string] | null;
  iconTable: IconTable;
  initial: CellOptionsInitial;
  /** #1460 —— false = 被 admin 嵌着，开关条由外面那条块级工具栏代劳，这里不画（数据照旧按 initial 渲染）。 */
  showBar?: boolean;
}

const barStyle = {
  display: 'flex', flexWrap: 'wrap' as const, gap: 12, alignItems: 'center', padding: '6px 10px',
  font: '12px system-ui, sans-serif', background: '#f4f4f5', borderBottom: '1px solid #d4d4d8', color: '#3f3f46',
};
const rowStyle = { display: 'flex', flexWrap: 'wrap' as const, gap: 6, alignItems: 'center', flexBasis: '100%' };
const labelStyle = { display: 'inline-flex', gap: 4, alignItems: 'center' };
const groupStyle = { display: 'inline-flex', gap: 8, alignItems: 'center', border: '1px solid #d4d4d8', borderRadius: 999, padding: '2px 10px' };
const sepStyle = { width: 1, height: 18, background: '#d4d4d8' };
const presetStyle = (on: boolean, custom = false) => ({
  font: '12px system-ui, sans-serif', padding: '3px 10px', borderRadius: 6, cursor: custom ? 'default' : 'pointer',
  border: `1px ${custom && !on ? 'dashed' : 'solid'} ${on ? '#4f46e5' : '#d4d4d8'}`,
  background: on ? '#e0e7ff' : '#fff', color: custom && !on ? '#a1a1aa' : '#3f3f46',
});

export default function CellOptions({
  block, shape, data, has, optionKeys, ctaStyles, hasNewsletter, knobs: knobDefs, presets, coupling, iconTable, initial, showBar = true,
}: Props) {
  const [knobs, setKnobs] = useState<Record<string, string>>(initial.knobs);
  const [opts, setOpts] = useState<Record<string, boolean>>(initial.opts);
  const [cta, setCta] = useState<string>(initial.cta);
  const [newsletter, setNewsletter] = useState<boolean>(initial.newsletter);
  const [ready, setReady] = useState(false);
  useEffect(() => { setReady(true); }, []);

  const preset = knobDefs.length ? presetOf(knobs, { knobs: knobDefs, presets }) : '';
  const turn = (name: string, value: string) => {
    setKnobs((k) => normalizeKnobs({ ...k, [name]: value }, { knobs: knobDefs, presets, coupling, changed: name, base: k }) as Record<string, string>);
  };
  const pick = (p: Record<string, string>) => {
    const next: Record<string, string> = {};
    for (const k of knobDefs) next[k.name] = p[k.name];
    setKnobs(next);
  };

  // 单开时地址栏跟着走（AC6：刷新之后还是这一组）。被嵌着时 URL 归 admin 管，不碰。
  useEffect(() => {
    if (!ready || !showBar) return;
    const u = new URL(window.location.href);
    for (const k of knobDefs) u.searchParams.set(k.name, knobs[k.name]);
    const on = optionKeys.filter((k) => opts[k]);
    if (on.length) u.searchParams.set('opt', on.join(',')); else u.searchParams.delete('opt');
    if (ctaStyles.length) { if (cta !== 'none') u.searchParams.set('cta', cta); else u.searchParams.delete('cta'); }
    if (hasNewsletter) { if (newsletter) u.searchParams.set('newsletter', '1'); else u.searchParams.delete('newsletter'); }
    if (u.href !== window.location.href) window.history.replaceState(window.history.state, '', u.href);
  }, [ready, showBar, knobs, opts, cta, newsletter, knobDefs, optionKeys, ctaStyles, hasNewsletter]);

  // 选项两个版本都吃；两个可选部件只有数据里真有时才给（最少版按构造没有，关掉就删）。
  const out: Record<string, unknown> = {
    ...data,
    options: { ...((data.options as object) || {}), ...opts, ...knobs, ...(preset ? { preset } : {}) },
  };
  if (hasNewsletter && !newsletter) delete out.newsletter;
  if (ctaStyles.length) {
    if (cta === 'none' || !out.cta) delete out.cta;
    else out.cta = { ...(out.cta as object), style: cta };
  }
  // `data-has-*` 跟着真实渲染的数据走：关掉的可选部件不许还挂着「有它」。
  const hasNow = has.filter((s) => (s === 'newsletter' ? !!out.newsletter : s === 'cta' ? !!out.cta : true));
  const cfg: BlockConfig = { type: block, shape, data: out, has: hasNow } as BlockConfig;

  return (
    <>
      {showBar && (
      <div style={barStyle} data-catalog-options="">
        {presets.length > 0 && (
          <div style={rowStyle} data-catalog-presets="">
            <b>预设</b>
            {presets.map((p) => (
              <button key={p.name} type="button" data-catalog-preset={p.name} disabled={!ready}
                aria-pressed={preset === p.name} style={presetStyle(preset === p.name)} onClick={() => pick(p)}>
                {p.name}
              </button>
            ))}
            <button type="button" data-catalog-preset="custom" disabled aria-pressed={preset === 'custom'} style={presetStyle(preset === 'custom', true)}>
              Custom
            </button>
          </div>
        )}
        {knobDefs.map((k) => (
          <span key={k.name} style={groupStyle} data-catalog-knob={k.name}>
            <b>{k.name}</b>
            {k.values.map((v) => (
              <label key={v} style={labelStyle}>
                <input type="radio" name={`catalog-knob-${k.name}`} data-catalog-knob-value={v} disabled={!ready}
                  checked={knobs[k.name] === v} onChange={() => turn(k.name, v)} />
                <span>{v}</span>
              </label>
            ))}
          </span>
        ))}
        {knobDefs.length > 0 && optionKeys.length > 0 && <span style={sepStyle} />}
        {optionKeys.map((k) => (
          <label key={k} style={labelStyle}>
            <input type="checkbox" data-catalog-option={k} disabled={!ready} checked={!!opts[k]}
              onChange={(e) => setOpts({ ...opts, [k]: e.target.checked })} />
            <span>{k}</span>
          </label>
        ))}
        {hasNewsletter && (
          <label style={labelStyle}>
            <input type="checkbox" data-catalog-option="newsletter" disabled={!ready} checked={newsletter}
              onChange={(e) => setNewsletter(e.target.checked)} />
            <span>newsletter</span>
          </label>
        )}
        {ctaStyles.length > 0 && <span>cta:</span>}
        {ctaStyles.length > 0 && ['none', ...ctaStyles].map((s) => (
          <label key={s} style={labelStyle}>
            <input type="radio" name="catalog-cta" data-catalog-cta={s} disabled={!ready} checked={cta === s}
              onChange={() => setCta(s)} />
            <span>{s}</span>
          </label>
        ))}
      </div>
      )}
      {block === 'header-new' ? <HeaderNewSection shape={shape} data={out as unknown as HeaderNewData} block={cfg} iconTable={iconTable} /> : null}
      {block === 'footer-new' ? <FooterNewSection shape={shape} data={out as unknown as FooterNewData} block={cfg} iconTable={iconTable} /> : null}
    </>
  );
}
