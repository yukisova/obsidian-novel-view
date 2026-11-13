import {
  ItemView,
  Menu,
  Notice,
  TFolder,
  setIcon,
  type WorkspaceLeaf,
} from "obsidian";
import {
  type SettingCollectionIndex,
  type SettingCollectionTag,
} from "./core/setting-collection";
import {
  SettingConfirmModal,
  SettingGraphModal,
  SettingGroupModal,
  SettingTagModal,
} from "./setting-collection-modal";
import { SettingRecordDetailPanel } from "./setting-record-detail-panel";
import { SettingRecordEditorPanel } from "./setting-record-editor-panel";
import type NovelViewPlugin from "./main";

export const SETTING_COLLECTION_VIEW_TYPE = "novelview-setting-collection";

const SETTING_DRAG_MIME = "application/x-novelview-setting-drag";

type SettingDragPayload =
  | { kind: "group"; group: string }
  | { kind: "tag"; group: string; tag: string }
  | { kind: "record"; group: string; tag: string; keyword: string };

interface SettingDropTarget {
  element: HTMLElement;
  mode: "before" | "after" | "inside";
  group: string;
  tag?: string;
  keyword?: string;
}

export class SettingCollectionView extends ItemView {
  private readonly plugin: NovelViewPlugin;
  private folderPath = "";
  private refreshing = false;
  private dragPayload: SettingDragPayload | null = null;
  private dropTarget: SettingDropTarget | null = null;
  private recordDetailPanel: SettingRecordDetailPanel | null = null;
  private recordEditorPanel: SettingRecordEditorPanel | null = null;

  constructor(leaf: WorkspaceLeaf, plugin: NovelViewPlugin) {
    super(leaf);
    this.plugin = plugin;
    this.navigation = false;
  }

  override getViewType(): string {
    return SETTING_COLLECTION_VIEW_TYPE;
  }

  override getDisplayText(): string {
    const folder = this.folderPath
      ? this.plugin.getSettingCollectionFolder(this.folderPath)
      : null;
    return folder ? folder.name.replace(/^-+/u, "") || "设定集" : "设定集";
  }

  override getIcon(): string {
    return "library";
  }

  override getState(): Record<string, unknown> {
    return { folderPath: this.folderPath };
  }

  override async setState(
    state: Record<string, unknown>,
    result: import("obsidian").ViewStateResult,
  ): Promise<void> {
    this.folderPath = typeof state.folderPath === "string"
      ? state.folderPath
      : this.folderPath;
    result.history = true;
    await super.setState(state, result);
    await this.refresh();
  }

  protected override async onClose(): Promise<void> {
    await Promise.resolve();
    this.recordEditorPanel?.close();
    this.recordEditorPanel = null;
    this.recordDetailPanel?.close();
    this.recordDetailPanel = null;
    this.contentEl.empty();
  }

  protected override async onOpen(): Promise<void> {
    this.contentEl.empty();
    this.contentEl.addClass("novelview-setting-collection-view");
    this.contentEl.addEventListener("dragover", (event) => {
      this.handleDragOver(event);
    });
    this.contentEl.addEventListener("drop", (event) => {
      void this.handleDrop(event);
    });
    this.contentEl.addEventListener("dragleave", (event) => {
      if (!this.contentEl.contains(event.relatedTarget as Node | null)) {
        this.clearDropTarget();
      }
    });
    this.contentEl.addEventListener("dragend", () => {
      this.clearDragState();
    });
    await this.refresh();
  }

  async refresh(): Promise<void> {
    if (!this.contentEl.isConnected || !this.folderPath || this.refreshing) {
      return;
    }
    this.refreshing = true;
    try {
      this.contentEl.empty();
      const folder = this.plugin.getSettingCollectionFolder(this.folderPath);
      const collectionName = folder
        ? folder.name.replace(/^-+/u, "") || "设定集"
        : "设定集";
      const header = this.contentEl.createDiv({
        cls: "novelview-setting-collection-header",
      });
      header.createDiv({
        cls: "novelview-setting-collection-title",
        text: collectionName,
      });
      const novelRoot = this.plugin.findNovelGroupRoot(this.folderPath)
        ?? this.folderPath;
      const novelName = this.plugin.getNovelGroupInfo(novelRoot)?.name ?? "";
      if (novelName) {
        header.createDiv({
          cls: "novelview-setting-collection-subtitle",
          text: novelName,
        });
      }
      const toolbar = header.createDiv({
        cls: "novelview-setting-collection-toolbar",
      });
      this.addHeaderButton(toolbar, "git-fork", "关系图谱", () => {
        void this.openGraph();
      });
      this.addHeaderButton(toolbar, "refresh-cw", "刷新设定集", () => {
        void this.refresh();
      });

      if (!folder) {
        this.renderMissingCollection();
        return;
      }
      const index = await this.plugin.readSettingCollectionIndex(folder.path);
      const groups = Object.entries(index);
      const groupName = groups[0]?.[0] ?? "";
      if (groupName) {
        this.addHeaderButton(toolbar, "tag", "新建标签", () => {
          this.createTag(groupName);
        });
      }
      if (groups.length === 0) {
        this.renderMessage("暂无设定内容。可点击顶部标签按钮新建。");
        return;
      }
      const list = this.contentEl.createDiv({
        cls: "novelview-setting-collection-list",
      });
      for (const [group, tags] of groups) {
        this.renderGroup(list, group, tags);
      }
    } finally {
      this.refreshing = false;
    }
  }

