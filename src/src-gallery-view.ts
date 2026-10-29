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
    return "素材库";
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
    this.registerDomEvent(this.contentEl, "dblclick", (event) => {
      if ((event.target as HTMLElement | null)?.closest(
        ".novelview-src-card, .novelview-src-header, button, input",
      )) {
        return;
      }
      this.chooseMaterialImage();
    });

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

    const header = this.contentEl.createDiv({
      cls: "novelview-src-header",
    });
    header.createEl("h2", {
      cls: "novelview-src-title",
      text: "素材库",
    });
    if (this.folderPath) {
      const groupInfo = this.plugin.getNovelGroupInfo(this.folderPath);
      header.createDiv({
        cls: "novelview-src-caption",
        text: groupInfo?.name ?? this.folderPath,
      });
    }

    if (!this.folderPath) {
      this.renderMessage("请从文章列表打开素材库。");
      return;
    }

    const srcPath = this.folderPath === "/"
      ? "src"
      : `${this.folderPath}/src`;
    const folder = this.app.vault.getAbstractFileByPath(srcPath);
    if (!(folder instanceof TFolder)) {
      this.renderEmpty();
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
      this.renderEmpty();
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

    const nameEl = card.createDiv({
      cls: "novelview-src-name",
      text: file.name,
      attr: { title: "双击重命名" },
    });
    nameEl.addEventListener("dblclick", (event) => {
      event.stopPropagation();
      this.startInlineRename(nameEl, file);
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

    const rename = actions.createEl("button", {
      cls: "novelview-src-button",
      text: "重命名",
      attr: { type: "button" },
    });
    rename.addEventListener("click", () => {
      this.startInlineRename(nameEl, file);
    });

    const remove = actions.createEl("button", {
      cls: "novelview-src-button is-danger",
      text: "删除",
      attr: { type: "button" },
    });
    remove.addEventListener("click", () => this.deleteFile(file));

  }

  private renderEmpty(): void {
    const empty = this.contentEl.createDiv({
      cls: "novelview-src-empty",
    });
    empty.createDiv({
      cls: "novelview-src-empty-watermark",
      text: "双击空白区域可导入图片",
    });
  }

  private chooseMaterialImage(): void {
    if (!this.folderPath) {
      new Notice("Novel View：请先打开小说组素材库。");
      return;
    }
    const input = createEl("input", {
      cls: "novelview-hidden-file-input",
      attr: { type: "file", accept: "image/*" },
    });
    input.addEventListener("change", () => {
      const file = input.files?.[0];
      if (file) {
        void this.plugin.importMaterialImage(this.folderPath, file).then(() => {
          this.render();
        });
      }
      input.remove();
    });
    document.body.appendChild(input);
    input.click();
  }

  private deleteFile(file: TFile): void {
    void this.app.fileManager.promptForDeletion(file).then((confirmed) => {
      if (confirmed) {
        void this.app.vault.delete(file).then(() => this.render());
      }
    });
  }

  private startInlineRename(
    nameEl: HTMLElement,
    file: TFile,
  ): void {
    nameEl.empty();
    const input = createEl("input", {
      cls: "novelview-src-rename-input",
      attr: {
        type: "text",
        "aria-label": "重命名素材",
      },
    });
    const dot = file.name.lastIndexOf(".");
    input.value = dot > 0 ? file.name.slice(0, dot) : file.name;
    nameEl.appendChild(input);
    let settled = false;
    const finish = (save: boolean): void => {
      if (settled) {
        return;
      }
      settled = true;
      const value = input.value.trim();
      if (!save || !value) {
        this.render();
        return;
      }
      const extension = dot > 0 ? file.name.slice(dot) : "";
      const base = value.replace(/[\\/:*?"<>|#^[\]]/gu, "-").trim();
      if (!base || base === file.basename) {
        this.render();
        return;
      }
      const parent = file.parent?.path ?? "";
      const target = parent ? `${parent}/${base}${extension}` : `${base}${extension}`;
      if (this.app.vault.getAbstractFileByPath(target)) {
        new Notice("Novel View：同名素材已存在。");
        this.render();
        return;
      }
      void this.app.fileManager.renameFile(file, target).then(() => {
        this.render();
      });
    };
    input.addEventListener("click", (event) => event.stopPropagation());
    input.addEventListener("keydown", (event) => {
      if (event.key === "Enter") {
        event.preventDefault();
        finish(true);
      } else if (event.key === "Escape") {
        event.preventDefault();
        finish(false);
      }
    });
    input.addEventListener("blur", () => finish(true));
    window.setTimeout(() => {
      input.focus();
      input.select();
    }, 0);
  }

  private renderMessage(text: string): void {
    this.contentEl.createDiv({
      cls: "novelview-src-message",
      text,
    });
  }
}
