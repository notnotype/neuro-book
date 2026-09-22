# 切片实施记录：`WorkspaceFilePanel` 的契约文档与 Lab 可挂载性判定

Work：`.agents/works/w00003-neurobook-ui-foundation-migration`；Task：`tasks/t59-file-panel-lab-coverage`。
工作区：`.worktree/w00003-neurobook-ui-foundation-migration`（分支 `refactor/w00003-nb-ui-adoption`）；命令 cwd 逐条标注。**未提交、未 push**；未启停 3001、未起第二个 dev server、未联网。

## 一、交付物与结论

| 项 | 值 |
|---|---|
| 新增（文档） | `packages/neuro-book/app/components/novel-ide/workspace/WorkspaceFilePanel.md`：契约文档 + frontmatter `标签: [state:local, state:shared-read, state:shared-write, io:read, io:mutate, persist:local, env:clipboard]`；正文含职责边界（store / 记录 / 明细分派 / 打开链路）、数据（无 props/emits/slots/expose）、布局、交互、状态、不支持、隐藏通道理由、Lab 与确定性验证、注意事项 |
| **可挂载性结论** | **不可挂载**（`mountable: false`）。按 `app/component-lab/component-index.ts:88-101`，标签命中 `state:shared-write` / `io:` 组 → Lab 中栏给出原因，**不挂 fixture、不造替代场景**（Lab 规范：`docs/specs/ui/component-lab.md`「已入索引但有阻断标签或没有 fixture 的组件……中栏显示不能挂载……不创建替代 fixture」） |
| 未加 fixture | 见 §三：本组件没有一条能由 fixture 喂饱的明面通道（零 props / 零 slots），树、选中、问题列表在 store 里，展开项在记录里，请求在 store 与 Storage 宿主客户端里；造「假宿主」会与 Lab 的「不伪造可交互场景」冲突 |
| 修改（工作台账） | 本 Task `README.md:9` 状态行 → `已实现并验证（2026-09-16）` + 结论与交付物指向本记录 |
| 修改（清单待办） | `view-migration-inventory.md:83`：§2.1③ 里「若将来加文档会被判 `mountable:false`」的待办改为 2026-09-16 落地事实（判定不变、原因随 t55 更新） |
| 未改 | `WorkspaceFilePanel.vue`、`files-view-session.ts`、`user-record-session.ts`、`shared/storage/workbench-files.ts`、`server/storage/product-definitions.ts`、`component-lab/**`（含 `fixtures/index.ts`）、`i18n`；用户 dirty `app/utils/workbench/descriptors{,.test}.ts` 一字未动 |

## 二、命令与退出码（真实命令、cwd、结果）

| # | 命令（cwd） | 结果 |
|---|---|---|
| 1 | `bun run docs:check`（worktree 根，文档落盘后 5897、本记录等台账落盘后 5898，两次都跑） | **exit 0**、**exit 0**，`{"failures":[],"checkedFiles":5897}` / `{"failures":[],"checkedFiles":5898}` |
| 2 | `bun run --cwd . test app/components/novel-ide/workspace/WorkspaceFilePanel.test.ts app/component-lab/fixtures/index.test.ts`（`packages/neuro-book`，文档首版落盘后与最终态各跑一次） | **exit 0**、**exit 0**，`Test Files 2 passed (2)`、`Tests 10 passed (10)`（面板既有 6 例 + fixture 登记既有 4 例；文档改动不影响它们） |
| 3 | `node --import tsx scripts/smoke/component-lab.ts --url http://127.0.0.1:3001 --browser-executable "C:/Program Files/Google/Chrome/Application/chrome.exe"`（`packages/neuro-book`，对**运行中的 3001** 只读跑、默认 all 套件；**跑过两次**：文档首版落盘后、正文口径修正后再跑一次） | **exit 0**、**exit 0**（第二次 24.7s，末行 `Component Lab smoke passed: http://127.0.0.1:3001/`）；两次输出都含 `Agent Profile DialogWindow geometry` / `Settings view layout` / `Agent Profile container layout` 三段读数。脚本只在 `failures.length === 0` 时打这句、否则 throw（`scripts/smoke/component-lab.ts:192-199`），所以这句即退出码 0 的证据 |
| 4 | 浏览器只读取证（omp 托管 Chromium → `http://127.0.0.1:3001/lab`，1600×1000）；3001 的进程归属已核对：`hub describe neurobook-3001` → `Command: bun run dev`，`Cwd: …/.worktree/w00003-neurobook-ui-foundation-migration/packages/neuro-book` | 见 §三.2；未启停 3001、未起第二个 dev server、未与该服务交互除 Lab 只读探测以外的东西 |

## 三、实现要点（与 Task README 的对应）

### 3.1 文档与实现一致（要求 1）

先读实现再写，逐条对上（`WorkspaceFilePanel.vue` 全 747 行 + `files-view-session.ts` + `user-record-session.ts` + `legacy-record-migration.ts` + `storage-context.ts` 的默认适配器）：

