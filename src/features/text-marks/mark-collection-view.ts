import {
  ItemView,
  Modal,
  setIcon,
  TAbstractFile,
  TFile,
  type WorkspaceLeaf,
} from "obsidian";
import {
  OUTLINE_MARKS_PROPERTY,
  parseOutlineMarks,
  serializeOutlineMarks,
} from "../../core/model/outline-marks";
import { splitFrontmatterContent } from "../../core/text/paragraphs";
import type NovelViewPlugin from "../../main";

export const TEXT_MARKS_VIEW_TYPE = "novelview-text-marks";
const MARK_NOTES_FILENAME = "novelview-mark-notes.json";
const MARK_ORDER_FILENAME = "novelview-mark-order.json";

/** 生成标记实例的唯一键值 */
function markOccurrenceKey(occurrence: MarkOccurrence): string {
  return `${occurrence.file.path}\u0000${occurrence.start}\u0000${occurrence.end}`;
}

/** 按已保存顺序排列同一标记实例 */
function orderedOccurrences(
  occurrences: MarkOccurrence[],
  order: string[],
): MarkOccurrence[] {
  if (order.length === 0) {
    return occurrences;
  }
  const index = new Map(order.map((key, position) => [key, position]));
  return [...occurrences].sort((left, right) => (
    (index.get(markOccurrenceKey(left)) ?? Number.MAX_SAFE_INTEGER)
    - (index.get(markOccurrenceKey(right)) ?? Number.MAX_SAFE_INTEGER)
  ));
}


class MarkNoteModal extends Modal {
  private readonly initial: string;
  private readonly onSave: (value: string) => void;

  /** 初始化标记说明弹窗的初始文本与回调 */
  constructor(
    app: import("obsidian").App,
    private readonly label: string,
    initial: string,
    onSave: (value: string) => void,
  ) {
    super(app);
    this.initial = initial;
    this.onSave = onSave;
  }

  /** 渲染说明文本框与保存按钮 */
  override onOpen(): void {
    this.setTitle(`说明：${this.label}`);
    this.modalEl.addClass("novelview-mark-note-modal");
    this.contentEl.empty();
    const textarea = this.contentEl.createEl("textarea", {
      cls: "novelview-mark-note-textarea",
      attr: {
        rows: "6",
        placeholder: "为这个文字标记补充说明，例如伏笔解释、上下文或提醒…",
        "aria-label": "文字标记说明",
      },
    });
    textarea.value = this.initial;
    const buttons = this.contentEl.createDiv({
      cls: "modal-button-container",
    });
    buttons.createEl("button", {
      text: "取消",
      attr: { type: "button" },
    }).addEventListener("click", () => this.close());
    buttons.createEl("button", {
      cls: "mod-cta",
      text: "保存说明",
      attr: { type: "button" },
    }).addEventListener("click", () => {
      this.onSave(textarea.value.trim());
      this.close();
    });
    window.setTimeout(() => {
      textarea.focus();
      textarea.select();
    }, 0);
  }

  /** 关闭说明弹窗时清空内容 */
  override onClose(): void {
    this.contentEl.empty();
  }
}

export interface MarkOccurrence {
  file: TFile;
  start: number;
  end: number;
  label: string;
  text: string;
  line: number;
}

export interface MarkGroup {
  label: string;
  occurrences: MarkOccurrence[];
}

export interface TextMarkCollection {
  groups: MarkGroup[];
  conflicts: number;
}

interface DragState {
  occurrence: MarkOccurrence;
  startX: number;
  startY: number;
  moved: boolean;
  target: HTMLElement | null;
  targetEntry: HTMLElement | null;
  targetPosition: "before" | "after";
}

export class TextMarkCollectionView extends ItemView {
  private readonly plugin: NovelViewPlugin;
  private folderPath = "";
  private refreshToken = 0;
  private refreshTimer: number | null = null;
  private drag: DragState | null = null;
  private lastFingerprint = "";
  private pendingRefresh = false;
  private searchQuery = "";
  private readonly expandedLabels = new Set<string>();

  /** 初始化文字标记视图并关闭导航 */
  constructor(leaf: WorkspaceLeaf, plugin: NovelViewPlugin) {
    super(leaf);
    this.plugin = plugin;
    this.navigation = false;
  }

  /** 返回文字标记视图的类型标识 */
  override getViewType(): string {
    return TEXT_MARKS_VIEW_TYPE;
  }

