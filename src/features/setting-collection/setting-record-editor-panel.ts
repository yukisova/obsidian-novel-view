import { setIcon } from "obsidian";
import type { SettingField } from "../../core/model/setting-collection";
import {
  SETTING_ICON_PRESETS,
  parseSettingIcon,
} from "../../core/model/setting-icons";
import type {
  SettingRecordDraft,
} from "./setting-collection-modal";

export interface SettingRecordEditorData {
  title: string;
  anchor?: { left: number; top: number };
  initial: SettingRecordDraft;
  iconUrl: (icon: string) => string | null;
  onUploadIcon: (file: File) => Promise<string | null>;
  onSubmit: (draft: SettingRecordDraft, setError: (message: string) => void) => Promise<boolean>;
  onClose?: () => void;
}

export class SettingRecordEditorPanel {
  private root: HTMLElement | null = null;
  private header: HTMLElement | null = null;
  private body: HTMLElement | null = null;
  private headerTitle: HTMLElement | null = null;
  private data: SettingRecordEditorData | null = null;
  private positioned = false;
  private dragging = false;
  private moveListener: ((dx: number, dy: number) => void) | null = null;

  /** 返回面板根元素供外部使用 */
  get element(): HTMLElement | null {
    return this.root;
  }

  /** 注册面板联动移动回调 */
  setMoveListener(listener: (dx: number, dy: number) => void): void {
    this.moveListener = listener;
  }

  /** 设置面板在页面中的坐标 */
  setPosition(left: number, top: number): void {
    if (!this.root) {
      return;
    }
    if (window.matchMedia("(max-width: 700px)").matches) {
      this.root.setCssProps({
        left: "8px",
        top: "56px",
        right: "auto",
        width: "calc(100vw - 16px)",
      });
      this.positioned = true;
      return;
    }
    this.root.setCssProps({
      left: `${Math.round(left)}px`,
      top: `${Math.round(top)}px`,
      right: "auto",
    });
    this.positioned = true;
  }

  /** 按增量平移面板的显示位置 */
  moveBy(dx: number, dy: number): void {
    if (!this.root || (dx === 0 && dy === 0)) {
      return;
    }
    const rect = this.root.getBoundingClientRect();
    this.root.setCssProps({
      left: `${rect.left + dx}px`,
      top: `${rect.top + dy}px`,
      right: "auto",
    });
    this.positioned = true;
  }

  /** 展示编辑面板并重新渲染 */
  show(data: SettingRecordEditorData): void {
    this.data = data;
    if (!this.root) {
      this.build();
    }
    this.render(data);
  }

  /** 关闭面板并触发关闭回调 */
  close(): void {
    if (!this.root) {
      return;
    }
    const onClose = this.data?.onClose;
    this.root.remove();
    this.root = null;
    this.header = null;
    this.body = null;
    this.headerTitle = null;
    this.data = null;
    this.positioned = false;
    onClose?.();
  }

  /** 构建编辑面板的骨架结构 */
  private build(): void {
    const root = createDiv({ cls: "novelview-setting-record-editor-panel" });
    this.root = root;
    const header = root.createDiv({
      cls: "novelview-setting-record-editor-header",
    });
    this.header = header;
    this.headerTitle = header.createDiv({ text: "设定记录" });
    const close = header.createEl("button", {
      attr: { type: "button", "aria-label": "关闭编辑" },
    });
    setIcon(close, "x");
    close.addEventListener("click", (event) => {
      event.stopPropagation();
      this.close();
    });
    header.addEventListener("pointerdown", (event) => {
      if (
        window.matchMedia("(max-width: 700px)").matches
        || (event.target as HTMLElement | null)?.closest("button")
      ) {
        return;
      }
      this.startDrag(event);
    });
    this.body = root.createDiv({
      cls: "novelview-setting-record-editor-body",
    });
    activeDocument.body.appendChild(root);
  }

