import { RangeSetBuilder } from "@codemirror/state";
import {
  Decoration,
  ViewPlugin,
  type DecorationSet,
  type EditorView,
  type ViewUpdate,
} from "@codemirror/view";
import {
  findLinkKeywordMatches,
  type LinkKeywordEntry,
} from "../core/link-library";
import { findFrontmatterEnd } from "../core/paragraphs";

let currentEntries: LinkKeywordEntry[] = [];
const activeViews = new Set<EditorView>();

export function setLinkKeywords(entries: LinkKeywordEntry[]): void {
  currentEntries = entries;
}

export function refreshLinkKeywords(): void {
  for (const view of activeViews) {
    try {
      view.dispatch({});
    } catch (error) {
      console.debug("Novel View: link keyword refresh skipped", error);
    }
  }
}

class LinkKeywordPlugin {
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

export const linkKeywordExtension = ViewPlugin.fromClass(
  LinkKeywordPlugin,
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
          for (const match of findLinkKeywordMatches(line.text, currentEntries)) {
            builder.add(
              line.from + match.start,
              line.from + match.end,
              Decoration.mark({
                class: `novelview-link-keyword novelview-link-keyword-${match.entry.style}`,
                attributes: {
                  style: `color: ${match.entry.color};`,
                  "data-novelview-link-path": match.entry.path,
                  title: `打开 ${match.entry.basename}`,
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
