import {
  ItemView,
  setIcon,
  type TFile,
  type WorkspaceLeaf,
} from "obsidian";
import {
  REFERENCE_CATEGORY_LABELS,
  type ReferenceCategory,
} from "./core/cards";
import type { CategorySection } from "./core/category-file";
import type {
  OutlineData,
  OutlineEntry,
} from "./core/outline";
import {
  NOVEL_STATE_LABELS,
  type NovelState,
} from "./core/status";
import type NovelViewPlugin from "./main";

export const WORKBENCH_VIEW_TYPE = "novelview-workbench";

const CARD_ICONS: Record<ReferenceCategory, string> = {
  setting: "settings",
  character: "users",
  timeline: "clock",
  foreshadowing: "bookmark",
  inspiration: "lightbulb",
};

const OUTLINE_ICON = "list-tree";

interface CardSize {
  colSpan: number;
  rowSpan: number;
}

const GRID_COLUMNS = 6;
const GRID_GAP = 12;
const GRID_ROW_HEIGHT = 210;

export class NovelWorkbenchView extends ItemView {
  private readonly plugin: NovelViewPlugin;
  private refreshFrame: number | null = null;
  private renderToken = 0;
  private readonly cardSizes = new Map<string, CardSize>();

  constructor(leaf: WorkspaceLeaf, plugin: NovelViewPlugin) {
    super(leaf);
    this.plugin = plugin;
    this.navigation = false;
  }

  override getViewType(): string {
    return WORKBENCH_VIEW_TYPE;
  }

  override getDisplayText(): string {
    return "NovelView 工作台";
  }

  override getIcon(): string {
    return "layout-dashboard";
  }

