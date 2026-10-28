import {
  ItemView,
  Menu,
  Notice,
  setIcon,
  TFile,
  type ViewStateResult,
  type WorkspaceLeaf,
} from "obsidian";
import { confirmAction } from "./confirm-modal";
import {
  DEFAULT_LINK_GROUP,
  getLinkFileName,
  getLinkGroupNames,
  getLinkGroupStyle,
  getLinkGroupTags,
  getLinkTagColor,
  LINK_STYLE_LABELS,
  type LinkFileEntry,
  type LinkLibraryData,
} from "./core/link-library";
import { LinkEditPanel } from "./link-edit-panel";
import { LinkImportPanel } from "./link-import-panel";
import { TextPromptModal } from "./text-prompt-modal";
import type NovelViewPlugin from "./main";

export const LINK_LIBRARY_VIEW_TYPE = "novelview-link-library";

export class LinkLibraryView extends ItemView {
  private readonly plugin: NovelViewPlugin;
  private groupPath = "";
  private data: LinkLibraryData = { group: {}, tags: {}, links: [] };
  private focusedKey: string | null = null;
  private readonly selectedKeys = new Set<string>();
  private selectionAnchorKey: string | null = null;
  private suppressBlankClick = false;
  private readonly collapsedGroups = new Set<string>();
  private readonly collapsedTags = new Set<string>();
  private renderToken = 0;
  private importPanel: LinkImportPanel | null = null;
  private editPanel: LinkEditPanel | null = null;
  private marquee: {
    pointerId: number;
    startX: number;
    startY: number;
    box: HTMLElement;
  } | null = null;

  constructor(leaf: WorkspaceLeaf, plugin: NovelViewPlugin) {
    super(leaf);
    this.plugin = plugin;
    this.navigation = false;
  }

  override getViewType(): string {
    return LINK_LIBRARY_VIEW_TYPE;
  }

  override getDisplayText(): string {
    return "联动库";
  }

  override getIcon(): string {
    return "link";
  }

  override getState(): Record<string, unknown> {
    return { groupPath: this.groupPath };
  }

  override async setState(
    state: Record<string, unknown>,
    result: ViewStateResult,
  ): Promise<void> {
    if (typeof state.groupPath === "string") {
      this.groupPath = state.groupPath;
    }
    result.history = true;
    await super.setState(state, result);
    void this.render();
  }

  protected override async onOpen(): Promise<void> {
    this.contentEl.empty();
    this.contentEl.addClass("novelview-link-library-view");
    this.registerEvent(this.app.vault.on("modify", (file) => {
      if (file.path.endsWith("/links.json")) {
        void this.render();
      }
    }));
    this.registerDomEvent(this.contentEl, "contextmenu", (event) => {
      this.handleContextMenu(event);
    });
    this.registerDomEvent(this.contentEl, "pointerdown", (event) => {
      this.handlePointerDown(event);
    });
    this.registerDomEvent(this.contentEl, "click", (event) => {
      if (this.suppressBlankClick) {
        this.suppressBlankClick = false;
        return;
      }
      const target = event.target as HTMLElement | null;
      if (target?.closest("[data-link-key], [data-link-target], button, input, textarea, select")) {
        return;
      }
      this.selectedKeys.clear();
      this.selectionAnchorKey = null;
      this.updateSelectionClasses();
    });
    await this.render();
  }

  protected override async onClose(): Promise<void> {
    this.renderToken += 1;
    this.importPanel?.close();
    this.importPanel = null;
    this.editPanel?.close();
    this.editPanel = null;
    this.contentEl.empty();
  }

