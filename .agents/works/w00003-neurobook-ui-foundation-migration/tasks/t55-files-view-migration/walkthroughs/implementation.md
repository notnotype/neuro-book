# 切片 2.1 实施记录：`files` 视图接入（左叶文件树 + 展开项记录）

Work：`.agents/works/w00003-neurobook-ui-foundation-migration`；Task：`tasks/t55-files-view-migration`。
工作区：`.worktree/w00003-neurobook-ui-foundation-migration`（分支 `refactor/w00003-nb-ui-adoption`）；命令 cwd 逐条标注。

## 一、交付物与范围

| 项 | 值 |
|---|---|
| 产品代码（新增） | `app/utils/workbench/view-factories.ts`（`factoryKey` → 组件的第一方白名单）、`app/utils/workbench/product-catalog.ts`（容器/视图声明 + 注册表 + 可见性/合同求值）、`app/components/workbench/WorkbenchViewHost.vue`（容器 + 视图宿主）、`app/utils/workbench/files-view-session.ts`（展开项记录会话 + 旧键迁移）、`shared/storage/workbench-files.ts`（记录定义） |
| 产品代码（修改） | `app/pages/index.vue`（左叶挂宿主；删 `NovelIdeToolPanel`/`WorkspaceFilePanel` 未用 import；新增 `workbenchViewContext`）、`app/components/novel-ide/workspace/WorkspaceFilePanel.vue`（展开项改建记录、删裸键读写、加两条可见提示、显式 import）、`server/storage/product-definitions.ts`（定义清单追加一条）、`app/i18n/locales/{zh-CN,en-US}.ts`（5 个键） |
| 聚焦测试（新增） | `app/utils/workbench/files-view-session.test.ts`、`app/utils/workbench/product-catalog.test.ts`、`app/components/workbench/WorkbenchViewHost.test.ts`、`app/components/novel-ide/workspace/WorkspaceFilePanel.test.ts` |
| 记录定义 | `workbench.files` / `expanded-paths`（user/local、single、schemaVersion 1、默认值 `{paths: []}`）；注册入口只有 `server/storage/product-definitions.ts` 一处 |
| 未改 | `app/utils/workbench/descriptors{,.test}.ts`（用户 dirty，行内容一字未动）、`layout-session.ts`、`WorkbenchShell.vue`、`WorkbenchContainerSurface.vue`、`workbench-chrome.ts`、`server/plugins/storage-definitions.ts`、`NovelIdeToolPanel.vue`（角色/情节槽位按范围保留） |

## 二、命令与退出码（真实命令、cwd、结果）

| # | 命令（cwd） | 结果 |
|---|---|---|
| 1 | `bun run --cwd packages/neuro-book test app/utils/workbench/files-view-session.test.ts app/utils/workbench/product-catalog.test.ts app/components/workbench/WorkbenchViewHost.test.ts app/components/novel-ide/workspace/WorkspaceFilePanel.test.ts`（worktree 根） | **exit 0**，`Test Files 4 passed (4)`、`Tests 30 passed (30)` |
| 2 | `bunx tsc --noEmit -p tsconfig.json`（`packages/neuro-book`，只读、不重建 `.nuxt`） | 我改/新增的文件 **零错误**（`grep` 过滤 `files-view-session|product-catalog|view-factories|WorkbenchViewHost|WorkspaceFilePanel|pages/index.vue|workbench-files|product-definitions` 无输出）；仓库既有错误（`nb-ui/src/components/index.ts` 的 `*.vue` 类型再导出、既有测试文件）与本次无关，未修 |
| 3 | `bun run --cwd packages/neuro-book test <同上>`（修类型后复跑） | **exit 0**，4 files / 30 tests passed |
| 4 | `NEURO_BOOK_STATE_ROOT=<隔离根> NEURO_BOOK_CACHE_ROOT=<隔离根> bun run migrate:application-state -- --apply`（`packages/neuro-book`） | **exit 0**，`status":"complete"`（空根引导必需；只作用于隔离根） |
| 5 | `hub start dev-t55`（`bun run dev`，cwd `packages/neuro-book`，`PORT=4321`，隔离 state/cache 根） | ready（首次 13s 内可连；Vite 依赖优化期页面空白属正常，日志出现 `optimized dependencies changed. reloading` 后重载即可） |
| 6 | `netstat -ano \| grep LISTENING \| grep -E ":4321\|:3001"`（worktree 根，验收后） | 无输出（exit 1）：两个端口都没有监听；`hub stop dev-t55` → `exited exit=1 uptime=5m4s` |
| 7 | `git status --porcelain`（worktree 根） | 仅本次改动的 7 个已跟踪文件 + 8 个新文件；用户 dirty `descriptors{,.test}.ts` 未被我触碰；**未 `git add`/commit/push** |
| 8 | `bun run docs:check`（worktree 根，本记录落盘后） | 见 §六 |

