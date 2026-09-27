'use client';

// #1424 —— 图册里 `header-new`（Webpixels 那一版顶栏）那一行：6 个形态一格一个，顶上三个勾选
// （dark / icons / reverse）。
//
// 🔴 **为什么它不跟别的行一样走 `ShapeSelect`**：那个下拉改的是 DOM 上的 `data-shape`，靠
//    `shapes.css` 当场重排（旧库「形态只是 CSS」）。`header-new` 是排布型块，形态查的是
//    `Section.tsx` 里那张「形态 → 布局类」表 —— 换形态换的是 class，改一个属性不会重排。所以这一行
//    每格固定一个形态，勾选项走 React 的 state 重新渲染。
// 🔴 **勾选改的是 class，不改地址栏**（票正文做什么 5）：改锚点 / query 会把整页滚走。
// 🔴 每格占满整行宽，不像别的行那样「全填版 | 最少版」左右各半：顶栏的断点是按**视口**判的
//    （`d-md-*` / `d-lg-*`），半宽的格子在 1440 视口里只有 720 宽，却按桌面那一档排，会挤出横向滚动。
//    两个版本上下叠。

import { useEffect, useState } from 'react';
import HeaderNewSection, { type HeaderNewData, type HeaderOptions } from '@blocks/header-new/Section';

interface Props {
  shapes: string[];
  full: HeaderNewData;
  minimal: HeaderNewData;
  /** 两个版本各自填了哪些可选槽位（`filledOptionalSlots`，服务端算好）—— 落成 `data-has-*`。 */
  hasFull: string[];
  hasMinimal: string[];
}

const OPTION_KEYS: Array<keyof HeaderOptions> = ['dark', 'icons', 'reverse'];

export default function HeaderNewRow({ shapes, full, minimal, hasFull, hasMinimal }: Props) {
  const [opts, setOpts] = useState<HeaderOptions>({ dark: false, icons: false, reverse: false });
  // 🔴 同 CatalogBoard / ShapeSelect：hydration 之前勾它，勾选框变了、页面不变 —— 一个会骗人的开关。
  const [ready, setReady] = useState(false);
  useEffect(() => { setReady(true); }, []);

  const arms: Array<{ key: 'full' | 'minimal'; title: string; data: HeaderNewData; has: string[] }> = [
    { key: 'full', title: '全填版', data: full, has: hasFull },
    { key: 'minimal', title: '最少版', data: minimal, has: hasMinimal },
  ];

  return (
    <div data-catalog-header-new="">
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
      </div>
      {shapes.map((shape) => (
        <div
          className="catalog-cell"
          data-catalog-cell=""
          data-catalog-block="header-new"
          data-catalog-shape={shape}
          key={shape}
        >
          <div className="catalog-cell__head">
            <code className="catalog-cell__id">header-new / {shape}</code>
          </div>
          {arms.map((arm) => (
            <div className="catalog-arm" data-catalog-arm={arm.key} key={arm.key}>
              <div className="catalog-arm__label">{arm.title}</div>
              <div className="catalog-arm__stage">
                <HeaderNewSection
                  shape={shape}
                  block={{ type: 'header-new', shape, has: arm.has }}
                  data={{ ...arm.data, options: { ...(arm.data.options || {}), ...opts } }}
                />
              </div>
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}
