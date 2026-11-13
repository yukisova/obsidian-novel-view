import {
  RangeSetBuilder,
  StateEffect,
  StateField,
  type EditorState,
} from "@codemirror/state";
import {
  Decoration,
  EditorView,
  type DecorationSet,
} from "@codemirror/view";
import type { OutlineMark } from "../core/outline-marks";

export const setOutlineMarksEffect = StateEffect.define<OutlineMark[]>();

function mapMarks(
  marks: OutlineMark[],
  transaction: import("@codemirror/state").Transaction,
): OutlineMark[] {
  if (!transaction.docChanged) {
    return marks;
  }
  const mapped: OutlineMark[] = [];
  for (const mark of marks) {
    const start = transaction.changes.mapPos(mark.start, 1);
    const end = transaction.changes.mapPos(mark.end, -1);
    if (end > start) {
      mapped.push({ start, end, label: mark.label });
    }
  }
  return mapped;
}

export const outlineMarksField = StateField.define<OutlineMark[]>({
  create() {
    return [];
  },
  update(value, transaction) {
    const replacement = transaction.effects.find(
      (effect): effect is StateEffect<OutlineMark[]> => (
        effect.is(setOutlineMarksEffect)
      ),
    );
    if (replacement) {
      return replacement.value;
    }
    return mapMarks(value, transaction);
  },
});

function buildOutlineMarkDecorations(marks: OutlineMark[]): DecorationSet {
  const ranges = [...marks]
    .filter((mark) => mark.end > mark.start)
    .sort((left, right) => left.start - right.start);
  const builder = new RangeSetBuilder<Decoration>();
  let lastEnd = -1;
  for (const mark of ranges) {
    if (mark.start < lastEnd) {
      continue;
    }
    builder.add(
      mark.start,
      mark.end,
      Decoration.mark({
        class: "novelview-outline-mark",
        attributes: { "data-label": mark.label },
      }),
    );
    lastEnd = mark.end;
  }
  return builder.finish();
}

export const outlineMarksExtension = [
  outlineMarksField,
  EditorView.decorations.from(outlineMarksField, buildOutlineMarkDecorations),
];

export function getOutlineMarks(state: EditorState): OutlineMark[] {
  return state.field(outlineMarksField);
}
