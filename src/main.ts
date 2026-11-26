import {
  MarkdownView,
  Plugin,
  Menu,
  Notice,
  TAbstractFile,
  TFile,
  TFolder,
  type PluginSettingTab,
  type WorkspaceLeaf,
} from "obsidian";
import {
  ARTICLE_LIST_VIEW_TYPE,
  ARTICLES_MIME,
  NovelArticleListView,
  type ArticleEntry,
  type ArticleListModel,
  type ArticleListTarget,
} from "./features/article-list/article-list-view";
import {
  type ChapterStatus,
} from "./core/model/chapter-status";
import {
  type SettingCollectionIndex,
  type SettingGroupTags,
} from "./core/model/setting-collection";
import {
  type NovelArticleGroup,
  type NovelConfig,
  type NovelGroupInfo,
} from "./core/model/novel-config";
import {
  NovelSrcGalleryView,
  SRC_GALLERY_VIEW_TYPE,
} from "./features/src-gallery/src-gallery-view";
import {
  NovelWorkbenchView,
  WORKBENCH_VIEW_TYPE,
} from "./features/workbench/workbench-view";
import {
  NOVEL_EDITOR_VIEW_TYPE,
  NovelEditorView,
} from "./features/novel-editor/novel-editor-view";
import {
  ARTICLE_INFO_VIEW_TYPE,
  ArticleInfoView,
} from "./features/article-info/article-info-view";
import {
  SETTING_COLLECTION_VIEW_TYPE,
  SettingCollectionView,
} from "./features/setting-collection/setting-collection-view";
import {
  NovelSettingListView,
  SETTING_LIST_VIEW_TYPE,
} from "./features/setting-collection/setting-list-view";
import {
  TEXT_MARKS_VIEW_TYPE,
  TextMarkCollectionView,
} from "./features/text-marks/mark-collection-view";
import { ModeSettingsPanel } from "./features/setting-collection/mode-settings-panel";
import type { ChapterMeta } from "./app/types";
import {
  DEFAULT_SETTINGS,
  normalizeSettings,
  type NovelViewSettings,
} from "./app/settings";
import { joinVaultPath } from "./core/model/novel-config";
import { confirmAction } from "./ui/confirm-modal";
import {
  decorateNovelFolderTitles as decorateNovelFolderTitlesImpl,
  refreshOpenViews as refreshOpenViewsImpl,
  scheduleNovelFolderDecoration as scheduleNovelFolderDecorationImpl,
  setupNovelFolderObserver as setupNovelFolderObserverImpl,
} from "./features/novel-mode";
import {
  activateWorkbench as activateWorkbenchImpl,
  getWorkbenchFolderPath as getWorkbenchFolderPathImpl,
  openArticleList as openArticleListImpl,
  removeSidebarWorkbenchInstances as removeSidebarWorkbenchInstancesImpl,
  setWorkbenchGroup as setWorkbenchGroupImpl,
} from "./features/workbench/navigation";
import { getArticleListModel as buildArticleListModel } from "./features/article-list/model";
import {
  chooseLocalImage as chooseLocalImageImpl,
  saveImageToVault as saveImageToVaultImpl,
} from "./features/novel-editor/images";
import {
  ensureFolder as ensureVaultFolder,
  getFolder as resolveVaultFolder,
  getUniqueFilePath as buildUniqueFilePath,
  getUniqueMarkdownPath as buildUniqueMarkdownPath,
  normalizeFolderPath as normalizeVaultPath,
  sanitizeFileBase as sanitizeVaultFileBase,
} from "./app/vault-paths";
import { SettingKeywordTooltipController } from "./features/setting-keywords/tooltip";
import {
  openModeSettings,
  openSettingCollection,
  openSettingCollectionList,
  openSettingRecord,
  openSettingRecordForNovelKeyword,
} from "./features/setting-collection/navigation";

import {
  findNovelEditorView,
  focusArticleInfoFootnote,
  getActiveNovelEditorFile,
  getActiveNovelEditorView,
  getNovelEditorViewForPath,
  getOrderedNovelChapterFiles,
  isLeftSidebarLeaf,
  isRightSidebarLeaf,
  leftSidebarLeaf,
  openArticleFromList,
  openNovelEditor,
  openNovelEditorInNewTab,
  openNovelSrcGallery,
  openTextMarkRange,
  openTextMarks,
  refreshArticleInfo,
  refreshWorkbenchViews,
  rightSidebarLeaf,
  routeNovelFileOpen,
  setNovelEditorFile,
} from "./app/view-navigation";

import {
  addArticlesToGroup,
  compareChapterOrder,
  createArticleInFolder,
  deleteArticleGroup,
  deleteArticleTargets,
  ensureVolumeOrder,
  getArticleGroupForPath,
  getArticleGroups,
  getArticleId,
  getChapterMeta,
  getContiguousArticleSelection,
  getNextArticleId,
  getNovelVolumeOrder,
  getUniqueFolderPath,
  handleArticlePathChange,
  handleArticlePathDeleted,
  moveArticlesToVolume,
  normalizeArticleGroups,
  refreshArticleListViews,
  removeArticlesFromGroup,
  renameArticlePath,
  renameVolumePath,
  renumberFolder,
  reorderArticlesAt,
  reorderVolume,
  saveArticleGroup,
  saveNovelVolumeOrder,
  setChapterStatus,
  showArticleListContextMenu,
  undoLastArticleAction,
  updateArticleGroup,
  updateVolumeMeta,
} from "./features/article-list/service";

import {
  cleanupSettingIndexHistory,
  createSettingGroup,
  createSettingRecordDetail,
  deleteSettingRecordFiles,
  ensureSettingCollection,
  getSettingCollectionFolder,
  getSettingGroupFolderForNovel,
  getSettingGroupsForNovel,
  getSettingRecordDetailFiles,
  getSettingRecordDetailLabel,
  getSettingRecordFile,
  getSettingRecordFolder,
  handleSettingGroupFolderClickFallback,
  handleSettingGroupFolderRename,
  handleSettingGroupPathChange,
  initializeSettingGroups,
  isSettingGroupFolderPath,
  loadSettingGroups,
  migrateLegacySettingCollections,
  moveSettingRecordDetails,
  readSettingCollectionIndex,
  readSettingGroupRecords,
  refreshSettingCollectionViews,
  registerSettingGroupFolder,
  renameSettingCollectionGroup,
  renameSettingGroupFolder,
  renameSettingRecordDetails,
  replaceNovelKeyword,
  revealSettingCollectionFolder,
  revealSettingGroup,
  revertSettingGroupFolder,
  scheduleSettingCollection,
  settingDetailPrefix,
  settingGroupFolderPathName,
  settingGroupNameFromFolder,
  settingGroupsForNovel,
  settingRecordPath,
  settingRootForPath,
  writeSettingCollectionIndex,
} from "./features/setting-collection/service";

import {
  createNovelGroup,
  editNovelCover,
  editNovelVolumeCover,
  findNovelGroupRoot,
  getNovelConfig,
  getNovelCoverUrl,
  getNovelGroupInfo,
  getNovelSettingFile,
  getUsedNovelCovers,
  handleNovelFolderClick,
  isForcedNovelMode,
  isNovelArticleFile,
  isReservedNovelFolder,
  isSettingCollectionIndexPath,
  isSpecialNovelFile,
  loadNovelConfigs,
  migrateNovelConfigs,
  novelRoots,
  readNovelConfig,
  renameNovelGroupFolder,
  updateNovelInfo,
  writeNovelConfig,
} from "./app/novel-group";

import {
  clearArticleDrag,
  getArticleDropContext,
  hideArticleDragPreview,
  isArticleDragEvent,
  performArticleDrop,
  performArticleDropInner,
  setArticleDrag,
  showArticleDragPreview,
} from "./features/article-list/drag";

