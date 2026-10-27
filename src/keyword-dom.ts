import {
  findKeywordMatches,
  type KeywordEntry,
} from "./core/keywords";

/** Wrap setting/character keywords in an already rendered Markdown block. */
export function linkKeywordsInElement(
  element: HTMLElement,
  entries: KeywordEntry[],
): number {
  if (entries.length === 0) {
    return 0;
  }

  const walker = document.createTreeWalker(
    element,
    NodeFilter.SHOW_TEXT,
  );
  const textNodes: Text[] = [];

  while (walker.nextNode()) {
    const node = walker.currentNode as Text;
    const parent = node.parentElement;
    if (
      !parent
      || !node.nodeValue
      || !node.nodeValue.trim()
      || parent.closest(
        "a, code, pre, script, style, mark, .metadata-container, .frontmatter, .novelview-keyword-link",
      )
    ) {
      continue;
    }
    textNodes.push(node);
  }

  let count = 0;
  for (const node of textNodes) {
    const value = node.nodeValue ?? "";
    const matches = findKeywordMatches(value, entries);
    if (matches.length === 0) {
      continue;
    }

    const fragment = document.createDocumentFragment();
    let cursor = 0;
    for (const match of matches) {
      if (match.start > cursor) {
        fragment.appendChild(
          document.createTextNode(value.slice(cursor, match.start)),
        );
      }
      const link = document.createElement("a");
      link.className = [
        "novelview-keyword-link",
        `novelview-keyword-${match.entry.category ?? "setting"}`,
      ].join(" ");
      link.setAttribute("href", "#");
      link.setAttribute("data-novelview-path", match.entry.path);
      link.setAttribute("data-novelview-line", String(match.entry.line ?? 1));
      link.setAttribute("data-novelview-category", match.entry.category ?? "setting");
      link.setAttribute("title", `打开 ${match.entry.heading ?? match.entry.basename}`);
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
