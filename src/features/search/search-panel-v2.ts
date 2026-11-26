import { Notice, TFile, type MarkdownView } from "obsidian";
import { splitFrontmatterContent } from "../../core/text/paragraphs";
import { confirmAction } from "../../ui/confirm-modal";
import {
  compileSearchExpression,
  findSearchMatches,
  replaceSearchMatches,
} from "../../core/search/search";
import type NovelViewPlugin from "../../main";

export type SearchScope = "chapter" | "volume" | "book" | "marks" | "pending" | "keywords";

export interface FinderContext {
  groupName: string;
  scope: SearchScope;
  scopeLabel: string;
  query: string;
  caseSensitive: boolean;
  wholeWord: boolean;
  regex: boolean;
  total: number;
}

export interface FinderResult {
  title: string;
  detail: string;
  kind: "file" | "setting";
  path?: string;
  line?: number;
  group?: string;
  tag?: string;
  keyword?: string;
  before?: string;
  matchText?: string;
  after?: string;
  offset?: number;
  length?: number;
}

const SCOPE_LABELS: Record<SearchScope, string> = {
  chapter: "全章",
  volume: "本卷",
  book: "全书",
  marks: "文字标记",
  pending: "对照组",
  keywords: "关键词",
};

export class SearchPanelV2 {
  private readonly plugin: NovelViewPlugin;
  private root: HTMLElement | null = null;
  private groupLabel: HTMLElement | null = null;
  private chapterLabel: HTMLElement | null = null;
  private volumeSelect: HTMLSelectElement | null = null;
  private volumePath = "";
  private keywordGroupSelect: HTMLSelectElement | null = null;
  private keywordRecordSelect: HTMLSelectElement | null = null;
  private keywordGroup = "";
  private keywordRecord = "";
  private replacerSingleButton: HTMLButtonElement | null = null;
  private lastSyncedScope: SearchScope | null = null;
  private replacerToggle: HTMLButtonElement | null = null;
  private replacerRoot: HTMLElement | null = null;
  private replacerInput: HTMLTextAreaElement | null = null;
  private queryInput: HTMLInputElement | null = null;
  private scopeSelect: HTMLSelectElement | null = null;
  private caseInput: HTMLInputElement | null = null;
  private wordInput: HTMLInputElement | null = null;
  private regexInput: HTMLInputElement | null = null;
  private activeScope: SearchScope = "chapter";
  private ownerView: MarkdownView | null = null;
  private debounceTimer: number | null = null;
  private lastResults: FinderResult[] = [];
  private activeResultIndex = -1;
  private searchCompleted = false;
  private searchToken = 0;
  private navigator: HTMLElement | null = null;
  private navigatorCounter: HTMLElement | null = null;


  constructor(plugin: NovelViewPlugin) {
    this.plugin = plugin;
  }

