'use client';

// #1657 —— 画布里点字直接改 + 四个 AI 按钮（更长 / 更短 / 口语 / 正式）。
//
// 🔴 不开 Puck 字段的 `contentEditable`（PM 2026-10-08 裁定）：开了之后 Puck 把交给块组件的那一格换成 React 元素，
//    而块组件里对文字有一百多处按字符串的判断（hero 按钮、faq 问答是按字符串**筛列表**的）—— 元素过不去，按钮和问答
//    整条消失。这里改走画布上的点击层，一个 `Section.tsx` 都不动。
//
// ── 一段字从被点到写回 ──────────────────────────────────────────────────────────────────────────────
//   ① 登记：每段老板能改的字（`[data-slot]`，去掉序号后在这一块的 `inline` 清单里）用 Puck 自己的
//      `registerOverlayPortal` 登记 —— Puck 给画布注入了 `[data-puck-component] * { pointer-events: none }`，
//      不登记就收不到鼠标。块会重画，所以用 MutationObserver 跟着补登记。
//   ② 点到：照 Puck 自己 `InlineTextField` 的做法（dist/index.js:10061-10073）—— `preventDefault` + `stopPropagation`，
//      再自己把这一块选中（`setUi({ itemSelector })`）。🔴 不能只 preventDefault：这一下会冒到 Puck 预览框的 React
//      onClick，它见目标不是块本身就把选中清掉。链接不导航靠 preventDefault（CanvasLinkGuard 也照样拦）。
//   ③ 对回数据：`scripts/lib/inline-edit.js` §resolveInlineSlot（画布序号 → 真实下标，对不上不让改；引用列表、锁住的块点不动）。
//   ④ 打字：元素本身变成 `contenteditable=plaintext-only`。每敲一个字经 Puck 的 `replace` 写回那一格（不记撤销历史，
//      右栏、自动保存照常跟着变）；打完（失焦 / 回车 / Esc）再记一笔撤销历史 ⟹ Ctrl+Z 一次退回打之前。
//      🔴 打字期间这一格在画布上**冻结**成打之前的值（§InlineFreezeContext，EditorApp 的 CanvasBlock 读它）：不冻结的话
//      React 每敲一个字就把那个文本节点的 nodeValue 重写一遍，光标跳回开头。打完先把元素的子节点还成 React 手上那几个
//      （浏览器打字时可能删掉文本节点、塞一个 <br>），再解冻让 React 按新值对账。🔴 不用「整块换 key 重挂」：失焦就重挂的话，
//      从一段字直接点到同一块的另一段字，按下去的那个元素在松开之前就被换掉了，那一下点击丢了。
//   ⑤ AI：工具条四个按钮作用于整个字段。iframe ── postMessage(ai1st:ai-rewrite) ──▶ dashboard（带凭证打 manager
//      `POST /api/sites/{id}/ai/rewrite`）── postMessage(ai1st:ai-rewrite-result) ──▶ 这里（EditorApp 收发，§InlineApi.rewrite）。
//      回来的字经同一个 `replace` 写进去、记一笔撤销历史。等 AI 的这几秒里那一格被改过 ⟹ 不覆盖，说一句。
//
// 数字 / 价格 / 事实类字段（`ai: false`）能打字、不出工具条；`content.body`（`typing: false`）只出工具条、打字去右栏。

import { createContext, useContext, useEffect, useRef, useState, type CSSProperties } from 'react';
import { createPortal } from 'react-dom';
import { registerOverlayPortal, useGetPuck } from '@puckeditor/core';
import type { EditorComponent } from '../../../scripts/lib/editor-schema';
import { resolveInlineSlot, setAt, getAt, typedValue, type InlinePath } from '../../../scripts/lib/inline-edit.js';
import { describeRef, itemSourceContext, resolveItemSources, SOURCED_KEY } from '@/lib/sections/item-sources';
import type { BlockConfig, SiteData } from '@/lib/types/config';

