'use client';

// #1409 / #1404 —— 编辑器页的客户端那一半：Puck + 从这个站自己的区块库生成的 config。
//
// 🔴 唯一的硬约束（设计稿 §4）：**这个页面所在的域名上不许出现任何凭证，也不许向 manager 发请求。**
//    所以这里没有 fetch、没有存储、没有 token。存盘 = 把整份页面 JSON `postMessage` 给框住我们的
//    dashboard，由它带自己的凭证去打 manager。
//
// 🔴 收发两向都校验 origin，发消息**不许**用 `'*'`：
//    · 发：目标 origin 是 dashboard 的 origin（发布模式构建时定、预览模式请求时从服务进程的环境变量读，#1665）（`trustedOrigin`，与主题预览 #925 同一个来源：
//      `leadApi` 的 origin）。拿不到它就不发，界面上说清楚「只能从 dashboard 里保存」。
//    · 收：`e.origin !== trustedOrigin` 的消息一律忽略。
//    `manager/ticket1409_postmessage_test.go` 守着这两条（改成 `'*'` / 删掉 origin 判断都会红）。
//
// #1404 —— config 不手写：组件、字段、形态下拉全部来自构建时算好的 `schema`（`scripts/lib/editor-schema.js`
// 文件头说三份清单各从哪儿来），页面 JSON ⇄ Puck Data 走 `scripts/lib/editor-convert.js`（往返守卫
// `scripts/editor-roundtrip.test.js` 跑的是同一份字节）。拖拽 / 增删 / 复制全开（Chris 2026-09-19）。
//
// #1406 —— 站级共用块（`{ref}` 或按 `visibility` 注进来的）不再锁着：画布上一枚「Shared」、面板顶上一句「在 N 个
// 页面上」，改字 / 挪位置 / 删除三件各写对文件（`editor-convert.js` §#1406 那段是规矩的全文）。改字与「从 visibility
// 里撤掉这一页」随存盘消息的 `shared` 交出去，站里的 `write-editor-save.js` 写块库；挪位置与拿掉 `{ref}` 在页面 JSON 里。
// 仍然不许的：复制（会造出同 id 的第二条 `{ref}`）、换形态（按页还是全站要另定）、删「所有页面」上的块（Chris 2026-09-23）。
//
// #1415 —— 底稿以 dashboard 送来的为准。props 里那份是构建时烤进来的，只当首屏；dashboard 在运行时从站容器里
// 现取一份（manager `GET /api/sites/{id}/pages`，站里 `scripts/lib/editor-page.js` §editorBaseline），
// `postMessage(ai1st:editor-baseline)` 递进来。这个页面仍然一个请求都不发 —— 网络全在 dashboard 那一侧。
//   reason = open      刚打开：换成这一份（跟首屏不同才换），撤销历史清零；#1452 起外壳三样（root）也换成它带来的
//                      盘上现值（§openRoot）—— 存盘不重建之后，烤进来的那份 root 在发布前都是旧的
//            saved     刚存下去的那一次成功了（在重建之前就到）：只换 baseHash，画布不动 —— 于是不刷新、
//                      不等重建也能接着存
//            external  别处改过这一页：把数据换上、换 baseHash；**不进撤销历史**（怎么进归 #1410）
//                      #1442 —— 画布上有没存的改动时不换（`ai` 同），只换 baseHash，画布底部说一句（§Kept）
// 转换只做 `editor-convert.js` §pageToPuck（纯函数）；归一化 / 定位 / 补字段都在容器里算好了，客户端
// 不 import 任何读磁盘的库（那样构建会红在 `Can't resolve 'fs'`，而且归一化就有了两份实现）。
//
// #1410 —— AI 聊天的**界面**搬进来了（`EditorChat.tsx`），网络仍然全在 dashboard（`dashboard/src/hooks/useEditorChat.ts`）。这个页面多认 / 多发的：
//   收  ai1st:chat-state        聊天记录 + 正在进行的那一次（逐字）—— 整份覆盖，这里不存副本
//       ai1st:chat-sent         交给 dashboard 的那条消息发出去没有
//       ai1st:editor-baseline {reason: ai}   AI 改完了，dashboard 重取的底稿。撤销历史怎么动全在
//                                            `editor-convert.js` §aiBaselineStep：这一页的页面 JSON 变了才记一步；
//                                            共用块的字不归撤销管，历史里每一条快照的共用块都换成新的
//   发  ai1st:chat-send {text, scope?}       ai1st:chat-revert {messageId}
// 发给 AI 之前**先存一次**（做什么 4，Chris 2026-09-23）：画布上有没存的改动就先走今天那条 `ai1st:editor-save`，
// 存成功才发；被拒（这一页在别处改过，exit 10）就不发、把那句话原样说出来。
//
// #1453 —— 没有 Save 按钮了：画布停手 AUTOSAVE_IDLE_MS 就自动存一笔（§Autosave → §flushAutosave，走的还是
// §save 那一条 `ai1st:editor-save`，#1454 的手改记录照样一笔一条）。粒度按「停手」不按键入，也不按失焦：
// 从一个字段点到下一个字段就是一次失焦，按失焦存的话「连改同一块的 3 个字段 = 1 笔」就做不到。
// 撤销 AI 那一步（做什么 6）现在也是画布上的一次改动，停手后照样存下去。先存再发 / 换页前先存仍在，
// 它们现在是「不等停手、马上存这一笔」（§releaseChat / §releaseLeave 进门先撤掉计时器）。
// autosave 停下来的两种情况（画布上的字留着，底部浮一条说明 + 按钮，§EditorShell）：
//   · §Kept：别处的新版本因为画布上有没存的改动而没换进来 —— 自动存 = 静默盖掉 AI / 另一个标签页那次改动。
//   · 冲突（`kept === 'stale'`）：这一笔被站里拒了（exit 10，dashboard 判出来的，§editor-save-result 的 `stale`）。
// 状态字「Saving… / All changes saved」在 dashboard 的面板条上；这里只在出错时说话。
//
// #1448 —— 换页（dashboard 面板条上的下拉；清单是 `pages` prop，随 `editor-ready` 交出去）：
//   收  ai1st:editor-leave {id}                     dashboard 要换到别的页
//   发  ai1st:editor-leave-result {id, ok, message?} 没存的改动已经存下去（或本来就没有）才 ok；存不上 / AI 在改 ⟹ ok: false
// 换页本身是 dashboard 改 iframe 的地址，这里不导航。
//
// #1657 —— 画布里点字直接改 + 四个 AI 按钮（`InlineEdit.tsx` 文件头是全文）。这个页面多认 / 多发的：
//   发  ai1st:ai-rewrite {id, action, blockType, page, locale, fields: [{name, text}]}   dashboard 带凭证打 manager 的改写接口
//   收  ai1st:ai-rewrite-result {id, ok, fields?, message?}

import { createContext, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Puck, FieldLabel, createUsePuck, useGetPuck, type Config, type Data, type Field, type Fields, type PuckAction } from '@puckeditor/core';
import '@puckeditor/core/puck.css';
import SectionRenderer from '@/components/SectionRenderer';
import SiteShell from '@/components/SiteShell';
import EditorChat, { type ChatScope, type EditorChatState } from './EditorChat';
import type { BlockConfig } from '@/lib/types/config';
import type { EditorComponent, EditorField, EditorSchema } from '../../../scripts/lib/editor-schema';
import type { PuckItemSrc, PuckLikeData, SharedChanges } from '../../../scripts/lib/editor-convert';
import type { EditorPageGroup } from '../../../scripts/lib/editor-pages';
import {
  UNKNOWN_TYPE, pageToPuck, puckToPage, fieldProps, dataFromProps, deepEqual, puckRootChanges, rootToPuck,
  sharedReach, sharedRemovable, puckSharedChanges, sharedOwnAfter, applySharedChanges, aiBaselineStep,
  THEME_DEFAULT, canvasShape, shapeOptions, describeSave, nestedPartSet,
} from '../../../scripts/lib/editor-convert.js';
import { knobDefault, presetClickProps, presetNameFor } from '../../../scripts/lib/block-knobs.js';
import { normalizeBg, toneForBg, type BgValue } from '../../../scripts/lib/contrast.js';
import BgPicker from '../BgPicker';
import { FormsContext, FormIdField, FormCopyDialog, applyFormCopyEdit, type EditorFormChoice, type FormCopyEdit } from './FormCopyEditor';
import { describeRef, isSourceRef, itemSourceContext, resolveItemSources } from '@/lib/sections/item-sources';
import { setAt } from '../../../scripts/lib/inline-edit.js';
import { InlineApiContext, InlineEditLayer, InlineFreezeContext, type InlineApi, type InlineFreeze, type RewriteResult } from './InlineEdit';
import type { SiteData } from '@/lib/types/config';

export interface EditorAppProps {
  /** #1665 —— 这个站的内容（编辑器页在服务端用加载器读的那份）。画布上的块、外壳、列表槽的引用展开都用它。 */
  site: SiteData;
  locale: string;
  page: string;
  /** #1471 —— 这个语言的站级表单库（id + 名字），给 `form.id` 那格的下拉用。没有表单库 = 空数组（下拉只有「第一张」那一项）。 */
  forms?: EditorFormChoice[];
  /** 文件里那一份，存盘的底。见 `scripts/lib/editor-page.js` 文件头。 */
  raw: Record<string, unknown>;
  /**
   * 那份文件字节的 sha256。存盘时原样带回去：站里的 `write-page.js` 拿它跟当前文件比，编辑器打开之后
   * 这一页被别处改过就拒绝写入（#1409 QA2 r1：旧底稿整份写回会冲掉检查器 / AI 聊天刚做的改动）。
   */
  baseHash: string;
  schema: EditorSchema;
  /** `root.props` 是外壳三样打开时的值（#1405）—— 存盘时逐字段比的就是它。 */
  initialData: PuckLikeData;
  /** 框住我们的 dashboard 的 origin。空串 = 构建时没拿到（本地模板 dev），这时不能保存。 */
  trustedOrigin: string;
  /** #1406 —— 这种语言的站级块库（文件里那一份）：共用块的字段从它取，存盘时改动跟它比。 */
  siteBlocks: Record<string, unknown>;
  /** #1406 —— 每个共用块被哪几页 `ref`（`editor-page.js` §sharedRefs）；算「在 N 个页面上」用。 */
  refs: Record<string, string[]>;
  /** #1406 —— 这种语言现有的页（`visibility` 里写了不存在的页不算进 N）。 */
  slugs: string[];
  /**
   * #1448 —— 这个站有哪些编辑器页（`scripts/lib/editor-pages.js`，与 `generateStaticParams` 同一次调用），按语言分组。
   * 随 `ai1st:editor-ready` 交给 dashboard，面板条上的换页下拉就是它。
   */
  pages?: EditorPageGroup[];
}

/** #1406 —— 算「在 N 个页面上」要的三样。放在 context 里：它随底稿换，换它不该让整棵 Puck 重建。 */
type SharedInfo = { siteBlocks: Record<string, unknown>; refs: Record<string, string[]>; slugs: string[] };
const SharedInfoContext = createContext<SharedInfo>({ siteBlocks: {}, refs: {}, slugs: [] });

const usePuck = createUsePuck();

function summaryOf(item: unknown, index: number | undefined, subs: string[]): string {
  const o = (item || {}) as Record<string, unknown>;
  for (const k of subs) {
    const v = o[k];
    if (typeof v === 'string' && v.trim()) return v.length > 40 ? `${v.slice(0, 40)}…` : v;
  }
  return `Item ${(index ?? 0) + 1}`;
}

// ── #1463 —— 「预设 + 旋钮 + Custom」与颜色槽的两种控件 ────────────────────────────────────────
const CTRL_ROW = { display: 'flex', flexWrap: 'wrap' as const, gap: 6, margin: '4px 0 10px' };
const chip = (on: boolean) => ({
  padding: '4px 10px', borderRadius: 999, fontSize: 12, cursor: 'pointer', fontFamily: 'system-ui, sans-serif',
  border: `1px solid ${on ? '#1d4ed8' : '#d0d5dd'}`, background: on ? '#1d4ed8' : '#fff', color: on ? '#fff' : '#344054',
});
const SUB_LABEL = { fontSize: 12, fontWeight: 600, color: '#475467', margin: '6px 0 2px' } as const;

type OptionsValue = Record<string, unknown>;

/**
 * 预设一排 + 每个旋钮一排单选 + 布尔修饰的勾选框。点预设 = 三个旋钮一次设好；拧偏了第一排显示 Custom。
 * 判「是哪个预设」用 `block-knobs.js` §presetNameFor —— Section 渲染时算形态用的是同一个模块。
 */
