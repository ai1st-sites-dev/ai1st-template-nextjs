// #1162 — 通用块「卡片组」的词汇表，运行时那一侧。
//
// 表本身是 `block-aliases.json`，**只有一份**：构建那一侧是 `scripts/blocks.js`（CommonJS 的 node
// 脚本，读不了 .ts），运行时这一侧是本文件。两边各抄一份的后果，`blockAttrs.ts` 上面那段注释已经
// 写过一次了（#998 把角色表搬进 JSON 就是为这个）。
//
// 🔴 **2026-08-23 #1162：这里【不再】有别名。** #1132 / #1143 建的那层老块名兼容
//    （`values-grid` / `benefits-list` / `checklist` / `service-highlights` 四行 + `__legacyType`）
//    整层退役了，合并从此是干净改名 —— Chris 2026-08-23 裁定。**让这件事今天安全的不是「都是测试站」**
//    （prod 5 个站里 2 个属于外部人、1 个是真付费客户，磁盘上写着老 type 名的块有 43 个），
//    而是**平台模板到不了任何已存在的站**：`isLocal()` 在 prod 恒 false，模板注入的两个点
//    （`manager/sites.go:462` 建站 · `manager/edit.go:93` 打开编辑器）同受那道闸；而且那 5 个站的仓里
//    一份 `block-aliases.json` 都没有（快照比兼容层还早）。守这条性质的是 #1162 的
//    `ai-team/dispatcher/ship-check-template-reachability.sh`，破了它会红。
//
// 🔴 所以这张表今天**只剩一行**，键 == 它自己的 `type`（`card-group`）。它不是别名，是通用块自己的
//    词汇：标题元素的 `id`、这个词汇画哪几个部件、以及每个条目外面那个标签名。
//    `CardGroupSection` 的每一个类名都从这里取（`name` 是类名前缀和 `data-block` 的取值），
//    所以**这一行的三个值是产物 DOM 上看得见的字节** —— 改它等于改所有站的 HTML。
import aliases from './block-aliases.json';
import type { BlockConfig } from '@/lib/types/config';

export interface BlockVocabulary {
  /** 类名前缀 + `data-block` 的取值。 */
  name: string;
  headingId: string;
  parts: string[];
  /** 每个条目外面那个标签。今天只有 `div`（`card-group` 那一行）。 */
  itemTag: ItemTag;
}

/**
 * 条目外面那个标签。
 *
 * 📌 `p` / `article` 是 #1143 为 `checklist` / `service-highlights` 两个老名字加的，那层兼容
 * 2026-08-23（#1162）退役之后**今天没有任何一行用它们** —— 留着是因为它是这个字段的值域声明，
 * 下一个合并批要是并进一个条目不是 `div` 的块，写进表里就能用。加第四种要同时看
 * `CardGroupSection` 画条目那一段。
 */
export type ItemTag = 'div' | 'p' | 'article';

interface VocabularyRow {
  type: string;
  role: string;
  block_layout: string | null;
  data: Record<string, string | null>;
  itemTag: ItemTag;
  headingId: string;
  parts: string[];
}

const ROWS = aliases as unknown as Record<string, VocabularyRow>;

/** 通用块自己那一行 —— 表里认不出来的块落回它。 */
const CARD_GROUP = 'card-group';

/**
 * 这个块实例该用哪套词汇。
 *
 * 🔴 表里只剩通用块自己那一行 ⟹ 今天这个函数对任何输入都返回它。**留着这个函数而不是把三个值
 *    写死进组件**，是因为它们仍然只该有一处定义：构建那一侧（`scripts/blocks.js`）读的是同一份
 *    JSON，而「两边各抄一份」正是 #1132 建这张表时要避的那件事。
 */
export function vocabularyFor(block?: BlockConfig): BlockVocabulary {
  const name = (block && block.type) || CARD_GROUP;
  const row = ROWS[name] || ROWS[CARD_GROUP];
  return {
    name: ROWS[name] ? name : CARD_GROUP,
    headingId: row.headingId,
    parts: row.parts,
    itemTag: row.itemTag,
  };
}
