import {
  ItemView,
  Notice,
  TFile,
  setIcon,
  type WorkspaceLeaf,
} from "obsidian";
import {
  defaultKeymap,
  history,
  historyKeymap,
} from "@codemirror/commands";
import { EditorState } from "@codemirror/state";
import {
  EditorView,
  drawSelection,
  highlightActiveLine,
  highlightActiveLineGutter,
  highlightSpecialChars,
  keymap,
  lineNumbers,
  scrollPastEnd,
} from "@codemirror/view";
import {
  SETTING_DRAG_MIME,
  SETTING_RECORD_DROP_EVENT,
  type SettingRecordDragPayload,
} from "../core/setting-drag";
import {
  SETTING_SPECIAL_FILE_LABELS,
  settingSpecialFileDisplayName,
  settingSpecialFileKind,
  type SettingSpecialFileKind,
} from "../core/setting-collection";
import type NovelViewPlugin from "../main";

export abstract class SpecialEditorBaseView extends ItemView {
  protected filePath = "";
  protected file: TFile | null = null;
  protected editorView: EditorView | null = null;
  private previewHost: HTMLElement | null = null;
  private renderHost: HTMLElement | null = null;
  private sourceHost: HTMLElement | null = null;
  private panX = 0;
  private panY = 0;
  private zoom = 1;
  private panning = false;
  private panStartX = 0;
  private panStartY = 0;
  private panOriginX = 0;
  private panOriginY = 0;
  private statusEl: HTMLElement | null = null;
  private toggleButton: HTMLButtonElement | null = null;
  private resetButton: HTMLButtonElement | null = null;
  private sourceHint: HTMLElement | null = null;
  private saveTimer: number | null = null;
  private previewTimer: number | null = null;
  private saving = false;
  private sourceMode = false;
  private lastSaved = "";
  private dragBound = false;

  protected abstract readonly kind: SettingSpecialFileKind;
  protected abstract readonly viewType: string;
  protected abstract readonly viewIcon: string;
  protected readonly panZoomEnabled: boolean = true;
  protected readonly wheelZoomEnabled: boolean = true;
  protected readonly middlePanEnabled: boolean = true;

  constructor(leaf: WorkspaceLeaf, protected readonly plugin: NovelViewPlugin) {
    super(leaf);
    this.navigation = false;
  }

  override getViewType(): string {
    return this.viewType;
  }

  override getDisplayText(): string {
    return this.displayFileName();
  }

  private displayFileName(): string {
    const name = this.file?.name
      ?? this.filePath.split("/").pop()
      ?? "";
    return name
      ? settingSpecialFileDisplayName(name)
      : SETTING_SPECIAL_FILE_LABELS[this.kind];
  }

  private updateTabTitle(): void {
    const titleEl = this.leaf.view.containerEl
      .closest(".workspace-leaf")
      ?.querySelector(".workspace-tab-header-inner-title");
    if (titleEl instanceof HTMLElement) {
      titleEl.setText(this.displayFileName());
    }
  }

  override getIcon(): string {
    return this.viewIcon;
  }

  override getState(): Record<string, unknown> {
    return { file: this.filePath };
  }

  override async setState(
    state: Record<string, unknown>,
    result: import("obsidian").ViewStateResult,
  ): Promise<void> {
    this.filePath = typeof state.file === "string" ? state.file : this.filePath;
    result.history = true;
    await super.setState(state, result);
    await this.loadFile();
  }

  protected override async onOpen(): Promise<void> {
    this.bindDragDrop();
    await this.loadFile();
  }

  protected override async onClose(): Promise<void> {
    if (this.saveTimer !== null) {
      window.clearTimeout(this.saveTimer);
      this.saveTimer = null;
    }
    if (this.previewTimer !== null) {
      window.clearTimeout(this.previewTimer);
      this.previewTimer = null;
    }
    await this.save();
    this.editorView?.destroy();
    this.editorView = null;
    this.contentEl.empty();
  }

  protected abstract renderPreview(
    content: string,
    host: HTMLElement,
  ): void | Promise<void>;

  protected abstract templateInsertion(): string;
  protected abstract recordInsertion(
    payload: SettingRecordDragPayload,
    point?: { clientX: number; clientY: number },
  ): string;

