import { App, Modal } from "obsidian";

export class LinkGroupEditModal extends Modal {
  private readonly initialName: string;
  private readonly initialColor: string;
  private readonly onSave: (name: string, color: string) => void;
  private nameInput: HTMLInputElement | null = null;
  private colorInput: HTMLInputElement | null = null;

  constructor(
    app: App,
    initialName: string,
    initialColor: string,
    onSave: (name: string, color: string) => void,
  ) {
    super(app);
    this.initialName = initialName;
    this.initialColor = initialColor;
    this.onSave = onSave;
  }

  override onOpen(): void {
    this.setTitle("编辑联动组");
    this.contentEl.empty();
    const nameField = this.contentEl.createDiv({ cls: "novelview-link-edit-field" });
    nameField.createEl("label", { text: "名称" });
    this.nameInput = nameField.createEl("input", { attr: { type: "text" } });
    this.nameInput.value = this.initialName;
    const colorField = this.contentEl.createDiv({ cls: "novelview-link-edit-field" });
    colorField.createEl("label", { text: "关键词高亮颜色" });
    this.colorInput = colorField.createEl("input", { attr: { type: "color" } });
    this.colorInput.value = this.initialColor;

    const buttons = this.contentEl.createDiv({ cls: "modal-button-container" });
    buttons.createEl("button", { text: "取消", attr: { type: "button" } })
      .addEventListener("click", () => this.close());
    buttons.createEl("button", { cls: "mod-cta", text: "保存", attr: { type: "button" } })
      .addEventListener("click", () => this.submit());
    this.nameInput.addEventListener("keydown", (event) => {
      if (event.key === "Enter") {
        event.preventDefault();
        this.submit();
      }
    });
    window.setTimeout(() => this.nameInput?.select(), 0);
  }

  private submit(): void {
    const name = this.nameInput?.value.trim() ?? "";
    if (!name) {
      return;
    }
    this.close();
    this.onSave(name, this.colorInput?.value || "#9a5a2d");
  }

  override onClose(): void {
    this.contentEl.empty();
  }
}

export class LinkFileEditModal extends Modal {
  private readonly initialName: string;
  private readonly initialAliases: string[];
  private readonly onSave: (name: string, aliases: string[]) => void;
  private nameInput: HTMLInputElement | null = null;
  private aliasInput: HTMLTextAreaElement | null = null;

  constructor(
    app: App,
    initialName: string,
    initialAliases: string[],
    onSave: (name: string, aliases: string[]) => void,
  ) {
    super(app);
    this.initialName = initialName;
    this.initialAliases = initialAliases;
    this.onSave = onSave;
  }

  override onOpen(): void {
    this.setTitle("编辑联动文件");
    this.contentEl.empty();
    const nameField = this.contentEl.createDiv({ cls: "novelview-link-edit-field" });
    nameField.createEl("label", { text: "文件名" });
    this.nameInput = nameField.createEl("input", { attr: { type: "text" } });
    this.nameInput.value = this.initialName;
    const aliasField = this.contentEl.createDiv({ cls: "novelview-link-edit-field" });
    aliasField.createEl("label", { text: "别名（逗号或换行分隔）" });
    this.aliasInput = aliasField.createEl("textarea", {
      attr: { rows: "4" },
    });
    this.aliasInput.value = this.initialAliases.join("\n");

    const buttons = this.contentEl.createDiv({ cls: "modal-button-container" });
    buttons.createEl("button", { text: "取消", attr: { type: "button" } })
      .addEventListener("click", () => this.close());
    buttons.createEl("button", { cls: "mod-cta", text: "保存", attr: { type: "button" } })
      .addEventListener("click", () => this.submit());
    this.nameInput.addEventListener("keydown", (event) => {
      if (event.key === "Enter") {
        event.preventDefault();
        this.submit();
      }
    });
    window.setTimeout(() => this.nameInput?.select(), 0);
  }

  private submit(): void {
    const name = this.nameInput?.value.trim() ?? "";
    if (!name) {
      return;
    }
    const aliases = (this.aliasInput?.value ?? "")
      .split(/[,，;；\n]/u)
      .map((alias) => alias.trim())
      .filter(Boolean);
    this.close();
    this.onSave(name, aliases);
  }

  override onClose(): void {
    this.contentEl.empty();
  }
}
