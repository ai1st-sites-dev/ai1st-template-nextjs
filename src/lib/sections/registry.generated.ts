// 🔴 这个文件是生成的 —— 手改会被下一次 `node scripts/block-build/build-blocks.js` 覆盖，
//    而 `scripts/block-build/generated-fresh.test.js` 会在那之前就把它点名。
//    要加一个块：在 `blocks/` 下新建一个文件夹（manifest.json + Section.tsx + 一个形态子文件夹），
//    然后跑一次生成器。#1387（设计文档 D20）。
import type { ComponentType } from 'react';
import AnnouncementBarSection from '@blocks/announcement-bar/Section';
import BlogPreviewSection from '@blocks/blog-preview/Section';
import CardGroupSection from '@blocks/card-group/Section';
import ContactFormSection from '@blocks/contact-form/Section';
import ContactInfoSection from '@blocks/contact-info/Section';
import ContentSplitSection from '@blocks/content-split/Section';
import CtaBannerSection from '@blocks/cta-banner/Section';
import FaqAccordionSection from '@blocks/faq-accordion/Section';
import FeaturesGridSection from '@blocks/features-grid/Section';
import GallerySection from '@blocks/gallery/Section';
import HeroSection from '@blocks/hero/Section';
import HeroWithFormSection from '@blocks/hero-with-form/Section';
import MapAreaSection from '@blocks/map-area/Section';
import NewsletterSignupSection from '@blocks/newsletter-signup/Section';
import PageHeaderSection from '@blocks/page-header/Section';
import PricingTableSection from '@blocks/pricing-table/Section';
import ProcessStepsSection from '@blocks/process-steps/Section';
import QuoteFormSection from '@blocks/quote-form/Section';
import ServiceRelatedPagesSection from '@blocks/service-related-pages/Section';
import ServicesListSection from '@blocks/services-list/Section';
import ServicesNavSection from '@blocks/services-nav/Section';
import SocialProofSection from '@blocks/social-proof/Section';
import TeamGridSection from '@blocks/team-grid/Section';
import TestimonialsSection from '@blocks/testimonials/Section';
import TextBlockSection from '@blocks/text-block/Section';
import TrustedBrandsSection from '@blocks/trusted-brands/Section';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const sectionRegistry: Record<string, ComponentType<any>> = {
  'announcement-bar': AnnouncementBarSection,
  'blog-preview': BlogPreviewSection,
  'card-group': CardGroupSection,
  'contact-form': ContactFormSection,
  'contact-info': ContactInfoSection,
  'content-split': ContentSplitSection,
  'cta-banner': CtaBannerSection,
  'faq-accordion': FaqAccordionSection,
  'features-grid': FeaturesGridSection,
  'gallery': GallerySection,
  'hero': HeroSection,
  'hero-with-form': HeroWithFormSection,
  'map-area': MapAreaSection,
  'newsletter-signup': NewsletterSignupSection,
  'page-header': PageHeaderSection,
  'pricing-table': PricingTableSection,
  'process-steps': ProcessStepsSection,
  'quote-form': QuoteFormSection,
  'service-related-pages': ServiceRelatedPagesSection,
  'services-list': ServicesListSection,
  'services-nav': ServicesNavSection,
  'social-proof': SocialProofSection,
  'team-grid': TeamGridSection,
  'testimonials': TestimonialsSection,
  'text-block': TextBlockSection,
  'trusted-brands': TrustedBrandsSection,
};
