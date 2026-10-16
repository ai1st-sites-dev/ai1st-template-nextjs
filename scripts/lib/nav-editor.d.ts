// #1759 / #1781 —— `nav-editor.js` 的类型（实现与说明都在那份 .js 里）。
/** 菜单那一项（`navigation.json` 的 `header.links` 一项）：`href` 是字符串或 `{source: "phone" | "email", location?}`。 */
export type MenuItem = { label: string; href: unknown; children?: MenuChild[] };
/** #1783 —— 下拉里的一项（只一层）。 */
export type MenuChild = { label: string; href: unknown; description?: string };
export declare const NAV_LABEL_MAX: number;
export declare const NAV_DESC_MAX: number;
export declare function isMenuRef(h: unknown): boolean;
export declare function menuItemProblem(item: unknown): string;
export declare function childrenProblem(item: unknown): string;
export declare function menuLinksProblem(links: unknown): string;
export declare function moveItem<T>(list: T[], from: number, to: number): T[];
export declare function liveShellData(
  data: { header?: Record<string, unknown>; footer?: Record<string, unknown> },
  p: { headerLinks?: unknown; headerButtons?: unknown; logoUrl?: unknown },
  locale: string,
  defaultLocale: string,
): { header: Record<string, unknown>; footer: Record<string, unknown> };
