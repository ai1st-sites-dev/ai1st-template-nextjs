import type { BrandConfig, NavigationConfig, SeoConfig, ServiceConfig, BlogPostConfig, DynamicPageConfig } from './types/config';

import {
  brand as _brand,
  defaultLocale as _defaultLocale,
  locales as _locales,
  seoByLocale as _seoByLocale,
  servicesByLocale as _servicesByLocale,
  navigationByLocale as _navigationByLocale,
  pagesByLocale as _pagesByLocale,
  blogPostsByLocale as _blogPostsByLocale,
} from './config-data';

export const brand = _brand as BrandConfig;
export const defaultLocale = _defaultLocale as string;
export const locales = _locales as string[];
export const seoByLocale = _seoByLocale as Record<string, SeoConfig>;
export const servicesByLocale = _servicesByLocale as Record<string, ServiceConfig[]>;
export const navigationByLocale = _navigationByLocale as Record<string, NavigationConfig>;
export const pagesByLocale = _pagesByLocale as Record<string, DynamicPageConfig[]>;
export const blogPostsByLocale = _blogPostsByLocale as Record<string, BlogPostConfig[]>;

export function isValidLocale(locale: string): boolean {
  return locales.includes(locale);
}

export function getSeo(locale: string): SeoConfig {
  return seoByLocale[locale] ?? seoByLocale[defaultLocale];
}

export function getServices(locale: string): ServiceConfig[] {
  return servicesByLocale[locale] ?? servicesByLocale[defaultLocale];
}

export function getNavigation(locale: string): NavigationConfig {
  return navigationByLocale[locale] ?? navigationByLocale[defaultLocale];
}

export function getBlogPosts(locale: string): BlogPostConfig[] {
  return blogPostsByLocale[locale] ?? [];
}

export function getTagline(locale: string): string {
  return brand.tagline[locale] ?? brand.tagline[defaultLocale] ?? '';
}

export function getPage(slug: string, locale: string): DynamicPageConfig | undefined {
  return (pagesByLocale[locale] ?? []).find((p) => p.slug === slug);
}

export function getHomePage(locale: string): DynamicPageConfig {
  const pages = pagesByLocale[locale] ?? pagesByLocale[defaultLocale];
  return pages.find((p) => p.slug === 'home')!;
}

export function getNonHomePages(locale: string): DynamicPageConfig[] {
  return (pagesByLocale[locale] ?? []).filter((p) => p.slug !== 'home');
}

export function getNavPages(locale: string): DynamicPageConfig[] {
  return (pagesByLocale[locale] ?? []).filter((p) => p.navLabel);
}
