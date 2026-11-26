import type { ChapterStatus } from "../core/model/chapter-status";

/** 单章统计：字数、状态与「待修改」块数量。 */
export interface ChapterMeta {
  wordCount: number;
  status: ChapterStatus;
  pendingCount: number;
}
