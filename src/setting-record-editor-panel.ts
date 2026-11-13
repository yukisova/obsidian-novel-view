import { setIcon } from "obsidian";
import type {
  SettingField,
  SettingRelation,
} from "./core/setting-collection";
import type {
  SettingRecordDraft,
  SettingRecordTarget,
} from "./setting-collection-modal";

export interface SettingRecordEditorData {
  title: string;
  anchor?: { left: number; top: number };
  initial: SettingRecordDraft;
  targets: SettingRecordTarget[];
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

  get element(): HTMLElement | null {
    return this.root;
  }

  show(data: SettingRecordEditorData): void {
    this.data = data;
    if (!this.root) {
      this.build();
    }
    this.render(data);
  }

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
      if ((event.target as HTMLElement | null)?.closest("button")) {
        return;
      }
      this.startDrag(event);
    });
    this.body = root.createDiv({
      cls: "novelview-setting-record-editor-body",
    });
    activeDocument.body.appendChild(root);
  }

  private render(data: SettingRecordEditorData): void {
    if (!this.body || !this.root) {
      return;
    }
    this.position(data);
    this.root.setAttr("aria-label", data.title);
    this.headerTitle?.setText(data.title);
    this.body.empty();
    const fields: SettingField[] = data.initial.fields.map((field) => ({ ...field }));
    const relations: SettingRelation[] = data.initial.relations.map((relation) => ({ ...relation }));

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

    const relationsSection = this.body.createDiv({
      cls: "novelview-setting-editor-section",
    });
    relationsSection.createDiv({
      cls: "novelview-setting-editor-section-title",
      text: "关系",
    });
    const relationsEl = relationsSection.createDiv({
      cls: "novelview-setting-record-relations",
    });
    const groupNames = [...new Set([
      ...data.targets.map((target) => target.group),
      ...relations.map((relation) => relation.targetGroup),
    ].filter(Boolean))];
    const renderRelations = (): void => {
      relationsEl.empty();
      for (const [index, relation] of relations.entries()) {
        const card = relationsEl.createDiv({
          cls: "novelview-setting-relation-editor-card",
        });
        const header = card.createDiv({
          cls: "novelview-setting-relation-editor-header",
        });
        header.createSpan({ text: `关系 ${index + 1}` });
        const remove = header.createEl("button", {
          attr: { type: "button", "aria-label": "删除关系", title: "删除关系" },
        });
        setIcon(remove, "trash-2");
        remove.addEventListener("click", () => {
          relations.splice(index, 1);
          renderRelations();
        });

        const grid = card.createDiv({
          cls: "novelview-setting-relation-editor-grid",
        });
        const addField = (
          label: string,
          control: HTMLElement,
        ): void => {
          const field = grid.createDiv({
            cls: "novelview-setting-relation-editor-field",
          });
          field.createDiv({
            cls: "novelview-setting-relation-editor-label",
            text: label,
          });
          field.appendChild(control);
        };

        const group = createEl("select");
        for (const name of groupNames) {
          group.createEl("option", { text: name, attr: { value: name } });
        }
        if (relation.targetGroup && !groupNames.includes(relation.targetGroup)) {
          group.createEl("option", {
            text: relation.targetGroup,
            attr: { value: relation.targetGroup },
          });
        }
        group.value = relation.targetGroup || groupNames[0] || "";
        relation.targetGroup = group.value;
        group.addEventListener("change", () => {
          relation.targetGroup = group.value;
          const first = data.targets.find((target) => target.group === relation.targetGroup);
          relation.targetKeyword = first?.keyword ?? "";
          renderRelations();
        });
        addField("设定组", group);

        const target = createEl("select");
        const candidates = data.targets.filter((item) => item.group === relation.targetGroup);
        for (const item of candidates) {
          target.createEl("option", { text: item.keyword, attr: { value: item.keyword } });
        }
        if (relation.targetKeyword && !candidates.some((item) => item.keyword === relation.targetKeyword)) {
          target.createEl("option", {
            text: relation.targetKeyword,
            attr: { value: relation.targetKeyword },
          });
        }
        target.value = relation.targetKeyword || candidates[0]?.keyword || "";
        relation.targetKeyword = target.value;
        target.addEventListener("change", () => {
          relation.targetKeyword = target.value;
        });
        addField("设定记录", target);

        const type = createEl("input");
        type.type = "text";
        type.placeholder = "例如：兄妹、居住";
        type.value = relation.type;
        type.addEventListener("input", () => {
          relation.type = type.value;
        });
        addField("关系信息", type);

        const directionWrap = createDiv({
          cls: "novelview-setting-relation-editor-direction",
        });
        const directions = [
          { value: "left", icon: "arrow-left", label: "左向单向" },
          { value: "right", icon: "arrow-right", label: "右向单向" },
          { value: "two-way", icon: "arrow-left-right", label: "双向" },
        ] as const;
        const renderDirection = (): void => {
          directionWrap.empty();
          for (const option of directions) {
            const button = directionWrap.createEl("button", {
              cls: "novelview-setting-relation-direction-button",
              attr: {
                type: "button",
                "aria-label": option.label,
                title: option.label,
              },
            });
            setIcon(button, option.icon);
            const active = relation.direction === "two-way"
              ? option.value === "two-way"
              : relation.side === "left"
                ? option.value === "left"
                : option.value === "right";
            button.toggleClass("is-active", active);
            button.addEventListener("click", () => {
              if (option.value === "two-way") {
                relation.direction = "two-way";
              } else {
                relation.direction = "one-way";
                relation.side = option.value;
              }
              renderDirection();
            });
          }
        };
        renderDirection();
        addField("方向", directionWrap);
      }
    };
    renderRelations();
    relationsSection.createEl("button", {
      cls: "novelview-setting-row-add",
      text: "+ 添加关系",
      attr: { type: "button" },
    }).addEventListener("click", () => {
      const first = data.targets[0];
      relations.push({
        targetGroup: first?.group ?? "",
        targetKeyword: first?.keyword ?? "",
        type: "",
        direction: "one-way",
        side: "right",
      });
      renderRelations();
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
          fields: fields
            .map((field) => ({ name: field.name.trim(), value: field.value.trim() }))
            .filter((field) => field.name.length > 0),
          relations: relations.filter((relation) => (
            relation.targetGroup.length > 0 && relation.targetKeyword.length > 0
          )),
          marks: [],
        },
        error,
        save,
      );
    });
  }

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
    const move = (moveEvent: PointerEvent): void => {
      if (!this.root || !this.dragging) {
        return;
      }
      this.root.setCssProps({
        left: `${startLeft + moveEvent.clientX - startX}px`,
        top: `${startTop + moveEvent.clientY - startY}px`,
      });
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
