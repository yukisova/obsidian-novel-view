import {
  ItemView,
  Menu,
  Notice,
  TFile,
  setIcon,
  type WorkspaceLeaf,
} from "obsidian";
import {
  cursorLineDown,
  cursorLineUp,
  defaultKeymap,
  history,
  historyKeymap,
} from "@codemirror/commands";
import {
  Compartment,
  EditorSelection,
  EditorState,
  Prec,
  RangeSetBuilder,
  StateEffect,
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
import { formatNovelMarkdown } from "../../core/text/format";
import {
  OUTLINE_MARKS_PROPERTY,
  parseOutlineMarks,
  serializeOutlineMarks,
  type OutlineMark,
} from "../../core/model/outline-marks";
import { joinVaultPath } from "../../core/model/novel-config";
import {
  classifyLine,
  joinFrontmatterContent,
  splitFrontmatterContent,
} from "../../core/text/paragraphs";
import {
  getOutlineMarks,
  outlineMarksExtension,
  setOutlineMarksEffect,
} from "../../editor/outline-marks";
import { settingKeywordExtension } from "../../editor/setting-keyword-extension";
import {
  nextFootnoteKey,
  parseFootnoteReferences,
  footnoteExtension,
} from "../../editor/footnotes";
import { quoteBlockExtension } from "../../editor/quote-block";
import { TextPromptModal } from "../../ui/text-prompt-modal";
import { confirmAction } from "../../ui/confirm-modal";
import {
  SeamlessController,
  getSeamlessSections,
} from "./seamless-controller";
import {
  PENDING_COLOR_OPTIONS,
  pendingBlockExtension,
  pendingBoundaryKeymap,
  pendingFenceProtection,
  parsePendingBlocks,
  type PendingBlock,
  type PendingColor,
} from "../../editor/pending-block";
import type NovelViewPlugin from "../../main";
import {
  loadFootnoteNotes,
  saveFootnoteNote,
  type ArticleInfoSnapshot,
} from "../article-info/model";
import { countNovelCharacters } from "../../core/text/status";

export const NOVEL_EDITOR_VIEW_TYPE = "novelview-editor";

const sharedSaveChains = new Map<string, Promise<void>>();

/** 从文件路径回退生成章节标题 */
function loadChapterTitleFallback(path: string): string {
  return path.split("/").pop()?.replace(/\.md$/iu, "") ?? "NovelEditor";
}

/** 跨行移动光标并保持目标列 */
function moveCursorOneLine(view: EditorView, direction: -1 | 1): boolean {
  const state = view.state;
  const selection = state.selection.main;
  const startLine = state.doc.lineAt(selection.head);
  const goalColumn = selection.goalColumn
    ?? selection.head - startLine.from;
  const ran = direction < 0 ? cursorLineUp(view) : cursorLineDown(view);
  if (!ran) {
    return false;
  }
  const nextState = view.state;
  const nextSelection = nextState.selection.main;
  const nextLine = nextState.doc.lineAt(nextSelection.head);
  const expected = startLine.number + direction;
  let targetNumber: number | null = null;
  if (direction < 0 && nextLine.number < expected) {
    targetNumber = Math.max(1, startLine.number - 1);
  } else if (direction > 0 && nextLine.number > expected) {
    targetNumber = Math.min(nextState.doc.lines, startLine.number + 1);
  }
  if (targetNumber === null) {
    return true;
  }
  const target = nextState.doc.line(targetNumber);
  view.dispatch({
    selection: EditorSelection.cursor(
      target.from + Math.min(goalColumn, target.length),
    ),
    scrollIntoView: true,
  });
  return true;
}

class EditorImageWidget extends WidgetType {
  /** 初始化图片内嵌展示组件 */
  constructor(
    private readonly src: string,
    private readonly alt: string,
  ) {
    super();
  }

  /** 判断图片组件是否需要复用 */
  override eq(other: EditorImageWidget): boolean {
    return other.src === this.src && other.alt === this.alt;
  }

  /** 创建图片及图注的展示元素 */
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

  /** 声明组件不忽略鼠标编辑事件 */
  override ignoreEvent(): boolean {
    return false;
  }
}

interface EditorImageInfo {
  src: string;
  alt: string;
}

/** 解析图片行并获取资源地址 */
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

/** 扫描全文并生成图片替换装饰 */
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

/** 创建图片预览状态的编辑器扩展 */
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

/** 为可见分隔线生成行装饰 */
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

  /** 初始化分隔线装饰插件 */
  constructor(view: EditorView) {
    this.decorations = buildHrDecorations(view);
  }

  /** 内容或视口变化时重建装饰 */
  update(update: ViewUpdate): void {
    if (update.docChanged || update.viewportChanged) {
      this.decorations = buildHrDecorations(update.view);
    }
  }
}

const hrDecorationExtension = ViewPlugin.fromClass(HrDecorationPlugin, {
  decorations: (plugin) => plugin.decorations,
});