  protected helpText(): string {
    return "";
  }

  private fileKind(): SettingSpecialFileKind | null {
    return settingSpecialFileKind(this.filePath.split("/").pop() ?? "");
  }

  private async loadFile(): Promise<void> {
    if (!this.filePath || this.fileKind() !== this.kind) {
      return;
    }
    const file = this.app.vault.getAbstractFileByPath(this.filePath);
    if (!(file instanceof TFile)) {
      this.contentEl.empty();
      this.contentEl.createDiv({
        cls: "novelview-special-editor-message",
        text: "找不到特殊设定文件。",
      });
      return;
    }
    this.file = file;
    this.updateTabTitle();
    const content = await this.app.vault.read(file);
    this.lastSaved = content;
    this.build(content);
  }

  private build(content: string): void {
    this.editorView?.destroy();
    this.contentEl.empty();
    this.contentEl.addClass("novelview-special-editor-view");
    this.contentEl.setAttr("data-special-kind", this.kind);
    if (this.panZoomEnabled) {
      this.resetButton = this.contentEl.createEl("button", {
        cls: "novelview-special-editor-reset",
        attr: {
          type: "button",
          "aria-label": "重置视图",
          title: "重置视图位置和缩放",
        },
      });
      setIcon(this.resetButton, "maximize");
      this.resetButton.addEventListener("click", () => {
        this.panX = 0;
        this.panY = 0;
        this.zoom = 1;
        this.applyDisplayTransform();
      });
    }
    this.toggleButton = this.contentEl.createEl("button", {
      cls: "novelview-special-editor-toggle",
      attr: {
        type: "button",
        "aria-label": "切换到源码",
        title: "切换源码 / 显示（Ctrl/⌘ + Shift + E）",
      },
    });
    setIcon(this.toggleButton, "code");
    this.toggleButton.createSpan({
      cls: "novelview-special-editor-toggle-label",
      text: "源码",
    });
    this.toggleButton.addEventListener("click", () => this.toggleSource());

    const body = this.contentEl.createDiv({
      cls: "novelview-special-editor-body",
    });
    this.previewHost = body.createDiv({
      cls: "novelview-special-editor-preview is-visible",
    });
    const displayContent = this.previewHost.createDiv({
      cls: "novelview-special-editor-display-content",
    });
    if (this.panZoomEnabled) {
      this.contentEl.addClass("novelview-special-editor-panzoom");
      this.renderHost = displayContent.createDiv({
        cls: "novelview-special-editor-display-scene",
      });
      this.bindPanZoom(displayContent);
    } else {
      this.renderHost = displayContent;
    }
    this.sourceHost = body.createDiv({
      cls: "novelview-special-editor-source",
    });
    if (this.kind !== "detail") {
      this.sourceHint = this.sourceHost.createDiv({
        cls: "novelview-special-editor-source-hint",
      });
      this.sourceHint.createSpan({
        cls: "novelview-special-editor-source-help",
        text: this.helpText() || "编辑数据会自动保存。",
      });
      this.statusEl = this.sourceHint.createSpan({
        cls: "novelview-special-editor-status",
        text: "已保存",
      });
    }
    const editorHost = this.sourceHost.createDiv({
      cls: "novelview-special-editor-codemirror",
    });

    this.editorView = new EditorView({
      parent: editorHost,
      state: EditorState.create({
        doc: content,
        extensions: [
          history(),
          drawSelection(),
          ...(this.kind === "detail"
            ? []
            : [
              lineNumbers(),
              highlightActiveLine(),
              highlightActiveLineGutter(),
              highlightSpecialChars(),
              scrollPastEnd(),
            ]),
          keymap.of([
            ...defaultKeymap,
            ...historyKeymap,
            {
              key: "Mod-Shift-e",
              run: () => {
                this.toggleSource();
                return true;
              },
            },
          ]),
          EditorView.lineWrapping,
          EditorView.updateListener.of((update) => {
            if (update.docChanged) {
              this.scheduleSave();
              this.schedulePreview();
            }
          }),
          EditorView.theme({
            "&": { height: "100%", backgroundColor: "transparent" },
            ".cm-scroller": {
              overflow: "auto",
              fontFamily: "var(--font-monospace, monospace)",
            },
            ".cm-content": {
              padding: "14px 16px 60px",
              fontSize: "12px",
              lineHeight: "1.7",
              color: "var(--text-normal)",
              caretColor: "var(--interactive-accent)",
            },
            ".cm-line": { padding: "0" },
            "&.cm-focused": { outline: "none" },
          }),
        ],
      }),
    });
    this.renderPreviewNow();
  }

