import assert from "node:assert/strict";
import { test } from "node:test";
import {
  classifyLine,
  findFrontmatterEnd,
  hasFrontmatterBlock,
  isMarkdownSpecialLine,
  isProseLine,
  isSpecialBlockLine,
} from "../.test-build/paragraphs.mjs";
import { compareFilesNaturally } from "../.test-build/format-utils.mjs";
import {
  DEFAULT_LINK_GROUP,
  findLinkKeywordMatches,
  getLinkGroupTags,
  getLinkKeywordEntries,
  parseLinkLibrary,
  serializeLinkLibrary,
} from "../.test-build/link-library.mjs";
import {
  compileSearchExpression,
  findSearchMatches,
  replaceSearchMatches,
} from "../.test-build/search.mjs";
import { formatNovelMarkdown } from "../.test-build/format.mjs";
import {
  createNovelConfigContent,
  getNovelConfigPath,
  isNovelConfigFile,
  normalizeCoverPath,
  parseNovelConfig,
  serializeNovelConfig,
} from "../.test-build/novel-config.mjs";
import { countNovelCharacters } from "../.test-build/status.mjs";
import { parseChapterStatus } from "../.test-build/chapter-status.mjs";
import {
  DEFAULT_SETTINGS,
  normalizeSettings,
} from "../.test-build/settings.mjs";

test("recognizes ordinary Chinese prose", () => {
  assert.equal(isProseLine("夜雨落在青石板上，沿街的灯一盏接一盏地暗下去。"), true);
  assert.equal(isProseLine("第一章　风从旧巷来"), true);
  assert.equal(isProseLine("***"), false);
  assert.equal(isProseLine("   "), false);
});

test("skips Markdown block syntax", () => {
  const special = [
    "# 第一章",
    "###### 小节",
    "> 引用",
    "- 列表项",
    "1. 编号项",
    "```ts",
    "~~~",
    "---",
    "***",
    "| 列一 | 列二 |",
    "<div>",
    "[^1]: 脚注",
    "%% 注释",
    "![[封面.png]]",
    "$$ 数学 $$",
    "    indented code",
    "\tcode",
  ];

  for (const line of special) {
    assert.equal(isMarkdownSpecialLine(line), true, line);
    assert.equal(isProseLine(line), false, line);
  }
});

test("does not mistake inline emphasis for a block marker", () => {
  assert.equal(isProseLine("**强调**不是列表。"), true);
  assert.equal(isProseLine("*强调*不是列表。"), true);
  assert.equal(isProseLine("#话题不是标题"), true);
});

test("marks the first, middle, and last prose line of a paragraph", () => {
  assert.deepEqual(
    classifyLine("第一行", null, "第二行"),
    { prose: true, paragraphStart: true, paragraphEnd: false },
  );
  assert.deepEqual(
    classifyLine("第二行", "第一行", "第三行"),
    { prose: true, paragraphStart: false, paragraphEnd: false },
  );
  assert.deepEqual(
    classifyLine("第三行", "第二行", null),
    { prose: true, paragraphStart: false, paragraphEnd: true },
  );
});

test("blank and special lines delimit paragraphs", () => {
  assert.deepEqual(
    classifyLine("正文", "", "正文二"),
    { prose: true, paragraphStart: true, paragraphEnd: false },
  );
  assert.deepEqual(
    classifyLine("正文", "# 标题", null),
    { prose: true, paragraphStart: true, paragraphEnd: true },
  );
  assert.deepEqual(
    classifyLine("# 标题", null, "正文"),
    { prose: false, paragraphStart: false, paragraphEnd: false },
  );
});

test("detects a closed YAML frontmatter block", () => {
  const lines = ["---", "title: 夜航", "tags: [小说]", "---", "", "正文"];
  assert.equal(findFrontmatterEnd((index) => lines[index] ?? null), 4);
});

test("ignores text that is not frontmatter or is unclosed", () => {
  assert.equal(
    findFrontmatterEnd((index) => ["正文", "---"][index] ?? null),
    0,
  );
  assert.equal(
    findFrontmatterEnd((index) => ["---", "title: 未闭合"][index] ?? null),
    0,
  );
  assert.equal(
    findFrontmatterEnd((index) => ["---", "a: 1", "..."][index] ?? null),
    3,
  );
});

