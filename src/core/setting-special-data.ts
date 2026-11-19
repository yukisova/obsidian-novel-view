import type { SettingSpecialFileKind } from "./setting-collection";

export interface TimelineEntry {
  time: string;
  start: string;
  end: string;
  track: string;
  title: string;
  description: string;
}

export interface GraphRelation {
  from: string;
  to: string;
  label: string;
  twoWay: boolean;
}

export interface BranchNode {
  text: string;
  children: BranchNode[];
}

function sourceLines(text: string): string[] {
  return text
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("#"));
}

export function parseTimelineSource(text: string): TimelineEntry[] {
  const entries: TimelineEntry[] = [];
  for (const line of sourceLines(text)) {
    const item = /^[-*]\s+(.+)$/u.exec(line)?.[1]?.trim();
    if (!item) {
      continue;
    }
    const parts = item.split("|").map((part) => part.trim());
    const range = parts[0] ?? "";
    const [start = "", end = ""] = range.split(/\s*(?:~|->)\s*/u);
    entries.push({
      time: range,
      start: start || end,
      end: end || start,
      track: parts[3] ?? "",
      title: parts[1] || range || "未命名事件",
      description: parts[2] ?? "",
    });
  }
  return entries;
}

export function parseGraphSource(text: string): GraphRelation[] {
  const relations: GraphRelation[] = [];
  for (const line of sourceLines(text)) {
    const item = /^[-*]\s+(.+)$/u.exec(line)?.[1]?.trim();
    if (!item) {
      continue;
    }
    const match = /^(.+?)\s*(<->|->)\s*(.+?)(?:\s*\|\s*(.*))?$/u.exec(item);
    if (!match) {
      continue;
    }
    const from = match[1]?.trim() ?? "";
    const to = match[3]?.trim() ?? "";
    if (!from || !to) {
      continue;
    }
    relations.push({
      from,
      to,
      label: match[4]?.trim() || "关系",
      twoWay: match[2] === "<->",
    });
  }
  return relations;
}

export function parseBranchSource(text: string): BranchNode[] {
  const roots: BranchNode[] = [];
  const stack: Array<{ indent: number; node: BranchNode }> = [];
  for (const raw of text.split(/\r?\n/u)) {
    if (!raw.trim() || raw.trim().startsWith("#")) {
      continue;
    }
    const match = /^(\s*)[-*]\s+(.+)$/u.exec(raw);
    if (!match) {
      continue;
    }
    const indent = match[1]?.replace(/\t/gu, "  ").length ?? 0;
    const node: BranchNode = { text: match[2]?.trim() ?? "", children: [] };
    while (stack.length > 0 && (stack.at(-1)?.indent ?? 0) >= indent) {
      stack.pop();
    }
    const parent = stack.at(-1)?.node;
    if (parent) {
      parent.children.push(node);
    } else {
      roots.push(node);
    }
    stack.push({ indent, node });
  }
  return roots;
}

export function settingSpecialTemplate(
  kind: SettingSpecialFileKind,
  title: string,
): string {
  switch (kind) {
    case "detail":
      return `# ${title}\n\n`;
    case "line":
      return [
        `# ${title}`,
        "",
        "<!-- 每行格式：- 时间 | 事件 | 描述 -->",
        "- 第一天 | 新事件 | 描述",
        "",
      ].join("\n");
    case "graph":
      return [
        `# ${title}`,
        "",
        "<!-- 每行格式：- 节点A -> 节点B | 关系；双向使用 <-> -->",
        "- 节点A -> 节点B | 关系",
        "",
      ].join("\n");
    case "branch":
      return [
        `# ${title}`,
        "",
        "<!-- 使用缩进表示层级 -->",
        "- 起点",
        "  - 分支一",
        "  - 分支二",
        "",
      ].join("\n");
  }
}

export interface GraphLayoutPoint {
  x: number;
  y: number;
}

