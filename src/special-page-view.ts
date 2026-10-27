import {
  ItemView,
  MarkdownRenderer,
  setIcon,
  type TFile,
  type ViewStateResult,
  type WorkspaceLeaf,
} from "obsidian";
import type { CategorySection } from "./core/category-file";
import type { OutlineEntry } from "./core/outline";
import {
  getSpecialPageKind,
  SPECIAL_PAGE_LABELS,
} from "./core/special-page";
import type NovelViewPlugin from "./main";

export const SPECIAL_PAGE_VIEW_TYPE = "novelview-special-page";

export class SpecialPageView extends ItemView {
  private readonly plugin: NovelViewPlugin;
  private filePath = "";
  private targetLine = 0;
  private renderToken = 0;
  private refreshFrame: number | null = null;

  constructor(leaf: WorkspaceLeaf, plugin: NovelViewPlugin) {
    super(leaf);
    this.plugin = plugin;
    this.navigation = false;
  }

  override getViewType(): string {
    return SPECIAL_PAGE_VIEW_TYPE;
  }

  override getDisplayText(): string {
    const file = this.app.vault.getAbstractFileByPath(this.filePath);
    if (file instanceof Object && "name" in file) {
      const kind = getSpecialPageKind((file as { name: string }).name);
      if (kind) {
        return `NovelView ${SPECIAL_PAGE_LABELS[kind]}`;
      }
    }
    return "NovelView 特殊页面";
  }

  override getIcon(): string {
    return "file-text";
  }

  override getState(): Record<string, unknown> {
    return { filePath: this.filePath, line: this.targetLine || undefined };
  }

  override async setState(
    state: Record<string, unknown>,
    result: ViewStateResult,
  ): Promise<void> {
    if (typeof state.filePath === "string") {
      this.filePath = state.filePath;
    }
    if (typeof state.line === "number" && Number.isFinite(state.line)) {
      this.targetLine = Math.max(1, Math.floor(state.line));
    }
    result.history = true;
    await super.setState(state, result);
    this.scheduleRender();
  }

  protected override async onOpen(): Promise<void> {
    this.contentEl.empty();
    this.contentEl.addClass("novelview-special-page");
    this.addAction("refresh-cw", "刷新特殊页面", () => this.scheduleRender());
    this.registerEvent(
      this.app.vault.on("modify", (file) => {
        if (file.path === this.filePath) {
          this.scheduleRender();
        }
      }),
    );
    this.registerEvent(
      this.app.vault.on("delete", (file) => {
        if (file.path === this.filePath) {
          this.scheduleRender();
        }
      }),
    );
    this.registerEvent(
      this.app.vault.on("rename", (file, oldPath) => {
        if (oldPath === this.filePath) {
          this.filePath = file.path;
          this.scheduleRender();
        }
      }),
    );
    await this.render();
  }

  protected override async onClose(): Promise<void> {
    this.renderToken += 1;
    if (this.refreshFrame !== null) {
      window.cancelAnimationFrame(this.refreshFrame);
      this.refreshFrame = null;
    }
    this.contentEl.empty();
  }

  private scheduleRender(): void {
    if (this.refreshFrame !== null) {
      return;
    }
    this.refreshFrame = window.requestAnimationFrame(() => {
      this.refreshFrame = null;
      void this.render();
    });
  }