  private renderRecordContent(
    row: HTMLElement,
    entry: import("./core/setting-collection").SettingCollectionEntry,
  ): void {
    row.createDiv({
      cls: "novelview-setting-collection-content",
      text: entry.content,
    });
  }

  async revealRecordDetail(
    group: string,
    tag: string,
    keyword: string,
  ): Promise<void> {
    const folder = this.plugin.getSettingCollectionFolder(this.folderPath);
    if (!folder) {
      return;
    }
    const index = await this.plugin.readSettingCollectionIndex(folder.path);
    for (const tags of Object.values(index)) {
      for (const item of tags) {
        const entry = item.contain.find((record) => record.keyword === keyword);
        if (entry) {
          this.openRecordDetail(group, tag || item.tag, entry);
          return;
        }
      }
    }
  }

  focusRecord(group: string, tag: string, keyword: string): void {
    const selector = [
      `[data-setting-group="${CSS.escape(group)}"]`,
      tag ? `[data-setting-tag="${CSS.escape(tag)}"]` : "",
      `[data-setting-keyword="${CSS.escape(keyword)}"]`,
    ].join("");
    const row = this.contentEl.querySelector<HTMLElement>(selector);
    if (!row) {
      return;
    }
    const focused = [
      row.closest<HTMLElement>(".novelview-setting-collection-group"),
      row.closest<HTMLElement>(".novelview-setting-collection-tag"),
      row,
    ].filter((element): element is HTMLElement => Boolean(element));
    for (const element of focused) {
      element.addClass("is-focused");
    }
    row.scrollIntoView({ block: "center", behavior: "smooth" });
    window.setTimeout(() => {
      for (const element of focused) {
        element.removeClass("is-focused");
      }
    }, 1600);
  }

  private startDrag(
    event: DragEvent,
    payload: SettingDragPayload,
  ): void {
    if (!event.dataTransfer) {
      return;
    }
    this.clearDragState();
    this.dragPayload = payload;
    if (payload.kind !== "group") {
      this.contentEl.addClass("is-setting-dragging");
    }
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData(SETTING_DRAG_MIME, JSON.stringify(payload));
    event.dataTransfer.setData("text/plain", JSON.stringify(payload));
    const source = (event.target as HTMLElement | null)?.closest<HTMLElement>(
      "[data-setting-drop-group], [data-setting-drop-tag], [data-setting-drop-record]",
    );
    source?.addClass("is-dragging");
  }

  private clearDragState(): void {
    this.clearDropTarget();
    this.dragPayload = null;
    this.contentEl.removeClass("is-setting-dragging");
    for (const element of this.contentEl.querySelectorAll<HTMLElement>(
      ".is-dragging",
    )) {
      element.removeClass("is-dragging");
    }
  }

  private clearDropTarget(): void {
    this.dropTarget?.element.removeClass(
      "is-drop-before",
      "is-drop-after",
      "is-drop-inside",
    );
    this.dropTarget = null;
  }

  private dropMode(element: HTMLElement, event: DragEvent): "before" | "after" {
    const rect = element.getBoundingClientRect();
    return event.clientY < rect.top + rect.height / 2 ? "before" : "after";
  }

