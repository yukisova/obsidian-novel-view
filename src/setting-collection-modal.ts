import { App, Modal } from "obsidian";

const TAG_COLORS = [
  "#e74c3c",
  "#e67e22",
  "#f1c40f",
  "#2ecc71",
  "#3498db",
  "#9b59b6",
];

type ErrorSetter = (message: string) => void;

export class SettingGroupModal extends Modal {
  constructor(
    app: App,
    private readonly title: string,
    private readonly initial: string,
    private readonly validate: (value: string, setError: ErrorSetter) => Promise<boolean>,
    private readonly placeholder = "设定组名称",
  ) {
    super(app);
  }

  onOpen(): void {
    this.setTitle(this.title);
    this.modalEl.addClass("novelview-setting-modal");
    this.contentEl.empty();
    const input = this.contentEl.createEl("input", {
      cls: "novelview-setting-modal-input",
      attr: { type: "text", placeholder: this.placeholder, value: this.initial },
    });
    const error = this.contentEl.createDiv({ cls: "novelview-setting-modal-error" });
    const buttons = this.contentEl.createDiv({ cls: "modal-button-container" });
    buttons.createEl("button", { text: "取消", attr: { type: "button" } })
      .addEventListener("click", () => this.close());
    const submit = buttons.createEl("button", {
      cls: "mod-cta",
      text: "确定",
      attr: { type: "button" },
    });
    const finish = async (): Promise<void> => {
      const value = input.value.trim();
      if (!value) {
        error.setText("名称不能为空。");
        input.focus();
        return;
      }
      submit.disabled = true;
      try {
        if (await this.validate(value, (message) => error.setText(message))) {
          this.close();
        }
      } finally {
        submit.disabled = false;
      }
    };
    submit.addEventListener("click", () => void finish());
    input.addEventListener("keydown", (event) => {
      if (event.key === "Enter") {
        event.preventDefault();
        void finish();
      }
    });
    window.setTimeout(() => {
      input.focus();
      input.select();
    }, 0);
  }

  onClose(): void {
    this.contentEl.empty();
  }
}

export class SettingTagModal extends Modal {
  constructor(
    app: App,
    private readonly title: string,
    private readonly initialName: string,
    private readonly initialColor: string,
    private readonly validate: (
      name: string,
      color: string,
      setError: ErrorSetter,
    ) => Promise<boolean>,
  ) {
    super(app);
  }

  onOpen(): void {
    this.setTitle(this.title);
    this.modalEl.addClass("novelview-setting-modal");
    this.contentEl.empty();
    const name = this.contentEl.createEl("input", {
      cls: "novelview-setting-modal-input",
      attr: { type: "text", placeholder: "标签名称", value: this.initialName },
    });
    const color = this.contentEl.createEl("input", {
      cls: "novelview-setting-modal-color",
      attr: { type: "color", value: this.initialColor },
    });
    const swatches = this.contentEl.createDiv({ cls: "novelview-setting-modal-swatches" });
    for (const value of TAG_COLORS) {
      const swatch = swatches.createEl("button", {
        cls: "novelview-setting-modal-swatch",
        attr: { type: "button", "aria-label": value, title: value },
      });
      swatch.setCssProps({ "--novelview-setting-swatch": value });
      swatch.addEventListener("click", () => {
        color.value = value;
      });
    }
    const error = this.contentEl.createDiv({ cls: "novelview-setting-modal-error" });
    const buttons = this.contentEl.createDiv({ cls: "modal-button-container" });
    buttons.createEl("button", { text: "取消", attr: { type: "button" } })
      .addEventListener("click", () => this.close());
    const submit = buttons.createEl("button", {
      cls: "mod-cta",
      text: "确定",
      attr: { type: "button" },
    });
    const finish = async (): Promise<void> => {
      const value = name.value.trim();
      if (!value) {
        error.setText("标签名称不能为空。");
        name.focus();
        return;
      }
      submit.disabled = true;
      try {
        if (await this.validate(value, color.value, (message) => error.setText(message))) {
          this.close();
        }
      } finally {
        submit.disabled = false;
      }
    };
    submit.addEventListener("click", () => void finish());
    name.addEventListener("keydown", (event) => {
      if (event.key === "Enter") {
        event.preventDefault();
        void finish();
      }
    });
    window.setTimeout(() => {
      name.focus();
      name.select();
    }, 0);
  }

  onClose(): void {
    this.contentEl.empty();
  }
}

export class SettingRecordModal extends Modal {
  constructor(
    app: App,
    private readonly title: string,
    private readonly initialKeyword: string,
    private readonly initialContent: string,
    private readonly validate: (
      keyword: string,
      content: string,
      setError: ErrorSetter,
    ) => Promise<boolean>,
  ) {
    super(app);
  }

  onOpen(): void {
    this.setTitle(this.title);
    this.modalEl.addClass("novelview-setting-modal");
    this.contentEl.empty();
    const keyword = this.contentEl.createEl("input", {
      cls: "novelview-setting-modal-input",
      attr: { type: "text", placeholder: "记录关键词", value: this.initialKeyword },
    });
    const content = this.contentEl.createEl("textarea", {
      cls: "novelview-setting-modal-textarea",
      attr: { placeholder: "记录简介", rows: "4" },
    });
    content.value = this.initialContent;
    const error = this.contentEl.createDiv({ cls: "novelview-setting-modal-error" });
    const buttons = this.contentEl.createDiv({ cls: "modal-button-container" });
    buttons.createEl("button", { text: "取消", attr: { type: "button" } })
      .addEventListener("click", () => this.close());
    const submit = buttons.createEl("button", {
      cls: "mod-cta",
      text: "确定",
      attr: { type: "button" },
    });
    const finish = async (): Promise<void> => {
      const value = keyword.value.trim();
      if (!value) {
        error.setText("关键词不能为空。");
        keyword.focus();
        return;
      }
      submit.disabled = true;
      try {
        if (await this.validate(value, content.value.trim(), (message) => error.setText(message))) {
          this.close();
        }
      } finally {
        submit.disabled = false;
      }
    };
    submit.addEventListener("click", () => void finish());
    keyword.addEventListener("keydown", (event) => {
      if (event.key === "Enter" && !event.shiftKey) {
        event.preventDefault();
        void finish();
      }
    });
    window.setTimeout(() => {
      keyword.focus();
      keyword.select();
    }, 0);
  }

  onClose(): void {
    this.contentEl.empty();
  }
}

export class SettingConfirmModal extends Modal {
  constructor(
    app: App,
    private readonly title: string,
    private readonly message: string,
    private readonly confirmLabel: string,
    private readonly onConfirm: () => void | Promise<void>,
  ) {
    super(app);
  }

  onOpen(): void {
    this.setTitle(this.title);
    this.modalEl.addClass("novelview-setting-modal");
    this.contentEl.empty();
    this.contentEl.createEl("p", { text: this.message });
    const buttons = this.contentEl.createDiv({ cls: "modal-button-container" });
    buttons.createEl("button", { text: "取消", attr: { type: "button" } })
      .addEventListener("click", () => this.close());
    buttons.createEl("button", {
      cls: "mod-warning",
      text: this.confirmLabel,
      attr: { type: "button" },
    }).addEventListener("click", () => {
      this.close();
      void this.onConfirm();
    });
  }

  onClose(): void {
    this.contentEl.empty();
  }
}