  private bindDragDrop(): void {
    if (this.dragBound) {
      return;
    }
    this.dragBound = true;
    this.contentEl.addEventListener("dragover", (event) => {
      if (!event.dataTransfer?.types.includes(SETTING_DRAG_MIME)) {
        return;
      }
      event.preventDefault();
      event.dataTransfer.dropEffect = "copy";
      this.contentEl.addClass("is-record-drop-target");
    });
    this.contentEl.addEventListener("dragleave", (event) => {
      if (!this.contentEl.contains(event.relatedTarget as Node | null)) {
        this.contentEl.removeClass("is-record-drop-target");
      }
    });
    this.contentEl.addEventListener("drop", (event) => {
      this.handleRecordDrop(event);
    });
    this.contentEl.addEventListener(
      SETTING_RECORD_DROP_EVENT,
      (event) => {
        const payload = (event as CustomEvent<SettingRecordDragPayload>).detail;
        if (payload?.kind !== "record") {
          return;
        }
        const insertion = this.recordInsertion(payload);
        if (!insertion) {
          return;
        }
        this.insertText(insertion);
        new Notice(
          `Novel View：已将“${payload.keyword}”加入${SETTING_SPECIAL_FILE_LABELS[this.kind]}。`,
        );
      },
    );
  }

  private bindPanZoom(host: HTMLElement): void {
    if (this.wheelZoomEnabled) {
    host.addEventListener("wheel", (event) => {
      event.preventDefault();
      const rect = host.getBoundingClientRect();
      const x = event.clientX - rect.left;
      const y = event.clientY - rect.top;
      const next = Math.min(
        3,
        Math.max(0.35, this.zoom * (event.deltaY < 0 ? 1.12 : 0.89)),
      );
      const ratio = next / this.zoom;
      this.panX = x - (x - this.panX) * ratio;
      this.panY = y - (y - this.panY) * ratio;
      this.zoom = next;
      this.applyDisplayTransform();
    }, { passive: false });
    }
    if (this.middlePanEnabled) {
    host.addEventListener("pointerdown", (event) => {
      if (event.button !== 1) {
        return;
      }
      event.preventDefault();
      this.panning = true;
      this.panStartX = event.clientX;
      this.panStartY = event.clientY;
      this.panOriginX = this.panX;
      this.panOriginY = this.panY;
      try {
        host.setPointerCapture(event.pointerId);
      } catch {
        // Synthetic events do not own a native pointer.
      }
      host.addClass("is-panning");
    });
    host.addEventListener("pointermove", (event) => {
      if (!this.panning) {
        return;
      }
      this.panX = this.panOriginX + event.clientX - this.panStartX;
      this.panY = this.panOriginY + event.clientY - this.panStartY;
      this.applyDisplayTransform();
    });
    const endPan = (event: PointerEvent): void => {
      if (!this.panning) {
        return;
      }
      this.panning = false;
      if (host.hasPointerCapture(event.pointerId)) {
        host.releasePointerCapture(event.pointerId);
      }
      host.removeClass("is-panning");
    };
    host.addEventListener("pointerup", endPan);
    host.addEventListener("pointercancel", endPan);
    host.addEventListener("auxclick", (event) => {
      if (event.button === 1) {
        event.preventDefault();
      }
    });
    }
  }

  private applyDisplayTransform(): void {
    const scene = this.renderHost;
    if (!scene) {
      return;
    }
    scene.setCssProps({
      transform: `translate(${this.panX}px, ${this.panY}px) scale(${this.zoom})`,
    });
  }

  protected openSettingRecord(keyword: string): void {
    if (!keyword.trim()) {
      return;
    }
    const novelRoot = this.plugin.findNovelGroupRoot(this.filePath)
      ?? this.plugin.normalizeFolderPath(
        this.filePath.split("/").slice(0, -1).join("/"),
      );
    void this.plugin.openSettingRecordForNovelKeyword(novelRoot, keyword);
  }