## 三、实现要点（与 Task README 的对应）

1. **挂载（要求 1）**：`index.vue` 左叶由占位块换成 `<WorkbenchViewHost :container="SHELL_LEFT_CONTAINER" :container-title="t(...)" :context="workbenchViewContext" />`。宿主渲染容器部件（标题仍来自 `containers.ts` 的 `titleKey`），内容区合同取第一个可见视图的 `layout`（`files` 是 `fill`）。书架态左叶整块不渲染（外壳 `setLeafVisible` 原有行为），`files` 入口的禁用判据仍来自 `workbench-chrome.ts:71`，未改一行。
2. **接入路径（要求 2）**：`SHELL_FILES_VIEW`（`nbook.files`，容器 `nbook.tools`，`when.requires:["project"]`、`requiredAuthority:["files"]`、`stateScope:"user"`、`factoryKey:"nbook.view.files"`）登记进 `PRODUCT_CATALOG`，注册表由既有 `createWorkbenchRegistry` 构造；内容经 `view-factories.ts` 白名单解析——descriptor 里没有组件、模块路径或 HTML；没有新建命令系统。`canToggleVisibility`/`canMoveView` 按当前真实能力声明为 `false`（可见性开关与跨容器移动都还没有消费者）。
3. **展开项归属（要求 3）**：新定义 `workbench.files`/`expanded-paths`（user/local、single、schemaVersion 1、默认 `{paths: []}`，定义模块 `shared/storage/workbench-files.ts`，注册只追加到 `server/storage/product-definitions.ts` 的唯一清单）。会话复用既有 `createLayoutRecordSession`：首读门禁、条件保存、冲突重读、未确认意图的 `retry()`/`abandon()`。**首读完成前不写默认值**：`commit` 先 `await open()` 再提交，所以用户读盘期间的展开操作不会被丢弃，也不会凭空写出记录。**旧键迁移**：读 `nbook.workspaceFilePanel.expandedPaths` → 记录缺失时条件初始化 → `handle.read` 回读与本次写入集合一致 → 才删除旧键；记录已有值时不覆盖、只做一次性收尾；旧键不可解析、记录损坏/不可写、回读不一致、删除失败这四类都保留旧键并把诊断显示到面板（`data-file-panel-record-notice`，可重试时带「重试 / 放弃」）。
4. **行为保持与打开反馈（要求 4）**：展开/折叠、搜索过滤、选中、拖拽移动、新建弹窗、三种明细面板分派都走原实现；只有展开项的来源换了。双击打开仍走 `store.openWorkspaceNode(node,"permanent")`，因为编辑器叶还是占位块，面板在该次打开后显示可见提示条「已打开 `<path>`：编辑器叶（Markdown Studio）还没迁入，正文暂不可预览。」（`data-file-panel-open-notice`，可关闭），不再静默。打开标签/活动文件仍是 sessionStorage 的领域恢复态，未并入 Storage（排除项）。
5. **单写者（要求 5）**：组件里 `WORKSPACE_EXPANDED_PATHS_STORAGE_KEY`、`loadExpandedPaths`、`saveExpandedPaths`、`watch(expandedPaths)` 全部删除；`v-model:expanded-paths` 的 setter 只调 `expandedPathsRecord.commit`。左栏尺寸一个字未动，仍归切片 4 的 `workbench.layout` 记录。
6. **旧实现删除条件（要求 6）**：`index.vue:12`（`NovelIdeToolPanel`）与 `:16`（`WorkspaceFilePanel`）import 删除（组件本体保留，角色/情节槽位未迁）；旧裸键在浏览器里真实删除（见 §四.3 两种情形）；`NovelIdeToolPanel.vue` 未退化为第二实现（`files` 槽位不再有产品宿主持有它）。

