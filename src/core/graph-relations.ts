import {
  graphEdgeKey,
  parseGraphLayout,
  parseGraphNodes,
  parseGraphSource,
  serializeGraphLayout,
  type GraphRelation,
} from "./setting-special-data";

export const GRAPH_RELATION_INDEX = ".novelview-graph-relations.json";

export function canonicalRelationKey(relation: GraphRelation): string {
  return graphEdgeKey(relation);
}

export function parseCanonicalRelations(source: unknown): GraphRelation[] {
  if (!Array.isArray(source)) {
    return [];
  }
  const result: GraphRelation[] = [];
  for (const item of source) {
    if (!item || typeof item !== "object") {
      continue;
    }
    const record = item as Record<string, unknown>;
    const from = typeof record.from === "string" ? record.from.trim() : "";
    const to = typeof record.to === "string" ? record.to.trim() : "";
    const label = typeof record.label === "string" && record.label.trim()
      ? record.label.trim()
      : "关系";
    if (!from || !to) {
      continue;
    }
    const relation: GraphRelation = {
      from,
      to,
      label,
      twoWay: record.twoWay === true,
    };
    const key = canonicalRelationKey(relation);
    if (!result.some((entry) => canonicalRelationKey(entry) === key)) {
      result.push(relation);
    }
  }
  return result;
}

export function mergeCanonicalRelations(
  target: Map<string, GraphRelation>,
  relations: GraphRelation[],
): boolean {
  let changed = false;
  for (const relation of relations) {
    const key = canonicalRelationKey(relation);
    if (!target.has(key)) {
      target.set(key, relation);
      changed = true;
    }
  }
  return changed;
}

export function renameGraphNodeInSource(
  text: string,
  oldName: string,
  newName: string,
): string {
  const lines = text.split(/\r?\n/u).map((line) => {
    const match = /^(\s*)[-*]\s+(.+)$/u.exec(line);
    if (!match) {
      return line;
    }
    const relation = parseGraphSource(line)[0];
    if (relation) {
      if (relation.from !== oldName && relation.to !== oldName) {
        return line;
      }
      return `${match[1] ?? ""}- ${
        relation.from === oldName ? newName : relation.from
      } ${relation.twoWay ? "<->" : "->"} ${
        relation.to === oldName ? newName : relation.to
      } | ${relation.label}`;
    }
    if (parseGraphNodes(line)[0] === oldName) {
      return `${match[1] ?? ""}- ${newName}`;
    }
    return line;
  });
  let next = lines.join("\n");
  const layout = parseGraphLayout(text);
  let layoutChanged = false;
  if (layout.nodes[oldName]) {
    layout.nodes[newName] = layout.nodes[oldName];
    delete layout.nodes[oldName];
    layoutChanged = true;
  }
  if (layout.containers[oldName]) {
    layout.containers[newName] = layout.containers[oldName];
    delete layout.containers[oldName];
    layoutChanged = true;
  }
  for (const container of Object.values(layout.containers)) {
    const members = container.members.map((member) => (
      member === oldName ? newName : member
    ));
    if (members.some((member, index) => member !== container.members[index])) {
      container.members = members;
      layoutChanged = true;
    }
  }
  const curves: Record<string, number> = {};
  for (const [key, curve] of Object.entries(layout.curves)) {
    const parts = key.split("\u0000");
    if (parts[0] === oldName) {
      parts[0] = newName;
    }
    if (parts[1] === oldName) {
      parts[1] = newName;
    }
    curves[parts.join("\u0000")] = curve;
    if (parts[0] === newName || parts[1] === newName) {
      layoutChanged = layoutChanged
        || key !== parts.join("\u0000");
    }
  }
  if (layoutChanged) {
    layout.curves = curves;
    next = serializeGraphLayout(next, layout);
  }
  return next;
}

export function appendGraphRelationLine(
  text: string,
  relation: GraphRelation,
): string {
  return `${text.trimEnd()}\n\n- ${relation.from} ${
    relation.twoWay ? "<->" : "->"
  } ${relation.to} | ${relation.label}\n`;
}