export interface GraphContainer {
  width: number;
  height: number;
  members: string[];
}

export interface GraphLayout {
  nodes: Record<string, GraphLayoutPoint>;
  curves: Record<string, number>;
  containers: Record<string, GraphContainer>;
  board: { width: number; height: number };
}

export const GRAPH_DEFAULT_WIDTH = 700;
export const GRAPH_DEFAULT_HEIGHT = 520;

const GRAPH_LAYOUT_PATTERN = /<!--\s*novelview-graph-layout:\s*(\{[\s\S]*?\})\s*-->/u;

export function graphEdgeKey(relation: GraphRelation): string {
  return [
    relation.from,
    relation.to,
    relation.label,
    relation.twoWay ? "two-way" : "one-way",
  ].join("\u0000");
}

export function parseGraphLayout(text: string): GraphLayout {
  const layout: GraphLayout = {
    nodes: {},
    curves: {},
    containers: {},
    board: { width: GRAPH_DEFAULT_WIDTH, height: GRAPH_DEFAULT_HEIGHT },
  };
  const match = GRAPH_LAYOUT_PATTERN.exec(text);
  if (!match?.[1]) {
    return layout;
  }
  try {
    const parsed = JSON.parse(match[1]) as {
      nodes?: Record<string, { x?: unknown; y?: unknown }>;
      curves?: Record<string, unknown>;
      containers?: Record<string, {
        width?: unknown;
        height?: unknown;
        members?: unknown[];
      }>;
      board?: { width?: unknown; height?: unknown };
    };
    const hasBoard = Boolean(parsed.board);
    const boardWidth = Math.max(300, Number(parsed.board?.width) || GRAPH_DEFAULT_WIDTH);
    const boardHeight = Math.max(240, Number(parsed.board?.height) || GRAPH_DEFAULT_HEIGHT);
    layout.board = { width: boardWidth, height: boardHeight };
    for (const [name, point] of Object.entries(parsed.nodes ?? {})) {
      const x = Number(point?.x);
      const y = Number(point?.y);
      if (Number.isFinite(x) && Number.isFinite(y)) {
        layout.nodes[name] = hasBoard
          ? {
            x: Math.min(boardWidth - 20, Math.max(20, x)),
            y: Math.min(boardHeight - 20, Math.max(20, y)),
          }
          : {
            x: Math.min(boardWidth - 20, Math.max(20, x * boardWidth)),
            y: Math.min(boardHeight - 20, Math.max(20, y * boardHeight)),
          };
      }
    }
    for (const [key, value] of Object.entries(parsed.curves ?? {})) {
      const curve = Number(value);
      if (Number.isFinite(curve)) {
        layout.curves[key] = Math.min(1.5, Math.max(-1.5, curve));
      }
    }
    for (const [name, value] of Object.entries(parsed.containers ?? {})) {
      const width = Number(value?.width);
      const height = Number(value?.height);
      const members = Array.isArray(value?.members)
        ? value.members.filter((member): member is string => (
          typeof member === "string" && member !== name
        ))
        : [];
      if (Number.isFinite(width) && Number.isFinite(height)) {
        layout.containers[name] = {
          width: Math.max(80, width),
          height: Math.max(60, height),
          members,
        };
      }
    }
  } catch {
    return layout;
  }
  return layout;
}

export function serializeGraphLayout(text: string, layout: GraphLayout): string {
  const marker = `<!-- novelview-graph-layout: ${JSON.stringify(layout)} -->`;
  if (GRAPH_LAYOUT_PATTERN.test(text)) {
    return text.replace(GRAPH_LAYOUT_PATTERN, marker);
  }
  return `${text.trimEnd()}\n\n${marker}\n`;
}

function relationLineKey(line: string): string | null {
  const relation = parseGraphSource(line)[0];
  return relation ? graphEdgeKey(relation) : null;
}

