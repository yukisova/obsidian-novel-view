import assert from "node:assert/strict";
import { test } from "node:test";
import {
  classifyLine,
  findFrontmatterEnd,
  hasFrontmatterBlock,
  joinFrontmatterContent,
  splitFrontmatterContent,
  isMarkdownSpecialLine,
  isProseLine,
  isSpecialBlockLine,
} from "../.test-build/paragraphs.mjs";
import { compareFilesNaturally } from "../.test-build/format-utils.mjs";
import {
  HISTORY_RETENTION_MS,
  groupNovelHistory,
  historyBucketStart,
  pruneNovelHistory,
} from "../.test-build/novel-config.mjs";
import {
  compileSearchExpression,
  findSearchMatches,
  replaceSearchMatches,
} from "../.test-build/search.mjs";
import {
  parseBranchSource,
  moveBranchNode,
  deleteBranchNode,
  appendBranchChild,
  parseGraphLayout,
  parseGraphNodes,
  parseGraphSource,
  parseTimelineOrientation,
  parseTimelineSource,
  deleteTimelineEntry,
  timelineTimeMs,
  removeGraphNode,
  removeGraphRelation,
  removeGraphRelationsBetween,
  renameGraphRelation,
  serializeGraphLayout,
  serializeTimelineOrientation,
  updateTimelineEntryRange,
} from "../.test-build/setting-special-data.mjs";
import {
  canonicalRelationKey,
  mergeCanonicalRelations,
  parseCanonicalRelations,
  renameGraphNodeInSource,
} from "../.test-build/graph-relations.mjs";
import { formatNovelMarkdown } from "../.test-build/format.mjs";
import { formatNovelTxt, parseNovelTxt } from "../.test-build/txt.mjs";
import {
  findSettingKeywordMatches,
  getSettingKeywordEntries,
  parseSettingCollectionIndex,
  parseSettingGroupMarkdown,
  serializeSettingGroupMarkdown,
  serializeSettingCollectionIndex,
  settingGroupFolderName,
  settingSpecialFileDisplayName,
  isSettingSpecialFileName,
} from "../.test-build/setting-collection.mjs";
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




test("standalone novel editor hides and preserves YAML properties", () => {
  const content = "---\nnovelview-state: 待写\n---\n\n正文 **原样**";
  const split = splitFrontmatterContent(content);
  assert.equal(split.head, "---\nnovelview-state: 待写\n---");
  assert.equal(split.body, "\n正文 **原样**");
  assert.equal(joinFrontmatterContent(split.head, split.body), content);
  const noFrontmatter = splitFrontmatterContent("正文");
  assert.equal(noFrontmatter.head, "");
  assert.equal(noFrontmatter.body, "正文");
});


test("history keeps only the last seven days", () => {
  const now = Date.now();
  const history = [
    { bucketStart: now - 8 * 24 * 60 * 60 * 1000, path: "旧.md", name: "旧", delta: 10, updatedAt: now },
    { bucketStart: now - HISTORY_RETENTION_MS + 60_000, path: "近.md", name: "近", delta: 5, updatedAt: now },
  ];
  const pruned = pruneNovelHistory(history, now);
  assert.equal(pruned.length, 1);
  assert.equal(pruned[0].path, "近.md");
  const parsed = parseNovelConfig({ history });
  assert.equal(parsed.history.length, 1);
  assert.equal(parsed.history[0].path, "近.md");
});


test("history uses four-hour periods today and day periods before today", () => {
  const now = new Date(2026, 10, 16, 15, 30).getTime();
  const todayMorning = new Date(2026, 10, 16, 8, 20).getTime();
  const todayLaterMorning = new Date(2026, 10, 16, 8, 40).getTime();
  const todayNoon = new Date(2026, 10, 16, 12, 20).getTime();
  const yesterdayMorning = new Date(2026, 10, 15, 9, 10).getTime();
  const yesterdayEvening = new Date(2026, 10, 15, 22, 0).getTime();

  assert.equal(
    new Date(historyBucketStart(todayMorning, now)).getHours(),
    8,
  );
  const yesterdayBucket = new Date(historyBucketStart(yesterdayEvening, now));
  assert.equal(yesterdayBucket.getDate(), 15);
  assert.equal(yesterdayBucket.getHours(), 0);

  const groups = groupNovelHistory([
    { bucketStart: todayMorning, path: "今日.md", name: "今日", delta: 10, updatedAt: todayMorning },
    { bucketStart: todayLaterMorning, path: "今日.md", name: "今日", delta: 5, updatedAt: todayLaterMorning },
    { bucketStart: todayNoon, path: "今日.md", name: "今日", delta: 5, updatedAt: todayNoon },
    { bucketStart: yesterdayMorning, path: "昨日.md", name: "昨日", delta: 20, updatedAt: yesterdayMorning },
    { bucketStart: yesterdayEvening, path: "昨日.md", name: "昨日", delta: -4, updatedAt: yesterdayEvening },
  ], now);

  assert.equal(groups.length, 3);
  assert.equal(groups[0].day, false);
  assert.equal(groups[0].entries[0].delta, 5);
  assert.equal(groups[1].day, false);
  assert.equal(groups[1].entries[0].delta, 15);
  assert.equal(groups[2].day, true);
  assert.equal(groups[2].entries.length, 1);
  assert.equal(groups[2].entries[0].delta, 16);
});