  /** 渲染记录编辑表单内容 */
  private render(data: SettingRecordEditorData): void {
    if (!this.body || !this.root) {
      return;
    }
    this.position(data);
    this.root.setAttr("aria-label", data.title);
    this.headerTitle?.setText(data.title);
    this.body.empty();
    const fields: SettingField[] = data.initial.fields.map((field) => ({ ...field }));
    let iconValue = data.initial.icon ?? "";

    const keyword = this.body.createEl("input", {
      cls: "novelview-setting-editor-input",
      attr: {
        type: "text",
        placeholder: "记录关键词（可留空）",
        value: data.initial.keyword,
      },
    });
    const content = this.body.createEl("textarea", {
      cls: "novelview-setting-editor-textarea",
      attr: { placeholder: "设定介绍", rows: "4" },
    });
    content.value = data.initial.content;
    const error = this.body.createDiv({
      cls: "novelview-setting-editor-error",
    });

    const iconSection = this.body.createDiv({
      cls: "novelview-setting-editor-icon-section",
    });
    iconSection.createDiv({
      cls: "novelview-setting-editor-icon-label",
      text: "记录图标",
    });
    const iconRow = iconSection.createDiv({
      cls: "novelview-setting-editor-icon-row",
    });
    const iconPreview = iconRow.createDiv({
      cls: "novelview-setting-editor-icon-preview",
    });
    const iconControls = iconRow.createDiv({
      cls: "novelview-setting-editor-icon-controls",
    });
    const renderIconPreview = (): void => {
      iconPreview.empty();
      const parsed = parseSettingIcon(iconValue);
      if (!parsed) {
        iconPreview.createSpan({ text: "无" });
        return;
      }
      if (parsed.kind === "image") {
        const url = data.iconUrl(iconValue);
        if (url) {
          iconPreview.createEl("img", {
            attr: { src: url, alt: "记录图标" },
          });
        } else {
          iconPreview.createSpan({ text: "?" });
        }
        return;
      }
      setIcon(iconPreview, parsed.value);
    };
    const presetGrid = iconSection.createDiv({
      cls: "novelview-setting-editor-icon-presets",
    });
    const renderPresets = (): void => {
      presetGrid.empty();
      for (const preset of SETTING_ICON_PRESETS) {
        const button = presetGrid.createEl("button", {
          cls: "novelview-setting-editor-icon-preset",
          attr: {
            type: "button",
            "aria-label": preset.label,
            title: preset.label,
          },
        });
        setIcon(button, preset.value.replace(/^lucide:/u, ""));
        button.toggleClass("is-selected", iconValue === preset.value);
        button.addEventListener("click", () => {
          iconValue = preset.value;
          renderPresets();
          renderIconPreview();
        });
      }
    };
    const uploadInput = iconControls.createEl("input", {
      cls: "novelview-setting-editor-icon-upload",
      attr: {
        type: "file",
        accept: ".svg,image/svg+xml,image/png,image/jpeg,image/webp",
      },
    });
    uploadInput.addClass("is-hidden");
    iconControls.createEl("button", {
      text: "上传 SVG / PNG / JPG",
      attr: { type: "button" },
    }).addEventListener("click", () => uploadInput.click());
    iconControls.createEl("button", {
      text: "清除图标",
      attr: { type: "button" },
    }).addEventListener("click", () => {
      iconValue = "";
      renderPresets();
      renderIconPreview();
    });
    uploadInput.addEventListener("change", () => {
      const file = uploadInput.files?.[0];
      if (!file) {
        return;
      }
      void data.onUploadIcon(file).then((stored) => {
        if (!stored) {
          error.setText("图标上传失败。");
          return;
        }
        iconValue = stored;
        renderPresets();
        renderIconPreview();
      });
      uploadInput.value = "";
    });
    renderPresets();
    renderIconPreview();

    const fieldsSection = this.body.createDiv({
      cls: "novelview-setting-editor-section",
    });
    fieldsSection.createDiv({
      cls: "novelview-setting-editor-section-title",
      text: "属性",
    });
    const fieldsEl = fieldsSection.createDiv({
      cls: "novelview-setting-record-fields",
    });
    const renderFields = (): void => {
      fieldsEl.empty();
      for (const [index, field] of fields.entries()) {
        const row = fieldsEl.createDiv({
          cls: "novelview-setting-record-field-row",
        });
        const name = row.createEl("input", {
          attr: { type: "text", placeholder: "属性名" },
        });
        name.value = field.name;
        name.addEventListener("input", () => {
          field.name = name.value;
        });
        const value = row.createEl("input", {
          attr: { type: "text", placeholder: "值" },
        });
        value.value = field.value;
        value.addEventListener("input", () => {
          field.value = value.value;
        });
        const actions = row.createDiv({
          cls: "novelview-setting-record-field-actions",
        });
        const up = actions.createEl("button", {
          attr: { type: "button", "aria-label": "上移属性", title: "上移" },
        });
        setIcon(up, "arrow-up");
        up.disabled = index === 0;
        up.addEventListener("click", () => {
          if (index === 0) {
            return;
          }
          [fields[index - 1], fields[index]] = [fields[index], fields[index - 1]];
          renderFields();
        });
        const down = actions.createEl("button", {
          attr: { type: "button", "aria-label": "下移属性", title: "下移" },
        });
        setIcon(down, "arrow-down");
        down.disabled = index === fields.length - 1;
        down.addEventListener("click", () => {
          if (index === fields.length - 1) {
            return;
          }
          [fields[index + 1], fields[index]] = [fields[index], fields[index + 1]];
          renderFields();
        });
        const remove = actions.createEl("button", {
          text: "×",
          attr: { type: "button", "aria-label": "删除属性" },
        });
        remove.addEventListener("click", () => {
          fields.splice(index, 1);
          renderFields();
        });
      }
    };
    renderFields();
    fieldsSection.createEl("button", {
      cls: "novelview-setting-row-add",
      text: "+ 添加属性",
      attr: { type: "button" },
    }).addEventListener("click", () => {
      fields.push({ name: "", value: "" });
      renderFields();
    });

    const actions = this.body.createDiv({
      cls: "novelview-setting-editor-actions",
    });
    actions.createEl("button", { text: "取消", attr: { type: "button" } })
      .addEventListener("click", () => this.close());
    const save = actions.createEl("button", {
      cls: "mod-cta",
      text: "保存",
      attr: { type: "button" },
    });
    save.addEventListener("click", () => {
      void this.submit(
        {
          keyword: keyword.value.trim(),
          content: content.value,
          icon: iconValue,
          fields: fields
            .map((field) => ({ name: field.name.trim(), value: field.value.trim() }))
            .filter((field) => field.name.length > 0),
          marks: [],
        },
        error,
        save,
      );
    });
  }

