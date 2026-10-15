// #1759 —— `nav-editor.js` 的类型（实现与说明都在那份 .js 里）。
export type NavItem = { slug: string; title: string; label: string; shown: boolean; order?: number };
export type NavPanel = { home: { label: string; title: string }; items: NavItem[] };
export type NavChange = { navLabel?: string | null; navOrder?: number };
export declare const NAV_LABEL_MAX: number;
export declare function navMenuToPanel(nav: unknown, locale: string): NavPanel | null;
export declare function panelRows(menu: NavPanel, ctaHref: string): (NavItem & { at: number })[];
export declare function buttonPage(menu: NavPanel, ctaHref: string): NavItem | null;
export declare function moveShown(menu: NavPanel, ctaHref: string, from: number, to: number): NavPanel;
export declare function setShown(menu: NavPanel, ctaHref: string, slug: string, shown: boolean): NavPanel;
export declare function setLabel(menu: NavPanel, slug: string, label: string): NavPanel;
export declare function navMenuProblem(menu: NavPanel | null | undefined): string;
export declare function navMenuChanges(args: { initial: NavPanel | null | undefined; now: NavPanel | null | undefined; slug: string }): { nav: Record<string, NavChange>; page: NavChange | null };
export declare function applyPageNav<T extends Record<string, unknown>>(json: T, change: NavChange | null): T;
export declare function liveShellData(
  data: { header?: Record<string, unknown>; footer?: Record<string, unknown> },
  p: { navMenu?: unknown; headerButtons?: unknown; logoUrl?: unknown },
  locale: string,
  defaultLocale: string,
): { header: Record<string, unknown>; footer: Record<string, unknown> };
