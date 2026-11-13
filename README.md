# Novel View

<p align="center">
  <a href="#中文文档">中文</a> · <a href="#english">English</a>
</p>

<p align="center">
  <img alt="version" src="https://img.shields.io/badge/version-0.10.3-9a5a2d">
  <img alt="Obsidian" src="https://img.shields.io/badge/Obsidian-%E2%89%A51.7.2-7c3aed">
  <img alt="license" src="https://img.shields.io/badge/license-MIT-4d7c56">
  <img alt="author" src="https://img.shields.io/badge/author-yukisova-356c9a">
</p>

Novel View 是一个面向长篇小说写作的 Obsidian 插件。小说文章使用独立的纯文本编辑视图，不经过 Obsidian 原生 MarkdownView 渲染；插件围绕小说组、文章列表、卷与文章组、素材库、设定集、小说模式和查找替换提供完整的写作工作流。

Novel View is a novel-writing workflow for Obsidian. It keeps the native Markdown editor and adds novel groups, an article tree, volumes and article groups, a materials library, a setting collection, novel mode, and find/replace.

> **桌面端专用。** 系统文件选择器、TXT 导入导出与封面资源管理依赖桌面端能力，插件已声明为 desktop-only。

---

## 中文文档

### 目录

- [安装](#安装)
- [快速开始](#快速开始)
- [Novel View 工作台](#novel-view-工作台)
- [文章列表](#文章列表)
- [卷与文章组](#卷与文章组)
- [设定集](#设定集)
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

1. 下载 [novel-view-0.10.3.zip](dist/novel-view-0.10.3.zip)。
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

工作台下方会显示 **历史记录** 卡片：每四小时为一个时间段，按日期倒序记录各章节的字数增减，仅保留最近 7 天。

封面与卷海报会保存到小说组的 `src/` 文件夹。

### 文章列表

小说组打开后，左侧文件浏览器会被文章列表替代。标题栏与工具栏均提供返回文件浏览器的入口。

#### 文章与卷

- 文章按属性 `novelview-id` 排序，与文件名无关。
- 新建文章自动分配当前序列的下一个递增 ID。
- 卷顺序保存在 `novel.json` 的 `volume-order` 中，不按名称排序。
- 卷名不能以 `-` 开头；重命名为该形式会取消并提示，`-` 前缀保留给设定集。
- 以 `-` 开头的文件夹不能构建为小说组。
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

右键选中文章 → **修改状态**，可批量设置状态。不同章节状态在文章列表中使用不同颜色显示。

#### 导入与导出

工具栏的 **导入与导出** 菜单提供：

- **导入 TXT**：按卷名、章名、正文行的格式批量创建卷和章节；
- **导出合并稿**：按卷名、章名、正文格式导出，并通过系统文件夹选择器保存。

#### TXT 格式

导入：

```text
第1卷 风起
第一章
　　正文第一行
　　
　　正文第二行
第二章
```

- `第x卷 卷名` 识别为卷标题，创建/复用同名卷。
- 非空且不以两个全角空格开头的行识别为章名。
- 以两个全角空格开头的行是正文；导入时删除这两个字符。
- 连续章名会创建空章节。
- 没有卷标题时，章节导入到小说组根目录。

导出：

```text
第1卷 风起
第一章
　　正文第一行
　　
　　正文第二行
```

- 卷标题为 `第n卷 ` 加原卷名。
- 正文每一行前加入两个全角空格，包括空行。
- 单章、单卷、选章和全组导出使用同一格式。

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

### 设定集

设定组直接放在小说组文件夹下，不再有统一的 `-设定` 容器。

- 设定组文件夹使用 `-` 前缀，例如 `-人物`；文件列表显示时隐藏前缀并标记“设定组”。
- 小说组左侧的展开按钮可展开/折叠，展开后同时显示卷与设定组。
- 右击小说组选择 **新建设定组**。
- 在文件列表点击设定组，会在右侧设定集页面打开该组。
- 点击设定组展开箭头，可查看其下详细文件。
- 设定组内的 `index.md` 是隐藏数据文件，不在文件列表显示，也不能通过常规打开流程查看。
- 旧版 `-设定/index.json` 会自动迁移为直接设定组和 `index.md`。

#### index.md

每个设定组文件夹内有一个隐藏的 `index.md`，正文包含 JSON 数据块：

```json
{
  "tags": [
    {
      "tag": "主角",
      "color": "#e74c3c",
      "contain": [
        {
          "keyword": "小红",
          "content": "小红在13岁那年离开旧宅。",
          "fields": [
            { "name": "年龄", "value": "16" },
            { "name": "性别", "value": "女" }
          ],
          "relations": [
            {
              "targetGroup": "人物",
              "targetKeyword": "小黄",
              "type": "兄妹",
              "direction": "two-way"
            }
          ],
          "marks": [
            { "start": 3, "end": 7, "attribute": "生平" }
          ]
        }
      ]
    }
  ]
}
```

- `fields` 是用户自定义属性，可填写年龄、性别、时间等任意名称和值。
- `relations` 用于链接其他设定记录：
  - `targetGroup`、`targetKeyword` 指定目标；
  - `direction` 为 `one-way` 或 `two-way`；
  - 设定集页面顶部按钮打开独立的关系图谱悬浮卡片，显示节点、单向箭头和双向箭头。
- 标签编辑窗口提供名称、颜色选择器、色值和六色预设圆点，当前颜色带选中圆环。
- 关系图谱使用终点单箭头表示单向，两端箭头表示双向；左向单向的箭头位于源节点。
- 工作台小说简介下方只列出小说组根目录下以 `-` 开头的 Markdown 文件，显示时省略 `-` 与 `.md`。
- 点击这些文件会以普通 MarkdownView 打开，不进入 NovelEditor，也不计入分散卷。
- 文件行悬停可重命名或删除；重命名会自动保留 `-` 前缀。

#### 设定记录

- 记录可新建、编辑、删除，并支持标签、字段和关系。
- 记录关键词可留空。
- 记录字段在编辑窗口中以“属性名 / 值”成对添加和删除，可自由填写年龄、性别、时间等。
- 关系通过目标设定组、目标记录、关系名称和方向下拉框添加；单向关系可指定左向或右向。
- 保存关系时会同步写入目标记录的对向关系；两端共享同一个关系值、类型和全局方向，图谱自动去重。
- 单向关系的反向记录使用相反的左右箭头，例如小红卡片显示 ← 时，旧宅卡片显示 →。
- 属性可在编辑卡中上移、下移调整顺序；详情卡根据内容长度自动使用并排、单行或标题正文布局。
- 记录详细文件使用 `关键词-标题.md`，放在所属设定组文件夹内。

#### 演示小说组

主仓库中提供了：

```text
小说/NovelView 功能演示
```

包含人物、地点两个设定组，以及字段、兄妹双向关系、关系图谱和详细文件示例。

### 素材库

- 从文章列表工具栏打开，位于右侧边栏。
- 用于管理小说组 `src/` 中的图片与素材。
- 支持双击空白处导入、重命名、删除。
- 已被小说封面或卷海报引用的图片不会在素材库中重复显示。
- 再次打开时优先复用已有素材库标签页。

### 小说模式

小说组内的 Markdown 文件会由独立的 **Novel Editor** 视图打开，不进入原生 MarkdownView，也不复用其渲染逻辑。

- 独立视图使用纯文本编辑器，不解析 Markdown。
- 所有文章均可通过右键选中文字添加文字标记，标记保存在文章 frontmatter 中；工具栏不再提供文字标记按钮。
- 正文中的所有字符原样显示，包括 `#`、`**`、`[]()`、列表符号等 Markdown 标记。
- 标题、加粗、斜体、链接、列表、引用块和代码块不应用 Markdown 视觉格式。
- YAML 笔记属性不会载入编辑器，既不显示也无法编辑；保存时自动保留原属性。
- 分隔线显示为视觉分隔线。
- 联动关键词保留颜色，移除下划线。
- 不显示目录（TOC）卡片。
- 格式设置中的字号、行高、段距、首行缩进均会实时应用到独立编辑器。
- 正文开头显示当前文章标题，顶格、加粗，字号为正文的 1.2 倍。
- 右上角提供目录（TOC）缩略卡片：默认显示三条短横线；鼠标悬停在 TOC 卡片上时展开为按 `---` 分隔的章节卡片列表，移出后恢复缩略状态，点击可跳转。
- 左下角浮动工具栏卡片提供：
  - 自动排版；
  - 插入图片；
  - 高级查找替换；
  - 格式设置。
- 插入的图片在正文中以块级图片实时显示，并保留原始嵌入链接。
- 编辑器内右键菜单暂时禁用。

#### 待修改部分

- 使用 ` ```待修改部分🟢 ` 开启一个待修改代码块，结尾使用 ` ``` ` 关闭。
- 标题写在 emoji 后，例如 ` ```待修改部分🔴 雨夜重写 `。
- emoji 决定整个待修改部分的背景颜色；未写 emoji 时默认绿色。
- 代码块围栏、标题和关闭符号不会直接显示或进入编辑。
- 光标位于待修改正文时，右侧出现浮动按钮；鼠标悬停可修改标题、切换背景 emoji，或移除代码块标记（保留正文）。
- TOC 中待修改部分条目使用对应 emoji 背景色。
- TOC 会把待修改部分作为独立条目，并忽略块内的 `---` 分隔线。
- 输入后自动保存，关闭视图前会完成最后一次保存。
- 普通 MarkdownView 不再被小说模式修改，其编辑与渲染逻辑保持原生行为。

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
- 每个设定组的数据保存在其文件夹内的隐藏 `index.md`。
- `history` 由工作台历史记录自动生成，无需手动维护。

### 快捷键与操作

| 操作 | 方式 |
| --- | --- |
| 新建章节 | 文章列表内 `Cmd/Ctrl+N` |
| 撤销文章列表操作 | 文章列表内 `Cmd/Ctrl+Z` |
| 多选文章 | 框选 / Shift / Ctrl/Cmd |
| 关闭查找窗口 | `Esc` |
| 取消 MainArea 拖拽 | `Esc` 或拖出 MainArea |

### 开发

```bash
npm install
npm run dev     # 监听构建
npm run check   # TypeScript 检查
npm test        # 核心测试
npm run build   # 生产构建并同步到 Obsidian 主仓库插件目录
npm run deploy  # 仅同步构建文件
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
- [Setting collection](#setting-collection)
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

1. Download [novel-view-0.10.3.zip](dist/novel-view-0.10.3.zip).
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

A **History** card below the workbench detail groups chapter word-count changes into four-hour blocks, newest first.

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

Right-click selected articles → **Change status** to set it in bulk. Each chapter status has a distinct color in the article list.

#### Import and export

The toolbar's **Import & Export** menu provides:

- **Import TXT**: bulk-create volumes and chapters from the volume/chapter/body format;
- **Export merged manuscript**: export in the same volume/chapter/body format to a chosen folder.

#### TXT format

Import:

```text
第1卷 风起
第一章
　　正文第一行
　　
　　正文第二行
第二章
```

- Lines like `第x卷 卷名` create or reuse a volume.
- Other non-empty lines that do not start with two ideographic spaces are chapter titles.
- Lines starting with two ideographic spaces are body text; those two characters are removed on import.
- Consecutive chapter titles create empty chapters.
- Without a volume heading, chapters are created at the novel-group root.

Export:

```text
第1卷 风起
第一章
　　正文第一行
　　
　　正文第二行
```

- Volume headings are `第n卷 ` plus the original volume name.
- Every body line, including blank lines, gets two leading ideographic spaces.
- Single-chapter, single-volume, selected-chapter, and whole-group exports use the same format.

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

### Setting collection

Setting groups are direct children of the novel group; there is no shared `-设定` container.

- Setting-group folders use a leading `-`, for example `-人物`; the prefix is hidden in the file explorer and a “设定组” badge is shown.
- Expand the novel group normally to see volumes and setting groups.
- Right-click the novel group and choose **New setting group**.
- Click a setting group in the file explorer to open that group in the setting-collection sidebar.
- Expand a setting group to see its detail files.
- Each group contains a hidden `index.md`; it is not shown in the file explorer.
- Legacy `-设定/index.json` data is migrated automatically.

#### index.md

Each group stores tags and records in a JSON block inside `index.md`:

```json
{
  "tags": [
    {
      "tag": "主角",
      "color": "#e74c3c",
      "contain": [
        {
          "keyword": "小红",
          "content": "小红在13岁那年离开旧宅。",
          "fields": [{ "name": "年龄", "value": "16" }],
          "relations": [
            {
              "targetGroup": "人物",
              "targetKeyword": "小黄",
              "type": "兄妹",
              "direction": "two-way"
            }
          ],
          "marks": [{ "start": 3, "end": 7, "attribute": "生平" }]
        }
      ]
    }
  ]
}
```

- `fields` stores arbitrary user-editable attributes such as age, gender, or time.
- `relations` links setting records. `direction` can be `one-way` or `two-way`; the graph opens in a separate floating card.

#### Records

- Records support tags, arbitrary fields, relations, and marked description ranges.
- Record keywords may be empty.
- Fields are edited as addable name/value rows.
- Relations use target-group and target-record dropdowns plus a direction selector.
- Selected description text can be marked with an attribute such as “生平”.
- Detail files use `keyword-title.md` inside the owning setting-group folder.

#### Demo novel group

A demo group is included in the vault:

```text
小说/NovelView 功能演示
```

It demonstrates character and location groups, custom fields, a two-way sibling relationship, marked attributes, a relationship graph, and detail files.

### Materials library

- Opened from the article-list toolbar and displayed in the right sidebar.
- Manages images and assets in the group's `src/` folder.
- Double-click empty space to import, rename, or delete assets.
- Images already used as a novel cover or volume poster are hidden from the library.
- The existing materials tab is reused when possible.

### Novel mode

Markdown files inside a novel group open in the standalone **Novel Editor** view, not the native MarkdownView.

- The standalone view uses a plain-text editor and does not parse Markdown.
- Every character is shown as-is, including Markdown markers such as `#`, `**`, `[]()`, and list bullets.
- Headings, bold, italics, links, lists, quotes, and code blocks do not apply Markdown formatting.
- YAML properties are never loaded into the editor, so they are neither visible nor editable; they are preserved when saving.
- Separators render as visual dividers.
- Linked keywords keep their color without an underline.
- The table of contents (TOC) card is not displayed.
- Format settings for font size, line height, paragraph spacing, and first-line indent apply live to the standalone editor.
- The current article title appears at the top, unindented and bold at 1.2× body size.
- A TOC thumbnail sits at the top right: three short bars by default; hovering the TOC card expands a boxed section list split by `---`, and leaving it collapses again. Click an entry to jump.
- The floating toolbar card at the bottom-left provides:
  - auto format;
  - insert image;
  - find/replace;
  - format settings.
- Inserted images render as block-level images in the body while preserving their embed markup.
- Select prose and right-click to choose “转换成待修改代码块”; pending titles default to “待修改部分” with automatic numbering when duplicated.
- Right-clicking without a selection no longer shows the default context menu.

#### Pending revisions

- Start a pending-revision block with ` ```待修改部分🟢 ` and close it with ` ``` `.
- Put a custom title after the emoji, for example ` ```待修改部分🔴 Rainy-night rewrite `.
- The emoji selects the block background color; green is used when no emoji is present.
- Fence lines, the title, and the closing fence are hidden from direct editing.
- When the caret is inside the block content, a floating button appears on the right; hover it to edit the title, change the emoji color, or remove the block markers while keeping the prose.
- TOC entries for pending blocks use the matching emoji background color.
- The TOC lists the pending block as its own section and ignores `---` separators inside it.
- Changes save automatically, with a final save when the view closes; split views of the same file save the current editor and reload the latest content when focus switches.
- Normal MarkdownView is no longer modified by novel mode and keeps native editing and rendering.

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
- Each setting group stores data in a hidden `index.md` inside its folder.
- `history` is maintained automatically by the workbench history card.

### Shortcuts

| Action | Shortcut |
| --- | --- |
| New chapter | `Cmd/Ctrl+N` in the article list |
| Undo article-list action | `Cmd/Ctrl+Z` in the article list |
| Multi-select articles | Marquee / Shift / Ctrl/Cmd |
| Close find window | `Esc` |
| Cancel MainArea drag | `Esc` or drag outside MainArea |

### Development

```bash
npm install
npm run dev     # watch build
npm run check   # TypeScript check
npm test        # core tests
npm run build   # production build + deploy to the main Obsidian vault
npm run deploy  # deploy existing build artifacts only
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


## NovelFinder

- 原“高级查找替换”卡片更名为 NovelFinder。
- 查找结果显示在右侧 NovelFinder 结果侧栏，点击可跳转。
- 查找范围支持：本章、本卷、全书、文字标记、待修改部分、关键词。
- 替换输入框单独一行；文字标记、待修改部分和关键词范围不支持替换。
- 关键词悬浮卡支持一对多分页，点击关键词打开当前页对应的设定记录详情卡。

## NovelEditor

- 章节标题位于编辑器顶部，可直接点击改名；名称不允许以 `-` 开头。
- 修复标题字段与 Obsidian 视图属性冲突导致 NovelEditor 内容空白的问题。
- 标题移出 CodeMirror 文档，避免上下方向键和鼠标点击时光标跳转异常。
