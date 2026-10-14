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
//
// #1660 —— 新块拖到画布那一刻就有字（`scripts/lib/block-placeholders.js` 文件头是全文）：
//   · `defaultProps` = 播种 + 按站语言的占位（§buildConfig）—— 插入那一下就带着，撤销历史只多「插入」这一步；
//   · 插入之后（§onAction 的 `insert`）把这一块 `ai: true` 的格交给 AI 按这家生意写（§startFill）：
//     发  ai1st:ai-fill-block {id, blockType, page, locale, fields: [{name, text}]}    dashboard 带凭证打改写接口 `action=fill`
//     收  ai1st:ai-fill-block-result {id, ok, fields?, message?}
//     等的时候块上一枚「AI is writing…」（§FillingContext）；回来只换**还是占位**的那几格（等的时候老板改过的不盖，同 T6），
//     记一笔撤销历史。失败：占位留着，顶栏一句话（§FillNote），不弹窗。
//
// #1693 —— 换图（「一个位置一张」的图，面板 §ImageField.tsx + 画布里点图 §InlineEdit.tsx）：选图用 dashboard 的图片库，
//   发  ai1st:pick-image {id, current, prompt?, blockType?, slot?}  dashboard 开图片库弹窗（单选；上传 / 选已有的都在它那边，带它自己的凭证）
//   收  ai1st:pick-image-result {id, ok, url?, generated?, cancelled?, message?}   选了一张 = 新地址（generated = 弹窗里生成的，#1733）；取消 = cancelled
//   同一时刻只等一次：再点一次 Change，上一次算取消。不设超时 —— 老板在弹窗里挑多久都行。
// #1711 —— 弹窗里多一颗 Generate（AI 生成一张）。`prompt` 是这里算好的默认提示词：建站那一句（`scripts/lib/slot-prompt.js`
//   §editorImagePrompt，同一个函数）+ 这块现在的标题；老板写的那句由 dashboard 接在后面，生成也是 dashboard 带凭证去打 ——
//   这个页面照旧一个请求都不发。算不出来（找不到是哪一块 / 哪个槽）就三样都不带，Generate 只用老板写的那句。
//   `blockType` / `slot` 只拿来写 Credits 那一行「哪一块」。
// #1713 —— 画布图上悬停出 ✨ Regenerate / ✎ Edit（`InlineEdit.tsx` §ImageHoverBar）。Edit = 点图（上面那条），多带一个 `title`
//   （弹窗标题 = 这个位置的名字，`Hero · Image`）。Regenerate 一键生成一张换上：
//   发  ai1st:ai-image {id, prompt, blockType?, slot?}     dashboard 带凭证打 `POST /api/sites/{id}/ai/image`（同弹窗里的 Generate）
//   收  ai1st:ai-image-result {id, ok, url?, message?}
//   等的时候画布进 AI 锁（§useAiLockGuard，同聊天）；回来换上、马上存一笔（记录 `Hero · Generate and replace image`，#1733），再开弹窗：
//   发  ai1st:pick-image {…, current: 上一张, fresh: 新图, title}   弹窗里新图打勾、上一张紧挨着，主按钮叫 Done；
//   回来的是上一张（点了它再 Done）或取消 ⟹ 换回上一张，第二笔存盘。先存后问：这一张花了钱，老板关掉页面也不白花。
//   行业不在站点文件里（`site_meta.json` 只有 siteId / leadApi / locales）：dashboard 在 `ai1st:editor-baseline` 里多带一个
//   `industry`，这里记着；没送来就省掉行业那个词（同一个函数里那一支）。

