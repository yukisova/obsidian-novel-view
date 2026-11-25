export interface ParsedTxtChapter {
  title: string;
  volume: string | null;
  body: string;
}

const VOLUME_LINE = /^第([0-9一二三四五六七八九十百千万零〇两]+)卷(?:[\s\u3000]+(.*))?$/u;

function trimTrailingBlankLines(lines: string[]): string[] {
  let end = lines.length;
  while (end > 0 && lines[end - 1].trim() === "") {
    end -= 1;
  }
  return lines.slice(0, end);
}

/** Parse the TXT interchange format used by import/export. */
export function parseNovelTxt(content: string): ParsedTxtChapter[] {
  const text = content.charCodeAt(0) === 0xfeff ? content.slice(1) : content;
  const chapters: ParsedTxtChapter[] = [];
  let volume: string | null = null;
  let title: string | null = null;
  let bodyLines: string[] = [];

  const finish = (): void => {
    if (title !== null) {
      chapters.push({
        title,
        volume,
        body: trimTrailingBlankLines(bodyLines).join("\n"),
      });
    }
    title = null;
    bodyLines = [];
  };

  for (const rawLine of text.split(/\r?\n/u)) {
    if (rawLine.startsWith("\u3000\u3000")) {
      if (title !== null) {
        bodyLines.push(rawLine.slice(2));
      }
      continue;
    }
    const line = rawLine.trim();
    if (!line) {
      if (title !== null) {
        bodyLines.push("");
      }
      continue;
    }
    const volumeMatch = VOLUME_LINE.exec(line);
    if (volumeMatch) {
      finish();
      volume = (volumeMatch[2] ?? "").trim() || `第${volumeMatch[1]}卷`;
      continue;
    }
    finish();
    title = line;
  }
  finish();
  return chapters;
}

export interface TxtExportChapter {
  title: string;
  volume: string | null;
  volumeNumber?: number;
  body: string;
}

/** Format chapters as the TXT interchange format used by import/export. */
export function formatNovelTxt(chapters: TxtExportChapter[]): string {
  const lines: string[] = [];
  let previousVolume: string | null | undefined;
  for (const chapter of chapters) {
    if (chapter.volume && chapter.volume !== previousVolume) {
      const number = chapter.volumeNumber ?? 1;
      lines.push(`第${number}卷 ${chapter.volume}`);
    }
    previousVolume = chapter.volume;
    lines.push(chapter.title);
    for (const line of chapter.body.split(/\r?\n/u)) {
      lines.push(`\u3000\u3000${line}`);
    }
  }
  return lines.join("\n");
}