  /** 提供标签页显示的文字标记标题 */
  override getDisplayText(): string {
    return "文字标记";
  }

  /** 返回文字标记页签使用的图标 */
  override getIcon(): string {
    return "highlighter";
  }

  /** 保存文字标记所属目录状态 */
  override getState(): Record<string, unknown> {
    return { folderPath: this.folderPath };
  }

  /** 恢复目录状态并刷新标记列表 */
  override async setState(
    state: Record<string, unknown>,
    result: import("obsidian").ViewStateResult,
  ): Promise<void> {
    this.folderPath = typeof state.folderPath === "string"
      ? state.folderPath
      : this.folderPath;
    result.history = true;
    await super.setState(state, result);
    await this.render(true);
  }

  /** 监听文件变化并首次收集标记 */
  protected override async onOpen(): Promise<void> {
    this.contentEl.addClass("novelview-mark-collection-view");
    const schedule = (file: TAbstractFile): void => {
      if (
        file instanceof TFile
        && (file.extension === "md"
          || file.name === MARK_NOTES_FILENAME
          || file.name === MARK_ORDER_FILENAME)
      ) {
        this.scheduleRefresh();
      }
    };
    this.registerEvent(this.app.vault.on("modify", schedule));
    this.registerEvent(this.app.vault.on("create", schedule));
    this.registerEvent(this.app.vault.on("delete", schedule));
    this.registerEvent(this.app.metadataCache.on("changed", schedule));
    await this.render(true);
  }

  /** 终止待刷新任务并清空视图 */
  protected override async onClose(): Promise<void> {
    this.refreshToken += 1;
    if (this.refreshTimer !== null) {
      window.clearTimeout(this.refreshTimer);
      this.refreshTimer = null;
    }
    this.contentEl.empty();
  }

  /** 延迟合并刷新以避免频繁重建 */
  private scheduleRefresh(): void {
    if (this.drag) {
      this.pendingRefresh = true;
      return;
    }
    if (this.refreshTimer !== null) {
      window.clearTimeout(this.refreshTimer);
    }
    this.refreshTimer = window.setTimeout(() => {
      this.refreshTimer = null;
      void this.render();
    }, 320);
  }

  /** 汇总标记、说明与排序后重绘视图 */
  private async render(force = false): Promise<void> {
    const token = ++this.refreshToken;
    const novelRoot = this.plugin.findNovelGroupRoot(this.folderPath)
      ?? this.plugin.normalizeFolderPath(this.folderPath);
    const data = await collectTextMarks(this.app, this.plugin, novelRoot);
    const notes = await this.loadMarkNotes(novelRoot);
    const orders = await this.loadMarkOrders(novelRoot);
    if (token !== this.refreshToken) {
      return;
    }
    const fingerprint = JSON.stringify({
      conflicts: data.conflicts,
      notes,
      orders,
      groups: data.groups.map((group) => ({
        label: group.label,
        occurrences: group.occurrences.map((occurrence) => [
          occurrence.file.path,
          occurrence.start,
          occurrence.end,
          occurrence.text,
          occurrence.line,
        ]),
      })),
    });
    if (!force && fingerprint === this.lastFingerprint) {
      return;
    }
    this.lastFingerprint = fingerprint;
    const scrollTop = this.contentEl.scrollTop;
    this.contentEl.empty();
    this.contentEl.addClass("novelview-mark-collection-view");
    const header = this.contentEl.createDiv({
      cls: "novelview-setting-collection-header",
    });
    header.createDiv({
      cls: "novelview-setting-collection-title",
      text: "文字标记",
    });
    const novelName = this.plugin.getNovelGroupInfo(novelRoot)?.name ?? "";
    if (novelName) {
      header.createDiv({
        cls: "novelview-setting-collection-subtitle",
        text: novelName,
      });
    }
    const toolbar = header.createDiv({
      cls: "novelview-setting-collection-toolbar",
    });
    const refresh = toolbar.createEl("button", {
      cls: "novelview-setting-collection-small-button",
      attr: { type: "button", "aria-label": "刷新文字标记", title: "刷新文字标记" },
    });
    setIcon(refresh, "refresh-cw");
    refresh.addEventListener("click", () => void this.render(true));
    const searchWrap = header.createDiv({
      cls: "novelview-collection-search",
    });
    const search = searchWrap.createEl("input", {
      cls: "novelview-collection-search-input",
      attr: {
        type: "search",
        placeholder: "搜索文字标记标题",
        "aria-label": "搜索文字标记标题",
      },
    });
    search.value = this.searchQuery;
    search.addEventListener("input", () => {
      this.searchQuery = search.value;
      this.applyMarkSearch();
    });

    if (data.conflicts > 0) {
      const warning = this.contentEl.createDiv({
        cls: "novelview-mark-conflict",
      });
      setIcon(warning.createSpan({ cls: "novelview-mark-conflict-icon" }), "alert-triangle");
      warning.createSpan({
        text: `检测到 ${data.conflicts} 处文字标记区间重叠，请先处理冲突后再添加新标记。`,
      });
    }

    if (data.groups.length === 0) {
      this.contentEl.createDiv({
        cls: "novelview-setting-collection-empty novelview-mark-empty",
        text: "暂无文字标记。在正文中选中文字并添加标记后会显示在这里。",
      });
      this.contentEl.scrollTop = scrollTop;
      return;
    }
    const tags = this.contentEl.createDiv({
      cls: "novelview-setting-collection-tags novelview-mark-tags",
    });
    for (const group of data.groups) {
      this.renderMarkGroup(
        tags,
        group,
        notes[group.label] ?? "",
        novelRoot,
        orders[group.label] ?? [],
      );
    }
    this.applyMarkSearch();
    this.contentEl.scrollTop = scrollTop;
  }

