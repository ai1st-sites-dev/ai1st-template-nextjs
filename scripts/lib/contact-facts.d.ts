export interface Geo { lat: number; lng: number }
export interface ContactSiteFacts { phone: string; email: string; address: string; hours: string; geo: Geo | null }
export const WEEK: string[];
export function formatTime(t: string): string;
export function formatDays(days: string[]): string;
export function formatHours(h: { days?: string[]; opens?: string; closes?: string } | { days?: string[]; opens?: string; closes?: string }[] | null | undefined): string;
export function validGeo(g: unknown): g is Geo;
export function siteFactsFrom(brand: unknown, seo: unknown): ContactSiteFacts;
export function telHref(phone: string): string;
export function mailtoHref(email: string): string;
export function osmEmbedUrl(geo: Geo | null | undefined): string;
export function copiesSiteFact(text: unknown, facts: Pick<ContactSiteFacts, 'address'> | null | undefined): boolean;
export function scrubContactItem(item: unknown, facts: Pick<ContactSiteFacts, 'address'> | null | undefined): boolean;
export function scrubContactCopies(page: unknown, facts: Pick<ContactSiteFacts, 'address'> | null | undefined): number;
