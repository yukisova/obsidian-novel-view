import {
  App,
  Modal,
} from "obsidian";

export interface TextPromptOptions {
  title: string;
  description?: string;
  placeholder?: string;
  submitLabel?: string;
  initialValue?: string;
  onSubmit: (value: string) => void;
}

export class TextPromptModal extends Modal {
  private readonly options: TextPromptOptions;
  private input: HTMLInputElement | null = null;
  private errorEl: HTMLElement | null = null;

  constructor(app: App, options: TextPromptOptions) {
    super(app);
    this.options = options;
  }

  override onOpen(): void {
    this.setTitle(this.options.title);
    this.modalEl.addClass("novelview-text-prompt-modal");
    this.contentEl.empty();

    if (this.options.description) {
      this.contentEl.createEl("p", {
        cls: "novelview-text-prompt-description",
        text: this.options.description,
      });
    }

    this.input = this.contentEl.createEl("input", {
      cls: "novelview-text-prompt-input",
      attr: {
        type: "text",
        placeholder: this.options.placeholder ?? "",
        "aria-label": this.options.title,
      },
    });
    this.input.value = this.options.initialValue ?? "";

    this.errorEl = this.contentEl.createDiv({
      cls: "novelview-text-prompt-error",
    });

    const buttons = this.contentEl.createDiv({
      cls: "modal-button-container",
    });
    buttons.createEl("button", {
      text: "取消",
      attr: { type: "button" },
    }).addEventListener("click", () => this.close());

    buttons.createEl("button", {
      cls: "mod-cta",
      text: this.options.submitLabel ?? "创建",
      attr: { type: "button" },
    }).addEventListener("click", () => this.submit());

    this.input.addEventListener("keydown", (event) => {
      if (event.key === "Enter") {
        event.preventDefault();
        this.submit();
      }
    });

    window.setTimeout(() => {
      this.input?.focus();
      this.input?.select();
    }, 0);
  }

  override onClose(): void {
    this.contentEl.empty();
  }

  private submit(): void {
    const value = this.input?.value.trim() ?? "";
    if (!value) {
      if (this.errorEl) {
        this.errorEl.setText("请输入名称。");
      }
      this.input?.focus();
      return;
    }

    this.close();
    this.options.onSubmit(value);
  }
}