test("normalizes typography values and mode flags", () => {
  const settings = normalizeSettings({
    firstLineIndent: 12,
    lineHeight: 9,
    paragraphSpacing: -3,
    paragraphMode: "blank-line",
    hideMarkdownMarkers: false,
    hideLineNumbers: 1,
  });

  assert.equal(settings.firstLineIndent, 8);
  assert.equal(settings.lineHeight, 2.4);
  assert.equal(settings.paragraphSpacing, 0);
  assert.equal(settings.paragraphMode, "blank-line");
  assert.equal(settings.hideMarkdownMarkers, false);
  assert.equal(settings.hideLineNumbers, DEFAULT_SETTINGS.hideLineNumbers);
});

test("falls back to line-based paragraphs for malformed settings", () => {
  const settings = normalizeSettings({
    firstLineIndent: "two",
    lineHeight: Number.NaN,
    paragraphMode: "chapters",
  });

  assert.equal(settings.firstLineIndent, 2);
  assert.equal(settings.lineHeight, 1.8);
  assert.equal(settings.paragraphMode, "line");
});


test("detects Properties/frontmatter blocks in raw Markdown", () => {
  assert.equal(
    hasFrontmatterBlock("---\nnovelview-type: setting\n---\n\n正文"),
    true,
  );
  assert.equal(
    hasFrontmatterBlock("\ufeff---\r\ntitle: 夜航\r\n...\r\n正文"),
    true,
  );
  assert.equal(hasFrontmatterBlock("正文\n---\n不是属性"), false);
  assert.equal(hasFrontmatterBlock("---\n未闭合的属性"), false);
  assert.equal(hasFrontmatterBlock(""), false);
});

test("sorts chapter-like names naturally", () => {
  const files = [
    { basename: "第10章", path: "小说/第10章.md" },
    { basename: "第2章", path: "小说/第2章.md" },
    { basename: "第1章", path: "小说/第1章.md" },
  ];
  files.sort(compareFilesNaturally);
  assert.deepEqual(files.map((file) => file.basename), [
    "第1章",
    "第2章",
    "第10章",
  ]);
});

test("compiles literal, case-sensitive, whole-word, and regex searches", () => {
  const literal = compileSearchExpression({
    query: "夜雨",
    caseSensitive: false,
    wholeWord: false,
    regex: false,
  });
  assert.equal(literal.error, null);
  assert.equal(literal.regex?.test("夜雨"), true);

  const escaped = compileSearchExpression({
    query: "a+b",
    caseSensitive: true,
    wholeWord: false,
    regex: false,
  });
  assert.equal(escaped.regex?.test("a+b"), true);
  assert.equal(escaped.regex?.test("aab"), false);

  const regex = compileSearchExpression({
    query: "第[0-9]+章",
    caseSensitive: true,
    wholeWord: false,
    regex: true,
  });
  assert.equal(regex.regex?.test("第12章"), true);
});

test("rejects invalid and empty-matching regular expressions", () => {
  const invalid = compileSearchExpression({
    query: "(",
    caseSensitive: false,
    wholeWord: false,
    regex: true,
  });
  assert.match(invalid.error ?? "", /正则表达式无效/);

  const empty = compileSearchExpression({
    query: "a*",
    caseSensitive: false,
    wholeWord: false,
    regex: true,
  });
  assert.match(empty.error ?? "", /空字符串/);
});

test("finds positions and context across lines", () => {
  const text = "第一行\n夜雨落在青石板上。\n最后一行";
  const compiled = compileSearchExpression({
    query: "青石板",
    caseSensitive: false,
    wholeWord: false,
    regex: false,
  });
  assert.ok(compiled.regex);
  const result = findSearchMatches(text, compiled.regex, 10);
  assert.equal(result.truncated, false);
  assert.equal(result.matches.length, 1);
  assert.equal(result.matches[0].line, 2);
  assert.equal(result.matches[0].column, 5);
  assert.equal(result.matches[0].offset, text.indexOf("青石板"));
  assert.equal(result.matches[0].matchText, "青石板");
});

