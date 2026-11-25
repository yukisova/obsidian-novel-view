# Novel View：移动端支持与目录重排方案

> 状态：**方案稿，尚未执行**
> 基线版本：0.12.1（本会话内不提升版本号，见下文「前提」）
> 目标：让插件能在 Obsidian 移动端加载并可用；为此重排 `src/` 目录结构。

---

## 0. 前提与约束

1. **版本号冻结**：本次改造期间不修改 `manifest.json` / `package.json` / `versions.json` 的 `version` 字段。改动只在 `src/`、`styles.css`、`docs/` 内进行。
2. **当前没有版本控制**：工作目录下不存在 `.git`（`git status` 返回 *not a repository*）。`src/` 有 21767 行 TypeScript + 一个压缩产物，任何批量移动都不可逆。
   **执行前置条件：先 `git init` 并提交一次基线，或至少打一个带时间戳的完整快照。**
3. 本文档只描述方案，**不修改任何代码**。

---

## 0.1 执行进度（2026-11-20）

移动端支持推迟，本次只执行「目录重排」。已完成：

- 42 个文件搬移，114 处相对 import 说明符重写（`scripts/test.mjs` 的入口表同步更新）。
- 验证结果：`tsc --noEmit` 通过；`node scripts/test.mjs` 44/44 通过；`npm run build:only` 产出的 `main.js` 与重排前**逐字节一致**（sha256 `ec19b6c8…`），即改动是纯结构性的。
- 重排前快照：`.snapshots/pre-restructure-20261120T060604.tar.gz`（已加入 `.gitignore`）。

**当前实际结构与 §2 目标的差异**（均为后续阶段的工作，本次刻意未做）：

| 目标项 | 现状 |
| --- | --- |
| `platform/` 层 | 未创建（属于移动端阶段 1） |
| `app/plugin.ts` 拆分 | `main.ts` 仍在 `src/` 根部，5 157 行未拆（阶段 4） |
| 依赖环拆解 | 未做，9 个视图仍 `import type` 自 `../main`（阶段 2） |
| legacy 排空 | 未做，三件套已集中到 `src/legacy/`（阶段 6） |
| `isDesktopOnly` | 仍为 `true`（阶段 7） |

因此下面 §2 的目录树是**最终目标**，不是当前状态；已落地的部分见 §2.1。


---

## 1. 现状盘点

### 1.1 体量

| 指标 | 数值 |
| --- | --- |
| `src/` 下 `.ts` 文件 | 45 个实现 + 1 个 `.d.ts`（20 个实现平铺在顶层） |
| `src/` 下 TypeScript 行数 | 21 767 行 |
| `src/main.ts` | 5 157 行（既是入口，也是大部分实现） |
| `src/legacy-main.cjs` | 131 239 字节，**单行压缩产物** |
| `styles.css` | 8 622 行 / 209 371 字节 |

### 1.2 关键结构：新旧代码是「继承」关系，不是并列关系

```
NovelViewPlugin (src/main.ts, 5157 行)
        extends
LegacyNovelViewPlugin (src/legacy-main.cjs, 压缩产物)
        ↑ 由 src/legacy-main.d.ts 手写声明 47 个成员
```

- `main.ts` 里有 5 处 `LegacyNovelViewPlugin.prototype.xxx.call(this, …)`（`applyModeStyles`、`openFileAtLine`、`getArticleListModel` 等）和 3 处 `super.`。
- 这意味着：**legacy 不是死代码，它仍在提供约 40 个方法的实现**。这是典型的绞杀者（strangler fig）迁移中途状态。
- `src/legacy-main.d.ts` 是唯一描述这层契约的文件，**已与实现脱节**（见 §1.4-D）。

### 1.3 依赖环

9 个视图文件通过 `import type NovelViewPlugin from "./main"` 反向依赖入口：

```
src-gallery-view.ts    workbench-view.ts       novel-finder-view.ts
mark-collection-view.ts   setting-collection-view.ts   setting-list-view.ts
novel-editor-view.ts   article-list-view.ts   search-panel-v2.ts
```

而 `main.ts` 又 import 了它们全部，且 `article-list-view.ts` 与 `main.ts` 互为依赖。这使 `main.ts` 无法被拆分——拆任何一块都会打破类型环。

### 1.4 移动端阻塞项（按严重程度分级）

#### A 级 · 致命：插件在移动端**无法加载**

`manifest.json` 声明 `isDesktopOnly: true`，但这只是表象。真正的问题在打包产物：

```
$ python3 -c 'print(open("main.js").read().find("require(\"fs\")"))'
132009   # 位于模块顶层作用域
```

