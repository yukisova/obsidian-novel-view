import { setIcon } from "obsidian";

export interface InspirationNoteData {
  id: string;
  title: string;
  content: string;
  x: number;
  y: number;
  folderPath: string;
  zIndex: number;
  sourceTitle?: string;
}

export interface InspirationNoteCallbacks {
  onClose: (note: InspirationNote) => void;
  onRename: (note: InspirationNote) => void;
}

interface DragState {
  pointerId: number;
  startX: number;
  startY: number;
  originLeft: number;
  originTop: number;
}

const DEFAULT_WIDTH = 300;
const EDGE_MARGIN = 12;

/** One of the up-to-eight floating inspiration cards. */
export class InspirationNote {
  private data: InspirationNoteData;
  private readonly callbacks: InspirationNoteCallbacks;
  private element: HTMLElement | null = null;
  private textarea: HTMLTextAreaElement | null = null;
  private titleEl: HTMLElement | null = null;
  private dragState: DragState | null = null;
  private dragCleanup: (() => void) | null = null;

  private readonly handleResize = (): void => this.keepInBounds();

  constructor(
    data: InspirationNoteData,
    callbacks: InspirationNoteCallbacks,
  ) {
    this.data = { ...data };
    this.callbacks = callbacks;
    this.mount();
  }

  getData(): InspirationNoteData {
    return { ...this.data };
  }

  get elementRef(): HTMLElement | null {
    return this.element;
  }

  setTitle(title: string): void {
    this.data.title = title.trim();
    if (this.titleEl) {
      this.titleEl.setText(this.data.title);
      this.titleEl.setAttr("title", "右键重命名");
    }
  }

  focus(): void {
    this.textarea?.focus();
  }

  destroy(): void {
    this.dragCleanup?.();
    this.dragCleanup = null;
    window.removeEventListener("resize", this.handleResize);
    this.element?.remove();
    this.element = null;
    this.textarea = null;
    this.titleEl = null;
  }

  private mount(): void {
    if (this.element) {
      return;
    }

    const root = document.createElement("div");
    root.className = "novelview-sticky-note novelview-inspiration-note";
    root.setAttr("role", "dialog");
    root.setAttr("aria-label", "灵感便签");
    root.style.zIndex = String(this.data.zIndex);

    const header = root.createDiv({ cls: "novelview-sticky-header" });
    const grip = header.createSpan({ cls: "novelview-sticky-grip" });
    grip.setAttr("aria-hidden", "true");
    setIcon(grip, "grip-horizontal");

    this.titleEl = header.createSpan({
      cls: "novelview-sticky-title novelview-inspiration-title",
      text: this.data.title,
    });
    this.titleEl.setAttr("title", "右键重命名");

    const closeButton = header.createEl("button", {
      cls: "novelview-sticky-close",
      attr: {
        type: "button",
        "aria-label": "保存并关闭便签",
        title: "保存到小说组灵感文件并关闭",
      },
    });
    setIcon(closeButton, "check");
    closeButton.addEventListener("click", (event) => {
      event.stopPropagation();
      this.callbacks.onClose(this);
    });

    const textarea = root.createEl("textarea", {
      cls: "novelview-sticky-body",
      attr: {
        "aria-label": "灵感内容",
        placeholder: "写下这一瞬间的灵感……关闭时会自动保存到小说组的灵感文件。",
        spellcheck: "true",
      },
    });
    textarea.value = this.data.content;
    textarea.addEventListener("input", () => {
      this.data.content = textarea.value;
    });
    textarea.addEventListener("keydown", (event) => {
      if (event.key === "Escape") {
        event.preventDefault();
        this.callbacks.onClose(this);
      }
    });

    header.addEventListener("contextmenu", (event) => {
      event.preventDefault();
      event.stopPropagation();
      this.callbacks.onRename(this);
    });
    header.addEventListener("pointerdown", (event) => {
      this.startDrag(event, header);
    });

    root.addClass("is-open");
    document.body.appendChild(root);
    this.element = root;
    this.textarea = textarea;
    window.addEventListener("resize", this.handleResize);
    this.keepInBounds();

    window.setTimeout(() => this.focus(), 0);
  }

  private startDrag(event: PointerEvent, handle: HTMLElement): void {
    if (event.button !== 0 || !this.element) {
      return;
    }
    if ((event.target as HTMLElement).closest("button")) {
      return;
    }

    const rect = this.element.getBoundingClientRect();
    this.dragState = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      originLeft: rect.left,
      originTop: rect.top,
    };
    handle.setPointerCapture(event.pointerId);
    event.preventDefault();

    const onMove = (moveEvent: PointerEvent): void => {
      const state = this.dragState;
      if (
        !state
        || state.pointerId !== moveEvent.pointerId
        || !this.element
      ) {
        return;
      }
      this.setPosition(
        state.originLeft + moveEvent.clientX - state.startX,
        state.originTop + moveEvent.clientY - state.startY,
      );
    };

    const onUp = (upEvent: PointerEvent): void => {
      if (!this.dragState || upEvent.pointerId !== this.dragState.pointerId) {
        return;
      }
      const rectNow = this.element?.getBoundingClientRect();
      if (rectNow) {
        this.data.x = Math.round(rectNow.left);
        this.data.y = Math.round(rectNow.top);
      }
      this.dragState = null;
      this.dragCleanup?.();
      this.dragCleanup = null;
      if (handle.hasPointerCapture(upEvent.pointerId)) {
        handle.releasePointerCapture(upEvent.pointerId);
      }
    };

    const cleanup = (): void => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onUp);
    this.dragCleanup = cleanup;
  }

  private keepInBounds(): void {
    if (!this.element) {
      return;
    }
    const rect = this.element.getBoundingClientRect();
    const width = rect.width || DEFAULT_WIDTH;
    const height = rect.height || 220;
    const maxLeft = Math.max(EDGE_MARGIN, window.innerWidth - width - EDGE_MARGIN);
    const maxTop = Math.max(EDGE_MARGIN, window.innerHeight - height - EDGE_MARGIN);
    let { x, y } = this.data;
    if (!Number.isFinite(x) || x < 0) {
      x = Math.max(EDGE_MARGIN, window.innerWidth - width - 28);
    }
    if (!Number.isFinite(y) || y < 0) {
      y = 92;
    }
    x = Math.min(Math.max(EDGE_MARGIN, x), maxLeft);
    y = Math.min(Math.max(EDGE_MARGIN, y), maxTop);
    this.element.style.left = `${Math.round(x)}px`;
    this.element.style.top = `${Math.round(y)}px`;
    this.data.x = Math.round(x);
    this.data.y = Math.round(y);
  }

  private setPosition(left: number, top: number): void {
    if (!this.element) {
      return;
    }
    const rect = this.element.getBoundingClientRect();
    const width = rect.width || DEFAULT_WIDTH;
    const height = rect.height || 220;
    const maxLeft = Math.max(EDGE_MARGIN, window.innerWidth - width - EDGE_MARGIN);
    const maxTop = Math.max(EDGE_MARGIN, window.innerHeight - height - EDGE_MARGIN);
    this.element.style.left = `${Math.round(Math.min(Math.max(EDGE_MARGIN, left), maxLeft))}px`;
    this.element.style.top = `${Math.round(Math.min(Math.max(EDGE_MARGIN, top), maxTop))}px`;
  }
}
