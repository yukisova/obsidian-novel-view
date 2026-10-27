import {
  MarkdownView,
  Menu,
  Notice,
  parseYaml,
  Plugin,
  TAbstractFile,
  TFile,
  TFolder,
  type WorkspaceLeaf,
} from "obsidian";
import {
  compareFilesNaturally,
  getReferenceCategories,
  hasReferenceProperty,
  REFERENCE_CATEGORIES,
  type ReferenceCategory,
} from "./core/cards";
import {
  appendCategorySection,
  createCategoryFileContent,
  deleteCategorySection,
  getCategoryFilePath,
  getCategorySectionBody,
  isCategoryFileName,
  parseCategorySections,
  renameCategorySection,
  replaceCategorySection,
  type CategorySection,
} from "./core/category-file";
import { formatNovelMarkdown } from "./core/format";
import { findFrontmatterEnd } from "./core/paragraphs";
import { linkKeywordsInElement } from "./keyword-dom";
import {
  InspirationNote,
  type InspirationNoteData,
} from "./inspiration-note";
import {
  createOutlineFileContent,
  deleteOutlineEntry,
  getOutlineFilePath,
  isOutlineFileName,
  parseOutline,
  upsertOutlineEntry,
  type OutlineData,
  type OutlineEntry,
  type OutlineLevel,
} from "./core/outline";
import {
  createNovelSettingContent,
  getNovelSettingPath,
  isNovelSettingFile,
  NOVEL_SETTING_TYPE,
  joinVaultPath,
  normalizeCoverPath,
  parseNovelSetting,
  type NovelSettingData,
} from "./core/novel-setting";
import {
  buildKeywordEntries,
  type KeywordEntry,
} from "./core/keywords";
import {
  countNovelCharacters,
  NOVEL_STATE_LABELS,
  parseNovelState,
  type NovelState,
} from "./core/status";
import {
  compileSearchExpression,
  findSearchMatches,
  MAX_FILE_SEARCH_RESULTS,
  MAX_SEARCH_RESULTS,
  replaceSearchMatches,
  type SearchFileResult,
  type SearchMatch,
  type SearchResponse,
  type SearchUiState,
} from "./core/search";
import {
  ARTICLE_LIST_VIEW_TYPE,
  NovelArticleListView,
  type ArticleListModel,
  type ArticleListTarget,
} from "./article-list-view";
import { CategorySectionModal } from "./category-section-modal";
import { confirmAction } from "./confirm-modal";
import { OutlineCardModal } from "./outline-card-modal";
import {
  SpecialPageView,
  SPECIAL_PAGE_VIEW_TYPE,
} from "./special-page-view";
import {
  getSpecialPageKind as getSpecialPageKindForName,
  type SpecialPageKind,
} from "./core/special-page";
import {
  NovelFloatingToolbar,
  type NovelToolbarScope,
} from "./editor/floating-toolbar";
import {
  novelKeywordExtension,
  refreshNovelKeywords,
  setNovelKeywords,
} from "./editor/keyword-extension";
import { novelMarkdownExtension } from "./editor/markdown-extension";
import { NovelSettingModal } from "./novel-setting-modal";
import {
  NovelSrcGalleryView,
  SRC_GALLERY_VIEW_TYPE,
} from "./src-gallery-view";
import { TextPromptModal } from "./text-prompt-modal";
import { confirmReplaceAll } from "./replace-confirm-modal";
import {
  AdvancedSearchPanel,
  DEFAULT_SEARCH_UI_STATE,
} from "./search-panel";
import {
  NovelSearchResultsView,
  SEARCH_RESULTS_VIEW_TYPE,
} from "./search-results-view";
import { NovelViewSettingTab } from "./settings-tab";
import {
  DEFAULT_SETTINGS,
  normalizeSettings,
  type NovelViewSettings,
} from "./settings";
import {
  NovelWorkbenchView,
  WORKBENCH_VIEW_TYPE,
} from "./workbench-view";

const MODE_CLASS = "novelview-novel-mode";
const HIDE_MARKERS_CLASS = "novelview-hide-markers";
const HIDE_LINE_NUMBERS_CLASS = "novelview-hide-line-numbers";
const PARAGRAPH_MODE_LINE_CLASS = "novelview-paragraph-mode-line";
const PARAGRAPH_MODE_BLANK_LINE_CLASS = "novelview-paragraph-mode-blank-line";

interface PersistedNovelViewData {
  settings?: unknown;
  stickyNote?: unknown;
  volumeOrder?: unknown;
}

interface SearchScope {
  folderPath: string;
  files: TFile[];
}

export default class NovelViewPlugin extends Plugin {
  settings: NovelViewSettings = { ...DEFAULT_SETTINGS };

  private readonly searchActions = new Map<MarkdownView, HTMLElement>();
  private readonly novelToolbars = new Map<MarkdownView, NovelFloatingToolbar>();
  private readonly articleStatusCards = new Map<MarkdownView, HTMLElement>();
  private readonly articleStatusTimers = new Map<MarkdownView, number>();
  private readonly observedViews = new WeakSet<MarkdownView>();
  private saveChain: Promise<void> = Promise.resolve();

  private lastActiveMarkdownPath: string | null = null;
  private workbenchFolderPath: string | null = null;
  private readonly volumeOrder = new Map<string, string[]>();
  private readonly inspirationNotes = new Map<string, InspirationNote>();
  private readonly closingInspirationNotes = new Set<string>();
  private readonly redirectingSpecialPaths = new Set<string>();
  private inspirationCounter = 0;
  private dataSaveTimer: number | null = null;

  private searchPanel: AdvancedSearchPanel | null = null;
  private searchResponse: SearchResponse | null = null;
  private searchUiState: SearchUiState = { ...DEFAULT_SEARCH_UI_STATE };
  private searchDebounceTimer: number | null = null;
  private searchRequestId = 0;
  private replacing = false;
  private keywordRefreshTimer: number | null = null;
  private keywordSignature = "";
  private readonly categoryCache = new Map<string, {
    mtime: number;
    content: string;
    sections: CategorySection[];
  }>();
  private readonly keywordGroupCache = new Map<string, {
    signature: string;
    entries: KeywordEntry[];
  }>();
  private folderDecorationObserver: MutationObserver | null = null;
  private folderDecorationContainer: HTMLElement | null = null;
  private folderDecorationFrame: number | null = null;

  private unloaded = false;

  override async onload(): Promise<void> {
    await this.loadSettings();

    this.registerEditorExtension(novelMarkdownExtension);
    this.registerEditorExtension(novelKeywordExtension);
    this.registerMarkdownPostProcessor((element, context) => {
      this.decorateReadingKeywords(element, context.sourcePath);
    });
    this.registerView(
      WORKBENCH_VIEW_TYPE,
      (leaf) => new NovelWorkbenchView(leaf, this),
    );
    this.registerView(
      SEARCH_RESULTS_VIEW_TYPE,
      (leaf) => new NovelSearchResultsView(leaf, this),
    );
    this.registerView(
      ARTICLE_LIST_VIEW_TYPE,
      (leaf) => new NovelArticleListView(leaf, this),
    );
    this.registerView(
      SRC_GALLERY_VIEW_TYPE,
      (leaf) => new NovelSrcGalleryView(leaf, this),
    );
    this.registerView(
      SPECIAL_PAGE_VIEW_TYPE,
      (leaf) => new SpecialPageView(leaf, this),
    );
    this.addSettingTab(new NovelViewSettingTab(this.app, this));
    this.registerCommands();
    this.registerNovelGroupEvents();

    this.app.workspace.onLayoutReady(() => {
      if (this.unloaded) {
        return;
      }

      this.rememberActiveMarkdownFile();
      this.removeSidebarWorkbenchInstances();
      this.refreshOpenViews();
      this.refreshWorkbenchViews();
      void this.refreshKeywordIndex();
      this.setupNovelFolderObserver();
    });

    this.registerEvent(
      this.app.workspace.on("layout-change", () => {
        this.refreshOpenViews();
        this.setupNovelFolderObserver();
      }),
    );
    this.registerEvent(
      this.app.workspace.on("active-leaf-change", () => {
        this.rememberActiveMarkdownFile();
        this.refreshOpenViews();
        this.refreshWorkbenchViews();
        this.scheduleKeywordRefresh();
      }),
    );
    this.registerEvent(
      this.app.workspace.on("file-open", (file) => {
        this.rememberActiveMarkdownFile();
        this.refreshOpenViews();
        this.refreshWorkbenchViews();
        this.scheduleKeywordRefresh();
        if (file instanceof TFile) {
          this.redirectSpecialFile(file);
        }
      }),
    );
    this.registerEvent(
      this.app.vault.on("rename", (file, oldPath) => {
        if (this.lastActiveMarkdownPath === oldPath) {
          this.lastActiveMarkdownPath = file.path;
        }
        if (this.workbenchFolderPath === oldPath) {
          this.workbenchFolderPath = file.path;
        } else if (
          this.workbenchFolderPath
          && this.workbenchFolderPath.startsWith(`${oldPath}/`)
        ) {
          this.workbenchFolderPath = `${file.path}${this.workbenchFolderPath.slice(oldPath.length)}`;
        }
        this.refreshOpenViews();
        this.refreshWorkbenchViews();
        this.scheduleKeywordRefresh();
        this.scheduleNovelFolderDecoration();
      }),
    );
    this.registerEvent(
      this.app.vault.on("delete", (file) => {
        if (this.lastActiveMarkdownPath === file.path) {
          this.lastActiveMarkdownPath = null;
        }
        this.refreshOpenViews();
        this.refreshWorkbenchViews();
        this.scheduleKeywordRefresh();
        this.scheduleNovelFolderDecoration();
      }),
    );

    this.registerEvent(
      this.app.vault.on("create", () => {
        this.scheduleKeywordRefresh();
        this.scheduleNovelFolderDecoration();
      }),
    );
    this.registerEvent(
      this.app.vault.on("modify", (file) => {
        this.categoryCache.delete(file.path);
        this.scheduleKeywordRefresh();
      }),
    );
    this.registerEvent(
      this.app.metadataCache.on("changed", () => {
        this.scheduleKeywordRefresh();
        this.refreshOpenViews();
      }),
    );
    this.registerEvent(
      this.app.metadataCache.on("resolved", () => {
        this.scheduleKeywordRefresh();
        this.refreshOpenViews();
      }),
    );
  }

  override onunload(): void {
    this.unloaded = true;

    if (this.dataSaveTimer !== null) {
      window.clearTimeout(this.dataSaveTimer);
      this.dataSaveTimer = null;
      void this.saveSettings().catch((error) => {
        console.error("NovelView: failed to flush plugin data", error);
      });
    }
    this.cancelScheduledSearch();
    this.searchRequestId += 1;
    if (this.keywordRefreshTimer !== null) {
      window.clearTimeout(this.keywordRefreshTimer);
      this.keywordRefreshTimer = null;
    }
    if (this.folderDecorationFrame !== null) {
      window.cancelAnimationFrame(this.folderDecorationFrame);
      this.folderDecorationFrame = null;
    }
    this.folderDecorationObserver?.disconnect();
    this.folderDecorationObserver = null;
    this.folderDecorationContainer = null;
    for (const note of this.inspirationNotes.values()) {
      note.destroy();
    }
    this.inspirationNotes.clear();
    this.closingInspirationNotes.clear();
    this.searchPanel?.destroy();
    this.searchPanel = null;

    for (const leaf of this.app.workspace.getLeavesOfType("markdown")) {
      if (leaf.view instanceof MarkdownView) {
        this.clearNovelMode(leaf.view);
      }
    }
    for (const action of this.searchActions.values()) {
      action.remove();
    }
    for (const [view, toolbar] of this.novelToolbars) {
      toolbar.destroy();
      view.containerEl.removeClass("novelview-toolbar-host");
    }
    for (const [view, card] of this.articleStatusCards) {
      card.remove();
      view.containerEl.removeClass("novelview-status-host");
      const timer = this.articleStatusTimers.get(view);
      if (timer !== undefined) {
        window.clearInterval(timer);
      }
    }

    this.searchActions.clear();
    this.novelToolbars.clear();
    this.articleStatusCards.clear();
    this.articleStatusTimers.clear();
    for (const element of document.querySelectorAll(
      ".novelview-novel-folder, .novelview-novel-folder-title",
    )) {
      element.classList.remove("novelview-novel-folder", "novelview-novel-folder-title");
    }
    setNovelKeywords([]);
  }

