import { RangeSetBuilder } from "@codemirror/state";
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
const activeViews = new Set<EditorView>();

export function setSettingKeywords(entries: SettingKeywordEntry[]): void {
  currentEntries = entries;
}

export function refreshSettingKeywords(): void {
  for (const view of activeViews) {
    try {
      view.dispatch({});
    } catch (error) {
      console.debug("Novel View: setting keyword refresh skipped", error);
    }
  }
}

class SettingKeywordPlugin {
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

export const settingKeywordExtension = ViewPlugin.fromClass(
  SettingKeywordPlugin,
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
    for (const match of findSettingKeywordMatches(line.text, currentEntries)) {
      const normalized = match.entry.keyword.toLocaleLowerCase();
      if (seen.has(normalized)) {
        continue;
      }
      seen.add(normalized);
      builder.add(
        line.from + match.start,
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
  return builder.finish();
}
