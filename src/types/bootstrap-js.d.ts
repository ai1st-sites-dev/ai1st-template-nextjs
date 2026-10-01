// #1495 —— Bootstrap 5 的单个 JS 模块（`bootstrap/js/dist/<名>.js`）没有自带类型。这里只声明本仓用到的那两个
// 的最小面：`src/components/BootstrapJs.tsx` 只按需 `import()` 它们（导入即注册 data-api），偶尔要拿实例。
declare module 'bootstrap/js/dist/modal' {
  const Modal: { getInstance(el: Element): { hide(): void } | null; getOrCreateInstance(el: Element): { show(relatedTarget?: Element): void; hide(): void } };
  export default Modal;
}
declare module 'bootstrap/js/dist/carousel' {
  const Carousel: { getInstance(el: Element): { to(i: number): void; dispose(): void } | null; getOrCreateInstance(el: Element, config?: object): { to(i: number): void } };
  export default Carousel;
}
