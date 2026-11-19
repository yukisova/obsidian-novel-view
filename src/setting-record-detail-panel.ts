import { setIcon, TFile } from "obsidian";
import type { SettingCollectionEntry } from "./core/setting-collection";
import type { GraphRelation } from "./core/setting-special-data";
import { parseSettingIcon } from "./core/setting-icons";

export interface SettingRecordDetailData {
  groupName: string;
  tagName: string;
  entry: SettingCollectionEntry;
  detailFiles: TFile[];
  detailLabel: (file: TFile) => string;
  iconUrl: (icon: string) => string | null;
  onEdit: (() => void) | null;
  openFile: (file: TFile) => void;
  relations: GraphRelation[];
  onOpenRelation: (target: string) => void;
}

export class SettingRecordDetailPanel {
  private root: HTMLElement | null = null;
  private header: HTMLElement | null = null;
  private body: HTMLElement | null = null;
  private title: HTMLElement | null = null;
  private meta: HTMLElement | null = null;
  private iconEl: HTMLElement | null = null;
  private data: SettingRecordDetailData | null = null;
  private dragStart: { x: number; y: number; left: number; top: number } | null = null;
  private positioned = false;
  private moveListener: ((dx: number, dy: number) => void) | null = null;

  get element(): HTMLElement | null {
    return this.root;
  }

  setMoveListener(listener: (dx: number, dy: number) => void): void {
    this.moveListener = listener;
  }

  setPosition(left: number, top: number): void {
    if (!this.root) {
      return;
    }
    this.root.setCssProps({
      left: `${Math.round(left)}px`,
      top: `${Math.round(top)}px`,
      right: "auto",
    });
    this.positioned = true;
  }

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

  show(data: SettingRecordDetailData): void {
    this.data = data;
    if (!this.root) {
      this.build();
    }
    this.render();
  }

  close(): void {
    this.root?.remove();
    this.root = null;
    this.header = null;
    this.body = null;
    this.title = null;
    this.meta = null;
    this.iconEl = null;
    this.data = null;
    this.positioned = false;
  }

  private build(): void {
    const root = createDiv({ cls: "novelview-setting-record-detail-panel" });
    this.root = root;
    const header = root.createDiv({
      cls: "novelview-setting-record-detail-panel-header",
    });
    this.header = header;
    this.iconEl = header.createDiv({
      cls: "novelview-setting-record-detail-panel-icon",
    });
    const title = header.createDiv({
      cls: "novelview-setting-record-detail-panel-title",
    });
    this.title = title;
    const meta = header.createDiv({
      cls: "novelview-setting-record-detail-panel-meta",
    });
    this.meta = meta;
    const actions = header.createDiv({
      cls: "novelview-setting-record-detail-panel-actions",
    });
    const edit = actions.createEl("button", {
      attr: { type: "button", "aria-label": "编辑记录", title: "编辑记录" },
    });
    setIcon(edit, "pencil");
    edit.addEventListener("click", (event) => {
      event.stopPropagation();
      this.data?.onEdit?.();
    });
    const close = actions.createEl("button", {
      attr: { type: "button", "aria-label": "关闭详情", title: "关闭" },
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
      cls: "novelview-setting-record-detail-panel-body",
    });
    activeDocument.body.appendChild(root);
  }