import { Children, createContext, isValidElement, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { Puck, ActionBar, AutoField, FieldLabel, createUsePuck, useGetPuck, type Config, type Data, type Field, type Fields, type PuckAction } from '@puckeditor/core';
import '@puckeditor/core/puck.css';
import SectionRenderer from '@/components/SectionRenderer';
import SiteShell, { ShellRegion, type ShellOverride } from '@/components/SiteShell';
import EditorChat, { RevertConfirm, scopeOf, type ChatScope, type EditorChatState, type Src as ChatSrc } from './EditorChat';
import type { BlockConfig } from '@/lib/types/config';
import type { EditorComponent, EditorField, EditorSchema } from '../../../scripts/lib/editor-schema';
import type { AiNote, AiNotes, PuckItemSrc, PuckLikeData, SharedChanges } from '../../../scripts/lib/editor-convert';
import type { EditorPageGroup } from '../../../scripts/lib/editor-pages';
import {
  UNKNOWN_TYPE, pageToPuck, puckToPage, fieldProps, dataFromProps, deepEqual, puckRootChanges, rootToPuck,
  sharedReach, sharedRemovable, puckSharedChanges, sharedOwnAfter, applySharedChanges, aiBaselineStep,
  THEME_DEFAULT, canvasShape, shapeOptions, describeSave, nestedPartSet, recordAiNote, aiNotesForSave, settleAiNotes,
  itemOp, recordItemNote, type ItemOp,
} from '../../../scripts/lib/editor-convert.js';
import { knobDefault, presetClickProps, presetNameFor } from '../../../scripts/lib/block-knobs.js';
import { normalizeBg, toneForBg, type BgValue } from '../../../scripts/lib/contrast.js';
import { customizeKnobNames, effectiveRegionKnobs, regionKnobChange, regionPresetName, regionPresetPick } from '../../../scripts/lib/region-options.js';
import BgPicker from '../BgPicker';
import { FormsContext, FormIdField, FormCopyDialog, applyFormCopyEdit, type EditorFormChoice, type FormCopyEdit } from './FormCopyEditor';
import { describeRef, isSourceRef, itemSourceContext, resolveItemSources } from '@/lib/sections/item-sources';
import { setAt, getAt } from '../../../scripts/lib/inline-edit.js';
import { editorImagePrompt, editorImageTarget } from '../../../scripts/lib/slot-prompt.js';
import { designAiRounds, designAiWater } from '../../../scripts/lib/design-ai-rounds.js';
import { seedProps, fillFields, pathOfName } from '../../../scripts/lib/block-placeholders.js';
import { EDITOR_LIGHT, EDITOR_LIGHT_STYLE } from './editorLight';
import { THUMB_WIDE_MARK, applyThumbMedia } from '../../../scripts/lib/thumb-media.js';
import { InlineApiContext, InlineEditLayer, InlineFreezeContext, useInlineOpen, useInlineTyping, itemListAt, itemImageOf, runItemImage, useItemImageState, clearItemImageNote, type InlineApi, type InlineFreeze, type PickImageResult, type RegenerateResult, type RewriteResult } from './InlineEdit';
import { imageField, imageRowField, imageUrlField, ImageUrlControl } from './ImageField';
import { ButtonEditor, buttonHrefField } from './ButtonLink';
import {
  navMenuToPanel, panelRows, buttonPage, moveShown, setShown, setLabel, navMenuProblem, navMenuChanges, applyPageNav, liveShellData,
  type NavPanel, type NavChange,
} from '../../../scripts/lib/nav-editor.js';
import type { SiteData } from '@/lib/types/config';
import type { IconTable } from '@/components/InlineIcon';

export interface EditorAppProps {
  /** #1665 —— 这个站的内容（编辑器页在服务端用加载器读的那份）。画布上的块、外壳、列表槽的引用展开都用它。 */
  site: SiteData;
  /** #1714 —— 页面块的内联图标表，按块类型（编辑器页在服务端用 `icons.js` §iconTableFor 算好）。画布按 `block.type` 取。 */
  iconTables?: Record<string, IconTable>;
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

/** 每个旋钮现在是哪个值（没写的按下面 #1470 那条兜底链补上）。右栏一排排旋钮和 §presetNameOf 共用。 */
function knobValues(f: EditorField, v: OptionsValue): Record<string, unknown> {
  const knobs = f.knobs || [];
  // 🔴 #1470 —— 没写的旋钮先落回 `presets[0]`（默认形态的那一组），再落回 `values[0]`：跟 `header-knobs.js`
  //    §normalizeKnobs、admin 的 `catalogKnobs.ts` 同一条兜底链。这里以前直接落 `values[0]`，只因为 hero
  //    旧的 `values[0]` 那一组恰好就是 Split 才没露馅；#1470 把 `image` 的 `none` 排到第一位之后，一块没写
  //    `options` 的 hero 侧栏会说 Text only、画布却画成 Split。
  const fallback: Record<string, unknown> = (f.presets && f.presets[0] && f.presets[0].knobs) || {};
  return Object.fromEntries(knobs.map((k) => [k.name, typeof v[k.name] === 'string' ? v[k.name]
    : k.values.includes(fallback[k.name] as string) ? fallback[k.name] : knobDefault(k)]));
}

/**
 * 亮的是哪个预设（对不上 = `custom`）。右栏那排芯片和 Design 弹层的 Layout 页（#1700）都用它，两处判据是同一份。
 * #1483 / #1487 —— 带颜色 / 部件的预设要连这一块的那几个字段一起比，所以要整块的 props（没有就只按旋钮比）。
 */
function presetNameOf(f: EditorField, v: OptionsValue, props: Record<string, unknown> | null): string {
  const extra = props ? Object.fromEntries((f.colorSlots || []).concat(Object.keys(f.partDemos || {})).map((c) => [c, props[c]])) : {};
  return presetNameFor({ slots: { options: { knobs: f.knobs || [] } }, presets: f.presets || [] }, { ...knobValues(f, v), ...extra });
}

/**
 * 预设一排 + 每个旋钮一排单选 + 布尔修饰的勾选框。点预设 = 三个旋钮一次设好；拧偏了第一排显示 Custom。
 * 判「是哪个预设」用 `block-knobs.js` §presetNameFor —— Section 渲染时算形态用的是同一个模块。
 */
function OptionsField({ f, value, onChange, readOnly }: { f: EditorField; value: OptionsValue; onChange: (v: OptionsValue) => void; readOnly?: boolean }) {
  const v = value && typeof value === 'object' ? value : {};
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
  const name = presetNameOf(f, v, selected ? (selected.props as Record<string, unknown>) : null);
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
      <KnobControls f={f} value={v} onChange={onChange} readOnly={readOnly} />
    </div>
  );
}

/**
 * 每个旋钮一排单选 + 布尔修饰的勾选框。右栏（§OptionsField）和 Design 弹层的 Customize 页（#1708）画的都是这一份 ——
 * 拧一下算出的新 `options` 只在这里算，两处只是交出去的路不同（右栏走 Puck 字段的 onChange，弹层走 §changeDesign）。
 */
function KnobControls({ f, value, onChange, readOnly }: { f: EditorField; value: OptionsValue; onChange: (v: OptionsValue) => void; readOnly?: boolean }) {
  const v = value && typeof value === 'object' ? value : {};
  const current = knobValues(f, v);
  return (
    <>
      {(f.knobs || []).map((k) => (
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
    </>
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
function subField(s: EditorField['subs'][number], site: SiteData): Field {
  if (s.imageRow) return imageRowField(s.label, s.subs || [], undefined, s.max); // #1694 —— 对象里包着的一列图（logos.items、proof.avatars），上限 = manifest 的 `listMax`
  if (s.image && s.url) return imageUrlField(s.label, !!s.optional); // #1694 —— 项里一格图片地址（点评平台的 logoUrl）
  if (s.image) return imageField(s.label, !!s.optional); // #1693 —— 项里的一张图（features 每项的 image、team 的 photo …）
  if (s.nested && s.nested.length) return nestedTextField(s.sub, s.label, s.nested, site);
  if (s.strings) return stringListField(s.label);
  if (s.sources && s.sources.length) return linkHrefField(s.label, s.sources, site);
  if (s.choices && s.choiceDefault && s.choiceDefault !== s.choices[0]) return choiceField(s.label, s.choices, s.choiceDefault);
  return s.choices
    ? ({ type: 'select', label: s.label, options: s.choices.map((c) => ({ label: c, value: c })) } as Field)
    : ({ type: 'text', label: s.label } as Field);
}

// #1670 —— 列表项里的一个对象拆成几格平铺（价格块套餐的 `price` → Price / Yearly price，editor-schema.js §itemSubs）。
//    值是整个对象，改一格之后变成什么由 editor-convert.js §nestedPartSet 定（往返守卫测的是同一个函数）。
// #1686 —— 项里的按钮 / 链接（`plans[].cta`、`items[].link`）也走这里：文字一格 + Link 一格，Link 那格带 `sources` 时
//    跟别处按钮一样能选本店电话 / 邮箱（§LinkHrefControl，写进去的引用对象经 §nestedPartSet 原样放进 `href`）。
function nestedTextField(key: string, label: string, parts: { sub: string; label: string; sources?: string[] }[], site: SiteData): Field {
  return {
    type: 'custom',
    label,
    render: ({ value, onChange, readOnly }: { value: unknown; onChange: (v: unknown) => void; readOnly?: boolean }) => {
      const obj = value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
      const set = (sub: string, v: unknown) => onChange(nestedPartSet(obj, sub, v));
      return (
        <div data-editor-nested={key}>
          {parts.map((p) => (
            <div key={p.sub} data-editor-nested-part={p.sub} style={{ marginBottom: 8 }}>
              {p.sources && p.sources.length ? (
                <LinkHrefControl label={p.label} sources={p.sources} value={obj[p.sub]} onChange={(v) => set(p.sub, v)} readOnly={readOnly} site={site} />
              ) : (
                <>
                  <FieldLabel label={p.label} el="div" readOnly={readOnly} />
                  <input type="text" value={typeof obj[p.sub] === 'string' || typeof obj[p.sub] === 'number' ? String(obj[p.sub]) : ''} readOnly={readOnly}
                    onChange={(e) => set(p.sub, e.target.value)} style={INPUT_STYLE} />
                </>
              )}
            </div>
          ))}
        </div>
      );
    },
  } as unknown as Field;
}

// #1686 —— 列表项里的一列字（价格块套餐的 `features`、features 块每项的 `bullets`）：能改、能加、能删、拖把手排序。
//    值就是那个字符串数组本身（不包成 `{value}`）—— 画布点字（InlineEdit 按 `plans.0.features.2` 写回）和存盘（项整份携带）
//    读写的都是同一份，JSON 形状不变。不是字符串的项（畸形数据）原样留着、那一格不可改。
function StringListControl({ label, value, onChange, readOnly }: { label: string; value: unknown; onChange: (v: unknown[]) => void; readOnly?: boolean }) {
  const list = Array.isArray(value) ? value : [];
  const [dragFrom, setDragFrom] = useState<number | null>(null);
  const move = (from: number, to: number) => {
    if (from === to) return;
    const next = list.slice();
    const [x] = next.splice(from, 1);
    next.splice(to, 0, x);
    onChange(next);
  };
  const small = { padding: '4px 8px', border: '1px solid #d0d5dd', borderRadius: 6, background: '#fff', cursor: 'pointer', fontSize: 13 } as const;
  return (
    <div data-editor-strings={label}>
      <FieldLabel label={label} el="div" readOnly={readOnly} />
      {list.map((v, i) => (
        <div key={i} data-editor-strings-row={i}
          onDragOver={(e) => { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; }}
          onDrop={(e) => { e.preventDefault(); if (dragFrom !== null && !readOnly) move(dragFrom, i); setDragFrom(null); }}
          style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6, opacity: dragFrom === i ? 0.5 : 1 }}>
          {/* 只有把手可拖：整行可拖的话，输入框里没法用鼠标选字（同 FormCopyEditor）。 */}
          <span data-editor-strings-handle draggable={!readOnly} aria-hidden="true" title="Drag to reorder"
            onDragStart={(e) => { setDragFrom(i); e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', String(i)); }}
            onDragEnd={() => setDragFrom(null)}
            style={{ cursor: readOnly ? 'default' : 'grab', color: '#98a2b3', padding: '0 2px', userSelect: 'none' }}>⋮⋮</span>
          <input data-editor-strings-input={i} type="text" value={typeof v === 'string' ? v : ''} readOnly={readOnly || typeof v !== 'string'}
            aria-label={`${label} ${i + 1}`}
            onChange={(e) => { const next = list.slice(); next[i] = e.target.value; onChange(next); }}
            style={{ ...INPUT_STYLE, flex: 1, minWidth: 0 }} />
          {!readOnly && (
            <button type="button" data-editor-strings-remove={i} aria-label={`Remove ${label} ${i + 1}`} title="Remove"
              onClick={() => onChange(list.filter((_, j) => j !== i))} style={small}>✕</button>
          )}
        </div>
      ))}
      {!readOnly && (
        <button type="button" data-editor-strings-add="" onClick={() => onChange([...list, ''])} style={small}>+ Add</button>
      )}
    </div>
  );
}

function stringListField(label: string): Field {
  return {
    type: 'custom',
    label,
    render: ({ value, onChange, readOnly }: { value: unknown; onChange: (v: unknown[]) => void; readOnly?: boolean }) => (
      <StringListControl label={label} value={value} onChange={onChange} readOnly={readOnly} />
    ),
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
function puckField(f: EditorField, forms: EditorFormChoice[], site: SiteData, locale: string): Field {
  switch (f.control) {
    case 'text':
      return { type: 'text', label: f.label };
    // #1693 —— 一张图（hero.image 那种）：缩略图 + Change + 图片说明，可选的带 Remove（§ImageField.tsx）。
    case 'image':
      return imageField(f.label, !!f.optional);
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
      // #1694 —— 一列图（logos.items、hero.band）：自己画（加一项要先选图，Puck 自带的「+」只会塞一个空项）。
      if (f.imageRow) return imageRowField(f.label, f.subs, f.min, f.max);
      return {
        type: 'array',
        label: f.label,
        // #1755 —— 按钮列表（`ctas` / `introCtas`）：每项展开 = 画布按钮弹窗那一套（`ButtonLink.tsx`）—— Link Type 那一排 + 那一格在前，
        //    Button label 跟在后面。列表本身（加 / 删 / 拖动 / 摘要）照旧是 Puck 的。
        arrayFields: f.button
          ? { href: buttonHrefField(site, locale), ...Object.fromEntries(f.subs.filter((s) => s.sub !== 'href').map((s) => [s.sub, s.sub === 'label' ? ({ type: 'text', label: 'Button label' } as Field) : subField(s, site)])) }
          : Object.fromEntries(f.subs.map((s) => [s.sub, subField(s, site)])),
        defaultItemProps: {},
        getItemSummary: (item: unknown, i?: number) => summaryOf(item, i, f.summary || f.subs.map((s) => s.sub)),
        // #1694 —— 条数上下限（点评平台 1–4）：Puck 到了就把加 / 删灰掉。没写就不带。
        ...(f.min !== undefined ? { min: f.min } : {}),
        ...(f.max !== undefined ? { max: f.max } : {}),
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
 * #1681 —— 画布用的站点数据：构建时那份，Business info 四样换成 Page 面板里的现值。由 root 的 render 提供（§RootShell），
 * 画布上的块从这里取 —— 存盘之后 `editor-baseline {reason: saved}` 只带 hash、不刷新站点数据，不靠它画布不会跟上。
 */
const LiveSiteContext = createContext<SiteData | null>(null);

/**
 * 画布上的一块：真站那一个组件（经 `SectionRenderer`），不是示意图。
 *
 * 数据的底是**归一化之后**那一块（`_src.view`，跟真页面同一份：列表已升格、`data-has-*` 已算好），
 * 老板改过的字段才换成新值 —— 用的是存盘时同一个合法（§dataFromProps），画布和落盘不会各说各的。
 */
/** #1660 —— 正在等 AI 写字的新块（Puck id）。放在 context 里：它变了只让画布上的块重画，不换 config。 */
const FillingContext = createContext<ReadonlySet<string>>(new Set());
/** #1714 —— 页面块的图标表（按块类型）。一张编辑器页一辈子就这一份；画布上的块和 Design 弹层的缩略图都经 §CanvasBlockBody 取。 */
const NO_ICON_TABLES: Record<string, IconTable> = {};
const IconTablesContext = createContext<Record<string, IconTable>>(NO_ICON_TABLES);

function CanvasBlock(args: { component: EditorComponent; props: ItemProps; locale: string; pageSlug?: string; site: SiteData }) {
  const filling = useContext(FillingContext).has(String(args.props.id));
  // #1660 —— 新块落下、AI 在按这家生意写：块上一枚标（不接鼠标，点它等于点这一块；块照样能选、能改）。
  // 🔴 外面那层 div 常驻，只切那枚标（r4）：等不等 AI 都是同一棵树。原来是两支 —— 等的时候多包一层、等完摘掉 ——
  //    元素类型一换 React 就把整块卸了重挂，老板正在打字的那一格连同焦点一起没了，回话之后打的字全部落空（QA3 R5）。
  return (
    <div style={{ position: 'relative' }}>
      {filling && (
        <span data-editor-ai-filling style={{ position: 'absolute', top: 8, right: 8, zIndex: 5, pointerEvents: 'none', padding: '2px 10px', borderRadius: 999, fontSize: 12, fontWeight: 600, background: '#7a5af8', color: '#fff', fontFamily: 'system-ui, sans-serif' }}>
          AI is writing…
        </span>
      )}
      <CanvasBlockBody {...args} />
    </div>
  );
}

function CanvasBlockBody({ component, props: live, locale, pageSlug, site: built }: { component: EditorComponent; props: ItemProps; locale: string; pageSlug?: string; site: SiteData }) {
  // #1681 —— Page 面板里正在改的 Business info（名字 / 电话 / 邮箱 / 地址）：画布上的块按它画（「Call …」按钮等）。
  const site = useContext(LiveSiteContext) || built;
  const iconTables = useContext(IconTablesContext);
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
  // #1714 —— 这一块的图标表按它的类型取（不按位置：块会被拖动、增删）。`SectionRenderer` 要的是与 blocks 逐项对齐的数组，这里只有一块。
  const icons = iconTables[shown.type] ? [iconTables[shown.type]] : undefined;
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
        <SectionRenderer site={site} blocks={[shown]} locale={locale} iconTables={icons} pageSlug={pageSlug} />
      </div>
    );
  }
  return <SectionRenderer site={site} blocks={[shown]} locale={locale} iconTables={icons} pageSlug={pageSlug} />;
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
    for (const f of c.fields) fields[f.slot] = puckField(f, forms, site, locale);
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
    // #1660 —— 新块拖下去就带着按站语言的占位、必填列表播 3 条（`block-placeholders.js` §seedProps；扁平老站 locale 是空串 ⟹ en）。
    //    🔴 Puck 画布渲染时会把 defaultProps 浅合并在每个块的 props 底下（`@puckeditor/core` 0.23 dist/index.js:10767）。
    //    老块的 props 来自 §fieldProps，每个字段键都写着（没值也是 undefined 占着键）⟹ 占位漏不到老块上
    //    （`scripts/editor-placeholders.test.js` 钉着）。
    //    #1766 —— 带上 `site`：拖下 reviews 块时 Google 那一条用站里来自 Google 的真实评分（没有就是示例分）。
    const defaultProps: Record<string, unknown> = { ...seedProps(c, locale, site), _shape: THEME_DEFAULT };
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

type RootProps = {
  layout?: string;
  headerShape?: string;
  footerShape?: string;
  /** #1738 —— 顶栏 / 页脚的底色 + 旋钮（`theme.json` 的 `regionOptions`，形状在 `region-options.js`）。没有右栏字段：
   *  只在 Design 面板里改（§DesignPopover 的区那一支），存盘照分派表逐字段比。 */
  headerOptions?: Record<string, unknown>;
  footerOptions?: Record<string, unknown>;
  brandName?: string;
  phone?: string;
  email?: string;
  address?: string;
  /** #1759 —— 顶栏 Content 页：logo（`brand.json`）、两颗按钮（这种语言的 `navigation.json`）、菜单（`nav-editor.js` 面板那一份）。
   *  都没有右栏字段：只在顶栏的 Design 面板 Content 页里改（§HeaderContent）。 */
  logoUrl?: string;
  headerCta?: { label: string; href: string };
  headerCtaSecondary?: { label: string; href: string };
  navMenu?: NavPanel;
  children?: ReactNode;
};

/** #1681 —— Page 面板「Business info」四样（`site/brand.json`）的字段名。存盘记录写成 `Business info · Phone`。 */
const BUSINESS_INFO_LABELS: Record<string, string> = {
  brandName: 'Website name',
  phone: 'Phone',
  email: 'Email',
  address: 'Address',
};

const BUSINESS_INFO_HEADING: Field = {
  type: 'custom',
  label: 'Business info',
  render: () => (
    <div data-editor-business-info>
      <strong style={{ fontSize: 14 }}>Business info</strong>
      <p style={{ ...NOTE_STYLE, marginTop: 4 }}>
        Shown in the header, footer and contact buttons on every page. Phone, email and address are the same in every language.
      </p>
    </div>
  ),
} as Field;

/** 构建时那份站点数据，Business info 换成面板里的现值（没带的那一样原样）。名字只换这种语言那一格。 */
function withBusinessInfo(site: SiteData, locale: string, p: RootProps): SiteData {
  const { brandName, phone, email, address } = p;
  if ([brandName, phone, email, address].every((v) => typeof v !== 'string')) return site;
  const brand = { ...site.brand };
  let regions = site.regions;
  if (typeof brandName === 'string') {
    const key = locale || site.defaultLocale;
    brand.name = { ...brand.name, [key]: brandName };
    // 顶栏 / 页脚上的名字是构建时按语言烤进 `regions.*.dataByLocale` 的（`sync-config.js` → `lib/shell-data.js`），
    // 不是渲染时从 brand 读的 ⟹ 这两份也换上（取法同 SiteShell §shellBlockData：这种语言，没有就默认语言那一份）。
    regions = { ...regions };
    for (const r of ['header', 'footer'] as const) {
      const byLocale = regions[r].dataByLocale || {};
      const cur = byLocale[key] ?? byLocale[site.defaultLocale];
      if (cur && typeof cur === 'object') regions[r] = { ...regions[r], dataByLocale: { ...byLocale, [key]: { ...cur, brandName } } };
    }
  }
  if (typeof email === 'string') brand.email = email;
  if (typeof phone === 'string' || typeof address === 'string') {
    const locations = [...(brand.locations || [])];
    const first = { ...(locations[0] || { label: '' }) };
    if (typeof phone === 'string') first.phone = phone;
    if (typeof address === 'string') first.address = address;
    locations[0] = first;
    brand.locations = locations;
  }
  return { ...site, brand, regions };
}

/**
 * #1759 —— 顶栏 Content 页的现值画到画布上：顶栏 / 页脚是构建时烤进 `regions.*.dataByLocale` 的（`lib/shell-data.js`），
 * 这里照 `nav-editor.js` §liveShellData 换上菜单（跟构建同一条规则，`lib/nav-menu.js`）、两颗按钮和 logo。没带的那一样原样。
 */
function withHeaderContent(site: SiteData, locale: string, p: Pick<RootProps, 'logoUrl' | 'headerCta' | 'headerCtaSecondary' | 'navMenu'>): SiteData {
  if (p.logoUrl === undefined && !p.headerCta && !p.headerCtaSecondary && !p.navMenu) return site;
  const key = locale || site.defaultLocale;
  const hb = site.regions.header.dataByLocale || {};
  const fb = site.regions.footer.dataByLocale || {};
  const h = hb[key] ?? hb[site.defaultLocale];
  const f = fb[key] ?? fb[site.defaultLocale];
  const live = liveShellData({ header: h as Record<string, unknown>, footer: f as Record<string, unknown> }, p, key, site.defaultLocale);
  const regions = { ...site.regions };
  if (h && typeof h === 'object') regions.header = { ...regions.header, dataByLocale: { ...hb, [key]: live.header as never } };
  if (f && typeof f === 'object') regions.footer = { ...regions.footer, dataByLocale: { ...fb, [key]: live.footer as never } };
  return {
    ...site,
    regions,
    ...(typeof p.logoUrl === 'string' ? { brand: { ...site.brand, logoUrl: p.logoUrl } } : {}),
  };
}

/** root 的画法：外壳 + 把面板里的 Business info 交给画布上的块（§LiveSiteContext）。 */
function RootShell({ site, locale, props, shell, children }: { site: SiteData; locale: string; props: RootProps; shell: ShellOverride; children?: ReactNode }) {
  const { brandName, phone, email, address, logoUrl, headerCta, headerCtaSecondary, navMenu } = props;
  const live = useMemo(
    () => withHeaderContent(withBusinessInfo(site, locale, { brandName, phone, email, address }), locale, { logoUrl, headerCta, headerCtaSecondary, navMenu }),
    [site, locale, brandName, phone, email, address, logoUrl, headerCta, headerCtaSecondary, navMenu],
  );
  return (
    <LiveSiteContext.Provider value={live}>
      <SiteShell site={live} locale={locale} shell={shell}>
        {children}
      </SiteShell>
    </LiveSiteContext.Provider>
  );
}

/**
 * #1405 —— 外壳：Puck 的 root 字段（整页一份，不在块列表里）。右栏 Page 里只剩布局一个下拉（可选值来自构建时的 schema，
 * `page-layouts/` 库）；顶栏 / 页脚的预设、底色、旋钮 #1738 起在画布上点中它们、在 Design 面板里改（§RegionBars / §DesignPopover），
 * 右栏不再有那两个下拉。
 *
 * 🔴 **这里不判「哪些组合构建不收」**：那条规则只住在站里的写盘脚本，拒了那句话原样回到状态栏（#1405 票正文做什么 6）。
 */
/** 外壳在存盘记录（§describeSave）里叫什么（#1454：老板在记录里读到的就是他点的那个东西）。#1738：顶栏 / 页脚写成 `Header · …` / `Footer · …`。 */
const ROOT_FIELD_LABELS: Record<string, string> = {
  layout: 'Page layout (whole website)',
  headerShape: 'Header · Layout',
  footerShape: 'Footer · Layout',
  headerOptions: 'Header',
  footerOptions: 'Footer',
};
/** 存盘记录（§describeSave）用的那一份：外壳三样同面板，Business info 带上组名。 */
const ROOT_SAVE_LABELS: Record<string, string> = {
  ...ROOT_FIELD_LABELS,
  ...Object.fromEntries(Object.entries(BUSINESS_INFO_LABELS).map(([k, v]) => [k, `Business info · ${v}`])),
  // #1759 —— 顶栏 Content 页（票正文做什么 5：跟页面块存盘记录同一种写法）。菜单那一句不在这里（它不是 root 字段，§saveFields 补）。
  logoUrl: 'Header · Logo',
  headerCta: 'Header · Main button',
  headerCtaSecondary: 'Header · Second button',
};
/** #1759 —— 菜单改了（别的页的 navLabel / navOrder，或这一页的那两格）时记录里那一句。 */
const NAV_SAVE_LABEL = 'Header · Navigation links';
/** #1759 —— 一页的 JSON 去掉菜单那两格（§saveFields 判「块那一半改没改」用）。 */
const withoutNav = (o: Record<string, unknown>) => { const c = { ...o }; delete c.navLabel; delete c.navOrder; return c; };

function rootConfig(schema: EditorSchema, locale: string, site: SiteData) {
  const fields: Fields = {
    // #1681 —— Business info 放在布局下拉上面（票正文做什么 6；#1738 起顶栏 / 页脚那两个下拉删了）。
    _businessInfo: BUSINESS_INFO_HEADING,
    brandName: { type: 'text', label: BUSINESS_INFO_LABELS.brandName },
    phone: { type: 'text', label: BUSINESS_INFO_LABELS.phone },
    email: { type: 'text', label: BUSINESS_INFO_LABELS.email },
    address: { type: 'text', label: BUSINESS_INFO_LABELS.address },
    layout: { type: 'select', label: ROOT_FIELD_LABELS.layout, options: schema.root.layouts.map((l) => ({ value: l.id, label: l.id })) },
  };
  const layoutOf = (id: unknown) => schema.root.layouts.find((l) => l.id === id);
  return {
    fields,
    render: ({ children, layout, headerShape, footerShape, headerOptions, footerOptions, ...rest }: RootProps) => {
      const l = layoutOf(layout) || schema.root.layouts[0];
      return (
        <RootShell
          site={site}
          locale={locale}
          props={rest}
          shell={{
            layout: { regions: l ? l.regions : ['header', 'content', 'footer'], repeatVariants: l ? l.repeatVariants : {} },
            headerShape: headerShape || '',
            footerShape: footerShape || '',
            ...(headerOptions ? { headerOptions } : {}),
            ...(footerOptions ? { footerOptions } : {}),
          }}
        >
          {children}
        </RootShell>
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
function openRoot(built: PuckLikeData['root'], sent: unknown, locale: string, nav?: unknown): PuckLikeData['root'] {
  // #1759 —— 菜单：底稿另带一格 `nav`（站里 `editor-nav.js` §navMenuOf，盘上现值），换成面板那一份。
  const navMenu = navMenuToPanel(nav, locale);
  if ((!sent || typeof sent !== 'object' || Array.isArray(sent)) && !navMenu) return built;
  const v = (sent && typeof sent === 'object' && !Array.isArray(sent) ? sent : {}) as Record<string, unknown>;
  const str = (k: string) => (typeof v[k] === 'string' ? { [k]: v[k] as string } : {});
  // #1738 —— 底色 + 旋钮是对象：只收对象（形状由站里 `region-options.js` 清洗过）。#1759：两颗按钮同（`{label, href}`，rootToPuck 再收一遍形状）。
  const obj = (k: string) => (v[k] && typeof v[k] === 'object' && !Array.isArray(v[k]) ? { [k]: v[k] as Record<string, unknown> } : {});
  const got = {
    ...str('layout'), ...str('headerShape'), ...str('footerShape'), ...obj('headerOptions'), ...obj('footerOptions'), ...str('brandName'), ...str('phone'), ...str('email'), ...str('address'),
    ...str('logoUrl'), ...obj('headerCta'), ...obj('headerCtaSecondary'), ...(navMenu ? { navMenu } : {}),
  };
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
/** #1713 —— Regenerate 等 dashboard 回话多久（它自己等 manager 45 秒，`dashboard/src/api/image.ts` §GENERATE_WAIT_MS）。 */
const REGENERATE_WAIT_MS = 60_000;
/** #1713 —— 生成没成、dashboard 也没说为什么时那一句（同弹窗里 Generate 失败那句，`ImageLibraryModal.tsx` §GENERATE_FAILED）。 */
const REGENERATE_FAILED = 'Could not generate an image. Try again or upload one.';
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
/** #1660 —— §startFill 用到的那几样（`useGetPuck()` 的返回值上都有）。 */
type FillPuck = {
  // 🔴 id 不在了它**抛**，不回 undefined（dist：`getItemById: (id) => store.state.indexes.nodes[id].data`）⟹ 只经 §fillItem 调。
  getItemById: (id: string) => { type: string; props: Record<string, unknown> };
  // 这个是真的会回 undefined（dist §getSelectorForId：`if (!node) return;`）。
  getSelectorForId: (id: string) => { index: number; zone: string } | undefined;
  dispatch: (a: { type: 'replace'; destinationIndex: number; destinationZone: string; data: unknown; recordHistory: boolean }) => void;
};
/** #1660 r4 —— 这一块还在就给它和它的位置，不在了（等 AI 时被撤销 / 删掉 / 换了底稿）回 null。先问位置再取块：反过来取一个已删的 id 当场抛（QA3 R2）。 */
function fillItem(g: FillPuck | null, id: string) {
  const sel = g ? g.getSelectorForId(id) : undefined;
  if (!g || !sel) return null;
  return { item: g.getItemById(id), sel };
}
type GetPuck = () => {
  appState: { data: Data; ui?: unknown };
  history: { histories: PuckHistory[]; index: number; setHistories: (h: PuckHistory[]) => void; setHistoryIndex: (i: number) => void; back: () => void; forward: () => void };
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
    <span data-editor-ai-lock style={{ ...NOTE_PAD, fontSize: 13, color: '#475467' }}>
      {probe}
      The AI is editing this page — you can keep editing when it&apos;s done.
    </span>
  );
  if (!sharedStays) return probe;
  return (
    <span data-editor-shared-stays style={{ ...NOTE_PAD, fontSize: 13, color: '#b54708' }}>
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
  /** `fromPanel` = 从底部面板的 AI 页发 / 撤（#1757）：面板停在 AI 页时不关（§sendChat）。左边聊天不传。 */
  sendChat: (text: string, scope: ChatScope | null, fromPanel?: boolean) => void;
  revertChat: (messageId: number, fromPanel?: boolean) => void;
  /** #1660 —— 新块的 AI 文案没写成，画布上方细条里那一句（null = 不说话；#1741 之前住在 Puck 头部）。 */
  fillNote: string | null;
  dismissFillNote: () => void;
  /** #1700 —— Design 弹层开着的那一块（Puck id；null = 没开）和它的四个动作（§openDesign 那段注释是规矩的全文）。 */
  design: string | null;
  /** #1771 —— 编辑器里有对话框开着（§anyDialogOpen）：画布上的浮动条（块的、顶栏 / 页脚的、条目条）一个都不画。 */
  dialogOpen: boolean;
  /** #1735 —— `tab` 打开停在哪一页（不给 = Layout）；`focus` = 停在 Content 页时光标放进哪个字段。这一块已经开着 ⟹ 只切页。 */
  openDesign: (id: string, tab?: DesignTab, focus?: string) => void;
  /** #1735 —— 最近一次 §openDesign 要停的那一页（`n` 每次加一：同一块开着时再要一次也认得出来）。 */
  designStart: { tab: DesignTab; focus?: string; n: number };
  /** #1757 —— 面板此刻停在哪一页（住在这里不住在面板里：AI 改这一页时那几处「关不关面板」要据它判，§designOnAi）。 */
  designTab: DesignTab;
  setDesignTab: (tab: DesignTab) => void;
  /** #1757 —— 从 AI 页发出去的那一句没发成 / 正在先存：面板里那一句话（同左边聊天的 notice，只管从面板发的）。 */
  designNotice: { kind: 'info' | 'error'; text: string } | null;
  pickDesign: (preset: string) => void;
  /** #1708 —— Customize 页改了这一块的一个字段（旋钮 / 开关整份 `options`、背景 `bg`）。undefined = 删掉这个键。 */
  changeDesign: (slot: string, value: unknown) => void;
  /** #1759 —— 顶栏 Content 页改了几样 root 值（logo / 名字 / 两颗按钮 / 菜单）：合进 root，同 §changeDesign 不记历史、跟另两页一个事务。 */
  changeHeader: (patch: Partial<RootProps>) => void;
  /** #1759 —— Done 被拦下时面板里那一句（'' = 没有）：顶栏 Content 页有不能存的值（菜单名字空、主按钮缺一样、次按钮只填一格）。 */
  designError: string;
  cancelDesign: () => void;
  doneDesign: () => void;
  /** #1741 —— 撤销 / 前进此刻能不能按（§HistoryReport 报，EditorApp 转给 dashboard 的顶栏）。 */
  reportHistory: (canUndo: boolean, canRedo: boolean) => void;
  /** #1738 —— 顶栏 / 页脚在 Design 面板里的两格（schema 的 `root.regions`）。 */
  regionDesign: EditorSchema['root']['regions'];
};
const EditorUiContext = createContext<EditorUi | null>(null);

/**
 * #1771 —— 「编辑器里有对话框开着」的唯一判据（Chris 2026-10-13：有对话框出现时浮动条都消失，同 Durable）。
 * §BlockBars / §RegionBars / §ItemBars 都只读 `ui.dialogOpen`，它由这里算；以后加新的对话框只改这一处。
 *   · Design 弹层（Layout · Customize · Content · AI）和按钮弹窗（#1755）：`design` 有值（两个都是 §DesignPopover 画的）
 *   · Edit form 对话框（#1634，§FormCopyDialog）：`formEditing` 有值 —— 右栏的 Form 字段也开它，不一定经过 Design 弹层
 *   · 换图弹窗：画在 dashboard 那一侧，编辑器这边只知道在等它回话（§pickImage 的 `picking`）
 * 不算：Revert 的确认框（`data-editor-chat-revert-confirm`）—— 画在左边聊天里或弹层自己里面，不盖画布（#1771 PM 裁定 2）。
 */
function anyDialogOpen(s: { design: string | null; formEditing: string | null; picking: boolean }): boolean {
  return !!s.design || !!s.formEditing || s.picking;
}

function EditorHeaderActions() {
  const ui = useContext(EditorUiContext);
  if (!ui) return <></>;
  return (
    <>
      <DispatchHandle handle={ui.dispatchRef} getter={ui.getPuckRef} />
      <Autosave onChange={ui.onCanvasChange} />
      <HistoryReport locked={ui.locked} report={ui.reportHistory} />
      <HistoryNote aiStep={ui.aiStep} locked={ui.locked} />
      <FillNote text={ui.fillNote} onDismiss={ui.dismissFillNote} />
      <SaveStatus status={ui.status} onRetry={ui.retrySave} hideError={!!ui.kept} />
    </>
  );
}

/**
 * #1741 —— 替掉 Puck 自己的头部（「Page」标题、两个收起侧栏的图标、撤销 / 前进 —— 这三样都不要了：撤销 / 前进在 dashboard
 * 的顶栏，§HistoryReport）。Puck 把 headerActions（上面那个组件）作为 `actions` 交进来：它们要在 Puck 的 store 之下才拿得到
 * dispatch / 历史，所以这一层还在，只是变成画布上方一条细条，**只在有话要说时有高度**（AI 在改 · 共用块撤不掉 · AI 文案没写成 ·
 * 没存上 + Try again）。🔴 没话说时是元素在、高度 0，不是不渲染：里面那两个探针（`data-editor-history` /
 * `data-editor-status`）静默态也有 spec 在读（PM #1741 裁定 ①）。挪进 dashboard 顶栏不行：那几句会把一行顶栏撑成竖排（#1442 量过）。
 * 📌 有话时每一句自己带上下内边距（§NOTE_PAD），条本身没有 padding / 边框 ⟹ 空的时候量得到 0。
 */
function EditorNotes({ actions }: { actions: ReactNode; children?: ReactNode }) {
  return (
    <div data-editor-notes="" style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', columnGap: 12, padding: '0 12px', background: '#fff' }}>
      {actions}
    </div>
  );
}
const NOTE_PAD = { padding: '6px 0' } as const;

/**
 * #1741 —— 撤销 / 前进搬到 dashboard 的顶栏之后，那两颗按钮该不该亮由这里说：每变一次就报一次 `ai1st:history-state`
 * （dashboard 据此画 / 灰掉那两颗；没收到过这条的是老编辑器，顶栏就不出这两颗 —— 它自己的头部里还有，PM 裁定 ②）。
 * AI 在改这一页 ⟹ 两颗都灰（§useAiLockGuard 的规矩；dashboard 那一侧点不到，按下来的消息这里也不认，§requestHistory）。
 */
function HistoryReport({ locked, report }: { locked: boolean; report: (canUndo: boolean, canRedo: boolean) => void }) {
  const hasPast = usePuck((s) => s.history.hasPast);
  const hasFuture = usePuck((s) => s.history.hasFuture);
  const ref = useRef(report);
  ref.current = report;
  useEffect(() => { ref.current(hasPast && !locked, hasFuture && !locked); }, [hasPast, hasFuture, locked]);
  return null;
}

/** #1660 —— 新块的 AI 文案没写成：一句话 + 关掉它的叉。占位还在块上，老板照样能改。 */
function FillNote({ text, onDismiss }: { text: string | null; onDismiss: () => void }) {
  if (!text) return null;
  return (
    <span data-editor-fill-note role="status" style={{ ...NOTE_PAD, display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 13, color: '#b42318' }}>
      {text}
      <button type="button" aria-label="Dismiss" onClick={onDismiss} style={{ border: 0, background: 'none', color: '#b42318', cursor: 'pointer', fontSize: 15, lineHeight: 1, padding: '0 2px' }}>×</button>
    </span>
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
      <style>{FIELD_MARK_CSS}</style>
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
// #1722 —— 这几笔浮动条上的 AI Edit 也用（§BLOCKBAR_ICON.ai，16px），两处是同一份。
const AI_ICON_SHAPES = (
  <>
    <path d="M12 8V4H8" />
    <rect width="16" height="12" x="4" y="8" rx="2" />
    <path d="M2 14h2" />
    <path d="M20 14h2" />
    <path d="M15 13v2" />
    <path d="M9 13v2" />
  </>
);
const AI_ICON = (
  <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    {AI_ICON_SHAPES}
  </svg>
);

// 🔴 必须带 `name`：Puck 只收 `name && render` 都在的那一格，缺 name 静默不出现。别撞 blocks / outline / fields / legacy-side-bar。
// Puck 的 plugins 是追加在 Blocks / Outline 之后，所以这一格排第三（票正文：不调它的上下位置）。
const AI_PLUGIN_NAME = 'ai-chat';
// #1742 —— 竖栏第四格 Settings：开 / 关右栏（整站设置），**不换走左边正在显示的那一格**（票正文：AI 聊天照旧）。
//   Puck 0.23 的竖栏每一格点了都是 `setUi({ plugin: { current: 这一格 }, leftSideBarVisible: true })`，没有自定义 onClick 的口子；
//   但它把每一格的面板都一直挂着、只切可见 ⟹ 这一格的面板（§SettingsRail，画空的）在 layout effect 里看见
//   `plugin.current` 变成自己，就在这一帧画出来之前把 plugin / 左栏可见性还原成点之前那样，改为翻右栏。AI 聊天不卸载。
//   打开时清掉选中：右栏显示的是整站设置（Business info、Page layout），不是某一块的字段；之后选中一块照旧显示那一块。
//   `desktopOnly`：手机布局不出这一格 —— Puck 的边界是窗口 < 638 px（`@media (min-width: 638px)`，#1750 现取；#1742 票正文写的 768 不是它）。
const SETTINGS_PLUGIN_NAME = 'site-settings';
const SETTINGS_ICON = (
  <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z" />
    <circle cx="12" cy="12" r="3" />
  </svg>
);
function SettingsRail() {
  const current = usePuck((s) => s.appState.ui.plugin?.current);
  const left = usePuck((s) => s.appState.ui.leftSideBarVisible);
  const right = usePuck((s) => s.appState.ui.rightSideBarVisible);
  const dispatch = usePuck((s) => s.dispatch);
  const before = useRef<{ plugin: string; left: boolean }>({ plugin: AI_PLUGIN_NAME, left: true });
  useLayoutEffect(() => {
    if (current !== SETTINGS_PLUGIN_NAME) {
      if (current) before.current = { plugin: current, left };
      return;
    }
    dispatch({
      type: 'setUi',
      ui: { plugin: { current: before.current.plugin }, leftSideBarVisible: before.current.left, rightSideBarVisible: !right, ...(right ? {} : { itemSelector: null }) },
    } as never);
  }, [current, left, right, dispatch]);
  return <></>;
}
const EDITOR_PLUGINS = [
  { name: AI_PLUGIN_NAME, label: 'AI', icon: AI_ICON, render: AiChatPanel, mobilePanelHeight: 'toggle' as const },
  { name: SETTINGS_PLUGIN_NAME, label: 'Settings', icon: SETTINGS_ICON, render: SettingsRail, desktopOnly: true },
];
// 打开编辑器默认就是 AI 这一格（不设的话 Puck 选第一格 Blocks，聊天就藏起来了）。只在 <Puck> 挂载那一次生效。
// #1741 —— 画布满宽、按真实宽度排版，没有尺寸 / 缩放那一行（Chris 2026-10-12：要看 iPad / 手机去 Preview 里切）。
//   只给 Puck 一个 `width: '100%'` 的 viewport：它算缩放时（`getZoomConfig`）只有 width 是数字才缩小 ⟹ zoom 恒为 1，
//   画布里网站的 innerWidth = 画布宽，响应式断点照常生效。`ui` 里写了 `viewports.current`，Puck 就跳过开机时那段
//   「按窗口宽度挑一个最接近的 viewport」；`controlsVisible: false` ⟹ 画布上方那一行（四个尺寸图标 + 缩放 + 100%）不画。
const EDITOR_VIEWPORTS = [{ width: '100%' as const, height: 'auto' as const, label: 'Full width' }];
// #1742 —— 右栏默认收起，把宽度留给画布；只是初始值，别处（§editContent 上锁时的兜底、竖栏的 Settings）照样能打开它。
const EDITOR_UI = {
  plugin: { current: AI_PLUGIN_NAME },
  rightSideBarVisible: false,
  viewports: { current: { width: '100%' as const, height: 'auto' as const }, controlsVisible: false, options: EDITOR_VIEWPORTS },
};

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
  return <>{children}{doc && <InlineEditLayer doc={doc} />}{doc && <BlockBars doc={doc} />}{doc && <RegionBars doc={doc} />}{doc && <ItemBars doc={doc} />}{doc && <DesignPopover doc={doc} />}<style>{BLOCKBAR_CSS}</style></>;
}

/**
 * #1658 —— 块自己的那条浮动条：Design · Edit content · AI Edit ｜ ↑ · ↓ · 🗑。换掉 Puck 自带那条（块名 + 复制 + 删除 + ⤴）。
 * #1710 —— 鼠标悬停就出条（点下去才是选中）；条贴块的下沿，块比画布可视区高时贴可视区的下沿。
 *   🔴 条不住在 Puck 的 overlay 里：Puck 渲染 `actionBar` 时不告诉它「是哪一块」（只给 parentAction / label / children，
 *      dist/index.js §DraggableComponent），而悬停出的条必须动它自己那一块。所以 Puck 那个口子只留一个占位（§PuckActionBarSlot，
 *      把它那条藏掉），条由 §BlockBars 画在画布 document 里（跟字的工具条、Design 弹层同一处挂载），按块 id 一块一条。
 *   出哪几条：选中的那块一条（不靠悬停）+ 悬停着的那块一条（跟选中的不是同一块时）。字的工具条开着（#1657）⟹ 选中那块不出；
 *   正在打字（光标在 contenteditable 里）⟹ 悬停的也不出。
 *   锁住的块（定位不到 / 未知类型）不出条，面板顶上那句「This section can't be edited here」照旧。#1406 共用块不算（它能改能挪）。
 */
function PuckActionBarSlot() {
  return <span hidden data-editor-blockbar-slot="" />;
}

/** 鼠标换块后等这么久才换条（扫过一列块时中间那几块不闪）。 */
const HOVER_DELAY_MS = 100;
/** 条的底边离块下沿（或画布可视区下沿）多远，画布 px。 */
const BLOCKBAR_GAP = 12;

/**
 * 画布里鼠标停在哪一块（Puck id；null = 不在任何块上）。条是块的一部分：停在某块的条上 = 停在那一块上。
 * 换块要稳住 §HOVER_DELAY_MS 才算数；中途换回原来那块就当没动过。
 * 🔴 不读 Puck 自己的 hover：那是每块一份的 `useState`，不在任何共享 store 里（dist/index.js §DraggableComponent），
 *    而且鼠标一挪到条上它就判「离开」。
 */
function useCanvasHover(doc: Document): string | null {
  return useCanvasHoverOf(doc, blockKeyAt);
}

/** 鼠标下是哪一块（Puck id）：停在某块的条上、或这块某一项的条目条上，都算在这一块上。 */
function blockKeyAt(el: Element): string | null {
  const bar = el.closest('[data-editor-blockbar-for], [data-editor-itembar-block]');
  if (bar) return bar.getAttribute('data-editor-blockbar-for') ?? bar.getAttribute('data-editor-itembar-block');
  return el.closest('[data-puck-component]')?.getAttribute('data-puck-component') ?? null;
}

/**
 * 同 §useCanvasHover 的稳法（换了要稳住 §HOVER_DELAY_MS），「停在哪儿」由 `keyAt` 说（模块级函数，不随渲染换）。
 * `byPoint`：在同一个元素上挪也要重新问（`mousemove`）—— 条目要按鼠标坐标认（§itemKeyAt），一块里从一项挪到下一项，
 * 浏览器给的 target 可能始终是块本身（不派新的 mouseover）。
 */
function useCanvasHoverOf(doc: Document, keyAt: (el: Element, x: number, y: number) => string | null, byPoint = false): string | null {
  const [hovered, setHovered] = useState<string | null>(null);
  useEffect(() => {
    let current: string | null = null;
    let pending: string | null = null;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const want = (next: string | null) => {
      if (next === pending) return;
      pending = next;
      if (timer) { clearTimeout(timer); timer = null; }
      if (next !== current) timer = setTimeout(() => { timer = null; current = next; setHovered(next); }, HOVER_DELAY_MS);
    };
    const idAt = (e: MouseEvent) => (e.target && typeof (e.target as Element).closest === 'function' ? keyAt(e.target as Element, e.clientX, e.clientY) : null);
    const onOver = (e: MouseEvent) => want(idAt(e));
    // 鼠标出了画布（relatedTarget 为空）= 不在任何块上。
    const onOut = (e: MouseEvent) => { if (!e.relatedTarget) want(null); };
    doc.addEventListener('mouseover', onOver, true);
    doc.addEventListener('mouseout', onOut, true);
    if (byPoint) doc.addEventListener('mousemove', onOver, true);
    return () => {
      if (timer) clearTimeout(timer);
      doc.removeEventListener('mouseover', onOver, true);
      doc.removeEventListener('mouseout', onOut, true);
      doc.removeEventListener('mousemove', onOver, true);
    };
  }, [doc, keyAt, byPoint]);
  return hovered;
}

type BarPos = { bottom: number; left: number; scale: number };
/**
 * 条在画布可视区里的位置：底边 = min(块下沿, 可视区下沿) − 边距，横向在块内居中；块整个不在可视区里 ⟹ null（不出条）。
 * 「可视区」= 画布 iframe 自己的 `innerHeight`（同 §DesignPopover 的 `win.innerHeight`）。每帧量一次（滚动、块变高、挪了位置都跟着走），
 * 没变不重画。
 * #1748 —— `avoid`（块的条传，顶栏 / 页脚的条不传）：条盖住这一块里某个小目标（`[data-item]`、图片格 `img[data-slot]`）的
 *   【中心点】时在块里往上挪 —— 底边挪到被盖住中心点的那几项里最上面那个的上沿 − 边距，还盖着就接着挪；挪出块上沿 / 可视区顶部
 *   就退回原位（那时靠 §itemKeyAt 按坐标认底下那一项兜底）。块比可视区高时条贴的是可视区下沿，正好压在滚进来的按钮上（azure-29 的 hero）。
 *   只擦到一角（中心点没被盖）不躲：一张卡片被划掉底下一截还剩大半能点，躲它条就会跳出几百 px。
 *   普通文字槽不躲：文字点别处还能改，躲它高块的条就找不到落脚点。中心点没被盖 ⟹ 位置一个像素不动。
 *   条的宽高按它自己画出来的读（已乘过 1/zoom，跟块里的元素同一个口径），每帧现量；条还没画出来那一帧按不压放。
 */
function useBlockBarPos(doc: Document, id: string, avoid = false): BarPos | null {
  const [pos, setPos] = useState<BarPos | null>(null);
  useLayoutEffect(() => {
    const win = doc.defaultView;
    if (!win) return;
    const measure = () => {
      const el = designTargetEl(doc, id); // #1738 —— 顶栏 / 页脚的条也用这一份（§REGION_DESIGN_ID）
      const r = el ? el.getBoundingClientRect() : null;
      const vh = win.innerHeight;
      let next: BarPos | null = null;
      if (r && r.height > 0 && r.bottom > 0 && r.top < vh) {
        const frame = win.frameElement as HTMLElement | null;
        const zoom = frame && win.innerWidth ? (frame.getBoundingClientRect().width / win.innerWidth) || 1 : 1;
        next = { bottom: vh - (Math.min(r.bottom, vh) - BLOCKBAR_GAP), left: r.left + r.width / 2, scale: 1 / zoom };
        const b = avoid && el ? doc.querySelector(`[data-editor-blockbar-for="${CSS.escape(id)}"]`)?.getBoundingClientRect() : null;
        if (el && b && b.height) {
          const targets = Array.from(el.querySelectorAll('[data-item], img[data-slot]')).map((e) => e.getBoundingClientRect()).filter((t) => t.width > 0 && t.height > 0);
          const hits = (bottom: number) => targets.filter((t) => { const cx = (t.left + t.right) / 2, cy = (t.top + t.bottom) / 2; return cx >= b.left && cx <= b.right && cy >= bottom - b.height && cy <= bottom; });
          // #1754 —— 只有提示的那种字的工具条跟块的条同时在（InlineEdit 不再为它置互斥位）：整个矩形都不许压（不只中心点），留一个 GAP。
          const hint = doc.querySelector('[data-editor-inline-hint]')?.closest('[data-editor-inline-toolbar]')?.getBoundingClientRect();
          const onHint = (bottom: number) => !!hint && hint.width > 0 && b.left < hint.right && b.right > hint.left
            && bottom - b.height < hint.bottom + BLOCKBAR_GAP && bottom > hint.top - BLOCKBAR_GAP;
          const blockers = (bottom: number) => [...hits(bottom).map((t) => t.top), ...(onHint(bottom) ? [hint!.top] : [])];
          const top = Math.max(r.top, 0);
          let bottom = vh - next.bottom;
          let hit = blockers(bottom);
          while (hit.length && bottom - b.height >= top) { bottom = Math.min(...hit) - BLOCKBAR_GAP; hit = blockers(bottom); }
          if (!hit.length && bottom - b.height >= top) next = { ...next, bottom: vh - bottom };
          // 往上让到块顶也让不开提示 ⟹ 放到提示下面（可视区里放得下的话）；条压住小目标那一种照旧留在原处（#1748）。
          else if (hint && onHint(vh - next.bottom) && hint.bottom + BLOCKBAR_GAP + b.height <= vh) next = { ...next, bottom: vh - (hint.bottom + BLOCKBAR_GAP + b.height) };
        }
      }
      setPos((p) => (p === next || (p && next && p.bottom === next.bottom && p.left === next.left && p.scale === next.scale) ? p : next));
    };
    measure();
    let raf = win.requestAnimationFrame(function tick() { measure(); raf = win.requestAnimationFrame(tick); });
    return () => win.cancelAnimationFrame(raf);
  }, [doc, id, avoid]);
  return pos;
}

function BlockBars({ doc }: { doc: Document }) {
  const selectedId = usePuck((s) => (s.selectedItem ? String((s.selectedItem.props as ItemProps).id) : null));
  const hovered = useCanvasHover(doc);
  const inlineOpen = useInlineOpen();
  const typing = useInlineTyping();
  const ui = useContext(EditorUiContext);
  // #1771 —— 有对话框开着（§anyDialogOpen）⟹ 一个条都不画；关掉之后按下面的规矩照常出。
  if (ui && ui.dialogOpen) return null;
  // 字的工具条开着 ⟹ 选中那块不出条（#1658 的互斥；#1754 起只有一句提示的那种不算 —— InlineEdit 不为它置这一位）；
  // 正在打字 ⟹ 悬停也不出条。Enter 结束打字后工具条还在，悬停照常出条。
  const ids = [inlineOpen ? null : selectedId, typing || hovered === selectedId ? null : hovered].filter((x): x is string => !!x);
  return <>{ids.map((id) => <BlockBar key={id} doc={doc} id={id} selected={id === selectedId} />)}</>;
}

/**
 * 一块的那条。每颗按钮动的都是**这一块**（`id`），不是当前选中的那块：没选中的先选中它（右栏换成它），再执行。
 */
function BlockBar({ doc, id, selected }: { doc: Document; id: string; selected: boolean }) {
  const item = usePuck((s) => s.appState.data.content.find((c) => String((c.props as ItemProps).id) === id) || null);
  const dispatch = usePuck((s) => s.dispatch);
  const getPermissions = usePuck((s) => s.getPermissions);
  const getSelectorForId = usePuck((s) => s.getSelectorForId);
  const count = usePuck((s) => s.appState.data.content.length);
  const inline = useContext(InlineApiContext);
  const ui = useContext(EditorUiContext);
  const pos = useBlockBarPos(doc, id, true);
  const props = (item?.props || {}) as ItemProps;
  const sel = item ? getSelectorForId(id) : undefined;
  if (!item || !sel || props._src?.locked || !pos) return null;
  const perm = getPermissions({ item: item as never });
  const { index, zone } = sel;
  const select = () => { if (!selected) dispatch({ type: 'setUi', ui: { itemSelector: { index, zone } } } as never); };
  // ↑ / ↓ 照 Puck 自己拖完那一下的做法（dist/index.js §moveComponent + 落下后的 setUi）：先挪、不记撤销，再把选中跟到新位置、
  //    这一下记撤销 ⟹ 一次 Ctrl+Z 退回挪之前。`move` 经 Puck 的 dispatch 走到 EditorApp §onAction，跟拖拽一样记进
  //    draggedRef（#1676：相邻两块对调要靠它才写得出 `Moved X up`）。
  const moveTo = (to: number) => {
    select();
    dispatch({ type: 'move', sourceIndex: index, sourceZone: zone, destinationIndex: to, destinationZone: zone, recordHistory: false } as never);
    dispatch({ type: 'setUi', ui: { itemSelector: { index: to, zone } }, recordHistory: true } as never);
  };
  const remove = () => { select(); dispatch({ type: 'remove', index, zone }); };
  // #1700 —— 有预设的块才有 Design（15 种页面块今天都有）。#1771 起弹层开着时条不画（§anyDialogOpen），「再点一下 = Cancel」那一支（#1725）随之撤掉。
  //   别的块的弹层开着时点这一块的 Design：先 Cancel 那一个再开这一个（§openDesign 的规矩：注意力移出弹层一律先 Cancel）。
  const hasPresets = !!inline?.components.get(item.type)?.fields.some((f) => f.control === 'options' && (f.presets || []).length);
  // #1735 —— Edit content 打开 Design 面板的 Content 页（不再开右栏），光标放进「这一块的第一个文字字段」：按谓词现算
  //   （schema 里 `kind: 'text'` 的第一个；hero 是 headline）—— PM 2026-10-11 裁定，不写块名单。这一块的面板已经开着 ⟹ 只切到
  //   Content 页，那一次打开里改过的不动；别的块的开着 ⟹ 先 Cancel 那一个（同 Design）。
  //   开不了面板（AI 正在改、上了锁；没有预设的块 —— 今天没有）⟹ 照旧开右栏，别让这一下什么都不做。
  const editContent = () => {
    const slot = inline?.components.get(item.type)?.fields.find((f) => f.kind === 'text')?.slot;
    if (ui && hasPresets && !ui.locked) {
      if (ui.design && ui.design !== id) ui.cancelDesign();
      select();
      ui.openDesign(id, 'content', slot);
      return;
    }
    select();
    dispatch({ type: 'setUi', ui: { rightSideBarVisible: true } });
    revealField(slot);
  };
  const design = () => {
    if (!ui) return;
    if (ui.design) ui.cancelDesign();
    select();
    ui.openDesign(id);
  };
  // #1757 —— AI Edit 打开面板的 AI 页（不再开左栏聊天，左栏开着就照旧开着），光标放进那一页的输入框；其余同 Edit content。
  //   上了锁（AI 正在改）这颗灰掉，同 Design（PM 裁定：§openDesign 上锁时直接 return，不灰就是一颗点了没反应的按钮）。
  //   没有预设的块（今天没有）开不了面板 ⟹ 照旧开左栏聊天。
  const aiEdit = () => {
    if (ui && hasPresets) {
      if (ui.locked) return;
      if (ui.design && ui.design !== id) ui.cancelDesign();
      select();
      ui.openDesign(id, 'ai');
      return;
    }
    select();
    dispatch({ type: 'setUi', ui: { leftSideBarVisible: true, plugin: { current: AI_PLUGIN_NAME } } } as never);
    whenFound(() => Array.from(document.querySelectorAll<HTMLTextAreaElement>('[data-editor-chat-input]:not(:disabled)')).find((el) => el.getClientRects().length > 0), (el) => el.focus());
  };
  // 🔴 点击不许冒到 Puck 的预览框（React 事件顺着组件树冒）：它见目标不是块就把选中清掉。ActionBar 自己拦了 click，这里兜住边上的空隙。
  const halt = (e: { stopPropagation: () => void }) => e.stopPropagation();
  return createPortal(
    <span data-editor-blockbar="" data-editor-blockbar-for={id} data-editor-blockbar-selected={selected ? '' : undefined} onClick={halt}
      {...EDITOR_LIGHT} style={{ ...EDITOR_LIGHT_STYLE, ...BLOCKBAR_BOX, bottom: pos.bottom, left: pos.left, transform: `scale(${pos.scale})` }}>
      <ActionBar>
        <ActionBar.Group>
          {hasPresets && (
            <ActionBar.Action label="Design" onClick={design} disabled={!ui || ui.locked} data-editor-block-action="design">
              {BLOCKBAR_ICON.design}
              <span style={BLOCKBAR_TEXT}>Design</span>
            </ActionBar.Action>
          )}
          <ActionBar.Action label="Edit content" onClick={editContent} data-editor-block-action="edit">
            {BLOCKBAR_ICON.edit}
            <span style={BLOCKBAR_TEXT}>Edit content</span>
          </ActionBar.Action>
          <ActionBar.Action label="AI Edit" onClick={aiEdit} disabled={!ui || ui.locked} data-editor-block-action="ai">
            {BLOCKBAR_ICON.ai}
            <span style={BLOCKBAR_TEXT}>AI Edit</span>
          </ActionBar.Action>
        </ActionBar.Group>
        <ActionBar.Group>
          <ActionBar.Action label="Move up" disabled={!perm.drag || index <= 0} onClick={() => moveTo(index - 1)} data-editor-block-action="up">
            {BLOCKBAR_ICON.up}
          </ActionBar.Action>
          <ActionBar.Action label="Move down" disabled={!perm.drag || index >= count - 1} onClick={() => moveTo(index + 1)} data-editor-block-action="down">
            {BLOCKBAR_ICON.down}
          </ActionBar.Action>
          <ActionBar.Action label="Delete" disabled={!perm.delete} onClick={remove} data-editor-block-action="delete">
            {BLOCKBAR_ICON.trash}
          </ActionBar.Action>
        </ActionBar.Group>
      </ActionBar>
    </span>,
    doc.body,
  );
}

/**
 * #1738 —— 顶栏 / 页脚的条：画布上鼠标停在它们上面、或点中了它们，出跟块同一种条，按钮只有 Design · AI Edit（外壳不能挪也不能删；
 * Edit content 归 B 票 —— #1759 给顶栏加上了：Design · Edit content · AI Edit，页脚照旧两颗）。它们不是 Puck 的块 ⟹ 不经过 Puck 的选中：「点中」是这里自己记的（画布里按下鼠标落在它上面 = 点中，
 * 落在别处 = 放开）。有对话框开着时一个都不出（#1771，§anyDialogOpen —— 面板开着的那一个也不出，推翻 #1738 的「一直出条」）。
 * 正在打字（同 #1710）时悬停不出条（顶栏 / 页脚里的字今天不能直接点着改，没有字工具条那一层互斥）。
 */
function regionKeyAt(el: Element): string | null {
  const bar = el.closest('[data-editor-regionbar-for]');
  if (bar) return bar.getAttribute('data-editor-regionbar-for');
  if (el.closest('[data-editor-popover], [data-editor-blockbar], [data-editor-itembar-block]')) return null;
  const r = el.closest('[data-block="header"], [data-block="footer"]');
  return r ? r.getAttribute('data-block') : null;
}

function RegionBars({ doc }: { doc: Document }) {
  const ui = useContext(EditorUiContext);
  const hovered = useCanvasHoverOf(doc, regionKeyAt);
  const typing = useInlineTyping();
  const [picked, setPicked] = useState<string | null>(null);
  useEffect(() => {
    const onDown = (e: Event) => {
      const t = e.target;
      setPicked(t && typeof (t as Element).closest === 'function' ? regionKeyAt(t as Element) : null);
    };
    doc.addEventListener('pointerdown', onDown, true);
    return () => doc.removeEventListener('pointerdown', onDown, true);
  }, [doc]);
  if (ui && ui.dialogOpen) return null;
  const shown = (['header', 'footer'] as const).filter((r) => r === picked || (!typing && r === hovered));
  return <>{shown.map((r) => <RegionBar key={r} doc={doc} region={r} />)}</>;
}

function RegionBar({ doc, region }: { doc: Document; region: Region }) {
  const dispatch = usePuck((s) => s.dispatch);
  const ui = useContext(EditorUiContext);
  const id = REGION_DESIGN_ID[region];
  const pos = useBlockBarPos(doc, id);
  if (!pos || !ui) return null;
  const design = () => {
    if (ui.design) ui.cancelDesign();
    ui.openDesign(id);
  };
  // #1759 —— 顶栏的 Edit content：打开同一个面板、停在 Content 页（同块的 Edit content）。已经开着 ⟹ 只切页。页脚没有（正文「不做」）。
  const editContent = () => {
    if (ui.design && ui.design !== id) ui.cancelDesign();
    ui.openDesign(id, 'content');
  };
  // 同块的 AI Edit（§BlockBar）：开左栏的 AI 聊天、光标放进输入框。
  const aiEdit = () => {
    dispatch({ type: 'setUi', ui: { leftSideBarVisible: true, plugin: { current: AI_PLUGIN_NAME } } } as never);
    whenFound(() => Array.from(document.querySelectorAll<HTMLTextAreaElement>('[data-editor-chat-input]:not(:disabled)')).find((el) => el.getClientRects().length > 0), (el) => el.focus());
  };
  const halt = (e: { stopPropagation: () => void }) => e.stopPropagation();
  return createPortal(
    <span data-editor-blockbar="" data-editor-regionbar-for={region} onClick={halt}
      {...EDITOR_LIGHT} style={{ ...EDITOR_LIGHT_STYLE, ...BLOCKBAR_BOX, bottom: pos.bottom, left: pos.left, transform: `scale(${pos.scale})` }}>
      <ActionBar>
        <ActionBar.Group>
          <ActionBar.Action label="Design" onClick={design} disabled={ui.locked} data-editor-block-action="design">
            {BLOCKBAR_ICON.design}
            <span style={BLOCKBAR_TEXT}>Design</span>
          </ActionBar.Action>
          {region === 'header' && (
            <ActionBar.Action label="Edit content" onClick={editContent} disabled={ui.locked} data-editor-block-action="edit">
              {BLOCKBAR_ICON.edit}
              <span style={BLOCKBAR_TEXT}>Edit content</span>
            </ActionBar.Action>
          )}
          <ActionBar.Action label="AI Edit" onClick={aiEdit} data-editor-block-action="ai">
            {BLOCKBAR_ICON.ai}
            <span style={BLOCKBAR_TEXT}>AI Edit</span>
          </ActionBar.Action>
        </ActionBar.Group>
      </ActionBar>
    </span>,
    doc.body,
  );
}

/**
 * #1723 —— 条目条：画布里的一项（块的 Section.tsx 挂的 `data-item="stats.2"`）鼠标移上去，它右上角出 ↑ · ↓ · 🗑。
 * 悬停的稳法同块的条（§useCanvasHoverOf，换项稳 100 ms）；停在条目条上 = 停在那一项上，也算停在那一块上（块的条不收，§blockKeyAt）。
 * 不出：正在打字（同 #1710）· 有对话框开着（§anyDialogOpen；Design 弹层里试看的那一份也不是存下去的数据）· 锁住的块（`_src.locked`）·
 *   这一项对不上 schema 里的一列（§itemListsOf）· 那一列不是数组（引用写法 `{source}`，面板上那一栏也是只读）。
 * 三颗按钮动的是 Puck 那个数组字段（同右栏，经 Puck 的 `replace`）⟹ 右栏当场同步、Ctrl+Z 照旧；🗑 到 schema 的 `min` 灰掉，
 * 跟右栏同一个数。每按一下另记一条侧记（§recordItemNote）：记录摘要比的是前后两份 JSON，分不出「挪了一项」和「删一项加一项」。
 * #1755 r3 —— 按钮列表（schema 的 `button`，`editor-schema.js` 按形状派生）的一项多一组 ✎ Edit，排在 ↑ ↓ 🗑 左边、隔一道竖线（长相同 §BlockBar）：
 *   点它 = 点按钮本身（InlineEdit §onClick → `openButton`），开同一个按钮弹窗、定位到这一颗。锁着时跟另外三颗一起灰。
 */
function ItemBars({ doc }: { doc: Document }) {
  const hovered = useCanvasHoverOf(doc, itemKeyAt, true);
  const typing = useInlineTyping();
  const ui = useContext(EditorUiContext);
  // #1760 —— 条上那张图在等生成：那一项的条一直留着（鼠标移开也留着，同原来图上那层）；生成没成那一句，鼠标换了一项就收起。
  const img = useItemImageState();
  useEffect(() => { if (img.note && img.note.item !== hovered) clearItemImageNote(); }, [hovered, img.note]);
  if (typing || (ui && ui.dialogOpen)) return null;
  const keys = [hovered, img.regen].filter((k, i, all): k is string => !!k && all.indexOf(k) === i);
  return <>{keys.map((k) => {
    const cut = k.lastIndexOf(' ');
    return <ItemBar key={k} doc={doc} id={k.slice(0, cut)} item={k.slice(cut + 1)} />;
  })}</>;
}

/**
 * 鼠标下是哪一项：`<块的 Puck id> <data-item>`。只认真块里的（Design 弹层的缩略图不在 `[data-puck-component]` 里）。
 * 🔴 按坐标认，不按 target 往上找：Puck 画布里块的子元素收不到鼠标（没选中的块，鼠标事件的 target 就是块本身；
 *    能点的字是 InlineEdit 一段一段登记成 overlay portal 才收得到）⟹ `target.closest('[data-item]')` 读空。
 *    取这一块里框住鼠标的 `[data-item]`，几个都框住时取面积最小的（最里面那一项）。
 * #1744 —— 图上那层 ✎ Edit 按钮（InlineEdit §imageBar）portal 在 body 上、贴在图正中，不在任何块里：小 logo（56 px 宽）
 *    整格都被它盖住，鼠标落在按钮上就读空、条目条永远不出。停在按钮上 = 停在那张图上 ⟹ 按坐标找它底下那一块。
 *    #1760 起列表里一项一张图的并进了条目条，图上那层不出；这一支照旧有人走：不在列表里的单张图（hero 主图这种）图上那层照旧出；一项两张以上的图也不并（今天没有这种块）；它还跟块的条共用这一个条件（PM 裁定 1）。
 * #1748 —— 块的条（同样 portal 在 body 上）也一样：它压着某一项时，停在条上 = 按坐标认它底下那一项。条自己的按钮照旧点得到。
 */
function itemKeyAt(el: Element, x: number, y: number): string | null {
  const bar = el.closest('[data-editor-itembar-for]');
  if (bar) return bar.getAttribute('data-editor-itembar-for');
  const under = el.closest('[data-editor-image-actions], [data-editor-blockbar-for]') ? el.ownerDocument.elementsFromPoint(x, y).find((e) => e.closest('[data-puck-component]')) : el;
  const comp = under?.closest('[data-puck-component]');
  const id = comp?.getAttribute('data-puck-component');
  if (!comp || !id) return null;
  let best: { item: string; area: number } | null = null;
  for (const it of Array.from(comp.querySelectorAll('[data-item]'))) {
    const r = it.getBoundingClientRect();
    if (!r.width || !r.height || x < r.left || x > r.right || y < r.top || y > r.bottom) continue;
    const area = r.width * r.height;
    if (!best || area < best.area) best = { item: it.getAttribute('data-item') || '', area };
  }
  return best ? `${id} ${best.item}` : null;
}

/** 条目条离那一项右上角多远，画布 px。 */
const ITEMBAR_GAP = 6;
type ItemBarPos = { top: number; left: number; scale: number; above: boolean; below: boolean };
/**
 * #1760 —— 并了图的条（§ItemBar 上有 ✎ Edit）比原来宽：项比条宽、条留在项里贴右上角时，可能正好压在这一项的小图上
 *   （QA2 r1：azure-29 的 logo 格子 166 宽、左边一张 32 的 logo，条 155 宽 ⟹ 6 个 logo 全被盖住）。
 *   判据：条贴在项里的那个位置跟这张图相交，而且图比条窄（logo、头像这种小图 —— 盖上就看不见了）⟹ 当成窄项，挪到项外面。
 *   大照片（team / gallery）比条宽，条只压一个角，位置照旧（正文做什么 3「比条宽的项位置不变」）。
 */
function coversItemImage(bar: Element, box: Element, b: DOMRect, top: number, right: number): boolean {
  if (!bar.querySelector('[data-editor-image-edit]')) return false;
  const img = Array.from(box.querySelectorAll('img[data-editor-inline]')).find((e) => e.closest('[data-item]') === box);
  if (!img) return false;
  const i = img.getBoundingClientRect();
  if (i.width <= 0 || i.height <= 0 || i.width >= b.width) return false;
  return i.left < right && i.right > right - b.width && i.top < top + b.height && i.bottom > top;
}

/**
 * 那一项右上角（项的上沿出了可视区就贴可视区上沿）；项看不见 ⟹ null。每帧量，同 §useBlockBarPos。
 * `above` / `below`：这一块里同一列还有没有【画出来的】、下标比它小 / 大的项。块可能只画前几项（hero 写死 stats 3 · ctas 2，
 *   `blocks/hero/Section.tsx` §MAX）⟹ 画布上最后一项的 ↓ 按数据算还能换，换完它从画布上消失、冒出一个没见过的 ——
 *   条目条是画布上的操作，↑ 灰 = 画出来的第一项、↓ 灰 = 画出来的最后一项（#1723 PM 裁 B）。看不见的几项照旧在右栏动。
 *   ↑ 那一侧也要看画布：块会先 filter 掉空项（hero stats 没字的那格），数据第 0 项被滤掉时画出来的第一项是 stats.1。
 *   「画出来」= 在 DOM 里（轮播没露出来的那几张也算，翻过去看得到），不看可见性。
 * #1744 —— 项比条还窄（logo、头像那种小图）：条贴在项里就把整格盖住 —— 图上的 ✎ Edit 收起、点图正中落在 🗑 上。
 *   这时条挪到项的外面：上方（右沿对齐、底边 = 项上沿 − 间距）→ 放不下就下方 → 都放不下才退回贴在项里。
 *   宽窄按条自己画出来的宽度比（已乘过 1/zoom，跟项同一个口径），每帧现量；条还没画出来那一帧按宽项放。宽项位置照旧。
 * #1755 r3 —— 条上有这一项的按钮 ✎ Edit（§ItemBar）⟹ 这一项整个就是一颗按钮、字铺满整颗：条贴在里面就一定压字（Chris 截图「Ca|」），
 *   不论按钮比条宽还是窄（量过：hero `Book a service` 171 px、features 第二颗 196 px，都比加了 Edit 的条宽）⟹ 一律走上面「窄项」那一支。
 */
function useItemBarPos(doc: Document, id: string, item: string): ItemBarPos | null {
  const [pos, setPos] = useState<ItemBarPos | null>(null);
  useLayoutEffect(() => {
    const win = doc.defaultView;
    if (!win) return;
    const measure = () => {
      const comp = doc.querySelector(`[data-puck-component="${CSS.escape(id)}"]`);
      const els = comp ? Array.from(comp.querySelectorAll(`[data-item="${CSS.escape(item)}"]`)) : [];
      const box = els.find((e) => { const x = e.getBoundingClientRect(); return x.width > 0 && x.height > 0; });
      const r = box ? box.getBoundingClientRect() : undefined;
      const cut = item.lastIndexOf('.');
      const head = item.slice(0, cut + 1);
      const at = Number(item.slice(cut + 1));
      const drawn = comp ? Array.from(comp.querySelectorAll('[data-item]')).flatMap((e) => {
        const v = e.getAttribute('data-item') || '';
        return v.startsWith(head) && /^\d+$/.test(v.slice(head.length)) ? [Number(v.slice(head.length))] : [];
      }) : [];
      const above = drawn.some((n) => n < at);
      const below = drawn.some((n) => n > at);
      const vh = win.innerHeight;
      let next: ItemBarPos | null = null;
      if (r && r.bottom > 0 && r.top < vh) {
        const frame = win.frameElement as HTMLElement | null;
        const zoom = frame && win.innerWidth ? (frame.getBoundingClientRect().width / win.innerWidth) || 1 : 1;
        next = { top: Math.max(r.top, 0) + ITEMBAR_GAP, left: r.right - ITEMBAR_GAP, scale: 1 / zoom, above, below };
        const bar = doc.querySelector(`[data-editor-itembar-for="${CSS.escape(`${id} ${item}`)}"]`);
        const b = bar?.getBoundingClientRect();
        if (b && (b.width > r.width || !!bar?.querySelector('[data-editor-item-action="edit"]') || (bar && box && coversItemImage(bar, box, b, next.top, next.left)))) {
          const up = r.top - ITEMBAR_GAP - b.height;
          const down = r.bottom + ITEMBAR_GAP;
          if (up >= 0) next = { ...next, top: up, left: r.right };
          else if (down + b.height <= vh) next = { ...next, top: down, left: r.right };
        }
      }
      setPos((p) => (p === next || (p && next && p.top === next.top && p.left === next.left && p.scale === next.scale && p.above === next.above && p.below === next.below) ? p : next));
    };
    measure();
    let raf = win.requestAnimationFrame(function tick() { measure(); raf = win.requestAnimationFrame(tick); });
    return () => win.cancelAnimationFrame(raf);
  }, [doc, id, item]);
  return pos;
}

/**
 * #1760 —— 这一项里恰好一张能换的图（InlineEdit §itemImageOf）：图的按钮并进来，`✨ Regenerate · ✎ Edit ｜ ↑ · ↓ · 🗑`，图上那层不出。
 *   ✨ 只给能重新生成的图（schema 的 `regenerate`，同原来图上那层）。两颗做的事经 InlineEdit §runItemImage，跟原来图上那两颗同一条路；
 *   在等生成 ⟹ ✨ 转圈、条一直留着（§ItemBars）；生成没成那一句挂在条下面。
 */
function ItemBar({ doc, id, item: itemAttr }: { doc: Document; id: string; item: string }) {
  const item = usePuck((s) => s.appState.data.content.find((c) => String((c.props as ItemProps).id) === id) || null);
  const selectedId = usePuck((s) => (s.selectedItem ? String((s.selectedItem.props as ItemProps).id) : null));
  const getPuck = useGetPuck();
  const inline = useContext(InlineApiContext);
  const imgState = useItemImageState();
  const pos = useItemBarPos(doc, id, itemAttr);
  const component = item ? inline?.components.get(item.type) : undefined;
  const at = item ? itemListAt(component, item.props as ItemProps, itemAttr) : null;
  if (!item || !at || !pos) return null;
  const { spec, list, index } = at;
  const key = `${id} ${itemAttr}`;
  const comp = doc.querySelector(`[data-puck-component="${CSS.escape(id)}"]`);
  const img = comp && component ? itemImageOf(comp, component, itemAttr) : null;
  const waiting = imgState.regen === key;
  const note = imgState.note && imgState.note.item === key ? imgState.note.text : '';
  // #1755 r3 —— 按钮列表那一列（schema 的 `button`）⟹ 多一颗 ✎ Edit。
  const button = !!component?.fields.find((f) => f.control === 'list' && f.slot === spec.slot)?.button;
  // AI 聊天在改这一页（生成图也上这把锁）：整条都灰（同面板 LOCKED_PERMISSIONS 那一套，改了也会被 AI 那一笔盖掉）。
  const busy = !!inline?.locked;
  const selectIt = () => {
    const g = getPuck();
    const sel = g.getSelectorForId(id);
    if (sel && selectedId !== id) g.dispatch({ type: 'setUi', ui: { itemSelector: sel } } as never);
  };
  // 同点按钮本身（InlineEdit §onClick）：先选中这一块，再开按钮弹窗。
  const edit = () => { selectIt(); inline?.openButton(id, spec.slot, index); };
  const act = (op: ItemOp) => {
    const g = getPuck();
    const now = g.getItemById(id) as unknown as { type: string; props: ItemProps } | undefined;
    const sel = g.getSelectorForId(id);
    const before = now ? getAt(now.props, spec.path) : undefined;
    const after = Array.isArray(before) ? itemOp(before, index, op, spec.min) : null;
    if (!now || !sel || !after) return;
    // 没选中的先选中它（右栏换成这一块，那一列当场同步），再改 —— 同块的条（§BlockBar）。
    // 📌 Ctrl+Z 退回的是按之前那一刻（连选中一起）：Puck 记撤销有 250 ms 的去抖（dist/index.js §createHistorySlice），
    //    选中和改动并成一步，单记选中那一下记不住 —— 同块的条点 🗑 再 Ctrl+Z 一样。
    if (selectedId !== id) g.dispatch({ type: 'setUi', ui: { itemSelector: sel } } as never);
    g.dispatch({ type: 'replace', destinationIndex: sel.index, destinationZone: sel.zone, data: { ...now, props: setAt(now.props, spec.path, after) }, recordHistory: true } as never);
    inline?.noteItem({ id, slot: spec.slot, path: spec.path, op, index, before: before as unknown[], after });
  };
  const halt = (e: { stopPropagation: () => void }) => e.stopPropagation();
  return createPortal(
    <span data-editor-itembar="" data-editor-itembar-for={key} data-editor-itembar-block={id} onClick={halt}
      {...EDITOR_LIGHT} style={{ ...EDITOR_LIGHT_STYLE, ...ITEMBAR_BOX, top: pos.top, left: pos.left, transform: `scale(${pos.scale})` }}>
      <ActionBar>
        {img && (
          <ActionBar.Group>
            {img.regenerate && (
              <ActionBar.Action label="Regenerate" disabled={busy} onClick={() => runItemImage(img.el, key, 'regenerate')} data-editor-image-regenerate="" data-editor-image-busy={waiting ? '' : undefined}>
                {waiting ? ITEMBAR_SPINNER : BLOCKBAR_ICON.sparkles}
                <span style={BLOCKBAR_TEXT}>{waiting ? 'Generating…' : 'Regenerate'}</span>
              </ActionBar.Action>
            )}
            <ActionBar.Action label="Edit" disabled={busy} onClick={() => runItemImage(img.el, key, 'edit')} data-editor-image-edit="">
              {BLOCKBAR_ICON.edit}
              <span style={BLOCKBAR_TEXT}>Edit</span>
            </ActionBar.Action>
          </ActionBar.Group>
        )}
        {button && (
          <ActionBar.Group>
            <ActionBar.Action label="Edit" disabled={busy} onClick={edit} data-editor-item-action="edit">
              {BLOCKBAR_ICON.edit}
              <span style={BLOCKBAR_TEXT}>Edit</span>
            </ActionBar.Action>
          </ActionBar.Group>
        )}
        <ActionBar.Group>
          <ActionBar.Action label="Move up" disabled={busy || index <= 0 || !pos.above} onClick={() => act('up')} data-editor-item-action="up">
            {BLOCKBAR_ICON.up}
          </ActionBar.Action>
          <ActionBar.Action label="Move down" disabled={busy || index >= list.length - 1 || !pos.below} onClick={() => act('down')} data-editor-item-action="down">
            {BLOCKBAR_ICON.down}
          </ActionBar.Action>
          <ActionBar.Action label="Delete" disabled={busy || list.length <= (spec.min ?? 0)} onClick={() => act('remove')} data-editor-item-action="delete">
            {BLOCKBAR_ICON.trash}
          </ActionBar.Action>
        </ActionBar.Group>
      </ActionBar>
      {note && <span data-editor-image-note="" style={ITEMBAR_NOTE}>{note}</span>}
    </span>,
    doc.body,
  );
}

/** 每帧找一次，找到就交给 `then`；1.5 秒还没有就算了（面板没打开 / 字段还在 resolve）。 */
function whenFound<T>(find: () => T | null | undefined, then: (v: T) => void) {
  const until = Date.now() + 1500;
  const tick = () => {
    const v = find();
    if (v) { then(v); return; }
    if (Date.now() < until) requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}

/** 右栏滚到这个字段、焦点放进它的第一个输入框。没有文字字段的块（`slot` 空）就是右栏第一个字段。
 *  🔴 Puck 同时渲染两份字段面板（另一份是窄屏布局用的，看不见）⟹ 只认看得见的那一份。 */
function revealField(slot: string | undefined) {
  const sel = slot ? `[data-editor-field="${slot}"]` : '[data-editor-field]';
  whenFound(() => Array.from(document.querySelectorAll<HTMLElement>(sel)).find((el) => el.getClientRects().length > 0), (box) => {
    box.scrollIntoView({ block: 'start' });
    const input = box.querySelector<HTMLElement>('input:not([type=hidden]):not(:disabled), textarea:not(:disabled), select:not(:disabled)');
    input?.focus({ preventScroll: true });
  });
}

const BLOCKBAR_TEXT = { fontSize: 13, fontWeight: 500, whiteSpace: 'nowrap', padding: '0 2px' } as const;
// 同 AI_ICON 那一套 lucide 线条（仓里没有 lucide-react，手写），16px 跟 Puck 那条的图标一样大。
const blockbarSvg = (d: ReactNode) => (
  <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{d}</svg>
);
const BLOCKBAR_ICON = {
  up: blockbarSvg(<><path d="m5 12 7-7 7 7" /><path d="M12 19V5" /></>),
  down: blockbarSvg(<><path d="M12 5v14" /><path d="m19 12-7 7-7-7" /></>),
  trash: blockbarSvg(<><path d="M3 6h18" /><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6" /><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2" /></>),
  // #1722 —— 左组三颗文字按钮前的图标：调色盘 / 铅笔（lucide palette / pencil）/ 跟 AI 那一格同一个（§AI_ICON_SHAPES）。
  design: blockbarSvg(<>
    <circle cx="13.5" cy="6.5" r=".5" fill="currentColor" /><circle cx="17.5" cy="10.5" r=".5" fill="currentColor" />
    <circle cx="8.5" cy="7.5" r=".5" fill="currentColor" /><circle cx="6.5" cy="12.5" r=".5" fill="currentColor" />
    <path d="M12 2C6.5 2 2 6.5 2 12s4.5 10 10 10c.926 0 1.648-.746 1.648-1.688 0-.437-.18-.835-.437-1.125-.29-.289-.438-.652-.438-1.125a1.64 1.64 0 0 1 1.668-1.668h1.996c3.051 0 5.555-2.503 5.555-5.554C21.965 6.012 17.461 2 12 2z" />
  </>),
  edit: blockbarSvg(<><path d="M21.174 6.812a1 1 0 0 0-3.986-3.987L3.842 16.174a2 2 0 0 0-.5.83l-1.321 4.352a.5.5 0 0 0 .623.622l4.353-1.32a2 2 0 0 0 .83-.497z" /><path d="m15 5 4 4" /></>),
  ai: blockbarSvg(AI_ICON_SHAPES),
  // #1760 —— 条目条上图的 Regenerate（lucide sparkles）。
  sparkles: blockbarSvg(<>
    <path d="M9.937 15.5A2 2 0 0 0 8.5 14.063l-6.135-1.582a.5.5 0 0 1 0-.962L8.5 9.936A2 2 0 0 0 9.937 8.5l1.582-6.135a.5.5 0 0 1 .963 0L14.063 8.5A2 2 0 0 0 15.5 9.937l6.135 1.581a.5.5 0 0 1 0 .964L15.5 14.063a2 2 0 0 0-1.437 1.437l-1.582 6.135a.5.5 0 0 1-.963 0z" />
    <path d="M20 3v4" /><path d="M22 5h-4" /><path d="M4 17v2" /><path d="M5 18H3" />
  </>),
};
// #1760 —— 在等生成：✨ 换成转圈（同原来图上那层 InlineEdit §imageBar 的那一个，放大到图标的 16px）。
const ITEMBAR_SPINNER = (
  <svg width="16" height="16" viewBox="0 0 14 14" aria-hidden="true" data-editor-image-spinner="">
    <circle cx="7" cy="7" r="5.5" fill="none" stroke="#98a2b3" strokeWidth="2" />
    <path d="M7 1.5a5.5 5.5 0 0 1 5.5 5.5" fill="none" stroke="#344054" strokeWidth="2" strokeLinecap="round">
      <animateTransform attributeName="transform" type="rotate" from="0 7 7" to="360 7 7" dur="0.8s" repeatCount="indefinite" />
    </path>
  </svg>
);

// #1710 —— Puck 自己那条整个藏掉（条改由 §BlockBars 画，§PuckActionBarSlot 只是个占位）。不藏的话选中块的右上角留一片
//    看不见却点得着的空框（Puck 那层 `min-height: 36px`、`cursor: grab`）。Puck 的类名带 hash ⟹ 按前缀认。
// Content 页画在网站的 iframe 里，网站的 Bootstrap reboot 把 `label` 设成 inline-block；Puck 子字段的输入框包在 `<label>` 里，
//    label 缩成字宽，输入框（width: 100%）跟着变窄 ⟹ 面板里把 label 还原成块（Chris 2026-10-13：Eyebrow 那一格应该满宽）。
const BLOCKBAR_CSS = `
[data-puck-overlay]:has([data-editor-blockbar-slot]) [class*="DraggableComponent-actionsOverlay"] { display: none !important; }
[data-editor-content-field] label { display: block; }`;
// 条本身：画布可视区里 `position: fixed`（§useBlockBarPos 给 bottom / left），横向以 left 为中线；画布缩放过（Puck 的 Auto zoom）
// ⟹ 按 1/zoom 放大，屏幕上跟 Puck 原来那条一样大。层级在 Design 弹层（§POPOVER）之下。
const BLOCKBAR_BOX: CSSProperties = { position: 'fixed', zIndex: 2147482000, display: 'inline-flex', translate: '-50% 0', transformOrigin: 'center bottom', cursor: 'default' };
// #1723 —— 条目条：贴那一项的右上角（§useItemBarPos 给 top / left = 右上角），往左展开；压在块的条之上、字的工具条之下（#1657 优先）。
// #1760 —— 竖排：生成没成那一句挂在条下面（右沿对齐）；没有那一句时跟原来一样大。
const ITEMBAR_BOX: CSSProperties = { position: 'fixed', zIndex: 2147482100, display: 'inline-flex', flexDirection: 'column', alignItems: 'flex-end', gap: 6, translate: '-100% 0', transformOrigin: 'right top', cursor: 'default' };
const ITEMBAR_NOTE: CSSProperties = { maxWidth: 320, padding: '4px 8px', background: '#fff', border: '1px solid #fda29b', borderRadius: 8, color: '#b42318', fontSize: 13, textAlign: 'center' };

/**
 * #1700 —— Design 弹层：块浮动条上点 Design 弹出，固定在画布可视区底部、水平居中（#1725：不随块走、不随滚动走，两页同一位置）。顶上一排标签（Layout；#1708 加了 Customize：这一块的旋钮 + 开关 + 背景），
 * 底部 Cancel / Done。事务规矩（改了什么、什么时候存、撤销怎么记）在 EditorApp §openDesign，这里只管画和截出口。
 *
 * 画在画布 iframe 里（`CanvasLinkGuard` 拿到的那份 document，portal 进它的 body）：缩略图要用站的样式表和块组件，它们只在画布里有。
 * `position: fixed` 浮在最上层，不被块裁；画布是缩放过的（Puck 的 Auto zoom），整个弹层按 1/zoom 放大，屏幕上是正常字号（同 InlineEdit 的工具条）。
 *
 * Layout 页一格一个预设，格里是「点这一格之后这一块会变成的样子」：props = `presetClickProps(字段, 当前 props, 预设名)`，
 * 跟右栏点芯片同一份（含预设自带的颜色 #1483、空部件用 demo 填 #1487）；用画布同一个 §CanvasBlockBody 再渲染一份，缩进格子。
 * 🔴 缩略图不许被编辑器当成真块：它不在任何 `[data-puck-component]` 里（InlineEdit 只登记那里面的字，点它对不回任何一块），
 *    id 也换成 `<块 id>~design-<n>`（画布上的 `data-block-id` 不跟真块撞）。
 *
 * 出口（PM 2026-10-11 裁定 1：一律先 Cancel 再做它自己）在这里截的几样：
 *   · 画布里按下鼠标、不在弹层上（点别的块 / 空白处 / 点字）。#1771 起弹层开着时画布上没有浮动条（§anyDialogOpen），
 *     #1725 那条「Design / Edit content 两颗按钮不算点到外面」随之撤掉。
 *     🔴 弹层当场收起，但退回要等这一下点击走完（松开之后）：按下就退回的话，块从试看的样子换回原样、整块重排，
 *        松开时那一下点击落到挪了位的别的东西上 —— 点标题却开不出字的工具条（e2e ⑧ 量到的）。点到的是哪一段字、
 *        哪一块，按老板按下时看到的那一份算；退回之后 InlineEdit 按块 id + slot 自己跟到新位置（§relocate）。
 *   · 编辑器页上按下鼠标（右栏、左栏、顶栏）；撤销 / 前进那两颗按钮只 Cancel，不让它再退一步
 *   · Ctrl+Z / Ctrl+Y（两个 window，捕获阶段，同 §useAiLockGuard）：只 Cancel · Esc：Cancel
 *   · 选中的块换了（大纲里点了别的块之类）
 * 🔴 弹层自己的鼠标 / 键盘事件不往外冒：React 的事件顺着组件树冒到 Puck 的预览框，它见目标不是块就把选中清掉；
 *    键盘冒到画布 document，Backspace 会被 Puck 当成「删掉选中的块」（#1683 那一条）。
 */
// #1727 —— 这是弹层的最宽；画布切窄（Puck 的 Small = 360）放不下时，宽 = 画布可视区宽 − 两边各 POPOVER_EDGE（§DesignPopover 的 tick）。
const POPOVER_W = 520;
// #1727 —— Layout 页内容区左右各留的边（弹层自己的 px，同下面 JSX 里的 padding: 12）+ 弹层左右边框各 1 ⟹ 宽度够不够放两列按它算。
const POPOVER_PAD = 12;
const POPOVER_BORDER = 1;
const THUMB_W = 236;
// #1738 r3 —— 顶栏 / 页脚的缩略图先按这么宽排版再缩：它们又宽又矮，按画布宽（常见 1500）排版再缩到 236
//    只剩一条线（Chris 2026-10-13 打回）。1024 > 顶栏唯一的断点 992（`blocks/header/block.css`）⟹ 缩略图里仍是桌面那一版。
//    这两区的格子一行一张、占满内容区宽（§DesignPopover 现算）。页面块不受影响：照旧按画布宽排版、236 宽、两列。
// #1764 —— 画布再窄也按这么宽：媒体查询按画布视口宽求值、不看这一层多宽，所以光排版宽 1024 不够 —— 画布窄于 992 时缩略图里还是
//    窄屏顶栏（窗口 1366 就是）。§DesignThumbBody 挂 THUMB_WIDE_MARK，`scripts/lib/thumb-media.js` 让那一层里的媒体查询按这个宽求值。
const REGION_THUMB_LAYOUT_W = 1024;
// #1722 —— 格子高 = 那个预设缩完之后的实际高（§DesignThumbBody 量），不再是固定高的框。这个数只在还没量到的那一帧顶一下。
const THUMB_H = 148;
// #1722 —— 两列各自往下堆（同列上下两格之间、两列之间都是这个距离）。名字那一行写死行高 ⟹ 一格的高 = 缩略图高 + 6 + 16，
//    摆位置只靠算术，不用再量一次整格。
const THUMB_GAP = 12;
const THUMB_NAME_H = 16;
// #1722 —— 预设太高时格子最多这么高：画布可视区高的 60%（画布 document 的 px），超出的裁掉下边并淡出。
const THUMB_MAX_VH = 0.6;
// #1712 —— 弹层最矮缩到多矮（弹层自己的 px）：顶上标签 + 一排格子 + 底部按钮刚好放得下。
const POPOVER_MIN_H = 300;
// #1725 —— 弹层最高占画布可视区高的这么多（不低于 POPOVER_MIN_H）；超出的内容区自己滚。
const POPOVER_MAX_VH = 0.5;
// #1725 —— 弹层底边离画布可视区下沿多远（弹层自己的 px）。
const POPOVER_EDGE = 16;
const POPOVER: CSSProperties = {
  position: 'fixed', zIndex: 2147483000, width: POPOVER_W, boxSizing: 'border-box', display: 'flex', flexDirection: 'column',
  background: '#fff', border: `${POPOVER_BORDER}px solid #d0d5dd`, borderRadius: 12, boxShadow: '0 12px 32px rgba(16, 24, 40, 0.18)',
  fontFamily: 'system-ui, sans-serif', fontSize: 13, color: '#344054', lineHeight: 1.3, transformOrigin: 'bottom left',
};
const POPOVER_BTN: CSSProperties = { padding: '6px 14px', borderRadius: 8, fontSize: 13, fontWeight: 500, cursor: 'pointer', fontFamily: 'inherit' };
const popoverTab = (on: boolean): CSSProperties => ({
  padding: '6px 10px 8px', border: 0, borderBottom: `2px solid ${on ? '#1d4ed8' : 'transparent'}`, background: 'none',
  color: on ? '#1d4ed8' : '#475467', fontSize: 13, fontWeight: 600, cursor: on ? 'default' : 'pointer', fontFamily: 'inherit',
});
// #1755 —— `button` 不是一页：画布上点按钮开的按钮弹窗（§DesignPopover 的 `button` 那一支），借 Design 面板的事务和出口。
// #1757 —— 第四页 AI：输入一句话改这一块（§DesignAi）。只给页面块，顶栏 / 页脚的面板没有它。
type DesignTab = 'layout' | 'customize' | 'content' | 'ai' | 'button';
// 「先存再发」那一笔没存上时，左边聊天说的那句（#1757 起面板的 AI 页也说它，正文做什么 6）。
const SEND_SAVE_FAILED = 'Your message was not sent, because your changes could not be saved first. See the message at the top of the editor.';
const DESIGN_TAB_LABEL: Record<DesignTab, string> = { layout: 'Layout', customize: 'Customize', content: 'Content', ai: 'AI', button: 'Button' };

/**
 * #1738 —— Design 面板也给顶栏 / 页脚开。它们不是 Puck 的块（外壳区，`blocks/header/Section.tsx` 文件头），面板认它们用这两个 id
 * （Puck 的块 id 不会以 `~` 开头）。改的是 root 上的两个字段：预设 = `<区>Shape`，底色 + 旋钮 = `<区>Options`（分派表
 * `editor-root-fields.js`）；整站一份，存盘照分派表逐字段比。
 */
type Region = 'header' | 'footer';
const REGION_DESIGN_ID: Record<Region, string> = { header: '~region:header', footer: '~region:footer' };
const REGION_ROOT: Record<Region, { shape: 'headerShape' | 'footerShape'; options: 'headerOptions' | 'footerOptions' }> = {
  header: { shape: 'headerShape', options: 'headerOptions' },
  footer: { shape: 'footerShape', options: 'footerOptions' },
};
function regionOfDesign(id: string | null | undefined): Region | null {
  return id === REGION_DESIGN_ID.header ? 'header' : id === REGION_DESIGN_ID.footer ? 'footer' : null;
}
/** 画布上那个区的根元素（不算 Design 面板缩略图里画的那几份）。 */
function regionEl(doc: Document, region: Region): HTMLElement | null {
  return Array.from(doc.querySelectorAll<HTMLElement>(`[data-block="${region}"]`)).find((el) => !el.closest('[data-editor-popover]')) || null;
}
/** 画布上 Design 面板正在改的那一个（块 / 区）的根元素。 */
function designTargetEl(doc: Document, id: string): Element | null {
  const region = regionOfDesign(id);
  return region ? regionEl(doc, region) : doc.querySelector(`[data-puck-component="${CSS.escape(id)}"]`);
}
const asOptions = (v: unknown): Record<string, unknown> => (v && typeof v === 'object' && !Array.isArray(v) ? v as Record<string, unknown> : {});

/**
 * #1722 —— 缩略图里缩放过的那一层：报出块渲染出来的高（未缩放的 px）。缩略图里的图片 / 字体晚到会改块高 ⟹ 一直盯着。
 * 量的是 offsetHeight（布局高，不受 transform 影响），而这一层的宽固定是排版宽（页面块 = 画布宽；顶栏 / 页脚 1024，#1738 r3 / #1764）⟹ 格子高变了它也不变，不会来回推。
 */
function DesignThumbBody({ vw, thumbW, wide, onHeight, children }: { vw: number; thumbW: number; wide?: boolean; onHeight: (h: number) => void; children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const report = useRef(onHeight);
  report.current = onHeight;
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    // #1764 —— 先把画布 document 的样式表改好（幂等，第一张缩略图做完后面的都是空转），再量第一次高。
    if (wide) applyThumbMedia(el.ownerDocument, vw);
    report.current(el.offsetHeight);
    const RO = (el.ownerDocument.defaultView as (Window & typeof globalThis) | null)?.ResizeObserver;
    if (!RO) return;
    const ro = new RO(() => report.current(el.offsetHeight));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return (
    <div ref={ref} {...(wide ? { [THUMB_WIDE_MARK]: '' } : null)} style={{ width: vw, transform: `scale(${thumbW / vw})`, transformOrigin: 'top left', pointerEvents: 'none' }} aria-hidden="true">
      {children}
    </div>
  );
}

/** #1700 / #1708 —— Design 面板 Layout / Customize 两页画的那两个字段：预设那一格（Layout 的格子 + Customize 的旋钮）和背景。 */
function designSlotsOf(component: EditorComponent) {
  const preset = component.fields.find((x) => x.control === 'options' && (x.presets || []).length);
  const bg = component.fields.find((x) => x.control === 'color' && x.slot === 'bg');
  return { preset, bg };
}

/**
 * #1735 —— Content 页画哪些字段：右栏这一块画的那一份（同一个 `resolveFields` 的结果、同一个顺序 —— 共用块 / 锁住的块顶上那句话、
 * 写成引用的列表那一栏都跟着来），去掉另外两页已经有的那两个（§designSlotsOf）。`scripts/editor-design-content.test.js` 对 15 种块各量一次。
 */
export function designContentFields(component: EditorComponent, resolved: Fields): [string, Field][] {
  const { preset, bg } = designSlotsOf(component);
  return Object.entries(resolved).filter(([slot]) => slot !== preset?.slot && slot !== bg?.slot) as [string, Field][];
}

/**
 * #1735 —— Content 页：字段定义取右栏那一份（编辑器 config 的 `resolveFields`），控件是 Puck 的 `AutoField` —— 右栏 Puck 画的同一套
 *   （文字框、列表的加 / 删 / 拖动、图片的 Change 都是同一个组件）。改动交给 §changeDesign：不记历史、Done / Cancel 跟另两页一个事务。
 *   面板在画布 iframe 里：Puck 的样式靠 `syncHostStyles`（§EDITOR_IFRAME）抄进了画布 document，所以 Puck 的控件在这里长得跟右栏一样。
 *   每个字段外面一层 `data-editor-content-field="<slot>"`（同右栏的 `data-editor-field`，Edit content 落光标、e2e 找字段都靠它）。
 */
export function DesignContent({ component, item, ui, readOnly }: { component: EditorComponent; item: { type: string; props: ItemProps }; ui: EditorUi; readOnly: Record<string, boolean> }) {
  const comp = usePuck((s) => s.config.components[item.type]) as { fields?: Fields; resolveFields?: (data: unknown, params: unknown) => Fields } | undefined;
  const resolved = (comp?.resolveFields ? comp.resolveFields(item, {}) : comp?.fields) || {};
  return (
    <>
      {designContentFields(component, resolved).map(([slot, field]) => (
        <div key={slot} data-editor-content-field={slot} style={{ marginBottom: 16 }}>
          {/* 公开的 AutoField 不画顶层字段的标题（右栏那份是 Puck 内部的 Label 画的）⟹ 这里补 Puck 的 FieldLabel；custom 字段的 render 自己画了标题。 */}
          {field.type === 'custom' ? (
            <AutoField field={field} value={item.props[slot]} onChange={(v: unknown) => ui.changeDesign(slot, v)} readOnly={!!readOnly[slot]} />
          ) : (
            <FieldLabel label={field.label || slot} el="div" readOnly={!!readOnly[slot]}>
              <AutoField field={field} value={item.props[slot]} onChange={(v: unknown) => ui.changeDesign(slot, v)} readOnly={!!readOnly[slot]} />
            </FieldLabel>
          )}
        </div>
      ))}
    </>
  );
}

/** #1759 —— `{label, href}`（不是对象 / 不是字符串 ⟹ 空串）。 */
function asButtonValue(v: unknown): { label: string; href: string } {
  const o = v && typeof v === 'object' && !Array.isArray(v) ? v as Record<string, unknown> : {};
  return { label: typeof o.label === 'string' ? o.label : '', href: typeof o.href === 'string' ? o.href : '' };
}

/** #1759 —— 顶栏 Content 页有不能存的值时 Done 要说的那一句（'' = 能存）。写盘那一侧（`editor-root.js` / `editor-nav.js`）照样再判一次。 */
function headerContentProblem(p: Record<string, unknown>): string {
  if (typeof p.brandName === 'string' && !p.brandName.trim()) return 'The business name can\'t be empty.';
  const menu = navMenuProblem(p.navMenu as NavPanel | undefined);
  if (menu) return menu;
  if (p.headerCta) {
    const b = asButtonValue(p.headerCta);
    if (!b.label.trim() || !b.href.trim()) return 'The main button needs both a name and a link.';
  }
  if (p.headerCtaSecondary) {
    const b = asButtonValue(p.headerCtaSecondary);
    if (!b.label.trim() !== !b.href.trim()) return 'The second button needs both a name and a link. To remove it, clear both.';
  }
  return '';
}

const HEADER_SUB: CSSProperties = { margin: '4px 0 8px', fontSize: 12, lineHeight: 1.4, color: '#667085' };
const HEADER_ROW_BTN: CSSProperties = { padding: '4px 8px', border: '1px solid #d0d5dd', borderRadius: 6, background: '#fff', cursor: 'pointer', fontSize: 12, whiteSpace: 'nowrap', fontFamily: 'inherit' };

/**
 * #1759 —— 顶栏 Design 面板的 Content 页（票正文做什么 3）：Logo · Business name · Navigation links · Buttons。
 *   改的全是 root 上的值（`changeHeader`），跟 Layout / Customize 两页同一个事务：画布当场跟着变（§withHeaderContent），Done 存一笔、Cancel 全退回。
 *   · Logo —— 同右栏图片格的 Change（`ImageUrlControl`，选图弹窗同一个 `pickImage`）；写 `brand.json` 的 `logoUrl`。
 *   · Business name —— Page 面板里那一格的同一个值（`brandName`）。
 *   · Navigation links —— 菜单是从页面推出来的：列表、拖动、显示 / 隐藏的规矩全在 `nav-editor.js`。按钮指向的那一页不列，下面一句灰字点名它；
 *     拖动抄 §StringListControl 的形态（只有把手可拖，输入框里能用鼠标选字）。首页一行：能改名，不能拖、不能隐藏。
 *   · Buttons —— 主按钮 / 次按钮，文字 + 链接。链接只给 Custom link（`LinkHrefControl` 传空的 `sources`）：顶栏按钮的 href 只收字符串，
 *     写成电话 / 邮箱引用整站建不出来（`derive-site.js` 对它调 `.replace`）。
 *   每个字段外面一层 `data-editor-content-field`（同块的 Content 页：Edit content 落光标、#1743 撤销键判据、e2e 都靠它）。
 */
function HeaderContent({ props, ui, site }: { props: Record<string, unknown>; ui: EditorUi; site: SiteData }) {
  const [dragFrom, setDragFrom] = useState<number | null>(null);
  const menu = props.navMenu as NavPanel | undefined;
  const cta = asButtonValue(props.headerCta);
  const sec = asButtonValue(props.headerCtaSecondary);
  const ctaHref = cta.href.trim();
  const rows = menu ? panelRows(menu, ctaHref) : [];
  const shownCount = rows.filter((r) => r.shown).length;
  const btnPage = menu ? buttonPage(menu, ctaHref) : null;
  const set = (patch: Partial<RootProps>) => ui.changeHeader(patch);
  const setMenu = (next: NavPanel) => set({ navMenu: next });
  const button = (which: 'headerCta' | 'headerCtaSecondary', label: string, v: { label: string; href: string }, hint: string) => (
    <div data-editor-header-button={which === 'headerCta' ? 'main' : 'second'} style={{ marginBottom: 12 }}>
      <div style={{ ...SUB_LABEL, marginBottom: 2 }}>{label}</div>
      <p style={HEADER_SUB}>{hint}</p>
      <FieldLabel label="Text" el="div" />
      <input data-editor-header-button-text="" type="text" value={v.label} onChange={(e) => set({ [which]: { ...v, label: e.target.value } })}
        style={{ ...INPUT_STYLE, marginBottom: 8 }} />
      <LinkHrefControl label="Link" sources={[]} value={v.href} site={site}
        onChange={(x) => set({ [which]: { ...v, href: typeof x === 'string' ? x : '' } })} />
    </div>
  );
  return (
    <>
      {typeof props.logoUrl === 'string' && (
        <div data-editor-content-field="logoUrl" style={{ marginBottom: 16 }}>
          <ImageUrlControl label="Logo" optional value={props.logoUrl} onChange={(v) => set({ logoUrl: typeof v === 'string' ? v : '' })} />
        </div>
      )}
      {typeof props.brandName === 'string' && (
        <div data-editor-content-field="brandName" style={{ marginBottom: 16 }}>
          <FieldLabel label="Business name" el="div" />
          <input data-editor-header-brand="" type="text" value={props.brandName} onChange={(e) => set({ brandName: e.target.value })} style={INPUT_STYLE} />
        </div>
      )}
      {menu && (
        <div data-editor-content-field="navMenu" data-editor-header-links="" style={{ marginBottom: 16 }}>
          <FieldLabel label="Navigation links" el="div" />
          <p data-editor-header-links-note="" style={HEADER_SUB}>These links also appear in the footer menu.</p>
          <div data-editor-header-link-row="home" style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6 }}>
            <span aria-hidden="true" style={{ width: 18 }} />
            <input data-editor-header-link-input="home" type="text" value={menu.home.label} aria-label="Home page link name"
              onChange={(e) => setMenu(setLabel(menu, 'home', e.target.value))} style={{ ...INPUT_STYLE, flex: 1, minWidth: 0 }} />
            <span style={{ ...HEADER_SUB, margin: 0, minWidth: 64, textAlign: 'center' }}>Home page</span>
          </div>
          {rows.map((r) => {
            const i = rows.indexOf(r);
            const draggable = r.shown && shownCount > 1;
            return (
              <div key={r.slug} data-editor-header-link-row={r.slug} data-editor-header-link-hidden={r.shown ? undefined : ''}
                onDragOver={(e) => { if (r.shown && dragFrom !== null) { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; } }}
                onDrop={(e) => { e.preventDefault(); if (dragFrom !== null && r.shown) setMenu(moveShown(menu, ctaHref, dragFrom, i)); setDragFrom(null); }}
                style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6, opacity: dragFrom === i ? 0.5 : 1 }}>
                <span data-editor-header-link-handle="" draggable={draggable} aria-hidden="true" title={draggable ? 'Drag to reorder' : undefined}
                  onDragStart={(e) => { setDragFrom(i); e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', String(i)); }}
                  onDragEnd={() => setDragFrom(null)}
                  style={{ width: 18, cursor: draggable ? 'grab' : 'default', color: draggable ? '#98a2b3' : 'transparent', userSelect: 'none' }}>⋮⋮</span>
                <input data-editor-header-link-input={r.slug} type="text" value={r.label} disabled={!r.shown} aria-label={`${r.title || r.slug} link name`}
                  onChange={(e) => setMenu(setLabel(menu, r.slug, e.target.value))}
                  style={{ ...INPUT_STYLE, flex: 1, minWidth: 0, ...(r.shown ? {} : { color: '#98a2b3', background: '#f9fafb' }) }} />
                <button type="button" role="switch" aria-checked={r.shown} data-editor-header-link-toggle={r.slug}
                  onClick={() => setMenu(setShown(menu, ctaHref, r.slug, !r.shown))} style={{ ...HEADER_ROW_BTN, minWidth: 64 }}>
                  {r.shown ? 'Shown' : 'Hidden'}
                </button>
              </div>
            );
          })}
          {btnPage && (
            <p data-editor-header-button-page={btnPage.slug} style={HEADER_SUB}>
              {`"${btnPage.shown ? btnPage.label : btnPage.title || btnPage.slug}" is the button on the right — edit it under Buttons.`}
            </p>
          )}
        </div>
      )}
      {props.headerCta !== undefined && (
        <div data-editor-content-field="buttons" style={{ marginBottom: 8 }}>
          <FieldLabel label="Buttons" el="div" />
          {button('headerCta', 'Main button', cta, 'Needs both a text and a link.')}
          {button('headerCtaSecondary', 'Second button', sec, 'Leave both empty for no second button.')}
        </div>
      )}
    </>
  );
}

// #1757 —— AI 页显示哪几轮（判据在那份文件头里：水位线 + 按发出顺序比字）。
type ChatRow = EditorChatState['messages'][number];

const AI_C = { border: '#e4e7ec', text: '#101828', sub: '#475467', faint: '#667085', user: '#4f46e5', bot: '#f2f4f7', err: '#fef3f2', errText: '#b42318' };

/**
 * #1757 —— 面板第四页 AI：一句标题、这一次打开以来的那几轮、输入框（左下角是这一块的名字，右下角发送）。没有 Cancel / Done。
 *   发出去的就是左边聊天那条路（§sendChat，`fromPanel`），带这一块的范围（同一个 `scopeOf`）。记录照旧在左边聊天里。
 *   🔴 Enter 发送挂在 textarea 自己的原生 keydown 上：面板的 keydown 在面板那一层就被截住（§DesignPopover 的 stop），
 *      React 的 onKeyDown 挂在 portal 容器上，永远收不到（#1712 同一条）。
 */
function DesignAi({ ui, item, rounds, sentAny, onSent }: {
  ui: EditorUi;
  item: { type: string; props: ItemProps };
  rounds: { user: ChatRow; replies: ChatRow[] }[];
  /** 这一次打开以来从这一页发过没有：没发过的话 AI 在改的是别处发的那一句，这一页不说「AI is working…」。 */
  sentAny: boolean;
  onSent: (text: string) => void;
}) {
  const config = usePuck((s) => s.config);
  const [text, setText] = useState('');
  const [confirming, setConfirming] = useState<number | null>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const label = config.components[item.type]?.label || item.type;
  const chat = ui.chat;
  const working = (ui.chatPending || !!chat?.busy) && sentAny;
  const busy = ui.chatPending || !!chat?.busy || !!chat?.reverting;
  const canSend = !!chat?.enabled && !busy && text.trim().length > 0;
  const send = () => {
    if (!canSend) return;
    const t = text.trim();
    onSent(t);
    ui.sendChat(t, scopeOf((item.props as { _src?: ChatSrc })._src, ui.page, ui.locale, ui.rawKey), true);
    setText('');
  };
  const sendRef = useRef(send);
  sendRef.current = send;
  useEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); sendRef.current(); } };
    el.addEventListener('keydown', onKey);
    return () => el.removeEventListener('keydown', onKey);
  }, []);
  const lastReply = rounds.length ? rounds[rounds.length - 1].replies.length : 0;
  useEffect(() => {
    const el = listRef.current;
    if (el) el.scrollTo({ top: el.scrollHeight });
  }, [rounds.length, lastReply, working, chat?.reverting, ui.designNotice]);
  const bubble = (m: ChatRow): CSSProperties => ({
    padding: '8px 12px', borderRadius: 10, fontSize: 14, lineHeight: 1.5, whiteSpace: 'pre-wrap', wordBreak: 'break-word',
    background: m.role === 'user' ? AI_C.user : m.role === 'error' ? AI_C.err : AI_C.bot,
    color: m.role === 'user' ? '#fff' : m.role === 'error' ? AI_C.errText : AI_C.text,
  });
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10, minHeight: 0, flex: 1 }}>
      <div data-editor-design-ai-title="" style={{ fontSize: 14, fontWeight: 600, color: AI_C.text }}>What would you like to change about this section?</div>
      <div ref={listRef} data-editor-design-ai-rounds="" style={{ flex: 1, minHeight: 0, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 10 }}>
        {rounds.map(({ user: m, replies }) => (
          <div key={m.key} data-editor-design-ai-round={m.messageId ?? ''} style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <div data-editor-design-ai-msg="user" style={{ alignSelf: 'flex-end', maxWidth: '88%' }}>
              <div style={bubble(m)}>{m.text}</div>
              {m.canRevert && m.messageId != null && (
                confirming === m.messageId ? (
                  <RevertConfirm m={m} messages={chat ? chat.messages : []} onYes={() => { setConfirming(null); ui.revertChat(m.messageId as number, true); }} onNo={() => setConfirming(null)} />
                ) : (
                  <div style={{ textAlign: 'right', marginTop: 4 }}>
                    <button type="button" data-editor-design-ai-revert={m.messageId} disabled={busy} onClick={() => setConfirming(m.messageId as number)}
                      title="Revert to here" aria-label="Revert to here"
                      style={{ border: `1px solid ${AI_C.border}`, background: '#fff', borderRadius: 6, padding: '2px 8px', fontSize: 13, cursor: busy ? 'default' : 'pointer', opacity: busy ? 0.5 : 1 }}>↺</button>
                  </div>
                )
              )}
            </div>
            {replies.map((a) => (
              <div key={a.key} data-editor-design-ai-msg={a.role} style={{ alignSelf: 'flex-start', maxWidth: '88%' }}>
                <div style={bubble(a)}>{a.text}</div>
              </div>
            ))}
          </div>
        ))}
        {working && <p data-editor-design-ai-working="" style={{ margin: 0, fontSize: 13, color: AI_C.faint, fontStyle: 'italic' }}>AI is working…</p>}
        {chat?.reverting && <p data-editor-design-ai-reverting="" style={{ margin: 0, fontSize: 13, color: AI_C.sub }}>Undoing that change…</p>}
        {ui.designNotice && (
          <p data-editor-design-ai-notice={ui.designNotice.kind} style={{ margin: 0, fontSize: 13, lineHeight: 1.5, color: ui.designNotice.kind === 'error' ? AI_C.errText : AI_C.sub }}>
            {ui.designNotice.text}
          </p>
        )}
      </div>
      <div style={{ border: `1px solid ${AI_C.border}`, borderRadius: 8, padding: 8, display: 'flex', flexDirection: 'column', gap: 6 }}>
        <textarea ref={inputRef} data-editor-design-ai-input="" value={text} disabled={!chat?.enabled} rows={3}
          onChange={(e) => setText(e.target.value)} placeholder={`Ask AI to change the ${label} section…`}
          style={{ width: '100%', boxSizing: 'border-box', resize: 'none', border: 0, outline: 'none', fontSize: 14, fontFamily: 'inherit', color: AI_C.text, background: 'transparent' }} />
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
          <span data-editor-design-ai-scope="" style={{ fontSize: 12, color: AI_C.sub, background: AI_C.bot, borderRadius: 6, padding: '2px 8px' }}>{label}</span>
          <button type="button" data-editor-design-ai-send="" disabled={!canSend} onClick={send}
            style={{ ...POPOVER_BTN, border: 0, background: '#1d4ed8', color: '#fff', opacity: canSend ? 1 : 0.5, cursor: canSend ? 'pointer' : 'default' }}>Send</button>
        </div>
      </div>
    </div>
  );
}

function DesignPopover({ doc }: { doc: Document }) {
  const ui = useContext(EditorUiContext);
  const api = useContext(InlineApiContext);
  const id = ui ? ui.design : null;
  // 监听里要的是最新的那一份（它们只在弹层开 / 关时挂一次）。
  const uiRef = useRef(ui);
  uiRef.current = ui;
  // #1738 —— 开的是顶栏 / 页脚：没有 Puck 条目，改的是 root 上那两个字段（§REGION_ROOT）。
  const region = regionOfDesign(id);
  const item = usePuck((s) => (id && !region ? (s.appState.data.content.find((c) => String((c.props as ItemProps).id) === id) || null) : null));
  const rootProps = usePuck((s) => (region ? ((s.appState.data.root as { props?: Record<string, unknown> } | undefined)?.props || null) : null));
  const selectedId = usePuck((s) => (s.selectedItem ? String((s.selectedItem.props as ItemProps).id) : null));
  const boxRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ bottom: number; left: number; scale: number; maxH: number; w: number } | null>(null);
  // #1722 —— 每格缩略图里块渲染出来的高（未缩放的 px），按「块 id:第几个预设」记（换一块不用清）。
  const [bodyH, setBodyH] = useState<Record<string, number>>({});
  // 画布里点到了外面：弹层已经收起、等那一下点击走完再退回（见文件头那段 🔴）。换了一块 / 关掉之后复位。
  const [leaving, setLeaving] = useState(false);
  // #1708 —— Layout / Customize / Content（#1735）/ AI（#1757）四页；切页不算改动。打开停在哪一页由 §openDesign 定（Design = Layout，
  //   Edit content = Content，AI Edit = AI）。#1757 起这一位住在 EditorApp（§designOnAi 要据它判关不关面板）。
  const tab: DesignTab = ui ? ui.designTab : 'layout';
  const setTab = (t: DesignTab) => ui?.setDesignTab(t);
  const start = ui ? ui.designStart : null;
  // #1757 —— AI 页这一次打开以来的那几轮（§designAiRounds）：打开那一刻记水位线（最大的 messageId），关掉就没了。住在这里不住在 §DesignAi：切到别的页它会卸载。
  const [aiSession, setAiSession] = useState<{ water: { id: number; keys: string[] }; sent: string[] }>({ water: { id: 0, keys: [] }, sent: [] });
  useEffect(() => { setLeaving(false); setAiSession({ water: designAiWater(uiRef.current?.chat?.messages ?? []), sent: [] }); }, [id]);
  // #1735 —— Edit content：停在 Content 页之后，光标放进那个字段的第一个输入框（面板画出来、那一页挂上之后），页内滚到它。
  useEffect(() => {
    if (!id || !start || start.tab !== 'content') return;
    const sel = start.focus ? `[data-editor-content-field="${CSS.escape(start.focus)}"]` : '[data-editor-content-field]';
    whenFound(() => {
      const box = boxRef.current;
      if (!box || box.style.visibility !== 'visible') return null;
      return box.querySelector<HTMLElement>(`[data-editor-design-content] ${sel}`);
    }, (field) => {
      const page = field.closest<HTMLElement>('[data-editor-design-content]');
      // 字段顶（含标题）贴到这一页的内边距下沿；弹层按 1/zoom 放大过 ⟹ 屏幕上的差除回 scale 才是这一页自己的 px。
      if (page) page.scrollTop += (field.getBoundingClientRect().top - page.getBoundingClientRect().top) * (page.offsetHeight / (page.getBoundingClientRect().height || page.offsetHeight)) - POPOVER_PAD;
      field.querySelector<HTMLElement>('input:not([type=hidden]):not(:disabled), textarea:not(:disabled), select:not(:disabled)')?.focus({ preventScroll: true });
    });
  }, [id, start?.n]); // eslint-disable-line react-hooks/exhaustive-deps
  // #1757 —— AI Edit：停在 AI 页之后光标放进那一页的输入框。
  useEffect(() => {
    if (!id || !start || start.tab !== 'ai') return;
    whenFound(() => {
      const box = boxRef.current;
      if (!box || box.style.visibility !== 'visible') return null;
      return box.querySelector<HTMLTextAreaElement>('[data-editor-design-ai-input]:not(:disabled)');
    }, (el) => el.focus({ preventScroll: true }));
  }, [id, start?.n]); // eslint-disable-line react-hooks/exhaustive-deps

  // 选中的块换了 / 这一块没了（被撤销、删掉、换了底稿）⟹ Cancel。
  //    顶栏 / 页脚不是 Puck 的块、选中它们不经过 Puck ⟹ 不看这一条（点画布别处由下面的出口收）。
  useEffect(() => {
    if (id && !region && (selectedId !== id || !item)) ui?.cancelDesign();
  }, [id, region, selectedId, item, ui]);

  // 出口：画布里 / 编辑器页上按下鼠标、撤销键、Esc。
  useEffect(() => {
    if (!id) return;
    const cancel = () => uiRef.current?.cancelDesign();
    const inside = (t: EventTarget | null) => !!t && typeof (t as Element).closest === 'function'
      && !!(t as Element).closest('[data-editor-popover]');
    const win = doc.defaultView;
    let leaving = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const finish = () => {
      if (timer) { clearTimeout(timer); timer = null; }
      win?.removeEventListener('pointerup', afterUp, true);
      win?.removeEventListener('pointercancel', finish, true);
      cancel();
    };
    // click 跟在 pointerup 后面派发 ⟹ pointerup 之后再排一个任务，退回就落在 click 之后。按住不放 / 拖走了也有兜底。
    const afterUp = () => { setTimeout(finish, 0); };
    const onCanvasDown = (e: Event) => {
      if (inside(e.target) || leaving) return;
      leaving = true;
      setLeaving(true);
      win?.addEventListener('pointerup', afterUp, true);
      win?.addEventListener('pointercancel', finish, true);
      timer = setTimeout(finish, 1500);
    };
    // #1741 —— 撤销 / 前进那两颗搬到了 dashboard 顶栏：按下去是一条 `ai1st:undo` 消息，弹层开着时只 Cancel 由 §requestHistory 管
    //    （#1712 那条「紧跟着的 click 不许落到 Puck 手里」随按钮一起没了 —— 编辑器页上已经没有那两颗按钮）。
    // #1735 r2 —— Content 页里 Form 那一格的「Edit this form」把表单对话框开在编辑器页上（§FormCopyDialog）：
    // 它开着时按鼠标 / 按键是在接着改这一块，不是离开弹层。对话框自己的 Done / Cancel 只管表单那一笔。
    // 🔴 判据是「对话框开着没有」，不是「按键的 target 在不在对话框里」（r3）：点它的标题字 / 遮罩、或点掉一颗随即消失的
    //    「+ Add」按钮，焦点就掉到 <body> 上，target 不在对话框里 ⟹ r2 那版把 Esc 当成了 Cancel 弹层。
    const formDialogOpen = () => !!document.querySelector('[data-editor-form-dialog]');
    const onPageDown = () => {
      if (formDialogOpen()) return;
      cancel();
    };
    const onKey = (e: KeyboardEvent) => {
      // 对话框开着：撤销键留给输入框自己撤字（不让 Puck 退画布历史 —— 弹层里的改动没记历史）；Esc 由对话框自己收（§FormCopyDialog）。
      if (formDialogOpen()) { if (isHistoryKey(e)) e.stopImmediatePropagation(); return; }
      // #1743 —— 光标在 Content 页自己的输入框里：同上，撤销键留给输入框撤字，不 Cancel 弹层。
      // 判据取按键的 target，不取 `doc.activeElement`：焦点回到编辑器页之后，画布那份 activeElement 仍指着上次那个输入框。
      if (isHistoryKey(e) && inContentInput(e.target)) { e.stopImmediatePropagation(); return; }
      if (isHistoryKey(e)) { e.preventDefault(); e.stopImmediatePropagation(); cancel(); return; }
      if (e.key === 'Escape') cancel();
    };
    doc.addEventListener('pointerdown', onCanvasDown, true);
    document.addEventListener('pointerdown', onPageDown, true);
    window.addEventListener('keydown', onKey, true);
    if (win && win !== window) win.addEventListener('keydown', onKey, true);
    return () => {
      if (timer) clearTimeout(timer);
      win?.removeEventListener('pointerup', afterUp, true);
      win?.removeEventListener('pointercancel', finish, true);
      doc.removeEventListener('pointerdown', onCanvasDown, true);
      document.removeEventListener('pointerdown', onPageDown, true);
      window.removeEventListener('keydown', onKey, true);
      if (win && win !== window) win.removeEventListener('keydown', onKey, true);
    };
  }, [id, doc]);

  // 弹层自己的键盘事件截在元素上（原生，同 #1683）：Esc 收起，其余不往画布 document 冒。
  // 🔴 格子上的 Enter / 空格也在这里接（#1712）：React 的 onKeyDown 挂在 portal 容器（画布 body）上，在这一层被截住之后
  //    它收不到 —— 写在 JSX 里的 onKeyDown 永远不会跑。
  useEffect(() => {
    const el = boxRef.current;
    if (!el) return;
    const stop = (e: KeyboardEvent) => {
      if (isHistoryKey(e)) return; // 撤销键已经在 window 捕获阶段处理过
      e.stopPropagation();
      if (e.type !== 'keydown') return;
      if (e.key === 'Escape') { uiRef.current?.cancelDesign(); return; }
      const t = e.target as HTMLElement | null;
      if ((e.key === 'Enter' || e.key === ' ') && t && t.hasAttribute('data-editor-design-preset')) {
        e.preventDefault(); // 空格不滚动
        if (t.getAttribute('aria-disabled') !== 'true') uiRef.current?.pickDesign(t.getAttribute('data-editor-design-preset') || '');
      }
    };
    for (const t of ['keydown', 'keyup', 'keypress'] as const) el.addEventListener(t, stop);
    return () => { for (const t of ['keydown', 'keyup', 'keypress'] as const) el.removeEventListener(t, stop); };
  });

  // #1725 —— 固定在画布可视区底部、水平居中：底边 = 可视区下沿 − POPOVER_EDGE，横向在可视区中线上，跟块在哪无关 ⟹ 滚动、块变高、
  //   换预设、Layout / Customize 切页都不动。用 CSS `bottom` 定位、变换原点在左下角 ⟹ 内容多高底边都钉在那儿，不用量弹层多高
  //   （#1708 那个「量自然高 → 定 maxHeight → 又改了自然高」来回抖的环没有了，1.5px 防抖跟着删掉）。
  //   高：上限 = 可视区高的 POPOVER_MAX_VH，不低于 POPOVER_MIN_H；可视区比那还矮就贴满可视区（上下各留 POPOVER_EDGE）。
  //   下面的量全是画布 document 的 CSS px（弹层按 1/zoom 放大，它自己的 px 要 /zoom 换过来）。
  // 打开那一刻（弹层第一次画出来之后那一帧）块的下沿落在弹层顶边之下 ⟹ 把画布滚到块顶贴可视区顶，只滚这一次，之后老板自己滚。
  //   用画布 window 的 scrollTo，不用 scrollIntoView：后者连编辑器页上的祖先滚动容器一起滚。
  // 页尾的块（r2）：画布已经滚到底时上面那一下没地方可滚 ⟹ 弹层开着时在页面内容最底下垫一段空白，高 = 弹层封顶高 + 底边
  //   （≥ 弹层顶边到可视区下沿那段，切页 / 换预设弹层变矮也不用跟着缩，不会把滚到底的画布往回拽）。它是编辑器直接插进画布 DOM 的，
  //   不在 Puck 的数据里 ⟹ 不进页面 JSON、不进发布的站；弹层一关（这个 effect 清理）就拿掉。
  //   🔴 不能是 body 末尾的一个普通 div：Puck 的 `#frame-root` 只有一屏高，页面内容是溢出去的 ⟹ 普通 div 落在一屏处，
  //   scrollHeight 一点不涨。所以它是绝对定位、每帧把顶边对到 `#frame-root` 内容的底（块变高了跟着往下挪），它自己不在 frame-root 里。
  //   🔴 空白要在 scrollTo 之前写进 DOM（同一帧、同步写 style）：反了 scrollTo 会被旧的 scrollHeight 夹住。
  useEffect(() => {
    if (!id) { setPos(null); return; }
    const win = doc.defaultView!;
    let raf = 0;
    let revealed = false;
    const spacer = doc.createElement('div');
    spacer.setAttribute('data-editor-popover-spacer', '');
    spacer.setAttribute('aria-hidden', 'true');
    spacer.style.cssText = 'position:absolute;left:0;top:0;width:1px;height:0;margin:0;padding:0;border:0;visibility:hidden;pointer-events:none';
    doc.body.appendChild(spacer);
    const content = doc.getElementById('frame-root') || doc.body;
    const tick = () => {
      const frame = win.frameElement as HTMLElement | null;
      const zoom = frame && win.innerWidth ? (frame.getBoundingClientRect().width / win.innerWidth) || 1 : 1;
      const vh = win.innerHeight;
      const edge = POPOVER_EDGE / zoom;
      const h = Math.min(Math.max(vh * POPOVER_MAX_VH, POPOVER_MIN_H / zoom), vh - 2 * edge);
      const maxH = Math.max(1, Math.floor(h * zoom));
      // #1727 —— 宽（弹层自己的 px）：最宽 POPOVER_W，画布可视区放不下就缩到可视区宽 − 两边各 POPOVER_EDGE；横向仍以可视区中线为准（#1725）。
      const w = Math.max(1, Math.min(POPOVER_W, Math.floor((win.innerWidth - 2 * edge) * zoom)));
      const left = win.innerWidth / 2 - w / zoom / 2;
      const scale = 1 / zoom;
      setPos((p) => (p && p.bottom === edge && p.left === left && p.scale === scale && p.maxH === maxH && p.w === w ? p : { bottom: edge, left, scale, maxH, w }));
      const pad = `${Math.ceil(h + edge)}px`;
      if (spacer.style.height !== pad) spacer.style.height = pad;
      // 顶边（画布 document 坐标）= 内容的底；按 spacer 自己现在在哪校正，不用管它的定位祖先是谁。
      const off = content.getBoundingClientRect().top + content.scrollHeight - spacer.getBoundingClientRect().top;
      if (Math.abs(off) >= 0.5) spacer.style.top = `${(parseFloat(spacer.style.top) || 0) + off}px`;
      const box = boxRef.current;
      if (!revealed && box && box.style.visibility === 'visible') {
        revealed = true;
        const el = designTargetEl(doc, id);
        const r = el ? el.getBoundingClientRect() : null;
        if (r && r.bottom > box.getBoundingClientRect().top) win.scrollTo({ top: win.scrollY + r.top, behavior: 'instant' });
      }
      raf = win.requestAnimationFrame(tick);
    };
    raf = win.requestAnimationFrame(tick);
    return () => { win.cancelAnimationFrame(raf); spacer.remove(); };
  }, [id, doc]);
  // #1738 r4 —— Layout 页内容区真实的宽（clientWidth − 左右 padding）。浏览器显示常规滚动条时（Windows、Mac 接鼠标）它比按弹层宽
  //   推出来的窄一条滚动条宽（常见 15px）；顶栏 / 页脚一行一张、格子占满内容区，按推出来的宽画就横着溢出、右边被裁（QA2 r3 量到的）。
  //   只有顶栏 / 页脚用它；页面块照旧按弹层宽推（下面 §innerW）。Layout 页不在时（切到 Customize）读回 0。
  const [layEl, setLayEl] = useState<HTMLDivElement | null>(null);
  const [layInnerW, setLayInnerW] = useState(0);
  useLayoutEffect(() => {
    if (!layEl) { setLayInnerW(0); return; }
    const read = () => setLayInnerW(Math.max(0, layEl.clientWidth - 2 * POPOVER_PAD));
    read();
    const RO = (layEl.ownerDocument.defaultView as (Window & typeof globalThis) | null)?.ResizeObserver;
    if (!RO) return;
    const ro = new RO(read);
    ro.observe(layEl);
    return () => ro.disconnect();
  }, [layEl]);

  if (!ui || !api || !id || leaving || (!item && !(region && rootProps))) return null;
  const vw = doc.defaultView ? doc.defaultView.innerWidth : 1280;
  const halt = (e: { stopPropagation: () => void }) => e.stopPropagation();
  // #1755 —— 按钮弹窗：画布上点了一颗按钮（InlineEdit §onClick → `openDesign(id, 'button', 'ctas.1')`）。改的是这一块那一列里的那一项，
  //    每一下经 §changeDesign 整列换掉（不记历史、画布当场变）；Done / Cancel、点外面 / Esc / 撤销键 = Cancel，全跟 Design 面板同一套。
  //    判据取 `designStart`（跟 `design` 同一次 setState 里定），不取 `tab`：`tab` 要等下面那个 effect 才跟上，第一帧会画成 Layout。
  if (start && start.tab === 'button' && item) {
    const m = /^(.*)\.(\d+)$/.exec(start.focus || '');
    const props = item.props as ItemProps;
    const slot = m ? m[1] : '';
    const index = m ? Number(m[2]) : -1;
    const list = m && Array.isArray(props[slot]) ? (props[slot] as unknown[]) : [];
    const cur = list[index];
    if (!cur || typeof cur !== 'object' || Array.isArray(cur)) return null;
    const locks = (item as { readOnly?: Record<string, boolean> }).readOnly || {};
    const readOnly = !!locks[slot] || !!locks[`${slot}[*].href`];
    return createPortal(
      <div ref={boxRef} data-editor-popover="" data-editor-button-dialog="" data-editor-popover-for={id} data-editor-button-for={start.focus} role="dialog" aria-label="Button"
        onClick={halt} onPointerDown={halt} onMouseDown={halt} onPointerUp={halt} onMouseUp={halt} onDoubleClick={halt}
        {...EDITOR_LIGHT} style={{ ...EDITOR_LIGHT_STYLE, ...POPOVER, width: pos ? pos.w : POPOVER_W, bottom: pos ? pos.bottom : -10000, left: pos ? pos.left : 0, transform: `scale(${pos ? pos.scale : 1})`, maxHeight: pos ? pos.maxH : 560, visibility: pos ? 'visible' : 'hidden' }}>
        <div data-editor-button-title="" style={{ padding: '12px 16px 0', fontSize: 16, fontWeight: 600, color: '#101828' }}>Button</div>
        <div data-editor-button-body="" style={{ padding: POPOVER_PAD, overflowY: 'auto' }}>
          <ButtonEditor item={cur as Record<string, unknown>} readOnly={readOnly} site={api.site} locale={api.locale}
            onChange={(next) => { const nl = list.slice(); nl[index] = next; ui.changeDesign(slot, nl); }} />
        </div>
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, padding: '10px 12px', borderTop: '1px solid #eaecf0' }}>
          <button type="button" data-editor-design-cancel="" onClick={() => ui.cancelDesign()}
            style={{ ...POPOVER_BTN, border: '1px solid #d0d5dd', background: '#fff', color: '#344054' }}>Cancel</button>
          <button type="button" data-editor-design-done="" onClick={() => ui.doneDesign()}
            style={{ ...POPOVER_BTN, border: 0, background: '#1d4ed8', color: '#fff' }}>Done</button>
        </div>
      </div>,
      doc.body,
    );
  }
  // 两支（页面块 / 顶栏页脚）各自算出：Layout 页每一格画什么、亮哪一格、Customize 页画什么、有哪几页、Content 页画什么。
  let presets: NonNullable<EditorField['presets']>;
  let current: string;
  let readOnly: boolean;
  let thumb: (p: NonNullable<EditorField['presets']>[number], i: number) => ReactNode;
  let customize: ReactNode;
  let content: ReactNode = null;
  let ai: ReactNode = null;
  let tabs: DesignTab[] = ['layout', 'customize', 'content', 'ai'];
  if (region && rootProps) {
    // #1738 —— 顶栏 / 页脚。缩略图 = 「选这个预设之后它会长成的样子」：同一个 §ShellRegion（外壳那条 data 路径），形态 + 旋钮按
    //   `region-options.js` §regionPresetPick 算（同 §pickDesign）。Customize 页的旋钮只出 §customizeKnobNames（页脚的 layout 就是预设，
    //   在 Layout 页选）；值给的是实际生效的那一组（形态给底 + 存下的盖上去），亮哪一格才对得上画布。拧一下交给 §changeDesign 的是
    //   「哪一格 → 什么值」，耦合的纠正在那边做。Content 页归 B 票（#1738 正文「不做」），这里只有两页。
    const spec = ui.regionDesign[region];
    const f = spec.preset;
    if (!f) return null;
    const k = REGION_ROOT[region];
    const shape = String(rootProps[k.shape] || '');
    const opts = asOptions(rootProps[k.options]);
    const site = api.site;
    presets = f.presets || [];
    current = regionPresetName(region, shape, opts);
    readOnly = false;
    // #1759 —— 顶栏多一页 Content（logo · 名字 · 菜单 · 两颗按钮）；页脚照旧两页（正文「不做」）。
    tabs = region === 'header' ? ['layout', 'customize', 'content'] : ['layout', 'customize'];
    if (region === 'header') content = <HeaderContent props={rootProps} ui={ui} site={site} />;
    thumb = (p) => {
      const pick = regionPresetPick(region, p.name, opts);
      return <ShellRegion site={site} locale={api.locale} region={region} shape={pick ? pick.shape : p.shape} options={pick ? pick.options : opts} />;
    };
    const { bg: bgValue, ...knobOpts } = opts;
    const knobV = { ...knobOpts, ...effectiveRegionKnobs(region, shape, opts) };
    const shown = customizeKnobNames(region);
    const knobField = { ...f, knobs: (f.knobs || []).filter((x) => shown.includes(x.name)) } as EditorField;
    customize = (
      <>
        <KnobControls f={knobField} value={knobV} onChange={(v) => {
          const key = Object.keys(v).find((x) => v[x] !== knobV[x]);
          if (key) ui.changeDesign(key, v[key]);
        }} />
        {spec.bg ? (
          <div data-editor-design-bg="">
            <div style={SUB_LABEL}>Background</div>
            <ColorField f={spec.bg} value={bgValue} onChange={(v) => ui.changeDesign('bg', v)} />
          </div>
        ) : null}
      </>
    );
  } else {
    const component = item ? api.components.get(item.type) : undefined;
    const { preset: f, bg } = component ? designSlotsOf(component) : { preset: undefined, bg: undefined };
    if (!item || !component || !f) return null;
    const props = item.props as ItemProps;
    const options = (props[f.slot] && typeof props[f.slot] === 'object' ? props[f.slot] : {}) as OptionsValue;
    const locks = (item as { readOnly?: Record<string, boolean> }).readOnly || {};
    const pageSlug = api.page === 'home' ? undefined : api.page;
    presets = f.presets || [];
    current = presetNameOf(f, options, props);
    readOnly = !!locks[f.slot];
    thumb = (p, i) => {
      const thumbProps = { ...presetClickProps(f, props, p.name), id: `${id}~design-${i}` } as ItemProps;
      return <CanvasBlockBody component={component} props={thumbProps} locale={api.locale} pageSlug={pageSlug} site={api.site} />;
    };
    // #1708 —— 这一块的旋钮 + 开关 + 背景：右栏画的同一份控件（§KnobControls / §ColorField），改动交给 §changeDesign。
    customize = (
      <>
        <KnobControls f={f} value={options} onChange={(v) => ui.changeDesign(f.slot, v)} readOnly={readOnly} />
        {bg ? (
          <div data-editor-design-bg="">
            <div style={SUB_LABEL}>Background</div>
            <ColorField f={bg} value={props[bg.slot]} onChange={(v) => ui.changeDesign(bg.slot, v)} readOnly={!!locks[bg.slot]} />
          </div>
        ) : null}
      </>
    );
    // #1735 —— 这一块的内容字段（右栏那一份，去掉另两页已有的）。
    content = <DesignContent component={component} item={item as { type: string; props: ItemProps }} ui={ui} readOnly={locks} />;
    ai = (
      <DesignAi ui={ui} item={item as { type: string; props: ItemProps }}
        rounds={designAiRounds(ui.chat ? ui.chat.messages : [], aiSession.water, aiSession.sent)} sentAny={aiSession.sent.length > 0}
        onSent={(t) => setAiSession((x) => ({ ...x, sent: [...x.sent, t] }))} />
    );
  }
  // #1722 —— 两列各自往下堆：第 1、3、5 个在左列，第 2、4 个在右列，每格紧接着同一列的上一格。DOM 顺序仍是预设顺序
  //    （= Tab 顺序，键盘走的是阅读顺序），位置按算术摆。上限是画布 document 的 px，格子画在按 1/zoom 放大过的弹层里 ⟹ 除回去。
  const cap = Math.floor((THUMB_MAX_VH * (doc.defaultView ? doc.defaultView.innerHeight : 800)) / (pos ? pos.scale : 1));
  // #1727 —— 弹层窄到放不下两列（画布 Small 那一档）就退成一列，格子照样各自往下堆。
  const innerW = (pos ? pos.w : POPOVER_W) - 2 * (POPOVER_PAD + POPOVER_BORDER);
  // #1738 r3 —— 顶栏 / 页脚：一行一张、占满内容区，排版宽 REGION_THUMB_LAYOUT_W（见那个常量；#1764 起画布再窄也是它）。
  //   r4：内容区宽用量到的那个（§layInnerW，扣掉了滚动条）；还没量到的那一帧先按弹层宽推。
  const thumbW = region ? Math.max(1, layInnerW || innerW) : THUMB_W;
  const layW = region ? REGION_THUMB_LAYOUT_W : vw;
  const cols = region ? 1 : innerW >= 2 * THUMB_W + THUMB_GAP ? 2 : 1;
  const colH = cols === 2 ? [0, 0] : [0];
  const cells = presets.map((p, i) => {
    const measured = bodyH[`${id}:${i}`];
    const full = measured ? Math.round((measured * thumbW) / layW) : THUMB_H;
    const h = Math.min(full, cap);
    const col = i % cols;
    const top = colH[col];
    colH[col] += h + 6 + THUMB_NAME_H + THUMB_GAP;
    return { p, i, h, clipped: full > cap, top, left: col * (thumbW + THUMB_GAP) };
  });
  const layoutH = Math.max(0, Math.max(...colH) - THUMB_GAP);
  const shownTab = tabs.includes(tab) ? tab : 'layout';
  // #1757 —— AI 在改这一页 / 撤回进行中：前三页灰掉（那期间画布换成别处的一份，前三页的试看没有落脚处，正文做什么 6b）。
  const tabsLocked = ui.locked || !!ui.chat?.reverting;

  return createPortal(
    <div ref={boxRef} data-editor-popover="" data-editor-popover-for={id} role="dialog" aria-label="Design"
      onClick={halt} onPointerDown={halt} onMouseDown={halt} onPointerUp={halt} onMouseUp={halt} onDoubleClick={halt}
      {...EDITOR_LIGHT} style={{ ...EDITOR_LIGHT_STYLE, ...POPOVER, width: pos ? pos.w : POPOVER_W, bottom: pos ? pos.bottom : -10000, left: pos ? pos.left : 0, transform: `scale(${pos ? pos.scale : 1})`, maxHeight: pos ? pos.maxH : 560, visibility: pos ? 'visible' : 'hidden' }}>
      <div role="tablist" style={{ display: 'flex', gap: 4, padding: '10px 12px 0', borderBottom: '1px solid #eaecf0' }}>
        {tabs.map((t) => (
          <button key={t} type="button" role="tab" aria-selected={shownTab === t} data-editor-design-tab={t} onClick={() => setTab(t)}
            disabled={t !== 'ai' && t !== shownTab && tabsLocked} style={{ ...popoverTab(shownTab === t), ...(t !== 'ai' && t !== shownTab && tabsLocked ? { opacity: 0.4, cursor: 'default' } : {}) }}>
            {DESIGN_TAB_LABEL[t]}
          </button>
        ))}
      </div>
      {shownTab === 'ai' ? (
        <div data-editor-design-ai="" style={{ padding: POPOVER_PAD, display: 'flex', flexDirection: 'column', minHeight: 0, flex: 1 }}>
          {ai}
        </div>
      ) : shownTab === 'content' ? (
        // #1735 —— 超高在页内滚（面板封顶高见 §tick）。
        <div data-editor-design-content="" style={{ padding: POPOVER_PAD, overflowY: 'auto' }}>
          {content}
        </div>
      ) : shownTab === 'customize' ? (
        <div data-editor-design-customize="" style={{ padding: POPOVER_PAD, overflowY: 'auto' }}>
          {customize}
        </div>
      ) : (
      // #1738 r4 —— 顶栏 / 页脚这一页给滚动条常留位置（scrollbarGutter: stable）：格子宽跟着内容区宽走，滚动条忽有忽无的话，
      //   格子变宽 → 变高 → 滚动条出来 → 格子变窄 → 变矮 → 滚动条没了，会在临界高度上来回跳。页面块不改（它的格子宽是定的）。
      <div ref={setLayEl} data-editor-design-layout="" style={{ padding: POPOVER_PAD, overflowY: 'auto', ...(region ? { scrollbarGutter: 'stable' } : null) }}>
        <div style={{ position: 'relative', width: cols * thumbW + (cols - 1) * THUMB_GAP, height: layoutH, margin: '0 auto' }}>
          {cells.map(({ p, i, h, clipped, top, left }) => {
            const on = current === p.name;
            const key = `${id}:${i}`;
            return (
              // 🔴 格子不是 <button>：缩略图里的块自己就有按钮，按钮套按钮是不合法的 HTML（React 当场报两条错）。
              <div key={p.name} role="button" tabIndex={readOnly ? -1 : 0} aria-disabled={readOnly || undefined} data-editor-design-preset={p.name} aria-pressed={on}
                onClick={() => { if (!readOnly) ui.pickDesign(p.name); }}
                style={{ position: 'absolute', top, left, width: thumbW, display: 'flex', flexDirection: 'column', gap: 6, cursor: readOnly ? 'default' : 'pointer', outlineOffset: 2 }}>
                <div data-editor-design-thumb="" style={{ width: thumbW, height: h, overflow: 'hidden', borderRadius: 8, position: 'relative', background: '#fff',
                  boxShadow: on ? '0 0 0 2px #1d4ed8' : '0 0 0 1px #d0d5dd' }}>
                  <DesignThumbBody vw={layW} thumbW={thumbW} wide={!!region} onHeight={(v) => setBodyH((m) => (m[key] === v ? m : { ...m, [key]: v }))}>
                    {thumb(p, i)}
                  </DesignThumbBody>
                  {clipped ? (
                    <div data-editor-design-thumb-fade="" aria-hidden="true"
                      style={{ position: 'absolute', left: 0, right: 0, bottom: 0, height: 40, background: 'linear-gradient(rgba(255, 255, 255, 0), #fff)', pointerEvents: 'none' }} />
                  ) : null}
                </div>
                <span style={{ height: THUMB_NAME_H, lineHeight: `${THUMB_NAME_H}px`, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                  fontSize: 12, fontWeight: on ? 600 : 500, color: on ? '#1d4ed8' : '#344054' }}>{p.name}</span>
              </div>
            );
          })}
        </div>
      </div>
      )}
      {ui.designError ? (
        <p data-editor-design-error="" role="alert" style={{ margin: 0, padding: '8px 12px 0', fontSize: 13, color: '#b42318' }}>{ui.designError}</p>
      ) : null}
      {shownTab !== 'ai' && <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, padding: '10px 12px', borderTop: '1px solid #eaecf0' }}>
        <button type="button" data-editor-design-cancel="" onClick={() => ui.cancelDesign()}
          style={{ ...POPOVER_BTN, border: '1px solid #d0d5dd', background: '#fff', color: '#344054' }}>Cancel</button>
        <button type="button" data-editor-design-done="" onClick={() => ui.doneDesign()}
          style={{ ...POPOVER_BTN, border: 0, background: '#1d4ed8', color: '#fff' }}>Done</button>
      </div>}
    </div>,
    doc.body,
  );
}

/**
 * #1658 —— 右栏每个顶层字段外面包一层 `data-editor-field="<slot 名>"`（Edit content 和 e2e 都靠它找；Puck 只给子字段 id）。
 * 挂在 Puck 的 `fields` override 上：它拿到的子元素就是一字段一个、按字段名的那一列（dist §FieldsInternal 的 `fieldNames.map`）。
 * 包一层会让 Puck 那条 `.field + .field` 分隔线选择器失效 ⟹ §FIELD_MARK_CSS 补一条等价的，右栏样子不变。
 */
function EditorFields({ children }: { children?: ReactNode }) {
  return (
    <>
      {Children.map(children, (c) => {
        const name = isValidElement(c) ? (c.props as { fieldName?: unknown }).fieldName : undefined;
        return typeof name === 'string' ? <div data-editor-field={name}>{c}</div> : c;
      })}
    </>
  );
}
// Puck 原来那条：`.PuckFields--wrapFields .PuckFields-field + .PuckFields-field { border-top; margin-top }`。包一层之后两个
// field 不再是兄弟 ⟹ 照「前面有过一个真画出来的字段」重写（Puck 不画的字段 FieldsChild 返回 null，包着的 div 是空的）。
// 最后一条：编辑器页也加载了网站的 Bootstrap，reboot 把 `label` 设成 inline-block，Puck 包着输入框 / 下拉的 `<label>` 缩成字宽 ⟹
//    右栏的输入框跟着变窄；还原成块（Chris 2026-10-13；底部面板那一半在 §BLOCKBAR_CSS）。
const FIELD_MARK_CSS = `
[class*="PuckFields--wrapFields"] [data-editor-field]:has(> [class*="PuckFields-field_"]) ~ [data-editor-field] > [class*="PuckFields-field_"] {
  border-top: var(--puck-border-width-regular) solid var(--puck-color-border);
  margin-top: var(--puck-space-2);
}
[class*="PuckFields"] label { display: block; }`;

const EDITOR_OVERRIDES = { header: EditorNotes, headerActions: EditorHeaderActions, puck: EditorShell, iframe: CanvasLinkGuard, actionBar: PuckActionBarSlot, fields: EditorFields };
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
 *   撤销 / 前进 ⟹ 不在 `permissions` 里。#1741 起按钮在 dashboard 顶栏：锁着时那两颗是灰的（§HistoryReport 报的
 *     canUndo / canRedo），发进来的消息也不认（§requestHistory）。快捷键是 Puck 在编辑器页和画布 iframe 两个 document 上
 *     **冒泡阶段**收的 keydown（`monitorHotkeys(document)` / `monitorHotkeys(frameDoc)`）⟹ 在两个 window 上挂**捕获阶段**的
 *     监听，锁着时拦下（§useAiLockGuard）。
 * 📌 两个 permissions 对象是模块级常量：Puck 按对象身份判「换了没有」（`useRegisterPermissionsSlice` 的 deps）。
 */
const OPEN_PERMISSIONS = { drag: true, duplicate: true, delete: true, edit: true, insert: true };
const LOCKED_PERMISSIONS = { drag: false, duplicate: false, delete: false, edit: false, insert: false };
// #1743 —— Content 页（§DesignContent）里能打字的那几样：文字框 / 多行框（含 richtext）/ contenteditable。
function inContentInput(t: EventTarget | null): boolean {
  if (!t || typeof (t as Element).closest !== 'function') return false;
  const el = t as HTMLElement;
  // #1755 —— 按钮弹窗里的 Button label / 网址 / 号码同一条（票正文做什么 7：Ctrl+Z 只撤框里的字，不关弹窗）。
  // #1757 —— AI 页的输入框同一条（正文做什么 8）。
  if (!el.closest('[data-editor-design-content], [data-editor-button-dialog], [data-editor-design-ai]')) return false;
  return el.tagName === 'TEXTAREA' || el.isContentEditable
    || (el.tagName === 'INPUT' && !['checkbox', 'radio', 'button', 'submit', 'reset', 'range', 'color', 'file', 'image', 'hidden'].includes((el as HTMLInputElement).type));
}

function isHistoryKey(e: KeyboardEvent): boolean {
  if (!(e.ctrlKey || e.metaKey)) return false;
  return e.code === 'KeyZ' || e.code === 'KeyY';
}

function useAiLockGuard(locked: boolean) {
  useEffect(() => {
    if (!locked) return;
    const stop = (e: Event) => { e.preventDefault(); e.stopImmediatePropagation(); };
    const onKey = (e: KeyboardEvent) => { if (isHistoryKey(e)) stop(e); };
    const wins: Window[] = [window];
    const frame = document.querySelector('iframe#preview-frame') as HTMLIFrameElement | null;
    if (frame?.contentWindow && frame.contentWindow !== window) wins.push(frame.contentWindow);
    for (const w of wins) w.addEventListener('keydown', onKey, true);
    return () => { for (const w of wins) w.removeEventListener('keydown', onKey, true); };
  }, [locked]);
}

/**
 * #1453 —— 存盘状态（#1741 起住在画布上方那条细条里，§EditorNotes）。「Saving… / All changes saved」说在 dashboard 的顶栏上（它知道这一笔到底落没落盘），
 * 这里只在**没存上**时说话，并给一颗「再试一次」。`data-editor-status` 一直在（不显示也在），给验收读这一侧的状态。
 * `hideError`：画布底部那条浮条（§Kept）已经在说为什么没存、该怎么办，这里不再说第二遍。
 */
function SaveStatus({ status, onRetry, hideError }: { status: Status; onRetry: () => void; hideError: boolean }) {
  const show = status.kind === 'error' && !hideError;
  return (
    <span data-editor-status={status.kind} style={{ ...(show ? NOTE_PAD : {}), display: 'inline-flex', alignItems: 'center', gap: 8 }}>
      {show && <span style={{ fontSize: 13, color: '#b42318' }}>{status.text}</span>}
      {show && (
        <button type="button" data-editor-retry onClick={onRetry} style={{ padding: '4px 10px', borderRadius: 6, border: '1px solid #b42318', background: '#fff', color: '#b42318', fontSize: 13, cursor: 'pointer' }}>
          Try again
        </button>
      )}
    </span>
  );
}

export default function EditorApp({ site, iconTables, locale, page, raw, baseHash, schema, initialData, trustedOrigin, siteBlocks, refs, slugs, pages, forms = [] }: EditorAppProps) {
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
  // #1676 —— `aiUsed` / `dragged`：这一笔的记录用掉了哪几条 AI 说明、前几次拖动 —— 存上了才清（被拒就留到下一笔）。
  // #1759 —— `navMenu` / `navPage`：这一笔交了菜单改动时，交出去那一刻的面板菜单和这一页那两格（成功后比较基准换成它，§onMessage `saved`）。
  const sendingRef = useRef<{ json: Record<string, unknown> | null; root: Record<string, unknown> | null; shared: SharedChanges | null; forms?: FormCopyEdit | null; aiUsed?: AiNote[]; dragged?: number; navMenu?: NavPanel; navPage?: NavChange | null } | null>(null);
  // #1676 —— 记录说人话要的两样（`editor-convert.js` §describeSave）：AI 按钮改过哪几格（§recordAiNote，作废规矩在那份文件里）、
  // 老板拖过哪几块（块键，最后拖的在最后；相邻两块对调时据它说是谁动了）。换一份新画布时跟 movedRef 一起清。
  const aiNotesRef = useRef<AiNotes>({});
  const draggedRef = useRef<string[]>([]);
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
  // #1713 —— 画布图上的 Regenerate 在等 dashboard 生成：同一把锁（期间别处改不了，§regenerateImage）。
  const [regenerating, setRegenerating] = useState(false);
  const locked = chatPending || !!chat?.busy || regenerating;
  useAiLockGuard(locked);
  // #1713 —— 不算 Regenerate 的那一半：生成回来那一刻要马上存，等不到下一次渲染把 lockedRef 改回来。
  const chatLockRef = useRef(false);
  chatLockRef.current = chatPending || !!chat?.busy;
  // #1448 —— 换页那次握手在 message 监听里读它（监听只在 page / locale 变时重挂，读 state 会读到旧值）。
  const lockedRef = useRef(locked);
  lockedRef.current = locked;
  // #1741 —— dashboard 顶栏的撤销 / 前进（`ai1st:undo` / `ai1st:redo`）。监听只挂一次，按下去时要的是那一刻的规矩 ⟹ 每次渲染换新（§requestHistory）。
  const historyReqRef = useRef<(dir: 'undo' | 'redo') => void>(() => {});
  // 上一次报给 dashboard 的那两个值：没变就不再发（每次重渲染都会跑到 §HistoryReport 的 effect 依赖之外的地方）。
  const historySentRef = useRef('');
  // #1448 —— dashboard 要换页、在等手上这一笔落盘（`sending` 同 pendingChatRef：只认那一笔自己的 `saved` 底稿）。
  const pendingLeaveRef = useRef<{ id: string; sending: object } | null>(null);
  // #1657 —— 画布上正在打的那一格（§InlineFreezeContext）；在等 AI 改写回话的那几次（id → 回话交给谁）。
  const [freeze, setFreeze] = useState<InlineFreeze>(null);
  const rewritesRef = useRef(new Map<string, (r: RewriteResult) => void>());
  // #1693 —— 正在等的那一次选图（同一时刻只有一次）。
  const pickRef = useRef<{ id: string; done: (r: PickImageResult) => void } | null>(null);
  // #1771 —— 同 pickRef 非空（在等换图弹窗回话），给 §anyDialogOpen 用：ref 变了不重画。
  const [picking, setPicking] = useState(false);
  // #1713 —— 正在等的那一次 Regenerate（同一时刻只有一次：等的时候画布锁着）。
  const regenRef = useRef<{ id: string; done: (r: RegenerateResult) => void } | null>(null);
  // #1711 —— dashboard 在底稿里带来的行业（选图弹窗 Generate 的默认提示词要它）；没送来 = ''，那一句里就省掉它。
  const industryRef = useRef('');
  // #1660 —— 正在等 AI 写字的新块（画布上那枚标）；没写成时顶栏那一句。
  const [filling, setFilling] = useState<ReadonlySet<string>>(new Set());
  const [fillNote, setFillNote] = useState<string | null>(null);
  const componentsByType = useMemo(() => new Map(schema.components.map((c) => [c.type, c])), [schema]);

  // #1700 —— Design 弹层开着的那一块：打开那一刻这一块的 props（Cancel 退回到它，Done 跟它比有没有改）。
  const designRef = useRef<{ id: string; before: Record<string, unknown> } | null>(null);
  const [design, setDesign] = useState<string | null>(null);
  // #1759 —— 顶栏 Content 页 Done 被拦下时那一句（§doneDesign）。开 / 关面板、再改一下都清掉。
  const [designError, setDesignError] = useState('');
  // #1735 —— 打开时停哪一页（Design 按钮 = Layout，Edit content = Content）。
  const [designStart, setDesignStart] = useState<{ tab: DesignTab; focus?: string; n: number }>({ tab: 'layout', n: 0 });
  // #1757 —— 面板此刻停在哪一页（ref 给 message 监听 / effect 读）；从 AI 页发出去的那一句的那句话（§noteSend）。
  const [designTab, setDesignTabState] = useState<DesignTab>('layout');
  const designTabRef = useRef<DesignTab>('layout');
  const setDesignTab = (t: DesignTab) => { designTabRef.current = t; setDesignTabState(t); };
  const [designNotice, setDesignNotice] = useState<{ kind: 'info' | 'error'; text: string } | null>(null);
  // 手上这一次发送是不是从面板的 AI 页发的（它的「没发成」也要在面板里说一遍）。
  const chatFromPanelRef = useRef(false);

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
  //   design = Design 弹层开着（#1700）：弹层里点的预设只是试看，Done 才算数（§openDesign）
  const holdReason = (): 'kept' | 'ai' | 'design' | '' => (keptRef.current ? 'kept' : lockedRef.current ? 'ai' : designRef.current ? 'design' : '');
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
    // #1687 —— 没有要存的了（被拒的那一笔又改回了原样）：红字和「Try again」只有下一笔存盘才换得掉，而这里不会再有那一笔 ⟹ 复位。
    else setStatus((s) => (s.kind === 'error' ? { kind: 'idle', text: '' } : s));
  }
  // §reportPending 上一次递出去的是什么（一样就不重复递）。
  const pendingKeyRef = useRef('');
  const onCanvasChangeRef = useRef<(d: Data) => void>(() => {});
  onCanvasChangeRef.current = (d) => { if (!sendingRef.current) reportPending(d); scheduleAutosave(); };
  // 身份不变：它经 context 递给 §Autosave，换身份只会多一次无用的重订阅。
  const onCanvasChange = useMemo(() => (d: Data) => onCanvasChangeRef.current(d), []);
  useEffect(() => {
    // #1700 —— AI 开始改这一页：弹层里试看的那一下退回（规矩同别的出口）。#1757 —— 面板停在 AI 页（那一句就是从那儿发的）⟹ 不关（§designOnAi）。
    if (locked && !designOnAi()) cancelDesign();
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
        industry?: unknown; // #1711 —— dashboard 带来的行业（选图弹窗 Generate 的默认提示词）
        nav?: unknown; // #1759 —— 顶栏 Content 页的菜单（站里 `editor-nav.js` §navMenuOf，盘上现值）
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
          noteSend({ kind: 'error', text: `Your message was not sent. ${text || 'Your changes could not be saved first.'}` }, true);
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
      if (d.type === 'ai1st:undo' || d.type === 'ai1st:redo') {
        historyReqRef.current(d.type === 'ai1st:undo' ? 'undo' : 'redo');
        return;
      }
      if (d.type === 'ai1st:editor-flush') {
        // #1453 QA2 r1 —— dashboard 那一页要被刷新 / 关掉：不等停手，现在就存（浮条在问的时候照样不替他选）。
        // #1700 —— 弹层里试看的那一下不算：先退回再存（存的是弹开之前就有、还没存的那些）。
        cancelDesign();
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
      if (d.type === 'ai1st:ai-rewrite-result' || d.type === 'ai1st:ai-fill-block-result') {
        // #1657 —— 只认手上在等的那一次（id 对得上）；回来的字段逐个按形状收。#1660 的新块那一次形状相同，等它的也在这张表里。
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
      if (d.type === 'ai1st:pick-image-result') {
        // #1693 —— 只认手上在等的那一次；地址只收非空字符串（别的形状当失败）。
        // #1733 —— `generated: true` = 选的是弹窗里生成的那张（存盘记录说「生成」，§pickFor）。
        const r = d as { id?: unknown; url?: unknown; cancelled?: unknown; message?: unknown; generated?: unknown };
        const p = pickRef.current;
        if (!p || r.id !== p.id) return;
        pickRef.current = null;
        setPicking(false);
        if (d.ok === true && typeof r.url === 'string' && r.url.trim()) p.done({ ok: true, url: r.url.trim(), ...(r.generated === true ? { generated: true } : {}) });
        else if (r.cancelled === true) p.done({ ok: false, cancelled: true });
        else p.done({ ok: false, message: typeof r.message === 'string' && r.message ? r.message : 'The image could not be chosen. Please try again.' });
        return;
      }
      if (d.type === 'ai1st:ai-image-result') {
        // #1713 —— 只认手上在等的那一次；地址只收非空字符串。
        const r = d as { id?: unknown; url?: unknown; message?: unknown };
        const p = regenRef.current;
        if (!p || r.id !== p.id) return;
        regenRef.current = null;
        if (d.ok === true && typeof r.url === 'string' && r.url.trim()) p.done({ ok: true, url: r.url.trim() });
        else p.done({ ok: false, message: typeof r.message === 'string' && r.message ? r.message : REGENERATE_FAILED });
        return;
      }
      if (d.type === 'ai1st:chat-sent') {
        setChatPending(false);
        noteSend(d.ok === true ? null : { kind: 'error', text: typeof d.message === 'string' && d.message ? d.message : 'Your message was not sent.' });
        return;
      }
      if (d.type !== 'ai1st:editor-baseline') return;
      // 别的页面的底稿不许换进来（扁平站 dashboard 那头的 locale 是空的，只在两边都有时才比）。
      if (d.page !== page) return;
      if (typeof d.locale === 'string' && d.locale && d.locale !== locale) return;
      // #1711 —— 行业是站级的，哪一种底稿带来都记下（只收短字符串：它会拼进提示词）。没带就不动手上那一份。
      if (typeof d.industry === 'string' && d.industry.length <= 100) industryRef.current = d.industry.replace(/[\u0000-\u001f]/g, ' ').trim();
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
        // #1759 —— 菜单那一半进了文件：比较基准换成交出去那一刻的面板菜单；这一页的 navLabel / navOrder 也写进 `raw`
        //    （§puckToPage 从 raw 起算 —— 不换的话下一笔会把这一页的菜单名字悄悄改回去）。
        const initial = sent?.root || sent?.navMenu
          ? { ...b.initial, root: { ...b.initial.root, props: { ...(b.initial.root?.props || {}), ...(sent.root || {}), ...(sent.navMenu ? { navMenu: sent.navMenu } : {}) } } }
          : b.initial;
        const raw = sent?.navPage ? applyPageNav(b.raw, sent.navPage) : b.raw;
        const lib = sent?.shared ? applySharedChanges(b.siteBlocks, sent.shared, page) as Record<string, unknown> : b.siteBlocks;
        const sharedOwn = sent?.shared ? sharedOwnAfter({ initial: b.initial, own: b.sharedOwn, changes: sent.shared }) : b.sharedOwn;
        baseRef.current = { ...b, raw, initial, hash: hashOk ? (d.hash as string) : b.hash, saved: sent?.json || b.saved, siteBlocks: lib, sharedOwn };
        if (sent?.shared) setSharedInfo((x) => ({ ...x, siteBlocks: lib }));
        // #1634 —— 表单文案进了 forms.json：手上的表单库跟着换（下拉和面板下次打开读的是新的），等发的那一笔清掉。
        if (sent?.forms) {
          const edit = sent.forms;
          setFormList((list) => applyFormCopyEdit(list, edit));
          if (pendingFormRef.current === edit) pendingFormRef.current = null;
        }
        // #1676 —— 这一笔进了文件：它的记录说过的那几条 AI 说明、那几次拖动用掉了。
        if (sent?.aiUsed) aiNotesRef.current = settleAiNotes(aiNotesRef.current, sent.aiUsed);
        if (sent?.dragged) draggedRef.current = draggedRef.current.slice(sent.dragged);
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
      // #1700 —— 画布要被别处的一份换掉：弹层里试看的那一下先退回，下面「画布上有没有没存的改动」问的才是老板真改过的。
      // #1757 —— 面板停在 AI 页（正文做什么 6b）：AI 改完 / 撤回落地（`ai` / `external`）不关，换完画布这一笔的底换成新一版里
      //   这一块（§rebaseDesign；新一版里没有这一块就关）。§designOnAi 只在前三页没有试看着的改动时放行 ⟹ 上面那条顾虑不成立。
      //   `open`（重开 / 换页回来）照旧关。
      const holdDesign = d.reason !== 'open' && designOnAi();
      if (!holdDesign) cancelDesign();
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
      next = { ...next, root: d.reason === 'open' ? openRoot(baseRef.current.initial.root, d.root, locale, d.nav) : baseRef.current.initial.root };
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
        aiNotesRef.current = {};
        draggedRef.current = [];
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
        if (holdDesign) rebaseDesign();
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
      aiNotesRef.current = {};
      draggedRef.current = [];
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
        if (holdDesign) rebaseDesign();
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
    const jsonBlocks = puckToPage({ raw: base.raw, data: data as never, initial: base.initial, schema, slug: page, moved: movedRef.current });
    // #1406 —— 共用块改了字 / 从这一页删了（而它的 visibility 列了这一页）：写块库那几处。
    const shared: SharedChanges = puckSharedChanges({ data: data as never, initial: base.initial, siteBlocks: base.siteBlocks, schema, slug: page, own: base.sharedOwn });
    // 跟**上一次存下去的那份**比，不跟打开时比：存过一次之后把字改回原来那句，文件里是改过的那句，
    // 这一笔必须发出去（#1409 QA2 r1 第 2 条，那时靠重载 iframe 解决，#1415 起不再重载）。
    // #1405 —— 外壳三样只交**改过的**那几个字段（跟 `base.initial.root` 逐字段比，做什么 7；它是打开时的值，
    // 每存成功一次就换成刚存下去的值，道理同上）。页面块没改就不交页面：不然一次只改公告条的存盘也要带着
    // 页面底稿去比 baseHash，别处刚改过这一页时它会被无端拒掉。
    const root = puckRootChanges({ initial: base.initial, now: data as never, schema });
    // #1759 —— 菜单：跟打开时（存过就是存下去的那份）的面板菜单比。别的页进 `nav`；这一页的 navLabel / navOrder 并进这一页的 JSON
    //    （同一个文件不许两条路各写一份，`lib/editor-nav.js` 文件头）。
    const navNow = ((data as { root?: { props?: RootProps } }).root?.props || {}).navMenu;
    const navCh = navMenuChanges({ initial: ((base.initial.root as { props?: RootProps } | undefined)?.props || {}).navMenu, now: navNow, slug: page });
    const json = applyPageNav(jsonBlocks, navCh.page);
    const nav = navCh.nav;
    const hasNav = Object.keys(nav).length > 0;
    const navChanged = hasNav || !!navCh.page;
    const pageChanged = !deepEqual(json, base.saved);
    const hasShared = Object.keys(shared).length > 0;
    // #1634 —— 面板里 Done 了、还没交出去的表单文案：它自己就算一笔（只改表单的那一笔不带页面）。
    const forms = pendingFormRef.current;
    if (!pageChanged && Object.keys(root).length === 0 && !hasShared && !forms && !hasNav) return null;
    // #1676 —— 画布上 AI 写的那几格还在不在（后来手改过的说明不用）。
    const { aiNotes, used: aiUsed } = aiNotesForSave(aiNotesRef.current, (data as { content?: unknown[] }).content || []);
    // #1759 —— 记录里说「页面改了什么」只看块那一半（这一页的 navLabel / navOrder 归菜单那一句说，§saveFields）。
    const blocksChanged = !deepEqual(withoutNav(jsonBlocks), withoutNav(base.saved));
    return { base, json, shared, root, pageChanged, blocksChanged, hasShared, forms, nav, hasNav, navChanged, navMenu: navNow, navPage: navCh.page, aiNotes, aiUsed, dragged: draggedRef.current.slice() };
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
    sendingRef.current = {
      json: pageChanged ? json : null, root: Object.keys(root).length ? root : null, shared: hasShared ? shared : null, forms: forms || null, aiUsed: plan.aiUsed, dragged: plan.dragged.length,
      ...(plan.navChanged ? { navMenu: plan.navMenu, navPage: plan.navPage } : {}),
    };
    window.parent.postMessage({ type: 'ai1st:editor-save', ...saveFields(plan) }, trustedOrigin);
    reportPending(null);
    return 'sent';
  }

  /** 一笔存盘消息的正文（`ai1st:editor-save` 与 §reportPending 递的待存那份同一个形状）。 */
  function saveFields(plan: NonNullable<ReturnType<typeof planSave>>): Record<string, unknown> {
    const { base, json, shared, root, pageChanged, blocksChanged, hasShared, forms, nav, hasNav, navChanged, aiNotes, dragged } = plan;
    // #1454 —— 这一笔说人话，manager 拿它写 AI chat 里那条手改记录。🔴 算不出来也照存：它只是说明，不是存盘的一部分。
    let summary = '';
    // #1634 —— 只改了表单文案的那一笔没有页面 / 外壳 / 共用块可说：describeSave 会回一句通用话，那句不要。
    // #1759 —— 只改了这一页的 navLabel / navOrder（菜单）同理：页面那一半不交给 describeSave，菜单那一句下面补。
    if ((pageChanged && blocksChanged) || Object.keys(root).length || hasShared) try {
      summary = describeSave({
        saved: base.saved, json: pageChanged && blocksChanged ? json : null, root: Object.keys(root).length ? root : null, shared: hasShared ? shared : null,
        schema, siteBlocks: base.siteBlocks, rootLabels: ROOT_SAVE_LABELS, shapeLabel: SHAPE_FIELD_LABEL, aiNotes, dragged, slug: page,
        rootBefore: (base.initial.root as { props?: Record<string, unknown> } | undefined)?.props,
      });
    } catch { /* 记录退回 manager 那句通用话 */ }
    // #1759 —— 菜单改了：`Header · Navigation links`（票正文做什么 5）。
    if (navChanged) summary = summary ? `${summary}; ${NAV_SAVE_LABEL}` : NAV_SAVE_LABEL;
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
      ...(hasNav ? { nav } : {}),
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
    const key = `${dirty}|${why}|${plan ? JSON.stringify(plan.json) + JSON.stringify(plan.root) + JSON.stringify(plan.shared) + JSON.stringify(plan.nav) + plan.base.hash : ''}`;
    if (key === pendingKeyRef.current) return;
    pendingKeyRef.current = key;
    window.parent.postMessage({ type: 'ai1st:editor-pending', dirty, paused, ...(why ? { why } : {}), ...(plan && !paused ? { save: saveFields(plan) } : {}) }, trustedOrigin);
  }

  // #1410 —— 聊天那一侧要发给 dashboard 的两种消息。🔴 目标 origin 同存盘：只发给那一个 dashboard。
  function postChat(msg: Record<string, unknown>) {
    if (!trustedOrigin || window.parent === window) return;
    window.parent.postMessage(msg, trustedOrigin);
  }

  function sendChat(text: string, scope: ChatScope | null, fromPanel = false) {
    chatFromPanelRef.current = fromPanel;
    if (!trustedOrigin || window.parent === window) {
      noteSend({ kind: 'error', text: 'Open this editor from your dashboard to use the AI chat.' });
      return;
    }
    // #1700 —— 先退回弹层里试看的那一下，「先存再发」存的才不会带上它。
    // #1757 —— 从面板的 AI 页发（正文做什么 6 / 6b）：前三页试看着的那一下不退，照 Done 记下来、面板不关（§settleDesign），
    //   下面「先存再发」把它连同画布上别的没存的一起存掉 ⟹ AI 拿到的就是老板眼前这一版。
    if (fromPanel && designRef.current && designTabRef.current === 'ai') settleDesign();
    else cancelDesign();
    const g = getPuckRef.current ? getPuckRef.current() : null;
    if (!g) return;
    noteSend(null);
    setChatPending(true);
    // 上一笔存盘还在路上（按了 Save 马上发）：先等它落定。这期间画布锁着（chatPending），等到的时候画布
    // 就是点发送那一刻的样子。
    if (sendingRef.current) {
      pendingChatRef.current = { text, scope, sending: sendingRef.current, resave: true };
      noteSend({ kind: 'info', text: 'Saving your changes first, then sending…' });
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
      noteSend({ kind: 'error', text: keptBlocksText(keptRef.current, 'message') });
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
      noteSend({ kind: 'error', text: SEND_SAVE_FAILED }, true);
      return;
    }
    pendingChatRef.current = { text, scope, sending: sendingRef.current, resave: false };
    noteSend({ kind: 'info', text: 'Saving your changes first, then sending…' });
  }

  /**
   * #1757 —— 发消息那一路的那句话：左边聊天照旧（`chatNotice`）；这一次是从面板的 AI 页发的 ⟹ 面板里也说。
   *   `saveFailed`：没发成是因为「先存」那一笔没存上 —— 面板里说正文做什么 6 点名的那一句（左边聊天碰到同样情况时的那句），
   *   原因在编辑器顶上的存盘状态里（两条失败路：交不出去 / 交出去被拒，左边聊天第二条路带着 dashboard 的原因）。
   */
  function noteSend(n: { kind: 'info' | 'error'; text: string } | null, saveFailed = false) {
    setChatNotice(n);
    if (chatFromPanelRef.current) setDesignNotice(n && saveFailed ? { kind: 'error', text: SEND_SAVE_FAILED } : n);
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
      // #1683 —— `instruction`（输入框那一路，`action: 'custom'`）也要带上：dashboard 只转白名单里的键。
      postChat({ type: 'ai1st:ai-rewrite', id, action: req.action, ...(req.instruction ? { instruction: req.instruction } : {}), blockType: req.blockType, page, locale, fields: req.fields });
    });
  }

  // #1711 —— 选图弹窗 Generate 的默认提示词。块：画布里点的图带着它的 id；面板上的 Change 不知道，就取当前选中的那一块。
  //    槽：画布里有 `data-slot`；面板上按 `current` 在这块的数据里找（§editorImageTarget）。算不出来 ⟹ ''（不带 prompt）。
  function imagePromptFor(current: string, at?: { id: string; slot: string }): { prompt: string; blockType: string; slot: string } | null {
    try {
      const g = getPuckRef.current ? (getPuckRef.current() as unknown as FillPuck & { selectedItem?: { type: string; props: Record<string, unknown> } | null }) : null;
      if (!g) return null;
      const item = at ? fillItem(g, at.id)?.item : g.selectedItem;
      const c = item ? componentsByType.get(item.type) : undefined;
      if (!item || !c) return null;
      const target = editorImageTarget({ props: item.props, slot: at?.slot, current });
      if (!target) return null;
      const primary = site.brand?.colors?.primary?.['500'];
      const prompt = editorImagePrompt({
        manifest: { type: c.type, displayName: c.label, category: c.category },
        ...target,
        industry: industryRef.current,
        primaryColor: typeof primary === 'string' && primary ? primary : 'the brand color',
        headline: typeof item.props.headline === 'string' ? item.props.headline : '',
      });
      // 块名 / 槽名随着走：manager 拿它写 Credits 那一行「哪一块」（`AI image · hero · image`）。
      return { prompt, blockType: c.type, slot: target.slotName };
    } catch {
      return null; // 算提示词出了任何岔子都不挡选图：Generate 照样能用老板写的那句
    }
  }

  // #1693 —— 选一张图：交给 dashboard 开图片库（它带凭证上传 / 列图库），回话在 §onMessage 的 `ai1st:pick-image-result`。
  // #1713 —— `opts.title`：弹窗标题（这个位置的名字）；`opts.fresh`：Regenerate 刚换上的那张（弹窗里它打勾，`current` 是上一张）。
  function pickImage(current: string, at?: { id: string; slot: string }, opts?: { title?: string; fresh?: string }): Promise<PickImageResult> {
    if (!trustedOrigin || window.parent === window) {
      return Promise.resolve({ ok: false, message: 'Open this editor from your dashboard to change images.' });
    }
    if (pickRef.current) { pickRef.current.done({ ok: false, cancelled: true }); pickRef.current = null; }
    const id = `pi-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    return new Promise((resolve) => {
      pickRef.current = { id, done: resolve };
      setPicking(true);
      const gen = imagePromptFor(current, at);
      postChat({ type: 'ai1st:pick-image', id, current, ...(gen ? gen : {}), ...(opts?.title ? { title: opts.title } : {}), ...(opts?.fresh ? { fresh: opts.fresh } : {}) });
    });
  }

  // #1713 —— 画布图上的 ✨ Regenerate：默认提示词同弹窗里的 Generate（§imagePromptFor），生成交给 dashboard（它带凭证）。
  //    等的时候画布锁着（§regenerating）；回话之前先把锁解开（lockedRef 当场改回，调用方接着就要写图、马上存）。
  function regenerateImage(current: string, at: { id: string; slot: string }): Promise<RegenerateResult> {
    if (!trustedOrigin || window.parent === window) {
      return Promise.resolve({ ok: false, message: 'Open this editor from your dashboard to use AI.' });
    }
    if (lockedRef.current || regenRef.current) return Promise.resolve({ ok: false, message: 'The AI is editing this page. Wait for it to finish.' });
    const gen = imagePromptFor(current, at);
    if (!gen || !gen.prompt.trim()) return Promise.resolve({ ok: false, message: REGENERATE_FAILED });
    cancelDesign(); // 同别的「AI 上锁」入口：Design 弹层里试看的那一下先退回
    const id = `ri-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    setRegenerating(true);
    lockedRef.current = true;
    cancelAutosave();
    return new Promise((resolve) => {
      const finish = (r: RegenerateResult) => {
        clearTimeout(timer);
        setRegenerating(false);
        lockedRef.current = chatLockRef.current;
        resolve(r);
      };
      const timer = setTimeout(() => {
        if (regenRef.current?.id !== id) return;
        regenRef.current = null;
        finish({ ok: false, message: 'The AI did not answer in time. Please try again.' });
      }, REGENERATE_WAIT_MS);
      regenRef.current = { id, done: finish };
      postChat({ type: 'ai1st:ai-image', id, prompt: gen.prompt, blockType: gen.blockType, slot: gen.slot });
    });
  }

  // #1660 —— 新块落下：把它 `ai: true` 的格（带着占位）交给 AI 按这家生意写。回来只换还是占位的那几格 ——
  //    等的这几秒里老板改过的格、删掉的块都不碰（同 T6 §runAi）。AI 正在改这一页（聊天）时不写：那一轮会换底稿。
  function startFill(id: string, type: string) {
    const c = componentsByType.get(type);
    const g = getPuckRef.current ? (getPuckRef.current() as unknown as FillPuck) : null;
    const item = fillItem(g, id)?.item;
    if (!c || !g || !item) return;
    const sent = fillFields(c, item.props);
    if (!sent.length) return;
    const label = c.label;
    if (!trustedOrigin || window.parent === window) {
      setFillNote(`Open this editor from your dashboard so the AI can write the new ${label} section.`);
      return;
    }
    const reqId = `fb-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const stop = () => setFilling((s) => { const n = new Set(s); n.delete(id); return n; });
    setFilling((s) => new Set(s).add(id));
    setFillNote(null);
    const timer = setTimeout(() => {
      if (!rewritesRef.current.delete(reqId)) return;
      stop();
      setFillNote(`The AI did not answer in time. The new ${label} section still has sample text — you can change it yourself.`);
    }, REWRITE_WAIT_MS);
    rewritesRef.current.set(reqId, (r) => {
      clearTimeout(timer);
      stop();
      const gg = getPuckRef.current ? (getPuckRef.current() as unknown as FillPuck) : null;
      const found = fillItem(gg, id);
      if (!gg || !found) return; // 块已经删了 / 换了一份底稿：没有可写的地方
      const { item: now, sel } = found;
      if (!r.ok) { setFillNote(`${r.message} The new ${label} section still has sample text — you can change it yourself.`); return; }
      if (lockedRef.current) { setFillNote(`The AI chat is editing this page, so the new ${label} section kept its sample text.`); return; }
      const before = new Map(sent.map((f) => [f.name, f.text]));
      let props = now.props;
      let n = 0;
      for (const f of r.fields) {
        const was = before.get(f.name);
        if (was === undefined || !f.text.trim()) continue;
        const path = pathOfName(f.name);
        if (getAt(props, path) !== was) continue;
        props = setAt(props, path, f.text);
        n++;
      }
      if (n) gg.dispatch({ type: 'replace', destinationIndex: sel.index, destinationZone: sel.zone, data: { ...now, props }, recordHistory: true });
    });
    postChat({ type: 'ai1st:ai-fill-block', id: reqId, blockType: type, page, locale, fields: sent });
  }

  // #1448 —— 换页（dashboard 面板条上的下拉）。🔴 画布上没存的改动不许被换页静默丢掉：有就先存，
  // 存上了才回 ok；存不上 / AI 正在改这一页 ⟹ 回 ok: false 和一句话，dashboard 不换页。
  // 形状同「先存再发」（§releaseChat）：交出去的那一笔落盘（它自己的 `saved` 底稿）才放行，并且放行前再判一次。
  function answerLeave(id: string, ok: boolean, message?: string) {
    postChat({ type: 'ai1st:editor-leave-result', id, ok, ...(message ? { message } : {}) });
  }
  function releaseLeave(id: string) {
    cancelDesign(); // #1700 —— 换页 / 关编辑器：弹层里试看的那一下先退回，不跟着存下去
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

  /**
   * #1700 —— Design 弹层是一个事务：只有 Done 提交（PM 2026-10-11 裁定 1）。
   *   打开   记下这一块此刻的 props；弹层开着时自动存停着（§holdReason 的 `design`），面板条说「点 Done 或 Cancel」。
   *   点一格 整块换成 §presetClickProps 算出来的 props（右栏点芯片同一份），`recordHistory: false` ⟹ 不在撤销里留中间步。
   *          Customize 页（#1708）拧旋钮 / 勾开关 / 换背景同一条规矩（§changeDesign）；两页来回切、都改过，Done 也只记一步。
   *   Done   跟打开时比改过了 ⟹ 撤销历史补记一步（打开之前 → 现在），再照常数停手存一笔；没改 ⟹ 不存、不记。
   *   Cancel 退回打开时那份 props（`recordHistory: false`），不存、不记。
   * 🔴 任何把注意力移出弹层的动作都先 Cancel，再做它自己：点画布别处 / 点字 / 右栏 / 撤销键（只 Cancel，不再多退一步）
   *    —— 这几样在 §DesignPopover 里截；发聊天 / 回退 / 换页 / 关编辑器 / 刷新 / 换底稿 / AI 上锁在这个文件里各自的入口先调 §cancelDesign。
   *    `save()` 自己不看 §holdReason（先存再发的语义靠它），所以退回必须发生在它们调 save 之前。
   */
  function puckForDesign() {
    return getPuckRef.current ? (getPuckRef.current() as unknown as FillPuck & ReturnType<GetPuck>) : null;
  }
  // #1738 —— 顶栏 / 页脚那一支改的是 root（§REGION_ROOT）：读现值、整份换回去，都不记历史（同块那一支的 `replace`）。
  type DesignPuck = NonNullable<ReturnType<typeof puckForDesign>>;
  const rootPropsOf = (g: DesignPuck) => ({ ...((g.appState.data.root as { props?: Record<string, unknown> } | undefined)?.props || {}) });
  function setRootProps(g: DesignPuck, props: Record<string, unknown>) {
    const root = (g.appState.data.root || {}) as Record<string, unknown>;
    (g.dispatch as unknown as (a: unknown) => void)({ type: 'replaceRoot', root: { ...root, props }, recordHistory: false });
  }
  function openDesign(id: string, tab: DesignTab = 'layout', focus?: string) {
    if (lockedRef.current) return;
    // #1735 —— 这一块已经开着（Edit content 点在开着的面板上）：只切页，这一次打开里改过的照旧算在里面。
    if (designRef.current) {
      if (designRef.current.id === id) { setDesignTab(tab); setDesignStart((p) => ({ tab, focus, n: p.n + 1 })); }
      return;
    }
    const g = puckForDesign();
    let before: Record<string, unknown>;
    if (regionOfDesign(id)) {
      if (!g) return;
      before = rootPropsOf(g);
    } else {
      const found = fillItem(g, id);
      if (!found) return;
      before = found.item.props;
    }
    designRef.current = { id, before };
    setDesignTab(tab);
    setDesignNotice(null);
    chatFromPanelRef.current = false;
    setDesignStart((p) => ({ tab, focus, n: p.n + 1 }));
    setDesign(id);
    setDesignError('');
    cancelAutosave();
    reportPending(undefined);
  }
  function pickDesign(preset: string) {
    const d = designRef.current;
    const g = puckForDesign();
    const region = d ? regionOfDesign(d.id) : null;
    if (region) {
      // #1738 —— 预设 = 形态；存下的旋钮 / 归预设管的开关清掉，底色和 icons 留着（`region-options.js` §regionPresetPick）。
      if (!g) return;
      const props = rootPropsOf(g);
      const k = REGION_ROOT[region];
      const r = regionPresetPick(region, preset, asOptions(props[k.options]));
      if (r) setRootProps(g, { ...props, [k.shape]: r.shape, [k.options]: r.options });
      return;
    }
    const found = d ? fillItem(g, d.id) : null;
    if (!d || !g || !found) return;
    const f = componentsByType.get(found.item.type)?.fields.find((x) => x.control === 'options' && (x.presets || []).length);
    if (!f) return;
    const props = presetClickProps(f, found.item.props, preset);
    g.dispatch({ type: 'replace', destinationIndex: found.sel.index, destinationZone: found.sel.zone, data: { ...found.item, props }, recordHistory: false });
  }
  /** #1708 —— Customize 页的一下：值由 §KnobControls / §ColorField 算好（右栏同一份），这里只换这一个键，同 §pickDesign 不记历史。 */
  function changeDesign(slot: string, value: unknown) {
    const d = designRef.current;
    const g = puckForDesign();
    const region = d ? regionOfDesign(d.id) : null;
    if (region) {
      // #1738 —— `bg` = 底色（undefined = None，删键）；别的是一个旋钮 / 开关：顶栏 logo × menu 有耦合，按「刚拧的是它」纠正后
      //    整组写进去（`region-options.js` §regionKnobChange —— 只写拧的那一个，渲染时会按 logo 为准改回去）。
      if (!g) return;
      const props = rootPropsOf(g);
      const k = REGION_ROOT[region];
      const opts = asOptions(props[k.options]);
      let next: Record<string, unknown>;
      if (slot === 'bg') {
        next = { ...opts };
        if (value === undefined) delete next.bg; else next.bg = value;
      } else {
        next = regionKnobChange(region, String(props[k.shape] || ''), opts, slot, value);
      }
      setRootProps(g, { ...props, [k.options]: next });
      return;
    }
    const found = d ? fillItem(g, d.id) : null;
    if (!d || !g || !found) return;
    const props: Record<string, unknown> = { ...found.item.props };
    if (value === undefined) delete props[slot]; else props[slot] = value;
    g.dispatch({ type: 'replace', destinationIndex: found.sel.index, destinationZone: found.sel.zone, data: { ...found.item, props }, recordHistory: false });
  }
  /** 收起弹层。`commit` = Done。弹层没开着 ⟹ 什么都不做（各个出口都无条件调 Cancel）。 */
  function closeDesign(commit: boolean) {
    const d = designRef.current;
    if (!d) return;
    designRef.current = null;
    setDesign(null);
    setDesignNotice(null);
    const g = puckForDesign();
    const region = regionOfDesign(d.id);
    const found = region ? null : fillItem(g, d.id);
    const now = g && region ? rootPropsOf(g) : found ? found.item.props : null;
    if (g && now && !deepEqual(now, d.before)) {
      if (commit) {
        recordDesignStep(g);
      } else if (region) {
        setRootProps(g, d.before);
      } else if (found) {
        g.dispatch({ type: 'replace', destinationIndex: found.sel.index, destinationZone: found.sel.zone, data: { ...found.item, props: d.before }, recordHistory: false });
      }
    }
    // 停着的那段时间里画布上要是还有别的没存的（打开之前就在数停手的那一笔），现在接着数。
    reportPending(undefined);
    scheduleAutosave();
  }
  /** #1759 —— 顶栏 Content 页的一下：几样 root 值合进去（同 §changeDesign 的区那一支：不记历史）。 */
  function changeHeader(patch: Partial<RootProps>) {
    const d = designRef.current;
    const g = puckForDesign();
    if (!d || !g || regionOfDesign(d.id) !== 'header') return;
    setRootProps(g, { ...rootPropsOf(g), ...patch });
    setDesignError('');
  }
  function cancelDesign() { setDesignError(''); closeDesign(false); }
  function doneDesign() {
    // #1759 —— 顶栏 Content 页有不能存的值（菜单名字空 / 主按钮缺一样 / 次按钮只填一格）：说一句、面板留着、不存（票正文做什么 3）。
    const d = designRef.current;
    const g = puckForDesign();
    if (d && g && regionOfDesign(d.id) === 'header') {
      const why = headerContentProblem(rootPropsOf(g));
      if (why) { setDesignError(why); return; }
    }
    setDesignError('');
    closeDesign(true);
  }
  /** Done 那一步：同 AI 那一步（§onMessage 的 `reason: ai`）自己拼进历史，不走 `setData({recordHistory: true})` 的 250ms 防抖。
   *  当前那一条还是打开之前的画布（弹层里每一下都没记），在它后面接一条「现在」⟹ 一次 Ctrl+Z 回到打开之前。 */
  function recordDesignStep(g: DesignPuck) {
    const at = g.history.index;
    const { indexes: _stale, ...cur } = g.appState as unknown as Record<string, unknown>; // eslint-disable-line @typescript-eslint/no-unused-vars
    g.history.setHistories([...g.history.histories.slice(0, at + 1).map(noIndexes), { id: `design-${Date.now()}`, state: cur as PuckHistory['state'] }]);
  }

  /**
   * #1757 —— 面板停在 AI 页时，AI 改这一页的整个过程中面板不关（正文做什么 6b）。三个动作：
   *   §designOnAi    「这一下可以不关面板吗」：开着、停在 AI 页、是页面块、前三页没有试看着的改动（有的话 #1700 那条顾虑还在 ⟹ 照旧关）。
   *   §settleDesign  从 AI 页发送：照 Done 记下前三页那一笔，但不关，底换成现在这份（之后的 Cancel 只退这之后的）。
   *   §rebaseDesign  画布换成 AI 改完 / 撤回之后的那一版：底换成新一版里这一块（Cancel 不会把 AI 的改动撤掉，做什么 7）；没了 ⟹ 关。
   *   §resetDesign   从 AI 页点 ↺：试看着的那一下退回（同 #1700「画布被换掉之前先退回」），面板不关。
   */
  function designOnAi(): boolean {
    const d = designRef.current;
    if (!d || designTabRef.current !== 'ai' || regionOfDesign(d.id)) return false;
    const found = fillItem(puckForDesign(), d.id);
    return !!found && deepEqual(found.item.props, d.before);
  }
  function settleDesign() {
    const d = designRef.current;
    const g = puckForDesign();
    if (!d || !g || regionOfDesign(d.id)) return;
    const found = fillItem(g, d.id);
    if (!found || deepEqual(found.item.props, d.before)) return;
    recordDesignStep(g);
    designRef.current = { id: d.id, before: found.item.props };
  }
  function rebaseDesign() {
    const d = designRef.current;
    if (!d) return;
    const found = fillItem(puckForDesign(), d.id);
    if (!found) { cancelDesign(); return; }
    designRef.current = { id: d.id, before: found.item.props };
  }
  function resetDesign() {
    const d = designRef.current;
    const g = puckForDesign();
    const found = d && !regionOfDesign(d.id) ? fillItem(g, d.id) : null;
    if (!d || !g || !found || deepEqual(found.item.props, d.before)) return;
    g.dispatch({ type: 'replace', destinationIndex: found.sel.index, destinationZone: found.sel.zone, data: { ...found.item, props: d.before }, recordHistory: false });
  }

  // #1406 —— 记下老板拖过哪一块（Puck 的 reorder / move 带着拖之前的下标；页面只有一个根区）。
  function onAction(action: PuckAction, next: { ui?: { rightSideBarVisible?: boolean } }, prev: { data?: { content?: { props?: { id?: unknown } }[] }; ui?: { rightSideBarVisible?: boolean } }) {
    // #1742 —— 撤销 / 前进（Puck 的 `set`：整份换成历史里那一刻的 state，连 `ui` 一起）不许动右栏：右栏开机收着，
    //   老板用 Settings 打开之后改一笔、Ctrl+Z，右栏会跟着退回「记那一笔时」的样子（多半是收着）。撤销退的是网站，不是面板。
    //   这里还在 Puck 的 reducer 里头 ⟹ 等这一下走完再把它放回去（setUi 不记历史，前进那一串不受影响）。
    if (action.type === 'set') {
      const was = prev?.ui?.rightSideBarVisible;
      if (typeof was === 'boolean' && was !== next?.ui?.rightSideBarVisible) {
        setTimeout(() => dispatchRef.current?.({ type: 'setUi', ui: { rightSideBarVisible: was } } as never), 0);
      }
      return;
    }
    // #1660 —— 新块落下：等这一下 dispatch 走完再发（这里还在 Puck 的 reducer 里头）。
    if (action.type === 'insert') {
      const { id, componentType } = action as { id?: string; componentType: string };
      if (typeof id === 'string' && id) setTimeout(() => startFill(id, componentType), 0);
      return;
    }
    if (action.type !== 'reorder' && action.type !== 'move') return;
    const item = prev?.data?.content?.[action.sourceIndex] as { props?: { id?: unknown; _src?: PuckItemSrc } } | undefined;
    const id = item?.props?.id;
    if (typeof id === 'string') movedRef.current.add(id);
    // #1676 —— 记录里「挪了谁」用的是页面 JSON 的块键（§describeSave 的 keyOf）。新插的块还没有 —— 它记成 `Added X`。
    const src = item?.props?._src;
    const key = src?.shared ? `ref:${src.shared}` : src?.entry && typeof (src.entry as { id?: unknown }).id === 'string' ? `id:${(src.entry as { id: string }).id}` : null;
    if (key) draggedRef.current = [...draggedRef.current.filter((k) => k !== key), key];
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

  /**
   * #1741 —— 撤销 / 前进的那几条规矩，按钮搬到 dashboard 顶栏之后都住这一处（以前分别挂在 Puck 头部那两颗按钮的 DOM 事件上）：
   *   AI 在改这一页 ⟹ 不动（#1410；顶栏那两颗已经是灰的，这里再拦一道，消息总能被别处发进来）。
   *   表单对话框开着 ⟹ 不动（#1735：那时在改表单的字，不退画布历史）。
   *   Design 弹层开着 ⟹ 只 Cancel 弹层，不多退一步（#1712：弹层里试看的改动没记历史，退一步就退到了它前面那一笔）。
   * 键盘那一路（画布 / 编辑器页里按 Ctrl+Z）不经过这里：Puck 自己收，锁和弹层照旧在 §useAiLockGuard / §DesignPopover 里拦。
   */
  historyReqRef.current = (dir) => {
    if (locked) return;
    if (document.querySelector('[data-editor-form-dialog]')) return;
    if (design) { cancelDesign(); return; }
    const g = getPuckRef.current ? getPuckRef.current() : null;
    if (!g) return;
    if (dir === 'undo') g.history.back(); else g.history.forward();
  };
  function reportHistory(canUndo: boolean, canRedo: boolean) {
    const key = `${canUndo}|${canRedo}`;
    if (historySentRef.current === key) return;
    historySentRef.current = key;
    postChat({ type: 'ai1st:history-state', canUndo, canRedo });
  }

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
    sendChat,
    // #1757 —— 从面板的 AI 页点 ↺：面板不关，试看着的那一下退回（§resetDesign）；左边聊天点 Undo 照旧先 Cancel 面板（#1700）。
    revertChat: (messageId, fromPanel) => {
      if (fromPanel && designRef.current && designTabRef.current === 'ai') resetDesign(); else cancelDesign();
      postChat({ type: 'ai1st:chat-revert', messageId });
    },
    fillNote, dismissFillNote: () => setFillNote(null),
    design, dialogOpen: anyDialogOpen({ design, formEditing, picking }), designStart, designTab, setDesignTab, designNotice, openDesign, pickDesign, changeDesign, changeHeader, designError, cancelDesign, doneDesign,
    reportHistory,
    regionDesign: schema.root.regions,
  };

  const noteAi: InlineApi['noteAi'] = (n) => { aiNotesRef.current = recordAiNote(aiNotesRef.current, n); };
  // #1713 —— Regenerate 换上 / 换回那一笔：不等停手，马上存（先存后问）。上一笔还在路上 ⟹ 它落定后照常数停手再存。
  const saveNow = () => flushAutosave();
  const noteItem: InlineApi['noteItem'] = (n) => { aiNotesRef.current = recordItemNote(aiNotesRef.current, n); };
  // #1755 —— 画布上点了一颗按钮：开按钮弹窗（§DesignPopover 的 `button` 那一支）。
  const openButton: InlineApi['openButton'] = (id, slot, index) => openDesign(id, 'button', `${slot}.${index}`);
  const inlineApi: InlineApi = { locked, regenerating, locale, page, site, components: componentsByType, setFreeze, rewrite, noteAi, noteItem, pickImage, regenerateImage, saveNow, openButton };

  // #1634 —— 「Edit this form」面板：Done ⟹ 这一笔表单文案等着交，马上存（跟停手自动存同一条路，§flushAutosave）。
  const formsCtx = { forms: formList, editForm: (id: string) => setFormEditing(id), locked };
  const editingForm = formEditing ? formList.find((f) => f.id === formEditing) : undefined;

  return (
    <SharedInfoContext.Provider value={sharedInfo}>
    <EditorUiContext.Provider value={ui}>
    <FormsContext.Provider value={formsCtx}>
    <InlineApiContext.Provider value={inlineApi}>
    <InlineFreezeContext.Provider value={freeze}>
    <FillingContext.Provider value={filling}>
    <IconTablesContext.Provider value={iconTables || NO_ICON_TABLES}>
    {/* #1740 —— 编辑器页这一侧固定浅色（§EDITOR_LIGHT：挂这一层，不挂 <html>）。 */}
    <div data-editor-root data-editor-dialog-open={ui.dialogOpen ? '' : undefined} {...EDITOR_LIGHT} style={{ ...EDITOR_LIGHT_STYLE, height: '100vh' }}>
      <Puck
        key={canvas.key}
        config={config}
        data={canvas.data as unknown as Data}
        iframe={EDITOR_IFRAME}
        viewports={EDITOR_VIEWPORTS}
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
    </IconTablesContext.Provider>
    </FillingContext.Provider>
    </InlineFreezeContext.Provider>
    </InlineApiContext.Provider>
    </FormsContext.Provider>
    </EditorUiContext.Provider>
    </SharedInfoContext.Provider>
  );
}