export function removeGraphRelation(
  text: string,
  relation: GraphRelation,
): string {
  const target = graphEdgeKey(relation);
  let removed = false;
  const lines = text.split(/\r?\n/u).filter((line) => {
    if (removed || relationLineKey(line) !== target) {
      return true;
    }
    removed = true;
    return false;
  });
  let next = lines.join("\n");
  if (!removed) {
    return text;
  }
  if (GRAPH_LAYOUT_PATTERN.test(text)) {
    const layout = parseGraphLayout(text);
    if (!parseGraphSource(next).some((relation) => (
      graphEdgeKey(relation) === target
    ))) {
      delete layout.curves[target];
    }
    next = serializeGraphLayout(next, layout);
  }
  return next;
}

export function removeGraphNode(text: string, name: string): string {
  const lines = text.split(/\r?\n/u).filter((line) => {
    const relation = parseGraphSource(line)[0];
    if (relation) {
      return relation.from !== name && relation.to !== name;
    }
    const node = parseGraphNodes(line)[0];
    return node !== name;
  });
  let next = lines.join("\n");
  if (GRAPH_LAYOUT_PATTERN.test(text)) {
    const layout = parseGraphLayout(text);
    delete layout.nodes[name];
    delete layout.containers[name];
    for (const container of Object.values(layout.containers)) {
      container.members = container.members.filter((member) => member !== name);
    }
    for (const key of Object.keys(layout.curves)) {
      const [from, to] = key.split("\u0000");
      if (from === name || to === name) {
        delete layout.curves[key];
      }
    }
    next = serializeGraphLayout(next, layout);
  }
  return next;
}

export type TimelineOrientation = "vertical" | "horizontal";

const TIMELINE_ORIENTATION_PATTERN =
  /<!--\s*novelview-timeline-orientation:\s*(vertical|horizontal)\s*-->/u;

export function parseTimelineOrientation(text: string): TimelineOrientation {
  return TIMELINE_ORIENTATION_PATTERN.exec(text)?.[1] === "vertical"
    ? "vertical"
    : "horizontal";
}

export function serializeTimelineOrientation(
  text: string,
  orientation: TimelineOrientation,
): string {
  const marker = `<!-- novelview-timeline-orientation: ${orientation} -->`;
  if (TIMELINE_ORIENTATION_PATTERN.test(text)) {
    return text.replace(TIMELINE_ORIENTATION_PATTERN, marker);
  }
  return `${text.trimEnd()}\n\n${marker}\n`;
}

interface BranchLine {
  indent: number;
  text: string;
  index: number;
}

function parseBranchLines(lines: string[]): BranchLine[] {
  const result: BranchLine[] = [];
  lines.forEach((line, index) => {
    const match = /^(\s*)[-*]\s+(.+)$/u.exec(line);
    if (!match) {
      return;
    }
    result.push({
      index,
      indent: (match[1] ?? "").replace(/\t/gu, "  ").length,
      text: (match[2] ?? "").trim(),
    });
  });
  return result;
}

