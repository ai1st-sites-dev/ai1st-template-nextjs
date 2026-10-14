// #1757 —— `design-ai-rounds.js` 的类型（编辑器是 TypeScript）。
export type DesignAiWater = { id: number; keys: string[] };
export function designAiRounds<M extends { key?: string; role: string; text: string; messageId?: number }>(messages: M[], water: DesignAiWater, sent: string[]): { user: M; replies: M[] }[];
export function designAiWater(messages: { key?: string; messageId?: number }[]): DesignAiWater;