  open(view?: MarkdownView): void {
    if (!this.plugin.getActiveNovelEditorFile()) {
      this.close();
      new Notice("Novel View：请先打开 NovelEditor 后再使用 NovelFinder。");
      return;
    }
    if (this.root) {
      this.ownerView = view ?? this.ownerView;
      this.root.addClass("is-open");
      this.refreshContextHeader();
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
    const heading = header.createDiv({
      cls: "novelview-search-v2-heading",
    });
    heading.createDiv({
      cls: "novelview-search-v2-name",
      text: "NovelFinder",
    });
    this.groupLabel = heading.createDiv({
      cls: "novelview-search-v2-group",
      text: "未打开 NovelEditor",
    });
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
    this.scopeSelect.value = this.activeScope;
    this.scopeSelect.addEventListener("change", () => {
      this.activeScope = this.scopeSelect?.value as SearchScope ?? "chapter";
      this.syncScopeUi();
      void this.search();
    });
    const contextSlot = top.createDiv({
      cls: "novelview-search-v2-context",
    });
    this.chapterLabel = contextSlot.createDiv({
      cls: "novelview-search-v2-chapter novelview-search-v2-context-control",
      text: "未打开章节",
    });
    this.volumeSelect = contextSlot.createEl("select", {
      cls: "novelview-search-v2-volume novelview-search-v2-context-control",
      attr: { "aria-label": "选择卷" },
    });
    this.volumeSelect.addEventListener("change", () => {
      this.volumePath = this.volumeSelect?.value ?? "";
      void this.search();
    });
    this.keywordGroupSelect = contextSlot.createEl("select", {
      cls: "novelview-search-v2-keyword-group",
      attr: { "aria-label": "选择设定组" },
    });
    this.keywordRecordSelect = contextSlot.createEl("select", {
      cls: "novelview-search-v2-keyword-record",
      attr: { "aria-label": "选择设定记录" },
    });
    this.keywordGroupSelect.addEventListener("change", () => {
      this.keywordGroup = this.keywordGroupSelect?.value ?? "";
      this.keywordRecord = "";
      this.populateKeywordRecords();
      void this.search();
    });
    this.keywordRecordSelect.addEventListener("change", () => {
      this.keywordRecord = this.keywordRecordSelect?.value ?? "";
      void this.search();
    });
    this.queryInput = this.root.createEl("input", {
      cls: "novelview-search-v2-query",
      attr: { type: "text", placeholder: "查找内容", "aria-label": "查找内容" },
    });
    const options = this.root.createDiv({ cls: "novelview-search-v2-options" });
    this.caseInput = this.option(options, "区分大小写");
    this.wordInput = this.option(options, "全词");
    this.regexInput = this.option(options, "允许正则表达式");
    this.queryInput.addEventListener("input", () => {
      if (this.debounceTimer !== null) {
        window.clearTimeout(this.debounceTimer);
      }
      this.searchCompleted = false;
      this.lastResults = [];
      this.activeResultIndex = -1;
      this.plugin.clearNovelFinderHighlights();
      this.updateNavigator();
      this.debounceTimer = window.setTimeout(() => void this.search(), 220);
    });
    this.navigator = this.root.createDiv({
      cls: "novelview-search-v2-navigator",
    });
    const previous = this.navigator.createEl("button", {
      text: "←",
      attr: {
        type: "button",
        "aria-label": "上一个查找结果",
        title: "上一个结果",
      },
    });
    previous.addEventListener("click", () => {
      void this.stepResult(-1);
    });
    this.navigatorCounter = this.navigator.createSpan({
      cls: "novelview-search-v2-navigator-count",
      text: "1/1",
    });
    const next = this.navigator.createEl("button", {
      text: "→",
      attr: {
        type: "button",
        "aria-label": "下一个查找结果",
        title: "下一个结果",
      },
    });
    next.addEventListener("click", () => {
      void this.stepResult(1);
    });
    this.replacerToggle = this.root.createEl("button", {
      cls: "novelview-search-v2-replacer-toggle",
      text: "›",
      attr: {
        type: "button",
        "aria-label": "展开替换界面",
        title: "点击展开替换界面",
      },
    });
    this.replacerToggle.addEventListener("click", () => {
      this.toggleReplacer();
    });

    this.root.addEventListener("keydown", (event) => {
      if (event.key === "Escape") {
        this.close();
      }
    });
    activeDocument.body.appendChild(this.root);
    this.refreshContextHeader();
    this.syncScopeUi();
    window.setTimeout(() => this.queryInput?.focus(), 0);
  }

  refreshForActiveEditor(): void {
    if (!this.root) {
      return;
    }
    this.refreshContextHeader();
    void this.search();
  }

  isOpen(): boolean {
    return this.root !== null;
  }

  getCardRect(): DOMRect | null {
    return this.root?.getBoundingClientRect() ?? null;
  }

  close(): void {
    this.plugin.clearNovelFinderHighlights();
    this.lastResults = [];
    this.activeResultIndex = -1;
    this.searchCompleted = false;
    this.closeReplacer();
    this.root?.remove();
    this.root = null;
    this.replacerToggle = null;
    this.chapterLabel = null;
    this.volumeSelect = null;
    this.keywordGroupSelect = null;
    this.keywordRecordSelect = null;
    this.navigator = null;
    this.navigatorCounter = null;
    this.ownerView = null;
  }

  private replacerLabel(): string {
    switch (this.activeScope) {
      case "marks":
        return "新的标记名称";
      case "pending":
        return "新的对照组名称";
      case "keywords":
        return "新的关键词";
      default:
        return "替换为";
    }
  }

  private toggleReplacer(): void {
    if (this.replacerRoot) {
      this.closeReplacer();
      return;
    }
    if (!this.root) {
      return;
    }
    this.replacerRoot = createDiv({ cls: "novelview-replacer" });
    this.replacerRoot.createDiv({
      cls: "novelview-replacer-label",
      text: this.replacerLabel(),
    });
    this.replacerInput = this.replacerRoot.createEl("textarea", {
      cls: "novelview-replacer-input",
      attr: {
        rows: "3",
        placeholder: "",
        "aria-label": "替换为",
      },
    });
    const actions = this.replacerRoot.createDiv({
      cls: "novelview-replacer-actions",
    });
    const special = this.activeScope === "marks"
      || this.activeScope === "pending"
      || this.activeScope === "keywords";
    if (!special) {
      this.replacerSingleButton = actions.createEl("button", {
        text: "替换",
        attr: { type: "button" },
      });
      this.replacerSingleButton.addEventListener("click", () => {
        void this.replaceOne();
      });
    } else {
      this.replacerSingleButton = null;
    }
    actions.createEl("button", {
      cls: "mod-cta",
      text: "全部替换",
      attr: { type: "button" },
    }).addEventListener("click", () => {
      void this.replaceAll();
    });
    this.root.appendChild(this.replacerRoot);
    this.root.addClass("has-replacer");
    this.replacerRoot.addClass("is-open");
    this.replacerToggle?.setText("‹");
    this.replacerToggle?.setAttr("aria-label", "折叠替换界面");
    this.replacerToggle?.setAttr("title", "点击折叠替换界面");
    window.setTimeout(() => this.replacerInput?.focus(), 0);
  }

  private closeReplacer(): void {
    this.replacerRoot?.remove();
    this.replacerRoot = null;
    this.replacerInput = null;
    this.replacerSingleButton = null;
    this.root?.removeClass("has-replacer");
    this.replacerToggle?.setText("›");
    this.replacerToggle?.setAttr("aria-label", "展开替换界面");
    this.replacerToggle?.setAttr("title", "点击展开替换界面");
  }

  private option(parent: HTMLElement, label: string): HTMLInputElement {
    const wrapper = parent.createEl("label");
    const input = wrapper.createEl("input", { attr: { type: "checkbox" } });
    wrapper.createSpan({ text: label });
    return input;
  }

  private refreshContextHeader(): void {
    const file = this.plugin.getActiveNovelEditorFile();
    const groupName = this.currentGroupName();
    this.groupLabel?.setText(groupName);
    this.chapterLabel?.setText(file?.basename ?? "未打开章节");
    if (this.activeScope === "volume") {
      this.populateVolumes();
    } else if (this.activeScope === "keywords") {
      this.populateKeywordGroups();
    }
    this.syncScopeUi();
  }

  private populateKeywordGroups(): void {
    if (!this.keywordGroupSelect) {
      return;
    }
    const entries = this.plugin.getSettingKeywordsForFinder();
    const groups = [...new Set(entries.map((entry) => entry.group).filter(Boolean))];
    this.keywordGroupSelect.empty();
    this.keywordGroupSelect.createEl("option", {
      text: "全部设定组",
      attr: { value: "" },
    });
    for (const group of groups) {
      this.keywordGroupSelect.createEl("option", {
        text: group,
        attr: { value: group },
      });
    }
    if (!groups.includes(this.keywordGroup)) {
      this.keywordGroup = "";
      this.keywordRecord = "";
    }
    this.keywordGroupSelect.value = this.keywordGroup;
    this.populateKeywordRecords();
  }

  private populateKeywordRecords(): void {
    if (!this.keywordRecordSelect) {
      return;
    }
    const entries = this.plugin.getSettingKeywordsForFinder().filter(
      (entry) => !this.keywordGroup || entry.group === this.keywordGroup,
    );
    const records = [...new Set(
      entries.map((entry) => entry.keyword).filter(Boolean),
    )];
    this.keywordRecordSelect.empty();
    this.keywordRecordSelect.createEl("option", {
      text: "全部设定记录",
      attr: { value: "" },
    });
    for (const record of records) {
      this.keywordRecordSelect.createEl("option", {
        text: record,
        attr: { value: record },
      });
    }
    if (!records.includes(this.keywordRecord)) {
      this.keywordRecord = "";
    }
    this.keywordRecordSelect.value = this.keywordRecord;
  }

  private syncScopeUi(): void {
    const special = this.activeScope === "marks"
      || this.activeScope === "pending"
      || this.activeScope === "keywords";
    const scopeChanged = this.lastSyncedScope !== null
      && this.lastSyncedScope !== this.activeScope;
    this.lastSyncedScope = this.activeScope;
    this.root?.toggleClass("is-special-scope", special);
    this.queryInput?.toggleClass("is-hidden", this.activeScope === "keywords");
    const volumeMode = this.activeScope === "volume";
    const keywordMode = this.activeScope === "keywords";
    const chapterMode = this.activeScope === "chapter";
    this.volumeSelect?.toggleClass("is-hidden", !volumeMode);
    this.chapterLabel?.toggleClass("is-hidden", !chapterMode);
    this.keywordGroupSelect?.toggleClass("is-hidden", !keywordMode);
    this.keywordRecordSelect?.toggleClass("is-hidden", !keywordMode);
    if (volumeMode) {
      this.populateVolumes();
    }
    if (keywordMode) {
      this.populateKeywordGroups();
    }
    if (this.replacerRoot && scopeChanged) {
      this.closeReplacer();
    }
  }

  private populateVolumes(): void {
    if (!this.volumeSelect) {
      return;
    }
    const file = this.plugin.getActiveNovelEditorFile();
    const group = file
      ? this.plugin.findNovelGroupRoot(
        this.plugin.normalizeFolderPath(file.parent?.path ?? "/"),
      )
      : null;
    const model = group ? this.plugin.getArticleListModel(group) : null;
    const volumes = model?.volumes ?? [];
    this.volumeSelect.empty();
    if (volumes.length === 0) {
      const option = this.volumeSelect.createEl("option", {
        text: "无卷",
        attr: { value: "" },
      });
      this.volumeSelect.value = option.value;
      this.volumePath = "";
      return;
    }
    for (const volume of volumes) {
      this.volumeSelect.createEl("option", {
        text: volume.name,
        attr: { value: volume.path },
      });
    }
    const currentParent = file
      ? this.plugin.normalizeFolderPath(file.parent?.path ?? "/")
      : "";
    const preferred = volumes.some((volume) => volume.path === this.volumePath)
      ? this.volumePath
      : volumes.some((volume) => volume.path === currentParent)
        ? currentParent
        : volumes[0].path;
    this.volumePath = preferred;
    this.volumeSelect.value = preferred;
  }

  private searchFiles(): TFile[] {
    const current = this.plugin.getActiveNovelEditorFile();
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
      if (!this.volumePath) {
        return [];
      }
      const folder = this.plugin.normalizeFolderPath(this.volumePath);
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
      replacement: this.replacerInput?.value ?? "",
      caseSensitive: !!this.caseInput?.checked,
      wholeWord: !!this.wordInput?.checked,
      regex: !!this.regexInput?.checked,
    };
  }

