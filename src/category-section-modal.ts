import {
  App,
  Modal,
} from "obsidian";
import {
  REFERENCE_CATEGORY_LABELS,
  type ReferenceCategory,
} from "./core/cards";
import { CATEGORY_FILE_NAMES } from "./core/category-file";

export class CategorySectionModal extends Modal {
  private readonly category: ReferenceCategory;
  private readonly onSubmit: (heading: string, keywords: string[]) => void;
  private headingInput: HTMLInputElement | null = null;
  private keywordInput: HTMLInputElement | null = null;
  private errorEl: HTMLElement | null = null;

  constructor(
    app: App,
    category: ReferenceCategory,
    onSubmit: (heading: string, keywords: string[]) => void,
  ) {
    super(app);
    this.category = category;
    this.onSubmit = onSubmit;
  }

  override onOpen(): void {
    const label = REFERENCE_CATEGORY_LABELS[this.category];
    this.setTitle(`新增${label}`);
    this.modalEl.addClass("novelview-category-modal");
    this.contentEl.empty();

    this.contentEl.createEl("p", {
      cls: "novelview-category-description",
      text: `将写入当前小说组的 ${CATEGORY_FILE_NAMES[this.category]}，以 h1 标题分隔条目。`,
    });

    const headingField = this.contentEl.createDiv({
      cls: "novelview-category-field",
    });
    headingField.createEl("label", {
      cls: "novelview-category-label",
      text: "标题",
    });
    this.headingInput = headingField.createEl("input", {
      cls: "novelview-category-input",
      attr: {
        type: "text",
        placeholder: `例如：${this.category === "character" ? "沈砚" : "旧城地图"}`,
        "aria-label": "标题",
      },
    });

    const keywordField = this.contentEl.createDiv({
      cls: "novelview-category-field",
    });
    keywordField.createEl("label", {
      cls: "novelview-category-label",
      text: "关键词（可选，用顿号或逗号分隔）",
    });
    this.keywordInput = keywordField.createEl("input", {
      cls: "novelview-category-input",
      attr: {
        type: "text",
        placeholder: "例如：旧城、地图",
        "aria-label": "关键词",
      },
    });

    this.errorEl = this.contentEl.createDiv({
      cls: "novelview-category-error",
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
      text: "新增",
      attr: { type: "button" },
    }).addEventListener("click", () => this.submit());

    this.headingInput.addEventListener("keydown", (event) => {
      if (event.key === "Enter") {
        event.preventDefault();
        this.submit();
      }
    });

    window.setTimeout(() => this.headingInput?.focus(), 0);
  }

  override onClose(): void {
    this.contentEl.empty();
  }

  private submit(): void {
    const heading = this.headingInput?.value.trim() ?? "";
    if (!heading) {
      if (this.errorEl) {
        this.errorEl.setText("请输入标题。");
      }
      this.headingInput?.focus();
      return;
    }

    const keywords = (this.keywordInput?.value ?? "")
      .split(/[,，、;；]/u)
      .map((keyword) => keyword.trim())
      .filter(Boolean);

    this.close();
    this.onSubmit(heading, keywords);
  }
}
