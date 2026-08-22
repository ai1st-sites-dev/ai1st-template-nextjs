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
  // #1132 / #1143 —— 五个键一个组件：`card-group` 是通用块自己的名字，四个老名字是它的别名
  // （批 1 `values-grid` + `benefits-list`，批 2 `checklist` + `service-highlights`）。
  // 别名在构建期就把 `type` 换成了 `card-group`（`scripts/blocks.js` 的 applyAlias），所以走到
  // 这里的恒是那个键；老名字这几条留着是**射程**：`scripts/block-migration/gen-allblocks.js`
  // 和 `tests/e2e/fixtures/978-arms.mjs` 都从这张表派生「每种块各一次」那一页，少了它们，
  // `.values-grid__*` / `.benefits-list__*` / `.checklist__*` / `.service-highlights__*`
  // 这 22 个钩子就从被量的页面上消失了。
  'card-group': CardGroupSection,
  'values-grid': CardGroupSection,
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
  'benefits-list': CardGroupSection,
  'social-proof': SocialProofSection,
  'divider': DividerSection,
  'announcement-bar': AnnouncementBarSection,
  'timeline': TimelineSection,
  'service-highlights': CardGroupSection,
  'newsletter-signup': NewsletterSignupSection,
  'map-area': MapAreaSection,
  'checklist': CardGroupSection,
  'awards-certifications': AwardsCertificationsSection,
  'blog-preview': BlogPreviewSection,
  'service-related-pages': ServiceRelatedPagesSection,
};