  private render(): void {
    if (!this.root || !this.body || !this.title || !this.meta || !this.data) {
      return;
    }
    const editButton = this.root.querySelector<HTMLElement>(
      ".novelview-setting-record-detail-panel-actions button",
    );
    editButton?.toggleClass("is-hidden", !this.data.onEdit);
    const { entry, groupName, tagName, detailFiles, detailLabel } = this.data;
    this.title.setText(entry.keyword || "未命名记录");
    this.meta.empty();
    const groupMeta = this.meta.createSpan({
      cls: "novelview-setting-record-detail-meta-group",
    });
    const folderIcon = groupMeta.createSpan();
    setIcon(folderIcon, "folder");
    groupMeta.createSpan({ text: groupName });
    const tagMeta = this.meta.createSpan({
      cls: "novelview-setting-record-detail-meta-tag",
    });
    const tagIcon = tagMeta.createSpan();
    setIcon(tagIcon, "tag");
    tagMeta.createSpan({ text: tagName || "未分类" });
    const parsedIcon = parseSettingIcon(entry.icon);
    const imageUrl = parsedIcon?.kind === "image"
      ? this.data?.iconUrl(entry.icon ?? "") ?? null
      : null;
    if (this.iconEl) {
      this.iconEl.empty();
      const showHeaderIcon = parsedIcon?.kind === "lucide";
      this.iconEl.toggleClass("is-empty", !showHeaderIcon);
      if (showHeaderIcon && parsedIcon) {
        setIcon(this.iconEl, parsedIcon.value);
      }
    }
    this.body.empty();
    if (entry.content || imageUrl) {
      const content = this.body.createDiv({
        cls: "novelview-setting-record-detail-content",
      });
      if (imageUrl) {
        content.createEl("img", {
          cls: "novelview-setting-record-detail-content-image",
          attr: {
            src: imageUrl,
            alt: entry.keyword || "设定图标",
          },
        });
      }
      if (entry.content) {
        content.appendText(entry.content);
      }
    }
    if (entry.fields.length > 0) {
      const section = this.body.createDiv({
        cls: "novelview-setting-record-detail-section",
      });
      const fieldsGrid = section.createDiv({
        cls: "novelview-setting-record-detail-fields-grid",
      });
      for (const field of entry.fields) {
        const length = Array.from(field.value).length;
        const mode = length > 30 || field.value.includes("\n")
          ? "is-long"
          : length > 10
            ? "is-medium"
            : "is-short";
        const row = fieldsGrid.createDiv({
          cls: `novelview-setting-record-detail-field ${mode}`,
        });
        row.createSpan({
          cls: "novelview-setting-record-detail-field-name",
          text: field.name,
        });
        row.createSpan({
          cls: "novelview-setting-record-detail-field-value",
          text: field.value || "—",
        });
      }
    }
    if (this.data?.relations.length) {
      const section = this.body.createDiv({
        cls: "novelview-setting-record-detail-section",
      });
      section.createDiv({
        cls: "novelview-setting-record-detail-section-title",
        text: "关系",
      });
      const relationsGrid = section.createDiv({
        cls: "novelview-setting-record-detail-relations-grid",
      });
      for (const relation of this.data.relations) {
        const outgoing = relation.from === this.data.entry.keyword;
        const target = outgoing ? relation.to : relation.from;
        const row = relationsGrid.createDiv({
          cls: "novelview-setting-record-detail-relation",
        });
        const relationTop = row.createDiv({
          cls: "novelview-setting-record-detail-relation-top",
        });
        relationTop.createSpan({
          cls: "novelview-setting-record-detail-relation-type",
          text: relation.label || "关系",
        });
        const icon = relationTop.createSpan({
          cls: "novelview-setting-record-detail-relation-icon",
        });
        const arrow = relation.twoWay
          ? "arrow-left-right"
          : outgoing ? "arrow-right" : "arrow-left";
        setIcon(icon, arrow);
        icon.setAttr("aria-label", relation.twoWay ? "双向关系" : "单向关系");
        icon.setAttr("title", relation.twoWay ? "双向关系" : "单向关系");
        const targetButton = row.createEl("button", {
          cls: "novelview-setting-record-detail-relation-target",
          attr: {
            type: "button",
            title: `打开“${target}”设定记录`,
          },
        });
        targetButton.createSpan({
          cls: "novelview-setting-record-detail-relation-group",
          text: relation.twoWay ? "双向" : outgoing ? "指向" : "来自",
        });
        targetButton.createSpan({
          cls: "novelview-setting-record-detail-relation-name",
          text: target,
        });
        targetButton.addEventListener("click", () => {
          this.data?.onOpenRelation(target);
        });
      }
    }

    if (detailFiles.length > 0) {
      const section = this.body.createDiv({
        cls: "novelview-setting-record-detail-section",
      });
      section.createDiv({
        cls: "novelview-setting-record-detail-section-title",
        text: "详细文件",
      });
      const grid = section.createDiv({
        cls: "novelview-setting-record-detail-files",
      });
      for (const file of detailFiles) {
        const button = grid.createEl("button", {
          attr: { type: "button", title: file.path },
        });
        const icon = button.createSpan();
        setIcon(icon, "file-text");
        button.createSpan({ text: detailLabel(file) });
        button.addEventListener("click", () => {
          this.data?.openFile(file);
        });
      }
    }
  }

  private startDrag(event: PointerEvent): void {
    if (!this.root || !this.header) {
      return;
    }
    if (event.button !== 0) {
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
    this.dragStart = {
      x: event.clientX,
      y: event.clientY,
      left: rect.left,
      top: rect.top,
    };
    this.root.addClass("is-dragging");
    this.header.setPointerCapture(event.pointerId);
    let lastLeft = rect.left;
    let lastTop = rect.top;
    const move = (moveEvent: PointerEvent): void => {
      if (!this.root || !this.dragStart) {
        return;
      }
      const nextLeft = this.dragStart.left + moveEvent.clientX - this.dragStart.x;
      const nextTop = this.dragStart.top + moveEvent.clientY - this.dragStart.y;
      this.root.setCssProps({
        left: `${nextLeft}px`,
        top: `${nextTop}px`,
      });
      this.moveListener?.(nextLeft - lastLeft, nextTop - lastTop);
      lastLeft = nextLeft;
      lastTop = nextTop;
    };
    const up = (): void => {
      this.root?.removeClass("is-dragging");
      this.dragStart = null;
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
