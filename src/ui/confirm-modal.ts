import {
  App,
  Modal,
} from "obsidian";

/** 弹出确认框并返回用户选择 */
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

  /** 初始化确认框的文案与回调 */
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

  /** 渲染提示信息与确认按钮 */
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

  /** 关闭时未选择按取消处理 */
  override onClose(): void {
    this.contentEl.empty();
    if (!this.settled) {
      this.settled = true;
      this.resolve(false);
    }
  }

  /** 记录选择结果并关闭弹窗 */
  private finish(confirmed: boolean): void {
    if (this.settled) {
      return;
    }
    this.settled = true;
    this.resolve(confirmed);
    this.close();
  }
}
