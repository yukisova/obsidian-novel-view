import {
  ItemView,
  Notice,
  setIcon,
  TFile,
  type WorkspaceLeaf,
} from "obsidian";
import { confirmAction } from "./confirm-modal";
import { SettingGroupModal } from "./setting-collection-modal";
import type NovelViewPlugin from "./main";

export const WORKBENCH_VIEW_TYPE = "novelview-workbench";

export class NovelWorkbenchView extends ItemView {
  private readonly plugin: NovelViewPlugin;
  private refreshFrame: number | null = null;
  private renderToken = 0;


  constructor(leaf: WorkspaceLeaf, plugin: NovelViewPlugin) {
    super(leaf);
    this.plugin = plugin;
    this.navigation = false;
  }

  override getViewType(): string {
    return WORKBENCH_VIEW_TYPE;
  }

  override getDisplayText(): string {
    return "Novel View 工作台";
  }

  override getIcon(): string {
    return "layout-dashboard";
  }

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

  protected override async onClose(): Promise<void> {
    await Promise.resolve();
    this.renderToken += 1;
    if (this.refreshFrame !== null) {
      window.cancelAnimationFrame(this.refreshFrame);
      this.refreshFrame = null;
    }
    this.contentEl.empty();
  }

  scheduleRefresh(): void {
    if (this.refreshFrame !== null) {
      return;
    }
    this.refreshFrame = window.requestAnimationFrame(() => {
      this.refreshFrame = null;
      void this.render();
    });
  }

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

    this.renderNovelRootFiles(body, novel.folderPath);

    root.createDiv({
      cls: "novelview-workbench-novel-stats",
      text: `${new Intl.NumberFormat("zh-CN").format(stats.wordCount)}字 · 共 ${stats.volumeCount} 卷 · ${stats.chapterCount} 章`,
    });
  }

  private renderNovelRootFiles(body: HTMLElement, folderPath: string): void {
    const files = this.app.vault.getFiles()
      .filter((file) => (
        file.extension === "md"
        && file.parent?.path === folderPath
        && file.basename.startsWith("-")
        && !this.plugin.isSpecialNovelFile(file)
      ))
      .sort((left, right) => left.basename.localeCompare(
        right.basename,
        "zh-CN",
        { numeric: true, sensitivity: "base" },
      ));
    if (files.length === 0) {
      return;
    }
    const section = body.createDiv({
      cls: "novelview-workbench-root-files",
    });
    section.createDiv({
      cls: "novelview-workbench-root-files-title",
      text: "小说组文件",
    });
    for (const file of files) {
      const row = section.createDiv({
        cls: "novelview-workbench-root-file",
      });
      const icon = row.createSpan({
        cls: "novelview-workbench-root-file-icon",
      });
      setIcon(icon, "file-text");
      row.createSpan({
        cls: "novelview-workbench-root-file-name",
        text: file.basename.replace(/^-+/u, ""),
      });
      row.addEventListener("click", (event) => {
        if ((event.target as HTMLElement | null)?.closest("button")) {
          return;
        }
        void this.app.workspace.getLeaf(false).openFile(file);
      });
      const actions = row.createDiv({
        cls: "novelview-workbench-root-file-actions",
      });
      const rename = actions.createEl("button", {
        attr: { type: "button", "aria-label": "重命名文件", title: "重命名" },
      });
      setIcon(rename, "pencil");
      rename.addEventListener("click", () => {
        this.renameRootFile(file);
      });
      const remove = actions.createEl("button", {
        attr: { type: "button", "aria-label": "删除文件", title: "删除" },
      });
      setIcon(remove, "trash-2");
      remove.addEventListener("click", () => {
        void this.deleteRootFile(file);
      });
    }
  }

  private renameRootFile(file: TFile): void {
    new SettingGroupModal(
      this.app,
      "重命名文件",
      file.basename.replace(/^-+/u, ""),
      async (value, setError) => {
        const cleanName = value.replace(/^-+/u, "");
        const safeName = this.plugin.sanitizeFileBase(
          cleanName,
          file.basename.replace(/^-+/u, ""),
        );
        const base = `-${safeName}`;
        if (!safeName || base === file.basename) {
          return true;
        }
        const targetPath = `${file.parent?.path ?? ""}/${base}.md`;
        if (this.app.vault.getAbstractFileByPath(targetPath)) {
          setError("同名文件已存在。");
          return false;
        }
        await this.app.fileManager.renameFile(file, targetPath);
        this.plugin.refreshArticleListViews();
        this.scheduleRefresh();
        return true;
      },
      "文件名",
    ).open();
  }

  private async deleteRootFile(file: TFile): Promise<void> {
    const confirmed = await confirmAction(
      this.app,
      "删除文件",
      `删除“${file.basename}”？`,
    );
    if (!confirmed) {
      return;
    }
    if (!(file instanceof TFile)) {
      new Notice("Novel View：文件不存在。");
      return;
    }
    await this.app.fileManager.trashFile(file);
    this.plugin.refreshArticleListViews();
    this.scheduleRefresh();
  }

  private renderHistory(folderPath: string): void {
    const config = this.plugin.getNovelConfig(folderPath);
    const section = this.contentEl.createDiv({ cls: "novelview-history" });
    section.createDiv({ cls: "novelview-history-title", text: "历史记录" });
    if (config.history.length === 0) {
      section.createDiv({
        cls: "novelview-history-empty",
        text: "暂无历史记录。",
      });
      return;
    }
    const buckets = new Map<number, typeof config.history>();
    for (const entry of config.history) {
      const list = buckets.get(entry.bucketStart) ?? [];
      list.push(entry);
      buckets.set(entry.bucketStart, list);
    }
    const blocks = section.createDiv({ cls: "novelview-history-blocks" });
    const ordered = [...buckets.entries()].sort(([left], [right]) => right - left);
    for (const [bucketStart, entries] of ordered) {
      const date = new Date(bucketStart);
      const block = blocks.createDiv({ cls: "novelview-history-bucket" });
      block.createDiv({
        cls: "novelview-history-date",
        text: `${date.getFullYear()}.${date.getMonth() + 1}.${date.getDate()}`,
      });
      const startHour = date.getHours();
      block.createDiv({
        cls: "novelview-history-time",
        text: `${String(startHour).padStart(2, "0")}:00 - ${String(startHour + 4).padStart(2, "0")}:00`,
      });
      const list = block.createDiv({ cls: "novelview-history-entries" });
      for (const entry of [...entries].sort((left, right) => right.updatedAt - left.updatedAt)) {
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
