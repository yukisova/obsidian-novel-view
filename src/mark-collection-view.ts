import {
  ItemView,
  setIcon,
  TAbstractFile,
  TFile,
  type WorkspaceLeaf,
} from "obsidian";
import {
  OUTLINE_MARKS_PROPERTY,
  parseOutlineMarks,
  serializeOutlineMarks,
} from "./core/outline-marks";
import { splitFrontmatterContent } from "./core/paragraphs";
import type NovelViewPlugin from "./main";

export const TEXT_MARKS_VIEW_TYPE = "novelview-text-marks";

export interface MarkOccurrence {
  file: TFile;
  start: number;
  end: number;
  label: string;
  text: string;
  line: number;
}

export interface MarkGroup {
  label: string;
  occurrences: MarkOccurrence[];
}

export interface TextMarkCollection {
  groups: MarkGroup[];
  conflicts: number;
}

interface DragState {
  occurrence: MarkOccurrence;
  startX: number;
  startY: number;
  moved: boolean;
  target: HTMLElement | null;
}

export class TextMarkCollectionView extends ItemView {
  private readonly plugin: NovelViewPlugin;
  private folderPath = "";
  private refreshToken = 0;
  private refreshTimer: number | null = null;
  private drag: DragState | null = null;
  private lastFingerprint = "";
  private pendingRefresh = false;

  constructor(leaf: WorkspaceLeaf, plugin: NovelViewPlugin) {
    super(leaf);
    this.plugin = plugin;
    this.navigation = false;
  }

  override getViewType(): string {
    return TEXT_MARKS_VIEW_TYPE;
  }

  override getDisplayText(): string {
    return "文字标记";
  }

  override getIcon(): string {
    return "highlighter";
  }

  override getState(): Record<string, unknown> {
    return { folderPath: this.folderPath };
  }

  override async setState(
    state: Record<string, unknown>,
    result: import("obsidian").ViewStateResult,
  ): Promise<void> {
    this.folderPath = typeof state.folderPath === "string"
      ? state.folderPath
      : this.folderPath;
    result.history = true;
    await super.setState(state, result);
    await this.render(true);
  }

  protected override async onOpen(): Promise<void> {
    this.contentEl.addClass("novelview-mark-collection-view");
    const schedule = (file: TAbstractFile): void => {
      if (file instanceof TFile && file.extension === "md") {
        this.scheduleRefresh();
      }
    };
    this.registerEvent(this.app.vault.on("modify", schedule));
    this.registerEvent(this.app.vault.on("create", schedule));
    this.registerEvent(this.app.vault.on("delete", schedule));
    this.registerEvent(this.app.metadataCache.on("changed", schedule));
    await this.render(true);
  }

  protected override async onClose(): Promise<void> {
    this.refreshToken += 1;
    if (this.refreshTimer !== null) {
      window.clearTimeout(this.refreshTimer);
      this.refreshTimer = null;
    }
    this.contentEl.empty();
  }

  private scheduleRefresh(): void {
    if (this.drag) {
      this.pendingRefresh = true;
      return;
    }
    if (this.refreshTimer !== null) {
      window.clearTimeout(this.refreshTimer);
    }
    this.refreshTimer = window.setTimeout(() => {
      this.refreshTimer = null;
      void this.render();
    }, 320);
  }

  private async render(force = false): Promise<void> {
    const token = ++this.refreshToken;
    const novelRoot = this.plugin.findNovelGroupRoot(this.folderPath)
      ?? this.plugin.normalizeFolderPath(this.folderPath);
    const data = await collectTextMarks(this.app, this.plugin, novelRoot);
    if (token !== this.refreshToken) {
      return;
    }
    const fingerprint = JSON.stringify({
      conflicts: data.conflicts,
      groups: data.groups.map((group) => ({
        label: group.label,
        occurrences: group.occurrences.map((occurrence) => [
          occurrence.file.path,
          occurrence.start,
          occurrence.end,
          occurrence.text,
          occurrence.line,
        ]),
      })),
    });
    if (!force && fingerprint === this.lastFingerprint) {
      return;
    }
    this.lastFingerprint = fingerprint;
    const scrollTop = this.contentEl.scrollTop;
    this.contentEl.empty();
    this.contentEl.addClass("novelview-mark-collection-view");
    const header = this.contentEl.createDiv({
      cls: "novelview-setting-collection-header",
    });
    header.createDiv({
      cls: "novelview-setting-collection-title",
      text: "文字标记",
    });
    const novelName = this.plugin.getNovelGroupInfo(novelRoot)?.name ?? "";
    if (novelName) {
      header.createDiv({
        cls: "novelview-setting-collection-subtitle",
        text: novelName,
      });
    }
    const toolbar = header.createDiv({
      cls: "novelview-setting-collection-toolbar",
    });
    const refresh = toolbar.createEl("button", {
      cls: "novelview-setting-collection-small-button",
      attr: { type: "button", "aria-label": "刷新文字标记", title: "刷新文字标记" },
    });
    setIcon(refresh, "refresh-cw");
    refresh.addEventListener("click", () => void this.render(true));

    if (data.conflicts > 0) {
      const warning = this.contentEl.createDiv({
        cls: "novelview-mark-conflict",
      });
      setIcon(warning.createSpan({ cls: "novelview-mark-conflict-icon" }), "alert-triangle");
      warning.createSpan({
        text: `检测到 ${data.conflicts} 处文字标记区间重叠，请先处理冲突后再添加新标记。`,
      });
    }

    if (data.groups.length === 0) {
      this.contentEl.createDiv({
        cls: "novelview-setting-collection-empty novelview-mark-empty",
        text: "暂无文字标记。在正文中选中文字并添加标记后会显示在这里。",
      });
      this.contentEl.scrollTop = scrollTop;
      return;
    }
    const tags = this.contentEl.createDiv({
      cls: "novelview-setting-collection-tags novelview-mark-tags",
    });
    for (const group of data.groups) {
      this.renderMarkGroup(tags, group);
    }
    this.contentEl.scrollTop = scrollTop;
  }