  private resolveDropTarget(event: DragEvent): SettingDropTarget | null {
    const payload = this.dragPayload;
    const target = event.target as HTMLElement | null;
    if (!payload || !target) {
      return null;
    }
    if (payload.kind === "group") {
      const groupCard = target.closest<HTMLElement>("[data-setting-drop-group]");
      if (!groupCard) {
        return null;
      }
      return {
        element: groupCard,
        mode: this.dropMode(groupCard, event),
        group: groupCard.dataset.settingDropGroup ?? "",
      };
    }
    const record = target.closest<HTMLElement>("[data-setting-drop-record]");
    if (record) {
      const tag = record.closest<HTMLElement>("[data-setting-drop-tag]");
      const group = record.closest<HTMLElement>("[data-setting-drop-group]");
      if (!tag || !group) {
        return null;
      }
      if (payload.kind === "record") {
        return {
          element: record,
          mode: this.dropMode(record, event),
          group: group.dataset.settingDropGroup ?? "",
          tag: tag.dataset.settingDropTag ?? "",
          keyword: record.dataset.settingDropRecord ?? "",
        };
      }
      if (payload.kind === "tag") {
        return {
          element: tag,
          mode: this.dropMode(tag, event),
          group: group.dataset.settingDropGroup ?? "",
          tag: tag.dataset.settingDropTag ?? "",
        };
      }
    }
    const tag = target.closest<HTMLElement>("[data-setting-drop-tag]");
    if (tag) {
      const group = tag.closest<HTMLElement>("[data-setting-drop-group]");
      if (!group) {
        return null;
      }
      return {
        element: tag,
        mode: payload.kind === "record"
          ? "inside"
          : this.dropMode(tag, event),
        group: group.dataset.settingDropGroup ?? "",
        tag: tag.dataset.settingDropTag ?? "",
      };
    }
    const group = target.closest<HTMLElement>("[data-setting-drop-group]");
    if (!group) {
      return null;
    }
    const groupName = group.dataset.settingDropGroup ?? "";
    if (payload.kind === "tag") {
      return {
        element: group,
        mode: "inside",
        group: groupName,
      };
    }
    const firstTag = group.querySelector<HTMLElement>("[data-setting-drop-tag]");
    if (!firstTag) {
      return null;
    }
    return {
      element: firstTag,
      mode: "inside",
      group: groupName,
      tag: firstTag.dataset.settingDropTag ?? "",
    };
  }

