import {
  Notice,
  TFile,
  TFolder,
  type WorkspaceLeaf,
} from "obsidian";
import {
  GRAPH_DEFAULT_HEIGHT,
  GRAPH_DEFAULT_WIDTH,
  graphEdgeKey,
  parseGraphLayout,
  parseGraphNodes,
  parseGraphSource,
  removeGraphNode,
  removeGraphRelation,
  removeGraphRelationsBetween,
  renameGraphRelation,
  serializeGraphLayout,
  type GraphLayout,
  type GraphRelation,
} from "../core/setting-special-data";
import { renameGraphNodeInSource } from "../core/graph-relations";
import { SpecialEditorBaseView } from "./base-editor-view";
import type NovelViewPlugin from "../main";

export const GRAPH_EDITOR_VIEW_TYPE = "novelview-graph-editor";

const NODE_RADIUS = 20;
const CONTAINER_MIN_WIDTH = 64;
const CONTAINER_MIN_HEIGHT = 64;

interface GraphDrag {
  kind: "node" | "curve" | "connect";
  node?: string;
  edgeIndex?: number;
  target?: string;
  startX: number;
  startY: number;
  offsetX: number;
  offsetY: number;
  pointerX: number;
  pointerY: number;
  moved: boolean;
  twoWay?: boolean;
  shiftKey?: boolean;
  container?: boolean;
  containerStart?: { x: number; y: number };
  memberStart?: Record<string, { x: number; y: number }>;
}

export class GraphEditorView extends SpecialEditorBaseView {
  protected readonly kind = "graph" as const;
  protected readonly viewType = GRAPH_EDITOR_VIEW_TYPE;
  protected readonly viewIcon = "git-fork";

  private scene: HTMLElement | null = null;
  private svg: SVGSVGElement | null = null;
  private relations: GraphRelation[] = [];
  private isolatedNodes: string[] = [];
  private layout: GraphLayout = {
    nodes: {},
    curves: {},
    containers: {},
    board: {
      width: GRAPH_DEFAULT_WIDTH,
      height: GRAPH_DEFAULT_HEIGHT,
    },
  };
  private positions = new Map<string, { x: number; y: number }>();
  private drag: GraphDrag | null = null;
  private boundScene: HTMLElement | null = null;
  private renameInput: HTMLInputElement | null = null;
  private renamingIndex: number | null = null;
  private hoveredNode: string | null = null;
  private layoutSaveScheduled = false;
  private settingRecordKeywords = new Set<string>();
  private settingKeywordsLoaded = false;
  private keywordRefreshTimer: number | null = null;
  private renderToken = 0;
  private nodeRenameInput: HTMLInputElement | null = null;
  private nodeRenamingName: string | null = null;
  private lastEdgeClick: { index: number; time: number } | null = null;

  constructor(leaf: WorkspaceLeaf, plugin: NovelViewPlugin) {
    super(leaf, plugin);
  }

  protected override async onOpen(): Promise<void> {
    await super.onOpen();
    this.registerDomEvent(activeDocument, "keydown", (event) => {
      if (
        event.repeat
        || event.key.toLocaleLowerCase() !== "f"
        || event.metaKey
        || event.ctrlKey
        || event.altKey
      ) {
        return;
      }
      const target = event.target as HTMLElement | null;
      if (
        target
        && typeof target.closest === "function"
        && target.closest("input, textarea, [contenteditable='true'], .cm-editor")
      ) {
        return;
      }
      if (this.app.workspace.getActiveViewOfType(GraphEditorView) !== this) {
        return;
      }
      this.convertHoveredToContainer();
    });
    const refresh = (file: import("obsidian").TAbstractFile): void => {
      if (file.name === "index.md" || file instanceof TFolder) {
        this.scheduleKeywordRefresh();
      }
    };
    this.registerEvent(this.app.vault.on("modify", refresh));
    this.registerEvent(this.app.vault.on("create", refresh));
    this.registerEvent(this.app.vault.on("delete", refresh));
    this.registerEvent(this.app.vault.on("rename", refresh));
  }

  private convertHoveredToContainer(): void {
    const name = this.hoveredNode;
    if (!name || !this.editorView) {
      return;
    }
    const position = this.positions.get(name) ?? this.layout.nodes[name];
    if (!position) {
      return;
    }
    if (this.layout.containers[name]) {
      delete this.layout.containers[name];
      this.layout.nodes[name] = { ...position };
      const current = this.editorView.state.doc.toString();
      const next = serializeGraphLayout(current, this.layout);
      if (next !== current) {
        this.editorView.dispatch({
          changes: { from: 0, to: current.length, insert: next },
        });
      }
      this.hoveredNode = null;
      new Notice(`Novel View：已将“${name}”转换为普通节点。`);
      return;
    }
    for (const container of Object.values(this.layout.containers)) {
      container.members = container.members.filter((member) => member !== name);
    }
    this.layout.containers[name] = {
      width: CONTAINER_MIN_WIDTH,
      height: CONTAINER_MIN_HEIGHT,
      members: [],
    };
    this.layout.nodes[name] = { x: position.x, y: position.y };
    let next = this.editorView.state.doc.toString();
    if (!parseGraphNodes(next).includes(name)) {
      next = `${next.trimEnd()}

- ${name}
`;
    }
    next = serializeGraphLayout(next, this.layout);
    this.editorView.dispatch({
      changes: {
        from: 0,
        to: this.editorView.state.doc.length,
        insert: next,
      },
    });
    this.hoveredNode = null;
    new Notice(`Novel View：已将“${name}”转换为圆角矩形容器。`);
  }

  protected helpText(): string {
    return "数据格式：- 甲 -> 乙 | 关系；- 甲 <-> 乙 | 双向；单独一行 - 节点 为孤立节点。悬停节点按 F 切换容器。";
  }

  protected templateInsertion(): string {
    return "\n- 节点A -> 节点B | 关系";
  }

  protected recordInsertion(payload: { keyword: string }): string {
    return `\n- ${payload.keyword}`;
  }

