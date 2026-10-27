import {
  ItemView,
  setIcon,
  type WorkspaceLeaf,
} from "obsidian";
import type {
  SearchFileResult,
  SearchResponse,
} from "./core/search";
import type NovelViewPlugin from "./main";

export const SEARCH_RESULTS_VIEW_TYPE = "novelview-search-results";

export class NovelSearchResultsView extends ItemView {
  private readonly plugin: NovelViewPlugin;
  private response: SearchResponse | null = null;
  private loading:
    | { active: true; query: string }
    | { active: false; query: string } = { active: false, query: "" };

  constructor(leaf: WorkspaceLeaf, plugin: NovelViewPlugin) {
    super(leaf);
    this.plugin = plugin;
    this.navigation = false;
  }

  override getViewType(): string {
    return SEARCH_RESULTS_VIEW_TYPE;
  }

  override getDisplayText(): string {
    return "NovelView 查找结果";
  }

  override getIcon(): string {
    return "search";
  }

  protected override async onOpen(): Promise<void> {
    this.contentEl.empty();
    this.contentEl.addClass("novelview-search-results-view");
    this.render();
  }

  protected override async onClose(): Promise<void> {
    this.contentEl.empty();
  }

  setLoading(query: string): void {
    this.loading = { active: true, query };
    this.render();
  }

  setResponse(response: SearchResponse | null): void {
    this.response = response;
    this.loading = { active: false, query: response?.query ?? "" };
    this.render();
  }

  private render(): void {
    this.contentEl.empty();

    const header = this.contentEl.createDiv({
      cls: "novelview-search-results-header",
    });
    const heading = header.createDiv({
      cls: "novelview-search-results-heading",
    });
    heading.createDiv({
      cls: "novelview-search-results-kicker",
      text: "高级查找结果",
    });

    const actions = header.createDiv({
      cls: "novelview-search-results-actions",
    });
    this.createActionButton(actions, "rotate-cw", "重新搜索", () => {
      void this.plugin.rerunSearch();
    });
    this.createActionButton(actions, "search", "高级查找", () => {
      void this.plugin.openAdvancedSearch();
    });

    if (this.loading.active) {
      heading.createDiv({
        cls: "novelview-search-results-query",
        text: this.loading.query ? `“${this.loading.query}”` : "正在搜索…",
      });
      this.renderMessage("正在扫描当前小说目录…", "loading");
      return;
    }

    const response = this.response;
    if (!response) {
      heading.createDiv({
        cls: "novelview-search-results-query",
        text: "尚未查找",
      });
      this.renderMessage("打开高级查找，在弹层中输入要查找的内容。", "empty");
      return;
    }

    heading.createDiv({
      cls: "novelview-search-results-query",
      text: response.query ? `“${response.query}”` : "空查找",
    });

    if (response.error) {
      this.renderMessage(response.error, "error");
      return;
    }

    const scope = this.contentEl.createDiv({
      cls: "novelview-search-results-scope",
    });
    const folder = response.folderPath || "Vault 根目录";
    scope.createSpan({ text: folder });
    scope.createSpan({
      cls: "novelview-search-results-summary",
      text: `${response.totalMatches} 处匹配 · ${response.files.length}/${response.scannedFiles} 个文件`,
    });

    if (response.truncated) {
      this.contentEl.createDiv({
        cls: "novelview-search-results-truncated",
        text: "结果过多，只显示了前一部分匹配。请缩小查找范围或使用更精确的关键词。",
      });
    }

    if (response.files.length === 0) {
      this.renderMessage(
        response.query.length === 0
          ? "输入查找内容后再搜索。"
          : "当前小说目录中没有找到匹配。",
        "empty",
      );
      return;
    }

    const list = this.contentEl.createDiv({
      cls: "novelview-search-results-list",
    });
    for (const file of response.files) {
      this.renderFileGroup(list, file);
    }
  }

  private renderFileGroup(parent: HTMLElement, file: SearchFileResult): void {
    const group = parent.createDiv({
      cls: "novelview-search-result-file",
    });
    const header = group.createDiv({
      cls: "novelview-search-result-file-header",
    });
    const title = header.createDiv({
      cls: "novelview-search-result-file-title",
    });
    title.setText(file.basename);
    title.setAttr("title", file.path);
    header.createSpan({
      cls: "novelview-search-result-file-count",
      text: String(file.matches.length),
    });

    for (const match of file.matches) {
      const row = group.createEl("button", {
        cls: "novelview-search-result",
        attr: {
          type: "button",
          title: `第 ${match.line} 行，第 ${match.column} 列`,
        },
      });
      row.createDiv({
        cls: "novelview-search-result-meta",
        text: `第 ${match.line} 行 · 第 ${match.column} 列`,
      });
      const snippet = row.createDiv({
        cls: "novelview-search-result-snippet",
      });
      snippet.createSpan({ text: match.before });
      snippet.createEl("mark", { text: match.matchText });
      snippet.appendText(match.after);
      row.addEventListener("click", () => {
        void this.plugin.openSearchMatch(file.path, match);
      });
    }
  }

  private renderMessage(
    text: string,
    tone: "loading" | "empty" | "error",
  ): void {
    const message = this.contentEl.createDiv({
      cls: "novelview-search-results-message",
      text,
    });
    message.dataset.tone = tone;
  }

  private createActionButton(
    parent: HTMLElement,
    icon: string,
    label: string,
    onClick: () => void,
  ): void {
    const button = parent.createEl("button", {
      cls: "novelview-search-results-action",
      attr: {
        type: "button",
        "aria-label": label,
        title: label,
      },
    });
    setIcon(button, icon);
    button.addEventListener("click", onClick);
  }
}