export function moveBranchNode(
  text: string,
  source: string,
  target: string,
): string {
  if (source === target) {
    return text;
  }
  const lines = text.split(/\r?\n/u);
  const branchLines = parseBranchLines(lines);
  const sourceLine = branchLines.find((line) => line.text === source);
  const targetLine = branchLines.find((line) => line.text === target);
  if (!sourceLine || !targetLine) {
    return text;
  }
  let subtreeEnd = sourceLine.index + 1;
  while (subtreeEnd < lines.length) {
    const next = parseBranchLines([lines[subtreeEnd]])[0];
    if (!next) {
      if (!lines[subtreeEnd].trim()) {
        subtreeEnd += 1;
        continue;
      }
      break;
    }
    if (next.indent <= sourceLine.indent) {
      break;
    }
    subtreeEnd += 1;
  }
  if (targetLine.index >= sourceLine.index && targetLine.index < subtreeEnd) {
    return text;
  }
  const block = lines.slice(sourceLine.index, subtreeEnd);
  while (block.length > 1 && !block.at(-1)?.trim()) {
    block.pop();
  }
  const rest = [
    ...lines.slice(0, sourceLine.index),
    ...lines.slice(subtreeEnd),
  ];
  const remainingBranches = parseBranchLines(rest);
  const nextTarget = remainingBranches.find((line) => line.text === target);
  if (!nextTarget) {
    return text;
  }
  let targetSubtreeEnd = nextTarget.index + 1;
  while (targetSubtreeEnd < rest.length) {
    const next = parseBranchLines([rest[targetSubtreeEnd]])[0];
    if (!next) {
      if (!rest[targetSubtreeEnd].trim()) {
        targetSubtreeEnd += 1;
        continue;
      }
      break;
    }
    if (next.indent <= nextTarget.indent) {
      break;
    }
    targetSubtreeEnd += 1;
  }
  while (targetSubtreeEnd > 0 && !rest[targetSubtreeEnd - 1]?.trim()) {
    targetSubtreeEnd -= 1;
  }
  const shift = nextTarget.indent + 2 - sourceLine.indent;
  const moved = block.map((line) => {
    const branch = parseBranchLines([line])[0];
    if (!branch) {
      return line;
    }
    const nextIndent = Math.max(0, branch.indent + shift);
    return `${" ".repeat(nextIndent)}- ${branch.text}`;
  });
  rest.splice(targetSubtreeEnd, 0, ...moved);
  return rest.join("\n");
}

export function parseGraphNodes(text: string): string[] {
  const nodes: string[] = [];
  for (const line of sourceLines(text)) {
    const item = /^[-*]\s+(.+)$/u.exec(line)?.[1]?.trim();
    if (!item || /(<->|->)/u.test(item)) {
      continue;
    }
    if (!nodes.includes(item)) {
      nodes.push(item);
    }
  }
  return nodes;
}

export function renameGraphRelation(
  text: string,
  relation: GraphRelation,
  label: string,
): string {
  const target = graphEdgeKey(relation);
  const nextLabel = label.trim() || "关系";
  let replaced = false;
  const lines = text.split(/\r?\n/u).map((line) => {
    if (replaced) {
      return line;
    }
    const match = /^(\s*)[-*]\s+(.+)$/u.exec(line);
    if (!match) {
      return line;
    }
    const parsed = parseGraphSource(line)[0];
    if (!parsed || graphEdgeKey(parsed) !== target) {
      return line;
    }
    replaced = true;
    return `${match[1] ?? ""}- ${parsed.from} ${parsed.twoWay ? "<->" : "->"} ${parsed.to} | ${nextLabel}`;
  });
  if (!replaced) {
    return text;
  }
  let next = lines.join("\n");
  if (GRAPH_LAYOUT_PATTERN.test(text)) {
    const layout = parseGraphLayout(text);
    const curve = layout.curves[target];
    delete layout.curves[target];
    if (curve !== undefined) {
      layout.curves[graphEdgeKey({ ...relation, label: nextLabel })] = curve;
    }
    next = serializeGraphLayout(next, layout);
  }
  return next;
}


export function timelineTimeMs(value: string): number | null {
  const text = value.trim();
  if (!text) {
    return null;
  }
  const date = /^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2}))?$/u.exec(text);
  if (date) {
    return Date.UTC(
      Number(date[1]),
      Number(date[2]) - 1,
      Number(date[3]),
      Number(date[4] ?? 0),
      Number(date[5] ?? 0),
    );
  }
  const clock = /^(\d{1,2}):(\d{2})$/u.exec(text);
  if (clock) {
    return (Number(clock[1]) * 60 + Number(clock[2])) * 60_000;
  }
  const number = Number(text);
  return Number.isFinite(number) ? number * 60_000 : null;
}