  protected override async onOpen(): Promise<void> {
    this.contentEl.empty();
    this.contentEl.addClass("novelview-workbench");

    this.registerEvent(
      this.app.workspace.on("active-leaf-change", () => this.scheduleRefresh()),
    );
    this.registerEvent(
      this.app.workspace.on("file-open", () => this.scheduleRefresh()),
    );
    this.registerEvent(
      this.app.workspace.on("layout-change", () => this.scheduleRefresh()),
    );
    this.registerEvent(
      this.app.vault.on("create", () => this.scheduleRefresh()),
    );
    this.registerEvent(
      this.app.vault.on("delete", () => this.scheduleRefresh()),
    );
    this.registerEvent(
      this.app.vault.on("rename", () => this.scheduleRefresh()),
    );
    this.registerEvent(
      this.app.vault.on("modify", () => this.scheduleRefresh()),
    );
    this.registerEvent(
      this.app.metadataCache.on("changed", () => this.scheduleRefresh()),
    );
    this.registerEvent(
      this.app.metadataCache.on("resolved", () => this.scheduleRefresh()),
    );

    this.addAction(
      "search",
      "NovelView：高级查找/替换",
      () => {
        void this.plugin.openAdvancedSearch();
      },
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

  scheduleRefresh(): void {
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
    const scrollTop = this.contentEl.scrollTop;
    this.contentEl.empty();

    const current = this.plugin.getLastActiveMarkdownFile();
    const folderPath = this.plugin.getWorkbenchFolderPath();
    const novel = folderPath
      ? this.plugin.getNovelGroupInfo(folderPath)
      : null;

    if (novel) {
      this.renderNovelOverview(novel);
    } else {
      this.renderContext(current, folderPath);
    }

    if (folderPath) {
      const outline = await this.plugin.getOutlineData(folderPath);
      if (token !== this.renderToken) {
        return;
      }
      this.renderOutlineCard(folderPath, outline);
    } else {
      this.renderOutlineCard(null, null);
    }

    const inspiration = folderPath
      ? await this.plugin.getCategoryData(folderPath, "inspiration")
      : null;
    if (token !== this.renderToken) {
      return;
    }
    this.renderCategoryCard(folderPath, "inspiration", inspiration);

    if (scrollTop > 0) {
      this.contentEl.scrollTop = scrollTop;
    }
  }

  private renderNovelOverview(novel: {
    folderPath: string;
    name: string;
    description: string;
    cover: string;
    state: NovelState;
  }): void {
    const root = this.contentEl.createDiv({
      cls: "novelview-workbench-novel",
    });
    root.setAttr("data-category", "novel");
    root.setAttr("data-folder", novel.folderPath);

    const cover = root.createDiv({
      cls: "novelview-workbench-cover",
    });
    const coverUrl = this.plugin.getNovelCoverUrl(novel.folderPath, novel.cover);
    if (coverUrl) {
      cover.createEl("img", {
        cls: "novelview-workbench-cover-image",
        attr: {
          src: coverUrl,
          alt: `${novel.name} 封面`,
        },
      });
    } else {
      const placeholder = cover.createSpan({
        cls: "novelview-workbench-cover-placeholder",
      });
      setIcon(placeholder, "book-open");
    }

    const body = root.createDiv({ cls: "novelview-workbench-novel-body" });
    body.createDiv({
      cls: "novelview-workbench-context-label",
      text: "小说组",
    });
    const titleRow = body.createDiv({
      cls: "novelview-workbench-novel-title-row",
    });
    titleRow.createDiv({
      cls: "novelview-workbench-novel-name",
      text: novel.name,
    });
    titleRow.createSpan({
      cls: "novelview-workbench-novel-state",
      text: NOVEL_STATE_LABELS[novel.state],
    });
    body.createDiv({
      cls: "novelview-workbench-novel-description",
      text: novel.description || "尚未填写小说简介。",
    });
    body.createDiv({
      cls: "novelview-workbench-context-folder",
      text: novel.folderPath === "/" ? "Vault 根目录" : novel.folderPath,
    });

    const actions = body.createDiv({
      cls: "novelview-workbench-novel-actions",
    });
    const edit = actions.createEl("button", {
      cls: "novelview-workbench-button",
      text: "编辑小说信息",
      attr: { type: "button" },
    });
    edit.addEventListener("click", () => {
      this.plugin.openNovelGroupSettings(novel.folderPath);
    });
  }

  private renderContext(current: TFile | null, folderPath: string | null): void {
    const context = this.contentEl.createDiv({
      cls: "novelview-workbench-context",
    });

    context.createDiv({
      cls: "novelview-workbench-context-label",
      text: "当前小说目录",
    });

    context.createDiv({
      cls: "novelview-workbench-context-folder",
      text: folderPath
        ? (folderPath === "/" ? "Vault 根目录" : folderPath)
        : "尚未打开小说目录",
    });

    if (current) {
      context.createDiv({
        cls: "novelview-workbench-context-file",
        text: current.basename,
      });
    }
  }

  private renderOutlineCard(
    folderPath: string | null,
    outline: {
      file: TFile;
      data: OutlineData;
    } | null,
  ): void {
    const total = outline
      ? outline.data.volume.length + outline.data.chapter.length
      : 0;
    const card = this.createCard(
      OUTLINE_ICON,
      "大纲",
      total,
      "outline",
      undefined,
      outline?.file ?? null,
    );

    if (!folderPath) {
      this.renderEmpty(card.body, "请先打开小说组。");
      return;
    }

    if (!outline || total === 0) {
      this.renderEmpty(
        card.body,
        "暂无大纲。在文章列表右键章节或卷，选择“加入大纲”。",
      );
      return;
    }

    const list = card.body.createDiv({ cls: "novelview-workbench-list" });
    this.renderOutlineLevel(list, folderPath, "卷纲", outline.data.volume);
    this.renderOutlineLevel(list, folderPath, "章纲", outline.data.chapter);
  }

  private renderOutlineLevel(
    parent: HTMLElement,
    folderPath: string,
    label: string,
    entries: OutlineEntry[],
  ): void {
    parent.createDiv({
      cls: "novelview-workbench-outline-level",
      text: `${label} · ${entries.length}`,
    });
    if (entries.length === 0) {
      parent.createDiv({
        cls: "novelview-workbench-outline-empty",
        text: "暂无条目",
      });
      return;
    }

    for (const entry of entries) {
      const row = parent.createEl("button", {
        cls: "novelview-workbench-entry",
        attr: {
          type: "button",
          title: entry.body || entry.title,
        },
      });
      const icon = row.createSpan({ cls: "novelview-workbench-entry-icon" });
      setIcon(icon, OUTLINE_ICON);
      row.createSpan({
        cls: "novelview-workbench-entry-label",
        text: entry.title,
      });
      row.addEventListener("click", () => {
        void this.plugin.openOutlineEntry(folderPath, entry);
      });
      row.addEventListener("contextmenu", (event) => {
        event.preventDefault();
        this.plugin.showOutlineEntryContextMenu(event, folderPath, entry);
      });
    }
  }

  private renderCategoryCard(
    folderPath: string | null,
    category: ReferenceCategory,
    data: {
      file: TFile;
      sections: CategorySection[];
    } | null,
  ): void {
    const sections = data?.sections ?? [];
    const card = this.createCard(
      CARD_ICONS[category],
      REFERENCE_CATEGORY_LABELS[category],
      sections.length,
      category,
      undefined,
      data?.file ?? null,
    );

    if (!folderPath) {
      this.renderEmpty(card.body, "请先打开小说组。");
      return;
    }

    if (sections.length === 0) {
      this.renderEmpty(
        card.body,
        "关闭“有了灵感”便签后，内容会自动保存到这里。",
      );
      return;
    }

    const list = card.body.createDiv({ cls: "novelview-workbench-list" });
    for (const section of sections) {
      const row = list.createEl("button", {
        cls: "novelview-workbench-entry",
        attr: {
          type: "button",
          title: `第 ${section.headingLine} 行`,
        },
      });
      const icon = row.createSpan({ cls: "novelview-workbench-entry-icon" });
      setIcon(icon, CARD_ICONS[category]);
      row.createSpan({
        cls: "novelview-workbench-entry-label",
        text: section.heading,
      });
      row.addEventListener("click", () => {
        void this.plugin.openCategorySection(folderPath, category, section);
      });
      row.addEventListener("contextmenu", (event) => {
        event.preventDefault();
        this.plugin.showCategorySectionContextMenu(
          event,
          folderPath,
          category,
          section,
          () => this.scheduleRefresh(),
        );
      });
    }
  }

  private createCard(
    icon: string,
    title: string,
    count: number | undefined,
    category: string,
    onAdd?: () => void,
    file?: TFile | null,
  ): { root: HTMLElement; body: HTMLElement } {
    const root = this.contentEl.createEl("section", {
      cls: "novelview-workbench-card",
    });
    root.setAttr("data-category", category);
    this.applyCardSize(category, root);

    if (file) {
      root.addClass("has-markdown-preview");
      root.setAttr("title", `双击卡片边框打开 ${file.name}`);
      root.addEventListener("dblclick", (event) => {
        const target = event.target as HTMLElement | null;
        if (
          target?.closest(
            ".novelview-workbench-entry, .novelview-workbench-add, .novelview-workbench-resize",
          )
        ) {
          return;
        }
        event.preventDefault();
        this.plugin.openFileFromWorkbench(file, false);
      });
    }

    const header = root.createDiv({ cls: "novelview-workbench-card-header" });
    const iconEl = header.createSpan({
      cls: "novelview-workbench-card-icon",
    });
    iconEl.setAttr("aria-hidden", "true");
    setIcon(iconEl, icon);

    header.createSpan({
      cls: "novelview-workbench-card-title",
      text: title,
    });

    if (count !== undefined) {
      header.createSpan({
        cls: "novelview-workbench-card-count",
        text: String(count),
      });
    }

    if (onAdd) {
      const add = header.createEl("button", {
        cls: "novelview-workbench-add",
        attr: {
          type: "button",
          "aria-label": `新增${title}`,
          title: `新增${title}`,
        },
      });
      setIcon(add, "plus");
      add.addEventListener("click", onAdd);
    }

    const body = root.createDiv({ cls: "novelview-workbench-card-body" });
    this.addResizeHandle(root, category);
    return { root, body };
  }

  private applyCardSize(category: string, root: HTMLElement): void {
    const size = this.cardSizes.get(category) ?? {
      colSpan: 3,
      rowSpan: 1,
    };
    root.style.gridColumn = `span ${Math.min(GRID_COLUMNS, Math.max(1, size.colSpan))}`;
    root.style.gridRow = `span ${Math.max(1, size.rowSpan)}`;
  }

  private addResizeHandle(root: HTMLElement, category: string): void {
    const handle = root.createDiv({
      cls: "novelview-workbench-resize",
      attr: {
        title: "拖动调整卡片大小",
        "aria-label": "拖动调整卡片大小",
      },
    });
    setIcon(handle, "grip");

    handle.addEventListener("pointerdown", (event) => {
      if (event.button !== 0) {
        return;
      }
      event.preventDefault();
      event.stopPropagation();

      const startX = event.clientX;
      const startY = event.clientY;
      const startSize = this.cardSizes.get(category) ?? {
        colSpan: 3,
        rowSpan: 1,
      };
      const gridWidth = this.contentEl.clientWidth;
      const columnWidth = (gridWidth - GRID_GAP * (GRID_COLUMNS - 1))
        / GRID_COLUMNS;
      const rowHeight = GRID_ROW_HEIGHT + GRID_GAP;

      const onMove = (moveEvent: PointerEvent): void => {
        const columnDelta = Math.round(
          (moveEvent.clientX - startX) / Math.max(1, columnWidth + GRID_GAP),
        );
        const rowDelta = Math.round(
          (moveEvent.clientY - startY) / rowHeight,
        );
        const size: CardSize = {
          colSpan: Math.min(
            GRID_COLUMNS,
            Math.max(1, startSize.colSpan + columnDelta),
          ),
          rowSpan: Math.min(3, Math.max(1, startSize.rowSpan + rowDelta)),
        };
        this.cardSizes.set(category, size);
        root.style.gridColumn = `span ${size.colSpan}`;
        root.style.gridRow = `span ${size.rowSpan}`;
        root.addClass("is-resizing");
      };

      const onUp = (): void => {
        root.removeClass("is-resizing");
        window.removeEventListener("pointermove", onMove);
        window.removeEventListener("pointerup", onUp);
      };

      window.addEventListener("pointermove", onMove);
      window.addEventListener("pointerup", onUp, { once: true });
    });
  }

  private renderEmpty(parent: HTMLElement, text: string): void {
    parent.createDiv({
      cls: "novelview-workbench-empty",
      text,
    });
  }
}
