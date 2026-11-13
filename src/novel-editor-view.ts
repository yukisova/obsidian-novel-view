import {
  ItemView,
  Menu,
  Notice,
  TFile,
  setIcon,
  type WorkspaceLeaf,
} from "obsidian";
import { defaultKeymap, history, historyKeymap } from "@codemirror/commands";
import {
  EditorState,
  RangeSetBuilder,
  StateField,
} from "@codemirror/state";
import {
  Decoration,
  EditorView,
  ViewPlugin,
  WidgetType,
  drawSelection,
  keymap,
  type DecorationSet,
  type ViewUpdate,
} from "@codemirror/view";
import { formatNovelMarkdown } from "./core/format";
import {
  OUTLINE_MARKS_PROPERTY,
  parseOutlineMarks,
  serializeOutlineMarks,
  type OutlineMark,
} from "./core/outline-marks";
import { joinVaultPath } from "./core/novel-config";
import {
  classifyLine,
  joinFrontmatterContent,
  splitFrontmatterContent,
} from "./core/paragraphs";
import {
  getOutlineMarks,
  outlineMarksExtension,
  setOutlineMarksEffect,
} from "./editor/outline-marks";
import { settingKeywordExtension } from "./editor/setting-keyword-extension";
import { TextPromptModal } from "./text-prompt-modal";
import {
  PENDING_COLOR_OPTIONS,
  pendingBlockAt,
  pendingBlockExtension,
  pendingBoundaryKeymap,
  pendingFenceProtection,
  parsePendingBlocks,
  type PendingBlock,
  type PendingColor,
} from "./editor/pending-block";
import type NovelViewPlugin from "./main";

export const NOVEL_EDITOR_VIEW_TYPE = "novelview-editor";

const sharedSaveChains = new Map<string, Promise<void>>();

class EditorImageWidget extends WidgetType {
  constructor(
    private readonly src: string,
    private readonly alt: string,
  ) {
    super();
  }

  override eq(other: EditorImageWidget): boolean {
    return other.src === this.src && other.alt === this.alt;
  }

  override toDOM(): HTMLElement {
    const figure = createEl("figure");
    figure.className = "novelview-editor-image";
    const image = createEl("img");
    image.src = this.src;
    image.alt = this.alt;
    image.loading = "lazy";
    figure.appendChild(image);
    if (this.alt) {
      const caption = createEl("figcaption");
      caption.textContent = this.alt;
      figure.appendChild(caption);
    }
    return figure;
  }

  override ignoreEvent(): boolean {
    return false;
  }
}

interface EditorImageInfo {
  src: string;
  alt: string;
}

function resolveImageLine(
  text: string,
  sourcePath: string,
  app: import("obsidian").App,
): EditorImageInfo | null {
  const trimmed = text.trim();
  const embed = /^!\[\[([^\]|]+)(?:\|[^\]]*)?\]\]$/u.exec(trimmed);
  const markdown = /^!\[([^\]]*)\]\(([^)]+)\)$/u.exec(trimmed);
  const link = embed?.[1]?.trim() ?? markdown?.[2]?.trim() ?? "";
  if (!link) {
    return null;
  }
  const target = app.metadataCache.getFirstLinkpathDest(link, sourcePath);
  if (!target) {
    return null;
  }
  return {
    src: app.vault.adapter.getResourcePath(target.path),
    alt: markdown?.[1]?.trim() ?? target.basename,
  };
}

function buildImageDecorations(
  state: EditorState,
  sourcePath: string,
  app: import("obsidian").App,
): DecorationSet {
  if (!sourcePath) {
    return Decoration.none;
  }
  const builder = new RangeSetBuilder<Decoration>();
  const { doc } = state;
  for (let lineNumber = 1; lineNumber <= doc.lines; lineNumber += 1) {
    const line = doc.line(lineNumber);
    const image = resolveImageLine(line.text, sourcePath, app);
    if (image) {
      builder.add(
        line.from,
        line.to,
        Decoration.replace({
          block: true,
          widget: new EditorImageWidget(image.src, image.alt),
        }),
      );
    }
  }
  return builder.finish();
}

function imageExtension(
  app: import("obsidian").App,
  getSourcePath: () => string,
) {
  return StateField.define<DecorationSet>({
    create(state) {
      return buildImageDecorations(state, getSourcePath(), app);
    },
    update(value, transaction) {
      return transaction.docChanged
        ? buildImageDecorations(transaction.state, getSourcePath(), app)
        : value;
    },
    provide: (field) => EditorView.decorations.from(field),
  });
}

const hrLine = Decoration.line({ class: "novelview-editor-hr" });

function buildHrDecorations(view: EditorView): DecorationSet {
  const builder = new RangeSetBuilder<Decoration>();
  for (const range of view.visibleRanges) {
    let line = view.state.doc.lineAt(range.from);
    while (line.from <= range.to) {
      if (/^(?:-{3,}|\*{3,}|_{3,})\s*$/u.test(line.text)) {
        builder.add(line.from, line.from, hrLine);
      }
      if (line.to >= view.state.doc.length) {
        break;
      }
      line = view.state.doc.line(line.number + 1);
    }
  }
  return builder.finish();
}

class HrDecorationPlugin {
  decorations: DecorationSet;

  constructor(view: EditorView) {
    this.decorations = buildHrDecorations(view);
  }

  update(update: ViewUpdate): void {
    if (update.docChanged || update.viewportChanged) {
      this.decorations = buildHrDecorations(update.view);
    }
  }
}

const hrDecorationExtension = ViewPlugin.fromClass(HrDecorationPlugin, {
  decorations: (plugin) => plugin.decorations,
});


