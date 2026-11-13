import { Notice, TFile, type MarkdownView } from "obsidian";
import {
  compileSearchExpression,
  findSearchMatches,
  replaceSearchMatches,
} from "./core/search";
import type NovelViewPlugin from "./main";

export type SearchScope = "chapter" | "volume" | "book" | "marks" | "pending" | "keywords";

export interface FinderResult {
  title: string;
  detail: string;
  kind: "file" | "setting";
  path?: string;
  line?: number;
  group?: string;
  tag?: string;
  keyword?: string;
}

const SCOPE_LABELS: Record<SearchScope, string> = {
  chapter: "本章",
  volume: "本卷",
  book: "全书",
  marks: "文字标记",
  pending: "待修改部分",
  keywords: "关键词",
};

export class SearchPanelV2 {
  private readonly plugin: NovelViewPlugin;
  private root: HTMLElement | null = null;
  private resultsEl: HTMLElement | null = null;
  private titleEl: HTMLElement | null = null;
  private groupLabel: HTMLElement | null = null;
  private queryInput: HTMLInputElement | null = null;
  private replaceInput: HTMLInputElement | null = null;
  private scopeSelect: HTMLSelectElement | null = null;
  private caseInput: HTMLInputElement | null = null;
  private wordInput: HTMLInputElement | null = null;
  private regexInput: HTMLInputElement | null = null;
  private activeScope: SearchScope = "chapter";
  private ownerView: MarkdownView | null = null;
  private debounceTimer: number | null = null;


  constructor(plugin: NovelViewPlugin) {
    this.plugin = plugin;
  }

  open(view?: MarkdownView): void {
    if (this.root) {
      this.ownerView = view ?? this.ownerView;
      this.root.addClass("is-open");
      this.queryInput?.focus();
      void this.search();
      return;
    }
    this.ownerView = view ?? null;
    this.root = createDiv({ cls: "novelview-search-v2" });
    this.root.addClass("is-open");
    this.root.setAttr("role", "dialog");
    this.root.setAttr("aria-label", "NovelFinder");
    const header = this.root.createDiv({ cls: "novelview-search-v2-header" });
    header.createSpan({ text: "NovelFinder" });
    this.groupLabel = this.root.createDiv({ cls: "novelview-search-v2-group" });
    header.addEventListener("pointerdown", (event) => {
      if (event.button !== 0 || (event.target as HTMLElement | null)?.closest("button")) {
        return;
      }
      const root = this.root;
      if (!root) {
        return;
      }
      if (!root.hasClass("is-positioned")) {
        const initial = root.getBoundingClientRect();
        root.setCssProps({
          left: `${Math.round(initial.left)}px`,
          top: `${Math.round(initial.top)}px`,
        });
        root.addClass("is-positioned");
      }
      const rect = root.getBoundingClientRect();
      const offsetX = event.clientX - rect.left;
      const offsetY = event.clientY - rect.top;
      let frame = 0;
      let nextLeft = rect.left;
      let nextTop = rect.top;
      const move = (moveEvent: PointerEvent): void => {
        nextLeft = Math.round(moveEvent.clientX - offsetX);
        nextTop = Math.round(moveEvent.clientY - offsetY);
        if (frame !== 0) {
          return;
        }
        frame = window.requestAnimationFrame(() => {
          frame = 0;
          root.setCssProps({
            left: `${nextLeft}px`,
            top: `${nextTop}px`,
          });
        });
      };
      const up = (): void => {
        if (frame !== 0) {
          window.cancelAnimationFrame(frame);
          frame = 0;
        }
        window.removeEventListener("pointermove", move);
        window.removeEventListener("pointerup", up);
        window.removeEventListener("pointercancel", up);
      };
      window.addEventListener("pointermove", move);
      window.addEventListener("pointerup", up);
      window.addEventListener("pointercancel", up);
      event.preventDefault();
    });
    const close = header.createEl("button", { text: "×", attr: { type: "button" } });
    close.addEventListener("click", () => this.close());

    const top = this.root.createDiv({ cls: "novelview-search-v2-controls" });
    this.scopeSelect = top.createEl("select", { attr: { "aria-label": "查找范围" } });
    for (const scope of Object.keys(SCOPE_LABELS) as SearchScope[]) {
      this.scopeSelect.createEl("option", { text: SCOPE_LABELS[scope], attr: { value: scope } });
    }
    this.scopeSelect.addEventListener("change", () => {
      this.activeScope = this.scopeSelect?.value as SearchScope ?? "chapter";
      void this.search();
    });
    this.queryInput = top.createEl("input", {
      attr: { type: "text", placeholder: "查找内容", "aria-label": "查找内容" },
    });
    const replaceRow = this.root.createDiv({
      cls: "novelview-search-v2-replace-row",
    });
    this.replaceInput = replaceRow.createEl("input", {
      attr: { type: "text", placeholder: "替换为（可留空）", "aria-label": "替换为" },
    });
    const options = this.root.createDiv({ cls: "novelview-search-v2-options" });
    this.caseInput = this.option(options, "区分大小写");
    this.wordInput = this.option(options, "全词");
    this.regexInput = this.option(options, "正则");
    const actions = this.root.createDiv({ cls: "novelview-search-v2-actions" });
    this.queryInput.addEventListener("input", () => {
      if (this.debounceTimer !== null) {
        window.clearTimeout(this.debounceTimer);
      }
      this.debounceTimer = window.setTimeout(() => void this.search(), 220);
    });
    this.replaceInput.addEventListener("input", () => {
      if (this.debounceTimer !== null) {
        window.clearTimeout(this.debounceTimer);
      }
      this.debounceTimer = window.setTimeout(() => void this.search(), 220);
    });
    actions.createEl("button", { text: "全部替换", attr: { type: "button" } })
      .addEventListener("click", () => void this.replaceAll());

    this.titleEl = this.root.createDiv({ cls: "novelview-search-v2-title" });
    this.resultsEl = this.root.createDiv({ cls: "novelview-search-v2-results" });
    this.root.addEventListener("keydown", (event) => {
      if (event.key === "Escape") {
        this.close();
      }
    });
    activeDocument.body.appendChild(this.root);
    window.setTimeout(() => this.queryInput?.focus(), 0);
  }