  private currentGroupName(): string {
    const current = this.plugin.getActiveNovelEditorFile();
    const root = current
      ? this.plugin.findNovelGroupRoot(
        this.plugin.normalizeFolderPath(current.parent?.path ?? "/"),
      )
      : null;
    return root
      ? this.plugin.getNovelGroupInfo(root)?.name ?? root.split("/").pop() ?? root
      : "未归属小说组";
  }

  private createContext(total: number): FinderContext {
    const options = this.options();
    return {
      groupName: this.currentGroupName(),
      scope: this.activeScope,
      scopeLabel: SCOPE_LABELS[this.activeScope],
      query: this.activeScope === "keywords"
        ? this.keywordRecord || "全部关键词"
        : options.query,
      caseSensitive: options.caseSensitive,
      wholeWord: options.wholeWord,
      regex: options.regex,
      total,
    };
  }

  syncActiveResult(result: FinderResult): void {
    if (!this.searchCompleted) {
      return;
    }
    const index = this.lastResults.findIndex((candidate) => (
      candidate.path === result.path
      && candidate.offset === result.offset
      && candidate.length === result.length
    ));
    if (index < 0) {
      return;
    }
    this.activeResultIndex = index;
    this.updateNavigator();
  }

  private async finishSearch(
    context: FinderContext,
    results: FinderResult[],
    token: number,
  ): Promise<void> {
    if (token !== this.searchToken) {
      return;
    }
    this.searchCompleted = true;
    this.lastResults = results;
    this.activeResultIndex = results.length > 0 ? 0 : -1;
    this.updateNavigator();
    await this.plugin.showNovelFinderResults(context, results);
    if (token !== this.searchToken) {
      return;
    }
    const fileScope = context.scope === "chapter"
      || context.scope === "volume"
      || context.scope === "book";
    const first = results[0];
    this.plugin.clearNovelFinderHighlights();
    if (fileScope && first) {
      await this.plugin.focusNovelFinderResult(first, context.scope, {
        openChapter: false,
        scroll: context.scope === "chapter",
        focus: false,
      });
    }
  }

