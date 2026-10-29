# Novel View

**为 Obsidian 打造的小说写作工作流。**  
**A novel-writing workflow for Obsidian.**

![version](https://img.shields.io/badge/version-0.6.22-9a5a2d)
![Obsidian](https://img.shields.io/badge/Obsidian-%E2%89%A51.7.2-7c3aed)
![license](https://img.shields.io/badge/license-MIT-4d7c56)
![author](https://img.shields.io/badge/author-yukisova-356c9a)

Novel View 在 Obsidian 原生 Markdown 之上提供小说组、文章树、章节状态、素材库、联动库和联动关键词高亮。

<p align="center">
  <img src="docs/novelview-article-list.png" alt="Novel View 文章列表" width="100%" />
</p>

> 界面预览使用插件真实 CSS 与组件渲染，并非 Obsidian 实拍截图。

<p align="center"><a href="#english">English</a> · <a href="#中文文档">中文</a></p>

---

## English

**Novel View** is a Markdown-first novel workflow for Obsidian: novel groups, multi-select article tree, chapter statuses, materials/link libraries, and link-library keyword highlighting.

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

1. Download [novel-view-0.6.22.zip](dist/novel-view-0.6.22.zip).
2. Extract to `<Vault>/.obsidian/plugins/novel-view/`.
3. Enable **Novel View** in **Settings → Community plugins**.

Requires Obsidian **1.7.2+**.

### Article List

- Header: novel name + body count only.
- Replaces the left file explorer; title bar has a back action and the toolbar has a visible **返回** button.
- Multi-select: marquee, Shift range, Ctrl/Cmd toggle; blank click clears.
- Inline rename; multi-select disables rename.
- New article “无标题”, no duplicate H1; new volume “无名卷” with numbering.
- Each chapter row displays word count and status.
- Drag articles to reorder. Ordering is based only on the increasing `novelview-id` property, never on filenames.
- New articles get the next incremental ID in their folder.
- Dropping onto a volume name moves articles into that volume and renumbers them in order.
- Dropping between articles inserts at that position and renumbers the order.
- IDs are hidden from the tree.
- Drag preview uses a dashed/highlighted volume area or an insertion line between articles.
- Article-list refresh during a move is coalesced after ID renumbering to prevent visual jitter.
- Multi-selected articles can be dragged as a batch; IDs are reassigned by the new order.
- Cmd/Ctrl+Z undoes move, delete, and rename actions.
- Cmd/Ctrl+N creates a new chapter in the current novel group.
- The Scattered Volume is always shown, even when empty.
- **Import & Export** menu:
  - Import a TXT via the system file picker;
  - Export merges all novel-group articles via the system folder picker;
  - Multi-selected chapters merge into one TXT (volumes are ignored);
  - Single chapter exports as TXT;
  - Single volume exports all chapters as one TXT;
  - A system folder picker chooses the destination.

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

- No top toolbar. Right-click blank space → **新增联动组** / **导入联动文件**; selection is always available (marquee/Ctrl/Shift).
- JSON lives at `<novel-group>/links.json`; `link/` is no longer used.
- Any vault file type can be imported.
- Import opens a floating tree window; aliases can be set and confirmed with Enter.
- Groups have a highlight font style: normal / bold / italic / bold-italic / underline (no group color).
- Each linked file can optionally have one tag. Tags appear as collapsible branches under the group; the tag color is shown as a colored dot on the right.
- Groups show a small style preview; unbound tags are removed automatically.
- Only linked files participate in multi-selection; groups/tags are never selected.
- Tag editing uses six preset colors (red/orange/yellow/green/blue/purple) plus a custom color.
- Batch add tag / batch delete are available from the right-click menu on a multi-selection.
- Right-click group: **编辑字体样式 / 重命名 / 删除**.
- Right-click file: **编辑标签与别名 / 重命名 / 删除**.
- Rename is inline; edit opens a modeless panel (no dialog, no rename field).
- Missing imported files are pruned automatically when loading/refreshing.

```json
{
  "group": { "人物": { "style": "bold" } },
  "tag": { "人物": { "湖南大学": "#e5484d" } },
  "link": [
    { "未命名.md": { "belong": "人物", "tag": "湖南大学", "alias": ["你好"] } },
    { "~/仓库内引用.md": { "alias": ["你好hk"] } }
  ]
}
```

Keywords use filename + alias; tag color is the highlight color; group style is the font style. `~/` resolves from the vault root; bare paths fall back through the current volume/group/legacy link paths.

### Materials Library

- Empty state shows a semi-transparent watermark: double-click blank area to import images.
- Each card has an **重命名** button; no right-click menu.
- Title bar has a single image icon.

### Novel Mode

- Automatic inside novel groups; no manual toggle.
- Lists/quotes native; tables/images centered.
- Toolbar: auto format, insert image → from file / from materials; larger picker with names.
- Auto format removes blank lines except one blank line before/after separators, tables, lists, and blockquotes; all other blank lines (including fenced code) are removed.
- It also trims leading/trailing spaces and tabs from paragraph lines.
- Heading markers H1-H6 are hidden automatically.
- Horizontal rules split the article into sections; a floating TOC in the upper-left provides quick navigation.

### Search

- Entry moved to the novel-mode floating toolbar; the old header/workbench buttons and command are removed.
- Scopes: current chapter, current volume, whole book, link-library files.
- Results are grouped by file; click a file card to expand its match cards.
- Results are displayed as scrollable/ellipsized cards.
- Search runs live while typing; there is no separate Find button.
- The panel is a global floating card (not constrained to MainArea); reopening in another chapter reuses the same window and updates the range.
- Result title shows: 查找结果 · range type · novel group.

### Format Settings

- New “格式设置” button in the floating toolbar.
- Modeless window with live controls for font size, line height, paragraph spacing, and first-line indent.
- Values apply immediately and persist.

### Settings

The plugin settings tab still contains the remaining controls; the four typography sliders above are available directly in the novel-mode window.

### Author

**yukisova** · MIT License · [Design notes](docs/DESIGN.md)

---

## 中文文档

### 简介

Novel View 为 Obsidian 增加小说写作层，不替换原生 Markdown 编辑器。0.6.22 增加章节字数/状态、联动库工具栏与多选，移除小说状态、描述和全部特殊页面。

### 安装

下载 [novel-view-0.6.22.zip](dist/novel-view-0.6.22.zip)，解压到 `<Vault>/.obsidian/plugins/novel-view/`，在 **设置 → 第三方插件** 启用。最低 Obsidian **1.7.2**。

### 文章列表

- 标题仅显示小说名 + 正文数量；
- 替换左侧文件列表；标题栏有返回图标，工具栏有可见“返回”按钮；
- 每条章节显示字数与状态：待写、草稿、大纲、修改中、已完稿；
- 拖拽文章可调整顺序；排序仅依据递增的 `novelview-id` 属性，与文件名无关；
- 新建文章分配当前序列的下一个递增 ID；
- 拖到卷名上视为移入该卷并按顺序重排 ID；
- 拖到文章之间视为插入，并按插入位置重排 ID；
- ID 不在树状列表中显示；
- 拖拽预览：卷内容区虚线高亮；文章之间显示插入线；
- 移动期间合并刷新，ID 重排完成后一次更新，避免列表抖动；
- 多选文章可批量拖拽到其他卷；
- Cmd/Ctrl+Z 可撤销移动、删除、重命名；
- Cmd/Ctrl+N 在当前小说组新建章节；
- 分散卷始终显示，即使为空；
- “导入与导出”菜单：
  - 通过系统文件选择器导入 TXT；
  - 导出合并稿将小说组全部文章合并到系统文件夹指定的 TXT；
  - 多选章节合并为 TXT（卷自动忽略）；
  - 单章导出 TXT；
  - 单卷合并导出 TXT；
  - 通过系统文件夹选择器指定保存位置；
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

- 无顶部工具栏；右键空白处选择“新增联动组”或“导入联动文件”；
- 标题下显示当前小说组；导入窗口双击文件或回车导入；
- 新建联动组直接创建；“默认联动组”更名为“分散组”，始终置顶；
- 组/标签支持就地重命名，标签可右键改色；
- 多选文件可拖拽到组、标签或文件之间，显示虚线/高亮/插入线预览；
- 支持 Cmd/Ctrl+Z 撤销移动、删除、重命名；
- 多选逻辑始终可用：框选、Ctrl/Cmd 间断、Shift 连续；空白取消；
- 多选后右键可批量添加标签、批量删除；
- JSON 位于小说组根目录 `links.json`，不再使用 `link/`；
- 支持导入仓库内任意文件类型；
- 联动组编辑只设置高亮字体样式：正常、粗体、斜体、粗斜体、下划线，不再设置组颜色；
- 每个联动文件可有一个可选标签；标签作为组下的树节点；
- 标签颜色即关键词高亮色，提供红、橙、黄、绿、蓝、紫六个预设和自定义颜色；
- 右键联动组：编辑字体样式、重命名、删除；
- 右键联动文件：编辑标签与别名、重命名、删除；
- 重命名原位行内完成；编辑使用无遮罩浮动面板，不含重命名、不弹对话框；
- 加载/刷新时自动清理丢失文件的联动记录。

JSON 结构：

```json
{
  "group": { "人物": { "style": "bold" } },
  "tag": { "人物": { "湖南大学": "#e5484d" } },
  "link": [
    { "未命名.md": { "belong": "人物", "tag": "湖南大学", "alias": ["你好"] } },
    { "~/仓库内引用.md": { "alias": ["你好hk"] } }
  ]
}
```

关键词 = 文件名 + 别名；标签颜色作为高亮色，组样式作为字体样式。`~/` 从仓库根解析，裸路径依次回退当前卷、组根目录和旧 link 路径。

### 素材库

- 空状态中央显示半透明水印：双击空白区域可导入图片；
- 双击后选择图片并写入 `src/`；
- 每张素材卡提供“重命名”按钮，进入行内编辑；移除卡片右键菜单；
- 标题栏只保留一个素材库图标。

### 小说模式

- 自动模式；
- 多级列表原生；表格/图片居中；
- 工具栏：自动排版、插入图片（从文件/从素材库）；选择窗口更大并显示名称；
- 自动排版会在分隔线、表格、列表、引用块前后各保留一行空行；其余空行（含代码块内）删除；
- 自动清理段首、段尾的空格和 Tab。
- 自动隐藏 H1-H6 标题标记；
- 分隔线划分文章部分，左上角浮动目录提供跳转。

### 高级查找替换

- 入口移至小说模式左侧浮动工具栏；移除原标题栏按钮、工作台按钮和命令；
- 查找范围：全章、本卷、全书、联动库文件；
- 支持正则、大小写、全词；
- 查找框内容变化后实时查找，无独立“查找”按钮；
- 多文件结果先按文件展示，点击文件卡片展开该文件内的匹配；
- 结果以可滚动卡片展示，超出卡片宽度的文字省略；
- 浮动窗口为全局单例，不受 MainArea 限制；在其他章节再次打开时复用并更新范围；
- 标题显示：查找结果 · 范围类型 · 小说组。

### 格式设置

- 浮动工具栏新增“格式设置”按钮；
- 弹出无遮罩小窗口，实时调整字体大小、行距、段距、首行缩进；
- 修改立即应用并保存。

### 设置

插件设置页保留其余设置项；上述四项排版参数可直接在小说模式窗口中调整。

### 作者与许可

作者：**yukisova**，基于 [MIT License](LICENSE) 发布。


### 0.6.22 补充

- 联动库：直接新建组、就地重命名组/标签、标签右键改色、批量拖拽与预览、分散组常驻、Cmd+Z 撤销。
- 文章列表：聚焦文章/卷后按 Enter 进入重命名。
- 高级查找：窗口可拖动，标题下显示当前小说组；修复按钮无法打开窗口。
- 小说模式：字数/状态 UI 移到正文前、标题下固定显示。
- 工作台：详情卡扩大，移除“编辑小说信息”按钮；点击标题、简介、封面直接编辑。