## 四、验证

### 4.1 聚焦测试（30 例）

| 文件 | 覆盖 |
|---|---|
| `files-view-session.test.ts`（13） | 旧键解析（非 JSON / 非数组 / 清洗去重）；首读门禁（读取未分类前不落盘、读完后写一次）；记录缺失不写默认值；旧键迁移（条件初始化 + 回读一致 + 删旧键）；已有记录不被旧键覆盖（只删旧键）；空旧值收尾；旧键不可解析不迁移也不删除；回读不一致保留旧键且可重试；记录损坏保留旧键；条件冲突不静默（未确认意图 + retry 后写一次）；放弃回到已确认值；旧键名未改名 |
| `product-catalog.test.ts`（6） | 产品清单合法、每个登记视图的 `factoryKey` 都能在白名单求值（防 descriptor/factory 漂移）；未知 factoryKey 求值失败；`when` 求值（Project 可见 / 未打开给原因）；未登记容器求值失败；合同取第一个可见视图（`fill`）/ 无可见视图退回默认（`scroll`） |
| `WorkbenchViewHost.test.ts`（6） | Project 态渲染可见视图且内容区 `data-container-layout="fill"`；不可见视图不进 DOM、空状态给出 `when` 原因并退回默认合同；factory 解析失败显示诊断；多视图各自渲染；容器未登记显示注册表诊断 |
| `WorkspaceFilePanel.test.ts`（6） | 展开项来自记录且挂载零浏览器存储读写；树的变化只提交记录（`Storage.prototype.setItem/getItem` 零调用）；选中走 preview、双击走 permanent 并给出打开提示；三种明细面板分派；记录诊断可见且带重试/放弃；无诊断不显示提示条 |

### 4.2 类型检查（只读）

`bunx tsc --noEmit -p tsconfig.json` 发现并修掉两处**测试替身**的类型错（`contentNode` 应为 `boolean`、不可用上下文原因取值域），以及一处**产品代码真错**：`resolveContainerViews` 曾把 `DescriptorResult` 的包装层当成了结果本身（`evaluation.visible` 恒为 `undefined` → 所有视图都被判成不可见）。这条只有类型检查/渲染才看得到，已改为 `evaluation.value.visible/reasons`，并由 `product-catalog.test.ts` 与浏览器验收双重确认。

### 4.3 真实浏览器验收（隔离宿主）

- 宿主：`hub start dev-t55`（`bun run dev`），`PORT=4321`，`NEURO_BOOK_STATE_ROOT=%TEMP%/nb-t55-verify/state`、`NEURO_BOOK_CACHE_ROOT=%TEMP%/nb-t55-verify/cache`；浏览器是 omp managed Chromium（1440×900），**未使用开发者的 Chrome/profile，未访问/启停 3001**（窗口由 Main 先停 3001 后交给我，跑完由我 `hub stop` 并核对端口无监听）。
- 空根引导：先跑 `migrate:application-state -- --apply`（exit 0），再用书架「新建书籍」创建一次性项目 `t55 文件树验收`。

