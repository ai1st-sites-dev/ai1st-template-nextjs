'use client';

// #1755 —— 改一颗按钮只有这一套控件：Link Type 五选一（Page link · External link · Email · Phone · Page section）+ 那一类的一格
//   （+ Button label）。两处用它，长得一样：
//   · 画布上点按钮开的弹窗（EditorApp §DesignPopover 的 `button` 那一支，Done / Cancel 跟 Design 面板同一个事务）；
//   · Content 页 / 右栏里按钮列表（`ctas` / `introCtas`，schema 的 `button: true`）展开的那一项（§buttonHrefField 顶替原来的 Link 格，
//     Button label 是紧跟着的那一格文字）。
//   #1779 —— 顶栏的两颗按钮（Design 面板 Content 页 + 画布上点它开的弹窗）也用它，只列四类（§REGION_LINK_TYPES）。
// 选中哪一类不另存：由 `href` 推（`scripts/lib/button-link.js` 文件头那张表）。刚点了一类、那一格还空着（`href` 是空串）时按刚点的那一类显示。

import { createContext, useContext, useMemo, useState, type CSSProperties, type ReactNode } from 'react';
import { createUsePuck, type Field } from '@puckeditor/core';
import { InlineApiContext } from './InlineEdit';
import { SOURCES } from '@/lib/sections/item-sources';
import { localeUrl } from '@/lib/config';
import { LINK_TYPES, linkTypeOf, hrefFor, externalUrl, withButton, type LinkType } from '../../../scripts/lib/button-link.js';
import type { SiteData } from '@/lib/types/config';

const usePuck = createUsePuck();

const TYPE_LABEL: Record<LinkType, string> = { page: 'Page link', external: 'External link', email: 'Email', phone: 'Phone', section: 'Page section' };

const INPUT: CSSProperties = { width: '100%', padding: '6px 8px', fontSize: 14, border: '1px solid #d0d5dd', borderRadius: 6, fontFamily: 'inherit', background: '#fff', color: '#101828', boxSizing: 'border-box' };
const LABEL: CSSProperties = { display: 'block', fontSize: 13, fontWeight: 600, color: '#344054', margin: '0 0 4px' };
const ROW: CSSProperties = { marginBottom: 12 };
const chip = (on: boolean, off: boolean): CSSProperties => ({
  padding: '6px 10px', borderRadius: 8, fontSize: 13, fontFamily: 'inherit', whiteSpace: 'nowrap', cursor: off ? 'default' : 'pointer',
  border: on ? '1px solid #1d4ed8' : '1px solid #d0d5dd', background: on ? '#eff4ff' : '#fff', color: on ? '#1d4ed8' : '#344054', fontWeight: on ? 600 : 500,
});

/**
 * #1755 r4 —— 编辑器递进来的两样（EditorApp 提供；不在编辑器里 = null，下面照构建时那份显示、不出指路）：
 *   · `liveSite`：构建时那份站点数据，Business info 换成 Page 面板里的现值（就是 EditorApp §withBusinessInfo，画布按它画）——
 *     弹窗里显示的号码 / 邮箱跟画布上那颗按钮同一份，老板刚在 Business info 里改了也对得上；
 *   · `openBusinessInfo`：「去 Website → Name & contact 改」那一下 —— 弹窗开着就先 Done（存下来，不退），再打开右栏的 Name & contact。
 */
export const ButtonLinkEnvContext = createContext<{
  liveSite: (site: SiteData, locale: string, root: Record<string, unknown>) => SiteData;
  openBusinessInfo: () => void;
} | null>(null);

/** 这颗按钮的 `{source: "phone" | "email"}` 构建出来是哪个号码 / 邮箱（同一个展开函数，`item-sources.js` §contactFact）。空 = 那一格没填。 */
export function contactText(kind: 'phone' | 'email', ref: unknown, site: SiteData): string {
  const src = (SOURCES as Record<string, { fact?: (r: unknown, c: unknown) => { text?: string } | null }>)[kind];
  const fact = src && src.fact ? src.fact({ source: kind, ...(ref && typeof ref === 'object' ? ref : {}) }, { brand: site.brand }) : null;
  return (fact && fact.text) || '';
}