  private async render(): Promise<void> {
    const token = ++this.renderToken;
    this.contentEl.empty();
    if (!this.groupPath) {
      this.contentEl.createDiv({ cls: "novelview-link-message", text: "请从文章列表打开联动库。" });
      return;
    }
    this.data = await this.plugin.readLinkLibrary(this.groupPath);
    if (token !== this.renderToken) {
      return;
    }
    const header = this.contentEl.createDiv({ cls: "novelview-link-header" });
    header.createEl("h2", { cls: "novelview-link-title", text: "联动库" });
    const tree = this.contentEl.createDiv({ cls: "novelview-link-tree" });
    for (const group of getLinkGroupNames(this.data)) {
      this.renderGroup(tree, group);
      if (this.collapsedGroups.has(group)) {
        continue;
      }
      const files = this.data.links.filter((entry) => entry.belong === group);
      for (const file of files.filter((entry) => !entry.tag)) {
        this.renderFile(tree, group, file, 0);
      }
      for (const tag of getLinkGroupTags(this.data, group)) {
        this.renderTag(tree, group, tag);
        if (this.collapsedTags.has(`${group}/${tag}`)) {
          continue;
        }
        for (const file of files.filter((entry) => entry.tag === tag)) {
          this.renderFile(tree, group, file, 1);
        }
      }
    }
    const visible = new Set(this.visibleKeys());
    for (const key of [...this.selectedKeys]) {
      if (!visible.has(key)) {
        this.selectedKeys.delete(key);
      }
    }
    this.updateSelectionClasses();
  }

  private renderGroup(parent: HTMLElement, group: string): void {
    const key = `group:${group}`;
    const collapsed = this.collapsedGroups.has(group);
    const row = parent.createDiv({
      cls: "novelview-link-group-row",
      attr: { "data-link-target": `group:${group}`, "aria-expanded": String(!collapsed) },
    });
    row.toggleClass("is-focused", this.focusedKey === key);
    row.draggable = true;
    const chevron = row.createSpan({ cls: "novelview-link-group-chevron" });
    setIcon(chevron, collapsed ? "chevron-right" : "chevron-down");
    const icon = row.createSpan({ cls: "novelview-link-group-icon" });
    setIcon(icon, "folder");
    row.createSpan({ cls: "novelview-link-group-name", text: group });
    row.createSpan({
      cls: "novelview-link-group-style",
      text: LINK_STYLE_LABELS[getLinkGroupStyle(this.data, group)],
    });
    row.createSpan({
      cls: "novelview-link-group-count",
      text: String(this.data.links.filter((entry) => entry.belong === group).length),
    });
    row.addEventListener("click", () => {
      this.focusedKey = key;
      if (collapsed) {
        this.collapsedGroups.delete(group);
      } else {
        this.collapsedGroups.add(group);
      }
      void this.render();
    });
  }

  private renderTag(parent: HTMLElement, group: string, tag: string): void {
    const key = `tag:${group}/${tag}`;
    const collapsed = this.collapsedTags.has(`${group}/${tag}`);
    const row = parent.createDiv({
      cls: "novelview-link-tag-row",
      attr: { "data-link-target": `tag:${group}/${tag}`, "aria-expanded": String(!collapsed) },
    });
    const chevron = row.createSpan({ cls: "novelview-link-tag-chevron" });
    setIcon(chevron, collapsed ? "chevron-right" : "chevron-down");
    const icon = row.createSpan({ cls: "novelview-link-tag-icon" });
    setIcon(icon, "tag");
    row.createSpan({ cls: "novelview-link-tag-name", text: tag });
    row.createSpan({ cls: "novelview-link-tag-color" })
      .setAttr("style", `background-color:${getLinkTagColor(this.data, group, tag)}; margin-left:auto;`);
    row.addEventListener("click", (event) => {
      event.stopPropagation();
      this.focusedKey = key;
      if (collapsed) {
        this.collapsedTags.delete(`${group}/${tag}`);
      } else {
        this.collapsedTags.add(`${group}/${tag}`);
      }
      void this.render();
    });
  }

