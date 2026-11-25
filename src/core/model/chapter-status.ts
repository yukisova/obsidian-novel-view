export const CHAPTER_STATUS_PROPERTY = "novelview-state";

export type ChapterStatus = "todo" | "draft" | "outline" | "revising" | "done";

export const CHAPTER_STATUSES: ChapterStatus[] = [
  "todo",
  "draft",
  "outline",
  "revising",
  "done",
];

export const CHAPTER_STATUS_LABELS: Record<ChapterStatus, string> = {
  todo: "待写",
  draft: "草稿",
  outline: "大纲",
  revising: "修改中",
  done: "已完稿",
};

const ALIASES: Record<string, ChapterStatus> = {
  todo: "todo",
  pending: "todo",
  待写: "todo",
  draft: "draft",
  草稿: "draft",
  outline: "outline",
  大纲: "outline",
  revising: "revising",
  editing: "revising",
  修改中: "revising",
  done: "done",
  finished: "done",
  已完稿: "done",
  完稿: "done",
};

export function parseChapterStatus(value: unknown): ChapterStatus {
  if (typeof value === "string") {
    return ALIASES[value.trim().toLowerCase()] ?? "todo";
  }
  if (Array.isArray(value)) {
    for (const item of value) {
      if (typeof item === "string" && ALIASES[item.trim().toLowerCase()]) {
        return ALIASES[item.trim().toLowerCase()];
      }
    }
  }
  return "todo";
}

export function readChapterStatus(
  frontmatter: Record<string, unknown> | undefined,
): ChapterStatus {
  if (!frontmatter) {
    return "todo";
  }
  for (const [key, value] of Object.entries(frontmatter)) {
    if (key.toLowerCase() === CHAPTER_STATUS_PROPERTY) {
      return parseChapterStatus(value);
    }
  }
  return "todo";
}
