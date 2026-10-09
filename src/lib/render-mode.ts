// #1665 —— 这次构建是不是预览模式（`AI1ST_RENDER=preview`）。开关只在 `next.config.js` 一处读，那边经 `env` 把结果烤进包里；
// 这里读的是烤进去的那个值，不是起服务时的环境变量。
import { connection } from 'next/server';

export const isPreviewRender = process.env.AI1ST_PREVIEW_RENDER === '1';

/**
 * 预览模式下让这一页 / 这条路由在被访问时才渲染；发布模式什么都不做（照旧构建时渲染、导出）。
 * 🔴 不能写成 `export const dynamic = isPreviewRender ? 'force-dynamic' : …` —— Next 要求这类页面配置是字面量，
 *    写成表达式构建就报 Invalid segment config。所以用运行时的 `connection()`：它是 Next 的「这一页按请求渲染」开关。
 */
export async function renderOnRequest(): Promise<void> {
  if (isPreviewRender) await connection();
}