  /** 提交草稿并处理校验错误 */
  private async submit(
    draft: SettingRecordDraft,
    error: HTMLElement,
    button: HTMLButtonElement,
  ): Promise<void> {
    if (!this.data) {
      return;
    }
    button.disabled = true;
    try {
      if (await this.data.onSubmit(draft, (message) => error.setText(message))) {
        this.close();
      }
    } finally {
      button.disabled = false;
    }
  }

  /** 根据锚点计算面板位置 */
  private position(data: SettingRecordEditorData): void {
    if (!this.root || this.positioned) {
      return;
    }
    const width = 430;
    const anchor = data.anchor;
    if (anchor && anchor.left > width + 36) {
      this.root.setCssProps({
        left: `${anchor.left - width - 12}px`,
        top: `${Math.max(80, anchor.top)}px`,
        right: "auto",
      });
    }
    this.positioned = true;
  }

  /** 绑定标题栏拖拽移动逻辑 */
  private startDrag(event: PointerEvent): void {
    if (!this.root || !this.header || event.button !== 0) {
      return;
    }
    const rect = this.root.getBoundingClientRect();
    if (!this.positioned) {
      this.root.setCssProps({
        left: `${rect.left}px`,
        top: `${rect.top}px`,
        right: "auto",
      });
      this.positioned = true;
    }
    this.dragging = true;
    const startX = event.clientX;
    const startY = event.clientY;
    const startLeft = rect.left;
    const startTop = rect.top;
    this.header.setPointerCapture(event.pointerId);
    let lastLeft = rect.left;
    let lastTop = rect.top;
    const move = (moveEvent: PointerEvent): void => {
      if (!this.root || !this.dragging) {
        return;
      }
      const nextLeft = startLeft + moveEvent.clientX - startX;
      const nextTop = startTop + moveEvent.clientY - startY;
      this.root.setCssProps({
        left: `${nextLeft}px`,
        top: `${nextTop}px`,
      });
      this.moveListener?.(nextLeft - lastLeft, nextTop - lastTop);
      lastLeft = nextLeft;
      lastTop = nextTop;
    };
    const up = (): void => {
      this.dragging = false;
      this.header?.removeEventListener("pointermove", move);
      this.header?.removeEventListener("pointerup", up);
      this.header?.removeEventListener("pointercancel", up);
    };
    this.header.addEventListener("pointermove", move);
    this.header.addEventListener("pointerup", up);
    this.header.addEventListener("pointercancel", up);
    event.preventDefault();
  }
}
