// #1976 —— `locations.js` 的类型。
import type { BrandLocation, LocationRating, OpeningHoursSegment } from '../../src/lib/types/config';
type BrandLike = { locations?: unknown } | null | undefined;
export interface GeoEntry { address?: string; lat?: number; lng?: number; [k: string]: unknown }
export function mainLocation(brand: unknown): BrandLocation | null;
export function usableRating(r: unknown): { rating: number; count: number } | null;
export function siteRating(brand: unknown): { ratingValue: number; reviewCount: number } | null;
export function legacyFactsOf(seo: unknown): { hours?: unknown; rating?: unknown };
export function newLocationId(taken?: string[]): string;
export function withLocationIds<T>(locations: T[]): T[];
export function liftLocationFacts<B extends BrandLike>(brand: B, seo: unknown): B;
export function mainLocationFacts(brand: unknown, seo: unknown): {
  hours: OpeningHoursSegment | OpeningHoursSegment[] | undefined;
  rating: LocationRating | undefined;
};
export function geoEntries(geo: unknown): GeoEntry[];
export function mergeGeo<B extends BrandLike>(brand: B, geo: unknown): B;
export function stripGeo<B extends BrandLike>(brand: B): { brand: B; entries: { lat: number; lng: number; address: string }[] };
