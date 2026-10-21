export interface Geo { lat: number; lng: number }
/** #1978 —— 一个地点的值（多地点时每组一份，`contact-facts.js` §locationFactsFrom）。 */
export interface ContactLocationFacts {
  id: string; name: string; phone: string; email: string; address: string; hours: string; geo: Geo | null;
  rating: { ratingValue: number; reviewCount: number } | null; mapsUrl: string;
}
/** `locations` 只有单格页 / 测试递进来时才有（#1978：演示生意的全部地点）；§siteFactsFrom 本身不返回它。 */
export interface ContactSiteFacts { phone: string; email: string; address: string; hours: string; geo: Geo | null; locations?: ContactLocationFacts[] }
export const WEEK: string[];
export function formatTime(t: string): string;
export function formatDays(days: string[]): string;
export function formatHours(h: { days?: string[]; opens?: string; closes?: string } | { days?: string[]; opens?: string; closes?: string }[] | null | undefined): string;
export function validGeo(g: unknown): g is Geo;
export function siteFactsFrom(brand: unknown, seo: unknown): ContactSiteFacts;
export function locationFactsFrom(brand: unknown, id: string, seo?: unknown): ContactLocationFacts | null;
export function locationsFactsFrom(brand: unknown, seo?: unknown): ContactLocationFacts[];
export function telHref(phone: string): string;
export function mailtoHref(email: string): string;
export function osmEmbedUrl(geo: Geo | null | undefined): string;
export function copiesSiteFact(text: unknown, facts: Pick<ContactSiteFacts, 'address'> | null | undefined): boolean;
export function scrubContactItem(item: unknown, facts: Pick<ContactSiteFacts, 'address'> | null | undefined): boolean;
export function scrubContactCopies(page: unknown, facts: Pick<ContactSiteFacts, 'address'> | null | undefined): number;
