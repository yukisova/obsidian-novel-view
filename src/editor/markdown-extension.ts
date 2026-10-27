import { RangeSetBuilder } from "@codemirror/state";
import {
  Decoration,
  ViewPlugin,
  type DecorationSet,
  type EditorView,
  type ViewUpdate,
} from "@codemirror/view";
import {
  classifyLine,
  findFrontmatterEnd,
  isSpecialBlockLine,
} from "../core/paragraphs";

const PROSE_LINE = "novelview-prose-line";
const PARAGRAPH_START = "novelview-paragraph-start";
const PARAGRAPH_END = "novelview-paragraph-end";
const PREINDENTED = "novelview-preindented";
const EMPTY_LINE = "novelview-empty-line";
const BLOCK_LINE = "novelview-block-line";
const BLOCK_END = "novelview-block-end";

const decorationCache = new Map<string, Decoration>();

function lineDecoration(className: string): Decoration {
  let decoration = decorationCache.get(className);
  if (!decoration) {
    decoration = Decoration.line({ class: className });
    decorationCache.set(className, decoration);
  }
  return decoration;
}

/**
 * Adds inert CSS hooks to Markdown paragraphs.
 *
 * The classes are always present (only for visible source lines), but they do
 * nothing until a view content element receives `.novelview-novel-mode`. This
 * keeps toggling purely visual and avoids reconfiguring the editor extension
 * for every view.
 */
class MarkdownParagraphPlugin {
  decorations: DecorationSet;

  constructor(view: EditorView) {
    this.decorations = buildDecorations(view);
  }

  update(update: ViewUpdate): void {
    if (update.docChanged || update.viewportChanged) {
      this.decorations = buildDecorations(update.view);
    }
  }
}

export const novelMarkdownExtension = ViewPlugin.fromClass(
  MarkdownParagraphPlugin,
  {
    decorations: (plugin) => plugin.decorations,
  },
);

function isListContinuationLine(
  text: string,
  previous: string | null,
): boolean {
  return previous !== null
    && /^\s+/u.test(text)
    && (
      isSpecialBlockLine(previous)
      || /^\s+/u.test(previous)
    );
}

function buildDecorations(view: EditorView): DecorationSet {
  const builder = new RangeSetBuilder<Decoration>();
  const { doc } = view.state;

  if (doc.length === 0) {
    // The viewport can be empty before an empty document has been measured.
    // Keep the initial caret indented even in that case.
    builder.add(0, 0, lineDecoration(EMPTY_LINE));
    return builder.finish();
  }

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

        if (line.number > frontmatterEnd && line.text.trim().length === 0) {
          // Keep the caret in the visual first-line indent even before the
          // paragraph has any text. A generated first-line spacer alone cannot
          // move an empty line's caret, so this line gets horizontal padding.
          builder.add(line.from, line.from, lineDecoration(EMPTY_LINE));
        } else if (line.number > frontmatterEnd) {
          const previous = line.number > 1 && line.number - 1 > frontmatterEnd
            ? doc.line(line.number - 1).text
            : null;
          const next = line.number < doc.lines && line.number + 1 > frontmatterEnd
            ? doc.line(line.number + 1).text
            : null;
          const classification = classifyLine(line.text, previous, next);

          if (classification.prose) {
            const classes = [PROSE_LINE];
            if (classification.paragraphStart) {
              classes.push(PARAGRAPH_START);
            }
            if (classification.paragraphEnd) {
              classes.push(PARAGRAPH_END);
            }
            if (/^\s/u.test(line.text)) {
              classes.push(PREINDENTED);
            }

            builder.add(
              line.from,
              line.from,
              lineDecoration(classes.join(" ")),
            );
          } else if (
            isSpecialBlockLine(line.text)
            || isListContinuationLine(line.text, previous)
          ) {
            const classes = [BLOCK_LINE];
            if (
              !next
              || (
                !isSpecialBlockLine(next)
                && !isListContinuationLine(next, line.text)
              )
            ) {
              classes.push(BLOCK_END);
            }
            builder.add(
              line.from,
              line.from,
              lineDecoration(classes.join(" ")),
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
