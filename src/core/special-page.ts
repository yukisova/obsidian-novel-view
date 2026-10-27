import type { ReferenceCategory } from "./cards";
import { CATEGORY_FILE_NAMES } from "./category-file";
import { isOutlineFileName } from "./outline";

export type SpecialPageKind = ReferenceCategory | "outline";

export const SPECIAL_PAGE_LABELS: Record<SpecialPageKind, string> = {
  outline: "大纲",
  setting: "设定",
  character: "人物",
  timeline: "时间线",
  foreshadowing: "伏笔",
  inspiration: "灵感",
};

export function getSpecialPageKind(fileName: string): SpecialPageKind | null {
  if (isOutlineFileName(fileName)) {
    return "outline";
  }
  for (const [kind, fileNameValue] of Object.entries(CATEGORY_FILE_NAMES)) {
    if (fileNameValue === fileName) {
      return kind as SpecialPageKind;
    }
  }
  return null;
}
