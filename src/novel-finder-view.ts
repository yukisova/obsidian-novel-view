import { ItemView, setIcon, type WorkspaceLeaf } from "obsidian";
import type NovelViewPlugin from "./main";
import type { FinderContext, FinderResult } from "./search-panel-v2";

export const NOVEL_FINDER_VIEW_TYPE = "novelview-finder-results";

const OPTION_LABELS: Array<{
  key: "caseSensitive" | "wholeWord" | "regex";
  label: string;
}> = [
  { key: "caseSensitive", label: "Aa 大小写" },
  { key: "wholeWord", label: "全词" },
  { key: "regex", label: ".* 正则" },
];

export class NovelFinderView extends ItemView {
  private readonly plugin: NovelViewPlugin;
  private results: FinderResult[] = [];
  private context: FinderContext | null = null;

  constructor(leaf: WorkspaceLeaf, plugin: NovelViewPlugin) {
    super(leaf);
    this.plugin = plugin;
    this.navigation = false;
  }

  getViewType(): string {
    return NOVEL_FINDER_VIEW_TYPE;
  }

  getDisplayText(): string {
    return "NovelFinder 结果";
  }

  getIcon(): string {
    return "search";
  }

  async onOpen(): Promise<void> {
    this.contentEl.addClass("novelview-finder-results");
    this.render();
  }

  setResults(context: FinderContext, results: FinderResult[]): void {
    this.context = context;
    this.results = results;
    this.render();
  }

  private render(): void {
    this.contentEl.empty();
    this.contentEl.addClass("novelview-finder-results");
    for (const scope of [
      "chapter", "volume", "book", "marks", "pending", "keywords",
    ]) {
      this.contentEl.removeClass(`is-scope-${scope}`);
    }
    const context = this.context;
    if (!context) {
      this.contentEl.createDiv({
        cls: "novelview-finder-empty",
        text: "打开 NovelFinder 开始查找。",
      });
      return;
    }
    this.contentEl.addClass(`is-scope-${context.scope}`);
    this.renderHeader(context);
    if (this.results.length === 0) {
      const empty = this.contentEl.createDiv({
        cls: "novelview-finder-empty",
      });
      empty.createDiv({
        cls: "novelview-finder-empty-title",
        text: context.query.trim() ? "没有匹配结果" : "等待查找",
      });
      empty.createDiv({
        cls: "novelview-finder-empty-hint",
        text: context.query.trim()
          ? `当前${context.scopeLabel}范围内没有找到匹配。`
          : "在 NovelFinder 卡片中输入查找内容。",
      });
      return;
    }
    if (context.scope === "keywords") {
      this.renderKeywordResults();
    } else if (context.scope === "marks") {
      this.renderMarkResults();
    } else if (context.scope === "pending") {
      this.renderPendingResults();
    } else {
      this.renderFileResults(context);
    }
  }

  private renderHeader(context: FinderContext): void {
    const header = this.contentEl.createDiv({
      cls: "novelview-finder-header",
    });
    const titleRow = header.createDiv({
      cls: "novelview-finder-title-row",
    });
    titleRow.createDiv({
      cls: "novelview-finder-title",
      text: "NovelFinder",
    });
    const count = titleRow.createDiv({
      cls: "novelview-finder-count",
      text: `${context.total}`,
    });
    count.setAttr("title", "匹配数量");
    header.createDiv({
      cls: "novelview-finder-subtitle",
      text: context.groupName,
    });
    const badges = header.createDiv({
      cls: "novelview-finder-badges",
    });
    const mode = badges.createSpan({
      cls: "novelview-finder-mode",
    });
    setIcon(mode.createSpan(), "search");
    mode.createSpan({ text: context.scopeLabel });
    const query = badges.createSpan({
      cls: "novelview-finder-query",
      text: context.query.trim() ? `“${context.query.trim()}”` : "空查找词",
    });
    query.setAttr("title", context.query);
    const options = header.createDiv({
      cls: "novelview-finder-options",
    });
    for (const option of OPTION_LABELS) {
      const enabled = context[option.key];
      const chip = options.createSpan({
        cls: `novelview-finder-option${enabled ? " is-on" : ""}`,
        text: option.label,
      });
      chip.setAttr("title", enabled ? "已启用" : "未启用");
    }
  }

