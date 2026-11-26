import {
  Notice,
  TFile,
  type App,
} from "obsidian";
import {
  Compartment,
  EditorState,
  StateEffect,
  StateField,
  type Extension,
} from "@codemirror/state";
import {
  Decoration,
  EditorView,
  WidgetType,
  type DecorationSet,
} from "@codemirror/view";
import { RangeSetBuilder } from "@codemirror/state";
import {
  joinFrontmatterContent,
  splitFrontmatterContent,
} from "../../core/text/paragraphs";
import type NovelViewPlugin from "../../main";

export interface SeamlessSection {
  path: string;
  title: string;
  from: number;
  to: number;
}

interface SectionData {
  file: TFile;
  prefix: string;
  body: string;
  savedBody: string;
}

const setSectionsEffect = StateEffect.define<SeamlessSection[]>();
const allowCrossBoundaryEffect = StateEffect.define<boolean>();
const MAX_LOADED_SECTIONS = 5;
const KEEP_AROUND_CENTER = 2;

const sectionsField = StateField.define<SeamlessSection[]>({
  create: () => [],
  update(value, transaction) {
    let next = value;
    for (const effect of transaction.effects) {
      if (effect.is(setSectionsEffect)) {
        next = effect.value;
      }
    }
    if (transaction.docChanged && next === value) {
      return value.map((section) => ({
        ...section,
        from: transaction.changes.mapPos(section.from, -1),
        to: transaction.changes.mapPos(section.to, 1),
      }));
    }
    return next;
  },
});

export function getSeamlessSections(
  state: EditorState,
): SeamlessSection[] {
  return state.field(sectionsField, false) ?? [];
}

class ChapterMarkerWidget extends WidgetType {
  constructor(
    private readonly title: string,
    private readonly index: number,
  ) {
    super();
  }

  override eq(other: ChapterMarkerWidget): boolean {
    return other.title === this.title && other.index === this.index;
  }

  override toDOM(): HTMLElement {
    const root = createDiv({ cls: "novelview-seamless-separator" });
    root.createDiv({
      cls: "novelview-seamless-separator-title",
      text: this.title,
    });
    return root;
  }
}

function buildSectionDecorations(sections: SeamlessSection[]): DecorationSet {
  const builder = new RangeSetBuilder<Decoration>();
  sections.forEach((section, index) => {
    builder.add(
      section.from,
      section.from,
      Decoration.widget({
        widget: new ChapterMarkerWidget(section.title, index),
        block: true,
        side: -1,
      }),
    );
  });
  return builder.finish();
}

export const seamlessExtension: Extension = [
  sectionsField,
  EditorView.decorations.from(sectionsField, buildSectionDecorations),
  EditorState.transactionFilter.of((transaction) => {
    if (transaction.effects.some((effect) => effect.is(allowCrossBoundaryEffect))) {
      return transaction;
    }
    const sections = transaction.startState.field(sectionsField);
    if (sections.length === 0) {
      return transaction;
    }
    let blocked = false;
    transaction.changes.iterChanges((fromA, toA) => {
      for (let i = 1; i < sections.length; i += 1) {
        const boundary = sections[i]?.from;
        if (boundary !== undefined && fromA < boundary && toA > boundary) {
          blocked = true;
        }
      }
    });
    if (blocked) {
      new Notice("Novel View：不能跨章节合并或删除，请分别编辑各章节。");
      return [];
    }
    return transaction;
  }),
];

export class SeamlessController {
  enabled = false;
  onDirtyChange: ((dirty: boolean) => void) | null = null;
  onChapterChange: ((path: string) => void) | null = null;

  private view: EditorView | null = null;
  private files: TFile[] = [];
  private loadedStart = 0;
  private loadedEnd = 0;
  private data = new Map<string, SectionData>();
  private saveTimer: number | null = null;
  private scrollTimer: number | null = null;
  private loading = false;
  private rebalancing = false;
  private mutating = false;
  private dirty = false;
  private centerPath: string | null = null;
  private resizeTimer: number | null = null;
  private saveChain: Promise<void> = Promise.resolve();

  constructor(
    private readonly app: App,
    private readonly plugin: NovelViewPlugin,
    private readonly compartment: Compartment,
    private readonly neighborCount = 1,
  ) {}

  get dirtyState(): boolean {
    return this.dirty;
  }

  get isMutating(): boolean {
    return this.mutating;
  }

  get loadedCount(): number {
    return this.loadedEnd - this.loadedStart + 1;
  }

