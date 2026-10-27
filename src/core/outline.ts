import { joinVaultPath } from "./novel-setting";
import { findFrontmatterEnd } from "./paragraphs";

export const OUTLINE_FILE_NAME = "大纲.md";
export const OUTLINE_TYPE = "outline";

export type OutlineLevel = "volume" | "chapter";

export interface OutlineEntry {
  level: OutlineLevel;
  title: string;
  line: number;
  body: string;
}

export interface OutlineData {
  volume: OutlineEntry[];
  chapter: OutlineEntry[];
}

export function isOutlineFileName(name: string): boolean {
  return name.replace(/\.md$/iu, "") === "大纲";
}

export function getOutlineFilePath(folderPath: string): string {
  return joinVaultPath(folderPath, OUTLINE_FILE_NAME);
}

export function createOutlineFileContent(): string {
  return [
    "---",
    `novelview-type: ${OUTLINE_TYPE}`,
    "---",
    "",
    "# 卷纲",
    "",
    "# 章纲",
    "",
  ].join("\n");
}

export function parseOutline(content: string): OutlineData {
  const source = content.charCodeAt(0) === 0xfeff
    ? content.slice(1)
    : content;
  const lines = source.split("\n");
  const frontmatterEnd = findFrontmatterEnd(
    (index) => lines[index] ?? null,
    lines.length,
  );

  const data: OutlineData = { volume: [], chapter: [] };
  let level: OutlineLevel | null = null;
  let inFence = false;
  let current: OutlineEntry | null = null;
  let body: string[] = [];

  const finish = (): void => {
    if (current) {
      current.body = body.join("\n").trim();
      data[current.level].push(current);
    }
    current = null;
    body = [];
  };

  for (let index = frontmatterEnd; index < lines.length; index += 1) {
    const line = lines[index] ?? "";
    if (/^\s*(```|~~~)/u.test(line)) {
      inFence = !inFence;
      if (current) {
        body.push(line);
      }
      continue;
    }
    if (inFence) {
      if (current) {
        body.push(line);
      }
      continue;
    }

    const h1 = line.match(/^#\s+(.+?)\s*#*\s*$/u);
    if (h1) {
      finish();
      const title = h1[1].trim();
      if (/^(卷纲|卷大纲|volume)$/iu.test(title)) {
        level = "volume";
      } else if (/^(章纲|章大纲|chapter)$/iu.test(title)) {
        level = "chapter";
      } else {
        level = null;
      }
      continue;
    }

    const h2 = line.match(/^##\s+(.+?)\s*#*\s*$/u);
    if (h2 && level) {
      finish();
      current = {
        level,
        title: h2[1].trim(),
        line: index + 1,
        body: "",
      };
      continue;
    }

    if (current) {
      body.push(line);
    }
  }

  finish();
  return data;
}

export function upsertOutlineEntry(
  content: string,
  level: OutlineLevel,
  title: string,
  body: string,
): string {
  const data = parseOutline(content);
  const normalizedTitle = title.trim();
  const normalizedBody = body.trim();
  const existing = data[level].find(
    (entry) => entry.title === normalizedTitle,
  );

  if (existing) {
    existing.body = normalizedBody;
  } else {
    data[level].push({
      level,
      title: normalizedTitle,
      line: 0,
      body: normalizedBody,
    });
  }

  return serializeOutline(data);
}

export function deleteOutlineEntry(
  content: string,
  entry: OutlineEntry,
): string {
  const data = parseOutline(content);
  data[entry.level] = data[entry.level].filter(
    (candidate) => candidate.title !== entry.title,
  );
  return serializeOutline(data);
}

export function serializeOutline(data: OutlineData): string {
  const lines = [
    "---",
    `novelview-type: ${OUTLINE_TYPE}`,
    "---",
    "",
    "# 卷纲",
    "",
  ];

  for (const entry of data.volume) {
    lines.push(`## ${entry.title}`, "");
    if (entry.body.trim()) {
      lines.push(entry.body.trim(), "");
    }
  }

  lines.push("# 章纲", "");
  for (const entry of data.chapter) {
    lines.push(`## ${entry.title}`, "");
    if (entry.body.trim()) {
      lines.push(entry.body.trim(), "");
    }
  }

  return lines.join("\n").replace(/\n{3,}/gu, "\n\n").trimEnd() + "\n";
}
