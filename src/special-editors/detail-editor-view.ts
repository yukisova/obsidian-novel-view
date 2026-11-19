import {
  MarkdownRenderer,
  type WorkspaceLeaf,
} from "obsidian";
import { SpecialEditorBaseView } from "./base-editor-view";
import type NovelViewPlugin from "../main";

export const DETAIL_EDITOR_VIEW_TYPE = "novelview-detail-editor";

export class DetailEditorView extends SpecialEditorBaseView {
  protected readonly kind = "detail" as const;
  protected readonly viewType = DETAIL_EDITOR_VIEW_TYPE;
  protected readonly viewIcon = "file-text";
  protected readonly panZoomEnabled = false;

  constructor(leaf: WorkspaceLeaf, plugin: NovelViewPlugin) {
    super(leaf, plugin);
  }

  protected helpText(): string {
    return "支持 Markdown 显示与数据编辑";
  }

  protected templateInsertion(): string {
    return "\n## 新章节\n\n内容\n";
  }

  protected recordInsertion(payload: {
    keyword: string;
    content?: string;
  }): string {
    return `\n## ${payload.keyword}\n\n${payload.content ?? ""}\n`;
  }

  protected renderPreview(content: string, host: HTMLElement): void {
    MarkdownRenderer.render(
      this.app,
      content,
      host,
      this.filePath,
      this,
    ).catch((error) => {
      console.debug("Novel View: detail preview failed", error);
      host.createDiv({
        cls: "novelview-special-editor-empty",
        text: "Markdown 显示失败。",
      });
    });
  }
}