| # | 操作 | 观察（原文） |
|---|---|---|
| B1 | 打开 Project | URL `/?project=t55-wen-jian-shu-yan-shou`；左叶容器 `data-container="nbook.tools"`、`data-container-part="left"`、`data-container-layout="fill"`、`aria-label="工具"`；`[data-view-host]`、`[data-view="nbook.files"]`、`[data-role="workspace-file-tree-root"]` 都在；行：智能体上下文、世界书、手册、正文、参考资料、上传、世界引擎、AGENTS、project.yaml |
| B2 | 展开「世界书」 | 展开出 角色档案/事件/势力/创作指令/物品/地点/素材笔记/系统机制/世界设定；`localStorage` 键里**没有** `nbook.workspaceFilePanel.expandedPaths`；磁盘 `<隔离根>/workspace/.nbook/storage/<身份>/<主体>/local/<客户端>/workbench.files/records/expanded-paths.json` = `{"wrapper":1,"revision":"73337dcc-…","state":"value","schemaVersion":1,"value":{"paths":["lorebook/"]}}` |
| B3 | 刷新页面 | 展开态恢复（世界书的子项仍在）；用户分区下只有 `workbench.files` 与 `workbench.migration` 两个 owner，无第二套写路径 |
| B4 | 旧键迁移（记录已存在） | 预置 `localStorage["nbook.workspaceFilePanel.expandedPaths"]='["manuscript/"]'` 后刷新 → 旧键 `null`（已删除）；记录 revision 仍为 `73337dcc-…`、值仍是 `{"paths":["lorebook/"]}`（**未被旧键覆盖**）；树仍按记录展开 |
| B5 | 旧键迁移（记录缺失） | 把记录文件移走后预置旧键 `["manuscript/"]` 刷新 → 旧键 `null`；新记录 `{"wrapper":1,"revision":"672ee8a2-…","value":{"paths":["manuscript/"]}}`；树按 `manuscript/` 展开（回读一致后才删键，页面上也没有诊断条） |
| B6 | 双击打开文件 | 双击 `project.yaml` → 提示条 `已打开 project.yaml：编辑器叶（Markdown Studio）还没迁入，正文暂不可预览。` + 「关闭提示」；下方明细面板同步显示 `project.yaml / FILE / 可编辑` |
| B7 | 书架态 | 裸 `/` 回落书架：`[data-container="nbook.tools"]` 与文件树**都不在 DOM**；activity 条目按图标核对 `.workbench-activity-bar__item` → `i-lucide-files` 仍 `disabled: true`（其余角色/情节/世界/轨迹同样禁用，与接入前一致） |

## 五、未运行项与偏差（明确列出）

- **未运行**：`bun run typecheck`（`nuxt typecheck` 会重建 `.nuxt`，3001 在线期间禁止；改用 `bunx tsc --noEmit` 只读替代）、`bun run test`（全量）、Lab smoke（`smoke:component-lab`）、Product 门禁与构建、桌面宿主回归。
- **未补 Lab fixture**：`app/components/novel-ide/workspace/**` 既无 `.md`（因此 `WorkspaceFilePanel` 本来就没有 Lab 条目，也就没有"因 `persist:localStorage` 被判 `mountable:false`"的条目需要复核）；且面板数据来自产品 store 与 Storage 会话，Lab fixture 不允许依赖持久化状态、也拿不到注入适配器，硬挂只会做成假宿主。接线改由 `WorkspaceFilePanel.test.ts`（store/记录替身 + 子组件 stub）与真实浏览器覆盖。若后续要上 Lab，需要先给 fixture 一条注入 Storage 适配器的通道（属 Lab 侧改动，不在本 Task 范围）。
- **偏差 1（行为细节，刻意保留）**：`activeLeftTab` 仍不决定左叶内容的显隐——点中 `files` 图标只会切换高亮，左叶照常渲染文件树；这与接入前的占位语义一致（接入前左叶也永远渲染占位块），要在下一次迁移（角色/情节）里和 descriptor 的可见性一起收口。
- **偏差 2（未能在浏览器到达的状态）**：user-assets 工作面在隔离实例里没到达——书架点「用户资产」与直达 `?project=workspace/.nbook` 都回落到书架，无报错、无 toast、无 spinner（属该工作面在空隔离根的前置问题，不是本次改动的回归）。该状态下"不渲染文件树"由 `product-catalog.test.ts` / `WorkbenchViewHost.test.ts` 的 non-project 上下文覆盖（`when.requires:["project"]` + 页面 `project: workbenchLayoutSurface.kind === "project"`）。
- **偏差 3（字段取值）**：`SHELL_FILES_VIEW.canToggleVisibility/canMoveView` 声明为 `false`（提案第一版范围允许跨容器移动，但宿主还没有拖动/隐藏的落账消费者）；将来接上拖动时应连同 `workbench.views.customizations` 一起改这里。
- **证据资产未落盘**：浏览器三张截图（工作台全貌、展开态 + 打开提示条、书架态）在会话中看过，未写入仓库；本记录保存的是可复核的 DOM 探针输出、磁盘记录原文与命令退出码。若 Leader 需要图片证据，可在下一次窗口内补拍。
- **未提交**：未 `git add`、未 commit、未 push（按约束）。

