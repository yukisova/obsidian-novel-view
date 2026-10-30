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
  const seen = new Set<string>();

  for (let lineNumber = frontmatterEnd + 1; lineNumber <= doc.lines; lineNumber += 1) {
    const line = doc.line(lineNumber);
    if (!line.text) {
      continue;
    }
    for (const match of findLinkKeywordMatches(line.text, currentEntries)) {
      const normalized = match.entry.keyword.toLocaleLowerCase();
      if (seen.has(normalized)) {
        continue;
      }
      seen.add(normalized);
      builder.add(
        line.from + match.start,
        line.from + match.end,
        Decoration.mark({
          class: "novelview-link-keyword",
          attributes: {
            style: `color: ${match.entry.color};`,
            "data-novelview-link-path": match.entry.path,
            "data-novelview-link-name": match.entry.basename,
            "data-novelview-link-tag": match.entry.tag,
            "data-novelview-link-group": match.entry.group,
          },
        }),
      );
    }
  }

  return builder.finish();
}
