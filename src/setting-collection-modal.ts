import { App, Modal } from "obsidian";
import type {
  SettingField,
  SettingMark,
  SettingRelation,
} from "./core/setting-collection";

const TAG_COLORS = [
  "#e74c3c",
  "#e67e22",
  "#f1c40f",
  "#2ecc71",
  "#3498db",
  "#9b59b6",
];

type ErrorSetter = (message: string) => void;

export class SettingGroupModal extends Modal {
  constructor(
    app: App,
    private readonly title: string,
    private readonly initial: string,
    private readonly validate: (value: string, setError: ErrorSetter) => Promise<boolean>,
    private readonly placeholder = "设定组名称",
  ) {
    super(app);
  }

  onOpen(): void {
    this.setTitle(this.title);
    this.modalEl.addClass("novelview-setting-modal");
    this.contentEl.empty();
    const input = this.contentEl.createEl("input", {
      cls: "novelview-setting-modal-input",
      attr: { type: "text", placeholder: this.placeholder, value: this.initial },
    });
    const error = this.contentEl.createDiv({ cls: "novelview-setting-modal-error" });
    const buttons = this.contentEl.createDiv({ cls: "modal-button-container" });
    buttons.createEl("button", { text: "取消", attr: { type: "button" } })
      .addEventListener("click", () => this.close());
    const submit = buttons.createEl("button", {
      cls: "mod-cta",
      text: "确定",
      attr: { type: "button" },
    });
    const finish = async (): Promise<void> => {
      const value = input.value.trim();
      if (!value) {
        error.setText("名称不能为空。");
        input.focus();
        return;
      }
      submit.disabled = true;
      try {
        if (await this.validate(value, (message) => error.setText(message))) {
          this.close();
        }
      } finally {
        submit.disabled = false;
      }
    };
    submit.addEventListener("click", () => void finish());
    input.addEventListener("keydown", (event) => {
      if (event.key === "Enter") {
        event.preventDefault();
        void finish();
      }
    });
    window.setTimeout(() => {
      input.focus();
      input.select();
    }, 0);
  }

  onClose(): void {
    this.contentEl.empty();
  }
}

export class SettingTagModal extends Modal {
  constructor(
    app: App,
    private readonly title: string,
    private readonly initialName: string,
    private readonly initialColor: string,
    private readonly validate: (
      name: string,
      color: string,
      setError: ErrorSetter,
    ) => Promise<boolean>,
  ) {
    super(app);
  }

  onOpen(): void {
    this.setTitle(this.title);
    this.modalEl.addClass("novelview-setting-modal");
    this.contentEl.empty();
    const nameLabel = this.contentEl.createDiv({
      cls: "novelview-setting-modal-label",
      text: "标签名称",
    });
    nameLabel.setAttr("aria-hidden", "true");
    const name = this.contentEl.createEl("input", {
      cls: "novelview-setting-modal-input",
      attr: { type: "text", placeholder: "标签名称", value: this.initialName },
    });
    const colorLabel = this.contentEl.createDiv({
      cls: "novelview-setting-modal-label",
      text: "标签颜色",
    });
    colorLabel.setAttr("aria-hidden", "true");
    const colorRow = this.contentEl.createDiv({
      cls: "novelview-setting-modal-color-row",
    });
    const initialColor = /^\d+$/u.test(this.initialColor)
      ? `#${Number(this.initialColor).toString(16).padStart(6, "0")}`
      : /^#[0-9a-f]{6}$/iu.test(this.initialColor)
        ? this.initialColor
        : "#3498db";
    const color = colorRow.createEl("input", {
      cls: "novelview-setting-modal-color",
      attr: { type: "color", value: initialColor },
    });
    colorRow.createSpan({
      cls: "novelview-setting-modal-color-value",
      text: initialColor,
    });
    const swatches = this.contentEl.createDiv({ cls: "novelview-setting-modal-swatches" });
    const swatchButtons: Array<{ value: string; button: HTMLButtonElement }> = [];
    const refreshSelection = (): void => {
      for (const swatch of swatchButtons) {
        swatch.button.toggleClass("is-selected", swatch.value === color.value);
      }
      const valueEl = colorRow.querySelector<HTMLElement>(
        ".novelview-setting-modal-color-value",
      );
      valueEl?.setText(color.value.toUpperCase());
    };
    TAG_COLORS.forEach((value, index) => {
      const swatch = swatches.createEl("button", {
        cls: `novelview-setting-modal-swatch novelview-setting-color-${index}`,
        attr: {
          type: "button",
          "aria-label": value,
          title: value,
        },
      });
      swatchButtons.push({ value, button: swatch });
      swatch.addEventListener("click", () => {
        color.value = value;
        refreshSelection();
      });
    });
    color.addEventListener("input", refreshSelection);
    refreshSelection();
    const error = this.contentEl.createDiv({ cls: "novelview-setting-modal-error" });
    const buttons = this.contentEl.createDiv({ cls: "modal-button-container" });
    buttons.createEl("button", { text: "取消", attr: { type: "button" } })
      .addEventListener("click", () => this.close());
    const submit = buttons.createEl("button", {
      cls: "mod-cta",
      text: "确定",
      attr: { type: "button" },
    });
    const finish = async (): Promise<void> => {
      const value = name.value.trim();
      if (!value) {
        error.setText("标签名称不能为空。");
        name.focus();
        return;
      }
      submit.disabled = true;
      try {
        if (await this.validate(value, color.value, (message) => error.setText(message))) {
          this.close();
        }
      } finally {
        submit.disabled = false;
      }
    };
    submit.addEventListener("click", () => void finish());
    name.addEventListener("keydown", (event) => {
      if (event.key === "Enter") {
        event.preventDefault();
        void finish();
      }
    });
    window.setTimeout(() => {
      name.focus();
      name.select();
    }, 0);
  }