function OptionsField({ f, value, onChange, readOnly }: { f: EditorField; value: OptionsValue; onChange: (v: OptionsValue) => void; readOnly?: boolean }) {
  const v = value && typeof value === 'object' ? value : {};
  const knobs = f.knobs || [];
  // 🔴 #1470 —— 没写的旋钮先落回 `presets[0]`（默认形态的那一组），再落回 `values[0]`：跟 `header-knobs.js`
  //    §normalizeKnobs、admin 的 `catalogKnobs.ts` 同一条兜底链。这里以前直接落 `values[0]`，只因为 hero
  //    旧的 `values[0]` 那一组恰好就是 Split 才没露馅；#1470 把 `image` 的 `none` 排到第一位之后，一块没写
  //    `options` 的 hero 侧栏会说 Text only、画布却画成 Split。
  const fallback: Record<string, unknown> = (f.presets && f.presets[0] && f.presets[0].knobs) || {};
  const current = Object.fromEntries(knobs.map((k) => [k.name, typeof v[k.name] === 'string' ? v[k.name]
    : k.values.includes(fallback[k.name] as string) ? fallback[k.name] : knobDefault(k)]));
  // #1483 —— 带颜色的预设（pricing 的 Rainbow）：判「是哪个预设」要连这一块的颜色字段一起比，点预设要连颜色字段一起写。
  //    颜色是这一块的另外两个字段（bg / featuredColor），这个字段的 onChange 只改得动 `options` ⟹ 从 Puck 读出选中的那一块、
  //    按 block-knobs.js §presetClickProps 算出整块的新 props，一次 `replace` 写回。没有带颜色预设的块（colorSlots 空）
  //    走原来的 onChange，一个字节不变。
  const colorSlots = f.colorSlots || [];
  // #1487 —— 带部件的预设（team 的 Hiring）同一条路：判预设要看这一块的部件字段有没有内容，点它要把空的部件用
  //    `partDemos` 填上 ⟹ 同样要读出选中的那一块、整块 `replace`。没有带部件预设的块（partDemos 空）不受影响。
  const partSlots = Object.keys(f.partDemos || {});
  const selected = usePuck((s) => (colorSlots.length || partSlots.length ? s.selectedItem : null));
  const dispatch = usePuck((s) => s.dispatch);
  const selectorFor = usePuck((s) => s.getSelectorForId);
  const colorsNow = selected ? Object.fromEntries(colorSlots.concat(partSlots).map((c) => [c, (selected.props as Record<string, unknown>)[c]])) : {};
  const name = presetNameFor({ slots: { options: { knobs } }, presets: f.presets || [] }, { ...current, ...colorsNow });
  const pick = (p: NonNullable<EditorField['presets']>[number]) => {
    const sel = selected ? selectorFor(String((selected.props as Record<string, unknown>).id)) : undefined;
    if (!selected || !sel) { onChange({ ...v, ...p.knobs }); return; }
    const props = presetClickProps(f, { ...(selected.props as Record<string, unknown>), options: v }, p.name);
    dispatch({ type: 'replace', destinationIndex: sel.index, destinationZone: sel.zone, data: { ...selected, props } as never });
  };
  return (
    <div data-editor-options="">
      <div style={SUB_LABEL}>Preset</div>
      <div style={CTRL_ROW}>
        {(f.presets || []).map((p) => (
          <button key={p.name} type="button" disabled={readOnly} style={chip(name === p.name)} data-editor-preset={p.name}
            aria-pressed={name === p.name} onClick={() => pick(p)}>
            {p.name}
          </button>
        ))}
        <span style={{ ...chip(name === 'custom'), cursor: 'default' }} data-editor-custom={name === 'custom' ? 'true' : 'false'}>Custom</span>
      </div>
      {knobs.map((k) => (
        <div key={k.name} data-editor-knob={k.name}>
          <div style={SUB_LABEL}>{k.name.charAt(0).toUpperCase() + k.name.slice(1)}</div>
          <div style={CTRL_ROW}>
            {k.values.map((val) => (
              <button key={val} type="button" disabled={readOnly} style={chip(current[k.name] === val)} data-editor-knob-value={val}
                aria-pressed={current[k.name] === val} onClick={() => onChange({ ...v, [k.name]: val })}>
                {val}
              </button>
            ))}
          </div>
        </div>
      ))}
      {(f.booleans || []).map((b) => (
        <label key={b} style={{ display: 'flex', gap: 6, alignItems: 'center', fontSize: 13 }} data-editor-bool={b}>
          <input type="checkbox" disabled={readOnly} checked={v[b] === true} onChange={(e) => onChange({ ...v, [b]: e.target.checked })} />
          {b.charAt(0).toUpperCase() + b.slice(1)}
        </label>
      ))}
    </div>
  );
}

/** 颜色槽：共用色板（`src/components/BgPicker.tsx`，#1477）—— 纯色一排 + 取色器 + 三档预设渐变 + 自定义 + None。
 *  存的是 `contrast.js` §normalizeBg 的形状：小写 `#rrggbb` / `brand` / `{stops, angle}`；None = undefined（删键）。 */
function ColorField({ f, value, onChange, readOnly }: { f: EditorField; value: unknown; onChange: (v: BgValue | undefined) => void; readOnly?: boolean }) {
  const cur = normalizeBg(value);
  const tone = cur ? toneForBg(cur) : 'light';
  return (
    <div data-editor-color="" data-editor-color-tone={tone}>
      <div style={CTRL_ROW}>
        <BgPicker value={cur} swatches={f.swatches || []} gradients={f.gradients} onChange={(v) => onChange(v ?? undefined)}
          disabled={readOnly} attrs="editor" size={26} clearLabel="None" />
      </div>
      <div style={{ fontSize: 12, color: '#667085' }}>Text colour follows the background automatically.</div>
    </div>
  );
}

/** 一个子字段：词表里有它（`choices`）就是下拉；带 `sources` 的是链接格（#1506）；否则是一格文字。 */
function subField(s: { sub: string; label: string; choices?: string[]; choiceDefault?: string; sources?: string[]; nested?: { sub: string; label: string }[] }, site: SiteData): Field {
  if (s.nested && s.nested.length) return nestedTextField(s.sub, s.nested);
  if (s.sources && s.sources.length) return linkHrefField(s.label, s.sources, site);
  if (s.choices && s.choiceDefault && s.choiceDefault !== s.choices[0]) return choiceField(s.label, s.choices, s.choiceDefault);
  return s.choices
    ? ({ type: 'select', label: s.label, options: s.choices.map((c) => ({ label: c, value: c })) } as Field)
    : ({ type: 'text', label: s.label } as Field);
}

// #1670 —— 列表项里的一个对象拆成几格平铺（价格块套餐的 `price` → Price / Yearly price，editor-schema.js §fieldsOf）。
//    值是整个对象，改一格之后变成什么由 editor-convert.js §nestedPartSet 定（往返守卫测的是同一个函数）。
function nestedTextField(key: string, parts: { sub: string; label: string }[]): Field {
  return {
    type: 'custom',
    label: key,
    render: ({ value, onChange, readOnly }: { value: unknown; onChange: (v: unknown) => void; readOnly?: boolean }) => {
      const obj = value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
      const set = (sub: string, v: string) => onChange(nestedPartSet(obj, sub, v));
      return (
        <div data-editor-nested={key}>
          {parts.map((p) => (
            <div key={p.sub} data-editor-nested-part={p.sub} style={{ marginBottom: 8 }}>
              <FieldLabel label={p.label} el="div" readOnly={readOnly} />
              <input type="text" value={typeof obj[p.sub] === 'string' || typeof obj[p.sub] === 'number' ? String(obj[p.sub]) : ''} readOnly={readOnly}
                onChange={(e) => set(p.sub, e.target.value)} style={INPUT_STYLE} />
            </div>
          ))}
        </div>
      );
    },
  } as unknown as Field;
}

// #1481 —— 词表的默认值不是第一项（hero / cta 的 `eyebrow.style`：词表 none 排第一、没写时画 pill）：Puck 自带的
//    select 没写值时浏览器亮第一项，侧栏就会说 none、画布却是 pill。这一格自己画：没写值时亮 `choiceDefault`。
function choiceField(label: string, choices: string[], fallback: string): Field {
  return {
    type: 'custom',
    label,
    render: ({ value, onChange, readOnly }: { value: unknown; onChange: (v: unknown) => void; readOnly?: boolean }) => (
      <div data-editor-choice={label}>
        <FieldLabel label={label} el="div" readOnly={readOnly} />
        <select value={typeof value === 'string' && choices.includes(value) ? value : fallback} disabled={readOnly}
          onChange={(e) => onChange(e.target.value)} style={INPUT_STYLE}>
          {choices.map((c) => <option key={c} value={c}>{c}</option>)}
        </select>
      </div>
    ),
  } as unknown as Field;
}

// ── #1506 —— 链接格：手填一个地址，或选「Business phone / Business email」（写成 `{source: "phone"}` 引用） ──────────
//    引用在构建时（和画布上）从 brand.json 展开成 `tel:` / `mailto:`（`scripts/lib/item-sources.js`）——
//    老板以后改电话，这个按钮跟着变。多门店时再选哪一家（`location` 是下标，第一家不写）。
const LINK_SOURCE_LABELS: Record<string, string> = { phone: 'Business phone', email: 'Business email' };
const CUSTOM_LINK = '';
const INPUT_STYLE = { width: '100%', padding: '6px 8px', fontSize: 14, border: '1px solid #d0d5dd', borderRadius: 6, fontFamily: 'inherit' } as const;

function LinkHrefControl({ label, sources, value, onChange, readOnly, site }: {
  label: string; sources: string[]; value: unknown; onChange: (v: unknown) => void; readOnly?: boolean; site: SiteData;
}) {
  const siteBrand = site.brand;
  const ref = isSourceRef(value) && sources.includes(value.source) ? value : null;
  const locations = Array.isArray(siteBrand.locations) ? siteBrand.locations : [];
  const at = ref && Number.isInteger(ref.location) ? (ref.location as number) : 0;
  const pick = (mode: string) => onChange(mode === CUSTOM_LINK ? '' : { source: mode });
  return (
    <div data-editor-link="" data-editor-link-source={ref ? ref.source : 'custom'}>
      <FieldLabel label={label} el="div" readOnly={readOnly} />
      <select data-editor-link-mode="" value={ref ? ref.source : CUSTOM_LINK} disabled={readOnly}
        onChange={(e) => pick(e.target.value)} style={{ ...INPUT_STYLE, marginBottom: 6 }}>
        <option value={CUSTOM_LINK}>Custom link</option>
        {sources.map((src) => <option key={src} value={src}>{LINK_SOURCE_LABELS[src] || src}</option>)}
      </select>
      {ref && locations.length > 1 && (
        <select data-editor-link-location="" value={String(at)} disabled={readOnly} style={INPUT_STYLE}
          onChange={(e) => {
            const i = Number(e.target.value);
            onChange(i === 0 ? { source: ref.source } : { source: ref.source, location: i });
          }}>
          {locations.map((l, i) => <option key={i} value={String(i)}>{l.label || l.address || `Location ${i + 1}`}</option>)}
        </select>
      )}
      {!ref && (
        <input data-editor-link-input="" type="text" value={typeof value === 'string' ? value : ''} readOnly={readOnly}
          onChange={(e) => onChange(e.target.value)} placeholder="/contact or https://…" style={INPUT_STYLE} />
      )}
    </div>
  );
}

function linkHrefField(label: string, sources: string[], site: SiteData): Field {
  return {
    type: 'custom',
    label,
    render: ({ value, onChange, readOnly }: { value: unknown; onChange: (v: unknown) => void; readOnly?: boolean }) => (
      <LinkHrefControl label={label} sources={sources} value={value} onChange={onChange} readOnly={readOnly} site={site} />
    ),
  } as unknown as Field;
}

// #1634 —— 表单库那一张的摘要搬到 FormCopyEditor.tsx（面板要三句文字的现值），这里照旧导出这个名字。
export type { EditorFormChoice } from './FormCopyEditor';

/** manifest 的一个槽位 → 一个 Puck 字段。控件由 `kind` 决定（editor-schema.js 文件头那张表）。
 *  #1471 —— `form` 槽的 `id`（选站级表单库里哪一张）画成下拉：选项 = 这个语言的表单名（`site-forms.js` §formIdOptions）。 */
function puckField(f: EditorField, forms: EditorFormChoice[], site: SiteData): Field {
  switch (f.control) {
    case 'text':
      return { type: 'text', label: f.label };
    // #1497 —— 一个整数设置（blog 的 postCount 2–6）：一格下拉。第一项「Default」= 不写（块按自己的默认值走），
    //    免得没写过的块在侧栏里显示成 2、看起来像是老板选过。
    case 'int':
      return { type: 'select', label: f.label, options: [{ label: 'Default', value: '' }, ...(f.values || []).map((v) => ({ label: v, value: v }))] } as Field;
    // #1498 —— richtext（content.body）：一个多行文本框，下面一行写明能用哪几种写法（scripts/lib/richtext.js 只认这几样）。
    case 'richtext':
      return {
        type: 'custom',
        label: f.label,
        render: ({ value, onChange, readOnly }: { value: unknown; onChange: (v: string) => void; readOnly?: boolean }) => (
          <div>
            <FieldLabel label={f.label} el="div" />
            <textarea
              data-editor-richtext={f.slot}
              value={typeof value === 'string' ? value : ''}
              onChange={(e) => onChange(e.target.value)}
              readOnly={readOnly}
              rows={10}
              style={{ width: '100%', fontFamily: 'inherit', fontSize: 14, lineHeight: 1.5, padding: 8, border: '1px solid #d0d5dd', borderRadius: 6, resize: 'vertical' }}
            />
            <div style={{ fontSize: 12, color: '#667085', marginTop: 4 }}>
              Blank line = new paragraph · &quot;- &quot; = bullet list · &quot;1. &quot; = numbered list · **bold** · [text](/link)
            </div>
          </div>
        ),
      } as unknown as Field;
    case 'options':
      return {
        type: 'custom',
        label: f.label,
        render: ({ value, onChange, readOnly }: { value: OptionsValue; onChange: (v: OptionsValue) => void; readOnly?: boolean }) => (
          <div><FieldLabel label={f.label} el="div" /><OptionsField f={f} value={value} onChange={onChange} readOnly={readOnly} /></div>
        ),
      } as unknown as Field;
    case 'color':
      return {
        type: 'custom',
        label: f.label,
        render: ({ value, onChange, readOnly }: { value: unknown; onChange: (v: BgValue | undefined) => void; readOnly?: boolean }) => (
          <div><FieldLabel label={f.label} el="div" /><ColorField f={f} value={value} onChange={onChange} readOnly={readOnly} /></div>
        ),
      } as unknown as Field;
    case 'object':
      return {
        type: 'object',
        label: f.label,
        // #1634 —— `form.id`：下拉（不止一张表单时）+「Edit this form」，表单库从 FormsContext 现取（改了表单名下拉跟着变）。
        objectFields: Object.fromEntries(f.subs.map((s) => [s.sub, f.slot === 'form' && s.sub === 'id'
          ? ({
            type: 'custom',
            label: 'Form',
            render: ({ value, onChange, readOnly }: { value: unknown; onChange: (v: string) => void; readOnly?: boolean }) => (
              <FormIdField value={value} onChange={onChange} readOnly={readOnly} />
            ),
          } as unknown as Field)
          : subField(s, site)])),
      } as Field;
    case 'list':
      return {
        type: 'array',
        label: f.label,
        arrayFields: Object.fromEntries(f.subs.map((s) => [s.sub, subField(s, site)])),
        defaultItemProps: {},
        getItemSummary: (item: unknown, i?: number) => summaryOf(item, i, f.summary || f.subs.map((s) => s.sub)),
      } as Field;
    case 'strings':
      return {
        type: 'array',
        label: f.label,
        arrayFields: { value: { type: 'text', label: f.label } },
        defaultItemProps: { value: '' },
        getItemSummary: (item: unknown, i?: number) => summaryOf(item, i, ['value']),
      } as Field;
  }
}