  async enable(
    view: EditorView,
    currentPath: string,
    cursorOffset: number,
  ): Promise<void> {
    this.files = this.plugin.getOrderedNovelChapterFiles(currentPath);
    if (this.files.length === 0) {
      new Notice("Novel View：当前小说组没有章节。");
      return;
    }
    const currentIndex = Math.max(
      0,
      this.files.findIndex((file) => file.path === currentPath),
    );
    this.loadedStart = Math.max(0, currentIndex - this.neighborCount);
    this.loadedEnd = Math.min(
      this.files.length - 1,
      currentIndex + this.neighborCount,
    );
    while (
      this.loadedEnd - this.loadedStart + 1 < 3
      && this.loadedEnd < this.files.length - 1
    ) {
      this.loadedEnd += 1;
    }
    while (
      this.loadedEnd - this.loadedStart + 1 < 3
      && this.loadedStart > 0
    ) {
      this.loadedStart -= 1;
    }
    const entries: SectionData[] = [];
    for (const file of this.files.slice(this.loadedStart, this.loadedEnd + 1)) {
      const content = await this.app.vault.read(file);
      const { head, body } = splitFrontmatterContent(content);
      entries.push({ file, prefix: head, body, savedBody: body });
    }
    this.data.clear();
    let text = "";
    const sections: SeamlessSection[] = entries.map((entry) => {
      const from = text.length;
      text += entry.body;
      const section = {
        path: entry.file.path,
        title: entry.file.basename,
        from,
        to: text.length,
      };
      this.data.set(entry.file.path, entry);
      return section;
    });
    this.view = view;
    this.enabled = true;
    this.mutating = true;
    this.loading = true;
    view.dispatch({
      effects: this.compartment.reconfigure(seamlessExtension),
    });
    view.dispatch({
      changes: { from: 0, to: view.state.doc.length, insert: text },
      effects: setSectionsEffect.of(sections),
    });
    const current = sections.find((section) => section.path === currentPath)
      ?? sections[0];
    const target = Math.min(
      (current?.from ?? 0) + Math.max(0, cursorOffset),
      current?.to ?? view.state.doc.length,
    );
    view.dispatch({
      selection: { anchor: target },
      effects: EditorView.scrollIntoView(target, { y: "center" }),
    });
    this.loading = false;
    view.scrollDOM.addEventListener("scroll", this.handleScroll, {
      passive: true,
    });
    window.addEventListener("resize", this.handleResize);
    this.setDirty(false);
    window.requestAnimationFrame(() => {
      this.updateCenterSection(true);
      window.requestAnimationFrame(() => {
        this.mutating = false;
      });
    });
  }

  async jumpToPath(path: string): Promise<void> {
    const view = this.view;
    if (!view) {
      return;
    }
    await this.flush();
    view.dispatch({
      effects: this.compartment.reconfigure([]),
    });
    this.enabled = false;
    this.centerPath = null;
    await this.enable(view, path, 0);
  }

  async disable(): Promise<string | null> {
    await this.flush();
    const path = this.activeSection()?.path ?? null;
    window.removeEventListener("resize", this.handleResize);
    if (this.scrollTimer !== null) {
      window.clearTimeout(this.scrollTimer);
      this.scrollTimer = null;
    }
    if (this.resizeTimer !== null) {
      window.clearTimeout(this.resizeTimer);
      this.resizeTimer = null;
    }
    if (this.view) {
      this.view.scrollDOM.removeEventListener("scroll", this.handleScroll);
      this.view.dispatch({
        effects: this.compartment.reconfigure([]),
      });
    }
    this.enabled = false;
    this.mutating = false;
    this.view = null;
    this.files = [];
    this.data.clear();
    return path;
  }

  handleDocChanged(): void {
    if (!this.enabled || this.loading) {
      return;
    }
    this.setDirty(true);
    if (this.saveTimer !== null) {
      window.clearTimeout(this.saveTimer);
    }
    this.saveTimer = window.setTimeout(() => {
      this.saveTimer = null;
      void this.flush();
    }, 350);
  }

  getCenterSection(): { path: string; body: string; from: number; to: number } | null {
    const view = this.view;
    if (!view) {
      return null;
    }
    const sections = view.state.field(sectionsField);
    const section = sections.find((item) => item.path === this.centerPath)
      ?? sections[0];
    if (!section) {
      return null;
    }
    return {
      path: section.path,
      body: view.state.doc.sliceString(section.from, section.to),
      from: section.from,
      to: section.to,
    };
  }

  handleCenterChange(): void {
    this.updateCenterSection();
  }

