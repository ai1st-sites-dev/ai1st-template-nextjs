// #1839 —— 测试用的假块 fake-c（只住 scripts/fixtures/blocks/，见同目录 README）：退役、没有替代块 ⟹ 冻结成 Custom HTML 的那一个。
// 自带一份 block.css（底色 / 圆角 / 字色），冻结前后比 `getComputedStyle` 时那几样不是浏览器默认值，比得出东西。
import BlockSection from '@template/components/BlockSection';
import type { BlockConfig } from '@template/lib/types/config';

export default function FakeCSection({ data, block }: { data?: { title?: unknown }; block?: BlockConfig }) {
  const title = data && typeof data.title === 'string' ? data.title : '';
  return (
    <BlockSection type="fake-c" block={block}>
      <h2 className="fc-title" data-fake-title="">{title}</h2>
    </BlockSection>
  );
}
