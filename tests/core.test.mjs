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
import {
  compareFilesNaturally,
  getReferenceCategories,
  hasReferenceProperty,
  parseReferenceCategories,
} from "../.test-build/cards.mjs";
import {
  compileSearchExpression,
  findSearchMatches,
  replaceSearchMatches,
} from "../.test-build/search.mjs";
import { formatNovelMarkdown } from "../.test-build/format.mjs";
import {
  createNovelSettingContent,
  getNovelSettingPath,
  isNovelSettingFile,
  normalizeCoverPath,
  parseNovelSetting,
} from "../.test-build/novel-setting.mjs";
import {
  countNovelCharacters,
  parseNovelState,
} from "../.test-build/status.mjs";
import {
  buildKeywordEntries,
  findKeywordMatches,
  parseNovelKeywords,
} from "../.test-build/keywords.mjs";
import {
  createOutlineFileContent,
  deleteOutlineEntry,
  isOutlineFileName,
  parseOutline,
  upsertOutlineEntry,
} from "../.test-build/outline.mjs";
import {
  appendCategorySection,
  createCategoryFileContent,
  deleteCategorySection,
  getCategoryFilePath,
  isCategoryFileName,
  parseCategorySections,
  renameCategorySection,
} from "../.test-build/category-file.mjs";
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

test("parses card categories from text, lists, and Chinese aliases", () => {
  assert.deepEqual(parseReferenceCategories("setting"), ["setting"]);
  assert.deepEqual(parseReferenceCategories("时间线"), ["timeline"]);
  assert.deepEqual(parseReferenceCategories(["setting", "伏笔"]), [
    "setting",
    "foreshadowing",
  ]);
  assert.deepEqual(parseReferenceCategories("setting, timeline"), [
    "setting",
    "timeline",
  ]);
  assert.deepEqual(parseReferenceCategories("unknown"), []);
});

test("recognizes character and inspiration reference categories", () => {
  assert.deepEqual(
    getReferenceCategories({ "novelview-type": "character" }),
    ["character"],
  );
  assert.deepEqual(
    getReferenceCategories({ "novelview-type": ["人物", "灵感便签"] }),
    ["character", "inspiration"],
  );
  assert.deepEqual(
    getReferenceCategories({ "novelview-type": "角色" }),
    ["character"],
  );
});

test("finds novelview-type case-insensitively in frontmatter", () => {
  assert.deepEqual(
    getReferenceCategories({ "NovelView-Type": "timeline" }),
    ["timeline"],
  );
  assert.deepEqual(getReferenceCategories({ tags: ["小说"] }), []);
  assert.deepEqual(getReferenceCategories(undefined), []);
});

