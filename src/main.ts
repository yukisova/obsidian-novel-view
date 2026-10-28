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
  NovelArticleListView,
  type ArticleListTarget,
} from "./article-list-view";
import {
  CHAPTER_STATUSES,
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
  createNovelSettingContent,
  getNovelSettingPath,
  isNovelSettingFile,
  joinVaultPath,
} from "./core/novel-setting";
import { NovelSettingModal } from "./novel-setting-modal";
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
  private searchPanelV2: SearchPanelV2 | null = null;
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
    this.registerEvent(this.app.workspace.on("active-leaf-change", () => {
      if (
        this.searchPanelV2
        && !this.searchPanelV2.isOwner(this.getActiveMarkdownView())
      ) {
        this.searchPanelV2.close();
      }
    }));
    this.cleanupDescriptionData();
    this.cleanupNovelStateProperties();
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
      new Notice("NovelView：没有可导出的章节。");
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
      new Notice("NovelView：卷不存在。");
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
      new Notice("NovelView：本卷没有可导出的章节。");
      return;
    }
    await this.exportTxtFiles(files, target.title);
  }

  private async exportTxtFiles(files: TFile[], suggestedName: string): Promise<void> {
    const dialog = this.getElectronDialog();
    if (!dialog) {
      new Notice("NovelView：当前环境不支持系统文件夹选择器。");
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
    new Notice(`NovelView：已导出到 ${target}`);
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
      new Notice("NovelView：文档已经是整洁格式，无需调整。");
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
    new Notice(`NovelView：自动排版完成${parts.length ? `，${parts.join("，")}` : ""}。`);
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
      console.debug("NovelView: chapter meta read skipped", error);
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
      new Notice("NovelView：当前文章目录不存在。");
      return;
    }
    const base = this.sanitizeFileBase(title, "未命名文章");
    const path = this.getUniqueMarkdownPath(folder.path, base);
    const content = [
      "---",
      `${CHAPTER_STATUS_PROPERTY}: ${CHAPTER_STATUS_LABELS.todo}`,
      "---",
      "",
    ].join("\n");
    try {
      const file = await this.app.vault.create(path, content);
      await this.app.workspace.getLeaf("tab").openFile(file, { active: true });
      this.refreshOpenViews();
    } catch (error) {
      console.error("NovelView: failed to create article", error);
      new Notice("NovelView：文章创建失败。");
    }
  }

  openNovelGroupSettings(folderPath: string): void {
    const setting = this.getNovelSettingFile(folderPath);
    const info = this.getNovelGroupInfo(folderPath);
    if (!setting || !info) {
      new Notice("NovelView：未找到 NovelSetting 配置文件。");
      return;
    }
    new NovelSettingModal(this.app, {
      initial: info,
      resolveCoverUrl: (cover: string) => this.getNovelCoverUrl(folderPath, cover),
      onPickCover: () => this.pickCoverImage(setting.path),
      onSave: async (data: { description: string; cover: string }) => {
        await this.saveNovelSetting(folderPath, data);
        new Notice("NovelView：小说组信息已更新。");
      },
    }).open();
  }

  async saveNovelSetting(
    folderPath: string,
    data: { description: string; cover: string },
  ): Promise<void> {
    const setting = this.getNovelSettingFile(folderPath);
    if (!setting) {
      throw new Error("NovelSetting.md not found");
    }
    await this.app.fileManager.processFrontMatter(setting, (frontmatter) => {
      frontmatter["novelview-type"] = "novel-setting";
      frontmatter["novel-description"] = data.description;
      frontmatter["novel-cover"] = data.cover;
      delete frontmatter["novelstate"];
      delete frontmatter["状态"];
    });
    this.refreshWorkbenchViews();
  }

  isReservedNovelFolder(name: string): boolean {
    return /^(src|设定|伏笔|人物|时间线|分散卷)$/iu.test(name);
  }

  async exportNovelGroup(folderPath: string): Promise<void> {
    const group = this.getFolder(folderPath);
    const info = this.getNovelGroupInfo(folderPath);
    if (!group || !info) {
      new Notice("NovelView：未找到小说组。");
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
      new Notice("NovelView：小说组中没有可导出的章节。");
      return;
    }
    await this.exportTxtFiles(files, `${info.name}-合并稿`);
  }

  async createNovelGroup(folder: TFolder): Promise<void> {
    const folderPath = this.normalizeFolderPath(folder.path);
    if (folderPath === "/") {
      new Notice("NovelView：仓库根目录不能设置为小说组。");
      return;
    }
    const settingPath = getNovelSettingPath(folderPath);
    const existing = this.app.vault.getAbstractFileByPath(settingPath);
    if (existing instanceof TFile && isNovelSettingFile(existing)) {
      this.workbenchFolderPath = folderPath;
      await this.openArticleList(folderPath);
      await this.activateWorkbench();
      this.refreshWorkbenchViews();
      return;
    }
    if (existing) {
      new Notice("NovelView：无法创建 NovelSetting，同名路径已存在。");
      return;
    }
    try {
      await this.app.vault.create(settingPath, createNovelSettingContent(folder.name));
      this.workbenchFolderPath = folderPath;
      await this.openArticleList(folderPath);
      await this.activateWorkbench();
      this.refreshOpenViews();
      new Notice(`NovelView：已创建小说组“${folder.name}”。`);
    } catch (error) {
      console.error("NovelView: failed to create novel group", error);
      new Notice("NovelView：小说组创建失败。");
    }
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
        menu.addItem((item) => {
          item.setTitle("导出本卷为 TXT").setIcon("download").onClick(() => {
            void this.exportVolumeTarget(targets[0], folderPath);
          });
        });
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
    let card = this.articleStatusCards.get(view);
    if (!card || !card.isConnected) {
      card?.remove();
      card = view.containerEl.createDiv({
        cls: "novelview-article-status",
      });
      card.setAttr("aria-live", "polite");
      card.addClass("is-clickable");
      card.addEventListener("click", (event: MouseEvent) => {
        if (view.file) {
          this.showChapterStatusMenu(event, view.file);
        }
      });
      view.containerEl.addClass("novelview-status-host");
      this.articleStatusCards.set(view, card);
    }
    if (!this.sectionTocs.has(view)) {
      this.sectionTocs.set(view, new SectionToc(view));
    }
    void this.updateArticleStatus(view);
    if (!this.articleStatusTimers.has(view)) {
      const timer = window.setInterval(() => {
        if (this.unloaded || !view.containerEl.isConnected) {
          this.destroyArticleStatus(view);
          return;
        }
        void this.updateArticleStatus(view);
      }, 800);
      this.articleStatusTimers.set(view, timer);
    }
  }

  async updateArticleStatus(view: MarkdownView): Promise<void> {
    const file = view.file;
    const card = this.articleStatusCards.get(view);
    if (!file || !card) {
      return;
    }
    const meta = await this.getChapterMeta(file.path);
    if (!card.isConnected || view.file?.path !== file.path) {
      return;
    }
    const content = view.editor?.getValue() ?? await this.app.vault.cachedRead(file);
    this.sectionTocs.get(view)?.update(content);
    card.empty();
    card.createSpan({
      cls: "novelview-article-status-count",
      text: `${new Intl.NumberFormat("zh-CN").format(meta.wordCount)} 字`,
    });
    const badge = card.createSpan({
      cls: "novelview-article-status-state",
      text: CHAPTER_STATUS_LABELS[meta.status],
    });
    badge.dataset.state = meta.status;
    card.setAttr(
      "title",
      `当前章节 ${meta.wordCount} 字 · ${CHAPTER_STATUS_LABELS[meta.status]}（点击修改）`,
    );
  }

  private showChapterStatusMenu(event: MouseEvent, file: TFile): void {
    const current = readChapterStatus(
      this.app.metadataCache.getFileCache(file)?.frontmatter,
    );
    const menu = new Menu();
    for (const status of CHAPTER_STATUSES) {
      menu.addItem((item) => {
        item.setTitle(CHAPTER_STATUS_LABELS[status])
          .setIcon(status === current ? "check" : "circle")
          .onClick(() => {
            void this.setChapterStatus(file, status);
          });
      });
    }
    menu.showAtMouseEvent(event);
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
      console.debug("NovelView: link JSON read skipped", error);
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
      if (isNovelSettingFile(file)) {
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

  async openLinkLibrary(folderPath: string): Promise<void> {
    try {
      await this.ensureLinkLibrary(folderPath);
    } catch (error) {
      console.error("NovelView: failed to create link library", error);
      new Notice("NovelView：联动库创建失败。");
      return;
    }
    const leaf = this.app.workspace.getRightLeaf(false)
      ?? this.app.workspace.getRightLeaf(true);
    if (!leaf) {
      new Notice("NovelView：无法打开联动库。");
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
      new Notice("NovelView：无法创建素材库目录。");
      return;
    }
    const base = file.name.replace(/\.[^.]+$/u, "");
    const extension = file.name.slice(base.length);
    const path = this.getUniqueFilePath(srcPath, `${base}${extension}`);
    await this.app.vault.createBinary(path, await file.arrayBuffer());
    new Notice(`NovelView：已导入素材“${file.name}”。`);
  }

  private cleanupDescriptionData(): void {
    for (const file of this.app.vault.getMarkdownFiles()) {
      if (isNovelSettingFile(file)) {
        void this.app.vault.read(file).then((content) => {
          const lines = content.split(/\r?\n/u);
          const end = findFrontmatterEnd(
            (index: number) => lines[index] ?? null,
            lines.length,
          );
          const head = lines.slice(0, end).join("\n").trimEnd();
          if (head && content.trim() !== head) {
            return this.app.vault.process(file, () => `${head}\n`);
          }
          return undefined;
        }).catch(() => undefined);
        continue;
      }
      const frontmatter = this.app.metadataCache.getFileCache(file)?.frontmatter;
      if (!frontmatter || !("描述" in frontmatter)) {
        continue;
      }
      void this.app.fileManager.processFrontMatter(file, (data) => {
        delete data["描述"];
      }).catch(() => undefined);
    }
  }

  private cleanupNovelStateProperties(): void {
    for (const file of this.app.vault.getMarkdownFiles()) {
      const frontmatter = this.app.metadataCache.getFileCache(file)?.frontmatter;
      if (!frontmatter) {
        continue;
      }
      if (
        "novelstate" in frontmatter
        || "状态" in frontmatter
      ) {
        void this.app.fileManager.processFrontMatter(file, (data) => {
          delete data["novelstate"];
          delete data["状态"];
        }).catch(() => undefined);
      }
    }
  }
}
