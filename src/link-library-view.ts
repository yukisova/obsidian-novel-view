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
  getLinkGroupColor,
  getLinkGroupNames,
  type LinkFileEntry,
  type LinkLibraryData,
} from "./core/link-library";
import { LinkEditPanel } from "./link-edit-panel";
import { TextPromptModal } from "./text-prompt-modal";
import { LinkImportPanel } from "./link-import-panel";
import type NovelViewPlugin from "./main";

export const LINK_LIBRARY_VIEW_TYPE = "novelview-link-library";

export class LinkLibraryView extends ItemView {
  private readonly plugin: NovelViewPlugin;
  private groupPath = "";
  private data: LinkLibraryData = { group: {}, links: [] };
  private focusedKey: string | null = null;
  private readonly selectedKeys = new Set<string>();
  private selectionAnchorKey: string | null = null;
  private multiMode = false;
  private readonly collapsedGroups = new Set<string>();
  private renderToken = 0;
  private importPanel: LinkImportPanel | null = null;
  private editPanel: LinkEditPanel | null = null;
  private marquee: {
    pointerId: number;
    startX: number;
    startY: number;
    box: HTMLElement;
    moved: boolean;
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
      this.contentEl.createDiv({
        cls: "novelview-link-message",
        text: "请从文章列表打开联动库。",
      });
      return;
    }
    this.data = await this.plugin.readLinkLibrary(this.groupPath);
    if (token !== this.renderToken) {
      return;
    }

    const header = this.contentEl.createDiv({ cls: "novelview-link-header" });
    header.createEl("h2", {
      cls: "novelview-link-title",
      text: "联动库",
    });
    header.createDiv({ cls: "novelview-link-flat-divider" });
    this.renderToolbar(this.contentEl);