  private toggleSource(): void {
    this.sourceMode = !this.sourceMode;
    this.contentEl.toggleClass("is-source-mode", this.sourceMode);
    this.previewHost?.toggleClass("is-visible", !this.sourceMode);
    this.sourceHost?.toggleClass("is-visible", this.sourceMode);
    this.toggleButton?.setAttr(
      "aria-label",
      this.sourceMode ? "切换到显示" : "切换到源码",
    );
    if (this.toggleButton) {
      this.toggleButton.empty();
      setIcon(this.toggleButton, this.sourceMode ? "eye" : "code");
      this.toggleButton.createSpan({
        cls: "novelview-special-editor-toggle-label",
        text: this.sourceMode ? "显示" : "源码",
      });
      this.toggleButton.toggleClass("is-source-mode", this.sourceMode);
    }
    if (this.sourceMode) {
      window.requestAnimationFrame(() => {
        this.editorView?.requestMeasure();
        this.editorView?.focus();
      });
    } else {
      this.previewHost?.focus();
    }
  }

  private insertText(text: string): void {
    if (!this.editorView || !text) {
      return;
    }
    const end = this.editorView.state.doc.length;
    this.editorView.dispatch({
      changes: { from: end, insert: text },
      selection: { anchor: end + text.length },
    });
    this.editorView.focus();
    this.schedulePreview();
  }

  private handleRecordDrop(event: DragEvent): void {
    event.preventDefault();
    this.contentEl.removeClass("is-record-drop-target");
    const raw = event.dataTransfer?.getData(SETTING_DRAG_MIME);
    if (!raw) {
      return;
    }
    let payload: SettingRecordDragPayload;
    try {
      const parsed = JSON.parse(raw) as Partial<SettingRecordDragPayload>;
      if (parsed.kind !== "record" || !parsed.keyword) {
        return;
      }
      payload = {
        kind: "record",
        group: parsed.group ?? "",
        tag: parsed.tag ?? "",
        keyword: parsed.keyword,
        content: parsed.content ?? "",
      };
    } catch {
      return;
    }
    const insertion = this.recordInsertion(payload, {
      clientX: event.clientX,
      clientY: event.clientY,
    });
    if (insertion) {
      this.insertText(insertion);
      new Notice(`Novel View：已将“${payload.keyword}”加入${SETTING_SPECIAL_FILE_LABELS[this.kind]}。`);
    }
  }

  private schedulePreview(): void {
    if (this.previewTimer !== null) {
      window.clearTimeout(this.previewTimer);
    }
    this.previewTimer = window.setTimeout(() => {
      this.previewTimer = null;
      this.renderPreviewNow();
    }, 140);
  }

  private renderPreviewNow(): void {
    if (!this.renderHost || !this.editorView) {
      return;
    }
    this.renderHost.empty();
    void this.renderPreview(
      this.editorView.state.doc.toString(),
      this.renderHost,
    );
  }

  private scheduleSave(): void {
    if (this.saveTimer !== null) {
      window.clearTimeout(this.saveTimer);
    }
    if (this.statusEl) {
      this.statusEl.setText("编辑中…");
    }
    this.saveTimer = window.setTimeout(() => {
      this.saveTimer = null;
      void this.save();
    }, 400);
  }

  private async save(): Promise<void> {
    if (this.saving || !this.file || !this.editorView) {
      return;
    }
    const content = this.editorView.state.doc.toString();
    if (content === this.lastSaved) {
      return;
    }
    this.saving = true;
    if (this.statusEl) {
      this.statusEl.setText("保存中…");
    }
    try {
      await this.app.vault.modify(this.file, content);
      this.lastSaved = content;
      if (this.statusEl) {
        this.statusEl.setText("已保存");
      }
    } catch (error) {
      console.error("Novel View: special editor save failed", error);
      if (this.statusEl) {
        this.statusEl.setText("保存失败");
      }
      new Notice("Novel View：特殊设定保存失败。");
    } finally {
      this.saving = false;
    }
  }
}
