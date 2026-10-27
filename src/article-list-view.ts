import {
  ItemView,
  Notice,
  setIcon,
  type ViewStateResult,
  type WorkspaceLeaf,
} from "obsidian";
import type { NovelSettingData } from "./core/novel-setting";
import type NovelViewPlugin from "./main";

export interface ArticleListTarget {
  kind: "article" | "volume";
  path: string;
  title: string;
  level: "chapter" | "volume";
  virtual?: boolean;
}

export const ARTICLE_LIST_VIEW_TYPE = "novelview-article-list";

export interface ArticleEntry {
  path: string;
  basename: string;
}

export interface VolumeEntry {
  path: string;
  name: string;
  articles: ArticleEntry[];
}

export interface ArticleListModel {
  novel: NovelSettingData;
  folderPath: string;
  volumes: VolumeEntry[];
  articles: ArticleEntry[];
}

interface DragPayload {
  kind: "article" | "volume";
  path: string;
}

const ARTICLE_MIME = "application/x-novelview-article";
const VOLUME_MIME = "application/x-novelview-volume";

export class NovelArticleListView extends ItemView {
  private readonly plugin: NovelViewPlugin;
  private folderPath = "";
  private refreshFrame: number | null = null;
  private readonly expandedVolumes = new Set<string>();
  private scatteredExpanded = true;
  private dragPayload: DragPayload | null = null;
  private focusedFolderPath = "";
  private focusedKey: string | null = null;
  private focusedTarget: ArticleListTarget | null = null;
  private inlineRenameActive = false;

  constructor(leaf: WorkspaceLeaf, plugin: NovelViewPlugin) {
    super(leaf);
    this.plugin = plugin;
    this.navigation = false;
  }

  override getViewType(): string {
    return ARTICLE_LIST_VIEW_TYPE;
  }

  override getDisplayText(): string {
    return "小说文章";
  }

  override getIcon(): string {
    return "list";
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
    if (this.folderPath) {
      this.plugin.setWorkbenchGroup(this.folderPath);
      this.focusedFolderPath = this.folderPath;
    }
    this.scheduleRefresh();
  }

  protected override async onOpen(): Promise<void> {
    this.contentEl.empty();
    this.contentEl.addClass("novelview-article-list-view");

    this.registerEvent(this.app.vault.on("create", () => this.scheduleRefresh()));
    this.registerEvent(this.app.vault.on("delete", () => this.scheduleRefresh()));
    this.registerEvent(this.app.vault.on("rename", () => this.scheduleRefresh()));
    this.registerEvent(this.app.vault.on("modify", () => this.scheduleRefresh()));
    this.registerEvent(this.app.metadataCache.on("changed", () => this.scheduleRefresh()));
    this.registerEvent(this.app.metadataCache.on("resolved", () => this.scheduleRefresh()));
    this.addAction("refresh-cw", "刷新文章列表", () => this.render());

    if (!this.folderPath) {
      this.folderPath = this.plugin.getWorkbenchFolderPath() ?? "";
    }
    if (this.folderPath) {
      this.plugin.setWorkbenchGroup(this.folderPath);
      this.focusedFolderPath = this.folderPath;
    }

    this.contentEl.addEventListener("keydown", (event) => {
      if (event.key === "F2" && this.focusedTarget && !this.inlineRenameActive) {
        event.preventDefault();
        this.startInlineRename(this.focusedTarget);
      }
    });
    this.render();
  }

