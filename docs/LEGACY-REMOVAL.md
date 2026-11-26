# 旧包摘除记录

> 状态：**已完成**（2026-11-27）
> 结果：`src/legacy/` 已删除，`NovelViewPlugin extends Plugin`
> 产物：524 418 → **411 212 字节**（−113 206，−21.6%）
> `src/main.ts`：1457 → 1800 行（接管了原本由旧包提供的成员）

---

## 一、删掉了什么

`src/legacy/` 三件套被整体移除：

- `legacy-main.cjs` —— 旧版插件的压缩产物（131 239 字节，无源码）
- `legacy-main.d.ts` / `legacy-main.d.cts` —— 手写类型声明（与实现脱节）

主类从继承旧包改为直接继承 `Plugin`。产物里已无任何旧包痕迹：

```
novelview-link-library   0
novelview-link-keyword   0
novelview-link-import    0
```

---

## 二、被接管的成员与去处

| 原本由旧包提供 | 新去处 |
| --- | --- |
| `settings` / `volumeOrder` / `saveSettings` / `loadSettings` / `loadVolumeOrder` | `main.ts` 自有字段与实现（`data.json` 结构不变） |
| `novelToolbars` / `lastActiveMarkdownPath` / `workbenchFolderPath` / `saveChain` | `main.ts` 字段 |
| `getActiveMarkdownView` / `getLastActiveMarkdownFile` / `rememberActiveMarkdownFile` | `main.ts`（各 3–6 行） |
| `applyModeStyles` / `clearNovelModeStyles` / `syncView` / `refreshOpenViews` / `refreshEditor` / `applySettingsToOpenModes` | [features/novel-mode/index.ts](../src/features/novel-mode/index.ts) |
| `decorateNovelFolderTitles` / `scheduleNovelFolderDecoration` / `setupNovelFolderObserver` | 同上 |
| `openArticleList` / `activateWorkbench` / `setWorkbenchGroup` / `getWorkbenchFolderPath` / `removeSidebarWorkbenchInstances` / `isLeafInSidebar` | [features/workbench/navigation.ts](../src/features/workbench/navigation.ts) |
| `getArticleListModel` | [features/article-list/model.ts](../src/features/article-list/model.ts) + `main.ts` 的编号后处理 |
| `chooseLocalImage` / `saveImageToVault` / `insertNovelImage` / `insertImageFromLibrary` / `getNovelToolbarScope` | [features/novel-editor/images.ts](../src/features/novel-editor/images.ts) |
| `createVolumeInFolder` / `restoreFileExplorer` / `openWorkbenchForGroup` / `cancelNovelGroup` / `destroyArticleStatus` | `main.ts` 直接实现 |
| `openFileAtLine` | `main.ts`（非小说文件走原生 markdown 定位） |
| 小说模式逐行排版 CodeMirror 扩展 | [editor/novel-mode-extension.ts](../src/editor/novel-mode-extension.ts) |
| `addNovelGroupMenuItem` | `main.ts`（构建 / 打开 / 取消构建三项） |

---

## 三、`onload` 的接管结果

| 旧包职责 | 处理 |
| --- | --- |
| 编辑器扩展（小说排版） | 注册 `novelProseExtension` |
| 编辑器扩展（联动关键词高亮） | **丢弃**（功能已退役，数据源早已被切断） |
| 5 个视图注册 | 由 `registerCoreViews` 直接注册 6 个自有视图；`novelview-search-results`、`novelview-link-library` 两个死类型一并丢弃 |
| 旧设置页 | 丢弃（新版本无设置页） |
| `registerCommands` | 无命令（`main.ts` 的 `open-novel-editor` 仍在） |
| 小说组右键菜单 + 文件夹点击 | `registerNovelGroupEvents` |
| 布局就绪：记住活动文件 / 清侧栏工作台 / 刷新视图 / 装文件夹观察者 | `registerStartupHooks` |
| 事件：`file-open`、`active-leaf-change`、`layout-change`、vault `create`/`rename`/`delete`/`modify`、metadata `changed`/`resolved` | 分别并入 `registerWorkspaceEvents` / `registerVaultEvents` / `registerNovelGroupEvents` |
| `onunload` 清理 | 自有实现：断开观察者、清状态卡定时器、销毁工具栏与搜索面板、清 `novel-mode` class、落盘设置 |

---

## 四、验证

| 检查项 | 结果 |
| --- | --- |
| `npx tsc --noEmit` | ✅ |
| `node scripts/test.mjs` | ✅ 33/33 |
| `npm run build:only` | ✅ 411 212 字节 |
| 产物旧包残留 | ✅ 0 处 |
| `grep -rn legacy src` | ✅ 仅剩描述旧数据迁移的局部变量名 |

---

## 五、回滚方式

旧包已备份到 `.snapshots/legacy-main.cjs.bak-20261127T192435`（`.snapshots/` 在 `.gitignore` 中）。若需回退：

1. 从备份恢复 `src/legacy/legacy-main.cjs` 与两份 `.d.ts`；
2. 恢复 `extends LegacyNovelViewPlugin` 与 `installLegacyViewBridge`（可从本文档的历史版本或会话记录恢复）。

---

## 六、切换后需要人工回归的点

自动化只覆盖类型与构建，以下必须真机确认：

1. 小说模式正文排版（首行缩进、段距、块级行、空行标记）
2. 侧栏小说组文件夹的标题标记
3. 编辑器右下角状态区（现在是 frontmatter 保护与源码模式，不再有字数卡）
4. 工作台：打开、切换小说组、侧栏实例清理
5. 文章列表 / 设定列表 / 素材库的打开与复用
6. 本地插图与素材库插图
7. 小说组文件夹右键的「构建 / 打开 / 取消构建」
8. 关闭插件后：定时器、工具栏、浮层是否彻底释放

---

## 七、已知取舍

1. **`cleanupLegacyNoteProperties` 未迁移**：旧笔记里的 `novelview-type` 属性不再被自动清理。
2. **联动关键词彻底移除**：`novelview-link-keyword` 的高亮与点击逻辑随旧包一起删除。
3. **`novelview-search-results` 视图丢弃**：新代码从不打开它，旧布局里若有该 leaf 会变成空标签页。
4. **类型契约已修正**：`chooseLocalImage` / `saveImageToVault` 现在按真实的 `File` 语义声明（此前声明为 `string`，与实现不符）。
