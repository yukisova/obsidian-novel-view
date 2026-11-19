import { Menu, Notice, type WorkspaceLeaf } from "obsidian";
import {
  appendBranchChild,
  deleteBranchNode,
  moveBranchNode,
  parseBranchSource,
} from "../core/setting-special-data";
import { SpecialEditorBaseView } from "./base-editor-view";
import type NovelViewPlugin from "../main";

export const BRANCH_EDITOR_VIEW_TYPE = "novelview-branch-editor";

export class BranchEditorView extends SpecialEditorBaseView {
  protected readonly kind = "branch" as const;
  protected readonly viewType = BRANCH_EDITOR_VIEW_TYPE;
  protected readonly viewIcon = "git-branch";

  private host: HTMLElement | null = null;
  private boundScene: HTMLElement | null = null;
  private collapsed = new Set<string>();
  private focusedNode: string | null = null;
  private markLabels = new Set<string>();
  private markLabelsLoaded = false;
  private renderToken = 0;
  private drag: {
    node: string;
    startX: number;
    startY: number;
    moved: boolean;
    target?: HTMLElement;
  } | null = null;

  constructor(leaf: WorkspaceLeaf, plugin: NovelViewPlugin) {
    super(leaf, plugin);
  }

  protected helpText(): string {
    return "数据格式：每行 - 文本；两个空格缩进表示子项。单击聚焦，双击跳转，右键删除。";
  }

  protected templateInsertion(): string {
    return "\n  - 新分支";
  }

  protected recordInsertion(payload: {
    keyword: string;
  }): string {
    return `\n  - ${payload.keyword}`;
  }

  protected async renderPreview(
    content: string,
    host: HTMLElement,
  ): Promise<void> {
    const token = ++this.renderToken;
    this.host = host;
    if (this.boundScene !== host) {
      this.boundScene = host;
      this.bindBranchInteraction(host);
    }
    if (!this.markLabelsLoaded) {
      const root = this.plugin.findNovelGroupRoot(this.filePath)
        ?? this.plugin.normalizeFolderPath(
          this.filePath.split("/").slice(0, -1).join("/"),
        );
      this.markLabels = await this.plugin.getTextMarkLabelsForNovel(root);
      this.markLabelsLoaded = true;
    }
    if (token === this.renderToken) {
      this.drawBranch();
    }
  }

  private drawBranch(): void {
    const host = this.host;
    if (!host) {
      return;
    }
    host.empty();
    const roots = parseBranchSource(
      this.editorView?.state.doc.toString() ?? "",
    );
    const canvas = host.createDiv({
      cls: "novelview-special-branch-canvas",
    });
    if (roots.length === 0) {
      canvas.createDiv({
        cls: "novelview-special-editor-empty",
        text: "切换到源码视图，添加缩进列表。",
      });
      return;
    }
    const tree = canvas.createDiv({ cls: "novelview-special-branch-mindmap" });
    const renderNodes = (
      parent: HTMLElement,
      nodes: import("../core/setting-special-data").BranchNode[],
      parentPath: string,
    ): void => {
      for (const [index, node] of nodes.entries()) {
        const path = `${parentPath}/${index}`;
        const collapsed = this.collapsed.has(path);
        const expandable = node.children.length > 0;
        const mindNode = parent.createDiv({
          cls: "novelview-special-branch-mind-node",
        });
        const row = mindNode.createDiv({
          cls: "novelview-special-branch-mind-row",
        });
        if (expandable) {
          const toggle = row.createEl("button", {
            cls: "novelview-special-branch-toggle",
            text: collapsed ? "▸" : "▾",
            attr: {
              type: "button",
              "aria-label": collapsed ? "展开" : "折叠",
            },
          });
          toggle.addEventListener("click", (event) => {
            event.stopPropagation();
            if (collapsed) {
              this.collapsed.delete(path);
            } else {
              this.collapsed.add(path);
            }
            this.drawBranch();
          });
        }
        const bound = this.markLabels.has(
          node.text.trim().toLocaleLowerCase(),
        );
        const label = row.createSpan({
          cls: `novelview-special-branch-node is-clickable ${
            bound ? "is-bound" : "is-unbound"
          }${this.focusedNode === node.text ? " is-focused" : ""}`,
          text: node.text,
        });
        label.setAttr("data-branch-node", node.text);
        if (node.children.length > 0 && !collapsed) {
          const children = mindNode.createDiv({
            cls: "novelview-special-branch-mind-children",
          });
          renderNodes(children, node.children, path);
        }
      }
    };
    renderNodes(tree, roots, "");
    this.renderBranchLinks(tree);
  }

