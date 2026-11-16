import {
  RangeSetBuilder,
  StateEffect,
} from "@codemirror/state";
import {
  Decoration,
  ViewPlugin,
  type DecorationSet,
  type EditorView,
  type ViewUpdate,
} from "@codemirror/view";
import {
  findSettingKeywordMatches,
  type SettingKeywordEntry,
} from "../core/setting-collection";
import { findFrontmatterEnd } from "../core/paragraphs";

let currentEntries: SettingKeywordEntry[] = [];
let keywordRevision = 0;
const activeViews = new Set<EditorView>();
const refreshKeywordEffect = StateEffect.define<null>();

export function setSettingKeywords(entries: SettingKeywordEntry[]): void {
  currentEntries = entries;
  keywordRevision += 1;
}

export function refreshSettingKeywords(): void {
  keywordRevision += 1;
  for (const view of activeViews) {
    try {
      view.dispatch({});
    } catch (error) {
      console.debug("Novel View: setting keyword refresh skipped", error);
    }
  }
}

function buildFirstOccurrencePositions(view: EditorView): Set<number> {
  const positions = new Set<number>();
  if (currentEntries.length === 0) {
    return positions;
  }
  const { doc } = view.state;
  const frontmatterEnd = findFrontmatterEnd(
    (index) => index < doc.lines ? doc.line(index + 1).text : null,
  );
  const seen = new Set<string>();
  for (let lineNumber = frontmatterEnd + 1; lineNumber <= doc.lines; lineNumber += 1) {
    const line = doc.line(lineNumber);
    if (!line.text) {
      continue;
    }
    for (const match of findSettingKeywordMatches(line.text, currentEntries)) {
      const normalized = match.entry.keyword.toLocaleLowerCase();
      if (seen.has(normalized)) {
        continue;
      }
      seen.add(normalized);
      positions.add(line.from + match.start);
    }
  }
  return positions;
}

function buildDecorations(
  view: EditorView,
  firstPositions: Set<number>,
): DecorationSet {
  if (
    firstPositions.size === 0
    || !view.dom.closest(".novelview-novel-mode")
  ) {
    return Decoration.none;
  }
  const builder = new RangeSetBuilder<Decoration>();
  const { doc } = view.state;
  const visited = new Set<number>();
  for (const range of view.visibleRanges) {
    let line = doc.lineAt(range.from);
    while (line.from <= range.to) {
      if (!visited.has(line.number) && line.text) {
        visited.add(line.number);
        for (const match of findSettingKeywordMatches(line.text, currentEntries)) {
          const absolute = line.from + match.start;
          if (!firstPositions.has(absolute)) {
            continue;
          }
          builder.add(
            absolute,
            line.from + match.end,
            Decoration.mark({
              class: "novelview-setting-keyword",
              attributes: {
                style: `color: ${match.entry.color};`,
                "data-novelview-setting-keyword": match.entry.keyword,
                "data-novelview-setting-group": match.entry.group,
                "data-novelview-setting-tag": match.entry.tag,
                "data-novelview-setting-content": match.entry.content,
              },
            }),
          );
        }
      }
      if (line.to >= doc.length) {
        break;
      }
      line = doc.line(line.number + 1);
    }
  }
  return builder.finish();
}

class SettingKeywordPlugin {
  private readonly view: EditorView;
  private revision = keywordRevision;
  private firstPositions: Set<number>;
  private refreshTimer: number | null = null;
  decorations: DecorationSet;

  constructor(view: EditorView) {
    this.view = view;
    activeViews.add(view);
    this.firstPositions = buildFirstOccurrencePositions(view);
    this.decorations = buildDecorations(view, this.firstPositions);
  }

  update(update: ViewUpdate): void {
    const forced = update.transactions.some((transaction) => (
      transaction.effects.some((effect) => effect.is(refreshKeywordEffect))
    ));
    if (forced) {
      this.recompute(update.view);
      return;
    }
    const revisionChanged = this.revision !== keywordRevision;
    if (update.docChanged) {
      this.firstPositions = this.mapPositions(update.changes);
      this.decorations = this.decorations.map(update.changes);
      this.scheduleRefresh();
      return;
    }
    if (revisionChanged) {
      this.recompute(update.view);
      return;
    }
    if (update.viewportChanged) {
      this.decorations = buildDecorations(update.view, this.firstPositions);
    }
  }

  destroy(): void {
    if (this.refreshTimer !== null) {
      window.clearTimeout(this.refreshTimer);
      this.refreshTimer = null;
    }
    activeViews.delete(this.view);
  }

  private mapPositions(
    changes: import("@codemirror/state").ChangeSet,
  ): Set<number> {
    const mapped = new Set<number>();
    for (const position of this.firstPositions) {
      const next = changes.mapPos(position);
      if (next >= 0) {
        mapped.add(next);
      }
    }
    return mapped;
  }

  private scheduleRefresh(): void {
    if (this.refreshTimer !== null) {
      window.clearTimeout(this.refreshTimer);
    }
    this.refreshTimer = window.setTimeout(() => {
      this.refreshTimer = null;
      if (!activeViews.has(this.view)) {
        return;
      }
      try {
        this.view.dispatch({ effects: refreshKeywordEffect.of(null) });
      } catch (error) {
        console.debug("Novel View: setting keyword refresh failed", error);
      }
    }, 140);
  }

  private recompute(view: EditorView): void {
    this.revision = keywordRevision;
    this.firstPositions = buildFirstOccurrencePositions(view);
    this.decorations = buildDecorations(view, this.firstPositions);
  }
}

export const settingKeywordExtension = ViewPlugin.fromClass(
  SettingKeywordPlugin,
  {
    decorations: (plugin) => plugin.decorations,
  },
);
