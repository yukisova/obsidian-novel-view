import {
  ItemView,
  Notice,
  setIcon,
  type ViewStateResult,
  type WorkspaceLeaf,
} from "obsidian";
import { CHAPTER_STATUS_LABELS } from "./core/chapter-status";
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
  private readonly selectedKeys = new Set<string>();
  private selectionAnchorKey: string | null = null;
  private suppressBlankClick = false;
  private readonly selectionTargets = new Map<string, ArticleListTarget>();
  private marquee: {
    pointerId: number;
    startX: number;
    startY: number;
    box: HTMLElement;
    additive: boolean;
    moved: boolean;
  } | null = null;

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
    this.selectedKeys.clear();
    this.selectionAnchorKey = null;
    this.selectionTargets.clear();
    this.scheduleRefresh();
  }

  protected override async onOpen(): Promise<void> {
    this.contentEl.empty();
    this.contentEl.addClass("novelview-article-list-view");
    this.addAction("arrow-left", "返回", () => {
      void this.plugin.restoreFileExplorer(this.leaf);
    });

    this.registerEvent(this.app.vault.on("create", () => this.scheduleRefresh()));
    this.registerEvent(this.app.vault.on("delete", () => this.scheduleRefresh()));
    this.registerEvent(this.app.vault.on("rename", () => this.scheduleRefresh()));
    this.registerEvent(this.app.vault.on("modify", () => this.scheduleRefresh()));
    this.registerEvent(this.app.metadataCache.on("changed", () => this.scheduleRefresh()));
    this.registerEvent(this.app.metadataCache.on("resolved", () => this.scheduleRefresh()));

    if (!this.folderPath) {
      this.folderPath = this.plugin.getWorkbenchFolderPath() ?? "";
    }
    this.selectedKeys.clear();
    this.selectionAnchorKey = null;
    this.selectionTargets.clear();
    if (this.folderPath) {
      this.plugin.setWorkbenchGroup(this.folderPath);
      this.focusedFolderPath = this.folderPath;
    }

    this.contentEl.addEventListener("keydown", (event) => {
      if (
        event.key === "F2"
        && this.focusedTarget
        && !this.inlineRenameActive
        && this.selectedKeys.size <= 1
      ) {
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

    const back = this.createToolbarButton(
      toolbar,
      "arrow-left",
      "返回",
      () => {
        void this.plugin.restoreFileExplorer(this.leaf);
      },
    );
    back.addClass("novelview-article-toolbar-back");
    back.createSpan({
      cls: "novelview-article-toolbar-back-label",
      text: "返回",
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
      "link",
      "联动库",
      () => {
        void this.plugin.openLinkLibrary(model.folderPath);
      },
    );

    this.createToolbarButton(
      toolbar,
      "image",
      "素材库",
      () => {
        void this.plugin.openNovelSrcGallery(model.folderPath);
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

  private renderHeader(model: ArticleListModel): void {
    const header = this.contentEl.createDiv({
      cls: "novelview-article-header",
    });
    const titleBlock = header.createDiv({
      cls: "novelview-article-title-block",
    });
    titleBlock.createDiv({
      cls: "novelview-article-title",
      text: model.novel.name,
    });
    const count = model.articles.length
      + model.volumes.reduce((sum, volume) => sum + volume.articles.length, 0);
    titleBlock.createDiv({
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
      const scattered = target?.closest<HTMLElement>("[data-scattered]");
      const row = target?.closest<HTMLElement>("[data-select-key]");
      if (scattered && !row) {
        return;
      }

      if (!row) {
        this.selectedKeys.clear();
        this.selectionAnchorKey = null;
        this.updateSelectionClasses();
        this.plugin.showArticleListContextMenu(
          event,
          model.folderPath,
          this.focusedFolderPath || model.folderPath,
          () => this.scheduleRefresh(),
        );
        return;
      }

      const key = row.dataset.selectKey;
      if (!key) {
        return;
      }
      if (!this.selectedKeys.has(key)) {
        this.selectedKeys.clear();
        this.selectedKeys.add(key);
        this.selectionAnchorKey = key;
        this.updateSelectionClasses();
      }

      const targets = this.collectSelectedTargets();
      if (targets.length === 0) {
        return;
      }
      this.plugin.showArticleListContextMenu(
        event,
        model.folderPath,
        this.focusedFolderPath || model.folderPath,
        () => this.scheduleRefresh(),
        targets,
        targets.length === 1
          ? () => this.startInlineRename(targets[0])
          : undefined,
      );
    });

    list.addEventListener("pointerdown", (event) => {
      if (event.button !== 0) {
        return;
      }
      const target = event.target as HTMLElement | null;
      if (target?.closest("[data-select-key], input, button, [data-scattered]")) {
        return;
      }
      this.startMarquee(event, list);
    });

    list.addEventListener("click", (event) => {
      if (this.suppressBlankClick) {
        this.suppressBlankClick = false;
        return;
      }
      const target = event.target as HTMLElement | null;
      if (target?.closest("[data-select-key], input, [data-scattered]")) {
        return;
      }
      this.selectedKeys.clear();
      this.selectionAnchorKey = null;
      this.updateSelectionClasses();
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
      ).then((moved: boolean) => {
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

    this.pruneSelection();

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
      this.selectedKeys.clear();
      this.selectionAnchorKey = null;
      this.updateSelectionClasses();
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
      ).then((moved: boolean) => {
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
        "data-select-key": `volume:${volume.path}`,
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

    const volumeKey = `volume:${volume.path}`;
    const volumeTarget: ArticleListTarget = {
      kind: "volume",
      path: volume.path,
      title: volume.name,
      level: "volume",
    };
    this.selectionTargets.set(volumeKey, volumeTarget);
    row.toggleClass("is-focused", this.focusedKey === volumeKey);
    row.toggleClass("is-selected", this.selectedKeys.has(volumeKey));
    row.addEventListener("click", (event) => {
      if (this.handleSelectionClick(event, volumeKey, volumeTarget)) {
        return;
      }
      if (expanded) {
        this.expandedVolumes.delete(volume.path);
      } else {
        this.expandedVolumes.add(volume.path);
      }
      this.focusedFolderPath = volume.path;
      this.focusedKey = volumeKey;
      this.focusedTarget = volumeTarget;
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
          .then((moved: boolean) => {
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
        "data-select-key": `article:${article.path}`,
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
    const meta = row.createSpan({
      cls: "novelview-article-row-meta",
    });
    void this.plugin.getChapterMeta(article.path).then((chapter) => {
      if (!meta.isConnected) {
        return;
      }
      meta.empty();
      meta.createSpan({
        cls: "novelview-article-row-words",
        text: `${new Intl.NumberFormat("zh-CN").format(chapter.wordCount)} 字`,
      });
      meta.createSpan({
        cls: "novelview-article-row-state",
        text: CHAPTER_STATUS_LABELS[chapter.status],
      });
    });

    const articleKey = `article:${article.path}`;
    const articleTarget: ArticleListTarget = {
      kind: "article",
      path: article.path,
      title: article.basename,
      level: "chapter",
    };
    this.selectionTargets.set(articleKey, articleTarget);
    row.toggleClass("is-focused", this.focusedKey === articleKey);
    row.toggleClass("is-selected", this.selectedKeys.has(articleKey));
    row.addEventListener("click", (event) => {
      if (this.handleSelectionClick(event, articleKey, articleTarget)) {
        return;
      }
      this.focusedFolderPath = folderPath;
      this.focusedKey = articleKey;
      this.focusedTarget = articleTarget;
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
    const input = createEl("input", {
      cls: "novelview-inline-rename",
      attr: { "aria-label": "重命名" },
    });
    input.value = original;
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
      void request.then((error: string | null) => {
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

  private handleSelectionClick(
    event: MouseEvent,
    key: string,
    target: ArticleListTarget,
  ): boolean {
    if (event.shiftKey) {
      event.preventDefault();
      event.stopPropagation();
      this.selectRange(key);
      return true;
    }
    if (event.metaKey || event.ctrlKey) {
      event.preventDefault();
      event.stopPropagation();
      if (this.selectedKeys.has(key)) {
        this.selectedKeys.delete(key);
      } else {
        this.selectedKeys.add(key);
      }
      this.selectionAnchorKey = key;
      this.updateSelectionClasses();
      return true;
    }

    this.selectedKeys.clear();
    this.selectedKeys.add(key);
    this.selectionAnchorKey = key;
    this.updateSelectionClasses();
    this.focusedTarget = target;
    return false;
  }

  private selectRange(key: string): void {
    const keys = this.visibleSelectionKeys();
    if (keys.length === 0) {
      return;
    }
    const anchorIndex = this.selectionAnchorKey
      ? keys.indexOf(this.selectionAnchorKey)
      : -1;
    const targetIndex = keys.indexOf(key);
    if (anchorIndex === -1 || targetIndex === -1) {
      this.selectedKeys.clear();
      this.selectedKeys.add(key);
      this.selectionAnchorKey = key;
      this.updateSelectionClasses();
      return;
    }
    const from = Math.min(anchorIndex, targetIndex);
    const to = Math.max(anchorIndex, targetIndex);
    this.selectedKeys.clear();
    for (let index = from; index <= to; index += 1) {
      this.selectedKeys.add(keys[index]);
    }
    this.updateSelectionClasses();
  }

  private visibleSelectionKeys(): string[] {
    return [...this.contentEl.querySelectorAll<HTMLElement>("[data-select-key]")]
      .map((row) => row.dataset.selectKey)
      .filter((key): key is string => !!key);
  }

  private updateSelectionClasses(): void {
    for (const row of this.contentEl.querySelectorAll<HTMLElement>("[data-select-key]")) {
      const key = row.dataset.selectKey;
      row.toggleClass("is-selected", !!key && this.selectedKeys.has(key));
    }
  }

  private collectSelectedTargets(): ArticleListTarget[] {
    const targets: ArticleListTarget[] = [];
    for (const key of this.selectedKeys) {
      const target = this.selectionTargets.get(key);
      if (target) {
        targets.push(target);
      }
    }
    return targets;
  }

  private pruneSelection(): void {
    const visible = new Set(this.visibleSelectionKeys());
    for (const key of [...this.selectedKeys]) {
      if (!visible.has(key) || !this.selectionTargets.has(key)) {
        this.selectedKeys.delete(key);
      }
    }
    if (
      this.selectionAnchorKey
      && !this.selectedKeys.has(this.selectionAnchorKey)
    ) {
      this.selectionAnchorKey = null;
    }
  }

  private startMarquee(event: PointerEvent, list: HTMLElement): void {
    if (this.marquee) {
      return;
    }
    const box = createEl("div", { cls: "novelview-selection-box" });
    document.body.appendChild(box);
    const additive = event.metaKey || event.ctrlKey;
    if (!additive) {
      this.selectedKeys.clear();
      this.updateSelectionClasses();
    }
    this.marquee = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      box,
      additive,
      moved: false,
    };
    list.setPointerCapture(event.pointerId);
    event.preventDefault();

    const move = (moveEvent: PointerEvent): void => {
      const state = this.marquee;
      if (!state || state.pointerId !== moveEvent.pointerId) {
        return;
      }
      const left = Math.min(state.startX, moveEvent.clientX);
      const top = Math.min(state.startY, moveEvent.clientY);
      const width = Math.abs(moveEvent.clientX - state.startX);
      const height = Math.abs(moveEvent.clientY - state.startY);
      if (width > 3 || height > 3) {
        state.moved = true;
      }
      state.box.style.left = `${left}px`;
      state.box.style.top = `${top}px`;
      state.box.style.width = `${width}px`;
      state.box.style.height = `${height}px`;
      state.box.toggleClass("is-visible", state.moved);
      const selectionRect = {
        left,
        top,
        right: left + width,
        bottom: top + height,
      };
      for (const row of this.contentEl.querySelectorAll<HTMLElement>("[data-select-key]")) {
        const rect = row.getBoundingClientRect();
        const intersects = rect.left < selectionRect.right
          && rect.right > selectionRect.left
          && rect.top < selectionRect.bottom
          && rect.bottom > selectionRect.top;
        if (intersects) {
          const key = row.dataset.selectKey;
          if (key) {
            this.selectedKeys.add(key);
          }
        }
      }
      this.updateSelectionClasses();
    };

    const up = (upEvent: PointerEvent): void => {
      if (!this.marquee || this.marquee.pointerId !== upEvent.pointerId) {
        return;
      }
      const state = this.marquee;
      this.marquee = null;
      state.box.remove();
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", up);
      if (list.hasPointerCapture(upEvent.pointerId)) {
        list.releasePointerCapture(upEvent.pointerId);
      }
      if (state.moved) {
        this.selectionAnchorKey = null;
        this.suppressBlankClick = true;
        window.setTimeout(() => {
          this.updateSelectionClasses();
          this.suppressBlankClick = false;
        }, 50);
      }
    };

    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", up);
  }

  private renderMessage(text: string): void {
    this.contentEl.createDiv({
      cls: "novelview-article-message",
      text,
    });
  }
}