import {
  getActiveNovelEditorText,
  initializeWordCountBaseline,
  loadWordCountBaselines,
  recordFileHistory,
  scheduleHistoryCheck,
} from "./features/writing-stats/service";
import {
  clearNovelFinderHighlights,
  closeNovelFinder,
  focusNovelFinderResult,
  getNovelFinderAnchorY,
  getSettingKeywordsForFinder,
  isNovelFinderOpen,
  openNovelFinderResult,
  showNovelFinderResults,
} from "./features/search/finder-service";
import {
  openSettingKeywordRecord as openSettingKeywordRecordAsync,
  refreshSettingKeywordIndex as refreshSettingKeywordIndexAsync,
} from "./features/setting-keywords/index";
import {
  exportChapterTargets as exportChapterTargetsAsync,
  exportNovelGroup as exportNovelGroupAsync,
  exportVolumeTarget as exportVolumeTargetAsync,
} from "./features/import-export/txt-export";
import { importNovelTxt as importNovelTxtAsync } from "./features/import-export/txt-import";
import { importMaterialImage as importMaterialImageAsync } from "./features/import-export/material";
import { maybeShowOnboarding } from "./app/onboarding";
import {
  SearchPanelV2,
  type FinderContext,
  type FinderResult,
  type SearchScope,
} from "./features/search/search-panel-v2";
import {
  NOVEL_FINDER_VIEW_TYPE,
  NovelFinderView,
} from "./features/search/novel-finder-view";





export default class NovelViewPlugin extends Plugin {

  settings: NovelViewSettings = { ...DEFAULT_SETTINGS };
  readonly volumeOrder = new Map<string, string[]>();
  lastActiveMarkdownPath: string | null = null;
  workbenchFolderPath: string | null = null;
  unloaded = false;
  readonly searchActions = new Map<MarkdownView, HTMLElement>();
  readonly observedViews = new WeakSet<MarkdownView>();
  readonly articleStatusCards = new Map<MarkdownView, HTMLElement>();
  readonly articleStatusTimers = new Map<MarkdownView, number>();
  folderDecorationObserver: MutationObserver | null = null;
  folderDecorationContainer: HTMLElement | null = null;
  folderDecorationFrame: number | null = null;
  private saveChain: Promise<void> = Promise.resolve();

  readonly chapterMetaCache = new Map<string, ChapterMeta>();
  settingKeywordEntries: import("./core/model/setting-collection").SettingKeywordEntry[] = [];
  private readonly settingKeywordTooltip = new SettingKeywordTooltipController(this);
  readonly articleUndoStack: Array<() => Promise<void>> = [];
  readonly novelConfigs = new Map<string, NovelConfig>();
  searchPanelV2: SearchPanelV2 | null = null;
  routingNovelFile = false;
  readonly wordCountBaselines = new Map<string, number>();
  readonly historyTimers = new Map<string, number>();
  readonly settingGroups = new Map<string, string>();
  suppressSettingGroupFolderRename = false;
  readonly settingCollectionTimers = new Map<string, number>();
  finderNavigationUntil = 0;
  historySaveChain: Promise<void> = Promise.resolve();
  articleDragPaths: string[] = [];
  articleDragCancelled = false;
  articleDragPreview: HTMLElement | null = null;
  articleDropMode: "split" | "tabs" | "replace" | null = null;
  articleDropHeader: HTMLElement | null = null;
  articleDropHandled = false;
  modeSettingsPanel: ModeSettingsPanel | null = null;

  /** 屏蔽旧设置页注册，设置统一走格式面板。 */
  override addSettingTab(_tab: PluginSettingTab): void {
    // 设置通过编辑器工具栏中的格式面板完成；不注册旧设置页。
  }


  // —— 接管旧包成员（第 1 步，均为增量，不影响既有行为） ——

  /** 取当前活动的笔记视图，无则返回 null。 */
  getActiveMarkdownView(): MarkdownView | null {
    return this.app.workspace.getActiveViewOfType(MarkdownView);
  }

  /** 按记录路径找回最后激活的笔记文件。 */
  getLastActiveMarkdownFile(): TFile | null {
    if (!this.lastActiveMarkdownPath) {
      return null;
    }
    const file = this.app.vault.getAbstractFileByPath(this.lastActiveMarkdownPath);
    return file instanceof TFile ? file : null;
  }

  /** 记录当前笔记路径，供文件列表定位。 */
  rememberActiveMarkdownFile(): void {
    const view = this.getActiveMarkdownView();
    if (view?.file) {
      this.lastActiveMarkdownPath = view.file.path;
    }
  }

  /** 串行写入设置与卷序，避免并发覆盖。 */
  async saveSettings(): Promise<void> {
    const data = {
      settings: { ...this.settings },
      volumeOrder: Object.fromEntries(this.volumeOrder),
    };
    this.saveChain = this.saveChain.then(
      () => this.saveData(data) as Promise<void>,
      () => this.saveData(data) as Promise<void>,
    );
    await this.saveChain;
  }

  /** 合并补丁、归一化并持久化设置。 */
  async updateSettings(patch: Partial<NovelViewSettings>): Promise<void> {
    this.settings = normalizeSettings({ ...this.settings, ...patch });
    try {
      await this.saveSettings();
    } catch (error) {
      console.error("Novel View: failed to save settings", error);
      new Notice("Novel View：设置保存失败，请检查控制台日志。");
    }
    this.applyFormatSettingsLive();
  }

  /** 从存储数据还原各小说组的卷排序。 */
  loadVolumeOrder(value: unknown): void {
    this.volumeOrder.clear();
    if (typeof value !== "object" || value === null) {
      return;
    }
    for (const [key, entry] of Object.entries(value)) {
      if (!Array.isArray(entry)) {
        continue;
      }
      const order = entry.filter(
        (item): item is string => typeof item === "string" && item.length > 0,
      );
      if (order.length > 0) {
        this.volumeOrder.set(this.normalizeFolderPath(key), order);
      }
    }
  }

  /** 判断目录是否已构建为小说组。 */
  isNovelGroupFolder(path: string): boolean {
    return Boolean(this.getNovelSettingFile(path));
  }

  /** 判断视图当前是否启用小说模式。 */
  isNovelModeEnabled(view: MarkdownView): boolean {
    return Boolean(view.file) && this.isForcedNovelMode(view.file as TFile);
  }

  /** 遍历打开的笔记视图刷新小说模式。 */
  refreshOpenViews(): void {
    refreshOpenViewsImpl(this);
  }


  /** 转发到 novel-mode 模块刷新编辑器。 */

  /** 转发到 novel-mode 模块清除模式样式。 */

  /** 转发到 novel-mode 模块应用设置。 */

  /** 转发到 novel-mode 模块延迟装饰标题。 */
  scheduleNovelFolderDecoration(): void {
    scheduleNovelFolderDecorationImpl(this);
  }

  /** 转发到 novel-mode 模块监听文件夹变化。 */
  setupNovelFolderObserver(): void {
    setupNovelFolderObserverImpl(this);
  }

  /** 判断面板是否位于左右侧边栏内。 */
  isLeafInSidebar(leaf: WorkspaceLeaf): boolean {
    return Boolean(leaf.view.containerEl.closest(
      ".workspace-split.mod-left-split, .workspace-split.mod-right-split",
    ));
  }

  /** 转发到工作台模块打开文章列表视图。 */
  async openArticleList(folderPath: string): Promise<void> {
    await openArticleListImpl(this, folderPath);
  }

  /** 转发到工作台模块激活工作台视图。 */
  async activateWorkbench(): Promise<void> {
    await activateWorkbenchImpl(this);
  }

  /** 转发到工作台模块记录当前小说组。 */
  setWorkbenchGroup(folderPath: string): void {
    setWorkbenchGroupImpl(this, folderPath);
  }

  /** 转发到工作台模块读取当前组路径。 */
  getWorkbenchFolderPath(): string | null {
    return getWorkbenchFolderPathImpl(this);
  }

  /** 转发到工作台模块移除侧栏残留实例。 */
  removeSidebarWorkbenchInstances(): void {
    removeSidebarWorkbenchInstancesImpl(this);
  }

  /** 记录组路径并打开对应工作台。 */
  async openWorkbenchForGroup(folderPath: string): Promise<void> {
    this.workbenchFolderPath = this.normalizeFolderPath(folderPath);
    await this.activateWorkbench();
    this.refreshWorkbenchViews();
  }

  /** 移除状态卡片并清理刷新定时器。 */
  destroyArticleStatus(view: MarkdownView): void {
    this.articleStatusCards.get(view)?.remove();
    this.articleStatusCards.delete(view);
    view.containerEl.removeClass("novelview-status-host");
    const timer = this.articleStatusTimers.get(view);
    if (timer !== undefined) {
      window.clearInterval(timer);
      this.articleStatusTimers.delete(view);
    }
  }