function buildProseDecorations(view: EditorView): DecorationSet {
  const builder = new RangeSetBuilder<Decoration>();
  const { doc } = view.state;
  const visited = new Set<number>();
  for (const range of view.visibleRanges) {
    let line = doc.lineAt(range.from);
    while (line.from <= range.to) {
      if (!visited.has(line.number)) {
        visited.add(line.number);
        const previous = line.number > 1 ? doc.line(line.number - 1).text : null;
        const next = line.number < doc.lines ? doc.line(line.number + 1).text : null;
        const classification = classifyLine(line.text, previous, next);
        if (!line.text.trim()) {
          builder.add(
            line.from,
            line.from,
            Decoration.line({ class: "novelview-editor-empty-line" }),
          );
        } else if (classification.prose) {
          const classes: string[] = [];
          if (classification.paragraphStart) {
            classes.push("novelview-editor-paragraph-start");
          }
          if (classification.paragraphEnd) {
            classes.push("novelview-editor-paragraph-end");
          }
          if (/^\s/u.test(line.text)) {
            classes.push("novelview-editor-preindented");
          }
          const decoration = Decoration.line({
            class: ["novelview-editor-prose", ...classes].join(" "),
          });
          builder.add(line.from, line.from, decoration);
        }
      }
      if (line.to >= doc.length) {
        break;
      }
      line = doc.line(line.number + 1);
    }
  }
  return builder.finish();
}

class ProseDecorationPlugin {
  decorations: DecorationSet;

  constructor(view: EditorView) {
    this.decorations = buildProseDecorations(view);
  }

  update(update: ViewUpdate): void {
    if (update.docChanged || update.viewportChanged) {
      this.decorations = buildProseDecorations(update.view);
    }
  }
}

const proseDecorationExtension = ViewPlugin.fromClass(ProseDecorationPlugin, {
  decorations: (plugin) => plugin.decorations,
});

export class NovelEditorView extends ItemView {
  private readonly plugin: NovelViewPlugin;
  private filePath = "";
  private pendingLine = 1;
  private editorView: EditorView | null = null;
  private editorHost: HTMLElement | null = null;
  private chapterTitleEl: HTMLElement | null = null;
  private tocEl: HTMLElement | null = null;
  private tocList: HTMLElement | null = null;
  private tocTimer: number | null = null;
  private tocHovered = false;
  private pendingButton: HTMLButtonElement | null = null;
  private pendingPanel: HTMLElement | null = null;
  private pendingInput: HTMLInputElement | null = null;
  private pendingTitleError: HTMLElement | null = null;
  private pendingEmojiRow: HTMLElement | null = null;
  private activePending: PendingBlock | null = null;
  private pendingPanelOpen = false;
  private pendingHideTimer: number | null = null;
  private allowFenceEdit = false;
  private saveTimer: number | null = null;
  private loading = false;
  private lastSavedBody = "";
  private saveChain: Promise<void> = Promise.resolve();
  private outlineMarksTimer: number | null = null;

  constructor(leaf: WorkspaceLeaf, plugin: NovelViewPlugin) {
    super(leaf);
    this.plugin = plugin;
    this.navigation = false;
  }

  override getViewType(): string {
    return NOVEL_EDITOR_VIEW_TYPE;
  }

  override getDisplayText(): string {
    if (!this.filePath) {
      return "Novel View";
    }
    return this.filePath.split("/").pop()?.replace(/\.md$/iu, "") ?? "Novel View";
  }

  override getIcon(): string {
    return "book-open";
  }

  override getState(): Record<string, unknown> {
    return { file: this.filePath };
  }

  override async setState(
    state: Record<string, unknown>,
    result: import("obsidian").ViewStateResult,
  ): Promise<void> {
    const nextFile = typeof state.file === "string" ? state.file : this.filePath;
    if (nextFile !== this.filePath) {
      await this.flushSave();
      await this.flushOutlineMarks();
    }
    this.filePath = nextFile;
    this.pendingLine = typeof state.line === "number" ? state.line : 1;
    result.history = true;
    await super.setState(state, result);
    await this.loadFile();
  }

