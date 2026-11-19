import { Menu, Notice, type WorkspaceLeaf } from "obsidian";
import {
  deleteTimelineEntry,
  formatTimelineTime,
  parseTimelineSource,
  timelineTimeMs,
  updateTimelineEntryRange,
  type TimelineEntry,
  type TimelineOrientation,
} from "../core/setting-special-data";
import { SettingGroupModal } from "../setting-collection-modal";
import { SpecialEditorBaseView } from "./base-editor-view";
import type NovelViewPlugin from "../main";

export const TIMELINE_EDITOR_VIEW_TYPE = "novelview-timeline-editor";

interface TimelineDrag {
  index: number;
  mode: "move" | "start" | "end";
  startX: number;
  startY: number;
  startMs: number;
  endMs: number;
  axisMin: number;
  axisMax: number;
  laneWidth: number;
  vertical: boolean;
  moved: boolean;
  bar: HTMLElement;
}

interface PlacedEntry {
  entry: TimelineEntry;
  index: number;
  row: number;
}

export class TimelineEditorView extends SpecialEditorBaseView {
  protected readonly kind = "line" as const;
  protected readonly viewType = TIMELINE_EDITOR_VIEW_TYPE;
  protected readonly viewIcon = "chart-no-axes-combined";
  protected readonly wheelZoomEnabled = false;
  protected readonly middlePanEnabled = false;

  private orientation: TimelineOrientation = "horizontal";
  private entries: TimelineEntry[] = [];
  private host: HTMLElement | null = null;
  private boundScene: HTMLElement | null = null;
  private drag: TimelineDrag | null = null;
  private markLabels = new Set<string>();
  private markLabelsLoaded = false;
  private recordKeywords = new Set<string>();
  private infoCard: HTMLElement | null = null;
  private infoCleanup: (() => void) | null = null;
  private renderToken = 0;
  private dropBound = false;
  private wheelBound = false;
  private timelineWidth = 900;

  constructor(leaf: WorkspaceLeaf, plugin: NovelViewPlugin) {
    super(leaf, plugin);
  }

  protected helpText(): string {
    return "数据格式：- 开始 ~ 结束 | 事件 | 描述 | 轨道。拖动时间条调整起止；文字标记可拖入；双击空白新建未绑定关键词。";
  }

  protected templateInsertion(): string {
    return "\n- 日期 ~ 日期 | 新事件 | 描述 | 轨道";
  }

  protected recordInsertion(
    payload: { keyword: string; content?: string },
    point?: { clientX: number; clientY: number },
  ): string {
    const start = point
      ? this.timeAtPoint(point.clientX, point.clientY)
      : "";
    return `\n- ${start} | ${payload.keyword} | ${payload.content ?? ""}`;
  }

  protected override async onOpen(): Promise<void> {
    await super.onOpen();
    this.contentEl.addClass("novelview-timeline-mode");
    if (!this.wheelBound) {
      this.wheelBound = true;
      this.contentEl.addEventListener("wheel", (event) => {
        const target = event.target as Element | null;
        const display = target?.closest<HTMLElement>(
          ".novelview-special-editor-display-content",
        );
        if (!display) {
          return;
        }
        event.preventDefault();
        const rawDelta = Math.abs(event.deltaY) >= Math.abs(event.deltaX)
          ? event.deltaY
          : event.deltaX;
        if (event.shiftKey) {
          if (rawDelta === 0) {
            return;
          }
          this.timelineWidth = Math.min(
            2600,
            Math.max(600, this.timelineWidth + (rawDelta < 0 ? 120 : -120)),
          );
          const canvas = this.host?.querySelector<HTMLElement>(
            ".novelview-special-timeline-canvas",
          );
          canvas?.setCssStyles({ width: `${this.timelineWidth}px` });
          return;
        }
        display.scrollLeft += event.deltaY + event.deltaX;
      }, { passive: false });
    }
    if (!this.dropBound) {
      this.dropBound = true;
      this.contentEl.addEventListener(
        "novelview-text-mark-drop",
        (event) => {
          const detail = (event as CustomEvent<{
            label?: string;
            text?: string;
            clientX?: number;
            clientY?: number;
          }>).detail;
          const label = detail?.label?.trim();
          if (!label || !this.editorView) {
            return;
          }
          const start = Number.isFinite(detail?.clientX)
            && Number.isFinite(detail?.clientY)
            ? this.timeAtPoint(detail.clientX!, detail.clientY!)
            : "";
          const current = this.editorView.state.doc.toString();
          const line = `\n- ${start} | ${label} | ${detail?.text ?? ""}`;
          this.editorView.dispatch({
            changes: { from: current.length, insert: line },
          });
          new Notice("Novel View：已将文字标记加入时间轴。");
        },
      );
    }
  }