  /** 渲染单个标记分组及其全部实例 */
  private renderMarkGroup(
    parent: HTMLElement,
    group: MarkGroup,
    note: string,
    novelRoot: string,
    order: string[],
  ): void {
    const expanded = this.expandedLabels.has(group.label);
    const tagCard = parent.createDiv({
      cls: `novelview-setting-collection-tag novelview-mark-tag${
        expanded ? " is-expanded" : " is-collapsed"
      }`,
      attr: { "data-mark-label": group.label },
    });
    const heading = tagCard.createDiv({
      cls: "novelview-setting-collection-tag-title",
      attr: {
        role: "button",
        tabindex: "0",
        "aria-expanded": String(expanded),
      },
    });
    const toggle = (): void => {
      if (this.expandedLabels.has(group.label)) {
        this.expandedLabels.delete(group.label);
      } else {
        this.expandedLabels.add(group.label);
      }
      const isExpanded = this.expandedLabels.has(group.label);
      tagCard.toggleClass("is-expanded", isExpanded);
      tagCard.toggleClass("is-collapsed", !isExpanded);
      body.toggleClass("is-collapsed", !isExpanded);
      heading.setAttr("aria-expanded", String(isExpanded));
    };
    heading.addEventListener("click", (event) => {
      event.stopPropagation();
      toggle();
    });
    heading.addEventListener("keydown", (event) => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        toggle();
      }
    });
    heading.createSpan({
      cls: "novelview-setting-collection-tag-dot",
    });
    heading.createSpan({
      cls: "novelview-setting-collection-tag-name",
      text: group.label,
    });
    heading.createSpan({
      cls: "novelview-setting-collection-count",
      text: `${group.occurrences.length}`,
    });
    const body = tagCard.createDiv({
      cls: `novelview-setting-collection-tag-body novelview-mark-tag-body${
        expanded ? "" : " is-collapsed"
      }`,
    });
    const noteBox = body.createDiv({ cls: "novelview-mark-note" });
    noteBox.createDiv({
      cls: `novelview-mark-note-text${note ? "" : " is-empty"}`,
      text: note || "暂无说明",
    });
    const editNote = noteBox.createEl("button", {
      cls: "novelview-mark-note-edit",
      attr: {
        type: "button",
        title: note ? "编辑说明" : "添加说明",
        "aria-label": note ? "编辑说明" : "添加说明",
      },
    });
    setIcon(editNote, "pencil");
    editNote.addEventListener("click", (event) => {
      event.stopPropagation();
      new MarkNoteModal(this.app, group.label, note, (value) => {
        void this.saveMarkNote(novelRoot, group.label, value).then(() => {
          this.scheduleRefresh();
        });
      }).open();
    });
    const entries = body.createDiv({ cls: "novelview-mark-entries" });
    for (const occurrence of orderedOccurrences(group.occurrences, order)) {
      const row = entries.createDiv({
        cls: "novelview-setting-collection-entry novelview-mark-entry",
        attr: {
          "data-mark-instance": "true",
          "data-mark-instance-label": group.label,
          "data-mark-instance-key": markOccurrenceKey(occurrence),
          "data-mark-file": occurrence.file.path,
          "data-mark-start": String(occurrence.start),
          "data-mark-end": String(occurrence.end),
        },
      });
      const grip = row.createSpan({
        cls: "novelview-setting-collection-drag-grip",
      });
      setIcon(grip, "grip-vertical");
      const icon = row.createSpan({
        cls: "novelview-setting-collection-entry-icon",
      });
      setIcon(icon, "file-text");
      const info = row.createDiv({ cls: "novelview-mark-entry-info" });
      info.createDiv({
        cls: "novelview-setting-collection-keyword novelview-mark-entry-text",
        text: occurrence.text,
      });
      info.createDiv({
        cls: "novelview-setting-collection-content novelview-mark-entry-meta",
        text: `${occurrence.file.basename} · 第 ${occurrence.line} 行`,
      });
      this.attachInstanceDrag(row, occurrence, group.label, novelRoot);
    }
  }

  /** 拼接标记说明文件的存放路径 */
  private markNotesPath(novelRoot: string): string {
    const root = this.plugin.normalizeFolderPath(novelRoot);
    return root
      ? `${root}/${MARK_NOTES_FILENAME}`
      : MARK_NOTES_FILENAME;
  }

  /** 读取并校验标记说明 JSON */
  private async loadMarkNotes(
    novelRoot: string,
  ): Promise<Record<string, string>> {
    const file = this.app.vault.getAbstractFileByPath(
      this.markNotesPath(novelRoot),
    );
    if (!(file instanceof TFile)) {
      return {};
    }
    try {
      const raw = JSON.parse(await this.app.vault.read(file)) as unknown;
      if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
        return {};
      }
      const notes: Record<string, string> = {};
      for (const [label, value] of Object.entries(raw)) {
        if (typeof value === "string" && value.trim()) {
          notes[label] = value.trim();
        }
      }
      return notes;
    } catch (error) {
      console.debug("Novel View: mark notes read failed", error);
      return {};
    }
  }

  /** 写入或移除单条标记说明 */
  private async saveMarkNote(
    novelRoot: string,
    label: string,
    note: string,
  ): Promise<void> {
    const path = this.markNotesPath(novelRoot);
    const notes = await this.loadMarkNotes(novelRoot);
    const value = note.trim();
    if (value) {
      notes[label] = value;
    } else {
      delete notes[label];
    }
    const content = JSON.stringify(notes, null, 2);
    const file = this.app.vault.getAbstractFileByPath(path);
    if (file instanceof TFile) {
      await this.app.vault.process(file, () => content);
      return;
    }
    await this.app.vault.create(path, content);
  }

  /** 拼接标记排序文件的存放路径 */
  private markOrderPath(novelRoot: string): string {
    const root = this.plugin.normalizeFolderPath(novelRoot);
    return root
      ? `${root}/${MARK_ORDER_FILENAME}`
      : MARK_ORDER_FILENAME;
  }

  /** 读取并校验标记排序数据 */
  private async loadMarkOrders(
    novelRoot: string,
  ): Promise<Record<string, string[]>> {
    const file = this.app.vault.getAbstractFileByPath(
      this.markOrderPath(novelRoot),
    );
    if (!(file instanceof TFile)) {
      return {};
    }
    try {
      const raw = JSON.parse(await this.app.vault.read(file)) as unknown;
      if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
        return {};
      }
      const orders: Record<string, string[]> = {};
      for (const [label, value] of Object.entries(raw)) {
        if (Array.isArray(value)) {
          const keys = value.filter((entry): entry is string => (
            typeof entry === "string" && entry.length > 0
          ));
          if (keys.length > 0) {
            orders[label] = keys;
          }
        }
      }
      return orders;
    } catch (error) {
      console.debug("Novel View: mark order read failed", error);
      return {};
    }
  }

  /** 把标记排序写回存储文件 */
  private async saveMarkOrders(
    novelRoot: string,
    orders: Record<string, string[]>,
  ): Promise<void> {
    const path = this.markOrderPath(novelRoot);
    const content = JSON.stringify(orders, null, 2);
    const file = this.app.vault.getAbstractFileByPath(path);
    if (file instanceof TFile) {
      await this.app.vault.process(file, () => content);
    } else {
      await this.app.vault.create(path, content);
    }
  }

  /** 按拖放目标调整标记实例顺序 */
  private async reorderOccurrence(
    novelRoot: string,
    label: string,
    occurrence: MarkOccurrence,
    targetKey: string,
    position: "before" | "after",
  ): Promise<void> {
    const group = this.contentEl.querySelector<HTMLElement>(
      `.novelview-mark-tag[data-mark-label="${CSS.escape(label)}"]`,
    );
    const keys = [...(group?.querySelectorAll<HTMLElement>(
      "[data-mark-instance-key]",
    ) ?? [])].map((entry) => entry.dataset.markInstanceKey ?? "");
    const moving = markOccurrenceKey(occurrence);
    const without = keys.filter((key) => key && key !== moving);
    const targetIndex = without.indexOf(targetKey);
    if (targetIndex < 0) {
      return;
    }
    without.splice(targetIndex + (position === "after" ? 1 : 0), 0, moving);
    const orders = await this.loadMarkOrders(novelRoot);
    orders[label] = without;
    await this.saveMarkOrders(novelRoot, orders);
    this.scheduleRefresh();
  }

  /** 按搜索词过滤并展开匹配分组 */
  private applyMarkSearch(): void {
    const query = this.searchQuery.trim().toLocaleLowerCase();
    for (const card of this.contentEl.querySelectorAll<HTMLElement>(
      ".novelview-mark-tag",
    )) {
      const label = card.dataset.markLabel ?? "";
      const hit = !query || label.toLocaleLowerCase().includes(query);
      card.toggleClass("is-search-hidden", !hit);
      for (const entry of card.querySelectorAll<HTMLElement>(
        ".novelview-mark-entry",
      )) {
        entry.removeClass("is-search-hidden");
      }
      if (query && hit) {
        this.expandedLabels.add(label);
        card.removeClass("is-collapsed");
        card.addClass("is-expanded");
        card.querySelector(".novelview-mark-tag-body")
          ?.removeClass("is-collapsed");
        card.querySelector(".novelview-setting-collection-tag-title")
          ?.setAttribute("aria-expanded", "true");
      }
    }
  }

  /** 为标记条目绑定拖拽排序交互 */
  private attachInstanceDrag(
    row: HTMLElement,
    occurrence: MarkOccurrence,
    label: string,
    novelRoot: string,
  ): void {
    row.addEventListener("pointerdown", (event) => {
      if (event.button !== 0 || this.drag) {
        return;
      }
      event.preventDefault();
      event.stopPropagation();
      if (this.refreshTimer !== null) {
        window.clearTimeout(this.refreshTimer);
        this.refreshTimer = null;
      }
      this.pendingRefresh = true;
      const drag: DragState = {
        occurrence,
        startX: event.clientX,
        startY: event.clientY,
        moved: false,
        target: null,
        targetEntry: null,
        targetPosition: "before",
      };
      this.drag = drag;
      row.addClass("is-pressed");
      const onMove = (moveEvent: PointerEvent): void => {
        if (!drag.moved) {
          if (
            Math.hypot(
              moveEvent.clientX - drag.startX,
              moveEvent.clientY - drag.startY,
            ) <= 4
          ) {
            return;
          }
          drag.moved = true;
          row.addClass("is-dragging");
        }
        moveEvent.preventDefault();
        const element = this.contentEl.ownerDocument.elementFromPoint(
          moveEvent.clientX,
          moveEvent.clientY,
        );
        const target = element?.closest<HTMLElement>("[data-mark-label]") ?? null;
        const entry = element?.closest<HTMLElement>("[data-mark-instance]") ?? null;
        if (target !== drag.target) {
          drag.target?.removeClass("is-drop-inside");
          target?.addClass("is-drop-inside");
          drag.target = target;
        }
        if (entry !== drag.targetEntry) {
          drag.targetEntry?.removeClass("is-drop-before", "is-drop-after");
          drag.targetEntry = entry;
        }
        if (entry) {
          const rect = entry.getBoundingClientRect();
          drag.targetPosition = moveEvent.clientY > rect.top + rect.height / 2
            ? "after"
            : "before";
          entry.removeClass("is-drop-before", "is-drop-after");
          entry.addClass(`is-drop-${drag.targetPosition}`);
        }
      };
      const onUp = (upEvent: PointerEvent): void => {
        window.removeEventListener("pointermove", onMove, true);
        window.removeEventListener("pointerup", onUp, true);
        window.removeEventListener("pointercancel", onUp, true);
        this.drag = null;
        row.removeClass("is-pressed");
        row.removeClass("is-dragging");
        drag.target?.removeClass("is-drop-inside");
        drag.targetEntry?.removeClass("is-drop-before", "is-drop-after");
        const targetLabel = drag.target?.dataset.markLabel;
        const targetEntry = drag.targetEntry;
        if (
          drag.moved
          && targetEntry
          && targetEntry !== row
          && targetEntry.dataset.markInstanceLabel === label
        ) {
          void this.reorderOccurrence(
            novelRoot,
            label,
            drag.occurrence,
            targetEntry.dataset.markInstanceKey ?? "",
            drag.targetPosition,
          );
        } else if (
          drag.moved
          && targetLabel
          && targetLabel !== drag.occurrence.label
        ) {
          void this.moveOccurrence(drag.occurrence, targetLabel);
        } else if (!drag.moved) {
          void this.plugin.openTextMarkRange(
            drag.occurrence.file,
            drag.occurrence.start,
            drag.occurrence.end,
          );
        }
        if (this.pendingRefresh) {
          this.pendingRefresh = false;
          this.scheduleRefresh();
        }
      };
      window.addEventListener("pointermove", onMove, true);
      window.addEventListener("pointerup", onUp, true);
      window.addEventListener("pointercancel", onUp, true);
    });
  }

  /** 修改标记属性将其移入其他分组 */
  private async moveOccurrence(
    occurrence: MarkOccurrence,
    label: string,
  ): Promise<void> {
    await this.app.fileManager.processFrontMatter(occurrence.file, (
      frontmatter: Record<string, unknown>,
    ) => {
      const marks = parseOutlineMarks(frontmatter[OUTLINE_MARKS_PROPERTY]);
      const next = marks.map((mark) => (
        mark.start === occurrence.start
        && mark.end === occurrence.end
        && mark.label === occurrence.label
          ? { ...mark, label }
          : mark
      ));
      if (next.length > 0) {
        frontmatter[OUTLINE_MARKS_PROPERTY] = serializeOutlineMarks(next);
      }
    });
    this.scheduleRefresh();
  }
}

