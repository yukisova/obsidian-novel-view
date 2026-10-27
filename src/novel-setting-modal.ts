import {
  App,
  Modal,
} from "obsidian";
import type { NovelSettingData } from "./core/novel-setting";
import {
  NOVEL_STATES,
  NOVEL_STATE_LABELS,
  type NovelState,
} from "./core/status";

export interface NovelSettingModalOptions {
  initial: NovelSettingData;
  resolveCoverUrl: (cover: string) => string | null;
  onPickCover: () => Promise<string | null>;
  onSave: (data: {
    description: string;
    cover: string;
    state: NovelState;
  }) => Promise<void>;
}

export class NovelSettingModal extends Modal {
  private readonly options: NovelSettingModalOptions;
  private descriptionInput: HTMLTextAreaElement | null = null;
  private coverInput: HTMLInputElement | null = null;
  private stateSelect: HTMLSelectElement | null = null;
  private coverPreview: HTMLElement | null = null;
  private errorEl: HTMLElement | null = null;
  private saving = false;

  constructor(app: App, options: NovelSettingModalOptions) {
    super(app);
    this.options = options;
  }

  override onOpen(): void {
    this.setTitle("编辑小说信息");
    this.modalEl.addClass("novelview-setting-modal");
    this.contentEl.empty();

    const descriptionField = this.createField("小说简介");
    this.descriptionInput = descriptionField.createEl("textarea", {
      cls: "novelview-setting-textarea",
      attr: {
        "aria-label": "小说简介",
        placeholder: "用一两句话介绍这部小说…",
        rows: "4",
      },
    });
    this.descriptionInput.value = this.options.initial.description;

    const stateField = this.createField("小说状态");
    this.stateSelect = stateField.createEl("select", {
      cls: "novelview-setting-select",
      attr: { "aria-label": "小说状态" },
    });
    for (const state of NOVEL_STATES) {
      const option = this.stateSelect.createEl("option", {
        text: NOVEL_STATE_LABELS[state],
        attr: { value: state },
      });
      option.value = state;
    }
    this.stateSelect.value = this.options.initial.state;

    const coverField = this.createField("小说封面");
    const coverRow = coverField.createDiv({
      cls: "novelview-setting-cover-row",
    });
    this.coverInput = coverRow.createEl("input", {
      cls: "novelview-setting-input",
      attr: {
        type: "text",
        "aria-label": "小说封面路径",
        placeholder: "封面图片在 Vault 中的路径",
      },
    });
    this.coverInput.value = this.options.initial.cover;
    this.coverInput.addEventListener("input", () => this.updatePreview());

    const pickButton = coverRow.createEl("button", {
      "text": "选择本地图片",
      "attr": { type: "button" },
    });
    pickButton.addEventListener("click", () => {
      void this.pickCover(pickButton);
    });

    this.coverPreview = coverField.createDiv({
      cls: "novelview-setting-cover-preview",
    });
    this.updatePreview();

    this.errorEl = this.contentEl.createDiv({
      cls: "novelview-setting-error",
    });

    const buttons = this.contentEl.createDiv({
      cls: "modal-button-container",
    });
    const cancel = buttons.createEl("button", {
      text: "取消",
      attr: { type: "button" },
    });
    cancel.addEventListener("click", () => this.close());

    const save = buttons.createEl("button", {
      cls: "mod-cta",
      text: "保存",
      attr: { type: "button" },
    });
    save.addEventListener("click", () => {
      void this.save();
    });

    window.setTimeout(() => this.descriptionInput?.focus(), 0);
  }

  override onClose(): void {
    this.contentEl.empty();
  }

  private createField(label: string): HTMLElement {
    const field = this.contentEl.createDiv({
      cls: "novelview-setting-field",
    });
    field.createEl("label", {
      cls: "novelview-setting-label",
      text: label,
    });
    return field;
  }

  private updatePreview(): void {
    if (!this.coverPreview || !this.coverInput) {
      return;
    }

    this.coverPreview.empty();
    const cover = this.coverInput.value.trim();
    const url = cover ? this.options.resolveCoverUrl(cover) : null;

    if (url) {
      const image = this.coverPreview.createEl("img", {
        cls: "novelview-setting-cover-image",
        attr: {
          src: url,
          alt: "小说封面预览",
        },
      });
      image.addEventListener("error", () => {
        this.coverPreview?.empty();
        this.coverPreview?.setText("封面无法加载，请检查路径。");
      });
      return;
    }

    this.coverPreview.setText(
      cover ? "封面无法加载，请检查路径。" : "尚未选择封面。",
    );
  }

  private async pickCover(button: HTMLButtonElement): Promise<void> {
    button.disabled = true;
    try {
      const path = await this.options.onPickCover();
      if (path && this.coverInput) {
        this.coverInput.value = path;
        this.updatePreview();
      }
    } catch (error) {
      console.error("NovelView: cover selection failed", error);
      if (this.errorEl) {
        this.errorEl.setText("封面选择失败。");
      }
    } finally {
      button.disabled = false;
    }
  }

  private async save(): Promise<void> {
    if (this.saving) {
      return;
    }


    this.saving = true;
    if (this.errorEl) {
      this.errorEl.setText("");
    }

    try {
      await this.options.onSave({
        description: this.descriptionInput?.value.trim() ?? "",
        cover: this.coverInput?.value.trim() ?? "",
        state: (this.stateSelect?.value as NovelState | undefined) ?? "writing",
      });
      this.close();
    } catch (error) {
      console.error("NovelView: failed to save novel settings", error);
      if (this.errorEl) {
        this.errorEl.setText("保存失败，请重试。");
      }
      this.saving = false;
    }
  }
}
