// #1132 — 老块名 → 通用块的别名表，运行时那一侧。
//
// 表本身是 `block-aliases.json`，**只有一份**：构建那一侧是 `scripts/blocks.js`（CommonJS 的 node
// 脚本，读不了 .ts），运行时这一侧是本文件。两边各抄一份的后果，`blockAttrs.ts` 上面那段注释已经
// 写过一次了（#998 把角色表搬进 JSON 就是为这个）。
//
// 表的每一行写齐映射文档 §2.1 那四件事 —— ① 新的 `type` 名 · ② `role` · ③ `data` 的逐字段去向
// （包括「继续忽略」的那些，写成 `null`）· ④ `block_layout` 的处置（`null` = 别名不造一个）——
// 外加渲染这一侧要的三样：标题元素的 `id`、这个词汇画哪几个部件、以及每个条目外面那个标签名。
//
// 🔴 #1143 加的第三样 `itemTag`，理由是量出来的：批 2 并进来的两个块，条目外面那个元素**不是**
//    `<div>` —— `checklist` 是 `<p>`（一个条目就是一行字，里面没有标题和描述），
//    `service-highlights` 是 `<article>`。老站重建要逐字节不变（映射文档 §2.2 / §2.6），
//    而标签名是产物 DOM 上看得见的字节 ⟹ 它必须是表里的一条数据，不能靠组件猜。
//    **别拿 `parts` 去推它**（「有 features 就画 article」那种）：那是把两件不相干的事绑在一起，
//    下一批只要出现一个「有 features 的 div」就当场错，而错法是静默的。
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
  /** 每个条目外面那个标签（`div` / `p` / `article`）—— 见文件头 #1143 那段。 */
  itemTag: ItemTag;
}

/** 条目外面那个标签今天用到的三种。加第四种要同时改 `CardGroupSection` 的分支。 */
export type ItemTag = 'div' | 'p' | 'article';

interface AliasRow {
  type: string;
  role: string;
  block_layout: string | null;
  data: Record<string, string | null>;
  itemTag: ItemTag;
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
  return {
    name: ROWS[name] ? name : CARD_GROUP,
    headingId: row.headingId,
    parts: row.parts,
    itemTag: row.itemTag,
  };
}
