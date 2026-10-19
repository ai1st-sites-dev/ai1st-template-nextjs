// 🔴 这个文件是生成的 —— 手改会被下一次 `node scripts/block-build/build-blocks.js` 覆盖，
//    而 `scripts/block-build/generated-fresh.test.js` 会在那之前就把它点名。
//    要加一个块：在 `blocks/` 下新建一个文件夹（manifest.json + Section.tsx + 一个形态子文件夹），
//    然后跑一次生成器。#1387（设计文档 D20）。
import type { ComponentType } from 'react';
import BlogSection from '@blocks/blog/Section';
import ContactSection from '@blocks/contact/Section';
import ContentSection from '@blocks/content/Section';
import CtaSection from '@blocks/cta/Section';
import CustomHtmlSection from '@blocks/custom-html/Section';
import FaqSection from '@blocks/faq/Section';
import FeaturesSection from '@blocks/features/Section';
import GallerySection from '@blocks/gallery/Section';
import HeroSection from '@blocks/hero/Section';
import LogosSection from '@blocks/logos/Section';
import MilestonesSection from '@blocks/milestones/Section';
import PageHeaderSection from '@blocks/page-header/Section';
import PricingSection from '@blocks/pricing/Section';
import ReviewsSection from '@blocks/reviews/Section';
import TeamSection from '@blocks/team/Section';
import TestimonialsSection from '@blocks/testimonials/Section';

// #1838 —— 每个块的数据版本（含顶栏 / 页脚）：`schemaVersion` = 内容该是哪一版，`renders` = 组件还画得了哪几版。
export const blockSchemaVersions: Record<string, { schemaVersion: number; renders: number[] }> = {
  "blog": { schemaVersion: 1, renders: [1] },
  "contact": { schemaVersion: 1, renders: [1] },
  "content": { schemaVersion: 1, renders: [1] },
  "cta": { schemaVersion: 1, renders: [1] },
  "custom-html": { schemaVersion: 1, renders: [1] },
  "faq": { schemaVersion: 1, renders: [1] },
  "features": { schemaVersion: 1, renders: [1] },
  "gallery": { schemaVersion: 1, renders: [1] },
  "hero": { schemaVersion: 1, renders: [1] },
  "logos": { schemaVersion: 1, renders: [1] },
  "milestones": { schemaVersion: 1, renders: [1] },
  "page-header": { schemaVersion: 1, renders: [1] },
  "pricing": { schemaVersion: 1, renders: [1] },
  "reviews": { schemaVersion: 1, renders: [1] },
  "team": { schemaVersion: 1, renders: [1] },
  "testimonials": { schemaVersion: 1, renders: [1] },
  "footer": { schemaVersion: 1, renders: [1] },
  "header": { schemaVersion: 1, renders: [1] },
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const sectionRegistry: Record<string, ComponentType<any>> = {
  'blog': BlogSection,
  'contact': ContactSection,
  'content': ContentSection,
  'cta': CtaSection,
  'custom-html': CustomHtmlSection,
  'faq': FaqSection,
  'features': FeaturesSection,
  'gallery': GallerySection,
  'hero': HeroSection,
  'logos': LogosSection,
  'milestones': MilestonesSection,
  'page-header': PageHeaderSection,
  'pricing': PricingSection,
  'reviews': ReviewsSection,
  'team': TeamSection,
  'testimonials': TestimonialsSection,
};