  private renderMarkGroup(parent: HTMLElement, group: MarkGroup): void {
    const tagCard = parent.createDiv({
      cls: "novelview-setting-collection-tag novelview-mark-tag",
      attr: { "data-mark-label": group.label },
    });
    const heading = tagCard.createDiv({
      cls: "novelview-setting-collection-tag-title",
    });
    heading.createSpan({
      cls: "novelview-setting-collection-tag-dot",
    });
    heading.createSpan({
      cls: "novelview-setting-collection-tag-name",
      text: group.label,
    });
    heading.createSpan({
      cls: "novelview-setting-collection-count",
      text: `${group.occurrences.length}`,
    });
    const body = tagCard.createDiv({
      cls: "novelview-setting-collection-tag-body novelview-mark-tag-body",
    });
    for (const occurrence of group.occurrences) {
      const row = body.createDiv({
        cls: "novelview-setting-collection-entry novelview-mark-entry",
        attr: {
          "data-mark-instance": "true",
          "data-mark-file": occurrence.file.path,
          "data-mark-start": String(occurrence.start),
          "data-mark-end": String(occurrence.end),
        },
      });
      const grip = row.createSpan({
        cls: "novelview-setting-collection-drag-grip",
      });
      setIcon(grip, "grip-vertical");
      const icon = row.createSpan({
        cls: "novelview-setting-collection-entry-icon",
      });
      setIcon(icon, "file-text");
      const info = row.createDiv({ cls: "novelview-mark-entry-info" });
      info.createDiv({
        cls: "novelview-setting-collection-keyword novelview-mark-entry-text",
        text: occurrence.text,
      });
      info.createDiv({
        cls: "novelview-setting-collection-content novelview-mark-entry-meta",
        text: `${occurrence.file.basename} · 第 ${occurrence.line} 行`,
      });
      this.attachInstanceDrag(row, occurrence);
    }
  }