  private handleDragOver(event: DragEvent): void {
    if (!this.dragPayload) {
      return;
    }
    const target = this.resolveDropTarget(event);
    this.clearDropTarget();
    if (!target) {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    if (event.dataTransfer) {
      event.dataTransfer.dropEffect = "move";
    }
    target.element.addClass(`is-drop-${target.mode}`);
    this.dropTarget = target;
  }

  private async handleDrop(event: DragEvent): Promise<void> {
    const payload = this.dragPayload;
    if (!payload) {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    const target = this.resolveDropTarget(event) ?? this.dropTarget;
    this.clearDragState();
    if (!target) {
      return;
    }
    await this.performSettingDrop(payload, target);
  }

  private async performSettingDrop(
    payload: SettingDragPayload,
    target: SettingDropTarget,
  ): Promise<void> {
    const data = await this.getFolder();
    if (!data) {
      return;
    }
    const index = data.index;
    if (payload.kind === "group") {
      if (payload.group === target.group) {
        return;
      }
      const entries = Object.entries(index);
      const from = entries.findIndex(([group]) => group === payload.group);
      const to = entries.findIndex(([group]) => group === target.group);
      if (from < 0 || to < 0) {
        return;
      }
      const [entry] = entries.splice(from, 1);
      const insertion = to + (target.mode === "after" ? 1 : 0)
        - (from < to ? 1 : 0);
      entries.splice(Math.max(0, insertion), 0, entry);
      await this.persistDrop(data.folderPath, Object.fromEntries(entries));
      return;
    }
    if (payload.kind === "tag") {
      if (
        payload.group === target.group
        && payload.tag === target.tag
      ) {
        return;
      }
      const sourceTags = index[payload.group];
      const targetTags = index[target.group];
      if (!sourceTags || !targetTags) {
        return;
      }
      const sourceIndex = sourceTags.findIndex((tag) => tag.tag === payload.tag);
      if (sourceIndex < 0) {
        return;
      }
      const [tag] = sourceTags.splice(sourceIndex, 1);
      if (targetTags.some((entry) => entry.tag === tag.tag)) {
        new Notice(`Novel View：目标分组已存在标签“${tag.tag}”。`);
        return;
      }
      const targetKeywords = new Set(
        targetTags.flatMap((entry) => entry.contain.map((row) => (
          row.keyword.toLocaleLowerCase()
        ))),
      );
      if (tag.contain.some((row) => targetKeywords.has(row.keyword.toLocaleLowerCase()))) {
        new Notice("Novel View：目标分组已存在同名关键词。");
        return;
      }
      let insertion = targetTags.length;
      if (target.tag && target.mode !== "inside") {
        const targetIndex = targetTags.findIndex((entry) => entry.tag === target.tag);
        if (targetIndex >= 0) {
          insertion = targetIndex + (target.mode === "after" ? 1 : 0);
        }
      }
      const movedKeywords = tag.contain.map((entry) => entry.keyword);
      targetTags.splice(insertion, 0, tag);
      await this.persistDrop(data.folderPath, index);
      if (payload.group !== target.group) {
        const novelRoot = this.plugin.findNovelGroupRoot(data.folderPath)
          ?? data.folderPath;
        for (const keyword of movedKeywords) {
          await this.plugin.moveSettingRecordDetails(
            novelRoot,
            payload.group,
            target.group,
            keyword,
          );
        }
        await this.refresh();
      }
      return;
    }
    if (payload.group === target.group
      && payload.tag === target.tag
      && payload.keyword === target.keyword) {
      return;
    }
    const sourceTags = index[payload.group];
    const targetTags = index[target.group];
    const sourceTag = sourceTags?.find((tag) => tag.tag === payload.tag);
    const targetTag = targetTags?.find((tag) => tag.tag === target.tag);
    if (!sourceTag || !targetTag) {
      return;
    }
    const sourceIndex = sourceTag.contain.findIndex((entry) => (
      entry.keyword === payload.keyword
    ));
    if (sourceIndex < 0) {
      return;
    }
    const [record] = sourceTag.contain.splice(sourceIndex, 1);
    const duplicate = targetTags?.some((tag) => tag.contain.some((entry) => (
      entry.keyword.toLocaleLowerCase() === record.keyword.toLocaleLowerCase()
    )));
    if (duplicate) {
      new Notice(`Novel View：目标分组已存在关键词“${record.keyword}”。`);
      return;
    }
    let insertion = targetTag.contain.length;
    if (target.keyword && target.keyword !== payload.keyword) {
      const targetIndex = targetTag.contain.findIndex((entry) => (
        entry.keyword === target.keyword
      ));
      if (targetIndex >= 0) {
        insertion = targetIndex + (target.mode === "after" ? 1 : 0);
      }
    }
    targetTag.contain.splice(insertion, 0, record);
    await this.persistDrop(data.folderPath, index);
    if (payload.group !== target.group) {
      const novelRoot = this.plugin.findNovelGroupRoot(data.folderPath)
        ?? data.folderPath;
      await this.plugin.moveSettingRecordDetails(
        novelRoot,
        payload.group,
        target.group,
        record.keyword,
      );
      await this.refresh();
    }
  }

  private async persistDrop(
    settingRoot: string,
    index: SettingCollectionIndex,
  ): Promise<void> {
    try {
      await this.plugin.writeSettingCollectionIndex(settingRoot, index);
      await this.refresh();
    } catch (error) {
      console.error("Novel View: setting collection drop failed", error);
      new Notice("Novel View：设定集移动失败。");
    }
  }

  private addHeaderButton(
    parent: HTMLElement,
    icon: string,
    label: string,
    action: () => void,
  ): void {
    const button = parent.createEl("button", {
      cls: "novelview-setting-collection-button",
      attr: { type: "button", "aria-label": label, title: label },
    });
    setIcon(button, icon);
    button.addEventListener("click", action);
  }

  private async openGraph(): Promise<void> {
    const folder = this.plugin.getSettingCollectionFolder(this.folderPath);
    if (!folder) {
      new Notice("Novel View：尚未打开设定组。");
      return;
    }
    const index = await this.plugin.readSettingCollectionIndex(folder.path);
    const title = folder.name.replace(/^-+/u, "") || "设定组";
    new SettingGraphModal(
      this.app,
      `关系图谱 · ${title}`,
      index,
      (keyword) => this.openRecordDetailByKeyword(keyword),
    ).open();
  }

  private renderGroup(
    parent: HTMLElement,
    group: string,
    tags: SettingCollectionTag[],
  ): void {
    const list = parent.createDiv({
      cls: "novelview-setting-collection-tags",
    });
    if (tags.length === 0) {
      list.createDiv({
        cls: "novelview-setting-collection-empty",
        text: "暂无标签，可点击顶部标签按钮新建。",
      });
      return;
    }
    for (const tag of tags) {
      this.renderTag(list, group, tag);
    }
  }

  private renderTag(
    parent: HTMLElement,
    group: string,
    tag: SettingCollectionTag,
  ): void {
    const tagCard = parent.createDiv({
      cls: "novelview-setting-collection-tag",
      attr: {
        "data-setting-drop-tag": tag.tag,
        "data-setting-group": group,
      },
    });
    const heading = tagCard.createDiv({
      cls: "novelview-setting-collection-tag-title",
    });
    const tagGrip = heading.createSpan({
      cls: "novelview-setting-collection-drag-grip",
    });
    setIcon(tagGrip, "grip-vertical");
    tagGrip.setAttr("draggable", "true");
    tagGrip.addEventListener("dragstart", (event) => {
      this.startDrag(event, { kind: "tag", group, tag: tag.tag });
    });
    const dot = heading.createSpan({
      cls: "novelview-setting-collection-tag-dot",
    });
    const color = /^\d+$/u.test(tag.color)
      ? `#${Number(tag.color).toString(16).padStart(6, "0")}`
      : tag.color;
    dot.setCssProps({
      "--novelview-setting-tag-color": color || "var(--interactive-accent)",
    });
    heading.createSpan({ text: tag.tag || "未命名标签" });
    heading.createSpan({
      cls: "novelview-setting-collection-count",
      text: `${tag.contain.length}`,
    });
    const actions = heading.createDiv({
      cls: "novelview-setting-collection-actions",
    });
    this.addSmallButton(actions, "file-plus", "新建记录", () => {
      this.createRecord(group, tag.tag);
    });
    this.addSmallButton(actions, "more-horizontal", "更多", (event) => {
      this.openTagMenu(event, group, tag.tag);
    });
    tagCard.addEventListener("contextmenu", (event) => {
      event.preventDefault();
      event.stopPropagation();
      this.openTagMenu(event, group, tag.tag);
    });
    const body = tagCard.createDiv({
      cls: "novelview-setting-collection-tag-body",
    });
    if (tag.contain.length === 0) {
      body.createDiv({
        cls: "novelview-setting-collection-empty",
        text: "暂无记录",
      });
      return;
    }
    for (const entry of tag.contain) {
      const row = body.createDiv({
        cls: "novelview-setting-collection-entry",
        attr: {
          "data-setting-group": group,
          "data-setting-tag": tag.tag,
          "data-setting-keyword": entry.keyword,
          "data-setting-drop-record": entry.keyword,
        },
      });
      const recordGrip = row.createSpan({
        cls: "novelview-setting-collection-drag-grip",
      });
      setIcon(recordGrip, "grip-vertical");
      recordGrip.setAttr("draggable", "true");
      recordGrip.addEventListener("dragstart", (event) => {
        this.startDrag(event, {
          kind: "record",
          group,
          tag: tag.tag,
          keyword: entry.keyword,
        });
      });
      row.createDiv({
        cls: "novelview-setting-collection-keyword",
        text: entry.keyword || "未命名记录",
      });
      if (entry.content) {
        this.renderRecordContent(row, entry);
      }
      const recordActions = row.createDiv({
        cls: "novelview-setting-collection-entry-actions",
      });
      this.addSmallButton(recordActions, "file-plus", "新建详细文件", () => {
        this.createDetailFile(group, entry.keyword);
      });
      this.addSmallButton(recordActions, "more-horizontal", "更多", (event) => {
        this.openRecordMenu(event, group, tag.tag, entry.keyword);
      });
      row.addEventListener("click", (event) => {
        if ((event.target as HTMLElement | null)?.closest(
          "button, .novelview-setting-collection-drag-grip",
        )) {
          return;
        }
        this.openRecordDetail(group, tag.tag, entry);
      });
      row.addEventListener("contextmenu", (event) => {
        event.preventDefault();
        event.stopPropagation();
        this.openRecordMenu(event, group, tag.tag, entry.keyword);
      });
    }
  }

  private addSmallButton(
    parent: HTMLElement,
    icon: string,
    label: string,
    action: (event: MouseEvent) => void,
  ): void {
    const button = parent.createEl("button", {
      cls: "novelview-setting-collection-small-button",
      attr: { type: "button", "aria-label": label, title: label },
    });
    setIcon(button, icon);
    button.addEventListener("click", (event) => {
      event.stopPropagation();
      action(event);
    });
  }

  private openTagMenu(event: MouseEvent, group: string, tag: string): void {
    const menu = new Menu();
    menu.addItem((item) => {
      item.setTitle("新建设定记录").setIcon("file-plus").onClick(() => this.createRecord(group, tag));
    });
    menu.addItem((item) => {
      item.setTitle("编辑标签").setIcon("pencil").onClick(() => this.editTag(group, tag));
    });
    menu.addSeparator();
    menu.addItem((item) => {
      item.setTitle("删除标签").setIcon("trash").onClick(() => this.deleteTag(group, tag));
    });
    menu.showAtMouseEvent(event);
  }

  private openRecordMenu(
    event: MouseEvent,
    group: string,
    tag: string,
    keyword: string,
  ): void {
    const menu = new Menu();
    menu.addItem((item) => {
      item.setTitle("编辑记录").setIcon("pencil").onClick(() => {
        this.editRecord(group, tag, keyword);
      });
    });
    menu.addItem((item) => {
      item.setTitle("新建详细文件").setIcon("file-plus").onClick(() => {
        this.createDetailFile(group, keyword);
      });
    });
    const details = this.plugin.getSettingRecordDetailFiles(
      this.folderPath,
      group,
      keyword,
    );
    for (const file of details) {
      menu.addItem((item) => {
        item.setTitle(`打开详细文件：${this.plugin.getSettingRecordDetailLabel(keyword, file)}`)
          .setIcon("file-text")
          .onClick(() => {
            void this.app.workspace.getLeaf(false).openFile(file);
          });
      });
    }
    menu.addSeparator();
    menu.addItem((item) => {
      item.setTitle("删除记录").setIcon("trash").onClick(() => {
        this.deleteRecord(group, tag, keyword);
      });
    });
    menu.showAtMouseEvent(event);
  }

  private async getFolder(): Promise<{ folderPath: string; index: SettingCollectionIndex } | null> {
    const folder = this.plugin.getSettingCollectionFolder(this.folderPath);
    if (!folder) {
      new Notice("Novel View：尚未构建设定集。");
      return null;
    }
    const index = await this.plugin.readSettingCollectionIndex(folder.path);
    return { folderPath: folder.path, index };
  }

  private createTag(group: string): void {
    new SettingTagModal(
      this.app,
      "新建设定标签",
      "",
      "#3498db",
      async (name, color, setError) => {
        const data = await this.getFolder();
        if (!data) {
          return false;
        }
        const tags = data.index[group];
        if (!tags) {
          setError("设定分组不存在。");
          return false;
        }
        if (tags.some((tag) => tag.tag === name)) {
          setError("同名标签已存在。");
          return false;
        }
        tags.push({ tag: name, color, contain: [] });
        await this.plugin.writeSettingCollectionIndex(data.folderPath, data.index);
        await this.refresh();
        return true;
      },
    ).open();
  }

  private editTag(group: string, tagName: string): void {
    const folder = this.plugin.getSettingCollectionFolder(this.folderPath);
    if (!folder) {
      new Notice("Novel View：尚未构建设定集。");
      return;
    }
    void this.plugin.readSettingCollectionIndex(folder.path).then((index) => {
      const tag = index[group]?.find((entry) => entry.tag === tagName);
      if (!tag) {
        return;
      }
      new SettingTagModal(
        this.app,
        "编辑设定标签",
        tag.tag,
        tag.color || "#3498db",
        async (name, color, setError) => {
          const data = await this.getFolder();
          if (!data) {
            return false;
          }
          const tags = data.index[group];
          if (!tags) {
            setError("设定分组不存在。");
            return false;
          }
          if (tags.some((entry) => entry.tag === name && entry.tag !== tagName)) {
            setError("同名标签已存在。");
            return false;
          }
          const current = tags.find((entry) => entry.tag === tagName);
          if (!current) {
            setError("标签不存在。");
            return false;
          }
          current.tag = name;
          current.color = color;
          await this.plugin.writeSettingCollectionIndex(data.folderPath, data.index);
          await this.refresh();
          return true;
        },
      ).open();
    });
  }

  private deleteTag(group: string, tagName: string): void {
    new SettingConfirmModal(
      this.app,
      "删除标签",
      `删除标签“${tagName}”及其下所有记录？`,
      "删除",
      async () => {
        const data = await this.getFolder();
        if (!data) {
          return;
        }
        const tags = data.index[group];
        if (!tags) {
          return;
        }
        data.index[group] = tags.filter((tag) => tag.tag !== tagName);
        await this.plugin.writeSettingCollectionIndex(data.folderPath, data.index);
        await this.refresh();
      },
    ).open();
  }

  private createRecord(
    group: string,
    tagName?: string,
    event?: MouseEvent,
  ): void {
    void this.getFolder().then((data) => {
      if (!data) {
        return;
      }
      const tags = data.index[group];
      if (!tags || tags.length === 0) {
        new Notice("Novel View：请先为设定分组添加标签。");
        return;
      }
      const selected = tagName
        ? tags.find((tag) => tag.tag === tagName)
        : tags.length === 1
          ? tags[0]
          : null;
      if (selected) {
        this.openRecordModal(data.folderPath, group, selected.tag);
        return;
      }
      const menu = new Menu();
      for (const tag of tags) {
        menu.addItem((item) => {
          item.setTitle(tag.tag || "未命名标签").onClick(() => {
            this.openRecordModal(data.folderPath, group, tag.tag);
          });
        });
      }
      if (event) {
        menu.showAtMouseEvent(event);
      } else {
        menu.showAtPosition({ x: 0, y: 0 });
      }
    });
  }

  private openRecordModal(
    settingRoot: string,
    group: string,
    tagName: string,
  ): void {
    const novelRoot = this.plugin.findNovelGroupRoot(settingRoot)
      ?? this.folderPath;
    void this.plugin.getSettingRecordTargets(novelRoot).then((targets) => {
      const anchor = this.recordDetailPanel?.element?.getBoundingClientRect();
      this.recordEditorPanel ??= new SettingRecordEditorPanel();
      this.recordEditorPanel.show({
        title: "新建设定记录",
        anchor: anchor ? { left: anchor.left, top: anchor.top } : undefined,
        initial: {
          keyword: "",
          content: "",
          fields: [],
          relations: [],
          marks: [],
        },
        targets,
        onSubmit: async (draft, setError) => {
          const index = await this.plugin.readSettingCollectionIndex(settingRoot);
          const tags = index[group];
          const tag = tags?.find((entry) => entry.tag === tagName);
          if (!tag) {
            setError("标签不存在。");
            return false;
          }
          if (
            draft.keyword
            && tags?.some((entry) => entry.contain.some((row) => row.keyword === draft.keyword))
          ) {
            setError("同名关键词已存在。");
            return false;
          }
          const relations = draft.relations.map((relation) => ({ ...relation }));
          this.plugin.ensureSettingRelationLinkIds(
            relations,
            group,
            draft.keyword,
          );
          tag.contain.push({
            keyword: draft.keyword,
            content: draft.content,
            fields: draft.fields,
            relations,
            marks: [],
          });
          await this.plugin.writeSettingCollectionIndex(settingRoot, index);
          await this.plugin.syncSettingRelationLinks(
            novelRoot,
            group,
            "",
            draft.keyword,
            [],
            relations,
          );
          await this.refresh();
          return true;
        },
        onClose: () => {
          this.recordEditorPanel = null;
        },
      });
    });
  }

  private openRecordDetail(
    group: string,
    tag: string,
    entry: import("./core/setting-collection").SettingCollectionEntry,
  ): void {
    const folder = this.plugin.getSettingCollectionFolder(this.folderPath);
    if (!folder) {
      return;
    }
    this.showRecordDetail(folder, group, tag, entry);
  }

  private showRecordDetail(
    folder: TFolder,
    group: string,
    tag: string,
    entry: import("./core/setting-collection").SettingCollectionEntry,
  ): void {
    const detailFiles = this.plugin.getSettingRecordDetailFiles(
      folder.path,
      group,
      entry.keyword,
    );
    const groupName = folder.name.replace(/^-+/u, "") || group;
    this.recordDetailPanel ??= new SettingRecordDetailPanel();
    this.recordDetailPanel.show({
      groupName,
      tagName: tag,
      entry,
      detailFiles,
      detailLabel: (file) => this.plugin.getSettingRecordDetailLabel(
        entry.keyword,
        file,
      ),
      onEdit: () => this.editRecordAt(
        folder.path,
        group,
        tag,
        entry.keyword,
      ),
      openFile: (file) => {
        void this.app.workspace.getLeaf(false).openFile(file);
      },
      onOpenRelation: (targetGroup, keyword) => {
        void this.openRelationTarget(targetGroup, keyword);
      },
    });
  }

  private async openRelationTarget(
    targetGroup: string,
    keyword: string,
  ): Promise<void> {
    const novelRoot = this.plugin.findNovelGroupRoot(this.folderPath)
      ?? this.folderPath;
    const folder = this.plugin.getSettingGroupFolderByName(
      novelRoot,
      targetGroup,
    );
    if (!folder) {
      return;
    }
    const index = await this.plugin.readSettingCollectionIndex(folder.path);
    for (const tags of Object.values(index)) {
      for (const tag of tags) {
        const entry = tag.contain.find((record) => record.keyword === keyword);
        if (entry) {
          this.showRecordDetail(folder, targetGroup, tag.tag, entry);
          return;
        }
      }
    }
  }

  private openRecordDetailByKeyword(keyword: string): void {
    const folder = this.plugin.getSettingCollectionFolder(this.folderPath);
    if (!folder) {
      return;
    }
    void this.plugin.readSettingCollectionIndex(folder.path).then((index) => {
      for (const tags of Object.values(index)) {
        for (const tag of tags) {
          const entry = tag.contain.find((record) => record.keyword === keyword);
          if (entry) {
            this.openRecordDetail(
              Object.keys(index)[0] ?? "",
              tag.tag,
              entry,
            );
            return;
          }
        }
      }
    });
  }

  private createDetailFile(group: string, keyword: string): void {
    new SettingGroupModal(
      this.app,
      "新建设定详细文件",
      "",
      async (title, setError) => {
        const file = await this.plugin.createSettingRecordDetail(
          this.folderPath,
          group,
          keyword,
          title,
        );
        if (!file) {
          setError("详细文件创建失败。");
          return false;
        }
        await this.refresh();
        await this.app.workspace.getLeaf(false).openFile(file);
        return true;
      },
      "例如：生平履历",
    ).open();
  }

  private editRecord(group: string, tagName: string, keyword: string): void {
    this.editRecordAt(this.folderPath, group, tagName, keyword);
  }

  private editRecordAt(
    folderPath: string,
    group: string,
    tagName: string,
    keyword: string,
  ): void {
    const folder = this.plugin.getFolder(folderPath);
    if (!folder) {
      return;
    }
    void this.plugin.readSettingCollectionIndex(folder.path).then((index) => {
      const tag = index[group]?.find((entry) => entry.tag === tagName);
      const record = tag?.contain.find((entry) => entry.keyword === keyword);
      if (!tag || !record) {
        return;
      }
      const novelRoot = this.plugin.findNovelGroupRoot(folder.path)
        ?? folder.path;
      void this.plugin.getSettingRecordTargets(novelRoot).then((targets) => {
        const anchor = this.recordDetailPanel?.element?.getBoundingClientRect();
        this.recordEditorPanel ??= new SettingRecordEditorPanel();
        this.recordEditorPanel.show({
          title: "编辑设定记录",
          anchor: anchor ? { left: anchor.left, top: anchor.top } : undefined,
          initial: {
            keyword: record.keyword,
            content: record.content,
            fields: record.fields.map((field) => ({ ...field })),
            relations: record.relations.map((relation) => ({ ...relation })),
            marks: record.marks.map((mark) => ({ ...mark })),
          },
          targets,
          onSubmit: async (draft, setError) => {
            const data = {
              folderPath,
              index: await this.plugin.readSettingCollectionIndex(folderPath),
            };
            const tags = data.index[group];
            const currentTag = tags?.find((entry) => entry.tag === tagName);
            const current = currentTag?.contain.find((entry) => entry.keyword === keyword);
            if (!currentTag || !current) {
              setError("记录不存在。");
              return false;
            }
            if (
              draft.keyword
              && tags?.some((entry) => entry.contain.some((row) => (
                row.keyword === draft.keyword
                && !(entry === currentTag && row === current)
              )))
            ) {
              setError("同名关键词已存在。");
              return false;
            }
            const previousRelations = current.relations.map(
              (relation) => ({ ...relation }),
            );
            const relations = draft.relations.map((relation) => ({ ...relation }));
            this.plugin.ensureSettingRelationLinkIds(
            relations,
            group,
            draft.keyword,
          );
            current.keyword = draft.keyword;
            current.content = draft.content;
            current.fields = draft.fields;
            current.relations = relations;
            current.marks = [];
            await this.plugin.writeSettingCollectionIndex(data.folderPath, data.index);
            if (draft.keyword && draft.keyword !== keyword) {
              await this.plugin.renameSettingRecordDetails(
                folderPath,
                group,
                keyword,
                draft.keyword,
              );
            }
            await this.plugin.syncSettingRelationLinks(
              novelRoot,
              group,
              keyword,
              draft.keyword,
              previousRelations,
              relations,
            );
            await this.refresh();
            if (this.recordDetailPanel) {
              this.showRecordDetail(folder, group, tagName, current);
            }
            return true;
          },
          onClose: () => {
            this.recordEditorPanel = null;
          },
        });
      });
    });
  }

  private deleteRecord(group: string, tagName: string, keyword: string): void {
    new SettingConfirmModal(
      this.app,
      "删除记录",
      `删除记录“${keyword}”？`,
      "删除",
      async () => {
        const data = await this.getFolder();
        if (!data) {
          return;
        }
        const tag = data.index[group]?.find((entry) => entry.tag === tagName);
        if (!tag) {
          return;
        }
        tag.contain = tag.contain.filter((entry) => entry.keyword !== keyword);
        await this.plugin.writeSettingCollectionIndex(data.folderPath, data.index);
        await this.refresh();
      },
    ).open();
  }

  private renderMissingCollection(): void {
    this.contentEl.createDiv({
      cls: "novelview-setting-collection-message",
      text: "尚未构建设定集。",
    });
    const button = this.contentEl.createEl("button", {
      cls: "novelview-setting-collection-build-button",
      text: "构建设定集",
      attr: { type: "button" },
    });
    button.addEventListener("click", () => {
      void this.plugin.createSettingGroup(this.folderPath).then(() => this.refresh());
    });
  }

  private renderMessage(message: string): void {
    this.contentEl.createDiv({
      cls: "novelview-setting-collection-message",
      text: message,
    });
  }
}
