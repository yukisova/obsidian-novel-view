import { App, Modal } from "obsidian";

export class LinkAliasModal extends Modal {
  private readonly description: string;
  private readonly validate: (value: string) => string | null;
  private readonly resolve: (value: string | null) => void;
  private input: HTMLInputElement | null = null;
  private errorEl: HTMLElement | null = null;
  private settled = false;

  constructor(
    app: App,
    description: string,
    validate: (value: string) => string | null,
    resolve: (value: string | null) => void,
  ) {
    super(app);
    this.description = description;
    this.validate = validate;
    this.resolve = resolve;
  }

  override onOpen(): void {
    this.contentEl.empty();
    this.setTitle("该名称已被占用，请输入别名");
    this.contentEl.createEl("p", {
      cls: "novelview-text-prompt-description",
      text: this.description,
    });
    this.input = this.contentEl.createEl("input", {
      cls: "novelview-text-prompt-input",
      attr: { type: "text", placeholder: "必填别名", "aria-label": "联动文件别名" },
    });
    this.errorEl = this.contentEl.createDiv({ cls: "novelview-text-prompt-error" });
    const actions = this.contentEl.createDiv({ cls: "modal-button-container" });
    actions.createEl("button", { text: "取消", attr: { type: "button" } })
      .addEventListener("click", () => this.close());
    actions.createEl("button", {
      cls: "mod-cta",
      text: "确认别名",
      attr: { type: "button" },
    }).addEventListener("click", () => this.submit());
    this.input.addEventListener("keydown", (event) => {
      if (event.key === "Enter") {
        event.preventDefault();
        this.submit();
      }
    });
    window.setTimeout(() => this.input?.focus(), 0);
  }

  private submit(): void {
    const value = this.input?.value.trim() ?? "";
    const error = this.validate(value);
    if (error) {
      this.errorEl?.setText(error);
      this.input?.focus();
      return;
    }
    this.settled = true;
    this.resolve(value);
    this.close();
  }

  override onClose(): void {
    this.contentEl.empty();
    if (!this.settled) {
      this.settled = true;
      this.resolve(null);
    }
  }
}