  private renderBranchLinks(tree: HTMLElement): void {
    tree.querySelector(".novelview-special-branch-links")?.remove();
    const svg = tree.ownerDocument.createElementNS(
      "http://www.w3.org/2000/svg",
      "svg",
    );
    svg.addClass("novelview-special-branch-links");
    svg.setAttr("width", String(Math.max(tree.scrollWidth, tree.clientWidth)));
    svg.setAttr("height", String(Math.max(tree.scrollHeight, tree.clientHeight)));
    svg.setAttr("aria-hidden", "true");
    const treeRect = tree.getBoundingClientRect();
    const draw = (nodeEl: HTMLElement): void => {
      const row = nodeEl.querySelector<HTMLElement>(
        ":scope > .novelview-special-branch-mind-row",
      );
      if (!row) {
        return;
      }
      const parentRect = row.getBoundingClientRect();
      const children = nodeEl.querySelectorAll<HTMLElement>(
        ":scope > .novelview-special-branch-mind-children > .novelview-special-branch-mind-node",
      );
      for (const child of children) {
        const childRow = child.querySelector<HTMLElement>(
          ":scope > .novelview-special-branch-mind-row",
        );
        if (!childRow) {
          continue;
        }
        const childRect = childRow.getBoundingClientRect();
        const x1 = parentRect.right - treeRect.left;
        const y1 = parentRect.top - treeRect.top + parentRect.height / 2;
        const x2 = childRect.left - treeRect.left;
        const y2 = childRect.top - treeRect.top + childRect.height / 2;
        const bend = Math.max(18, (x2 - x1) * 0.55);
        const path = tree.ownerDocument.createElementNS(
          "http://www.w3.org/2000/svg",
          "path",
        );
        path.addClass("novelview-special-branch-link");
        path.setAttribute(
          "d",
          `M ${x1} ${y1} C ${x1 + bend} ${y1}, ${x2 - bend} ${y2}, ${x2} ${y2}`,
        );
        svg.appendChild(path);
        const dot = tree.ownerDocument.createElementNS(
          "http://www.w3.org/2000/svg",
          "circle",
        );
        dot.addClass("novelview-special-branch-link-dot");
        dot.setAttribute("cx", String(x2));
        dot.setAttribute("cy", String(y2));
        dot.setAttribute("r", "2.4");
        svg.appendChild(dot);
        draw(child);
      }
    };
    for (const root of tree.querySelectorAll<HTMLElement>(
      ":scope > .novelview-special-branch-mind-node",
    )) {
      draw(root);
    }
    tree.prepend(svg);
  }

