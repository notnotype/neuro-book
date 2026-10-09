# t71 实施计划：Files 竖切四：编辑器区

## Context

- **为什么做**：第 6 步 Files 竖切的第四片（[t68 计划的“第 6 步分解”](../t68-files-resource-layer/plan.md#第-6-步分解)）。t70 交付了资源管理器，点文件执行 `nbook.editor.open`，但这条命令还没有人登记，编辑器槽只显示欢迎文字。本 Task 交付编辑器区：编辑组与标签、文档模型、Markdown 富文本与源码两种编辑器、乐观切换，以及资源管理器在复制、移动、删除前对未保存文档的结算（files-explorer 验收 9，t70 延到这里）。
- **依据**：[`workbench/files-explorer.md`](../../../../../docs/specs/workbench/files-explorer.md) 的“文档与体验”“打开与切换”“失败与恢复”与验收 9；[`workspace/files.md`](../../../../../docs/specs/workspace/files.md) 的“读取与保存”与验收 1、4；[`workbench/commands.md`](../../../../../docs/specs/workbench/commands.md) 的编辑器命令与上下文键；[`ui/workbench-shell.md`](../../../../../docs/specs/ui/workbench-shell.md) 的“编辑器分组与文档标签归编辑器插件”；[`runtime/browser-host.md`](../../../../../docs/specs/runtime/browser-host.md) 的终态页（“不自动刷新，避免丢失页面上未保存的内容”）；[v2 重建提案](../../../../../docs/proposals/neuro-book-v2-rebuild.md) 第 5 节（编辑器组件从旧包整理后迁入）；[项目文件底座提案](../../../../../docs/proposals/project-file-foundation.md) 的“沿用第一版的切换设计”；旧应用的[切换设计](../../../../../packages/neuro-book-legacy/docs/proposals/files-explorer.md#切换性能分开文件模型和控件的寿命)；VS Code 调研[第 6 章](../../../../../docs/research/vscode/06-editor-architecture.md)与[第 16 章](../../../../../docs/research/vscode/16-file-service-explorer-editor-latency.md)。
- **编辑器选型**：沿旧应用。Markdown 用 Tiptap 3（富文本，读写都是 Markdown），其余可编辑文本用 Monaco；Markdown 也能“用源码编辑器重新打开”。旧包装了 Milkdown 但主编辑器不用，不迁。
- **已有的底座**：
  - 文件客户端 `filesKey`（`src/plugins/files/web/client.ts`）：`read` 返回 `{text, baseline}`；`write(address, text, baseline)` 冲突时带回 `current`；`identify` 冻结目录项身份（dev、inode、birthtime、类型，`backend/rooted.ts`）；`watch` 先推 `ready`，再推 `created/changed/deleted/renamed`（只带路径与写入来源，不带基线）、`resync`、`ended`。保存经临时文件改名替换（`src/backend/locked-replace.ts`），所以保存会换掉目录项身份。
  - 资源管理器 `src/plugins/explorer/`：打开走 `nbook.editor.open {address, mode}`；复制、剪切、拖动、改名用 `identify` 冻结身份、提交时带 `expected`；批量结果未知时有门禁。
  - 工作台：贡献点、外壳的编辑器槽（`web/components/WorkbenchShell.vue` 的 `#editor`）、公开状态、命令与 `when`、nb-ui 的 grid 原语与 `Tabs`。
  - 浏览器宿主（`src/web/host/window.ts`）：服务端换进程、项目代次结束、协议不兼容时转终态页并 `host.destroy()`；`BrowserWindowOptions.clock` 可注入时钟。
  - 测试工具：Files 场地与链路闸门（`plugins/files/testing/scene.ts`、`tap.ts`：扣住回复、推迟发送）、资源管理器测试场地（`explorer/testing/world.ts`）、Lab 内存文件适配器（`lab/web/fixtures/explorer-scene/memory-files.ts`，目前不支持读写正文）。
  - 命令目录里的四条编辑器命令（`nbook.editor.focus`、`nbook.edit.undo`、`nbook.edit.redo`、`nbook.editor.go-to-line`）与四个上下文键，现由 Lab 命令场景代为登记（`lab/web/fixtures/command-scene/editor-commands.ts`）。
- **计划审查**：三个 omp 审查（对照参考实现、架构与不变量、可测性）共 27 条发现（阻断 3 条），全部核实成立并入本稿，报告见 `evidences/plan-review-*.txt`；取舍记入待确认清单。
- **工作方式**：自主推进（[autonomous-delivery](../../../../skills/autonomous-delivery/SKILL.md)）：Opus 编码，三个 omp（默认模型）审查计划与实现。在 worktree `.worktree/w00017-runtime-foundation` 上逐片提交并 push。测试用真实内核、真实 Files 场地、真实 Chrome，不用 mock、spy、假计时器与固定等待；时间相关的用注入时钟。

## 关键设计

### 1. 编辑器槽的贡献点（`src/plugins/workbench/`）

- 新贡献点 `workbench.editor-area`（`shared/contracts.ts`）：声明 `{order}`，实现 `{load(): Promise<Component>}`（`web/contracts.ts`）。外壳的 `#editor` 槽取已发布贡献里 `order` 最小的一个，挂一次、不随布局变化重挂（外壳一验收 6 的停放语义不变）；没有贡献时仍是欢迎文字。组件收到只读的 `context: {visible: Ref<boolean>}`。
- 依赖方向：工作台不认识编辑器插件。第二个提供者记诊断、不挂。

### 2. Files 的保存回执带身份（`src/plugins/files/`，合同版本 3）

- `write` 的结果由 `{baseline}` 改为 `{baseline, identity: {before, after}}`：`before` 是替换前的目录项令牌（锁内 `stat` 得到，与 `identify` 同一算法），`after` 是替换后的。只有经本次替换产生的变化才有这对令牌，外部替换没有。
- 用途：资源管理器冻结的令牌在本窗口保存之后仍能被认出（第 9 节）；不放宽 `expected` 的核对。

### 3. 文档模型（`src/plugins/editor/web/documents/`）

- `createDocumentStore({files, clock, report})`，一个窗口一份，活到编辑器入口停止。按地址持有 `TextDocument`。
- **读取与监视的先后**：每个方案的 `watch` 在第一份文档打开前订阅，首次读取等该方案的 `ready` 之后才发；每份文档有读取代次，读取在途时收到相关变化（`changed`、`resync`、`renamed` 到它）就在结果回来后再读一次；接纳读取结果时复查目标仍存活、输入修订没有前进、没有 dirty、没有在途保存与冲突，否则只更新“磁盘已变化”的标记。同一地址并发打开只读一次。
- **正文与回执**：`text`（权威正文）、`revision`（每次接受输入加一）、`baseline` 与 `saved`（基线对应的正文，判 dirty）。视图提交 `commit(target, token, baseRevision, text) → accepted | conflict | stale`（沿旧包 `editor-view.types.ts`）：`baseRevision` 过期且内容不同为 `conflict`，候选按 `{documentId, token}` 登记为“未裁决输入”，不进入正文；裁决 `resolve(token, "adopt-current" | "keep-view")`：前者丢弃候选，后者用最新修订重提（再冲突继续保留）。未裁决输入与 dirty 一样阻止关闭、preview 替换、`reopen-with`、淘汰视图、保存与资源管理器的操作，并计入离开确认。
- **保存**：每份文档一个单飞队列。一次保存开始时固定快照 `{text, revision, baseline}`；同一文档的后续保存排在它后面、用它完成后的新基线；`save-all` 按文档去重。成功只把 `saved/baseline` 推进到快照，`revision` 更大时仍 dirty（files 验收 4）。`conflict` 进入“磁盘冲突”态（与未裁决输入分开）：“重新载入磁盘版本”丢弃修改；“覆盖磁盘版本”以冲突带回的 `current` 写入。失败保持 dirty；结果未知时先重读基线：等于快照正文的哈希为已保存，否则保持 dirty 并说明。
- **外部变化**：事件不带基线，所以来源是 `nbook.editor` 的 `changed` 也读一次核对：读到的哈希等于本窗口该文档已提交或在途快照的哈希，只更新基线、不回灌视图；否则按外部变化处理。外部变化：不 dirty 时用读到的正文回灌（视图重设撤销基线）；dirty 时只记“磁盘已变化”，下次保存得到冲突。`renamed` 按段边界改写地址与身份的 `path`，保留正文、dirty 与视图状态。`deleted`：标“已删除”且保留正文（dirty 的仍 dirty）；“保存”重建（见下）；“关闭”丢弃。`resync` 对全部打开文档按上面的读取与接纳规则核对。`ended` 置不可保存。
- **删除后重建**：先 `create` 排他新建空文件，再以空字节的 SHA-256 作基线 `write`；`create` 失败为冲突（已有同名文件）时提示、保持 dirty；`write` 失败或结果未知时保留正文与 dirty，留下的空文件如实说明。
- **身份**：`DocumentTarget {workspaceKey, generation, documentId, path}` 沿命令目录的四字段；项目换代时旧代文档作废，旧回调按目标比对失效。
- **文档协调 `DocumentCoordinator`**（`nbook.editor` 的 `shared/contracts.ts`，服务键 `documentCoordinatorKey`）：
  - `affected(addresses)`：地址本身或其后代里 dirty、在保存、未裁决输入或磁盘冲突的文档；
  - `begin(addresses) → Lease`：先同步结算这些文档的视图输入、等在途保存，然后挡住它们的新保存（保存请求排队，不丢输入），直到 `lease.end(result)`；结果未知时租约保持到资源管理器核对或放弃；
  - `save(addresses)`：保存这些地址下的 dirty 文档，逐项结果；
  - `translate(address, token)`：本窗口对该地址的保存若形成从 `token` 起的身份链，返回链尾的令牌，否则原样返回；
  - `rebind(from, to)`：移动或改名成功后改写地址（`renamed` 事件先到时幂等）；
  - `close(addresses)`：用户确认删除且删除成功后关闭这些文档的标签、丢弃正文。
- **终态时的抢救**：编辑器入口向宿主的本地能力登记“抢救提供者”（第 10 节），返回全部 dirty 文档与未裁决输入的 `{path, text}`。

### 4. 编辑组与标签（`src/plugins/editor/web/groups/`）

- 纯模型 `createEditorGroups(initial)`：`groups[] {id, tabs[], active}`、`activeGroup`；标签 `{address, editor: "markdown" | "code", preview}`。动作：`open(address, {mode, group?, editor?})`（preview 替换本组已有的 preview；已在的标签只激活；permanent 打开、编辑、双击把 preview 转正）、`close`、`closeOthers`、`split(tab, "right" | "down")`（新组引用同一文档）、`focusGroup`、`moveTab`（同组重排，键盘）。空组在还有其它组时自动关闭。打开意图有序号：只有最新一次打开决定活动标签与焦点。
- 布局：组排成 nb-ui grid（`useGridLayout`）。
- 持久化：绑定项目的窗口存 project/local 记录 `editor.session`（组的 grid 快照、每组标签与活动标签、活动组），不存正文；未绑定项目时只在内存。恢复时标签先出现，正文按打开流程读取；读不到的标签显示原因、不静默删。

### 5. 视图宿主与控件复用（`src/plugins/editor/web/components/`，从旧包整理迁入）

- `EditorArea`（槽的根）→ `EditorGroup`（每组：标签条 `EditorTabBar`、冲突与状态条、进度条、`EditorViewHost`）。
- **三层寿命**（沿旧包切换设计与 VS Code 第 6 章）：
  - 控件：每组每种编辑器一个（一个 Monaco 编辑器实例、一个 Tiptap 编辑器实例），换文档不销毁；
  - 视图状态：每“文档 × 组 × 编辑器种类”一份，Monaco 是 `ITextModel` 加 `saveViewState()`，Tiptap 是完整 `EditorState`（含 history 插件状态与选区）加滚动位置；绑定时 `setModel`/`updateState` 并恢复；
  - 文档：第 3 节。
- 视图状态的所有者是组的宿主：标签关闭时释放；只淘汰确定 clean、无未裁决输入、无在途保存的非活动视图状态（每组每种最多 3 份），淘汰时 Monaco `model.dispose()`、Tiptap 丢弃状态；项目换代全部释放。同一文档在两个组各有自己的视图状态与撤销栈，不共享（沿旧包）。
- **绑定**：每次绑定签发新 token；换文档前同步结算旧视图输入（未裁决时不换，标签保持并提示）；旧 token 的回调为 `stale`。外部权威正文回灌视图时不进撤销栈（Tiptap `addToHistory: false`、Monaco `pushEditOperations` 之外的 `setValue` 后重设基线）。
- **乐观切换**：点击后同一帧切换活动标签；目标没就绪时内容区空白，用宿主时钟（`clockKey`）计 800 ms 后才显示进度条；不保留旧文件正文；迟到读取不抢当前意图；失败在内容区显示原因与重试。已打开且有视图状态的文档切回不读磁盘。
- **键位**：Ctrl+S、Ctrl+W、Ctrl+\\ 由 `EditorArea` 在自己有焦点时处理，执行同一条命令（沿 t70 的树内键位做法）；命令的 `when` 只写业务条件（`editor-active`、`editor-writable`、`editor-dirty`），命令面板里始终可选。

### 6. 源码编辑器（`src/plugins/editor/web/code/`）

- 迁入 `MonacoCodeEditor.vue`、`CodeEditorView.vue`、`load-monaco-editor.ts`、`monaco-theme.ts`，按第 5 节改成“控件一个、model 多份”。动态导入，首次打开源码文件时才加载。去掉临时字号与 Agent 绑定。

### 7. Markdown 编辑器（`src/plugins/editor/web/markdown/`）

- **方言**：迁入方言核心（`markdown-dialect-extensions.ts` 与 Comment、CommentBlock、MarkdownRuby、MarkdownBilingual、HtmlEmbed、HtmlFallback、MarkdownCode、MarkdownAlign、MarkdownTextMarks、MarkdownParagraph）及它们依赖的旧包共享模块：`shared/markdown-workbench.ts` 的 tokenizer 与规范化函数迁到 `src/plugins/editor/shared/markdown-dialect/`，`HtmlEmbed` 的主题宿主改读新应用 token、数据接口一律拒绝，Comment 的 UI 回调为空实现（只保留语法）。硬换行迁入旧包 `AgentHardBreak` 的序列化（单个 `\n`），改名 `MarkdownHardBreak`，不带 Agent 菜单。工作区引用标签不迁：`[label](target)` 由普通链接保留源码，不再渲染成标签、点击不打开。
- **字节保持**：Tiptap 序列化会改写未编辑的部分（CRLF 变 LF、`*` 列表变 `-`、标准 ruby 变属性式，审查实测）。保存时不直接用序列化结果，而是三方合并：`base` 为打开时的正文序列化一次的结果，`theirs` 为编辑后的序列化结果，`ours` 为磁盘原文；按行做 diff3，只有 `theirs` 改的行取 `theirs`，只有序列化规范化造成的差异保留原文，两边都改的区域取 `theirs`。换行符按原文主导样式写出。`theirs` 与 `base` 相同时原样返回原文（不编辑字节不变）。合并在 `markdown/source-merge.ts`，纯函数、按行 Myers diff，不加依赖。
- **frontmatter**：按原始字符串偏移识别首部 `---` 块（不全文件归一化换行、不补换行，BOM 保留），原样切出前缀，只把正文交给 Tiptap 与合并；不迁 YAML 面板，改 frontmatter 用源码编辑器。
- **编辑器**：`TipTapMarkdownEditor.vue` 从 1839 行收为核心（方言扩展、表格、图片、占位、链接、硬换行、行内代码快捷键）；不迁 Agent 触发菜单、斜杠命令、行内 AI 引用、选区浮动菜单与批注侧栏。
- 依赖：`@tiptap/core`、`@tiptap/vue-3`、`@tiptap/pm`、`@tiptap/starter-kit`、`@tiptap/markdown`、`@tiptap/extension-table`、`@tiptap/extension-image`、`@tiptap/extension-placeholder`、`@tiptap/extension-link`（均 ^3.23.1），`monaco-editor` ^0.55.1；S5、S6 落地时逐个按实际 import 加入 `packages/neuro-book/package.json`，核对锁文件只多这些。

### 8. 插件、命令与离开（`src/plugins/editor/`）

- 插件 `nbook.editor`，只有浏览器入口；依赖 `filesKey`、`commandServiceKey`、`storageKey`、`windowProjectKey`、`settingsKey`、`diagnosticsKey`、`clockKey`、宿主的抢救能力。贡献编辑器槽、命令、公开状态，提供 `documentCoordinatorKey`。
- 命令（`editor` 域）：`nbook.editor.open {address, mode, editor?}`、`save`、`save-all`、`revert`、`close`、`close-others`、`split-right`、`split-down`、`reopen-with {editor}`；第一批的 `focus`、`undo`、`redo`、`go-to-line` 从 Lab 迁到这里，Lab 命令场景改为以 `nbook.lab` 来源登记样板编辑器自己的命令（id 加 `lab.` 前缀，不再冒用编辑器的 id）。效果与 Agent 暴露在 S0 的命令表里逐条写定。
- 公开状态：命令目录的 `editor-focus`、`editor-active`、`editor-writable`、`editor-line-navigation`，加 `editor-dirty`。
- 关闭 dirty 或有未裁决输入的文档的最后一个标签：确认框“保存 / 不保存 / 取消”，默认在取消。离开页面：`beforeunload` 时同步结算全部视图输入，有 dirty、未裁决输入或在途保存就请求离开确认。不跨刷新保留草稿。

### 9. 资源管理器的 dirty 结算（`src/plugins/explorer/web/controller.ts`）

- 控制器选项加可选 `documents?: DocumentCoordinator`；插件入口把 `documentCoordinatorKey` 作为可选依赖，缺了按现在的直接放行。
- **复制**：源里有受影响文档时，在冻结身份之前问“先保存再复制 / 复制磁盘版本 / 取消”，默认取消；先保存失败或冲突时不复制并说明。
- **移动、拖动、改名**：提交前 `begin` 租约（结算输入、等在途保存、挡新保存）；有未裁决输入或磁盘冲突的文档时不提交并说明。提交时冻结令牌先经 `translate` 换成链尾（剪切后用户保存过仍能移动；外部替换仍是 `source-changed`）。成功项 `rebind`，失败项不动；结果未知时租约保持，直到“重新列出”核对或“放弃”。
- **删除**：确认框列出将丢失未保存修改的文档（含未裁决输入）；删除成功的项 `close`；失败项不动。
- 这些对话框沿 t70 的对话框模型（`dialog`）加一种 `kind: "dirty-copy"`，删除确认加受影响文档列表。

### 10. 终态时的抢救（`src/web/host/`、`src/shared/host.ts`）

- 宿主新增本地能力 `windowRescueKey {register(provider: () => ReadonlyArray<{path: string; text: string}>): () => void}`。转入终态页（服务端已重启、项目已关闭、版本不一致）时，先同步调用全部提供者收集未保存正文，再 `destroy`；终态页在原有说明与按钮下列出这些文件名，各带“复制正文”按钮与可选中的只读文本。没有提供者或没有未保存内容时终态页不变。

### 11. Lab（`src/plugins/lab/web/fixtures/`）

- 每个新组件登记零件场景（`EditorTabBar`、`EditorGroup`、`EditorViewHost`、`MarkdownEditorView`、`CodeEditorView`），按组件规范给同名 `.md`。
- 集成场景 `EditorArea/live`：同一套组与文档模型，文件换成 t70 的内存适配器（移到 `lab/web/fixtures/memory-files/`），并给它补正文能力：文本与基线、带 `current` 的冲突、外部改写与删除、保存来源事件、可释放的读与保存闸门；新能力与真实 Files 在同一串操作上对过契约（扩展 `lab/memory-files.test.ts`）。

## Spec 与文档改动（S0）

| 文档 | 改什么 |
|---|---|
| `docs/specs/workbench/editor.md`（新，`planned`） | 编辑器区全部合同：贡献、组与标签、打开、文档模型（读取与监视先后、输入回执与未裁决输入、保存队列、磁盘冲突、外部变化与回声核对、改名、删除与重建、换代）、两种编辑器、Markdown 字节保持与 frontmatter、乐观切换、离开、协调接口、命令表与公开键、验收场景；性能标准引 files-explorer，测量随 t72 |
| `docs/specs/workspace/files.md` | 保存回执带 `identity {before, after}`；合同版本 3 |
| `docs/specs/workbench/files-explorer.md` | “文档与体验”与验收 9 引用 editor.md 的协调接口；冻结令牌经 `translate`；打开命令参数加 `editor?` |
| `docs/specs/workbench/commands.md` | 编辑器命令改由 `nbook.editor` 登记；新增命令、`editor-dirty`；Lab 命令场景改说明 |
| `docs/specs/ui/workbench-shell.md` | 编辑器槽改为贡献点 `workbench.editor-area` |
| `docs/specs/runtime/browser-host.md` | 本地能力 `windowRescueKey`；终态页列出抢救的正文 |
| `docs/specs/README.md` | 注册 `workbench.editor` |

## 切片

| 片 | 设计 | 提交边界 | 自跑验证 |
|---|---|---|---|
| S0 | Spec 改动表 | 7 份文档 | `docs:check`、`governance:check` |
| S1 | 第 1、2 节 | 贡献点与外壳挂载；Files 保存回执带身份（合同版本 3） | `typecheck`、`bun test src/plugins/files src/plugins/workbench`、`workbench-*` 与 `files-explorer` e2e |
| S2 | 第 3 节 | 文档模型与协调接口（真实 Files 场地 + 链路闸门 + 手动时钟） | `bun test src/plugins/editor` |
| S3 | 第 4 节 | 组与标签模型、持久化记录 | 同上 |
| S4 | 第 5、8、10 节 | 插件、命令、公开键、`EditorArea`/`EditorGroup`/`EditorTabBar`/`EditorViewHost`、乐观切换、离开确认、终态抢救；先用纯文本视图（`textarea`）打通整条链路 | Bun、Vitest（`*.dom.test.ts`）、新 e2e `editor-area` |
| S5 | 第 6 节 | Monaco 源码编辑器；首屏不含 Monaco 的产物核对 | Vitest 加 e2e |
| S6 | 第 7 节 | 方言与共享模块迁入、字节保持合并、frontmatter、Tiptap 编辑器 | Bun（合并与方言往返）、Vitest、e2e |
| S7 | 第 9 节 | 资源管理器的 dirty 结算 | `explorer` 的 Bun、DOM 与 e2e |
| S8 | 第 11 节 | Lab 场景与内存适配器正文能力、截图、Spec 实现标注与证据 | 全量 Bun、Vitest、e2e、`docs:check`、`governance:check` |

## 测试分层与运行器

- **Bun（`*.test.ts`，`bun:test`）**：文档模型、组模型、合并与方言往返（纯 `MarkdownManager`）、资源管理器的协调。用真实 Files 场地，读与保存用 `tap` 的回复闸门扣住，监视订阅用发送闸门推迟；时间用 `ManualClock`。旧包的方言往返测试改写成 `bun:test` 迁入，不沿用 Vitest 写法。
- **Vitest（`*.dom.test.ts`，happy-dom）**：组件的结构、事件、焦点与确认框；`EditorGroup` 的 800 ms 进度条用注入的 `ManualClock`。Tiptap 的 `EditorState` 路径可在 happy-dom 运行；Monaco 在 happy-dom 缺 Canvas，不在这里创建。
- **e2e（生产构建、本机 Chrome、真实 Files）**：Monaco 与 Tiptap 的真实输入、撤销与重做、A→B→A；保存与外部改写；资源管理器的三种结算；刷新恢复；终态抢救。800 ms 的精确阈值由 Bun 与 Vitest 的注入时钟证明，e2e 只证明正常打开不闪进度条、正文正确（产品构建不加测试钩子）。
- **构建核对**：S5 记录 HTML 初始模块的静态依赖闭包（Vite manifest），证明不含 Monaco 与 Tiptap 的主体；e2e 观察首次打开源码文件前后的模块请求。

## 验收映射

| 判据 | 覆盖 |
|---|---|
| files-explorer 验收 3 的 preview / permanent（单击、双击、Enter、修饰点击不打开） | t70 已有（`browse.test.ts`、`tree.test.ts`、DOM、e2e）；t71 在 `editor-area` e2e 里补“单击替换 preview、双击转正”的标签结果 |
| files-explorer“打开与切换”（当帧切换、800 ms、迟到不抢、失败原因、不串正文） | editor.md 对应条目：Bun `groups.test.ts` 的意图序号与迟到；Vitest `EditorGroup.dom.test.ts` 用手动时钟验 799/800 ms；e2e 的 A→B 快速切换不串正文与失败原因 |
| files-explorer 验收 9：复制三选 | Bun `explorer/documents.test.ts`（先保存再复制得到新正文副本、磁盘版本副本、取消不写）；DOM 三按钮与默认取消；e2e 一次复制选择并读磁盘 |
| files-explorer 验收 9：移动 | Bun：保存被扣住 → 放行前继续输入 → 移动成功，正文与 dirty 跟到新路径；失败时不动；剪切后保存再粘贴成功（`translate`）；外部替换仍 `source-changed`；e2e 剪切粘贴 dirty 文件 |
| files-explorer 验收 9：删除 | Bun：dirty 与未裁决输入列入；DOM 列表、默认取消；e2e 删除 dirty 文件的确认与关闭 |
| files 验收 1 | e2e：打开、输入、Ctrl+S；读磁盘字节；第二个页面（另一窗口的 Files 客户端）打开同一文件看到新正文 |
| files 验收 4 | Bun `documents.test.ts`：外部写入后保存得到冲突；扣住保存期间输入，完成后仍 dirty |
| editor.md 各条目与场景（S0 写定编号） | 逐条映射到上面三层，S0 提交时把映射表补进本节 |
| Markdown 字节保持 | Bun：合并与往返（CRLF、BOM、无尾换行、frontmatter、`*` 列表、标准 ruby、硬换行、链接、方言全集）；e2e：打开不编辑字节不变；编辑一段后保存只那一段变化 |
| 撤销与视图状态 | e2e：Monaco 与 Tiptap 各一例 A 输入 → B 输入 → 回 A 撤销与重做互不串；两组同文档各自撤销 |

## 验证

- 每片自跑上表的命令；S8 收口跑全量：`bun run typecheck`、`bun run test:bun`、Vitest、`bun run build` 后 `bun run test:e2e`、`docs:check`、`governance:check`。
- 端到端：`e2e/editor-area.e2e.ts`。截图：四主题 × 明暗，1440 与 390 宽，含冲突条、未裁决输入、进度条与终态抢救。
- 未验证边界：files-explorer 的毫秒性能标准（参考机器测量随 t72，本 Task 只保证结构：切换当帧、已打开文档切回不读磁盘、编辑器控件不重建）；跨机器；读屏软件的实际朗读；Monaco 与 Tiptap 的输入法细节只验 Chromium。

## 不做与风险

- 不做：拖动标签换组与拖到边缘拆分、固定标签与多行标签条（编辑器拖放另建 Task，排在 t72 之后）；面包屑与编辑器工具栏；状态栏的文档项；草稿跨刷新保留；自动保存；Markdown 的批注侧栏、选区浮动菜单、斜杠命令、Agent 与 AI 引用、工作区引用标签、frontmatter 面板；差异比较界面；预读；`docs://` 等其它方案。
- 风险：
  - 字节保持合并是 Markdown 正确性的核心：合并只决定输出哪一行，不改 Tiptap 的解析；两边都改的区域取编辑结果，可能把编辑行附近的规范化差异一并写出（行粒度），Spec 写明“未编辑的行字节不变”。
  - Tiptap 的 `EditorState` 绑定 schema 与插件：同一控件的状态由同一扩展工厂创建，切换只 `updateState`；扩展组变化（如换语言）时全部视图状态重建。
  - Files 合同版本 3：同一构建里两端一起升级；版本 2 的调用方被拒（远程服务按版本精确匹配）。
  - 抢救在 `destroy` 之前同步收集：提供者必须同步返回，不能依赖远程调用。
