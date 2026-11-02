import {
  Compartment,
  EditorSelection,
  EditorState,
  Prec,
  RangeSetBuilder,
} from "@codemirror/state";
import {
  Decoration,
  EditorView,
  keymap,
  ViewPlugin,
  type DecorationSet,
  type ViewUpdate,
} from "@codemirror/view";
import { findFrontmatterEnd } from "../core/paragraphs";

const hiddenLine = Decoration.line({ class: "novelview-hidden-frontmatter" });

function frontmatterEndLine(state: EditorState): number {
  const { doc } = state;
  return findFrontmatterEnd(
    (index) => index < doc.lines ? doc.line(index + 1).text : null,
    doc.lines,
  );
}

function buildDecorations(view: EditorView): DecorationSet {
  const end = frontmatterEndLine(view.state);
  if (end === 0) {
    return Decoration.none;
  }
  const builder = new RangeSetBuilder<Decoration>();
  for (let lineNumber = 1; lineNumber <= end; lineNumber += 1) {
    const line = view.state.doc.line(lineNumber);
    builder.add(line.from, line.from, hiddenLine);
  }
  return builder.finish();
}

class FrontmatterHidePlugin {
  decorations: DecorationSet;

  constructor(view: EditorView) {
    this.decorations = buildDecorations(view);
  }

  update(update: ViewUpdate): void {
    this.decorations = buildDecorations(update.view);
  }
}

export const frontmatterHideExtension = ViewPlugin.fromClass(
  FrontmatterHidePlugin,
  {
    decorations: (plugin) => plugin.decorations,
  },
);

export function frontmatterBodyStart(state: EditorState): number | null {
  const end = frontmatterEndLine(state);
  if (end === 0) {
    return null;
  }
  return end < state.doc.lines
    ? state.doc.line(end + 1).from
    : state.doc.length;
}

export const frontmatterBoundaryKeymap = Prec.highest(keymap.of([
  {
    key: "Backspace",
    run: (view) => {
      const boundary = frontmatterBodyStart(view.state);
      if (boundary === null) {
        return false;
      }
      const selection = view.state.selection.main;
      if (selection.empty) {
        return selection.head <= boundary;
      }
      return selection.from < boundary;
    },
  },
  {
    key: "Delete",
    run: (view) => {
      const boundary = frontmatterBodyStart(view.state);
      if (boundary === null) {
        return false;
      }
      const selection = view.state.selection.main;
      if (selection.empty) {
        return selection.head < boundary;
      }
      return selection.from < boundary;
    },
  },
  {
    key: "Mod-a",
    run: (view) => {
      const boundary = frontmatterBodyStart(view.state);
      if (boundary === null) {
        return false;
      }
      view.dispatch({
        selection: EditorSelection.single(boundary, view.state.doc.length),
      });
      return true;
    },
  },
]));

/**
 * Reject user edits that would remove or rewrite the YAML frontmatter block.
 * Programmatic/config sync transactions are still allowed.
 */
export const frontmatterProtection = EditorState.transactionFilter.of((transaction) => {
  if (!transaction.docChanged) {
    return transaction;
  }
  const userEdit = transaction.isUserEvent("input")
    || transaction.isUserEvent("delete")
    || transaction.isUserEvent("undo")
    || transaction.isUserEvent("redo");
  if (!userEdit) {
    return transaction;
  }
  const end = frontmatterEndLine(transaction.startState);
  if (end === 0) {
    return transaction;
  }
  const protectedLength = transaction.startState.doc.line(end).to;
  const previousHead = transaction.startState.doc.sliceString(0, protectedLength);
  const nextHead = transaction.newDoc.sliceString(
    0,
    Math.min(protectedLength, transaction.newDoc.length),
  );
  return previousHead === nextHead ? transaction : [];
});


export const frontmatterCompartment = new Compartment();

const frontmatterExtensions = [
  frontmatterHideExtension,
  frontmatterBoundaryKeymap,
  frontmatterProtection,
];

export function setFrontmatterProtection(
  view: EditorView,
  enabled: boolean,
): void {
  view.dispatch({
    effects: frontmatterCompartment.reconfigure(
      enabled ? frontmatterExtensions : [],
    ),
  });
}