  protected async renderPreview(
    content: string,
    host: HTMLElement,
  ): Promise<void> {
    const token = ++this.renderToken;
    this.orientation = "horizontal";
    this.entries = parseTimelineSource(content);
    this.host = host;
    if (this.boundScene !== host) {
      this.boundScene = host;
      this.bindTimelineDrag(host);
    }
    if (!this.markLabelsLoaded) {
      const root = this.plugin.findNovelGroupRoot(this.filePath)
        ?? this.plugin.normalizeFolderPath(
          this.filePath.split("/").slice(0, -1).join("/"),
        );
      this.markLabels = await this.plugin.getTextMarkLabelsForNovel(root);
      this.markLabelsLoaded = true;
      this.recordKeywords = await this.plugin.getSettingRecordKeywordsForNovel(
        root,
      );
    }
    if (token !== this.renderToken) {
      return;
    }
    this.drawTimeline();
  }

  private drawTimeline(): void {
    const host = this.host;
    if (!host) {
      return;
    }
    host.empty();
    this.orientation = "horizontal";
    this.drawHorizontalTimeline(host);
  }

  private drawHorizontalTimeline(host: HTMLElement): void {
    const canvas = host.createDiv({
      cls: "novelview-special-timeline-canvas is-horizontal is-fcp",
    });
    if (this.entries.length === 0) {
      canvas.createDiv({
        cls: "novelview-special-editor-empty",
        text: "切换到源码视图，添加时间轴条目。",
      });
      return;
    }
    const axis = this.axisRange();
    const placed = this.placeEntries();
    const rows = Math.max(1, ...placed.map((item) => item.row + 1));
    canvas.setCssStyles({ width: `${this.timelineWidth}px` });
    const board = canvas.createDiv({ cls: "novelview-special-timeline-board" });
    const span = Math.max(1, axis.max - axis.min);
    for (let row = 0; row < rows; row += 1) {
      const rowEl = board.createDiv({
        cls: "novelview-special-timeline-row",
      });
      const lane = rowEl.createDiv({
        cls: "novelview-special-timeline-lane",
      });
      for (const placedEntry of placed.filter((item) => item.row === row)) {
        const entry = placedEntry.entry;
        const start = timelineTimeMs(entry.start)
          ?? timelineTimeMs(entry.time)
          ?? placedEntry.index * 86_400_000;
        const end = Math.max(
          start,
          timelineTimeMs(entry.end) ?? start,
        );
        const left = ((start - axis.min) / span) * 100;
        const width = Math.max(1.8, ((end - start) / span) * 100);
        const kind = this.timelineItemKind(entry.title);
        const bar = lane.createDiv({
          cls: `novelview-special-timeline-bar is-${kind}`,
          attr: {
            "data-timeline-index": String(placedEntry.index),
            style: `left:${left}%;width:${width}%`,
            title: entry.title,
          },
        });
        bar.createDiv({
          cls: "novelview-special-timeline-handle is-start",
          attr: {
            "data-timeline-handle": "start",
            "data-timeline-index": String(placedEntry.index),
          },
        });
        const body = bar.createDiv({
          cls: "novelview-special-timeline-bar-body",
          attr: { "data-timeline-move": "true" },
        });
        body.createDiv({
          cls: "novelview-special-timeline-bar-title",
          text: entry.title,
        });
        bar.createDiv({
          cls: "novelview-special-timeline-handle is-end",
          attr: {
            "data-timeline-handle": "end",
            "data-timeline-index": String(placedEntry.index),
          },
        });
      }
    }
  }

  private timelineItemKind(
    title: string,
  ): "setting-record" | "text-mark" | "unknown" {
    const key = title.trim().toLocaleLowerCase();
    if (this.markLabels.has(key)) {
      return "text-mark";
    }
    if (this.recordKeywords.has(key)) {
      return "setting-record";
    }
    return "unknown";
  }

  private novelRoot(): string {
    return this.plugin.findNovelGroupRoot(this.filePath)
      ?? this.plugin.normalizeFolderPath(
        this.filePath.split("/").slice(0, -1).join("/"),
      );
  }