    const tree = this.contentEl.createDiv({ cls: "novelview-link-tree" });
    for (const group of getLinkGroupNames(this.data)) {
      this.renderGroup(tree, group);
      if (this.collapsedGroups.has(group)) {
        continue;
      }
      for (const link of this.data.links
        .filter((entry) => (entry.belong || DEFAULT_LINK_GROUP) === group)
        .sort((left, right) => getLinkFileName(left.path).localeCompare(
          getLinkFileName(right.path),
          "zh-CN",
          { numeric: true, sensitivity: "base" },
        ))) {
        this.renderFile(tree, group, link);
      }
    }
    this.updateSelectionClasses();
  }

  private renderToolbar(parent: HTMLElement): void {
    const toolbar = parent.createDiv({ cls: "novelview-link-toolbar" });
    this.toolbarButton(toolbar, "folder-plus", "新增联动组", () => {
      this.createGroup();
    });
    this.toolbarButton(toolbar, "file-plus", "导入联动文件", () => {
      this.openImport();
    });
    const multi = this.toolbarButton(
      toolbar,
      "list-checks",
      this.multiMode ? "退出多选" : "多选",
      () => {
        this.multiMode = !this.multiMode;
        if (!this.multiMode) {
          this.selectedKeys.clear();
        }
        void this.render();
      },
    );
    multi.toggleClass("is-active", this.multiMode);
    if (this.multiMode) {
      const remove = this.toolbarButton(
        toolbar,
        "trash",
        "批量删除",
        () => {
          void this.deleteSelected();
        },
      );
      remove.toggleClass("is-disabled", this.selectedKeys.size === 0);
    }
  }

  private toolbarButton(
    parent: HTMLElement,
    icon: string,
    label: string,
    onClick: () => void,
  ): HTMLButtonElement {
    const button = parent.createEl("button", {
      cls: "novelview-link-toolbar-button",
      attr: { type: "button", "aria-label": label, title: label },
    });
    setIcon(button, icon);
    button.addEventListener("click", onClick);
    return button;
  }

  private renderGroup(parent: HTMLElement, group: string): void {
    const key = `group:${group}`;
    const collapsed = this.collapsedGroups.has(group);
    const row = parent.createDiv({
      cls: "novelview-link-group-row",
      attr: { "data-link-key": key, "aria-expanded": String(!collapsed) },
    });
    row.toggleClass("is-selected", this.selectedKeys.has(key));
    row.toggleClass("is-focused", this.focusedKey === key);
    row.draggable = true;
    const chevron = row.createSpan({ cls: "novelview-link-group-chevron" });
    setIcon(chevron, collapsed ? "chevron-right" : "chevron-down");
    row.createSpan({ cls: "novelview-link-color" })
      .setAttr("style", `background-color: ${getLinkGroupColor(this.data, group)};`);
    const icon = row.createSpan({ cls: "novelview-link-group-icon" });
    setIcon(icon, "folder");
    row.createSpan({ cls: "novelview-link-group-name", text: group });
    const count = this.data.links.filter(
      (entry) => (entry.belong || DEFAULT_LINK_GROUP) === group,
    ).length;
    row.createSpan({ cls: "novelview-link-group-count", text: String(count) });

    row.addEventListener("click", (event) => {
      if (this.handleSelectionClick(event, key)) {
        return;
      }
      this.focusedKey = key;
      if (collapsed) {
        this.collapsedGroups.delete(group);
      } else {
        this.collapsedGroups.add(group);
      }
      void this.render();
    });
    row.addEventListener("dragstart", (event) => {
      event.dataTransfer?.setData("application/x-novelview-link-group", group);
    });
    row.addEventListener("dragover", (event) => {
      if (this.hasLinkDrag(event)) {
        event.preventDefault();
      }
    });
    row.addEventListener("drop", (event) => {
      const sourceGroup = event.dataTransfer?.getData("application/x-novelview-link-group");
      if (sourceGroup && sourceGroup !== group) {
        event.preventDefault();
        this.reorderGroup(sourceGroup, group);
        return;
      }
      const sourceFile = event.dataTransfer?.getData("application/x-novelview-link-file");
      if (sourceFile) {
        event.preventDefault();
        const link = this.data.links.find((entry) => entry.path === sourceFile);
        if (link && link.belong !== group) {
          link.belong = group;
          void this.persist();
        }
      }
    });
  }

  private renderFile(
    parent: HTMLElement,
    _group: string,
    link: LinkFileEntry,
  ): void {
    const key = `file:${link.path}`;
    const row = parent.createDiv({
      cls: "novelview-link-file-row",
      attr: { "data-link-key": key },
    });
    row.toggleClass("is-selected", this.selectedKeys.has(key));
    row.toggleClass("is-focused", this.focusedKey === key);
    row.draggable = true;
    const icon = row.createSpan({ cls: "novelview-link-file-icon" });
    setIcon(icon, "file-text");
    const text = row.createDiv({ cls: "novelview-link-file-text" });
    text.createDiv({
      cls: "novelview-link-file-name",
      text: getLinkFileName(link.path),
    });
    text.createDiv({
      cls: "novelview-link-file-alias",
      text: link.aliases.length > 0 ? link.aliases.join("、") : link.path,
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
      event.dataTransfer?.setData("text/plain", link.path);
    });
  }

  private handleSelectionClick(event: MouseEvent, key: string): boolean {
    if (event.shiftKey) {
      event.preventDefault();
      event.stopPropagation();
      this.selectRange(key);
      return true;
    }
    if (event.ctrlKey || event.metaKey || this.multiMode) {
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
    return false;
  }

  private selectRange(key: string): void {
    const keys = this.visibleKeys();
    const anchorIndex = this.selectionAnchorKey
      ? keys.indexOf(this.selectionAnchorKey)
      : -1;
    const targetIndex = keys.indexOf(key);
    if (anchorIndex < 0 || targetIndex < 0) {
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
    const remove = this.contentEl.querySelector<HTMLElement>(
      ".novelview-link-toolbar-button[aria-label='批量删除']",
    );
    remove?.toggleClass("is-disabled", this.selectedKeys.size === 0);
  }

  private updateFocus(): void {
    for (const row of this.contentEl.querySelectorAll<HTMLElement>("[data-link-key]")) {
      row.toggleClass("is-focused", row.dataset.linkKey === this.focusedKey);
    }
  }

  private handleContextMenu(event: MouseEvent): void {
    const target = (event.target as HTMLElement | null)?.closest<HTMLElement>("[data-link-key]");
    if (!target) {
      event.preventDefault();
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    const key = target.dataset.linkKey;
    if (!key) {
      return;
    }
    if (!this.selectedKeys.has(key)) {
      this.selectedKeys.clear();
      this.selectedKeys.add(key);
      this.selectionAnchorKey = key;
      this.updateSelectionClasses();
    }
    this.focusedKey = key;
    this.updateFocus();
    if (this.selectedKeys.size > 1) {
      const menu = new Menu();
      menu.addItem((item) => {
        item.setTitle(`删除 ${this.selectedKeys.size} 项`)
          .setIcon("trash")
          .onClick(() => void this.deleteSelected());
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

  private showGroupMenu(event: MouseEvent, group: string): void {
    const menu = new Menu();
    menu.addItem((item) => {
      item.setTitle("编辑").setIcon("pencil").onClick(() => this.editGroup(group));
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
      item.setTitle("编辑").setIcon("pencil").onClick(() => {
        this.editFile(link);
      });
    });
    menu.addItem((item) => {
      item.setTitle("重命名").setIcon("text-cursor-input").onClick(() => {
        this.startInlineRename(`file:${link.path}`);
      });
    });
    menu.addItem((item) => {
      item.setTitle("删除").setIcon("trash").onClick(() => {
        void this.deleteFile(link);
      });
    });
    menu.showAtMouseEvent(event);
  }

  private startInlineRename(key: string): void {
    const row = this.contentEl.querySelector<HTMLElement>(
      `[data-link-key="${CSS.escape(key)}"]`,
    );
    const nameEl = row?.querySelector<HTMLElement>(
      key.startsWith("group:")
        ? ".novelview-link-group-name"
        : ".novelview-link-file-name",
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

  private renameGroup(oldName: string, newName: string): void {
    if (oldName === DEFAULT_LINK_GROUP) {
      return;
    }
    if (
      newName === DEFAULT_LINK_GROUP
      || this.data.group[newName]
    ) {
      new Notice("NovelView：联动组已存在。");
      void this.render();
      return;
    }
    const groups: Record<string, string> = {};
    for (const [name, color] of Object.entries(this.data.group)) {
      groups[name === oldName ? newName : name] = color;
    }
    groups[newName] ??= getLinkGroupColor(this.data, oldName);
    this.data.group = groups;
    for (const link of this.data.links) {
      if (link.belong === oldName) {
        link.belong = newName;
      }
    }
    void this.persist();
  }

  private async renameFile(oldPath: string, newName: string): Promise<void> {
    const link = this.data.links.find((entry) => entry.path === oldPath);
    if (!link) {
      return;
    }
    const oldBase = link.path.split("/").pop() ?? link.path;
    const oldDot = oldBase.lastIndexOf(".");
    const extension = oldDot > 0 ? oldBase.slice(oldDot) : "";
    const finalName = /\.[a-z0-9]+$/iu.test(newName)
      ? newName
      : `${newName}${extension}`;
    const target = this.plugin.getLinkTargetFile(this.groupPath, oldPath);
    if (target instanceof TFile) {
      const nextPath = target.parent
        ? `${target.parent.path}/${finalName}`
        : finalName;
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
    link.path = `${slash >= 0 ? oldPath.slice(0, slash + 1) : ""}${finalName}`;
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
        this.data.group[name] = "#9a5a2d";
        void this.persist();
      },
    }).open();
  }

  private editGroup(group: string): void {
    this.editPanel?.close();
    this.editPanel = new LinkEditPanel(
      "group",
      group,
      getLinkGroupColor(this.data, group),
      (value) => {
        this.data.group[group] = value;
        void this.persist();
      },
      () => {
        this.editPanel = null;
      },
    );
  }

  private editFile(link: LinkFileEntry): void {
    this.editPanel?.close();
    this.editPanel = new LinkEditPanel(
      "file",
      getLinkFileName(link.path),
      link.aliases.join("\n"),
      (value) => {
        link.aliases = value
          .split(/[,，;；\n]/u)
          .map((alias) => alias.trim())
          .filter(Boolean);
        void this.persist();
      },
      () => {
        this.editPanel = null;
      },
    );
  }

  private async deleteSelected(): Promise<void> {
    if (this.selectedKeys.size === 0 || !await confirmAction(
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
        for (const link of this.data.links) {
          if (link.belong === group) {
            link.belong = DEFAULT_LINK_GROUP;
          }
        }
      } else {
        const path = key.slice("file:".length);
        this.data.links = this.data.links.filter((entry) => entry.path !== path);
      }
    }
    this.selectedKeys.clear();
    await this.persist();
  }

  private async deleteGroup(group: string): Promise<void> {
    if (!await confirmAction(
      this.app,
      "删除联动组",
      `删除联动组“${group}”？组内文件将回到${DEFAULT_LINK_GROUP}。`,
    )) {
      return;
    }
    delete this.data.group[group];
    for (const link of this.data.links) {
      if (link.belong === group) {
        link.belong = DEFAULT_LINK_GROUP;
      }
    }
    await this.persist();
  }

  private async deleteFile(link: LinkFileEntry): Promise<void> {
    if (!await confirmAction(
      this.app,
      "删除联动文件",
      `从联动库移除“${getLinkFileName(link.path)}”？实际文件会保留。`,
    )) {
      return;
    }
    this.data.links = this.data.links.filter((entry) => entry.path !== link.path);
    await this.persist();
  }

  private reorderGroup(source: string, target: string): void {
    if (source === target || source === DEFAULT_LINK_GROUP) {
      return;
    }
    const entries = Object.entries(this.data.group);
    const sourceIndex = entries.findIndex(([name]) => name === source);
    const targetIndex = entries.findIndex(([name]) => name === target);
    if (sourceIndex < 0 || targetIndex < 0) {
      return;
    }
    const [entry] = entries.splice(sourceIndex, 1);
    entries.splice(targetIndex, 0, entry);
    this.data.group = Object.fromEntries(entries);
    void this.persist();
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
          this.data.links.push({ path, belong: DEFAULT_LINK_GROUP, aliases });
          void this.persist();
        }
      },
      () => {
        this.importPanel = null;
        void this.render();
      },
    );
  }

  private openLink(path: string): void {
    const file = this.plugin.getLinkTargetFile(this.groupPath, path);
    if (!file) {
      new Notice(`NovelView：未找到联动文件“${path}”。`);
      return;
    }
    void this.app.workspace.openLinkText(
      file.path,
      this.groupPath,
      true,
      { active: true },
    );
  }

  private hasLinkDrag(event: DragEvent): boolean {
    return !!(
      event.dataTransfer?.types.includes("application/x-novelview-link-group")
      || event.dataTransfer?.types.includes("application/x-novelview-link-file")
    );
  }

  private handlePointerDown(event: PointerEvent): void {
    if (!this.multiMode || event.button !== 0) {
      return;
    }
    const target = event.target as HTMLElement | null;
    if (target?.closest("[data-link-key], button, input, textarea")) {
      return;
    }
    const box = createEl("div", { cls: "novelview-selection-box" });
    document.body.appendChild(box);
    this.marquee = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      box,
      moved: false,
    };
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
      state.box.setAttr(
        "style",
        `left:${left}px;top:${top}px;width:${width}px;height:${height}px;`,
      );
      state.box.toggleClass("is-visible", state.moved);
      const rect = { left, top, right: left + width, bottom: top + height };
      for (const row of this.contentEl.querySelectorAll<HTMLElement>("[data-link-key]")) {
        const rowRect = row.getBoundingClientRect();
        if (
          rowRect.left < rect.right
          && rowRect.right > rect.left
          && rowRect.top < rect.bottom
          && rowRect.bottom > rect.top
        ) {
          if (row.dataset.linkKey) {
            this.selectedKeys.add(row.dataset.linkKey);
          }
        }
      }
      this.updateSelectionClasses();
    };
    const up = (upEvent: PointerEvent): void => {
      if (!this.marquee || this.marquee.pointerId !== upEvent.pointerId) {
        return;
      }
      this.marquee.box.remove();
      this.marquee = null;
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", up);
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
