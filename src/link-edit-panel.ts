import {
  LINK_STYLE_LABELS,
  type LinkHighlightStyle,
} from "./core/link-library";

export const LINK_PRESET_COLORS = [
  ["红", "#e5484d"],
  ["橙", "#f76b15"],
  ["黄", "#e2a300"],
  ["绿", "#30a46c"],
  ["蓝", "#0091ff"],
  ["紫", "#8e4ec6"],
] as const;

export type LinkEditMode = "group" | "file" | "batch-tag";

export interface LinkEditValue {
  style?: LinkHighlightStyle;
  tag?: string;
  color?: string;
  aliases?: string[];
}

export class LinkEditPanel {
  private readonly root: HTMLElement;
  private readonly onSave: (value: LinkEditValue) => void;
  private readonly onClose: () => void;
  private readonly mode: LinkEditMode;
  private styleValue: LinkHighlightStyle;
  private colorValue: string;
  private tagValue: string;
  private aliasesValue: string;
  private colorInput: HTMLInputElement | null = null;
  private tagInput: HTMLInputElement | null = null;
  private aliasInput: HTMLTextAreaElement | null = null;

  constructor(
    mode: LinkEditMode,
    title: string,
    initial: LinkEditValue,
    onSave: (value: LinkEditValue) => void,
    onClose: () => void,
  ) {
    this.mode = mode;
    this.onSave = onSave;
    this.onClose = onClose;
    this.styleValue = initial.style ?? "normal";
    this.colorValue = initial.color ?? "#9a5a2d";
    this.tagValue = initial.tag ?? "";
    this.aliasesValue = (initial.aliases ?? []).join("\n");
    this.root = createEl("div", { cls: "novelview-link-edit-panel" });
    this.root.setAttr("role", "dialog");
    this.root.setAttr("aria-label", title);

    const header = this.root.createDiv({ cls: "novelview-link-edit-header" });
    header.createSpan({ text: title });
    const close = header.createEl("button", {
      attr: { type: "button", "aria-label": "关闭" },
      text: "×",
    });
    close.addEventListener("click", () => this.close());

    if (mode === "group") {
      this.renderGroup();
    } else {
      this.renderFile(mode === "batch-tag");
    }

    const footer = this.root.createDiv({ cls: "novelview-link-edit-footer" });
    footer.createEl("button", { text: "取消", attr: { type: "button" } })
      .addEventListener("click", () => this.close());
    footer.createEl("button", {
      cls: "mod-cta",
      text: "保存",
      attr: { type: "button" },
    }).addEventListener("click", () => this.submit());

    document.body.appendChild(this.root);
  }

  close(): void {
    this.root.remove();
    this.onClose();
  }

  private renderGroup(): void {
    const field = this.root.createDiv({ cls: "novelview-link-edit-field" });
    field.createEl("label", { text: "高亮字体样式" });
    const select = field.createEl("select");
    for (const style of Object.keys(LINK_STYLE_LABELS) as LinkHighlightStyle[]) {
      select.createEl("option", {
        text: LINK_STYLE_LABELS[style],
        attr: { value: style },
      });
    }
    select.value = this.styleValue;
    select.addEventListener("change", () => {
      this.styleValue = select.value as LinkHighlightStyle;
    });
  }

  private renderFile(batchTag: boolean): void {
    if (batchTag || this.mode === "file") {
      this.renderTagFields(!batchTag);
    }
    if (!batchTag) {
      const aliasField = this.root.createDiv({ cls: "novelview-link-edit-field" });
      aliasField.createEl("label", { text: "别名（逗号或换行分隔）" });
      this.aliasInput = aliasField.createEl("textarea", { attr: { rows: "3" } });
      this.aliasInput.value = this.aliasesValue;
    }
  }

  private renderTagFields(withAliases: boolean): void {
    const tagField = this.root.createDiv({ cls: "novelview-link-edit-field" });
    tagField.createEl("label", { text: "联动标签（可选）" });
    this.tagInput = tagField.createEl("input", { attr: { type: "text" } });
    this.tagInput.value = this.tagValue;
    this.tagInput.addEventListener("input", () => {
      this.tagValue = this.tagInput?.value.trim() ?? "";
    });

    const colorField = this.root.createDiv({ cls: "novelview-link-edit-field" });
    colorField.createEl("label", { text: "高亮颜色" });
    const swatches = colorField.createDiv({ cls: "novelview-link-color-swatches" });
    for (const [label, color] of LINK_PRESET_COLORS) {
      const button = swatches.createEl("button", {
        cls: "novelview-link-color-swatch",
        attr: { type: "button", title: label, "aria-label": label },
      });
      button.setAttr("style", `background-color:${color};`);
      button.addEventListener("click", () => {
        this.colorValue = color;
        if (this.colorInput) {
          this.colorInput.value = color;
        }
        this.updateSwatches(swatches);
      });
    }
    const custom = colorField.createEl("input", {
      attr: { type: "color", "aria-label": "自定义颜色" },
    });
    custom.value = this.colorValue;
    this.colorInput = custom;
    custom.addEventListener("input", () => {
      this.colorValue = custom.value;
      this.updateSwatches(swatches);
    });
    this.updateSwatches(swatches);
    if (withAliases) {
      // alias field follows
    }
  }

  private updateSwatches(container: HTMLElement): void {
    for (const button of container.querySelectorAll<HTMLElement>(".novelview-link-color-swatch")) {
      const color = button.getAttribute("style") ?? "";
      button.toggleClass(
        "is-active",
        color.toLowerCase().includes(this.colorValue.toLowerCase()),
      );
    }
  }

  private submit(): void {
    const aliases = (this.aliasInput?.value ?? this.aliasesValue)
      .split(/[,，;；\n]/u)
      .map((alias) => alias.trim())
      .filter(Boolean);
    this.onSave({
      style: this.styleValue,
      tag: (this.tagInput?.value ?? this.tagValue).trim(),
      color: this.colorValue,
      aliases,
    });
    this.close();
  }
}
