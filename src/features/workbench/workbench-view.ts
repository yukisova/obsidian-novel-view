import {
  ItemView,
  setIcon,
  TFile,
  type WorkspaceLeaf,
} from "obsidian";
import { groupNovelHistory } from "../../core/model/novel-config";
import type NovelViewPlugin from "../../main";

export const WORKBENCH_VIEW_TYPE = "novelview-workbench";

export class NovelWorkbenchView extends ItemView {
  private readonly plugin: NovelViewPlugin;
  private refreshFrame: number | null = null;
  private renderToken = 0;


  /** 初始化工作台视图并关闭导航 */
  constructor(leaf: WorkspaceLeaf, plugin: NovelViewPlugin) {
    super(leaf);
    this.plugin = plugin;
    this.navigation = false;
  }

  /** 返回工作台视图的唯一类型标识 */
  override getViewType(): string {
    return WORKBENCH_VIEW_TYPE;
  }

  /** 提供标签页显示的工作台标题 */
  override getDisplayText(): string {
    return "Novel View 工作台";
  }

  /** 返回工作台标签页使用的图标 */
  override getIcon(): string {
    return "layout-dashboard";
  }

  /** 注册事件监听并首次渲染工作台 */
  protected override async onOpen(): Promise<void> {
    this.contentEl.empty();
    this.contentEl.addClass("novelview-workbench");

    this.registerEvent(
      this.app.workspace.on("active-leaf-change", () => this.scheduleRefresh()),
    );
    this.registerEvent(
      this.app.workspace.on("file-open", () => this.scheduleRefresh()),
    );
    this.registerEvent(
      this.app.workspace.on("layout-change", () => this.scheduleRefresh()),
    );
    this.registerEvent(
      this.app.vault.on("rename", () => this.scheduleRefresh()),
    );
    this.registerEvent(
      this.app.vault.on("delete", () => this.scheduleRefresh()),
    );
    this.registerEvent(
      this.app.metadataCache.on("changed", () => this.scheduleRefresh()),
    );

    await this.render();
  }

  /** 取消待刷新帧并清空工作台内容 */
  protected override async onClose(): Promise<void> {
    await Promise.resolve();
    this.renderToken += 1;
    if (this.refreshFrame !== null) {
      window.cancelAnimationFrame(this.refreshFrame);
      this.refreshFrame = null;
    }
    this.contentEl.empty();
  }

  /** 合并刷新请求到下一动画帧执行 */
  scheduleRefresh(): void {
    if (this.refreshFrame !== null) {
      return;
    }
    this.refreshFrame = window.requestAnimationFrame(() => {
      this.refreshFrame = null;
      void this.render();
    });
  }

  /** 汇总小说信息、统计与历史后重绘 */
  private async render(): Promise<void> {
    const token = ++this.renderToken;
    const scrollTop = this.contentEl.scrollTop;
    this.contentEl.empty();

    const current = this.plugin.getLastActiveMarkdownFile();
    const folderPath = this.plugin.getWorkbenchFolderPath();
    const novel = folderPath
      ? this.plugin.getNovelGroupInfo(folderPath)
      : null;

    if (novel) {
      const model = this.plugin.getArticleListModel(novel.folderPath);
      const articles = model
        ? [...model.articles, ...model.volumes.flatMap((volume) => volume.articles)]
        : [];
      let wordCount = 0;
      for (const article of articles) {
        const meta = await this.plugin.getChapterMeta(article.path);
        wordCount += meta.wordCount;
      }
      this.renderNovelOverview(novel, {
        wordCount,
        volumeCount: model?.volumes.length ?? 0,
        chapterCount: articles.length,
      });
      this.renderHistory(novel.folderPath);
    } else {
      this.renderContext(current, folderPath);
    }

    if (token === this.renderToken && scrollTop > 0) {
      this.contentEl.scrollTop = scrollTop;
    }
  }

