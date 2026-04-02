import type { BrandConfig, NavigationConfig, SeoConfig, ServiceConfig, BlogPostConfig, DynamicPageConfig } from './types/config';

import brandJson from '@config/brand.json';
import navigationJson from '@config/navigation.json';
import seoJson from '@config/seo.json';
import servicesJson from '@config/services.json';
import blogIndexJson from '@config/blog-index.json';
import pagesAllJson from '@config/pages-all.json';

export const brand = brandJson as BrandConfig;
export const navigation = navigationJson as NavigationConfig;
export const seo = seoJson as SeoConfig;
export const services = servicesJson as ServiceConfig[];
export const blogPosts = blogIndexJson as BlogPostConfig[];
export const allPages = pagesAllJson as DynamicPageConfig[];

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