产物中 `var Ke=require("fs"),ht=require("path")` 出现在**模块顶层**。`esbuild.config.mjs` 把 `builtinModules` 全部标为 external，所以这两行不会被 tree-shake 掉，也不会被包内提供的 polyfill 替代。在 Obsidian 移动端（WebView，无 Node 运行时）执行到这一行即抛错，**整个插件注册失败**——不是功能降级，是白屏。

因此：`isDesktopOnly` 改 `false` 只是最后一步的开关，前置必须先把 `fs` / `path` 从模块顶层移出。

#### B 级 · 功能降级：三处 Electron 对话框

| 功能 | 位置 | 移动端行为 |
| --- | --- | --- |
| 导出 TXT 到本地目录 | `main.ts:1063` `exportTxtFiles` | 目录选择器不可用 |
| 导入本地 TXT | `main.ts:2408` `importNovelTxt` | 文件选择器不可用 |
| 导入设定集目录 | `main.ts:3035` `importSettingCollection` | 目录选择器不可用 |

好的一面：这三处都已经过 `getElectronDialog()`（`main.ts:1182`，运行时探测 `window.require("electron")`），拿不到时弹 Notice 而非崩溃。**代码已有移动端意识，缺的是替代路径。**

#### C 级 · 交互失效：HTML5 拖拽在触摸屏不触发

| 文件 | `dataTransfer` / `draggable` / `dragstart` / `dragover` 命中 |
| --- | --- |
| `article-list-view.ts` | 20 处 |
| `setting-collection-view.ts` | 9 处 |
| `main.ts` | 6 处（文章列表拖拽状态机） |
| `special-editors/base-editor-view.ts` | 4 处 |
| **合计** | **39 处** |

拖动排序、拖入分组这些核心操作在手机上会**完全无响应**，需要换成 Pointer Events。

#### D 级 · 类型契约失真

`legacy-main.d.ts` 中：

```ts
chooseLocalImage(): Promise<string | null>;            // 实际返回 File
saveImageToVault(localPath: string, sourcePath: string, folderPath?: string): Promise<TFile | null>;
                                                        // 实际第一个参数是 File
```

`main.ts:1825` / `2678` 把 `chooseLocalImage()` 的返回值（运行时是 `File`）当作 `string` 传给 `saveImageToVault`。因为两边类型都写错、错误正好抵消，所以 `tsc --noEmit` 是绿的——**运行时靠鸭子类型侥幸工作**。做 `platform` 抽象时必须先修正签名，否则会把错误契约复制到新代码里。

#### E 级 · 样式

- 8 622 行单文件，含 7 个 `@media`：`max-width` 520 / 620 / 720 / 760，`min-width` 900，另有 `hover: none`。
- 已有窄屏基础，但没有统一的布局断点体系；依赖 `:hover` 揭示的操作在触摸设备上不可达。

---

## 2. 目标目录结构

按 **feature-first + 平台能力隔离** 组织。原则：`core/` 纯逻辑零依赖，`platform/` 是唯一的跨端分叉点，`features/` 每个目录自包含视图与弹窗。

```
src/
├── main.ts                  # 只做装配：onload 注册、视图注册、卸载清理
├── app/
│   ├── plugin.ts            # NovelViewPlugin 主体（从 main.ts 迁出）
│   ├── plugin-context.ts    # ★ 视图依赖的最小接口，用来解开 §1.3 的环
│   ├── commands.ts          # 命令注册
│   └── settings.ts          # 现有 settings.ts
├── core/                    # 纯逻辑：不 import obsidian、不碰 DOM
│   ├── text/                # paragraphs / format / format-utils / txt / status
│   ├── model/               # novel-config / chapter-status / outline-marks /
│   │                        # setting-collection / setting-special-data /
│   │                        # setting-icons / setting-drag / graph-relations
│   └── search/              # search
├── platform/                # ★ 新增：跨端分叉的唯一位置
│   ├── index.ts             # 能力探测：isDesktop / canUseNativeDialog / canUseLocalFolder
│   ├── picker.ts            # 图片 / 文本 / 目录选择
│   ├── desktop/
│   │   ├── electron-dialog.ts   # 现有 getElectronDialog 移入
│   │   └── file-io.ts           # ★ fs / path 只出现在这里，且必须懒加载
│   └── drag.ts              # Pointer 事件拖拽，替代 HTML5 DnD
├── editor/                  # CodeMirror 扩展（floating-toolbar 除外，见下）
├── ui/                      # 跨 feature 复用
│   ├── confirm-modal.ts
│   ├── text-prompt-modal.ts
│   └── floating-toolbar.ts
├── features/
│   ├── article-list/
│   ├── novel-editor/
│   ├── search/
│   ├── workbench/
│   ├── setting-collection/
│   ├── special-editors/
│   ├── link-library/
│   ├── text-marks/
│   └── src-gallery/
└── legacy/                  # ★ legacy-main.cjs + .d.ts 迁入；排空后整目录删除
```

