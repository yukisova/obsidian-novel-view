import type { MarkdownView } from "obsidian";
import { findFrontmatterEnd } from "./core/paragraphs";

interface SectionInfo {
  line: number;
  label: string;
}

export class SectionToc {
  private readonly view: MarkdownView;
  private readonly root: HTMLElement;
  private sections: SectionInfo[] = [];
  private content = "";

  constructor(view: MarkdownView) {
    this.view = view;
    this.root = view.containerEl.createDiv({ cls: "novelview-section-toc" });
    this.root.setAttr("aria-label", "文章目录");
    this.root.setAttr("tabindex", "0");
    this.root.setAttr("title", "文章目录（聚焦展开）");
    view.containerEl.addClass("novelview-toc-host");
  }

  update(content: string): void {
    if (content === this.content) {
      return;
    }
    this.content = content;
    this.sections = parseSections(content);
    this.render();
  }

  destroy(): void {
    this.root.remove();
    this.view.containerEl.removeClass("novelview-toc-host");
  }

  private render(): void {
    this.root.empty();
    if (this.sections.length < 2) {
      this.root.addClass("is-empty");
      return;
    }
    this.root.removeClass("is-empty");
    this.root.createDiv({ cls: "novelview-section-toc-title", text: "目录" });
    for (const section of this.sections) {
      const button = this.root.createEl("button", {
        cls: "novelview-section-toc-item",
        attr: { type: "button" },
      });
      button.createSpan({ text: section.label });
      button.addEventListener("click", () => {
        const line = Math.max(0, section.line);
        const position = { line, ch: 0 };
        try {
          this.view.editor.setCursor(position);
          this.view.editor.scrollIntoView({ from: position, to: position }, true);
          this.view.editor.focus();
        } catch {
          // Editor may have switched modes.
        }
      });
    }
  }
}

function parseSections(content: string): SectionInfo[] {
  const source = content.replace(/^\uFEFF/u, "");
  const lines = source.split(/\r?\n/u);
  const frontmatterEnd = findFrontmatterEnd(
    (index) => lines[index] ?? null,
    lines.length,
  );
  const sections: Array<{ line: number; lines: string[] }> = [];
  let current: { line: number; lines: string[] } | null = null;
  let inFence = false;

  for (let index = frontmatterEnd; index < lines.length; index += 1) {
    const line = lines[index] ?? "";
    if (/^\s*(```|~~~)/u.test(line)) {
      inFence = !inFence;
    }
    const separator = !inFence && /^\s*(?:-{3,}|\*{3,})\s*$/u.test(line);
    if (separator) {
      if (current) {
        sections.push(current);
      }
      current = { line: index + 1, lines: [] };
      continue;
    }
    if (!current) {
      current = { line: index + 1, lines: [] };
    }
    current.lines.push(line);
  }
  if (current) {
    sections.push(current);
  }
  return sections
    .map((section) => {
      const first = section.lines.find((line) => line.trim().length > 0) ?? "";
      const label = first
        .replace(/^#{1,6}\s+/u, "")
        .replace(/[*_`>[\]]/gu, "")
        .trim()
        .slice(0, 24);
      return {
        line: Math.max(0, section.line - 1),
        label: label || `第 ${sections.indexOf(section) + 1} 部分`,
      };
    })
    .filter((section) => section.label.length > 0);
}
