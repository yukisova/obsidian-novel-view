import {
  findLinkKeywordMatches,
  type LinkKeywordEntry,
} from "./core/link-library";

export function linkKeywordsInElement(
  element: HTMLElement,
  entries: LinkKeywordEntry[],
): number {
  if (entries.length === 0) {
    return 0;
  }

  const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
  const textNodes: Text[] = [];
  while (walker.nextNode()) {
    const node = walker.currentNode as Text;
    const parent = node.parentElement;
    if (
      !parent
      || !node.nodeValue
      || !node.nodeValue.trim()
      || parent.closest(
        "a, code, pre, script, style, mark, .metadata-container, .frontmatter, .novelview-link-keyword",
      )
    ) {
      continue;
    }
    textNodes.push(node);
  }

  let count = 0;
  const seen = new Set<string>();
  for (const node of textNodes) {
    const value = node.nodeValue ?? "";
    const matches = findLinkKeywordMatches(value, entries);
    if (matches.length === 0) {
      continue;
    }

    const fragment = createFragment();
    let cursor = 0;
    for (const match of matches) {
      const normalized = match.entry.keyword.toLocaleLowerCase();
      if (seen.has(normalized)) {
        continue;
      }
      seen.add(normalized);
      if (match.start > cursor) {
        fragment.appendChild(
          document.createTextNode(value.slice(cursor, match.start)),
        );
      }
      const link = createEl("span", {
        cls: "novelview-link-keyword",
        attr: {
          role: "link",
          tabindex: "0",
          "data-novelview-link-path": match.entry.path,
          "data-novelview-link-name": match.entry.basename,
          "data-novelview-link-tag": match.entry.tag,
          "data-novelview-link-group": match.entry.group,
        },
      });
      link.setAttr("style", `color: ${match.entry.color};`);
      link.textContent = value.slice(match.start, match.end);
      fragment.appendChild(link);
      count += 1;
      cursor = match.end;
    }
    if (cursor < value.length) {
      fragment.appendChild(document.createTextNode(value.slice(cursor)));
    }
    node.parentNode?.replaceChild(fragment, node);
  }

  return count;
}
