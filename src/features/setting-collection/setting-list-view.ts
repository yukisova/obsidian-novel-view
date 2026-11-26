import {
  ItemView,
  Menu,
  setIcon,
  TAbstractFile,
  TFile,
  TFolder,
  type WorkspaceLeaf,
} from "obsidian";
import { ARTICLE_LIST_VIEW_TYPE } from "../article-list/article-list-view";
import {
  OUTLINE_MARKS_PROPERTY,
  parseOutlineMarks,
} from "../../core/model/outline-marks";
import type NovelViewPlugin from "../../main";

export const SETTING_LIST_VIEW_TYPE = "novelview-setting-list";

interface SettingListGroup {
  folder: TFolder;
  name: string;
  tagCount: number;
  recordCount: number;
}

export class NovelSettingListView extends ItemView {
  private readonly plugin: NovelViewPlugin;
  private folderPath = "";
  private refreshToken = 0;
  private refreshTimer: number | null = null;
  private renamingRow: HTMLElement | null = null;

  /** 初始化设定集列表视图实例 */
  constructor(leaf: WorkspaceLeaf, plugin: NovelViewPlugin) {
    super(leaf);
    this.plugin = plugin;
    this.navigation = false;
  }

  /** 返回设定集列表的类型标识 */
  override getViewType(): string {
    return SETTING_LIST_VIEW_TYPE;
  }

  /** 返回列表视图的显示标题 */
  override getDisplayText(): string {
    return "设定集列表";
  }

  /** 返回视图在侧栏显示的图标 */
  override getIcon(): string {
    return "library";
  }

  /** 导出当前列表视图状态 */
  override getState(): Record<string, unknown> {
    return { folderPath: this.folderPath };
  }

  /** 恢复视图状态并重新渲染 */
  override async setState(
    state: Record<string, unknown>,
    result: import("obsidian").ViewStateResult,
  ): Promise<void> {
    this.folderPath = typeof state.folderPath === "string"
      ? state.folderPath
      : this.folderPath;
    result.history = true;
    await super.setState(state, result);
    await this.render();
  }

  /** 初始化列表并监听库变化 */
  protected override async onOpen(): Promise<void> {
    this.contentEl.empty();
    this.contentEl.addClass(
      "novelview-article-list-view",
      "novelview-setting-list-view",
    );
    const schedule = (file: TAbstractFile): void => {
      if (
        file instanceof TFolder
        || (file instanceof TFile && file.extension === "md")
      ) {
        this.scheduleRefresh();
      }
    };
    this.registerEvent(this.app.vault.on("create", schedule));
    this.registerEvent(this.app.vault.on("modify", schedule));
    this.registerEvent(this.app.vault.on("delete", schedule));
    this.registerEvent(this.app.vault.on("rename", schedule));
    await this.render();
  }

  /** 关闭视图并停止刷新计时 */
  protected override async onClose(): Promise<void> {
    this.refreshToken += 1;
    if (this.refreshTimer !== null) {
      window.clearTimeout(this.refreshTimer);
      this.refreshTimer = null;
    }
    this.contentEl.empty();
  }

  /** 防抖安排列表刷新任务 */
  private scheduleRefresh(): void {
    if (this.refreshTimer !== null) {
      window.clearTimeout(this.refreshTimer);
    }
    this.refreshTimer = window.setTimeout(() => {
      this.refreshTimer = null;
      void this.render();
    }, 120);
  }

  /** 切换回小说文章列表视图 */
  private async backToArticles(): Promise<void> {
    await this.leaf.setViewState({
      type: ARTICLE_LIST_VIEW_TYPE,
      state: { folderPath: this.folderPath },
      active: true,
    });
  }