  protected override async onClose(): Promise<void> {
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
      this.render();
    });
  }

  private render(): void {
    this.contentEl.empty();

    if (!this.folderPath) {
      this.renderMessage("未指定小说组。");
      return;
    }

    const model = this.plugin.getArticleListModel(this.folderPath);
    if (!model) {
      this.renderMessage("未找到小说组配置 NovelSetting。");
      return;
    }

    this.renderToolbar(model);
    this.renderHeader(model);
    this.renderList(model);
  }

  private renderToolbar(model: ArticleListModel): void {
    const toolbar = this.contentEl.createDiv({
      cls: "novelview-article-toolbar",
    });

    this.createToolbarButton(
      toolbar,
      "layout-dashboard",
      "NovelView 工作台",
      () => {
        void this.plugin.openWorkbenchForGroup(model.folderPath);
      },
    );

    this.createToolbarButton(
      toolbar,
      "image",
      "链接：查看 src 素材",
      () => {
        void this.plugin.openNovelSrcGallery(model.folderPath);
      },
    );

    this.createToolbarButton(
      toolbar,
      "arrow-left",
      "回到文件列表",
      () => {
        void this.plugin.restoreFileExplorer(this.leaf);
      },
    );

    this.createToolbarButton(
      toolbar,
      "download",
      "导出合并稿",
      () => {
        void this.plugin.exportNovelGroup(model.folderPath);
      },
    );
  }

  private createToolbarButton(
    parent: HTMLElement,
    icon: string,
    label: string,
    onClick: () => void,
  ): void {
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
  }

  private renderHeader(model: ArticleListModel): void {
    const header = this.contentEl.createDiv({
      cls: "novelview-article-header",
    });
    const titleBlock = header.createDiv({
      cls: "novelview-article-title-block",
    });
    titleBlock.createDiv({
      cls: "novelview-article-kicker",
      text: "小说文章",
    });
    titleBlock.createDiv({
      cls: "novelview-article-title",
      text: model.novel.name,
    });

    const breadcrumb = this.contentEl.createDiv({
      cls: "novelview-article-breadcrumb",
    });
    breadcrumb.createSpan({ text: model.novel.name });
    const count = model.articles.length
      + model.volumes.reduce((sum, volume) => sum + volume.articles.length, 0);
    breadcrumb.createSpan({
      cls: "novelview-article-total",
      text: `${count} 篇正文`,
    });
  }

  private renderList(model: ArticleListModel): void {
    const list = this.contentEl.createDiv({
      cls: "novelview-article-list",
    });
    list.addEventListener("contextmenu", (event) => {
      event.preventDefault();
      const target = event.target as HTMLElement | null;
      const articlePath = target?.closest<HTMLElement>("[data-article-path]")
        ?.dataset.articlePath;
      const scattered = target?.closest<HTMLElement>("[data-scattered]");
      if (scattered && !articlePath) {
        event.preventDefault();
        return;
      }

      const volumePath = target?.closest<HTMLElement>("[data-volume-path]")
        ?.dataset.volumePath;
      const articleFolder = target?.closest<HTMLElement>("[data-article-folder]")
        ?.dataset.articleFolder;
      const volumeName = target?.closest<HTMLElement>("[data-volume-path]")
        ?.dataset.volumeName;
      const articleName = target?.closest<HTMLElement>("[data-article-path]")
        ?.dataset.articleName;
      const contextPath = volumePath
        ?? articleFolder
        ?? this.focusedFolderPath
        ?? model.folderPath;
      const contentTarget: ArticleListTarget | undefined = articlePath
        ? {
          kind: "article",
          path: articlePath,
          title: articleName ?? "无标题",
          level: "chapter",
        }
        : volumePath
          ? {
            kind: "volume",
            path: volumePath,
            title: volumeName ?? "未命名卷",
            level: "volume",
          }
          : undefined;
      this.plugin.showArticleListContextMenu(
        event,
        model.folderPath,
        contextPath,
        () => this.scheduleRefresh(),
        contentTarget,
        contentTarget
          ? () => this.startInlineRename(contentTarget)
          : undefined,
      );
    });

    list.addEventListener("click", (event) => {
      const target = event.target as HTMLElement | null;
      if (
        target?.closest(
          "[data-article-path], [data-volume-path], [data-scattered], input",
        )
      ) {
        return;
      }
      this.focusedFolderPath = model.folderPath;
      this.focusedKey = null;
      this.focusedTarget = null;
      this.scheduleRefresh();
    });
    list.addEventListener("dragover", (event) => {
      if (this.dragPayload?.kind !== "article") {
        return;
      }
      event.preventDefault();
      if (event.dataTransfer) {
        event.dataTransfer.dropEffect = "move";
      }
    });
    list.addEventListener("drop", (event) => {
      if (this.dragPayload?.kind !== "article") {
        return;
      }
      event.preventDefault();
      void this.plugin.moveArticleToFolder(
        this.dragPayload.path,
        model.folderPath,
      ).then((moved) => {
        this.dragPayload = null;
        if (moved) {
          this.scheduleRefresh();
        }
      });
    });

    if (model.articles.length > 0) {
      this.renderScatteredVolume(list, model);
    }

    for (const volume of model.volumes) {
      this.renderVolumeRow(list, model, volume);
    }

    if (model.volumes.length === 0 && model.articles.length === 0) {
      this.renderMessage("暂无正文。右键可新建文章或卷。");
    }
  }

  private renderScatteredVolume(
    parent: HTMLElement,
    model: ArticleListModel,
  ): void {
    const group = parent.createDiv({ cls: "novelview-article-volume-group" });
    const row = group.createDiv({
      cls: "novelview-article-row novelview-article-volume is-scattered",
      attr: {
        "data-scattered": "true",
        "aria-expanded": String(this.scatteredExpanded),
      },
    });
    const icon = row.createSpan({ cls: "novelview-article-row-icon" });
    icon.setAttr("aria-hidden", "true");
    setIcon(icon, this.scatteredExpanded ? "chevron-down" : "chevron-right");
    row.createSpan({
      cls: "novelview-article-row-name",
      text: "分散卷",
    });
    row.createSpan({
      cls: "novelview-article-row-count",
      text: String(model.articles.length),
    });
    row.toggleClass("is-focused", this.focusedKey === "scattered");

    row.addEventListener("click", () => {
      this.scatteredExpanded = !this.scatteredExpanded;
      this.focusedFolderPath = model.folderPath;
      this.focusedKey = "scattered";
      this.focusedTarget = null;
      this.scheduleRefresh();
    });
    row.addEventListener("dragover", (event) => {
      if (this.dragPayload?.kind !== "article") {
        return;
      }
      event.preventDefault();
      event.stopPropagation();
      row.addClass("is-drop-target");
    });
    row.addEventListener("dragleave", () => {
      row.removeClass("is-drop-target");
    });
    row.addEventListener("drop", (event) => {
      event.preventDefault();
      event.stopPropagation();
      row.removeClass("is-drop-target");
      const payload = this.dragPayload;
      this.dragPayload = null;
      if (payload?.kind !== "article") {
        return;
      }
      void this.plugin.moveArticleToFolder(
        payload.path,
        model.folderPath,
      ).then((moved) => {
        if (moved) {
          this.scatteredExpanded = true;
        }
        this.scheduleRefresh();
      });
    });

    if (this.scatteredExpanded) {
      const children = group.createDiv({
        cls: "novelview-article-volume-children",
      });
      for (const article of model.articles) {
        this.renderArticleRow(children, article, model.folderPath);
      }
    }
  }

  private renderVolumeRow(
    parent: HTMLElement,
    model: ArticleListModel,
    volume: VolumeEntry,
  ): void {
    const group = parent.createDiv({ cls: "novelview-article-volume-group" });
    const expanded = this.expandedVolumes.has(volume.path);
    const row = group.createDiv({
      cls: "novelview-article-row novelview-article-volume",
      attr: {
        "data-volume-path": volume.path,
        "data-volume-name": volume.name,
        "aria-expanded": String(expanded),
        title: volume.path,
      },
    });
    row.setAttr("draggable", "true");
    const icon = row.createSpan({ cls: "novelview-article-row-icon" });
    icon.setAttr("aria-hidden", "true");
    setIcon(icon, expanded ? "chevron-down" : "chevron-right");
    row.createSpan({
      cls: "novelview-article-row-name",
      text: volume.name,
    });
    row.createSpan({
      cls: "novelview-article-row-count",
      text: String(volume.articles.length),
    });

    row.toggleClass("is-focused", this.focusedKey === `volume:${volume.path}`);
    row.addEventListener("click", () => {
      if (expanded) {
        this.expandedVolumes.delete(volume.path);
      } else {
        this.expandedVolumes.add(volume.path);
      }
      this.focusedFolderPath = volume.path;
      this.focusedKey = `volume:${volume.path}`;
      this.focusedTarget = {
        kind: "volume",
        path: volume.path,
        title: volume.name,
        level: "volume",
      };
      this.scheduleRefresh();
    });

    row.addEventListener("dragstart", (event) => {
      this.dragPayload = { kind: "volume", path: volume.path };
      event.dataTransfer?.setData(VOLUME_MIME, volume.path);
      if (event.dataTransfer) {
        event.dataTransfer.effectAllowed = "move";
      }
      row.addClass("is-dragging");
    });
    row.addEventListener("dragend", () => {
      this.dragPayload = null;
      row.removeClass("is-dragging");
    });

    row.addEventListener("dragover", (event) => {
      if (!this.dragPayload) {
        return;
      }
      event.preventDefault();
      event.stopPropagation();
      if (event.dataTransfer) {
        event.dataTransfer.dropEffect = "move";
      }
      row.addClass("is-drop-target");
    });
    row.addEventListener("dragleave", () => {
      row.removeClass("is-drop-target");
    });
    row.addEventListener("drop", (event) => {
      event.preventDefault();
      event.stopPropagation();
      row.removeClass("is-drop-target");
      const payload = this.dragPayload;
      this.dragPayload = null;
      if (!payload) {
        return;
      }

      if (payload.kind === "article") {
        void this.plugin.moveArticleToFolder(payload.path, volume.path)
          .then((moved) => {
            if (moved) {
              this.expandedVolumes.add(volume.path);
            }
            this.scheduleRefresh();
          });
        return;
      }

      if (payload.kind === "volume" && payload.path !== volume.path) {
        this.plugin.reorderVolume(model.folderPath, payload.path, volume.path);
        this.scheduleRefresh();
      }
    });

    if (expanded) {
      const children = group.createDiv({
        cls: "novelview-article-volume-children",
      });
      if (volume.articles.length === 0) {
        children.createDiv({
          cls: "novelview-article-volume-empty",
          text: "卷内暂无文章，可将文章拖到这里。",
        });
      } else {
        for (const article of volume.articles) {
          this.renderArticleRow(children, article, volume.path);
        }
      }
    }
  }

  private renderArticleRow(
    parent: HTMLElement,
    article: ArticleEntry,
    folderPath: string,
  ): void {
    const row = parent.createDiv({
      cls: "novelview-article-row novelview-article-file",
      attr: {
        "data-article-path": article.path,
        "data-article-name": article.basename,
        "data-article-folder": folderPath,
        title: article.path,
      },
    });
    row.setAttr("draggable", "true");
    const icon = row.createSpan({ cls: "novelview-article-row-icon" });
    icon.setAttr("aria-hidden", "true");
    setIcon(icon, "file-text");
    row.createSpan({
      cls: "novelview-article-row-name",
      text: article.basename,
    });

    row.toggleClass("is-focused", this.focusedKey === `article:${article.path}`);
    row.addEventListener("click", () => {
      this.focusedFolderPath = folderPath;
      this.focusedKey = `article:${article.path}`;
      this.focusedTarget = {
        kind: "article",
        path: article.path,
        title: article.basename,
        level: "chapter",
      };
      this.plugin.openArticleFromList(article.path, folderPath);
      this.scheduleRefresh();
    });
    row.addEventListener("dragstart", (event) => {
      this.dragPayload = { kind: "article", path: article.path };
      event.dataTransfer?.setData(ARTICLE_MIME, article.path);
      if (event.dataTransfer) {
        event.dataTransfer.effectAllowed = "move";
      }
      row.addClass("is-dragging");
    });
    row.addEventListener("dragend", () => {
      this.dragPayload = null;
      row.removeClass("is-dragging");
    });
  }

  private startInlineRename(target: ArticleListTarget): void {
    if (this.inlineRenameActive) {
      return;
    }
    const row = target.kind === "article"
      ? this.contentEl.querySelector<HTMLElement>(
        `[data-article-path="${CSS.escape(target.path)}"]`,
      )
      : this.contentEl.querySelector<HTMLElement>(
        `[data-volume-path="${CSS.escape(target.path)}"]`,
      );
    const nameEl = row?.querySelector<HTMLElement>(".novelview-article-row-name");
    if (!row || !nameEl) {
      return;
    }

    this.inlineRenameActive = true;
    const original = nameEl.textContent ?? target.title;
    const input = document.createElement("input");
    input.className = "novelview-inline-rename";
    input.value = original;
    input.setAttribute("aria-label", "重命名");
    nameEl.replaceWith(input);
    input.focus();
    input.select();

    let settled = false;
    const finish = (commit: boolean): void => {
      if (settled) {
        return;
      }
      settled = true;
      this.inlineRenameActive = false;
      const value = input.value.trim();
      if (!commit || !value || value === original) {
        this.scheduleRefresh();
        return;
      }

      const request = target.kind === "article"
        ? this.plugin.renameArticlePath(target.path, value)
        : this.plugin.renameVolumePath(target.path, value);
      void request.then((error) => {
        if (error) {
          new Notice(`NovelView：${error}`);
          this.inlineRenameActive = false;
          this.scheduleRefresh();
          return;
        }
        this.focusedKey = null;
        this.focusedTarget = null;
        this.scheduleRefresh();
      });
    };

    input.addEventListener("keydown", (event) => {
      event.stopPropagation();
      if (event.key === "Enter") {
        event.preventDefault();
        finish(true);
      } else if (event.key === "Escape") {
        event.preventDefault();
        finish(false);
      }
    });
    input.addEventListener("blur", () => finish(true));
    input.addEventListener("click", (event) => event.stopPropagation());
    input.addEventListener("dblclick", (event) => event.stopPropagation());
  }

  private renderMessage(text: string): void {
    this.contentEl.createDiv({
      cls: "novelview-article-message",
      text,
    });
  }
}
