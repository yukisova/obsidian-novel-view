import {
  ItemView,
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
import { joinVaultPath } from "./core/novel-config";
import {
  classifyLine,
  joinFrontmatterContent,
  splitFrontmatterContent,
} from "./core/paragraphs";
import { linkKeywordExtension } from "./editor/link-keyword-extension";
import type NovelViewPlugin from "./main";

export const NOVEL_EDITOR_VIEW_TYPE = "novelview-editor";

class EditorTitleWidget extends WidgetType {
  constructor(private readonly title: string) {
    super();
  }

  override eq(other: EditorTitleWidget): boolean {
    return other.title === this.title;
  }

  override toDOM(): HTMLElement {
    const title = document.createElement("div");
    title.className = "novelview-editor-title";
    title.textContent = this.title;
    return title;
  }

  override ignoreEvent(): boolean {
    return true;
  }
}

function titleExtension(title: string) {
  return EditorView.decorations.of(
    Decoration.set([
      Decoration.widget({
        widget: new EditorTitleWidget(title),
        side: -1,
        block: true,
      }).range(0),
    ]),
  );
}

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
    const figure = document.createElement("figure");
    figure.className = "novelview-editor-image";
    const image = document.createElement("img");
    image.src = this.src;
    image.alt = this.alt;
    image.loading = "lazy";
    figure.appendChild(image);
    if (this.alt) {
      const caption = document.createElement("figcaption");
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
        if (classification.prose) {
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
  private tocEl: HTMLElement | null = null;
  private tocList: HTMLElement | null = null;
  private tocTimer: number | null = null;
  private tocHovered = false;
  private saveTimer: number | null = null;
  private loading = false;
  private lastSavedBody = "";
  private saveChain: Promise<void> = Promise.resolve();

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
    }, true);
    this.contentEl.addEventListener("focusin", () => this.updateTocVisibility());
    this.contentEl.addEventListener("focusout", () => {
      window.setTimeout(() => this.updateTocVisibility(), 0);
    });
    this.contentEl.addEventListener("click", (event) => {
      const keyword = (event.target as HTMLElement | null)?.closest<HTMLElement>(
        ".novelview-link-keyword",
      );
      const path = keyword?.getAttribute("data-novelview-link-path");
      if (path && this.filePath) {
        event.preventDefault();
        event.stopPropagation();
        const file = this.app.vault.getAbstractFileByPath(this.filePath);
        if (file instanceof TFile) {
          this.plugin.openLinkKeywordTarget(path, file);
        }
      }
    });
    if (this.filePath) {
      await this.loadFile();
    }
  }

  protected override async onClose(): Promise<void> {
    await this.flushSave();
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
    this.editorView?.destroy();
    this.editorView = null;
    this.editorHost = null;
    this.contentEl.empty();
  }

  activate(): void {
    const file = this.app.vault.getAbstractFileByPath(this.filePath);
    if (file instanceof TFile) {
      this.plugin.setNovelEditorFile(file);
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
  ): void {
    const button = toolbar.createEl("button", {
      cls: "novelview-editor-toolbar-button",
      attr: { type: "button", "aria-label": label, title: label },
    });
    setIcon(button, icon);
    button.addEventListener("click", action);
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
                this.scheduleTocRefresh();
              }
            }),
            linkKeywordExtension,
            titleExtension(this.getDisplayText()),
            imageExtension(this.app, () => this.filePath),
            hrDecorationExtension,
            proseDecorationExtension,
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
      this.editorView.focus();
      this.plugin.setNovelEditorFile(file);
      this.plugin.refreshLinkKeywordIndex();
      this.containerEl.querySelector<HTMLElement>(".view-header-title")
        ?.setText(this.getDisplayText());
      this.renderToc();
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
    const sections: Array<{ line: number; label: string }> = [];
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
      const chooseLocalImage = (this.plugin as any).chooseLocalImage as
        () => Promise<string | null>;
      const localPath = await chooseLocalImage.call(this.plugin);
      if (!localPath) {
        return;
      }
      const root = this.plugin.findNovelGroupRoot(
        this.plugin.normalizeFolderPath(file.parent?.path ?? "/"),
      );
      const targetFolder = root ? joinVaultPath(root, "src") : undefined;
      const saveImageToVault = (this.plugin as any).saveImageToVault as
        (local: string, source: string, target?: string) => Promise<TFile | null>;
      const saved = await saveImageToVault.call(
        this.plugin,
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

  private autoFormat(): void {
    if (!this.editorView) {
      return;
    }
    const result = formatNovelMarkdown(this.editorView.state.doc.toString());
    if (!result.changed) {
      new Notice("Novel View：文档已经是整洁格式，无需调整。");
      return;
    }
    this.editorView.dispatch({
      changes: {
        from: 0,
        to: this.editorView.state.doc.length,
        insert: result.text,
      },
    });
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
    this.saveChain = this.saveChain.then(async () => {
      await this.app.vault.process(file, (data) => {
        const { head } = splitFrontmatterContent(data);
        return joinFrontmatterContent(head, body);
      });
      this.lastSavedBody = body;
    }).catch((error) => {
      console.error("Novel View: save failed", error);
      new Notice("Novel View：文章保存失败。");
    });
    await this.saveChain;
  }
}