  protected override async onOpen(): Promise<void> {
    this.contentEl.empty();
    this.contentEl.addClass("novelview-novel-mode", "novelview-editor-view");
    this.contentEl.setCssProps({
      "--novelview-font-size": `${Number(this.plugin.settings.fontSize) || 16}px`,
      "--novelview-line-height": `${Number(this.plugin.settings.lineHeight) || 1.8}`,
      "--novelview-paragraph-spacing": `${Number(this.plugin.settings.paragraphSpacing) || 0.65}em`,
      "--novelview-first-line-indent": `${Number(this.plugin.settings.firstLineIndent) || 2}em`,
    });
    this.applySettings();
    const toolbar = this.contentEl.createDiv({ cls: "novelview-editor-toolbar" });
    this.addToolbarButton(toolbar, "wand-2", "自动排版", () => this.autoFormat());
    this.addToolbarButton(toolbar, "search", "查找替换", () => {
      this.plugin.openAdvancedSearch();
    });
    this.addToolbarButton(toolbar, "image-plus", "插入图片", () => {
      void this.insertImage();
    });
    this.addToolbarButton(toolbar, "settings-2", "格式设置", () => {
      this.plugin.openModeSettings();
    });
    this.chapterTitleEl = this.contentEl.createDiv({
      cls: "novelview-editor-title is-editable",
      attr: {
        contenteditable: "true",
        role: "textbox",
        spellcheck: "false",
        title: "点击修改章节名称",
      },
    });
    this.chapterTitleEl.setText(this.getDisplayText());
    this.chapterTitleEl.addEventListener("keydown", (event) => {
      if (event.key === "Enter") {
        event.preventDefault();
        this.chapterTitleEl?.blur();
      } else if (event.key === "Escape") {
        event.preventDefault();
        this.chapterTitleEl?.setText(this.getDisplayText());
        this.chapterTitleEl?.blur();
      }
    });
    this.chapterTitleEl.addEventListener("blur", () => {
      void this.renameFromTitle();
    });
    this.editorHost = this.contentEl.createDiv({ cls: "novelview-editor-host" });
    this.tocEl = this.contentEl.createDiv({ cls: "novelview-editor-toc" });
    const collapsed = this.tocEl.createDiv({
      cls: "novelview-editor-toc-collapsed",
    });
    for (let index = 0; index < 3; index += 1) {
      collapsed.createDiv({ cls: "novelview-editor-toc-bar" });
    }
    this.tocList = this.tocEl.createDiv({ cls: "novelview-editor-toc-list" });
    this.tocEl.addEventListener("pointerdown", (event) => {
      event.preventDefault();
    });
    this.tocEl.addEventListener("pointerenter", () => {
      this.tocHovered = true;
      this.updateTocVisibility();
    });
    this.tocEl.addEventListener("pointerleave", () => {
      this.tocHovered = false;
      this.updateTocVisibility();
    });
    this.contentEl.addEventListener("contextmenu", (event) => {
      event.preventDefault();
      event.stopPropagation();
      const target = event.target as HTMLElement | null;
      if (!target?.closest(".cm-content")) {
        return;
      }
      this.openSelectionContextMenu(event);
    }, true);
    this.pendingButton = this.contentEl.createEl("button", {
      cls: "novelview-pending-trigger",
      attr: {
        type: "button",
        "aria-label": "编辑待修改部分",
        title: "编辑待修改部分",
      },
    });
    setIcon(this.pendingButton, "pencil");
    this.pendingButton.addEventListener("pointerdown", (event) => {
      event.preventDefault();
    });
    this.pendingButton.addEventListener("pointerenter", () => {
      this.openPendingPanel();
    });
    this.pendingButton.addEventListener("pointerleave", () => {
      this.schedulePendingPanelHide();
    });

    this.pendingPanel = this.contentEl.createDiv({
      cls: "novelview-pending-panel",
    });
    this.pendingPanel.createDiv({
      cls: "novelview-pending-panel-label",
      text: "待修改部分标题",
    });
    this.pendingInput = this.pendingPanel.createEl("input", {
      cls: "novelview-pending-panel-input",
      attr: { type: "text", placeholder: "待修改部分" },
    });
    this.pendingTitleError = this.pendingPanel.createDiv({
      cls: "novelview-pending-panel-error",
    });
    this.pendingInput.addEventListener("input", () => {
      const title = (this.pendingInput?.value.trim() || "待修改部分");
      if (this.isPendingTitleDuplicate(title)) {
        this.pendingTitleError?.setText("名称已存在");
        return;
      }
      this.pendingTitleError?.setText("");
      this.updateActivePending({ title });
    });
    this.pendingPanel.createDiv({
      cls: "novelview-pending-panel-label",
      text: "背景颜色",
    });
    this.pendingEmojiRow = this.pendingPanel.createDiv({
      cls: "novelview-pending-emoji-row",
    });
    for (const option of PENDING_COLOR_OPTIONS) {
      const emoji = this.pendingEmojiRow.createEl("button", {
        cls: "novelview-pending-emoji",
        text: option.emoji,
        attr: {
          type: "button",
          "aria-label": option.color,
          title: option.color,
          "data-emoji": option.emoji,
          "data-color": option.color,
        },
      });
      emoji.addEventListener("click", () => {
        this.updateActivePending({ emoji: option.emoji, color: option.color });
      });
    }
    const remove = this.pendingPanel.createEl("button", {
      cls: "novelview-pending-delete",
      text: "移除代码块标记",
      attr: { type: "button" },
    });
    remove.addEventListener("click", () => this.deleteActivePending());
    this.pendingPanel.addEventListener("pointerenter", () => {
      this.cancelPendingPanelHide();
    });
    this.pendingPanel.addEventListener("pointerleave", () => {
      this.schedulePendingPanelHide();
    });

    this.contentEl.addEventListener("focusin", () => {
      this.updateTocVisibility();
      this.updatePendingUi();
    });
    this.contentEl.addEventListener("focusout", (event) => {
      const next = event.relatedTarget as Node | null;
      if (!next || !this.contentEl.contains(next)) {
        void this.flushSave();
      }
      window.setTimeout(() => {
        this.updateTocVisibility();
        this.updatePendingUi();
      }, 0);
    });
    this.contentEl.addEventListener("click", (event) => {
      const keyword = (event.target as HTMLElement | null)?.closest<HTMLElement>(
        ".novelview-setting-keyword",
      );
      if (keyword && this.filePath) {
        const name = keyword.dataset.novelviewSettingKeyword ?? "";
        if (name) {
          event.preventDefault();
          event.stopPropagation();
          void this.plugin.openSettingKeywordRecord(this.filePath, name);
        }
      }
    });
    if (this.filePath) {
      await this.loadFile();
    }
  }