const HINT: CSSProperties = { fontSize: 12, color: '#667085', margin: '6px 0 0', lineHeight: 1.4 };
const HINT_LINK: CSSProperties = { padding: 0, border: 0, background: 'none', color: '#1d4ed8', font: 'inherit', cursor: 'pointer', textDecoration: 'underline' };

type PuckItem = { type: string; props: { id?: unknown; _src?: { pid?: unknown; view?: { id?: unknown } } } };

/**
 * 当前这一页能链过去的块：块的名字 + 它在页上的序号（`Services #2`），值是它在页面上的锚点 id（= 页面 JSON 里块的 id，`blockAttrs.ts`）。
 * 🔴 只列页面 JSON 里已经有的块：刚拖进来 / 刚复制出来、还没存过的块，页面 id 要到存盘时才定（`editor-convert.js` §puckToPage 的 newId），
 *    画布上那个 id 存完就不在了 —— 链过去会指空。
 */
function useSections(): { value: string; label: string }[] {
  const content = usePuck((s) => s.appState.data.content) as unknown as PuckItem[];
  const api = useContext(InlineApiContext);
  return useMemo(() => {
    const out: { value: string; label: string }[] = [];
    (content || []).forEach((it, i) => {
      const src = it.props && it.props._src;
      const anchor = src && src.view ? src.view.id : undefined;
      if (!src || it.props.id !== src.pid || typeof anchor !== 'string' || !anchor) return;
      const name = api?.components.get(it.type)?.label || it.type;
      out.push({ value: anchor, label: `${name} #${i + 1}` });
    });
    return out;
  }, [content, api]);
}

/** 这个站这个语言的页面（`SiteData.pagesByLocale`）：名字 + 站内地址（跟导航同一个 §localeUrl）。 */
function pagesOf(site: SiteData, locale: string): { value: string; label: string }[] {
  const pages = (site.pagesByLocale && site.pagesByLocale[locale]) || [];
  return pages.map((p) => ({ value: localeUrl(site, p.slug, locale), label: p.navLabel || p.title || p.slug }));
}