/** 为正文行计算段落样式装饰 */
function buildProseDecorations(view: EditorView): DecorationSet {
  const builder = new RangeSetBuilder<Decoration>();
  const { doc } = view.state;
  const visited = new Set<number>();
  const forcedStarts = new Set<number>();
  for (const section of getSeamlessSections(view.state)) {
    let line = doc.lineAt(Math.min(section.from, doc.length));
    while (
      line.from < section.to
      && !line.text.trim()
      && line.number < doc.lines
    ) {
      line = doc.line(line.number + 1);
    }
    if (line.from < section.to && line.text.trim()) {
      forcedStarts.add(line.number);
    }
  }
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
          if (
            classification.paragraphStart
            || forcedStarts.has(line.number)
          ) {
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

/** 生成当前光标行的装饰 */
function buildImmersiveLineDecorations(view: EditorView): DecorationSet {
  const head = view.state.selection.main.head;
  const line = view.state.doc.lineAt(head);
  return Decoration.set([
    Decoration.line({ class: "novelview-editor-current-line" }).range(line.from),
  ]);
}

class ImmersiveLinePlugin {
  decorations: DecorationSet;

  /** 初始化当前行高亮插件 */
  constructor(view: EditorView) {
    this.decorations = buildImmersiveLineDecorations(view);
  }

  /** 选择或内容变化时刷新高亮 */
  update(update: ViewUpdate): void {
    if (update.selectionSet || update.docChanged) {
      this.decorations = buildImmersiveLineDecorations(update.view);
    }
  }
}

const immersiveLineExtension = ViewPlugin.fromClass(ImmersiveLinePlugin, {
  decorations: (plugin) => plugin.decorations,
});

export interface NovelSearchHighlightRange {
  from: number;
  to: number;
}

const setNovelSearchHighlightsEffect = StateEffect.define<{
  ranges: NovelSearchHighlightRange[];
  active: number;
}>();

const novelSearchHighlightsField = StateField.define<DecorationSet>({
  create: () => Decoration.none,
  /** 同步搜索高亮范围到文档变更 */
  update(value, transaction) {
    let next = value.map(transaction.changes);
    for (const effect of transaction.effects) {
      if (!effect.is(setNovelSearchHighlightsEffect)) {
        continue;
      }
      const builder = new RangeSetBuilder<Decoration>();
      effect.value.ranges.forEach((range, index) => {
        const from = Math.max(0, Math.min(range.from, transaction.state.doc.length));
        const to = Math.max(from, Math.min(range.to, transaction.state.doc.length));
        if (to <= from) {
          return;
        }
        builder.add(
          from,
          to,
          Decoration.mark({
            class: index === effect.value.active
              ? "novelview-search-highlight is-active"
              : "novelview-search-highlight",
          }),
        );
      });
      next = builder.finish();
    }
    return next;
  },
  provide: (field) => EditorView.decorations.from(field),
});

class ProseDecorationPlugin {
  decorations: DecorationSet;

  /** 初始化正文段落装饰插件 */
  constructor(view: EditorView) {
    this.decorations = buildProseDecorations(view);
  }

  /** 内容或视口变化时重算段落 */
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
  private pendingBlocks: PendingBlock[] = [];
  private pendingBlocksTimer: number | null = null;
  private cursorSaveTimer: number | null = null;
  private loadedCursor = false;
  private resizeObserver: ResizeObserver | null = null;
  private resizeFrame: number | null = null;
  private measureTimer: number | null = null;
  private readonly handleWindowResize = (): void => {
    this.scheduleEditorMeasure();
  };
  private readonly handleVisualViewportResize = (): void => {
    const viewport = window.visualViewport;
    if (!viewport) {
      return;
    }
    const keyboardHeight = Math.max(
      0,
      window.innerHeight - viewport.height - viewport.offsetTop,
    );
    const mobile = window.matchMedia("(max-width: 700px)").matches;
    this.contentEl.toggleClass(
      "is-mobile-keyboard",
      mobile && keyboardHeight > 100,
    );
  };
  private saveChain: Promise<void> = Promise.resolve();
  private outlineMarksTimer: number | null = null;
  private immersiveMode = false;
  private readonly seamlessCompartment = new Compartment();
  private readonly seamlessController: SeamlessController;
  private seamlessButton: HTMLButtonElement | null = null;
  private immersiveButton: HTMLButtonElement | null = null;
  private pureButton: HTMLButtonElement | null = null;
  private darkRoomButton: HTMLButtonElement | null = null;
  private pureMode = false;
  private darkRoomMode = false;
  private darkRoomDialogOpen = false;
  private darkRoomTimer: number | null = null;
  private immersiveScrollFrame: number | null = null;
  private immersiveCenterFrame: number | null = null;
  private immersiveProgrammaticScrollTop: number | null = null;
  private immersiveSyncing = false;
  private searchHighlightRanges: NovelSearchHighlightRange[] = [];
  private activeSearchHighlight = -1;

  /** 初始化小说编辑器视图 */
  constructor(leaf: WorkspaceLeaf, plugin: NovelViewPlugin) {
    super(leaf);
    this.plugin = plugin;
    this.navigation = false;
    const neighbors = Number(
      window.localStorage.getItem("novelview:seamless-neighbors"),
    );
    this.seamlessController = new SeamlessController(
      this.app,
      this.plugin,
      this.seamlessCompartment,
      Number.isFinite(neighbors) ? Math.min(3, Math.max(0, neighbors)) : 1,
    );
  }

  /** 返回编辑器视图的类型标识 */
  override getViewType(): string {
    return NOVEL_EDITOR_VIEW_TYPE;
  }

  /** 返回当前章节的显示标题 */
  override getDisplayText(): string {
    if (!this.filePath) {
      return "NovelEditor";
    }
    return this.filePath.split("/").pop()?.replace(/\.md$/iu, "")
      ?? "NovelEditor";
  }

  /** 返回编辑器标签页图标 */
  override getIcon(): string {
    return "book-open";
  }

  /** 获取当前打开的章节文件 */
  getNovelEditorFile(): TFile | null {
    if (!this.filePath) {
      return null;
    }
    const file = this.app.vault.getAbstractFileByPath(this.filePath);
    return file instanceof TFile ? file : null;
  }

  /** 导出视图的文件路径状态 */
  override getState(): Record<string, unknown> {
    return { file: this.filePath };
  }

  /** 恢复文件路径并重新加载内容 */
  override async setState(
    state: Record<string, unknown>,
    result: import("obsidian").ViewStateResult,
  ): Promise<void> {
    const nextFile = typeof state.file === "string" ? state.file : this.filePath;
    if (nextFile !== this.filePath) {
      await this.flushSave();
      if (!this.seamlessController.enabled) {
        await this.flushOutlineMarks();
      }
    }
    this.filePath = nextFile;
    this.pendingLine = typeof state.line === "number" ? state.line : 1;
    result.history = true;
    await super.setState(state, result);
    if (this.seamlessController.enabled) {
      await this.seamlessController.jumpToPath(nextFile);
      this.updateTabTitle();
      return;
    }
    await this.loadFile();
  }

  /** 构建界面并初始化编辑器 */
  protected override async onOpen(): Promise<void> {
    this.containerEl.addClass("novelview-editor-leaf");
    this.contentEl.empty();
    this.contentEl.addClass("novelview-editor-view");
    this.contentEl.setCssProps({
      "--novelview-font-size": `${Number(this.plugin.settings.fontSize) || 16}px`,
      "--novelview-line-height": `${Number(this.plugin.settings.lineHeight) || 1.8}`,
      "--novelview-paragraph-spacing": `${Number(this.plugin.settings.paragraphSpacing) || 0.65}em`,
      "--novelview-first-line-indent": `${Number(this.plugin.settings.firstLineIndent) || 2}em`,
    });
    this.applySettings();
    this.applyPageSettings();
    window.visualViewport?.addEventListener("resize", this.handleVisualViewportResize);
    window.visualViewport?.addEventListener("scroll", this.handleVisualViewportResize);
    window.addEventListener("orientationchange", this.handleVisualViewportResize);
    this.handleVisualViewportResize();
    const toolbar = this.contentEl.createDiv({ cls: "novelview-editor-toolbar" });
    this.addToolbarButton(toolbar, "wand-2", "自动排版", () => this.autoFormat());
    this.addToolbarButton(toolbar, "search", "查找替换", () => {
      this.plugin.openAdvancedSearch();
    });
    this.addToolbarButton(toolbar, "image-plus", "插入图片", () => {
      void this.insertImage();
    });
    const settingsButton = this.addToolbarButton(
      toolbar,
      "settings-2",
      "格式设置",
      () => {
        this.plugin.openModeSettings(settingsButton);
      },
    );
    const modeBar = this.contentEl.createDiv({
      cls: "novelview-editor-mode-bar",
    });
    this.immersiveButton = this.addToolbarButton(
      modeBar,
      "focus",
      "打字模式",
      () => this.setImmersiveMode(!this.immersiveMode),
    );
    this.immersiveButton.toggleClass("is-active", this.immersiveMode);
    this.immersiveButton.setAttr("aria-pressed", String(this.immersiveMode));
    this.pureButton = this.addToolbarButton(
      modeBar,
      "scan",
      "纯粹模式：只显示主编辑区",
      () => this.togglePureMode(),
    );
    this.darkRoomButton = this.addToolbarButton(
      modeBar,
      "moon",
      "黑屋模式：限时全屏写作",
      () => {
        void this.toggleDarkRoomMode();
      },
    );
    this.seamlessButton = this.addToolbarButton(
      modeBar,
      "layers",
      "无缝模式：连续加载前后章节",
      () => {
        void this.toggleSeamlessMode();
      },
    );
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
        "aria-label": "编辑对照组",
        title: "编辑对照组",
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
      text: "对照组标题",
    });
    this.pendingInput = this.pendingPanel.createEl("input", {
      cls: "novelview-pending-panel-input",
      attr: { type: "text", placeholder: "对照组" },
    });
    this.pendingTitleError = this.pendingPanel.createDiv({
      cls: "novelview-pending-panel-error",
    });
    this.pendingInput.addEventListener("input", () => {
      const title = (this.pendingInput?.value.trim() || "对照组");
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
      const footnote = (event.target as HTMLElement | null)?.closest<HTMLElement>(
        ".novelview-footnote-ref",
      );
      if (footnote) {
        event.preventDefault();
        event.stopPropagation();
        const key = footnote.dataset.footnoteKey ?? "";
        if (key) {
          void this.plugin.focusArticleInfoFootnote(this.filePath, key);
        }
        return;
      }
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
    this.registerEvent(this.app.workspace.on("active-leaf-change", (leaf) => {
      if (this.darkRoomMode && leaf && leaf !== this.leaf) {
        void this.app.workspace.revealLeaf(this.leaf);
      }
    }));
    if (this.filePath) {
      await this.loadFile();
    }
  }

  /** 关闭视图前保存并清理资源 */
  protected override async onClose(): Promise<void> {
    if (this.cursorSaveTimer !== null) {
      window.clearTimeout(this.cursorSaveTimer);
      this.cursorSaveTimer = null;
    }
    this.saveCursor();
    const seamlessWasEnabled = this.seamlessController.enabled;
    if (seamlessWasEnabled) {
      await this.seamlessController.disable();
    } else {
      await this.flushSave();
    }
    if (!seamlessWasEnabled) {
      await this.flushOutlineMarks();
    }
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
    this.seamlessButton = null;
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
    if (this.pendingBlocksTimer !== null) {
      window.clearTimeout(this.pendingBlocksTimer);
      this.pendingBlocksTimer = null;
    }
    this.stopDarkRoom();
    if (this.pureMode) {
      this.pureMode = false;
      activeDocument.body.removeClass("novelview-pure-mode");
    }
    window.visualViewport?.removeEventListener("resize", this.handleVisualViewportResize);
    window.visualViewport?.removeEventListener("scroll", this.handleVisualViewportResize);
    window.removeEventListener("orientationchange", this.handleVisualViewportResize);
    this.disconnectResizeObserver();
    this.clearImmersiveScrollFrame();
    this.clearImmersiveCenterFrame();
    this.editorView?.destroy();
    this.editorView = null;
    this.editorHost = null;
    this.chapterTitleEl = null;
    this.contentEl.empty();
  }

  /** 切换只显示编辑区的纯粹模式 */
  private togglePureMode(): void {
    this.pureMode = !this.pureMode;
    activeDocument.body.toggleClass("novelview-pure-mode", this.pureMode);
    this.pureButton?.toggleClass("is-active", this.pureMode);
    this.pureButton?.setAttr("aria-pressed", String(this.pureMode));
  }

  /** 进入或退出限时黑屋模式 */
  private async toggleDarkRoomMode(): Promise<void> {
    if (this.darkRoomDialogOpen) {
      return;
    }
    if (this.darkRoomMode) {
      this.darkRoomDialogOpen = true;
      try {
        const confirmed = await confirmAction(
          this.app,
          "退出黑屋模式",
          "确定要退出黑屋模式吗？",
          "退出",
        );
        if (confirmed) {
          this.stopDarkRoom();
        }
      } finally {
        this.darkRoomDialogOpen = false;
      }
      return;
    }
    this.darkRoomDialogOpen = true;
    new TextPromptModal(this.app, {
      title: "黑屋模式",
      description: "输入时长（分钟）。开始后会进入全屏，并在倒计时结束前阻止切换 Obsidian 页面。",
      initialValue: "25",
      placeholder: "25",
      submitLabel: "开始",
      onClose: () => {
        this.darkRoomDialogOpen = false;
      },
      onSubmit: (value) => {
        const minutes = Math.min(480, Math.max(1, Number(value) || 25));
        this.startDarkRoom(minutes);
      },
    }).open();
  }

  /** 启动全屏倒计时并锁定页面 */
  private startDarkRoom(minutes: number): void {
    this.stopDarkRoom();
    this.darkRoomMode = true;
    this.darkRoomButton?.addClass("is-active");
    this.darkRoomButton?.setAttr("aria-pressed", "true");
    activeDocument.body.addClass("novelview-dark-room");
    const requestFullscreen = activeDocument.documentElement.requestFullscreen;
    if (requestFullscreen) {
      void requestFullscreen.call(activeDocument.documentElement).catch(() => {
        // 全屏不可用时仍保留黑屋遮罩与倒计时。
      });
    }
    const end = Date.now() + minutes * 60_000;
    const tick = (): void => {
      const remaining = Math.max(0, end - Date.now());
      if (this.darkRoomButton) {
        const text = `${Math.ceil(remaining / 60_000)} 分钟`;
        this.darkRoomButton.setAttr("title", `黑屋模式剩余 ${text}`);
      }
      if (remaining <= 0) {
        this.stopDarkRoom();
        new Notice("Novel View：黑屋模式结束。");
      }
    };
    tick();
    this.darkRoomTimer = window.setInterval(tick, 1_000);
    new Notice(`Novel View：黑屋模式开始，持续 ${minutes} 分钟。`);
  }

  /** 停止倒计时并退出全屏状态 */
  private stopDarkRoom(): void {
    this.darkRoomMode = false;
    this.darkRoomDialogOpen = false;
    this.darkRoomButton?.removeClass("is-active");
    this.darkRoomButton?.setAttr("aria-pressed", "false");
    this.darkRoomButton?.setAttr("title", "黑屋模式：限时全屏写作");
    activeDocument.body.removeClass("novelview-dark-room");
    if (this.darkRoomTimer !== null) {
      window.clearInterval(this.darkRoomTimer);
      this.darkRoomTimer = null;
    }
    if (activeDocument.fullscreenElement) {
      void activeDocument.exitFullscreen().catch(() => {});
    }
  }

  /** 汇总文章字数标记等信息 */
  getArticleInfo(): ArticleInfoSnapshot | null {
    const view = this.editorView;
    if (!view || !this.filePath) {
      return null;
    }
    const center = this.seamlessController.enabled
      ? this.seamlessController.getCenterSection()
      : null;
    const filePath = center?.path ?? this.filePath;
    const body = center?.body ?? view.state.doc.toString();
    const marks = getOutlineMarks(view.state).map((mark) => ({
      label: mark.label,
      start: mark.start,
      end: mark.end,
      line: view.state.doc.lineAt(mark.start).number,
    }));
    const pending = parsePendingBlocks(view.state).map((block) => ({
      title: block.title,
      from: block.openFrom,
      to: block.closeTo,
      line: block.openLine,
    }));
    const notes = loadFootnoteNotes(filePath);
    const footnoteMap = new Map<string, {
      key: string;
      text: string;
      line: number;
    }>();
    for (const reference of parseFootnoteReferences(body)) {
      if (!footnoteMap.has(reference.key)) {
        footnoteMap.set(reference.key, {
          key: reference.key,
          text: notes[reference.key] ?? "",
          line: reference.line,
        });
      }
    }
    return {
      filePath,
      title: loadChapterTitleFallback(filePath),
      summary: "",
      wordCount: countNovelCharacters(body),
      marks,
      pending,
      footnotes: [...footnoteMap.values()],
    };
  }

  /** 返回黑屋模式是否开启 */
  isDarkRoomActive(): boolean {
    return this.darkRoomMode;
  }

  /** 刷新工作区标签页标题 */
  private updateTabTitle(): void {
    const tab = this.containerEl.closest(".workspace-tab");
    const title = tab?.querySelector<HTMLElement>(
      ".workspace-tab-header-inner-title",
    );
    if (title) {
      title.setText(this.getDisplayText());
    }
  }

  /** 开启或关闭跨章节无缝模式 */
  private async toggleSeamlessMode(): Promise<void> {
    if (this.seamlessController.enabled) {
      const path = await this.seamlessController.disable();
      this.contentEl.removeClass("is-seamless-mode");
      this.seamlessButton?.removeClass("is-active");
      if (path) {
        this.filePath = path;
      }
      await this.loadFile();
      return;
    }
    if (!this.editorView || !this.filePath) {
      return;
    }
    await this.flushSave();
    await this.flushOutlineMarks();
    const cursor = this.editorView.state.selection.main.head;
    await this.seamlessController.enable(
      this.editorView,
      this.filePath,
      cursor,
    );
    this.contentEl.addClass("is-seamless-mode");
    this.seamlessButton?.addClass("is-active");
  }

  /** 应用页宽模式与每行字数 */
  applyPageSettings(): void {
    const mode = window.localStorage.getItem("novelview:page-margin-mode")
      === "manual"
      ? "manual"
      : "auto";
    const chars = Math.min(
      80,
      Math.max(
        24,
        Number(window.localStorage.getItem("novelview:page-chars")) || 42,
      ),
    );
    this.contentEl.toggleClass("has-manual-page-width", mode === "manual");
    this.contentEl.setCssProps({
      "--novelview-page-chars": String(chars),
    });
  }

  /** 激活时同步文件并读取磁盘 */
  activate(): void {
    this.updateTabTitle();
    const file = this.app.vault.getAbstractFileByPath(this.filePath);
    if (file instanceof TFile) {
      this.plugin.setNovelEditorFile(file);
      void this.syncFromDisk();
    }
  }

  /** 写入搜索高亮范围列表 */
  setSearchHighlights(ranges: NovelSearchHighlightRange[]): void {
    this.searchHighlightRanges = ranges
      .map((range) => ({
        from: Math.max(0, range.from),
        to: Math.max(range.from, range.to),
      }))
      .filter((range) => range.to > range.from)
      .sort((left, right) => left.from - right.from);
    this.activeSearchHighlight = -1;
    this.applySearchHighlights();
  }

  /** 滚动编辑器对齐高亮锚点 */
  alignSearchHighlightTo(anchorY: number): void {
    const view = this.editorView;
    if (!view) {
      return;
    }
    const start = view.state.selection.main.head;
    const caret = view.coordsAtPos(start);
    if (!caret) {
      return;
    }
    view.scrollDOM.scrollTop = Math.max(
      0,
      view.scrollDOM.scrollTop + caret.top - anchorY,
    );
  }

  /** 清空全部搜索高亮范围 */
  clearSearchHighlights(): void {
    this.searchHighlightRanges = [];
    this.activeSearchHighlight = -1;
    this.applySearchHighlights();
  }

  /** 转发到 showSearchHighlight */
  revealSearchHighlight(from: number, to: number): void {
    this.showSearchHighlight(from, to, true, true);
  }

  /** 展示单个搜索命中并定位 */
  showSearchHighlight(
    from: number,
    to: number,
    scroll = true,
    focus = true,
    anchorY?: number,
  ): void {
    const view = this.editorView;
    if (!view) {
      return;
    }
    const start = Math.max(0, Math.min(from, view.state.doc.length));
    const end = Math.max(start, Math.min(to, view.state.doc.length));
    this.searchHighlightRanges = [{ from: start, to: end }];
    this.activeSearchHighlight = 0;
    this.applySearchHighlights();
    view.dispatch({
      selection: EditorSelection.cursor(start),
      effects: scroll && anchorY === undefined
        ? EditorView.scrollIntoView(start, { y: "center" })
        : [],
    });
    if (focus) {
      view.focus();
    }
    if (scroll && anchorY !== undefined) {
      window.requestAnimationFrame(() => {
        if (this.editorView !== view) {
          return;
        }
        const caret = view.coordsAtPos(start);
        if (!caret) {
          return;
        }
        view.scrollDOM.scrollTop = Math.max(
          0,
          view.scrollDOM.scrollTop + caret.top - anchorY,
        );
      });
    }
  }

  /** 派发搜索高亮状态效果 */
  private applySearchHighlights(): void {
    this.editorView?.dispatch({
      effects: setNovelSearchHighlightsEffect.of({
        ranges: this.searchHighlightRanges,
        active: this.activeSearchHighlight,
      }),
    });
  }

  /** 判断编辑器实例是否就绪 */
  isEditorReady(): boolean {
    return this.editorView !== null;
  }

  /** 获取编辑区滚动视口尺寸 */
  getScrollViewportRect(): DOMRect | null {
    return this.editorView?.scrollDOM.getBoundingClientRect() ?? null;
  }

  /** 读取编辑器中的当前全文 */
  getEditorText(): string {
    return this.editorView?.state.doc.toString() ?? "";
  }

  /** 应用字体行高等显示设置 */
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

  /** 生成带图标的工具按钮 */
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

  /** 读取章节内容并重建编辑器 */
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
    this.searchHighlightRanges = [];
    this.activeSearchHighlight = -1;
    this.disconnectResizeObserver();
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
            this.seamlessCompartment.of([]),
            history(),
            drawSelection(),
            Prec.highest(keymap.of([
              {
                key: "ArrowUp",
                run: (view) => moveCursorOneLine(view, -1),
              },
              {
                key: "ArrowDown",
                run: (view) => moveCursorOneLine(view, 1),
              },
            ])),
            keymap.of([...defaultKeymap, ...historyKeymap]),
            EditorView.lineWrapping,
            EditorView.updateListener.of((update) => {
              if (this.seamlessController.enabled && update.docChanged) {
                this.seamlessController.handleDocChanged();
              }
              if (update.docChanged) {
                this.schedulePendingBlocksRefresh();
              }
              if (update.docChanged && !this.loading) {
                this.scheduleSave();
                this.scheduleOutlineMarksSave();
                this.scheduleTocRefresh();
              }
              if (update.docChanged || update.selectionSet) {
                this.updatePendingUi();
              }
              if (update.selectionSet && !this.loading) {
                this.scheduleCursorSave();
              }
              if (
                this.immersiveMode
                && !this.immersiveSyncing
                && !this.seamlessController.isMutating
                && (update.docChanged || update.selectionSet)
              ) {
                this.scheduleImmersiveCenter();
              }
            }),
            immersiveLineExtension,
            novelSearchHighlightsField,
            settingKeywordExtension,
            footnoteExtension,
            quoteBlockExtension,
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
      this.pendingBlocks = parsePendingBlocks(this.editorView.state);
      this.editorView.dispatch({
        effects: setOutlineMarksEffect.of(outlineMarks),
      });
      this.observeEditorResize();
      const savedCursor = this.readSavedCursor();
      if (this.pendingLine > 1 || savedCursor === null) {
        const lineNumber = Math.min(
          Math.max(1, this.pendingLine),
          this.editorView.state.doc.lines,
        );
        const line = this.editorView.state.doc.line(lineNumber);
        this.editorView.dispatch({
          selection: { anchor: line.from },
          effects: EditorView.scrollIntoView(line.from, { y: "center" }),
        });
      } else {
        const at = Math.min(savedCursor, this.editorView.state.doc.length);
        this.editorView.dispatch({
          selection: { anchor: at },
          effects: EditorView.scrollIntoView(at, { y: "center" }),
        });
      }
      this.loadedCursor = true;
      this.lastSavedBody = body;
      this.editorView.scrollDOM.addEventListener("scroll", () => {
        this.updateTocVisibility();
        this.updatePendingUi();
        this.handleImmersiveScroll();
      });
      this.applyImmersiveLayout();
      if (this.immersiveMode) {
        this.setImmersiveMode(true);
      }
      this.editorView.focus();
      this.plugin.setNovelEditorFile(file);
      void this.plugin.refreshSettingKeywordIndex();
      this.containerEl.querySelector<HTMLElement>(".view-header-title")
        ?.setText(this.getDisplayText());
      this.chapterTitleEl?.setText(this.getDisplayText());
      this.updateTabTitle();
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

  /** 生成光标位置的存储键名 */
  private cursorStorageKey(): string {
    return `novelview:cursor:${this.filePath}`;
  }

  /** 读取上次保存的光标位置 */
  private readSavedCursor(): number | null {
    try {
      const value = Number(window.localStorage.getItem(this.cursorStorageKey()));
      return Number.isFinite(value) && value >= 0 ? value : null;
    } catch {
      return null;
    }
  }

  /** 延迟保存当前光标位置 */
  private scheduleCursorSave(): void {
    if (!this.loadedCursor) {
      return;
    }
    if (this.cursorSaveTimer !== null) {
      window.clearTimeout(this.cursorSaveTimer);
    }
    this.cursorSaveTimer = window.setTimeout(() => {
      this.cursorSaveTimer = null;
      this.saveCursor();
    }, 180);
  }

  /** 把光标位置写入本地存储 */
  private saveCursor(): void {
    if (!this.editorView || !this.filePath) {
      return;
    }
    try {
      window.localStorage.setItem(
        this.cursorStorageKey(),
        String(this.editorView.state.selection.main.head),
      );
    } catch {
      // 本地存储不可用时忽略。
    }
  }

  /** 把选中内容转换为引用块 */
  private wrapSelectionInQuote(): void {
    if (!this.editorView) {
      return;
    }
    const view = this.editorView;
    const selection = view.state.selection.main;
    if (selection.empty) {
      const head = selection.head;
      view.dispatch({
        changes: { from: head, insert: "> " },
        selection: { anchor: head + 2 },
      });
      view.focus();
      return;
    }
    const doc = view.state.doc;
    const start = doc.lineAt(selection.from);
    const end = doc.lineAt(selection.to);
    const lines: string[] = [];
    for (let lineNumber = start.number; lineNumber <= end.number; lineNumber += 1) {
      const line = doc.line(lineNumber);
      lines.push(line.text.startsWith(">") ? line.text : `> ${line.text}`);
    }
    const replacement = lines.join("\n");
    view.dispatch({
      changes: { from: start.from, to: end.to, insert: replacement },
      selection: { anchor: start.from + replacement.length },
    });
    view.focus();
  }

  /** 插入新脚注引用并定位 */
  private insertFootnote(): void {
    if (!this.editorView || !this.filePath) {
      return;
    }
    const view = this.editorView;
    const key = nextFootnoteKey(view.state.doc.toString());
    const head = view.state.selection.main.head;
    const reference = `[^${key}]`;
    const filePath = this.filePath;
    saveFootnoteNote(filePath, key, "");
    view.dispatch({
      changes: { from: head, insert: reference },
      selection: { anchor: head + reference.length },
    });
    view.focus();
    void this.plugin.focusArticleInfoFootnote(filePath, key);
  }

  /** 为选中文字添加高亮标记 */
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
    const overlap = getOutlineMarks(this.editorView.state).find((mark) => (
      from < mark.end && to > mark.start
    ));
    if (overlap) {
      new Notice("Novel View：该范围与已有文字标记重叠，不能重复标记。");
      return;
    }
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

  /** 查找选区覆盖的标记范围 */
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

  /** 移除选区命中的文字标记 */
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

  /** 延迟将标记写入章节属性 */
  private scheduleOutlineMarksSave(): void {
    if (this.seamlessController.enabled) {
      return;
    }
    if (this.outlineMarksTimer !== null) {
      window.clearTimeout(this.outlineMarksTimer);
    }
    this.outlineMarksTimer = window.setTimeout(() => {
      this.outlineMarksTimer = null;
      void this.flushOutlineMarks();
    }, 700);
  }

  /** 立即把标记写入文件属性 */
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
    const state = this.editorView.state;
    const allMarks = getOutlineMarks(state);
    const marks = allMarks.filter((mark) => (
      mark.end > mark.start
      && Boolean(state.doc.sliceString(mark.start, mark.end).trim())
    ));
    if (marks.length !== allMarks.length) {
      this.editorView.dispatch({
        effects: setOutlineMarksEffect.of(marks),
      });
    }
    try {
      await this.app.fileManager.processFrontMatter(file, (
        frontmatter: Record<string, unknown>,
      ) => {
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

  /** 按标题输入重命名章节文件 */
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

  /** 监听编辑区域尺寸变化 */
  private observeEditorResize(): void {
    if (!this.editorHost) {
      return;
    }
    this.resizeObserver = new ResizeObserver(() => {
      this.scheduleEditorMeasure();
    });
    this.resizeObserver.observe(this.editorHost);
    if (this.editorView) {
      this.resizeObserver.observe(this.editorView.scrollDOM);
    }
    window.addEventListener("resize", this.handleWindowResize);
    window.addEventListener("orientationchange", this.handleWindowResize);
    window.visualViewport?.addEventListener("resize", this.handleWindowResize);
  }

  /** 退出当前沉浸式打字模式 */
  exitImmersiveMode(): void {
    if (this.immersiveMode) {
      this.setImmersiveMode(false);
    }
  }

  /** 开启或关闭沉浸打字模式 */
  private setImmersiveMode(enabled: boolean): void {
    if (enabled && this.plugin.isNovelFinderOpen()) {
      new Notice("Novel View：NovelFinder 打开时无法进入打字模式。");
      return;
    }
    const restore = !enabled && this.editorView
      ? {
        head: this.editorView.state.selection.main.head,
        before: this.editorView.coordsAtPos(
          this.editorView.state.selection.main.head,
        ),
      }
      : null;
    this.immersiveMode = enabled;
    this.contentEl.toggleClass("is-immersive", enabled);
    this.immersiveButton?.toggleClass("is-active", enabled);
    this.immersiveButton?.setAttr("aria-pressed", String(enabled));
    this.applyImmersiveLayout();
    this.scheduleEditorMeasure();
    if (enabled) {
      this.scheduleImmersiveCenter();
      this.editorView?.focus();
    } else {
      this.clearImmersiveScrollFrame();
      this.clearImmersiveCenterFrame();
      this.immersiveProgrammaticScrollTop = null;
      const view = this.editorView;
      if (view && restore) {
        this.scheduleEditorMeasure();
        window.requestAnimationFrame(() => {
          const after = view.coordsAtPos(restore.head);
          if (restore.before && after) {
            view.scrollDOM.scrollTop += after.top - restore.before.top;
          }
        });
      }
    }
  }

  /** 应用沉浸模式上下留白 */
  private applyImmersiveLayout(): void {
    const view = this.editorView;
    if (!view) {
      return;
    }
    if (!this.immersiveMode) {
      this.setImmersivePadding(null);
      return;
    }
    const pad = Math.max(80, Math.ceil(view.scrollDOM.clientHeight / 2));
    this.setImmersivePadding(pad);
    this.scheduleEditorMeasure();
  }

  /** 延迟把光标滚动到中央 */
  private scheduleImmersiveCenter(): void {
    if (
      !this.immersiveMode
      || this.seamlessController.isMutating
      || this.immersiveCenterFrame !== null
    ) {
      return;
    }
    this.immersiveCenterFrame = window.requestAnimationFrame(() => {
      this.immersiveCenterFrame = null;
      this.centerImmersiveCursor();
    });
  }

  /** 将光标所在行滚动到中央 */
  private centerImmersiveCursor(): void {
    const view = this.editorView;
    if (
      !this.immersiveMode
      || this.seamlessController.isMutating
      || !view
    ) {
      return;
    }
    const head = view.state.selection.main.head;
    const caret = view.coordsAtPos(head);
    if (!caret) {
      return;
    }
    const scroller = view.scrollDOM;
    const rect = scroller.getBoundingClientRect();
    const target = scroller.scrollTop
      + (caret.top + caret.bottom) / 2
      - (rect.top + rect.height / 2);
    if (Math.abs(scroller.scrollTop - target) > 2) {
      const next = Math.max(0, target);
      this.immersiveProgrammaticScrollTop = next;
      scroller.scrollTop = next;
    }
  }

  /** 滚动时安排光标居中同步 */
  private handleImmersiveScroll(): void {
    if (
      !this.immersiveMode
      || this.seamlessController.isMutating
      || !this.editorView
    ) {
      return;
    }
    if (this.immersiveProgrammaticScrollTop !== null) {
      const current = this.editorView.scrollDOM.scrollTop;
      if (Math.abs(current - this.immersiveProgrammaticScrollTop) <= 2) {
        this.immersiveProgrammaticScrollTop = null;
        return;
      }
      this.immersiveProgrammaticScrollTop = null;
    }
    if (this.immersiveScrollFrame !== null) {
      return;
    }
    this.immersiveScrollFrame = window.requestAnimationFrame(() => {
      this.immersiveScrollFrame = null;
      this.syncCursorToImmersiveCenter();
    });
  }

  /** 按视口中心反向移动光标 */
  private syncCursorToImmersiveCenter(): void {
    const view = this.editorView;
    if (
      !this.immersiveMode
      || this.seamlessController.isMutating
      || !view
    ) {
      return;
    }
    const scroller = view.scrollDOM;
    const rect = scroller.getBoundingClientRect();
    const pos = view.posAtCoords({
      x: rect.left + rect.width / 2,
      y: rect.top + rect.height / 2,
    });
    if (pos === null) {
      return;
    }
    const selection = view.state.selection.main;
    if (pos === selection.head) {
      return;
    }
    this.immersiveSyncing = true;
    try {
      view.dispatch({
        selection: { anchor: pos },
      });
    } finally {
      this.immersiveSyncing = false;
    }
    this.centerImmersiveCursor();
  }

  /** 取消待执行的滚动同步帧 */
  private clearImmersiveScrollFrame(): void {
    if (this.immersiveScrollFrame !== null) {
      window.cancelAnimationFrame(this.immersiveScrollFrame);
      this.immersiveScrollFrame = null;
    }
  }

  /** 取消待执行的居中滚动帧 */
  private clearImmersiveCenterFrame(): void {
    if (this.immersiveCenterFrame !== null) {
      window.cancelAnimationFrame(this.immersiveCenterFrame);
      this.immersiveCenterFrame = null;
    }
  }

  /** 设置编辑区上下留白高度 */
  private setImmersivePadding(pad: number | null): void {
    const content = this.editorView?.contentDOM;
    if (!content) {
      return;
    }
    content.setCssStyles({
      paddingTop: pad === null ? "" : `${pad}px`,
      paddingBottom: pad === null ? "" : `${pad}px`,
    });
  }

  /** 安排编辑器重新测量布局 */
  private scheduleEditorMeasure(): void {
    if (this.immersiveMode) {
      const pad = Math.max(80, Math.ceil(
        (this.editorView?.scrollDOM.clientHeight ?? 0) / 2,
      ));
      this.setImmersivePadding(pad);
    }
    this.editorView?.requestMeasure();
    if (this.resizeFrame !== null) {
      window.cancelAnimationFrame(this.resizeFrame);
    }
    this.resizeFrame = window.requestAnimationFrame(() => {
      this.resizeFrame = null;
      this.editorView?.requestMeasure();
    });
    if (this.measureTimer !== null) {
      window.clearTimeout(this.measureTimer);
    }
    this.measureTimer = window.setTimeout(() => {
      this.measureTimer = null;
      this.editorView?.requestMeasure();
      if (this.immersiveMode) {
        this.scheduleImmersiveCenter();
      }
    }, 120);
  }

  /** 移除尺寸与窗口事件监听 */
  private disconnectResizeObserver(): void {
    this.resizeObserver?.disconnect();
    this.resizeObserver = null;
    window.removeEventListener("resize", this.handleWindowResize);
    window.removeEventListener("orientationchange", this.handleWindowResize);
    window.visualViewport?.removeEventListener("resize", this.handleWindowResize);
    if (this.resizeFrame !== null) {
      window.cancelAnimationFrame(this.resizeFrame);
      this.resizeFrame = null;
    }
    if (this.measureTimer !== null) {
      window.clearTimeout(this.measureTimer);
      this.measureTimer = null;
    }
  }

  /** 延迟刷新章节大纲列表 */
  private scheduleTocRefresh(): void {
    if (this.tocTimer !== null) {
      window.clearTimeout(this.tocTimer);
    }
    this.tocTimer = window.setTimeout(() => {
      this.tocTimer = null;
      this.renderToc();
    }, 120);
  }

  /** 解析正文并渲染大纲列表 */
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

  /** 按悬停状态切换大纲显隐 */
  private updateTocVisibility(): void {
    if (!this.tocEl || !this.editorView) {
      return;
    }
    this.tocEl.toggleClass("is-expanded", this.tocHovered);
    this.tocEl.toggleClass("is-collapsed", !this.tocHovered);
  }

  /** 选择本地图片并插入引用 */
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

  /** 取消对照组面板的隐藏计时 */
  private cancelPendingPanelHide(): void {
    if (this.pendingHideTimer !== null) {
      window.clearTimeout(this.pendingHideTimer);
      this.pendingHideTimer = null;
    }
  }

  /** 悬停结束后延迟收起面板 */
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

  /** 延迟重新解析对照组代码块 */
  private schedulePendingBlocksRefresh(): void {
    if (this.pendingBlocksTimer !== null) {
      window.clearTimeout(this.pendingBlocksTimer);
    }
    this.pendingBlocksTimer = window.setTimeout(() => {
      this.pendingBlocksTimer = null;
      if (!this.editorView) {
        return;
      }
      this.pendingBlocks = parsePendingBlocks(this.editorView.state);
      this.updatePendingUi();
    }, 120);
  }

  /** 查找光标所在的对照区块 */
  private pendingBlockAt(position: number): PendingBlock | null {
    if (!this.editorView || this.pendingBlocks.length === 0) {
      return null;
    }
    const doc = this.editorView.state.doc;
    for (const block of this.pendingBlocks) {
      const first = block.contentStartLine <= doc.lines
        ? doc.line(block.contentStartLine).from
        : block.openTo;
      const last = block.contentEndLine >= block.contentStartLine
        && block.contentEndLine <= doc.lines
        ? doc.line(block.contentEndLine).to
        : block.openTo;
      if (position >= first && position <= last) {
        return block;
      }
    }
    return null;
  }

  /** 更新对照组按钮与面板状态 */
  private updatePendingUi(): void {
    if (!this.editorView || !this.pendingButton || !this.pendingPanel) {
      return;
    }
    const selection = this.editorView.state.selection.main;
    const block = this.pendingBlockAt(selection.head);
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

  /** 打开当前对照组的编辑面板 */
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

  /** 修改当前对照组的标题或颜色 */
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
    const suffix = title && title !== "对照组" ? ` ${title}` : "";
    const line = `\`\`\`对照组${emoji}${suffix}`;
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

  /** 删除当前对照组的围栏标记 */
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

  /** 检查对照组标题是否重复 */
  private isPendingTitleDuplicate(title: string): boolean {
    if (!this.editorView) {
      return false;
    }
    const value = title.trim() || "对照组";
    const current = this.activePending?.openFrom;
    return parsePendingBlocks(this.editorView.state).some((block) => (
      block.openFrom !== current && block.title === value
    ));
  }

  /** 判断选区是否覆盖对照区块 */
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

  /** 为选区弹出编辑上下文菜单 */
  private openSelectionContextMenu(event: MouseEvent): void {
    if (!this.editorView) {
      return;
    }
    const selection = this.editorView.state.selection.main;
    const marks = this.outlineMarksAtSelection();
    if (this.selectionOverlapsPending() && marks.length === 0) {
      return;
    }
    const menu = new Menu();
    if (!selection.empty) {
      menu.addItem((item) => {
        item
          .setTitle("插入引用块")
          .setIcon("quote")
          .onClick(() => this.wrapSelectionInQuote());
      });
    }
    if (!selection.empty || !this.selectionOverlapsPending()) {
      menu.addItem((item) => {
        item
          .setTitle("插入脚注")
          .setIcon("superscript")
          .onClick(() => this.insertFootnote());
      });
    }
    if (!selection.empty && !this.selectionOverlapsPending()) {
      menu.addItem((item) => {
        item
          .setTitle("转换成对照组")
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

  /** 生成不重复的对照组标题 */
  private uniquePendingTitle(): string {
    if (!this.editorView) {
      return "对照组";
    }
    const used = new Set(
      parsePendingBlocks(this.editorView.state).map((block) => block.title),
    );
    if (!used.has("对照组")) {
      return "对照组";
    }
    let index = 2;
    while (used.has(`对照组 ${index}`)) {
      index += 1;
    }
    return `对照组 ${index}`;
  }

  /** 把选中文本包进对照区块 */
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
    const info = title === "对照组"
      ? "```对照组🟢"
      : `\`\`\`对照组🟢 ${title}`;
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

  /** 格式化全文并安排保存 */
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

  /** 延迟保存编辑中的正文 */
  private scheduleSave(): void {
    if (this.loading) {
      return;
    }
    if (this.seamlessController.enabled) {
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

  /** 立即把正文写回章节文件 */
  private async flushSave(): Promise<void> {
    if (this.seamlessController.enabled) {
      await this.seamlessController.flush();
      return;
    }
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

  /** 把磁盘内容同步回编辑器 */
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
