export interface ModeSettingsValues {
  fontSize: number;
  lineHeight: number;
  paragraphSpacing: number;
  firstLineIndent: number;
  pageMarginMode: "auto" | "manual";
  pageChars: number;
}

export class ModeSettingsPanel {
  private readonly root: HTMLElement;
  private readonly onChange: (values: ModeSettingsValues) => void;
  private readonly values: ModeSettingsValues;

  private readonly anchor?: HTMLElement;
  private readonly reposition = (): void => {
    this.positionAboveAnchor();
  };

  constructor(
    initial: ModeSettingsValues,
    onChange: (values: ModeSettingsValues) => void,
    onClose: () => void,
    anchor?: HTMLElement,
  ) {
    this.anchor = anchor;
    this.values = { ...initial };
    this.onChange = onChange;
    this.root = createDiv({ cls: "novelview-mode-settings" });
    this.root.setAttr("role", "dialog");
    this.root.setAttr("aria-label", "格式设置");
    const header = this.root.createDiv({ cls: "novelview-mode-settings-header" });
    header.createSpan({ text: "格式设置" });
    header.createEl("button", { text: "×", attr: { type: "button" } })
      .addEventListener("click", () => {
        this.close(onClose);
      });

    this.slider("字体大小", "fontSize", 12, 28, 1, "px");
    this.slider("行距", "lineHeight", 1.2, 2.4, 0.1, "倍");
    this.slider("段距", "paragraphSpacing", 0, 2, 0.1, "em");
    this.slider("首行缩进", "firstLineIndent", 0, 8, 1, "字符");
    this.pageWidth();
    activeDocument.body.appendChild(this.root);
    window.addEventListener("resize", this.reposition);
    window.requestAnimationFrame(() => this.positionAboveAnchor());
  }

  private close(onClose: () => void): void {
    window.removeEventListener("resize", this.reposition);
    this.root.remove();
    onClose();
  }

  private positionAboveAnchor(): void {
    if (!this.anchor) {
      return;
    }
    const rect = this.anchor.getBoundingClientRect();
    const width = this.root.offsetWidth || 300;
    const height = this.root.offsetHeight || 160;
    const left = Math.min(
      window.innerWidth - width - 8,
      Math.max(8, rect.left + rect.width / 2 - width / 2),
    );
    const top = Math.max(8, rect.top - height - 8);
    this.root.style.left = `${left}px`;
    this.root.style.top = `${top}px`;
    this.root.style.transform = "none";
  }

  private pageWidth(): void {
    const row = this.root.createDiv({
      cls: "novelview-mode-settings-row novelview-mode-settings-page-row",
    });
    const head = row.createDiv({ cls: "novelview-mode-settings-label" });
    head.createSpan({ text: "页边距" });
    const autoLabel = row.createEl("label", {
      cls: "novelview-mode-settings-auto",
    });
    const checkbox = autoLabel.createEl("input", {
      attr: { type: "checkbox", "aria-label": "自动适应页边距" },
    });
    checkbox.checked = this.values.pageMarginMode === "auto";
    autoLabel.createSpan({ text: "自动适应" });
    const valueEl = head.createSpan({
      cls: "novelview-mode-settings-page-value",
      text: `${this.values.pageChars} 字`,
    });
    const range = row.createEl("input", {
      cls: "novelview-mode-settings-page-range",
      attr: {
        type: "range",
        min: "24",
        max: "80",
        step: "1",
        "aria-label": "每行字符数",
      },
    });
    range.value = String(this.values.pageChars);
    const sync = (): void => {
      const auto = this.values.pageMarginMode === "auto";
      checkbox.checked = auto;
      range.disabled = auto;
      range.toggleClass("is-hidden", auto);
      valueEl.toggleClass("is-hidden", auto);
    };
    sync();
    checkbox.addEventListener("change", () => {
      this.values.pageMarginMode = checkbox.checked ? "auto" : "manual";
      sync();
      this.onChange({ ...this.values });
    });
    range.addEventListener("input", () => {
      this.values.pageChars = Math.round(Number(range.value) || 42);
      valueEl.setText(`${this.values.pageChars} 字`);
      this.onChange({ ...this.values });
    });
  }

  private slider(
    label: string,
    key: "fontSize" | "lineHeight" | "paragraphSpacing" | "firstLineIndent",
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
