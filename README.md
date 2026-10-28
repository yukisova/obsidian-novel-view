# NovelView

**为 Obsidian 打造的小说写作工作流。**  
**A novel-writing workflow for Obsidian.**

![version](https://img.shields.io/badge/version-0.6.0-9a5a2d)
![Obsidian](https://img.shields.io/badge/Obsidian-%E2%89%A51.7.2-7c3aed)
![license](https://img.shields.io/badge/license-MIT-4d7c56)
![author](https://img.shields.io/badge/author-yukisova-356c9a)

NovelView 在 Obsidian 原生 Markdown 之上提供小说组、文章树、章节状态、素材库、联动库和联动关键词高亮。

<p align="center">
  <img src="docs/novelview-article-list.png" alt="NovelView 文章列表" width="100%" />
</p>

> 界面预览使用插件真实 CSS 与组件渲染，并非 Obsidian 实拍截图。

<p align="center"><a href="#english">English</a> · <a href="#中文文档">中文</a></p>

---

## English

**NovelView** is a Markdown-first novel workflow for Obsidian: novel groups, multi-select article tree, chapter statuses, materials/link libraries, and link-library keyword highlighting.

### Highlights

- **Novel groups** with article list in the left file-explorer leaf, plus a **返回** toolbar button.
- **Chapter rows** show word count and status: 待写 / 草稿 / 大纲 / 修改中 / 已完稿, stored in `novelview-state`.
- **Novel mode status card** in the upper-right; click to change chapter status.
- **No novel-level status** and no description feature.
- **No special pages**: settings/characters/timeline/foreshadowing/outline special views and legacy properties are removed.
- **Link library**: toolbar (new group, import, multi-select), inline rename, expandable groups, context edit/delete, floating import/edit panels, JSON at the novel-group root.
- **Link keywords**: filename + aliases, group colors, `~/` paths, current-volume/link fallbacks.
- **Materials library**: empty-state watermark, double-click import, inline rename button, open/delete.
- **Workbench**: overview only; clicking a group updates focus without jumping if a workbench already exists.
- **Title-bar icons**: article list, materials, and link library each expose their own title icon.

### Installation

1. Download [novel-view-0.6.0.zip](dist/novel-view-0.6.0.zip).
2. Extract to `<Vault>/.obsidian/plugins/novel-view/`.
3. Enable **NovelView** in **Settings → Community plugins**.

Requires Obsidian **1.7.2+**.

### Article List

- Header: novel name + body count only.
- Replaces the left file explorer; title bar has a back action and the toolbar has a visible **返回** button.
- Multi-select: marquee, Shift range, Ctrl/Cmd toggle; blank click clears.
- Inline rename; multi-select disables rename.
- New article “无标题”, no duplicate H1; new volume “无名卷” with numbering.
- Each chapter row displays word count and status.

Status property:

```yaml
---
novelview-state: 草稿
---
```

### Chapter Status

- Statuses: 待写、草稿、大纲、修改中、已完稿.
- Article rows show word count and status.
- Novel-mode status card in the upper-right opens a dropdown to change status.
- Novel-level status is removed from `NovelSetting.md` and from “Edit novel info”.

### Descriptions Removed

Chapter and volume description features, floating panels, context entry, and stored `描述` data are removed. Legacy `描述` properties are cleaned on load.

### Link Library

- Toolbar: **新增联动组**, **导入联动文件**, **多选** (plus batch delete).
- Title/list spacing and divider match the materials library.
- JSON lives at `<novel-group>/links.json`; the old `link/` folder is no longer used.
- Any vault file type can be imported, not only Markdown.
- Import opens a floating tree window; aliases can be set and confirmed with Enter.
- Groups can expand/collapse; files drag into groups; groups can be reordered.
- Right-click group/file: **编辑**, **重命名**, **删除**.
- Rename is inline; edit opens a modeless color/alias panel, not a dialog.
- Missing imported files are pruned automatically when loading/refreshing.

```json
{
  "group": { "联动组1": "#aa3311" },
  "link": [
    { "未命名.md": { "belong": "联动组1", "alias": ["你好"] } },
    { "~/仓库内引用.md": { "alias": ["你好hk"] } }
  ]
}
```

Keywords use filename + alias; group color is the highlight color. `~/` resolves from the vault root; bare paths fall back through the current volume, group root, and legacy link paths.

### Materials Library

- Empty state shows a semi-transparent watermark: double-click blank area to import images.
- Each card has an **重命名** button; no right-click menu.
- Title bar has a single image icon.

### Novel Mode

- Automatic inside novel groups; no manual toggle.
- Lists/quotes native; tables/images centered.
- Toolbar: auto format, insert image → from file / from materials; larger picker with names.
- Auto format removes all blank lines, including fenced code.

### Settings

Controls only: first-line indent, line height, paragraph spacing, paragraph mode, hide markers, hide line numbers, restore defaults.

### Author

**yukisova** · MIT License · [Design notes](docs/DESIGN.md)

---

## 中文文档

### 简介

NovelView 为 Obsidian 增加小说写作层，不替换原生 Markdown 编辑器。0.6.0 增加章节字数/状态、联动库工具栏与多选，移除小说状态、描述和全部特殊页面。

### 安装

下载文件，放到 `<Vault>/.obsidian/plugins/novel-view/`，在 **设置 → 第三方插件** 启用。最低 Obsidian **1.7.2**。

### 文章列表

- 标题仅显示小说名 + 正文数量；
- 替换左侧文件列表；标题栏有返回图标，工具栏有可见“返回”按钮；
- 每条章节显示字数与状态：待写、草稿、大纲、修改中、已完稿；
- 状态属性：`novelview-state`；
- 多选：框选、Shift 连续、Ctrl/Cmd 间断，空白取消；
- 多选禁止重命名；右键不再有“编辑描述”。

### 章节状态

- 小说模式下右上角状态卡显示字数与状态，点击弹出下拉菜单修改；
- 小说状态属性与“编辑小说信息”中的状态 UI 已删除；
- 新文章默认“待写”。

### 描述删除

章描述、卷描述、浮动描述面板、右键入口及 `描述` 数据全部移除；加载时清理遗留 `描述` 属性。

### 联动库

- 顶部工具栏：新增联动组、导入联动文件、多选/批量删除；
- 标题与列表间有分隔线，样式与素材库一致；
- JSON 位于小说组根目录 `links.json`，不再使用 `link/` 文件夹；
- 导入支持仓库内任意文件类型；
- 导入窗口为悬浮树，支持别名并回车依次确认；
- 联动组可展开/折叠；组与文件支持拖拽、聚焦；
- 右键组/文件：编辑、重命名、删除；
- 重命名为行内编辑；编辑只改颜色/别名，使用无遮罩浮动面板，不弹对话框；
- 加载/刷新时自动删除已丢失文件的联动记录。

JSON：

```json
{
  "group": { "联动组1": "#aa3311" },
  "link": [
    { "未命名.md": { "belong": "联动组1", "alias": ["你好"] } },
    { "~/仓库内引用.md": { "alias": ["你好hk"] } }
  ]
}
```

关键词 = 文件名 + 别名，颜色来自联动组；`~/` 从仓库根解析，裸路径依次回退当前卷、组根目录和旧 link 路径。

### 素材库

- 空状态中央显示半透明水印：双击空白区域可导入图片；
- 双击后选择图片并写入 `src/`；
- 每张素材卡提供“重命名”按钮，进入行内编辑；移除卡片右键菜单；
- 标题栏只保留一个素材库图标。

### 小说模式

- 自动模式；
- 多级列表原生；表格/图片居中；
- 工具栏：自动排版、插入图片（从文件/从素材库）；选择窗口更大并显示名称；
- 自动排版删除所有空行（含代码块）。

### 设置

仅保留首行缩进、行距、段距、段落划分、隐藏 Markdown 标记、隐藏行号、恢复默认。

### 作者与许可

作者：**yukisova**，基于 [MIT License](LICENSE) 发布。
