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
  getLinkKeywordEntries,
  LINK_LIBRARY_JSON,
  parseLinkLibrary,
  serializeLinkLibrary,
  type LinkLibraryData,
} from "./core/link-library";
import { countNovelCharacters } from "./core/status";
import { findFrontmatterEnd } from "./core/paragraphs";
import { formatNovelMarkdown } from "./core/format";
import {
  createNovelConfigContent,
  getNovelConfigPath,
  isNovelConfigFile,
  joinVaultPath,
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
  LinkLibraryView,
  LINK_LIBRARY_VIEW_TYPE,
} from "./link-library-view";
import {
  NovelWorkbenchView,
  WORKBENCH_VIEW_TYPE,
} from "./workbench-view";
import {
  linkKeywordExtension,
  refreshLinkKeywords,
  setLinkKeywords,
} from "./editor/link-keyword-extension";
import { NovelFloatingToolbar } from "./editor/floating-toolbar";
import { ModeSettingsPanel } from "./mode-settings-panel";
import { SearchPanelV2 } from "./search-panel-v2";
import { SectionToc } from "./section-toc";
import { linkKeywordsInElement } from "./link-keyword-dom";

interface ChapterMeta {
  wordCount: number;
  status: ChapterStatus;
}

export default class NovelViewPlugin extends LegacyNovelViewPlugin {
  [key: string]: any;