## 六、文档门禁

| 命令（cwd） | 结果 |
|---|---|
| `bun run docs:check`（worktree 根，本记录 + 清单更新 + Task README 状态落盘后；只读，不起服务） | **exit 0**，`{"failures":[],"checkedFiles":5879}` |

## 七、返工（t60 复核裁定「需修复」，R1 / R3）

要求见 [`t60/walkthroughs/leader-rework-requirements.md`](../../t60-view-migration-review/walkthroughs/leader-rework-requirements.md)；复核正文见 [`review.md`](../../t60-view-migration-review/walkthroughs/review.md) 的 F1 / Q6 / Q7 / Q8。

### R1（P2）首读完成前树手势会静默覆盖已确认展开项

- **缺陷**：`WorkspaceFileTree` 的手势提交的是**整份** `props.expandedPaths`（`WorkspaceFileTree.vue:98-104` 的 `sanitizeExpandedPaths` 看护），而记录读到分类前面板显示的是产品默认（空展开）；此时提交会以「已确认记录」为底、以「默认 + 本次路径」为意图合成，把记录里原有的展开项静默丢掉（无诊断）。
- **修法（两层，互补）**：
  1. **界面层**（`WorkspaceFilePanel.vue`）：`expandedPathsLoading`（= 记录会话的 `loading`）为真时**不渲染树**，走既有加载占位 `t("ide.workspace.filePanel.loadingTree")`——读取就绪前展开控件不存在，`persistence.md`「调整控件在读取就绪前不可用」的界面义务落地（与同批 World Engine 的 `resizeDisabled = panelSizes.loading` 同口径）。
  2. **会话层**（`user-record-session.ts` 的 `commit`）：不再「等首读完成后重放」，改为**拒绝**未就绪的提交并写入一条可见诊断（`记录还没完成首次读取，本次调整没有保存`，`retryable:false`）。这条同时修掉同类窗口：读取窗口内基于默认尺寸的拖动（设置 / 新建作品对话框，复核 F2）此前会覆盖已确认尺寸，现在只被拒绝、不落盘。模块头与 `WorkspaceFilePanel.md` 的口径同步改成「两层门禁 + 不排队重放」。
- **测试**（新增/改写，全部真能失败）：
  - `files-view-session.test.ts`「首读门禁」改写为回归钉：记录预置 `{"paths":["manuscript/","manuscript/vol-1"]}`、闸住首读 → 提交 `["lorebook/"]` 被拒（`saves` 空、记录原值不变、诊断含「没完成首次读取」且不可重试）→ 放行读完后显示仍是两条已确认值 → 就绪后提交整份数组 `["manuscript/","manuscript/vol-1","lorebook/"]` 落盘为并集。
  - `window-size-session.test.ts` 同名用例按新语义改写（同上，尺寸侧）。
  - `WorkspaceFilePanel.test.ts` 新增「记录读取中就绪前不渲染树（调整控件不可用），就绪后按记录的展开项渲染」。
- **复核探针的真实反应**（确定性复现命令，cwd = worktree 根）：

  ```
  bunx vitest run --config .agents/works/w00003-neurobook-ui-foundation-migration/tasks/t60-view-migration-review/walkthroughs/probes/vitest.probes.config.ts
  ```

  **exit 1**，`Test Files 1 failed | 2 passed (3)`、`Tests 3 failed | 12 passed (15)`：`probe-01-first-read-intent.probe.test.ts` 的 3 例（它 pin 的正是修复前的缺陷行为）现在断言失败，实测值变成修复后的正确值——
  - files：`stored` 不再是 `{"paths":["lorebook/"]}`（记录保住）；
  - settings：记录仍是 `{width:1000,height:700}`（不再被 `{width:1200,height:640}` 覆盖）；
  - create-project：记录不存在（未用默认尺寸创造记录）。
  **对照组仍绿**：「读取完成后同样的手势不会丢已确认值」——差异只来自读取窗口，修复没有改变就绪后的语义。
  探针是 t60 的证物（pin 缺陷），未擅自改其断言；是否把它翻成「记录保住」的期望由复核者决定。

