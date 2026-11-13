import { ItemView, type WorkspaceLeaf } from "obsidian";
import type NovelViewPlugin from "./main";
import type { FinderResult } from "./search-panel-v2";

export const NOVEL_FINDER_VIEW_TYPE = "novelview-finder-results";

export class NovelFinderView extends ItemView {
  private readonly plugin: NovelViewPlugin;
  private results: FinderResult[] = [];
  private heading = "NovelFinder";

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

  setResults(heading: string, results: FinderResult[]): void {
    this.heading = heading;
    this.results = results;
    this.render();
  }

  private render(): void {
    this.contentEl.empty();
    const header = this.contentEl.createDiv({
      cls: "novelview-finder-header",
    });
    header.createDiv({
      cls: "novelview-finder-title",
      text: "NovelFinder",
    });
    header.createDiv({
      cls: "novelview-finder-subtitle",
      text: `${this.heading} · ${this.results.length} 条`,
    });
    if (this.results.length === 0) {
      this.contentEl.createDiv({
        cls: "novelview-finder-empty",
        text: "暂无结果。在 NovelFinder 卡片中输入查找内容。",
      });
      return;
    }
    const list = this.contentEl.createDiv({
      cls: "novelview-finder-list",
    });
    for (const result of this.results) {
      const card = list.createEl("button", {
        cls: "novelview-finder-card",
        attr: {
          type: "button",
          title: result.title,
        },
      });
      card.createDiv({
        cls: "novelview-finder-card-title",
        text: result.title,
      });
      if (result.detail) {
        card.createDiv({
          cls: "novelview-finder-card-detail",
          text: result.detail,
        });
      }
      const meta = card.createDiv({
        cls: "novelview-finder-card-meta",
      });
      meta.createSpan({
        text: result.kind === "setting" ? "设定记录" : "文章",
      });
      if (result.path) {
        meta.createSpan({ text: result.path });
      }
      card.addEventListener("click", () => {
        void this.plugin.openNovelFinderResult(result);
      });
    }
  }
}
