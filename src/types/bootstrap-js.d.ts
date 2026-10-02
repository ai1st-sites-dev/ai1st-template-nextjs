// #1495 / #1514 —— Bootstrap 5 的单个 JS 模块（`bootstrap/js/dist/<名>.js`）没有自带类型。这里只声明本仓用到的最小面：
// `src/components/BootstrapJs.tsx` 只按需 `import()` 它们（导入即注册 data-api），偶尔要拿实例（gallery-new 的 Lightbox 调
// Carousel.to，header-new 的 Esc 调 Collapse.hide）。dropdown / offcanvas / tooltip 今天只是开了口子，没有块拿实例。
declare module 'bootstrap/js/dist/modal' {
  const Modal: { getInstance(el: Element): { hide(): void } | null; getOrCreateInstance(el: Element): { show(relatedTarget?: Element): void; hide(): void } };
  export default Modal;
}
declare module 'bootstrap/js/dist/carousel' {
  const Carousel: { getInstance(el: Element): { to(i: number): void; dispose(): void } | null; getOrCreateInstance(el: Element, config?: object): { to(i: number): void } };
  export default Carousel;
}
declare module 'bootstrap/js/dist/collapse' {
  const Collapse: { getInstance(el: Element): { show(): void; hide(): void; toggle(): void } | null; getOrCreateInstance(el: Element, config?: object): { show(): void; hide(): void; toggle(): void } };
  export default Collapse;
}
declare module 'bootstrap/js/dist/dropdown' {
  const Dropdown: { getInstance(el: Element): { show(): void; hide(): void } | null; getOrCreateInstance(el: Element, config?: object): { show(): void; hide(): void } };
  export default Dropdown;
}
declare module 'bootstrap/js/dist/offcanvas' {
  const Offcanvas: { getInstance(el: Element): { show(): void; hide(): void } | null; getOrCreateInstance(el: Element, config?: object): { show(): void; hide(): void } };
  export default Offcanvas;
}
declare module 'bootstrap/js/dist/tooltip' {
  const Tooltip: { getInstance(el: Element): { show(): void; hide(): void; dispose(): void } | null; getOrCreateInstance(el: Element, config?: object): { show(): void; hide(): void } };
  export default Tooltip;
}
