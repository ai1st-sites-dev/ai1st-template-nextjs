// #1552 —— `/llms.txt`，构建时生成（静态导出写成 `out/llms.txt`，发布时跟 out/ 其余文件一起进 R2）。内容见 §buildLlmsTxt。
import { buildLlmsTxt } from '@/lib/llms-txt';

export const dynamic = 'force-static';

export function GET() {
  return new Response(buildLlmsTxt(), { headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
}