  protected async renderPreview(
    content: string,
    host: HTMLElement,
  ): Promise<void> {
    const token = ++this.renderToken;
    this.scene = host;
    this.layout = parseGraphLayout(content);
    this.relations = parseGraphSource(content);
    this.isolatedNodes = parseGraphNodes(content);
    if (this.boundScene !== host) {
      this.boundScene = host;
      this.bindGraphInteraction(host);
    }
    const root = this.plugin.findNovelGroupRoot(this.filePath)
      ?? this.plugin.normalizeFolderPath(
        this.filePath.split("/").slice(0, -1).join("/"),
      );
    this.settingRecordKeywords = await this.plugin.getSettingRecordKeywordsForNovel(root);
    if (token !== this.renderToken) {
      return;
    }
    this.settingKeywordsLoaded = true;
    this.drawGraph();
  }

  private scheduleKeywordRefresh(): void {
    if (this.keywordRefreshTimer !== null) {
      window.clearTimeout(this.keywordRefreshTimer);
    }
    this.keywordRefreshTimer = window.setTimeout(() => {
      this.keywordRefreshTimer = null;
      const root = this.plugin.findNovelGroupRoot(this.filePath)
        ?? this.plugin.normalizeFolderPath(
          this.filePath.split("/").slice(0, -1).join("/"),
        );
      void this.plugin.getSettingRecordKeywordsForNovel(root).then((keywords) => {
        this.settingRecordKeywords = keywords;
        this.settingKeywordsLoaded = true;
        this.drawGraph();
      });
    }, 220);
  }

