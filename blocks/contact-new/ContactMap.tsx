'use client';

// ══════════════════════════════════════════════════════════════════════════════════════════════════
// contact-new 的地图那一格（#1489）—— 块里唯一的客户端交互
// ══════════════════════════════════════════════════════════════════════════════════════════════════
//
// 🔴 **点之前是地址卡，不是地图**（Chris 2026-09-29 定的 (a)）：钉子 + 地址 + 「Open map」按钮 + OSM 署名。
//    不放任何地图图片（不引用瓦片、不放生成的图、不放截图）⟹ 页面打开时这一格不向任何第三方发请求。
//    OSM 瓦片条款第 4 节禁「没人在看时先把瓦片抓下来」和离线用，所以建站时预生成静态图这条路不走。
// 🔴 **点了才加载**：换成 OSM 官方嵌入 `openstreetmap.org/export/embed.html?bbox=…&marker=lat,lng`（iframe，lazy），
//    这是条款允许的「真人在看」的正常浏览。地址（`embedUrl`）由服务端按站点数据里的坐标算好传进来（contact-facts.js §osmEmbedUrl）。
// 🔴 **署名一直在**：点之前、点之后都是同一个角标「© OpenStreetMap contributors」。
// 🔴 占位卡和 iframe 住在同一个盒子里、盒子的高度由 block.css 定 ⟹ 点开前后不跳动。
// 🔴 这个 `useState` 管的是**延迟加载**（点之前 iframe 不进 DOM ⟹ 不发站外请求），不是显隐 —— 所以 #1514「HTML 的交互归
//    bootstrap.js」没有把它换成 Collapse：Collapse 只管 display，元素得先在 DOM 里，换了 #1489 验收 7 当场红。换不换等 Chris 拍。

import { useState, type ReactNode } from 'react';

export default function ContactMap({ where, address, embedUrl, pin }: {
  where: 'side' | 'bottom'; address: string; embedUrl: string; pin?: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div
      className={`ct-map ${where === 'side' ? 'ct-map-side' : 'ct-map-bottom mt-10'} rounded-4 position-relative overflow-hidden`}
      data-part="map"
      data-map-where={where}
      data-map-state={open ? 'open' : 'closed'}
    >
      {open ? (
        <iframe
          className="ct-map-frame d-block w-100 h-100 border-0"
          src={embedUrl}
          title={`Map: ${address}`}
          loading="lazy"
          referrerPolicy="no-referrer-when-downgrade"
        />
      ) : (
        <div className="ct-map-card h-100 d-flex flex-column align-items-center justify-content-center text-center gap-3 p-6" data-part="map-card">
          <span className="ct-pin d-inline-flex text-primary" aria-hidden="true">{pin}</span>
          <div className="ct-map-address fw-semibold" data-part="map-address">{address}</div>
          <button type="button" className="btn btn-sm btn-primary ct-map-open" data-part="map-open" onClick={() => setOpen(true)}>
            Open map
          </button>
        </div>
      )}
      <span className="ct-map-credit position-absolute bottom-0 end-0 px-2 py-1 text-xs" data-part="map-credit">
        © <a /* #1508：外部 https: 不受 basePath 影响，保持裸 <a> */ href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer">OpenStreetMap</a> contributors
      </span>
    </div>
  );
}