- 展开项走记录：`expandedPaths` 是 computed（读会话 `display`、写 `commit`），旧裸键 `nbook.workspaceFilePanel.expandedPaths` 由会话一次性迁移——文档写明「组件里没有一处 `localStorage`」，并把这句与 `persist:local` 的差别交代清楚（见 3.3）。
- 挂载与拉树判据：`onMounted` / `watch(canAccessWorkspace)` → `canAccessWorkspace && workspaceTree.length === 0` 才 `loadWorkspaceTree()`；刷新按钮不设条件。
- 失败可见语义两条：`data-file-panel-record-notice`（`role="status"` + `aria-live="polite"`，可重试时给「重试 / 放弃」）与 `data-file-panel-open-notice`（打开成功但正文无处呈现 + 「关闭提示」）。
- 明细分派三支：角色条目 / 其它世界书条目 / 其余（含未选中）——**`file` 支是兜底、始终渲染**，高度受控 260。
- 交互与条件项：搜索字段集（`path`/`title`/`summary`/`entryType`/`status`，按 `toLocaleLowerCase("zh-CN")` 归一后 `includes` 匹配）与命中祖先强制展开；节点右键的打开 / 展开收起 / 新建（子与兄弟；世界书 scope 多一条）/ 复制四种（剪贴板）/ 重命名 / 删除（目录失败后二次确认递归）/ 两条转换项及其条件；空白区菜单 = 新建 + 刷新；移动冲突弹建议名（目标等于原名或落进自身子树则不弹框、不移动）、取消不移动；世界书条目路径归一化到 `<目录>/index.md`。
- 失败可见语义按实现逐条核对后**收窄了两处初稿口径**：① 通知只覆盖创建 / 转换 / 移动（重命名与「拒绝递归确认」是未捕获的拒绝，没有通知）；② 树读取失败没有专门文案（store 的 `finally` 复位 `loadingWorkspaceTree`，树按上一次快照呈现）。文档按实际写，并把这两条登记为后续迁移批次的缺口。
- 不抄迁移前口径：文档里没有「裸键写入」「localStorage 展开项」这类旧形态，也没有把 t55 之前的「占位块左叶」当现状。
- 明面通道先核对再写：`WorkbenchViewHost.vue:98` 渲染视图是 `<component :is="components[view.id]" />`——**不传 props、不加监听**，所以「零 props / emits / slots / expose」成立；`factoryKey` → 组件的映射只有 `view-factories.ts` 一条。

### 3.2 可挂载性判定与证据（要求 2）

**结论：不可挂载。** 依据是**标签推导**（不是人工拍）＋**运行中的 Lab 索引实测**：

- 输入：`WorkspaceFilePanel.md` frontmatter `标签: [state:local, state:shared-read, state:shared-write, io:read, io:mutate, persist:local, env:clipboard]`。
- 规则（`app/component-lab/component-index.ts:88-101`）：命中 `io:` 或 `state:shared-write` → `mountable: false`，`blockedReason` 列出命中的标签；`persist:` 组同样阻断；`state:shared-read` 只额外标 `needsSnapshot`。
- 页面侧证据（浏览器实测，非只看推导；对运行中的 3001 只读）：Lab 左栏 `novel-ide → workspace` 下出现 `WorkspaceFilePanel`（顶栏 `46 个组件`，搜索后 `1 / 46`）；选中后中栏是锁态空态，原文：

  ```
  WorkspaceFilePanel 不能在 Lab 里验证
  会真的读写产品数据（state:shared-write、io:read、io:mutate），只能在正式界面验证
  ```

  右栏「文档」tab 原文：`目录 workspace` / `能力标签 state:local state:shared-read state:shared-write io:read io:mutate persist:local env:clipboard` / `确定性验证 只能在正式界面`；正文按 Markdown 渲染出「职责边界」「隐藏通道理由」「Lab 与确定性验证」「注意事项」等节（探针逐项 true）。中栏没有挂载任何 fixture（`[data-lab-subject]` 探测为 `false`），页面 `console` 零 error/warning。截图存系统临时根 `%TEMP%/t59-lab-workspacefilepanel.png`（**未落仓库**，证据为可复核的 DOM 探针原文）。

**为什么不是「加个缝隙就能挂」**：`WorkbenchViewHost`（t57）能挂，是因为它的输入全在 props 里（容器声明 + 环境事实），缝隙只替换「factoryKey → 组件」一处。本组件相反——**明面通道是空的**（零 props / emits / slots / expose），数据全在 store（六个字段读 + 十个动作写）、展开项在记录会话、请求在 store 与 Storage 宿主客户端。要让它确定性挂载，等价于把读取与动作上移到宿主、把组件改成受控视图（Lab 规范对 `state:shared-read` 也是这句话：「迁移批次必须先把读取上移到宿主」）。那是一次真实迁移，不在本 Task 范围（Task 明写「不改文件树行为」「不为其余 13 个 workspace 组件补文档」，且 Leader 提示「不要为此改造组件」）。同理**不加 fixture**：为阻断条目写 fixture 与 Lab 规范「不创建替代 fixture / 不伪造可交互场景」直接冲突。

### 3.3 标签口径（每个标签都能对着实现核）