  /** 转发到图片模块选择本地图片文件。 */
  chooseLocalImage(): Promise<File | null> {
    return chooseLocalImageImpl();
  }

  /** 转发到图片模块把图片写入库。 */
  saveImageToVault(
    file: File,
    sourcePath: string,
    folderPath?: string,
  ): Promise<TFile | null> {
    return saveImageToVaultImpl(this, file, sourcePath, folderPath);
  }

  /** 转发到图片模块插入正文配图。 */

  /** 转发到图片模块从素材库挑选插图。 */

  /** 转发到图片模块计算工具栏作用域。 */

  /** 在小说组内新建自动去重的卷目录。 */
  async createVolumeInFolder(folderPath: string): Promise<void> {
    const root = this.normalizeFolderPath(folderPath);
    let name = "无名卷";
    let index = 1;
    let path = joinVaultPath(root, name);
    while (this.app.vault.getAbstractFileByPath(path)) {
      index += 1;
      name = `无名卷 ${index}`;
      path = joinVaultPath(root, name);
    }
    try {
      await this.app.vault.createFolder(path);
      new Notice(`Novel View：已创建卷“${name}”。`);
      this.refreshArticleListViews();
      this.scheduleNovelFolderDecoration();
    } catch (error) {
      console.error("Novel View: failed to create volume", error);
      new Notice("Novel View：卷创建失败。");
    }
  }

  /** 把文章列表面板还原为文件浏览器。 */
  async restoreFileExplorer(leaf?: WorkspaceLeaf): Promise<void> {
    const target = leaf
      ?? this.app.workspace.getLeavesOfType(ARTICLE_LIST_VIEW_TYPE)[0]
      ?? this.app.workspace.getLeftLeaf(false);
    if (!target) {
      new Notice("Novel View：无法回到文件列表。");
      return;
    }
    try {
      await target.setViewState({ type: "file-explorer", active: true });
      await this.app.workspace.revealLeaf(target);
    } catch (error) {
      console.error("Novel View: failed to restore file explorer", error);
      new Notice("Novel View：文件列表恢复失败。");
    }
  }

  /** 确认后删除 novel.json 取消小说组。 */
  async cancelNovelGroup(folder: TFolder): Promise<void> {
    const folderPath = this.normalizeFolderPath(folder.path);
    const settingFile = this.getNovelSettingFile(folderPath);
    if (!settingFile) {
      return;
    }
    const confirmed = await confirmAction(
      this.app,
      "取消小说组构建",
      "将删除该小说组的 novel.json。文章与设定文件不会被删除。",
      "取消构建",
    );
    if (!confirmed) {
      return;
    }
    await this.app.vault.delete(settingFile);
    if (this.workbenchFolderPath === folderPath) {
      this.workbenchFolderPath = null;
    }
    const leaf = this.app.workspace
      .getLeavesOfType(ARTICLE_LIST_VIEW_TYPE)
      .find((item) => item.getViewState().state?.folderPath === folderPath);
    if (leaf) {
      await this.restoreFileExplorer(leaf);
    }
    this.refreshOpenViews();
    this.refreshWorkbenchViews();
    this.scheduleNovelFolderDecoration();
    new Notice(`Novel View：已取消小说组“${folder.name}”。`);
  }

  /** 插件入口：装配视图、事件与启动钩子。 */
  async onload(): Promise<void> {
    await this.loadSettings();
    this.registerCoreViews();
    this.registerWorkspaceEvents();
    this.registerEditorDecorations();
    await this.loadPersistedState();
    this.registerStartupHooks();
    this.registerVaultEvents();
    this.registerNovelGroupEvents();
    this.registerDomEvents();
  }

  /** 注册插件自有视图。 */
  private registerCoreViews(): void {
    this.registerView(WORKBENCH_VIEW_TYPE, (leaf: WorkspaceLeaf) => (
      new NovelWorkbenchView(leaf, this)
    ));
    this.registerView(ARTICLE_LIST_VIEW_TYPE, (leaf: WorkspaceLeaf) => (
      new NovelArticleListView(leaf, this)
    ));
    this.registerView(SRC_GALLERY_VIEW_TYPE, (leaf: WorkspaceLeaf) => (
      new NovelSrcGalleryView(leaf, this)
    ));
    this.registerView(NOVEL_EDITOR_VIEW_TYPE, (leaf: WorkspaceLeaf) => (
      new NovelEditorView(leaf, this)
    ));
    this.registerView(SETTING_COLLECTION_VIEW_TYPE, (leaf: WorkspaceLeaf) => (
      new SettingCollectionView(leaf, this)
    ));
    this.registerView(SETTING_LIST_VIEW_TYPE, (leaf: WorkspaceLeaf) => (
      new NovelSettingListView(leaf, this)
    ));
    this.registerView(TEXT_MARKS_VIEW_TYPE, (leaf: WorkspaceLeaf) => (
      new TextMarkCollectionView(leaf, this)
    ));
    this.registerView(ARTICLE_INFO_VIEW_TYPE, (leaf: WorkspaceLeaf) => (
      new ArticleInfoView(leaf, this)
    ));
    this.registerView(NOVEL_FINDER_VIEW_TYPE, (leaf: WorkspaceLeaf) => (
      new NovelFinderView(leaf, this)
    ));
  }

  /** 工作区事件：小说章节打开时接管、编辑器激活时刷新联带面板。 */
  private registerWorkspaceEvents(): void {
    this.registerEvent(this.app.workspace.on("file-open", (file) => {
      this.rememberActiveMarkdownFile();
      if (!(file instanceof TFile)) {
        return;
      }
      if (this.isNovelArticleFile(file)) {
        this.routeNovelFileOpen(file);
      }
    }));
    this.registerEvent(this.app.workspace.on("active-leaf-change", (leaf) => {
      this.rememberActiveMarkdownFile();
      this.refreshOpenViews();
      const active = leaf?.view;
      if (active instanceof NovelEditorView) {
        active.activate();
        if (!active.isDarkRoomActive()) {
          this.ensureArticleInfoView();
        }
        if (performance.now() >= this.finderNavigationUntil) {
          this.searchPanelV2?.refreshForActiveEditor();
        }
        return;
      }
      const inSidebar = Boolean(
        leaf?.view.containerEl.closest(
          ".workspace-split.mod-left-split, .workspace-split.mod-right-split",
        ),
      );
      if (!inSidebar) {
        this.closeNovelFinder();
      }
    }));
  }

  /** 编辑器扩展。 */
  private registerEditorDecorations(): void {
  }

  /** 迁移旧配置、载入卷序与字数基线、补默认字号。 */
  private async loadPersistedState(): Promise<void> {
    await this.migrateNovelConfigs();
    await this.loadNovelConfigs();
    await this.loadWordCountBaselines();
    this.settings.fontSize ??= 16;
  }

  /** 布局就绪后的清理与初始化。 */
  private registerStartupHooks(): void {
    this.app.workspace.onLayoutReady(() => {
      for (const type of [
        "novelview-graph-editor",
        "novelview-branch-editor",
        "novelview-timeline-editor",
        "novelview-detail-editor",
      ]) {
        for (const leaf of this.app.workspace.getLeavesOfType(type)) {
          leaf.detach();
        }
      }
      for (const leaf of this.app.workspace.getLeavesOfType(
        TEXT_MARKS_VIEW_TYPE,
      )) {
        if (!this.isRightSidebarLeaf(leaf)) {
          leaf.detach();
        }
      }
      for (const leaf of this.app.workspace.getLeavesOfType(
        SETTING_LIST_VIEW_TYPE,
      )) {
        if (!this.isLeftSidebarLeaf(leaf)) {
          leaf.detach();
        }
      }
    });
    this.app.workspace.onLayoutReady(() => {
      this.rememberActiveMarkdownFile();
      this.removeSidebarWorkbenchInstances();
      this.refreshOpenViews();
      this.refreshWorkbenchViews();
      this.setupNovelFolderObserver();
    });
    this.app.workspace.onLayoutReady(() => {
      void this.takeOverNovelMarkdownLeaves();
      void this.initializeSettingGroups();
      window.setTimeout(() => {
        maybeShowOnboarding(this.app, this.manifest.version);
      }, 1200);
    });
  }