  protected override async onClose(): Promise<void> {
    await this.flushSave();
    await this.flushOutlineMarks();
    if (this.outlineMarksTimer !== null) {
      window.clearTimeout(this.outlineMarksTimer);
      this.outlineMarksTimer = null;
    }
    if (this.saveTimer !== null) {
      window.clearTimeout(this.saveTimer);
      this.saveTimer = null;
    }
    if (this.tocTimer !== null) {
      window.clearTimeout(this.tocTimer);
      this.tocTimer = null;
    }
    this.tocEl = null;
    this.tocList = null;
    this.tocHovered = false;
    this.pendingButton = null;
    this.pendingPanel = null;
    this.pendingInput = null;
    this.pendingTitleError = null;
    this.pendingEmojiRow = null;
    this.activePending = null;
    this.pendingPanelOpen = false;
    if (this.pendingHideTimer !== null) {
      window.clearTimeout(this.pendingHideTimer);
      this.pendingHideTimer = null;
    }
    this.editorView?.destroy();
    this.editorView = null;
    this.editorHost = null;
    this.chapterTitleEl = null;
    this.contentEl.empty();
  }

  activate(): void {
    const file = this.app.vault.getAbstractFileByPath(this.filePath);
    if (file instanceof TFile) {
      this.plugin.setNovelEditorFile(file);
      void this.syncFromDisk();
    }
  }

  applySettings(): void {
    this.contentEl.setCssProps({
      "--novelview-font-size": `${Number(this.plugin.settings.fontSize) || 16}px`,
      "--novelview-line-height": `${Number(this.plugin.settings.lineHeight) || 1.8}`,
      "--novelview-paragraph-spacing": `${Number(this.plugin.settings.paragraphSpacing) || 0.65}em`,
      "--novelview-first-line-indent": `${Number(this.plugin.settings.firstLineIndent) || 2}em`,
    });
    this.contentEl.toggleClass(
      "novelview-editor-paragraph-mode-line",
      this.plugin.settings.paragraphMode === "line",
    );
    this.contentEl.toggleClass(
      "novelview-editor-paragraph-mode-blank-line",
      this.plugin.settings.paragraphMode === "blank-line",
    );
  }

  private addToolbarButton(
    toolbar: HTMLElement,
    icon: string,
    label: string,
    action: () => void,
  ): HTMLButtonElement {
    const button = toolbar.createEl("button", {
      cls: "novelview-editor-toolbar-button",
      attr: { type: "button", "aria-label": label, title: label },
    });
    setIcon(button, icon);
    button.addEventListener("click", action);
    return button;
  }

  private async loadFile(): Promise<void> {
    if (!this.editorHost || !this.filePath) {
      return;
    }
    const file = this.app.vault.getAbstractFileByPath(this.filePath);
    if (!(file instanceof TFile)) {
      this.editorHost.createDiv({
        cls: "novelview-editor-message",
        text: "找不到要打开的文章。",
      });
      return;
    }
    this.loading = true;
    try {
      const content = await this.app.vault.read(file);
      const { body } = splitFrontmatterContent(content);
      const frontmatter = this.app.metadataCache.getFileCache(file)?.frontmatter;
      const outlineMarks = parseOutlineMarks(
        frontmatter?.[OUTLINE_MARKS_PROPERTY],
      )
        .map((mark) => ({
          ...mark,
          start: Math.min(mark.start, body.length),
          end: Math.min(mark.end, body.length),
        }))
        .filter((mark) => mark.end > mark.start);
      this.editorHost.empty();
      this.editorView?.destroy();
      this.editorView = new EditorView({
        parent: this.editorHost,
        state: EditorState.create({
          doc: body,
          extensions: [
            history(),
            drawSelection(),
            keymap.of([...defaultKeymap, ...historyKeymap]),
            EditorView.lineWrapping,
            EditorView.updateListener.of((update) => {
              if (update.docChanged && !this.loading) {
                this.scheduleSave();
                this.scheduleOutlineMarksSave();
                this.scheduleTocRefresh();
              }
              if (update.docChanged || update.selectionSet) {
                this.updatePendingUi();
              }
            }),
            settingKeywordExtension,
            imageExtension(this.app, () => this.filePath),
            hrDecorationExtension,
            proseDecorationExtension,
            pendingBlockExtension,
            pendingBoundaryKeymap,
            pendingFenceProtection(() => this.allowFenceEdit),
            outlineMarksExtension,
            EditorView.theme({
              "&": {
                height: "100%",
                backgroundColor: "var(--background-primary)",
              },
              ".cm-scroller": {
                overflow: "auto",
              },
              ".cm-content": {
                padding: "20px 24px 80px",
                fontFamily: "var(--font-text, var(--font-interface))",
                fontSize: "var(--novelview-font-size, 16px)",
                lineHeight: "var(--novelview-line-height, 1.8)",
                color: "var(--text-normal)",
              },
              ".cm-line": {
                padding: "0",
              },
              "&.cm-focused": {
                outline: "none",
              },
            }),
          ],
        }),
      });
      this.editorView.dispatch({
        effects: setOutlineMarksEffect.of(outlineMarks),
      });
      const lineNumber = Math.min(
        Math.max(1, this.pendingLine),
        this.editorView.state.doc.lines,
      );
      const line = this.editorView.state.doc.line(lineNumber);
      this.editorView.dispatch({
        selection: { anchor: line.from },
        effects: EditorView.scrollIntoView(line.from, { y: "center" }),
      });
      this.lastSavedBody = body;
      this.editorView.scrollDOM.addEventListener("scroll", () => {
        this.updateTocVisibility();
        this.updatePendingUi();
      });
      this.editorView.focus();
      this.plugin.setNovelEditorFile(file);
      void this.plugin.refreshSettingKeywordIndex();
      this.containerEl.querySelector<HTMLElement>(".view-header-title")
        ?.setText(this.getDisplayText());
      this.chapterTitleEl?.setText(this.getDisplayText());
      this.renderToc();
      this.updatePendingUi();
    } catch (error) {
      console.error("Novel View: standalone editor failed to load", error);
      this.editorHost.empty();
      this.editorHost.createDiv({
        cls: "novelview-editor-message",
        text: `文章加载失败：${String(error)}`,
      });
    } finally {
      this.loading = false;
    }
  }