type ItemProps = Record<string, unknown> & { id: string; _shape?: string; _src?: PuckItemSrc };

// 共用块面板顶上那句话（只读的说明，不是输入框）。
const UNKNOWN_NOTE: Field = {
  type: 'custom',
  label: 'Unknown section',
  render: () => (
    <p data-editor-unknown-note style={{ margin: 0, fontSize: 13, lineHeight: 1.5, color: '#475467' }}>
      This section&apos;s type isn&apos;t in this site&apos;s section library, so it doesn&apos;t show on the live page.
      It is kept as is when you save.
    </p>
  ),
} as Field;

// 在原始页面 JSON 里定位不到的块（`locateInRaw` 的 not-found）：只读、原样留着。
const LOCKED_NOTE: Field = {
  type: 'custom',
  label: 'Locked section',
  render: () => (
    <p data-editor-locked-note style={{ margin: 0, fontSize: 13, lineHeight: 1.5, color: '#475467' }}>
      This section can&apos;t be edited here. It is kept as is when you save.
    </p>
  ),
} as Field;

/** #1406 —— 共用块面板顶上那句话。N 按底稿现算（§sharedReach），`"*"` 的块写「所有页面」、不写数字。 */
function SharedNote({ id }: { id: string }) {
  const info = useContext(SharedInfoContext);
  const reach = sharedReach({ siteBlocks: info.siteBlocks, refs: info.refs, slugs: info.slugs, id });
  const removable = sharedRemovable(info.siteBlocks, id);
  return (
    <div data-editor-shared-note data-shared-pages={reach.all ? 'all' : String(reach.pages)} style={{ fontSize: 13, lineHeight: 1.5, color: '#475467' }}>
      <p style={{ margin: 0 }}>
        {reach.all
          ? 'This section is on all pages. Changing it changes every page.'
          : `This section is on ${reach.pages} ${reach.pages === 1 ? 'page' : 'pages'}. Changing it changes ${reach.pages === 1 ? 'that page' : `all ${reach.pages} of them`}.`}
      </p>
      {!removable && (
        <p data-editor-shared-no-remove style={{ margin: '6px 0 0' }}>
          It is on every page, so it can&apos;t be removed from just this one.
        </p>
      )}
    </div>
  );
}

/**
 * #1505 —— 列表槽写成引用（`items: {source: "services"}`）时，面板上那一栏：只读，一行说条目从哪来、去那里改，
 * 再给一个「改成手写」—— 把**现在**展开出来的那几条写成条目数组（之后就是普通的手写列表，不再跟着站点数据变）。
 * 展开用的是画布同一个函数、同一份站点数据，所以写下来的就是老板此刻在画布上看到的那几条。
 */
function sourcedItemsField(f: EditorField, type: string, locale: string, site: SiteData): Field {
  return {
    type: 'custom',
    label: f.label,
    render: ({ value, onChange, readOnly }: { value: unknown; onChange: (v: unknown) => void; readOnly?: boolean }) => {
      const toManual = () => {
        const [b] = resolveItemSources([{ type, data: { [f.slot]: value } } as BlockConfig], itemSourceContext(site, locale));
        const items = (b.data as Record<string, unknown>)[f.slot];
        onChange(Array.isArray(items) ? JSON.parse(JSON.stringify(items)) : []);
      };
      return (
        <div data-editor-sourced={f.slot} data-editor-sourced-from={isSourceRef(value) ? value.source : ''}>
          <FieldLabel label={f.label} el="div" readOnly />
          <p data-editor-sourced-note style={NOTE_STYLE}>
            {describeRef(value)} Change them there.
          </p>
          {!readOnly && (
            <button type="button" data-editor-sourced-manual onClick={toManual} style={{ marginTop: 8, padding: '4px 10px', fontSize: 13, borderRadius: 6, border: '1px solid #d0d5dd', background: '#fff', cursor: 'pointer' }}>
              Write these items by hand
            </button>
          )}
        </div>
      );
    },
  } as unknown as Field;
}

function sharedNoteField(id: string): Field {
  return { type: 'custom', label: 'Shared section', render: () => <SharedNote id={id} /> } as Field;
}

/**
 * 画布上的一块：真站那一个组件（经 `SectionRenderer`），不是示意图。
 *
 * 数据的底是**归一化之后**那一块（`_src.view`，跟真页面同一份：列表已升格、`data-has-*` 已算好），
 * 老板改过的字段才换成新值 —— 用的是存盘时同一个合法（§dataFromProps），画布和落盘不会各说各的。
 */
function CanvasBlock({ component, props: live, locale, pageSlug, site }: { component: EditorComponent; props: ItemProps; locale: string; pageSlug?: string; site: SiteData }) {
  // #1657 —— 老板正在画布上打这一块的某一格：那一格按打之前的值画（浏览器手上的字才是真的，React 不去重写那个文本节点，
  //    光标就不会每敲一个字跳回开头）。右栏和存盘读的是 Puck 里的新值，不受这里影响。
  const freeze = useContext(InlineFreezeContext);
  const props = freeze && freeze.id === live.id ? setAt(live, freeze.path, freeze.value) : live;
  const src = props._src;
  // 复制出来的条目跟原件共用一份 `_src.view`，画布上的 `data-block-id` 换成它自己的 id（存盘时它也会拿到新 id）。
  const baseView = (src?.view || { type: component.type }) as unknown as BlockConfig;
  const view = { ...baseView, id: src && props.id === src.pid ? baseView.id : props.id } as BlockConfig;
  let data: Record<string, unknown>;
  if (src) {
    // 字段 prop 是按哪一份取的，就跟哪一份比：锁住的块 → 归一化后的那份；共用块 → 块库文件里那份（#1406）；
    // 其余 → 页面文件里那一条。
    const baseData = (src.locked ? view.data : src.shared ? src.sharedData : src.entry?.data) || {};
    const initial = fieldProps(component, baseData);
    const merged = dataFromProps(component, baseData, props);
    data = { ...((view.data as Record<string, unknown>) || {}) };
    for (const f of component.fields) {
      if (deepEqual(props[f.slot], initial[f.slot])) continue;
      if (f.slot in merged) data[f.slot] = merged[f.slot]; else delete data[f.slot];
    }
  } else {
    data = dataFromProps(component, {}, props);
  }
  // #1443 —— 形态按这块**当前的** data 现算（跟构建同一套，§canvasShape）：选了 Theme default 当场换回主题那一个。
  const block = { ...view, data, shape: canvasShape(component, props._shape, data) } as BlockConfig;
  // #1505 —— 写成引用的列表槽（`items: {source: "services"}`）在画布上显示展开后的样子：跟真站同一个函数、同一份站点数据，
  //    在这里展开一次，下面普通块和共用块两支用的都是它（只补一支的话，另一支上那块是空的、而且没人会红）。
  const [shown] = resolveItemSources([block], itemSourceContext(site, locale, pageSlug));
  if (src?.shared) {
    // #1406 —— 共用块在画布上一眼看得出来：左上角一枚标，块名旁写「Shared」（不接鼠标，点它等于点这一块）。
    return (
      <div data-editor-shared={src.shared} style={{ position: 'relative' }}>
        <span
          data-editor-shared-badge
          style={{ position: 'absolute', top: 8, left: 8, zIndex: 5, pointerEvents: 'none', padding: '2px 8px', borderRadius: 999, fontSize: 12, fontWeight: 600, background: '#1d4ed8', color: '#fff', fontFamily: 'system-ui, sans-serif' }}
        >
          {component.label} · Shared
        </span>
        <SectionRenderer site={site} blocks={[shown]} locale={locale} pageSlug={pageSlug} />
      </div>
    );
  }
  return <SectionRenderer site={site} blocks={[shown]} locale={locale} pageSlug={pageSlug} />;
}

/**
 * @param removable #1406 —— 这个共用块能不能从这一页删（`"*"` 的不能）。读的是编辑器手上**现在**那份块库。
 */
/** 块的形态下拉叫什么（#1454 存盘记录里「改了形态」也用这个字）。 */
const SHAPE_FIELD_LABEL = 'Layout';

// #1665 —— `site` = 这个站的内容（编辑器页在服务端用加载器读的那份，经 EditorApp 的 props 进来）。它以前是一份编译期常量
//    （`@/lib/config`），画布上的块、外壳、链接下拉、引用展开都直接 import；现在从这里一路递下去（字段 / 画布 / 外壳）。
//    一张编辑器页一辈子就这一份，所以跟 schema 一样是造配置时定下的，不走 context。
export function buildConfig(site: SiteData, schema: EditorSchema, locale: string, removable: (id: string) => boolean = () => true, forms: EditorFormChoice[] = [], pageSlug?: string): Config {
  const components: Record<string, Config['components'][string]> = {};
  for (const c of schema.components) {
    const fields: Fields = {};
    for (const f of c.fields) fields[f.slot] = puckField(f, forms, site);
    // #1463 —— 带预设的块（hero）不再给「Layout」形态下拉：预设那一排就是它，两处各选一个会互相打架。
    //    `_shape` 这个 prop 照旧在（defaultProps / 页面 JSON 里原来那个值），存盘原样带回去。
    const hasPresets = c.fields.some((f) => f.control === 'options' && (f.presets || []).length > 0);
    fields._shape = {
      type: 'select',
      label: SHAPE_FIELD_LABEL,
      // 选项 = 形态子目录去掉候选（schema 里已经过滤好）。`needs` 不为空的形态，这个块缺那些槽位时
      // 构建会落回默认 —— 选项上写明，别让老板选了之后以为坏了。
      // #1443 —— 第一项 `Theme default`：跟着主题走，存盘时删掉这个块的 `shape` 键（页面 JSON 里没有这个键的块
      // 打开时显示的就是它）；新插的块也默认它。
      // #1445 —— 这是**不带当前值**的那一份；钉着退役/候选形态的块在下面 `resolveFields` 里按它自己的值多一项。
      options: shapeOptions(c, THEME_DEFAULT),
    };
    // #1445 —— 这一块的 `_shape` 不在清单里 ⟹ 换一份多了 `(retired)` 那一项的下拉，否则框里是空白的。
    if (hasPresets) delete fields._shape;
    const fieldsFor = (shape: unknown): Fields => {
      if (hasPresets) return fields;
      const options = shapeOptions(c, shape);
      return options.length === (fields._shape as { options: unknown[] }).options.length
        ? fields
        : { ...fields, _shape: { ...fields._shape, options } } as Fields;
    };
    const defaultProps: Record<string, unknown> = { ...fieldProps(c, {}), _shape: THEME_DEFAULT };
    components[c.type] = {
      label: c.label,
      fields,
      defaultProps,
      // 锁住的块（定位不到）：一样都不许动。共用块（#1406）：能改字、能挪、能删，不能复制（会造出同 id 的第二条
      // `{ref}`，构建当场报撞车）；「所有页面」上的共用块不能删（Chris 2026-09-23）。
      // 🔴 不关 `edit`：Puck 对 `edit: false` 的块整块禁用、点都点不中 —— 那就是「点了没反应」。
      //    留着能选中，字段按条目上的 `readOnly` 灰掉，面板顶上一句话说为什么。
      resolvePermissions: (data: { props?: ItemProps }) => {
        const src = data.props?._src;
        if (src?.locked) return { drag: false, duplicate: false, delete: false };
        if (src?.shared) return { duplicate: false, delete: removable(src.shared) };
        return {};
      },
      resolveFields: (data: { props?: ItemProps }) => {
        const src = data.props?._src;
        let own = fieldsFor(data.props?._shape);
        // #1505 —— 写成引用的列表槽：那一栏换成只读提示 + 「改成手写」（§sourcedItemsField）。点了之后 prop 变回数组，
        //    下一次 resolveFields 就回到普通的列表字段。
        const sourced = c.fields.filter((f) => f.control === 'list' && isSourceRef(data.props?.[f.slot]));
        if (sourced.length) own = { ...own, ...Object.fromEntries(sourced.map((f) => [f.slot, sourcedItemsField(f, c.type, locale, site)])) };
        if (src?.locked) return { _locked: LOCKED_NOTE, ...own };
        if (src?.shared) return { _shared: sharedNoteField(src.shared), ...own };
        return own;
      },
      render: (props: ItemProps) => <CanvasBlock component={c} props={props} locale={locale} pageSlug={pageSlug} site={site} />,
    } as unknown as Config['components'][string];
  }
  // 页面里有、而这个站的区块库里没有的块（#1404 QA1 r1）：锁住的占位，能选中、看得见，不进左栏
  // （下面 `categories` 把它藏起来），存盘时那一条原样留在原位。
  components[UNKNOWN_TYPE] = {
    label: 'Unknown section',
    fields: { _unknown: UNKNOWN_NOTE },
    resolvePermissions: () => ({ drag: false, duplicate: false, delete: false }),
    render: (props: ItemProps) => {
      const t = String((props._src?.view as { type?: unknown } | undefined)?.type ?? '');
      return (
        <div data-editor-unknown={t} style={{ padding: '14px 16px', fontSize: 13, color: '#667085', background: '#f2f4f7', border: '1px dashed #d0d5dd' }}>
          Unknown section “{t}” — not in this site&apos;s section library, so it isn&apos;t shown on the live page. It is kept as is.
        </div>
      );
    },
  } as unknown as Config['components'][string];
  return {
    components,
    categories: {
      sections: { title: 'Sections', components: schema.components.map((c) => c.type) },
      unknown: { components: [UNKNOWN_TYPE], visible: false },
      other: { visible: false },
    },
    root: rootConfig(schema, locale, site),
  } as Config;
}

const NOTE_STYLE = { margin: 0, fontSize: 13, lineHeight: 1.5, color: '#475467' } as const;

// 形态下拉底下那句话（票正文做什么 5）。它是真话：只有换成另一套主题才清掉按站覆盖（worker §themeWriteCommand），
// 只改颜色字体 / 更新网站都留着。
const SHAPE_NOTE: Field = {
  type: 'custom',
  label: 'About these styles',
  render: () => (
    <p data-editor-shape-note style={NOTE_STYLE}>
      Header and footer styles apply to every page and every language. Changing the theme puts them back to the
      new theme&apos;s own styles.
    </p>
  ),
} as Field;

type RootProps = {
  layout?: string;
  headerShape?: string;
  footerShape?: string;
  children?: ReactNode;
};