### R3（P3）文档与实现不符 4 处 + legacy 组件口径

| # | 文档 | 原文 → 实测不符 | 改法 |
|---|---|---|---|
| 1 | `WorkbenchViewHost.md` §分工 | 「宿主负责把这三类都画出来，不吞任何一类」——有可见视图时 `hidden` 的原因不进 DOM | 改为「三类都参与渲染，但方式不同：可见的画出内容；两类失败各成提示行；不可见的原因只在**没有可见视图时**作为空态文案」 |
| 2 | `WorkbenchViewHost.md` §布局 | 「提示与空态都用 `role="status"`」——空态 `<p>` 没有 `role` | 改为「提示行是 `role="status"`；空态是静态说明，不带 live region」（实现侧不改：静态文案不是实时播报） |
| 3 | `WorkspaceFilePanel.md` 开篇 | 「记录没读到分类、提交未确认、不可写、旧键没迁完都变成一条**可重试的**诊断条」——`blocked` 分支固定 `retryable:false`（与壳层同一约定） | 改为「提交未确认与旧键没迁完可重试；记录读不到分类（损坏 / 版本不支持）不可重试」 |
| 4 | `WorkspaceFilePanel.md` §交互 | 「文件转同名目录（内容 scope 下的可编辑文件）」——实现还要求不是 `index.md`（`WorkspaceFilePanel.vue:587-589`） | 补上「且自身不是 `index.md`」 |
| 5 | 口径（README / `storage-core-validation.md` / 清单 §2.6 / t56 实施记录） | 「四个 legacy 组件因契约测试仍断言其内容而保留」——只对 3 个成立 | 逐件写明：`WorldEngine{SliceInspector,StateSummary,Timeline}.vue` 被 `world-engine-ide-entry.test.ts:62-64/963-980` 读取并断言（删它们测试会红）；`WorldEngineSubjectStateViewer.vue`（连同同目录 `…Row.vue`）只是两者互为引用，删它不会让任何测试失败，属独立清理项 |

另同步更新（因 R1 改变了行为口径）：`WorkspaceFilePanel.md` 的「展开项归记录」（首读门禁两层、不排队重放）、§状态「加载中」条（记录读取期间树不挂载）、Lab 替代验证清单（补 `legacy-record-migration.test.ts` 与读取态用例）。

### 返工后的门禁

| 命令（cwd） | 结果 |
|---|---|
| `bun run --cwd packages/neuro-book test app/utils/workbench app/components/workbench app/components/novel-ide/workspace`（worktree 根） | **exit 0**，`Test Files 21 passed (21)`、`Tests 227 passed (227)` |
| 更宽一圈（把所有会话消费端一起跑）：`bun run --cwd packages/neuro-book test app/components/novel-ide app/utils/workbench app/components/workbench`（worktree 根） | **exit 0**，`Test Files 71 passed (71)`、`Tests 621 passed (621)` |
| `bunx tsc --noEmit -p tsconfig.json`（`packages/neuro-book`，只读） | 本次改动文件零错误（按文件名过滤无输出） |
| `bun run docs:check`（worktree 根） | **exit 0**，`{"failures":[],"checkedFiles":5907}` |
| 复核探针（命令见 R1） | exit 1：3 例按预期翻红（pin 缺陷），对照组 12 例仍绿 |

未运行：`bun run typecheck`（会重建 `.nuxt`；本轮不需要，只读 `tsc` 已覆盖）、全量 `bun run test`、Lab smoke、构建、浏览器验收（本轮改动是门禁与文档，会话层与组件层由上述聚焦测试与探针覆盖；`git status` 显示工作区只有本轮改动与用户 dirty 的 `descriptors{,.test}.ts`）。未 `git add`、未 commit、未 push。