  private addOutlineMark(): void {
    if (!this.editorView) {
      return;
    }
    const selection = this.editorView.state.selection.main;
    if (selection.empty) {
      new Notice("Novel View：请先选中要标记的文字。");
      return;
    }
    const { from, to } = selection;
    new TextPromptModal(this.app, {
      title: "添加文字标记",
      description: "为选中的大纲文字添加一个标记名称。",
      placeholder: "例如：伏笔、冲突、转折",
      submitLabel: "标记",
      onSubmit: (label) => {
        if (!this.editorView) {
          return;
        }
        const marks = [
          ...getOutlineMarks(this.editorView.state),
          { start: from, end: to, label },
        ].sort((left, right) => left.start - right.start);
        this.editorView.dispatch({
          effects: setOutlineMarksEffect.of(marks),
        });
        void this.flushOutlineMarks();
      },
    }).open();
  }

  private outlineMarksAtSelection(): OutlineMark[] {
    if (!this.editorView) {
      return [];
    }
    const selection = this.editorView.state.selection.main;
    return getOutlineMarks(this.editorView.state).filter((mark) => (
      selection.empty
        ? selection.head >= mark.start && selection.head <= mark.end
        : mark.start < selection.to && mark.end > selection.from
    ));
  }

  private removeOutlineMarks(): void {
    if (!this.editorView) {
      return;
    }
    const selected = this.outlineMarksAtSelection();
    if (selected.length === 0) {
      return;
    }
    const marks = getOutlineMarks(this.editorView.state).filter(
      (mark) => !selected.includes(mark),
    );
    this.editorView.dispatch({
      effects: setOutlineMarksEffect.of(marks),
    });
    void this.flushOutlineMarks();
    new Notice("Novel View：已移除文字标记。");
  }

  private scheduleOutlineMarksSave(): void {
    if (this.outlineMarksTimer !== null) {
      window.clearTimeout(this.outlineMarksTimer);
    }
    this.outlineMarksTimer = window.setTimeout(() => {
      this.outlineMarksTimer = null;
      void this.flushOutlineMarks();
    }, 700);
  }

  private async flushOutlineMarks(): Promise<void> {
    if (this.outlineMarksTimer !== null) {
      window.clearTimeout(this.outlineMarksTimer);
      this.outlineMarksTimer = null;
    }
    if (!this.editorView || !this.filePath) {
      return;
    }
    const file = this.app.vault.getAbstractFileByPath(this.filePath);
    if (!(file instanceof TFile)) {
      return;
    }
    const marks = getOutlineMarks(this.editorView.state);
    try {
      await this.app.fileManager.processFrontMatter(file, (frontmatter) => {
        if (marks.length > 0) {
          frontmatter[OUTLINE_MARKS_PROPERTY] = serializeOutlineMarks(marks);
        } else {
          delete frontmatter[OUTLINE_MARKS_PROPERTY];
        }
      });
    } catch (error) {
      console.error("Novel View: failed to save outline marks", error);
    }
  }

  private async renameFromTitle(): Promise<void> {
    if (!this.chapterTitleEl || !this.filePath) {
      return;
    }
    const value = this.chapterTitleEl.textContent?.trim() ?? "";
    const file = this.app.vault.getAbstractFileByPath(this.filePath);
    if (!(file instanceof TFile)) {
      return;
    }
    if (!value) {
      this.chapterTitleEl.setText(file.basename);
      return;
    }
    if (value.startsWith("-")) {
      new Notice("Novel View：章节名称不能以 - 开头。");
      this.chapterTitleEl.setText(file.basename);
      return;
    }
    const base = this.plugin.sanitizeFileBase(value, file.basename);
    if (!base || base === file.basename) {
      this.chapterTitleEl.setText(file.basename);
      return;
    }
    const parentPath = this.plugin.normalizeFolderPath(file.parent?.path ?? "/");
    const targetPath = parentPath === "/"
      ? `${base}.md`
      : `${parentPath}/${base}.md`;
    if (this.app.vault.getAbstractFileByPath(targetPath)) {
      new Notice("Novel View：同名章节已存在。");
      this.chapterTitleEl.setText(file.basename);
      return;
    }
    this.chapterTitleEl.setText(base);
    await this.app.fileManager.renameFile(file, targetPath);
    this.filePath = targetPath;
    const renamed = this.app.vault.getAbstractFileByPath(targetPath);
    if (renamed instanceof TFile) {
      this.plugin.setNovelEditorFile(renamed);
    }
    this.plugin.refreshArticleListViews();
    this.containerEl.querySelector<HTMLElement>(".view-header-title")
      ?.setText(base);
  }

  private scheduleTocRefresh(): void {
    if (this.tocTimer !== null) {
      window.clearTimeout(this.tocTimer);
    }
    this.tocTimer = window.setTimeout(() => {
      this.tocTimer = null;
      this.renderToc();
    }, 120);
  }

