import * as fs from "node:fs";
import * as path from "node:path";
import {
  MarkdownView,
  Menu,
  Notice,
  TFile,
  TFolder,
  type WorkspaceLeaf,
} from "obsidian";
import LegacyNovelViewPlugin from "./legacy-main.cjs";
import {
  ARTICLE_LIST_VIEW_TYPE,
  ARTICLE_MIME,
  ARTICLES_MIME,
  NovelArticleListView,
  type ArticleListTarget,
} from "./article-list-view";
import {
  CHAPTER_STATUS_LABELS,
  CHAPTER_STATUS_PROPERTY,
  readChapterStatus,
  type ChapterStatus,
} from "./core/chapter-status";
import {
  SETTING_COLLECTION_INDEX,
  parseSettingCollectionIndex,
  serializeSettingCollectionIndex,
  getSettingKeywordEntries,
  settingGroupFolderName,
  type SettingCollectionIndex,
} from "./core/setting-collection";
import { countNovelCharacters } from "./core/status";
import { findFrontmatterEnd } from "./core/paragraphs";
import { formatNovelMarkdown } from "./core/format";
import {
  formatNovelTxt,
  parseNovelTxt,
  type TxtExportChapter,
} from "./core/txt";
import {
  createNovelConfigContent,
  getNovelConfigPath,
  isNovelConfigFile,
  joinVaultPath,
  pruneNovelHistory,
  LEGACY_NOVEL_SETTING_FILENAME,
  normalizeCoverPath,
  parseNovelConfig,
  serializeNovelConfig,
  type NovelArticleGroup,
  type NovelConfig,
  type NovelGroupInfo,
} from "./core/novel-config";
import { confirmAction } from "./confirm-modal";
import { ArticleGroupModal } from "./article-group-modal";
import { VolumeEditModal } from "./volume-edit-modal";
import {
  NovelSrcGalleryView,
  SRC_GALLERY_VIEW_TYPE,
} from "./src-gallery-view";
import {
  NovelWorkbenchView,
  WORKBENCH_VIEW_TYPE,
} from "./workbench-view";
import {
  frontmatterCompartment,
  setFrontmatterProtection,
} from "./editor/frontmatter-hide-extension";
import { NovelFloatingToolbar } from "./editor/floating-toolbar";
import {
  NOVEL_EDITOR_VIEW_TYPE,
  NovelEditorView,
} from "./novel-editor-view";
import {
  SETTING_COLLECTION_VIEW_TYPE,
  SettingCollectionView,
} from "./setting-collection-view";
import { ModeSettingsPanel } from "./mode-settings-panel";
import { SearchPanelV2 } from "./search-panel-v2";
import {
  refreshSettingKeywords,
  setSettingKeywords,
} from "./editor/setting-keyword-extension";

interface ChapterMeta {
  wordCount: number;
  status: ChapterStatus;
}


export default class NovelViewPlugin extends LegacyNovelViewPlugin {
  [key: string]: any;

  private readonly chapterMetaCache = new Map<string, ChapterMeta>();
  private readonly articleUndoStack: Array<() => Promise<void>> = [];
  private readonly novelConfigs = new Map<string, NovelConfig>();
  private searchPanelV2: SearchPanelV2 | null = null;
  private settingKeywordTooltip: HTMLElement | null = null;
  private settingKeywordTooltipTimer: number | null = null;
  private readonly wordCountBaselines = new Map<string, number>();
  private readonly historyTimers = new Map<string, number>();
  private readonly settingGroups = new Map<string, string>();
  private readonly settingCollectionTimers = new Map<string, number>();
  private readonly ensuringSettingCollections = new Set<string>();
  private suppressSettingGroupFolderRename = false;
  private readonly forcingSourceLeaves = new WeakSet<WorkspaceLeaf>();
  private readonly sourceModeAttempts = new WeakMap<WorkspaceLeaf, number>();
  private routingNovelFile = false;
  private allowNovelFolderToggle = false;
  private historySaveChain: Promise<void> = Promise.resolve();
  private articleDragPaths: string[] = [];
  private articleDragCancelled = false;
  private articleDragPreview: HTMLElement | null = null;
  private articleDropMode: "split" | "tabs" | "replace" | null = null;
  private articleDropHeader: HTMLElement | null = null;
  private articleDropHandled = false;
  private modeSettingsPanel: ModeSettingsPanel | null = null;

  async onload(): Promise<void> {
    const originalRegisterView = this.registerView.bind(this);
    this.registerView = (type: string, factory: any): void => {
      if (type === ARTICLE_LIST_VIEW_TYPE) {
        originalRegisterView(type, (leaf: WorkspaceLeaf) => (
          new NovelArticleListView(leaf, this)
        ));
        return;
      }
      if (type === SRC_GALLERY_VIEW_TYPE) {
        originalRegisterView(type, (leaf: WorkspaceLeaf) => (
          new NovelSrcGalleryView(leaf, this)
        ));
        return;
      }
      if (type === "novelview-link-library") {
        // Legacy view type retired with the old link library.
        return;
      }
      if (type === WORKBENCH_VIEW_TYPE) {
        originalRegisterView(type, (leaf: WorkspaceLeaf) => (
          new NovelWorkbenchView(leaf, this)
        ));
        return;
      }
      if (type === NOVEL_EDITOR_VIEW_TYPE) {
        originalRegisterView(type, (leaf: WorkspaceLeaf) => (
          new NovelEditorView(leaf, this)
        ));
        return;
      }
      if (type === SETTING_COLLECTION_VIEW_TYPE) {
        originalRegisterView(type, (leaf: WorkspaceLeaf) => (
          new SettingCollectionView(leaf, this)
        ));
        return;
      }
      originalRegisterView(type, factory);
    };

    await super.onload();
    this.registerView = originalRegisterView;
    this.registerView(NOVEL_EDITOR_VIEW_TYPE, (leaf: WorkspaceLeaf) => (
      new NovelEditorView(leaf, this)
    ));
    this.registerView(SETTING_COLLECTION_VIEW_TYPE, (leaf: WorkspaceLeaf) => (
      new SettingCollectionView(leaf, this)
    ));
    this.settings.fontSize ??= 16;
    this.clearNativeNovelModeStyles();
    this.app.workspace.onLayoutReady(() => {
      const active = this.getActiveMarkdownView();
      if (active?.file) {
        this.routeNovelFileOpen(active.file);
      }
      void this.initializeSettingGroups();
    });
    this.registerEvent(this.app.workspace.on("file-open", (file) => {
      if (file instanceof TFile) {
        this.routeNovelFileOpen(file);
      }
    }));
    this.registerEvent(this.app.workspace.on("active-leaf-change", () => {
      const active = this.app.workspace.activeLeaf?.view;
      if (active instanceof NovelEditorView) {
        active.activate();
        return;
      }
      if (active instanceof MarkdownView && active.file) {
        this.routeNovelFileOpen(active.file);
      }
    }));
    this.registerEditorExtension(frontmatterCompartment.of([]));
    await this.migrateNovelConfigs();
    await this.loadNovelConfigs();
    await this.loadWordCountBaselines();
    this.registerEvent(this.app.vault.on("create", (file) => {
      this.handleSettingGroupPathChange(file.path, null);
    }));
    this.registerEvent(this.app.vault.on("rename", (file, oldPath) => {
      this.handleSettingGroupPathChange(file.path, oldPath);
    }));
    this.registerEvent(this.app.vault.on("delete", (file) => {
      this.handleSettingGroupPathChange(null, file.path);
    }));
    this.registerEvent(this.app.workspace.on("layout-change", () => {
      this.ensureAllNovelSourceModes();
    }));
    this.ensureAllNovelSourceModes();
    this.registerEvent(this.app.vault.on("modify", (file) => {
      if (!(file instanceof TFile)) {
        return;
      }
      this.scheduleHistoryCheck(file);
      if (file.name === SETTING_COLLECTION_INDEX) {
        const root = this.settingRootForPath(
          this.normalizeFolderPath(file.parent?.path ?? "/"),
        );
        if (root) {
          this.scheduleSettingCollection(root);
          void this.refreshSettingKeywordIndex();
        }
      }
    }));
    this.registerEvent(this.app.vault.on("create", (file) => {
      if (file instanceof TFile && file.extension === "md") {
        void this.initializeWordCountBaseline(file);
      }
    }));
    this.registerEvent(this.app.vault.on("rename", (_file, oldPath) => {
      void this.handleArticlePathChange(
        oldPath,
        _file.path,
        _file instanceof TFolder,
      );
    }));
    this.registerEvent(this.app.vault.on("delete", (file) => {
      void this.handleArticlePathDeleted(file.path);
    }));
    this.registerDomEvent(document, "mouseover", (event) => {
      const target = (event.target as HTMLElement | null)?.closest<HTMLElement>(
        ".novelview-setting-keyword",
      );
      if (target) {
        this.clearSettingKeywordTooltipTimer();
        this.showSettingKeywordTooltip(target);
      }
    });
    this.registerDomEvent(document, "mouseout", (event) => {
      const target = (event.target as HTMLElement | null)?.closest<HTMLElement>(
        ".novelview-setting-keyword",
      );
      if (!target) {
        return;
      }
      const related = event.relatedTarget as Node | null;
      if (
        related
        && this.settingKeywordTooltip
        && this.settingKeywordTooltip.contains(related)
      ) {
        return;
      }
      this.scheduleHideSettingKeywordTooltip();
    });
    this.registerDomEvent(document, "scroll", () => this.hideSettingKeywordTooltip(), true);
    this.registerDomEvent(document, "dragstart", (event) => {
      if (!(event.target as HTMLElement | null)?.closest(".novelview-article-list-view")) {
        this.clearArticleDrag();
      }
    }, true);
    this.registerDomEvent(window, "dragover", (event) => {
      if (!this.isArticleDragEvent(event)) {
        return;
      }
      if ((event.target as HTMLElement | null)?.closest(".novelview-article-list-view")) {
        this.hideArticleDragPreview();
        return;
      }
      if (this.articleDragCancelled) {
        this.articleDropMode = null;
        this.articleDropHeader = null;
        this.hideArticleDragPreview();
        return;
      }
      const context = this.getArticleDropContext(event.target);
      if (!context) {
        this.articleDropMode = null;
        this.articleDropHeader = null;
        this.hideArticleDragPreview();
        return;
      }
      event.preventDefault();
      if (event.dataTransfer) {
        event.dataTransfer.dropEffect = "copy";
      }
      this.articleDropMode = context.mode;
      this.articleDropHeader = context.header;
      this.showArticleDragPreview(event, context.mode);
    }, true);
    this.registerDomEvent(window, "drop", (event) => {
      if (!this.isArticleDragEvent(event)) {
        return;
      }
      if ((event.target as HTMLElement | null)?.closest(".novelview-article-list-view")) {
        return;
      }
      const live = this.getArticleDropContext(event.target);
      const mode = live?.mode ?? this.articleDropMode;
      const header = live?.header ?? this.articleDropHeader;
      if (!mode || this.articleDragCancelled) {
        this.clearArticleDrag();
        return;
      }
      event.preventDefault();
      event.stopPropagation();
      this.articleDropHandled = true;
      let paths = [...this.articleDragPaths];
      if (paths.length === 0) {
        try {
          const raw = event.dataTransfer?.getData(ARTICLES_MIME);
          const parsed = raw ? JSON.parse(raw) : [];
          if (Array.isArray(parsed)) {
            paths = parsed.filter((path): path is string => typeof path === "string");
          }
        } catch {
          paths = [];
        }
      }
      this.clearArticleDrag();
      void this.performArticleDrop(mode, header, paths);
    }, true);
    this.registerDomEvent(window, "dragend", () => {
      const mode = this.articleDropMode;
      const header = this.articleDropHeader;
      const paths = [...this.articleDragPaths];
      const cancelled = this.articleDragCancelled;
      const handled = this.articleDropHandled;
      window.setTimeout(() => {
        if (!handled && !cancelled && mode && paths.length > 0) {
          void this.performArticleDrop(mode, header, paths);
        }
        this.clearArticleDrag();
      }, 150);
    }, true);
    this.registerDomEvent(document, "keydown", (event) => {
      if (event.key === "Escape" && this.articleDragPaths.length) {
        this.articleDragCancelled = true;
        this.hideArticleDragPreview();
      }
    }, true);
  }

  private showSettingKeywordTooltip(target: HTMLElement): void {
    const settingKeyword = target.dataset.novelviewSettingKeyword;
    if (!settingKeyword) {
      return;
    }
    this.clearSettingKeywordTooltipTimer();
    this.hideSettingKeywordTooltip();
    const groupName = target.dataset.novelviewSettingGroup ?? "";
    const tagName = target.dataset.novelviewSettingTag ?? "";
    const content = target.dataset.novelviewSettingContent ?? "";
    const tooltip = createDiv({ cls: "novelview-setting-keyword-tooltip" });
    tooltip.createDiv({
      cls: "novelview-setting-keyword-tooltip-title",
      text: settingKeyword,
    });
    const meta = tooltip.createDiv({
      cls: "novelview-setting-keyword-tooltip-meta",
    });
    meta.createSpan({
      cls: "novelview-setting-keyword-tooltip-tag",
      text: tagName || "未分类",
    });
    meta.createSpan({
      cls: "novelview-setting-keyword-tooltip-group",
      text: groupName || "未分组",
    });
    if (content) {
      tooltip.createDiv({
        cls: "novelview-setting-keyword-tooltip-divider",
      });
      tooltip.createDiv({
        cls: "novelview-setting-keyword-tooltip-content",
        text: content,
      });
    }
    const current = this.getLastActiveMarkdownFile();
    const root = current
      ? this.findNovelGroupRoot(
        this.normalizeFolderPath(current.parent?.path ?? "/"),
      )
      : null;
    const details = root
      ? this.getSettingRecordDetailFiles(root, groupName, settingKeyword)
      : [];
    if (details.length > 0) {
      tooltip.createDiv({
        cls: "novelview-setting-keyword-tooltip-divider",
      });
      const detailGrid = tooltip.createDiv({
        cls: "novelview-setting-keyword-tooltip-details",
      });
      for (const file of details) {
        const button = detailGrid.createEl("button", {
          cls: "novelview-setting-keyword-tooltip-detail",
          text: this.getSettingRecordDetailLabel(settingKeyword, file),
          attr: { type: "button", title: file.path },
        });
        button.addEventListener("click", (event) => {
          event.preventDefault();
          event.stopPropagation();
          this.hideSettingKeywordTooltip();
          void this.app.workspace.getLeaf(false).openFile(file);
        });
      }
    }
    tooltip.addEventListener("mouseenter", () => {
      this.clearSettingKeywordTooltipTimer();
    });
    tooltip.addEventListener("mouseleave", () => {
      this.scheduleHideSettingKeywordTooltip();
    });
    document.body.appendChild(tooltip);
    const width = tooltip.offsetWidth;
    const height = tooltip.offsetHeight;
    const anchor = target.getBoundingClientRect();
    const left = Math.min(
      Math.max(8, anchor.left),
      window.innerWidth - width - 8,
    );
    const top = Math.min(
      Math.max(8, anchor.bottom + 5),
      window.innerHeight - height - 8,
    );
    tooltip.setCssStyles({ left: `${left}px`, top: `${top}px` });
    this.settingKeywordTooltip = tooltip;
  }