  async loadSettings(): Promise<void> {
    const raw: unknown = await this.loadData();
    if (isPersistedNovelViewData(raw)) {
      this.settings = normalizeSettings(raw.settings);
      this.loadVolumeOrder(raw.volumeOrder);
      return;
    }

    // Version 0.1.0 stored settings flat. Keep those settings when upgrading.
    this.settings = normalizeSettings(raw);
  }

  async saveSettings(): Promise<void> {
    const snapshot: PersistedNovelViewData = {
      settings: { ...this.settings },
      volumeOrder: Object.fromEntries(this.volumeOrder),
    };
    const write = (): Promise<void> => this.saveData(snapshot);

    this.saveChain = this.saveChain.then(write, write);
    await this.saveChain;
  }

  private loadVolumeOrder(value: unknown): void {
    this.volumeOrder.clear();
    if (typeof value !== "object" || value === null) {
      return;
    }

    for (const [folderPath, order] of Object.entries(value)) {
      if (!Array.isArray(order)) {
        continue;
      }
      const names = order.filter(
        (entry): entry is string => typeof entry === "string" && entry.length > 0,
      );
      if (names.length > 0) {
        this.volumeOrder.set(this.normalizeFolderPath(folderPath), names);
      }
    }
  }

  async updateSettings(patch: Partial<NovelViewSettings>): Promise<void> {
    this.settings = normalizeSettings({ ...this.settings, ...patch });

    try {
      await this.saveSettings();
    } catch (error) {
      console.error("NovelView: failed to save settings", error);
      new Notice("NovelView：设置保存失败，请检查控制台日志。");
    }

    this.applySettingsToOpenModes();
  }

  async resetSettings(): Promise<void> {
    this.settings = { ...DEFAULT_SETTINGS };

    try {
      await this.saveSettings();
    } catch (error) {
      console.error("NovelView: failed to save settings", error);
      new Notice("NovelView：设置保存失败，请检查控制台日志。");
    }

    this.applySettingsToOpenModes();
  }

  isForcedNovelMode(
    file: TFile | null,
    view?: MarkdownView,
  ): boolean {
    if (!file || this.isSpecialNovelFile(file)) {
      return false;
    }

    const active = view ?? this.getActiveMarkdownView();
    if (
      active?.file?.path === file.path
      && this.getLiveReferenceCategories(active).length > 0
    ) {
      return false;
    }

    const parentPath = this.normalizeFolderPath(file.parent?.path ?? "/");
    return this.findNovelGroupRoot(parentPath) !== null;
  }

  isSpecialNovelFile(file: TFile): boolean {
    return isNovelSettingFile(file)
      || isCategoryFileName(file.basename)
      || isOutlineFileName(file.basename)
      || this.hasFileReferenceProperty(file);
  }

  isNovelModeEnabled(view: MarkdownView): boolean {
    return !!view.file && this.isForcedNovelMode(view.file, view);
  }

  getLastActiveMarkdownFile(): TFile | null {
    if (!this.lastActiveMarkdownPath) {
      return null;
    }

    const file = this.app.vault.getAbstractFileByPath(this.lastActiveMarkdownPath);
    return file instanceof TFile ? file : null;
  }

  getChapterFiles(): TFile[] {
    const folderPath = this.getWorkbenchFolderPath();
    if (!folderPath) {
      return [];
    }

    return this.getChapterFilesInFolder(folderPath);
  }

  getChapterFilesInFolder(folderPath: string): TFile[] {
    const normalized = this.normalizeFolderPath(folderPath);

    return this.app.vault.getMarkdownFiles()
      .filter((file) => this.normalizeFolderPath(file.parent?.path ?? "/") === normalized)
      .filter((file) => !isNovelSettingFile(file))
      .filter((file) => !isCategoryFileName(file.basename))
      .filter((file) => !isOutlineFileName(file.basename))
      .filter((file) => !this.hasFileReferenceProperty(file))
      .sort(compareFilesNaturally);
  }

  getWorkbenchFolderPath(): string | null {
    if (this.workbenchFolderPath === null) {
      return null;
    }
    const folderPath = this.normalizeFolderPath(this.workbenchFolderPath);
    if (this.getFolder(folderPath)) {
      return folderPath;
    }
    this.workbenchFolderPath = null;
    return null;
  }

  setWorkbenchGroup(folderPath: string): void {
    const normalized = this.normalizeFolderPath(folderPath);
    if (this.workbenchFolderPath === normalized) {
      return;
    }
    this.workbenchFolderPath = normalized;
    this.refreshWorkbenchViews();
  }

  getNovelGroupInfo(folderPath: string): NovelSettingData | null {
    const settingFile = this.getNovelSettingFile(folderPath);
    if (!settingFile) {
      return null;
    }

    const folder = this.getFolder(folderPath);
    const folderName = folder?.name ?? folderPath.split("/").pop() ?? "小说";
    const cache = this.app.metadataCache.getFileCache(settingFile);
    const parsed = parseNovelSetting(
      cache?.frontmatter,
      this.normalizeFolderPath(folderPath),
      folderName,
    );
    // The folder name is the single source of truth for the novel name.
    return { ...parsed, name: folderName };
  }

  getNovelCoverUrl(folderPath: string, cover: string): string | null {
    const normalized = normalizeCoverPath(cover);
    if (!normalized) {
      return null;
    }
    if (/^https?:\/\//iu.test(normalized)) {
      return normalized;
    }

    let file = this.app.vault.getAbstractFileByPath(normalized);
    if (!(file instanceof TFile)) {
      const settingFile = this.getNovelSettingFile(folderPath);
      const resolved = this.app.metadataCache.getFirstLinkpathDest(
        normalized,
        settingFile?.path ?? "",
      );
      file = resolved ?? null;
    }

    return file instanceof TFile
      ? this.app.vault.getResourcePath(file)
      : null;
  }

  async openWorkbenchForGroup(folderPath: string): Promise<void> {
    this.workbenchFolderPath = this.normalizeFolderPath(folderPath);
    await this.activateWorkbench();
    this.refreshWorkbenchViews();
  }

  openNovelGroupSettings(folderPath: string): void {
    const settingFile = this.getNovelSettingFile(folderPath);
    const info = this.getNovelGroupInfo(folderPath);
    if (!settingFile || !info) {
      new Notice("NovelView：未找到 NovelSetting 配置文件。");
      return;
    }

    const modal = new NovelSettingModal(this.app, {
      initial: info,
      resolveCoverUrl: (cover) => this.getNovelCoverUrl(folderPath, cover),
      onPickCover: () => this.pickCoverImage(settingFile.path),
      onSave: async (data) => {
        await this.saveNovelSetting(folderPath, data);
        new Notice("NovelView：小说组信息已更新。");
      },
    });
    modal.open();
  }

  async getOutlineData(folderPath: string): Promise<{
    file: TFile;
    content: string;
    data: OutlineData;
  } | null> {
    const file = this.getOutlineFile(folderPath);
    if (!file) {
      return null;
    }

    try {
      const content = await this.app.vault.read(file);
      return { file, content, data: parseOutline(content) };
    } catch (error) {
      console.debug("NovelView: could not read outline", error);
      return null;
    }
  }

  private getOutlineFile(folderPath: string): TFile | null {
    const path = getOutlineFilePath(this.normalizeFolderPath(folderPath));
    const file = this.app.vault.getAbstractFileByPath(path);
    return file instanceof TFile ? file : null;
  }

  private async ensureOutlineFile(folderPath: string): Promise<TFile> {
    const existing = this.getOutlineFile(folderPath);
    if (existing) {
      return existing;
    }
    const path = getOutlineFilePath(this.normalizeFolderPath(folderPath));
    return this.app.vault.create(path, createOutlineFileContent());
  }

  async openOutlineEntry(
    folderPath: string,
    entry: OutlineEntry,
  ): Promise<void> {
    const file = this.getOutlineFile(folderPath);
    if (file) {
      await this.openFileAtLine(file, entry.line);
    }
  }

  async promptOutlineCard(
    folderPath: string,
    level: OutlineLevel,
    title: string,
  ): Promise<void> {
    const data = await this.getOutlineData(folderPath);
    const existing = data?.data[level].find((entry) => entry.title === title);
    new OutlineCardModal(this.app, {
      level,
      title,
      body: existing?.body ?? "",
      onSubmit: (body) => {
        void this.saveOutlineEntry(folderPath, level, title, body);
      },
    }).open();
  }

  private async saveOutlineEntry(
    folderPath: string,
    level: OutlineLevel,
    title: string,
    body: string,
  ): Promise<void> {
    const file = await this.ensureOutlineFile(folderPath);
    await this.app.vault.process(file, (content) => (
      upsertOutlineEntry(content, level, title, body)
    ));
    this.refreshWorkbenchViews();
    new Notice(`NovelView：已将“${title}”写入${level === "volume" ? "卷纲" : "章纲"}。`);
  }

  showOutlineEntryContextMenu(
    event: MouseEvent,
    folderPath: string,
    entry: OutlineEntry,
  ): void {
    const menu = new Menu();
    menu.addItem((item) => {
      item.setTitle("修改").setIcon("pencil").onClick(() => {
        void this.promptOutlineCard(folderPath, entry.level, entry.title);
      });
    });
    menu.addItem((item) => {
      item.setTitle("删除").setIcon("trash").onClick(() => {
        void confirmAction(
          this.app,
          "删除大纲条目",
          `确定从${entry.level === "volume" ? "卷纲" : "章纲"}删除“${entry.title}”吗？`,
        ).then(async (confirmed) => {
          if (!confirmed) {
            return;
          }
          const file = this.getOutlineFile(folderPath);
          if (!file) {
            return;
          }
          await this.app.vault.process(file, (content) => (
            deleteOutlineEntry(content, entry)
          ));
          this.refreshWorkbenchViews();
        });
      });
    });
    menu.showAtMouseEvent(event);
  }

  async getCategoryData(
    folderPath: string,
    category: ReferenceCategory,
  ): Promise<{
    file: TFile;
    content: string;
    sections: CategorySection[];
  } | null> {
    const file = this.getCategoryFile(folderPath, category);
    if (!file) {
      return null;
    }

    const mtime = file.stat.mtime;
    const cached = this.categoryCache.get(file.path);
    if (cached && cached.mtime === mtime) {
      return {
        file,
        content: cached.content,
        sections: cached.sections,
      };
    }

    try {
      const content = await this.app.vault.read(file);
      const sections = parseCategorySections(content);
      this.categoryCache.set(file.path, {
        mtime,
        content,
        sections,
      });

      return { file, content, sections };
    } catch (error) {
      console.debug("NovelView: could not read category file", error);
      return null;
    }
  }

  private getCategoryFile(
    folderPath: string,
    category: ReferenceCategory,
  ): TFile | null {
    const path = getCategoryFilePath(
      this.normalizeFolderPath(folderPath),
      category,
    );
    const file = this.app.vault.getAbstractFileByPath(path);
    return file instanceof TFile ? file : null;
  }

  private async ensureCategoryFile(
    folderPath: string,
    category: ReferenceCategory,
  ): Promise<TFile> {
    const existing = this.getCategoryFile(folderPath, category);
    if (existing) {
      return existing;
    }

    const path = getCategoryFilePath(
      this.normalizeFolderPath(folderPath),
      category,
    );
    return this.app.vault.create(path, createCategoryFileContent(category));
  }