| 标签 | 实现依据 |
|---|---|
| `state:local` | `searchQuery`、`openedFilePath`、`detailHeight`、右键菜单坐标与项、新建弹窗开关与参数、`creatingWorkspaceNode` |
| `state:shared-read` | `storeToRefs(store)` 读 `workspaceTree` / `loadingWorkspaceTree` / `selectedFileNode` / `selectedFilePath` / `workspaceIssues` / `canAccessWorkspace` |
| `state:shared-write` | `loadWorkspaceTree` / `openWorkspaceNode` / `selectWorkspacePath` / `clearActiveFile` / `createWorkspaceFile` / `createWorkspaceDirectory` / `renameWorkspacePath` / `optimisticRenameWorkspacePath` / `deleteWorkspacePath` / `convertWorkspaceFileToDirectory` |
| `io:read` / `io:mutate` | 组件内无 HTTP 客户端，但两条默认链路真的发请求：① store 动作读改 `/api/workspace-files/*`（挂载即可能触发一次读）；② `useWorkbenchFileTreeExpandedPaths()` 的默认适配器是 Storage 宿主客户端（`openStorageUserContext` 等 → `apiFetch`，`/api/storage/user/context` + 记录读写），展开提交即触发写。呼应组件规范「藏在多层封装后的请求需要手写标签与实现交叉核对才能发现」 |
| `persist:local` | 会话的旧键访问器 `createBrowserLegacyValueStore("nbook.workspaceFilePanel.expandedPaths")` 直接 `localStorage.getItem/removeItem`（`legacy-record-migration.ts:35-63`）；只在旧键一次性迁移路径上，迁移完成后不再写、失败保留旧键并诊断 |
| `env:clipboard` | 右键「复制相对/绝对路径、相对/绝对引用」→ `navigator.clipboard.writeText(...)` |

未声明的通道：无（`useI18n()` 取文案按仓库既有 28 篇文档的惯例不计 `state:inject`；对话框与通知是 `useDialog` / `useNotification` 服务，不在组件子树内渲染，文档在「交互」「状态」两节写明它们的可见结果）。

### 3.4 替代验证（要求 2 的「不可挂载 → 替代验证」）

- 聚焦测试：`WorkspaceFilePanel.test.ts`（6 例：展开项来自记录且挂载零浏览器存储读写、唯一写路径、选中 preview / 打开 permanent + 提示条、三种明细分派、诊断条可重试/放弃、无诊断不显示条）+ `files-view-session.test.ts`（13 例：首读门禁、旧键迁移四类失败、冲突不静默……）+ `product-catalog.test.ts` / `WorkbenchViewHost.test.ts`（`nbook.files` 的可见性求值与宿主渲染）。
- 真实界面：t55 在隔离宿主上验证过展开落记录、两种旧键迁移情形、打开提示条与书架态不渲染（见 `tasks/t55-files-view-migration/walkthroughs/implementation.md` §四.3）。
- 本 Task 新增的真实浏览器证据：Lab smoke 全量 exit 0（§二.3）+ Lab 索引与阻断原因实测（§二.4 / §3.2）。

## 四、未运行项与偏差（明确列出）

- **未运行**：`bun run typecheck`（会重建 `.nuxt`，3001 在线期间禁止；且本次无 `.ts`/`.vue` 改动，改用 `bunx tsc --noEmit` 也无对象——只新增了一个 `.md`）；`bunx tsc --noEmit` / `vue-tsc`（无代码变更，跑它只重复既有基线）；全量 `bun run test`、Lab 分层 smoke、Product 门禁与构建（属 Main 的统一门禁）；未启停 3001、未起第二个 dev server、未访问其它包。
- **偏差（`persist:local` 的口径）**：t55 后组件内**没有** `localStorage` 调用（这也是 t55 测试「挂载零浏览器存储读写」断言的事实），标签取的是「组件默认接线可达的通道」——旧键迁移路径。文档在「隐藏通道理由」里把这一层写清楚了，避免读成「组件又去裸写 localStorage」。
- **偏差（`io:` 的口径）**：组件自己不含 `fetch`；声明的是它触发的两条请求链路（store 动作与 Storage 宿主适配器），并把「请求入口不可由外部替换」作为现实状态写进理由（组件规范档位 C 的登记对象，不改标签定义、不留豁免名单）。
- **偏差（文案）**：Lab 里那条阻断原因是索引按标签拼的产品化中文（`会真的读写产品数据（…），只能在正式界面验证`），不是文档正文；文档正文另外写明了替代验证。
- **未提交**：未 `git add` 目录、未 commit、未 push；`git status --porcelain` 显示本次改动只有 1 个新文件 + 2 个台账文件（+ 文档本身），用户 dirty 的 `descriptors{,.test}.ts` 未被触碰。

## 五、文档门禁

| 命令（cwd） | 结果 |
|---|---|
| `bun run docs:check`（worktree 根，本记录 + 状态行 + 清单注记落盘后） | **exit 0**，`{"failures":[],"checkedFiles":5898}` |
| `git diff --check`（worktree 根） | **exit 0**（只有本仓库既有的 LF→CRLF 提示，与本次改动无关；用户 dirty 的两个文件同样出现在提示里） |