  private bindGraphInteraction(scene: HTMLElement): void {
    scene.addEventListener("pointerdown", (event) => {
      if (event.button !== 0 || this.renameInput) {
        return;
      }
      const target = event.target as Element | null;
      const nodeEl = target?.closest<SVGElement>("[data-graph-node]");
      const edgeEl = target?.closest<SVGElement>("[data-graph-edge]");
      if (!nodeEl && !edgeEl) {
        this.lastEdgeClick = null;
      }
      if (nodeEl) {
        this.lastEdgeClick = null;
        const name = nodeEl.dataset.graphNode ?? "";
        const position = this.positions.get(name);
        const point = this.graphPoint(event.clientX, event.clientY);
        if (!position || !point) {
          return;
        }
        event.preventDefault();
        const distance = Math.hypot(
          point.x - position.x,
          point.y - position.y,
        );
        const container = this.layout.containers[name];
        let connect = !container && distance >= NODE_RADIUS - 5
          && distance <= NODE_RADIUS + 7;
        if (container) {
          const dx = Math.abs(point.x - position.x);
          const dy = Math.abs(point.y - position.y);
          const halfWidth = container.width / 2;
          const halfHeight = container.height / 2;
          connect = (
            Math.abs(dx - halfWidth) <= 6 && dy <= halfHeight + 6
          ) || (
            Math.abs(dy - halfHeight) <= 6 && dx <= halfWidth + 6
          );
        }
        const memberStart: Record<string, { x: number; y: number }> = {};
        if (container && !connect) {
          for (const member of container.members) {
            const memberPosition = this.positions.get(member);
            if (memberPosition) {
              memberStart[member] = { ...memberPosition };
            }
          }
        }
        this.drag = {
          kind: connect ? "connect" : "node",
          node: name,
          twoWay: connect && event.shiftKey,
          shiftKey: event.shiftKey,
          startX: event.clientX,
          startY: event.clientY,
          offsetX: point.x - position.x,
          offsetY: point.y - position.y,
          pointerX: point.x,
          pointerY: point.y,
          moved: false,
          container: Boolean(container),
          containerStart: container ? { ...position } : undefined,
          memberStart: container ? memberStart : undefined,
        };
        this.capturePointer(scene, event.pointerId);
        if (connect) {
          this.drawGraph();
        }
        return;
      }
      if (edgeEl) {
        const index = Number(edgeEl.dataset.graphEdge ?? "-1");
        const relation = this.relations[index];
        const now = Date.now();
        if (
          relation
          && this.lastEdgeClick?.index === index
          && now - this.lastEdgeClick.time <= 360
        ) {
          event.preventDefault();
          event.stopPropagation();
          this.lastEdgeClick = null;
          this.openInlineRename(index, relation, edgeEl);
          return;
        }
        this.lastEdgeClick = { index, time: now };
        event.preventDefault();
        const point = this.graphPoint(event.clientX, event.clientY);
        this.drag = {
          kind: "curve",
          edgeIndex: index,
          startX: event.clientX,
          startY: event.clientY,
          offsetX: 0,
          offsetY: 0,
          pointerX: point?.x ?? 0,
          pointerY: point?.y ?? 0,
          moved: false,
        };
        this.capturePointer(scene, event.pointerId);
      }
    });
    scene.addEventListener("pointermove", (event) => {
      const drag = this.drag;
      if (!drag) {
        return;
      }
      if (
        !drag.moved
        && Math.hypot(event.clientX - drag.startX, event.clientY - drag.startY) > 3
      ) {
        drag.moved = true;
      }
      if (!drag.moved) {
        return;
      }
      event.preventDefault();
      const point = this.graphPoint(event.clientX, event.clientY);
      if (!point) {
        return;
      }
      drag.pointerX = point.x;
      drag.pointerY = point.y;
      if (drag.kind === "node" && drag.node) {
        const x = point.x - drag.offsetX;
        const y = point.y - drag.offsetY;
        const container = this.layout.containers[drag.node];
        if (container) {
          if (x + container.width / 2 > this.layout.board.width - 40) {
            this.layout.board.width = Math.ceil(x + container.width / 2 + 140);
          }
          if (y + container.height / 2 > this.layout.board.height - 40) {
            this.layout.board.height = Math.ceil(y + container.height / 2 + 140);
          }
        } else {
          if (x > this.layout.board.width - 60) {
            this.layout.board.width = Math.ceil(x + 180);
          }
          if (y > this.layout.board.height - 60) {
            this.layout.board.height = Math.ceil(y + 180);
          }
        }
        this.layout.nodes[drag.node] = {
          x: Math.max(20, x),
          y: Math.max(20, y),
        };
        if (drag.container && drag.containerStart && drag.memberStart) {
          const dx = x - drag.containerStart.x;
          const dy = y - drag.containerStart.y;
          for (const [member, start] of Object.entries(drag.memberStart)) {
            this.layout.nodes[member] = {
              x: start.x + dx,
              y: start.y + dy,
            };
          }
        }
        this.drawGraph();
        return;
      }
      if (drag.kind === "connect" && drag.node) {
        const target = this.nodeAt(event.clientX, event.clientY);
        drag.target = target && target !== drag.node ? target : undefined;
        this.drawGraph();
        return;
      }
      if (drag.kind === "curve" && drag.edgeIndex !== undefined) {
        const relation = this.relations[drag.edgeIndex];
        const from = relation ? this.positions.get(relation.from) : null;
        const to = relation ? this.positions.get(relation.to) : null;
        if (!relation || !from || !to) {
          return;
        }
        const dx = to.x - from.x;
        const dy = to.y - from.y;
        const distance = Math.max(1, Math.hypot(dx, dy));
        const nx = -dy / distance;
        const ny = dx / distance;
        const midX = (from.x + to.x) / 2;
        const midY = (from.y + to.y) / 2;
        const curve = (
          (point.x - midX) * nx + (point.y - midY) * ny
        ) / (distance * 0.35);
        this.layout.curves[graphEdgeKey(relation)] = Math.min(
          1.5,
          Math.max(-1.5, curve),
        );
        this.drawGraph();
      }
    });
    const finish = (event: PointerEvent): void => {
      const drag = this.drag;
      this.drag = null;
      this.releasePointer(scene, event.pointerId);
      if (!drag) {
        return;
      }
      if (drag.kind === "connect") {
        if (drag.target && drag.node) {
          this.addConnection(drag.node, drag.target, drag.twoWay);
        }
        this.drawGraph();
        return;
      }
      if (
        drag.moved
        && drag.kind === "node"
        && drag.node
        && !this.layout.containers[drag.node]
      ) {
        const assignment = this.assignNodeToContainer(
          drag.node,
          this.graphPoint(event.clientX, event.clientY),
          Boolean(drag.shiftKey),
        );
        if (assignment?.added && assignment.target && this.editorView) {
          const current = this.editorView.state.doc.toString();
          const next = removeGraphRelationsBetween(
            current,
            drag.node,
            assignment.target,
          );
          if (next !== current) {
            this.editorView.dispatch({
              changes: { from: 0, to: current.length, insert: next },
            });
            const root = this.graphNovelRoot();
            if (root) {
              for (const relation of this.relations.filter((entry) => (
                (entry.from === drag.node && entry.to === assignment.target)
                || (entry.to === drag.node && entry.from === assignment.target)
              ))) {
                void this.plugin.removeGraphRelationEverywhere(root, relation);
              }
            }
          }
        }
      }
      if (drag.moved) {
        this.normalizeGraph();
        this.updateContainerGeometry();
        this.saveLayout();
      } else if (drag.kind === "node" && drag.node) {
        if (
          this.settingKeywordsLoaded
          && !this.settingRecordKeywords.has(
            drag.node.trim().toLocaleLowerCase(),
          )
        ) {
          this.openNodeRename(drag.node);
        } else {
          this.openSettingRecord(drag.node);
        }
      }
    };
    scene.addEventListener("pointerup", finish);
    scene.addEventListener("pointercancel", finish);
    scene.addEventListener("contextmenu", (event) => {
      const target = event.target as Element | null;
      const edgeEl = target?.closest<SVGElement>("[data-graph-edge]");
      if (edgeEl) {
        event.preventDefault();
        const relation = this.relations[Number(edgeEl.dataset.graphEdge)];
        if (relation && this.editorView) {
          const current = this.editorView.state.doc.toString();
          this.editorView.dispatch({
            changes: {
              from: 0,
              to: current.length,
              insert: removeGraphRelation(current, relation),
            },
          });
          const root = this.graphNovelRoot();
          if (root) {
            void this.plugin.removeGraphRelationEverywhere(root, relation);
          }
        }
        return;
      }
      const nodeEl = target?.closest<SVGElement>("[data-graph-node]");
      const name = nodeEl?.dataset.graphNode;
      if (name && this.editorView) {
        event.preventDefault();
        const current = this.editorView.state.doc.toString();
        this.editorView.dispatch({
          changes: {
            from: 0,
            to: current.length,
            insert: removeGraphNode(current, name),
          },
        });
      }
    });
    scene.addEventListener("dblclick", (event) => {
      const target = event.target as Element | null;
      if (target?.closest(
        "[data-graph-node], [data-graph-edge], .novelview-graph-rename-input",
      )) {
        return;
      }
      const point = this.graphPoint(event.clientX, event.clientY);
      if (!point || !this.editorView) {
        return;
      }
      event.preventDefault();
      event.stopPropagation();
      const existing = new Set(this.knownGraphNames());
      let name = "新节点";
      let index = 2;
      while (existing.has(name)) {
        name = `新节点 ${index}`;
        index += 1;
      }
      this.layout.nodes[name] = { x: point.x, y: point.y };
      let next = `${this.editorView.state.doc.toString().trimEnd()}\n\n- ${name}\n`;
      next = serializeGraphLayout(next, this.layout);
      this.editorView.dispatch({
        changes: {
          from: 0,
          to: this.editorView.state.doc.length,
          insert: next,
        },
      });
      const root = this.graphNovelRoot();
      if (root) {
        void this.plugin.syncGraphRelationsForNovel(root);
      }
    });
  }

  async refreshFromDisk(): Promise<void> {
    if (!this.editorView || !this.filePath) {
      return;
    }
    const file = this.app.vault.getAbstractFileByPath(this.filePath);
    if (!(file instanceof TFile)) {
      return;
    }
    const content = await this.app.vault.read(file);
    if (content === this.editorView.state.doc.toString()) {
      return;
    }
    this.editorView.dispatch({
      changes: {
        from: 0,
        to: this.editorView.state.doc.length,
        insert: content,
      },
    });
  }

  private graphNovelRoot(): string | null {
    return this.plugin.findNovelGroupRoot(this.filePath)
      ?? this.plugin.normalizeFolderPath(
        this.filePath.split("/").slice(0, -1).join("/"),
      );
  }