/** 正在打字的那一格：画布上这一格冻结成 `value`（打之前的值），React 不去碰浏览器正在改的那几个 DOM 节点。 */
export type InlineFreeze = { id: string; path: InlinePath; value: unknown } | null;
export const InlineFreezeContext = createContext<InlineFreeze>(null);

export const REWRITE_ACTIONS = ['longer', 'shorter', 'casual', 'professional'] as const;
export type RewriteAction = (typeof REWRITE_ACTIONS)[number];
const ACTION_LABELS: Record<RewriteAction, string> = { longer: 'Make longer', shorter: 'Make shorter', casual: 'More casual', professional: 'More professional' };
/** #1683 —— 卡片第一行的输入框：老板用自己的话说怎么改（`action: 'custom'`）。不在 REWRITE_ACTIONS 里 —— 那是四个药丸的清单。 */
type AiBusy = RewriteAction | 'custom';

export type RewriteResult = { ok: true; fields: { name: string; text: string }[] } | { ok: false; message: string };

/** EditorApp 递进来的那几样（context：它随 AI 锁等变，换它不该让 Puck 重建）。 */
export type InlineApi = {
  /** AI 聊天在改这一页（EditorApp §useAiLockGuard）：不许打字、不许按 AI。 */
  locked: boolean;
  locale: string;
  page: string;
  /** 这一页的站点数据（#1665 起编辑器不再 import 编译期常量，跟画布同一份，由 EditorApp 递下来）。 */
  site: SiteData;
  components: Map<string, EditorComponent>;
  setFreeze: (f: InlineFreeze) => void;
  /** `instruction` 只跟 `action: 'custom'` 一起出现（#1683）。 */
  rewrite: (req: { action: RewriteAction | 'custom'; instruction?: string; blockType: string; fields: { name: string; text: string }[] }) => Promise<RewriteResult>;
  /** #1676 —— AI 写进去了：记一条说明，下一笔存盘的记录写 `Hero · Headline · made shorter`（EditorApp §aiNotesRef）。 */
  noteAi: (n: { id: string; path: InlinePath; action: RewriteAction; text: string }) => void;
};
export const InlineApiContext = createContext<InlineApi | null>(null);

type Item = { type: string; props: Record<string, unknown> & { id: string; _src?: { locked?: boolean } } };

/** 工具条上显示什么。`hint` = 这段字点不动，说为什么（不出按钮）。 */
type Active = {
  id: string;
  slot: string;
  blockType: string;
  el: HTMLElement;
  path: InlinePath | null;
  name: string;
  typing: boolean;
  ai: boolean;
  hint: string;
};

const LOCKED_HINT = "This section can't be edited here. It is kept as is when you save.";
const PANEL_HINT = 'Change this text in the panel on the right.';

function hintFor(why: string, sourcedRef: unknown): string {
  if (why === 'sourced') return `${describeRef(sourcedRef)} Change them there, or use “Write these items by hand” in the panel on the right.`;
  if (why === 'locked') return LOCKED_HINT;
  return PANEL_HINT;
}

/** 这一块展开时写下的 `_sourced` 的键（写成引用的槽名）—— 跟画布同一个函数、同一份站点数据。 */
function sourcedSlots(item: Item, site: SiteData, locale: string, page: string): string[] {
  try {
    const [b] = resolveItemSources([{ type: item.type, data: item.props } as unknown as BlockConfig], itemSourceContext(site, locale, page === 'home' ? undefined : page));
    const marks = (b.data as Record<string, unknown>)[SOURCED_KEY];
    return marks && typeof marks === 'object' ? Object.keys(marks as object) : [];
  } catch {
    return [];
  }
}

function visibleIn(el: Element): boolean {
  const r = el.getBoundingClientRect();
  return r.width > 0 && r.height > 0;
}

/** 块重挂之后元素换了：按块 id + `data-slot` 重新找（同一个 slot 出现两次时取看得见的那个）。 */
function relocate(doc: Document, id: string, slot: string): HTMLElement | null {
  const comp = doc.querySelector(`[data-puck-component="${CSS.escape(id)}"]`);
  if (!comp) return null;
  const all = Array.from(comp.querySelectorAll(`[data-slot="${CSS.escape(slot)}"]`)) as HTMLElement[];
  return all.find(visibleIn) || all[0] || null;
}

