// #1462 —— 一个 Bootstrap Icons 图标，画成内联 `<svg>`（不走图标字体，理由在 `scripts/lib/icons.js`）。
//
// 表由服务端按名查好传进来（`iconTableFor`）；表里没有这个名字 ⟹ 什么都不画（查不到的那一行日志
// 服务端已经打过了）。尺寸 1em、颜色 currentColor、下沉 .125em —— 跟原来那套字体的 `.bi::before` 一样，
// 所以换过来之后图标跟着字号和文字颜色走，行内对齐不变。`data-icon` 是读数：测试 / QA 按它数图标。

export interface IconDef { viewBox: string; body: string }
export type IconTable = Record<string, IconDef>;

interface Props {
  name?: string;
  icons?: IconTable;
  className?: string;
}

export default function InlineIcon({ name, icons, className }: Props) {
  const def = name && icons ? icons[name] : undefined;
  if (!def) return null;
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width="1em"
      height="1em"
      fill="currentColor"
      viewBox={def.viewBox}
      aria-hidden="true"
      focusable="false"
      className={className}
      data-icon={name}
      style={{ verticalAlign: '-0.125em', flexShrink: 0 }}
      dangerouslySetInnerHTML={{ __html: def.body }}
    />
  );
}