  private bindBranchInteraction(scene: HTMLElement): void {
    scene.addEventListener("pointerdown", (event) => {
      if (event.button !== 0) {
        return;
      }
      const label = (event.target as Element | null)?.closest<HTMLElement>(
        "[data-branch-node]",
      );
      if (!label) {
        return;
      }
      event.preventDefault();
      this.drag = {
        node: label.dataset.branchNode ?? "",
        startX: event.clientX,
        startY: event.clientY,
        moved: false,
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
      if (
        !drag.moved
        && Math.hypot(event.clientX - drag.startX, event.clientY - drag.startY) > 4
      ) {
        drag.moved = true;
      }
      if (!drag.moved) {
        return;
      }
      event.preventDefault();
      const element = this.contentEl.ownerDocument.elementFromPoint(
        event.clientX,
        event.clientY,
      );
      const target = element?.closest<HTMLElement>("[data-branch-node]");
      if (drag.target !== target) {
        drag.target?.removeClass("is-drag-target");
        target?.addClass("is-drag-target");
        drag.target = target ?? undefined;
      }
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
      const targetText = drag.target?.dataset.branchNode;
      drag.target?.removeClass("is-drag-target");
      if (drag.moved && targetText && targetText !== drag.node) {
        if (this.editorView) {
          const current = this.editorView.state.doc.toString();
          const next = moveBranchNode(current, drag.node, targetText);
          if (next !== current) {
            this.editorView.dispatch({
              changes: { from: 0, to: current.length, insert: next },
            });
          }
        }
        return;
      }
      if (!drag.moved) {
        this.focusedNode = drag.node;
        this.updateFocus();
      }
    };
    scene.addEventListener("pointerup", finish);
    scene.addEventListener("pointercancel", finish);
    scene.addEventListener("dblclick", (event) => {
      const target = event.target as Element | null;
      const label = target?.closest<HTMLElement>("[data-branch-node]");
      if (label?.dataset.branchNode) {
        event.preventDefault();
        event.stopPropagation();
        this.jumpToNode(label.dataset.branchNode);
        return;
      }
      if (target?.closest(".novelview-special-branch-toggle")) {
        return;
      }
      if (!this.editorView) {
        return;
      }
      event.preventDefault();
      event.stopPropagation();
      const roots = parseBranchSource(
        this.editorView.state.doc.toString(),
      );
      const used = new Set<string>();
      const collect = (
        nodes: import("../core/setting-special-data").BranchNode[],
      ): void => {
        for (const node of nodes) {
          used.add(node.text);
          collect(node.children);
        }
      };
      collect(roots);
      let name = "新分支";
      let index = 2;
      while (used.has(name)) {
        name = `新分支 ${index}`;
        index += 1;
      }
      const current = this.editorView.state.doc.toString();
      const next = appendBranchChild(
        current,
        this.focusedNode,
        name,
      );
      if (next === current) {
        return;
      }
      this.editorView.dispatch({
        changes: { from: 0, to: current.length, insert: next },
      });
      this.collapsed.clear();
      this.focusedNode = name;
      window.setTimeout(() => this.drawBranch(), 0);
    });
    scene.addEventListener("contextmenu", (event) => {
      const target = event.target as Element | null;
      const label = target?.closest<HTMLElement>("[data-branch-node]");
      const name = label?.dataset.branchNode;
      if (!name) {
        return;
      }
      event.preventDefault();
      event.stopPropagation();
      const menu = new Menu();
      menu.addItem((item) => {
        item.setTitle("删除分支及其子项").setIcon("trash").onClick(() => {
          if (!this.editorView) {
            return;
          }
          const current = this.editorView.state.doc.toString();
          const parent = this.findParent(current, name);
          const next = deleteBranchNode(current, name);
          if (next !== current) {
            this.editorView.dispatch({
              changes: { from: 0, to: current.length, insert: next },
            });
            this.focusedNode = parent;
            window.setTimeout(() => this.drawBranch(), 0);
          }
        });
      });
      menu.showAtMouseEvent(event);
    });
  }

  private updateFocus(): void {
    for (const element of this.contentEl.querySelectorAll<HTMLElement>(
      "[data-branch-node]",
    )) {
      element.toggleClass(
        "is-focused",
        element.dataset.branchNode === this.focusedNode,
      );
    }
  }

  private async jumpToNode(name: string): Promise<void> {
    const root = this.plugin.findNovelGroupRoot(this.filePath)
      ?? this.plugin.normalizeFolderPath(
        this.filePath.split("/").slice(0, -1).join("/"),
      );
    const occurrence = await this.plugin.getFirstTextMarkOccurrence(root, name);
    if (!occurrence) {
      new Notice("Novel View：该分支项没有对应的文字标记。");
      return;
    }
    await this.plugin.openTextMarkRange(
      occurrence.file,
      occurrence.start,
      occurrence.end,
    );
  }

  private findParent(source: string, name: string): string | null {
    const walk = (
      nodes: import("../core/setting-special-data").BranchNode[],
      parent: string | null,
    ): string | null => {
      for (const node of nodes) {
        if (node.text === name) {
          return parent;
        }
        const found = walk(node.children, node.text);
        if (found !== null) {
          return found;
        }
      }
      return null;
    };
    return walk(parseBranchSource(source), null);
  }
}

