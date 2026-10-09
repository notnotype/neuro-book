# t71 实施计划：Files 竖切四：编辑器区

## Context

- **为什么做**：第 6 步 Files 竖切的第四片（[t68 计划的“第 6 步分解”](../t68-files-resource-layer/plan.md#第-6-步分解)）。t70 交付了资源管理器，点文件执行 `nbook.editor.open`，但这条命令还没有人登记，编辑器槽只显示欢迎文字。本 Task 交付编辑器区：编辑组与标签、文档模型、Markdown 富文本与源码两种编辑器、乐观切换，以及资源管理器在复制、移动、删除前对未保存文档的结算（files-explorer 验收 9，t70 延到这里）。
- **依据**：[`workbench/files-explorer.md`](../../../../../docs/specs/workbench/files-explorer.md) 的“文档与体验”“打开与切换”“失败与恢复”与验收 3、9；[`workspace/files.md`](../../../../../docs/specs/workspace/files.md) 的“读取与保存”与验收 1、4；[`workbench/commands.md`](../../../../../docs/specs/workbench/commands.md) 的编辑器命令与上下文键；[`ui/workbench-shell.md`](../../../../../docs/specs/ui/workbench-shell.md) 的“编辑器分组与文档标签归编辑器插件”；[v2 重建提案](../../../../../docs/proposals/neuro-book-v2-rebuild.md) 第 5 节（编辑器组件从旧包 `app/components/editor-workbench/`、`app/components/markdown-studio/` 整理后迁入）；[项目文件底座提案](../../../../../docs/proposals/project-file-foundation.md) 的“沿用第一版的切换设计”；旧应用的[切换设计](../../../../../packages/neuro-book-legacy/docs/proposals/files-explorer.md#切换性能分开文件模型和控件的寿命)（文档模型、控件、视图三者寿命分开）。
- **编辑器选型**：沿旧应用。Markdown 用 Tiptap 3（`@tiptap/*` ^3.23.1，富文本，读写都是 Markdown，项目方言由旧包的方言扩展组保证往返），其余可编辑文本用 Monaco（`monaco-editor` ^0.55.1）；Markdown 也能“用源码编辑器重新打开”。旧包装了 Milkdown 但主编辑器不用，不迁。
- **已有的底座**：
  - 文件客户端 `filesKey`（`src/plugins/files/web/client.ts`）：`read` 返回 `{text, baseline}`，`write(address, text, baseline)` 冲突时带回 `current`，`watch` 推 `created/changed/deleted/renamed` 与写入来源（`{kind: "user" | "system", plugin} | {kind: "external"}`）、`resync`、`ended`。
  - 资源管理器 `src/plugins/explorer/`：打开走 `nbook.editor.open {address, mode}`（`web/controller.ts` 的 `activate`），命令未登记时提示“编辑器尚未接入”；复制、移动、删除在控制器里提交（`transfer`、`confirmDelete`）。
  - 工作台：视图与页面贡献点（`src/plugins/workbench/shared/`）、外壳的编辑器槽（`web/components/WorkbenchShell.vue` 的 `#editor`，现在放欢迎文字）、公开状态 `definePublicState`、命令贡献点与 `when`、nb-ui 的 grid 原语（`packages/nb-ui/src/components/layout/grid.ts`、`useGridLayout`）与 `Tabs`。
  - 持久化 store（`src/shared/store/`）与 Storage 记录；显示语言与文案（`localize`）。
  - 命令目录里已有的四条编辑器命令（`nbook.editor.focus`、`nbook.edit.undo`、`nbook.edit.redo`、`nbook.editor.go-to-line`）与四个上下文键，现在由 Lab 命令场景代为登记（`src/plugins/lab/web/fixtures/command-scene/editor-commands.ts`）。
- **工作方式**：自主推进（[autonomous-delivery](../../../../skills/autonomous-delivery/SKILL.md)）：Opus 编码，三个 omp（默认模型）审查计划与实现；产品取舍记入[待确认清单](../../pending-confirmations.md)。在 worktree `.worktree/w00017-runtime-foundation` 上逐片提交并 push。测试用真实内核、真实 Files 场地、真实 Chrome，不用 mock、spy、假计时器与固定等待；时间相关的用注入时钟。

## 关键设计

### 1. 编辑器槽的贡献点（`src/plugins/workbench/`）

- 新贡献点 `workbench.editor-area`（`shared/contracts.ts`）：声明 `{order}`，实现 `{load(): Promise<Component>}`（`web/contracts.ts`）。外壳的 `#editor` 槽取已发布贡献里 `order` 最小的一个，挂一次、不随布局变化重挂（外壳一验收 6 的停放语义不变）；没有贡献时仍是欢迎文字。组件收到只读的 `context: {visible: Ref<boolean>}`（停放时为假）。
- 依赖方向：工作台不认识编辑器插件，编辑器插件贡献给工作台。同一时刻只认一个提供者；第二个提供者记诊断、不挂。

### 2. 文档模型（`src/plugins/editor/web/documents/`）

- `createDocumentStore({files, clock, report})`，一个窗口一份，活到编辑器入口停止。按地址持有 `TextDocument`：
  - 状态 `loading | ready | failed | deleted`；`text`（权威正文）、`baseline`（磁盘基线）、`revision`（每次接受输入加一）、`saved`（基线对应的正文，判 dirty）、`saving`（在途保存的正文与基线）、`conflict`（保存得到 `conflict` 时的磁盘基线）、`external`（dirty 时外部改了磁盘：只记下，不覆盖）。
  - `acquire(address) → {document, release()}`：引用计数；同一地址并发打开只读一次；最后一个引用释放且不 dirty、不在保存、无冲突时丢弃，否则留到结算。
  - `commit(document, baseRevision, text) → accepted | conflict | stale`：沿旧包的输入回执（`editor-view.types.ts`），视图不乐观改写。
  - `save(document)`：带基线写入；成功只推进到提交的那份正文，保存期间的新输入仍是 dirty（files 验收 4）；`conflict` 进入冲突态，界面给“重新载入磁盘版本”（丢弃修改）与“覆盖磁盘版本”（以 `current` 基线重写）。
  - 外部变化：订阅两个方案的 `watch`。自己的写入回声（来源 `{kind: "user", plugin: "nbook.editor"}` 且读到的基线等于刚保存的）不重读；不 dirty 时 `changed` 重读并推进 `revision`；dirty 时记 `external`、保存时得到冲突。`deleted` 置 `deleted`（dirty 正文保留，可另存为原路径重建：本 Task 只给“关闭”与“保存”重建，见第 7 节）；`renamed` 按段边界改写地址并保留引用与正文；`resync` 对全部打开文档重读基线、比较；`ended` 置不可保存。
  - 身份：`DocumentTarget {workspaceKey, generation, documentId, path}` 沿命令目录的四字段（`go-to-line` 已用）；改名换 `path` 不换 `documentId`，项目换代换 `generation`，旧回调按目标比对失效。
- 文档协调 `DocumentCoordinator`（供资源管理器）：`dirtyWithin(addresses)`、`settle(addresses) → settled | conflict`（结算视图输入并等在途保存）、`saveAll(addresses)`、`rebind(from, to)`（移动成功后按实际目标改写）、`forget(addresses)`（删除成功后丢弃）。经 `nbook.editor` 的 `shared/contracts.ts` 暴露服务键 `documentCoordinatorKey`；资源管理器把它作为可选依赖，缺了按现在的“直接放行”。

### 3. 编辑组与标签（`src/plugins/editor/web/groups/`）

- 纯模型 `createEditorGroups(initial)`：`groups[] {id, tabs[], active}`、`activeGroup`；标签 `{address, editor: "markdown" | "code", preview}`。动作：`open(address, {mode, group?, editor?})`（preview 标签替换本组已有的 preview；打开已在的标签只激活，permanent 打开把 preview 转正）、`pin(tab)`（编辑或双击标签转正）、`close(tab)`、`closeOthers`、`split(tab, "right" | "down")`（新组引用同一文档）、`focusGroup`、`moveTab`（同组重排，供键盘）。空组在还有其它组时自动关闭。
- 布局：组排成 nb-ui grid（`useGridLayout`），先只支持“向右 / 向下拆分”与关闭；拖动标签换组、拖到边缘拆分不在本 Task（见“不做”）。
- 持久化：绑定项目的窗口存一条 project/local 记录 `editor.session`（组的 grid 快照、每组标签与活动标签、活动组），不存正文；未绑定项目时只在内存。恢复时标签先出现，正文按打开流程读取；读不到的标签显示原因、不静默删。

### 4. 编辑器视图与控件复用（`src/plugins/editor/web/components/`，从旧包整理迁入）

- `EditorArea`（槽的根）→ `EditorGroup`（每组：标签条 `EditorTabBar` + `EditorViewHost` + 进度条）。
- `EditorViewHost`：按旧包合同迁入（`EditorViewHost.md`）。同组同类编辑器复用控件：换文档时结算旧输入、换模型并恢复视图状态（滚动、选区），不按地址销毁重建；每次绑定签发新 token，旧异步回调失效；只淘汰确定 clean 的非活动视图（每组最多 3 个），dirty、冲突、在途保存的留到标签关闭。
- 编辑器注册表 `registry.ts`（迁入）：`markdown`（`.md`）与 `code`（其余可编辑文本）；`reopen-with` 在两者间切换，选择记在标签上。
- 乐观切换：点击后同一帧切换标签与活动状态；目标没就绪时编辑区空白，`clock` 计 800 ms 后才显示顶部进度条（`files-explorer` 的“打开与切换”）；不保留旧文件正文；迟到的读取结果不抢当前意图；失败在编辑区显示原因。
- 状态栏不在本 Task。

### 5. 源码编辑器（`src/plugins/editor/web/code/`）

- 迁入 `MonacoCodeEditor.vue`、`CodeEditorView.vue`、`load-monaco-editor.ts`、`monaco-theme.ts`：动态导入，首次打开源码文件时才加载；每个视图实例一份 model（不跨组共享撤销，沿旧包）；主题读工作台 token。去掉旧包的临时字号与 Agent 绑定。

### 6. Markdown 编辑器（`src/plugins/editor/web/markdown/`）

- 迁入方言核心 `markdown-dialect-extensions.ts` 及其依赖（Comment、CommentBlock、MarkdownRuby、MarkdownBilingual、HtmlEmbed、HtmlFallback、MarkdownCode、MarkdownAlign、MarkdownTextMarks、MarkdownParagraph），连同旧包的往返测试：这是“打开不改字节、编辑只改动到的部分”的保证。批注只保留语法往返，不迁批注侧栏；`HtmlEmbed` 只呈现、数据接口一律拒绝（旧包缺省行为）。
- 编辑器 UI 层只迁表格、图片、占位、链接、硬换行、行内代码快捷键；不迁 Agent 触发菜单、斜杠命令、行内 AI 引用、工作区引用标签与选区浮动菜单。
- `TipTapMarkdownEditor.vue` 从 1839 行收为核心：frontmatter 原样保留在正文之外（拆分与拼回沿 `splitMarkdownFrontmatter`），不迁 YAML 面板，要改 frontmatter 用源码编辑器打开；没编辑过的视图切换不序列化正文。
- 富文本视图换文档时重建 Tiptap 的 `EditorState`、保留控件（Monaco 的 model 换法不适用于 Tiptap）；撤销历史按“文档 × 视图”保存在宿主里，A→B→A 回来时恢复。

### 7. 插件与命令（`src/plugins/editor/`）

- 插件 `nbook.editor`，只有浏览器入口；依赖 `filesKey`、`commandServiceKey`、`storageKey`、`windowProjectKey`、`settingsKey`、`diagnosticsKey`、`clockKey`。贡献编辑器槽、命令、公开状态，提供 `documentCoordinatorKey`。
- 命令（`editor` 域）：`nbook.editor.open {address, mode, editor?}`；`nbook.editor.save`、`nbook.editor.save-all`、`nbook.editor.close`、`nbook.editor.close-others`、`nbook.editor.split-right`、`nbook.editor.split-down`、`nbook.editor.reopen-with {editor}`、`nbook.editor.revert`（重新载入磁盘版本）；第一批的 `focus`、`undo`、`redo`、`go-to-line` 从 Lab 迁到这里，Lab 命令场景改为登记样板编辑器自己的一份（不再冒用 `nbook.editor` 来源）。键位：Ctrl+S 保存、Ctrl+W 关闭、Ctrl+\\ 向右拆分，`when` 带 `editor-focus`。
- 公开状态：命令目录的 `editor-focus`、`editor-active`、`editor-writable`、`editor-line-navigation`，加 `editor-dirty`（活动文档未保存）。
- 关闭 dirty 标签：确认框“保存 / 不保存 / 取消”，默认在取消；窗口离开时有 dirty 文档就触发浏览器的离开确认（`beforeunload`）。不跨刷新保留草稿。
- 删除后的打开文档：标签标“已删除”，正文保留；“保存”以排他新建在原路径重建（`files.create` 后 `write`），“关闭”丢弃。

### 8. 资源管理器的 dirty 结算（`src/plugins/explorer/web/controller.ts`）

- 控制器选项加可选 `documents?: DocumentCoordinator`。
  - 复制：源里有 dirty 文档时对话框“先保存再复制 / 复制磁盘版本 / 取消”，默认取消；先保存遇冲突时停在冲突，不复制。
  - 移动（剪切粘贴、拖动）：提交前 `settle`，冲突时不提交并提示；成功项逐个 `rebind`，失败项不动。
  - 删除：确认框列出受影响的 dirty 文档与“未保存的修改会丢失”；成功项 `forget`。
  - 改名：同移动。
- 插件入口把服务键列为可选依赖，Lab 集成场景给一份内存文档协调（同一合同，对内存适配器测过）。

### 9. Lab（`src/plugins/lab/web/fixtures/`）

- 每个新组件登记零件场景（`EditorTabBar`、`EditorGroup`、`EditorViewHost`、`MarkdownEditorView`、`CodeEditorView`），按组件规范给同名 `.md`。
- 集成场景 `EditorArea/live`：同一个编辑器插件的组与文档模型，文件换成 t70 的内存适配器（`explorer-scene/memory-files.ts` 移到共享位置），控件里可以“外部修改”“外部删除”“下一次保存冲突”“读取变慢”。

## Spec 与文档改动（S0）

| 文档 | 改什么 |
|---|---|
| `docs/specs/workbench/editor.md`（新，`planned`） | 编辑器区：插件与贡献、编辑组与标签（preview/permanent、拆分、关闭、持久化）、打开命令、文档模型（引用、dirty、按基线保存、冲突两种裁决、外部修改与回声、改名重绑定、删除后保存重建、项目换代）、两种编辑器与“用……重新打开”、乐观切换与 800 ms、离开确认、命令与键位、公开键；验收场景 |
| `docs/specs/workbench/files-explorer.md` | “文档与体验”与验收 9 改为引用 editor.md 的协调接口；打开命令的参数加 `editor?` |
| `docs/specs/workbench/commands.md` | 编辑器命令改由 `nbook.editor` 登记；新增命令与 `editor-dirty`；Lab 命令场景改说明 |
| `docs/specs/ui/workbench-shell.md` | 编辑器槽改为贡献点 `workbench.editor-area`，没有贡献时显示欢迎文字 |
| `docs/specs/README.md` | 注册 `workbench.editor` |

## 切片

| 片 | 设计 | 提交边界 | 自跑验证 |
|---|---|---|---|
| S0 | Spec 改动表 | 4 份 Spec 与注册表 | `docs:check`、`governance:check` |
| S1 | 第 1 节 | 贡献点、外壳挂载、样例贡献的 DOM 与 e2e | `typecheck`、相关 Bun 与 Vitest、`workbench-*` e2e |
| S2 | 第 2 节 | 文档模型与协调接口 | `bun test src/plugins/editor`（真实 Files 场地） |
| S3 | 第 3 节 | 组与标签模型、持久化记录 | 同上 |
| S4 | 第 4、7 节 | 插件、命令与公开键、`EditorArea`/`EditorGroup`/`EditorTabBar`/`EditorViewHost`、乐观切换；先用纯文本视图（`textarea`）占位验证整条链路 | Bun、Vitest、新 e2e `editor-area` |
| S5 | 第 5 节 | Monaco 源码编辑器 | Vitest 加 e2e |
| S6 | 第 6 节 | Tiptap Markdown 编辑器与方言往返测试 | 同上 |
| S7 | 第 8 节 | 资源管理器的 dirty 结算 | `explorer` 的 Bun 测试与 e2e |
| S8 | 第 9 节 | Lab 场景、截图、Spec 实现标注与证据 | 全量 Bun、Vitest、e2e、`docs:check`、`governance:check` |

S4 先用纯文本视图打通“打开 → 编辑 → 保存 → 冲突 → 外部修改 → 切换”，S5、S6 再把两种真实编辑器接到同一个视图合同上，每片都有可运行的产品页。

## 验收映射

| 判据 | 覆盖 |
|---|---|
| files-explorer 验收 3（打开与切换：当帧切换、800 ms 进度条、迟到结果不抢、失败显示原因、不串正文） | Bun：`groups.test.ts` 的意图与迟到；e2e：读取扣住时进度条 800 ms 前不出现、之后出现，A→B 快速切换不串正文 |
| files-explorer 验收 9（复制 dirty 三选、移动重绑定、删除列出 dirty） | Bun：`explorer/documents.test.ts`（真实文档模型 + 真实 Files）；e2e：编辑未保存时剪切粘贴，标签跟到新路径、正文保留 |
| files 验收 1（编辑保存，磁盘确认） | e2e：打开、输入、Ctrl+S、读磁盘字节 |
| files 验收 4（过期基线冲突、保存期间新输入保持 dirty） | Bun：`documents.test.ts` 用回复闸门扣住保存、期间输入；外部写入后保存得到冲突 |
| editor.md 各验收（S0 写定编号后逐条映射） | 文档模型、组模型、DOM、e2e 各一组 |
| Markdown 往返 | 迁入的方言往返测试（Vitest）；e2e：打开含方言的章节、不编辑切走，磁盘字节不变 |
| commands.md 编辑器命令与上下文键 | 迁移后的 `editor-commands.test.ts` 改到插件；e2e：命令面板执行“向右拆分”“保存” |

## 验证

- 每片自跑上表的命令；S8 收口跑全量：`bun run typecheck`、`bun run test:bun`、Vitest、`bun run build` 后 `bun run test:e2e`、`docs:check`、`governance:check`。
- 端到端：产品页 e2e `e2e/editor-area.e2e.ts` 用真实 `bun run build` 产物与本机 Chrome：资源管理器单击 preview、双击 permanent、编辑、保存、外部改写、冲突两种裁决、拆分、关闭 dirty 标签的确认、刷新后标签恢复；读取用 Files 测试链路扣住制造慢读。
- 截图：四主题 × 明暗，1440 与 390 宽，含冲突条与进度条。
- 未验证边界：性能标准（t72）；跨机器；读屏软件的实际朗读；Monaco 与 Tiptap 在 390 宽下的输入法细节只验 Chromium。

## 不做与风险

- 不做：拖动标签换组与拖到边缘拆分、固定标签与多行标签条（编辑器拖放另建 Task，排在 t72 之后）；面包屑与编辑器工具栏；状态栏的文档项；草稿跨刷新保留；自动保存；Markdown 的批注侧栏、选区浮动菜单、斜杠命令、Agent 与 AI 引用、frontmatter 面板；预读；`docs://` 等其它方案。
- 风险：
  - Tiptap 方言往返是正确性的核心：迁入旧包全部往返测试并加“打开不编辑字节不变”的 e2e；发现丢内容时以字节不变优先，降级为源码编辑器打开并提示。
  - Monaco 体积大：动态导入、只在首次打开源码文件时加载，构建产物单独分块；首屏不含它（构建报告核对）。
  - 控件复用与 token：迟到回调写错文档是最严重的错误，`EditorViewHost` 的 token 与目标比对按旧包合同迁入并补“A→B→A 期间旧回调到达”的 DOM 测试。
  - 外部变化与自己的回声：按写入来源与基线判定，不按时间窗口；`resync` 全部重比。
