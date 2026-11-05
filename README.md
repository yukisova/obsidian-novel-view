# Novel View

<p align="center">
  <a href="#中文文档">中文</a> · <a href="#english">English</a>
</p>

<p align="center">
  <img alt="version" src="https://img.shields.io/badge/version-0.9.12-9a5a2d">
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

1. 下载 [novel-view-0.9.12.zip](dist/novel-view-0.9.12.zip)。
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

设定集用于整理小说的设定资料，替代原联动库。

- 在 Obsidian 文件列表右击小说组，可选择 **构建设定集**。
- 插件会在小说组内创建 `-设定` 文件夹，文件列表显示时忽略开头的 `-`。
- 小说组在文件列表中强制展开，只显示其下的设定集，且不可折叠。
- 设定集自身可以正常展开/折叠查看其下文件。
- 设定集文件不会进入小说章节编辑模式，按普通 Markdown 文件打开。

#### index.json

设定集目录必须包含 `index.json`。文件缺失时插件会自动重建；重建时会优先保留现有组文件夹。

```json
{
  "人物": [
    {
      "tag": "主角",
      "color": "#ff0000",
      "contain": [
        {
          "keyword": "零一",
          "content": "主角设定简介"
        }
      ]
    }
  ],
  "地点": []
}
```

- 每个顶层键是一个设定分组，值是该组的标签列表。
- 每个标签包含 `tag`、`color` 和 `contain`。
- `contain` 中每条记录包含 `keyword` 和 `content`。
- 插件会根据 index.json 的设定分组名，在设定集目录中自动创建对应文件夹。
- 设定集目录中不存在于 index.json 的设定分组文件夹会被自动删除，视为外部加入的目录。
- 在文件列表内重命名设定分组文件夹时，会自动更新 index.json 的分组名；若新名称缺少 `-` 前缀，会自动补回，避免文件夹被目录同步删除。
- index.json 修改后会自动重新同步文件夹。
- 文章列表工具栏的“设定集”入口用于查看 index.json 中的组、标签和记录。
- 设定集完全取代原联动库；联动库视图、links.json 读写和旧关键词高亮代码均已移除。
- 文章列表工具栏的设定集按钮始终可以打开设定集视图；尚未构建设定集时，视图内提供“构建设定集”按钮。
- 设定集视图提供“导入设定”按钮：选择一个文件夹后，其一级子文件夹名称会作为新的设定分组，子文件夹内容递归导入到对应的 `-分组名` 文件夹。
- 设定集标题显示对应设定集文件夹名称（隐藏开头 `-`），副标题显示小说组名。
- 设定集空白处右击可新建设定分组；尚未构建设定集时该菜单为构建设定集。
- 设定记录悬停时的详细文件按钮不显示标题，与简介以分隔线隔开，左对齐并每行两个。
- 设定集视图支持：
  - 新建、重命名、删除设定分组；
  - 在分组下新建标签、选择标签颜色；
  - 在标签下新建、编辑、删除设定记录；
  - 设定记录包含关键词与简介，关键词在同一分组内唯一。
- 卡片根据鼠标悬停自动展开、折叠：
  - 设定分组默认只显示标题，悬停展开标签列表；
  - 标签默认只显示名称，悬停展开记录；
  - 记录默认只显示关键词，悬停显示简介；
  - 鼠标移出后自动折叠，同一时间只展开当前悬停层级。
- 拖拽操作期间会自动展开所有分组和标签，方便定位放置目标。
- 从正文关键词跳转时，会强制展开并高亮对应分组、标签和记录。
- 设定记录的详细文件：
  - 放在该记录所属设定分组文件夹下；
  - 文件名以 `关键词-标题.md` 命名，例如 `小王-生平履历.md`；
  - 设定集视图中悬停记录会列出详细文件，点击打开；
  - 记录右侧 `+` 或右键可新建详细文件；
  - 记录重命名时详细文件前缀同步重命名；
  - 记录或标签跨设定分组移动时，详细文件跟随移动。
- 设定集支持拖拽移动：
  - 拖动记录到其他标签：移动记录；
  - 拖动记录到另一条记录前后：调整记录顺序；
  - 拖动标签到其他设定分组：移动标签及其记录；
  - 拖动标签到另一标签前后：调整标签顺序或跨组插入；
  - 拖动设定分组到另一分组前后：调整分组顺序；
  - 目标位置出现插入线或高亮边框；
  - 标签重名或关键词重复时取消移动并提示。