test("special setting file suffixes are recognized", () => {
  assert.equal(isSettingSpecialFileName("世界观.detail.md"), true);
  assert.equal(isSettingSpecialFileName("关系.graph.md"), true);
  assert.equal(isSettingSpecialFileName("时间线.line.md"), true);
  assert.equal(isSettingSpecialFileName("分支.branch.md"), true);
  assert.equal(isSettingSpecialFileName("-旧设定.md"), false);
  assert.equal(isSettingSpecialFileName("普通章节.md"), false);
  assert.equal(settingSpecialFileDisplayName("我的吗.graph.md"), "我的吗");
  assert.equal(settingSpecialFileDisplayName("a.b.line.md"), "a.b");
});

test("graph layout positions and edge curves round-trip", () => {
  const source = [
    "# 关系",
    "- 甲 -> 乙 | 朋友",
  ].join("\n");
  const layout = {
    nodes: { 甲: { x: 140, y: 156 }, 乙: { x: 560, y: 364 } },
    curves: { "甲\u0000乙\u0000朋友\u0000one-way": 0.4 },
    containers: {},
    board: { width: 700, height: 520 },
  };
  const next = serializeGraphLayout(source, layout);
  assert.match(next, /novelview-graph-layout/u);
  assert.deepEqual(parseGraphLayout(next), layout);
});

test("graph relation and node removal update source and layout", () => {
  const source = serializeGraphLayout([
    "# 关系",
    "- 甲 -> 乙 | 朋友",
    "- 乙 -> 丙 | 同事",
  ].join("\n"), {
    nodes: { 甲: { x: 140, y: 104 }, 乙: { x: 350, y: 260 } },
    curves: { "甲\u0000乙\u0000朋友\u0000one-way": 0.3 },
    containers: {},
    board: { width: 700, height: 520 },
  });
  const [first] = parseGraphSource(source);
  const withoutEdge = removeGraphRelation(source, first);
  assert.equal(parseGraphSource(withoutEdge).length, 1);
  assert.equal(Object.keys(parseGraphLayout(withoutEdge).curves).length, 0);
  const withoutNode = removeGraphNode(source, "乙");
  assert.equal(parseGraphSource(withoutNode).length, 0);
  assert.deepEqual(parseGraphLayout(withoutNode).nodes, { 甲: { x: 140, y: 104 } });

  const duplicateSource = serializeGraphLayout([
    "# 关系",
    "- 甲 -> 乙 | 朋友",
    "- 甲 -> 乙 | 朋友",
  ].join("\n"), {
    nodes: {},
    curves: { "甲\u0000乙\u0000朋友\u0000one-way": 0.4 },
    containers: {},
    board: { width: 700, height: 520 },
  });
  const [duplicate] = parseGraphSource(duplicateSource);
  const oneRemaining = removeGraphRelation(duplicateSource, duplicate);
  assert.equal(parseGraphSource(oneRemaining).length, 1);
  assert.equal(Object.keys(parseGraphLayout(oneRemaining).curves).length, 1);
});

test("graph removes all relations between two nodes", () => {
  const source = [
    "# 图",
    "- 甲 -> 乙 | 甲到乙",
    "- 乙 -> 甲 | 乙到甲",
    "- 甲 <-> 乙 | 双向",
    "- 甲 -> 丙 | 保留",
  ].join("\n");
  const cleaned = removeGraphRelationsBetween(source, "甲", "乙");
  const relations = parseGraphSource(cleaned);
  assert.equal(relations.length, 1);
  assert.equal(relations[0].to, "丙");
});

