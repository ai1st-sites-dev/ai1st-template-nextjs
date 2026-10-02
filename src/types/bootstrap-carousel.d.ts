// #1494 —— `bootstrap` 包不带类型声明，这里只声明 testimonials 用到的那一点（按需引的 Carousel 模块）。
declare module 'bootstrap/js/dist/carousel' {
  export default class Carousel {
    static getOrCreateInstance(element: Element, config?: Record<string, unknown>): Carousel;
    next(): void;
    prev(): void;
    to(index: number): void;
    dispose(): void;
  }
}