  private centerPosition(): { x: number; y: number } | null {
    const view = this.view;
    if (!view) {
      return null;
    }
    const rect = view.scrollDOM.getBoundingClientRect();
    if (rect.height <= 0 || rect.width <= 0) {
      return null;
    }
    return {
      x: rect.left + rect.width / 2,
      y: rect.top + rect.height / 2,
    };
  }

  private updateCenterSection(force = false): void {
    const view = this.view;
    if (!view || !this.enabled) {
      return;
    }
    const center = this.centerPosition();
    const fallback = view.lineBlockAtHeight(
      view.scrollDOM.scrollTop + view.scrollDOM.clientHeight / 2,
    ).from;
    const position = center
      ? view.posAtCoords(center) ?? fallback
      : fallback;
    const sections = view.state.field(sectionsField);
    const section = sections.find((item) => (
      position >= item.from && position < item.to
    )) ?? sections[sections.length - 1];
    if (!section) {
      return;
    }
    const changed = section.path !== this.centerPath;
    this.centerPath = section.path;
    if (changed || force) {
      this.onChapterChange?.(section.path);
    }
    if (changed) {
      void this.rebalanceWindow(section);
    }
  }

  private async rebalanceWindow(section: SeamlessSection): Promise<void> {
    if (this.rebalancing) {
      return;
    }
    this.rebalancing = true;
    this.mutating = true;
    try {
      await this.maybeLoadAdjacent(section);
      await this.trimFarSections();
    } finally {
      this.rebalancing = false;
      window.requestAnimationFrame(() => {
        this.mutating = false;
      });
    }
  }

  private readonly handleResize = (): void => {
    if (!this.enabled) {
      return;
    }
    if (this.resizeTimer !== null) {
      window.clearTimeout(this.resizeTimer);
    }
    this.resizeTimer = window.setTimeout(() => {
      this.resizeTimer = null;
      this.updateCenterSection();
    }, 120);
  };

  async flush(): Promise<void> {
    const view = this.view;
    if (!view || !this.enabled) {
      return;
    }
    const sections = view.state.field(sectionsField);
    this.saveChain = this.saveChain
      .catch(() => undefined)
      .then(async () => {
        for (const section of sections) {
          const entry = this.data.get(section.path);
          if (!entry) {
            continue;
          }
          const body = view.state.doc.sliceString(section.from, section.to);
          if (body === entry.savedBody) {
            continue;
          }
          await this.app.vault.modify(
            entry.file,
            joinFrontmatterContent(entry.prefix, body),
          );
          entry.savedBody = body;
          entry.body = body;
        }
      })
      .catch((error) => {
        console.error("Novel View: seamless save failed", error);
        new Notice("Novel View：无缝模式保存失败。");
      });
    await this.saveChain;
    this.setDirty(false);
  }

  private activeSection(): SeamlessSection | null {
    const view = this.view;
    if (!view) {
      return null;
    }
    const head = view.state.selection.main.head;
    const sections = view.state.field(sectionsField);
    return sections.find((section) => (
      head >= section.from && head <= section.to
    )) ?? sections[sections.length - 1] ?? null;
  }

  private setDirty(dirty: boolean): void {
    if (this.dirty === dirty) {
      return;
    }
    this.dirty = dirty;
    this.onDirtyChange?.(dirty);
  }

  private readonly handleScroll = (): void => {
    if (!this.enabled || this.loading) {
      return;
    }
    if (this.scrollTimer !== null) {
      window.clearTimeout(this.scrollTimer);
    }
    this.scrollTimer = window.setTimeout(() => {
      this.scrollTimer = null;
      this.updateCenterSection();
    }, 120);
  };

  private async maybeLoadAdjacent(section: SeamlessSection): Promise<void> {
    if (this.loading) {
      return;
    }
    const view = this.view;
    if (!view) {
      return;
    }
    const sections = view.state.field(sectionsField);
    const index = sections.indexOf(section);
    if (index <= 0) {
      await this.prependPrevious();
    } else if (index >= sections.length - 1) {
      await this.appendNext();
    }
  }

