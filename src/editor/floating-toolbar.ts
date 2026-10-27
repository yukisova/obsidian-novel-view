import { setIcon } from "obsidian";

export type NovelToolbarScope = "full" | "basic";

export interface NovelFloatingToolbarActions {
  formatDocument: () => void;
  addImage: () => void;
  showInspiration: () => void;
}

interface ToolbarButton {
  icon: string;
  label: string;
  action: keyof NovelFloatingToolbarActions;
}

const BUTTONS: ToolbarButton[] = [
  { icon: "wand-2", label: "自动排版", action: "formatDocument" },
  { icon: "image-plus", label: "加入图片", action: "addImage" },
  { icon: "lightbulb", label: "有了灵感", action: "showInspiration" },
];

/**
 * Vertical, floating toolbar inside a novel-mode Markdown leaf. It is not a
 * modal: the editor remains usable while the toolbar is visible.
 */
export class NovelFloatingToolbar {
  readonly scope: NovelToolbarScope;
  private readonly root: HTMLElement;
  private readonly container: HTMLElement;

  constructor(
    container: HTMLElement,
    actions: NovelFloatingToolbarActions,
    scope: NovelToolbarScope = "full",
  ) {
    this.container = container;
    this.scope = scope;
    this.root = container.createDiv({
      cls: "novelview-floating-toolbar",
    });
    this.root.setAttr("role", "toolbar");
    this.root.setAttr("aria-orientation", "vertical");
    this.root.setAttr("aria-label", "小说模式工具栏");

    const buttons = scope === "basic"
      ? BUTTONS
      : BUTTONS;

    for (const buttonInfo of buttons) {
      const button = this.root.createEl("button", {
        cls: "novelview-floating-toolbar-button",
        attr: {
          type: "button",
          "aria-label": buttonInfo.label,
          title: buttonInfo.label,
        },
      });
      const icon = button.createSpan({
        cls: "novelview-floating-toolbar-icon",
      });
      icon.setAttr("aria-hidden", "true");
      setIcon(icon, buttonInfo.icon);
      button.createSpan({
        cls: "novelview-floating-toolbar-label",
        text: buttonInfo.label,
      });
      button.addEventListener("click", (event) => {
        event.preventDefault();
        event.stopPropagation();
        actions[buttonInfo.action]();
      });
    }

    container.addClass("novelview-toolbar-host");
  }

  destroy(): void {
    this.root.remove();
    if (!this.container.querySelector(".novelview-floating-toolbar")) {
      this.container.removeClass("novelview-toolbar-host");
    }
  }
}
