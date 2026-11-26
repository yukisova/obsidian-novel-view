export interface ArticleMarkInfo {
  label: string;
  start: number;
  end: number;
  line: number;
}

export interface ArticlePendingInfo {
  title: string;
  from: number;
  to: number;
  line: number;
}

export interface ArticleFootnoteInfo {
  key: string;
  text: string;
  line: number;
}

export interface ArticleInfoSnapshot {
  filePath: string;
  title: string;
  summary: string;
  wordCount: number;
  marks: ArticleMarkInfo[];
  pending: ArticlePendingInfo[];
  footnotes: ArticleFootnoteInfo[];
}

const SUMMARY_PREFIX = "novelview:summary:";
const FOOTNOTE_PREFIX = "novelview:footnotes:";

export function loadArticleSummary(filePath: string): string {
  try {
    return window.localStorage.getItem(`${SUMMARY_PREFIX}${filePath}`) ?? "";
  } catch {
    return "";
  }
}

export function saveArticleSummary(filePath: string, text: string): void {
  try {
    window.localStorage.setItem(`${SUMMARY_PREFIX}${filePath}`, text);
  } catch {
    // 本地存储不可用时忽略。
  }
}

export function loadFootnoteNotes(filePath: string): Record<string, string> {
  try {
    const raw = JSON.parse(
      window.localStorage.getItem(`${FOOTNOTE_PREFIX}${filePath}`) ?? "{}",
    ) as unknown;
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
      return {};
    }
    const notes: Record<string, string> = {};
    for (const [key, value] of Object.entries(raw)) {
      if (typeof value === "string") {
        notes[key] = value;
      }
    }
    return notes;
  } catch {
    return {};
  }
}

export function saveFootnoteNote(
  filePath: string,
  key: string,
  text: string,
): void {
  const notes = loadFootnoteNotes(filePath);
  notes[key] = text;
  try {
    window.localStorage.setItem(
      `${FOOTNOTE_PREFIX}${filePath}`,
      JSON.stringify(notes),
    );
  } catch {
    // 本地存储不可用时忽略。
  }
}
