import {
  ItemView,
  setIcon,
  type TFile,
  type WorkspaceLeaf,
} from "obsidian";
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
    return "NovelView 工作台";
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
      this.renderNovelOverview(novel);
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
  }): void {
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
