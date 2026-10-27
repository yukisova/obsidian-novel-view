import {
  App,
  Modal,
} from "obsidian";

export function confirmAction(
  app: App,
  title: string,
  message: string,
  confirmLabel = "删除",
): Promise<boolean> {
  return new Promise((resolve) => {
    new ConfirmActionModal(app, title, message, confirmLabel, resolve).open();
  });
}

class ConfirmActionModal extends Modal {
  private readonly titleText: string;
  private readonly message: string;
  private readonly confirmLabel: string;
  private readonly resolve: (confirmed: boolean) => void;
  private settled = false;

  constructor(
    app: App,
    title: string,
    message: string,
    confirmLabel: string,
    resolve: (confirmed: boolean) => void,
  ) {
    super(app);
    this.titleText = title;
    this.message = message;
    this.confirmLabel = confirmLabel;
    this.resolve = resolve;
  }

  override onOpen(): void {
    this.setTitle(this.titleText);
    this.contentEl.empty();
    this.contentEl.createEl("p", {
      text: this.message,
    });

    const buttons = this.contentEl.createDiv({
      cls: "modal-button-container",
    });
    buttons.createEl("button", {
      text: "取消",
      attr: { type: "button" },
    }).addEventListener("click", () => this.finish(false));
    buttons.createEl("button", {
      cls: "mod-warning",
      text: this.confirmLabel,
      attr: { type: "button" },
    }).addEventListener("click", () => this.finish(true));
  }

  override onClose(): void {
    this.contentEl.empty();
    if (!this.settled) {
      this.settled = true;
      this.resolve(false);
    }
  }

  private finish(confirmed: boolean): void {
    if (this.settled) {
      return;
    }
    this.settled = true;
    this.resolve(confirmed);
    this.close();
  }
}
