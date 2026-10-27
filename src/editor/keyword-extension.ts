import { RangeSetBuilder } from "@codemirror/state";
import {
  Decoration,
  ViewPlugin,
  type DecorationSet,
  type EditorView,
  type ViewUpdate,
} from "@codemirror/view";
import {
  findKeywordMatches,
  type KeywordEntry,
} from "../core/keywords";
import { findFrontmatterEnd } from "../core/paragraphs";

let currentEntries: KeywordEntry[] = [];
const activeViews = new Set<EditorView>();

export function setNovelKeywords(entries: KeywordEntry[]): void {
  currentEntries = entries;
}

export function refreshNovelKeywords(): void {
  for (const view of activeViews) {
    try {
      view.dispatch({});
    } catch (error) {
      console.debug("NovelView: keyword refresh skipped", error);
    }
  }
}

class KeywordPlugin {
  private readonly view: EditorView;
  decorations: DecorationSet;

  constructor(view: EditorView) {
    this.view = view;
    activeViews.add(view);
    this.decorations = buildDecorations(view);
  }

  update(update: ViewUpdate): void {
    this.decorations = buildDecorations(update.view);
  }

  destroy(): void {
    activeViews.delete(this.view);
  }
}

export const novelKeywordExtension = ViewPlugin.fromClass(
  KeywordPlugin,
  {
    decorations: (plugin) => plugin.decorations,
  },
);

function buildDecorations(view: EditorView): DecorationSet {
  if (
    currentEntries.length === 0
    || !view.dom.closest(".novelview-novel-mode")
  ) {
    return Decoration.none;
  }

  const builder = new RangeSetBuilder<Decoration>();
  const { doc } = view.state;
  const frontmatterEnd = findFrontmatterEnd(
    (index) => index < doc.lines ? doc.line(index + 1).text : null,
  );
  let lastLineNumber = -1;

  for (const range of view.visibleRanges) {
    let position = range.from;

    while (position <= range.to) {
      const line = doc.lineAt(position);
      if (line.number !== lastLineNumber) {
        lastLineNumber = line.number;

        if (line.number > frontmatterEnd && line.text.length > 0) {
          for (const match of findKeywordMatches(line.text, currentEntries)) {
            builder.add(
              line.from + match.start,
              line.from + match.end,
              Decoration.mark({
                class: [
                  "novelview-keyword-link",
                  `novelview-keyword-${match.entry.category ?? "setting"}`,
                ].join(" "),
                attributes: {
                  "data-novelview-path": match.entry.path,
                  "data-novelview-line": String(match.entry.line ?? 1),
                  "data-novelview-category": match.entry.category ?? "setting",
                  title: `打开 ${match.entry.heading ?? match.entry.basename}`,
                },
              }),
            );
          }
        }
      }

      if (line.to >= range.to) {
        break;
      }
      position = line.to + 1;
    }
  }

  return builder.finish();
}

