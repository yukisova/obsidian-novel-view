import {
  App,
  Modal,
} from "obsidian";
import type { OutlineLevel } from "./core/outline";

export interface OutlineCardModalOptions {
  level: OutlineLevel;
  title: string;
  body: string;
  onSubmit: (body: string) => void;
}

export class OutlineCardModal extends Modal {
  private readonly options: OutlineCardModalOptions;
  private textarea: HTMLTextAreaElement | null = null;

  constructor(app: App, options: OutlineCardModalOptions) {
    super(app);
    this.options = options;
  }

  override onOpen(): void {
    this.setTitle(this.options.level === "volume" ? "卷纲" : "章纲");
    this.modalEl.addClass("novelview-outline-modal");
    this.contentEl.empty();

    const card = this.contentEl.createDiv({
      cls: "novelview-outline-card",
    });
    card.createDiv({
      cls: "novelview-outline-card-level",
      text: this.options.level === "volume" ? "卷纲" : "章纲",
    });
    card.createDiv({
      cls: "novelview-outline-card-title",
      text: this.options.title,
    });
    card.createDiv({
      cls: "novelview-outline-card-hint",
      text: "详细内容会写入小说组的 大纲.md，可在工作台“大纲”卡片查看。",
    });

    this.textarea = card.createEl("textarea", {
      cls: "novelview-outline-card-textarea",
      attr: {
        "aria-label": "大纲详细内容",
        placeholder: "写下这一章/卷的剧情走向、冲突、转折……",
        rows: "10",
      },
    });
    this.textarea.value = this.options.body;

    const buttons = this.contentEl.createDiv({
      cls: "modal-button-container",
    });
    buttons.createEl("button", {
      text: "取消",
      attr: { type: "button" },
    }).addEventListener("click", () => this.close());
    buttons.createEl("button", {
      cls: "mod-cta",
      text: "保存大纲",
      attr: { type: "button" },
    }).addEventListener("click", () => this.submit());

    window.setTimeout(() => this.textarea?.focus(), 0);
  }

  override onClose(): void {
    this.contentEl.empty();
  }

  private submit(): void {
    const body = this.textarea?.value ?? "";
    this.close();
    this.options.onSubmit(body);
  }
}