  async addCategorySection(
    folderPath: string,
    category: ReferenceCategory,
    heading: string,
    keywords: string[] = [],
    body = "",
    openAfter = true,
  ): Promise<{ file: TFile; section: CategorySection } | null> {
    const file = await this.ensureCategoryFile(folderPath, category);
    await this.app.vault.process(file, (content) => (
      appendCategorySection(content, category, heading, keywords, body)
    ));
    this.categoryCache.delete(file.path);

    const content = await this.app.vault.read(file);
    const sections = parseCategorySections(content);
    const section = [...sections].reverse().find(
      (candidate) => candidate.heading === heading,
    ) ?? sections[sections.length - 1] ?? null;

    this.refreshWorkbenchViews();
    this.scheduleKeywordRefresh();

    if (!section) {
      return null;
    }

    if (openAfter) {
      await this.openFileAtLine(file, section.headingLine);
    }
    return { file, section };
  }

  promptNewCategorySection(
    folderPath: string,
    category: ReferenceCategory,
    afterCreate?: () => void,
  ): void {
    new CategorySectionModal(this.app, category, (heading, keywords) => {
      void this.addCategorySection(folderPath, category, heading, keywords)
        .then(() => afterCreate?.());
    }).open();
  }

  async openCategorySection(
    folderPath: string,
    category: ReferenceCategory,
    section: CategorySection,
  ): Promise<void> {
    const file = this.getCategoryFile(folderPath, category);
    if (!file) {
      return;
    }
    await this.openFileAtLine(file, section.headingLine);
  }

  showCategorySectionContextMenu(
    event: MouseEvent,
    folderPath: string,
    category: ReferenceCategory,
    section: CategorySection,
    refresh: () => void,
  ): void {
    const menu = new Menu();
    menu.addItem((item) => {
      item.setTitle("修改").setIcon("pencil").onClick(() => {
        new TextPromptModal(this.app, {
          title: "修改标题",
          initialValue: section.heading,
          submitLabel: "保存",
          onSubmit: (heading) => {
            const file = this.getCategoryFile(folderPath, category);
            if (!file) {
              return;
            }
            void this.app.vault.process(file, (content) => (
              renameCategorySection(content, section, heading)
            )).then(() => {
              this.categoryCache.delete(file.path);
              refresh();
              this.refreshWorkbenchViews();
              this.scheduleKeywordRefresh();
            });
          },
        }).open();
      });
    });
    menu.addItem((item) => {
      item.setTitle("删除").setIcon("trash").onClick(() => {
        void confirmAction(
          this.app,
          "删除条目",
          `确定删除“${section.heading}”吗？`,
        ).then((confirmed) => {
          if (!confirmed) {
            return;
          }
          const file = this.getCategoryFile(folderPath, category);
          if (!file) {
            return;
          }
          void this.app.vault.process(file, (content) => (
            deleteCategorySection(content, section)
          )).then(() => {
            this.categoryCache.delete(file.path);
            refresh();
            this.refreshWorkbenchViews();
            this.scheduleKeywordRefresh();
          });
        });
      });
    });
    menu.showAtMouseEvent(event);
  }

  promptNewChapter(folderPath: string, afterCreate?: () => void): void {
    new TextPromptModal(this.app, {
      title: "新建章节",
      placeholder: "章节标题",
      submitLabel: "创建章节",
      onSubmit: (title) => {
        void this.createArticleInFolder(folderPath, folderPath, title)
          .then(() => afterCreate?.());
      },
    }).open();
  }

  showChapterContextMenu(
    event: MouseEvent,
    file: TFile,
    refresh: () => void,
  ): void {
    const menu = new Menu();
    menu.addItem((item) => {
      item.setTitle("修改").setIcon("pencil").onClick(() => {
        new TextPromptModal(this.app, {
          title: "修改章节名称",
          initialValue: file.basename,
          submitLabel: "保存",
          onSubmit: (name) => {
            const base = this.sanitizeFileBase(name, file.basename);
            const parentPath = this.normalizeFolderPath(file.parent?.path ?? "/");
            const target = joinVaultPath(parentPath, `${base}.md`);
            if (target === file.path) {
              return;
            }
            if (this.app.vault.getAbstractFileByPath(target)) {
              new Notice("NovelView：同名文件已存在。");
              return;
            }
            void this.app.fileManager.renameFile(file, target).then(refresh);
          },
        }).open();
      });
    });
    menu.addItem((item) => {
      item.setTitle("删除").setIcon("trash").onClick(() => {
        void this.app.fileManager.promptForDeletion(file).then((confirmed) => {
          if (confirmed) {
            void this.app.vault.delete(file).then(refresh);
          }
        });
      });
    });
    menu.showAtMouseEvent(event);
  }

  async openFileAtLine(file: TFile, line: number): Promise<void> {
    if (this.getSpecialPageKind(file)) {
      await this.openSpecialPage(file, line, true);
      return;
    }

    const leaf = this.app.workspace.getLeaf("tab");
    const targetLine = Math.max(0, line - 1);
    await leaf.openFile(file, {
      active: true,
      eState: { line: targetLine, ch: 0 },
    });

    window.setTimeout(() => {
      const view = this.getActiveMarkdownView();
      if (!view?.file || view.file.path !== file.path) {
        return;
      }
      try {
        const position = { line: targetLine, ch: 0 };
        view.editor.setCursor(position);
        view.editor.scrollIntoView(
          { from: position, to: position },
          true,
        );
        view.editor.focus();
      } catch (error) {
        console.debug("NovelView: could not reveal category section", error);
      }
    }, 30);
  }

  private getNovelSettingFile(folderPath: string): TFile | null {
    const normalized = this.normalizeFolderPath(folderPath);
    if (normalized === "/") {
      return null;
    }
    const path = getNovelSettingPath(normalized);
    const file = this.app.vault.getAbstractFileByPath(path);
    return file instanceof TFile && isNovelSettingFile(file) ? file : null;
  }

  private getFolder(folderPath: string): TFolder | null {
    const normalized = this.normalizeFolderPath(folderPath);
    if (normalized === "/") {
      return this.app.vault.getRoot();
    }

    const folder = this.app.vault.getAbstractFileByPath(normalized);
    return folder instanceof TFolder ? folder : null;
  }

  normalizeFolderPath(folderPath: string): string {
    if (!folderPath || folderPath === "/") {
      return "/";
    }

    return folderPath.replace(/^\/+|\/+$/gu, "");
  }

  private findNovelGroupRoot(startPath: string): string | null {
    let path = this.normalizeFolderPath(startPath);

    while (true) {
      if (this.getNovelSettingFile(path)) {
        return path;
      }
      if (path === "/") {
        return null;
      }

      const index = path.lastIndexOf("/");
      path = index <= 0 ? "/" : path.slice(0, index);
    }
  }

  private async saveNovelSetting(
    folderPath: string,
    data: {
      description: string;
      cover: string;
      state: NovelState;
    },
  ): Promise<void> {
    const settingFile = this.getNovelSettingFile(folderPath);
    if (!settingFile) {
      throw new Error("NovelSetting.md not found");
    }

    await this.app.fileManager.processFrontMatter(settingFile, (frontmatter) => {
      frontmatter["novelview-type"] = NOVEL_SETTING_TYPE;
      frontmatter["novel-description"] = data.description;
      frontmatter["novel-cover"] = normalizeCoverPath(data.cover);
      frontmatter["novelstate"] = NOVEL_STATE_LABELS[data.state];
    });

    this.refreshWorkbenchViews();
  }

  private async createNovelGroup(folder: TFolder): Promise<void> {
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
      this.scheduleNovelFolderDecoration();
      new Notice("NovelView：该文件夹已经是小说组。");
      return;
    }

    if (existing) {
      new Notice("NovelView：无法创建 NovelSetting，同名路径已存在。");
      return;
    }