  private renderFile(
    parent: HTMLElement,
    group: string,
    link: LinkFileEntry,
    depth: number,
  ): void {
    const key = `file:${link.path}`;
    const row = parent.createDiv({
      cls: `novelview-link-file-row depth-${depth}`,
      attr: { "data-link-key": key },
    });
    row.toggleClass("is-selected", this.selectedKeys.has(key));
    row.toggleClass("is-focused", this.focusedKey === key);
    row.draggable = true;
    const icon = row.createSpan({ cls: "novelview-link-file-icon" });
    setIcon(icon, "file-text");
    const text = row.createDiv({ cls: "novelview-link-file-text" });
    text.createDiv({ cls: "novelview-link-file-name", text: getLinkFileName(link.path) });
    text.createDiv({
      cls: "novelview-link-file-alias",
      text: link.tag
        ? `${link.tag}${link.aliases.length ? ` · ${link.aliases.join("、")}` : ""}`
        : link.aliases.join("、") || link.path,
    });
    row.addEventListener("click", (event) => {
      if (this.handleSelectionClick(event, key)) {
        return;
      }
      this.focusedKey = key;
      this.updateFocus();
      this.openLink(link.path);
    });
    row.addEventListener("dragstart", (event) => {
      event.dataTransfer?.setData("application/x-novelview-link-file", link.path);
    });
  }

  private handleSelectionClick(event: MouseEvent, key: string): boolean {
    if (event.shiftKey) {
      event.preventDefault();
      event.stopPropagation();
      this.selectRange(key);
      return true;
    }
    if (event.ctrlKey || event.metaKey) {
      event.preventDefault();
      event.stopPropagation();
      this.toggleSelection(key);
      return true;
    }
    this.selectedKeys.clear();
    this.selectedKeys.add(key);
    this.selectionAnchorKey = key;
    this.updateSelectionClasses();
    return false;
  }

  private toggleSelection(key: string): void {
    if (this.selectedKeys.has(key)) {
      this.selectedKeys.delete(key);
    } else {
      this.selectedKeys.add(key);
    }
    this.selectionAnchorKey = key;
    this.updateSelectionClasses();
  }

  private selectRange(key: string): void {
    const keys = this.visibleKeys();
    const anchor = this.selectionAnchorKey ? keys.indexOf(this.selectionAnchorKey) : -1;
    const target = keys.indexOf(key);
    if (anchor < 0 || target < 0) {
      this.selectedKeys.clear();
      this.selectedKeys.add(key);
      this.selectionAnchorKey = key;
      this.updateSelectionClasses();
      return;
    }
    const from = Math.min(anchor, target);
    const to = Math.max(anchor, target);
    this.selectedKeys.clear();
    for (let index = from; index <= to; index += 1) {
      this.selectedKeys.add(keys[index]);
    }
    this.updateSelectionClasses();
  }

  private visibleKeys(): string[] {
    return [...this.contentEl.querySelectorAll<HTMLElement>("[data-link-key]")]
      .map((row) => row.dataset.linkKey)
      .filter((key): key is string => !!key);
  }

  private updateSelectionClasses(): void {
    for (const row of this.contentEl.querySelectorAll<HTMLElement>("[data-link-key]")) {
      row.toggleClass("is-selected", !!row.dataset.linkKey && this.selectedKeys.has(row.dataset.linkKey));
      row.toggleClass("is-focused", row.dataset.linkKey === this.focusedKey);
    }
  }

  private updateFocus(): void {
    for (const row of this.contentEl.querySelectorAll<HTMLElement>("[data-link-key]")) {
      row.toggleClass("is-focused", row.dataset.linkKey === this.focusedKey);
    }
  }

