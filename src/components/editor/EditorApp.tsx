'use client';

// #1409 / #1404 —— 编辑器页的客户端那一半：Puck + 从这个站自己的区块库生成的 config。
//
// 🔴 唯一的硬约束（设计稿 §4）：**这个页面所在的域名上不许出现任何凭证，也不许向 manager 发请求。**
//    所以这里没有 fetch、没有存储、没有 token。存盘 = 把整份页面 JSON `postMessage` 给框住我们的
//    dashboard，由它带自己的凭证去打 manager。
//
// 🔴 收发两向都校验 origin，发消息**不许**用 `'*'`：
//    · 发：目标 origin 是构建时烤进来的 dashboard origin（`trustedOrigin`，与主题预览 #925 同一个来源：
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
//   reason = open      刚打开：换成这一份（跟首屏不同才换），撤销历史清零
//            saved     刚存下去的那一次成功了（在重建之前就到）：只换 baseHash，画布不动 —— 于是不刷新、
//                      不等重建也能接着存
//            external  别处改过这一页：把数据换上、换 baseHash；**不进撤销历史**（怎么进归 #1410）
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
// 存成功才发；被拒（这一页在别处改过，exit 10）就不发、把那句话原样说出来。撤销 AI 那一步只动画布、不自动存
// （做什么 6）：状态栏说「有未保存的改动」，文件里是 AI 那版直到按 Save。#1412 起 Save 只落盘不重建、发布才上线，
// 所以那句话说的是「按 Save 留下、发布后上线」，跟 dashboard 那句「Saved. It goes live on your website when you publish.」同一个口径。

import { createContext, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Puck, FieldLabel, createUsePuck, useGetPuck, type Config, type Data, type Field, type Fields, type PuckAction } from '@puckeditor/core';
import '@puckeditor/core/puck.css';
import SectionRenderer from '@/components/SectionRenderer';
import SiteShell from '@/components/SiteShell';
import EditorChat, { type ChatScope, type EditorChatState } from './EditorChat';
import type { BlockConfig } from '@/lib/types/config';
import type { EditorComponent, EditorField, EditorSchema } from '../../../scripts/lib/editor-schema';
import type { PuckItemSrc, PuckLikeData, SharedChanges } from '../../../scripts/lib/editor-convert';
import {
  UNKNOWN_TYPE, pageToPuck, puckToPage, fieldProps, dataFromProps, deepEqual, puckRootChanges,
  sharedReach, sharedRemovable, puckSharedChanges, sharedOwnAfter, applySharedChanges, aiBaselineStep,
} from '../../../scripts/lib/editor-convert.js';

