import { App, Modal, setIcon } from "obsidian";

export interface VolumeEditOptions {
  folderPath: string;
  volume: string;
  description: string;
  coverUrl: string | null;
  onSave: (description: string) => void;
  onPickCover: () => void;
}

export class VolumeEditModal extends Modal {
  private readonly options: VolumeEditOptions;
  private descriptionValue: string;

  constructor(app: App, options: VolumeEditOptions) {
    super(app);
    this.options = options;
    this.descriptionValue = options.description;
  }

  override onOpen(): void {
    this.contentEl.empty();
    this.contentEl.addClass("novelview-volume-edit-modal");
    this.titleEl.setText(`编辑卷 · ${this.options.volume}`);
    const cover = this.contentEl.createDiv({ cls: "novelview-volume-edit-cover" });
    if (this.options.coverUrl) {
      cover.createEl("img", {
        attr: {
          src: this.options.coverUrl,
          alt: `${this.options.volume} 海报`,
        },
      });
    } else {
      const placeholder = cover.createSpan();
      setIcon(placeholder, "image");
    }
    this.contentEl.createEl("button", {
      cls: "novelview-volume-edit-cover-button",
      text: "选择卷海报",
      attr: { type: "button" },
    }).addEventListener("click", () => {
      this.close();
      this.options.onPickCover();
    });
    const field = this.contentEl.createDiv({ cls: "novelview-link-edit-field" });
    field.createEl("label", { text: "卷描述" });
    const input = field.createEl("textarea", {
      attr: { rows: "5", placeholder: "填写这一卷的简介" },
    });
    input.value = this.options.description;
    input.addEventListener("input", () => {
      this.descriptionValue = input.value.trim();
    });
    const actions = this.contentEl.createDiv({ cls: "novelview-article-group-actions" });
    actions.createEl("button", { text: "取消", attr: { type: "button" } })
      .addEventListener("click", () => this.close());
    actions.createEl("button", {
      cls: "mod-cta",
      text: "保存",
      attr: { type: "button" },
    }).addEventListener("click", () => {
      this.options.onSave(this.descriptionValue);
      this.close();
    });
  }

  override onClose(): void {
    this.contentEl.empty();
  }
}