  close(): void {
    this.root?.remove();
    this.root = null;
    this.resultsEl = null;
    this.ownerView = null;
  }

  private option(parent: HTMLElement, label: string): HTMLInputElement {
    const wrapper = parent.createEl("label");
    const input = wrapper.createEl("input", { attr: { type: "checkbox" } });
    wrapper.createSpan({ text: label });
    return input;
  }

  private searchFiles(): TFile[] {
    const current = this.plugin.getLastActiveMarkdownFile();
    if (!current) {
      return [];
    }
    const group = this.plugin.findNovelGroupRoot(
      this.plugin.normalizeFolderPath(current.parent?.path ?? "/"),
    );
    if (!group) {
      return this.activeScope === "chapter" ? [current] : [];
    }
    if (this.activeScope === "chapter") {
      return [current];
    }
    if (this.activeScope === "volume") {
      const parent = this.plugin.normalizeFolderPath(current.parent?.path ?? "/");
      const folder = parent === group ? group : parent;
      return this.plugin.app.vault.getMarkdownFiles().filter((file: TFile) => (
        this.plugin.normalizeFolderPath(file.parent?.path ?? "/") === folder
        && !this.plugin.isSpecialNovelFile(file)
      ));
    }
    return this.plugin.app.vault.getMarkdownFiles().filter((file: TFile) => (
      file.path.startsWith(`${group}/`)
      && !this.plugin.isSpecialNovelFile(file)
    ));
  }

  private options() {
    return {
      query: this.queryInput?.value ?? "",
      replacement: this.replaceInput?.value ?? "",
      caseSensitive: !!this.caseInput?.checked,
      wholeWord: !!this.wordInput?.checked,
      regex: !!this.regexInput?.checked,
    };
  }

  private async search(): Promise<void> {
    if (!this.resultsEl || !this.titleEl) {
      return;
    }
    this.resultsEl.empty();
    const options = this.options();
    if (
      this.activeScope === "marks"
      || this.activeScope === "pending"
      || this.activeScope === "keywords"
    ) {
      const results = await this.collectSpecialResults(
        this.activeScope,
        options.query,
      );
      this.titleEl.setText(`NovelFinder · ${SCOPE_LABELS[this.activeScope]}`);
      this.resultsEl.createDiv({
        cls: "novelview-search-v2-empty",
        text: `已在右侧 NovelFinder 结果中显示 ${results.length} 条结果。`,
      });
      await this.plugin.showNovelFinderResults(
        SCOPE_LABELS[this.activeScope],
        results,
      );
      return;
    }
    const compiled = compileSearchExpression(options);
    if (!compiled.regex) {
      this.titleEl.setText("查找结果 · 请输入查找内容");
      return;
    }
    const files = this.searchFiles();
    const current = this.plugin.getLastActiveMarkdownFile();
    const group = current
      ? this.plugin.findNovelGroupRoot(
        this.plugin.normalizeFolderPath(current.parent?.path ?? "/"),
      )
      : null;
    const groupName = group
      ? this.plugin.getNovelGroupInfo(group)?.name ?? group
      : "未归属小说组";
    if (this.groupLabel) {
      this.groupLabel.setText(`小说组：${groupName}`);
    }
    let total = 0;
    this.titleEl.setText(
      `查找结果 · ${SCOPE_LABELS[this.activeScope]} · ${groupName}`,
    );
    const grouped: Array<{ file: TFile; matches: ReturnType<typeof findSearchMatches>["matches"] }> = [];
    for (const file of files) {
      let text = "";
      try {
        text = await this.plugin.app.vault.cachedRead(file);
      } catch {
        continue;
      }
      const { matches } = findSearchMatches(text, compiled.regex, 50);
      if (matches.length > 0) {
        grouped.push({ file, matches });
        total += matches.length;
      }
    }
    const results: FinderResult[] = [];
    for (const group of grouped) {
      for (const match of group.matches) {
        results.push({
          kind: "file",
          title: `${group.file.basename} · 第 ${match.line} 行`,
          detail: `${match.before}${match.matchText}${match.after}`.trim(),
          path: group.file.path,
          line: match.line,
        });
      }
    }
    this.resultsEl.createDiv({
      cls: "novelview-search-v2-empty",
      text: results.length > 0
        ? `已在右侧 NovelFinder 结果中显示 ${results.length} 条结果。`
        : "没有匹配结果。",
    });
    await this.plugin.showNovelFinderResults(
      `${SCOPE_LABELS[this.activeScope]} · ${groupName}`,
      results,
    );
    void total;
  }

