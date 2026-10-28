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

    this.addAction(
      "search",
      "NovelView：高级查找/替换",
      () => {
        void this.plugin.openAdvancedSearch();
      },
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
      cls: "novelview-workbench-cover",
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
    titleRow.createDiv({
      cls: "novelview-workbench-novel-name",
      text: novel.name,
    });
    body.createDiv({
      cls: "novelview-workbench-novel-description",
      text: novel.description || "尚未填写小说简介。",
    });

    const actions = body.createDiv({
      cls: "novelview-workbench-novel-actions",
    });
    actions.createEl("button", {
      cls: "novelview-workbench-button",
      text: "编辑小说信息",
      attr: { type: "button" },
    }).addEventListener("click", () => {
      this.plugin.openNovelGroupSettings(novel.folderPath);
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
