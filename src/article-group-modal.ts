import { App, Modal } from "obsidian";

export interface ArticleGroupDraft {
  name: string;
  description: string;
}

export class ArticleGroupModal extends Modal {
  private readonly initial: ArticleGroupDraft;
  private readonly onSave: (draft: ArticleGroupDraft) => void;
  private readonly title: string;
  private nameValue: string;
  private descriptionValue: string;

  constructor(
    app: App,
    initial: ArticleGroupDraft,
    onSave: (draft: ArticleGroupDraft) => void,
    title = "归入文章组",
  ) {
    super(app);
    this.title = title;
    this.initial = initial;
    this.onSave = onSave;
    this.nameValue = initial.name;
    this.descriptionValue = initial.description;
  }

  override onOpen(): void {
    this.contentEl.empty();
    this.contentEl.addClass("novelview-article-group-modal");
    this.titleEl.setText(this.title);
    const nameField = this.contentEl.createDiv({ cls: "novelview-link-edit-field" });
    nameField.createEl("label", { text: "文章组名称" });
    const name = nameField.createEl("input", {
      attr: { type: "text", placeholder: "例如：第一部分" },
    });
    name.value = this.initial.name;
    name.addEventListener("input", () => {
      this.nameValue = name.value.trim();
    });
    const descField = this.contentEl.createDiv({ cls: "novelview-link-edit-field" });
    descField.createEl("label", { text: "文章组描述" });
    const description = descField.createEl("textarea", {
      attr: { rows: "4", placeholder: "概括这组文章的内容" },
    });
    description.value = this.initial.description;
    description.addEventListener("input", () => {
      this.descriptionValue = description.value.trim();
    });
    const actions = this.contentEl.createDiv({ cls: "novelview-article-group-actions" });
    actions.createEl("button", { text: "取消", attr: { type: "button" } })
      .addEventListener("click", () => this.close());
    actions.createEl("button", {
      cls: "mod-cta",
      text: "保存",
      attr: { type: "button" },
    }).addEventListener("click", () => {
      if (!this.nameValue) {
        return;
      }
      this.onSave({
        name: this.nameValue,
        description: this.descriptionValue,
      });
      this.close();
    });
    name.focus();
  }

  override onClose(): void {
    this.contentEl.empty();
  }
}