  /** 渲染小说封面、可编辑名称与统计 */
  private renderNovelOverview(novel: {
    folderPath: string;
    name: string;
    description: string;
    cover: string;
  }, stats: { wordCount: number; volumeCount: number; chapterCount: number }): void {
    const root = this.contentEl.createDiv({
      cls: "novelview-workbench-novel",
    });
    root.setAttr("data-folder", novel.folderPath);

    const cover = root.createDiv({
      cls: "novelview-workbench-cover is-clickable",
    });
    cover.setAttr("title", "点击更换封面");
    cover.addEventListener("click", () => {
      void this.plugin.editNovelCover(novel.folderPath);
    });
    const coverUrl = this.plugin.getNovelCoverUrl(novel.folderPath, novel.cover);
    if (coverUrl) {
      cover.createEl("img", {
        cls: "novelview-workbench-cover-image",
        attr: {
          src: coverUrl,
          alt: `${novel.name} 封面`,
        },
      });
    } else {
      const placeholder = cover.createSpan({
        cls: "novelview-workbench-cover-placeholder",
      });
      setIcon(placeholder, "book-open");
    }

    const body = root.createDiv({ cls: "novelview-workbench-novel-body" });
    body.createDiv({
      cls: "novelview-workbench-context-label",
      text: "小说组",
    });
    const titleRow = body.createDiv({
      cls: "novelview-workbench-novel-title-row",
    });
    const title = titleRow.createDiv({
      cls: "novelview-workbench-novel-name is-editable",
      text: novel.name,
    });
    title.setAttr("contenteditable", "true");
    title.setAttr("role", "textbox");
    title.setAttr("title", "点击修改小说名称");
    title.addEventListener("keydown", (event) => {
      if (event.key === "Enter") {
        event.preventDefault();
        title.blur();
      }
      if (event.key === "Escape") {
        title.textContent = novel.name;
        title.blur();
      }
    });
    title.addEventListener("blur", () => {
      const value = title.textContent?.trim() ?? "";
      if (value && value !== novel.name) {
        void this.plugin.renameNovelGroupFolder(novel.folderPath, value);
      } else {
        title.textContent = novel.name;
      }
    });

    const description = body.createDiv({
      cls: "novelview-workbench-novel-description is-editable",
      text: novel.description,
    });
    description.setAttr("contenteditable", "true");
    description.setAttr("role", "textbox");
    description.setAttr("data-placeholder", "点击填写小说简介");
    description.setAttr("title", "点击编辑小说简介");
    description.addEventListener("keydown", (event) => {
      if (event.key === "Enter") {
        event.preventDefault();
        description.blur();
      }
      if (event.key === "Escape") {
        description.textContent = novel.description;
        description.blur();
      }
    });
    description.addEventListener("blur", () => {
      const value = description.textContent?.trim() ?? "";
      if (value !== novel.description) {
        void this.plugin.updateNovelInfo(novel.folderPath, {
          description: value,
        });
      }
    });


    root.createDiv({
      cls: "novelview-workbench-novel-stats",
      text: `${new Intl.NumberFormat("zh-CN").format(stats.wordCount)}字 · 共 ${stats.volumeCount} 卷 · ${stats.chapterCount} 章`,
    });
  }


  /** 按时间分组列出近期写作历史 */
  private renderHistory(folderPath: string): void {
    const config = this.plugin.getNovelConfig(folderPath);
    const section = this.contentEl.createDiv({ cls: "novelview-history" });
    section.createDiv({ cls: "novelview-history-title", text: "历史记录" });
    const history = config.history.filter(
      (entry) => !this.plugin.isSettingCollectionIndexPath(entry.path),
    );
    if (history.length === 0) {
      section.createDiv({
        cls: "novelview-history-empty",
        text: "暂无历史记录。",
      });
      return;
    }
    const groups = groupNovelHistory(history);
    if (groups.length === 0) {
      section.createDiv({
        cls: "novelview-history-empty",
        text: "暂无历史记录。",
      });
      return;
    }
    const blocks = section.createDiv({ cls: "novelview-history-blocks" });
    for (const group of groups) {
      const date = new Date(group.bucketStart);
      const block = blocks.createDiv({
        cls: `novelview-history-bucket${group.day ? " is-day" : ""}`,
      });
      block.createDiv({
        cls: "novelview-history-date",
        text: `${date.getFullYear()}.${date.getMonth() + 1}.${date.getDate()}`,
      });
      const startHour = date.getHours();
      block.createDiv({
        cls: "novelview-history-time",
        text: group.day
          ? "全天"
          : `${String(startHour).padStart(2, "0")}:00 - ${String(startHour + 4).padStart(2, "0")}:00`,
      });
      const list = block.createDiv({ cls: "novelview-history-entries" });
      for (const entry of group.entries) {
        const file = this.app.vault.getAbstractFileByPath(entry.path);
        const name = file instanceof TFile ? file.basename : entry.name;
        const row = list.createDiv({ cls: "novelview-history-entry" });
        row.createDiv({ cls: "novelview-history-entry-name", text: name });
        row.createDiv({
          cls: `novelview-history-delta${entry.delta > 0 ? " is-positive" : " is-negative"}`,
          text: `${entry.delta > 0 ? "+" : ""}${entry.delta}字`,
        });
      }
    }
  }

  /** 无小说组时提示当前目录与文件 */
  private renderContext(current: TFile | null, folderPath: string | null): void {
    const context = this.contentEl.createDiv({
      cls: "novelview-workbench-context",
    });
    context.createDiv({
      cls: "novelview-workbench-context-label",
      text: "当前小说目录",
    });
    context.createDiv({
      cls: "novelview-workbench-context-folder",
      text: folderPath
        ? (folderPath === "/" ? "Vault 根目录" : folderPath)
        : "尚未打开小说目录",
    });
    if (current) {
      context.createDiv({
        cls: "novelview-workbench-context-file",
        text: current.basename,
      });
    }
  }
}
