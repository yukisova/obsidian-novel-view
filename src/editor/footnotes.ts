import {
  Decoration,
  EditorView,
  ViewPlugin,
  type DecorationSet,
  type ViewUpdate,
} from "@codemirror/view";
import { RangeSetBuilder } from "@codemirror/state";

const REFERENCE_RE = /\[\^([^\]\s]+)\]/gu;

export interface FootnoteReference {
  key: string;
  from: number;
  to: number;
  line: number;
}

export function parseFootnoteReferences(text: string): FootnoteReference[] {
  const references: FootnoteReference[] = [];
  let offset = 0;
  let lineNumber = 0;
  for (const line of text.split("\n")) {
    lineNumber += 1;
    if (/^\[\^[^\]\s]+\]:/u.test(line)) {
      offset += line.length + 1;
      continue;
    }
    for (const match of line.matchAll(REFERENCE_RE)) {
      const start = offset + (match.index ?? 0);
      references.push({
        key: match[1] ?? "",
        from: start,
        to: start + match[0].length,
        line: lineNumber,
      });
    }
    offset += line.length + 1;
  }
  return references;
}

export interface FootnoteDefinition {
  key: string;
  text: string;
  line: number;
  from: number;
  to: number;
}

export function parseFootnoteDefinitions(text: string): FootnoteDefinition[] {
  const definitions: FootnoteDefinition[] = [];
  let offset = 0;
  let lineNumber = 0;
  for (const line of text.split("\n")) {
    lineNumber += 1;
    const match = /^\[\^([^\]\s]+)\]:[ \t]*(.*)$/u.exec(line);
    if (match) {
      definitions.push({
        key: match[1] ?? "",
        text: match[2] ?? "",
        line: lineNumber,
        from: offset,
        to: offset + line.length,
      });
    }
    offset += line.length + 1;
  }
  return definitions;
}

export function nextFootnoteKey(text: string): string {
  let next = 1;
  for (const match of text.matchAll(REFERENCE_RE)) {
    const value = Number(match[1]);
    if (Number.isFinite(value)) {
      next = Math.max(next, Math.floor(value) + 1);
    }
  }
  for (const definition of parseFootnoteDefinitions(text)) {
    const value = Number(definition.key);
    if (Number.isFinite(value)) {
      next = Math.max(next, Math.floor(value) + 1);
    }
  }
  return String(next);
}

function buildFootnoteDecorations(view: EditorView): DecorationSet {
  const builder = new RangeSetBuilder<Decoration>();
  for (const { from, to } of view.visibleRanges) {
    let position = from;
    while (position <= to) {
      const line = view.state.doc.lineAt(position);
      if (!line.text.startsWith("[^")) {
        REFERENCE_RE.lastIndex = 0;
        let match: RegExpExecArray | null;
        while ((match = REFERENCE_RE.exec(line.text)) !== null) {
          const start = line.from + match.index;
          const end = start + match[0].length;
          builder.add(start, end, Decoration.mark({
            class: "novelview-footnote-ref",
            attributes: {
              "data-footnote-key": match[1] ?? "",
              "data-footnote-number": match[1] ?? "",
            },
          }));
        }
      }
      if (line.to >= to) {
        break;
      }
      position = line.to + 1;
    }
  }
  return builder.finish();
}

class FootnotePlugin {
  decorations: DecorationSet;

  constructor(view: EditorView) {
    this.decorations = buildFootnoteDecorations(view);
  }

  update(update: ViewUpdate): void {
    if (update.docChanged || update.viewportChanged) {
      this.decorations = buildFootnoteDecorations(update.view);
    }
  }
}

export const footnoteExtension = ViewPlugin.fromClass(FootnotePlugin, {
  decorations: (value) => value.decorations,
});
