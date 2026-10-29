export interface LinkImportCandidate {
  path: string;
  label: string;
}

export class LinkImportPanel {
  private readonly root: HTMLElement;
  private readonly listEl: HTMLElement;
  private readonly aliasInput: HTMLInputElement;
  private candidates: LinkImportCandidate[];
  private selectedPath: string | null = null;
  private closed = false;
  private readonly onImport: (path: string, aliases: string[]) => void;
  private readonly onClose: () => void;

  constructor(
    candidates: LinkImportCandidate[],
    existingPaths: Set<string>,
    onImport: (path: string, aliases: string[]) => void,
    onClose: () => void,
  ) {
    this.candidates = candidates.filter(
      (candidate) => !existingPaths.has(candidate.path),
    );
    this.onImport = onImport;
    this.onClose = onClose;
    this.root = createEl("div", { cls: "novelview-link-import-panel" });
    this.root.setAttr("role", "dialog");
    this.root.setAttr("aria-label", "导入联动文件");

    const header = this.root.createDiv({ cls: "novelview-link-import-header" });
    header.createSpan({ text: "导入联动文件" });
    const headerActions = header.createDiv({ cls: "novelview-link-import-actions" });
    const close = headerActions.createEl("button", {
      attr: { type: "button", "aria-label": "关闭" },
      text: "×",
    });
    close.addEventListener("click", () => this.close());

    this.listEl = this.root.createDiv({ cls: "novelview-link-import-tree" });
    this.aliasInput = this.root.createEl("input", {
      cls: "novelview-link-import-alias",
      attr: {
        type: "text",
        placeholder: "别名（可选）",
        "aria-label": "联动文件别名",
      },
    });
    this.aliasInput.disabled = true;
    this.aliasInput.addEventListener("keydown", (event) => {
      if (event.key === "Escape") {
        event.preventDefault();
        this.close();
        return;
      }
      if (event.key === "Enter") {
        event.preventDefault();
        this.confirmSelected();
      }
    });

    this.renderTree();
    document.body.appendChild(this.root);
  }

  close(): void {
    if (this.closed) {
      return;
    }
    this.closed = true;
    this.root.remove();
    this.onClose();
  }

  private renderTree(): void {
    this.listEl.empty();
    if (this.candidates.length === 0) {
      this.listEl.createDiv({
        cls: "novelview-link-import-empty",
        text: "没有可导入的仓库文件。",
      });
      this.selectedPath = null;
      this.aliasInput.disabled = true;
      return;
    }

    const folders = new Map<string, LinkImportCandidate[]>();
    for (const candidate of this.candidates) {
      const folder = candidate.label.includes("/")
        ? candidate.label.slice(0, candidate.label.lastIndexOf("/"))
        : "/";
      const list = folders.get(folder) ?? [];
      list.push(candidate);
      folders.set(folder, list);
    }
    for (const [folder, files] of folders) {
      const group = this.listEl.createDiv({ cls: "novelview-link-import-folder" });
      group.createDiv({
        cls: "novelview-link-import-folder-label",
        text: folder === "/" ? "仓库根目录" : folder,
      });
      for (const file of files) {
        const row = group.createEl("button", {
          cls: "novelview-link-import-file",
          attr: { type: "button" },
        });
        row.createSpan({ cls: "novelview-link-import-file-name", text: file.path.split("/").pop() ?? file.path });
        row.createSpan({ cls: "novelview-link-import-file-path", text: file.label });
        row.dataset.path = file.path;
        row.addEventListener("click", () => this.select(file.path));
        row.addEventListener("dblclick", (event) => {
          event.preventDefault();
          this.select(file.path);
          this.confirmSelected();
        });
        if (this.selectedPath === file.path) {
          row.addClass("is-selected");
        }
      }
    }
    if (this.selectedPath && !this.candidates.some((file) => file.path === this.selectedPath)) {
      this.select(null);
    } else {
      this.select(this.selectedPath);
    }
  }

  private select(path: string | null): void {
    this.selectedPath = path;
    for (const row of this.listEl.querySelectorAll<HTMLElement>(".novelview-link-import-file")) {
      row.toggleClass("is-selected", row.dataset.path === path);
    }
    const enabled = !!path;
    this.aliasInput.disabled = !enabled;
    if (enabled) {
      this.aliasInput.focus();
    }
  }

  private confirmSelected(): void {
    if (!this.selectedPath) {
      return;
    }
    const path = this.selectedPath;
    const aliases = this.aliasInput.value
      .split(/[,，;；\\n]/u)
      .map((alias) => alias.trim())
      .filter(Boolean);
    const index = this.candidates.findIndex((candidate) => candidate.path === path);
    if (index >= 0) {
      this.candidates.splice(index, 1);
    }
    this.onImport(path, aliases);
    this.selectedPath = null;
    this.aliasInput.value = "";
    this.aliasInput.disabled = true;
    this.renderTree();
    if (this.candidates.length === 0) {
      this.close();
    }
  }
}
