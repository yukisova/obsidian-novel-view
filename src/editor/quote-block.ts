import {
  Decoration,
  EditorView,
  ViewPlugin,
  type DecorationSet,
  type ViewUpdate,
} from "@codemirror/view";
import { RangeSetBuilder } from "@codemirror/state";

const quoteLine = Decoration.line({ class: "novelview-quote-line" });

function buildQuoteDecorations(view: EditorView): DecorationSet {
  const builder = new RangeSetBuilder<Decoration>();
  for (const { from, to } of view.visibleRanges) {
    let position = from;
    while (position <= to) {
      const line = view.state.doc.lineAt(position);
      if (/^\s*>\s?/u.test(line.text)) {
        builder.add(line.from, line.from, quoteLine);
      }
      if (line.to >= to) {
        break;
      }
      position = line.to + 1;
    }
  }
  return builder.finish();
}

class QuoteBlockPlugin {
  decorations: DecorationSet;

  constructor(view: EditorView) {
    this.decorations = buildQuoteDecorations(view);
  }

  update(update: ViewUpdate): void {
    if (update.docChanged || update.viewportChanged) {
      this.decorations = buildQuoteDecorations(update.view);
    }
  }
}

export const quoteBlockExtension = ViewPlugin.fromClass(QuoteBlockPlugin, {
  decorations: (value) => value.decorations,
});