  private async trimFarSections(): Promise<void> {
    const view = this.view;
    if (!view || !this.enabled || this.loading) {
      return;
    }
    const sections = view.state.field(sectionsField);
    const centerIndex = sections.findIndex(
      (section) => section.path === this.centerPath,
    );
    if (centerIndex < 0) {
      return;
    }
    let start = Math.max(0, centerIndex - KEEP_AROUND_CENTER);
    let end = Math.min(sections.length - 1, centerIndex + KEEP_AROUND_CENTER);
    while (end - start + 1 < MAX_LOADED_SECTIONS && end < sections.length - 1) {
      end += 1;
    }
    while (end - start + 1 < MAX_LOADED_SECTIONS && start > 0) {
      start -= 1;
    }
    if (start === 0 && end === sections.length - 1) {
      return;
    }
    await this.flush();
    const removedBefore = sections.slice(0, start);
    const removedAfter = sections.slice(end + 1);
    if (removedBefore.length === 0 && removedAfter.length === 0) {
      return;
    }
    const headLength = sections[start]?.from ?? 0;
    const kept = sections.slice(start, end + 1);
    const newSections = kept.map((section) => ({
      ...section,
      from: section.from - headLength,
      to: section.to - headLength,
    }));
    const changes = [];
    if (headLength > 0) {
      changes.push({ from: 0, to: headLength });
    }
    for (const section of removedAfter) {
      changes.push({ from: section.from, to: section.to });
    }
    const selection = view.state.selection.main;
    const centerSection = newSections.find(
      (section) => section.path === this.centerPath,
    ) ?? newSections[0];
    const oldHead = selection.head;
    let newHead = oldHead >= headLength
      ? oldHead - headLength
      : (centerSection?.from ?? 0);
    const maxNew = view.state.doc.length
      - headLength
      - removedAfter.reduce((sum, section) => sum + section.to - section.from, 0);
    newHead = Math.max(0, Math.min(newHead, maxNew));
    const anchor = sections[start]?.from ?? 0;
    const before = view.coordsAtPos(anchor);
    view.dispatch({
      changes,
      selection: { anchor: newHead },
      effects: [
        setSectionsEffect.of(newSections),
        allowCrossBoundaryEffect.of(true),
      ],
    });
    for (const section of [...removedBefore, ...removedAfter]) {
      this.data.delete(section.path);
    }
    const firstPath = newSections[0]?.path;
    const lastPath = newSections[newSections.length - 1]?.path;
    this.loadedStart = firstPath
      ? this.files.findIndex((file) => file.path === firstPath)
      : 0;
    this.loadedEnd = lastPath
      ? this.files.findIndex((file) => file.path === lastPath)
      : 0;
    if (before) {
      window.requestAnimationFrame(() => {
        const after = view.coordsAtPos(0);
        if (after) {
          view.scrollDOM.scrollTop += after.top - before.top;
        }
      });
    }
  }

  private async appendNext(): Promise<void> {
    if (this.loading || this.loadedEnd >= this.files.length - 1) {
      return;
    }
    const file = this.files[this.loadedEnd + 1];
    if (!file) {
      return;
    }
    this.loading = true;
    try {
      const content = await this.app.vault.read(file);
      const { head, body } = splitFrontmatterContent(content);
      const view = this.view;
      if (!view || !this.enabled) {
        return;
      }
      const sections = view.state.field(sectionsField);
      const from = view.state.doc.length;
      const nextSections = [
        ...sections,
        { path: file.path, title: file.basename, from, to: from + body.length },
      ];
      this.data.set(file.path, {
        file,
        prefix: head,
        body,
        savedBody: body,
      });
      view.dispatch({
        changes: { from, insert: body },
        effects: setSectionsEffect.of(nextSections),
      });
      this.loadedEnd += 1;
    } finally {
      this.loading = false;
    }
  }

  private async prependPrevious(): Promise<void> {
    if (this.loading || this.loadedStart <= 0) {
      return;
    }
    const file = this.files[this.loadedStart - 1];
    if (!file) {
      return;
    }
    this.loading = true;
    try {
      const content = await this.app.vault.read(file);
      const { head, body } = splitFrontmatterContent(content);
      const view = this.view;
      if (!view || !this.enabled) {
        return;
      }
      const headPosition = view.state.selection.main.head;
      const before = view.coordsAtPos(headPosition);
      const sections = view.state.field(sectionsField);
      const nextSections = [
        { path: file.path, title: file.basename, from: 0, to: body.length },
        ...sections.map((section) => ({
          ...section,
          from: section.from + body.length,
          to: section.to + body.length,
        })),
      ];
      this.data.set(file.path, {
        file,
        prefix: head,
        body,
        savedBody: body,
      });
      view.dispatch({
        changes: { from: 0, insert: body },
        effects: setSectionsEffect.of(nextSections),
      });
      this.loadedStart -= 1;
      window.requestAnimationFrame(() => {
        const after = view.coordsAtPos(
          Math.min(headPosition + body.length, view.state.doc.length),
        );
        if (before && after) {
          view.scrollDOM.scrollTop += after.top - before.top;
        }
      });
    } finally {
      this.loading = false;
    }
  }
}
