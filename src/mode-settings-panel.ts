export interface ModeSettingsValues {
  fontSize: number;
  lineHeight: number;
  paragraphSpacing: number;
  firstLineIndent: number;
}

export class ModeSettingsPanel {
  private readonly root: HTMLElement;
  private readonly onChange: (values: ModeSettingsValues) => void;
  private readonly values: ModeSettingsValues;

  constructor(
    initial: ModeSettingsValues,
    onChange: (values: ModeSettingsValues) => void,
    onClose: () => void,
  ) {
    this.values = { ...initial };
    this.onChange = onChange;
    this.root = createEl("div", { cls: "novelview-mode-settings" });
    this.root.setAttr("role", "dialog");
    this.root.setAttr("aria-label", "格式设置");
    const header = this.root.createDiv({ cls: "novelview-mode-settings-header" });
    header.createSpan({ text: "格式设置" });
    header.createEl("button", { text: "×", attr: { type: "button" } })
      .addEventListener("click", () => {
        this.root.remove();
        onClose();
      });

    this.slider("字体大小", "fontSize", 12, 28, 1, "px");
    this.slider("行距", "lineHeight", 1.2, 2.4, 0.1, "倍");
    this.slider("段距", "paragraphSpacing", 0, 2, 0.1, "em");
    this.slider("首行缩进", "firstLineIndent", 0, 8, 1, "字符");
    document.body.appendChild(this.root);
  }

  private slider(
    label: string,
    key: keyof ModeSettingsValues,
    min: number,
    max: number,
    step: number,
    unit: string,
  ): void {
    const row = this.root.createDiv({ cls: "novelview-mode-settings-row" });
    const head = row.createDiv({ cls: "novelview-mode-settings-label" });
    head.createSpan({ text: label });
    const valueEl = head.createSpan({ text: `${this.values[key]}${unit}` });
    const input = row.createEl("input", {
      attr: {
        type: "range",
        min: String(min),
        max: String(max),
        step: String(step),
      },
    });
    input.value = String(this.values[key]);
    input.addEventListener("input", () => {
      const value = Number(input.value);
      this.values[key] = key === "lineHeight" || key === "paragraphSpacing"
        ? Math.round(value * 10) / 10
        : Math.round(value);
      valueEl.setText(`${this.values[key]}${unit}`);
      this.onChange({ ...this.values });
    });
  }
}