  onClose(): void {
    this.contentEl.empty();
  }
}

export interface SettingRecordDraft {
  keyword: string;
  content: string;
  fields: SettingField[];
  relations: SettingRelation[];
  marks: SettingMark[];
}

export interface SettingRecordTarget {
  group: string;
  tag: string;
  keyword: string;
}

export class SettingConfirmModal extends Modal {
  constructor(
    app: App,
    private readonly title: string,
    private readonly message: string,
    private readonly confirmLabel: string,
    private readonly onConfirm: () => void | Promise<void>,
  ) {
    super(app);
  }

  onOpen(): void {
    this.setTitle(this.title);
    this.modalEl.addClass("novelview-setting-modal");
    this.contentEl.empty();
    this.contentEl.createEl("p", { text: this.message });
    const buttons = this.contentEl.createDiv({ cls: "modal-button-container" });
    buttons.createEl("button", { text: "取消", attr: { type: "button" } })
      .addEventListener("click", () => this.close());
    buttons.createEl("button", {
      cls: "mod-warning",
      text: this.confirmLabel,
      attr: { type: "button" },
    }).addEventListener("click", () => {
      this.close();
      void this.onConfirm();
    });
  }

  onClose(): void {
    this.contentEl.empty();
  }
}

export class SettingGraphModal extends Modal {
  constructor(
    app: App,
    private readonly title: string,
    private readonly index: import("./core/setting-collection").SettingCollectionIndex,
    private readonly onSelectKeyword?: (keyword: string) => void,
  ) {
    super(app);
  }