/**
 * #1405 —— 外壳三样：Puck 的 root 字段（整页一份，不在块列表里）。可选值全部来自构建时的 schema
 * （形态 = 子目录去掉候选；布局 = `page-layouts/` 库），这里不写任何名单。
 *
 * 🔴 **这里不判「哪些组合构建不收」**（带公告条的布局 + 透明浮层顶栏 / 缺某种语言的公告条文字）：那条规则
 *    只住在站里的写盘脚本（用构建同一个 `needsTopbar`），拒了那句话原样回到状态栏（票正文做什么 6）。
 *    在这里按自己的判断禁用选项，总有一天一个说行、一个说不行。
 * 🔴 唯一在这里灰掉的是「布局自己钉了页脚形态」时的页脚下拉（做什么 8）—— 判据是 schema 给的 `pinsFooter`
 *    （从布局文件算出来的），不是布局名。
 */
/** 外壳三样在面板上叫什么。#1454 —— 存盘记录（§describeSave）用同一份：老板在记录里读到的就是他点的那个字段名。 */
const ROOT_FIELD_LABELS: Record<string, string> = {
  layout: 'Page layout (whole website)',
  headerShape: 'Header style (whole website)',
  footerShape: 'Footer style (whole website)',
};

function rootConfig(schema: EditorSchema, locale: string, site: SiteData) {
  const opts = (names: string[]) => names.map((n) => ({ value: n, label: n }));
  const fields: Fields = {
    layout: { type: 'select', label: ROOT_FIELD_LABELS.layout, options: schema.root.layouts.map((l) => ({ value: l.id, label: l.id })) },
    headerShape: { type: 'select', label: ROOT_FIELD_LABELS.headerShape, options: opts(schema.root.header) },
    footerShape: { type: 'select', label: ROOT_FIELD_LABELS.footerShape, options: opts(schema.root.footer) },
    _shapeNote: SHAPE_NOTE,
  };
  const layoutOf = (id: unknown) => schema.root.layouts.find((l) => l.id === id);
  return {
    fields,
    resolveFields: (data: { props?: RootProps }) => {
      if (!layoutOf(data.props?.layout)?.pinsFooter) return fields;
      return {
        ...fields,
        footerShape: {
          type: 'custom',
          label: 'Footer style (whole website)',
          render: () => (
            <FieldLabel label="Footer style (whole website)" readOnly>
              <div data-editor-footer-pinned>
                <select disabled value="" style={{ width: '100%', padding: 6 }} aria-label="Footer style">
                  <option value="">Set by the page layout</option>
                </select>
                <p style={{ ...NOTE_STYLE, marginTop: 6 }}>This layout comes with its own footer styles, so this can&apos;t be changed while it is selected.</p>
              </div>
            </FieldLabel>
          ),
        } as Field,
      };
    },
    render: ({ children, layout, headerShape, footerShape }: RootProps) => {
      const l = layoutOf(layout) || schema.root.layouts[0];
      return (
        <SiteShell
          site={site}
          locale={locale}
          shell={{
            layout: { regions: l ? l.regions : ['header', 'content', 'footer'], repeatVariants: l ? l.repeatVariants : {} },
            headerShape: headerShape || '',
            footerShape: footerShape || '',
          }}
        >
          {children}
        </SiteShell>
      );
    },
  };
}

/**
 * #1452 —— 底稿送来的外壳三样现值（站里 `editor-root.js` §readRootValues，形状同 page.tsx 喂给 `rootToPuck` 的那份）
 * 合进构建时那份 root。🔴 当外来数据：逐个字段查类型，不对（或底稿压根没带 —— #1452 之前建的站）就留构建时的值。
 * 布局 / 形态**不**在这里按 schema 的名单筛：盘上的值不在名单里时，构建时那份也一样会是它，画布那头
 * `layoutOf(layout) || schema.root.layouts[0]` 是现成的兜底（PM 裁定第 3 条）。
 */
function openRoot(built: PuckLikeData['root'], sent: unknown): PuckLikeData['root'] {
  if (!sent || typeof sent !== 'object' || Array.isArray(sent)) return built;
  const v = sent as Record<string, unknown>;
  const str = (k: string) => (typeof v[k] === 'string' ? { [k]: v[k] as string } : {});
  const got = { ...str('layout'), ...str('headerShape'), ...str('footerShape') };
  if (!Object.keys(got).length) return built;
  return { ...built, props: rootToPuck({ ...built.props, ...got } as never) };
}

type Status = { kind: 'idle' | 'saving' | 'saved' | 'error'; text: string };

/**
 * 存盘要用的那一份底：原始 JSON + 打开时的 Puck Data（§puckToPage 要它的 content）+ 文件的 sha256 + 上一次存下去的 JSON。
 * `initial.root.props` 是外壳三样的比较基准（#1405）：打开时是构建时那份，每存成功一次就把送出去的字段合进去。
 */
// #1406 —— `siteBlocks`：块库的底（共用块的改动跟它比；每存成功一次把送出去的那几处合进去）。
// `sharedOwn`（#1406）：画布上每个共用块的字段是按哪一份 data 取的 —— 存成功过的才在里面（没有就是打开时的
// `_src.sharedData`）。「老板改过没有」跟它比，不跟 `siteBlocks`（dashboard 重取的、带着别处改动的那份）比。
type Base = { raw: Record<string, unknown>; initial: PuckLikeData; hash: string; saved: Record<string, unknown>; siteBlocks: Record<string, unknown>; sharedOwn: Record<string, Record<string, unknown>> };

type PuckDispatch = (action: { type: 'setData'; data: Data; recordHistory?: boolean }) => void;

/**
 * #1442 —— 新底稿到了、而画布上有没存的改动 ⟹ 画布不换，留住老板的字，画布底部浮一条说明（§EditorShell；`external` = 别处存过这一页，
 * `ai` = AI 的改动迟到了：画布 20 秒兜底解锁之后才到，见 useEditorChat §APPLY_SAFETY_MS）。存成功 / 画布换成新的一份时清掉。
 * 🔴 hash 换成新的（按「Keep my changes」覆盖那一笔），不留旧的：留旧的就会撞 write-page exit 10，界面让他关掉重开 ——
 *    打的字照样没了（PM 二审技术须知）。
 * #1453 —— 这两种情况下 autosave 停着（§autosavePaused）：自动存 = 不问他就盖掉那次改动（AC 4「解锁那一刻没有排队的
 * 手改冲出去覆盖 AI 那份」）。`stale` = 这一笔被站里拒了（两个标签页，exit 10）：hash 是旧的，存不进去，只能重载。
 */
type Kept = 'external' | 'ai' | 'stale' | null;
const KEPT_TEXT: Record<'external' | 'ai' | 'stale', string> = {
  external: 'This page was changed somewhere else (in another tab, or by undoing a change in the AI chat) while you were editing, so that change is not shown here. Your changes are still here, and nothing is saved until you choose: keep yours (they replace that change), or load the latest version (your unsaved changes will be lost).',
  ai: "The AI's change was not put on the page, because you were still editing. Your changes are still here, and nothing is saved until you choose: keep yours (they replace the AI's change to this page), or load the latest version (your unsaved changes will be lost).",
  stale: 'This page was changed somewhere else (in another tab, or by the AI) after you opened it, so your latest changes were not saved. They are still here, but they cannot be saved on top of that change. Load the latest version to keep editing — the changes that were not saved will be lost.',
};
// #1657 —— 等 dashboard 回 AI 改写最多等多久（它那一侧调一次 Claude，正常几秒）。
const REWRITE_WAIT_MS = 90_000;
// 停手多久算「一笔改完」（Chris：失焦或停手 1–2 秒）。
const AUTOSAVE_IDLE_MS = 1500;
// 浮条在的时候，发 AI 消息 / 换页 / 关编辑器都先停下来等他（不替他选「留下我的」）。`stale` 那种没得选，只能加载最新版本。
function keptBlocksText(kept: Kept, what: 'message' | 'leave'): string {
  if (kept === 'stale') {
    // 跟「先存被拒」那条路说同一件事（发得比停手快时走的是那条）：存不上，因为在别处改过。
    const head = what === 'message' ? 'Your message was not sent.' : 'Your changes could not be saved, so the editor stayed on this page.';
    return `${head} This page was changed somewhere else after you opened it — load the latest version (at the bottom of the editor) first.`;
  }
  const head = what === 'message' ? 'Your message was not sent.' : 'The editor stayed on this page.';
  return `${head} First choose which version to keep, using the buttons at the bottom of the editor.`;
}

/** 拿到 Puck 自己的 dispatch（`external` 换数据用）。放在 headerActions 里，它才在 Puck 的 store 之下。 */
function DispatchHandle({ handle, getter }: { handle: { current: PuckDispatch | null }; getter: { current: GetPuck | null } }) {
  handle.current = usePuck((s) => s.dispatch) as unknown as PuckDispatch;
  // #1410 —— 撤销历史（`reason: ai` 要读、要换）。拿的是「读最新状态」的函数，不订阅：换历史不该让这里重渲染。
  getter.current = useGetPuck() as unknown as GetPuck;
  return null;
}

type PuckHistory = { state: { data: Data; ui?: unknown }; id?: string };

/**
 * #1410 —— 交给 `setHistories` 的每一条都不带 `indexes`。撤销 / 前进 / setHistories 在 Puck 0.23 里都是 `set`
 * （`reducer/actions/set.ts`），它见到 state 里有 `indexes` 就直接用、不按 data 重建 —— 换过 data 的快照（§swapShared）
 * 留着旧的那份，画布就还按换之前的块画。没换过的快照拿掉它也无害：Puck 按 data 重建一份一样的。
 * 📌 页面那一步（`reason: ai` 且 record）上一版曾在 e2e 里见过一次「撤销后位置对、画布仍是 AI 的字」，之后单变量拿掉这里
 *    复现不出来（4/4 退对）；留着它是因为 Puck 对 indexes 的用法就是上面那样，不是因为有一格守着它。
 */
function noIndexes(h: PuckHistory): PuckHistory {
  const { indexes: _stale, ...state } = h.state as Record<string, unknown>; // eslint-disable-line @typescript-eslint/no-unused-vars
  return { ...h, state: state as PuckHistory['state'] };
}
type GetPuck = () => {
  appState: { data: Data; ui?: unknown };
  history: { histories: PuckHistory[]; index: number; setHistories: (h: PuckHistory[]) => void; setHistoryIndex: (i: number) => void };
};

/**
 * #1410 —— 状态栏。`aiStep` 是最近那次 AI 记下的那一步：它同时改了共用块、而老板把它撤销了（当前位置在它之前）⟹ 说一句
 * 「共用块的改动请用聊天里的回退」（做什么 7 的 📌）—— 撤销退不掉那一半。
 * #1453 —— 「有未保存的改动，按 Save」那句没了：停手就自动存，状态字在 dashboard 的面板条上。
 */
function HistoryNote({ aiStep, locked }: { aiStep: { id: string; mixed: boolean } | null; locked: boolean }) {
  const history = usePuck((s) => s.history);
  const at = aiStep ? history.histories.findIndex((h) => h.id === aiStep.id) : -1;
  const sharedStays = !!aiStep?.mixed && at >= 0 && history.index < at;
  // 撤销历史的读数（当前位置 / 条数）：不显示，给验收量「AI 这一下记没记进历史」用。
  const probe = <span data-editor-history hidden data-index={history.index} data-length={history.histories.length} />;
  if (locked) return (
    <span data-editor-ai-lock style={{ fontSize: 13, color: '#475467' }}>
      {probe}
      The AI is editing this page — you can keep editing when it&apos;s done.
    </span>
  );
  if (!sharedStays) return probe;
  return (
    <span data-editor-shared-stays style={{ fontSize: 13, color: '#b54708' }}>
      {probe}
      Changes the AI made to shared sections are not undone here — use Revert in the AI chat for those.
    </span>
  );
}

/**
 * #1453 —— autosave 的眼睛：画布数据每变一次就告诉 EditorApp（§onCanvasChange 重新开始数停手的时间）。
 * 放在 headerActions 里，它才在 Puck 的 store 之下；只订阅 data，不渲染任何东西。
 */
function Autosave({ onChange }: { onChange: (d: Data) => void }) {
  const data = usePuck((s) => s.appState.data);
  const ref = useRef(onChange);
  ref.current = onChange;
  useEffect(() => { ref.current(data); }, [data]);
  return null;
}

/**
 * #1410 —— 给 Puck 的 `overrides` 必须是**同一个对象**：Puck 按它算出 `overrides.puck`，拿来当组件类型用
 * （`Layout` 的 `CustomPuck`），对象一换就是一个新组件类型 ⟹ 整个编辑器布局（画布 iframe、聊天侧栏）卸载重挂。
 * 聊天状态流式时每 50ms 来一条、每条都让 EditorApp 重渲染，内联写法等于每 50ms 重挂一次画布：画布闪、输入框里没发
 * 的字没了、Revert 的确认框自己关掉（e2e ⑩ 量这个；⑧ 等「Undo it」超时就是这么红的）。
 * 所以两个 override 是模块级组件，要用的东西从 `EditorUiContext` 读（context 变了只让它们重渲染，不换类型）。
 */
type EditorUi = {
  /** AI 在改这一页（§useAiLockGuard）：画布只读、撤销 / 前进 / 自动存都停。 */
  locked: boolean;
  dispatchRef: { current: PuckDispatch | null };
  getPuckRef: { current: GetPuck | null };
  aiStep: { id: string; mixed: boolean } | null;
  kept: Kept;
  onCanvasChange: (d: Data) => void;
  /** #1453 —— 浮条上那两颗：留下我的（照原样存这一笔，盖掉那次改动）/ 加载最新版本（重载编辑器）。 */
  keepMine: () => void;
  reloadLatest: () => void;
  retrySave: () => void;
  status: Status;
  chat: EditorChatState | null;
  chatNotice: { kind: 'info' | 'error'; text: string } | null;
  chatPending: boolean;
  page: string;
  locale: string;
  rawKey: 'blocks' | 'sections';
  sendChat: (text: string, scope: ChatScope | null) => void;
  revertChat: (messageId: number) => void;
};
const EditorUiContext = createContext<EditorUi | null>(null);

function EditorHeaderActions() {
  const ui = useContext(EditorUiContext);
  if (!ui) return <></>;
  return (
    <>
      <DispatchHandle handle={ui.dispatchRef} getter={ui.getPuckRef} />
      <Autosave onChange={ui.onCanvasChange} />
      <HistoryNote aiStep={ui.aiStep} locked={ui.locked} />
      <SaveStatus status={ui.status} onRetry={ui.retrySave} hideError={!!ui.kept} />
    </>
  );
}