  private handleContextMenu(event: MouseEvent): void {
    const fileTarget = (event.target as HTMLElement | null)?.closest<HTMLElement>("[data-link-key]");
    const target = fileTarget
      ?? (event.target as HTMLElement | null)?.closest<HTMLElement>("[data-link-target]");
    if (!target) {
      event.preventDefault();
      this.showBlankMenu(event);
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    const key = target.dataset.linkKey;
    const contextKey = key ?? target.dataset.linkTarget;
    if (!contextKey) {
      return;
    }
    if (!key) {
      if (contextKey.startsWith("group:")) {
        this.showGroupMenu(event, contextKey.slice("group:".length));
      }
      return;
    }
    if (!this.selectedKeys.has(key)) {
      this.selectedKeys.clear();
      this.selectedKeys.add(key);
      this.selectionAnchorKey = key;
    }
    this.focusedKey = key;
    this.updateSelectionClasses();
    const selectedFiles = [...this.selectedKeys]
      .filter((entry) => entry.startsWith("file:"))
      .map((entry) => entry.slice("file:".length))
      .map((path) => this.data.links.find((entry) => entry.path === path))
      .filter((entry): entry is LinkFileEntry => !!entry);
    if (this.selectedKeys.size > 1) {
      const menu = new Menu();
      if (selectedFiles.length > 0) {
        menu.addItem((item) => {
          item.setTitle("批量添加标签").setIcon("tag").onClick(() => {
            this.batchAddTag(selectedFiles);
          });
        });
      }
      menu.addItem((item) => {
        item.setTitle(`批量删除 ${this.selectedKeys.size} 项`).setIcon("trash").onClick(() => {
          void this.deleteSelected();
        });
      });
      menu.showAtMouseEvent(event);
      return;
    }
    if (key.startsWith("group:")) {
      this.showGroupMenu(event, key.slice("group:".length));
    } else {
      const link = this.data.links.find((entry) => `file:${entry.path}` === key);
      if (link) {
        this.showFileMenu(event, link);
      }
    }
  }

  private showBlankMenu(event: MouseEvent): void {
    const menu = new Menu();
    menu.addItem((item) => {
      item.setTitle("新增联动组").setIcon("folder-plus").onClick(() => {
        this.createGroup();
      });
    });
    menu.addItem((item) => {
      item.setTitle("导入联动文件").setIcon("file-plus").onClick(() => {
        this.openImport();
      });
    });
    menu.showAtMouseEvent(event);
  }

  private showGroupMenu(event: MouseEvent, group: string): void {
    const menu = new Menu();
    menu.addItem((item) => {
      item.setTitle("编辑字体样式").setIcon("type").onClick(() => this.editGroup(group));
    });
    if (group !== DEFAULT_LINK_GROUP) {
      menu.addItem((item) => {
        item.setTitle("重命名").setIcon("text-cursor-input").onClick(() => {
          this.startInlineRename(`group:${group}`);
        });
      });
      menu.addItem((item) => {
        item.setTitle("删除").setIcon("trash").onClick(() => {
          void this.deleteGroup(group);
        });
      });
    }
    menu.showAtMouseEvent(event);
  }

  private showFileMenu(event: MouseEvent, link: LinkFileEntry): void {
    const menu = new Menu();
    menu.addItem((item) => {
      item.setTitle("编辑标签/别名").setIcon("pencil").onClick(() => this.editFile(link));
    });
    menu.addItem((item) => {
      item.setTitle("重命名").setIcon("text-cursor-input").onClick(() => {
        this.startInlineRename(`file:${link.path}`);
      });
    });
    menu.addItem((item) => {
      item.setTitle("删除").setIcon("trash").onClick(() => void this.deleteFile(link));
    });
    menu.showAtMouseEvent(event);
  }

  private startInlineRename(key: string): void {
    const row = this.contentEl.querySelector<HTMLElement>(`[data-link-key="${CSS.escape(key)}"]`);
    const nameEl = row?.querySelector<HTMLElement>(
      key.startsWith("group:") ? ".novelview-link-group-name" : ".novelview-link-file-name",
    );
    if (!row || !nameEl) {
      return;
    }
    const original = nameEl.textContent ?? "";
    nameEl.empty();
    const input = createEl("input", {
      cls: "novelview-link-inline-rename",
      attr: { type: "text", "aria-label": "重命名" },
    });
    input.value = original;
    nameEl.appendChild(input);
    let settled = false;
    const finish = (commit: boolean): void => {
      if (settled) {
        return;
      }
      settled = true;
      const value = input.value.trim();
      if (!commit || !value || value === original) {
        void this.render();
        return;
      }
      if (key.startsWith("group:")) {
        this.renameGroup(key.slice("group:".length), value);
      } else {
        void this.renameFile(key.slice("file:".length), value);
      }
    };
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
    window.setTimeout(() => input.select(), 0);
  }

  private renameGroup(oldName: string, newName: string): void {
    if (newName === DEFAULT_LINK_GROUP || this.data.group[newName]) {
      new Notice("NovelView：联动组已存在。");
      void this.render();
      return;
    }
    const groups: Record<string, { style: import("./core/link-library").LinkHighlightStyle }> = {};
    for (const [name, config] of Object.entries(this.data.group)) {
      groups[name === oldName ? newName : name] = config;
    }
    groups[newName] ??= { style: "normal" };
    this.data.group = groups;
    for (const link of this.data.links) {
      if (link.belong === oldName) {
        link.belong = newName;
      }
    }
    if (this.data.tags[oldName]) {
      this.data.tags[newName] = this.data.tags[oldName];
      delete this.data.tags[oldName];
    }
    void this.persist();
  }

  private async renameFile(oldPath: string, newName: string): Promise<void> {
    const link = this.data.links.find((entry) => entry.path === oldPath);
    if (!link) {
      return;
    }
    const target = this.plugin.getLinkTargetFile(this.groupPath, oldPath);
    if (target instanceof TFile) {
      const nextPath = target.parent ? `${target.parent.path}/${newName}` : newName;
      if (nextPath !== target.path) {
        if (this.app.vault.getAbstractFileByPath(nextPath)) {
          new Notice("NovelView：同名联动文件已存在。");
          void this.render();
          return;
        }
        await this.app.fileManager.renameFile(target, nextPath);
      }
    }
    const slash = oldPath.lastIndexOf("/");
    link.path = `${slash >= 0 ? oldPath.slice(0, slash + 1) : ""}${newName}`;
    await this.persist();
  }

  private createGroup(): void {
    new TextPromptModal(this.app, {
      title: "新增联动组",
      placeholder: "联动组名称",
      submitLabel: "创建",
      onSubmit: (value) => {
        const name = value.trim();
        if (!name) {
          return;
        }
        if (name === DEFAULT_LINK_GROUP || this.data.group[name]) {
          new Notice("NovelView：联动组已存在。");
          return;
        }
        this.data.group[name] = { style: "normal" };
        void this.persist();
      },
    }).open();
  }

  private editGroup(group: string): void {
    this.editPanel?.close();
    this.editPanel = new LinkEditPanel(
      "group",
      "编辑联动组",
      { style: getLinkGroupStyle(this.data, group) },
      (value) => {
        this.data.group[group] = { style: value.style ?? "normal" };
        void this.persist();
      },
      () => { this.editPanel = null; },
    );
  }

  private editFile(link: LinkFileEntry): void {
    this.editPanel?.close();
    this.editPanel = new LinkEditPanel(
      "file",
      "编辑联动文件",
      {
        tag: link.tag,
        color: getLinkTagColor(this.data, link.belong, link.tag),
        aliases: link.aliases,
      },
      (value) => {
        link.tag = value.tag ?? "";
        if (link.tag) {
          this.data.tags[link.belong] ??= {};
          this.data.tags[link.belong][link.tag] = value.color ?? "#9a5a2d";
        }
        link.aliases = value.aliases ?? [];
        void this.persist();
      },
      () => { this.editPanel = null; },
    );
  }

  private batchAddTag(files: LinkFileEntry[]): void {
    this.editPanel?.close();
    this.editPanel = new LinkEditPanel(
      "batch-tag",
      `为 ${files.length} 个联动文件添加标签`,
      { tag: "", color: "#9a5a2d" },
      (value) => {
        const tag = value.tag?.trim() ?? "";
        if (!tag) {
          new Notice("NovelView：请输入联动标签。");
          return;
        }
        for (const file of files) {
          file.tag = tag;
          this.data.tags[file.belong] ??= {};
          this.data.tags[file.belong][tag] = value.color ?? "#9a5a2d";
        }
        void this.persist();
      },
      () => { this.editPanel = null; },
    );
  }

  private async deleteSelected(): Promise<void> {
    if (!await confirmAction(
      this.app,
      "删除所选联动内容",
      `确定删除 ${this.selectedKeys.size} 项联动记录吗？实际文件会保留。`,
    )) {
      return;
    }
    for (const key of this.selectedKeys) {
      if (key.startsWith("group:")) {
        const group = key.slice("group:".length);
        delete this.data.group[group];
        delete this.data.tags[group];
        for (const link of this.data.links) {
          if (link.belong === group) {
            link.belong = DEFAULT_LINK_GROUP;
          }
        }
      } else if (key.startsWith("file:")) {
        const path = key.slice("file:".length);
        this.data.links = this.data.links.filter((entry) => entry.path !== path);
      }
    }
    this.selectedKeys.clear();
    await this.persist();
  }

  private async deleteGroup(group: string): Promise<void> {
    if (!await confirmAction(this.app, "删除联动组", `删除联动组“${group}”？组内文件将回到${DEFAULT_LINK_GROUP}。`)) {
      return;
    }
    delete this.data.group[group];
    delete this.data.tags[group];
    for (const link of this.data.links) {
      if (link.belong === group) {
        link.belong = DEFAULT_LINK_GROUP;
      }
    }
    await this.persist();
  }

  private async deleteFile(link: LinkFileEntry): Promise<void> {
    if (!await confirmAction(this.app, "删除联动文件", `从联动库移除“${getLinkFileName(link.path)}”？实际文件会保留。`)) {
      return;
    }
    this.data.links = this.data.links.filter((entry) => entry.path !== link.path);
    await this.persist();
  }

  private openImport(): void {
    const candidates = this.plugin.getLinkImportCandidates(this.groupPath);
    const existing = new Set(this.data.links.map((link) => link.path));
    this.importPanel?.close();
    this.importPanel = new LinkImportPanel(
      candidates,
      existing,
      (path, aliases) => {
        if (!this.data.links.some((link) => link.path === path)) {
          this.data.links.push({ path, belong: DEFAULT_LINK_GROUP, tag: "", aliases });
          void this.persist();
        }
      },
      () => { this.importPanel = null; void this.render(); },
    );
  }

  private openLink(path: string): void {
    const file = this.plugin.getLinkTargetFile(this.groupPath, path);
    if (!file) {
      new Notice(`NovelView：未找到联动文件“${path}”。`);
      return;
    }
    void this.app.workspace.openLinkText(file.path, this.groupPath, true, { active: true });
  }

  private handlePointerDown(event: PointerEvent): void {
    if (event.button !== 0) {
      return;
    }
    const target = event.target as HTMLElement | null;
    if (target?.closest("[data-link-key], [data-link-target], button, input, textarea, select")) {
      return;
    }
    const box = createEl("div", { cls: "novelview-selection-box" });
    document.body.appendChild(box);
    const state = { pointerId: event.pointerId, startX: event.clientX, startY: event.clientY, box };
    this.marquee = state;
    const move = (moveEvent: PointerEvent): void => {
      if (this.marquee?.pointerId !== moveEvent.pointerId) {
        return;
      }
      const left = Math.min(state.startX, moveEvent.clientX);
      const top = Math.min(state.startY, moveEvent.clientY);
      const width = Math.abs(moveEvent.clientX - state.startX);
      const height = Math.abs(moveEvent.clientY - state.startY);
      state.box.setAttr("style", `left:${left}px;top:${top}px;width:${width}px;height:${height}px;`);
      state.box.toggleClass("is-visible", width > 3 || height > 3);
      const rect = { left, top, right: left + width, bottom: top + height };
      for (const row of this.contentEl.querySelectorAll<HTMLElement>("[data-link-key]")) {
        const rowRect = row.getBoundingClientRect();
        if (rowRect.left < rect.right && rowRect.right > rect.left && rowRect.top < rect.bottom && rowRect.bottom > rect.top) {
          if (row.dataset.linkKey) {
            this.selectedKeys.add(row.dataset.linkKey);
          }
        }
      }
      this.updateSelectionClasses();
    };
    const up = (upEvent: PointerEvent): void => {
      if (this.marquee?.pointerId !== upEvent.pointerId) {
        return;
      }
      state.box.remove();
      this.marquee = null;
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", up);
      this.suppressBlankClick = state.box.hasClass("is-visible");
      window.setTimeout(() => {
        this.suppressBlankClick = false;
      }, 60);
      this.updateSelectionClasses();
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", up);
    event.preventDefault();
  }

  private async persist(): Promise<void> {
    await this.plugin.writeLinkLibrary(this.groupPath, this.data);
    await this.render();
  }
}
