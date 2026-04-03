import type { BrandConfig, NavigationConfig, SeoConfig, ServiceConfig, BlogPostConfig, DynamicPageConfig } from './types/config';

import {
  brand as _brand,
  navigation as _navigation,
  seo as _seo,
  services as _services,
  blogPosts as _blogPosts,
  allPages as _allPages,
} from './config-data';

export const brand = _brand as BrandConfig;
export const navigation = _navigation as NavigationConfig;
export const seo = _seo as SeoConfig;
export const services = _services as ServiceConfig[];
export const blogPosts = _blogPosts as BlogPostConfig[];
export const allPages = _allPages as DynamicPageConfig[];

export function getPage(slug: string): DynamicPageConfig | undefined {
  return allPages.find((p) => p.slug === slug);
}

export function getHomePage(): DynamicPageConfig {
  return allPages.find((p) => p.slug === 'home')!;
}

export function getNonHomePages(): DynamicPageConfig[] {
  return allPages.filter((p) => p.slug !== 'home');
}

export function getNavPages(): DynamicPageConfig[] {
  return allPages.filter((p) => p.navLabel);
}
