import { setIcon } from "obsidian";
import type { SearchUiState } from "./core/search";

export type SearchStatusTone = "idle" | "searching" | "found" | "empty" | "error";

export interface SearchPanelCallbacks {
  onSearchChange: (state: SearchUiState, immediate: boolean) => void;
  onReplaceAll: (state: SearchUiState) => void;
  onClose: (state: SearchUiState) => void;
}

export const DEFAULT_SEARCH_UI_STATE: SearchUiState = {
  query: "",
  replacement: "",
  caseSensitive: false,
  wholeWord: false,
  regex: false,
};

/**
 * Modeless floating find/replace panel. Search results live in the right
 * sidebar so this panel can stay open while the user inspects individual hits.
 */
export class AdvancedSearchPanel {
  private readonly callbacks: SearchPanelCallbacks;
  private state: SearchUiState = { ...DEFAULT_SEARCH_UI_STATE };
  private root: HTMLElement | null = null;
  private searchInput: HTMLInputElement | null = null;
  private replaceInput: HTMLInputElement | null = null;
  private scopeEl: HTMLElement | null = null;
  private statusEl: HTMLElement | null = null;
  private replaceButton: HTMLButtonElement | null = null;
  private optionButtons = new Map<keyof Pick<SearchUiState, "caseSensitive" | "wholeWord" | "regex">, HTMLButtonElement>();
  private busy = false;
  private canReplace = false;
  private openState = false;

  constructor(callbacks: SearchPanelCallbacks) {
    this.callbacks = callbacks;
  }

  get isOpen(): boolean {
    return this.openState;
  }

  open(state: SearchUiState = this.state): void {
    if (this.openState) {
      this.focus();
      return;
    }

    this.mount();
    this.state = { ...state };
    this.syncFields();

    this.openState = true;
    this.root?.addClass("is-open");
    this.focus();
  }

  close(): void {
    if (!this.openState) {
      return;
    }

    this.openState = false;
    this.root?.removeClass("is-open");
    this.callbacks.onClose(this.getState());
  }

  destroy(): void {
    this.root?.remove();
    this.root = null;
    this.searchInput = null;
    this.replaceInput = null;
    this.scopeEl = null;
    this.statusEl = null;
    this.replaceButton = null;
    this.optionButtons.clear();
    this.openState = false;
  }

  getState(): SearchUiState {
    return { ...this.state };
  }

  setScope(text: string): void {
    this.scopeEl?.setText(text);
  }

  setBusy(busy: boolean): void {
    this.busy = busy;
    this.syncReplaceButton();
  }

  setStatus(text: string, tone: SearchStatusTone): void {
    if (!this.statusEl) {
      return;
    }
    this.statusEl.setText(text);
    this.statusEl.dataset.tone = tone;
  }

  setCanReplace(value: boolean): void {
    this.canReplace = value;
    this.syncReplaceButton();
  }

  focus(): void {
    window.setTimeout(() => {
      this.searchInput?.focus();
      this.searchInput?.select();
    }, 0);
  }

