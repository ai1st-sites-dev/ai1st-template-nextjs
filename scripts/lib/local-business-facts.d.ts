// #1551 —— `local-business-facts.js` 的类型。
export interface HoursSegment { days: string[]; opens: string; closes: string }
export interface AggregateRating { ratingValue: number; reviewCount: number }
export const DAYS: string[];
export const MAX_SEGMENTS: number;
export function canonicalDay(d: unknown): string;
export function canonicalTime(t: unknown): string;
export function hoursSegments(value: unknown): HoursSegment[];
export function numbersIn(text: unknown): Set<number>;
export function verifyTranscription(text: unknown, aiValue: unknown): { segments: HoursSegment[]; reason: string };
export function ratingFrom(onlinePresence: unknown): AggregateRating | null;
