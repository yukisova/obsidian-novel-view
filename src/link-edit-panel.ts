export type LinkEditPanelMode = "group" | "file";

export class LinkEditPanel {
  private readonly root: HTMLElement;
  private readonly onSave: (value: string) => void;
  private readonly onClose: () => void;
  private readonly input: HTMLInputElement | HTMLTextAreaElement;
  private closed = false;

  constructor(
    mode: LinkEditPanelMode,
    title: string,
    initialValue: string,
    onSave: (value: string) => void,
    onClose: () => void,
  ) {
    this.onSave = onSave;
    this.onClose = onClose;
    this.root = createEl("div", { cls: "novelview-link-edit-panel" });
    this.root.setAttr("role", "dialog");
    this.root.setAttr("aria-label", mode === "group" ? "编辑联动组" : "编辑联动文件");

    const header = this.root.createDiv({ cls: "novelview-link-edit-header" });
    header.createSpan({ text: mode === "group" ? "编辑联动组" : "编辑联动文件" });
    const close = header.createEl("button", {
      attr: { type: "button", "aria-label": "关闭" },
      text: "×",
    });
    close.addEventListener("click", () => this.close());

    this.root.createDiv({
      cls: "novelview-link-edit-title",
      text: title,
    });

    if (mode === "group") {
      const field = this.root.createDiv({ cls: "novelview-link-edit-field" });
      field.createEl("label", { text: "关键词高亮颜色" });
      const color = field.createEl("input", {
        attr: { type: "color" },
      });
      color.value = initialValue || "#9a5a2d";
      this.input = color;
    } else {
      const field = this.root.createDiv({ cls: "novelview-link-edit-field" });
      field.createEl("label", { text: "别名（逗号或换行分隔）" });
      const aliases = field.createEl("textarea", { attr: { rows: "4" } });
      aliases.value = initialValue;
      this.input = aliases;
    }

    const footer = this.root.createDiv({ cls: "novelview-link-edit-footer" });
    footer.createEl("button", { text: "取消", attr: { type: "button" } })
      .addEventListener("click", () => this.close());
    footer.createEl("button", {
      cls: "mod-cta",
      text: "保存",
      attr: { type: "button" },
    }).addEventListener("click", () => this.submit());

    this.input.addEventListener("keydown", (event: Event) => {
      const key = (event as KeyboardEvent).key;
      if (key === "Escape") {
        event.preventDefault();
        this.close();
      }
      if (mode === "group" && key === "Enter") {
        event.preventDefault();
        this.submit();
      }
    });
    document.body.appendChild(this.root);
    window.setTimeout(() => this.input.focus(), 0);
  }

  close(): void {
    if (this.closed) {
      return;
    }
    this.closed = true;
    this.root.remove();
    this.onClose();
  }

  private submit(): void {
    this.onSave(this.input.value.trim());
    this.close();
  }
}