  private async handleTimelineItemClick(
    index: number,
    bar: HTMLElement,
  ): Promise<void> {
    const entry = this.entries[index];
    if (!entry) {
      return;
    }
    const kind = this.timelineItemKind(entry.title);
    if (kind === "setting-record") {
      await this.plugin.openSettingRecordForNovelKeyword(
        this.novelRoot(),
        entry.title,
      );
      return;
    }
    if (kind === "text-mark") {
      const occurrence = await this.plugin.getFirstTextMarkOccurrence(
        this.novelRoot(),
        entry.title,
      );
      if (!occurrence) {
        new Notice("Novel View：没有找到对应的文字标记。");
        return;
      }
      await this.plugin.openTextMarkRange(
        occurrence.file,
        occurrence.start,
        occurrence.end,
      );
      return;
    }
    this.showTimelineInfo(entry, bar, "未绑定文本");
  }

  private closeTimelineInfo(): void {
    this.infoCard?.remove();
    this.infoCard = null;
    this.infoCleanup?.();
    this.infoCleanup = null;
  }

  private showTimelineInfo(
    entry: TimelineEntry,
    anchor: HTMLElement,
    label: string,
  ): void {
    this.closeTimelineInfo();
    const doc = anchor.ownerDocument;
    const card = doc.body.createDiv({
      cls: "novelview-timeline-info-card",
    });
    this.infoCard = card;
    const header = card.createDiv({
      cls: "novelview-timeline-info-header",
    });
    header.createSpan({
      cls: "novelview-timeline-info-title",
      text: entry.title,
    });
    header.createSpan({
      cls: "novelview-timeline-info-type",
      text: label,
    });
    const rows: Array<[string, string]> = [
      ["开始", entry.start || entry.time || "未设置"],
      ["结束", entry.end || "未设置"],
      ["轨道", entry.track || "默认"],
      ["描述", entry.description || "—"],
    ];
    for (const [name, value] of rows) {
      const row = card.createDiv({ cls: "novelview-timeline-info-row" });
      row.createSpan({
        cls: "novelview-timeline-info-name",
        text: name,
      });
      row.createSpan({
        cls: "novelview-timeline-info-value",
        text: value,
      });
    }
    const rect = anchor.getBoundingClientRect();
    card.setCssStyles({
      left: `${Math.min(
        Math.max(8, rect.left),
        Math.max(8, doc.defaultView?.innerWidth ?? 1200) - 268,
      )}px`,
      top: `${rect.bottom + 6}px`,
    });
    const close = (): void => this.closeTimelineInfo();
    const onPointer = (event: PointerEvent): void => {
      const target = event.target as Node | null;
      if (card.contains(target) || anchor.contains(target)) {
        return;
      }
      close();
    };
    const timer = window.setTimeout(() => {
      doc.addEventListener("pointerdown", onPointer, true);
    }, 0);
    this.infoCleanup = () => {
      window.clearTimeout(timer);
      doc.removeEventListener("pointerdown", onPointer, true);
    };
  }