  private attachInstanceDrag(
    row: HTMLElement,
    occurrence: MarkOccurrence,
  ): void {
    row.addEventListener("pointerdown", (event) => {
      if (event.button !== 0 || this.drag) {
        return;
      }
      event.preventDefault();
      event.stopPropagation();
      if (this.refreshTimer !== null) {
        window.clearTimeout(this.refreshTimer);
        this.refreshTimer = null;
      }
      this.pendingRefresh = true;
      const drag: DragState = {
        occurrence,
        startX: event.clientX,
        startY: event.clientY,
        moved: false,
        target: null,
      };
      this.drag = drag;
      row.addClass("is-pressed");
      const onMove = (moveEvent: PointerEvent): void => {
        if (!drag.moved) {
          if (
            Math.hypot(
              moveEvent.clientX - drag.startX,
              moveEvent.clientY - drag.startY,
            ) <= 4
          ) {
            return;
          }
          drag.moved = true;
          row.addClass("is-dragging");
        }
        moveEvent.preventDefault();
        const element = this.contentEl.ownerDocument.elementFromPoint(
          moveEvent.clientX,
          moveEvent.clientY,
        );
        const target = element?.closest<HTMLElement>("[data-mark-label]") ?? null;
        if (target === drag.target) {
          return;
        }
        drag.target?.removeClass("is-drop-inside");
        target?.addClass("is-drop-inside");
        drag.target = target;
      };
      const onUp = (upEvent: PointerEvent): void => {
        window.removeEventListener("pointermove", onMove, true);
        window.removeEventListener("pointerup", onUp, true);
        window.removeEventListener("pointercancel", onUp, true);
        this.drag = null;
        row.removeClass("is-pressed");
        row.removeClass("is-dragging");
        drag.target?.removeClass("is-drop-inside");
        const targetLabel = drag.target?.dataset.markLabel;
        if (drag.moved && !targetLabel) {
          const element = this.contentEl.ownerDocument.elementFromPoint(
            upEvent.clientX,
            upEvent.clientY,
          );
          const targetView = element?.closest<HTMLElement>(
            ".novelview-special-editor-view",
          );
          if (targetView && !targetView.contains(this.contentEl)) {
            targetView.dispatchEvent(new CustomEvent(
              "novelview-text-mark-drop",
              {
                bubbles: true,
                detail: {
                  label: drag.occurrence.label,
                  text: drag.occurrence.text,
                  file: drag.occurrence.file.path,
                  start: drag.occurrence.start,
                  end: drag.occurrence.end,
                  clientX: upEvent.clientX,
                  clientY: upEvent.clientY,
                },
              },
            ));
          }
        } else if (
          drag.moved
          && targetLabel
          && targetLabel !== drag.occurrence.label
        ) {
          void this.moveOccurrence(drag.occurrence, targetLabel);
        } else if (!drag.moved) {
          void this.plugin.openTextMarkRange(
            drag.occurrence.file,
            drag.occurrence.start,
            drag.occurrence.end,
          );
        }
        if (this.pendingRefresh) {
          this.pendingRefresh = false;
          this.scheduleRefresh();
        }
      };
      window.addEventListener("pointermove", onMove, true);
      window.addEventListener("pointerup", onUp, true);
      window.addEventListener("pointercancel", onUp, true);
    });
  }

  private async moveOccurrence(
    occurrence: MarkOccurrence,
    label: string,
  ): Promise<void> {
    await this.app.fileManager.processFrontMatter(occurrence.file, (
      frontmatter: Record<string, unknown>,
    ) => {
      const marks = parseOutlineMarks(frontmatter[OUTLINE_MARKS_PROPERTY]);
      const next = marks.map((mark) => (
        mark.start === occurrence.start
        && mark.end === occurrence.end
        && mark.label === occurrence.label
          ? { ...mark, label }
          : mark
      ));
      if (next.length > 0) {
        frontmatter[OUTLINE_MARKS_PROPERTY] = serializeOutlineMarks(next);
      }
    });
    this.scheduleRefresh();
  }
}

export async function collectTextMarks(
  app: import("obsidian").App,
  plugin: NovelViewPlugin,
  novelRoot: string,
): Promise<TextMarkCollection> {
  const root = plugin.normalizeFolderPath(novelRoot);
  const files = app.vault.getMarkdownFiles()
    .filter((file) => (
      plugin.isNovelArticleFile(file)
      && (file.path === root || file.path.startsWith(`${root}/`))
    ))
    .sort((left, right) => left.path.localeCompare(right.path, "zh-CN"));
  const groups = new Map<string, MarkGroup>();
  let conflicts = 0;
  for (const file of files) {
    const rawContent = await app.vault.cachedRead(file);
    const body = splitFrontmatterContent(rawContent).body;
    const frontmatter = app.metadataCache.getFileCache(file)?.frontmatter;
    const rawMarks = parseOutlineMarks(frontmatter?.[OUTLINE_MARKS_PROPERTY]);
    const boundedMarks = rawMarks.filter((mark) => (
      mark.start >= 0
      && mark.end > mark.start
      && mark.end <= body.length
    ));
    const validMarks = boundedMarks.filter((mark) => (
      Boolean(body.slice(mark.start, mark.end).trim())
    ));
    const sorted = [...validMarks].sort((left, right) => left.start - right.start);
    for (let index = 1; index < sorted.length; index += 1) {
      if ((sorted[index]?.start ?? 0) < (sorted[index - 1]?.end ?? 0)) {
        conflicts += 1;
      }
    }
    for (const mark of validMarks) {
      const group = groups.get(mark.label) ?? {
        label: mark.label,
        occurrences: [],
      };
      const text = body.slice(mark.start, mark.end).trim();
      group.occurrences.push({
        file,
        start: mark.start,
        end: mark.end,
        label: mark.label,
        text: text.length > 80 ? `${text.slice(0, 80)}…` : text,
        line: body.slice(0, mark.start).split("\n").length,
      });
      groups.set(mark.label, group);
    }
  }
  return {
    groups: [...groups.values()].sort((left, right) => (
      right.occurrences.length - left.occurrences.length
      || left.label.localeCompare(right.label, "zh-CN")
    )),
    conflicts,
  };
}
