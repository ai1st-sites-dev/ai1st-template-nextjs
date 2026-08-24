import type { ComponentType } from 'react';
import HeroSection from '@/components/sections/HeroSection';
import TrustedBrandsSection from '@/components/sections/TrustedBrandsSection';
import FeaturesGridSection from '@/components/sections/FeaturesGridSection';
import CardGroupSection from '@/components/sections/CardGroupSection';
import TestimonialsSection from '@/components/sections/TestimonialsSection';
import CtaBannerSection from '@/components/sections/CtaBannerSection';
import ContactInfoSection from '@/components/sections/ContactInfoSection';
import TextBlockSection from '@/components/sections/TextBlockSection';
import PageHeaderSection from '@/components/sections/PageHeaderSection';
import ServicesNavSection from '@/components/sections/ServicesNavSection';
import ServicesListSection from '@/components/sections/ServicesListSection';
import QuoteFormSection from '@/components/sections/QuoteFormSection';
import ContactFormSection from '@/components/sections/ContactFormSection';
import StatsCounterSection from '@/components/sections/StatsCounterSection';
import FaqAccordionSection from '@/components/sections/FaqAccordionSection';
import ProcessStepsSection from '@/components/sections/ProcessStepsSection';
import TeamGridSection from '@/components/sections/TeamGridSection';
import PricingTableSection from '@/components/sections/PricingTableSection';
import GallerySection from '@/components/sections/GallerySection';
import LogoCarouselSection from '@/components/sections/LogoCarouselSection';
import ContentSplitSection from '@/components/sections/ContentSplitSection';
import FeatureComparisonSection from '@/components/sections/FeatureComparisonSection';
import SocialProofSection from '@/components/sections/SocialProofSection';
import DividerSection from '@/components/sections/DividerSection';
import AnnouncementBarSection from '@/components/sections/AnnouncementBarSection';
import TimelineSection from '@/components/sections/TimelineSection';
import NewsletterSignupSection from '@/components/sections/NewsletterSignupSection';
import MapAreaSection from '@/components/sections/MapAreaSection';
import AwardsCertificationsSection from '@/components/sections/AwardsCertificationsSection';
import BlogPreviewSection from '@/components/sections/BlogPreviewSection';
import ServiceRelatedPagesSection from '@/components/sections/ServiceRelatedPagesSection';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const sectionRegistry: Record<string, ComponentType<any>> = {
  'hero': HeroSection,
  'trusted-brands': TrustedBrandsSection,
  'features-grid': FeaturesGridSection,
  // 通用块「卡片组」。#1132 / #1143 把 `values-grid` + `benefits-list` + `checklist` +
  // `service-highlights` 并进它，当时**四个老名字各留一条指着同一个组件**，为的是老站重建时
  // 字节不变。🔴 那四条 2026-08-23（#1162）删了 —— 合并从此是干净改名，Chris 裁定。
  // 后果写在明处：磁盘上还写着老 type 名的页面，走 `SectionRenderer` 既有的未知类型那一支
  // （`console.warn` + `return null`），那个块在页面上不出现。让这件事安全的是**平台模板到不了
  // 任何已存在的站**（判据在 `ai-team/dispatcher/ship-check-template-reachability.sh`），
  // 不是「反正都是测试站」。
  // 🔴 连带的一处失明，改这张表的人必须知道：`tests/e2e/fixtures/978-arms.mjs` 与
  // `scripts/block-migration/gen-allblocks.js` 都**从这张表派生**「每种块各一次」那一页，而
  // `978-theme-preview-layout.spec.ts:333` 的期望值也现读这张表 ⟹ 删一个键，被量的页面和期望
  // 值一起减一，那一格**恒绿而射程变小**。删键时要把前后两个读数写下来，别只报「绿」。
  'card-group': CardGroupSection,
  'testimonials': TestimonialsSection,
  'cta-banner': CtaBannerSection,
  'contact-info': ContactInfoSection,
  'text-block': TextBlockSection,
  'page-header': PageHeaderSection,
  'services-nav': ServicesNavSection,
  'services-list': ServicesListSection,
  'quote-form': QuoteFormSection,
  'contact-form': ContactFormSection, // TICKET-268b: real platform lead form (POST /api/leads)
  'stats-counter': StatsCounterSection,
  'faq-accordion': FaqAccordionSection,
  'process-steps': ProcessStepsSection,
  'team-grid': TeamGridSection,
  'pricing-table': PricingTableSection,
  'gallery': GallerySection,
  'logo-carousel': LogoCarouselSection,
  'content-split': ContentSplitSection,
  'feature-comparison': FeatureComparisonSection,
  'social-proof': SocialProofSection,
  'divider': DividerSection,
  'announcement-bar': AnnouncementBarSection,
  'timeline': TimelineSection,
  'newsletter-signup': NewsletterSignupSection,
  'map-area': MapAreaSection,
  'awards-certifications': AwardsCertificationsSection,
  'blog-preview': BlogPreviewSection,
  'service-related-pages': ServiceRelatedPagesSection,
};
