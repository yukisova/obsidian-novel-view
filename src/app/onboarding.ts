import {
  Component,
  MarkdownRenderer,
  Modal,
  getLanguage,
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

/** 根据语言设置判断界面是否为中文 */
function isChineseLocale(): boolean {
  const stored = getLanguage() ?? "";
  const locale = (stored || navigator.language || "").toLocaleLowerCase();
  return locale.startsWith("zh");
}

/** 按提示类型选择中英文引导文案 */
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

  /** 保存引导内容并初始化弹窗基类 */
  constructor(
    app: App,
    private readonly content: OnboardingText,
  ) {
    super(app);
  }

  /** 构建弹窗内容并渲染引导文档 */
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

  /** 关闭时卸载组件并清空弹窗内容 */
  override onClose(): void {
    this.component.unload();
    this.contentEl.empty();
  }
}

/** 在本地记录已展示的版本与引导状态 */
function rememberVersion(version: string): void {
  try {
    window.localStorage.setItem(LAST_VERSION_KEY, version);
    window.localStorage.setItem(INTRODUCED_KEY, "1");
  } catch {
    // 本地存储不可用时仍允许本次展示。
  }
}

/** 根据版本变化决定是否展示引导弹窗 */
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