  private timeAtPoint(clientX: number, clientY: number): string {
    const host = this.host;
    if (!host) {
      return "";
    }
    const lanes = [...host.querySelectorAll<HTMLElement>(
      ".novelview-special-timeline-lane",
    )];
    const lane = lanes.find((candidate) => {
      const rect = candidate.getBoundingClientRect();
      return clientY >= rect.top - 8 && clientY <= rect.bottom + 8;
    }) ?? lanes[0];
    const target = lane ?? host.querySelector<HTMLElement>(
      ".novelview-special-timeline-canvas",
    );
    if (!target) {
      return "";
    }
    const rect = target.getBoundingClientRect();
    if (rect.width <= 0) {
      return "";
    }
    const ratio = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width));
    const axis = this.axisRange();
    const sample = this.entries[0]?.start
      || this.entries[0]?.time
      || "2024-01-01";
    const ms = axis.min + ratio * (axis.max - axis.min);
    if (/^\d{4}-\d{2}-\d{2}/u.test(sample.trim())) {
      const precise = sample.includes(":")
        || axis.max - axis.min < 31 * 86_400_000;
      const pointSample = precise
        ? `${sample.trim().slice(0, 10)} 00:00`
        : sample;
      return formatTimelineTime(ms, pointSample);
    }
    return formatTimelineTime(ms, sample);
  }

  private axisRange(): { min: number; max: number } {
    if (this.drag) {
      return { min: this.drag.axisMin, max: this.drag.axisMax };
    }
    const values: number[] = [];
    this.entries.forEach((entry, index) => {
      values.push(
        timelineTimeMs(entry.start)
          ?? timelineTimeMs(entry.time)
          ?? index * 86_400_000,
      );
      values.push(
        timelineTimeMs(entry.end)
          ?? timelineTimeMs(entry.start)
          ?? index * 86_400_000,
      );
    });
    let min = Math.min(...values);
    let max = Math.max(...values);
    if (!Number.isFinite(min) || !Number.isFinite(max)) {
      min = 0;
      max = 86_400_000;
    }
    if (max <= min) {
      max = min + 86_400_000;
    }
    const pad = (max - min) * 0.04;
    return { min: min - pad, max: max + pad };
  }

  private placeEntries(): PlacedEntry[] {
    const rows: Array<Array<{ start: number; end: number }>> = [];
    return this.entries.map((entry, index) => {
      const start = timelineTimeMs(entry.start)
        ?? timelineTimeMs(entry.time)
        ?? index * 86_400_000;
      const end = Math.max(
        start,
        timelineTimeMs(entry.end) ?? start,
      );
      let row = entry.track
        ? Math.max(0, this.trackIndex(entry.track))
        : rows.findIndex((ranges) => ranges.every((range) => (
          range.end <= start || range.start >= end
        )));
      if (row < 0) {
        row = rows.length;
      }
      rows[row] ??= [];
      rows[row].push({ start, end });
      return { entry, index, row };
    });
  }

  private trackIndex(track: string): number {
    const index = this.entries
      .map((entry) => entry.track)
      .filter((value, position, list) => value && list.indexOf(value) === position)
      .indexOf(track);
    return index < 0 ? 0 : index;
  }

  private bindTimelineDrag(scene: HTMLElement): void {
    scene.addEventListener("pointerdown", (event) => {
      if (event.button !== 0) {
        return;
      }
      const target = event.target as Element | null;
      const bar = target?.closest<HTMLElement>("[data-timeline-index]");
      if (!bar) {
        return;
      }
      const index = Number(bar.dataset.timelineIndex);
      const entry = this.entries[index];
      if (!entry) {
        return;
      }
      const handle = target?.closest<HTMLElement>("[data-timeline-handle]");
      const lane = bar.closest<HTMLElement>(
        ".novelview-special-timeline-lane, .novelview-special-timeline-vlane",
      );
      const axis = this.axisRange();
      if (!lane) {
        return;
      }
      event.preventDefault();
      const vertical = this.orientation === "vertical";
      this.drag = {
        index,
        mode: handle?.dataset.timelineHandle === "start"
          ? "start"
          : handle?.dataset.timelineHandle === "end" ? "end" : "move",
        startX: event.clientX,
        startY: event.clientY,
        startMs: timelineTimeMs(entry.start)
          ?? timelineTimeMs(entry.time)
          ?? index * 86_400_000,
        endMs: timelineTimeMs(entry.end)
          ?? timelineTimeMs(entry.start)
          ?? index * 86_400_000,
        axisMin: axis.min,
        axisMax: axis.max,
        laneWidth: Math.max(1, vertical
          ? lane.getBoundingClientRect().height
          : lane.getBoundingClientRect().width),
        vertical,
        moved: false,
        bar,
      };
      try {
        scene.setPointerCapture(event.pointerId);
      } catch {
        // Synthetic pointer events do not own a native pointer.
      }
    });
    scene.addEventListener("pointermove", (event) => {
      const drag = this.drag;
      if (!drag) {
        return;
      }
      if (!drag.moved && Math.abs(
        drag.vertical ? event.clientY - drag.startY : event.clientX - drag.startX,
      ) > 2) {
        drag.moved = true;
      }
      if (!drag.moved) {
        return;
      }
      event.preventDefault();
      const entry = this.entries[drag.index];
      if (!entry) {
        return;
      }
      const delta = (
        (drag.vertical ? event.clientY - drag.startY : event.clientX - drag.startX)
        / drag.laneWidth
      ) * (drag.axisMax - drag.axisMin);
      const startSample = entry.start || entry.time;
      const endSample = entry.end || entry.start;
      if (drag.mode === "move") {
        entry.start = formatTimelineTime(drag.startMs + delta, startSample);
        entry.end = formatTimelineTime(drag.endMs + delta, endSample);
      } else if (drag.mode === "start") {
        const maxStart = drag.endMs - 60_000;
        entry.start = formatTimelineTime(
          Math.min(drag.startMs + delta, maxStart),
          startSample,
        );
        entry.end = formatTimelineTime(drag.endMs, endSample);
      } else {
        const minEnd = drag.startMs + 60_000;
        entry.end = formatTimelineTime(
          Math.max(drag.endMs + delta, minEnd),
          endSample,
        );
        entry.start = formatTimelineTime(drag.startMs, startSample);
      }
      this.drawTimeline();
    });
    const finish = (event: PointerEvent): void => {
      const drag = this.drag;
      this.drag = null;
      if (scene.hasPointerCapture(event.pointerId)) {
        scene.releasePointerCapture(event.pointerId);
      }
      if (!drag) {
        return;
      }
      const entry = this.entries[drag.index];
      if (!entry) {
        return;
      }
      if (drag.moved && this.editorView) {
        const current = this.editorView.state.doc.toString();
        const next = updateTimelineEntryRange(
          current,
          drag.index,
          entry.start,
          entry.end,
        );
        if (next !== current) {
          this.editorView.dispatch({
            changes: { from: 0, to: current.length, insert: next },
          });
        }
      } else if (!drag.moved && drag.mode === "move") {
        void this.handleTimelineItemClick(
          drag.index,
          drag.bar,
        );
      }
    };
    scene.addEventListener("pointerup", finish);
    scene.addEventListener("pointercancel", finish);
    scene.addEventListener("dblclick", (event) => {
      const target = event.target as Element | null;
      if (target?.closest(
        "[data-timeline-index], [data-timeline-handle], .novelview-special-timeline-controls",
      )) {
        return;
      }
      if (!this.editorView) {
        return;
      }
      event.preventDefault();
      event.stopPropagation();
      let name = "新关键词";
      let index = 2;
      const used = new Set(this.entries.map((entry) => entry.title));
      while (used.has(name)) {
        name = `新关键词 ${index}`;
        index += 1;
      }
      const start = this.timeAtPoint(event.clientX, event.clientY);
      const current = this.editorView.state.doc.toString();
      this.editorView.dispatch({
        changes: {
          from: current.length,
          insert: `\n- ${start} | ${name} | `,
        },
      });
    });
    scene.addEventListener("contextmenu", (event) => {
      const target = event.target as Element | null;
      const bar = target?.closest<HTMLElement>("[data-timeline-index]");
      if (!bar || !this.editorView) {
        return;
      }
      const index = Number(bar.dataset.timelineIndex);
      const entry = this.entries[index];
      if (!entry) {
        return;
      }
      event.preventDefault();
      event.stopPropagation();
      const menu = new Menu();
      menu.addItem((item) => {
        item.setTitle("调整开始位置").setIcon("clock").onClick(() => {
          this.openStartEditor(index, "调整开始位置");
        });
      });
      menu.addItem((item) => {
        item
          .setTitle("时间信息")
          .setIcon("calendar-clock")
          .onClick(() => {
            this.showTimelineInfo(entry, bar, "时间信息");
          });
      });
      menu.addSeparator();
      menu.addItem((item) => {
        item.setTitle("删除该轴项").setIcon("trash").onClick(() => {
          if (!this.editorView) {
            return;
          }
          const current = this.editorView.state.doc.toString();
          this.editorView.dispatch({
            changes: {
              from: 0,
              to: current.length,
              insert: deleteTimelineEntry(current, index),
            },
          });
        });
      });
      menu.showAtMouseEvent(event);
    });
  }

  private openStartEditor(index: number, title: string): void {
    const entry = this.entries[index];
    if (!entry || !this.editorView) {
      return;
    }
    new SettingGroupModal(
      this.app,
      title,
      entry.start || entry.time,
      async (value, setError) => {
        const start = value.trim();
        if (!start) {
          setError("开始时间不能为空。");
          return false;
        }
        const startMs = timelineTimeMs(start);
        if (startMs === null) {
          setError("无法识别开始时间。");
          return false;
        }
        const oldStartMs = timelineTimeMs(entry.start || entry.time);
        const oldEndMs = timelineTimeMs(entry.end);
        const duration = oldStartMs !== null && oldEndMs !== null
          ? Math.max(0, oldEndMs - oldStartMs)
          : 0;
        const nextEnd = duration > 0
          ? formatTimelineTime(startMs + duration, entry.end || start)
          : start;
        if (!this.editorView) {
          return false;
        }
        const current = this.editorView.state.doc.toString();
        const next = updateTimelineEntryRange(
          current,
          index,
          start,
          nextEnd,
        );
        if (next !== current) {
          this.editorView.dispatch({
            changes: { from: 0, to: current.length, insert: next },
          });
        }
        return true;
      },
      "开始时间",
    ).open();
  }
}