  private scheduleHideSettingKeywordTooltip(): void {
    this.clearSettingKeywordTooltipTimer();
    this.settingKeywordTooltipTimer = window.setTimeout(() => {
      this.settingKeywordTooltipTimer = null;
      this.hideSettingKeywordTooltip();
    }, 180);
  }

  private clearSettingKeywordTooltipTimer(): void {
    if (this.settingKeywordTooltipTimer !== null) {
      window.clearTimeout(this.settingKeywordTooltipTimer);
      this.settingKeywordTooltipTimer = null;
    }
  }

  private hideSettingKeywordTooltip(): void {
    this.clearSettingKeywordTooltipTimer();
    this.settingKeywordTooltip?.remove();
    this.settingKeywordTooltip = null;
  }

  async refreshSettingKeywordIndex(): Promise<void> {
    const current = this.getLastActiveMarkdownFile();
    const clear = (): void => {
      setSettingKeywords([]);
      refreshSettingKeywords();
    };
    if (!current) {
      clear();
      return;
    }
    const root = this.findNovelGroupRoot(
      this.normalizeFolderPath(current.parent?.path ?? "/"),
    );
    if (!root) {
      clear();
      return;
    }
    const folder = this.getSettingGroupFolderForNovel(root);
    if (!folder) {
      clear();
      return;
    }
    const index = await this.readSettingCollectionIndex(folder.path);
    setSettingKeywords(getSettingKeywordEntries(index));
    refreshSettingKeywords();
  }

  refreshLinkKeywordIndex(): void {}

  decorateReadingLinkKeywords(): void {}

  onunload(): void {
    this.hideSettingKeywordTooltip();
    this.clearArticleDrag();
    super.onunload();
  }

  async loadSettings(): Promise<void> {
    await super.loadSettings();
    const raw = await this.loadData() as { settings?: { fontSize?: unknown } } | null;
    const size = Number(raw?.settings?.fontSize);
    this.settings.fontSize = Number.isFinite(size) && size >= 12 && size <= 28
      ? size
      : 16;
  }

  syncFloatingToolbar(view: MarkdownView, enabled: boolean): void {
    const existing = this.novelToolbars.get(view);
    if (!enabled) {
      existing?.destroy();
      this.novelToolbars.delete(view);
      return;
    }
    if (existing) {
      return;
    }
    const toolbar = new NovelFloatingToolbar(
      view.containerEl,
      {
        formatDocument: () => this.formatNovelDocument(view),
        addImage: () => { void this.insertNovelImage(view); },
        addImageFromLibrary: () => this.insertImageFromLibrary(view),
        openSearch: () => this.openAdvancedSearch(),
        openModeSettings: () => this.openModeSettings(),
      },
      this.getNovelToolbarScope(view.file),
    );
    this.novelToolbars.set(view, toolbar);
  }

  ensureViewAction(): void {}

  registerCommands(): void {}

  openAdvancedSearch(): void {
    if (!this.searchPanelV2) {
      this.searchPanelV2 = new SearchPanelV2(this);
    }
    this.searchPanelV2.open(this.getActiveMarkdownView() ?? undefined);
  }

  openModeSettings(): void {
    if (this.modeSettingsPanel) {
      return;
    }
    this.modeSettingsPanel = new ModeSettingsPanel(
      {
        fontSize: Number(this.settings.fontSize) || 16,
        lineHeight: Number(this.settings.lineHeight) || 1.8,
        paragraphSpacing: Number(this.settings.paragraphSpacing) || 0.65,
        firstLineIndent: Number(this.settings.firstLineIndent) || 2,
      },
      (values) => {
        this.settings.fontSize = values.fontSize;
        this.settings.lineHeight = values.lineHeight;
        this.settings.paragraphSpacing = values.paragraphSpacing;
        this.settings.firstLineIndent = values.firstLineIndent;
        this.applyFormatSettingsLive();
        void this.saveSettings();
      },
      () => { this.modeSettingsPanel = null; },
    );
  }

  private applyFormatSettingsLive(): void {
    for (const leaf of this.app.workspace.getLeavesOfType("markdown")) {
      if (!(leaf.view instanceof MarkdownView)) {
        continue;
      }
      const view = leaf.view;
      if (view.contentEl.hasClass("novelview-novel-mode")) {
        this.applyModeStyles(view.contentEl);
        this.refreshEditor(view);
      }
    }
    for (const leaf of this.app.workspace.getLeavesOfType(NOVEL_EDITOR_VIEW_TYPE)) {
      const view = leaf.view as { applySettings?: () => void };
      view.applySettings?.();
    }
  }

  applyModeStyles(contentEl: HTMLElement): void {
    (LegacyNovelViewPlugin.prototype as any).applyModeStyles.call(this, contentEl);
    contentEl.setCssProps({
      "--novelview-font-size": `${Number(this.settings.fontSize) || 16}px`,
    });
  }

  refreshArticleListViews(): void {
    for (const leaf of this.app.workspace.getLeavesOfType(ARTICLE_LIST_VIEW_TYPE)) {
      const view = leaf.view as { scheduleRefresh?: () => void };
      view.scheduleRefresh?.();
    }
  }

  refreshWorkbenchViews(): void {
    for (const leaf of this.app.workspace.getLeavesOfType(WORKBENCH_VIEW_TYPE)) {
      const view = leaf.view as { scheduleRefresh?: () => void };
      view.scheduleRefresh?.();
    }
  }

  async exportChapterTargets(
    targets: ArticleListTarget[],
    folderPath: string,
  ): Promise<void> {
    const articles = targets
      .filter((target) => target.kind === "article")
      .map((target) => this.app.vault.getAbstractFileByPath(target.path))
      .filter((file): file is TFile => file instanceof TFile);
    if (articles.length === 0) {
      new Notice("Novel View：没有可导出的章节。");
      return;
    }
    const info = this.getNovelGroupInfo(folderPath);
    const name = articles.length === 1
      ? articles[0].basename
      : `${info?.name ?? "小说"}-选章`;
    await this.exportTxtFiles(articles, name);
  }

  async exportVolumeTarget(
    target: ArticleListTarget,
    folderPath: string,
  ): Promise<void> {
    const folder = this.getFolder(target.path);
    if (!folder) {
      new Notice("Novel View：卷不存在。");
      return;
    }
    const files: TFile[] = [];
    const collect = (current: TFolder): void => {
      for (const child of current.children) {
        if (child instanceof TFolder) {
          collect(child);
        } else if (
          child instanceof TFile
          && child.extension === "md"
          && !this.isSpecialNovelFile(child)
        ) {
          files.push(child);
        }
      }
    };
    collect(folder);
    if (files.length === 0) {
      new Notice("Novel View：本卷没有可导出的章节。");
      return;
    }
    await this.exportTxtFiles(files, target.title);
  }