  private async stepResult(direction: -1 | 1): Promise<void> {
    if (!this.searchCompleted || this.lastResults.length === 0) {
      return;
    }
    const length = this.lastResults.length;
    this.activeResultIndex = (
      this.activeResultIndex + direction + length
    ) % length;
    this.updateNavigator();
    const result = this.lastResults[this.activeResultIndex];
    if (result) {
      await this.plugin.focusNovelFinderResult(result, this.activeScope, {
        openChapter: true,
        scroll: true,
        focus: true,
      });
    }
  }

  private updateNavigator(): void {
    if (!this.navigator || !this.navigatorCounter) {
      return;
    }
    const fileScope = this.activeScope === "chapter"
      || this.activeScope === "volume"
      || this.activeScope === "book";
    const query = this.queryInput?.value.trim() ?? "";
    const visible = fileScope
      && this.searchCompleted
      && query.length > 0
      && this.lastResults.length > 0;
    this.navigator.toggleClass("is-visible", visible);
    this.navigatorCounter.setText(
      `${Math.max(1, this.activeResultIndex + 1)}/${this.lastResults.length}`,
    );
  }

  private async search(): Promise<void> {
    const focused = activeDocument.activeElement;
    try {
      await this.performSearch();
    } finally {
      if (
        focused instanceof HTMLElement
        && focused.isConnected
        && focused !== activeDocument.body
      ) {
        focused.focus({ preventScroll: true });
      }
    }
  }