test("honours case sensitivity and whole-word matching", () => {
  const insensitive = compileSearchExpression({
    query: "Novel",
    caseSensitive: false,
    wholeWord: false,
    regex: false,
  });
  assert.ok(insensitive.regex);
  assert.equal(findSearchMatches("novel Novel", insensitive.regex).matches.length, 2);

  const whole = compileSearchExpression({
    query: "cat",
    caseSensitive: true,
    wholeWord: true,
    regex: false,
  });
  assert.ok(whole.regex);
  assert.equal(findSearchMatches("cat concatenate cat.", whole.regex).matches.length, 2);
});

test("replaces literal text without expanding dollar signs", () => {
  const compiled = compileSearchExpression({
    query: "old",
    caseSensitive: true,
    wholeWord: false,
    regex: false,
  });
  assert.ok(compiled.regex);
  const result = replaceSearchMatches("old old", compiled.regex, "$1literal", false);
  assert.equal(result.count, 2);
  assert.equal(result.text, "$1literal $1literal");
});

test("regex replacement supports capture groups", () => {
  const compiled = compileSearchExpression({
    query: "第([0-9]+)章",
    caseSensitive: true,
    wholeWord: false,
    regex: true,
  });
  assert.ok(compiled.regex);
  const result = replaceSearchMatches("第1章 第22章", compiled.regex, "[第$1章]", true);
  assert.equal(result.count, 2);
  assert.equal(result.text, "[第1章] [第22章]");
});


test("caps matches and reports truncation", () => {
  const compiled = compileSearchExpression({
    query: "cat",
    caseSensitive: true,
    wholeWord: true,
    regex: false,
  });
  assert.ok(compiled.regex);

  const many = findSearchMatches("cat cat cat cat", compiled.regex, 3);
  assert.equal(many.matches.length, 3);
  assert.equal(many.truncated, true);

  const exact = findSearchMatches("cat cat cat", compiled.regex, 3);
  assert.equal(exact.matches.length, 3);
  assert.equal(exact.truncated, false);
});


test("formats prose while preserving frontmatter and fenced code", () => {
  const input = [
    "---",
    "novelview-type: setting",
    "---",
    "",
    "",
    "第一段   ",
    "",
    "",
    "",
    "第二段",
    "",
  ].join("\n");

  const result = formatNovelMarkdown(input);
  assert.equal(result.changed, true);
  assert.equal(result.trimmedLines, 1);
  assert.match(result.text, /^---\nnovelview-type: setting\n---\n第一段\n第二段\n$/u);

  const code = [
    "正文",
    "",
    "```ts",
    "const x = 1;   ",
    "",
    "",
    "```",
    "",
    "",
    "",
    "结束   ",
    "",
  ].join("\n");
  const codeResult = formatNovelMarkdown(code);
  assert.match(codeResult.text, /const x = 1;   \n```/u);
  assert.match(codeResult.text, /```\n结束\n$/u);
});

test("adds blank lines around separators, lists, quotes, and tables", () => {
  const input = [
    "第一段",
    "",
    "---",
    "",
    "第二段",
    "",
    "- 一",
    "- 二",
    "",
    "> 引用",
    "",
    "| A | B |",
    "| --- | --- |",
    "| 1 | 2 |",
    "",
    "第三段",
  ].join("\n");
  const expected = [
    "第一段",
    "",
    "---",
    "",
    "第二段",
    "",
    "- 一",
    "- 二",
    "",
    "> 引用",
    "",
    "| A | B |",
    "| --- | --- |",
    "| 1 | 2 |",
    "",
    "第三段",
  ].join("\n");
  assert.equal(formatNovelMarkdown(input).text, expected);
});

test("short-circuits already formatted text and preserves BOM", () => {
  const already = "第一段\n第二段\n";
  assert.equal(formatNovelMarkdown(already).changed, false);

  const bom = "\uFEFF第一段   \n";
  const result = formatNovelMarkdown(bom);
  assert.equal(result.text, "\uFEFF第一段\n");
});