  onOpen(): void {
    this.setTitle(this.title);
    this.modalEl.parentElement?.setCssProps({ zIndex: "1100" });
    this.modalEl.addClass("novelview-setting-graph-modal");
    this.contentEl.empty();
    const records = Object.values(this.index)
      .flatMap((tags) => tags)
      .flatMap((tag) => tag.contain);
    const nodeNames = new Set<string>();
    for (const record of records) {
      if (record.keyword) {
        nodeNames.add(record.keyword);
      }
      for (const relation of record.relations) {
        if (relation.targetKeyword) {
          nodeNames.add(relation.targetKeyword);
        }
      }
    }
    const edges: Array<{
      from: string;
      to: string;
      type: string;
      direction: "one-way" | "two-way";
      side?: "left" | "right";
      linkId?: string;
    }> = [];
    for (const record of records) {
      for (const relation of record.relations) {
        if (record.keyword && relation.targetKeyword) {
          edges.push({
            from: record.keyword,
            to: relation.targetKeyword,
            type: relation.type,
            direction: relation.direction,
            side: relation.side,
            linkId: relation.linkId,
          });
        }
      }
    }
    if (nodeNames.size === 0 || edges.length === 0) {
      this.contentEl.createDiv({
        cls: "novelview-setting-collection-message",
        text: "当前设定组还没有关系数据。",
      });
      return;
    }
    const width = Math.max(520, this.contentEl.clientWidth - 20);
    const height = 420;
    const centerX = width / 2;
    const centerY = height / 2;
    const radius = Math.min(width, height) / 2 - 64;
    const names = [...nodeNames];
    const positions = new Map<string, { x: number; y: number }>();
    names.forEach((name, indexInGraph) => {
      const angle = (Math.PI * 2 * indexInGraph) / names.length - Math.PI / 2;
      positions.set(name, {
        x: centerX + Math.cos(angle) * radius,
        y: centerY + Math.sin(angle) * radius,
      });
    });
    const graph = this.contentEl.createDiv({
      cls: "novelview-setting-graph",
    });
    const svg = graph.createSvg("svg");
    svg.setAttr("viewBox", `0 0 ${width} ${height}`);
    svg.setAttr("width", "100%");
    svg.setAttr("height", String(height));
    const defs = svg.createSvg("defs");
    const marker = defs.createSvg("marker");
    marker.setAttr("id", "novelview-setting-graph-arrow");
    marker.setAttr("viewBox", "0 0 10 10");
    marker.setAttr("refX", "9");
    marker.setAttr("refY", "5");
    marker.setAttr("markerWidth", "10");
    marker.setAttr("markerHeight", "10");
    marker.setAttr("markerUnits", "userSpaceOnUse");
    marker.setAttr("orient", "auto-start-reverse");
    const arrow = marker.createSvg("path");
    arrow.setAttr("d", "M 0 0 L 10 5 L 0 10 z");
    arrow.addClass("novelview-setting-graph-arrow");
    const seenEdges = new Set<string>();
    for (const edge of edges) {
      const edgeKey = edge.linkId
        ?? [edge.from, edge.to].sort().join("\u0000");
      if (seenEdges.has(edgeKey)) {
        continue;
      }
      seenEdges.add(edgeKey);
      const from = positions.get(edge.from);
      const to = positions.get(edge.to);
      if (!from || !to) {
        continue;
      }
      const dx = to.x - from.x;
      const dy = to.y - from.y;
      const distance = Math.hypot(dx, dy);
      const nodeGap = 22;
      const x1 = from.x + (distance > 0 ? (dx / distance) * nodeGap : 0);
      const y1 = from.y + (distance > 0 ? (dy / distance) * nodeGap : 0);
      const x2 = to.x - (distance > 0 ? (dx / distance) * nodeGap : 0);
      const y2 = to.y - (distance > 0 ? (dy / distance) * nodeGap : 0);
      const line = svg.createSvg("line");
      line.setAttr("x1", String(x1));
      line.setAttr("y1", String(y1));
      line.setAttr("x2", String(x2));
      line.setAttr("y2", String(y2));
      if (edge.direction === "two-way") {
        line.setAttr("marker-start", "url(#novelview-setting-graph-arrow)");
        line.setAttr("marker-end", "url(#novelview-setting-graph-arrow)");
      } else if (edge.side === "left") {
        line.setAttr("marker-start", "url(#novelview-setting-graph-arrow)");
      } else {
        line.setAttr("marker-end", "url(#novelview-setting-graph-arrow)");
      }
      line.addClass("novelview-setting-graph-edge");
      const label = svg.createSvg("text");
      label.setAttr("x", String((x1 + x2) / 2));
      label.setAttr("y", String((y1 + y2) / 2 - 4));
      label.addClass("novelview-setting-graph-edge-label");
      label.textContent = edge.type || "关系";
    }
    const recordNames = new Set(
      records.filter((record) => record.keyword).map((record) => record.keyword),
    );
    for (const name of names) {
      const position = positions.get(name);
      if (!position) {
        continue;
      }
      const node = svg.createSvg("g");
      node.addClass("novelview-setting-graph-node");
      if (!recordNames.has(name)) {
        node.addClass("is-external");
      } else if (this.onSelectKeyword) {
        node.addEventListener("click", () => {
          this.onSelectKeyword?.(name);
        });
      }
      const circle = node.createSvg("circle");
      circle.setAttr("cx", String(position.x));
      circle.setAttr("cy", String(position.y));
      circle.setAttr("r", "17");
      const text = node.createSvg("text");
      text.setAttr("x", String(position.x));
      text.setAttr("y", String(position.y + 31));
      text.setAttr("text-anchor", "middle");
      text.textContent = name;
    }
  }

  onClose(): void {
    this.contentEl.empty();
  }
}
