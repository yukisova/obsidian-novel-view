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
  for (const node of textNodes) {
    const value = node.nodeValue ?? "";
    const matches = findLinkKeywordMatches(value, entries);
    if (matches.length === 0) {
      continue;
    }

    const fragment = createFragment();
    let cursor = 0;
    for (const match of matches) {
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
          title: `打开 ${match.entry.basename}`,
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