  private async render(): Promise<void> {
    const token = ++this.renderToken;
    this.contentEl.empty();
    this.contentEl.addClass("novelview-special-page");

    const file = this.app.vault.getAbstractFileByPath(this.filePath);
    if (!(file instanceof Object) || !("path" in file)) {
      this.renderMessage("文件不存在或已被移动。");
      return;
    }
    const target = file as TFile;
    const kind = getSpecialPageKind(target.name);
    if (!kind) {
      this.renderMessage("该文件不是 NovelView 特殊页面类型。");
      return;
    }
    this.contentEl.toggleClass("is-inspiration", kind === "inspiration");

    const folderPath = this.plugin.normalizeFolderPath(target.parent?.path ?? "/");
    const header = this.contentEl.createDiv({
      cls: "novelview-special-header",
    });
    const headerText = header.createDiv({
      cls: "novelview-special-header-text",
    });
    headerText.createDiv({
      cls: "novelview-special-kicker",
      text: "NovelView 特殊页面",
    });
    headerText.createDiv({
      cls: "novelview-special-title",
      text: SPECIAL_PAGE_LABELS[kind],
    });
    headerText.createDiv({
      cls: "novelview-special-path",
      text: target.path,
    });

    if (kind !== "outline" && kind !== "inspiration") {
      const add = header.createEl("button", {
        cls: "novelview-special-add",
        attr: {
          type: "button",
          "aria-label": `新增${SPECIAL_PAGE_LABELS[kind]}`,
          title: `新增${SPECIAL_PAGE_LABELS[kind]}`,
        },
      });
      setIcon(add, "plus");
      add.createSpan({ text: "新增" });
      add.addEventListener("click", () => {
        this.plugin.promptNewCategorySection(
          folderPath,
          kind,
          () => this.scheduleRender(),
        );
      });
    }

    if (kind === "outline") {
      const outline = await this.plugin.getOutlineData(folderPath);
      if (token !== this.renderToken) {
        return;
      }
      if (!outline) {
        this.renderMessage("大纲文件尚未创建。可在文章列表右键章节或卷加入大纲。");
        return;
      }
      this.renderOutlineBody(outline.data.volume, outline.data.chapter);
      return;
    }

    const category = await this.plugin.getCategoryData(folderPath, kind);
    if (token !== this.renderToken) {
      return;
    }
    if (!category) {
      this.renderMessage(`尚未创建 ${SPECIAL_PAGE_LABELS[kind]} 文件。`);
      if (kind !== "inspiration") {
        this.renderMessage("点击上方“新增”创建第一条。");
      }
      return;
    }

    const count = this.contentEl.createDiv({
      cls: "novelview-special-count",
      text: `${category.sections.length} 条内容`,
    });
    count.setAttr("aria-label", "内容数量");

    if (category.sections.length === 0) {
      this.renderMessage(
        kind === "inspiration"
          ? "关闭“有了灵感”便签后，内容会出现在这里。"
          : "暂无内容。",
      );
      return;
    }

    const list = this.contentEl.createDiv({
      cls: kind === "inspiration"
        ? "novelview-special-list is-inspiration-grid"
        : "novelview-special-list",
    });
    for (const section of category.sections) {
      const article = list.createEl("article", {
        cls: kind === "inspiration"
          ? "novelview-special-entry is-inspiration-card"
          : "novelview-special-entry",
      });
      if (kind === "inspiration") {
        article.setAttr("role", "button");
        article.setAttr("tabindex", "0");
        article.setAttr("title", "点击恢复这条灵感便签");
      }
      article.setAttr("data-source-line", String(section.headingLine));
      const title = article.createEl("h2", {
        cls: "novelview-special-entry-title",
        text: section.heading,
      });
      title.setAttr("title", "右键修改或删除");
      if (section.keywords.length > 0) {
        article.createDiv({
          cls: "novelview-special-keywords",
          text: section.keywords.map((keyword) => `#${keyword}`).join("  "),
        });
      }
      const bodyEl = article.createDiv({
        cls: "novelview-special-entry-body",
      });
      const body = getSectionBody(category.content, section);
      if (body) {
        await MarkdownRenderer.render(
          this.app,
          body,
          bodyEl,
          target.path,
          this,
        );
      }
      if (kind === "inspiration") {
        const restore = (): void => {
          void this.plugin.restoreInspirationNote(folderPath, section);
        };
        article.addEventListener("click", restore);
        article.addEventListener("keydown", (event) => {
          if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            restore();
          }
        });
      }
      article.addEventListener("contextmenu", (event) => {
        event.preventDefault();
        this.plugin.showCategorySectionContextMenu(
          event,
          folderPath,
          kind,
          section,
          () => this.scheduleRender(),
        );
      });
    }

