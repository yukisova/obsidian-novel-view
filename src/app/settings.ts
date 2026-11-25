export type ParagraphMode = "line" | "blank-line";

export interface NovelViewSettings {
  /** First-line indent in full-width character widths (em). */
  firstLineIndent: number;
  /** Visual line height for prose. */
  lineHeight: number;
  /** Extra blank space after each paragraph, in em. */
  paragraphSpacing: number;
  /** Whether each non-empty line is its own paragraph. */
  paragraphMode: ParagraphMode;
  /** Hide standard Markdown formatting markers while in novel mode. */
  hideMarkdownMarkers: boolean;
  /** Hide the native line-number gutter while in novel mode. */
  hideLineNumbers: boolean;
}

export const DEFAULT_SETTINGS: NovelViewSettings = {
  firstLineIndent: 2,
  lineHeight: 1.8,
  paragraphSpacing: 0.65,
  paragraphMode: "line",
  hideMarkdownMarkers: true,
  hideLineNumbers: true,
};

const MAX_FIRST_LINE_INDENT = 8;
const MIN_LINE_HEIGHT = 1.2;
const MAX_LINE_HEIGHT = 2.4;
const MAX_PARAGRAPH_SPACING = 2;

export function normalizeSettings(value: unknown): NovelViewSettings {
  const source = isRecord(value) ? value : {};

  return {
    firstLineIndent: normalizeNumber(
      source.firstLineIndent,
      DEFAULT_SETTINGS.firstLineIndent,
      0,
      MAX_FIRST_LINE_INDENT,
      1,
    ),
    lineHeight: normalizeNumber(
      source.lineHeight,
      DEFAULT_SETTINGS.lineHeight,
      MIN_LINE_HEIGHT,
      MAX_LINE_HEIGHT,
      0.05,
    ),
    paragraphSpacing: normalizeNumber(
      source.paragraphSpacing,
      DEFAULT_SETTINGS.paragraphSpacing,
      0,
      MAX_PARAGRAPH_SPACING,
      0.1,
    ),
    paragraphMode: source.paragraphMode === "blank-line"
      ? "blank-line"
      : DEFAULT_SETTINGS.paragraphMode,
    hideMarkdownMarkers: typeof source.hideMarkdownMarkers === "boolean"
      ? source.hideMarkdownMarkers
      : DEFAULT_SETTINGS.hideMarkdownMarkers,
    hideLineNumbers: typeof source.hideLineNumbers === "boolean"
      ? source.hideLineNumbers
      : DEFAULT_SETTINGS.hideLineNumbers,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function normalizeNumber(
  value: unknown,
  fallback: number,
  min: number,
  max: number,
  step: number,
): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return fallback;
  }

  const stepped = Math.round(value / step) * step;
  return Number(Math.min(max, Math.max(min, stepped)).toFixed(2));
}