/** 下拉：现值不在选项里（页面删了、块删了、手写的地址）也照样显示它，不悄悄换成别的。 */
function Choice({ attr, value, options, empty, onChange, readOnly, label }: {
  attr: string; value: string; options: { value: string; label: string }[]; empty: string; onChange: (v: string) => void; readOnly?: boolean; label: string;
}) {
  const known = !value || options.some((o) => o.value === value);
  return (
    <select {...{ [attr]: '' }} aria-label={label} value={value} disabled={readOnly} onChange={(e) => onChange(e.target.value)} style={INPUT}>
      <option value="">{empty}</option>
      {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
      {!known && <option value={value}>{value}</option>}
    </select>
  );
}

/**
 * #1779 —— 顶栏的两颗按钮只给这四类：顶栏画在每一页上，Page section 存的是「这一页的某一块」，到了别的页就指空
 * （同 #1781 菜单那条；而且 `#…` 也过不了 navigation.json 那道链接判据）。
 */
export const REGION_LINK_TYPES: readonly LinkType[] = ['page', 'external', 'email', 'phone'];

/**
 * Link Type 那一排 + 所选那一类的一格。`value` 是这颗按钮的 `href`（字符串或 `{source}` 引用），`onChange` 交回新的 `href`。
 * `types`：列哪几类（默认五类全列）。存着的 `href` 推出来的那一类不在里面时（手写过 `#…`）照样亮着它，不悄悄改值。
 */
export function ButtonLinkFields({ value, onChange, readOnly, site, locale, types = LINK_TYPES }: {
  value: unknown; onChange: (v: unknown) => void; readOnly?: boolean; site: SiteData; locale: string; types?: readonly LinkType[];
}) {
  const sections = useSections();
  const env = useContext(ButtonLinkEnvContext);
  const rootProps = usePuck((s) => (s.appState.data.root as { props?: Record<string, unknown> } | undefined)?.props);
  const live = env && rootProps ? env.liveSite(site, locale, rootProps) : site;
  const inferred = linkTypeOf(value);
  // 刚点的那一类：`href` 还是空的（Page link 什么都没选的样子）时才用它，一填上就以 `href` 推出来的为准。
  const [picked, setPicked] = useState<LinkType | null>(null);
  const empty = inferred.type === 'page' && !inferred.value;
  const type: LinkType = picked && empty ? picked : inferred.type;
  const pick = (t: LinkType) => {
    if (readOnly || t === type) return;
    setPicked(t);
    onChange(t === 'email' || t === 'phone' ? hrefFor(t, { business: true }) : '');
  };
  const locations = Array.isArray(live.brand && live.brand.locations) ? live.brand.locations : [];
  const ref = value && typeof value === 'object' ? (value as { source?: unknown; location?: unknown }) : null;
  const at = ref && Number.isInteger(ref.location) ? (ref.location as number) : 0;

  let cell: ReactNode = null;
  if (type === 'page') {
    cell = (
      <div style={ROW}>
        <label style={LABEL}>Page</label>
        <Choice attr="data-editor-button-page" label="Page" value={inferred.type === 'page' ? inferred.value : ''} options={pagesOf(site, locale)} empty="Choose a page"
          onChange={(v) => onChange(hrefFor('page', { value: v }))} readOnly={readOnly} />
      </div>
    );
  } else if (type === 'section') {
    cell = (
      <div style={ROW}>
        <label style={LABEL}>Section</label>
        <Choice attr="data-editor-button-section" label="Section" value={inferred.type === 'section' ? inferred.value : ''} options={sections} empty="Choose a section on this page"
          onChange={(v) => onChange(hrefFor('section', { value: v }))} readOnly={readOnly} />
      </div>
    );
  } else if (type === 'external') {
    const text = inferred.type === 'external' ? inferred.value : '';
    cell = (
      <div style={ROW}>
        <label style={LABEL}>URL</label>
        {/* 打字时原样存（补协议会让光标跳到末尾）；离开这一格再补 https://（§externalUrl）。 */}
        <input data-editor-button-url="" type="text" aria-label="URL" value={text} readOnly={readOnly} placeholder="https://…"
          onChange={(e) => onChange(e.target.value)}
          onBlur={(e) => { const v = externalUrl(e.target.value); if (v !== e.target.value) onChange(v); }} style={INPUT} />
      </div>
    );
  } else {
    // email / phone：默认本店那个（引用，店里换号码按钮跟着变）；另有一项「Other …」才出输入框。
    const isPhone = type === 'phone';
    const business = inferred.type === type ? inferred.business !== false : true;
    const other = isPhone ? 'Other number' : 'Other email';
    const attr = isPhone ? 'phone' : 'email';
    const prefix = isPhone ? 'tel:' : 'mailto:';
    // #1755 r4 —— Business 那一项把值本身写出来（这颗按钮构建出来会拨 / 会发的那个，多门店跟着下面选的那一家）；空的说清楚是空的。
    const businessName = isPhone ? 'Contact phone' : 'Contact email';
    const known = contactText(type, business ? ref : null, live);
    // 指路只在它为真时出：Website → Name & contact 那一格 Phone 只管第一家（§withBusinessInfo 写 `locations[0]`），邮箱整站一份。
    const fixable = !!env && !readOnly && business && (!isPhone || at === 0);
    cell = (
      <div style={ROW}>
        <label style={LABEL}>{isPhone ? 'Phone number' : 'Email address'}</label>
        <select {...{ [`data-editor-button-${attr}-mode`]: '' }} aria-label={isPhone ? 'Phone number' : 'Email address'} value={business ? 'business' : 'other'} disabled={readOnly}
          onChange={(e) => onChange(e.target.value === 'business' ? hrefFor(type, { business: true }) : prefix)} style={{ ...INPUT, marginBottom: 6 }}>
          <option value="business">{`${businessName} · ${known || 'not set yet'}`}</option>
          <option value="other">{other}</option>
        </select>
        {business && locations.length > 1 && (
          // 多门店：是哪一家（同 EditorApp §LinkHrefControl，第一家不写 `location`）。
          <select data-editor-link-location="" aria-label="Location" value={String(at)} disabled={readOnly} style={INPUT}
            onChange={(e) => onChange(hrefFor(type, { business: true, location: Number(e.target.value) }))}>
            {locations.map((l, i) => <option key={i} value={String(i)}>{l.label || l.address || `Location ${i + 1}`}</option>)}
          </select>
        )}
        {fixable && (
          <p data-editor-button-business-hint="" style={HINT}>
            {known ? '' : `No ${isPhone ? 'phone number' : 'email address'} yet. `}
            <button type="button" data-editor-button-business-settings="" style={HINT_LINK} onClick={() => env!.openBusinessInfo()}>
              {known ? 'Change it in Website → Name & contact' : 'Add it in Website → Name & contact'}
            </button>
          </p>
        )}
        {!business && (
          <input {...{ [`data-editor-button-${attr}`]: '' }} type={isPhone ? 'tel' : 'email'} aria-label={other}
            value={inferred.type === type ? inferred.value : ''} readOnly={readOnly} placeholder={isPhone ? '+1 416 555 0100' : 'name@example.com'}
            // 打字时原样存（去空格会吞掉刚打的空格）；离开这一格再整理（§hrefFor：号码去空白、邮箱去两头空白）。
            onChange={(e) => onChange(`${prefix}${e.target.value}`)}
            onBlur={(e) => { const v = hrefFor(type, { business: false, value: e.target.value }); if (v !== `${prefix}${e.target.value}`) onChange(v); }}
            style={INPUT} />
        )}
      </div>
    );
  }

  return (
    <div data-editor-button-link="" data-editor-button-link-type={type}>
      <div style={ROW}>
        <span style={LABEL}>Link Type</span>
        <div role="radiogroup" aria-label="Link Type" style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
          {LINK_TYPES.filter((t) => types.includes(t) || t === type).map((t) => (
            <button key={t} type="button" role="radio" aria-checked={t === type} data-editor-link-type={t} disabled={readOnly}
              onClick={() => pick(t)} style={chip(t === type, !!readOnly)}>{TYPE_LABEL[t]}</button>
          ))}
        </div>
      </div>
      {cell}
    </div>
  );
}

/**
 * 一颗按钮整份：Link Type + 那一格 + Button label。弹窗用它；`item` 是 `{label, href, …}`，`onChange` 交回换了 `label` / `href` 的整项（别的键原样）。
 * #1780 —— 顶栏上面那一行的一项也用它（`labelText` = 「Link label」，`labelHint` = 空着时显示什么）。
 */
export function ButtonEditor({ item, onChange, readOnly, site, locale, types, labelText = 'Button label', labelHint }: {
  item: Record<string, unknown>; onChange: (next: Record<string, unknown>) => void; readOnly?: boolean; site: SiteData; locale: string; types?: readonly LinkType[];
  labelText?: string; labelHint?: string;
}) {
  return (
    <div data-editor-button-editor="">
      <ButtonLinkFields value={item.href} onChange={(href) => onChange(withButton(item, { href }))} readOnly={readOnly} site={site} locale={locale} types={types} />
      <div style={ROW}>
        <label style={LABEL}>{labelText}</label>
        <input data-editor-button-label="" type="text" aria-label={labelText} value={typeof item.label === 'string' ? item.label : ''} readOnly={readOnly}
          placeholder={labelHint} onChange={(e) => onChange(withButton(item, { label: e.target.value }))} style={INPUT} />
        {labelHint ? <p data-editor-button-label-hint="" style={HINT}>{`Leave it empty to show ${labelHint}.`}</p> : null}
      </div>
    </div>
  );
}

/** 按钮列表每一项的 `href` 那一格（Content 页 / 右栏）：顶替原来的「Custom link / Business phone …」下拉。 */
export function buttonHrefField(site: SiteData, locale: string): Field {
  return {
    type: 'custom',
    label: 'Link Type',
    render: ({ value, onChange, readOnly }: { value: unknown; onChange: (v: unknown) => void; readOnly?: boolean }) => (
      <ButtonLinkFields value={value} onChange={onChange} readOnly={readOnly} site={site} locale={locale} />
    ),
  } as unknown as Field;
}
