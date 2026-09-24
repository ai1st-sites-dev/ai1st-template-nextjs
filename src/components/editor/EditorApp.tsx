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

import { createContext, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Puck, FieldLabel, createUsePuck, type Config, type Data, type Field, type Fields, type PuckAction } from '@puckeditor/core';
import '@puckeditor/core/puck.css';
import SectionRenderer from '@/components/SectionRenderer';
import SiteShell from '@/components/SiteShell';
import type { BlockConfig } from '@/lib/types/config';
import type { EditorComponent, EditorField, EditorSchema } from '../../../scripts/lib/editor-schema';
import type { PuckItemSrc, PuckLikeData, SharedChanges } from '../../../scripts/lib/editor-convert';
import {
  UNKNOWN_TYPE, pageToPuck, puckToPage, fieldProps, dataFromProps, deepEqual, puckRootChanges,
  sharedReach, sharedRemovable, puckSharedChanges, sharedOwnAfter, applySharedChanges,
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
function DispatchHandle({ handle }: { handle: { current: PuckDispatch | null } }) {
  handle.current = usePuck((s) => s.dispatch) as unknown as PuckDispatch;
  return null;
}

function SaveButton({ onSave, status }: { onSave: (d: Data) => void; status: Status }) {
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
        disabled={status.kind === 'saving'}
        onClick={() => onSave(data)}
        style={{ padding: '6px 14px', borderRadius: 6, border: 0, background: '#1d4ed8', color: '#fff', fontSize: 14, cursor: 'pointer' }}
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
      if (d.reason !== 'open' && d.reason !== 'external') return;
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
      const same = deepEqual(next, baseRef.current.initial);
      // 画布换成新的一份时，共用块的字段就是按 nextLib 取的 ⟹ `sharedOwn` 清空；画布不动（same）就留着。
      baseRef.current = { raw: nextRaw, initial: next, hash: d.hash as string, saved: nextRaw, siteBlocks: nextLib, sharedOwn: same ? baseRef.current.sharedOwn : {} };
      setSharedInfo({ siteBlocks: nextLib, refs: isObj(d.refs) ? (d.refs as Record<string, string[]>) : {}, slugs: Array.isArray(d.slugs) ? (d.slugs as string[]) : [] });
      if (same) return; // 跟首屏一样（构建之后没人改过）：画布不动，不打断已经开始的编辑。
      movedRef.current = new Set();
      if (d.reason === 'external' && dispatchRef.current) {
        dispatchRef.current({ type: 'setData', data: next as unknown as Data, recordHistory: false });
      } else {
        // open：换一个新的 Puck —— 撤销历史跟着清零（历史里那几步是对着烤进去的那份做的）。
        setCanvas((c) => ({ key: c.key + 1, data: next }));
      }
    }
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, [trustedOrigin, page, locale, schema]);

  function save(data: Data) {
    if (!trustedOrigin || window.parent === window) {
      setStatus({ kind: 'error', text: 'Open this editor from your dashboard to save.' });
      return;
    }
    const base = baseRef.current;
    let json: Record<string, unknown>;
    let shared: SharedChanges;
    try {
      json = puckToPage({ raw: base.raw, data: data as never, initial: base.initial, schema, slug: page, moved: movedRef.current });
      // #1406 —— 共用块改了字 / 从这一页删了（而它的 visibility 列了这一页）：写块库那几处。
      shared = puckSharedChanges({ data: data as never, initial: base.initial, siteBlocks: base.siteBlocks, schema, slug: page, own: base.sharedOwn });
    } catch (e) {
      setStatus({ kind: 'error', text: `Could not save: ${(e as Error).message}` });
      return;
    }
    // 跟**上一次存下去的那份**比，不跟打开时比：存过一次之后把字改回原来那句，文件里是改过的那句，
    // 这一笔必须发出去（#1409 QA2 r1 第 2 条，那时靠重载 iframe 解决，#1415 起不再重载）。
    // #1405 —— 外壳四样只交**改过的**那几个字段（跟 `base.initial.root` 逐字段比，做什么 7；它是打开时的值，
    // 每存成功一次就换成刚存下去的值，道理同上）。页面块没改就不交页面：不然一次只改公告条的存盘也要带着
    // 页面底稿去比 baseHash，别处刚改过这一页时它会被无端拒掉。
    const root = puckRootChanges({ initial: base.initial, now: data as never, schema });
    const pageChanged = !deepEqual(json, base.saved);
    const hasShared = Object.keys(shared).length > 0;
    if (!pageChanged && Object.keys(root).length === 0 && !hasShared) {
      setStatus({ kind: 'idle', text: 'Nothing to save.' });
      return;
    }
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

  return (
    <SharedInfoContext.Provider value={sharedInfo}>
    <div data-editor-root style={{ height: '100vh' }}>
      <Puck
        key={canvas.key}
        config={config}
        data={canvas.data as unknown as Data}
        iframe={{ enabled: true, syncHostStyles: true, waitForStyles: true }}
        onAction={onAction as never}
        overrides={{
          headerActions: () => (
            <>
              <DispatchHandle handle={dispatchRef} />
              <SaveButton onSave={save} status={status} />
            </>
          ),
        }}
        onPublish={save}
      />
    </div>
    </SharedInfoContext.Provider>
  );
}
