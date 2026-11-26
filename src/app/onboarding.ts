import {
  Component,
  MarkdownRenderer,
  Modal,
  type App,
} from "obsidian";
import introduceCn from "../../docs/onboarding/INTRODUCE.cn.md";
import introduceEn from "../../docs/onboarding/INTRODUCE.en.md";
import updatedCn from "../../docs/onboarding/UPDATED.cn.md";
import updatedEn from "../../docs/onboarding/UPDATED.en.md";

const LAST_VERSION_KEY = "novelview:onboarding:last-version";
const INTRODUCED_KEY = "novelview:onboarding:introduced";

interface OnboardingText {
  title: string;
  close: string;
  markdown: string;
}

function isChineseLocale(): boolean {
  const stored = window.localStorage.getItem("language") ?? "";
  const locale = (stored || navigator.language || "").toLocaleLowerCase();
  return locale.startsWith("zh");
}

function onboardingText(kind: "introduce" | "updated"): OnboardingText {
  const chinese = isChineseLocale();
  if (kind === "introduce") {
    return chinese
      ? { title: "欢迎使用 Novel View", close: "开始使用", markdown: introduceCn }
      : { title: "Welcome to Novel View", close: "Get started", markdown: introduceEn };
  }
  return chinese
    ? { title: "Novel View 更新说明", close: "知道了", markdown: updatedCn }
    : { title: "Novel View update", close: "Close", markdown: updatedEn };
}

class OnboardingModal extends Modal {
  private readonly component = new Component();

  constructor(
    app: App,
    private readonly content: OnboardingText,
  ) {
    super(app);
  }

  override onOpen(): void {
    this.setTitle(this.content.title);
    this.modalEl.addClass("novelview-onboarding-modal");
    this.contentEl.empty();
    const body = this.contentEl.createDiv({
      cls: "novelview-onboarding-body",
    });
    body.setCssStyles({
      maxHeight: "62vh",
      overflowY: "auto",
      paddingRight: "6px",
    });
    this.component.load();
    void MarkdownRenderer.render(
      this.app,
      this.content.markdown,
      body,
      "",
      this.component,
    );
    const actions = this.contentEl.createDiv({
      cls: "modal-button-container",
    });
    actions.createEl("button", {
      cls: "mod-cta",
      text: this.content.close,
      attr: { type: "button" },
    }).addEventListener("click", () => this.close());
  }

  override onClose(): void {
    this.component.unload();
    this.contentEl.empty();
  }
}

function rememberVersion(version: string): void {
  try {
    window.localStorage.setItem(LAST_VERSION_KEY, version);
    window.localStorage.setItem(INTRODUCED_KEY, "1");
  } catch {
    // 本地存储不可用时仍允许本次展示。
  }
}

export function maybeShowOnboarding(app: App, version: string): void {
  let lastVersion = "";
  let introduced = false;
  try {
    lastVersion = window.localStorage.getItem(LAST_VERSION_KEY) ?? "";
    introduced = window.localStorage.getItem(INTRODUCED_KEY) === "1";
  } catch {
    // 忽略本地存储异常。
  }
  const kind = !lastVersion && !introduced
    ? "introduce"
    : lastVersion && lastVersion !== version
      ? "updated"
      : null;
  if (!kind) {
    return;
  }
  rememberVersion(version);
  new OnboardingModal(app, onboardingText(kind)).open();
}
