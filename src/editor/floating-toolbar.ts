import { setIcon } from "obsidian";

export type NovelToolbarScope = "full" | "basic";

export interface NovelFloatingToolbarActions {
  formatDocument: () => void;
  addImage: () => void;
  addImageFromLibrary: () => void;
}

interface ToolbarButton {
  icon: string;
  label: string;
  action: keyof NovelFloatingToolbarActions;
}

const BUTTONS: ToolbarButton[] = [
  { icon: "wand-2", label: "自动排版", action: "formatDocument" },
  { icon: "image-plus", label: "插入图片", action: "addImage" },
];

/**
 * Vertical, floating toolbar inside a novel-mode Markdown leaf. The image
 * button expands two small source choices without opening a modal.
 */
export class NovelFloatingToolbar {
  readonly scope: NovelToolbarScope;
  private readonly root: HTMLElement;
  private readonly container: HTMLElement;
  private readonly submenu: HTMLElement;
  private readonly imageButton: HTMLButtonElement;
  private readonly onDocumentPointerDown: (event: PointerEvent) => void;

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

    let imageButton: HTMLButtonElement | null = null;
    for (const buttonInfo of BUTTONS) {
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
      if (buttonInfo.action === "addImage") {
        imageButton = button;
      }
      button.addEventListener("click", (event) => {
        event.preventDefault();
        event.stopPropagation();
        if (buttonInfo.action === "addImage") {
          this.toggleImageMenu(button);
          return;
        }
        this.hideSubmenu();
        actions[buttonInfo.action]();
      });
    }
    if (!imageButton) {
      throw new Error("image toolbar button missing");
    }
    this.imageButton = imageButton;

    this.submenu = this.root.createDiv({
      cls: "novelview-toolbar-submenu",
    });
    this.submenu.setAttr("role", "menu");
    this.submenu.setAttr("aria-label", "选择图片来源");
    this.createSubmenuButton("file-input", "从文件", () => {
      this.hideSubmenu();
      actions.addImage();
    });
    this.createSubmenuButton("images", "从素材库", () => {
      this.hideSubmenu();
      actions.addImageFromLibrary();
    });

    this.onDocumentPointerDown = (event) => {
      if (!this.root.contains(event.target as Node)) {
        this.hideSubmenu();
      }
    };
    document.addEventListener("pointerdown", this.onDocumentPointerDown, true);
    container.addClass("novelview-toolbar-host");
  }

  destroy(): void {
    document.removeEventListener(
      "pointerdown",
      this.onDocumentPointerDown,
      true,
    );
    this.root.remove();
    if (!this.container.querySelector(".novelview-floating-toolbar")) {
      this.container.removeClass("novelview-toolbar-host");
    }
  }

  private createSubmenuButton(
    icon: string,
    label: string,
    onClick: () => void,
  ): void {
    const button = this.submenu.createEl("button", {
      cls: "novelview-toolbar-submenu-button",
      attr: {
        type: "button",
        role: "menuitem",
        "aria-label": label,
        title: label,
      },
    });
    setIcon(button, icon);
    button.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      onClick();
    });
  }

  private toggleImageMenu(button: HTMLButtonElement): void {
    if (this.submenu.hasClass("is-open")) {
      this.hideSubmenu();
      return;
    }
    this.submenu.style.top = `${button.offsetTop}px`;
    this.submenu.addClass("is-open");
    button.addClass("is-active");
  }

  private hideSubmenu(): void {
    this.submenu.removeClass("is-open");
    this.imageButton.removeClass("is-active");
  }
}
