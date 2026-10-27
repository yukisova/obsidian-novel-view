import {
  App,
  Modal,
} from "obsidian";

export interface ReplaceConfirmInfo {
  files: number;
  matches: number;
  folderPath: string;
  query: string;
  replacement: string;
  truncated: boolean;
}

export function confirmReplaceAll(
  app: App,
  info: ReplaceConfirmInfo,
): Promise<boolean> {
  return new Promise((resolve) => {
    new ReplaceConfirmModal(app, info, resolve).open();
  });
}

class ReplaceConfirmModal extends Modal {
  private readonly info: ReplaceConfirmInfo;
  private readonly resolve: (confirmed: boolean) => void;
  private settled = false;

  constructor(
    app: App,
    info: ReplaceConfirmInfo,
    resolve: (confirmed: boolean) => void,
  ) {
    super(app);
    this.info = info;
    this.resolve = resolve;
  }

  override onOpen(): void {
    this.setTitle("替换所有匹配？");
    this.modalEl.addClass("novelview-replace-modal");

    const { contentEl } = this;
    contentEl.empty();

    contentEl.createEl("p", {
      cls: "novelview-replace-summary",
      text: `将在“${this.info.folderPath || "Vault 根目录"}”的 ${this.info.files} 个小说文件中替换 ${this.info.matches} 处匹配。`,
    });

    const query = contentEl.createDiv({ cls: "novelview-replace-sample" });
    query.createSpan({ cls: "novelview-replace-sample-label", text: "查找" });
    query.createEl("code", { text: this.info.query });

    const replacement = contentEl.createDiv({ cls: "novelview-replace-sample" });
    replacement.createSpan({
      cls: "novelview-replace-sample-label",
      text: "替换为",
    });
    replacement.createEl("code", {
      text: this.info.replacement || "（空字符串）",
    });

    contentEl.createEl("p", {
      cls: "novelview-replace-warning",
      text: "此操作会直接写入多个 Markdown 文件，无法通过一次编辑器撤销全部恢复。建议先确认查找结果。",
    });

    if (this.info.truncated) {
      contentEl.createEl("p", {
        cls: "novelview-replace-warning",
        text: "当前查找结果被截断，替换只会处理实际扫描到的匹配；请先缩小查找范围。",
      });
    }

    const buttons = contentEl.createDiv({ cls: "modal-button-container" });
    const cancel = buttons.createEl("button", {
      text: "取消",
      attr: { type: "button" },
    });
    cancel.addEventListener("click", () => this.finish(false));

    const confirm = buttons.createEl("button", {
      cls: "mod-warning",
      text: "替换全部",
      attr: { type: "button" },
    });
    confirm.addEventListener("click", () => this.finish(true));
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
