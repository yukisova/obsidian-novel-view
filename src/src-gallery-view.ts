import {
  ItemView,
  Notice,
  setIcon,
  TFile,
  TFolder,
  type ViewStateResult,
  type WorkspaceLeaf,
} from "obsidian";
import type NovelViewPlugin from "./main";

export const SRC_GALLERY_VIEW_TYPE = "novelview-src-gallery";

const IMAGE_EXTENSIONS = new Set([
  "png",
  "jpg",
  "jpeg",
  "gif",
  "webp",
  "svg",
  "bmp",
  "avif",
]);

export class NovelSrcGalleryView extends ItemView {
  private readonly plugin: NovelViewPlugin;
  private folderPath = "";

  constructor(leaf: WorkspaceLeaf, plugin: NovelViewPlugin) {
    super(leaf);
    this.plugin = plugin;
    this.navigation = false;
  }

  override getViewType(): string {
    return SRC_GALLERY_VIEW_TYPE;
  }

  override getDisplayText(): string {
    return "小说链接";
  }

  override getIcon(): string {
    return "image";
  }

  override getState(): Record<string, unknown> {
    return { folderPath: this.folderPath };
  }

  override async setState(
    state: Record<string, unknown>,
    result: ViewStateResult,
  ): Promise<void> {
    this.folderPath = typeof state.folderPath === "string"
      ? state.folderPath
      : this.folderPath;
    result.history = true;
    await super.setState(state, result);
    this.render();
  }

  protected override async onOpen(): Promise<void> {
    this.contentEl.empty();
    this.contentEl.addClass("novelview-src-gallery-view");
    this.registerEvent(this.app.vault.on("create", () => this.render()));
    this.registerEvent(this.app.vault.on("delete", () => this.render()));
    this.registerEvent(this.app.vault.on("rename", () => this.render()));
    this.addAction("refresh-cw", "刷新 src 素材", () => this.render());

    if (!this.folderPath) {
      this.folderPath = this.plugin.getWorkbenchFolderPath() ?? "";
    }
    this.render();
  }

  protected override async onClose(): Promise<void> {
    this.contentEl.empty();
  }

  private render(): void {
    this.contentEl.empty();

    const novel = this.folderPath
      ? this.plugin.getNovelGroupInfo(this.folderPath)
      : null;
    const header = this.contentEl.createDiv({
      cls: "novelview-src-header",
    });
    header.createDiv({
      cls: "novelview-src-kicker",
      text: "小说链接",
    });
    header.createDiv({
      cls: "novelview-src-title",
      text: novel?.name ?? "src 素材",
    });
    const srcPath = this.folderPath === "/"
      ? "src"
      : `${this.folderPath}/src`;
    header.createDiv({
      cls: "novelview-src-path",
      text: this.folderPath ? srcPath : "尚未选择小说组",
    });

    if (!this.folderPath) {
      this.renderMessage("请从文章列表进入。");
      return;
    }

    const folder = this.app.vault.getAbstractFileByPath(srcPath);
    if (!(folder instanceof TFolder)) {
      this.renderMessage("src 文件夹尚不存在。在小说模式中使用“加入图片”后，图片会统一放在这里。");
      return;
    }

    const files = [...folder.children]
      .filter((file): file is TFile => file instanceof TFile)
      .sort((left, right) => left.name.localeCompare(
        right.name,
        "zh-CN",
        { numeric: true, sensitivity: "base" },
      ));

    if (files.length === 0) {
      this.renderMessage("src 文件夹为空。");
      return;
    }

    const grid = this.contentEl.createDiv({
      cls: "novelview-src-grid",
    });
    for (const file of files) {
      this.renderFileCard(grid, file);
    }
  }

  private renderFileCard(parent: HTMLElement, file: TFile): void {
    const card = parent.createDiv({
      cls: "novelview-src-card",
    });
    const extension = file.extension.toLowerCase();
    const isImage = IMAGE_EXTENSIONS.has(extension);

    const preview = card.createDiv({
      cls: "novelview-src-preview",
    });
    if (isImage) {
      preview.createEl("img", {
        cls: "novelview-src-image",
        attr: {
          src: this.app.vault.getResourcePath(file),
          alt: file.basename,
        },
      });
    } else {
      const icon = preview.createSpan({
        cls: "novelview-src-file-icon",
      });
      setIcon(icon, "file");
    }

    card.createDiv({
      cls: "novelview-src-name",
      text: file.name,
    });

    const actions = card.createDiv({
      cls: "novelview-src-actions",
    });
    const open = actions.createEl("button", {
      cls: "novelview-src-button",
      text: "打开",
      attr: { type: "button" },
    });
    open.addEventListener("click", () => {
      void this.app.workspace.openLinkText(
        file.path,
        this.folderPath,
        true,
        { active: true },
      );
    });

    if (isImage) {
      const copy = actions.createEl("button", {
        cls: "novelview-src-button",
        text: "复制链接",
        attr: { type: "button" },
      });
      copy.addEventListener("click", () => {
        void navigator.clipboard.writeText(`![[${file.path}]]`).then(() => {
          new Notice("NovelView：已复制图片嵌入链接。");
        }).catch(() => {
          new Notice("NovelView：复制失败。");
        });
      });
    }
  }

  private renderMessage(text: string): void {
    this.contentEl.createDiv({
      cls: "novelview-src-message",
      text,
    });
  }
}
