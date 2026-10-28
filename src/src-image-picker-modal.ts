import {
  App,
  Modal,
  type TFile,
} from "obsidian";

export class SrcImagePickerModal extends Modal {
  private readonly files: TFile[];
  private readonly onChoose: (file: TFile) => void;

  constructor(app: App, files: TFile[], onChoose: (file: TFile) => void) {
    super(app);
    this.files = files;
    this.onChoose = onChoose;
  }

  override onOpen(): void {
    this.setTitle("从素材库选择图片");
    this.modalEl.addClass("novelview-src-picker-modal");
    this.contentEl.empty();

    const grid = this.contentEl.createDiv({
      cls: "novelview-src-picker-grid",
    });
    for (const file of this.files) {
      const card = grid.createEl("button", {
        cls: "novelview-src-picker-card",
        attr: {
          type: "button",
          title: file.path,
        },
      });
      const preview = card.createDiv({
        cls: "novelview-src-picker-preview",
      });
      const image = preview.createEl("img", {
        attr: {
          src: this.app.vault.getResourcePath(file),
          alt: file.basename,
        },
      });
      image.setAttr("loading", "lazy");
      card.createSpan({
        cls: "novelview-src-picker-name",
        text: file.name,
      });
      card.addEventListener("click", () => {
        this.close();
        this.onChoose(file);
      });
    }
  }

  override onClose(): void {
    this.contentEl.empty();
  }
}
