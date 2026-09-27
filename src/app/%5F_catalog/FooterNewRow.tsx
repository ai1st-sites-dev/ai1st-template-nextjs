'use client';

// #1455 —— 图册里 `footer-new`（Webpixels 那一版页脚）那一行：4 个形态一格一个，顶上三个勾选
// （dark / reverse / newsletter）和一组单选（cta：none / band / bar / row）。
//
// 🔴 **为什么它跟 `HeaderNewRow` 一样不走 `ShapeSelect`**：排布型块，形态查的是 `Section.tsx` 里那张
//    「形态 → 布局」表，换形态换的是 class，改 `data-shape` 不会重排。所以每格固定一个形态，勾选项走
//    React 的 state 重新渲染。
// 🔴 **勾选改的是 class / 渲染出的部件，不改地址栏**（票正文做什么 4）：改锚点 / query 会把整页滚走。
// 🔴 两个可选部件（`cta` / `newsletter`）的开关只作用在**全填版**：最少版按构造只有必填槽
//    （`brandName` / `contact`），它本来就没有这两样数据，勾上也不该凭空长出来。
// 🔴 每格占满整行宽、两个版本上下叠（理由同 `HeaderNewRow`：断点按视口判，半宽格子会按桌面那一档排）。

import { useEffect, useState } from 'react';
import FooterNewSection, { type FooterNewData, type FooterOptions } from '@blocks/footer-new/Section';

interface Props {
  shapes: string[];
  full: FooterNewData;
  minimal: FooterNewData;
  /** 两个版本各自填了哪些可选槽位（`filledOptionalSlots`，服务端算好）—— 落成 `data-has-*`。 */
  hasFull: string[];
  hasMinimal: string[];
}

const OPTION_KEYS: Array<keyof FooterOptions> = ['dark', 'reverse'];
const CTA_STYLES = ['none', 'band', 'bar', 'row'] as const;
type CtaChoice = (typeof CTA_STYLES)[number];

export default function FooterNewRow({ shapes, full, minimal, hasFull, hasMinimal }: Props) {
  const [opts, setOpts] = useState<FooterOptions>({ dark: false, reverse: false });
  const [newsletter, setNewsletter] = useState(false);
  const [cta, setCta] = useState<CtaChoice>('none');
  // 🔴 同 HeaderNewRow：hydration 之前勾它，勾选框变了、页面不变 —— 一个会骗人的开关。
  const [ready, setReady] = useState(false);
  useEffect(() => { setReady(true); }, []);

  /** 一个版本在当前勾选下实际拿到的数据：选项两个版本都吃；两个可选部件只有全填版有数据可给。 */
  const dataFor = (d: FooterNewData, key: 'full' | 'minimal'): FooterNewData => {
    const out: FooterNewData = { ...d, options: { ...(d.options || {}), ...opts } };
    if (key === 'full') {
      if (!newsletter) delete out.newsletter;
      if (cta === 'none' || !d.cta) delete out.cta;
      else out.cta = { ...d.cta, style: cta };
    }
    return out;
  };
  /** `data-has-*` 跟着真实渲染的数据走：关掉的可选部件不许还挂着「有它」。 */
  const hasFor = (has: string[], data: FooterNewData) =>
    has.filter((s) => (s === 'newsletter' ? !!data.newsletter : s === 'cta' ? !!data.cta : true));

  const arms: Array<{ key: 'full' | 'minimal'; title: string; data: FooterNewData; has: string[] }> = [
    { key: 'full', title: '全填版', data: full, has: hasFull },
    { key: 'minimal', title: '最少版', data: minimal, has: hasMinimal },
  ];

  return (
    <div data-catalog-footer-new="">
      <div className="catalog-cell__head" data-catalog-options="">
        {OPTION_KEYS.map((k) => (
          <label key={k} className="catalog-cell__shape">
            <input
              type="checkbox"
              data-catalog-option={k}
              disabled={!ready}
              checked={!!opts[k]}
              onChange={(e) => setOpts({ ...opts, [k]: e.target.checked })}
            />
            <span>{k}</span>
          </label>
        ))}
        <label className="catalog-cell__shape">
          <input
            type="checkbox"
            data-catalog-option="newsletter"
            disabled={!ready}
            checked={newsletter}
            onChange={(e) => setNewsletter(e.target.checked)}
          />
          <span>newsletter</span>
        </label>
        <span className="catalog-cell__shape">cta:</span>
        {CTA_STYLES.map((s) => (
          <label key={s} className="catalog-cell__shape">
            <input
              type="radio"
              name="footer-new-cta"
              data-catalog-cta={s}
              disabled={!ready}
              checked={cta === s}
              onChange={() => setCta(s)}
            />
            <span>{s}</span>
          </label>
        ))}
      </div>
      {shapes.map((shape) => (
        <div
          className="catalog-cell"
          data-catalog-cell=""
          data-catalog-block="footer-new"
          data-catalog-shape={shape}
          key={shape}
        >
          <div className="catalog-cell__head">
            <code className="catalog-cell__id">footer-new / {shape}</code>
          </div>
          {arms.map((arm) => {
            const data = dataFor(arm.data, arm.key);
            return (
              <div className="catalog-arm" data-catalog-arm={arm.key} key={arm.key}>
                <div className="catalog-arm__label">{arm.title}</div>
                <div className="catalog-arm__stage">
                  <FooterNewSection
                    shape={shape}
                    block={{ type: 'footer-new', shape, has: hasFor(arm.has, data) }}
                    data={data}
                  />
                </div>
              </div>
            );
          })}
        </div>
      ))}
    </div>
  );
}
