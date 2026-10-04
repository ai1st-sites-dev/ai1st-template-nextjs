// #1551 —— `keyword-service.js` 的类型。
export interface PlaceEntry { type: string; name: string }
export interface KeywordService { name: string; keyword: string; areaServed: PlaceEntry[]; placeFromKeyword: boolean }
export function capitalizeFirst(s: unknown): string;
export function isKeywordPage(page: unknown): boolean;
export function keywordMentions(keyword: unknown, place: unknown): boolean;
export function targetKeywordOf(page: unknown): string;
export function sitePlaces(site: { seo?: unknown; brand?: unknown }): { entry: PlaceEntry; keys: string[] }[];
export function placeInKeyword(keyword: unknown, places: { entry: PlaceEntry; keys: string[] }[]): PlaceEntry | null;
export function keywordServiceFor(page: unknown, site?: { seo?: unknown; brand?: unknown }): KeywordService | null;