  private readonly chapterMetaCache = new Map<string, ChapterMeta>();
  private readonly sectionTocs = new Map<MarkdownView, SectionToc>();
  private readonly articleUndoStack: Array<() => Promise<void>> = [];
  private readonly novelConfigs = new Map<string, NovelConfig>();
  private searchPanelV2: SearchPanelV2 | null = null;
  private readonly readingPositions = new Map<string, number>();
  private keywordTooltip: HTMLElement | null = null;
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
      if (type === LINK_LIBRARY_VIEW_TYPE) {
        originalRegisterView(type, (leaf: WorkspaceLeaf) => (
          new LinkLibraryView(leaf, this)
        ));
        return;
      }
      if (type === WORKBENCH_VIEW_TYPE) {
        originalRegisterView(type, (leaf: WorkspaceLeaf) => (
          new NovelWorkbenchView(leaf, this)
        ));
        return;
      }
      originalRegisterView(type, factory);
    };

    await super.onload();
    this.registerView = originalRegisterView;
    this.settings.fontSize ??= 16;
    this.registerEditorExtension(linkKeywordExtension);
    await this.migrateNovelConfigs();
    await this.loadNovelConfigs();
    this.registerEvent(this.app.vault.on("rename", (_file, oldPath) => {
      void this.handleArticlePathChange(oldPath, _file.path);
    }));
    this.registerEvent(this.app.vault.on("delete", (file) => {
      void this.handleArticlePathDeleted(file.path);
    }));
    this.registerDomEvent(document, "mouseover", (event) => {
      const target = (event.target as HTMLElement | null)?.closest<HTMLElement>(
        ".novelview-link-keyword",
      );
      if (target) {
        this.showKeywordTooltip(target);
      }
    });
    this.registerDomEvent(document, "mouseout", (event) => {
      const target = (event.target as HTMLElement | null)?.closest<HTMLElement>(
        ".novelview-link-keyword",
      );
      if (!target) {
        return;
      }
      const related = event.relatedTarget as Node | null;
      if (!related || !target.contains(related)) {
        this.hideKeywordTooltip();
      }
    });
    this.registerDomEvent(document, "scroll", () => this.hideKeywordTooltip(), true);
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

  private showKeywordTooltip(target: HTMLElement): void {
    const name = target.dataset.novelviewLinkName;
    if (!name) {
      return;
    }
    this.hideKeywordTooltip();
    const tooltip = createDiv({ cls: "novelview-link-keyword-tooltip" });
    const file = tooltip.createDiv({ cls: "novelview-link-keyword-tooltip-row" });
    file.createSpan({ text: "文件：" });
    file.createSpan({
      cls: "novelview-link-keyword-tooltip-value",
      text: name,
    });
    const tag = tooltip.createDiv({ cls: "novelview-link-keyword-tooltip-row" });
    tag.createSpan({ text: "标签：" });
    tag.createSpan({
      cls: "novelview-link-keyword-tooltip-value",
      text: target.dataset.novelviewLinkTag ?? "",
    });
    const group = tooltip.createDiv({ cls: "novelview-link-keyword-tooltip-row" });
    group.createSpan({ text: "联动组：" });
    group.createSpan({
      cls: "novelview-link-keyword-tooltip-value",
      text: target.dataset.novelviewLinkGroup ?? "",
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
    tooltip.style.left = `${left}px`;
    tooltip.style.top = `${top}px`;
    this.keywordTooltip = tooltip;
  }

  private hideKeywordTooltip(): void {
    this.keywordTooltip?.remove();
    this.keywordTooltip = null;
  }

  async refreshLinkKeywordIndex(): Promise<void> {
    const current = this.getLastActiveMarkdownFile();
    if (!current) {
      setLinkKeywords([]);
      refreshLinkKeywords();
      return;
    }
    const root = this.findNovelGroupRoot(
      this.normalizeFolderPath(current.parent?.path ?? "/"),
    );
    if (!root) {
      setLinkKeywords([]);
      refreshLinkKeywords();
      return;
    }
    const data = await this.readLinkLibrary(root);
    setLinkKeywords(getLinkKeywordEntries(data));
    refreshLinkKeywords();
  }

  decorateReadingLinkKeywords(
    element: HTMLElement,
    sourcePath: string,
  ): void {
    const source = this.app.vault.getAbstractFileByPath(sourcePath);
    if (!(source instanceof TFile) || !this.isForcedNovelMode(source)) {
      return;
    }
    const root = this.findNovelGroupRoot(
      this.normalizeFolderPath(source.parent?.path ?? "/"),
    );
    if (!root) {
      return;
    }
    void this.readLinkLibrary(root).then((data) => {
      if (element.isConnected) {
        linkKeywordsInElement(element, getLinkKeywordEntries(data));
      }
    });
  }

  onunload(): void {
    this.hideKeywordTooltip();
    this.clearArticleDrag();
    for (const toc of this.sectionTocs.values()) {
      toc.destroy();
    }
    this.sectionTocs.clear();
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

  ensureViewAction(view: MarkdownView): void {
    if (this.observedViews.has(view)) {
      return;
    }
    this.observedViews.add(view);
    view.containerEl.addEventListener("click", (event) => {
      const target = event.target as HTMLElement | null;
      const keyword = target?.closest<HTMLElement>(".novelview-link-keyword");
      if (keyword) {
        const path = keyword.getAttribute("data-novelview-link-path");
        if (path && view.file) {
          event.preventDefault();
          event.stopPropagation();
          this.openLinkKeywordTarget(path, view.file);
          return;
        }
      }
    }, true);
  }

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
  }

  applyModeStyles(contentEl: HTMLElement): void {
    (LegacyNovelViewPlugin.prototype as any).applyModeStyles.call(this, contentEl);
    contentEl.style.setProperty(
      "--novelview-font-size",
      `${Number(this.settings.fontSize) || 16}px`,
    );
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
    const parts: string[] = [];
    for (const file of files) {
      const raw = await this.app.vault.cachedRead(file);
      parts.push(this.toPlainText(raw, file.basename));
    }
    const safeName = suggestedName.replace(/[\\/:*?"<>|]/gu, "-").trim() || "导出";
    let target = path.join(targetDir, `${safeName}.txt`);
    let index = 2;
    while (fs.existsSync(target)) {
      target = path.join(targetDir, `${safeName}-${index}.txt`);
      index += 1;
    }
    fs.writeFileSync(target, parts.join("\n\n"), "utf8");
    new Notice(`Novel View：已导出到 ${target}`);
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

  private toPlainText(content: string, title: string): string {
    const source = content.replace(/^\uFEFF/u, "");
    const lines = source.split(/\r?\n/u);
    const end = findFrontmatterEnd(
      (index: number) => lines[index] ?? null,
      lines.length,
    );
    const body = lines.slice(end).join("\n")
      .replace(/^#{1,6}\s+/gmu, "")
      .replace(/!\[\[([^\]]+)\]\]/gu, "$1")
      .trim();
    return `${title}\n${"=".repeat(title.length)}\n\n${body}`;
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
      await this.app.workspace.getLeaf("tab").openFile(file, { active: true });
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
  ): Promise<void> {
    if (oldPath === newPath) {
      return;
    }
    const oldParent = oldPath.includes("/")
      ? oldPath.slice(0, oldPath.lastIndexOf("/"))
      : "";
    const newParent = newPath.includes("/")
      ? newPath.slice(0, newPath.lastIndexOf("/"))
      : "";
    const oldRoot = this.findNovelGroupRoot(oldParent);
    const newRoot = this.findNovelGroupRoot(newParent);
    if (oldRoot) {
      const config = await this.readNovelConfig(oldRoot);
      let changed = false;
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
      if (changed) {
        await this.writeNovelConfig(oldRoot, config);
      }
      await this.normalizeArticleGroups(oldRoot);
    }
    if (newRoot && newRoot !== oldRoot) {
      await this.normalizeArticleGroups(newRoot);
    }
  }

  private async handleArticlePathDeleted(path: string): Promise<void> {
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
        const config = parseNovelConfig(JSON.parse(await this.app.vault.cachedRead(file)));
        if (config["volume-order"].length === 0 && this.volumeOrder instanceof Map) {
          const legacyOrder = this.volumeOrder.get(file.parent.path);
          if (Array.isArray(legacyOrder) && legacyOrder.length > 0) {
            config["volume-order"] = [...legacyOrder];
          }
        }
        this.novelConfigs.set(file.parent.path, config);
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
    preview.style.left = `${Math.min(event.clientX + 14, window.innerWidth - width - 8)}px`;
    preview.style.top = `${Math.min(event.clientY + 16, window.innerHeight - height - 8)}px`;
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

  openArticleFromList(path: string, sourcePath: string): void {
    const active = this.getActiveMarkdownView();
    if (active?.file) {
      const scroller = active.containerEl.querySelector(".cm-scroller");
      if (scroller) {
        this.readingPositions.set(active.file.path, scroller.scrollTop);
      }
    }
    const file = this.app.vault.getAbstractFileByPath(path);
    if (!(file instanceof TFile)) {
      return;
    }
    void this.app.workspace.openLinkText(file.path, sourcePath, false, { active: true });
    window.setTimeout(() => {
      const next = this.getActiveMarkdownView();
      if (!next?.file || next.file.path !== path) {
        return;
      }
      const top = this.readingPositions.get(path);
      if (top === undefined) {
        return;
      }
      const scroller = next.containerEl.querySelector(".cm-scroller");
      if (scroller) {
        scroller.scrollTop = top;
      }
    }, 80);
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
    if (this.isReservedNovelFolder(base)) {
      return "该名称是小说组保留名称。";
    }
    const parent = this.normalizeFolderPath(folder.parent?.path ?? "/");
    const nextPath = joinVaultPath(parent, base);
    if (this.app.vault.getAbstractFileByPath(nextPath)) {
      return "同名文件夹已存在。";
    }
    const oldName = folder.name;
    const group = this.findNovelGroupRoot(parent);
    const order = group ? this.getNovelVolumeOrder(group) : [];
    await this.app.fileManager.renameFile(folder, nextPath);
    if (group && order.includes(oldName)) {
      order[order.indexOf(oldName)] = base;
      await this.saveNovelVolumeOrder(group, order);
    }
    this.articleUndoStack.push(async () => {
      const renamed = this.getFolder(nextPath);
      if (renamed) {
        await this.app.fileManager.renameFile(renamed, path);
      }
      if (group && order.includes(base)) {
        order[order.indexOf(base)] = oldName;
        await this.saveNovelVolumeOrder(group, order);
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
    const base = path.basename(filePath, path.extname(filePath));
    const name = this.sanitizeFileBase(base, "导入章节");
    const target = this.getFolder(folderPath);
    if (!target) {
      new Notice("Novel View：小说组不存在。");
      return;
    }
    const targetPath = this.getUniqueMarkdownPath(folderPath, name);
    const content = [
      "---",
      `novelview-id: ${this.getNextArticleId(folderPath)}`,
      `${CHAPTER_STATUS_PROPERTY}: ${CHAPTER_STATUS_LABELS.todo}`,
      "---",
      "",
      text,
    ].join("\n");
    try {
      const file = await this.app.vault.create(targetPath, content);
      await this.renumberFolder(folderPath);
      await this.app.workspace.getLeaf("tab").openFile(file, { active: true });
    } catch (error) {
      console.error("Novel View: TXT import failed", error);
      new Notice("Novel View：TXT 导入失败。");
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

  isReservedNovelFolder(name: string): boolean {
    return /^(src|设定|伏笔|人物|时间线|分散卷)$/iu.test(name);
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
                  );
                });
              });
              removeMenu.addItem((sub) => {
                sub.setTitle("以上").setIcon("arrow-up").onClick(() => {
                  void this.removeArticlesFromGroup(
                    folderPath,
                    group.id,
                    group.paths.slice(0, index + 1),
                  );
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

  syncArticleStatus(view: MarkdownView, enabled: boolean): void {
    if (!enabled || !view.file) {
      this.destroyArticleStatus(view);
      this.sectionTocs.get(view)?.destroy();
      this.sectionTocs.delete(view);
      return;
    }
    if (!this.sectionTocs.has(view)) {
      this.sectionTocs.set(view, new SectionToc(view));
    }
    void this.updateArticleStatus(view);
  }

  async updateArticleStatus(view: MarkdownView): Promise<void> {
    const file = view.file;
    if (!file) {
      return;
    }
    const content = view.editor?.getValue() ?? await this.app.vault.cachedRead(file);
    this.sectionTocs.get(view)?.update(content);
  }

  async ensureLinkLibrary(
    folderPath: string,
  ): Promise<{ folder: TFolder; json: TFile }> {
    const root = this.normalizeFolderPath(folderPath);
    const jsonPath = joinVaultPath(root, LINK_LIBRARY_JSON);
    const existing = this.app.vault.getAbstractFileByPath(jsonPath);
    let json: TFile;
    if (existing instanceof TFile) {
      json = existing;
    } else {
      const legacyPath = joinVaultPath(root, "link", LINK_LIBRARY_JSON);
      const legacy = this.app.vault.getAbstractFileByPath(legacyPath);
      const initial = legacy instanceof TFile
        ? await this.app.vault.read(legacy)
        : serializeLinkLibrary({ group: {}, tags: {}, links: [] });
      json = await this.app.vault.create(jsonPath, initial);
    }
    const folder = this.getFolder(root);
    if (!folder) {
      throw new Error("Novel group folder missing");
    }
    return { folder, json };
  }

  async readLinkLibrary(folderPath: string): Promise<LinkLibraryData> {
    const library = await this.ensureLinkLibrary(folderPath);
    let data: LinkLibraryData = { group: {}, tags: {}, links: [] };
    try {
      data = parseLinkLibrary(
        JSON.parse(await this.app.vault.read(library.json)) as unknown,
      );
    } catch (error) {
      console.debug("Novel View: link JSON read skipped", error);
    }
    const missing = data.links.filter((link) => (
      !this.getLinkTargetFile(folderPath, link.path)
    ));
    if (missing.length > 0) {
      data.links = data.links.filter((link) => (
        !!this.getLinkTargetFile(folderPath, link.path)
      ));
      await this.writeLinkLibrary(folderPath, data);
    }
    let tagsChanged = false;
    for (const [group, tagMap] of Object.entries(data.tags)) {
      for (const tag of Object.keys(tagMap)) {
        if (!data.links.some((link) => link.belong === group && link.tag === tag)) {
          delete tagMap[tag];
          tagsChanged = true;
        }
      }
      if (Object.keys(tagMap).length === 0) {
        delete data.tags[group];
      }
    }
    if (tagsChanged) {
      await this.writeLinkLibrary(folderPath, data);
    }
    return data;
  }

  async writeLinkLibrary(
    folderPath: string,
    data: LinkLibraryData,
  ): Promise<void> {
    const library = await this.ensureLinkLibrary(folderPath);
    await this.app.vault.process(
      library.json,
      () => serializeLinkLibrary(data),
    );
  }

  getLinkImportCandidates(
    folderPath: string,
  ): Array<{ path: string; label: string }> {
    const result: Array<{ path: string; label: string }> = [];
    for (const file of this.app.vault.getFiles()) {
      if (this.isSpecialNovelFile(file)) {
        continue;
      }
      const group = this.findNovelGroupRoot(
        this.normalizeFolderPath(file.parent?.path ?? "/"),
      );
      if (group !== null) {
        continue;
      }
      result.push({ path: `~/${file.path}`, label: file.path });
    }
    return result.sort((left, right) => left.label.localeCompare(
      right.label,
      "zh-CN",
      { numeric: true, sensitivity: "base" },
    ));
  }

  getLinkTargetFile(
    folderPath: string,
    rawPath: string,
  ): TFile | null {
    const root = this.normalizeFolderPath(folderPath);
    const clean = rawPath.trim().split("#")[0] ?? "";
    if (!clean) {
      return null;
    }
    const candidates = clean.startsWith("~/")
      ? [clean.slice(2)]
      : clean.startsWith("/")
        ? [clean.replace(/^\/+/, "")]
        : [
          joinVaultPath(root, clean),
          joinVaultPath(root, "link", clean),
          clean,
        ];
    for (const candidate of candidates) {
      for (const path of [candidate, `${candidate}.md`]) {
        const file = this.app.vault.getAbstractFileByPath(path);
        if (file instanceof TFile) {
          return file;
        }
      }
    }
    return null;
  }

  resolveLinkTarget(rawPath: string, current: TFile): TFile | null {
    const clean = rawPath.trim().split("#")[0] ?? "";
    if (!clean) {
      return null;
    }
    const root = this.findNovelGroupRoot(
      this.normalizeFolderPath(current.parent?.path ?? "/"),
    );
    const candidates: string[] = [];
    if (clean.startsWith("~/")) {
      candidates.push(clean.slice(2));
    } else if (clean.startsWith("/")) {
      candidates.push(clean.replace(/^\/+/, ""));
    } else {
      if (root) {
        const parent = this.normalizeFolderPath(current.parent?.path ?? "/");
        if (parent !== root) {
          candidates.push(joinVaultPath(parent, clean));
        }
        candidates.push(joinVaultPath(root, clean));
        candidates.push(joinVaultPath(root, "link", clean));
      }
      candidates.push(clean);
    }
    for (const candidate of candidates) {
      for (const path of [candidate, `${candidate}.md`]) {
        const file = this.app.vault.getAbstractFileByPath(path);
        if (file instanceof TFile) {
          return file;
        }
      }
    }
    return null;
  }

  isInLinkFolder(): boolean {
    return false;
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

  async openLinkLibrary(folderPath: string): Promise<void> {
    try {
      await this.ensureLinkLibrary(folderPath);
    } catch (error) {
      console.error("Novel View: failed to create link library", error);
      new Notice("Novel View：联动库创建失败。");
      return;
    }
    const existing = this.app.workspace.getLeavesOfType(LINK_LIBRARY_VIEW_TYPE)[0];
    const leaf = existing
      ?? this.app.workspace.getRightLeaf(false)
      ?? this.app.workspace.getRightLeaf(true);
    if (!leaf) {
      new Notice("Novel View：无法打开联动库。");
      return;
    }
    await leaf.setViewState({
      type: LINK_LIBRARY_VIEW_TYPE,
      state: { groupPath: this.normalizeFolderPath(folderPath) },
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
