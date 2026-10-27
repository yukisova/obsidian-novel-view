import {
  parseNovelKeywords,
} from "./keywords";
import { joinVaultPath } from "./novel-setting";
import type { ReferenceCategory } from "./cards";
import { findFrontmatterEnd } from "./paragraphs";

const CATEGORY_FILE_BASENAMES = new Set([
  "设定",
  "人物",
  "时间线",
  "伏笔",
  "悬浮标签",
]);

export function isCategoryFileName(name: string): boolean {
  return CATEGORY_FILE_BASENAMES.has(name.replace(/\.md$/iu, ""));
}

export const CATEGORY_FILE_NAMES: Record<ReferenceCategory, string> = {
  setting: "设定.md",
  character: "人物.md",
  timeline: "时间线.md",
  foreshadowing: "伏笔.md",
  inspiration: "悬浮标签.md",
};

export interface CategorySection {
  heading: string;
  headingLine: number;
  headingStart: number;
  start: number;
  end: number;
  keywords: string[];
}

export function getCategoryFilePath(
  folderPath: string,
  category: ReferenceCategory,
): string {
  return joinVaultPath(folderPath, CATEGORY_FILE_NAMES[category]);
}

export function createCategoryFileContent(category: ReferenceCategory): string {
  return [
    "---",
    `novelview-type: ${category}`,
    "---",
    "",
  ].join("\n");
}

export function parseCategorySections(content: string): CategorySection[] {
  const source = content.charCodeAt(0) === 0xfeff
    ? content.slice(1)
    : content;
  const lines = source.split("\n");
  const lineStarts: number[] = [];
  let offset = 0;
  for (const line of lines) {
    lineStarts.push(offset);
    offset += line.length + 1;
  }

  const frontmatterEnd = findFrontmatterEnd(
    (index) => lines[index] ?? null,
    lines.length,
  );
  const headings: Array<{
    heading: string;
    headingLine: number;
    headingStart: number;
  }> = [];
  let inFence = false;

  for (let index = frontmatterEnd; index < lines.length; index += 1) {
    const line = lines[index] ?? "";
    if (/^\s*(```|~~~)/u.test(line)) {
      inFence = !inFence;
      continue;
    }
    if (inFence) {
      continue;
    }

    const match = line.match(/^#\s+(.+?)\s*#*\s*$/u);
    if (match) {
      headings.push({
        heading: match[1].trim(),
        headingLine: index + 1,
        headingStart: lineStarts[index] ?? 0,
      });
    }
  }

  return headings.map((heading, index) => {
    const end = index + 1 < headings.length
      ? headings[index + 1].headingStart
      : source.length;
    const sectionText = source.slice(heading.headingStart, end);
    const keywords = extractSectionKeywords(sectionText);

    return {
      ...heading,
      start: heading.headingStart,
      end,
      keywords,
    };
  });
}

export function appendCategorySection(
  content: string,
  category: ReferenceCategory,
  heading: string,
  keywords: string[] = [],
  body = "",
): string {
  let text = content;
  if (!text.trim()) {
    text = createCategoryFileContent(category);
  } else if (findFrontmatterEnd((index) => text.split("\n")[index] ?? null) === 0) {
    text = `${createCategoryFileContent(category)}${text}`;
  }

  if (!text.endsWith("\n")) {
    text += "\n";
  }
  if (!text.endsWith("\n\n")) {
    text += "\n";
  }

  text += `# ${heading.trim()}\n`;
  if (keywords.length > 0) {
    text += `关键词：${keywords.join("、")}\n`;
  }
  if (body.trim()) {
    text += `\n${body.trim()}\n`;
  }
  text += "\n";
  return text;
}

export function renameCategorySection(
  content: string,
  section: CategorySection,
  newHeading: string,
): string {
  const lineEnd = content.indexOf("\n", section.headingStart);
  const end = lineEnd === -1 ? content.length : lineEnd;
  return `${content.slice(0, section.headingStart)}# ${newHeading.trim()}${content.slice(end)}`;
}

export function deleteCategorySection(
  content: string,
  section: CategorySection,
): string {
  const next = `${content.slice(0, section.start)}${content.slice(section.end)}`;
  return next.replace(/\n{3,}/gu, "\n\n").replace(/\n{2,}$/u, "\n");
}

function extractSectionKeywords(sectionText: string): string[] {
  const match = sectionText.match(
    /^(?:novel-keywords|keywords?|关键词|关键词列表)\s*[:：]\s*(.+)$/imu,
  );
  if (!match) {
    return [];
  }
  return parseNovelKeywords({ "novel-keywords": match[1] });
}

export function getCategorySectionBody(
  content: string,
  section: CategorySection,
): string {
  const raw = content.slice(section.start, section.end);
  const lines = raw.split(/\r?\n/u);
  if (lines.length > 0) {
    lines.shift();
  }
  if (
    lines.length > 0
    && /^(?:novel-keywords|keywords?|关键词|关键词列表)\s*[:：]/iu.test(
      lines[0] ?? "",
    )
  ) {
    lines.shift();
  }
  return lines.join("\n").trim();
}

export function replaceCategorySection(
  content: string,
  section: CategorySection,
  heading: string,
  body: string,
): string {
  const lines = [`# ${heading.trim()}`, ""];
  if (body.trim()) {
    lines.push(body.trim(), "");
  }
  const replacement = `${lines.join("\n")}\n`;
  return `${content.slice(0, section.start)}${replacement}${content.slice(section.end)}`
    .replace(/\n{3,}/gu, "\n\n")
    .replace(/\n{2,}$/u, "\n");
}