export function formatTimelineTime(ms: number, sample: string): string {
  const text = sample.trim();
  if (/^\d{4}-\d{2}-\d{2}/u.test(text)) {
    const date = new Date(ms);
    const day = [
      date.getUTCFullYear(),
      String(date.getUTCMonth() + 1).padStart(2, "0"),
      String(date.getUTCDate()).padStart(2, "0"),
    ].join("-");
    if (text.includes(":")) {
      return `${day} ${String(date.getUTCHours()).padStart(2, "0")}:${String(date.getUTCMinutes()).padStart(2, "0")}`;
    }
    return day;
  }
  if (/^\d{1,2}:\d{2}$/u.test(text)) {
    const total = Math.round(ms / 60_000);
    return `${String(Math.floor(total / 60) % 24).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`;
  }
  return String(Math.round(ms / 60_000));
}

export function updateTimelineEntryRange(
  text: string,
  index: number,
  start: string,
  end: string,
): string {
  const entry = parseTimelineSource(text)[index];
  if (!entry) {
    return text;
  }
  const range = start === end ? start : `${start} ~ ${end}`;
  const fields = [range, entry.title, entry.description, entry.track]
    .map((field) => field.trim())
    .filter((field, fieldIndex) => field || fieldIndex < 2);
  const replacement = `- ${fields.join(" | ")}`;
  let count = -1;
  let replaced = false;
  return text.split(/\r?\n/u).map((line) => {
    if (replaced || !/^\s*[-*]\s+/u.test(line)) {
      return line;
    }
    count += 1;
    if (count !== index) {
      return line;
    }
    replaced = true;
    return `${/^\s*/u.exec(line)?.[0] ?? ""}${replacement}`;
  }).join("\n");
}


export function removeGraphRelationsBetween(
  text: string,
  first: string,
  second: string,
): string {
  let next = text;
  const relations = parseGraphSource(text).filter((relation) => (
    (relation.from === first && relation.to === second)
    || (relation.from === second && relation.to === first)
  ));
  for (const relation of relations) {
    next = removeGraphRelation(next, relation);
  }
  return next;
}

export function deleteBranchNode(text: string, nodeText: string): string {
  const lines = text.split(/\r?\n/u);
  const nodes = parseBranchLines(lines);
  const target = nodes.find((node) => node.text === nodeText);
  if (!target) {
    return text;
  }
  let end = target.index + 1;
  while (end < lines.length) {
    const next = parseBranchLines([lines[end]])[0];
    if (!next) {
      end += 1;
      continue;
    }
    if (next.indent <= target.indent) {
      break;
    }
    end += 1;
  }
  return [...lines.slice(0, target.index), ...lines.slice(end)].join("\n");
}

export function appendBranchChild(
  text: string,
  parentText: string | null,
  childText: string,
): string {
  const lines = text.split(/\r?\n/u);
  if (!parentText) {
    return `${text.trimEnd()}\n${childText}\n`;
  }
  const nodes = parseBranchLines(lines);
  const parent = nodes.find((node) => node.text === parentText);
  if (!parent) {
    return text;
  }
  let end = parent.index + 1;
  while (end < lines.length) {
    const next = parseBranchLines([lines[end]])[0];
    if (!next) {
      end += 1;
      continue;
    }
    if (next.indent <= parent.indent) {
      break;
    }
    end += 1;
  }
  while (end > parent.index + 1 && !lines[end - 1]?.trim()) {
    end -= 1;
  }
  const indent = " ".repeat(parent.indent + 2);
  lines.splice(end, 0, `${indent}- ${childText}`);
  return lines.join("\n");
}

export function deleteTimelineEntry(text: string, index: number): string {
  let count = -1;
  const lines = text.split(/\r?\n/u);
  const next = lines.filter((line) => {
    if (!/^\s*[-*]\s+/u.test(line)) {
      return true;
    }
    count += 1;
    return count !== index;
  });
  return next.join("\n");
}