test("detects the reference property even when its value is not recognized", () => {
  assert.equal(hasReferenceProperty({ "novelview-type": "draft" }), true);
  assert.equal(hasReferenceProperty({ "NovelView-Type": "" }), true);
  assert.equal(hasReferenceProperty({ tags: ["小说"] }), false);
  assert.equal(hasReferenceProperty(undefined), false);
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

test("short-circuits already formatted text and preserves BOM", () => {
  const already = "第一段\n第二段\n";
  assert.equal(formatNovelMarkdown(already).changed, false);

  const bom = "\uFEFF第一段   \n";
  const result = formatNovelMarkdown(bom);
  assert.equal(result.text, "\uFEFF第一段\n");
});


test("parses and creates novel group settings", () => {
  const data = parseNovelSetting(
    {
      "novelview-type": "novel-setting",
      "Novel-Name": "长夜将尽",
      "novel-description": "一场从旧城开始的漫长告别。",
      "novel-cover": "![[附件/cover.jpg]]",
    },
    "小说/长夜将尽",
    "长夜将尽",
  );
  assert.equal(data.name, "长夜将尽");
  assert.equal(data.description, "一场从旧城开始的漫长告别。");
  assert.equal(data.cover, "附件/cover.jpg");
  assert.equal(data.state, "writing");

  const fallback = parseNovelSetting(undefined, "小说/无名", "无名");
  assert.equal(fallback.name, "无名");
  assert.equal(fallback.cover, "");

  assert.equal(getNovelSettingPath("小说/长夜将尽"), "小说/长夜将尽/NovelSetting.md");
  assert.equal(getNovelSettingPath(""), "NovelSetting.md");
  assert.equal(isNovelSettingFile({ basename: "NovelSetting", path: "a/NovelSetting.md", extension: "md" }), true);
  assert.equal(isNovelSettingFile({ basename: "NovelSetting", path: "a/NovelSetting.txt", extension: "txt" }), false);

  const content = createNovelSettingContent("长夜将尽");
  assert.match(content, /novelview-type: novel-setting/u);
  assert.match(content, /novel-name: "长夜将尽"/u);
  assert.equal(normalizeCoverPath("[[cover.png|封面]]"), "cover.png");
  assert.equal(normalizeCoverPath("![封面](assets/cover.png)"), "assets/cover.png");
});


test("parses novel states and counts body characters", () => {
  assert.equal(parseNovelState("写作"), "writing");
  assert.equal(parseNovelState("修改"), "revising");
  assert.equal(parseNovelState("完稿"), "finished");
  assert.equal(parseNovelState("editing"), "revising");
  assert.equal(parseNovelState("未知"), null);
  assert.equal(parseNovelState(42), null);

  assert.equal(
    countNovelCharacters("---\nnovelstate: 写作\n---\n\n第一段 文字\n\n第二段"),
    8,
  );
});


test("parses keyword properties and finds longest keyword matches", () => {
  assert.deepEqual(
    parseNovelKeywords({
      "novel-keywords": ["沈砚", "怀表"],
      "关键词": "旧城、银色怀表",
    }),
    ["沈砚", "怀表", "旧城", "银色怀表"],
  );

  const entries = buildKeywordEntries([
    {
      path: "人物/沈砚.md",
      basename: "沈砚",
      keywords: ["沈砚", "怀表"],
    },
    {
      path: "设定/怀表.md",
      basename: "怀表",
      keywords: ["银色怀表"],
    },
  ]);
  const matches = findKeywordMatches("沈砚把银色怀表放在桌上。", entries);
  assert.deepEqual(matches.map((match) => match.entry.basename), ["沈砚", "怀表"]);
  assert.equal(matches[1].entry.path, "设定/怀表.md");
});


test("identifies list, quote, and callout lines as native blocks", () => {
  assert.equal(isSpecialBlockLine("- 第一项"), true);
  assert.equal(isSpecialBlockLine("1. 第一项"), true);
  assert.equal(isSpecialBlockLine("> 引用"), true);
  assert.equal(isSpecialBlockLine("> [!note] 提示"), true);
  assert.equal(isSpecialBlockLine("普通正文"), false);
  assert.equal(isSpecialBlockLine("# 标题"), false);
});


test("parses h1 sections from one category file", () => {
  const content = [
    "---",
    "novelview-type: setting",
    "---",
    "",
    "# 旧城地图",
    "关键词：旧城、地图",
    "旧城位于河流北岸。",
    "",
    "## 子标题",
    "正文。",
    "",
    "# 银色怀表",
    "关键词：怀表",
    "停在 03:17。",
  ].join("\n");

  const sections = parseCategorySections(content);
  assert.equal(sections.length, 2);
  assert.equal(sections[0].heading, "旧城地图");
  assert.deepEqual(sections[0].keywords, ["旧城", "地图"]);
  assert.equal(sections[1].heading, "银色怀表");
  assert.deepEqual(sections[1].keywords, ["怀表"]);
  assert.equal(getCategoryFilePath("长夜将尽", "character"), "长夜将尽/人物.md");
  assert.equal(isCategoryFileName("悬浮标签.md"), true);
  assert.equal(isCategoryFileName("设定"), true);
  assert.equal(isCategoryFileName("人物小传.md"), false);
});

test("keeps category and line metadata on keyword entries", () => {
  const entries = buildKeywordEntries([{
    path: "长夜将尽/设定.md",
    basename: "设定",
    keywords: ["旧城"],
    category: "setting",
    line: 5,
    heading: "旧城地图",
  }]);
  assert.equal(entries.length, 1);
  assert.equal(entries[0].category, "setting");
  assert.equal(entries[0].line, 5);
  assert.equal(entries[0].heading, "旧城地图");
});

test("appends, renames, and deletes category sections", () => {
  const initial = createCategoryFileContent("character");
  const withOne = appendCategorySection(initial, "character", "沈砚", ["小沈"], "人物小传。");
  const withTwo = appendCategorySection(withOne, "character", "林晚", ["晚晚"]);

  let sections = parseCategorySections(withTwo);
  assert.equal(sections.length, 2);
  assert.equal(sections[0].heading, "沈砚");

  const renamed = renameCategorySection(withTwo, sections[1], "林晚（女主）");
  sections = parseCategorySections(renamed);
  assert.equal(sections[1].heading, "林晚（女主）");

  const deleted = deleteCategorySection(renamed, sections[0]);
  sections = parseCategorySections(deleted);
  assert.equal(sections.length, 1);
  assert.equal(sections[0].heading, "林晚（女主）");
});


test("parses and updates two-level outlines", () => {
  const initial = createOutlineFileContent();
  const withEntries = upsertOutlineEntry(
    initial,
    "volume",
    "第一卷",
    "卷纲内容。",
  );
  const withChapter = upsertOutlineEntry(
    withEntries,
    "chapter",
    "第一章",
    "章纲内容。",
  );
  const data = parseOutline(withChapter);
  assert.deepEqual(data.volume.map((entry) => entry.title), ["第一卷"]);
  assert.deepEqual(data.chapter.map((entry) => entry.title), ["第一章"]);
  assert.equal(data.volume[0].body, "卷纲内容。");
  assert.equal(data.chapter[0].body, "章纲内容。");
  assert.equal(isOutlineFileName("大纲.md"), true);

  const updated = upsertOutlineEntry(
    withChapter,
    "chapter",
    "第一章",
    "新的章纲。",
  );
  const updatedData = parseOutline(updated);
  assert.equal(updatedData.chapter.length, 1);
  assert.equal(updatedData.chapter[0].body, "新的章纲。");

  const deleted = deleteOutlineEntry(updated, updatedData.chapter[0]);
  assert.equal(parseOutline(deleted).chapter.length, 0);
});