  private mount(): void {
    if (this.root) {
      return;
    }

    const root = document.createElement("div");
    root.className = "novelview-search-panel";
    root.setAttr("role", "dialog");
    root.setAttr("aria-label", "高级查找与替换");
    root.addEventListener("keydown", (event) => {
      if (event.key === "Escape") {
        event.preventDefault();
        this.close();
      }
    });

    const header = root.createDiv({ cls: "novelview-search-header" });
    const titleIcon = header.createSpan({ cls: "novelview-search-header-icon" });
    titleIcon.setAttr("aria-hidden", "true");
    setIcon(titleIcon, "search");

    const titleBlock = header.createDiv({ cls: "novelview-search-title-block" });
    titleBlock.createDiv({
      cls: "novelview-search-title",
      text: "高级查找与替换",
    });
    this.scopeEl = titleBlock.createDiv({
      cls: "novelview-search-scope",
      text: "范围：尚未打开小说章节",
    });

    const closeButton = header.createEl("button", {
      cls: "novelview-search-close",
      attr: {
        type: "button",
        "aria-label": "关闭高级查找与替换",
        title: "关闭",
      },
    });
    setIcon(closeButton, "x");
    closeButton.addEventListener("click", () => this.close());

    const body = root.createDiv({ cls: "novelview-search-body" });

    const searchRow = body.createDiv({ cls: "novelview-search-row" });
    const searchIcon = searchRow.createSpan({ cls: "novelview-search-row-icon" });
    searchIcon.setAttr("aria-hidden", "true");
    setIcon(searchIcon, "text-search");
    this.searchInput = searchRow.createEl("input", {
      cls: "novelview-search-input",
      attr: {
        type: "text",
        spellcheck: "false",
        autocomplete: "off",
        "aria-label": "查找内容",
        placeholder: "查找内容…",
      },
    });
    this.searchInput.addEventListener("input", () => {
      this.state.query = this.searchInput?.value ?? "";
      this.emitChange(false);
    });
    this.searchInput.addEventListener("keydown", (event) => {
      if (event.key === "Enter") {
        event.preventDefault();
        this.emitChange(true);
      }
    });

    const findButton = searchRow.createEl("button", {
      cls: "novelview-search-submit",
      attr: { type: "button", "aria-label": "立即查找", title: "立即查找（Enter）" },
    });
    setIcon(findButton, "arrow-right");
    findButton.addEventListener("click", () => this.emitChange(true));

    const optionsRow = body.createDiv({ cls: "novelview-search-options" });
    optionsRow.setAttr("role", "group");
    optionsRow.setAttr("aria-label", "查找选项");

    this.createOptionButton(
      optionsRow,
      "caseSensitive",
      "Aa",
      "区分大小写",
    );
    this.createOptionButton(
      optionsRow,
      "wholeWord",
      "全词",
      "全词匹配",
    );
    this.createOptionButton(
      optionsRow,
      "regex",
      ".*",
      "正则表达式",
    );

    const replaceRow = body.createDiv({ cls: "novelview-search-row" });
    const replaceIcon = replaceRow.createSpan({ cls: "novelview-search-row-icon" });
    replaceIcon.setAttr("aria-hidden", "true");
    setIcon(replaceIcon, "replace");
    this.replaceInput = replaceRow.createEl("input", {
      cls: "novelview-search-input",
      attr: {
        type: "text",
        spellcheck: "false",
        autocomplete: "off",
        "aria-label": "替换为",
        placeholder: "替换为…",
      },
    });
    this.replaceInput.addEventListener("input", () => {
      this.state.replacement = this.replaceInput?.value ?? "";
    });
    this.replaceInput.addEventListener("keydown", (event) => {
      if (event.key === "Enter") {
        event.preventDefault();
      }
    });

    const footer = body.createDiv({ cls: "novelview-search-footer" });
    this.statusEl = footer.createDiv({
      cls: "novelview-search-status",
      text: "输入内容后在当前小说目录中查找。",
    });
    this.statusEl.dataset.tone = "idle";

    this.replaceButton = footer.createEl("button", {
      cls: "novelview-search-replace-all",
      attr: {
        type: "button",
        "aria-label": "在当前目录的所有小说文件中替换全部匹配",
        title: "在当前目录的所有小说文件中替换全部匹配",
      },
    });
    this.replaceButton.setText("全部替换");
    this.replaceButton.disabled = true;
    this.replaceButton.addEventListener("click", () => {
      this.callbacks.onReplaceAll(this.getState());
    });

    document.body.appendChild(root);
    this.root = root;
    this.syncFields();
  }

  private createOptionButton(
    parent: HTMLElement,
    key: "caseSensitive" | "wholeWord" | "regex",
    label: string,
    title: string,
  ): void {
    const button = parent.createEl("button", {
      cls: "novelview-search-option",
      text: label,
      attr: {
        type: "button",
        "aria-label": title,
        title,
        "aria-pressed": "false",
      },
    });
    button.addEventListener("click", () => {
      this.state[key] = !this.state[key];
      this.syncOptionButtons();
      this.emitChange(true);
    });
    this.optionButtons.set(key, button);
  }

  private emitChange(immediate: boolean): void {
    this.callbacks.onSearchChange(this.getState(), immediate);
  }

  private syncFields(): void {
    if (this.searchInput) {
      this.searchInput.value = this.state.query;
    }
    if (this.replaceInput) {
      this.replaceInput.value = this.state.replacement;
    }
    this.syncOptionButtons();
    this.syncReplaceButton();
  }

  private syncOptionButtons(): void {
    for (const [key, button] of this.optionButtons) {
      const active = this.state[key];
      button.toggleClass("is-active", active);
      button.setAttr("aria-pressed", String(active));
    }
  }

  private syncReplaceButton(): void {
    if (this.replaceButton) {
      this.replaceButton.disabled = !this.canReplace || this.busy;
    }
  }
}