const KEPT_BUTTON = { padding: '4px 10px', borderRadius: 6, fontSize: 13, cursor: 'pointer' } as const;

// #1442 的 kept 提示浮在画布底部 —— 它住在包住整个 Puck 的这一层（`puck` override），不进 rail 面板、不进顶栏。
// 🔴 高度写 100vh 不写 100%：Puck 在这一层外面还套了一个不定高的 `div.Puck`，100% 等于没限 ——
//    聊天记录一长就把整页撑高，Puck 被滚出视口（e2e 量过：视口 635px，页面被撑到 2368px）。
function EditorShell({ children }: { children: ReactNode }) {
  const ui = useContext(EditorUiContext);
  const shellRef = useRef<HTMLDivElement>(null);
  const at = useCanvasBox(shellRef, !!(ui && ui.kept));
  return (
    <div ref={shellRef} style={{ position: 'relative', height: '100vh', overflow: 'hidden' }}>
      {children}
      {/* #1442 —— 浮在画布底部，不进顶栏：这几句放进顶栏会把它撑成一长条竖排、画布被挤没（真机量到过）。 */}
      {ui && ui.kept && (
        <div data-editor-kept={ui.kept} role="status" style={{ position: 'absolute', left: at ? at.left + at.width / 2 : '50%', bottom: at ? at.bottom + 16 : 16, transform: 'translateX(-50%)', width: at ? `min(560px, ${Math.max(at.width - 32, 200)}px)` : 'min(560px, calc(100% - 32px))', boxSizing: 'border-box', zIndex: 10, padding: '10px 14px', borderRadius: 8, background: '#fffaeb', border: '1px solid #fedf89', color: '#93370d', fontSize: 13, lineHeight: 1.5, boxShadow: '0 4px 12px rgba(16, 24, 40, 0.12)' }}>
          {KEPT_TEXT[ui.kept]}
          <div style={{ display: 'flex', gap: 8, marginTop: 8, flexWrap: 'wrap' }}>
            {ui.kept !== 'stale' && (
              <button type="button" data-editor-keep-mine onClick={ui.keepMine} disabled={ui.status.kind === 'saving'} style={{ ...KEPT_BUTTON, border: '1px solid #b54708', background: '#fff', color: '#93370d' }}>
                Keep my changes
              </button>
            )}
            <button type="button" data-editor-reload onClick={ui.reloadLatest} style={{ ...KEPT_BUTTON, border: 0, background: '#1d4ed8', color: '#fff' }}>
              Load the latest version
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * #1449 —— 画布那块区域在外壳里的位置（left / width / 离外壳底边多远）。聊天搬进 Puck 左栏以后，按整个外壳居中的提示会
 * 压在聊天输入框和 Send 上（真机量到：提示 x=260..820，左栏到 324 为止），所以改成对着画布居中、贴画布底边。
 * 只读 Puck 的几何，不往它的 DOM 里放东西：`#puck-canvas-root` 是画布缩放层，它的父节点是控制条下面那块画布区域
 * （`@puckeditor/core` 0.23 §Canvas）。左右栏开合 / 拖宽 / 窄屏换布局都会改那块的尺寸 ⟹ ResizeObserver 跟得上。
 * 找不到（Puck 换了结构）就回 null，提示退回按整个外壳居中 —— 位置差一点，但字照样在。
 */
function useCanvasBox(shellRef: { current: HTMLDivElement | null }, on: boolean) {
  const [box, setBox] = useState<{ left: number; width: number; bottom: number } | null>(null);
  useEffect(() => {
    if (!on) return;
    const shell = shellRef.current;
    const area = document.getElementById('puck-canvas-root')?.parentElement;
    if (!shell || !area) return;
    const read = () => {
      const s = shell.getBoundingClientRect(), a = area.getBoundingClientRect();
      setBox({ left: a.left - s.left, width: a.width, bottom: s.bottom - a.bottom });
    };
    read();
    const ro = new ResizeObserver(read);
    ro.observe(area);
    ro.observe(shell);
    return () => ro.disconnect();
  }, [shellRef, on]);
  return on ? box : null;
}

// #1449 —— 聊天是 Puck 左栏 rail 上的一格（跟 Blocks / Outline 一样是个 plugin），面板就是 Blocks 清单那块地方。
// 🔴 `render` 必须是这个模块级组件、身份不变：Puck 把它当组件类型渲染（`jsx(render, {})`），换一个函数身份
//    = 整棵聊天子树卸载重挂（打到一半的字、正在跑的那一轮都丢）；而 EditorApp 每来一条聊天消息都重渲染。
//    所以要的东西全从 context 取，不走闭包。Puck 切走一格只是 `display:none`，不卸载。
function AiChatPanel() {
  const ui = useContext(EditorUiContext);
  if (!ui) return <></>;
  return (
    <EditorChat
      chat={ui.chat}
      notice={ui.chatNotice}
      pending={ui.chatPending}
      page={ui.page}
      locale={ui.locale}
      rawKey={ui.rawKey}
      onSend={ui.sendChat}
      onRevert={ui.revertChat}
    />
  );
}

// 跟 Puck 那两格同一套 lucide 线条图标的尺寸（24 / 描边 2）；仓里没有 lucide-react，手写这一个。
const AI_ICON = (
  <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M12 8V4H8" />
    <rect width="16" height="12" x="4" y="8" rx="2" />
    <path d="M2 14h2" />
    <path d="M20 14h2" />
    <path d="M15 13v2" />
    <path d="M9 13v2" />
  </svg>
);

// 🔴 必须带 `name`：Puck 只收 `name && render` 都在的那一格，缺 name 静默不出现。别撞 blocks / outline / fields / legacy-side-bar。
// Puck 的 plugins 是追加在 Blocks / Outline 之后，所以这一格排第三（票正文：不调它的上下位置）。
const AI_PLUGIN_NAME = 'ai-chat';
const EDITOR_PLUGINS = [{ name: AI_PLUGIN_NAME, label: 'AI', icon: AI_ICON, render: AiChatPanel, mobilePanelHeight: 'toggle' as const }];
// 打开编辑器默认就是 AI 这一格（不设的话 Puck 选第一格 Blocks，聊天就藏起来了）。只在 <Puck> 挂载那一次生效。
const EDITOR_UI = { plugin: { current: AI_PLUGIN_NAME } };

/**
 * #1447 —— 画布里的链接一律不导航，只选中。画布是 Puck 的内层 iframe，但组件树（含块里的 `next/link`）挂在编辑器页上
 * ⟹ 不拦的话，点顶栏的 Services 会把编辑器页自己导航走，编辑器整个没了。外链也拦（要看就发布后看）。
 * 挂在 Puck 的 `iframe` override 上：它拿到的就是画布那份 document，而且要等 iframe 就绪才渲染、`<Puck key>` 重挂时
 * 拿到新的那份 ⟹ 不用在 mount 时去 querySelector、也不用重试。
 * 🔴 只 `preventDefault()`，不许 `stopPropagation`：next/link 在自己的 onClick 里看 `defaultPrevented` 就收手
 *    （`next/dist/client/app-dir/link.js` §linkClicked 之前那一行），而 Puck 的选中还要收到这次点击。
 */
// #1657 —— 画布里点字直接改的点击层也挂在这里（同一份 document，`InlineEdit.tsx`）。
function CanvasLinkGuard({ children, document: doc }: { children: ReactNode; document?: Document }) {
  useEffect(() => {
    if (!doc) return;
    const onClick = (e: Event) => {
      const t = e.target as Element | null;
      if (t && typeof t.closest === 'function' && t.closest('a[href]')) e.preventDefault();
    };
    doc.addEventListener('click', onClick, true);
    return () => doc.removeEventListener('click', onClick, true);
  }, [doc]);
  return <>{children}{doc && <InlineEditLayer doc={doc} />}</>;
}

const EDITOR_OVERRIDES = { headerActions: EditorHeaderActions, puck: EditorShell, iframe: CanvasLinkGuard };
// #1657 —— 🔴 必须是模块级常量，不许写回 JSX 里的字面量。Puck 的画布有一个 effect（依赖里有 `iframe`）：历史里只有一条时，
//    它每跑一次就把那一条换成**当前**画布。字面量每次 EditorApp 重画都是新对象 ⟹ 那个 effect 每次都跑 ⟹ 打开后的第一笔改动
//    （画布上打字、AI 改写，都是先写进画布、停手才记历史）在记进历史之前碰上一次重画，「改之前」那一条就被换成改之后，Ctrl+Z 退不回去。
//    `node_modules/@puckeditor/core/dist/index.js` 搜 `histories.length === 1`。
const EDITOR_IFRAME = { enabled: true, syncHostStyles: true, waitForStyles: true };

/**
 * #1410 做什么 4 末尾 —— AI 在改这一页的时候画布只读：从点发送（含「先存再发」那一笔）到 AI 结束、它那份底稿已经换进来
 * （dashboard 的 `busy`，见 useEditorChat.ts §EditorChatState.busy）。锁住是让「AI 改磁盘时磁盘上就是老板看到的那份」
 * 在整个 AI 窗口里都成立、又不用合并两边页面 JSON 的唯一做法；不锁的话，这期间的手改会被 AI 那份底稿整份换掉
 * （QA2 r2 ⑥ 真机量到：画布上、磁盘上都没有，提示也没了）。
 *
 * 三段，判据各不同（PM r2 三审 §二 量过）：
 *   改字段 / 拖 / 增删块 / 复制 ⟹ Puck 的 `permissions`（全局那一份；它会在 prop 换了时重算，不用重挂 Puck）。
 *   自动存 ⟹ 锁着时不数停手的时间（§onCanvasChange）。
 *   撤销 / 前进 ⟹ 不在 `permissions` 里。按钮是 Puck 顶栏自己画的（`title="undo"` / `"redo"`），快捷键是 Puck 在编辑器
 *     页和画布 iframe 两个 document 上**冒泡阶段**收的 keydown（`monitorHotkeys(document)` / `monitorHotkeys(frameDoc)`）
 *     ⟹ 在两个 window 上挂**捕获阶段**的监听，锁着时把这两样拦下（§useAiLockGuard）。
 * 📌 两个 permissions 对象是模块级常量：Puck 按对象身份判「换了没有」（`useRegisterPermissionsSlice` 的 deps）。
 */
const OPEN_PERMISSIONS = { drag: true, duplicate: true, delete: true, edit: true, insert: true };
const LOCKED_PERMISSIONS = { drag: false, duplicate: false, delete: false, edit: false, insert: false };
const HISTORY_BUTTONS = 'button[title="undo"], button[title="redo"]';

function isHistoryKey(e: KeyboardEvent): boolean {
  if (!(e.ctrlKey || e.metaKey)) return false;
  return e.code === 'KeyZ' || e.code === 'KeyY';
}

function useAiLockGuard(locked: boolean) {
  useEffect(() => {
    if (!locked) return;
    const stop = (e: Event) => { e.preventDefault(); e.stopImmediatePropagation(); };
    const onKey = (e: KeyboardEvent) => { if (isHistoryKey(e)) stop(e); };
    const onPointer = (e: Event) => {
      const t = e.target as Element | null;
      if (t && typeof t.closest === 'function' && t.closest(HISTORY_BUTTONS)) stop(e);
    };
    const wins: Window[] = [window];
    const frame = document.querySelector('iframe#preview-frame') as HTMLIFrameElement | null;
    if (frame?.contentWindow && frame.contentWindow !== window) wins.push(frame.contentWindow);
    for (const w of wins) {
      w.addEventListener('keydown', onKey, true);
      w.addEventListener('click', onPointer, true);
      w.addEventListener('pointerdown', onPointer, true);
    }
    // 按钮看得出是灰的（`disabled` 属性归 Puck 管，React 重渲染时会写回去，所以这里只改样子）。
    const style = document.createElement('style');
    style.setAttribute('data-editor-ai-lock-style', '');
    style.textContent = `${HISTORY_BUTTONS} { opacity: 0.4; cursor: not-allowed; }`;
    document.head.appendChild(style);
    return () => {
      for (const w of wins) {
        w.removeEventListener('keydown', onKey, true);
        w.removeEventListener('click', onPointer, true);
        w.removeEventListener('pointerdown', onPointer, true);
      }
      style.remove();
    };
  }, [locked]);
}

/**
 * #1453 —— 顶栏里的存盘状态。「Saving… / All changes saved」说在 dashboard 的面板条上（它知道这一笔到底落没落盘），
 * 这里只在**没存上**时说话，并给一颗「再试一次」。`data-editor-status` 一直在（不显示也在），给验收读这一侧的状态。
 * `hideError`：画布底部那条浮条（§Kept）已经在说为什么没存、该怎么办，这里不再说第二遍。
 */
function SaveStatus({ status, onRetry, hideError }: { status: Status; onRetry: () => void; hideError: boolean }) {
  const show = status.kind === 'error' && !hideError;
  return (
    <span data-editor-status={status.kind} style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
      {show && <span style={{ fontSize: 13, color: '#b42318' }}>{status.text}</span>}
      {show && (
        <button type="button" data-editor-retry onClick={onRetry} style={{ padding: '4px 10px', borderRadius: 6, border: '1px solid #b42318', background: '#fff', color: '#b42318', fontSize: 13, cursor: 'pointer' }}>
          Try again
        </button>
      )}
    </span>
  );
}

export default function EditorApp({ site, locale, page, raw, baseHash, schema, initialData, trustedOrigin, siteBlocks, refs, slugs, pages, forms = [] }: EditorAppProps) {
  const [status, setStatus] = useState<Status>({ kind: 'idle', text: '' });
  const statusRef = useRef(status);
  statusRef.current = status;

  // #1415 —— 存盘的底。首屏是构建时烤进来的那份；dashboard 的 baseline 到了就换（见文件头）。放在 ref 里：
  // 它只在存盘那一刻被读，换它不该让整棵 Puck 重新渲染。
  const baseRef = useRef<Base>({ raw, initial: initialData, hash: baseHash, saved: raw, siteBlocks: siteBlocks || {}, sharedOwn: {} });
  // #1406 —— 「在 N 个页面上」那句话读的三样（context，见 SharedInfoContext）。
  const [sharedInfo, setSharedInfo] = useState<SharedInfo>({ siteBlocks: siteBlocks || {}, refs: refs || {}, slugs: slugs || [] });
  // #1502 —— 画布上要按页面路径算东西的块拿这一页的 slug；首页不传。当初是给 page-header 的面包屑用的（#1630 删了）。
  const config = useMemo(
    () => buildConfig(site, schema, locale, (id) => sharedRemovable(baseRef.current.siteBlocks, id), forms, page === 'home' ? undefined : page),
    [site, schema, locale, page],
  );
  // #1406 —— 老板在画布上拖过的块（Puck id）。按 `visibility` 注进来的共用块只有拖过的才写成这一页的 `{ref}`
  // （`editor-convert.js` §puckToPage 的 `moved`）。换一份新画布（open / external）时清空。
  const movedRef = useRef<Set<string>>(new Set());
  // 这一次存盘送出去的 JSON：`saved` 到了才算它进了文件（「还有没有要存的」要跟它比，不跟打开时比）。
  const sendingRef = useRef<{ json: Record<string, unknown> | null; root: Record<string, unknown> | null; shared: SharedChanges | null; forms?: FormCopyEdit | null } | null>(null);
  // #1634 —— 这个语言的表单库（存成功之后换成新的，下拉和面板读它）；面板开着的是哪一张；Done 了、还没交出去的那一笔。
  const [formList, setFormList] = useState<EditorFormChoice[]>(forms);
  const [formEditing, setFormEditing] = useState<string | null>(null);
  const pendingFormRef = useRef<FormCopyEdit | null>(null);
  const [canvas, setCanvas] = useState<{ key: number; data: PuckLikeData }>({ key: 0, data: initialData });
  const dispatchRef = useRef<PuckDispatch | null>(null);
  const getPuckRef = useRef<GetPuck | null>(null);

  // #1410 —— 聊天。`chat` 是 dashboard 递进来的整份状态（这里不存副本、不拼）。
  const [chat, setChat] = useState<EditorChatState | null>(null);
  const [chatNotice, setChatNotice] = useState<{ kind: 'info' | 'error'; text: string } | null>(null);
  // 先存再发：等存盘结果的那条消息。存成功才交给 dashboard；被拒就不发（做什么 4）。
  // `sending` = 它在等的那一笔（`sendingRef` 的那个对象）。🔴 放行只认**那一笔自己的** `saved` 底稿，不认
  // `editor-save-result {ok}`：dashboard 一笔存盘会回不止一次 ok（落盘一次、重建收尾又一次 —— §settleSaved），
  // 上一笔迟到的 ok 会把这一笔还没落盘的消息放出去（#1410 QA3 r3）。
  // `resave: true` = 点发送时上一笔还在路上：等它落定，再对着新的底重新判一次要不要存（§releaseChat）。
  const pendingChatRef = useRef<{ text: string; scope: ChatScope | null; sending: object; resave: boolean } | null>(null);
  const [chatPending, setChatPending] = useState(false);
  // 最近那次 AI 记下的那一步（Puck 历史条目的 id）+ 它有没有同时改共用块（状态栏那一句，见 §HistoryNote）。
  const [aiStep, setAiStep] = useState<{ id: string; mixed: boolean } | null>(null);
  // #1442 —— 新底稿因为画布上有没存的改动而没换进来（§Kept）。
  const [kept, setKept] = useState<Kept>(null);
  // 计时器 / message 监听里读它（它们是在更早的一次渲染里挂上的，读 state 会读到旧值）。
  const keptRef = useRef<Kept>(kept);
  keptRef.current = kept;
  // §useAiLockGuard：点了发送、还没交给 dashboard（先存那一笔在路上）也算 —— 那一笔存的是点下去那一刻的画布。
  const locked = chatPending || !!chat?.busy;
  useAiLockGuard(locked);
  // #1448 —— 换页那次握手在 message 监听里读它（监听只在 page / locale 变时重挂，读 state 会读到旧值）。
  const lockedRef = useRef(locked);
  lockedRef.current = locked;
  // #1448 —— dashboard 要换页、在等手上这一笔落盘（`sending` 同 pendingChatRef：只认那一笔自己的 `saved` 底稿）。
  const pendingLeaveRef = useRef<{ id: string; sending: object } | null>(null);
  // #1657 —— 画布上正在打的那一格（§InlineFreezeContext）；在等 AI 改写回话的那几次（id → 回话交给谁）。
  const [freeze, setFreeze] = useState<InlineFreeze>(null);
  const rewritesRef = useRef(new Map<string, (r: RewriteResult) => void>());
  const componentsByType = useMemo(() => new Map(schema.components.map((c) => [c.type, c])), [schema]);

  // #1453 —— autosave。画布每变一次（§Autosave）就重新数 AUTOSAVE_IDLE_MS；数到了存一笔（§flushAutosave）。
  // 停着的时候（AI 在改 · 浮条在问他要哪一版）不数；停的原因一解除就重新数一次（下面那个 effect）——
  // 解除时画布已经是 AI 那份 / 他选的那份，planSave 对着新的底判，不会把锁住之前的旧画布冲出去。
  const autosaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const cancelAutosave = () => {
    if (autosaveTimerRef.current) { clearTimeout(autosaveTimerRef.current); autosaveTimerRef.current = null; }
  };
  // 「这一笔现在不该发」的唯一判据（QA1 r2 / QA2 r2：它曾散在几处、各查各的，漏了 AI 锁）。autosave、换页 / 发消息前的先存、
  // 递给面板的 `paused`（§reportPending，面板的卸载兜底与面板条都据它）全读这一个。
  //   kept = 浮条在问他要哪一版（不替他选）· ai = AI 在改这一页（§useAiLockGuard）
  const holdReason = (): 'kept' | 'ai' | '' => (keptRef.current ? 'kept' : lockedRef.current ? 'ai' : '');
  const autosavePaused = () => holdReason() !== '';
  function scheduleAutosave() {
    cancelAutosave();
    if (autosavePaused()) return;
    autosaveTimerRef.current = setTimeout(() => { autosaveTimerRef.current = null; flushAutosave(); }, AUTOSAVE_IDLE_MS);
  }
  /** 马上存手上这一笔（有的话）。上一笔还在路上 ⟹ 什么都不做：它的 `saved` 底稿到了会再叫一次 §scheduleAutosave。 */
  function flushAutosave() {
    cancelAutosave();
    if (autosavePaused() || sendingRef.current) return;
    const g = getPuckRef.current ? getPuckRef.current() : null;
    if (!g) return;
    let dirty = true;
    try { dirty = planSave(g.appState.data) !== null; } catch { dirty = true; }
    if (dirty) save(g.appState.data);
  }
  // §reportPending 上一次递出去的是什么（一样就不重复递）。
  const pendingKeyRef = useRef('');
  const onCanvasChangeRef = useRef<(d: Data) => void>(() => {});
  onCanvasChangeRef.current = (d) => { if (!sendingRef.current) reportPending(d); scheduleAutosave(); };
  // 身份不变：它经 context 递给 §Autosave，换身份只会多一次无用的重订阅。
  const onCanvasChange = useMemo(() => (d: Data) => onCanvasChangeRef.current(d), []);
  useEffect(() => {
    reportPending(undefined); // 浮条出来 / 收起、上锁 / 解锁 ⟹ `paused` 变了
    if (locked || kept) { cancelAutosave(); return; }
    scheduleAutosave();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [locked, kept]);
  useEffect(() => () => cancelAutosave(), []);

  // 告诉 dashboard「编辑器起来了、我编辑的是哪一页」。它拿这条确认 iframe 里真的是编辑器。
  // `baseline: 1` 说「我认 ai1st:editor-baseline」—— dashboard 据此决定走新路（不重载 iframe）还是老路
  // （#1409 之后、#1415 之前建的站：这个键不在，dashboard 照旧在重建完重载 iframe，行为跟今天一样）。
  // #1448 —— `pages`：这个站的编辑器页清单（换页下拉）。带着它 = 我也认 `ai1st:editor-leave`（换页前先存，§releaseLeave）。
  // 不带的是 #1448 之前建的站：dashboard 那边就不出下拉。
  useEffect(() => {
    if (!trustedOrigin || window.parent === window) return;
    // #1454 —— `manualRows: 1`：这一版的聊天认得「手改记录」那种行（dashboard 据此才把它们递进来，老编辑器不认）。
    // #1456 —— `allRows: 1`：这一版的聊天认得记录里的每一种行（system 行的审计卡片 / 居中一行、theme 行），跟 dashboard 的聊天一样。
    // #1453 —— `autosave: 1`：这一版没有 Save 按钮、自己存。dashboard 据此在关编辑器前也先问一次 `editor-leave`
    // （停手计时器里那一笔还没交出去，直接卸掉 iframe 它就没了），并认 `ai1st:editor-reload`。
    window.parent.postMessage({ type: 'ai1st:editor-ready', page, locale, baseline: 1, manualRows: 1, allRows: 1, autosave: 1, ...(pages ? { pages } : {}) }, trustedOrigin);
  }, [trustedOrigin, page, locale, pages]);

  // dashboard 发来的两种消息。🔴 只认那一个 origin。
  useEffect(() => {
    if (!trustedOrigin) return;
    function onMessage(e: MessageEvent) {
      if (e.origin !== trustedOrigin) return;
      const d = e.data as {
        type?: unknown; ok?: unknown; message?: unknown; page?: unknown; locale?: unknown; reason?: unknown; hash?: unknown;
        raw?: unknown; siteBlocks?: unknown; blocks?: unknown; located?: unknown; weights?: unknown; refs?: unknown; slugs?: unknown;
        root?: unknown;
      };
      if (!d || typeof d !== 'object') return;
      if (d.type === 'ai1st:editor-save-result') {
        const text = typeof d.message === 'string' ? d.message : '';
        // #1410 —— 手上这一笔的 ok 总在它自己的 `saved` 底稿之后到（VisualEditorPanel §landed 先 sendBaseline 再 tell），
        // 那时 `sendingRef` 已经清掉。还没清就到的 ok 是上一笔迟到的那一次（重建收尾）：不许把状态栏说成「已存」、
        // 也不许让 Save 按钮在这一笔还在路上时亮起来。
        if (d.ok === true && sendingRef.current) return;
        setStatus(d.ok === true ? { kind: 'saved', text: text || 'Saved.' } : { kind: 'error', text: text || 'Could not save.' });
        // #1453 —— 这一笔被站里拒了，因为这一页在别处改过（两个标签页 / AI，exit 10；是不是这个由 dashboard 判，
        // 它去读了一次文件）。手上的 hash 是旧的，再存也是被拒 ⟹ autosave 停下，浮条说人话 + 「加载最新版本」。
        if (d.ok !== true && (d as { stale?: unknown }).stale === true) { cancelAutosave(); keptRef.current = 'stale'; setKept('stale'); }
        // #1410 —— 先存再发：它等的那一笔没存上 ⟹ 不发，把原因说出来（exit 10 那句「这一页在别处改过了，
        // 关掉编辑器重新打开」由 worker 写好，原样用）。存上了在 `saved` 底稿那一支放行（见 pendingChatRef）。
        // 🔴 只认它等的那一笔：失败只会来自 dashboard 手上在途的那一笔，而编辑器同一时刻只交出去一笔（§save）。
        const pc = pendingChatRef.current;
        if (d.ok !== true && pc && pc.sending === sendingRef.current) {
          pendingChatRef.current = null;
          setChatPending(false);
          setChatNotice({ kind: 'error', text: `Your message was not sent. ${text || 'Your changes could not be saved first.'}` });
        }
        // #1448 —— 换页在等的那一笔没存上 ⟹ 不换页，把原因交回去（dashboard 在面板条上说）。同上，只认它等的那一笔。
        const pl = pendingLeaveRef.current;
        if (d.ok !== true && pl && pl.sending === sendingRef.current) {
          pendingLeaveRef.current = null;
          // 原因（`text`）dashboard 已经在面板条的存盘状态里说了，这里不再抄一遍。
          answerLeave(pl.id, false, 'Your changes could not be saved, so the editor stayed on this page.');
        }
        // #1634 —— 没存上的那笔表单文案不留着重发（被拒的话再发一百次也是同一句）：丢掉，原因已经在状态栏，老板重新打开面板再改。
        if (d.ok !== true && sendingRef.current?.forms && pendingFormRef.current === sendingRef.current.forms) pendingFormRef.current = null;
        if (d.ok !== true) { sendingRef.current = null; reportPending(undefined); }
        return;
      }
      if (d.type === 'ai1st:editor-flush') {
        // #1453 QA2 r1 —— dashboard 那一页要被刷新 / 关掉：不等停手，现在就存（浮条在问的时候照样不替他选）。
        flushAutosave();
        return;
      }
      if (d.type === 'ai1st:editor-leave') {
        // #1448 —— dashboard 要换到别的页：先把没存的存下去，存上了（或本来就没有）才回 ok（§releaseLeave）。
        const id = (d as { id?: unknown }).id;
        if (typeof id === 'string' && id) releaseLeave(id);
        return;
      }
      if (d.type === 'ai1st:chat-state') {
        const st = (d as { state?: unknown }).state;
        if (st && typeof st === 'object') setChat(st as EditorChatState);
        return;
      }
      if (d.type === 'ai1st:ai-rewrite-result') {
        // #1657 —— 只认手上在等的那一次（id 对得上）；回来的字段逐个按形状收。
        const r = d as { id?: unknown; fields?: unknown };
        const done = typeof r.id === 'string' ? rewritesRef.current.get(r.id) : undefined;
        if (!done) return;
        rewritesRef.current.delete(r.id as string);
        if (d.ok === true && Array.isArray(r.fields)) {
          const fields = (r.fields as unknown[])
            .filter((f): f is { name: string; text: string } => !!f && typeof (f as { name?: unknown }).name === 'string' && typeof (f as { text?: unknown }).text === 'string')
            .map((f) => ({ name: f.name, text: f.text }));
          done({ ok: true, fields });
        } else {
          done({ ok: false, message: typeof d.message === 'string' && d.message ? d.message : 'The AI could not rewrite this text. Please try again.' });
        }
        return;
      }
      if (d.type === 'ai1st:chat-sent') {
        setChatPending(false);
        setChatNotice(d.ok === true ? null : { kind: 'error', text: typeof d.message === 'string' && d.message ? d.message : 'Your message was not sent.' });
        return;
      }
      if (d.type !== 'ai1st:editor-baseline') return;
      // 别的页面的底稿不许换进来（扁平站 dashboard 那头的 locale 是空的，只在两边都有时才比）。
      if (d.page !== page) return;
      if (typeof d.locale === 'string' && d.locale && d.locale !== locale) return;
      const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
      if (d.reason === 'shared') {
        // #1406 —— 存盘成功之后 dashboard 重取的那一份：只换「在 N 个页面上」要的三样和块库的底，画布与 hash 不动。
        // 🔴 `sharedOwn` 也不动：画布的字段不是按这一份取的（QA2 r1 的 F）。
        if (!isObj(d.siteBlocks)) return;
        const lib = d.siteBlocks;
        baseRef.current = { ...baseRef.current, siteBlocks: lib };
        setSharedInfo({ siteBlocks: lib, refs: isObj(d.refs) ? (d.refs as Record<string, string[]>) : {}, slugs: Array.isArray(d.slugs) ? (d.slugs as string[]) : [] });
        return;
      }
      const hashOk = typeof d.hash === 'string' && /^[0-9a-f]{64}$/.test(d.hash);
      if (d.reason === 'saved') {
        // hash 可以缺：只改外壳的那一笔（#1405）没动页面文件，baseHash 不用换。带了就必须是合形的。
        if (d.hash !== undefined && !hashOk) return;
        const b = baseRef.current;
        const sent = sendingRef.current;
        const initial = sent?.root
          ? { ...b.initial, root: { ...b.initial.root, props: { ...(b.initial.root?.props || {}), ...sent.root } } }
          : b.initial;
        const lib = sent?.shared ? applySharedChanges(b.siteBlocks, sent.shared, page) as Record<string, unknown> : b.siteBlocks;
        const sharedOwn = sent?.shared ? sharedOwnAfter({ initial: b.initial, own: b.sharedOwn, changes: sent.shared }) : b.sharedOwn;
        baseRef.current = { ...b, initial, hash: hashOk ? (d.hash as string) : b.hash, saved: sent?.json || b.saved, siteBlocks: lib, sharedOwn };
        if (sent?.shared) setSharedInfo((x) => ({ ...x, siteBlocks: lib }));
        // #1634 —— 表单文案进了 forms.json：手上的表单库跟着换（下拉和面板下次打开读的是新的），等发的那一笔清掉。
        if (sent?.forms) {
          const edit = sent.forms;
          setFormList((list) => applyFormCopyEdit(list, edit));
          if (pendingFormRef.current === edit) pendingFormRef.current = null;
        }
        sendingRef.current = null;
        // #1442 —— 画布上那份进了文件（没交页面 = 页面本来就跟文件一样），画布跟文件又是一份了。
        if (sent) setKept(null);
        // #1410 —— 聊天在等的就是这一笔：它进了文件。直接发，或（点发送时它已在路上）对着新的底重新判一次。
        const pc = pendingChatRef.current;
        if (pc && sent && pc.sending === sent) releaseChat(pc.text, pc.scope, pc.resave);
        // #1448 —— 换页在等的也是这一笔：再判一次（存的这几秒里老板可能又改了一处，那一处也要先存）。
        const pl = pendingLeaveRef.current;
        if (pl && sent && pl.sending === sent) releaseLeave(pl.id);
        // #1453 —— 这一笔在路上的时候他可能又改了几处：那几处接着数停手（没改就什么都不会发生，§flushAutosave 先问 planSave）。
        reportPending(undefined);
        if (!pc && !pl) scheduleAutosave();
        return;
      }
      if (!hashOk) return;
      if (d.reason !== 'open' && d.reason !== 'external' && d.reason !== 'ai') return;
      if (!d.raw || typeof d.raw !== 'object' || !Array.isArray(d.blocks) || !Array.isArray(d.located)) return;
      const nextRaw = d.raw as Record<string, unknown>;
      const nextLib = isObj(d.siteBlocks) ? d.siteBlocks : {};
      let next: PuckLikeData;
      try {
        next = pageToPuck({
          raw: nextRaw,
          blocks: d.blocks as never,
          located: d.located as never,
          schema,
          weights: Array.isArray(d.weights) ? (d.weights as number[]) : undefined,
          siteBlocks: nextLib,
        }) as PuckLikeData;
      } catch {
        return; // 转不出来就留着手上这一份：存盘的 hash 没换，存的时候 write-page 会说实话。
      }
      // #1405 —— `pageToPuck` 回的 root 是空的；外壳三样沿用手上的比较基准（打开时构建算出来
      // 的那份，存过就是存下去的那份）。不接上的话 root 字段全空，画布的顶栏页脚会变成默认、存盘的逐字段比较也全乱。
      // #1452 —— 刚打开（`open`）时换成底稿带来的**盘上现值**（§openRoot）：#1412 起存盘不重建，构建烤进来的那份
      // 在下一次发布前都是旧的 ⟹ 换页 / 关掉重开之后，存过的外壳改动在右栏和画布上都「不见」。
      // `external` / `ai` 不换：那两支问的是「这一页的页面块」，手上的比较基准就是这个 iframe 里存下去的那份。
      next = { ...next, root: d.reason === 'open' ? openRoot(baseRef.current.initial.root, d.root) : baseRef.current.initial.root };
      const g = getPuckRef.current ? getPuckRef.current() : null;
      // #1410 —— 历史里每一条快照的共用块换成新底稿里的那一块（它们的字不归撤销管；不换的话撤销一步，画布上
      // 共用块退回旧字，而网站上是新字）。`ai` 和 `external`（含聊天里的 git 回退）都要做。
      // setHistories 会把画布跳到最后一条 —— 老板可能正停在撤销之后的某一步，跳回原位置。
      const swapShared = (hs: PuckHistory[]) => {
        if (!g || !hs.some((h, i) => h !== g.history.histories[i])) return;
        const at = g.history.index;
        g.history.setHistories(hs.map(noIndexes));
        g.history.setHistoryIndex(Math.min(at, hs.length - 1));
      };
      // #1442 —— 画布上有没存的改动时，新底稿不许把它整份换掉（§Kept）。判据就是状态栏那一个（§planSave），
      // 🔴 要在改写 `baseRef` 之前问：改写之后问的是「画布跟新底稿一不一样」，答案恒为「不一样」。
      // 留下画布 ⟹ 底里跟画布配套的那几样（raw / initial / sharedOwn，puckToPage 靠 `_src.at` 对回 raw 的下标）一样不动；
      // 换的只有 hash 和 `saved`（文件里现在是哪一份 —— 于是按「Keep my changes」会把这一版整页交出去）
      // 和块库的底（同 `shared` 那一支）。#1453：浮条在的时候 autosave 停着（§autosavePaused），等他选。
      const unsaved = (data: Data) => { try { return planSave(data) !== null; } catch { return true; } };
      const keep = (why: 'external' | 'ai') => {
        baseRef.current = { ...baseRef.current, hash: d.hash as string, saved: nextRaw, siteBlocks: nextLib };
        setSharedInfo({ siteBlocks: nextLib, refs: isObj(d.refs) ? (d.refs as Record<string, string[]>) : {}, slugs: Array.isArray(d.slugs) ? (d.slugs as string[]) : [] });
        setKept(why);
      };
      if (d.reason === 'ai' && g && dispatchRef.current) {
        // #1410 —— AI 改完。§aiBaselineStep：这一页的页面 JSON 变了（hash 不同）⟹ 记成一步；否则只换画布（共用块）。
        const step = aiBaselineStep({
          current: g.appState.data as unknown as PuckLikeData,
          histories: g.history.histories as unknown as { state: { data: PuckLikeData } }[],
          next, hash: baseRef.current.hash, nextHash: d.hash as string,
        });
        // #1442 路 B —— 正常路径上 AI 改的时候画布锁着、发之前先存过，这里不会有没存的改动；有 ⟹ 它是 20 秒兜底解锁之后才到的。
        // 只拦「这一页的页面 JSON 变了」（record）：只动共用块的那种（含聊天里只退了共用块的回退，VisualEditorPanel §onReverted）
        // 本来就不整份换，只换那几块、手上的改动留着（§aiBaselineStep）。
        if (step.record && unsaved(g.appState.data)) { keep('ai'); return; }
        setKept(null);
        baseRef.current = { raw: nextRaw, initial: next, hash: d.hash as string, saved: nextRaw, siteBlocks: nextLib, sharedOwn: {} };
        setSharedInfo({ siteBlocks: nextLib, refs: isObj(d.refs) ? (d.refs as Record<string, string[]>) : {}, slugs: Array.isArray(d.slugs) ? (d.slugs as string[]) : [] });
        movedRef.current = new Set();
        if (step.record) {
          // 这一步由我们自己拼进历史，**不走** `setData({recordHistory: true})`：Puck 的 record 有 250ms 防抖，
          // 而 e2e ⑧ 实测那条路上 AI 之前那张快照会在防抖落下时被换成新的（历史变成 [新, 新]，撤销退不回去）。
          // `setHistories` 同步写入、把最后一条设成当前画布、位置指到它 —— 当前位置之后的「前进」照 Puck 的规矩丢掉。
          const hs = step.histories as unknown as PuckHistory[];
          const at = g.history.index;
          const { indexes: _stale, ...cur } = g.appState as unknown as Record<string, unknown>; // eslint-disable-line @typescript-eslint/no-unused-vars
          const id = `ai-${Date.now()}`;
          g.history.setHistories([...hs.slice(0, at + 1).map(noIndexes), { id, state: { ...cur, data: next as unknown as Data } }]);
          setAiStep({ id, mixed: step.mixed });
        } else {
          swapShared(step.histories as unknown as PuckHistory[]);
          dispatchRef.current({ type: 'setData', data: step.current as unknown as Data, recordHistory: false });
        }
        return;
      }
      // 「画布要不要换」：`open` 问的是「构建之后有没有人改过」，跟打开时那份比。
      // #1454 —— `external`（别处存过 / 聊天里的回退）要跟**画布此刻对着的那份文件**比（`saved`：打开时那份，存过就是
      // 存下去那份）。跟打开时比的话，撤销这个编辑器里刚存的那一笔 = 文件退回打开时那份 = 「一样」⟹ 画布停在撤掉的字上。
      const same = d.reason === 'external' ? deepEqual(nextRaw, baseRef.current.saved) : deepEqual(next, baseRef.current.initial);
      // #1442 路 A —— 别处存过这一页（含聊天里的回退）。
      if (!same && d.reason === 'external' && g && unsaved(g.appState.data)) { keep('external'); return; }
      // 画布换成新的一份时，共用块的字段就是按 nextLib 取的 ⟹ `sharedOwn` 清空；画布不动（same）就留着。
      baseRef.current = { raw: nextRaw, initial: next, hash: d.hash as string, saved: nextRaw, siteBlocks: nextLib, sharedOwn: same ? baseRef.current.sharedOwn : {} };
      setSharedInfo({ siteBlocks: nextLib, refs: isObj(d.refs) ? (d.refs as Record<string, string[]>) : {}, slugs: Array.isArray(d.slugs) ? (d.slugs as string[]) : [] });
      setKept(null);
      if (same) return; // 跟首屏一样（构建之后没人改过）：画布不动，不打断已经开始的编辑。
      movedRef.current = new Set();
      if (d.reason === 'external' && dispatchRef.current) {
        if (g) {
          const hs = aiBaselineStep({
            current: g.appState.data as unknown as PuckLikeData,
            histories: g.history.histories as unknown as { state: { data: PuckLikeData } }[],
            next, hash: '', nextHash: '',
          }).histories;
          swapShared(hs as unknown as PuckHistory[]);
        }
        dispatchRef.current({ type: 'setData', data: next as unknown as Data, recordHistory: false });
      } else {
        // open：换一个新的 Puck —— 撤销历史跟着清零（历史里那几步是对着烤进去的那份做的）。
        setCanvas((c) => ({ key: c.key + 1, data: next }));
      }
    }
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, [trustedOrigin, page, locale, schema]);

  /**
   * 这份画布要交出去的那一笔（页面 / 外壳 / 共用块）。什么都没改 ⟹ null。转不出来就抛（save 把原因说出来）。
   * #1410 —— 状态栏「有未保存的改动」和「先存再发」问的是同一个问题，所以抽出来共用一份。
   */
  function planSave(data: Data) {
    const base = baseRef.current;
    const json = puckToPage({ raw: base.raw, data: data as never, initial: base.initial, schema, slug: page, moved: movedRef.current });
    // #1406 —— 共用块改了字 / 从这一页删了（而它的 visibility 列了这一页）：写块库那几处。
    const shared: SharedChanges = puckSharedChanges({ data: data as never, initial: base.initial, siteBlocks: base.siteBlocks, schema, slug: page, own: base.sharedOwn });
    // 跟**上一次存下去的那份**比，不跟打开时比：存过一次之后把字改回原来那句，文件里是改过的那句，
    // 这一笔必须发出去（#1409 QA2 r1 第 2 条，那时靠重载 iframe 解决，#1415 起不再重载）。
    // #1405 —— 外壳三样只交**改过的**那几个字段（跟 `base.initial.root` 逐字段比，做什么 7；它是打开时的值，
    // 每存成功一次就换成刚存下去的值，道理同上）。页面块没改就不交页面：不然一次只改公告条的存盘也要带着
    // 页面底稿去比 baseHash，别处刚改过这一页时它会被无端拒掉。
    const root = puckRootChanges({ initial: base.initial, now: data as never, schema });
    const pageChanged = !deepEqual(json, base.saved);
    const hasShared = Object.keys(shared).length > 0;
    // #1634 —— 面板里 Done 了、还没交出去的表单文案：它自己就算一笔（只改表单的那一笔不带页面）。
    const forms = pendingFormRef.current;
    if (!pageChanged && Object.keys(root).length === 0 && !hasShared && !forms) return null;
    return { base, json, shared, root, pageChanged, hasShared, forms };
  }

  /**
   * 'sent' = 交给 dashboard 了（结果回 `ai1st:editor-save-result`）· 'nothing' = 没有要存的 · 'error' = 没交出去 ·
   * 'busy' = 上一笔还在路上，这一笔没交（`sendingRef` 仍是上一笔的）。
   */
  function save(data: Data): 'sent' | 'nothing' | 'error' | 'busy' {
    if (!trustedOrigin || window.parent === window) {
      setStatus({ kind: 'error', text: 'Open this editor from your dashboard to save.' });
      return 'error';
    }
    // #1410 —— 同一时刻只交出去一笔：dashboard 手上有一笔在途时会把新来的静默丢掉（VisualEditorPanel §editor-save），
    // 而 `sendingRef` 一被覆盖，上一笔的 `saved` 底稿就会把这一笔没落盘的 JSON 记成「已存」（QA3 r3）。
    // #1453 起所有调用方（autosave、先存再发、换页前先存、浮条上那颗）都经这一句。
    if (sendingRef.current) return 'busy';
    let plan: ReturnType<typeof planSave>;
    try {
      plan = planSave(data);
    } catch (e) {
      setStatus({ kind: 'error', text: `Could not save: ${(e as Error).message}` });
      return 'error';
    }
    if (!plan) {
      // #1453 —— 没有 Save 按钮了，「Nothing to save」没人要听。画布跟文件又是一份了 ⟹ 浮条要问的事也没了。
      if (keptRef.current && keptRef.current !== 'stale') setKept(null);
      return 'nothing';
    }
    const { json, shared, root, pageChanged, hasShared, forms } = plan;
    setStatus({ kind: 'saving', text: 'Saving…' });
    sendingRef.current = { json: pageChanged ? json : null, root: Object.keys(root).length ? root : null, shared: hasShared ? shared : null, forms: forms || null };
    window.parent.postMessage({ type: 'ai1st:editor-save', ...saveFields(plan) }, trustedOrigin);
    reportPending(null);
    return 'sent';
  }

  /** 一笔存盘消息的正文（`ai1st:editor-save` 与 §reportPending 递的待存那份同一个形状）。 */
  function saveFields(plan: NonNullable<ReturnType<typeof planSave>>): Record<string, unknown> {
    const { base, json, shared, root, pageChanged, hasShared, forms } = plan;
    // #1454 —— 这一笔说人话，manager 拿它写 AI chat 里那条手改记录。🔴 算不出来也照存：它只是说明，不是存盘的一部分。
    let summary = '';
    // #1634 —— 只改了表单文案的那一笔没有页面 / 外壳 / 共用块可说：describeSave 会回一句通用话，那句不要。
    if (pageChanged || Object.keys(root).length || hasShared) try {
      summary = describeSave({
        saved: base.saved, json: pageChanged ? json : null, root: Object.keys(root).length ? root : null, shared: hasShared ? shared : null,
        schema, siteBlocks: base.siteBlocks, rootLabels: ROOT_FIELD_LABELS, shapeLabel: SHAPE_FIELD_LABEL,
      });
    } catch { /* 记录退回 manager 那句通用话 */ }
    // #1634 —— 改了表单文案：说一句是哪张表单（只改了表单时它就是这一笔的全部说明）。
    if (forms) {
      const f = formList.find((x) => x.id === forms.id);
      const what = `Form "${(f && f.name) || forms.id}"`;
      summary = summary ? `${summary}; ${what}` : what;
    }
    // 不带文件路径：写哪个文件由站里的脚本按 page/locale 自己算（`write-page.js` 文件头说为什么）。
    return {
      page,
      locale,
      ...(pageChanged ? { json, baseHash: base.hash } : {}),
      ...(Object.keys(root).length ? { root } : {}),
      ...(hasShared ? { shared } : {}),
      ...(forms ? { forms } : {}),
      ...(summary ? { summary } : {}),
    };
  }

  /**
   * #1453 QA2 r1 —— 画布跟文件不一样（停手计时器在数 / 浮条在问）时告诉 dashboard，并把「现在存会发什么」一起递过去：
   *   · 面板条据 `dirty` 不再说「All changes saved」（那是上一笔的，这一刻的字还没落盘）；
   *   · 站内跳走 / 刷新时面板那一侧把 `save` 这一份直接发出去（iframe 卸掉之后编辑器就没机会了）。
   * `paused` + `why`：这一笔现在不该发 —— 跟 §autosavePaused 同一个判据（QA1 r2：只看浮条会漏掉 AI 锁）：
   *   `kept` = 浮条在问他要哪一版（不替他选）· `ai` = AI 在改这一页（上锁之前没存的字等它改完再说，§useAiLockGuard）。
   *   paused 时不带 `save`，面板那一侧就发不出去。`data` 省略 = 现在就重算（换底稿之后）；传 `null` = 刚交出去一笔、手上没有待存的。
   */
  function reportPending(data: Data | null | undefined) {
    if (!trustedOrigin || window.parent === window) return;
    let plan: ReturnType<typeof planSave> = null;
    if (data !== null) {
      const d = data ?? (getPuckRef.current ? getPuckRef.current().appState.data : null);
      try { plan = d ? planSave(d) : null; } catch { plan = null; }
    }
    const dirty = !!plan;
    const why = dirty ? holdReason() : '';
    const paused = !!why;
    const key = `${dirty}|${why}|${plan ? JSON.stringify(plan.json) + JSON.stringify(plan.root) + JSON.stringify(plan.shared) + plan.base.hash : ''}`;
    if (key === pendingKeyRef.current) return;
    pendingKeyRef.current = key;
    window.parent.postMessage({ type: 'ai1st:editor-pending', dirty, paused, ...(why ? { why } : {}), ...(plan && !paused ? { save: saveFields(plan) } : {}) }, trustedOrigin);
  }

  // #1410 —— 聊天那一侧要发给 dashboard 的两种消息。🔴 目标 origin 同存盘：只发给那一个 dashboard。
  function postChat(msg: Record<string, unknown>) {
    if (!trustedOrigin || window.parent === window) return;
    window.parent.postMessage(msg, trustedOrigin);
  }

  function sendChat(text: string, scope: ChatScope | null) {
    if (!trustedOrigin || window.parent === window) {
      setChatNotice({ kind: 'error', text: 'Open this editor from your dashboard to use the AI chat.' });
      return;
    }
    const g = getPuckRef.current ? getPuckRef.current() : null;
    if (!g) return;
    setChatNotice(null);
    setChatPending(true);
    // 上一笔存盘还在路上（按了 Save 马上发）：先等它落定。这期间画布锁着（chatPending），等到的时候画布
    // 就是点发送那一刻的样子。
    if (sendingRef.current) {
      pendingChatRef.current = { text, scope, sending: sendingRef.current, resave: true };
      setChatNotice({ kind: 'info', text: 'Saving your changes first, then sending…' });
      return;
    }
    releaseChat(text, scope, true);
  }

  /** 做什么 4：画布上有没存的改动 ⟹ 先存再发（AI 改的是磁盘，它看不见这里没存的那份）；`resave: false` = 已经存过，直接发。 */
  function releaseChat(text: string, scope: ChatScope | null, resave: boolean) {
    cancelAutosave(); // 不等停手：这一笔现在就存（或已经存过）
    // #1453 —— 浮条还在问他要哪一版：先存 = 替他选了「留下我的」。不发，请他先选。
    if (resave && keptRef.current) {
      pendingChatRef.current = null;
      setChatPending(false);
      setChatNotice({ kind: 'error', text: keptBlocksText(keptRef.current, 'message') });
      return;
    }
    const g = getPuckRef.current ? getPuckRef.current() : null;
    const r = resave && g ? save(g.appState.data) : 'nothing';
    if (r === 'nothing') {
      pendingChatRef.current = null;
      postChat({ type: 'ai1st:chat-send', text, ...(scope ? { scope } : {}) });
      return;
    }
    if (r === 'error' || r === 'busy' || !sendingRef.current) {
      pendingChatRef.current = null;
      setChatPending(false);
      setChatNotice({ kind: 'error', text: 'Your message was not sent, because your changes could not be saved first. See the message at the top of the editor.' });
      return;
    }
    pendingChatRef.current = { text, scope, sending: sendingRef.current, resave: false };
    setChatNotice({ kind: 'info', text: 'Saving your changes first, then sending…' });
  }

  // #1657 —— 画布工具条上的 AI 按钮：交给 dashboard（它带凭证打 manager），回话在 §onMessage 的 `ai1st:ai-rewrite-result`。
  //    这个页面照旧一个请求都不发。等太久就当没回来（manager 那一侧调 Claude 有自己的超时，这里只是别让按钮永远转着）。
  function rewrite(req: Parameters<InlineApi['rewrite']>[0]): Promise<RewriteResult> {
    if (!trustedOrigin || window.parent === window) {
      return Promise.resolve({ ok: false, message: 'Open this editor from your dashboard to use AI.' });
    }
    const id = `rw-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        if (rewritesRef.current.delete(id)) resolve({ ok: false, message: 'The AI did not answer in time. Please try again.' });
      }, REWRITE_WAIT_MS);
      rewritesRef.current.set(id, (r) => { clearTimeout(timer); resolve(r); });
      postChat({ type: 'ai1st:ai-rewrite', id, action: req.action, blockType: req.blockType, page, locale, fields: req.fields });
    });
  }

  // #1448 —— 换页（dashboard 面板条上的下拉）。🔴 画布上没存的改动不许被换页静默丢掉：有就先存，
  // 存上了才回 ok；存不上 / AI 正在改这一页 ⟹ 回 ok: false 和一句话，dashboard 不换页。
  // 形状同「先存再发」（§releaseChat）：交出去的那一笔落盘（它自己的 `saved` 底稿）才放行，并且放行前再判一次。
  function answerLeave(id: string, ok: boolean, message?: string) {
    postChat({ type: 'ai1st:editor-leave-result', id, ok, ...(message ? { message } : {}) });
  }
  function releaseLeave(id: string) {
    cancelAutosave(); // 不等停手：这一笔现在就存
    if (lockedRef.current) {
      pendingLeaveRef.current = null;
      answerLeave(id, false, 'The AI is editing this page. Wait for it to finish.');
      return;
    }
    const g = getPuckRef.current ? getPuckRef.current() : null;
    if (!g) { pendingLeaveRef.current = null; answerLeave(id, true); return; } // 没有画布（这个站没有编辑器认得的块）⟹ 没有可丢的
    // 上一笔还在路上：等它落定再判（它的 `saved` 底稿会再叫一次这里）。
    if (sendingRef.current) { pendingLeaveRef.current = { id, sending: sendingRef.current }; return; }
    let clean = false;
    try { clean = planSave(g.appState.data) === null; } catch { clean = false; }
    if (clean) { pendingLeaveRef.current = null; answerLeave(id, true); return; }
    // #1453 —— 浮条在问他要哪一版（同 §releaseChat）：不替他选。
    if (keptRef.current) { pendingLeaveRef.current = null; answerLeave(id, false, keptBlocksText(keptRef.current, 'leave')); return; }
    const r = save(g.appState.data);
    if (r === 'sent' && sendingRef.current) { pendingLeaveRef.current = { id, sending: sendingRef.current }; return; }
    pendingLeaveRef.current = null;
    answerLeave(id, false, 'Your changes could not be saved, so the editor stayed on this page. See the message at the top of the editor.');
  }

  // #1406 —— 记下老板拖过哪一块（Puck 的 reorder / move 带着拖之前的下标；页面只有一个根区）。
  function onAction(action: PuckAction, _next: unknown, prev: { data?: { content?: { props?: { id?: unknown } }[] } }) {
    if (action.type !== 'reorder' && action.type !== 'move') return;
    const id = prev?.data?.content?.[action.sourceIndex]?.props?.id;
    if (typeof id === 'string') movedRef.current.add(id);
  }

  let empty: ReactNode = null;
  if (schema.components.length === 0) {
    empty = (
      <div style={{ padding: 32, fontFamily: 'system-ui, sans-serif' }} data-editor-empty>
        This site has no sections the editor knows about.
      </div>
    );
  }
  if (empty) return empty;

  const ui: EditorUi = {
    locked,
    dispatchRef, getPuckRef, aiStep, kept, onCanvasChange, status,
    // 「留下我的」= 照原样存这一笔（hash 已经换成新的那份，§keep），盖掉那次改动。浮条等这一笔落盘（`saved` 底稿）才收。
    keepMine: () => { cancelAutosave(); const g = getPuckRef.current ? getPuckRef.current() : null; if (g) save(g.appState.data); },
    // 「加载最新版本」：dashboard 换一个新 iframe（跟换页一样），打开时的底稿就是文件里现在那份。画布上没存的字会没 —— 浮条上写明了。
    reloadLatest: () => { cancelAutosave(); postChat({ type: 'ai1st:editor-reload' }); },
    retrySave: () => flushAutosave(),
    chat, chatNotice, chatPending, page, locale,
    rawKey: Array.isArray((baseRef.current.raw as { sections?: unknown }).sections) && !('blocks' in baseRef.current.raw) ? 'sections' : 'blocks',
    sendChat, revertChat: (messageId) => postChat({ type: 'ai1st:chat-revert', messageId }),
  };

  const inlineApi: InlineApi = { locked, locale, page, site, components: componentsByType, setFreeze, rewrite };

  // #1634 —— 「Edit this form」面板：Done ⟹ 这一笔表单文案等着交，马上存（跟停手自动存同一条路，§flushAutosave）。
  const formsCtx = { forms: formList, editForm: (id: string) => setFormEditing(id), locked };
  const editingForm = formEditing ? formList.find((f) => f.id === formEditing) : undefined;

  return (
    <SharedInfoContext.Provider value={sharedInfo}>
    <EditorUiContext.Provider value={ui}>
    <FormsContext.Provider value={formsCtx}>
    <InlineApiContext.Provider value={inlineApi}>
    <InlineFreezeContext.Provider value={freeze}>
    <div data-editor-root style={{ height: '100vh' }}>
      <Puck
        key={canvas.key}
        config={config}
        data={canvas.data as unknown as Data}
        iframe={EDITOR_IFRAME}
        onAction={onAction as never}
        overrides={EDITOR_OVERRIDES}
        plugins={EDITOR_PLUGINS}
        ui={EDITOR_UI}
        permissions={locked ? LOCKED_PERMISSIONS : OPEN_PERMISSIONS}
        onPublish={() => { if (!locked) flushAutosave(); }}
      />
      {editingForm && (
        <FormCopyDialog
          form={editingForm}
          onCancel={() => setFormEditing(null)}
          onDone={(edit) => {
            setFormEditing(null);
            if (!edit) return;
            pendingFormRef.current = edit;
            reportPending(undefined);
            flushAutosave();
          }}
        />
      )}
    </div>
    </InlineFreezeContext.Provider>
    </InlineApiContext.Provider>
    </FormsContext.Provider>
    </EditorUiContext.Provider>
    </SharedInfoContext.Provider>
  );
}
