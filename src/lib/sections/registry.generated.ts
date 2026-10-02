// 🔴 这个文件是生成的 —— 手改会被下一次 `node scripts/block-build/build-blocks.js` 覆盖，
//    而 `scripts/block-build/generated-fresh.test.js` 会在那之前就把它点名。
//    要加一个块：在 `blocks/` 下新建一个文件夹（manifest.json + Section.tsx + 一个形态子文件夹），
//    然后跑一次生成器。#1387（设计文档 D20）。
import type { ComponentType } from 'react';
import BlogSection from '@blocks/blog/Section';
import ContactSection from '@blocks/contact/Section';
import ContentSection from '@blocks/content/Section';
import CtaSection from '@blocks/cta/Section';
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

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const sectionRegistry: Record<string, ComponentType<any>> = {
  'blog': BlogSection,
  'contact': ContactSection,
  'content': ContentSection,
  'cta': CtaSection,
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