  private renderFileResults(context: FinderContext): void {
    const list = this.contentEl.createDiv({
      cls: "novelview-finder-list novelview-finder-file-list",
    });
    const groups = new Map<string, FinderResult[]>();
    for (const result of this.results) {
      const key = result.path ?? result.title;
      const group = groups.get(key) ?? [];
      group.push(result);
      groups.set(key, group);
    }
    for (const results of groups.values()) {
      const first = results[0];
      const row = list.createEl("button", {
        cls: "novelview-finder-chapter-row",
        attr: {
          type: "button",
          title: first.path ?? first.title,
        },
      });
      const icon = row.createSpan({
        cls: "novelview-finder-chapter-icon",
      });
      setIcon(icon, "file-text");
      row.createSpan({
        cls: "novelview-finder-chapter-name",
        text: first.path?.split("/").pop()?.replace(/\.md$/u, "") ?? first.title,
      });
      row.createSpan({
        cls: "novelview-finder-chapter-count",
        text: `${results.length} 处`,
      });
      row.addEventListener("click", () => {
        void this.plugin.openNovelFinderResult(first, context.scope);
      });
    }
  }

  private renderMarkResults(): void {
    const list = this.contentEl.createDiv({
      cls: "novelview-finder-list novelview-finder-mark-list",
    });
    for (const result of this.results) {
      const card = list.createEl("button", {
        cls: "novelview-finder-mark-card",
        attr: { type: "button", title: result.title },
      });
      const top = card.createDiv({
        cls: "novelview-finder-mark-top",
      });
      top.createSpan({
        cls: "novelview-finder-mark-label",
        text: result.title.split(" · ").pop() ?? "文字标记",
      });
      top.createSpan({
        cls: "novelview-finder-location",
        text: `${result.path?.split("/").pop()?.replace(/\.md$/u, "") ?? ""} · L${result.line ?? 1}`,
      });
      card.createDiv({
        cls: "novelview-finder-mark-excerpt",
        text: result.detail || "（空标记）",
      });
      card.addEventListener("click", () => {
        void this.plugin.openNovelFinderResult(result, this.context?.scope);
      });
    }
  }

  private renderPendingResults(): void {
    const list = this.contentEl.createDiv({
      cls: "novelview-finder-list novelview-finder-pending-list",
    });
    for (const result of this.results) {
      const card = list.createEl("button", {
        cls: "novelview-finder-pending-card",
        attr: { type: "button", title: result.title },
      });
      const top = card.createDiv({
        cls: "novelview-finder-pending-top",
      });
      top.createSpan({
        cls: "novelview-finder-pending-badge",
        text: "待修改部分",
      });
      top.createSpan({
        cls: "novelview-finder-location",
        text: `${result.path?.split("/").pop()?.replace(/\.md$/u, "") ?? ""} · L${result.line ?? 1}`,
      });
      card.createDiv({
        cls: "novelview-finder-pending-body",
        text: result.detail || "（空内容）",
      });
      card.addEventListener("click", () => {
        void this.plugin.openNovelFinderResult(result, this.context?.scope);
      });
    }
  }

  private renderKeywordResults(): void {
    const list = this.contentEl.createDiv({
      cls: "novelview-finder-list novelview-finder-keyword-list",
    });
    for (const result of this.results) {
      const card = list.createEl("button", {
        cls: "novelview-finder-keyword-card",
        attr: { type: "button", title: result.title },
      });
      const top = card.createDiv({
        cls: "novelview-finder-keyword-top",
      });
      top.createSpan({
        cls: "novelview-finder-keyword-name",
        text: result.keyword ?? result.title,
      });
      const tags = top.createDiv({
        cls: "novelview-finder-keyword-tags",
      });
      if (result.group) {
        tags.createSpan({
          cls: "novelview-finder-keyword-group",
          text: result.group,
        });
      }
      if (result.tag) {
        tags.createSpan({
          cls: "novelview-finder-keyword-tag",
          text: result.tag,
        });
      }
      card.createDiv({
        cls: "novelview-finder-keyword-detail",
        text: result.detail || "（无简介）",
      });
      card.addEventListener("click", () => {
        void this.plugin.openNovelFinderResult(result, this.context?.scope);
      });
    }
  }
}