  /** 小说组事件：右键菜单与文件夹点击。 */
  private registerNovelGroupEvents(): void {
    this.registerEvent(this.app.workspace.on("file-menu", (menu, file) => {
      this.addNovelGroupMenuItem(menu, file);
    }));
    this.registerDomEvent(activeDocument, "click", (event) => {
      this.handleNovelFolderClick(event);
    }, true);
    this.registerEvent(this.app.metadataCache.on("changed", () => {
      this.refreshOpenViews();
    }));
    this.registerEvent(this.app.metadataCache.on("resolved", () => {
      this.refreshOpenViews();
    }));
  }

  /** 库事件：设定组路径、设定集索引与章节路径迁移。 */
  private registerVaultEvents(): void {
    this.registerEvent(this.app.vault.on("create", (file) => {
      this.handleSettingGroupPathChange(file.path, null);
      this.scheduleNovelFolderDecoration();
    }));
    this.registerEvent(this.app.vault.on("rename", (file, oldPath) => {
      this.handleSettingGroupPathChange(file.path, oldPath);
      this.scheduleNovelFolderDecoration();
      this.refreshOpenViews();
    }));
    this.registerEvent(this.app.vault.on("delete", (file) => {
      this.handleSettingGroupPathChange(null, file.path);
      this.scheduleNovelFolderDecoration();
    }));
    this.registerEvent(this.app.workspace.on("layout-change", () => {
      this.refreshOpenViews();
      this.setupNovelFolderObserver();
    }));
    this.registerEvent(this.app.vault.on("modify", (file) => {
      if (!(file instanceof TFile)) {
        return;
      }
      this.scheduleHistoryCheck(file);
      const settingRoot = this.settingRootForPath(
        this.normalizeFolderPath(file.parent?.path ?? "/"),
      );
      if (settingRoot) {
        this.scheduleSettingCollection(settingRoot);
        void this.refreshSettingKeywordIndex();
      }
    }));
    this.registerEvent(this.app.vault.on("create", (file) => {
      if (file instanceof TFile && file.extension === "md") {
        void this.initializeWordCountBaseline(file);
        const settingRoot = this.settingRootForPath(
          this.normalizeFolderPath(file.parent?.path ?? "/"),
        );
        if (settingRoot) {
          this.scheduleSettingCollection(settingRoot);
          void this.refreshSettingKeywordIndex();
        }
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
  }

  /** DOM 事件：设定组点击、关键词浮层与文章拖拽。 */
  private registerDomEvents(): void {
    this.registerDomEvent(activeDocument, "click", (event) => {
      this.handleSettingGroupFolderClickFallback(event);
    }, true);
    this.registerDomEvent(activeDocument, "mouseover", (event) => {
      const target = (event.target as HTMLElement | null)?.closest<HTMLElement>(
        ".novelview-setting-keyword",
      );
      if (target) {
        this.settingKeywordTooltip.show(target);
      }
    });
    this.registerDomEvent(activeDocument, "mouseout", (event) => {
      const target = (event.target as HTMLElement | null)?.closest<HTMLElement>(
        ".novelview-setting-keyword",
      );
      if (!target) {
        return;
      }
      const related = event.relatedTarget as Node | null;
      if (this.settingKeywordTooltip.contains(related)) {
        return;
      }
      this.settingKeywordTooltip.scheduleHide();
    });
    this.registerDomEvent(activeDocument, "scroll", () => this.settingKeywordTooltip.hide(), true);
    this.registerDomEvent(activeDocument, "dragstart", (event) => {
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
          const parsed: unknown = raw ? JSON.parse(raw) : [];
          if (Array.isArray(parsed)) {
            paths = parsed.filter((path: unknown): path is string => typeof path === "string");
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
    this.registerDomEvent(activeDocument, "keydown", (event) => {
      if (event.key === "Escape" && this.articleDragPaths.length) {
        this.articleDragCancelled = true;
        this.hideArticleDragPreview();
      }
    }, true);
  }

  /** 转发到关键词模块重建索引。 */
  async refreshSettingKeywordIndex(): Promise<void> {
    await refreshSettingKeywordIndexAsync(this);
  }

  /** 卸载插件：清理定时器、面板与缓存。 */
  onunload(): void {
    this.unloaded = true;
    this.settingKeywordTooltip.hide();
    this.clearArticleDrag();
    this.folderDecorationObserver?.disconnect();
    this.folderDecorationObserver = null;
    for (const timer of this.articleStatusTimers.values()) {
      window.clearInterval(timer);
    }
    this.articleStatusTimers.clear();
    for (const card of this.articleStatusCards.values()) {
      card.remove();
    }
    this.articleStatusCards.clear();
    for (const action of this.searchActions.values()) {
      action.remove();
    }
    this.searchActions.clear();
    this.searchPanelV2?.close();
    this.searchPanelV2 = null;
    void this.saveSettings().catch((error: unknown) => {
      console.error("Novel View: failed to flush settings", error);
    });
  }

  // —— 以下 6 个方法覆盖旧包实现，行为与旧版逐字一致 ——

  /** 转发到路径模块归一化文件夹路径。 */
  normalizeFolderPath(path: string): string {
    return normalizeVaultPath(path);
  }

  /** 转发到路径模块按路径取文件夹对象。 */
  getFolder(path: string): TFolder | null {
    return resolveVaultFolder(this.app, path);
  }

  /** 转发到路径模块确保文件夹存在。 */
  async ensureFolder(path: string): Promise<TFolder | null> {
    return ensureVaultFolder(this.app, path);
  }

  /** 转发到路径模块清洗文件名主干。 */
  sanitizeFileBase(value: string, fallback: string): string {
    return sanitizeVaultFileBase(value, fallback);
  }

  /** 转发到路径模块生成唯一笔记路径。 */
  getUniqueMarkdownPath(folderPath: string, base: string): string {
    return buildUniqueMarkdownPath(this.app, folderPath, base);
  }

  /** 转发到路径模块生成唯一文件路径。 */
  getUniqueFilePath(folderPath: string, fileName: string): string {
    return buildUniqueFilePath(this.app, folderPath, fileName);
  }

  /** 读取存储并归一化设置与卷序。 */
  async loadSettings(): Promise<void> {
    const raw = await this.loadData() as
      | { settings?: unknown; volumeOrder?: unknown }
      | null;
    const stored = raw && typeof raw === "object" && "settings" in raw
      ? (raw as { settings?: unknown }).settings
      : raw;
    this.settings = normalizeSettings(stored);
    this.loadVolumeOrder(
      raw && typeof raw === "object"
        ? (raw as { volumeOrder?: unknown }).volumeOrder
        : null,
    );
  }

  /** 转发到编辑器模块同步浮动工具栏。 */

  /** 空实现，命令入口已由工具栏接管。 */
  registerCommands(): void {}

  /** 返回设定关键词缓存列表。 */
  get allSettingKeywords(): import("./core/model/setting-collection").SettingKeywordEntry[] {
    return this.settingKeywordEntries;
  }

  /** 覆盖写入设定关键词缓存列表。 */
  setAllSettingKeywords(
    entries: import("./core/model/setting-collection").SettingKeywordEntry[],
  ): void {
    this.settingKeywordEntries = entries;
  }

  /** 转发到搜索模块取查找用关键词。 */
  getSettingKeywordsForFinder(): import("./core/model/setting-collection").SettingKeywordEntry[] {
    return getSettingKeywordsForFinder(this);
  }

  /** 转发到查找器模块展示搜索结果。 */
  async showNovelFinderResults(context: FinderContext, results: FinderResult[],): Promise<void> {
    return showNovelFinderResults(this, context, results);
  }

  /** 转发到查找器模块清除高亮。 */
  clearNovelFinderHighlights(): void {
    clearNovelFinderHighlights(this);
  }

  /** 转发到查找器模块取浮动锚点纵坐标。 */
  getNovelFinderAnchorY(): number | undefined {
    return getNovelFinderAnchorY(this);
  }

  /** 转发到查找器模块定位单条结果。 */
  async focusNovelFinderResult(result: FinderResult, scope: SearchScope, options: { openChapter?: boolean; scroll?: boolean; focus?: boolean; } = {},): Promise<boolean> {
    return focusNovelFinderResult(this, result, scope, options);
  }

  /** 转发到查找器模块打开结果位置。 */
  async openNovelFinderResult(result: FinderResult, scope?: SearchScope,): Promise<void> {
    return openNovelFinderResult(this, result, scope);
  }

  /** 转发到查找器模块关闭查找面板。 */
  closeNovelFinder(): void {
    closeNovelFinder(this);
  }

  /** 转发到查找器模块判断面板是否打开。 */
  isNovelFinderOpen(): boolean {
    return isNovelFinderOpen(this);
  }

  /** 打开高级搜索面板，非小说编辑器时提示。 */
  openAdvancedSearch(): void {
    if (!this.app.workspace.getActiveViewOfType(NovelEditorView)) {
      closeNovelFinder(this);
      new Notice("Novel View：请先打开 NovelEditor 后再使用 NovelFinder。");
      return;
    }
    const active = this.getLastActiveMarkdownFile();
    const editor = active ? this.findNovelEditorView(active.path) : null;
    editor?.exitImmersiveMode();
    if (!this.searchPanelV2) {
      this.searchPanelV2 = new SearchPanelV2(this);
    }
    this.searchPanelV2.open();
  }

  /** 转发到导航模块定位文章信息脚注。 */
  async focusArticleInfoFootnote(filePath: string, key: string,): Promise<void> {
    return focusArticleInfoFootnote(this, filePath, key);
  }

  /** 转发到导航模块取按序章节文件。 */
  getOrderedNovelChapterFiles(currentPath: string): TFile[] {
    return getOrderedNovelChapterFiles(this, currentPath);
  }

  /** 转发到导航模块刷新文章信息卡片。 */
  refreshArticleInfo(): void {
    refreshArticleInfo(this);
  }

  /** 转发到导航模块取活动小说编辑器。 */
  getActiveNovelEditorView(): NovelEditorView | null {
    return getActiveNovelEditorView(this);
  }

  /** 转发到导航模块按路径取编辑器视图。 */
  getNovelEditorViewForPath(path: string): NovelEditorView | null {
    return getNovelEditorViewForPath(this, path);
  }

  /** 确保右侧文章信息面板已打开。 */
  ensureArticleInfoView(): void {
    const existing = this.app.workspace.getLeavesOfType(ARTICLE_INFO_VIEW_TYPE)[0];
    if (existing) {
      void this.app.workspace.revealLeaf(existing);
      return;
    }
    const leaf = this.app.workspace.getRightLeaf(false)
      ?? this.app.workspace.getRightLeaf(true);
    if (!leaf) {
      return;
    }
    void leaf.setViewState({
      type: ARTICLE_INFO_VIEW_TYPE,
      active: true,
    }).then(() => this.app.workspace.revealLeaf(leaf));
  }

  /** 转发到设定集模块打开模式设置面板。 */
  openModeSettings(anchor?: HTMLElement): void {
    openModeSettings(this, anchor);
  }

  /** 把排版设置实时应用到已开编辑器。 */
  applyFormatSettingsLive(): void {
    for (const leaf of this.app.workspace.getLeavesOfType(NOVEL_EDITOR_VIEW_TYPE)) {
      const view = leaf.view as { applySettings?: () => void };
      view.applySettings?.();
    }
  }

  /** 应用小说模式样式与字号变量。 */

  /** 转发到文章列表模块刷新全部视图。 */
  refreshArticleListViews(): void {
    refreshArticleListViews(this);
  }

  /** 转发到导航模块刷新工作台视图。 */
  refreshWorkbenchViews(): void {
    refreshWorkbenchViews(this);
  }

  /** 转发到导出模块导出选中的章节。 */
  async exportChapterTargets(
    targets: ArticleListTarget[],
    folderPath: string,
  ): Promise<void> {
    await exportChapterTargetsAsync(this, targets, folderPath);
  }

  /** 转发到导出模块导出单卷内容。 */
  async exportVolumeTarget(target: ArticleListTarget): Promise<void> {
    await exportVolumeTargetAsync(this, target);
  }



  

  /** 转发到编辑器模块格式化小说正文。 */

  /** 转发到文章模块读取章节元数据。 */
  async getChapterMeta(path: string): Promise<ChapterMeta> {
    return getChapterMeta(this, path);
  }

  /** 转发到文章模块更新章节状态。 */
  async setChapterStatus(file: TFile, status: ChapterStatus): Promise<void> {
    return setChapterStatus(this, file, status);
  }

  /** 转发到文章模块在目录下新建文章。 */
  async createArticleInFolder(folderPath: string, currentPath: string, title: string,): Promise<void> {
    return createArticleInFolder(this, folderPath, currentPath, title);
  }

  /** 转发到小说组模块解析封面地址。 */
  getNovelCoverUrl(folderPath: string, value: string): string | null {
    return getNovelCoverUrl(this, folderPath, value);
  }

  /** 转发到小说组模块取 novel.json。 */
  getNovelSettingFile(folderPath: string): TFile | null {
    return getNovelSettingFile(this, folderPath);
  }

  /** 转发到小说组模块查找所属小说根。 */
  findNovelGroupRoot(folderPath: string): string | null {
    return findNovelGroupRoot(this, folderPath);
  }

  /** 转发到小说组模块汇总小说组信息。 */
  getNovelGroupInfo(folderPath: string): NovelGroupInfo | null {
    return getNovelGroupInfo(this, folderPath);
  }

  /** 转发到统计模块载入字数基线。 */
  async loadWordCountBaselines(): Promise<void> {
    return loadWordCountBaselines(this);
  }

  /** 转发到统计模块初始化字数基线。 */
  async initializeWordCountBaseline(file: TFile): Promise<void> {
    return initializeWordCountBaseline(this, file);
  }

  /** 转发到统计模块安排历史快照检查。 */
  scheduleHistoryCheck(file: TFile): void {
    scheduleHistoryCheck(this, file);
  }

  /** 转发到统计模块记录文件历史版本。 */
  async recordFileHistory(file: TFile, root: string): Promise<void> {
    return recordFileHistory(this, file, root);
  }

  /** 转发到文章模块校正分组数据。 */
  async normalizeArticleGroups(folderPath: string): Promise<void> {
    return normalizeArticleGroups(this, folderPath);
  }

  /** 转发到文章模块处理路径重命名。 */
  async handleArticlePathChange(oldPath: string, newPath: string, isFolder = false,): Promise<void> {
    return handleArticlePathChange(this, oldPath, newPath, isFolder);
  }

  /** 转发到文章模块处理路径删除。 */
  async handleArticlePathDeleted(path: string): Promise<void> {
    return handleArticlePathDeleted(this, path);
  }

  /** 转发到小说组模块读取小说配置。 */
  getNovelConfig(folderPath: string): NovelConfig {
    return getNovelConfig(this, folderPath);
  }

  /** 转发到文章模块取文章分组列表。 */
  getArticleGroups(folderPath: string): NovelArticleGroup[] {
    return getArticleGroups(this, folderPath);
  }

  /** 转发到文章模块按路径查所属分组。 */
  getArticleGroupForPath(folderPath: string, path: string): NovelArticleGroup | null {
    return getArticleGroupForPath(this, folderPath, path);
  }

  /** 转发到文章模块保存文章分组。 */
  async saveArticleGroup(folderPath: string, payload: { volume: string; name: string; description: string; paths: string[] },): Promise<void> {
    return saveArticleGroup(this, folderPath, payload);
  }

  /** 转发到文章模块向分组添加文章。 */
  async addArticlesToGroup(folderPath: string, groupId: string, paths: string[],): Promise<void> {
    return addArticlesToGroup(this, folderPath, groupId, paths);
  }

  /** 转发到文章模块更新分组名称描述。 */
  async updateArticleGroup(folderPath: string, groupId: string, draft: { name: string; description: string },): Promise<void> {
    return updateArticleGroup(this, folderPath, groupId, draft);
  }

  /** 转发到文章模块把文章移出分组。 */
  async removeArticlesFromGroup(folderPath: string, groupId: string, paths: string[],): Promise<void> {
    return removeArticlesFromGroup(this, folderPath, groupId, paths);
  }

  /** 转发到文章模块删除指定分组。 */
  async deleteArticleGroup(folderPath: string, id: string): Promise<void> {
    return deleteArticleGroup(this, folderPath, id);
  }

  /** 转发到文章模块更新卷的描述封面。 */
  async updateVolumeMeta(folderPath: string, volume: string, patch: { description?: string; cover?: string },): Promise<void> {
    return updateVolumeMeta(this, folderPath, volume, patch);
  }

  /** 转发到小说组模块编辑卷封面。 */
  async editNovelVolumeCover(folderPath: string, volume: string): Promise<void> {
    return editNovelVolumeCover(this, folderPath, volume);
  }

  /** 转发到小说组模块收集已占用封面。 */
  getUsedNovelCovers(folderPath: string): Set<string> {
    return getUsedNovelCovers(this, folderPath);
  }

  /** 转发到设定集模块判断索引文件路径。 */
  isSettingCollectionIndexPath(_path: string): boolean {
    return isSettingCollectionIndexPath(this, _path);
  }

  /** 转发到小说组模块判断是否特殊文件。 */
  isSpecialNovelFile(file: TFile): boolean {
    return isSpecialNovelFile(this, file);
  }

  /** 转发到小说组模块读取配置文件。 */
  async readNovelConfig(folderPath: string): Promise<NovelConfig> {
    return readNovelConfig(this, folderPath);
  }

  /** 转发到小说组模块写入配置文件。 */
  async writeNovelConfig(folderPath: string, config: NovelConfig): Promise<void> {
    return writeNovelConfig(this, folderPath, config);
  }

  /** 转发到小说组模块迁移旧版配置。 */
  async migrateNovelConfigs(): Promise<void> {
    return migrateNovelConfigs(this);
  }

  /** 转发到小说组模块载入全部小说配置。 */
  async loadNovelConfigs(): Promise<void> {
    return loadNovelConfigs(this);
  }

  /** 转发到拖拽模块判断是否文章拖拽。 */
  isArticleDragEvent(event: DragEvent): boolean {
    return isArticleDragEvent(this, event);
  }

  /** 转发到拖拽模块记录拖拽中的路径。 */
  setArticleDrag(paths: string[]): void {
    setArticleDrag(this, paths);
  }

  /** 转发到拖拽模块清空拖拽状态。 */
  clearArticleDrag(): void {
    clearArticleDrag(this);
  }

  /** 转发到拖拽模块解析落点与模式。 */
  getArticleDropContext(
    target: EventTarget | null,
  ): { mode: "split" | "tabs" | "replace"; header: HTMLElement | null } | null {
    return getArticleDropContext(this, target);
  }

  /** 转发到拖拽模块显示拖放预览。 */
  showArticleDragPreview(event: DragEvent, mode: "split" | "tabs" | "replace",): void {
    showArticleDragPreview(this, event, mode);
  }

  /** 转发到拖拽模块隐藏拖放预览。 */
  hideArticleDragPreview(): void {
    hideArticleDragPreview(this);
  }

  /** 转发到拖拽模块执行文章拖放。 */
  async performArticleDrop(mode: "split" | "tabs" | "replace", header: HTMLElement | null, paths: string[],): Promise<void> {
    return performArticleDrop(this, mode, header, paths);
  }

  /** 转发到拖拽模块执行内部拖放逻辑。 */
  async performArticleDropInner(mode: "split" | "tabs" | "replace", header: HTMLElement | null, paths: string[],): Promise<void> {
    return performArticleDropInner(this, mode, header, paths);
  }

  /** 转发到导航模块打开列表中的文章。 */
  openArticleFromList(path: string): void {
    openArticleFromList(this, path);
  }

  /** 打开任意文件并定位到指定行号。 */
  async openFileAtLine(file: TFile, line = 1): Promise<void> {
    if (!this.isNovelArticleFile(file)) {
      const leaf = this.app.workspace.getLeaf("tab");
      const target = Math.max(0, line - 1);
      await leaf.openFile(file, {
        active: true,
        eState: { line: target, ch: 0 },
      });
      window.setTimeout(() => {
        const view = this.getActiveMarkdownView();
        if (!view?.file || view.file.path !== file.path) {
          return;
        }
        try {
          const cursor = { line: target, ch: 0 };
          view.editor.setCursor(cursor);
          view.editor.scrollIntoView({ from: cursor, to: cursor }, true);
          view.editor.focus();
        } catch (error) {
          console.debug("Novel View: could not reveal target line", error);
        }
      }, 30);
      return;
    }
    await this.openNovelEditor(file, line);
  }

  /** 构建文章列表模型并过滤特殊文件。 */
  getArticleListModel(folderPath: string): ArticleListModel | null {
      const model = buildArticleListModel(this, folderPath);
      if (!model) {
        return null;
      }
      const isSpecialArticle = (path: string): boolean => {
        const file = this.app.vault.getAbstractFileByPath(path);
        return file instanceof TFile && this.isSpecialNovelFile(file);
      };
      model.articles = model.articles.filter((article) => (
        !isSpecialArticle(article.path)
      ));
      model.volumes.forEach((volume) => {
        volume.articles = volume.articles.filter((article) => (
          !isSpecialArticle(article.path)
        ));
      });
      const order = this.getNovelVolumeOrder(folderPath);
      const position = (name: string): number => {
        const index = order.indexOf(name);
        return index >= 0 ? index : order.length;
      };
      model.volumes.sort((left, right) => (
        position(left.name) - position(right.name)
      ));
      model.volumes.forEach((volume, index) => {
        volume.volumeNumber = index;
        volume.articles.sort((a, b) => this.compareChapterOrder(a, b));
        volume.articles.forEach((article, articleIndex) => {
          article.chapterNumber = articleIndex + 1;
        });
      });
      model.articles.sort((a, b) => this.compareChapterOrder(a, b));
      model.articles.forEach((article, index) => {
        article.chapterNumber = index + 1;
      });
      return model;
  
  }

  /** 转发到文章模块比较章节先后顺序。 */
  compareChapterOrder(left: ArticleEntry, right: ArticleEntry): number {
    return compareChapterOrder(this, left, right);
  }

  /** 转发到文章模块读取章节序号。 */
  getArticleId(path: string): number {
    return getArticleId(this, path);
  }

  /** 转发到文章模块计算下一个序号。 */
  getNextArticleId(folderPath: string): number {
    return getNextArticleId(this, folderPath);
  }

  /** 转发到文章模块校正卷排序数据。 */
  async ensureVolumeOrder(folderPath: string): Promise<boolean> {
    return ensureVolumeOrder(this, folderPath);
  }

  /** 转发到文章模块读取卷排序。 */
  getNovelVolumeOrder(folderPath: string): string[] {
    return getNovelVolumeOrder(this, folderPath);
  }

  /** 转发到文章模块保存卷排序。 */
  async saveNovelVolumeOrder(folderPath: string, order: string[]): Promise<void> {
    return saveNovelVolumeOrder(this, folderPath, order);
  }

  /** 转发到文章模块重排章节编号。 */
  async renumberFolder(folderPath: string): Promise<void> {
    return renumberFolder(this, folderPath);
  }

  /** 转发到文章模块重命名文章文件。 */
  async renameArticlePath(path: string, value: string): Promise<string | null> {
    return renameArticlePath(this, path, value);
  }

  /** 转发到文章模块重命名卷目录。 */
  async renameVolumePath(path: string, value: string): Promise<string | null> {
    return renameVolumePath(this, path, value);
  }

  /** 转发到文章模块删除选中文章。 */
  async deleteArticleTargets(targets: ArticleListTarget[], refresh: () => void,): Promise<void> {
    return deleteArticleTargets(this, targets, refresh);
  }


  /** 转发到导入模块解析并导入 TXT。 */
  async importNovelTxt(folderPath: string): Promise<void> {
    await importNovelTxtAsync(this, folderPath);
  }

  /** 转发到文章模块生成唯一目录名。 */
  getUniqueFolderPath(parentPath: string, base: string): string {
    return getUniqueFolderPath(this, parentPath, base);
  }

  /** 转发到文章模块撤销上一步文章操作。 */
  async undoLastArticleAction(): Promise<void> {
    return undoLastArticleAction(this);
  }

  /** 转发到文章模块把文章移入目标卷。 */
  async moveArticlesToVolume(paths: string[], targetFolder: string): Promise<boolean> {
    return moveArticlesToVolume(this, paths, targetFolder);
  }

  /** 转发到文章模块在指定位置重排文章。 */
  async reorderArticlesAt(paths: string[], targetPath: string, after: boolean,): Promise<boolean> {
    return reorderArticlesAt(this, paths, targetPath, after);
  }

  /** 转发到文章模块调整卷的先后顺序。 */
  async reorderVolume(folderPath: string, sourcePath: string, targetPath: string): Promise<void> {
    return reorderVolume(this, folderPath, sourcePath, targetPath);
  }

  /** 转发到小说组模块更新小说信息。 */
  async updateNovelInfo(folderPath: string, patch: { description?: string; cover?: string },): Promise<void> {
    return updateNovelInfo(this, folderPath, patch);
  }

  /** 转发到小说组模块更换小说封面。 */
  async editNovelCover(folderPath: string): Promise<void> {
    return editNovelCover(this, folderPath);
  }

  /** 转发到小说组模块重命名组目录。 */
  async renameNovelGroupFolder(folderPath: string, value: string,): Promise<void> {
    return renameNovelGroupFolder(this, folderPath, value);
  }

  /** 转发到设定集模块初始化设定组映射。 */
  async initializeSettingGroups(): Promise<void> {
    return initializeSettingGroups(this);
  }

  /** 转发到设定集模块清理索引历史。 */
  async cleanupSettingIndexHistory(): Promise<void> {
    return cleanupSettingIndexHistory(this);
  }

  /** 转发到小说组模块列出全部小说根目录。 */
  novelRoots(): string[] {
    return novelRoots(this);
  }

  /** 转发到设定集模块取设定组显示名。 */
  settingGroupNameFromFolder(folder: TFolder): string {
    return settingGroupNameFromFolder(this, folder);
  }

  /** 转发到设定集模块列出小说设定组目录。 */
  settingGroupsForNovel(novelRoot: string): TFolder[] {
    return settingGroupsForNovel(this, novelRoot);
  }

  /** 转发到设定集模块迁移旧设定集数据。 */
  async migrateLegacySettingCollections(): Promise<void> {
    return migrateLegacySettingCollections(this);
  }

  /** 转发到设定集模块载入设定组映射表。 */
  loadSettingGroups(): void {
    loadSettingGroups(this);
  }

  /** 转发到设定集模块取小说设定组目录。 */
  getSettingGroupFolderForNovel(novelRoot: string): TFolder | null {
    return getSettingGroupFolderForNovel(this, novelRoot);
  }

  /** 转发到设定集模块刷新全部设定视图。 */
  refreshSettingCollectionViews(): void {
    refreshSettingCollectionViews(this);
  }

  /** 转发到设定集模块解析路径所属设定根。 */
  settingRootForPath(path: string): string | null {
    return settingRootForPath(this, path);
  }

  /** 转发到设定集模块新建设定组。 */
  async createSettingGroup(novelPath: string): Promise<void> {
    return createSettingGroup(this, novelPath);
  }

  /** 转发到设定集模块全量替换关键词。 */
  async replaceNovelKeyword(
    novelRoot: string,
    oldKeyword: string,
    newKeyword: string,
  ): Promise<{ records: number; files: number } | null> {
    return replaceNovelKeyword(this, novelRoot, oldKeyword, newKeyword);
  }

  /** 转发到设定集模块取小说的设定组。 */
  getSettingGroupsForNovel(novelRoot: string): TFolder[] {
    return getSettingGroupsForNovel(this, novelRoot);
  }

  /** 转发到设定集模块取设定集文件夹。 */
  getSettingCollectionFolder(path: string): TFolder | null {
    return getSettingCollectionFolder(this, path);
  }

  /** 转发到设定集模块读取索引内容。 */
  async readSettingCollectionIndex(groupPath: string): Promise<SettingCollectionIndex> {
    return readSettingCollectionIndex(this, groupPath);
  }

  /** 转发到设定集模块写入索引内容。 */
  async writeSettingCollectionIndex(groupPath: string, index: SettingCollectionIndex,): Promise<void> {
    return writeSettingCollectionIndex(this, groupPath, index);
  }

  /** 转发到设定集模块取关键词记录文件。 */
  getSettingRecordFile(groupPath: string, keyword: string,): TFile | null {
    return getSettingRecordFile(this, groupPath, keyword);
  }

  /** 转发到设定集模块删除记录相关文件。 */
  async deleteSettingRecordFiles(groupPath: string, keyword: string,): Promise<void> {
    return deleteSettingRecordFiles(this, groupPath, keyword);
  }

  /** 转发到设定集模块生成设定组目录名。 */
  settingGroupFolderPathName(group: string): string {
    return settingGroupFolderPathName(this, group);
  }

  /** 转发到设定集模块生成详情节文件前缀。 */
  settingDetailPrefix(keyword: string): string {
    return settingDetailPrefix(this, keyword);
  }

  /** 转发到设定集模块取记录所在文件夹。 */
  getSettingRecordFolder(novelRootOrGroup: string, group: string,): TFolder | null {
    return getSettingRecordFolder(this, novelRootOrGroup, group);
  }

  /** 转发到设定集模块列出详情节文件。 */
  getSettingRecordDetailFiles(novelRoot: string, group: string, keyword: string,): TFile[] {
    return getSettingRecordDetailFiles(this, novelRoot, group, keyword);
  }

  /** 转发到设定集模块取详情节显示名。 */
  getSettingRecordDetailLabel(keyword: string, file: TFile): string {
    return getSettingRecordDetailLabel(this, keyword, file);
  }

  /** 转发到设定集模块新建详情节文件。 */
  async createSettingRecordDetail(novelRoot: string, group: string, keyword: string, title: string,): Promise<TFile | null> {
    return createSettingRecordDetail(this, novelRoot, group, keyword, title);
  }

  /** 转发到设定集模块重命名设定组目录。 */
  async renameSettingGroupFolder(folderPath: string, displayName: string,): Promise<string | null> {
    return renameSettingGroupFolder(this, folderPath, displayName);
  }

  /** 转发到设定集模块重命名详情节。 */
  async renameSettingRecordDetails(novelRoot: string, group: string, oldKeyword: string, newKeyword: string,): Promise<void> {
    return renameSettingRecordDetails(this, novelRoot, group, oldKeyword, newKeyword);
  }

  /** 转发到设定集模块移动详情节到新组。 */
  async moveSettingRecordDetails(novelRoot: string, sourceGroup: string, targetGroup: string, keyword: string,): Promise<void> {
    return moveSettingRecordDetails(this, novelRoot, sourceGroup, targetGroup, keyword);
  }

  /** 转发到设定集模块重命名索引分组。 */
  async renameSettingCollectionGroup(settingRoot: string, oldName: string, newName: string,): Promise<string | null> {
    return renameSettingCollectionGroup(this, settingRoot, oldName, newName);
  }

  /** 转发到设定集模块定位设定集目录。 */
  revealSettingCollectionFolder(folder: TFolder): void {
    revealSettingCollectionFolder(this, folder);
  }

  /** 转发到设定集模块定位设定组目录。 */
  revealSettingGroup(folder: TFolder): void {
    revealSettingGroup(this, folder);
  }

  /** 转发到设定集模块延迟重建索引。 */
  scheduleSettingCollection(root: string): void {
    scheduleSettingCollection(this, root);
  }

  /** 转发到设定集模块拼出记录文件路径。 */
  settingRecordPath(folder: TFolder, keyword: string): string {
    return settingRecordPath(this, folder, keyword);
  }

  /** 转发到设定集模块读取组内标签集合。 */
  async readSettingGroupRecords(folder: TFolder): Promise<SettingGroupTags> {
    return readSettingGroupRecords(this, folder);
  }

  /** 转发到设定集模块确保设定集完整。 */
  async ensureSettingCollection(groupPath: string,): Promise<SettingCollectionIndex> {
    return ensureSettingCollection(this, groupPath);
  }

  /** 转发到设定集模块登记设定组目录。 */
  registerSettingGroupFolder(path: string): boolean {
    return registerSettingGroupFolder(this, path);
  }

  /** 转发到设定集模块处理路径增删改。 */
  handleSettingGroupPathChange(newPath: string | null, oldPath: string | null,): void {
    handleSettingGroupPathChange(this, newPath, oldPath);
  }

  /** 转发到设定集模块判断是否设定组目录。 */
  isSettingGroupFolderPath(newPath: string, oldPath: string): boolean {
    return isSettingGroupFolderPath(this, newPath, oldPath);
  }

  /** 转发到设定集模块处理目录重命名。 */
  async handleSettingGroupFolderRename(oldPath: string, newPath: string,): Promise<void> {
    return handleSettingGroupFolderRename(this, oldPath, newPath);
  }

  /** 转发到设定集模块回滚异常重命名。 */
  async revertSettingGroupFolder(currentPath: string, settingRoot: string, oldKey: string,): Promise<void> {
    return revertSettingGroupFolder(this, currentPath, settingRoot, oldKey);
  }

  /** 转发到 novel-mode 模块装饰文件夹标题。 */
  decorateNovelFolderTitles(): void {
    decorateNovelFolderTitlesImpl(this);
  }

  /** 为文件夹右键菜单补充小说组命令。 */
  addNovelGroupMenuItem(menu: Menu, target: TAbstractFile): void {
    if (!(target instanceof TFolder)) {
      return;
    }
    const folderPath = this.normalizeFolderPath(target.path);
    if (folderPath === "/") {
      return;
    }
    if (this.getNovelSettingFile(folderPath)) {
      menu.addItem((item) => {
        item.setTitle("打开小说组").setIcon("book-open").onClick(() => {
          this.workbenchFolderPath = folderPath;
          void this.openArticleList(folderPath).then(() => this.activateWorkbench());
        });
      });
      menu.addItem((item) => {
        item.setTitle("取消小说组构建").setIcon("trash").onClick(() => {
          void this.cancelNovelGroup(target);
        });
      });
      return;
    }
    menu.addItem((item) => {
      item.setTitle("构建小说组").setIcon("book-plus").onClick(() => {
        void this.createNovelGroup(target);
      });
    });
  }

  /** 转发到小说组模块判断保留目录名。 */
  isReservedNovelFolder(name: string): boolean {
    return isReservedNovelFolder(this, name);
  }

  /** 转发到导出模块导出整部小说。 */
  async exportNovelGroup(folderPath: string): Promise<void> {
    await exportNovelGroupAsync(this, folderPath);
  }

  /** 转发到小说组模块构建小说组。 */
  async createNovelGroup(folder: TFolder): Promise<void> {
    return createNovelGroup(this, folder);
  }

  /** 转发到文章模块取连续选中区间。 */
  getContiguousArticleSelection(folderPath: string, targets: ArticleListTarget[],): { volume: string; paths: string[] } | null {
    return getContiguousArticleSelection(this, folderPath, targets);
  }

  /** 转发到文章模块弹出列表右键菜单。 */
  showArticleListContextMenu(event: MouseEvent, folderPath: string, contextPath: string, refresh: () => void, targets: ArticleListTarget[] = [], onRename?: () => void,): void {
    showArticleListContextMenu(this, event, folderPath, contextPath, refresh);
  }

  /** 转发到设定集模块兜底处理目录点击。 */
  handleSettingGroupFolderClickFallback(event: MouseEvent): void {
    handleSettingGroupFolderClickFallback(this, event);
  }

  /** 转发到小说组模块处理文件夹点击。 */
  handleNovelFolderClick(event: MouseEvent): void {
    handleNovelFolderClick(this, event);
  }

  /** 转发到小说组模块判断是否强制模式。 */
  isForcedNovelMode(file: TFile): boolean {
    return isForcedNovelMode(this, file);
  }

  /** 转发到小说组模块判断是否小说章节。 */
  isNovelArticleFile(file: TFile): boolean {
    return isNovelArticleFile(this, file);
  }

  /** 清除笔记视图上遗留的小说模式样式。 */

  /** 转发到导航模块路由小说文件打开。 */
  routeNovelFileOpen(file: TFile): void {
    routeNovelFileOpen(this, file);
  }



  /** 转发到导航模块在新标签打开编辑器。 */
  /** 在指定 leaf 内直接打开 NovelEditor，不经过原生 MarkdownView */
  async openNovelEditorInLeaf(
    leaf: WorkspaceLeaf,
    file: TFile,
    active = true,
  ): Promise<void> {
    const previous = this.routingNovelFile;
    this.routingNovelFile = true;
    try {
      await leaf.setViewState({
        type: NOVEL_EDITOR_VIEW_TYPE,
        state: { file: file.path, line: 1 },
        active,
      });
    } finally {
      this.routingNovelFile = previous;
    }
  }

  /** 启动时把所有承载小说章节的 Markdown 叶子转成 NovelEditor */
  async takeOverNovelMarkdownLeaves(): Promise<void> {
    const leaves = this.app.workspace.getLeavesOfType("markdown");
    for (const leaf of leaves) {
      const view = leaf.view;
      if (!(view instanceof MarkdownView) || !view.file) {
        continue;
      }
      if (!this.isNovelArticleFile(view.file)) {
        continue;
      }
      await this.openNovelEditorInLeaf(leaf, view.file, false);
    }
  }

  async openNovelEditorInNewTab(file: TFile): Promise<void> {
    return openNovelEditorInNewTab(this, file);
  }

  /** 转发到导航模块打开小说编辑器。 */
  async openNovelEditor(file: TFile, line = 1): Promise<void> {
    return openNovelEditor(this, file, line);
  }

  /** 转发到导航模块取活动编辑器文件。 */
  getActiveNovelEditorFile(): TFile | null {
    return getActiveNovelEditorFile(this);
  }

  /** 转发到统计模块取活动编辑器正文。 */
  getActiveNovelEditorText(): string | null {
    return getActiveNovelEditorText(this);
  }

  /** 转发到导航模块按路径查找编辑器。 */
  findNovelEditorView(path: string): NovelEditorView | null {
    return findNovelEditorView(this, path);
  }

  /** 转发到导航模块切换编辑器当前文件。 */
  setNovelEditorFile(file: TFile): void {
    setNovelEditorFile(this, file);
  }

  /** 转发到导航模块同步文章状态卡片。 */

  /** 转发到导航模块判断左侧栏面板。 */
  isLeftSidebarLeaf(leaf: WorkspaceLeaf): boolean {
    return isLeftSidebarLeaf(this, leaf);
  }

  /** 转发到导航模块判断右侧栏面板。 */
  isRightSidebarLeaf(leaf: WorkspaceLeaf): boolean {
    return isRightSidebarLeaf(this, leaf);
  }

  /** 转发到导航模块取左侧栏面板。 */
  leftSidebarLeaf(): WorkspaceLeaf {
    return leftSidebarLeaf(this);
  }

  /** 转发到导航模块取右侧栏面板。 */
  rightSidebarLeaf(): WorkspaceLeaf {
    return rightSidebarLeaf(this);
  }

  /** 转发到导航模块打开文本标记区间。 */
  async openTextMarkRange(file: TFile, start: number, end: number,): Promise<void> {
    return openTextMarkRange(this, file, start, end);
  }

  /** 转发到导航模块打开文本标记集合。 */
  async openTextMarks(folderPath: string, _sourceLeaf?: WorkspaceLeaf,): Promise<void> {
    return openTextMarks(this, folderPath, _sourceLeaf);
  }

  /** 转发到设定集模块打开设定集列表。 */
  async openSettingCollectionList(folderPath: string, sourceLeaf?: WorkspaceLeaf,): Promise<void> {
    return openSettingCollectionList(this, folderPath, sourceLeaf);
  }

  /** 转发到设定集模块打开设定集视图。 */
  async openSettingCollection(folderPath: string, focus?: { group: string; tag: string; keyword: string },): Promise<void> {
    return openSettingCollection(this, folderPath, focus);
  }

  /** 转发到关键词模块打开关键词记录。 */
  async openSettingKeywordRecord(
    sourcePath: string,
    keyword: string,
  ): Promise<void> {
    await openSettingKeywordRecordAsync(
      this,
      sourcePath,
      keyword,
      (key) => this.settingKeywordTooltip.pageFor(key),
    );
  }

  /** 转发到设定集模块按关键词打开记录。 */
  async openSettingRecordForNovelKeyword(novelRoot: string, keyword: string,): Promise<boolean> {
    return openSettingRecordForNovelKeyword(this, novelRoot, keyword);
  }

  /** 转发到设定集模块打开指定设定记录。 */
  async openSettingRecord(sourcePath: string, group: string, tag: string, keyword: string,): Promise<void> {
    return openSettingRecord(this, sourcePath, group, tag, keyword);
  }

  /** 转发到导航模块打开素材图库。 */
  async openNovelSrcGallery(folderPath: string): Promise<void> {
    return openNovelSrcGallery(this, folderPath);
  }

  /** 转发到导入模块把图片导入素材。 */
  async importMaterialImage(folderPath: string, file: File): Promise<void> {
    await importMaterialImageAsync(this, folderPath, file);
  }

}