test("graph supports isolated nodes and relation renames", () => {
  const source = [
    "# 图",
    "- 孤立节点",
    "- 甲 -> 乙 | 旧名",
  ].join("\n");
  assert.deepEqual(parseGraphNodes(source), ["孤立节点"]);
  const [relation] = parseGraphSource(source);
  const renamed = renameGraphRelation(source, relation, "新名");
  assert.match(renamed, /甲 -> 乙 \| 新名/u);
  const withoutIsolated = removeGraphNode(source, "孤立节点");
  assert.deepEqual(parseGraphNodes(withoutIsolated), []);
});

test("timeline supports ranges, tracks and range updates", () => {
  const source = [
    "# 时间轴",
    "- 2024-01-01 ~ 2024-01-03 | 起点 | 开始 | 主线",
    "- 2024-01-02 ~ 2024-01-04 | 并行 | 同时 | 支线",
  ].join("\n");
  const entries = parseTimelineSource(source);
  assert.equal(entries[0].start, "2024-01-01");
  assert.equal(entries[0].end, "2024-01-03");
  assert.equal(entries[0].track, "主线");
  assert.equal(timelineTimeMs(entries[0].start), Date.UTC(2024, 0, 1));
  const updated = updateTimelineEntryRange(
    source,
    0,
    "2024-01-02",
    "2024-01-05",
  );
  assert.match(updated, /2024-01-02 ~ 2024-01-05 \| 起点 \| 开始 \| 主线/u);
});

test("graph node rename updates relations, layout and containers", () => {
  const source = serializeGraphLayout([
    "# 图",
    "- 甲",
    "- 甲 -> 乙 | 朋友",
  ].join("\n"), {
    nodes: { 甲: { x: 120, y: 100 }, 乙: { x: 300, y: 100 } },
    curves: { "甲\u0000乙\u0000朋友\u0000one-way": 0.4 },
    containers: { 甲: { width: 110, height: 70, members: ["乙"] } },
    board: { width: 700, height: 520 },
  });
  const next = renameGraphNodeInSource(source, "甲", "丙");
  assert.match(next, /- 丙\n/u);
  assert.match(next, /- 丙 -> 乙 \| 朋友/u);
  const layout = parseGraphLayout(next);
  assert.ok(layout.nodes.丙);
  assert.equal(layout.nodes.甲, undefined);
  assert.deepEqual(layout.containers.丙.members, ["乙"]);
  assert.equal(Object.keys(layout.curves)[0]?.startsWith("丙\u0000"), true);
});

test("canonical graph relations dedupe by from/to/label/direction", () => {
  const relations = parseCanonicalRelations([
    { from: "甲", to: "乙", label: "朋友", twoWay: false },
    { from: "甲", to: "乙", label: "朋友", twoWay: false },
    { from: "甲", to: "乙", label: "敌人", twoWay: true },
  ]);
  const map = new Map();
  mergeCanonicalRelations(map, relations);
  assert.equal(map.size, 2);
  assert.equal(
    canonicalRelationKey({ from: "甲", to: "乙", label: "朋友", twoWay: false }),
    "甲\u0000乙\u0000朋友\u0000one-way",
  );
});

test("timeline entry deletion removes only the selected bullet", () => {
  const source = ["# 轴", "- 第一天 | A", "- 第二天 | B"].join("\n");
  const next = deleteTimelineEntry(source, 0);
  assert.doesNotMatch(next, /第一天/u);
  assert.match(next, /第二天/u);
});

test("branch supports subtree deletion and child creation", () => {
  const source = [
    "- 根",
    "  - 子A",
    "    - 孙",
    "  - 子B",
  ].join("\n");
  const deleted = deleteBranchNode(source, "子A");
  assert.doesNotMatch(deleted, /子A|孙/u);
  assert.match(deleted, /子B/u);
  const child = appendBranchChild(source, "子B", "新分支");
  assert.match(child, /  - 子B\n    - 新分支/u);
});

test("timeline orientation and branch reparenting persist", () => {
  const timeline = serializeTimelineOrientation("# 轴\n", "horizontal");
  assert.equal(parseTimelineOrientation(timeline), "horizontal");
  const branch = [
    "- 根",
    "  - 一",
    "    - 一·甲",
    "  - 二",
  ].join("\n");
  const moved = moveBranchNode(branch, "一·甲", "二");
  assert.match(moved, /  - 二\n    - 一·甲/u);
  assert.doesNotMatch(moved, /\n\s*\n/u);
});