  private async performSearch(): Promise<void> {
    const token = ++this.searchToken;
    const options = this.options();
    this.searchCompleted = false;
    this.updateNavigator();
    this.refreshContextHeader();
    if (
      this.activeScope === "marks"
      || this.activeScope === "pending"
      || this.activeScope === "keywords"
    ) {
      const results = await this.collectSpecialResults(
        this.activeScope,
        options.query,
      );
      await this.finishSearch(
        this.createContext(results.length),
        results,
        token,
      );
      return;
    }
    const query = options.query.trim();
    if (!query) {
      await this.finishSearch(this.createContext(0), [], token);
      return;
    }
    const compiled = compileSearchExpression(options);
    if (!compiled.regex) {
      await this.finishSearch(this.createContext(0), [], token);
      return;
    }
    const files = this.searchFiles();
    const results: FinderResult[] = [];
    const chapterText = this.activeScope === "chapter"
      ? this.plugin.getActiveNovelEditorText()
      : null;
    for (const file of files) {
      let text = "";
      if (chapterText !== null) {
        text = chapterText;
      } else {
        try {
          text = splitFrontmatterContent(
            await this.plugin.app.vault.cachedRead(file),
          ).body;
        } catch {
          continue;
        }
      }
      const { matches } = findSearchMatches(text, compiled.regex, 50);
      for (const match of matches) {
        results.push({
          kind: "file",
          title: `${file.basename} · 第 ${match.line} 行`,
          detail: `${match.before}${match.matchText}${match.after}`.trim(),
          path: file.path,
          line: match.line,
          before: match.before,
          matchText: match.matchText,
          after: match.after,
          offset: match.offset,
          length: match.length,
        });
      }
    }
    await this.finishSearch(
      this.createContext(results.length),
      results,
      token,
    );
  }