  /** 渲染设定集列表与统计信息 */
  private async render(): Promise<void> {
    const token = ++this.refreshToken;
    this.contentEl.empty();
    this.contentEl.addClass(
      "novelview-article-list-view",
      "novelview-setting-list-view",
    );
    const novelRoot = this.plugin.findNovelGroupRoot(this.folderPath)
      ?? this.folderPath;
    const toolbar = this.contentEl.createDiv({
      cls: "novelview-article-toolbar",
    });
    const back = this.createToolbarButton(
      toolbar,
      "arrow-left",
      "返回文件列表",
      () => void this.plugin.restoreFileExplorer(this.leaf),
    );
    back.addClass("novelview-article-toolbar-back");
    back.createSpan({
      cls: "novelview-article-toolbar-back-label",
      text: "返回",
    });
    this.createToolbarButton(toolbar, "refresh-cw", "刷新设定集", () => {
      void this.render();
    });
    const articleButton = this.createToolbarButton(
      toolbar,
      "book-open",
      "返回小说组列表",
      () => void this.backToArticles(),
    );
    articleButton.addClass("novelview-setting-toolbar-back-article");

    const groups = await this.loadGroups(novelRoot);
    const defaultGroup = groups.find((group) => group.folder.name === "-");
    const defaultTags = defaultGroup
      ? await this.plugin.readSettingCollectionIndex(defaultGroup.folder.path)
      : {};
    const defaultEntries = Object.values(defaultTags)
      .flatMap((tags) => tags.flatMap((tag) => tag.contain.map((entry) => ({
        entry,
        tag,
      }))));
    const regularGroups = groups.filter((group) => group.folder.name !== "-");
    if (token !== this.refreshToken) {
      return;
    }
    const header = this.contentEl.createDiv({
      cls: "novelview-article-header",
    });
    const titleBlock = header.createDiv({
      cls: "novelview-article-title-block",
    });
    const novelName = this.plugin.getNovelGroupInfo(novelRoot)?.name
      ?? novelRoot.split("/").pop()
      ?? "设定集";
    const title = titleBlock.createDiv({
      cls: "novelview-article-title is-clickable",
      text: novelName,
      attr: { role: "button", tabindex: "0", title: "打开 Novel View 工作台" },
    });
    const openWorkbench = (): void => {
      void this.plugin.openWorkbenchForGroup(novelRoot);
    };
    title.addEventListener("click", openWorkbench);
    title.addEventListener("keydown", (event) => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        openWorkbench();
      }
    });
    const total = defaultEntries.length > 0
      ? `${regularGroups.length} 个设定集 · ${defaultEntries.length} 个默认设定`
      : `${regularGroups.length} 个设定集`;
    titleBlock.createDiv({
      cls: "novelview-article-total",
      text: total,
    });

    const list = this.contentEl.createDiv({
      cls: "novelview-article-list",
    });
    list.addEventListener("contextmenu", (event) => {
      const target = event.target as HTMLElement | null;
      if (target?.closest(
        ".novelview-article-row, .novelview-article-toolbar, .novelview-setting-list-divider",
      )) {
        return;
      }
      event.preventDefault();
      this.openBlankMenu(event, novelRoot);
    });
    const markCount = this.countTextMarks(novelRoot);
    const markRow = list.createEl("button", {
      cls: "novelview-article-row novelview-setting-list-row novelview-setting-list-mark-row",
      attr: {
        type: "button",
        title: "文字标记：正文标记的默认集合",
      },
    });
    const markIcon = markRow.createSpan({ cls: "novelview-article-row-icon" });
    markIcon.setAttr("aria-hidden", "true");
    setIcon(markIcon, "highlighter");
    markRow.createSpan({
      cls: "novelview-article-row-name",
      text: "文字标记",
    });
    markRow.createSpan({
      cls: "novelview-setting-list-mark-badge",
      text: "默认",
    });
    markRow.createSpan({
      cls: "novelview-article-row-count",
      text: `${markCount} 处`,
    });
    markRow.addEventListener("click", () => {
      void this.plugin.openTextMarks(novelRoot, this.leaf);
    });
    if (regularGroups.length === 0 && defaultEntries.length === 0) {
      list.createDiv({
        cls: "novelview-setting-list-empty",
        text: "暂无设定集。右击列表空白处可新建设定组。",
      });
      return;
    }
    for (const group of regularGroups) {
      const row = list.createEl("button", {
        cls: "novelview-article-row novelview-setting-list-row",
        attr: {
          type: "button",
          title: `${group.name}：${group.tagCount} 个标签 / ${group.recordCount} 条记录`,
          "data-setting-group-row": group.folder.path,
        },
      });
      const icon = row.createSpan({ cls: "novelview-article-row-icon" });
      icon.setAttr("aria-hidden", "true");
      setIcon(icon, "library");
      row.createSpan({
        cls: "novelview-article-row-name",
        text: group.name,
      });
      row.createSpan({
        cls: "novelview-article-row-count",
        text: `${group.recordCount} 条`,
      });
      row.addEventListener("click", () => {
        if (this.renamingRow === row) {
          return;
        }
        void this.plugin.openSettingCollection(group.folder.path);
      });
      row.addEventListener("contextmenu", (event) => {
        event.preventDefault();
        event.stopPropagation();
        const menu = new Menu();
        menu.addItem((item) => {
          item.setTitle("重命名").setIcon("pencil").onClick(() => {
            this.beginGroupRename(row, group);
          });
        });
        menu.addSeparator();
        menu.addItem((item) => {
          item.setTitle("删除").setIcon("trash").onClick(() => {
            void this.deleteSettingGroup(group);
          });
        });
        menu.showAtMouseEvent(event);
      });
    }
    if (defaultEntries.length > 0) {
      list.createDiv({ cls: "novelview-setting-list-divider" });
    for (const [index, item] of defaultEntries.entries()) {
      const row = list.createEl("button", {
        cls: "novelview-article-row novelview-setting-list-row novelview-setting-list-single-row novelview-setting-list-detail-row",
        attr: {
          type: "button",
          title: `${item.tag.tag} / 默认设定`,
        },
      });
      const icon = row.createSpan({ cls: "novelview-article-row-icon" });
      icon.setAttr("aria-hidden", "true");
      setIcon(icon, item.entry.icon?.startsWith("lucide:")
        ? item.entry.icon.slice("lucide:".length)
        : "file-text");
      row.createSpan({
        cls: "novelview-article-row-name",
        text: item.entry.keyword,
      });
      row.createSpan({
        cls: "novelview-setting-list-single-badge",
        text: "默认设定",
      });
      if (index === 0) {
        row.addClass("is-first-default-row");
      }
      row.addEventListener("click", () => {
        if (!defaultGroup) {
          return;
        }
        const file = this.plugin.getSettingRecordFile(
          defaultGroup.folder.path,
          item.entry.keyword,
        );
        if (file) {
          void this.app.workspace.getLeaf(false).openFile(file);
        }
      });
    }
    }
  }

  /** 删除设定组文件夹并刷新 */
  private async deleteSettingGroup(group: SettingListGroup): Promise<void> {
    await this.app.fileManager.trashFile(group.folder);
    this.renamingRow = null;
    this.scheduleRefresh();
  }

  /** 在空白处弹出新建菜单 */
  private openBlankMenu(event: MouseEvent, novelRoot: string): void {
    const menu = new Menu();
    menu.addItem((item) => {
      item.setTitle("新建设定组").setIcon("folder-plus").onClick(() => {
        void this.plugin.createSettingGroup(novelRoot).then(() => {
          this.scheduleRefresh();
        });
      });
    });
    menu.showAtMouseEvent(event);
  }

  /** 开始就地重命名设定组 */
  private beginGroupRename(row: HTMLElement, group: SettingListGroup): void {
    this.beginInlineRename(
      row,
      group.name,
      (value) => this.validateGroupName(group, value),
      (value) => this.plugin.renameSettingGroupFolder(
        group.folder.path,
        value,
      ),
    );
  }

  /** 校验设定组名称是否合法 */
  private validateGroupName(
    group: SettingListGroup,
    value: string,
  ): string | null {
    if (value !== value.trim()) {
      return "名称首尾不能有空格。";
    }
    const name = value.replace(/^-+/u, "").trim();
    if (!name) {
      return "设定组名称不能为空。";
    }
    if (/[\\/:*?"<>|]/u.test(name)) {
      return "名称包含路径非法字符。";
    }
    if (name.endsWith(".") || name === "." || name === "..") {
      return "名称不能以点号结尾。";
    }
    if (/^(src|分散卷)$/iu.test(name)) {
      return "该名称是保留目录名。";
    }
    const parent = group.folder.parent;
    const target = parent
      ? `${parent.path}/${`-${name}`}`
      : `-${name}`;
    if (
      target !== group.folder.path
      && this.app.vault.getAbstractFileByPath(target)
    ) {
      return "同名设定组已存在。";
    }
    return null;
  }

  /** 在行内嵌入重命名输入框 */
  private beginInlineRename(
    row: HTMLElement,
    initial: string,
    validate: (value: string) => string | null,
    commit: (value: string) => Promise<string | null>,
  ): void {
    if (this.renamingRow) {
      return;
    }
    const nameEl = row.querySelector<HTMLElement>(
      ".novelview-article-row-name",
    );
    if (!nameEl) {
      return;
    }
    this.renamingRow = row;
    row.addClass("is-renaming");
    const input = row.createEl("input", {
      cls: "novelview-inline-rename",
      attr: {
        type: "text",
        value: initial,
        "aria-label": "重命名",
      },
    });
    input.value = initial;
    const error = row.createSpan({
      cls: "novelview-setting-inline-error",
    });
    nameEl.replaceWith(input);
    let busy = false;
    let finished = false;
    const showError = (message: string): void => {
      error.setText(message);
      input.addClass("is-invalid");
      input.setAttr("title", message);
      input.focus();
    };
    const finish = async (save: boolean): Promise<void> => {
      if (busy || finished) {
        return;
      }
      if (!save) {
        finished = true;
        this.renamingRow = null;
        this.scheduleRefresh();
        return;
      }
      const validation = validate(input.value);
      if (validation) {
        showError(validation);
        return;
      }
      busy = true;
      const result = await commit(input.value);
      busy = false;
      if (result) {
        showError(result);
        return;
      }
      finished = true;
      this.renamingRow = null;
      this.scheduleRefresh();
    };
    const stop = (event: Event): void => {
      event.stopPropagation();
    };
    input.addEventListener("pointerdown", stop);
    input.addEventListener("click", stop);
    input.addEventListener("dblclick", stop);
    input.addEventListener("keydown", (event) => {
      event.stopPropagation();
      if (event.key === "Enter") {
        event.preventDefault();
        void finish(true);
      } else if (event.key === "Escape") {
        event.preventDefault();
        void finish(false);
      }
    });
    input.addEventListener("blur", () => {
      if (!finished) {
        void finish(true);
      }
    });
    window.setTimeout(() => {
      input.focus();
      input.select();
    }, 0);
  }

  /** 加载设定组及标签记录统计 */
  private async loadGroups(novelRoot: string): Promise<SettingListGroup[]> {
    const groups: SettingListGroup[] = [];
    for (const folder of this.plugin.getSettingGroupsForNovel(novelRoot)) {
      const index = await this.plugin.readSettingCollectionIndex(folder.path);
      let tagCount = 0;
      let recordCount = 0;
      for (const tags of Object.values(index)) {
        for (const tag of tags) {
          tagCount += 1;
          recordCount += tag.contain.length;
        }
      }
      groups.push({
        folder,
        name: folder.name === "-" ? "默认设定" : folder.name.replace(/^-+/u, ""),
        tagCount,
        recordCount,
      });
    }
    return groups.sort((left, right) => left.name.localeCompare(
      right.name,
      "zh-CN",
      { numeric: true, sensitivity: "base" },
    ));
  }

  /** 统计小说正文中的文字标记 */
  private countTextMarks(novelRoot: string): number {
    const root = this.plugin.normalizeFolderPath(novelRoot);
    let count = 0;
    for (const file of this.app.vault.getMarkdownFiles()) {
      if (
        !this.plugin.isNovelArticleFile(file)
        || (file.path !== root && !file.path.startsWith(`${root}/`))
      ) {
        continue;
      }
      const frontmatter: unknown = this.app.metadataCache.getFileCache(file)
        ?.frontmatter;
      const raw: unknown = frontmatter && typeof frontmatter === "object"
        ? (frontmatter as Record<string, unknown>)[OUTLINE_MARKS_PROPERTY]
        : undefined;
      count += parseOutlineMarks(raw).length;
    }
    return count;
  }

  /** 创建带图标的工具栏按钮 */
  private createToolbarButton(
    parent: HTMLElement,
    icon: string,
    label: string,
    onClick: () => void,
  ): HTMLButtonElement {
    const button = parent.createEl("button", {
      cls: "novelview-article-toolbar-button",
      attr: {
        type: "button",
        "aria-label": label,
        title: label,
      },
    });
    setIcon(button, icon);
    button.addEventListener("click", onClick);
    return button;
  }
}
