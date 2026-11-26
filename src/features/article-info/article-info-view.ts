import {
  ItemView,
  setIcon,
  type WorkspaceLeaf,
} from "obsidian";
import type NovelViewPlugin from "../../main";
import type { NovelEditorView } from "../novel-editor/novel-editor-view";
import {
  loadArticleSummary,
  loadFootnoteNotes,
  saveArticleSummary,
  saveFootnoteNote,
  type ArticleInfoSnapshot,
} from "./model";

export const ARTICLE_INFO_VIEW_TYPE = "novelview-article-info";

export class ArticleInfoView extends ItemView {
  private lastSignature = "";

  /** 初始化文章信息视图与依赖 */
  constructor(
    leaf: WorkspaceLeaf,
    private readonly plugin: NovelViewPlugin,
  ) {
    super(leaf);
    this.navigation = false;
  }

  /** 返回文章信息视图的类型标识 */
  override getViewType(): string {
    return ARTICLE_INFO_VIEW_TYPE;
  }

  /** 返回标签页显示的名称 */
  override getDisplayText(): string {
    return "文章信息";
  }

  /** 返回标签页使用的图标名 */
  override getIcon(): string {
    return "info";
  }

  /** 视图打开时启动定时刷新 */
  protected override async onOpen(): Promise<void> {
    this.contentEl.addClass("novelview-article-info-view");
    this.registerInterval(window.setInterval(() => this.refresh(), 500));
    this.refresh(true);
  }

  /** 视图关闭时清空内容区 */
  protected override async onClose(): Promise<void> {
    this.contentEl.empty();
  }

  /** 获取当前活动的编辑器视图 */
  private editor(): NovelEditorView | null {
    return this.plugin.getActiveNovelEditorView();
  }

  /** 按需刷新文章信息快照 */
  private refresh(force = false): void {
    const editor = this.editor();
    if (!editor) {
      if (force) {
        this.contentEl.empty();
        this.contentEl.createDiv({
          cls: "novelview-article-info-empty",
          text: "请在主区域打开 NovelEditor 章节。",
        });
      }
      return;
    }
    const snapshot = editor.getArticleInfo();
    if (!snapshot) {
      return;
    }
    const active = activeDocument.activeElement;
    if (!force && active && this.contentEl.contains(active)) {
      return;
    }
    const signature = JSON.stringify(snapshot);
    if (!force && signature === this.lastSignature) {
      return;
    }
    this.lastSignature = signature;
    this.render(snapshot, editor);
  }

  /** 立即强制刷新面板内容 */
  refreshNow(): void {
    this.refresh(true);
  }

  /** 定位脚注输入框并选中内容 */
  focusFootnote(filePath: string, key: string): void {
    const editor = this.plugin.getNovelEditorViewForPath(filePath)
      ?? this.editor();
    if (!editor) {
      return;
    }
    const snapshot = editor.getArticleInfo();
    if (!snapshot) {
      return;
    }
    this.lastSignature = JSON.stringify(snapshot);
    this.render(snapshot, editor);
    const input = this.contentEl.querySelector<HTMLTextAreaElement>(
      `[data-footnote-input="${CSS.escape(key)}"]`,
    );
    if (input) {
      input.focus();
      input.select();
    }
  }

  /** 渲染文章信息的整体布局 */
  private render(
    snapshot: ArticleInfoSnapshot,
    editor: NovelEditorView,
  ): void {
    this.contentEl.empty();
    this.contentEl.createDiv({
      cls: "novelview-article-info-title",
      text: snapshot.title,
    });
    this.contentEl.createDiv({
      cls: "novelview-article-info-divider",
    });
    this.renderSummary(snapshot);
    this.renderWordCount(snapshot);
    if (snapshot.marks.length > 0) {
      this.renderList(
        "文字标记",
        snapshot.marks.map((mark) => ({
          label: mark.label,
          meta: `第 ${mark.line} 行`,
          action: () => editor.showSearchHighlight(mark.start, mark.end),
        })),
      );
    }
    if (snapshot.pending.length > 0) {
      this.renderList(
        "对照组",
        snapshot.pending.map((block) => ({
          label: block.title,
          meta: `第 ${block.line} 行`,
          action: () => editor.showSearchHighlight(block.from, block.to),
        })),
      );
    }
    if (snapshot.footnotes.length > 0) {
      this.renderFootnotes(snapshot);
    }
  }

