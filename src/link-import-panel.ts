export interface LinkImportCandidate {
  path: string;
  label: string;
}

function fileName(path: string): string {
  return path.split("/").pop() ?? path;
}

export class LinkImportPanel {
  private readonly root: HTMLElement;
  private readonly listEl: HTMLElement;
  private readonly filterInput: HTMLInputElement;
  private candidates: LinkImportCandidate[];
  private selectedPath: string | null = null;
  private closed = false;
  private readonly existingNames: Set<string>;
  private readonly existingAliases: Set<string>;
  private readonly onImport: (path: string, aliases: string[]) => void;
  private readonly onClose: () => void;

  constructor(
    candidates: LinkImportCandidate[],
    existingPaths: Set<string>,
    existingNames: Set<string>,
    existingAliases: Set<string>,
    onImport: (path: string, aliases: string[]) => void,
    onClose: () => void,
  ) {
    this.candidates = candidates.filter(
      (candidate) => !existingPaths.has(candidate.path),
    );
    this.existingNames = new Set([...existingNames].map((name) => name.toLowerCase()));
    this.existingAliases = new Set([...existingAliases].map((name) => name.toLowerCase()));
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

    this.filterInput = this.root.createEl("input", {
      cls: "novelview-link-import-filter",
      attr: {
        type: "text",
        placeholder: "筛选文件",
        "aria-label": "筛选联动文件",
      },
    });
    this.filterInput.addEventListener("input", () => {
      this.renderTree(this.filterInput.value);
    });
    this.listEl = this.root.createDiv({ cls: "novelview-link-import-tree" });
    this.renderTree("");
    document.body.appendChild(this.root);
    window.setTimeout(() => this.filterInput.focus(), 0);
  }

  close(): void {
    if (this.closed) {
      return;
    }
    this.closed = true;
    this.root.remove();
    this.onClose();
  }

  private renderTree(query: string): void {
    this.listEl.empty();
    const needle = query.trim().toLowerCase();
    const visible = this.candidates.filter((candidate) => {
      if (!needle) {
        return true;
      }
      return fileName(candidate.path).toLowerCase().includes(needle)
        || candidate.path.toLowerCase().includes(needle);
    });
    if (visible.length === 0) {
      this.listEl.createDiv({
        cls: "novelview-link-import-empty",
        text: this.candidates.length === 0
          ? "没有可导入的仓库文件。"
          : "没有匹配的文件。",
      });
      this.selectedPath = null;
      return;
    }
    const folders = new Map<string, LinkImportCandidate[]>();
    for (const candidate of visible) {
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
        row.createSpan({
          cls: "novelview-link-import-file-name",
          text: fileName(file.path),
        });
        row.createSpan({ cls: "novelview-link-import-file-path", text: file.label });
        row.dataset.path = file.path;
        row.addEventListener("click", () => this.select(file.path));
        row.addEventListener("dblclick", (event) => {
          event.preventDefault();
          this.select(file.path);
          this.attemptImport(file.path);
        });
        if (this.selectedPath === file.path) {
          row.addClass("is-selected");
        }
      }
    }
    if (
      this.selectedPath
      && !visible.some((file) => file.path === this.selectedPath)
    ) {
      this.selectedPath = null;
    }
  }

  private select(path: string | null): void {
    this.selectedPath = path;
    for (const row of this.listEl.querySelectorAll<HTMLElement>(".novelview-link-import-file")) {
      row.toggleClass("is-selected", row.dataset.path === path);
    }
  }

  private attemptImport(path: string): void {
    const name = fileName(path).toLowerCase();
    if (this.existingNames.has(name) || this.existingAliases.has(name)) {
      this.showAliasPrompt(path);
      return;
    }
    this.finalize(path, []);
  }

  private showAliasPrompt(path: string): void {
    this.root.querySelector(".novelview-link-import-alias-prompt")?.remove();
    const prompt = this.root.createDiv({ cls: "novelview-link-import-alias-prompt" });
    prompt.createDiv({
      cls: "novelview-link-import-alias-label",
      text: "文件名与已有文件或别名重复，请输入新别名",
    });
    const input = prompt.createEl("input", {
      cls: "novelview-link-import-alias",
      attr: {
        type: "text",
        placeholder: "必填别名",
        "aria-label": "联动文件别名",
      },
    });
    const error = prompt.createDiv({ cls: "novelview-link-import-error" });
    const confirm = prompt.createEl("button", {
      cls: "mod-cta",
      text: "确认别名",
      attr: { type: "button" },
    });
    confirm.addEventListener("click", () => {
      const alias = input.value.trim();
      if (!alias) {
        error.setText("请输入别名。");
        input.focus();
        return;
      }
      const normalized = alias.toLowerCase();
      if (
        this.existingAliases.has(normalized)
        || this.existingNames.has(normalized)
      ) {
        error.setText("该别名已存在，请重新输入。");
        input.focus();
        return;
      }
      this.finalize(path, [alias]);
    });
    input.focus();
  }

  private finalize(path: string, aliases: string[]): void {
    const candidate = this.candidates.find((entry) => entry.path === path);
    const index = this.candidates.findIndex((entry) => entry.path === path);
    if (index >= 0) {
      this.candidates.splice(index, 1);
    }
    this.existingNames.add(fileName(path).toLowerCase());
    for (const alias of aliases) {
      this.existingAliases.add(alias.toLowerCase());
    }
    this.root.querySelector(".novelview-link-import-alias-prompt")?.remove();
    this.onImport(path, aliases);
    this.selectedPath = null;
    void candidate;
    this.renderTree(this.filterInput.value);
    if (this.candidates.length === 0) {
      this.close();
    }
  }
}
