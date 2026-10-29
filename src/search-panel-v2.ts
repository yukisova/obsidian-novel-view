import { Notice, TFile, type MarkdownView } from "obsidian";
import {
  compileSearchExpression,
  findSearchMatches,
  replaceSearchMatches,
} from "./core/search";
import type NovelViewPlugin from "./main";

type SearchScope = "chapter" | "volume" | "book" | "links";

const SCOPE_LABELS: Record<SearchScope, string> = {
  chapter: "全章",
  volume: "本卷",
  book: "全书",
  links: "联动库文件",
};

export class SearchPanelV2 {
  private readonly plugin: NovelViewPlugin;
  private root: HTMLElement | null = null;
  private resultsEl: HTMLElement | null = null;
  private titleEl: HTMLElement | null = null;
  private groupLabel: HTMLElement | null = null;
  private queryInput: HTMLInputElement | null = null;
  private replaceInput: HTMLInputElement | null = null;
  private scopeSelect: HTMLSelectElement | null = null;
  private caseInput: HTMLInputElement | null = null;
  private wordInput: HTMLInputElement | null = null;
  private regexInput: HTMLInputElement | null = null;
  private activeScope: SearchScope = "chapter";
  private ownerView: MarkdownView | null = null;


  constructor(plugin: NovelViewPlugin) {
    this.plugin = plugin;
  }

  open(view?: MarkdownView): void {
    if (this.root) {
      this.ownerView = view ?? this.ownerView;
      this.root.addClass("is-open");
      this.queryInput?.focus();
      void this.search();
      return;
    }
    this.ownerView = view ?? null;
    this.root = createEl("div", { cls: "novelview-search-v2" });
    this.root.addClass("is-open");
    this.root.setAttr("role", "dialog");
    this.root.setAttr("aria-label", "高级查找替换");
    const header = this.root.createDiv({ cls: "novelview-search-v2-header" });
    header.createSpan({ text: "高级查找替换" });
    this.groupLabel = this.root.createDiv({ cls: "novelview-search-v2-group" });
    header.addEventListener("pointerdown", (event) => {
      if ((event.target as HTMLElement | null)?.closest("button")) {
        return;
      }
      const root = this.root;
      if (!root) {
        return;
      }
      const rect = root.getBoundingClientRect();
      const offsetX = event.clientX - rect.left;
      const offsetY = event.clientY - rect.top;
      root.style.transform = "none";
      const move = (moveEvent: PointerEvent): void => {
        root.style.left = `${Math.round(moveEvent.clientX - offsetX)}px`;
        root.style.top = `${Math.round(moveEvent.clientY - offsetY)}px`;
      };
      const up = (): void => {
        window.removeEventListener("pointermove", move);
        window.removeEventListener("pointerup", up);
      };
      window.addEventListener("pointermove", move);
      window.addEventListener("pointerup", up);
      event.preventDefault();
    });
    const close = header.createEl("button", { text: "×", attr: { type: "button" } });
    close.addEventListener("click", () => this.close());

    const top = this.root.createDiv({ cls: "novelview-search-v2-controls" });
    this.scopeSelect = top.createEl("select", { attr: { "aria-label": "查找范围" } });
    for (const scope of Object.keys(SCOPE_LABELS) as SearchScope[]) {
      this.scopeSelect.createEl("option", { text: SCOPE_LABELS[scope], attr: { value: scope } });
    }
    this.scopeSelect.addEventListener("change", () => {
      this.activeScope = this.scopeSelect?.value as SearchScope ?? "chapter";
      void this.search();
    });
    this.queryInput = top.createEl("input", {
      attr: { type: "text", placeholder: "查找内容", "aria-label": "查找内容" },
    });
    this.replaceInput = top.createEl("input", {
      attr: { type: "text", placeholder: "替换为", "aria-label": "替换为" },
    });
    const options = this.root.createDiv({ cls: "novelview-search-v2-options" });
    this.caseInput = this.option(options, "区分大小写");
    this.wordInput = this.option(options, "全词");
    this.regexInput = this.option(options, "正则");
    const actions = this.root.createDiv({ cls: "novelview-search-v2-actions" });
    this.queryInput.addEventListener("input", () => {
      window.clearTimeout((this as any).debounceTimer);
      (this as any).debounceTimer = window.setTimeout(() => void this.search(), 220);
    });
    this.replaceInput.addEventListener("input", () => {
      window.clearTimeout((this as any).debounceTimer);
      (this as any).debounceTimer = window.setTimeout(() => void this.search(), 220);
    });
    actions.createEl("button", { text: "全部替换", attr: { type: "button" } })
      .addEventListener("click", () => void this.replaceAll());

    this.titleEl = this.root.createDiv({ cls: "novelview-search-v2-title" });
    this.resultsEl = this.root.createDiv({ cls: "novelview-search-v2-results" });
    this.root.addEventListener("keydown", (event) => {
      if (event.key === "Escape") {
        this.close();
      }
    });
    document.body.appendChild(this.root);
    window.setTimeout(() => this.queryInput?.focus(), 0);
  }

  close(): void {
    this.root?.remove();
    this.root = null;
    this.resultsEl = null;
    this.ownerView = null;
  }

  private option(parent: HTMLElement, label: string): HTMLInputElement {
    const wrapper = parent.createEl("label");
    const input = wrapper.createEl("input", { attr: { type: "checkbox" } });
    wrapper.createSpan({ text: label });
    return input;
  }