  private async collectSpecialResults(
    scope: "marks" | "pending" | "keywords",
    query: string,
  ): Promise<FinderResult[]> {
    const needle = query.trim().toLocaleLowerCase();
    const current = this.plugin.getLastActiveMarkdownFile();
    const root = current
      ? this.plugin.findNovelGroupRoot(
        this.plugin.normalizeFolderPath(current.parent?.path ?? "/"),
      )
      : null;
    if (scope === "keywords") {
      return this.plugin.getSettingKeywordsForFinder()
        .filter((entry) => (
          !needle
          || entry.keyword.toLocaleLowerCase().includes(needle)
          || entry.content.toLocaleLowerCase().includes(needle)
        ))
        .slice(0, 200)
        .map((entry) => ({
          kind: "setting" as const,
          title: entry.keyword,
          detail: entry.content || `${entry.group} / ${entry.tag}`,
          group: entry.group,
          tag: entry.tag,
          keyword: entry.keyword,
        }));
    }
    if (!root) {
      return [];
    }
    const files = this.plugin.app.vault.getMarkdownFiles().filter((file) => (
      file.path.startsWith(`${root}/`)
      && !this.plugin.isSpecialNovelFile(file)
    ));
    const results: FinderResult[] = [];
    for (const file of files) {
      let text = "";
      try {
        text = await this.plugin.app.vault.cachedRead(file);
      } catch {
        continue;
      }
      if (scope === "pending") {
        const pattern = /```待修改部分[^\n]*\n([\s\S]*?)```/gu;
        let match: RegExpExecArray | null;
        while ((match = pattern.exec(text)) !== null) {
          const body = match[1].trim();
          if (needle && !body.toLocaleLowerCase().includes(needle)
            && !match[0].toLocaleLowerCase().includes(needle)) {
            continue;
          }
          const line = text.slice(0, match.index).split("\n").length;
          results.push({
            kind: "file",
            title: `${file.basename} · 待修改部分`,
            detail: body.slice(0, 120),
            path: file.path,
            line,
          });
        }
        continue;
      }
      const frontmatter = this.plugin.app.metadataCache.getFileCache(file)?.frontmatter;
      const raw = frontmatter?.["novelview-marks"];
      let marks: Array<{ start: number; end: number; label: string }> = [];
      if (typeof raw === "string") {
        try {
          const parsed: unknown = JSON.parse(raw);
          if (Array.isArray(parsed)) {
            marks = parsed.filter((item): item is { start: number; end: number; label: string } => (
              Boolean(item)
              && typeof item === "object"
              && typeof (item as { label?: unknown }).label === "string"
              && Number.isFinite((item as { start?: unknown }).start)
              && Number.isFinite((item as { end?: unknown }).end)
            ));
          }
        } catch {
          marks = [];
        }
      }
      const body = text.replace(/^---[\s\S]*?---\n?/u, "");
      for (const mark of marks) {
        const excerpt = body.slice(mark.start, mark.end);
        if (needle && !mark.label.toLocaleLowerCase().includes(needle)
          && !excerpt.toLocaleLowerCase().includes(needle)) {
          continue;
        }
        results.push({
          kind: "file",
          title: `${file.basename} · ${mark.label}`,
          detail: excerpt,
          path: file.path,
          line: body.slice(0, mark.start).split("\n").length,
        });
      }
    }
    return results.slice(0, 200);
  }

  private async replaceAll(): Promise<void> {
    if (
      this.activeScope === "marks"
      || this.activeScope === "pending"
      || this.activeScope === "keywords"
    ) {
      new Notice("NovelFinder：当前查找范围不支持替换。");
      return;
    }
    const options = this.options();
    const compiled = compileSearchExpression(options);
    if (!compiled.regex) {
      return;
    }
    const files = this.searchFiles();
    let count = 0;
    for (const file of files) {
      try {
        await this.plugin.app.vault.process(file, (text) => {
          const replaced = replaceSearchMatches(
            text,
            compiled.regex as RegExp,
            options.replacement,
            options.regex,
          );
          count += replaced.count;
          return replaced.text;
        });
      } catch {
        // Skip unreadable/binary files.
      }
    }
    new Notice(`Novel View：已替换 ${count} 处。`);
    await this.search();
  }
}