  private knownGraphNames(): string[] {
    return [...new Set([
      ...this.relations.flatMap((relation) => [relation.from, relation.to]),
      ...this.isolatedNodes,
      ...Object.keys(this.layout.containers),
    ])];
  }

  private openNodeRename(name: string): void {
    if (this.nodeRenameInput) {
      this.finishNodeRename(true);
    }
    const host = this.scene?.parentElement;
    const nodeEl = this.scene?.querySelector<SVGElement>(
      `[data-graph-node="${CSS.escape(name)}"]`,
    );
    if (!host || !nodeEl) {
      return;
    }
    const rect = nodeEl.getBoundingClientRect();
    const hostRect = host.getBoundingClientRect();
    const input = host.createEl("input", {
      cls: "novelview-graph-rename-input",
      attr: { type: "text", "aria-label": "节点名称" },
    });
    input.value = name;
    input.setCssStyles({
      left: `${Math.max(6, rect.left - hostRect.left + rect.width / 2)}px`,
      top: `${Math.max(6, rect.top - hostRect.top + rect.height / 2)}px`,
    });
    this.nodeRenameInput = input;
    this.nodeRenamingName = name;
    const stop = (event: Event): void => {
      event.stopPropagation();
    };
    for (const type of ["pointerdown", "pointerup", "click", "dblclick", "wheel"]) {
      input.addEventListener(type, stop);
    }
    input.addEventListener("keydown", (event) => {
      event.stopPropagation();
      if (event.key === "Enter") {
        event.preventDefault();
        this.finishNodeRename(true);
      } else if (event.key === "Escape") {
        event.preventDefault();
        this.finishNodeRename(false);
      }
    });
    input.addEventListener("blur", () => {
      if (this.nodeRenameInput === input) {
        this.finishNodeRename(true);
      }
    });
    window.setTimeout(() => {
      input.focus();
      input.select();
    }, 0);
  }

  private finishNodeRename(commit: boolean): void {
    const input = this.nodeRenameInput;
    const oldName = this.nodeRenamingName;
    if (!input || !oldName) {
      return;
    }
    const nextName = input.value.trim();
    if (commit && !nextName) {
      input.addClass("is-invalid");
      input.setAttribute("title", "节点名称不能为空");
      input.focus();
      return;
    }
    if (
      commit
      && nextName !== oldName
      && this.knownGraphNames().some((name) => name === nextName)
    ) {
      input.addClass("is-invalid");
      input.setAttribute("title", "当前图谱已存在同名节点");
      input.focus();
      return;
    }
    this.nodeRenameInput = null;
    this.nodeRenamingName = null;
    input.remove();
    if (!commit || !nextName || nextName === oldName || !this.editorView) {
      return;
    }
    const current = this.editorView.state.doc.toString();
    const next = renameGraphNodeInSource(current, oldName, nextName);
    if (next !== current) {
      this.editorView.dispatch({
        changes: { from: 0, to: current.length, insert: next },
      });
      const root = this.graphNovelRoot();
      if (root) {
        void this.plugin.renameGraphNodeEverywhere(
          root,
          oldName,
          nextName,
          this.filePath,
        );
      }
    }
  }

  private openInlineRename(
    index: number,
    relation: GraphRelation,
    edgeEl: SVGElement,
  ): void {
    if (this.renameInput) {
      this.finishInlineRename(true);
    }
    const host = this.scene?.parentElement;
    if (!host) {
      return;
    }
    const label = edgeEl.querySelector("text");
    const labelRect = label?.getBoundingClientRect();
    const hostRect = host.getBoundingClientRect();
    const input = host.createEl("input", {
      cls: "novelview-graph-rename-input",
      attr: {
        type: "text",
        value: relation.label,
        "aria-label": "关系名",
      },
    });
    input.value = relation.label;
    const left = labelRect
      ? labelRect.left - hostRect.left + labelRect.width / 2
      : hostRect.width / 2;
    const top = labelRect
      ? labelRect.top - hostRect.top + labelRect.height / 2
      : hostRect.height / 2;
    input.setCssStyles({
      left: `${Math.max(6, left)}px`,
      top: `${Math.max(6, top)}px`,
    });
    this.renameInput = input;
    this.renamingIndex = index;
    const stop = (event: Event): void => {
      event.stopPropagation();
    };
    for (const type of [
      "pointerdown",
      "pointerup",
      "pointermove",
      "click",
      "dblclick",
      "wheel",
    ]) {
      input.addEventListener(type, stop);
    }
    input.addEventListener("keydown", (event) => {
      event.stopPropagation();
      if (event.key === "Enter") {
        event.preventDefault();
        this.finishInlineRename(true);
      } else if (event.key === "Escape") {
        event.preventDefault();
        this.finishInlineRename(false);
      }
    });
    input.addEventListener("blur", () => {
      if (this.renameInput === input) {
        this.finishInlineRename(true);
      }
    });
    window.setTimeout(() => {
      input.focus();
      input.select();
    }, 0);
  }

  private finishInlineRename(commit: boolean): void {
    const input = this.renameInput;
    const index = this.renamingIndex;
    if (!input) {
      return;
    }
    const value = input.value.trim();
    if (commit && !value) {
      input.addClass("is-invalid");
      input.setAttr("title", "关系名不能为空");
      input.focus();
      return;
    }
    this.renameInput = null;
    this.renamingIndex = null;
    input.remove();
    if (!commit || !value || index === null || !this.editorView) {
      return;
    }
    const relation = this.relations[index];
    if (!relation || relation.label === value) {
      return;
    }
    const current = this.editorView.state.doc.toString();
    const next = renameGraphRelation(current, relation, value);
    if (next !== current) {
      this.editorView.dispatch({
        changes: { from: 0, to: current.length, insert: next },
      });
      const root = this.graphNovelRoot();
      if (root) {
        void this.plugin.renameGraphRelationEverywhere(root, relation, value);
      }
    }
  }

  private nodeAt(clientX: number, clientY: number): string | null {
    const element = this.contentEl.ownerDocument.elementFromPoint(
      clientX,
      clientY,
    );
    const node = element?.closest<SVGElement>("[data-graph-node]");
    return node?.dataset.graphNode ?? null;
  }

