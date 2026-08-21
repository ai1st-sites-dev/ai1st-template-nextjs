// #1132 — 老块名 → 通用块的别名表，运行时那一侧。
//
// 表本身是 `block-aliases.json`，**只有一份**：构建那一侧是 `scripts/blocks.js`（CommonJS 的 node
// 脚本，读不了 .ts），运行时这一侧是本文件。两边各抄一份的后果，`blockAttrs.ts` 上面那段注释已经
// 写过一次了（#998 把角色表搬进 JSON 就是为这个）。
//
// 表的每一行写齐映射文档 §2.1 那四件事 —— ① 新的 `type` 名 · ② `role` · ③ `data` 的逐字段去向
// （包括「继续忽略」的那些，写成 `null`）· ④ `block_layout` 的处置（`null` = 别名不造一个）——
// 外加渲染这一侧要的两样：标题元素的 `id`，和这个词汇画哪几个部件。
//
// 🔴 键 == 它自己的 `type` 的那一行**不是别名**，是通用块自己的词汇（`card-group` 那一行）。
//    构建那一侧靠这个判据跳过它。
import aliases from './block-aliases.json';
import type { BlockConfig } from '@/lib/types/config';

export interface BlockVocabulary {
  /** 类名前缀 + `data-block` 的取值。老站是老名字，新站是通用块的名字。 */
  name: string;
  headingId: string;
  parts: string[];
}

interface AliasRow {
  type: string;
  role: string;
  block_layout: string | null;
  data: Record<string, string | null>;
  headingId: string;
  parts: string[];
}

const ROWS = aliases as unknown as Record<string, AliasRow>;

/** 通用块自己那一行 —— 表里认不出来的块落回它（新站直接写 `type: "card-group"` 走的就是这一支）。 */
const CARD_GROUP = 'card-group';

/**
 * 这个块实例该用哪套词汇。
 *
 * 🔴 判据是 `__legacyType ?? type`，两个都要读。别名走完之后 `type` 恒为通用块的名字，老名字只在
 *    `__legacyType` 里；而万一有一条路没过别名（注册表里老名字仍然指着这个组件），`type` 就是老
 *    名字本身 —— 那时也该拿老词汇渲染。少读一个，那条路会静默吐出新词汇，而那是像素级的回归。
 */
export function vocabularyFor(block?: BlockConfig): BlockVocabulary {
  const name = (block && (block.__legacyType || block.type)) || CARD_GROUP;
  const row = ROWS[name] || ROWS[CARD_GROUP];
  return { name: ROWS[name] ? name : CARD_GROUP, headingId: row.headingId, parts: row.parts };
}
