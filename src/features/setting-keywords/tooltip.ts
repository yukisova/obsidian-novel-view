import type { App, TFile } from "obsidian";
import type { SettingKeywordEntry } from "../../core/model/setting-collection";

/**
 * 设定关键词浮层需要宿主（插件）提供的能力。
 * 只列出本模块实际用到的成员，避免反向依赖 main.ts。
 */
export interface SettingKeywordHost {
  app: App;
  get allSettingKeywords(): SettingKeywordEntry[];
  /** 获取最近活动的 Markdown 文件 */
  getLastActiveMarkdownFile(): TFile | null;
  /** 查找文件所在的小说组根目录 */
  findNovelGroupRoot(folderPath: string): string | null;
  /** 规范化文件夹路径表示 */
  normalizeFolderPath(path: string): string;
  /** 列出关键词关联的详情文件 */
  getSettingRecordDetailFiles(
    novelRoot: string,
    group: string,
    keyword: string,
  ): TFile[];
  /** 返回详情文件的展示标签 */
  getSettingRecordDetailLabel(keyword: string, file: TFile): string;
}

const HIDE_DELAY = 180;

/**
 * 悬停正文中被高亮的设定关键词时弹出的信息浮层。
 * 同一时刻只保留一个浮层；翻页位置按关键词记忆。
 */
export class SettingKeywordTooltipController {
  private tooltip: HTMLElement | null = null;
  private timer: number | null = null;
  private readonly page = new Map<string, number>();

  /** 初始化浮层并保存宿主引用 */
  constructor(private readonly host: SettingKeywordHost) {}

  /** 判断鼠标是否移入了浮层自身（用于忽略 mouseout 的过早触发）。 */
  contains(node: Node | null): boolean {
    return Boolean(node && this.tooltip?.contains(node));
  }

  /** 该关键词上次翻到第几页，供「打开对应记录」复用同一位置。 */
  pageFor(keywordKey: string): number {
    return this.page.get(keywordKey) ?? 0;
  }

  /** 在目标位置弹出关键词浮层 */
  show(target: HTMLElement): void {
    const settingKeyword = target.dataset.novelviewSettingKeyword;
    if (!settingKeyword) {
      return;
    }
    this.clearTimer();
    this.hide();
    const keywordKey = settingKeyword.toLocaleLowerCase();
    const matches = this.host.allSettingKeywords.filter(
      (entry) => entry.keyword.toLocaleLowerCase() === keywordKey,
    );
    if (matches.length === 0) {
      matches.push({
        keyword: settingKeyword,
        content: target.dataset.novelviewSettingContent ?? "",
        group: target.dataset.novelviewSettingGroup ?? "",
        tag: target.dataset.novelviewSettingTag ?? "",
        color: "var(--interactive-accent)",
      });
    }
    const pageIndex = Math.min(
      Math.max(0, this.page.get(keywordKey) ?? 0),
      matches.length - 1,
    );
    const tooltip = createDiv({ cls: "novelview-setting-keyword-tooltip" });
    const render = (index: number): void => {
      this.page.set(keywordKey, index);
      tooltip.empty();
      tooltip.createDiv({
        cls: "novelview-setting-keyword-tooltip-title",
        text: settingKeyword,
      });
      const meta = tooltip.createDiv({
        cls: "novelview-setting-keyword-tooltip-meta",
      });
      const entry = matches[index] ?? matches[0];
      meta.createSpan({
        cls: "novelview-setting-keyword-tooltip-tag",
        text: entry.tag || "未分类",
      });
      meta.createSpan({
        cls: "novelview-setting-keyword-tooltip-group",
        text: entry.group || "未分组",
      });
      if (matches.length > 1) {
        const pager = tooltip.createDiv({
          cls: "novelview-setting-keyword-tooltip-pager",
        });
        const previous = pager.createEl("button", {
          text: "‹",
          attr: { type: "button", "aria-label": "上一条" },
        });
        previous.disabled = index === 0;
        previous.addEventListener("click", (event) => {
          event.stopPropagation();
          render(Math.max(0, index - 1));
        });
        pager.createSpan({
          text: `${index + 1} / ${matches.length}`,
        });
        const next = pager.createEl("button", {
          text: "›",
          attr: { type: "button", "aria-label": "下一条" },
        });
        next.disabled = index === matches.length - 1;
        next.addEventListener("click", (event) => {
          event.stopPropagation();
          render(Math.min(matches.length - 1, index + 1));
        });
      }
      if (entry.content) {
        tooltip.createDiv({
          cls: "novelview-setting-keyword-tooltip-divider",
        });
        tooltip.createDiv({
          cls: "novelview-setting-keyword-tooltip-content",
          text: entry.content,
        });
      }
      const current = this.host.getLastActiveMarkdownFile();
      const root = current
        ? this.host.findNovelGroupRoot(
          this.host.normalizeFolderPath(current.parent?.path ?? "/"),
        )
        : null;
      const details = root
        ? this.host.getSettingRecordDetailFiles(root, entry.group, entry.keyword)
        : [];
      if (details.length > 0) {
        tooltip.createDiv({
          cls: "novelview-setting-keyword-tooltip-divider",
        });
        const detailGrid = tooltip.createDiv({
          cls: "novelview-setting-keyword-tooltip-details",
        });
        for (const file of details) {
          const button = detailGrid.createEl("button", {
            cls: "novelview-setting-keyword-tooltip-detail",
            text: this.host.getSettingRecordDetailLabel(entry.keyword, file),
            attr: { type: "button", title: file.path },
          });
          button.addEventListener("click", (event) => {
            event.preventDefault();
            event.stopPropagation();
            this.hide();
            void this.host.app.workspace.getLeaf(false).openFile(file);
          });
        }
      }
    };
    render(pageIndex);
    tooltip.addEventListener("mouseenter", () => {
      this.clearTimer();
    });
    tooltip.addEventListener("mouseleave", () => {
      this.scheduleHide();
    });
    activeDocument.body.appendChild(tooltip);
    const width = tooltip.offsetWidth;
    const height = tooltip.offsetHeight;
    const anchor = target.getBoundingClientRect();
    const left = Math.min(
      Math.max(8, anchor.left),
      window.innerWidth - width - 8,
    );
    const top = Math.min(
      Math.max(8, anchor.bottom + 5),
      window.innerHeight - height - 8,
    );
    tooltip.setCssProps({ left: `${left}px`, top: `${top}px` });
    this.tooltip = tooltip;
  }

  /** 延迟一段时间后隐藏浮层 */
  scheduleHide(): void {
    this.clearTimer();
    this.timer = window.setTimeout(() => {
      this.timer = null;
      this.hide();
    }, HIDE_DELAY);
  }

  /** 取消尚未触发的隐藏计时 */
  clearTimer(): void {
    if (this.timer !== null) {
      window.clearTimeout(this.timer);
      this.timer = null;
    }
  }

  /** 立即移除当前关键词浮层 */
  hide(): void {
    this.clearTimer();
    this.tooltip?.remove();
    this.tooltip = null;
  }
}