  private addConnection(from: string, to: string, twoWay = false): void {
    if (!this.editorView || from === to) {
      return;
    }
    const current = this.editorView.state.doc.toString();
    const line = `\n- ${from} ${twoWay ? "<->" : "->"} ${to} | 关系`;
    this.editorView.dispatch({
      changes: { from: current.length, insert: line },
    });
    const root = this.graphNovelRoot();
    if (root) {
      window.setTimeout(() => {
        void this.plugin.syncGraphRelationsForNovel(root);
      }, 650);
    }
  }

  private capturePointer(scene: HTMLElement, pointerId: number): void {
    try {
      scene.setPointerCapture(pointerId);
    } catch {
      // Synthetic pointer events do not own a native pointer.
    }
  }

  private releasePointer(scene: HTMLElement, pointerId: number): void {
    if (scene.hasPointerCapture(pointerId)) {
      scene.releasePointerCapture(pointerId);
    }
  }

  private graphPoint(
    clientX: number,
    clientY: number,
  ): { x: number; y: number } | null {
    const svg = this.svg;
    if (!svg) {
      return null;
    }
    const rect = svg.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) {
      return null;
    }
    return {
      x: ((clientX - rect.left) / rect.width) * this.layout.board.width,
      y: ((clientY - rect.top) / rect.height) * this.layout.board.height,
    };
  }

  private edgeAnchor(
    name: string,
    center: { x: number; y: number },
    control: { x: number; y: number },
  ): { x: number; y: number } {
    const container = this.layout.containers[name];
    if (!container) {
      return this.trimPoint(center, control, NODE_RADIUS);
    }
    let dx = control.x - center.x;
    let dy = control.y - center.y;
    if (Math.abs(dx) + Math.abs(dy) < 0.001) {
      dx = 1;
      dy = 0;
    }
    const length = Math.hypot(dx, dy);
    const ux = dx / length;
    const uy = dy / length;
    const scaleX = Math.abs(ux) > 0.0001
      ? (container.width / 2) / Math.abs(ux)
      : Number.POSITIVE_INFINITY;
    const scaleY = Math.abs(uy) > 0.0001
      ? (container.height / 2) / Math.abs(uy)
      : Number.POSITIVE_INFINITY;
    const scale = Math.min(scaleX, scaleY);
    return {
      x: center.x + ux * (scale + 2),
      y: center.y + uy * (scale + 2),
    };
  }

  private trimPoint(
    from: { x: number; y: number },
    to: { x: number; y: number },
    distance: number,
  ): { x: number; y: number } {
    const dx = to.x - from.x;
    const dy = to.y - from.y;
    const length = Math.max(1, Math.hypot(dx, dy));
    return {
      x: from.x + (dx / length) * distance,
      y: from.y + (dy / length) * distance,
    };
  }

  private normalBounds(name: string): {
    left: number;
    right: number;
    top: number;
    bottom: number;
    cx: number;
    cy: number;
    width: number;
    height: number;
  } | null {
    const center = this.positions.get(name);
    if (!center) {
      return null;
    }
    const labelWidth = Math.min(180, Math.max(48, name.length * 13));
    const halfWidth = Math.max(NODE_RADIUS + 4, labelWidth / 2);
    return {
      left: center.x - halfWidth,
      right: center.x + halfWidth,
      top: center.y - NODE_RADIUS - 2,
      bottom: center.y + NODE_RADIUS + 22,
      cx: center.x,
      cy: center.y,
      width: halfWidth * 2,
      height: NODE_RADIUS * 2 + 24,
    };
  }

  private containerBounds(name: string): {
    left: number;
    right: number;
    top: number;
    bottom: number;
    cx: number;
    cy: number;
    width: number;
    height: number;
  } | null {
    const center = this.positions.get(name);
    const container = this.layout.containers[name];
    if (!center || !container) {
      return null;
    }
    return {
      left: center.x - container.width / 2,
      right: center.x + container.width / 2,
      top: center.y - container.height / 2,
      bottom: center.y + container.height / 2,
      cx: center.x,
      cy: center.y,
      width: container.width,
      height: container.height,
    };
  }

  private overlaps(
    first: { left: number; right: number; top: number; bottom: number },
    second: { left: number; right: number; top: number; bottom: number },
    gap = 0,
  ): boolean {
    return first.left < second.right + gap
      && first.right > second.left - gap
      && first.top < second.bottom + gap
      && first.bottom > second.top - gap;
  }

  private normalizeGraph(): boolean {
    let changed = false;
    for (let round = 0; round < 15; round += 1) {
      this.updateContainerGeometry();
      const beforeMembers = JSON.stringify(
        Object.fromEntries(Object.entries(this.layout.containers).map(
          ([name, container]) => [name, container.members],
        )),
      );
      const containerNames = Object.keys(this.layout.containers);
      for (const name of this.positions.keys()) {
        if (this.layout.containers[name]) {
          continue;
        }
        const normal = this.normalBounds(name);
        if (!normal) {
          continue;
        }
        let target: { name: string; area: number } | null = null;
        for (const containerName of containerNames) {
          const box = this.containerBounds(containerName);
          if (box && this.overlaps(normal, box)) {
            const area = box.width * box.height;
            if (!target || area < target.area) {
              target = { name: containerName, area };
            }
          }
        }
        for (const container of Object.values(this.layout.containers)) {
          container.members = container.members.filter((member) => member !== name);
        }
        if (target) {
          this.layout.containers[target.name]?.members.push(name);
        }
      }
      if (beforeMembers !== JSON.stringify(
        Object.fromEntries(Object.entries(this.layout.containers).map(
          ([name, container]) => [name, container.members],
        )),
      )) {
        changed = true;
      }
      this.updateContainerGeometry();
      const containerBoxes = Object.keys(this.layout.containers)
        .map((name) => ({ name, box: this.containerBounds(name) }))
        .filter((entry): entry is { name: string; box: NonNullable<ReturnType<GraphEditorView["containerBounds"]>> } => Boolean(entry.box));
      let separated = false;
      for (let firstIndex = 0; firstIndex < containerBoxes.length; firstIndex += 1) {
        for (let secondIndex = firstIndex + 1; secondIndex < containerBoxes.length; secondIndex += 1) {
          const first = containerBoxes[firstIndex];
          const second = containerBoxes[secondIndex];
          if (!first || !second || !this.overlaps(first.box, second.box, 8)) {
            continue;
          }
          let dx = second.box.cx - first.box.cx;
          let dy = second.box.cy - first.box.cy;
          if (Math.abs(dx) + Math.abs(dy) < 0.01) {
            dx = 1;
            dy = 0;
          }
          const overlapX = (first.box.width + second.box.width) / 2 + 8 - Math.abs(dx);
          const overlapY = (first.box.height + second.box.height) / 2 + 8 - Math.abs(dy);
          if (overlapX <= overlapY) {
            this.moveGraphNode(first.name, (dx >= 0 ? 1 : -1) * overlapX / 2, 0);
            this.moveGraphNode(second.name, (dx >= 0 ? -1 : 1) * overlapX / 2, 0);
          } else {
            this.moveGraphNode(first.name, 0, (dy >= 0 ? 1 : -1) * overlapY / 2);
            this.moveGraphNode(second.name, 0, (dy >= 0 ? -1 : 1) * overlapY / 2);
          }
          separated = true;
        }
      }
      if (separated) {
        changed = true;
        this.updateContainerGeometry();
      }
      const normalNames = [...this.positions.keys()].filter(
        (name) => !this.layout.containers[name],
      );
      let movedNormals = false;
      for (let firstIndex = 0; firstIndex < normalNames.length; firstIndex += 1) {
        for (let secondIndex = firstIndex + 1; secondIndex < normalNames.length; secondIndex += 1) {
          const firstName = normalNames[firstIndex];
          const secondName = normalNames[secondIndex];
          if (!firstName || !secondName) {
            continue;
          }
          const first = this.normalBounds(firstName);
          const second = this.normalBounds(secondName);
          if (!first || !second || !this.overlaps(first, second, 8)) {
            continue;
          }
          let dx = second.cx - first.cx;
          let dy = second.cy - first.cy;
          if (Math.abs(dx) + Math.abs(dy) < 0.01) {
            dx = 1;
            dy = 0;
          }
          const overlapX = (first.width + second.width) / 2 + 8 - Math.abs(dx);
          const overlapY = (first.height + second.height) / 2 + 8 - Math.abs(dy);
          if (overlapX <= overlapY) {
            this.moveGraphNode(firstName, (dx >= 0 ? -1 : 1) * overlapX / 2, 0);
            this.moveGraphNode(secondName, (dx >= 0 ? 1 : -1) * overlapX / 2, 0);
          } else {
            this.moveGraphNode(firstName, 0, (dy >= 0 ? -1 : 1) * overlapY / 2);
            this.moveGraphNode(secondName, 0, (dy >= 0 ? 1 : -1) * overlapY / 2);
          }
          movedNormals = true;
        }
      }
      if (movedNormals) {
        changed = true;
      }
      if (!separated && !movedNormals) {
        break;
      }
    }
    return changed;
  }

  private moveGraphNode(name: string, dx: number, dy: number): void {
    const center = this.positions.get(name);
    if (!center) {
      return;
    }
    const next = {
      x: Math.max(20, center.x + dx),
      y: Math.max(20, center.y + dy),
    };
    this.positions.set(name, next);
    this.layout.nodes[name] = next;
    const container = this.layout.containers[name];
    if (container) {
      for (const member of container.members) {
        const memberPosition = this.positions.get(member);
        if (!memberPosition) {
          continue;
        }
        const moved = {
          x: Math.max(20, memberPosition.x + dx),
          y: Math.max(20, memberPosition.y + dy),
        };
        this.positions.set(member, moved);
        this.layout.nodes[member] = moved;
      }
    }
  }

  private fitBoard(): void {
    if (this.positions.size === 0) {
      this.layout.board.width = GRAPH_DEFAULT_WIDTH;
      this.layout.board.height = GRAPH_DEFAULT_HEIGHT;
      return;
    }
    let minX = Number.POSITIVE_INFINITY;
    let minY = Number.POSITIVE_INFINITY;
    let maxX = Number.NEGATIVE_INFINITY;
    let maxY = Number.NEGATIVE_INFINITY;
    for (const [name, point] of this.positions) {
      const container = this.layout.containers[name];
      const halfWidth = (container?.width ?? 0) / 2;
      const halfHeight = (container?.height ?? 0) / 2;
      minX = Math.min(minX, point.x - halfWidth);
      minY = Math.min(minY, point.y - halfHeight);
      maxX = Math.max(maxX, point.x + halfWidth);
      maxY = Math.max(maxY, point.y + halfHeight);
    }
    const padding = 90;
    const shiftX = Math.max(0, padding - minX);
    const shiftY = Math.max(0, padding - minY);
    if (shiftX > 0 || shiftY > 0) {
      for (const [name, point] of this.positions) {
        const shifted = { x: point.x + shiftX, y: point.y + shiftY };
        this.positions.set(name, shifted);
        this.layout.nodes[name] = shifted;
      }
      maxX += shiftX;
      maxY += shiftY;
    }
    this.layout.board.width = Math.max(360, Math.ceil(maxX + padding));
    this.layout.board.height = Math.max(260, Math.ceil(maxY + padding));
  }

  private assignNodeToContainer(
    name: string,
    point: { x: number; y: number } | null,
    shiftKey: boolean,
  ): { target: string; added: boolean } | null {
    if (!point) {
      return null;
    }
    let target: string | null = null;
    let targetArea = Number.POSITIVE_INFINITY;
    for (const [containerName, container] of Object.entries(this.layout.containers)) {
      if (containerName === name) {
        continue;
      }
      const position = this.positions.get(containerName);
      if (!position) {
        continue;
      }
      if (
        Math.abs(point.x - position.x) <= container.width / 2
        && Math.abs(point.y - position.y) <= container.height / 2
        && container.width * container.height < targetArea
      ) {
        target = containerName;
        targetArea = container.width * container.height;
      }
    }
    if (!target) {
      if (shiftKey) {
        for (const container of Object.values(this.layout.containers)) {
          container.members = container.members.filter(
            (member) => member !== name,
          );
        }
      }
      return null;
    }
    const wasMember = this.layout.containers[target]?.members.includes(name)
      ?? false;
    for (const [containerName, container] of Object.entries(this.layout.containers)) {
      container.members = container.members.filter((member) => (
        member !== name
      ));
      if (containerName === target) {
        container.members.push(name);
      }
    }
    return { target, added: !wasMember };
  }

  private updateContainerGeometry(): void {
    for (const [name, container] of Object.entries(this.layout.containers)) {
      if (container.members.length === 0 && (
        container.width > CONTAINER_MIN_WIDTH
        || container.height > CONTAINER_MIN_HEIGHT
      )) {
        const position = this.positions.get(name);
        if (position) {
          for (const [memberName, memberPosition] of this.positions) {
            if (
              memberName !== name
              && !this.layout.containers[memberName]
              && Math.abs(memberPosition.x - position.x) <= container.width / 2
              && Math.abs(memberPosition.y - position.y) <= container.height / 2
            ) {
              container.members.push(memberName);
            }
          }
        }
      }
      const memberPositions = container.members
        .map((member) => this.positions.get(member))
        .filter((point): point is { x: number; y: number } => Boolean(point));
      if (memberPositions.length === 0) {
        container.width = CONTAINER_MIN_WIDTH;
        container.height = CONTAINER_MIN_HEIGHT;
        continue;
      }
      let minX = Number.POSITIVE_INFINITY;
      let minY = Number.POSITIVE_INFINITY;
      let maxX = Number.NEGATIVE_INFINITY;
      let maxY = Number.NEGATIVE_INFINITY;
      for (const point of memberPositions) {
        minX = Math.min(minX, point.x);
        minY = Math.min(minY, point.y);
        maxX = Math.max(maxX, point.x);
        maxY = Math.max(maxY, point.y);
      }
      const centerX = (minX + maxX) / 2;
      const centerY = (minY + maxY) / 2;
      container.width = Math.max(
        CONTAINER_MIN_WIDTH,
        Math.ceil(maxX - minX + 80),
      );
      container.height = Math.max(
        CONTAINER_MIN_HEIGHT,
        Math.ceil(maxY - minY + 78),
      );
      this.positions.set(name, { x: centerX, y: centerY });
      this.layout.nodes[name] = { x: centerX, y: centerY };
    }
  }

  private saveLayout(): void {
    if (!this.editorView) {
      return;
    }
    this.fitBoard();
    const current = this.editorView.state.doc.toString();
    const next = serializeGraphLayout(current, this.layout);
    if (next === current) {
      return;
    }
    this.editorView.dispatch({
      changes: { from: 0, to: current.length, insert: next },
    });
  }

  private drawGraph(): void {
    const scene = this.scene;
    if (!scene) {
      return;
    }
    scene.empty();
    this.positions.clear();
    const names = [...new Set([
      ...this.relations.flatMap((relation) => [relation.from, relation.to]),
      ...this.isolatedNodes,
      ...Object.keys(this.layout.containers),
    ])];
    if (this.drag?.kind === "connect" && this.drag.node) {
      names.push(this.drag.node);
    }
    if (names.length === 0) {
      scene.createDiv({
        cls: "novelview-special-editor-empty",
        text: "从设定集拖入记录，或切换到源码视图添加节点/关系。",
      });
      return;
    }
    const uniqueNames = [...new Set(names)];
    const width = this.layout.board.width;
    const height = this.layout.board.height;
    const radius = Math.min(width, height) / 2 - 56;
    const centerX = width / 2;
    const centerY = height / 2;
    uniqueNames.forEach((name, index) => {
      const saved = this.layout.nodes[name];
      if (saved) {
        this.positions.set(name, { x: saved.x, y: saved.y });
        return;
      }
      const angle = (Math.PI * 2 * index) / uniqueNames.length - Math.PI / 2;
      this.positions.set(name, {
        x: centerX + Math.cos(angle) * radius,
        y: centerY + Math.sin(angle) * radius,
      });
    });
    this.updateContainerGeometry();
    const normalized = this.drag ? false : this.normalizeGraph();
    if (normalized && !this.layoutSaveScheduled) {
      this.layoutSaveScheduled = true;
      window.setTimeout(() => {
        this.layoutSaveScheduled = false;
        if (!this.drag) {
          this.saveLayout();
        }
      }, 0);
    }
    if (this.drag?.kind !== "node") {
      this.fitBoard();
    }
    const fittedWidth = this.layout.board.width;
    const fittedHeight = this.layout.board.height;
    const graph = scene.createDiv({ cls: "novelview-special-graph" });
    graph.setCssStyles({
      width: `${fittedWidth}px`,
      height: `${fittedHeight}px`,
    });
    const svg = graph.createSvg("svg");
    this.svg = svg;
    svg.setAttr("viewBox", `0 0 ${fittedWidth} ${fittedHeight}`);
    svg.setAttr("width", "100%");
    svg.setAttr("height", "100%");
    const boundary = svg.createSvg("rect");
    boundary.setAttr("x", "1");
    boundary.setAttr("y", "1");
    boundary.setAttr("width", String(Math.max(1, fittedWidth - 2)));
    boundary.setAttr("height", String(Math.max(1, fittedHeight - 2)));
    boundary.addClass("novelview-special-graph-boundary");
    const defs = svg.createSvg("defs");
    const marker = defs.createSvg("marker");
    marker.setAttr("id", "novelview-special-graph-arrow");
    marker.setAttr("viewBox", "0 0 10 10");
    marker.setAttr("refX", "9");
    marker.setAttr("refY", "5");
    marker.setAttr("markerWidth", "9");
    marker.setAttr("markerHeight", "9");
    marker.setAttr("markerUnits", "userSpaceOnUse");
    marker.setAttr("orient", "auto-start-reverse");
    const arrow = marker.createSvg("path");
    arrow.setAttr("d", "M 0 0 L 10 5 L 0 10 z");
    arrow.addClass("novelview-special-graph-arrow");

    for (const [name, container] of Object.entries(this.layout.containers)) {
      const position = this.positions.get(name);
      if (!position) {
        continue;
      }
      const group = svg.createSvg("g");
      group.setAttr("data-graph-node", name);
      group.setAttr("data-graph-container", "true");
      group.addClass("novelview-special-graph-container");
      if (
        this.settingKeywordsLoaded
        && !this.settingRecordKeywords.has(name.trim().toLocaleLowerCase())
      ) {
        group.addClass("is-unrecorded");
      }
      const rect = group.createSvg("rect");
      rect.setAttr("x", String(position.x - container.width / 2));
      rect.setAttr("y", String(position.y - container.height / 2));
      rect.setAttr("width", String(container.width));
      rect.setAttr("height", String(container.height));
      rect.setAttr("rx", "16");
      rect.addClass("novelview-special-graph-container-rect");
      const label = group.createSvg("text");
      label.setAttr("x", String(position.x - container.width / 2 + 12));
      label.setAttr("y", String(position.y - container.height / 2 + 20));
      label.addClass("novelview-special-graph-container-label");
      label.textContent = name;
      group.addEventListener("pointerenter", () => {
        this.hoveredNode = name;
      });
      group.addEventListener("pointerleave", () => {
        rect.classList.remove("is-border-hover", "is-inside-hover");
        if (this.hoveredNode === name) {
          this.hoveredNode = null;
        }
      });
      group.addEventListener("pointermove", (event) => {
        const point = this.graphPoint(event.clientX, event.clientY);
        if (!point) {
          return;
        }
        const dx = Math.abs(point.x - position.x);
        const dy = Math.abs(point.y - position.y);
        const halfWidth = container.width / 2;
        const halfHeight = container.height / 2;
        const border = (
          Math.abs(dx - halfWidth) <= 6 && dy <= halfHeight + 6
        ) || (
          Math.abs(dy - halfHeight) <= 6 && dx <= halfWidth + 6
        );
        rect.classList.toggle("is-border-hover", border);
        rect.classList.toggle("is-inside-hover", !border);
      });
    }

    for (const [index, relation] of this.relations.entries()) {
      const from = this.positions.get(relation.from);
      const to = this.positions.get(relation.to);
      if (!from || !to) {
        continue;
      }
      const dx = to.x - from.x;
      const dy = to.y - from.y;
      const distance = Math.max(1, Math.hypot(dx, dy));
      const nx = -dy / distance;
      const ny = dx / distance;
      const curve = this.layout.curves[graphEdgeKey(relation)] ?? 0;
      const control = {
        x: (from.x + to.x) / 2 + nx * distance * 0.35 * curve,
        y: (from.y + to.y) / 2 + ny * distance * 0.35 * curve,
      };
      const start = this.edgeAnchor(relation.from, from, control);
      const end = this.edgeAnchor(relation.to, to, control);
      const edgeGroup = svg.createSvg("g");
      edgeGroup.setAttr("data-graph-edge", String(index));
      edgeGroup.addClass("novelview-special-graph-edge-group");
      const hit = edgeGroup.createSvg("path");
      hit.setAttr(
        "d",
        `M ${start.x} ${start.y} Q ${control.x} ${control.y} ${end.x} ${end.y}`,
      );
      hit.addClass("novelview-special-graph-edge-hit");
      const path = edgeGroup.createSvg("path");
      path.setAttr(
        "d",
        `M ${start.x} ${start.y} Q ${control.x} ${control.y} ${end.x} ${end.y}`,
      );
      path.setAttr("marker-end", "url(#novelview-special-graph-arrow)");
      if (relation.twoWay) {
        path.setAttr("marker-start", "url(#novelview-special-graph-arrow)");
      }
      path.addClass("novelview-special-graph-edge");
      const mid = {
        x: (from.x + 2 * control.x + to.x) / 4,
        y: (from.y + 2 * control.y + to.y) / 4,
      };
      const label = edgeGroup.createSvg("text");
      label.setAttr("x", String(mid.x));
      label.setAttr("y", String(mid.y - 5));
      label.addClass("novelview-special-graph-label");
      label.textContent = relation.label;
    }

    if (this.drag?.kind === "connect" && this.drag.node) {
      const from = this.positions.get(this.drag.node);
      if (from) {
        const line = svg.createSvg("line");
        line.setAttr("x1", String(from.x));
        line.setAttr("y1", String(from.y));
        line.setAttr("x2", String(this.drag.pointerX));
        line.setAttr("y2", String(this.drag.pointerY));
        line.addClass("novelview-special-graph-connect-preview");
      }
    }

    for (const name of uniqueNames) {
      if (this.layout.containers[name]) {
        continue;
      }
      const position = this.positions.get(name);
      if (!position) {
        continue;
      }
      const node = svg.createSvg("g");
      node.addClass("novelview-special-graph-node");
      node.setAttr("data-graph-node", name);
      if (this.drag?.target === name) {
        node.addClass("is-connect-target");
      }
      const circle = node.createSvg("circle");
      if (
        this.settingKeywordsLoaded
        && !this.settingRecordKeywords.has(name.trim().toLocaleLowerCase())
      ) {
        node.addClass("is-unrecorded");
      }
      const expanded = this.drag?.kind === "node" && this.drag.node === name;
      const nodeRadius = NODE_RADIUS + (expanded ? 4 : 0);
      circle.setAttr("cx", String(position.x));
      circle.setAttr("cy", String(position.y));
      circle.setAttr("r", String(nodeRadius));
      node.addEventListener("pointermove", (event) => {
        const point = this.graphPoint(event.clientX, event.clientY);
        if (!point) {
          return;
        }
        const distance = Math.hypot(
          point.x - position.x,
          point.y - position.y,
        );
        const onBorder = Math.abs(distance - NODE_RADIUS) <= 4.5;
        const inside = distance < NODE_RADIUS - 4.5;
        circle.classList.toggle("is-border-hover", onBorder);
        circle.classList.toggle("is-inside-hover", inside && !onBorder);
      });
      node.addEventListener("pointerleave", () => {
        circle.classList.remove("is-border-hover", "is-inside-hover");
        if (this.hoveredNode === name) {
          this.hoveredNode = null;
        }
      });
      node.addEventListener("pointerenter", () => {
        this.hoveredNode = name;
      });
      const text = node.createSvg("text");
      text.setAttr("x", String(position.x));
      text.setAttr("y", String(position.y + nodeRadius + 14));
      text.setAttr("text-anchor", "middle");
      text.textContent = name;
    }
  }
}