/** 扫描正文收集标记并统计区间冲突 */
export async function collectTextMarks(
  app: import("obsidian").App,
  plugin: NovelViewPlugin,
  novelRoot: string,
): Promise<TextMarkCollection> {
  const root = plugin.normalizeFolderPath(novelRoot);
  const files = app.vault.getMarkdownFiles()
    .filter((file) => (
      plugin.isNovelArticleFile(file)
      && (file.path === root || file.path.startsWith(`${root}/`))
    ))
    .sort((left, right) => left.path.localeCompare(right.path, "zh-CN"));
  const groups = new Map<string, MarkGroup>();
  let conflicts = 0;
  for (const file of files) {
    const rawContent = await app.vault.cachedRead(file);
    const body = splitFrontmatterContent(rawContent).body;
    const frontmatter = app.metadataCache.getFileCache(file)?.frontmatter;
    const rawMarks = parseOutlineMarks(frontmatter?.[OUTLINE_MARKS_PROPERTY]);
    const boundedMarks = rawMarks.filter((mark) => (
      mark.start >= 0
      && mark.end > mark.start
      && mark.end <= body.length
    ));
    const validMarks = boundedMarks.filter((mark) => (
      Boolean(body.slice(mark.start, mark.end).trim())
    ));
    const sorted = [...validMarks].sort((left, right) => left.start - right.start);
    for (let index = 1; index < sorted.length; index += 1) {
      if ((sorted[index]?.start ?? 0) < (sorted[index - 1]?.end ?? 0)) {
        conflicts += 1;
      }
    }
    for (const mark of validMarks) {
      const group = groups.get(mark.label) ?? {
        label: mark.label,
        occurrences: [],
      };
      const text = body.slice(mark.start, mark.end).trim();
      group.occurrences.push({
        file,
        start: mark.start,
        end: mark.end,
        label: mark.label,
        text: text.length > 80 ? `${text.slice(0, 80)}…` : text,
        line: body.slice(0, mark.start).split("\n").length,
      });
      groups.set(mark.label, group);
    }
  }
  return {
    groups: [...groups.values()].sort((left, right) => (
      right.occurrences.length - left.occurrences.length
      || left.label.localeCompare(right.label, "zh-CN")
    )),
    conflicts,
  };
}
