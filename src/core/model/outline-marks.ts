export const OUTLINE_MARKS_PROPERTY = "novelview-marks";

export interface OutlineMark {
  start: number;
  end: number;
  label: string;
}

/** 解析标注数据并校验、排序后返回 */
export function parseOutlineMarks(value: unknown): OutlineMark[] {
  let source: unknown = value;
  if (typeof value === "string") {
    try {
      source = JSON.parse(value);
    } catch {
      return [];
    }
  }
  if (!Array.isArray(source)) {
    return [];
  }
  const marks: OutlineMark[] = [];
  for (const item of source) {
    if (!item || typeof item !== "object") {
      continue;
    }
    const record = item as Record<string, unknown>;
    const start = Number(record.start);
    const end = Number(record.end);
    const label = typeof record.label === "string"
      ? record.label.trim()
      : "";
    if (
      Number.isFinite(start)
      && Number.isFinite(end)
      && start >= 0
      && end > start
      && label.length > 0
    ) {
      marks.push({ start: Math.floor(start), end: Math.floor(end), label });
    }
  }
  return marks.sort((left, right) => left.start - right.start);
}

/** 把大纲标注序列化为 JSON 字符串 */
export function serializeOutlineMarks(marks: OutlineMark[]): string {
  return JSON.stringify(
    marks.map((mark) => ({
      start: mark.start,
      end: mark.end,
      label: mark.label,
    })),
  );
}