    try {
      await this.app.vault.create(
        settingPath,
        createNovelSettingContent(folder.name),
      );
      this.workbenchFolderPath = folderPath;
      await this.openArticleList(folderPath);
      await this.activateWorkbench();
      this.refreshWorkbenchViews();
      this.refreshOpenViews();
      this.scheduleNovelFolderDecoration();
      new Notice(`NovelView：已创建小说组“${folder.name}”。`);
    } catch (error) {
      console.error("NovelView: failed to create novel group", error);
      new Notice("NovelView：小说组创建失败。");
    }
  }

  private registerNovelGroupEvents(): void {
    this.registerEvent(this.app.workspace.on("file-menu", (menu, file) => {
      this.addNovelGroupMenuItem(menu, file);
    }));

    this.registerDomEvent(document, "click", (event) => {
      this.handleNovelFolderClick(event);
    }, true);
  }

  private addNovelGroupMenuItem(menu: Menu, file: TAbstractFile): void {
    if (!(file instanceof TFolder) || this.normalizeFolderPath(file.path) === "/") {
      return;
    }

    menu.addItem((item) => {
      item
        .setTitle("构建小说组")
        .setIcon("book-plus")
        .onClick(() => {
          void this.createNovelGroup(file);
        });
    });
  }

  private handleNovelFolderClick(event: MouseEvent): void {
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
    void this.openArticleList(folder.path)
      .then(() => this.activateWorkbench())
      .then(() => this.refreshWorkbenchViews());
  }

  private setupNovelFolderObserver(): void {
    if (this.unloaded) {
      return;
    }

    const container = document.querySelector<HTMLElement>(".nav-files-container");
    if (
      container === this.folderDecorationContainer
      && this.folderDecorationObserver
    ) {
      this.scheduleNovelFolderDecoration();
      return;
    }

    this.folderDecorationObserver?.disconnect();
    this.folderDecorationObserver = null;
    this.folderDecorationContainer = container;

    if (container) {
      this.folderDecorationObserver = new MutationObserver(() => {
        this.scheduleNovelFolderDecoration();
      });
      this.folderDecorationObserver.observe(container, {
        childList: true,
        subtree: true,
      });
    }

    this.scheduleNovelFolderDecoration();
  }

  private scheduleNovelFolderDecoration(): void {
    if (this.folderDecorationFrame !== null) {
      return;
    }

    this.folderDecorationFrame = window.requestAnimationFrame(() => {
      this.folderDecorationFrame = null;
      this.decorateNovelFolderTitles();
    });
  }

  private decorateNovelFolderTitles(): void {
    if (this.unloaded) {
      return;
    }

    const titles = document.querySelectorAll<HTMLElement>(
      ".nav-folder-title[data-path]",
    );
    for (const title of titles) {
      const path = title.dataset.path;
      if (!path) {
        continue;
      }
      const isNovel = !!this.getNovelSettingFile(path);
      title.toggleClass("novelview-novel-folder-title", isNovel);
      const folderEl = title.closest<HTMLElement>(".nav-folder");
      folderEl?.toggleClass("novelview-novel-folder", isNovel);
    }
  }

  async openArticleList(folderPath: string): Promise<void> {
    const normalized = this.normalizeFolderPath(folderPath);
    this.workbenchFolderPath = normalized;
    const explorer = this.app.workspace.getLeavesOfType("file-explorer")[0];
    const leaf = explorer ?? this.app.workspace.getLeftLeaf(true);

    if (!leaf) {
      new Notice("NovelView：无法打开文章列表。");
      return;
    }

    try {
      await leaf.setViewState({
        type: ARTICLE_LIST_VIEW_TYPE,
        state: {
          folderPath: normalized,
        },
        active: true,
      });
      await this.app.workspace.revealLeaf(leaf);
    } catch (error) {
      console.error("NovelView: failed to open article list", error);
      new Notice("NovelView：文章列表打开失败。");
    }
  }

  async restoreFileExplorer(leaf?: WorkspaceLeaf): Promise<void> {
    const target = leaf
      ?? this.app.workspace.getLeavesOfType(ARTICLE_LIST_VIEW_TYPE)[0]
      ?? this.app.workspace.getLeftLeaf(false);

    if (!target) {
      new Notice("NovelView：无法回到文件列表。");
      return;
    }

    try {
      await target.setViewState({ type: "file-explorer", active: true });
      await this.app.workspace.revealLeaf(target);
    } catch (error) {
      console.error("NovelView: failed to restore file explorer", error);
      new Notice("NovelView：文件列表恢复失败。");
    }
  }

  getArticleListModel(folderPath: string): ArticleListModel | null {
    const novel = this.getNovelGroupInfo(folderPath);
    if (!novel) {
      return null;
    }

    const root = this.normalizeFolderPath(folderPath);
    const folder = this.getFolder(root);
    if (!folder) {
      return null;
    }

    const rootArticles: ArticleListModel["articles"] = [];
    const volumes: ArticleListModel["volumes"] = [];

    for (const child of folder.children) {
      if (child instanceof TFolder) {
        if (this.isReservedNovelFolder(child.name)) {
          continue;
        }

        const articles: ArticleListModel["articles"] = [];
        for (const nested of child.children) {
          if (
            nested instanceof TFile
            && nested.extension === "md"
            && !isNovelSettingFile(nested)
            && !isCategoryFileName(nested.basename)
            && !isOutlineFileName(nested.basename)
            && !this.hasFileReferenceProperty(nested)
          ) {
            articles.push({
              path: nested.path,
              basename: nested.basename,
            });
          }
        }
        articles.sort((left, right) => compareFilesNaturally(
          { basename: left.basename, path: left.path },
          { basename: right.basename, path: right.path },
        ));
        volumes.push({
          path: child.path,
          name: child.name,
          articles,
        });
      } else if (
        child instanceof TFile
        && child.extension === "md"
        && !isNovelSettingFile(child)
        && !isCategoryFileName(child.basename)
        && !isOutlineFileName(child.basename)
        && !this.hasFileReferenceProperty(child)
      ) {
        rootArticles.push({
          path: child.path,
          basename: child.basename,
        });
      }
    }

    const order = this.volumeOrder.get(root) ?? [];
    volumes.sort((left, right) => {
      const leftIndex = order.indexOf(left.name);
      const rightIndex = order.indexOf(right.name);
      if (leftIndex !== -1 || rightIndex !== -1) {
        if (leftIndex === -1) {
          return 1;
        }
        if (rightIndex === -1) {
          return -1;
        }
        return leftIndex - rightIndex;
      }
      return compareFilesNaturally(
        { basename: left.name, path: left.path },
        { basename: right.name, path: right.path },
      );
    });

    rootArticles.sort((left, right) => compareFilesNaturally(
      { basename: left.basename, path: left.path },
      { basename: right.basename, path: right.path },
    ));

    return {
      novel,
      folderPath: root,
      volumes,
      articles: rootArticles,
    };
  }

  async moveArticleToFolder(
    path: string,
    targetFolderPath: string,
  ): Promise<boolean> {
    const file = this.app.vault.getAbstractFileByPath(path);
    const target = this.getFolder(targetFolderPath);
    if (!(file instanceof TFile) || !target) {
      return false;
    }
    if (file.parent?.path === target.path) {
      return false;
    }

    const targetPath = joinVaultPath(target.path, file.name);
    if (this.app.vault.getAbstractFileByPath(targetPath)) {
      new Notice("NovelView：目标卷中已有同名文章。");
      return false;
    }

    try {
      await this.app.fileManager.renameFile(file, targetPath);
      return true;
    } catch (error) {
      console.error("NovelView: failed to move article", error);
      new Notice("NovelView：文章拖拽失败。");
      return false;
    }
  }

  reorderVolume(
    folderPath: string,
    draggedPath: string,
    targetPath: string,
  ): void {
    const root = this.normalizeFolderPath(folderPath);
    const folder = this.getFolder(root);
    if (!folder) {
      return;
    }

    const volumes = [...folder.children]
      .filter((child): child is TFolder => child instanceof TFolder)
      .filter((child) => !this.isReservedNovelFolder(child.name))
      .map((child) => child.name);
    const dragged = draggedPath.split("/").pop();
    const target = targetPath.split("/").pop();
    if (!dragged || !target || dragged === target) {
      return;
    }

    const order = (this.volumeOrder.get(root) ?? [...volumes])
      .filter((name) => volumes.includes(name));
    for (const name of volumes) {
      if (!order.includes(name)) {
        order.push(name);
      }
    }

    const from = order.indexOf(dragged);
    const to = order.indexOf(target);
    if (from === -1 || to === -1) {
      return;
    }
    order.splice(from, 1);
    order.splice(to, 0, dragged);
    this.volumeOrder.set(root, order);
    this.scheduleSave();
  }

  openArticleFromList(path: string, sourcePath: string): void {
    const file = this.app.vault.getAbstractFileByPath(path);
    if (!(file instanceof TFile)) {
      return;
    }

    void this.app.workspace.openLinkText(
      file.path,
      sourcePath,
      false,
      { active: true },
    );
  }

  showArticleListContextMenu(
    event: MouseEvent,
    folderPath: string,
    contextPath: string,
    refresh: () => void,
    target?: ArticleListTarget,
    onRename?: () => void,
  ): void {
    const menu = new Menu();

    if (target) {
      menu.addItem((item) => {
        item.setTitle("重命名").setIcon("pencil").onClick(() => {
          onRename?.();
        });
      });
      menu.addItem((item) => {
        item.setTitle("删除").setIcon("trash").onClick(() => {
          if (target.kind === "article") {
            this.deleteArticleTarget(target.path, refresh);
          } else {
            this.deleteVolumeTarget(target.path, refresh);
          }
        });
      });
      if (!target.virtual) {
        menu.addItem((item) => {
          item.setTitle("加入大纲").setIcon("list-tree").onClick(() => {
            void this.promptOutlineCard(
              folderPath,
              target.level,
              target.title,
            );
          });
        });
      }
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

  async renameArticlePath(
    path: string,
    value: string,
  ): Promise<string | null> {
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
    try {
      await this.app.fileManager.renameFile(file, nextPath);
      return null;
    } catch (error) {
      console.error("NovelView: failed to rename article", error);
      return "文章重命名失败。";
    }
  }

  private deleteArticleTarget(path: string, refresh: () => void): void {
    const file = this.app.vault.getAbstractFileByPath(path);
    if (!(file instanceof TFile)) {
      return;
    }
    void this.app.fileManager.promptForDeletion(file).then((confirmed) => {
      if (confirmed) {
        void this.app.vault.delete(file).then(refresh);
      }
    });
  }

  async renameVolumePath(
    path: string,
    value: string,
  ): Promise<string | null> {
    const folder = this.getFolder(path);
    if (!folder || folder.path === "/") {
      return "卷不存在。";
    }
    const name = this.sanitizeFileBase(value, folder.name);
    if (!name || name === folder.name) {
      return null;
    }
    if (this.isReservedNovelFolder(name)) {
      return "该名称是小说组保留名称。";
    }
    const parent = this.normalizeFolderPath(folder.parent?.path ?? "/");
    const nextPath = joinVaultPath(parent, name);
    if (this.app.vault.getAbstractFileByPath(nextPath)) {
      return "同名文件夹已存在。";
    }
    try {
      await this.app.fileManager.renameFile(folder, nextPath);
      return null;
    } catch (error) {
      console.error("NovelView: failed to rename volume", error);
      return "卷重命名失败。";
    }
  }

  private deleteVolumeTarget(path: string, refresh: () => void): void {
    const folder = this.getFolder(path);
    if (!folder || folder.path === "/") {
      return;
    }
    void this.app.fileManager.promptForDeletion(folder).then((confirmed) => {
      if (confirmed) {
        void this.app.vault.delete(folder).then(refresh);
      }
    });
  }

  private async createArticleInFolder(
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
    if (isCategoryFileName(base) || isOutlineFileName(base)) {
      new Notice("NovelView：该名称是小说组特殊文件保留名，请换一个标题。");
      return;
    }
    const path = this.getUniqueMarkdownPath(folder.path, base);
    const content = [
      "---",
      "novelstate: 写作",
      "---",
      "",
    ].join("\n");

    try {
      const file = await this.app.vault.create(path, content);
      const leaf = this.app.workspace.getLeaf("tab");
      await leaf.openFile(file, { active: true });
      new Notice(`NovelView：已创建文章“${title}”。`);
    } catch (error) {
      console.error("NovelView: failed to create article", error);
      new Notice("NovelView：文章创建失败。");
    }
  }

  private async createVolumeInFolder(folderPath: string): Promise<void> {
    const base = "无名卷";
    let name = base;
    let counter = 1;
    let path = joinVaultPath(this.normalizeFolderPath(folderPath), name);
    while (this.app.vault.getAbstractFileByPath(path)) {
      counter += 1;
      name = `${base} ${counter}`;
      path = joinVaultPath(this.normalizeFolderPath(folderPath), name);
    }

    try {
      await this.app.vault.createFolder(path);
      new Notice(`NovelView：已创建卷“${name}”。`);
    } catch (error) {
      console.error("NovelView: failed to create volume", error);
      new Notice("NovelView：卷创建失败。");
    }
  }

  async openNovelSrcGallery(folderPath: string): Promise<void> {
    const leaf = this.app.workspace.getLeaf("tab");
    await leaf.setViewState({
      type: SRC_GALLERY_VIEW_TYPE,
      state: { folderPath: this.normalizeFolderPath(folderPath) },
      active: true,
    });
    await this.app.workspace.revealLeaf(leaf);
  }

  async exportNovelGroup(folderPath: string): Promise<void> {
    const novel = this.getNovelGroupInfo(folderPath);
    if (!novel) {
      new Notice("NovelView：未找到小说组配置。");
      return;
    }

    const files = this.getNovelBodyFiles(folderPath);
    if (files.length === 0) {
      new Notice("NovelView：小说组中还没有正文。");
      return;
    }

    const exportFolderPath = joinVaultPath(
      this.normalizeFolderPath(folderPath),
      "导出",
    );
    const exportFolder = await this.ensureFolder(exportFolderPath);
    if (!exportFolder) {
      new Notice("NovelView：无法创建导出目录。");
      return;
    }

    const base = `${this.sanitizeFileBase(novel.name, "小说")} 合并稿`;
    const path = this.getUniqueMarkdownPath(exportFolderPath, base);
    const sections: string[] = [`# ${novel.name}`];
    if (novel.description) {
      sections.push(`> ${novel.description}`);
    }

    for (const file of files) {
      try {
        const content = await this.app.vault.read(file);
        const body = this.stripFrontmatter(content).trim();
        if (!body) {
          continue;
        }
        sections.push(body.startsWith("#")
          ? body
          : `## ${file.basename}\n\n${body}`);
      } catch (error) {
        console.error(`NovelView: failed to read ${file.path} for export`, error);
      }
    }

    const text = sections.join("\n\n---\n\n") + "\n";
    try {
      const exported = await this.app.vault.create(path, text);
      const leaf = this.app.workspace.getLeaf("tab");
      await leaf.openFile(exported, { active: true });
      new Notice(`NovelView：已导出合并稿“${novel.name}”。`);
    } catch (error) {
      console.error("NovelView: failed to export novel", error);
      new Notice("NovelView：导出失败。");
    }
  }

  private getNovelBodyFiles(folderPath: string): TFile[] {
    const root = this.normalizeFolderPath(folderPath);
    const rootFolder = this.getFolder(root);
    if (!rootFolder) {
      return [];
    }

    const result: TFile[] = [];
    if (!this.isPathInside(root, root)) {
      return result;
    }
    const walk = (folder: TFolder): void => {
      const children = [...folder.children].sort((left, right) => {
        const leftFolder = left instanceof TFolder ? 0 : 1;
        const rightFolder = right instanceof TFolder ? 0 : 1;
        if (leftFolder !== rightFolder) {
          return leftFolder - rightFolder;
        }
        const leftName = left instanceof TFile ? left.basename : left.name;
        const rightName = right instanceof TFile ? right.basename : right.name;
        return compareFilesNaturally(
          { basename: leftName, path: left.path },
          { basename: rightName, path: right.path },
        );
      });

      for (const child of children) {
        if (child instanceof TFolder) {
          if (!this.isReservedNovelFolder(child.name)) {
            walk(child);
          }
          continue;
        }
        if (child instanceof TFile && child.extension === "md") {
          if (
            isNovelSettingFile(child)
            || isCategoryFileName(child.basename)
            || isOutlineFileName(child.basename)
            || this.hasFileReferenceProperty(child)
          ) {
            continue;
          }
          result.push(child);
        }
      }
    };

    walk(rootFolder);
    return result;
  }

  private stripFrontmatter(content: string): string {
    const source = content.charCodeAt(0) === 0xfeff
      ? content.slice(1)
      : content;
    const lines = source.split(/\r?\n/u);
    const end = findFrontmatterEnd(
      (index) => lines[index] ?? null,
      lines.length,
    );
    return lines.slice(end).join("\n");
  }

  private isReservedNovelFolder(name: string): boolean {
    return /^(src|导出|设定|伏笔|人物|时间线|灵感|灵感便签|悬浮标签|分散卷)$/iu.test(name);
  }

  getSpecialPageKind(file: TFile): SpecialPageKind | null {
    const byName = getSpecialPageKindForName(file.basename);
    if (byName) {
      return byName;
    }

    const frontmatter = this.app.metadataCache.getFileCache(file)?.frontmatter;
    const type = frontmatter?.["novelview-type"];
    if (typeof type === "string" && type.trim().toLowerCase() === "outline") {
      return "outline";
    }
    if (frontmatter) {
      const categories = getReferenceCategories(frontmatter);
      if (categories[0]) {
        return categories[0];
      }
    }
    return null;
  }

  async openSpecialPage(
    file: TFile,
    line = 0,
    newLeaf = true,
  ): Promise<void> {
    const leaf = this.app.workspace.getLeaf(newLeaf ? "tab" : false);
    await leaf.setViewState({
      type: SPECIAL_PAGE_VIEW_TYPE,
      state: {
        filePath: file.path,
        line: line > 0 ? line : undefined,
      },
      active: true,
    });
    await this.app.workspace.revealLeaf(leaf);
  }

  private redirectSpecialFile(file: TFile): void {
    if (!this.getSpecialPageKind(file)) {
      return;
    }
    if (this.redirectingSpecialPaths.has(file.path)) {
      return;
    }

    const leaf = this.app.workspace
      .getLeavesOfType("markdown")
      .find((candidate) => (
        candidate.view instanceof MarkdownView
        && candidate.view.file?.path === file.path
      ));
    if (!leaf) {
      return;
    }

    this.redirectingSpecialPaths.add(file.path);
    window.setTimeout(() => {
      try {
        if (
          leaf.view instanceof MarkdownView
          && leaf.view.file?.path === file.path
        ) {
          void leaf.setViewState({
            type: SPECIAL_PAGE_VIEW_TYPE,
            state: { filePath: file.path },
            active: true,
          });
        }
      } finally {
        this.redirectingSpecialPaths.delete(file.path);
      }
    }, 20);
  }

  createInspirationNote(view: MarkdownView): void {
    const file = view.file;
    if (!file) {
      return;
    }
    const folderPath = this.findNovelGroupRoot(file.parent?.path ?? "/");
    if (!folderPath) {
      new Notice("NovelView：请先在小说组中使用“有了灵感”。");
      return;
    }
    if (this.inspirationNotes.size >= 8) {
      new Notice("NovelView：最多同时打开 8 个灵感便签，请先关闭一个。");
      return;
    }

    this.inspirationCounter += 1;
    const index = this.inspirationNotes.size;
    this.openInspirationNote({
      id: `inspiration-${Date.now()}-${this.inspirationCounter}`,
      title: formatInspirationTitle(new Date()),
      content: "",
      x: Math.max(12, window.innerWidth - 340 - (index % 4) * 20),
      y: 90 + (index % 6) * 22,
      folderPath,
      zIndex: 1000 + this.inspirationCounter,
    });
  }

  async restoreInspirationNote(
    folderPath: string,
    section: CategorySection,
  ): Promise<void> {
    const existing = [...this.inspirationNotes.values()].find((note) => {
      const data = note.getData();
      return data.folderPath === folderPath
        && data.sourceTitle === section.heading;
    });
    if (existing) {
      existing.focus();
      return;
    }
    if (this.inspirationNotes.size >= 8) {
      new Notice("NovelView：最多同时打开 8 个灵感便签，请先关闭一个。");
      return;
    }

    const category = await this.getCategoryData(folderPath, "inspiration");
    if (!category) {
      return;
    }
    const body = getCategorySectionBody(category.content, section);
    this.inspirationCounter += 1;
    const index = this.inspirationNotes.size;
    this.openInspirationNote({
      id: `inspiration-${Date.now()}-${this.inspirationCounter}`,
      title: section.heading,
      content: body,
      x: Math.max(12, window.innerWidth - 340 - (index % 4) * 20),
      y: 90 + (index % 6) * 22,
      folderPath,
      zIndex: 1000 + this.inspirationCounter,
      sourceTitle: section.heading,
    });
  }

  private openInspirationNote(data: InspirationNoteData): void {
    const note = new InspirationNote(data, {
      onClose: (target) => {
        void this.closeInspirationNote(target);
      },
      onRename: (target) => {
        this.renameInspirationNote(target);
      },
    });
    this.inspirationNotes.set(data.id, note);
  }

  private async closeInspirationNote(note: InspirationNote): Promise<void> {
    const data = note.getData();
    if (this.closingInspirationNotes.has(data.id)) {
      return;
    }
    const title = data.title.trim();
    if (!title) {
      new Notice("NovelView：灵感标题不能为空。");
      return;
    }
    this.closingInspirationNotes.add(data.id);

    try {
      const category = await this.getCategoryData(
        data.folderPath,
        "inspiration",
      );
      const duplicate = category?.sections.find(
        (section) => (
          section.heading === title
          && section.heading !== data.sourceTitle
        ),
      );
      if (duplicate) {
        new Notice("NovelView：已存在同名灵感，请右键重命名后再关闭。");
        return;
      }

      const source = data.sourceTitle && category
        ? category.sections.find(
          (section) => section.heading === data.sourceTitle,
        )
        : undefined;
      if (source && category) {
        const file = category.file;
        await this.app.vault.process(file, (content) => (
          replaceCategorySection(content, source, title, data.content)
        ));
        this.categoryCache.delete(file.path);
        this.refreshWorkbenchViews();
        this.scheduleKeywordRefresh();
      } else {
        await this.addCategorySection(
          data.folderPath,
          "inspiration",
          title,
          [],
          data.content,
          false,
        );
      }

      this.inspirationNotes.delete(data.id);
      note.destroy();
      this.refreshWorkbenchViews();
      new Notice("NovelView：灵感已保存到小说组的灵感文件。");
    } catch (error) {
      console.error("NovelView: failed to save inspiration note", error);
      new Notice("NovelView：灵感保存失败，便签保持打开。");
    } finally {
      this.closingInspirationNotes.delete(data.id);
    }
  }

  private renameInspirationNote(note: InspirationNote): void {
    const data = note.getData();
    new TextPromptModal(this.app, {
      title: "重命名灵感便签",
      initialValue: data.title,
      submitLabel: "保存",
      onSubmit: (title) => {
        note.setTitle(title);
      },
    }).open();
  }

  openFileFromWorkbench(file: TFile, newLeaf: boolean): void {
    if (this.getSpecialPageKind(file)) {
      void this.openSpecialPage(file, 0, true);
      return;
    }
    void this.app.workspace.openLinkText(
      file.path,
      this.lastActiveMarkdownPath ?? file.path,
      newLeaf,
    );
  }

  async activateWorkbench(): Promise<void> {
    const existing = this.app.workspace.getLeavesOfType(WORKBENCH_VIEW_TYPE);
    const mainLeaves: WorkspaceLeaf[] = [];

    for (const leaf of existing) {
      if (this.isLeafInSidebar(leaf)) {
        leaf.detach();
      } else {
        mainLeaves.push(leaf);
      }
    }

    if (mainLeaves[0]) {
      await this.app.workspace.revealLeaf(mainLeaves[0]);
      return;
    }

    try {
      const leaf = this.app.workspace.getLeaf("tab");
      await leaf.setViewState({ type: WORKBENCH_VIEW_TYPE, active: true });
      await this.app.workspace.revealLeaf(leaf);
    } catch (error) {
      console.error("NovelView: failed to open workbench", error);
      new Notice("NovelView：小说工作台打开失败。");
    }
  }

  refreshWorkbenchViews(): void {
    for (const leaf of this.app.workspace.getLeavesOfType(WORKBENCH_VIEW_TYPE)) {
      if (leaf.view instanceof NovelWorkbenchView) {
        leaf.view.scheduleRefresh();
      }
    }
  }

  private removeSidebarWorkbenchInstances(): void {
    for (const leaf of this.app.workspace.getLeavesOfType(WORKBENCH_VIEW_TYPE)) {
      if (this.isLeafInSidebar(leaf)) {
        leaf.detach();
      }
    }
  }

  async openAdvancedSearch(): Promise<void> {
    if (this.unloaded) {
      return;
    }

    if (!this.getLastActiveMarkdownFile()) {
      new Notice("NovelView：请先打开一篇小说章节。");
      return;
    }

    await this.ensureSearchResultsView();
    const panel = this.ensureSearchPanel();
    this.updateSearchScopeLabel(this.getSearchScope());
    panel.open(this.searchUiState);
    this.updateSearchResultsView();

    if (this.searchUiState.query.length > 0) {
      this.scheduleSearch(true);
    } else {
      panel.setBusy(false);
      panel.setCanReplace(false);
      panel.setStatus("输入内容后在当前小说目录中查找。", "idle");
    }
  }

  async rerunSearch(): Promise<void> {
    const state = this.searchPanel?.getState() ?? this.searchUiState;
    this.searchUiState = state;
    if (state.query.length === 0) {
      this.searchResponse = null;
      this.updateSearchResultsView();
      return;
    }
    await this.executeSearch(state);
  }

  async openSearchMatch(path: string, match: SearchMatch): Promise<void> {
    const file = this.app.vault.getAbstractFileByPath(path);
    if (!(file instanceof TFile)) {
      return;
    }

    await this.app.workspace.openLinkText(
      file.path,
      this.lastActiveMarkdownPath ?? file.path,
      false,
      {
        active: true,
        eState: {
          line: Math.max(0, match.line - 1),
          ch: Math.max(0, match.column - 1),
        },
      },
    );

    window.setTimeout(() => {
      let view = this.getActiveMarkdownView();
      if (!view?.file || view.file.path !== file.path) {
        view = null;
        for (const leaf of this.app.workspace.getLeavesOfType("markdown")) {
          if (
            leaf.view instanceof MarkdownView
            && leaf.view.file?.path === file.path
          ) {
            view = leaf.view;
            break;
          }
        }
      }

      if (!view?.file || view.file.path !== file.path) {
        return;
      }

      try {
        this.app.workspace.revealLeaf(view.leaf);
        const from = view.editor.offsetToPos(match.offset);
        const to = view.editor.offsetToPos(match.offset + match.length);
        view.editor.setSelection(from, to);
        view.editor.scrollIntoView({ from, to }, true);
        view.editor.focus();
      } catch (error) {
        console.debug("NovelView: could not reveal search match", error);
      }
    }, 30);
  }

  private ensureSearchPanel(): AdvancedSearchPanel {
    if (!this.searchPanel) {
      this.searchPanel = new AdvancedSearchPanel({
        onSearchChange: (state, immediate) => {
          this.searchUiState = state;
          this.scheduleSearch(immediate);
        },
        onReplaceAll: (state) => {
          this.searchUiState = state;
          void this.replaceAllMatches(state);
        },
        onClose: (state) => {
          this.searchUiState = state;
          this.cancelScheduledSearch();
        },
      });
    }

    return this.searchPanel;
  }

  private async ensureSearchResultsView(): Promise<void> {
    const existing = this.app.workspace.getLeavesOfType(
      SEARCH_RESULTS_VIEW_TYPE,
    )[0];
    if (existing) {
      await this.app.workspace.revealLeaf(existing);
      return;
    }

    const leaf = this.app.workspace.getRightLeaf(false)
      ?? this.app.workspace.getRightLeaf(true);
    if (!leaf) {
      new Notice("NovelView：无法创建右侧查找结果视图。");
      return;
    }

    try {
      await leaf.setViewState({
        type: SEARCH_RESULTS_VIEW_TYPE,
        active: false,
      });
      await this.app.workspace.revealLeaf(leaf);
    } catch (error) {
      console.error("NovelView: failed to open search results", error);
      new Notice("NovelView：查找结果视图打开失败。");
    }
  }

  private getSearchScope(): SearchScope | null {
    const file = this.getLastActiveMarkdownFile();
    if (!file) {
      return null;
    }

    const parentPath = this.normalizeFolderPath(file.parent?.path ?? "/");
    return {
      folderPath: parentPath,
      files: this.getChapterFilesInFolder(parentPath),
    };
  }

  private updateSearchScopeLabel(
    scope: SearchScope | null = this.getSearchScope(),
  ): void {
    if (!scope) {
      this.searchPanel?.setScope("范围：请先打开一篇小说章节");
      return;
    }

    const folder = scope.folderPath || "Vault 根目录";
    this.searchPanel?.setScope(
      `范围：${folder} · ${scope.files.length} 个小说文件`,
    );
  }

  private scheduleSearch(immediate: boolean): void {
    this.cancelScheduledSearch();
    this.searchRequestId += 1;
    const state = this.searchUiState;
    if (!this.searchPanel?.isOpen) {
      return;
    }

    if (state.query.length === 0) {
      this.searchResponse = null;
      this.searchPanel.setBusy(false);
      this.searchPanel.setCanReplace(false);
      this.searchPanel.setStatus("输入内容后在当前小说目录中查找。", "idle");
      this.updateSearchScopeLabel(this.getSearchScope());
      this.updateSearchResultsView();
      return;
    }

    this.searchPanel.setBusy(true);
    this.searchPanel.setCanReplace(false);
    this.searchPanel.setStatus("正在查找…", "searching");

    if (immediate) {
      void this.executeSearch(state);
      return;
    }

    this.searchDebounceTimer = window.setTimeout(() => {
      this.searchDebounceTimer = null;
      void this.executeSearch(state);
    }, 250);
  }

  private cancelScheduledSearch(): void {
    if (this.searchDebounceTimer !== null) {
      window.clearTimeout(this.searchDebounceTimer);
      this.searchDebounceTimer = null;
    }
  }

  private async executeSearch(
    state: SearchUiState,
    liveEditors = true,
  ): Promise<SearchResponse | null> {
    if (this.unloaded) {
      return null;
    }

    const requestId = ++this.searchRequestId;
    const panel = this.searchPanel;
    const scope = this.getSearchScope();
    this.updateSearchScopeLabel(scope);
    panel?.setBusy(true);
    panel?.setCanReplace(false);
    panel?.setStatus("正在查找…", "searching");
    this.setSearchResultsLoading(state.query);

    if (state.query.length === 0) {
      this.searchResponse = null;
      panel?.setBusy(false);
      panel?.setStatus("输入内容后在当前小说目录中查找。", "idle");
      this.updateSearchResultsView();
      return null;
    }

    const compiled = compileSearchExpression(state);
    if (compiled.error) {
      const response = this.makeSearchErrorResponse(
        state,
        compiled.error,
        scope?.folderPath ?? "",
        scope?.files.length ?? 0,
      );
      this.applySearchResponse(response, requestId);
      return response;
    }

    if (!scope) {
      const response = this.makeSearchErrorResponse(
        state,
        "请先打开一篇小说章节。",
        "",
        0,
      );
      this.applySearchResponse(response, requestId);
      return response;
    }

    if (scope.files.length === 0) {
      const response = this.makeSearchErrorResponse(
        state,
        "当前目录下没有可搜索的小说文件。",
        scope.folderPath,
        0,
      );
      this.applySearchResponse(response, requestId);
      return response;
    }

    if (!compiled.regex) {
      return null;
    }

    const liveContents = liveEditors
      ? this.getLiveMarkdownContents()
      : new Map<string, string>();
    const contents = await Promise.all(scope.files.map(async (file) => {
      const live = liveContents.get(file.path);
      if (typeof live === "string") {
        return { file, text: live };
      }
      try {
        return { file, text: await this.app.vault.read(file) };
      } catch (error) {
        console.error(`NovelView: failed to read ${file.path}`, error);
        return { file, text: null };
      }
    }));

    if (requestId !== this.searchRequestId || this.unloaded) {
      return null;
    }

    const files: SearchFileResult[] = [];
    let totalMatches = 0;
    let truncated = false;

    for (const entry of contents) {
      if (entry.text === null) {
        continue;
      }

      const remaining = MAX_SEARCH_RESULTS - totalMatches;
      const limit = Math.min(MAX_FILE_SEARCH_RESULTS, remaining);
      if (limit <= 0) {
        truncated = true;
        break;
      }

      const result = findSearchMatches(entry.text, compiled.regex, limit);
      if (result.matches.length > 0) {
        files.push({
          path: entry.file.path,
          basename: entry.file.basename,
          folderPath: entry.file.parent?.path ?? "",
          matches: result.matches,
        });
        totalMatches += result.matches.length;
      }
      if (result.truncated) {
        truncated = true;
      }
      if (totalMatches >= MAX_SEARCH_RESULTS) {
        truncated = true;
        break;
      }
    }

    const response: SearchResponse = {
      query: state.query,
      options: {
        query: state.query,
        caseSensitive: state.caseSensitive,
        wholeWord: state.wholeWord,
        regex: state.regex,
      },
      folderPath: scope.folderPath,
      files,
      totalMatches,
      scannedFiles: scope.files.length,
      truncated,
    };
    this.applySearchResponse(response, requestId);
    return response;
  }

  private applySearchResponse(
    response: SearchResponse,
    requestId = this.searchRequestId,
  ): void {
    if (requestId !== this.searchRequestId) {
      return;
    }

    this.searchResponse = response;
    const panel = this.searchPanel;
    panel?.setBusy(false);

    if (!panel) {
      this.updateSearchResultsView();
      return;
    }

    if (response.error) {
      panel.setCanReplace(false);
      panel.setStatus(response.error, "error");
    } else if (response.totalMatches === 0) {
      panel.setCanReplace(false);
      panel.setStatus("当前目录没有找到匹配。", "empty");
    } else {
      panel.setCanReplace(!response.truncated);
      const suffix = response.truncated ? "（结果已截断）" : "";
      panel.setStatus(
        `找到 ${response.totalMatches} 处匹配 · ${response.files.length} 个文件${suffix}`,
        "found",
      );
    }

    const folder = response.folderPath || "Vault 根目录";
    panel.setScope(`范围：${folder} · ${response.scannedFiles} 个小说文件`);
    this.updateSearchResultsView();
  }

  private makeSearchErrorResponse(
    state: SearchUiState,
    error: string,
    folderPath: string,
    scannedFiles: number,
  ): SearchResponse {
    return {
      query: state.query,
      options: {
        query: state.query,
        caseSensitive: state.caseSensitive,
        wholeWord: state.wholeWord,
        regex: state.regex,
      },
      folderPath,
      files: [],
      totalMatches: 0,
      scannedFiles,
      truncated: false,
      error,
    };
  }

  private setSearchResultsLoading(query: string): void {
    for (const leaf of this.app.workspace.getLeavesOfType(
      SEARCH_RESULTS_VIEW_TYPE,
    )) {
      if (leaf.view instanceof NovelSearchResultsView) {
        leaf.view.setLoading(query);
      }
    }
  }

  private updateSearchResultsView(): void {
    for (const leaf of this.app.workspace.getLeavesOfType(
      SEARCH_RESULTS_VIEW_TYPE,
    )) {
      if (leaf.view instanceof NovelSearchResultsView) {
        leaf.view.setResponse(this.searchResponse);
      }
    }
  }

  private getLiveMarkdownContents(): Map<string, string> {
    const contents = new Map<string, string>();
    for (const leaf of this.app.workspace.getLeavesOfType("markdown")) {
      if (!(leaf.view instanceof MarkdownView) || !leaf.view.file) {
        continue;
      }
      try {
        const text = leaf.view.editor?.getValue();
        if (typeof text === "string") {
          contents.set(leaf.view.file.path, text);
        }
      } catch (error) {
        console.debug("NovelView: could not read live editor content", error);
      }
    }
    return contents;
  }

  private async saveOpenScopedFiles(files: TFile[]): Promise<boolean> {
    const paths = new Set(files.map((file) => file.path));
    for (const leaf of this.app.workspace.getLeavesOfType("markdown")) {
      const view = leaf.view;
      if (
        !(view instanceof MarkdownView)
        || !view.file
        || !paths.has(view.file.path)
      ) {
        continue;
      }
      try {
        await view.save(false);
      } catch (error) {
        console.error("NovelView: could not save file before replace", error);
        new Notice(`NovelView：无法保存 ${view.file.basename}，已取消替换。`);
        return false;
      }
    }
    return true;
  }

  private async replaceAllMatches(state: SearchUiState): Promise<void> {
    if (this.replacing) {
      return;
    }

    this.searchUiState = state;
    if (state.query.length === 0) {
      new Notice("NovelView：请先输入查找内容。");
      return;
    }

    const compiled = compileSearchExpression(state);
    if (compiled.error || !compiled.regex) {
      new Notice(`NovelView：${compiled.error ?? "查找表达式无效。"}`);
      return;
    }

    const scope = this.getSearchScope();
    if (!scope) {
      new Notice("NovelView：请先打开一篇小说章节。");
      return;
    }

    this.replacing = true;
    const panel = this.searchPanel;
    try {
      panel?.setBusy(true);
      panel?.setCanReplace(false);
      panel?.setStatus("正在准备替换…", "searching");

      if (
        !await this.saveOpenScopedFiles(scope.files)
        || !this.isSameSearchRequest(state, this.searchUiState)
      ) {
        return;
      }

      const response = await this.executeSearch(state, false);
      if (
        !response
        || response.error
        || !this.isSameSearchRequest(state, this.searchUiState)
      ) {
        return;
      }

      if (response.truncated) {
        new Notice("NovelView：结果过多，请缩小查找范围后再替换。");
        return;
      }

      if (response.totalMatches === 0) {
        new Notice("NovelView：没有可替换的匹配。");
        return;
      }

      if (!await confirmReplaceAll(this.app, {
        files: response.files.length,
        matches: response.totalMatches,
        folderPath: response.folderPath,
        query: state.query,
        replacement: state.replacement,
        truncated: response.truncated,
      }) || this.unloaded) {
        return;
      }

      const regex = compileSearchExpression(state).regex;
      if (!regex) {
        return;
      }

      panel?.setBusy(true);
      panel?.setCanReplace(false);
      panel?.setStatus("正在替换…", "searching");

      let replaced = 0;
      let changedFiles = 0;
      const failed: string[] = [];

      for (const result of response.files) {
        if (this.unloaded) {
          break;
        }
        const file = this.app.vault.getAbstractFileByPath(result.path);
        if (!(file instanceof TFile)) {
          failed.push(result.path);
          continue;
        }

        let count = 0;
        try {
          await this.app.vault.process(file, (content) => {
            const replacedResult = replaceSearchMatches(
              content,
              regex,
              state.replacement,
              state.regex,
            );
            count = replacedResult.count;
            return replacedResult.text;
          });
          if (count > 0) {
            changedFiles += 1;
            replaced += count;
          }
        } catch (error) {
          console.error(`NovelView: failed to replace in ${file.path}`, error);
          failed.push(file.path);
        }
      }

      if (failed.length > 0) {
        new Notice(
          `NovelView：已替换 ${replaced} 处（${changedFiles} 个文件），${failed.length} 个文件失败。`,
          7000,
        );
      } else {
        new Notice(
          `NovelView：已在 ${changedFiles} 个文件中替换 ${replaced} 处匹配。`,
        );
      }

      const next = this.searchPanel?.getState() ?? state;
      this.searchUiState = next;
      await this.executeSearch(next, false);
    } catch (error) {
      console.error("NovelView: replace all failed", error);
      new Notice("NovelView：替换过程中发生错误。");
    } finally {
      this.replacing = false;
      this.searchPanel?.setBusy(false);
    }
  }

  private isSameSearchRequest(
    left: SearchUiState,
    right: SearchUiState,
  ): boolean {
    return left.query === right.query
      && left.caseSensitive === right.caseSensitive
      && left.wholeWord === right.wholeWord
      && left.regex === right.regex;
  }

  getActiveMarkdownView(): MarkdownView | null {
    return this.app.workspace.getActiveViewOfType(MarkdownView);
  }

  private isLeafInSidebar(leaf: WorkspaceLeaf): boolean {
    return !!leaf.view.containerEl.closest(
      ".workspace-split.mod-left-split, .workspace-split.mod-right-split",
    );
  }

  private rememberActiveMarkdownFile(): void {
    const view = this.getActiveMarkdownView();
    if (!view?.file) {
      return;
    }

    this.lastActiveMarkdownPath = view.file.path;
  }

  private isPathInside(path: string, root: string): boolean {
    if (root === "/") {
      return true;
    }
    return path === root || path.startsWith(`${root}/`);
  }

  private getLiveReferenceCategories(view: MarkdownView): ReferenceCategory[] {
    const content = view.editor?.getValue();
    if (!content) {
      return [];
    }

    const lines = content.split(/\r?\n/u);
    const end = findFrontmatterEnd(
      (index) => lines[index] ?? null,
      lines.length,
    );
    if (end === 0) {
      return [];
    }

    try {
      const frontmatter = parseYaml(lines.slice(1, end - 1).join("\n"));
      return getReferenceCategories(
        frontmatter && typeof frontmatter === "object"
          ? frontmatter as Record<string, unknown>
          : undefined,
      );
    } catch (error) {
      console.debug("NovelView: could not parse live frontmatter", error);
      return [];
    }
  }

  private hasFileReferenceProperty(file: TFile): boolean {
    const cache = this.app.metadataCache.getFileCache(file);
    return hasReferenceProperty(cache?.frontmatter);
  }

  private registerCommands(): void {
    this.addCommand({
      id: "open-advanced-search",
      name: "打开高级查找/替换",
      icon: "search",
      checkCallback: (checking) => {
        if (!this.getLastActiveMarkdownFile()) {
          return false;
        }

        if (!checking) {
          void this.openAdvancedSearch();
        }
        return true;
      },
    });
  }

  private refreshOpenViews(): void {
    if (this.unloaded) {
      return;
    }

    this.pruneViewActions();

    for (const leaf of this.app.workspace.getLeavesOfType("markdown")) {
      if (!(leaf.view instanceof MarkdownView)) {
        continue;
      }

      this.ensureViewAction(leaf.view);
      this.syncView(leaf.view);
    }
  }

  private pruneViewActions(): void {
    for (const [view, action] of this.searchActions) {
      if (!view.containerEl.isConnected || !action.isConnected) {
        action.remove();
        this.searchActions.delete(view);
      }
    }

    for (const [view, toolbar] of this.novelToolbars) {
      if (!view.containerEl.isConnected) {
        toolbar.destroy();
        this.novelToolbars.delete(view);
      }
    }

    for (const [view, card] of this.articleStatusCards) {
      if (!view.containerEl.isConnected) {
        card.remove();
        view.containerEl.removeClass("novelview-status-host");
        const timer = this.articleStatusTimers.get(view);
        if (timer !== undefined) {
          window.clearInterval(timer);
          this.articleStatusTimers.delete(view);
        }
        this.articleStatusCards.delete(view);
      }
    }
  }

  private ensureViewAction(view: MarkdownView): void {
    if (!this.searchActions.has(view)) {
      try {
        const action = view.addAction(
          "search",
          "NovelView：高级查找/替换",
          () => {
            void this.openAdvancedSearch();
          },
        );
        action.addClass("novelview-search-action");
        this.searchActions.set(view, action);
      } catch (error) {
        console.debug("NovelView: search action could not be attached", error);
      }
    }

    if (!this.observedViews.has(view)) {
      this.observedViews.add(view);
      // The public API does not expose a "mode changed" event. Update the
      // header icon after clicks too, so switching between edit and reading
      // views keeps the matching icon.
      view.containerEl.addEventListener("click", (event) => {
        const target = event.target as HTMLElement | null;
        const keyword = target?.closest<HTMLElement>(".novelview-keyword-link");
        if (keyword) {
          const path = keyword.getAttribute("data-novelview-path");
          if (path) {
            const line = Number(keyword.getAttribute("data-novelview-line") ?? "1");
            event.preventDefault();
            event.stopPropagation();
            this.openKeywordTarget(path, Number.isFinite(line) ? line : 1);
            return;
          }
        }

        window.setTimeout(() => {
          if (!this.unloaded) {
            this.refreshOpenViews();
          }
        }, 80);
      }, true);
    }
  }

  private syncView(view: MarkdownView): void {
    const enabled = this.isNovelModeEnabled(view);
    const contentEl = view.contentEl;
    const hasModeClass = contentEl.hasClass(MODE_CLASS);

    if (enabled && !hasModeClass) {
      contentEl.addClass(MODE_CLASS);
      this.applyModeStyles(contentEl);
      this.refreshEditor(view);
      this.refreshNovelKeywordSurface(view);
    } else if (!enabled && hasModeClass) {
      this.clearNovelModeStyles(contentEl);
      this.refreshEditor(view);
      this.refreshNovelKeywordSurface(view);
    }

    this.syncFloatingToolbar(view, enabled);
    this.syncArticleStatus(view, enabled);
  }

  private syncArticleStatus(view: MarkdownView, enabled: boolean): void {
    if (!enabled || !view.file) {
      this.destroyArticleStatus(view);
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
      card.addEventListener("click", () => {
        if (!view.file) {
          return;
        }
        const groupRoot = this.findNovelGroupRoot(view.file.parent?.path ?? "/");
        if (groupRoot) {
          this.openNovelGroupSettings(groupRoot);
        }
      });
      view.containerEl.addClass("novelview-status-host");
      this.articleStatusCards.set(view, card);
    }

    this.updateArticleStatus(view);

    if (!this.articleStatusTimers.has(view)) {
      const timer = window.setInterval(() => {
        if (this.unloaded || !view.containerEl.isConnected) {
          this.destroyArticleStatus(view);
          return;
        }
        this.updateArticleStatus(view);
      }, 800);
      this.articleStatusTimers.set(view, timer);
    }
  }

  private updateArticleStatus(view: MarkdownView): void {
    if (!view.file) {
      return;
    }

    const card = this.articleStatusCards.get(view);
    if (!card) {
      return;
    }

    const content = view.editor?.getValue()
      ?? view.getViewData()
      ?? "";
    const characters = countNovelCharacters(content);
    const state = this.getNovelStateForFile(view.file);
    card.empty();

    card.createSpan({
      cls: "novelview-article-status-count",
      text: `${new Intl.NumberFormat("zh-CN").format(characters)} 字`,
    });
    const badge = card.createSpan({
      cls: "novelview-article-status-state",
      text: NOVEL_STATE_LABELS[state],
    });
    badge.dataset.state = state;
    card.setAttr("title", `当前文章 ${characters} 字 · 状态 ${NOVEL_STATE_LABELS[state]}`);
  }

  private getNovelStateForFile(file: TFile): NovelState {
    const cache = this.app.metadataCache.getFileCache(file);
    const ownState = this.readNovelStateFromFrontmatter(cache?.frontmatter);
    if (ownState) {
      return ownState;
    }

    const groupRoot = this.findNovelGroupRoot(file.parent?.path ?? "/");
    if (groupRoot) {
      const group = this.getNovelGroupInfo(groupRoot);
      if (group) {
        return group.state;
      }
    }

    return "writing";
  }

  private readNovelStateFromFrontmatter(
    frontmatter: Record<string, unknown> | undefined,
  ): NovelState | null {
    if (!frontmatter) {
      return null;
    }

    for (const [key, value] of Object.entries(frontmatter)) {
      const normalizedKey = key.toLowerCase();
      if (normalizedKey === "novelstate" || normalizedKey === "状态") {
        const state = parseNovelState(value);
        if (state) {
          return state;
        }
      }
    }

    return null;
  }

  private destroyArticleStatus(view: MarkdownView): void {
    const card = this.articleStatusCards.get(view);
    if (card) {
      card.remove();
      this.articleStatusCards.delete(view);
      view.containerEl.removeClass("novelview-status-host");
    }
    const timer = this.articleStatusTimers.get(view);
    if (timer !== undefined) {
      window.clearInterval(timer);
      this.articleStatusTimers.delete(view);
    }
  }

  private scheduleKeywordRefresh(): void {
    if (this.keywordRefreshTimer !== null) {
      window.clearTimeout(this.keywordRefreshTimer);
    }
    this.keywordRefreshTimer = window.setTimeout(() => {
      this.keywordRefreshTimer = null;
      void this.refreshKeywordIndex();
    }, 160);
  }

  private async refreshKeywordIndex(): Promise<void> {
    const current = this.getLastActiveMarkdownFile();
    if (!current) {
      setNovelKeywords([]);
      refreshNovelKeywords();
      return;
    }

    const parentPath = this.normalizeFolderPath(current.parent?.path ?? "/");
    const root = this.findNovelGroupRoot(parentPath);
    if (!root) {
      setNovelKeywords([]);
      refreshNovelKeywords();
      return;
    }

    const entries = await this.buildKeywordEntriesForGroup(root);
    const signature = entries
      .map((entry) => `${entry.keyword}\u0000${entry.path}\u0000${entry.line ?? 0}\u0000${entry.category ?? ""}`)
      .join("\u0001");
    this.keywordGroupCache.set(root, { signature, entries });
    setNovelKeywords(entries);

    if (signature === this.keywordSignature) {
      return;
    }
    this.keywordSignature = signature;
    refreshNovelKeywords();

    for (const leaf of this.app.workspace.getLeavesOfType("markdown")) {
      if (
        leaf.view instanceof MarkdownView
        && leaf.view.file
        && leaf.view.getMode() === "preview"
        && this.isNovelModeEnabled(leaf.view)
      ) {
        try {
          leaf.view.previewMode.rerender(true);
        } catch (error) {
          console.debug("NovelView: preview keyword refresh failed", error);
        }
      }
    }
  }

  private async buildKeywordEntriesForGroup(
    root: string,
  ): Promise<KeywordEntry[]> {
    const sources: Array<{
      path: string;
      basename: string;
      keywords: string[];
      category: ReferenceCategory;
      line: number;
      heading: string;
    }> = [];

    for (const category of REFERENCE_CATEGORIES) {
      const data = await this.getCategoryData(root, category);
      if (!data) {
        continue;
      }

      for (const section of data.sections) {
        sources.push({
          path: data.file.path,
          basename: data.file.basename,
          keywords: [section.heading, ...section.keywords],
          category,
          line: section.headingLine,
          heading: section.heading,
        });
      }
    }

    return buildKeywordEntries(sources);
  }

  private refreshNovelKeywordSurface(view: MarkdownView): void {
    refreshNovelKeywords();
    if (view.getMode() === "preview") {
      try {
        view.previewMode.rerender(true);
      } catch (error) {
        console.debug("NovelView: preview keyword refresh failed", error);
      }
    }
  }

  private openKeywordTarget(path: string, line: number): void {
    const file = this.app.vault.getAbstractFileByPath(path);
    if (file instanceof TFile) {
      void this.openFileAtLine(file, line);
    }
  }

  private decorateReadingKeywords(
    element: HTMLElement,
    sourcePath: string,
  ): void {
    const source = this.app.vault.getAbstractFileByPath(sourcePath);
    if (!(source instanceof TFile) || !this.isForcedNovelMode(source)) {
      return;
    }
    const parentPath = this.normalizeFolderPath(source.parent?.path ?? "/");
    const root = this.findNovelGroupRoot(parentPath);
    if (!root) {
      return;
    }

    const cached = this.keywordGroupCache.get(root);
    if (cached) {
      linkKeywordsInElement(element, cached.entries);
      return;
    }

    void this.buildKeywordEntriesForGroup(root).then((entries) => {
      this.keywordGroupCache.set(root, {
        signature: entries
          .map((entry) => `${entry.keyword}\u0000${entry.path}\u0000${entry.line ?? 0}`)
          .join("\u0001"),
        entries,
      });
      if (element.isConnected && this.isForcedNovelMode(source)) {
        linkKeywordsInElement(element, entries);
      }
    });
  }

  private async insertNovelImage(view: MarkdownView): Promise<void> {
    const source = view.file;
    if (!source || view.getMode() === "preview") {
      return;
    }

    const file = await this.chooseLocalImage();
    if (!file) {
      return;
    }

    const groupRoot = this.findNovelGroupRoot(source.parent?.path ?? "/");
    const targetFolder = groupRoot
      ? joinVaultPath(groupRoot, "src")
      : undefined;
    const saved = await this.saveImageToVault(
      file,
      source.path,
      targetFolder,
    );
    if (!saved) {
      return;
    }

    if (view.file?.path !== source.path) {
      new Notice("NovelView：图片已保存，但当前编辑的文件已切换。");
      return;
    }

    const editor = view.editor;
    const selection = editor.getSelection();
    const embed = `![[${saved.path}]]`;
    if (selection.length > 0) {
      editor.replaceSelection(embed);
    } else {
      const cursor = editor.getCursor();
      const prefix = cursor.ch === 0 ? "" : "\n\n";
      editor.replaceSelection(`${prefix}${embed}\n`);
    }
    editor.focus();
    new Notice(`NovelView：已插入图片 ${saved.basename}。`);
  }

  private async saveImageToVault(
    file: File,
    sourcePath: string,
    targetFolderPath?: string,
  ): Promise<TFile | null> {
    const extension = file.name.split(".").pop()?.toLowerCase() ?? "";
    const imageExtensions = new Set(["png", "jpg", "jpeg", "gif", "webp", "svg", "bmp", "avif"]);
    if (!file.type.startsWith("image/") && !imageExtensions.has(extension)) {
      new Notice("NovelView：请选择图片文件。");
      return null;
    }

    const safeName = this.sanitizeFileBase(file.name, "image");
    try {
      const buffer = await file.arrayBuffer();
      if (targetFolderPath) {
        const folder = await this.ensureFolder(targetFolderPath);
        if (!folder) {
          new Notice("NovelView：无法创建 src 素材目录。");
          return null;
        }
        const path = this.getUniqueFilePath(targetFolderPath, safeName);
        return await this.app.vault.createBinary(path, buffer);
      }

      const path = await this.app.fileManager.getAvailablePathForAttachment(
        safeName,
        sourcePath,
      );
      return await this.app.vault.createBinary(path, buffer);
    } catch (error) {
      console.error("NovelView: failed to save image", error);
      new Notice("NovelView：图片保存失败。");
      return null;
    }
  }

  private chooseLocalImage(): Promise<File | null> {
    return new Promise((resolve) => {
      const input = createEl("input");
      input.type = "file";
      input.accept = "image/*";
      input.addClass("novelview-hidden-file-input");
      document.body.appendChild(input);

      let settled = false;
      let focusTimer: number | null = null;

      const finish = (file: File | null): void => {
        if (settled) {
          return;
        }
        settled = true;
        if (focusTimer !== null) {
          window.clearTimeout(focusTimer);
        }
        input.remove();
        resolve(file);
      };

      input.addEventListener("change", () => {
        finish(input.files?.[0] ?? null);
      });
      input.addEventListener("cancel", () => finish(null));

      window.addEventListener("focus", () => {
        focusTimer = window.setTimeout(() => {
          finish(input.files?.[0] ?? null);
        }, 500);
      }, { once: true });

      input.click();
    });
  }

  private async pickCoverImage(sourcePath: string): Promise<string | null> {
    const file = await this.chooseLocalImage();
    if (!file) {
      return null;
    }

    const saved = await this.saveImageToVault(file, sourcePath);
    return saved?.path ?? null;
  }

  private async ensureFolder(path: string): Promise<TFolder | null> {
    if (!path || path === "/") {
      return this.app.vault.getRoot();
    }

    const existing = this.app.vault.getAbstractFileByPath(path);
    if (existing instanceof TFolder) {
      return existing;
    }
    if (existing) {
      return null;
    }

    try {
      return await this.app.vault.createFolder(path);
    } catch (error) {
      console.error("NovelView: failed to create folder", error);
      return null;
    }
  }

  private sanitizeFileBase(value: string, fallback: string): string {
    const base = value
      .replace(/[\\/:*?"<>|#^[\]]/gu, "-")
      .replace(/[\u0000-\u001f]/gu, "")
      .replace(/\s+/gu, " ")
      .replace(/^\.+|\.+$/gu, "")
      .trim()
      .slice(0, 80);

    return base || fallback;
  }

  private getUniqueMarkdownPath(folderPath: string, base: string): string {
    let counter = 1;
    let name = base;
    let path = joinVaultPath(folderPath, `${name}.md`);

    while (this.app.vault.getAbstractFileByPath(path)) {
      counter += 1;
      name = `${base} ${counter}`;
      path = joinVaultPath(folderPath, `${name}.md`);
    }

    return path;
  }

  private getUniqueFilePath(folderPath: string, fileName: string): string {
    const dot = fileName.lastIndexOf(".");
    const base = dot > 0 ? fileName.slice(0, dot) : fileName;
    const extension = dot > 0 ? fileName.slice(dot) : "";
    let counter = 1;
    let name = fileName;
    let path = joinVaultPath(folderPath, name);

    while (this.app.vault.getAbstractFileByPath(path)) {
      counter += 1;
      name = `${base} ${counter}${extension}`;
      path = joinVaultPath(folderPath, name);
    }

    return path;
  }

  private syncFloatingToolbar(view: MarkdownView, enabled: boolean): void {
    const shouldShow = enabled
      && view.getMode() !== "preview"
      && !!view.file;

    if (!shouldShow) {
      const toolbar = this.novelToolbars.get(view);
      if (toolbar) {
        toolbar.destroy();
        this.novelToolbars.delete(view);
      }
      return;
    }

    const scope = this.getNovelToolbarScope(view.file);
    const existing = this.novelToolbars.get(view);
    if (existing && existing.scope !== scope) {
      existing.destroy();
      this.novelToolbars.delete(view);
    } else if (existing) {
      return;
    }

    const toolbar = new NovelFloatingToolbar(view.containerEl, {
      formatDocument: () => {
        this.formatNovelDocument(view);
      },
      addImage: () => {
        void this.insertNovelImage(view);
      },
      showInspiration: () => {
        this.createInspirationNote(view);
      },
    }, scope);
    this.novelToolbars.set(view, toolbar);
  }

  private getNovelToolbarScope(file: TFile | null): NovelToolbarScope {
    if (!file) {
      return "basic";
    }

    const parentPath = this.normalizeFolderPath(file.parent?.path ?? "/");
    const groupRoot = this.findNovelGroupRoot(parentPath);
    return groupRoot !== null && groupRoot === parentPath
      ? "full"
      : "basic";
  }

  private formatNovelDocument(view: MarkdownView): void {
    if (!view.file || view.getMode() === "preview") {
      return;
    }

    const editor = view.editor;
    const content = editor.getValue();
    const result = formatNovelMarkdown(content);
    if (!result.changed) {
      new Notice("NovelView：文档已经是整洁格式，无需调整。");
      return;
    }

    editor.replaceRange(
      result.text,
      { line: 0, ch: 0 },
      {
        line: editor.lastLine(),
        ch: editor.getLine(editor.lastLine()).length,
      },
    );
    editor.focus();

    const parts: string[] = [];
    if (result.trimmedLines > 0) {
      parts.push(`清理 ${result.trimmedLines} 行行尾空白`);
    }
    if (result.removedBlankLines > 0) {
      parts.push(`删除 ${result.removedBlankLines} 个空行`);
    }
    new Notice(
      `NovelView：自动排版完成${parts.length ? `，${parts.join("，")}` : ""}。可用 Ctrl/Cmd+Z 撤销。`,
    );
  }

  private applySettingsToOpenModes(): void {
    for (const leaf of this.app.workspace.getLeavesOfType("markdown")) {
      if (!(leaf.view instanceof MarkdownView)) {
        continue;
      }

      const view = leaf.view;
      if (view.contentEl.hasClass(MODE_CLASS)) {
        this.applyModeStyles(view.contentEl);
        this.refreshEditor(view);
      }
    }
  }

  private applyModeStyles(contentEl: HTMLElement): void {
    contentEl.style.setProperty(
      "--novelview-first-line-indent",
      `${this.settings.firstLineIndent}em`,
    );
    contentEl.style.setProperty(
      "--novelview-line-height",
      String(this.settings.lineHeight),
    );
    contentEl.style.setProperty(
      "--novelview-paragraph-spacing",
      `${this.settings.paragraphSpacing}em`,
    );

    contentEl.toggleClass(
      PARAGRAPH_MODE_LINE_CLASS,
      this.settings.paragraphMode === "line",
    );
    contentEl.toggleClass(
      PARAGRAPH_MODE_BLANK_LINE_CLASS,
      this.settings.paragraphMode === "blank-line",
    );
    contentEl.toggleClass(
      HIDE_MARKERS_CLASS,
      this.settings.hideMarkdownMarkers,
    );
    contentEl.toggleClass(
      HIDE_LINE_NUMBERS_CLASS,
      this.settings.hideLineNumbers,
    );
  }

  private clearNovelMode(view: MarkdownView): void {
    if (view.contentEl.hasClass(MODE_CLASS)) {
      this.clearNovelModeStyles(view.contentEl);
      this.refreshEditor(view);
    }
  }

  private clearNovelModeStyles(contentEl: HTMLElement): void {
    contentEl.removeClass(MODE_CLASS);
    contentEl.removeClass(PARAGRAPH_MODE_LINE_CLASS);
    contentEl.removeClass(PARAGRAPH_MODE_BLANK_LINE_CLASS);
    contentEl.removeClass(HIDE_MARKERS_CLASS);
    contentEl.removeClass(HIDE_LINE_NUMBERS_CLASS);
    contentEl.style.removeProperty("--novelview-first-line-indent");
    contentEl.style.removeProperty("--novelview-line-height");
    contentEl.style.removeProperty("--novelview-paragraph-spacing");
  }

  private scheduleSave(): void {
    if (this.dataSaveTimer !== null) {
      window.clearTimeout(this.dataSaveTimer);
    }

    this.dataSaveTimer = window.setTimeout(() => {
      this.dataSaveTimer = null;
      void this.saveSettings().catch((error) => {
        console.error("NovelView: failed to save plugin data", error);
      });
    }, 350);
  }

  private refreshEditor(view: MarkdownView): void {
    window.requestAnimationFrame(() => {
      if (this.unloaded || !view.containerEl.isConnected) {
        return;
      }

      try {
        view.editor?.refresh();
      } catch (error) {
        console.debug("NovelView: editor refresh skipped", error);
      }
    });
  }
}

function formatInspirationTitle(date: Date): string {
  const pad = (value: number): string => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} `
    + `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

function isPersistedNovelViewData(value: unknown): value is PersistedNovelViewData {
  return typeof value === "object"
    && value !== null
    && ("settings" in value || "stickyNote" in value);
}
