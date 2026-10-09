// #1552 —— `/llms.txt`，构建时生成（静态导出写成 `out/llms.txt`，发布时跟 out/ 其余文件一起进 R2）。内容见 §buildLlmsTxt。
import { buildLlmsTxt } from '@/lib/llms-txt';
import { requestSiteData } from '@/lib/site-data.server';

// #1665 —— 理由同 robots.ts：静态导出要一个「能静态生成」的声明，又不能是 force-static（会把预览模式也钉死在构建那一刻）。
export const revalidate = false;

export async function GET() {
  const site = await requestSiteData();
  return new Response(buildLlmsTxt(site), { headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
}