const BAR: CSSProperties = {
  position: 'absolute', zIndex: 2147483000, display: 'flex', alignItems: 'center', gap: 4, padding: 4,
  background: '#fff', border: '1px solid #d0d5dd', borderRadius: 8, boxShadow: '0 4px 12px rgba(16, 24, 40, 0.16)',
  fontFamily: 'system-ui, sans-serif', fontSize: 13, color: '#344054', lineHeight: 1.3, maxWidth: 520,
};
const BTN: CSSProperties = {
  padding: '4px 10px', borderRadius: 6, border: '1px solid #d0d5dd', background: '#fff', color: '#344054',
  fontSize: 13, cursor: 'pointer', fontFamily: 'inherit', whiteSpace: 'nowrap',
};
// #1683 —— AI 那一种：一张圆角卡片贴在字段下方（Durable 那种形状），宽同字段、最窄 CARD_MIN_W（屏幕像素）。
const CARD_MIN_W = 360;
const CARD: CSSProperties = {
  ...BAR, display: 'flex', flexDirection: 'column', alignItems: 'stretch', gap: 8, padding: 10, borderRadius: 12, maxWidth: 'none',
};
const PILL: CSSProperties = { ...BTN, borderRadius: 999, padding: '5px 12px' };

/**
 * 挂在 Puck 的 `iframe` override 里（EditorApp §CanvasLinkGuard）：拿到的 `doc` 就是画布那份 document。
 */