    this.highlightTargetLine();
  }

  private renderOutlineBody(
    volume: OutlineEntry[],
    chapter: OutlineEntry[],
  ): void {
    const slides: Array<{
      entry: OutlineEntry;
      title: string;
      body: string;
      levelLabel: string;
    }> = [];

    for (const entry of volume) {
      this.collectSlides(slides, entry, "卷纲");
    }
    for (const entry of chapter) {
      this.collectSlides(slides, entry, "章纲");
    }

    if (slides.length === 0) {
      this.renderMessage(
        "暂无大纲。可在文章列表右键章节或卷，选择“加入大纲”。",
      );
      return;
    }

    const deck = this.contentEl.createDiv({
      cls: "novelview-outline-slide-deck",
    });
    let activeIndex = 0;
    const targetIndex = this.targetLine
      ? slides.findIndex((slide) => slide.entry.line === this.targetLine)
      : -1;
    if (targetIndex >= 0) {
      activeIndex = targetIndex;
    }

    const slideEls: HTMLElement[] = [];
    const counters: HTMLElement[] = [];
    slides.forEach((slide, index) => {
      const slideEl = deck.createDiv({
        cls: "novelview-outline-slide",
      });
      slideEl.setAttr("data-source-line", String(slide.entry.line));
      slideEl.createDiv({
        cls: "novelview-outline-slide-level",
        text: slide.levelLabel,
      });
      slideEl.createDiv({
        cls: "novelview-outline-slide-title",
        text: slide.title,
      });
      const bodyEl = slideEl.createDiv({
        cls: "novelview-outline-slide-body",
      });
      if (slide.body) {
        void MarkdownRenderer.render(
          this.app,
          slide.body,
          bodyEl,
          this.filePath,
          this,
        );
      }
      const footer = slideEl.createDiv({
        cls: "novelview-outline-slide-footer",
      });
      const counter = footer.createSpan({
        cls: "novelview-outline-slide-counter",
        text: `${index + 1} / ${slides.length}`,
      });
      counters.push(counter);
      const nav = footer.createDiv({ cls: "novelview-outline-slide-nav" });
      const prev = nav.createEl("button", {
        text: "上一页",
        attr: { type: "button" },
      });
      const next = nav.createEl("button", {
        text: "下一页",
        attr: { type: "button" },
      });
      prev.disabled = index === 0;
      next.disabled = index === slides.length - 1;
      prev.addEventListener("click", () => {
        this.showSlide(slides.length, slideEls, counters, index - 1);
      });
      next.addEventListener("click", () => {
        this.showSlide(slides.length, slideEls, counters, index + 1);
      });
      slideEl.addEventListener("contextmenu", (event) => {
        event.preventDefault();
        const folderPath = this.plugin.normalizeFolderPath(
          this.app.vault.getAbstractFileByPath(this.filePath)?.parent?.path
            ?? "/",
        );
        this.plugin.showOutlineEntryContextMenu(
          event,
          folderPath,
          slide.entry,
        );
      });
      slideEls.push(slideEl);
    });

    this.showSlide(slides.length, slideEls, counters, activeIndex);
  }

  private collectSlides(
    slides: Array<{
      entry: OutlineEntry;
      title: string;
      body: string;
      levelLabel: string;
    }>,
    entry: OutlineEntry,
    levelLabel: string,
  ): void {
    const parts = entry.body
      .split(/\n\s*---\s*\n/u)
      .map((part) => part.trim())
      .filter((part, index, all) => part.length > 0 || all.length === 1);
    if (parts.length === 0) {
      slides.push({ entry, title: entry.title, body: "", levelLabel });
      return;
    }
    parts.forEach((part, index) => {
      slides.push({
        entry,
        title: index === 0 ? entry.title : `${entry.title}（续）`,
        body: part,
        levelLabel,
      });
    });
  }

  private showSlide(
    total: number,
    slides: HTMLElement[],
    counters: HTMLElement[],
    index: number,
  ): void {
    const nextIndex = Math.max(0, Math.min(total - 1, index));
    slides.forEach((slide, slideIndex) => {
      slide.toggleClass("is-active", slideIndex === nextIndex);
    });
    counters.forEach((counter, counterIndex) => {
      counter.setText(`${nextIndex + 1} / ${total}`);
      counter.toggleClass("is-active", counterIndex === nextIndex);
    });
  }

  private highlightTargetLine(): void {
    if (!this.targetLine) {
      return;
    }
    const target = this.contentEl.querySelector<HTMLElement>(
      `[data-source-line="${this.targetLine}"]`,
    );
    if (target) {
      target.addClass("is-target");
      window.setTimeout(() => {
        target.scrollIntoView({ block: "center", behavior: "smooth" });
      }, 30);
    }
  }

  private renderMessage(text: string): void {
    this.contentEl.createDiv({
      cls: "novelview-special-message",
      text,
    });
  }
}

function getSectionBody(
  content: string,
  section: CategorySection,
): string {
  const body = content.slice(section.start, section.end);
  const lines = body.split(/\r?\n/u);
  if (lines.length > 0) {
    lines.shift();
  }
  if (lines.length > 0 && /^(?:novel-keywords|keywords?|关键词|关键词列表)\s*[:：]/iu.test(lines[0] ?? "")) {
    lines.shift();
  }
  return lines.join("\n").trim();
}
