'use client';
// ══════════════════════════════════════════════════════════════════════════════════════════════════
// custom-html —— 老板自己贴的一段 HTML（#1833，SiteAsData T4a-1；设计文档 §8.1）
// ══════════════════════════════════════════════════════════════════════════════════════════════════
//
// 数据：`html`（入库前已经过 `scripts/lib/custom-html.js` 整理：闭合、去外壳、≤ 64 KB）· `label`（老板给的名字）
//      · `frozenFrom`（T4c 冻结出来的块写它是哪一型）· `attrs`（T4c：冻结前那块 `<section>` 容器自己的属性，套回容器 —— 见下）。
//      manifest `schemaVersion: 1`，永不升级。
// #1839（T4c）—— `attrs` 套回容器只过白名单（`scripts/lib/sanitize-css.js` §frozenContainerAttrs）：`class`、`style`（逐条声明净化）、
//   `data-*`；别的（`onclick` …）一律丢 —— `attrs` 存在 content 里，老板能经保存 API 改，不过白名单就是一个新的 XSS 入口。
//   冻结出来的那一型的样式按 `[data-block="<旧类型>"]` 点名（shapes.css），所以 `data-block` / `data-shape` / `data-tone` … 照原样
//   回到容器上；`data-block-id` / `id` 只认内容里块自己的 id。站上、画布两支都套。
//
// 🔴 两条路，判据是「站的渲染入口有没有明确说『我是老板的网站』」（`SiteRenderContext`，`components/SiteRender.tsx` 给 true），
//    而且不在编辑器画布里（`EditorCanvasContext`）。🔴 **默认是画布那一支**（#1833 r2）：r1 的判据是「画布的根给 true，没给就原样」，
//    #1874 的只读画布没给 ⟹ 块的脚本在 dashboard 的源里跑了。现在任何没声明的渲染面都只拿到净化后的标记。
//   · 站上 / 预览 / 发布：`<section data-block-id>` 里原样写 `html`（连同老板写在里面的 `<style>` 块和 `style="…"`）。
//     脚本在预览地址和正式站上真跑 —— 那是老板的站、老板的代码，不设闸。
//   · 画布：`html` 只经 `sanitizeForCanvas` 才落 DOM（DOMPurify 白名单）。Puck 的画布是同源 iframe、没有 sandbox，块里的脚本
//     在这里跑就是以 dashboard 的源跑、拿得到老板的登录态（设计文档 §8.1）。原文里有 `<script>` / `<iframe>`（或这块是冻结出来的）
//     ⟹ 先画一张卡片（名字 + 「Runs on your preview link and your website」+ Open preview），再画净化后剩下的标记。
//     判据看**原文**，不看净化后是不是空（`<script>…</script><p>hi</p>` 要卡片 **和** hi）。`style="…"` 照常显示；`<style>` 块
//     在画布里删掉（它会改到编辑器自己的样式），预览和网站上原样。
// 📌 没有 `css` 字段了（Chris 2026-10-19：「这个 HTML 就是 inline 的 CSS」）。老内容里带着它的照常渲染，`css` 不读。
//   🔴 本文件里画布那一支的 `dangerouslySetInnerHTML` 只吃 `sanitizeForCanvas` 的输出 —— `custom-html.test.js` 读这份源码钉着。
//
// 'use client'：要读 context（Next 的服务端组件里没有 useContext）。它不是岛（岛要 `island()` 显式包），静态整页渲染照样只出 HTML。

import { useContext } from 'react';
import { blockAttrs } from '@template/lib/sections/blockAttrs';
import type { BlockConfig } from '@template/lib/types/config';
import { EditorCanvasContext, EditorPreviewContext, SiteRenderContext } from '@template/lib/editor-canvas';
import { sanitizeForCanvas } from '../../scripts/lib/sanitize-canvas.js';
import { frozenContainerAttrs } from '../../scripts/lib/sanitize-css.js';

export interface CustomHtmlData {
  html?: string;
  label?: string;
  frozenFrom?: string;
  attrs?: Record<string, string>;
}

interface Props {
  data: CustomHtmlData;
  locale?: string;
  block?: BlockConfig;
}

const RUNS_SCRIPT = /<\s*(script|iframe)[\s>/]/i;

/** `pricing` → `Pricing`，`page-header` → `Page header`。 */
function typeName(type: string): string {
  const t = type.replace(/[-_]+/g, ' ').trim();
  return t ? t.charAt(0).toUpperCase() + t.slice(1) : t;
}

/** 容器属性：没有 `attrs` ⟹ 原样（blockAttrs）；有 ⟹ 身份那几样 + 白名单过后的 `attrs`（见文件头 #1839）。 */
function containerAttrs(base: ReturnType<typeof blockAttrs>, raw: unknown): Record<string, unknown> {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { ...base };
  return {
    'data-block': base['data-block'], 'data-role': base['data-role'],
    ...(base['data-block-id'] ? { 'data-block-id': base['data-block-id'], id: base.id } : {}),
    ...frozenContainerAttrs(raw),
  };
}

function CanvasCard({ label, frozenFrom, preview }: { label: string; frozenFrom: string; preview: string }) {
  // #1839 —— 冻结时 `label` 写的就是那一型的显示名（manifest `displayName`）；没写才按类型名拼。
  const note = frozenFrom ? `This was a ${label || typeName(frozenFrom)} block. It's kept as-is.` : 'Runs on your preview link and your website';
  return (
    <div className="ch-card" data-ch-card="">
      {label ? <span className="ch-card-label" data-ch-card-label="">{label}</span> : null}
      <span className="ch-card-note" data-ch-card-note="">{note}</span>
      {preview ? (
        <a className="btn btn-sm btn-outline-secondary" href={preview} target="_blank" rel="noopener noreferrer" data-ch-open-preview="">Open preview</a>
      ) : null}
    </div>
  );
}

export default function CustomHtmlSection({ data, block }: Props) {
  const site = useContext(SiteRenderContext);
  const inCanvas = useContext(EditorCanvasContext);
  const asSite = site && !inCanvas;
  const preview = useContext(EditorPreviewContext);
  const d = data || {};
  const html = typeof d.html === 'string' ? d.html : '';
  const attrs = containerAttrs(blockAttrs('custom-html', block), d.attrs);

  if (asSite) {
    return <section {...attrs} dangerouslySetInnerHTML={{ __html: html }} />;
  }

  const frozenFrom = typeof d.frozenFrom === 'string' ? d.frozenFrom : '';
  const card = RUNS_SCRIPT.test(html) || !!frozenFrom;
  const safeHtml = sanitizeForCanvas(html);
  return (
    <section {...attrs}>
      {card ? <CanvasCard label={typeof d.label === 'string' ? d.label : ''} frozenFrom={frozenFrom} preview={preview} /> : null}
      {safeHtml ? <div data-ch-canvas="" dangerouslySetInnerHTML={{ __html: safeHtml }} /> : null}
    </section>
  );
}