  /** 渲染章节内容摘要编辑区 */
  private renderSummary(snapshot: ArticleInfoSnapshot): void {
    const section = this.contentEl.createDiv({
      cls: "novelview-article-info-section",
    });
    section.createDiv({
      cls: "novelview-article-info-section-title",
      text: "内容摘要",
    });
    const input = section.createEl("textarea", {
      cls: "novelview-article-info-summary-input",
      attr: {
        rows: "4",
        placeholder: "填写本章内容梗概…",
        "aria-label": "章节内容概要",
      },
    });
    input.value = loadArticleSummary(snapshot.filePath);
    input.addEventListener("input", () => {
      saveArticleSummary(snapshot.filePath, input.value);
    });
  }

  /** 渲染当前章节字数统计 */
  private renderWordCount(snapshot: ArticleInfoSnapshot): void {
    const section = this.contentEl.createDiv({
      cls: "novelview-article-info-section novelview-article-info-stats",
    });
    section.createSpan({
      cls: "novelview-article-info-section-title",
      text: "字数",
    });
    section.createSpan({
      cls: "novelview-article-info-stat-value",
      text: new Intl.NumberFormat("zh-CN").format(snapshot.wordCount),
    });
  }

  /** 渲染可点击的列表分组 */
  private renderList(
    title: string,
    items: Array<{ label: string; meta: string; action: () => void }>,
  ): void {
    const section = this.contentEl.createDiv({
      cls: "novelview-article-info-section",
    });
    section.createDiv({
      cls: "novelview-article-info-section-title",
      text: `${title} ${items.length}`,
    });
    for (const item of items) {
      const button = section.createEl("button", {
        cls: "novelview-article-info-item",
        attr: { type: "button", title: item.meta },
      });
      const icon = button.createSpan({
        cls: "novelview-article-info-item-icon",
      });
      setIcon(icon, title === "文字标记"
        ? "highlighter"
        : "square-pen");
      const body = button.createDiv({
        cls: "novelview-article-info-item-body",
      });
      body.createDiv({
        cls: "novelview-article-info-item-label",
        text: item.label,
      });
      body.createDiv({
        cls: "novelview-article-info-item-meta",
        text: item.meta,
      });
      button.addEventListener("click", item.action);
    }
  }

  /** 渲染章节脚注说明编辑区 */
  private renderFootnotes(snapshot: ArticleInfoSnapshot): void {
    const section = this.contentEl.createDiv({
      cls: "novelview-article-info-section",
    });
    section.createDiv({
      cls: "novelview-article-info-section-title",
      text: "脚注",
    });
    const notes = loadFootnoteNotes(snapshot.filePath);
    for (const footnote of snapshot.footnotes) {
      const row = section.createDiv({ cls: "novelview-article-info-footnote" });
      row.createSpan({
        cls: "novelview-article-info-footnote-number",
        text: footnote.key,
      });
      const input = row.createEl("textarea", {
        cls: "novelview-article-info-footnote-input",
        attr: {
          rows: "2",
          placeholder: "填写脚注说明…",
          "aria-label": `脚注 ${footnote.key} 说明`,
          "data-footnote-input": footnote.key,
        },
      });
      input.value = notes[footnote.key] ?? footnote.text;
      input.addEventListener("input", () => {
        saveFootnoteNote(snapshot.filePath, footnote.key, input.value);
      });
    }
  }
}