export function InlineEditLayer({ doc }: { doc: Document }) {
  const api = useContext(InlineApiContext);
  const getPuck = useGetPuck();
  const apiRef = useRef(api);
  apiRef.current = api;
  const [active, setActive] = useState<Active | null>(null);
  const activeRef = useRef<Active | null>(null);
  activeRef.current = active;
  const [busy, setBusy] = useState<AiBusy | null>(null);
  const [ask, setAsk] = useState(''); // #1683 输入框里那句
  const [note, setNote] = useState('');
  const [pos, setPos] = useState<{ top: number; left: number; scale: number; width: number } | null>(null);
  const barRef = useRef<HTMLDivElement | null>(null);
  const askRef = useRef<HTMLInputElement | null>(null);
  // 正在打字的那一格：结束它的函数（失焦 / 回车 / 换一段 / 元素没了都走它）。
  const typingRef = useRef<{ el: HTMLElement; end: (keep: boolean) => void } | null>(null);

  const itemById = (id: string): Item | undefined => {
    const g = getPuck();
    return g.getItemById(id) as unknown as Item | undefined;
  };

  /** 把 `path` 那一格换成 `value`，经 Puck 自己的 `replace` 写回（右栏、自动保存、撤销都照常）。 */
  const write = (id: string, path: InlinePath, value: unknown, recordHistory: boolean): boolean => {
    const g = getPuck();
    const item = g.getItemById(id) as unknown as Item | undefined;
    const sel = g.getSelectorForId(id);
    if (!item || !sel) return false;
    const props = setAt(item.props, path, value);
    g.dispatch({ type: 'replace', destinationIndex: sel.index, destinationZone: sel.zone, data: { ...item, props } as never, recordHistory } as never);
    return true;
  };

  const select = (id: string) => {
    const g = getPuck();
    const sel = g.getSelectorForId(id);
    if (sel) g.dispatch({ type: 'setUi', ui: { itemSelector: sel } });
  };

  // ① 登记：可改的字收得到鼠标。
  useEffect(() => {
    const seen = new WeakSet<Element>();
    let raf = 0;
    const scan = () => {
      raf = 0;
      const a = apiRef.current;
      if (!a) return;
      for (const el of Array.from(doc.querySelectorAll('[data-puck-component] [data-slot]')) as HTMLElement[]) {
        if (seen.has(el)) continue;
        const comp = el.closest('[data-puck-component]');
        const id = comp?.getAttribute('data-puck-component');
        const item = id ? itemById(id) : undefined;
        if (!item) continue; // 还没进 Puck 的数据（刚插进来）：下一轮再看
        seen.add(el);
        const component = a.components.get(item.type);
        const slot = el.getAttribute('data-slot') || '';
        const bare = slot.split('.').filter((s) => !/^\d+$/.test(s)).join('.');
        if (!component || !component.inline.some((p) => p.path === bare)) continue;
        registerOverlayPortal(el);
        el.setAttribute('data-editor-inline', '');
      }
    };
    const schedule = () => { if (!raf) raf = doc.defaultView!.requestAnimationFrame(scan); };
    scan();
    const mo = new MutationObserver(schedule);
    mo.observe(doc.body, { childList: true, subtree: true });
    return () => { mo.disconnect(); if (raf) doc.defaultView!.cancelAnimationFrame(raf); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [doc]);

  /** 结束打字：`keep` = 记一笔撤销历史（打的字留着）；false = 元素没了 / 画布被换掉，只解冻。 */
  function startTyping(a: Active, x: number, y: number) {
    const el = a.el;
    const path = a.path!;
    const before = getAt(itemById(a.id)?.props, path);
    let last = typeof before === 'string' ? before : String(before ?? '');
    apiRef.current?.setFreeze({ id: a.id, path, value: before });
    // React 手上的那几个子节点（§end 还回去）。
    const orig = Array.from(el.childNodes);
    el.setAttribute('contenteditable', 'plaintext-only');
    if (el.contentEditable !== 'plaintext-only') el.setAttribute('contenteditable', 'true'); // 老浏览器不认 plaintext-only
    el.setAttribute('data-editor-inline-typing', '');
    el.style.userSelect = 'text';
    el.style.cursor = 'text';
    el.focus({ preventScroll: true });
    const sel = doc.getSelection();
    const caret = (doc as Document & { caretRangeFromPoint?: (x: number, y: number) => Range | null }).caretRangeFromPoint?.(x, y);
    if (sel) {
      sel.removeAllRanges();
      if (caret && el.contains(caret.startContainer)) sel.addRange(caret);
      else { const r = doc.createRange(); r.selectNodeContents(el); r.collapse(false); sel.addRange(r); }
    }
    const onInput = () => {
      const v = typedValue(el.textContent || '');
      if (v === last) return;
      last = v;
      write(a.id, path, v, false);
    };
    // 键盘只归这一格：Puck 在画布 document 上收快捷键（Ctrl+Z 撤销、删块），冒上去就是打字时把整页撤一步。
    const onKey = (e: KeyboardEvent) => {
      e.stopPropagation();
      if (e.type !== 'keydown') return;
      if (e.key === 'Enter' || e.key === 'Escape') { e.preventDefault(); el.blur(); }
    };
    const onBlur = () => end(true);
    let done = false;
    const end = (keep: boolean) => {
      if (done) return;
      done = true;
      el.removeEventListener('input', onInput);
      el.removeEventListener('keydown', onKey);
      el.removeEventListener('keyup', onKey);
      el.removeEventListener('keypress', onKey);
      el.removeEventListener('blur', onBlur);
      el.removeAttribute('contenteditable');
      el.removeAttribute('data-editor-inline-typing');
      el.style.userSelect = '';
      el.style.cursor = '';
      // 子节点还成 React 手上那几个（只有一个文本节点时顺手把字换成打好的，解冻前那一帧不闪回旧字）。
      if (el.isConnected) {
        const now = Array.from(el.childNodes);
        if (now.length !== orig.length || now.some((n, i) => n !== orig[i])) el.replaceChildren(...orig);
        if (orig.length === 1 && orig[0].nodeType === Node.TEXT_NODE) orig[0].nodeValue = last;
      }
      if (keep && last !== (typeof before === 'string' ? before : String(before ?? ''))) write(a.id, path, last, true);
      apiRef.current?.setFreeze(null);
      if (typingRef.current && typingRef.current.el === el) typingRef.current = null;
    };
    el.addEventListener('input', onInput);
    el.addEventListener('keydown', onKey);
    el.addEventListener('keyup', onKey);
    el.addEventListener('keypress', onKey);
    el.addEventListener('blur', onBlur);
    typingRef.current = { el, end };
  }

  // ② 点到：选中这一块，进打字 / 出工具条 / 说为什么点不动。
  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      const t = e.target as Element | null;
      if (!t || typeof t.closest !== 'function') return;
      if (barRef.current && barRef.current.contains(t)) return;
      const el = t.closest('[data-editor-inline]') as HTMLElement | null;
      if (!el) return;
      const comp = el.closest('[data-puck-component]');
      const id = comp?.getAttribute('data-puck-component');
      if (!id) return;
      e.preventDefault();
      e.stopPropagation();
      select(id);
      const a = apiRef.current;
      if (!a) return;
      if (typingRef.current?.el === el) return; // 已经在打这一格：点一下只是挪光标
      typingRef.current?.end(true);
      if (a.locked) { setActive(null); return; }
      const item = itemById(id);
      const component = item ? a.components.get(item.type) : undefined;
      if (!item || !component) return;
      const slot = el.getAttribute('data-slot') || '';
      const sourced = sourcedSlots(item, a.site, a.locale, a.page);
      const r = resolveInlineSlot({ component, props: item.props, slot, text: el.textContent || '', sourced, locked: !!item.props._src?.locked });
      setNote('');
      if (!r.ok) {
        const ref = r.slot ? item.props[r.slot] : undefined;
        setActive({ id, slot, blockType: item.type, el, path: null, name: '', typing: false, ai: false, hint: hintFor(r.why, ref) });
        return;
      }
      const next: Active = { id, slot, blockType: item.type, el, path: r.path, name: r.name, typing: r.typing, ai: r.ai, hint: '' };
      setActive(next);
      if (r.typing) startTyping(next, e.clientX, e.clientY);
    };
    // 点到别处（工具条和正在打的那一格之外）：收起工具条。
    const onDown = (e: PointerEvent) => {
      const a = activeRef.current;
      if (!a) return;
      const t = e.target as Node | null;
      if (t && barRef.current && barRef.current.contains(t)) return;
      if (t && a.el.contains(t)) return;
      if (t && (t as Element).closest?.('[data-editor-inline]')) return; // 点另一段字：交给 click 那一支
      setActive(null);
      setNote('');
    };
    const onEsc = (e: KeyboardEvent) => { if (e.key === 'Escape' && activeRef.current && !typingRef.current) { setActive(null); setNote(''); } };
    doc.addEventListener('click', onClick, true);
    doc.addEventListener('pointerdown', onDown, true);
    doc.addEventListener('keydown', onEsc, true);
    return () => {
      doc.removeEventListener('click', onClick, true);
      doc.removeEventListener('pointerdown', onDown, true);
      doc.removeEventListener('keydown', onEsc, true);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [doc]);

  // #1683 —— 换了一段字（或工具条收起）：输入框里那句是说给上一段听的，清掉。
  useEffect(() => { setAsk(''); }, [active?.id, active?.slot]);
  // #1683 —— 键盘只归输入框（同打字那一格的 onKey）：Puck 在画布 document 上收快捷键，而它「焦点在输入框里就不删块」
  //    那道判断用的是 `instanceof HTMLElement` —— 画布是另一个 window，这一判恒假 ⟹ 在这里按一次 Backspace / Delete
  //    就删掉右栏选中的那一块（实测一次删了五块）。Ctrl+Z 同理会把整页撤一步。原生监听、在输入框上就截住。
  //    每次渲染后重挂（输入框随工具条出现 / 收起，挂在哪一个元素上以提交之后的为准）。
  useEffect(() => {
    const el = askRef.current;
    if (!el) return;
    // 截在元素上 ⟹ React 挂在画布 body 上的 onKeyDown 也收不到了，回车（发送）就在这里处理。
    const stop = (e: KeyboardEvent) => {
      e.stopPropagation();
      if (e.type === 'keydown' && e.key === 'Enter' && !e.isComposing) { e.preventDefault(); void runAi('custom'); }
    };
    for (const t of ['keydown', 'keyup', 'keypress'] as const) el.addEventListener(t, stop);
    return () => { for (const t of ['keydown', 'keyup', 'keypress'] as const) el.removeEventListener(t, stop); };
  });

  // AI 开始改这一页：手上在打的那一格收尾（打的字留着、记一笔），工具条收起。
  useEffect(() => {
    if (!api?.locked) return;
    typingRef.current?.end(true);
    setActive(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [api?.locked]);

  // 工具条跟着那段字走（滚动 / 块重挂 / 右栏拖宽都会挪它）；那段字没了（换了画布、删了块）就收起，打字中的那一格解冻。
  useEffect(() => {
    if (!active) { setPos(null); return; }
    const win = doc.defaultView!;
    let raf = 0;
    const tick = () => {
      const a = activeRef.current;
      if (!a) return;
      let el = a.el;
      if (!el.isConnected) {
        if (typingRef.current?.el === el) typingRef.current.end(false);
        const found = itemById(a.id) ? relocate(doc, a.id, a.slot) : null;
        if (!found) { setActive(null); setNote(''); return; }
        el = found;
        activeRef.current = { ...a, el };
        setActive(activeRef.current);
      }
      // 画布是缩放过的（Puck 的 66% Auto 那种）：工具条在 iframe 里按 1/zoom 放大，屏幕上才是正常字号。
      const frame = win.frameElement as HTMLElement | null;
      const zoom = frame && win.innerWidth ? (frame.getBoundingClientRect().width / win.innerWidth) || 1 : 1;
      const r = el.getBoundingClientRect();
      // #1683 —— AI 卡片：宽同字段（屏幕上量）、最窄 CARD_MIN_W，贴在字段下方，下面放不下才放上面。提示那种小条照旧在上方。
      const card = a.ai && !a.hint;
      const width = card ? Math.max(Math.round(r.width * zoom), CARD_MIN_W) : 0;
      const h = (barRef.current ? barRef.current.offsetHeight : 36) / zoom;
      const w = (card ? width : barRef.current ? barRef.current.offsetWidth : 320) / zoom;
      const gap = 8 / zoom;
      const above = r.top - h - gap;
      const below = r.bottom + gap;
      const top = (card
        ? (below + h <= win.innerHeight || above < 0 ? below : above)
        : (above >= 0 ? above : below)) + win.scrollY;
      const left = Math.max(gap, Math.min(r.left, win.innerWidth - w - gap)) + win.scrollX;
      const scale = 1 / zoom;
      setPos((p) => (p && p.top === top && p.left === left && p.scale === scale && p.width === width ? p : { top, left, scale, width }));
      raf = win.requestAnimationFrame(tick);
    };
    raf = win.requestAnimationFrame(tick);
    return () => win.cancelAnimationFrame(raf);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, doc]);

  async function runAi(action: AiBusy) {
    const a = activeRef.current;
    const ap = apiRef.current;
    if (!a || !a.path || !ap || busy) return;
    const instruction = action === 'custom' ? ask.trim() : '';
    if (action === 'custom' && !instruction) return; // 空指令不发
    typingRef.current?.end(true); // 手上打的字先落下（记一笔），AI 改的是落下之后的那一版
    const cur = getAt(itemById(a.id)?.props, a.path);
    const text = typeof cur === 'string' ? cur : String(cur ?? '');
    if (!text.trim()) { setNote('There is no text here for the AI to rewrite yet.'); return; }
    setBusy(action);
    setNote('');
    const res = await ap.rewrite({ action, ...(instruction ? { instruction } : {}), blockType: a.blockType, fields: [{ name: a.name, text }] });
    setBusy(null);
    if (!res.ok) { setNote(res.message); return; }
    const out = res.fields.find((f) => f.name === a.name);
    if (!out || !out.text.trim()) { setNote('The AI did not send back any text. Please try again.'); return; }
    const now = getAt(itemById(a.id)?.props, a.path);
    if ((typeof now === 'string' ? now : String(now ?? '')) !== text) {
      setNote('This text was changed while the AI was writing, so its version was not used.');
      return;
    }
    if (!write(a.id, a.path, out.text, true)) { setNote('This section is no longer on the page.'); return; }
    // 输入框那一路不记 AI 说明（#1683 第 4 条）：记录按今天的规则写成新值，跟手改一样。
    if (action === 'custom') setAsk('');
    else ap.noteAi({ id: a.id, path: a.path, action, text: out.text });
    setNote('');   // Chris 2026-10-09：写完不说话 —— 文字换了就是反馈，撤销走左栏记录的 Revert（#1675）
  }

  if (!active || !pos || (!active.hint && !active.ai)) return null;
  const locked = !!api?.locked;
  const off = !!busy || locked;
  return createPortal(
    <div
      ref={barRef}
      data-editor-inline-toolbar=""
      data-editor-inline-for={active.slot}
      style={{ ...(active.hint ? BAR : CARD), top: pos.top, left: pos.left, ...(pos.width ? { width: pos.width } : {}), transform: pos.scale !== 1 ? `scale(${pos.scale})` : undefined, transformOrigin: 'top left' }}
      // 按钮按下去不抢焦点：正在打的那一格不失焦，AI 那一支自己先把它收尾。
      onMouseDown={(e) => e.preventDefault()}
      // 🔴 portal 出去的 click 仍顺着 React 组件树往上冒，会冒到 Puck 预览框的 onClick —— 它见目标不是块就清掉选中
      //    （聊天框范围变回整站、右栏跳回 Page）。按钮自己的 onClick 先跑完，到这里截住。
      onClick={(e) => e.stopPropagation()}
    >
      {active.hint ? (
        <span data-editor-inline-hint="" style={{ padding: '2px 6px' }}>{active.hint}</span>
      ) : (
        <>
          {/* #1683 —— 第一行：老板用自己的话说怎么改。回车或右边的发送 = `custom`。
              按下去要能拿到焦点 ⟹ 截住冒到工具条那句 preventDefault（它是给按钮用的：按钮不抢正在打的那一格的焦点）。 */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }} onMouseDown={(e) => e.stopPropagation()}>
            <input
              ref={askRef}
              data-editor-ai-instruction=""
              type="text"
              value={ask}
              disabled={off}
              placeholder={busy === 'custom' ? 'Writing…' : 'Ask AI to rewrite this text…'}
              aria-label="Ask AI to rewrite this text"
              onChange={(e) => setAsk(e.target.value)}
              style={{ flex: 1, minWidth: 0, border: 0, outline: 'none', background: 'transparent', padding: '6px 4px', fontSize: 14, fontFamily: 'inherit', color: '#101828' }}
            />
            {busy === 'custom' ? (
              <span data-editor-ai-writing="" style={{ padding: '0 4px', color: '#475467', whiteSpace: 'nowrap' }}>Writing…</span>
            ) : (
              <button type="button" data-editor-ai-send="" aria-label="Rewrite with AI" disabled={off || !ask.trim()}
                onClick={() => { void runAi('custom'); }}
                style={{ ...PILL, padding: 6, lineHeight: 0, border: 0, background: !off && ask.trim() ? '#1d4ed8' : '#e4e7ec', color: '#fff', cursor: off || !ask.trim() ? 'default' : 'pointer' }}>
                <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="M8 13V3M3.5 7.5 8 3l4.5 4.5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" /></svg>
              </button>
            )}
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
            {REWRITE_ACTIONS.map((act) => (
              <button key={act} type="button" data-editor-ai-action={act} disabled={off}
                onClick={() => { void runAi(act); }}
                style={{ ...PILL, opacity: busy && busy !== act ? 0.5 : 1, cursor: off ? 'default' : 'pointer' }}>
                {busy === act ? 'Writing…' : ACTION_LABELS[act]}
              </button>
            ))}
          </div>
          {note && <span data-editor-inline-note="" style={{ padding: '0 4px', color: note.startsWith('Done') ? '#067647' : '#b42318' }}>{note}</span>}
        </>
      )}
    </div>,
    doc.body,
  );
}