export interface EditorAppProps {
  locale: string;
  page: string;
  /** 文件里那一份，存盘的底。见 `scripts/lib/editor-page.js` 文件头。 */
  raw: Record<string, unknown>;
  /**
   * 那份文件字节的 sha256。存盘时原样带回去：站里的 `write-page.js` 拿它跟当前文件比，编辑器打开之后
   * 这一页被别处改过就拒绝写入（#1409 QA2 r1：旧底稿整份写回会冲掉检查器 / AI 聊天刚做的改动）。
   */
  baseHash: string;
  schema: EditorSchema;
  /** `root.props` 是外壳四样打开时的值（#1405）—— 存盘时逐字段比的就是它。 */
  initialData: PuckLikeData;
  /** 这一页第一段是不是 hero（透明浮层顶栏只在那时浮起来，同真页面的 `SiteShell overHero`）。 */
  overHero: boolean;
  /** 框住我们的 dashboard 的 origin。空串 = 构建时没拿到（本地模板 dev），这时不能保存。 */
  trustedOrigin: string;
  /** #1406 —— 这种语言的站级块库（文件里那一份）：共用块的字段从它取，存盘时改动跟它比。 */
  siteBlocks: Record<string, unknown>;
  /** #1406 —— 每个共用块被哪几页 `ref`（`editor-page.js` §sharedRefs）；算「在 N 个页面上」用。 */
  refs: Record<string, string[]>;
  /** #1406 —— 这种语言现有的页（`visibility` 里写了不存在的页不算进 N）。 */
  slugs: string[];
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

/** manifest 的一个槽位 → 一个 Puck 字段。控件由 `kind` 决定（editor-schema.js 文件头那张表）。 */
function puckField(f: EditorField): Field {
  switch (f.control) {
    case 'text':
      return { type: 'text', label: f.label };
    case 'object':
      return {
        type: 'object',
        label: f.label,
        objectFields: Object.fromEntries(f.subs.map((s) => [s.sub, { type: 'text', label: s.label }])),
      } as Field;
    case 'list':
      return {
        type: 'array',
        label: f.label,
        arrayFields: Object.fromEntries(f.subs.map((s) => [s.sub, { type: 'text', label: s.label }])),
        defaultItemProps: {},
        getItemSummary: (item: unknown, i?: number) => summaryOf(item, i, f.subs.map((s) => s.sub)),
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

function sharedNoteField(id: string): Field {
  return { type: 'custom', label: 'Shared section', render: () => <SharedNote id={id} /> } as Field;
}

/**
 * 画布上的一块：真站那一个组件（经 `SectionRenderer`），不是示意图。
 *
 * 数据的底是**归一化之后**那一块（`_src.view`，跟真页面同一份：列表已升格、`data-has-*` 已算好），
 * 老板改过的字段才换成新值 —— 用的是存盘时同一个合法（§dataFromProps），画布和落盘不会各说各的。
 */
function CanvasBlock({ component, props, locale }: { component: EditorComponent; props: ItemProps; locale: string }) {
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
  const block = { ...view, data, shape: props._shape || undefined } as BlockConfig;
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
        {view.hidden ? (
          <div data-editor-hidden style={{ padding: '10px 16px', fontSize: 13, color: '#667085', background: '#f2f4f7' }}>
            {component.label} — hidden on the live page
          </div>
        ) : <SectionRenderer blocks={[block]} locale={locale} />}
      </div>
    );
  }
  if (view.hidden) {
    // `hidden` 整条由 #1411 退役；在那之前它还在页面 JSON 里，画布上给一条看得见的占位，别让它成为
    // 一个点不中的空条目。
    return (
      <div data-editor-hidden style={{ padding: '10px 16px', fontSize: 13, color: '#667085', background: '#f2f4f7' }}>
        {component.label} — hidden on the live page
      </div>
    );
  }
  return <SectionRenderer blocks={[block]} locale={locale} />;
}

/**
 * @param removable #1406 —— 这个共用块能不能从这一页删（`"*"` 的不能）。读的是编辑器手上**现在**那份块库。
 */
export function buildConfig(schema: EditorSchema, locale: string, overHero = false, removable: (id: string) => boolean = () => true): Config {
  const components: Record<string, Config['components'][string]> = {};
  for (const c of schema.components) {
    const fields: Fields = {};
    for (const f of c.fields) fields[f.slot] = puckField(f);
    fields._shape = {
      type: 'select',
      label: 'Layout',
      // 选项 = 形态子目录去掉候选（schema 里已经过滤好）。`needs` 不为空的形态，这个块缺那些槽位时
      // 构建会落回默认 —— 选项上写明，别让老板选了之后以为坏了。
      options: c.shapes.map((s) => ({ value: s.name, label: s.needs.length ? `${s.name} (needs ${s.needs.join(', ')})` : s.name })),
    };
    const defaultProps: Record<string, unknown> = { ...fieldProps(c, {}) };
    if (c.defaultShape) defaultProps._shape = c.defaultShape;
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
        if (src?.locked) return { _locked: LOCKED_NOTE, ...fields };
        if (src?.shared) return { _shared: sharedNoteField(src.shared), ...fields };
        return fields;
      },
      render: (props: ItemProps) => <CanvasBlock component={c} props={props} locale={locale} />,
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
    root: rootConfig(schema, locale, overHero),
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
  topbarMessage?: string;
  topbarLink?: { label?: string; href?: string };
  children?: ReactNode;
};

/**
 * #1405 —— 外壳四样：Puck 的 root 字段（整页一份，不在块列表里）。可选值全部来自构建时的 schema
 * （形态 = 子目录去掉候选；布局 = `page-layouts/` 库），这里不写任何名单。
 *
 * 🔴 **这里不判「哪些组合构建不收」**（带公告条的布局 + 透明浮层顶栏 / 缺某种语言的公告条文字）：那条规则
 *    只住在站里的写盘脚本（用构建同一个 `needsTopbar`），拒了那句话原样回到状态栏（票正文做什么 6）。
 *    在这里按自己的判断禁用选项，总有一天一个说行、一个说不行。
 * 🔴 唯一在这里灰掉的是「布局自己钉了页脚形态」时的页脚下拉（做什么 8）—— 判据是 schema 给的 `pinsFooter`
 *    （从布局文件算出来的），不是布局名。
 */
function rootConfig(schema: EditorSchema, locale: string, overHero: boolean) {
  const opts = (names: string[]) => names.map((n) => ({ value: n, label: n }));
  const fields: Fields = {
    layout: { type: 'select', label: 'Page layout (whole website)', options: schema.root.layouts.map((l) => ({ value: l.id, label: l.id })) },
    headerShape: { type: 'select', label: 'Header style (whole website)', options: opts(schema.root.header) },
    footerShape: { type: 'select', label: 'Footer style (whole website)', options: opts(schema.root.footer) },
    _shapeNote: SHAPE_NOTE,
    topbarMessage: { type: 'text', label: 'Announcement bar text (this language only)' },
    topbarLink: {
      type: 'object',
      label: 'Announcement bar link (this language only)',
      objectFields: { label: { type: 'text', label: 'Label' }, href: { type: 'text', label: 'Link' } },
    } as Field,
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
    render: ({ children, layout, headerShape, footerShape, topbarMessage, topbarLink }: RootProps) => {
      const l = layoutOf(layout) || schema.root.layouts[0];
      const link = topbarLink && (topbarLink.label || topbarLink.href)
        ? { label: topbarLink.label || '', href: topbarLink.href || '' } : undefined;
      return (
        <SiteShell
          locale={locale}
          overHero={overHero}
          shell={{
            layout: { regions: l ? l.regions : ['header', 'content', 'footer'], repeatVariants: l ? l.repeatVariants : {} },
            headerShape: headerShape || '',
            footerShape: footerShape || '',
            topbar: topbarMessage ? { message: topbarMessage, ...(link ? { link } : {}) } : null,
          }}
        >
          {children}
        </SiteShell>
      );
    },
  };
}

type Status = { kind: 'idle' | 'saving' | 'saved' | 'error'; text: string };

/**
 * 存盘要用的那一份底：原始 JSON + 打开时的 Puck Data（§puckToPage 要它的 content）+ 文件的 sha256 + 上一次存下去的 JSON。
 * `initial.root.props` 是外壳四样的比较基准（#1405）：打开时是构建时那份，每存成功一次就把送出去的字段合进去。
 */
// #1406 —— `siteBlocks`：块库的底（共用块的改动跟它比；每存成功一次把送出去的那几处合进去）。
// `sharedOwn`（#1406）：画布上每个共用块的字段是按哪一份 data 取的 —— 存成功过的才在里面（没有就是打开时的
// `_src.sharedData`）。「老板改过没有」跟它比，不跟 `siteBlocks`（dashboard 重取的、带着别处改动的那份）比。
type Base = { raw: Record<string, unknown>; initial: PuckLikeData; hash: string; saved: Record<string, unknown>; siteBlocks: Record<string, unknown>; sharedOwn: Record<string, Record<string, unknown>> };

type PuckDispatch = (action: { type: 'setData'; data: Data; recordHistory?: boolean }) => void;

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
 * #1410 —— 状态栏：画布跟网站不一样时说出来（做什么 6「撤销 AI 那一步之后进入『有未保存的改动』」）。
 * `aiStep` 是最近那次 AI 记下的那一步：它同时改了共用块、而老板把它撤销了（当前位置在它之前）⟹ 多说一句
 * 「共用块的改动请用聊天里的回退」（做什么 7 的 📌）—— 撤销 + Save 退不掉那一半。
 */
function DirtyNote({ dirtyOf, aiStep, locked }: { dirtyOf: (d: Data) => boolean; aiStep: { id: string; mixed: boolean } | null; locked: boolean }) {
  const data = usePuck((s) => s.appState.data);
  const history = usePuck((s) => s.history);
  const dirty = useMemo(() => dirtyOf(data), [data, dirtyOf]);
  const at = aiStep ? history.histories.findIndex((h) => h.id === aiStep.id) : -1;
  const sharedStays = !!aiStep?.mixed && at >= 0 && history.index < at;
  // 撤销历史的读数（当前位置 / 条数）：不显示，给验收量「AI 这一下记没记进历史」用。
  const probe = <span data-editor-history hidden data-index={history.index} data-length={history.histories.length} />;
  // AI 在改的时候只说那一句（§useAiLockGuard）：「先存再发」那一笔还在路上时这里会短暂算出「有未保存的改动」，那不是老板能处理的事。
  if (locked) return (
    <span data-editor-ai-lock style={{ fontSize: 13, color: '#475467' }}>
      {probe}
      The AI is editing this page — you can keep editing when it&apos;s done.
    </span>
  );
  if (!dirty && !sharedStays) return probe;
  return (
    <span data-editor-dirty style={{ fontSize: 13, color: '#b54708' }}>
      {probe}
      {dirty ? 'Unsaved changes — press Save to keep them. They go live on your website when you publish.' : ''}
      {sharedStays && (
        <span data-editor-shared-stays>{dirty ? ' ' : ''}Changes the AI made to shared sections are not undone here — use Revert in the AI chat for those.</span>
      )}
    </span>
  );
}

/**
 * #1410 —— 给 Puck 的 `overrides` 必须是**同一个对象**：Puck 按它算出 `overrides.puck`，拿来当组件类型用
 * （`Layout` 的 `CustomPuck`），对象一换就是一个新组件类型 ⟹ 整个编辑器布局（画布 iframe、聊天侧栏）卸载重挂。
 * 聊天状态流式时每 50ms 来一条、每条都让 EditorApp 重渲染，内联写法等于每 50ms 重挂一次画布：画布闪、输入框里没发
 * 的字没了、Revert 的确认框自己关掉（e2e ⑩ 量这个；⑧ 等「Undo it」超时就是这么红的）。
 * 所以两个 override 是模块级组件，要用的东西从 `EditorUiContext` 读（context 变了只让它们重渲染，不换类型）。
 */
type EditorUi = {
  /** AI 在改这一页（§useAiLockGuard）：画布只读、撤销 / 前进 / Save 不可用。 */
  locked: boolean;
  dispatchRef: { current: PuckDispatch | null };
  getPuckRef: { current: GetPuck | null };
  dirtyOf: (d: Data) => boolean;
  aiStep: { id: string; mixed: boolean } | null;
  save: (d: Data) => unknown;
  status: Status;
  chatOpen: boolean;
  openChat: () => void;
  closeChat: () => void;
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
      <DirtyNote dirtyOf={ui.dirtyOf} aiStep={ui.aiStep} locked={ui.locked} />
      {!ui.chatOpen && (
        <button type="button" data-editor-chat-open onClick={ui.openChat} style={{ padding: '6px 12px', borderRadius: 6, border: '1px solid #d0d5dd', background: '#fff', fontSize: 14, cursor: 'pointer' }}>
          AI chat
        </button>
      )}
      <SaveButton onSave={ui.save} status={ui.status} locked={ui.locked} />
    </>
  );
}

// 聊天侧栏跟 Puck 同屏，放在 Puck 的 store 之下（它要读选中的块）。
// 🔴 高度写 100vh 不写 100%：Puck 在这一层外面还套了一个不定高的 `div.Puck`，100% 等于没限 ——
//    聊天记录一长就把整页撑高，Puck 被滚出视口（e2e 量过：视口 635px，页面被撑到 2368px）。
function EditorWithChat({ children }: { children: ReactNode }) {
  const ui = useContext(EditorUiContext);
  return (
    <div style={{ display: 'flex', height: '100vh', overflow: 'hidden' }}>
      <div style={{ flex: 1, minWidth: 0, position: 'relative' }}>{children}</div>
      {ui && ui.chatOpen && (
        <EditorChat
          chat={ui.chat}
          notice={ui.chatNotice}
          pending={ui.chatPending}
          page={ui.page}
          locale={ui.locale}
          rawKey={ui.rawKey}
          onSend={ui.sendChat}
          onRevert={ui.revertChat}
          onClose={ui.closeChat}
        />
      )}
    </div>
  );
}

const EDITOR_OVERRIDES = { headerActions: EditorHeaderActions, puck: EditorWithChat };

/**
 * #1410 做什么 4 末尾 —— AI 在改这一页的时候画布只读：从点发送（含「先存再发」那一笔）到 AI 结束、它那份底稿已经换进来
 * （dashboard 的 `busy`，见 useEditorChat.ts §EditorChatState.busy）。锁住是让「AI 改磁盘时磁盘上就是老板看到的那份」
 * 在整个 AI 窗口里都成立、又不用合并两边页面 JSON 的唯一做法；不锁的话，这期间的手改会被 AI 那份底稿整份换掉
 * （QA2 r2 ⑥ 真机量到：画布上、磁盘上都没有，提示也没了）。
 *
 * 三段，判据各不同（PM r2 三审 §二 量过）：
 *   改字段 / 拖 / 增删块 / 复制 ⟹ Puck 的 `permissions`（全局那一份；它会在 prop 换了时重算，不用重挂 Puck）。
 *   Save ⟹ 我们自己的按钮，自己灰掉（§SaveButton）。
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

function SaveButton({ onSave, status, locked }: { onSave: (d: Data) => void; status: Status; locked: boolean }) {
  const data = usePuck((s) => s.appState.data);
  // 🔴 按钮上写的是 Save，因为它做的就是保存（#1409 票正文 §做什么 9 三选一的「等于保存」）。
  //    发布到正式域名是 dashboard 上另一个动作（Publish），两件事不许共用一个字。
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
      {status.text && (
        <span data-editor-status={status.kind} style={{ fontSize: 13, color: status.kind === 'error' ? '#b42318' : '#475467' }}>
          {status.text}
        </span>
      )}
      <button
        type="button"
        data-editor-save
        disabled={status.kind === 'saving' || locked}
        onClick={() => { if (!locked) onSave(data); }}
        style={{ padding: '6px 14px', borderRadius: 6, border: 0, background: '#1d4ed8', color: '#fff', fontSize: 14, cursor: locked ? 'not-allowed' : 'pointer', opacity: locked ? 0.5 : 1 }}
      >
        Save
      </button>
    </span>
  );
}

export default function EditorApp({ locale, page, raw, baseHash, schema, initialData, overHero, trustedOrigin, siteBlocks, refs, slugs }: EditorAppProps) {
  const [status, setStatus] = useState<Status>({ kind: 'idle', text: '' });
  const statusRef = useRef(status);
  statusRef.current = status;

  // #1415 —— 存盘的底。首屏是构建时烤进来的那份；dashboard 的 baseline 到了就换（见文件头）。放在 ref 里：
  // 它只在存盘那一刻被读，换它不该让整棵 Puck 重新渲染。
  const baseRef = useRef<Base>({ raw, initial: initialData, hash: baseHash, saved: raw, siteBlocks: siteBlocks || {}, sharedOwn: {} });
  // #1406 —— 「在 N 个页面上」那句话读的三样（context，见 SharedInfoContext）。
  const [sharedInfo, setSharedInfo] = useState<SharedInfo>({ siteBlocks: siteBlocks || {}, refs: refs || {}, slugs: slugs || [] });
  const config = useMemo(
    () => buildConfig(schema, locale, overHero, (id) => sharedRemovable(baseRef.current.siteBlocks, id)),
    [schema, locale, overHero],
  );
  // #1406 —— 老板在画布上拖过的块（Puck id）。按 `visibility` 注进来的共用块只有拖过的才写成这一页的 `{ref}`
  // （`editor-convert.js` §puckToPage 的 `moved`）。换一份新画布（open / external）时清空。
  const movedRef = useRef<Set<string>>(new Set());
  // 这一次存盘送出去的 JSON：`saved` 到了才算它进了文件（「Nothing to save」要跟它比，不跟打开时比）。
  const sendingRef = useRef<{ json: Record<string, unknown> | null; root: Record<string, unknown> | null; shared: SharedChanges | null } | null>(null);
  const [canvas, setCanvas] = useState<{ key: number; data: PuckLikeData }>({ key: 0, data: initialData });
  const dispatchRef = useRef<PuckDispatch | null>(null);
  const getPuckRef = useRef<GetPuck | null>(null);

  // #1410 —— 聊天。`chat` 是 dashboard 递进来的整份状态（这里不存副本、不拼）。
  const [chat, setChat] = useState<EditorChatState | null>(null);
  const [chatOpen, setChatOpen] = useState(true);
  const [chatNotice, setChatNotice] = useState<{ kind: 'info' | 'error'; text: string } | null>(null);
  // 先存再发：等存盘结果的那条消息。存成功才交给 dashboard；被拒就不发（做什么 4）。
  const pendingChatRef = useRef<{ text: string; scope: ChatScope | null } | null>(null);
  const [chatPending, setChatPending] = useState(false);
  // 最近那次 AI 记下的那一步（Puck 历史条目的 id）+ 它有没有同时改共用块（状态栏那一句，见 §DirtyNote）。
  const [aiStep, setAiStep] = useState<{ id: string; mixed: boolean } | null>(null);
  // §useAiLockGuard：点了发送、还没交给 dashboard（先存那一笔在路上）也算 —— 那一笔存的是点下去那一刻的画布。
  const locked = chatPending || !!chat?.busy;
  useAiLockGuard(locked);

  // 告诉 dashboard「编辑器起来了、我编辑的是哪一页」。它拿这条确认 iframe 里真的是编辑器。
  // `baseline: 1` 说「我认 ai1st:editor-baseline」—— dashboard 据此决定走新路（不重载 iframe）还是老路
  // （#1409 之后、#1415 之前建的站：这个键不在，dashboard 照旧在重建完重载 iframe，行为跟今天一样）。
  useEffect(() => {
    if (!trustedOrigin || window.parent === window) return;
    window.parent.postMessage({ type: 'ai1st:editor-ready', page, locale, baseline: 1 }, trustedOrigin);
  }, [trustedOrigin, page, locale]);

  // dashboard 发来的两种消息。🔴 只认那一个 origin。
  useEffect(() => {
    if (!trustedOrigin) return;
    function onMessage(e: MessageEvent) {
      if (e.origin !== trustedOrigin) return;
      const d = e.data as {
        type?: unknown; ok?: unknown; message?: unknown; page?: unknown; locale?: unknown; reason?: unknown; hash?: unknown;
        raw?: unknown; siteBlocks?: unknown; blocks?: unknown; located?: unknown; weights?: unknown; refs?: unknown; slugs?: unknown;
      };
      if (!d || typeof d !== 'object') return;
      if (d.type === 'ai1st:editor-save-result') {
        const text = typeof d.message === 'string' ? d.message : '';
        setStatus(d.ok === true ? { kind: 'saved', text: text || 'Saved.' } : { kind: 'error', text: text || 'Could not save.' });
        if (d.ok !== true) sendingRef.current = null;
        // #1410 —— 先存再发：这一次存盘是为那条聊天消息做的。存上了才发；没存上就不发，把原因说出来
        // （exit 10 那句「这一页在别处改过了，关掉编辑器重新打开」由 worker 写好，原样用）。
        const pc = pendingChatRef.current;
        if (pc) {
          pendingChatRef.current = null;
          if (d.ok === true) {
            postChat({ type: 'ai1st:chat-send', text: pc.text, ...(pc.scope ? { scope: pc.scope } : {}) });
          } else {
            setChatPending(false);
            setChatNotice({ kind: 'error', text: `Your message was not sent. ${text || 'Your changes could not be saved first.'}` });
          }
        }
        return;
      }
      if (d.type === 'ai1st:chat-state') {
        const st = (d as { state?: unknown }).state;
        if (st && typeof st === 'object') setChat(st as EditorChatState);
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
        sendingRef.current = null;
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
      // #1405 —— 底稿里只有页面（`pageToPuck` 回的 root 是空的）；外壳四样沿用手上的比较基准（打开时构建算出来
      // 的那份，存过就是存下去的那份）。不接上的话 root 字段全空，画布的顶栏页脚会变成默认、存盘的逐字段比较也全乱。
      next = { ...next, root: baseRef.current.initial.root };
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
      if (d.reason === 'ai' && g && dispatchRef.current) {
        // #1410 —— AI 改完。§aiBaselineStep：这一页的页面 JSON 变了（hash 不同）⟹ 记成一步；否则只换画布（共用块）。
        const step = aiBaselineStep({
          current: g.appState.data as unknown as PuckLikeData,
          histories: g.history.histories as unknown as { state: { data: PuckLikeData } }[],
          next, hash: baseRef.current.hash, nextHash: d.hash as string,
        });
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
      const same = deepEqual(next, baseRef.current.initial);
      // 画布换成新的一份时，共用块的字段就是按 nextLib 取的 ⟹ `sharedOwn` 清空；画布不动（same）就留着。
      baseRef.current = { raw: nextRaw, initial: next, hash: d.hash as string, saved: nextRaw, siteBlocks: nextLib, sharedOwn: same ? baseRef.current.sharedOwn : {} };
      setSharedInfo({ siteBlocks: nextLib, refs: isObj(d.refs) ? (d.refs as Record<string, string[]>) : {}, slugs: Array.isArray(d.slugs) ? (d.slugs as string[]) : [] });
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
    // #1405 —— 外壳四样只交**改过的**那几个字段（跟 `base.initial.root` 逐字段比，做什么 7；它是打开时的值，
    // 每存成功一次就换成刚存下去的值，道理同上）。页面块没改就不交页面：不然一次只改公告条的存盘也要带着
    // 页面底稿去比 baseHash，别处刚改过这一页时它会被无端拒掉。
    const root = puckRootChanges({ initial: base.initial, now: data as never, schema });
    const pageChanged = !deepEqual(json, base.saved);
    const hasShared = Object.keys(shared).length > 0;
    if (!pageChanged && Object.keys(root).length === 0 && !hasShared) return null;
    return { base, json, shared, root, pageChanged, hasShared };
  }

  // 状态栏用：转不出来也算「有没存的」（按 Save 会把原因说出来）。
  const dirtyOf = useMemo(() => (data: Data) => {
    try { return planSave(data) !== null; } catch { return true; }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [schema, page, status]);

  /** 'sent' = 交给 dashboard 了（结果回 `ai1st:editor-save-result`）· 'nothing' = 没有要存的 · 'error' = 没交出去。 */
  function save(data: Data): 'sent' | 'nothing' | 'error' {
    if (!trustedOrigin || window.parent === window) {
      setStatus({ kind: 'error', text: 'Open this editor from your dashboard to save.' });
      return 'error';
    }
    let plan: ReturnType<typeof planSave>;
    try {
      plan = planSave(data);
    } catch (e) {
      setStatus({ kind: 'error', text: `Could not save: ${(e as Error).message}` });
      return 'error';
    }
    if (!plan) {
      setStatus({ kind: 'idle', text: 'Nothing to save.' });
      return 'nothing';
    }
    const { base, json, shared, root, pageChanged, hasShared } = plan;
    setStatus({ kind: 'saving', text: 'Saving…' });
    sendingRef.current = { json: pageChanged ? json : null, root: Object.keys(root).length ? root : null, shared: hasShared ? shared : null };
    // 不带文件路径：写哪个文件由站里的脚本按 page/locale 自己算（`write-page.js` 文件头说为什么）。
    window.parent.postMessage({
      type: 'ai1st:editor-save',
      page,
      locale,
      ...(pageChanged ? { json, baseHash: base.hash } : {}),
      ...(Object.keys(root).length ? { root } : {}),
      ...(hasShared ? { shared } : {}),
    }, trustedOrigin);
    return 'sent';
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
    // 做什么 4：画布上有没存的改动 ⟹ 先存。AI 改的是磁盘，它看不见这里没存的那份。
    const r = save(g.appState.data);
    if (r === 'nothing') {
      postChat({ type: 'ai1st:chat-send', text, ...(scope ? { scope } : {}) });
      return;
    }
    if (r === 'error') {
      setChatPending(false);
      setChatNotice({ kind: 'error', text: 'Your message was not sent, because your changes could not be saved first. See the message next to Save.' });
      return;
    }
    pendingChatRef.current = { text, scope };
    setChatNotice({ kind: 'info', text: 'Saving your changes first, then sending…' });
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
    dispatchRef, getPuckRef, dirtyOf, aiStep, save, status,
    chatOpen, openChat: () => setChatOpen(true), closeChat: () => setChatOpen(false),
    chat, chatNotice, chatPending, page, locale,
    rawKey: Array.isArray((baseRef.current.raw as { sections?: unknown }).sections) && !('blocks' in baseRef.current.raw) ? 'sections' : 'blocks',
    sendChat, revertChat: (messageId) => postChat({ type: 'ai1st:chat-revert', messageId }),
  };

  return (
    <SharedInfoContext.Provider value={sharedInfo}>
    <EditorUiContext.Provider value={ui}>
    <div data-editor-root style={{ height: '100vh' }}>
      <Puck
        key={canvas.key}
        config={config}
        data={canvas.data as unknown as Data}
        iframe={{ enabled: true, syncHostStyles: true, waitForStyles: true }}
        onAction={onAction as never}
        overrides={EDITOR_OVERRIDES}
        permissions={locked ? LOCKED_PERMISSIONS : OPEN_PERMISSIONS}
        onPublish={(d: Data) => { if (!locked) save(d); }}
      />
    </div>
    </EditorUiContext.Provider>
    </SharedInfoContext.Provider>
  );
}