  private async searchFiles(): Promise<TFile[]> {
    const current = this.plugin.getLastActiveMarkdownFile();
    if (!current) {
      return [];
    }
    const group = this.plugin.findNovelGroupRoot(
      this.plugin.normalizeFolderPath(current.parent?.path ?? "/"),
    );
    if (!group) {
      return this.activeScope === "chapter" ? [current] : [];
    }
    if (this.activeScope === "chapter") {
      return [current];
    }
    if (this.activeScope === "links") {
      const data = await this.plugin.readLinkLibrary(group);
      return data.links
        .map((link) => this.plugin.getLinkTargetFile(group, link.path))
        .filter((file: TFile | null): file is TFile => file instanceof TFile);
    }
    if (this.activeScope === "volume") {
      const parent = this.plugin.normalizeFolderPath(current.parent?.path ?? "/");
      const folder = parent === group ? group : parent;
      return this.plugin.app.vault.getMarkdownFiles().filter((file: TFile) => (
        this.plugin.normalizeFolderPath(file.parent?.path ?? "/") === folder
        && !this.plugin.isSpecialNovelFile(file)
      ));
    }
    return this.plugin.app.vault.getMarkdownFiles().filter((file: TFile) => (
      file.path.startsWith(`${group}/`)
      && !this.plugin.isSpecialNovelFile(file)
    ));
  }

  private options() {
    return {
      query: this.queryInput?.value ?? "",
      replacement: this.replaceInput?.value ?? "",
      caseSensitive: !!this.caseInput?.checked,
      wholeWord: !!this.wordInput?.checked,
      regex: !!this.regexInput?.checked,
    };
  }

  private async search(): Promise<void> {
    if (!this.resultsEl || !this.titleEl) {
      return;
    }
    this.resultsEl.empty();
    const options = this.options();
    const compiled = compileSearchExpression(options);
    if (!compiled.regex) {
      this.titleEl.setText("查找结果 · 请输入查找内容");
      return;
    }
    const files = await this.searchFiles();
    const current = this.plugin.getLastActiveMarkdownFile();
    const group = current
      ? this.plugin.findNovelGroupRoot(
        this.plugin.normalizeFolderPath(current.parent?.path ?? "/"),
      )
      : null;
    const groupName = group
      ? this.plugin.getNovelGroupInfo(group)?.name ?? group
      : "未归属小说组";
    if (this.groupLabel) {
      this.groupLabel.setText(`小说组：${groupName}`);
    }
    let total = 0;
    this.titleEl.setText(
      `查找结果 · ${SCOPE_LABELS[this.activeScope]} · ${groupName}`,
    );
    const grouped: Array<{ file: TFile; matches: ReturnType<typeof findSearchMatches>["matches"] }> = [];
    for (const file of files) {
      let text = "";
      try {
        text = await this.plugin.app.vault.cachedRead(file);
      } catch {
        continue;
      }
      const { matches } = findSearchMatches(text, compiled.regex, 50);
      if (matches.length > 0) {
        grouped.push({ file, matches });
        total += matches.length;
      }
    }
    for (const group of grouped) {
      const fileGroup = this.resultsEl.createDiv({ cls: "novelview-search-v2-file-group" });
      const header = fileGroup.createEl("button", {
        cls: "novelview-search-v2-file-header",
        attr: { type: "button" },
      });
      header.createSpan({ cls: "novelview-search-v2-file-name", text: group.file.basename });
      header.createSpan({
        cls: "novelview-search-v2-file-count",
        text: `${group.matches.length} 处`,
      });
      const details = fileGroup.createDiv({ cls: "novelview-search-v2-file-details" });
      details.addClass("is-collapsed");
      header.addEventListener("click", () => {
        details.toggleClass("is-collapsed", !details.hasClass("is-collapsed"));
        header.toggleClass("is-open", !header.hasClass("is-open"));
      });
      for (const match of group.matches) {
        const card = details.createEl("button", {
          cls: "novelview-search-v2-card",
          attr: { type: "button", title: `${group.file.path}:${match.line}` },
        });
        card.createDiv({
          cls: "novelview-search-v2-card-title",
          text: `第 ${match.line} 行`,
        });
        card.createDiv({
          cls: "novelview-search-v2-card-snippet",
          text: `${match.before}${match.matchText}${match.after}`,
        });
        card.addEventListener("click", () => {
          void this.plugin.openFileAtLine(group.file, match.line ?? 1);
        });
      }
    }
    if (total === 0) {
      this.resultsEl.createDiv({
        cls: "novelview-search-v2-empty",
        text: "没有匹配结果。",
      });
    }
  }

  private async replaceAll(): Promise<void> {
    const options = this.options();
    const compiled = compileSearchExpression(options);
    if (!compiled.regex) {
      return;
    }
    const files = await this.searchFiles();
    let count = 0;
    for (const file of files) {
      try {
        await this.plugin.app.vault.process(file, (text) => {
          const replaced = replaceSearchMatches(
            text,
            compiled.regex as RegExp,
            options.replacement,
            options.regex,
          );
          count += replaced.count;
          return replaced.text;
        });
      } catch {
        // Skip unreadable/binary files.
      }
    }
    new Notice(`NovelView：已替换 ${count} 处。`);
    await this.search();
  }
}