  private async exportTxtFiles(files: TFile[], suggestedName: string): Promise<void> {
    const dialog = this.getElectronDialog();
    if (!dialog) {
      new Notice("Novel View：当前环境不支持系统文件夹选择器。");
      return;
    }
    const result = await dialog.showOpenDialog({
      properties: ["openDirectory", "createDirectory"],
    });
    const targetDir = result?.filePaths?.[0];
    if (result?.canceled || !targetDir) {
      return;
    }
    interface ExportRow {
      file: TFile;
      root: string | null;
      volume: string | null;
      volumeRank: number;
      volumeNumber: number;
      chapterId: number;
      body: string;
    }
    const rows: ExportRow[] = [];
    const rootOrders = new Map<string, string[]>();
    const fallbackVolumes = new Map<string, string[]>();
    for (const file of files) {
      const parent = this.normalizeFolderPath(file.parent?.path ?? "/");
      const root = this.findNovelGroupRoot(parent);
      const volume = root && parent !== root ? file.parent?.name ?? null : null;
      let volumeRank = -1;
      if (root && volume) {
        if (!rootOrders.has(root)) {
          rootOrders.set(root, this.getNovelVolumeOrder(root));
        }
        if (!fallbackVolumes.has(root)) {
          fallbackVolumes.set(root, []);
        }
        const order = rootOrders.get(root) ?? [];
        const fallback = fallbackVolumes.get(root) ?? [];
        let index = order.indexOf(volume);
        if (index < 0) {
          index = fallback.indexOf(volume);
          if (index < 0) {
            fallback.push(volume);
            index = fallback.length - 1;
          }
          index += order.length;
        }
        volumeRank = index;
      }
      rows.push({
        file,
        root,
        volume,
        volumeRank,
        volumeNumber: 0,
        chapterId: this.getArticleId(file.path),
        body: this.extractTxtBody(await this.app.vault.cachedRead(file)),
      });
    }
    rows.sort((left, right) => {
      const rootOrder = (left.root ?? "").localeCompare(right.root ?? "", "zh-CN");
      if (rootOrder !== 0) {
        return rootOrder;
      }
      if (left.volume !== right.volume) {
        if (left.volume === null) {
          return -1;
        }
        if (right.volume === null) {
          return 1;
        }
        const rank = left.volumeRank - right.volumeRank;
        if (rank !== 0) {
          return rank;
        }
      }
      return left.chapterId - right.chapterId;
    });
    for (const row of rows) {
      if (!row.volume) {
        continue;
      }
      const order = row.root ? rootOrders.get(row.root) ?? [] : [];
      const fallback = row.root ? fallbackVolumes.get(row.root) ?? [] : [];
      const index = order.indexOf(row.volume);
      row.volumeNumber = index >= 0
        ? index + 1
        : order.length + fallback.indexOf(row.volume) + 1;
    }
    const chapters: TxtExportChapter[] = rows.map((row) => ({
      title: row.file.basename,
      volume: row.volume,
      volumeNumber: row.volumeNumber,
      body: row.body,
    }));
    const text = formatNovelTxt(chapters);
    const safeName = suggestedName.replace(/[\\/:*?"<>|]/gu, "-").trim() || "导出";
    let target = path.join(targetDir, `${safeName}.txt`);
    let index = 2;
    while (fs.existsSync(target)) {
      target = path.join(targetDir, `${safeName}-${index}.txt`);
      index += 1;
    }
    fs.writeFileSync(target, text, "utf8");
    new Notice(`Novel View：已导出到 ${target}`);
  }

  private extractTxtBody(content: string): string {
    const source = content.replace(/^\uFEFF/u, "");
    const lines = source.split(/\r?\n/u);
    const end = findFrontmatterEnd(
      (index: number) => lines[index] ?? null,
      lines.length,
    );
    return lines.slice(end).join("\n")
      .replace(/^\n+/u, "")
      .replace(/\n+$/u, "");
  }

  private getElectronDialog(): any {
    try {
      const electron = require("electron");
      return electron?.remote?.dialog
        ?? electron?.dialog
        ?? (globalThis as any).require?.("electron")?.remote?.dialog;
    } catch {
      return null;
    }
  }

  formatNovelDocument(view: MarkdownView): void {
    if (!view.file || view.getMode() === "preview") {
      return;
    }
    const editor = view.editor;
    const result = formatNovelMarkdown(editor.getValue());
    if (!result.changed) {
      new Notice("Novel View：文档已经是整洁格式，无需调整。");
      return;
    }
    editor.setValue(result.text);
    const parts: string[] = [];
    if (result.trimmedLines > 0) {
      parts.push(`清理 ${result.trimmedLines} 行行尾空白`);
    }
    if (result.removedBlankLines > 0) {
      parts.push(`删除 ${result.removedBlankLines} 个空行`);
    }
    new Notice(`Novel View：自动排版完成${parts.length ? `，${parts.join("，")}` : ""}。`);
  }

  async getChapterMeta(path: string): Promise<ChapterMeta> {
    const file = this.app.vault.getAbstractFileByPath(path);
    if (!(file instanceof TFile)) {
      return { wordCount: 0, status: "todo" };
    }
    try {
      const content = await this.app.vault.cachedRead(file);
      const status = readChapterStatus(
        this.app.metadataCache.getFileCache(file)?.frontmatter,
      );
      const meta = {
        wordCount: countNovelCharacters(content),
        status,
      };
      this.chapterMetaCache.set(path, meta);
      return meta;
    } catch (error) {
      console.debug("Novel View: chapter meta read skipped", error);
      return this.chapterMetaCache.get(path) ?? { wordCount: 0, status: "todo" };
    }
  }

  async setChapterStatus(file: TFile, status: ChapterStatus): Promise<void> {
    await this.app.fileManager.processFrontMatter(file, (frontmatter) => {
      frontmatter[CHAPTER_STATUS_PROPERTY] = CHAPTER_STATUS_LABELS[status];
    });
    this.chapterMetaCache.delete(file.path);
    this.refreshOpenViews();
  }

  async createArticleInFolder(
    folderPath: string,
    currentPath: string,
    title: string,
  ): Promise<void> {
    const folder = this.getFolder(currentPath) ?? this.getFolder(folderPath);
    if (!folder) {
      new Notice("Novel View：当前文章目录不存在。");
      return;
    }
    const base = this.sanitizeFileBase(title, "未命名文章");
    const path = this.getUniqueMarkdownPath(folder.path, base);
    const content = [
      "---",
      `novelview-id: ${this.getNextArticleId(folder.path)}`,
      `${CHAPTER_STATUS_PROPERTY}: ${CHAPTER_STATUS_LABELS.todo}`,
      "---",
      "",
    ].join("\n");
    try {
      const file = await this.app.vault.create(path, content);
      await this.renumberFolder(folder.path);
      await this.openNovelEditor(file);
      this.refreshOpenViews();
    } catch (error) {
      console.error("Novel View: failed to create article", error);
      new Notice("Novel View：文章创建失败。");
    }
  }

  getNovelCoverUrl(folderPath: string, value: string): string | null {
    const cover = normalizeCoverPath(value);
    if (!cover) {
      return null;
    }
    if (/^https?:\/\//iu.test(cover)) {
      return cover;
    }
    const group = this.findNovelGroupRoot(folderPath)
      ?? this.normalizeFolderPath(folderPath);
    const candidates = [
      cover,
      joinVaultPath(group, cover),
      joinVaultPath(group, "src", cover),
      joinVaultPath(group, "src", cover.split("/").pop() ?? cover),
    ];
    for (const candidate of [...new Set(candidates)]) {
      const file = this.app.vault.getAbstractFileByPath(candidate);
      if (file instanceof TFile) {
        return this.app.vault.adapter.getResourcePath(file.path);
      }
    }
    return null;
  }

  getNovelSettingFile(folderPath: string): TFile | null {
    const folder = this.getFolder(folderPath);
    if (!folder) {
      return null;
    }
    const configPath = getNovelConfigPath(folder.path);
    const file = this.app.vault.getAbstractFileByPath(configPath);
    return file instanceof TFile ? file : null;
  }

  findNovelGroupRoot(folderPath: string): string | null {
    let current = this.normalizeFolderPath(folderPath);
    for (;;) {
      if (this.getNovelSettingFile(current)) {
        return current;
      }
      if (current === "/" || !current) {
        return null;
      }
      const index = current.lastIndexOf("/");
      current = index <= 0 ? "/" : current.slice(0, index);
    }
  }

  getNovelGroupInfo(folderPath: string): NovelGroupInfo | null {
    const folder = this.getFolder(folderPath);
    if (!folder || !this.getNovelSettingFile(folder.path)) {
      return null;
    }
    const config = this.novelConfigs.get(folder.path) ?? parseNovelConfig({});
    return {
      folderPath: folder.path,
      name: folder.name,
      description: config["novel-description"],
      cover: config["novel-cover"],
      state: "writing",
    };
  }

  private async loadWordCountBaselines(): Promise<void> {
    for (const root of this.novelConfigs.keys()) {
      for (const file of this.app.vault.getFiles()) {
        if (
          file.extension !== "md"
          || this.isSpecialNovelFile(file)
          || !file.path.startsWith(`${root}/`)
        ) {
          continue;
        }
        try {
          const content = await this.app.vault.cachedRead(file);
          if (!this.wordCountBaselines.has(file.path)) {
            this.wordCountBaselines.set(file.path, countNovelCharacters(content));
          }
        } catch (error) {
          console.debug("Novel View: history baseline skipped", file.path, error);
        }
      }
    }
  }

  private async initializeWordCountBaseline(file: TFile): Promise<void> {
    if (this.isSpecialNovelFile(file) || file.extension !== "md") {
      return;
    }
    const root = this.findNovelGroupRoot(
      this.normalizeFolderPath(file.parent?.path ?? "/"),
    );
    if (!root) {
      return;
    }
    try {
      const content = await this.app.vault.cachedRead(file);
      this.wordCountBaselines.set(file.path, countNovelCharacters(content));
    } catch (error) {
      console.debug("Novel View: history baseline skipped", file.path, error);
    }
  }

  private scheduleHistoryCheck(file: TFile): void {
    if (file.extension !== "md" || this.isSpecialNovelFile(file)) {
      return;
    }
    const root = this.findNovelGroupRoot(
      this.normalizeFolderPath(file.parent?.path ?? "/"),
    );
    if (!root) {
      return;
    }
    const existing = this.historyTimers.get(file.path);
    if (existing !== undefined) {
      window.clearTimeout(existing);
    }
    const timer = window.setTimeout(() => {
      this.historyTimers.delete(file.path);
      void this.recordFileHistory(file, root);
    }, 1200);
    this.historyTimers.set(file.path, timer);
  }

  private async recordFileHistory(file: TFile, root: string): Promise<void> {
    if (!(this.app.vault.getAbstractFileByPath(file.path) instanceof TFile)) {
      return;
    }
    let content = "";
    try {
      content = await this.app.vault.read(file);
    } catch {
      return;
    }
    const current = countNovelCharacters(content);
    const previous = this.wordCountBaselines.get(file.path);
    if (previous === undefined) {
      this.wordCountBaselines.set(file.path, current);
      return;
    }
    const delta = current - previous;
    if (delta === 0) {
      return;
    }
    this.wordCountBaselines.set(file.path, current);
    const now = Date.now();
    const bucketStart = historyBucketStart(now);
    this.historySaveChain = this.historySaveChain.then(async () => {
      const config = await this.readNovelConfig(root);
      const name = file.basename;
      const existing = config.history.find((entry) => (
        entry.bucketStart === bucketStart && entry.path === file.path
      ));
      if (existing) {
        existing.delta += delta;
        existing.name = name;
        existing.updatedAt = now;
      } else {
        config.history.push({
          bucketStart,
          path: file.path,
          name,
          delta,
          updatedAt: now,
        });
      }
      config.history = pruneNovelHistory(
        config.history.filter((entry) => entry.delta !== 0),
      ).slice(-4000);
      await this.writeNovelConfig(root, config);
    }).catch((error) => {
      console.error("Novel View: history save failed", error);
    });
    await this.historySaveChain;
  }

  async normalizeArticleGroups(folderPath: string): Promise<void> {
    const root = this.findNovelGroupRoot(folderPath)
      ?? this.normalizeFolderPath(folderPath);
    await this.ensureVolumeOrder(root);
    const config = await this.readNovelConfig(root);
    const groups = config["article-groups"];
    if (groups.length === 0) {
      return;
    }
    const model = this.getArticleListModel(root);
    if (!model) {
      return;
    }
    const order = new Map<string, { volume: string; index: number }>();
    model.articles.forEach((article: any, index: number) => {
      order.set(article.path, { volume: "", index });
    });
    model.volumes.forEach((volume: any) => {
      volume.articles.forEach((article: any, index: number) => {
        order.set(article.path, { volume: volume.name, index });
      });
    });
    const used = new Set<string>();
    const normalized: NovelArticleGroup[] = [];
    for (const group of groups) {
      const entries = group.paths
        .map((path) => ({ path, position: order.get(path) }))
        .filter((entry): entry is { path: string; position: { volume: string; index: number } } => (
          !!entry.position
          && entry.position.volume === (group.volume || "")
        ))
        .sort((left, right) => left.position.index - right.position.index);
      const runs: Array<Array<{ path: string; position: { volume: string; index: number } }>> = [];
      let current: Array<{ path: string; position: { volume: string; index: number } }> = [];
      for (const entry of entries) {
        const previous = current[current.length - 1];
        if (
          previous
          && (
            previous.position.volume !== entry.position.volume
            || entry.position.index !== previous.position.index + 1
          )
        ) {
          runs.push(current);
          current = [];
        }
        current.push(entry);
      }
      if (current.length > 0) {
        runs.push(current);
      }
      let runIndex = 0;
      for (const run of runs) {
        const paths = run
          .map((entry) => entry.path)
          .filter((path) => !used.has(path));
        if (paths.length < 2) {
          continue;
        }
        const positions = paths.map((path) => order.get(path)!).sort((a, b) => a.index - b.index);
        if (
          positions.some((position, index) => (
            position.volume !== positions[0].volume
            || position.index !== positions[0].index + index
          ))
        ) {
          continue;
        }
        const volume = positions[0].volume;
        const suffix = runIndex === 0 ? "" : `（${runIndex + 1}）`;
        normalized.push({
          ...group,
          id: runIndex === 0 ? group.id : `${group.id}-${runIndex + 1}`,
          name: `${group.name}${suffix}`,
          volume,
          paths,
        });
        for (const path of paths) {
          used.add(path);
        }
        runIndex += 1;
      }
    }
    if (JSON.stringify(normalized) !== JSON.stringify(groups)) {
      config["article-groups"] = normalized;
      await this.writeNovelConfig(root, config);
    }
  }

  private async handleArticlePathChange(
    oldPath: string,
    newPath: string,
    isFolder = false,
  ): Promise<void> {
    if (oldPath === newPath) {
      return;
    }
    const baseline = this.wordCountBaselines.get(oldPath);
    if (baseline !== undefined) {
      this.wordCountBaselines.delete(oldPath);
      this.wordCountBaselines.set(newPath, baseline);
    }
    const oldParent = oldPath.includes("/")
      ? oldPath.slice(0, oldPath.lastIndexOf("/"))
      : "";
    const newParent = newPath.includes("/")
      ? newPath.slice(0, newPath.lastIndexOf("/"))
      : "";
    const oldRoot = this.findNovelGroupRoot(oldParent);
    const newRoot = this.findNovelGroupRoot(newParent);
    const oldName = oldPath.split("/").pop() ?? "";
    const newName = newPath.split("/").pop() ?? "";
    if (oldRoot) {
      const config = await this.readNovelConfig(oldRoot);
      let changed = false;
      if (isFolder) {
        const oldPrefix = `${oldPath}/`;
        const newPrefix = `${newPath}/`;
        for (const [baselinePath, count] of [...this.wordCountBaselines.entries()]) {
          if (baselinePath.startsWith(oldPrefix)) {
            this.wordCountBaselines.delete(baselinePath);
            this.wordCountBaselines.set(
              `${newPrefix}${baselinePath.slice(oldPrefix.length)}`,
              count,
            );
          }
        }
        for (const group of config["article-groups"]) {
          const nextPaths = group.paths.map((path) => (
            path.startsWith(oldPrefix) ? `${newPrefix}${path.slice(oldPrefix.length)}` : path
          ));
          if (nextPaths.some((path, index) => path !== group.paths[index])) {
            group.paths = nextPaths;
            changed = true;
          }
          if (group.volume === oldName) {
            group.volume = newName;
            changed = true;
          }
        }
        for (const entry of config.history) {
          if (entry.path.startsWith(oldPrefix)) {
            entry.path = `${newPrefix}${entry.path.slice(oldPrefix.length)}`;
            changed = true;
          }
        }
        if (config.volumes[oldName]) {
          config.volumes[newName] = config.volumes[oldName];
          delete config.volumes[oldName];
          changed = true;
        }
        const order = config["volume-order"];
        if (order.includes(oldName)) {
          order[order.indexOf(oldName)] = newName;
          changed = true;
        }
      } else {
        const folderGone = !this.getFolder(oldParent);
        if (folderGone && newRoot === oldRoot && oldParent !== newParent) {
          const oldPrefix = `${oldParent}/`;
          const newPrefix = `${newParent}/`;
          const oldVolumeName = oldParent.split("/").pop() ?? "";
          const newVolumeName = newParent.split("/").pop() ?? "";
          for (const group of config["article-groups"]) {
            const nextPaths = group.paths.map((path) => (
              path.startsWith(oldPrefix) ? `${newPrefix}${path.slice(oldPrefix.length)}` : path
            ));
            if (nextPaths.some((path, index) => path !== group.paths[index])) {
              group.paths = nextPaths;
              changed = true;
            }
            if (group.volume === oldVolumeName) {
              group.volume = newVolumeName;
              changed = true;
            }
          }
          for (const entry of config.history) {
            if (entry.path.startsWith(oldPrefix)) {
              entry.path = `${newPrefix}${entry.path.slice(oldPrefix.length)}`;
              changed = true;
            }
          }
          if (config.volumes[oldVolumeName]) {
            config.volumes[newVolumeName] = config.volumes[oldVolumeName];
            delete config.volumes[oldVolumeName];
            changed = true;
          }
          const order = config["volume-order"];
          if (order.includes(oldVolumeName)) {
            order[order.indexOf(oldVolumeName)] = newVolumeName;
            changed = true;
          }
        } else {
          for (const group of config["article-groups"]) {
            const index = group.paths.indexOf(oldPath);
            if (index >= 0) {
              if (newRoot === oldRoot) {
                group.paths[index] = newPath;
              } else {
                group.paths.splice(index, 1);
              }
              changed = true;
            }
          }
          for (const entry of config.history) {
            if (entry.path === oldPath) {
              entry.path = newPath;
              entry.name = newPath.split("/").pop()?.replace(/\.md$/iu, "") ?? entry.name;
              changed = true;
            }
          }
        }
      }
      if (changed) {
        await this.writeNovelConfig(oldRoot, config);
      }
      await this.normalizeArticleGroups(oldRoot);
    }
    if (newRoot && newRoot !== oldRoot) {
      await this.normalizeArticleGroups(newRoot);
    }
    this.refreshArticleListViews();
    this.refreshWorkbenchViews();
  }

  private async handleArticlePathDeleted(path: string): Promise<void> {
    this.wordCountBaselines.delete(path);
    const roots = [...this.novelConfigs.keys()];
    for (const root of roots) {
      const config = await this.readNovelConfig(root);
      let changed = false;
      for (const group of config["article-groups"]) {
        const next = group.paths.filter(
          (entry) => entry !== path && !entry.startsWith(`${path}/`),
        );
        if (next.length !== group.paths.length) {
          group.paths = next;
          changed = true;
        }
      }
      if (changed) {
        await this.writeNovelConfig(root, config);
        await this.normalizeArticleGroups(root);
      }
    }
  }

  getNovelConfig(folderPath: string): NovelConfig {
    return this.novelConfigs.get(this.normalizeFolderPath(folderPath))
      ?? parseNovelConfig({});
  }

  getArticleGroups(folderPath: string): NovelArticleGroup[] {
    return this.getNovelConfig(folderPath)["article-groups"];
  }

  getArticleGroupForPath(folderPath: string, path: string): NovelArticleGroup | null {
    return this.getArticleGroups(folderPath).find((group) => group.paths.includes(path)) ?? null;
  }

  async saveArticleGroup(
    folderPath: string,
    payload: { volume: string; name: string; description: string; paths: string[] },
  ): Promise<void> {
    const group = this.findNovelGroupRoot(folderPath) ?? this.normalizeFolderPath(folderPath);
    const config = await this.readNovelConfig(group);
    const paths = [...new Set(payload.paths)];
    config["article-groups"] = config["article-groups"].filter((entry) => (
      !entry.paths.some((path) => paths.includes(path))
    ));
    config["article-groups"].push({
      id: `group-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      volume: payload.volume,
      name: payload.name,
      description: payload.description,
      paths,
    });
    await this.writeNovelConfig(group, config);
    await this.normalizeArticleGroups(group);
  }

  async addArticlesToGroup(
    folderPath: string,
    groupId: string,
    paths: string[],
  ): Promise<void> {
    const root = this.findNovelGroupRoot(folderPath) ?? this.normalizeFolderPath(folderPath);
    const config = await this.readNovelConfig(root);
    const group = config["article-groups"].find((entry) => entry.id === groupId);
    if (!group) {
      return;
    }
    for (const entry of config["article-groups"]) {
      if (entry.id !== groupId) {
        entry.paths = entry.paths.filter((path) => !paths.includes(path));
      }
    }
    group.paths = [...new Set([...group.paths, ...paths])];
    await this.writeNovelConfig(root, config);
    await this.normalizeArticleGroups(root);
  }

  async updateArticleGroup(
    folderPath: string,
    groupId: string,
    draft: { name: string; description: string },
  ): Promise<void> {
    const root = this.findNovelGroupRoot(folderPath) ?? this.normalizeFolderPath(folderPath);
    const config = await this.readNovelConfig(root);
    const group = config["article-groups"].find((entry) => entry.id === groupId);
    if (!group) {
      return;
    }
    group.name = draft.name;
    group.description = draft.description;
    await this.writeNovelConfig(root, config);
  }

  async removeArticlesFromGroup(
    folderPath: string,
    groupId: string,
    paths: string[],
  ): Promise<void> {
    const root = this.findNovelGroupRoot(folderPath) ?? this.normalizeFolderPath(folderPath);
    const config = await this.readNovelConfig(root);
    const group = config["article-groups"].find((entry) => entry.id === groupId);
    if (!group) {
      return;
    }
    group.paths = group.paths.filter((path) => !paths.includes(path));
    if (group.paths.length === 0) {
      config["article-groups"] = config["article-groups"].filter((entry) => entry.id !== groupId);
    }
    await this.writeNovelConfig(root, config);
    await this.normalizeArticleGroups(root);
  }

  async deleteArticleGroup(folderPath: string, id: string): Promise<void> {
    const group = this.findNovelGroupRoot(folderPath) ?? this.normalizeFolderPath(folderPath);
    const config = await this.readNovelConfig(group);
    config["article-groups"] = config["article-groups"].filter((entry) => entry.id !== id);
    await this.writeNovelConfig(group, config);
  }

  async updateVolumeMeta(
    folderPath: string,
    volume: string,
    patch: { description?: string; cover?: string },
  ): Promise<void> {
    const group = this.findNovelGroupRoot(folderPath) ?? this.normalizeFolderPath(folderPath);
    const config = await this.readNovelConfig(group);
    config.volumes[volume] ??= { description: "", cover: "" };
    if (patch.description !== undefined) {
      config.volumes[volume].description = patch.description;
    }
    if (patch.cover !== undefined) {
      config.volumes[volume].cover = normalizeCoverPath(patch.cover);
    }
    await this.writeNovelConfig(group, config);
    this.refreshWorkbenchViews();
  }

  async editNovelVolumeCover(folderPath: string, volume: string): Promise<void> {
    const setting = this.getNovelSettingFile(folderPath);
    if (!setting) {
      return;
    }
    const file = await this.chooseLocalImage();
    if (!file) {
      return;
    }
    const group = this.findNovelGroupRoot(folderPath) ?? this.normalizeFolderPath(folderPath);
    const saved = await this.saveImageToVault(
      file,
      setting.path,
      joinVaultPath(group, "src"),
    );
    if (saved) {
      await this.updateVolumeMeta(group, volume, { cover: saved.path });
    }
  }

  getUsedNovelCovers(folderPath: string): Set<string> {
    const config = this.getNovelConfig(folderPath);
    const used = new Set<string>();
    if (config["novel-cover"]) {
      used.add(config["novel-cover"]);
    }
    for (const meta of Object.values(config.volumes)) {
      if (meta.cover) {
        used.add(meta.cover);
      }
    }
    return used;
  }

  async openWorkbenchArticleGroup(folderPath: string, groupId: string): Promise<void> {
    this.workbenchFolderPath = this.normalizeFolderPath(folderPath);
    await this.activateWorkbench();
    const leaves = this.app.workspace.getLeavesOfType(WORKBENCH_VIEW_TYPE);
    for (const leaf of leaves) {
      const view = leaf.view as any;
      view.focusArticleGroup?.(groupId);
    }
  }

  isSpecialNovelFile(file: TFile): boolean {
    return isNovelConfigFile(file);
  }

  async readNovelConfig(folderPath: string): Promise<NovelConfig> {
    const group = this.normalizeFolderPath(folderPath);
    const cached = this.novelConfigs.get(group);
    if (cached) {
      return cached;
    }
    const file = this.getNovelSettingFile(group);
    if (!file) {
      const empty = parseNovelConfig({});
      this.novelConfigs.set(group, empty);
      return empty;
    }
    try {
      const raw = await this.app.vault.cachedRead(file);
      const config = parseNovelConfig(JSON.parse(raw));
      this.novelConfigs.set(group, config);
      return config;
    } catch (error) {
      console.error("Novel View: novel.json read failed", error);
      const empty = parseNovelConfig({});
      this.novelConfigs.set(group, empty);
      return empty;
    }
  }

  async writeNovelConfig(folderPath: string, config: NovelConfig): Promise<void> {
    const group = this.normalizeFolderPath(folderPath);
    const path = getNovelConfigPath(group);
    config.history = pruneNovelHistory(config.history);
    const text = serializeNovelConfig(config);
    const existing = this.app.vault.getAbstractFileByPath(path);
    if (existing instanceof TFile) {
      await this.app.vault.modify(existing, text);
    } else {
      await this.app.vault.create(path, text);
    }
    this.novelConfigs.set(group, config);
    this.refreshWorkbenchViews();
  }

  private async migrateNovelConfigs(): Promise<void> {
    const legacyFiles = this.app.vault.getMarkdownFiles().filter(
      (file) => file.name === LEGACY_NOVEL_SETTING_FILENAME,
    );
    for (const file of legacyFiles) {
      const folder = file.parent;
      if (!folder) {
        continue;
      }
      const configPath = getNovelConfigPath(folder.path);
      const configFile = this.app.vault.getAbstractFileByPath(configPath);
      if (!(configFile instanceof TFile)) {
        const frontmatter = this.app.metadataCache.getFileCache(file)?.frontmatter ?? {};
        const config = parseNovelConfig({});
        config["novel-description"] = typeof frontmatter["novel-description"] === "string"
          ? frontmatter["novel-description"]
          : "";
        config["novel-cover"] = typeof frontmatter["novel-cover"] === "string"
          ? normalizeCoverPath(frontmatter["novel-cover"])
          : "";
        await this.app.vault.create(configPath, serializeNovelConfig(config));
        this.novelConfigs.set(folder.path, config);
      }
    }
  }

  private async loadNovelConfigs(): Promise<void> {
    this.novelConfigs.clear();
    for (const file of this.app.vault.getFiles()) {
      if (!isNovelConfigFile(file) || !file.parent) {
        continue;
      }
      try {
        const raw = JSON.parse(await this.app.vault.cachedRead(file));
        const oldHistoryCount = Array.isArray(raw?.history) ? raw.history.length : 0;
        const config = parseNovelConfig(raw);
        if (config["volume-order"].length === 0 && this.volumeOrder instanceof Map) {
          const legacyOrder = this.volumeOrder.get(file.parent.path);
          if (Array.isArray(legacyOrder) && legacyOrder.length > 0) {
            config["volume-order"] = [...legacyOrder];
          }
        }
        this.novelConfigs.set(file.parent.path, config);
        if (oldHistoryCount > config.history.length) {
          await this.writeNovelConfig(file.parent.path, config);
        }
      } catch (error) {
        console.error("Novel View: invalid novel.json", file.path, error);
      }
    }
  }

  private isArticleDragEvent(event: DragEvent): boolean {
    if (this.articleDragPaths.length === 0) {
      return false;
    }
    const types = event.dataTransfer?.types;
    return !!types && (
      types.includes(ARTICLES_MIME)
      || types.includes(ARTICLE_MIME)
    );
  }

  setArticleDrag(paths: string[]): void {
    this.articleDragPaths = [...new Set(paths)];
    this.articleDragCancelled = false;
    this.articleDropHandled = false;
    this.articleDropMode = null;
    this.articleDropHeader = null;
  }

  clearArticleDrag(): void {
    this.hideArticleDragPreview();
    this.articleDragPaths = [];
    this.articleDragCancelled = false;
    this.articleDropMode = null;
    this.articleDropHeader = null;
    this.articleDropHandled = false;
  }

  private getArticleDropContext(target: EventTarget | null): {
    mode: "split" | "tabs" | "replace";
    header: HTMLElement | null;
  } | null {
    const element = target as HTMLElement | null;
    const root = element?.closest<HTMLElement>(".workspace-split.mod-root");
    if (!element || !root) {
      return null;
    }
    const header = element.closest<HTMLElement>(".workspace-tab-header");
    if (header && root.contains(header)) {
      return { mode: "replace", header };
    }
    if (element.closest(".workspace-tab-header-container")) {
      return { mode: "tabs", header: null };
    }
    if (element.closest(".workspace-leaf-content, .workspace-tab-container, .workspace-split.mod-root")) {
      return { mode: "split", header: null };
    }
    return null;
  }

  private showArticleDragPreview(
    event: DragEvent,
    mode: "split" | "tabs" | "replace",
  ): void {
    const labels = {
      split: "在第二栏打开",
      tabs: "添加至标签页栏",
      replace: "替换当前标签页并添加其余",
    };
    let preview = this.articleDragPreview;
    if (!preview) {
      preview = createDiv({ cls: "novelview-article-drop-preview" });
      document.body.appendChild(preview);
      this.articleDragPreview = preview;
    }
    preview.setText(`${this.articleDragPaths.length} 个文件 · ${labels[mode]}`);
    const width = preview.offsetWidth;
    const height = preview.offsetHeight;
    preview.setCssStyles({
      left: `${Math.min(event.clientX + 14, window.innerWidth - width - 8)}px`,
      top: `${Math.min(event.clientY + 16, window.innerHeight - height - 8)}px`,
    });
  }

  private hideArticleDragPreview(): void {
    this.articleDragPreview?.remove();
    this.articleDragPreview = null;
  }

  private async performArticleDrop(
    mode: "split" | "tabs" | "replace",
    header: HTMLElement | null,
    paths: string[],
  ): Promise<void> {
    try {
      await this.performArticleDropInner(mode, header, paths);
    } catch (error) {
      console.error("Novel View: article drop failed", error);
      new Notice("Novel View：打开拖拽文章失败。");
    }
  }

  private async performArticleDropInner(
    mode: "split" | "tabs" | "replace",
    header: HTMLElement | null,
    paths: string[],
  ): Promise<void> {
    const files = paths
      .map((path) => this.app.vault.getAbstractFileByPath(path))
      .filter((file): file is TFile => file instanceof TFile);
    if (files.length === 0) {
      return;
    }
    const activateMain = async (): Promise<void> => {
      const leaf = this.app.workspace.getMostRecentLeaf(this.app.workspace.rootSplit);
      if (leaf) {
        this.app.workspace.setActiveLeaf(leaf, { focus: false });
      }
      await new Promise((resolve) => window.setTimeout(resolve, 0));
    };
    if (mode === "tabs") {
      await activateMain();
      for (const file of files) {
        const leaf = this.app.workspace.getLeaf("tab");
        await leaf.openFile(file, { active: false });
      }
      return;
    }
    if (mode === "replace" && header) {
      header.click();
      await new Promise((resolve) => window.setTimeout(resolve, 20));
      const leaf = this.app.workspace.getMostRecentLeaf(this.app.workspace.rootSplit)
        ?? this.app.workspace.activeLeaf;
      if (leaf) {
        await leaf.openFile(files[0], { active: true });
        for (const file of files.slice(1)) {
          const tab = this.app.workspace.getLeaf("tab");
          await tab.openFile(file, { active: false });
        }
      }
      return;
    }
    await activateMain();
    const splitLeaf = this.app.workspace.getLeaf("split", "vertical");
    await splitLeaf.openFile(files[0], { active: true });
    for (const file of files.slice(1)) {
      const leaf = this.app.workspace.getLeaf("tab");
      await leaf.openFile(file, { active: false });
    }
  }

  openArticleFromList(path: string, _sourcePath: string): void {
    const file = this.app.vault.getAbstractFileByPath(path);
    if (file instanceof TFile) {
      void this.openNovelEditor(file);
    }
  }

  async openFileAtLine(file: TFile, line = 1): Promise<void> {
    if (!this.isNovelArticleFile(file)) {
      const legacyOpen = (LegacyNovelViewPlugin.prototype as any).openFileAtLine as
        (target: TFile, lineNumber: number) => Promise<void>;
      await legacyOpen.call(this, file, line);
      return;
    }
    await this.openNovelEditor(file, line);
  }

  getArticleListModel(folderPath: string): any {
    const model = (LegacyNovelViewPlugin.prototype as any)
      .getArticleListModel.call(this, folderPath);
    if (!model) {
      return null;
    }
    const order = this.getNovelVolumeOrder(folderPath);
    const position = (name: string): number => {
      const index = order.indexOf(name);
      return index >= 0 ? index : order.length;
    };
    model.volumes.sort((left: any, right: any) => (
      position(left.name) - position(right.name)
    ));
    model.volumes.forEach((volume: any, index: number) => {
      volume.volumeNumber = index;
      volume.articles.sort((a: any, b: any) => this.compareChapterOrder(a, b));
      volume.articles.forEach((article: any, articleIndex: number) => {
        article.chapterNumber = articleIndex + 1;
      });
    });
    model.articles.sort((a: any, b: any) => this.compareChapterOrder(a, b));
    model.articles.forEach((article: any, index: number) => {
      article.chapterNumber = index + 1;
    });
    return model;
  }

  private compareChapterOrder(left: any, right: any): number {
    const leftNumber = this.getArticleId(left.path);
    const rightNumber = this.getArticleId(right.path);
    return leftNumber - rightNumber;
  }

  private getArticleId(path: string): number {
    const file = this.app.vault.getAbstractFileByPath(path);
    if (!(file instanceof TFile)) {
      return Number.MAX_SAFE_INTEGER;
    }
    const frontmatter = this.app.metadataCache.getFileCache(file)?.frontmatter;
    const value = frontmatter?.["novelview-id"] ?? frontmatter?.["novelview-chapter"];
    const number = Number(value);
    return Number.isFinite(number) ? number : Number.MAX_SAFE_INTEGER;
  }

  private getNextArticleId(folderPath: string): number {
    const folder = this.getFolder(folderPath);
    if (!folder) {
      return 1;
    }
    let max = 0;
    for (const child of folder.children) {
      if (child instanceof TFile && child.extension === "md") {
        max = Math.max(max, this.getArticleId(child.path) || 0);
      }
    }
    return max + 1;
  }

  async ensureVolumeOrder(folderPath: string): Promise<boolean> {
    const group = this.findNovelGroupRoot(folderPath) ?? this.normalizeFolderPath(folderPath);
    const folder = this.getFolder(group);
    if (!folder) {
      return false;
    }
    const names = folder.children
      .filter((child: any): child is TFolder => child instanceof TFolder)
      .filter((child: TFolder) => !this.isReservedNovelFolder(child.name))
      .map((child: TFolder) => child.name);
    const config = await this.readNovelConfig(group);
    const current = config["volume-order"].filter((name) => names.includes(name));
    for (const name of names) {
      if (!current.includes(name)) {
        current.push(name);
      }
    }
    if (
      current.length === config["volume-order"].length
      && current.every((name, index) => name === config["volume-order"][index])
    ) {
      return false;
    }
    config["volume-order"] = current;
    await this.writeNovelConfig(group, config);
    return true;
  }

  private getNovelVolumeOrder(folderPath: string): string[] {
    const group = this.normalizeFolderPath(folderPath);
    return this.novelConfigs.get(group)?.["volume-order"] ?? [];
  }

  private async saveNovelVolumeOrder(folderPath: string, order: string[]): Promise<void> {
    const group = this.normalizeFolderPath(folderPath);
    const config = await this.readNovelConfig(group);
    config["volume-order"] = [...order];
    await this.writeNovelConfig(group, config);
  }

  private async renumberFolder(folderPath: string): Promise<void> {
    const folder = this.getFolder(folderPath);
    if (!folder) {
      return;
    }
    const files = folder.children
      .filter((child: any): child is TFile => (
        child instanceof TFile
        && child.extension === "md"
        && !this.isSpecialNovelFile(child)
      ))
      .sort((a: any, b: any) => this.compareChapterOrder(
        { path: a.path, basename: a.basename },
        { path: b.path, basename: b.basename },
      ));
    for (let index = 0; index < files.length; index += 1) {
      const file = files[index];
      await this.app.fileManager.processFrontMatter(file, (frontmatter) => {
        frontmatter["novelview-id"] = index + 1;
      });
    }
  }

  async renameArticlePath(path: string, value: string): Promise<string | null> {
    const file = this.app.vault.getAbstractFileByPath(path);
    if (!(file instanceof TFile)) {
      return "文章不存在。";
    }
    const base = this.sanitizeFileBase(value, file.basename);
    if (!base || base === file.basename) {
      return null;
    }
    const parent = this.normalizeFolderPath(file.parent?.path ?? "/");
    const nextPath = joinVaultPath(parent, `${base}.md`);
    if (this.app.vault.getAbstractFileByPath(nextPath)) {
      return "同名文章已存在。";
    }
    await this.app.fileManager.renameFile(file, nextPath);
    this.articleUndoStack.push(async () => {
      const renamed = this.app.vault.getAbstractFileByPath(nextPath);
      if (renamed instanceof TFile) {
        await this.app.fileManager.renameFile(renamed, path);
      }
    });
    return null;
  }

  async renameVolumePath(path: string, value: string): Promise<string | null> {
    const folder = this.getFolder(path);
    if (!folder || folder.path === "/") {
      return "卷不存在。";
    }
    const base = this.sanitizeFileBase(value, folder.name);
    if (!base || base === folder.name) {
      return null;
    }
    if (base.startsWith("-")) {
      return "卷名不能以 - 开头，该前缀保留给设定集。";
    }
    if (this.isReservedNovelFolder(base)) {
      return "该名称是小说组保留名称。";
    }
    const parent = this.normalizeFolderPath(folder.parent?.path ?? "/");
    const nextPath = joinVaultPath(parent, base);
    if (this.app.vault.getAbstractFileByPath(nextPath)) {
      return "同名文件夹已存在。";
    }
    await this.app.fileManager.renameFile(folder, nextPath);
    this.articleUndoStack.push(async () => {
      const renamed = this.getFolder(nextPath);
      if (renamed) {
        await this.app.fileManager.renameFile(renamed, path);
      }
    });
    return null;
  }

  async deleteArticleTargets(
    targets: ArticleListTarget[],
    refresh: () => void,
  ): Promise<void> {
    if (targets.length === 0) {
      return;
    }
    const confirmed = await confirmAction(
      this.app,
      "删除所选内容",
      `确定删除 ${targets.length} 项内容吗？可使用 Cmd/Ctrl+Z 撤销。`,
    );
    if (!confirmed) {
      return;
    }
    const folders = new Set<string>();
    const files: Array<{ path: string; content: ArrayBuffer; binary: boolean }> = [];
    const emptyFolders = new Set<string>();
    for (const target of targets) {
      const abstract = this.app.vault.getAbstractFileByPath(target.path);
      if (abstract instanceof TFile) {
        files.push({
          path: abstract.path,
          content: await this.app.vault.readBinary(abstract),
          binary: abstract.extension !== "md",
        });
        folders.add(abstract.parent?.path ?? "");
        continue;
      }
      if (abstract instanceof TFolder) {
        emptyFolders.add(abstract.path);
        const walk = async (folder: TFolder): Promise<void> => {
          emptyFolders.add(folder.path);
          for (const child of folder.children) {
            if (child instanceof TFolder) {
              await walk(child);
            } else if (child instanceof TFile) {
              files.push({
                path: child.path,
                content: await this.app.vault.readBinary(child),
                binary: child.extension !== "md",
              });
            }
          }
        };
        await walk(abstract);
        folders.add(this.normalizeFolderPath(abstract.parent?.path ?? "/"));
      }
    }
    for (const target of targets) {
      const abstract = this.app.vault.getAbstractFileByPath(target.path);
      if (abstract) {
        await this.app.vault.delete(abstract, true);
      }
    }
    for (const folderPath of folders) {
      if (folderPath) {
        await this.renumberFolder(folderPath);
      }
    }
    this.articleUndoStack.push(async () => {
      const sortedFolders = [...emptyFolders].sort((a, b) => a.length - b.length);
      for (const folderPath of sortedFolders) {
        if (!this.app.vault.getAbstractFileByPath(folderPath)) {
          await this.app.vault.createFolder(folderPath);
        }
      }
      for (const snapshot of files) {
        if (this.app.vault.getAbstractFileByPath(snapshot.path)) {
          continue;
        }
        if (snapshot.binary) {
          await this.app.vault.createBinary(snapshot.path, snapshot.content);
        } else {
          await this.app.vault.create(
            snapshot.path,
            new TextDecoder().decode(snapshot.content),
          );
        }
      }
      for (const folderPath of folders) {
        if (folderPath) {
          await this.renumberFolder(folderPath);
        }
      }
    });
    refresh();
  }

  async importNovelTxt(folderPath: string): Promise<void> {
    const dialog = this.getElectronDialog();
    if (!dialog) {
      new Notice("Novel View：当前环境不支持系统文件选择器。");
      return;
    }
    const result = await dialog.showOpenDialog({
      properties: ["openFile"],
      filters: [{ name: "TXT", extensions: ["txt"] }],
    });
    const filePath = result?.filePaths?.[0];
    if (result?.canceled || !filePath) {
      return;
    }
    const text = fs.readFileSync(filePath, "utf8");
    const chapters = parseNovelTxt(text);
    const target = this.getFolder(folderPath);
    if (!target) {
      new Notice("Novel View：小说组不存在。");
      return;
    }
    if (chapters.length === 0) {
      new Notice("Novel View：TXT 中没有可导入的章节。");
      return;
    }
    const touchedFolders = new Set<string>();
    const created: TFile[] = [];
    try {
      for (const chapter of chapters) {
        let targetFolderPath = folderPath;
        if (chapter.volume) {
          let volumeName = this.sanitizeFileBase(chapter.volume, "卷");
          if (this.isReservedNovelFolder(volumeName)) {
            volumeName = `卷-${volumeName.replace(/^-+/u, "") || "设定"}`;
          }
          targetFolderPath = this.getUniqueFolderPath(folderPath, volumeName);
          if (!this.getFolder(targetFolderPath)) {
            await this.app.vault.createFolder(targetFolderPath);
          }
        }
        const base = this.sanitizeFileBase(chapter.title, "无标题");
        const targetPath = this.getUniqueMarkdownPath(targetFolderPath, base);
        const content = [
          "---",
          `novelview-id: ${this.getNextArticleId(targetFolderPath)}`,
          `${CHAPTER_STATUS_PROPERTY}: ${CHAPTER_STATUS_LABELS.todo}`,
          "---",
          "",
          chapter.body,
        ].join("\n");
        const file = await this.app.vault.create(targetPath, content);
        created.push(file);
        touchedFolders.add(targetFolderPath);
      }
      for (const folder of touchedFolders) {
        await this.renumberFolder(folder);
      }
      await this.ensureVolumeOrder(folderPath);
      this.refreshOpenViews();
      this.refreshArticleListViews();
      this.refreshWorkbenchViews();
      if (created[0]) {
        await this.openNovelEditor(created[0]);
      }
      new Notice(`Novel View：已导入 ${created.length} 个章节。`);
    } catch (error) {
      console.error("Novel View: TXT import failed", error);
      new Notice("Novel View：TXT 导入失败。");
    }
  }

  private getUniqueFolderPath(parentPath: string, base: string): string {
    let candidate = joinVaultPath(parentPath, base);
    let index = 2;
    for (;;) {
      const existing = this.app.vault.getAbstractFileByPath(candidate);
      if (!existing) {
        return candidate;
      }
      if (existing instanceof TFolder) {
        return candidate;
      }
      candidate = joinVaultPath(parentPath, `${base} ${index}`);
      index += 1;
    }
  }

  async undoLastArticleAction(): Promise<void> {
    const action = this.articleUndoStack.pop();
    if (!action) {
      new Notice("Novel View：没有可撤销的文章列表操作。");
      return;
    }
    try {
      await action();
      this.refreshOpenViews();
      new Notice("Novel View：已撤销。");
    } catch (error) {
      console.error("Novel View: undo failed", error);
      new Notice("Novel View：撤销失败。");
    }
  }

  async moveArticlesToVolume(paths: string[], targetFolder: string): Promise<boolean> {
    const target = this.getFolder(targetFolder);
    if (!target) {
      return false;
    }
    const moved: Array<{ oldPath: string; newPath: string; sourceFolder: string }> = [];
    const folders = new Set<string>([target.path]);
    for (const sourcePath of paths) {
      const file = this.app.vault.getAbstractFileByPath(sourcePath);
      if (!(file instanceof TFile)) {
        continue;
      }
      if (file.parent?.path === target.path) {
        continue;
      }
      const sourceFolder = file.parent?.path ?? "";
      folders.add(sourceFolder);
      let nextPath = joinVaultPath(target.path, file.name);
      let index = 2;
      while (this.app.vault.getAbstractFileByPath(nextPath)) {
        nextPath = joinVaultPath(target.path, `${file.basename} ${index}.md`);
        index += 1;
      }
      await this.app.fileManager.renameFile(file, nextPath);
      moved.push({ oldPath: sourcePath, newPath: nextPath, sourceFolder });
    }
    let nextId = this.getNextArticleId(target.path);
    for (const entry of moved) {
      const movedFile = this.app.vault.getAbstractFileByPath(entry.newPath);
      if (movedFile instanceof TFile) {
        await this.app.fileManager.processFrontMatter(movedFile, (frontmatter) => {
          frontmatter["novelview-id"] = nextId;
        });
        nextId += 1;
      }
    }
    if (moved.length > 0) {
      this.articleUndoStack.push(async () => {
        for (const entry of moved) {
          const file = this.app.vault.getAbstractFileByPath(entry.newPath);
          if (file instanceof TFile) {
            await this.app.fileManager.renameFile(file, entry.oldPath);
          }
        }
        for (const folder of folders) {
          if (folder) {
            await this.renumberFolder(folder);
          }
        }
      });
    }
    return true;
  }

  async reorderArticlesAt(
    paths: string[],
    targetPath: string,
    after: boolean,
  ): Promise<boolean> {
    const target = this.app.vault.getAbstractFileByPath(targetPath);
    if (!(target instanceof TFile) || !target.parent) {
      return false;
    }
    const targetFolder = target.parent.path;
    const before = new Map<string, unknown>();
    const targetFolderObj = this.getFolder(targetFolder);
    if (targetFolderObj) {
      for (const child of targetFolderObj.children) {
        if (child instanceof TFile) {
          before.set(child.path, this.app.metadataCache.getFileCache(child)?.frontmatter?.["novelview-id"]);
        }
      }
    }
    await this.moveArticlesToVolume(paths, targetFolder);
    const folder = this.getFolder(targetFolder);
    if (!folder) {
      return false;
    }
    const files = folder.children
      .filter((child: any): child is TFile => child instanceof TFile && child.extension === "md")
      .sort((a: any, b: any) => this.compareChapterOrder(
        { path: a.path, basename: a.basename },
        { path: b.path, basename: b.basename },
      ));
    const moving = files.filter((file: any) => paths.includes(file.path));
    const remaining = files.filter((file: any) => !paths.includes(file.path));
    const targetFile = remaining.find((file: any) => file.path === targetPath);
    if (!targetFile) {
      return false;
    }
    const targetIndex = remaining.indexOf(targetFile) + (after ? 1 : 0);
    remaining.splice(targetIndex, 0, ...moving);
    for (let index = 0; index < remaining.length; index += 1) {
      await this.app.fileManager.processFrontMatter(remaining[index], (frontmatter) => {
        frontmatter["novelview-id"] = index + 1;
      });
    }
    this.articleUndoStack.push(async () => {
      for (const [filePath, chapter] of before) {
        const file = this.app.vault.getAbstractFileByPath(filePath);
        if (file instanceof TFile) {
          await this.app.fileManager.processFrontMatter(file, (frontmatter) => {
            if (chapter === undefined || chapter === null) {
              delete frontmatter["novelview-id"];
            } else {
              frontmatter["novelview-id"] = chapter;
            }
          });
        }
      }
    });
    const root = this.findNovelGroupRoot(targetFolder);
    if (root) {
      await this.normalizeArticleGroups(root);
    }
    return true;
  }

  async reorderVolume(folderPath: string, sourcePath: string, targetPath: string): Promise<void> {
    const folder = this.getFolder(folderPath);
    if (!folder) {
      return;
    }
    const names = folder.children
      .filter((child: any): child is TFolder => child instanceof TFolder)
      .filter((child: any) => !this.isReservedNovelFolder(child.name))
      .map((child: any) => child.name);
    const source = sourcePath.split("/").pop();
    const target = targetPath.split("/").pop();
    if (!source || !target || source === target) {
      return;
    }
    const order = this.getNovelVolumeOrder(folderPath).filter((name) => names.includes(name));
    for (const name of names) {
      if (!order.includes(name)) {
        order.push(name);
      }
    }
    const from = order.indexOf(source);
    const to = order.indexOf(target);
    if (from < 0 || to < 0) {
      return;
    }
    order.splice(from, 1);
    order.splice(to, 0, source);
    await this.saveNovelVolumeOrder(folderPath, order);
  }

  async updateNovelInfo(
    folderPath: string,
    patch: { description?: string; cover?: string },
  ): Promise<void> {
    const group = this.normalizeFolderPath(folderPath);
    const config = await this.readNovelConfig(group);
    if (patch.description !== undefined) {
      config["novel-description"] = patch.description;
    }
    if (patch.cover !== undefined) {
      config["novel-cover"] = normalizeCoverPath(patch.cover);
    }
    await this.writeNovelConfig(group, config);
  }

  async editNovelCover(folderPath: string): Promise<void> {
    const setting = this.getNovelSettingFile(folderPath);
    if (!setting) {
      return;
    }
    const file = await this.chooseLocalImage();
    if (!file) {
      return;
    }
    const group = this.findNovelGroupRoot(folderPath) ?? this.normalizeFolderPath(folderPath);
    const saved = await this.saveImageToVault(
      file,
      setting.path,
      joinVaultPath(group, "src"),
    );
    if (saved) {
      await this.updateNovelInfo(group, { cover: saved.path });
    }
  }

  async renameNovelGroupFolder(
    folderPath: string,
    value: string,
  ): Promise<void> {
    const folder = this.getFolder(folderPath);
    if (!folder) {
      return;
    }
    const name = this.sanitizeFileBase(value, folder.name);
    if (!name || name === folder.name) {
      return;
    }
    const parent = this.normalizeFolderPath(folder.parent?.path ?? "/");
    const nextPath = joinVaultPath(parent, name);
    if (this.app.vault.getAbstractFileByPath(nextPath)) {
      new Notice("Novel View：同名文件夹已存在。");
      return;
    }
    const cachedConfig = this.novelConfigs.get(folderPath);
    await this.app.fileManager.renameFile(folder, nextPath);
    if (cachedConfig) {
      this.novelConfigs.delete(folderPath);
      this.novelConfigs.set(nextPath, cachedConfig);
    }
    if (this.workbenchFolderPath === folderPath) {
      this.workbenchFolderPath = nextPath;
    }
    for (const leaf of this.app.workspace.getLeavesOfType(ARTICLE_LIST_VIEW_TYPE)) {
      const state = leaf.getViewState().state as { folderPath?: unknown };
      if (state.folderPath === folderPath) {
        await leaf.setViewState({
          type: ARTICLE_LIST_VIEW_TYPE,
          state: { folderPath: nextPath },
          active: true,
        });
      }
    }
    this.refreshWorkbenchViews();
    this.scheduleNovelFolderDecoration();
  }

  private async initializeSettingGroups(): Promise<void> {
    await this.loadSettingGroups();
    this.scheduleNovelFolderDecoration();
    window.setTimeout(() => {
      this.expandNovelGroupFolders();
      this.scheduleNovelFolderDecoration();
    }, 80);
    for (const root of this.settingGroups.keys()) {
      this.scheduleSettingCollection(root);
    }
    this.refreshSettingCollectionViews();
    void this.refreshSettingKeywordIndex();
  }

  private async loadSettingGroups(): Promise<void> {
    this.settingGroups.clear();
    const novelRoots = new Set<string>();
    for (const file of this.app.vault.getFiles()) {
      if (file.name === "novel.json" && file.parent) {
        novelRoots.add(this.normalizeFolderPath(file.parent.path));
      }
    }
    for (const novelRoot of novelRoots) {
      const folder = this.getFolder(novelRoot);
      if (!folder) {
        continue;
      }
      for (const child of folder.children) {
        if (child instanceof TFolder && child.name.startsWith("-")) {
          this.settingGroups.set(
            this.normalizeFolderPath(child.path),
            novelRoot,
          );
        }
      }
    }
  }

  private getSettingGroupFolderForNovel(novelRoot: string): TFolder | null {
    const normalized = this.normalizeFolderPath(novelRoot);
    for (const [settingRoot, targetNovel] of this.settingGroups) {
      if (targetNovel !== normalized) {
        continue;
      }
      const folder = this.getFolder(settingRoot);
      if (folder) {
        return folder;
      }
    }
    const novelFolder = this.getFolder(normalized);
    if (!novelFolder) {
      return null;
    }
    for (const child of novelFolder.children) {
      if (child instanceof TFolder && child.name.startsWith("-")) {
        this.settingGroups.set(
          this.normalizeFolderPath(child.path),
          normalized,
        );
        return child;
      }
    }
    return null;
  }

  private refreshSettingCollectionViews(): void {
    for (const leaf of this.app.workspace.getLeavesOfType(
      SETTING_COLLECTION_VIEW_TYPE,
    )) {
      const view = leaf.view as { refresh?: () => void };
      void view.refresh?.();
    }
  }

  private settingRootForPath(path: string): string | null {
    const normalized = this.normalizeFolderPath(path);
    for (const root of this.settingGroups.keys()) {
      if (normalized === root || normalized.startsWith(`${root}/`)) {
        return root;
      }
    }
    return null;
  }

  async createSettingGroup(novelPath: string): Promise<void> {
    const novelRoot = this.findNovelGroupRoot(novelPath)
      ?? this.normalizeFolderPath(novelPath);
    const novelFolder = this.getFolder(novelRoot);
    if (!novelFolder || !this.getNovelSettingFile(novelRoot)) {
      new Notice("Novel View：找不到小说组。");
      return;
    }
    const existing = this.getSettingGroupFolderForNovel(novelRoot);
    if (existing) {
      this.revealSettingGroup(existing);
      return;
    }
    let folderPath = joinVaultPath(novelRoot, "-设定");
    let suffix = 2;
    while (this.app.vault.getAbstractFileByPath(folderPath)) {
      folderPath = joinVaultPath(novelRoot, `-设定 ${suffix}`);
      suffix += 1;
    }
    try {
      const folder = await this.app.vault.createFolder(folderPath);
      this.settingGroups.set(folderPath, novelRoot);
      await this.ensureSettingCollection(folderPath);
      this.scheduleNovelFolderDecoration();
      window.setTimeout(() => {
        this.expandNovelGroupFolders();
        this.scheduleNovelFolderDecoration();
      }, 80);
      this.scheduleSettingCollection(folderPath);
      this.revealSettingGroup(folder);
      new Notice(`Novel View：已构建设定集“${folder.name.replace(/^-+/u, "")}”。`);
    } catch (error) {
      console.error("Novel View: failed to create setting group", error);
      new Notice("Novel View：设定集创建失败。");
    }
  }

  async importSettingCollection(
    novelRoot: string,
  ): Promise<{ groups: number; files: number } | null> {
    const dialog = this.getElectronDialog();
    if (!dialog) {
      new Notice("Novel View：当前环境不支持系统文件夹选择器。");
      return null;
    }
    const result = await dialog.showOpenDialog({
      properties: ["openDirectory"],
    });
    const sourceDir = result?.filePaths?.[0];
    if (result?.canceled || !sourceDir) {
      return null;
    }
    let folder = this.getSettingGroupFolderForNovel(novelRoot);
    if (!folder) {
      await this.createSettingGroup(novelRoot);
      folder = this.getSettingGroupFolderForNovel(novelRoot);
    }
    if (!folder) {
      new Notice("Novel View：设定集创建失败。");
      return null;
    }
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(sourceDir, { withFileTypes: true });
    } catch (error) {
      console.error("Novel View: setting import folder read failed", error);
      new Notice("Novel View：无法读取导入文件夹。");
      return null;
    }
    const groups = entries
      .filter((entry) => entry.isDirectory() && !entry.name.startsWith("."))
      .map((entry) => entry.name.trim())
      .filter(Boolean);
    if (groups.length === 0) {
      new Notice("Novel View：导入文件夹下没有子文件夹。");
      return null;
    }
    const index = await this.readSettingCollectionIndex(folder.path);
    for (const group of groups) {
      if (!Object.prototype.hasOwnProperty.call(index, group)) {
        index[group] = [];
      }
    }
    await this.writeSettingCollectionIndex(folder.path, index);
    let fileCount = 0;
    for (const group of groups) {
      const targetPath = joinVaultPath(
        folder.path,
        this.settingGroupFolderPathName(group),
      );
      const target = await this.ensureFolder(targetPath);
      if (!target) {
        continue;
      }
      const sourcePath = path.join(sourceDir, group);
      fileCount += await this.importSettingFiles(sourcePath, target.path);
    }
    this.refreshSettingCollectionViews();
    new Notice(
      `Novel View：已导入 ${groups.length} 个设定分组、${fileCount} 个文件。`,
    );
    return { groups: groups.length, files: fileCount };
  }

  private async importSettingFiles(
    sourcePath: string,
    targetFolder: string,
  ): Promise<number> {
    let count = 0;
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(sourcePath, { withFileTypes: true });
    } catch (error) {
      console.debug("Novel View: setting import directory skipped", error);
      return 0;
    }
    for (const entry of entries) {
      if (entry.name.startsWith(".")) {
        continue;
      }
      const entryPath = path.join(sourcePath, entry.name);
      if (entry.isDirectory()) {
        const targetPath = joinVaultPath(targetFolder, entry.name);
        const child = await this.ensureFolder(targetPath);
        if (child) {
          count += await this.importSettingFiles(entryPath, child.path);
        }
        continue;
      }
      if (!entry.isFile()) {
        continue;
      }
      try {
        const targetPath = this.getUniqueFilePath(targetFolder, entry.name);
        const data = fs.readFileSync(entryPath);
        const buffer = data.buffer.slice(
          data.byteOffset,
          data.byteOffset + data.byteLength,
        ) as ArrayBuffer;
        await this.app.vault.createBinary(targetPath, buffer);
        count += 1;
      } catch (error) {
        console.error(`Novel View: setting import file failed: ${entryPath}`, error);
      }
    }
    return count;
  }

  getSettingCollectionFolder(novelRoot: string): TFolder | null {
    return this.getSettingGroupFolderForNovel(novelRoot);
  }

  async readSettingCollectionIndex(settingRoot: string): Promise<SettingCollectionIndex> {
    await this.ensureSettingCollection(settingRoot);
    const file = this.app.vault.getAbstractFileByPath(
      joinVaultPath(settingRoot, SETTING_COLLECTION_INDEX),
    );
    if (!(file instanceof TFile)) {
      return {};
    }
    try {
      return parseSettingCollectionIndex(
        JSON.parse(await this.app.vault.cachedRead(file)) as unknown,
      );
    } catch {
      return {};
    }
  }

  async writeSettingCollectionIndex(
    settingRoot: string,
    index: SettingCollectionIndex,
  ): Promise<void> {
    const indexPath = joinVaultPath(settingRoot, SETTING_COLLECTION_INDEX);
    const existing = this.app.vault.getAbstractFileByPath(indexPath);
    if (existing instanceof TFile) {
      await this.app.vault.process(
        existing,
        () => serializeSettingCollectionIndex(index),
      );
    } else {
      await this.app.vault.create(
        indexPath,
        serializeSettingCollectionIndex(index),
      );
    }
    await this.ensureSettingCollection(settingRoot);
    this.refreshSettingCollectionViews();
    void this.refreshSettingKeywordIndex();
  }

  private settingGroupFolderPathName(group: string): string {
    return `-${settingGroupFolderName(group)}`;
  }

  private settingDetailPrefix(keyword: string): string {
    return this.sanitizeFileBase(keyword, "设定");
  }

  private getSettingRecordFolder(
    novelRoot: string,
    group: string,
  ): TFolder | null {
    const settingFolder = this.getSettingGroupFolderForNovel(novelRoot);
    if (!settingFolder) {
      return null;
    }
    return this.getFolder(joinVaultPath(
      settingFolder.path,
      this.settingGroupFolderPathName(group),
    ));
  }

  getSettingRecordDetailFiles(
    novelRoot: string,
    group: string,
    keyword: string,
  ): TFile[] {
    const folder = this.getSettingRecordFolder(novelRoot, group);
    if (!folder) {
      return [];
    }
    const prefix = `${this.settingDetailPrefix(keyword)}-`;
    return this.app.vault.getFiles()
      .filter((file) => (
        file.extension === "md"
        && file.parent?.path === folder.path
        && file.basename.startsWith(prefix)
        && file.basename.length > prefix.length
      ))
      .sort((left, right) => left.basename.localeCompare(
        right.basename,
        "zh-CN",
        { numeric: true, sensitivity: "base" },
      ));
  }

  getSettingRecordDetailLabel(keyword: string, file: TFile): string {
    const prefix = `${this.settingDetailPrefix(keyword)}-`;
    return file.basename.startsWith(prefix)
      ? file.basename.slice(prefix.length)
      : file.basename;
  }

  async createSettingRecordDetail(
    novelRoot: string,
    group: string,
    keyword: string,
    title: string,
  ): Promise<TFile | null> {
    const settingFolder = this.getSettingGroupFolderForNovel(novelRoot);
    if (!settingFolder) {
      new Notice("Novel View：尚未构建设定集。");
      return null;
    }
    await this.ensureSettingCollection(settingFolder.path);
    let folder = this.getSettingRecordFolder(novelRoot, group);
    if (!folder) {
      const folderPath = joinVaultPath(
        settingFolder.path,
        this.settingGroupFolderPathName(group),
      );
      folder = await this.ensureFolder(folderPath);
    }
    if (!folder) {
      new Notice("Novel View：无法创建设定分组文件夹。");
      return null;
    }
    const base = `${this.settingDetailPrefix(keyword)}-${this.sanitizeFileBase(title, "详细")}`;
    let targetPath = joinVaultPath(folder.path, `${base}.md`);
    const existing = this.app.vault.getAbstractFileByPath(targetPath);
    if (existing instanceof TFile) {
      return existing;
    }
    let suffix = 2;
    while (this.app.vault.getAbstractFileByPath(targetPath)) {
      targetPath = joinVaultPath(folder.path, `${base} ${suffix}.md`);
      suffix += 1;
    }
    try {
      return await this.app.vault.create(targetPath, `# ${title.trim()}\n\n`);
    } catch (error) {
      console.error("Novel View: detail file creation failed", error);
      new Notice("Novel View：详细文件创建失败。");
      return null;
    }
  }

  async renameSettingRecordDetails(
    novelRoot: string,
    group: string,
    oldKeyword: string,
    newKeyword: string,
  ): Promise<void> {
    if (oldKeyword === newKeyword) {
      return;
    }
    const folder = this.getSettingRecordFolder(novelRoot, group);
    if (!folder) {
      return;
    }
    const oldPrefix = `${this.settingDetailPrefix(oldKeyword)}-`;
    const newPrefix = `${this.settingDetailPrefix(newKeyword)}-`;
    if (oldPrefix === newPrefix) {
      return;
    }
    const files = this.app.vault.getFiles().filter((file) => (
      file.extension === "md"
      && file.parent?.path === folder.path
      && file.basename.startsWith(oldPrefix)
      && file.basename.length > oldPrefix.length
    ));
    let index = 2;
    for (const file of files) {
      const suffix = file.basename.slice(oldPrefix.length);
      let targetPath = joinVaultPath(folder.path, `${newPrefix}${suffix}.md`);
      while (this.app.vault.getAbstractFileByPath(targetPath)) {
        targetPath = joinVaultPath(
          folder.path,
          `${newPrefix}${suffix} ${index}.md`,
        );
        index += 1;
      }
      try {
        await this.app.fileManager.renameFile(file, targetPath);
      } catch (error) {
        console.debug("Novel View: detail file rename skipped", error);
      }
    }
  }

  async moveSettingRecordDetails(
    novelRoot: string,
    sourceGroup: string,
    targetGroup: string,
    keyword: string,
  ): Promise<void> {
    if (sourceGroup === targetGroup) {
      return;
    }
    const sourceFolder = this.getSettingRecordFolder(novelRoot, sourceGroup);
    const targetFolder = this.getSettingRecordFolder(novelRoot, targetGroup);
    if (!sourceFolder || !targetFolder) {
      return;
    }
    const prefix = `${this.settingDetailPrefix(keyword)}-`;
    const files = this.app.vault.getFiles().filter((file) => (
      file.extension === "md"
      && file.parent?.path === sourceFolder.path
      && file.basename.startsWith(prefix)
    ));
    let index = 2;
    for (const file of files) {
      let targetPath = joinVaultPath(targetFolder.path, file.name);
      while (this.app.vault.getAbstractFileByPath(targetPath)) {
        targetPath = joinVaultPath(
          targetFolder.path,
          `${file.basename} ${index}.md`,
        );
        index += 1;
      }
      try {
        await this.app.fileManager.renameFile(file, targetPath);
      } catch (error) {
        console.debug("Novel View: detail file move skipped", error);
      }
    }
  }

  async renameSettingCollectionGroup(
    settingRoot: string,
    oldName: string,
    newName: string,
  ): Promise<string | null> {
    const index = await this.readSettingCollectionIndex(settingRoot);
    if (!Object.prototype.hasOwnProperty.call(index, oldName)) {
      return "设定分组不存在。";
    }
    if (oldName === newName) {
      return null;
    }
    if (Object.prototype.hasOwnProperty.call(index, newName)) {
      return "同名设定分组已存在。";
    }
    const oldFolderPath = joinVaultPath(
      settingRoot,
      this.settingGroupFolderPathName(oldName),
    );
    const newFolderPath = joinVaultPath(
      settingRoot,
      this.settingGroupFolderPathName(newName),
    );
    const oldFolder = this.getFolder(oldFolderPath);
    let renamed = false;
    if (oldFolder && oldFolderPath !== newFolderPath) {
      if (this.app.vault.getAbstractFileByPath(newFolderPath)) {
        return "同名设定分组文件夹已存在。";
      }
      this.suppressSettingGroupFolderRename = true;
      try {
        await this.app.fileManager.renameFile(oldFolder, newFolderPath);
      } finally {
        this.suppressSettingGroupFolderRename = false;
      }
      renamed = true;
    }
    const next: SettingCollectionIndex = {};
    for (const [name, tags] of Object.entries(index)) {
      next[name === oldName ? newName : name] = tags;
    }
    try {
      await this.writeSettingCollectionIndex(settingRoot, next);
      return null;
    } catch (error) {
      if (renamed) {
        const moved = this.getFolder(newFolderPath);
        if (moved) {
          this.suppressSettingGroupFolderRename = true;
          try {
            await this.app.fileManager.renameFile(moved, oldFolderPath);
          } finally {
            this.suppressSettingGroupFolderRename = false;
          }
        }
      }
      console.error("Novel View: setting-group rename failed", error);
      return "设定分组重命名失败。";
    }
  }

  revealSettingCollectionFolder(folder: TFolder): void {
    this.revealSettingGroup(folder);
  }

  private revealSettingGroup(folder: TFolder): void {
    const leaves = this.app.workspace.getLeavesOfType("file-explorer");
    const view = leaves[0]?.view as { revealInFolder?: (target: TFolder) => void };
    if (view?.revealInFolder) {
      try {
        view.revealInFolder(folder);
        return;
      } catch (error) {
        console.debug("Novel View: setting group reveal skipped", error);
      }
    }
    new Notice(`Novel View：设定集位于“${folder.path}”。`);
  }

  private scheduleSettingCollection(root: string): void {
    const normalized = this.normalizeFolderPath(root);
    const existing = this.settingCollectionTimers.get(normalized);
    if (existing !== undefined) {
      window.clearTimeout(existing);
    }
    const timer = window.setTimeout(() => {
      this.settingCollectionTimers.delete(normalized);
      void this.ensureSettingCollection(normalized);
    }, 120);
    this.settingCollectionTimers.set(normalized, timer);
  }

  private async mergeSettingGroupFolder(
    source: TFolder,
    target: TFolder,
  ): Promise<void> {
    for (const child of [...source.children]) {
      const targetPath = joinVaultPath(target.path, child.name);
      const existing = this.app.vault.getAbstractFileByPath(targetPath);
      if (child instanceof TFolder && existing instanceof TFolder) {
        await this.mergeSettingGroupFolder(child, existing);
        continue;
      }
      let destination = targetPath;
      if (existing) {
        destination = child instanceof TFolder
          ? this.getUniqueFolderPath(target.path, child.name)
          : this.getUniqueFilePath(target.path, child.name);
      }
      try {
        await this.app.fileManager.renameFile(child, destination);
      } catch (error) {
        console.debug("Novel View: setting folder merge skipped", error);
      }
    }
    if (source.children.length === 0) {
      await this.app.vault.delete(source, true);
    }
  }

  private async ensureSettingCollection(
    root: string,
  ): Promise<SettingCollectionIndex> {
    const normalized = this.normalizeFolderPath(root);
    if (this.ensuringSettingCollections.has(normalized)) {
      return {};
    }
    const folder = this.getFolder(normalized);
    if (!folder || !this.settingGroups.has(normalized)) {
      return {};
    }
    this.ensuringSettingCollections.add(normalized);
    try {
      const indexPath = joinVaultPath(normalized, SETTING_COLLECTION_INDEX);
      const indexFile = this.app.vault.getAbstractFileByPath(indexPath);
      let index: SettingCollectionIndex = {};
      if (!(indexFile instanceof TFile)) {
        const inferred: SettingCollectionIndex = {};
        for (const child of folder.children) {
          if (child instanceof TFolder) {
            const name = child.name.replace(/^-+/u, "").trim();
            if (name) {
              inferred[name] = [];
            }
          }
        }
        index = inferred;
        await this.app.vault.create(
          indexPath,
          serializeSettingCollectionIndex(index),
        );
      } else {
        try {
          index = parseSettingCollectionIndex(
            JSON.parse(await this.app.vault.cachedRead(indexFile)) as unknown,
          );
        } catch (error) {
          console.debug("Novel View: invalid setting collection index", error);
          return {};
        }
      }

      const desiredFolders = new Set<string>();
      for (const groupName of Object.keys(index)) {
        const baseName = settingGroupFolderName(groupName);
        const folderName = `-${baseName}`;
        desiredFolders.add(folderName);
        const groupPath = joinVaultPath(normalized, folderName);
        const legacyPath = joinVaultPath(normalized, baseName);
        const legacyFolder = this.getFolder(legacyPath);
        const targetFolder = this.getFolder(groupPath);
        if (legacyFolder && !targetFolder) {
          this.suppressSettingGroupFolderRename = true;
          try {
            await this.app.fileManager.renameFile(legacyFolder, groupPath);
          } finally {
            this.suppressSettingGroupFolderRename = false;
          }
        } else if (legacyFolder && targetFolder) {
          this.suppressSettingGroupFolderRename = true;
          try {
            await this.mergeSettingGroupFolder(legacyFolder, targetFolder);
          } finally {
            this.suppressSettingGroupFolderRename = false;
          }
        }
        if (!(this.app.vault.getAbstractFileByPath(groupPath) instanceof TFolder)) {
          if (!this.app.vault.getAbstractFileByPath(groupPath)) {
            await this.app.vault.createFolder(groupPath);
          }
        }
      }
      for (const child of [...folder.children]) {
        if (
          child instanceof TFolder
          && !desiredFolders.has(child.name)
        ) {
          await this.app.vault.delete(child, true);
        }
      }
      this.refreshSettingCollectionViews();
      return index;
    } finally {
      this.ensuringSettingCollections.delete(normalized);
    }
  }

  private registerSettingGroupFolder(path: string): boolean {
    const folder = this.getFolder(path);
    if (!folder || !folder.name.startsWith("-")) {
      return false;
    }
    const parent = folder.parent;
    if (!parent) {
      return false;
    }
    const novelRoot = this.findNovelGroupRoot(
      this.normalizeFolderPath(parent.path),
    );
    if (!novelRoot || this.normalizeFolderPath(parent.path) !== novelRoot) {
      return false;
    }
    this.settingGroups.set(this.normalizeFolderPath(folder.path), novelRoot);
    this.scheduleNovelFolderDecoration();
    window.setTimeout(() => {
      this.expandNovelGroupFolders();
      this.scheduleNovelFolderDecoration();
    }, 80);
    return true;
  }

  private handleSettingGroupPathChange(
    newPath: string | null,
    oldPath: string | null,
  ): void {
    if (this.suppressSettingGroupFolderRename) {
      return;
    }
    if (newPath && oldPath && this.isSettingGroupFolderPath(newPath, oldPath)) {
      void this.handleSettingGroupFolderRename(oldPath, newPath);
      return;
    }
    const roots = new Set<string>();
    if (newPath && this.registerSettingGroupFolder(newPath)) {
      roots.add(this.normalizeFolderPath(newPath));
    }
    if (oldPath) {
      const oldRoot = this.settingRootForPath(oldPath);
      if (oldRoot) {
        roots.add(oldRoot);
      }
      if (this.settingGroups.has(oldPath)) {
        const novelRoot = this.settingGroups.get(oldPath);
        this.settingGroups.delete(oldPath);
        if (newPath && novelRoot) {
          this.settingGroups.set(newPath, novelRoot);
          roots.add(newPath);
        }
        this.scheduleNovelFolderDecoration();
      }
    }
    if (newPath) {
      const newRoot = this.settingRootForPath(newPath);
      if (newRoot) {
        roots.add(newRoot);
      }
    }
    for (const root of roots) {
      this.scheduleSettingCollection(root);
    }
  }

  private isSettingGroupFolderPath(newPath: string, oldPath: string): boolean {
    const settingRoot = this.settingRootForPath(oldPath);
    if (!settingRoot || this.settingRootForPath(newPath) !== settingRoot) {
      return false;
    }
    if (oldPath === settingRoot || newPath === settingRoot) {
      return false;
    }
    if (path.posix.dirname(oldPath) !== settingRoot) {
      return false;
    }
    if (path.posix.dirname(newPath) !== settingRoot) {
      return false;
    }
    return this.getFolder(newPath) instanceof TFolder;
  }

  private async handleSettingGroupFolderRename(
    oldPath: string,
    newPath: string,
  ): Promise<void> {
    const settingRoot = this.settingRootForPath(oldPath);
    if (!settingRoot) {
      return;
    }
    const indexFile = this.app.vault.getAbstractFileByPath(
      joinVaultPath(settingRoot, SETTING_COLLECTION_INDEX),
    );
    if (!(indexFile instanceof TFile)) {
      this.scheduleSettingCollection(settingRoot);
      return;
    }
    let index: SettingCollectionIndex;
    try {
      index = parseSettingCollectionIndex(
        JSON.parse(await this.app.vault.cachedRead(indexFile)) as unknown,
      );
    } catch (error) {
      console.debug("Novel View: setting group rename index read failed", error);
      return;
    }
    const oldFolderName = path.posix.basename(oldPath).replace(/^-+/u, "").trim();
    const oldKey = Object.keys(index).find((key) => (
      settingGroupFolderName(key) === settingGroupFolderName(oldFolderName)
    ));
    if (!oldKey) {
      this.scheduleSettingCollection(settingRoot);
      return;
    }
    const newName = path.posix.basename(newPath).replace(/^-+/u, "").trim();
    if (!newName) {
      await this.revertSettingGroupFolder(newPath, settingRoot, oldKey);
      return;
    }
    if (newName !== oldKey && Object.prototype.hasOwnProperty.call(index, newName)) {
      new Notice(`Novel View：设定分组“${newName}”已存在。`);
      await this.revertSettingGroupFolder(newPath, settingRoot, oldKey);
      return;
    }
    const desiredPath = joinVaultPath(
      settingRoot,
      this.settingGroupFolderPathName(newName),
    );
    const currentFolder = this.getFolder(newPath);
    if (currentFolder && currentFolder.path !== desiredPath) {
      if (this.app.vault.getAbstractFileByPath(desiredPath)) {
        new Notice(`Novel View：设定分组文件夹“${newName}”已存在。`);
        await this.revertSettingGroupFolder(newPath, settingRoot, oldKey);
        return;
      }
      this.suppressSettingGroupFolderRename = true;
      try {
        await this.app.fileManager.renameFile(currentFolder, desiredPath);
      } catch (error) {
        console.error("Novel View: setting group folder prefix failed", error);
        return;
      } finally {
        this.suppressSettingGroupFolderRename = false;
      }
    }
    const next: SettingCollectionIndex = {};
    for (const [name, tags] of Object.entries(index)) {
      next[name === oldKey ? newName : name] = tags;
    }
    await this.writeSettingCollectionIndex(settingRoot, next);
    this.refreshSettingCollectionViews();
  }

  private async revertSettingGroupFolder(
    currentPath: string,
    settingRoot: string,
    oldKey: string,
  ): Promise<void> {
    const current = this.getFolder(currentPath);
    const targetPath = joinVaultPath(
      settingRoot,
      this.settingGroupFolderPathName(oldKey),
    );
    if (!current || current.path === targetPath) {
      return;
    }
    if (this.app.vault.getAbstractFileByPath(targetPath)) {
      return;
    }
    this.suppressSettingGroupFolderRename = true;
    try {
      await this.app.fileManager.renameFile(current, targetPath);
    } catch (error) {
      console.debug("Novel View: setting group folder revert skipped", error);
    } finally {
      this.suppressSettingGroupFolderRename = false;
    }
  }

  private expandNovelGroupFolders(): void {
    const roots = new Set(this.settingGroups.values());
    for (const novelRoot of roots) {
      const title = document.querySelector<HTMLElement>(
        `.nav-folder-title[data-path="${CSS.escape(novelRoot)}"]`,
      );
      const folder = title?.closest<HTMLElement>(".nav-folder");
      if (!folder?.classList.contains("is-collapsed")) {
        continue;
      }
      const toggle = title?.querySelector<HTMLElement>(
        ".nav-folder-collapse-indicator, .collapse-icon",
      ) ?? title;
      if (!toggle) {
        continue;
      }
      this.allowNovelFolderToggle = true;
      try {
        toggle.dispatchEvent(new MouseEvent("click", {
          bubbles: true,
          cancelable: true,
        }));
      } finally {
        this.allowNovelFolderToggle = false;
      }
    }
  }

  decorateNovelFolderTitles(): void {
    (LegacyNovelViewPlugin.prototype as any).decorateNovelFolderTitles.call(this);
    for (const title of document.querySelectorAll<HTMLElement>(
      ".nav-folder-title[data-path]",
    )) {
      const folderPath = title.dataset.path;
      if (!folderPath) {
        continue;
      }
      const isSetting = this.settingGroups.has(
        this.normalizeFolderPath(folderPath),
      );
      title.toggleClass("novelview-setting-folder-title", isSetting);
      title.closest(".nav-folder")?.toggleClass(
        "novelview-setting-folder",
        isSetting,
      );
      if (isSetting) {
        const walker = document.createTreeWalker(title, NodeFilter.SHOW_TEXT);
        let node = walker.nextNode();
        while (node) {
          if (node.nodeValue?.startsWith("-")) {
            node.nodeValue = node.nodeValue.replace(/^-+/u, "");
          }
          node = walker.nextNode();
        }
      }
    }
    if (this.settingGroups.size > 0) {
      this.expandNovelGroupFolders();
    }
  }

  addNovelGroupMenuItem(menu: Menu, target: any): void {
    if (
      target instanceof TFolder
      && target.name.startsWith("-")
      && !this.getNovelSettingFile(target.path)
    ) {
      return;
    }
    (LegacyNovelViewPlugin.prototype as any)
      .addNovelGroupMenuItem.call(this, menu, target);
    if (!(target instanceof TFolder) || !this.getNovelSettingFile(target.path)) {
      return;
    }
    const setting = this.getSettingGroupFolderForNovel(target.path);
    if (setting) {
      menu.addItem((item) => {
        item
          .setTitle("打开设定集")
          .setIcon("folder-open")
          .onClick(() => this.revealSettingGroup(setting));
      });
      return;
    }
    menu.addItem((item) => {
      item
        .setTitle("构建设定集")
        .setIcon("folder-plus")
        .onClick(() => {
          void this.createSettingGroup(target.path);
        });
    });
  }

  isReservedNovelFolder(name: string): boolean {
    return name.startsWith("-")
      || /^(src|设定|伏笔|人物|时间线|分散卷)$/iu.test(name);
  }

  async exportNovelGroup(folderPath: string): Promise<void> {
    const group = this.getFolder(folderPath);
    const info = this.getNovelGroupInfo(folderPath);
    if (!group || !info) {
      new Notice("Novel View：未找到小说组。");
      return;
    }
    const files: TFile[] = [];
    const collect = (current: TFolder): void => {
      for (const child of current.children) {
        if (child instanceof TFolder) {
          if (this.isReservedNovelFolder(child.name)) {
            continue;
          }
          collect(child);
        } else if (
          child instanceof TFile
          && child.extension === "md"
          && !this.isSpecialNovelFile(child)
        ) {
          files.push(child);
        }
      }
    };
    collect(group);
    if (files.length === 0) {
      new Notice("Novel View：小说组中没有可导出的章节。");
      return;
    }
    await this.exportTxtFiles(files, `${info.name}-合并稿`);
  }

  async createNovelGroup(folder: TFolder): Promise<void> {
    const folderPath = this.normalizeFolderPath(folder.path);
    if (folder.name.startsWith("-")) {
      new Notice("Novel View：以 - 开头的文件夹保留给设定集，不能构建小说组。");
      return;
    }
    if (folderPath === "/") {
      new Notice("Novel View：仓库根目录不能设置为小说组。");
      return;
    }
    const settingPath = getNovelConfigPath(folderPath);
    const existing = this.app.vault.getAbstractFileByPath(settingPath);
    if (existing instanceof TFile && isNovelConfigFile(existing)) {
      this.workbenchFolderPath = folderPath;
      await this.openArticleList(folderPath);
      await this.activateWorkbench();
      this.refreshWorkbenchViews();
      return;
    }
    if (existing) {
      new Notice("Novel View：无法创建 novel.json，同名路径已存在。");
      return;
    }
    try {
      await this.app.vault.create(settingPath, createNovelConfigContent());
      this.novelConfigs.set(folderPath, parseNovelConfig({}));
      this.workbenchFolderPath = folderPath;
      await this.openArticleList(folderPath);
      await this.activateWorkbench();
      this.refreshOpenViews();
      new Notice(`Novel View：已创建小说组“${folder.name}”。`);
    } catch (error) {
      console.error("Novel View: failed to create novel group", error);
      new Notice("Novel View：小说组创建失败。");
    }
  }

  private getContiguousArticleSelection(
    folderPath: string,
    targets: ArticleListTarget[],
  ): { volume: string; paths: string[] } | null {
    if (targets.length === 0) {
      return null;
    }
    const model = this.getArticleListModel(folderPath);
    if (!model) {
      return null;
    }
    const sections: Array<{ volume: string; articles: any[] }> = [
      { volume: "", articles: model.articles },
      ...model.volumes.map((volume: any) => ({
        volume: volume.name,
        articles: volume.articles,
      })),
    ];
    const selected = new Set(targets.map((target) => target.path));
    for (const section of sections) {
      const indexes = section.articles
        .map((article: any, index: number) => selected.has(article.path) ? index : -1)
        .filter((index: number) => index >= 0);
      if (indexes.length !== selected.size || indexes.length === 0) {
        continue;
      }
      const first = indexes[0];
      const last = indexes[indexes.length - 1];
      if (last - first + 1 === indexes.length) {
        return {
          volume: section.volume,
          paths: section.articles.slice(first, last + 1).map((article: any) => article.path),
        };
      }
    }
    return null;
  }

  showArticleListContextMenu(
    event: MouseEvent,
    folderPath: string,
    contextPath: string,
    refresh: () => void,
    targets: ArticleListTarget[] = [],
    onRename?: () => void,
  ): void {
    const menu = new Menu();
    if (targets.length > 0) {
      if (targets.length === 1 && onRename) {
        menu.addItem((item) => {
          item.setTitle("重命名").setIcon("pencil").onClick(onRename);
        });
      }
      const menuPosition = { x: event.clientX, y: event.clientY };
      const articleTargets = targets.filter((target) => target.kind === "article");
      if (targets.length > 1 && articleTargets.length > 0) {
        menu.addItem((item) => {
          item.setTitle("导出所选章节为 TXT").setIcon("download").onClick(() => {
            void this.exportChapterTargets(articleTargets, folderPath);
          });
        });
      }
      if (targets.length === 1 && targets[0].kind === "article") {
        menu.addItem((item) => {
          item.setTitle("导出为 TXT").setIcon("download").onClick(() => {
            void this.exportChapterTargets([targets[0]], folderPath);
          });
        });
      }
      if (targets.length === 1 && targets[0].kind === "volume") {
        const volumeTarget = targets[0];
        menu.addItem((item) => {
          item.setTitle("新建文章").setIcon("file-plus").onClick(() => {
            void this.createArticleInFolder(
              folderPath,
              volumeTarget.path,
              "无标题",
            ).then(refresh);
          });
        });
        menu.addItem((item) => {
          item.setTitle("编辑").setIcon("pencil").onClick(() => {
            const config = this.getNovelConfig(folderPath);
            const meta = config.volumes[volumeTarget.title] ?? { description: "", cover: "" };
            new VolumeEditModal(this.app, {
              folderPath,
              volume: volumeTarget.title,
              description: meta.description,
              coverUrl: meta.cover
                ? this.getNovelCoverUrl(folderPath, meta.cover)
                : null,
              onSave: (description) => {
                void this.updateVolumeMeta(folderPath, volumeTarget.title, {
                  description,
                }).then(refresh);
              },
              onPickCover: () => {
                void this.editNovelVolumeCover(
                  folderPath,
                  volumeTarget.title,
                ).then(refresh);
              },
            }).open();
          });
        });
        menu.addItem((item) => {
          item.setTitle("导出本卷为 TXT").setIcon("download").onClick(() => {
            void this.exportVolumeTarget(targets[0], folderPath);
          });
        });
      }
      if (articleTargets.length > 0) {
        menu.addItem((item) => {
          item.setTitle("修改状态").setIcon("circle-dot").onClick((event) => {
            const statusMenu = new Menu();
            for (const status of (Object.keys(CHAPTER_STATUS_LABELS) as ChapterStatus[])) {
              statusMenu.addItem((sub) => {
                sub.setTitle(CHAPTER_STATUS_LABELS[status]).onClick(() => {
                  for (const target of articleTargets) {
                    const file = this.app.vault.getAbstractFileByPath(target.path);
                    if (file instanceof TFile) {
                      void this.setChapterStatus(file, status);
                    }
                  }
                  refresh();
                });
              });
            }
            statusMenu.showAtPosition(menuPosition);
          });
        });
      }
      const contiguous = articleTargets.length > 1
        ? this.getContiguousArticleSelection(folderPath, articleTargets)
        : null;
      if (contiguous) {
        menu.addItem((item) => {
          item.setTitle("归入文章组").setIcon("box-select").onClick(() => {
            new ArticleGroupModal(
              this.app,
              { name: "", description: "" },
              (draft) => {
                void this.saveArticleGroup(folderPath, {
                  volume: contiguous.volume,
                  name: draft.name,
                  description: draft.description,
                  paths: contiguous.paths,
                }).then(refresh);
              },
            ).open();
          });
        });
      }
      if (targets.length === 1 && articleTargets.length === 1) {
        const group = this.getArticleGroupForPath(folderPath, articleTargets[0].path);
        if (group) {
          menu.addItem((item) => {
            item.setTitle("移出文章组").setIcon("ungroup").onClick(() => {
              const index = group.paths.indexOf(articleTargets[0].path);
              if (index < 0) {
                return;
              }
              const removeMenu = new Menu();
              removeMenu.addItem((sub) => {
                sub.setTitle("以下").setIcon("arrow-down").onClick(() => {
                  void this.removeArticlesFromGroup(
                    folderPath,
                    group.id,
                    group.paths.slice(index),
                  ).then(refresh);
                });
              });
              removeMenu.addItem((sub) => {
                sub.setTitle("以上").setIcon("arrow-up").onClick(() => {
                  void this.removeArticlesFromGroup(
                    folderPath,
                    group.id,
                    group.paths.slice(0, index + 1),
                  ).then(refresh);
                });
              });
              removeMenu.showAtPosition(menuPosition);
            });
          });
        }
      }
      menu.addItem((item) => {
        item.setTitle(targets.length === 1 ? "删除" : `删除 ${targets.length} 项`)
          .setIcon("trash")
          .onClick(() => {
            void this.deleteArticleTargets(targets, refresh);
          });
      });
      menu.showAtMouseEvent(event);
      return;
    }
    menu.addItem((item) => {
      item.setTitle("新建文章").setIcon("file-plus").onClick(() => {
        void this.createArticleInFolder(folderPath, contextPath, "无标题")
          .then(refresh);
      });
    });
    menu.addItem((item) => {
      item.setTitle("新建卷").setIcon("folder-plus").onClick(() => {
        void this.createVolumeInFolder(folderPath).then(refresh);
      });
    });
    menu.showAtMouseEvent(event);
  }

  handleNovelFolderClick(event: MouseEvent): void {
    if (this.allowNovelFolderToggle) {
      return;
    }
    const target = event.target as HTMLElement | null;
    if (!target) {
      return;
    }
    const folderTitle = target.closest<HTMLElement>(".nav-folder-title");
    const path = folderTitle?.dataset.path
      ?? folderTitle?.closest<HTMLElement>(".nav-folder")?.dataset.path;
    if (!folderTitle || !path) {
      return;
    }
    const folder = this.app.vault.getAbstractFileByPath(path);
    if (!(folder instanceof TFolder) || !this.getNovelSettingFile(folder.path)) {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    this.workbenchFolderPath = this.normalizeFolderPath(folder.path);
    void this.openArticleList(folder.path).then(() => {
      const workbenches = this.app.workspace.getLeavesOfType(WORKBENCH_VIEW_TYPE);
      if (workbenches.length === 0) {
        void this.activateWorkbench();
      } else {
        this.refreshWorkbenchViews();
      }
    });
  }

  isForcedNovelMode(_file: TFile): boolean {
    return false;
  }

  isNovelArticleFile(file: TFile): boolean {
    if (
      file.extension !== "md"
      || this.isSpecialNovelFile(file)
      || this.settingRootForPath(file.path)
    ) {
      return false;
    }
    const root = this.findNovelGroupRoot(
      this.normalizeFolderPath(file.parent?.path ?? "/"),
    );
    return Boolean(root);
  }

  private clearNativeNovelModeStyles(): void {
    for (const leaf of this.app.workspace.getLeavesOfType("markdown")) {
      if (!(leaf.view instanceof MarkdownView)) {
        continue;
      }
      const view = leaf.view;
      const classes = ["novelview-novel-mode", "novelview-paragraph-mode-line",
        "novelview-paragraph-mode-blank-line", "novelview-hide-markers",
        "novelview-hide-line-numbers"];
      for (const cls of classes) {
        view.contentEl.removeClass(cls);
      }
      try {
        this.syncFloatingToolbar(view, false);
      } catch (error) {
        console.debug("Novel View: native toolbar cleanup skipped", error);
      }
    }
  }

  private routeNovelFileOpen(file: TFile): void {
    if (this.routingNovelFile) {
      return;
    }
    if (!this.isNovelArticleFile(file)) {
      return;
    }
    const leaf = this.app.workspace.activeLeaf;
    if (!leaf || leaf.view instanceof NovelEditorView) {
      return;
    }
    if (!(leaf.view instanceof MarkdownView)) {
      return;
    }
    this.routingNovelFile = true;
    window.setTimeout(() => {
      void leaf.setViewState({
        type: NOVEL_EDITOR_VIEW_TYPE,
        state: { file: file.path, line: 1 },
        active: true,
      }).finally(() => {
        this.routingNovelFile = false;
      });
    }, 0);
  }

  async openNovelEditor(file: TFile, line = 1): Promise<void> {
    const workspace = this.app.workspace as typeof this.app.workspace & {
      getMostRecentLeaf?: (root: unknown) => WorkspaceLeaf | null;
    };
    const leaf = workspace.getMostRecentLeaf?.(this.app.workspace.rootSplit)
      ?? this.app.workspace.getLeaf("tab");
    this.routingNovelFile = true;
    try {
      await leaf.setViewState({
        type: NOVEL_EDITOR_VIEW_TYPE,
        state: { file: file.path, line },
        active: true,
      });
      await this.app.workspace.revealLeaf(leaf);
    } finally {
      this.routingNovelFile = false;
    }
  }

  setNovelEditorFile(file: TFile): void {
    this.lastActiveMarkdownPath = file.path;
    const root = this.findNovelGroupRoot(
      this.normalizeFolderPath(file.parent?.path ?? "/"),
    );
    if (root) {
      this.workbenchFolderPath = root;
    }
    void this.refreshSettingKeywordIndex();
    this.refreshWorkbenchViews();
  }

  syncArticleStatus(view: MarkdownView, enabled: boolean): void {
    this.destroyArticleStatus(view);
    try {
      const editorView = (view.editor as any)?.cm;
      if (editorView) {
        setFrontmatterProtection(editorView, enabled);
      }
    } catch (error) {
      console.debug("Novel View: frontmatter protection sync skipped", error);
    }
    if (enabled) {
      this.ensureNovelSourceMode(view);
    }
  }

  private ensureAllNovelSourceModes(): void {
    for (const leaf of this.app.workspace.getLeavesOfType("markdown")) {
      if (!(leaf.view instanceof MarkdownView)) {
        continue;
      }
      if (this.isNovelModeEnabled(leaf.view)) {
        this.ensureNovelSourceMode(leaf.view);
      }
    }
  }

  private ensureNovelSourceMode(view: MarkdownView): void {
    try {
      const editorView = (view.editor as any)?.cm;
      if (editorView) {
        setFrontmatterProtection(editorView, true);
      }
    } catch (error) {
      console.debug("Novel View: frontmatter protection sync skipped", error);
    }
    const leaf = (view as any).leaf as WorkspaceLeaf | undefined;
    if (!leaf || this.forcingSourceLeaves.has(leaf)) {
      return;
    }
    const now = Date.now();
    if (now - (this.sourceModeAttempts.get(leaf) ?? 0) < 3000) {
      return;
    }
    this.sourceModeAttempts.set(leaf, now);
    const viewState = leaf.getViewState();
    const state = viewState.state as Record<string, unknown>;
    if (state.mode === "source" && state.source === true) {
      return;
    }
    const scroller = view.containerEl.querySelector<HTMLElement>(".cm-scroller");
    const scrollTop = scroller?.scrollTop ?? 0;
    this.forcingSourceLeaves.add(leaf);
    void leaf.setViewState({
      ...viewState,
      type: "markdown",
      state: {
        ...state,
        mode: "source",
        source: true,
      },
      active: true,
    }).finally(() => {
      this.forcingSourceLeaves.delete(leaf);
      window.setTimeout(() => {
        const next = view.containerEl.querySelector<HTMLElement>(".cm-scroller");
        if (next) {
          next.scrollTop = scrollTop;
        }
      }, 30);
    });
  }

  async openSettingCollection(
    folderPath: string,
    focus?: { group: string; tag: string; keyword: string },
  ): Promise<void> {
    const novelRoot = this.findNovelGroupRoot(folderPath)
      ?? this.normalizeFolderPath(folderPath);
    const settingFolder = this.getSettingGroupFolderForNovel(novelRoot);
    if (settingFolder) {
      await this.ensureSettingCollection(settingFolder.path);
    }
    const existing = this.app.workspace.getLeavesOfType(
      SETTING_COLLECTION_VIEW_TYPE,
    )[0];
    const leaf = existing
      ?? this.app.workspace.getRightLeaf(false)
      ?? this.app.workspace.getRightLeaf(true);
    if (!leaf) {
      new Notice("Novel View：无法打开设定集。");
      return;
    }
    await leaf.setViewState({
      type: SETTING_COLLECTION_VIEW_TYPE,
      state: { folderPath: novelRoot },
      active: true,
    });
    await this.app.workspace.revealLeaf(leaf);
    if (focus && leaf.view instanceof SettingCollectionView) {
      leaf.view.focusRecord(focus.group, focus.tag, focus.keyword);
    }
  }

  async openSettingRecord(
    sourcePath: string,
    group: string,
    tag: string,
    keyword: string,
  ): Promise<void> {
    const root = this.findNovelGroupRoot(
      this.normalizeFolderPath(sourcePath.split("/").slice(0, -1).join("/")),
    );
    if (!root) {
      return;
    }
    await this.openSettingCollection(root, { group, tag, keyword });
  }

  async openNovelSrcGallery(folderPath: string): Promise<void> {
    const existing = this.app.workspace.getLeavesOfType(SRC_GALLERY_VIEW_TYPE)[0];
    const leaf = existing
      ?? this.app.workspace.getRightLeaf(false)
      ?? this.app.workspace.getRightLeaf(true);
    if (!leaf) {
      new Notice("Novel View：无法打开素材库。");
      return;
    }
    await leaf.setViewState({
      type: SRC_GALLERY_VIEW_TYPE,
      state: { folderPath: this.normalizeFolderPath(folderPath) },
      active: true,
    });
    await this.app.workspace.revealLeaf(leaf);
  }

  async importMaterialImage(folderPath: string, file: File): Promise<void> {
    const root = this.normalizeFolderPath(folderPath);
    const srcPath = joinVaultPath(root, "src");
    const folder = await this.ensureFolder(srcPath);
    if (!folder) {
      new Notice("Novel View：无法创建素材库目录。");
      return;
    }
    const base = file.name.replace(/\.[^.]+$/u, "");
    const extension = file.name.slice(base.length);
    const path = this.getUniqueFilePath(srcPath, `${base}${extension}`);
    await this.app.vault.createBinary(path, await file.arrayBuffer());
    new Notice(`Novel View：已导入素材“${file.name}”。`);
  }

}


function historyBucketStart(timestamp: number): number {
  const date = new Date(timestamp);
  date.setHours(Math.floor(date.getHours() / 4) * 4, 0, 0, 0);
  return date.getTime();
}
