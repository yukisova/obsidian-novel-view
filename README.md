# Novel View

<p align="center">
  <a href="#中文文档">中文</a> · <a href="#english">English</a>
</p>

<p align="center">
  <img alt="version" src="https://img.shields.io/badge/version-0.7.21-9a5a2d">
  <img alt="Obsidian" src="https://img.shields.io/badge/Obsidian-%E2%89%A51.7.2-7c3aed">
  <img alt="license" src="https://img.shields.io/badge/license-MIT-4d7c56">
  <img alt="author" src="https://img.shields.io/badge/author-yukisova-356c9a">
</p>

Novel View 是一个面向长篇小说写作的 Obsidian 插件。它保留原生 Markdown 编辑器，并围绕小说组、文章列表、卷与文章组、素材库、联动库、小说模式和查找替换提供一套完整的写作工作流。

Novel View is a novel-writing workflow for Obsidian. It keeps the native Markdown editor and adds novel groups, an article tree, volumes and article groups, a materials library, a linked-file library, novel mode, and find/replace.

> **桌面端专用。** 系统文件选择器、TXT 导入导出与封面资源管理依赖桌面端能力，插件已声明为 desktop-only。

---

## 中文文档

### 目录

- [安装](#安装)
- [快速开始](#快速开始)
- [Novel View 工作台](#novel-view-工作台)
- [文章列表](#文章列表)
- [卷与文章组](#卷与文章组)
- [联动库](#联动库)
- [素材库](#素材库)
- [小说模式](#小说模式)
- [高级查找替换](#高级查找替换)
- [格式设置](#格式设置)
- [配置文件](#配置文件)
- [快捷键与操作](#快捷键与操作)
- [开发](#开发)
- [许可](#许可)

### 安装

要求：

- Obsidian **1.7.2** 或更高版本；
- 桌面端 Obsidian（Windows / macOS / Linux）。

手动安装：

1. 下载 [novel-view-0.7.21.zip](dist/novel-view-0.7.21.zip)。
2. 解压到：

   ```text
   <Vault>/.obsidian/plugins/novel-view/
   ```

3. 确认目录中至少包含：

   ```text
   manifest.json
   main.js
   styles.css
   ```

4. 在 Obsidian 的 **设置 → 第三方插件** 中启用 **Novel View**。
5. 如果插件未出现，重启 Obsidian 或重新加载插件。

### 快速开始

1. 在文件浏览器中右键一个普通文件夹。
2. 选择 **构建小说组**。
3. 插件会在该文件夹中创建 `novel.json`，并打开文章列表与 Novel View 工作台。
4. 点击文章列表标题或文件夹名称进入对应小说组的工作台。
5. 右键空白处新建文章或卷，或直接把已有 Markdown 文件拖入小说组。

小说名称取自小说组文件夹名称；简介、封面、卷信息和文章组信息保存在 `novel.json`。

### Novel View 工作台

工作台展示小说组的基本信息：

- 封面；
- 标题（同时是小说组文件夹名）；
- 简介；
- 字数、卷数和章节数统计。

直接点击即可编辑：

- 点击标题：重命名小说组文件夹；
- 点击简介：在界面内编辑并保存；
- 点击封面：选择图片作为小说封面。

封面与卷海报会保存到小说组的 `src/` 文件夹。

### 文章列表

小说组打开后，左侧文件浏览器会被文章列表替代。标题栏与工具栏均提供返回文件浏览器的入口。

#### 文章与卷

- 文章按属性 `novelview-id` 排序，与文件名无关。
- 新建文章自动分配当前序列的下一个递增 ID。
- 卷顺序保存在 `novel.json` 的 `volume-order` 中，不按名称排序。
- 分散卷始终显示；没有分散文章时也会保留。
- ID 不在树状列表中显示。
- 右键卷可：
  - 新建文章；
  - 编辑卷描述与卷海报；
  - 导出本卷为 TXT。
- 鼠标悬停卷名可查看卷描述与卷海报。
- 工具栏支持正序/倒序切换。

#### 拖拽与多选

- 拖拽文章可调整顺序。
- 拖到卷名上：移动到该卷。
- 拖到文章之间：按插入位置重排。
- 多选文章后可批量拖拽。
- 支持框选、Shift 和 Ctrl/Cmd 多选；框选范围变化时，选中项实时同步。
- 拖拽到 MainArea 的三种效果：

| 拖放位置 | 结果 | 预览提示 |
| --- | --- | --- |
| MainArea 内容空白处 | 在当前 MainArea 新建第二栏，并依次打开文章 | `N 个文件 · 在第二栏打开` |
| 标签页栏空白处 | 按顺序追加为新标签页 | `N 个文件 · 添加至标签页栏` |
| 标签页标题处 | 第一篇替换目标标签页，其余追加 | `N 个文件 · 替换当前标签页并添加其余` |

拖拽期间显示跟随鼠标的浮动提示；按 Esc 或拖出 MainArea 后释放不会执行操作。

#### 撤销与新建

- `Cmd/Ctrl+Z`：撤销文章移动、删除、重命名等文章列表操作。
- `Cmd/Ctrl+N`：在当前小说组或当前聚焦卷中新建章节。
- 点击文章列表标题进入 Novel View 工作台。

#### 文章状态

章节状态保存在笔记属性 `novelview-state` 中：

| 状态 | 属性值 |
| --- | --- |
| 待写 | `todo` |
| 草稿 | `draft` |
| 大纲 | `outline` |
| 修改中 | `revising` |
| 已完稿 | `done` |

右键选中文章 → **修改状态**，可批量设置状态。

#### 导入与导出

工具栏的 **导入与导出** 菜单提供：

- **导入 TXT**：使用系统文件选择器选择一个 TXT 文件，并在当前小说组中创建章节；
- **导出合并稿**：将小说组全部文章合并为一个 TXT，并通过系统文件夹选择器指定保存位置。

单章与单卷也可通过右键菜单导出 TXT。

### 卷与文章组

#### 卷

- 卷的排序由 `novel.json` 的 `volume-order` 决定。
- 拖动卷名可改变卷顺序。
- 右键卷可编辑卷描述与卷海报。
- 卷海报与小说封面统一保存在 `src/`。

#### 文章组

文章组用于概括同一卷中连续的若干章节。

规则：

- 同一文章组内的章节必须连续；
- 单个文章不能构成文章组；
- 不连续的文章组会按连续段拆分；
- 少于两篇的组会被移除；
- 重命名、删除、移动、排序后会自动修复文章组路径与连续性。

操作：

- 多选连续文章 → 右键 → **归入文章组**，填写名称和描述。
- 将文章拖到文章组内的文章或空白区域，可加入该文章组。
- 单击文章组边框：全选组内所有文章。
- 右键文章组边框：编辑或删除文章组。
- 鼠标悬停文章组边框：显示名称与描述。
- 右键组内单篇文章 → **移出文章组**，可选择：
  - **以下**：移出该文章及其下方同组成员；
  - **以上**：移出该文章及其上方同组成员。

### 联动库

联动库用于建立小说关键词与其他 Markdown 文件之间的关联，并在小说模式中自动高亮关键词。

#### 联动组与标签

- 联动组用于组织联动文件。
- 标签可选；一个联动文件最多一个标签。
- 标签颜色用于关键词高亮。
- 联动组不再支持粗体、斜体、粗斜体、下划线等字体样式。
- 新建联动组会直接创建，不弹出命名窗口。
- 组、标签均支持右键就地重命名。
- 标签支持右键修改颜色或解绑；解绑不再弹确认窗口。
- 导入窗口只按文件名/路径筛选，不再使用回车导入。

#### 别名与关键词唯一性

- 联动文件可以有多个别名，逗号分隔。
- 有别名时，**别名替代文件名**作为关键词。
- 无别名时，文件名作为关键词。
- 一个关键词只能指向一个联动文件。
- 导入、编辑别名、重命名时都会检查关键词冲突；冲突时强制输入唯一别名。
- 若取消别名输入，本次操作无效。
- 重命名冲突时，别名只替代显示关键词，不修改实际文件名，避免产生同名文件。

#### 树状结构与操作

- 组下包含：
  - **未设置标签**文件；
  - 标签分组及其文件。
- 单击联动文件：仅聚焦。
- 双击联动文件：打开文件。
- 同一时间只允许一个联动文件聚焦。
- 点击空白处或开始框选会取消聚焦。
- 鼠标悬停联动文件显示完整路径。
- 文件副标题只显示别名；无别名时主标题放大。
- 多选联动文件后可拖拽：
  - 拖到组名：移入该组；
  - 拖到标签名：移入该组并归入该标签；
  - 拖到文件之间：插入并调整顺序。
- 联动库支持 `Cmd/Ctrl+Z` 撤销移动、删除、重命名、标签和别名变更。

#### 导入联动文件

- 打开导入窗口后可按文件名实时筛选。
- 双击文件尝试导入。
- 无重名时直接导入。
- 与已有文件名或别名重名时，必须输入新别名。
- 别名仍重复时继续要求重新输入。

### 素材库

- 从文章列表工具栏打开，位于右侧边栏。
- 用于管理小说组 `src/` 中的图片与素材。
- 支持双击空白处导入、重命名、删除。
- 已被小说封面或卷海报引用的图片不会在素材库中重复显示。
- 再次打开时优先复用已有素材库标签页。

### 小说模式

小说组内的 Markdown 文件会自动进入小说模式。

- 隐藏 H1–H6 标题标记。
- 列表、引用块保持原生 Markdown 行为。
- 分隔线只取消首行缩进。
- 左上角目录按分隔线分组；默认缩略显示，聚焦时展开。
- 浮动工具栏提供：
  - 自动排版；
  - 插入图片（从文件 / 从素材库）；
  - 高级查找替换；
  - 格式设置。

#### 自动排版

- 删除多余空行；
- 在分隔线、表格、列表、引用块前后保留一行空行；
- 代码块内容不被破坏，但代码块内空行会被清理；
- 清理段首、段尾的空格和 Tab。

#### 关键词高亮

- 联动关键词自动高亮。
- 同一章节内，每个关键词只高亮第一次出现。
- 鼠标悬停关键词显示信息卡片：
  - 联动文件名；
  - 所在标签（无则空）；
  - 所在联动组（无则空）。
- 卡片显示在关键词首字下方，鼠标移出后消失。

### 高级查找替换

- 入口位于小说模式浮动工具栏。
- 全局浮动窗口，不受 MainArea 尺寸限制。
- 支持拖动标题栏移动窗口。
- 自动复用同一窗口，不重复创建。
- 查找范围：
  - 全章；
  - 本卷；
  - 全书；
  - 联动库文件。
- 输入时实时查找。
- 结果按文件分组，点击文件展开详情。
- 窗口标题下显示当前小说组。

### 格式设置

在小说模式浮动工具栏点击 **格式设置**，实时调整：

- 字体大小；
- 行距；
- 段距；
- 首行缩进。

修改会立即应用到已打开的小说模式视图。

### 配置文件

小说组根目录的 `novel.json` 保存小说级配置。示例：

```json
{
  "novel-description": "一场从旧城开始的漫长告别。",
  "novel-cover": "src/cover.png",
  "volume-order": ["第一卷", "第二卷"],
  "volumes": {
    "第一卷": {
      "description": "旧城篇。",
      "cover": "src/volume-1.png"
    }
  },
  "article-groups": [
    {
      "id": "group-1",
      "volume": "第一卷",
      "name": "第一部分",
      "description": "故事的开端。",
      "paths": [
        "长夜将尽/第一卷/第一章.md",
        "长夜将尽/第一卷/第二章.md"
      ]
    }
  ]
}
```

说明：

- 小说名称取自文件夹名，不存储在 JSON 中。
- 旧版 `NovelSetting.md` 会在首次加载时自动迁移描述和封面到 `novel.json`；原文件会保留并正常显示，可自行归档或删除。
- 文章 ID 保存在笔记属性 `novelview-id`。
- 文章状态保存在 `novelview-state`。
- 联动数据保存在小说组根目录 `links.json`。

### 快捷键与操作

| 操作 | 方式 |
| --- | --- |
| 新建章节 | 文章列表内 `Cmd/Ctrl+N` |
| 撤销文章列表操作 | 文章列表内 `Cmd/Ctrl+Z` |
| 撤销联动库操作 | 联动库内 `Cmd/Ctrl+Z` |
| 多选文章 | 框选 / Shift / Ctrl/Cmd |
| 快速打开联动文件 | 双击联动文件 |
| 关闭查找窗口 | `Esc` |
| 取消 MainArea 拖拽 | `Esc` 或拖出 MainArea |

### 开发

```bash
npm install
npm run dev     # 监听构建
npm run check   # TypeScript 检查
npm test        # 核心测试
npm run build   # 生产构建
```

产物：

```text
main.js
styles.css
manifest.json
```

更多设计说明见 [docs/DESIGN.md](docs/DESIGN.md)。

### 许可

作者：**yukisova**  
许可：[MIT License](LICENSE)

---

## English

### Contents

- [Installation](#installation)
- [Quick start](#quick-start)
- [Workbench](#workbench)
- [Article list](#article-list)
- [Volumes and article groups](#volumes-and-article-groups)
- [Linked-file library](#linked-file-library)
- [Materials library](#materials-library)
- [Novel mode](#novel-mode)
- [Find and replace](#find-and-replace)
- [Format settings](#format-settings)
- [Configuration](#configuration)
- [Shortcuts](#shortcuts)
- [Development](#development)
- [License](#license)

### Installation

Requirements:

- Obsidian **1.7.2** or newer;
- Desktop Obsidian (Windows, macOS, or Linux).

Manual installation:

1. Download [novel-view-0.7.21.zip](dist/novel-view-0.7.21.zip).
2. Extract it to:

   ```text
   <Vault>/.obsidian/plugins/novel-view/
   ```

3. Make sure the folder contains:

   ```text
   manifest.json
   main.js
   styles.css
   ```

4. Open **Settings → Community plugins** and enable **Novel View**.
5. Restart Obsidian or reload the plugin if it does not appear.

### Quick start

1. Right-click a normal folder in the file explorer.
2. Choose **Build novel group**.
3. Novel View creates `novel.json` in that folder and opens the article list and workbench.
4. Click the article-list title or the folder name to open the workbench.
5. Create articles or volumes from the context menu, or move existing Markdown files into the group.

The novel name is the folder name. Description, cover, volume metadata, and article-group metadata are stored in `novel.json`.

### Workbench

The workbench shows:

- cover;
- title (the novel-group folder name);
- description;
- total word count, volume count, and chapter count.

Click to edit:

- Title: rename the novel-group folder;
- Description: edit inline;
- Cover: choose a cover image.

Novel covers and volume posters are stored in the group's `src/` folder.

### Article list

The left file explorer is replaced by the article list while a novel group is open. Both the title bar and toolbar provide a way back to the file explorer.

#### Articles and volumes

- Articles are ordered by the `novelview-id` property, never by filename.
- New articles receive the next incremental ID.
- Volume order is stored in `volume-order` in `novel.json`, not sorted by name.
- The Scattered Volume is always shown, even when empty.
- IDs are hidden from the tree.
- Right-click a volume to:
  - create an article in that volume;
  - edit its description and poster;
  - export the volume as TXT.
- Hover a volume name to preview its description and poster.
- The toolbar toggles ascending/descending order.

#### Drag, drop, and selection

- Drag articles to reorder them.
- Drop on a volume name to move articles into that volume.
- Drop between articles to insert at that position.
- Multi-selected articles can be dragged together.
- Marquee, Shift, and Ctrl/Cmd multi-selection are supported; the selection updates live as the marquee changes.
- Drop selected articles onto MainArea:

| Drop target | Result | Preview |
| --- | --- | --- |
| Empty MainArea content | Open a second column and open the articles there | `N files · Open in second column` |
| Empty tab-bar area | Append the articles as new tabs | `N files · Add to tab bar` |
| A tab title | Replace that tab with the first article and append the rest | `N files · Replace current tab and add the rest` |

A floating preview follows the pointer. Press Esc or release outside MainArea to cancel.

#### Undo and new articles

- `Cmd/Ctrl+Z`: undo article moves, deletions, and renames.
- `Cmd/Ctrl+N`: create a chapter in the current group or focused volume.
- Click the article-list title to open the workbench.

#### Chapter status

Chapter status is stored in `novelview-state`:

| Status | Value |
| --- | --- |
| To write | `todo` |
| Draft | `draft` |
| Outline | `outline` |
| Revising | `revising` |
| Done | `done` |

Right-click selected articles → **Change status** to set it in bulk.

#### Import and export

The toolbar's **Import & Export** menu provides:

- **Import TXT**: pick a TXT file with the system file picker and create a chapter;
- **Export merged manuscript**: merge all group articles into one TXT and choose the destination folder with the system folder picker.

Individual chapters and volumes can also be exported from their context menus.

### Volumes and article groups

#### Volumes

- Volume order is stored in `novel.json` as `volume-order`.
- Drag volume names to reorder them.
- Right-click a volume to edit its description and poster.
- Posters and covers are stored in `src/`.

#### Article groups

Article groups summarize a consecutive range of chapters in one volume.

Rules:

- Members must be consecutive in the same volume;
- A single article cannot form a group;
- Non-consecutive members are split into consecutive runs;
- Runs with fewer than two articles are removed;
- Renaming, deleting, moving, and sorting automatically repair group paths and continuity.

Actions:

- Select multiple consecutive articles → right-click → **Add to article group**, then set name and description.
- Drag articles onto a group's rows or empty area to join it.
- Click a group's border: select all articles in the group.
- Right-click a group border: edit or delete the group.
- Hover a group border: show its name and description.
- Right-click a single member → **Remove from article group**:
  - **Below**: remove this article and the members below it;
  - **Above**: remove this article and the members above it.

### Linked-file library

The linked-file library connects novel keywords to other Markdown files and highlights those keywords in novel mode.

#### Groups and tags

- Groups organize linked files.
- Tags are optional; a linked file has at most one tag.
- Tag colors are used for keyword highlighting.
- Group font styles (bold, italic, bold italic, underline) are no longer supported.
- New groups are created immediately without a naming dialog.
- Groups and tags can be renamed inline from the context menu.
- Tags can be recolored or unbound from the context menu; unbinding no longer asks for confirmation.
- The import window filters by filename/path and does not use Enter to import.

#### Aliases and keyword uniqueness

- A linked file may have multiple aliases, separated by commas.
- When aliases exist, **aliases replace the filename** as highlight keywords.
- Without aliases, the filename is the keyword.
- A keyword may point to only one linked file.
- Importing, editing aliases, and renaming all validate keyword uniqueness and force a unique alias on conflict.
- Canceling the alias prompt cancels the operation.
- If a rename conflicts, the alias replaces the displayed keyword without renaming the actual file, preventing duplicate filenames.

#### Tree and interactions

- Each group contains:
  - files under **No tag**;
  - tag sections with their files.
- Single-click a linked file to focus it.
- Double-click to open it.
- Only one linked file can be focused at a time.
- Clicking blank space or starting a marquee clears focus.
- Hover a linked file to see its full path.
- The subtitle shows aliases only; without aliases the main title is enlarged.
- Drag multi-selected linked files:
  - onto a group name: move to that group;
  - onto a tag name: move to that group and assign the tag;
  - between files: insert at that position.
- `Cmd/Ctrl+Z` undoes moves, deletions, renames, tag changes, and alias changes.

#### Importing linked files

- Filter candidates by filename in real time.
- Double-click a file to import it.
- Import directly when there is no conflict.
- If the filename conflicts with an existing filename or alias, a unique alias is required.
- If the alias also conflicts, the prompt remains until a unique alias is entered.

### Materials library

- Opened from the article-list toolbar and displayed in the right sidebar.
- Manages images and assets in the group's `src/` folder.
- Double-click empty space to import, rename, or delete assets.
- Images already used as a novel cover or volume poster are hidden from the library.
- The existing materials tab is reused when possible.

### Novel mode

Markdown files inside a novel group enter novel mode automatically.

- H1–H6 heading markers are hidden.
- Lists and blockquotes keep native Markdown behavior.
- Horizontal rules only remove first-line indentation.
- The top-left table of contents is split by separators; it is collapsed by default and expands on focus.
- The floating toolbar provides:
  - auto format;
  - insert image (file or materials library);
  - find/replace;
  - format settings.

#### Auto format

- Removes redundant blank lines;
- Keeps one blank line around separators, tables, lists, and blockquotes;
- Preserves code content while removing blank lines inside code;
- Trims leading/trailing spaces and tabs from paragraphs.

#### Keyword highlighting

- Linked keywords are highlighted automatically.
- Only the first occurrence of each keyword in a chapter is highlighted.
- Hovering a keyword shows a card with:
  - linked filename;
  - tag (empty if none);
  - group (empty if none).
- The card appears below the first character and disappears when the pointer leaves.

### Find and replace

- Opened from the novel-mode floating toolbar.
- Global floating card, independent of MainArea size.
- Drag the title bar to reposition it.
- Reuses a single window instead of creating duplicates.
- Scopes:
  - chapter;
  - volume;
  - book;
  - linked-library files.
- Live search while typing.
- Results are grouped by file and expand on click.
- The current novel group is shown below the window title.

### Format settings

Open **Format settings** from the novel-mode toolbar and adjust:

- font size;
- line height;
- paragraph spacing;
- first-line indent.

Changes apply immediately to open novel-mode views.

### Configuration

`novel.json` in the novel-group root stores group-level configuration. Example:

```json
{
  "novel-description": "A long farewell that begins in the old city.",
  "novel-cover": "src/cover.png",
  "volume-order": ["Volume One", "Volume Two"],
  "volumes": {
    "Volume One": {
      "description": "The old city arc.",
      "cover": "src/volume-1.png"
    }
  },
  "article-groups": [
    {
      "id": "group-1",
      "volume": "Volume One",
      "name": "Part One",
      "description": "The opening.",
      "paths": [
        "Long Night/Volume One/Chapter 1.md",
        "Long Night/Volume One/Chapter 2.md"
      ]
    }
  ]
}
```

Notes:

- The novel name comes from the folder name and is not stored in JSON.
- Legacy `NovelSetting.md` files are migrated to `novel.json` on first load. The original Markdown file is kept visible and can be archived or deleted manually.
- Article IDs are stored in `novelview-id`.
- Chapter status is stored in `novelview-state`.
- Linked-file data is stored in `links.json` in the novel-group root.

### Shortcuts

| Action | Shortcut |
| --- | --- |
| New chapter | `Cmd/Ctrl+N` in the article list |
| Undo article-list action | `Cmd/Ctrl+Z` in the article list |
| Undo linked-library action | `Cmd/Ctrl+Z` in the linked-file library |
| Multi-select articles | Marquee / Shift / Ctrl/Cmd |
| Open linked file | Double-click |
| Close find window | `Esc` |
| Cancel MainArea drag | `Esc` or drag outside MainArea |

### Development

```bash
npm install
npm run dev     # watch build
npm run check   # TypeScript check
npm test        # core tests
npm run build   # production build
```

Artifacts:

```text
main.js
styles.css
manifest.json
```

See [docs/DESIGN.md](docs/DESIGN.md) for design notes.

### License

Author: **yukisova**  
License: [MIT License](LICENSE)
