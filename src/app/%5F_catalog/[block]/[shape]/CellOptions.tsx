'use client';

// #1458 —— 单格页上的选项开关（只对声明了 `options` 槽的块出现：今天是 header-new / footer-new）。
//
// 整页索引 board 退役之后，这几个开关是从它那两行（HeaderNewRow / FooterNewRow）搬来的：块的唯一可看面
// 是 admin › Blocks & Themes，而那一页的卡片和「新窗口」嵌的都是这一页 —— 开关住在这里，两处都能切。
// 🔴 开关有哪些不是写死的名单：`optionKeys` / `ctaStyles` / `hasNewsletter` 由服务端从 manifest 的
//    `slots.options.shape` / `slots.cta.shape` / `slots.newsletter` 读出来（page.dev.tsx §optionMetaOf），
//    第三个带选项的块出现时这里不用改。
// 🔴 hydration 之前勾它，勾选框变了、页面不变 —— 一个会骗人的开关；所以 `ready` 之前全部 disabled。

import { useEffect, useState } from 'react';
import FooterNewSection, { type FooterNewData } from '@blocks/footer-new/Section';
import HeaderNewSection, { type HeaderNewData } from '@blocks/header-new/Section';
import type { BlockConfig } from '@/lib/types/config';

export interface CellOptionsInitial {
  opts: Record<string, boolean>;
  cta: string;
  newsletter: boolean;
}

interface Props {
  block: string;
  shape: string;
  data: Record<string, unknown>;
  has: string[];
  optionKeys: string[];
  ctaStyles: string[];
  hasNewsletter: boolean;
  initial: CellOptionsInitial;
  /** #1460 —— false = 被 admin 嵌着，开关条由外面那条块级工具栏代劳，这里不画（数据照旧按 initial 渲染）。 */
  showBar?: boolean;
}

const barStyle = {
  display: 'flex', flexWrap: 'wrap' as const, gap: 12, alignItems: 'center', padding: '6px 10px',
  font: '12px system-ui, sans-serif', background: '#f4f4f5', borderBottom: '1px solid #d4d4d8', color: '#3f3f46',
};

export default function CellOptions({ block, shape, data, has, optionKeys, ctaStyles, hasNewsletter, initial, showBar = true }: Props) {
  const [opts, setOpts] = useState<Record<string, boolean>>(initial.opts);
  const [cta, setCta] = useState<string>(initial.cta);
  const [newsletter, setNewsletter] = useState<boolean>(initial.newsletter);
  const [ready, setReady] = useState(false);
  useEffect(() => { setReady(true); }, []);

  // 选项两个版本都吃；两个可选部件只有数据里真有时才给（最少版按构造没有，关掉就删）。
  const out: Record<string, unknown> = { ...data, options: { ...((data.options as object) || {}), ...opts } };
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
        {optionKeys.map((k) => (
          <label key={k} style={{ display: 'inline-flex', gap: 4, alignItems: 'center' }}>
            <input type="checkbox" data-catalog-option={k} disabled={!ready} checked={!!opts[k]}
              onChange={(e) => setOpts({ ...opts, [k]: e.target.checked })} />
            <span>{k}</span>
          </label>
        ))}
        {hasNewsletter && (
          <label style={{ display: 'inline-flex', gap: 4, alignItems: 'center' }}>
            <input type="checkbox" data-catalog-option="newsletter" disabled={!ready} checked={newsletter}
              onChange={(e) => setNewsletter(e.target.checked)} />
            <span>newsletter</span>
          </label>
        )}
        {ctaStyles.length > 0 && <span>cta:</span>}
        {ctaStyles.length > 0 && ['none', ...ctaStyles].map((s) => (
          <label key={s} style={{ display: 'inline-flex', gap: 4, alignItems: 'center' }}>
            <input type="radio" name="catalog-cta" data-catalog-cta={s} disabled={!ready} checked={cta === s}
              onChange={() => setCta(s)} />
            <span>{s}</span>
          </label>
        ))}
      </div>
      )}
      {block === 'header-new' ? <HeaderNewSection shape={shape} data={out as unknown as HeaderNewData} block={cfg} /> : null}
      {block === 'footer-new' ? <FooterNewSection shape={shape} data={out as unknown as FooterNewData} block={cfg} /> : null}
    </>
  );
}