### 2.1 文件归属映射

> 除 `main.ts` 的拆分（阶段 4，未做）外，下表已于 2026-11-20 全部落地。

| 原路径 | 重排后路径 |
| --- | --- |
| `main.ts` | 拆为 `app/plugin.ts` + `app/commands.ts`，视图逻辑下沉到各 feature |
| `settings.ts` | `app/settings.ts` |
| `legacy-main.cjs` / `.d.ts` / `.d.cts` | `legacy/` |
| `core/paragraphs.ts` `format.ts` `format-utils.ts` `txt.ts` `status.ts` | `core/text/` |
| `core/novel-config.ts` `chapter-status.ts` `outline-marks.ts` `setting-collection.ts` `setting-special-data.ts` `setting-icons.ts` `setting-drag.ts` `graph-relations.ts` | `core/model/` |
| `core/search.ts` | `core/search/` |
| `editor/markdown-extension.ts` `frontmatter-hide-extension.ts` `outline-marks.ts` `pending-block.ts` `setting-keyword-extension.ts` | `editor/` |
| `editor/floating-toolbar.ts` | `ui/floating-toolbar.ts` |
| `article-list-view.ts` `article-group-modal.ts` `volume-edit-modal.ts` | `features/article-list/` |
| `novel-editor-view.ts` | `features/novel-editor/` |
| `search-panel-v2.ts` `novel-finder-view.ts` | `features/search/` |
| `workbench-view.ts` | `features/workbench/` |
| `setting-collection-view.ts` `setting-list-view.ts` `setting-collection-modal.ts` `setting-record-detail-panel.ts` `setting-record-editor-panel.ts` `mode-settings-panel.ts` | `features/setting-collection/` |
| `special-editors/*`（5 个） | `features/special-editors/` |
| `mark-collection-view.ts` | `features/text-marks/` |
| `src-gallery-view.ts` | `features/src-gallery/` |
| `link-alias-modal.ts` | `features/link-library/` |
| `confirm-modal.ts` `text-prompt-modal.ts` | `ui/` |

---

## 3. platform 层设计（核心）

目标：**把所有「桌面才有」的能力收敛成三个接口**，业务代码不再出现 `Platform.isDesktopApp` 之外的分支。

### 3.1 能力探测

```ts
// platform/index.ts
export const canUseNativeDialog = hasElectronDialog();      // 桌面 true
export const canUseLocalFolder  = canUseNativeDialog;       // 目录遍历目前仅桌面
export const canUseLocalFileIO  = Platform.isDesktopApp;    // fs 直读直写
```

### 3.2 懒加载 fs —— A 级阻塞的唯一解法

`fs` / `path` 绝不能出现在模块顶层 import 链上。集中到 `platform/desktop/file-io.ts`，并由调用方**动态导入**：

```ts
// platform/desktop/file-io.ts —— 本文件是 fs/path 的唯一出现处
import { readdirSync, readFileSync, writeFileSync, existsSync } from "fs";
import { join, dirname } from "path";
```

```ts
// 调用方
if (!canUseLocalFileIO) { new Notice("Novel View：当前环境不支持本地文件操作。"); return; }
const io = await import("./desktop/file-io");   // ← 移动端永不执行这一行
```

要点：
- `format: "cjs"` + `bundle: true` 下，`import()` 会被编织成惰性初始化函数，`require("fs")` 落到该函数体内，不进模块顶层。**必须在产物上验证**：`grep -c 'require("fs")'` 应仍为 1，但偏移必须落在 `platform/desktop/file-io` 的初始化体内，而不是顶层 `var` 声明。
- 验证方式（执行阶段必做）：
  ```
  node -e 'const s=require("fs").readFileSync("main.js","utf8");
           const i=s.indexOf("require(\"fs\")");
           console.log(s.slice(i-200,i+80))'   # 必须看到函数体包裹，而非顶层 var
  ```

### 3.3 三处 B 级功能的移动端替代

| 功能 | 桌面 | 移动端方案 |
| --- | --- | --- |
| 导出 TXT | 系统目录选择器 + `fs.writeFileSync` | 写入 vault 内 `导出/` 目录，用 Notice 给出路径（可选走分享面板） |
| 导入 TXT | `dialog.showOpenDialog({openFile})` | `<input type="file" accept=".txt">` 读 `File.arrayBuffer()` |
| 导入设定集目录 | `showOpenDialog({openDirectory})` + 递归 `readdirSync` | 选择 **vault 内的一个文件夹**（`TFolder`），用 `vault.read()` 遍历 |