test("special setting data parsers read timeline, graph and branch sources", () => {
  const timeline = parseTimelineSource([
    "# 时间轴",
    "- 2024-01-01 | 起点 | 故事开始",
    "- 2024-02-01 | 转折",
  ].join("\n"));
  assert.equal(timeline.length, 2);
  assert.equal(timeline[0].time, "2024-01-01");
  assert.equal(timeline[0].title, "起点");
  assert.equal(timeline[0].description, "故事开始");

  const graph = parseGraphSource([
    "# 关系",
    "- 甲 -> 乙 | 朋友",
    "- 乙 <-> 丙 | 对手",
  ].join("\n"));
  assert.equal(graph.length, 2);
  assert.equal(graph[0].from, "甲");
  assert.equal(graph[0].to, "乙");
  assert.equal(graph[0].label, "朋友");
  assert.equal(graph[1].twoWay, true);

  const branch = parseBranchSource([
    "- 根",
    "  - 一",
    "    - 一·甲",
    "  - 二",
  ].join("\n"));
  assert.equal(branch.length, 1);
  assert.equal(branch[0].children.length, 2);
  assert.equal(branch[0].children[0].children[0].text, "一·甲");
});

test("TXT import strips two full-width spaces and splits volumes/chapters", () => {
  const input = [
    "第1卷 风起",
    "第一章",
    "　　第一行",
    "　　",
    "　　第二行",
    "第二章",
    "第2卷 云涌",
    "第三章",
    "　　内容",
  ].join("\n");
  const chapters = parseNovelTxt(input);
  assert.deepEqual(chapters.map((chapter) => ({
    title: chapter.title,
    volume: chapter.volume,
    body: chapter.body,
  })), [
    { title: "第一章", volume: "风起", body: "第一行\n\n第二行" },
    { title: "第二章", volume: "风起", body: "" },
    { title: "第三章", volume: "云涌", body: "内容" },
  ]);
});

test("TXT export/import round-trips volume and chapter structure", () => {
  const formatted = formatNovelTxt([
    { title: "第一章", volume: "风起", volumeNumber: 1, body: "第一行\n\n第二行" },
    { title: "第二章", volume: "风起", volumeNumber: 1, body: "" },
    { title: "第三章", volume: "云涌", volumeNumber: 2, body: "内容" },
  ]);
  const parsed = parseNovelTxt(formatted);
  assert.deepEqual(parsed.map((chapter) => ({
    title: chapter.title,
    volume: chapter.volume,
    body: chapter.body,
  })), [
    { title: "第一章", volume: "风起", body: "第一行\n\n第二行" },
    { title: "第二章", volume: "风起", body: "" },
    { title: "第三章", volume: "云涌", body: "内容" },
  ]);
  assert.equal(formatted.includes("\u3000\u3000"), true);
});


test("setting collection index parses groups, tags, colors and entries", () => {
  const data = parseSettingCollectionIndex({
    人物: [
      {
        tag: "主角",
        color: 0xff0000,
        contain: [
          { keyword: "零一", content: "主角设定" },
          { keyword: "", content: "" },
        ],
      },
    ],
    地点: [],
  });
  assert.deepEqual(data, {
    人物: [{
      tag: "主角",
      color: "16711680",
      contain: [{
        keyword: "零一",
        content: "主角设定",
        fields: [],
        marks: [],
      }],
    }],
    地点: [],
  });
  assert.equal(settingGroupFolderName("人物"), "人物");
  assert.equal(settingGroupFolderName("bad/name"), "bad-name");
  const roundtrip = parseSettingCollectionIndex(
    JSON.parse(serializeSettingCollectionIndex(data)),
  );
  assert.deepEqual(roundtrip, data);
});


test("setting collection keywords keep tag color and first occurrence", () => {
  const index = parseSettingCollectionIndex({
    人物: [
      {
        tag: "主角",
        color: "#ff0000",
        contain: [{ keyword: "零一", content: "主角简介" }],
      },
      {
        tag: "反派",
        color: "#9900ff",
        contain: [{ keyword: "零一", content: "重复关键词" }],
      },
    ],
  });
  const entries = getSettingKeywordEntries(index);
  assert.equal(entries.length, 1);
  assert.equal(entries[0].color, "#ff0000");
  assert.deepEqual(findSettingKeywordMatches("零一与伊兹", entries), [
    { start: 0, end: 2, entry: entries[0] },
  ]);
});


test("setting group markdown round-trips fields and marks", () => {
  const tags = [{
    tag: "主角",
    color: "#e74c3c",
    contain: [{
      keyword: "小红",
      content: "小红在13岁那年离开旧宅。",
      fields: [{ name: "年龄", value: "16" }],
      marks: [{ start: 3, end: 7, attribute: "生平" }],
    }],
  }];
  const md = serializeSettingGroupMarkdown(tags);
  assert.match(md, /novelview-setting-index: true/u);
  assert.deepEqual(parseSettingGroupMarkdown(md), tags);
});