### 素材库

- 从文章列表工具栏打开，位于右侧边栏。
- 用于管理小说组 `src/` 中的图片与素材。
- 支持双击空白处导入、重命名、删除。
- 已被小说封面或卷海报引用的图片不会在素材库中重复显示。
- 再次打开时优先复用已有素材库标签页。

### 小说模式

小说组内的 Markdown 文件会由独立的 **Novel Editor** 视图打开，不进入原生 MarkdownView，也不复用其渲染逻辑。

- 独立视图使用纯文本编辑器，不解析 Markdown。
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
- 设定集数据保存在小说的 `-设定/index.json`。
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

1. Download [novel-view-0.9.12.zip](dist/novel-view-0.9.12.zip).
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

The setting collection organizes worldbuilding reference material and replaces the former linked-file library.

- Right-click a novel group in Obsidian's file explorer and choose **Build setting collection**.
- The plugin creates a `-设定` folder inside the novel group; the leading `-` is hidden in the file explorer.
- The novel group is forced open and shows only its setting collection, without a collapse control.
- The setting collection itself expands and collapses normally to show its files.
- Setting-collection files are not novel chapters and open as normal Markdown files.

#### index.json

The setting-collection folder must contain `index.json`. If it is missing, the plugin recreates it, preserving existing group folders where possible.

```json
{
  "人物": [
    {
      "tag": "主角",
      "color": "#ff0000",
      "contain": [
        {
          "keyword": "零一",
          "content": "Protagonist profile"
        }
      ]
    }
  ],
  "地点": []
}
```

- Each top-level key is a setting group; its value is a list of tags.
- Each tag has `tag`, `color`, and `contain`.
- Each `contain` entry has `keyword` and `content`.
- The plugin creates one folder under the setting collection for each index group.
- Folders not present in index.json are automatically deleted as externally added directories.
- Editing index.json automatically resynchronizes the group folders.
- The article-list **Setting collection** entry displays groups, tags, and records from index.json.
- Setting-group folders use a leading `-` (for example `-设定/-人物`) and are kept in sync with index.json.
- Renaming a group folder in the file explorer updates its index key and restores the leading `-` if omitted.
- The setting-collection view offers **Import settings**: each direct subfolder becomes a setting group, and its contents are imported recursively.
- The setting collection fully replaces the old linked-file library, whose code has been removed.
- The view title shows the setting-collection folder name with its leading `-` hidden; the subtitle shows the novel group.
- Right-clicking empty space offers “New setting group” (or “Build setting collection” when missing).
- Record detail buttons are left-aligned, two per row, with no “detail files” heading and separated from the description by a divider.
- Setting-record keywords are highlighted in the novel editor using their tag color.
- Hovering a keyword shows a card with the keyword title, tag on the left, setting group on the right, description between dividers, and two-column detail-file buttons.
- Clicking a keyword opens the setting collection and focuses the matching record.
- The old article-toolbar “linked-file library” entry now opens the setting collection view.
- The view supports creating, renaming, and deleting setting groups; creating colored tags; and creating/editing/deleting records with a unique keyword per group.
- Detail files for setting records:
  - Live in the record's setting-group folder;
  - Use `keyword-title.md`, for example `小王-生平履历.md`;
  - Appear under the record on hover and open on click;
  - Can be created from the record's `+` button or context menu;
  - Are renamed with the record keyword and move with the record or tag across groups.
- Cards expand and collapse on hover:
  - A group shows only its title until hovered, then reveals its tags;
  - A tag shows only its name until hovered, then reveals its records;
  - A record shows only its keyword until hovered, then reveals its description;
  - Leaving the area collapses it again;
  - All groups and tags expand while dragging to make drop targets reachable.
- Keyword navigation forces the matching group, tag, and record open and highlighted.
- Drag and drop:
  - Drag a record onto another tag to move it;
  - Drop a record before or after another record to reorder;
  - Drag a tag onto another group to move it with its records;
  - Drop a tag before or after another tag to reorder or insert across groups;
  - Drop a group before or after another group to reorder groups;
  - Insertion lines and highlighted drop zones show the target;
  - Duplicate tag names or record keywords cancel the move with a notice.

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
- Setting-collection data is stored in `-设定/index.json` inside the novel group.
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