test("parses and creates novel.json group settings", () => {
  const parsed = parseNovelConfig({
    "novel-description": "一场从旧城开始的漫长告别。",
    "novel-cover": "附件/cover.jpg",
    "volume-order": ["第一卷"],
    volumes: {
      "第一卷": { description: "旧城", cover: "第一卷.png" },
    },
    "article-groups": [
      {
        id: "g1",
        volume: "第一卷",
        name: "第一部分",
        description: "开篇",
        paths: ["小说/长夜将尽/第一卷/第一章.md"],
      },
    ],
  });
  assert.equal(parsed["novel-description"], "一场从旧城开始的漫长告别。");
  assert.equal(parsed["novel-cover"], "附件/cover.jpg");
  assert.equal(parsed.volumes["第一卷"].description, "旧城");
  assert.equal(parsed["article-groups"][0].name, "第一部分");

  assert.equal(getNovelConfigPath("小说/长夜将尽"), "小说/长夜将尽/novel.json");
  assert.equal(getNovelConfigPath(""), "novel.json");
  assert.equal(isNovelConfigFile({ name: "novel.json", path: "a/novel.json" }), true);
  assert.equal(isNovelConfigFile({ name: "NovelSetting.md", path: "a/NovelSetting.md" }), false);

  const content = createNovelConfigContent();
  const created = parseNovelConfig(JSON.parse(content));
  assert.equal(created["novel-description"], "");
  assert.deepEqual(created["article-groups"], []);
  assert.equal(serializeNovelConfig(created), content);
  assert.equal(normalizeCoverPath("[[cover.png|封面]]"), "cover.png");
  assert.equal(normalizeCoverPath("![封面](assets/cover.png)"), "assets/cover.png");
});


test("parses novel states and counts body characters", () => {
  assert.equal(parseChapterStatus("待写"), "todo");
  assert.equal(parseChapterStatus("草稿"), "draft");
  assert.equal(parseChapterStatus("大纲"), "outline");
  assert.equal(parseChapterStatus("修改中"), "revising");
  assert.equal(parseChapterStatus("已完稿"), "done");
  assert.equal(parseChapterStatus("unknown"), "todo");

  assert.equal(
    countNovelCharacters("---\nnovelstate: 写作\n---\n\n第一段 文字\n\n第二段"),
    8,
  );
});


test("identifies list, quote, and callout lines as native blocks", () => {
  assert.equal(isSpecialBlockLine("- 第一项"), true);
  assert.equal(isSpecialBlockLine("1. 第一项"), true);
  assert.equal(isSpecialBlockLine("> 引用"), true);
  assert.equal(isSpecialBlockLine("> [!note] 提示"), true);
  assert.equal(isSpecialBlockLine("普通正文"), false);
  assert.equal(isSpecialBlockLine("# 标题"), false);
});




test("keeps tags for the default link group", () => {
  const data = parseLinkLibrary({
    group: {},
    tag: {},
    link: [
      { "未命名.md": { tag: "标签A", alias: ["别名"] } },
    ],
  });
  data.tags[DEFAULT_LINK_GROUP] = { "标签A": "#e5484d" };
  const roundtrip = parseLinkLibrary(JSON.parse(serializeLinkLibrary(data)));
  assert.equal(roundtrip.links[0].tag, "标签A");
  assert.deepEqual(getLinkGroupTags(roundtrip, DEFAULT_LINK_GROUP), ["标签A"]);
});

test("aliases replace file names and keyword entries are unique", () => {
  const data = parseLinkLibrary({
    group: {},
    tag: {},
    link: [
      { "甲.md": { alias: ["共同别名"] } },
      { "乙.md": { alias: ["共同别名"] } },
      { "丙.md": {} },
    ],
  });
  const entries = getLinkKeywordEntries(data);
  const keywords = entries.map((entry) => entry.keyword);
  assert.equal(keywords.filter((keyword) => keyword === "共同别名").length, 1);
  assert.equal(keywords.includes("甲"), false);
  assert.equal(keywords.includes("乙"), false);
  assert.equal(keywords.includes("丙"), true);
});


test("does not keep duplicate linked file paths", () => {
  const data = parseLinkLibrary({
    group: {},
    tag: {},
    link: [
      { "同一文件.md": { alias: ["别名一"] } },
      { "同一文件.md": { alias: ["别名二"] } },
    ],
  });
  assert.equal(data.links.length, 1);
});
