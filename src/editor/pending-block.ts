import {
  EditorState,
  Prec,
  RangeSetBuilder,
  StateField,
} from "@codemirror/state";
import {
  Decoration,
  EditorView,
  keymap,
  WidgetType,
  type DecorationSet,
} from "@codemirror/view";

export const PENDING_KEYWORD = "待修改部分";

export type PendingColor =
  | "green"
  | "red"
  | "orange"
  | "yellow"
  | "blue"
  | "purple"
  | "brown";

export interface PendingColorOption {
  emoji: string;
  color: PendingColor;
}

export const PENDING_COLOR_OPTIONS: PendingColorOption[] = [
  { emoji: "🟢", color: "green" },
  { emoji: "🔴", color: "red" },
  { emoji: "🟠", color: "orange" },
  { emoji: "🟡", color: "yellow" },
  { emoji: "🔵", color: "blue" },
  { emoji: "🟣", color: "purple" },
  { emoji: "🟤", color: "brown" },
];

export interface PendingBlock {
  title: string;
  emoji: string;
  color: PendingColor;
  openLine: number;
  closeLine: number;
  openFrom: number;
  openTo: number;
  closeFrom: number;
  closeTo: number;
  contentStartLine: number;
  contentEndLine: number;
}

const OPEN_RE = /^(?:`{3,})(?:[ \t]*)待修改部分(.*)$/u;
const CLOSE_RE = /^`{3,}[ \t]*$/u;

function extractInfo(rest: string): {
  title: string;
  emoji: string;
  color: PendingColor;
} {
  const option = PENDING_COLOR_OPTIONS.find((item) => rest.includes(item.emoji));
  const title = rest
    .replace(/[🟢🔴🟠🟡🔵🟣🟤]/gu, "")
    .replace(/^[\s:：-]+/u, "")
    .trim();
  return {
    title: title || PENDING_KEYWORD,
    emoji: option?.emoji ?? "🟢",
    color: option?.color ?? "green",
  };
}

export function parsePendingBlocks(state: EditorState): PendingBlock[] {
  const blocks: PendingBlock[] = [];
  const { doc } = state;
  for (let lineNumber = 1; lineNumber <= doc.lines; lineNumber += 1) {
    const opening = doc.line(lineNumber);
    const match = OPEN_RE.exec(opening.text);
    if (!match) {
      continue;
    }
    let closeLineNumber = 0;
    for (let next = lineNumber + 1; next <= doc.lines; next += 1) {
      if (CLOSE_RE.test(doc.line(next).text)) {
        closeLineNumber = next;
        break;
      }
    }
    if (closeLineNumber === 0) {
      continue;
    }
    const info = extractInfo(match[1] ?? "");
    const closing = doc.line(closeLineNumber);
    blocks.push({
      ...info,
      openLine: lineNumber,
      closeLine: closeLineNumber,
      openFrom: opening.from,
      openTo: opening.to,
      closeFrom: closing.from,
      closeTo: closing.to,
      contentStartLine: lineNumber + 1,
      contentEndLine: closeLineNumber - 1,
    });
    lineNumber = closeLineNumber;
  }
  return blocks;
}

export function pendingBlockAt(state: EditorState, position: number): PendingBlock | null {
  for (const block of parsePendingBlocks(state)) {
    const first = block.contentStartLine <= state.doc.lines
      ? state.doc.line(block.contentStartLine).from
      : block.openTo;
    const last = block.contentEndLine >= block.contentStartLine
      ? state.doc.line(block.contentEndLine).to
      : block.openTo;
    if (position >= first && position <= last) {
      return block;
    }
  }
  return null;
}

class PendingHeaderWidget extends WidgetType {
  constructor(private readonly block: PendingBlock) {
    super();
  }

  override eq(other: PendingHeaderWidget): boolean {
    return other.block.title === this.block.title
      && other.block.emoji === this.block.emoji
      && other.block.color === this.block.color;
  }

  override toDOM(): HTMLElement {
    const header = document.createElement("div");
    header.className = `novelview-pending-header novelview-pending-${this.block.color}`;
    const emoji = document.createElement("span");
    emoji.className = "novelview-pending-header-emoji";
    emoji.textContent = this.block.emoji;
    const title = document.createElement("span");
    title.className = "novelview-pending-header-title";
    title.textContent = this.block.title;
    header.append(emoji, title);
    return header;
  }

  override ignoreEvent(): boolean {
    return true;
  }
}

class PendingCloseWidget extends WidgetType {
  override eq(other: PendingCloseWidget): boolean {
    return other instanceof PendingCloseWidget;
  }

  override toDOM(): HTMLElement {
    const spacer = document.createElement("div");
    spacer.className = "novelview-pending-close";
    return spacer;
  }

  override get estimatedHeight(): number {
    return 0;
  }

  override ignoreEvent(): boolean {
    return true;
  }
}

function buildPendingDecorations(state: EditorState): DecorationSet {
  const builder = new RangeSetBuilder<Decoration>();
  const { doc } = state;
  for (const block of parsePendingBlocks(state)) {
    builder.add(
      block.openFrom,
      block.openTo,
      Decoration.replace({
        block: true,
        widget: new PendingHeaderWidget(block),
      }),
    );
    const first = Math.max(block.contentStartLine, block.openLine + 1);
    const last = Math.min(block.contentEndLine, block.closeLine - 1);
    for (let lineNumber = first; lineNumber <= last; lineNumber += 1) {
      const line = doc.line(lineNumber);
      const endings = [
        lineNumber === first ? "novelview-pending-first" : "",
        lineNumber === last ? "novelview-pending-last" : "",
      ].filter(Boolean).join(" ");
      builder.add(
        line.from,
        line.from,
        Decoration.line({
          class: `novelview-pending-content novelview-pending-${block.color} ${endings}`.trim(),
        }),
      );
    }
    builder.add(
      block.closeFrom,
      block.closeTo,
      Decoration.replace({
        block: true,
        widget: new PendingCloseWidget(),
      }),
    );
  }
  return builder.finish();
}

export const pendingBlockExtension = StateField.define<DecorationSet>({
  create: buildPendingDecorations,
  update(value, transaction) {
    return transaction.docChanged ? buildPendingDecorations(transaction.state) : value;
  },
  provide: (field) => EditorView.decorations.from(field),
});

export function pendingFenceProtection(isAllowed: () => boolean) {
  return EditorState.transactionFilter.of((transaction) => {
    if (!transaction.docChanged || isAllowed()) {
      return transaction;
    }
    const blocks = parsePendingBlocks(transaction.startState);
    if (blocks.length === 0) {
      return transaction;
    }
    const ranges = blocks.flatMap((block) => [
      [Math.max(0, block.openFrom - 1), Math.min(transaction.startState.doc.length, block.openTo + 1)],
      [Math.max(0, block.closeFrom - 1), Math.min(transaction.startState.doc.length, block.closeTo + 1)],
    ]);
    let blocked = false;
    transaction.changes.iterChanges((fromA, toA) => {
      if (ranges.some(([from, to]) => fromA < to && toA > from)) {
        blocked = true;
      }
    });
    return blocked ? [] : transaction;
  });
}


export const pendingBoundaryKeymap = Prec.highest(keymap.of([
  {
    key: "Backspace",
    run: (view) => {
      const selection = view.state.selection.main;
      if (!selection.empty) {
        return false;
      }
      for (const block of parsePendingBlocks(view.state)) {
        if (block.contentStartLine > block.contentEndLine) {
          continue;
        }
        const start = view.state.doc.line(block.contentStartLine).from;
        if (selection.head === start) {
          return true;
        }
      }
      return false;
    },
  },
  {
    key: "Delete",
    run: (view) => {
      const selection = view.state.selection.main;
      if (!selection.empty) {
        return false;
      }
      for (const block of parsePendingBlocks(view.state)) {
        if (block.contentStartLine > block.contentEndLine) {
          continue;
        }
        const end = view.state.doc.line(block.contentEndLine).to;
        if (selection.head === end) {
          return true;
        }
      }
      return false;
    },
  },
]));