  private async collectSpecialResults(
    scope: "marks" | "pending" | "keywords",
    query: string,
  ): Promise<FinderResult[]> {
    const needle = scope === "keywords"
      ? ""
      : query.trim().toLocaleLowerCase();
    const current = this.plugin.getActiveNovelEditorFile();
    const root = current
      ? this.plugin.findNovelGroupRoot(
        this.plugin.normalizeFolderPath(current.parent?.path ?? "/"),
      )
      : null;
    if (scope === "keywords") {
      return this.plugin.getSettingKeywordsForFinder()
        .filter((entry) => (
          (!this.keywordGroup || entry.group === this.keywordGroup)
          && (!this.keywordRecord || entry.keyword === this.keywordRecord)
        ))
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
        const pattern = /```(?:待修改部分|对照组)[^\n]*\n([\s\S]*?)```/gu;
        let match: RegExpExecArray | null;
        while ((match = pattern.exec(text)) !== null) {
          const body = match[1].trim();
          const header = match[0].split("\n")[0] ?? "";
          const title = header
            .replace(/^```(?:待修改部分|对照组)/u, "")
            .replace(/[\p{Extended_Pictographic}]/gu, "")
            .trim() || "对照组";
          if (needle && !title.toLocaleLowerCase().includes(needle)) {
            continue;
          }
          const line = text.slice(0, match.index).split("\n").length;
          results.push({
            kind: "file",
            title: `${file.basename} · ${title}`,
            detail: body.slice(0, 120),
            path: file.path,
            line,
          });
        }
        continue;
      }
      const frontmatter: unknown = this.plugin.app.metadataCache.getFileCache(file)
        ?.frontmatter;
      const raw: unknown = frontmatter && typeof frontmatter === "object"
        ? (frontmatter as Record<string, unknown>)["novelview-marks"]
        : undefined;
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
        if (needle && !mark.label.toLocaleLowerCase().includes(needle)) {
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

  private async replaceOne(): Promise<void> {
    if (
      this.activeScope === "marks"
      || this.activeScope === "pending"
      || this.activeScope === "keywords"
    ) {
      return;
    }
    const options = this.options();
    const compiled = compileSearchExpression(options);
    if (!compiled.regex) {
      return;
    }
    const one = new RegExp(
      compiled.regex.source,
      compiled.regex.flags.replace("g", ""),
    );
    for (const file of this.searchFiles()) {
      let text = "";
      try {
        text = await this.plugin.app.vault.cachedRead(file);
      } catch {
        continue;
      }
      if (!one.test(text)) {
        continue;
      }
      let replaced = 0;
      await this.plugin.app.vault.process(file, (content) => {
        const next = content.replace(one, options.replacement);
        if (next !== content) {
          replaced = 1;
        }
        return next;
      });
      if (replaced > 0) {
        new Notice("Novel View：已替换 1 处。");
        await this.search();
        return;
      }
    }
    new Notice("Novel View：没有可替换的匹配。");
  }

  private specialReplacementLabel(): string {
    switch (this.activeScope) {
      case "marks":
        return "文字标记名称";
      case "pending":
        return "对照组名称";
      case "keywords":
        return "关键词";
      default:
        return "内容";
    }
  }

  private novelMarkdownFiles(root: string): TFile[] {
    return this.plugin.app.vault.getMarkdownFiles().filter((file) => (
      file.path.startsWith(`${root}/`)
      && !this.plugin.isSpecialNovelFile(file)
    ));
  }

  private replaceInsensitive(
    text: string,
    query: string,
    replacement: string,
  ): string {
    const escaped = query.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
    return text.replace(new RegExp(escaped, "giu"), () => replacement);
  }

  private async replaceMarkLabels(
    root: string,
    query: string,
    replacement: string,
  ): Promise<number> {
    let count = 0;
    for (const file of this.novelMarkdownFiles(root)) {
      await this.plugin.app.fileManager.processFrontMatter(file, (
        frontmatter: Record<string, unknown>,
      ) => {
        const raw = frontmatter["novelview-marks"];
        if (typeof raw !== "string") {
          return;
        }
        let parsed: unknown;
        try {
          parsed = JSON.parse(raw);
        } catch {
          return;
        }
        if (!Array.isArray(parsed)) {
          return;
        }
        let changed = false;
        for (const item of parsed) {
          if (!item || typeof item !== "object") {
            continue;
          }
          const record = item as Record<string, unknown>;
          if (typeof record.label !== "string") {
            continue;
          }
          const next = this.replaceInsensitive(record.label, query, replacement);
          if (next !== record.label) {
            record.label = next;
            count += 1;
            changed = true;
          }
        }
        if (changed) {
          frontmatter["novelview-marks"] = JSON.stringify(parsed);
        }
      });
    }
    return count;
  }

  private async replacePendingTitles(
    root: string,
    query: string,
    replacement: string,
  ): Promise<number> {
    let count = 0;
    const openRe = /^(?:`{3,})[ \t]*(?:待修改部分|对照组)(.*)$/u;
    for (const file of this.novelMarkdownFiles(root)) {
      await this.plugin.app.vault.process(file, (text) => {
        let changed = false;
        const lines = text.split("\n").map((line) => {
          const match = openRe.exec(line);
          if (!match) {
            return line;
          }
          const rest = match[1] ?? "";
          const emoji = /[🟢🔴🟠🟡🔵🟣🟤]/u.exec(rest)?.[0] ?? "";
          const title = rest
            .replace(/[🟢🔴🟠🟡🔵🟣🟤]/gu, "")
            .replace(/^[\s:：-]+/u, "")
            .trim() || "对照组";
          if (!title.toLocaleLowerCase().includes(query.toLocaleLowerCase())) {
            return line;
          }
          const nextTitle = this.replaceInsensitive(title, query, replacement);
          const fence = line.match(/^`{3,}/u)?.[0] ?? "```";
          const next = `${fence}对照组${emoji}${
            nextTitle === "对照组" ? "" : ` ${nextTitle}`
          }`;
          changed = true;
          count += 1;
          return next;
        });
        return changed ? lines.join("\n") : text;
      });
    }
    return count;
  }

  private async replaceAllSpecial(): Promise<void> {
    const replacement = this.replacerInput?.value ?? "";
    if (!replacement.trim()) {
      new Notice("Novel View：请输入新的名称。");
      return;
    }
    const query = this.options().query.trim();
    if (this.activeScope !== "keywords" && !query) {
      new Notice("Novel View：请先在查找框输入要替换的名称。");
      return;
    }
    if (this.activeScope === "keywords" && !this.keywordRecord) {
      new Notice("Novel View：请先选择要替换的设定记录。");
      return;
    }
    const confirmed = await confirmAction(
      this.plugin.app,
      `替换全部${this.specialReplacementLabel()}`,
      this.activeScope === "keywords"
        ? `将把关键词“${this.keywordRecord}”替换为“${replacement}”，并同步更新文章与设定记录。`
        : `将把所有匹配的${this.specialReplacementLabel()}“${query}”替换为“${replacement}”。`,
      "全部替换",
    );
    if (!confirmed) {
      return;
    }
    const file = this.plugin.getActiveNovelEditorFile();
    const root = file
      ? this.plugin.findNovelGroupRoot(
        this.plugin.normalizeFolderPath(file.parent?.path ?? "/"),
      )
      : null;
    if (!root) {
      new Notice("Novel View：未找到当前小说组。");
      return;
    }
    if (this.activeScope === "keywords") {
      const result = await this.plugin.replaceNovelKeyword(
        root,
        this.keywordRecord,
        replacement.trim(),
      );
      if (!result) {
        new Notice("Novel View：替换失败，目标关键词可能已存在。");
        return;
      }
      this.keywordRecord = replacement.trim();
      await this.plugin.refreshSettingKeywordIndex();
      new Notice(
        `Novel View：已替换关键词，更新 ${result.records} 条设定记录、${result.files} 个文章文件。`,
      );
      await this.search();
      return;
    }
    let count = 0;
    try {
      if (this.activeScope === "marks") {
        count = await this.replaceMarkLabels(root, query, replacement);
        this.plugin.refreshOpenViews();
      } else if (this.activeScope === "pending") {
        count = await this.replacePendingTitles(root, query, replacement);
        this.plugin.refreshOpenViews();
      }
    } catch (error) {
      console.error("Novel View: special replacement failed", error);
      new Notice("Novel View：替换失败。");
      return;
    }
    new Notice(`Novel View：已替换 ${count} 处${this.specialReplacementLabel()}。`);
    await this.search();
  }

  private async replaceAll(): Promise<void> {
    if (
      this.activeScope === "marks"
      || this.activeScope === "pending"
      || this.activeScope === "keywords"
    ) {
      await this.replaceAllSpecial();
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
