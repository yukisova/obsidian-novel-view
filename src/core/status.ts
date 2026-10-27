import { findFrontmatterEnd } from "./paragraphs";

export type NovelState = "writing" | "revising" | "finished";

export const NOVEL_STATES: NovelState[] = ["writing", "revising", "finished"];

export const NOVEL_STATE_LABELS: Record<NovelState, string> = {
  writing: "写作",
  revising: "修改",
  finished: "完稿",
};

const STATE_ALIASES: Record<string, NovelState> = {
  writing: "writing",
  write: "writing",
  draft: "writing",
  写作: "writing",
  创作: "writing",
  revising: "revising",
  revise: "revising",
  editing: "revising",
  edit: "revising",
  修改: "revising",
  修订: "revising",
  finished: "finished",
  finish: "finished",
  done: "finished",
  completed: "finished",
  complete: "finished",
  完稿: "finished",
  完成: "finished",
  已完稿: "finished",
};

export function parseNovelState(value: unknown): NovelState | null {
  if (typeof value !== "string") {
    return null;
  }

  return STATE_ALIASES[value.trim().toLowerCase()] ?? null;
}

/** Count non-whitespace characters in the body, excluding frontmatter. */
export function countNovelCharacters(content: string): number {
  const source = content.charCodeAt(0) === 0xfeff
    ? content.slice(1)
    : content;
  const lines = source.split(/\r?\n/u);
  const frontmatterEnd = findFrontmatterEnd(
    (index) => lines[index] ?? null,
    lines.length,
  );
  const body = lines.slice(frontmatterEnd).join("\n");
  let count = 0;

  for (const character of body) {
    if (!/\s/u.test(character)) {
      count += 1;
    }
  }

  return count;
}