三者的分叉都收敛在 `platform/picker.ts`，业务层只调 `picker.pickTxt()` / `picker.pickFolder()`。

### 3.4 拖拽抽象

`platform/drag.ts` 暴露统一的指针拖拽启动器，桌面/移动同一套实现（Pointer Events 在桌面同样有效，可整体替换 HTML5 DnD，消除 §1.4-C 的 39 处分支）。

---

## 4. 迁移顺序（每阶段独立可验证、可回退）

| 阶段 | 内容 | 风险 | 验收 |
| --- | --- | --- | --- |
| **0** | `git init` + 基线提交 | 无 | `git log` 有一条 |
| **1** | 建 `platform/`，把 fs/path 全部改为动态导入，三处 Electron 站点改走 `platform/picker.ts` | 低（行为不变） | `tsc` 绿、`build` 绿、产物 `require("fs")` 落在惰性函数内、桌面手测三功能正常 |
| **2** | 拆依赖环：新增 `app/plugin-context.ts`，9 个视图改 `import type` 来源 | 中（纯类型） | `tsc` 绿 |
| **3** | 目录重排：`core/` → `editor/` → `ui/` → `features/`（分批提交，每批改 import 后跑 `tsc`） | 中（纯移动） | 每批 `tsc` + `test.mjs` 绿 |
| **4** | 拆 `main.ts`：主体迁 `app/plugin.ts`，视图相关逻辑沉入各 feature | 高 | 桌面全功能手测 |
| **5** | 触摸交互：DnD → `platform/drag.ts`；补窄屏断点 | 中 | 真机手测 |
| **6** | 排空 legacy：按 `legacy-main.d.ts` 逐个把方法实现搬到对应 feature，最后删 `legacy/` | 高 | 桌面 + 移动全量手测 |
| **7** | `manifest.json` 改 `isDesktopOnly: false` | **最高**（改错即白屏） | 移动端冷启动冒烟测试 |

阶段 1 与阶段 2 的顺序不能对调：先解依赖环，`main.ts` 才有条件被移动。

### 4.1 每阶段的固定验证命令

```bash
npx tsc --noEmit          # 类型
node scripts/test.mjs     # core 逻辑单测（覆盖 core/ 下 11 个模块 + settings.ts，缺 outline-marks / setting-drag / setting-icons）
npm run build:only        # 产物构建（不部署）
npm run deploy            # 部署到测试库
```

`scripts/test.mjs` 的入口表**硬编码了 `src/core/*.ts` 与 `src/settings.ts` 的路径**，阶段 3 移动 `core/` 时需同步更新该文件，否则单测会静默丢用例（esbuild 找不到入口会直接失败，属于显性失败，可接受）。

---

## 5. 风险清单

| 风险 | 影响 | 应对 |
| --- | --- | --- |
| 无版本控制 | 重排不可逆 | 阶段 0 强制 `git init` |
| `legacy-main.cjs` 是压缩单行产物 | 无法跟随目录调整内部结构；`git diff` 不可读 | 只移动文件位置；排空后再删 |
| 类型契约失真（§1.4-D） | `platform` 抽象会复制错误签名 | 阶段 1 先修正 `chooseLocalImage` / `saveImageToVault` 声明 |
| 移动端无法本地验证 | 阶段 7 的风险无法在开发机暴露 | 阶段 1 结束后争取一次真机冒烟（只需能加载） |
| `isDesktopOnly` 提前翻转 | 移动端用户白屏崩溃 | 严禁早于阶段 7 |
| 8 622 行单文件样式 | 窄屏回归难定位 | 阶段 5 按 feature 拆 `styles/`，或先只加断点 |

---

## 6. 待确认问题

1. **「导入设定集目录」在移动端要不要保留？** 若沿用 vault 内选文件夹的方案，UI 与桌面差异较大（需要一个新的 vault 文件夹选择弹窗）；也可以先在移动端隐藏该入口。
2. **导出 TXT 的移动端落点**：vault 内目录，还是走系统分享（需要用 `Capacitor`/Obsidian 未公开的 API，风险高）？倾向 vault 内。
3. **移动端布局**：响应式单栏自适应，还是为手机做独立布局？前者成本低，后者体验好。
4. **`features/` 的粒度**：`setting-collection` 现存 6 个文件 3 339 行，`special-editors` 5 个文件 3 307 行，两者规模相当，是否都保留为单一 feature 目录？
5. 排空 legacy 是否在本次范围内？若只想「能装能用」，阶段 6 可推迟，但 `legacy/` 目录仍需建立以固定边界。