  private renderToc(): void {
    const toc = this.tocEl;
    const list = this.tocList;
    if (!toc || !list || !this.editorView) {
      return;
    }
    list.empty();
    const sections: Array<{
      line: number;
      label: string;
      color?: PendingColor;
    }> = [];
    const pendingByOpenLine = new Map(
      parsePendingBlocks(this.editorView.state).map((block) => [
        block.openLine,
        block,
      ]),
    );
    let inFence = false;
    let sectionLabel = "";
    let sectionLine = 0;
    const doc = this.editorView.state.doc;
    const flushSection = (): void => {
      if (sectionLabel) {
        sections.push({ line: sectionLine, label: sectionLabel });
      }
      sectionLabel = "";
      sectionLine = 0;
    };
    for (let lineNumber = 1; lineNumber <= doc.lines; lineNumber += 1) {
      const pending = pendingByOpenLine.get(lineNumber);
      if (pending) {
        flushSection();
        sections.push({
          line: pending.contentStartLine <= doc.lines
            ? doc.line(pending.contentStartLine).from
            : pending.openFrom,
          label: pending.title,
          color: pending.color,
        });
        lineNumber = pending.closeLine;
        continue;
      }
      const line = doc.line(lineNumber);
      if (/^\s*(?:```|~~~)/u.test(line.text)) {
        inFence = !inFence;
        continue;
      }
      const isSeparator = !inFence
        && /^(?:(?:\*\s*){3,}|(?:-\s*){3,}|(?:_\s*){3,})$/u
          .test(line.text.trim());
      if (isSeparator) {
        flushSection();
        continue;
      }
      if (inFence || !line.text.trim()) {
        continue;
      }
      if (!sectionLabel) {
        const label = line.text
          .trim()
          .replace(/^#{1,6}\s+/u, "")
          .replace(/[*_`~]/gu, "")
          .replace(/\[([^\]]+)\]\([^)]+\)/gu, "$1")
          .trim();
        if (label) {
          sectionLabel = label.length > 36 ? `${label.slice(0, 36)}…` : label;
          sectionLine = line.from;
        }
      }
    }
    flushSection();
    toc.toggleClass("is-empty", sections.length === 0);
    for (const section of sections) {
      const item = list.createEl("button", {
        cls: "novelview-editor-toc-item",
        attr: { type: "button" },
      });
      if (section.color) {
        item.addClass(
          "novelview-editor-toc-pending",
          `novelview-pending-${section.color}`,
        );
      }
      item.setText(section.label);
      item.addEventListener("click", (event) => {
        event.preventDefault();
        if (!this.editorView) {
          return;
        }
        this.editorView.dispatch({
          selection: { anchor: section.line },
          effects: EditorView.scrollIntoView(section.line, { y: "start" }),
        });
        this.editorView.focus();
      });
    }
    this.updateTocVisibility();
  }

  private updateTocVisibility(): void {
    if (!this.tocEl || !this.editorView) {
      return;
    }
    this.tocEl.toggleClass("is-expanded", this.tocHovered);
    this.tocEl.toggleClass("is-collapsed", !this.tocHovered);
  }

  private async insertImage(): Promise<void> {
    if (!this.editorView || !this.filePath) {
      return;
    }
    const file = this.app.vault.getAbstractFileByPath(this.filePath);
    if (!(file instanceof TFile)) {
      return;
    }
    try {
      const localPath = await this.plugin.chooseLocalImage();
      if (!localPath) {
        return;
      }
      const root = this.plugin.findNovelGroupRoot(
        this.plugin.normalizeFolderPath(file.parent?.path ?? "/"),
      );
      const targetFolder = root ? joinVaultPath(root, "src") : undefined;
      const saved = await this.plugin.saveImageToVault(
        localPath,
        file.path,
        targetFolder,
      );
      if (!(saved instanceof TFile)) {
        new Notice("Novel View：图片插入失败。");
        return;
      }
      const marker = `![[${saved.path}]]`;
      const selection = this.editorView.state.selection.main;
      const text = this.editorView.state.doc.toString();
      const before = selection.from > 0
        && text.slice(selection.from - 1, selection.from) !== "\n"
        ? "\n"
        : "";
      const after = selection.to < text.length
        && text.slice(selection.to, selection.to + 1) !== "\n"
        ? "\n"
        : "";
      this.editorView.dispatch({
        changes: {
          from: selection.from,
          to: selection.to,
          insert: `${before}${marker}${after}`,
        },
        selection: { anchor: selection.from + before.length + marker.length },
      });
      this.editorView.focus();
    } catch (error) {
      console.error("Novel View: image insertion failed", error);
      new Notice("Novel View：图片插入失败。");
    }
  }

  private cancelPendingPanelHide(): void {
    if (this.pendingHideTimer !== null) {
      window.clearTimeout(this.pendingHideTimer);
      this.pendingHideTimer = null;
    }
  }

  private schedulePendingPanelHide(): void {
    this.cancelPendingPanelHide();
    this.pendingHideTimer = window.setTimeout(() => {
      this.pendingHideTimer = null;
      if (
        this.pendingButton?.matches(":hover")
        || this.pendingPanel?.matches(":hover")
        || this.pendingPanel?.contains(activeDocument.activeElement)
      ) {
        return;
      }
      this.pendingPanelOpen = false;
      this.pendingPanel?.removeClass("is-open");
      this.pendingButton?.removeClass("is-active");
    }, 160);
  }

  private updatePendingUi(): void {
    if (!this.editorView || !this.pendingButton || !this.pendingPanel) {
      return;
    }
    const selection = this.editorView.state.selection.main;
    const block = pendingBlockAt(this.editorView.state, selection.head);
    const panelFocused = Boolean(
      this.pendingPanel.contains(activeDocument.activeElement),
    );
    if (!block) {
      this.pendingButton.removeClass("is-visible");
      this.pendingPanelOpen = false;
      this.pendingPanel.removeClass("is-open");
      this.pendingButton.removeClass("is-active");
      this.activePending = null;
      return;
    }
    const editorFocused = this.editorView.hasFocus;
    const keepVisible = editorFocused || panelFocused || this.pendingPanelOpen;
    if (!keepVisible) {
      this.pendingButton.removeClass("is-visible");
      return;
    }
    this.activePending = block;
    this.pendingButton.addClass("is-visible");
    const coords = this.editorView.coordsAtPos(selection.head);
    if (coords) {
      const rect = this.contentEl.getBoundingClientRect();
      const top = Math.max(
        46,
        Math.min(coords.top - rect.top - 8, Math.max(80, rect.height - 110)),
      );
      this.pendingButton.setCssProps({
        "--novelview-pending-top": `${top}px`,
      });
      const panelTop = Math.min(
        Math.max(38, top - 12),
        Math.max(38, rect.height - 230),
      );
      this.pendingPanel.setCssProps({
        "--novelview-pending-top": `${panelTop}px`,
      });
    }
    if (this.pendingPanelOpen) {
      this.openPendingPanel();
    }
  }

  private openPendingPanel(): void {
    if (!this.activePending || !this.pendingPanel || !this.pendingInput) {
      return;
    }
    this.cancelPendingPanelHide();
    this.pendingPanelOpen = true;
    this.pendingPanel.addClass("is-open");
    this.pendingTitleError?.setText("");
    this.pendingButton?.addClass("is-active");
    if (activeDocument.activeElement !== this.pendingInput) {
      this.pendingInput.value = this.activePending.title;
    }
    for (const button of this.pendingEmojiRow?.querySelectorAll<HTMLElement>(
      ".novelview-pending-emoji",
    ) ?? []) {
      button.toggleClass(
        "is-selected",
        button.getAttribute("data-emoji") === this.activePending.emoji,
      );
    }
  }

  private updateActivePending(patch: {
    title?: string;
    emoji?: string;
    color?: PendingColor;
  }): void {
    if (!this.editorView || !this.activePending) {
      return;
    }
    const current = parsePendingBlocks(this.editorView.state)
      .find((block) => block.openFrom === this.activePending?.openFrom);
    if (!current) {
      return;
    }
    const title = (patch.title ?? current.title)
      .replace(/[\r\n`]/gu, " ")
      .trim();
    const emoji = patch.emoji ?? current.emoji;
    const suffix = title && title !== "待修改部分" ? ` ${title}` : "";
    const line = `\`\`\`待修改部分${emoji}${suffix}`;
    this.allowFenceEdit = true;
    this.editorView.dispatch({
      changes: {
        from: current.openFrom,
        to: current.openTo,
        insert: line,
      },
    });
    this.allowFenceEdit = false;
    if (patch.color !== undefined) {
      this.activePending = {
        ...this.activePending,
        color: patch.color,
      };
    }
    this.scheduleTocRefresh();
    this.updatePendingUi();
  }

  private deleteActivePending(): void {
    if (!this.editorView || !this.activePending) {
      return;
    }
    const block = parsePendingBlocks(this.editorView.state)
      .find((item) => item.openFrom === this.activePending?.openFrom);
    if (!block) {
      return;
    }
    this.allowFenceEdit = true;
    const removeLine = (from: number, to: number) => {
      const doc = this.editorView?.state.doc;
      if (!doc) {
        return { from, to, insert: "" };
      }
      return {
        from,
        to: to < doc.length && doc.sliceString(to, to + 1) === "\n"
          ? to + 1
          : to,
        insert: "",
      };
    };
    this.editorView.dispatch({
      changes: [
        removeLine(block.openFrom, block.openTo),
        removeLine(block.closeFrom, block.closeTo),
      ],
    });
    this.allowFenceEdit = false;
    this.pendingPanelOpen = false;
    this.pendingPanel?.removeClass("is-open");
    this.pendingButton?.removeClass("is-active");
    this.pendingButton?.removeClass("is-visible");
    this.activePending = null;
    this.editorView.focus();
    this.scheduleTocRefresh();
  }

  private isPendingTitleDuplicate(title: string): boolean {
    if (!this.editorView) {
      return false;
    }
    const value = title.trim() || "待修改部分";
    const current = this.activePending?.openFrom;
    return parsePendingBlocks(this.editorView.state).some((block) => (
      block.openFrom !== current && block.title === value
    ));
  }

  private selectionOverlapsPending(): boolean {
    if (!this.editorView) {
      return false;
    }
    const selection = this.editorView.state.selection.main;
    if (selection.empty) {
      return false;
    }
    return parsePendingBlocks(this.editorView.state).some((block) => (
      selection.from < block.closeTo + 1 && selection.to > block.openFrom
    ));
  }

  private openSelectionContextMenu(event: MouseEvent): void {
    if (!this.editorView) {
      return;
    }
    const selection = this.editorView.state.selection.main;
    const marks = this.outlineMarksAtSelection();
    if (
      (selection.empty || this.selectionOverlapsPending())
      && marks.length === 0
    ) {
      return;
    }
    const menu = new Menu();
    if (!selection.empty && !this.selectionOverlapsPending()) {
      menu.addItem((item) => {
        item
          .setTitle("转换成待修改代码块")
          .setIcon("square-pen")
          .onClick(() => this.wrapSelectionInPending());
      });
    }
    if (!selection.empty) {
      menu.addItem((item) => {
        item
          .setTitle("添加文字标记")
          .setIcon("highlighter")
          .onClick(() => this.addOutlineMark());
      });
    }
    if (marks.length > 0) {
      menu.addItem((item) => {
        item
          .setTitle("移除文字标记")
          .setIcon("eraser")
          .onClick(() => this.removeOutlineMarks());
      });
    }
    menu.showAtMouseEvent(event);
  }

  private uniquePendingTitle(): string {
    if (!this.editorView) {
      return "待修改部分";
    }
    const used = new Set(
      parsePendingBlocks(this.editorView.state).map((block) => block.title),
    );
    if (!used.has("待修改部分")) {
      return "待修改部分";
    }
    let index = 2;
    while (used.has(`待修改部分 ${index}`)) {
      index += 1;
    }
    return `待修改部分 ${index}`;
  }

  private wrapSelectionInPending(): void {
    if (!this.editorView) {
      return;
    }
    const selection = this.editorView.state.selection.main;
    if (selection.empty) {
      return;
    }
    const doc = this.editorView.state.doc;
    const selected = this.editorView.state.sliceDoc(selection.from, selection.to);
    if (!selected.trim()) {
      return;
    }
    const title = this.uniquePendingTitle();
    const info = title === "待修改部分"
      ? "```待修改部分🟢"
      : `\`\`\`待修改部分🟢 ${title}`;
    const body = selected.endsWith("\n") ? selected.slice(0, -1) : selected;
    const before = selection.from > 0
      && doc.sliceString(selection.from - 1, selection.from) !== "\n"
      ? "\n"
      : "";
    const after = selection.to < doc.length
      && doc.sliceString(selection.to, selection.to + 1) !== "\n"
      ? "\n"
      : "";
    const insertion = `${before}${info}\n${body}\n\`\`\`${after}`;
    this.allowFenceEdit = true;
    this.editorView.dispatch({
      changes: { from: selection.from, to: selection.to, insert: insertion },
      selection: { anchor: selection.from + insertion.length },
    });
    this.allowFenceEdit = false;
    this.editorView.focus();
    this.scheduleTocRefresh();
  }

  private autoFormat(): void {
    if (!this.editorView) {
      return;
    }
    const result = formatNovelMarkdown(this.editorView.state.doc.toString());
    if (!result.changed) {
      new Notice("Novel View：文档已经是整洁格式，无需调整。");
      return;
    }
    this.allowFenceEdit = true;
    this.editorView.dispatch({
      changes: {
        from: 0,
        to: this.editorView.state.doc.length,
        insert: result.text,
      },
    });
    this.allowFenceEdit = false;
    this.scheduleSave();
  }

  private scheduleSave(): void {
    if (this.loading) {
      return;
    }
    if (this.saveTimer !== null) {
      window.clearTimeout(this.saveTimer);
    }
    this.saveTimer = window.setTimeout(() => {
      this.saveTimer = null;
      void this.flushSave();
    }, 400);
  }

  private async flushSave(): Promise<void> {
    if (!this.editorView || !this.filePath) {
      return;
    }
    const file = this.app.vault.getAbstractFileByPath(this.filePath);
    if (!(file instanceof TFile)) {
      return;
    }
    const body = this.editorView.state.doc.toString();
    if (body === this.lastSavedBody) {
      return;
    }
    const previous = sharedSaveChains.get(file.path) ?? this.saveChain;
    const task = previous
      .catch(() => undefined)
      .then(async () => {
        await this.app.vault.process(file, (data) => {
          const { head } = splitFrontmatterContent(data);
          return joinFrontmatterContent(head, body);
        });
        this.lastSavedBody = body;
      })
      .catch((error) => {
        console.error("Novel View: save failed", error);
        new Notice("Novel View：文章保存失败。");
      });
    this.saveChain = task;
    sharedSaveChains.set(file.path, task);
    try {
      await task;
    } finally {
      if (sharedSaveChains.get(file.path) === task) {
        sharedSaveChains.delete(file.path);
      }
    }
  }

  private async syncFromDisk(): Promise<void> {
    if (!this.editorView || !this.filePath) {
      return;
    }
    const path = this.filePath;
    await new Promise((resolve) => window.setTimeout(resolve, 20));
    const pendingSave = sharedSaveChains.get(path);
    if (pendingSave) {
      await pendingSave.catch(() => undefined);
    }
    const file = this.app.vault.getAbstractFileByPath(path);
    if (!(file instanceof TFile) || !this.editorView || this.filePath !== path) {
      return;
    }
    let content: string;
    try {
      content = await this.app.vault.read(file);
    } catch {
      return;
    }
    if (!this.editorView || this.filePath !== path) {
      return;
    }
    const diskBody = splitFrontmatterContent(content).body;
    const currentBody = this.editorView.state.doc.toString();
    if (diskBody === currentBody) {
      this.lastSavedBody = diskBody;
      return;
    }
    if (currentBody !== this.lastSavedBody) {
      await this.flushSave();
      return;
    }
    const selection = this.editorView.state.selection.main;
    const scrollTop = this.editorView.scrollDOM.scrollTop;
    this.loading = true;
    try {
      this.editorView.dispatch({
        changes: {
          from: 0,
          to: this.editorView.state.doc.length,
          insert: diskBody,
        },
        selection: {
          anchor: Math.min(selection.head, diskBody.length),
        },
      });
    } finally {
      this.loading = false;
    }
    this.lastSavedBody = diskBody;
    this.editorView.scrollDOM.scrollTop = scrollTop;
    this.scheduleTocRefresh();
    this.updatePendingUi();
  }
}
