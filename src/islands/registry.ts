// #1798 —— 岛的名字 → 组件。服务端填岛（render.tsx）和浏览器 hydrate（runtime.tsx）查的是同一张表，
// 名字也是 `island(名字, …)` 里写的那一个（`scripts/islands.test.js` 核两边一致）。
import type { ComponentType } from 'react';
import BlockLeadForm from '@/components/BlockLeadForm';
import GalleryLightbox from '@blocks/gallery/Lightbox';
import TestimonialsCarouselInit from '@blocks/testimonials/Carousel';
import ContactMap from '@blocks/contact/ContactMap';
import Header from '@blocks/header/Section';
import Footer from '@blocks/footer/Section';
import Pricing from '@blocks/pricing/Section';

export type IslandComponent = ComponentType<Record<string, unknown>>;
const as = (c: unknown) => c as IslandComponent;

export const ISLANDS: Record<string, IslandComponent> = {
  'lead-form': as(BlockLeadForm),
  'gallery-lightbox': as(GalleryLightbox),
  'testimonials-carousel': as(TestimonialsCarouselInit),
  'contact-map': as(ContactMap),
  'header': as(Header),
  'footer': as(Footer),
  'pricing': as(Pricing),
};
